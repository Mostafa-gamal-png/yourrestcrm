// The requests that exist only in the products application (the owner, 2026-11-19: «كل الطلبات» shows them, read-only, so the filters
// count them), without a build:
// - Reading the `orders` route (portable/mold-rules.mjs moldOrderItem): the products team's own example (a manual request in
//   manufacturing, a cancelled one, a legacy one delivered) read whole; a Riyadh time without its offset made ISO; an item that cannot be
//   read (no requestRef, a bad one, a CRM request, an unknown source or status, not an object) refused; the route missing (404 whatever its
//   code, 400 naming only "route") told from a failure; the cursor of the next page.
// - The client and the stand-in (scripts/lib/products-mock.mjs): the older application answers 404 unknown_route; the route signed like
//   the others, its pages, the last page's null, a cursor it did not give refused 400 ['cursor'], deleted and CRM requests never listed.
// - The CRM customer of an order (moldOrderCustomers): its Yourrest number, else its ERP code when exactly one customer carries it now (a
//   mapping choosing among two), else none.
// - Who sees which order (canReadMoldOrder: canReadMoldRequest on its salesman and customer), role by role: the administrator all; a
//   representative his own only (never another's, whatever the customer); a supervisor his representatives'; a customer-service manager
//   his team's; a sales manager his own, his team's and what he would approve (a salesman in no team or unknown: by the customer's region;
//   no customer found: a manager of every region only), never another active manager's team's.
// - The view (moldOrderView): read-only, its id never a CRM id, the member only when the CRM knows it, its files through ?ref=.
// - The filters with orders (lib/mold-filters.ts): the merge by the day asked for (neither list reordered), «المصدر» offered only with
//   more than one source, each source alone, «المندوب» by production's salesman name when the CRM does not know him, «الحالة», «واقف
//   عند», the Riyadh days, the search (order number, serial, ERP code, salesman), «أعادتها المالية», how many are set.
// - The server (lib/mold-requests-server.ts transpiled, against the stand-in over HTTPS): every page read, kept a minute (no second
//   call), an item that cannot be read left out and counted for the administrator only, a CRM item left out uncounted, one listed twice
//   shown once, more than ten pages cut (the administrator told), a cursor given twice a failure, a failure keeping the last copy with its
//   reason (or none), the route missing: nothing (null), remembered, production not asked again; the reader's own orders only.
// - The page asks for them (?orders=1), the route only then, and every text in Arabic with its English pair.
// Synthetic data only (the products team's example is their test data); no production application, no secret printed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {request as httpsRequest} from 'node:https';
import {MOLD_STAGES, MOLD_ORDERS_MAX_PAGES, MOLD_ORDERS_CURSOR_MAX, moldOrderItem, moldOrderTime, moldOrdersNext, moldOrdersRouteMissing} from '../portable/mold-rules.mjs';
import {callProducts, moldConfig} from '../portable/mold-client.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';

