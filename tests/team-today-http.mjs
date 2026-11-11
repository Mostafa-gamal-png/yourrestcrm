// «فريقي اليوم» (GET /api/team-today, lib/team-today*.ts) over real HTTP against the BUILT release (run the build first): anonymous
// 401, a representative 403, customer service 403, a supervisor whose «تقرير يوم المندوب» is hidden 404 (as the report itself), never
// cached; the supervisor reads their own representatives only (not another team's, not another region's, not an inactive one, not
// themself), the manager and the administrator wider, «عرض بيانات الفريق بالكامل» widening it; the visits and other contacts are the
// day report's own (GET /api/journeys of today, member by member); a representative who did nothing is «not started»; a note the
// supervisor writes through /api/reviews is counted until the representative presses «قرأت» through /api/review-inbox, and an edit
// counts again. Names, counts and times only. Synthetic fixtures only: temporary SQLite, mocked mail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'},
  {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', region: 'eastern', name: 'المشرف سالم'},
  {id: 'sup2', role: 'supervisor', sup: 'mgr', region: 'eastern', name: 'مشرف آخر'},
  {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'},
  {id: 'rep2', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب بدر'},
  {id: 'repw', role: 'rep', sup: 'sup', region: 'western', name: 'مندوب الغربية'},
  {id: 'gone', role: 'rep', sup: 'sup', region: 'eastern', name: 'مندوب معطل'},
  {id: 'rep3', role: 'rep', sup: 'sup2', region: 'eastern', name: 'مندوب فريق آخر'},
  {id: 'cs', role: 'customer_service', sup: 'mgr', name: 'خدمة العملاء'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const app = await bootBuiltApp({members});
try {
  const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()), now = new Date().toISOString();
  await app.db.prepare("UPDATE crm_members SET active=0 WHERE id='gone'").run();
  const insert = (id, kind, parent, assigned, data) => app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id, kind, parent, assigned, 'الرئيسي', JSON.stringify(data), now, now).run();
  await insert('c1', 'customer', null, 'rep1', {name: 'مصنع الشرق', region: 'الشرقية', city: 'الدمام', location: '26.43, 50.03', customerStatus: 'نشط'});
  await insert('cw', 'customer', null, 'repw', {name: 'مصنع الغرب', region: 'الغربية', city: 'جدة', location: '21.5, 39.2', customerStatus: 'نشط'});
  for (const [id, by, type, customer] of [['v1', 'rep1', 'visit', 'c1'], ['v2', 'rep1', 'visit', 'c1'], ['call1', 'rep1', 'call', 'c1'], ['w1', 'repw', 'visit', 'cw'], ['o1', 'rep3', 'visit', 'c1'], ['s1', 'sup', 'visit', 'c1']])
    await insert(id, 'activity', customer, by, {type, date: day, summary: 'تعريف بالمنتجات', result: 'العميل مهتم', performedBy: by, responsibleId: by, recordedByEmail: by + '@yourrest.org'});
  const session = {};
  for (const member of members.filter(member => member.id !== 'gone')) session[member.id] = app.as(await app.login(member.id));
  const json = async (response, status, label) => { eq(response.status, status, label + ' -> ' + response.text.slice(0, 300)); return response.json(); };
  const today = async (who, status = 200) => { const response = await session[who]('/api/team-today'); const body = await json(response, status, 'GET /api/team-today as ' + who); if (status === 200) eq(response.headers['cache-control'], 'no-store', 'never cached'); return body; };
  const rows = body => body.rows.map(row => [row.memberId, row.visits, row.contacts, row.startedAt ? row.startedBy : null, row.unreadNotes]);

  // The doors.
  eq((await app.as(null)('/api/team-today')).status, 401, 'anonymous: 401');
  for (const who of ['rep1', 'rep3']) eq((await today(who, 403)).error, 'تقرير خط السير متاح للمشرف ومدير المبيعات فقط', who + ': 403, the day report\'s own refusal');
  eq((await today('cs', 403)).error, 'هذا الإجراء متاح لفريق المبيعات فقط', 'customer service: 403');
  eq((await app.as(null)('/api/team-today', {method: 'POST', body: {}})).status, 405, 'GET only: a POST is not a route');

  // The supervisor: rep1 (two visits, a call, started by the record), rep2 (nothing: not started); not repw (western), not the
  // inactive one, not rep3 (another team), not themself.
  let body = await today('sup');
  eq([body.ok, body.date, rows(body)], [true, day, [['rep2', 0, 0, null, 0], ['rep1', 2, 1, 'record', 0]]], 'the supervisor\'s two representatives, the one who has not started first');
  eq(body.totals, {members: 2, started: 1, visits: 2, contacts: 1, unreadNotes: 0}, 'the header totals');
  eq(Object.keys(body.rows[0]).sort(), ['contacts', 'memberId', 'name', 'role', 'startedAt', 'startedBy', 'unreadNotes', 'visits'], 'names, counts and times only');
  eq(body.rows.map(row => row.name), ['المندوب بدر', 'المندوب أحمد'], 'by name');
  // The same counts as the day report of today.
  for (const memberId of ['rep1', 'rep2']) {
    const report = await json(await session.sup('/api/journeys?date=' + day + '&memberId=' + memberId), 200, 'the day report of ' + memberId);
    const mine = body.rows.find(row => row.memberId === memberId);
    eq([report.daily.summary.recordedVisits, report.daily.summary.recordedCommunications], [mine.visits, mine.contacts], memberId + ': the day report\'s «زيارات مسجلة» and «تواصل آخر مسجل»');
  }
  eq(rows(await today('sup2')), [['rep3', 1, 0, 'record', 0]], 'the other supervisor: their own');
  eq(rows(await today('mgr')).map(row => row[0]), ['rep2', 'sup', 'repw', 'rep3', 'rep1'], 'the sales manager: every active representative in every region, and the supervisor who visited (equal days by name)');
  eq(rows(await today('owner')).map(row => row[0]), ['rep2', 'sup', 'repw', 'rep3', 'rep1'], 'the administrator: the same people');

  // «عرض بيانات الفريق بالكامل» and a hidden «تقرير يوم المندوب» through the administrator's own save.
  const permissions = async (memberId, input) => { const version = Number((await app.db.prepare('SELECT version FROM crm_member_permissions WHERE member_id=?').bind(memberId).first())?.version || 0); return json(await session.owner('/api/crm', {method: 'POST', body: {action: 'permissions', memberId, version, cells: {}, hidden: [], viewAll: false, ...input}}), 200, 'the administrator saves ' + memberId + '\'s permissions'); };
  await permissions('sup', {viewAll: true});
  eq(rows(await today('sup')).map(row => row[0]), ['rep2', 'rep3', 'rep1'], '«عرض بيانات الفريق بالكامل»: another supervisor\'s representative in their region too');
  await permissions('sup', {viewAll: false});
  await permissions('sup2', {hidden: ['journeys']});
  eq((await today('sup2', 404)).error, 'هذا الجزء غير متاح لحسابك. راجع مدير النظام.', '«تقرير يوم المندوب» hidden: 404, as the report');
  eq((await session.sup2('/api/journeys?date=' + day)).status, 404, 'the report itself: 404 too');
  eq((await today('sup')).rows.length, 2, 'the supervisor is unaffected');

  // The notes: written through /api/reviews, read through /api/review-inbox.
  const note = await json(await session.sup('/api/reviews', {method: 'POST', body: {requestId: crypto.randomUUID(), version: null, kind: 'entry', activityId: 'v1', result: 'زيارة جيدة', action: 'جهّز عرض السعر'}}), 200, 'the supervisor notes rep1\'s visit');
  await json(await session.sup('/api/reviews', {method: 'POST', body: {requestId: crypto.randomUUID(), version: null, kind: 'day', memberId: 'rep2', date: day, result: 'يوم بلا زيارات', action: 'ابدأ بدري'}}), 200, 'and rep2\'s day');
  eq(rows(await today('sup')).map(row => [row[0], row[4]]), [['rep2', 1], ['rep1', 1]], 'one unread note each');
  eq((await today('sup')).totals.unreadNotes, 2, 'in the totals');
  const inbox = await json(await session.rep1('/api/review-inbox'), 200, 'rep1\'s card');
  await json(await session.rep1('/api/review-inbox', {method: 'POST', body: {items: inbox.items.map(item => ({kind: item.kind, ref: item.ref, version: item.version}))}}), 200, 'rep1 presses «قرأت»');
  eq(rows(await today('sup')).map(row => [row[0], row[4]]), [['rep2', 1], ['rep1', 0]], 'read: no longer counted');
  await json(await session.sup('/api/reviews', {method: 'POST', body: {requestId: crypto.randomUUID(), version: note.review.version, kind: 'entry', activityId: 'v1', result: 'زيارة جيدة جدًا', action: 'جهّز عرض السعر اليوم'}}), 200, 'the supervisor edits the note');
  eq(rows(await today('sup')).map(row => [row[0], row[4]]), [['rep2', 1], ['rep1', 1]], 'an edited note waits again');
  ok(!/at .*node_modules|stack/i.test(app.log().replace(/ExperimentalWarning[^\n]*/g, '')), 'no stack trace in the server log');
} finally { await app.stop(); }

console.log(JSON.stringify({ok: true, checks, builtRelease: true, syntheticFixtures: true}));
