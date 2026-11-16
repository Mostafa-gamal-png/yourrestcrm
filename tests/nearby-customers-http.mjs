// «تنبيه المصانع القريبة» (GET /api/nearby-customers, lib/nearby-customers*.ts) over real HTTP against the BUILT release (run the build
// first): anonymous 401 (and after signing out), every role but a representative 403, a representative whose «العملاء» is hidden 404, a
// POST 405, never cached; asked as the Android app asks it (the session cookie, no Origin); a representative reads exactly their own
// customers with a location and no visit for 60 days or more (exactly 60 in, 59 out, never visited in, another member's recent visit out,
// another representative's and another region's out), only the fields a notice needs; a visit recorded today takes a customer out at
// once; a deactivated representative is refused. Synthetic fixtures only: temporary SQLite, mocked mail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'},
  {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', region: 'eastern', name: 'المشرف سالم'},
  {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'},
  {id: 'rep2', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب بدر'},
  {id: 'repw', role: 'rep', sup: 'sup', region: 'western', name: 'مندوب الغربية'},
  {id: 'reph', role: 'rep', sup: 'sup', region: 'eastern', name: 'مندوب بلا عملاء'},
  {id: 'csm', role: 'customer_service_manager', sup: 'mgr', name: 'مدير خدمة العملاء'},
  {id: 'cs', role: 'customer_service', sup: 'csm', name: 'خدمة العملاء'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const app = await bootBuiltApp({members});
try {
  const now = new Date().toISOString(), today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date());
  const back = n => new Date(Date.parse(today + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
  const insert = (id, kind, parent, assigned, data) => app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id, kind, parent, assigned, 'الرئيسي', JSON.stringify(data), now, now).run();
  const customer = (id, assigned, data = {}) => insert(id, 'customer', null, assigned, {name: 'مصنع ' + id, region: 'الشرقية', city: 'الدمام', location: '26.43, 50.03', latitude: 26.43, longitude: 50.03, customerStatus: 'نشط', phone: '0551234567', email: 'factory@example.com', contact: 'أبو محمد', code: 'C-' + id, ...data});
  const visit = (id, by, customerId, date) => insert(id, 'activity', customerId, by, {type: 'visit', date, summary: 'تعريف بالمنتجات', result: 'العميل مهتم', performedBy: by, responsibleId: by, recordedByEmail: by + '@yourrest.org'});
  await customer('due60', 'rep1'); await visit('v60', 'rep1', 'due60', back(60));
  await customer('recent59', 'rep1'); await visit('v59', 'rep1', 'recent59', back(59));
  await customer('never', 'rep1');
  await customer('nowhere', 'rep1', {location: '', latitude: null, longitude: null});
  await customer('bysup', 'rep1'); await visit('vold', 'rep1', 'bysup', back(100)); await visit('vsup', 'sup', 'bysup', back(7));
  await customer('west', 'rep1', {region: 'الغربية'});
  await customer('mine2', 'rep2'); await visit('v2', 'rep2', 'mine2', back(80));
  await customer('w1', 'repw', {region: 'الغربية', location: '21.5, 39.2', latitude: 21.5, longitude: 39.2});
  await app.db.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_at,updated_by) VALUES('reph','{}','[\"customer\"]',1,?,'owner')").bind(now).run();
  const cookies = {};
  for (const member of members) cookies[member.id] = await app.login(member.id);
  // As the Android app asks: the WebView's session cookie, no Origin header.
  const nearby = (who, extra = {}) => app.request('/api/nearby-customers', {headers: who ? {Cookie: cookies[who]} : {}, ...extra});
  const json = async (who, status) => { const response = await nearby(who); eq(response.status, status, 'GET /api/nearby-customers as ' + (who || 'anonymous') + ' -> ' + response.text.slice(0, 200)); return {response, body: response.json()}; };

  // The doors.
  eq((await json(null, 401)).body.error, 'سجّل الدخول للوصول إلى التطبيق.', 'anonymous: 401');
  for (const who of ['owner', 'mgr', 'sup', 'csm', 'cs']) eq((await json(who, 403)).body.error, 'تنبيه المصانع القريبة متاح لحساب المندوب فقط.', who + ': 403, for the representative only');
  eq((await json('reph', 404)).body.error, 'هذا الجزء غير متاح لحسابك. راجع مدير النظام.', '«العملاء» hidden from the representative: 404');
  eq((await app.as(cookies.rep1)('/api/nearby-customers', {method: 'POST', body: {}})).status, 405, 'GET only');

  // The representative's own list.
  let {response, body} = await json('rep1', 200);
  eq([response.headers['cache-control'], /application\/json/.test(response.headers['content-type'] || '')], ['no-store', true], 'JSON, never cached');
  eq([body.schemaVersion, body.memberId, body.memberRole, body.regionScope, body.refreshAfterSeconds, Date.parse(body.expiresAt) - Date.parse(body.serverTime)], [1, 'rep1', 'rep', 'eastern', 300, 600000], 'the account, its regions and a lease of ten minutes');
  eq(body.customers, [{id: 'due60', name: 'مصنع due60', latitude: 26.43, longitude: 50.03, daysSinceVisit: 60}, {id: 'never', name: 'مصنع never', latitude: 26.43, longitude: 50.03, daysSinceVisit: null}],
    'exactly 60 days and never visited; not 59 days, not one visited by the supervisor a week ago, not one without a location, not one outside the regions');
  ok(!response.text.includes('0551234567') && !response.text.includes('example.com') && !response.text.includes('أبو محمد') && !response.text.includes('C-due60'), 'no phone, e-mail, contact or code');
  eq((await json('rep2', 200)).body.customers.map(row => [row.id, row.daysSinceVisit]), [['mine2', 80]], 'another representative: their own only');
  eq((await json('repw', 200)).body.customers.map(row => [row.id, row.latitude, row.daysSinceVisit]), [['w1', 21.5, null]], 'the western representative: their own, in their region');
  // A visit recorded today takes the customer out at once, whoever recorded it.
  await visit('vtoday', 'rep2', 'never', today);
  eq((await json('rep1', 200)).body.customers.map(row => row.id), ['due60'], 'visited today: no longer listed');
  // Signed out: 401 (the app then stops asking until a new sign-in); a deactivated account: refused.
  eq((await app.as(cookies.rep2)('/api/auth/logout', {method: 'POST'})).status < 400, true, 'rep2 signs out');
  eq((await json('rep2', 401)).body.error, 'سجّل الدخول للوصول إلى التطبيق.', 'after signing out: 401');
  await app.db.prepare("UPDATE crm_members SET active=0 WHERE id='repw'").run();
  ok([401, 403].includes((await nearby('repw')).status), 'a deactivated representative is refused');
  console.log(JSON.stringify({ok: true, checks, syntheticFixtures: true, productionDataUsed: false}));
} finally { await app.stop(); }
