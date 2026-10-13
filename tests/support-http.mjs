// Customer-service assistance over real HTTP against the BUILT release (run `pnpm build` first): a representative asks for
// help with a customer, the request is routed to the customer-service member of that region, who answers it; a visit that
// went unanswered is routed to customer service on its own and taken by one member only; who sees and who may act; idempotent
// retries and stale versions; and that none of it leaks into the visit, record or customer-service-case pipelines.
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
  const again = await request('rep', 'f1');
  check([again.status, again.json().error], [409, 'يوجد طلب مساندة مفتوح لهذا العميل'], 'a second request while one is open is refused');
  check((await request('sup', 'f1')).status, 409, 'also from the supervisor of the same customer');
  const asAsked = entry(await get('rep'), id1);
  check([asAsked.state, asAsked.origin, asAsked.handlerName, asAsked.requestedByName, asAsked.permissions, asAsked.late, asAsked.targetHours, asAsked.awaiting], ['in_progress', 'rep', 'cs_east', 'rep', {take: false, assign: false, result: false, cancel: true, seen: false}, false, 4, null], 'the asker sees it held, may cancel it, and waits for nothing yet');

  // ---- who sees it
  const sees = async id => (await get(id)).requests.map(item => item.id);
  check([await sees('rep'), await sees('sup'), await sees('sm'), await sees('sm2'), await sees('owner')], [[id1], [id1], [id1], [id1], [id1]], 'the representative, their supervisor, both sales managers and the administrator see it');
  check([await sees('rep2'), await sees('outside'), await sees('sup2')], [[], [], []], 'another team does not');
  check([await sees('cs_east'), await sees('cs_all'), await sees('csm')], [[id1], [id1], [id1]], 'customer service of the east, the one for every region and the manager see it');
  check([await sees('cs_west'), await sees('cs_b'), await sees('csm_b')], [[], [], []], 'the west and another branch do not');
  const holder = entry(await get('cs_east'), id1);
  check([holder.awaiting, holder.permissions, holder.customerName, holder.customerPhone, holder.requestedByName, holder.note], ['contact', {take: false, assign: false, result: true, cancel: false, seen: false}, 'مصنع f1', '0551234567', 'rep', 'يرجى التواصل مع العميل لمعرفة سبب التأخر'], 'the holder is waiting to make the contact and sees who asked and why');
  check(entry(await get('cs_all'), id1).permissions, {take: false, assign: false, result: false, cancel: false, seen: false}, 'a colleague who is not the holder can only look');
  check(entry(await get('csm'), id1).permissions, {take: false, assign: true, result: true, cancel: false, seen: false}, 'the manager may re-assign it or answer it');
  check((await get('cs_east')).counts.badge, 1, 'the holder\'s badge counts it');

  // ---- the holder answers
  check((await post('cs_all', {action: 'result', id: id1, version: 1, outcome: 'reached_interested', note: 'تم الاتصال والعميل مهتم'})).status, 403, 'a colleague who is not the holder cannot answer');
  check((await post('cs_west', {action: 'result', id: id1, version: 1, outcome: 'other', note: 'محاولة'})).status, 403, 'nor another region');
  check((await post('rep', {action: 'result', id: id1, version: 1, outcome: 'other', note: 'محاولة'})).status, 403, 'nor the asker');
  check((await post('cs_east', {action: 'result', id: id1, version: 1, outcome: 'reached_interested', note: 'ab'})).status, 400, 'an answer needs a few words');
  check((await post('cs_east', {action: 'result', id: id1, version: 1, outcome: 'wants_visit', note: 'يريد زيارة'})).status, 400, 'a visit the customer wants needs its date');
  check((await post('cs_east', {action: 'result', id: id1, version: 1, outcome: 'wants_visit', note: 'يريد زيارة', nextDate: dayOf(-1)})).status, 400, 'a date in the past is refused');
  check((await post('cs_east', {action: 'result', id: id1, version: 1, outcome: 'not-an-outcome', note: 'نتيجة'})).status, 400, 'an unknown outcome is refused');
  check((await post('cs_east', {action: 'result', id: id1, version: 7, outcome: 'reached_interested', note: 'تم الاتصال والعميل مهتم'})).status, 409, 'a stale version is refused');
  const resultBody = {requestId: crypto.randomUUID(), action: 'result', id: id1, version: 1, outcome: 'wants_visit', note: 'العميل مهتم ويطلب زيارة يوم الأحد', nextDate: dayOf(3)};
  const answered = await as('cs_east')('/api/support', {method: 'POST', body: resultBody});
  check(answered.status, 200, 'the holder records the result: ' + answered.text.slice(0, 120));
  const finished = await row(id1);
  check([finished.version, finished.data.status, finished.data.result.outcome, finished.data.result.by, finished.data.result.nextDate, finished.data.handlerId], [2, 'done', 'wants_visit', 'cs_east', dayOf(3), 'cs_east'], 'the request is done, with the outcome, the author and the date the customer asked for');
  const replayed = await as('cs_east')('/api/support', {method: 'POST', body: resultBody});
  check([replayed.status, replayed.json().alreadySaved, (await row(id1)).version], [200, true, 2], 'the same retry saves nothing twice');
  check((await as('cs_east')('/api/support', {method: 'POST', body: {...resultBody, note: 'نص آخر'}})).status, 409, 'the same identifier with different content is refused');
  check((await post('cs_east', {action: 'result', id: id1, version: 2, outcome: 'other', note: 'مرة ثانية'})).status, 403, 'a finished request takes no second answer');
  const answerSeen = entry(await get('rep'), id1);
  check([answerSeen.state, answerSeen.awaiting, answerSeen.result.outcome, answerSeen.result.note, answerSeen.result.byName, answerSeen.result.nextDate, answerSeen.permissions.seen, answerSeen.permissions.cancel], ['done', 'answer', 'wants_visit', 'العميل مهتم ويطلب زيارة يوم الأحد', 'cs_east', dayOf(3), true, false], 'the representative sees the answer and may open it');
  check([(await get('rep')).counts.badge, (await get('sup')).counts.badge, (await get('cs_east')).counts.badge], [1, 0, 0], 'only the asker\'s badge counts the answer');
  check((await post('sup', {action: 'seen', id: id1, version: 2})).status, 403, 'a supervisor cannot open it for them');
  check((await post('rep', {action: 'seen', id: id1, version: 2})).status, 200, 'the asker opens the answer');
  check([(await post('rep', {action: 'seen', id: id1, version: 3})).json().alreadySeen, (await get('rep')).counts.badge, (await row(id1)).data.answerSeenBy], [true, 0, 'rep'], 'once; the badge clears');
  check((await post('rep', {action: 'cancel', id: id1, version: 3})).status, 403, 'a finished request cannot be cancelled');

  // ---- a customer nobody is named for goes to the shared pool; cancel, re-ask, assign
  const central = await request('rep', 'f3', {note: 'العميل لا يرد على المندوب'});
  const id2 = central.json().id;
  check([central.status, (await row(id2)).data.handlerId], [200, ''], 'a central customer: nobody is named for the region, so it waits');
  const waiting = entry(await get('cs_all'), id2);
  check([waiting.state, waiting.awaiting, waiting.permissions.take, waiting.unrouted], ['waiting', 'take', true, false], 'the representative for every region may take it');
  check([await sees('cs_east'), await sees('cs_west')].map(list => list.includes(id2)), [false, false], 'the east and the west do not see it');
  check((await post('cs_east', {action: 'take', id: id2, version: 1})).status, 403, 'a representative outside the region cannot take it');
  check((await post('cs_all', {action: 'assign', id: id2, version: 1, targetId: 'cs_all'})).status, 403, 'a representative cannot assign');
  const cancelled = await post('rep', {action: 'cancel', id: id2, version: 1, reason: 'تم التواصل مع العميل'});
  check(cancelled.status, 200, 'the asker withdraws it');
  check([(await row(id2)).data.status, (await row(id2)).data.cancelReason, (await row(id2)).data.cancelledBy], ['cancelled', 'تم التواصل مع العميل', 'rep'], 'with its reason');
  check((await post('cs_all', {action: 'take', id: id2, version: 2})).status, 403, 'a cancelled request is not taken');
  const second = await request('rep', 'f3', {note: 'لم ينجح الاتصال مرة ثانية'});
  const id3 = second.json().id;
  check(second.status, 200, 'with nothing open the representative may ask again');
  check((await post('csm', {action: 'assign', id: id3, version: 1, targetId: 'cs_east'})).status, 403, 'the manager cannot assign it to a representative who does not cover the region');
  check((await post('csm', {action: 'assign', id: id3, version: 1, targetId: 'rep'})).status, 403, 'nor to a sales member');
  check((await post('csm', {action: 'assign', id: id3, version: 1, targetId: 'cs_b'})).status, 403, 'nor to another branch');
  check((await post('cs_all', {action: 'assign', id: id3, version: 1, targetId: 'cs_all'})).status, 403, 'a representative cannot assign');
  const assigned = await post('csm', {action: 'assign', id: id3, version: 1, targetId: 'cs_all'});
  check(assigned.status, 200, 'the manager assigns it to the shared representative');
  const handled = await row(id3);
  check([handled.version, handled.data.handlerId, handled.data.handlerBy, handled.data.status], [2, 'cs_all', 'csm', 'open'], 'recorded with who assigned it');
  check([(await post('csm', {action: 'assign', id: id3, version: 2, targetId: 'cs_all'})).status], [403], 'it is not assigned again to the one who holds it');
  check((await post('cs_all', {action: 'take', id: id3, version: 2})).status, 403, 'a held request is not taken');
  check((await post('cs_all', {action: 'result', id: id3, version: 2, outcome: 'no_answer', note: 'لم يرد بعد ثلاث محاولات'})).status, 200, 'the representative answers: the customer did not reply');
  check(entry(await get('rep'), id3).result.outcome, 'no_answer', 'and the asker is told');

  // ---- late: only what still waits, only for those who owe the answer
  const waitingAgain = (await request('rep2', 'f2', {note: 'يحتاج العميل متابعة'})).json().id;
  check([(await row(waitingAgain)).data.handlerId, entry(await get('cs_west'), waitingAgain).awaiting], ['cs_west', 'contact'], 'a western customer goes to the western representative');
  await app.db.prepare("UPDATE crm_records SET created_at=? WHERE id=?").bind(new Date(Date.now() - 30 * 86400000).toISOString(), waitingAgain).run();
  const late = entry(await get('csm'), waitingAgain);
  check([late.late, late.stageHours > 4, late.awaiting], [true, true, 'assign'], 'left for a month it is late, and the manager is told');
  check([(await get('csm')).counts.badge, (await get('owner')).counts.badge, (await get('cs_west')).counts.badge], [1, 1, 1], 'the manager, the administrator and the holder count it');
  check(entry(await get('rep2'), waitingAgain).awaiting, null, 'the asker is not made to wait for the answer by a mark');

  // ---- a visit that went unanswered is routed to customer service
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
  const taken = await row('support-missed-visit-missed-1');
  check([taken.data.origin, taken.data.status, taken.data.handlerId, taken.data.requestedBy, taken.data.repId, taken.data.plan.visitId, taken.data.plan.nextDate, taken.version], ['missed_visit', 'open', winner, winner, 'rep', 'visit-missed-1', dayOf(-5), 1], 'it is stored with its plan and held by whoever took it');
  check([(await missedFor('cs_east')).some(item => item.customerId === 'f6'), (await missedFor('csm')).some(item => item.customerId === 'f6')], [false, false], 'a taken visit leaves the missed list');
  const mine = entry(await get(winner), 'support-missed-visit-missed-1');
  check([mine.origin, mine.state, mine.awaiting, mine.plan.nextDate, mine.note], ['missed_visit', 'in_progress', 'contact', dayOf(-5), ''], 'and waits in the holder\'s requests');
  check(entry(await get('rep'), 'support-missed-visit-missed-1').state, 'in_progress', 'the representative whose visit was missed sees that customer service has it');
  check((await post(winner, {action: 'result', id: 'support-missed-visit-missed-1', version: 1, outcome: 'wants_visit', note: 'العميل يطلب زيارة', nextDate: dayOf(2)})).status, 200, 'the holder answers');
  check([(await missedFor('csm')).some(item => item.customerId === 'f6'), entry(await get('rep'), 'support-missed-visit-missed-1').awaiting], [false, 'answer'], 'it does not come back for the same visit, and the representative is told');
  await seedVisit('visit-missed-2', 'f6', {startedAt: dayOf(-1) + 'T07:00:00.000Z', date: dayOf(-1), nextDate: dayOf(-3), createdAt: new Date(Date.now() + 1000).toISOString()});
  check((await missedFor('csm')).some(item => item.customerId === 'f6' && item.visitId === 'visit-missed-2'), true, 'a later negative visit that is again unanswered is a new missed visit');
  await seedVisit('visit-ok', 'f7', {result: 'تم أخذ موعد', nextDate: dayOf(-9)});
  check((await missedFor('csm')).some(item => item.customerId === 'f7'), false, 'a visit that did not end badly is not missed');
  await seedVisit('visit-recent', 'f2', {nextDate: dayOf(-1)});
  check((await missedFor('csm')).some(item => item.customerId === 'f2'), false, 'nor one that is only a day behind');

  // ---- nothing leaks into the pipelines that were here before
  const crm = await (await as('owner')('/api/crm')).json();
  check([crm.records.some(item => item.kind === 'support'), JSON.stringify(crm.audits).includes('support')], [false, false], 'the administrator\'s records and history carry no assistance request');
  for (const id of ['rep', 'sm', 'cs_east']) check(JSON.stringify(await (await as(id)('/api/crm')).json()).includes('"kind":"support"'), false, id + '\'s records carry none either');
  const cases = await (await as('owner')('/api/customer-service')).json();
  check(cases.cases, [], 'no customer-service case was made by any of it');
  const generic = await as('owner')('/api/crm', {method: 'POST', body: {action: 'delete', kind: 'support', id: id1, version: 3}});
  check(generic.status, 400, 'the generic record route does not touch a request');
  const registration = {type: 'call', summary: 'تسجيل طلب', result: 'متابعة العميل', salesStage: 'new', strength: 'strong', requestedProducts: ['خدمات صيانة'], nextAction: 'متابعة', nextDate: today, location: '26.43, 50.03', locationSource: 'device', locationCapturedAt: now, locationAccuracy: 10, customerNeeds: 'صيانة'};
  const openForF1 = await request('rep', 'f1', {note: 'طلب جديد بعد الإغلاق'});
  check(openForF1.status, 200, 'a new request for f1 is made while a service case is about to be');
  const caseMade = await as('cs_east')('/api/customer-service', {method: 'POST', body: {action: 'create', requestId: crypto.randomUUID(), customerId: 'f1', customerVersion: await version('f1'), registration, elapsedMilliseconds: 2000}});
  check(caseMade.status, 200, 'an open assistance request does not stop customer service registering a case for the same customer: ' + caseMade.text.slice(0, 100));
  const visit = await as('rep')('/api/visits', {method: 'POST', body: {createKey: crypto.randomUUID(), customerId: 'f6', customerVersion: await version('f6'), timingMode: 'automatic', elapsedMilliseconds: 2000, data: {type: 'call', date: today, summary: 'تواصل مع العميل', result: 'تم التواصل', salesStage: 'new', strength: 'medium', nextAction: 'زيارة فنية', nextDate: today, location: '26.43, 50.03', locationSource: 'device', locationCapturedAt: now, locationAccuracy: 10}}});
  check(visit.status, 200, 'a representative still records a visit: ' + visit.text.slice(0, 100));
  check((await row(visit.json().id)).data.serviceCaseId, undefined, 'and it is not tied to an assistance request as if it were a case');
  check((await missedFor('csm')).some(item => item.customerId === 'f6'), false, 'a fresh visit closes whatever was missed for that customer');
  const audit = await app.db.prepare("SELECT action,record_id FROM crm_audit WHERE action LIKE 'support:%' ORDER BY created_at,id").all();
  const actions = audit.results.map(item => item.action);
  ok(['support:request', 'support:result', 'support:seen', 'support:cancel', 'support:assign'].every(action => actions.includes(action)), 'every change is in the audit trail');
  check((await app.db.prepare("SELECT COUNT(*) AS n FROM crm_audit WHERE action='support-receipt'").first()).n > 10, true, 'with a receipt for each so that a retry is safe');

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
