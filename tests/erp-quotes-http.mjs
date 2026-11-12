// «استيراد عروض الأسعار من ERP» (GET/POST /api/erp-quotes, lib/erp-quotes-server.ts) over real HTTP against the BUILT release (run
// `npm run build` first), with a synthetic report written as the ERP writes it (scripts/lib/erp-quotes-fixture.mjs: UTF-16LE HTML «.xls»,
// 197 columns, one row per line): anonymous 401, a representative and customer service 403, a supervisor whose «إضافة» on «عروض الأسعار»
// or «استيراد» on «المبيعات» is switched off 403 (the button sits beside the ERP sales import), a hidden «عروض الأسعار» 404, another origin 403, a body over the limit 413; the preview (counts, reasons, the customers the CRM does not have,
// the employees and their mapping: by a unique full name, chosen, unmapped) writes nothing; the import adds one quote per quotation under
// its customer (the mapped representative, the customer's branch, the ERP number, status «مرسل», the ERP's figures, the items' code and
// unit, the marker), one «إضافة» history line each and one import line, and saves the employee mappings; the same request again after a
// lost answer returns its answer and writes nothing twice, the old preview with another request id is refused (409); the same file again
// changes nothing (versions kept); a quote edited by hand through /api/crm keeps its ERP marker, representative and item codes, and the
// next import leaves it alone; a newer export updates the same record (version, «تعديل» line, before and after in the import's line); the
// sales manager's preview refuses a customer outside their regions; the imported quotes are in /api/crm for the sales roles (not for a
// representative), offered by the KPI evidence for the month, and the import's mapping is the ERP sales import's. «مبيعات مكتب»
// quotations are excluded (never written, no mapping), and a customer code two customers carry: listed with exactly its customers to the
// administrator (only the code to a sales manager), mapped through /api/customer-identities (403 to others, a customer that does not carry
// it refused, the same request once, an old revision 409, an older preview 409), then imported under the chosen customer, unchanged again,
// and the mapping changed later without moving the imported quote. Matching reads current codes only (2026-11-12): a customer whose code
// was cleared is no candidate for its old code (no «مسجل لأكثر من عميل», even against a stored mapping to it), its old code's quotations
// go to the customer that carries it now or to nobody, and the customer form writes no ERP code (2026-11-12: only the ERP customers import does).
// Synthetic fixtures only: temporary SQLite, mocked sendmail, never the owner's file.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {quotation, erpQuotesXls} from '../scripts/lib/erp-quotes-fixture.mjs';

const members = [{id: 'owner', role: 'admin'}, {id: 'mgr', role: 'manager', region: 'central'}, {id: 'sup', role: 'supervisor', sup: 'mgr'}, {id: 'sup2', role: 'supervisor', sup: 'mgr'}, {id: 'sup3', role: 'supervisor', sup: 'mgr'},
  {id: 'rep', role: 'rep', sup: 'sup', name: 'أحمد المندوب'}, {id: 'rep2', role: 'rep', sup: 'sup2', name: 'سالم المندوب'}, {id: 'cs', role: 'customer_service'}];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const lines = {
  q1: [{name: 'قالب بلوك 20 سم', qty: 1, price: 18500, code: '10010001'}],
  q2: [{name: 'قالب انترلوك', qty: 2, price: 9000, discount: 500, code: '10020001', description: 'مع جلبة'}, {name: 'جلبة إضافية', qty: 4, price: 250.5, code: '10030002-1', unit: 'قطعة / PC'}],
};
const report = (overrides = {}) => [
  ...quotation({code: 'Qut-1001', customerCode: '101', empCode: '7001', empName: 'أحمد المندوب', lines: overrides.q1 || lines.q1}),
  ...quotation({code: 'Qut-1002', customerCode: '102', empCode: '7001', empName: 'أحمد المندوب', documentDiscount: 100, note: 'يشمل التركيب', lines: lines.q2}),
  ...quotation({code: 'Qut-1003', customerCode: '999', customerName: 'عميل ليس في النظام', empCode: '7001', empName: 'أحمد المندوب', lines: lines.q1}),
  ...quotation({code: 'Qut-1004', customerCode: '201', empCode: '7001', empName: 'أحمد المندوب', lines: lines.q1}),
  ...quotation({code: 'Qut-1005', customerCode: '101', empCode: '7002', empName: 'موظف آخر', lines: lines.q1}),
  ...quotation({code: 'Qut-1006', customerCode: '301', empCode: '7001', empName: 'أحمد المندوب', lines: lines.q1}),
];
const base64 = rows => erpQuotesXls(rows).toString('base64');

