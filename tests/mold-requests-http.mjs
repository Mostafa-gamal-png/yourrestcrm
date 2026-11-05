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
// files (see its section): nothing asked or sent before the update, the update learned from an answer, an older request resent byte for
// byte; since 2026-11-05 no number (one from a page loaded before refused, a stored one kept and sent), a new request of any role kept in
// the CRM until its first quotation or PO file (no resend, timetable or page sends it), released by that file (the request, then its
// files), «missing» from production's flag with the file attached afterwards, and a quotation's or PO's file keeping the approvals while a
// design file undoes them. Who sees which request
// (the owner, 2026-11-03: two managers sharing a region, customer service's request in the waiting list only) and «رابط التصميم» removed
// (refused when sent, an older request's link kept and resent byte for byte).
// Synthetic isolated fixtures only: temporary SQLite, mocked sendmail, no production data, no real production application.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';
import {moldStatusObject} from '../portable/mold-rules.mjs';
import {signatureInput, signaturePng, withSignature} from '../scripts/lib/signature-png.mjs';

const members = [
  {id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'},
  {id: 'sup', role: 'supervisor', sup: 'sm'}, {id: 'sup2', role: 'supervisor', sup: 'sm'},
  {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'أحمد عبد العزيز'}, {id: 'rep2', role: 'rep', sup: 'sup2'},
  {id: 'csm', role: 'customer_service_manager', sup: 'sm'}, {id: 'cs', role: 'customer_service', sup: 'csm'},
];
const roleOf = (who, roster = members) => roster.find(member => member.id === who)?.role;
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
  // A sales role's create, or edit, carries the customer's signature as the form sends it (2026-11-04: see its own section below).
  const post = (who, body) => as(who)('/api/mold-requests', {method: 'POST', body: withSignature(roleOf(who), {requestId: crypto.randomUUID(), ...body})});
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
  const requestId = crypto.randomUUID(), once = withSignature('rep', {action: 'create', customerId: 'east2', specs, payment: 'cash', requestId});
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
  const created = await (await as('/api/mold-requests', {method: 'POST', body: withSignature('rep', {action: 'create', requestId: crypto.randomUUID(), customerId: 'e1', specs, payment: 'deferred'})})).json();
  check([created.request.sending.state, created.send.kind, created.request.can.edit], ['off', 'off', true], 'a request is still saved, waiting while the link is off (never attempted: still editable)');
  check((await as('/api/mold-requests', {method: 'POST', body: {action: 'resend', requestId: crypto.randomUUID(), id: created.request.id}})).status, 503, 'resend says the link is off');
  check([(await as('/api/crm')).status, mock.state.calls.length - calls], [200, 0], 'the rest of the CRM works; nothing was sent');
} finally { await plain.stop(); await mock.stop(); }

