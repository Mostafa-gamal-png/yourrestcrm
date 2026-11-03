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
// not sent again, and the restore is the next pull's (audited); a restore the release before this one already pulled (it stored the status
// alone, the CRM's cancelled marks kept) is settled by this release's next pull, while a cancellation still waiting, or a request
// production holds cancelled, is never cleared. Since production's second update of 2026-11-03: the quotation and PO numbers and their
// files (see the last section): nothing asked or sent before the update, the update learned from an answer, a number required after it,
// an older request resent byte for byte, production's numbers shown, the missing note, the sales manager's list. Who sees which request
// (the owner, 2026-11-03: two managers sharing a region, customer service's request in the waiting list only) and «رابط التصميم» removed
// (refused when sent, an older request's link kept and resent byte for byte).
// Synthetic isolated fixtures only: temporary SQLite, mocked sendmail, no production data, no real production application.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';
import {moldStatusObject} from '../portable/mold-rules.mjs';

const members = [
  {id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'},
  {id: 'sup', role: 'supervisor', sup: 'sm'}, {id: 'sup2', role: 'supervisor', sup: 'sm'},
  {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'أحمد عبد العزيز'}, {id: 'rep2', role: 'rep', sup: 'sup2'},
  {id: 'csm', role: 'customer_service_manager', sup: 'sm'}, {id: 'cs', role: 'customer_service', sup: 'csm'},
];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
// «رابط التصميم» is no longer asked for (2026-11-03): the form sends no design link. An older request's own is kept (see below).
const specs = {description: '200*400*27.5TH MM OPEN', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: 'YR099-9', quantity: 1, notes: 'أول طلب'};
const DESIGN_URL_GONE = 'رابط التصميم اتلغى من الطلب؛ حدّث الصفحة، وأرفق التصميم كملف.';
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
  check([res.status, Object.keys(body.fields).sort(), body.fields.designUrl], [400, ['core', 'designUrl', 'moldWidth'], DESIGN_URL_GONE], 'wrong fields: 400 naming each one (a design link, from a page loaded before, says it was removed)');
  // «رابط التصميم» is no longer asked for (2026-11-03): a valid link from a page loaded before is refused too, nothing saved or sent.
  const linked = calls('requests');
  res = await create('rep', 'east1', {description: 'with a link', designUrl: 'https://drive.google.com/new'});
  body = await res.json();
  check([res.status, body.fields, body.error, calls('requests') - linked, (await app.db.prepare("SELECT COUNT(*) AS n FROM crm_mold_requests WHERE json_extract(data,'$.specs.description')='with a link'").first()).n], [400, {designUrl: DESIGN_URL_GONE}, DESIGN_URL_GONE, 0, 0], 'a design link on a new request: refused, said so, nothing saved or sent');
  check([JSON.parse((await stored(first)).data).specs.designUrl, Object.hasOwn(sent.specs, 'designUrl')], ['', false], 'a new request carries no design link and sends none');
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
  const olderData = {requestedAt: riyadhNow(), customer: {crmNumber: await number('east2'), name: 'مصنع east2', address: 'حي الصناعية', city: 'Damam - الدمام'}, salesman: {crmMemberId: 'rep', name: 'أحمد عبد العزيز', email: 'rep@yourrest.org'}, specs: {...specs, designUrl: 'https://drive.google.com/x', description: 'asked before payment'}};
  await app.db.prepare("INSERT INTO crm_mold_requests(id,member_id,customer_id,data,outbox,next_attempt_at,created_by,created_at,updated_at,version) VALUES(?,'rep','east2',?,'send',?,'rep',?,?,1)").bind(older, JSON.stringify(olderData), olderAt, olderAt, olderAt).run();
  body = await (await post('rep', {action: 'resend', id: older})).json();
  const olderFirst = mock.state.calls.findLast(call => call.route === 'requests').body;
  check([body.send.kind, body.request.payment, mock.row(older).payment, Object.hasOwn(JSON.parse(olderFirst), 'payment')], ['ok', null, null, false], 'the earlier release\'s request goes without a payment; production stores none');
  check([JSON.parse(olderFirst).specs.designUrl, body.request.specs.designUrl], ['https://drive.google.com/x', 'https://drive.google.com/x'], 'and with its own design link, shown on its view (read-only on the screen)');
  await app.db.prepare("UPDATE crm_mold_requests SET outbox='send',next_attempt_at=? WHERE id=?").bind(nextTry(), older).run();
  const olderRevision = mock.row(older).revision;
  res = await post('rep', {action: 'resend', id: older});
  body = await res.json();
  check([res.status, body.send.kind, body.request.sending.state, body.request.sending.error, mock.state.calls.findLast(call => call.route === 'requests').body, mock.row(older).revision], [200, 'ok', 'sent', null, olderFirst, olderRevision], 'resent byte for byte as first sent (no payment added, its design link kept): 200 created false, nothing changes');
  // An older request with a design link that never reached production, edited from today's form (which sends no link): the link stays
  // as stored and goes with the edit; a page loaded before that changes it is refused, the stored link untouched.
  const linkedOlder = 'mr-' + crypto.randomUUID();
  await app.db.prepare("INSERT INTO crm_mold_requests(id,member_id,customer_id,data,outbox,next_attempt_at,created_by,created_at,updated_at,version) VALUES(?,'rep','east2',?,'send',?,'rep',?,?,1)")
    .bind(linkedOlder, JSON.stringify({...olderData, specs: {...olderData.specs, description: 'older, never sent, with a link'}, payment: 'cash'}), nextTry(), olderAt, olderAt).run();
  res = await post('rep', {action: 'update', id: linkedOlder, version: 1, payment: 'cash', specs: {...specs, designUrl: 'https://drive.google.com/changed', description: 'older, never sent, with a link'}});
  body = await res.json();
  check([res.status, body.fields, JSON.parse((await stored(linkedOlder)).data).specs.designUrl, (await stored(linkedOlder)).version], [400, {designUrl: DESIGN_URL_GONE}, 'https://drive.google.com/x', 1], 'a page loaded before changing the link: refused, the stored link untouched');
  body = await (await post('rep', {action: 'update', id: linkedOlder, version: 1, payment: 'cash', specs: {...specs, quantity: 3, description: 'older, never sent, with a link'}})).json();
  const linkedSent = JSON.parse(mock.state.calls.findLast(call => call.route === 'requests').body);
  check([body.send.kind, JSON.parse((await stored(linkedOlder)).data).specs.designUrl, linkedSent.crmRequestId, linkedSent.specs.designUrl, linkedSent.specs.quantity, body.request.specs.designUrl],
    ['ok', 'https://drive.google.com/x', linkedOlder, 'https://drive.google.com/x', 3, 'https://drive.google.com/x'], 'today\'s form edits it (no link sent): the stored link kept as it is, sent with the edit');

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

  // ---- a restore the release before this one already pulled (it pulled cancelled requests too and stored their status alone, leaving
  //  the CRM's cancelled marks): the next pull of this release settles it as restored (audited, the reason kept, approval allowed)
  const pulledEarlier = (await (await create('rep', 'east1', {description: 'restored, pulled by the earlier release'})).json()).request;
  body = await (await post('rep', {action: 'cancel', id: pulledEarlier.id, version: pulledEarlier.version, reason: 'العميل سافر'})).json();
  check([body.request.cancelled, body.request.remote.status, mock.row(pulledEarlier.id).cancelled], [true, 'cancelled', true], 'cancelled in the CRM and in production');
  const restoredStatus = moldStatusObject(mock.restore(pulledEarlier.id));
  // The earlier release's pull: newerRemote alone (no restore statements), some time after the cancellation; this release's pull comes a minute or more later.
  const earlierPull = async (id, status) => app.db.prepare("UPDATE crm_mold_requests SET cancelled_at='2026-01-01T00:00:00.000Z',remote=?,remote_at='2026-01-01T00:05:00.000Z' WHERE id=?").bind(JSON.stringify(status), id).run();
  await earlierPull(pulledEarlier.id, restoredStatus);
  const oldState = await stored(pulledEarlier.id);
  check([JSON.parse(oldState.remote).status, oldState.cancelled_at !== null, oldState.cancel_reason, oldState.outbox], ['received', true, 'العميل سافر', null], 'the earlier release\'s state: production\'s status not cancelled, the CRM\'s cancelled marks kept');
  check((await post('sm', {action: 'approve', id: pulledEarlier.id})).status, 409, 'before this release\'s pull the sales manager is refused (the request reads as cancelled)');
  const pulledView = (await list('rep')).requests.find(item => item.id === pulledEarlier.id), pulledRow = await stored(pulledEarlier.id), pulledAudit = await restoredAudits(pulledEarlier.id);
  check([pulledView.cancelled, pulledView.cancelReason, pulledView.remote.status, pulledView.can.cancel, pulledView.can.attach, pulledView.sending.error?.code, pulledView.sending.error?.reason, pulledView.cancelReasons, pulledRow.cancelled_at, pulledRow.cancel_reason, pulledRow.outbox],
    [false, '', 'received', true, true, 'restored', 'restored', ['العميل سافر'], null, '', null], 'this release\'s pull: active again, cancelling and files back, why kept');
  check([pulledAudit.length, pulledAudit[0]?.label, pulledAudit[0]?.cancelledInCrm, pulledAudit[0]?.cancelReason, pulledAudit[0]?.cancelDropped, pulledAudit[0]?.status], [1, 'رجّعه مدير الإنتاج بعد الإلغاء', true, 'العميل سافر', false, 'received'], 'audited with the reason it undid');
  check((await list('sm')).requests.find(item => item.id === pulledEarlier.id).can.approve, true, 'the sales manager may approve it');
  res = await post('sm', {action: 'approve', id: pulledEarlier.id});
  check([res.status, !!mock.row(pulledEarlier.id).approvals.sales], [200, true], 'and approves it, in production too');
  await age(pulledEarlier.id); await list('rep');
  check((await restoredAudits(pulledEarlier.id)).length, 1, 'a later pull audits nothing more');
  // never cleared: a cancellation still waiting to be sent (production never saw it), even with a status not cancelled stored after it
  const waitingCancel = (await (await create('rep', 'east1', {description: 'cancel still waiting'})).json()).request;
  mock.state.down = true;
  await post('rep', {action: 'cancel', id: waitingCancel.id, version: waitingCancel.version, reason: 'المصنع مقفول'});
  mock.state.down = false;
  await earlierPull(waitingCancel.id, JSON.parse((await stored(waitingCancel.id)).remote));
  await list('rep');
  const waitingRow = await stored(waitingCancel.id);
  check([waitingRow.cancelled_at !== null, waitingRow.cancel_reason, waitingRow.outbox, (await restoredAudits(waitingCancel.id)).length, mock.row(waitingCancel.id).cancelled], [true, 'المصنع مقفول', 'cancel', 0, false], 'a cancellation still waiting: kept');
  body = await (await post('rep', {action: 'resend', id: waitingCancel.id})).json();
  check([body.send.kind, body.request.cancelled, body.request.remote.status, body.request.sending.outbox, mock.row(waitingCancel.id).cancelled], ['ok', true, 'cancelled', null, true], 'and still sent: its resend cancels it in production');
  // never cleared: a request production holds cancelled, whatever status not cancelled was stored after the cancellation
  const heldCancelled = (await (await create('rep', 'east1', {description: 'production holds it cancelled'})).json()).request;
  await post('rep', {action: 'cancel', id: heldCancelled.id, version: heldCancelled.version, reason: 'العميل رفض'});
  const staleStatus = {...JSON.parse((await stored(heldCancelled.id)).remote), status: 'received', waitingStep: 'sales', revision: 0};
  await earlierPull(heldCancelled.id, staleStatus);
  await list('rep');
  const heldRow = await stored(heldCancelled.id), heldView = (await list('rep')).requests.find(item => item.id === heldCancelled.id);
  check([heldRow.cancelled_at !== null, heldRow.cancel_reason, JSON.parse(heldRow.remote).status, heldView.cancelled, (await restoredAudits(heldCancelled.id)).length, mock.row(heldCancelled.id).cancelled], [true, 'العميل رفض', 'cancelled', true, 0, true], 'production holds it cancelled: still cancelled in the CRM, nothing audited');

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
  // Who sees which (the owner, 2026-11-03): the sales manager's list is his own and his team's (the supervisor's request is in it); customer
  // service's and the administrator's are not (they wait in «طلبات بانتظار اعتمادي»: the last section of this file).
  const smIds = await ids('sm');
  check([smIds.includes(body.request.id), (await list('owner')).requests.filter(item => ['sup', 'owner'].includes(item.memberId)).every(item => smIds.includes(item.id) === (item.memberId === 'sup'))], [false, true], 'the sales manager\'s list: his team\'s (the supervisor\'s), not customer service\'s nor the administrator\'s');
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

// ---- 2026-11-03 (production's second update): the quotation and PO numbers and their files. While the products application is the
// older one nothing of it is asked or sent; the CRM learns the update from the first answer carrying quoteOrPoMissing (here a new request's
// own answer, sent without a number); from then on a new request needs a number, sent normalized; a request first sent before is resent
// byte for byte; what the request and the sales manager's list show is production's (its production manager's additions included), with
// the note when production lacks both; the quotation's files go with their category and download by their fileId; and a production_only
// refusal says who adds a number now.
{
  const quoteMock = await startProductsMock();
  const quoteApp = await bootBuiltApp({members}, {env: {YR_PRODUCTS_API_URL: quoteMock.url, YR_PRODUCTS_SECRET: quoteMock.state.secret, NODE_EXTRA_CA_CERTS: quoteMock.ca}});
  try {
    const sessions = {rep: await quoteApp.login('rep'), sm: await quoteApp.login('sm')}, as = id => quoteApp.as(sessions[id]), now = new Date().toISOString();
    await quoteApp.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('q1','customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')").bind(JSON.stringify({name: 'مصنع q1', region: 'الشرقية', city: 'الدمام', address: 'حي الصناعية'}), now, now).run();
    const list = async (who = 'rep') => (await as(who)('/api/mold-requests')).json();
    const post = (who, body) => as(who)('/api/mold-requests', {method: 'POST', body: {requestId: crypto.randomUUID(), ...body}});
    const create = (extra = {}, specsChange = {}) => post('rep', {action: 'create', customerId: 'q1', specs: {...specs, ...specsChange}, payment: 'cash', ...extra});
    const sentBodies = id => quoteMock.state.calls.filter(call => call.route === 'requests' && call.signed && call.body.includes('"' + id + '"')).map(call => call.body);
    const learned = async () => (await quoteApp.db.prepare("SELECT owner_id AS at FROM crm_settings WHERE id='mold-quote-po'").first())?.at || null;
    const age = id => quoteApp.db.prepare("UPDATE crm_mold_requests SET remote_at='2026-01-01T00:00:00.000Z' WHERE id=?").bind(id).run();
    const viewOf = async id => (await list()).requests.find(item => item.id === id);
    const REQUIRED = 'اكتب رقم عرض السعر أو رقم الـ PO (واحد على الأقل)';

    // (1) the older products application: the form asks nothing new, a request goes exactly as before, a number is refused unsent
    let answer = await list();
    check([answer.quotePo, await learned()], [false, null], 'the older application: the screen asks for no number (quotePo false), nothing learned');
    let res = await create(), body = await res.json();
    const before = body.request.id;
    check([res.status, body.send.kind, Object.keys(JSON.parse(sentBodies(before)[0])), body.request.quotePo, body.quotePo], [200, 'ok', ['crmRequestId', 'requestedAt', 'customer', 'salesman', 'specs', 'payment'], null, false], 'a request without a number: saved and sent exactly as before; nothing to show from the older status');
    res = await create({quoteNo: 'Q-1'});
    check([res.status, (await res.json()).error, (await quoteApp.db.prepare("SELECT COUNT(*) AS n FROM crm_mold_requests WHERE json_extract(data,'$.quoteNo') IS NOT NULL").first()).n], [409, 'تطبيق المنتجات لسه ما اتحدّثش لاستقبال رقم عرض السعر والـ PO؛ حدّث الصفحة وابعت الطلب من غيرهم.', 0], 'a number sent anyway: refused, nothing saved');
    // A request whose first send arrived but whose answer was lost: it waits to be sent again, as first sent.
    quoteMock.loseNext('requests');
    body = await (await create({}, {description: 'lost answer before the update'})).json();
    const lost = body.request.id;
    check([body.request.sending.state, sentBodies(lost).length, !!quoteMock.row(lost)], ['waiting', 1, true], 'its answer lost: production holds it, the CRM waits to send it again');
    await quoteApp.db.prepare('UPDATE crm_mold_requests SET next_attempt_at=? WHERE id=?').bind(new Date(Date.now() + 3600_000).toISOString(), lost).run();

    // (2) production's update goes live; the CRM learns it from the first answer carrying quoteOrPoMissing: here a new request's own
    quoteMock.setQuotePo(true);
    body = await (await create({}, {description: 'after their update, before the CRM knew'})).json();
    const missing = body.request.id;
    check([body.send.kind, typeof await learned(), body.quotePo, body.request.quotePo, Object.hasOwn(JSON.parse(sentBodies(missing)[0]), 'quoteNo')], ['ok', 'string', true, {quoteNo: '', poNo: '', missing: true, from: 'production'}, false],
      'sent without a number (the screen asked none), production marks it missing, and its answer teaches the CRM (kept in crm_settings)');
    answer = await list();
    check([answer.quotePo, answer.requests.find(item => item.id === before).quotePo], [true, null], 'the screen now asks for the numbers; the earlier request\'s stored status says nothing yet');
    await age(before);
    check((await viewOf(before)).quotePo, {quoteNo: '', poNo: '', missing: false, from: 'production'}, 'pulled again: a request taken before the update has none and is not missing');

    // (3) a new request needs one of the numbers; they are normalized and sent after payment
    res = await create();
    body = await res.json();
    check([res.status, body.fields, body.error], [400, {quotePo: REQUIRED}, REQUIRED], 'none: refused with «واحد على الأقل»');
    check((await (await create({quoteNo: 'Q'.repeat(61)})).json()).fields, {quoteNo: 'رقم عرض السعر أطول من 60 حرف'}, 'a quotation number of 61 characters: refused, named');
    body = await (await create({quoteNo: '', poNo: ' PO-٧٧٨١ '})).json();
    const withPo = body.request.id, poSent = JSON.parse(sentBodies(withPo)[0]);
    check([body.send.kind, Object.keys(poSent).slice(-2), poSent.poNo, Object.hasOwn(poSent, 'quoteNo'), JSON.parse((await quoteApp.db.prepare('SELECT data FROM crm_mold_requests WHERE id=?').bind(withPo).first()).data).poNo, body.request.quotePo],
      ['ok', ['payment', 'poNo'], 'PO-7781', false, 'PO-7781', {quoteNo: '', poNo: 'PO-7781', missing: false, from: 'production'}], 'the PO alone: normalized, stored and sent after payment; no quoteNo key');
    body = await (await create({quoteNo: 'Q-2026-0153', poNo: 'PO-1'})).json();
    const both = body.request.id;
    check([Object.keys(JSON.parse(sentBodies(both)[0])).slice(-3), body.request.quotePo], [['payment', 'quoteNo', 'poNo'], {quoteNo: 'Q-2026-0153', poNo: 'PO-1', missing: false, from: 'production'}], 'both: quoteNo then poNo');

    // (4) the request first sent before the update is resent byte for byte (no number added): production takes it as the same request
    res = await post('rep', {action: 'resend', id: lost});
    body = await res.json();
    const lostBodies = sentBodies(lost);
    check([res.status, body.send.kind, lostBodies.length, lostBodies[1] === lostBodies[0], quoteMock.row(lost).quoteNo], [200, 'ok', 2, true, null], 'the resend is the very same bytes as the first send (200 created:false), no number added');

    // (5) the production manager adds and corrects numbers in the products application: the request shows production's
    quoteMock.setNumbers(missing, {quoteNo: 'Q-ADDED'});
    quoteMock.setNumbers(both, {poNo: 'PO-1-CORRECTED'});
    await age(missing); await age(both);
    check([(await viewOf(missing)).quotePo, (await viewOf(both)).quotePo, JSON.parse((await quoteApp.db.prepare('SELECT data FROM crm_mold_requests WHERE id=?').bind(both).first()).data).poNo],
      [{quoteNo: 'Q-ADDED', poNo: '', missing: false, from: 'production'}, {quoteNo: 'Q-2026-0153', poNo: 'PO-1-CORRECTED', missing: false, from: 'production'}, 'PO-1'], 'production\'s numbers are shown (added, corrected), never the CRM\'s copy, which stays as sent');

    // (6) the sales manager's list: each request's numbers as production holds them, the missing note's flag, and the quotation's files
    const multipart = async fields => {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) if (value && typeof value === 'object' && 'bytes' in value) form.set(key, new Blob([value.bytes]), value.name); else form.set(key, value);
      const encoded = new Response(form);
      return {body: Buffer.from(await encoded.arrayBuffer()), headers: {'Content-Type': encoded.headers.get('content-type')}};
    };
    const upload = async (id, name, bytes, category) => { const encoded = await multipart({requestId: crypto.randomUUID(), id, ...(category ? {category} : {}), file: {name, bytes}}); return as('rep')('/api/mold-requests/design-files', {method: 'POST', body: encoded.body, headers: encoded.headers}); };
    const quotation = Buffer.from('%PDF-1.7 synthetic quotation Q-2026-0153');
    body = await (await upload(both, 'عرض سعر Q-2026-0153.pdf', quotation, 'quote')).json();
    check([body.file.state, body.file.category, JSON.parse(quoteMock.state.calls.findLast(call => call.route === 'design-files').body).category], ['sent', 'quote', 'quote'], 'a quotation file: sent with its category');
    res = await upload(both, 'رسم.dwg', Buffer.from('AC1027'), 'po');
    check([res.status, (await res.json()).reason], [400, 'not_document'], 'a drawing as the PO: refused before anything is saved');
    const unnumbered = quoteMock.registerManual({customerNo: (await quoteApp.db.prepare("SELECT number FROM crm_customer_numbers WHERE customer_id='q1'").first()).number, customerName: 'مصنع q1'});
    const pending = (await list('sm')).pending.items, of = id => pending.find(item => item.crmRequestId === id);
    check([of(missing).quoteNo, of(missing).quoteOrPoMissing, of(both).poNo, of(both).quoteFiles.map(file => [file.name, file.category]), pending.find(item => item.orderNo === unnumbered.orderNo).quoteOrPoMissing],
      ['Q-ADDED', false, 'PO-1-CORRECTED', [['عرض سعر Q-2026-0153.pdf', 'quote']], true], 'pending: production\'s numbers, its quotation files, and a request registered there without any marked missing');
    const fetched = await as('sm')(of(both).quoteFiles[0].href);
    check([fetched.status, fetched.bytes.equals(quotation)], [200, true], 'the sales manager downloads the quotation file from the list, by its fileId');

    // (7) an edit before the first send needs a number too; a production_only refusal says who adds one now
    quoteMock.state.notConfigured = true;
    body = await (await create({quoteNo: 'Q-EDIT'})).json();
    const edited = body.request.id;
    check([body.request.sending.state, body.request.can.edit], ['waiting', true], 'production without its secret: refused before storing, still editable');
    res = await post('rep', {action: 'update', id: edited, version: body.request.version, specs, payment: 'cash', quoteNo: '', poNo: ''});
    check([res.status, (await res.json()).fields], [400, {quotePo: REQUIRED}], 'an edit that removes both numbers: refused');
    quoteMock.state.notConfigured = false;
    body = await (await post('rep', {action: 'update', id: edited, version: body.request.version, specs, payment: 'cash', quoteNo: 'Q-EDIT', poNo: 'PO-EDIT'})).json();
    check([body.send.kind, JSON.parse(sentBodies(edited).at(-1)).poNo], ['ok', 'PO-EDIT'], 'an edit with its numbers: saved and sent');
    quoteMock.state.notConfigured = true;
    body = await (await create({poNo: 'PO-LOCKED'})).json();
    quoteMock.state.notConfigured = false;
    quoteMock.answerNext('requests', 409, {error: {code: 'request_locked', message: 'x', details: {reason: 'production_only'}}});
    res = await post('rep', {action: 'resend', id: body.request.id});
    check([res.status, (await res.json()).error], [409, 'بيانات الطلب يعدّلها مدير الإنتاج فقط؛ التعديل لم يصل للإنتاج ولن يُعاد إرساله. كلّم مدير الإنتاج يضيف رقم عرض السعر / الـ PO.'], 'a production_only refusal (never caused by the CRM, which resends as first sent): says to ask the production manager');
    check([(await list()).quotePo, typeof await learned()], [true, 'string'], 'still known: never unlearned');
  } finally { await quoteApp.stop(); await quoteMock.stop(); }
}

