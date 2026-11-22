// The CRM's customers list for the products application on the server, unit by unit (the owner's unit-test plan, 2026-11-22):
// lib/mold-customers-server.ts called directly (no build: tests/mold-customers-http.mjs covers the routes that start it) on an in-memory
// SQLite with every migration, compiled into .sites-runtime so the coverage measure sees it, against the stand-in production API
// (scripts/lib/products-mock.mjs) over HTTPS, the clock fixed. Who is listed (a Yourrest number and a name: a broken record and one with no
// name left out, the ERP code from the customer's code, the city as production's sheet writes it, Arabic digits and hidden direction marks
// cleaned as production stores them); what one check sends (the first full list, nothing when nothing changed, a change, a day later, a
// forced one), the customers deleted since the last send as active:false (once each, never one still listed, a broken line left out, a
// removal in the minutes before the last send read again), production unreachable (nothing recorded, the next check sends), an exception
// (a failure, never thrown), two checks at once (one send), a list over production's limit (upsert batches, nobody deactivated), the last
// send read back after a restart (and an unreadable one: a full again), and the timers that keep it in step. The audit line holds counts
// and a fingerprint only: no name, no address, no ERP code. Made-up customers only; the secret is the stand-in's own made-up value.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {request as httpsRequest} from 'node:https';
import ts from 'typescript';
import {moldConfig} from '../portable/mold-client.mjs';
import {MOLD_CUSTOMERS_MAX} from '../portable/mold-rules.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';

const NativeDate = Date; let clock = NativeDate.parse('2026-11-20T09:00:00.000Z');
globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } };
const iso = (ms = clock) => new NativeDate(ms).toISOString();

const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'mold-customers-server-unit-')), seen = new Set();
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
fs.writeFileSync(path.join(out, 'env.mjs'), 'export const env=new Proxy({},{get:(_,key)=>globalThis.customersTestEnv?.[key]});');
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
compile('lib/mold-customers-server.ts');
const modulePath = path.join(out, 'lib/mold-customers-server.mjs');
let M = await import(modulePath);

