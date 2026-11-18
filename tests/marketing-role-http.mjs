// «مسؤول تسويق» (lib/roles.ts, the owner, 2026-11-18) and the customer classifications (lib/customer-classification.ts) over real HTTP
// against the BUILT release (run `pnpm build` first): the team screen adds a member of the new role (the administrator only); the marketing
// officer corrects another representative's customer of their branch and region directly (no approval request; the history names them
// and every changed field before and after), another branch's customer of their regions and a change of a customer's region through a
// request to their supervisor as a representative's (the review of 2026-11-18), never another region's, the routing or a deletion (not
// even when «حذف عميل» is sent for them); the classifications as the owner corrected them the same day: «اهتمام العميل» by hand (a
// representative and customer service refused, a representative's request never carrying it, a supervisor's waiting for the sales
// manager, the sales manager's and the administrator's direct, an unknown value refused, null empty), no grade, notes or size by hand,
// and what the release before stored kept untouched by every save; a representative reads the interest on their own customers only, a
// marketing officer on their branch's only (the others marked hidden); «قوة الفرصة» D on a visit and on a customer-service opportunity,
// and the queue's order; otherwise the officer is a representative: every route a representative opens answers them the same, a visit and its
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
  {id: 'mktc', role: 'marketing', sup: 'sup', region: 'central,eastern', name: 'مسؤول تسويق المنطقتين'},
  {id: 'csm', role: 'customer_service_manager', sup: 'mgr', name: 'مدير خدمة العملاء'},
  {id: 'cs', role: 'customer_service', sup: 'csm', name: 'خدمة العملاء'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const until = async (condition, what, ms = 25_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 250)); } throw new Error('timed out waiting for ' + what); };
