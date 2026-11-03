// Mold manufacturing requests over real HTTP against the BUILT release (run `pnpm build` first), sending to a stand-in production API
// (scripts/lib/products-mock.mjs, HTTPS with a throwaway CA) that checks the signature and fields as the PHP does: a representative
// asks for a mold for a customer of their own region, it is saved then signed and sent with the customer's Yourrest number; who sees
// and who may change it; a repeated tap; edits while received; production starting first (409, the edit withdrawn); cancelling;
// production unreachable (kept waiting on the §6 timetable, resend, the last known status with its reason); production without its
// secret; a release without the link settings (sending off, the rest of the CRM unaffected); the secret never in a page or answer.
// Since 2026-11-01: every role asks (customer service from its branch's customers), and the sales manager alone approves a request
// waiting for them, or withdraws the approval until production approves (production's approval route, the approval chain).
// Since 2026-11-02: a request's city as the sheet writes it, customer names up to 200 characters, a request deleted in production read as
// cancelled, the real reason when production refuses an approval (cancelled there, 404), and a request that waited through a restart
// sent as soon as any page loads. And once sent (accepted, or an attempt that may have arrived) a request's data is edited by the
// production manager only: the update is refused with production_only's text and production is not asked; a request production never
// stored (refused at its door, or never attempted) is still edited before its first send; a change queued by the earlier release that
// meets 409 production_only is final, shown with the reason, never sent again, and production's status from the answer is stored (or,
// without a usable status, production is still known to hold the request, whose status is then pulled); where the CRM never learned what
// production accepted, its refused copy stays marked unconfirmed through later errors; a queued change production refuses for its data
// (400) is dropped for good; the stand-in answers the CRM's ORIGINAL data again with 200 created:false even after the production
// manager edited the request there, and other data with 409; the update's refusal carries the request; the update's own SQL guard
// refuses a save once a send was claimed after its check; the sales manager's list shows each request's data as production holds it
// now (edited there); cancelling and design files are as before.
// Since 2026-11-03 (yourrest-products): every new request carries how the customer pays (cash or deferred, required; sent beside
// customer, salesman and specs; shown with each request waiting for the sales manager), and a request asked for before is resent exactly
// as first sent (200 created:false); a cancellation the production manager restores: the next status pull shows the request active again
// (cancelling and files back), a reason used before is refused here without asking production, a new one cancels it; a cancellation
// waiting for its resend is dropped once the CRM saw the request cancelled and then restored, while one that never reached production
// is still sent; and production answering a cancellation with the request not cancelled (restored, the reason used) is said, not retried,
// as no longer cancellable once the request was approved since; a cancellation waiting while a pull already saw it cancelled is settled,
// not sent again, and the restore is the next pull's (audited).
// Synthetic isolated fixtures only: temporary SQLite, mocked sendmail, no production data, no real production application.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';