let checks = 0;
const plain = value => value === undefined ? value : JSON.parse(JSON.stringify(value));
const eq = (actual, expected, message) => { assert.deepEqual(plain(actual), plain(expected), message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

const sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON');
for (const name of fs.readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) sql.exec(fs.readFileSync('drizzle/' + name, 'utf8'));
let failNext = false;
const DB = {prepare(query) {
  if (failNext) { failNext = false; throw new Error('the database is locked'); }
  let args = [];
  const statement = {bind(...values) { args = values; return statement; }, async all() { return {results: sql.prepare(query).all(...args)}; }, async first() { return sql.prepare(query).get(...args) ?? null; }, async run() { const result = sql.prepare(query).run(...args); return {meta: {changes: Number(result.changes)}}; }};
  return statement;
}};
const customer = (id, record) => {
  sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')").run(id, typeof record === 'string' ? '{}' : JSON.stringify(record), iso(), iso());
  // A record whose data cannot be read (the numbering trigger reads the JSON): written past the triggers, as a damaged row would be.
  if (typeof record === 'string') for (const [statement, ...args] of [["UPDATE crm_records SET kind='damaged' WHERE id=?", id], ['UPDATE crm_records SET data=? WHERE id=?', record, id], ["UPDATE crm_records SET kind='customer' WHERE id=?", id]]) sql.prepare(statement).run(...args);
  return Number(sql.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').get(id).number);
};
const edit = (id, record) => sql.prepare('UPDATE crm_records SET data=? WHERE id=?').run(JSON.stringify(record), id);
const removal = (detail, at) => sql.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)').run('removed-' + Math.random(), M.MOLD_CUSTOMERS_RECORD, 'owner', M.MOLD_CUSTOMERS_REMOVED, typeof detail === 'string' ? detail : JSON.stringify(detail), at);
const sends = () => sql.prepare('SELECT detail,created_at AS at FROM crm_audit WHERE record_id=? AND action=? ORDER BY created_at,rowid').all(M.MOLD_CUSTOMERS_RECORD, M.MOLD_CUSTOMERS_ACTION).map(row => { let detail; try { detail = JSON.parse(row.detail); } catch { detail = {unreadable: row.detail}; } return {...detail, at: row.at}; });

const mock = await startProductsMock();
const authority = fs.readFileSync(mock.ca);
const fetchVia = (url, init) => new Promise((resolve, reject) => {
  const req = httpsRequest(url, {method: init.method, headers: init.headers, ca: authority, signal: init.signal}, res => {
    const headers = new Headers(Object.entries(res.headers).flatMap(([key, value]) => Array.isArray(value) ? value.map(item => [key, item]) : [[key, value]]));
    const parts = []; res.on('data', part => parts.push(part)); res.on('end', () => resolve({status: res.statusCode, headers, arrayBuffer: async () => Buffer.concat(parts)}));
  });
  req.on('error', error => reject(init.signal?.aborted ? Object.assign(new Error('timeout'), {name: 'TimeoutError'}) : error));
  req.end(init.body);
});
const link = moldConfig({YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret});
const lastBody = () => JSON.parse(mock.state.calls.filter(call => call.route === 'customers').at(-1).body);
const sync = (extra = {}) => M.syncMoldCustomers(DB, link, {now: () => iso(), fetch: fetchVia, ...extra});

try {
  // ---- who is listed
  const n1 = customer('c-east', {name: '  مصنع\t   الشرقية ', address: 'حي الصناعية الثانية', city: 'الدمام', code: ' ١٤٦ '});
  const n2 = customer('c-west', {name: 'مصنع جدة', city: 'Jeddah - جده'});
  customer('c-broken', '{not json');
  customer('c-noname', {name: ' \t  ', city: 'الرياض'});
  const n5 = customer('c-far', {name: 'مصنع بعيد', address: 'ن'.repeat(320), city: 'تبوك', code: 'C-' + '9'.repeat(60)});
  sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('v-1','activity','c-east','rep','الرئيسي','{\"name\":\"زيارة\"}',?,?,1,'fixture')").run(iso(), iso());
  const list = await M.moldCustomerList(DB);
  eq(list.map(entry => entry.crmNumber), [n1, n2, n5], 'every customer with a Yourrest number and a name, by number; a broken record and one whose name is only spaces left out; an activity never');
  eq(list[0], {crmNumber: n1, name: 'مصنع الشرقية', address: 'حي الصناعية الثانية', city: 'Damam - الدمام', erpCode: '146', active: true}, 'the name with its spaces and tab made one space, the city as the sheet writes it, the ERP code from the code (Arabic digits Latin)');
  eq([list[1].city, list[1].erpCode, Object.hasOwn(list[1], 'address')], ['Jeddah - جده', '', false], 'no code: an empty ERP code (production keeps none); no address: none sent');
  eq([[...list[2].address].length, list[2].city, list[2].erpCode], [300, 'تبوك', ''], 'an address cut at 300 characters; a city not of the sheet kept as written; a code over production\'s limit sent empty');

  // ---- the link off: nothing
  eq(await M.syncMoldCustomers(DB, moldConfig({}), {}), {sent: false, reason: 'not_configured'}, 'without the link settings: nothing sent');
  eq(await M.syncMoldCustomers(DB, moldConfig({YR_PRODUCTS_API_URL: 'http://plain.example.invalid', YR_PRODUCTS_SECRET: 'x'.repeat(40)}), {}), {sent: false, reason: 'invalid_url'}, 'an address that is not https: nothing sent');

  // ---- the first send, then nothing while nothing changed
  let result = await sync();
  eq(result, {sent: true, reason: 'first', count: 3, result: {received: 3, inserted: 3, updated: 0, deactivated: 0, activeCustomers: 3}}, 'the first check: the whole list as full');
  eq(lastBody(), {mode: 'full', customers: list}, 'the body is the list, exactly');
  const hash = createHash('sha256').update(JSON.stringify(list)).digest('hex');
  eq(sends().at(-1), {label: 'إرسال قائمة العملاء لتطبيق الإنتاج', mode: 'full', calls: 1, count: 3, removed: 0, sheetCities: 2, hash, received: 3, inserted: 3, updated: 0, deactivated: 0, activeCustomers: 3, at: iso()}, 'one audit line: counts, the sheet\'s cities and the fingerprint');
  ok(!/مصنع|الصناعية|146/.test(JSON.stringify(sends())), 'no name, no address, no ERP code in the audit');
  clock += 10 * 60_000;
  eq(await sync(), {sent: false, reason: 'unchanged', count: 3}, 'nothing changed: nothing sent');
  const calls = mock.state.calls.length;

  // ---- a change, a forced send, a day later
  edit('c-west', {name: 'مصنع جدة الجديد', city: 'Jeddah - جده', code: 'J-5'});
  clock += 60_000;
  result = await sync();
  eq([result.reason, result.result.updated, lastBody().customers.find(entry => entry.crmNumber === n2)], ['changed', 1, {crmNumber: n2, name: 'مصنع جدة الجديد', city: 'Jeddah - جده', erpCode: 'J-5', active: true}], 'a customer edited: the whole list again, the change in it');
  clock += 60_000;
  eq((await sync({force: true})).reason, 'daily', 'forced with nothing changed: sent, said as the daily one');
  clock += 24 * 3600_000 - 1;
  eq((await sync()).reason, 'unchanged', 'a day less a millisecond: nothing');
  clock += 1;
  eq((await sync()).reason, 'daily', 'a day after the last send: the whole list again');

  // ---- the customers deleted since: active:false with the list, once each
  const lastAt = sends().at(-1).at;

  sql.prepare("DELETE FROM crm_records WHERE id='c-far'").run();
  removal({crmNumber: n5, name: 'مصنع بعيد', address: 'شارع', city: 'تبوك'}, iso(clock - 1000));
  removal({crmNumber: n5, name: 'مصنع بعيد', address: 'شارع', city: 'تبوك'}, iso(clock - 500));
  removal({crmNumber: n1, name: 'مصنع الشرقية', city: 'الدمام'}, iso(clock - 400));
  removal('{broken', iso(clock - 300));
  removal({crmNumber: 999, name: 'قديم جدًا'}, iso(NativeDate.parse(lastAt) - 6 * 60_000));
  removal({crmNumber: 998, name: 'قبيل الإرسال', city: 'Riyadh - الرياض'}, iso(NativeDate.parse(lastAt) - 4 * 60_000));
  clock += 60_000;
  result = await sync();
  const sent = lastBody().customers;
  eq([result.reason, sends().at(-1).removed, sent.filter(entry => !entry.active).map(entry => entry.crmNumber)], ['changed', 2, [998, n5]], 'deleted: sent with active:false, oldest removal first, once each; one still listed never; a broken line left out; one written just before the last send read again; an older one not');
  eq(sent.find(entry => entry.crmNumber === n5), {crmNumber: n5, name: 'مصنع بعيد', address: 'شارع', city: 'تبوك', active: false}, 'with its name, address and city, without an ERP code (production keeps it)');
  eq(mock.state.customers.get(n5).active, false, 'production deactivated it');

  // ---- production unreachable: nothing recorded, the next check sends
  edit('c-east', {name: 'مصنع الشرقية', city: 'الدمام', code: '146', address: 'عنوان جديد'});
  const before = sends().length;
  mock.state.down = true; clock += 60_000;
  result = await sync();
  eq([result.sent, result.reason, result.error, result.count, sends().length], [false, 'failed', 'network', 2, before], 'production down: a failure with its code, no audit line');
  mock.state.down = false; clock += 60_000;
  eq((await sync()).sent, true, 'back: the change made meanwhile goes');
  mock.answerNext('customers', 400, {error: {code: 'invalid_payload', message: 'x', fields: ['customers.0.name']}});
  clock += 60_000; edit('c-east', {name: 'مصنع الشرقية ٢', city: 'الدمام'});
  eq(await sync(), {sent: false, reason: 'failed', error: 'invalid_payload', count: 2}, 'a refusal: a failure, tried at the next check');

  // ---- an exception is a failure, never thrown; two checks at once are one
  failNext = true;
  eq(await sync(), {sent: false, reason: 'failed', error: 'the database is locked'}, 'an exception: a failure');
  clock += 60_000;
  const one = sync(), two = sync();
  ok(one === two, 'a check that comes while one runs waits for it (the same promise)');
  eq((await one).sent, true, 'and it sends once');
  ok(mock.state.calls.length > calls, 'production was called');

  // ---- a list over production's limit: upsert batches, nobody deactivated that time
  const insert = sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')");

  sql.exec('BEGIN'); for (let n = 0; n < MOLD_CUSTOMERS_MAX; n++) { insert.run('bulk-' + n, '{"name":"م' + n + '"}', iso(), iso()); } sql.exec('COMMIT');
  clock += 60_000;
  result = await sync();
  const last = sends().at(-1);
  eq([result.sent, last.mode, last.calls, last.count, result.result.deactivated], [true, 'upsert', 2, MOLD_CUSTOMERS_MAX + 2, 0], 'over 20000 customers: two upsert batches, nobody deactivated');
  eq(mock.state.calls.filter(call => call.route === 'customers').slice(-2).map(call => JSON.parse(call.body).mode), ['upsert', 'upsert'], 'no final full (production would refuse it)');
  sql.exec("DELETE FROM crm_records WHERE id LIKE 'bulk-%'");

  // ---- the last send read back after a restart, and an unreadable one
  M = await import(modulePath + '?restart=1');
  clock += 60_000;
  eq((await M.syncMoldCustomers(DB, link, {now: () => iso(), fetch: fetchVia})).reason, 'changed', 'after a restart: the fingerprint of the last send read from the audit (the bulk customers gone: changed)');
  clock += 60_000;
  eq((await M.syncMoldCustomers(DB, link, {now: () => iso(), fetch: fetchVia})).reason, 'unchanged', 'and nothing after it');
  sql.prepare('UPDATE crm_audit SET detail=? WHERE record_id=? AND action=?').run('{unreadable', M.MOLD_CUSTOMERS_RECORD, M.MOLD_CUSTOMERS_ACTION);
  M = await import(modulePath + '?restart=2');
  eq((await M.syncMoldCustomers(DB, link, {now: () => iso(), fetch: fetchVia})).reason, 'first', 'the last send unreadable after a restart: the whole list as a first send');

  // ---- the timers: a check every ten minutes and one shortly after a change, never two timers
  const intervals = [], timeouts = [], cleared = [];
  const realInterval = globalThis.setInterval, realTimeout = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  globalThis.setInterval = (fn, ms) => { const timer = {fn, ms, unref() { timer.unref = true; return timer; }}; intervals.push(timer); return timer; };
  globalThis.setTimeout = (fn, ms) => { const timer = {fn, ms, unref() { timer.unrefd = true; return timer; }}; timeouts.push(timer); return timer; };
  globalThis.clearTimeout = timer => { cleared.push(timer); };
  try {
    delete globalThis.__yourrestMoldCustomers;
    globalThis.customersTestEnv = {DB};
    const links = [];
    M.keepMoldCustomersSynced(DB, () => { links.push('read'); return moldConfig({}); });
    eq([intervals.length, intervals[0].ms, timeouts.length, timeouts[0].ms], [1, M.MOLD_CUSTOMERS_CHECK_MS, 1, M.MOLD_CUSTOMERS_SETTLE_MS], 'the first start: a check every ten minutes, and one five seconds later');
    M.keepMoldCustomersSynced(DB, () => moldConfig({}));
    eq([intervals.length, timeouts.length], [1, 1], 'started again without soon: nothing more');
    M.keepMoldCustomersSynced(DB, () => moldConfig({}), {soon: true});
    eq([intervals.length, timeouts.length, cleared.length], [1, 2, 1], 'a nudge: the waiting check replaced (a burst of edits sends once)');
    M.nudgeMoldCustomers({soon: true});
    eq([intervals.length, timeouts.length], [1, 3], 'the routes\' nudge: the same');
    timeouts.at(-1).fn(); intervals[0].fn();
    await realTimeout.call(globalThis, () => {}, 20);
    eq(globalThis.__yourrestMoldCustomers.settle, undefined, 'the check ran: nothing waits');
    ok(links.length === 0 || links.every(item => item === 'read'), 'the link read on each check');
  } finally {
    globalThis.setInterval = realInterval; globalThis.setTimeout = realTimeout; globalThis.clearTimeout = realClear;
    delete globalThis.__yourrestMoldCustomers;
  }
  ok(!sends().some(row => JSON.stringify(row).includes(mock.state.secret)), 'the secret is in no audit line');
} finally { await mock.stop(); }

console.log(JSON.stringify({ok: true, checks}));
