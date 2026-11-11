// The mold requests contract with yourrest-products, version 1 (docs/MOLD-REQUESTS-CONTRACT-AR.md and its addendum
// docs/MOLD-REQUESTS-CONTRACT-ADDENDUM-AR.md, with the design files of 2026-11-02): the values and limits both sides accept, the request
// body the CRM sends, the design files it attaches, the status object it receives, how an answer is read and when a failed send is
// tried again. Pure functions, no I/O and no secret: the server, the browser form and the historical import tool (release/operations)
// share them. Since production's second update of 2026-11-03: the quotation and PO numbers (quoteNo, poNo) and their files (category).
// Since 2026-11-04: the customer's signature (moldSignatureCheck), a PNG sent as a design image; the requests body is unchanged.
// Since production's update of 2026-11-05: the quotation's or PO's FILE is what counts (quoteOrPoMissing: no such file and finance has not
// approved); the numbers are no longer asked for nor sent with a new request (a request stored with one still sends it, byte for byte).
// Since 2026-11-09: a customer not in the CRM (customer.crmNumber null with customer.erpCode, moldRequestBody; moldCustomerName,
// moldErpCode), and how the CRM learns that production takes one (moldFreeCustomersAnswered: customer.erpCode in a status or pending item).
// Since 2026-11-10: the customer's signature inside the request's PDFs (moldSignatureBlockCheck, moldSignedCopyName: a signed copy is one
// more file of its original's category, production unchanged) and the link the customer signs from (MOLD_SIGN_TOKEN, MOLD_SIGN_LINK_DAYS).

/** The seven production stages in their fixed order, shown by their English names as in the production sheet (§3). */
export const MOLD_STAGES = ['laserCutting', 'box', 'coreConnector', 'lowerMold', 'tempershoe', 'alignment', 'paint'];
export const MOLD_STAGE_NAMES = {laserCutting: 'Laser Cutting', box: 'BOX', coreConnector: 'Core and Connector', lowerMold: 'Lower Mold', tempershoe: 'Tempershoe', alignment: 'Alignment', paint: 'Paint'};
export const MOLD_STATUSES = ['received', 'confirmed', 'in_production', 'produced', 'delivered', 'cancelled'];
/** The allowed values (§2), with the Arabic names the contract gives them. */
export const MOLD_CORES = {open: 'مفتوح', closed: 'مغلق'};
export const MOLD_VIBRATORS = [2, 3, 4];
export const MOLD_MODELS = {old: 'موديل قديم', gelba_new: 'جلبة موديل جديد', new: 'موديل جديد'};
export const MOLD_HALF_BLOCKS = {none: 'بدون بلوكة نص', one: 'بلوكة نص واحدة', two: 'بلوكتين نص', three: '3 بلوكات نص'};
/** How the customer pays (yourrest-products 2026-11-03): `payment` in the requests body beside customer, salesman and specs, chosen by
 *  the representative when asking. Production refuses any other value (400 invalid_payload, fields ['payment']); a request sent before
 *  has none (pending lists it as null). */
export const MOLD_PAYMENTS = {cash: 'نقدي', deferred: 'آجل'};
export const MOLD_PAYMENT_REQUIRED = 'اختار طريقة الدفع: نقدي أو آجل';
/** How a deferred payment is to be paid (the owner, 2026-11-10: «فى حال طلب الدفع اجل يجب على المندوب يختار طريقة الدفع المتفق عليها»): one of
 *  three, required with "deferred" and never with "cash"; sent as `paymentTerms` beside `payment` only by a request that carries it (the
 *  products update of 2026-11-10 reads it; the application before ignores it, as any key it does not know). */
export const MOLD_PAYMENT_TERMS = Object.freeze({advance_before_shipping: 'دفعة مقدمة واستكمال باقي المبلغ قبل الترحيل', advance_after_shipping: 'دفعة مقدمة واستكمال باقي المبلغ بعد الترحيل', advance_credit_limit: 'دفعة مقدمة واستكمال باقي المبلغ حد ائتماني'});
export const MOLD_PAYMENT_TERMS_REQUIRED = 'اختار طريقة الدفع المتفق عليها';
/** A page loaded before 2026-11-10 asks for a deferred request without the terms (it shows no such field). */
export const MOLD_PAYMENT_TERMS_REFRESH = 'حدّث الصفحة واختار طريقة الدفع المتفق عليها';
export const MOLD_PAYMENT_TERMS_CASH = 'طريقة الدفع المتفق عليها للدفع الآجل بس';
/** The code of a payment's terms, or null when it is not one of the three.
 * @param {unknown} value
 * @returns {'advance_before_shipping'|'advance_after_shipping'|'advance_credit_limit'|null} */
export const moldPaymentTerms = value => typeof value === 'string' && Object.prototype.hasOwnProperty.call(MOLD_PAYMENT_TERMS, value) ? /** @type {'advance_before_shipping'|'advance_after_shipping'|'advance_credit_limit'} */ (value) : null;
/** The sales manager's acknowledgement that goes with every approval (2026-11-10), sent as termsAccepted: true. */
export const MOLD_TERMS_ACCEPT = 'تمت الموافقة على التصنيع بشروط الدفع المذكورة وقت الإستلام';
/** The quotation and PO numbers (yourrest-products 2026-11-03, its second update of the day): `quoteNo` and `poNo` in the requests body
 *  after payment, each a text of up to 60 characters as written on the document (Arabic-Indic digits as ASCII digits, the ends trimmed),
 *  sent only when the request carries them. Since production's update of 2026-11-05 the CRM no longer asks for them: a new request
 *  carries none; one stored with a number (asked for on 2026-11-03/04) keeps it and is sent with it, byte for byte (production still
 *  accepts and stores them, without showing or counting them). The update of 2026-11-03 is known by the key `quoteOrPoMissing` in a status
 *  object (moldQuotePoAnswered); since 2026-11-05 that flag means the request has neither a quotation file nor a PO file and finance has
 *  not approved it yet (a number alone is not enough). */
export const MOLD_QUOTE_PO_MAX = 60;
export const MOLD_QUOTE_PO_FIELDS = ['quoteNo', 'poNo'];
export const MOLD_QUOTE_PO_LABELS = {quoteNo: 'رقم عرض السعر', poNo: 'رقم الـ PO'};
export const MOLD_QUOTE_PO_REQUIRED = 'اكتب رقم عرض السعر أو رقم الـ PO (واحد على الأقل)';
/** Since 2026-11-05 (production's message, «المطلوب دلوقتي: ملف عرض سعر أو ملف PO، واحد منهم على الأقل»): a new request, from any role
 *  (the owner's choice), needs at least one quotation or PO file (a PDF or an image). The form refuses to send without one; the server
 *  keeps a new request in the CRM, not sent, until the first one is attached (files are uploaded after the request is saved). */
export const MOLD_QUOTE_FILE_REQUIRED = 'أرفق ملف عرض السعر أو الـ PO (واحد على الأقل)';
/** The categories whose file production counts as the request's quotation or PO (quoteOrPoMissing). */
export const MOLD_QUOTE_FILE_CATEGORIES = Object.freeze(['quote', 'po']);
/** What a request's files are (the same design-files route, `category`): design files (the default, sent without category, exactly as
 *  before), the quotation's and the PO's (a PDF or an image only), each kind within its own limit. */
export const MOLD_FILE_CATEGORIES = ['design', 'quote', 'po'];
export const MOLD_CATEGORY_MAX_FILES = Object.freeze({design: 10, quote: 5, po: 5});
/** Where a request waits now (the contract's waitingStep, 2026-11-01): the three approvals in order (sales manager, production, finance:
 *  the third, keyed `admin`, is «اعتماد المالية» since yourrest-products 2026-11-03, formerly the system administrator's), then
 *  manufacturing, delivery, done or cancelled. */
export const MOLD_WAITING_STEPS = ['sales', 'production', 'admin', 'manufacturing', 'delivery', 'done', 'cancelled'];
export const MOLD_APPROVAL_STEPS = ['sales', 'production', 'admin'];
/** The `approval` route's actions: the sales manager approves a request in the CRM, or withdraws the approval. */
export const MOLD_APPROVAL_ACTIONS = ['approve', 'withdraw'];
export const MOLD_RANGES = {moldWidth: [1000, 2000], gelbaSize: [500, 1200], quantity: [1, 100]};
export const MOLD_USUAL = {moldWidth: [1380, 1375], gelbaSize: [795, 800]};
/** Text limits in characters: the stricter of the contract (§2, other texts 160) and what production accepts (customer name 200, as in
 *  the customers route, so a customer the list carries can always be asked for; city 100; email 190). */
