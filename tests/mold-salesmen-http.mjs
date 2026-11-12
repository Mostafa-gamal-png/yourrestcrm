// The CRM's salesmen for the products application (lib/mold-salesmen-server.ts, the `salesmen` route of 2026-11-12) over real HTTP
// against the BUILT release (run `pnpm build` first), sending to the stand-in production API (scripts/lib/products-mock.mjs): before
// the products release (the route answers 400 invalid_payload, fields ["route"]) the first page load asks once, nothing is recorded as an
// error, one info line is logged and nothing is asked again within the hour; once the route is there the next check sends the whole list
// as `full` (every active member who may file a mold request: names as the users screen shows them, emails lower-case); a member edited
// through the team page, a member added, deactivated, or whose «إضافة» of «طلبات تصنيع القوالب» is switched off goes a few seconds later
// as `upsert` (active:false for the last two); nothing is sent when nothing changed; the whole list again a day after the last full and
// not before; each send is one audit line with counts and ids (no name, no email); the secret is in no log. Synthetic data only.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';

const members = [{id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'مدير  المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'sm', name: 'مشرف الشرقية'}, {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'مندوب الشرقية'}];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const until = async (condition, what, ms = 25_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 250)); } throw new Error('timed out waiting for ' + what); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const mock = await startProductsMock();
const settings = {YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret, NODE_EXTRA_CA_CERTS: mock.ca};
const app = await bootBuiltApp({members}, {env: settings});
const sends = () => mock.state.calls.filter(call => call.route === 'salesmen');
const bodyOf = call => JSON.parse(call.body);
try {
  const owner = app.as(await app.login('owner'));
  const audit = async () => (await app.db.prepare("SELECT detail FROM crm_audit WHERE record_id='mold-salesmen' AND action='mold-salesmen:sync' ORDER BY created_at").all()).results.map(row => JSON.parse(row.detail));
  const state = async () => JSON.parse((await app.db.prepare("SELECT owner_id AS state FROM crm_settings WHERE id='mold-salesmen'").first())?.state ?? 'null');
  const setState = async change => app.db.prepare("UPDATE crm_settings SET owner_id=? WHERE id='mold-salesmen'").bind(JSON.stringify({...await state(), ...change})).run();
  const team = async () => (await owner('/api/crm')).json().members;
  const saveMember = async (id, change) => { const old = (await team()).find(member => member.id === id); const {editToken, ...data} = old; return owner('/api/crm', {method: 'POST', body: {action: 'member', memberSnapshot: editToken, data: {id: data.id, name: data.name, email: data.email, role: data.role, branch: data.branch, supervisorId: data.supervisorId || '', regionScope: data.regionScope || 'all', active: data.active, target: data.target || 0, ...change}}}); };

  // ---- before the products release: asked once, «not available yet», no error, not asked again within the hour
  check(sends().length, 0, 'nothing sent before the server is used');
  check((await owner('/api/crm')).status, 200, 'the page loads');
  await until(() => sends().length === 1, 'the first salesmen call');
  check([bodyOf(sends()[0]).mode, sends()[0].answer.http, sends()[0].answer.body.error.fields], ['full', 400, ['route']], 'the whole list as full; the products application before its release answers 400 fields ["route"]');
  await until(async () => (await state())?.routeMissingAt, 'the state noting the missing route');
  check(await audit(), [], 'not recorded as a send');
  await until(() => /route_not_available_yet/.test(app.log()), 'the info line');
  check(app.log().match(/route_not_available_yet/g).length, 1, 'one info line');
  ok(!/"status":"failed"|CRM request failed/.test(app.log()), 'no error in the log');
  check((await saveMember('rep', {name: 'مندوب الشرقية الأول'})).status, 200, 'a member edited while the route is missing: saved');
  await pause(6_500);
  check(sends().length, 1, 'within the hour: production is not asked again');

  // ---- the route released: the next check after the hour sends the whole list as full
  mock.setSalesmen(true);
  await setState({routeMissingAt: new Date(Date.now() - 61 * 60_000).toISOString()});
  check((await saveMember('rep', {name: 'مندوب   الشرقية'})).status, 200, 'another edit an hour later');
  await until(() => sends().length === 2, 'the full list once the route is there');
  const full = bodyOf(sends()[1]);
  check(full, {mode: 'full', salesmen: [
    {crmMemberId: 'owner', name: 'مدير النظام', email: 'owner@yourrest.org', active: true},
    {crmMemberId: 'rep', name: 'مندوب الشرقية', email: 'rep@yourrest.org', active: true},
    {crmMemberId: 'sm', name: 'مدير المبيعات', email: 'sm@yourrest.org', active: true},
    {crmMemberId: 'sup', name: 'مشرف الشرقية', email: 'sup@yourrest.org', active: true},
  ]}, 'every active member who may file a mold request, by id, names with single spaces, emails lower-case');
  check(sends()[1].answer.body, {received: 4, inserted: 4, updated: 0, deactivated: 0, deactivatedIds: [], activeSalesmen: 4}, 'production holds the four');
  ok(sends()[1].signed, 'signed with the shared secret');
  await until(async () => (await audit()).length === 1, 'the audit line');
  const [first] = await audit();
  check([first.mode, first.reason, first.eligible, first.sent, first.inserted, first.activeSalesmen, first.deactivatedIds], ['full', 'first', 4, 4, 4, 4, []], 'audited: counts and ids');
  ok(!/مدير النظام|مندوب الشرقية|@yourrest/.test(JSON.stringify(await audit())), 'no name and no email in the audit');
  await until(() => /route_available/.test(app.log()), 'the log says the route is there');

  // ---- unchanged: nothing sent
  await owner('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', data: {name: 'مصنع للاختبار', city: 'الدمام', region: 'الشرقية', assignedTo: 'rep', branch: 'الرئيسي'}}});
  await pause(6_500);
  check(sends().length, 2, 'a write that changes no member: nothing sent');

  // ---- a member edited: an upsert of that one
  check((await saveMember('sup', {name: 'مشرف المنطقة الشرقية', email: 'Sup@Yourrest.org'})).status, 200, 'the supervisor renamed');
  await until(() => sends().length === 3, 'the upsert after the edit');
  check(bodyOf(sends()[2]), {mode: 'upsert', salesmen: [{crmMemberId: 'sup', name: 'مشرف المنطقة الشرقية', email: 'sup@yourrest.org', active: true}]}, 'only the edited member, as upsert');
  check([sends()[2].answer.body.updated, mock.state.salesmen.get('sup').name], [1, 'مشرف المنطقة الشرقية'], 'production updated them');

  // ---- a member added: an upsert of the new one
  check((await owner('/api/crm', {method: 'POST', body: {action: 'member', data: {name: 'مندوب جدة', email: 'rep.jeddah@yourrest.org', role: 'rep', branch: 'الرئيسي', supervisorId: 'sup', regionScope: 'all', active: 1, target: 0}}})).status, 200, 'a member added');
  await until(() => sends().length === 4, 'the upsert after the new member');
  const added = bodyOf(sends()[3]);
  check([added.mode, added.salesmen.length, added.salesmen[0].name, added.salesmen[0].email, added.salesmen[0].active, /^[A-Za-z0-9_-]{1,64}$/.test(added.salesmen[0].crmMemberId)], ['upsert', 1, 'مندوب جدة', 'rep.jeddah@yourrest.org', true, true], 'the new member by their crm_members id');
  const jeddah = added.salesmen[0].crmMemberId;

  // ---- deactivated, and «إضافة» switched off: each sent active:false
  check((await saveMember(jeddah, {active: 0})).status, 200, 'the new member deactivated');
  await until(() => sends().length === 5, 'the upsert after the deactivation');
  check(bodyOf(sends()[4]), {mode: 'upsert', salesmen: [{crmMemberId: jeddah, name: 'مندوب جدة', email: 'rep.jeddah@yourrest.org', active: false}]}, 'sent active:false with their name');
  check(mock.state.salesmen.get(jeddah).active, false, 'production holds them as inactive');
  check((await owner('/api/crm', {method: 'POST', body: {action: 'permissions', memberId: 'sm', version: 0, cells: {'mold-requests:add': false}, hidden: [], viewAll: false, requestId: crypto.randomUUID()}})).status, 200, '«إضافة» of «طلبات تصنيع القوالب» switched off for the sales manager');
  await until(() => sends().length === 6, 'the upsert after the permission change');
  check(bodyOf(sends()[5]).salesmen.map(entry => [entry.crmMemberId, entry.active]), [['sm', false]], 'the sales manager sent active:false');
  check(sends()[5].answer.body.activeSalesmen, 3, 'three active salesmen left there');
  await until(async () => (await audit()).length === 5, 'five audit lines');
  check((await audit()).map(entry => entry.mode), ['full', 'upsert', 'upsert', 'upsert', 'upsert'], 'each send that went through audited (the refusal of the route before its release is not)');

  // ---- the daily full list: not before a day has passed, then the whole list (the inactive ones left out)
  await setState({fullAt: new Date(Date.now() - 23 * 3600_000).toISOString()});
  await saveMember('rep', {target: 5});
  await pause(6_500);
  check(sends().length, 6, '23 hours after the last full and nothing changed: nothing sent');
  await setState({fullAt: new Date(Date.now() - 25 * 3600_000).toISOString()});
  await saveMember('rep', {target: 6});
  await until(() => sends().length === 7, 'the daily full list');
  check([bodyOf(sends()[6]).mode, bodyOf(sends()[6]).salesmen.map(entry => entry.crmMemberId)], ['full', ['owner', 'rep', 'sup']], 'a day later: the whole list, only who may ask');
  check([sends()[6].answer.body.deactivated, sends()[6].answer.body.deactivatedIds], [0, []], 'nobody left to deactivate');
  await until(async () => (await audit()).length === 6, 'the sixth audit line');
  check((await audit()).at(-1).reason, 'daily', 'audited as the daily list');

  // ---- no secret anywhere it could leak
  ok(!app.log().includes(mock.state.secret), 'the secret is in no log line');
  ok(!JSON.stringify(await audit()).includes(mock.state.secret) && !JSON.stringify(await state()).includes(mock.state.secret), 'nor in the audit or the state');
} finally { await app.stop(); }

// ---- a release that never sent (an empty state) and production with the route: its first check sends the whole list at once
const fresh = await bootBuiltApp({members}, {env: settings});
try {
  const before = sends().length;
  check((await fresh.as(await fresh.login('owner'))('/api/crm')).status, 200, 'a fresh release: the page loads');
  await until(() => sends().length === before + 1, 'the first full list of the fresh release');
  check([bodyOf(sends().at(-1)).mode, sends().at(-1).answer.http, bodyOf(sends().at(-1)).salesmen.length], ['full', 200, 4], 'its first check sends the whole list');
} finally { await fresh.stop(); }

// ---- without the link settings: nothing is sent, the CRM works
const plain = await bootBuiltApp({members}, {env: {NODE_EXTRA_CA_CERTS: mock.ca}});
try {
  const calls = mock.state.calls.length, owner = plain.as(await plain.login('owner'));
  check((await owner('/api/crm')).status, 200, 'the page loads');
  await pause(6_500);
  check(mock.state.calls.length - calls, 0, 'nothing sent without the settings');
} finally { await plain.stop(); await mock.stop(); }

console.log(JSON.stringify({ok: true, checks, builtRelease: true, realProductionTested: false}));
