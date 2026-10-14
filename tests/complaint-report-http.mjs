// The monthly complaints report over real HTTP against the BUILT release (run `pnpm build` first): who may read it, the
// figures each reader gets from the complaints they may already read, the shape of the answer (aggregates only, nothing a
// customer, a text or a name could leak through) and that reading it changes nothing.
// Synthetic isolated fixtures only: temporary SQLite, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'}, {id: 'sm2', role: 'manager'}, {id: 'smw', role: 'manager', region: 'western'},
  {id: 'sup', role: 'supervisor', sup: 'sm'}, {id: 'sup2', role: 'supervisor', sup: 'sm2'}, {id: 'rep', role: 'rep', sup: 'sup'}, {id: 'rep2', role: 'rep', sup: 'sup'}, {id: 'rep_b', role: 'rep', sup: 'sup2', branch: 'فرع آخر'},
  {id: 'csm', role: 'customer_service_manager', sup: 'sm'}, {id: 'cs', role: 'customer_service', sup: 'csm'},
  {id: 'csm2', role: 'customer_service_manager', sup: 'sm2'}, {id: 'cs2', role: 'customer_service', sup: 'csm2'},
  {id: 'csm_b', role: 'customer_service_manager', sup: 'sm2', branch: 'فرع آخر'}, {id: 'cs_b', role: 'customer_service', sup: 'csm_b', branch: 'فرع آخر'}
];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const app = await bootBuiltApp({members});
try {
  const sessions = {};
  for (const member of members) sessions[member.id] = await app.login(member.id);
  const as = id => app.as(sessions[id]);
  const report = async (id, month) => as(id)('/api/complaint-report' + (month === undefined ? '' : '?month=' + month));
  const count = async () => JSON.stringify(await app.db.prepare('SELECT count(*) AS n,max(updated_at) AS u,sum(version) AS v FROM crm_records').first());

  // ---- fixtures: September 2026 (Riyadh is UTC+3; the 6th is a Sunday), the same company as tests/complaint-report.mjs
  const stamp = '2026-08-01T05:00:00.000Z';
  const customers = {c1: ['rep', 'الشرقية'], c2: ['rep', 'الشرقية'], c3: ['rep2', 'الغربية'], c4: ['rep', 'الشرقية'], c6: ['rep_b', 'الشرقية', 'فرع آخر']};
  for (const [id, [assignedTo, region, branch = 'الرئيسي']] of Object.entries(customers)) {
    await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,?,?,?,?,1,'fixture')")
      .bind(id, assignedTo, branch, JSON.stringify({name: 'مصنع ' + id, region, city: 'الدمام', phone: '0500000000', contact: 'PRIVATE-CONTACT', code: id, branch, assignedTo}), stamp, stamp).run();
  }
  const T = (day, hour) => '2026-09-' + String(day).padStart(2, '0') + 'T' + String(hour).padStart(2, '0') + ':00:00.000Z';
  const base = {kind: 'complaint', status: 'submitted', registrarId: 'cs', serviceManagerId: 'csm', salesManagerId: '', supervisorId: '', assigneeId: '', channel: 'call', category: 'product_quality', severity: 'normal', description: 'PRIVATE-DESCRIPTION', demand: 'PRIVATE-DEMAND', reference: 'INV-1', contactName: 'PRIVATE-CONTACT', contactPhone: '0500000000',
    submittedAt: '', forwardedAt: '', returnedAt: '', assignedAt: '', delegatedAt: '', reassignedAt: '', rejectedAt: '', reopenedAt: '', resolvedAt: '', closedAt: '', cancelledAt: '', seenAt: '', returnNote: '', assignmentNote: '', rejectReason: '', cancelReason: '', previousAssignees: [], updates: [], notes: [], events: []};
  const update = at => ({id: 'u-' + at, at, by: 'rep', channel: 'call', date: at.slice(0, 10), text: 'PRIVATE-UPDATE'});
  const sales = {salesManagerId: 'sm', supervisorId: 'sup', assigneeId: 'rep'};
  const complaint = async (id, createdAt, data) => {
    const merged = {...base, submittedAt: createdAt, ...data}, branch = customers[merged.customerId][2] || 'الرئيسي';
    await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'complaint',NULL,?,?,?,?,?,3,'fixture')")
      .bind('complaint-' + id, merged.registrarId, branch, JSON.stringify(merged), createdAt, merged.closedAt || merged.cancelledAt || createdAt).run();
  };
  await complaint('A', T(6, 5), {customerId: 'c1', status: 'closed', ...sales, forwardedAt: T(6, 6), assignedAt: T(6, 8), updates: [update(T(6, 9))], resolvedAt: T(7, 5), resolution: {outcome: 'solved', note: 'PRIVATE-RESOLUTION', by: 'rep', at: T(7, 5)}, closedAt: T(7, 7), closure: {outcome: 'not_satisfied', note: 'PRIVATE-CLOSURE', by: 'cs', at: T(7, 7)}});
  await complaint('B', T(7, 5), {customerId: 'c2', status: 'resolved', severity: 'high', channel: 'whatsapp', category: 'delivery_delay', ...sales, returnedAt: T(7, 6), submittedAt: T(7, 7), forwardedAt: T(7, 9), assignedAt: T(7, 11), delegatedAt: T(7, 12), updates: [update(T(9, 5))], rejectedAt: T(9, 8), rejectReason: 'PRIVATE-REASON', resolvedAt: T(10, 5), resolution: {outcome: 'partially_solved', note: 'PRIVATE-RESOLUTION', by: 'rep', at: T(10, 5)}});
  await complaint('C', T(8, 5), {customerId: 'c3', status: 'pending_assignment', channel: 'email', category: 'invoice_price', salesManagerId: 'sm', forwardedAt: T(8, 6)});
  await complaint('D', '2026-08-31T05:00:00.000Z', {customerId: 'c1', status: 'cancelled', channel: 'email', category: 'other', cancelledAt: '2026-08-31T06:00:00.000Z'});
  await complaint('E', T(9, 5), {customerId: 'c4', status: 'cancelled', registrarId: 'cs2', serviceManagerId: 'csm2', channel: 'website', category: 'service_conduct', cancelledAt: T(9, 6), cancelReason: 'PRIVATE-CANCEL'});
  await complaint('F', T(10, 5), {customerId: 'c6', status: 'assigned', registrarId: 'cs_b', serviceManagerId: 'csm_b', salesManagerId: 'sm2', supervisorId: 'sup2', assigneeId: 'rep_b', category: 'maintenance_support', forwardedAt: T(10, 6), assignedAt: T(10, 7)});
  await complaint('G', T(6, 6), {customerId: 'c1', status: 'closed', channel: 'visit', ...sales, forwardedAt: T(6, 7), assignedAt: T(6, 8), updates: [update(T(6, 9))], reopenedAt: T(7, 7), resolvedAt: T(7, 9), resolution: {outcome: 'solved', note: 'PRIVATE-RESOLUTION', by: 'rep', at: T(7, 9)}, closedAt: T(7, 11), closure: {outcome: 'satisfied', note: 'PRIVATE-CLOSURE', by: 'cs', at: T(7, 11)}});
  const before = await count();
  const row = (key, total, open, closed, satisfied, satisfactionRate) => ({key, total, open, closed, satisfied, satisfactionRate});

  // ---- who may read it
  check((await app.request('/api/complaint-report')).status, 401, 'anonymous callers get 401');
  for (const id of ['sup', 'rep', 'cs', 'cs2', 'cs_b']) {
    const denied = await report(id, '2026-09');
    check([id, denied.status, denied.json().error], [id, 403, 'تقرير الشكاوى متاح لمدير النظام ومدير المبيعات ومدير خدمة العملاء فقط'], id + ' is refused with the reason');
  }
  for (const id of ['owner', 'sm', 'sm2', 'smw', 'csm', 'csm2', 'csm_b']) check([id, (await report(id, '2026-09')).status], [id, 200], id + ' may read it');

  // ---- the administrator sees every complaint of the month
  const response = await report('owner', '2026-09');
  check(response.headers['cache-control'], 'no-store', 'never cached');
  let r = response.json();
  check([r.month, r.total, r.open, r.closed, r.cancelled, r.high, r.satisfied, r.satisfactionRate, r.openOverTarget, r.repeatCustomers], ['2026-09', 6, 3, 2, 1, 1, 1, 50, 3, 1], 'September: six complaints, three open and all late by now, two closed with one customer satisfied, one cancelled, one high, one customer twice');
  check(r.flow, {returned: 1, sentBack: 1, reassigned: 0, reopened: 1}, 'what went a step back');
  check(r.byState, {closed: 2, resolved: 1, pending_assignment: 1, assigned: 1, cancelled: 1}, 'by current state');
  check(r.byCategory, [row('product_quality', 2, 0, 2, 1, 50), row('delivery_delay', 1, 1, 0, 0, null), row('invoice_price', 1, 1, 0, 0, null), row('maintenance_support', 1, 1, 0, 0, null), row('service_conduct', 1, 0, 0, 0, null)], 'by category');
  check(r.byChannel.map(x => [x.key, x.total]), [['call', 2], ['email', 1], ['visit', 1], ['website', 1], ['whatsapp', 1]], 'by channel');
  check(r.byRegion, [row('الشرقية', 5, 2, 2, 1, 50), row('الغربية', 1, 1, 0, 0, null)], 'by region');
  check(r.bySeverity.map(x => [x.key, x.total]), [['normal', 5], ['high', 1]], 'by severity');
  check([r.resolutionOutcomes, r.closureOutcomes], [[{key: 'solved', count: 2}, {key: 'partially_solved', count: 1}], [{key: 'not_satisfied', count: 1}, {key: 'satisfied', count: 1}]], 'outcomes');
  check(r.timing.review, {n: 5, median: 1, average: 1.2, target: 4, overTarget: 0}, 'review time in working hours');
  check(r.timing.firstContact, {n: 3, median: 1, average: 5, target: 24, overTarget: 0}, 'first contact after the dispatch');
  check(r.timing.resolution, {n: 3, median: 7, average: 5.33, target: 50, overTarget: 0}, 'resolution from the dispatch before it');
  check(r.timing.closure, {n: 2, median: 2, average: 2, target: 24, overTarget: 0}, 'closure confirmation');
  check(r.timing.registrationToClosure, {n: 2, median: 13.5, average: 13.5, target: null, overTarget: 0}, 'registration to closure, which has no target');
  check(r.months, ['2026-09', '2026-08'], 'the months a reader can choose');
  check(r.targets, {review: 4, assignment: 4, delegation: 4, first_contact: 24, resolution: 50, closure: 24}, 'the targets travel with the figures');
  check(Object.keys(r).sort(), ['byCategory', 'byChannel', 'byRegion', 'bySeverity', 'byState', 'cancelled', 'closed', 'closureOutcomes', 'flow', 'generatedAt', 'high', 'month', 'months', 'open', 'openOverTarget', 'repeatCustomers', 'resolutionOutcomes', 'satisfactionRate', 'satisfied', 'targets', 'timing', 'total'], 'aggregate fields only');

  // ---- nothing a customer, a text or a name could leak through
  for (const id of ['owner', 'sm', 'csm']) {
    const body = (await report(id, '2026-09')).text;
    check([id, /مصنع|PRIVATE-|complaint-|INV-|@yourrest|c[1-6]\b/.test(body)], [id, false], id + ': no customer, text, identifier, reference or address in the answer');
  }

  // ---- each reader gets only what they may already read
  r = (await report('csm', '2026-09')).json();
  check([r.total, r.open, r.closed, r.cancelled, r.satisfactionRate, r.openOverTarget, r.months], [4, 2, 2, 0, 50, 2, ['2026-09', '2026-08']], 'a customer-service manager: his team\'s complaints, not the other manager\'s nor the other branch\'s');
  r = (await report('csm2', '2026-09')).json();
  check([r.total, r.cancelled, r.byChannel.map(x => x.key), r.months], [1, 1, ['website'], ['2026-09']], 'the other customer-service manager: only his team\'s cancelled one');
  r = (await report('csm_b', '2026-09')).json();
  check([r.total, r.open, r.openOverTarget, r.byRegion], [1, 1, 1, [row('الشرقية', 1, 1, 0, 0, null)]], 'the other branch\'s manager: the one of his branch');
  r = (await report('sm', '2026-09')).json();
  check([r.total, r.byState, r.months], [5, {closed: 2, resolved: 1, pending_assignment: 1, assigned: 1}, ['2026-09']], 'the sales manager: what was routed to him and what any representative holds');
  r = (await report('sm2', '2026-09')).json();
  check([r.total, r.byState], [4, {closed: 2, resolved: 1, assigned: 1}], 'the other sales manager: the one routed to him and what representatives hold, not the one still waiting for the first manager');
  r = (await report('smw', '2026-09')).json();
  check([r.total, r.months, r.byCategory], [0, [], []], 'a manager of another region sees an empty report');

  // ---- months
  check((await report('owner', '2026-08')).json().total, 1, 'August has one complaint');
  check((await report('owner', '2026-07')).json().total, 0, 'a month without complaints is an empty report, not an error');
  const current = (await report('owner')).json();
  check(/^\d{4}-(0[1-9]|1[0-2])$/.test(current.month) && current.month === new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()).slice(0, 7), true, 'without a month the report is for the current one');
  for (const bad of ['2026-13', '2026-00', '26-09', '2026-9', '2026-09-01', 'x', '%20']) {
    const refused = await report('owner', bad);
    check([bad, refused.status, typeof refused.json().error], [bad, 400, 'string'], 'an invalid month is refused: ' + bad);
  }

  // ---- reading changes nothing
  check(await count(), before, 'no record was written by reading the report');
  check((await as('owner')('/api/complaint-report', {method: 'POST', body: {}})).status >= 400, true, 'the endpoint only reads');

  console.log(JSON.stringify({ok: true, checks, builtRelease: true, productionDataUsed: false}));
} finally { await app.stop(); }
