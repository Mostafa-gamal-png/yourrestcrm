// The products application's `salesmen` route on the CRM side (2026-11-12, yourrest-products#54): the entry of a member (the id's shape,
// the name cleaned as production stores it, the email lower-cased or left out), the calls (one full within 1000 salesmen and 256 KB; over
// them upsert batches and never a cut full), the answer read, production before its release (400 invalid_payload, fields ["route"]: not
// an error); who is a salesman (lib/mold-salesmen.ts, transpiled: active, a role that files mold requests, the screen not hidden, «إضافة»
// not switched off, never «المركز الرئيسي» or «مبيعات مكتب»); what one check sends (the first full, nothing unchanged, an upsert of a
// rename, an email, a deactivation, a lost permission, a full for a deleted member and once a day, the hour of waiting for the route);
// and lib/mold-salesmen-server.ts over every drizzle migration in an in-memory SQLite against the stand-in production API with and
// without the route: the state kept in crm_settings, the audit line (counts and ids, no name, no email), the log (one line a day while
// the route is missing, nothing secret). Synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {request as httpsRequest} from 'node:https';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {MOLD_SALESMEN_BODY_LIMIT, MOLD_SALESMEN_MAX, moldSalesmanName, moldSalesmanEmail, moldSalesmanEntry, moldSalesmenCalls, moldSalesmenFit, moldSalesmenRouteMissing, moldSalesmenAnswer} from '../portable/mold-salesmen.mjs';
import {callProducts, moldConfig, moldSignature} from '../portable/mold-client.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';