export const MOLD_LIMITS = {description: 200, moldNo: 40, designUrl: 1000, notes: 2000, customerName: 200, address: 300, city: 100, salesmanName: 160, email: 160, crmMemberId: 64, cancelReason: 500, erpCode: 50};
export const MOLD_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const MOLD_TIMEOUT_MS = 10_000;
export const MOLD_STATUS_BATCH = 200;
export const MOLD_BODY_LIMIT = 64 * 1024;
/** The customers route takes up to 2 MB and 20000 customers in one call (the contract, «customers»). */
export const MOLD_CUSTOMERS_BODY_LIMIT = 2 * 1024 * 1024;
export const MOLD_CUSTOMERS_MAX = 20000;
/** The cities as the production sheet writes them; a CRM city that is one of them is sent this way so production fills it in itself. */
export const MOLD_SHEET_CITIES = ['Damam - الدمام', 'Riyadh - الرياض', 'Qassem - القصيم', 'Madina - المدينة', 'Jeddah - جده', 'MAkkah - مكة', 'Taif - الطائف', 'Khames - خميس مشيط', 'Jizan - جيزان'];
/** §6: after a failed send, the next try waits 1 minute, then 5, then 30, then 2 hours, then every 2 hours until 24 hours have passed. */
export const MOLD_RETRY_MINUTES = [1, 5, 30, 120];
export const MOLD_RETRY_WINDOW_MS = 24 * 3600_000;
/** Design files (the contract's addition «ملفات التصميم», 2026-11-02): the extensions production accepts and the kind each is shown as. */
export const MOLD_DESIGN_EXTENSIONS = Object.freeze({pdf: 'pdf', png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image',
  ...Object.fromEntries('dwg dxf step stp igs iges stl sldprt sldasm slddrw nc1 dstv ai eps cdr psd svg zip rar 7z'.split(' ').map(extension => [extension, 'other']))});
export const MOLD_DESIGN_KINDS = ['pdf', 'image', 'other'];
export const MOLD_DESIGN_SOURCES = ['crm', 'production'];
/** 25 MiB a file, 10 files a request (the CRM's and production's together), 80 000 000 pixels an image, a name of 200 characters. */
export const MOLD_DESIGN_MAX_BYTES = 25 * 1024 * 1024;
export const MOLD_DESIGN_MAX_FILES = 10;
export const MOLD_DESIGN_MAX_PIXELS = 80_000_000;
export const MOLD_DESIGN_NAME_MAX = 200;
/** design-files and design-file wait up to 120 seconds; every other route keeps its own limit. */
export const MOLD_DESIGN_TIMEOUT_MS = 120_000;
/** The JSON line before the bytes ({crmRequestId, crmFileId, name} and its newline) stays within this. */
export const MOLD_DESIGN_LINE_LIMIT = 4096;
/** Why production refuses a file's bytes (400 invalid_payload, fields ['file'], details.reason). */
export const MOLD_DESIGN_REASONS = ['empty', 'not_pdf', 'bad_image', 'too_many_pixels'];
/** Why production refuses a file for its place rather than its bytes (400 invalid_payload, fields ['crmFileId'], details.reason; PR #27):
 *  the request holds 10 files already, or the crmFileId was used for another file or for a file deleted since. Final like the others. */
export const MOLD_DESIGN_PLACE_REASONS = ['too_many_files', 'crm_file_id_used'];

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

/** The request's delivery address (the owner, 2026-11-09: «عنوان لكل طلب قالب»): asked for with every new request (and its edit before
 *  the first send), filled in from the customer's registered address and changed for this request only (the customer's own address
 *  never changes). It is the request's `customer.address` in the requests body, the field production always took: production needs no
 *  change. The server's refusals (each with its English pair in lib/locales/en.json; the form says them from MOLD_ADDRESS_TEXT). */
export const MOLD_ADDRESS_REQUIRED = 'اكتب عنوان التسليم';
export const MOLD_ADDRESS_LONG = 'العنوان حتى ' + MOLD_LIMITS.address + ' حرف';
/**
 * A delivery address as typed, as it is stored and sent: a control character (a new line from a paste or a text area) becomes a space,
 * then moldText (single spaces, the ends trimmed). error: 'required' when nothing is left, 'long' over 300 characters, counted as
 * production counts them (code points, [...s].length); null when it may be sent. Anything but a string is none ('required').
 * @param {unknown} value
 * @returns {{address: string, error: 'required'|'long'|null}}
 */
export function moldAddress(value) {
  const address = typeof value === 'string' ? moldText(value.replace(/[\u0000-\u001F\u007F]/g, ' ')) ?? '' : '';
  return {address, error: !address ? 'required' : length(address) > MOLD_LIMITS.address ? 'long' : null};
}

/**
 * A customer's ERP code (`erpCode`, «كود العميل في ERP») as the customers route sends it (2026-11-02) and a request for a customer not in
 * the CRM carries it (2026-11-09): control characters and invisible marks (direction marks, zero-width characters, as a paste from an
 * RTL sheet brings) dropped, Arabic-Indic and Persian digits as ASCII digits (146, never ١٤٦), then moldText (single spaces, the ends
 * trimmed). '' for none. Never cut: the caller decides on its length.
 * @param {unknown} value
 */
export function moldErpCodeText(value) {
  if (value === null || value === undefined) return '';
  return moldText(String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '')
    .replace(/[\u0660-\u0669]/g, digit => String(digit.charCodeAt(0) - 0x0660)).replace(/[\u06F0-\u06F9]/g, digit => String(digit.charCodeAt(0) - 0x06F0))) ?? '';
}
/** A mold request for a customer not in the CRM (the owner, 2026-11-09: «لو فيه عميل مش موجود فى النظام طلب القالب ميقفش»، «يتبعت بكود
 *  ERP بس»): the representative types the customer's name and ERP code; the request goes to production with both and no Yourrest number
 *  (customer.crmNumber null). The server's refusals, each with its English pair in lib/locales/en.json (the form says them from
 *  MOLD_CUSTOMER_TEXT in lib/mold-requests.ts). */
export const MOLD_CUSTOMER_NAME_REQUIRED = 'اكتب اسم العميل';
export const MOLD_CUSTOMER_NAME_LONG = 'اسم العميل حتى ' + MOLD_LIMITS.customerName + ' حرف';
export const MOLD_ERP_CODE_REQUIRED = 'اكتب كود ERP للعميل';
export const MOLD_ERP_CODE_LONG = 'كود ERP حتى ' + MOLD_LIMITS.erpCode + ' حرف';
/**
 * The customer's name of such a request as typed, as it is stored and sent (moldText; a control character such as a new line becomes a
 * space): error 'required' when nothing is left, 'long' over 200 characters (counted as production counts them).
 * @param {unknown} value
 * @returns {{name: string, error: 'required'|'long'|null}}
 */
export function moldCustomerName(value) {
  const name = typeof value === 'string' ? moldText(value.replace(/[\u0000-\u001F\u007F]/g, ' ')) ?? '' : '';
  return {name, error: !name ? 'required' : length(name) > MOLD_LIMITS.customerName ? 'long' : null};
}
/**
 * The ERP code of a request as typed (moldErpCodeText, a tab or new line as a space first): error 'required' when nothing is left (or
 * it is not text), 'long' over 50 characters.
 * @param {unknown} value
 * @returns {{erpCode: string, error: 'required'|'long'|null}}
 */
export function moldErpCode(value) {
  const erpCode = typeof value === 'string' ? moldErpCodeText(value.replace(/[\t\n\r]/g, ' ')) : '';
  return {erpCode, error: !erpCode ? 'required' : length(erpCode) > MOLD_LIMITS.erpCode ? 'long' : null};
}

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

/** The payment a representative chose: 'cash' or 'deferred', null for anything else (a request asked for before 2026-11-03 has none). */
export function moldPayment(value) {
  return value === 'cash' || value === 'deferred' ? value : null;
}

const ARABIC_DIGITS = /[٠-٩]/g, PERSIAN_DIGITS = /[۰-۹]/g, INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
/** A quotation or PO number as production stores it: Arabic-Indic and Persian digits as ASCII digits, the ends trimmed; '' for none (no
 *  value, or only spaces). Invisible marks a paste may carry (zero-width and direction marks) are dropped first, so a value of only
 *  those is none rather than a number nobody can see. undefined for what production would refuse as a text: not a string, or a control
 *  character inside. */
export function moldQuotePoNumber(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return undefined;
  const text = value.replace(INVISIBLE, '').replace(ARABIC_DIGITS, digit => String(digit.charCodeAt(0) - 0x0660)).replace(PERSIAN_DIGITS, digit => String(digit.charCodeAt(0) - 0x06F0)).trim();
  return /[\u0000-\u001F\u007F]/.test(text) ? undefined : text;
}
/**
 * The quotation and PO numbers a representative typed, normalized (moldQuotePoNumber), each up to 60 characters after normalizing.
 * required: at least one of them (a new request, or an edit before the first send, once production's update is live). Returns
 * {quoteNo, poNo, errors}: '' for one not given; errors as field -> Arabic message (quotePo when neither was given).
 * @param {unknown} input
 * @param {{required?: boolean}} [options]
 * @returns {{quoteNo: string, poNo: string, errors: Record<string, string>}}
 */
export function validateMoldQuotePo(input, {required = false} = {}) {
  const source = input && typeof input === 'object' ? input : {}, errors = {}, out = {quoteNo: '', poNo: ''};
  for (const field of MOLD_QUOTE_PO_FIELDS) {
    const value = moldQuotePoNumber(source[field]), label = MOLD_QUOTE_PO_LABELS[field];
    if (value === undefined) errors[field] = label + ' فيه رموز غير مسموحة';
    else if (length(value) > MOLD_QUOTE_PO_MAX) errors[field] = label + ' أطول من ' + MOLD_QUOTE_PO_MAX + ' حرف';
    else out[field] = value;
  }
  if (required && !errors.quoteNo && !errors.poNo && !out.quoteNo && !out.poNo) errors.quotePo = MOLD_QUOTE_PO_REQUIRED;
  return {...out, errors};
}
/** Whether a status object (or a pending item), as moldStatusObject or moldPendingItem read it, comes from production's updated
 *  application: it carries `quoteOrPoMissing` (whatever its value). The CRM sends no number, category or quotation/PO file before. */
export const moldQuotePoAnswered = value => !!value && typeof value === 'object' && typeof value.quoteOrPoMissing === 'boolean';

