// Customer-service assistance over real HTTP against the BUILT release (run `pnpm build` first): a representative asks for
// help with a customer, the request is routed to the customer-service member of that region, who contacts the customer and submits
// the result; the customer-service manager approves it (or returns it) and hands it to a sales manager, who assigns a supervisor or a
// representative (who may delegate); that member contacts the customer and records the result; customer service confirms and closes
// it (or returns it to the representative). A visit that went unanswered is routed to customer service on its own and taken by one
// member only and follows the same course. Who sees and who may act at each step; idempotent retries and stale versions; and that none
// of it leaks into the visit, record or customer-service-case pipelines.
// Synthetic isolated fixtures only: temporary SQLite, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'}, {id: 'sm2', role: 'manager'},
  {id: 'sup', role: 'supervisor', sup: 'sm'}, {id: 'sup2', role: 'supervisor', sup: 'sm2'},
  {id: 'rep', role: 'rep', sup: 'sup'}, {id: 'rep2', role: 'rep', sup: 'sup'}, {id: 'outside', role: 'rep', sup: 'sup2'},
  {id: 'csm', role: 'customer_service_manager', sup: 'sm'},
  {id: 'cs_east', role: 'customer_service', sup: 'csm', region: 'eastern'}, {id: 'cs_west', role: 'customer_service', sup: 'csm', region: 'western'}, {id: 'cs_all', role: 'customer_service', sup: 'csm'},
  {id: 'csm_b', role: 'customer_service_manager', sup: 'sm', branch: 'فرع آخر'}, {id: 'cs_b', role: 'customer_service', sup: 'csm_b', branch: 'فرع آخر'}
];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const dayOf = offset => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date(Date.now() + offset * 86400000));
const today = dayOf(0);
const app = await bootBuiltApp({members});
try {
  const sessions = {};
  for (const member of members) sessions[member.id] = await app.login(member.id);
  const as = id => app.as(sessions[id]);
  const now = new Date().toISOString();
  const customer = (id, assignedTo, region, branch = 'الرئيسي') => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,?,?,?,?,1,'fixture')")
    .bind(id, assignedTo, branch, JSON.stringify({name: 'مصنع ' + id, region, city: 'الدمام', phone: '0551234567', contact: 'م', code: id, branch, assignedTo}), now, now).run();
  await customer('f1', 'rep', 'الشرقية'); await customer('f2', 'rep2', 'الغربية'); await customer('f3', 'rep', 'الوسطى'); await customer('f4', 'outside', 'الشرقية');
  await customer('f5', 'rep', 'الشرقية', 'فرع آخر'); await customer('f6', 'rep', 'الشرقية'); await customer('f7', 'rep', 'الغربية');
  const version = async id => (await app.db.prepare('SELECT version FROM crm_records WHERE id=?').bind(id).first())?.version ?? 1;
  const seedVisit = (id, customerId, fields = {}) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'activity',?,'rep','الرئيسي',?,?,?,1,'fixture')")
    .bind(id, customerId, JSON.stringify({type: 'visit', date: dayOf(-8), startedAt: dayOf(-8) + 'T07:00:00.000Z', result: 'سلبية', summary: 'PRIVATE-VISIT-SUMMARY', notes: 'PRIVATE-VISIT-NOTES', salesStage: 'new', nextAction: 'زيارة متابعة', nextDate: dayOf(-5), visitWorkflow: 'customer-v1', performedBy: 'rep', responsibleId: 'rep', recordedByEmail: 'rep@yourrest.org', ...fields}), fields.createdAt || now, fields.createdAt || now).run();
  const get = async id => (await as(id)('/api/support')).json();
  const post = (id, body) => as(id)('/api/support', {method: 'POST', body: {requestId: crypto.randomUUID(), ...body}});
  const entry = (list, id) => list.requests.find(item => item.id === id);
  const request = async (id, customerId, body = {}) => post(id, {action: 'request', customerId, customerVersion: await version(customerId), note: 'يرجى التواصل مع العميل لمعرفة سبب التأخر', channel: 'call', ...body});
  const row = async id => { const found = await app.db.prepare('SELECT kind,parent_id,assigned_to,branch,data,version FROM crm_records WHERE id=?').bind(id).first(); return found && {...found, data: JSON.parse(found.data)}; };
  /** What the reader may do with a request, as the sorted names of what is allowed. */
  const can = item => Object.keys(item.permissions).filter(key => item.permissions[key]).sort();
  /** One step of a request's course: the member, the action and what it carries, against the version the row has now. */
  const step = async (id, requestRecord, action, body = {}) => post(id, {action, id: requestRecord, version: await version(requestRecord), ...body});
  const seen = async (id, requestRecord) => entry(await get(id), requestRecord);

  // ---- the door: signed in, same origin, a known shape
  const anonymous = app.as(null);
  check((await anonymous('/api/support')).status, 401, 'anonymous callers get 401 on GET');
  check([(await anonymous('/api/support', {method: 'POST', body: {}})).status, (await anonymous('/api/support', {method: 'POST', body: {requestId: crypto.randomUUID(), action: 'request', customerId: 'f1', customerVersion: 1, note: 'سبب الطلب'}})).status], [401, 401], 'and on POST, with an empty or a plausible body');
  check((await app.request('/api/support', {method: 'POST', body: {}})).status, 403, 'a POST that does not come from the site itself is refused');
  for (const id of ['owner', 'sm', 'sup', 'rep', 'cs_east', 'csm', 'cs_b']) {
    const answer = await as(id)('/api/support');
    check([id, answer.status, answer.headers['cache-control'], answer.json().requests, answer.json().missed, answer.json().counts], [id, 200, 'no-store', [], [], {requests: 0, missed: 0, badge: 0}], id + ' asks first: nothing yet, never cached');
  }
  check((await post('rep', {action: 'request', customerId: 'f1', customerVersion: 1, note: 'x', surprise: true})).status, 400, 'an unknown field is refused');
  check((await as('rep')('/api/support', {method: 'POST', body: {action: 'request', customerId: 'f1', customerVersion: 1, note: 'سبب'}})).status, 400, 'a request without its own identifier is refused');
  check((await post('rep', {action: 'launch'})).status, 400, 'an unknown action is refused');
  check((await post('cs_east', {action: 'result', id: 'support-x', version: 1, outcome: 'other', note: 'نتيجة'})).status, 400, 'the single-step answer of the first release is gone: a result is submitted for approval now');
  check((await request('rep', 'f1', {note: 'ab'})).status, 400, 'a reason shorter than three characters is refused');

  // ---- who may ask
  check([(await request('rep2', 'f1')).status, (await request('outside', 'f1')).status, (await request('cs_east', 'f1')).status, (await request('csm', 'f1')).status], [403, 403, 403, 403], 'only the customer\'s team asks: another representative, an outside team and customer service are refused');
  check((await request('rep', 'missing')).status, 404, 'a customer that does not exist is refused');
  check((await post('rep', {action: 'request', customerId: 'f1', customerVersion: 99, note: 'سبب الطلب'})).status, 409, 'a stale customer version is refused');
  check((await post('rep', {action: 'request', origin: 'missed_visit', customerId: 'f1', customerVersion: await version('f1'), visitId: 'v-x'})).status, 403, 'a sales member cannot claim a missed visit');

  // ---- the representative asks; the eastern customer goes straight to the eastern representative
  const asked = await request('rep', 'f1');
  check(asked.status, 200, 'the representative asks for help with their customer: ' + asked.text.slice(0, 120));
  const id1 = asked.json().id;
  const stored = await row(id1);
  check([stored.kind, stored.parent_id, stored.assigned_to, stored.branch, stored.version], ['support', null, 'rep', 'الرئيسي', 1], 'it is stored as a record of its own kind, with no parent');
  check([stored.data.status, stored.data.origin, stored.data.customerId, stored.data.repId, stored.data.requestedBy, stored.data.handlerId, stored.data.channel, stored.data.note], ['open', 'rep', 'f1', 'rep', 'rep', 'cs_east', 'call', 'يرجى التواصل مع العميل لمعرفة سبب التأخر'], 'with its reason, channel and the representative of the east already holding it');
  check(stored.data.events.map(event => event.action), ['request', 'assign'], 'its story starts with the request and the routing');
  const again = await request('rep', 'f1');
  check([again.status, again.json().error], [409, 'يوجد طلب مساندة مفتوح لهذا العميل'], 'a second request while one is open is refused');
  check((await request('sup', 'f1')).status, 409, 'also from the supervisor of the same customer');
  const asAsked = entry(await get('rep'), id1);
  check([asAsked.state, asAsked.stage, asAsked.origin, asAsked.handlerName, asAsked.requestedByName, can(asAsked), asAsked.late, asAsked.targetHours, asAsked.awaiting], ['in_progress', 'contact', 'rep', 'cs_east', 'rep', ['cancel'], false, 4, null], 'the asker sees it held, may cancel it, and waits for nothing yet');

  // ---- who sees it
  const sees = async id => (await get(id)).requests.map(item => item.id);
  check([await sees('rep'), await sees('sup'), await sees('sm'), await sees('sm2'), await sees('owner')], [[id1], [id1], [id1], [id1], [id1]], 'the representative, their supervisor, both sales managers and the administrator see it');
  check([await sees('rep2'), await sees('outside'), await sees('sup2')], [[], [], []], 'another team does not');
  check([await sees('cs_east'), await sees('cs_all'), await sees('csm')], [[id1], [id1], [id1]], 'customer service of the east, the one for every region and the manager see it');
  check([await sees('cs_west'), await sees('cs_b'), await sees('csm_b')], [[], [], []], 'the west and another branch do not');
  const holder = entry(await get('cs_east'), id1);
  check([holder.awaiting, can(holder), holder.customerName, holder.customerPhone, holder.requestedByName, holder.note], ['contact', ['submit'], 'مصنع f1', '0551234567', 'rep', 'يرجى التواصل مع العميل لمعرفة سبب التأخر'], 'the holder is waiting to make the contact and sees who asked and why');
  check(can(entry(await get('cs_all'), id1)), [], 'a colleague who is not the holder can only look');
  check(can(entry(await get('csm'), id1)), ['assign', 'submit'], 'the manager may re-assign it or submit the contact');
  check((await get('cs_east')).counts.badge, 1, 'the holder\'s badge counts it');

  // ---- the holder contacts the customer and submits the result for approval
  const resultOf = {outcome: 'reached_interested', note: 'تم الاتصال والعميل مهتم'};
  check((await step('cs_all', id1, 'submit', resultOf)).status, 403, 'a colleague who is not the holder cannot submit');
  check((await step('cs_west', id1, 'submit', {outcome: 'other', note: 'محاولة'})).status, 403, 'nor another region');
  check((await step('rep', id1, 'submit', {outcome: 'other', note: 'محاولة'})).status, 403, 'nor the asker');
  check((await step('cs_east', id1, 'submit', {outcome: 'reached_interested', note: 'ab'})).status, 400, 'a result needs a few words');
  check((await step('cs_east', id1, 'submit', {outcome: 'wants_visit', note: 'يريد زيارة'})).status, 400, 'a visit the customer wants needs its date');
  check((await step('cs_east', id1, 'submit', {outcome: 'wants_visit', note: 'يريد زيارة', nextDate: dayOf(-1)})).status, 400, 'a date in the past is refused');
  check((await step('cs_east', id1, 'submit', {outcome: 'not-an-outcome', note: 'نتيجة'})).status, 400, 'an unknown outcome is refused');
  check((await post('cs_east', {action: 'submit', id: id1, version: 7, ...resultOf})).status, 409, 'a stale version is refused');
  const submitBody = {requestId: crypto.randomUUID(), action: 'submit', id: id1, version: 1, outcome: 'wants_visit', note: 'العميل مهتم ويطلب زيارة يوم الأحد', nextDate: dayOf(3)};
  const submitted = await as('cs_east')('/api/support', {method: 'POST', body: submitBody});
  check(submitted.status, 200, 'the holder submits the result: ' + submitted.text.slice(0, 120));
  const afterSubmit = await row(id1);
  check([afterSubmit.version, afterSubmit.data.status, afterSubmit.data.result.outcome, afterSubmit.data.result.by, afterSubmit.data.result.nextDate, afterSubmit.data.handlerId, afterSubmit.data.serviceManagerId, !!afterSubmit.data.submittedAt], [2, 'submitted', 'wants_visit', 'cs_east', dayOf(3), 'cs_east', 'csm', true], 'it waits for the manager the holder reports to, with the outcome, the author and the date the customer asked for');
  const firstAt = afterSubmit.data.result.at;
  const replayed = await as('cs_east')('/api/support', {method: 'POST', body: submitBody});
  check([replayed.status, replayed.json().alreadySaved, (await row(id1)).version], [200, true, 2], 'the same retry saves nothing twice');
  check((await as('cs_east')('/api/support', {method: 'POST', body: {...submitBody, note: 'نص آخر'}})).status, 409, 'the same identifier with different content is refused');
  check((await step('cs_east', id1, 'submit', {outcome: 'other', note: 'مرة ثانية'})).status, 403, 'a submitted request takes no second submission');
  const wait1 = entry(await get('rep'), id1);
  check([wait1.state, wait1.stage, wait1.targetHours, wait1.awaiting, can(wait1), wait1.result.outcome, wait1.serviceManagerName], ['submitted', 'review', 4, null, ['cancel'], 'wants_visit', 'csm'], 'the asker sees where it stands and the contact result, and waits for nothing');
  const review = entry(await get('csm'), id1);
  check([review.awaiting, can(review), review.candidates.map(person => person.id)], ['review', ['cancel', 'forward', 'return'], ['sm']], 'the manager is asked to review it and may hand it to the sales manager they report to');
  check([(await get('csm')).counts.badge, (await get('cs_east')).counts.badge, (await get('rep')).counts.badge, (await get('sm')).counts.badge], [1, 0, 0, 0], 'only the manager\'s badge counts it');
  check(entry(await get('cs_east'), id1).awaiting, null, 'the holder waits for the manager');

  // ---- the manager returns it for correction; the holder corrects and submits again
  check((await step('cs_all', id1, 'return', {note: 'أضف اسم المسؤول عن الشراء'})).status, 403, 'a colleague cannot return it');
  check((await step('rep', id1, 'return', {note: 'أضف اسم المسؤول عن الشراء'})).status, 403, 'nor the asker');
  check((await step('csm', id1, 'return', {note: 'ab'})).status, 400, 'a reason for the return is needed');
  check((await step('csm', id1, 'return', {note: 'أضف اسم المسؤول عن الشراء'})).status, 200, 'the manager returns it with the reason');
  const returned = await row(id1);
  check([returned.data.status, returned.data.returnNote, !!returned.data.returnedAt], ['returned', 'أضف اسم المسؤول عن الشراء', true], 'recorded with the reason');
  const fix = entry(await get('cs_east'), id1);
  check([fix.awaiting, fix.stage, fix.targetHours, fix.returnNote, can(fix)], ['fix', 'fix', null, 'أضف اسم المسؤول عن الشراء', ['submit']], 'the holder is asked to correct it and sees why');
  check([can(entry(await get('csm'), id1)), (await get('cs_east')).counts.badge, (await get('csm')).counts.badge], [['cancel'], 1, 0], 'the manager only watches; the holder\'s badge counts it');
  check((await step('csm', id1, 'forward', {targetId: 'sm'})).status, 403, 'a returned request cannot be forwarded before it is corrected');
  check((await step('cs_east', id1, 'submit', {outcome: 'reached_interested', note: 'المسؤول عن الشراء السيد خالد وهو مهتم'})).status, 200, 'the holder corrects it and submits again');
  const resubmitted = await row(id1);
  check([resubmitted.data.status, resubmitted.data.returnNote, resubmitted.data.result.at, resubmitted.data.result.note, resubmitted.data.submittedAt >= resubmitted.data.returnedAt], ['submitted', '', firstAt, 'المسؤول عن الشراء السيد خالد وهو مهتم', true], 'it is submitted again; the time of the first submission, which the evaluation measures, stays');

  // ---- the manager approves it and hands it to a sales manager
  check((await step('cs_east', id1, 'forward', {targetId: 'sm'})).status, 403, 'the holder cannot approve their own');
  check((await step('csm_b', id1, 'forward', {targetId: 'sm'})).status, 403, 'nor another branch\'s manager');
  check((await step('csm', id1, 'forward', {targetId: 'sm2'})).status, 403, 'the manager hands it only to the sales manager they report to');
  check((await step('csm', id1, 'forward', {targetId: 'sup'})).status, 403, 'not to a supervisor');
  check((await step('csm', id1, 'forward', {targetId: 'cs_all'})).status, 403, 'nor to customer service');
  const forwardBody = {requestId: crypto.randomUUID(), action: 'forward', id: id1, version: await version(id1), targetId: 'sm'};
  check((await as('csm')('/api/support', {method: 'POST', body: forwardBody})).status, 200, 'the manager approves it and hands it to their sales manager');
  check([(await as('csm')('/api/support', {method: 'POST', body: forwardBody})).json().alreadySaved, (await row(id1)).data.status], [true, 'pending_assignment'], 'a retry of the approval saves nothing twice');
  const forwarded = await row(id1);
  check([forwarded.data.status, forwarded.data.salesManagerId, forwarded.data.serviceManagerId, !!forwarded.data.forwardedAt], ['pending_assignment', 'sm', 'csm', true], 'it waits for the sales manager');
  const toAssign = entry(await get('sm'), id1);
  check([toAssign.awaiting, toAssign.stage, toAssign.targetHours, can(toAssign), toAssign.suggestedId, toAssign.candidates.map(person => person.id).sort()], ['allocate', 'assignment', 4, ['allocate', 'cancel'], 'rep', ['outside', 'rep', 'rep2', 'sup', 'sup2']], 'the sales manager is asked to assign it, and the customer\'s own representative is suggested');
  check(toAssign.candidates[0].id, 'rep', 'who comes first');
  check([can(entry(await get('sm2'), id1)), entry(await get('sm2'), id1).awaiting], [['cancel'], null], 'another sales manager sees what the team asked but is not asked to assign it');
  check([entry(await get('rep'), id1).state, can(entry(await get('rep'), id1)), (await get('sm')).counts.badge], ['pending_assignment', ['cancel'], 1], 'the asker sees the stage; the sales manager\'s badge counts it');
  check(can(entry(await get('csm'), id1)), [], 'the customer-service manager has handed it over');
  check((await request('rep', 'f1')).status, 409, 'while it is on its way no other request is made for the customer');

  // ---- the sales manager assigns a supervisor, who delegates to a representative
  check((await step('csm', id1, 'allocate', {targetId: 'sup'})).status, 403, 'the customer-service manager cannot assign');
  check((await step('sm2', id1, 'allocate', {targetId: 'sup'})).status, 403, 'nor a sales manager it was not handed to');
  check((await step('sup', id1, 'allocate', {targetId: 'rep2'})).status, 403, 'nor a supervisor');
  check((await step('sm', id1, 'allocate', {targetId: 'cs_all'})).status, 403, 'it is not assigned to customer service');
  check((await step('sm', id1, 'allocate', {targetId: 'sm2'})).status, 403, 'nor to another sales manager');
  check((await step('sm', id1, 'allocate', {targetId: 'missing'})).status, 403, 'nor to someone who is not there');
  const allocated = await step('sm', id1, 'allocate', {targetId: 'sup', note: 'يرجى الزيارة هذا الأسبوع'});
  check(allocated.status, 200, 'the sales manager assigns the supervisor: ' + allocated.text.slice(0, 120));
  const assigned1 = await row(id1);
  check([assigned1.data.status, assigned1.data.assigneeId, assigned1.data.supervisorId, assigned1.data.assignmentNote, !!assigned1.data.assignedAt], ['assigned', 'sup', 'sup', 'يرجى الزيارة هذا الأسبوع', true], 'recorded with the note');
  const toDelegate = entry(await get('sup'), id1);
  check([toDelegate.awaiting, toDelegate.stage, toDelegate.targetHours, can(toDelegate), toDelegate.candidates.map(person => person.id), toDelegate.assignmentNote], ['delegate', 'delegation', 4, ['delegate', 'resolve'], ['rep', 'rep2'], 'يرجى الزيارة هذا الأسبوع'], 'the supervisor is asked to delegate, or to contact the customer themselves; their own representatives are offered');
  check([can(entry(await get('sm'), id1)), entry(await get('sm'), id1).awaiting, can(entry(await get('rep'), id1))], [['reassign'], null, []], 'the sales manager may move it; the asker only watches');
  check((await step('rep', id1, 'cancel', {reason: 'لم يعد مطلوبًا'})).status, 403, 'once sales has it the asker cannot cancel it');
  check((await step('rep2', id1, 'delegate', {targetId: 'rep'})).status, 403, 'a representative cannot delegate');
  check((await step('sm', id1, 'delegate', {targetId: 'rep2'})).status, 403, 'nor a sales manager: delegation is the supervisor\'s');
  check((await step('sup', id1, 'delegate', {targetId: 'outside'})).status, 403, 'the supervisor delegates only to their own representatives');
  check((await step('sup', id1, 'delegate', {targetId: 'sup'})).status, 403, 'not to themselves');
  const delegated = await step('sup', id1, 'delegate', {targetId: 'rep2', note: 'تواصل معه اليوم'});
  check(delegated.status, 200, 'the supervisor delegates to their representative: ' + delegated.text.slice(0, 120));
  const delegatedRow = await row(id1);
  check([delegatedRow.data.status, delegatedRow.data.assigneeId, delegatedRow.data.supervisorId, delegatedRow.data.assignmentNote, !!delegatedRow.data.delegatedAt], ['assigned', 'rep2', 'sup', 'تواصل معه اليوم', true], 'it is with the representative, under the supervisor');

  // ---- the representative contacts the customer and records the result
  const toResolve = entry(await get('rep2'), id1);
  check([toResolve.awaiting, toResolve.stage, toResolve.targetHours, can(toResolve), toResolve.candidates, toResolve.result.outcome, toResolve.note], ['resolve', 'first_contact', 24, ['resolve'], [], 'reached_interested', 'يرجى التواصل مع العميل لمعرفة سبب التأخر'], 'the representative is asked to contact the customer and sees the reason and what customer service found');
  check([can(entry(await get('sup'), id1)), entry(await get('sup'), id1).awaiting], [['delegate'], null], 'the supervisor may still delegate it elsewhere but is not asked');
  check((await get('rep2')).counts.badge, 1, 'the representative\'s badge counts it');
  const visitContact = {channel: 'visit', outcome: 'reached_interested', note: 'زرت المصنع واتفقنا على تقديم عرض'};
  check((await step('sup', id1, 'resolve', visitContact)).status, 403, 'the supervisor who delegated it does not record the contact');
  check((await step('rep', id1, 'resolve', visitContact)).status, 403, 'nor the asker');
  check((await step('cs_east', id1, 'resolve', visitContact)).status, 403, 'nor customer service');
  check((await step('rep2', id1, 'resolve', {...visitContact, channel: 'carrier-pigeon'})).status, 400, 'a way of reaching the customer that is not known is refused');
  check((await step('rep2', id1, 'resolve', {...visitContact, note: 'ab'})).status, 400, 'the result needs a few words');
  check((await step('rep2', id1, 'resolve', {...visitContact, outcome: 'wants_visit'})).status, 400, 'a visit the customer wants needs its date');
  check((await step('rep2', id1, 'resolve', visitContact)).status, 200, 'the representative records the visit and what came of it');
  const resolvedRow = await row(id1);
  check([resolvedRow.data.status, resolvedRow.data.resolution.channel, resolvedRow.data.resolution.outcome, resolvedRow.data.resolution.by, !!resolvedRow.data.resolvedAt], ['resolved', 'visit', 'reached_interested', 'rep2', true], 'recorded with the way they reached the customer');

  // ---- customer service reviews it: returned to the representative once, then closed
  const toClose = entry(await get('cs_east'), id1);
  check([toClose.awaiting, toClose.stage, toClose.targetHours, can(toClose), toClose.resolution.channel, toClose.resolution.note, toClose.resolution.byName], ['close', 'closure', 24, ['close', 'reject'], 'visit', 'زرت المصنع واتفقنا على تقديم عرض', 'rep2'], 'the member who took it is asked to confirm and sees what the representative did');
  check([can(entry(await get('csm'), id1)), entry(await get('csm'), id1).awaiting, can(entry(await get('cs_all'), id1)), can(entry(await get('rep2'), id1))], [['close', 'reject'], null, [], []], 'the manager may close it too but is not asked; a colleague and the representative may not');
  check([entry(await get('rep'), id1).state, entry(await get('rep'), id1).stage], ['resolved', 'closure'], 'the asker sees it waits for closure');
  check((await step('cs_all', id1, 'close', {note: 'تم'})).status, 403, 'a colleague cannot close it');
  check((await step('rep2', id1, 'close', {note: 'تم'})).status, 403, 'nor the representative');
  check((await step('rep', id1, 'close', {note: 'تم'})).status, 403, 'nor the asker');
  check((await step('cs_all', id1, 'reject', {reason: 'ناقص'})).status, 403, 'a colleague cannot return it to the representative');
  check((await step('cs_east', id1, 'reject', {reason: 'ab'})).status, 400, 'returning it needs a reason');
  check((await step('cs_east', id1, 'reject', {reason: 'لم يُذكر اسم مسؤول الشراء في النتيجة'})).status, 200, 'the member who took it returns it to the representative with the reason');
  const rejected = await row(id1);
  check([rejected.data.status, rejected.data.assigneeId, rejected.data.rejectReason, rejected.data.resolution, !!rejected.data.rejectedAt], ['assigned', 'rep2', 'لم يُذكر اسم مسؤول الشراء في النتيجة', undefined, true], 'it is with the representative again, with the reason, and the earlier result is withdrawn');
  const again2 = entry(await get('rep2'), id1);
  check([again2.awaiting, again2.rejectReason, again2.stage], ['resolve', 'لم يُذكر اسم مسؤول الشراء في النتيجة', 'first_contact'], 'the representative is asked again and sees why');
  check((await step('rep2', id1, 'resolve', {...visitContact, note: 'زرت المصنع وقابلت السيد خالد مسؤول الشراء واتفقنا على عرض'})).status, 200, 'the representative records it again');
  const closeBody = {requestId: crypto.randomUUID(), action: 'close', id: id1, version: await version(id1), note: 'راجعت النتيجة وهي كافية'};
  check((await as('cs_east')('/api/support', {method: 'POST', body: closeBody})).status, 200, 'the member who took it confirms and closes it');
  check([(await as('cs_east')('/api/support', {method: 'POST', body: closeBody})).json().alreadySaved, (await row(id1)).data.status], [true, 'done'], 'a retry of the closure saves nothing twice');
  const closed = await row(id1);
  check([closed.data.status, closed.data.closure.by, closed.data.closure.note, !!closed.data.closedAt, closed.data.resolution.channel, closed.data.result.at], ['done', 'cs_east', 'راجعت النتيجة وهي كافية', true, 'visit', firstAt], 'closed with who closed it and why, the representative\'s contact and customer service\'s first submission kept');
  check(closed.data.events.map(event => event.action), ['request', 'assign', 'submit', 'return', 'submit', 'forward', 'allocate', 'delegate', 'resolve', 'reject', 'resolve', 'close'], 'its whole course is in its story');
  check([closed.data.events.find(event => event.action === 'forward').targetId, closed.data.events.find(event => event.action === 'allocate').targetId, closed.data.events.find(event => event.action === 'delegate').targetId, closed.data.events.find(event => event.action === 'resolve').outcome], ['sm', 'sup', 'rep2', 'reached_interested'], 'with whom each step handed it to and the outcome');
  check((await step('cs_east', id1, 'close', {note: 'مرة ثانية'})).status, 403, 'a closed request is closed');

  // ---- the answer reaches the asker and the representative
  const answerSeen = entry(await get('rep'), id1);
  check([answerSeen.state, answerSeen.stage, answerSeen.awaiting, answerSeen.result.outcome, answerSeen.result.note, answerSeen.result.byName, answerSeen.result.nextDate, answerSeen.resolution.channel, answerSeen.resolution.byName, answerSeen.closure.byName, answerSeen.permissions.seen, answerSeen.permissions.cancel], ['done', 'closed', 'answer', 'reached_interested', 'المسؤول عن الشراء السيد خالد وهو مهتم', 'cs_east', '', 'visit', 'rep2', 'cs_east', true, false], 'the asker sees the whole answer and may open it');
  check([(await get('rep')).counts.badge, (await get('rep2')).counts.badge, (await get('sup')).counts.badge, (await get('cs_east')).counts.badge], [1, 1, 0, 0], 'the badge of the asker and of the representative counts the answer');
  check((await step('sup', id1, 'seen')).status, 403, 'a supervisor cannot open it for them');
  check((await step('rep', id1, 'seen')).status, 200, 'the asker opens the answer');
  check([(await step('rep', id1, 'seen')).json().alreadySeen, (await get('rep')).counts.badge, (await get('rep2')).counts.badge, (await row(id1)).data.answerSeenBy], [true, 0, 0, 'rep'], 'once; the badges clear');
  check((await step('rep', id1, 'cancel')).status, 403, 'a finished request cannot be cancelled');
  check((await request('rep', 'f1', {note: 'طلب جديد بعد الإغلاق'})).status, 200, 'with the request closed, a new one may be made for the customer');
  check(await sees('cs_west'), [], 'and the west still sees nothing of it');

  // ---- a customer nobody is named for goes to the shared pool; take, cancel, re-ask, assign
  const central = await request('rep', 'f3', {note: 'العميل لا يرد على المندوب'});
  const id2 = central.json().id;
  check([central.status, (await row(id2)).data.handlerId], [200, ''], 'a central customer: nobody is named for the region, so it waits');
  const waiting = entry(await get('cs_all'), id2);
  check([waiting.state, waiting.stage, waiting.awaiting, waiting.permissions.take, waiting.unrouted], ['waiting', 'take', 'take', true, false], 'the representative for every region may take it');
  check([await sees('cs_east'), await sees('cs_west')].map(list => list.includes(id2)), [false, false], 'the east and the west do not see it');
  check((await step('cs_east', id2, 'take')).status, 403, 'a representative outside the region cannot take it');
  check((await step('cs_all', id2, 'assign', {targetId: 'cs_all'})).status, 403, 'a representative cannot assign');
  const taken2 = await step('cs_all', id2, 'take');
  check(taken2.status, 200, 'the shared representative takes it');
  check([(await row(id2)).data.handlerId, (await row(id2)).data.handlerBy, (await row(id2)).data.events.map(event => event.action)], ['cs_all', 'cs_all', ['request', 'take']], 'recorded with who took it');
  check((await step('cs_west', id2, 'take')).status, 403, 'a held request is not taken again');
  const cancelled = await step('rep', id2, 'cancel', {reason: 'تم التواصل مع العميل'});
  check(cancelled.status, 200, 'the asker withdraws it');
  check([(await row(id2)).data.status, (await row(id2)).data.cancelReason, (await row(id2)).data.cancelledBy], ['cancelled', 'تم التواصل مع العميل', 'rep'], 'with its reason');
  check((await step('cs_all', id2, 'take')).status, 403, 'a cancelled request is not taken');
  const second = await request('rep', 'f3', {note: 'لم ينجح الاتصال مرة ثانية'});
  const id3 = second.json().id;
  check(second.status, 200, 'with nothing open the representative may ask again');
  check((await step('csm', id3, 'assign', {targetId: 'cs_east'})).status, 403, 'the manager cannot assign it to a representative who does not cover the region');
  check((await step('csm', id3, 'assign', {targetId: 'rep'})).status, 403, 'nor to a sales member');
  check((await step('csm', id3, 'assign', {targetId: 'cs_b'})).status, 403, 'nor to another branch');
  check((await step('cs_all', id3, 'assign', {targetId: 'cs_all'})).status, 403, 'a representative cannot assign');
  const assigned = await step('csm', id3, 'assign', {targetId: 'cs_all'});
  check(assigned.status, 200, 'the manager assigns it to the shared representative');
  const handled = await row(id3);
  check([handled.version, handled.data.handlerId, handled.data.handlerBy, handled.data.status], [2, 'cs_all', 'csm', 'open'], 'recorded with who assigned it');
  check([(await step('csm', id3, 'assign', {targetId: 'cs_all'})).status], [403], 'it is not assigned again to the one who holds it');
  check((await step('cs_all', id3, 'take')).status, 403, 'a held request is not taken');
  check((await step('cs_all', id3, 'submit', {outcome: 'no_answer', note: 'لم يرد بعد ثلاث محاولات'})).status, 200, 'the representative submits: the customer did not reply');
  check([entry(await get('rep'), id3).result.outcome, entry(await get('rep'), id3).state, (await row(id3)).data.serviceManagerId], ['no_answer', 'submitted', 'csm'], 'and the asker sees what customer service found while it waits for the manager');

  // ---- late: only what still waits, only for those who owe the answer
  const waitingAgain = (await request('rep2', 'f2', {note: 'يحتاج العميل متابعة'})).json().id;
  check([(await row(waitingAgain)).data.handlerId, entry(await get('cs_west'), waitingAgain).awaiting], ['cs_west', 'contact'], 'a western customer goes to the western representative');
  await app.db.prepare("UPDATE crm_records SET created_at=? WHERE id=?").bind(new Date(Date.now() - 30 * 86400000).toISOString(), waitingAgain).run();
  const late = entry(await get('csm'), waitingAgain);
  check([late.late, late.stageHours > 4, late.awaiting], [true, true, 'assign'], 'left for a month it is late, and the manager is told');
  check([(await get('csm')).counts.badge, (await get('owner')).counts.badge, (await get('cs_west')).counts.badge], [2, 1, 1], 'the manager counts the late one and the one waiting for their review, the administrator the late one, the holder theirs');
  check(entry(await get('rep2'), waitingAgain).awaiting, null, 'the asker is not made to wait for the answer by a mark');
  // a request submitted a month ago and left with the manager is late too
  await app.db.prepare("UPDATE crm_records SET data=json_set(data,'$.submittedAt',?) WHERE id=?").bind(new Date(Date.now() - 30 * 86400000).toISOString(), id3).run();
  const lateReview = entry(await get('csm'), id3);
  check([lateReview.late, lateReview.stage, lateReview.awaiting, lateReview.targetHours], [true, 'review', 'review', 4], 'a contact left with the manager is late against the review target');

  // ---- a request for a western customer: reassigned by the sales manager, then cancelled by an administrator at any stage
  const f7 = (await request('rep', 'f7', {note: 'العميل الغربي يحتاج تواصلًا'})).json().id;
  check((await row(f7)).data.handlerId, 'cs_west', 'a western customer goes to the western representative');
  check((await step('cs_west', f7, 'submit', {outcome: 'no_answer', note: 'لم يرد'})).status, 200, 'who submits it');
  check((await step('csm', f7, 'forward', {targetId: 'sm'})).status, 200, 'the manager approves it');
  check((await step('sm', f7, 'allocate', {targetId: 'rep2'})).status, 200, 'the sales manager assigns a representative who is not the customer\'s');
  check((await step('sup', f7, 'reassign', {targetId: 'rep'})).status, 403, 'a supervisor cannot move it');
  check((await step('sm', f7, 'reassign', {targetId: 'rep2'})).status, 403, 'it is not reassigned to the one who holds it');
  check((await step('sm', f7, 'reassign', {targetId: 'rep', note: 'مندوب العميل أعلم به'})).status, 200, 'the sales manager moves it to the customer\'s own representative');
  const moved = await row(f7);
  check([moved.data.assigneeId, moved.data.previousAssignees, !!moved.data.reassignedAt, moved.data.assignmentNote], ['rep', ['rep2'], true, 'مندوب العميل أعلم به'], 'the earlier holder is kept in its record');
  check([entry(await get('rep'), f7).awaiting, (await seen('rep2', f7))], ['resolve', undefined], 'the new holder is asked; the earlier one no longer sees it');
  check((await step('sm', f7, 'cancel', {reason: 'محاولة'})).status, 403, 'a sales manager cannot cancel what sales holds');
  check((await step('owner', f7, 'cancel', {reason: 'أُلغي من مدير النظام'})).status, 200, 'an administrator may cancel it at any stage');
  check([(await row(f7)).data.status, (await row(f7)).data.cancelReason], ['cancelled', 'أُلغي من مدير النظام'], 'with its reason');

  // ---- a visit that went unanswered is routed to customer service and follows the same course
  await seedVisit('visit-missed-1', 'f6');
  const missedFor = async id => (await get(id)).missed;
  const missed = (await missedFor('cs_east')).find(item => item.customerId === 'f6');
  ok(missed, 'the eastern representative has the missed visit of an eastern customer');
  check([missed.visitId, missed.customerName, missed.customerPhone, missed.repId, missed.plan.nextAction, missed.plan.result, missed.overdueDays, missed.routedToId, missed.permissions.take, missed.unrouted], ['visit-missed-1', 'مصنع f6', '0551234567', 'rep', 'زيارة متابعة', 'سلبية', 5, 'cs_east', true, false], 'with the customer, the representative, the plan and how many days it is behind');
  check(JSON.stringify(await get('cs_east')).includes('PRIVATE-'), false, 'no visit summary or note reaches customer service');
  check([(await missedFor('csm')).some(item => item.customerId === 'f6'), (await missedFor('cs_all')).some(item => item.customerId === 'f6'), (await missedFor('owner')).some(item => item.customerId === 'f6')], [true, true, true], 'the manager, the representative for every region and the administrator see it too');
  check([(await missedFor('cs_west')).some(item => item.customerId === 'f6'), (await missedFor('cs_b')).some(item => item.customerId === 'f6'), (await missedFor('csm_b')).some(item => item.customerId === 'f6')], [false, false, false], 'the west and another branch do not');
  for (const id of ['rep', 'rep2', 'sup', 'sm', 'sm2', 'outside']) check((await missedFor(id)), [], id + ' receives no missed visits');
  check((await missedFor('cs_all')).find(item => item.customerId === 'f6').permissions.take, false, 'a colleague sees but cannot take what is routed to the eastern representative');
  const takeBody = {action: 'request', origin: 'missed_visit', customerId: 'f6', customerVersion: await version('f6'), visitId: 'visit-missed-1', note: ''};
  check((await post('cs_all', takeBody)).status, 403, 'the colleague is refused');
  check((await post('cs_west', takeBody)).status, 403, 'and the other region');
  check((await post('cs_east', {...takeBody, visitId: 'visit-nonexistent'})).status, 409, 'a visit that is not on the list cannot be taken');
  check((await post('cs_east', {...takeBody, customerVersion: 99})).status, 409, 'a stale customer is refused');
  const [one, two] = await Promise.all([post('cs_east', takeBody), post('csm', takeBody)]);
  check([one.status, two.status].sort(), [200, 409], 'two members taking it at once: exactly one gets it');
  const winner = one.status === 200 ? 'cs_east' : 'csm';
  const missedId = 'support-missed-visit-missed-1';
  const taken = await row(missedId);
  check([taken.data.origin, taken.data.status, taken.data.handlerId, taken.data.requestedBy, taken.data.repId, taken.data.plan.visitId, taken.data.plan.nextDate, taken.version, taken.data.events.map(event => event.action)], ['missed_visit', 'open', winner, winner, 'rep', 'visit-missed-1', dayOf(-5), 1, ['request', 'take']], 'it is stored with its plan and held by whoever took it');
  check([(await missedFor('cs_east')).some(item => item.customerId === 'f6'), (await missedFor('csm')).some(item => item.customerId === 'f6')], [false, false], 'a taken visit leaves the missed list');
  const mine = entry(await get(winner), missedId);
  check([mine.origin, mine.state, mine.awaiting, mine.plan.nextDate, mine.note], ['missed_visit', 'in_progress', 'contact', dayOf(-5), ''], 'and waits in the holder\'s requests');
  check(entry(await get('rep'), missedId).state, 'in_progress', 'the representative whose visit was missed sees that customer service has it');
  check((await step(winner, missedId, 'submit', {outcome: 'wants_visit', note: 'العميل يطلب زيارة', nextDate: dayOf(2)})).status, 200, 'the holder submits the contact');
  check([(await missedFor('csm')).some(item => item.customerId === 'f6'), entry(await get('rep'), missedId).awaiting, entry(await get('rep'), missedId).state], [false, null, 'submitted'], 'it does not come back while it is on its way, and the representative sees the stage');
  check((await step('csm', missedId, 'forward', {targetId: 'sm'})).status, 200, 'the manager approves it');
  check((await step('sm', missedId, 'allocate', {targetId: 'rep'})).status, 200, 'the sales manager assigns the customer\'s own representative');
  check([entry(await get('rep'), missedId).awaiting, (await get('rep')).counts.badge], ['resolve', 1], 'who is asked to contact the customer');
  check((await step('rep', missedId, 'resolve', {channel: 'call', outcome: 'reached_interested', note: 'اتصلت به واتفقنا على زيارة'})).status, 200, 'and does');
  check((await step(winner, missedId, 'close', {note: 'تم'})).status, 200, 'the member who took it closes it');
  check([(await missedFor('csm')).some(item => item.customerId === 'f6'), entry(await get('rep'), missedId).awaiting], [false, 'answer'], 'it does not come back for the same visit, and the representative is told');
  await seedVisit('visit-missed-2', 'f6', {startedAt: dayOf(-1) + 'T07:00:00.000Z', date: dayOf(-1), nextDate: dayOf(-3), createdAt: new Date(Date.now() + 1000).toISOString()});
  check((await missedFor('csm')).some(item => item.customerId === 'f6' && item.visitId === 'visit-missed-2'), true, 'a later negative visit that is again unanswered is a new missed visit');
  await seedVisit('visit-ok', 'f7', {result: 'تم أخذ موعد', nextDate: dayOf(-9)});
  check((await missedFor('csm')).some(item => item.customerId === 'f7'), false, 'a visit that did not end badly is not missed');
  await seedVisit('visit-recent', 'f2', {nextDate: dayOf(-1)});
  check((await missedFor('csm')).some(item => item.customerId === 'f2'), false, 'nor one that is only a day behind');
  // a manager may withdraw a missed visit while it waits for them
  const lead = await post('csm', {action: 'request', origin: 'missed_visit', customerId: 'f6', customerVersion: await version('f6'), visitId: 'visit-missed-2', note: ''});
  check(lead.status, 200, 'the manager takes the new missed visit themselves');
  const leadId = 'support-missed-visit-missed-2';
  check((await step('csm', leadId, 'submit', {outcome: 'no_answer', note: 'لم يرد'})).status, 200, 'and submits the contact');
  check([(await row(leadId)).data.serviceManagerId, entry(await get('csm'), leadId).awaiting, can(entry(await get('csm'), leadId))], ['csm', 'review', ['cancel', 'forward', 'return']], 'a manager who took it reviews it themselves');
  check((await step('csm', leadId, 'cancel', {reason: 'لا حاجة لها'})).status, 200, 'the manager may cancel a missed visit that waits for them');
  check((await row(leadId)).data.status, 'cancelled', 'and it is cancelled');

  // ---- nothing leaks into the pipelines that were here before
  const crm = await (await as('owner')('/api/crm')).json();
  check([crm.records.some(item => item.kind === 'support'), JSON.stringify(crm.audits).includes('support')], [false, false], 'the administrator\'s records and history carry no assistance request');
  for (const id of ['rep', 'sm', 'cs_east']) check(JSON.stringify(await (await as(id)('/api/crm')).json()).includes('"kind":"support"'), false, id + '\'s records carry none either');
  const cases = await (await as('owner')('/api/customer-service')).json();
  check(cases.cases, [], 'no customer-service case was made by any of it');
  const generic = await as('owner')('/api/crm', {method: 'POST', body: {action: 'delete', kind: 'support', id: id1, version: 3}});
  check(generic.status, 400, 'the generic record route does not touch a request');
  const registration = {type: 'call', summary: 'تسجيل طلب', result: 'متابعة العميل', salesStage: 'new', strength: 'strong', requestedProducts: ['خدمات صيانة'], nextAction: 'متابعة', nextDate: today, location: '26.43, 50.03', locationSource: 'device', locationCapturedAt: now, locationAccuracy: 10, customerNeeds: 'صيانة'};
  const openForF1 = (await app.db.prepare("SELECT id FROM crm_records WHERE kind='support' AND json_extract(data,'$.customerId')='f1' AND json_extract(data,'$.status')='open'").first());
  ok(openForF1, 'a new request for f1 is open while a service case is about to be');
  const caseMade = await as('cs_east')('/api/customer-service', {method: 'POST', body: {action: 'create', requestId: crypto.randomUUID(), customerId: 'f1', customerVersion: await version('f1'), registration, elapsedMilliseconds: 2000}});
  check(caseMade.status, 200, 'an open assistance request does not stop customer service registering a case for the same customer: ' + caseMade.text.slice(0, 100));
  const visit = await as('rep')('/api/visits', {method: 'POST', body: {createKey: crypto.randomUUID(), customerId: 'f6', customerVersion: await version('f6'), timingMode: 'automatic', elapsedMilliseconds: 2000, data: {type: 'call', date: today, summary: 'تواصل مع العميل', result: 'تم التواصل', salesStage: 'new', strength: 'medium', nextAction: 'زيارة فنية', nextDate: today, location: '26.43, 50.03', locationSource: 'device', locationCapturedAt: now, locationAccuracy: 10}}});
  check(visit.status, 200, 'a representative still records a visit: ' + visit.text.slice(0, 100));
  check((await row(visit.json().id)).data.serviceCaseId, undefined, 'and it is not tied to an assistance request as if it were a case');
  check((await missedFor('csm')).some(item => item.customerId === 'f6'), false, 'a fresh visit closes whatever was missed for that customer');
  const audit = await app.db.prepare("SELECT action,record_id FROM crm_audit WHERE action LIKE 'support:%' ORDER BY created_at,id").all();
  const actions = audit.results.map(item => item.action);
  ok(['request', 'take', 'assign', 'submit', 'return', 'forward', 'allocate', 'delegate', 'reassign', 'resolve', 'reject', 'close', 'seen', 'cancel'].every(action => actions.includes('support:' + action)), 'every change is in the audit trail: ' + [...new Set(actions)].join(' '));
  const receipts = (await app.db.prepare("SELECT COUNT(*) AS n FROM crm_audit WHERE action='support-receipt'").first()).n, changes = actions.length;
  check(receipts, changes, 'with a receipt for each change, so that a retry is safe: ' + receipts);
  ok(changes > 30, 'and a long list of changes: ' + changes);

  // ---- a customer can still be deleted; its requests are simply no longer shown
  await customer('f8', 'rep', 'الشرقية');
  const lastRequest = await request('rep', 'f8');
  check(lastRequest.status, 200, 'a request for a customer that is later deleted');
  const f8 = await (await as('owner')('/api/crm')).json();
  const f8Row = f8.records.find(item => item.id === 'f8');
  const deleted = await as('owner')('/api/crm', {method: 'POST', body: {action: 'delete', kind: 'customer', id: 'f8', version: f8Row.version}});
  check(deleted.status, 200, 'the customer is deleted without the request standing in the way: ' + deleted.text.slice(0, 100));
  check([(await get('rep')).requests.some(item => item.customerId === 'f8'), (await get('owner')).requests.some(item => item.customerId === 'f8')], [false, false], 'and its request is no longer listed');

  // ---- the lists are bounded
  for (let n = 0; n < 320; n++) await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'support',NULL,'rep','الرئيسي',?,?,?,1,'fixture')")
    .bind('support-bulk-' + n, JSON.stringify({kind: 'support', customerId: 'f1', origin: 'rep', status: 'done', requestedBy: 'rep', requestedAt: now, repId: 'rep', note: 'x', channel: 'any', handlerId: 'cs_east', handlerAt: now, handlerBy: 'rep', result: {outcome: 'other', note: 'x', nextDate: '', by: 'cs_east', at: now}}), now, now).run();
  check([(await get('owner')).requests.length, (await get('cs_east')).requests.length], [300, 300], 'a list never grows past three hundred entries');
  const cutRequests = (await get('owner')).counts.requests;
  ok(cutRequests > 300, 'but the count reports every request, not only the three hundred listed: ' + cutRequests);
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('support-odd',?,NULL,'rep','الرئيسي',?,?,?,1,'fixture')").bind('support', '{"kind":"support"}', now, now).run();
  const odd = await as('owner')('/api/support');
  check([odd.status, odd.json().requests.some(item => item.id === 'support-odd')], [200, false], 'a row that is not a well-formed request is left out instead of breaking the list');

  // ---- more missed visits than a page holds: the list is cut, the count is not, and any of them can still be taken
  for (let n = 0; n < 305; n++) { await customer('m' + n, 'rep', 'الشرقية'); await seedVisit('visit-m' + n, 'm' + n, {nextDate: dayOf(-3 - (n % 25))}); }
  const crowded = await get('cs_east'), crowdedWhole = crowded.counts.missed;
  check([crowded.missed.length, crowdedWhole >= 305, crowded.counts.badge >= 305], [300, true, true], 'three hundred missed visits are listed while the count and the badge cover all of them: ' + crowdedWhole);
  check(crowded.missed.every((item, at) => at === 0 || crowded.missed[at - 1].overdueDays >= item.overdueDays), true, 'the most overdue are the ones listed');
  const listedIds = new Set(crowded.missed.map(item => item.visitId)), hidden = Array.from({length: 305}, (_, n) => 'visit-m' + n).find(id => !listedIds.has(id));
  ok(hidden, 'some visit is left out of the three hundred listed');
  const hiddenCustomer = 'm' + hidden.slice('visit-m'.length);
  const takeHidden = await post('cs_east', {action: 'request', origin: 'missed_visit', customerId: hiddenCustomer, customerVersion: await version(hiddenCustomer), visitId: hidden});
  check(takeHidden.status, 200, 'a missed visit that is not in the listed three hundred can still be taken: ' + takeHidden.text.slice(0, 120));
  const afterTake = await get('cs_east');
  check([afterTake.counts.missed, afterTake.missed.length], [crowdedWhole - 1, 300], 'and the count drops by one while the list stays full');
  console.log(JSON.stringify({ok: true, checks, builtRelease: true, productionDataUsed: false}));
} finally { await app.stop(); }
