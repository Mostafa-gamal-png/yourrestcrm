// The read-only check of the production link (scripts/diagnose/mold-products.cjs) as the hosting account runs it: a child process with
// only HOME and PATH (no YR_* variable, no proxy), the live release's operations files beside settings.cjs, a database built from every
// migration and kept in WAL mode as the live app keeps it, and the stand-in production API seeded with CRM requests at different steps
// (one approved by the sales manager, one in production, one cancelled, one historical, one the CRM saved but production never accepted,
// 200 more to need a second status call), one from another CRM and one registered in production. It checks the counts, the order of the
// pending list, the requests whose stored status is out of date, the verdict and the exit code; that only the pending and status routes
// were called; that the databases and the folders are unchanged (no -wal or -shm left beside a stopped app's database, and none written
// while the app has it open); and that the output holds no secret, address, name, email, request id, order or Yourrest number.
// Then the edges: a pending list at production's limit of 500, a CRM with no accepted request (no status call), an accepted id production
// would refuse. Then what fails: production down, not configured (with its clock read from the Date header, 400 s ahead and 100 s
// behind), answers outside the contract (an unknown code holding a number, an HTML page), a clock more than 300 s off, a list out of
// order, a link not configured, a settings.cjs broken by hand (the secret without its quotes, a call, a syntax error, a thrown error), a
// stray YR_* variable, a release without the client. Synthetic data only; nothing leaves 127.0.0.1.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';
import {callProducts, moldConfig} from '../portable/mold-client.mjs';
import {moldRequestBody, moldStatusObject, riyadhIso} from '../portable/mold-rules.mjs';

process.umask(0o077); // the account's private data: folders 0700, files 0600, as the settings check wants
const root = path.resolve(import.meta.dirname, '..');
const script = path.join(root, 'scripts', 'diagnose', 'mold-products.cjs');
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

// ---- the stand-in production API, with a clock the setup can move (both sides of a signed call read it)
const secret = 'diag-secret-' + randomBytes(24).toString('hex');
/** A secret as it could be pasted into settings.cjs without its quotes: hex that starts with a letter reads as a name there. */
const bareSecret = 'deadbeef' + randomBytes(28).toString('hex');
let shift = 0;
const clock = () => Date.now() + shift;
const mock = await startProductsMock({secret, now: clock});
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-mold-products-'));
process.on('exit', () => fs.rmSync(work, {recursive: true, force: true}));

// ---- production's answers changed for a run (the mock runs in this process): the Date header moved, as a production clock that is
// off would send it, or the whole answer replaced by one outside the contract.
const answers = {dateShiftMs: 0, replace: null};
const {writeHead, end} = http.ServerResponse.prototype;
http.ServerResponse.prototype.writeHead = function (code, ...rest) {
  if (answers.dateShiftMs) this.setHeader('Date', new Date(Date.now() + answers.dateShiftMs).toUTCString());
  if (!answers.replace) return writeHead.call(this, code, ...rest);
  this.replacedBody = answers.replace.body;
  return writeHead.call(this, answers.replace.http, {'Content-Type': answers.replace.type});
};
http.ServerResponse.prototype.end = function (chunk, ...rest) { return end.call(this, this.replacedBody ?? chunk, ...rest); };

/** The test's own calls (setup only), trusting the mock's certificate. */
function fetchWith(caFile) {
  const authority = fs.readFileSync(caFile);
  return (url, init) => new Promise((resolve, reject) => {
    const req = httpsRequest(url, {method: init.method, headers: init.headers, ca: authority, signal: init.signal}, res => {
      const parts = []; res.on('data', part => parts.push(part)); res.on('end', () => { const bytes = Buffer.concat(parts); resolve({status: res.statusCode, arrayBuffer: async () => bytes}); });
    });
    req.on('error', reject);
    req.end(init.body);
  });
}
const setupFetch = fetchWith(mock.ca), setupLink = moldConfig({YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: secret});
const setupCall = async (route, body) => { const answer = await callProducts(setupLink, route, body, {fetch: setupFetch, now: clock}); assert.equal(answer.kind, 'ok', route + ' (setup): ' + answer.code); return answer; };

