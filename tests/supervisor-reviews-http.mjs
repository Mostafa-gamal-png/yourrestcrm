// The supervisor's notes (lib/supervisor-reviews*.ts, migration 0019) over real HTTP against the BUILT release (run the build first):
// a supervisor writes «النتيجة» and «الإجراء المطلوب» on their representative's visit and day (200), not on another team's (403) nor
// as a representative (403); a retry answers from its receipt, the same key with other words and a stale version are 409; the
// representative's card lists the notes, «قرأت» hides one (another member's «قرأت» changes nothing), the supervisor sees it read and
// when, an edit makes it unread again, «قرأت الكل»; anonymous callers get 401; GET /api/crm keeps the notes out of its recent changes;
// the day report (GET /api/journeys) answers as before. Synthetic fixtures only: temporary SQLite, mocked mail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'},
  {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف سالم'},
  {id: 'sup2', role: 'supervisor', sup: 'mgr', name: 'مشرف آخر'},
  {id: 'rep1', role: 'rep', sup: 'sup', name: 'المندوب أحمد'},
  {id: 'rep2', role: 'rep', sup: 'sup2', name: 'مندوب فريق آخر'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const app = await bootBuiltApp({members});
try {
  const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()), now = new Date().toISOString();
  const insert = (id, kind, parent, assigned, data) => app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id, kind, parent, assigned, 'الرئيسي', JSON.stringify(data), now, now).run();
  await insert('c1', 'customer', null, 'rep1', {name: 'مصنع الاختبار', region: 'الشرقية', city: 'الدمام', location: '26.43, 50.03'});
  for (const [id, by, type] of [['visit-rep1', 'rep1', 'visit'], ['call-rep1', 'rep1', 'call'], ['visit-rep2', 'rep2', 'visit']])
    await insert(id, 'activity', 'c1', by, {type, date: day, summary: 'تعريف بالمنتجات', result: 'العميل مهتم', performedBy: by, responsibleId: by, recordedByEmail: by + '@yourrest.org'});
  const session = {};
  for (const member of members) session[member.id] = app.as(await app.login(member.id));
  const anonymous = app.as(null);
  const json = async (response, status, label) => { eq(response.status, status, label + ' -> ' + response.text.slice(0, 300)); return response.json(); };
  const save = async (who, body, status, label) => json(await session[who]('/api/reviews', {method: 'POST', body: {requestId: crypto.randomUUID(), version: null, ...body}}), status, label);
  const unread = async who => json(await session[who]('/api/review-inbox'), 200, 'inbox of ' + who);
  const read = async (who, items, status = 200) => json(await session[who]('/api/review-inbox', {method: 'POST', body: {items}}), status, 'read as ' + who);
  const report = async (who, memberId, status = 200) => json(await session[who]('/api/reviews?date=' + day + '&memberId=' + memberId), status, 'report notes as ' + who);

  // Anonymous: 401 on every new route, with or without a body.
  for (const url of ['/api/reviews?date=' + day, '/api/review-inbox']) eq((await anonymous(url)).status, 401, 'anonymous GET ' + url);
  for (const url of ['/api/reviews', '/api/review-inbox']) for (const body of [{}, {kind: 'entry', activityId: 'visit-rep1', result: 'نتيجة', action: 'إجراء', version: null, requestId: crypto.randomUUID()}, {items: [{kind: 'entry', ref: 'visit-rep1', version: 1}]}])
    eq((await anonymous(url, {method: 'POST', body})).status, 401, 'anonymous POST ' + url);
  // Who writes, on whom.
  const note = {kind: 'entry', activityId: 'visit-rep1', result: 'زيارة جيدة', action: 'جهّز عرض السعر'};
  await save('rep1', note, 403, 'a representative cannot write a note');
  await save('rep2', {...note, activityId: 'visit-rep2'}, 403, 'nor on their own visit');
  await save('sup', {...note, activityId: 'visit-rep2'}, 403, 'a supervisor cannot note another team\'s representative');
  await save('sup', {kind: 'day', memberId: 'rep2', date: day, result: 'يوم', action: 'إجراء'}, 403, 'nor their day');
  await save('sup', {...note, result: 'x'}, 400, 'both fields need two characters');
  const requestId = crypto.randomUUID();
  const first = await save('sup', {...note, requestId}, 200, 'the supervisor notes their representative\'s visit');
  eq([first.review.activityId, first.review.memberId, first.review.version, first.review.readAt, first.review.reviewedByName], ['visit-rep1', 'rep1', 1, null, 'المشرف سالم'], 'version 1, not read');
  eq((await save('sup', {...note, requestId}, 200, 'retry')).review.version, 1, 'a retry answers from its receipt');
  await save('sup', {...note, requestId, result: 'كلام مختلف'}, 409, 'the same key with other words');
  await save('sup', note, 409, 'a stale version (a second «add»)');
  const dayNote = await save('sup', {kind: 'day', memberId: 'rep1', date: day, result: 'يوم منظم', action: 'زد الزيارات غدًا'}, 200, 'the day note');
  eq(dayNote.review.version, 1, 'the day note, version 1');
  eq(Number((await app.db.prepare("SELECT COUNT(*) n FROM crm_audit WHERE action='مراجعة المشرف لزيارة أو متابعة'").first()).n), 1, 'one saved visit note, one audit row');
  // What each one sees.
  let notes = await report('sup', 'rep1');
  eq([notes.entries.map(entry => [entry.activityId, entry.readAt]), notes.reviewable.sort(), notes.day.readAt, notes.dayReviewable], [[['visit-rep1', null]], ['call-rep1', 'visit-rep1'], null, true], 'the supervisor: unread, and what they may note');
  await report('sup', 'rep2', 403);await report('rep1', 'rep1', 403);
  let mine = await unread('rep1');
  eq(mine.items.map(item => [item.kind, item.ref, item.version, item.result, item.action, item.reviewedByName, item.customerName, item.activityType]).sort(), [['day', day, 1, 'يوم منظم', 'زد الزيارات غدًا', 'المشرف سالم', '', ''], ['entry', 'visit-rep1', 1, 'زيارة جيدة', 'جهّز عرض السعر', 'المشرف سالم', 'مصنع الاختبار', 'visit']], 'the representative\'s card lists both notes');
  eq([(await unread('rep2')).items, (await unread('sup')).items], [[], []], 'nobody else has them');
  // Another member's «قرأت» marks nothing; the representative's own hides the note; the supervisor sees when.
  await read('rep2', [{kind: 'entry', ref: 'visit-rep1', version: 1}]);
  await read('sup', [{kind: 'entry', ref: 'visit-rep1', version: 1}]);
  eq((await unread('rep1')).items.length, 2, 'another member\'s «قرأت» changes nothing');
  await read('rep1', [{kind: 'entry', ref: 'visit-rep1', version: 1}]);
  mine = await unread('rep1');
  eq(mine.items.map(item => item.kind), ['day'], '«قرأت» hides the visit note');
  notes = await report('sup', 'rep1');
  ok(typeof notes.entries[0].readAt === 'string' && Number.isFinite(Date.parse(notes.entries[0].readAt)) && notes.day.readAt === null, 'the supervisor sees «تمت القراءة» with its time');
  // An edit is a new version: unread again.
  await save('sup', {...note, version: 1, result: 'زيارة جيدة جدًا'}, 200, 'the edit');
  eq((await unread('rep1')).items.map(item => [item.kind, item.version, item.result]).sort(), [['day', 1, 'يوم منظم'], ['entry', 2, 'زيارة جيدة جدًا']], 'an edited note is unread again');
  eq((await report('sup', 'rep1')).entries[0].readAt, null, 'and the supervisor sees it unread');
  // «قرأت الكل».
  eq((await read('rep1', (await unread('rep1')).items.map(({kind, ref, version}) => ({kind, ref, version})))).items, [], '«قرأت الكل»');
  await read('rep1', [], 400);
  // The recent changes of GET /api/crm list none of it; the day report answers as before (no new key).
  for (const who of ['owner', 'sup', 'rep1']) {
    const state = await json(await session[who]('/api/crm'), 200, 'GET /api/crm as ' + who);
    ok(!state.audits.some(audit => ['مراجعة المشرف لزيارة أو متابعة', 'مراجعة المشرف لتقرير اليوم', 'قراءة مراجعة المشرف'].includes(audit.action)), 'no note or read in the recent changes of ' + who);
  }
  const journey = await json(await session.sup('/api/journeys?date=' + day + '&memberId=rep1'), 200, 'the day report');
  eq(Object.keys(journey).sort(), ['communications', 'daily', 'date', 'memberId', 'members', 'mobileDays', 'serverTime', 'stops', 'tracking'], 'the day report keeps its shape');
  eq(journey.communications.map(item => item.id).sort(), ['call-rep1', 'visit-rep1'], 'and lists the two activities the notes are on');
  // A body over the route's limit is refused (413), and a write from another site (403).
  eq((await session.sup('/api/reviews', {method: 'POST', body: {...note, version: 2, requestId: crypto.randomUUID(), pad: 'x'.repeat(15000)}})).status, 413, 'a body over 14 000 bytes');
  eq((await session.sup('/api/reviews', {method: 'POST', body: note, headers: {Origin: 'https://evil.example'}})).status, 403, 'a write from another site');
  eq((await session.rep1('/api/review-inbox', {method: 'POST', body: {items: []}, headers: {Origin: 'https://evil.example'}})).status, 403, 'a read from another site');
  console.log(JSON.stringify({ok: true, checks}));
} finally { await app.stop(); }
