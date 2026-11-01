// The mold requests contract with yourrest-products, version 1 (docs/MOLD-REQUESTS-CONTRACT-AR.md and its addendum
// docs/MOLD-REQUESTS-CONTRACT-ADDENDUM-AR.md): the values and limits both sides accept, the request body the CRM sends, the status
// object it receives, how an answer is read and when a failed send is tried again. Pure functions, no I/O and no secret: the server,
// the browser form and the historical import tool (release/operations) share them.

/** The seven production stages in their fixed order, shown by their English names as in the production sheet (§3). */
export const MOLD_STAGES = ['laserCutting', 'box', 'coreConnector', 'lowerMold', 'tempershoe', 'alignment', 'paint'];
export const MOLD_STAGE_NAMES = {laserCutting: 'Laser Cutting', box: 'BOX', coreConnector: 'Core and Connector', lowerMold: 'Lower Mold', tempershoe: 'Tempershoe', alignment: 'Alignment', paint: 'Paint'};
export const MOLD_STATUSES = ['received', 'confirmed', 'in_production', 'produced', 'delivered', 'cancelled'];
/** The allowed values (§2), with the Arabic names the contract gives them. */
export const MOLD_CORES = {open: 'مفتوح', closed: 'مغلق'};
export const MOLD_VIBRATORS = [2, 3, 4];
export const MOLD_MODELS = {old: 'موديل قديم', gelba_new: 'جلبة موديل جديد', new: 'موديل جديد'};
export const MOLD_HALF_BLOCKS = {none: 'بدون بلوكة نص', one: 'بلوكة نص واحدة', two: 'بلوكتين نص', three: '3 بلوكات نص'};
/** Where a request waits now (the contract's waitingStep, 2026-11-01): the three approvals in order (sales manager, production, system
 *  administrator), then manufacturing, delivery, done or cancelled. */
export const MOLD_WAITING_STEPS = ['sales', 'production', 'admin', 'manufacturing', 'delivery', 'done', 'cancelled'];
export const MOLD_APPROVAL_STEPS = ['sales', 'production', 'admin'];
/** The `approval` route's actions: the sales manager approves a request in the CRM, or withdraws the approval. */
export const MOLD_APPROVAL_ACTIONS = ['approve', 'withdraw'];
export const MOLD_RANGES = {moldWidth: [1000, 2000], gelbaSize: [500, 1200], quantity: [1, 100]};
export const MOLD_USUAL = {moldWidth: [1380, 1375], gelbaSize: [795, 800]};
/** Text limits in characters: the stricter of the contract (§2, other texts 160) and the addendum (customer name 200, city 100, email 190). */
export const MOLD_LIMITS = {description: 200, moldNo: 40, designUrl: 1000, notes: 2000, customerName: 160, address: 300, city: 100, salesmanName: 160, email: 160, crmMemberId: 64, cancelReason: 500};
export const MOLD_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const MOLD_TIMEOUT_MS = 10_000;
export const MOLD_STATUS_BATCH = 200;
export const MOLD_BODY_LIMIT = 64 * 1024;
/** §6: after a failed send, the next try waits 1 minute, then 5, then 30, then 2 hours, then every 2 hours until 24 hours have passed. */
export const MOLD_RETRY_MINUTES = [1, 5, 30, 120];
export const MOLD_RETRY_WINDOW_MS = 24 * 3600_000;

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const length = value => [...value].length;

/** The text as production stores it: runs of spaces, tabs and no-break spaces become one space, the ends are trimmed. A control
 * character production refuses makes it undefined. */
export function moldText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string' || CONTROL.test(value)) return undefined;
  return value.replace(/[ \t ]+/g, ' ').trim();
}
const isWhole = value => typeof value === 'number' && Number.isInteger(value);

/**
 * Checks what a representative typed. Returns {specs, errors}: specs with every field normalized, errors as field -> Arabic message.
 * Numbers arrive as JSON numbers or as digit strings from a form; anything else, or a fraction, is refused (the addendum).
 * @param {unknown} input
 * @returns {{specs: Record<string, any>, errors: Record<string, string>}}
 */