// ---- a hosting account
const home = path.join(work, 'host'), app = path.join(home, 'yourrest-crm'), data = path.join(home, 'yourrest-crm-data'), ops = path.join(app, 'release', 'operations');
fs.mkdirSync(ops, {recursive: true, mode: 0o700}); fs.mkdirSync(path.join(data, 'objects'), {recursive: true, mode: 0o700}); fs.chmodSync(data, 0o700);
// MOLD_DIAG_TEST_OPS=<folder> runs the same checks on another copy of the release's operations files (the one live on the account).
for (const file of ['mold-client.mjs', 'mold-rules.mjs', 'config.cjs']) fs.copyFileSync(path.join(process.env.MOLD_DIAG_TEST_OPS || path.join(root, 'portable'), file), path.join(ops, file));
const database = path.join(data, 'database.sqlite');
const base = {YR_APP_ORIGIN: 'https://crm.example.org', YR_AUTH_SECRET: 'a'.repeat(64), YR_DATABASE_PATH: database, YR_OBJECTS_PATH: path.join(data, 'objects'), YR_MAIL_TRANSPORT: 'sendmail', YR_MAIL_FROM: 'noreply@yourrest.org', YR_SENDMAIL_PATH: '/usr/sbin/sendmail'};
const writeSettings = (folder, values) => fs.writeFileSync(path.join(folder, 'settings.cjs'), 'module.exports = ' + JSON.stringify(values) + ';\n', {mode: 0o600});
const settings = extra => writeSettings(app, {...base, ...extra});
settings({YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: secret});

// ---- a second, small CRM on the same account (MOLD_DIAG_APP): one request it saved, none production accepted yet
const small = path.join(home, 'small-crm'), smallData = path.join(home, 'small-crm-data'), smallDatabase = path.join(smallData, 'database.sqlite');
fs.mkdirSync(path.join(small, 'release', 'operations'), {recursive: true}); fs.mkdirSync(path.join(smallData, 'objects'), {recursive: true});
for (const file of ['mold-client.mjs', 'mold-rules.mjs', 'config.cjs']) fs.copyFileSync(path.join(ops, file), path.join(small, 'release', 'operations', file));
writeSettings(small, {...base, YR_DATABASE_PATH: smallDatabase, YR_OBJECTS_PATH: path.join(smallData, 'objects'), YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: secret});

// ---- production: CRM requests at every step, ids, order and Yourrest numbers that cannot appear by chance in a report
const ID = {own: 'mrq7own-waiting-k2v', approved: 'mrq7own-approved-p4n', cancelled: 'mrq7own-cancelled-c8d', making: 'mrq7own-making-m3t', historical: 'mrq7own-history-h5w',
  unknown: 'mrq7own-unknown-u6z', unsent: 'mrq7own-unsent-o9y', elsewhere: 'mrq7other-crm-x1q', smallUnsent: 'mrq7small-unsent-s1j', smallBad: 'mrq7small.bad-id', held: 'mrq7own-held-f4q'};
