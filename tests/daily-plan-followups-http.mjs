// «خطة الغد» of 2026-11-22 (the port of GSCO 2.13.85, migration 0025) over real HTTP against the BUILT release (`npm run build` first):
// POST /api/crm/opportunity-next-dates by every role (no session 401, another site 403, GET and PUT 405, customer service 403, a switched-off
// «إعداد خطة اليوم» 403 with its words, a representative's own follow-ups moved and another's not_found, a supervisor's team, another team
// not_found, a suspended representative's customer unassigned, the administrator), its limits (201 items, a past day, 31 days 400; 30 days
// accepted), a request repeated after a cut connection answered from its receipts without a second write and the same number with another
// body 409; then POST /api/daily-plans: a page older than the targets 409 «حُدّث التطبيق؛ أعد تحميل الصفحة.», a plan with its targets, a
// customer without a follow-up refused, the supervisor's change of the targets marked and kept from the representative (403), the achieved
// numbers and «ترحيل جماعي» in the plan; and GET /api/crm without the moves. Synthetic fixtures only: temporary SQLite, mocked mail.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'},
  {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', region: 'eastern', name: 'المشرف سالم'},
  {id: 'sup2', role: 'supervisor', sup: 'mgr', region: 'eastern', name: 'مشرف آخر'},
  {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'},
  {id: 'rep2', role: 'rep', sup: 'sup2', region: 'eastern', name: 'مندوب فريق آخر'},
  {id: 'rep3', role: 'rep', sup: 'sup', region: 'eastern', name: 'مندوب ثالث'},
  {id: 'gone', role: 'rep', sup: 'sup', region: 'eastern', name: 'مندوب موقوف'},
  {id: 'csm', role: 'customer_service_manager', name: 'مدير خدمة العملاء'},
  {id: 'cs', role: 'customer_service', sup: 'csm', name: 'ممثل خدمة العملاء'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const riyadh = at => new Date(at + 3 * 3600000).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const app = await bootBuiltApp({members});
try {
  const T = riyadh(Date.now()), now = new Date().toISOString(), earlier = addDays(T, -5);
  const insert = (id, kind, parent, assigned, data, at = now) => app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id, kind, parent, assigned, 'الرئيسي', JSON.stringify(data), at, at).run();
  const followup = async (id, owner, data = {}) => {
    await insert('cust-' + id, 'customer', null, owner, {name: 'عميل ' + id, region: 'الشرقية', city: 'الخبر', location: '26.3, 50.2'});
    await insert('fu-' + id, 'activity', 'cust-' + id, owner, {type: 'call', date: earlier, summary: 'متابعة سابقة', result: 'تمت', performedBy: owner, responsibleId: owner, nextAction: 'متابعة العرض', nextDate: addDays(T, -2), visitWorkflow: 'customer-v1', ...data}, new Date(Date.parse(now) - 5 * 86400000).toISOString());
  };
  for (const id of ['1', '2', '3', '4']) await followup(id, 'rep1');
  await followup('won', 'rep1', {salesStage: 'won'});
  await followup('other', 'rep2'); await followup('team3', 'rep3'); await followup('gone', 'gone');
  await insert('free', 'customer', null, 'rep1', {name: 'عميل بلا متابعة', region: 'الشرقية', city: 'الخبر'});
  const session = {};
  for (const member of members) session[member.id] = app.as(await app.login(member.id));
  await app.db.prepare("UPDATE crm_members SET active=0 WHERE id='gone'").run();
  const anonymous = app.as(null);
  const json = async (response, status, label) => { eq(response.status, status, label + ' -> ' + response.text.slice(0, 300)); return response.json(); };
  const URL = '/api/crm/opportunity-next-dates';
  const move = async (who, items, next, extra = {}, status = 200) => json(await session[who](URL, {method: 'POST', body: {request_id: crypto.randomUUID(), next_date: next, items, ...extra}}), status, 'POST next-dates as ' + who);
  const item = (id, version = 1) => ({id: 'fu-' + id, version});
  const statuses = answer => answer.results.map(result => [result.id.replace('fu-', ''), result.status]);
  const nextOf = async id => JSON.parse((await app.db.prepare('SELECT data FROM crm_records WHERE id=?').bind('fu-' + id).first()).data).nextDate;

  // Who: nobody, another site, other methods, customer service, a switched-off cell.
  eq((await anonymous(URL, {method: 'POST', body: {}})).status, 401, 'no session: 401');
  eq((await session.rep1(URL, {method: 'POST', body: {}, headers: {Origin: 'https://evil.example'}})).status, 403, 'another site: 403');
  eq((await session.rep1(URL)).status, 405, 'GET: 405');
  eq((await session.rep1(URL, {method: 'PUT', body: {}})).status, 405, 'PUT: 405');
  for (const who of ['cs', 'csm']) await move(who, [item('1')], T, {}, 403);
  await app.db.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('rep3',?,'[]',2,'owner',?)").bind(JSON.stringify({'plans:add': false}), now).run();
  eq((await move('rep3', [item('team3')], T, {}, 403)).error, 'غير مسموح لك بالإضافة في خطط المناديب. راجع مدير النظام.', '«إعداد خطة اليوم» switched off: 403 with its words');
  await app.db.prepare("DELETE FROM crm_member_permissions WHERE member_id='rep3'").run();
  // The limits.
  eq((await move('rep1', Array.from({length: 201}, (_, i) => ({id: 'x' + i, version: 1})), T, {}, 400)).error, 'اختر من متابعة واحدة إلى 200 متابعة في الطلب الواحد.', '201 items: 400');
  eq((await move('rep1', [item('1')], addDays(T, -1), {}, 400)).error, 'لا يمكن ترحيل المتابعات إلى تاريخ مضى.', 'yesterday: 400');
  eq((await move('rep1', [item('1')], addDays(T, 31), {}, 400)).error, 'يمكن ترحيل المتابعات حتى 30 يومًا من اليوم فقط.', '31 days: 400');
  await move('rep1', [item('1')], T, {offline: {memberId: 'rep1', capturedAt: now}}, 400);
  // Each item answered: own moved (30 days ahead), another's not_found, won closed; 200 at once.
  let answer = await move('rep1', [item('1'), item('other'), item('won'), ...Array.from({length: 197}, (_, i) => ({id: 'nothing-' + i, version: 1}))], addDays(T, 30), {purpose: 'reschedule'});
  eq([answer.results.length, statuses(answer).slice(0, 3), answer.moved, await nextOf('1')], [200, [['1', 'moved'], ['other', 'not_found'], ['won', 'closed']], 1, addDays(T, 30)], '200 items: one answer each; 30 days ahead accepted');
  // A request repeated after a cut connection: the same answer from the receipts, nothing written twice; the same number with another body: 409.
  const body = {request_id: crypto.randomUUID(), next_date: addDays(T, 1), items: [item('2'), item('3')], purpose: 'plan', plan_date: addDays(T, 1)};
  eq(statuses(await json(await session.rep1(URL, {method: 'POST', body}), 200, 'first')), [['2', 'moved'], ['3', 'moved']], 'moved');
  answer = await json(await session.rep1(URL, {method: 'POST', body}), 200, 'repeated');
  eq([answer.results.map(result => [result.status, result.replayed]), Number((await app.db.prepare("SELECT COUNT(*) n FROM crm_audit WHERE record_id='fu-2' AND action='ترحيل موعد المتابعة'").first()).n)], [[['moved', true], ['moved', true]], 1], 'repeated: answered from the receipts, one audit line');
  eq((await json(await session.rep1(URL, {method: 'POST', body: {...body, next_date: addDays(T, 2)}}), 409, 'reused')).error, 'أُرسل هذا الطلب من قبل ببيانات مختلفة؛ حدّث الصفحة ثم أعد المحاولة.', 'the same number with another date: 409');
  eq(statuses(await move('rep1', [item('2', 1)], addDays(T, 3))), [['2', 'conflict']], 'a stale version: conflict');
  // The team: the supervisor his, another supervisor not_found, a suspended representative's customer unassigned, the administrator.
  eq(statuses(await move('sup', [item('team3'), item('gone')], T)), [['team3', 'moved'], ['gone', 'unassigned']], 'the supervisor: his team; a suspended owner');
  eq(statuses(await move('sup2', [item('team3', 2)], addDays(T, 1))), [['team3', 'not_found']], 'another team: not_found');
  eq(statuses(await move('owner', [item('team3', 2)], addDays(T, 1))), [['team3', 'moved']], 'the administrator');
  // POST /api/daily-plans: a page older than the targets; a plan with its targets; follow-ups only; the supervisor's targets.
  const P = addDays(T, 1);
  const plan = async (who, data, status = 200) => json(await session[who]('/api/daily-plans', {method: 'POST', body: {requestId: crypto.randomUUID(), ...data}}), status, 'POST plan as ' + who);
  eq((await plan('rep1', {action: 'send', date: P, stops: [{customerId: 'cust-2', kind: 'visit', time: '', note: ''}], baseVersion: null}, 409)).error, 'حُدّث التطبيق؛ أعد تحميل الصفحة.', 'a page without the targets: 409');
  eq((await plan('rep1', {action: 'send', date: P, stops: [{customerId: 'free', kind: 'visit', time: '', note: ''}], baseVersion: null, targets: {opportunities: 1, customers: 1}}, 400)).error, 'تُضاف إلى الخطة المتابعات فقط؛ لم تعد إضافة عميل دون متابعة إلى الخطة متاحة.', 'a customer without a follow-up: 400');
  eq((await plan('rep1', {action: 'send', date: P, stops: [], baseVersion: null, targets: {opportunities: 51, customers: 0}}, 400)).error, 'المستهدف عدد صحيح من 0 إلى 50.', '51: 400');
  let sent = (await plan('rep1', {action: 'send', date: P, stops: [{customerId: 'cust-2', kind: 'visit', time: '', note: ''}], baseVersion: null, targets: {opportunities: '٢', customers: 1}})).plan;
  eq([sent.state, sent.targets, sent.targetsEdited], ['sent', {opportunities: 2, customers: 1}, false], 'sent with its targets (Arabic digits read)');
  sent = (await plan('sup', {action: 'approve_edited', memberId: 'rep1', date: P, baseVersion: 1, stops: sent.stops.map(stop => ({id: stop.id, customerId: stop.customerId, kind: stop.kind, time: stop.time, note: stop.note})), targets: {opportunities: 4, customers: 1}})).plan;
  eq([sent.state, sent.targets, sent.targetsEdited, sent.repTargets], ['approved_edited', {opportunities: 4, customers: 1}, true, {opportunities: 2, customers: 1}], 'the supervisor\'s targets, marked');
  const returned = (await plan('sup', {action: 'return', memberId: 'rep1', date: P, baseVersion: 2, reason: 'أضف متابعة أخرى'})).plan;
  eq((await plan('rep1', {action: 'send', date: P, stops: returned.stops.map(stop => ({id: stop.id, customerId: stop.customerId, kind: stop.kind, time: stop.time, note: stop.note})), baseVersion: 3, targets: {opportunities: 2, customers: 1}}, 403)).error, 'عدّل المشرف المستهدف؛ لا يمكن تغييره.', 'the representative cannot change it back: 403');
  const read = await json(await session.sup('/api/daily-plans?' + new URLSearchParams({date: P, memberId: 'rep1'})), 200, 'the supervisor reads the plan');
  eq([read.bulkMoves.map(move => [move.customerId, move.to]).sort(), read.actual], [[['cust-2', P], ['cust-3', P]], null], '«ترحيل جماعي» of the plan\'s day; no achieved numbers before it');
  const row = (await json(await session.sup('/api/daily-plans?date=' + P), 200, 'the list')).rows.find(item => item.memberId === 'rep1');
  eq([row.bulkMoves, row.targets, row.targetsEdited], [2, {opportunities: 4, customers: 1}, true], 'the list row');
  // GET /api/crm without the moves.
  const snapshot = await json(await session.owner('/api/crm'), 200, 'GET /api/crm');
  eq(snapshot.audits.filter(item => item.action === 'ترحيل موعد المتابعة' || String(item.action).startsWith('followup-next-dates')).length, 0, 'no move in the changes list');
} finally {
  await app.stop();
}
console.log(JSON.stringify({ok: true, checks}));
