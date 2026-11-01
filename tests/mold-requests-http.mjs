// Mold manufacturing requests over real HTTP against the BUILT release (run `pnpm build` first), sending to a stand-in production API
// (scripts/lib/products-mock.mjs, HTTPS with a throwaway CA) that checks the signature and fields as the PHP does: a representative
// asks for a mold for a customer of their own region, it is saved then signed and sent with the customer's Yourrest number; who sees
// and who may change it; a repeated tap; edits while received; production starting first (409, the edit withdrawn); cancelling;
// production unreachable (kept waiting on the §6 timetable, resend, the last known status with its reason); production without its
// secret; a release without the link settings (sending off, the rest of the CRM unaffected); the secret never in a page or answer.
// Since 2026-11-01: every role asks (customer service from its branch's customers), and the sales manager alone approves a request
// waiting for them, or withdraws the approval until production approves (production's approval route, the approval chain).
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
  const create = (who, customerId, extra = {}) => post(who, {action: 'create', customerId, specs: {...specs, ...extra}});
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
  check(sent.customer, {crmNumber: await number('east1'), name: 'مصنع east1', address: 'حي الصناعية', city: 'الدمام'}, 'the customer by its Yourrest number, never its ERP code, phone or email');
  check(sent.salesman, {crmMemberId: 'rep', name: 'أحمد عبد العزيز', email: 'rep@yourrest.org'}, 'the representative');
  ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+03:00$/.test(sent.requestedAt), 'requestedAt in Riyadh time with its offset');
  ok(mock.state.calls.every(call => call.signed || call.route === ''), 'every call was signed with the shared secret');
  check((await app.db.prepare("SELECT COUNT(*) AS n FROM crm_audit WHERE record_id=? AND action='mold-request:create'").bind(first).first()).n, 1, 'audited');

  // ---- what may not be asked
  check((await create('rep', 'west1')).status, 404, 'a customer outside the representative\'s region: 404');
  res = await create('rep', 'east1', {moldWidth: 999, core: 'half', designUrl: 'http://x'});
  body = await res.json();
  check([res.status, Object.keys(body.fields).sort()], [400, ['core', 'designUrl', 'moldWidth']], 'wrong fields: 400 naming each one');
  const requestId = crypto.randomUUID(), once = {action: 'create', customerId: 'east2', specs, requestId};
  const before = calls('requests');
  const firstTap = await (await as('rep')('/api/mold-requests', {method: 'POST', body: once})).json();
  const secondTap = await (await as('rep')('/api/mold-requests', {method: 'POST', body: once})).json();
  check([secondTap.request.id, calls('requests') - before], [firstTap.request.id, 1], 'the same tap twice: one request, sent once');
  check((await as('rep')('/api/mold-requests', {method: 'POST', body: {...once, specs: {...specs, quantity: 4}}})).status, 409, 'the same receipt with other data: 409');

  // ---- who sees it
  const ids = async who => (await list(who)).requests.map(item => item.id).sort();
  check(await ids('rep2'), [], 'another representative: none');
  check([(await ids('sup')).length, (await ids('sm')).length, (await ids('owner')).length, (await ids('sup2')).length], [2, 2, 2, 0], 'his supervisor, the manager and the administrator: both; another supervisor: none');
  check((await post('sup', {action: 'update', id: first, version: 1, specs})).status, 403, 'only the representative who asked may change it');

  // ---- an edit while received
  res = await post('rep', {action: 'update', id: first, version: 1, specs: {...specs, quantity: 2}});
  body = await res.json();
  check([res.status, body.request.specs.quantity, body.request.remote.revision, body.request.sending.state], [200, 2, 2, 'sent'], 'the edit reaches production: revision 2');

  // ---- production starts: the status is pulled once when the list opens
  mock.produce(first, {stages: ['laserCutting', 'box'], moldSerial: '093', productionDate: '2026-11-01'});
  await age(first);
  const statusCalls = calls('status');
  const opened = (await list('rep')).requests.find(item => item.id === first);
  check([calls('status') - statusCalls, opened.remote.status, opened.remote.stagesDone, opened.remote.moldSerial, opened.remote.stages.box, opened.editable, opened.can], [1, 'in_production', 2, '093', {done: true, at: '2026-11-02'}, false, {edit: false, cancel: false, resend: false, approve: false, withdraw: false}], 'one status call; stages with dates, the serial; edit and cancel closed');
  await list('rep');
  check(calls('status') - statusCalls, 1, 'opened again within a minute: the stored status, no new call');
  res = await post('rep', {action: 'update', id: first, version: (await stored(first)).version, specs: {...specs, quantity: 3}});
  check(res.status, 409, 'the CRM itself refuses an edit once production has started');

  // ---- production starts before the CRM knows: the edit comes back 409 and is withdrawn
  const second = (await (await create('rep', 'east2', {description: 'second mold'})).json()).request;
  mock.produce(second.id, {stages: ['laserCutting']});
  res = await post('rep', {action: 'update', id: second.id, version: second.version, specs: {...specs, description: 'second mold', quantity: 7}});
  body = await res.json();
  check([res.status, body.request.specs.quantity, body.request.remote.status, body.request.editable, body.request.sending.error.code], [409, 1, 'in_production', false, 'request_locked'], '409: the edit is withdrawn, the request shows what production holds');
  ok(/بدأ الإنتاج/.test(body.error), 'with a clear message');

  // ---- cancelling while received
  const third = (await (await create('rep', 'east1', {description: 'third mold'})).json()).request;
  res = await post('rep', {action: 'cancel', id: third.id, version: third.version, reason: 'العميل أجّل'});
  body = await res.json();
  check([res.status, body.request.cancelled, body.request.remote.status, body.request.can.edit], [200, true, 'cancelled', false], 'cancelled in production too');
  check((await post('rep', {action: 'cancel', id: third.id, version: body.request.version, reason: ''})).status, 409, 'cancelled already');

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
  body = await (await post('rep', {action: 'update', id: fourth.id, version: fourth.version, specs: {...specs, description: 'fourth mold', quantity: 5}})).json();
  check([body.request.remote.waitingStep, body.request.remote.approvals.sales, body.request.can.edit], ['sales', null, true], 'an edit while received undoes the approvals: back to the sales manager');
  await post('sm', {action: 'approve', id: fourth.id});
  mock.approve(fourth.id, 'production');
  res = await post('sm', {action: 'withdraw', id: fourth.id});
  body = await res.json();
  check([res.status, body.request.remote.waitingStep, body.request.can.withdraw], [409, 'admin', false], 'production approved first: the withdrawal is refused and the request shows where it waits');
  ok(/اعتمد الإنتاج/.test(body.error), 'with a clear message');
  mock.approve(fourth.id, 'admin');
  await age(fourth.id);
  const approved = (await list('rep')).requests.find(item => item.id === fourth.id);
  check([approved.remote.status, approved.remote.waitingStep, approved.editable, approved.can.edit], ['confirmed', 'manufacturing', false, false], 'all three approvals: confirmed, in manufacturing, no more changes');
  ok(/^\d{4}-\d{2}-\d{2}T/.test(approved.remote.waitingSince), 'since when it waits');

  // ---- everyone asks: customer service from its branch's customers, a supervisor, the administrator
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('other1','customer',NULL,'rep2','فرع آخر',?,?,?,1,'fixture')").bind(JSON.stringify({name: 'مصنع other1', region: 'الشرقية', city: 'الخبر'}), now, now).run();
  res = await create('cs', 'west1', {halfBlock: 'three'});
  body = await res.json();
  check([res.status, body.request.memberId, body.request.can.edit], [200, 'cs', true], 'customer service asks for a customer of its branch');
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
  check([body.request.sending.state, body.request.sending.error.code], ['waiting', 'not_configured'], 'production without its secret (503): kept waiting');
  mock.state.notConfigured = false;
  body = await (await post('rep', {action: 'resend', id: body.request.id})).json();
  check(body.request.sending.state, 'sent', 'resend once it is set');

  // ---- the secret never leaves the server
  for (const who of ['rep', 'owner']) {
    const page = await as(who)('/'), answer = await get(who);
    ok(!page.text.includes(mock.state.secret) && !answer.text.includes(mock.state.secret) && !answer.text.includes('YR_PRODUCTS'), 'not in a page or an answer: ' + who);
  }
  ok(!app.log().includes(mock.state.secret), 'not in the server log');
} finally { await app.stop(); }

