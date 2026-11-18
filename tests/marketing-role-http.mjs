// «مسؤول تسويق» (lib/roles.ts, the owner, 2026-11-18) and the customer classifications (lib/customer-classification.ts) over real HTTP
// against the BUILT release (run `pnpm build` first): the team screen adds a member of the new role (the administrator only); the marketing
// officer corrects another representative's customer of their branch and region directly (no approval request; the history names them),
// never another branch's, another region's, the routing or a deletion (not even when «حذف عميل» is sent for them); the classifications:
// a representative and customer service refused (and a representative's request never carries them), a supervisor's waiting for the sales
// manager, the sales manager's and the administrator's direct, an unknown value refused; a representative reads them on their own
// customers only; otherwise the officer is a representative: every route a representative opens answers them the same, a visit and its
// follow-up are recorded, a saved visit is not theirs to edit, their own targets, the nearby customers and the day's route tell the
// Android app «rep», their phone reports its tracking state, and the products application's salesmen list names them. Synthetic fixtures
// only: temporary SQLite, mocked mail, a stand-in products server; no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'},
  {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف سالم'},
  {id: 'sup2', role: 'supervisor', sup: 'mgr', name: 'مشرف آخر'},
  {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'},
  {id: 'rep2', role: 'rep', sup: 'sup2', region: 'eastern', name: 'المندوب خالد'},
  {id: 'mkt', role: 'marketing', sup: 'sup', region: 'eastern', name: 'مسؤولة التسويق ريم'},
  {id: 'mktj', role: 'marketing', sup: 'sup', region: 'eastern', branch: 'جدة', name: 'مسؤول تسويق جدة'},
  {id: 'csm', role: 'customer_service_manager', sup: 'mgr', name: 'مدير خدمة العملاء'},
  {id: 'cs', role: 'customer_service', sup: 'csm', name: 'خدمة العملاء'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const until = async (condition, what, ms = 25_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 250)); } throw new Error('timed out waiting for ' + what); };