let checks = 0;
const plain = value => JSON.parse(JSON.stringify(value));
const eq = (actual, expected, message) => { assert.deepEqual(plain(actual), plain(expected), message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const bytes = value => Buffer.byteLength(JSON.stringify(value));

// ---- the name, the email and the entry
eq(moldSalesmanName('  أحمد   محمد  '), 'أحمد محمد', 'the ends trimmed, runs of spaces as one');
eq(moldSalesmanName('‏أحمد‎ ‫علي‬⁧⁩'), 'أحمد علي', 'direction marks and embeddings removed');
eq(moldSalesmanName('أحمد\tعلي\nحسن  سالم'), 'أحمد علي حسن سالم', 'a tab, a new line and no-break spaces are spaces');
eq(moldSalesmanName('​﻿­'), '', 'only invisible marks: nothing');
eq(moldSalesmanName(42), '', 'not text: nothing');
eq([...moldSalesmanName('ب'.repeat(170))].length, 160, 'cut at 160 characters');
eq([...moldSalesmanName('😀'.repeat(161))].length, 160, 'counted as production counts them (code points)');
eq(moldSalesmanName('أ'.repeat(159) + ' ب'), 'أ'.repeat(159), 'a space left at the cut is trimmed');
eq(moldSalesmanEmail(' Rep.One@YourRest.ORG‏ '), 'rep.one@yourrest.org', 'lower-case, the ends and marks taken out');
eq(moldSalesmanEmail('not-an-address'), '', 'not an address: left out');
eq(moldSalesmanEmail('a@b'), '', 'no dot in the domain: left out');
eq(moldSalesmanEmail('a'.repeat(147) + '@yourrest.org'), 'a'.repeat(147) + '@yourrest.org', '160 characters: kept');
eq(moldSalesmanEmail('a'.repeat(148) + '@yourrest.org'), '', '161 characters: left out, never cut');
eq(moldSalesmanEmail(null), '', 'none');
eq(moldSalesmanEntry({id: 'c9b1e7d2-1f2a-4b3c-9d8e-0a1b2c3d4e5f', name: ' مندوب  أول ', email: 'Rep@Yourrest.org', active: true}), {crmMemberId: 'c9b1e7d2-1f2a-4b3c-9d8e-0a1b2c3d4e5f', name: 'مندوب أول', email: 'rep@yourrest.org', active: true}, 'a member: id, the cleaned name, the email, active');
eq(moldSalesmanEntry({id: 'owner', name: 'المالك', email: 'bad', active: false}), {crmMemberId: 'owner', name: 'المالك', active: false}, 'an invalid email is left out; active false');
eq(moldSalesmanEntry({id: 'rep', name: 'مندوب'}).active, true, 'active by default');
for (const id of ['', 'a b', 'a/b', 'é', 'x'.repeat(65), 42, null]) eq(moldSalesmanEntry({id, name: 'مندوب'}), null, 'an id outside the contract\'s shape: not sent (' + JSON.stringify(id) + ')');
eq(moldSalesmanEntry({id: 'x'.repeat(64), name: 'مندوب'}).crmMemberId.length, 64, '64 characters: sent');
eq(moldSalesmanEntry({id: 'rep', name: ' ‏ '}), null, 'no name left: not sent');

// ---- the calls
const many = (count, extra = '') => Array.from({length: count}, (_, index) => ({crmMemberId: 'm' + index, name: 'مندوب ' + index + extra, email: 'm' + index + '@yourrest.org', active: true}));
{
  const one = moldSalesmenCalls('full', many(3));
  eq([one.calls.length, one.calls[0].mode, one.calls[0].salesmen.length, one.overLimit], [1, 'full', 3, false], 'a list that fits: one full call');
  const thousand = moldSalesmenCalls('full', many(MOLD_SALESMEN_MAX));
  eq([thousand.calls.length, thousand.calls[0].mode, thousand.overLimit], [1, 'full', false], '1000 salesmen: still one full call');
  const over = moldSalesmenCalls('full', many(MOLD_SALESMEN_MAX + 1));
  eq([over.overLimit, over.calls.map(call => call.mode), over.calls.map(call => call.salesmen.length)], [true, ['upsert', 'upsert'], [1000, 1]], '1001: never a cut full, upsert batches of 1000 at most');
  const heavy = many(900, ' ' + 'ن'.repeat(140));
  ok(!moldSalesmenFit('full', heavy), '900 long names are over 256 KB');
  const split = moldSalesmenCalls('full', heavy);
  ok(split.overLimit && split.calls.length >= 2 && split.calls.every(call => call.mode === 'upsert' && bytes(call) <= MOLD_SALESMEN_BODY_LIMIT), 'over 256 KB: upsert batches, each within 256 KB');
  eq(split.calls.flatMap(call => call.salesmen).length, 900, 'nobody left out of the batches');
  const ups = moldSalesmenCalls('upsert', many(2500));
  eq([ups.overLimit, ups.calls.map(call => call.salesmen.length)], [false, [1000, 1000, 500]], 'an upsert of 2500: three calls');
  eq(moldSalesmenCalls('full', []).calls, [{mode: 'full', salesmen: []}], 'nobody may ask: a full of none (production deactivates every one)');
}

// ---- production's answers
eq(moldSalesmenRouteMissing({kind: 'rejected', code: 'invalid_payload', fields: ['route'], http: 400}), true, 'the products application before its release: the route is missing');
eq(moldSalesmenRouteMissing({kind: 'rejected', code: 'invalid_payload', fields: ['route', 'mode'], http: 400}), false, 'another field too: a real refusal');
eq(moldSalesmenRouteMissing({kind: 'rejected', code: 'invalid_payload', fields: ['salesmen.0.name'], http: 400}), false, 'a field of a salesman: a real refusal');
eq(moldSalesmenRouteMissing({kind: 'retry', code: 'http_404', fields: [], http: 404}), false, 'not that refusal');
const answer = {received: 2, inserted: 1, updated: 1, deactivated: 1, deactivatedIds: ['m7', 'bad id', 5], activeSalesmen: 2};
eq(moldSalesmenAnswer(answer), {received: 2, inserted: 1, updated: 1, deactivated: 1, activeSalesmen: 2, deactivatedIds: ['m7']}, 'the counts, and the ids of the contract\'s shape only');
eq(moldSalesmenAnswer({...answer, deactivatedIds: undefined}), null, 'no deactivatedIds: not the contract\'s answer');
eq(moldSalesmenAnswer({...answer, inserted: -1}), null, 'a negative count: not the contract\'s answer');
eq(moldSalesmenAnswer({...answer, activeSalesmen: '2'}), null, 'a count as text: not the contract\'s answer');

// ---- lib/mold-salesmen.ts and lib/mold-salesmen-server.ts, transpiled as the build sees them
const root = process.cwd(), out = fs.mkdtempSync(path.join(os.tmpdir(), 'yr-mold-salesmen-')), compiled = new Set();
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
const {memberAccess} = await import(path.join(out, 'lib/permissions.mjs'));

const member = (id, role, extra = {}) => ({id, name: 'عضو ' + id, email: id + '@yourrest.org', role, active: 1, access: memberAccess(role, null), ...extra});
const withAccess = (m, row) => ({...m, access: memberAccess(m.role, {permissions: JSON.stringify(row.cells || {}), hidden: JSON.stringify(row.hidden || []), version: 1})});
{
  for (const role of ['admin', 'manager', 'supervisor', 'rep', 'customer_service', 'customer_service_manager']) eq(lib.moldSalesmanMayAsk(member('x', role)), true, role + ': files mold requests (MOLD_ROLES), so a salesman');
  eq(lib.moldSalesmanMayAsk(member('x', 'viewer')), false, 'a role that files no mold request: not a salesman');
  eq(lib.moldSalesmanMayAsk(member('x', 'rep', {active: 0})), false, 'a deactivated member: not a salesman');
  eq(lib.moldSalesmanMayAsk(withAccess(member('x', 'rep'), {hidden: ['mold-requests']})), false, '«طلبات تصنيع القوالب» hidden from them: not a salesman (the route answers 404)');
  eq(lib.moldSalesmanMayAsk(withAccess(member('x', 'rep'), {cells: {'mold-requests:add': false}})), false, '«إضافة» switched off: not a salesman (the route refuses create)');
  eq(lib.moldSalesmanMayAsk(withAccess(member('x', 'rep'), {cells: {'mold-requests:delete': false}, hidden: ['quote']})), true, 'another cell or screen switched off: still a salesman');
  eq(lib.moldSalesmanMayAsk(withAccess(member('x', 'admin'), {hidden: ['mold-requests']})), true, 'nothing is hidden from an administrator');
  for (const name of ['المركز الرئيسي', ' مبيعات  مكتب ', 'مبيعات المكتب', 'مبيعـات مكتب']) eq(lib.moldSalesmanMayAsk(member('x', 'rep', {name})), false, '«' + name.trim() + '» is the office, never a salesman');
}

{
  const hash = entry => JSON.stringify(entry), start = '2026-11-12T08:00:00.000Z', later = minutes => new Date(Date.parse(start) + minutes * 60_000).toISOString();
  const team = [member('rep2', 'rep'), member('rep1', 'rep', {name: '‏مندوب   أول', email: 'Rep1@YourRest.org'}), member('sm', 'manager'), member('cs', 'customer_service', {active: 0}), member('bad id', 'rep')];
  let state = lib.emptySalesmenState();
  let plan = lib.moldSalesmenPlan(team, state, start, hash);
  eq([plan.kind, plan.reason, plan.eligible, plan.skipped, plan.calls.length, plan.calls[0].mode], ['full', 'first', 4, 1, 1, 'full'], 'the first check: the whole list as full; an id the route refuses is counted as skipped');
  eq(plan.calls[0].salesmen, [
    {crmMemberId: 'rep1', name: 'مندوب أول', email: 'rep1@yourrest.org', active: true},
    {crmMemberId: 'rep2', name: 'عضو rep2', email: 'rep2@yourrest.org', active: true},
    {crmMemberId: 'sm', name: 'عضو sm', email: 'sm@yourrest.org', active: true},
  ], 'the active members who may ask, by id, names cleaned, emails lower-cased; the deactivated one not in the full');
  state = {...state, fullAt: start, sent: plan.sentAfter};
  plan = lib.moldSalesmenPlan(team, state, later(10), hash);
  eq([plan.kind, plan.reason, plan.calls.length], ['none', 'unchanged', 0], 'nothing changed: nothing sent');
  const renamed = team.map(m => m.id === 'rep2' ? {...m, name: 'مندوب ثاني', email: 'second@yourrest.org'} : m);
  plan = lib.moldSalesmenPlan(renamed, state, later(11), hash);
  eq([plan.kind, plan.calls.length, plan.calls[0].mode, plan.calls[0].salesmen], ['upsert', 1, 'upsert', [{crmMemberId: 'rep2', name: 'مندوب ثاني', email: 'second@yourrest.org', active: true}]], 'a name and an email edited: an upsert of that one');
  state = {...state, sent: plan.sentAfter};
  const added = [...renamed, member('rep3', 'rep')];
  plan = lib.moldSalesmenPlan(added, state, later(12), hash);
  eq([plan.kind, plan.calls[0].salesmen.map(entry => [entry.crmMemberId, entry.active])], ['upsert', [['rep3', true]]], 'a member added: an upsert of the new one');
  state = {...state, sent: plan.sentAfter};
  const changes = added.map(m => m.id === 'rep3' ? {...m, active: 0} : m.id === 'sm' ? withAccess(m, {cells: {'mold-requests:add': false}}) : m.id === 'rep1' ? withAccess(m, {hidden: ['mold-requests']}) : m);
  plan = lib.moldSalesmenPlan(changes, state, later(13), hash);
  eq([plan.kind, plan.calls[0].salesmen.map(entry => [entry.crmMemberId, entry.active]).sort()], ['upsert', [['rep1', false], ['rep3', false], ['sm', false]]], 'deactivated, «إضافة» off, the screen hidden: each sent active:false in an upsert');
  eq(plan.calls[0].salesmen.find(entry => entry.crmMemberId === 'rep1'), {crmMemberId: 'rep1', name: 'مندوب أول', email: 'rep1@yourrest.org', active: false}, 'with their name and email');
  state = {...state, sent: plan.sentAfter};
  eq(Object.keys(state.sent).sort(), ['rep2'], 'only the active ones are remembered as sent');
  plan = lib.moldSalesmenPlan(changes, state, later(14), hash);
  eq(plan.kind, 'none', 'sent once: not again');
  const back = changes.map(m => m.id === 'rep3' ? {...m, active: 1} : m);
  plan = lib.moldSalesmenPlan(back, state, later(15), hash);
  eq(plan.calls[0].salesmen.map(entry => [entry.crmMemberId, entry.active]), [['rep3', true]], 'reactivated: sent active again');
  state = {...state, sent: plan.sentAfter};
  plan = lib.moldSalesmenPlan(back.filter(m => m.id !== 'rep3'), state, later(16), hash);
  eq([plan.kind, plan.reason, plan.calls[0].mode, plan.calls[0].salesmen.map(entry => entry.crmMemberId)], ['full', 'removed', 'full', ['rep2']], 'a member deleted from the CRM: a full list (it deactivates them; an upsert would need their name)');
  state = {...state, sent: plan.sentAfter, fullAt: later(16)};
  plan = lib.moldSalesmenPlan(back.filter(m => m.id !== 'rep3'), state, later(16 + 24 * 60 - 1), hash);
  eq(plan.kind, 'none', 'a full sent 23:59 ago and nothing changed: nothing');
  plan = lib.moldSalesmenPlan(back.filter(m => m.id !== 'rep3'), state, later(16 + 24 * 60), hash);
  eq([plan.kind, plan.reason], ['full', 'daily'], 'a day after the last full: the whole list again');
  plan = lib.moldSalesmenPlan(back.filter(m => m.id !== 'rep3'), state, later(17), hash, {force: true});
  eq([plan.kind, plan.reason], ['full', 'forced'], 'forced: the whole list');
  const waiting = {...lib.emptySalesmenState(), routeMissingAt: start};
  eq(lib.moldSalesmenPlan(team, waiting, later(59), hash).kind, 'wait', 'production has no route yet: nothing for an hour');
  eq(lib.moldSalesmenPlan(team, waiting, later(59), hash, {force: true}).kind, 'wait', 'forced included: the route is not there');
  eq([lib.moldSalesmenPlan(team, waiting, later(60), hash).kind, lib.moldSalesmenPlan(team, waiting, later(60), hash).reason], ['full', 'first'], 'an hour later: the first full is tried again');
  const crowd = Array.from({length: 1001}, (_, index) => member('m' + String(index).padStart(4, '0'), 'rep'));
  const leaver = member('zz', 'rep', {active: 0});
  plan = lib.moldSalesmenPlan([...crowd, leaver], {...lib.emptySalesmenState(), fullAt: start, sent: {zz: 'x'}}, later(24 * 60), hash);
  eq([plan.kind, plan.overLimit, plan.calls.every(call => call.mode === 'upsert'), plan.calls.flatMap(call => call.salesmen).length, plan.calls.at(-1).salesmen], ['full', true, true, 1002, [{crmMemberId: 'zz', name: 'عضو zz', email: 'zz@yourrest.org', active: false}]], 'over 1000 salesmen: upsert batches, and whoever may no longer ask goes active:false with them');
  eq(lib.readSalesmenState('{bad json'), lib.emptySalesmenState(), 'an unreadable state: the empty state (a full is sent)');
  eq(lib.readSalesmenState(JSON.stringify({fullAt: 'yesterday', sent: {a: 'h', b: 3}, routeMissingAt: start})), {...lib.emptySalesmenState(), sent: {a: 'h'}, routeMissingAt: start}, 'the state read defensively');
}

// ---- the stand-in production API: the route before and after the products release, field for field
function fetchWith(caFile) {
  const authority = readFileSync(caFile);
  return (url, init) => new Promise((resolve, reject) => {
    const req = httpsRequest(url, {method: init.method, headers: init.headers, ca: authority, signal: init.signal}, res => {
      const headers = new Headers(Object.entries(res.headers).flatMap(([key, value]) => Array.isArray(value) ? value.map(item => [key, item]) : [[key, value]]));
      const parts = []; res.on('data', part => parts.push(part)); res.on('end', () => resolve({status: res.statusCode, headers, arrayBuffer: async () => Buffer.concat(parts)}));
    });
    req.on('error', error => reject(init.signal?.aborted ? Object.assign(new Error('timeout'), {name: 'TimeoutError'}) : error));
    req.end(init.body);
  });
}
const mock = await startProductsMock();
try {
  const fetch = fetchWith(mock.ca), config = moldConfig({YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret}), call = body => callProducts(config, 'salesmen', body, {fetch});
  const entries = many(3);
  let reply = await call({mode: 'full', salesmen: entries});
  eq([reply.kind, reply.code, reply.fields, reply.http, moldSalesmenRouteMissing(reply)], ['rejected', 'invalid_payload', ['route'], 400, true], 'before the products release: 400 invalid_payload, fields ["route"], read as «not yet»');
  mock.setSalesmen(true);
  reply = await call({mode: 'full', salesmen: entries});
  eq([reply.kind, reply.http, reply.json], ['ok', 200, {received: 3, inserted: 3, updated: 0, deactivated: 0, deactivatedIds: [], activeSalesmen: 3}], 'after it: a full of three, inserted');
  ok(mock.state.calls.at(-1).signed, 'signed like every route');
  reply = await call({mode: 'upsert', salesmen: [{...entries[0], name: 'اسم جديد'}]});
  eq([reply.json.received, reply.json.updated, reply.json.inserted, reply.json.activeSalesmen], [1, 1, 0, 3], 'an upsert touches only the one sent');
  reply = await call({mode: 'full', salesmen: [entries[0]]});
  eq([reply.json.deactivated, reply.json.deactivatedIds.sort(), reply.json.activeSalesmen, mock.state.salesmen.size], [2, ['m1', 'm2'], 1, 3], 'a full deactivates whoever it leaves out, deletes nobody, and names them');
  reply = await call({mode: 'upsert', salesmen: [{...entries[0], active: false}]});
  eq([reply.json.updated, reply.json.deactivated, reply.json.activeSalesmen], [1, 0, 0], 'active:false in an upsert: updated (deactivated counts what a full left out)');
  const refused = async (body, fields, message) => { const r = await call(body); eq([r.kind, r.code, r.fields], ['rejected', 'invalid_payload', fields], message); };
  await refused({mode: 'replace', salesmen: entries}, ['mode'], 'an unknown mode');
  await refused({mode: 'full'}, ['salesmen'], 'no list');
  await refused({mode: 'upsert', salesmen: [{...entries[0], crmMemberId: 'a b'}]}, ['salesmen.0.crmMemberId'], 'an id outside the shape');
  await refused({mode: 'upsert', salesmen: [entries[0], entries[0]]}, ['salesmen.1.crmMemberId'], 'the same id twice');
  await refused({mode: 'upsert', salesmen: [{...entries[0], name: ' '}]}, ['salesmen.0.name'], 'an empty name');
  await refused({mode: 'upsert', salesmen: [{...entries[0], name: 'ن'.repeat(161)}]}, ['salesmen.0.name'], 'a name over 160');
  await refused({mode: 'upsert', salesmen: [{...entries[0], email: 'Rep@Yourrest.org'}]}, ['salesmen.0.email'], 'an email not lower-case');
  await refused({mode: 'upsert', salesmen: [{...entries[0], email: 'x'.repeat(180) + '@yourrest.org'}]}, ['salesmen.0.email'], 'an email over 190');
  await refused({mode: 'upsert', salesmen: [{crmMemberId: 'm9', name: 'مندوب'}]}, ['salesmen.0.active'], 'active is required');
  await refused({mode: 'upsert', salesmen: [{crmMemberId: 'm9', name: 'مندوب', active: 'yes'}]}, ['salesmen.0.active'], 'active a boolean');
  await refused({mode: 'upsert', salesmen: many(1001)}, ['salesmen'], '1001 salesmen in one call');
  reply = await call({mode: 'upsert', salesmen: many(1000)});
  eq([reply.kind, reply.json.received], ['ok', 1000], '1000 in one call: accepted');
  const heavy = {mode: 'upsert', salesmen: many(900, ' ' + 'ن'.repeat(140))};
  reply = await call(heavy);
  eq([reply.kind, reply.code, reply.http], ['rejected', 'payload_too_large', 0], 'over 256 KB: the CRM refuses before sending');
  const heavyBody = Buffer.from(JSON.stringify(heavy)), timestamp = String(Math.floor(Date.now() / 1000));
  const raw = await fetch(mock.url + '?route=salesmen', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-YR-Timestamp': timestamp, 'X-YR-Signature': moldSignature(mock.state.secret, timestamp, 'POST', 'salesmen', heavyBody)}, body: heavyBody});
  eq(raw.status, 413, 'and production answers 413 to it');
} finally { /* the mock is used below */ }

// ---- the server's check over a real schema: the state, the audit line, the log
const sql = new DatabaseSync(':memory:');
for (const file of fs.readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) sql.exec(fs.readFileSync('drizzle/' + file, 'utf8'));
globalThis.testDb = {prepare(text) {
  let args = [];
  const statement = {bind(...values) { args = values; return statement; }, async all() { return {results: sql.prepare(text).all(...args)}; }, async first() { return sql.prepare(text).get(...args) ?? null; }, async run() { const result = sql.prepare(text).run(...args); return {meta: {changes: Number(result.changes)}}; }};
  return statement;
}};
const db = globalThis.testDb, created = '2026-11-01T00:00:00.000Z';
const addMember = (id, role, name, email, active = 1) => sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,active,target,created_at,region_scope) VALUES(?,?,?,?,?,?,NULL,?,0,?,?)').run(id, 'opaque-' + id, email, name, role, 'الرئيسي', active, created, 'all');
addMember('owner', 'admin', 'مدير النظام', 'owner@yourrest.org');
addMember('rep-a', 'rep', ' مندوب‏  الشرقية ', 'rep-a@yourrest.org');
addMember('rep-b', 'rep', 'مندوب جدة', 'Rep-B@yourrest.org');
addMember('cs-1', 'customer_service', 'خدمة العملاء', 'cs-1@yourrest.org', 0);
const lines = [], log = {info: line => lines.push(['info', line]), warn: line => lines.push(['warn', line])};
const audits = () => sql.prepare("SELECT detail FROM crm_audit WHERE record_id='mold-salesmen' AND action='mold-salesmen:sync' ORDER BY created_at").all().map(row => JSON.parse(row.detail));
const stored = async () => server.readMoldSalesmenState(db);
const at = minutes => () => new Date(Date.parse('2026-11-12T08:00:00.000Z') + minutes * 60_000).toISOString();
try {
  const fetch = fetchWith(mock.ca), link = moldConfig({YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret}), sync = (minutes, extra = {}) => server.syncMoldSalesmen(db, link, {now: at(minutes), fetch, log, ...extra});
  mock.setSalesmen(false); mock.state.salesmen.clear();
  eq(await server.syncMoldSalesmen(db, {ok: false, reason: 'not_configured'}, {log}), {sent: false, reason: 'not_configured'}, 'without the link settings: nothing');
  let result = await sync(0);
  eq([result.sent, result.reason], [false, 'route_not_available'], 'production before its release: not sent, «not available yet»');
  eq([lines.length, lines[0]?.[0], JSON.parse(lines[0][1]).status], [1, 'info', 'route_not_available_yet'], 'one info line, not a warning');
  eq([audits().length, (await stored()).routeMissingAt, (await stored()).lastError, (await stored()).fullAt], [0, at(0)(), null, null], 'no audit line, no error kept: only when production answered so');
  eq((await sync(30)).reason, 'route_waiting', 'within the hour: not even asked');
  const before = mock.state.calls.length;
  await sync(30);
  eq(mock.state.calls.length - before, 0, 'nothing reaches production while waiting');
  result = await sync(61);
  eq([result.reason, lines.length], ['route_not_available', 1], 'an hour later: asked again, still missing; the log said it today already');
  result = await sync(61 + 24 * 60);
  eq([result.reason, lines.length], ['route_not_available', 2], 'a day later: said once more');
  mock.setSalesmen(true);
  result = await sync(61 + 24 * 60 + 61);
  eq([result.sent, result.mode, result.reason, result.result], [true, 'full', 'first', {received: 3, inserted: 3, updated: 0, deactivated: 0, activeSalesmen: 3}], 'the release is live: the first full list');
  eq(JSON.parse(lines.at(-1)[1]).status, 'route_available', 'the log says the route is there now');
  const sentBody = JSON.parse(mock.state.calls.filter(call => call.route === 'salesmen').at(-1).body);
  eq(sentBody, {mode: 'full', salesmen: [
    {crmMemberId: 'owner', name: 'مدير النظام', email: 'owner@yourrest.org', active: true},
    {crmMemberId: 'rep-a', name: 'مندوب الشرقية', email: 'rep-a@yourrest.org', active: true},
    {crmMemberId: 'rep-b', name: 'مندوب جدة', email: 'rep-b@yourrest.org', active: true},
  ]}, 'the body: every active member who may ask, names cleaned, emails lower-cased; the deactivated one left out');
  const first = audits().at(-1);
  eq([first.mode, first.reason, first.eligible, first.sent, first.inserted, first.activeSalesmen, first.deactivatedIds], ['full', 'first', 3, 3, 3, 3, []], 'audited with counts');
  ok(!/مندوب الشرقية|مندوب جدة|مدير النظام|@/.test(JSON.stringify(audits())), 'no name and no email in the audit');
  eq([(await stored()).routeMissingAt, (await stored()).fullAt, Object.keys((await stored()).sent).sort()], [null, at(61 + 24 * 60 + 61)(), ['owner', 'rep-a', 'rep-b']], 'the state: the full\'s time and who was sent');
  eq((await sync(61 + 24 * 60 + 70)).reason, 'unchanged', 'nothing changed: nothing sent');
  sql.prepare("UPDATE crm_members SET active=0 WHERE id='rep-b'").run();
  sql.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('rep-a',?,?,1,'owner',?)").run(JSON.stringify({'mold-requests:add': false}), '[]', created);
  result = await sync(61 + 24 * 60 + 71);
  eq([result.sent, result.mode, result.result.updated, result.result.activeSalesmen], [true, 'upsert', 2, 1], 'a member deactivated and one whose «إضافة» was switched off: an upsert with both active:false');
  eq(JSON.parse(mock.state.calls.filter(call => call.route === 'salesmen').at(-1).body).salesmen.map(entry => [entry.crmMemberId, entry.active]), [['rep-a', false], ['rep-b', false]], 'active:false, by id');
  sql.prepare("DELETE FROM crm_member_permissions WHERE member_id='rep-a'").run();
  sql.prepare("UPDATE crm_members SET active=1 WHERE id='rep-b'").run();
  sql.prepare("DELETE FROM crm_members WHERE id='rep-b'").run();
  result = await sync(61 + 24 * 60 + 72);
  eq([result.mode, result.reason, result.result.inserted, result.result.updated], ['upsert', 'changed', 0, 1], 'the permission given back: an upsert of that one');
  sql.prepare("UPDATE crm_members SET name='مندوب الشرقية الجديد' WHERE id='rep-a'").run();
  mock.state.down = true;
  result = await sync(61 + 24 * 60 + 73);
  eq([result.sent, result.reason, result.error], [false, 'failed', 'network'], 'production unreachable: failed, nothing recorded as sent');
  eq([lines.at(-1)[0], JSON.parse(lines.at(-1)[1]).code], ['warn', 'network'], 'one warning with the code');
  await sync(61 + 24 * 60 + 74);
  eq(lines.filter(line => line[0] === 'warn').length, 1, 'a warning an hour at most');
  mock.state.down = false;
  result = await sync(61 + 24 * 60 + 75);
  eq([result.mode, JSON.parse(mock.state.calls.filter(call => call.route === 'salesmen').at(-1).body).salesmen.map(entry => entry.name)], ['upsert', ['مندوب الشرقية الجديد']], 'production back: the change made meanwhile goes');
  addMember('rep-c', 'rep', 'مندوب جديد', 'rep-c@yourrest.org');
  mock.answerNext('salesmen', 400, {error: {code: 'invalid_payload', message: 'x', fields: ['salesmen.0.name']}});
  result = await sync(61 + 24 * 60 + 76 + 60);
  eq([result.sent, result.error, result.fields, (await stored()).lastError.fields], [false, 'invalid_payload', ['salesmen.0.name'], ['salesmen.0.name']], 'a real refusal: a failure with its field, kept, tried again at the next check');
  result = await sync(61 + 24 * 60 + 77 + 60);
  eq([result.sent, result.mode, (await stored()).lastError], [true, 'upsert', null], 'tried again: sent');
  sql.prepare("DELETE FROM crm_members WHERE id='rep-c'").run();
  result = await sync(61 + 24 * 60 + 80 + 60);
  eq([result.mode, result.reason, result.result.deactivated, result.deactivatedIds, mock.state.salesmen.get('rep-c').active], ['full', 'removed', 1, ['rep-c'], false], 'a member sent before and deleted since: a full list, which deactivates them there');
  eq(audits().at(-1).deactivatedIds, ['rep-c'], 'the audit line names the ids deactivated');
  eq((await sync(61 + 24 * 60 + 81 + 60)).reason, 'unchanged', 'and nothing after it');
  result = await sync(61 + 2 * 24 * 60 + 200);
  eq([result.mode, result.reason, result.result.deactivated, result.deactivatedIds], ['full', 'daily', 0, []], 'a day later: the whole list again');
  const all = lines.map(line => line[1]).join('\n') + JSON.stringify(audits()) + JSON.stringify(await stored());
  ok(!all.includes(mock.state.secret), 'the secret is in no log line, audit line or state');
} finally { await mock.stop(); }

console.log(JSON.stringify({ok: true, checks}));
