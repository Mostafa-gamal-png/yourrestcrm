// Customer complaints over real HTTP against the BUILT release (run `pnpm build` first): customer service registers a
// complaint, its manager returns it and then hands it to the sales manager, who assigns a supervisor who delegates a representative;
// the representative opens it, records contacts and the resolution; customer service sends it back once, then closes it, reopens
// it and closes it again; cancellations, reassignments, notes, another branch, a registrar with no manager; who sees and who may
// act at every step; idempotent retries and stale versions; and that none of it leaks into the record, visit, case or
// assistance pipelines. Synthetic isolated fixtures only: temporary SQLite, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'}, {id: 'sm2', role: 'manager'},
  {id: 'sup', role: 'supervisor', sup: 'sm'}, {id: 'sup2', role: 'supervisor', sup: 'sm2'},
  {id: 'rep', role: 'rep', sup: 'sup'}, {id: 'rep2', role: 'rep', sup: 'sup'}, {id: 'outside', role: 'rep', sup: 'sup2'},
  {id: 'csm', role: 'customer_service_manager', sup: 'sm'}, {id: 'csm2', role: 'customer_service_manager', sup: 'sm2'},
  {id: 'cs_east', role: 'customer_service', sup: 'csm', region: 'eastern'}, {id: 'cs_west', role: 'customer_service', sup: 'csm', region: 'western'}, {id: 'cs_all', role: 'customer_service', sup: 'csm'}, {id: 'cs_lone', role: 'customer_service'},
  {id: 'csm_b', role: 'customer_service_manager', sup: 'sm', branch: 'فرع آخر'}, {id: 'cs_b', role: 'customer_service', sup: 'csm_b', branch: 'فرع آخر'}, {id: 'rep_b', role: 'rep', sup: 'sup', branch: 'فرع آخر'}
];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const app = await bootBuiltApp({members});
try {
  const sessions = {};
  for (const member of members) sessions[member.id] = await app.login(member.id);
  const as = id => app.as(sessions[id]);
  const now = new Date().toISOString();
  const customer = (id, assignedTo, region, branch = 'الرئيسي') => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,?,?,?,?,1,'fixture')")
    .bind(id, assignedTo, branch, JSON.stringify({name: 'مصنع ' + id, region, city: 'الدمام', phone: '0551234567', contact: 'أبو خالد', code: id, branch, assignedTo}), now, now).run();
  await customer('f1', 'rep', 'الشرقية'); await customer('f2', 'rep2', 'الغربية'); await customer('f3', 'outside', 'الشرقية'); await customer('f4', 'rep_b', 'الشرقية', 'فرع آخر'); await customer('f5', 'rep', 'الوسطى');
  const version = async id => (await app.db.prepare('SELECT version FROM crm_records WHERE id=?').bind(id).first())?.version ?? 1;
  const get = async id => (await as(id)('/api/complaints')).json();
  const post = (id, body) => as(id)('/api/complaints', {method: 'POST', body: {requestId: crypto.randomUUID(), ...body}});
  const entry = (list, id) => list.complaints.find(item => item.id === id);
  const seen = async (who, id) => entry(await get(who), id);
  const report = {channel: 'call', category: 'product_quality', severity: 'normal', description: 'القالب يخرج منتجًا مكسورًا من الجهة اليمنى', demand: 'استبدال القالب', reference: 'INV-100'};
  const register = async (id, customerId, body = {}) => post(id, {action: 'register', customerId, customerVersion: await version(customerId), ...report, ...body});
  const act = async (who, id, body) => post(who, {id, version: (await app.db.prepare('SELECT version FROM crm_records WHERE id=?').bind(id).first()).version, ...body});
  const row = async id => { const found = await app.db.prepare('SELECT kind,parent_id,assigned_to,branch,data,version FROM crm_records WHERE id=?').bind(id).first(); return found && {...found, data: JSON.parse(found.data)}; };
  const sees = async id => (await get(id)).complaints.map(item => item.id);

  // ---- the door: signed in, same origin, a known shape
  const anonymous = app.as(null);
  check((await anonymous('/api/complaints')).status, 401, 'anonymous callers get 401 on GET');
  check([(await anonymous('/api/complaints', {method: 'POST', body: {}})).status, (await anonymous('/api/complaints', {method: 'POST', body: {requestId: crypto.randomUUID(), action: 'register', customerId: 'f1', customerVersion: 1, ...report}})).status], [401, 401], 'and on POST, with an empty or a plausible body');
  check((await app.request('/api/complaints', {method: 'POST', body: {}})).status, 403, 'a POST that does not come from the site itself is refused');
  for (const id of ['owner', 'sm', 'sup', 'rep', 'cs_east', 'csm', 'cs_b', 'cs_lone']) {
    const answer = await as(id)('/api/complaints');
    check([id, answer.status, answer.headers['cache-control'], answer.json().complaints, answer.json().counts], [id, 200, 'no-store', [], {complaints: 0, open: 0, badge: 0}], id + ' asks first: nothing yet, never cached');
  }
  check((await register('cs_east', 'f1', {surprise: true})).status, 400, 'an unknown field is refused');
  check((await as('cs_east')('/api/complaints', {method: 'POST', body: {action: 'register', customerId: 'f1', customerVersion: 1, ...report}})).status, 400, 'a request without its own identifier is refused');
  check((await post('cs_east', {action: 'launch'})).status, 400, 'an unknown action is refused');
  check([(await register('cs_east', 'f1', {description: 'قصير'})).status, (await register('cs_east', 'f1', {category: 'weather'})).status, (await register('cs_east', 'f1', {severity: 'urgent'})).status, (await register('cs_east', 'f1', {channel: 'fax'})).status], [400, 400, 400, 400], 'a short description, an unknown category, severity or channel are refused');

  // ---- who registers
  check([(await register('rep', 'f1')).status, (await register('sm', 'f1')).status, (await register('sup', 'f1')).status], [403, 403, 403], 'sales members do not register complaints');
  check([(await register('cs_west', 'f1')).status, (await register('cs_b', 'f1')).status], [403, 403], 'customer service of another region or another branch does not either');
  check((await register('cs_east', 'missing')).status, 404, 'a customer that does not exist is refused');
  check((await post('cs_east', {action: 'register', customerId: 'f1', customerVersion: 99, ...report})).status, 409, 'a stale customer version is refused');

  // ---- registered: stored as its own kind, routed to the registrar's manager, with the customer's contact
  const first = await register('cs_east', 'f1');
  check(first.status, 200, 'customer service of the east registers a complaint for an eastern customer: ' + first.text.slice(0, 120));
  const id1 = first.json().id;
  let stored = await row(id1);
  check([stored.kind, stored.parent_id, stored.assigned_to, stored.branch, stored.version], ['complaint', null, 'cs_east', 'الرئيسي', 1], 'it is stored as a record of its own kind, with no parent');
  check([stored.data.status, stored.data.registrarId, stored.data.serviceManagerId, stored.data.salesManagerId, stored.data.assigneeId, stored.data.category, stored.data.severity, stored.data.contactName, stored.data.contactPhone, stored.data.events.map(event => event.action)], ['submitted', 'cs_east', 'csm', '', '', 'product_quality', 'normal', 'أبو خالد', '0551234567', ['register']], 'waiting for the registrar\'s manager, with the customer\'s contact filled in');
  const sameBody = {action: 'register', customerId: 'f1', customerVersion: await version('f1'), ...report}, key = crypto.randomUUID();
  const once = await as('cs_east')('/api/complaints', {method: 'POST', body: {requestId: key, ...sameBody}});
  const twice = await as('cs_east')('/api/complaints', {method: 'POST', body: {requestId: key, ...sameBody}});
  check([once.status, twice.status, twice.json().alreadySaved, twice.json().id === once.json().id], [200, 200, true, true], 'a retry with the same identifier saves nothing twice');
  check((await as('cs_east')('/api/complaints', {method: 'POST', body: {requestId: key, ...sameBody, demand: 'غير ذلك'}})).status, 409, 'and the same identifier with another body is refused');
  const duplicate = once.json().id;
  check((await act('cs_east', duplicate, {action: 'cancel', reason: 'سُجّلت مرتين'})).status, 200, 'the registrar cancels the double');
  check((await row(duplicate)).data.status, 'cancelled', 'and it is cancelled');

  // ---- who sees a fresh complaint, and what they may do with it
  check([await sees('cs_east'), await sees('cs_all'), await sees('csm'), await sees('owner')].map(list => list.includes(id1)), [true, true, true, true], 'the registrar, the colleague for every region, their manager and the administrator see it');
  check([await sees('cs_west'), await sees('cs_b'), await sees('csm2'), await sees('sm'), await sees('sup'), await sees('rep')], [[], [], [], [], [], []], 'the west, another branch, the other manager and sales do not');
  const fresh = await seen('cs_east', id1);
  check([fresh.status, fresh.stage, fresh.awaiting, fresh.permissions.edit, fresh.permissions.forward, fresh.permissions.cancel, fresh.targetHours, fresh.late, fresh.registrarName, fresh.serviceManagerName], ['submitted', 'review', null, true, false, true, 4, false, 'cs_east', 'csm'], 'the registrar may correct or cancel it and waits for nothing');
  const forManager = await seen('csm', id1);
  check([forManager.awaiting, forManager.permissions.forward, forManager.permissions.return, forManager.candidates.map(person => person.id)], ['review', true, true, ['sm']], 'the manager is asked to review it and may hand it to the sales manager linked to him');
  check([(await get('csm')).counts.badge, (await get('cs_east')).counts.badge, (await get('owner')).counts.badge], [1, 0, 0], 'the badge: one for the manager, nothing for the registrar or the administrator');
  check((await act('cs_all', id1, {action: 'edit', ...report, description: 'نص آخر لا يحق لي كتابته'})).status, 403, 'a colleague may not correct it');
  check((await act('cs_east', id1, {action: 'forward', targetId: 'sm'})).status, 403, 'nor may the registrar forward it');

  // ---- returned for correction, corrected and resent
  check((await act('csm', id1, {action: 'return', note: 'أض'})).status, 400, 'a return needs a note');
  check((await act('csm', id1, {action: 'return', note: 'أضف رقم الفاتورة ونوع القالب'})).status, 200, 'the manager returns it with what is missing');
  stored = await row(id1);
  check([stored.data.status, stored.data.returnNote, stored.version], ['returned', 'أضف رقم الفاتورة ونوع القالب', 2], 'it waits for its registrar');
  check([(await seen('cs_east', id1)).awaiting, (await seen('csm', id1)).awaiting], ['fix', null], 'who is asked to correct it');
  check((await act('cs_east', id1, {action: 'edit', ...report, description: 'القالب يخرج منتجًا مكسورًا من الجهة اليمنى، قالب بلوك 20', reference: 'INV-100 / قالب بلوك 20', severity: 'high'})).status, 200, 'the registrar corrects and resends it');
  stored = await row(id1);
  check([stored.data.status, stored.data.returnNote, stored.data.severity, stored.data.reference, stored.data.events.map(event => event.action)], ['submitted', '', 'high', 'INV-100 / قالب بلوك 20', ['register', 'return', 'edit']], 'it is back with the manager, corrected, with its story kept');
  check((await act('csm', id1, {action: 'forward', targetId: 'sm2'})).status, 403, 'the manager cannot hand it to a sales manager who is not his');
  check((await act('csm', id1, {action: 'assign', targetId: 'rep'})).status, 403, 'nor assign it himself');
  check((await act('csm', id1, {action: 'forward', targetId: 'sm'})).status, 200, 'he hands it to his sales manager');
  stored = await row(id1);
  check([stored.data.status, stored.data.salesManagerId, stored.data.serviceManagerId, !!stored.data.forwardedAt], ['pending_assignment', 'sm', 'csm', true], 'it waits for the sales manager');
  check((await act('cs_east', id1, {action: 'edit', ...report})).status, 403, 'once forwarded the registrar can no longer correct it');
  check([await sees('sm'), await sees('sm2'), await sees('rep')], [[id1], [], []], 'the sales manager it went to sees it; the other and the representatives do not');
  const toAssign = await seen('sm', id1);
  check([toAssign.awaiting, toAssign.permissions.assign, toAssign.candidates[0].id, toAssign.suggestedId, toAssign.currentRepName, toAssign.candidates.map(person => person.id).includes('rep_b'), toAssign.candidates.map(person => person.id).includes('outside')], ['assign', true, 'rep', 'rep', 'rep', false, true], 'he is asked to assign it; the customer\'s own representative is suggested first; another branch is not offered');
  check([(await get('sm')).counts.badge, (await get('csm')).counts.badge], [1, 0], 'the badge moved from the manager to the sales manager');

  // ---- assigned to a supervisor, who delegates to a representative
  check((await act('sm2', id1, {action: 'assign', targetId: 'rep'})).status, 403, 'the other sales manager cannot assign it');
  check((await act('sm', id1, {action: 'assign', targetId: 'rep_b'})).status, 403, 'nor can it go to another branch');
  check((await act('sm', id1, {action: 'assign', targetId: 'sup', note: 'العميل مهم، تابعه بنفسك'})).status, 200, 'the sales manager assigns it to a supervisor');
  stored = await row(id1);
  check([stored.data.status, stored.data.assigneeId, stored.data.supervisorId, stored.data.assignmentNote, !!stored.data.assignedAt], ['assigned', 'sup', 'sup', 'العميل مهم، تابعه بنفسك', true], 'the supervisor holds it');
  check([(await seen('sup', id1)).awaiting, (await seen('sup', id1)).stage, (await seen('sup', id1)).candidates.map(person => person.id), await sees('rep'), await sees('sup2')], ['delegate', 'delegation', ['rep', 'rep2'], [], []], 'he is asked to delegate it to one of his representatives of the region');
  check((await act('sup', id1, {action: 'delegate', targetId: 'outside'})).status, 403, 'not to someone else\'s representative');
  check((await act('sup2', id1, {action: 'delegate', targetId: 'outside'})).status, 403, 'and another supervisor cannot touch it');
  check((await act('sup', id1, {action: 'delegate', targetId: 'rep', note: 'تواصل مع العميل اليوم'})).status, 200, 'he delegates it to the customer\'s representative');
  stored = await row(id1);
  check([stored.data.assigneeId, stored.data.supervisorId, stored.data.previousAssignees, !!stored.data.delegatedAt, stored.data.assignmentNote], ['rep', 'sup', ['sup'], true, 'تواصل مع العميل اليوم'], 'the representative holds it, his supervisor remembered');
  const held = await seen('rep', id1);
  check([held.awaiting, held.stage, held.targetHours, held.permissions.seen, held.permissions.update, held.permissions.resolve, held.permissions.delegate, held.description, held.contactPhone, held.assignmentNote, held.supervisorName], ['contact', 'first_contact', 24, true, true, true, false, 'القالب يخرج منتجًا مكسورًا من الجهة اليمنى، قالب بلوك 20', '0551234567', 'تواصل مع العميل اليوم', 'sup'], 'the representative is asked to contact the customer and sees the whole report');
  check([await sees('rep2'), (await sees('sup')).length, (await sees('sm2')).length, (await sees('csm')).length], [[], 1, 1, 2], 'his colleague does not see it; his supervisor, the sales managers and customer service do (the manager also still sees the cancelled double among the finished ones)');
  check([(await get('rep')).counts.badge, (await get('sup')).counts.badge], [1, 0], 'the badge is with the representative now');

  // ---- opened, updated, resolved
  check((await act('rep', id1, {action: 'seen'})).status, 200, 'the representative opens it');
  ok(!!(await row(id1)).data.seenAt, 'which is recorded');
  check((await act('rep', id1, {action: 'seen'})).json().alreadySeen, true, 'and not recorded again');
  check((await act('rep2', id1, {action: 'update', channel: 'call', text: 'اتصلت بالعميل'})).status, 403, 'someone else cannot update it');
  check((await act('rep', id1, {action: 'update', channel: 'visit', text: 'زرت المصنع وفحصت القالب: التلف في الجهة اليمنى فعلًا', date: '2026-10-14'})).status, 200, 'the representative records his visit');
  const contacted = await seen('rep', id1);
  check([contacted.updates.map(update => [update.channel, update.text, update.byName, update.date]), contacted.awaiting, contacted.stage, contacted.targetHours], [[['visit', 'زرت المصنع وفحصت القالب: التلف في الجهة اليمنى فعلًا', 'rep', '2026-10-14']], 'resolve', 'resolution', 50], 'the first contact is made; now the resolution is expected within 50 working hours');
  check((await act('cs_east', id1, {action: 'resolve', outcome: 'solved', note: 'حُلّت'})).status, 403, 'customer service does not record the resolution');
  check((await act('rep', id1, {action: 'resolve', outcome: 'fixed', note: 'استُبدل القالب'})).status, 400, 'an unknown outcome is refused');
  check((await act('rep', id1, {action: 'resolve', outcome: 'solved', note: 'استُبدل القالب بقالب جديد وجُرّب أمام العميل'})).status, 200, 'the representative records the resolution');
  stored = await row(id1);
  check([stored.data.status, stored.data.resolution.outcome, stored.data.resolution.by, !!stored.data.resolvedAt], ['resolved', 'solved', 'rep', true], 'it waits for customer service to confirm');
  check([(await seen('cs_east', id1)).awaiting, (await seen('csm', id1)).awaiting, (await seen('owner', id1)).awaiting, (await seen('rep', id1)).awaiting, (await seen('rep', id1)).permissions.update], ['close', null, null, null, false], 'the registrar is asked to close it; nobody else while the registrar is there');
  check([(await get('cs_east')).counts.badge, (await get('rep')).counts.badge], [1, 0], 'the badge is with the registrar');

  // ---- sent back once, resolved again, closed
  check((await act('rep', id1, {action: 'close', outcome: 'satisfied'})).status, 403, 'the representative does not close it');
  check((await act('cs_west', id1, {action: 'close', outcome: 'satisfied'})).status, 403, 'nor does customer service of another region');
  check((await act('cs_east', id1, {action: 'reject', reason: 'العميل يقول إن القالب الجديد يهتز'})).status, 200, 'the registrar sends it back to the representative');
  stored = await row(id1);
  check([stored.data.status, stored.data.rejectReason, stored.data.resolution, !!stored.data.rejectedAt, stored.data.assigneeId], ['assigned', 'العميل يقول إن القالب الجديد يهتز', undefined, true, 'rep'], 'the representative holds it again');
  check([(await seen('rep', id1)).awaiting, (await seen('rep', id1)).stage, (await seen('rep', id1)).rejectReason], ['contact', 'first_contact', 'العميل يقول إن القالب الجديد يهتز'], 'and is asked to contact the customer again');
  check((await act('rep', id1, {action: 'update', channel: 'call', text: 'ضبط الفني التثبيت وتوقف الاهتزاز'})).status, 200, 'he records the second contact');
  check((await act('rep', id1, {action: 'resolve', outcome: 'partially_solved', note: 'توقف الاهتزاز، ويبقى خدش في السطح يُعالج مع الصيانة'})).status, 200, 'and resolves it again');
  check((await act('cs_east', id1, {action: 'close', outcome: 'satisfied', note: 'أكد العميل أن المشكلة انتهت'})).status, 200, 'the registrar confirms with the customer and closes it');
  stored = await row(id1);
  check([stored.data.status, stored.data.closure.outcome, stored.data.closure.by, !!stored.data.closedAt, stored.data.events.map(event => event.action)], ['closed', 'satisfied', 'cs_east', true, ['register', 'return', 'edit', 'forward', 'assign', 'delegate', 'resolve', 'reject', 'resolve', 'close']], 'closed, with its whole story');
  const finished = await seen('rep', id1);
  check([finished.status, finished.stage, finished.closure.outcome, finished.closure.byName, finished.updates.length, finished.awaiting, finished.permissions.reopen], ['closed', 'closed', 'satisfied', 'cs_east', 2, null, false], 'the representative sees it closed and cannot reopen it');
  check([(await get('cs_east')).counts.badge, (await get('cs_east')).counts.open], [0, 0], 'nothing waits any more');

  // ---- reopened within the window, closed for good
  check((await act('rep', id1, {action: 'reopen', reason: 'العميل عاد'})).status, 403, 'the representative does not reopen it');
  check((await act('cs_east', id1, {action: 'reopen', reason: 'اتصل العميل مرة أخرى: الخدش اتسع'})).status, 200, 'the registrar reopens it within fourteen days');
  stored = await row(id1);
  check([stored.data.status, stored.data.assigneeId, stored.data.closure, stored.data.resolution, !!stored.data.reopenedAt], ['assigned', 'rep', undefined, undefined, true], 'it goes back to the same representative');
  check((await seen('rep', id1)).awaiting, 'contact', 'who is asked to contact the customer');
  check((await act('rep', id1, {action: 'resolve', outcome: 'solved', note: 'بُدّل السطح'})).status, 200, 'he resolves it');
  check((await act('csm', id1, {action: 'close', outcome: 'satisfied', note: 'أغلقها المدير بعد اتصاله بالعميل'})).status, 200, 'the manager may close it too');
  check((await row(id1)).data.status, 'closed', 'closed');

  // ---- cancellation: only before it is assigned, by the registrar or the manager; the administrator any time
  const second = (await register('cs_east', 'f1', {category: 'delivery_delay', description: 'تأخر التسليم أسبوعين عن الموعد المتفق عليه'})).json().id;
  ok(second, 'a second complaint for the same customer is allowed');
  check((await act('rep', second, {action: 'cancel', reason: 'x'})).status, 403, 'the representative cannot cancel it');
  check((await act('cs_all', second, {action: 'cancel', reason: 'x'})).status, 403, 'nor a colleague');
  check((await act('csm', second, {action: 'forward', targetId: 'sm'})).status, 200, 'forwarded');
  check((await act('cs_east', second, {action: 'cancel', reason: 'العميل تراجع'})).status, 403, 'once forwarded the registrar cannot cancel it');
  check((await act('owner', second, {action: 'cancel', reason: 'سُجّلت لعميل آخر'})).status, 200, 'the administrator can');
  check((await row(second)).data.status, 'cancelled', 'cancelled');

  // ---- reassignment and notes
  const third = (await register('cs_east', 'f1', {category: 'invoice_price', description: 'الفاتورة فيها بند لم يُطلب ويجب حذفه'})).json().id;
  await act('csm', third, {action: 'forward', targetId: 'sm'});
  check((await act('sm', third, {action: 'assign', targetId: 'rep', note: ''})).status, 200, 'assigned straight to the representative');
  check((await act('sup', third, {action: 'reassign', targetId: 'rep2'})).status, 403, 'a supervisor does not reassign');
  check((await act('sm', third, {action: 'reassign', targetId: 'rep'})).status, 403, 'nor can it be reassigned to its own holder');
  check((await act('sm', third, {action: 'reassign', targetId: 'rep2', note: 'المندوب في إجازة'})).status, 200, 'the sales manager moves it to another representative');
  stored = await row(third);
  check([stored.data.assigneeId, stored.data.previousAssignees, stored.data.supervisorId, !!stored.data.reassignedAt], ['rep2', ['rep'], 'sup', true], 'the new holder, the old one remembered');
  check([await sees('rep'), (await seen('rep2', third)).awaiting], [[id1], 'contact'], 'the first representative no longer sees it; the second is asked to contact the customer');
  check((await act('csm', third, {action: 'note', text: 'العميل اتصل بنا مرتين عن هذه الفاتورة'})).status, 200, 'the manager leaves a note');
  check((await seen('rep2', third)).notes.map(note => [note.text, note.byName]), [['العميل اتصل بنا مرتين عن هذه الفاتورة', 'csm']], 'which the holder reads');
  check((await act('outside', third, {action: 'note', text: 'لا أرى هذه الشكوى'})).status, 403, 'someone outside its chain cannot');
  const stale = await post('rep2', {action: 'update', id: third, version: 1, channel: 'call', text: 'اتصلت بالعميل'});
  check(stale.status, 409, 'a stale version is refused');

  // ---- another branch and a registrar with no manager
  const other = (await register('cs_b', 'f4', {description: 'الصيانة تأخرت عن الموعد المتفق عليه مرتين', category: 'maintenance_support'})).json().id;
  ok(other, 'customer service of the other branch registers for its own customer');
  check([(await row(other)).data.serviceManagerId, (await sees('csm')).includes(other), (await sees('csm_b')).includes(other)], ['csm_b', false, true], 'it waits for that branch\'s manager, not the main one');
  check((await act('csm_b', other, {action: 'forward', targetId: 'sm'})).status, 200, 'who hands it to his sales manager');
  check((await act('sm', other, {action: 'assign', targetId: 'rep'})).status, 403, 'the sales manager cannot assign it outside the customer\'s branch');
  check((await act('sm', other, {action: 'assign', targetId: 'rep_b'})).status, 200, 'only inside it');
  const lone = (await register('cs_lone', 'f5', {description: 'طلب تدريب على القالب الجديد لم يُجب عليه أحد', category: 'service_conduct'})).json().id;
  check([(await row(lone)).data.serviceManagerId, (await seen('csm', lone)).unrouted, (await seen('csm2', lone)).awaiting, (await seen('owner', lone)).awaiting], ['', true, 'review', 'review'], 'a registrar with no manager: any manager of the branch, or the administrator, is asked to review it');
  check((await act('csm2', lone, {action: 'forward', targetId: 'sm2'})).status, 200, 'the other manager takes it and hands it to his sales manager');
  check([(await row(lone)).data.serviceManagerId, (await row(lone)).data.salesManagerId], ['csm2', 'sm2'], 'and becomes its manager');

  // ---- nothing of it reached the records, the visits, the cases or the assistance
  for (const who of ['owner', 'sm', 'rep', 'cs_east', 'csm']) {
    const crm = (await as(who)('/api/crm')).json();
    check([who, crm.records.some(record => record.kind === 'complaint'), JSON.stringify(crm.audits || []).includes('complaint'), (crm.serviceQueue || []).length], [who, false, false, 0], who + ': no complaint among the records, the history or the service queue');
  }
  check((await as('owner')('/api/customer-service')).json().cases, [], 'no customer-service case was made');
  check((await as('owner')('/api/support')).json().requests, [], 'and no assistance request');
  const counts = (await get('owner')).counts;
  check([counts.complaints, counts.open, counts.badge], [6, 3, 0], 'the administrator counts every complaint, the open ones, and is asked for nothing');
  check((await app.db.prepare("SELECT COUNT(*) AS n FROM crm_audit WHERE action LIKE 'complaint:%'").first()).n > 20, true, 'every action left its audit line');

  console.log(JSON.stringify({ok: true, checks, scope: 'complaints over HTTP on the built release: door, registration rights, return and correction, forward, assignment and delegation, opening, updates, resolution, rejection, closure, reopening, cancellation, reassignment, notes, another branch, no manager, no leak', realBrowser: false, realDevice: false}));
} finally {
  await app.stop();
}
