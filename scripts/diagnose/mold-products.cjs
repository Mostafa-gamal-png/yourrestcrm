'use strict';
// Read-only check of the link with the production application (2026-11-02): does production answer the CRM's two read routes,
// `pending` (the requests waiting for the sales manager) and `status` (the status of the requests production accepted), and how do
// their answers compare with what the CRM holds? It uses the live release's own client (release/operations/mold-client.mjs: the
// signed POST with its 10-second limit) and rules, the settings through operations/config.cjs, and opens the database read-only. It
// calls nothing else (never requests, cancel, approval or customers), writes no file and changes nothing: the live database is in WAL
// mode, and when the app is stopped it is opened immutable, so SQLite creates no -wal or -shm beside it either.
// It prints counts and times only: no customer or salesman names, emails, request ids, order or Yourrest numbers, no text from the
// answers, and never the shared secret or the products address.
//   node mold-products.cjs                       on the hosting account (yourrest-crm/settings.cjs)
//   MOLD_DIAG_APP=<app folder> node ...          on another app folder (tests)
// Exit code 0 when both kinds of call answered, 1 otherwise (the report is still printed); DIAGNOSE STOP when it cannot start.
// No YR_* variable is ever used or set: the settings check refuses any YR_* value beside settings.cjs.
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {DatabaseSync} = require('node:sqlite');

const DAY_MS = 24 * 3600_000;
const PENDING_LIMIT = 500;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
/** A time as it came when it is an exact ISO time, else null: no free text from an answer reaches the report. */
const timeOf = value => typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
/** The codes a call can end with: the contract's (§4, and production's server_error), the client's own, and moldConfig's reasons. */
const CODES = new Set(['invalid_signature', 'stale_timestamp', 'not_configured', 'invalid_payload', 'request_locked', 'not_found', 'payload_too_large',
  'method_not_allowed', 'server_error', 'network', 'timeout', 'bad_response', 'client_error', 'invalid_url', 'short_secret']);
/** A known error code or http_<status> as it came, else 'other': a code outside the contract is free text (it could hold a number or a name). */
const codeOf = value => typeof value === 'string' && (CODES.has(value) || /^http_\d{3}$/.test(value)) ? value : 'other';
const newest = (a, b) => !a ? b : !b ? a : Date.parse(b) > Date.parse(a) ? b : a;

class DiagnoseStop extends Error {}
/** The secret and the address once read: taken out of anything printed, whatever happens (the report never holds them anyway). */
const hidden = [];
const hide = text => hidden.reduce((out, value) => value ? out.split(value).join('[hidden]') : out, String(text));
/** A stop's text, any run of 24 or more key-like characters cut out: a second guard for the time before the secret is known. An
 *  absolute path (a missing file's message) stays. */
const stopText = error => String(error && error.message ? error.message : error).replace(/[A-Za-z0-9+/=_-]{24,}/g, run => run.startsWith('/') ? run : '[hidden]');

/** What config.cjs itself says when settings.cjs was read but is wrong: fixed texts (or a variable's name), passed on as they are. */
const CONFIG_MESSAGES = ['Conflicting YR_', 'settings.cjs must', 'YR_APP_ORIGIN must', 'YR_AUTH_SECRET is invalid', 'Persistent ', 'Keep the database', 'Local mail settings'];
const SETTINGS_ERRORS = {SyntaxError: 'a syntax error', ReferenceError: 'a reference error: is a value missing its quotes?', TypeError: 'a type error', RangeError: 'a range error'};
/** settings.cjs runs as code and is edited by hand: an error it throws can quote its text, the secret too (a secret pasted without its
 *  quotes is "<secret> is not defined"). Only config.cjs's own messages and a file error (its code and path) are passed on; anything
 *  else is said by its kind alone. */
function settingsError(error) {
  if (error instanceof Error && error.constructor === Error && CONFIG_MESSAGES.some(start => error.message.startsWith(start))) return error;
  if (error instanceof Error && typeof error.code === 'string' && /^E[A-Z]+$/.test(error.code) && typeof error.syscall === 'string') return error;
  const name = error instanceof Error ? error.name : '';
  return new DiagnoseStop(`settings.cjs could not be read (${Object.hasOwn(SETTINGS_ERRORS, name) ? SETTINGS_ERRORS[name] : 'an error'})`);
}

