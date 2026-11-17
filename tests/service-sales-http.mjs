// Customer service in the sales process (the owner, 2026-11-16, item 5 of the GSCO list) over real HTTP against the BUILT release (run the
// build first). Every new or changed route asked with no session (401), by a role without the right (403), with «الزيارات» hidden (404) and
// by the right roles, and a member sees only what is theirs:
// - GET /api/service-leads (the lists of «مصادر الفرص» and the record an opportunity is started from);
// - POST /api/customer-service create with «مصدر الفرصة» (picked, filled in from a lost opportunity, a dormant customer, a support request, a
//   complaint; refused when wrong; an older page without it: «غير محدد»), approve with route 'service' or 'sales', and 'stage';
// - GET /api/service-routing (the facts of the decision and the warning of an open sales opportunity);
// - the opportunity customer service keeps: only its owner works on it, no member of sales reads it or attaches a visit to it;
// - the full customer-service sales out of /api/sales (achievement, evaluation, «مبيعات اليوم») and /api/targets (the representative's own),
//   the ERP total kept by «رفع المبيعات» with the line, and nothing else changed;
// - GET/POST /api/service-role-tasks (the task at the closing, recorded once by its member);
// - GET /api/service-performance and its Excel export; the evaluation's new indicator and the support-sales window.
// Synthetic fixtures only: temporary SQLite, mocked mail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف'}, {id: 'rep', role: 'rep', sup: 'sup', name: 'المندوب'}, {id: 'rep2', role: 'rep', sup: 'mgr', name: 'مندوب ثانٍ'},
  {id: 'csm', role: 'customer_service_manager', sup: 'mgr', name: 'مدير خدمة العملاء'}, {id: 'cs', role: 'customer_service', sup: 'csm', name: 'ممثل أول'},
  {id: 'cs2', role: 'customer_service', sup: 'csm', name: 'ممثل ثانٍ'}, {id: 'csh', role: 'customer_service', sup: 'csm', name: 'ممثل بلا فرص'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const riyadhClock = () => new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date());
