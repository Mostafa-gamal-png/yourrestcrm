// «الصلاحيات» per member (lib/permissions*.ts, migration 0020) over real HTTP against the BUILT release (run the build first): on release
// day nothing changes (every mapped action answers as before for every role); the administrator switches one action off for one member and
// that member is refused with 403 «مش مسموح لك ب<الإجراء> في <الشاشة>. راجع مدير النظام.» while another member of the same role is not; a
// hidden screen's own requests answer 404 «هذا الجزء غير متاح لحسابك. راجع مدير النظام.» (never 401/403, which lock the offline session)
// and requests another screen shares stay open; a stale save is 409; every save leaves a «صلاحيات» history entry with before and after,
// kept out of the recent changes. Routes covered: /api/crm, /api/visits, /api/customer-followups, /api/customer-service, /api/complaints,
// /api/service-kpi, /api/mold-requests, /api/reviews, /api/journeys, /api/device-status, /api/sales, /api/sales/import,
// /api/erp-customers, /api/targets, /api/kpis, /api/kpi-evidence, /api/trash. Synthetic fixtures only: temporary SQLite, mocked mail.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'},
  {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'mgr2', role: 'manager', name: 'مدير مبيعات آخر'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف'},
  {id: 'sup2', role: 'supervisor', sup: 'mgr', name: 'مشرف آخر'},
  {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'},
  {id: 'rep2', role: 'rep', sup: 'sup2', region: 'eastern', name: 'مندوب آخر'},
  {id: 'csm', role: 'customer_service_manager', sup: 'mgr', name: 'مدير خدمة العملاء'},
  {id: 'cs', role: 'customer_service', sup: 'csm', name: 'ممثل خدمة العملاء'},
  {id: 'cs2', role: 'customer_service', sup: 'csm', name: 'ممثل آخر'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const HIDDEN = 'هذا الجزء غير متاح لحسابك. راجع مدير النظام.';
const app = await bootBuiltApp({members});
try {
  const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()), month = day.slice(0, 7), now = new Date().toISOString();
  const insert = (id, kind, parent, assigned, data) => app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id, kind, parent, assigned, 'الرئيسي', JSON.stringify(data), now, now).run();
  const customer = id => insert(id, 'customer', null, 'rep1', {name: 'مصنع ' + id, region: 'الشرقية', city: 'الدمام', location: '26.43, 50.03', phone: '0500000000', contact: 'المسؤول'});
  for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) await customer(id);
  for (const [id, by] of [['v1', 'rep1'], ['v2', 'rep1'], ['v3', 'rep1'], ['v4', 'rep2']])
    await insert(id, 'activity', 'c1', by, {type: 'visit', date: day, summary: 'تعريف', result: 'تمت', outcome: 'pending', notes: '', performedBy: by, responsibleId: by, recordedByEmail: by + '@yourrest.org'});
  const session = {};
  for (const member of members) session[member.id] = app.as(await app.login(member.id));
  const version = async id => Number((await app.db.prepare('SELECT version FROM crm_records WHERE id=?').bind(id).first())?.version);
  const exists = async id => !!(await app.db.prepare('SELECT id FROM crm_records WHERE id=?').bind(id).first());
  let saved = {};
  const save = async (memberId, input, status = 200) => {
    const response = await session.owner('/api/crm', {method: 'POST', body: {action: 'permissions', memberId, version: saved[memberId] || 0, cells: {}, hidden: [], viewAll: false, requestId: crypto.randomUUID(), ...input}});
    eq(response.status, status, 'save ' + memberId + ' ' + JSON.stringify(input) + ' -> ' + response.text.slice(0, 300));
    if (response.status === 200) saved[memberId] = response.json().permissions.version;
    return response;
  };
  const refusal = (screen, verb) => `مش مسموح لك ب${verb} في ${screen}. راجع مدير النظام.`;
  const refused = (response, screen, verb, label) => eq([response.status, response.json().error], [403, refusal(screen, verb)], label + ' -> ' + response.text.slice(0, 200));
  const hidden = (response, label) => eq([response.status, response.json().error], [404, HIDDEN], label + ' -> ' + response.text.slice(0, 200));
  const open = (response, label) => ok(![401, 403, 404].includes(response.status) || response.json().error !== HIDDEN && !/^مش مسموح لك/.test(response.json().error || ''), label + ' is not refused by a permission -> ' + response.status + ' ' + response.text.slice(0, 160));
  const post = (who, url, body, headers) => session[who](url, {method: 'POST', body, ...(headers ? {headers} : {})});

  const customerAdd = who => post(who, '/api/crm', {action: 'save', kind: 'customer', createKey: crypto.randomUUID(), data: {name: 'عميل جديد ' + crypto.randomUUID().slice(0, 6), region: 'الشرقية', city: 'الدمام', location: '26.43, 50.03', phone: '0500000002'}});
  const customerEdit = async (who, id) => { const row = await app.db.prepare('SELECT data,version FROM crm_records WHERE id=?').bind(id).first(); return post(who, '/api/crm', {action: 'save', kind: 'customer', id, version: row.version, data: {...JSON.parse(row.data), contact: 'تعديل ' + who}}); };
  const remove = async (who, kind, id) => post(who, '/api/crm', {action: 'delete', kind, id, version: await version(id)});
  const visitAdd = who => post(who, '/api/visits', {createKey: crypto.randomUUID(), customerId: 'c1', data: {type: 'visit', purpose: 'تعريف', summary: 'تعريف', result: 'تمت', date: day}});
  const visitEdit = async (who, id) => post(who, '/api/visits', {createKey: crypto.randomUUID(), id, version: await version(id), customerId: 'c1', data: {type: 'visit', purpose: 'تعريف', summary: 'تعديل', result: 'تمت', date: day}});
  const followupAdd = who => post(who, '/api/customer-followups', {createKey: crypto.randomUUID(), customerId: 'c1', customerVersion: 1, data: {}});
  const serviceCreate = async who => post(who, '/api/customer-service', {action: 'create', requestId: crypto.randomUUID(), customerId: 'c2', customerVersion: await version('c2'), data: {source: 'website', products: ['قوالب البلوك المتحركة'], strength: 'strong', needs: 'احتياج', nextAction: 'تحديد المواصفات', nextDate: day}});
  const complaintAdd = async who => post(who, '/api/complaints', {requestId: crypto.randomUUID(), action: 'register', customerId: 'c3', customerVersion: await version('c3'), channel: 'call', category: 'product_quality', severity: 'normal', description: 'القالب يخرج منتجًا مكسورًا من الجهة اليمنى', demand: 'استبدال القالب', reference: 'INV-100'});
  // The evaluation's real settings, so the body passes the route's schema and reaches the permission check.
  const kpiSettings = async who => post(who, '/api/service-kpi', {requestId: crypto.randomUUID(), action: 'settings', version: 0, settings: (await session.owner('/api/service-kpi?month=' + month)).json().settings});
  // A schema-valid request (tests/mold-requests-http.mjs), so it reaches the permission check; without the products link it is kept here.
  const moldCreate = who => post(who, '/api/mold-requests', {action: 'create', requestId: crypto.randomUUID(), customerId: 'c1', payment: 'cash', specs: {description: '200*400*27.5TH MM OPEN', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: 'YR099-9', quantity: 1, notes: 'طلب'}});
  const review = who => post(who, '/api/reviews', {kind: 'entry', activityId: 'v1', result: 'زيارة جيدة', action: 'جهّز عرض السعر', version: null, requestId: crypto.randomUUID()});
  const saleAdd = who => post(who, '/api/sales', {action: 'save', createKey: crypto.randomUUID(), version: 0, data: {customerId: 'c1', repId: 'rep1', date: day, reference: 'INV-' + crypto.randomUUID().slice(0, 8), items: [{product: 'قوالب البلوك المتحركة', description: '', quantity: 1, unitPrice: 100}], discount: 0, notes: ''}});
  const targetsSave = who => post(who, '/api/targets', {});
  const kpiSave = who => post(who, '/api/kpis', {});
  const erpCustomers = who => post(who, '/api/erp-customers', {});
  const restore = who => post(who, '/api/trash', {auditId: 'missing', requestId: crypto.randomUUID()});

  // 1. Release day: no saved row; every mapped action answers as before (allowed or refused by the role's own rule, never by a switch).
  eq(Number((await app.db.prepare('SELECT COUNT(*) n FROM crm_member_permissions').first()).n), 0, 'nobody has saved permissions');
  for (const id of members.map(m => m.id)) eq((await session[id]('/api/crm')).json().me.access, {version: 0, off: [], hidden: [], viewAll: false}, id + ': the role\'s behaviour');
  eq((await customerAdd('rep1')).status, 200, 'rep1 adds a customer');
  eq((await customerEdit('rep1', 'c1')).status, 200, 'rep1 edits a customer');
  eq((await remove('mgr', 'customer', 'c4')).status, 200, 'mgr deletes a customer');
  eq((await remove('mgr', 'activity', 'v2')).status, 200, 'mgr deletes a visit');
  for (const [label, response] of [['rep1 visit', await visitAdd('rep1')], ['sup visit edit', await visitEdit('sup', 'v1')], ['rep1 follow-up', await followupAdd('rep1')], ['csm settings', await kpiSettings('csm')], ['rep1 mold', await moldCreate('rep1')], ['sup sale', await saleAdd('sup')], ['mgr targets', await targetsSave('mgr')], ['mgr kpis', await kpiSave('mgr')], ['mgr erp customers', await erpCustomers('mgr')], ['mgr restore', await restore('mgr')]]) open(response, label);
  eq((await serviceCreate('cs')).status, 200, 'cs registers a request');
  eq((await complaintAdd('cs')).status, 200, 'cs registers a complaint');
  eq((await review('sup')).status, 200, 'sup writes a note on rep1\'s visit');
  for (const [who, url] of [['sup', '/api/sales?month=' + month], ['sup', '/api/sales/import'], ['mgr', '/api/trash?type=all'], ['sup', '/api/journeys?date=' + day], ['sup', '/api/device-status'], ['rep1', '/api/mold-requests'], ['rep1', '/api/targets?month=' + month], ['cs', '/api/service-kpi?month=' + month]])
    eq((await session[who](url)).status, 200, who + ' GET ' + url + ' before');

  // 2. Only the administrator saves; a stale version is 409; the history entry holds before and after.
  for (const who of ['mgr', 'sup', 'rep1', 'csm', 'cs']) eq((await post(who, '/api/crm', {action: 'permissions', memberId: 'rep2', version: 0, cells: {}, hidden: []})).status, 403, who + ' cannot save permissions');
  await save('mgr', {cells: {'customer:delete': false, 'activity:delete': false, 'customer:import': false, 'targets:edit': false, 'trash:edit': false}});
  eq((await session.owner('/api/crm', {method: 'POST', body: {action: 'permissions', memberId: 'mgr', version: 0, cells: {}, hidden: []}})).status, 409, 'a stale version is refused');
  const entry = await app.db.prepare("SELECT record_id,detail FROM crm_audit WHERE action='صلاحيات'").first();
  const detail = JSON.parse(entry.detail);
  eq([entry.record_id, detail.before.version, detail.before.cells['customer:delete'], detail.after.version, detail.after.cells['customer:delete'], detail.after.cells['trash:edit']], ['mgr', 0, true, 1, false, false], 'the «صلاحيات» entry: before and after');
  ok(!(await session.owner('/api/crm')).json().audits.some(a => a.action === 'صلاحيات'), 'kept out of the recent changes');
  await save('rep1', {cells: {'customer:add': false, 'customer:edit': false, 'activity:add': false, 'followup:add': false, 'mold-requests:add': false}});
  await save('sup', {cells: {'activity:edit': false, 'journeys:add': false, 'sales:add': false, 'sales:import': false}});
  await save('cs', {cells: {'activity:add': false, 'complaints:add': false}});
  await save('csm', {cells: {'service-kpi:edit': false}});

  // 3. Switched off: 403 with the action and the screen; another member of the same role is unaffected.
  refused(await customerAdd('rep1'), 'العملاء', 'الإضافة', 'rep1 adds a customer');
  refused(await customerEdit('rep1', 'c1'), 'العملاء', 'التعديل', 'rep1 edits a customer');
  eq((await customerEdit('rep2', 'c1')).status, 200, 'rep2 still edits it');
  refused(await remove('mgr', 'customer', 'c5'), 'العملاء', 'الحذف', 'mgr deletes a customer');
  ok(await exists('c5'), 'the customer is kept');
  refused(await remove('mgr', 'activity', 'v3'), 'الزيارات', 'الحذف', 'mgr deletes a visit');
  eq((await remove('mgr2', 'activity', 'v3')).status, 200, 'mgr2 still deletes it');
  refused(await visitAdd('rep1'), 'الزيارات', 'الإضافة', 'rep1 records a visit');
  refused(await visitEdit('sup', 'v1'), 'الزيارات', 'التعديل', 'sup edits a visit');
  refused(await followupAdd('rep1'), 'المتابعات', 'الإضافة', 'rep1 records a follow-up');
  refused(await serviceCreate('cs'), 'الزيارات', 'الإضافة', 'cs registers a request');
  { const other = await serviceCreate('cs2'); open(other, 'cs2 still registers (' + other.status + ')'); }
  refused(await complaintAdd('cs'), 'الشكاوى', 'الإضافة', 'cs registers a complaint');
  refused(await kpiSettings('csm'), 'تقييم خدمة العملاء', 'التعديل', 'csm saves the evaluation\'s settings');
  refused(await moldCreate('rep1'), 'طلبات تصنيع القوالب', 'الإضافة', 'rep1 requests a mold');
  open(await moldCreate('rep2'), 'rep2 requests a mold');
  eq((await session.rep1('/api/mold-requests')).json().canCreate, false, 'and rep1\'s page offers no new request');
  refused(await review('sup'), 'تقرير يوم المندوب', 'الإضافة', 'sup writes a note');
  eq((await session.sup('/api/reviews?date=' + day + '&memberId=rep1')).json().reviewable, [], 'nothing offered to note');
  refused(await saleAdd('sup'), 'المبيعات', 'الإضافة', 'sup records a sale');
  open(await saleAdd('sup2'), 'sup2 records a sale');
  refused(await session.sup('/api/sales/import'), 'المبيعات', 'الاستيراد', 'sup opens the ERP sales import');
  eq((await session.sup2('/api/sales/import')).status, 200, 'sup2 still does');
  refused(await erpCustomers('mgr'), 'العملاء', 'الاستيراد', 'mgr imports ERP customers');
  open(await erpCustomers('mgr2'), 'mgr2 imports ERP customers');
  refused(await targetsSave('mgr'), 'المستهدفات وتقييم الأداء', 'التعديل', 'mgr saves a target');
  refused(await kpiSave('mgr'), 'المستهدفات وتقييم الأداء', 'التعديل', 'mgr saves an evaluation');
  eq((await session.mgr('/api/sales?month=' + month + '&kpis=1')).json().kpis.canManage, false, 'the evaluation is read only for mgr');
  eq((await session.mgr2('/api/sales?month=' + month + '&kpis=1')).json().kpis.canManage, true, 'and not for mgr2');
  refused(await restore('mgr'), 'المحذوفات', 'التعديل', 'mgr restores a deletion');
  eq((await session.mgr('/api/trash?type=all')).status, 200, 'mgr still reads «المحذوفات»');

  // 4. Hidden screens: their own requests are 404; a request another screen shares stays open while that screen shows.
  await save('mgr', {hidden: ['trash', 'customer']});
  hidden(await session.mgr('/api/trash?type=all'), 'mgr GET /api/trash');
  hidden(await restore('mgr'), 'mgr POST /api/trash');
  hidden(await erpCustomers('mgr'), 'mgr POST /api/erp-customers');
  eq((await session.mgr2('/api/trash?type=all')).status, 200, 'mgr2 unaffected');
  await save('sup', {hidden: ['sales']});
  eq((await session.sup('/api/sales?month=' + month)).status, 200, '«المبيعات» hidden: /api/sales still answers «المستهدفات وتقييم الأداء»');
  hidden(await saleAdd('sup'), 'sup POST /api/sales');
  hidden(await session.sup('/api/sales/import'), 'sup GET /api/sales/import');
  await save('sup', {hidden: ['sales', 'targets', 'journeys']});
  for (const url of ['/api/sales?month=' + month, '/api/journeys?date=' + day, '/api/reviews?date=' + day, '/api/device-status', '/api/kpi-evidence?memberId=rep1&month=' + month]) hidden(await session.sup(url), 'sup GET ' + url);
  eq((await session.sup('/api/journeys')).status, 200, 'the member\'s own journey (no date) stays open');
  await save('rep1', {hidden: ['mold-requests', 'targets']});
  hidden(await session.rep1('/api/mold-requests'), 'rep1 GET /api/mold-requests');
  hidden(await moldCreate('rep1'), 'rep1 POST /api/mold-requests');
  hidden(await session.rep1('/api/mold-requests/design-file?id=x&file=y'), 'rep1 GET a design file');
  hidden(await session.rep1('/api/targets?month=' + month), 'rep1 GET /api/targets');
  await save('cs', {hidden: ['complaints']});
  hidden(await session.cs('/api/service-kpi?month=' + month), 'cs: the evaluation is read on «الشكاوى» only');
  eq((await session.csm('/api/service-kpi?month=' + month)).status, 200, 'csm still reads it');
  const state = (await session.sup('/api/crm')).json();
  // A save replaces the whole row: the last one for sup carried hidden screens and no switched-off cell.
  eq([state.me.access.hidden, state.me.access.off], [['journeys', 'sales', 'targets'], []], 'GET /api/crm carries what applies to the member (the whole row as last saved)');
  // Nothing is hidden from an administrator, whose team page always stays open.
  const own = await save('owner', {hidden: ['team', 'trash'], cells: {'team:edit': false, 'team:add': false}});
  eq([own.json().permissions.hidden, own.json().permissions.cells['team:edit']], [[], true], 'the administrator cannot be locked out');
  eq((await session.owner('/api/trash?type=all')).status, 200, 'the administrator still opens «المحذوفات»');
  await save('rep2', {cells: {'customer:edit': false}});
  eq((await session.owner('/api/crm')).json().members.find(m => m.id === 'rep2').permissions.cells['customer:edit'], false, 'the administrator saved again: the team page shows the saved cells');
  // A permissions save never signs the member out.
  eq((await session.rep1('/api/crm')).status, 200, 'rep1 is still signed in after five saves');
  ok(!/at .*node_modules|stack/i.test(app.log().replace(/ExperimentalWarning[^\n]*/g, '')), 'no stack traces for refused requests');
  console.log(JSON.stringify({ok: true, checks, builtRelease: true, syntheticFixtures: true}));
} finally { await app.stop(); }