const REFUSED = 'اهتمام العميل يحدده مسؤول التسويق لعملاء فرعه، والمشرف لعملاء فريقه، ومدير المبيعات، ومدير النظام.';
const DIRECT = 'تعديل مسؤول التسويق لبيانات العميل';
const FIELDS = ['opportunityGrade', 'gradeNotes', 'factorySize', 'customerInterest'], RETIRED = FIELDS.slice(0, 3), OLD = ['B', 'ملاحظة من الإصدار السابق', 'A'];
const riyadhClock = () => new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date());
while (riyadhClock() >= '23:57') await new Promise(resolve => setTimeout(resolve, 20000));
const mock = await startProductsMock({salesmen: true});
const app = await bootBuiltApp({members}, {env: {YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret, NODE_EXTRA_CA_CERTS: mock.ca}});
try {
  const stamp = new Date().toISOString(), day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()), month = day.slice(0, 7);
  const tomorrow = new Date(Date.parse(day + 'T12:00:00Z') + 86_400_000).toISOString().slice(0, 10);
  const where = {location: '26.4373410, 50.0344990', latitude: 26.437341, longitude: 50.034499};
  const insert = (id, assigned, data, branch = 'الرئيسي', region = 'الشرقية') => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,'customer',NULL,?,?,?,?,?,1)")
    .bind(id, assigned, branch, JSON.stringify({name: 'مصنع ' + id, region, city: 'الدمام', code: 'ERP-' + id, phone: '0500000000', contact: 'المسؤول', ...where, ...data}), stamp, stamp).run();
  await insert('c1', 'rep1', {}); await insert('c2', 'rep2', {}); await insert('cm', 'mkt', {}); await insert('cj', 'mktj', {}, 'جدة'); await insert('cw', 'rep1', {}, 'الرئيسي', 'الغربية'); await insert('cr', 'mktc', {});
  // A customer the release before classified by hand (update-marketing-20261118).
  await insert('co', 'rep2', {opportunityGrade: 'B', gradeNotes: 'ملاحظة من الإصدار السابق', factorySize: 'A', customerInterest: 'price'});
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
  const history = (await page('mgr')).audits.filter(audit => audit.recordId === 'c2' && audit.actor === 'مسؤولة التسويق ريم');
  eq([history.length, history[0].action, history[0].detail, typeof history[0].createdAt], [1, DIRECT, 'مصنع c2', 'string'], 'the customer\'s history names who and when');
  eq(history[0].changes.sort((a, b) => a.field.localeCompare(b.field)), [{field: 'notes', before: '', after: 'تحديث التسويق'}, {field: 'phone', before: '0500000000', after: '0512345678'}], 'and what changed, before and after (the review of 2026-11-18)');
  eq((await send('mkt', await edit('c1', {city: 'الخبر'}))).pendingApproval, undefined, 'their own supervisor\'s representative\'s customer: directly too');
  // The limits.
  // Another branch's customer of their regions: a request to their supervisor first, as a representative's (the review of 2026-11-18).
  before = await stored('cj');
  answer = await send('mkt', await edit('cj', {city: 'جدة'}));
  eq([answer.pendingApproval, answer.approvalStage], [true, 'supervisor'], 'another branch\'s customer: a request, to their supervisor');
  eq(await stored('cj'), before, 'unchanged while it waits');
  const supList = (await (await session.sup('/api/customer-edits')).json()).requests.find(request => request.id === answer.requestId);
  eq([supList?.canDecide, supList?.changes], [true, [{field: 'city', before: 'الدمام', after: 'جدة'}]], 'the supervisor reads it and decides it');
  eq((await send('sup', {action: 'customer-edit', decision: 'approve', id: answer.requestId})).stage, 'sales_manager', 'passed on');
  eq((await send('mgr', {action: 'customer-edit', decision: 'approve', id: answer.requestId})).status, 'approved', 'approved');
  eq((await stored('cj')).data.city, 'جدة', 'applied');
  // A change of the customer's region: a request too, as a whole edit; the same region is direct.
  before = await stored('cr');
  answer = await send('mktc', await edit('cr', {region: 'الوسطى', city: 'الرياض'}));
  eq([answer.pendingApproval, answer.approvalStage], [true, 'supervisor'], 'a new region waits for the supervisor');
  eq(await stored('cr'), before, 'not the region, not the city with it, while it waits');
  eq((await waiting('cr')).map(request => [...request.fields].sort()), [['city', 'region']], 'one request for the whole edit');
  await send('mktc', {action: 'customer-edit', decision: 'cancel', id: answer.requestId});
  eq((await send('mktc', await edit('cr', {city: 'الخبر'}))).pendingApproval, undefined, 'the same region: direct');
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

  // ---- The classifications, as the owner corrected them (2026-11-18): «اهتمام العميل» by hand; the grade, notes and size the release
  // before stored are carried untouched (the size is computed, the grade is each visit's «قوة الفرصة»).
  await send('mkt', await edit('c2', {customerInterest: 'technical'}));
  let data = (await stored('c2')).data;
  eq([data.customerInterest, (await waiting('c2')).length], ['technical', 0], 'the marketing officer sets the interest directly, with no request');
  await send('mkt', await edit('c2', {opportunityGrade: 'A', gradeNotes: 'طلب عرض سعر', factorySize: 'B'}));
  data = (await stored('c2')).data;
  eq(RETIRED.filter(field => field in data), [], 'no grade, notes or size by hand: what a save sends for them is not stored');
  await send('mkt', await edit('c2', {customerInterest: 'cheap'}), 400);
  eq((await stored('c2')).data.customerInterest, 'technical', 'an unknown interest changes nothing');
  await send('mkt', await edit('c2', {customerInterest: null}));
  eq('customerInterest' in (await stored('c2')).data, false, 'null: emptied');
  await send('mkt', await edit('c2', {customerInterest: 'technical'}));
  const old = async () => { const value = (await stored('co')).data; return RETIRED.map(field => value[field]); };
  eq(await old(), OLD, '(stored by the release before)');
  await send('mkt', await edit('co', {phone: '0512121212', opportunityGrade: 'D', gradeNotes: '', factorySize: 'C'}));
  eq([(await stored('co')).data.phone, ...await old()], ['0512121212', ...OLD], 'a marketing officer\'s save leaves the old grade, notes and size untouched, whatever it sends');
  await send('mgr', await edit('co', {city: 'الخبر', opportunityGrade: null, gradeNotes: null, factorySize: null}));
  eq([(await stored('co')).data.city, ...await old()], ['الخبر', ...OLD], 'the sales manager\'s, with null for them: untouched');
  answer = await send('rep1', await edit('co', {phone: '0599999990', factorySize: 'A'}));
  eq([answer.pendingApproval, (await waiting('co'))[0].fields], [true, ['phone']], 'a representative\'s request carries the phone only');
  await send('sup', {action: 'customer-edit', decision: 'approve', id: answer.requestId}); await send('mgr', {action: 'customer-edit', decision: 'approve', id: answer.requestId});
  eq([(await stored('co')).data.phone, ...await old()], ['0599999990', ...OLD], 'approved: the phone, and the old values untouched');
  eq((await send('rep1', await edit('c1', {customerInterest: 'price'}), 403)).error, REFUSED, 'a representative cannot set the interest');
  eq((await send('cs', await edit('c1', {customerInterest: 'price'}), 403)).error, REFUSED, 'nor customer service');
  answer = await send('rep1', await edit('c2', {city: 'الخبر'}));
  eq([answer.pendingApproval, (await waiting('c2'))[0].fields], [true, ['city']], 'a representative\'s correction never carries it');
  await send('rep1', {action: 'customer-edit', decision: 'cancel', id: answer.requestId});
  answer = await send('sup', await edit('c1', {customerInterest: 'service'}));
  eq([answer.pendingApproval, answer.approvalStage, (await stored('c1')).data.customerInterest], [true, 'sales_manager', undefined], 'a supervisor\'s interest waits for the sales manager');
  const list = (await (await session.mgr('/api/customer-edits')).json()).requests.find(request => request.id === answer.requestId);
  eq(list.changes.map(change => change.field), ['customerInterest'], 'the sales manager reads what it asks');
  eq((await send('mgr', {action: 'customer-edit', decision: 'approve', id: answer.requestId})).status, 'approved', 'and approves it');
  eq((await stored('c1')).data.customerInterest, 'service', 'applied');
  eq((await send('sup', await edit('c2', {customerInterest: 'trust'}), 403)).error, REFUSED, 'another team\'s customer: refused');
  await send('mgr', await edit('cj', {customerInterest: 'price'})); eq((await stored('cj')).data.customerInterest, 'price', 'the sales manager: directly');
  await send('owner', await edit('cw', {customerInterest: 'trust'})); eq((await stored('cw')).data.customerInterest, 'trust', 'the administrator: directly');
  eq((await waiting('cj')).length + (await waiting('cw')).length, 0, 'neither waits');
  await send('mkt', await edit('cj', {customerInterest: 'service'}), 403);
  // What a representative and a marketing officer read.
  const repPage = await page('rep1'), seen = id => repPage.records.find(record => record.id === id)?.data;
  eq([seen('c1').customerInterest, seen('c1')._classificationReadOnly], ['service', true], 'a representative reads their own customer\'s interest, read only');
  eq([FIELDS.some(field => field in seen('c2')), seen('c2')._classificationHidden, FIELDS.some(field => field in seen('co'))], [false, true, false], 'and nothing of another\'s (the old values neither), marked hidden');
  const marketingPage = await page('mkt'), theirs = id => marketingPage.records.find(record => record.id === id)?.data;
  eq(RETIRED.map(field => theirs('co')[field]), OLD, 'the old values travel with their branch\'s customer, unchanged (nothing shows them)');
  eq([theirs('c2').customerInterest, theirs('c2')._classificationHidden, FIELDS.some(field => field in theirs('cj')), theirs('cj')._classificationHidden, theirs('cj')._masterReadOnly], ['technical', undefined, false, true, undefined], 'a marketing officer: their branch\'s read and set; another branch\'s hidden, open to a request');

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
  // «قوة الفرصة» D «مستبعدة» (lib/opportunity-strength.ts, the owner, 2026-11-18: the opportunity's grade A to D).
  const callData = {type: 'call', summary: 'تعريف بمنتجات الشركة', result: 'العميل مرتبط بمورده', nextAction: 'إرسال المواصفات', nextDate: tomorrow, ...where, locationSource: 'device', locationCapturedAt: stamp, locationAccuracy: 10};
  await send('mkt', {createKey: crypto.randomUUID(), customerId: 'c2', customerVersion: (await stored('c2')).version, timingMode: 'automatic', elapsedMilliseconds: 5000, data: {...callData, strength: 'D'}}, 400, '/api/visits');
  const visit = await send('mkt', {createKey: crypto.randomUUID(), customerId: 'c2', customerVersion: (await stored('c2')).version, timingMode: 'automatic', elapsedMilliseconds: 5000, data: {...callData, strength: 'excluded'}}, 200, '/api/visits');
  const saved = await app.db.prepare('SELECT id,version,data FROM crm_records WHERE id=?').bind(visit.id).first();
  eq([JSON.parse(saved.data).performedBy, JSON.parse(saved.data).strength], ['mkt', 'excluded'], 'a visit recorded by the marketing officer, graded D (a code letter is not a value: 400)');
  eq((await page('mgr')).records.find(record => record.id === visit.id)?.data.strength, 'excluded', 'and read back so');
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

  // ---- A customer-service opportunity graded D, and the order of the queue: A, B, C, no grade, D (lib/opportunity-strength.ts).
  const registration = grade => ({type: 'call', summary: 'تسجيل فرصة من خدمة العملاء', result: 'متابعة العميل', salesStage: 'new', strength: grade, requestedProducts: ['قوالب البلوك المتحركة'], nextAction: 'اتصال بالعميل', nextDate: tomorrow, ...where, locationSource: 'device', locationCapturedAt: stamp, locationAccuracy: 12, customerNeeds: 'يسأل عن القوالب'});
  const register = async (customerId, grade, status = 200) => { const reply = await session.cs('/api/customer-service', {method: 'POST', body: {action: 'create', requestId: crypto.randomUUID(), customerId, customerVersion: (await stored(customerId)).version, registration: registration(grade), elapsedMilliseconds: 2200}}); eq(reply.status, status, 'customer service registers ' + grade + ' -> ' + reply.text.slice(0, 200)); return reply.json(); };
  await register('cw', 'X', 400);
  const dCase = await register('cm', 'excluded'), aCase = await register('cr', 'strong');
  const caseStrength = (await app.db.prepare('SELECT data FROM crm_service_cases WHERE id=?').bind(dCase.id).first()).data;
  eq(JSON.parse(caseStrength).strength, 'excluded', 'a customer-service opportunity graded D is stored so (an unknown grade: 400)');
  const ownerQueue = (await page('owner')).serviceQueue.filter(entry => [dCase.id, aCase.id].includes(entry.id));
  eq(ownerQueue.map(entry => [entry.id, entry.strength]), [[aCase.id, 'strong'], [dCase.id, 'excluded']], 'the queue lists A before D');

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