const members = [
  {id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'},
  {id: 'sup', role: 'supervisor', sup: 'sm'}, {id: 'sup2', role: 'supervisor', sup: 'sm'},
  {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'أحمد عبد العزيز'}, {id: 'rep2', role: 'rep', sup: 'sup2'},
  {id: 'csm', role: 'customer_service_manager', sup: 'sm'}, {id: 'cs', role: 'customer_service', sup: 'csm'},
];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const specs = {description: '200*400*27.5TH MM OPEN', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: 'YR099-9', quantity: 1, designUrl: 'https://drive.google.com/x', notes: 'أول طلب'};
const mock = await startProductsMock();
const settings = {YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret, NODE_EXTRA_CA_CERTS: mock.ca};
const app = await bootBuiltApp({members}, {env: settings});
try {
  const sessions = {};
  for (const member of members) sessions[member.id] = await app.login(member.id);
  const as = id => app.as(sessions[id]);
  const now = new Date().toISOString();
  const customer = (id, assignedTo, region) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, assignedTo, JSON.stringify({name: 'مصنع ' + id, region, city: 'الدمام', address: 'حي الصناعية', phone: '0551234567', email: 'factory@example.com', code: 'ERP-' + id, branch: 'الرئيسي', assignedTo}), now, now).run();
  await customer('east1', 'rep', 'الشرقية'); await customer('west1', 'rep2', 'الغربية'); await customer('east2', 'rep', 'الشرقية');
  const number = async id => (await app.db.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').bind(id).first()).number;
  const get = async (who, query = '') => as(who)('/api/mold-requests' + query);
  const list = async who => (await get(who)).json();
  const post = (who, body) => as(who)('/api/mold-requests', {method: 'POST', body: {requestId: crypto.randomUUID(), ...body}});
  // How the customer pays is chosen with every request (2026-11-03).
  const create = (who, customerId, extra = {}, ...payment) => post(who, {action: 'create', customerId, specs: {...specs, ...extra}, payment: payment.length ? payment[0] : 'cash'});
  const stored = async id => app.db.prepare('SELECT * FROM crm_mold_requests WHERE id=?').bind(id).first();
  const age = id => app.db.prepare("UPDATE crm_mold_requests SET remote_at='2026-01-01T00:00:00.000Z' WHERE id=?").bind(id).run();
  const calls = route => mock.state.calls.filter(call => call.route === route).length;

  // ---- who reaches the page
  check((await app.request('/api/mold-requests')).status, 401, 'anonymous: 401');
  check([(await get('cs')).status, (await get('csm')).status], [200, 200], 'customer service has the page too');
  check((await app.request('/api/mold-requests', {method: 'POST', headers: {Cookie: sessions.rep}, body: {action: 'create'}})).status, 403, 'no origin: refused');
  const empty = await list('rep');
  check([empty.requests, empty.linkReady, empty.canCreate, empty.statusError], [[], true, true, null], 'a representative: an empty list, the link ready, may ask');
  check([(await list('sup')).canCreate, (await list('cs')).canCreate, (await list('owner')).canCreate], [true, true, true], 'everyone asks');

  // ---- a request: saved, then signed and sent
  let res = await create('rep', 'east1');
  let body = await res.json();
  check([res.status, body.send.kind, body.request.sending.state, body.request.remote.orderNo, body.request.remote.status, body.request.editable], [200, 'ok', 'sent', 92, 'received', true], 'saved and delivered: order 92, received, still editable');
  check([body.request.remote.waitingStep, body.request.remote.approvals], ['sales', {required: true, sales: null, production: null, admin: null}], 'it waits for the sales manager\'s approval');
  const first = body.request.id;
  ok(/^mr-[0-9a-f-]{36}$/.test(first), 'the CRM request id is the contract crmRequestId');
  const sent = JSON.parse(mock.state.calls.findLast(call => call.route === 'requests').body);
  check(sent.customer, {crmNumber: await number('east1'), name: 'مصنع east1', address: 'حي الصناعية', city: 'Damam - الدمام'}, 'the customer by its Yourrest number, never its ERP code, phone or email; one of the sheet\'s cities as the sheet writes it');
  check(JSON.parse((await stored(first)).data).customer.city, 'Damam - الدمام', 'and stored that way, so a resend sends the same bytes');
  check(sent.salesman, {crmMemberId: 'rep', name: 'أحمد عبد العزيز', email: 'rep@yourrest.org'}, 'the representative');
  ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+03:00$/.test(sent.requestedAt), 'requestedAt in Riyadh time with its offset');
  ok(mock.state.calls.every(call => call.signed || call.route === ''), 'every call was signed with the shared secret');
  check((await app.db.prepare("SELECT COUNT(*) AS n FROM crm_audit WHERE record_id=? AND action='mold-request:create'").bind(first).first()).n, 1, 'audited');

  // ---- what may not be asked
  check((await create('rep', 'west1')).status, 404, 'a customer outside the representative\'s region: 404');
  res = await create('rep', 'east1', {moldWidth: 999, core: 'half', designUrl: 'http://x'});
  body = await res.json();
  check([res.status, Object.keys(body.fields).sort()], [400, ['core', 'designUrl', 'moldWidth']], 'wrong fields: 400 naming each one');
  // How the customer pays is required (2026-11-03): none, or anything but cash or deferred, is refused before anything is saved or sent.
  const PAYMENT_REQUIRED = 'اختار طريقة الدفع: نقدي أو آجل', unpaid = calls('requests');
  for (const payment of [undefined, 'card', 'CASH', null]) {
    res = await create('rep', 'east1', {description: 'no payment'}, payment);
    body = await res.json();
    check([res.status, body.fields, body.error], [400, {payment: PAYMENT_REQUIRED}, PAYMENT_REQUIRED], 'payment ' + payment + ': 400 with the field\'s message');
  }
  body = await (await create('rep', 'east1', {moldWidth: 999}, undefined)).json();
  check(Object.keys(body.fields).sort(), ['moldWidth', 'payment'], 'named with the other wrong fields at once');
  check([calls('requests') - unpaid, (await app.db.prepare("SELECT COUNT(*) AS n FROM crm_mold_requests WHERE json_extract(data,'$.specs.description')='no payment'").first()).n], [0, 0], 'nothing saved or sent');
  check([sent.payment, Object.keys(sent), JSON.parse((await stored(first)).data).payment, (await list('rep')).requests.find(item => item.id === first).payment], ['cash', ['crmRequestId', 'requestedAt', 'customer', 'salesman', 'specs', 'payment'], 'cash', 'cash'],
    'the first request: its payment in the body beside customer, salesman and specs; stored with the request; on its view');
  const requestId = crypto.randomUUID(), once = {action: 'create', customerId: 'east2', specs, payment: 'cash', requestId};
  const before = calls('requests');
  const firstTap = await (await as('rep')('/api/mold-requests', {method: 'POST', body: once})).json();
  const secondTap = await (await as('rep')('/api/mold-requests', {method: 'POST', body: once})).json();
  check([secondTap.request.id, calls('requests') - before], [firstTap.request.id, 1], 'the same tap twice: one request, sent once');
  check((await as('rep')('/api/mold-requests', {method: 'POST', body: {...once, specs: {...specs, quantity: 4}}})).status, 409, 'the same receipt with other data: 409');

  // ---- who sees it
  const ids = async who => (await list(who)).requests.map(item => item.id).sort();
  check(await ids('rep2'), [], 'another representative: none');
  check([(await ids('sup')).length, (await ids('sm')).length, (await ids('owner')).length, (await ids('sup2')).length], [2, 2, 2, 0], 'his supervisor, the manager and the administrator: both; another supervisor: none');
  check((await post('sup', {action: 'update', payment: 'cash', id: first, version: 1, specs})).status, 403, 'only the representative who asked may change it');

  // ---- a customer name up to 200 characters, as production and the customers list take it
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('long1','customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')").bind(JSON.stringify({name: 'مصنع ' + 'ط'.repeat(190), region: 'الشرقية', city: 'الخبر'}), now, now).run();
  res = await create('rep', 'long1', {description: 'long name'});
  body = await res.json();
  const long = JSON.parse(mock.state.calls.findLast(call => call.route === 'requests').body).customer;
  check([res.status, body.send.kind, [...long.name].length, long.city], [200, 'ok', 195, 'الخبر'], 'a 195-character customer name is asked for and sent whole; another city as it is');

  // ---- once sent, the production manager alone edits it: the CRM refuses the update and production is not asked
  const PRODUCTION_ONLY = 'بيانات الطلب يعدّلها مدير الإنتاج فقط؛ الطلب أُرسل للإنتاج، فتعديله من تطبيق المنتجات.';
  const PRODUCTION_ONLY_SENT = 'بيانات الطلب يعدّلها مدير الإنتاج فقط؛ التعديل لم يصل للإنتاج ولن يُعاد إرساله.';
  const CANCELLED_THERE = 'أُلغي الطلب في تطبيق الإنتاج؛ لم يعد التعديل أو الإلغاء ممكنًا.', CANCEL_LOCKED = 'اكتملت الاعتمادات أو بدأ الإنتاج قبل وصول الإلغاء؛ لم يعد الإلغاء ممكنًا.';
  // A send queued for its next try an hour away: no page load or timer sends it before the test's own resend.
  const nextTry = () => new Date(Date.now() + 3600_000).toISOString();
  const audits = async (id, action) => (await app.db.prepare('SELECT COUNT(*) AS n FROM crm_audit WHERE record_id=? AND action=?').bind(id, 'mold-request:' + action).first()).n;
  const sentRevision = mock.row(first).revision, requestsBefore = calls('requests');
  check((await list('rep')).requests.find(item => item.id === first).can, {edit: false, cancel: true, resend: false, approve: false, withdraw: false, attach: true, deleteFile: true}, 'sent, approvals pending: no edit; cancelling and design files as before');
  res = await post('rep', {action: 'update', payment: 'cash', id: first, version: 1, specs: {...specs, quantity: 2}});
  body = await res.json();
  check([res.status, body.error, calls('requests') - requestsBefore, JSON.parse((await stored(first)).data).specs.quantity, (await stored(first)).version, mock.row(first).revision, await audits(first, 'update')],
    [409, PRODUCTION_ONLY, 0, 1, 1, sentRevision, 0], 'the update of a sent request: 409 with production_only\'s text; nothing saved, audited or sent');
  check([body.request?.id, body.request?.can.edit, body.request?.can.cancel], [first, false, true], 'the refusal carries the request as it stands, so the screen drops its edit at once');
  check((await post('rep', {action: 'update', payment: 'cash', id: first, version: 99, specs: {...specs, quantity: 2}})).status, 409, 'whatever copy the screen held');
  // The same data again (a retry whose answer was lost): the stand-in answers 200 created:false, as production does, and nothing changes.
  await app.db.prepare("UPDATE crm_mold_requests SET outbox='send',next_attempt_at=? WHERE id=?").bind(nextTry(), first).run();
  body = await (await post('rep', {action: 'resend', id: first})).json();
  check([body.send.kind, body.request.sending.state, body.request.can.edit, mock.row(first).revision, calls('requests') - requestsBefore], ['ok', 'sent', false, sentRevision, 1], 'a retry of the same data: 200 created false at production, nothing changes there');
  // The production manager edits it there; the CRM's ORIGINAL again (an attempt whose answer was lost, say) is still a safe retry: 200
  // created false, production keeps its edit, and the CRM shows no refusal (the products side, 2026-11-02).
  const editedThere = mock.edit(first, {quantity: 5, notes: 'عدّلها مدير الإنتاج'});
  await app.db.prepare("UPDATE crm_mold_requests SET outbox='send',next_attempt_at=? WHERE id=?").bind(nextTry(), first).run();
  body = await (await post('rep', {action: 'resend', id: first})).json();
  check([body.send.kind, body.request.sending.state, body.request.sending.error, body.request.unconfirmed, body.request.specs.quantity, mock.row(first).quantity, mock.row(first).notes, mock.row(first).revision],
    ['ok', 'sent', null, false, 1, 5, 'عدّلها مدير الإنتاج', editedThere.revision], 'the original after a production edit: 200 created false, production keeps the edit, no refusal shown');

  // ---- a request production never stored is still the requester's to edit, until its first send reaches production
  mock.answerNext('requests', 400, {error: {code: 'invalid_payload', message: 'Some fields are missing or invalid.', fields: ['specs.notes']}});
  const unsent = (await (await create('rep', 'east2', {description: 'refused first'})).json()).request;
  check([unsent.sending.state, unsent.sending.error.code, unsent.sending.error.notStored, unsent.remote, unsent.can.edit, unsent.can.cancel], ['rejected', 'invalid_payload', true, null, true, true], 'refused at production\'s door (400) before it stored it: still editable');
  res = await post('rep', {action: 'update', payment: 'cash', id: unsent.id, version: unsent.version, specs: {...specs, description: 'refused first', notes: 'بدون ملاحظات خاصة'}});
  body = await res.json();
  check([res.status, body.send.kind, body.request.sending.state, body.request.specs.notes, body.request.remote.status, body.request.can.edit, await audits(unsent.id, 'update')], [200, 'ok', 'sent', 'بدون ملاحظات خاصة', 'received', false, 1], 'the edit is saved and sent; production holds it now, so no more edits');
  check(JSON.parse(mock.state.calls.findLast(call => call.route === 'requests').body).specs.notes, 'بدون ملاحظات خاصة', 'production received the edited data');
  check((await post('rep', {action: 'update', payment: 'cash', id: unsent.id, version: body.request.version, specs: {...specs, description: 'refused first'}})).status, 409, 'and the next edit is refused');

  // ---- the update's own guard (MOLD_NEVER_SENT_SQL): a send claimed between the check and the save keeps the request as it is. The test
  //  holds the database's write lock: the update reads the request (never sent), passes its check and waits at its save; a send's claim is
  //  committed meanwhile; the save then finds the request perhaps sent, and is refused as a sent request is.
  mock.answerNext('requests', 400, {error: {code: 'invalid_payload', message: 'Some fields are missing or invalid.', fields: ['specs.notes']}});
  const raced = (await (await create('rep', 'east2', {description: 'raced'})).json()).request;
  check(raced.can.edit, true, 'refused at production\'s door: still editable');
  await app.db.exec('BEGIN IMMEDIATE');
  let committed = false, racedUpdate;
  try {
    // Nothing on the update's way to its save writes: a refusal of its specifications answers while the lock is held.
    check((await post('rep', {action: 'update', payment: 'cash', id: raced.id, version: raced.version, specs: {...specs, description: 'raced', quantity: 0}})).status, 400, 'the update\'s way to its save only reads');
    await app.db.prepare("UPDATE crm_mold_requests SET last_attempt_at=?,next_attempt_at=?,mutation_id='raced-claim' WHERE id=?").bind(new Date().toISOString(), new Date(Date.now() + 60_000).toISOString(), raced.id).run();
    racedUpdate = post('rep', {action: 'update', payment: 'cash', id: raced.id, version: raced.version, specs: {...specs, description: 'raced', quantity: 3}});
    check(await Promise.race([racedUpdate.then(() => 'answered'), new Promise(resolve => setTimeout(resolve, 1500, 'waiting'))]), 'waiting', 'the update passed its check and waits at its save');
    await app.db.exec('COMMIT'); committed = true;
  } finally { if (!committed) await app.db.exec('ROLLBACK'); }
  res = await racedUpdate;
  body = await res.json();
  check([res.status, body.error, body.request.can.edit, JSON.parse((await stored(raced.id)).data).specs.quantity, (await stored(raced.id)).mutation_id, await audits(raced.id, 'update')],
    [409, PRODUCTION_ONLY, false, 1, 'raced-claim', 0], 'its SQL guard refused the save: production_only, nothing saved or audited, the send\'s claim intact');
  await app.db.prepare('UPDATE crm_mold_requests SET next_attempt_at=NULL WHERE id=?').bind(raced.id).run();

  // ---- production starts: the status is pulled once when the list opens
  mock.produce(first, {stages: ['laserCutting', 'box'], moldSerial: '093', productionDate: '2026-11-01'});
  await age(first);
  const statusCalls = calls('status');
  const opened = (await list('rep')).requests.find(item => item.id === first);
  check([calls('status') - statusCalls, opened.remote.status, opened.remote.stagesDone, opened.remote.moldSerial, opened.remote.stages.box, opened.editable, opened.can], [1, 'in_production', 2, '093', {done: true, at: '2026-11-02'}, false, {edit: false, cancel: false, resend: false, approve: false, withdraw: false, attach: false, deleteFile: false}], 'one status call; stages with dates, the serial; edit and cancel closed');
  await list('rep');
  check(calls('status') - statusCalls, 1, 'opened again within a minute: the stored status, no new call');
  res = await post('rep', {action: 'update', payment: 'cash', id: first, version: (await stored(first)).version, specs: {...specs, quantity: 3}});
  check(res.status, 409, 'the CRM itself refuses an edit once production has started');

  // ---- a change the earlier release queued (saved while it was editable) meets 409 production_only: final, shown, never sent again
  const second = (await (await create('rep', 'east2', {description: 'second mold'})).json()).request;
  check((await post('sm', {action: 'approve', id: second.id})).status, 200, 'the sales manager approves it');
  await app.db.prepare("UPDATE crm_mold_requests SET data=?,outbox='send',attempts=0,first_failed_at=NULL,next_attempt_at=?,last_error=NULL,version=version+1 WHERE id=?")
    .bind(JSON.stringify({...JSON.parse((await stored(second.id)).data), specs: {...specs, description: 'second mold', quantity: 7}}), nextTry(), second.id).run();
  mock.approve(second.id, 'production');
  const queued = calls('requests');
  res = await post('rep', {action: 'resend', id: second.id});
  body = await res.json();
  check([res.status, body.send.kind, body.request.specs.quantity, body.request.sending.state, body.request.sending.error.code, body.request.sending.error.reason, body.request.sending.error.final, body.request.unconfirmed, body.request.remote.waitingStep, body.request.can.edit, body.request.can.resend],
    [409, 'locked', 1, 'sent', 'request_locked', 'production_only', true, false, 'admin', false, false], '409 production_only: final; the data back to what production accepted; production\'s status from the answer stored (production approved meanwhile)');
  check(body.error, PRODUCTION_ONLY_SENT, 'said with production_only\'s text, claiming nothing about whose data is shown');
  let settled = await stored(second.id);
  check([settled.outbox, settled.next_attempt_at, JSON.parse(settled.last_error).reason, calls('requests') - queued, mock.row(second.id).quantity], [null, null, 'production_only', 1, 1], 'nothing waits, nothing is tried again; production keeps its data');
  await list('owner'); await new Promise(resolve => setTimeout(resolve, 300));
  check([calls('requests') - queued, (await list('rep')).requests.find(item => item.id === second.id).sending.error.reason], [1, 'production_only'], 'a page load later: still not sent again, and the request still says why');
  // The same where the earlier attempt's answer was lost (the CRM never learned production stored it): the CRM keeps its copy and says
  // plainly that production's may differ; production holds the request, so its status is pulled from now on.
  const lost = (await (await create('rep', 'east1', {description: 'answer lost'})).json()).request, lostAt = new Date().toISOString();
  await app.db.prepare("UPDATE crm_mold_requests SET data=?,accepted=NULL,remote=NULL,remote_at=NULL,outbox='send',attempts=1,first_failed_at=?,next_attempt_at=?,last_attempt_at=?,last_error=?,version=version+1 WHERE id=?")
    .bind(JSON.stringify({...JSON.parse((await stored(lost.id)).data), specs: {...specs, description: 'answer lost', quantity: 4}}), lostAt, nextTry(), lostAt, JSON.stringify({code: 'timeout', http: 0, at: lostAt}), lost.id).run();
  check((await list('rep')).requests.find(item => item.id === lost.id).can.edit, false, 'an attempt whose answer was lost: no edit');
  res = await post('rep', {action: 'resend', id: lost.id});
  body = await res.json();
  settled = await stored(lost.id);
  check([res.status, body.request.specs.quantity, body.request.remote.orderNo, body.request.sending.error.reason, body.request.unconfirmed, settled.outbox, JSON.parse(settled.accepted).unconfirmed, JSON.parse(settled.accepted).specs.quantity, JSON.parse(settled.data).unconfirmed],
    [409, 4, lost.remote.orderNo, 'production_only', true, null, true, 4, undefined], 'final too: the CRM\'s refused copy stays with the reason, marked unconfirmed (never production\'s data), and production holds it');
  await age(lost.id);
  const pulls = calls('status');
  await list('rep');
  check(calls('status') - pulls, 1, 'its status is pulled again');
  // Production starts on it while the CRM's status (pulled a moment ago) still reads received: a cancellation is refused there (409
  // without production_only). Its error replaces production_only's, yet the request still says its specifications are not production's.
  mock.produce(lost.id, {stages: ['laserCutting']});
  res = await post('rep', {action: 'cancel', id: lost.id, version: (await stored(lost.id)).version, reason: ''});
  body = await res.json();
  check([res.status, body.error, body.request.cancelled, body.request.sending.error.code, body.request.sending.error.reason, body.request.unconfirmed, body.request.specs.quantity], [409, CANCEL_LOCKED, false, 'request_locked', undefined, true, 4],
    'the cancellation refused: said as a cancellation (no «edit» arriving late, no claim about the data); the request still marked unconfirmed');

  // ---- 409 production_only without a usable status (none, or another request's): production still holds the request, so it is not left
  //  stranded: accepted (unconfirmed), its status pulled next, the sales manager may approve it, its design files go
  const bare = (await (await create('rep', 'east1', {description: 'bare refusal'})).json()).request, bareAt = new Date().toISOString();
  await app.db.prepare("UPDATE crm_mold_requests SET data=?,accepted=NULL,remote=NULL,remote_at=NULL,outbox='send',attempts=1,first_failed_at=?,next_attempt_at=?,last_attempt_at=?,last_error=?,version=version+1 WHERE id=?")
    .bind(JSON.stringify({...JSON.parse((await stored(bare.id)).data), specs: {...specs, description: 'bare refusal', quantity: 2}}), bareAt, nextTry(), bareAt, JSON.stringify({code: 'timeout', http: 0, at: bareAt}), bare.id).run();
  const foreign = (await list('rep')).requests.find(item => item.id === first).remote;
  mock.answerNext('requests', 409, {error: {code: 'request_locked', message: 'The request\'s data is edited by the production manager only.', details: {reason: 'production_only', request: foreign}}});
  res = await post('rep', {action: 'resend', id: bare.id});
  body = await res.json();
  settled = await stored(bare.id);
  check([res.status, body.error, body.request.remote, body.request.unconfirmed, settled.outbox, settled.remote, settled.remote_at, JSON.parse(settled.accepted).unconfirmed], [409, PRODUCTION_ONLY_SENT, null, true, null, null, null, true],
    'another request\'s status is not taken for this one; production still holds it (accepted, unconfirmed), nothing waits');
  const barePulls = calls('status');
  const bareListed = (await list('sm')).requests.find(item => item.id === bare.id);
  check([calls('status') - barePulls, bareListed.remote?.orderNo, bareListed.remote?.waitingStep, bareListed.can.approve], [1, bare.remote.orderNo, 'sales', true], 'its status pulled at once; it waits for the sales manager, who may approve it');

  // ---- a change queued before this release on a request production holds, refused for its data (400): no edit can fix it, so it is
  //  dropped for good, the data back to what production accepted, with the reason; nothing blocks the sales manager's approval
  const dropped = (await (await create('rep', 'east1', {description: 'dropped change'})).json()).request;
  await app.db.prepare("UPDATE crm_mold_requests SET data=?,outbox='send',attempts=0,first_failed_at=NULL,next_attempt_at=?,last_error=NULL,version=version+1 WHERE id=?")
    .bind(JSON.stringify({...JSON.parse((await stored(dropped.id)).data), specs: {...specs, description: 'dropped change', quantity: 8}}), nextTry(), dropped.id).run();
  check((await post('sm', {action: 'approve', id: dropped.id})).status, 409, 'while the change waits, the sales manager\'s approval waits too');
  mock.answerNext('requests', 400, {error: {code: 'invalid_payload', message: 'Some fields are missing or invalid.', fields: ['specs.notes']}});
  res = await post('rep', {action: 'resend', id: dropped.id});
  body = await res.json();
  settled = await stored(dropped.id);
  check([res.status, body.send.kind, body.request.sending.state, body.request.sending.error.code, body.request.sending.error.fields, body.request.sending.error.final, body.request.specs.quantity, body.request.can.edit, body.request.can.resend, settled.outbox, settled.next_attempt_at],
    [200, 'rejected', 'sent', 'invalid_payload', ['specs.notes'], true, 1, false, false, null, null], 'refused for its data: dropped for good with the reason; the data back to what production accepted');
  const droppedTries = calls('requests');
  await list('owner'); await new Promise(resolve => setTimeout(resolve, 300));
  check([calls('requests') - droppedTries, (await post('sm', {action: 'approve', id: dropped.id})).status], [0, 200], 'never sent again; the sales manager approves it');

  // ---- cancelling while received
  const third = (await (await create('rep', 'east1', {description: 'third mold'})).json()).request;
  res = await post('rep', {action: 'cancel', id: third.id, version: third.version, reason: 'العميل أجّل'});
  body = await res.json();
  check([res.status, body.request.cancelled, body.request.remote.status, body.request.can.edit], [200, true, 'cancelled', false], 'cancelled in production too');
  check((await post('rep', {action: 'cancel', id: third.id, version: body.request.version, reason: ''})).status, 409, 'cancelled already');

  // ---- 2026-11-03: a request asked for before the payment existed is resent exactly as first sent: 200 created:false
  const riyadhNow = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 19) + '+03:00', older = 'mr-' + crypto.randomUUID(), olderAt = new Date().toISOString();
  const olderData = {requestedAt: riyadhNow(), customer: {crmNumber: await number('east2'), name: 'مصنع east2', address: 'حي الصناعية', city: 'Damam - الدمام'}, salesman: {crmMemberId: 'rep', name: 'أحمد عبد العزيز', email: 'rep@yourrest.org'}, specs: {...specs, description: 'asked before payment'}};
  await app.db.prepare("INSERT INTO crm_mold_requests(id,member_id,customer_id,data,outbox,next_attempt_at,created_by,created_at,updated_at,version) VALUES(?,'rep','east2',?,'send',?,'rep',?,?,1)").bind(older, JSON.stringify(olderData), olderAt, olderAt, olderAt).run();
  body = await (await post('rep', {action: 'resend', id: older})).json();
  const olderFirst = mock.state.calls.findLast(call => call.route === 'requests').body;
  check([body.send.kind, body.request.payment, mock.row(older).payment, Object.hasOwn(JSON.parse(olderFirst), 'payment')], ['ok', null, null, false], 'the earlier release\'s request goes without a payment; production stores none');
  await app.db.prepare("UPDATE crm_mold_requests SET outbox='send',next_attempt_at=? WHERE id=?").bind(nextTry(), older).run();
  const olderRevision = mock.row(older).revision;
  res = await post('rep', {action: 'resend', id: older});
  body = await res.json();
  check([res.status, body.send.kind, body.request.sending.state, body.request.sending.error, mock.state.calls.findLast(call => call.route === 'requests').body, mock.row(older).revision], [200, 'ok', 'sent', null, olderFirst, olderRevision], 'resent byte for byte as first sent (no payment added): 200 created false, nothing changes');

  // ---- 2026-11-03: the production manager restores a cancelled request; the next status pull shows it active again
  const SAME_REASON = 'مدير الإنتاج رجّع الطلب؛ عشان تلغيه تاني اكتب سبب جديد';
  const restoredAudits = async (id, action = 'restored') => (await app.db.prepare('SELECT detail FROM crm_audit WHERE record_id=? AND action=?').bind(id, 'mold-request:' + action).all()).results.map(row => JSON.parse(row.detail));
  const back = (await (await create('rep', 'east1', {description: 'restored mold'})).json()).request;
  check((await post('sm', {action: 'approve', id: back.id})).status, 200, 'the sales manager approves it');
  body = await (await post('rep', {action: 'cancel', id: back.id, version: (await stored(back.id)).version, reason: 'العميل أجّل'})).json();
  check([body.request.cancelled, body.request.remote.status, body.request.can.cancel, body.request.can.attach], [true, 'cancelled', false, false], 'cancelled: nothing more to do');
  await age(back.id);
  check((await list('rep')).requests.find(item => item.id === back.id).cancelled, true, 'a pull while production keeps it cancelled: still cancelled');
  mock.restore(back.id);
  await age(back.id);
  const pullsBefore = calls('status'), active = (await list('rep')).requests.find(item => item.id === back.id), backRow = await stored(back.id);
  check([calls('status') - pullsBefore, active.cancelled, active.cancelReason, active.remote.status, active.remote.waitingStep, !!active.remote.approvals.sales, active.editable, active.can.cancel, active.can.attach, active.can.edit],
    [1, false, '', 'received', 'production', true, true, true, true, false], 'the cancelled request is still read from status: restored, it shows where it stood (the approval kept); cancelling and files back');
  check([active.sending.state, active.sending.error.code, active.sending.error.reason, active.cancelReasons, backRow.cancelled_at, backRow.cancel_reason, backRow.outbox], ['sent', 'restored', 'restored', ['العميل أجّل'], null, '', null], 'its cancelled marks cleared, why kept; the earlier reason travels for the screen');
  const backAudit = await restoredAudits(back.id);
  check([backAudit.length, backAudit[0]?.label, backAudit[0]?.cancelReason, backAudit[0]?.cancelDropped, backAudit[0]?.status], [1, 'رجّعه مدير الإنتاج بعد الإلغاء', 'العميل أجّل', false, 'received'], 'audited «رجّعه مدير الإنتاج بعد الإلغاء» with the cancellation it undid');
  await age(back.id); await list('rep');
  check((await restoredAudits(back.id)).length, 1, 'a later pull audits nothing more');
  // the same reason again (spaces aside): refused here, production not asked; a new reason cancels it
  const cancelsBefore = calls('cancel');
  res = await post('rep', {action: 'cancel', id: back.id, version: active.version, reason: '  العميل   أجّل '});
  body = await res.json();
  check([res.status, body.error, body.request.cancelled, calls('cancel') - cancelsBefore, (await stored(back.id)).cancelled_at, await audits(back.id, 'cancel')], [409, SAME_REASON, false, 0, null, 1], 'a reason used before: 409 with the message, nothing saved or sent');
  res = await post('rep', {action: 'cancel', id: back.id, version: active.version, reason: 'سبب جديد'});
  body = await res.json();
  check([res.status, body.request.cancelled, body.request.remote.status, mock.row(back.id).cancelReason, calls('cancel') - cancelsBefore], [200, true, 'cancelled', 'سبب جديد', 1], 'a new reason: cancelled again, in production too');

  // ---- a cancellation waiting for its resend, after the CRM saw the request cancelled and then restored: dropped, never sent again
  const dropped2 = (await (await create('rep', 'east1', {description: 'queued cancel dropped'})).json()).request;
  mock.loseNext('cancel');
  body = await (await post('rep', {action: 'cancel', id: dropped2.id, version: dropped2.version, reason: 'تأجيل'})).json();
  check([body.request.cancelled, body.request.sending.outbox, body.request.sending.error.code, mock.row(dropped2.id).cancelled], [true, 'cancel', 'network', true], 'the cancellation reached production but its answer was lost: it waits for its resend');
  await age(dropped2.id); await list('rep');
  check([JSON.parse((await stored(dropped2.id)).remote).status, (await stored(dropped2.id)).outbox], ['cancelled', 'cancel'], 'the CRM sees it cancelled in status; the cancellation still waits');
  mock.restore(dropped2.id);
  await age(dropped2.id);
  const droppedView = (await list('rep')).requests.find(item => item.id === dropped2.id), droppedRow = await stored(dropped2.id), cancelCalls = calls('cancel');
  check([droppedView.cancelled, droppedView.sending.state, droppedView.sending.outbox, droppedView.sending.error.reason, droppedView.can.cancel, droppedRow.outbox, droppedRow.next_attempt_at, droppedRow.cancelled_at],
    [false, 'sent', null, 'cancel_dropped', true, null, null, null], 'restored: the waiting cancellation is dropped (why kept), the request active again');
  check((await restoredAudits(dropped2.id))[0]?.cancelDropped, true, 'audited with the cancellation dropped');
  await app.db.prepare("UPDATE crm_mold_requests SET next_attempt_at='2026-01-01T00:00:00.000Z' WHERE id=? AND outbox IS NOT NULL").bind(dropped2.id).run();
  await list('owner'); await new Promise(resolve => setTimeout(resolve, 300));
  check([calls('cancel') - cancelCalls, mock.row(dropped2.id).cancelled], [0, false], 'never sent again; production keeps it restored');

  // ---- a cancellation that never reached production: the status (never cancelled there) drops nothing; it is still sent
  const kept = (await (await create('rep', 'east1', {description: 'queued cancel kept'})).json()).request;
  mock.state.down = true;
  body = await (await post('rep', {action: 'cancel', id: kept.id, version: kept.version, reason: 'المصنع متوقف'})).json();
  mock.state.down = false;
  check([body.request.cancelled, body.request.sending.outbox, mock.row(kept.id).cancelled], [true, 'cancel', false], 'production unreachable: the cancellation waits; production never saw it');
  await age(kept.id);
  const keptView = (await list('rep')).requests.find(item => item.id === kept.id);
  check([keptView.remote.status, keptView.cancelled, keptView.sending.outbox, (await stored(kept.id)).outbox], ['received', true, 'cancel', 'cancel'], 'a status saying received (never cancelled there) leaves the user\'s cancellation waiting');
  body = await (await post('rep', {action: 'resend', id: kept.id})).json();
  check([body.send.kind, body.request.cancelled, body.request.remote.status, body.request.sending.outbox, mock.row(kept.id).cancelled], ['ok', true, 'cancelled', null, true], 'its resend cancels it in production');

  // ---- production answers a cancellation with the request NOT cancelled (restored meanwhile, this reason used): said, not retried
  const same = (await (await create('rep', 'east1', {description: 'same reason'})).json()).request;
  mock.loseNext('cancel');
  await post('rep', {action: 'cancel', id: same.id, version: same.version, reason: 'تأجيل العميل'});
  check([mock.row(same.id).cancelled, (await stored(same.id)).outbox], [true, 'cancel'], 'cancelled in production, its answer lost; the CRM never saw it cancelled');
  mock.restore(same.id);
  const sameCalls = calls('cancel');
  res = await post('rep', {action: 'resend', id: same.id});
  body = await res.json();
  const sameRow = await stored(same.id);
  check([res.status, body.error, body.send.kind, body.request.cancelled, body.request.remote.status, body.request.sending.error.code, body.request.sending.error.reason, body.request.can.cancel, body.request.cancelReasons, calls('cancel') - sameCalls],
    [409, SAME_REASON, 'restored', false, 'received', 'restored', 'same_reason', true, ['تأجيل العميل'], 1], '200 with the request not cancelled: not marked cancelled; a new reason is asked for');
  check([sameRow.outbox, sameRow.next_attempt_at, sameRow.cancelled_at, mock.row(same.id).cancelled, (await restoredAudits(same.id, 'cancel-restored')).length], [null, null, null, false, 1], 'nothing waits or is tried again; audited');

  // ---- the same, once the request was approved after the restore (no pull saw either): production still answers 200 with the request as
  //  it is (confirmed, not cancelled), never 409; the CRM says it can no longer be cancelled, not «write a new reason»
  const RESTORED_LOCKED = 'رجّعه مدير الإنتاج بعد الإلغاء، واكتملت الاعتمادات أو بدأ الإنتاج؛ لم يعد الإلغاء ممكنًا.';
  const approvedSince = (await (await create('rep', 'east1', {description: 'same reason, approved since'})).json()).request;
  mock.loseNext('cancel');
  await post('rep', {action: 'cancel', id: approvedSince.id, version: approvedSince.version, reason: 'العميل اعتذر'});
  check([mock.row(approvedSince.id).cancelled, (await stored(approvedSince.id)).outbox], [true, 'cancel'], 'cancelled in production, its answer lost');
  mock.restore(approvedSince.id);
  for (const step of ['sales', 'production', 'admin']) mock.approve(approvedSince.id, step);
  const approvedCalls = calls('cancel');
  res = await post('rep', {action: 'resend', id: approvedSince.id});
  body = await res.json();
  const approvedRow = await stored(approvedSince.id);
  check([res.status, body.error, body.send.kind, body.request.cancelled, body.request.remote.status, body.request.editable, body.request.can.cancel, body.request.sending.error.code, body.request.sending.error.reason, calls('cancel') - approvedCalls],
    [409, RESTORED_LOCKED, 'restored', false, 'confirmed', false, false, 'restored', 'same_reason', 1], 'production answered 200 not cancelled (confirmed): the CRM says it can no longer be cancelled');
  check([approvedRow.outbox, approvedRow.next_attempt_at, approvedRow.cancelled_at, mock.row(approvedSince.id).cancelled], [null, null, null, false], 'nothing waits or is tried again; production keeps it confirmed');

  // ---- a cancellation whose answer was lost, seen cancelled by a pull, then restored and approved before its retry: production already
  //  had it cancelled, so the retry is not sent (no 409, no «approvals complete before the cancellation arrived»); the next pull settles
  //  the restore with its audit
  const seenFirst = (await (await create('rep', 'east1', {description: 'seen cancelled, restored, approved'})).json()).request;
  mock.loseNext('cancel');
  await post('rep', {action: 'cancel', id: seenFirst.id, version: seenFirst.version, reason: 'تأخر التوريد'});
  await age(seenFirst.id); await list('rep');
  check([JSON.parse((await stored(seenFirst.id)).remote).status, (await stored(seenFirst.id)).outbox], ['cancelled', 'cancel'], 'the pull saw it cancelled; the cancellation still waits for its retry');
  mock.restore(seenFirst.id);
  for (const step of ['sales', 'production', 'admin']) mock.approve(seenFirst.id, step);
  const seenCalls = calls('cancel');
  res = await post('rep', {action: 'resend', id: seenFirst.id});
  body = await res.json();
  check([res.status, body.send.kind, body.error, calls('cancel') - seenCalls, body.request.sending.outbox, body.request.sending.error, (await stored(seenFirst.id)).outbox], [200, 'ok', undefined, 0, null, null, null], 'the retry is settled as delivered, not sent: production had it cancelled');
  await age(seenFirst.id);
  const seenView = (await list('rep')).requests.find(item => item.id === seenFirst.id), seenAudit = await restoredAudits(seenFirst.id);
  check([seenView.cancelled, seenView.remote.status, seenView.can.cancel, seenView.sending.error.code, seenView.sending.error.reason, seenAudit.length, seenAudit[0]?.label, seenAudit[0]?.cancelReason, seenAudit[0]?.status, (await restoredAudits(seenFirst.id, 'cancel-restored')).length],
    [false, 'confirmed', false, 'restored', 'restored', 1, 'رجّعه مدير الإنتاج بعد الإلغاء', 'تأخر التوريد', 'confirmed', 0], 'the next pull settles the restore: active again, audited «رجّعه مدير الإنتاج بعد الإلغاء»');
  check([calls('cancel') - seenCalls, mock.row(seenFirst.id).cancelled], [0, false], 'production keeps it restored and approved');

  // ---- deleted in the products application: read as cancelled there, nothing left to change
  const removed = (await (await create('rep', 'east1', {description: 'removed in production'})).json()).request;
  mock.remove(removed.id);
  await age(removed.id);
  const gone = (await list('rep')).requests.find(item => item.id === removed.id);
  check([gone.remote.status, gone.remote.waitingStep, gone.cancelled, gone.editable, gone.can], ['cancelled', 'cancelled', false, false, {edit: false, cancel: false, resend: false, approve: false, withdraw: false, attach: false, deleteFile: false}], 'deleted in production: cancelled there; no edit, cancel or approval');
  res = await post('rep', {action: 'update', payment: 'cash', id: removed.id, version: removed.version, specs: {...specs, quantity: 9}});
  body = await res.json();
  check([res.status, body.error, body.request.can.edit], [409, CANCELLED_THERE, false], 'an edit is refused, said as cancelled there (not «edit it in the products application»)');
  // deleted there while the CRM still showed it received: the CRM refuses the edit itself, production is not asked
  const eighth = (await (await create('rep', 'east1', {description: 'eighth mold'})).json()).request;
  mock.remove(eighth.id);
  const beforeEighth = calls('requests');
  res = await post('rep', {action: 'update', payment: 'cash', id: eighth.id, version: eighth.version, specs: {...specs, description: 'eighth mold', quantity: 6}});
  check([res.status, (await res.json()).error, calls('requests') - beforeEighth, JSON.parse((await stored(eighth.id)).data).specs.quantity], [409, PRODUCTION_ONLY, 0, 1], 'an edit of a sent request deleted in production meanwhile: refused here, nothing sent');

  // ---- the sales manager approves; production and the administrator follow in their application
  const fourth = (await (await create('rep', 'east1', {description: 'fourth mold'})).json()).request;
  const can = async (who, id) => (await list(who)).requests.find(item => item.id === id)?.can;
  check([(await can('sm', fourth.id)).approve, (await can('rep', fourth.id)).approve, (await can('owner', fourth.id)).approve, (await can('sup', fourth.id)).approve], [true, false, false, false], 'only the sales manager approves');
  for (const who of ['rep', 'sup', 'owner']) check((await post(who, {action: 'approve', id: fourth.id})).status, 403, who + ' cannot approve');
  const approvals = calls('approval'), approveOnce = {action: 'approve', id: fourth.id, requestId: crypto.randomUUID()};
  res = await as('sm')('/api/mold-requests', {method: 'POST', body: approveOnce});
  body = await res.json();
  check([res.status, body.request.remote.waitingStep, body.request.remote.status, body.request.remote.approvals.sales.by, body.request.can.approve, body.request.can.withdraw], [200, 'production', 'received', 'sm@yourrest.org (sm)', false, true], 'approved: it waits for production, still received; withdrawable');
  check(JSON.parse(mock.state.calls.findLast(call => call.route === 'approval').body), {crmRequestId: fourth.id, action: 'approve', by: {name: 'sm', email: 'sm@yourrest.org'}}, 'production\'s approval route, signed, with the sales manager\'s name and email');
  check((await app.db.prepare("SELECT COUNT(*) AS n FROM crm_audit WHERE record_id=? AND action='mold-request:approve'").bind(fourth.id).first()).n, 1, 'audited');
  check([(await as('sm')('/api/mold-requests', {method: 'POST', body: approveOnce})).status, calls('approval') - approvals], [200, 1], 'the same tap twice: production asked once');
  check((await post('sm', {action: 'approve', id: fourth.id})).status, 409, 'approved already: not waiting for the sales manager');
  body = await (await post('sm', {action: 'withdraw', id: fourth.id})).json();
  check([body.request.remote.waitingStep, body.request.remote.approvals.sales, body.request.can.approve], ['sales', null, true], 'withdrawn: back to the sales manager');
  await post('sm', {action: 'approve', id: fourth.id});
  res = await post('rep', {action: 'update', payment: 'cash', id: fourth.id, version: fourth.version, specs: {...specs, description: 'fourth mold', quantity: 5}});
  check([res.status, (await res.json()).error, mock.row(fourth.id).quantity, !!mock.row(fourth.id).approvals.sales], [409, PRODUCTION_ONLY, 1, true], 'an edit during the approvals is refused: production keeps its data and the sales manager\'s approval');
  mock.approve(fourth.id, 'production');
  res = await post('sm', {action: 'withdraw', id: fourth.id});
  body = await res.json();
  check([res.status, body.request.remote.waitingStep, body.request.can.withdraw], [409, 'admin', false], 'production approved first: the withdrawal is refused and the request shows where it waits');
  ok(/اعتمد الإنتاج/.test(body.error), 'with a clear message');

  // ---- approved, then deleted in production before the CRM knew: refused for the real reason, and the CRM catches up
  const sixth = (await (await create('rep', 'east1', {description: 'sixth mold'})).json()).request;
  check((await post('sm', {action: 'approve', id: sixth.id})).status, 200, 'the sales manager approves');
  mock.remove(sixth.id);
  res = await post('sm', {action: 'withdraw', id: sixth.id});
  body = await res.json();
  check([res.status, body.error, body.request.remote.status, body.request.can.withdraw], [409, 'الطلب ملغى في تطبيق الإنتاج.', 'cancelled', false], 'cancelled in production: said so, not «production approved»; now shown cancelled');
  // ---- a request production does not know (404): said plainly, nothing saved
  const seventh = (await (await create('rep', 'east1', {description: 'seventh mold'})).json()).request;
  mock.forget(seventh.id);
  const audited = async id => (await app.db.prepare("SELECT COUNT(*) AS n FROM crm_audit WHERE record_id=? AND action='mold-request:approve'").bind(id).first()).n;
  res = await post('sm', {action: 'approve', id: seventh.id});
  check([res.status, (await res.json()).error, await audited(seventh.id)], [409, 'الطلب غير موجود لدى الإنتاج', 0], 'unknown to production: said so, no approval recorded');
  mock.approve(fourth.id, 'admin');
  await age(fourth.id);
  const approved = (await list('rep')).requests.find(item => item.id === fourth.id);
  check([approved.remote.status, approved.remote.waitingStep, approved.editable, approved.can.edit], ['confirmed', 'manufacturing', false, false], 'all three approvals: confirmed, in manufacturing, no more changes');
  ok(/^\d{4}-\d{2}-\d{2}T/.test(approved.remote.waitingSince), 'since when it waits');

  // ---- «طلبات بانتظار اعتمادي»: every request production holds for the sales manager, those registered in production too
  const manual = mock.registerManual({customerNo: await number('east2'), customerName: 'مصنع مسجّل في الإنتاج', salesmanName: 'مندوب الإنتاج', createdBy: 'prod@yourrest.org'});
  const fifth = (await (await create('rep', 'east1', {description: 'fifth mold'}, 'deferred')).json()).request;
  // The production manager edits the CRM's request there: the list shows its customer, salesman and specifications as production holds
  // them now, while the CRM's own copy stays as it was sent.
  mock.edit(fifth.id, {customerName: 'مصنع east1 (عدّله الإنتاج)', salesmanName: 'مندوب عدّله الإنتاج', quantity: 6, description: 'fifth mold, edited in production'});
  let waitingList = (await list('sm')).pending;
  const fifthListed = waitingList.items.find(item => item.orderNo === fifth.remote.orderNo);
  check([fifthListed.inCrm, fifthListed.crmRequestId, fifthListed.customer.name, fifthListed.salesman.name, fifthListed.specs.quantity, fifthListed.specs.description, fifthListed.customer.crmNumber],
    [true, fifth.id, 'مصنع east1 (عدّله الإنتاج)', 'مندوب عدّله الإنتاج', 6, 'fifth mold, edited in production', await number('east1')], 'the sales manager\'s list: the CRM\'s request as the production manager edited it');
  const fifthOwn = (await list('sm')).requests.find(item => item.id === fifth.id);
  check([fifthOwn.customerName, fifthOwn.specs.quantity, fifthOwn.specs.description], ['مصنع east1', 1, 'fifth mold'], 'the CRM\'s own copy stays as the CRM sent it');
  // How the customer pays, shown to the sales manager with each request waiting (2026-11-03): null for one registered without it.
  check([fifthListed.payment, fifthOwn.payment, waitingList.items.find(item => item.orderNo === manual.orderNo).payment], ['deferred', 'deferred', null], 'the sales manager\'s list carries each request\'s payment (null when production has none)');
  check(waitingList.items.map(item => [item.orderNo, item.source, item.inCrm]).filter(([orderNo]) => [manual.orderNo, fifth.remote.orderNo].includes(orderNo)), [[manual.orderNo, 'manual', false], [fifth.remote.orderNo, 'crm', true]], 'the sales manager sees both, the longest waiting first');
  check([waitingList.items.find(item => item.orderNo === manual.orderNo).enteredBy, waitingList.error], ['prod@yourrest.org', null], 'who entered it in production');
  check([(await list('rep')).pending, (await list('owner')).pending, (await list('sup')).pending], [null, null, null], 'nobody else gets the list');
  check((await post('rep', {action: 'approve-order', orderNo: manual.orderNo})).status, 403, 'a representative cannot approve by order number');
  const byOrder = {action: 'approve-order', orderNo: manual.orderNo, requestId: crypto.randomUUID()}, approvalCalls = calls('approval');
  res = await as('sm')('/api/mold-requests', {method: 'POST', body: byOrder});
  body = await res.json();
  check([res.status, body.status.waitingStep, body.status.crmRequestId, body.pending.items.some(item => item.orderNo === manual.orderNo)], [200, 'production', null, false], 'approved by its order number: it waits for production and leaves the list');
  check(JSON.parse(mock.state.calls.findLast(call => call.route === 'approval').body), {orderNo: manual.orderNo, action: 'approve', by: {name: 'sm', email: 'sm@yourrest.org'}}, 'production asked by orderNo only');
  check([(await as('sm')('/api/mold-requests', {method: 'POST', body: byOrder})).status, calls('approval') - approvalCalls], [200, 1], 'the same tap twice: production asked once');
  check((await app.db.prepare("SELECT COUNT(*) AS n FROM crm_audit WHERE record_id=? AND action='mold-request:approve'").bind('mold-order:' + manual.orderNo).first()).n, 1, 'audited under its order number');
  check((await post('sm', {action: 'approve-order', orderNo: manual.orderNo})).status, 409, 'no longer waiting: refused');
  body = await (await post('sm', {action: 'withdraw-order', orderNo: manual.orderNo})).json();
  check([body.status.waitingStep, body.pending.items.some(item => item.orderNo === manual.orderNo)], ['sales', true], 'withdrawn: back on the list');
  // production refuses by order number: the real reason, with the request as production holds it
  check((await post('sm', {action: 'approve-order', orderNo: manual.orderNo})).status, 200, 'approved again');
  mock.removeOrder(manual.orderNo);
  res = await post('sm', {action: 'withdraw-order', orderNo: manual.orderNo});
  body = await res.json();
  check([res.status, body.error, body.status?.status, body.status?.crmRequestId], [409, 'الطلب ملغى في تطبيق الإنتاج.', 'cancelled', null], 'deleted in production after the approval: the withdrawal is refused as cancelled, with production\'s status');
  mock.seedLegacy(1);
  res = await post('sm', {action: 'withdraw-order', orderNo: 1});
  body = await res.json();
  check([res.status, body.error, body.status?.approvals?.required], [409, 'طلب قديم من الشيت ومعتمد أصلًا؛ لا يحتاج اعتمادًا.', false], 'a historical order from the sheet: refused as needing no approval');
  body = await (await post('sm', {action: 'approve-order', orderNo: fifth.remote.orderNo})).json();
  check([JSON.parse(mock.state.calls.findLast(call => call.route === 'approval').body).crmRequestId, body.request.remote.waitingStep, body.request.can.withdraw], [fifth.id, 'production', true], 'the CRM\'s own request goes by its crmRequestId, and the CRM keeps its new status');

  // ---- everyone asks: customer service from its branch's customers, a supervisor, the administrator
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('other1','customer',NULL,'rep2','فرع آخر',?,?,?,1,'fixture')").bind(JSON.stringify({name: 'مصنع other1', region: 'الشرقية', city: 'الخبر'}), now, now).run();
  res = await create('cs', 'west1', {halfBlock: 'three'});
  body = await res.json();
  check([res.status, body.request.memberId, body.request.can.edit, body.request.can.cancel], [200, 'cs', false, true], 'customer service asks for a customer of its branch (sent: no edit, cancel as before)');
  const fromService = JSON.parse(mock.state.calls.findLast(call => call.route === 'requests').body);
  check([fromService.salesman, fromService.specs.halfBlock], [{crmMemberId: 'cs', name: 'cs', email: 'cs@yourrest.org'}, 'three'], 'under its own name; three half blocks');
  check((await create('cs', 'other1')).status, 404, 'not for another branch\'s customer');
  check([(await create('sup', 'east1')).status, (await create('owner', 'other1')).status], [200, 200], 'a supervisor and the administrator ask too');
  check([(await ids('csm')).length, (await ids('cs')).length, (await ids('rep2')).length], [1, 1, 0], 'the customer-service manager sees their team\'s, customer service their own, another representative none');
  ok((await ids('sm')).includes(body.request.id), 'the sales manager sees every request to approve, whoever asked');
  check((await post('cs', {action: 'approve', id: body.request.id})).status, 403, 'customer service does not approve');

  // ---- production unreachable: saved, waiting, tried again on the timetable, resent by hand
  mock.state.down = true;
  res = await create('rep', 'east1', {description: 'while down'});
  body = await res.json();
  const waiting = body.request;
  check([res.status, body.send.kind, waiting.sending.state, waiting.sending.attempts, waiting.sending.error.code], [200, 'retry', 'waiting', 1, 'network'], 'saved in the CRM, waiting to be sent');
  check([waiting.can.edit, waiting.can.cancel, waiting.can.resend], [false, true, true], 'an attempt without an answer may have arrived: no edit; cancel and resend');
  res = await post('rep', {action: 'update', payment: 'cash', id: waiting.id, version: waiting.version, specs: {...specs, description: 'while down', quantity: 2}});
  body = await res.json();
  check([res.status, body.error, body.request.can.edit, body.request.sending.state], [409, PRODUCTION_ONLY, false, 'waiting'], 'the update is refused with production_only\'s text, with the request');
  const due = Date.parse(waiting.sending.nextAttemptAt) - Date.parse(waiting.sending.lastAttemptAt);
  ok(due >= 55_000 && due <= 65_000, 'next try in one minute');
  await age(first);
  const down = await list('rep');
  check([down.statusError.code, down.requests.find(item => item.id === first).remote.status], ['network', 'in_production'], 'a failed pull: the last known status, with the reason');
  res = await post('rep', {action: 'resend', id: waiting.id});
  check([(await res.json()).request.sending.attempts], [1], 'a resend while down: still waiting');
  mock.state.down = false;
  await app.db.prepare("UPDATE crm_mold_requests SET next_attempt_at='2026-01-01T00:00:00.000Z' WHERE id=?").bind(waiting.id).run();
  await list('owner');
  let row;
  for (let n = 0; n < 50 && (row = await stored(waiting.id)).outbox; n++) await new Promise(resolve => setTimeout(resolve, 100));
  check([row.outbox, row.attempts, JSON.parse(row.remote).status], [null, 0, 'received'], 'when its time came the next page open sent it');
  mock.state.notConfigured = true;
  body = await (await create('rep', 'east1', {description: 'secret missing there'})).json();
  check([body.request.sending.state, body.request.sending.error.code, body.request.can.edit], ['waiting', 'not_configured', true], 'production without its secret (503 not_configured, refused before storing): kept waiting, still editable');
  mock.state.notConfigured = false;
  body = await (await post('rep', {action: 'resend', id: body.request.id})).json();
  check([body.request.sending.state, body.request.can.edit], ['sent', false], 'resend once it is set; sent, so no more edits');

  // ---- the secret never leaves the server
  for (const who of ['rep', 'owner']) {
    const page = await as(who)('/'), answer = await get(who);
    ok(!page.text.includes(mock.state.secret) && !answer.text.includes(mock.state.secret) && !answer.text.includes('YR_PRODUCTS'), 'not in a page or an answer: ' + who);
  }
  ok(!app.log().includes(mock.state.secret), 'not in the server log');
} finally { await app.stop(); }

