// «تنبيه المصانع القريبة» on the server (lib/nearby-customers*.ts, GET /api/nearby-customers; the owner, 2026-11-16, item 7 of the GSCO
// comparison list): the pure rules (60 days or more since the latest visit, never visited, the Riyadh day, the customer's own, a saved
// location, the list's shape and limit), then the route and the reader on an isolated in-memory SQLite (every drizzle migration; the route
// compiled as the build does, the session faked): 401 anonymous, 403 for every role but a representative and for a revoked account, 404
// when «العملاء» is hidden; a representative's list is exactly their own customers in their regions with a location and no visit for 60
// days or more (exactly 60 in, 59 out; any member's visit counts, a visit under a request too, a call does not; a deleted visit or
// customer is gone), the Riyadh midnight, 2000 customers and not one more. Synthetic people only; no build, no network, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'nearby-customers-')), seen = new Set();
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
function compile(relative) {
  if (seen.has(relative)) return; seen.add(relative);
  const src = path.join(root, relative), dest = path.join(out, relative.replace(/\.tsx?$/, '.mjs'));
  fs.mkdirSync(path.dirname(dest), {recursive: true});
  let code = ts.transpileModule(fs.readFileSync(src, 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  code = code.replace(/from (['"])([^'"]+)\1/g, (match, q, imp) => {
    if (imp === 'cloudflare:workers') return 'from ' + JSON.stringify(path.join(out, 'env.mjs'));
    if (imp === '@/app/application-auth') return 'from ' + JSON.stringify(path.join(out, 'auth.mjs'));
    if (!imp.startsWith('.') && !imp.startsWith('@/')) return match;
    let source = imp.startsWith('@/') ? imp.slice(2) : path.relative(root, path.resolve(path.dirname(src), imp));
    if (!/\.tsx?$/.test(source)) source += fs.existsSync(path.join(root, source + '.ts')) ? '.ts' : '.tsx';
    compile(source);
    return 'from ' + JSON.stringify(path.join(out, source.replace(/\.tsx?$/, '.mjs')));
  });
  fs.writeFileSync(dest, code);
}
// The environment is read when a request comes, so the modules can be imported before the database exists.
fs.writeFileSync(path.join(out, 'env.mjs'), 'export const env=new Proxy({},{get:(_,key)=>globalThis.testEnv?.[key]});');
fs.writeFileSync(path.join(out, 'auth.mjs'), `export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=?').bind(u.userId).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
compile('app/api/nearby-customers/route.ts');
const rules = await import(pathToFileURL(path.join(out, 'lib/nearby-customers.mjs')));
const server = await import(pathToFileURL(path.join(out, 'lib/nearby-customers-server.mjs')));
const route = await import(pathToFileURL(path.join(out, 'app/api/nearby-customers/route.mjs')));
const crmServer = await import(pathToFileURL(path.join(out, 'lib/crm-server.mjs')));

// ---- 1. The pure rules.
eq([rules.NEARBY_VISIT_DAYS, rules.NEARBY_RADIUS_METERS, rules.NEARBY_CATALOG_TTL_SECONDS, rules.NEARBY_REFRESH_SECONDS, rules.NEARBY_CUSTOMER_LIMIT], [60, 1000, 600, 300, 2000], 'the owner\'s numbers and GSCO\'s timings');
eq([rules.riyadhDay('2026-11-16T20:59:59.999Z'), rules.riyadhDay('2026-11-16T21:00:00.000Z'), rules.riyadhDay('2026-11-16T00:00:00.000Z')], ['2026-11-16', '2026-11-17', '2026-11-16'], 'the day in Riyadh (UTC+3): 23:59:59 is the same day, midnight the next');
eq([rules.calendarDay('2026-02-28'), rules.calendarDay('2026-02-29'), rules.calendarDay('2028-02-29'), rules.calendarDay('2026-13-01'), rules.calendarDay('26-01-01'), rules.calendarDay(20260101), rules.calendarDay(null)], ['2026-02-28', '', '2028-02-29', '', '', '', ''], 'only real calendar days');
eq([rules.daysBetween('2026-01-01', '2026-03-01'), rules.daysBetween('2028-01-01', '2028-03-01'), rules.daysBetween('2025-12-31', '2026-01-01'), rules.daysBetween('2026-03-02', '2026-03-01'), rules.daysBetween('x', '2026-03-01')], [59, 60, 1, -1, null], 'whole days, across months, a leap year and a new year');
const today = '2026-11-16';
eq([rules.needsVisit('2026-09-17', today), rules.needsVisit('2026-09-18', today), rules.needsVisit('2026-09-16', today), rules.needsVisit(null, today), rules.needsVisit('', today), rules.needsVisit('2026-11-20', today)],
  [true, false, true, true, true, false], 'exactly 60 days: needs a visit; 59: not; 61: needs; never visited: needs; a date after today: a recent visit');
const me = {id: 'rep1', regionScope: 'eastern'};
const customer = (id, data = {}, assignedTo = 'rep1', kind = 'customer') => ({id, kind, assignedTo, data: {name: 'مصنع ' + id, region: 'الشرقية', latitude: 26.43, longitude: 50.03, phone: '0551234567', email: 'secret@example.com', contact: 'أبو محمد', code: 'C-1', address: 'حي سري', notes: 'ملاحظة خاصة', ...data}});
eq(rules.nearbyCustomer(customer('c1'), me, '2026-09-17', today), {id: 'c1', name: 'مصنع c1', latitude: 26.43, longitude: 50.03, daysSinceVisit: 60}, 'exactly the fields a notice needs: no phone, e-mail, contact, code, address or note');
eq(rules.nearbyCustomer(customer('c1'), me, null, today), {id: 'c1', name: 'مصنع c1', latitude: 26.43, longitude: 50.03, daysSinceVisit: null}, 'never visited: null days');
eq(rules.nearbyCustomer(customer('c1'), me, '2026-09-18', today), null, '59 days: not in the list');
eq(rules.nearbyCustomer(customer('c1', {}, 'rep2'), me, null, today), null, 'another representative\'s customer: never');
eq(rules.nearbyCustomer(customer('c1', {region: 'الغربية'}), me, null, today), null, 'their customer outside their regions: not');
eq(rules.nearbyCustomer(customer('c1', {region: 'الغربية'}), {id: 'rep1', regionScope: 'eastern,western'}, null, today)?.id, 'c1', 'inside one of several regions: yes');
eq(rules.nearbyCustomer(customer('c1', {latitude: null, longitude: null, location: ''}), me, null, today), null, 'no saved location: not');
eq(rules.nearbyCustomer(customer('c1', {latitude: null, longitude: null, location: 'https://maps.google.com/?q=26.5,50.1'}), me, null, today)?.latitude, 26.5, 'a location saved as a maps link, as the map reads it');
eq(rules.nearbyCustomer(customer('c1', {latitude: 0, longitude: 0, location: ''}), me, null, today), null, '0,0 is no location');
eq(rules.nearbyCustomer(customer('c1', {name: '  مصنع\n  الأمل  '}), me, null, today)?.name, 'مصنع الأمل', 'the name on one line');
eq(rules.nearbyCustomer(customer('c1', {name: '   '}), me, null, today), null, 'no name: not');
eq(rules.nearbyCustomer(customer('c 1'), me, null, today), null, 'an id the app would refuse is left out (it would refuse the whole list)');
eq(rules.nearbyCustomer(customer('c1', {}, 'rep1', 'factory'), me, null, today), null, 'a machine is not a customer');
const many = n => Array.from({length: n}, (_, i) => ({customer: customer('c' + String(i).padStart(5, '0')), lastVisit: null}));
const catalog = rules.nearbyCatalog(me, 'eastern', [{customer: customer('b'), lastVisit: null}, {customer: customer('a'), lastVisit: '2026-01-01'}, {customer: customer('z'), lastVisit: '2026-11-15'}], '2026-11-16T09:00:00.000Z');
eq(catalog, {schemaVersion: 1, memberId: 'rep1', memberRole: 'rep', regionScope: 'eastern', serverTime: '2026-11-16T09:00:00.000Z', expiresAt: '2026-11-16T09:10:00.000Z', refreshAfterSeconds: 300,
  customers: [{id: 'a', name: 'مصنع a', latitude: 26.43, longitude: 50.03, daysSinceVisit: 319}, {id: 'b', name: 'مصنع b', latitude: 26.43, longitude: 50.03, daysSinceVisit: null}]}, 'the answer: by id, valid ten minutes, asked again after five');
eq(rules.nearbyCatalog(me, 'eastern', many(2000), '2026-11-16T09:00:00.000Z').customers.length, 2000, '2000 customers are listed');
assert.throws(() => rules.nearbyCatalog(me, 'eastern', many(2001), '2026-11-16T09:00:00.000Z'), RangeError, 'one more is refused, never cut'); checks++;

// ---- 2. The route and the reader on an isolated database.
const sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON');
for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter(name => /^\d+.*\.sql$/.test(name)).sort()) sql.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8'));
class Statement { constructor(q, a = []) { this.q = q; this.a = a; } bind(...a) { return new Statement(this.q, a); } async run() { const r = sql.prepare(this.q).run(...this.a); return {meta: {changes: Number(r.changes)}}; } async all() { return {results: sql.prepare(this.q).all(...this.a).map(row => ({...row}))}; } async first() { const row = sql.prepare(this.q).get(...this.a); return row ? {...row} : null; } }
const DB = {prepare: q => new Statement(q), batch: async statements => { sql.exec('BEGIN'); try { const results = []; for (const s of statements) results.push(await s.run()); sql.exec('COMMIT'); return results; } catch (e) { sql.exec('ROLLBACK'); throw e; } }};
globalThis.testEnv = {DB, YR_APP_ORIGIN: 'https://test.invalid'};
const nowIso = new Date().toISOString(), day = rules.riyadhDay(nowIso);
const back = n => new Date(Date.parse(day + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
const member = (id, role, supervisor = null, region = 'eastern', active = 1) => sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,?,0,?)').run(id, 'u-' + id, id + '@yourrest.org', 'اسم ' + id, role, 'الرئيسي', supervisor, region, active, '2026-01-01T00:00:00.000Z');
member('owner', 'admin', null, 'all'); member('mgr', 'manager', null, 'all'); member('sup', 'supervisor', 'mgr'); member('rep1', 'rep', 'sup'); member('rep2', 'rep', 'sup'); member('repw', 'rep', 'sup', 'western');
member('reph', 'rep', 'sup'); member('gone', 'rep', 'sup', 'eastern', 0); member('cs', 'customer_service', 'mgr'); member('csm', 'customer_service_manager', 'mgr');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
sql.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_at,updated_by) VALUES('reph','{}','[\"customer\"]',1,?,'owner')").run(nowIso);
const record = (id, kind, parent, assigned, data, at = nowIso) => sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').run(id, kind, parent, assigned, 'الرئيسي', JSON.stringify(data), at, at);
const place = (id, assigned = 'rep1', data = {}) => record(id, 'customer', null, assigned, {name: 'مصنع ' + id, region: 'الشرقية', city: 'الدمام', location: '26.43, 50.03', latitude: 26.43, longitude: 50.03, customerStatus: 'نشط', phone: '0551234567', email: 'factory@example.com', contact: 'أبو محمد', ...data});
const visit = (id, by, parent, date, extra = {}) => record(id, 'activity', parent, by, {type: 'visit', ...(date === null ? {} : {date}), summary: 'زيارة', result: 'تمت', performedBy: by, responsibleId: by, recordedByEmail: by + '@yourrest.org', ...extra}, extra.at || nowIso);
place('c-60'); visit('v-60', 'rep1', 'c-60', back(60)); visit('v-90', 'rep1', 'c-60', back(90));
place('c-59'); visit('v-59', 'rep1', 'c-59', back(59));
place('c-never');
place('c-noloc', 'rep1', {location: '', latitude: null, longitude: null});
place('c-text', 'rep1', {location: '26.5, 50.1', latitude: null, longitude: null}); visit('v-text', 'rep1', 'c-text', back(200));
place('c-other'); visit('v-other-old', 'rep1', 'c-other', back(61)); visit('v-other-sup', 'sup', 'c-other', back(10));
place('c-request'); record('o-request', 'opportunity', 'c-request', 'rep1', {stage: 'new', moldType: 'قالب', product: 'بلوك', dimensions: '20', quantity: 1, responsibleId: 'rep1'}); visit('v-request', 'rep1', 'o-request', back(10));
place('c-machine'); record('m-machine', 'factory', 'c-machine', 'rep1', {name: 'ماكينة', recordType: 'machine'}); visit('v-machine', 'rep1', 'm-machine', back(5));
place('c-call'); record('k-call', 'activity', 'c-call', 'rep1', {type: 'call', date: back(5), summary: 'اتصال', performedBy: 'rep1'});
place('c-west', 'rep1', {region: 'الغربية'});
place('c-deleted-visit'); visit('v-deleted', 'rep1', 'c-deleted-visit', back(3)); sql.prepare("DELETE FROM crm_records WHERE id='v-deleted'").run();
place('c-deleted'); sql.prepare("DELETE FROM crm_records WHERE id='c-deleted'").run();
place('c-future'); visit('v-future', 'rep1', 'c-future', back(-3));
place('c-nodate'); visit('v-nodate', 'rep1', 'c-nodate', null, {at: new Date(Date.parse(day + 'T12:00:00Z') - 70 * 86400000).toISOString()});
place('c-baddate'); visit('v-baddate', 'rep1', 'c-baddate', '2026-02-30', {at: new Date(Date.parse(day + 'T12:00:00Z') - 2 * 86400000).toISOString()});
place('c-rep2', 'rep2'); place('c-w', 'repw', {region: 'الغربية'});

const as = id => { globalThis.testUser = id ? {userId: 'u-' + id, email: id + '@yourrest.org', fullName: id} : null; };
const get = async (id, status = 200) => {
  as(id);
  const response = await route.GET(new Request('https://test.invalid/api/nearby-customers')), data = await response.json();
  eq(response.status, status, (id || 'anonymous') + ' GET /api/nearby-customers -> ' + JSON.stringify(data).slice(0, 200));
  if (status === 200) eq(response.headers.get('cache-control'), 'no-store', 'never cached');
  return data;
};
// The doors.
eq((await get(null, 401)).error, 'سجّل الدخول للوصول إلى التطبيق.', 'anonymous: 401');
for (const id of ['owner', 'mgr', 'sup', 'cs', 'csm']) eq((await get(id, 403)).error, 'تنبيه المصانع القريبة متاح لحساب المندوب فقط.', id + ': 403, for the representative only');
eq((await get('reph', 404)).error, 'هذا الجزء غير متاح لحسابك. راجع مدير النظام.', '«العملاء» hidden from a representative: 404, like the screen');
eq((await get('gone', 403)).error, 'حسابك غير مضاف إلى فريق يورست. تواصل مع مدير النظام.', 'a deactivated representative: 403');
eq(route.POST, undefined, 'GET only');
// The representative's own list.
let data = await get('rep1');
eq([data.schemaVersion, data.memberId, data.memberRole, data.regionScope, data.refreshAfterSeconds, Date.parse(data.expiresAt) - Date.parse(data.serverTime)], [1, 'rep1', 'rep', 'eastern', 300, 600000], 'the answer names the account, its regions and its lease');
eq(Object.keys(data).sort(), ['customers', 'expiresAt', 'memberId', 'memberRole', 'refreshAfterSeconds', 'regionScope', 'schemaVersion', 'serverTime'], 'nothing more');
const byId = Object.fromEntries(data.customers.map(row => [row.id, row.daysSinceVisit]));
eq(data.customers.map(row => row.id), ['c-60', 'c-call', 'c-deleted-visit', 'c-never', 'c-nodate', 'c-text'], 'exactly their customers that need a visit and have a location, by id');
eq(byId, {'c-60': 60, 'c-call': null, 'c-deleted-visit': null, 'c-never': null, 'c-nodate': 70, 'c-text': 200}, 'the days since the latest visit (a visit with no day: the day it was stored), or null for never visited');
ok(!('c-baddate' in byId), 'a visit whose day is not a real date counts by the day it was stored (two days ago)');
ok(!('c-59' in byId), '59 days: not yet');
ok(!('c-other' in byId), 'another member\'s visit 10 days ago counts: the customer was visited');
ok(!('c-request' in byId) && !('c-machine' in byId), 'a visit recorded under a request or a machine counts');
ok(!('c-noloc' in byId) && !('c-west' in byId) && !('c-rep2' in byId) && !('c-w' in byId) && !('c-deleted' in byId) && !('c-future' in byId), 'no location, outside their regions, another representative\'s, deleted, or a visit dated after today: not listed');
eq(Object.keys(data.customers[0]).sort(), ['daysSinceVisit', 'id', 'latitude', 'longitude', 'name'], 'a row: the id, the name, the place and the days only');
ok(!JSON.stringify(data).includes('0551234567') && !JSON.stringify(data).includes('example.com') && !JSON.stringify(data).includes('أبو محمد'), 'no phone, e-mail or contact');
eq(data.customers.find(row => row.id === 'c-text').latitude, 26.5, 'a location saved as text, as the map reads it');
eq((await get('rep2')).customers.map(row => row.id), ['c-rep2'], 'another representative: their own only');
eq((await get('repw')).customers.map(row => [row.id, row.daysSinceVisit]), [['c-w', null]], 'a western representative: their own in their region');
// The same customer once visited: it leaves the list at once.
visit('v-today', 'rep2', 'c-never', day);
ok(!(await get('rep1')).customers.some(row => row.id === 'c-never'), 'visited today (by anyone): no longer listed');
// Reassigned: it moves to the new representative.
sql.prepare("UPDATE crm_records SET assigned_to='rep2' WHERE id='c-60'").run();
eq([(await get('rep1')).customers.some(row => row.id === 'c-60'), (await get('rep2')).customers.map(row => row.id)], [false, ['c-60', 'c-rep2']], 'reassigned: it follows the customer\'s representative');
sql.prepare("UPDATE crm_records SET assigned_to='rep1' WHERE id='c-60'").run();

// ---- 3. The reader at a fixed moment: the Riyadh midnight decides the day.
place('c-mid', 'rep2'); visit('v-mid', 'rep2', 'c-mid', '2026-01-01');
const read = async (id, at) => { as(id); return server.readNearbyCustomers(await crmServer.context({load: 'identity'}), at); };
const mid = async at => (await read('rep2', at)).customers.find(row => row.id === 'c-mid')?.daysSinceVisit ?? 'not listed';
eq(await mid('2026-03-01T20:59:59.000Z'), 'not listed', '23:59:59 on 1 March in Riyadh: 59 days after 1 January');
eq(await mid('2026-03-01T21:00:00.000Z'), 60, 'midnight in Riyadh (21:00 UTC): 2 March, 60 days');
eq(await mid('2026-03-02T12:00:00.000Z'), 60, 'noon the same day');
// A revoked account between the session check and the read: the sentinel tells it from an empty list.
as('rep2');
const c = await crmServer.context({load: 'identity'});
sql.prepare("UPDATE crm_members SET active=0 WHERE id='rep2'").run();
await assert.rejects(server.readNearbyCustomers(c), error => error.status === 403 && error.message === 'تغيّرت صلاحيات حسابك. سجّل الدخول من جديد.', 'revoked meanwhile: 403'); checks++;
sql.prepare("UPDATE crm_members SET active=1 WHERE id='rep2'").run();
sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='rep2'").run();
await assert.rejects(server.readNearbyCustomers(c), error => error.status === 403, 'regions changed meanwhile: 403'); checks++;
sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='rep2'").run();
await assert.rejects(server.readNearbyCustomers(c), error => error.status === 403, 'each change raised the account\'s sign-in version (drizzle/0009): the old reading stays refused'); checks++;
eq((await get('rep2')).memberId, 'rep2', 'restored, a new request: the list again');
// An empty list is a valid answer, not a refusal.
member('rep0', 'rep', 'sup');
eq((await get('rep0')).customers, [], 'a representative with no customer: an empty list, 200');

// ---- 4. 2000 customers are listed; one more is refused whole (503), never cut.
member('repbig', 'rep', 'sup');
const insertMany = sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,NULL,?,?,?,?,?,1)');
for (let i = 0; i < 2000; i++) insertMany.run('big-' + String(i).padStart(4, '0'), 'customer', 'repbig', 'الرئيسي', JSON.stringify({name: 'مصنع ' + i, region: 'الشرقية', latitude: 26 + i / 10000, longitude: 50}), nowIso, nowIso);
eq((await get('repbig')).customers.length, 2000, '2000 customers: all listed');
insertMany.run('big-2000', 'customer', 'repbig', 'الرئيسي', JSON.stringify({name: 'مصنع أخير', region: 'الشرقية', latitude: 26.3, longitude: 50}), nowIso, nowIso);
eq((await get('repbig', 503)).error, 'تعذّر تحديث قائمة المصانع القريبة كاملة. حاول لاحقًا.', '2001: refused whole');

console.log(JSON.stringify({ok: true, checks, syntheticFixtures: true, productionDataUsed: false}));
