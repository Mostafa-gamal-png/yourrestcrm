// «تصدير Excel» of the lists the server builds (GET /api/list-export, lib/list-export.ts and lib/list-export-service.ts; the owner,
// 2026-11-19, GSCO 2.13.80) over real HTTP against the BUILT release (run the build first): anonymous 401; a list that is not one of the
// three 400; a representative and a marketing officer 403 (they never export); «مصادر الفرص» to the sales roles 403 with its own words;
// the screen that shows the list hidden 404 (the complaints on «الشكاوى» for customer service and on «الزيارات» for a sales manager); the
// screen's «تصدير» cell switched off 403 (a sales manager's «الزيارات»، a customer-service member's «الشكاوى», another administrator's);
// a POST 405; the file (an .xlsx attachment, never cached, its name, the counts in its headers) and its rows exactly the page's own
// reading for every reader: the complaints of GET /api/complaints, the requests and missed visits of GET /api/support, the lost
// opportunities and dormant customers of GET /api/service-leads, in Arabic and English; the whole list where the page holds 300 of it;
// reading changes nothing. Synthetic fixtures only: temporary SQLite, mocked mail, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {pathToFileURL} from 'node:url';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const root = process.cwd();
fs.mkdirSync(path.join(root, '.sites-runtime'), {recursive: true});
const out = fs.mkdtempSync(path.join(root, '.sites-runtime', 'list-export-http-'));
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}');
// The project's own strict workbook reader reads the files back.
fs.writeFileSync(path.join(out, 'erp-sales.mjs'), ts.transpileModule(fs.readFileSync(path.join(root, 'lib/erp-sales.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText);
const E = await import(pathToFileURL(path.join(out, 'erp-sales.mjs')));

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'admin2', role: 'admin', name: 'مدير ثانٍ'},
  {id: 'mgr', role: 'manager', name: 'مدير المبيعات'}, {id: 'mgr2', role: 'manager', name: 'مدير المبيعات الثاني'},
  {id: 'mgrh', role: 'manager', name: 'مدير بلا زيارات'}, {id: 'mgrx', role: 'manager', name: 'مدير بلا تصدير'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف'}, {id: 'rep', role: 'rep', sup: 'sup', name: 'المندوب'}, {id: 'mkt', role: 'marketing', sup: 'sup', name: 'مسؤول التسويق'},
  {id: 'rep2', role: 'rep', sup: 'mgr2', name: 'مندوب الثاني'},
  {id: 'csm', role: 'customer_service_manager', sup: 'mgr', name: 'مدير خدمة العملاء'}, {id: 'cs', role: 'customer_service', sup: 'csm', name: 'خدمة العملاء'},
  {id: 'csm2', role: 'customer_service_manager', sup: 'mgr2', name: 'مدير الخدمة الثاني'}, {id: 'cs2', role: 'customer_service', sup: 'csm2', name: 'خدمة ثانية'},
  {id: 'csmh', role: 'customer_service_manager', sup: 'mgr', name: 'مدير خدمة بلا شكاوى'}, {id: 'csx', role: 'customer_service', sup: 'csm', name: 'خدمة بلا تصدير'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const ARABIC = /[؀-ۿ]/;
const app = await bootBuiltApp({members});
try {
  const now = new Date().toISOString(), day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date());
  const ago = hours => new Date(Date.now() - hours * 3600000).toISOString();
  const insert = (id, kind, parent, assigned, data, at = ago(30)) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,'الرئيسي',?,?,?,1,'fixture')").bind(id, kind, parent, assigned, JSON.stringify(data), at, at).run();
  for (const [id, rep] of [['k1', 'rep'], ['k2', 'rep2'], ['k3', 'rep'], ['k4', 'rep2'], ['k5', 'rep'], ['k6', 'rep']]) await insert(id, 'customer', null, rep, {name: id === 'k5' ? '=HYPERLINK("http://example.invalid","x")' : 'مصنع ' + id, region: 'الشرقية', city: 'الدمام', phone: '0500000000', code: id === 'k6' ? '00042' : ''}, ago(9000));
  // Complaints: the first team's (handed to mgr, held by rep), the second's, and 305 more of the first team's, so the page holds 300.
  const complaintBase = {kind: 'complaint', status: 'pending_assignment', registrarId: 'cs', serviceManagerId: 'csm', salesManagerId: 'mgr', supervisorId: '', assigneeId: '', channel: 'call', category: 'product_quality', severity: 'normal', description: 'PRIVATE-DESCRIPTION', demand: 'PRIVATE-DEMAND', reference: '', contactName: '', contactPhone: '', submittedAt: ago(30), forwardedAt: ago(29), returnedAt: '', assignedAt: '', delegatedAt: '', updates: [], notes: [{at: ago(28), by: 'csm', text: 'PRIVATE-NOTE'}], events: []};
  await insert('complaint-1', 'complaint', null, 'cs', {...complaintBase, customerId: 'k1', complaintNumber: 1, severity: 'high'});
  await insert('complaint-2', 'complaint', null, 'cs2', {...complaintBase, customerId: 'k2', complaintNumber: 2, registrarId: 'cs2', serviceManagerId: 'csm2', salesManagerId: 'mgr2'});
  for (let n = 0; n < 305; n++) await insert('complaint-bulk-' + n, 'complaint', null, 'cs', {...complaintBase, customerId: 'k3', complaintNumber: 100 + n}, ago(40 + n));
  // Assistance requests: one for each team.
  const supportBase = {kind: 'support', origin: 'rep', status: 'open', requestedAt: ago(10), note: 'PRIVATE-SUPPORT-NOTE', channel: 'whatsapp', handlerId: '', handlerAt: '', handlerBy: '', events: []};
  await insert('support-1', 'support', null, 'rep', {...supportBase, customerId: 'k1', requestedBy: 'rep', repId: 'rep'});
  await insert('support-2', 'support', null, 'rep2', {...supportBase, customerId: 'k2', requestedBy: 'rep2', repId: 'rep2'});
  // A lost opportunity of each team (for «مصادر الفرص»).
  const kase = (id, customerId, creator, manager, salesManager, assigned) => app.db.prepare('INSERT INTO crm_service_cases(id,customer_id,status,creator_id,service_manager_id,sales_manager_id,assigned_to,supervisor_id,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?)')
    .bind(id, customerId, 'assigned', creator, manager, salesManager, assigned, null, JSON.stringify({source: 'call', products: ['خدمات صيانة'], strength: 'strong', needs: 'احتياج', nextAction: 'متابعة', nextDate: day, participants: [creator, manager], approvedAt: ago(200), assignedAt: ago(200), registration: {type: 'call', visitNumber: 70}}), ago(220), ago(220), 'fixture').run();
  await kase('case-lost-1', 'k3', 'cs', 'csm', 'mgr', 'rep');
  await insert('k-lost-1', 'activity', 'k3', 'rep', {type: 'call', date: day, result: 'رفض', salesStage: 'lost', lossReason: 'السعر أعلى من المنافس', serviceCaseId: 'case-lost-1', performedBy: 'rep', responsibleId: 'rep', recordedByEmail: 'rep@yourrest.org'}, ago(20));
  await kase('case-lost-2', 'k4', 'cs2', 'csm2', 'mgr2', 'rep2');
  await insert('k-lost-2', 'activity', 'k4', 'rep2', {type: 'call', date: day, result: 'رفض', salesStage: 'lost', lossReason: 'مدة التوريد', serviceCaseId: 'case-lost-2', performedBy: 'rep2', responsibleId: 'rep2', recordedByEmail: 'rep2@yourrest.org'}, ago(21));
  // «الصلاحيات»: mgrh has «الزيارات» hidden, csmh «الشكاوى»; the export closed for mgrx («الزيارات»), csx («الشكاوى») and admin2 («الشكاوى»).
  const permissions = (id, cells, hidden) => app.db.prepare('INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_at,updated_by) VALUES(?,?,?,1,?,?)').bind(id, JSON.stringify(cells), JSON.stringify(hidden), now, 'owner').run();
  await permissions('mgrh', {}, ['activity']);
  await permissions('csmh', {}, ['complaints']);
  await permissions('mgrx', {'activity:export': false}, []);
  await permissions('csx', {'complaints:export': false}, []);
  await permissions('admin2', {'complaints:export': false}, []);
  const cookies = {};
  for (const member of members) cookies[member.id] = await app.login(member.id);
  const get = (who, query) => app.as(who ? cookies[who] : null)('/api/list-export' + query);
  const page = (who, url) => app.as(cookies[who])(url);
  const sheets = bytes => E.readWorkbookSheets(bytes, {maxRows: 1000}).map(sheet => ({name: sheet.name, rows: sheet.rows.map(row => row.cells)}));
  const count = async () => JSON.stringify(await app.db.prepare('SELECT count(*) AS n,max(updated_at) AS u,sum(version) AS v FROM crm_records').first()) + JSON.stringify(await app.db.prepare('SELECT count(*) AS n FROM crm_audit').first());
  const before = await count();

  // ---- the doors
  for (const query of ['?page=complaints', '?page=support', '?page=service-leads&list=lost']) eq((await get(null, query)).status, 401, 'anonymous: 401 ' + query);
  for (const query of ['', '?page=visits', '?page=customers', '?page=trash', '?page=__proto__', '?page=constructor']) eq([(await get('owner', query)).status, (await get('owner', query)).json().error], [400, 'اختر القائمة المطلوب تصديرها.'], 'not a list the server builds: 400 ' + JSON.stringify(query));
  for (const who of ['rep', 'mkt']) for (const query of ['?page=complaints', '?page=support', '?page=service-leads&list=lost'])
    eq([(await get(who, query)).status, (await get(who, query)).json().error], [403, 'تصدير القوائم غير متاح لحسابك.'], who + ': a field role never exports: 403 ' + query);
  for (const who of ['mgr', 'sup']) eq([(await get(who, '?page=service-leads&list=lost')).status, (await get(who, '?page=service-leads&list=lost')).json().error], [403, 'مصادر الفرص متاحة لخدمة العملاء ومدير النظام.'], who + ': «مصادر الفرص» is not theirs: 403');
  for (const query of ['?page=complaints', '?page=support']) eq([(await get('mgrh', query)).status, (await get('mgrh', query)).json().error], [404, 'هذا الجزء غير متاح لحسابك. راجع مدير النظام.'], 'a sales manager whose «الزيارات» is hidden: 404 ' + query + ' (both are on «الزيارات» for him)');
  eq([(await get('csmh', '?page=complaints')).status, (await get('csmh', '?page=support')).status], [404, 200], '«الشكاوى» hidden from a customer-service manager: the complaints 404, «التواصل مع العملاء» still 200');
  for (const query of ['?page=complaints', '?page=support']) eq([(await get('mgrx', query)).status, (await get('mgrx', query)).json().error], [403, 'غير مسموح لك بالتصدير في الزيارات. راجع مدير النظام.'], '«الزيارات · تصدير» closed: 403 ' + query);
  eq([(await get('csx', '?page=complaints')).status, (await get('csx', '?page=complaints')).json().error, (await get('csx', '?page=support')).status, (await get('csx', '?page=service-leads&list=lost')).status], [403, 'غير مسموح لك بالتصدير في الشكاوى. راجع مدير النظام.', 200, 200], '«الشكاوى · تصدير» closed for customer service: the complaints 403, the lists of «الزيارات» still 200');
  eq([(await get('admin2', '?page=complaints')).status, (await get('admin2', '?page=support')).status], [403, 200], 'another administrator\'s «الشكاوى · تصدير» closed: 403');
  for (const list of ['', '&list=other']) eq([(await get('cs', '?page=service-leads' + list)).status, (await get('cs', '?page=service-leads' + list)).json().error], [400, 'اختر القائمة المطلوبة.'], '«مصادر الفرص» without a list that is one: 400');
  eq((await app.as(cookies.owner)('/api/list-export?page=complaints', {method: 'POST', body: {}})).status, 405, 'POST 405');
  eq((await get('owner', '?page=complaints&lang=en')).headers['content-type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'the file\'s type');

  // ---- the files: every reader's rows are its page's own reading
  const numbers = rows => rows.slice(1).map(row => Number(row[0])).sort((a, b) => a - b);
  for (const who of ['owner', 'mgr', 'mgr2', 'sup', 'csm', 'cs', 'csm2', 'cs2']) {
    const response = await get(who, '?page=complaints'), file = sheets(response.bytes), listed = (await page(who, '/api/complaints')).json();
    eq([response.status, response.headers['cache-control'], response.headers['x-content-type-options'], response.headers['content-disposition']], [200, 'private, no-store', 'nosniff', 'attachment; filename="Yourrest-complaints-' + day + '.xlsx"'], who + ': the complaints file, an attachment never cached');
    eq(file.map(sheet => sheet.name), ['الشكاوى'], who + ': one sheet');
    eq(file[0].rows[0].slice(0, 4), ['رقم الشكوى', 'العميل', 'هاتف العميل', 'المدينة'], who + ': the Arabic header');
    eq(file[0].rows.length - 1, listed.counts.complaints, who + ': every complaint the page counts (' + listed.counts.complaints + '), not only the ' + listed.complaints.length + ' it holds');
    if (listed.counts.complaints <= 300) eq(numbers(file[0].rows), listed.complaints.map(entry => entry.complaintNumber).sort((a, b) => a - b), who + ': exactly the complaints of its page');
    eq([response.headers['x-export-rows'], response.headers['x-export-total'], response.headers['x-export-capped']], [String(listed.counts.complaints), String(listed.counts.complaints), '0'], who + ': the counts in the headers');
    ok(!response.text.includes('PRIVATE'), who + ': never a description, a demand or a note');
  }
  const ownerFile = sheets((await get('owner', '?page=complaints')).bytes)[0].rows;
  eq([ownerFile.length - 1, (await page('owner', '/api/complaints')).json().complaints.length], [307, 300], 'the administrator: the 307 complaints, where the page holds 300');
  eq(numbers(sheets((await get('mgr2', '?page=complaints')).bytes)[0].rows), [2], 'the second sales manager: his team\'s complaint only');
  eq(numbers(sheets((await get('csm2', '?page=complaints')).bytes)[0].rows), [2], 'the second customer-service manager: her team\'s complaint only');
  const english = sheets((await get('owner', '?page=complaints&lang=en')).bytes)[0];
  ok(english.rows[0].every(cell => !ARABIC.test(cell)) && english.rows.slice(1).some(row => row.includes('High')), 'in English: the headers and the words, the customers\' names as written');

  for (const who of ['owner', 'mgr', 'mgr2', 'sup', 'csm', 'cs', 'cs2', 'csmh', 'csx', 'admin2']) {
    const response = await get(who, '?page=support'), file = sheets(response.bytes), listed = (await page(who, '/api/support')).json();
    eq([response.status, file.map(sheet => sheet.name)], [200, ['طلبات المساندة', 'الزيارات المفقودة']], who + ': «التواصل مع العملاء», two sheets');
    eq([file[0].rows.length - 1, file[1].rows.length - 1], [listed.counts.requests, listed.counts.missed], who + ': every request and missed visit its page counts');
    eq(file[0].rows.slice(1).map(row => row[1]).sort(), listed.requests.map(entry => entry.customerName).sort(), who + ': the requests of its page');
    ok(!response.text.includes('PRIVATE'), who + ': never the request\'s note');
  }

  for (const who of ['owner', 'csm', 'cs', 'cs2']) for (const list of ['lost', 'dormant']) {
    const response = await get(who, '?page=service-leads&list=' + list), file = sheets(response.bytes), listed = (await page(who, '/api/service-leads?list=' + list)).json();
    eq([response.status, file.length, file[0].rows.length - 1], [200, 1, listed.total], who + ': «' + list + '» every row of the list (' + listed.total + ')');
    eq(file[0].rows.slice(1).map(row => row[list === 'lost' ? 1 : 0]).sort(), listed.rows.map(row => list === 'lost' ? row.customerName : row.name).sort(), who + ': the rows of its page (' + list + ')');
  }
  eq(sheets((await get('cs', '?page=service-leads&list=lost&q=' + encodeURIComponent('k3'))).bytes)[0].rows.slice(1).map(row => row[1]), ['مصنع k3'], 'the search of the panel narrows the file');
  const dormant = sheets((await get('owner', '?page=service-leads&list=dormant&lang=en')).bytes)[0];
  ok(dormant.rows[0].every(cell => !ARABIC.test(cell)) && dormant.rows.some(row => row[0] === '=HYPERLINK("http://example.invalid","x")') && dormant.rows.some(row => row[1] === '00042'), 'English headers; a formula-looking name and a code with its zeros as written');
  eq((await get('owner', '?page=service-leads&list=lost')).headers['content-disposition'], 'attachment; filename="Yourrest-opportunity-sources-' + day + '.xlsx"', 'the file\'s name');

  eq(await count(), before, 'exporting changes nothing (no record, no version, no audit line)');
  console.log(JSON.stringify({ok: true, checks, productionDataUsed: false}));
} finally {
  await app.stop();
}