/** The live release's client and rules, and the settings. Stops when the release is older than the approvals update. */
async function setup(app) {
  const operations = path.join(app, 'release', 'operations');
  const clientFile = path.join(operations, 'mold-client.mjs'), rulesFile = path.join(operations, 'mold-rules.mjs');
  if (!fs.existsSync(clientFile) || !fs.existsSync(rulesFile)) throw new DiagnoseStop('the live release has no mold-client.mjs: deploy the mold requests update first');
  const client = await import(pathToFileURL(clientFile).href), rules = await import(pathToFileURL(rulesFile).href);
  const needed = [client.moldConfig, client.callProducts, rules.moldStatusObject, rules.moldPendingItem];
  if (needed.some(item => typeof item !== 'function') || !Number.isInteger(rules.MOLD_STATUS_BATCH) || !Array.isArray(rules.MOLD_STATUSES) || !Array.isArray(rules.MOLD_WAITING_STEPS) || !(rules.MOLD_ID instanceof RegExp)) {
    throw new DiagnoseStop('the live release\'s mold tools have no pending route yet: deploy the mold approvals update first');
  }
  let settings;
  try { settings = require(path.join(operations, 'config.cjs')).loadSettings(app); } catch (error) { throw settingsError(error); }
  const link = client.moldConfig(settings);
  if (!link.ok) throw new DiagnoseStop(`the production link is not configured in settings.cjs (${codeOf(link.reason)}): nothing was called`);
  hidden.push(link.secret, link.url);
  try { const url = new URL(link.url); hidden.push(url.origin + url.pathname, url.host); } catch { /* moldConfig checked it */ }
  return {client, rules, link, database: settings.YR_DATABASE_PATH};
}

/** The database, read-only and writing nothing beside it. The live one is in WAL mode, where even a read-only connection creates the
 *  -wal and -shm files when they are not there (the app stopped, or idle), and leaves them. Then all the data is in the main file, and
 *  it is opened immutable: SQLite creates nothing. While the app has it open they are there, and it is read through them like any
 *  reader. (Should the app open it and write in the moment between, a count could be off; nothing is ever written.) */
function openDatabase(file) {
  const quiet = !fs.existsSync(file + '-wal') && !fs.existsSync(file + '-shm');
  return new DatabaseSync(quiet ? new URL(pathToFileURL(file).href + '?mode=ro&immutable=1') : file, {readOnly: true});
}

/** A new request kept in the CRM for its quotation's or PO's file (2026-11-05; lib/mold-requests-server.ts MOLD_AWAITS_FILE_SQL): never
 *  sent until its requester attaches one, so it is counted apart from the sends that wait to go (waitingToSend, toSend). */
const AWAITS_FILE = `(outbox IS 'send' AND json_extract(data,'$.fileRequired') IS 1 AND accepted IS NULL AND remote IS NULL
  AND (last_attempt_at IS NULL OR json_extract(last_error,'$.notStored') IS 1 AND json_extract(last_error,'$.at')>=last_attempt_at)
  AND NOT EXISTS(SELECT 1 FROM crm_mold_design_files q WHERE q.request_id=crm_mold_requests.id AND q.category IN ('quote','po') AND q.deleted_at IS NULL
    AND NOT (q.outbox IS 'send' AND q.sent_at IS NULL AND q.next_attempt_at IS NULL AND json_extract(q.last_error,'$.final') IS 1)))`;