/** A cancellation's reason as it is compared: every run of white space (a new line too) as one space, the ends trimmed; '' for none. */
export const moldCancelReasonKey = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
/** Whether a reason was used already for this request (its previous cancellations, which the production manager undid): production
 *  answers such a cancellation with the request as it is, not cancelled (2026-11-03), so cancelling again takes a new reason. */
export function moldCancelReasonUsed(reason, used) {
  const key = moldCancelReasonKey(reason);
  return (used || []).some(previous => moldCancelReasonKey(previous) === key);
}

/** The CRM's time as the contract writes it: ISO 8601 with Riyadh's offset (+03:00, no daylight saving). */
export function riyadhIso(value) {
  const at = new Date(value);
  if (!Number.isFinite(at.getTime())) throw new Error('invalid time');
  return new Date(at.getTime() + 3 * 3600_000).toISOString().slice(0, 19) + '+03:00';
}

/**
 * The body of the `requests` route (§2), keys in a fixed order so a retry sends the very same bytes. Optional texts are left out
 * when empty; `customer.crmNumber` is always there (the addendum). `payment` (2026-11-03) follows specs only when the request carries
 * one: a request asked for before has none and is sent again exactly as it was first sent (production compares a resend with that
 * original, and a field added to it would be other data: 409 production_only). The quotation and PO numbers (the second update of
 * 2026-11-03) follow payment the same way, each only when the request carries it: a request stored without them is sent byte for byte as
 * before. They come from the request's own data, never from a status production returned. Throws when a value would be refused by
 * production. A customer not in the CRM (2026-11-09): customer.crmNumber null, then customer.erpCode (1 to 50 characters after
 * moldErpCodeText) is required and follows address and city; a customer of the CRM (crmNumber a number) never sends erpCode, whatever
 * the request's data holds, so its body is byte for byte as before.
 * @param {{id: string, legacyOrderNo?: number|null, requestedAt: string, customer: any, salesman: any, specs: any, payment?: string|null, paymentTerms?: string|null, quoteNo?: string|null, poNo?: string|null}} request
 */
export function moldRequestBody({id, legacyOrderNo = null, requestedAt, customer, salesman, specs, payment, paymentTerms, quoteNo, poNo}) {
  if (!MOLD_ID.test(id || '')) throw new Error('crmRequestId');
  const free = !!customer && customer.crmNumber === null;
  if (!free && (!isWhole(customer?.crmNumber) || customer.crmNumber < 1 || customer.crmNumber > 2147483647)) throw new Error('customer.crmNumber');
  const erpCode = free ? moldErpCodeText(customer.erpCode) : '';
  if (free && (!erpCode || length(erpCode) > MOLD_LIMITS.erpCode)) throw new Error('customer.erpCode');
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
  if (free) body.customer.erpCode = erpCode;
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
  if (payment !== undefined && payment !== null) { if (!moldPayment(payment)) throw new Error('payment'); body.payment = payment; }
  // 2026-11-10: the terms of a deferred payment, right after it, only when the request carries them (an older request byte for byte).
  if (paymentTerms !== undefined && paymentTerms !== null) { if (!moldPaymentTerms(paymentTerms) || payment !== 'deferred') throw new Error('paymentTerms'); body.paymentTerms = paymentTerms; }
  for (const [key, value] of [['quoteNo', quoteNo], ['poNo', poNo]]) {
    const clean = moldQuotePoNumber(value);
    if (clean === undefined || length(clean) > MOLD_QUOTE_PO_MAX) throw new Error(key);
    if (clean) body[key] = clean;
  }
  return body;
}

const dateOrNull = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 40) : null;
const shortOrNull = (value, max) => typeof value === 'string' ? value.slice(0, max) : null;

// ---- Design files: the name, the bytes, the body of design-files, the entries production lists
const NAME_FORBIDDEN = /[\\/<>:"|?*\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
/**
 * A design file's name as the contract accepts it: the original name with its ends trimmed, up to 200 characters, no path and none of
 * \ / < > : " | ? *, no control characters (nor the direction marks that could disguise an extension), a name before the extension,
 * and an extension of the list (any letter case). A Windows reserved name (CON, AUX, COM1…) is a name like any other: production accepts
 * it (PR #27). null when production would refuse it.
 * @param {unknown} value
 * @returns {{name: string, extension: string, kind: 'pdf'|'image'|'other'} | null}
 */
export function moldDesignName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim(), dot = name.lastIndexOf('.');
  if (!name || length(name) > MOLD_DESIGN_NAME_MAX || NAME_FORBIDDEN.test(name) || dot < 1 || !name.slice(0, dot).trim()) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  if (!hasOwn(MOLD_DESIGN_EXTENSIONS, extension)) return null;
  return {name, extension, kind: MOLD_DESIGN_EXTENSIONS[extension]};
}
/** A name production listed, or a download carried, made safe to show and to put in a header: no control characters, direction marks
 *  or path separators, no half of a UTF-16 pair left alone (JSON may carry "\ud800", which no header or encodeURIComponent takes),
 *  single spaces, up to 200 characters. '' when nothing is left. */
export function moldDesignDisplayName(value) {
  if (typeof value !== 'string') return '';
  return [...value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '').replace(/[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/g, '').replace(/[\\/]/g, '_').replace(/\s+/g, ' ').trim()].slice(0, MOLD_DESIGN_NAME_MAX).join('');
}

const IMAGE_TYPES = {png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp'};
/**
 * The width and height an image's header declares, with its format: PNG (IHDR), JPEG (the first SOF frame header), GIF (the logical
 * screen) or WEBP (VP8, VP8L or VP8X). null when the bytes are none of these or the header is cut short.
 * @param {Uint8Array} bytes
 * @returns {{format: 'png'|'jpeg'|'gif'|'webp', width: number, height: number} | null}
 */
export function moldImageSize(bytes) {
  const b = bytes, n = b?.length || 0;
  const at = (i, text) => n >= i + text.length && [...text].every((char, k) => b[i + k] === char.charCodeAt(0));
  const be16 = i => b[i] << 8 | b[i + 1], le16 = i => b[i] | b[i + 1] << 8, le24 = i => b[i] | b[i + 1] << 8 | b[i + 2] << 16;
  if (n >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => b[i] === value)) {
    if (!at(12, 'IHDR')) return null;
    return {format: 'png', width: b[16] * 2 ** 24 + (b[17] << 16 | b[18] << 8 | b[19]), height: b[20] * 2 ** 24 + (b[21] << 16 | b[22] << 8 | b[23])};
  }
  if (n >= 10 && (at(0, 'GIF87a') || at(0, 'GIF89a'))) return {format: 'gif', width: le16(6), height: le16(8)};
  if (at(0, 'RIFF') && at(8, 'WEBP')) {
    if (at(12, 'VP8 ')) return n >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a ? {format: 'webp', width: le16(26) & 0x3fff, height: le16(28) & 0x3fff} : null;
    if (at(12, 'VP8L')) { if (n < 25 || b[20] !== 0x2f) return null; const bits = (b[21] | b[22] << 8 | b[23] << 16 | b[24] << 24) >>> 0; return {format: 'webp', width: (bits & 0x3fff) + 1, height: (bits >>> 14 & 0x3fff) + 1}; }
    if (at(12, 'VP8X')) return n >= 30 ? {format: 'webp', width: le24(24) + 1, height: le24(27) + 1} : null;
    return null;
  }
  if (n >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    // The segments after SOI, until the first frame header (SOF0..SOF15 without DHT, JPG and DAC); a scan or the end before it: no size.
    for (let i = 2; i + 4 <= n;) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd8) { i += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) return null;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return i + 9 <= n ? {format: 'jpeg', width: be16(i + 7), height: be16(i + 5)} : null;
      const size = be16(i + 2);
      if (size < 2) return null;
      i += 2 + size;
    }
  }
  return null;
}

/** A PDF's marker and version (%PDF-1.4), looked for within the file's first 1024 bytes read one byte to a character (latin1). */
const PDF_MARK = /%PDF-\d\.\d/, PDF_MARK_WITHIN = 1024;
const latin1 = bytes => String.fromCharCode(...bytes);
/**
 * A design file before the CRM keeps it, checked as production checks it: its name (moldDesignName; a Windows reserved name such as CON
 * or COM1 is accepted, as production accepts it), then its bytes: none is empty or over 25 MiB, a PDF carries %PDF- and its version
 * (%PDF-1.4, /%PDF-\d\.\d/) within its first 1024 bytes, whatever comes before it there (production's PR #27), an image is a PNG, JPEG,
 * GIF or WEBP (whatever its extension says among those: production stores and serves it as what it really is) whose header declares at
 * most 80 000 000 pixels. A refusal names the contract's field and, for the bytes, the reason production gives (MOLD_DESIGN_REASONS, or
 * too_large, which production answers with 413). A quotation's or PO's file (category quote or po, the second update of 2026-11-03) is a
 * PDF or an image only: any other allowed extension is refused for its name with production's reason not_document.
 * @param {unknown} name
 * @param {Uint8Array} bytes
 * @param {string} [category] design (the default), quote or po
 * @returns {{ok: true, name: string, extension: string, kind: 'pdf'|'image'|'other', contentType: string, width: number|null, height: number|null} | {ok: false, field: 'name'|'file'|'category', reason: string}}
 */