let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'mold-orders-')), seen = new Set();
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
fs.writeFileSync(path.join(out, 'env.mjs'), 'export const env=globalThis.moldOrdersEnv||{};');
fs.writeFileSync(path.join(out, 'auth.mjs'), 'export async function getApplicationUser(){return null;}');
function compile(relative) {
  if (seen.has(relative)) return; seen.add(relative);
  const source = path.join(root, relative), dest = path.join(out, relative.replace(/\.tsx?$/, '.mjs'));
  fs.mkdirSync(path.dirname(dest), {recursive: true});
  let code = ts.transpileModule(fs.readFileSync(source, 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
  code = code.replace(/from (['"])([^'"]+)\1/g, (match, quote, imported) => {
    if (imported === 'cloudflare:workers') return 'from ' + JSON.stringify(path.join(out, 'env.mjs'));
    if (imported === '@/app/application-auth') return 'from ' + JSON.stringify(path.join(out, 'auth.mjs'));
    if (!imported.startsWith('.') && !imported.startsWith('@/')) return match;
    let target = imported.startsWith('@/') ? imported.slice(2) : path.relative(root, path.resolve(path.dirname(source), imported));
    if (target.endsWith('.mjs')) return 'from ' + JSON.stringify(path.join(root, target));
    if (!/\.tsx?$/.test(target)) target += fs.existsSync(path.join(root, target + '.ts')) ? '.ts' : '.tsx';
    compile(target); return 'from ' + JSON.stringify(path.join(out, target.replace(/\.tsx?$/, '.mjs')));
  });
  fs.writeFileSync(dest, code);
}
compile('lib/mold-filters.ts');
compile('lib/mold-requests-server.ts');
const filters = await import(path.join(out, 'lib/mold-filters.mjs'));
const lib = await import(path.join(out, 'lib/mold-requests.mjs'));
const server = await import(path.join(out, 'lib/mold-requests-server.mjs'));
const say = language => (ar, en) => language === 'en' ? en : ar;

// ---- the products team's example of the `orders` route (their test data, 2026-11-19)
const stagesNone = () => Object.fromEntries(MOLD_STAGES.map(key => [key, {done: false, at: null}]));
const quoteFile = id => ({fileId: id, crmFileId: null, category: 'quote', name: 'quote.pdf', kind: 'pdf', size: 69, source: 'production', signed: false, uploadedAt: '2026-11-19T09:36:03+03:00'});
const specs = (quantity = 1) => ({description: 'ORD MOLD', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: 'ORD-1', quantity, designUrl: 'https://x.example/d', notes: ''});
const EXAMPLE = [
  {requestRef: 'e6d8d83d-9c04-4fcc-af41-a2ddf6e089fd', orderNo: 92, designFiles: [], crmRequestId: null, source: 'manual', requestedAt: '2026-11-16T11:30:00+03:00', waitingSince: '2026-11-19T09:36:03+03:00', enteredBy: 'admin@yourrest.org',
    customer: {crmNumber: null, name: 'مصنع تجريبي في التصنيع', address: 'الرياض', city: 'Riyadh - الرياض', erpCode: '6100'}, salesman: {crmMemberId: 'm-12', name: 'مندوب تجريبي'}, specs: specs(2), payment: 'cash', paymentTerms: null, returned: null,
    quoteNo: '', poNo: '', quoteOrPoMissing: false, quoteFiles: [quoteFile('7f18e8f7-69b1-4ef6-916e-6ec185678b8b')], poFiles: [], revision: 4, status: 'confirmed', editable: false, moldSerial: null, productionDate: null, stages: stagesNone(),
    stagesDone: 0, stagesTotal: 7, delivered: false, deliveryDate: null, waitingStep: 'manufacturing', approvals: {required: true, sales: {at: '2026-11-19T09:36:03+03:00', by: 'مدير المبيعات', termsAccepted: null}, production: {at: '2026-11-19T09:36:03+03:00'}, admin: {at: '2026-11-19T09:36:03+03:00'}}, updatedAt: '2026-11-19T09:36:03+03:00'},
  {requestRef: 'bc81f5d5-9824-4eaf-aa5d-178770e4ddf9', orderNo: null, designFiles: [], crmRequestId: null, source: 'manual', requestedAt: '2026-11-12T12:15:00+03:00', waitingSince: '2026-11-19T09:36:03+03:00', enteredBy: 'admin@yourrest.org',
    customer: {crmNumber: null, name: 'مصنع تجريبي ملغى', address: 'الرياض', city: 'Riyadh - الرياض', erpCode: '6100'}, salesman: {crmMemberId: 'm-12', name: 'مندوب تجريبي'}, specs: specs(1), payment: 'cash', paymentTerms: null, returned: null,
    quoteNo: '', poNo: '', quoteOrPoMissing: false, quoteFiles: [quoteFile('ebc01536-1fa0-46c1-8046-d34fcff7adf0')], poFiles: [], revision: 2, status: 'cancelled', editable: false, moldSerial: null, productionDate: null, stages: stagesNone(),
    stagesDone: 0, stagesTotal: 7, delivered: false, deliveryDate: null, waitingStep: 'cancelled', approvals: {required: true, sales: null, production: null, admin: null}, updatedAt: '2026-11-19T09:36:03+03:00'},
  {requestRef: 'b579641a-8791-413b-b34c-b2f2ea669e2c', orderNo: null, designFiles: [], crmRequestId: null, source: 'legacy', requestedAt: '2026-10-20T09:00:00+03:00', waitingSince: null, enteredBy: null,
    customer: {crmNumber: null, name: 'مصنع تجريبي من الشيت', address: 'الرياض', city: 'Riyadh - الرياض', erpCode: '6100'}, salesman: {crmMemberId: '', name: 'مندوب قديم'}, specs: specs(1), payment: 'cash', paymentTerms: null, returned: null,
    quoteNo: '', poNo: '', quoteOrPoMissing: false, quoteFiles: [quoteFile('4667eac6-2994-465c-9ba4-a9843c1deca0')], poFiles: [], revision: 1, status: 'delivered', editable: false, moldSerial: 'YR-SHEET-07', productionDate: null, stages: stagesNone(),
    stagesDone: 0, stagesTotal: 7, delivered: true, deliveryDate: '2026-10-25', waitingStep: 'done', approvals: {required: false, sales: null, production: null, admin: null}, updatedAt: '2026-11-19T09:36:03+03:00'},
];

// ---- 1. reading the route's items
{
  const [making, cancelled, legacy] = EXAMPLE.map(moldOrderItem);
  check([making.source, making.requestRef, making.orderNo, making.crmRequestId, making.status, making.waitingStep, making.editable, making.stagesDone, making.stagesTotal, making.revision],
    ['manual', 'e6d8d83d-9c04-4fcc-af41-a2ddf6e089fd', 92, null, 'confirmed', 'manufacturing', false, 0, 7, 4], 'a manual request in manufacturing: its identity and status');
  check([making.requestedAt, making.waitingSince, making.enteredBy, making.customer, making.salesman, making.specs.quantity, making.payment, making.paymentTerms, making.returned],
    ['2026-11-16T11:30:00+03:00', '2026-11-19T09:36:03+03:00', 'admin@yourrest.org', {crmNumber: null, name: 'مصنع تجريبي في التصنيع', address: 'الرياض', city: 'Riyadh - الرياض', erpCode: '6100'}, {crmMemberId: 'm-12', name: 'مندوب تجريبي'}, 2, 'cash', null, null], 'and what was asked for, as production holds it now');
  check([making.quoteOrPoMissing, making.quoteFiles.map(file => [file.fileId, file.category, file.kind, file.signed]), making.designFiles, making.poFiles], [false, [['7f18e8f7-69b1-4ef6-916e-6ec185678b8b', 'quote', 'pdf', false]], [], []], 'its files, each in its list');
  check(making.approvals, {required: true, sales: {at: '2026-11-19T09:36:03+03:00', by: 'مدير المبيعات'}, production: {at: '2026-11-19T09:36:03+03:00'}, admin: {at: '2026-11-19T09:36:03+03:00'}}, 'its approvals (termsAccepted null is no acknowledgement)');
  check([cancelled.status, cancelled.waitingStep, cancelled.orderNo], ['cancelled', 'cancelled', null], 'a cancelled one, with no number');
  check([legacy.source, legacy.status, legacy.delivered, legacy.deliveryDate, legacy.moldSerial, legacy.approvals.required, legacy.enteredBy, legacy.waitingSince, legacy.salesman.crmMemberId], ['legacy', 'delivered', true, '2026-10-25', 'YR-SHEET-07', false, null, null, ''], 'a legacy one, delivered, needing no approval, its salesman unknown to the CRM');
  check(moldOrderItem({...EXAMPLE[0], requestedAt: '2026-11-16 00:30:00', waitingSince: '2026-11-19 09:36'}).requestedAt, '2026-11-16T00:30:00+03:00', 'a Riyadh time without its offset (the message\'s words) made ISO with +03:00');
  check([moldOrderTime('2026-11-19 09:36'), moldOrderTime('2026-11-19T06:36:00Z'), moldOrderTime('yesterday'), moldOrderTime(null), moldOrderTime('2026-13-45T99:99')], ['2026-11-19T09:36:00+03:00', '2026-11-19T06:36:00Z', null, null, null], 'the times: Riyadh wall time, ISO as it came, nothing that is not one');
  const refused = {noRef: {...EXAMPLE[0], requestRef: undefined}, badRef: {...EXAMPLE[0], requestRef: 'not-a-uuid'}, crm: {...EXAMPLE[0], crmRequestId: 'mr-1'}, crmSource: {...EXAMPLE[0], source: 'crm'}, unknownSource: {...EXAMPLE[0], source: 'import'},
    badStatus: {...EXAMPLE[0], status: 'lost'}, noEditable: {...EXAMPLE[0], editable: undefined}, array: [], none: null, text: 'x'};
  check(Object.fromEntries(Object.entries(refused).map(([key, value]) => [key, moldOrderItem(value)])), Object.fromEntries(Object.keys(refused).map(key => [key, null])), 'what cannot be read: no requestRef or a bad one, a CRM request, an unknown source or status, no editable, not an object');
  check(moldOrderItem({...EXAMPLE[0], crmRequestId: undefined}).crmRequestId, null, 'crmRequestId left out reads as null');
  const missing = answer => moldOrdersRouteMissing(answer);
  check([missing({kind: 'retry', code: 'unknown_route', http: 404}), missing({kind: 'not_found', code: 'not_found', http: 404}), missing({kind: 'retry', code: 'http_404', http: 404}), missing({kind: 'rejected', code: 'invalid_payload', fields: ['route'], http: 400})],
    [true, true, true, true], 'the route missing: 404 whatever its code, or 400 naming only "route"');
  check([missing({kind: 'rejected', code: 'invalid_payload', fields: ['cursor'], http: 400}), missing({kind: 'rejected', code: 'invalid_payload', fields: ['route', 'cursor'], http: 400}), missing({kind: 'retry', code: 'not_configured', http: 503}), missing({kind: 'retry', code: 'timeout', http: 0}), missing(null)],
    [false, false, false, false, false], 'anything else is a failure, not a missing route');
  check([moldOrdersNext(null), moldOrdersNext(undefined), moldOrdersNext('abc'), moldOrdersNext(''), moldOrdersNext(7), moldOrdersNext('x'.repeat(MOLD_ORDERS_CURSOR_MAX)), moldOrdersNext('x'.repeat(MOLD_ORDERS_CURSOR_MAX + 1))], [null, null, 'abc', undefined, undefined, 'x'.repeat(MOLD_ORDERS_CURSOR_MAX), undefined], 'the next page: a text, none on the last; anything else not the contract\'s');
  check(MOLD_ORDERS_MAX_PAGES, 10, 'ten pages a pull at most');
}

// ---- 2. the client against the stand-in
const mock = await startProductsMock({requestRefs: true}), authority = fs.readFileSync(mock.ca);
const viaMock = (url, init) => new Promise((resolve, reject) => {
  const req = httpsRequest(url, {method: init.method, headers: init.headers, ca: authority, signal: init.signal}, res => {
    const parts = []; res.on('data', part => parts.push(part)); res.on('end', () => { const bytes = Buffer.concat(parts); resolve({status: res.statusCode, headers: new Headers(Object.entries(res.headers).filter(([, value]) => typeof value === 'string')), arrayBuffer: async () => bytes}); });
  });
  req.on('error', error => reject(init.signal?.aborted ? Object.assign(new Error('timeout'), {name: 'TimeoutError'}) : error)); req.end(init.body);
});
globalThis.fetch = viaMock;
const config = moldConfig({YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret});
const ordersCalls = () => mock.state.calls.filter(call => call.route === 'orders').length;
try {
  let answer = await callProducts(config, 'orders', {}, {fetch: viaMock});
  check([answer.kind, answer.code, answer.http, moldOrdersRouteMissing(answer)], ['retry', 'unknown_route', 404, true], 'the products application before its release: 404 unknown_route, read as the route missing');
  mock.setOrders(true);
  const fromCrm = mock.registerManual({description: 'will be linked'});
  fromCrm.crmRequestId = 'mr-linked';
  const deleted = mock.registerManual({description: 'deleted there'}); deleted.deleted = true;
  for (let n = 0; n < 5; n++) mock.registerManual({description: 'manual ' + n, requestedAt: '2026-11-0' + (n + 1) + 'T09:00:00.000Z', salesmanId: n % 2 ? 'rep' : ''});
  mock.registerLegacy({description: 'sheet', requestedAt: '2026-10-01T09:00:00.000Z'});
  mock.setOrdersPageSize(4);
  answer = await callProducts(config, 'orders', {}, {fetch: viaMock});
  check([answer.kind, answer.json.requests.length, typeof answer.json.next, answer.json.requests.map(item => item.specs.description)], ['ok', 4, 'string', ['manual 4', 'manual 3', 'manual 2', 'manual 1']], 'the first page: four, newest asked for first, and a cursor');
  const signed = mock.state.calls.filter(call => call.route === 'orders').at(-1);
  check([signed.signed, JSON.parse(signed.body)], [true, {}], 'signed like the other routes, the body {}');
  const second = await callProducts(config, 'orders', {cursor: answer.json.next}, {fetch: viaMock});
  check([second.json.requests.map(item => [item.specs.description, item.source]), second.json.next], [[['manual 0', 'manual'], ['sheet', 'legacy']], null], 'the last page: the rest, the legacy one too, and next null');
  check([...answer.json.requests, ...second.json.requests].every(item => item.crmRequestId === null && moldOrderItem(item)), true, 'every item without a crmRequestId, and read by the CRM; no CRM request, no deleted one');
  const bad = await callProducts(config, 'orders', {cursor: 'p4.0000000000000000'}, {fetch: viaMock});
  check([bad.kind, bad.code, bad.fields, bad.http, moldOrdersRouteMissing(bad)], ['rejected', 'invalid_payload', ['cursor'], 400, false], 'a cursor it did not give: 400 invalid_payload [\'cursor\'], a failure');
  check([moldOrderItem(answer.json.requests[2]).salesman.crmMemberId, moldOrderItem(answer.json.requests[1]).salesman.crmMemberId], ['', 'rep'], 'the salesman\'s CRM id as stored, "" for none');
  // The next section starts from an empty production.
  for (const row of [...mock.state.byRef.values()]) mock.state.byRef.delete(row.requestRef);
} catch (error) { await mock.stop(); throw error; }

// ---- 3. the CRM customer of an order
const customerRow = (id, number, code, region = 'الشرقية') => ({id, kind: 'customer', parentId: null, data: {name: 'مصنع ' + id, region, internalCode: number ? 'YR-C-' + String(number).padStart(6, '0') : '', code}});
const records = [customerRow('east1', 27, 'ERP-27'), customerRow('east2', 28, '٦١٠٠'), customerRow('west1', 40, 'ERP-40', 'الغربية'), customerRow('twinA', 41, 'TWIN'), customerRow('twinB', 42, 'TWIN'), {id: 'visit', kind: 'activity', parentId: 'east1', data: {}}];
{
  const find = lib.moldOrderCustomers(records);
  check([find({crmNumber: 27}), find({crmNumber: 40, erpCode: 'ERP-27'}), find({crmNumber: 999, erpCode: 'erp-27'}), find({crmNumber: null, erpCode: '6100'}), find({crmNumber: null, erpCode: ' ٦١٠٠ '})],
    ['east1', 'west1', 'east1', 'east2', 'east2'], 'by its Yourrest number first; else its ERP code as the CRM compares codes (case, Arabic digits, spaces)');
  check([find({crmNumber: null, erpCode: 'TWIN'}), find({crmNumber: null, erpCode: ''}), find({crmNumber: null}), find({crmNumber: 999, erpCode: 'NOBODY'})], ['', '', '', ''], 'a code two customers carry, none, or one nobody carries: no customer');
  check(lib.moldOrderCustomers(records, [{codeKey: 'TWIN', customerId: 'twinB', version: 1}])({crmNumber: null, erpCode: 'twin'}), 'twinB', 'a code mapping chooses one of the two, as the mold route links a typed code');
}

// ---- 4. who sees which order
const member = (id, role, supervisorId = '', regionScope = 'eastern', name = id) => ({id, role, supervisorId, regionScope, name, email: id + '@x', branch: 'b', active: 1, target: 0});
const team = [member('owner', 'admin', '', 'all'), member('sm', 'manager'), member('sm2', 'manager'), member('smAll', 'manager', '', 'all'), member('smW', 'manager', '', 'western'),
  member('sup', 'supervisor', 'sm'), member('rep', 'rep', 'sup', 'eastern', 'أنور عبد الحكيم'), member('rep2', 'rep', 'sm2'), member('orphan', 'rep'), member('csm', 'customer_service_manager', 'sm'), member('cs', 'customer_service', 'csm')];
const REGION = {eastern: 'الشرقية', western: 'الغربية'};
const inRegion = id => { const scope = team.find(entry => entry.id === id).regionScope; return new Set(records.filter(row => row.kind === 'customer' && (scope === 'all' || row.data.region === REGION[scope])).map(row => row.id)); };
const readerOf = id => ({me: team.find(entry => entry.id === id), members: team, regionCustomerIds: inRegion(id), all: records, customerIdentityState: {mappings: []}});
{
  const find = lib.moldOrderCustomers(records);
  const order = (salesman, customer) => ({salesman: {crmMemberId: salesman, name: 'x'}, customer});
  const cases = {
    repEast: order('rep', {crmNumber: 27}), repWest: order('rep', {crmNumber: 40}), rep2East: order('rep2', {crmNumber: 27}), orphanEast: order('orphan', {crmNumber: 27}),
    noneEast: order('', {crmNumber: 27}), noneByCode: order('', {crmNumber: null, erpCode: '6100'}), noneUnknown: order('', {crmNumber: null, erpCode: 'NOBODY'}), ghostEast: order('ghost', {crmNumber: 27}),
    csEast: order('cs', {crmNumber: 27}), smOwn: order('sm', {crmNumber: 40}), noneWest: order('', {crmNumber: 40}),
  };
  const sees = who => Object.entries(cases).filter(([, item]) => lib.canReadMoldOrder(item, find(item.customer), readerOf(who))).map(([name]) => name);
  check(sees('owner'), Object.keys(cases), 'the administrator: every order');
  check(sees('rep'), ['repEast', 'repWest'], 'a representative: only the orders production names him on, whatever the customer\'s region; never another\'s, nor one with no salesman');
  check(sees('rep2'), ['rep2East'], 'another representative: his own only');
  check(sees('orphan'), ['orphanEast'], 'a representative in no team: his own only');
  check(sees('sup'), ['repEast'], 'a supervisor: his representatives\' within his regions');
  check(sees('csm'), ['csEast'], 'a customer-service manager: his team\'s');
  check(sees('cs'), ['csEast'], 'customer service: its own only');
  check(sees('sm'), ['repEast', 'orphanEast', 'noneEast', 'noneByCode', 'ghostEast', 'csEast', 'smOwn'], 'a sales manager: his team\'s in his regions, his own anywhere, and what he would approve (no team, no salesman or one the CRM does not know, customer service) in his regions; never another manager\'s team, nor a customer not found');
  check(sees('sm2'), ['rep2East', 'orphanEast', 'noneEast', 'noneByCode', 'ghostEast', 'csEast'], 'the other manager of the region: his team\'s and what he would approve, never the first manager\'s team');
  check(sees('smAll'), ['repWest', 'orphanEast', 'noneEast', 'noneByCode', 'noneUnknown', 'ghostEast', 'csEast', 'smOwn', 'noneWest'], 'a manager of every region: what no team holds anywhere, a team\'s whose manager cannot approve it (a western customer of an eastern manager), and an order whose customer was not found; never a team whose manager can approve it');
  check(sees('smW'), ['repWest', 'smOwn', 'noneWest'], 'a western manager: the western orders nobody else can approve (no team, an eastern manager\'s own or team\'s), not an order whose customer was not found');
  check(lib.canReadMoldOrder(cases.repEast, find(cases.repEast.customer), readerOf('rep2')), false, 'a representative never sees another representative\'s order');
}

// ---- 5. the view a reader receives
const parsed = EXAMPLE.map(moldOrderItem);
{
  const members = [...team, member('m-12', 'rep', 'sup', 'eastern', 'مندوب الشرقية')];
  const [making, cancelled, legacy] = parsed.map(item => lib.moldOrderView(item, members));
  check([making.id, making.source, making.requestRef, making.memberId, making.memberName, making.salesmanName, making.enteredBy, making.cancelled, making.sending, making.can, making.returned, making.quotePo],
    ['order:e6d8d83d-9c04-4fcc-af41-a2ddf6e089fd', 'manual', 'e6d8d83d-9c04-4fcc-af41-a2ddf6e089fd', 'm-12', 'مندوب الشرقية', 'مندوب تجريبي', 'admin@yourrest.org', false, {state: 'sent'}, {approve: false}, null, {missing: false}], 'read-only, named by its requestRef (never a CRM id), its salesman the CRM\'s member by name');
  check([making.customerName, making.customerErpCode, making.crmNumber, making.customerCity, making.requestedAt, making.remote.orderNo, making.remote.status, making.remote.waitingStep, making.remote.crmRequestId, making.remote.customer],
    ['مصنع تجريبي في التصنيع', '6100', null, 'Riyadh - الرياض', '2026-11-16T11:30:00+03:00', 92, 'confirmed', 'manufacturing', '', {crmNumber: null, name: 'مصنع تجريبي في التصنيع', erpCode: '6100'}], 'its customer and production\'s status');
  check(making.quoteFiles.map(file => [file.href, file.viewable, file.category]), [['/api/mold-requests/design-file?ref=e6d8d83d-9c04-4fcc-af41-a2ddf6e089fd&file=7f18e8f7-69b1-4ef6-916e-6ec185678b8b', true, 'quote']], 'its files through the CRM by its requestRef');
  check([legacy.memberId, legacy.memberName, legacy.requestedAt, legacy.remote.delivered], ['', 'مندوب قديم', '2026-10-20T09:00:00+03:00', true], 'a salesman the CRM does not know: no member, production\'s name');
  check(lib.moldOrderView({...parsed[0], salesman: {crmMemberId: 'ghost', name: 'شبح'}}, members).memberId, '', 'a member id the CRM does not hold: no member');
  check(lib.moldOrderView({...parsed[0], status: 'cancelled', returned: {by: 'finance', reason: 'السبب', at: null, correctedAt: null}}, members).returned, null, 'returned by finance, but cancelled: not shown as returned');
  check([lib.moldOrderView({...parsed[0], payment: 'deferred', paymentTerms: 'advance_credit_limit'}, members).paymentTerms, lib.moldOrderView({...parsed[0], payment: 'cash', paymentTerms: 'advance_credit_limit'}, members).paymentTerms], ['advance_credit_limit', null], 'the payment\'s terms with a deferred payment only');
  check(lib.moldOrderView({...parsed[0], quoteOrPoMissing: undefined}, members).quotePo, null, 'no quotation flag from production: none');
  check(cancelled.remote.status, 'cancelled', 'cancelled in production');
}

// ---- 6. the filters with the products application's requests
{
  const stages = done => Object.fromEntries(MOLD_STAGES.map((key, index) => [key, {done: index < done, at: null}]));
  const crmRemote = extra => ({crmRequestId: 'x', orderNo: null, status: 'received', editable: false, moldSerial: null, productionDate: null, stages: stages(0), stagesDone: 0, stagesTotal: 7, delivered: false, deliveryDate: null, updatedAt: null, revision: 1, waitingStep: 'sales', waitingSince: null, ...extra});
  const can = {edit: false, cancel: false, resend: false, approve: false, withdraw: false, attach: false, deleteFile: false};
  const sent = {state: 'sent', outbox: null, attempts: 0, nextAttemptAt: null, lastAttemptAt: null, error: null};
  const crm = (id, requestedAt, extra = {}) => ({id, memberId: 'rep', memberName: 'أنور عبد الحكيم', customerId: 'east1', customerName: 'مصنع ' + id, customerAddress: '', customerCity: '', crmNumber: 27, customerErpCode: '', requestedAt, legacyOrderNo: null,
    specs: {description: 'قالب', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: '', quantity: 1, designUrl: '', notes: ''}, payment: 'cash', paymentTerms: null, unconfirmed: false, cancelled: false, cancelReason: '', cancelReasons: [],
    sending: sent, remote: crmRemote(), remoteAt: null, editable: false, can, version: 1, designFiles: [], quotePo: null, signature: null, designRequired: false, signing: {awaits: false, link: null, via: null, stamped: false, copies: 0, skipped: [], after: []}, returned: null, ...extra});
  const requests = [crm('A', '2026-11-18T09:00:00.000Z'), crm('B', '2026-11-10T09:00:00.000Z'), crm('C', 'garbage')];
  const orders = parsed.map(item => lib.moldOrderView(item, team));
  const merged = filters.moldMergeOrders(requests, orders);
  check(merged.map(entry => entry.id), ['A', 'order:e6d8d83d-9c04-4fcc-af41-a2ddf6e089fd', 'order:bc81f5d5-9824-4eaf-aa5d-178770e4ddf9', 'B', 'order:b579641a-8791-413b-b34c-b2f2ea669e2c', 'C'],
    'the merge by the day asked for: the CRM\'s list and production\'s each in its own order (a CRM time that cannot be read stays where its list put it)');
  check(filters.moldMergeOrders(requests, []).map(entry => entry.id), ['A', 'B', 'C'], 'no orders: the CRM\'s list exactly as before');
  check(merged.map(entry => filters.isMoldOrder(entry)), [false, true, true, false, true, false], 'which entry is a request of the products application');
  check(merged.map(entry => filters.moldSourceKey(entry)), ['crm', 'manual', 'manual', 'crm', 'legacy', 'crm'], 'each entry\'s source');
  const none = filters.MOLD_NO_FILTERS, run = set => filters.filterMoldRequests(merged, {...none, ...set}, true).map(entry => entry.id);
  const choices = filters.moldFilterChoices(merged, true, none);
  check(choices.sources.map(option => [option.key, option.label]), [['crm', ['الـCRM', 'The CRM']], ['manual', ['تطبيق المنتجات', 'The products application']], ['legacy', ['الشيت القديم', 'The old workbook']]], '«المصدر»: the three sources the list holds, in that order, Arabic and English');
  check([filters.moldFilterChoices(requests, true, none).sources.length, filters.moldFilterChoices(orders.slice(0, 2), true, none).sources.length], [1, 1], 'one source: the select is not drawn (sources.length 1)');
  check([run({source: 'crm'}), run({source: 'manual'}), run({source: 'legacy'})], [['A', 'B', 'C'], [orders[0].id, orders[1].id], [orders[2].id]], 'each source alone');
  const one = filters.moldFilterChoices(requests, true, {...none, source: 'manual'});
  check([one.filters.source, one.active], ['', 0], 'a source chosen while the list holds only one: let go');
  check(filters.moldFilterChoices(merged, true, {...none, source: 'legacy', query: 'x'}).active, 2, 'the source counts among the filters set');
  check(choices.members, [{id: 'rep', name: 'أنور عبد الحكيم'}, {id: 'name:مندوب تجريبي', name: 'مندوب تجريبي'}, {id: 'name:مندوب قديم', name: 'مندوب قديم'}].sort((a, b) => a.name.localeCompare(b.name, 'ar') || a.id.localeCompare(b.id)), '«المندوب»: the CRM\'s requester, and production\'s salesmen the CRM does not know, by name');
  check(run({member: 'name:مندوب قديم'}), [orders[2].id], 'production\'s salesman by name');
  check(run({member: 'rep'}), ['A', 'B', 'C'], 'the CRM\'s requester: as before');
  const withMember = lib.moldOrderView(parsed[0], [...team, member('m-12', 'rep', 'sup', 'eastern', 'أنور عبد الحكيم')]);
  check(filters.moldMemberKey(withMember), 'm-12', 'an order whose salesman the CRM knows: by his member id');
  check([run({status: 'production_cancelled'}), run({status: 'status:delivered'}), run({status: 'status:confirmed'})], [[orders[1].id], [orders[2].id], [orders[0].id]], '«الحالة»: cancelled in production, delivered, approvals complete');
  ok(run({status: 'open'}).includes(orders[0].id) && !run({status: 'open'}).includes(orders[1].id) && !run({status: 'open'}).includes(orders[2].id), '«المفتوحة»: the order in manufacturing, not the cancelled or delivered one');
  check([run({step: 'step:manufacturing'}), run({step: 'stage:laserCutting'})], [[orders[0].id], [orders[0].id]], '«واقف عند»: in manufacturing, at its first stage');
  check(filters.moldStatusKeys(orders[0], false), ['open', 'status:confirmed'], 'the link off says nothing of an order (it has no sending of its own)');
  check([run({from: '2026-11-16', to: '2026-11-16'}), run({from: '2026-10-01', to: '2026-10-31'}), run({from: '2026-11-11', to: '2026-11-17'})], [[orders[0].id], [orders[2].id], [orders[0].id, orders[1].id]], 'the days, Riyadh\'s, both ends included');
  const midnight = lib.moldOrderView(moldOrderItem({...EXAMPLE[0], requestedAt: '2026-11-16 00:30:00'}), team);
  check(filters.filterMoldRequests([midnight], {...none, from: '2026-11-16', to: '2026-11-16'}, true).length, 1, 'a request asked for at 00:30 Riyadh (no offset) is that Riyadh day');
  check([run({query: '92'}), run({query: 'YR-SHEET'}), run({query: '٦١٠٠'}), run({query: 'قديم'})], [[orders[0].id], [orders[2].id], [orders[0].id, orders[1].id, orders[2].id], [orders[2].id]], '«بحث»: the order number, the serial, the ERP code in Arabic digits, the salesman');
  const returned = lib.moldOrderView({...parsed[0], status: 'received', waitingStep: 'sales', returned: {by: 'finance', reason: 'الحد الائتماني', at: null, correctedAt: null}}, team);
  check([filters.filterMoldRequests([...merged, returned], {...none, returned: true}, true).map(entry => entry.id), filters.moldStatusKeys(returned, true)], [[returned.id], ['open', 'status:received', 'returned']], '«أعادتها المالية» counts an order finance returned');
  check(filters.moldFilterChoices([], true, none), {statuses: [], steps: [], members: [], sources: [], filters: none, active: 0}, 'an empty list offers nothing');
  check(filters.moldCardStatus(orders[2]), ['تم التسليم', 'Delivered'], 'the card\'s chip of an order: where production says it is');
}

// ---- 7. the server: the pull and each reader's orders
try {
  const link = config, east = 27;
  mock.setOrdersPageSize(2);
  for (const [n, salesmanId] of ['rep', 'rep2', '', 'cs', 'rep'].entries()) mock.registerManual({customerNo: east, customerName: 'مصنع east1', description: 'order ' + n, salesmanId, requestedAt: '2026-11-1' + n + 'T09:00:00.000Z'});
  mock.registerLegacy({customerErpCode: 'ERP-40', description: 'west legacy'});
  mock.addRawOrder({requestRef: 'not-a-uuid', source: 'manual', status: 'received'});
  mock.addRawOrder({...EXAMPLE[0], crmRequestId: 'mr-from-crm', requestRef: '11111111-1111-4111-8111-111111111111'});
  const before = ordersCalls();
  let pulled = await server.pullProductionOrders({link, force: true});
  check([pulled.missing, pulled.error, pulled.items.length, pulled.unreadable, pulled.truncated, ordersCalls() - before], [false, null, 6, 1, false, 4], 'every page read (four of two), the CRM\'s item left out, the unreadable one counted');
  pulled = await server.pullProductionOrders({link});
  check([pulled.items.length, ordersCalls() - before], [6, 4], 'kept a minute: no second call');
  const mine = async who => (await server.moldOrdersFor(readerOf(who), link));
  const descriptions = answer => answer.items.map(item => item.specs.description).sort();
  const owner = await mine('owner');
  check([descriptions(owner), owner.unreadable, owner.error, owner.truncated], [['order 0', 'order 1', 'order 2', 'order 3', 'order 4', 'west legacy'], 1, null, undefined], 'the administrator: every order, and how many could not be read');
  const rep = await mine('rep');
  check([descriptions(rep), rep.unreadable, Object.keys(rep).sort()], [['order 0', 'order 4'], undefined, ['at', 'error', 'items']], 'a representative: his own only, and nothing of the unreadable');
  check([descriptions(await mine('rep2')), descriptions(await mine('sup')), descriptions(await mine('csm')), descriptions(await mine('sm'))],
    [['order 1'], ['order 0', 'order 4'], ['order 3'], ['order 0', 'order 2', 'order 3', 'order 4']], 'another representative, the supervisor, the customer-service manager, the sales manager (his team, no salesman, customer service)');
  check(descriptions(await mine('smAll')), ['order 2', 'order 3', 'west legacy'], 'a manager of every region: no team\'s, and the legacy order found by its ERP code');
  check((await server.moldOrderFor(readerOf('rep'), link, rep.items[0].requestRef))?.requestRef, rep.items[0].requestRef, 'one of his orders by its requestRef');
  check(await server.moldOrderFor(readerOf('rep2'), link, rep.items[0].requestRef), null, 'not another representative\'s');
  // A request listed on two pages (one added while the pages were read) is shown once.
  mock.addRawOrder((await callProducts(config, 'orders', {}, {fetch: viaMock})).json.requests[0]);
  pulled = await server.pullProductionOrders({link, force: true});
  check(pulled.items.length, 6, 'an order listed twice: shown once');
  // A failure keeps the last copy, with why.
  mock.state.down = true;
  pulled = await server.pullProductionOrders({link, force: true});
  check([pulled.items.length, pulled.error?.code, pulled.missing, pulled.at === null], [6, 'network', false, false], 'production unreachable: the last copy, with the reason and its time');
  const failed = await mine('rep');
  check([descriptions(failed), failed.error.code], [['order 0', 'order 4'], 'network'], 'each reader\'s orders from it, with the reason');
  const callsDown = mock.state.calls.length;
  await server.pullProductionOrders({link});
  check(mock.state.calls.length, callsDown, 'a failure waits half a minute before the next call');
  mock.state.down = false;
  server.forgetProductionOrders();
  mock.state.down = true;
  pulled = await server.pullProductionOrders({link, force: true});
  check([pulled.items, pulled.error?.code, (await mine('owner')).items], [[], 'network', []], 'a failure with no copy: none, with the reason');
  mock.state.down = false;
  // A cursor given twice: not the contract's answer.
  mock.answerNext('orders', 200, {requests: [EXAMPLE[0]], next: 'again'});
  mock.answerNext('orders', 200, {requests: [EXAMPLE[1]], next: 'again'});
  pulled = await server.pullProductionOrders({link, force: true});
  check([pulled.error?.code, pulled.items.length], ['bad_response', 0], 'the same cursor twice: a failure, nothing taken from it');
  // A cursor production refuses midway (it changed meanwhile): a failure, the copy kept.
  await server.pullProductionOrders({link, force: true});
  mock.answerNext('orders', 200, {requests: [EXAMPLE[0]], next: 'p2.0000000000000000'});
  pulled = await server.pullProductionOrders({link, force: true});
  check([pulled.error?.code, pulled.items.length], ['invalid_payload', 6], 'a refused cursor midway: a failure, the last good copy kept');
  // More than ten pages: the first ten, cut, and the administrator told.
  for (let n = 0; n < 10; n++) mock.answerNext('orders', 200, {requests: [{...EXAMPLE[0], requestRef: '22222222-2222-4222-8222-' + String(n).padStart(12, '0')}], next: 'page-' + (n + 1)});
  const beforeCut = ordersCalls();
  pulled = await server.pullProductionOrders({link, force: true});
  check([pulled.items.length, pulled.truncated, pulled.error, ordersCalls() - beforeCut], [10, true, null, 10], 'more than ten pages: ten read, the list cut');
  check([(await mine('owner')).truncated, (await mine('smAll')).truncated], [true, undefined], 'the administrator is told it was cut; nobody else');
  // The route missing: nothing, remembered, production not asked again.
  mock.setOrders(false);
  const beforeMissing = ordersCalls();
  pulled = await server.pullProductionOrders({link, force: true});
  check([pulled.missing, pulled.items, pulled.error], [true, [], null], 'the products application without the route: nothing to show');
  check([await mine('owner'), await mine('rep'), ordersCalls() - beforeMissing], [null, null, 1], 'each reader gets null (the page as it was), and production is not asked again');
  mock.setOrders(true);
  mock.answerNext('orders', 400, {error: {code: 'invalid_payload', message: 'Unknown route.', fields: ['route']}});
  pulled = await server.pullProductionOrders({link, force: true});
  check(pulled.missing, true, 'its 400 naming only "route" is the route missing too');
  check(await server.moldOrdersFor(readerOf('owner'), {ok: false, reason: 'not_configured'}), null, 'the production link off: null');
  server.forgetProductionOrders();
  check((await mine('rep')).items.length, 2, 'once the route answers again (after the remembered while), the orders are back');
} finally { await mock.stop(); }

// ---- 8. the page asks for them, the route only then; every text in Arabic with its English pair
{
  const page = fs.readFileSync(path.join(root, 'app/mold-requests.tsx'), 'utf8'), route = fs.readFileSync(path.join(root, 'app/api/mold-requests/route.ts'), 'utf8'), file = fs.readFileSync(path.join(root, 'app/api/mold-requests/design-file/route.ts'), 'utf8');
  ok(page.includes("'/api/mold-requests?refs=1&orders=1'"), 'this release\'s page asks with orders=1');
  ok(route.includes("withOrders=!id&&url.searchParams.get('orders')==='1'") && route.includes('withOrders?moldOrdersFor(c,link):undefined'), 'the route pulls them only for orders=1, never for ?id=');
  ok(file.includes('moldOrderFor(c,link,ref)'), 'a file of an order by ?ref= for whoever may read it');
  const pairs = [...Object.values(lib.MOLD_ORDER_TEXT).flatMap(value => Array.isArray(value) ? [value] : Object.values(value)), filters.MOLD_FILTER_TEXT.source, filters.MOLD_FILTER_TEXT.allSources, ...Object.values(filters.MOLD_SOURCE_NAMES)];
  check(pairs.filter(([ar, en]) => !/[؀-ۿ]/.test(ar) || /[؀-ۿ]/.test(en)), [], 'every pair: Arabic, and English without Arabic');
  check([lib.moldOrdersUnreadableText(3, say('ar')), lib.moldOrdersUnreadableText(3, say('en'))], ['يوجد 3 طلب من تطبيق المنتجات تعذّرت قراءته ولا يظهر هنا؛ أبلغ مدير الإنتاج.', '3 request(s) of the products application could not be read and are not shown; tell the production manager.'], 'the unreadable note in both languages');
  check(lib.MOLD_ORDER_TEXT.badge, {manual: ['مسجّل في تطبيق المنتجات · للعرض فقط', 'Registered in the products application · view only'], legacy: ['من الشيت القديم · للعرض فقط', 'From the old workbook · view only']}, 'the cards\' marks');
}

console.log(JSON.stringify({ok: true, checks, scope: 'mold requests of the products application: reading orders, the stand-in, the customer, who sees which, the view, the filters, the server\'s pull and cache, the page and route', productionDataUsed: false}));
process.exit(0);
