// «تصدير Excel» of the customer-service reports (GET /api/service-report/export, lib/service-report-export.ts; the owner, 2026-11-16, item
// 3 of the GSCO list, «ب») and the requests report by «نوع التواصل» («أ», GET /api/service-report) over real HTTP against the BUILT release
// (run the build first): anonymous 401; an unknown kind or month 400; the roles the reports are not for 403 with the reports' words; the
// screen that shows the report hidden 404 (as any hidden screen's request); the cell «تقارير خدمة العملاء · تصدير» switched off 403, for a
// sales manager, a customer-service manager and another administrator; a POST 405; the file itself (an .xlsx of three sheets, attachment,
// never cached), its rows exactly what the reader may read (two sales managers, two customer-service managers, the administrator), in
// Arabic and English; reading changes nothing. Synthetic fixtures only: temporary SQLite, mocked mail, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {pathToFileURL} from 'node:url';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const root = process.cwd();
fs.mkdirSync(path.join(root, '.sites-runtime'), {recursive: true});
const out = fs.mkdtempSync(path.join(root, '.sites-runtime', 'export-http-'));
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}');
// The project's own strict workbook reader (lib/erp-sales.ts readWorkbookSheets) reads the files back.
fs.writeFileSync(path.join(out, 'erp-sales.mjs'), ts.transpileModule(fs.readFileSync(path.join(root, 'lib/erp-sales.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText);
const E = await import(pathToFileURL(path.join(out, 'erp-sales.mjs')));

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'admin2', role: 'admin', name: 'مدير ثانٍ'},
  {id: 'mgr', role: 'manager', name: 'مدير المبيعات'}, {id: 'mgr2', role: 'manager', name: 'مدير المبيعات الثاني'},
  {id: 'mgrh', role: 'manager', name: 'مدير بلا زيارات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف'}, {id: 'rep', role: 'rep', sup: 'sup', name: 'المندوب'}, {id: 'rep2', role: 'rep', sup: 'mgr2', name: 'مندوب الثاني'},
  {id: 'csm', role: 'customer_service_manager', sup: 'mgr', name: 'مدير خدمة العملاء'}, {id: 'cs', role: 'customer_service', sup: 'csm', name: 'خدمة العملاء'},
  {id: 'csm2', role: 'customer_service_manager', sup: 'mgr2', name: 'مدير الخدمة الثاني'}, {id: 'cs2', role: 'customer_service', sup: 'csm2', name: 'خدمة ثانية'},
  {id: 'csmh', role: 'customer_service_manager', sup: 'mgr', name: 'مدير خدمة بلا شكاوى'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const app = await bootBuiltApp({members});
try {
  const now = new Date().toISOString(), month = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()).slice(0, 7);
  const earlier = new Date(Date.now() - 3 * 3600000).toISOString();
  const insert = (id, kind, parent, assigned, data, at = earlier) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,'الرئيسي',?,?,?,1,'fixture')").bind(id, kind, parent, assigned, JSON.stringify(data), at, at).run();
  for (const [id, rep] of [['c1', 'rep'], ['c2', 'rep'], ['c3', 'rep'], ['c4', 'rep2'], ['k1', 'rep'], ['k2', 'rep2']]) await insert(id, 'customer', null, rep, {name: 'مصنع ' + id, region: 'الشرقية', city: 'الدمام', phone: '0500000000'});
  const kase = (id, customerId, status, fields, data) => app.db.prepare('INSERT INTO crm_service_cases(id,customer_id,status,creator_id,service_manager_id,sales_manager_id,assigned_to,supervisor_id,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,2,?)')
    .bind(id, customerId, status, fields.creator || 'cs', fields.serviceManager || 'csm', ('salesManager' in fields ? fields.salesManager : 'mgr'), fields.assignedTo || null, fields.supervisor || null, JSON.stringify({products: ['خدمات صيانة'], strength: 'strong', needs: 'PRIVATE-NEEDS', nextAction: 'زيارة', nextDate: '2030-01-01', participants: [fields.creator || 'cs', fields.serviceManager || 'csm'], ...data}), earlier, earlier, 'fixture').run();
  // Requests: a call won, an OLD one (no source, its registration's type email), the oldest (no type: «غير محدد»), another team's.
  await kase('case-1', 'c1', 'assigned', {assignedTo: 'rep', supervisor: 'sup'}, {source: 'call', approvedAt: earlier, assignedAt: earlier, registration: {type: 'call', visitNumber: 51}});
  await insert('k-1', 'activity', 'c1', 'rep', {type: 'call', date: now.slice(0, 10), result: 'تم', salesStage: 'won', serviceCaseId: 'case-1', performedBy: 'rep', responsibleId: 'rep', recordedByEmail: 'rep@yourrest.org'}, now);
  await kase('case-2', 'c2', 'pending_assignment', {}, {approvedAt: earlier, registration: {type: 'email'}});
  await kase('case-3', 'c3', 'pending_approval', {salesManager: null}, {});
  await kase('case-4', 'c4', 'pending_assignment', {creator: 'cs2', serviceManager: 'csm2', salesManager: 'mgr2'}, {source: 'social', approvedAt: earlier});
  // Complaints: the first team's (handed to mgr) and the second's.
  const complaint = (id, customerId, data) => insert(id, 'complaint', null, data.registrarId || 'cs', {kind: 'complaint', customerId, status: 'submitted', registrarId: 'cs', serviceManagerId: 'csm', salesManagerId: '', supervisorId: '', assigneeId: '', channel: 'call', category: 'product_quality', severity: 'normal', description: 'PRIVATE-DESCRIPTION', demand: '', reference: '', contactName: '', contactPhone: '', submittedAt: earlier, forwardedAt: '', returnedAt: '', assignedAt: '', delegatedAt: '', reassignedAt: '', rejectedAt: '', reopenedAt: '', resolvedAt: '', closedAt: '', cancelledAt: '', seenAt: '', returnNote: '', assignmentNote: '', rejectReason: '', cancelReason: '', previousAssignees: [], updates: [], notes: [], events: [], ...data});
  await complaint('complaint-1', 'k1', {complaintNumber: 1, status: 'pending_assignment', salesManagerId: 'mgr', forwardedAt: earlier, severity: 'high'});
  await complaint('complaint-2', 'k2', {complaintNumber: 2, registrarId: 'cs2', serviceManagerId: 'csm2'});
  // «الصلاحيات»: mgrh has «الزيارات» hidden, csmh «الشكاوى»; the export switched off for mgr2, csm2 and admin2 (written by the administrator's own save below).
  const permissions = (id, cells, hidden) => app.db.prepare('INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_at,updated_by) VALUES(?,?,?,1,?,?)').bind(id, JSON.stringify(cells), JSON.stringify(hidden), now, 'owner').run();
  await permissions('mgrh', {}, ['activity']);
  await permissions('csmh', {}, ['complaints']);
  const cookies = {};
  for (const member of members) cookies[member.id] = await app.login(member.id);
  const get = (who, query) => app.as(who ? cookies[who] : null)('/api/service-report/export' + query);
  const sheets = bytes => E.readWorkbookSheets(bytes).map(sheet => ({name: sheet.name, rows: sheet.rows.map(row => row.cells)}));
  const before = JSON.stringify(await app.db.prepare('SELECT count(*) AS n,max(updated_at) AS u FROM crm_records').first()) + JSON.stringify(await app.db.prepare('SELECT count(*) AS n,sum(version) AS v FROM crm_service_cases').first());

  // ---- «أ»: the report by contact type, old requests counted.
  const report = (await app.as(cookies.owner)('/api/service-report?month=' + month)).json();
  eq(report.byContactType.map(row => [row.type, row.total]), [['call', 1], ['email', 1], ['social', 1], ['unknown', 1]], 'the requests report by «نوع التواصل»: the old request under its registration\'s type, the oldest under «غير محدد»');
  ok(!('bySource' in report), 'the «by source» breakdown is gone');

  // ---- the doors
  for (const kind of ['requests', 'complaints']) eq((await get(null, '?kind=' + kind)).status, 401, 'anonymous: 401 (' + kind + ')');
  for (const who of ['owner', 'mgr', 'csm']) {
    eq((await get(who, '')).json().error, 'اختر التقرير المطلوب تصديره.', who + ': no kind: 400');
    eq((await get(who, '?kind=support')).status, 400, who + ': an unknown kind: 400');
    eq((await get(who, '?kind=requests&month=2026-13')).status, 400, who + ': a month that is not one: 400');
  }
  for (const who of ['sup', 'rep', 'cs']) {
    const requests = await get(who, '?kind=requests&month=' + month), complaints = await get(who, '?kind=complaints&month=' + month);
    eq([requests.status, requests.json().error, complaints.status, complaints.json().error], [403, 'التقرير متاح لمدير النظام ومدير المبيعات ومدير خدمة العملاء فقط', 403, 'تقرير الشكاوى متاح لمدير النظام ومدير المبيعات ومدير خدمة العملاء فقط'], who + ': the reports are not theirs: 403');
  }
  for (const kind of ['requests', 'complaints']) eq([(await get('mgrh', '?kind=' + kind)).status, (await get('mgrh', '?kind=' + kind)).json().error], [404, 'هذا الجزء غير متاح لحسابك. راجع مدير النظام.'], 'a sales manager whose «الزيارات» is hidden: 404 (' + kind + ': both reports are on «الزيارات» for him)');
  eq((await get('csmh', '?kind=complaints&month=' + month)).status, 404, 'a customer-service manager whose «الشكاوى» is hidden: the complaints export 404');
  eq((await get('csmh', '?kind=requests&month=' + month)).status, 200, 'his requests export (on «الزيارات») still opens');
  eq((await app.as(cookies.owner)('/api/service-report/export?kind=requests', {method: 'POST', body: {}})).status, 405, 'GET only');

  // ---- the file
  let response = await get('owner', '?kind=requests&month=' + month);
  eq([response.status, response.headers['content-type'], response.headers['content-disposition'], response.headers['cache-control'], response.headers['x-content-type-options']],
    [200, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'attachment; filename="Yourrest-service-report-requests-' + month + '.xlsx"', 'private, no-store', 'nosniff'], 'an .xlsx attachment, never cached');
  let book = sheets(response.bytes);
  eq(book.map(sheet => sheet.name), ['الملخص', 'زمن المراحل', 'التفاصيل'], 'three sheets');
  eq(book[0].rows.slice(1, 3), [['التقرير الشهري لطلبات خدمة العملاء', month], ['الطلبات', '4']], 'the summary: the report, its month and the tiles');
  const byType = book[0].rows.findIndex(row => row[0] === 'بحسب نوع التواصل');
  eq(book[0].rows.slice(byType + 2, byType + 6).map(row => row.slice(0, 2)), [['اتصال', '1'], ['بريد إلكتروني', '1'], ['عن طريق مواقع التواصل الاجتماعي', '1'], ['غير محدد', '1']], 'and «بحسب نوع التواصل»');
  eq(book[2].rows.slice(1).map(row => [row[0], row[1], row[4]]), [['51', 'مصنع c1', 'اتصال'], ['', 'مصنع c2', 'بريد إلكتروني'], ['', 'مصنع c3', 'غير محدد'], ['', 'مصنع c4', 'عن طريق مواقع التواصل الاجتماعي']], 'one row per request of the month');
  ok(!response.text.includes('PRIVATE'), 'no registration text');
  eq(sheets((await get('mgr', '?kind=requests&month=' + month)).bytes)[2].rows.slice(1).map(row => row[1]), ['مصنع c1', 'مصنع c2'], 'the sales manager: what reached him');
  eq(sheets((await get('mgr2', '?kind=requests&month=' + month)).bytes)[2].rows.slice(1).map(row => row[1]), ['مصنع c1', 'مصنع c4'], 'the other sales manager: what was handed to him and what the sales team holds (Yourrest\'s sales-manager scope), exactly as his report on screen');
  eq(sheets((await get('mgr2', '?kind=requests&month=' + month)).bytes)[2].rows.length - 1, (await app.as(cookies.mgr2)('/api/service-report?month=' + month)).json().total, 'the file holds as many requests as his report counts');
  eq(sheets((await get('csm', '?kind=requests&month=' + month)).bytes)[2].rows.slice(1).map(row => row[1]), ['مصنع c1', 'مصنع c2', 'مصنع c3'], 'the customer-service manager: his team\'s');
  eq(sheets((await get('csm2', '?kind=requests&month=' + month)).bytes)[2].rows.slice(1).map(row => row[1]), ['مصنع c4'], 'the other customer-service manager: his team\'s');
  book = sheets((await get('owner', '?kind=complaints&month=' + month)).bytes);
  eq([book.map(sheet => sheet.name), book[2].rows.slice(1).map(row => [row[0], row[1], row[6]])], [['الملخص', 'زمن المراحل', 'التفاصيل'], [['1', 'مصنع k1', 'عالية'], ['2', 'مصنع k2', 'عادية']]], 'the complaints file: one row per complaint');
  eq(sheets((await get('mgr', '?kind=complaints&month=' + month)).bytes)[2].rows.slice(1).map(row => row[0]), ['1'], 'the sales manager: the complaint handed to him');
  eq(sheets((await get('csm2', '?kind=complaints&month=' + month)).bytes)[2].rows.slice(1).map(row => row[0]), ['2'], 'the other customer-service manager: his');
  response = await get('owner', '?kind=requests&month=' + month + '&lang=en');
  book = sheets(response.bytes);
  eq([book.map(sheet => sheet.name), book[2].rows[0].slice(0, 5)], [['Summary', 'Stage times', 'Details'], ['Request number', 'Customer', 'City', 'Region', 'Contact type']], 'in English');
  ok(!/[؀-ۿ]/.test(JSON.stringify([book[1].rows, book[2].rows[0], book[2].rows.map(row => row[4])])), 'no Arabic in its labels and types');

  // ---- the cell: the administrator closes it for a sales manager, a customer-service manager and another administrator
  for (const who of ['mgr2', 'csm2', 'admin2']) {
    const target = (await app.as(cookies.owner)('/api/crm')).json().members.find(member => member.id === who);
    const saved = await app.as(cookies.owner)('/api/crm', {method: 'POST', body: {action: 'permissions', memberId: who, version: target.permissions?.version || 0, cells: {...(target.permissions?.cells || {}), 'service-reports:export': false}, hidden: [], viewAll: false, requestId: crypto.randomUUID()}});
    eq(saved.status, 200, 'the administrator saves «تصدير» off for ' + who);
    for (const kind of ['requests', 'complaints']) {
      const refused = await get(who, '?kind=' + kind + '&month=' + month);
      eq([refused.status, refused.json().error], [403, 'غير مسموح لك بالتصدير في تقارير خدمة العملاء. راجع مدير النظام.'], who + ': the export closed (' + kind + ')');
    }
    eq((await app.as(cookies[who])('/api/service-report?month=' + month)).status, 200, who + ': the report itself still opens');
  }
  eq((await get('mgr', '?kind=requests&month=' + month)).status, 200, 'the others keep it');
  eq(JSON.stringify(await app.db.prepare('SELECT count(*) AS n,max(updated_at) AS u FROM crm_records').first()) + JSON.stringify(await app.db.prepare('SELECT count(*) AS n,sum(version) AS v FROM crm_service_cases').first()), before, 'exporting writes nothing');
  console.log(JSON.stringify({ok: true, checks, syntheticFixtures: true, productionDataUsed: false}));
} finally { await app.stop(); }
