// The review of customer service in the sales process (2026-11-16, item 5 of the GSCO list), over real HTTP against the BUILT release
// (`npm run build` first), each a defect the review proved and its mending:
// 1. a later decision «تتولاها خدمة العملاء» never reclassifies a quotation or an invoice from before it, nor a document the system
//    already held (a finished month stays; the whole /api/sales answer is the same across the decision, so «بيانات المؤشرات» stays true);
// 2. the ERP return of a full customer-service sale (it repeats no quotation number) leaves the achievement with its sale, up to it;
// 3. «أداء خدمة العملاء», its Excel and the role tasks: the customer of an opportunity only to whom may read it (the region, the branch,
//    never sales on one customer service keeps); the role tasks only on opportunities the reader may read;
// 4. an invoice sells a kept quotation only when it is of its customer (a code that names one) and dated on or after it; the dashboard
//    and every achievement read the same full sales;
// 5. the monthly report and its Excel keep the loss reason of an opportunity customer service kept;
// 6. a customer who has not bought is started again once the opportunity started from it closed;
// 7. «فرص مفقودة للاسترداد»: the people on another member's opportunity are not named;
// and the representative's own page («مستهدفي») does not count a full customer-service sale as their work. Then the owner's decisions of
// 2026-11-17: a sales manager reads the customer-service teams under him only (figures, rows and the Excel file), and an interested contact
// makes a support sale for 30 days, not 31.
// Synthetic isolated fixtures only: temporary SQLite, made-up members, customers and documents.
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'adminw', role: 'admin', name: 'مدير نظام الغربية', region: 'western'},
  {id: 'mgr', role: 'manager', name: 'مدير المبيعات'}, {id: 'mgrw', role: 'manager', name: 'مدير مبيعات الغربية', region: 'western'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف'}, {id: 'rep', role: 'rep', sup: 'sup', name: 'المندوب الأول'}, {id: 'rep2', role: 'rep', sup: 'mgr', name: 'المندوب الثاني'},
  {id: 'rep3', role: 'rep', sup: 'sup', name: 'المندوب الثالث'},
  {id: 'csm', role: 'customer_service_manager', sup: 'mgr', name: 'مدير خدمة العملاء'}, {id: 'cs', role: 'customer_service', sup: 'csm', name: 'ممثلة الخدمة'},
  {id: 'cs2', role: 'customer_service', sup: 'csm', name: 'ممثل الخدمة الثاني'},
  {id: 'csm2', role: 'customer_service_manager', sup: 'mgrw', name: 'مدير خدمة العملاء الثاني'}, {id: 'cs3', role: 'customer_service', sup: 'csm2', name: 'ممثل الفريق الثاني'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
// Every stored or deflated entry of a zip (an .xlsx) as text.
const zipText = buf => { let out = '', i = 0; while ((i = buf.indexOf(Buffer.from([0x50, 0x4b, 3, 4]), i)) >= 0) { const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18), nameLen = buf.readUInt16LE(i + 26), extra = buf.readUInt16LE(i + 28), start = i + 30 + nameLen + extra, data = buf.subarray(start, start + size); try { out += method === 8 ? inflateRawSync(data).toString('utf8') : data.toString('utf8'); } catch { /* not an entry */ } i = start + size; } return out; };

const app = await bootBuiltApp({members});
try {
  const sessions = {};
  for (const m of members) sessions[m.id] = await app.login(m.id);
  const get = (id, url) => app.as(id ? sessions[id] : null)(url);
  const post = (id, url, body) => app.as(id ? sessions[id] : null)(url, {method: 'POST', body});
  const fmt = d => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(d);
  const day = fmt(new Date()), month = day.slice(0, 7), ago = n => new Date(Date.now() - n * 86400000).toISOString(), dayAgo = n => fmt(new Date(Date.now() - n * 86400000));
  const prevMonth = fmt(new Date(Date.parse(month + '-01T12:00:00Z') - 10 * 86400000)).slice(0, 7), prevLast = fmt(new Date(Date.parse(month + '-01T12:00:00Z') - 86400000));
  const insert = (id, kind, parent, assigned, data, when = ago(3)) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,'الرئيسي',?,?,?,1,'fixture')").bind(id, kind, parent, assigned, JSON.stringify(data), when, when).run();
  const point = {location: '24.7136000, 46.6753000', latitude: 24.7136, longitude: 46.6753};
  const customer = (id, code, rep = 'rep') => insert(id, 'customer', null, rep, {name: 'مصنع ' + id, region: 'الشرقية', city: 'الدمام', code, phone: '0500000001', branch: 'الرئيسي', assignedTo: rep, ...point}, ago(400));
  for (const [id, code, rep] of [['c-late', 'C-LATE'], ['c-same', 'C-SAME'], ['c-held', ''], ['c-other', 'C-OTH', 'rep2'], ['c-k', 'C-K'], ['c-dorm', 'C-DORM'], ['c-lost', 'C-LOST'], ['c-own', 'C-OWN', 'rep3'], ['c-team2', 'C-T2'], ['c-s30', 'C-S30'], ['c-s31', 'C-S31']]) await customer(id, code, rep);
  await app.db.prepare('INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES(?,?,?,?,?,?)')
    .bind('erp-import-1', 'owner', 'fp-1', 'synthetic.xlsx', JSON.stringify({coverage: {complete: true, from: prevMonth + '-01', to: prevLast, months: [], partialMonths: [], repIds: ['rep3'], allReps: false, importerId: 'owner', importer: 'مدير النظام', at: ago(1), importId: 'erp-import-1'}}), ago(1)).run();
  // An ERP document, received now (created_at is the moment of the import).
  const erp = (id, rep, code, date, cents, refs = [], type = 'sale') => app.db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'h','m',?,?,?,?,?,'الرئيسي','eastern',?,'عميل اصطناعي',?,?,'erp-import-1','owner',?)")
    .bind(id, 'doc-' + id, 'INV-' + id, type, date, 'E-' + rep, rep, code, JSON.stringify({items: [{product: 'قوالب البلوك المتحركة', quantity: type === 'return' ? -2 : 2, unitPrice: Math.abs(cents) / 200}], discount: 0, ...(refs.length ? {quotationRefs: refs} : {})}), cents, new Date().toISOString()).run();
  const quote = (id, customerId, number, date, total = 1150) => insert(id, 'quote', customerId, 'rep', {number, date, validUntil: date, status: 'sent', items: [{description: 'قالب', quantity: 1, price: total / 1.15}], discount: 0, taxRate: 15, total}, new Date().toISOString());
  const version = async id => (await app.db.prepare('SELECT version FROM crm_records WHERE id=?').bind(id).first()).version;
  const caseVersion = async id => (await app.db.prepare('SELECT version FROM crm_service_cases WHERE id=?').bind(id).first()).version;
  const fields = {type: 'call', summary: 'تعريف بالمنتجات', result: 'العميل مهتم', nextAction: 'إرسال عرض سعر', nextDate: day, strength: 'strong', requestedProducts: ['قوالب البلوك المتحركة'], salesStage: 'new', ...point, locationSource: 'device', locationCapturedAt: new Date().toISOString(), locationAccuracy: 10};
  const create = async (who, customerId, lead) => post(who, '/api/customer-service', {action: 'create', requestId: crypto.randomUUID(), customerId, customerVersion: await version(customerId), registration: fields, elapsedMilliseconds: 60000, lead});
  const approve = async (who, id, extra) => post(who, '/api/customer-service', {action: 'approve', id, version: await caseVersion(id), requestId: crypto.randomUUID(), ...extra});
  const stage = async (who, id, extra) => post(who, '/api/customer-service', {action: 'stage', id, version: await caseVersion(id), requestId: crypto.randomUUID(), ...extra});
  const keep = async (customerId, owner = 'cs') => { const made = await create('cs', customerId, {group: 'service', source: 'واتساب'}); eq(made.status, 200, 'registered on ' + customerId); const id = made.json().id; eq((await approve('csm', id, {route: 'service', ownerId: owner})).status, 200, 'kept by customer service: ' + customerId); return id; };
  const sales = async (m, who = 'mgr') => (await get(who, '/api/sales?month=' + m + '&kpis=1')).json();
  const revision = async () => (await app.db.prepare("SELECT revision FROM crm_erp_import_state WHERE id='yourrest-industries'").first()).revision;
  const pendingCase = (id, customerId, createdAt) => app.db.prepare('INSERT INTO crm_service_cases(id,customer_id,status,creator_id,service_manager_id,sales_manager_id,assigned_to,supervisor_id,data,created_at,updated_at,version,mutation_id,lead_group,lead_source) VALUES(?,?,?,?,?,NULL,NULL,NULL,?,?,?,1,?,?,?)')
    .bind(id, customerId, 'pending_approval', 'cs', 'csm', JSON.stringify({source: 'call', products: ['خدمات صيانة'], strength: 'strong', needs: 'احتياج', nextAction: 'متابعة', nextDate: day, participants: ['cs', 'csm'], registration: {type: 'call', visitNumber: id === 'case-late' ? 71 : 74}}), createdAt, createdAt, 'fixture', 'service', 'اتصال وارد').run();

  // ---- 1. a later decision never reclassifies: a finished month, and the documents already received on the day of the decision
  await pendingCase('case-late', 'c-late', prevMonth + '-10T07:00:00.000Z');
  await quote('q-late', 'c-late', 'Qut-600', prevMonth + '-15');
  await erp('inv-late', 'rep', 'C-LATE', prevMonth + '-20', 400000, ['Qut-600']);
  await pendingCase('case-same', 'c-same', ago(2));
  await quote('q-same', 'c-same', 'Qut-610', day);
  await erp('inv-same', 'rep', 'C-SAME', day, 300000, ['Qut-610']);
  const [beforePrev, beforeNow, revisionBefore] = [await sales(prevMonth), await sales(month), await revision()];
  ok(beforePrev.sales.some(s => s.id === 'inv-late') && beforeNow.sales.some(s => s.id === 'inv-same'), 'both invoices are the representative\'s before the decision');
  eq((await approve('csm', 'case-late', {route: 'service', ownerId: 'cs'})).status, 200, 'the opportunity of last month is kept now');
  eq((await approve('csm', 'case-same', {route: 'service', ownerId: 'cs'})).status, 200, 'the opportunity of today too');
  const [afterPrev, afterNow] = [await sales(prevMonth), await sales(month)];
  eq(afterPrev, beforePrev, 'the finished month (' + prevMonth + ') is exactly what it was: achievement, evaluation, targets, the line of full sales');
  eq(afterNow, beforeNow, 'this month too: the invoice received before the decision, though dated today, stays the representative\'s');
  eq(await revision(), revisionBefore, 'the sales data did not change, so its revision (what «بيانات المؤشرات» confirmed) need not');
  await erp('inv-same-2', 'rep', 'C-SAME', day, 100000, ['Qut-610']);
  eq((await sales(month)).serviceFullSales.map(s => s.id), ['inv-same-2'], 'an invoice of the quotation received after the decision is customer service\'s alone');

  // ---- 4. an invoice sells a kept quotation only when it is of its customer and dated on or after it
  const heldId = await keep('c-held');
  await quote('q-held', 'c-held', 'Qut-500', day);
  await erp('inv-other', 'rep2', 'C-OTH', day, 900000, ['Qut-500']);
  await erp('inv-early', 'rep', 'C-NONE', dayAgo(1), 50000, ['Qut-500']);
  let now = await sales(month);
  eq([now.sales.some(s => s.id === 'inv-other'), now.sales.some(s => s.id === 'inv-early'), now.serviceFullSales.some(s => ['inv-other', 'inv-early'].includes(s.id))], [true, true, false], 'another customer\'s invoice naming it, and one dated before it, stay in the achievement');

  // ---- 2. the ERP return of a full sale follows it, up to it
  await keep('c-k');
  await quote('q-k', 'c-k', 'Qut-700', day, 5750);
  const repNet = list => list.filter(s => s.repId === 'rep').reduce((n, s) => n + s.totalCents, 0) / 100;
  const netBefore = repNet((await sales(month)).sales);
  await erp('sale-k', 'rep', 'C-K', day, 500000, ['Qut-700']);
  await erp('ret-k', 'rep', 'C-K', day, -500000, [], 'return');
  now = await sales(month);
  eq([repNet(now.sales), now.serviceFullSales.filter(s => s.id.endsWith('-k')).map(s => [s.id, s.totalCents]).sort()], [netBefore, [['ret-k', -500000], ['sale-k', 500000]]], 'the return naming no quotation leaves with its sale: the representative\'s net is what it was (it was 5000 SAR lower)');
  await erp('ret-k-2', 'rep', 'C-K', day, -100000, [], 'return');
  now = await sales(month);
  eq([repNet(now.sales), now.serviceFullSales.some(s => s.id === 'ret-k-2')], [netBefore - 1000, false], 'a return beyond the full sales stays where it was');
  // The dashboard and every achievement read the same full sales.
  const dashboard = (await get('owner', '/api/service-performance?month=' + month)).json();
  eq(dashboard.invoices.filter(i => i.category === 'full').map(i => i.number).sort(), now.serviceFullSales.map(s => s.reference).sort(), '«أداء خدمة العملاء» lists exactly the documents every achievement leaves out');

  // ---- 6. a customer who has not bought is started again once the opportunity started from it closed
  await erp('old-dorm', 'rep', 'C-DORM', dayAgo(200), 10000);
  const dormLead = {group: 'system', refKind: 'customer', refId: 'c-dorm'};
  ok((await get('cs', '/api/service-leads?list=dormant')).json().rows.some(r => r.id === 'c-dorm'), 'listed among «عملاء منقطعون عن الشراء 90 يومًا»');
  let made = await create('cs', 'c-dorm', dormLead);
  eq(made.status, 200, 'an opportunity started from it');
  const dormId = made.json().id;
  eq([(await get('cs', '/api/service-leads?kind=customer&id=c-dorm')).json().reference.blocked, (await get('cs', '/api/service-leads?list=dormant')).json().rows.some(r => r.id === 'c-dorm')], ['للعميل فرصة مفتوحة لدى خدمة العملاء أو المبيعات؛ تابعها بدل بدء فرصة جديدة.', false], 'while it is open: not offered, and blocked with the reason');
  eq((await approve('csm', dormId, {route: 'service', ownerId: 'cs'})).status, 200, 'kept');
  eq((await stage('cs', dormId, {stage: 'lost', lossReason: 'شروط الدفع'})).status, 200, 'lost, with its reason');
  eq([(await get('cs', '/api/service-leads?kind=customer&id=c-dorm')).json().reference.blocked, (await get('cs', '/api/service-leads?list=dormant')).json().rows.some(r => r.id === 'c-dorm')], ['', true], 'closed: offered again, and not blocked');
  made = await create('cs', 'c-dorm', dormLead);
  eq(made.status, 200, 'a second opportunity is started from it');

  // ---- 5. the monthly report and its Excel keep the loss reason of an opportunity customer service kept
  const report = (await get('csm', '/api/service-report?month=' + month)).json();
  ok(report.lossReasons.some(r => r.reason === 'شروط الدفع'), 'the monthly report: «شروط الدفع», not «غير محدد»: ' + JSON.stringify(report.lossReasons));
  const reportFile = await get('csm', '/api/service-report/export?kind=requests&month=' + month);
  eq([reportFile.status, zipText(reportFile.bytes).includes('شروط الدفع')], [200, true], 'and its Excel file');

  // ---- 7. «فرص مفقودة للاسترداد»: the people on another member's opportunity are not named
  await app.db.prepare('INSERT INTO crm_service_cases(id,customer_id,status,creator_id,service_manager_id,sales_manager_id,assigned_to,supervisor_id,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?)')
    .bind('case-lost', 'c-lost', 'assigned', 'cs', 'csm', 'mgr', 'rep', null, JSON.stringify({source: 'call', products: ['خدمات صيانة'], strength: 'strong', needs: 'احتياج', nextAction: 'متابعة', nextDate: day, participants: ['cs', 'csm'], approvedAt: ago(9), assignedAt: ago(9), registration: {type: 'call', visitNumber: 72}}), ago(10), ago(10), 'fixture').run();
  await insert('k-lost', 'activity', 'c-lost', 'rep', {type: 'call', date: day, result: 'رفض', salesStage: 'lost', lossReason: 'السعر أعلى من المنافس', serviceCaseId: 'case-lost', performedBy: 'rep', responsibleId: 'rep', recordedByEmail: 'rep@yourrest.org'}, ago(2));
  const lostRow = async who => (await get(who, '/api/service-leads?list=lost')).json().rows.find(r => r.id === 'case-lost');
  const other = await lostRow('cs2'), mine = await lostRow('cs');
  eq([other.customerName, other.lossReason, other.holderName, other.registrarName], ['مصنع c-lost', 'السعر أعلى من المنافس', '', ''], 'another member reads the customer and the loss reason, and nobody\'s name');
  eq([mine.holderName, mine.registrarName], ['المندوب الأول', 'ممثلة الخدمة'], 'its registrar reads who held it');
  eq([(await get('cs2', '/api/service-leads?list=lost&q=' + encodeURIComponent('المندوب الأول'))).json().rows.length, (await get('cs', '/api/service-leads?list=lost&q=' + encodeURIComponent('المندوب الأول'))).json().rows.length], [0, 1], 'nor is it found by a name it does not show');
  const reference = (await get('cs2', '/api/service-leads?kind=opportunity&id=case-lost')).json().reference;
  eq(Object.keys(reference).sort(), ['blocked', 'customerId', 'customerName', 'id', 'kind', 'label', 'source'], 'starting from it names no person either');

  // ---- the owner's decision 2: an interested contact makes a support sale for 30 days, not 31
  const supportRow = (id, customerId, days) => insert(id, 'support', null, 'rep', {kind: 'support', customerId, origin: 'rep', status: 'done', requestedBy: 'rep', requestedAt: ago(days + 1), repId: 'rep', note: 'متابعة', channel: 'any', handlerId: 'cs', handlerAt: ago(days + 1), handlerBy: 'cs', result: {outcome: 'reached_interested', note: 'مهتم', nextDate: '', by: 'cs', at: ago(days)}, events: []}, ago(days + 1));
  await supportRow('support-30', 'c-s30', 30); await supportRow('support-31', 'c-s31', 31);
  await erp('inv-s30', 'rep', 'C-S30', day, 40000); await erp('inv-s31', 'rep', 'C-S31', day, 40000);
  // Another customer-service team, under the other sales manager (mgrw), with an opportunity of its own.
  eq((await create('cs3', 'c-team2', {group: 'service', source: 'واتساب'})).status, 200, 'the other team registers an opportunity');

  // ---- 3. the dashboard, its Excel and the role tasks follow what the reader may read
  const names = view => view.opportunities.filter(o => o.customerName).map(o => o.customerName).sort();
  const perf = async who => (await get(who, '/api/service-performance?month=' + month)).json();
  const [asOwner, asCsm, asMgr, asMgrw, asAdminw] = [await perf('owner'), await perf('csm'), await perf('mgr'), await perf('mgrw'), await perf('adminw')];
  ok(names(asOwner).includes('مصنع c-held') && names(asCsm).includes('مصنع c-held'), 'the administrator and the customer-service manager read the customers');
  const kept = asMgr.opportunities.filter(o => o.route === 'service');
  eq([kept.length > 0, kept.every(o => !o.customerName && !o.ownerName && o.hidden), asMgr.opportunities.filter(o => o.customerName).every(o => o.route === 'sales')], [true, true, true], 'the sales manager reads no customer, nor who keeps it, of an opportunity customer service keeps; only of one passed to him');
  eq([names(asMgrw), names(asAdminw)], [[], []], 'nor does a reader of another region (a sales manager, an administrator)');
  eq([asOwner.teams.map(t => t.managerId).sort(), asMgr.teams.map(t => t.managerId), asMgrw.teams.map(t => t.managerId)], [['csm', 'csm2'], ['csm'], ['csm2']], 'the administrator reads every team; each sales manager the customer-service team under him only (the owner\'s decision 3)');
  eq([asMgr.teams[0].total, asMgrw.teams[0].total], [asOwner.teams.find(t => t.managerId === 'csm').total, asOwner.teams.find(t => t.managerId === 'csm2').total], 'with the figures the administrator reads for that team');
  const ofTeam2 = view => [view.opportunities.some(o => o.registrarName === 'ممثل الفريق الثاني'), view.teams.some(t => t.rows.some(r => r.memberId === 'cs3'))];
  eq([ofTeam2(asMgr), ofTeam2(asMgrw), ofTeam2(asOwner)], [[false, false], [true, true], [true, true]], 'no row or opportunity of another team: the other team\'s belong to its own sales manager');
  const supportSales = asOwner.invoices.filter(i => i.category === 'support').map(i => i.number);
  eq([supportSales.includes('INV-inv-s30'), supportSales.includes('INV-inv-s31'), asOwner.supportDays], [true, false, 30], 'a support sale within 30 days of an interested contact; not after 31 (the owner\'s decision 2)');
  const exportText = async who => { const file = await get(who, '/api/service-performance/export?month=' + month); eq(file.status, 200, who + ' downloads the Excel file'); return zipText(file.bytes); };
  const [mgrFile, mgrwFile, ownerFile] = [await exportText('mgr'), await exportText('mgrw'), await exportText('owner')];
  ok(!mgrwFile.includes('مصنع c-held') && !mgrFile.includes('مصنع c-held'), 'nor in the Excel file');
  ok(ownerFile.includes('مصنع c-held'), 'which the administrator\'s carries');
  eq([mgrFile.includes('ممثل الفريق الثاني'), mgrFile.includes('مدير خدمة العملاء الثاني'), mgrwFile.includes('ممثل الفريق الثاني'), ownerFile.includes('ممثل الفريق الثاني')], [false, false, true, true], 'the sales manager\'s Excel file has no figure or row of another team');
  eq((await stage('cs', heldId, {stage: 'lost', lossReason: 'السعر أعلى من المنافس'})).status, 200, 'the kept opportunity is lost: a role task for its owner');
  const tasks = async who => (await get(who, '/api/service-role-tasks')).json().tasks.map(t => t.caseId);
  ok((await tasks('owner')).includes(heldId) && (await tasks('cs')).includes(heldId) && (await tasks('csm')).includes(heldId), 'the administrator, the owner and the manager see it');
  eq((await tasks('adminw')).includes(heldId), false, 'an administrator of another region does not');
  const recordAs = who => post(who, '/api/service-role-tasks', {caseId: heldId, roles: ['جلب العميل'], note: 'سجّلها مدير نظام منطقة أخرى', requestId: crypto.randomUUID()});
  eq((await recordAs('adminw')).status, 404, 'nor records it');
  eq((await recordAs('owner')).status, 200, 'the administrator of every region does');

  // ---- «مستهدفي»: a full customer-service sale is not the representative's work in a closed month
  await app.db.prepare('INSERT INTO crm_service_cases(id,customer_id,status,creator_id,service_manager_id,sales_manager_id,assigned_to,supervisor_id,data,created_at,updated_at,version,mutation_id,lead_group,lead_source,route,routed_by,routed_at) VALUES(?,?,?,?,?,NULL,?,NULL,?,?,?,1,?,?,?,?,?,?)')
    .bind('case-own', 'c-own', 'service', 'cs', 'csm', 'cs', JSON.stringify({source: 'call', products: ['خدمات صيانة'], strength: 'strong', needs: 'احتياج', nextAction: 'متابعة', nextDate: day, participants: ['cs', 'csm'], approvedAt: prevMonth + '-02T07:00:00.000Z', registration: {type: 'call', visitNumber: 73}}), prevMonth + '-01T07:00:00.000Z', prevMonth + '-02T07:00:00.000Z', 'fixture', 'service', 'واتساب', 'service', 'csm', prevMonth + '-02T07:00:00.000Z').run();
  await quote('q-own', 'c-own', 'Qut-800', prevMonth + '-05');
  await erp('inv-own', 'rep3', 'C-OWN', prevMonth + '-10', 200000, ['Qut-800']);
  const prev = await sales(prevMonth);
  eq([prev.serviceFullSales.some(s => s.id === 'inv-own'), prev.kpis.people.find(p => p.member.id === 'rep3')?.inactive], [true, true], 'rep3\'s only document of ' + prevMonth + ' is a full customer-service sale: out of the evaluation');
  eq((await get('rep3', '/api/targets?month=' + prevMonth)).json().inactive, true, 'and «مستهدفي» says the same');

  console.log(JSON.stringify({ok: true, checks, scope: 'the review of customer service in the sales process on the built release: later decisions, returns, quotation matching, reach of the dashboard and role tasks, the monthly report, the dormant source, the lost list, the own page', productionDataUsed: false}));
} catch (error) {
  console.error(app.log().slice(-4000));
  throw error;
} finally {
  await app.stop();
}
