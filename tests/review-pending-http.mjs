// «زيارات ومتابعات بلا نتيجة أو إجراء» (GET /api/reviews/pending, lib/supervisor-reviews*.ts) over real HTTP against the BUILT release (run the
// build first): 401 without a session; 403 for a representative, customer service and the administrator; 404 with «تقرير يوم المندوب»
// hidden; a supervisor their own representatives and a sales manager theirs; each line equal to what that reader's own day report (GET
// /api/reviews) offers to note and has no note; the window of the last 7 Riyadh days opening at 00:00; a saved note taking its visit off at
// once; no-store. Synthetic fixtures only: temporary SQLite, mocked mail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'},
  {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف سالم'},
  {id: 'sup2', role: 'supervisor', sup: 'mgr', name: 'مشرف آخر'},
  {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'},
  {id: 'rep3', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب خالد'},
  {id: 'rep2', role: 'rep', sup: 'sup2', region: 'eastern', name: 'مندوب فريق آخر'},
  {id: 'cs', role: 'customer_service', sup: 'mgr', name: 'خدمة العملاء'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
// The days are Riyadh's: keep clear of midnight so that the server and the test agree on «today» for the whole run.
const riyadhClock = () => new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date());
while (riyadhClock() >= '23:57') await new Promise(resolve => setTimeout(resolve, 20000));
const app = await bootBuiltApp({members});
try {
  const riyadh = at => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date(at));
  const today = riyadh(Date.now()), dayBefore = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') - n * 86_400_000).toISOString().slice(0, 10);
  const days = Array.from({length: 7}, (_, i) => dayBefore(today, i)), stamp = new Date().toISOString();
  const insert = (id, kind, parent, assigned, data, at = stamp) => app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id, kind, parent, assigned, 'الرئيسي', JSON.stringify(data), at, at).run();
  await insert('c1', 'customer', null, 'rep1', {name: 'مصنع الاختبار', region: 'الشرقية', city: 'الدمام'});
  await insert('c2', 'customer', null, 'rep2', {name: 'مصنع الفريق الآخر', region: 'الشرقية', city: 'الخبر'});
  const visit = (id, by, customer, date, extra = {}, at = stamp) => insert(id, 'activity', customer, by, {type: 'visit', ...(date ? {date} : {}), summary: 'تعريف بالمنتجات', result: 'العميل مهتم', performedBy: by, responsibleId: by, recordedByEmail: by + '@yourrest.org', ...extra}, at);
  await visit('t1', 'rep1', 'c1', days[0]); await visit('t2', 'rep1', 'c1', days[0], {type: 'call'}); await visit('t3', 'rep1', 'c1', days[0], {type: 'call', visitWorkflow: 'followup-v1'});
  await visit('y1', 'rep1', 'c1', days[1]); await visit('o6', 'rep3', 'c1', days[6]); await visit('o7', 'rep3', 'c1', dayBefore(today, 7));
  await visit('r2', 'rep2', 'c2', days[2]); await visit('own', 'sup', 'c1', days[0]);
  // The window's edge from when the record was stored (no data.date): the first instant of days[6] and the last of the day before it.
  await visit('edge-in', 'rep3', 'c1', '', {}, new Date(days[6] + 'T00:00:00+03:00').toISOString());
  await visit('edge-out', 'rep3', 'c1', '', {}, new Date(Date.parse(days[6] + 'T00:00:00+03:00') - 1).toISOString());
  const session = {};
  for (const member of members) session[member.id] = app.as(await app.login(member.id));
  const json = async (response, status, label) => {
    eq(response.status, status, label + ' -> ' + response.text.slice(0, 300));
    if (status === 200) eq(response.headers['cache-control'], 'no-store', label + ': never cached');
    return response.json();
  };
  const pending = async (who, status = 200) => json(await session[who]('/api/reviews/pending'), status, 'the red card of ' + who);
  const lines = data => data.items.map(item => [item.memberId, item.date, item.pending]);

  // Who may ask.
  eq((await app.as(null)('/api/reviews/pending')).status, 401, 'anonymous: 401');
  eq((await pending('rep1', 403)).error, 'تقرير خط السير متاح للمشرف ومدير المبيعات فقط', 'a representative: 403');
  eq((await pending('cs', 403)).error, 'هذا الإجراء متاح لفريق المبيعات فقط', 'customer service: 403');
  eq((await pending('owner', 403)).error, 'بطاقة الزيارات والمتابعات بلا نتيجة أو إجراء متاحة للمشرف ومدير المبيعات فقط.', 'the administrator: 403');
  // Each team's own.
  const sup = await pending('sup');
  eq(lines(sup), [['rep1', days[0], 3], ['rep1', days[1], 1], ['rep3', days[6], 2]], 'the supervisor: their two representatives, the newest day first');
  eq([sup.total, sup.days, sup.items[0].name], [6, 7, 'المندوب أحمد'], 'the total, the 7 days and the names');
  ok(!sup.items.some(item => item.date === dayBefore(today, 7)), 'the eighth day back is outside, and the window opens at 00:00 Riyadh (the visit stored at 23:59:59.999 the night before is not counted)');
  eq(lines(await pending('sup2')), [['rep2', days[2], 1]], 'the other supervisor: their representative only');
  const mgr = await pending('mgr');
  eq(lines(mgr), [['rep1', days[0], 3], ['rep1', days[1], 1], ['rep2', days[2], 1], ['rep3', days[6], 2]], 'the sales manager: every representative, not the supervisor\'s own visit');
  // The same as each reader's own day report, member by member and day by day.
  for (const [who, data] of [['sup', sup], ['mgr', mgr]]) for (const date of days) for (const memberId of ['rep1', 'rep2', 'rep3']) {
    const response = await session[who]('/api/reviews?date=' + date + '&memberId=' + memberId);
    if (response.status !== 200) continue;
    const report = response.json(), waiting = report.reviewable.filter(id => !report.entries.some(entry => entry.activityId === id)).length;
    eq(data.items.find(item => item.memberId === memberId && item.date === date)?.pending || 0, waiting, who + ': ' + memberId + ' on ' + date + ' equals the day report');
  }
  // A saved note takes its visit off at once, for the supervisor and the sales manager alike.
  const note = async (who, activityId) => json(await session[who]('/api/reviews', {method: 'POST', body: {kind: 'entry', requestId: crypto.randomUUID(), activityId, result: 'زيارة جيدة', action: 'جهّز عرض السعر', rating: 'effective', version: null}}), 200, 'note on ' + activityId);
  await note('sup', 't1');
  eq(lines(await pending('sup'))[0], ['rep1', days[0], 2], 'one note: 3 -> 2');
  await note('sup', 't2'); await note('mgr', 't3');
  ok(!(await pending('sup')).items.some(item => item.memberId === 'rep1' && item.date === days[0]), 'every visit of the day noted (one by the sales manager): the line is gone');
  eq((await pending('mgr')).total, 4, 'and gone from the sales manager\'s total');
  // The screen hidden: 404; «إضافة» switched off: nothing waits.
  const permissions = (id, hidden, cells = {}) => app.db.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES(?,?,?,1,'owner',?) ON CONFLICT(member_id) DO UPDATE SET permissions=excluded.permissions,hidden=excluded.hidden,version=version+1").bind(id, JSON.stringify(cells), JSON.stringify(hidden), stamp).run();
  await permissions('sup', ['journeys']);
  eq((await pending('sup', 404)).error, 'هذا الجزء غير متاح لحسابك. راجع مدير النظام.', '«تقرير يوم المندوب» hidden: 404');
  await permissions('sup', [], {'journeys:add': false});
  eq((await pending('sup')).total, 0, '«إضافة» on the day report off: nothing to note, nothing waits');
  await app.db.prepare('DELETE FROM crm_member_permissions WHERE member_id=?').bind('sup').run();
  eq((await pending('sup')).total, 3, 'and back');
  console.log(JSON.stringify({ok: true, checks, scope: 'GET /api/reviews/pending on the built release: the doors, both teams, equal to the day report, the 7 days at 00:00 Riyadh, a saved note, a hidden screen, «إضافة» off', realBrowser: false}));
} finally {
  await app.stop();
}