export function moldDesignFileCheck(name, bytes, category = 'design') {
  if (!MOLD_FILE_CATEGORIES.includes(category)) return {ok: false, field: 'category', reason: 'category'};
  const named = moldDesignName(name);
  if (!named) return {ok: false, field: 'name', reason: 'name'};
  if (category !== 'design' && named.kind === 'other') return {ok: false, field: 'name', reason: 'not_document'};
  if (!(bytes instanceof Uint8Array) || !bytes.length) return {ok: false, field: 'file', reason: 'empty'};
  if (bytes.length > MOLD_DESIGN_MAX_BYTES) return {ok: false, field: 'file', reason: 'too_large'};
  if (named.kind === 'pdf') return PDF_MARK.test(latin1(bytes.subarray(0, PDF_MARK_WITHIN))) ? {ok: true, ...named, contentType: 'application/pdf', width: null, height: null} : {ok: false, field: 'file', reason: 'not_pdf'};
  if (named.kind === 'image') {
    const size = moldImageSize(bytes);
    if (!size || !size.width || !size.height) return {ok: false, field: 'file', reason: 'bad_image'};
    if (size.width * size.height > MOLD_DESIGN_MAX_PIXELS) return {ok: false, field: 'file', reason: 'too_many_pixels'};
    return {ok: true, ...named, contentType: IMAGE_TYPES[size.format], width: size.width, height: size.height};
  }
  return {ok: true, ...named, contentType: 'application/octet-stream', width: null, height: null};
}

// ---- The customer's signature (the owner, 2026-11-04: «العميل بيوقع على طلب القالب ولازم علشان يعتمد»)
// The customer signs a new request with a finger or a stylus on the representative's phone or tablet before it is sent. Required for the
// sales roles only (representative, supervisor, sales manager); customer service and the administrator ask without it. The signature is a
// PNG kept as one of the request's design files (category design, named «توقيع العميل - <signer>.png»), so it reaches production through
// design-files exactly like a design image, without category; the request's data names it (signature: {signer, signedAt, fileId}) and the
// requests body never carries it (moldRequestBody builds from explicit fields).
/** The roles whose new request (or changing edit before its first send) needs the customer's signature. */
export const MOLD_SIGNATURE_ROLES = Object.freeze(['rep', 'supervisor', 'manager']);
/** @param {unknown} role */
export const moldSignatureRequired = role => typeof role === 'string' && MOLD_SIGNATURE_ROLES.includes(role);
/** The name of who signed for the customer, in characters (after moldText). */
export const MOLD_SIGNER_MIN = 2, MOLD_SIGNER_MAX = 80;
/** The PNG: at most 256 KiB (a canvas export of a signature is typically under 100 KB), 1200 pixels wide and high, its long side at
 *  least 64 pixels (a dot or a tick trimmed with its margin is smaller). The JSON body carries it as base64 (MOLD_SIGNATURE_BASE64_MAX). */
export const MOLD_SIGNATURE_MAX_BYTES = 256 * 1024;
export const MOLD_SIGNATURE_MAX_SIDE = 1200;
export const MOLD_SIGNATURE_MIN_SIDE = 64;
export const MOLD_SIGNATURE_BASE64_MAX = Math.ceil(MOLD_SIGNATURE_MAX_BYTES / 3) * 4;
/** What the pad takes as a signature (in CSS pixels): at least 12 points drawn and a box of at least 40 pixels on its long side, so a tap,
 *  a dot or a short tick is refused. */
export const MOLD_SIGNATURE_MIN_POINTS = 12, MOLD_SIGNATURE_MIN_BOX = 40;
/** The file name's start: «توقيع العميل - <signer>.png». */
export const MOLD_SIGNATURE_NAME_PREFIX = 'توقيع العميل - ';
/** The server's refusals (each has its English pair in lib/locales/en.json). */
export const MOLD_SIGNATURE_REQUIRED = 'توقيع العميل مطلوب قبل إرسال الطلب';
export const MOLD_SIGNER_REQUIRED = 'اكتب اسم اللي بيوقّع عن العميل (من ' + MOLD_SIGNER_MIN + ' إلى ' + MOLD_SIGNER_MAX + ' حرف)';
export const MOLD_SIGNATURE_BAD = 'صورة التوقيع غير صالحة؛ امسح ووقّع من جديد';
/** Who signed, as stored: moldText (single spaces, the ends trimmed) without invisible marks; undefined when production would refuse a
 *  control character in it, or when it is not a text. Its length is checked by moldSignatureCheck. */
export function moldSigner(value) {
  if (typeof value !== 'string') return undefined;
  return moldText(value.replace(/[​-‏‪-‮⁠-⁩﻿]/g, ''));
}
/** The signature file's name for a signer: «توقيع العميل - <signer>.png», the characters a file name may not hold made spaces, within
 *  200 characters; «توقيع العميل.png» when nothing of the name is left. Always one moldDesignName accepts (an image). */
export function moldSignatureName(signer) {
  const clean = [...String(signer ?? '').replace(new RegExp(NAME_FORBIDDEN.source, 'g'), ' ').replace(/\s+/g, ' ').trim()].slice(0, MOLD_SIGNER_MAX).join('').trim();
  return clean ? MOLD_SIGNATURE_NAME_PREFIX + clean + '.png' : 'توقيع العميل.png';
}
/** Whether what was drawn on the pad is a signature: enough points, over a box large enough (CSS pixels). */
export function moldSignatureDrawn({points, width, height}) {
  return Number.isFinite(points) && points >= MOLD_SIGNATURE_MIN_POINTS && Math.max(Number(width) || 0, Number(height) || 0) >= MOLD_SIGNATURE_MIN_BOX;
}
/** The PNG's bytes from the base64 the form sends (no data: prefix, no spaces); null when it is not base64 or is too long. */
export function moldSignatureBytes(value) {
  if (typeof value !== 'string' || !value || value.length > MOLD_SIGNATURE_BASE64_MAX || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const text = atob(value), bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes;
  } catch { return null; }
}
const CRC_TABLE = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (bytes, start, end) => { let c = 0xffffffff; for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** Whether the bytes are a whole PNG, chunk by chunk: the signature, IHDR first, at least one IDAT, IEND last with nothing after it, and
 *  every chunk's CRC right. A header with junk before an IEND (no image data) is not one. */
export function moldPngWhole(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 57 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) return false;
  let at = 8, first = true, data = false;
  while (at + 12 <= bytes.length) {
    const size = (bytes[at] * 2 ** 24) + (bytes[at + 1] << 16 | bytes[at + 2] << 8 | bytes[at + 3]), end = at + 8 + size;
    if (end + 4 > bytes.length) return false;
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (!/^[A-Za-z]{4}$/.test(type) || (first && type !== 'IHDR')) return false;
    const stored = (bytes[end] * 2 ** 24) + (bytes[end + 1] << 16 | bytes[end + 2] << 8 | bytes[end + 3]);
    if (crc32(bytes, at + 4, end) !== stored) return false;
    if (type === 'IDAT') data = data || size > 0;
    if (type === 'IEND') return size === 0 && data && end + 4 === bytes.length;
    first = false; at = end + 4;
  }
  return false;
}
/**
 * The customer's signature before the CRM keeps it: who signed (2 to 80 characters, nothing production would refuse) and a real PNG
 * (moldPngWhole: IHDR, image data, IEND, every chunk's CRC), at most 256 KiB, at most 1200 pixels a side, its long side at least 64, and one production accepts
 * as a design image (moldDesignFileCheck under its file name). field: signer or signature.
 * @param {unknown} signer
 * @param {Uint8Array|null} bytes
 * @returns {{ok: true, signer: string, name: string, width: number, height: number, contentType: string} | {ok: false, field: 'signer'|'signature', reason: string}}
 */
export function moldSignatureCheck(signer, bytes) {
  const name = moldSigner(signer);
  if (name === undefined || length(name) < MOLD_SIGNER_MIN || length(name) > MOLD_SIGNER_MAX) return {ok: false, field: 'signer', reason: 'signer'};
  if (!(bytes instanceof Uint8Array) || !bytes.length) return {ok: false, field: 'signature', reason: 'missing'};
  if (bytes.length > MOLD_SIGNATURE_MAX_BYTES) return {ok: false, field: 'signature', reason: 'too_large'};
  const size = moldImageSize(bytes);
  if (!size || size.format !== 'png' || !moldPngWhole(bytes)) return {ok: false, field: 'signature', reason: 'not_png'};
  if (size.width > MOLD_SIGNATURE_MAX_SIDE || size.height > MOLD_SIGNATURE_MAX_SIDE || Math.max(size.width, size.height) < MOLD_SIGNATURE_MIN_SIDE || Math.min(size.width, size.height) < 1) return {ok: false, field: 'signature', reason: 'size'};
  const file = moldSignatureName(name), checked = moldDesignFileCheck(file, bytes);
  if (!checked.ok) return {ok: false, field: 'signature', reason: checked.reason};
  return {ok: true, signer: name, name: file, width: size.width, height: size.height, contentType: checked.contentType};
}

// ---- The customer's signature inside the request's PDFs, and the link the customer signs from (the owner, 2026-11-10)
// Production's side does not change: a signed copy is one more file of the original's category, sent with design-files like any other.
/** The block stamped at the bottom of the last page of each signed PDF: a PNG the signing browser composes (the drawing, «توقيع العميل:
 *  <name>» and the moment in Riyadh; the canvas shapes the Arabic), at most 384 KiB, 600 to 1600 pixels wide, 150 to 800 high, at least
 *  1.5 times as wide as high. The JSON body carries it as base64 (MOLD_SIGNATURE_BLOCK_BASE64_MAX). */