while (riyadhClock() >= '23:55') await new Promise(resolve => setTimeout(resolve, 20000));
const app = await bootBuiltApp({members});
try {
  const sessions = {};
  for (const member of members) sessions[member.id] = await app.login(member.id);
  const as = id => app.as(id ? sessions[id] : null);
  const get = (id, url) => as(id)(url);
  const post = (id, url, body) => as(id)(url, {method: 'POST', body});
  const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()), month = day.slice(0, 7), now = new Date().toISOString();
  const ago = days => new Date(Date.now() - days * 86400000).toISOString(), dayAgo = days => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date(Date.now() - days * 86400000));
  await app.db.prepare('INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_at,updated_by) VALUES(?,?,?,1,?,?)').bind('csh', '{}', JSON.stringify(['activity']), now, 'owner').run();
  const insert = (id, kind, parent, assigned, data, when = ago(3)) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,'الرئيسي',?,?,?,1,'fixture')").bind(id, kind, parent, assigned, JSON.stringify(data), when, when).run();
  const point = {location: '24.7136000, 46.6753000', latitude: 24.7136, longitude: 46.6753};
  for (const [id, code] of [['c-new', ''], ['c-dorm', 'C-DORM'], ['c-buy', 'C-BUY'], ['c-lost', 'C-LOST'], ['c-sup', 'C-SUP'], ['c-cmp', 'C-CMP'], ['c-never', 'C-NEVER'], ['c-two', 'C-TWO']])
    await insert(id, 'customer', null, id === 'c-two' ? 'rep2' : 'rep', {name: 'مصنع ' + id, region: 'الشرقية', city: 'الدمام', code, phone: '0500000001', branch: 'الرئيسي', assignedTo: 'rep', ...point}, ago(400));
  await app.db.prepare('INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES(?,?,?,?,?,?)').bind('erp-import-1', 'owner', 'fp-1', 'synthetic.xlsx', '{}', now).run();
  // An ERP document received now: created_at is the moment of the import (a kept opportunity's sale is one received after the decision).
  const erp = (id, rep, code, date, cents, refs = [], type = 'sale') => app.db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'h','m',?,?,?,?,?,'الرئيسي','all',?,'عميل اصطناعي',?,?,'erp-import-1','owner',?)")
    .bind(id, 'doc-' + id, 'INV-' + id, type, date, 'E-' + rep, rep, code, JSON.stringify({items: [{product: 'قوالب البلوك المتحركة', quantity: type === 'return' ? -1 : 2, unitPrice: Math.abs(cents) / 200}], discount: 0, ...(refs.length ? {quotationRefs: refs} : {})}), cents, new Date().toISOString()).run();
  await erp('old-dorm', 'rep', 'C-DORM', dayAgo(120), 10000);
  await erp('old-buy', 'rep', 'C-BUY', dayAgo(10), 10000);
  const kase = (id, customerId, status, data = {}, extra = {}) => app.db.prepare('INSERT INTO crm_service_cases(id,customer_id,status,creator_id,service_manager_id,sales_manager_id,assigned_to,supervisor_id,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?)')
    .bind(id, customerId, status, 'cs', 'csm', extra.salesManager ?? 'mgr', extra.assigned ?? 'rep', extra.supervisor ?? null, JSON.stringify({source: 'call', products: ['خدمات صيانة'], strength: 'strong', needs: 'احتياج', nextAction: 'متابعة', nextDate: day, participants: ['cs', 'csm'], approvedAt: ago(9), assignedAt: ago(9), registration: {type: 'call', visitNumber: 70}, ...data}), ago(10), ago(10), 'fixture').run();
  await kase('case-lost', 'c-lost', 'assigned');
  await insert('k-lost', 'activity', 'c-lost', 'rep', {type: 'call', date: dayAgo(2), result: 'رفض', salesStage: 'lost', lossReason: 'السعر أعلى من المنافس', serviceCaseId: 'case-lost', performedBy: 'rep', responsibleId: 'rep', recordedByEmail: 'rep@yourrest.org'}, ago(2));
  await insert('support-1', 'support', null, 'rep', {kind: 'support', customerId: 'c-sup', origin: 'rep', status: 'done', requestedBy: 'rep', requestedAt: ago(5), repId: 'rep', note: 'متابعة', channel: 'any', handlerId: 'cs', handlerAt: ago(5), handlerBy: 'cs', result: {outcome: 'reached_interested', note: 'مهتم', nextDate: '', by: 'cs', at: ago(4)}, events: []}, ago(5));
  await insert('complaint-1', 'complaint', null, 'cs', {kind: 'complaint', customerId: 'c-cmp', status: 'closed', registrarId: 'cs', serviceManagerId: 'csm', salesManagerId: '', supervisorId: '', assigneeId: '', channel: 'call', category: 'quality', severity: 'normal', description: 'شكوى', demand: '', reference: '', contactName: 'أحمد', contactPhone: '0500000002', complaintNumber: 7, events: []}, ago(5));
  const version = async id => (await app.db.prepare('SELECT version FROM crm_records WHERE id=?').bind(id).first()).version;
  const fields = {type: 'call', summary: 'تعريف بالمنتجات', result: 'العميل مهتم', nextAction: 'إرسال عرض سعر', nextDate: day, strength: 'strong', requestedProducts: ['قوالب البلوك المتحركة'], salesStage: 'new', ...point, locationSource: 'device', locationCapturedAt: now, locationAccuracy: 10};
  const create = async (who, customerId, lead, extra = {}) => post(who, '/api/customer-service', {action: 'create', requestId: crypto.randomUUID(), customerId, customerVersion: await version(customerId), registration: fields, elapsedMilliseconds: 60000, ...(lead === undefined ? {} : {lead}), ...extra});
  const caseOf = customerId => app.db.prepare("SELECT * FROM crm_service_cases WHERE customer_id=? ORDER BY created_at DESC LIMIT 1").bind(customerId).first();
  const caseVersion = async id => (await app.db.prepare('SELECT version FROM crm_service_cases WHERE id=?').bind(id).first()).version;

  // ---- GET /api/service-leads: the doors
  eq((await get(null, '/api/service-leads?list=lost')).status, 401, 'anonymous: 401');
  for (const who of ['rep', 'sup', 'mgr']) eq([(await get(who, '/api/service-leads?list=lost')).status, (await get(who, '/api/service-leads?list=lost')).json().error], [403, 'مصادر الفرص متاحة لخدمة العملاء ومدير النظام.'], who + ': not for sales: 403');
  eq([(await get('csh', '/api/service-leads?list=lost')).status, (await get('csh', '/api/service-leads?list=lost')).json().error], [404, 'هذا الجزء غير متاح لحسابك. راجع مدير النظام.'], '«الفرص» hidden: 404');
  eq([(await get('cs', '/api/service-leads?list=other')).status, (await get('cs', '/api/service-leads?kind=visit&id=x')).status], [400, 400], 'a list or a kind that is not one: 400');
  let response = await get('cs', '/api/service-leads?list=lost');
  eq([response.status, response.headers['cache-control'], response.json().rows.map(r => [r.id, r.customerName, r.lossReason])], [200, 'no-store', [['case-lost', 'مصنع c-lost', 'السعر أعلى من المنافس']]], 'customer service: the lost opportunity of its branch, with its loss reason');
  response = await get('cs', '/api/service-leads?list=dormant');
  const dormant = response.json().rows;
  eq([dormant[0].id, dormant[0].lastPurchase, dormant.some(r => r.id === 'c-buy')], ['c-dorm', dayAgo(120), false], 'the dormant list: bought 120 days ago, first; not the one that bought 10 days ago');
  eq(dormant.slice(1).map(r => [r.id, r.lastPurchase]).sort(), ['c-cmp', 'c-lost', 'c-never', 'c-new', 'c-sup', 'c-two'].map(id => [id, '']), 'then every customer of the branch who never bought (the owner\'s decision 4), none with an open opportunity');
  eq((await get('owner', '/api/service-leads?list=dormant')).status, 200, 'the administrator reads the lists too');
  eq((await get('cs', '/api/service-leads?kind=opportunity&id=case-lost')).json().reference, {kind: 'opportunity', id: 'case-lost', source: 'فرصة مفقودة سابقة', label: '#70 · مصنع c-lost', customerId: 'c-lost', customerName: 'مصنع c-lost', blocked: ''}, 'the record a new opportunity starts from, with the source the system fills in');
  eq([(await get('cs', '/api/service-leads?kind=customer&id=c-buy')).status, (await get('cs', '/api/service-leads?kind=customer&id=c-buy')).json().error], [409, 'العميل اشترى خلال 90 يومًا؛ لا يُبدأ له مصدر «عميل منقطع عن الشراء».'], 'a customer who bought within 90 days: 409');
  eq((await get('cs', '/api/service-leads?kind=opportunity&id=nothing')).status, 404, 'an unknown record: 404');
  eq((await get('cs', '/api/service-leads?kind=support&id=complaint-1')).status, 404, 'a record of another kind: 404');

  // ---- «مصدر الفرصة» on a new opportunity
  const before = (await app.db.prepare('SELECT COUNT(*) AS n FROM crm_service_cases').first()).n;
  eq([(await create('cs', 'c-new', null)).json().error, (await create('cs', 'c-new', {group: 'service', source: ''})).json().error, (await create('cs', 'c-new', {group: 'service', source: 'أخرى', note: 'ab'})).json().error, (await create('cs', 'c-new', {group: 'system', source: 'شكوى'})).json().error],
    ['اختر مصدر الفرصة.', 'اختر مصدر الفرصة من القائمة.', 'اكتب مصدر الفرصة باختصار (3 أحرف على الأقل).', 'مصدر «من بيانات النظام» يُملأ عند بدء الفرصة من سجلها فقط.'], 'a missing or wrong source: refused with its reason');
  eq((await create('cs', 'c-new', {group: 'system', refKind: 'opportunity', refId: 'case-lost'})).json().error, 'اختر عميل السجل الذي بدأت منه الفرصة.', 'a record of another customer: refused');
  eq((await create('cs', 'c-new', {group: 'system', refKind: 'opportunity', refId: 'case-lost', source: 'واتساب'})).json().error, 'مصدر الفرصة يحدده النظام من السجل الذي بدأت منه.', 'a source other than the system\'s: refused');
  eq((await app.db.prepare('SELECT COUNT(*) AS n FROM crm_service_cases').first()).n, before, 'nothing written');
  response = await create('cs', 'c-new', {group: 'service', source: 'واتساب'});
  eq(response.status, 200, 'customer service brings a lead in by WhatsApp: ' + response.text);
  let row = await caseOf('c-new');
  eq([row.lead_group, row.lead_source, row.lead_ref_kind, row.lead_ref_id, row.lead_note, row.route], ['service', 'واتساب', null, null, '', null], 'kept on the opportunity');
  eq((await create('cs', 'c-lost', {group: 'system', refKind: 'opportunity', refId: 'case-lost'})).status, 200, 'started from the lost opportunity');
  row = await caseOf('c-lost');
  eq([row.lead_group, row.lead_source, row.lead_ref_kind, row.lead_ref_id], ['system', 'فرصة مفقودة سابقة', 'opportunity', 'case-lost'], 'the system\'s source, locked to its record');
  eq((await get('cs', '/api/service-leads?list=lost')).json().rows.length, 0, 'it leaves the list of lost opportunities');
  eq((await create('cs', 'c-dorm', {group: 'system', refKind: 'customer', refId: 'c-dorm'})).status, 200, 'started from a dormant customer');
  eq((await create('cs', 'c-sup', {group: 'system', refKind: 'support', refId: 'support-1'})).status, 200, 'started from a support request');
  eq((await create('cs', 'c-cmp', {group: 'system', refKind: 'complaint', refId: 'complaint-1'})).status, 200, 'started from a complaint');
  eq([(await caseOf('c-sup')).lead_source, (await caseOf('c-cmp')).lead_source, (await caseOf('c-dorm')).lead_source], ['طلب تواصل مع العملاء', 'شكوى', 'عميل منقطع عن الشراء 90 يومًا'], 'each with its source');
  eq((await create('cs', 'c-buy')).status, 200, 'a page of before sends no source: saved, «غير محدد»');
  eq((await caseOf('c-buy')).lead_group, null, 'no source stored');
  eq((await create('cs', 'c-cmp', {group: 'system', refKind: 'complaint', refId: 'complaint-1'})).json().error, 'يوجد طلب خدمة عملاء مفتوح لهذا العميل بالفعل', 'a record of the system never becomes a contact on an open opportunity');
  eq((await create('cs', 'c-cmp', {group: 'service', source: 'واتساب'})).status, 200, 'a further contact keeps the open opportunity\'s source');
  eq((await caseOf('c-cmp')).lead_source, 'شكوى', 'unchanged');
  const ids = {};
  for (const customer of ['c-new', 'c-lost', 'c-dorm', 'c-sup', 'c-cmp', 'c-buy']) ids[customer] = (await caseOf(customer)).id;

  // ---- GET /api/service-routing and the decision
  const routing = (who, id) => get(who, '/api/service-routing?id=' + encodeURIComponent(id));
  eq((await routing(null, ids['c-new'])).status, 401, 'anonymous: 401');
  eq((await routing('csh', ids['c-new'])).status, 404, '«الفرص» hidden: 404');
  eq((await routing('rep', ids['c-new'])).status, 404, 'a representative may not read it: 404');
  eq([(await routing('cs', ids['c-new'])).status, (await routing('cs', ids['c-new'])).json().error], [409, 'الفرصة ليست بانتظار اعتمادك.'], 'the registrar does not approve: 409');
  response = await routing('csm', ids['c-new']);
  eq([response.status, response.json().eligible, response.json().reasons, response.json().warnings, response.json().salesManagers.map(m => m.id), response.json().serviceMembers.map(m => m.id)], [200, true, ['unlinked', 'dormant', 'serviceEffort'], [], ['mgr'], ['cs', 'csm', 'cs2', 'csh']], 'a customer with no ERP code (who never bought), a lead of customer service: it may keep it; the registrar first');
  eq([(await routing('csm', ids['c-dorm'])).json().reasons, (await routing('csm', ids['c-buy'])).json().eligible], [['dormant'], false], 'a customer who has not bought for 90 days may stay; one who bought 10 days ago with no lead may not');
  await insert('k-buy-sales', 'activity', 'c-buy', 'rep', {type: 'visit', date: dayAgo(1), result: 'تم أخذ موعد', salesStage: 'quoted', performedBy: 'rep', responsibleId: 'rep', recordedByEmail: 'rep@yourrest.org'}, ago(1));
  eq((await routing('csm', ids['c-buy'])).json().warnings, [{kind: 'visit', stage: 'quoted', ownerName: 'المندوب', date: dayAgo(1)}], 'the warning: the customer has an open opportunity with sales');
  const approve = async (who, id, extra) => post(who, '/api/customer-service', {action: 'approve', id, version: await caseVersion(id), requestId: crypto.randomUUID(), ...extra});
  eq([(await approve('csm', ids['c-buy'], {route: 'service', ownerId: 'cs'})).status, (await approve('csm', ids['c-buy'], {route: 'service', ownerId: 'cs'})).json().error], [409, 'تتولى خدمة العملاء الفرصة فقط إذا كان العميل غير مسجّل في ERP، أو لم يشترِ خلال 90 يومًا، أو كان مصدر الفرصة من جهد خدمة العملاء. مرّر الفرصة لمدير المبيعات.'], 'not eligible: refused');
  eq((await approve('csm', ids['c-new'], {route: 'service', ownerId: 'rep'})).status, 403, 'a sales member is not a customer-service owner');
  eq((await approve('cs', ids['c-new'], {route: 'service', ownerId: 'cs2'})).status, 403, 'the registrar does not approve');
  eq((await approve('csm', ids['c-new'], {route: 'service', ownerId: 'cs2'})).status, 200, 'the customer-service manager keeps it, given to cs2');
  row = await app.db.prepare('SELECT * FROM crm_service_cases WHERE id=?').bind(ids['c-new']).first();
  eq([row.status, row.assigned_to, row.sales_manager_id, row.route, row.routed_by], ['service', 'cs2', null, 'service', 'csm'], 'stored: with customer service, its owner, routed by the manager');
  eq((await approve('csm', ids['c-dorm'], {route: 'service', ownerId: 'cs'})).status, 200, 'the dormant customer\'s too, to its registrar');
  eq((await approve('csm', ids['c-sup'], {route: 'sales', targetId: 'mgr'})).status, 200, 'the support request\'s is passed to the sales manager');
  eq([(await app.db.prepare('SELECT status,route FROM crm_service_cases WHERE id=?').bind(ids['c-sup']).first()).status, (await app.db.prepare('SELECT route FROM crm_service_cases WHERE id=?').bind(ids['c-sup']).first()).route], ['pending_assignment', 'sales'], 'as before, recorded as passed');
  eq((await post('mgr', '/api/customer-service', {action: 'assign', id: ids['c-sup'], version: await caseVersion(ids['c-sup']), targetId: 'rep', requestId: crypto.randomUUID()})).status, 200, 'and assigned to the representative');
  const list = async who => (await get(who, '/api/customer-service')).json().cases;
  eq([(await list('mgr')).some(c => c.id === ids['c-new']), (await list('rep')).some(c => c.id === ids['c-new']), (await list('sup')).some(c => c.id === ids['c-new'])], [false, false, false], 'no member of sales reads an opportunity customer service keeps');
  let held = (await list('cs2')).find(c => c.id === ids['c-new']);
  eq([held.state, held.permissions.work, held.leadSource, (await list('cs')).find(c => c.id === ids['c-new']).permissions.work], ['service', true, 'واتساب', false], 'its owner works on it; the registrar reads it and does not');
  const stage = async (who, id, body) => post(who, '/api/customer-service', {action: 'stage', id, version: await caseVersion(id), requestId: crypto.randomUUID(), ...body});
  eq([(await stage('cs', ids['c-new'], {stage: 'quoted'})).status, (await stage('cs', ids['c-new'], {stage: 'quoted'})).json().error], [403, 'هذه الفرصة لدى خدمة العملاء ويتابعها ممثل خدمة العملاء المسؤول عنها.'], 'another customer-service member: refused');
  eq((await stage('rep', ids['c-new'], {stage: 'quoted'})).status, 403, 'a representative: refused');
  eq([(await stage('cs2', ids['c-new'], {stage: 'lost'})).json().error, (await stage('cs2', ids['c-new'], {stage: 'done'})).status], ['اختر سبب الفقد', 400], 'a loss needs its reason; a stage that is not one');
  eq((await stage('cs2', ids['c-new'], {stage: 'quoted', stageNote: 'أرسلنا عرض السعر'})).status, 200, 'the owner records the stage');
  eq((await create('cs', 'c-new', {group: 'service', source: 'واتساب'})).json().error, 'هذه الفرصة لدى خدمة العملاء ويتابعها ممثل خدمة العملاء المسؤول عنها.', 'another member\'s contact on it: refused');
  eq((await create('cs2', 'c-new', {group: 'service', source: 'واتساب'})).status, 200, 'the owner records a contact');
  const visit = await post('rep', '/api/visits', {createKey: crypto.randomUUID(), customerId: 'c-new', customerVersion: await version('c-new'), timingMode: 'automatic', elapsedMilliseconds: 5000, data: {...fields, type: 'call'}});
  eq(visit.status, 200, 'the customer\'s representative still records his own contact: ' + visit.text);
  eq(JSON.parse((await app.db.prepare('SELECT data FROM crm_records WHERE id=?').bind(visit.json().id).first()).data).serviceCaseId, undefined, 'never attached to the opportunity customer service keeps');

  // ---- the full customer-service sales leave every achievement; the report keeps the ERP total and names them
  await insert('q-dorm', 'quote', 'c-dorm', 'rep', {number: 'Qut-901', date: day, validUntil: day, status: 'sent', items: [{description: 'قالب', quantity: 1, price: 2000}], discount: 0, taxRate: 15, total: 2300}, now);
  await insert('q-sup', 'quote', 'c-sup', 'rep', {number: 'Qut-902', date: day, validUntil: day, status: 'sent', items: [{description: 'قالب', quantity: 1, price: 500}], discount: 0, taxRate: 15, total: 575}, now);
  await erp('e-shared', 'rep', 'C-SUP', day, 50000, ['Qut-902']);
  await erp('e-plain', 'rep', 'C-BUY', day, 30000);
  await erp('e-two', 'rep2', 'C-TWO', day, 70000);
  const snapshot = async () => {
    const sales = (await get('mgr', '/api/sales?month=' + month + '&kpis=1')).json();
    const own = (await get('rep', '/api/targets?month=' + month)).json();
    return {sales, own};
  };
  const without = await snapshot();
  await erp('e-full', 'rep', 'C-DORM', day, 200000, ['Qut-901']);
  await erp('e-full-return', 'rep', 'C-DORM', day, -20000, ['Qut-901'], 'return');
  const after = await snapshot();
  eq([after.sales.sales.some(s => s.id === 'e-full'), after.sales.serviceFullSales.map(s => [s.id, s.serviceFull, s.totalCents]).sort()], [false, [['e-full', true, 200000], ['e-full-return', true, -20000]]], 'the full customer-service sales are sent apart, out of the achievement list');
  eq(after.sales.sales.map(s => s.id).sort(), without.sales.sales.map(s => s.id).sort(), 'the achievement list is exactly what it was without them');
  eq(after.sales.performance, without.sales.performance, 'every member\'s achievement (the representative\'s, his supervisor\'s and the sales manager\'s roll-ups, the other representative) is unchanged');
  eq(after.sales.individualPerformance, without.sales.individualPerformance, 'the individual figures too');
  eq(after.sales.kpis, without.sales.kpis, 'the evaluation is unchanged (quotation conversion, sales, customers)');
  eq(after.sales.targets, without.sales.targets, 'the targets state (the company and branch gauges are worked out from it and from `sales`)');
  eq(after.own.sales, without.own.sales, 'the representative\'s own targets page («مستهدفاتي»): unchanged');
  const total = list => list.reduce((n, s) => n + s.totalCents, 0) / 100;
  eq([total(after.sales.sales), total(after.sales.serviceFullSales), total(after.sales.sales) + total(after.sales.serviceFullSales)], [total(without.sales.sales), 1800, total(without.sales.sales) + 1800], '«رفع المبيعات»: the ERP total is the achievement list plus the line «منها مبيعات خدمة العملاء بالكامل»');
  eq(after.sales.sales.find(s => s.id === 'e-shared').totalCents, 50000, 'a shared sale (passed to sales) stays in the achievement');
  eq((await get('rep', '/api/sales?month=' + month)).status, 403, 'a representative has no sales page (as before)');
  eq((await get('owner', '/api/sales?month=' + month)).json().serviceFullSales.length, 2, 'the administrator\'s report has the line too');

  // ---- «تسجيل دور خدمة العملاء»
  const tasks = async who => get(who, '/api/service-role-tasks');
  eq((await tasks(null)).status, 401, 'anonymous: 401');
  for (const who of ['rep', 'mgr']) eq((await tasks(who)).status, 403, who + ': not for sales: 403');
  eq((await tasks('csh')).status, 404, '«الفرص» hidden: 404');
  eq((await tasks('cs2')).json().tasks, [], 'nothing closed yet (the lost opportunity closed before this release asks for no role)');
  eq((await stage('cs2', ids['c-new'], {stage: 'won'})).status, 200, 'the owner wins the opportunity customer service keeps');
  await insert('k-sup-won', 'activity', 'c-sup', 'rep', {type: 'visit', date: day, result: 'تم الشراء', salesStage: 'won', serviceCaseId: ids['c-sup'], performedBy: 'rep', responsibleId: 'rep', recordedByEmail: 'rep@yourrest.org'}, new Date().toISOString());
  let mine = (await tasks('cs2')).json();
  eq([mine.tasks.map(t => [t.caseId, t.outcome, t.memberId, t.basis, t.canRecord]), mine.counts.mine], [[[ids['c-new'], 'won', 'cs2', 'owner', true]], 1], 'its owner gets the task');
  eq((await tasks('cs')).json().tasks.map(t => [t.caseId, t.basis]), [[ids['c-sup'], 'registrar']], 'the registrar of the one passed to sales gets its task, and not the other member\'s');
  eq((await tasks('csm')).json().tasks.map(t => t.memberId).sort(), ['cs', 'cs2'], 'the customer-service manager follows his team\'s');
  const record = (who, caseId, body) => post(who, '/api/service-role-tasks', {caseId, roles: ['جلب العميل'], note: 'تواصلت مع العميل حتى الشراء', requestId: crypto.randomUUID(), ...body});
  eq((await record(null, ids['c-new'])).status, 401, 'anonymous: 401');
  eq((await record('rep', ids['c-new'])).status, 403, 'a representative: 403');
  eq((await record('cs', ids['c-new'])).status, 404, 'another member\'s task: not available');
  eq([(await record('csm', ids['c-new'])).status, (await record('csm', ids['c-new'])).json().error], [403, 'يسجّل الدور ممثل خدمة العملاء المكلّف بالمهمة.'], 'the manager does not record it for him');
  eq([(await record('cs2', ids['c-new'], {note: 'قصيرة'})).status, (await record('cs2', ids['c-new'], {roles: []})).status], [400, 400], 'a short note, no role: 400');
  eq((await record('cs2', ids['c-new'], {roles: ['جلب العميل', 'عرض السعر والتفاوض']})).json(), {ok: true, caseId: ids['c-new']}, 'its member records the role');
  eq((await record('cs2', ids['c-new'])).json().alreadyDone, true, 'once: a second time answers that it is done');
  mine = (await tasks('cs2')).json();
  eq([mine.tasks[0].roles, mine.tasks[0].doneAt !== '', mine.counts.badge], [['جلب العميل', 'عرض السعر والتفاوض'], true, 0], 'shown as recorded, the count down');
  ok(await app.db.prepare("SELECT 1 FROM crm_audit WHERE record_id=? AND action='service:role'").bind(ids['c-new']).first(), 'with its audit line');

  // ---- «أداء خدمة العملاء» and its Excel
  const perf = (who, query = '?month=' + month) => get(who, '/api/service-performance' + query);
  eq((await perf(null)).status, 401, 'anonymous: 401');
  for (const who of ['rep', 'sup']) eq((await perf(who)).status, 403, who + ': 403');
  eq((await perf('csh')).status, 404, '«الفرص» hidden: 404');
  eq((await perf('cs', '?month=2026-13')).status, 400, 'a month that is not one: 400');
  response = await perf('cs');
  const row1 = response.json().teams[0].rows;
  eq([response.json().teams.length, row1.map(r => r.memberId)], [1, ['cs']], 'a member sees only himself');
  const seeded = dayAgo(10).slice(0, 7) === month ? 1 : 0;
  eq([row1[0].opportunities, row1[0].kept, row1[0].passed, row1[0].pending, row1[0].sales.full, row1[0].sales.shared, row1[0].sales.support.invoices], [6 + seeded, 2, 1 + seeded, 3, {value: 1800, invoices: 1}, {value: 500, invoices: 1}, 0], 'his opportunities of the month and his sales: full (the return deducted), shared');
  eq(response.json().canExport, false, 'a customer-service member does not export (the cell is not his role\'s)');
  const team = (await perf('csm')).json().teams;
  eq([team.length, team[0].rows.map(r => r.memberId).sort(), team[0].total.sales.full.value], [1, ['cs', 'cs2', 'csh', 'csm'].sort(), 1800], 'the customer-service manager: his team and himself, with the team line');
  eq([(await perf('mgr')).json().teams.map(t => t.managerId), (await perf('owner')).json().teams.map(t => t.managerId)], [['csm'], ['csm']], 'the sales manager reads the customer-service team under him (the owner\'s decision 3), the administrator every team');
  const exported = (who, query = '?month=' + month) => get(who, '/api/service-performance/export' + query);
  eq((await exported(null)).status, 401, 'export, anonymous: 401');
  eq([(await exported('cs')).status, (await exported('cs')).json().error], [403, 'غير مسموح لك بالتصدير في تقارير خدمة العملاء. راجع مدير النظام.'], 'a member without the export cell: 403');
  eq((await exported('rep')).status, 403, 'a representative: 403');
  eq((await exported('csh')).status, 404, 'hidden: 404');
  for (const who of ['csm', 'mgr', 'owner']) {
    const file = await exported(who);
    eq([file.status, file.headers['content-type'], file.headers['cache-control'], file.bytes.subarray(0, 2).toString()], [200, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'private, no-store', 'PK'], who + ': the workbook');
  }
  const english = await exported('csm', '?month=' + month + '&lang=en');
  ok(english.bytes.includes(Buffer.from('Customer-service performance')) && !/[؀-ۿ]/.test(english.bytes.toString('latin1').replace(/[^\x20-\x7e]/g, '')), 'the English workbook is in English');

  // ---- the evaluation: the new indicator, the support-sales window
  const kpi = (await get('csm', '/api/service-kpi?month=' + month)).json();
  const card = kpi.groups.find(g => g.managerId === 'csm').reps.find(r => r.memberId === 'cs');
  const conversion = card.metrics.find(x => x.key === 'conversion');
  eq([conversion.weight, conversion.min, conversion.target, conversion.denominator, conversion.numerator, conversion.enough], [15, 3, 100, 1 + (dayAgo(2).slice(0, 7) === month ? 1 : 0), 1, false], '«نسبة الفرص المتحولة إلى مبيعات»: weight 15, at least 3 cases, target 100 (the owner\'s decision 1); the won one converted (and the lost one of the month not), not enough cases yet');
  eq([kpi.settings.supportSalesDays, kpi.settings.rep.conversion.target], [30, 100], 'the support-sales window: 30 days by default (decision 2); the indicator\'s target 100');
  const save = settings => post('owner', '/api/service-kpi', {action: 'settings', requestId: crypto.randomUUID(), version: kpi.settingsVersion, settings});
  const {supportSalesDays, ...older} = kpi.settings;
  eq((await save({...kpi.settings, supportSalesDays: 0})).json().error, 'مدة احتساب مبيعات المساندة بالأيام عدد صحيح من 1 إلى 365', 'a window of 0 days: refused');
  eq((await save({...kpi.settings, supportSalesDays: 45})).status, 200, 'the administrator sets 45 days');
  eq((await get('csm', '/api/service-kpi?month=' + month)).json().settings.supportSalesDays, 45, 'kept');
  const second = (await get('csm', '/api/service-kpi?month=' + month)).json();
  eq((await post('owner', '/api/service-kpi', {action: 'settings', requestId: crypto.randomUUID(), version: second.settingsVersion, settings: older})).status, 200, 'a page of before saves without the field');
  eq([(await get('csm', '/api/service-kpi?month=' + month)).json().settings.supportSalesDays, supportSalesDays], [45, 30], 'and the saved window is kept');
  eq((await perf('cs')).json().supportDays, 45, 'the dashboard reads it');
  eq((await post('csm', '/api/service-kpi', {action: 'settings', requestId: crypto.randomUUID(), version: 0, settings: kpi.settings})).status, 403, 'only the administrator changes the settings');

  console.log(JSON.stringify({ok: true, checks, scope: 'customer service in the sales process on the built release: the leads, the routing, the opportunity customer service keeps, the full customer-service sales out of every achievement, the role task, the dashboard and its Excel, the evaluation', realBrowser: false}));
} finally {
  await app.stop();
}