const FILLERS = Array.from({length: 200}, (_, n) => 'mrq7fill-' + String(n).padStart(3, '0') + '-f');
mock.state.nextOrder = 873101;
mock.seedLegacy(1);
const legacy = mock.state.byOrder.get(1);
mock.state.byOrder.delete(1); legacy.orderNo = 999001; mock.state.byOrder.set(999001, legacy);
const salesman = {crmMemberId: 'rep-secret-member-1', name: 'مندوب سري جدا', email: 'rep.secret@yourrest.org'};
const specs = {description: '200*400*27.5TH MM OPEN', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, quantity: 1};
let customers = 0;
const crmData = new Map(), created = new Map();
const send = async (id, minutesAgo, extra = {}) => {
  shift = -minutesAgo * 60_000;
  const customer = {crmNumber: 554401 + customers++, name: 'عميل سري ' + customers, address: 'حي سري', city: 'الدمام'};
  const body = moldRequestBody({id, requestedAt: riyadhIso(clock()), customer, salesman, specs, ...extra});
  const answer = await setupCall('requests', body);
  crmData.set(id, {requestedAt: body.requestedAt, customer, salesman, specs});
  created.set(id, moldStatusObject(answer.json.request));
};
await send(ID.own, 3 * 24 * 60);
await send(ID.unsent, 31 * 60); // over a day but under two: tells the 24-hour count from a 48-hour one
await send(ID.approved, 30 * 60);
await send(ID.cancelled, 29 * 60);
await send(ID.making, 28 * 60);
await send(ID.historical, 27 * 60, {legacyOrderNo: 999001});
for (const id of FILLERS) await send(id, 20);
await send(ID.elsewhere, 60);
shift = -30 * 60_000;
mock.registerManual({customerNo: 554499, customerName: 'مصنع سري مسجل في الإنتاج', salesmanName: 'مندوب سري آخر', createdBy: 'staff.secret@yourrest.org'});
shift = 0;
for (const id of FILLERS) mock.approve(id, 'sales');
const filled = await setupCall('status', {ids: FILLERS});
const latest = new Map(filled.json.requests.map(item => { const status = moldStatusObject(item); return [status.crmRequestId, status]; }));
// After the CRM last pulled: the sales manager approved one, one was cancelled, one went into production.
mock.approve(ID.approved, 'sales');
await setupCall('cancel', {crmRequestId: ID.cancelled, reason: ''});
mock.produce(ID.making, {stages: ['laserCutting', 'box']});

// ---- the CRM's databases: what each last stored, some of it out of date by now. Built from every migration and left in WAL mode, as
// the live app keeps it (portable/storage.mjs); the last connection's close takes the -wal and -shm away, as when the app stops.
const INSERT = `INSERT INTO crm_mold_requests(id,member_id,customer_id,legacy_order_no,data,accepted,cancelled_at,outbox,next_attempt_at,remote,remote_at,created_by,created_at,updated_at)
  VALUES(?,'rep-secret-member-1',?,?,?,?,?,?,?,?,?,'rep-secret-member-1',?,?)`;
