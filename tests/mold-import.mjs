// The historical mold-request link tool (portable/mold-import.mjs) on an isolated SQLite with every migration and the stand-in
// production API seeded with imported legacy orders: --compare tells Yourrest numbers from ERP codes; --dry-run lists what would be
// linked and what is skipped and why, without writing; --apply links at production first and saves the CRM request accepted (with
// its status); a second run changes nothing; failures (unknown legacy order, linked elsewhere, production down) save nothing.
// Synthetic rows only: no real customer, representative or sheet is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {request as httpsRequest} from 'node:https';
import {DatabaseSync} from 'node:sqlite';
import {main, sameName, plan, readCrm, readSource} from '../portable/mold-import.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';

let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mold-import-'));
process.on('exit', () => fs.rmSync(work, {recursive: true, force: true}));
const database = path.join(work, 'crm.sqlite'), sourceFile = path.join(work, 'source.json');
const db = new DatabaseSync(database);
for (const file of fs.readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join('drizzle', file), 'utf8'));
const now = '2026-11-01T08:00:00.000Z';
const member = (id, name, role = 'rep') => db.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,active,target,created_at,region_scope) VALUES(?,?,?,?,?,'الرئيسي',1,0,?,'eastern')").run(id, 'u-' + id, id + '@yourrest.org', name, role, now);
member('r1', 'مندوب أول'); member('r2', 'مندوب   ثانى'); member('r3', 'مندوب مكرر'); member('r4', 'مندوب مكرر'); member('sup', 'مشرف', 'supervisor');
const customer = (id, code) => db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'r1','الرئيسي',?,?,?,1,'fixture')").run(id, JSON.stringify({name: 'مصنع ' + id, city: 'الدمام', address: 'حي ' + id, code}), now, now);
// Yourrest numbers follow insertion: c1=1, c2=2, c3=3, c4=4, c5=5. ERP codes: c1 '3' (another customer's Yourrest number), c2 'E-2',
// c3 and c4 share '77' (ambiguous), c5 '5' (the same as its own number).
customer('c1', '3'); customer('c2', 'E-2'); customer('c3', '77'); customer('c4', '77'); customer('c5', '5');
const numbers = Object.fromEntries(db.prepare('SELECT customer_id AS id, number FROM crm_customer_numbers').all().map(row => [row.id, row.number]));
eq(numbers, {c1: 1, c2: 2, c3: 3, c4: 4, c5: 5}, 'Yourrest numbers in insertion order');
const specs = {description: '200*400*27.5TH MM OPEN', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: 'YR001-1', quantity: 1, designUrl: 'YR001-1', notes: ''};
const row = (legacyOrderNo, crmNumber, salesmanName, extra = {}) => ({legacyOrderNo, requestedAt: '2026-04-19T13:45:47+03:00', customer: {crmNumber, nameRaw: 'x', address: '', cityRaw: ''}, salesmanName, specs: {...specs, ...extra}, production: {}, dataIssues: []});
fs.writeFileSync(sourceFile, JSON.stringify({requests: [
  row(1, 1, 'مندوب أول', {designUrl: 'https://drive.google.com/d/1'}), row(2, 2, ' مندوب ثانى '), row(3, 3, 'مندوب أول'), row(4, 77, 'مندوب أول'),
  row(5, 5, 'مندوب أول'), row(6, 99, 'مندوب أول'), row(7, 1, 'مندوب غير موجود'), row(8, 2, 'مندوب مكرر'), row(9, 4, 'مندوب أول', {moldWidth: 50})
]}));
db.close();

// ---- names and the source
eq([sameName(' مندوب   ثانى '), sameName('مندوب ـثانى')], ['مندوب ثانى', 'مندوب ثانى'], 'spaces and tatweel do not make two names different');
eq(sameName('مندوب ثاني') === sameName('مندوب ثانى'), false, 'letters do: no guessing between ي and ى');
const bad = path.join(work, 'bad.json');
fs.writeFileSync(bad, JSON.stringify({requests: [row(1, 1, 'x'), row(1, 2, 'x')]}));
assert.throws(() => readSource(bad), /distinct legacyOrderNo/);checks++;

// ---- compare: which code the sheet's customer number is
process.env.MOLD_IMPORT_DATABASE = database;
const quiet = {log: () => {}};
const compared = await main(['--source', sourceFile, '--compare'], quiet);
eq([compared.readOnly, compared.rows, compared.yourrest, compared.erp, compared.both], [true, 9, 7, 2, 2], 'counts by code');
eq([compared.onlyYourrest, compared.onlyErp, compared.neither, compared.erpAmbiguous], [[1, 2, 7, 8, 9], [], [6], [4]], 'which orders match which code (row 3: Yourrest 3 and ERP 3 of another customer)');

// ---- dry run with the Yourrest key: nothing is written
const before = fs.statSync(database).mtimeMs;
const dry = await main(['--source', sourceFile, '--key', 'yourrest', '--dry-run'], quiet);
eq(dry.toLink, [1, 2, 3, 5], 'linked: exact customer and exact representative only');
eq(dry.skipped, {customer_not_found: [4, 6], representative_not_found: [7], representative_ambiguous: [8], specs_invalid: [9]}, 'every skipped order with its reason');
eq(dry.designLinksDropped, 3, 'a mold code in the design-link column is not kept as a link');
eq(fs.statSync(database).mtimeMs, before, 'the dry run does not touch the database');
ok(!JSON.stringify(dry).includes('مصنع') && !JSON.stringify(dry).includes('مندوب'), 'no names in the report by default');
const named = await main(['--source', sourceFile, '--key', 'yourrest', '--dry-run', '--show-names'], quiet);
ok(named.toLink[0].includes('مصنع c1') && named.toLink[0].includes('مندوب أول'), 'names only when asked for, for the owner\'s terminal');
const erp = await main(['--source', sourceFile, '--key', 'erp', '--dry-run'], quiet);
eq([erp.toLink, erp.skipped.customer_ambiguous, erp.skipped.customer_not_found], [[3, 5], [4], [1, 2, 6, 7, 8, 9]], 'the ERP key matches other customers: shown before anything is linked');

