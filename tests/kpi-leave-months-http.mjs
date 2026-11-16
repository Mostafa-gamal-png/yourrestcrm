// Leave and absence in the evaluation (2026-11-15, the owner: «الإجازات تتحسب في التقييم (GSCO 2.13.50): الأيام اللي المندوب كان فيها في إجازة
// ما تتحسبش ضده»; lib/kpi-baseline.ts) over real HTTP against the BUILT release (run the build first): the evaluation where it is served (GET
// /api/sales?month=&kpis=1, «تقييم الأداء») and the representative's own page (GET /api/targets?month=, «أهدافي»). A representative on leave
// all of August 2025: out of the evaluation in August, on the manager's, the supervisor's and their own page; November compared with July,
// September and October («أشهر بلا نشاط لم تُحتسب: أغسطس 2025»); a new representative compared from their second month and without recovered
// customers yet; the supervisor's and the manager's roll-ups never marked and never skipped while someone worked; a customer added by hand
// on 1 August in Riyadh is August work; the month in progress never marked; 401 without a session, 403 for a role without the right, a
// representative reads only their own page (another member's id is refused), Arabic digits in the month are refused, nothing cached.
// Synthetic fixtures only: temporary SQLite, mocked mail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'},
  {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف سالم'},
  {id: 'rep1', role: 'rep', sup: 'sup', name: 'المندوب أحمد'},
  {id: 'rep2', role: 'rep', sup: 'sup', name: 'المندوب خالد'},
  {id: 'rep4', role: 'rep', sup: 'sup', name: 'المندوب الجديد'},
  {id: 'cs', role: 'customer_service', sup: 'mgr', name: 'خدمة العملاء'}
];
const SENTENCE = 'قورن بآخر ثلاثة أشهر عمل فيها: يوليو 2025، سبتمبر 2025 وأكتوبر 2025. أشهر بلا نشاط لم تُحتسب: أغسطس 2025.';
const NEW_HISTORY = 'لا يوجد قبل أشهر المقارنة شهر عمل فيه المندوب ولا شراء سابق لعملائه، فلا يمكن إثبات عميل مسترد. يبدأ احتساب المؤشر بعد أربعة أشهر من أول شهر عمل فيه.';
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const app = await bootBuiltApp({members});
try {
  const stamp = '2025-01-01T00:00:00.000Z', today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date());
  const insert = (id, kind, parent, assigned, data, created = stamp) => app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id, kind, parent, assigned, 'الرئيسي', JSON.stringify(data), created, created).run();
  for (const id of ['rep1', 'rep2', 'rep4']) await insert('c-' + id, 'customer', null, id, {name: 'مصنع ' + id, region: 'الشرقية', city: 'الدمام'});
  const visit = (by, date) => insert('v-' + by + '-' + date, 'activity', 'c-' + by, by, {type: 'visit', date, summary: 'تعريف بالمنتجات', result: 'العميل مهتم', performedBy: by, responsibleId: by, recordedByEmail: by + '@yourrest.org', salesStage: 'specs'});
  for (let m = 1; m <= 11; m++) {
    const month = '2025-' + String(m).padStart(2, '0');
    if (month !== '2025-08') await visit('rep1', month + '-10');
    if (month !== '2025-08') await visit('rep2', month + '-12');
    if (month >= '2025-09') await visit('rep4', month + '-16');
  }
  // rep2's only work in August: a customer added by hand at 00:30 on 1 August in Riyadh (21:30 UTC on 31 July).
  await insert('hand-rep2', 'customer', null, 'rep2', {name: 'عميل أضافه المندوب', region: 'الشرقية', _createdBy: 'rep2'}, '2025-07-31T21:30:00.000Z');
  await app.db.prepare('INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES(?,?,?,?,?,?)').bind('erp-import-leave', 'owner', 'fp-leave', 'synthetic.xlsx', JSON.stringify({coverage: {complete: true, from: '2025-01-01', to: '2025-11-30', months: [], partialMonths: [], repIds: ['rep1', 'rep2', 'rep4'], allReps: false, importerId: 'owner', importer: 'مدير النظام', at: stamp, importId: 'erp-import-leave'}}), stamp).run();
  let n = 0;
  const erp = async (rep, code, date) => { n++; await app.db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'h','m',?,'sale',?,'E',?,'الرئيسي','eastern',?,'عميل اصطناعي',?,10000,'erp-import-leave','owner',?)").bind('erp-' + n, 'doc-' + n, 'INV-' + n, date, rep, code, JSON.stringify({items: [{product: 'قوالب', quantity: 1, unitPrice: 100}], discount: 0}), stamp).run(); };
  for (const [code, date] of [['A', '2025-07-05'], ['B', '2025-09-05'], ['C', '2025-10-05'], ['D', '2025-05-05'], ['A', '2025-11-05'], ['B', '2025-11-06'], ['D', '2025-11-07']]) await erp('rep1', code, date);
  for (const [code, date] of [['E', '2025-07-05'], ['E', '2025-11-05']]) await erp('rep2', code, date);
  await erp('rep4', 'N1', '2025-10-05'); await erp('rep4', 'N1', '2025-11-05');

  const session = {};
  for (const member of members) session[member.id] = app.as(await app.login(member.id));
  const anonymous = app.as(null);
  const json = async (response, status, label, cache = 'no-store') => {
    eq(response.status, status, label + ' -> ' + response.text.slice(0, 300));
    if (status === 200) eq(response.headers['cache-control'], cache, label + ': never cached');
    return response.json();
  };
  const kpis = async (who, month, status = 200) => json(await session[who]('/api/sales?month=' + month + '&kpis=1'), status, 'the evaluation of ' + month + ' as ' + who);
  const own = async (who, query, status = 200) => json(await session[who]('/api/targets' + query), status, 'the own page ' + query + ' as ' + who, 'private, no-store');
  const person = (data, id) => data.kpis.people.find(p => p.member.id === id);
  const metric = (data, id, kpi) => person(data, id).metrics.find(m => m.id === kpi);

  // Who reads what.
  eq((await anonymous('/api/sales?month=2025-08&kpis=1')).status, 401, 'the evaluation without a session: 401');
  eq((await anonymous('/api/targets?month=2025-08')).status, 401, 'the own page without a session: 401');
  for (const who of ['rep1', 'cs']) await kpis(who, '2025-08', 403);
  for (const who of ['owner', 'mgr', 'sup', 'cs']) await own(who, '?month=2025-08', 403);

  // August 2025: the representative on leave is out of the evaluation, on every view; the others are not.
  let data = await kpis('mgr', '2025-08');
  // The sales manager is not a person of the evaluation since 2026-11-16 (item 2 of the GSCO list).
  eq(['rep1', 'rep2', 'rep4', 'sup', 'mgr'].map(id => person(data, id)?.inactive), [true, false, true, false, undefined], 'August: rep1 (leave) and rep4 (not started) out; rep2 (a customer added by hand on 1 August, Riyadh) and the supervisor evaluated; the sales manager not in the evaluation');
  eq([person(data, 'rep1').summary.total, person(data, 'rep1').summary.inactive], [null, true], 'no score while out');
  data = await kpis('sup', '2025-08');
  eq(data.kpis.people.map(p => p.member.id).sort(), ['rep1', 'rep2', 'rep4', 'sup'], 'the supervisor reads their team only');
  eq(person(data, 'rep1').inactive, true, 'and sees the same mark');
  let page = await own('rep1', '?month=2025-08');
  eq([page.inactive, page.member.id, Object.keys(page).sort()], [true, 'rep1', ['activity', 'inactive', 'member', 'month', 'sales']], 'rep1 sees the mark on «أهدافي», a yes or a no about themselves only');
  eq((await own('rep1', '?month=2025-07')).inactive, false, 'not on July');
  eq((await own('rep2', '?month=2025-08')).inactive, false, 'rep2 worked in August');
  eq((await own('rep1', '?month=' + today.slice(0, 7))).inactive, false, 'the month in progress is never marked');
  for (const query of ['?month=2025-08&memberId=rep2', '?memberId=rep2', '?month=' + encodeURIComponent('٢٠٢٥-٠٨')]) await own('rep1', query, 400);
  eq((await session.mgr('/api/sales?month=' + encodeURIComponent('٢٠٢٥-٠٨') + '&kpis=1')).status, 400, 'a month written in Arabic digits is refused, not guessed');

  // November 2025: compared with the last three worked months.
  data = await kpis('mgr', '2025-11');
  const retention = metric(data, 'rep1', 'retention'), recovered = metric(data, 'rep1', 'recovered');
  eq([retention.numerator, retention.denominator, retention.score, retention.baseline], [2, 3, 66.67, {months: ['2025-07', '2025-09', '2025-10'], skipped: ['2025-08']}], 'rep1: July, September and October (A, B, C), A and B again');
  ok(retention.reason.endsWith(' ' + SENTENCE), 'the reason names the months: ' + retention.reason);
  eq([recovered.numerator, recovered.status, recovered.baseline?.skipped], [1, 'scored', ['2025-08']], 'D recovered; A bought in July, a compared month');
  eq([metric(data, 'rep4', 'retention').baseline, metric(data, 'rep4', 'recovered').status, metric(data, 'rep4', 'recovered').reason], [undefined, 'not_applicable', NEW_HISTORY], 'rep4 (new in September): no month skipped, recovered not yet');
  eq(['rep2', 'sup'].map(id => metric(data, id, 'retention').baseline), [undefined, undefined], 'rep2 and the supervisor\'s roll-up: nothing skipped');
  eq([person(data, 'sup').inactive, person(data, 'mgr')], [false, undefined], 'the supervisor never marked; the sales manager not in the evaluation');
  data = await kpis('sup', '2025-11');
  eq(metric(data, 'rep1', 'retention').baseline, {months: ['2025-07', '2025-09', '2025-10'], skipped: ['2025-08']}, 'the supervisor reads the same');

  // The customer added by hand moved to 31 July in Riyadh: rep2's August has nothing, on every view.
  await app.db.prepare("UPDATE crm_records SET created_at='2025-07-31T20:59:59.000Z',updated_at='2025-07-31T20:59:59.000Z' WHERE id='hand-rep2'").run();
  eq([person(await kpis('mgr', '2025-08'), 'rep2').inactive, (await own('rep2', '?month=2025-08')).inactive], [true, true], 'a customer added at 23:59 on 31 July (Riyadh) is July work');
  console.log(JSON.stringify({ok: true, checks, scope: 'leave months in the evaluation on the built release: GET /api/sales?kpis=1 and GET /api/targets, roles, the mark, the comparison months, Riyadh days, refusals', productionDataUsed: false}));
} finally {
  await app.stop();
}