export function validateMoldSpecs(input) {
  const source = input && typeof input === 'object' ? input : {}, errors = {}, specs = {};
  const text = (field, max, required, label) => {
    const value = moldText(source[field]);
    if (value === undefined) errors[field] = label + ' فيه رموز غير مسموحة';
    else if (required && !value) errors[field] = 'اكتب ' + label;
    else if (length(value) > max) errors[field] = label + ' حتى ' + max + ' حرفًا';
    specs[field] = value || '';
  };
  const choice = (field, allowed, label) => {
    const value = source[field];
    if (!Object.prototype.hasOwnProperty.call(allowed, value)) errors[field] = 'اختر ' + label;
    specs[field] = typeof value === 'string' ? value : '';
  };
  const whole = (field, [min, max], label) => {
    let value = source[field];
    if (typeof value === 'string' && /^\s*\d+\s*$/.test(value)) value = Number(value);
    if (!isWhole(value) || value < min || value > max) errors[field] = label + ' عدد صحيح من ' + min + ' إلى ' + max;
    specs[field] = isWhole(value) ? value : null;
  };
  text('description', MOLD_LIMITS.description, true, 'وصف القالب');
  choice('core', MOLD_CORES, 'العلب');
  let vibrators = source.vibrators;
  if (typeof vibrators === 'string' && /^\d$/.test(vibrators.trim())) vibrators = Number(vibrators);
  if (!MOLD_VIBRATORS.includes(vibrators)) errors.vibrators = 'اختر عدد الرجاجات (2 أو 3 أو 4)';
  specs.vibrators = MOLD_VIBRATORS.includes(vibrators) ? vibrators : null;
  choice('model', MOLD_MODELS, 'الموديل');
  choice('halfBlock', MOLD_HALF_BLOCKS, 'بلوكة النص');
  whole('moldWidth', MOLD_RANGES.moldWidth, 'عرض القالب');
  whole('gelbaSize', MOLD_RANGES.gelbaSize, 'مقاس الجلب');
  text('moldNo', MOLD_LIMITS.moldNo, false, 'رقم القالب');
  whole('quantity', MOLD_RANGES.quantity, 'الكمية');
  text('designUrl', MOLD_LIMITS.designUrl, false, 'رابط التصميم');
  if (!errors.designUrl && specs.designUrl && !/^https:\/\/\S+$/i.test(specs.designUrl)) errors.designUrl = 'رابط التصميم يبدأ بـ https:// ومن غير مسافات';
  text('notes', MOLD_LIMITS.notes, false, 'الملاحظات');
  return {specs, errors};
}

/** The CRM's time as the contract writes it: ISO 8601 with Riyadh's offset (+03:00, no daylight saving). */
export function riyadhIso(value) {
  const at = new Date(value);
  if (!Number.isFinite(at.getTime())) throw new Error('invalid time');
  return new Date(at.getTime() + 3 * 3600_000).toISOString().slice(0, 19) + '+03:00';
}

/**
 * The body of the `requests` route (§2), keys in a fixed order so a retry sends the very same bytes. Optional texts are left out
 * when empty; `customer.crmNumber` is always there (the addendum). Throws when a value would be refused by production.
 * @param {{id: string, legacyOrderNo?: number|null, requestedAt: string, customer: any, salesman: any, specs: any}} request
 */
export function moldRequestBody({id, legacyOrderNo = null, requestedAt, customer, salesman, specs}) {
  if (!MOLD_ID.test(id || '')) throw new Error('crmRequestId');
  if (!isWhole(customer?.crmNumber) || customer.crmNumber < 1 || customer.crmNumber > 2147483647) throw new Error('customer.crmNumber');
  const checked = validateMoldSpecs(specs);
  if (Object.keys(checked.errors).length) throw new Error('specs.' + Object.keys(checked.errors)[0]);
  const optional = (target, key, value, max) => { const clean = moldText(value); if (clean && length(clean) <= max) target[key] = clean; };
  const name = moldText(customer.name), salesmanName = moldText(salesman?.name);
  if (!name || length(name) > MOLD_LIMITS.customerName) throw new Error('customer.name');
  if (!salesmanName || length(salesmanName) > MOLD_LIMITS.salesmanName) throw new Error('salesman.name');
  const body = {crmRequestId: id};
  if (legacyOrderNo !== null) { if (!isWhole(legacyOrderNo) || legacyOrderNo < 1) throw new Error('legacyOrderNo'); body.legacyOrderNo = legacyOrderNo; }
  body.requestedAt = requestedAt;
  body.customer = {crmNumber: customer.crmNumber, name};
  optional(body.customer, 'address', customer.address, MOLD_LIMITS.address);
  optional(body.customer, 'city', customer.city, MOLD_LIMITS.city);
  body.salesman = {};
  optional(body.salesman, 'crmMemberId', salesman.crmMemberId, MOLD_LIMITS.crmMemberId);
  body.salesman.name = salesmanName;
  const email = moldText(salesman.email);
  if (email && length(email) <= MOLD_LIMITS.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) body.salesman.email = email;
  const s = checked.specs;
  body.specs = {description: s.description, core: s.core, vibrators: s.vibrators, model: s.model, halfBlock: s.halfBlock, moldWidth: s.moldWidth, gelbaSize: s.gelbaSize};
  if (s.moldNo) body.specs.moldNo = s.moldNo;
  body.specs.quantity = s.quantity;
  if (s.designUrl) body.specs.designUrl = s.designUrl;
  if (s.notes) body.specs.notes = s.notes;
  return body;
}

const dateOrNull = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 40) : null;
const shortOrNull = (value, max) => typeof value === 'string' ? value.slice(0, max) : null;
/** The approvals as the status object carries them: when each was given (null: not yet) and, for the sales manager's approval given
 *  in the CRM only, by whom. required false: a historical request that needs none. null when production sent none (an older app). */
function approvalsOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.required !== 'boolean') return null;
  /** @type {{required: boolean, sales: {at: string|null, by?: string}|null, production: {at: string|null}|null, admin: {at: string|null}|null}} */
  const out = {required: value.required, sales: null, production: null, admin: null};
  for (const step of MOLD_APPROVAL_STEPS) {
    const given = value[step];
    if (!given || typeof given !== 'object') continue;
    out[step] = {at: dateOrNull(given.at)};
    if (step === 'sales' && typeof given.by === 'string' && given.by.trim()) out.sales = {at: out.sales.at, by: given.by.trim().slice(0, 200)};
  }
  return out;
}
/** A status object (§3) as received, reduced to the fields the contract names; null when it is not one.
 * @param {any} value */
export function moldStatusObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!MOLD_ID.test(value.crmRequestId || '') || !MOLD_STATUSES.includes(value.status) || typeof value.editable !== 'boolean') return null;
  /** @type {Record<string, {done: boolean, at: string|null}>} */
  const stages = {};
  for (const key of MOLD_STAGES) { const stage = value.stages?.[key]; stages[key] = {done: stage?.done === true, at: dateOrNull(stage?.at)}; }
  return {
    crmRequestId: value.crmRequestId, orderNo: isWhole(value.orderNo) ? value.orderNo : null, status: value.status, editable: value.editable,
    moldSerial: shortOrNull(value.moldSerial, 40), productionDate: dateOrNull(value.productionDate), stages,
    stagesDone: MOLD_STAGES.filter(key => stages[key].done).length, stagesTotal: MOLD_STAGES.length,
    delivered: value.delivered === true, deliveryDate: dateOrNull(value.deliveryDate), updatedAt: shortOrNull(value.updatedAt, 40), revision: isWhole(value.revision) ? value.revision : null,
    waitingStep: MOLD_WAITING_STEPS.includes(value.waitingStep) ? value.waitingStep : null, waitingSince: dateOrNull(value.waitingSince), approvals: approvalsOf(value.approvals),
  };
}

/**
 * The body of the `approval` route: the sales manager's approval in the CRM, or its withdrawal. Throws on a value production refuses.
 * @param {{id: string, action: string, by: {name?: string, email?: string}}} input
 */
export function moldApprovalBody({id, action, by}) {
  if (!MOLD_ID.test(id || '')) throw new Error('crmRequestId');
  if (!MOLD_APPROVAL_ACTIONS.includes(action)) throw new Error('action');
  const name = moldText(by?.name), email = moldText(by?.email);
  if (!name || length(name) > MOLD_LIMITS.salesmanName) throw new Error('by.name');
  const body = {crmRequestId: id, action, by: {name}};
  if (email && length(email) <= MOLD_LIMITS.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) body.by.email = email;
  return body;
}

/**
 * What an answer means for the CRM (§4): ok (the request object came back), locked (409 request_locked: production started),
 * not_found (404 on cancel), rejected (400/413: the data must change before a retry helps) or retry (anything else: network, timeout,
 * 401, 503 not_configured, 5xx, a reply that is not the contract's).
 * @param {number} httpStatus
 * @param {any} json
 * @returns {{kind: 'ok'|'locked'|'not_found'|'rejected'|'retry', code: string, fields: string[], request?: any}}
 */
export function readMoldAnswer(httpStatus, json) {
  const error = json && typeof json === 'object' && json.error && typeof json.error === 'object' ? json.error : null;
  const code = typeof error?.code === 'string' ? error.code.slice(0, 40) : '';
  const fields = Array.isArray(error?.fields) ? error.fields.filter(field => typeof field === 'string').map(field => field.slice(0, 60)).slice(0, 30) : [];
  if (httpStatus >= 200 && httpStatus < 300 && !error) return {kind: 'ok', code: '', fields};
  if (httpStatus === 409 && code === 'request_locked') return {kind: 'locked', code, fields, request: moldStatusObject(error.details?.request)};
  if (httpStatus === 404 && code === 'not_found') return {kind: 'not_found', code, fields};
  if (httpStatus === 400 || httpStatus === 413) return {kind: 'rejected', code: code || 'http_' + httpStatus, fields};
  return {kind: 'retry', code: code || 'http_' + httpStatus, fields};
}

/**
 * When to try a failed send again (§6), from the number of failures so far (1 after the first) and when the first one happened.
 * null: 24 hours have passed; the request stays waiting and the representative's resend button is the way on.
 */
export function moldNextAttempt(failures, firstFailedAt, now) {
  const minutes = MOLD_RETRY_MINUTES[Math.min(Math.max(failures, 1), MOLD_RETRY_MINUTES.length) - 1];
  const next = Date.parse(now) + minutes * 60_000, first = Date.parse(firstFailedAt);
  if (!Number.isFinite(first) || next > first + MOLD_RETRY_WINDOW_MS) return null;
  return new Date(next).toISOString();
}