// ---- a release without the link settings: sending is off, the CRM works
const plain = await bootBuiltApp({members}, {env: {NODE_EXTRA_CA_CERTS: mock.ca}});
try {
  const session = await plain.login('rep'), as = plain.as(session), now = new Date().toISOString();
  await plain.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('e1','customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')").bind(JSON.stringify({name: 'مصنع e1', region: 'الشرقية', city: 'الدمام'}), now, now).run();
  const calls = mock.state.calls.length;
  const listed = (await as('/api/mold-requests')).json();
  check([listed.linkReady, listed.linkProblem], [false, 'not_configured'], 'the screen says the link is off');
  const created = await (await as('/api/mold-requests', {method: 'POST', body: {action: 'create', requestId: crypto.randomUUID(), customerId: 'e1', specs}})).json();
  check([created.request.sending.state, created.send.kind], ['off', 'off'], 'a request is still saved, waiting while the link is off');
  check((await as('/api/mold-requests', {method: 'POST', body: {action: 'resend', requestId: crypto.randomUUID(), id: created.request.id}})).status, 503, 'resend says the link is off');
  check([(await as('/api/crm')).status, mock.state.calls.length - calls], [200, 0], 'the rest of the CRM works; nothing was sent');
} finally { await plain.stop(); await mock.stop(); }

console.log(JSON.stringify({ok: true, checks, builtRelease: true, realProductionTested: false}));