// ---- 2026-11-03 (production's second update) as it stands since production's update of 2026-11-05: the quotation's or PO's FILE is
// required, the numbers are gone. While the products application is the older one nothing of it is asked or sent; the CRM learns the
// update from the first answer carrying quoteOrPoMissing; from then on a new request, from any role, carries no number (one a page loaded
// before sends is refused) and is kept in the CRM, not sent, until its first quotation or PO file is attached, which sends the request
// and then its files; a request first sent before is resent byte for byte; quoteOrPoMissing (no quotation or PO file, finance not
// approved) is shown as «ناقص» and a file attached to such a request (one sent with a number only) fixes it without undoing the
// approvals, while a design file still undoes them; a never-sent request stored with a number keeps it through an edit and sends it;
// production_only no longer says to ask for a number.
{
  const quoteMock = await startProductsMock();
  const quoteApp = await bootBuiltApp({members}, {env: {YR_PRODUCTS_API_URL: quoteMock.url, YR_PRODUCTS_SECRET: quoteMock.state.secret, NODE_EXTRA_CA_CERTS: quoteMock.ca}});
  try {
    const sessions = {rep: await quoteApp.login('rep'), sm: await quoteApp.login('sm'), cs: await quoteApp.login('cs')}, as = id => quoteApp.as(sessions[id]), now = new Date().toISOString();
    await quoteApp.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('q1','customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')").bind(JSON.stringify({name: 'مصنع q1', region: 'الشرقية', city: 'الدمام', address: 'حي الصناعية'}), now, now).run();
    const list = async (who = 'rep') => (await as(who)('/api/mold-requests')).json();
    const post = (who, body) => as(who)('/api/mold-requests', {method: 'POST', body: withSignature(roleOf(who), {requestId: crypto.randomUUID(), ...body})});
    const create = (extra = {}, specsChange = {}, who = 'rep') => post(who, {action: 'create', customerId: 'q1', specs: {...specs, ...specsChange}, payment: 'cash', ...extra});
    const sentBodies = id => quoteMock.state.calls.filter(call => call.route === 'requests' && call.signed && call.body.includes('"' + id + '"')).map(call => call.body);
    const fileCalls = id => quoteMock.state.calls.filter(call => call.route === 'design-files' && call.signed && call.body.includes('"' + id + '"'));
    const learned = async () => (await quoteApp.db.prepare("SELECT owner_id AS at FROM crm_settings WHERE id='mold-quote-po'").first())?.at || null;
    const age = id => quoteApp.db.prepare("UPDATE crm_mold_requests SET remote_at='2026-01-01T00:00:00.000Z' WHERE id=?").bind(id).run();
    const viewOf = async (id, who = 'rep') => (await list(who)).requests.find(item => item.id === id);
    const dataOf = async id => JSON.parse((await quoteApp.db.prepare('SELECT data FROM crm_mold_requests WHERE id=?').bind(id).first()).data);
    const multipart = async fields => {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) if (value && typeof value === 'object' && 'bytes' in value) form.set(key, new Blob([value.bytes]), value.name); else form.set(key, value);
      const encoded = new Response(form);
      return {body: Buffer.from(await encoded.arrayBuffer()), headers: {'Content-Type': encoded.headers.get('content-type')}};
    };
    const upload = async (id, name, bytes, category, who = 'rep') => { const encoded = await multipart({requestId: crypto.randomUUID(), id, ...(category ? {category} : {}), file: {name, bytes}}); return as(who)('/api/mold-requests/design-files', {method: 'POST', body: encoded.body, headers: encoded.headers}); };
    const remove = (id, fileId, who = 'rep') => as(who)('/api/mold-requests/design-files/delete', {method: 'POST', body: {requestId: crypto.randomUUID(), id, fileId}});
    const GONE = 'رقم عرض السعر ورقم الـ PO اتشالوا من الطلب؛ حدّث الصفحة وأرفق ملف عرض السعر أو الـ PO بدالهم.';
    const pdf = text => Buffer.from('%PDF-1.7 synthetic ' + text);

    // (1) the older products application: the form asks nothing new, a request goes exactly as before, a number is refused unsent
    let answer = await list();
    check([answer.quotePo, await learned()], [false, null], 'the older application: the screen asks for nothing new (quotePo false), nothing learned');
    let res = await create(), body = await res.json();
    const before = body.request.id;
    check([res.status, body.send.kind, Object.keys(JSON.parse(sentBodies(before)[0])), body.request.quotePo, body.quotePo, Object.hasOwn(await dataOf(before), 'fileRequired')], [200, 'ok', ['crmRequestId', 'requestedAt', 'customer', 'salesman', 'specs', 'payment'], null, false, false], 'a request: saved and sent exactly as before, no file asked for');
    res = await create({quoteNo: 'Q-1'});
    check([res.status, (await res.json()).fields, (await quoteApp.db.prepare("SELECT COUNT(*) AS n FROM crm_mold_requests WHERE json_extract(data,'$.quoteNo') IS NOT NULL").first()).n], [400, {quoteNo: GONE}, 0], 'a number sent anyway (a page loaded before): refused by its field, nothing saved');
    // A request whose first send arrived but whose answer was lost: it waits to be sent again, as first sent.
    quoteMock.loseNext('requests');
    body = await (await create({}, {description: 'lost answer before the update'})).json();
    const lost = body.request.id;
    check([body.request.sending.state, sentBodies(lost).length, !!quoteMock.row(lost)], ['waiting', 1, true], 'its answer lost: production holds it, the CRM waits to send it again');
    await quoteApp.db.prepare('UPDATE crm_mold_requests SET next_attempt_at=? WHERE id=?').bind(new Date(Date.now() + 3600_000).toISOString(), lost).run();
    // Yesterday's request (2026-11-04, the CRM asked for a number then): stored with its quotation number, never sent yet (the link was busy).
    const yesterday = 'mr-' + crypto.randomUUID(), yesterdayAt = new Date().toISOString();
    const yesterdayData = {...(await dataOf(before)), requestedAt: '2026-11-04T16:00:00+03:00', quoteNo: 'Q-2026-0153'};
    delete yesterdayData.signature;
    await quoteApp.db.prepare("INSERT INTO crm_mold_requests(id,member_id,customer_id,data,outbox,next_attempt_at,created_by,created_at,updated_at,version) VALUES(?,'rep','q1',?,'send',?,'rep',?,?,1)").bind(yesterday, JSON.stringify(yesterdayData), new Date(Date.now() + 3600_000).toISOString(), yesterdayAt, yesterdayAt).run();

    // (2) production's update goes live; the CRM learns it from the first answer carrying quoteOrPoMissing: here a status pull
    quoteMock.setQuotePo(true);
    await age(before);
    answer = await list();
    check([answer.quotePo, typeof await learned(), answer.requests.find(item => item.id === before).quotePo], [true, 'string', {missing: true}], 'a pull teaches the CRM (kept in crm_settings); the request sent before has no quotation or PO file: «missing»');

    // (3) a new request carries no number and is kept until its first quotation or PO file; a number is refused
    res = await create({quoteNo: 'Q-NEW'});
    check([res.status, (await res.json()).fields], [400, {quoteNo: GONE}], 'a number from a page loaded before: refused (nothing typed is dropped silently)');
    res = await create({}, {description: 'kept for its quotation file'});
    body = await res.json();
    const kept = body.request.id, keptData = await dataOf(kept);
    check([res.status, body.send, [body.request.sending.state, body.request.sending.held], keptData.fileRequired, Object.hasOwn(keptData, 'quoteNo'), sentBodies(kept).length, fileCalls(kept).length, body.request.can.resend, body.request.can.attach],
      [200, {kind: 'none', code: 'quote_file', fields: []}, ['waiting', 'quote_file'], true, false, 0, 0, false, true], 'saved with the customer\'s signature, kept in the CRM: nothing sent, the signature neither; no resend, the attach action');
    res = await post('rep', {action: 'resend', id: kept});
    check([res.status, (await res.json()).error, sentBodies(kept).length], [409, 'الطلب بانتظار ملف عرض السعر / الـ PO؛ أرفق الملف ويتبعت الطلب لوحده.', 0], 'a resend: refused with what to do');
    // Due on the timetable (as a request that waited through a restart is: the first page any member loads runs the check, see above):
    // the check does not send it either.
    await quoteApp.db.prepare("UPDATE crm_mold_requests SET next_attempt_at='2026-01-01T00:00:00.000Z' WHERE id=?").bind(kept).run();
    check((await as('rep')('/api/crm')).status, 200, 'a page of the CRM loaded');
    await list();
    await new Promise(resolve => setTimeout(resolve, 1500));
    check([sentBodies(kept).length, (await viewOf(kept)).sending.held], [0, 'quote_file'], 'due, and checked by the timetable and by the page: still kept, never sent');
    // A design file does not release it; the first quotation file does: the request first, then its files in the order attached.
    body = await (await upload(kept, 'رسم.pdf', pdf('design'))).json();
    check([body.file.state, body.request.sending.held, sentBodies(kept).length], ['held', 'quote_file', 0], 'a design file: kept with it');
    const order = quoteMock.state.calls.length;
    body = await (await upload(kept, 'عرض سعر.pdf', pdf('quotation'), 'quote')).json();
    const released = quoteMock.state.calls.slice(order).filter(call => call.signed && ['requests', 'design-files'].includes(call.route)).map(call => call.route === 'requests' ? 'request' : JSON.parse(call.body).crmFileId);
    const keptFiles = (await quoteApp.db.prepare('SELECT id FROM crm_mold_design_files WHERE request_id=? ORDER BY created_at,id').bind(kept).all()).results.map(row => row.id);
    check([body.file.state, body.request.sending.state, released, quoteMock.row(kept).designFiles.map(file => file.category || 'design'), body.request.quotePo],
      ['sent', 'sent', ['request', ...keptFiles], ['design', 'design', 'quote'], {missing: false}], 'the quotation file releases it: the request, then the signature, the design file and the quotation file; production holds its quotation file');
    check([Object.keys(JSON.parse(sentBodies(kept)[0])).join(','), JSON.parse(sentBodies(kept)[0]).crmRequestId], ['crmRequestId,requestedAt,customer,salesman,specs,payment', kept], 'sent without a number; the marker never travels');
    // The signature is still required of a sales role at create; customer service needs the file too (the owner: every role).
    res = await post('rep', {action: 'create', customerId: 'q1', specs, payment: 'cash', signature: null});
    check([res.status, Object.keys((await res.json()).fields)], [400, ['signature']], 'a representative without the customer\'s signature: refused as before');
    await quoteApp.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('q2','customer',NULL,'rep2','الرئيسي',?,?,?,1,'fixture')").bind(JSON.stringify({name: 'مصنع q2', region: 'الشرقية', city: 'الرياض'}), now, now).run();
    body = await (await post('cs', {action: 'create', customerId: 'q2', specs: {...specs, description: 'customer service, kept'}, payment: 'deferred'})).json();
    const service = body.request.id;
    check([body.request.sending.held, sentBodies(service).length], ['quote_file', 0], 'customer service\'s new request is kept for its file too');
    body = await (await upload(service, 'PO.pdf', pdf('service po'), 'po', 'cs')).json();
    check([body.file.state, body.request.sending.state, sentBodies(service).length, quoteMock.row(service).designFiles.map(file => file.category)], ['sent', 'sent', 1, ['po']], 'its PO file releases it');

    // (4) the request first sent before the update is resent byte for byte: production takes it as the same request
    res = await post('rep', {action: 'resend', id: lost});
    body = await res.json();
    const lostBodies = sentBodies(lost);
    check([res.status, body.send.kind, lostBodies.length, lostBodies[1] === lostBodies[0], body.request.sending.state], [200, 'ok', 2, true, 'sent'], 'the resend is the very same bytes as the first send (200 created:false); not kept for a file (asked for before the rule)');

    // (5) yesterday's never-sent request with its number: an edit keeps the number (and sends it), an old page's same number passes, another is refused
    res = await post('rep', {action: 'update', id: yesterday, version: 1, specs: {...specs, quantity: 2}, payment: 'cash', quoteNo: 'Q-OTHER', poNo: ''});
    check([res.status, (await res.json()).fields], [400, {quoteNo: GONE}], 'another number from a page loaded before: refused, the stored one kept');
    quoteMock.state.notConfigured = true;
    body = await (await post('rep', {action: 'update', id: yesterday, version: 1, specs: {...specs, quantity: 2}, payment: 'cash'})).json();
    check([body.send.kind, (await dataOf(yesterday)).quoteNo, (await dataOf(yesterday)).specs.quantity, body.request.can.edit], ['retry', 'Q-2026-0153', 2, true], 'an edit without numbers (this release\'s form): saved, its number kept as stored; production refused it before storing (still editable)');
    body = await (await post('rep', {action: 'update', id: yesterday, version: body.request.version, specs: {...specs, quantity: 3}, payment: 'cash', quoteNo: 'Q-2026-0153', poNo: ''})).json();
    check([body.request.specs.quantity, (await dataOf(yesterday)).quoteNo], [3, 'Q-2026-0153'], 'its own number sent back by an old page: taken (nothing changes in it)');
    quoteMock.state.notConfigured = false;
    res = await post('rep', {action: 'resend', id: yesterday});
    body = await res.json();
    const yesterdaySent = JSON.parse(sentBodies(yesterday).at(-1));
    check([body.send.kind, yesterdaySent.quoteNo, Object.keys(yesterdaySent).slice(-2), body.request.quotePo, Object.hasOwn(await dataOf(yesterday), 'fileRequired')], ['ok', 'Q-2026-0153', ['payment', 'quoteNo'], {missing: true}, false], 'sent with its number, not kept for a file (asked for before this release); production counts no number: «missing»');
    // Its new signature (the edit changed what was signed) goes after it, in the background: let it arrive before the approval.
    for (let n = 0; n < 100 && (await quoteApp.db.prepare('SELECT COUNT(*) AS n FROM crm_mold_design_files WHERE request_id=? AND outbox IS NOT NULL').bind(yesterday).first()).n; n++) await new Promise(resolve => setTimeout(resolve, 100));
    // ... the sales manager approves it; the representative attaches its quotation file: no longer missing, the approval stays
    answer = await list('sm');
    const pendingYesterday = answer.pending.items.find(item => item.crmRequestId === yesterday);
    check([pendingYesterday.quoteOrPoMissing, Object.hasOwn(pendingYesterday, 'quoteNo')], [true, true], 'the sales manager\'s list: «missing» (its number is still in the data production lists, not shown)');
    res = await post('sm', {action: 'approve', id: yesterday});
    check([res.status, !!(await res.json()).request.remote.approvals.sales], [200, true], 'the sales manager approves it');
    body = await (await upload(yesterday, 'عرض سعر Q-2026-0153.pdf', pdf('quotation Q-2026-0153'), 'quote')).json();
    check([body.file.state, body.request.quotePo, !!body.request.remote.approvals.sales, body.request.remote.waitingStep, JSON.parse(fileCalls(yesterday).at(-1).body).category], ['sent', {missing: false}, true, 'production', 'quote'], 'its quotation file attached: sent with its category, no longer missing, the approval stays');
    const quoteFile = body.file.crmFileId;
    body = await (await remove(yesterday, quoteFile)).json();
    check([body.request.quotePo, !!body.request.remote.approvals.sales], [{missing: true}, true], 'deleted again: missing again, the approval still stays');
    body = await (await upload(yesterday, 'رسم.pdf', pdf('a design'))).json();
    check([body.file.state, body.request.remote.approvals.sales, body.request.remote.waitingStep], ['sent', null, 'sales'], 'a design file still undoes the approvals: back with the sales manager');
    // Production's own PO file counts too (its production manager attached it); a request registered there without any is «missing».
    quoteMock.addProductionFile(yesterday, {name: 'PO الإنتاج.pdf', category: 'po'});
    const manual = quoteMock.registerManual({customerNo: (await quoteApp.db.prepare("SELECT number FROM crm_customer_numbers WHERE customer_id='q1'").first()).number, customerName: 'مصنع q1'});
    await age(yesterday);
    answer = await list('sm');
    check([answer.requests.find(item => item.id === yesterday)?.quotePo ?? (await viewOf(yesterday)).quotePo, answer.pending.items.find(item => item.orderNo === manual.orderNo).quoteOrPoMissing, answer.pending.items.find(item => item.crmRequestId === yesterday).poFiles.map(file => file.source)], [{missing: false}, true, ['production']], 'production\'s own PO file: not missing; one registered there without a file: missing');

    // (6) a production_only refusal (never caused by the CRM, which resends as first sent) no longer says to ask for a number
    quoteMock.state.notConfigured = true;
    body = await (await create({}, {description: 'production only'})).json();
    const refusedId = body.request.id;
    body = await (await upload(refusedId, 'عرض.pdf', pdf('production only'), 'quote')).json();
    quoteMock.state.notConfigured = false;
    quoteMock.answerNext('requests', 409, {error: {code: 'request_locked', message: 'x', details: {reason: 'production_only'}}});
    res = await post('rep', {action: 'resend', id: refusedId});
    check([res.status, (await res.json()).error], [409, 'بيانات الطلب يعدّلها مدير الإنتاج فقط؛ التعديل لم يصل للإنتاج ولن يُعاد إرساله.'], 'production_only: its own words, no number to add');
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
    const post = (who, body) => as(who)('/api/mold-requests', {method: 'POST', body: withSignature(teamMembers.find(member => member.id === who)?.role, {requestId: crypto.randomUUID(), ...body})});
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

    // Nobody may be left to approve a team's request (production cannot give this approval): when the team's manager cannot approve it
    // now, the region's other managers do, as for a request of no team. Production's waiting list is kept a minute: an approval of an
    // order number nobody has asks for it again.
    const refresh = async () => check((await post('smE2', {action: 'approve-order', orderNo: 999999})).status, 409, 'production\'s waiting list asked for again');
    const rMoved = await ask('repD', 'e3', 'smE\'s team, before his regions changed');
    await teamApp.db.prepare("UPDATE crm_members SET region_scope='western' WHERE id='smE'").run();
    check((await as('smE')('/api/mold-requests')).status, 401, 'a change of regions ends his session');
    sessions.smE = await teamApp.login('smE');
    await refresh();
    check([(await waiting('smE2')).includes(rMoved.id), (await waiting('smE')).includes(rMoved.id), (await waiting('smW')).includes(rMoved.id)], [true, false, false], 'smE\'s regions moved to the west: his team\'s eastern request waits for the eastern manager, no longer for him');
    res = await post('smE2', {action: 'approve', id: rMoved.id}); body = await res.json();
    check([res.status, body.request.remote.waitingStep, !!teamMock.row(rMoved.id).approvals.sales], [200, 'production', true], 'and smE2 approves it');
    await teamApp.db.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='smE'").run();
    sessions.smE = await teamApp.login('smE');
    const rLeft = await ask('repE2', 'e2', 'smE2\'s team, before he left');
    await teamApp.db.prepare("UPDATE crm_members SET active=0 WHERE id='smE2'").run();
    await post('smE', {action: 'approve-order', orderNo: 999999});
    check([(await waiting('smE')).includes(rLeft.id), (await mine('smE')).includes(rLeft.id)], [true, false], 'smE2 deactivated: his team\'s request waits for smE (not in smE\'s list)');
    res = await post('smE', {action: 'approve', id: rLeft.id}); body = await res.json();
    check([res.status, body.request.remote.waitingStep, !!teamMock.row(rLeft.id).approvals.sales], [200, 'production', true], 'and smE approves it');
  } finally { await teamApp.stop(); await teamMock.stop(); }
}