// ---- a request that waited through a restart goes as soon as any page loads, the mold requests page unopened
const restarted = await bootBuiltApp({members}, {env: settings});
try {
  const now = new Date().toISOString(), id = 'mr-' + crypto.randomUUID(), sentRequests = () => mock.state.calls.filter(call => call.route === 'requests').length;
  await restarted.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('r1','customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')").bind(JSON.stringify({name: 'مصنع r1', region: 'الشرقية', city: 'الدمام'}), now, now).run();
  const crmNumber = (await restarted.db.prepare("SELECT number FROM crm_customer_numbers WHERE customer_id='r1'").first()).number;
  const data = {requestedAt: '2026-11-01T10:00:00+03:00', customer: {crmNumber, name: 'مصنع r1', address: '', city: 'Damam - الدمام'}, salesman: {crmMemberId: 'rep', name: 'أحمد عبد العزيز', email: 'rep@yourrest.org'}, specs};
  await restarted.db.prepare("INSERT INTO crm_mold_requests(id,member_id,customer_id,data,outbox,attempts,first_failed_at,next_attempt_at,last_error,created_by,created_at,updated_at,version) VALUES(?,'rep','r1',?,'send',1,?,?,?,'rep',?,?,1)")
    .bind(id, JSON.stringify(data), now, now, JSON.stringify({code: 'network', http: 0, at: now}), now, now).run();
  const before = sentRequests();
  check((await restarted.as(await restarted.login('owner'))('/api/crm')).status, 200, 'after a restart someone opens the CRM, not the mold requests page');
  let waited;
  for (let n = 0; n < 100 && (waited = await restarted.db.prepare('SELECT outbox,accepted FROM crm_mold_requests WHERE id=?').bind(id).first()).outbox; n++) await new Promise(resolve => setTimeout(resolve, 100));
  check([waited.outbox, !!waited.accepted, sentRequests() - before], [null, true, 1], 'the request that waited went at once, once');
} finally { await restarted.stop(); }