// ---- apply: production first, then the CRM request saved as accepted
const mock = await startProductsMock();
mock.seedLegacy(5);
const authority = fs.readFileSync(mock.ca);
const fetch = (url, init) => new Promise((resolve, reject) => {
  const req = httpsRequest(url, {method: init.method, headers: init.headers, ca: authority, signal: init.signal}, res => { const parts = []; res.on('data', part => parts.push(part)); res.on('end', () => { const bytes = Buffer.concat(parts); resolve({status: res.statusCode, arrayBuffer: async () => bytes}); }); });
  req.on('error', reject); req.end(init.body);
});
try {
  process.env.MOLD_IMPORT_PRODUCTS_URL = mock.url; process.env.MOLD_IMPORT_PRODUCTS_SECRET = mock.state.secret;
  // Order 3 was linked by someone else already: production refuses (409), nothing is saved for it.
  mock.state.byOrder.get(3).crmRequestId = 'mr-elsewhere';
  const applied = await main(['--source', sourceFile, '--key', 'yourrest', '--apply'], {fetch, ...quiet});
  eq(applied.linked, [1, 2, 5], 'linked at production');
  eq(applied.failed.map(item => [item.legacy, item.code]), [[3, 'request_locked']], 'an order linked elsewhere is reported, not taken');
  const read = new DatabaseSync(database, {readOnly: true});
  const saved = read.prepare('SELECT id, member_id, customer_id, legacy_order_no, data, accepted, outbox, remote FROM crm_mold_requests ORDER BY legacy_order_no').all();
  eq(saved.map(item => [item.id, item.member_id, item.customer_id, item.legacy_order_no, item.outbox]), [['mr-legacy-1', 'r1', 'c1', 1, null], ['mr-legacy-2', 'r2', 'c2', 2, null], ['mr-legacy-5', 'r1', 'c5', 5, null]], 'saved: accepted, nothing waiting to send');
  const first = JSON.parse(saved[0].data);
  eq([first.customer, first.salesman.crmMemberId, first.specs.designUrl, first.requestedAt], [{crmNumber: 1, name: 'مصنع c1', address: 'حي c1', city: 'الدمام'}, 'r1', 'https://drive.google.com/d/1', '2026-04-19T13:45:47+03:00'], 'the CRM customer by its Yourrest number, the original date');
  eq(saved[0].accepted, saved[0].data, 'accepted as sent');
  eq([JSON.parse(saved[0].remote).orderNo, JSON.parse(saved[0].remote).crmRequestId], [1, 'mr-legacy-1'], 'production\'s status stored: the legacy order number is kept');
  eq(mock.state.byOrder.get(1).crmRequestId, 'mr-legacy-1', 'production linked its imported order to the CRM id');
  read.close();
  const sent = JSON.parse(mock.state.calls.find(call => call.route === 'requests').body);
  eq([sent.legacyOrderNo, sent.crmRequestId], [1, 'mr-legacy-1'], 'the link is a contract request carrying legacyOrderNo');

  // ---- a second run: what is linked is skipped; production refusing order 3 still saves nothing
  const calls = mock.state.calls.length;
  const again = await main(['--source', sourceFile, '--key', 'yourrest', '--apply'], {fetch, ...quiet});
  eq([again.linked, again.skipped.already_linked], [[], [1, 2, 5]], 'nothing linked twice');
  eq(mock.state.calls.length - calls, 1, 'only the refused order is asked again');

  // ---- production down: nothing saved, the failure reported
  mock.state.byOrder.get(3).crmRequestId = null; mock.state.down = true;
  const down = await main(['--source', sourceFile, '--key', 'yourrest', '--apply'], {fetch, ...quiet});
  eq([down.linked, down.failed.map(item => item.legacy)], [[], [3]], 'production unreachable: reported');
  const count = new DatabaseSync(database, {readOnly: true});
  eq(count.prepare('SELECT COUNT(*) AS n FROM crm_mold_requests').get().n, 3, 'and nothing saved for it');
  count.close();
  mock.state.down = false;
  eq((await main(['--source', sourceFile, '--key', 'yourrest', '--apply'], {fetch, ...quiet})).linked, [3], 'linked once production answers');

  // ---- refusals before anything happens
  await assert.rejects(main(['--source', sourceFile, '--key', 'yourrest'], quiet), /--dry-run or --apply/);checks++;
  await assert.rejects(main(['--source', sourceFile, '--key', 'name', '--dry-run'], quiet), /--key yourrest or --key erp/);checks++;
  delete process.env.MOLD_IMPORT_PRODUCTS_SECRET;
  await assert.rejects(main(['--source', sourceFile, '--key', 'yourrest', '--apply'], {fetch, ...quiet}), /not configured/);checks++;
  const crm = readCrm(new DatabaseSync(database, {readOnly: true}));
  eq(plan(readSource(sourceFile), crm, 'yourrest').filter(item => item.skip === 'already_linked').map(item => item.legacy), [1, 2, 3, 5], 'the plan sees the linked orders');
} finally { await mock.stop(); }
console.log(JSON.stringify({ok: true, checks, productionDataUsed: false, realProductionTested: false}));
