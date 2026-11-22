// The salesmen list sent to production on the server, the parts tests/mold-salesmen.mjs leaves (the owner's unit-test plan, 2026-11-22):
// lib/mold-salesmen-server.ts transpiled exactly as that test transpiles it (the same two stand-ins for the database and the link), so the
// coverage measure merges both runs, on an in-memory SQLite with every migration against the stand-in production API with its route. Who
// is a salesman across the roles that file mold requests (rep, marketing, supervisor, sales manager, administrator, customer service and
// its manager), a role that files none, «مبيعات مكتب» and «المركز الرئيسي» never (with a kashida, extra spaces and direction marks), an
// inactive member as active:false once, «إضافة» switched off; a check while another runs (one send); over 1000 salesmen (upsert
// batches, one warning that nobody was deactivated, the state kept); an exception while reading (a failure by its name, never thrown,
// never the message); a refusal with more than ten fields (ten kept); and the timers (a check every ten minutes, one five seconds after
// a nudge, never two timers). Made-up members only; the secret is the stand-in's own made-up value.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {request as httpsRequest} from 'node:https';
import ts from 'typescript';
import {moldConfig} from '../portable/mold-client.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';

let checks = 0;
const plain = value => value === undefined ? value : JSON.parse(JSON.stringify(value));
const eq = (actual, expected, message) => { assert.deepEqual(plain(actual), plain(expected), message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

// The compilation of tests/mold-salesmen.mjs, line for line (its stand-ins included), so both runs are one version of each module.
const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'mold-salesmen-server-unit-')), compiled = new Set();
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
const stubs = {'./crm-server': 'export function database(){return globalThis.testDb;}', './mold-requests-server': 'export function productsLink(){return globalThis.testLink;}'};
for (const [name, source] of Object.entries(stubs)) fs.writeFileSync(path.join(out, name.slice(2) + '.stub.mjs'), source);
function compile(relative) {
  const dest = path.join(out, relative.replace(/\.tsx?$/, '.mjs'));
  if (compiled.has(relative)) return dest;
  compiled.add(relative);
  fs.mkdirSync(path.dirname(dest), {recursive: true});
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText
    .replace(/from (['"])([^'"]+)\1/g, (match, quote, specifier) => {
      if (stubs[specifier] && relative.startsWith('lib/mold-salesmen-server')) return 'from ' + JSON.stringify(path.join(out, specifier.slice(2) + '.stub.mjs'));
      if (specifier.startsWith('@/portable/')) return 'from ' + JSON.stringify(path.join(root, specifier.slice(2)));
      if (!specifier.startsWith('./') && !specifier.startsWith('@/')) return match;
      const source = specifier.startsWith('@/') ? specifier.slice(2) : path.join(path.dirname(relative), specifier);
      return 'from ' + JSON.stringify(compile(fs.existsSync(path.join(root, source + '.ts')) ? source + '.ts' : source + '.tsx'));
    });
  fs.writeFileSync(dest, code);
  return dest;
}
const lib = await import(compile('lib/mold-salesmen.ts'));
const server = await import(compile('lib/mold-salesmen-server.ts'));

const sql = new DatabaseSync(':memory:');
for (const file of fs.readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) sql.exec(fs.readFileSync('drizzle/' + file, 'utf8'));
let failNext = false;
globalThis.testDb = {prepare(text) {
  if (failNext) { failNext = false; const error = new Error('SQLITE_BUSY: the members table is locked by rep-secret@example.invalid'); error.name = 'D1Error'; throw error; }
  let args = [];
  const statement = {bind(...values) { args = values; return statement; }, async all() { return {results: sql.prepare(text).all(...args)}; }, async first() { return sql.prepare(text).get(...args) ?? null; }, async run() { const result = sql.prepare(text).run(...args); return {meta: {changes: Number(result.changes)}}; }};
  return statement;
}};
const db = globalThis.testDb, created = '2026-11-01T00:00:00.000Z';
const addMember = (id, role, name, active = 1) => sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,active,target,created_at,region_scope) VALUES(?,?,?,?,?,?,NULL,?,0,?,?)').run(id, 'opaque-' + id, id + '@example.invalid', name, role, 'الرئيسي', active, created, 'all');
const at = minutes => () => new Date(Date.parse('2026-11-20T08:00:00.000Z') + minutes * 60_000).toISOString();