// ---- a release without the link settings: sending is off, the CRM works
const plain = await bootBuiltApp({members}, {env: {NODE_EXTRA_CA_CERTS: mock.ca}});
try {
  const session = await plain.login('rep'), as = plain.as(session), now = new Date().toISOString();
  await plain.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('e1','customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')").bind(JSON.stringify({name: 'مصنع e1', region: 'الشرقية', city: 'الدمام'}), now, now).run();
  const calls = mock.state.calls.length;
  const listed = (await as('/api/mold-requests')).json();
  check([listed.linkReady, listed.linkProblem], [false, 'not_configured'], 'the screen says the link is off');
  const created = await (await as('/api/mold-requests', {method: 'POST', body: {action: 'create', requestId: crypto.randomUUID(), customerId: 'e1', specs, payment: 'deferred'}})).json();
  check([created.request.sending.state, created.send.kind, created.request.can.edit], ['off', 'off', true], 'a request is still saved, waiting while the link is off (never attempted: still editable)');
  check((await as('/api/mold-requests', {method: 'POST', body: {action: 'resend', requestId: crypto.randomUUID(), id: created.request.id}})).status, 503, 'resend says the link is off');
  check([(await as('/api/crm')).status, mock.state.calls.length - calls], [200, 0], 'the rest of the CRM works; nothing was sent');
} finally { await plain.stop(); await mock.stop(); }

console.log(JSON.stringify({ok: true, checks, builtRelease: true, realProductionTested: false}));
