// The five additions to the supervisor's notes (2026-11-15; lib/supervisor-reviews*.ts) over real HTTP against the BUILT release (run the
// build first): the evaluation of a visit or contact (required «فعالة» or «سلبية», «إيجابية» by itself on a sale, an old note without one),
// «قرأت» on one note at a time, the earlier notes of a customer (GET /api/reviews/customer: a representative their own work only, a
// supervisor their team, customer service and another region 404) and «تقرير مراجعاتي» (GET /api/reviews/made: a supervisor their own, a
// sales manager a supervisor of theirs, the administrator anyone; a representative and customer service 403); 401 without a session and
// no-store on every answer. Synthetic fixtures only: temporary SQLite, mocked mail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'},
  {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف سالم'},
  {id: 'sup2', role: 'supervisor', sup: 'mgr', name: 'مشرف آخر'},
  {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'},
  {id: 'rep2', role: 'rep', sup: 'sup2', region: 'eastern', name: 'مندوب فريق آخر'},
  {id: 'repw', role: 'rep', sup: 'sup', region: 'western', name: 'مندوب الغربية'},
  {id: 'cs', role: 'customer_service', sup: 'mgr', name: 'خدمة العملاء'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const app = await bootBuiltApp({members});
try {
  const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()), now = new Date().toISOString();
  const insert = (id, kind, parent, assigned, data) => app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id, kind, parent, assigned, 'الرئيسي', JSON.stringify(data), now, now).run();
  await insert('c1', 'customer', null, 'rep1', {name: 'مصنع الاختبار', region: 'الشرقية', city: 'الدمام'});
  await insert('c2', 'customer', null, 'rep2', {name: 'مصنع الفريق الآخر', region: 'الشرقية', city: 'الخبر'});
  for (const [id, by, customer, extra] of [['visit-open', 'rep1', 'c1', {salesStage: 'quoted'}], ['visit-won', 'rep1', 'c1', {salesStage: 'won'}], ['followup-invoiced', 'rep1', 'c1', {type: 'call', visitWorkflow: 'followup-v1', salesStage: 'won', invoiceOutcome: 'invoiced'}], ['visit-old', 'rep1', 'c1', {salesStage: 'specs'}], ['visit-rep2', 'rep2', 'c2', {}]])
    await insert(id, 'activity', customer, by, {type: 'visit', date: day, summary: 'تعريف بالمنتجات', result: 'العميل مهتم', performedBy: by, responsibleId: by, recordedByEmail: by + '@yourrest.org', ...extra});
  const session = {};
  for (const member of members) session[member.id] = app.as(await app.login(member.id));
  const anonymous = app.as(null);
  const json = async (response, status, label) => {
    eq(response.status, status, label + ' -> ' + response.text.slice(0, 300));
    if (status === 200) eq(response.headers['cache-control'], 'no-store', label + ': never cached');
    return response.json();
  };
  const save = async (who, body, status, label) => json(await session[who]('/api/reviews', {method: 'POST', body: {requestId: crypto.randomUUID(), version: null, result: 'زيارة جيدة', action: 'جهّز عرض السعر', ...body}}), status, label);
  const unread = async who => json(await session[who]('/api/review-inbox'), 200, 'inbox of ' + who);
  const read = async (who, items, status = 200) => json(await session[who]('/api/review-inbox', {method: 'POST', body: {items}}), status, 'read as ' + who);
  const notesOf = async (who, customerId, status = 200) => json(await session[who]('/api/reviews/customer?customerId=' + customerId), status, 'earlier notes of ' + customerId + ' as ' + who);
  const made = async (who, query = '', status = 200) => json(await session[who]('/api/reviews/made?date=' + day + query), status, 'reviews report as ' + who + query);

  // Without a session: 401 on the two new routes.
  for (const url of ['/api/reviews/customer?customerId=c1', '/api/reviews/made?date=' + day]) eq((await anonymous(url)).status, 401, 'anonymous GET ' + url);

  // 1. The evaluation.
  eq((await save('sup', {kind: 'entry', activityId: 'visit-open'}, 400, 'no evaluation')).error, 'اختر تقييم الزيارة أو التواصل: فعالة أو سلبية.', 'the evaluation is required');
  await save('sup', {kind: 'entry', activityId: 'visit-open', rating: 'positive'}, 400, '«إيجابية» cannot be chosen');
  await save('rep1', {kind: 'entry', activityId: 'visit-open', rating: 'effective'}, 403, 'a representative still writes no note');
  eq((await save('sup', {kind: 'entry', activityId: 'visit-open', rating: 'effective'}, 200, '«فعالة»')).review.rating, 'effective', '«فعالة» saved');
  eq((await save('sup', {kind: 'entry', activityId: 'visit-won'}, 200, 'the sale')).review.rating, 'positive', 'the sale: «إيجابية» by itself');
  eq((await save('sup', {kind: 'entry', activityId: 'followup-invoiced', rating: 'negative'}, 200, 'the invoiced follow-up')).review.rating, 'positive', 'a follow-up turned into an invoice: «إيجابية» whatever was sent');
  await save('sup', {kind: 'day', memberId: 'rep1', date: day, rating: 'effective'}, 400, 'a day note takes no evaluation');
  await save('sup', {kind: 'day', memberId: 'rep1', date: day, result: 'يوم منظم', action: 'زد الزيارات'}, 200, 'the day note');
  // A note written before the evaluation existed: its audit row has no rating.
  const oldId = 'review-entry:sup:' + crypto.randomUUID();
  await app.db.prepare('INSERT INTO crm_daily_entry_reviews(activity_id,member_id,date,result,action,reviewed_by,version,mutation_id,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?)').bind('visit-old', 'rep1', day, 'ملاحظة قديمة', 'إجراء قديم', 'sup', oldId, now, now).run();
  await app.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(oldId, 'visit-old', 'المشرف سالم', 'مراجعة المشرف لزيارة أو متابعة', JSON.stringify({before: null, after: {activityId: 'visit-old', memberId: 'rep1', date: day, result: 'ملاحظة قديمة', action: 'إجراء قديم', reviewedBy: 'sup', version: 1}}), now).run();
  const report = await json(await session.sup('/api/reviews?date=' + day + '&memberId=rep1'), 200, 'the day report\'s notes');
  eq([Object.fromEntries(report.entries.map(entry => [entry.activityId, entry.rating])), [...report.sales].sort()], [{'visit-open': 'effective', 'visit-won': 'positive', 'followup-invoiced': 'positive', 'visit-old': ''}, ['followup-invoiced', 'visit-won']], 'each note\'s evaluation (none on the old one) and the sales');
  let mine = await unread('rep1');
  eq(Object.fromEntries(mine.items.map(item => [item.ref, item.rating ?? 'none'])), {'visit-open': 'effective', 'visit-won': 'positive', 'followup-invoiced': 'positive', 'visit-old': '', [day]: 'none'}, 'the card carries each evaluation');

  // 5. «قرأت» on one note at a time.
  eq((await read('rep1', [{kind: 'entry', ref: 'visit-open', version: 1}, {kind: 'entry', ref: 'visit-won', version: 1}], 400)).error, 'اضغط «قرأت» على كل ملاحظة وحدها.', 'two notes at once: refused');
  eq((await unread('rep1')).items.length, 5, 'nothing marked read');
  mine = await read('rep1', [{kind: 'entry', ref: 'visit-won', version: 1}]);
  eq(mine.items.map(item => item.ref).includes('visit-won'), false, 'one note read');
  await read('rep2', [{kind: 'entry', ref: 'visit-open', version: 1}]);
  eq((await unread('rep1')).items.length, 4, 'another member\'s «قرأت» changes nothing');

  // 2. The earlier notes of a customer.
  await save('owner', {kind: 'entry', activityId: 'visit-rep2', rating: 'negative', result: 'اتصال ضعيف'}, 200, 'the administrator on rep2\'s visit');
  let notes = await notesOf('rep1', 'c1');
  eq(notes.notes.map(note => [note.activityId, note.rating]).sort(), [['followup-invoiced', 'positive'], ['visit-old', ''], ['visit-open', 'effective'], ['visit-won', 'positive']], 'the representative: the notes on their own work');
  eq([(await notesOf('rep2', 'c1')).notes, (await notesOf('rep2', 'c2')).notes.map(note => note.activityId), (await notesOf('rep1', 'c2')).notes], [[], ['visit-rep2'], []], 'another representative: only their own');
  eq([(await notesOf('sup', 'c1')).notes.length, (await notesOf('sup2', 'c1')).notes.length, (await notesOf('mgr', 'c1')).notes.length], [4, 0, 4], 'a supervisor their team, another supervisor none, the sales manager their scope');
  for (const [who, customerId] of [['cs', 'c1'], ['repw', 'c1'], ['rep1', 'missing']]) await notesOf(who, customerId, 404);
  eq((await unread('rep1')).items.length, 4, 'reading them there is not «قرأت»');

  // 3. «تقرير مراجعاتي».
  for (const who of ['rep1', 'cs']) await made(who, '', 403);
  const supMade = await made('sup');
  eq([supMade.reviewers.map(reviewer => reviewer.id), supMade.entries.map(entry => [entry.activityId, entry.rating, entry.memberName, entry.customerName]), supMade.days.map(note => note.memberName)], [['sup'], [['visit-old', '', 'المندوب أحمد', 'مصنع الاختبار'], ['visit-open', 'effective', 'المندوب أحمد', 'مصنع الاختبار'], ['visit-won', 'positive', 'المندوب أحمد', 'مصنع الاختبار'], ['followup-invoiced', 'positive', 'المندوب أحمد', 'مصنع الاختبار']], ['المندوب أحمد']], 'the supervisor\'s own day in the order first saved (the old note\'s row is the earliest): each note with its member, customer and evaluation');
  eq(supMade.counts, {notes: 5, entries: 4, days: 1, members: 1, positive: 2, effective: 1, negative: 0, unrated: 1, read: 1, unread: 4}, 'the counts');
  for (const reviewerId of ['mgr', 'sup2', 'owner']) await made('sup', '&reviewerId=' + reviewerId, 403);
  const mgrMade = await made('mgr', '&reviewerId=sup');
  eq([mgrMade.reviewers.map(reviewer => reviewer.id), mgrMade.entries.length], [['mgr', 'sup', 'sup2'], 4], 'the sales manager chooses a supervisor');
  await made('mgr', '&reviewerId=owner', 403);
  eq((await made('owner', '&reviewerId=owner')).entries.map(entry => entry.activityId), ['visit-rep2'], 'the administrator\'s own');
  eq((await made('owner', '&reviewerId=mgr')).entries, [], 'and any reviewer\'s');
  eq((await session.sup('/api/reviews/made?date=2026-13-01')).status, 400, 'a bad day: 400');
  // A route of reading only refuses a write.
  for (const url of ['/api/reviews/customer', '/api/reviews/made']) ok((await session.sup(url, {method: 'POST', body: {}})).status === 405, 'POST ' + url + ': 405');
  console.log(JSON.stringify({ok: true, checks}));
} finally { await app.stop(); }