export const MOLD_SIGNATURE_BLOCK_MAX_BYTES = 384 * 1024;
export const MOLD_SIGNATURE_BLOCK_BASE64_MAX = Math.ceil(MOLD_SIGNATURE_BLOCK_MAX_BYTES / 3) * 4;
export const MOLD_SIGNATURE_BLOCK_WIDTH = Object.freeze([600, 1600]), MOLD_SIGNATURE_BLOCK_HEIGHT = Object.freeze([150, 800]);
/** How far the moment printed in the block (blockAt) may be from the server's clock: the page sets its clock by the server's. */
export const MOLD_SIGNATURE_BLOCK_SKEW_MS = 10 * 60_000;
/** At most this many PDFs' SHA-256 the customer saw on the device before they were uploaded (seen): 10 design, 5 quotation, 5 PO. */
export const MOLD_SIGNATURE_SEEN_MAX = 20;
/** A signed copy's name: «<the original's name without .pdf> - موقّع.pdf». */
export const MOLD_SIGNED_SUFFIX = ' - موقّع';
/** A signing link stays valid this long (one active link a request). */
export const MOLD_SIGN_LINK_DAYS = 14;
/** The link's token: 32 random bytes in base64url (43 characters, 256 bits). */
export const MOLD_SIGN_TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** Bytes from base64 without the data: prefix (no spaces), up to maxLength characters; null otherwise. */
function base64Bytes(value, maxLength) {
  if (typeof value !== 'string' || !value || value.length > maxLength || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const text = atob(value), bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes;
  } catch { return null; }
}
/** The block's bytes from the base64 the form sends; null when it is not base64 or is too long. */
export const moldSignatureBlockBytes = value => base64Bytes(value, MOLD_SIGNATURE_BLOCK_BASE64_MAX);
/**
 * The block before the CRM keeps it: a whole PNG (moldPngWhole) within its limits.
 * @param {Uint8Array|null} bytes
 * @returns {{ok: true, width: number, height: number} | {ok: false, reason: 'missing'|'too_large'|'not_png'|'size'}}
 */
export function moldSignatureBlockCheck(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) return {ok: false, reason: 'missing'};
  if (bytes.length > MOLD_SIGNATURE_BLOCK_MAX_BYTES) return {ok: false, reason: 'too_large'};
  const size = moldImageSize(bytes);
  if (!size || size.format !== 'png' || !moldPngWhole(bytes)) return {ok: false, reason: 'not_png'};
  const [minW, maxW] = MOLD_SIGNATURE_BLOCK_WIDTH, [minH, maxH] = MOLD_SIGNATURE_BLOCK_HEIGHT;
  if (size.width < minW || size.width > maxW || size.height < minH || size.height > maxH || size.width < 1.5 * size.height) return {ok: false, reason: 'size'};
  return {ok: true, width: size.width, height: size.height};
}
/** Whether the moment printed in the block is the server's now, within MOLD_SIGNATURE_BLOCK_SKEW_MS. */
export function moldSignatureBlockAt(value, now = Date.now()) {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) && Math.abs(at - now) <= MOLD_SIGNATURE_BLOCK_SKEW_MS ? new Date(at).toISOString() : null;
}
/** The SHA-256 (hex) of the PDFs the customer saw on the device, kept once each, at most MOLD_SIGNATURE_SEEN_MAX; [] for none; null
 *  when it is not such a list. */
export function moldSignatureSeen(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MOLD_SIGNATURE_SEEN_MAX || !value.every(item => typeof item === 'string' && /^[0-9a-f]{64}$/i.test(item))) return null;
  return [...new Set(value.map(item => item.toLowerCase()))];
}
/** A signed copy's name: «<name without .pdf> - موقّع.pdf», the original's name shortened (never below one character) to stay within 200
 *  characters. Always one moldDesignName accepts as a PDF when the original's name is. */
export function moldSignedCopyName(name) {
  const text = String(name ?? ''), dot = text.toLowerCase().endsWith('.pdf') ? text.length - 4 : text.length;
  const tail = MOLD_SIGNED_SUFFIX + '.pdf', room = Math.max(1, MOLD_DESIGN_NAME_MAX - length(tail));
  const base = [...text.slice(0, dot)].slice(0, room).join('').trim() || 'ملف';
  return base + tail;
}

// ---- One signed document (the owner, 2026-11-11: «التوقيع يكون داخل pdf ... عرض السعر او po وبعدين التصميم وفى اخره خانة للتوقيع»)
// The customer reads the request's documents as ONE document (the quotation's pages, the PO's, the design's, each picture a page) whose
// last page is the signature page («إقرار وتوقيع العميل»); the signing browser composes that page as a PNG (the canvas shapes the Arabic)
// and the CRM builds one PDF of every page in that order with the signature page at its end, «طلب القالب - موقّع.pdf», one more file of
// the first document's category for production (production's side does not change: its name rule, a PDF, 25 MiB, one place).
/** The signed document's name, the same for every request. */
export const MOLD_SIGNED_DOCUMENT_NAME = 'طلب القالب' + MOLD_SIGNED_SUFFIX + '.pdf';
/** The signature page as the browser composes it: a whole PNG of an A4 sheet (height / width 297/210, within 1%), 1000 to 1800 pixels
 *  wide, at most 1 MiB. */
export const MOLD_SIGNATURE_PAGE_MAX_BYTES = 1024 * 1024;
export const MOLD_SIGNATURE_PAGE_BASE64_MAX = Math.ceil(MOLD_SIGNATURE_PAGE_MAX_BYTES / 3) * 4;
export const MOLD_SIGNATURE_PAGE_WIDTH = Object.freeze([1000, 1800]), MOLD_SIGNATURE_PAGE_RATIO = 297 / 210;
/** The documents a signed document may list (10 design, 5 quotation and 5 PO files: the CRM's own) and its pages, the signature's
 *  excluded. */
export const MOLD_SIGNED_DOCUMENT_PARTS_MAX = 20, MOLD_SIGNED_DOCUMENT_PAGES_MAX = 2000;
/** The signed document's category as the page saw it: the first document's of all it named (in it, or named only: a quotation's PDF that
 *  does not open still makes it a quotation's file); one of the three, else null (absent: worked out from the parts alone). */
export const moldSignedDocumentCategory = value => MOLD_FILE_CATEGORIES.includes(value) ? value : null;
/** The signature page's bytes from the base64 the form sends; null when it is not base64 or is too long. */
export const moldSignaturePageBytes = value => base64Bytes(value, MOLD_SIGNATURE_PAGE_BASE64_MAX);
/**
 * The signature page before the CRM keeps it: a whole PNG (moldPngWhole) within its limits, shaped as an A4 sheet.
 * @param {Uint8Array|null} bytes
 * @returns {{ok: true, width: number, height: number} | {ok: false, reason: 'missing'|'too_large'|'not_png'|'size'}}
 */
export function moldSignaturePageCheck(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) return {ok: false, reason: 'missing'};
  if (bytes.length > MOLD_SIGNATURE_PAGE_MAX_BYTES) return {ok: false, reason: 'too_large'};
  const size = moldImageSize(bytes);
  if (!size || size.format !== 'png' || !moldPngWhole(bytes)) return {ok: false, reason: 'not_png'};
  const [minW, maxW] = MOLD_SIGNATURE_PAGE_WIDTH;
  if (size.width < minW || size.width > maxW || Math.abs(size.height / size.width - MOLD_SIGNATURE_PAGE_RATIO) > MOLD_SIGNATURE_PAGE_RATIO * 0.01) return {ok: false, reason: 'size'};
  return {ok: true, width: size.width, height: size.height};
}
/**
 * The documents the signed document is made of, as the signing page listed them, in their order: each {sha256, category, kind, name,
 * pages} (a picture is one page; a PDF from 1 page). Every one is one of the request's files the CRM holds, found by its SHA-256 and
 * category; the server builds from exactly these and refuses a count that is not the file's. [] for none (a request whose files are all
 * named only); null when it is not such a list.
 * @param {unknown} value
 * @returns {{sha256: string, category: 'design'|'quote'|'po', kind: 'pdf'|'image', name: string, pages: number}[] | null}
 */
export function moldSignedDocumentParts(value) {
  if (!Array.isArray(value) || value.length > MOLD_SIGNED_DOCUMENT_PARTS_MAX) return null;
  const out = [];
  let pages = 0;
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const {sha256, category, kind, name} = item, count = item.pages;
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(sha256) || !MOLD_FILE_CATEGORIES.includes(category) || (kind !== 'pdf' && kind !== 'image')) return null;
    if (typeof name !== 'string' || !name.trim() || length(name) > MOLD_DESIGN_NAME_MAX || CONTROL.test(name)) return null;
    if (!isWhole(count) || count < 1 || (kind === 'image' && count !== 1)) return null;
    pages += count;
    if (pages > MOLD_SIGNED_DOCUMENT_PAGES_MAX) return null;
    out.push({sha256: sha256.toLowerCase(), category, kind, name, pages: count});
  }
  return out;
}

/** The type a design file is served with: a PDF or one of the four image types as they are, anything else as plain bytes (an SVG or a
 *  drawing is never rendered by the browser). */