// ---- 2026-11-04 (the owner: «العميل بيوقع على طلب القالب ولازم علشان يعتمد»): the customer signs a sales role's request before it is sent.
// Without a signature a representative's create is refused (fields.signature), nothing saved or sent; with it the request is stored with
// its signature file in one save, sent, then the PNG reaches production as a design file WITHOUT category; the request's sheet shows it,
// labelled, downloadable, not deletable; customer service asks without it; an older request is resent byte for byte, with no signature
// asked on resend or cancel; an edit before the first send that changes what was signed needs a new signature (the old one, never at
// production, removed), one that changes nothing keeps it; the signature takes one of the 10 design files' places; the receipt holds its
// hash, never its bytes.
{
  const signMock = await startProductsMock();
  const signApp = await bootBuiltApp({members}, {env: {YR_PRODUCTS_API_URL: signMock.url, YR_PRODUCTS_SECRET: signMock.state.secret, NODE_EXTRA_CA_CERTS: signMock.ca}});
  try {
    const sessions = {};
    for (const id of ['rep', 'sup', 'sm', 'cs', 'owner']) sessions[id] = await signApp.login(id);
    const as = id => signApp.as(sessions[id]), now = new Date().toISOString();
    for (const id of ['s1', 's2']) await signApp.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')").bind(id, JSON.stringify({name: 'مصنع ' + id, region: 'الشرقية', city: 'الدمام'}), now, now).run();
    const raw = (who, body) => as(who)('/api/mold-requests', {method: 'POST', body: {requestId: crypto.randomUUID(), ...body}});
    const ask = (who, extra = {}) => raw(who, {action: 'create', customerId: 's1', specs, payment: 'cash', ...extra});
    const callsOf = route => signMock.state.calls.filter(call => call.route === route && call.signed);
    const stored = async id => signApp.db.prepare('SELECT * FROM crm_mold_requests WHERE id=?').bind(id).first();
    const fileRow = id => signApp.db.prepare('SELECT * FROM crm_mold_design_files WHERE id=?').bind(id).first();
    const rows = async () => (await signApp.db.prepare('SELECT COUNT(*) AS n FROM crm_mold_requests').first()).n;
    const REQUIRED = 'توقيع العميل مطلوب قبل إرسال الطلب', REFRESH = REQUIRED + '؛ حدّث الصفحة لو مش ظاهر مكان التوقيع.', SIGNER = 'اكتب اسم اللي بيوقّع عن العميل (من 2 إلى 80 حرف)', BAD = 'صورة التوقيع غير صالحة؛ امسح ووقّع من جديد';

    // (a) who needs it; refused without it, nothing saved or sent
    check([(await (await as('rep')('/api/mold-requests')).json()).signatureRequired, (await (await as('sup')('/api/mold-requests')).json()).signatureRequired, (await (await as('sm')('/api/mold-requests')).json()).signatureRequired, (await (await as('cs')('/api/mold-requests')).json()).signatureRequired, (await (await as('owner')('/api/mold-requests')).json()).signatureRequired],
      [true, true, true, false, false], 'the page tells the sales roles to sign (representative, supervisor, sales manager), not customer service or the administrator');
    const sendsBefore = callsOf('requests').length;
    let res = await ask('rep'), body = await res.json();
    check([res.status, body.fields, body.error], [400, {signature: REFRESH}, REFRESH], 'a representative without the signature: 400 fields.signature (none at all, as a page loaded before sends: refresh the page)');
    res = await ask('rep', {specs: {...specs, moldWidth: 999}}); body = await res.json();
    check(Object.keys(body.fields).sort(), ['moldWidth', 'signature'], 'named with the other wrong fields at once');
    for (const [signature, fields] of [[{signer: 'م', png: signatureInput().png}, {signer: SIGNER}], [{signer: 'م. خالد', png: 'not base64!'}, {signature: BAD}], [{signer: 'م. خالد', png: signaturePng({width: 40, height: 20}).toString('base64')}, {signature: BAD}],
      [{signer: 'م. خالد', png: Buffer.from('%PDF-1.4 not an image').toString('base64')}, {signature: BAD}], [{signer: 'م. خالد'}, {signature: REQUIRED}], [{signer: '', png: ''}, {signer: SIGNER, signature: REQUIRED}], ['yes', {signer: SIGNER, signature: REQUIRED}]]) {
      res = await ask('rep', {signature}); body = await res.json();
      check([res.status, body.fields], [400, fields], 'a signature that is not one: ' + JSON.stringify(fields));
    }
    check((await as('sup')('/api/mold-requests', {method: 'POST', body: {requestId: crypto.randomUUID(), action: 'create', customerId: 's1', specs, payment: 'cash'}})).status, 400, 'the supervisor too');
    check([await rows(), callsOf('requests').length - sendsBefore], [0, 0], 'nothing saved, nothing sent');
    // the JSON route takes a signature within its cap, not a body over it
    check((await ask('rep', {signature: {signer: 'م. خالد', png: 'A'.repeat(380_000)}})).status, 413, 'a body over the route\'s 380 000 bytes: 413');

    // (b) with it: one save (request and file), the request sent, then the PNG as a design file without category
    const key = crypto.randomUUID(), signature = signatureInput('م. خالد العتيبي'), png = Buffer.from(signature.png, 'base64');
    const once = {requestId: key, action: 'create', customerId: 's1', specs, payment: 'cash', signature};
    res = await as('rep')('/api/mold-requests', {method: 'POST', body: once}); body = await res.json();
    const signed = body.request, fileId = 'mds-' + key;
    check([res.status, body.send.kind, signed.signature.signer, signed.signature.fileId, signed.signature.href, signed.signature.state], [200, 'ok', 'م. خالد العتيبي', fileId, '/api/mold-requests/design-file?id=' + signed.id + '&file=' + fileId, 'sent'], 'saved and sent; the request names its signature, delivered to production');
    const data = JSON.parse((await stored(signed.id)).data), file = await fileRow(fileId);
    check([data.signature.signer, data.signature.fileId, /^\d{4}-\d{2}-\d{2}T/.test(data.signature.signedAt), file.name, file.kind, file.category, file.content_type, file.size, file.member_id], ['م. خالد العتيبي', fileId, true, 'توقيع العميل - م. خالد العتيبي.png', 'image', 'design', 'image/png', png.length, 'rep'], 'stored: data.signature, and the PNG as one of its design files');
    const sentBody = callsOf('requests').findLast(call => call.body.includes(signed.id)).body;
    check([Object.keys(JSON.parse(sentBody)), sentBody.includes('mds-') || sentBody.includes('signature') || sentBody.includes('توقيع')], [['crmRequestId', 'requestedAt', 'customer', 'salesman', 'specs', 'payment'], false], 'the requests body carries nothing of it');
    const lines = callsOf('design-files').filter(call => call.body.includes(signed.id));
    check([lines.length, JSON.parse(lines[0].body), signMock.state.calls.findIndex(call => call.route === 'requests' && call.body.includes(signed.id)) < signMock.state.calls.indexOf(lines[0])], [1, {crmRequestId: signed.id, crmFileId: fileId, name: 'توقيع العميل - م. خالد العتيبي.png'}, true], 'then the signature, with design-files, without category, after the request');
    const atProduction = signMock.row(signed.id).designFiles;
    check([atProduction.length, atProduction[0].kind, atProduction[0].category || 'design', Buffer.compare(atProduction[0].bytes, png), file.sent_at !== null || !!(await fileRow(fileId)).sent_at], [1, 'image', 'design', 0, true], 'production holds it as a design image, the same bytes');
    // the same tap again: the saved answer, one request, one file; the receipt holds the PNG's hash, never its bytes
    const filesBefore = callsOf('design-files').length;
    body = await (await as('rep')('/api/mold-requests', {method: 'POST', body: once})).json();
    check([body.request.id, await rows(), callsOf('design-files').length - filesBefore, (await signApp.db.prepare("SELECT COUNT(*) AS n FROM crm_mold_design_files WHERE id LIKE 'mds-%'").first()).n], [signed.id, 1, 0, 1], 'the same tap twice: one request, one signature');
    check((await as('rep')('/api/mold-requests', {method: 'POST', body: {...once, signature: signatureInput('م. خالد العتيبي', {seed: 2})}})).status, 409, 'the same receipt with another drawing: 409');
    const audits = (await signApp.db.prepare('SELECT detail FROM crm_audit WHERE record_id=?').bind(signed.id).all()).results.map(row => row.detail).join('\n');
    check([audits.includes(signature.png.slice(0, 40)), audits.includes('م. خالد العتيبي'), audits.includes(fileId)], [false, true, true], 'audited by who signed and the file, never the image');

    // (c) the sheet: the signature listed and labelled, downloadable, not deletable
    const sheet = (await (await as('rep')('/api/mold-requests?id=' + signed.id)).json()).requests[0];
    check([sheet.signature.signer, sheet.designFiles.map(entry => [entry.crmFileId, entry.signature, entry.canDelete, entry.state, entry.kind])], ['م. خالد العتيبي', [[fileId, true, false, 'sent', 'image']]], 'the sheet: signed by, and the file labelled as the signature, not deletable');
    res = await as('rep')(sheet.signature.href + '&inline=1');
    check([res.status, res.headers['content-type'], res.headers['content-disposition'].split(';')[0], Buffer.compare(res.bytes, png)], [200, 'image/png', 'inline', 0], 'its image through the CRM\'s download route');
    for (const who of ['sup', 'sm', 'owner']) check((await as(who)(sheet.signature.href + '&inline=1')).status, 200, who + ' reads the request, so the signature');
    res = await as('rep')('/api/mold-requests/design-files/delete', {method: 'POST', body: {requestId: crypto.randomUUID(), id: signed.id, fileId}}); body = await res.json();
    check([res.status, body.error, (await fileRow(fileId)).deleted_at, callsOf('design-file-delete').length], [409, 'توقيع العميل ما بيتحذفش من الطلب؛ لو اتغيّرت بيانات الطلب قبل إرساله بيوقّع العميل من جديد.', null, 0], 'the delete route refuses it: kept here and at production');
    // the sales manager's waiting list says so, and labels the image among the design files
    const waitingItem = (await (await as('sm')('/api/mold-requests')).json()).pending.items.find(item => item.crmRequestId === signed.id);
    check([waitingItem.signature.signer, waitingItem.signatureDelivered, waitingItem.designFiles.map(entry => [entry.crmFileId, entry.signature, entry.kind])], ['م. خالد العتيبي', true, [[fileId, true, 'image']]], '«طلبات بانتظار اعتمادي»: signed by the customer (production\'s listing holds the image), the signature labelled');
    res = await as('sm')(waitingItem.designFiles[0].href + '&inline=1');
    check([res.status, Buffer.compare(res.bytes, png)], [200, 0], 'the sales manager opens it by order number');

    // (d) customer service and the administrator ask without it (one they send is taken the same way)
    res = await raw('cs', {action: 'create', customerId: 's1', specs: {...specs, description: 'customer service'}, payment: 'cash'}); body = await res.json();
    check([res.status, body.send.kind, body.request.signature, body.request.designFiles, Object.hasOwn(JSON.parse((await stored(body.request.id)).data), 'signature')], [200, 'ok', null, [], false], 'customer service: no signature asked, none stored');
    res = await raw('owner', {action: 'create', customerId: 's2', specs: {...specs, description: 'the administrator, signed'}, payment: 'cash', signature: signatureInput('عميل الإدارة')}); body = await res.json();
    check([res.status, body.request.signature.signer, body.request.designFiles.length], [200, 'عميل الإدارة', 1], 'the administrator may send one: taken the same way');

    // (e) an older request (before this release: no signature) is resent byte for byte; no signature asked on resend or cancel
    const old = 'mr-' + crypto.randomUUID(), crmNumber = (await signApp.db.prepare("SELECT number FROM crm_customer_numbers WHERE customer_id='s1'").first()).number;
    const oldData = {requestedAt: '2026-11-03T09:00:00+03:00', customer: {crmNumber, name: 'مصنع s1', address: '', city: 'Damam - الدمام'}, salesman: {crmMemberId: 'rep', name: 'أحمد عبد العزيز', email: 'rep@yourrest.org'}, specs: {...specs, designUrl: ''}, payment: 'cash'};
    await signApp.db.prepare("INSERT INTO crm_mold_requests(id,member_id,customer_id,data,outbox,attempts,first_failed_at,next_attempt_at,last_attempt_at,last_error,created_by,created_at,updated_at,version) VALUES(?,'rep','s1',?,'send',1,?,NULL,?,?,'rep',?,?,1)")
      .bind(old, JSON.stringify(oldData), now, now, JSON.stringify({code: 'network', http: 0, at: now}), now, now).run();
    res = await raw('rep', {action: 'resend', id: old}); body = await res.json();
    const resent = callsOf('requests').findLast(call => call.body.includes(old)).body;
    check([res.status, body.send.kind, body.request.signature, resent], [200, 'ok', null, JSON.stringify({crmRequestId: old, requestedAt: oldData.requestedAt, customer: {crmNumber, name: 'مصنع s1', city: 'Damam - الدمام'}, salesman: {crmMemberId: 'rep', name: 'أحمد عبد العزيز', email: 'rep@yourrest.org'}, specs: {description: specs.description, core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: 'YR099-9', quantity: 1, notes: 'أول طلب'}, payment: 'cash'})],
      'an older request: resent without a signature asked, its body exactly as before');
    check((await raw('rep', {action: 'cancel', id: old, version: (await stored(old)).version, reason: 'تجربة'})).status, 200, 'and cancelled without one');
    check((await raw('rep', {action: 'resend', id: signed.id})).status, 409, 'a signed request with nothing waiting: resend as before (nothing to send)');

    // (f) an edit before the first send: what was signed changed -> sign again (the old signature, never at production, removed); nothing
    // changed -> kept. Production refuses at its door (503 not_configured), so the request has certainly never reached it.
    signMock.state.notConfigured = true;
    res = await ask('rep', {customerId: 's2', specs: {...specs, description: 'edit before sending'}, signature: signatureInput('م. سالم')}); body = await res.json();
    const draft = body.request, firstSignature = draft.signature.fileId;
    check([body.send.kind, draft.can.edit, draft.designFiles.map(entry => [entry.signature, entry.state]), draft.signature.state], ['retry', true, [[true, 'held']], 'waiting'], 'not at production yet: editable, its signature held until the request is (said as not delivered yet)');
    const edit = (change, extra = {}) => raw('rep', {action: 'update', id: draft.id, version: change.version, specs: {...specs, description: 'edit before sending', ...change.specs}, payment: change.payment || 'cash', ...extra});
    let version = (await stored(draft.id)).version;
    res = await edit({version}); body = await res.json();
    check([res.status, body.request.signature.fileId, body.request.version], [200, firstSignature, version], 'an edit that changes nothing: kept as it is, its signature too');
    res = await edit({version, specs: {quantity: 3}}); body = await res.json();
    check([res.status, body.fields], [400, {signature: REFRESH}], 'the quantity changed: the customer signs again');
    res = await edit({version, payment: 'deferred'}); body = await res.json();
    check([res.status, body.fields], [400, {signature: REFRESH}], 'the payment changed: the same');
    res = await edit({version, specs: {quantity: 3}}, {signature: signatureInput('م. سالم', {seed: 3})}); body = await res.json();
    const secondSignature = body.request.signature?.fileId;
    check([res.status, !!secondSignature && secondSignature !== firstSignature, body.request.specs.quantity, body.request.designFiles.map(entry => [entry.crmFileId, entry.signature])], [200, true, 3, [[secondSignature, true]]], 'signed again: the new signature replaces the old');
    const removed = await fileRow(firstSignature);
    check([removed.deleted_at !== null, removed.object_key, removed.outbox, JSON.parse((await stored(draft.id)).data).signature.fileId], [true, null, null, secondSignature], 'the old one (never at production) removed in the CRM, its bytes gone; the data names the new one');
    // The editor's role changed since (a representative made administrator): a request the customer signed still needs a new signature
    // for changed data; it is never sent changed and unsigned.
    await signApp.db.prepare("UPDATE crm_members SET role='admin' WHERE id='rep'").run(); sessions.rep = await signApp.login('rep');
    version = (await stored(draft.id)).version;
    res = await edit({version, specs: {quantity: 5}}); body = await res.json();
    check([res.status, body.fields, JSON.parse((await stored(draft.id)).data).specs.quantity], [400, {signature: REFRESH}, 3], 'another role now: still refused without a new signature, nothing changed');
    await signApp.db.prepare("UPDATE crm_members SET role='rep' WHERE id='rep'").run(); sessions.rep = await signApp.login('rep');
    // production takes it now: the request, then only the new signature
    signMock.state.notConfigured = false;
    res = await raw('rep', {action: 'resend', id: draft.id}); body = await res.json();
    for (let n = 0; n < 50 && !(await fileRow(secondSignature)).sent_at; n++) { await as('rep')('/api/mold-requests'); await new Promise(resolve => setTimeout(resolve, 100)); }
    check([body.send.kind, signMock.row(draft.id).designFiles.map(entry => entry.crmFileId), JSON.parse(callsOf('requests').findLast(call => call.body.includes(draft.id)).body).specs.quantity], ['ok', [secondSignature], 3], 'resent: production holds the request as edited and the new signature only');

    // (g) the 10 places: an older request never sent, with 10 design files, cannot take a signature without a place
    signMock.state.notConfigured = true;
    const full = 'mr-' + crypto.randomUUID();
    await signApp.db.prepare("INSERT INTO crm_mold_requests(id,member_id,customer_id,data,outbox,next_attempt_at,created_by,created_at,updated_at,version) VALUES(?,'rep','s1',?,'send',NULL,'rep',?,?,1)").bind(full, JSON.stringify({...oldData, requestedAt: '2026-11-03T10:00:00+03:00'}), now, now).run();
    for (let n = 1; n <= 10; n++) await signApp.db.prepare("INSERT INTO crm_mold_design_files(id,request_id,member_id,name,kind,content_type,size,sha256,object_key,created_at,outbox,next_attempt_at,version,category) VALUES(?,?,'rep',?,'pdf','application/pdf',10,'x',NULL,?,'send',?,1,'design')").bind('mdf-full-' + n, full, 'ملف ' + n + '.pdf', now, now).run();
    res = await raw('rep', {action: 'update', id: full, version: 1, specs: {...specs, quantity: 2}, payment: 'cash', signature: signatureInput('م. سالم')}); body = await res.json();
    check([res.status, body.error, JSON.parse((await stored(full)).data).specs.quantity], [409, 'الطلب فيه 10 ملفات تصميم؛ احذف ملف عشان يتسع لتوقيع العميل.', 1], 'ten design files already: refused, said why, nothing changed');
    // An old signature refused for good takes none of the places, so it frees none: 10 live files and such a signature leave no room.
    const refusedOld = 'mr-' + crypto.randomUUID();
    await signApp.db.prepare("INSERT INTO crm_mold_requests(id,member_id,customer_id,data,outbox,next_attempt_at,created_by,created_at,updated_at,version) VALUES(?,'rep','s1',?,'send',NULL,'rep',?,?,1)").bind(refusedOld, JSON.stringify({...oldData, requestedAt: '2026-11-03T11:00:00+03:00', signature: {signer: 'م. قديم', signedAt: now, fileId: 'mds-refused-old'}}), now, now).run();
    await signApp.db.prepare("INSERT INTO crm_mold_design_files(id,request_id,member_id,name,kind,content_type,size,sha256,object_key,created_at,outbox,next_attempt_at,last_attempt_at,last_error,attempts,version,category) VALUES('mds-refused-old',?,'rep','توقيع العميل - م. قديم.png','image','image/png',10,'x',NULL,?,'send',NULL,?,?,1,1,'design')").bind(refusedOld, now, now, JSON.stringify({code: 'invalid_payload', http: 400, at: now, final: true})).run();
    for (let n = 1; n <= 10; n++) await signApp.db.prepare("INSERT INTO crm_mold_design_files(id,request_id,member_id,name,kind,content_type,size,sha256,object_key,created_at,outbox,next_attempt_at,version,category) VALUES(?,?,'rep',?,'pdf','application/pdf',10,'x',NULL,?,'send',?,1,'design')").bind('mdf-ro-' + n, refusedOld, 'ملف ' + n + '.pdf', now, now).run();
    check((await (await as('rep')('/api/mold-requests?id=' + refusedOld)).json()).requests[0].signature.state, 'refused', 'a signature refused for good: said so on the request');
    res = await raw('rep', {action: 'update', id: refusedOld, version: 1, specs: {...specs, quantity: 2}, payment: 'cash', signature: signatureInput('م. سالم')}); body = await res.json();
    check([res.status, body.error], [409, 'الطلب فيه 10 ملفات تصميم؛ احذف ملف عشان يتسع لتوقيع العميل.'], 'ten live files and a refused old signature: no room (the refused one frees none)');
    await signApp.db.prepare("UPDATE crm_mold_design_files SET deleted_at=?,outbox=NULL WHERE id='mdf-ro-10'").bind(now).run();
    res = await raw('rep', {action: 'update', id: refusedOld, version: 1, specs: {...specs, quantity: 2}, payment: 'cash', signature: signatureInput('م. سالم')}); body = await res.json();
    check([res.status, body.request.designFiles.filter(entry => entry.category === 'design').length, (await fileRow('mds-refused-old')).deleted_at !== null], [200, 10, true], 'nine live files: the new signature takes the tenth place, the refused one removed');
    // «nothing changed» is decided on the validated specifications with their keys in one order: an older row stored in another order
    const reordered = 'mr-' + crypto.randomUUID(), looseSpecs = {quantity: 1, notes: 'أول طلب', moldNo: 'YR099-9', designUrl: '', gelbaSize: 795, moldWidth: 1380, halfBlock: 'none', model: 'old', vibrators: 2, core: 'open', description: specs.description};
    await signApp.db.prepare("INSERT INTO crm_mold_requests(id,member_id,customer_id,data,outbox,next_attempt_at,created_by,created_at,updated_at,version) VALUES(?,'rep','s1',?,'send',NULL,'rep',?,?,1)").bind(reordered, JSON.stringify({...oldData, requestedAt: '2026-11-03T12:00:00+03:00', specs: looseSpecs}), now, now).run();
    res = await raw('rep', {action: 'update', id: reordered, version: 1, specs, payment: 'cash'}); body = await res.json();
    check([res.status, body.request.version, JSON.parse((await stored(reordered)).data).specs], [200, 1, looseSpecs], 'a no-op edit of an older row stored in another key order: nothing changed, no signature asked');
    signMock.state.notConfigured = false;
    // Production refuses the signature's image for good: the request says so; the sales manager's list does not call it signed
    signMock.answerNext('design-files', 400, {error: {code: 'invalid_payload', message: 'x', fields: ['file'], details: {reason: 'bad_image'}}});
    res = await ask('rep', {customerId: 's2', specs: {...specs, description: 'signature refused there'}, signature: signatureInput('م. مرفوض')}); body = await res.json();
    check([res.status, body.request.signature.state, body.request.designFiles[0].state], [200, 'refused', 'rejected'], 'the image refused by production: the request says the signature did not arrive');
    const refusedItem = (await (await as('sm')('/api/mold-requests')).json()).pending.items.find(item => item.crmRequestId === body.request.id);
    check([refusedItem.signature.signer, refusedItem.signatureDelivered, refusedItem.designFiles.some(entry => entry.signature)], ['م. مرفوض', false, false], '«طلبات بانتظار اعتمادي»: not said signed while production\'s listing lacks the image');
    ok(signMock.state.calls.every(call => !JSON.stringify(call.headers).includes(signMock.state.secret)) && !signApp.log().includes(signMock.state.secret), 'the secret never travels or is logged');
  } finally { await signApp.stop(); await signMock.stop(); }
}

console.log(JSON.stringify({ok: true, checks, builtRelease: true, realProductionTested: false}));
