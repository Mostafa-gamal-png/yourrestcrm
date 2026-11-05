// A stand-in for the production application's mold requests API (yourrest-products, crm-api.php) for tests: HTTPS with a throwaway
// self-signed certificate, the same signature check, clock window, routes, field checks, linking, locking and answers as the PHP of
// contract version 1, its addendum and the approval chain of 2026-11-01 (three approvals in order: the sales manager, in the CRM
// through the approval route, then production, then the system administrator; a design file attached or deleted from the CRM undoes
// them). Since 2026-11-02 a sent request's data is edited by the production manager only: the requests route remembers the data the
// CRM first sent for a crmRequestId and answers that ORIGINAL again with 200 created:false (a retry, even after the production manager
// edited the request there), and any other data with 409 request_locked, details.reason production_only and details.request, changing
// nothing; pending lists each request's data as it is now (after those edits). Kept in memory. Test controls: down (connections are
// cut), notConfigured (503), delayMs, the production manager's edit of a request (edit), a
// production step on a request (start / deliver), a request deleted there (read as cancelled) or unknown to it, historical rows to link,
// a design file production attaches itself, a one-shot answer for one route (answerNext). The design files of 2026-11-02 (design-files, design-file-delete, design-file) follow the
// owner's text of the addition and production's PR #27: the JSON line and the bytes signed together, the name and extension rules
// (a Windows reserved name such as CON accepted), 25 MiB, 10 files a request (400 fields ['crmFileId'], reason too_many_files), a PDF
// with %PDF-1.x within its first 1024 bytes, an image of at most 80 000 000 pixels whatever its extension says among the four (its
// header read with the CRM's own moldImageSize), a crmFileId never taken by another file nor after its file's deletion (400 fields
// ['crmFileId'], reason crm_file_id_used), 404 before the request exists, 409 once it is not editable, the safe repeat, and any attach
// or delete undoing the approvals. Since 2026-11-03 (the products side's message): the third approval is finance's (still keyed admin);
// `payment` beside customer, salesman and specs, cash or deferred (absent: stored as null, as for an older client; any other value 400
// invalid_payload fields ['payment']), part of the original a retry is compared with, and listed by pending (null for an older request);
// and a cancellation the production manager undoes (restore: the request back where it stood before the cancellation), after which a
// cancellation with a reason used before answers 200 with the request as it is (not cancelled, whatever its state: approved or in
// production since, never 409), and only a new reason cancels it again.
// The quotation and PO (yourrest-products' second update of 2026-11-03), behind a switch (quotePo: false is the application before that
// update, the default; true the updated one): the old application ignores quoteNo, poNo and a file's category silently (a file with a
// category is kept as a design file) and its status objects carry none of them; the updated one takes quoteNo and poNo (strings of up to
// 60 characters after its normalizing: Arabic-Indic and Persian digits as ASCII, the ends trimmed; "" or absent for none; anything else
// 400 invalid_payload naming the field), keeps them in the original a retry is compared with (adding one later is 409 production_only),
// and returns quoteNo, poNo, quoteOrPoMissing (true for a request it took after its update without either, until its production manager
// adds one; false for older, cancelled and deleted ones), quoteFiles and poFiles (each file with its category) in every status object and
// pending item, designFiles then listing design files only; design-files takes "category" (design, quote or po; another value 400 fields
// ['category']), a quotation's or PO's file a PDF or an image only (400 fields ['name'], reason not_document), the same crmFileId with
// another category as crm_file_id_used, and 10 design files, 5 quotation and 5 PO files a request (too_many_files). Test controls: the
// switch (setQuotePo), the production manager adding or correcting a number (setNumbers), production's own quotation or PO file
// (addProductionFile with a category).
// Since the products side's message of 2026-11-05 the updated application (the same switch, quotePo: true) is the one after that
// message: quoteNo and poNo are still taken, normalized, stored and part of the original a retry is compared with, but not counted;
// quoteOrPoMissing is true while the request has neither a quotation file nor a PO file (the CRM's or production's own) and finance has
// not approved it (approvals.admin; a historical request needs none), cancelled and deleted ones excepted; attaching or deleting a
// quotation's or PO's file keeps the approvals, a design file's still undoes them. Everything else is unchanged. quotePo: false stays the
// application before 2026-11-03 (no quoteOrPoMissing key at all).
// The new numbering (the products side's second message of 2026-11-05), behind its own switch (requestRefs: false, the default, is the
// application as it is today: every request numbered when it is created, no requestRef): with it on, a request gets no orderNo when it is
// created (null in the requests, status and pending answers) and is numbered when production approves it (approvals.production: the last
// number + 1); every request carries requestRef, a stable UUID, in its status object and its pending item; the approval route takes
// requestRef for a request registered in the products application (not a UUID: 400 invalid_payload fields ['requestRef']; unknown: 404),
// crmRequestId for the CRM's as before, and orderNo still for a request that has a number; production no longer deletes a request, it
// cancels it, and a cancelled request keeps its number. Test controls: the switch (setRequestRefs), renumber (the one-time shift of the
// numbers from 101 up down by one, without a new revision), cancelHere (production cancelling a request).
// No real account, network or secret is used.
import {createServer} from 'node:https';
import {createHash, createHmac, randomUUID, timingSafeEqual} from 'node:crypto';
import {moldImageSize} from '../../portable/mold-rules.mjs';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {once} from 'node:events';
import os from 'node:os';
import path from 'node:path';

const STAGES = ['laserCutting', 'box', 'coreConnector', 'lowerMold', 'tempershoe', 'alignment', 'paint'];
const COLUMNS = ['requestedAt', 'customerNo', 'customerName', 'customerAddress', 'customerCity', 'salesmanId', 'salesmanName', 'salesmanEmail', 'description', 'core', 'vibrators', 'model', 'halfBlock', 'moldWidth', 'gelbaSize', 'moldNo', 'quantity', 'designUrl', 'notes', 'payment', 'quoteNo', 'poNo'];
const PAYMENTS = ['cash', 'deferred'];
/** The file categories of the updated application and how many of each a request holds. */
const CATEGORY_LIMITS = {design: 10, quote: 5, po: 5};
/** A quotation or PO number as the updated application stores it: Arabic-Indic and Persian digits as ASCII, the ends trimmed; null for
 *  none (absent, null or ""); undefined for a refusal (not a string, a control character, more than 60 characters). */
function quotePoNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0660-\u0669]/g, digit => String(digit.charCodeAt(0) - 0x0660)).replace(/[\u06F0-\u06F9]/g, digit => String(digit.charCodeAt(0) - 0x06F0)).trim();
  if ([...text].length > 60 || /[\u0000-\u001F\u007F]/.test(text)) return undefined;
  return text === '' ? null : text;
}
/** A cancellation's reason as production compares it: white space runs as one space, the ends trimmed. */
const reasonKey = value => String(value ?? '').replace(/\s+/g, ' ').trim();
class ApiError extends Error { constructor(code, http, message, fields = [], details = {}) { super(message); Object.assign(this, {code, http, fields, details}); } }

function clean(value, max, required, field, bad) {
  if (value === null || value === undefined) value = '';
  if (typeof value !== 'string' || [...value].length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) { bad.push(field); return ''; }
  value = value.replace(/[ \t ]+/g, ' ').trim();
  if (required && value === '') bad.push(field);
  return value;
}
function int(value, min, max, required, field, bad) {
  if (value === null || value === undefined || value === '') { if (required) bad.push(field); return null; }
  if (!Number.isInteger(value) || value < min || value > max) { bad.push(field); return null; }
  return value;
}
function choice(value, allowed, required, field, bad) {
  if (value === null || value === undefined || value === '') { if (required) bad.push(field); return null; }
  if (typeof value !== 'string' || !allowed.includes(value)) { bad.push(field); return null; }
  return value;
}
/** yr_mreq_validate_request, field for field. quotePo: the application after its update of 2026-11-03 (quoteNo and poNo read); before
 *  it they are ignored, whatever they hold. */
export function validateRequest(body, now = Date.now(), {quotePo = false} = {}) {
  const bad = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('invalid_payload', 400, 'The body must be a JSON object.', ['body']);
  let id = body.crmRequestId;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) { bad.push('crmRequestId'); id = ''; }
  const legacy = int(body.legacyOrderNo, 1, 1000000, false, 'legacyOrderNo', bad);
  const at = body.requestedAt;
  let requestedAt = null;
  if (typeof at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(at)) bad.push('requestedAt');
  else { const t = Date.parse(at); if (!Number.isFinite(t) || t < Date.parse('2020-01-01T00:00:00Z') || t > now + 2 * 86400_000) bad.push('requestedAt'); else requestedAt = new Date(t).toISOString(); }
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  const c = object(body.customer), s = object(body.salesman), p = object(body.specs);
  if (!c) bad.push('customer'); if (!s) bad.push('salesman'); if (!p) bad.push('specs');
  const cc = c || {}, ss = s || {}, pp = p || {};
  // payment (2026-11-03): cash or deferred; left out (an older client), stored as null; anything else refused.
  const payment = body.payment === undefined || body.payment === null ? null : PAYMENTS.includes(body.payment) ? body.payment : (bad.push('payment'), null);
  const number = field => { if (!quotePo) return null; const value = quotePoNumber(body[field]); if (value === undefined) { bad.push(field); return null; } return value; };
  const quoteNo = number('quoteNo'), poNo = number('poNo');
  const designUrl = clean(pp.designUrl, 1000, false, 'specs.designUrl', bad);
  if (designUrl !== '' && !/^https:\/\/\S+$/i.test(designUrl)) bad.push('specs.designUrl');
  const email = clean(ss.email, 190, false, 'salesman.email', bad);
  if (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad.push('salesman.email');
  const out = {
    crmRequestId: id, legacyOrderNo: legacy, requestedAt,
    customerNo: int(cc.crmNumber, 1, 2147483647, false, 'customer.crmNumber', bad), customerName: clean(cc.name, 200, true, 'customer.name', bad),
    customerAddress: clean(cc.address, 300, false, 'customer.address', bad), customerCity: clean(cc.city, 100, false, 'customer.city', bad),
    salesmanId: clean(ss.crmMemberId, 64, false, 'salesman.crmMemberId', bad), salesmanName: clean(ss.name, 160, true, 'salesman.name', bad), salesmanEmail: email,
    description: clean(pp.description, 200, true, 'specs.description', bad), core: choice(pp.core, ['open', 'closed'], true, 'specs.core', bad),
    vibrators: int(pp.vibrators, 2, 4, true, 'specs.vibrators', bad), model: choice(pp.model, ['old', 'gelba_new', 'new'], true, 'specs.model', bad),
    halfBlock: choice(pp.halfBlock, ['none', 'one', 'two', 'three'], true, 'specs.halfBlock', bad), moldWidth: int(pp.moldWidth, 1000, 2000, true, 'specs.moldWidth', bad),
    gelbaSize: int(pp.gelbaSize, 500, 1200, true, 'specs.gelbaSize', bad), moldNo: clean(pp.moldNo, 40, false, 'specs.moldNo', bad),
    quantity: int(pp.quantity, 1, 100, true, 'specs.quantity', bad), designUrl: designUrl === '' ? null : designUrl, notes: clean(pp.notes, 2000, false, 'specs.notes', bad), payment, quoteNo, poNo,
  };
  if (bad.length) throw new ApiError('invalid_payload', 400, 'Some fields are missing or invalid.', [...new Set(bad)]);
  return out;
}

const blankStages = () => Object.fromEntries(STAGES.map(key => [key, {done: false, at: null}]));
const APPROVAL_STEPS = ['sales', 'production', 'admin'];
const noApprovals = () => ({legacy: false, sales: null, production: null, admin: null});
const approved = row => row.approvals.legacy || row.approvals.admin !== null;
function derive(row) {
  const done = STAGES.filter(key => row.stages[key].done).length;
  return row.cancelled ? 'cancelled' : row.delivered ? 'delivered' : done >= STAGES.length ? 'produced' : done > 0 || row.productionDate ? 'in_production' : approved(row) ? 'confirmed' : 'received';
}
/** yr_mreq_waiting_step: where the request waits now. */
function waitingStep(row) {
  const status = derive(row);
  if (status === 'cancelled') return 'cancelled';
  if (status === 'delivered') return 'done';
  if (!approved(row)) return APPROVAL_STEPS.find(step => row.approvals[step] === null);
  return status === 'produced' ? 'delivery' : 'manufacturing';
}
/** The quotation and PO part of a status object or a pending item, from the updated application only: the numbers as it holds them
 *  now ("" for none, no longer counted), quoteOrPoMissing (2026-11-05: neither a quotation file nor a PO file, the CRM's or its own, and
 *  finance has not approved; never for a cancelled or deleted request), and the files of each kind, designFiles then listing design files
 *  only. The old application lists every file in designFiles and nothing else. */