export function moldDesignContentType(value) {
  const type = String(value ?? '').split(';')[0].trim().toLowerCase();
  return ['application/pdf', ...Object.values(IMAGE_TYPES)].includes(type) ? type : 'application/octet-stream';
}
/** The file name a Content-Disposition carries: filename* (UTF-8, RFC 5987) first, else filename; made safe to show. '' when none. */
export function moldDispositionName(header) {
  const text = String(header ?? ''), extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(text), plain = /filename\s*=\s*"([^"]*)"/i.exec(text) || /filename\s*=\s*([^;\s]+)/i.exec(text);
  if (extended) { try { return moldDesignDisplayName(decodeURIComponent(extended[1].trim())); } catch { /* a broken encoding: the plain name, if any */ } }
  return plain ? moldDesignDisplayName(plain[1]) : '';
}
/** Content-Disposition for a design file: inline (viewed in the browser) or attachment, the name in UTF-8 (filename*, RFC 5987). */
export function moldContentDisposition(name, inline = false) {
  const encoded = encodeURIComponent(moldDesignDisplayName(name) || 'design').replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
  return (inline ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encoded;
}

/**
 * The body of design-files: one JSON line {crmRequestId, crmFileId, name}, a newline, then the file's bytes as they are. The client signs
 * exactly these bytes. A quotation's or PO's file adds "category" ("quote" or "po") after the name; a design file is sent without it,
 * exactly as before the second update of 2026-11-03. Throws on a value production would refuse.
 * @param {{crmRequestId: string, crmFileId: string, name: string, category?: string|null}} meta
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
/**
 * Production's schema 19 (yourrest-products#52): a design file may be marked a signed copy ("signed": true in the body's line; absent is
 * false; anything but a boolean is refused). The CRM sends it only for a signed copy or the signed document, and only once it has seen
 * the key on a file object of production's (moldSignedFlagAnswered); without signed the line reads exactly as before.
 */
export function moldDesignFileBody({crmRequestId, crmFileId, name, category = 'design', signed = false}, bytes) {
  if (!MOLD_ID.test(crmRequestId || '')) throw new Error('crmRequestId');
  if (!MOLD_ID.test(crmFileId || '')) throw new Error('crmFileId');
  if (moldDesignName(name)?.name !== name) throw new Error('name');
  if (!MOLD_FILE_CATEGORIES.includes(category ?? 'design')) throw new Error('category');
  if (!(bytes instanceof Uint8Array)) throw new Error('file');
  const line = new TextEncoder().encode(JSON.stringify({...(category && category !== 'design' ? {crmRequestId, crmFileId, name, category} : {crmRequestId, crmFileId, name}), ...(signed === true ? {signed: true} : {})}) + '\n');
  if (line.length > MOLD_DESIGN_LINE_LIMIT) throw new Error('name');
  const body = new Uint8Array(line.length + bytes.length);
  body.set(line); body.set(bytes, line.length);
  return body;
}

/**
 * One entry of designFiles (in the status object and in pending items), reduced to the contract's fields; null when it is not one.
 * fileId is production's (a positive whole number or an id like crmRequestId) and is sent back as it came; crmFileId is the CRM's for a
 * file the CRM sent (source crm), null for one production attached. A kind the contract does not list is shown as other. category: the
 * list it came in (designFiles, quoteFiles or poFiles: design, quote or po), whatever the entry itself says.
 * @param {any} value
 * @param {'design'|'quote'|'po'} [category]
 * @returns {{fileId: string|number, crmFileId: string|null, name: string, kind: 'pdf'|'image'|'other', size: number|null, source: 'crm'|'production', uploadedAt: string|null, category: 'design'|'quote'|'po'} | null}
 */
export function moldDesignFileEntry(value, category = 'design') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !MOLD_DESIGN_SOURCES.includes(value.source)) return null;
  const fileId = isWhole(value.fileId) && value.fileId > 0 ? value.fileId : typeof value.fileId === 'string' && MOLD_ID.test(value.fileId) ? value.fileId : null;
  const crmFileId = value.source === 'crm' && typeof value.crmFileId === 'string' && MOLD_ID.test(value.crmFileId) ? value.crmFileId : null;
  const name = moldDesignDisplayName(value.name);
  if (fileId === null || !name || value.source === 'crm' && !crmFileId) return null;
  return {fileId, crmFileId, name, kind: MOLD_DESIGN_KINDS.includes(value.kind) ? value.kind : 'other', size: isWhole(value.size) && value.size >= 0 ? value.size : null, source: value.source, uploadedAt: dateOrNull(value.uploadedAt),
    category: MOLD_FILE_CATEGORIES.includes(category) ? category : 'design',
    // Production's own mark of a signed copy (schema 19), a boolean only; an older application's file has none.
    ...(typeof value.signed === 'boolean' ? {signed: value.signed} : {})};
}
/** Whether an answer read (a status object, a pending item, or a file object of design-files' answer) shows production's schema 19: a
 *  file object carrying the boolean "signed". */
export function moldSignedFlagAnswered(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof value.signed === 'boolean' && (MOLD_DESIGN_SOURCES.includes(value.source) || hasOwn(value, 'fileId'))) return true;
  return ['designFiles', 'quoteFiles', 'poFiles'].some(key => Array.isArray(value[key]) && value[key].some(file => file && typeof file === 'object' && typeof file.signed === 'boolean'));
}
/** designFiles (or quoteFiles, poFiles) as received: the valid entries, each fileId once, up to 50; null when production sent none (an
 *  older application). */
function designFilesOf(value, category = 'design') {
  if (!Array.isArray(value)) return null;
  const seen = new Set(), out = [];
  for (const item of value) {
    const entry = moldDesignFileEntry(item, category);
    if (!entry || seen.has(String(entry.fileId)) || out.length >= 50) continue;
    seen.add(String(entry.fileId)); out.push(entry);
  }
  return out;
}
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
    // 2026-11-10: the sales manager acknowledged the payment terms (approvals.sales.termsAccepted of the updated application).
    if (step === 'sales' && given.termsAccepted === true) out.sales = {...out.sales, termsAccepted: true};
  }
  return out;
}
/** A number production listed (quoteNo, poNo): its text as shown, without control characters, up to 60 characters; '' for none. */
const numberOf = value => typeof value === 'string' ? [...value.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '').trim()].slice(0, MOLD_QUOTE_PO_MAX).join('') : '';
/** The quotation and PO of a status object or a pending item, from production's updated application only (the key quoteOrPoMissing,
 *  whatever its value): the numbers as production holds them now (the production manager's additions and corrections included), whether
 *  one is still missing, and their files (each with its category). Nothing from an older application.
 * @param {any} value
 * @returns {{quoteNo?: string, poNo?: string, quoteOrPoMissing?: boolean, quoteFiles?: NonNullable<ReturnType<typeof moldDesignFileEntry>>[], poFiles?: NonNullable<ReturnType<typeof moldDesignFileEntry>>[]}} */
function quotePoOf(value) {
  if (!hasOwn(value, 'quoteOrPoMissing')) return {};
  return {quoteNo: numberOf(value.quoteNo), poNo: numberOf(value.poNo), quoteOrPoMissing: value.quoteOrPoMissing === true, quoteFiles: designFilesOf(value.quoteFiles, 'quote') || [], poFiles: designFilesOf(value.poFiles, 'po') || []};
}
/** The customer production holds for a request, from an application that takes a customer not in the CRM (2026-11-09: the key
 *  customer.erpCode in a status object, whatever its value; "" for none): its Yourrest number (null for a customer not in the CRM), name
 *  and ERP code. Nothing from an older application, whose status object carries no customer.
 * @param {any} value */
function freeCustomerOf(value) {
  const c = value.customer && typeof value.customer === 'object' && !Array.isArray(value.customer) ? value.customer : null;
  if (!c || typeof c.erpCode !== 'string') return {};
  return {customer: {crmNumber: wholeOrNull(c.crmNumber), name: textOf(c.name, 200), erpCode: textOf(c.erpCode, MOLD_LIMITS.erpCode)}};
}
/** Whether an answer read (a status object or a pending item, as moldStatusObject and moldPendingItem read it) comes from production's
 *  application that takes a customer not in the CRM (2026-11-09): its customer carries erpCode (a string, "" included). */
export const moldFreeCustomersAnswered = value => !!value && typeof value === 'object' && !!value.customer && typeof value.customer === 'object' && typeof value.customer.erpCode === 'string';
/** The products side's message of 2026-11-05 (the second of the day): every request carries requestRef, a stable UUID production gives
 *  it, in its status object and in its pending item; the order number (orderNo) is given only when the production manager approves it
 *  (null until then) and may change once (the numbers from 101 up move down by one), so the CRM names a request registered in the products
 *  application by requestRef and never keys anything by orderNo. The pattern a requestRef must match (any UUID, as production writes it). */
export const MOLD_REQUEST_REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A requestRef as received: the UUID as it came, or null (absent: an older application; or not a UUID). A malformed one is dropped, not
 *  the answer that carried it: the status or the item stays readable, and the CRM names that request as it would without one. */
export const moldRequestRef = value => typeof value === 'string' && MOLD_REQUEST_REF.test(value) ? value : null;
/** An order number as received: a whole number from 1, or null (none yet: production numbers a request when it approves it). */
const orderNoOf = value => isWhole(value) && value >= 1 ? value : null;
/** A status object (§3) as received, reduced to the fields the contract names; null when it is not one. manual: a request registered
 * in the products application itself (its approval answer), which has no crmRequestId. designFiles: the request's design files, the
 * CRM's and production's (null from an application older than the addition of 2026-11-02). From production's update of 2026-11-03 (the
 * key quoteOrPoMissing): quoteNo, poNo, quoteOrPoMissing, quoteFiles and poFiles too (quotePoOf); designFiles then lists design files only.
 * From production's application that takes a customer not in the CRM (2026-11-09, the key customer.erpCode): customer (freeCustomerOf).
 * @param {any} value
 * @param {{manual?: boolean}} [options] */