/** What the CRM holds, read-only: counts, plus the ids and the status last stored (kept in memory only, never printed). */
function readCrm(file, rules) {
  const db = openDatabase(file);
  try {
    const counts = db.prepare(`SELECT COUNT(*) AS requests, COALESCE(SUM(accepted IS NOT NULL), 0) AS accepted, COALESCE(SUM(cancelled_at IS NOT NULL), 0) AS cancelled,
      COALESCE(SUM(outbox IS NOT NULL AND NOT ${AWAITS_FILE}), 0) AS waitingToSend, COALESCE(SUM(outbox = 'send' AND NOT ${AWAITS_FILE}), 0) AS toSend, COALESCE(SUM(outbox = 'cancel'), 0) AS toCancel,
      COALESCE(SUM(${AWAITS_FILE}), 0) AS heldForQuoteFile,
      COALESCE(SUM(accepted IS NOT NULL AND remote IS NULL), 0) AS acceptedWithoutStatus, MAX(remote_at) AS newestStatusPullAt FROM crm_mold_requests`).get();
    const rows = db.prepare('SELECT id, accepted IS NOT NULL AS accepted, remote FROM crm_mold_requests ORDER BY created_at, id').all();
    const all = new Set(), asked = [], stored = new Map();
    let invalidIds = 0;
    for (const row of rows) {
      all.add(row.id);
      if (!row.accepted) continue;
      if (!rules.MOLD_ID.test(row.id)) { invalidIds++; continue; }
      asked.push(row.id);
      let remote = null;
      try { remote = row.remote ? JSON.parse(row.remote) : null; } catch { remote = null; }
      stored.set(row.id, remote && typeof remote === 'object' ? {status: remote.status ?? null, waitingStep: remote.waitingStep ?? null} : null);
    }
    const crm = {...Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, key === 'newestStatusPullAt' ? timeOf(value) : Number(value)])), acceptedWithInvalidId: invalidIds};
    return {crm, all, asked, stored};
  } finally { db.close(); }
}

/** One signed call through the live client, timed. Production's Date header is read from the very same answer (no other call). */
async function ask({client, link}, route, payload, calls, dates) {
  const watch = async (url, init) => {
    const sentAt = Date.now(), response = await globalThis.fetch(url, init), answeredAt = Date.now();
    const date = Date.parse(response.headers.get('date') || '');
    if (Number.isFinite(date)) dates.push({sentAt, answeredAt, date});
    return response;
  };
  const started = performance.now();
  let answer;
  try { answer = await client.callProducts(link, route, payload, {fetch: watch}); } catch { answer = {kind: 'retry', code: 'client_error', http: 0}; }
  const record = {route, ok: answer.kind === 'ok', http: Number.isInteger(answer.http) ? answer.http : 0, code: answer.kind === 'ok' ? null : codeOf(answer.code), ms: Math.round(performance.now() - started)};
  if (route === 'status') record.ids = payload.ids.length;
  calls.push(record);
  return answer.kind === 'ok' ? answer.json : null;
}

function pendingSummary(json, rules, crmIds, now) {
  const raw = Array.isArray(json?.requests) ? json.requests : [];
  const items = raw.map(item => rules.moldPendingItem(item)).filter(Boolean);
  const crm = items.filter(item => item.source === 'crm'), own = crm.filter(item => item.crmRequestId !== null && crmIds.has(item.crmRequestId)).length;
  const times = items.map(item => timeOf(item.waitingSince)).filter(Boolean);
  let ordered = true, oldest = null, latest = null;
  for (const [index, time] of times.entries()) {
    if (index && Date.parse(time) < Date.parse(times[index - 1])) ordered = false;
    if (!oldest || Date.parse(time) < Date.parse(oldest)) oldest = time;
    latest = newest(latest, time);
  }
  return {
    total: raw.length, unreadable: raw.length - items.length, bySource: {crm: crm.length, manual: items.length - crm.length},
    crmOwn: own, crmNotInThisCrm: crm.length - own, withoutWaitingSince: items.length - times.length,
    oldestWaitingSince: oldest, newestWaitingSince: latest, waitingOver24h: times.filter(time => now - Date.parse(time) > DAY_MS).length,
    orderedOldestFirst: ordered, atLimit: raw.length >= PENDING_LIMIT,
  };
}

function statusSummary(answers, rules, asked, stored) {
  const byStatus = Object.fromEntries(rules.MOLD_STATUSES.map(status => [status, 0]));
  const byWaitingStep = Object.fromEntries([...rules.MOLD_WAITING_STEPS, 'none'].map(step => [step, 0]));
  const known = new Set();
  let returned = 0, unknown = 0, unreadable = 0, historical = 0, withoutApprovals = 0, differs = 0, notStored = 0, updatedAt = null;
  for (const {ids, json} of answers) {
    const batch = new Set(ids);
    returned += json.requests.length; unknown += json.unknown.length;
    for (const item of json.requests) {
      const status = rules.moldStatusObject(item);
      if (!status || !batch.has(status.crmRequestId) || known.has(status.crmRequestId)) { unreadable++; continue; }
      known.add(status.crmRequestId);
      byStatus[status.status] = (byStatus[status.status] || 0) + 1;
      byWaitingStep[status.waitingStep ?? 'none'] = (byWaitingStep[status.waitingStep ?? 'none'] || 0) + 1;
      if (!status.approvals) withoutApprovals++;
      else if (status.approvals.required === false) historical++;
      updatedAt = newest(updatedAt, timeOf(status.updatedAt));
      const before = stored.get(status.crmRequestId);
      if (!before) notStored++;
      else if (before.status !== status.status || before.waitingStep !== (status.waitingStep ?? null)) differs++;
    }
  }
  return {asked, calls: answers.length, returned, known: known.size, unknown, unreadable, byStatus, byWaitingStep, newestUpdatedAt: updatedAt,
    historical, withoutApprovals, differsFromCrm: differs, notStoredInCrm: notStored};
}