function quotePoPart(row, quotePo) {
  const files = category => (row.designFiles || []).filter(file => (file.category || 'design') === category).map(file => designEntryOf(file, true));
  if (!quotePo) return {designFiles: (row.designFiles || []).map(file => designEntryOf(file, false))};
  const quoteFiles = files('quote'), poFiles = files('po');
  return {designFiles: files('design'), quoteNo: row.quoteNo ?? '', poNo: row.poNo ?? '', quoteOrPoMissing: !row.cancelled && !approved(row) && !quoteFiles.length && !poFiles.length, quoteFiles, poFiles};
}
/** yr_mreq_status_object; quotePo: the updated application (2026-11-03) adds the quotation and PO part; refs: the application of the new
 *  numbering (2026-11-05) adds requestRef (orderNo is null until production approves). */
function statusObjectOf(row, quotePo, refs = false) {
  const status = derive(row), a = row.approvals;
  const approvals = {required: !a.legacy, ...Object.fromEntries(APPROVAL_STEPS.map(step => [step, a[step] ? {at: a[step].at, ...(a[step].via === 'crm' ? {by: a[step].by} : {})} : null]))};
  const {designFiles, ...numbers} = quotePoPart(row, quotePo);
  return {crmRequestId: row.crmRequestId, orderNo: row.orderNo, ...(refs ? {requestRef: row.requestRef} : {}), status, editable: status === 'received', moldSerial: row.moldSerial, productionDate: row.productionDate, stages: structuredClone(row.stages),
    stagesDone: STAGES.filter(key => row.stages[key].done).length, stagesTotal: STAGES.length, delivered: row.delivered, deliveryDate: row.deliveryDate,
    waitingStep: row.waitingStep, waitingSince: row.waitingSince, approvals, updatedAt: row.updatedAt, revision: row.revision, designFiles, ...numbers};
}
const DESIGN_EXTENSIONS = {pdf: 'pdf', png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', ...Object.fromEntries('dwg dxf step stp igs iges stl sldprt sldasm slddrw nc1 dstv ai eps cdr psd svg zip rar 7z'.split(' ').map(e => [e, 'other']))};
const DESIGN_MAX = 25 * 1024 * 1024;
const IMAGE_TYPES = {png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp'};
/** The file entry of designFiles (and of quoteFiles, poFiles: the updated application adds each file's category). */
const designEntryOf = (file, withCategory) => ({fileId: file.fileId, crmFileId: file.crmFileId, name: file.name, kind: file.kind, size: file.bytes.length, source: file.source, uploadedAt: file.uploadedAt, ...(withCategory ? {category: file.category || 'design'} : {})});
/** A design file's name and bytes, as production checks them: [field, reason] of the refusal, or the file's kind and type. A Windows
 *  reserved name (CON, AUX, COM1…) is accepted; an image is any of the four whatever its extension says among them, kept as what it is. */
function checkDesign(name, bytes) {
  if (typeof name !== 'string' || [...name].length > 200 || /[\\/<>:"|?*\u0000-\u001F\u007F]/.test(name) || !/^[^.].*\.([A-Za-z0-9]+)$/.test(name.trim()) || name !== name.trim()) return {field: 'name'};
  const kind = DESIGN_EXTENSIONS[name.slice(name.lastIndexOf('.') + 1).toLowerCase()];
  if (!kind) return {field: 'name'};
  if (!bytes.length) return {field: 'file', reason: 'empty'};
  // PR #27: %PDF- and its version anywhere within the first 1024 bytes, whatever comes before it there.
  if (kind === 'pdf') return /%PDF-\d\.\d/.test(bytes.subarray(0, 1024).toString('latin1')) ? {kind, type: 'application/pdf'} : {field: 'file', reason: 'not_pdf'};
  if (kind === 'image') {
    const size = moldImageSize(bytes);
    if (!size || !size.width || !size.height) return {field: 'file', reason: 'bad_image'};
    if (size.width * size.height > 80_000_000) return {field: 'file', reason: 'too_many_pixels'};
    return {kind, type: IMAGE_TYPES[size.format]};
  }
  return {kind, type: 'application/octet-stream'};
}
const same = (row, p) => COLUMNS.every(column => { const a = row[column] ?? null, b = p[column] ?? null; return (a === null) === (b === null) && (a === null || String(a) === String(b)); });

/**
 * @param {{secret?: string, now?: () => number, quotePo?: boolean, requestRefs?: boolean}} options quotePo: start as the application after its
 *  update of 2026-11-03; requestRefs: start as the application of the new numbering (the second message of 2026-11-05)
 */
export async function startProductsMock({secret = 'mock-shared-secret-for-tests-0123456789abcdef', now = () => Date.now(), quotePo = false, requestRefs = false} = {}) {
  const work = mkdtempSync(path.join(os.tmpdir(), 'yr-products-mock-'));
  const key = path.join(work, 'key.pem'), cert = path.join(work, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], {stdio: 'ignore'});
  // deletedFileIds: every crmFileId whose file was deleted (design-file-delete, or removeFile), never taken again (crm_file_id_used).
  const state = {secret, down: false, notConfigured: false, delayMs: 0, rows: new Map(), byOrder: new Map(), nextOrder: 92, calls: [], badSignatures: 0, customers: new Map(), nextFile: 501, answers: new Map(), deletedFileIds: new Set(), lose: new Map(), quotePo, refs: requestRefs, byRef: new Map()};
  // This application's own reading of a request and of a file: before or after its update of 2026-11-03 (state.quotePo), and before or
  // after its new numbering (state.refs).
  const statusObject = row => statusObjectOf(row, state.quotePo, state.refs), designEntry = file => designEntryOf(file, state.quotePo);
  /** Every request: by their numbers in the application as it is today (byOrder, which tests edit), by their requestRef with the new
   *  numbering (a request has no number before production's approval). */
  const allRows = () => state.refs ? [...state.byRef.values()] : [...state.byOrder.values()];
  /** A new request's number: as it is created today; none with the new numbering (numbered at production's approval). */
  const created = row => { row.requestRef = randomUUID(); state.byRef.set(row.requestRef, row); if (row.orderNo !== null) state.byOrder.set(row.orderNo, row); return row; };
  /** The last number + 1, given when production approves a request it has not numbered (the new numbering). */
  const numberIt = row => {
    if (row.orderNo !== null) return;
    const last = Math.max(state.nextOrder - 1, ...[...state.byRef.values()].map(other => other.orderNo ?? 0));
    row.orderNo = last + 1; state.nextOrder = row.orderNo + 1; state.byOrder.set(row.orderNo, row);
  };
  /** A request by what a test names it with: its number, its requestRef, or its crmRequestId. */
  const find = key => typeof key === 'number' ? state.byOrder.get(key) : state.byRef.get(key) || state.rows.get(key);
  const riyadh = () => new Date(now() + 3 * 3600_000).toISOString().slice(0, 19) + '+03:00';
  /** Every change: a new revision, and the wait restarts only when the step changes (yr_mreq_state_set). */
  const touch = row => { row.revision++; row.updatedAt = riyadh(); const step = waitingStep(row); if (step !== row.waitingStep) { row.waitingStep = step; row.waitingSince = riyadh(); } };

  function upsert(body) {
    const p = validateRequest(body, now(), {quotePo: state.quotePo});
    let row = state.rows.get(p.crmRequestId), isNew = false, linked = false;
    if (!row && p.legacyOrderNo !== null) {
      const legacy = state.byOrder.get(p.legacyOrderNo);
      if (!legacy || legacy.source !== 'import') throw new ApiError('invalid_payload', 400, 'No imported request has this legacyOrderNo.', ['legacyOrderNo']);
      if (legacy.crmRequestId !== null) throw new ApiError('request_locked', 409, 'This imported request is already linked to another CRM request.', [], {request: statusObject(legacy)});
      legacy.crmRequestId = p.crmRequestId; legacy.salesmanId = p.salesmanId; legacy.salesmanEmail = p.salesmanEmail; touch(legacy);
      state.rows.set(p.crmRequestId, legacy); row = legacy; linked = true;
    } else if (!row) {
      row = {crmRequestId: p.crmRequestId, orderNo: state.refs ? null : state.nextOrder++, source: 'crm', stages: blankStages(), approvals: noApprovals(), cancelled: false, delivered: false, deliveryDate: null, moldSerial: null, productionDate: null, revision: 0, updatedAt: null, waitingStep: null, waitingSince: null};
      for (const column of COLUMNS) row[column] = p[column];
      // What the CRM first sent, kept apart from the columns the production manager may edit: a retry is compared with it.
      row.original = Object.fromEntries(COLUMNS.map(column => [column, p[column]]));
      created(row); touch(row); state.rows.set(row.crmRequestId, row); isNew = true;
    } else {
      const linkRetry = p.legacyOrderNo !== null && row.orderNo === p.legacyOrderNo;
      // The ORIGINAL data again is a retry (200, created false), even after the production manager edited the request. Any other data
      // (the edited data included) is refused whatever the request's state: once sent, its data is edited by the production manager in
      // the products application only. Nothing changes.
      if (!linkRetry && !same(row.original || row, p)) throw new ApiError('request_locked', 409, 'The request\'s data is edited by the production manager only.', [], {reason: 'production_only', request: statusObject(row)});
    }
    return {status: isNew ? 201 : 200, body: {request: statusObject(row), created: isNew, linked}};
  }
  function status(body) {
    const ids = body.ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 200 || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id))) throw new ApiError('invalid_payload', 400, 'ids must be a list of 1 to 200 request ids.', ['ids']);
    const unique = [...new Set(ids)], found = unique.filter(id => state.rows.has(id));
    return {status: 200, body: {requests: found.map(id => statusObject(state.rows.get(id))), unknown: unique.filter(id => !state.rows.has(id))}};
  }
  function cancel(body) {
    const id = body.crmRequestId;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new ApiError('invalid_payload', 400, 'crmRequestId is required.', ['crmRequestId']);
    const reason = body.reason ?? '';
    if (typeof reason !== 'string' || [...reason].length > 500) throw new ApiError('invalid_payload', 400, 'reason is invalid.', ['reason']);
    const row = state.rows.get(id);
    if (!row) throw new ApiError('not_found', 404, 'No request has this crmRequestId.');
    if (derive(row) === 'cancelled') return {status: 200, body: {request: statusObject(row)}};
    // 2026-11-03: the same cancellation (its reason used before) after the production manager restored the request: 200 with the request
    // as it is, nothing cancelled, whatever its state now (approved since, or in production: no 409). A new reason cancels it again.
    if ((row.cancelReasons ||= []).includes(reasonKey(reason))) return {status: 200, body: {request: statusObject(row)}};
    if (derive(row) !== 'received') throw new ApiError('request_locked', 409, 'Production has started; the request can no longer be cancelled.', [], {request: statusObject(row)});
    row.cancelled = true; row.cancelReason = reason.trim(); row.cancelReasons.push(reasonKey(reason)); touch(row);
    return {status: 200, body: {request: statusObject(row)}};
  }

  /** yr_mreq_crm_approval: the sales manager's approval given in the CRM, or withdrawn; repeating either changes nothing. */
  function approval(body) {
    // requestRef is read by the application of the new numbering only (the one of today ignores it, as any field it does not know).
    const bad = [], id = body.crmRequestId ?? null, orderNo = body.orderNo ?? null, ref = state.refs ? body.requestRef ?? null : null;
    if (id !== null && (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id))) bad.push('crmRequestId');
    if (orderNo !== null && (!Number.isInteger(orderNo) || orderNo < 1)) bad.push('orderNo');
    if (ref !== null && (typeof ref !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref))) bad.push('requestRef');
    // One of them only: the crmRequestId of a request from the CRM, or the requestRef (the new numbering) or the orderNo of one
    // registered in the products application.
    const named = [id, orderNo, ref].filter(value => value !== null).length;
    if (named !== 1) bad.push(named === 0 ? 'crmRequestId' : id !== null && orderNo !== null ? 'orderNo' : 'requestRef');
    const action = choice(body.action, ['approve', 'withdraw'], true, 'action', bad);
    const by = body.by && typeof body.by === 'object' && !Array.isArray(body.by) ? body.by : null;
    if (!by) bad.push('by');
    const name = clean(by?.name, 160, true, 'by.name', bad), email = clean(by?.email, 190, false, 'by.email', bad);
    if (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad.push('by.email');
    if (bad.length) throw new ApiError('invalid_payload', 400, 'Some fields are missing or invalid.', [...new Set(bad)]);
    const row = id !== null ? state.rows.get(id) : ref !== null ? state.byRef.get(ref) : state.byOrder.get(orderNo);
    if (!row) throw new ApiError('not_found', 404, id !== null ? 'No request has this crmRequestId.' : ref !== null ? 'No request has this requestRef.' : 'No request has this orderNo.');
    const locked = message => new ApiError('request_locked', 409, message, [], {request: statusObject(row)});
    if (row.cancelled) throw locked('The request is cancelled.');
    if (row.approvals.legacy) throw locked('This request predates the approval chain and needs no approval.');
    if (action === 'approve') {
      if (row.approvals.sales) return {status: 200, body: {request: statusObject(row)}};
      row.approvals.sales = {by: email !== '' ? email + ' (' + name + ')' : name, at: riyadh(), via: 'crm'};
    } else {
      if (!row.approvals.sales) return {status: 200, body: {request: statusObject(row)}};
      if (row.approvals.production || row.approvals.admin) throw locked('Production has already approved; the sales approval can no longer be withdrawn.');
      row.approvals.sales = null;
    }
    touch(row);
    return {status: 200, body: {request: statusObject(row)}};
  }

  /** The customers route: the CRM's list (upsert, or full which also deactivates whoever is missing; nobody is deleted). */
  function customers(body) {
    const bad = [], mode = choice(body.mode, ['full', 'upsert'], true, 'mode', bad), list = body.customers;
    if (!Array.isArray(list) || list.length > 20000) bad.push('customers');
    const seen = new Set(), entries = [];
    for (const [index, item] of (Array.isArray(list) ? list : []).entries()) {
      const at = 'customers.' + index + '.', entry = item && typeof item === 'object' ? item : {};
      const crmNumber = int(entry.crmNumber, 1, 2147483647, true, at + 'crmNumber', bad);
      const name = clean(entry.name, 200, true, at + 'name', bad), address = clean(entry.address, 300, false, at + 'address', bad), city = clean(entry.city, 100, false, at + 'city', bad);
      // erpCode (2026-11-02): '' clears the stored code; a customer sent without it keeps what production holds.
      const erpCode = entry.erpCode === undefined ? state.customers.get(crmNumber)?.erpCode ?? '' : clean(entry.erpCode, 50, false, at + 'erpCode', bad);
      if (entry.active !== undefined && typeof entry.active !== 'boolean') bad.push(at + 'active');
      if (crmNumber !== null && seen.has(crmNumber)) bad.push(at + 'crmNumber');
      seen.add(crmNumber); entries.push({crmNumber, name, address, city, erpCode, active: entry.active !== false});
    }
    if (bad.length) throw new ApiError('invalid_payload', 400, 'Some fields are missing or invalid.', [...new Set(bad)].slice(0, 30));
    let inserted = 0, updated = 0, deactivated = 0;
    for (const entry of entries) {
      const before = state.customers.get(entry.crmNumber);
      if (!before) inserted++; else if (JSON.stringify(before) !== JSON.stringify(entry)) updated++;
      state.customers.set(entry.crmNumber, entry);
    }
    if (mode === 'full') for (const [number, entry] of state.customers) if (!seen.has(number) && entry.active) { state.customers.set(number, {...entry, active: false}); deactivated++; }
    return {status: 200, body: {received: entries.length, inserted, updated, deactivated, activeCustomers: [...state.customers.values()].filter(entry => entry.active).length}};
  }

  /** A change from the CRM during the approvals undoes the ones given (an edit, an attached or a deleted design file; since 2026-11-05 not
   *  a quotation's or PO's file). */
  const undoApprovals = row => { if (!row.approvals.legacy && APPROVAL_STEPS.some(step => row.approvals[step])) row.approvals = noApprovals(); };
  /** A refusal of the file for its place, not its bytes (PR #27): 400 invalid_payload, fields ['crmFileId'], details.reason. */
  const placeRefusal = (reason, message) => new ApiError('invalid_payload', 400, message, ['crmFileId'], {reason});
  /** design-files: one JSON line, a newline, the file's bytes. Safe to repeat: the same crmFileId with the same bytes answers 200. A
   *  crmFileId used for another file, or for a file deleted since, is refused (crm_file_id_used); so is an eleventh file (too_many_files). */
  function attachDesign(raw) {
    const cut = raw.indexOf(0x0a);
    let meta;
    try { meta = cut > 0 ? JSON.parse(raw.subarray(0, cut).toString('utf8')) : null; } catch { meta = null; }
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new ApiError('invalid_payload', 400, 'The body must start with one JSON line.', ['body']);
    const bytes = raw.subarray(cut + 1), bad = [];
    if (typeof meta.crmRequestId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(meta.crmRequestId)) bad.push('crmRequestId');
    if (typeof meta.crmFileId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(meta.crmFileId)) bad.push('crmFileId');
    // The updated application (2026-11-03) reads category (design when absent); the old one ignores it: every file is a design file.
    const category = !state.quotePo || meta.category === undefined || meta.category === null ? 'design' : meta.category;
    if (!Object.hasOwn(CATEGORY_LIMITS, category)) bad.push('category');
    const checked = checkDesign(meta.name, bytes);
    if (checked.field === 'name') bad.push('name');
    if (bad.length) throw new ApiError('invalid_payload', 400, 'Some fields are missing or invalid.', bad);
    // A quotation's or PO's file is a PDF or an image only.
    if (category !== 'design' && checked.kind === 'other') throw new ApiError('invalid_payload', 400, 'A quotation or PO file must be a PDF or an image.', ['name'], {reason: 'not_document'});
    if (bytes.length > DESIGN_MAX) throw new ApiError('payload_too_large', 413, 'The file is larger than 25 MB.');
    if (checked.field === 'file') throw new ApiError('invalid_payload', 400, 'The file was refused.', ['file'], {reason: checked.reason});
    const row = state.rows.get(meta.crmRequestId);
    if (!row) throw new ApiError('not_found', 404, 'No request has this crmRequestId.');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const known = allRows().flatMap(other => (other.designFiles || []).map(file => [other, file])).find(([, file]) => file.crmFileId === meta.crmFileId);
    if (known) {
      if (known[0] !== row || known[1].sha256 !== sha256 || (known[1].category || 'design') !== category) throw placeRefusal('crm_file_id_used', 'This crmFileId belongs to another file.');
      return {status: 200, body: {created: false, file: designEntry(known[1]), request: statusObject(row)}};
    }
    if (state.deletedFileIds.has(meta.crmFileId)) throw placeRefusal('crm_file_id_used', 'This crmFileId belonged to a file deleted since.');
    if (derive(row) !== 'received') throw new ApiError('request_locked', 409, 'The request is no longer editable.', [], {request: statusObject(row)});
    if ((row.designFiles ||= []).filter(file => (file.category || 'design') === category).length >= CATEGORY_LIMITS[category]) throw placeRefusal('too_many_files', 'A request holds at most ' + CATEGORY_LIMITS[category] + ' files of this kind.');
    const file = {fileId: state.nextFile++, crmFileId: meta.crmFileId, name: meta.name, kind: checked.kind, type: checked.type, bytes: Buffer.from(bytes), sha256, source: 'crm', uploadedAt: riyadh(), category};
    row.designFiles.push(file); if (category === 'design') undoApprovals(row); touch(row);
    return {status: 201, body: {created: true, file: designEntry(file), request: statusObject(row)}};
  }
  /** design-file-delete: a file the CRM sent, by its crmFileId; production's own files are not the CRM's to delete. */
  function deleteDesign(body) {
    const bad = [];
    if (typeof body.crmRequestId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.crmRequestId)) bad.push('crmRequestId');
    if (typeof body.crmFileId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.crmFileId)) bad.push('crmFileId');
    if (bad.length) throw new ApiError('invalid_payload', 400, 'Some fields are missing or invalid.', bad);
    const row = state.rows.get(body.crmRequestId), index = row?.designFiles?.findIndex(file => file.crmFileId === body.crmFileId) ?? -1;
    if (!row) throw new ApiError('not_found', 404, 'No request has this crmRequestId.');
    if (index < 0) throw new ApiError('not_found', 404, 'No file of this request has this crmFileId.');
    if (derive(row) !== 'received') throw new ApiError('request_locked', 409, 'The request is no longer editable.', [], {request: statusObject(row)});
    const [removed] = row.designFiles.splice(index, 1); state.deletedFileIds.add(body.crmFileId);
    if ((removed.category || 'design') === 'design') undoApprovals(row);
    touch(row);
    return {status: 200, body: {request: statusObject(row)}};
  }
  /** design-file: the file itself, its type and its name (filename* in UTF-8). */
  function downloadDesign(body) {
    const fileId = body.fileId;
    if (!(Number.isInteger(fileId) && fileId > 0) && !(typeof fileId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(fileId))) throw new ApiError('invalid_payload', 400, 'fileId is required.', ['fileId']);
    for (const row of allRows()) for (const file of row.designFiles || []) if (file.fileId === fileId) return {status: 200, file};
    throw new ApiError('not_found', 404, 'No file has this fileId.');
  }

  /** yr_mreq_crm_pending: every request waiting for the sales manager, the longest waiting first (up to 500); no production data. */
  function pending() {
    const rows = allRows().filter(row => waitingStep(row) === 'sales').sort((a, b) => String(a.waitingSince).localeCompare(String(b.waitingSince)) || (a.orderNo ?? 0) - (b.orderNo ?? 0)).slice(0, 500);
    return {status: 200, body: {requests: rows.map(row => ({orderNo: row.orderNo, ...(state.refs ? {requestRef: row.requestRef} : {}), crmRequestId: row.crmRequestId, source: row.source, requestedAt: row.requestedAt, waitingSince: row.waitingSince,
      enteredBy: row.source === 'manual' ? row.createdBy : null, customer: {crmNumber: row.customerNo, name: row.customerName, address: row.customerAddress, city: row.customerCity},
      salesman: {crmMemberId: row.salesmanId, name: row.salesmanName},
      specs: {description: row.description, core: row.core, vibrators: row.vibrators, model: row.model, halfBlock: row.halfBlock, moldWidth: row.moldWidth, gelbaSize: row.gelbaSize, moldNo: row.moldNo, quantity: row.quantity, designUrl: row.designUrl, notes: row.notes},
      payment: row.payment ?? null, revision: row.revision, ...quotePoPart(row, state.quotePo)}))}};
  }

  const server = createServer({key: readFileSync(key), cert: readFileSync(cert)}, async (req, res) => {
    if (state.down) { req.socket.destroy(); return; }
    const parts = [];
    for await (const part of req) parts.push(part);
    const raw = Buffer.concat(parts), url = new URL(req.url, 'https://localhost'), route = url.searchParams.get('route') || '';
    // A lost answer (loseNext): production did the work, and the connection is cut before its answer.
    const reply = (http, body) => { if (call.lost) { req.socket.destroy(); return; } res.writeHead(http, {'Content-Type': 'application/json; charset=utf-8'}); res.end(JSON.stringify(body)); };
    const call = {route, at: now(), signed: false, body: route === 'design-files' ? raw.subarray(0, Math.max(raw.indexOf(0x0a), 0)).toString('utf8') : raw.toString('utf8'), bytes: raw.length, headers: {...req.headers}};
    state.calls.push(call);
    if (state.delayMs) await new Promise(resolve => setTimeout(resolve, state.delayMs));
    try {
      if (req.method !== 'POST') throw new ApiError('method_not_allowed', 405, 'Use POST.');
      if (!['requests', 'status', 'cancel', 'approval', 'pending', 'customers', 'design-files', 'design-file-delete', 'design-file'].includes(route)) throw new ApiError('invalid_payload', 400, 'Unknown route.', ['route']);
      if (state.notConfigured) throw new ApiError('not_configured', 503, 'The integration secret is not configured.');
      const timestamp = String(req.headers['x-yr-timestamp'] || ''), signature = String(req.headers['x-yr-signature'] || '');
      if (!/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)) throw new ApiError('invalid_signature', 401, 'Missing or malformed signature headers.');
      if (raw.length > (route === 'customers' ? 2 * 1024 * 1024 : route === 'design-files' ? DESIGN_MAX + 64 * 1024 : 64 * 1024)) throw new ApiError('payload_too_large', 413, route === 'customers' ? 'The body is larger than 2 MB.' : route === 'design-files' ? 'The file is larger than 25 MB.' : 'The body is larger than 64 KB.');
      if (Math.abs(Math.floor(now() / 1000) - Number(timestamp)) > 300) throw new ApiError('stale_timestamp', 401, 'The timestamp is more than 300 seconds from the server clock.');
      const expected = createHmac('sha256', state.secret).update(timestamp + '\n' + req.method + '\n' + route + '\n' + createHash('sha256').update(raw).digest('hex')).digest('hex');
      if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) { state.badSignatures++; throw new ApiError('invalid_signature', 401, 'The signature does not match.'); }
      call.signed = true;
      if (state.lose.get(route)) { state.lose.set(route, state.lose.get(route) - 1); call.lost = true; }
      // A test's one-shot answer for this route (a refusal the CRM's own checks would never let through), after a valid signature.
      const forced = state.answers.get(route)?.shift();
      if (forced) { call.forced = true; reply(forced.http, forced.body); return; }
      if (route === 'design-files') {
        if (!/^application\/octet-stream\b/i.test(String(req.headers['content-type'] || ''))) throw new ApiError('invalid_payload', 400, 'design-files takes application/octet-stream.', ['body']);
        const result = attachDesign(raw);
        reply(result.status, result.body); return;
      }
      let body;
      try { body = JSON.parse(raw.toString('utf8')); } catch { throw new ApiError('invalid_payload', 400, 'The body is not valid JSON.', ['body']); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('invalid_payload', 400, 'The body must be a JSON object.', ['body']);
      if (route === 'design-file') {
        const {file} = downloadDesign(body);
        res.writeHead(200, {'Content-Type': file.type, 'Content-Length': String(file.bytes.length), 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(file.name.toWellFormed())});
        res.end(file.bytes); return;
      }
      const result = route === 'requests' ? upsert(body) : route === 'status' ? status(body) : route === 'approval' ? approval(body) : route === 'pending' ? pending() : route === 'customers' ? customers(body)
        : route === 'design-file-delete' ? deleteDesign(body) : cancel(body);
      reply(result.status, result.body);
    } catch (error) {
      if (!(error instanceof ApiError)) { reply(500, {error: {code: 'server_error', message: 'Unexpected server error.'}}); return; }
      const out = {code: error.code, message: error.message};
      if (error.fields.length) out.fields = error.fields;
      if (Object.keys(error.details).length) out.details = error.details;
      reply(error.http, {error: out});
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  return {
    url: `https://localhost:${port}/products/crm-api.php`, ca: cert, state,
    /** Historical rows of the sheet, as the production app imports them (orderNo 1..n, source import, not linked). */
    seedLegacy(count) { for (let n = 1; n <= count; n++) created({crmRequestId: null, orderNo: n, source: 'import', stages: blankStages(), approvals: {...noApprovals(), legacy: true}, cancelled: false, delivered: false, deliveryDate: null, moldSerial: null, productionDate: null, revision: 1, updatedAt: null, waitingStep: 'manufacturing', waitingSince: '2026-04-19T13:45:47+03:00', ...Object.fromEntries(COLUMNS.map(c => [c, null]))}); },
    /** A request registered directly in the products application (source manual, no crmRequestId), waiting for the sales manager. */
    registerManual({customerNo = null, customerName = 'مصنع مسجّل في الإنتاج', salesmanName = 'مندوب', createdBy = 'staff@yourrest.org', description = 'manual mold', quantity = 1, payment = null, quoteNo = null, poNo = null} = {}) {
      const row = {crmRequestId: null, orderNo: state.refs ? null : state.nextOrder++, source: 'manual', createdBy, stages: blankStages(), approvals: noApprovals(), cancelled: false, delivered: false, deliveryDate: null, moldSerial: null, productionDate: null, revision: 0, updatedAt: null, waitingStep: null, waitingSince: null,
        ...Object.fromEntries(COLUMNS.map(c => [c, null])), requestedAt: new Date(now()).toISOString(), customerNo, customerName, customerAddress: '', customerCity: 'الدمام', salesmanId: '', salesmanName, salesmanEmail: '',
        description, core: 'open', vibrators: 2, model: 'old', halfBlock: 'two', moldWidth: 1380, gelbaSize: 795, moldNo: '', quantity, designUrl: null, notes: '', payment, quoteNo, poNo};
      created(row); touch(row);
      return row;
    },
    /** The production manager edits a request in the products application (by its crmRequestId, or the orderNo of one registered there):
     *  its columns change (customerName, salesmanName, quantity, description…); the CRM's first data stays the original a retry is
     *  compared with, and pending lists the edited data. The approvals stay as they are. */
    edit(key, changes) {
      const row = find(key); if (!row) throw new Error('no such request: ' + key);
      for (const [column, value] of Object.entries(changes)) { if (!COLUMNS.includes(column)) throw new Error('no such column: ' + column); row[column] = value; }
      touch(row);
      return statusObject(row);
    },
    /** An approval given in the production app (production, or the system administrator; the sales manager's too, outside the CRM),
     *  by the request's crmRequestId, requestRef or number. With the new numbering production's approval numbers the request. */
    approve(key, step, by = 'staff@yourrest.org') {
      const row = find(key); if (!row) throw new Error('no such request: ' + key);
      row.approvals[step] = {by, at: riyadh()}; if (state.refs && step === 'production') numberIt(row); touch(row);
      return statusObject(row);
    },
    /** Production work on a request: marks stages done (with dates), a serial, a production date, delivery. confirmed: the three
     *  approvals are given first (production may record nothing before them). */
    produce(crmRequestId, {stages = [], moldSerial = null, productionDate = null, delivered = false, deliveryDate = null, confirmed = true} = {}) {
      const row = state.rows.get(crmRequestId); if (!row) throw new Error('no such request: ' + crmRequestId);
      if (confirmed) for (const step of APPROVAL_STEPS) row.approvals[step] ||= {by: 'staff@yourrest.org', at: riyadh()};
      if (state.refs && row.approvals.production) numberIt(row);
      for (const [index, stage] of stages.entries()) row.stages[stage] = {done: true, at: '2026-11-0' + (index + 1)};
      Object.assign(row, {moldSerial, productionDate, delivered, deliveryDate}); touch(row);
    },
    /** A request deleted in the products application (yr_mreq_admin_mutate delete-request): kept there and cancelled, so the CRM
     *  reads it as cancelled. */
    remove(crmRequestId, reason = 'حذف من تطبيق الإنتاج') {
      if (state.refs) throw new Error('production no longer deletes a mold request (2026-11-05): cancelHere');
      const row = state.rows.get(crmRequestId); if (!row) throw new Error('no such request: ' + crmRequestId);
      row.deleted = true; row.cancelled = true; row.cancelReason ||= reason; touch(row);
    },
    /** The production manager restores a cancelled (or deleted) request (2026-11-03), by its crmRequestId or its orderNo: back where it
     *  stood before the cancellation (its approvals, stages and files are untouched by a cancellation), with a new revision. Its earlier
     *  cancellations' reasons stay used: the same cancellation again answers 200 with the request as it is. */
    restore(key) {
      const row = find(key); if (!row) throw new Error('no such request: ' + key);
      if (!row.cancelled) throw new Error('not cancelled: ' + key);
      row.cancelled = false; row.deleted = false; touch(row);
      return statusObject(row);
    },
    /** The same for a request registered in production itself, named by its order number. */
    removeOrder(orderNo, reason = 'حذف من تطبيق الإنتاج') {
      if (state.refs) throw new Error('production no longer deletes a mold request (2026-11-05): cancelHere');
      const row = state.byOrder.get(orderNo); if (!row) throw new Error('no such order: ' + orderNo);
      row.deleted = true; row.cancelled = true; row.cancelReason ||= reason; touch(row);
    },
    /** A design file production attaches itself (source production, no crmFileId), to a request of the CRM (by its crmRequestId) or
     *  to one registered in production (by its orderNo). It changes nothing in the approvals here (production manages its own files). */
    addProductionFile(key, {name = 'تصميم الإنتاج.pdf', bytes = Buffer.from('%PDF-1.4 production drawing'), category = 'design'} = {}) {
      const row = find(key); if (!row) throw new Error('no such request: ' + key);
      const checked = checkDesign(name, Buffer.from(bytes));
      if (!checked.kind) throw new Error('production would refuse this file: ' + (checked.reason || checked.field));
      if (category !== 'design' && (!state.quotePo || checked.kind === 'other')) throw new Error('production would refuse this ' + category + ' file');
      const file = {fileId: state.nextFile++, crmFileId: null, name, kind: checked.kind, type: checked.type, bytes: Buffer.from(bytes), sha256: createHash('sha256').update(bytes).digest('hex'), source: 'production', uploadedAt: riyadh(), category};
      (row.designFiles ||= []).push(file); touch(row);
      return designEntry(file);
    },
    /** A file of the CRM deleted in the products application itself (by its crmFileId): gone from the request, and its crmFileId is
     *  never taken again. Changes nothing in the approvals here. */
    removeFile(crmFileId) {
      for (const row of allRows()) {
        const index = (row.designFiles || []).findIndex(file => file.crmFileId === crmFileId);
        if (index >= 0) { row.designFiles.splice(index, 1); state.deletedFileIds.add(crmFileId); touch(row); return true; }
      }
      throw new Error('no such file: ' + crmFileId);
    },
    /** The next call of a route (signed as usual) gets this answer instead of the route's own, once: for an answer the stand-in's rules
     *  never give to what the CRM sends (production refusing a file the CRM's own checks accepted, a 413 from its web server). */
    answerNext(route, http, body) { const queue = state.answers.get(route) || []; queue.push({http, body}); state.answers.set(route, queue); },
    /** The next call of a route is carried out as usual, but its answer is lost (the connection is cut): the CRM never learns of it. */
    loseNext(route) { state.lose.set(route, (state.lose.get(route) || 0) + 1); },
    /** The application before (false) or after (true) its update of 2026-11-03 (the quotation and PO), as it stands since the message of
     *  2026-11-05: what it reads and answers changes at once; quoteOrPoMissing follows the files and finance's approval alone. */
    setQuotePo(on = true) { state.quotePo = !!on; },
    /** The production manager adds or corrects a request's quotation or PO number in the products application (by its crmRequestId, or
     *  the orderNo of one registered there): normalized as the application stores it; the CRM's original data a retry is compared with
     *  stays as it was. Answers the status object as it now stands. */
    setNumbers(key, {quoteNo, poNo} = {}) {
      const row = find(key); if (!row) throw new Error('no such request: ' + key);
      for (const [column, value] of [['quoteNo', quoteNo], ['poNo', poNo]]) {
        if (value === undefined) continue;
        const clean = quotePoNumber(value);
        if (clean === undefined) throw new Error('production would refuse this ' + column);
        row[column] = clean;
      }
      touch(row);
      return statusObject(row);
    },
    /** Production no longer knows a request (only to test the 404 answers: the real application keeps every request). */
    forget(crmRequestId) { const row = state.rows.get(crmRequestId); state.rows.delete(crmRequestId); if (row) { state.byOrder.delete(row.orderNo); state.byRef.delete(row.requestRef); } },
    /** The application of today (false) or of the new numbering (true), at once: what is numbered stays numbered. */
    setRequestRefs(on = true) { state.refs = !!on; },
    /** Production cancels a request itself (the new numbering: it no longer deletes one), by its crmRequestId, requestRef or number: it
     *  keeps its number. */
    cancelHere(key, reason = 'ألغاه مدير الإنتاج') {
      const row = find(key); if (!row) throw new Error('no such request: ' + key);
      row.cancelled = true; row.cancelReason ||= reason; touch(row);
      return statusObject(row);
    },
    /** The one-time renumbering (2026-11-05): the numbers from `from` (101) up move down by one to fill the gap of the deleted test
     *  request (from - 1, which must be free). Done in production's database, without a new revision or time. */
    renumber(from = 101) {
      if (state.byOrder.has(from - 1)) throw new Error('order ' + (from - 1) + ' is not free');
      const moved = [...state.byOrder.values()].filter(row => row.orderNo >= from).sort((a, b) => a.orderNo - b.orderNo);
      for (const row of moved) { state.byOrder.delete(row.orderNo); row.orderNo -= 1; state.byOrder.set(row.orderNo, row); }
      state.nextOrder = Math.max(0, ...state.byOrder.keys()) + 1;
      return moved.map(row => row.orderNo);
    },
    row: id => state.rows.get(id),
    /** A request by its requestRef (every request has one; the application shows it only with the new numbering). */
    byRef: ref => state.byRef.get(ref),
    async stop() { server.closeAllConnections?.(); server.close(); rmSync(work, {recursive: true, force: true}); },
  };
}
