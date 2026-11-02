// The mold requests contract with yourrest-products, version 1 (docs/MOLD-REQUESTS-CONTRACT-AR.md and its addendum
// docs/MOLD-REQUESTS-CONTRACT-ADDENDUM-AR.md, with the design files of 2026-11-02): the values and limits both sides accept, the request
// body the CRM sends, the design files it attaches, the status object it receives, how an answer is read and when a failed send is
// tried again. Pure functions, no I/O and no secret: the server, the browser form and the historical import tool (release/operations)
// share them.

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
 * too_large, which production answers with 413).
 * @param {unknown} name
 * @param {Uint8Array} bytes
 * @returns {{ok: true, name: string, extension: string, kind: 'pdf'|'image'|'other', contentType: string, width: number|null, height: number|null} | {ok: false, field: 'name'|'file', reason: string}}
 */
export function moldDesignFileCheck(name, bytes) {
  const named = moldDesignName(name);
  if (!named) return {ok: false, field: 'name', reason: 'name'};
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
 * exactly these bytes. Throws on a value production would refuse.
 * @param {{crmRequestId: string, crmFileId: string, name: string}} meta
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function moldDesignFileBody({crmRequestId, crmFileId, name}, bytes) {
  if (!MOLD_ID.test(crmRequestId || '')) throw new Error('crmRequestId');
  if (!MOLD_ID.test(crmFileId || '')) throw new Error('crmFileId');
  if (moldDesignName(name)?.name !== name) throw new Error('name');
  if (!(bytes instanceof Uint8Array)) throw new Error('file');
  const line = new TextEncoder().encode(JSON.stringify({crmRequestId, crmFileId, name}) + '\n');
  if (line.length > MOLD_DESIGN_LINE_LIMIT) throw new Error('name');
  const body = new Uint8Array(line.length + bytes.length);
  body.set(line); body.set(bytes, line.length);
  return body;
}

/**
 * One entry of designFiles (in the status object and in pending items), reduced to the contract's fields; null when it is not one.
 * fileId is production's (a positive whole number or an id like crmRequestId) and is sent back as it came; crmFileId is the CRM's for a
 * file the CRM sent (source crm), null for one production attached. A kind the contract does not list is shown as other.
 * @param {any} value
 * @returns {{fileId: string|number, crmFileId: string|null, name: string, kind: 'pdf'|'image'|'other', size: number|null, source: 'crm'|'production', uploadedAt: string|null} | null}
 */
export function moldDesignFileEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !MOLD_DESIGN_SOURCES.includes(value.source)) return null;
  const fileId = isWhole(value.fileId) && value.fileId > 0 ? value.fileId : typeof value.fileId === 'string' && MOLD_ID.test(value.fileId) ? value.fileId : null;
  const crmFileId = value.source === 'crm' && typeof value.crmFileId === 'string' && MOLD_ID.test(value.crmFileId) ? value.crmFileId : null;
  const name = moldDesignDisplayName(value.name);
  if (fileId === null || !name || value.source === 'crm' && !crmFileId) return null;
  return {fileId, crmFileId, name, kind: MOLD_DESIGN_KINDS.includes(value.kind) ? value.kind : 'other', size: isWhole(value.size) && value.size >= 0 ? value.size : null, source: value.source, uploadedAt: dateOrNull(value.uploadedAt)};
}
/** designFiles as received: the valid entries, each fileId once, up to 50; null when production sent none (an older application). */
function designFilesOf(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set(), out = [];
  for (const item of value) {
    const entry = moldDesignFileEntry(item);
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
  }
  return out;
}
/** A status object (§3) as received, reduced to the fields the contract names; null when it is not one. manual: a request registered
 * in the products application itself (its approval answer), which has no crmRequestId. designFiles: the request's design files, the
 * CRM's and production's (null from an application older than the addition of 2026-11-02).
 * @param {any} value
 * @param {{manual?: boolean}} [options] */
export function moldStatusObject(value, {manual = false} = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!(MOLD_ID.test(value.crmRequestId || '') || manual && value.crmRequestId === null) || !MOLD_STATUSES.includes(value.status) || typeof value.editable !== 'boolean') return null;
  /** @type {Record<string, {done: boolean, at: string|null}>} */
  const stages = {};
  for (const key of MOLD_STAGES) { const stage = value.stages?.[key]; stages[key] = {done: stage?.done === true, at: dateOrNull(stage?.at)}; }
  return {
    crmRequestId: value.crmRequestId, orderNo: isWhole(value.orderNo) ? value.orderNo : null, status: value.status, editable: value.editable,
    moldSerial: shortOrNull(value.moldSerial, 40), productionDate: dateOrNull(value.productionDate), stages,
    stagesDone: MOLD_STAGES.filter(key => stages[key].done).length, stagesTotal: MOLD_STAGES.length,
    delivered: value.delivered === true, deliveryDate: dateOrNull(value.deliveryDate), updatedAt: shortOrNull(value.updatedAt, 40), revision: isWhole(value.revision) ? value.revision : null,
    waitingStep: MOLD_WAITING_STEPS.includes(value.waitingStep) ? value.waitingStep : null, waitingSince: dateOrNull(value.waitingSince), approvals: approvalsOf(value.approvals),
    designFiles: designFilesOf(value.designFiles),
  };
}

