// The customer-service evaluation over real HTTP against the BUILT release (run `pnpm build` first): who may read a month and
// what each reader gets, the figures from complaints, assistance and service requests read out of the database (the same company
// as tests/service-kpi.mjs, so the hand-computed numbers are checked end to end), the settings an administrator saves, the audits
// a manager records and deletes, closing a month for a team and reopening it, the customer's rating entered with a complaint's
// closure, and that none of it leaks into the record lists or the history. Synthetic isolated fixtures only: temporary SQLite,
// mocked sendmail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'}, {id: 'sup', role: 'supervisor', sup: 'sm'}, {id: 'rep', role: 'rep', sup: 'sup'},
  {id: 'csm', role: 'customer_service_manager', sup: 'sm'}, {id: 'csm2', role: 'customer_service_manager', sup: 'sm'}, {id: 'csm3', role: 'customer_service_manager', branch: 'فرع آخر'},
  {id: 'cs1', role: 'customer_service', sup: 'csm'}, {id: 'cs2', role: 'customer_service', sup: 'csm'}, {id: 'cs_idle', role: 'customer_service', sup: 'csm'},
  {id: 'cs3', role: 'customer_service', sup: 'csm2'}, {id: 'cs_left', role: 'customer_service', sup: 'csm2'}, {id: 'cs_gone', role: 'customer_service', sup: 'csm2'},
  {id: 'cs_free', role: 'customer_service'}
];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const r1 = value => value === null ? null : Math.round(value * 10) / 10;
const app = await bootBuiltApp({members});
try {
  await app.db.prepare("UPDATE crm_members SET active=0 WHERE id IN ('cs_left','cs_gone')").run();
  const sessions = {};
  for (const member of members.filter(m => !['cs_left', 'cs_gone'].includes(m.id))) sessions[member.id] = await app.login(member.id);
  const as = id => app.as(sessions[id]);
  const kpi = (id, month = '2026-09', extra = '') => as(id)('/api/service-kpi?month=' + month + extra);
  const post = (id, body) => as(id)('/api/service-kpi', {method: 'POST', body: {requestId: crypto.randomUUID(), ...body}});
  const count = async () => JSON.stringify(await app.db.prepare('SELECT count(*) AS n,max(updated_at) AS u,sum(version) AS v FROM crm_records').first());
  const row = async id => { const found = await app.db.prepare('SELECT kind,parent_id,assigned_to,branch,data,version FROM crm_records WHERE id=?').bind(id).first(); return found && {...found, data: JSON.parse(found.data)}; };

  // ---- fixtures: the company of tests/service-kpi.mjs, in September 2026 (Riyadh is UTC+3; the 6th is a Sunday)
  const stamp = '2026-08-01T05:00:00.000Z';
  const customer = (id, region = 'الشرقية', branch = 'الرئيسي') => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'rep',?,?,?,?,1,'fixture')")
    .bind(id, branch, JSON.stringify({name: 'مصنع ' + id, region, city: 'الدمام', phone: '0500000000', contact: 'PRIVATE-CONTACT', code: id, branch, assignedTo: 'rep'}), stamp, stamp).run();
  for (const id of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c11']) await customer(id);
  await customer('c10', 'الشرقية', 'فرع آخر');
  const pad = n => String(n).padStart(2, '0');
  const T = (day, hour) => `2026-09-${pad(day)}T${pad(hour)}:00:00.000Z`;
  const complaint = async (id, customerId, registrar, events, extra = {}) => {
    const list = events.map(([at, by, action, more]) => ({at, by, action, ...(more || {})}));
    const data = {kind: 'complaint', status: 'assigned', customerId, registrarId: registrar, serviceManagerId: 'csm', salesManagerId: '', supervisorId: '', assigneeId: '', channel: 'call', category: 'product_quality', severity: 'normal',
      description: 'PRIVATE-DESCRIPTION', demand: 'PRIVATE-DEMAND', reference: 'PRIVATE-REFERENCE', contactName: 'PRIVATE-NAME', contactPhone: 'PRIVATE-PHONE', submittedAt: list[0].at, forwardedAt: '', returnedAt: '', assignedAt: '', delegatedAt: '', reassignedAt: '', rejectedAt: '', reopenedAt: '', resolvedAt: '', closedAt: '', cancelledAt: '', seenAt: '',
      returnNote: '', assignmentNote: '', rejectReason: '', cancelReason: '', previousAssignees: [], updates: [{id: 'u1', at: list[0].at, by: 'rep', channel: 'call', date: '2026-09-06', text: 'PRIVATE-UPDATE'}], notes: [], events: list, ...extra};
    await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'complaint',NULL,?,'الرئيسي',?,?,?,1,'fixture')").bind('complaint-' + id, registrar, JSON.stringify(data), list[0].at, list.at(-1).at).run();
  };
  await complaint('A', 'c1', 'cs1', [[T(6, 5), 'cs1', 'register'], [T(6, 6), 'csm', 'forward', {targetId: 'sm'}], [T(6, 8), 'sm', 'assign', {targetId: 'rep'}], [T(7, 5), 'rep', 'resolve', {outcome: 'solved'}], [T(7, 7), 'cs1', 'close', {outcome: 'satisfied', rating: 5}]]);
  await complaint('B', 'c2', 'cs1', [[T(6, 6), 'cs1', 'register'], [T(6, 7), 'csm', 'return', {text: 'x'}], [T(6, 8), 'cs1', 'edit'], [T(6, 9), 'csm', 'forward'], [T(6, 11), 'sm', 'assign'], [T(8, 5), 'rep', 'resolve'], [T(10, 5), 'cs1', 'reject', {text: 'x'}], [T(10, 7), 'rep', 'resolve'], [T(12, 5), 'cs1', 'close', {outcome: 'satisfied', rating: 3}], [T(20, 6), 'cs1', 'reopen', {text: 'x'}]], {severity: 'high'});
  await complaint('C', 'c3', 'cs1', [[T(7, 5), 'cs1', 'register'], [T(7, 11), 'csm', 'forward'], [T(7, 12), 'sm', 'assign'], [T(9, 5), 'rep', 'resolve']]);
  await complaint('D', 'c4', 'cs1', [[T(8, 5), 'cs1', 'register'], [T(8, 6), 'cs1', 'cancel']]);
  await complaint('E', 'c1', 'cs1', [[T(13, 5), 'cs1', 'register'], [T(13, 6), 'csm', 'forward'], [T(13, 7), 'sm', 'assign'], [T(14, 5), 'rep', 'resolve'], [T(17, 5), 'cs1', 'close', {outcome: 'satisfied', rating: 4}]]);
  await complaint('G', 'c5', 'cs2', [[T(29, 5), 'cs2', 'register']]);
  await complaint('F', 'c6', 'cs3', [[T(8, 5), 'cs3', 'register'], [T(8, 6), 'csm2', 'forward'], [T(8, 7), 'sm', 'assign'], [T(9, 5), 'rep', 'resolve'], [T(9, 7), 'cs3', 'close', {outcome: 'satisfied', rating: 5}]], {serviceManagerId: 'csm2'});
  await complaint('R', 'c7', 'cs_free', [[T(1, 5), 'cs_free', 'register'], [T(1, 6), 'owner', 'forward'], [T(1, 7), 'sm', 'assign'], [T(2, 5), 'rep', 'resolve'], [T(2, 6), 'cs_free', 'close', {outcome: 'satisfied'}], [T(16, 6), 'cs_free', 'reopen']], {serviceManagerId: ''});
  await complaint('Q', 'c8', 'cs_free', [[T(1, 5), 'cs_free', 'register'], [T(1, 6), 'owner', 'forward'], [T(1, 7), 'sm', 'assign'], [T(3, 5), 'rep', 'resolve'], [T(3, 6), 'cs_free', 'close', {outcome: 'satisfied'}], [T(17, 7), 'cs_free', 'reopen']], {serviceManagerId: ''});
  // a complaint with no events at all (an old or damaged one) must not break anything
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('complaint-X','complaint',NULL,'cs_gone','الرئيسي',?,?,?,1,'fixture')").bind(JSON.stringify({kind: 'complaint', status: 'submitted', customerId: 'c9', registrarId: 'cs_gone', serviceManagerId: 'csm2', severity: 'normal', description: 'PRIVATE-DESCRIPTION'}), T(5, 5), T(5, 5)).run();
  const support = async (id, {origin = 'rep', handler, requestedAt, handlerAt = requestedAt, result, branch = 'الرئيسي', customerId = 'c1'}) => {
    const data = {kind: 'support', customerId, origin, status: result ? 'done' : 'open', requestedBy: 'rep', requestedAt, repId: 'rep', note: 'PRIVATE-NOTE', channel: 'any', handlerId: handler || '', handlerAt: handler ? handlerAt : '', handlerBy: 'x', ...(result ? {result: {outcome: 'other', note: 'PRIVATE-RESULT', nextDate: '', by: handler, at: result}} : {})};
    await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'support',NULL,?,?,?,?,?,1,'fixture')").bind('support-' + id, handler || '', branch, JSON.stringify(data), requestedAt, result || requestedAt).run();
  };
  await support('S0', {handler: 'cs1', requestedAt: '2026-08-31T05:00:00.000Z', result: T(1, 6)});
  await support('S1', {handler: 'cs1', requestedAt: T(6, 5), result: T(6, 7)});
  await support('S2', {handler: 'cs1', requestedAt: T(7, 5), handlerAt: T(7, 6), result: T(7, 12)});
  await support('S3', {handler: 'cs1', requestedAt: T(8, 5), result: T(8, 8)});
  await support('M1', {origin: 'missed_visit', handler: 'cs1', requestedAt: T(9, 5), result: T(9, 7)});
  await support('M2', {origin: 'missed_visit', handler: 'cs1', requestedAt: T(10, 5), result: T(12, 5)});
  await support('S4', {handler: 'cs1', requestedAt: T(29, 5)});
  await support('S5', {handler: 'cs1', requestedAt: '2026-09-30T14:00:00.000Z'});
  await support('S6', {handler: 'cs_x', requestedAt: T(20, 5), branch: 'فرع آخر', customerId: 'c10'});
  await support('S7', {handler: 'cs3', requestedAt: T(15, 5), result: T(15, 6)});
  await support('S8', {handler: 'cs_free', requestedAt: T(16, 5), result: T(16, 6)});
  await support('S9', {handler: 'cs_left', requestedAt: T(9, 5), result: T(9, 6)});
  const serviceCase = (id, creator, customerId, createdAt, data) => app.db.prepare("INSERT INTO crm_service_cases(id,customer_id,status,creator_id,service_manager_id,sales_manager_id,assigned_to,supervisor_id,data,created_at,updated_at,version,mutation_id) VALUES(?,?,'assigned',?,'csm',NULL,NULL,NULL,?,?,?,1,'fixture')")
    .bind('case-' + id, customerId, creator, JSON.stringify({...data, needs: 'PRIVATE-NEEDS', products: ['PRIVATE-PRODUCT']}), createdAt, createdAt).run();
  await serviceCase('SC1', 'cs1', 'c1', T(6, 5), {approvedBy: 'csm', approvedAt: T(6, 7)});
  await serviceCase('SC2', 'cs1', 'c2', T(8, 5), {resubmittedAt: T(9, 5), approvedBy: 'csm', approvedAt: T(9, 6)});
  const audit = async (id, repId, month, total, at = T(20, 6), auditor = 'csm') => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'service_audit',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind('service-audit-' + id, auditor, JSON.stringify({kind: 'service_audit', repId, month, date: '', reference: {type: '', id: ''}, scores: {}, total, result: total >= 90 ? 'pass' : total >= 80 ? 'coach' : 'fail', verification: {called: false, rating: null}, note: 'PRIVATE-AUDIT-NOTE', auditorId: auditor, at}), at, at).run();
  await audit('AU1', 'cs1', '2026-09', 88); await audit('AU2', 'cs1', '2026-09', 94); await audit('AU3', 'cs2', '2026-09', 90); await audit('AU4', 'cs3', '2026-09', 70); await audit('AU5', 'cs1', '2026-08', 50);

  const metric = (card, key) => card.metrics.find(x => x.key === key);
  const nd = (card, key) => [metric(card, key).numerator, metric(card, key).denominator];
  const group = (answer, id) => answer.groups.find(g => g.managerId === id);
  const card = (answer, managerId, id) => { const g = group(answer, managerId); return g.reps.find(c => c.memberId === id) || (g.manager && g.manager.memberId === id ? g.manager : undefined); };

  // ---- the door
  const anonymous = app.as(null);
  check((await anonymous('/api/service-kpi?month=2026-09')).status, 401, 'anonymous callers get 401 on GET');
  check([(await anonymous('/api/service-kpi', {method: 'POST', body: {}})).status, (await anonymous('/api/service-kpi', {method: 'POST', body: {requestId: crypto.randomUUID(), action: 'settings', version: 0, settings: {}}})).status], [401, 401], 'and on POST, with an empty or a plausible body');
  check((await app.request('/api/service-kpi', {method: 'POST', body: {}})).status, 403, 'a POST that does not come from the site itself is refused');
  for (const id of ['sm', 'sup', 'rep']) {
    const denied = await kpi(id);
    check([id, denied.status, denied.json().error], [id, 403, 'تقييم خدمة العملاء لمدير النظام ومدير خدمة العملاء وممثليها فقط'], id + ' (sales) is refused with the reason');
  }
  for (const id of ['owner', 'csm', 'csm2', 'csm3', 'cs1', 'cs3', 'cs_free']) check([id, (await kpi(id)).status], [id, 200], id + ' may read it');
  check([(await kpi('owner', '2026-13')).status, (await kpi('owner', 'x')).status, (await kpi('owner', '2099-01')).status], [400, 400, 400], 'an impossible month, text and a month that has not begun are refused');
  check((await kpi('owner', '2026-09')).headers['cache-control'], 'no-store', 'never cached');
  check([(await post('cs1', {action: 'audit_delete', id: 'x'})).status, (await post('sm', {action: 'audit_delete', id: 'x'})).status], [403, 403], 'a representative and a sales manager do not act on it');
  check([(await post('csm', {action: 'launch'})).status, (await post('csm', {action: 'audit_delete', id: 'x', surprise: 1})).status, (await as('csm')('/api/service-kpi', {method: 'POST', body: {action: 'audit_delete', id: 'x'}})).status], [400, 400, 400], 'an unknown action, an unknown field and a request without its own identifier are refused');

  // ---- with nothing saved, the sheet's numbers apply: a figure needs five cases
  let a = (await kpi('owner')).json();
  check([a.settingsVersion, a.settings.rep.support_response, a.settings.closeGraceDays], [0, {target: 90, weight: 15, min: 5}, 5], 'nothing saved: the defaults, version 0');
  check([card(a, 'csm', 'cs1').score, card(a, 'csm', 'cs1').measuredWeight], [81, 20], 'with the defaults only registration and clearance have five cases, so cs1 scores 81 on 20 points of weight');

  // ---- the administrator saves the settings
  const real = a.settings, tuned = JSON.parse(JSON.stringify(real));
  for (const part of [tuned.rep, tuned.manager]) for (const key of Object.keys(part)) part[key].min = 1;
  tuned.manager.backlog.min = 0; tuned.closeGraceDays = 0;
  check([(await post('csm', {action: 'settings', version: 0, settings: tuned})).status, (await post('cs1', {action: 'settings', version: 0, settings: tuned})).status], [403, 403], 'a manager and a representative cannot save settings');
  const bad = JSON.parse(JSON.stringify(tuned)); bad.rep.clearance.weight = 9;
  const refused = await post('owner', {action: 'settings', version: 0, settings: bad});
  check([refused.status, /الممثل.*99/.test(refused.json().error)], [400, true], 'weights that add up to 99 are refused, saying so');
  check([(await post('owner', {action: 'settings', version: 0, settings: {...tuned, surprise: 1}})).status, (await post('owner', {action: 'settings', version: 0, settings: {...tuned, closeGraceDays: 'x'}})).status, (await post('owner', {action: 'settings', version: 0, settings: {hours: tuned.hours}})).status], [400, 400, 400], 'an unknown field, a text where a number belongs and a missing part are refused');
  const saved = await post('owner', {action: 'settings', version: 0, settings: tuned});
  check([saved.status, saved.json().version], [200, 1], 'the administrator saves them: version 1');
  check((await post('owner', {action: 'settings', version: 0, settings: tuned})).status, 409, 'saving again from the old version is refused');
  const stored = await row('service-kpi-settings');
  check([stored.kind, stored.parent_id, stored.assigned_to, stored.version, stored.data.rep.clearance.min, stored.data.closeGraceDays], ['service_kpi_settings', null, 'owner', 1, 1, 0], 'one row of its own kind holds them');

  // ---- the figures, end to end: the numbers worked out by hand in tests/service-kpi.mjs
  a = (await kpi('owner')).json();
  check([a.month, a.groups.map(g => g.managerId), a.settingsVersion], ['2026-09', ['csm', 'csm2', 'csm3', ''], 1], 'the administrator sees every group');
  ok(a.months.includes('2026-09') && a.months.includes('2026-08') && a.months[0] >= '2026-10', 'the months to choose from include the fixtures\' and the current one, newest first');
  check(group(a, 'csm').reps.map(c => [c.memberId, c.score]), [['cs2', 100], ['cs1', 73.9], ['cs_idle', null]], 'the first team by score; the idle one has none');
  const cs1 = card(a, 'csm', 'cs1');
  check(Object.fromEntries(cs1.metrics.map(x => [x.key, [x.numerator, x.denominator, r1(x.actual)]])), {support_response: [2, 4, 50], closure_timing: [3, 4, 75], closures_held: [1, 2, 50], audit_quality: [182, 2, 91], missed_visits: [1, 2, 50], registration_accuracy: [4, 6, 66.7], clearance: [11, 13, 84.6], customer_rating: [12, 3, 80]}, 'cs1\'s eight figures, read from the database');
  const csm = group(a, 'csm').manager;
  check([csm.score, Object.fromEntries(csm.metrics.map(x => [x.key, [x.numerator, x.denominator]]))], [82.9, {team_average: [173.9, 2], review_timing: [6, 7], life_timing: [2, 3], team_rating: [12, 3], team_support_response: [3, 6], team_quality: [272, 3], backlog: [2, 5], repeat_complaints: [5, 6]}], 'the manager\'s card');
  check([group(a, 'csm2').reps.map(c => [c.memberId, c.score]), group(a, 'csm3').reps, group(a, 'csm3').manager.score, group(a, '').reps.map(c => [c.memberId, c.score])], [[['cs_left', 100], ['cs3', 96.3]], [], 0, [['cs_free', 89.7]]], 'the other teams, the other branch\'s manager whose one overdue request is his whole backlog, and the representative nobody manages');
  check(group(a, 'csm').reps.flatMap(c => c.metrics).every(x => x.items.length === 0) && cs1.metrics.map(x => x.itemCount).join() === '4,4,2,2,2,6,13,3', true, 'cases are not sent until a card is opened, but the counts are');
  const opened = (await kpi('owner', '2026-09', '&member=cs1')).json();
  const items = metric(card(opened, 'csm', 'cs1'), 'closure_timing').items;
  check([items.length, items.map(i => i.customerName).sort(), items.map(i => [i.tag, i.value, i.ok]).sort((x, y) => x[1] - y[1])], [4, ['مصنع c1', 'مصنع c1', 'مصنع c2', 'مصنع c2'], [['close', 2, true], ['close', 8, true], ['reject', 20, true], ['close', 30, false]]], 'an opened card carries its cases with the customers\' names');
  check(metric(card(opened, 'csm', 'cs2'), 'audit_quality').items, [], 'and only that card');
  check(metric(card((await kpi('owner', '2026-09', '&member=csm')).json(), 'csm', 'csm'), 'backlog').items.length, 5, 'a manager\'s card opens the same way');

  // ---- every reader gets only their slice, and nothing private
  const asLead = (await kpi('csm')).json();
  check([asLead.groups.map(g => g.managerId), asLead.me, group(asLead, 'csm').reps.map(c => c.memberId), group(asLead, 'csm').manager.memberId], [['csm'], {id: 'csm', role: 'customer_service_manager', canAudit: true, canSettings: false}, ['cs2', 'cs1', 'cs_idle'], 'csm'], 'a manager: his group, his team and himself');
  check(Object.keys(asLead.sample).sort(), ['cs1', 'cs2', 'cs_idle'], 'with the suggested audit sample for his representatives');
  check([asLead.sample.cs1.length, asLead.sample.cs2, asLead.sample.cs1.every(s => s.customerName.startsWith('مصنع '))], [3, [], true], 'three for the one with work, with the customers\' names');
  const other = (await kpi('csm2')).json();
  check([other.groups.map(g => g.managerId), other.groups[0].reps.map(c => c.memberId)], [['csm2'], ['cs_left', 'cs3']], 'the other manager sees only his own');
  const mine = (await kpi('cs1')).json();
  check([mine.groups.length, mine.groups[0].manager, mine.groups[0].reps.map(c => c.memberId), mine.me, mine.sample], [1, null, ['cs1'], {id: 'cs1', role: 'customer_service', canAudit: false, canSettings: false}, {}], 'a representative: their own card only, no manager\'s, no sample, nothing to do');
  check([metric(mine.groups[0].reps[0], 'customer_rating').items.map(i => i.value).sort(), mine.audits.map(x => x.id).sort(), mine.audits.every(x => x.note === 'PRIVATE-AUDIT-NOTE')], [[3, 4, 5], ['service-audit-AU1', 'service-audit-AU2'], true], 'with their own cases open and their own audits, notes included');
  check(mine.groups[0].reps[0].score, 73.9, 'and the same score the manager sees');
  check([(await kpi('cs3')).json().groups.map(g => g.reps.map(c => c.memberId)), (await kpi('cs_free')).json().groups.map(g => [g.managerId, g.reps.map(c => c.memberId)])], [[['cs3']], [['', ['cs_free']]]], 'another representative, and one nobody manages, see theirs');
  for (const id of ['owner', 'csm', 'cs1', 'cs3', 'csm3']) {
    const text = (await kpi(id, '2026-09', '&member=cs1')).text;
    check([id, /PRIVATE-(?!AUDIT-NOTE)|@yourrest|sendmail|opaque-/.test(text)], [id, false], id + ' receives no complaint text, request note, contact, email or internal identifier (an audit\'s own note is meant to be seen)');
  }
  check(Object.keys(asLead).sort(), ['audits', 'generatedAt', 'groups', 'me', 'month', 'months', 'sample', 'settings', 'settingsVersion'], 'the shape of the answer');

  // ---- audits: who may record them, what they must carry, and what they change
  const full = {greeting: 10, understanding: 15, accuracy: 20, ownership: 15, communication: 15, resolution: 15, closing: 10};
  const low = {greeting: 5, understanding: 5, accuracy: 10, ownership: 5, communication: 5, resolution: 5, closing: 5};
  const audit1 = {action: 'audit', repId: 'cs1', month: '2026-09', scores: low, note: 'لم يؤكد الموعد مع العميل'};
  check([(await post('cs1', audit1)).status, (await post('sm', audit1)).status, (await post('cs2', audit1)).status], [403, 403, 403], 'a representative and sales members cannot audit');
  check((await post('csm', {...audit1, repId: 'cs3'})).status, 403, 'a manager cannot audit another manager\'s representative');
  check([(await post('csm', {...audit1, repId: 'csm2'})).status, (await post('csm', {...audit1, repId: 'ghost'})).status, (await post('csm', {...audit1, repId: 'sm'})).status], [400, 400, 400], 'nor a person who is not a customer-service representative');
  const tooMuch = await post('csm', {...audit1, scores: {...low, accuracy: 21}});
  check([tooMuch.status, tooMuch.json().error], [400, 'درجة «دقة المعلومة والتسجيل» بين 0 و20'], 'a mark above the criterion\'s is refused, naming it');
  check([(await post('csm', {...audit1, scores: {...low, accuracy: 7.5}})).status, (await post('csm', {...audit1, scores: {greeting: 10}})).status, (await post('csm', {...audit1, scores: {...low, accuracy: -1}})).status, (await post('csm', {...audit1, scores: {...low, extra: 1}})).status], [400, 400, 400, 400], 'a fraction, a missing criterion, a negative mark and an unknown criterion are refused');
  check([(await post('csm', {...audit1, month: '2099-01'})).status, (await post('csm', {...audit1, month: '2026-9'})).status, (await post('csm', {...audit1, note: 'x'.repeat(2001)})).status], [400, 400, 400], 'a month that has not begun, a malformed month and a note that is too long are refused');
  check([(await post('csm', {...audit1, verification: {called: false, rating: 3}})).status, (await post('csm', {...audit1, verification: {called: true, rating: 6}})).status, (await post('csm', {...audit1, refType: 'complaint'})).status, (await post('csm', {...audit1, refId: 'complaint-A'})).status], [400, 400, 400, 400], 'a verified rating needs a call and a rating from 1 to 5; a reference needs its type and its identifier together');
  check([(await post('csm', {...audit1, refType: 'complaint', refId: 'complaint-F'})).status, (await post('csm', {...audit1, refType: 'complaint', refId: 'complaint-nope'})).status, (await post('csm', {...audit1, refType: 'support', refId: 'support-S7'})).status, (await post('csm', {...audit1, refType: 'service', refId: 'case-nope'})).status], [400, 400, 400, 400], 'a reference to another representative\'s work, or to nothing, is refused');
  const key = crypto.randomUUID(), body = {...audit1, refType: 'complaint', refId: 'complaint-A', verification: {called: true, rating: 5}};
  const first = await as('csm')('/api/service-kpi', {method: 'POST', body: {requestId: key, ...body}});
  check([first.status, first.json().total, first.json().result], [200, 40, 'fail'], 'the manager records an audit of cs1 for September, pointing at complaint A: 40 of 100, a fail');
  const auditId = first.json().id;
  const again = await as('csm')('/api/service-kpi', {method: 'POST', body: {requestId: key, ...body}});
  check([again.status, again.json().alreadySaved, again.json().id], [200, true, auditId], 'the same request again is recognised, not recorded twice');
  check((await as('csm')('/api/service-kpi', {method: 'POST', body: {requestId: key, ...body, note: 'غير ذلك'}})).status, 409, 'the same identifier with another body is refused');
  const stored1 = await row(auditId);
  check([stored1.kind, stored1.parent_id, stored1.assigned_to, stored1.branch, stored1.data.repId, stored1.data.month, stored1.data.total, stored1.data.result, stored1.data.auditorId, stored1.data.reference, stored1.data.verification], ['service_audit', null, 'csm', 'الرئيسي', 'cs1', '2026-09', 40, 'fail', 'csm', {type: 'complaint', id: 'complaint-A'}, {called: true, rating: 5}], 'stored as a record of its own kind, with no parent');
  check((await app.db.prepare("SELECT count(*) AS n FROM crm_audit WHERE record_id=? AND action IN ('service-kpi-receipt','service-kpi:audit')").bind(auditId).first()).n, 2, 'with its receipt and its history entry');
  a = (await kpi('owner')).json();
  check([nd(card(a, 'csm', 'cs1'), 'audit_quality'), card(a, 'csm', 'cs1').score, nd(group(a, 'csm').manager, 'team_quality'), group(a, 'csm').manager.score], [[222, 3], 71.2, [312, 4], 81.5], 'cs1\'s quality falls to 74 and her score to 71.2; the manager\'s team quality to 78 and his score to 81.5');
  check((await kpi('cs1')).json().audits.map(x => [x.id, x.total, x.result, x.auditorName, x.reference.customerName]).find(x => x[0] === auditId), [auditId, 40, 'fail', 'csm', 'مصنع c1'], 'the representative sees the audit, who recorded it and what it pointed at');
  check((await post('owner', {action: 'audit', repId: 'cs3', month: '2026-09', scores: full})).status, 200, 'an administrator audits any representative');
  check([(await post('csm2', {action: 'audit_delete', id: auditId})).status, (await post('cs1', {action: 'audit_delete', id: auditId})).status, (await post('csm', {action: 'audit_delete', id: 'service-audit-nope'})).status], [403, 403, 404], 'another manager and the representative cannot delete it; one that is not there is not found');
  check((await post('csm', {action: 'audit_delete', id: 'service-audit-AU2'})).status, 403, 'a manager cannot delete an audit after a week');
  check((await post('csm', {action: 'audit_delete', id: auditId})).status, 200, 'the auditor deletes his own within the week');
  check((await post('csm', {action: 'audit_delete', id: auditId})).status, 404, 'once');
  const deleted = await row(auditId);
  check([deleted.data.deleted.by, deleted.version], ['csm', 2], 'the row stays, marked deleted, with its version raised');
  a = (await kpi('owner')).json();
  check([nd(card(a, 'csm', 'cs1'), 'audit_quality'), card(a, 'csm', 'cs1').score, group(a, 'csm').manager.score], [[182, 2], 73.9, 82.9], 'deleted audits count for nothing: back to the first figures');
  check((await post('owner', {action: 'audit_delete', id: 'service-audit-AU2'})).status, 200, 'an administrator may delete an old audit');
  check(nd(card((await kpi('owner')).json(), 'csm', 'cs1'), 'audit_quality'), [88, 1], 'and the figure follows');
  await app.db.prepare("UPDATE crm_records SET data=json_remove(data,'$.deleted'),version=version+1 WHERE id='service-audit-AU2'").run();

  // ---- closing a month
  const closeBody = {action: 'close_month', month: '2026-09'};
  check([(await post('csm', {...closeBody, managerId: 'csm2'})).status, (await post('csm', {...closeBody, managerId: ''})).status, (await post('cs1', {...closeBody, managerId: 'csm'})).status], [403, 403, 403], 'a manager cannot close another team\'s month or the unmanaged group\'s; a representative cannot close anything');
  const month = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 7);
  const early = await post('csm', {action: 'close_month', month, managerId: 'csm'});
  check([early.status, early.json().error], [400, 'لا يُقفل الشهر قبل أن ينتهي'], 'the running month cannot be closed');
  check([(await post('csm', {...closeBody, month: '2099-01', managerId: 'csm'})).status, (await post('csm', {...closeBody, month: '2026-09', managerId: 'csm', extra: 1})).status], [400, 400], 'a future month and an unknown field are refused');
  a = (await kpi('csm')).json();
  check([group(a, 'csm').canClose, group(a, 'csm').closeProblem, group(a, 'csm').canReopen], [true, '', false], 'the page offers the button');
  const closing = await post('csm', {...closeBody, managerId: 'csm'});
  check(closing.status, 200, 'the manager closes September for his team: ' + closing.text.slice(0, 120));
  const certificate = await row('service-kpi-month-csm-2026-09');
  check([certificate.kind, certificate.parent_id, certificate.assigned_to, certificate.data.month, certificate.data.managerId, certificate.data.team, certificate.data.closedBy, certificate.data.scores], ['service_kpi_month', null, 'csm', '2026-09', 'csm', ['cs2', 'cs1', 'cs_idle'], 'csm', {cs2: 100, cs1: 73.9, cs_idle: null, csm: 82.9}], 'the certificate names the team, who closed it and the scores reached');
  check([certificate.data.settings.rep.clearance.min, certificate.data.settings.closeGraceDays], [1, 0], 'and the settings used');
  check([(await post('csm', {...closeBody, managerId: 'csm'})).status, (await post('owner', {...closeBody, managerId: 'csm'})).status], [409, 409], 'closing it again is refused');
  a = (await kpi('csm')).json();
  check([group(a, 'csm').closed, group(a, 'csm').closedByName, group(a, 'csm').drift, group(a, 'csm').canClose, a.sample, card(a, 'csm', 'cs1').score], [true, 'csm', false, false, {}, 73.9], 'a closed group shows who closed it, is not drifting, offers nothing to close and no sample');
  check([(await post('csm', {action: 'audit', repId: 'cs1', month: '2026-09', scores: full})).status, (await post('owner', {action: 'audit', repId: 'cs2', month: '2026-09', scores: full})).status, (await post('owner', {action: 'audit_delete', id: 'service-audit-AU1'})).status], [409, 409, 409], 'no audit is recorded or deleted in a month closed for the team, not even by an administrator');
  check((await post('owner', {action: 'audit', repId: 'cs3', month: '2026-09', scores: full})).status, 200, 'the other team\'s month is still open');
  check([(await post('csm', {action: 'reopen_month', month: '2026-09', managerId: 'csm'})).status, (await post('owner', {action: 'reopen_month', month: '2026-09', managerId: 'csm2'})).status], [403, 404], 'only an administrator reopens a month, and only one that is closed');
  const tweaked = JSON.parse(JSON.stringify(tuned)); tweaked.rep.audit_quality.weight = 25; tweaked.rep.customer_rating.weight = 0;
  check((await post('owner', {action: 'settings', version: 1, settings: tweaked})).status, 200, 'the administrator changes the weights');
  a = (await kpi('owner')).json();
  check([card(a, 'csm', 'cs1').score, group(a, 'csm').closed, card(a, 'csm2', 'cs3').score !== 96.3], [73.9, true, true], 'the closed team keeps its score and its settings; the open team follows the new weights');
  check((await post('owner', {action: 'settings', version: 2, settings: tuned})).status, 200, 'the weights go back');
  const all = await post('owner', {...closeBody, managerId: 'csm2'});
  const freeClose = await post('owner', {...closeBody, managerId: ''});
  check([all.status, freeClose.status], [200, 200], 'an administrator closes the other teams, the unmanaged group too');
  check((await row('service-kpi-month-none-2026-09')).data.team, ['cs_free'], 'the unmanaged group\'s certificate names its one representative');
  const reopened = await post('owner', {action: 'reopen_month', month: '2026-09', managerId: 'csm'});
  check(reopened.status, 200, 'an administrator reopens the first team\'s month');
  check([(await row('service-kpi-month-csm-2026-09')).version, (await row('service-kpi-month-csm-2026-09')).data.reopened.by], [2, 'owner'], 'the certificate stays, marked reopened');
  a = (await kpi('csm')).json();
  check([group(a, 'csm').closed, group(a, 'csm').canClose], [false, true], 'evaluated live again, and closable');
  check((await post('csm', {action: 'audit', repId: 'cs1', month: '2026-09', scores: full})).status, 200, 'an audit can be recorded again');
  const second = await post('csm', {...closeBody, managerId: 'csm'});
  check([second.status, (await row('service-kpi-month-csm-2026-09')).version], [200, 3], 'and it is closed once more: the same row, replaced');
  check((await row('service-kpi-month-csm-2026-09')).data.reopened, undefined, 'without the reopened mark');
  check((await app.db.prepare("SELECT count(*) AS n FROM crm_records WHERE kind='service_kpi_month'").first()).n, 3, 'three certificates exist in all');

  // ---- the customer's rating, entered with a complaint's closure through the complaints route
  const complaintsPost = (id, body) => as(id)('/api/complaints', {method: 'POST', body: {requestId: crypto.randomUUID(), ...body}});
  const version = async id => (await app.db.prepare('SELECT version FROM crm_records WHERE id=?').bind(id).first()).version;
  const act = async (who, id, body) => complaintsPost(who, {id, version: await version(id), ...body});
  const registered = await complaintsPost('cs1', {action: 'register', customerId: 'c11', customerVersion: await version('c11'), channel: 'call', category: 'product_quality', severity: 'normal', description: 'القالب يخرج منتجًا مكسورًا من الجهة اليمنى', demand: '', reference: ''});
  check(registered.status, 200, 'cs1 registers a complaint now: ' + registered.text.slice(0, 100));
  const live = registered.json().id;
  check([(await act('csm', live, {action: 'forward', targetId: 'sm'})).status, (await act('sm', live, {action: 'assign', targetId: 'sup'})).status, (await act('sup', live, {action: 'delegate', targetId: 'rep'})).status, (await act('rep', live, {action: 'resolve', outcome: 'solved', note: 'حُلّت المشكلة'})).status], [200, 200, 200, 200], 'it goes through review, assignment, delegation and resolution');
  check([(await act('cs1', live, {action: 'close', outcome: 'satisfied', rating: 0})).status, (await act('cs1', live, {action: 'close', outcome: 'satisfied', rating: 6})).status, (await act('cs1', live, {action: 'close', outcome: 'satisfied', rating: 3.5})).status, (await act('cs1', live, {action: 'close', outcome: 'satisfied', rating: '4'})).status], [400, 400, 400, 400], 'a rating that is not a whole number from 1 to 5 is refused');
  const unreached = await act('cs1', live, {action: 'close', outcome: 'unreachable', rating: 4});
  check([unreached.status, unreached.json().error], [400, 'تقييم العميل متاح عند رضاه أو عدم رضاه فقط'], 'a rating with no customer to give it is refused');
  check((await row(live)).data.status, 'resolved', 'and the complaint is still waiting for its closure');
  const closedNow = await act('cs1', live, {action: 'close', outcome: 'satisfied', rating: 4, note: 'اتصلت بالعميل وأكد الرضا'});
  check(closedNow.status, 200, 'cs1 closes it with the customer\'s 4');
  const done = await row(live);
  check([done.data.status, done.data.closure.rating, done.data.closure.outcome, done.data.events.at(-1).action, done.data.events.at(-1).rating, done.data.events.at(-1).by], ['closed', 4, 'satisfied', 'close', 4, 'cs1'], 'the rating is kept with the closure and with its event');
  const nowAnswer = (await kpi('cs1', month)).json();
  check([nd(nowAnswer.groups[0].reps[0], 'customer_rating'), r1(metric(nowAnswer.groups[0].reps[0], 'customer_rating').actual)], [[4, 1], 80], 'this month\'s card for cs1 has the rating');
  check((await complaintsPost('cs1', {action: 'close', id: live, version: 99, outcome: 'satisfied'})).status, 409, 'a stale closure is refused as before');
  check(nd(card((await kpi('owner')).json(), 'csm', 'cs1'), 'customer_rating'), [12, 3], 'and September is unchanged');

  // ---- nothing leaks into the record lists or the history
  const crm = (await as('owner')('/api/crm')).json();
  check([crm.records.some(r => ['service_audit', 'service_kpi_month', 'service_kpi_settings'].includes(r.kind)), crm.audits.some(entry => /^service-kpi/.test(entry.action))], [false, false], 'the administrator\'s records and history carry no audit, certificate, setting or receipt');
  check((await app.db.prepare("SELECT count(*) AS n FROM crm_audit WHERE action LIKE 'service-kpi%'").first()).n > 10, true, 'though they are all there in the history table');
  for (const id of ['csm', 'cs1']) check((await as(id)('/api/crm')).status, 200, id + '\'s own pages still load');
  check([(await as('csm')('/api/complaints')).status, (await as('csm')('/api/support')).status, (await as('owner')('/api/complaint-report?month=2026-09')).status], [200, 200, 200], 'the complaints, assistance and complaint report still answer');

  // ---- reading changes nothing
  const snapshot = await count();
  for (const id of ['owner', 'csm', 'cs1']) await kpi(id);
  check(await count(), snapshot, 'reading changes nothing');
  console.log(JSON.stringify({ok: true, checks, builtRelease: true, productionDataUsed: false}));
} finally {
  await app.stop();
}
