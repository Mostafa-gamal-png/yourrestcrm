// The monthly customer-service report over real HTTP against the BUILT release (run `pnpm build` first): who may read it,
// the figures each reader gets from the cases they may already read, the shape of the answer (aggregates only, nothing a
// customer or a note could leak through) and that reading it changes nothing.
// Synthetic isolated fixtures only: temporary SQLite, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'}, {id: 'sm2', role: 'manager'}, {id: 'smw', role: 'manager', region: 'western'},
  {id: 'sup', role: 'supervisor', sup: 'sm'}, {id: 'rep', role: 'rep', sup: 'sup'},
  {id: 'csm', role: 'customer_service_manager', sup: 'sm'}, {id: 'cs', role: 'customer_service', sup: 'csm'},
  {id: 'csm2', role: 'customer_service_manager', sup: 'sm'}, {id: 'cs2', role: 'customer_service', sup: 'csm2'}
];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const app = await bootBuiltApp({members});
try {
  const sessions = {};
  for (const member of members) sessions[member.id] = await app.login(member.id);
  const as = id => app.as(sessions[id]);
  const report = async (id, month) => as(id)('/api/service-report' + (month === undefined ? '' : '?month=' + month));
  const count = async () => JSON.stringify([await app.db.prepare('SELECT count(*) AS n,max(updated_at) AS u FROM crm_records').first(), await app.db.prepare('SELECT count(*) AS n,max(updated_at) AS u,sum(version) AS v FROM crm_service_cases').first()]);

  // ---- fixtures: September 2026 (Riyadh is UTC+3; the 6th is a Sunday, the 7th Monday, the 9th Wednesday)
  const stamp = '2026-08-01T05:00:00.000Z';
  const customer = id => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')")
    .bind(id, JSON.stringify({name: 'مصنع ' + id, region: 'الشرقية', city: 'الدمام', phone: '0500000000', contact: 'م', code: id, branch: 'الرئيسي', assignedTo: 'rep'}), stamp, stamp).run();
  const contact = (id, caseId, customerId, createdAt, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'activity',?,'rep','الرئيسي',?,?,?,1,'fixture')")
    .bind(id, customerId, JSON.stringify({type: 'call', date: createdAt.slice(0, 10), result: 'تم', salesStage: 'new', serviceCaseId: caseId, performedBy: 'rep', responsibleId: 'rep', recordedByEmail: 'rep@yourrest.org', summary: 'PRIVATE-CONTACT-SUMMARY', ...data}), createdAt, createdAt).run();
  const kase = (id, status, createdAt, fields, data) => {
    const f = {creator: 'cs', manager: 'csm', sales: null, assignedTo: null, supervisor: null, ...fields};
    return app.db.prepare('INSERT INTO crm_service_cases(id,customer_id,status,creator_id,service_manager_id,sales_manager_id,assigned_to,supervisor_id,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,2,?)')
      .bind(id, 'c-' + id, status, f.creator, f.manager, f.sales, f.assignedTo, f.supervisor,
        JSON.stringify({source: 'call', products: ['خدمات صيانة'], strength: 'strong', needs: 'PRIVATE-NEEDS', nextAction: 'y', nextDate: '2026-10-20', participants: [f.creator, f.manager], ...data}), createdAt, createdAt, 'fixture').run();
  };
  for (const id of ['A', 'B', 'C', 'D', 'E', 'F']) await customer('c-' + id);
  // A: call, approved after 1h, assigned 2h later, first contact an hour after that, won four days on
  await kase('A', 'assigned', '2026-09-06T05:00:00.000Z', {sales: 'sm', assignedTo: 'rep', supervisor: 'sup'}, {source: 'call', approvedAt: '2026-09-06T06:00:00.000Z', assignedAt: '2026-09-06T08:00:00.000Z'});
  // B: whatsapp, approval took 6 working hours (late), assigned an hour later, first contact Wednesday 08:00, lost
  await kase('B', 'assigned', '2026-09-07T05:00:00.000Z', {sales: 'sm', assignedTo: 'rep', supervisor: 'sup'}, {source: 'whatsapp', approvedAt: '2026-09-07T11:00:00.000Z', assignedAt: '2026-09-07T12:00:00.000Z'});
  // C: call, approved after 1h, still waiting for the manager
  await kase('C', 'pending_assignment', '2026-09-08T05:00:00.000Z', {sales: 'sm'}, {source: 'call', approvedAt: '2026-09-08T06:00:00.000Z'});
  // D: registered in August
  await kase('D', 'pending_approval', '2026-08-31T05:00:00.000Z', {}, {source: 'email'});
  // E: website, still waiting for approval since the 9th
  await kase('E', 'pending_approval', '2026-09-09T05:00:00.000Z', {}, {source: 'website'});
  // F: the other customer-service manager's team
  await kase('F', 'pending_approval', '2026-09-10T05:00:00.000Z', {creator: 'cs2', manager: 'csm2'}, {source: 'social'});
  await contact('a1', 'A', 'c-A', '2026-09-06T09:00:00.000Z', {salesStage: 'new'});
  await contact('a2', 'A', 'c-A', '2026-09-10T07:00:00.000Z', {salesStage: 'won', date: '2026-09-10'});
  await contact('b1', 'B', 'c-B', '2026-09-09T05:00:00.000Z', {salesStage: 'lost', lossReason: 'السعر أعلى من المنافس'});
  const before = await count();

  // ---- who may read it
  check((await app.request('/api/service-report')).status, 401, 'anonymous callers get 401');
  for (const id of ['sup', 'rep', 'cs', 'cs2']) {
    const denied = await report(id, '2026-09');
    check([id, denied.status, denied.json().error], [id, 403, 'التقرير متاح لمدير النظام ومدير المبيعات ومدير خدمة العملاء فقط'], id + ' is refused with the reason');
  }
  for (const id of ['owner', 'sm', 'sm2', 'smw', 'csm', 'csm2']) check([id, (await report(id, '2026-09')).status], [id, 200], id + ' may read it');

  // ---- the administrator sees every case of the month
  const response = await report('owner', '2026-09');
  check(response.headers['cache-control'], 'no-store', 'never cached');
  let r = response.json();
  check([r.month, r.total, r.open, r.won, r.lost, r.winRate], ['2026-09', 5, 3, 1, 1, 50], 'September: five cases, three open, one won, one lost');
  check(r.byState, {won: 1, lost: 1, pending_assignment: 1, pending_approval: 2}, 'by current state');
  check(r.bySource.map(s => [s.source, s.total, s.won, s.lost, s.open, s.winRate]), [['call', 2, 1, 0, 1, 100], ['social', 1, 0, 0, 1, null], ['website', 1, 0, 0, 1, null], ['whatsapp', 1, 0, 1, 0, 0]], 'by channel, busiest first');
  check(r.timing.approval, {n: 3, median: 1, average: 2.67, target: 4, overTarget: 1}, 'approval time in working hours');
  check(r.timing.assignment, {n: 2, median: 1.5, average: 1.5, target: 4, overTarget: 0}, 'assignment time');
  check(r.timing.firstContact, {n: 2, median: 7, average: 7, target: 24, overTarget: 0}, 'first contact after assignment');
  check(r.timing.totalToFirstContact, {n: 2, median: 12, average: 12, target: null, overTarget: 0}, 'registration to first contact, which has no target');
  check(r.lossReasons, [{reason: 'السعر أعلى من المنافس', count: 1}], 'the loss reason comes from the closing contact');
  check(r.openOverTarget, 3, 'three open cases are past their stage target');
  check(r.months, ['2026-09', '2026-08'], 'the months a reader can choose');
  check(r.targets, {approval: 4, assignment: 4, delegation: 4, first_contact: 24}, 'the targets travel with the figures');
  check(Object.keys(r).sort(), ['bySource', 'byState', 'generatedAt', 'lossReasons', 'lost', 'month', 'months', 'open', 'openOverTarget', 'targets', 'timing', 'total', 'winRate', 'won'], 'aggregate fields only');

  // ---- nothing a customer or a note could leak through
  for (const id of ['owner', 'sm', 'csm']) {
    const body = (await report(id, '2026-09')).text;
    check([id, /مصنع|PRIVATE-|c-[A-F]\b|rep@yourrest/.test(body)], [id, false], id + ': no customer, case, contact text or address in the answer');
  }

  // ---- each reader gets only what they may already read
  r = (await report('sm', '2026-09')).json();
  check([r.total, r.byState, r.months], [3, {won: 1, lost: 1, pending_assignment: 1}, ['2026-09']], 'the routed manager: his cases and the held ones, not those still awaiting approval');
  r = (await report('sm2', '2026-09')).json();
  check([r.total, r.byState, r.openOverTarget], [2, {won: 1, lost: 1}, 0], 'another manager: the cases sales already hold (a manager\'s scope is all of sales), not the one routed to the first');
  r = (await report('smw', '2026-09')).json();
  check([r.total, r.months, r.bySource, r.timing.approval.n], [0, [], [], 0], 'a manager of another region sees an empty report');
  r = (await report('csm', '2026-09')).json();
  check([r.total, r.byState, r.bySource.some(s => s.source === 'social')], [4, {won: 1, lost: 1, pending_assignment: 1, pending_approval: 1}, false], 'a customer-service manager: his own team\'s cases, not the other manager\'s');
  check([r.lossReasons, r.timing.firstContact.n, r.timing.approval.n], [[{reason: 'السعر أعلى من المنافس', count: 1}], 2, 3], 'including the sales contacts of those cases (their figures and loss reasons)');
  r = (await report('csm2', '2026-09')).json();
  check([r.total, r.bySource.map(s => s.source), r.lossReasons], [1, ['social'], []], 'the other customer-service manager: only his');

  // ---- months
  check((await report('owner', '2026-08')).json().total, 1, 'August has one case');
  check((await report('owner', '2026-07')).json().total, 0, 'a month without cases is an empty report, not an error');
  const current = (await report('owner')).json();
  check(/^\d{4}-(0[1-9]|1[0-2])$/.test(current.month) && current.month === new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()).slice(0, 7), true, 'without a month the report is for the current one');
  for (const bad of ['2026-13', '2026-00', '26-09', '2026-9', '2026-09-01', 'x', '%20']) {
    const refused = await report('owner', bad);
    check([bad, refused.status, typeof refused.json().error], [bad, 400, 'string'], 'an invalid month is refused: ' + bad);
  }

  // ---- reading changes nothing
  check(await count(), before, 'no record or case was written by reading the report');
  check((await as('owner')('/api/service-report', {method: 'POST', body: {}})).status >= 400, true, 'the endpoint only reads');

  console.log(JSON.stringify({ok: true, checks, builtRelease: true, productionDataUsed: false}));
} finally { await app.stop(); }
