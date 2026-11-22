// The daily plan after the port of GSCO 2.13.86 (2026-11-22) over real HTTP against the BUILT release (`npm run build` first), three boots
// of it with the server's clock shifted (scripts/lib/shifted-clock.mjs) around the midnight that begins a Thursday's plan:
// - Wednesday 23:30 Riyadh: a plan sent now is on time; the sales manager approves it with edits, each marked as theirs and written in the
//   review's audit line; the supervisor may no longer change the sales manager's stop (400) nor return the plan (409), and still approves
//   another plan before midnight; the supervisor's card hears of the sales manager's change, the sales manager's card never of their own; a
//   decision sent again after a cut connection writes nothing twice;
// - Thursday 00:30: a plan sent now is late and «غير معتمدة»; the supervisor's approve, edit and return answer 409 with their words (the note
//   stays open); the sales manager approves until the day ends; a send made on the device at Wednesday 23:30 is on time by the device's clock;
// - Thursday 02:30: a send made on the device at Wednesday 23:30 arrives more than two hours after midnight: the receipt, late; the day before's
//   plan is closed to the sales manager too (409).
// Every route with no session (401) and a role that has none (customer service 403). Synthetic fixtures only: temporary SQLite, mocked mail.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'},
  {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', region: 'eastern', name: 'المشرف سالم'},
  {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'},
  {id: 'mk1', role: 'marketing', sup: 'sup', region: 'eastern', name: 'مسؤول التسويق'},
  {id: 'cs', role: 'customer_service', name: 'ممثل خدمة العملاء'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const riyadh = at => new Date(at + 3 * 3600000).toISOString().slice(0, 10);
// The coming Wednesday 23:30 Riyadh (20:30 UTC): the plan of the Thursday after it is due at Thursday 00:00 (21:00 UTC).
let wednesday = Date.parse(riyadh(Date.now()) + 'T20:30:00.000Z');
while (new Date(wednesday).getUTCDay() !== 3 || wednesday < Date.now()) wednesday += 86400000;
const W = riyadh(wednesday), D = riyadh(wednesday + 6 * 3600000), deadline = new Date(wednesday + 30 * 60000).toISOString();
const messages = {
  closed: 'انتهت مهلة المشرف لاعتماد الخطة أو تعديلها أو إعادتها عند الساعة 12:00 منتصف الليل؛ تبقى الخطة «غير معتمدة»، ويتصرف فيها مدير المبيعات وحده حتى نهاية يومها.',
  stopFixed: 'أضاف مدير المبيعات هذه المحطة أو عدّلها؛ لا يمكن للمشرف تغييرها أو حذفها.',
  decided: 'اعتمد مدير المبيعات هذه الخطة أو عدّلها أو أعادها؛ القرار له، ولا يمكن للمشرف إعادتها إلى المندوب.',
  past: 'انتهى يوم هذه الخطة؛ لا يمكن تعديلها.'
};

async function bootAt(at, run) {
  const app = await bootBuiltApp({members}, {env: {NODE_OPTIONS: '--import ' + new URL('../scripts/lib/shifted-clock.mjs', import.meta.url).href, TEST_CLOCK_OFFSET_MS: String(at - Date.now())}});
  try {
    const stamp = new Date().toISOString(), earlier = new Date(Date.parse(stamp) - 3 * 86400000).toISOString();
    const insert = (id, kind, parent, owner, data, when = stamp) => app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id, kind, parent, owner, 'الرئيسي', JSON.stringify(data), when, when).run();
    for (const [id, owner] of [['c1', 'rep1'], ['c2', 'rep1'], ['c3', 'rep1'], ['c4', 'rep1'], ['m1', 'mk1'], ['m2', 'mk1']]) {
      await insert(id, 'customer', null, owner, {name: 'مصنع ' + id, region: 'الشرقية', city: 'الدمام', location: '26.43, 50.03'});
      await insert('f-' + id, 'activity', id, owner, {type: 'call', date: earlier.slice(0, 10), summary: 'متابعة سابقة', result: 'تمت', performedBy: owner, responsibleId: owner, nextAction: 'متابعة العرض', nextDate: D, visitWorkflow: 'customer-v1'}, earlier);
    }
    const session = {};
    for (const member of members) session[member.id] = app.as(await app.login(member.id));
    const json = async (response, status, label) => { eq(response.status, status, label + ' -> ' + response.text.slice(0, 300)); return response.json(); };
    const get = async (who, query, status = 200) => json(await session[who]('/api/daily-plans?' + new URLSearchParams(query)), status, 'GET ' + JSON.stringify(query) + ' as ' + who);
    const post = async (who, body, status = 200) => json(await session[who]('/api/daily-plans', {method: 'POST', body: {requestId: crypto.randomUUID(), ...(['save', 'send'].includes(body.action) && !('targets' in body) ? {targets: {opportunities: 1, customers: 1}} : {}), ...body}}), status, 'POST ' + body.action + ' as ' + who);
    const inbox = async who => json(await session[who]('/api/daily-plans/inbox'), 200, 'inbox of ' + who);
    const stop = (customerId, kind = 'visit', extra = {}) => ({customerId, kind, time: '', note: '', ...extra});
    const wire = item => ({id: item.id, customerId: item.customerId, kind: item.kind, time: item.time, note: item.note});
    // No session, and customer service: refused before anything is read.
    const anonymous = app.as(null);
    for (const url of ['/api/daily-plans?date=' + D, '/api/daily-plans/inbox']) eq((await anonymous(url)).status, 401, 'anonymous GET ' + url);
    eq((await anonymous('/api/daily-plans', {method: 'POST', body: {action: 'approve', memberId: 'rep1', date: D, baseVersion: 1, requestId: crypto.randomUUID()}})).status, 401, 'anonymous POST');
    await post('cs', {action: 'approve', memberId: 'rep1', date: D, baseVersion: 1}, 403);
    await run({app, get, post, inbox, stop, wire});
  } finally {
    await app.stop();
  }
}

// ---- Wednesday 23:30: before midnight.
await bootAt(wednesday, async ({app, get, post, inbox, stop, wire}) => {
  let plan = (await post('rep1', {action: 'send', date: D, stops: [stop('c1'), stop('c2', 'call'), stop('c3')], baseVersion: null})).plan;
  eq([plan.state, plan.late, plan.deadline, plan.unapproved, plan.reviewClosed], ['sent', false, deadline, false, false], 'sent at 23:30: on time, due at the midnight that begins Thursday');
  await post('mk1', {action: 'send', date: D, stops: [stop('m1')], baseVersion: null});
  const current = await get('mgr', {date: D, memberId: 'rep1'});
  eq([current.salesManager, current.canApprove, current.canReviewEdit, current.canReturn], [true, true, true, true], 'the sales manager may act');
  const [c1, c2] = current.stops, requestId = crypto.randomUUID();
  const body = {action: 'approve_edited', memberId: 'rep1', date: D, baseVersion: current.version, stops: [{...wire(c1), time: '09:00'}, wire(c2), stop('c4', 'call')], targets: {opportunities: 2, customers: 1}, requestId};
  plan = (await post('mgr', body)).plan;
  eq([plan.state, plan.stops.map(item => [item.customerId, item.mark ? item.mark.by + ':' + item.mark.kind : null]), plan.targetsEditedBy, plan.managerEdit.decision], ['approved_edited', [['c1', 'manager:edited'], ['c2', null], ['c4', 'manager:added'], ['c3', 'manager:removed']], 'manager', 'approve'], 'the sales manager\'s edits, each marked as theirs');
  eq((await post('mgr', body)).plan.version, plan.version, 'the same decision sent again (a cut connection): answered from its receipt');
  eq(Number((await app.db.prepare("SELECT COUNT(*) n FROM crm_audit WHERE action='daily-plan:approve_edited'").first()).n), 1, 'written once');
  eq({...(await app.db.prepare("SELECT json_extract(detail,'$.after.edits.by') AS who,json_extract(detail,'$.after.edits.byId') AS id,json_extract(detail,'$.after.edits.targets') AS targets FROM crm_audit WHERE action='daily-plan:approve_edited'").first())}, {who: 'manager', id: 'mgr', targets: 1}, 'the audit line names who decided');
  const seen = await get('sup', {date: D, memberId: 'rep1'});
  eq([seen.canReviewEdit, seen.canReturn, seen.managerDecided, seen.salesManager], [true, false, true, false], 'the supervisor may still edit before midnight, never return what the sales manager decided');
  const live = seen.stops.filter(item => item.supervisorState !== 'removed');
  eq((await post('sup', {action: 'approve_edited', memberId: 'rep1', date: D, baseVersion: seen.version, stops: live.map(item => item.customerId === 'c1' ? {...wire(item), time: '11:00'} : wire(item))}, 400)).error, messages.stopFixed, 'changing the sales manager\'s stop: 400');
  eq((await post('sup', {action: 'return', memberId: 'rep1', date: D, baseVersion: seen.version, reason: 'راجع الترتيب'}, 409)).error, messages.decided, 'returning it: 409');
  eq((await post('sup', {action: 'approve', memberId: 'mk1', date: D, baseVersion: 1})).plan.state, 'approved', 'the supervisor approves another plan before midnight');
  const card = await inbox('sup');
  eq([card.salesManager, card.edits.map(item => [item.memberId, item.date, item.decision, item.byName])], [false, [['rep1', D, 'approve', 'مدير المبيعات']]], 'the supervisor\'s card hears of the sales manager\'s change');
  const mine = await inbox('mgr');
  eq([mine.salesManager, mine.edits], [true, []], 'the sales manager\'s card: never their own change');
  eq((await inbox('rep1')).next.state, 'approved_edited', 'the member\'s card: tomorrow\'s plan approved with edits');
});

// ---- Thursday 00:30: the plan's day has begun.
await bootAt(wednesday + 3600000, async ({get, post, inbox, stop}) => {
  let plan = (await post('rep1', {action: 'send', date: D, stops: [stop('c1')], baseVersion: null})).plan;
  eq([plan.late, plan.unapproved, plan.reviewClosed], [true, true, true], 'sent at 00:30: late, and «غير معتمدة»');
  const captured = new Date(wednesday).toISOString();
  plan = (await post('mk1', {action: 'send', date: D, stops: [stop('m1')], baseVersion: null, offline: {memberId: 'mk1', capturedAt: captured}})).plan;
  eq([plan.late, plan.firstSentAt, plan.firstSentSource], [false, captured, 'device'], 'made on the device at Wednesday 23:30, received at 00:30: on time by the device\'s clock');
  const seen = await get('sup', {date: D, memberId: 'rep1'});
  eq([seen.unapproved, seen.reviewClosed, seen.canApprove, seen.canReviewEdit, seen.canReturn, seen.canNote], [true, true, false, false, false, true], 'the supervisor: «غير معتمدة», nothing to decide, the note open');
  for (const [action, extra] of [['approve', {}], ['approve_edited', {stops: [{id: seen.stops[0].id, customerId: 'c1', kind: 'call', time: '', note: ''}]}], ['return', {reason: 'تأخرت في الإرسال'}]])
    eq((await post('sup', {action, memberId: 'rep1', date: D, baseVersion: seen.version, ...extra}, 409)).error, messages.closed, 'the supervisor\'s ' + action + ' after midnight: 409');
  eq((await post('sup', {action: 'note', memberId: 'rep1', date: D, note: 'نفّذها كما أرسلتها', noteVersion: null})).plan.myNote.note, 'نفّذها كما أرسلتها', 'the note stays open');
  eq((await get('sup', {date: D})).rows.map(row => [row.memberId, row.unapproved]).sort(), [['mk1', true], ['rep1', true]], 'the supervisor\'s list: «غير معتمدة»');
  eq((await inbox('sup')).pending, [], 'nothing waits for the supervisor any more');
  eq((await inbox('mgr')).pending.map(item => item.memberId).sort(), ['mk1', 'rep1'], 'both wait for the sales manager');
  plan = (await post('mgr', {action: 'approve', memberId: 'rep1', date: D, baseVersion: seen.version})).plan;
  eq([plan.state, plan.unapproved, plan.reviewedByName], ['approved', false, 'مدير المبيعات'], 'the sales manager approves on the plan\'s day');
});

// ---- Thursday 02:30: two hours past midnight.
await bootAt(wednesday + 3 * 3600000, async ({app, post, stop}) => {
  const captured = new Date(wednesday).toISOString();
  let plan = (await post('rep1', {action: 'send', date: D, stops: [stop('c1')], baseVersion: null, offline: {memberId: 'rep1', capturedAt: captured}})).plan;
  eq([plan.late, plan.firstSentSource], [true, 'server'], 'made on the device at Wednesday 23:30, received at 02:30: the receipt, late');
  const afterMidnight = new Date(wednesday + 31 * 60000).toISOString();
  plan = (await post('mk1', {action: 'send', date: D, stops: [stop('m1')], baseVersion: null, offline: {memberId: 'mk1', capturedAt: afterMidnight}})).plan;
  eq([plan.late, plan.firstSentAt, plan.firstSentSource], [true, afterMidnight, 'device'], 'made on the device at 00:01: the device\'s time, late');
  // The day before's plan is closed to the sales manager too.
  const now = new Date().toISOString();
  await app.db.prepare("INSERT INTO crm_daily_plans(id,member_id,date,status,version,first_sent_at,first_sent_source,late,sent_at,received_at,reviewed_by,reviewed_at,return_reason,mutation_id,created_at,updated_at) VALUES(?,'rep1',?,'sent',1,?,'server',0,?,?,NULL,NULL,'','synthetic',?,?)").bind('daily-plan:rep1:' + W, W, now, now, now, now, now).run();
  eq((await post('mgr', {action: 'approve', memberId: 'rep1', date: W, baseVersion: 1}, 409)).error, messages.past, 'the day before\'s plan: 409 for the sales manager too');
});
console.log(JSON.stringify({ok: true, checks, wednesday: W, plan: D}));
