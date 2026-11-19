// «خطة الغد» / «خطط المناديب» (lib/daily-plans*.ts, migration 0022) over real HTTP against the BUILT release (`npm run build` first), its clock
// set to a Wednesday at 23:00 Riyadh (scripts/lib/shifted-clock.mjs), after the 22:00 deadline of Thursday's plan: every route with no
// session (401), with a role that has no right (customer service 403, another team 403, a representative reviewing 403, a hidden screen 404,
// a switched-off cell 403 with its words) and with the right role; a representative's plan sent now is late, a marketing officer's made on
// the device at 21:45 is on time by the device's clock; a send repeated after a cut connection writes nothing twice; a stale version is 409;
// the supervisor approves, approves with edits, returns, and the representative cannot delete or change the supervisor's stops; the sales
// manager takes part; one note per reviewer and day; the export; the reminder cards; GET /api/crm without the plans' audit rows, and the
// day report and the notes of the previous releases answering as before. Synthetic fixtures only: temporary SQLite, mocked mail.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'},
  {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', region: 'eastern', name: 'المشرف سالم'},
  {id: 'sup2', role: 'supervisor', sup: 'mgr', region: 'eastern', name: 'مشرف آخر'},
  {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'},
  {id: 'mk1', role: 'marketing', sup: 'sup', region: 'eastern', name: 'مسؤول التسويق'},
  {id: 'rep2', role: 'rep', sup: 'sup2', region: 'eastern', name: 'مندوب فريق آخر'},
  {id: 'csm', role: 'customer_service_manager', name: 'مدير خدمة العملاء'},
  {id: 'cs', role: 'customer_service', sup: 'csm', name: 'ممثل خدمة العملاء'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
// The server's Wednesday 23:00 Riyadh of this week or the next (a day whose next day is a working Thursday).
const riyadh = at => new Date(at + 3 * 3600000).toISOString().slice(0, 10);
let wednesday = Date.parse(riyadh(Date.now()) + 'T20:00:00.000Z');
while (new Date(wednesday).getUTCDay() !== 3 || wednesday < Date.now()) wednesday += 86400000;
const offset = wednesday - Date.now(), W = riyadh(wednesday - 3600000), D = riyadh(wednesday + 12 * 3600000);
const app = await bootBuiltApp({members}, {env: {NODE_OPTIONS: '--import ' + new URL('../scripts/lib/shifted-clock.mjs', import.meta.url).href, TEST_CLOCK_OFFSET_MS: String(offset)}});
try {
  const now = new Date().toISOString();
  const insert = (id, kind, parent, assigned, data) => app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id, kind, parent, assigned, 'الرئيسي', JSON.stringify(data), now, now).run();
  for (const [id, name] of [['c1', 'مصنع الشرق'], ['c2', 'مصنع الخليج'], ['c3', 'مصنع الدمام']]) await insert(id, 'customer', null, 'rep1', {name, region: 'الشرقية', city: 'الدمام', location: '26.43, 50.03'});
  await insert('cW', 'customer', null, 'rep1', {name: 'مصنع الغرب', region: 'الغربية', city: 'جدة', location: '21.5, 39.2'});
  const session = {};
  for (const member of members) session[member.id] = app.as(await app.login(member.id));
  const anonymous = app.as(null);
  const json = async (response, status, label) => { eq(response.status, status, label + ' -> ' + response.text.slice(0, 300)); return response.json(); };
  const get = async (who, query, status = 200) => json(await session[who]('/api/daily-plans?' + new URLSearchParams(query)), status, 'GET ' + JSON.stringify(query) + ' as ' + who);
  const post = async (who, body, status = 200) => json(await session[who]('/api/daily-plans', {method: 'POST', body: {requestId: crypto.randomUUID(), ...body}}), status, 'POST ' + body.action + ' as ' + who);
  const inbox = async who => json(await session[who]('/api/daily-plans/inbox'), 200, 'inbox of ' + who);
  const stop = (customerId, kind = 'visit', extra = {}) => ({customerId, kind, time: '', note: '', ...extra});
  const wire = item => ({id: item.id, customerId: item.customerId, kind: item.kind, time: item.time, note: item.note});

  // No session: 401 on every route, the verify routes of the package included.
  for (const url of ['/api/daily-plans?date=' + D, '/api/daily-plans', '/api/daily-plans/inbox']) eq((await anonymous(url)).status, 401, 'anonymous GET ' + url);
  for (const body of [{}, {action: 'send', date: D, stops: [stop('c1')], baseVersion: null, requestId: crypto.randomUUID()}]) eq((await anonymous('/api/daily-plans', {method: 'POST', body})).status, 401, 'anonymous POST');
  eq((await session.rep1('/api/daily-plans', {method: 'POST', body: {action: 'send'}, headers: {Origin: 'https://evil.example'}})).status, 403, 'another origin');
  // Customer service: no plans at all.
  for (const who of ['cs', 'csm']) { await get(who, {date: D}, 403); await post(who, {action: 'send', date: D, stops: [stop('c1')], baseVersion: null}, 403); eq((await inbox(who)).role, 'none', who + ' has no card'); }
  // The representative's plan, sent at 23:00: accepted and late.
  eq((await get('rep1', {date: D})).state, 'missing', 'nothing yet');
  eq((await inbox('rep1')).next, {date: D, state: 'missing', late: false, deadline: new Date(Date.parse(W + 'T19:00:00.000Z')).toISOString(), version: null, returnReason: '', reviewedByName: ''}, 'the card: Thursday\'s plan missing, past its deadline');
  await post('rep1', {action: 'send', date: D, stops: [stop('cW')], baseVersion: null}, 403);
  const requestId = crypto.randomUUID(), stops = [stop('c1'), stop('c2', 'call', {time: '10:00', note: 'عرض السعر'})];
  let plan = (await post('rep1', {action: 'send', date: D, stops, baseVersion: null, requestId})).plan;
  eq([plan.state, plan.version, plan.late, plan.firstSentSource, plan.stops.map(item => [item.customerName, item.kind])], ['sent', 1, true, 'server', [['مصنع الشرق', 'visit'], ['مصنع الخليج', 'call']]], 'sent after 22:00: accepted and marked late');
  // The same send again (an answer lost on a cut connection): the same plan, nothing written twice.
  eq((await post('rep1', {action: 'send', date: D, stops, baseVersion: null, requestId})).plan.version, 1, 'the repeated send answers from its receipt');
  eq(Number((await app.db.prepare("SELECT COUNT(*) n FROM crm_audit WHERE action='daily-plan:send'").first()).n), 1, 'one send written');
  eq(Number((await app.db.prepare('SELECT COUNT(*) n FROM crm_daily_plan_stops').first()).n), 2, 'two stops, not four');
  await post('rep1', {action: 'send', date: D, stops, baseVersion: null}, 409);
  // The marketing officer's plan made on the device at 21:45 and received now: on time by the device's clock.
  const captured = new Date(Date.parse(W + 'T18:45:00.000Z')).toISOString();
  await post('mk1', {action: 'send', date: D, stops: [stop('c3', 'whatsapp')], baseVersion: null, offline: {memberId: 'rep1', capturedAt: captured}}, 403);
  plan = (await post('mk1', {action: 'send', date: D, stops: [stop('c3', 'whatsapp')], baseVersion: null, offline: {memberId: 'mk1', capturedAt: captured}})).plan;
  eq([plan.late, plan.firstSentAt, plan.firstSentSource], [false, captured, 'device'], 'on time by the device\'s clock');
  // Who reads whom.
  for (const who of ['sup', 'mgr', 'owner']) eq((await get(who, {date: D, memberId: 'rep1'})).state, 'sent', who + ' reads it');
  await get('sup2', {date: D, memberId: 'rep1'}, 403); await get('rep2', {date: D, memberId: 'rep1'}, 403);
  eq((await get('sup', {date: D})).rows.map(row => [row.memberId, row.state, row.late]), [['rep1', 'sent', true], ['mk1', 'sent', false]], 'the supervisor\'s list');
  eq((await get('owner', {date: D})).rows.length, 3, 'the administrator: every field member');
  const card = await inbox('sup');
  eq([card.role, card.pending.map(item => item.memberId).sort()], ['reviewer', ['mk1', 'rep1']], 'the supervisor\'s card lists both plans');
  // Reviewing: not a representative, not another team; a stale version; approve; the sales manager takes part.
  await post('rep2', {action: 'approve', memberId: 'rep1', date: D, baseVersion: 1}, 403);
  await post('sup2', {action: 'approve', memberId: 'rep1', date: D, baseVersion: 1}, 403);
  plan = (await post('sup', {action: 'approve', memberId: 'rep1', date: D, baseVersion: 1})).plan;
  eq([plan.state, plan.version, plan.reviewedByName], ['approved', 2, 'المشرف سالم'], 'approved by the supervisor');
  await post('sup', {action: 'approve', memberId: 'rep1', date: D, baseVersion: 1}, 409);
  plan = (await post('mgr', {action: 'approve', memberId: 'mk1', date: D, baseVersion: 1})).plan;
  eq([plan.state, plan.reviewedByName], ['approved', 'مدير المبيعات'], 'the sales manager may approve too');
  // Approve with edits, then return: the representative cannot delete or change the supervisor's stops.
  const current = await get('sup', {date: D, memberId: 'rep1'});
  plan = (await post('sup', {action: 'approve_edited', memberId: 'rep1', date: D, baseVersion: 2, stops: [wire(current.stops[0]), {customerId: 'c3', kind: 'call', time: '11:00', note: 'اتصل بالمدير'}]})).plan;
  eq(plan.stops.map(item => [item.customerId, item.supervisorState]), [['c1', ''], ['c3', 'added'], ['c2', 'removed']], 'the edits apply at once');
  await post('sup', {action: 'return', memberId: 'rep1', date: D, baseVersion: 3, reason: 'لا'}, 400);
  plan = (await post('sup', {action: 'return', memberId: 'rep1', date: D, baseVersion: 3, reason: 'أضف عميلًا جديدًا'})).plan;
  eq([plan.state, plan.returnReason], ['returned', 'أضف عميلًا جديدًا'], 'returned with the reason');
  const mine = await get('rep1', {date: D}), added = mine.stops.find(item => item.supervisorState === 'added'), own = mine.stops.find(item => !item.supervisorState);
  eq((await post('rep1', {action: 'send', date: D, stops: [wire(own)], baseVersion: 4}, 403)).error, 'لا يمكنك حذف محطة أضافها المشرف أو عدّلها، ولا تغييرها.', 'deleting the supervisor\'s stop is refused');
  await post('rep1', {action: 'send', date: D, stops: [wire(own), {...wire(added), time: '12:00'}], baseVersion: 4}, 403);
  plan = (await post('rep1', {action: 'send', date: D, stops: [wire(added), wire(own), stop('c2', 'whatsapp')], baseVersion: 4})).plan;
  eq([plan.state, plan.late, plan.stops.map(item => [item.customerId, item.supervisorState])], ['sent', true, [['c3', 'added'], ['c1', ''], ['c2', ''], ['c2', 'removed']]], 'sent again with the supervisor\'s stop kept');
  // The note: one per reviewer and day.
  await post('sup', {action: 'note', memberId: 'rep1', date: D, note: 'خطة متوازنة', noteVersion: null});
  await post('sup', {action: 'note', memberId: 'rep1', date: D, note: 'ثانية', noteVersion: null}, 409);
  eq((await get('rep1', {date: D})).notes.map(item => item.note), ['خطة متوازنة'], 'the representative reads it');
  // The export: the supervisor's team; a field member none.
  const exported = await get('sup', {from: D, to: D});
  eq(exported.plans.map(item => [item.memberId, item.state]).sort(), [['mk1', 'approved'], ['rep1', 'sent']], 'the export of the day');
  await get('rep1', {from: D, to: D}, 403); await get('sup', {from: D, to: '2099-01-01'}, 400);
  // A switched-off cell and a hidden screen.
  await app.db.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('sup',?,'[]',2,'owner',?)").bind(JSON.stringify({'plans:edit': false}), now).run();
  eq((await post('sup', {action: 'approve', memberId: 'rep1', date: D, baseVersion: 5}, 403)).error, 'غير مسموح لك بالتعديل في خطط المناديب. راجع مدير النظام.', '«مراجعة خطط المناديب» switched off');
  await app.db.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('rep2','{}',?,2,'owner',?)").bind(JSON.stringify(['plans']), now).run();
  await get('rep2', {date: D}, 404); await post('rep2', {action: 'send', date: D, stops: [stop('c1')], baseVersion: null}, 404);
  eq((await inbox('rep2')).role, 'none', 'no card for a hidden screen');
  // The previous releases' routes answer as before, and the recent changes carry no plan.
  const snapshot = await json(await session.owner('/api/crm'), 200, 'GET /api/crm');
  eq(snapshot.audits.filter(item => String(item.action).startsWith('daily-plan:')).length, 0, 'no plan in the recent changes');
  eq((await app.db.prepare("SELECT action FROM crm_audit WHERE action LIKE 'daily-plan:%' ORDER BY created_at,rowid").all()).results.map(row => row.action), ['daily-plan:send', 'daily-plan:send', 'daily-plan:approve', 'daily-plan:approve', 'daily-plan:approve_edited', 'daily-plan:return', 'daily-plan:send', 'daily-plan:note'], 'every plan write audited once, refusals none');
  eq((await session.sup2('/api/journeys?date=' + W + '&memberId=rep2')).status, 200, 'the day report answers as before');
  eq((await session.sup2('/api/reviews?date=' + W + '&memberId=rep2')).status, 200, 'and its notes');
  eq((await session.rep1('/api/review-inbox')).status, 200, 'and the notes card');
  console.log(JSON.stringify({ok: true, checks}));
} finally {
  await app.stop();
}