/**
 * The body of the `approval` route: the sales manager's approval in the CRM, or its withdrawal. The request is named by its
 * crmRequestId when it came from the CRM, or by its orderNo when it was registered in the products application: one of them only.
 * Throws on a value production refuses.
 * @param {{id?: string|null, orderNo?: number|null, action: string, by: {name?: string, email?: string}}} input
 */
export function moldApprovalBody({id = null, orderNo = null, action, by}) {
  if ((id === null) === (orderNo === null)) throw new Error(id === null ? 'crmRequestId' : 'orderNo');
  if (id !== null && !MOLD_ID.test(id)) throw new Error('crmRequestId');
  if (orderNo !== null && (!isWhole(orderNo) || orderNo < 1)) throw new Error('orderNo');
  if (!MOLD_APPROVAL_ACTIONS.includes(action)) throw new Error('action');
  const name = moldText(by?.name), email = moldText(by?.email);
  if (!name || length(name) > MOLD_LIMITS.salesmanName) throw new Error('by.name');
  /** @type {{crmRequestId?: string, orderNo?: number, action: string, by: {name: string, email?: string}}} */
  const body = id !== null ? {crmRequestId: id, action, by: {name}} : {orderNo: /** @type {number} */ (orderNo), action, by: {name}};
  if (email && length(email) <= MOLD_LIMITS.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) body.by.email = email;
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
 * reduced to the fields the contract names, with its design files (none when production sent none); null when it is not one. No
 * production data travels in it.
 * @param {any} value
 */
export function moldPendingItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !isWhole(value.orderNo) || value.orderNo < 1) return null;
  if (!(value.crmRequestId === null || MOLD_ID.test(value.crmRequestId || '')) || !['crm', 'manual'].includes(value.source)) return null;
  const c = value.customer && typeof value.customer === 'object' ? value.customer : {}, s = value.salesman && typeof value.salesman === 'object' ? value.salesman : {}, p = value.specs && typeof value.specs === 'object' ? value.specs : {};
  return {
    orderNo: value.orderNo, crmRequestId: value.crmRequestId, source: value.source, requestedAt: dateOrNull(value.requestedAt), waitingSince: dateOrNull(value.waitingSince),
    enteredBy: value.source === 'manual' ? textOf(value.enteredBy, 190) || null : null,
    customer: {crmNumber: wholeOrNull(c.crmNumber), name: textOf(c.name, 200), address: textOf(c.address, 300), city: textOf(c.city, 100)},
    salesman: {crmMemberId: textOf(s.crmMemberId, 64), name: textOf(s.name, 160)},
    specs: {description: textOf(p.description, 200), core: textOf(p.core, 20), vibrators: wholeOrNull(p.vibrators), model: textOf(p.model, 20), halfBlock: textOf(p.halfBlock, 20),
      moldWidth: wholeOrNull(p.moldWidth), gelbaSize: wholeOrNull(p.gelbaSize), moldNo: textOf(p.moldNo, 40), quantity: wholeOrNull(p.quantity), designUrl: /^https:\/\/\S+$/i.test(p.designUrl || '') ? String(p.designUrl).slice(0, 1000) : '', notes: textOf(p.notes, 2000)},
    revision: wholeOrNull(value.revision), designFiles: designFilesOf(value.designFiles) || [],
  };
}

/**
 * What an answer means for the CRM (§4): ok (the request object came back), locked (409 request_locked: production started, or the
 * approvals are complete), not_found (404), rejected (400/413: the data must change before a retry helps; reason: why production refused
 * a design file's bytes, details.reason) or retry (anything else: network, timeout, 401, 503 not_configured, 5xx, a reply that is not
 * the contract's).
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
  // An approval answer may be about a request registered in production (crmRequestId null): manual reads that one too.
  if (httpStatus === 409 && code === 'request_locked') return {kind: 'locked', code, fields, request: moldStatusObject(error.details?.request, {manual})};
  if (httpStatus === 404 && code === 'not_found') return {kind: 'not_found', code, fields};
  const reason = typeof error?.details?.reason === 'string' && /^[a-z_]{1,40}$/.test(error.details.reason) ? error.details.reason : '';
  if (httpStatus === 400 || httpStatus === 413) return {kind: 'rejected', code: code || 'http_' + httpStatus, fields, ...(reason ? {reason} : {})};
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
    const code = moldText(String(erpCode ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '')
      .replace(/[\u0660-\u0669]/g, digit => String(digit.charCodeAt(0) - 0x0660)).replace(/[\u06F0-\u06F9]/g, digit => String(digit.charCodeAt(0) - 0x06F0))) ?? '';
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
