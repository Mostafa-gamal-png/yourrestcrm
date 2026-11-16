// «شكوى تنتظرك» (GET /api/complaints/alerts, lib/complaint-alerts.ts; the owner, 2026-11-16, item 3 of the GSCO list, «ج») over real HTTP
// against the BUILT release (run the build first), asked as the Android app asks it (the session cookie, no Origin): anonymous 401, and
// after signing out; a member whose complaints screen is hidden 404 («الشكاوى» for customer service, «الزيارات» for the sales team); a POST
// 405; never cached; every member is told exactly the complaints waiting for them (the review, the correction, the assignment, the
// delegation, the contact, the resolution, the closure), high importance first, only the fields a notice needs; opening a complaint as its
// holder (the page's own «seen») marks it seen; a step done moves the complaint to the next one; a deactivated member is refused.
// Synthetic fixtures only: temporary SQLite, mocked mail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف'}, {id: 'rep', role: 'rep', sup: 'sup', name: 'المندوب'}, {id: 'rep2', role: 'rep', sup: 'sup', name: 'مندوب ثانٍ'},
  {id: 'reph', role: 'rep', sup: 'sup', name: 'مندوب بلا زيارات'},
  {id: 'csm', role: 'customer_service_manager', sup: 'mgr', name: 'مدير خدمة العملاء'}, {id: 'cs', role: 'customer_service', sup: 'csm', name: 'خدمة العملاء'},
  {id: 'csh', role: 'customer_service', sup: 'csm', name: 'خدمة بلا شكاوى'}
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const app = await bootBuiltApp({members});
try {
  const now = new Date().toISOString(), at = hours => new Date(Date.now() - hours * 3600000).toISOString();
  const insert = (id, kind, assigned, data, when = at(30)) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,NULL,?,'الرئيسي',?,?,?,1,'fixture')").bind(id, kind, assigned, JSON.stringify(data), when, when).run();
  for (const id of ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7']) await insert(id, 'customer', 'rep', {name: 'مصنع ' + id, region: 'الشرقية', city: 'الدمام', phone: '0500000000'});
  const base = {kind: 'complaint', status: 'submitted', registrarId: 'cs', serviceManagerId: 'csm', salesManagerId: '', supervisorId: '', assigneeId: '', channel: 'call', category: 'product_quality', severity: 'normal', description: 'PRIVATE-DESCRIPTION', demand: 'PRIVATE-DEMAND', reference: 'INV-9', contactName: 'PRIVATE-CONTACT', contactPhone: '0599999999', submittedAt: at(30), forwardedAt: '', returnedAt: '', assignedAt: '', delegatedAt: '', reassignedAt: '', rejectedAt: '', reopenedAt: '', resolvedAt: '', closedAt: '', cancelledAt: '', seenAt: '', returnNote: '', assignmentNote: '', rejectReason: '', cancelReason: '', previousAssignees: [], updates: [], notes: [], events: []};
  const complaint = (id, data, when) => insert(id, 'complaint', data.registrarId || 'cs', {...base, ...data}, when);
  const sales = {salesManagerId: 'mgr', supervisorId: 'sup', assigneeId: 'rep', forwardedAt: at(29), assignedAt: at(28)};
  await complaint('complaint-review', {customerId: 'k1', complaintNumber: 1});
  await complaint('complaint-fix', {customerId: 'k2', complaintNumber: 2, status: 'returned', returnedAt: at(29)});
  await complaint('complaint-assign', {customerId: 'k3', complaintNumber: 3, status: 'pending_assignment', salesManagerId: 'mgr', forwardedAt: at(29), severity: 'high', category: 'delivery_delay'});
  await complaint('complaint-delegate', {customerId: 'k4', complaintNumber: 4, status: 'assigned', ...sales, assigneeId: 'sup'});
  await complaint('complaint-contact', {customerId: 'k5', complaintNumber: 5, status: 'assigned', ...sales});
  await complaint('complaint-resolve', {customerId: 'k6', complaintNumber: 6, status: 'assigned', ...sales, severity: 'high', seenAt: at(27), updates: [{id: 'u1', at: at(26), by: 'rep', channel: 'call', date: at(26).slice(0, 10), text: 'PRIVATE-UPDATE'}]});
  await complaint('complaint-close', {customerId: 'k7', complaintNumber: 7, status: 'resolved', ...sales, updates: [{id: 'u2', at: at(26), by: 'rep', channel: 'call', date: at(26).slice(0, 10), text: 'PRIVATE-UPDATE'}], resolvedAt: at(25), resolution: {outcome: 'solved', note: 'PRIVATE-RESOLUTION', by: 'rep', at: at(25)}});
  await complaint('complaint-closed', {customerId: 'k7', complaintNumber: 8, status: 'closed', ...sales, closedAt: at(20), closure: {outcome: 'satisfied', note: '', by: 'cs', at: at(20)}});
  // «الصلاحيات»: «الشكاوى» hidden from csh, «الزيارات» from reph (where a representative meets complaints).
  for (const [id, hidden] of [['csh', ['complaints']], ['reph', ['activity']]]) await app.db.prepare('INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_at,updated_by) VALUES(?,?,?,1,?,?)').bind(id, '{}', JSON.stringify(hidden), now, 'owner').run();
  const cookies = {};
  for (const member of members) cookies[member.id] = await app.login(member.id);
  // As the Android app asks: the WebView's session cookie, no Origin header.
  const alerts = who => app.request('/api/complaints/alerts', {headers: who ? {Cookie: cookies[who]} : {}});
  const feed = async who => { const response = await alerts(who); eq(response.status, 200, 'GET /api/complaints/alerts as ' + who + ' -> ' + response.text.slice(0, 160)); return response.json(); };
  const brief = body => body.alerts.map(alert => [alert.id.replace('complaint-', ''), alert.awaiting, alert.seen]);

  // ---- the doors
  eq([(await alerts(null)).status, (await alerts(null)).json().error], [401, 'سجّل الدخول للوصول إلى التطبيق.'], 'anonymous: 401');
  eq([(await alerts('csh')).status, (await alerts('csh')).json().error], [404, 'هذا الجزء غير متاح لحسابك. راجع مدير النظام.'], 'customer service with «الشكاوى» hidden: 404');
  eq((await alerts('reph')).status, 404, 'a representative with «الزيارات» hidden (where he meets complaints): 404');
  eq((await app.as(cookies.rep)('/api/complaints/alerts', {method: 'POST', body: {}})).status, 405, 'GET only');
  const response = await alerts('rep');
  eq([response.headers['cache-control'], /application\/json/.test(response.headers['content-type'] || '')], ['no-store', true], 'JSON, never cached');

  // ---- whose turn
  eq(brief(await feed('csm')), [['review', 'review', false]], 'the customer-service manager: the review');
  eq(brief(await feed('cs')).sort(), [['close', 'close', false], ['fix', 'fix', false]], 'the registrar: the correction and the closure');
  eq(brief(await feed('mgr')), [['assign', 'assign', false]], 'the sales manager: the assignment');
  eq(brief(await feed('sup')), [['delegate', 'delegate', false]], 'the supervisor: the delegation');
  let rep = await feed('rep');
  eq(brief(rep), [['resolve', 'resolve', true], ['contact', 'contact', false]], 'the representative: the resolution (high importance, opened) first, then the contact');
  eq((await feed('rep2')).alerts, [], 'another representative: nothing');
  eq((await feed('owner')).alerts, [], 'the administrator: nothing is waiting for him alone');
  eq([rep.schemaVersion, rep.memberId, rep.count], [1, 'rep', 2], 'the answer names the member and counts what waits');
  eq(Object.keys(rep.alerts[0]).sort(), ['awaiting', 'category', 'categoryAr', 'categoryEn', 'customerName', 'id', 'seen', 'severity', 'since'], 'only the fields a notice needs');
  const all = JSON.stringify([await feed('csm'), await feed('cs'), await feed('mgr'), await feed('sup'), rep]);
  ok(!/PRIVATE|0599999999|الدمام|INV-9|"complaintNumber"/.test(all), 'no description, demand, contact, phone, city, reference, update text or number leaves');

  // ---- the page's own steps move the alerts: the holder opens the contact complaint; the manager forwards the review
  const list = (await app.as(cookies.rep)('/api/complaints')).json().complaints, contact = list.find(entry => entry.id === 'complaint-contact');
  eq((await app.as(cookies.rep)('/api/complaints', {method: 'POST', body: {action: 'seen', id: 'complaint-contact', version: contact.version, requestId: crypto.randomUUID()}})).status, 200, 'the representative opens the complaint (the page records it)');
  eq(brief(await feed('rep')).find(row => row[0] === 'contact'), ['contact', 'contact', true], 'now seen: the phone takes its notice away');
  const review = (await app.as(cookies.csm)('/api/complaints')).json().complaints.find(entry => entry.id === 'complaint-review');
  eq((await app.as(cookies.csm)('/api/complaints', {method: 'POST', body: {action: 'forward', id: 'complaint-review', version: review.version, targetId: 'mgr', requestId: crypto.randomUUID()}})).status, 200, 'the customer-service manager forwards it to the sales manager');
  eq(brief(await feed('csm')), [], 'it no longer waits for him');
  eq(brief(await feed('mgr')).map(row => row[0]).sort(), ['assign', 'review'], 'it waits for the sales manager\'s assignment now');

  // ---- signed out, deactivated
  eq((await app.as(cookies.rep2)('/api/auth/logout', {method: 'POST'})).status < 400, true, 'rep2 signs out');
  eq((await alerts('rep2')).status, 401, 'after signing out: 401 (the app takes its notices away)');
  await app.db.prepare("UPDATE crm_members SET active=0 WHERE id='sup'").run();
  ok([401, 403].includes((await alerts('sup')).status), 'a deactivated member is refused');
  console.log(JSON.stringify({ok: true, checks, syntheticFixtures: true, productionDataUsed: false}));
} finally { await app.stop(); }