const REFUSED = 'تصنيفات العميل يحددها مسؤول التسويق والمشرف لعملاء فريقه ومدير المبيعات ومدير النظام. يمكنك الاطلاع عليها فقط.';
const FIELDS = ['opportunityGrade', 'gradeNotes', 'factorySize', 'customerInterest'];
const riyadhClock = () => new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date());
while (riyadhClock() >= '23:57') await new Promise(resolve => setTimeout(resolve, 20000));
const mock = await startProductsMock({salesmen: true});
const app = await bootBuiltApp({members}, {env: {YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret, NODE_EXTRA_CA_CERTS: mock.ca}});
try {
  const stamp = new Date().toISOString(), day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()), month = day.slice(0, 7);
  const tomorrow = new Date(Date.parse(day + 'T12:00:00Z') + 86_400_000).toISOString().slice(0, 10);
  const where = {location: '26.4373410, 50.0344990', latitude: 26.437341, longitude: 50.034499};
  const insert = (id, assigned, data, branch = 'الرئيسي', region = 'الشرقية') => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,'customer',NULL,?,?,?,?,?,1)")
    .bind(id, assigned, branch, JSON.stringify({name: 'مصنع ' + id, region, city: 'الدمام', code: 'ERP-' + id, phone: '0500000000', contact: 'المسؤول', ...where}), stamp, stamp).run();
  await insert('c1', 'rep1', {}); await insert('c2', 'rep2', {}); await insert('cm', 'mkt', {}); await insert('cj', 'mktj', {}, 'جدة'); await insert('cw', 'rep1', {}, 'الرئيسي', 'الغربية');
  const session = {};
  for (const member of members) session[member.id] = app.as(await app.login(member.id));
  const anonymous = app.as(null);
  const stored = async id => { const row = await app.db.prepare('SELECT data,version,assigned_to,branch FROM crm_records WHERE id=?').bind(id).first(); return {...row, data: JSON.parse(row.data)}; };
  const edit = async (id, changes, editKey = crypto.randomUUID()) => { const row = await stored(id); return {action: 'save', kind: 'customer', id, version: row.version, editKey, data: {...row.data, ...changes}}; };
  const send = async (who, body, status = 200, url = '/api/crm') => { const reply = await session[who](url, {method: 'POST', body}); eq(reply.status, status, who + ' ' + url + ' -> ' + reply.text.slice(0, 300)); return reply.json(); };
  const waiting = async id => (await app.db.prepare("SELECT q.detail FROM crm_audit q WHERE q.record_id=? AND q.action='customer-edit:request' AND NOT EXISTS (SELECT 1 FROM crm_audit d WHERE d.id='customer-edit-decision:'||q.id)").bind(id).all()).results.map(row => JSON.parse(row.detail));
  const page = async who => { const reply = await session[who]('/api/crm'); eq(reply.status, 200, 'GET /api/crm as ' + who); return reply.json(); };

  // ---- The doors.
  eq((await anonymous('/api/crm', {method: 'POST', body: await edit('c2', {city: 'الخبر'})})).status, 401, 'anonymous: 401');
  eq((await session.mkt('/api/crm', {method: 'POST', body: await edit('c2', {city: 'الخبر'}), headers: {Origin: 'https://evil.example'}})).status, 403, 'from another site: 403');

  // ---- The team screen: a member of the new role.
  const newMember = {name: 'مسؤول تسويق جديد', email: 'marketing.new@yourrest.org', role: 'marketing', branch: 'الرئيسي', supervisorId: 'sup', regionScope: ['eastern'], active: 1, target: 0};
  await send('mgr', {action: 'member', data: newMember}, 403);
  await send('mkt', {action: 'member', data: newMember}, 403);
  await send('owner', {action: 'member', data: newMember});
  const listed = (await page('owner')).members.find(member => member.email === 'marketing.new@yourrest.org');
  eq([listed.role, listed.supervisorId, listed.regionScope, listed.branch], ['marketing', 'sup', 'eastern', 'الرئيسي'], 'the administrator adds a marketing officer under a supervisor');
  await send('owner', {action: 'member', data: {...newMember, email: 'marketing.bad@yourrest.org', supervisorId: 'cs'}}, 400);
  await send('owner', {action: 'member', data: {...newMember, email: 'marketing.odd@yourrest.org', role: 'marketer'}}, 400);
  ok((await page('sup')).members.some(member => member.id === 'mkt'), 'the supervisor\'s team lists their marketing officer');
  ok((await page('mgr')).members.some(member => member.id === 'mkt'), 'and the sales manager\'s');

  // ---- A direct correction of another representative's customer of the branch.
  let before = await stored('c2');
  let answer = await send('mkt', await edit('c2', {phone: '0512345678', notes: 'تحديث التسويق'}));
  eq([answer.ok, answer.id, answer.pendingApproval], [true, 'c2', undefined], 'saved directly');
  let after = await stored('c2');
  eq([after.data.phone, after.data.notes, after.version, after.assigned_to, after.data.code], ['0512345678', 'تحديث التسويق', before.version + 1, 'rep2', 'ERP-c2'], 'the customer changed at once; its representative and ERP code stay');
  eq((await waiting('c2')).length, 0, 'no request waits for anyone');
  const history = (await page('mgr')).audits.filter(audit => audit.recordId === 'c2' && audit.action === 'تعديل');
  eq([history.length, history[0].actor, typeof history[0].createdAt], [1, 'مسؤولة التسويق ريم', 'string'], 'the customer\'s history names who and when');
  eq((await send('mkt', await edit('c1', {city: 'الخبر'}))).pendingApproval, undefined, 'their own supervisor\'s representative\'s customer: directly too');
  // The limits.
  before = await stored('cj');
  eq((await send('mkt', await edit('cj', {city: 'جدة'}), 403)).error, 'يعدّل مسؤول التسويق بيانات عملاء فرعه فقط.', 'another branch\'s customer: refused');
  eq(await stored('cj'), before, 'and unchanged');
  await send('mkt', await edit('cw', {city: 'جدة'}), 404);
  await send('mkt', await edit('c2', {assignedTo: 'mkt'}), 403);
  await send('mkt', await edit('c2', {branch: 'جدة'}), 403);
  eq((await stored('c2')).assigned_to, 'rep2', 'the routing never moves');
  await send('mkt', {...await edit('c2', {city: 'سيهات'}), version: 1}, 409);
  await send('mkt', {action: 'delete', kind: 'customer', id: 'cm', version: (await stored('cm')).version}, 403);
  const granted = (await send('owner', {action: 'permissions', memberId: 'mkt', version: 0, cells: {'customer:delete': true, 'activity:delete': true}, hidden: [], viewAll: false, requestId: crypto.randomUUID()})).permissions;
  eq([granted.cells['customer:delete'], granted.cells['activity:delete']], [undefined, true], '«حذف عميل» cannot be saved for the role; «حذف زيارة» can');
  await send('mkt', {action: 'delete', kind: 'customer', id: 'cm', version: (await stored('cm')).version}, 403);
  ok(await stored('cm'), 'their own customer stays');

  // ---- The classifications.
  await send('mkt', await edit('c2', {opportunityGrade: 'A', gradeNotes: 'طلب عرض سعر', factorySize: 'B', customerInterest: 'technical'}));
  let data = (await stored('c2')).data;
  eq(FIELDS.map(field => data[field]), ['A', 'طلب عرض سعر', 'B', 'technical'], 'the marketing officer sets the four directly');
  eq((await waiting('c2')).length, 0, 'with no request');
  for (const [field, bad] of [['opportunityGrade', 'E'], ['factorySize', 'كبير'], ['customerInterest', 'cheap'], ['gradeNotes', 'س'.repeat(1001)]]) await send('mkt', await edit('c2', {[field]: bad}), 400);
  eq((await stored('c2')).data.opportunityGrade, 'A', 'an unknown value changes nothing');
  eq((await send('rep1', await edit('c1', {opportunityGrade: 'B'}), 403)).error, REFUSED, 'a representative cannot set one');
  eq((await send('cs', await edit('c1', {customerInterest: 'price'}), 403)).error, REFUSED, 'nor customer service');
  answer = await send('rep1', await edit('c2', {city: 'الخبر'}));
  eq([answer.pendingApproval, (await waiting('c2'))[0].fields], [true, ['city']], 'a representative\'s correction never carries them');
  await send('rep1', {action: 'customer-edit', decision: 'cancel', id: answer.requestId});
  answer = await send('sup', await edit('c1', {opportunityGrade: 'B', factorySize: 'D', customerInterest: 'service'}));
  eq([answer.pendingApproval, answer.approvalStage, (await stored('c1')).data.opportunityGrade], [true, 'sales_manager', undefined], 'a supervisor\'s classification waits for the sales manager');
  const list = (await (await session.mgr('/api/customer-edits')).json()).requests.find(request => request.id === answer.requestId);
  eq(list.changes.map(change => change.field).sort(), ['customerInterest', 'factorySize', 'opportunityGrade'], 'the sales manager reads what it asks');
  eq((await send('mgr', {action: 'customer-edit', decision: 'approve', id: answer.requestId})).status, 'approved', 'and approves it');
  data = (await stored('c1')).data;
  eq([data.opportunityGrade, data.factorySize, data.customerInterest], ['B', 'D', 'service'], 'applied');
  eq((await send('sup', await edit('c2', {opportunityGrade: 'D'}), 403)).error, REFUSED, 'another team\'s customer: refused');
  await send('mgr', await edit('cj', {opportunityGrade: 'C'})); eq((await stored('cj')).data.opportunityGrade, 'C', 'the sales manager: directly');
  await send('owner', await edit('cw', {customerInterest: 'trust'})); eq((await stored('cw')).data.customerInterest, 'trust', 'the administrator: directly');
  eq((await waiting('cj')).length + (await waiting('cw')).length, 0, 'neither waits');
  await send('mkt', await edit('cj', {opportunityGrade: 'A'}), 403);
  // What a representative reads.
  const repPage = await page('rep1'), seen = id => repPage.records.find(record => record.id === id)?.data;
  eq([seen('c1').opportunityGrade, seen('c1')._classificationReadOnly], ['B', true], 'a representative reads their own customer\'s, read only');
  eq(FIELDS.some(field => field in seen('c2')), false, 'and nothing of another\'s');

  // ---- Otherwise a representative: the same answers on every door a representative knows (the representative holding the same
  // «حذف زيارة» the officer was given above, so «المحذوفات» opens for both).
  await send('owner', {action: 'permissions', memberId: 'rep1', version: 0, cells: {'activity:delete': true}, hidden: [], viewAll: false, requestId: crypto.randomUUID()});
  const routes = ['/api/targets?month=' + month, '/api/sales?month=' + month, '/api/journeys?date=' + day, '/api/device-status', '/api/team-today', '/api/kpis?month=' + month, '/api/kpi-evidence?month=' + month,
    '/api/trash?type=all', '/api/mold-requests', '/api/customer-edits', '/api/service-queue', '/api/support', '/api/complaints', '/api/reviews/pending', '/api/review-inbox', '/api/nearby-customers', '/api/mobile-route', '/api/erp-customers', '/api/service-report?month=' + month];
  const doors = {};
  for (const url of routes) {
    const [rep, marketing] = [await session.rep1(url), await session.mkt(url)];
    eq(marketing.status, rep.status, url + ': answered as a representative (' + rep.status + ')');
    doors[url.split('?')[0]] = marketing.status;
  }
  eq(Object.values(doors).filter(status => status === 200).length >= 8, true, 'most of them open (' + JSON.stringify(doors) + ')');
  const mine = await page('mkt');
  eq(mine.me.role, 'marketing', 'the page knows the role');
  eq(mine.records.filter(record => record.kind === 'customer').map(record => record.id).sort(), (await page('rep1')).records.filter(record => record.kind === 'customer').map(record => record.id).sort(), 'the regional directory of a representative of the same regions');
  eq(mine.members.map(member => member.id), ['mkt'], 'their own team is themselves');
  // A visit (a call), its follow-up, and no editing of what is saved.
  const visit = await send('mkt', {createKey: crypto.randomUUID(), customerId: 'c2', customerVersion: (await stored('c2')).version, timingMode: 'automatic', elapsedMilliseconds: 5000, data: {type: 'call', summary: 'تعريف بمنتجات الشركة', result: 'العميل مهتم بالعرض', nextAction: 'إرسال المواصفات', nextDate: tomorrow, ...where, locationSource: 'device', locationCapturedAt: stamp, locationAccuracy: 10}}, 200, '/api/visits');
  const saved = await app.db.prepare('SELECT id,version,data FROM crm_records WHERE id=?').bind(visit.id).first();
  eq(JSON.parse(saved.data).performedBy, 'mkt', 'a visit recorded by the marketing officer');
  await send('mkt', {createKey: crypto.randomUUID(), customerId: 'c2', customerVersion: (await stored('c2')).version, sourceId: visit.id, sourceVersion: saved.version, data: {type: 'call', date: day, result: 'تحدثت مع العميل', salesStage: 'specs', invoiceOutcome: 'pending', nextAction: 'زيارة للمصنع', nextDate: tomorrow}}, 200, '/api/customer-followups');
  ok(((await app.db.prepare("SELECT COUNT(*) n FROM crm_records WHERE kind='activity' AND json_extract(data,'$.performedBy')='mkt'").first()).n) >= 2, 'and its follow-up');
  await send('mkt', {createKey: crypto.randomUUID(), id: visit.id, version: saved.version, customerId: 'c2', data: {type: 'call', summary: 'تعديل', result: 'تمت', date: day}}, 403, '/api/visits');
  const visible = await page('mkt'), others = await page('rep2');
  ok(visible.records.some(record => record.id === visit.id), 'the officer reads their own visit');
  eq(others.records.some(record => record.id === visit.id), false, 'a representative does not read it');
  ok((await page('sup')).records.some(record => record.id === visit.id), 'their supervisor does');
  // Their own targets, the Android app's doors.
  const targets = await session.mkt('/api/targets?month=' + month);
  eq([targets.status, targets.json().member?.id], [200, 'mkt'], 'their own targets');
  eq((await session.mgr('/api/targets?month=' + month)).status, 403, '(a sales manager has no personal targets screen)');
  const nearby = await session.mkt('/api/nearby-customers');
  eq([nearby.status, nearby.json().memberRole, nearby.json().memberId, nearby.json().customers.map(customer => customer.id)], [200, 'rep', 'mkt', ['cm']], 'the nearby customers of the officer, told «rep» for the app');
  const route = await session.mkt('/api/mobile-route');
  eq([route.status, route.json().memberRole, route.json().memberId], [200, 'rep', 'mkt'], 'the day\'s route tells the app «rep»');
  eq((await session.sup('/api/mobile-route')).json().memberRole, 'supervisor', 'every other role as it is');
  const report = {platform: 'android-app', deviceClass: 'android', gate: 'ok', missing: [], appVersion: '1.0.14', tracking: true, windowActive: true, enrolled: true, consent: true, foreground: 'granted', fineLocation: 'granted', notifications: 'granted', background: 'granted', locationServices: true, lastFixAt: new Date(Date.now() - 60000).toISOString(), accuracy: 8, pendingCount: 0, pendingGapCount: 0, quarantinedCount: 0, error: '', syncError: ''};
  await send('mkt', report, 200, '/api/device-status');
  await send('sup', report, 403, '/api/device-status');
  ok((await (await session.sup('/api/device-status')).json()).members.some(member => member.memberId === 'mkt' || member.id === 'mkt'), 'the supervisor\'s tracking list names their marketing officer');

  // ---- The products application's salesmen.
  await until(() => mock.state.calls.some(call => call.route === 'salesmen' && JSON.parse(call.body).salesmen.some(entry => entry.crmMemberId === 'mkt')), 'the salesmen list naming the marketing officer');
  const sent = mock.state.calls.filter(call => call.route === 'salesmen').map(call => JSON.parse(call.body)).find(body => body.salesmen.some(entry => entry.crmMemberId === 'mkt'));
  eq(sent.salesmen.find(entry => entry.crmMemberId === 'mkt'), {crmMemberId: 'mkt', name: 'مسؤولة التسويق ريم', email: 'mkt@yourrest.org', active: true}, 'sent as a salesman who may file mold requests');
  for (const reply of [await session.mkt('/api/crm'), await session.mkt('/api/customer-edits')]) eq(reply.headers['cache-control'], 'no-store', 'never cached');

  console.log(JSON.stringify({ok: true, checks, doors, realBrowser: false, productionDataUsed: false}));
} finally {
  await app.stop();
  await mock.stop();
}
