// Mold requests on the server, the parts no other unit test reaches (the owner's unit-test plan, 2026-11-22): lib/mold-requests-server.ts
// called directly (no build: tests/mold-requests-http.mjs and its siblings cover the routes; tests/mold-design-files-server.mjs the design
// files and their routes) on an in-memory SQLite with every migration and an in-memory object store, transpiled into .sites-runtime as
// that test transpiles it (the coverage measure merges both), against the stand-in production API over HTTPS. The clock starts at a
// fixed moment and runs. A customer typed as written and not in the CRM (the owner, 2026-11-21: «الخانة دى للكتابة فقط»): kept while
// production's update is not known (asked once, nothing sent, the next try in six hours), sent once production answers with an ERP code
// (every request waiting for it made due at once), and refused for its missing Yourrest number by a rolled-back production (not final,
// six hours). Every other answer of a send: off, a new request refused (the timetable stops, still editable), production unreachable (the
// §6 timetable), a change to a request production holds refused for its data (final, back to what production accepted), production_only
// with what production accepted known and with it lost (kept, marked unconfirmed), another lock; a cancellation production already shows
// (settled without a call), one production never had, one its production manager restored with the same reason (not cancelled,
// audited), one refused because production started. What the CRM learns (the signed flag, the update of 2026-11-10). A design file: none,
// held, a quotation's file before the update, its bytes missing, a name production would refuse, two in flight already, a deletion
// refused for a file never sent, the ONE signed document refused for its size. A release that finds the send claimed by another sender
// (waits for it, or tries once itself), the retry timer, a pull that failed (kept half a minute), finance's return (audited once), the
// sales manager's waiting list within his regions, and production's own orders read by two pages at once and past their deadline. Made-up
// requests, customers and members only; the secret is the stand-in's own made-up value.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {request as httpsRequest} from 'node:https';
import ts from 'typescript';
import {moldConfig} from '../portable/mold-client.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';

const NativeDate = Date, origin = NativeDate.parse('2026-11-20T09:00:00.000Z'), started = NativeDate.now(); let jump = 0;
const nowMs = () => origin + (NativeDate.now() - started) + jump;
globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [nowMs()])); } static now() { return nowMs(); } };
const iso = (ms = nowMs()) => new NativeDate(ms).toISOString();

const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'mold-requests-server-unit-')), seen = new Set();
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
fs.writeFileSync(path.join(out, 'env.mjs'), 'export const env=new Proxy({},{get:(_,key)=>globalThis.moldServerEnv?.[key]});');
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
compile('lib/mold-requests-server.ts');
const S = await import(path.join(out, 'lib/mold-requests-server.mjs'));

