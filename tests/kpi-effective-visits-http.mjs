// «نسبة الزيارات الفعالة» from the supervisor's evaluation (2026-11-15, «موافق تمام»; lib/kpis.ts visitEvaluations) over real HTTP against
// the BUILT release (run the build first): the notes saved through POST /api/reviews, the indicator read where it is served (GET
// /api/sales?month=&kpis=1, the targets hub's «تقييم الأداء»). GSCO's four cases (nothing evaluated: missing with 3 waiting; «فعالة» and
// «سلبية»: 50%; a sale with no note: 2 of 3; all evaluated: 2 of 4), an evaluation changed later, an old note without one, a supervisor of
// another team (refused on rep1's visit; reads only their own team's indicator), 401 without a session, 403 for a representative and
// customer service, no-store on every answer. Synthetic fixtures only: temporary SQLite, mocked mail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'},
  {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف سالم'},
  {id: 'sup2', role: 'supervisor', sup: 'mgr', name: 'مشرف آخر'},
  {id: 'rep1', role: 'rep', sup: 'sup', name: 'المندوب أحمد'},
  {id: 'rep2', role: 'rep', sup: 'sup2', name: 'مندوب فريق آخر'},
  {id: 'cs', role: 'customer_service', sup: 'mgr', name: 'خدمة العملاء'}
];
const UNRATED = n => 'لم يقيّم المشرف زيارات هذا الشهر بعد. زيارات بانتظار تقييم المشرف: ' + n + '.';
const RATED = n => 'الزيارات التي قيّمها المشرف «فعالة» أو «إيجابية» (تم البيع) ÷ الزيارات التي قيّمها. زيارات بانتظار تقييم المشرف: ' + n + '.';
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const app = await bootBuiltApp({members});
try {
  const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()), month = day.slice(0, 7), now = new Date().toISOString();
  const insert = (id, kind, parent, assigned, data) => app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id, kind, parent, assigned, 'الرئيسي', JSON.stringify(data), now, now).run();
  const visit = (id, by, customer, extra = {}) => insert(id, 'activity', customer, by, {type: 'visit', date: day, summary: 'تعريف بالمنتجات', result: 'العميل مهتم', performedBy: by, responsibleId: by, recordedByEmail: by + '@yourrest.org', salesStage: 'specs', ...extra});
  await insert('c1', 'customer', null, 'rep1', {name: 'مصنع الاختبار', region: 'الشرقية', city: 'الدمام'});
  await insert('c2', 'customer', null, 'rep2', {name: 'مصنع الفريق الآخر', region: 'الشرقية', city: 'الخبر'});
  await visit('v1', 'rep1', 'c1', {salesStage: 'quoted'}); await visit('v2', 'rep1', 'c1'); await visit('v3', 'rep1', 'c1', {salesStage: 'new'});
  await visit('w1', 'rep2', 'c2'); await visit('call1', 'rep1', 'c1', {type: 'call'});
  const session = {};
  for (const member of members) session[member.id] = app.as(await app.login(member.id));
  const anonymous = app.as(null);
  const json = async (response, status, label) => {
    eq(response.status, status, label + ' -> ' + response.text.slice(0, 300));
    if (status === 200) eq(response.headers['cache-control'], 'no-store', label + ': never cached');
    return response.json();
  };
  const kpis = async (who = 'mgr', status = 200) => json(await session[who]('/api/sales?month=' + month + '&kpis=1'), status, 'the KPIs as ' + who);
  const positive = (data, id = 'rep1') => { const m = data.kpis.people.find(person => person.member.id === id).metrics.find(metric => metric.id === 'positive'); return [m.score, m.numerator, m.denominator, m.status, m.source, m.waiting, m.reason]; };
  const versions = {};
  const rate = async (who, activityId, rating, status = 200) => {
    const saved = await json(await session[who]('/api/reviews', {method: 'POST', body: {kind: 'entry', requestId: crypto.randomUUID(), activityId, version: versions[activityId] ?? null, result: 'زيارة جيدة', action: 'جهّز عرض السعر', ...(rating ? {rating} : {})}}), status, who + ' evaluates ' + activityId + ' ' + rating);
    if (status === 200) versions[activityId] = saved.review.version;
    return saved;
  };

  // Who reads the indicator.
  eq((await anonymous('/api/sales?month=' + month + '&kpis=1')).status, 401, 'without a session: 401');
  for (const who of ['rep1', 'cs']) eq((await session[who]('/api/sales?month=' + month + '&kpis=1')).status, 403, who + ': the team\'s KPIs are not theirs');

  // GSCO's four cases.
  let data = await kpis();
  eq(positive(data), [null, null, null, 'missing', 'required', 3, UNRATED(3)], '1. nothing evaluated: missing (not zero), 3 waiting; the call is not a visit');
  const person = data.kpis.people.find(p => p.member.id === 'rep1');
  ok(person.summary.missing.includes('positive') && person.summary.complete === false, 'named among the indicators without data');
  await rate('sup', 'v1', 'effective'); await rate('sup', 'v2', 'negative');
  eq(positive(await kpis()), [50, 1, 2, 'scored', 'automatic', 1, RATED(1)], '2. one «فعالة» and one «سلبية»: 50%, 1 waiting');
  await visit('v4', 'rep1', 'c1', {salesStage: 'won'});
  eq(positive(await kpis()), [66.67, 2, 3, 'scored', 'automatic', 1, RATED(1)], '3. a sale visit with no note is «إيجابية»: 2 of 3');
  await rate('sup', 'v3', 'negative');
  eq(positive(await kpis()), [50, 2, 4, 'scored', 'automatic', 0, RATED(0)], '4. all evaluated: 2 of 4');
  // An evaluation changed later: the note's last save counts.
  eq((await rate('sup', 'v2', 'effective')).review.version, 2, 'the note on v2 edited');
  eq(positive(await kpis()).slice(0, 3), [75, 3, 4], '«سلبية» changed to «فعالة»: 3 of 4');
  // An old note saved before the evaluation existed (its audit row has no rating): waiting.
  await visit('v5', 'rep1', 'c1');
  const oldId = 'review-entry:sup:' + crypto.randomUUID();
  await app.db.prepare('INSERT INTO crm_daily_entry_reviews(activity_id,member_id,date,result,action,reviewed_by,version,mutation_id,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?)').bind('v5', 'rep1', day, 'ملاحظة قديمة', 'إجراء قديم', 'sup', oldId, now, now).run();
  await app.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(oldId, 'v5', 'المشرف سالم', 'مراجعة المشرف لزيارة أو متابعة', JSON.stringify({before: null, after: {activityId: 'v5', memberId: 'rep1', date: day, result: 'ملاحظة قديمة', action: 'إجراء قديم', reviewedBy: 'sup', version: 1}}), now).run();
  versions.v5 = 1;
  eq(positive(await kpis()), [75, 3, 4, 'scored', 'automatic', 1, RATED(1)], 'an old note without an evaluation: waiting');
  // A supervisor of another team: refused on rep1's visit; their evaluation of their own representative counts for that one only.
  await rate('sup2', 'v5', 'negative', 403);
  await rate('sup2', 'w1', 'negative');
  data = await kpis();
  eq([positive(data).slice(0, 3), positive(data, 'rep2').slice(0, 3)], [[75, 3, 4], [0, 0, 1]], 'rep1 unchanged; rep2 a real zero from their own supervisor');
  eq(positive(data, 'mgr').slice(0, 3).concat(positive(data, 'mgr')[5]), [60, 3, 5, 1], 'the sales manager\'s roll-up: both teams');
  const supView = await kpis('sup'), sup2View = await kpis('sup2');
  eq([supView.kpis.people.some(p => p.member.id === 'rep2'), sup2View.kpis.people.some(p => p.member.id === 'rep1')], [false, false], 'each supervisor reads their own team\'s indicator only');
  eq([positive(supView).slice(0, 3), positive(sup2View, 'rep2').slice(0, 3)], [[75, 3, 4], [0, 0, 1]], 'and reads the same numbers as the sales manager');
  // A call evaluated «فعالة» is not a visit.
  await rate('owner', 'call1', 'effective');
  eq(positive(await kpis()).slice(0, 3), [75, 3, 4], 'a call does not enter the indicator');
  // The administrator evaluates the last visit; nothing waits.
  await rate('owner', 'v5', 'effective');
  eq(positive(await kpis()), [80, 4, 5, 'scored', 'automatic', 0, RATED(0)], 'all five evaluated: 4 of 5');
  // The day report still carries the same evaluations.
  const report = await json(await session.sup('/api/reviews?date=' + day + '&memberId=rep1'), 200, 'the day report\'s notes');
  eq(Object.fromEntries(report.entries.map(entry => [entry.activityId, entry.rating])), {v1: 'effective', v2: 'effective', v3: 'negative', v5: 'effective', call1: 'effective'}, 'the notes the indicator counted');
  ok(report.sales.includes('v4'), 'and v4 is the sale');
  console.log(JSON.stringify({ok: true, checks}));
} finally { await app.stop(); }
