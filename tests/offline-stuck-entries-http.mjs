// «الإدخالات الواقفة على الجهاز» (the owner, 2026-11-19, GSCO 2.13.84) over real HTTP against the BUILT release (run the build first): what
// the follow-ups route (POST /api/customer-followups) answers an entry kept on the device. A follow-up recorded on the phone and then the
// same one saved online is refused with the member's own follow-up it repeats (code DUPLICATE, its id and day), whether the customer or
// the opportunity moved on; the same request key with other data names that follow-up; another member's follow-up on the opportunity is
// never named; the customer moved to another region or deleted carries CUSTOMER_UNAVAILABLE, the opportunity deleted or closed
// OPPORTUNITY_UNAVAILABLE; the visits route's refusal is its own words (read by the device: lib/offline-review.ts UNAVAILABLE_REFUSALS);
// nothing is written for a refusal; 401 without a session. Synthetic fixtures only: temporary SQLite, mocked mail.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'}, {id: 'sup', role: 'supervisor', sup: 'sm', region: 'eastern'},
  {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern'}, {id: 'west', role: 'rep', region: 'western'}
];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const riyadhClock = () => new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date());
while (riyadhClock() >= '23:57' || riyadhClock() < '00:02') await new Promise(resolve => setTimeout(resolve, 20000));
const app = await bootBuiltApp({members});
try {
  const sessions = {};
  for (const member of ['rep', 'sup']) sessions[member] = await app.login(member);
  const as = id => app.as(sessions[id]);
  const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()), stamp = new Date().toISOString();
  const earlier = new Date(Date.now() - 3600000).toISOString(), week = new Date(Date.now() - 7 * 86400000).toISOString();
  const later = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date(Date.now() + 7 * 86400000));
  const insert = (id, kind, parent, assigned, data, at = stamp) => app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,1,?)')
    .bind(id, kind, parent, assigned, 'الرئيسي', JSON.stringify(data), at, at, 'fixture').run();
  const open = async (id, extra = {}) => {
    await insert(id, 'customer', null, 'rep', {name: 'مصنع ' + id, region: 'الشرقية', city: 'الدمام', branch: 'الرئيسي', assignedTo: 'rep', _createdBy: 'rep'}, week);
    await insert(id + '-v', 'activity', id, 'rep', {visitWorkflow: 'customer-v1', type: 'visit', date: week.slice(0, 10), summary: 'زيارة تعريفية', result: 'العميل مهتم بالقوالب', salesStage: 'specs', nextAction: 'اتصال للمتابعة', nextDate: day, performedBy: 'rep', responsibleId: 'rep', recordedByEmail: 'rep@yourrest.org', ...extra}, week);
    return id + '-v';
  };
  const version = async id => (await app.db.prepare('SELECT version FROM crm_records WHERE id=?').bind(id).first())?.version ?? 1;
  const followup = async (customerId, sourceId, data = {}) => ({createKey: crypto.randomUUID(), customerId, customerVersion: await version(customerId), sourceId, sourceVersion: await version(sourceId),
    data: {type: 'call', date: day, result: 'تحدثت مع العميل عن العرض', salesStage: 'specs', invoiceOutcome: 'pending', nextAction: 'إرسال المواصفات', nextDate: later, lossReason: '', lossDetails: '', ...data}});
  const onPhone = payload => ({...payload, offline: {memberId: 'rep', capturedAt: earlier}});
  const post = async (who, payload, url = '/api/customer-followups') => { const result = await (who ? as(who) : app.as(null))(url, {method: 'POST', body: payload}); return {status: result.status, json: result.json()}; };
  const count = async () => (await app.db.prepare("SELECT COUNT(*) AS n FROM crm_records WHERE kind='activity' AND mutation_id<>'fixture'").first()).n;

  const s1 = await open('c1');
  check((await post(null, await followup('c1', s1))).status, 401, 'no session: 401 before anything is read');
  const kept = onPhone(await followup('c1', s1));
  let answer = await post('rep', await followup('c1', s1));
  check([answer.status, Object.keys(answer.json).sort()], [200, ['id', 'ok']], 'the follow-up saved online answers as before');
  const first = answer.json.id;
  let before = await count();
  answer = await post('rep', kept);
  check([answer.status, answer.json], [409, {error: 'تغيّرت بيانات العميل أو متابعته الأخيرة. حدّث البيانات ثم أعد المحاولة.', code: 'DUPLICATE', duplicate: {id: first, date: day}}], 'the same follow-up kept on the phone: refused, naming the member\'s own follow-up and its day');
  answer = await post('rep', onPhone(await followup('c1', s1)));
  check([answer.status, answer.json.error, answer.json.code, answer.json.duplicate], [409, 'تغيّرت المتابعة السابقة. حدّث البيانات ثم أعد المحاولة.', 'DUPLICATE', {id: first, date: day}], 'with the customer as it is now: the opportunity moved on to that follow-up');
  const next = await followup('c1', first);
  check((await post('rep', next)).status, 200, 'the next follow-up, on the latest one');
  before = await count();
  answer = await post('rep', {...next, data: {...next.data, result: 'نتيجة مختلفة لنفس الطلب'}});
  check([answer.status, answer.json], [409, {error: 'تم حفظ هذه المتابعة بالفعل. افتح تسجيل متابعة جديدة.', code: 'DUPLICATE', duplicate: {id: 'customer-followup-' + next.createKey, date: day}}], 'the same request key with other data: saved already, naming it');
  check(await count(), before, 'nothing written for either refusal');

  // Another member's follow-up on the opportunity is never named.
  const s2 = await open('c2');
  const theirs = onPhone(await followup('c2', s2));
  const supervisor = await post('sup', await followup('c2', s2, {result: 'تابع المشرف مع العميل'}));
  check(supervisor.status, 200, 'the supervisor follows the opportunity up online');
  answer = await post('rep', theirs);
  check([answer.status, answer.json], [409, {error: 'تغيّرت بيانات العميل أو متابعته الأخيرة. حدّث البيانات ثم أعد المحاولة.'}], 'the representative\'s entry: the refusal alone, nothing of the supervisor\'s');

  // No longer the member's.
  const s3 = await open('c3');
  const toMoved = onPhone(await followup('c3', s3));
  await app.db.prepare("UPDATE crm_records SET assigned_to='west',data=json_set(data,'$.assignedTo','west','$.region','الغربية') WHERE id IN ('c3','c3-v')").run();
  before = await count();
  answer = await post('rep', toMoved);
  check([answer.status, answer.json], [403, {error: 'اختر العميل', code: 'CUSTOMER_UNAVAILABLE'}], 'the customer moved to another region: CUSTOMER_UNAVAILABLE');
  answer = await post('rep', {createKey: crypto.randomUUID(), customerId: 'c3', customerVersion: 1, timingMode: 'automatic', elapsedMilliseconds: 5000, offline: {memberId: 'rep', capturedAt: earlier}, data: {type: 'call', summary: 'تعريف', result: 'متابعة العميل', nextAction: 'اتصال', nextDate: later}}, '/api/visits');
  check([answer.status, answer.json], [403, {error: 'اختر العميل'}], 'the visits route: its own words, which the device reads');
  answer = await post('rep', onPhone(await followup('c-deleted', 'c-deleted-v')));
  check([answer.status, answer.json.code], [403, 'CUSTOMER_UNAVAILABLE'], 'a customer that is no more');
  const s4 = await open('c4');
  const toGone = onPhone(await followup('c4', s4));
  await app.db.prepare('DELETE FROM crm_records WHERE id=?').bind(s4).run();
  answer = await post('rep', toGone);
  check([answer.status, answer.json], [403, {error: 'المتابعة لا تتبع هذا العميل', code: 'OPPORTUNITY_UNAVAILABLE'}], 'the opportunity deleted: OPPORTUNITY_UNAVAILABLE');
  const s5 = await open('c5');
  const toClosed = onPhone(await followup('c5', s5));
  await app.db.prepare("UPDATE crm_records SET data=json_set(data,'$.salesStage','won','$.nextAction','','$.nextDate','') WHERE id=?").bind(s5).run();
  answer = await post('rep', toClosed);
  check([answer.status, answer.json], [400, {error: 'المتابعة تتطلب زيارة سابقة بها إجراء قادم وموعد متابعة.', code: 'OPPORTUNITY_UNAVAILABLE'}], 'the opportunity closed: OPPORTUNITY_UNAVAILABLE');
  check(await count(), before, 'nothing written for a record no longer the member\'s');
  console.log(JSON.stringify({ok: true, checks, builtRelease: true, coverage: 'the follow-ups route\'s answers to an entry kept on the device: duplicate with the member\'s own follow-up and its day, never another member\'s, the customer or the opportunity no longer available, the visits route\'s own words'}));
} catch (error) {
  console.error(error);
  console.error(app.log().slice(-3000));
  process.exitCode = 1;
} finally {
  await app.stop();
}