const app = await bootBuiltApp({members});
try {
  const now = new Date().toISOString();
  const customer = (id, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'rep','فرع جدة',?,?,?,1,'fixture')")
    .bind(id, JSON.stringify({branch: 'فرع جدة', assignedTo: 'rep', region: 'الوسطى', city: 'الرياض', address: 'حي الصناعية', ...data}), now, now).run();
  await customer('c101', {name: 'مصنع الاختبار الأول', code: '101'});
  await customer('c102', {name: 'مصنع الاختبار الثاني', code: '102'});
  await customer('dupA', {name: 'مصنع مكرر أ', code: '201'});
  await customer('dupB', {name: 'مصنع مكرر ب', code: '201'});
  await customer('east', {name: 'مصنع الشرقية', code: '301', region: 'الشرقية'});
  const count = async (sql, ...args) => Number((await app.db.prepare(sql).bind(...args).first()).n);
  const quotes = () => count("SELECT COUNT(*) n FROM crm_records WHERE kind='quote'");
  const record = async number => { const row = await app.db.prepare("SELECT * FROM crm_records WHERE kind='quote' AND json_extract(data,'$.number')=?").bind(number).first(); return row && {...row, data: JSON.parse(row.data)}; };
  const session = {};
  for (const id of ['owner', 'mgr', 'sup', 'sup2', 'sup3', 'rep', 'cs']) session[id] = app.as(await app.login(id));
  const post = (who, body, headers) => (who ? session[who] : app.as(null))('/api/erp-quotes', {method: 'POST', body, headers});
  const preview = (who, rows, extra = {}) => post(who, {action: 'preview', fileName: 'Reports_Invoices_synthetic.xls', base64: base64(rows), ...extra});

  // 1. Who may.
  eq((await app.as(null)('/api/erp-quotes')).status, 401, 'anonymous GET');
  eq((await post(null, {})).status, 401, 'anonymous empty POST');
  eq((await post(null, {action: 'preview', fileName: 'a.xls', base64: base64(report())})).status, 401, 'anonymous shaped POST');
  for (const who of ['rep', 'cs']) {
    eq((await session[who]('/api/erp-quotes')).status, 403, who + ' GET');
    eq((await preview(who, report())).status, 403, who + ' POST');
  }
  eq((await preview('owner', report(), {}).then(() => post('owner', {action: 'preview', fileName: 'a.xls', base64: base64(report())}, {Origin: 'https://evil.example'}))).status, 403, 'another origin');
  const configuration = (await session.sup('/api/erp-quotes')).json();
  eq(configuration.members.map(m => m.id), ['rep'], 'a supervisor assigns their own representatives');
  eq((await session.owner('/api/erp-quotes')).json().members.map(m => m.id).sort(), ['rep', 'rep2'], 'the administrator, every representative');
  const permission = await session.owner('/api/crm', {method: 'POST', body: {action: 'permissions', memberId: 'sup2', version: 0, cells: {'quote:add': false}, hidden: [], viewAll: false, requestId: crypto.randomUUID()}});
  eq(permission.status, 200, 'the administrator switches «إضافة» of «عروض الأسعار» off for sup2');
  const refused = await preview('sup2', report());
  eq([refused.status, refused.json().error], [403, 'غير مسموح لك بالإضافة في عروض الأسعار. راجع مدير النظام.'], 'sup2 cannot import');
  eq((await session.sup2('/api/erp-quotes')).status, 403, 'nor open it');
  eq((await session.owner('/api/crm', {method: 'POST', body: {action: 'permissions', memberId: 'sup3', version: 0, cells: {'sales:import': false}, hidden: [], viewAll: false, requestId: crypto.randomUUID()}})).status, 200, '«استيراد» of «المبيعات» off for sup3');
  const salesOff = await preview('sup3', report());
  eq([salesOff.status, salesOff.json().error], [403, 'غير مسموح لك بالاستيراد في المبيعات. راجع مدير النظام.'], 'whoever may not import ERP sales cannot import quotations either');
  eq((await session.owner('/api/crm', {method: 'POST', body: {action: 'permissions', memberId: 'sup3', version: 1, cells: {}, hidden: ['quote'], viewAll: false, requestId: crypto.randomUUID()}})).status, 200, '«عروض الأسعار» hidden from sup3');
  eq((await preview('sup3', report())).status, 404, 'a hidden screen: 404, never 403');
  const huge = await session.owner('/api/erp-quotes', {method: 'POST', body: Buffer.alloc(7_600_000, 32), headers: {'Content-Type': 'application/json'}});
  eq(huge.status, 413, 'a body over the limit');
  const notQuotes = await preview('owner', quotation({code: 'INV-1', type: 'Inv', lines: lines.q1}));
  eq([notQuotes.status, /ليس تقرير عروض أسعار/.test(notQuotes.json().error)], [400, true], 'a file that is not quotations');
  const wrongType = await post('owner', {action: 'preview', fileName: 'quotes.pdf', base64: base64(report())});
  eq(wrongType.status, 400, 'another file type');

  // 2. The preview writes nothing.
  const first = await preview('owner', report());
  eq(first.status, 200, 'preview');
  const p1 = first.json();
  eq(p1.summary, {quotations: 6, lines: 7, newCount: 3, updateCount: 0, unchangedCount: 0, editedCount: 0, excludedCount: 0, refusedCount: 3, rowProblems: 0, deletedRows: 0, totalsDiffer: 0}, 'the counts');
  eq(Object.fromEntries(p1.quotations.map(q => [q.code, [q.status, q.reason]])), {
    'Qut-1001': ['new', 'عرض جديد؛ سيُضاف إلى عروض أسعار العميل'], 'Qut-1002': ['new', 'عرض جديد؛ سيُضاف إلى عروض أسعار العميل'],
    'Qut-1003': ['refused', 'العميل غير موجود في الـCRM بكود ERP هذا؛ أضفه أو حدّث كوده من «استيراد من ERP» في العملاء'],
    'Qut-1004': ['refused', 'كود العميل مسجل لأكثر من عميل في الـCRM؛ اربطه بعميل واحد أولًا'],
    'Qut-1005': ['refused', 'اربط موظف ERP بمندوب'], 'Qut-1006': ['new', 'عرض جديد؛ سيُضاف إلى عروض أسعار العميل']}, 'each quotation with its reason');
  eq(p1.missingCustomers, [{customerCode: '999', customerName: 'عميل ليس في النظام', quotations: 1}], 'the customers the CRM does not have');
  eq(p1.employees.map(e => [e.employeeId, e.employeeName, e.repId, e.mappingSource, e.quotations]), [['7001', 'أحمد المندوب', 'rep', 'name', 5], ['7002', 'موظف آخر', '', 'unmapped', 1]], 'employees: matched by name, and unmapped');
  eq([await quotes(), await count('SELECT COUNT(*) n FROM crm_erp_imports'), await count('SELECT COUNT(*) n FROM crm_erp_employee_mappings')], [0, 0, 0], 'the preview wrote nothing');
  const outside = await preview('owner', report(), {employeeMappings: [{employeeId: '7002', repId: 'cs'}]});
  eq(outside.status, 403, 'mapping an employee to someone who is not an assignable representative');
  const mgrPreview = (await preview('mgr', report())).json();
  eq(mgrPreview.quotations.find(q => q.code === 'Qut-1006').reason, 'العميل خارج منطقتك', 'the sales manager: a customer outside their regions is refused');

  // 3. The import.
  const choices = {employeeMappings: [{employeeId: '7002', repId: 'rep2'}]};
  const p2 = (await preview('owner', report(), choices)).json();
  eq([p2.summary.newCount, p2.summary.refusedCount], [4, 2], 'with 7002 mapped to rep2: four to add');
  const commitBody = {action: 'commit', fileName: 'Reports_Invoices_synthetic.xls', base64: base64(report()), ...choices, previewToken: p2.previewToken, requestId: crypto.randomUUID()};
  const committed = await post('owner', commitBody);
  eq(committed.status, 200, 'import');
  const receipt = committed.json();
  eq([receipt.addedCount, receipt.updatedCount, receipt.unchangedCount, receipt.editedCount, receipt.refusedCount, receipt.mappingsSaved], [4, 0, 0, 0, 2, 2], 'the receipt');
  eq(await quotes(), 4, 'four quotes');
  const q2 = await record('Qut-1002');
  eq([q2.parent_id, q2.assigned_to, q2.branch, q2.version, q2.data.status, q2.data.date, q2.data.validUntil, q2.data.taxRate, q2.data.performedBy], ['c102', 'rep', 'فرع جدة', 1, 'sent', '2026-11-03', '2026-11-18', 15, 'rep'], 'under its customer, the mapped rep, the customer\'s branch, sent, its dates');
  eq(q2.data.items, [{description: 'قالب انترلوك — مع جلبة', quantity: 2, price: 9000, code: '10020001', category: 'Normal Mold /قوالب', unit: 'حبة / PC'}, {description: 'جلبة إضافية', quantity: 4, price: 250.5, code: '10030002-1', category: 'Normal Mold /قوالب', unit: 'قطعة / PC'}], 'the items with their code, category and unit');
  eq([q2.data.subtotal, q2.data.discount, q2.data.tax, q2.data.total], [19002, 600, 2760.3, 21162.3], 'the ERP\'s figures (gross, line and document discounts, VAT, total)');
  eq([q2.data._erp.source, q2.data._erp.code, q2.data._erp.customerCode, q2.data._erp.employeeCode, q2.data._erp.importedBy, q2.data._erp.importId, q2.data._erp.totalsDiffer], ['erp', 'Qut-1002', '102', '7001', 'owner', 'erp-quotes-import-' + commitBody.requestId, false], 'the ERP marker');
  ok(q2.data.terms.includes('ملاحظات: يشمل التركيب') && q2.data.terms.startsWith('شروط الدفع: '), 'the terms');
  eq((await record('Qut-1005')).assigned_to, 'rep2', 'the chosen mapping');
  eq(await count("SELECT COUNT(*) n FROM crm_audit WHERE action='إضافة' AND detail LIKE '% • إضافة عرض سعر من ملف ERP'"), 4, 'one «إضافة» history line each');
  const importLine = await app.db.prepare("SELECT * FROM crm_audit WHERE action='استيراد عروض أسعار ERP'").first();
  eq([importLine.record_id, importLine.actor, JSON.parse(importLine.detail).addedCount], ['erp-quotes-import-' + commitBody.requestId, 'owner', 4], 'one audit line for the import with its counts');
  eq((await app.db.prepare('SELECT employee_id,rep_id FROM crm_erp_employee_mappings ORDER BY employee_id').all()).results.map(r => [r.employee_id, r.rep_id]), [['7001', 'rep'], ['7002', 'rep2']], 'the mappings saved in the ERP sales import\'s table');
  eq((await session.owner('/api/sales/import')).json().employeeMappings.length, 2, 'and the sales import reads them');

  // 4. A lost answer: the same request again returns its answer and writes nothing twice; the old preview with a new request is refused.
  const repeat = await post('owner', commitBody);
  eq([repeat.status, repeat.json().alreadySaved, repeat.json().addedCount], [200, true, 4], 'the same request again: the first answer');
  eq([await quotes(), await count('SELECT COUNT(*) n FROM crm_erp_imports'), await count("SELECT COUNT(*) n FROM crm_audit WHERE action='إضافة'")], [4, 1, 4], 'nothing written twice');
  const stale = await post('owner', {...commitBody, requestId: crypto.randomUUID()});
  eq(stale.status, 409, 'the old preview under a new request id');
  eq(await quotes(), 4, 'still four');

  // 5. The same file again changes nothing.
  const p3 = (await preview('owner', report(), choices)).json();
  eq([p3.summary.newCount, p3.summary.updateCount, p3.summary.unchangedCount], [0, 0, 4], 'the same file again: unchanged');
  const versions = async () => (await app.db.prepare("SELECT json_extract(data,'$.number') n,version v FROM crm_records WHERE kind='quote' ORDER BY 1").all()).results.map(r => [r.n, r.v]);
  const before = await versions();
  const again = await post('owner', {...commitBody, previewToken: p3.previewToken, requestId: crypto.randomUUID()});
  eq([again.status, again.json().addedCount, again.json().updatedCount, again.json().unchangedCount], [200, 0, 0, 4], 'imported again: nothing added or updated');
  eq(await versions(), before, 'versions kept');

  // 6. Edited by hand through the CRM's own form route: kept, and the next import leaves it alone.
  const q6 = await record('Qut-1006');
  const edit = await session.owner('/api/crm', {method: 'POST', body: {action: 'save', kind: 'quote', id: q6.id, version: q6.version, parentId: q6.parent_id, data: {...q6.data, status: 'accepted', items: [{...q6.data.items[0], price: 18000}]}}});
  eq(edit.status, 200, 'an imported quote is edited from the form: ' + edit.text.slice(0, 200));
  const edited = await record('Qut-1006');
  eq([edited.version, edited.data.status, edited.data.total, edited.assigned_to, edited.parent_id, edited.data.number, edited.data._erp.code, edited.data.items[0].code], [2, 'accepted', 20700, 'rep', 'east', 'Qut-1006', 'Qut-1006', '10010001'], 'its marker, representative, customer, number and item code kept; the totals recomputed');
  const reassign = await session.owner('/api/crm', {method: 'POST', body: {action: 'save', kind: 'quote', id: edited.id, version: edited.version, parentId: 'c101', data: edited.data}});
  eq(reassign.status, 400, 'its customer cannot be changed');
  const newer = report({q1: [{name: 'قالب بلوك 20 سم', qty: 2, price: 18000, code: '10010001'}]});
  const p4 = (await preview('owner', newer, {...choices, fileName: 'Reports_Invoices_newer.xls'})).json();
  eq(Object.fromEntries(p4.quotations.filter(q => q.status !== 'refused').map(q => [q.code, q.status])), {'Qut-1001': 'update', 'Qut-1002': 'unchanged', 'Qut-1005': 'unchanged', 'Qut-1006': 'edited'}, 'a newer export: updated where it changed, the hand-edited one left alone');
  eq(p4.quotations.find(q => q.code === 'Qut-1006').reason, 'عُدِّل في الـCRM، تُرك كما هو', 'its reason');
  const update = await post('owner', {action: 'commit', fileName: 'Reports_Invoices_newer.xls', base64: base64(newer), ...choices, previewToken: p4.previewToken, requestId: crypto.randomUUID()});
  eq([update.status, update.json().updatedCount, update.json().editedCount], [200, 1, 1], 'the update');
  const q1 = await record('Qut-1001');
  eq([q1.version, q1.data.items[0].quantity, q1.data.total, q1.data._erp.importedBy, q1.data._erp.fileName], [2, 2, 41400, 'owner', 'Reports_Invoices_newer.xls'], 'the same record updated');
  eq((await record('Qut-1006')).data.status, 'accepted', 'the hand-edited quote kept');
  const change = await app.db.prepare("SELECT detail FROM crm_audit WHERE record_id=? AND action='تعديل'").bind(q1.id).first();
  ok(change.detail.startsWith('Qut-1001 • تحديث من ملف ERP: الإجمالي 21,275.00 ← 41,400.00 ر.س'), 'a «تعديل» history line with before and after');
  const lastImport = JSON.parse((await app.db.prepare("SELECT detail FROM crm_audit WHERE action='استيراد عروض أسعار ERP' ORDER BY created_at DESC LIMIT 1").first()).detail);
  eq(lastImport.changes.find(c => c.number === 'Qut-1001').before.total, 21275, 'the import line keeps each update\'s before and after');
  eq(lastImport.changes.find(c => c.number === 'Qut-1001').after.total, 41400, 'after');

  // 7. Everywhere quotes are: /api/crm for the sales roles, never a representative; the KPI evidence offers them.
  const crm = (await session.owner('/api/crm')).json();
  eq(crm.records.filter(r => r.kind === 'quote').length, 4, 'the administrator\'s list');
  ok(crm.audits.some(a => a.recordId === q1.id && a.action === 'تعديل'), 'its history');
  ok(!crm.audits.some(a => a.action === 'استيراد عروض أسعار ERP'), 'the import line is not a record\'s history');
  eq((await session.sup('/api/crm')).json().records.filter(r => r.kind === 'quote').map(r => r.data.number).sort(), ['Qut-1001', 'Qut-1002', 'Qut-1006'], 'the supervisor sees their representative\'s quotes');
  eq((await session.rep('/api/crm')).json().records.filter(r => r.kind === 'quote').length, 0, 'a representative never receives quotes');
  const month = '2026-11', evidence = await session.owner('/api/kpi-evidence?memberId=rep&month=' + month);
  eq(evidence.status, 200, 'the KPI evidence');
  const offered = evidence.json().quotes.map(o => o.reference).sort();
  ok(['Qut-1001', 'Qut-1002', 'Qut-1005'].every(number => offered.includes(number)), 'offers the imported quotes issued that month');

  // 8. «مبيعات مكتب» excluded, and a code two customers carry chosen by the administrator from the import (2026-11-11).
  const office = quotation({code: 'Qut-1007', customerCode: '999', empCode: '7003', empName: 'مبيعات مكتب', lines: lines.q1});
  const report8 = [...newer, ...office], name8 = 'Reports_Invoices_office.xls';
  const preview8 = (who, extra = {}) => preview(who, report8, {...choices, fileName: name8, ...extra});
  const p8 = (await preview8('owner')).json();
  eq([p8.summary.newCount, p8.summary.updateCount, p8.summary.unchangedCount, p8.summary.editedCount, p8.summary.excludedCount, p8.summary.refusedCount], [0, 0, 3, 1, 1, 2], 'the counts: one excluded, two refused');
  const status8 = Object.fromEntries(p8.quotations.map(q => [q.code, [q.status, q.reason]]));
  eq(status8['Qut-1007'], ['excluded', 'مبيعات مكتب: عروض شركة أخرى مستبعدة تلقائيًا'], '«مبيعات مكتب»: excluded with its reason (no customer, no mapping needed)');
  ok(!p8.employees.some(e => e.employeeId === '7003'), 'an office employee is never offered for mapping');
  eq(p8.sharedCodes.canMap, true, 'the administrator may choose the customer of a shared code');
  eq(p8.sharedCodes.codes.map(c => [c.codeKey, c.customerCode, c.quotations, c.status, c.mappedCustomerId, c.mappingVersion]), [['201', '201', 1, 'ambiguous', '', 0]], 'the shared code, its quotations, not chosen');
  const candidates = p8.sharedCodes.codes[0].candidates;
  eq(candidates.map(c => [c.id, c.name, c.region, c.branch, c.version]), [['dupA', 'مصنع مكرر أ', 'الوسطى', 'فرع جدة', 1], ['dupB', 'مصنع مكرر ب', 'الوسطى', 'فرع جدة', 1]], 'exactly the customers that carry it, with region and branch');
  ok(candidates.every(c => /^YR-C-\d{6}$/.test(c.internalCode)), 'each with its YR-C code');
  const mgr8 = (await preview8('mgr')).json();
  eq(mgr8.sharedCodes, {canMap: false, revision: 0, codes: [{codeKey: '201', customerCode: '201', quotations: 1, status: 'ambiguous'}]}, 'the sales manager: the code and its count, never the customers');
  eq(mgr8.quotations.find(q => q.code === 'Qut-1007').status, 'excluded', 'excluded for the sales manager too');
  const identity = (who, body) => session[who]('/api/customer-identities', {method: 'POST', body});
  const mapBody = (customerId, version, extra = {}) => ({codeKey: '201', customerId, version, revision: p8.sharedCodes.revision, customerVersion: 1, requestId: crypto.randomUUID(), ...extra});
  for (const who of ['mgr', 'sup']) eq((await identity(who, mapBody('dupA', 0))).status, 403, who + ' cannot map a code');
  const notCandidate = await identity('owner', mapBody('c101', 0));
  eq([notCandidate.status, notCandidate.json().error], [400, 'اختر مصنعًا مرتبطًا بهذا الكود في المصدر؛ لا يمكن تخمين صاحب الفاتورة.'], 'a customer that does not carry the code is refused');
  const mappings = () => app.db.prepare('SELECT code_key,customer_id,version FROM crm_customer_code_mappings').all().then(r => r.results.map(m => [m.code_key, m.customer_id, m.version]));
  eq(await mappings(), [], 'nothing saved');
  const mapA = mapBody('dupA', 0), savedA = await identity('owner', mapA);
  eq([savedA.status, savedA.json().ok], [200, true], 'the administrator maps 201 to dupA');
  eq((await identity('owner', mapA)).json().alreadySaved, true, 'the same request again: saved once');
  eq(await mappings(), [['201', 'dupA', 1]], 'one mapping');
  eq(await count("SELECT COUNT(*) n FROM crm_audit WHERE action='ربط كود عميل ERP'"), 1, 'one «ربط كود عميل ERP» audit line');
  eq((await identity('owner', mapBody('dupB', 0))).status, 409, 'an old revision: refused (409)');
  const stale8 = await post('owner', {action: 'commit', fileName: name8, base64: base64(report8), ...choices, previewToken: p8.previewToken, requestId: crypto.randomUUID()});
  eq(stale8.status, 409, 'a preview made before the mapping cannot be committed');
  const p9 = (await preview8('owner')).json();
  const q1004 = p9.quotations.find(q => q.code === 'Qut-1004');
  eq([q1004.status, q1004.customerName], ['new', 'مصنع مكرر أ'], 'the mapped code\'s quotation becomes new, under the chosen customer');
  eq(p9.sharedCodes.codes.map(c => [c.status, c.mappedCustomerId, c.mappingVersion]), [['mapped', 'dupA', 1]], 'the saved choice is shown, to be changed from the same place');
  const commit9 = await post('owner', {action: 'commit', fileName: name8, base64: base64(report8), ...choices, previewToken: p9.previewToken, requestId: crypto.randomUUID()});
  const r9 = commit9.json();
  eq([commit9.status, r9.addedCount, r9.updatedCount, r9.unchangedCount, r9.editedCount, r9.excludedCount, r9.refusedCount], [200, 1, 0, 3, 1, 1, 1], 'imported: the refused and the excluded quotation do not keep the others');
  const q1004Record = await record('Qut-1004');
  eq([q1004Record.parent_id, q1004Record.assigned_to], ['dupA', 'rep'], 'under the chosen customer');
  ok(!(await record('Qut-1007')), 'the office quotation is never written');
  const p10 = (await preview8('owner')).json();
  eq([p10.summary.newCount, p10.summary.unchangedCount, p10.summary.excludedCount, p10.quotations.find(q => q.code === 'Qut-1004').status], [0, 4, 1, 'unchanged'], 'the same file again: unchanged');
  const mapB = await identity('owner', {...mapBody('dupB', 1), revision: p10.sharedCodes.revision});
  eq(mapB.status, 200, 'the mapping changed later from the same place');
  const p11 = (await preview8('owner')).json();
  eq(p11.quotations.find(q => q.code === 'Qut-1004').reason, 'تغيّر عميل العرض في ERP؛ لن يُنقل العرض المحفوظ إلى عميل آخر تلقائيًا', 'the imported quote is not moved to the other customer');
  eq(p11.sharedCodes.codes.map(c => [c.mappedCustomerId, c.mappingVersion]), [['dupB', 2]], 'the new choice');
  eq(await count("SELECT COUNT(*) n FROM crm_audit WHERE action='ربط كود عميل ERP'"), 2, 'each change audited');

  // 9. Current codes only (2026-11-12): a customer whose code an ERP customers import cleared keeps it as history only. Before, code 103
  // was «مسجل لأكثر من عميل» (the real ERP customer's current code and the cleared customer's kept one); now it is the real customer's,
  // even against a stored mapping to the cleared customer, and it is no longer listed among the shared codes.
  await customer('real103', {name: 'مصنع العميل الحقيقي', code: '103'});
  await customer('gone103', {name: 'مصنع ليس في ERP', code: '103'});
  await app.db.prepare("INSERT INTO crm_customer_code_mappings(code_key,customer_id,version,updated_by,updated_at) VALUES('103','gone103',1,'owner',?)").bind(now).run();
  const shared103 = (await preview('owner', [...report8, ...quotation({code: 'Qut-1008', customerCode: '103', empCode: '7001', empName: 'أحمد المندوب', lines: lines.q1})], {...choices, fileName: name8})).json();
  eq(shared103.quotations.find(q => q.code === 'Qut-1008').customerName, 'مصنع ليس في ERP', 'two current holders and a mapping to one of them: the mapping decides');
  await app.db.prepare("UPDATE crm_records SET data=json_set(data,'$.code',''),version=version+1 WHERE id='gone103'").run();
  eq((await app.db.prepare("SELECT source_code FROM crm_customer_code_aliases WHERE customer_id='gone103'").all()).results.map(r => r.source_code), ['103'], 'cleared: 103 is kept in its history');
  const report12 = [...report8, ...quotation({code: 'Qut-1008', customerCode: '103', empCode: '7001', empName: 'أحمد المندوب', lines: lines.q1}), ...quotation({code: 'Qut-1009', customerCode: '104', empCode: '7001', empName: 'أحمد المندوب', lines: lines.q1})];
  await customer('gone104', {name: 'مصنع آخر ليس في ERP', code: '104'});
  await app.db.prepare("UPDATE crm_records SET data=json_set(data,'$.code',''),version=version+1 WHERE id='gone104'").run();
  const p12 = (await preview('owner', report12, {...choices, fileName: name8})).json();
  const q1008 = p12.quotations.find(q => q.code === 'Qut-1008'), q1009 = p12.quotations.find(q => q.code === 'Qut-1009');
  eq([q1008.status, q1008.customerName], ['new', 'مصنع العميل الحقيقي'], 'the cleared customer is no candidate: 103 is the current holder\'s, whatever the stale mapping says');
  eq([q1009.status, q1009.reason], ['refused', 'العميل غير موجود في الـCRM بكود ERP هذا؛ أضفه أو حدّث كوده من «استيراد من ERP» في العملاء'], 'a code only a cleared customer had: nobody\'s');
  eq(p12.sharedCodes.codes.map(c => c.codeKey), ['201'], '«أكواد مشتركة» lists the real current duplicates only (not 103)');
  const identities12 = (await session.owner('/api/customer-identities')).json().identities;
  eq(['103', '104'].map(code => { const row = identities12.find(i => i.codeKey === code); return row && [row.customerIds, row.status, row.mappedCustomerId]; }), [[['real103'], 'unique', 'gone103'], undefined], 'the reconciliation list: 103 has one holder, the stale mapping shown but not deciding; 104 is no customer\'s code');
  const choose103 = await identity('owner', {codeKey: '103', customerId: 'gone103', version: 1, revision: p12.sharedCodes.revision, customerVersion: 2, requestId: crypto.randomUUID()});
  eq([choose103.status, choose103.json().error], [400, 'اختر مصنعًا مرتبطًا بهذا الكود في المصدر؛ لا يمكن تخمين صاحب الفاتورة.'], 'the cleared customer cannot be chosen for the code');
  const commit12 = await post('owner', {action: 'commit', fileName: name8, base64: base64(report12), ...choices, previewToken: p12.previewToken, requestId: crypto.randomUUID()});
  eq([commit12.status, commit12.json().addedCount], [200, 1], 'imported');
  eq((await record('Qut-1008')).parent_id, 'real103', 'under the customer that carries 103 now');
  // The customer form cannot make a new duplicate: since 2026-11-12 it writes no ERP code at all, for anyone (only the ERP customers import does).
  const duplicate = await session.owner('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', data: {name: 'مصنع مكرر جديد', code: '103', region: 'الوسطى', location: '', assignedTo: 'rep', branch: 'الرئيسي'}}});
  eq([duplicate.status, duplicate.json().error], [403, 'كود ERP لا يُكتب ولا يُعدَّل يدويًا لأي مستخدم، ولا لمدير النظام؛ يُحدَّث من ملف عملاء ERP فقط («استيراد من ERP»).'], 'the form refuses any ERP code, even for the administrator');
  const reuse = await session.owner('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', data: {name: 'مصنع يأخذ 104', region: 'الوسطى', location: '', assignedTo: 'rep', branch: 'الرئيسي'}}});
  eq(reuse.status, 200, 'a customer added by hand, with no ERP code');
  // The ERP customers import gives it 104 (tests/erp-customers-duplicates-http.mjs runs that import itself): a code only a cleared customer had is free.
  await app.db.prepare("UPDATE crm_records SET data=json_set(data,'$.code','104'),version=version+1 WHERE id=?").bind(reuse.json().id).run();
  const p13 = (await preview('owner', report12, {...choices, fileName: name8})).json();
  eq([p13.quotations.find(q => q.code === 'Qut-1009').status, p13.quotations.find(q => q.code === 'Qut-1009').customerName], ['new', 'مصنع يأخذ 104'], 'and its quotations are the new holder\'s');
  console.log(`erp-quotes-http: ${checks} checks passed`);
} catch (error) {
  console.error(app.log().slice(-3000));
  throw error;
} finally {
  await app.stop();
}
