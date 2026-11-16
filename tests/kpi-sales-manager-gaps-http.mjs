// Item 2 of the GSCO list (2026-11-16, «تمام موافق ابدأ»; GSCO 2.13.76) over real HTTP against the BUILT release (run the build first): the
// sales manager is out of the evaluation, its comparison and the customer and visit targets, also with an ERP employee code mapped to him,
// an ERP sale of his own and an old assessment row, which is kept as it was.
// - GET /api/sales?month=&kpis=1 (the evaluation of «نتائج الأداء»، «التحصيل»، «عروض الأسعار»): 401 without a session, 403 for a
//   representative and customer service; the administrator, the sales manager and the supervisor get everyone of their scope but the sales
//   manager, with their scores; his products target stays in the targets of the answer; nothing cached.
// - POST /api/kpis (the management assessment): 401 without a session, 403 for a supervisor; for the sales manager 404, the same answer as
//   for a member out of the evaluation (customer service), whoever asks; a representative is assessed as before; his old row untouched.
// - GET /api/kpi-evidence («بيانات المؤشرات»): 401 without a session, 403 for a representative; none for the sales manager (404); the
//   supervisor's and a representative's as before.
// - POST /api/targets: 401 without a session, 403 for a supervisor; his customer and visit targets refused (400, the reason), his products
//   target computed (400, as before); a representative's saved.
// - POST /api/record-import (the targets from Excel): a row of his customer and visit targets refused with the same reason, in Arabic and
//   in English; a representative's row passes.
// Synthetic fixtures only: temporary SQLite, mocked mail, no production data.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import ts from 'typescript';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'},
  {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف سالم'},
  {id: 'rep1', role: 'rep', sup: 'sup', name: 'المندوب أحمد'},
  {id: 'rep2', role: 'rep', sup: 'sup', name: 'المندوب خالد'},
  {id: 'cs', role: 'customer_service', sup: 'mgr', name: 'خدمة العملاء'}
];
const OUT = 'مدير المبيعات خارج التقييم، فلا تُحدَّد له مستهدفات العملاء والزيارات.', OUT_EN = 'The sales manager is outside the evaluation, so no customer and visit targets are set for them.';
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
// The Excel writer, compiled from the source the build used.
const root = process.cwd(); fs.mkdirSync(path.join(root, '.sites-runtime'), {recursive: true});
const out = fs.mkdtempSync(path.join(root, '.sites-runtime', 'kpi-sales-manager-http-')); process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
fs.writeFileSync(path.join(out, 'xlsx-write.mjs'), ts.transpileModule(fs.readFileSync(path.join(root, 'lib/xlsx-write.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText);
const X = await import(pathToFileURL(path.join(out, 'xlsx-write.mjs')));
const MONTH = '2025-10', NOW = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()).slice(0, 7);
const app = await bootBuiltApp({members});
try {
  const stamp = '2025-01-01T00:00:00.000Z';
  const insert = (id, kind, parent, assigned, data) => app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id, kind, parent, assigned, 'الرئيسي', JSON.stringify(data), stamp, stamp).run();
  for (const id of ['rep1', 'rep2', 'sup', 'mgr']) await insert('c-' + id, 'customer', null, id, {name: 'مصنع ' + id, region: 'الشرقية', city: 'الدمام'});
  for (const [by, date] of [['rep1', '2025-09-10'], ['rep1', '2025-10-10'], ['rep2', '2025-10-12'], ['sup', '2025-10-14'], ['mgr', '2025-10-16']]) await insert('v-' + by + '-' + date, 'activity', 'c-' + by, by, {type: 'visit', date, summary: 'تعريف بالمنتجات', result: 'العميل مهتم', performedBy: by, responsibleId: by, recordedByEmail: by + '@yourrest.org', salesStage: 'specs'});
  await app.db.prepare('INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES(?,?,?,?,?,?)').bind('erp-import-1', 'owner', 'fp-1', 'synthetic.xlsx', JSON.stringify({coverage: {complete: true, from: '2025-01-01', to: '2025-10-31', months: [], partialMonths: [], repIds: ['rep1', 'rep2'], allReps: false, importerId: 'owner', importer: 'مدير النظام', at: stamp, importId: 'erp-import-1'}}), stamp).run();
  let n = 0;
  const erp = async (rep, code, date, employee = 'E-' + rep) => { n++; await app.db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'h','m',?,'sale',?,?,?,'الرئيسي','all',?,'عميل اصطناعي',?,10000,'erp-import-1','owner',?)").bind('erp-' + n, 'doc-' + n, 'INV-' + n, date, employee, rep, code, JSON.stringify({items: [{product: 'قوالب البلوك المتحركة', quantity: 2, unitPrice: 100}], discount: 0}), stamp).run(); };
  for (const [code, date] of [['A', '2025-07-05'], ['A', '2025-10-05']]) await erp('rep1', code, date);
  await erp('rep2', 'E', '2025-10-06');
  // The sales manager «له كود موظف»: an ERP employee number mapped to him, and a sale of his own in the month; and an old assessment.
  await app.db.prepare('INSERT INTO crm_erp_employee_mappings(employee_id,rep_id,updated_by,updated_at) VALUES(?,?,?,?)').bind('E-MGR', 'mgr', 'owner', stamp).run();
  await erp('mgr', 'M', '2025-10-08', 'E-MGR');
  const grade = score => ({score, note: ''}), conduct = score => ({responsibility: grade(score), teamwork: grade(score), honesty: grade(score), professionalism: grade(score), appearance: grade(score)});
  const oldInput = JSON.stringify({reviewed: null, correct: null, review_note: '', conduct: conduct(70)});
  await app.db.prepare('INSERT INTO crm_kpi_assessments(member_id,month,input,version,mutation_id,updated_by,updated_at) VALUES(?,?,?,1,?,?,?)').bind('mgr', MONTH, oldInput, 'old-mgr', 'owner', stamp).run();
  const oldRow = async () => ({...await app.db.prepare("SELECT member_id,month,input,version,mutation_id,updated_by,updated_at FROM crm_kpi_assessments WHERE member_id='mgr'").first()});
  const before = await oldRow();

  const session = {};
  for (const member of members) session[member.id] = app.as(await app.login(member.id));
  const anonymous = app.as(null), who = id => id ? session[id] : anonymous;
  const call = async (id, url, options, status, label) => { const response = await who(id)(url, options); eq(response.status, status, label + ' -> ' + response.text.slice(0, 300)); return response; };

  // ---- The evaluation (GET /api/sales?kpis=1).
  const kpis = async (id, status = 200) => { const response = await call(id, '/api/sales?month=' + MONTH + '&kpis=1', {}, status, id + ' reads the evaluation'); if (status === 200) eq(response.headers['cache-control'], 'no-store', id + ': never cached'); return status === 200 ? response.json() : null; };
  await kpis(null, 401); await kpis('rep1', 403); await kpis('cs', 403);
  const ids = data => data.kpis.people.map(p => p.member.id).sort();
  const views = {owner: await kpis('owner'), mgr: await kpis('mgr'), sup: await kpis('sup')};
  eq(ids(views.owner), ['rep1', 'rep2', 'sup'], 'the administrator: everyone but the sales manager');
  eq(ids(views.mgr), ['rep1', 'rep2', 'sup'], 'the sales manager: his team, without himself');
  eq(ids(views.sup), ['rep1', 'rep2', 'sup'], 'the supervisor: his own row and his representatives');
  for (const [viewer, data] of Object.entries(views)) for (const p of data.kpis.people) ok(p.summary.inactive || Number.isFinite(p.summary.total) || p.summary.total === null, viewer + ' reads ' + p.member.id + ' with a summary');
  eq(views.owner.kpis.people.find(p => p.member.id === 'rep1').summary, views.mgr.kpis.people.find(p => p.member.id === 'rep1').summary, 'rep1 reads the same for the administrator and the sales manager');
  ok(views.owner.sales.some(s => s.repId === 'mgr') && views.owner.targets.sets.some(s => s.scopeId === 'mgr' && s.kind === 'sales' && s.computed), 'his ERP sale is in the sales tab and his products target, computed from his team, in the targets');

  // ---- The management assessment (POST /api/kpis).
  const assess = async (id, memberId, status, version = 0) => (await call(id, '/api/kpis', {method: 'POST', body: {memberId, month: MONTH, version, requestId: randomUUID(), input: {reviewed: null, correct: null, review_note: '', conduct: conduct(75)}}}, status, (id || 'no session') + ' assesses ' + memberId)).json();
  await assess(null, 'rep1', 401); await assess('sup', 'rep1', 403);
  const outside = await assess('owner', 'cs', 404);
  eq((await assess('owner', 'mgr', 404, 1)).error, outside.error, 'the administrator assessing the sales manager: the answer of a member out of the evaluation');
  eq((await assess('mgr', 'mgr', 404, 1)).error, outside.error, 'the sales manager assessing himself: the same');
  await assess('mgr', 'rep2', 200, 0);
  eq({...await app.db.prepare("SELECT version,updated_by FROM crm_kpi_assessments WHERE member_id='rep2'").first()}, {version: 1, updated_by: 'mgr'}, 'a representative is assessed as before');
  eq(await oldRow(), before, 'his old assessment is kept exactly as it was');

  // ---- «بيانات المؤشرات» (GET /api/kpi-evidence).
  const evidence = async (id, memberId, status) => call(id, '/api/kpi-evidence?memberId=' + memberId + '&month=' + MONTH, {}, status, (id || 'no session') + ' reads the KPI evidence of ' + memberId);
  await evidence(null, 'mgr', 401); await evidence('rep1', 'rep1', 403);
  const none = await evidence('owner', 'cs', 404);
  eq((await evidence('owner', 'mgr', 404)).json(), none.json(), 'the sales manager\'s: none, as for customer service');
  await evidence('mgr', 'mgr', 404); await evidence('owner', 'sup', 200); await evidence('mgr', 'rep1', 200);

  // ---- The targets (POST /api/targets).
  const target = async (id, kind, scopeId, data, status, month = MONTH) => (await call(id, '/api/targets', {method: 'POST', body: {kind, scopeId, month, version: 0, inheritedFrom: null, requestId: randomUUID(), data}}, status, (id || 'no session') + ' saves the ' + kind + ' target of ' + scopeId)).json();
  const activity = {newCustomers: 3, recoveredCustomers: 1, visits: 30};
  await target(null, 'activity', 'rep2', activity, 401); await target('sup', 'activity', 'rep2', activity, 403);
  eq((await target('owner', 'activity', 'mgr', activity, 400)).error, OUT, 'his customer and visit targets: refused with the reason');
  eq((await target('mgr', 'activity', 'mgr', activity, 400, NOW)).error, OUT, 'also by himself');
  await target('owner', 'activity', 'rep2', activity, 200);
  eq((await app.db.prepare("SELECT COUNT(*) n FROM crm_target_sets WHERE scope_id='mgr'").first()).n, 0, 'nothing saved for him');

  // ---- The targets from Excel (POST /api/record-import): his row refused with the same reason.
  const file = Buffer.from(X.xlsxWorkbook({name: 'المستهدفات', rows: [['الشهر', 'البريد الإلكتروني للعضو', 'اسم العضو', 'العملاء الجدد', 'العملاء المستردون', 'الزيارات الفعلية'], [NOW, 'mgr@yourrest.org', '', '3', '1', '30'], [NOW, 'rep1@yourrest.org', '', '3', '1', '30']], headerRow: 0})).toString('base64');
  const body = {kind: 'targets', action: 'preview', fileName: 'targets.xlsx', base64: file};
  await call(null, '/api/record-import', {method: 'POST', body}, 401, 'no session imports');
  for (const language of ['ar', 'en']) {
    const preview = (await call('mgr', '/api/record-import', {method: 'POST', body: {...body, language}}, 200, 'the sales manager previews (' + language + ')')).json();
    eq(preview.rows.map(row => row.status), ['refused', 'new'], 'his row refused, a representative\'s new (' + language + ')');
    eq(preview.rows[0].message, language === 'en' ? OUT_EN : OUT, 'with the reason (' + language + ')');
  }
  eq(await oldRow(), before, 'his old assessment is still as it was at the end');
  ok(!(await kpis('owner')).kpis.people.some(p => p.member.id === 'mgr'), 'and he is still out of the evaluation');
  console.log(JSON.stringify({ok: true, checks, syntheticFixtures: true, productionDataUsed: false}));
} finally { await app.stop(); }