export function moldStatusObject(value, {manual = false} = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!(MOLD_ID.test(value.crmRequestId || '') || manual && value.crmRequestId === null) || !MOLD_STATUSES.includes(value.status) || typeof value.editable !== 'boolean') return null;
  /** @type {Record<string, {done: boolean, at: string|null}>} */
  const stages = {};
  for (const key of MOLD_STAGES) { const stage = value.stages?.[key]; stages[key] = {done: stage?.done === true, at: dateOrNull(stage?.at)}; }
  // requestRef (2026-11-05, the second update): only when production sent a valid one, so an older application's status reads as before.
  const requestRef = moldRequestRef(value.requestRef);
  return {
    crmRequestId: value.crmRequestId, orderNo: orderNoOf(value.orderNo), ...(requestRef ? {requestRef} : {}), status: value.status, editable: value.editable,
    // moldSerial (2026-11-11, products schema 18): every mold of the order from production's daily log, " / " between them, up to 255.
    moldSerial: shortOrNull(value.moldSerial, 255), productionDate: dateOrNull(value.productionDate), stages,
    stagesDone: MOLD_STAGES.filter(key => stages[key].done).length, stagesTotal: MOLD_STAGES.length,
    delivered: value.delivered === true, deliveryDate: dateOrNull(value.deliveryDate), updatedAt: shortOrNull(value.updatedAt, 40), revision: isWhole(value.revision) ? value.revision : null,
    waitingStep: MOLD_WAITING_STEPS.includes(value.waitingStep) ? value.waitingStep : null, waitingSince: dateOrNull(value.waitingSince), approvals: approvalsOf(value.approvals),
    designFiles: designFilesOf(value.designFiles),
    ...quotePoOf(value), ...freeCustomerOf(value), ...nov10Of(value),
  };
}
/** The products update of 2026-11-10, in a status object or a pending item, only when the answer carries its keys (an older application's
 *  reads exactly as before): paymentTerms (a code, or null), and returned: finance sent the request back to the sales manager
 *  ({by: 'finance', reason, at, correctedAt}, or null). */
function nov10Of(value) {
  return {...(Object.prototype.hasOwnProperty.call(value, 'paymentTerms') ? {paymentTerms: moldPaymentTerms(value.paymentTerms)} : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'returned') ? {returned: moldReturned(value.returned)} : {})};
}
/** Finance's return of a request (2026-11-10): its reason (3 to 500 characters as production checks it), when, and when the CRM's
 *  correction reached production (null until then); null for anything else. */
export function moldReturned(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.reason !== 'string' || !value.reason.trim()) return null;
  const name = typeof value.name === 'string' ? [...value.name.trim()].slice(0, 190).join('') : '';
  return {by: /** @type {'finance'} */ ('finance'), ...(name ? {name} : {}), reason: [...value.reason.trim()].slice(0, 500).join(''), at: dateOrNull(value.at), correctedAt: dateOrNull(value.correctedAt)};
}

/**
 * The body of the `approval` route: the sales manager's approval in the CRM, or its withdrawal. The request is named by its
 * crmRequestId when it came from the CRM; one registered in the products application by its requestRef (the products update of
 * 2026-11-05: it has no number while it waits for the sales manager), or by its orderNo when production sent no requestRef (the
 * application before that update): one of them only. Throws on a value production refuses.
 * @param {{id?: string|null, requestRef?: string|null, orderNo?: number|null, action: string, by: {name?: string, email?: string}, termsAccepted?: boolean}} input
 */
export function moldApprovalBody({id = null, requestRef = null, orderNo = null, action, by, termsAccepted = false}) {
  const named = [id, requestRef, orderNo].filter(value => value !== null).length;
  if (named !== 1) throw new Error(id === null ? requestRef === null ? 'crmRequestId' : 'requestRef' : 'crmRequestId');
  if (id !== null && !MOLD_ID.test(id)) throw new Error('crmRequestId');
  if (requestRef !== null && !moldRequestRef(requestRef)) throw new Error('requestRef');
  if (orderNo !== null && (!isWhole(orderNo) || orderNo < 1)) throw new Error('orderNo');
  if (!MOLD_APPROVAL_ACTIONS.includes(action)) throw new Error('action');
  const name = moldText(by?.name), email = moldText(by?.email);
  if (!name || length(name) > MOLD_LIMITS.salesmanName) throw new Error('by.name');
  /** @type {{crmRequestId?: string, requestRef?: string, orderNo?: number, action: string, by: {name: string, email?: string}}} */
  const body = id !== null ? {crmRequestId: id, action, by: {name}} : requestRef !== null ? {requestRef, action, by: {name}} : {orderNo: /** @type {number} */ (orderNo), action, by: {name}};
  if (email && length(email) <= MOLD_LIMITS.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) body.by.email = email;
  // 2026-11-10: an approval carries the sales manager's acknowledgement of the payment terms (ignored by the application before).
  if (action === 'approve' && termsAccepted === true) body.termsAccepted = true;
  return body;
}

/**
 * Why production refused the sales manager's approval or its withdrawal (409 request_locked), from the request as production returned
 * it (error.details.request): cancelled (or deleted) there, a historical request from the sheet that needs no approval, or the step
 * has moved on (approving: no longer at the sales step; withdrawing: production approved first).
 * @param {{status?: string, approvals?: {required?: boolean} | null} | null | undefined} status
 * @param {boolean} approving
 */
export function moldApprovalRefusal(status, approving) {
  if (status?.status === 'cancelled') return 'الطلب ملغى في تطبيق الإنتاج.';
  if (status?.approvals?.required === false) return 'طلب قديم من الشيت ومعتمد أصلًا؛ لا يحتاج اعتمادًا.';
  // The contract (approval, 409): production's approval given means the sales manager's can no longer be withdrawn.
  if (status?.approvals?.production || status?.approvals?.admin) return approving ? 'الطلب لم يعد بانتظار اعتماد مدير المبيعات.' : 'اعتمد الإنتاج الطلب؛ لم يعد سحب اعتماد مدير المبيعات ممكنًا.';
  return approving ? 'الطلب لم يعد بانتظار اعتماد مدير المبيعات.' : 'تغيّرت حالة الطلب في تطبيق الإنتاج؛ حدّث الصفحة.';
}

const textOf = (value, max) => typeof value === 'string' ? value.replace(/[ \t ]+/g, ' ').trim().slice(0, max) : '';
const wholeOrNull = value => isWhole(value) ? value : null;
/**
 * One request waiting for the sales manager, as the `pending` route lists it (from the CRM or registered in the products application),
 * reduced to the fields the contract names, with its design files (none when production sent none) and how the customer pays (cash,
 * deferred, or null for a request asked for before 2026-11-03); null when it is not one. No production data travels in it. From
 * production's update of 2026-11-03 (the key quoteOrPoMissing): its quotation and PO numbers and their files as production holds them now.
 * @param {any} value
 */
export function moldPendingItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!(value.crmRequestId === null || MOLD_ID.test(value.crmRequestId || '')) || !['crm', 'manual'].includes(value.source)) return null;
  // The products update of 2026-11-05 (the second): orderNo null (or absent) until production approves, requestRef always. An item is
  // read as long as something names it (its crmRequestId, its requestRef or its number); one named by nothing could be neither
  // approved nor told apart, and is left out.
  const orderNo = orderNoOf(value.orderNo), requestRef = moldRequestRef(value.requestRef);
  if (orderNo === null && requestRef === null && value.crmRequestId === null) return null;
  const c = value.customer && typeof value.customer === 'object' ? value.customer : {}, s = value.salesman && typeof value.salesman === 'object' ? value.salesman : {}, p = value.specs && typeof value.specs === 'object' ? value.specs : {};
  return {
    orderNo, ...(requestRef ? {requestRef} : {}), crmRequestId: value.crmRequestId, source: value.source, requestedAt: dateOrNull(value.requestedAt), waitingSince: dateOrNull(value.waitingSince),
    enteredBy: value.source === 'manual' ? textOf(value.enteredBy, 190) || null : null,
    customer: {crmNumber: wholeOrNull(c.crmNumber), name: textOf(c.name, 200), address: textOf(c.address, 300), city: textOf(c.city, 100), ...(typeof c.erpCode === 'string' ? {erpCode: textOf(c.erpCode, MOLD_LIMITS.erpCode)} : {})},
    salesman: {crmMemberId: textOf(s.crmMemberId, 64), name: textOf(s.name, 160)},
    specs: {description: textOf(p.description, 200), core: textOf(p.core, 20), vibrators: wholeOrNull(p.vibrators), model: textOf(p.model, 20), halfBlock: textOf(p.halfBlock, 20),
      moldWidth: wholeOrNull(p.moldWidth), gelbaSize: wholeOrNull(p.gelbaSize), moldNo: textOf(p.moldNo, 40), quantity: wholeOrNull(p.quantity), designUrl: /^https:\/\/\S+$/i.test(p.designUrl || '') ? String(p.designUrl).slice(0, 1000) : '', notes: textOf(p.notes, 2000)},
    payment: moldPayment(value.payment), revision: wholeOrNull(value.revision), designFiles: designFilesOf(value.designFiles) || [],
    ...quotePoOf(value), ...nov10Of(value),
  };
}