/** The clock: a signed call production accepted proves the two clocks are within 300 s; a 401 stale_timestamp proves they are not.
 *  The Date header of the same answers gives the difference itself (1-second steps), from the quickest call. */
function clockSummary(calls, dates, checkedAt) {
  const accepted = calls.some(call => call.ok), stale = calls.some(call => call.code === 'stale_timestamp'), refused = calls.some(call => call.http === 401);
  const quickest = dates.reduce((best, item) => !best || item.answeredAt - item.sentAt < best.answeredAt - best.sentAt ? item : best, null);
  const skew = quickest ? Math.round((quickest.date + 500 - (quickest.sentAt + quickest.answeredAt) / 2) / 1000) : null;
  const within = stale ? false : accepted ? true : skew !== null ? Math.abs(skew) < 300 : null;
  return {checkedAt, signedCallsAccepted: accepted && !refused, staleTimestamp: stale, clockWithin300s: within,
    clockFrom: stale ? 'stale_timestamp' : accepted ? 'signed_call' : skew !== null ? 'date_header' : null,
    productionMinusLocalSeconds: skew, dateHeaders: dates.length};
}

async function run({now = Date.now} = {}) {
  const home = process.env.HOME || '/home/youriedx', app = process.env.MOLD_DIAG_APP || path.join(home, 'yourrest-crm');
  const tools = await setup(app), {rules} = tools;
  const {crm, all, asked, stored} = readCrm(tools.database, rules);
  const checkedAt = new Date(now()).toISOString(), calls = [], dates = [];
  const pendingJson = await ask(tools, 'pending', {}, calls, dates);
  const answers = [];
  for (let start = 0; start < asked.length; start += rules.MOLD_STATUS_BATCH) {
    const ids = asked.slice(start, start + rules.MOLD_STATUS_BATCH), json = await ask(tools, 'status', {ids}, calls, dates);
    if (json) answers.push({ids, json});
  }
  const pendingCall = calls[0], statusCalls = calls.slice(1);
  const pending = pendingCall.ok ? pendingSummary(pendingJson, rules, all, now()) : null;
  const status = statusSummary(answers, rules, asked.length, stored);
  const ok = pendingCall.ok && statusCalls.every(call => call.ok);
  const pendingText = pending ? `pending ${pending.total} (crm ${pending.bySource.crm}, manual ${pending.bySource.manual})` : `pending ${pendingCall.code}`;
  const failed = statusCalls.filter(call => !call.ok);
  const statusText = !asked.length ? 'status 0/0 known (nothing to ask)'
    : !failed.length ? `status ${status.known}/${status.asked} known`
      : `status ${failed[0].code}${statusCalls.length > 1 ? ` in ${failed.length} of ${statusCalls.length} calls` : ''} (${status.known}/${status.asked} known)`;
  const verdict = `PRODUCTS LINK ${ok ? 'OK' : 'FAILED'}: ${pendingText}, ${statusText}${ok && asked.length ? `, ${status.differsFromCrm} differ from the CRM copy` : ''}`;
  return {checkedAt, readOnly: true, link: 'configured', crm, calls, clock: clockSummary(calls, dates, checkedAt), pending, status, ok, verdict};
}

if (require.main === module) {
  run().then(report => {
    console.log(hide(JSON.stringify(report, null, 2)));
    console.log(hide(report.verdict));
    if (!report.ok) process.exitCode = 1;
  }).catch(error => { console.log(hide('DIAGNOSE STOP: ' + stopText(error))); process.exitCode = 1; });
}
module.exports = {run};