const migrated = file => {
  const db = new DatabaseSync(file);
  for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter(item => item.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8'));
  return db;
};
const closeAsTheApp = (db, file) => { db.exec('PRAGMA journal_mode=WAL'); db.close(); fs.chmodSync(file, 0o600); };
const db = migrated(database), insert = db.prepare(INSERT);
let order = 0, newestPull = null;
const row = (id, {accepted = true, cancelledAt = null, outbox = null, remote = created.get(id) ?? null, legacyOrderNo = null, into = insert} = {}) => {
  const at = new Date(Date.parse('2026-10-01T08:00:00Z') + order++ * 60_000).toISOString(), payload = JSON.stringify(crmData.get(id) ?? {customer: {name: 'عميل سري'}});
  into.run(id, 'cust-secret-' + order, legacyOrderNo, payload, accepted ? payload : null, cancelledAt, outbox, outbox ? at : null, remote ? JSON.stringify(remote) : null, remote ? at : null, at, at);
  if (remote && into === insert) newestPull = at; // the main CRM's last status pull (times only grow)
};
row(ID.own);
row(ID.approved);
row(ID.cancelled, {cancelledAt: '2026-11-01T09:00:00.000Z'});
row(ID.making);
row(ID.historical, {remote: null, legacyOrderNo: 999001});
row(ID.unknown, {remote: {...created.get(ID.own), crmRequestId: ID.unknown}});
row(ID.unsent, {accepted: false, outbox: 'send', remote: null});
// A new request kept for its quotation's or PO's file (2026-11-05): counted apart, never among the sends that wait to go.
crmData.set(ID.held, {...(crmData.get(ID.unsent) ?? {customer: {name: 'عميل سري'}}), fileRequired: true});
row(ID.held, {accepted: false, outbox: 'send', remote: null});
for (const id of FILLERS) row(id, {remote: latest.get(id)});
closeAsTheApp(db, database);
const smallDb = migrated(smallDatabase);
row(ID.smallUnsent, {accepted: false, outbox: 'send', remote: null, into: smallDb.prepare(INSERT)});
closeAsTheApp(smallDb, smallDatabase);
eq([[...fs.readFileSync(database).subarray(18, 20)], fs.readdirSync(data).sort()], [[2, 2], ['database.sqlite', 'objects']], 'the test database is in WAL mode, without its -wal and -shm (a stopped app)');

// ---- running it as the account does
const run = async (env = {}) => {
  const child = spawn(process.execPath, [script], {cwd: work, env: {PATH: process.env.PATH, HOME: home, NODE_NO_WARNINGS: '1', NODE_EXTRA_CA_CERTS: mock.ca, ...env}});
  let stdout = '', stderr = '';
  child.stdout.on('data', part => { stdout += part; }); child.stderr.on('data', part => { stderr += part; });
  const status = await new Promise(resolve => child.on('close', resolve));
  const lines = stdout.trim().split('\n');
  let report = null;
  try { report = JSON.parse(lines.slice(0, -1).join('\n')); } catch { report = null; }
  return {status, stdout, stderr, last: lines.at(-1), report};
};
const orderNumbers = () => [...mock.state.byOrder.keys()].map(String);
const yourrestNumbers = () => [...mock.state.byOrder.values()].map(item => item.customerNo).filter(Boolean).map(String);
/** What must never be printed: a secret, the address, a name (all Arabic here), an email, a request id, an order or Yourrest number. */
const leaks = text => {
  const found = [];
  if ([secret, bareSecret].some(value => text.includes(value) || text.includes(value.slice(12, 28))) || /secret|deadbeef/i.test(text)) found.push('the secret or a secret test value');
  if (text.includes(mock.url) || /localhost|127\.0\.0\.1|crm-api|https?:/.test(text)) found.push('the address');
  if (/[؀-ۿ]/.test(text)) found.push('a name');
  if (text.includes('@')) found.push('an email');
  if ([...Object.values(ID), ...FILLERS].some(id => text.includes(id)) || /mrq7/.test(text)) found.push('a request id');
  if (orderNumbers().some(number => text.includes(number))) found.push('an order number');
  if (yourrestNumbers().some(number => text.includes(number))) found.push('a Yourrest number');
  if (/\d{6,}/.test(text)) found.push('a long number');
  return found;
};
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const listing = () => fs.readdirSync(work, {recursive: true}).map(String).sort();
const snapshot = () => ({digests: [digest(database), digest(smallDatabase)], listing: listing()});
let before = snapshot();
const unchanged = message => { const now = snapshot(); eq(now.digests, before.digests, message + ': the databases are unchanged'); eq(now.listing, before.listing, message + ': no file was written'); };
mock.state.calls.length = 0;
const accepted = [ID.own, ID.approved, ID.cancelled, ID.making, ID.historical, ID.unknown, ...FILLERS];
const known = accepted.filter(id => mock.row(id));
const timeMs = value => Date.parse(value);
const OK = 'PRODUCTS LINK OK: pending 4 (crm 3, manual 1), status 205/206 known, 3 differ from the CRM copy';

try {
  // ---- the link answers
  let result = await run();
  eq(result.status, 0, 'both kinds answered: exit 0. ' + result.stdout + result.stderr);
  const report = result.report;
  eq([report.readOnly, report.link, report.ok], [true, 'configured', true], 'read only, configured, answered');
  eq(report.crm, {requests: 208, accepted: 206, cancelled: 1, waitingToSend: 1, toSend: 1, toCancel: 0, heldForQuoteFile: 1, acceptedWithoutStatus: 1, newestStatusPullAt: newestPull, acceptedWithInvalidId: 0}, 'the CRM\'s counts, and its newest status pull by time');
  eq(report.calls.map(call => [call.route, call.ok, call.http, call.code, call.ids ?? null]), [['pending', true, 200, null, null], ['status', true, 200, null, 200], ['status', true, 200, null, 6]], 'one pending call, status in batches of 200');
  ok(report.calls.every(call => Number.isInteger(call.ms) && call.ms >= 0 && call.ms < 10_000), 'each call timed');
  const waiting = [ID.own, ID.unsent, ID.elsewhere].map(id => mock.row(id).waitingSince), manual = [...mock.state.byOrder.values()].find(item => item.source === 'manual');
  eq(report.pending, {total: 4, unreadable: 0, bySource: {crm: 3, manual: 1}, crmOwn: 2, crmNotInThisCrm: 1, withoutWaitingSince: 0,
    oldestWaitingSince: waiting[0], newestWaitingSince: manual.waitingSince, waitingOver24h: 2, orderedOldestFirst: true, atLimit: false}, 'the pending list: two of this CRM\'s own (one it still has to resend), one from elsewhere, one manual; two waiting over a day (3 days, 31 hours)');
  const newestUpdate = known.map(id => mock.row(id).updatedAt).reduce((a, b) => timeMs(b) > timeMs(a) ? b : a);
  eq(report.status, {asked: 206, calls: 2, returned: 205, known: 205, unknown: 1, unreadable: 0,
    byStatus: {received: 202, confirmed: 1, in_production: 1, produced: 0, delivered: 0, cancelled: 1},
    byWaitingStep: {sales: 1, production: 201, admin: 0, manufacturing: 2, delivery: 0, done: 0, cancelled: 1, none: 0},
    newestUpdatedAt: newestUpdate, historical: 1, withoutApprovals: 0, differsFromCrm: 3, notStoredInCrm: 1}, 'the status answers: three newer than the CRM\'s copy, one never stored, one unknown to production');
  eq([report.clock.signedCallsAccepted, report.clock.staleTimestamp, report.clock.clockWithin300s, report.clock.clockFrom, report.clock.dateHeaders], [true, false, true, 'signed_call', 3], 'the clock: signed calls accepted');
  ok(Number.isInteger(report.clock.productionMinusLocalSeconds) && Math.abs(report.clock.productionMinusLocalSeconds) <= 2, 'the difference from production\'s Date header of the same answers');
  ok(Math.abs(timeMs(report.clock.checkedAt) - Date.now()) < 60_000 && report.checkedAt === report.clock.checkedAt, 'checked at the local time');
  eq(result.last, OK, 'a one-line verdict');
  eq(report.verdict, result.last, 'the same verdict in the report');
  eq(leaks(result.stdout + result.stderr), [], 'no secret, address, name, email, id or number in the output');
  eq(mock.state.calls.map(call => [call.route, call.signed]), [['pending', true], ['status', true], ['status', true]], 'production saw only signed pending and status calls');
  eq([mock.state.calls[0].body, JSON.parse(mock.state.calls[1].body).ids.length + JSON.parse(mock.state.calls[2].body).ids.length], ['{}', 206], 'pending with {}, status with every accepted id');
  eq(new Set(mock.state.calls.slice(1).flatMap(call => JSON.parse(call.body).ids)), new Set(accepted), 'the accepted ids only, each once');
  unchanged('a successful check (the app stopped: no -wal or -shm left beside the database)');

  // ---- while the app has the database open (its -wal and -shm are there): read through them like any reader, nothing left behind
  const live = new DatabaseSync(database);
  live.prepare('SELECT COUNT(*) AS n FROM crm_mold_requests').get();
  ok(fs.existsSync(database + '-wal') && fs.existsSync(database + '-shm'), 'the app has the database open');
  result = await run();
  eq([result.status, result.last], [0, OK], 'a check while the app runs: the same answer');
  live.close();
  unchanged('a check while the app ran');

  // ---- a pending list out of order is said (the string order of production's times is not their time order here)
  const day = new Date(Date.now() - 5 * 24 * 3600_000).toISOString().slice(0, 10), saved = [mock.row(ID.own).waitingSince, mock.row(ID.unsent).waitingSince];
  mock.row(ID.own).waitingSince = day + 'T20:00:00-12:00'; mock.row(ID.unsent).waitingSince = day + 'T23:00:00+03:00';
  result = await run();
  eq([result.status, result.report.pending.orderedOldestFirst, result.report.pending.oldestWaitingSince, result.report.pending.waitingOver24h], [0, false, day + 'T23:00:00+03:00', 2], 'not the oldest first: said, with the real oldest');
  [mock.row(ID.own).waitingSince, mock.row(ID.unsent).waitingSince] = saved;

  // ---- a pending list at production's limit (500) is said
  const crowd = Array.from({length: 497}, () => mock.registerManual({customerName: 'مصنع سري', salesmanName: 'مندوب سري', createdBy: 'staff.secret@yourrest.org'}));
  result = await run();
  eq([result.status, result.report.pending.total, result.report.pending.bySource, result.report.pending.atLimit], [0, 500, {crm: 3, manual: 497}, true], 'a full page of 500: at the limit');
  eq(leaks(result.stdout + result.stderr), [], 'a full page: nothing secret in the output');
  for (const item of crowd) mock.state.byOrder.delete(item.orderNo);

  // ---- a CRM with no request production accepted: pending only (status takes 1 to 200 ids), and that is a working link
  mock.state.calls.length = 0;
  result = await run({MOLD_DIAG_APP: small});
  eq([result.status, result.last], [0, 'PRODUCTS LINK OK: pending 4 (crm 3, manual 1), status 0/0 known (nothing to ask)'], 'nothing accepted: OK, nothing to ask');
  eq(mock.state.calls.map(call => call.route), ['pending'], 'nothing accepted: no status call');
  eq([result.report.crm.requests, result.report.crm.accepted, result.report.status.asked, result.report.status.calls, result.report.pending.crmOwn, result.report.pending.crmNotInThisCrm], [1, 0, 0, 0, 0, 3], 'nothing accepted: the counts');
  eq(leaks(result.stdout + result.stderr), [], 'nothing accepted: nothing secret in the output');
  unchanged('a CRM with nothing accepted');

  // ---- an accepted request whose id production would refuse (one bad id fails a whole batch of 200): counted, never sent
  const smallWriter = new DatabaseSync(smallDatabase), smallInsert = smallWriter.prepare(INSERT);
  row(ID.smallBad, {remote: null, into: smallInsert});
  row(ID.own, {into: smallInsert});
  smallWriter.close();
  before = snapshot();
  mock.state.calls.length = 0;
  result = await run({MOLD_DIAG_APP: small});
  eq([result.status, result.last], [0, 'PRODUCTS LINK OK: pending 4 (crm 3, manual 1), status 1/1 known, 0 differ from the CRM copy'], 'a bad id: the valid one asked, OK');
  eq([result.report.crm.accepted, result.report.crm.acceptedWithInvalidId, result.report.status.asked], [2, 1, 1], 'a bad id: counted apart');
  eq(mock.state.calls.map(call => [call.route, call.body]), [['pending', '{}'], ['status', JSON.stringify({ids: [ID.own]})]], 'a bad id: never sent');
  eq(leaks(result.stdout + result.stderr), [], 'a bad id: nothing secret in the output');
  unchanged('a CRM with a bad id');

  // ---- production down: still a report, a FAILED verdict, exit 1
  mock.state.calls.length = 0;
  mock.state.down = true;
  result = await run();
  eq(result.status, 1, 'down: exit 1');
  eq(result.last, 'PRODUCTS LINK FAILED: pending network, status network in 2 of 2 calls (0/206 known)', 'down: the codes in the verdict');
  eq([result.report.ok, result.report.pending, result.report.calls.map(call => [call.ok, call.http, call.code])], [false, null, [[false, 0, 'network'], [false, 0, 'network'], [false, 0, 'network']]], 'each call with its code');
  eq([result.report.clock.signedCallsAccepted, result.report.clock.clockWithin300s, result.report.clock.productionMinusLocalSeconds], [false, null, null], 'the clock cannot be told');
  eq(result.report.crm.accepted, 206, 'the CRM side is still read');
  eq(leaks(result.stdout + result.stderr), [], 'down: nothing secret in the output');
  mock.state.down = false;

  // ---- production without its secret: 503 not_configured; the clock from the Date header of those answers
  mock.state.notConfigured = true;
  result = await run();
  eq([result.status, result.last], [1, 'PRODUCTS LINK FAILED: pending not_configured, status not_configured in 2 of 2 calls (0/206 known)'], 'not configured at production: exit 1, the code');
  eq(result.report.calls.map(call => [call.http, call.code]), [[503, 'not_configured'], [503, 'not_configured'], [503, 'not_configured']], 'each a 503');
  eq([result.report.clock.signedCallsAccepted, result.report.clock.clockWithin300s, result.report.clock.clockFrom], [false, true, 'date_header'], 'the clock from the Date header of those answers');
  eq(leaks(result.stdout + result.stderr), [], 'not configured: nothing secret in the output');
  for (const [seconds, within] of [[400, false], [-100, true]]) {
    answers.dateShiftMs = seconds * 1000;
    result = await run();
    const told = result.report.clock;
    eq([result.status, told.signedCallsAccepted, told.clockWithin300s, told.clockFrom, told.dateHeaders], [1, false, within, 'date_header', 3], `production ${seconds} s from here: within 300 s ${within}`);
    ok(Math.abs(told.productionMinusLocalSeconds - seconds) <= 1, `production ${seconds} s from here: the difference is said with its sign (${told.productionMinusLocalSeconds})`);
  }
  answers.dateShiftMs = 0;
  mock.state.notConfigured = false;

  // ---- answers outside the contract: a code production's contract does not have is not printed (it could hold a number or a name)
  const outside = [
    [{http: 503, type: 'application/json', body: JSON.stringify({error: {code: 'customer_ahmed_554433', message: 'عميل سري 554433', fields: ['customer.name']}})}, 503, 'other'],
    [{http: 502, type: 'text/html', body: '<html><body>Bad gateway 554433 at crm-api</body></html>'}, 502, 'http_502'],
    [{http: 500, type: 'application/json', body: JSON.stringify({error: {code: 'server_error', message: 'Unexpected server error.'}})}, 500, 'server_error'],
  ];
  for (const [replace, httpStatus, code] of outside) {
    answers.replace = replace;
    result = await run();
    eq([result.status, result.last], [1, `PRODUCTS LINK FAILED: pending ${code}, status ${code} in 2 of 2 calls (0/206 known)`], `an answer ${httpStatus}: the code ${code}`);
    eq(result.report.calls.map(call => [call.http, call.code]), Array(3).fill([httpStatus, code]), `an answer ${httpStatus}: each call`);
    eq(leaks(result.stdout + result.stderr), [], `an answer ${httpStatus}: nothing from it in the output`);
  }
  answers.replace = null;

  // ---- a clock more than 300 s off: every signed call refused with stale_timestamp
  shift = 10 * 60_000;
  result = await run();
  eq([result.status, result.last], [1, 'PRODUCTS LINK FAILED: pending stale_timestamp, status stale_timestamp in 2 of 2 calls (0/206 known)'], 'a clock off: exit 1, the code');
  eq([result.report.clock.signedCallsAccepted, result.report.clock.staleTimestamp, result.report.clock.clockWithin300s, result.report.clock.clockFrom], [false, true, false, 'stale_timestamp'], 'the clock is said to be off');
  eq(leaks(result.stdout + result.stderr), [], 'a clock off: nothing secret in the output');
  shift = 0;
  ok(mock.state.calls.every(call => ['pending', 'status'].includes(call.route)), 'still only pending and status were called');
  unchanged('the failures');

  // ---- what stops it before anything is called
  const calls = mock.state.calls.length;
  settings({YR_PRODUCTS_API_URL: mock.url});
  result = await run();
  eq([result.status, result.last], [1, 'DIAGNOSE STOP: the production link is not configured in settings.cjs (not_configured): nothing was called'], 'no secret in settings.cjs: a clear stop with the reason code');
  settings({YR_PRODUCTS_API_URL: 'http://products.example.org/crm-api.php', YR_PRODUCTS_SECRET: secret});
  result = await run();
  eq([result.status, result.last], [1, 'DIAGNOSE STOP: the production link is not configured in settings.cjs (invalid_url): nothing was called'], 'a plain-http address: the reason code only');
  ok(!result.stdout.includes('products.example.org') && leaks(result.stdout + result.stderr).length === 0, 'and not the address');
  // settings.cjs edited by hand and broken: it runs as code, and its errors can quote it (the secret too). Only the kind is said.
  const lines = Object.entries({...base, YR_PRODUCTS_API_URL: mock.url}).map(([key, value]) => `  ${key}: ${JSON.stringify(value)},`).join('\n');
  const broken = [
    [`module.exports = {\n${lines}\n  YR_PRODUCTS_SECRET: ${bareSecret},\n};\n`, 'settings.cjs could not be read (a reference error: is a value missing its quotes?)', 'the secret without its quotes'],
    [`module.exports = {\n${lines}\n  YR_PRODUCTS_SECRET: '${bareSecret}'\n  ('x'),\n};\n`, 'settings.cjs could not be read (a type error)', 'a missing comma before a parenthesis'],
    [`module.exports = {\n${lines}\n  YR_PRODUCTS_SECRET: '${bareSecret}'\n  YR_X: 'y',\n};\n`, 'settings.cjs could not be read (a syntax error)', 'a missing comma between two settings'],
    [`throw new Error('${bareSecret}');\n`, 'settings.cjs could not be read (an error)', 'an error of its own'],
    [`throw new Error('Persistent paths must be absolute: ${bareSecret}');\n`, 'Persistent paths must be absolute: [hidden]', 'an error that reads as the settings check\'s own (a long key-like run is cut out)'],
  ];
  for (const [text, stop, what] of broken) {
    fs.writeFileSync(path.join(app, 'settings.cjs'), text);
    result = await run();
    eq([result.status, result.last], [1, 'DIAGNOSE STOP: ' + stop], 'settings.cjs broken, ' + what + ': a fixed stop');
    eq(leaks(result.stdout + result.stderr), [], 'settings.cjs broken, ' + what + ': nothing secret in the output');
  }
  settings({YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: secret});
  result = await run({YR_STRAY: 'x'});
  ok(result.status === 1 && result.last === 'DIAGNOSE STOP: Conflicting YR_STRAY environment value: edit settings.cjs and remove the cPanel override.', 'a stray YR_* variable is still refused by the settings check, in its own words');
  const bare = path.join(work, 'bare'), bareOps = path.join(bare, 'release', 'operations');
  fs.mkdirSync(bareOps, {recursive: true});
  for (const file of ['mold-rules.mjs', 'config.cjs']) fs.copyFileSync(path.join(ops, file), path.join(bareOps, file));
  result = await run({MOLD_DIAG_APP: bare});
  eq([result.status, result.last], [1, 'DIAGNOSE STOP: the live release has no mold-client.mjs: deploy the mold requests update first'], 'a release without the client: a clear stop');
  fs.rmSync(bare, {recursive: true, force: true});
  eq(mock.state.calls.length, calls, 'none of these called production');
  result = await run({MOLD_DIAG_APP: app});
  eq([result.status, result.last], [0, OK], 'MOLD_DIAG_APP names the app folder');
  unchanged('every run');

  // ---- the script itself
  const text = fs.readFileSync(script, 'utf8');
  ok(!/YR_[A-Z_]+ *=|env\.YR_|env\[['"]YR_/.test(text), 'the script reads and sets no YR_* variable');
  const routes = [...text.matchAll(/\bask\(tools, '([a-z]+)'/g)].map(match => match[1]);
  eq([routes, text.match(/callProducts\(/g).length, /callProducts\(link, route,/.test(text)], [['pending', 'status'], 1, true], 'it calls production in one place, with the pending and status routes only');
  ok(text.includes('{readOnly: true}') && !/writeFile|appendFile|mkdtemp|mkdirSync|rmSync|unlink|renameSync|copyFile/.test(text), 'it opens the database read-only and writes no file');
} finally {
  Object.assign(http.ServerResponse.prototype, {writeHead, end});
  await mock.stop();
}
console.log(JSON.stringify({ok: true, checks, productionDataUsed: false, realProductionTested: false}));
