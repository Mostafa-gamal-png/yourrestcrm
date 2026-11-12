// «العملاء الجدد» from the ERP customers file, over HTTP against the BUILT release (run the build first): the import (POST
// /api/erp-customers) reads «التاريخ» into data.erpCreatedAt on the customers its rows end on and on the ones it adds (an empty cell keeps
// the stored date, an unreadable one too and is counted), audited ('erp-customer-fields'), the version moved once with a code change; a file
// whose only change is dates or representatives can be applied; the representative's column is kept as data.erpRep and never reassigns the
// customer; the same file again changes nothing; a form edit keeps both fields. Then the KPI (GET /api/sales?kpis=1): unknown while a
// customer made this month has no maker and no ERP date, known once its ERP date is read; counted by the ERP date for the current
// responsible, then for the file's representative (by the ERP employee mapping or a full name), once when added by hand too, never for
// «مبيعات مكتب» or another month; a team counts each customer once. The months are the real clock's (M this month in Riyadh, P the one
// before; every day of M is its 1st, so the test runs on any day). Synthetic data only: temporary SQLite, mocked sendmail, workbooks built here, never the owner's file.
import assert from 'node:assert/strict';
import {zipSync, strToU8} from 'fflate';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', region: 'central', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'sm', region: 'central', name: 'المشرف'},
  {id: 'rep1', role: 'rep', sup: 'sup', region: 'central', name: 'مندوب ألف'}, {id: 'rep2', role: 'rep', sup: 'sup', region: 'central', name: 'مندوب باء'},
];
const riyadh = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit'}), M = riyadh.format(new Date()).slice(0, 7);
const P = (() => { const d = new Date(M + '-15T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
const slash = day => day.replaceAll('-', '/'), dayFirst = day => day.slice(8, 10) + '/' + day.slice(5, 7) + '/' + day.slice(0, 4);
const arabic = text => text.replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const serial = day => String(Math.round((Date.parse(day + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000));

const HEADER = ['رقم العميل', 'رقم الهوية', 'الاسم بالعربي', 'الاسم بالانجليزي', 'رقم الجوال', 'رقم الهاتف', 'البريد الالكتروني', 'العنوان', 'التاريخ'];
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const cell = value => `<c t="inlineStr"><is><t>${escape(value)}</t></is></c>`;
const xlsx = (rows, header = HEADER) => Buffer.from(zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
  'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="Customer" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
  'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${[['Customer'], header, ...rows].map((cells, index) => `<row r="${index + 1}">${cells.map(cell).join('')}</row>`).join('')}</sheetData></worksheet>`),
})).toString('base64');
const row = (code, name, date, extra = []) => [code, '', name, '', '', '', '', '', date, ...extra];

let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const app = await bootBuiltApp({members});
try {
  const now = new Date().toISOString(), old = '2025-03-01T08:00:00.000Z';
  const customer = (id, data, assignedTo, createdAt = old) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, assignedTo, JSON.stringify({branch: 'الرئيسي', assignedTo, region: 'الوسطى', city: 'الرياض', phone: '', phone2: '', code: '', ...data}), createdAt, createdAt).run();
  await customer('nour', {name: 'مصنع النور'}, 'rep1');
  await customer('fajr', {name: 'مصنع الفجر', erpCreatedAt: M + '-01'}, 'rep2');
  await customer('hand', {name: 'مصنع اليد', _createdBy: 'rep1'}, 'rep1', now);
  await customer('legacy', {name: 'مصنع بلا منشئ'}, 'rep2', now);
  await customer('office', {name: 'مصنع المكتب'}, 'rep1');
  await customer('bad', {name: 'مصنع التاريخ الخاطئ', erpCreatedAt: P + '-01'}, 'rep2');
  await app.db.prepare("INSERT INTO crm_erp_employee_mappings(employee_id,rep_id,updated_by,updated_at) VALUES('E1','rep1','owner',?)").bind(now).run();
  const record = async id => { const raw = await app.db.prepare('SELECT data,version,assigned_to FROM crm_records WHERE id=?').bind(id).first(); return {data: JSON.parse(raw.data), version: raw.version, assignedTo: raw.assigned_to}; };
  const count = async (sql, ...args) => (await app.db.prepare(sql).bind(...args).first()).n;
  const owner = app.as(await app.login('owner')), sm = app.as(await app.login('sm'));
  const post = body => owner('/api/erp-customers', {method: 'POST', body});
  const kpi = async () => { const reply = await sm('/api/sales?month=' + M + '&kpis=1'); check(reply.status, 200, 'KPI read'); return reply.json(); };
  const metric = (payload, id) => payload.kpis.people.find(p => p.member.id === id).metrics.find(m => m.id === 'new_customers');
  const numbers = async () => { const payload = await kpi(); return Object.fromEntries(['rep1', 'rep2'].map(id => [id, metric(payload, id).numerator])); };

  // ---- before: «legacy» was made this month with no maker and no ERP date: the metric is unknown (as before this change)
  let payload = await kpi();
  check([metric(payload, 'rep1').numerator, metric(payload, 'rep1').status], [null, 'missing'], 'a customer of the month without a maker: unknown');

  // ---- file 1: the owner's layout (no representative column), «التاريخ» in every form the ERP writes
  const file1 = xlsx([
    row('C1', 'مصنع النور', slash(M + '-01')),                // 3: nour, this month, year first
    row('C2', 'مصنع الفجر', ''),                              // 4: fajr, empty: keeps M-02
    row('C3', 'مصنع اليد', arabic(dayFirst(M + '-01'))),       // 5: hand, day first in Arabic digits: also added by hand this month
    row('C4', 'مصنع بلا منشئ', serial(P + '-10')),            // 6: legacy, an Excel serial of last month
    row('C5', 'مصنع المكتب', slash(M + '-01') + ' 10:30:00'), // 7: office, with a time
    row('C6', 'مصنع التاريخ الخاطئ', '2026/02/30'),           // 8: bad: no such day, keeps P-01
    row('C7', 'مصنع جديد كليًا', slash(M + '-01')),           // 9: added
  ]);
  const preview1 = await post({action: 'preview', fileName: 'Customer.xlsx', base64: file1});
  check(preview1.status, 200, 'preview');
  let body = preview1.json();
  check(body.erpDates, {dateColumn: true, dates: 5, invalidDates: 1, repColumn: false, reps: 0, updates: 4}, 'the preview: 5 dates read, 1 unreadable, 4 existing customers to update');
  check([await count("SELECT count(*) AS n FROM crm_audit"), (await record('nour')).version, 'erpCreatedAt' in (await record('nour')).data], [0, 1, false], 'a preview writes nothing');
  let response = await post({action: 'apply', fileName: 'Customer.xlsx', base64: file1, snapshot: body.snapshot, requestId: crypto.randomUUID(), region: 'الوسطى', adds: 1});
  check(response.status, 200, 'apply');
  let result = response.json();
  check([result.erpDatesUpdated, result.added, result.updated], [4, 1, 6], 'four dates written, one customer added, six codes');
  const after = Object.fromEntries(await Promise.all(['nour', 'fajr', 'hand', 'legacy', 'office', 'bad'].map(async id => [id, await record(id)])));
  check(Object.fromEntries(Object.entries(after).map(([id, r]) => [id, r.data.erpCreatedAt])), {nour: M + '-01', fajr: M + '-01', hand: M + '-01', legacy: P + '-10', office: M + '-01', bad: P + '-01'}, 'stored as YYYY-MM-DD; an empty or unreadable cell keeps the stored date');
  check(Object.fromEntries(Object.entries(after).map(([id, r]) => [id, r.version])), {nour: 2, fajr: 2, hand: 2, legacy: 2, office: 2, bad: 2}, 'the code and the date in one write: the version moved once');
  const added = (await app.db.prepare("SELECT data FROM crm_records WHERE kind='customer' AND id LIKE '%-erp-%'").first());
  check(JSON.parse(added.data).erpCreatedAt, M + '-01', 'the added customer has its ERP date');
  const audits = (await app.db.prepare("SELECT record_id,detail FROM crm_audit WHERE action='erp-customer-fields' ORDER BY record_id").all()).results;
  check(audits.map(a => [a.record_id, JSON.parse(a.detail).to, JSON.parse(a.detail).from]), [['hand', {erpCreatedAt: M + '-01'}, {}], ['legacy', {erpCreatedAt: P + '-10'}, {}], ['nour', {erpCreatedAt: M + '-01'}, {}], ['office', {erpCreatedAt: M + '-01'}, {}]], 'one audit entry per customer whose date changed, with before and after');
  ok(audits.every(a => JSON.parse(a.detail).label === 'تحديث تاريخ الإنشاء أو المندوب في ERP من ملف ERP'), 'with its label');

  // ---- the KPI after file 1: known; rep1: nour (its responsible), hand (once), office (no representative column: its responsible);
  // rep2: fajr; legacy is last month's; the added customer is the importer's.
  payload = await kpi();
  check([metric(payload, 'rep1').numerator, metric(payload, 'rep1').denominator, metric(payload, 'rep1').score, metric(payload, 'rep2').numerator], [3, 10, 30, 1], 'counted by the ERP date for the current responsible, each once');
  ok(metric(payload, 'rep1').reason.includes('تاريخ إنشائه في ERP'), '«طريقة الحساب» explains the ERP date');

  // ---- file 2: the representative's columns; the codes are the same, so only the representatives change
  const header2 = [...HEADER, 'اسم المندوب', 'رقم الموظف'];
  const file2 = xlsx([
    row('C1', 'مصنع النور', '', ['مندوب  باء', '']),    // nour → rep2 by the full name (spaces normalized); the date kept
    row('C3', 'مصنع اليد', '', ['اسم آخر', 'E1']),       // hand → E1 (mapped to rep1); still added by hand by rep1
    row('C5', 'مصنع المكتب', '', ['مبيعات مكتب', '']),  // office sales: never counted
    row('C2', 'مصنع الفجر', '', ['', '']),               // nothing to change
  ], header2);
  body = (await post({action: 'preview', fileName: 'Customer2.xlsx', base64: file2})).json();
  check([body.summary.changes, body.summary.adds, body.erpDates], [0, 0, {dateColumn: true, dates: 0, invalidDates: 0, repColumn: true, reps: 3, updates: 3}], 'no code changes, three representatives to write');
  response = await post({action: 'apply', fileName: 'Customer2.xlsx', base64: file2, snapshot: body.snapshot, requestId: crypto.randomUUID(), adds: 0});
  check([response.status, response.json().erpDatesUpdated], [200, 3], 'a file that changes only representatives is applied');
  const reps = Object.fromEntries(await Promise.all(['nour', 'hand', 'office', 'fajr'].map(async id => { const r = await record(id); return [id, [r.data.erpRep ?? null, r.assignedTo, r.data.assignedTo, r.data.erpCreatedAt]]; })));
  check(reps, {nour: [{name: 'مندوب باء'}, 'rep1', 'rep1', M + '-01'], hand: [{employeeId: 'E1', name: 'اسم آخر'}, 'rep1', 'rep1', M + '-01'], office: [{name: 'مبيعات مكتب'}, 'rep1', 'rep1', M + '-01'], fajr: [null, 'rep2', 'rep2', M + '-01']}, 'kept as erpRep (spaces collapsed); nobody reassigned; dates kept');
  check(await numbers(), {rep1: 1, rep2: 2}, 'rep1: hand only (nour goes to the file\'s representative, office sales never count); rep2: fajr and nour');
  payload = await kpi();
  const team = payload.kpis.people.find(p => p.member.id === 'sm');
  check([!!team, team?.activityTeamRollup, team?.metrics.find(m => m.id === 'new_customers').numerator], [true, true, 3], 'the sales manager\'s team counts each customer once');

  // ---- the same file again: nothing changes, refused as before
  body = (await post({action: 'preview', fileName: 'Customer2.xlsx', base64: file2})).json();
  check(body.erpDates.updates, 0, 'the same file again writes nothing');
  response = await post({action: 'apply', fileName: 'Customer2.xlsx', base64: file2, snapshot: body.snapshot, requestId: crypto.randomUUID(), adds: 0});
  check(response.status, 400, 'and an apply with nothing to change is refused');

  // ---- a form edit keeps both fields
  const nour = await record('nour');
  response = await owner('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', id: 'nour', version: nour.version, data: {...nour.data, notes: 'edited', erpCreatedAt: '2001-01-01', erpRep: {name: 'غيره'}}}});
  check(response.status, 200, 'the form saves: ' + response.text);
  const edited = await record('nour');
  check([edited.data.notes, edited.data.erpCreatedAt, edited.data.erpRep], ['edited', M + '-01', {name: 'مندوب باء'}], 'the form keeps the ERP date and representative, and cannot set them');
  console.log(JSON.stringify({ok: true, checks, builtRelease: true, syntheticWorkbook: true, ownerFileUsed: false}));
} finally {
  await app.stop();
}