let checks = 0;
const plain = value => value === undefined ? value : JSON.parse(JSON.stringify(value));
const eq = (actual, expected, message) => { assert.deepEqual(plain(actual), plain(expected), message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

const sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON');
for (const name of fs.readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) sql.exec(fs.readFileSync('drizzle/' + name, 'utf8'));
class Statement {
  constructor(query, args = []) { this.query = query; this.args = args; }
  bind(...args) { return new Statement(this.query, args); }
  execute() { const statement = sql.prepare(this.query); if (statement.columns().length) return {results: statement.all(...this.args), meta: {changes: 0}}; return {results: [], meta: {changes: Number(statement.run(...this.args).changes)}}; }
  async first() { return sql.prepare(this.query).get(...this.args) || null; }
  async all() { return this.execute(); }
  async run() { return this.execute(); }
}
const DB = {prepare: query => new Statement(query), batch: async statements => { sql.exec('BEGIN IMMEDIATE'); try { const results = statements.map(statement => statement.execute()); sql.exec('COMMIT'); return results; } catch (error) { sql.exec('ROLLBACK'); throw error; } }};
const objects = new Map();
const store = {async get(key) { const bytes = objects.get(key); return bytes ? {arrayBuffer: async () => bytes.slice().buffer} : null; }, async put(key, bytes) { objects.set(key, new Uint8Array(bytes)); }, async delete(key) { objects.delete(key); }};

const mock = await startProductsMock({now: () => Date.now()});
const authority = fs.readFileSync(mock.ca);
globalThis.fetch = (url, init) => new Promise((resolve, reject) => {
  const req = httpsRequest(url, {method: init.method, headers: init.headers, ca: authority, signal: init.signal}, res => {
    const headers = new Headers(Object.entries(res.headers).flatMap(([key, value]) => Array.isArray(value) ? value.map(item => [key, item]) : [[key, value]]));
    const parts = []; res.on('data', part => parts.push(part)); res.on('end', () => resolve({status: res.statusCode, headers, arrayBuffer: async () => Buffer.concat(parts)}));
  });
  req.on('error', error => reject(init.signal?.aborted ? Object.assign(new Error('timeout'), {name: 'TimeoutError'}) : error));
  req.end(init.body);
});
globalThis.moldServerEnv = {DB, FILES: store, YR_APP_ORIGIN: 'https://crm.example.invalid'};
globalThis.__yourrestMoldRetry = 1; // the retry timer stays off until its own check below
const link = moldConfig({YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret}), off = moldConfig({});
const calls = route => mock.state.calls.filter(call => call.route === route).length;

sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('factory','customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')").run(JSON.stringify({name: 'مصنع تجريبي', region: 'الشرقية', city: 'الدمام'}), iso(), iso());
const factoryNo = Number(sql.prepare("SELECT number FROM crm_customer_numbers WHERE customer_id='factory'").get().number);
const specs = {description: '200*400*27.5TH MM OPEN', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: 'YR099-9', quantity: 1, designUrl: '', notes: ''};
const linked = {crmNumber: factoryNo, name: 'مصنع تجريبي', address: 'الدمام', city: 'Damam - الدمام'};
const typed = {crmNumber: null, name: 'مصنع حر للبلوك', address: 'المنطقة الصناعية', city: 'Riyadh - الرياض', erpCode: 'E-5512'};
const data = (customer = linked, extra = {}) => ({requestedAt: '2026-11-20T11:00:00+03:00', customer, salesman: {crmMemberId: 'rep', name: 'مندوب تجريبي', email: 'rep@example.invalid'}, specs, payment: 'cash', ...extra});
function insert(id, {d = data(), outbox = 'send', next = iso(), accepted = null, remote = null, cancelledAt = null, cancelReason = '', lastAttemptAt = null, lastError = null, customerId = 'factory', remoteAt = null} = {}) {
  sql.prepare('INSERT INTO crm_mold_requests(id,member_id,customer_id,data,accepted,cancelled_at,cancel_reason,outbox,next_attempt_at,last_attempt_at,last_error,remote,remote_at,created_by,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)')
    .run(id, 'rep', customerId, JSON.stringify(d), accepted && JSON.stringify(accepted), cancelledAt, cancelReason, outbox, next, lastAttemptAt, lastError && JSON.stringify(lastError), remote && JSON.stringify(remote), remoteAt, 'rep', iso(), iso());
}
const row = id => { const r = sql.prepare('SELECT * FROM crm_mold_requests WHERE id=?').get(id); return {...r, data: JSON.parse(r.data), accepted: r.accepted && JSON.parse(r.accepted), last_error: r.last_error && JSON.parse(r.last_error), remote: r.remote && JSON.parse(r.remote)}; };
const due = (id, extra = '') => sql.prepare('UPDATE crm_mold_requests SET next_attempt_at=?' + extra + ' WHERE id=?').run(iso(), id);
const send = id => S.sendMoldRequest(DB, id, {link});
let fileSeq = 0;
function addFile(requestId, {name = 'drawing.pdf', bytes = Buffer.from('%PDF-1.4 made-up drawing ' + (++fileSeq)), category = 'design', id = 'mdf-' + randomUUID(), outbox = 'send', deletedAt = null, sentAt = null, objectKey, next = iso(), lastAttemptAt = null} = {}) {
  const key = objectKey === undefined ? 'mold-design/' + requestId + '/' + id : objectKey;
  if (key && objectKey !== null) objects.set(key, new Uint8Array(bytes));
  sql.prepare("INSERT INTO crm_mold_design_files(id,request_id,member_id,name,kind,content_type,size,sha256,object_key,created_at,deleted_at,outbox,next_attempt_at,last_attempt_at,sent_at,version,category) VALUES(?,?,'rep',?,'pdf','application/pdf',?,'x',?,?,?,?,?,?,?,1,?)")
    .run(id, requestId, name, bytes.length, key === undefined ? null : key, iso(NativeDate.parse('2026-11-20T08:00:00.000Z') + fileSeq * 1000), deletedAt, outbox, next, lastAttemptAt, sentAt, category);
  return id;
}
const file = id => { const r = sql.prepare('SELECT * FROM crm_mold_design_files WHERE id=?').get(id); return {...r, last_error: r.last_error && JSON.parse(r.last_error)}; };

try {
  // ---- the link off: nothing sent, nothing pulled
  eq([await S.sendMoldRequest(DB, 'x', {link: off}), await S.sendMoldDesignFile(DB, 'x', {link: off}), await S.sendDueMoldRequests(DB, {link: off}), await S.sendDueMoldDesignFiles(DB, {link: off})],
    [{kind: 'off', code: 'not_configured'}, {kind: 'off', code: 'not_configured'}, 0, 0], 'without the settings: the sends say off, nothing is due');
  eq([await S.pullMoldStatuses(DB, [], {link: off}), (await S.pullPendingApprovals({link: off})).error.code, (await S.pullProductionOrders({link: off})).missing], [null, 'not_configured', true], 'and nothing is pulled');
  eq([await S.sendMoldRequest(DB, 'nothing', {link}), await S.sendMoldDesignFile(DB, 'nothing', {link}), await S.moldDesignFilesByRequest(DB, [])], [{kind: 'none', code: ''}, {kind: 'none', code: ''}, new Map()], 'nothing named: nothing');

  // ---- a customer typed as written, not in the CRM: kept until production is known to take it
  insert('mr-free', {d: data(typed), customerId: ''});
  let outcome = await send('mr-free');
  let stored = row('mr-free');
  eq([outcome, calls('requests'), calls('pending')], [{kind: 'none', code: 'free_customer'}, 0, 1], 'production\'s update not known: asked once what it runs (its waiting list, no request of the CRM held yet), nothing sent');
  eq([stored.next_attempt_at, stored.last_error.code, stored.last_error.notStored, stored.outbox], [iso(NativeDate.parse(stored.last_error.at) + S.MOLD_FREE_CUSTOMER_RETRY_MS), 'free_customer', true, 'send'], 'the next try in six hours, still never sent (editable)');
  eq((await send('mr-free')).code, 'free_customer', 'asked again before its time: still kept, its time unchanged');
  insert('mr-free2', {d: data({...typed, name: 'مصنع حر آخر', erpCode: '٧٧٤١'}), customerId: '', next: iso(nowMs() + 6 * 3600_000), lastError: {code: 'free_customer', http: 0, at: iso(), notStored: true}});
  // A request production holds: the next probe pulls its status, which teaches the CRM the update.
  insert('mr-held');
  eq((await send('mr-held')).kind, 'ok', 'a request for a CRM customer goes as ever');
  mock.setFreeCustomers(true);
  due('mr-free');
  outcome = await send('mr-free');
  eq([outcome.kind, row('mr-free').outbox, mock.row('mr-free').customerErpCode, mock.row('mr-free').customerNo, mock.row('mr-free').customerName], ['ok', null, 'E-5512', null, 'مصنع حر للبلوك'], 'production answers with an ERP code: learned, and the request goes by its name and ERP code exactly as typed, no Yourrest number');
  ok(sql.prepare("SELECT 1 FROM crm_settings WHERE id=?").get(S.MOLD_FREE_CUSTOMERS_SETTING), 'learned once, kept');
  ok(NativeDate.parse(row('mr-free2').next_attempt_at) <= nowMs(), 'every request waiting for it made due at once');
  // Production rolled back (refuses it for its missing number): not final, six hours.
  insert('mr-free3', {d: data({...typed, name: 'مصنع ثالث'}), customerId: ''});
  mock.answerNext('requests', 400, {error: {code: 'invalid_payload', message: 'x', fields: ['customer.crmNumber']}});
  outcome = await send('mr-free3'); stored = row('mr-free3');
  eq([outcome, stored.attempts, stored.last_error.code, stored.last_error.notStored, NativeDate.parse(stored.next_attempt_at) - NativeDate.parse(stored.last_error.at)], [{kind: 'none', code: 'free_customer', fields: ['customer.crmNumber'], sent: 'send'}, 1, 'free_customer', true, S.MOLD_FREE_CUSTOMER_RETRY_MS], 'refused for its missing Yourrest number: kept (never final), tried in six hours, still editable');

  // ---- the other answers of a send
  insert('mr-bad');
  mock.answerNext('requests', 400, {error: {code: 'invalid_payload', message: 'x', fields: ['specs.notes']}});
  outcome = await send('mr-bad'); stored = row('mr-bad');
  eq([outcome.kind, outcome.fields, stored.next_attempt_at, stored.attempts, stored.last_error], ['rejected', ['specs.notes'], null, 1, {code: 'invalid_payload', fields: ['specs.notes'], http: 400, at: stored.last_error.at, notStored: true}], 'a new request refused for its data: the timetable stops, it may still be edited');
  insert('mr-down');
  mock.state.down = true; outcome = await send('mr-down'); mock.state.down = false; stored = row('mr-down');
  eq([outcome.kind, outcome.code, stored.attempts, stored.first_failed_at === stored.last_error.at, NativeDate.parse(stored.next_attempt_at) > NativeDate.parse(stored.last_error.at)], ['retry', 'network', 1, true, true], 'production unreachable: tried again on the timetable');
  // A change to a request production holds, refused for its data: dropped for good, back to what production accepted.
  insert('mr-held2'); await send('mr-held2');
  const accepted = row('mr-held2').accepted;
  sql.prepare("UPDATE crm_mold_requests SET data=json_set(data,'$.specs.notes','ملاحظة بعد الإرسال'),outbox='send',next_attempt_at=? WHERE id='mr-held2'").run(iso());
  mock.answerNext('requests', 413, {error: {code: 'payload_too_large', message: 'x'}});
  outcome = await send('mr-held2'); stored = row('mr-held2');
  eq([outcome.kind, stored.data, stored.outbox, stored.last_error.final, stored.last_error.code], ['rejected', accepted, null, true, 'payload_too_large'], 'a change of a request production holds, refused: final, the data back to what production accepted');
  // production_only: the data production accepted known (back to it), and lost (kept, marked unconfirmed).
  sql.prepare("UPDATE crm_mold_requests SET data=json_set(data,'$.specs.quantity',3),outbox='send',next_attempt_at=? WHERE id='mr-held2'").run(iso());
  outcome = await send('mr-held2'); stored = row('mr-held2');
  eq([outcome.kind, outcome.reason, stored.data.specs.quantity, stored.last_error.code, stored.last_error.reason, stored.last_error.final, stored.remote?.crmRequestId], ['locked', 'production_only', 1, 'request_locked', 'production_only', true, 'mr-held2'], 'production_only: the change dropped, back to production\'s data, its status stored');
  insert('mr-lost'); await send('mr-lost');
  sql.prepare("UPDATE crm_mold_requests SET accepted=NULL,remote=NULL,remote_at=NULL,data=json_set(data,'$.specs.quantity',2),outbox='send',next_attempt_at=?,last_attempt_at=?,last_error=? WHERE id='mr-lost'").run(iso(), iso(nowMs() - 5000), JSON.stringify({code: 'timeout', http: 0, at: iso(nowMs() - 1000)}));
  outcome = await send('mr-lost'); stored = row('mr-lost');
  eq([outcome.reason, stored.data.specs.quantity, stored.accepted.unconfirmed, stored.accepted.specs.quantity, stored.outbox], ['production_only', 2, true, 2, null], 'the first answer lost: the CRM\'s refused copy kept, marked unconfirmed (production holds the request)');
  insert('mr-locked'); await send('mr-locked');
  sql.prepare("UPDATE crm_mold_requests SET data=json_set(data,'$.specs.notes','x'),outbox='send',next_attempt_at=? WHERE id='mr-locked'").run(iso());
  mock.answerNext('requests', 409, {error: {code: 'request_locked', message: 'x'}});
  outcome = await send('mr-locked'); stored = row('mr-locked');
  eq([outcome.kind, stored.data.specs.notes, stored.last_error.final, Object.hasOwn(stored.last_error, 'reason')], ['locked', '', true, false], 'another lock: the change dropped too, with no reason');

  // ---- cancellations
  insert('mr-c1', {outbox: 'cancel', cancelledAt: iso(), cancelReason: 'تكرار', remote: {crmRequestId: 'mr-c1', orderNo: 1, status: 'cancelled', editable: false, stages: {}, stagesDone: 0, stagesTotal: 7, delivered: false, revision: 2}, accepted: data()});
  const before = calls('cancel');
  eq([await send('mr-c1'), calls('cancel') - before, row('mr-c1').outbox], [{kind: 'ok', code: '', sent: 'cancel'}, 0, null], 'production already shows it cancelled: settled as delivered without a call');
  insert('mr-c2', {outbox: 'cancel', cancelledAt: iso(), cancelReason: 'لم يصل'});
  eq([(await send('mr-c2')).kind, row('mr-c2').outbox, row('mr-c2').last_error], ['ok', null, null], 'production never had it: the cancellation complete in the CRM');
  insert('mr-c3'); await send('mr-c3');
  sql.prepare("UPDATE crm_mold_requests SET outbox='cancel',cancelled_at=?,cancel_reason='العميل ألغى',next_attempt_at=? WHERE id='mr-c3'").run(iso(), iso());
  eq((await send('mr-c3')).kind, 'ok', 'cancelled at production');
  mock.restore('mr-c3');
  sql.prepare("UPDATE crm_mold_requests SET outbox='cancel',cancelled_at=?,cancel_reason='العميل ألغى',next_attempt_at=?,remote=json_set(remote,'$.status','received') WHERE id='mr-c3'").run(iso(), iso());
  outcome = await send('mr-c3'); stored = row('mr-c3');
  eq([outcome, stored.cancelled_at, stored.cancel_reason, stored.last_error.code, stored.last_error.reason, stored.outbox], [{kind: 'restored', code: 'same_reason', fields: [], sent: 'cancel'}, null, '', 'restored', 'same_reason', null], 'the production manager restored it and the same reason came again: not cancelled here either, a new reason asked for');
  const restoredAudit = sql.prepare("SELECT actor,detail FROM crm_audit WHERE record_id='mr-c3' AND action='mold-request:cancel-restored'").get();
  eq([restoredAudit.actor, JSON.parse(restoredAudit.detail).reason], [S.MOLD_PRODUCTION_ACTOR, 'العميل ألغى'], 'audited, by production');
  insert('mr-c4'); await send('mr-c4'); mock.produce('mr-c4', {confirmed: true});
  sql.prepare("UPDATE crm_mold_requests SET outbox='cancel',cancelled_at=?,cancel_reason='متأخر',next_attempt_at=? WHERE id='mr-c4'").run(iso(), iso());
  outcome = await send('mr-c4'); stored = row('mr-c4');
  eq([outcome.kind, outcome.sent, stored.cancelled_at, stored.last_error.code, Object.hasOwn(stored.last_error, 'final'), stored.remote.status], ['locked', 'cancel', null, 'request_locked', false, 'confirmed'], 'production started: the cancellation withdrawn (not final for a cancellation), production\'s status shown');

  // ---- what the CRM learns
  eq([await S.moldSignedFlagKnown(DB), await S.noteMoldSignedFlag(DB, [{fileId: 1}]), await S.noteMoldSignedFlag(DB, [null, {fileId: 2, crmFileId: null, name: 'a.pdf', kind: 'pdf', size: 1, source: 'crm', uploadedAt: null, signed: false}], iso())], [false, false, true], 'the signed flag learned from the first file object carrying a boolean "signed"');
  eq([await S.moldSignedFlagKnown(DB), await S.noteMoldSignedFlag(DB, [{fileId: 3, crmFileId: null, name: 'b.pdf', kind: 'pdf', size: 1, source: 'crm', uploadedAt: null, signed: true}])], [true, false], 'once, never again');
  eq([await S.moldNov10Known(DB), await S.noteMoldQuotePo(DB, [{paymentTerms: null}]), await S.moldNov10Known(DB), await S.noteMoldQuotePo(DB, [{paymentTerms: null, returned: null}]), await S.moldNov10Known(DB)], [false, false, false, false, true], 'the update of 2026-11-10 learned from an answer with both keys (null included)');

  // ---- design files
  insert('mr-new');
  const heldFile = addFile('mr-new');
  eq(await S.sendMoldDesignFile(DB, heldFile, {link}), {kind: 'none', code: 'held'}, 'a file of a request production does not hold yet: held');
  const quoteFile = addFile('mr-held', {category: 'quote', name: 'Q-1.pdf'});
  eq(await S.sendMoldDesignFile(DB, quoteFile, {link}), {kind: 'none', code: 'quote_po_update'}, 'a quotation\'s file before production\'s update is known: kept');
  const missing = addFile('mr-held', {objectKey: null});
  eq([await S.sendMoldDesignFile(DB, missing, {link}), file(missing).last_error.code, file(missing).last_error.final, file(missing).next_attempt_at], [{kind: 'rejected', code: 'file_missing'}, 'file_missing', true, null], 'its bytes gone from the store: refused for good');
  const badName = addFile('mr-held', {name: 'bad\u0001name.pdf'});
  eq([(await S.sendMoldDesignFile(DB, badName, {link})).code, file(badName).last_error.final], ['invalid_payload', true], 'a name production would refuse: refused for good before sending');
  const three = [addFile('mr-held'), addFile('mr-held'), addFile('mr-held')];
  mock.state.delayMs = 250;
  const sentThree = await Promise.all(three.map(id => S.sendMoldDesignFile(DB, id, {link})));
  mock.state.delayMs = 0;
  eq(sentThree.map(result => result.kind).sort(), ['busy', 'ok', 'ok'], 'two files in flight at once at most: the third waits (busy)');
  const neverSent = addFile('mr-held', {outbox: 'delete', deletedAt: iso()});
  mock.answerNext('design-file-delete', 400, {error: {code: 'invalid_payload', message: 'x', fields: ['crmFileId']}});
  const refusedDelete = await S.sendMoldDesignFile(DB, neverSent, {link});
  eq([refusedDelete.kind, file(neverSent).outbox, file(neverSent).deleted_at, file(neverSent).last_error.final], ['rejected', 'send', null, true], 'a deletion refused for a file never sent: kept as not sent, never to be sent');
  const document = addFile('mr-held', {id: 'mdc-' + randomUUID() + '-doc', name: 'طلب القالب - موقّع.pdf'});
  mock.answerNext('design-files', 413, {error: {code: 'payload_too_large', message: 'x'}});
  const errors = []; const realError = console.error; console.error = (...args) => errors.push(args.join(' '));
  const tooBig = await S.sendMoldDesignFile(DB, document, {link});
  console.error = realError;
  eq([tooBig.kind, file(document).last_error.http, file(document).last_error.final], ['rejected', 413, true], 'the ONE signed document refused for its size: refused for good (the per-file copies are made instead: tests/mold-sign-server-unit.mjs)');

  // ---- a release that finds the send claimed by another sender
  insert('mr-race'); await send('mr-race');
  sql.prepare("UPDATE crm_mold_requests SET outbox='send',accepted=NULL,last_attempt_at=?,next_attempt_at=? WHERE id='mr-race'").run(iso(), iso(nowMs() + 60_000)); // another sender's claim, its answer not stored yet
  const raceFile = addFile('mr-race');
  setTimeout(() => sql.prepare("UPDATE crm_mold_requests SET outbox=NULL,accepted=data,next_attempt_at=NULL WHERE id='mr-race'").run(), 300);
  const released = await S.releaseMoldRequest(DB, 'mr-race', {link, waitMs: 3000});
  eq([released.outcome.kind, released.files.get(raceFile)?.kind], ['ok', 'ok'], 'the other sender\'s send arrived meanwhile: its answer waited for, then the files go here');
  insert('mr-race2', {lastAttemptAt: iso(), next: iso(nowMs() + 60_000)});
  setTimeout(() => sql.prepare("UPDATE crm_mold_requests SET next_attempt_at=?,last_error=? WHERE id='mr-race2'").run(iso(), JSON.stringify({code: 'network', http: 0, at: iso(nowMs() + 1000)})), 300);
  const toldOutcomes = [];
  const second = await S.releaseMoldRequest(DB, 'mr-race2', {link, waitMs: 3000, onRequest: told => toldOutcomes.push(told.kind)});
  eq([second.outcome.kind, toldOutcomes, row('mr-race2').outbox], ['ok', ['ok'], null], 'the other sender failed: one try of its own, which goes');
  insert('mr-race3', {lastAttemptAt: iso(), next: iso(nowMs() + 60_000)});
  eq((await S.releaseMoldRequest(DB, 'mr-race3', {link, waitMs: 0})).outcome.kind, 'busy', 'no time to wait: busy, the timetable takes it');

  // ---- the retry timer: once a process, a check at once
  const intervals = []; const realInterval = globalThis.setInterval;
  globalThis.setInterval = (fn, ms) => { const timer = {fn, ms, unref() {}}; intervals.push(timer); return timer; };
  try {
    delete globalThis.__yourrestMoldRetry;
    S.keepMoldRetrying(); S.keepMoldRetrying();
    eq([intervals.length, intervals[0].ms], [1, 60_000], 'a check every minute, never two timers (the link off here: nothing sent)');
  } finally { globalThis.setInterval = realInterval; globalThis.__yourrestMoldRetry = 1; }

  // ---- a pull that failed is kept half a minute; finance's return audited once
  mock.state.down = true;
  const failure = await S.pullMoldStatuses(DB, [row2('mr-held')], {link, force: true});
  const count = mock.state.calls.length;
  const again = await S.pullMoldStatuses(DB, [{...row2('mr-held'), remoteAt: null}], {link}); // never pulled: stale
  mock.state.down = false;
  eq([failure.code, again === failure, mock.state.calls.length - count], ['network', true, 0], 'a failed pull: the same failure for half a minute, production not asked');
  mock.setNov10(true);
  insert('mr-fin'); await send('mr-fin');
  mock.approve('mr-fin', 'sales'); mock.approve('mr-fin', 'production'); mock.financeReturn('mr-fin', 'ناقص ختم العميل على عرض السعر');
  jump += 31_000;
  eq(await S.pullMoldStatuses(DB, [row2('mr-fin')], {link, force: true}), null, 'pulled');
  await S.pullMoldStatuses(DB, [row2('mr-fin')], {link, force: true});
  const returned = sql.prepare("SELECT actor,detail FROM crm_audit WHERE record_id='mr-fin' AND action='mold-request:returned'").all();
  eq([returned.length, returned[0].actor, JSON.parse(returned[0].detail).reason, JSON.parse(returned[0].detail).label], [1, S.MOLD_PRODUCTION_ACTOR, 'ناقص ختم العميل على عرض السعر', 'أعادته المالية'], 'finance\'s return audited once, with its reason, however often it is pulled');

  // ---- the sales manager's waiting list within his regions
  mock.registerManual({customerNo: factoryNo, customerName: 'مصنع تجريبي'});
  mock.registerManual({customerNo: factoryNo + 50, customerName: 'مصنع خارج المنطقة'});
  const member = (id, role, extra = {}) => ({id, name: 'عضو ' + id, email: id + '@example.invalid', role, branch: 'الرئيسي', supervisorId: '', regionScope: 'all', active: 1, target: 0, ...extra});
  const manager = member('sm', 'manager', {regionScope: 'eastern'}), members = [manager, member('rep', 'rep', {supervisorId: 'sm', regionScope: 'eastern'})];
  const pending = await S.moldPendingFor({me: manager, db: DB, members, regionCustomerIds: new Set(['factory'])}, link, {force: true});
  const names = pending.items.map(item => item.customer.name);
  ok(names.includes('مصنع تجريبي') && !names.includes('مصنع خارج المنطقة'), 'a request registered in production: shown by its customer\'s Yourrest number within his regions only');
  eq(await S.moldPendingFor({me: member('rep', 'rep'), db: DB, members, regionCustomerIds: new Set()}, link), null, 'anyone but a sales manager: no waiting list');
  jump += 61_000; mock.state.down = true; // the copy a minute old, then a failed call
  const failed = await S.pullPendingApprovals({link, force: true}), countAfter = mock.state.calls.length;
  const kept = await S.pullPendingApprovals({link});
  mock.state.down = false;
  eq([failed.error.code, kept.error, mock.state.calls.length - countAfter, kept.items.length > 0], ['network', failed.error, 0, true], 'a failed list: the copy from before with the failure, production not asked for half a minute');

  // ---- production's own orders: two pages at once, and past the deadline
  mock.setOrders(true); mock.setOrdersPageSize(1);
  mock.registerLegacy({customerName: 'مصنع من الشيت ١', requestedAt: '2026-10-20T06:00:00.000Z'});
  mock.registerLegacy({customerName: 'مصنع من الشيت ٢', requestedAt: '2026-10-21T06:00:00.000Z'});
  const first = S.pullProductionOrders({link, force: true}), second2 = S.pullProductionOrders({link, force: true});
  const [a, b] = await Promise.all([first, second2]);
  eq([a.items.length > 1, a === b || JSON.stringify(a) === JSON.stringify(b), a.error], [true, true, null], 'two pages opened at once: one pull, every page read');
  const slow = (url, init) => { if (String(url).includes('route=orders')) jump += 16_000; return globalThis.fetch(url, init); };
  const late = await S.pullProductionOrders({link, force: true, fetch: slow});
  eq([late.error?.code, late.missing], ['timeout', false], 'past the deadline of one pull: the copy kept, with a timeout');
} finally { await mock.stop(); }

function row2(id) { return {id, ...(() => { const r = sql.prepare('SELECT * FROM crm_mold_requests WHERE id=?').get(id); return {memberId: r.member_id, customerId: r.customer_id, data: JSON.parse(r.data), accepted: r.accepted && JSON.parse(r.accepted), remote: r.remote && JSON.parse(r.remote), remoteAt: r.remote_at, outbox: r.outbox, cancelledAt: r.cancelled_at}; })()}; }

console.log(JSON.stringify({ok: true, checks}));