/**
 * What an answer means for the CRM (§4): ok (the request object came back), locked (409 request_locked: production started, the
 * approvals are complete, or, for the requests route, the request exists there with other data: reason production_only), not_found
 * (404), rejected (400/413: the data must change before a retry helps; reason: why production refused a design file's bytes or place,
 * details.reason) or retry (anything else: network, timeout, 401, 503 not_configured, 5xx, a reply that is not the contract's).
 * @param {number} httpStatus
 * @param {any} json
 * @param {{manual?: boolean}} [options] manual: the call may be about a request registered in production (the approval route)
 * @returns {{kind: 'ok'|'locked'|'not_found'|'rejected'|'retry', code: string, fields: string[], reason?: string, request?: any}}
 */
export function readMoldAnswer(httpStatus, json, {manual = false} = {}) {
  const error = json && typeof json === 'object' && json.error && typeof json.error === 'object' ? json.error : null;
  const code = typeof error?.code === 'string' ? error.code.slice(0, 40) : '';
  const fields = Array.isArray(error?.fields) ? error.fields.filter(field => typeof field === 'string').map(field => field.slice(0, 60)).slice(0, 30) : [];
  if (httpStatus >= 200 && httpStatus < 300 && !error) return {kind: 'ok', code: '', fields};
  const reason = typeof error?.details?.reason === 'string' && /^[a-z_]{1,40}$/.test(error.details.reason) ? error.details.reason : '';
  // An approval answer may be about a request registered in production (crmRequestId null): manual reads that one too.
  if (httpStatus === 409 && code === 'request_locked') return {kind: 'locked', code, fields, request: moldStatusObject(error.details?.request, {manual}), ...(reason ? {reason} : {})};
  if (httpStatus === 404 && code === 'not_found') return {kind: 'not_found', code, fields};
  if (httpStatus === 400 || httpStatus === 413) return {kind: 'rejected', code: code || 'http_' + httpStatus, fields, ...(reason ? {reason} : {})};
  return {kind: 'retry', code: code || 'http_' + httpStatus, fields};
}

/** The requests route's 409 request_locked for a request production holds with other data (details.reason, yourrest-products
 *  2026-11-02): once sent, a request's data is edited by the production manager in the products application only. */
export const MOLD_PRODUCTION_ONLY = 'production_only';
/** The reason in the representative's words, Arabic and English. @type {[string, string]} */
export const MOLD_PRODUCTION_ONLY_TEXT = ['بيانات الطلب يعدّلها مدير الإنتاج فقط', 'The request\'s data is edited by the production manager only'];

/**
 * Whether a send's answer proves that production did not store what was sent: refused at its door before the request was read (any
 * 4xx but 409: the signature, the clock, the data, the size, the route), production's own 503 not_configured (the secret is checked
 * first), or the CRM's own refusal before sending (http 0, rejected). Anything else may have reached production: no answer (network,
 * timeout), a 5xx or another 503, a 2xx or 3xx that is not the contract's, and of course ok or locked.
 * @param {{kind: string, code: string, http?: number}} answer
 */
export function moldAnswerNotStored(answer) {
  const http = answer.http || 0;
  if (answer.kind === 'rejected') return true;
  if (answer.kind === 'ok' || answer.kind === 'locked') return false;
  return http >= 400 && http < 500 && http !== 409 || http === 503 && answer.code === 'not_configured';
}

/**
 * Whether a request has certainly never reached production, so the CRM alone may still change its data (yourrest-products 2026-11-02:
 * once sent, the production manager alone edits it there). Sent: production accepted it (accepted, or a status from production), or a
 * send of it may have arrived: an attempt whose answer is unknown (no answer, or one that did not prove a refusal) or lost (an attempt
 * started after the last answer recorded: in flight, or its answer never stored). Never sent: never attempted, or every attempt refused
 * before production stored it, which the send records on its error as notStored (moldAnswerNotStored, for that attempt and every one
 * before it); an error stored before this rule carries no such mark and counts as sent. MOLD_NEVER_SENT_SQL
 * (lib/mold-requests-server.ts) says the same in SQL.
 * @param {{accepted?: unknown, remote?: unknown, lastAttemptAt?: string | null, lastError?: {at?: string, notStored?: boolean} | null}} row
 */
export function moldNeverSent(row) {
  if (row.accepted || row.remote) return false;
  if (!row.lastAttemptAt) return true;
  const error = row.lastError;
  return error?.notStored === true && typeof error.at === 'string' && error.at >= row.lastAttemptAt;
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

/** Arabic written loosely: no marks or tatweel, one alef, ى as ي, ة as ه, no «ال» at the start, single spaces. */
const looseArabic = value => String(value ?? '').normalize('NFC').replace(/[\u0640\u064B-\u065F\u0670]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/\s+/g, ' ').trim().toLowerCase().replace(/^ال/, '');
/** The other spellings each sheet city goes by in the CRM (its English name, the full Arabic name), loosely written. */
const CITY_NAMES = {
  'Damam - الدمام': ['دمام', 'damam', 'dammam'], 'Riyadh - الرياض': ['رياض', 'riyadh'], 'Qassem - القصيم': ['قصيم', 'qassem', 'qassim'],
  'Madina - المدينة': ['مدينه', 'مدينه المنوره', 'madina', 'madinah', 'medina'], 'Jeddah - جده': ['جده', 'jeddah', 'jedda'],
  'MAkkah - مكة': ['مكه', 'مكه المكرمه', 'makkah', 'mecca', 'makka'], 'Taif - الطائف': ['طائف', 'طايف', 'taif'],
  'Khames - خميس مشيط': ['خميس مشيط', 'خميس', 'khamis mushait', 'khames'], 'Jizan - جيزان': ['جيزان', 'جازان', 'jizan', 'jazan'],
};
/**
 * A CRM customer's city as production's sheet writes it when it is one of the sheet's cities (by its Arabic or English name, or the
 * sheet's own form); any other city is sent as it is, trimmed to 100 characters. Nothing is guessed beyond the names listed.
 * @param {unknown} city
 */
export function sheetCity(city) {
  const text = String(city ?? '').replace(/[ \t ]+/g, ' ').trim();
  if (!text) return '';
  const loose = looseArabic(text);
  for (const [sheet, names] of Object.entries(CITY_NAMES)) if (loose === looseArabic(sheet) || names.includes(loose)) return sheet;
  return [...text].slice(0, 100).join('');
}
/**
 * The city a new request carries: the sheet's form when the CRM city is one of the sheet's cities (production then fills it in
 * itself, as for the customers list), else the CRM's text unchanged (moldRequestBody leaves out one production would refuse).
 * @param {unknown} city
 */
export function moldRequestCity(city) {
  const sheet = sheetCity(city);
  return MOLD_SHEET_CITIES.includes(sheet) ? sheet : String(city ?? '');
}

/**
 * One customer of the customers route from a CRM customer: its Yourrest number, name (required, 200), address (300), city (100) and,
 * since 2026-11-02, its ERP code (`erpCode`, «كود العميل في ERP», up to 50) when one is given: Arabic-Indic digits as ASCII digits (as
 * the ERP writes them, so production finds 146 by typing 146), control characters and invisible marks (direction marks, zero-width
 * characters, as a paste from an RTL sheet brings) dropped, '' when the customer has none (or a value
 * too long to be an ERP code, never cut), so production clears a code removed in the CRM. Without `erpCode` (a deleted customer, whose
 * code the deletion record does not keep) the field is left out and production keeps what it holds. null when it cannot be sent (no
 * number or no name).
 * @param {{crmNumber: unknown, name: unknown, address?: unknown, city?: unknown, erpCode?: unknown, active?: boolean}} input
 */
export function moldCustomerEntry({crmNumber, name, address, city, erpCode, active = true}) {
  if (!isWhole(crmNumber) || crmNumber < 1 || crmNumber > 2147483647) return null;
  const clean = (value, max) => { const text = moldText(String(value ?? '')); return text ? [...text].slice(0, max).join('') : ''; };
  const customerName = clean(name, 200);
  if (!customerName) return null;
  /** @type {{crmNumber: number, name: string, address?: string, city?: string, erpCode?: string, active: boolean}} */
  const entry = {crmNumber, name: customerName};
  const customerAddress = clean(address, 300), customerCity = clean(sheetCity(city), 100);
  if (customerAddress) entry.address = customerAddress;
  if (customerCity) entry.city = customerCity;
  if (erpCode !== undefined) {
    const code = moldErpCodeText(erpCode);
    entry.erpCode = length(code) <= MOLD_LIMITS.erpCode ? code : '';
  }
  entry.active = active !== false;
  return entry;
}

const jsonBytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
/**
 * The calls of the customers route that carry the whole list: one `full` call when it fits production's limits (20000 customers,
 * 2 MB), else `upsert` batches each within them (no final `full`, which would be refused: nobody is deactivated that time).
 * @template T
 * @param {T[]} customers
 * @returns {{mode: 'full'|'upsert', customers: T[]}[]}
 */
export function moldCustomerCalls(customers) {
  if (customers.length <= MOLD_CUSTOMERS_MAX && jsonBytes({mode: 'full', customers}) <= MOLD_CUSTOMERS_BODY_LIMIT) return [{mode: 'full', customers}];
  /** @type {{mode: 'full'|'upsert', customers: T[]}[]} */
  const calls = [];
  let batch = [], size = 64;
  for (const entry of customers) {
    const one = jsonBytes(entry) + 1;
    if (batch.length && (batch.length >= MOLD_CUSTOMERS_MAX || size + one > MOLD_CUSTOMERS_BODY_LIMIT - 1024)) { calls.push({mode: 'upsert', customers: batch}); batch = []; size = 64; }
    batch.push(entry); size += one;
  }
  if (batch.length) calls.push({mode: 'upsert', customers: batch});
  return calls;
}