const mock = await startProductsMock({salesmen: true});
const authority = fs.readFileSync(mock.ca);
const fetch = (url, init) => new Promise((resolve, reject) => {
  const req = httpsRequest(url, {method: init.method, headers: init.headers, ca: authority, signal: init.signal}, res => {
    const headers = new Headers(Object.entries(res.headers).flatMap(([key, value]) => Array.isArray(value) ? value.map(item => [key, item]) : [[key, value]]));
    const parts = []; res.on('data', part => parts.push(part)); res.on('end', () => resolve({status: res.statusCode, headers, arrayBuffer: async () => Buffer.concat(parts)}));
  });
  req.on('error', error => reject(init.signal?.aborted ? Object.assign(new Error('timeout'), {name: 'TimeoutError'}) : error));
  req.end(init.body);
});
const link = moldConfig({YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret});
const lines = [], log = {info: line => lines.push(['info', line]), warn: line => lines.push(['warn', line])};
const sync = (minutes, extra = {}) => server.syncMoldSalesmen(db, link, {now: at(minutes), fetch, log, ...extra});
const lastBody = () => JSON.parse(mock.state.calls.filter(call => call.route === 'salesmen').at(-1).body);

try {
  // ---- who is a salesman, every role
  for (const [id, role] of [['m-rep', 'rep'], ['m-mkt', 'marketing'], ['m-sup', 'supervisor'], ['m-sm', 'manager'], ['m-admin', 'admin'], ['m-cs', 'customer_service'], ['m-csm', 'customer_service_manager'], ['m-viewer', 'viewer']]) addMember(id, role, 'عضو ' + id);
  addMember('m-office', 'rep', ' مبيعـات‏   مكتب ');
  addMember('m-center', 'rep', 'المركز الرئيسي');
  addMember('m-gone', 'rep', 'مندوب غادر', 0);
  sql.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('m-mkt',?,?,1,'m-admin',?)").run(JSON.stringify({'mold-requests:add': false}), '[]', created);
  let result = await sync(0);
  eq([result.sent, result.mode, result.reason, result.count], [true, 'full', 'first', 6], 'the first check: a full list of the six who may file a request');
  eq(lastBody().salesmen.map(entry => entry.crmMemberId), ['m-admin', 'm-cs', 'm-csm', 'm-rep', 'm-sm', 'm-sup'], 'every role that files mold requests, by id; not a viewer, not «إضافة» switched off, not the office (with a kashida, a mark and extra spaces), not «المركز الرئيسي», not an inactive member');

  // ---- two checks at once: one send
  sql.prepare("UPDATE crm_members SET active=0 WHERE id='m-sup'").run();
  const before = mock.state.calls.length, one = sync(5), two = sync(5);
  ok(one === two, 'a check that comes while one runs waits for it (the same promise)');
  result = await one;
  eq([result.mode, mock.state.calls.length - before, lastBody().salesmen], ['upsert', 1, [{crmMemberId: 'm-sup', name: 'عضو m-sup', email: 'm-sup@example.invalid', active: false}]], 'one call: the member deactivated since, as active:false');
  eq((await sync(6)).reason, 'unchanged', 'and not again');

  // ---- an exception is a failure by its name, never thrown, never its message
  failNext = true;
  result = await sync(7);
  eq(result, {sent: false, reason: 'failed', error: 'D1Error'}, 'an exception: a failure named by its class only');
  ok(!JSON.stringify(result).includes('rep-secret'), 'nothing of its message');

  // ---- a refusal with many fields: ten kept
  sql.prepare("UPDATE crm_members SET name='عضو جديد' WHERE id='m-rep'").run();
  mock.answerNext('salesmen', 400, {error: {code: 'invalid_payload', message: 'x', fields: Array.from({length: 14}, (_, n) => 'salesmen.' + n + '.name')}});
  result = await sync(8);
  eq([result.reason, result.fields.length, (await server.readMoldSalesmenState(db)).lastError.fields.length], ['failed', 10, 10], 'a refusal naming fourteen fields: ten kept, in the answer and the state');
  eq(lines.filter(line => line[0] === 'warn').length, 1, 'one warning');

  // ---- over 1000 salesmen: upsert batches, a warning that nobody was deactivated
  const insert = sql.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,active,target,created_at,region_scope) VALUES(?,?,?,?,'rep','الرئيسي',NULL,1,0,?,'all')");
  sql.exec('BEGIN'); for (let n = 0; n < 1000; n++) insert.run('bulk-' + String(n).padStart(4, '0'), 'u-bulk-' + n, 'bulk' + n + '@example.invalid', 'مندوب ' + n, created); sql.exec('COMMIT');
  result = await sync(9, {force: true});
  const warning = lines.filter(line => line[0] === 'warn').map(line => JSON.parse(line[1])).find(line => line.status === 'over_limit');
  eq([result.sent, result.mode, result.reason, result.count, result.result.deactivated], [true, 'upsert', 'forced', 1005, 0], 'over 1000 salesmen: sent as upsert batches, nobody deactivated');
  eq([warning?.salesmen, warning?.note], [1005, 'sent as upsert batches; nobody deactivated this time'], 'one warning with the count sent');
  const audit = JSON.parse(sql.prepare("SELECT detail FROM crm_audit WHERE record_id='mold-salesmen' ORDER BY created_at DESC,rowid DESC LIMIT 1").get().detail);
  eq([audit.mode, audit.overLimit, audit.calls, audit.eligible], ['upsert', true, 2, 1005], 'the audit line says so');
  eq((await server.readMoldSalesmenState(db)).fullAt, at(9)(), 'the state counts it as the full list of the day');

  // ---- the timers: a check every ten minutes and one shortly after a nudge, never two timers
  const intervals = [], timeouts = [], cleared = [];
  const realInterval = globalThis.setInterval, realTimeout = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  globalThis.setInterval = (fn, ms) => { const timer = {fn, ms, unref() {}}; intervals.push(timer); return timer; };
  globalThis.setTimeout = (fn, ms) => { const timer = {fn, ms, unref() {}}; timeouts.push(timer); return timer; };
  globalThis.clearTimeout = timer => { cleared.push(timer); };
  try {
    delete globalThis.__yourrestMoldSalesmen;
    globalThis.testLink = moldConfig({});
    server.keepMoldSalesmenSynced(db, () => moldConfig({}));
    eq([intervals.length, intervals[0].ms, timeouts.length, timeouts[0].ms], [1, server.MOLD_SALESMEN_CHECK_MS, 1, server.MOLD_SALESMEN_SETTLE_MS], 'the first start: a check every ten minutes, and one five seconds later');
    server.keepMoldSalesmenSynced(db, () => moldConfig({}));
    eq([intervals.length, timeouts.length], [1, 1], 'started again without a nudge: nothing more');
    server.nudgeMoldSalesmen({soon: true});
    eq([intervals.length, timeouts.length, cleared.length], [1, 2, 1], 'a nudge: the waiting check replaced (a burst of edits sends once)');
    timeouts.at(-1).fn(); intervals[0].fn();
    await new Promise(resolve => realTimeout(resolve, 20));
    eq(globalThis.__yourrestMoldSalesmen.settle, undefined, 'the check ran (the link off: nothing sent), nothing waits');
  } finally {
    globalThis.setInterval = realInterval; globalThis.setTimeout = realTimeout; globalThis.clearTimeout = realClear;
    delete globalThis.__yourrestMoldSalesmen;
  }
  ok(!(lines.map(line => line[1]).join('\n') + sql.prepare("SELECT group_concat(detail) AS d FROM crm_audit").get().d).includes(mock.state.secret), 'the secret is in no log line and no audit line');
} finally { await mock.stop(); }

console.log(JSON.stringify({ok: true, checks}));
