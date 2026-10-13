// The customer-service case from registration to first contact, over real HTTP against the BUILT release (run `pnpm build`
// first): what each role receives in /api/crm, who may act, history visibility along the case's chain, re-assignment,
// the optional note, first opening, and that the customer-service registration text never reaches a sales reader.
// Synthetic isolated fixtures only: temporary SQLite, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'}, {id: 'sm2', role: 'manager'},
  {id: 'sup', role: 'supervisor', sup: 'sm'}, {id: 'sup2', role: 'supervisor', sup: 'sm2'},
  {id: 'rep', role: 'rep', sup: 'sup'}, {id: 'rep2', role: 'rep', sup: 'sup'}, {id: 'outside', role: 'rep', sup: 'sup2'}, {id: 'repw', role: 'rep', sup: 'sup', region: 'western'},
  {id: 'csm', role: 'customer_service_manager', sup: 'sm'}, {id: 'cs', role: 'customer_service', sup: 'csm'}
];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date());
const app = await bootBuiltApp({members});
try {
  const sessions = {};
  for (const member of members) sessions[member.id] = await app.login(member.id);
  const as = id => app.as(sessions[id]);
  const now = new Date().toISOString();
  const customer = (id, assignedTo, region = 'الشرقية') => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, assignedTo, JSON.stringify({name: 'مصنع ' + id, region, city: 'الدمام', phone: '0500000000', contact: 'م', code: id, branch: 'الرئيسي', assignedTo}), now, now).run();
  await customer('f1', 'rep'); await customer('f2', 'outside'); await customer('f3', 'owner');
  const crm = async id => (await as(id)('/api/crm')).json();
  const queue = async id => (await crm(id)).serviceQueue;
  const cases = async id => (await as(id)('/api/customer-service')).json();
  const getCase = async (id, caseId) => (await cases(id)).cases.find(item => item.id === caseId);
  const act = async (id, caseId, body) => { const item = await getCase(id, caseId); return as(id)('/api/customer-service', {method: 'POST', body: {requestId: crypto.randomUUID(), id: caseId, version: item?.version, ...body}}); };
  const entry = (list, caseId) => list.find(item => item.id === caseId);
  const alerts = async id => (await as(id)('/api/service-queue/alerts')).json();
  const alertRows = async id => (await alerts(id)).alerts.map(item => [item.id, item.awaiting, item.seen]);
  const registration = {type: 'call', summary: 'PRIVATE-REGISTRATION-SUMMARY', result: 'متابعة العميل', salesStage: 'won', strength: 'strong', requestedProducts: ['قوالب البلوك المتحركة', 'خدمات صيانة'], nextAction: 'متابعة الاحتياج', nextDate: day, location: '26.437341, 50.034499', locationSource: 'device', locationCapturedAt: now, locationAccuracy: 12, customerNeeds: 'طلب صيانة وقالب', hasCompetitor: true, competitorName: 'Competitor', competitorNotes: 'PRIVATE-COMPETITOR-NOTE'};

  // ---- the field exists for everyone; with nothing registered yet, nobody has anything waiting
  for (const id of ['owner', 'sm', 'sup', 'rep', 'cs', 'csm']) check(Array.isArray((await crm(id)).serviceQueue), true, id + ' receives a serviceQueue list');
  check([(await queue('cs')).length, (await queue('csm')).length], [0, 0], 'nothing waits yet for either customer-service role');
  check((await app.request('/api/service-queue/alerts')).status, 401, 'anonymous callers get 401 from the alerts endpoint too');
  for (const id of ['owner', 'sm', 'sup', 'rep', 'cs', 'csm']) { const answer = await as(id)('/api/service-queue/alerts'); check([id, answer.status, answer.headers['cache-control'], answer.json().alerts, answer.json().memberId], [id, 200, 'no-store', [], id], id + ' asks the app endpoint: nothing waits, never cached'); }
  // ---- registration by customer service, with a private registration text
  const created = await as('cs')('/api/customer-service', {method: 'POST', body: {action: 'create', requestId: crypto.randomUUID(), customerId: 'f1', customerVersion: 1, registration, elapsedMilliseconds: 2200}});
  check(created.status, 200, 'customer service registers a request: ' + created.text.slice(0, 100));
  const id1 = created.json().id;
  check((await queue('sm')).length + (await queue('sup')).length + (await queue('rep')).length, 0, 'an unapproved request is not in any sales queue');
  const adminFirst = entry(await queue('owner'), id1);
  check([adminFirst.stage, adminFirst.awaiting, adminFirst.ownerId, adminFirst.targetHours], ['approval', 'approve', 'csm', 4], 'the administrator sees it waiting for the customer-service manager');
  // ---- the customer-service manager sees the same wait on his own screen, and a late one is marked for him
  const csmFirst = entry(await queue('csm'), id1);
  check([csmFirst.stage, csmFirst.awaiting, csmFirst.ownerId, csmFirst.late, csmFirst.escalated, csmFirst.permissions.approve], ['approval', 'approve', 'csm', false, false, true], 'the customer-service manager sees the request waiting for his approval, not late yet');
  check([(await queue('csm')).length, (await queue('cs')).length], [1, 0], 'his queue holds only that approval; the registrar who typed it receives no queue');
  check([await alertRows('csm'), (await alerts('csm')).count, await alertRows('cs')], [[[id1, 'approve', false]], 1, []], 'the app is told of it for the manager it waits for, and not for the registrar');
  check(JSON.stringify(await queue('csm')).includes('PRIVATE-'), false, 'his queue carries no registration text');
  const originalCreatedAt = await app.db.prepare('SELECT created_at FROM crm_service_cases WHERE id=?').bind(id1).first('created_at');
  await app.db.prepare('UPDATE crm_service_cases SET created_at=? WHERE id=?').bind(new Date(Date.now() - 30 * 86400000).toISOString(), id1).run();
  const csmLate = entry(await queue('csm'), id1);
  check([csmLate.late, csmLate.stageHours > 4, csmLate.escalated, csmLate.targetHours], [true, true, false, 4], 'left for a month it is marked late for the one who owes the approval');
  const adminLate = entry(await queue('owner'), id1);
  check([adminLate.late, adminLate.escalated], [true, true], 'and escalated to the administrator as before');
  check([(await queue('sm')).length, (await queue('sup')).length, (await queue('rep')).length], [0, 0, 0], 'while no sales role can see a request that has not been approved');
  await app.db.prepare('UPDATE crm_service_cases SET created_at=? WHERE id=?').bind(originalCreatedAt, id1).run();

  // ---- approval routes it to the manager, whose queue now carries it
  check((await act('csm', id1, {action: 'approve', targetId: 'sm'})).status, 200, 'the customer-service manager approves to the sales manager');
  check([await alertRows('sm'), await alertRows('csm'), await alertRows('cs'), await alertRows('sup')], [[[id1, 'assign', false]], [], [], []], 'the app is told only for the manager the request now waits for');
  const managerAlert = (await alerts('sm')).alerts[0];
  check([managerAlert.customerName, managerAlert.need, Object.keys(managerAlert).sort()], ['مصنع f1', 'طلب صيانة وقالب', ['awaiting', 'customerName', 'id', 'need', 'seen', 'since']], 'with the customer, the short need and nothing else');
  check(JSON.stringify(await alerts('sm')).includes('PRIVATE-') || JSON.stringify(await alerts('owner')).includes('PRIVATE-'), false, 'no registration text or competitor note in any alert');
  check((await alerts('owner')).alerts, [], 'the administrator is not personally waited for');  check((await queue('sm2')).length, 0, 'another manager does not see it');
  check((await queue('sup')).length, 0, 'a supervisor does not see a case still waiting for the manager');
  let smEntry = entry(await queue('sm'), id1);
  check([smEntry.stage, smEntry.awaiting, smEntry.ownerId, smEntry.late, smEntry.currentRepId, smEntry.permissions.assign], ['assignment', 'assign', 'sm', false, 'rep', true], 'the manager sees it awaiting his assignment, with the customer\'s current representative');
  check([smEntry.customerName, smEntry.source, smEntry.strength, smEntry.creatorName, smEntry.serviceManagerName], ['مصنع f1', 'call', 'strong', 'cs', 'csm'], 'the brief and the people');
  const smCase = await getCase('sm', id1);
  check([smCase.suggestedId, smCase.candidates.map(m => m.id).sort()], ['rep', ['outside', 'rep', 'rep2', 'sup', 'sup2']], 'the assignment sheet offers every supervisor and representative of the customer\'s region and branch (a manager\'s scope is all of sales), the current representative suggested');
  check(smCase.candidates.some(m => m.id === 'repw'), false, 'nobody from another region is offered');
  const everythingSm = JSON.stringify(await crm('sm')) + JSON.stringify(await cases('sm'));
  check(everythingSm.includes('PRIVATE-'), false, 'the registration text and competitor notes never reach the manager');

  // ---- assignment to a supervisor with a note, then delegation to a representative with another
  check((await act('sm', id1, {action: 'assign', targetId: 'sup', note: 'ركّز على قطع الغيار'})).status, 200, 'the manager assigns to a supervisor with an instruction');
  check([await alertRows('sm'), await alertRows('sup')], [[], [[id1, 'delegate', false]]], 'the request moves from the manager\'s alerts to the supervisor\'s');  let supEntry = entry(await queue('sup'), id1);
  check([supEntry.stage, supEntry.awaiting, supEntry.assignmentNote, supEntry.assignmentNoteBy, supEntry.permissions.delegate], ['delegation', 'delegate', 'ركّز على قطع الغيار', 'sm', true], 'the supervisor sees it awaiting delegation with the instruction');
  check(entry(await queue('sm'), id1).stage, 'delegation', 'the manager follows it');
  check((await queue('rep')).length, 0, 'the representative does not see it yet');
  check((await act('sup', id1, {action: 'delegate', targetId: 'rep2', note: 'ابدأ بالاتصال'})).status, 200, 'the supervisor delegates to a representative with a note');
  check([await alertRows('sup'), await alertRows('rep2'), await alertRows('rep')], [[], [[id1, 'first_contact', false]], []], 'then to the representative it reaches, unopened');
  const firstSince = (await alerts('rep2')).alerts[0].since;  check((await act('sup', id1, {action: 'delegate', targetId: 'rep2'})).status, 403, 'delegating to the current holder again is refused');
  check((await act('sup', id1, {action: 'delegate', targetId: 'repw'})).status, 403, 'delegating outside the region is refused');

  // ---- the representative: brief, instruction, chain history, never the private registration
  let repEntry = entry(await queue('rep2'), id1);
  check([repEntry.stage, repEntry.awaiting, repEntry.assignmentNote, repEntry.seenAt, repEntry.permissions.followup, repEntry.permissions.seen], ['first_contact', 'first_contact', 'ابدأ بالاتصال', '', true, true], 'the representative sees a new case with the latest instruction');
  check((await queue('rep')).length, 0, 'another representative sees nothing');
  const repCase = await getCase('rep2', id1);
  const labels = repCase.history.map(h => h.actor + ':' + h.detail.label);
  check(labels, ['cs:تسجيل طلب خدمة العملاء', 'csm:اعتماد وإحالة للمبيعات', 'sm:تكليف المبيعات', 'sup:تكليف مندوب'], 'the case history reaches the representative along the case\'s own chain');
  check(repCase.history.filter(h => h.detail.note).map(h => h.detail.note), ['ركّز على قطع الغيار', 'ابدأ بالاتصال'], 'including the instructions written for him');
  check(repCase.data.registration, undefined, 'the registration itself stays out of the representative\'s payload');
  const everythingRep = JSON.stringify(await crm('rep2')) + JSON.stringify(await cases('rep2'));
  check(everythingRep.includes('PRIVATE-'), false, 'no registration text, competitor note or file name reaches the representative');
  check((await queue('rep2')).every(item => item.assignedTo === 'rep2'), true, 'only his own cases');

  // ---- internal notes along the chain; a stranger's notes stay private
  check((await act('rep2', id1, {action: 'note', note: 'العميل يطلب موعدًا صباحيًا'})).status, 200, 'the holder writes an internal note');
  check((await act('sup', id1, {action: 'note', note: 'ملاحظة المشرف'})).status, 200, 'the supervisor writes one');
  check((await act('cs', id1, {action: 'assist', note: 'طلب مساعدة من خدمة العملاء: العميل يسأل عن الموعد'})).status, 200, 'customer service asks for help');
  const afterNotes = await getCase('rep2', id1);
  check(afterNotes.history.some(h => h.detail.note === 'طلب مساعدة من خدمة العملاء: العميل يسأل عن الموعد'), true, 'the holder now reads the assistance request addressed to him');
  check(afterNotes.history.some(h => h.detail.note === 'ملاحظة المشرف'), true, 'and his supervisor\'s note');
  check((await act('rep2', id1, {action: 'reply', note: 'تم تحديد الموعد'})).status, 200, 'the holder replies');
  check((await getCase('cs', id1)).data.assistanceOpen, false, 'the request is closed by the reply');

  // ---- first opening
  check(smEntry.seenAt, '', 'not opened before');
  check((await act('rep2', id1, {action: 'seen'})).status, 200, 'the holder marks the case opened');
  const again = await act('rep2', id1, {action: 'seen'});
  check([again.status, again.json().alreadySeen], [200, true], 'opening twice records once');
  check(await alertRows('rep2'), [[id1, 'first_contact', true]], 'once opened, the alert says so and the app stays silent');  check((await act('sup', id1, {action: 'seen'})).status, 403, 'only the holder can mark it opened');
  check((await act('cs', id1, {action: 'seen'})).status, 403, 'customer service cannot either');
  const seenEntry = entry(await queue('sm'), id1);
  check([seenEntry.seenByName, seenEntry.seenAt.length > 10], ['rep2', true], 'the manager sees who opened it and when');
  check((await getCase('cs', id1)).data.seenAt.length > 10, true, 'customer service sees it too');

  // ---- re-assignment
  const holder = await getCase('sm', id1);
  check(holder.permissions.reassign, true, 'the manager may re-assign a held case');
  check((await act('rep2', id1, {action: 'reassign', targetId: 'rep'})).status, 403, 'a representative may not');
  check((await act('sm2', id1, {action: 'reassign', targetId: 'rep'})).status, 403, 'nor another manager, although he can read a held case');
  check((await act('sm', id1, {action: 'reassign', targetId: 'rep2'})).status, 403, 'the current holder is not a valid target');
  check((await act('sm', id1, {action: 'reassign', targetId: 'repw'})).status, 403, 'nor is someone from another region');
  check((await act('sm', id1, {action: 'reassign', targetId: 'rep', note: 'انتقل إليك بدل زميلك'})).status, 200, 'the manager re-assigns to another representative with a note');
  const moved = await alerts('rep');
  check([await alertRows('rep2'), moved.alerts.map(item => [item.id, item.awaiting, item.seen]), moved.alerts[0].since > firstSince], [[], [[id1, 'first_contact', false]], true], 'a re-assignment tells the new holder afresh, with a newer start');  const owned = await app.db.prepare("SELECT assigned_to AS a FROM crm_records WHERE id='f1'").first();
  check(owned.a, 'rep', 'the customer moved with the case');
  const newHolder = entry(await queue('rep'), id1);
  check([newHolder.stage, newHolder.awaiting, newHolder.seenAt, newHolder.contactsSinceDispatch, newHolder.assignmentNote], ['first_contact', 'first_contact', '', 0, 'انتقل إليك بدل زميلك'], 'the new holder starts afresh: not opened, no contact, the manager\'s note');
  check((await queue('rep2')).length, 0, 'the previous holder no longer sees the case');
  check(await getCase('rep2', id1), undefined, 'nor can he read it through the case API');
  const newView = await getCase('rep', id1);
  check(newView.history.some(h => h.actor === 'rep2'), false, 'the new holder does not read the previous holder\'s notes');
  check(newView.history.some(h => h.detail.label === 'إعادة تكليف' && h.detail.note === 'انتقل إليك بدل زميلك'), true, 'but does read the re-assignment and its note');
  const adminView = await getCase('owner', id1);
  check(adminView.history.some(h => h.actor === 'rep2'), true, 'the administrator keeps the whole history');
  check(adminView.history.filter(h => h.detail.label === 'إعادة تكليف').length, 1, 'the re-assignment is recorded once');
  check((await act('owner', id1, {action: 'reassign', targetId: 'rep2'})).status, 200, 'the administrator may re-assign too');
  check((await act('owner', id1, {action: 'reassign', targetId: 'rep'})).status, 200, 'and again, back');

  // ---- first contact leaves the queue's "new" state and the stage moves on
  const visit = await as('rep')('/api/visits', {method: 'POST', body: {createKey: crypto.randomUUID(), customerId: 'f1', customerVersion: (await app.db.prepare("SELECT version FROM crm_records WHERE id='f1'").first()).version, timingMode: 'automatic', elapsedMilliseconds: 2000, data: {type: 'call', date: day, summary: 'تواصل مع العميل', result: 'تم التواصل', salesStage: 'new', strength: 'medium', nextAction: 'زيارة فنية', nextDate: day, location: '26.43, 50.03', locationSource: 'device', locationCapturedAt: new Date().toISOString(), locationAccuracy: 10}}});
  check(visit.status, 200, 'the representative records the first contact: ' + visit.text.slice(0, 120));
  const contacted = entry(await queue('rep'), id1);
  check([await alertRows('rep'), (await alerts('rep')).count], [[], 0], 'after the first contact nothing waits for him and the count clears');  check([contacted.stage, contacted.awaiting, contacted.contactsSinceDispatch, contacted.targetHours, contacted.late], ['follow_up', null, 1, null, false], 'the case is now in follow-up and no longer awaits him');
  check(entry(await queue('sm'), id1).stage, 'follow_up', 'the manager sees the same stage');
  check((await getCase('cs', id1)).contacts.length, 1, 'customer service sees the contact');
  check((await act('sm', id1, {action: 'reassign', targetId: 'rep2'})).status, 200, 'a case with contacts can still be re-assigned');
  const afterMove = entry(await queue('rep2'), id1);
  check([afterMove.stage, afterMove.contactCount, afterMove.contactsSinceDispatch], ['first_contact', 0, 0], 'he sees none of the previous holder\'s contacts and owes his own first contact');
  check(entry(await queue('sm'), id1).contactCount, 1, 'while the manager still counts the earlier contact in the case history');

  // ---- the case API still refuses what it always refused
  check((await act('rep2', id1, {action: 'assign', targetId: 'rep'})).status, 403, 'a representative cannot assign');
  check((await act('cs', id1, {action: 'reassign', targetId: 'rep'})).status, 403, 'customer service cannot re-assign');
  check((await as('rep')('/api/customer-service', {method: 'POST', body: {action: 'bogus', requestId: crypto.randomUUID(), id: id1, version: 1}})).status, 400, 'unknown actions are rejected');
  check((await app.request('/api/crm')).status, 401, 'anonymous callers get 401');

  // ---- a returned case restarts the approval clock
  const second = await as('cs')('/api/customer-service', {method: 'POST', body: {action: 'create', requestId: crypto.randomUUID(), customerId: 'f3', customerVersion: 1, data: {source: 'email', products: ['خدمات صيانة'], strength: 'weak', needs: 'استفسار', nextAction: 'اتصال', nextDate: day}}});
  const id2 = second.json().id;
  check((await act('csm', id2, {action: 'return', note: 'أكمل بيانات الاحتياج'})).status, 200, 'returned for correction');
  const returned = entry(await queue('owner'), id2);
  check([returned.stage, returned.ownerId, returned.targetHours], ['returned', 'cs', null], 'a returned case waits for its registrar with no target');
  check((await act('cs', id2, {action: 'edit', data: {source: 'email', products: ['خدمات صيانة'], strength: 'weak', needs: 'استفسار مفصل', nextAction: 'اتصال', nextDate: day}})).status, 200, 'the registrar resubmits');
  const resubmitted = entry(await queue('owner'), id2);
  check([resubmitted.stage, resubmitted.awaiting], ['approval', 'approve'], 'back to approval');
  check(Date.parse((await getCase('owner', id2)).data.resubmittedAt) > Date.now() - 60000, true, 'the approval clock restarted at resubmission');

  console.log(JSON.stringify({ok: true, checks, builtRelease: true, productionDataUsed: false}));
} finally { await app.stop(); }