// ---- who sees which request (the owner, 2026-11-03: «يبان للمندوب طلباته بس ومدير المبيعات طلباته وطلبات فريقه»). Two sales managers
// share the eastern region, each with a supervisor and a representative under him (smE also has one representative directly); a third
// manager has the western region. A manager's list is his own and his team's. «طلبات بانتظار اعتمادي» is his own and his team's, every
// CRM request whose requester is in no sales manager's team (customer service, the administrator, an orphan representative) within his
// regions, and those registered in production by region; never another manager's team's. The approval (by id and by order number), the
// approver's sheet (?id=) and the downloads (by order number and by id) follow it exactly.
{
  const teamMembers = [
    {id: 'owner', role: 'admin'}, {id: 'smE', role: 'manager', region: 'eastern'}, {id: 'smE2', role: 'manager', region: 'eastern'}, {id: 'smW', role: 'manager', region: 'western'},
    {id: 'supE', role: 'supervisor', sup: 'smE', region: 'eastern'}, {id: 'repE', role: 'rep', sup: 'supE', region: 'eastern'}, {id: 'repD', role: 'rep', sup: 'smE', region: 'eastern'},
    {id: 'supE2', role: 'supervisor', sup: 'smE2', region: 'eastern'}, {id: 'repE2', role: 'rep', sup: 'supE2', region: 'eastern'},
    {id: 'csm', role: 'customer_service_manager', sup: 'smE', region: 'eastern'}, {id: 'cs', role: 'customer_service', sup: 'csm', region: 'eastern'}, {id: 'orphan', role: 'rep', region: 'eastern'},
  ];
  const teamMock = await startProductsMock();
  const teamApp = await bootBuiltApp({members: teamMembers}, {env: {YR_PRODUCTS_API_URL: teamMock.url, YR_PRODUCTS_SECRET: teamMock.state.secret, NODE_EXTRA_CA_CERTS: teamMock.ca}});
  try {
    const sessions = {};
    for (const member of teamMembers) sessions[member.id] = await teamApp.login(member.id);
    const as = id => teamApp.as(sessions[id]), now = new Date().toISOString();
    for (const [id, assignedTo, region] of [['e1', 'repE', 'الشرقية'], ['e2', 'repE2', 'الشرقية'], ['e3', 'repD', 'الشرقية'], ['e4', 'orphan', 'الشرقية'], ['w1', 'owner', 'الغربية']])
      await teamApp.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')").bind(id, assignedTo, JSON.stringify({name: 'مصنع ' + id, region, city: 'الدمام'}), now, now).run();
    const number = async id => (await teamApp.db.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').bind(id).first()).number;
    const post = (who, body) => as(who)('/api/mold-requests', {method: 'POST', body: {requestId: crypto.randomUUID(), ...body}});
    const ask = async (who, customerId, description) => {
      const res = await post(who, {action: 'create', customerId, specs: {...specs, description}, payment: 'cash'}), body = await res.json();
      check([res.status, body.send.kind], [200, 'ok'], description + ': asked and sent');
      return body.request;
    };
    const rE = await ask('repE', 'e1', 'his team, under a supervisor'), rD = await ask('repD', 'e3', 'his team, directly'), rSm = await ask('smE', 'e1', 'the manager\'s own');
    const rE2 = await ask('repE2', 'e2', 'the other manager\'s team'), rCs = await ask('cs', 'e1', 'customer service'), rOwner = await ask('owner', 'e1', 'the administrator');
    const rOrphan = await ask('orphan', 'e4', 'a representative under no manager'), rWest = await ask('owner', 'w1', 'the administrator, in the west');
    const manual = teamMock.registerManual({customerNo: await number('e2'), customerName: 'مصنع مسجّل في الإنتاج (الشرقية)'});
    const csFile = teamMock.addProductionFile(rCs.id, {name: 'تصميم طلب خدمة العملاء.pdf'}), e2File = teamMock.addProductionFile(rE2.id, {name: 'تصميم الفريق الآخر.pdf'});
    // Production attached them after its last answer: their requests' status is pulled again when next opened.
    await teamApp.db.prepare("UPDATE crm_mold_requests SET remote_at='2026-01-01T00:00:00.000Z' WHERE id IN (?,?)").bind(rCs.id, rE2.id).run();
    const list = async who => (await as(who)('/api/mold-requests')).json();
    const mine = async who => (await list(who)).requests.map(item => item.id).sort();
    const pendingOf = async who => (await list(who)).pending;
    const waiting = async who => (await pendingOf(who)).items.map(item => item.crmRequestId || 'order:' + item.orderNo).sort();
    const sorted = (...ids) => ids.sort();

    check([await mine('smE'), await mine('smE2'), await mine('smW')], [sorted(rE.id, rD.id, rSm.id), [rE2.id], []], 'each manager\'s list: his own and his team\'s (under a supervisor, or directly); never the other manager\'s team in the same region, customer service\'s, the administrator\'s or an orphan\'s');
    check([await mine('repE'), await mine('supE'), await mine('csm'), (await mine('owner')).length], [[rE.id], [rE.id], [rCs.id], 8], 'a representative his own only; the supervisor, the customer-service manager and the administrator as before');
    check(await waiting('smE'), sorted(rE.id, rD.id, rSm.id, rCs.id, rOwner.id, rOrphan.id, 'order:' + manual.orderNo), '«طلبات بانتظار اعتمادي» for smE: his own, his team\'s, customer service\'s, the administrator\'s and the orphan\'s in his region, and the one registered in production; not the other team\'s, nor the west\'s');
    check(await waiting('smE2'), sorted(rE2.id, rCs.id, rOwner.id, rOrphan.id, 'order:' + manual.orderNo), 'for smE2 (the same region): his team\'s and the same requests of no team; not smE\'s team\'s');
    check(await waiting('smW'), [rWest.id], 'for the western manager: the west\'s request of no team only');
    const csItem = (await pendingOf('smE')).items.find(item => item.crmRequestId === rCs.id);
    check([csItem.inCrm, (await list('smE')).requests.some(item => item.id === rCs.id)], [true, false], 'customer service\'s request: the CRM\'s own, in his waiting list but not in his list');

    // The approver's sheet: what his list shows, and a request his waiting list shows him now; nothing else.
    const sheet = async (who, id) => { const res = await as(who)('/api/mold-requests?id=' + id); return [res.status, res.status === 200 ? res.json().requests[0].can.approve : null]; };
    check([await sheet('smE', rCs.id), await sheet('smE', rOrphan.id), await sheet('smE2', rCs.id), await sheet('smE', rE.id)], [[200, true], [200, true], [200, true], [200, true]], 'the sheet opens on customer service\'s and the orphan\'s requests from the waiting list (both managers of the region), and on his team\'s');
    const csSheet = (await as('smE')('/api/mold-requests?id=' + rCs.id)).json().requests[0];
    check(csSheet.designFiles.map(file => [file.fileId, file.href]), [[String(csFile.fileId), '/api/mold-requests/design-file?id=' + encodeURIComponent(rCs.id) + '&file=' + csFile.fileId]], 'its sheet lists production\'s file, downloaded by id');
    check([await sheet('smE', rE2.id), await sheet('smW', rCs.id), await sheet('smE2', rE.id)], [[404, null], [404, null], [404, null]], 'never on another manager\'s team\'s, nor on a request of another region');

    // Downloads: by order number for the items his waiting list shows, by id for what his sheet opens.
    const download = async (who, query) => (await as(who)('/api/mold-requests/design-file?' + query)).status;
    const csHref = csItem.designFiles.find(file => file.fileId === csFile.fileId).href;
    const csBytes = await as('smE')(csHref);
    check([csBytes.status, csBytes.bytes.equals(Buffer.from('%PDF-1.4 production drawing')), (await as('smE2')(csHref)).status, (await as('smW')(csHref)).status], [200, true, 200, 404], 'customer service\'s design file from the waiting list: both managers of the region, not the west\'s');
    check([await download('smE', 'id=' + rCs.id + '&file=' + csFile.fileId), await download('smE', 'id=' + rE2.id + '&file=' + e2File.fileId), await download('smE', 'order=' + teamMock.row(rE2.id).orderNo + '&file=' + e2File.fileId), await download('smE2', 'order=' + teamMock.row(rE2.id).orderNo + '&file=' + e2File.fileId)],
      [200, 404, 404, 200], 'by id from the sheet he opens; never the other team\'s file, by id or by order number; its own manager downloads it');

    // Approving: exactly the items shown, by id and by order number.
    check([(await post('smE', {action: 'approve', id: rE2.id})).status, (await post('smE', {action: 'approve-order', orderNo: teamMock.row(rE2.id).orderNo})).status, (await post('smE2', {action: 'approve-order', orderNo: teamMock.row(rE.id).orderNo})).status, (await post('smW', {action: 'approve', id: rCs.id})).status],
      [404, 404, 404, 404], 'another manager\'s team\'s request, or one of another region: refused by id and by order number, production not asked');
    check([teamMock.row(rE2.id).approvals.sales, teamMock.row(rE.id).approvals.sales, teamMock.row(rCs.id).approvals.sales], [null, null, null], 'nothing approved at production');
    let res = await post('smE', {action: 'approve', id: rCs.id}), body = await res.json();
    check([res.status, body.request.remote.waitingStep, body.request.can.withdraw, !!teamMock.row(rCs.id).approvals.sales], [200, 'production', true, true], 'smE approves customer service\'s request from its sheet');
    check([await sheet('smE', rCs.id), await download('smE', 'id=' + rCs.id + '&file=' + csFile.fileId)], [[404, null], 404], 'approved, it is no longer his to open (his list never held it)');
    res = await post('smE', {action: 'withdraw', id: rCs.id}); body = await res.json();
    check([res.status, body.request.remote.waitingStep, await sheet('smE', rCs.id)], [200, 'sales', [200, true]], 'his approval withdrawn from the sheet he approved on: waiting for the managers again, open again');
    check([(await post('smE2', {action: 'approve-order', orderNo: teamMock.row(rCs.id).orderNo})).status, (await post('smE2', {action: 'approve', id: rE2.id})).status, (await post('smE', {action: 'approve-order', orderNo: teamMock.row(rD.id).orderNo})).status, (await post('smE', {action: 'approve', id: rSm.id})).status],
      [200, 200, 200, 200], 'the other manager of the region approves it by order number; each approves his own team\'s, and his own');
    check([await waiting('smE'), await waiting('smE2')], [sorted(rE.id, rOwner.id, rOrphan.id, 'order:' + manual.orderNo), sorted(rOwner.id, rOrphan.id, 'order:' + manual.orderNo)], 'what is left waiting for each');
  } finally { await teamApp.stop(); await teamMock.stop(); }
}

console.log(JSON.stringify({ok: true, checks, builtRelease: true, realProductionTested: false}));
