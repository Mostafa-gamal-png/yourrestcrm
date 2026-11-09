// The mold requests contract, version 1 (docs/MOLD-REQUESTS-CONTRACT-AR.md and its addendum), on the CRM side: the signature against
// the contract's test vector, the settings check, the form checks, the request body, the status object, how answers are read, the
// §6 retry timetable, the design files of 2026-11-02 (names, bytes, pixels, the body, designFiles), and every route against a stand-in
// production API that applies the same checks as the PHP. Since 2026-11-02 a sent request's data is edited by the production manager only:
// the requests route's 409 production_only, its text, which answers prove production never stored a send, and the edit rule (the
// portable rule and lib/mold-requests.ts's permission, transpiled). Since 2026-11-03 (yourrest-products): the third approval is shown
// as «اعتماد المالية» (still keyed admin); `payment` (cash or deferred) beside customer, salesman and specs, required for a new request,
// sent only when the request has it (an older request is resent exactly as first sent), refused by production otherwise (fields
// ['payment']) and listed by pending; and a cancellation the production manager restores, after which a reason used before answers 200
// with the request as it is and only a new reason cancels it. Since production's second update of 2026-11-03: the quotation and PO
// numbers (normalized, up to 60 characters, at least one, sent after payment only when given, an older request byte for byte as before),
// how the CRM learns that the update is live (quoteOrPoMissing in a status object or a pending item), the files' categories (a PDF or an
// image only, the body's category for those alone), the view's numbers and limits, and the stand-in as the application before and after
// its update. Who sees which request (the owner, 2026-11-03): the sales manager's team walked up «المشرف», what each role reads and what
// each manager approves; «رابط التصميم» no longer asked for. Since production's update of 2026-11-05: the view carries production's flag
// alone (no number), a new request asked for under the rule waits for its quotation or PO file (moldHeldFor quote_file, needs_file, no
// resend), the sales manager's approval waits for design files only, and the stand-in counts files, not numbers, and keeps the approvals
// for a quotation's or PO's file. Since 2026-11-08 every new request (data.designRequired) waits for its design file too (moldHeldFor
// design_file: the customer's signature, a deleted or refused file count for nothing; the quotation's first), its texts, the requests
// body unchanged by the marker. Since 2026-11-09 each request carries its delivery address (moldAddress: trimmed, required, up to 300
// characters as production counts them; the view's customerAddress; the body's customer.address from the request's data, an older
// request's bytes unchanged). Synthetic files only; no real account.
import assert from 'node:assert/strict';
import {request as httpsRequest} from 'node:https';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {MOLD_STAGES, MOLD_LIMITS, MOLD_HALF_BLOCKS, MOLD_CUSTOMERS_BODY_LIMIT, validateMoldSpecs, moldRequestBody, moldApprovalBody, moldApprovalRefusal, moldPendingItem, moldStatusObject, readMoldAnswer, moldNextAttempt, riyadhIso, moldText, sheetCity, moldRequestCity, moldCustomerEntry, moldCustomerCalls,
  MOLD_DESIGN_EXTENSIONS, MOLD_DESIGN_MAX_BYTES, MOLD_DESIGN_MAX_FILES, MOLD_DESIGN_MAX_PIXELS, MOLD_DESIGN_REASONS, MOLD_DESIGN_PLACE_REASONS, moldDesignName, moldDesignDisplayName, moldImageSize, moldDesignFileCheck, moldDesignContentType, moldDispositionName, moldContentDisposition, moldDesignFileBody, moldDesignFileEntry,
  MOLD_PRODUCTION_ONLY, MOLD_PRODUCTION_ONLY_TEXT, moldAnswerNotStored, moldNeverSent, MOLD_PAYMENTS, MOLD_PAYMENT_REQUIRED, MOLD_WAITING_STEPS, MOLD_APPROVAL_STEPS, moldPayment, moldCancelReasonKey, moldCancelReasonUsed,
  MOLD_QUOTE_PO_MAX, MOLD_QUOTE_PO_REQUIRED, MOLD_FILE_CATEGORIES, MOLD_CATEGORY_MAX_FILES, moldQuotePoNumber, validateMoldQuotePo, moldQuotePoAnswered} from '../portable/mold-rules.mjs';
import * as rules from '../portable/mold-rules.mjs';
import {moldSignature, moldConfig, callProducts, moldRouteTimeout} from '../portable/mold-client.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';
import {signaturePng} from '../scripts/lib/signature-png.mjs';

let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

// ---- §1: the contract's test vector, byte for byte
{
  const body = Buffer.from('{"crmRequestId":"rec-1","specs":{"notes":"طلب تجريبي"}}', 'utf8');
  eq(createHash('sha256').update(body).digest('hex'), 'c7f373832a49548ba96241f5284c065765fb871add3a3c32adbf9be6e8d2b19a', 'sha256 of the vector body');
  eq(moldSignature('test-secret-for-contract-vector-0123456789abcdef', '1767225600', 'POST', 'requests', body), 'd52d43c3f895c07a5a1c8ffddebc6a1a3e7f819df32b6c06c8cf3f104777a3f1', 'the expected signature');
  eq(moldSignature('k'.repeat(32), '1767225600', 'POST', 'status', Buffer.alloc(0)).length, 64, 'an empty body signs the sha256 of the empty text');
}

// ---- settings: address and secret from the private settings, never echoed
{
  const secret = 'x'.repeat(40);
  eq(moldConfig({}), {ok: false, reason: 'not_configured'}, 'nothing set: sending is off');
  eq(moldConfig({YR_PRODUCTS_API_URL: 'https://yourrest.org/products/crm-api.php'}), {ok: false, reason: 'not_configured'}, 'no secret: off');
  eq(moldConfig({YR_PRODUCTS_API_URL: 'http://yourrest.org/products/crm-api.php', YR_PRODUCTS_SECRET: secret}).reason, 'invalid_url', 'HTTPS only');
  eq(moldConfig({YR_PRODUCTS_API_URL: 'https://u:p@yourrest.org/products/crm-api.php', YR_PRODUCTS_SECRET: secret}).reason, 'invalid_url', 'no credentials in the address');
  eq(moldConfig({YR_PRODUCTS_API_URL: 'https://yourrest.org/products/crm-api.php?route=requests', YR_PRODUCTS_SECRET: secret}).reason, 'invalid_url', 'the CRM adds ?route= itself');
  eq(moldConfig({YR_PRODUCTS_API_URL: 'https://yourrest.org/products/crm-api.php', YR_PRODUCTS_SECRET: 'short'}).reason, 'short_secret', 'at least 32 characters');
  const good = moldConfig({YR_PRODUCTS_API_URL: ' https://yourrest.org/products/crm-api.php ', YR_PRODUCTS_SECRET: secret});
  eq([good.ok, good.url], [true, 'https://yourrest.org/products/crm-api.php'], 'a good pair');
  ok(!JSON.stringify(moldConfig({YR_PRODUCTS_API_URL: 'nope', YR_PRODUCTS_SECRET: secret})).includes(secret), 'a refusal never carries the secret');
}

// ---- the form: the contract's lists and limits
const specs = {description: '200*400*27.5TH MM OPEN', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: 'YR099-9', quantity: 1, designUrl: 'https://drive.google.com/x', notes: ''};
{
  eq(validateMoldSpecs(specs).errors, {}, 'the contract example passes');
  eq(validateMoldSpecs({...specs, vibrators: '3', moldWidth: '1375', gelbaSize: ' 800 ', quantity: '2'}).specs.vibrators, 3, 'digits from a form become numbers');
  const wrong = validateMoldSpecs({description: '  ', core: 'half', vibrators: 5, model: 'newest', halfBlock: 'four', moldWidth: 1380.5, gelbaSize: 499, quantity: 0, designUrl: 'http://x.com', moldNo: 'x'.repeat(41), notes: 'a\u0007'});
  eq(Object.keys(wrong.errors).sort(), ['core', 'description', 'designUrl', 'gelbaSize', 'halfBlock', 'model', 'moldNo', 'moldWidth', 'notes', 'quantity', 'vibrators'], 'every wrong field is named');
  eq(Object.keys(MOLD_HALF_BLOCKS), ['none', 'one', 'two', 'three'], 'half blocks: none to three, as the sheet (No H.B to 3 H.B)');
  for (const halfBlock of ['two', 'three']) eq(validateMoldSpecs({...specs, halfBlock}).errors, {}, 'half block ' + halfBlock + ' is accepted');
  ok(Object.values(wrong.errors).every(message => /[؀-ۿ]/.test(message)), 'in Arabic');
  eq(validateMoldSpecs({...specs, description: 'x'.repeat(200)}).errors, {}, '200 characters of description pass');
  ok(validateMoldSpecs({...specs, description: 'x'.repeat(201)}).errors.description, '201 do not');
  eq([validateMoldSpecs({...specs, moldWidth: 999}).errors.moldWidth !== undefined, validateMoldSpecs({...specs, moldWidth: 2000}).errors.moldWidth], [true, undefined], 'width 1000 to 2000');
  eq(validateMoldSpecs({...specs, designUrl: 'https://a b'}).errors.designUrl !== undefined, true, 'a link with a space is refused');
  eq([moldText('  a \t b  c  '), moldText('a\nb'), moldText('a\u0000')], ['a b c', 'a\nb', undefined], 'texts are stored as production stores them');
}

// ---- the request body (§2)
const customer = {crmNumber: 27, name: 'مصنع زايد للطابوق', address: 'الدمام', city: 'Damam - الدمام'};
const salesman = {crmMemberId: 'mem-1', name: 'أحمد عبد العزيز', email: 'name@yourrest.org'};
{
  const body = moldRequestBody({id: 'rec-9f3a', requestedAt: '2026-10-29T10:15:00+03:00', customer, salesman, specs});
  eq(Object.keys(body), ['crmRequestId', 'requestedAt', 'customer', 'salesman', 'specs'], 'the contract keys, no legacy number for a new request');
  eq(body.specs, {description: '200*400*27.5TH MM OPEN', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: 'YR099-9', quantity: 1, designUrl: 'https://drive.google.com/x'}, 'empty notes are left out; numbers are JSON integers');
  eq(JSON.stringify(moldRequestBody({id: 'rec-9f3a', requestedAt: '2026-10-29T10:15:00+03:00', customer, salesman, specs})), JSON.stringify(body), 'the same request gives the same bytes');
  // «رابط التصميم» is no longer asked for (2026-11-03): a new request stores '' and its body has no designUrl key; an older request's own
  // link stays in its body exactly where it was (the bytes above).
  eq([Object.hasOwn(moldRequestBody({id: 'rec-9f3a', requestedAt: '2026-10-29T10:15:00+03:00', customer, salesman, specs: {...specs, designUrl: ''}}).specs, 'designUrl'), Object.keys(body.specs).indexOf('designUrl')], [false, 9], 'no link: none sent; an older link: sent after quantity, as first sent');
  eq(moldRequestBody({id: 'rec-1', legacyOrderNo: 12, requestedAt: '2026-10-29T10:15:00+03:00', customer, salesman, specs}).legacyOrderNo, 12, 'a historical request carries legacyOrderNo');
  assert.throws(() => moldRequestBody({id: 'rec-1', requestedAt: 'x', customer: {...customer, crmNumber: '27'}, salesman, specs}), /customer.crmNumber/); checks++;
  assert.throws(() => moldRequestBody({id: 'rec 1', requestedAt: 'x', customer, salesman, specs}), /crmRequestId/); checks++;
  assert.throws(() => moldRequestBody({id: 'rec-1', requestedAt: 'x', customer: {...customer, name: 'x'.repeat(MOLD_LIMITS.customerName + 1)}, salesman, specs}), /customer.name/); checks++;
  // Production takes a customer name up to 200 characters in both routes: any customer the list carries can be asked for.
  eq(MOLD_LIMITS.customerName, 200, 'the customer name limit is production\'s 200');
  for (const size of [161, 200]) eq(moldRequestBody({id: 'rec-1', requestedAt: 'x', customer: {...customer, name: 'م'.repeat(size)}, salesman, specs}).customer.name.length, size, 'a ' + size + '-character customer name is sent whole');
  const listed = moldCustomerEntry({crmNumber: 27, name: 'ن'.repeat(250)});
  eq(moldRequestBody({id: 'rec-1', requestedAt: 'x', customer: {...customer, name: listed.name}, salesman, specs}).customer.name, listed.name, 'the name the customers list sends is always accepted for a request');
  eq(moldRequestBody({id: 'r', requestedAt: 'x', customer: {crmNumber: 1, name: 'a', city: 'c'.repeat(101)}, salesman: {name: 'b', email: 'not-an-email'}, specs}).customer, {crmNumber: 1, name: 'a'}, 'an over-long optional city and a bad email are left out, never cut');
  eq([Object.keys(body.customer), Object.keys(body.salesman)], [['crmNumber', 'name', 'address', 'city'], ['crmMemberId', 'name', 'email']], 'only the contract fields: no phone, customer email, visit or sales data (§3)');
  eq(riyadhIso('2026-10-29T07:15:00Z'), '2026-10-29T10:15:00+03:00', 'requestedAt in Riyadh time with its offset');
}

// ---- 2026-11-03: payment (cash or deferred) beside customer, salesman and specs, only when the request has one
{
  eq([MOLD_PAYMENTS, MOLD_PAYMENT_REQUIRED], [{cash: 'نقدي', deferred: 'آجل'}, 'اختار طريقة الدفع: نقدي أو آجل'], 'the two choices and the message when none is chosen');
  eq(['cash', 'deferred', 'Cash', ' cash', 'card', '', null, undefined, 1, {}].map(moldPayment), ['cash', 'deferred', null, null, null, null, null, null, null, null], 'cash or deferred, nothing else (no case or space folding)');
  const old = moldRequestBody({id: 'rec-9f3a', requestedAt: '2026-10-29T10:15:00+03:00', customer, salesman, specs});
  for (const payment of [undefined, null]) eq(JSON.stringify(moldRequestBody({id: 'rec-9f3a', requestedAt: '2026-10-29T10:15:00+03:00', customer, salesman, specs, payment})), JSON.stringify(old), 'a request without a payment (asked for before): the very same bytes as before (' + payment + ')');
  eq(Object.hasOwn(old, 'payment'), false, 'and no payment key at all');
  for (const payment of ['cash', 'deferred']) {
    const body = moldRequestBody({id: 'rec-9f3a', requestedAt: '2026-10-29T10:15:00+03:00', customer, salesman, specs, payment});
    eq([Object.keys(body), body.payment, JSON.stringify({...body, payment: undefined})], [['crmRequestId', 'requestedAt', 'customer', 'salesman', 'specs', 'payment'], payment, JSON.stringify(old)], payment + ': in the body itself after specs, the rest unchanged');
  }
  for (const payment of ['card', '', 'CASH', 0]) { assert.throws(() => moldRequestBody({id: 'rec-1', requestedAt: 'x', customer, salesman, specs, payment}), /payment/); checks++; }
  eq(readMoldAnswer(400, {error: {code: 'invalid_payload', message: 'Some fields are missing or invalid.', fields: ['payment']}}), {kind: 'rejected', code: 'invalid_payload', fields: ['payment']}, 'production refusing the payment names the field (final, the data must change)');
  const pendingWith = payment => moldPendingItem({orderNo: 7, crmRequestId: 'r', source: 'crm', customer: {name: 'x'}, salesman: {name: 'y'}, specs: {description: 'd'}, ...(payment === 'absent' ? {} : {payment})}).payment;
  eq(['cash', 'deferred', null, 'absent', 'card', 'Cash'].map(pendingWith), ['cash', 'deferred', null, null, null, null], 'pending: cash, deferred, or null (an older request, or a value the contract does not name)');
}

// ---- 2026-11-03 (production's second update): the quotation and PO numbers beside the payment, only when the request has them
{
  eq([MOLD_QUOTE_PO_MAX, MOLD_QUOTE_PO_REQUIRED], [60, 'اكتب رقم عرض السعر أو رقم الـ PO (واحد على الأقل)'], 'up to 60 characters; one at least, said so in Arabic');
  eq(['Q-٢٠٢٦-٠١٥٣', '  PO-۷۷۸۱\t', '', null, undefined, '   ', 'Q 12', 'a\u0007b', 5, {}].map(moldQuotePoNumber), ['Q-2026-0153', 'PO-7781', '', '', '', '', 'Q 12', undefined, undefined, undefined],
    'Arabic-Indic and Persian digits as ASCII, the ends trimmed (spaces inside kept); none is \'\'; a control character or a non-text is refused');
  eq(validateMoldQuotePo({quoteNo: ' Q-٢٠٢٦ ', poNo: ''}, {required: true}), {quoteNo: 'Q-2026', poNo: '', errors: {}}, 'one number is enough, normalized');
  eq(validateMoldQuotePo({poNo: 'PO-1'}, {required: true}), {quoteNo: '', poNo: 'PO-1', errors: {}}, 'the PO alone too');
  eq(validateMoldQuotePo({quoteNo: '  ', poNo: null}, {required: true}).errors, {quotePo: MOLD_QUOTE_PO_REQUIRED}, 'neither (spaces only count as none): «واحد على الأقل»');
  eq([moldQuotePoNumber('\u200F'), moldQuotePoNumber('\u200B \uFEFF'), moldQuotePoNumber('\u202BQ-١٢\u202C\u200E')], ['', '', 'Q-12'], 'invisible marks a paste may carry are dropped: a value of only those is none');
  eq(validateMoldQuotePo({quoteNo: '\u200F', poNo: '\u200B'}, {required: true}).errors, {quotePo: MOLD_QUOTE_PO_REQUIRED}, 'so it does not pass «واحد على الأقل»');
  eq(validateMoldQuotePo({}, {required: false}).errors, {}, 'not required (before production\'s update): none is fine');
  eq([validateMoldQuotePo({quoteNo: 'x'.repeat(60)}).errors, validateMoldQuotePo({quoteNo: '٠'.repeat(60) + '  '}).errors], [{}, {}], '60 characters after normalizing pass');
  eq([validateMoldQuotePo({quoteNo: 'x'.repeat(61)}, {required: true}).errors, validateMoldQuotePo({poNo: 'ط'.repeat(61), quoteNo: 'Q'}).errors], [{quoteNo: 'رقم عرض السعر أطول من 60 حرف'}, {poNo: 'رقم الـ PO أطول من 60 حرف'}], '61 do not, each named in Arabic');
  eq(validateMoldQuotePo({quoteNo: 7, poNo: 'a\u0000'}, {required: true}).errors, {quoteNo: 'رقم عرض السعر فيه رموز غير مسموحة', poNo: 'رقم الـ PO فيه رموز غير مسموحة'}, 'not a text, or a control character: refused');
  const at = '2026-10-29T10:15:00+03:00', base = {id: 'rec-9f3a', requestedAt: at, customer, salesman, specs, payment: 'cash'}, plain = JSON.stringify(moldRequestBody(base));
  for (const none of [{}, {quoteNo: '', poNo: ''}, {quoteNo: null, poNo: undefined}, {quoteNo: '   '}]) eq(JSON.stringify(moldRequestBody({...base, ...none})), plain, 'no number: the very same bytes as before (' + JSON.stringify(none) + ')');
  eq(JSON.stringify(moldRequestBody({id: 'rec-9f3a', requestedAt: at, customer, salesman, specs})), JSON.stringify(moldRequestBody({id: 'rec-9f3a', requestedAt: at, customer, salesman, specs, quoteNo: '', poNo: null})), 'a request asked for before the payment too: unchanged');
  const both = moldRequestBody({...base, quoteNo: 'Q-2026-0153', poNo: ' PO-٧٧٨١ '});
  eq([Object.keys(both), both.quoteNo, both.poNo, JSON.stringify({...both, quoteNo: undefined, poNo: undefined})], [['crmRequestId', 'requestedAt', 'customer', 'salesman', 'specs', 'payment', 'quoteNo', 'poNo'], 'Q-2026-0153', 'PO-7781', plain], 'both: after payment, quoteNo then poNo, normalized; the rest unchanged');
  eq(Object.keys(moldRequestBody({...base, poNo: 'PO-1'})).slice(-2), ['payment', 'poNo'], 'the PO alone: no quoteNo key');
  for (const [field, value] of [['quoteNo', 'x'.repeat(61)], ['poNo', 12], ['quoteNo', 'a\u0001']]) { assert.throws(() => moldRequestBody({...base, [field]: value}), new RegExp(field)); checks++; }
  eq(readMoldAnswer(400, {error: {code: 'invalid_payload', fields: ['quoteNo']}}), {kind: 'rejected', code: 'invalid_payload', fields: ['quoteNo']}, 'production refusing a number names the field (final: the data must change)');
  // How the CRM learns production's update: the key quoteOrPoMissing in a status object (or a pending item), whatever its value.
  const raw = {crmRequestId: 'rec-9f3a', orderNo: 92, status: 'received', editable: true, stages: {}, designFiles: []};
  eq([moldQuotePoAnswered(moldStatusObject(raw)), Object.hasOwn(moldStatusObject(raw), 'quoteNo'), moldQuotePoAnswered(null)], [false, false, false], 'an older application: nothing learned, nothing read');
  for (const missing of [true, false, null, 'yes']) eq(moldQuotePoAnswered(moldStatusObject({...raw, quoteOrPoMissing: missing})), true, 'the key, valued ' + JSON.stringify(missing) + ': the update is live');
  const listed = file => ({fileId: file, crmFileId: null, name: 'عرض ' + file + '.pdf', kind: 'pdf', size: 10, source: 'production', uploadedAt: '2026-11-03T10:00:00+03:00', category: 'design'});
  const read = moldStatusObject({...raw, quoteNo: ' Q-1\u0000 ', poNo: null, quoteOrPoMissing: false, quoteFiles: [listed(7)], poFiles: [listed(8), 'x'], designFiles: [listed(6)]});
  eq([read.quoteNo, read.poNo, read.quoteOrPoMissing, read.quoteFiles.map(file => [file.fileId, file.category]), read.poFiles.map(file => [file.fileId, file.category]), read.designFiles.map(file => file.category)],
    ['Q-1', '', false, [[7, 'quote']], [[8, 'po']], ['design']], 'the numbers as production holds them now, quoteOrPoMissing, and each list\'s files with its category (the list decides)');
  eq(moldStatusObject({...raw, quoteOrPoMissing: true}).quoteFiles, [], 'no list sent: none');
  const item = {orderNo: 7, crmRequestId: 'r', source: 'crm', customer: {name: 'x'}, salesman: {name: 'y'}, specs: {description: 'd'}};
  eq([moldQuotePoAnswered(moldPendingItem(item)), Object.hasOwn(moldPendingItem(item), 'quoteFiles')], [false, false], 'a pending item of the older application: none');
  const pendingRead = moldPendingItem({...item, quoteNo: 'Q-9', poNo: '', quoteOrPoMissing: false, quoteFiles: [listed(11)], poFiles: []});
  eq([moldQuotePoAnswered(pendingRead), pendingRead.quoteNo, pendingRead.poNo, pendingRead.quoteFiles[0].category, pendingRead.poFiles], [true, 'Q-9', '', 'quote', []], 'a pending item of the updated one: its numbers and files');
  // The files' categories (design-files' category): a quotation's or PO's file is a PDF or an image only.
  eq([MOLD_FILE_CATEGORIES, MOLD_CATEGORY_MAX_FILES], [['design', 'quote', 'po'], {design: 10, quote: 5, po: 5}], 'design, quote and po; 10, 5 and 5 a request');
}

// ---- 2026-11-03: a cancellation the production manager restores; a new cancellation takes a new reason
{
  eq([moldCancelReasonKey('  العميل   أجّل \n الطلب '), moldCancelReasonKey(''), moldCancelReasonKey(null)], ['العميل أجّل الطلب', '', ''], 'a reason compared with its spaces normalized and its ends trimmed');
  eq([moldCancelReasonUsed('العميل  أجّل', ['العميل أجّل']), moldCancelReasonUsed(' العميل أجّل ', ['x', 'العميل أجّل']), moldCancelReasonUsed('سبب جديد', ['العميل أجّل']), moldCancelReasonUsed('', ['']), moldCancelReasonUsed('', ['x']), moldCancelReasonUsed('x', []), moldCancelReasonUsed('x', undefined)],
    [true, true, false, true, false, false, false], 'the same reason (spaces aside) is used; any other, or none before, is new');
  eq([MOLD_WAITING_STEPS.includes('admin'), MOLD_APPROVAL_STEPS], [true, ['sales', 'production', 'admin']], 'the third approval keeps its key admin in waitingStep and approvals');
  const restored = moldStatusObject({crmRequestId: 'mr-r', orderNo: 95, status: 'received', editable: true, stages: {}, waitingStep: 'production', waitingSince: '2026-11-03T10:00:00+03:00', revision: 7,
    approvals: {required: true, sales: {at: '2026-11-03T09:00:00+03:00', by: 'sm'}, production: null, admin: null}});
  eq([restored.status, restored.editable, restored.waitingStep, !!restored.approvals.sales, restored.revision], ['received', true, 'production', true, 7], 'a restored request\'s status reads as any active one: where it stood before the cancellation');
}

// ---- the status object (§3) and answers (§4)
{
  const raw = {crmRequestId: 'rec-9f3a', orderNo: 92, status: 'in_production', editable: false, moldSerial: '093', productionDate: '2026-10-30', stages: {laserCutting: {done: true, at: '2026-10-30'}, box: {done: true, at: '2026-10-31'}}, stagesDone: 9, stagesTotal: 7, delivered: false, deliveryDate: null, updatedAt: '2026-10-31T09:00:00+03:00', revision: 5, productionNotes: 'internal', workers: ['x']};
  const read = moldStatusObject(raw);
  eq(Object.keys(read.stages), MOLD_STAGES, 'all seven stages in the fixed order');
  eq([read.stagesDone, read.stagesTotal, read.stages.coreConnector], [2, 7, {done: false, at: null}], 'counted from the stages themselves; a missing stage is not done');
  ok(!('productionNotes' in read) && !('workers' in read), 'nothing but the contract fields is kept');
  eq([moldStatusObject({...raw, status: 'lost'}), moldStatusObject({...raw, editable: 'no'}), moldStatusObject(null)], [null, null, null], 'not a status object');
  eq([read.waitingStep, read.waitingSince, read.approvals], [null, null, null], 'an older production app without the approval chain: nothing to show, nothing refused');
  const chain = moldStatusObject({...raw, status: 'received', editable: true, waitingStep: 'production', waitingSince: '2026-11-01T15:10:00+03:00',
    approvals: {required: true, sales: {at: '2026-11-01T15:10:00+03:00', by: 'manager@yourrest.org (مدير)', extra: 'x'}, production: null, admin: null}});
  eq([chain.waitingStep, chain.waitingSince, chain.approvals], ['production', '2026-11-01T15:10:00+03:00', {required: true, sales: {at: '2026-11-01T15:10:00+03:00', by: 'manager@yourrest.org (مدير)'}, production: null, admin: null}], 'where it waits, since when, and the approvals given');
  eq(moldStatusObject({...raw, waitingStep: 'lunch', approvals: {sales: null}}).waitingStep, null, 'an unknown step is not shown; approvals without required are not read');
  eq(moldStatusObject({...raw, approvals: {required: false, sales: null, production: null, admin: null}}).approvals.required, false, 'a historical request needs no approval');
  eq(moldApprovalBody({id: 'rec-9f3a', action: 'approve', by: {name: ' مدير  المبيعات ', email: 'manager@yourrest.org'}}), {crmRequestId: 'rec-9f3a', action: 'approve', by: {name: 'مدير المبيعات', email: 'manager@yourrest.org'}}, 'the approval body');
  eq(moldApprovalBody({id: 'r', action: 'withdraw', by: {name: 'm', email: 'bad'}}).by, {name: 'm'}, 'a bad email is left out');
  eq(moldApprovalBody({orderNo: 101, action: 'approve', by: {name: 'm'}}), {orderNo: 101, action: 'approve', by: {name: 'm'}}, 'a request registered in production: by its orderNo');
  for (const input of [{action: 'approve', by: {name: 'm'}}, {id: 'r', orderNo: 1, action: 'approve', by: {name: 'm'}}, {orderNo: 0, action: 'approve', by: {name: 'm'}}]) { assert.throws(() => moldApprovalBody(input), /crmRequestId|orderNo/); checks++; }
  // Why production refused (409 request_locked), from the request it returned: cancelled there, historical, or the step moved on.
  eq([moldApprovalRefusal(moldStatusObject({...raw, status: 'cancelled'}), false), moldApprovalRefusal(moldStatusObject({...raw, status: 'cancelled'}), true)], ['الطلب ملغى في تطبيق الإنتاج.', 'الطلب ملغى في تطبيق الإنتاج.'], 'cancelled or deleted in production: said so, approving or withdrawing');
  eq(moldApprovalRefusal(moldStatusObject({...raw, status: 'received', editable: true, approvals: {required: false, sales: null, production: null, admin: null}}), true), 'طلب قديم من الشيت ومعتمد أصلًا؛ لا يحتاج اعتمادًا.', 'a historical request needs no approval');
  eq(moldApprovalRefusal(moldStatusObject({...raw, status: 'cancelled', approvals: {required: false, sales: null, production: null, admin: null}}), false), 'الطلب ملغى في تطبيق الإنتاج.', 'a historical request deleted in production: cancelled first, as production checks it first');
  const lockedManual = {error: {code: 'request_locked', details: {request: {...raw, crmRequestId: null, status: 'cancelled'}}}};
  eq([readMoldAnswer(409, lockedManual).request, readMoldAnswer(409, lockedManual, {manual: true}).request.status], [null, 'cancelled'], 'a refusal about a request registered in production is read when the call may be about one');
  eq([moldApprovalRefusal(moldStatusObject({...raw, status: 'received', editable: true, approvals: {required: true, sales: {at: 'x'}, production: {at: 'y'}, admin: null}}), false), moldApprovalRefusal(null, true)], ['اعتمد الإنتاج الطلب؛ لم يعد سحب اعتماد مدير المبيعات ممكنًا.', 'الطلب لم يعد بانتظار اعتماد مدير المبيعات.'], 'production approved first; or the step moved on');
  eq(moldApprovalRefusal(null, false), 'تغيّرت حالة الطلب في تطبيق الإنتاج؛ حدّث الصفحة.', 'a refusal production gave no reason for: said plainly, never «production approved»');
  eq(moldStatusObject({...raw, crmRequestId: null}), null, 'a status without crmRequestId is not one of the CRM\'s requests');
  eq(moldStatusObject({...raw, crmRequestId: null}, {manual: true}).crmRequestId, null, 'but is read as the answer to an approval by orderNo');
  const manualItem = moldPendingItem({orderNo: 101, crmRequestId: null, source: 'manual', requestedAt: '2026-11-01T10:00:00+03:00', waitingSince: '2026-11-01T10:00:00+03:00', enteredBy: 'staff@yourrest.org', customer: {crmNumber: 27, name: ' مصنع  الأمل ', city: 'الدمام'}, salesman: {name: 'أحمد'}, specs: {description: 'x', quantity: 2, designUrl: 'http://not-https', moldStage: 'internal'}, revision: 3, stages: {box: {done: true}}});
  eq([manualItem.orderNo, manualItem.source, manualItem.enteredBy, manualItem.customer.name, manualItem.specs.quantity, manualItem.specs.designUrl, manualItem.revision, 'stages' in manualItem, 'moldStage' in manualItem.specs], [101, 'manual', 'staff@yourrest.org', 'مصنع الأمل', 2, '', 3, false, false], 'a pending item: the contract fields only, texts tidied, only an https design link');
  eq([moldPendingItem({orderNo: 1, crmRequestId: 'r', source: 'erp'}), moldPendingItem({orderNo: 'x', crmRequestId: null, source: 'manual'}), moldPendingItem({orderNo: 2, crmRequestId: 'bad id', source: 'crm'})], [null, null, null], 'not a pending item');
  eq(moldPendingItem({orderNo: 3, crmRequestId: 'r', source: 'crm', enteredBy: 'someone'}).enteredBy, null, 'enteredBy only for a request registered in production');
  for (const [input, field] of [[{id: 'r 1', action: 'approve', by: {name: 'm'}}, /crmRequestId/], [{id: 'r', action: 'approved', by: {name: 'm'}}, /action/], [{id: 'r', action: 'approve', by: {name: ' '}}, /by.name/]]) { assert.throws(() => moldApprovalBody(input), field); checks++; }
  eq(readMoldAnswer(201, {request: raw}).kind, 'ok');
  eq(readMoldAnswer(409, {error: {code: 'request_locked', details: {request: raw}}}).request.orderNo, 92, '409 carries the current state');
  eq(readMoldAnswer(404, {error: {code: 'not_found'}}).kind, 'not_found');
  eq(readMoldAnswer(400, {error: {code: 'invalid_payload', fields: ['specs.moldWidth']}}), {kind: 'rejected', code: 'invalid_payload', fields: ['specs.moldWidth']}, 'a refusal names its fields');
  eq([readMoldAnswer(503, {error: {code: 'not_configured'}}).kind, readMoldAnswer(401, {error: {code: 'stale_timestamp'}}).kind, readMoldAnswer(500, null).kind, readMoldAnswer(502, null).code], ['retry', 'retry', 'retry', 'http_502'], 'everything else is tried again');
  // 2026-11-02: the requests route refuses other data for a request production holds, with the reason and the current state
  const productionOnly = readMoldAnswer(409, {error: {code: 'request_locked', message: 'x', details: {reason: 'production_only', request: raw}}});
  eq([productionOnly.kind, productionOnly.code, productionOnly.reason, productionOnly.request.orderNo, MOLD_PRODUCTION_ONLY], ['locked', 'request_locked', 'production_only', 92, 'production_only'], '409 production_only: locked, with its reason and production\'s status');
  eq([readMoldAnswer(409, {error: {code: 'request_locked', details: {request: raw}}}).reason, readMoldAnswer(409, {error: {code: 'request_locked', details: {reason: '<b>', request: raw}}}).reason], [undefined, undefined], 'a 409 without a reason, or with one that is not a word, carries none');
  eq(MOLD_PRODUCTION_ONLY_TEXT, ['بيانات الطلب يعدّلها مدير الإنتاج فقط', 'The request\'s data is edited by the production manager only'], 'the reason in Arabic and English');
}

// ---- 2026-11-02: what proves a send never reached production, and when the CRM may still change a request
{
  const answer = (kind, http, code = '') => ({kind, http, code});
  eq([answer('rejected', 400, 'invalid_payload'), answer('rejected', 413, 'payload_too_large'), answer('rejected', 0, 'payload_too_large'), answer('retry', 401, 'invalid_signature'), answer('retry', 401, 'stale_timestamp'), answer('not_found', 404, 'not_found'), answer('retry', 405, 'method_not_allowed'), answer('retry', 503, 'not_configured')].map(moldAnswerNotStored),
    [true, true, true, true, true, true, true, true], 'refused at production\'s door (any 4xx but 409, its 503 not_configured), or by the CRM before sending: never stored');
  eq([answer('retry', 0, 'network'), answer('retry', 0, 'timeout'), answer('retry', 500, 'server_error'), answer('retry', 502, 'http_502'), answer('retry', 503, 'http_503'), answer('retry', 200, 'bad_response'), answer('retry', 302, 'http_302'), answer('ok', 201), answer('locked', 409, 'request_locked')].map(moldAnswerNotStored),
    [false, false, false, false, false, false, false, false, false], 'no answer, a 5xx, a reply that is not the contract\'s, ok or locked: it may have arrived');
  const at = '2026-11-02T08:00:00.000Z', after = '2026-11-02T08:00:05.000Z', later = '2026-11-02T08:10:00.000Z';
  const fresh = {accepted: null, remote: null, lastAttemptAt: null, lastError: null};
  eq(moldNeverSent(fresh), true, 'never attempted: never sent (the link was off, say)');
  eq(moldNeverSent({...fresh, lastAttemptAt: at, lastError: {code: 'invalid_payload', http: 400, at: after, notStored: true}}), true, 'every attempt refused before production stored it: never sent');
  eq(moldNeverSent({...fresh, lastAttemptAt: at, lastError: {code: 'network', http: 0, at: after}}), false, 'an attempt without an answer: perhaps sent');
  eq(moldNeverSent({...fresh, lastAttemptAt: at, lastError: {code: 'invalid_signature', http: 401, at: after}}), false, 'a refusal without the mark (an earlier attempt may have arrived, or stored before the rule): perhaps sent');
  eq(moldNeverSent({...fresh, lastAttemptAt: later, lastError: {code: 'invalid_payload', http: 400, at: after, notStored: true}}), false, 'an attempt started after the last answer (in flight, or its answer lost): perhaps sent');
  eq(moldNeverSent({...fresh, lastAttemptAt: null, accepted: {specs: {}}}), false, 'accepted by production: sent');
  eq(moldNeverSent({...fresh, remote: {status: 'received'}}), false, 'a status from production: sent');
}

// ---- the edit permission and the reason's text in lib/mold-requests.ts (the source as the build sees it, transpiled)
{
  const root = process.cwd(), modules = new Map();
  const load = filename => {
    if (modules.has(filename)) return modules.get(filename);
    const exports = {}; modules.set(filename, exports);
    const resolve = name => name === '@/portable/mold-rules.mjs' ? rules : name.startsWith('./') ? load(path.join(path.dirname(filename), name) + '.ts') : (() => { throw new Error('not loaded here: ' + name); })();
    vm.runInNewContext(ts.transpileModule(readFileSync(path.join(root, filename), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}, fileName: filename}).outputText, {exports, require: resolve, Date, JSON}, {filename});
    return exports;
  };
  const lib = load('lib/mold-requests.ts'), me = {id: 'rep', role: 'rep'}, at = '2026-11-02T08:00:00.000Z', after = '2026-11-02T08:00:05.000Z';
  const data = {requestedAt: '2026-11-02T11:00:00+03:00', customer: {crmNumber: 27, name: 'مصنع', address: '', city: ''}, salesman: {crmMemberId: 'rep', name: 'مندوب', email: ''}, specs};
  const status = {crmRequestId: 'mr-1', orderNo: 92, status: 'received', editable: true, stages: {}, stagesDone: 0, stagesTotal: 7, delivered: false, revision: 1, waitingStep: 'sales', approvals: {required: true, sales: {at}, production: null, admin: null}};
  const row = change => ({id: 'mr-1', memberId: 'rep', customerId: 'c', legacyOrderNo: null, data, accepted: null, cancelledAt: null, cancelReason: '', outbox: 'send', attempts: 0, firstFailedAt: null, nextAttemptAt: at, lastAttemptAt: null, lastError: null, remote: null, remoteAt: null, createdBy: 'rep', createdAt: at, updatedAt: at, version: 1, ...change});
  const can = (change, who = me) => { const allowed = lib.moldPermissions(row(change), who); return [allowed.edit, allowed.cancel, allowed.attach, allowed.deleteFile]; };
  eq(can({}), [true, true, true, true], 'never attempted: the requester edits it, cancels it, attaches and deletes files');
  eq(can({}, {id: 'sm', role: 'manager'}), [false, false, false, false], 'nobody else edits it, the sales manager included');
  eq(can({attempts: 1, nextAttemptAt: null, lastAttemptAt: at, lastError: {code: 'invalid_payload', fields: ['specs.notes'], http: 400, at: after, notStored: true}}), [true, true, true, true], 'every attempt refused before production stored it: still the requester\'s to edit');
  eq(can({attempts: 1, lastAttemptAt: at, lastError: {code: 'timeout', http: 0, at: after}}), [false, true, true, true], 'an attempt whose answer was lost: no edit; cancelling and files stay');
  eq(can({outbox: null, accepted: data, remote: status, remoteAt: at}), [false, true, true, true], 'sent, approvals pending: no edit; cancelling and design files exactly as before');
  eq(can({outbox: null, accepted: data, remote: {...status, status: 'confirmed', editable: false}}), [false, false, false, false], 'the approvals complete: nothing more from the CRM');
  eq(lib.moldRequestView(row({outbox: null, accepted: data, remote: status}), me, [], true).can.edit, false, 'the view the screen receives says the same');
  const say = language => (ar, en) => language === 'en' ? en : ar;
  eq([lib.moldErrorText('request_locked', say('ar'), {reason: 'production_only'}), lib.moldErrorText('request_locked', say('en'), {reason: 'production_only'}), lib.moldErrorText('production_only', say('ar'))],
    ['بيانات الطلب يعدّلها مدير الإنتاج فقط', 'The request\'s data is edited by the production manager only', 'بيانات الطلب يعدّلها مدير الإنتاج فقط'], 'production_only in Arabic, with its English pair');
  eq([lib.moldErrorText('request_locked', say('ar')), lib.moldErrorText('request_locked', say('ar'), {reason: 'other'})], ['بدأ الإنتاج؛ لم يعد التعديل أو الإلغاء ممكنًا', 'بدأ الإنتاج؛ لم يعد التعديل أو الإلغاء ممكنًا'], 'another 409 keeps its own words');
  eq([lib.moldProductionOnly({code: 'request_locked', reason: 'production_only'}), lib.moldProductionOnly({code: 'request_locked'}), lib.moldProductionOnly(null)], [true, false, false], 'which stored error is production_only');
  eq([lib.moldChangeRefused({code: 'request_locked', reason: 'production_only', final: true}), lib.moldChangeRefused({code: 'request_locked', reason: 'production_only'}), lib.moldChangeRefused({code: 'invalid_payload', fields: ['specs.notes'], final: true}), lib.moldChangeRefused({code: 'invalid_payload', notStored: true}), lib.moldChangeRefused(null)],
    [true, true, true, false, false], 'a change refused for good (final, production_only among them) is said so; a refusal the requester may still fix is not');
  // A change production refused as production_only after an earlier attempt's answer was lost: accepted is the CRM's refused copy, marked
  // unconfirmed. The view says so, whatever error is stored later; production holds the request (no edit; cancel, files and approval stay).
  const unconfirmed = {outbox: null, accepted: {...data, unconfirmed: true}, remote: {...status, approvals: {required: true, sales: null, production: null, admin: null}}, lastError: {code: 'request_locked', http: 409, at}};
  eq([lib.moldRequestView(row(unconfirmed), me, [], true).unconfirmed, lib.moldRequestView(row({outbox: null, accepted: data, remote: status}), me, [], true).unconfirmed], [true, false], 'the view says when the specifications are not production\'s');
  eq([can(unconfirmed), lib.moldPermissions(row(unconfirmed), {id: 'sm', role: 'manager'}).approve], [[false, true, true, true], true], 'production holds it: no edit; cancelling, files and the sales manager\'s approval as for any request it holds');
  // Values made in the sandbox (its own Array and Object) are compared as plain data.
  const same = (actual, expected, message) => eq(JSON.parse(JSON.stringify(actual ?? null)), expected, message);
  // 2026-11-03: «اعتماد المالية» instead of the system administrator's (the key stays admin), the payment's names and the field's refusal
  same([lib.moldWaitingNames.admin, lib.moldApprovalNames.admin], [['بانتظار اعتماد المالية', 'Waiting for finance approval'], ['المالية', 'Finance']], 'the third approval\'s names: «بانتظار اعتماد المالية», and «اعتماد المالية» as the sheet composes it');
  same(JSON.stringify(lib).includes('مدير النظام'), false, 'the system administrator\'s approval is named nowhere any more');
  same([lib.moldPaymentNames.cash, lib.moldPaymentNames.deferred, lib.moldFieldNames.payment], [['نقدي', 'Cash'], ['آجل', 'Deferred'], ['طريقة الدفع غير صحيحة', 'The payment method is not valid']], 'the payment in Arabic and English, and production\'s refusal of it');
  const paid = {...data, payment: 'deferred'};
  same([lib.moldRequestView(row({data: paid}), me, [], true).payment, lib.moldRequestView(row({}), me, [], true).payment, lib.moldRequestView(row({data: {...data, payment: 'card'}}), me, [], true).payment], ['deferred', null, null], 'the view carries the payment the CRM stored; none for a request asked for before');
  // restored after a cancellation: active again (cancel and files under the usual rules), with why, and the earlier reasons for the screen
  const active = {outbox: null, accepted: data, remote: status, remoteAt: at, cancelledAt: null, cancelReason: '', lastError: {code: 'restored', reason: 'restored', http: 0, at}};
  same([can(active), lib.moldRequestView(row(active), me, [], true, [], ['العميل أجّل']).cancelReasons, lib.moldRequestView(row(active), me, [], true).cancelReasons], [[false, true, true, true], ['العميل أجّل'], []], 'restored: cancelling and files back, no edit; the earlier reasons travel with the view');
  same([lib.moldChangeRefused(active.lastError), lib.moldRequestView(row(active), me, [], true).sending.state], [false, 'sent'], 'a restore is no refused change and nothing waits');
  // A design file waiting while the request was cancelled: «not sent: the request is cancelled»; restored, it waits to be sent again.
  const waitingFile = {id: 'mdf-1', requestId: 'mr-1', memberId: 'rep', name: 'رسم.pdf', kind: 'pdf', contentType: 'application/pdf', size: 10, sha256: 'x', objectKey: 'k', createdAt: at, deletedAt: null, outbox: 'send', attempts: 0, firstFailedAt: null, nextAttemptAt: at, lastAttemptAt: null, lastError: null, remoteFileId: null, sentAt: null, version: 1};
  same([lib.moldDesignFilesView(row({...active, cancelledAt: at, cancelReason: 'x'}), [waitingFile], me, true)[0].state, lib.moldDesignFilesView(row(active), [waitingFile], me, true)[0].state], ['cancelled', 'waiting'], 'a file of a restored request is no longer held as cancelled');
  // Cancelled in production (not by the CRM): the file is held too, not «waiting» for a send that cannot go until the production manager restores it.
  const cancelledThere = lib.moldDesignFilesView(row({...active, lastError: null, remote: {...status, status: 'cancelled', editable: false, waitingStep: 'cancelled'}}), [{...waitingFile, lastAttemptAt: at}], me, true)[0];
  same([cancelledThere.state, cancelledThere.stopped], ['cancelled', false], 'a file of a request cancelled in production is held, said as cancelled');
  same(['restored', 'cancel_dropped', 'same_reason'].map(reason => lib.moldRestoredText({code: 'restored', reason}, say('ar'))),
    ['رجّعه مدير الإنتاج بعد الإلغاء؛ عشان تلغيه تاني اكتب سبب جديد.', 'رجّعه مدير الإنتاج بعد الإلغاء، فالإلغاء المنتظر لن يُعاد إرساله؛ عشان تلغيه تاني اكتب سبب جديد.', 'مدير الإنتاج رجّع الطلب؛ عشان تلغيه تاني اكتب سبب جديد.'], 'why it is active again, in Arabic');
  same([lib.moldRestoredText({code: 'restored', reason: 'same_reason'}, say('en')), lib.moldRestoredText({code: 'timeout'}, say('ar')), lib.moldRestoredText(null, say('ar'))], ['The production manager restored the request; to cancel it again, write a new reason.', '', ''], 'in English; nothing for any other error');
  // Once it may no longer be cancelled (approved or in production since), or for a reader who may not cancel it: no new reason asked for.
  same(['restored', 'cancel_dropped', 'same_reason'].map(reason => lib.moldRestoredText({code: 'restored', reason}, say('ar'), {cancellable: false})),
    ['رجّعه مدير الإنتاج بعد الإلغاء.', 'رجّعه مدير الإنتاج بعد الإلغاء، فالإلغاء المنتظر لن يُعاد إرساله.', 'رجّعه مدير الإنتاج بعد الإلغاء.'], 'not cancellable: only that it was restored, in Arabic');
  same(lib.moldRestoredText({code: 'restored', reason: 'same_reason'}, say('en'), {cancellable: false}), 'The production manager restored it after the cancellation.', 'and in English');
  same(lib.MOLD_SAME_REASON_TEXT, ['مدير الإنتاج رجّع الطلب؛ عشان تلغيه تاني اكتب سبب جديد', 'The production manager restored the request; to cancel it again, write a new reason'], 'the same-reason refusal, Arabic and English');
  const dictionary = JSON.parse(readFileSync(path.join(root, 'lib/locales/en.json'), 'utf8'));
  same([dictionary[lib.MOLD_SAME_REASON_TEXT[0]], dictionary[MOLD_PAYMENT_REQUIRED]], [lib.MOLD_SAME_REASON_TEXT[1], 'Choose how the customer pays: cash or deferred'], 'the server\'s two new refusals have their English pair');
  const restoredLocked = 'رجّعه مدير الإنتاج بعد الإلغاء، واكتملت الاعتمادات أو بدأ الإنتاج؛ لم يعد الإلغاء ممكنًا.';
  same([readFileSync(path.join(root, 'app/api/mold-requests/route.ts'), 'utf8').includes(restoredLocked), dictionary[restoredLocked]], [true, 'The production manager restored it after the cancellation, and the approvals are complete or production has started; it can no longer be cancelled.'], 'the same cancellation once it may no longer be cancelled: its own refusal, with its English pair');
  // ---- 2026-11-03 (production's second update) as it stands since 2026-11-05: production's flag a reader sees (no number any more), a
  // request held while the update is unknown, places by category
  const numbered = {...data, payment: 'cash', quoteNo: 'Q-1'}, answered = {...status, quoteNo: 'Q-2', poNo: 'PO-5', quoteOrPoMissing: false, quoteFiles: [], poFiles: []};
  same([lib.moldRequestView(row({data: numbered}), me, [], true, [], [], true).quotePo, lib.moldRequestView(row({data: numbered, outbox: null, accepted: numbered, remote: status}), me, [], true, [], [], true).quotePo], [null, null], 'no number is shown: not the CRM\'s own before production holds the request, nothing from an older status');
  same(lib.moldRequestView(row({data: numbered, outbox: null, accepted: numbered, remote: answered}), me, [], true, [], [], true).quotePo, {missing: false}, 'production\'s flag alone, not its numbers (production no longer shows them)');
  same(lib.moldRequestView(row({outbox: null, accepted: data, remote: {...answered, quoteOrPoMissing: true}}), me, [], true).quotePo, {missing: true}, 'production lacks the file (its number alone is not enough): the view says so');
  same([lib.moldRequestView(row({data: numbered}), me, [], true, [], [], false).sending.state, lib.moldRequestView(row({data: numbered}), me, [], true, [], [], true).sending.state, lib.moldRequestView(row({}), me, [], true, [], [], false).sending.state, lib.moldRequestView(row({data: numbered}), me, [], false, [], [], false).sending.state],
    ['held', 'waiting', 'waiting', 'off'], 'a request saved with a number is held while the update is unknown (one without, as before; the link off says so first)');
  same(lib.moldSendingNames.held, ['بانتظار تحديث تطبيق المنتجات', 'Waiting for the products application update'], 'held, in Arabic and English');
  const quoteFile = {...waitingFile, id: 'mdf-q', name: 'عرض سعر.pdf', category: 'quote'}, accepted = {outbox: null, accepted: data, remote: answered};
  same([lib.moldDesignFilesView(row(accepted), [quoteFile], me, true, false)[0].state, lib.moldDesignFilesView(row(accepted), [quoteFile], me, true, true)[0].state, lib.moldDesignFilesView(row(accepted), [quoteFile], me, true, true)[0].category, lib.moldDesignFilesView(row(accepted), [waitingFile], me, true, false)[0].state],
    ['update', 'waiting', 'quote', 'waiting'], 'a quotation\'s file waits for the update to be known (a design file as before), and says which kind it is');
  same(lib.moldDesignStateNames.update, ['بانتظار تحديث تطبيق المنتجات', 'Waiting for the products application update'], 'its state in words');
  const production = file => ({fileId: file, crmFileId: null, name: 'p' + file + '.pdf', kind: 'pdf', size: 1, source: 'production', uploadedAt: at});
  const holding = row({outbox: null, accepted: data, remote: {...answered, designFiles: [production(1)], quoteFiles: [production(2), production(3)], poFiles: [production(4)]}});
  same(lib.moldListedFiles(holding.remote).map(file => [file.fileId, file.category]), [[1, 'design'], [2, 'quote'], [3, 'quote'], [4, 'po']], 'every file production lists, each with the list it came in');
  same(['design', 'quote', 'po'].map(category => lib.moldDesignCount(holding, [waitingFile, quoteFile], category)), [{crm: 1, production: 1, max: 10}, {crm: 1, production: 2, max: 5}, {crm: 0, production: 1, max: 5}], 'each kind\'s places counted apart: 10 design files, 5 of the quotation, 5 of the PO, production\'s included');
  same(lib.moldDesignFilesView(holding, [], me, true).map(file => [file.fileId, file.category, file.state]), [['1', 'design', 'production'], ['2', 'quote', 'production'], ['3', 'quote', 'production'], ['4', 'po', 'production']], 'production\'s quotation and PO files on the request, with their kind');
  same(lib.moldPendingFiles({orderNo: 9, designFiles: [production(1)], quoteFiles: [production(2)], poFiles: undefined}), {designFiles: [{...production(1), category: 'design', href: '/api/mold-requests/design-file?order=9&file=1', viewable: true}], quoteFiles: [{...production(2), category: 'quote', href: '/api/mold-requests/design-file?order=9&file=2', viewable: true}], poFiles: []}, 'a pending item\'s files of every list, each downloaded by its fileId');
  same([lib.moldDesignRefusalText('too_many_files', say('ar')), lib.moldDesignRefusalText('too_many_files', say('ar'), 'quote'), lib.moldDesignRefusalText('too_many_files', say('en'), 'po'), lib.moldDesignRefusalText('not_document', say('ar'), 'quote'), lib.moldDesignRefusalText('not_document', say('en'), 'po')],
    ['الحد 10 ملفات للطلب (ملفاتك وملفات الإنتاج)', 'الحد 5 ملفات لعرض السعر (ملفاتك وملفات الإنتاج)', 'At most 5 PO files a request (yours and production\'s)', 'ملف عرض السعر أو الـ PO لازم يكون PDF أو صورة', 'A quotation or PO file must be a PDF or an image'], 'the new refusals in words, each kind its own limit');
  same([lib.moldErrorText('request_locked', say('ar'), {reason: 'production_only'}), lib.moldErrorText('request_locked', say('en'), {reason: 'production_only'}), lib.moldErrorText('timeout', say('ar'))],
    ['بيانات الطلب يعدّلها مدير الإنتاج فقط', 'The request\'s data is edited by the production manager only', 'لم يرد تطبيق الإنتاج خلال 10 ثوانٍ'], 'production_only no longer adds who adds a number (2026-11-05: the file is attached from the CRM)');
  same([lib.MOLD_QUOTE_PO_MISSING_TEXT, lib.MOLD_QUOTE_FILE_REQUIRED_TEXT, lib.MOLD_QUOTE_FILE_HELD_NAME, lib.moldFieldNames.quoteNo, lib.moldFieldNames.poNo],
    [['ناقص ملف عرض السعر / الـ PO', 'The quotation / PO file is missing'], ['أرفق ملف عرض السعر أو الـ PO (واحد على الأقل)', 'Attach the quotation or PO file (at least one)'], ['بانتظار ملف عرض السعر / الـ PO', 'Waiting for the quotation / PO file'], ['رقم عرض السعر غير مقبول', 'The quotation number is not accepted'], ['رقم الـ PO غير مقبول', 'The PO number is not accepted']],
    'the missing note, the form\'s refusal and the held state (2026-11-05), production\'s refusal of a number (an older request\'s), Arabic and English');
  same([lib.MOLD_QUOTE_FILE_REQUIRED_TEXT[0], Object.hasOwn(lib, 'moldQuotePoNames'), Object.hasOwn(lib, 'MOLD_QUOTE_PO_REQUIRED_TEXT')], [rules.MOLD_QUOTE_FILE_REQUIRED, false, false], 'the form asks for the file in the rules\' words; no number field\'s names or refusal remain');
  const quoteGone = 'رقم عرض السعر ورقم الـ PO اتشالوا من الطلب؛ حدّث الصفحة وأرفق ملف عرض السعر أو الـ PO بدالهم.', quoteFirst = 'الطلب بانتظار ملف عرض السعر / الـ PO؛ أرفق الملف ويتبعت الطلب لوحده.';
  const serverTexts = [quoteGone, quoteFirst, 'تطبيق المنتجات لسه ما اتحدّثش لاستقبال ملفات عرض السعر والـ PO؛ حدّث الصفحة.', 'الحد 5 ملفات لعرض السعر (ملفاتك وملفات الإنتاج). احذف ملفًا أولًا.', 'الحد 5 ملفات للـ PO (ملفاتك وملفات الإنتاج). احذف ملفًا أولًا.'];
  same(serverTexts.filter(text => typeof dictionary[text] !== 'string'), [], 'every refusal of the server has its English pair');
  const sources = ['app/api/mold-requests/route.ts', 'app/api/mold-requests/design-files/route.ts'].map(file => readFileSync(path.join(root, file), 'utf8')).join('\n');
  same(serverTexts.slice(0, 3).filter(text => !sources.includes(text)), [], 'and the server says them (a number from a page loaded before, a resend of a request kept for its file, a quotation\'s or PO\'s file before the update)');
  // ---- 2026-11-05: a new request is kept in the CRM until its first quotation or PO file (moldHeldFor quote_file), whatever the link
  const fileAsked = {...data, payment: 'cash', fileRequired: true}, quoteOf = (category, change = {}) => ({...waitingFile, id: 'mdf-' + category, name: category + '.pdf', category, ...change});
  const awaitsQuote = (target, files) => lib.moldHeldFor(target, files) === 'quote_file';
  const awaits = (change, files) => awaitsQuote(row({data: fileAsked, ...change}), files);
  same([awaits({}, []), awaits({}, [waitingFile]), awaits({}, [quoteOf('quote')]), awaits({}, [quoteOf('po')]), awaits({}, [quoteOf('quote', {deletedAt: at, outbox: null})]), awaits({}, [quoteOf('po', {nextAttemptAt: null, lastAttemptAt: at, lastError: {code: 'file_missing', http: 0, at, final: true}})])],
    [true, true, false, false, true, true], 'asked for under the rule: kept while it has no quotation or PO file (a design file is not one; a deleted one, or one refused for good, counts for nothing)');
  same([awaitsQuote(row({data: {...data, payment: 'cash'}}), []), awaitsQuote(row({data: numbered}), []), awaits({outbox: null, accepted: fileAsked, remote: status}, []), awaits({attempts: 1, lastAttemptAt: at, lastError: {code: 'timeout', http: 0, at: after}}, []), awaits({cancelledAt: at, outbox: 'cancel'}, [])],
    [false, false, false, false, false], 'never a request asked for before the rule (with a number or none: it goes as it always did), one production holds, one whose send may have arrived, or a cancellation');
  const heldView = (files, linkReady = true) => lib.moldRequestView(row({data: fileAsked}), me, [], linkReady, files, [], true);
  const heldOf = view => [view.sending.state, view.sending.held ?? null];
  same([heldOf(heldView([])), heldOf(heldView([], false)), heldOf(heldView([quoteOf('quote')])), heldOf(heldView([waitingFile])), heldView([]).can.resend, heldView([quoteOf('po')]).can.resend, heldView([]).can.attach],
    [['waiting', 'quote_file'], ['off', 'quote_file'], ['waiting', null], ['waiting', 'quote_file'], false, true, true], 'sending.held says so, even with the link off (its state stays one every page knows); nothing to resend while it waits; the requester attaches the file');
  same([lib.MOLD_QUOTE_FILE_WAITING_OTHERS, lib.MOLD_QUOTE_PO_MISSING_OTHERS, lib.MOLD_QUOTE_PO_MISSING_PRODUCTION],
    [['بانتظار ما صاحب الطلب يرفق ملف عرض السعر / الـ PO', 'Waiting for whoever asked for it to attach the quotation / PO file'], ['صاحب الطلب يرفقه من الـCRM، أو مدير الإنتاج من تطبيق المنتجات.', 'Whoever asked for it attaches it in the CRM, or the production manager in the products application.'], ['مدير الإنتاج يرفقه من تطبيق المنتجات.', 'The production manager attaches it in the products application.']],
    'what a reader who cannot attach is told, for a CRM request and for one registered in production, Arabic and English');
  // ---- 2026-11-08: every new request (data.designRequired, any role) is kept until its first design file of its own; the customer's
  // signature, a deleted file and one refused for good count for nothing; the quotation's or PO's file is said first when both are missing
  const designAsked = {...data, payment: 'cash', designRequired: true}, bothAsked = {...fileAsked, designRequired: true};
  const signedAsked = {...designAsked, signature: {signer: 'خالد', signedAt: at, fileId: 'mds-1'}}, signatureOf = {...waitingFile, id: 'mds-1', name: 'توقيع العميل - خالد.png', kind: 'image'};
  const heldFor = (asked, files, change = {}) => lib.moldHeldFor(row({data: asked, ...change}), files) ?? null;
  same([heldFor(designAsked, []), heldFor(designAsked, [waitingFile]), heldFor(designAsked, [quoteOf('quote')]), heldFor(signedAsked, [signatureOf]), heldFor(signedAsked, [signatureOf, waitingFile]),
    heldFor(designAsked, [{...waitingFile, deletedAt: at, outbox: null}]), heldFor(designAsked, [{...waitingFile, nextAttemptAt: null, lastAttemptAt: at, lastError: {code: 'invalid_payload', http: 400, at, final: true}}]), heldFor(designAsked, [{...waitingFile, outbox: 'delete', deletedAt: at}])],
    ['design_file', null, 'design_file', 'design_file', null, 'design_file', 'design_file', 'design_file'], 'kept while it has no design file of its own: a quotation\'s file is not one, the customer\'s signature is not one, a deleted one (or one being deleted) or one refused for good counts for nothing');
  same([heldFor(designAsked, [{...waitingFile, outbox: null, sentAt: at}]), heldFor(designAsked, [{...waitingFile, nextAttemptAt: null, lastAttemptAt: at, lastError: {code: 'network', http: 0, at}}]), heldFor(designAsked, [{...waitingFile, category: undefined}])],
    [null, null, null], 'a design file sent, or stopped after 24 hours (not refused), counts; one stored without a category is a design file');
  same([heldFor(bothAsked, []), heldFor(bothAsked, [waitingFile]), heldFor(bothAsked, [quoteOf('po')]), heldFor(bothAsked, [quoteOf('po'), waitingFile]), heldFor({...bothAsked, signature: signedAsked.signature}, [signatureOf, quoteOf('quote')])],
    ['quote_file', 'quote_file', 'design_file', null, 'design_file'], 'both asked for: the quotation\'s or PO\'s file is said first; once it is there, the design file; both there: sent');
  same([heldFor(designAsked, [], {outbox: null, accepted: designAsked, remote: status}), heldFor(designAsked, [], {attempts: 1, lastAttemptAt: at, lastError: {code: 'timeout', http: 0, at: after}}), heldFor(designAsked, [], {cancelledAt: at, outbox: 'cancel'}),
    heldFor(designAsked, [], {attempts: 1, lastAttemptAt: at, lastError: {code: 'invalid_payload', http: 400, at: after, notStored: true}}), heldFor({...data, payment: 'cash'}, []), heldFor(numbered, []), heldFor({...data, payment: 'cash', signature: signedAsked.signature}, [signatureOf])],
    [null, null, null, 'design_file', null, null, null], 'never one production holds, one whose send may have arrived, or a cancellation (a send refused before production stored it still waits); never a request asked for before (no marker, signed or not): it goes as it always did');
  const designView = (files, linkReady = true, asked = designAsked, who = me) => lib.moldRequestView(row({data: asked}), who, [], linkReady, files, [], true);
  same([heldOf(designView([])), heldOf(designView([], false)), heldOf(designView([waitingFile])), heldOf(designView([quoteOf('quote')], true, bothAsked)), designView([]).can.resend, designView([waitingFile]).can.resend, designView([]).can.attach, designView([], true, designAsked, {id: 'sm', role: 'manager'}).can.attach],
    [['waiting', 'design_file'], ['off', 'design_file'], ['waiting', null], ['waiting', 'design_file'], false, true, true, false], 'sending.held design_file, its state one every page knows (waiting, or off); no resend while it waits; the requester attaches it (nobody else)');
  same([designView([]).designRequired, lib.moldRequestView(row({}), me, [], true).designRequired, lib.moldRequestView(row({data: fileAsked}), me, [], true).designRequired], [true, false, false], 'the view says which requests were asked for under the rule (their edit asks for a design file too)');
  same([lib.MOLD_DESIGN_FILE_HELD_NAME, lib.MOLD_DESIGN_FILE_PICKER_TITLE, lib.MOLD_DESIGN_FILE_REQUIRED_TEXT, lib.MOLD_DESIGN_FILE_WAITING_OTHERS],
    [['بانتظار ملف التصميم', 'Waiting for the design file'], ['ملفات التصميم (ملف واحد على الأقل)', 'Design files (at least one)'], ['أرفق ملف تصميم واحد على الأقل', 'Attach at least one design file'], ['بانتظار ما صاحب الطلب يرفق ملف التصميم', 'Waiting for whoever asked for it to attach the design file']],
    'the held state, the picker\'s title, the form\'s refusal and what a reader who cannot attach is told (2026-11-08), Arabic and English');
  same([lib.MOLD_DESIGN_FILE_WAITING_TEXT[0].startsWith('الطلب محفوظ في الـCRM ومش هيتبعت للإنتاج إلا لما ترفق ملف تصميم واحد على الأقل (توقيع العميل مش بيتحسب)؛'), lib.MOLD_DESIGN_FILE_WAITING_TEXT[1].includes('the customer\'s signature does not count'),
    Object.keys(lib.moldHeldTexts).sort(), lib.moldHeldTexts.quote_file.name, lib.moldHeldTexts.design_file.waiting === lib.MOLD_DESIGN_FILE_WAITING_TEXT], [true, true, ['design_file', 'quote_file'], [...lib.MOLD_QUOTE_FILE_HELD_NAME], true], 'the requester\'s explanation, and each held value with its words');
  const designFirst = 'الطلب بانتظار ملف التصميم؛ أرفق ملف تصميم ويتبعت الطلب لوحده.';
  same([dictionary[designFirst], readFileSync(path.join(root, 'app/api/mold-requests/route.ts'), 'utf8').includes(designFirst)], ['The request is waiting for the design file; attach a design file and the request is sent by itself.', true], 'a resend of a request kept for its design file: refused by the server, with its English pair');
  // The marker never travels: the body of a request with designRequired (and fileRequired) is byte for byte the body without them.
  const marked = {...bothAsked, signature: signedAsked.signature}, unmarked = {...marked};delete unmarked.designRequired;delete unmarked.fileRequired;delete unmarked.signature;
  same([JSON.stringify(moldRequestBody({id: 'mr-1', ...marked})), JSON.stringify(moldRequestBody({id: 'mr-1', ...marked})).includes('Required')], [JSON.stringify(moldRequestBody({id: 'mr-1', ...unmarked})), false], 'the requests body with data.designRequired is the body without it');
  // A page loaded before this release (the live 2026-11-04 client) indexes its own names by the server's values: every value a view of
  // this release carries must be one it knows, or its page throws (say(...undefined)). Its maps, as that release has them.
  const OLD = {sending: ['sent', 'waiting', 'rejected', 'off', 'held'], file: ['sent', 'waiting', 'held', 'rejected', 'locked', 'cancelled', 'deleting', 'off', 'production', 'update'], category: ['design', 'quote', 'po'], signature: ['sent', 'waiting', 'stopped', 'refused'], payment: ['cash', 'deferred']};
  const views = [heldView([]), heldView([], false), heldView([quoteOf('quote')]), heldView([waitingFile, quoteOf('po', {outbox: null, sentAt: at})]),
    lib.moldRequestView(row({data: {...fileAsked, signature: {signer: 'خالد', signedAt: at, fileId: 'mdf-1'}}}), me, [], true, [waitingFile], [], true),
    lib.moldRequestView(row({data: numbered, outbox: null, accepted: numbered, remote: {...answered, quoteOrPoMissing: true}}), me, [], true, [quoteOf('quote', {outbox: null, sentAt: at})], [], true),
    lib.moldRequestView(row({data: fileAsked, outbox: null, accepted: fileAsked, remote: answered}), me, [], false, [quoteOf('quote', {outbox: 'delete', deletedAt: at})], [], true)];
  same(views.flatMap(view => [
    OLD.sending.includes(view.sending.state) ? [] : ['sending ' + view.sending.state],
    view.designFiles.filter(file => !OLD.file.includes(file.state) || !OLD.category.includes(file.category)).map(file => 'file ' + file.state + '/' + file.category),
    view.signature && !OLD.signature.includes(view.signature.state) ? ['signature ' + view.signature.state] : [],
    view.payment !== null && !OLD.payment.includes(view.payment) ? ['payment ' + view.payment] : []].flat()), [], 'every state, category and payment a view carries is one a page of the release before knows');
  const oldSendingNames = new Function('return ' + /export const moldSendingNames:Record<MoldSendingState,\[string,string\]>=(\{[^\n]*\});/.exec(readFileSync(path.join(root, 'lib/mold-requests.ts'), 'utf8'))[1])();
  same([Object.keys(oldSendingNames).sort(), views.map(view => typeof oldSendingNames[view.sending.state]?.[0])], [[...OLD.sending].sort(), views.map(() => 'string')], 'the names this release sends with match the old set, so an old page names every state it receives');
  // Approvals (2026-11-05): a quotation's or PO's file on its way no longer holds the sales manager's approval; a design file still does.
  const atSales = {outbox: null, accepted: data, remote: {...status, approvals: {required: true, sales: null, production: null, admin: null}}}, sm = {id: 'sm', role: 'manager'};
  same([lib.moldPermissions(row(atSales), sm, [quoteOf('quote')]).approve, lib.moldPermissions(row(atSales), sm, [quoteOf('po')]).approve, lib.moldPermissions(row(atSales), sm, [waitingFile]).approve, lib.moldPermissions(row(atSales), sm, []).approve], [true, true, false, true], 'the approval waits for a design file on its way (its arrival undoes it), not for a quotation\'s or PO\'s');
  same([lib.moldFileResetsApprovals({category: 'design'}), lib.moldFileResetsApprovals({}), lib.moldFileResetsApprovals({category: 'quote'}), lib.moldFileResetsApprovals({category: 'po'})], [true, true, false, false], 'which files undo the approvals: design files (the signature among them) only');
  // «رابط التصميم» removed (2026-11-03): the server's refusal of a link from a page loaded before, with its English pair.
  const designUrlGone = 'رابط التصميم اتلغى من الطلب؛ حدّث الصفحة، وأرفق التصميم كملف.';
  same([readFileSync(path.join(root, 'app/api/mold-requests/route.ts'), 'utf8').includes(designUrlGone), dictionary[designUrlGone]], [true, 'The design link was removed from the request; refresh the page and attach the design as a file.'], 'the design link\'s refusal, said by the server, with its English pair');
  // ---- 2026-11-09 (the owner: «عنوان لكل طلب قالب»): the request's delivery address, asked for with the request, filled in from the
  // customer's registered address and changed for this request only; customer.address in the requests body, production unchanged
  {
    const A = rules.moldAddress;
    same([A('  حي   الصناعية،\n شارع\t5  '), A('مخزن جدة'), A(''), A('  \n\t '), A(null), A(undefined), A(42)],
      [{address: 'حي الصناعية، شارع 5', error: null}, {address: 'مخزن جدة', error: null}, {address: '', error: 'required'}, {address: '', error: 'required'}, {address: '', error: 'required'}, {address: '', error: 'required'}, {address: '', error: 'required'}],
      'trimmed, single spaces (a new line from the text area a space), required');
    same([A('ع'.repeat(300)).error, A('ع'.repeat(301)).error, A('😀'.repeat(300)).error, A('😀'.repeat(301)).error, A(' ' + 'x'.repeat(300) + ' ').error, MOLD_LIMITS.address],
      [null, 'long', null, 'long', null, 300], 'up to 300 characters, counted as production counts them (code points: 300 emoji are 600 UTF-16 units and pass), after trimming');
    same([rules.MOLD_ADDRESS_REQUIRED, rules.MOLD_ADDRESS_LONG, lib.MOLD_ADDRESS_TEXT, dictionary[rules.MOLD_ADDRESS_REQUIRED], dictionary[rules.MOLD_ADDRESS_LONG], dictionary['عنوان التسليم'], lib.moldFieldNames['customer.address']],
      ['اكتب عنوان التسليم', 'العنوان حتى 300 حرف', {required: ['اكتب عنوان التسليم', 'Enter the delivery address'], long: ['العنوان حتى 300 حرف', 'The address is up to 300 characters']}, 'Enter the delivery address', 'The address is up to 300 characters', 'Delivery address', ['عنوان التسليم', 'Delivery address']],
      'the refusals (the server\'s and the form\'s, Arabic and English) and production\'s field named as the delivery address');
    const delivered = {...data, customer: {...data.customer, address: 'مخزن جدة، المنطقة الصناعية الثانية'}};
    same([lib.moldRequestView(row({data: delivered}), me, [], true).customerAddress, lib.moldRequestView(row({}), me, [], true).customerAddress, lib.moldRequestView(row({data: {...data, customer: {crmNumber: 27, name: 'مصنع'}}}), me, [], true).customerAddress],
      ['مخزن جدة، المنطقة الصناعية الثانية', '', ''], 'the view carries the request\'s own address (\'\' for a request stored without one)');
    // The requests body takes the request's own address (data.customer.address), never the customer's record; a request stored before
    // (the registered address in its data) is sent byte for byte as it always was.
    same(moldRequestBody({id: 'mr-1', ...delivered}).customer, {crmNumber: 27, name: 'مصنع', address: 'مخزن جدة، المنطقة الصناعية الثانية'}, 'the body sends the request\'s delivery address as customer.address');
    const before = {...data, customer: {crmNumber: 27, name: 'مصنع', address: 'حي الصناعية', city: 'Damam - الدمام'}, payment: 'cash'};
    same(JSON.stringify(moldRequestBody({id: 'mr-1', ...before})), '{"crmRequestId":"mr-1","requestedAt":"2026-11-02T11:00:00+03:00","customer":{"crmNumber":27,"name":"مصنع","address":"حي الصناعية","city":"Damam - الدمام"},"salesman":{"crmMemberId":"rep","name":"مندوب"},"specs":' + JSON.stringify(moldRequestBody({id: 'mr-1', ...data}).specs) + ',"payment":"cash"}', 'a request stored before this release: the same bytes as ever');
  }
  // ---- the customer's signature (the owner, 2026-11-04): who needs it, the checks, the body unchanged, the view, the pending item, the words
  {
    same(['rep', 'supervisor', 'manager', 'customer_service', 'customer_service_manager', 'admin', '', undefined].map(rules.moldSignatureRequired), [true, true, true, false, false, false, false, false], 'required of the sales roles only: customer service and the administrator ask without it');
    same(lib.moldSignatureRequired === rules.moldSignatureRequired, true, 'the screen and the server share one rule');
    const good = new Uint8Array(signaturePng()), check = rules.moldSignatureCheck;
    same(check('  م.   خالد ', good), {ok: true, signer: 'م. خالد', name: 'توقيع العميل - م. خالد.png', width: 480, height: 200, contentType: 'image/png'}, 'a real PNG with who signed: kept as «توقيع العميل - <signer>.png», an image');
    same([check('أ', good).field, check('x'.repeat(81), good).field, check('a\u0007b', good).field, check(12, good).field, check('\u200f\u200f', good).field, check('ab', good).ok, check('x'.repeat(80), good).ok], ['signer', 'signer', 'signer', 'signer', 'signer', true, true], 'who signed: 2 to 80 characters, nothing production refuses, invisible marks dropped');
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 200, 1, 224, 3, 1, 34, 0, 2, 17, 1, 3, 17, 1, 0xff, 0xd9]);
    const reasons = [null, new Uint8Array(0), good.subarray(0, good.length - 12), jpeg, new Uint8Array(signaturePng({width: 1201, height: 100})), new Uint8Array(signaturePng({width: 60, height: 40})), new Uint8Array(rules.MOLD_SIGNATURE_MAX_BYTES + 1)].map(bytes => check('خالد', bytes).reason);
    same(reasons, ['missing', 'missing', 'not_png', 'not_png', 'size', 'size', 'too_large'], 'the PNG: none, cut short (no IEND), another format, wider than 1200, a dot (long side under 64), over 256 KiB: each refused');
    same([check('خالد', new Uint8Array(signaturePng({width: 1200, height: 1200}))).ok, check('خالد', new Uint8Array(signaturePng({width: 64, height: 20}))).ok, rules.moldDesignFileCheck(check('خالد', good).name, good).ok], [true, true, true], '1200 a side and a long side of 64 pass; the file is one production takes as a design image');
    same([rules.moldSignatureName('أحمد: علي/محمد'), rules.moldSignatureName('??**'), rules.moldSignatureName('\u202eabc'), [...rules.moldSignatureName('ط'.repeat(80))].length <= 200], ['توقيع العميل - أحمد علي محمد.png', 'توقيع العميل.png', 'توقيع العميل - abc.png', true], 'the file\'s name: the characters a name may not hold become spaces; none left: «توقيع العميل.png»');
    for (const signer of ['أحمد: علي/محمد', '??**', 'CON', 'a"b|c']) same(rules.moldDesignName(rules.moldSignatureName(signer))?.kind, 'image', 'always a name production accepts: ' + signer);
    same([rules.moldSignatureDrawn({points: 1, width: 0, height: 0}), rules.moldSignatureDrawn({points: 40, width: 20, height: 12}), rules.moldSignatureDrawn({points: 8, width: 200, height: 40}), rules.moldSignatureDrawn({points: 12, width: 40, height: 3}), rules.moldSignatureDrawn({points: 0, width: 300, height: 100})], [false, false, false, true, false], 'the pad: a tap or a dot, a short tick, too few points refused; 12 points over 40 pixels taken');
    same([rules.moldSignatureBytes(Buffer.from(good).toString('base64'))?.length, rules.moldSignatureBytes('data:image/png;base64,AAAA'), rules.moldSignatureBytes('AAA'), rules.moldSignatureBytes('A'.repeat(rules.MOLD_SIGNATURE_BASE64_MAX + 4)), rules.moldSignatureBytes(42), rules.MOLD_SIGNATURE_BASE64_MAX], [good.length, null, null, null, null, 349528], 'base64 only, without a data: prefix, within its cap');
    // The requests body never carries it: built from explicit fields, the same bytes with data.signature or without it
    const signed = {...data, payment: 'cash', quoteNo: 'Q-7', signature: {signer: 'م. خالد', signedAt: at, fileId: 'mds-1'}}, plain = {...signed};delete plain.signature;
    same([JSON.stringify(moldRequestBody({id: 'mr-1', ...signed})), JSON.stringify(moldRequestBody({id: 'mr-1', ...signed})).includes('mds-1')], [JSON.stringify(moldRequestBody({id: 'mr-1', ...plain})), false], 'the body of a request with data.signature is byte for byte the body without it');
    const serverSource = readFileSync(path.join(root, 'lib/mold-requests-server.ts'), 'utf8'), bodyLine = serverSource.split('\n').find(line => line.startsWith('export const requestBody='));
    same([/^export const requestBody=\(row:[^)]*\)=>moldRequestBody\(\{id:row\.id,legacyOrderNo:row\.legacyOrderNo,requestedAt:row\.data\.requestedAt,customer:row\.data\.customer,salesman:row\.data\.salesman,specs:row\.data\.specs,payment:row\.data\.payment,quoteNo:row\.data\.quoteNo,poNo:row\.data\.poNo\}\);$/.test(bodyLine), bodyLine.includes('...')], [true, false], 'the server builds the body from those fields alone (no spread of the data)');
    // The view: the file the data names is the signature, labelled and never deletable; the line on the sheet with its image's link
    const signatureFile = {...waitingFile, id: 'mds-1', name: 'توقيع العميل - م. خالد.png', kind: 'image', contentType: 'image/png', outbox: null, sentAt: at, remoteFileId: 7};
    const signedView = lib.moldRequestView(row({data: signed}), me, [], true, [signatureFile, waitingFile]);
    same([signedView.signature, signedView.designFiles.map(file => [file.crmFileId, file.signature || false, file.canDelete])], [{signer: 'م. خالد', signedAt: at, fileId: 'mds-1', href: '/api/mold-requests/design-file?id=mr-1&file=mds-1', state: 'sent'}, [['mds-1', true, false], ['mdf-1', false, true]]], 'the sheet: who signed and when, the image through the CRM; the signature not deletable, another file as before');
    same([lib.moldRequestView(row({}), me, [], true, [signatureFile]).signature, lib.moldRequestView(row({}), me, [], true, [signatureFile]).designFiles[0].signature, lib.moldRequestView(row({data: signed}), me, [], true, [{...signatureFile, deletedAt: at}]).signature.href], [null, null, null], 'a request whose data names none has none (an older request, or customer service\'s); a file gone: no link');
    same(lib.moldSignatureOf({signature: {signer: 1}}), null, 'a stored value that is not one is none');
    // Where the signature's image stands: on its way (held until production holds the request, or on the timetable), stopped (its tries
    // ended: the resend starts it again), refused for good; only «sent» is said as signed.
    const sigState = (file, change = {}) => lib.moldRequestView(row({data: signed, ...change}), me, [], true, [{...signatureFile, ...file}]).signature.state;
    const held = {outbox: 'send', sentAt: null, remoteFileId: null, nextAttemptAt: at};
    same([sigState({}), sigState(held), sigState(held, {accepted: signed}), sigState({...held, nextAttemptAt: null, lastAttemptAt: at, lastError: {code: 'timeout', http: 0, at}}, {accepted: signed}), sigState({...held, nextAttemptAt: null, lastAttemptAt: at, lastError: {code: 'invalid_payload', http: 400, at, final: true}}, {accepted: signed}), lib.moldRequestView(row({data: signed}), me, [], true, []).signature.state],
      ['sent', 'waiting', 'waiting', 'stopped', 'refused', 'refused'], 'the signature\'s state: sent, waiting (held or on the timetable), stopped, refused for good, or gone');
    same([lib.MOLD_SIGNATURE_TEXT.waiting, lib.MOLD_SIGNATURE_TEXT.refused[0], lib.MOLD_SIGNATURE_TEXT.stopped[1]], [['التوقيع لسه ما وصلش للإنتاج', 'The signature has not reached production yet'], 'التوقيع ما وصلش للإنتاج ومش هيتبعت تاني؛ ألغِ الطلب واطلبه من جديد بتوقيع جديد', 'The signature did not reach production; tap Resend'], 'each said in Arabic and English');
    // A whole PNG only: IHDR first, image data, IEND last, every chunk's CRC (a header with junk before IEND is not one)
    const whole = rules.moldPngWhole, chunkAt = (bytes, type) => { for (let i = 8; i < bytes.length;) { const size = (bytes[i] << 24 | bytes[i + 1] << 16 | bytes[i + 2] << 8 | bytes[i + 3]) >>> 0; if (String.fromCharCode(...bytes.subarray(i + 4, i + 8)) === type) return i; i += 12 + size; } return -1; };
    const noData = Uint8Array.from([...good.subarray(0, 33), ...new Uint8Array(1000).fill(0x41), ...good.subarray(good.length - 12)]);
    const flipped = Uint8Array.from(good); flipped[chunkAt(good, 'IDAT') + 10] ^= 0xff;
    const trailing = Uint8Array.from([...good, 0]), noEnd = good.subarray(0, good.length - 12);
    const html = new TextEncoder().encode('<html><script>x</script></html>'), badText = Uint8Array.from([...good.subarray(0, good.length - 12), 0, 0, 0, html.length, ...new TextEncoder().encode('tEXt'), ...html, 0, 0, 0, 0, ...good.subarray(good.length - 12)]);
    const bigWidth = Uint8Array.from(good); bigWidth[16] = 1;
    same([whole(good), whole(noData), whole(flipped), whole(trailing), whole(noEnd), whole(badText), whole(bigWidth), whole(new Uint8Array(signaturePng({blank: true})))], [true, false, false, false, false, false, false, true], 'whole: a header with junk and no IDAT, a flipped byte, bytes after IEND, no IEND, a chunk with a wrong CRC, an edited IHDR: refused');
    same([noData, flipped, badText, bigWidth].map(bytes => check('خالد', bytes).reason), ['not_png', 'not_png', 'not_png', 'not_png'], 'and the signature check refuses each as not a PNG');
    const listedSignature = {fileId: 70, crmFileId: 'mds-1', name: 'توقيع العميل - م. خالد.png', kind: 'image', size: 10, source: 'crm', uploadedAt: at};
    same(lib.moldPendingFiles({orderNo: 9, designFiles: [listedSignature, production(1)]}, {fileId: 'mds-1'}).designFiles.map(file => [file.fileId, file.signature || false]), [[70, true], [1, false]], 'the pending item: production\'s listing of the CRM\'s signature labelled as the signature, by its crmFileId');
    same(lib.moldPendingFiles({orderNo: 9, designFiles: [listedSignature]}).designFiles[0].signature, null, 'without the CRM\'s signature nothing is labelled');
    same([lib.MOLD_SIGNATURE_TEXT.required[0], lib.MOLD_SIGNATURE_TEXT.signerRequired[0], lib.MOLD_SIGNATURE_TEXT.signed, lib.MOLD_SIGNATURE_TEXT.title, lib.moldDesignRefusalText('signature_room', say('en'))], [rules.MOLD_SIGNATURE_REQUIRED, rules.MOLD_SIGNER_REQUIRED, ['وقّع العميل', 'Signed by the customer'], ['توقيع العميل', 'Customer signature'], 'The tenth place is the customer\'s signature; up to 9 design files'], 'the words, Arabic and English; the server\'s refusals are the screen\'s');
    const signatureTexts = [rules.MOLD_SIGNATURE_REQUIRED, rules.MOLD_SIGNER_REQUIRED, rules.MOLD_SIGNATURE_BAD, 'الطلب فيه 10 ملفات تصميم؛ احذف ملف عشان يتسع لتوقيع العميل.', 'توقيع العميل ما بيتحذفش من الطلب؛ لو اتغيّرت بيانات الطلب قبل إرساله بيوقّع العميل من جديد.'];
    same([signatureTexts.filter(text => typeof dictionary[text] !== 'string'), dictionary[rules.MOLD_SIGNATURE_REQUIRED]], [[], lib.MOLD_SIGNATURE_TEXT.required[1]], 'every refusal of the signature has its English pair');
    const routes = ['app/api/mold-requests/route.ts', 'app/api/mold-requests/design-files/delete/route.ts'].map(file => readFileSync(path.join(root, file), 'utf8')).join('\n');
    same(signatureTexts.slice(3).filter(text => !routes.includes(text)), [], 'and the server says them');
  }
  // ---- who sees which request (the owner, 2026-11-03: «يبان للمندوب طلباته بس ومدير المبيعات طلباته وطلبات فريقه»)
  // Two sales managers share the eastern region; each has supervisors and representatives under them (any depth); customer service,
  // the administrator and representatives whose «المشرف» chain reaches no sales manager (none, a missing one, the administrator, a cycle).
  const member = (id, role, supervisorId = '', regionScope = 'eastern') => ({id, role, supervisorId, regionScope, name: id, email: id + '@x', branch: 'b', active: 1, target: 0});
  const team = [member('sm', 'manager'), member('sm2', 'manager'), member('smAll', 'manager', '', 'all'), member('owner', 'admin', '', 'all'),
    member('supA', 'supervisor', 'sm'), member('repA', 'rep', 'supA'), member('repD', 'rep', 'sm'), member('supDeep', 'supervisor', 'supA'), member('repDeep', 'rep', 'supDeep'),
    member('supB', 'supervisor', 'sm2'), member('repB', 'rep', 'supB'), member('csm', 'customer_service_manager', 'sm'), member('cs', 'customer_service', 'csm'),
    member('orphan', 'rep'), member('lost', 'rep', 'gone'), member('underAdmin', 'rep', 'owner'), member('loopA', 'supervisor', 'loopB'), member('loopB', 'supervisor', 'loopA'),
    member('loopRep', 'rep', 'loopA'), member('self', 'rep', 'self'), member('sm3', 'manager', 'sm'), member('rep3', 'rep', 'sm3'), member('supInactive', 'supervisor', 'sm'), member('repLate', 'rep', 'supInactive')];
  team.find(entry => entry.id === 'supInactive').active = 0;
  const managerOf = id => lib.moldTeamManagerId(id, team);
  same(['sm', 'repA', 'repD', 'supA', 'repDeep', 'repLate', 'repB', 'sm2', 'rep3', 'sm3', 'cs', 'csm', 'owner', 'orphan', 'lost', 'underAdmin', 'loopRep', 'loopA', 'self', 'nobody'].map(managerOf),
    ['sm', 'sm', 'sm', 'sm', 'sm', 'sm', 'sm2', 'sm2', 'sm3', 'sm3', '', '', '', '', '', '', '', '', '', ''],
    'the team: a member whose «المشرف» is the manager, a representative under his supervisor at any depth (an inactive supervisor still links); the first manager up the chain; nobody\'s for customer service, the administrator, an orphan, a missing or non-sales link, a cycle');
  const reader = (id, ids = ['east']) => ({me: team.find(entry => entry.id === id), members: team, regionCustomerIds: new Set(ids)});
  const asked = (memberId, customerId = 'east') => ({memberId, customerId});
  const reads = (who, rows, ids) => rows.map(([memberId, customerId]) => lib.canReadMoldRequest(asked(memberId, customerId), reader(who, ids)));
  const everyone = [['sm'], ['repA'], ['repD'], ['supA'], ['repDeep'], ['repB'], ['sm2'], ['rep3'], ['cs'], ['csm'], ['owner'], ['orphan'], ['loopRep']];
  same(reads('sm', everyone), [true, true, true, true, true, false, false, false, false, false, false, false, false],
    'the sales manager\'s list: his own and his team\'s (direct, under a supervisor, deeper); not another manager\'s team in the same region, customer service, the administrator or an orphan');
  same(reads('sm', [['sm', 'west'], ['repA', 'west']]), [true, false], 'his own always; his team\'s only within his regions');
  same(reads('sm2', everyone), [false, false, false, false, false, true, true, false, false, false, false, false, false], 'the other manager of the same region: his own team only');
  same(reads('repA', everyone), [false, true, false, false, false, false, false, false, false, false, false, false, false], 'a representative: his own only');
  same(reads('supA', everyone), [false, true, false, true, false, false, false, false, false, false, false, false, false], 'a supervisor (unchanged): his own and his representatives\'');
  same(reads('csm', everyone), [false, false, false, false, false, false, false, false, true, true, false, false, false], 'the customer-service manager (unchanged): his own and his team\'s');
  same(reads('owner', everyone).every(Boolean), true, 'the administrator (unchanged): all');
  const approves = (who, rows, ids) => rows.map(([memberId, customerId]) => lib.moldApprovesRequest(asked(memberId, customerId), reader(who, ids)));
  same(approves('sm', everyone), [true, true, true, true, true, false, false, false, true, true, true, true, true],
    'what he approves («طلبات بانتظار اعتمادي»): his own and his team\'s, and every request whose requester is in no sales manager\'s team (customer service, the administrator, an orphan, a cycle); not another manager\'s team\'s, nor another manager\'s own');
  same(approves('sm2', [['cs'], ['owner'], ['repB'], ['repA']]), [true, true, true, false], 'both managers of the region approve customer service\'s and the administrator\'s; each his own team\'s');
  same(approves('sm', [['sm', 'west'], ['repA', 'west'], ['cs', 'west']]), [false, false, false], 'never beyond his regions, his own included');
  same(approves('smAll', [['cs', 'west'], ['repA', 'west']], []), [true, false], 'a manager of every region: customer service\'s anywhere, never another manager\'s team');
  same(['repA', 'supA', 'owner', 'csm'].map(who => lib.moldApprovesRequest(asked('cs'), reader(who))), [false, false, false, false], 'only a sales manager approves');
  // Nobody is left to approve a team's request (production cannot give this approval): when the team's manager cannot approve it now
  // (deactivated, or the customer outside his regions: his regions changed, his team asked elsewhere, his own request elsewhere), every
  // sales manager of the customer's region does, as for a request in no team. The customers' regions come from the route's records.
  const customers = [{id: 'east', kind: 'customer', data: {region: 'المنطقة الشرقية'}}, {id: 'west', kind: 'customer', data: {region: 'المنطقة الغربية'}}];
  const westMember = (id, role, supervisorId = '') => member(id, role, supervisorId, 'western');
  const moved = [...team.filter(entry => entry.id !== 'sm2'), {...member('sm2', 'manager'), active: 0}, westMember('smWest', 'manager'), westMember('smWest2', 'manager'), member('repToEast', 'rep', 'smWest'), westMember('repAway', 'rep', 'sm')];
  const withRecords = (who, ids = ['east']) => ({me: moved.find(entry => entry.id === who), members: moved, regionCustomerIds: new Set(ids), all: customers});
  same(lib.moldApprovingManagerId(asked('repB'), withRecords('sm')), '', 'the team\'s manager deactivated: no single approver');
  same(['sm', 'smAll'].map(who => lib.moldApprovesRequest(asked('repB'), withRecords(who))), [true, true], 'so the active managers of the region approve his team\'s request');
  same(['sm', 'smWest'].map(who => lib.moldApprovesRequest(asked('repToEast'), withRecords(who, who === 'sm' ? ['east'] : ['west']))), [true, false], 'a representative under a western manager asks for an eastern customer: the eastern manager approves it, the western one cannot reach it');
  same(['smWest', 'smWest2'].map(who => lib.moldApprovesRequest(asked('repAway', 'west'), withRecords(who, ['west']))), [true, true], 'the eastern manager\'s representative asks for a western customer: the western managers approve it');
  same(['sm', 'smWest'].map(who => lib.moldApprovesRequest(asked('sm', 'west'), withRecords(who, who === 'sm' ? ['east'] : ['west']))), [false, true], 'a manager\'s own request for a customer outside his regions: the region\'s managers approve it');
  same(['sm', 'smAll'].map(who => lib.moldApprovesRequest(asked('repA'), withRecords(who))), [true, false], 'a team whose manager is active and covers the customer stays his alone');
  same([lib.moldApprovingManagerId(asked('repA', 'unknown'), withRecords('sm')), lib.moldApprovingManagerId(asked('repA'), reader('sm'))], ['sm', 'sm'], 'a customer the records do not hold, or no records loaded: the team\'s manager');
  // The view offers approve/withdraw only to the manager who approves the request (the routes pass moldApprovesRequest).
  const waitingRow = row({outbox: null, accepted: data, remote: {...status, approvals: {required: true, sales: null, production: null, admin: null}}});
  same([lib.moldPermissions(waitingRow, team[0], [], true).approve, lib.moldPermissions(waitingRow, team[0], [], false).approve, lib.moldPermissions(waitingRow, team[0]).approve, lib.moldRequestView(waitingRow, team[0], team, true, [], [], false, false).can.approve],
    [true, false, true, false], 'can.approve follows whether this manager approves it');
}

// ---- the customers route: the CRM's list, the cities as the production sheet writes them
{
  eq(['الدمام', 'دمام', 'Dammam', 'Damam - الدمام', ' الرياض ', 'جدة', 'جده', 'مكة المكرمة', 'المدينة المنورة', 'جازان', 'خميس مشيط', 'الطايف', 'القصيم'].map(sheetCity),
    ['Damam - الدمام', 'Damam - الدمام', 'Damam - الدمام', 'Damam - الدمام', 'Riyadh - الرياض', 'Jeddah - جده', 'Jeddah - جده', 'MAkkah - مكة', 'Madina - المدينة', 'Jizan - جيزان', 'Khames - خميس مشيط', 'Taif - الطائف', 'Qassem - القصيم'], 'the sheet\'s cities by their Arabic or English names');
  eq([sheetCity('الخبر'), sheetCity('بريدة'), sheetCity(''), sheetCity(null), sheetCity('x'.repeat(120)).length], ['الخبر', 'بريدة', '', '', 100], 'any other city as it is: nothing guessed (Buraydah is not made Qassim)');
  // A request's city: the sheet's form for one of the sheet's cities, else the CRM's text untouched (never cut: the body leaves it out).
  eq(['الدمام', ' جدة ', 'Riyadh', 'الخبر', ' حي  بعيد ', '', null, undefined].map(moldRequestCity), ['Damam - الدمام', 'Jeddah - جده', 'Riyadh - الرياض', 'الخبر', ' حي  بعيد ', '', '', ''], 'a request\'s city as the sheet writes it when it is one of the sheet\'s');
  eq(moldRequestCity('x'.repeat(120)).length, 120, 'a long other city is not cut here');
  eq(moldRequestBody({id: 'r', requestedAt: 'x', customer: {...customer, city: moldRequestCity('الدمام')}, salesman, specs}).customer.city, 'Damam - الدمام', 'and the body carries it');
  eq(moldCustomerEntry({crmNumber: 27, name: ' مصنع  زايد ', address: 'حي الصناعية', city: 'الدمام'}), {crmNumber: 27, name: 'مصنع زايد', address: 'حي الصناعية', city: 'Damam - الدمام', active: true}, 'a customer of the list');
  eq(moldCustomerEntry({crmNumber: 28, name: 'مصنع', address: '', city: '', erpCode: ''}), {crmNumber: 28, name: 'مصنع', erpCode: '', active: true}, 'empty address and city left out');
  // Since 2026-11-02 each listed customer carries its ERP code ('' when none, so production clears a removed one): trimmed, Arabic-Indic
  // digits as ASCII digits, control characters and invisible marks dropped (never a throw that would stop the whole list), never cut: over 50 characters is
  // no ERP code and goes as ''. A customer given no erpCode (a deleted one) goes without the field, so production keeps what it holds.
  eq([' 146 ', '٣٨٨٣', '۱۲۳', 7, '', null, '14\u00016', '146\u001F', '\u007F', '\u200F146', '1\u200B4\u200E6\uFEFF', '\u202B١٤٦\u202C', '\u200F', 'C'.repeat(50), 'C'.repeat(51)].map(erpCode => moldCustomerEntry({crmNumber: 9, name: 'مصنع', erpCode}).erpCode), ['146', '3883', '123', '7', '', '', '146', '146', '', '146', '146', '146', '', 'C'.repeat(50), ''], 'the ERP code trimmed, in ASCII digits, without control characters; empty or too long goes as \'\'');
  eq(Object.keys(moldCustomerEntry({crmNumber: 9, name: 'مصنع', address: 'ع', city: 'الدمام', erpCode: '1'})), ['crmNumber', 'name', 'address', 'city', 'erpCode', 'active'], 'the contract fields in order');
  eq(Object.hasOwn(moldCustomerEntry({crmNumber: 9, name: 'مصنع', active: false}), 'erpCode'), false, 'no erpCode given (a deleted customer): the field is left out');
  eq(MOLD_LIMITS.erpCode, 50, 'the ERP code limit');
  eq([moldCustomerEntry({crmNumber: 0, name: 'x'}), moldCustomerEntry({crmNumber: 5, name: '  '}), moldCustomerEntry({crmNumber: '5', name: 'x'})], [null, null, null], 'no number or no name: not sent');
  const many = Array.from({length: 20001}, (_, i) => ({crmNumber: i + 1, name: 'مصنع ' + i, active: true}));
  const calls = moldCustomerCalls(many);
  eq([moldCustomerCalls(many.slice(0, 3)).map(call => [call.mode, call.customers.length]), calls.every(call => call.mode === 'upsert'), calls.reduce((n, call) => n + call.customers.length, 0)], [[['full', 3]], true, 20001], 'one full call when it fits; over the limits, upsert batches carrying everyone');
  ok(calls.every(call => call.customers.length <= 20000 && new TextEncoder().encode(JSON.stringify(call)).length <= MOLD_CUSTOMERS_BODY_LIMIT), 'each batch within 20000 customers and 2 MB');
}

// ---- §6: 1 minute, 5, 30, 2 hours, then every 2 hours up to 24 hours
{
  const first = '2026-11-01T08:00:00.000Z', at = minutes => new Date(Date.parse(first) + minutes * 60_000).toISOString();
  eq([moldNextAttempt(1, first, first), moldNextAttempt(2, first, at(1)), moldNextAttempt(3, first, at(6)), moldNextAttempt(4, first, at(36)), moldNextAttempt(5, first, at(156))], [at(1), at(6), at(36), at(156), at(276)], 'the timetable');
  eq(moldNextAttempt(9, first, at(22 * 60)), at(24 * 60), 'the last try falls at 24 hours');
  eq(moldNextAttempt(10, first, at(23 * 60)), null, 'nothing after 24 hours: the resend button is the way on');
}

// ---- design files (the addition of 2026-11-02): synthetic image headers, built here byte by byte
const u32be = value => [value >>> 24 & 255, value >>> 16 & 255, value >>> 8 & 255, value & 255], u16le = value => [value & 255, value >>> 8 & 255], u24le = value => [value & 255, value >>> 8 & 255, value >>> 16 & 255];
const ascii = text => [...text].map(char => char.charCodeAt(0));
const png = (width, height) => Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, ...ascii('IHDR'), ...u32be(width), ...u32be(height), 8, 2, 0, 0, 0, 0, 0, 0, 0]);
const jpeg = (width, height) => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xff, 0xdb, 0, 4, 0, 0, 0xff, 0xc2, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
const gif = (width, height) => Uint8Array.from([...ascii('GIF89a'), ...u16le(width), ...u16le(height), 0, 0, 0, 0x3b]);
const riff = (chunk, data) => Uint8Array.from([...ascii('RIFF'), ...u32be(0).reverse(), ...ascii('WEBP'), ...ascii(chunk), ...u16le(data.length), 0, 0, ...data]);
const webpLossy = (width, height) => riff('VP8 ', [0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, ...u16le(width), ...u16le(height), 0, 0]);
const webpLossless = (width, height) => { const bits = (width - 1 | (height - 1) << 14) >>> 0; return riff('VP8L', [0x2f, bits & 255, bits >>> 8 & 255, bits >>> 16 & 255, bits >>> 24 & 255, 0]); };
const webpExtended = (width, height) => riff('VP8X', [0x10, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)]);
const pdf = text => new TextEncoder().encode('%PDF-1.7\n' + text + '\n%%EOF');
{
  eq(Object.keys(MOLD_DESIGN_EXTENSIONS), ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'dwg', 'dxf', 'step', 'stp', 'igs', 'iges', 'stl', 'sldprt', 'sldasm', 'slddrw', 'nc1', 'dstv', 'ai', 'eps', 'cdr', 'psd', 'svg', 'zip', 'rar', '7z'], 'the contract\'s extensions, in its order');
  eq([MOLD_DESIGN_EXTENSIONS.pdf, MOLD_DESIGN_EXTENSIONS.jpeg, MOLD_DESIGN_EXTENSIONS.svg, MOLD_DESIGN_EXTENSIONS['7z']], ['pdf', 'image', 'other', 'other'], 'each extension\'s kind: an SVG is a drawing, never an image shown');
  eq([MOLD_DESIGN_MAX_BYTES, MOLD_DESIGN_MAX_FILES, MOLD_DESIGN_MAX_PIXELS, MOLD_DESIGN_REASONS, MOLD_DESIGN_PLACE_REASONS], [25 * 1024 * 1024, 10, 80_000_000, ['empty', 'not_pdf', 'bad_image', 'too_many_pixels'], ['too_many_files', 'crm_file_id_used']], 'the limits and the reasons (the bytes\', and the place\'s of PR #27)');
  eq(moldDesignName('رسم القالب 1380.pdf'), {name: 'رسم القالب 1380.pdf', extension: 'pdf', kind: 'pdf'}, 'the contract\'s example name');
  eq([moldDesignName(' DRAWING.DWG ')?.name, moldDesignName('Part.SLDPRT')?.extension, moldDesignName('a.b.step')?.kind], ['DRAWING.DWG', 'sldprt', 'other'], 'ends trimmed; the extension in any case');
  eq(moldDesignName('x'.repeat(196) + '.pdf')?.name.length, 200, '200 characters pass');
  eq(['x'.repeat(197) + '.pdf', 'a/b.pdf', 'a\\b.pdf', 'C:drawing.pdf', 'a<b.pdf', 'a>b.pdf', 'a"b.pdf', 'a|b.pdf', 'a?.pdf', 'a*.pdf', 'a\u0007.pdf', 'a\u0085.pdf', 'a\nb.pdf', 'x\u202Egnp.zip', '.pdf', ' .pdf', 'drawing', 'drawing.', 'setup.exe', 'image.tiff', '', null, 7].map(moldDesignName), Array(23).fill(null), 'refused: too long, a path, a forbidden character, a control or direction mark, no name, no or another extension');
  eq(moldDesignName('م'.repeat(196) + '.pdf')?.name.length, 200, 'Arabic letters count as characters, not bytes');
  eq(['CON.pdf', 'aux.png', 'COM1.dwg', 'LPT9.stl', 'nul.zip', 'PRN.jpg'].map(name => moldDesignName(name)?.name), ['CON.pdf', 'aux.png', 'COM1.dwg', 'LPT9.stl', 'nul.zip', 'PRN.jpg'], 'a Windows reserved name is a name like any other (production accepts it, PR #27)');
  eq([moldDesignDisplayName(' a/b\\c\u0000\u202E.pdf '), moldDesignDisplayName('x'.repeat(300)).length, moldDesignDisplayName(5)], ['a_b_c.pdf', 200, ''], 'a listed name made safe to show');
  // JSON may carry half of a UTF-16 pair ("\ud800"): no header can hold it and encodeURIComponent throws on it, so it is dropped; a whole
  // pair (an emoji) stays.
  eq([moldDesignDisplayName('\ud800رسم.pdf'), moldDesignDisplayName('رسم\udc00.pdf'), moldDesignDisplayName('\udc00\ud800x.pdf'), moldDesignDisplayName('a\u{1F600}b.pdf')], ['رسم.pdf', 'رسم.pdf', 'x.pdf', 'a\u{1F600}b.pdf'], 'a lone surrogate is dropped from a listed name');
  eq([moldContentDisposition('\ud800رسم.pdf'), moldDesignFileEntry({fileId: 7, crmFileId: null, name: '\ud800رسم.pdf', kind: 'pdf', size: 3, source: 'production', uploadedAt: null}).name, moldDispositionName("attachment; filename*=UTF-8''%ED%A0%80x.pdf")], ["attachment; filename*=UTF-8''" + encodeURIComponent('رسم.pdf'), 'رسم.pdf', ''], 'and the header is written, never thrown on (a broken encoding in an answer reads as no name)');
  eq([moldImageSize(png(1380, 795)), moldImageSize(jpeg(4000, 3000)), moldImageSize(gif(640, 480))], [{format: 'png', width: 1380, height: 795}, {format: 'jpeg', width: 4000, height: 3000}, {format: 'gif', width: 640, height: 480}], 'PNG (IHDR), JPEG (the frame header after APP0, DQT and fill bytes), GIF (the logical screen)');
  eq([moldImageSize(webpLossy(1024, 768)), moldImageSize(webpLossless(16383, 2)), moldImageSize(webpExtended(16777216, 3))], [{format: 'webp', width: 1024, height: 768}, {format: 'webp', width: 16383, height: 2}, {format: 'webp', width: 16777216, height: 3}], 'WEBP: VP8, VP8L and VP8X');
  eq([moldImageSize(png(1, 1).slice(0, 20)), moldImageSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2])), moldImageSize(jpeg(10, 10).slice(0, 30)), moldImageSize(new TextEncoder().encode('not an image at all')), moldImageSize(new Uint8Array(0))], [null, null, null, null, null], 'a cut header, a scan before any frame, or no image: no size');
  eq(moldDesignFileCheck('رسم.pdf', pdf('مخطط')), {ok: true, name: 'رسم.pdf', extension: 'pdf', kind: 'pdf', contentType: 'application/pdf', width: null, height: null}, 'a real PDF');
  eq(moldDesignFileCheck('photo.png', jpeg(800, 600)), {ok: true, name: 'photo.png', extension: 'png', kind: 'image', contentType: 'image/jpeg', width: 800, height: 600}, 'an image is any of the four, served as what it really is');
  eq([moldDesignFileCheck('part.dwg', Uint8Array.of(1, 2, 3)).contentType, moldDesignFileCheck('logo.svg', new TextEncoder().encode('<svg onload="x()"/>')).contentType], ['application/octet-stream', 'application/octet-stream'], 'a drawing or an SVG is plain bytes');
  eq([moldDesignFileCheck('a.exe', pdf('x')), moldDesignFileCheck('a.pdf', new Uint8Array(0)), moldDesignFileCheck('a.dwg', new Uint8Array(0)), moldDesignFileCheck('a.pdf', new TextEncoder().encode('%PDX-1.4')), moldDesignFileCheck('a.png', new TextEncoder().encode('%PDF-1.4')), moldDesignFileCheck('a.png', png(0, 10))],
    [{ok: false, field: 'name', reason: 'name'}, {ok: false, field: 'file', reason: 'empty'}, {ok: false, field: 'file', reason: 'empty'}, {ok: false, field: 'file', reason: 'not_pdf'}, {ok: false, field: 'file', reason: 'bad_image'}, {ok: false, field: 'file', reason: 'bad_image'}], 'refusals as production gives them: the name, then empty, not_pdf, bad_image');
  eq([moldDesignFileCheck('a.png', png(10000, 8000)).ok, moldDesignFileCheck('a.png', png(10000, 8001)), moldDesignFileCheck('a.webp', webpExtended(20000, 20000)).reason], [true, {ok: false, field: 'file', reason: 'too_many_pixels'}, 'too_many_pixels'], '80 000 000 pixels pass, one row more does not');
  // PR #27: %PDF- and its version anywhere within the first 1024 bytes (a PDF with bytes before its header), never beyond them.
  const marked = (offset, mark = '%PDF-1.4') => { const bytes = new Uint8Array(offset + mark.length + 40).fill(0x20); bytes.set(Uint8Array.from([0xef, 0xbb, 0xbf, 0x00, 0xff, 0x0a]).subarray(0, Math.min(offset, 6))); bytes.set(ascii(mark), offset); return bytes; };
  eq([0, 6, 300, 1016].map(offset => moldDesignFileCheck('رسم.pdf', marked(offset)).ok), [true, true, true, true], 'a PDF whose %PDF-1.x starts after other bytes passes, as long as it ends within the first 1024 bytes');
  eq([1017, 1024, 4096].map(offset => moldDesignFileCheck('رسم.pdf', marked(offset)).reason), ['not_pdf', 'not_pdf', 'not_pdf'], 'a marker cut by the 1024th byte, or wholly beyond it: not a PDF');
  eq(['%PDF-', '%PDF-x.4', '%PDF-1.', '%PDF-1x4', '%pdf-1.4', '%PDF 1.4'].map(mark => moldDesignFileCheck('a.pdf', marked(10, mark)).reason), Array(6).fill('not_pdf'), '%PDF- without its version (or another spelling) is not a PDF');
  eq([moldDesignFileCheck('a.pdf', marked(0, '%PDF-2.0')).ok, moldDesignFileCheck('CON.pdf', pdf('reserved')).ok, moldDesignFileCheck('COM1.png', png(10, 10)).ok], [true, true, true], 'PDF 2.0 too; CON.pdf and COM1.png pass the name rule');
  // An image is any of the four whatever its extension says among them, kept as what it really is (production stores and serves it so).
  eq([moldDesignFileCheck('scan.jpg', png(30, 20)), moldDesignFileCheck('photo.gif', webpLossy(64, 48)).contentType, moldDesignFileCheck('drawing.webp', gif(8, 8)).contentType, moldDesignFileCheck('a.jpeg', png(1, 1)).contentType],
    [{ok: true, name: 'scan.jpg', extension: 'jpg', kind: 'image', contentType: 'image/png', width: 30, height: 20}, 'image/webp', 'image/gif', 'image/png'], 'a mismatched image extension is still accepted, served as its real type');
  const big = new Uint8Array(MOLD_DESIGN_MAX_BYTES + 1); big.set(ascii('%PDF-1.4'));
  eq([moldDesignFileCheck('a.pdf', big.subarray(0, MOLD_DESIGN_MAX_BYTES)).ok, moldDesignFileCheck('a.pdf', big).reason], [true, 'too_large'], '25 MiB pass, one byte more does not (413 at production)');
  eq(['application/pdf', 'IMAGE/PNG; q=1', 'image/svg+xml', 'text/html', '', null].map(moldDesignContentType), ['application/pdf', 'image/png', 'application/octet-stream', 'application/octet-stream', 'application/octet-stream', 'application/octet-stream'], 'served types: a PDF, the four images, else plain bytes');
  const disposition = moldContentDisposition('رسم القالب (1).pdf', true);
  eq([disposition.startsWith("inline; filename*=UTF-8''"), /[ ()']/.test(disposition.split("''")[1]), moldDispositionName(disposition), moldContentDisposition('a.dwg')], [true, false, 'رسم القالب (1).pdf', "attachment; filename*=UTF-8''a.dwg"], 'the name in UTF-8 (RFC 5987), read back the same');
  eq([moldDispositionName('attachment; filename="../x/a.pdf"'), moldDispositionName("attachment; filename*=UTF-8''%E0%A4; filename=\"b.pdf\""), moldDispositionName('attachment')], ['.._x_a.pdf', 'b.pdf', ''], 'a plain or broken name falls back, never a path');
  const body = moldDesignFileBody({crmRequestId: 'rec-9f3a', crmFileId: 'f-71c2', name: 'رسم القالب 1380.pdf'}, pdf('x'));
  const cut = body.indexOf(10);
  eq([JSON.parse(new TextDecoder().decode(body.subarray(0, cut))), Buffer.from(body.subarray(cut + 1)).equals(Buffer.from(pdf('x')))], [{crmRequestId: 'rec-9f3a', crmFileId: 'f-71c2', name: 'رسم القالب 1380.pdf'}, true], 'the body: one JSON line, a newline, the bytes as they are');
  for (const [meta, field] of [[{crmRequestId: 'rec 1', crmFileId: 'f', name: 'a.pdf'}, /crmRequestId/], [{crmRequestId: 'r', crmFileId: 'f/1', name: 'a.pdf'}, /crmFileId/], [{crmRequestId: 'r', crmFileId: 'f', name: ' a.pdf'}, /name/], [{crmRequestId: 'r', crmFileId: 'f', name: 'a.exe'}, /name/]]) { assert.throws(() => moldDesignFileBody(meta, pdf('x')), field); checks++; }
  // designFiles in the status object and in pending items: the contract's fields, valid entries only
  const listed = [
    {fileId: 501, crmFileId: 'mdf-1', name: 'رسم.pdf', kind: 'pdf', size: 1200, source: 'crm', uploadedAt: '2026-11-02T10:00:00+03:00', path: '/var/x'},
    {fileId: 'p-9', crmFileId: 'stray', name: ' تصميم\u0000 الإنتاج.dwg ', kind: 'cad', size: -1, source: 'production', uploadedAt: 'later'},
    {fileId: 501, crmFileId: 'mdf-2', name: 'again.pdf', kind: 'pdf', size: 1, source: 'crm'}, {fileId: 0, name: 'a.pdf', kind: 'pdf', source: 'production'}, {fileId: 7, name: 'a.pdf', kind: 'pdf', source: 'erp'},
    {fileId: 8, crmFileId: null, name: 'a.pdf', kind: 'pdf', source: 'crm'}, {fileId: 9, name: '\u0007', kind: 'pdf', source: 'production'}, {fileId: 'bad id', name: 'a.pdf', source: 'production'}, 'x', null];
  const raw = {crmRequestId: 'rec-9f3a', orderNo: 92, status: 'received', editable: true, stages: {}, designFiles: listed};
  eq(moldStatusObject(raw).designFiles, [{fileId: 501, crmFileId: 'mdf-1', name: 'رسم.pdf', kind: 'pdf', size: 1200, source: 'crm', uploadedAt: '2026-11-02T10:00:00+03:00', category: 'design'}, {fileId: 'p-9', crmFileId: null, name: 'تصميم الإنتاج.dwg', kind: 'other', size: null, source: 'production', uploadedAt: null, category: 'design'}],
    'designFiles: the contract fields of the valid entries, each fileId once; production\'s file has no crmFileId; an unknown kind is shown as other; each a design file (the list it came in)');
  eq([moldStatusObject({...raw, designFiles: undefined}).designFiles, moldStatusObject({...raw, designFiles: []}).designFiles, moldDesignFileEntry({fileId: 3, crmFileId: 'mdf-3', name: 'x.pdf', kind: 'pdf', source: 'crm'}).size], [null, [], null], 'none sent (an older application) is null; an empty list is empty');
  const pending = {orderNo: 101, crmRequestId: null, source: 'manual', customer: {}, salesman: {}, specs: {}};
  eq([moldPendingItem(pending).designFiles, moldPendingItem({...pending, designFiles: listed}).designFiles.map(file => file.fileId)], [[], [501, 'p-9']], 'a pending item carries its design files, those registered in production too');
  eq(readMoldAnswer(400, {error: {code: 'invalid_payload', fields: ['file'], details: {reason: 'not_pdf'}}}), {kind: 'rejected', code: 'invalid_payload', fields: ['file'], reason: 'not_pdf'}, 'a refused file names its reason');
  eq([readMoldAnswer(400, {error: {code: 'invalid_payload', fields: ['crmFileId'], details: {reason: 'too_many_files'}}}), readMoldAnswer(400, {error: {code: 'invalid_payload', fields: ['crmFileId'], details: {reason: 'crm_file_id_used'}}})],
    [{kind: 'rejected', code: 'invalid_payload', fields: ['crmFileId'], reason: 'too_many_files'}, {kind: 'rejected', code: 'invalid_payload', fields: ['crmFileId'], reason: 'crm_file_id_used'}], 'PR #27: a refusal for the file\'s place names crmFileId and its reason, final like the others');
  eq([readMoldAnswer(400, {error: {code: 'invalid_payload', fields: ['file'], details: {reason: '<b>'}}}).reason, readMoldAnswer(413, {error: {code: 'payload_too_large'}}).kind, readMoldAnswer(404, {error: {code: 'not_found'}}).kind], [undefined, 'rejected', 'not_found'], 'a reason that is not a word is not read; 413 and 404 are final');
  eq([moldRouteTimeout('design-files'), moldRouteTimeout('design-file'), moldRouteTimeout('design-file-delete'), moldRouteTimeout('requests')], [120_000, 120_000, 10_000, 10_000], '120 seconds for the two file routes, 10 for the rest');
}

// ---- 2026-11-03 (second update): the quotation's and PO's files, a PDF or an image only, sent with their category; a design file as before
{
  eq([moldDesignFileCheck('عرض سعر Q-1.pdf', pdf('q'), 'quote').ok, moldDesignFileCheck('PO.png', png(10, 10), 'po').contentType], [true, 'image/png'], 'a PDF or an image is a quotation\'s or PO\'s file');
  for (const category of ['quote', 'po']) eq(moldDesignFileCheck('رسم.dwg', Uint8Array.from([1]), category), {ok: false, field: 'name', reason: 'not_document'}, 'a drawing is not a ' + category + ' file: refused for its name, not_document');
  eq([moldDesignFileCheck('رسم.dwg', Uint8Array.from([1]), 'design').ok, moldDesignFileCheck('رسم.dwg', Uint8Array.from([1])).ok], [true, true], 'a drawing is still a design file (the default)');
  eq(moldDesignFileCheck('a.pdf', pdf('x'), 'invoice'), {ok: false, field: 'category', reason: 'category'}, 'any other category is refused');
  eq([moldDesignFileCheck('a.pdf', Uint8Array.from([1, 2]), 'quote').reason, moldDesignFileCheck('a.png', Uint8Array.from([1, 2]), 'po').reason], ['not_pdf', 'bad_image'], 'the bytes are checked as a design file\'s');
  const plain = moldDesignFileBody({crmRequestId: 'r', crmFileId: 'f', name: 'a.pdf'}, pdf('x'));
  eq([Buffer.from(moldDesignFileBody({crmRequestId: 'r', crmFileId: 'f', name: 'a.pdf', category: 'design'}, pdf('x'))).equals(Buffer.from(plain)), Buffer.from(moldDesignFileBody({crmRequestId: 'r', crmFileId: 'f', name: 'a.pdf', category: null}, pdf('x'))).equals(Buffer.from(plain))], [true, true], 'a design file goes without category: the very same bytes as before');
  for (const category of ['quote', 'po']) {
    const body = moldDesignFileBody({crmRequestId: 'r', crmFileId: 'f', name: 'a.pdf', category}, pdf('x')), cut = body.indexOf(10);
    eq([new TextDecoder().decode(body.subarray(0, cut)), Buffer.from(body.subarray(cut + 1)).equals(Buffer.from(pdf('x')))], ['{"crmRequestId":"r","crmFileId":"f","name":"a.pdf","category":"' + category + '"}', true], category + ': the JSON line carries the category after the name');
  }
  assert.throws(() => moldDesignFileBody({crmRequestId: 'r', crmFileId: 'f', name: 'a.pdf', category: 'invoice'}, pdf('x')), /category/); checks++;
  eq(readMoldAnswer(400, {error: {code: 'invalid_payload', fields: ['name'], details: {reason: 'not_document'}}}), {kind: 'rejected', code: 'invalid_payload', fields: ['name'], reason: 'not_document'}, 'production\'s not_document: final, with its reason');
}

// ---- every route against the stand-in production API
function fetchWith(caFile) {
  const authority = readFileSync(caFile);
  return (url, init) => new Promise((resolve, reject) => {
    const req = httpsRequest(url, {method: init.method, headers: init.headers, ca: authority, signal: init.signal}, res => {
      const headers = new Headers(Object.entries(res.headers).flatMap(([key, value]) => Array.isArray(value) ? value.map(item => [key, item]) : [[key, value]]));
      const parts = []; res.on('data', part => parts.push(part)); res.on('end', () => { const bytes = Buffer.concat(parts); resolve({status: res.statusCode, headers, arrayBuffer: async () => bytes}); });
    });
    req.on('error', error => reject(init.signal?.aborted ? Object.assign(new Error('timeout'), {name: 'TimeoutError'}) : error));
    req.end(init.body);
  });
}
const mock = await startProductsMock();
try {
  const fetch = fetchWith(mock.ca), config = moldConfig({YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret}), call = (route, body, extra = {}) => callProducts(config, route, body, {fetch, ...extra});
  const body = moldRequestBody({id: 'mr-1', requestedAt: riyadhIso(Date.now()), customer, salesman, specs});
  let answer = await call('requests', body);
  eq([answer.kind, answer.http, answer.json.created, answer.json.request.orderNo, answer.json.request.status, answer.json.request.editable], ['ok', 201, true, 92, 'received', true], 'a new request: 201, order 92, received and editable');
  eq([answer.json.request.waitingStep, moldStatusObject(answer.json.request).approvals], ['sales', {required: true, sales: null, production: null, admin: null}], 'it waits for the sales manager first');
  ok(mock.state.calls.at(-1).signed && mock.state.calls.at(-1).headers['content-type'] === 'application/json; charset=utf-8', 'signed, JSON in UTF-8');
  answer = await call('requests', body);
  eq([answer.http, answer.json.created, answer.json.request.revision], [200, false, 1], 'the same request again: 200, no change (idempotent)');
  // the approval chain: the sales manager in the CRM (the approval route), then production and the system administrator
  const approve = (action, id = 'mr-1') => call('approval', moldApprovalBody({id, action, by: {name: 'مدير المبيعات', email: 'manager@yourrest.org'}}));
  answer = await approve('approve');
  eq([answer.kind, answer.json.request.waitingStep, answer.json.request.approvals.sales.by, answer.json.request.status], ['ok', 'production', 'manager@yourrest.org (مدير المبيعات)', 'received'], 'approved by the sales manager: it waits for production, still received');
  eq((await approve('approve')).json.request.revision, answer.json.request.revision, 'approving again changes nothing');
  eq((await approve('withdraw')).json.request.waitingStep, 'sales', 'withdrawn: back to the sales manager');
  eq((await approve('withdraw')).kind, 'ok', 'withdrawing again is safe');
  await approve('approve');
  const held = mock.row('mr-1').revision;
  answer = await call('requests', body);
  eq([answer.kind, answer.http, answer.json.created, answer.json.request.revision, answer.json.request.approvals.sales !== null], ['ok', 200, false, held, true], 'the same data again (a retry): 200 created false, nothing changes, the approval stays');
  answer = await call('requests', {...body, specs: {...body.specs, quantity: 2}});
  eq([answer.kind, answer.http, answer.code, answer.reason, answer.request.crmRequestId, answer.request.revision, answer.request.waitingStep, !!answer.request.approvals.sales],
    ['locked', 409, 'request_locked', 'production_only', 'mr-1', held, 'production', true], 'other data while received: 409 production_only with the status; nothing changes, the approval stays');
  eq([mock.row('mr-1').quantity, mock.row('mr-1').revision], [1, held], 'production keeps its data');
  mock.approve('mr-1', 'production');
  answer = await approve('withdraw');
  eq([answer.kind, answer.code, answer.request.waitingStep], ['locked', 'request_locked', 'admin'], 'after production approved: the withdrawal is refused with the current state');
  mock.approve('mr-1', 'admin');
  eq((await call('status', {ids: ['mr-1']})).json.requests[0].status, 'confirmed', 'all three approvals: confirmed');
  eq((await call('approval', moldApprovalBody({id: 'mr-none', action: 'approve', by: {name: 'm'}}))).kind, 'not_found', 'an unknown request: 404');
  // the sales manager approves every request, those registered in production too: the pending route, then the approval by orderNo
  const manual = mock.registerManual({customerNo: 27, customerName: 'مصنع مسجّل', enteredBy: 'x'});
  const waitBody = moldRequestBody({id: 'mr-wait', requestedAt: riyadhIso(Date.now()), customer, salesman, specs});
  await call('requests', waitBody);
  answer = await call('pending', {});
  const waiting = answer.json.requests.map(item => moldPendingItem(item));
  eq(waiting.map(item => [item.orderNo, item.source, item.crmRequestId]), [[manual.orderNo, 'manual', null], [mock.row('mr-wait').orderNo, 'crm', 'mr-wait']], 'pending: both, the longest waiting first');
  eq([waiting[0].enteredBy, waiting[0].customer.crmNumber, waiting[0].specs.halfBlock], ['staff@yourrest.org', 27, 'two'], 'who entered it in production, the customer, the specifications');
  answer = await call('approval', moldApprovalBody({orderNo: manual.orderNo, action: 'approve', by: {name: 'مدير المبيعات'}}));
  eq([answer.kind, answer.json.request.crmRequestId, answer.json.request.waitingStep], ['ok', null, 'production'], 'approved by its orderNo: it waits for production');
  eq((await call('pending', {})).json.requests.map(item => item.orderNo), [mock.row('mr-wait').orderNo], 'and leaves the pending list');
  // 2026-11-02: the production manager edits a CRM request in the products application. pending lists it as it is now; the ORIGINAL data
  // again is still a safe retry (200 created false, not a change); any other data, the edited data included, is 409 production_only.
  const edited = mock.edit('mr-wait', {customerName: 'مصنع عدّله الإنتاج', salesmanName: 'مندوب عدّله الإنتاج', quantity: 4, description: 'وصف عدّله الإنتاج'});
  const editedItem = moldPendingItem((await call('pending', {})).json.requests.find(item => item.crmRequestId === 'mr-wait'));
  eq([editedItem.customer.name, editedItem.salesman.name, editedItem.specs.quantity, editedItem.specs.description, editedItem.customer.crmNumber], ['مصنع عدّله الإنتاج', 'مندوب عدّله الإنتاج', 4, 'وصف عدّله الإنتاج', 27], 'pending: the CRM\'s request as the production manager edited it');
  answer = await call('requests', waitBody);
  eq([answer.kind, answer.http, answer.json.created, answer.json.request.revision, mock.row('mr-wait').quantity, mock.row('mr-wait').customerName], ['ok', 200, false, edited.revision, 4, 'مصنع عدّله الإنتاج'], 'the original again after the edit: 200 created false, nothing changes (a safe retry)');
  answer = await call('requests', {...waitBody, customer: {...waitBody.customer, name: 'مصنع عدّله الإنتاج'}, salesman: {...waitBody.salesman, name: 'مندوب عدّله الإنتاج'}, specs: {...waitBody.specs, quantity: 4, description: 'وصف عدّله الإنتاج'}});
  eq([answer.kind, answer.code, answer.reason, answer.request.revision], ['locked', 'request_locked', 'production_only', edited.revision], 'the edited data from the CRM: not the original, so 409 production_only; nothing changes');
  answer = await call('requests', {...waitBody, specs: {...waitBody.specs, quantity: 9}});
  eq([answer.kind, answer.reason, mock.row('mr-wait').quantity], ['locked', 'production_only', 4], 'any other data: 409 production_only');
  eq(await Promise.resolve().then(() => mock.edit('mr-wait', {orderNo: 1})).then(() => '', error => error.message), 'no such column: orderNo', 'the stand-in\'s edit changes the request\'s data only');
  eq((await call('approval', moldApprovalBody({orderNo: 9999, action: 'approve', by: {name: 'm'}}))).kind, 'not_found', 'an unknown order: 404');
  // production cancels or deletes it afterwards: the refusal to withdraw carries the request (crmRequestId null) and its reason
  manual.cancelled = true;
  answer = await call('approval', moldApprovalBody({orderNo: manual.orderNo, action: 'withdraw', by: {name: 'مدير المبيعات'}}));
  eq([answer.kind, answer.request?.status, answer.request?.crmRequestId, moldApprovalRefusal(answer.request, false)], ['locked', 'cancelled', null, 'الطلب ملغى في تطبيق الإنتاج.'], 'a request registered in production and cancelled there: refused, said so');
  // the customers route: full deactivates whoever is missing (nobody deleted); upsert only adds or changes; 2 MB allowed
  answer = await call('customers', {mode: 'full', customers: [moldCustomerEntry({crmNumber: 1, name: 'أ', city: 'الدمام'}), moldCustomerEntry({crmNumber: 2, name: 'ب'})]});
  eq([answer.kind, answer.json], ['ok', {received: 2, inserted: 2, updated: 0, deactivated: 0, activeCustomers: 2}], 'a full list');
  eq(mock.state.customers.get(1).city, 'Damam - الدمام', 'the city as the sheet writes it');
  eq((await call('customers', {mode: 'upsert', customers: [moldCustomerEntry({crmNumber: 3, name: 'ج'})]})).json, {received: 1, inserted: 1, updated: 0, deactivated: 0, activeCustomers: 3}, 'upsert adds only');
  eq((await call('customers', {mode: 'full', customers: [moldCustomerEntry({crmNumber: 1, name: 'أ معدّل', city: 'الدمام'})]})).json, {received: 1, inserted: 0, updated: 1, deactivated: 2, activeCustomers: 1}, 'full: the missing two deactivated');
  const big = Array.from({length: 9000}, (_, i) => moldCustomerEntry({crmNumber: i + 10, name: 'مصنع رقم ' + i, address: 'عنوان طويل نسبيًا للاختبار ' + i, city: 'الرياض'}));
  ok(new TextEncoder().encode(JSON.stringify({mode: 'full', customers: big})).length > 64 * 1024, 'a list well over the 64 KB of the other routes');
  eq((await call('customers', {mode: 'full', customers: big})).json.received, 9000, 'is accepted on this route (up to 2 MB)');
  eq((await call('customers', {mode: 'full', customers: [{crmNumber: 1, name: ''}]})).kind, 'rejected', 'a customer without a name: refused');
  mock.produce('mr-1', {stages: ['laserCutting', 'box'], moldSerial: '093', productionDate: '2026-11-01'});
  answer = await call('requests', {...body, specs: {...body.specs, quantity: 3}});
  eq([answer.kind, answer.code, answer.reason, answer.request.status, answer.request.editable, answer.request.stagesDone], ['locked', 'request_locked', 'production_only', 'in_production', false, 2], 'production started: 409 request_locked production_only with the current state');
  answer = await call('cancel', {crmRequestId: 'mr-1', reason: ''});
  eq(answer.kind, 'locked', 'and it can no longer be cancelled');
  await call('requests', moldRequestBody({id: 'mr-2', requestedAt: riyadhIso(Date.now()), customer, salesman, specs}));
  answer = await call('cancel', {crmRequestId: 'mr-2', reason: 'العميل أجّل'});
  eq([answer.kind, answer.json.request.status, answer.json.request.editable], ['ok', 'cancelled', false], 'a received request is cancelled');
  eq((await call('cancel', {crmRequestId: 'mr-2', reason: ''})).json.request.status, 'cancelled', 'cancelling again: 200 with its state');
  eq((await call('cancel', {crmRequestId: 'mr-404', reason: ''})).kind, 'not_found', 'cancelling an unknown request: 404');
  answer = await call('status', {ids: ['mr-1', 'mr-2', 'mr-none']});
  eq([answer.json.requests.map(r => r.crmRequestId).sort(), answer.json.unknown], [['mr-1', 'mr-2'], ['mr-none']], 'status: known and unknown in one call');
  eq((await call('requests', {...body, crmRequestId: 'mr-3', specs: {...body.specs, moldWidth: 999}})).fields, ['specs.moldWidth'], 'production names the refused field');
  // historical rows: linking (§5 and the addendum)
  mock.seedLegacy(3);
  const legacy = moldRequestBody({id: 'mr-legacy-2', legacyOrderNo: 2, requestedAt: '2025-03-01T09:00:00+03:00', customer, salesman, specs});
  answer = await call('requests', legacy);
  eq([answer.http, answer.json.created, answer.json.linked, answer.json.request.orderNo], [200, false, true, 2], 'a historical row is linked, not created');
  eq([answer.json.request.waitingStep, answer.json.request.approvals.required], ['manufacturing', false], 'a historical request needs no approval');
  eq((await call('approval', moldApprovalBody({id: 'mr-legacy-2', action: 'approve', by: {name: 'm'}}))).kind, 'locked', 'and cannot be approved');
  answer = await call('approval', moldApprovalBody({orderNo: 3, action: 'withdraw', by: {name: 'm'}}));
  eq([answer.kind, answer.request?.approvals.required, moldApprovalRefusal(answer.request, false)], ['locked', false, 'طلب قديم من الشيت ومعتمد أصلًا؛ لا يحتاج اعتمادًا.'], 'an unlinked historical row by its order number: refused as historical');
  answer = await call('requests', {...legacy, specs: {...legacy.specs, quantity: 9}});
  eq([answer.http, answer.json.linked], [200, false], 'linking again is safe even when the CRM data differ');
  eq((await call('requests', {...legacy, crmRequestId: 'mr-other'})).kind, 'locked', 'a row linked to another CRM id: 409');
  eq((await call('requests', {...legacy, crmRequestId: 'mr-x', legacyOrderNo: 77})).fields, ['legacyOrderNo'], 'an unknown historical number: 400 legacyOrderNo');
  // failures the CRM keeps waiting through (§6)
  eq((await callProducts(moldConfig({YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: 'y'.repeat(40)}), 'status', {ids: ['mr-1']}, {fetch})).code, 'invalid_signature', 'a wrong secret: 401, kept waiting');
  eq((await call('status', {ids: ['mr-1']}, {now: () => Date.now() - 400_000})).code, 'stale_timestamp', 'a clock 400 s behind: 401 stale_timestamp');
  mock.state.notConfigured = true;
  eq((await call('requests', body)).code, 'not_configured', 'production without its secret: 503 not_configured');
  mock.state.notConfigured = false; mock.state.down = true;
  eq((await call('requests', body)).code, 'network', 'production unreachable');
  mock.state.down = false; mock.state.delayMs = 600;
  eq((await call('status', {ids: ['mr-1']}, {timeoutMs: 200})).code, 'timeout', 'no answer within the limit: timeout');
  mock.state.delayMs = 0;
  eq((await callProducts({ok: false, reason: 'not_configured'}, 'requests', body, {fetch})).code, 'not_configured', 'no settings: no call at all');
  // ---- design files against the stand-in: attach (the JSON line and the bytes signed together), repeat, refusals, delete, download
  const attach = (crmRequestId, crmFileId, name, bytes, extra) => call('design-files', moldDesignFileBody({crmRequestId, crmFileId, name}, bytes), extra);
  const drawing = pdf('مخطط القالب 1380');
  answer = await attach('mr-later', 'mdf-early', 'رسم.pdf', drawing);
  eq([answer.kind, answer.http], ['not_found', 404], 'a file before its request is accepted: 404, final');
  await call('requests', moldRequestBody({id: 'mr-files', requestedAt: riyadhIso(Date.now()), customer, salesman, specs}));
  await approve('approve', 'mr-files');
  eq(mock.row('mr-files').approvals.sales !== null, true, 'the sales manager approved before the file came');
  answer = await attach('mr-files', 'mdf-a', 'رسم القالب 1380.pdf', drawing);
  const sent = mock.state.calls.at(-1), fileA = answer.json?.file;
  eq([answer.kind, answer.http, answer.json.created, fileA.crmFileId, fileA.name, fileA.kind, fileA.size, fileA.source], ['ok', 201, true, 'mdf-a', 'رسم القالب 1380.pdf', 'pdf', drawing.length, 'crm'], '201 created, the file as production lists it');
  eq([sent.signed, sent.headers['content-type'], JSON.parse(sent.body).crmFileId], [true, 'application/octet-stream', 'mdf-a'], 'sent as application/octet-stream and accepted as signed');
  const whole = moldDesignFileBody({crmRequestId: 'mr-files', crmFileId: 'mdf-a', name: 'رسم القالب 1380.pdf'}, drawing);
  eq([sent.bytes, sent.headers['x-yr-signature']], [whole.length, moldSignature(mock.state.secret, sent.headers['x-yr-timestamp'], 'POST', 'design-files', Buffer.from(whole))], 'the signature covers the whole body: the JSON line, the newline and the file');
  const request = moldStatusObject(answer.json.request);
  eq([request.waitingStep, request.approvals.sales, request.designFiles.map(file => file.crmFileId)], ['sales', null, ['mdf-a']], 'attaching undoes the approvals given (back to the sales manager) and the file is listed');
  const revision = request.revision;
  answer = await attach('mr-files', 'mdf-a', 'رسم القالب 1380.pdf', drawing);
  eq([answer.kind, answer.http, answer.json.created, answer.json.file.fileId, answer.json.request.revision], ['ok', 200, false, fileA.fileId, revision], 'the same file again: 200 created:false, nothing changes (safe to repeat)');
  answer = await attach('mr-files', 'mdf-a', 'رسم القالب 1380.pdf', pdf('another drawing'));
  eq([answer.kind, answer.http, answer.code, answer.fields, answer.reason], ['rejected', 400, 'invalid_payload', ['crmFileId'], 'crm_file_id_used'], 'a crmFileId is never another file: 400 crmFileId, reason crm_file_id_used (PR #27)');
  for (const [name, bytes, reason] of [['empty.dwg', new Uint8Array(0), 'empty'], ['fake.pdf', new TextEncoder().encode('<html>'), 'not_pdf'], ['broken.png', new TextEncoder().encode('PNG?'), 'bad_image'], ['huge.png', png(10000, 8001), 'too_many_pixels']]) {
    answer = await attach('mr-files', 'mdf-' + reason, name, bytes);
    eq([answer.kind, answer.http, answer.code, answer.fields, answer.reason], ['rejected', 400, 'invalid_payload', ['file'], reason], '400 invalid_payload file with details.reason ' + reason);
  }
  eq((await call('design-files', Buffer.from('{"crmRequestId":"mr-files","crmFileId":"mdf-x","name":"a<b>.pdf"}\n%PDF-1.4'))).fields, ['name'], 'a forbidden name: 400 name');
  eq((await call('design-files', Buffer.from('{"crmRequestId":"mr-files","crmFileId":"bad id","name":"a.pdf"}\n%PDF-1.4'))).fields, ['crmFileId'], 'a malformed crmFileId: 400 crmFileId');
  const tooBig = Buffer.alloc(MOLD_DESIGN_MAX_BYTES + 1); tooBig.write('%PDF-1.4');
  answer = await attach('mr-files', 'mdf-big', 'big.pdf', tooBig);
  eq([answer.kind, answer.http, answer.code], ['rejected', 413, 'payload_too_large'], 'a file over 25 MiB: 413, final');
  eq((await call('design-files', Buffer.alloc(MOLD_DESIGN_MAX_BYTES + 5000))).http, 0, 'a body beyond 25 MiB and the JSON line is never sent');
  await assert.rejects(call('design-files', {crmRequestId: 'mr-files'}), /raw body/); checks++;
  await assert.rejects(call('status', Buffer.from('{}')), /JSON route/); checks++;
  // PR #27 at the stand-in, on a request of its own (the 10 places of mr-files stay as counted below): a PDF whose header follows other
  // bytes, a reserved Windows name, an image whose extension names another of the four (kept and served as what it is)
  await call('requests', moldRequestBody({id: 'mr-pr27', requestedAt: riyadhIso(Date.now()), customer, salesman, specs}));
  const leading = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.alloc(900, 0x20), Buffer.from('%PDF-1.7\n% leading bytes\n%%EOF\n')]);
  answer = await attach('mr-pr27', 'mdf-leading', 'CON.pdf', leading);
  eq([answer.kind, answer.http, answer.json.file.name, answer.json.file.kind], ['ok', 201, 'CON.pdf', 'pdf'], 'a PDF with 903 bytes before %PDF-1.7, named CON.pdf: accepted');
  answer = await attach('mr-pr27', 'mdf-late-mark', 'late.pdf', Buffer.concat([Buffer.alloc(1024, 0x20), Buffer.from('%PDF-1.4\n')]));
  eq([answer.kind, answer.http, answer.fields, answer.reason], ['rejected', 400, ['file'], 'not_pdf'], 'its marker beyond the first 1024 bytes: not_pdf');
  eq((await attach('mr-pr27', 'mdf-no-version', 'bare.pdf', Buffer.from('%PDF-\n%%EOF'))).reason, 'not_pdf', '%PDF- without its version: not_pdf');
  answer = await attach('mr-pr27', 'mdf-mismatch', 'COM1.jpg', png(40, 30));
  eq([answer.kind, answer.http, answer.json.file.kind], ['ok', 201, 'image'], 'a PNG named COM1.jpg: accepted');
  answer = await call('design-file', {fileId: answer.json.file.fileId});
  eq([answer.file.contentType, answer.file.name], ['image/png', 'COM1.jpg'], 'and served as the PNG it is, under its own name');
  // production's own file: listed with source production and no crmFileId, in the status and in pending
  const production = mock.addProductionFile('mr-files', {name: 'تصميم الإنتاج.png', bytes: png(1200, 900)});
  const listedNow = moldStatusObject((await call('status', {ids: ['mr-files']})).json.requests[0]).designFiles;
  eq(listedNow.map(file => [file.source, file.crmFileId, file.kind]), [['crm', 'mdf-a', 'pdf'], ['production', null, 'image']], 'status: the CRM\'s file and production\'s');
  const manualFiles = mock.registerManual({customerNo: 27});
  mock.addProductionFile(manualFiles.orderNo, {name: 'مخطط يدوي.dxf', bytes: Buffer.from('0\nSECTION')});
  const waitingNow = (await call('pending', {})).json.requests.map(item => moldPendingItem(item));
  eq([waitingNow.find(item => item.crmRequestId === 'mr-files').designFiles.length, waitingNow.find(item => item.orderNo === manualFiles.orderNo).designFiles.map(file => [file.name, file.source, file.kind])], [2, [['مخطط يدوي.dxf', 'production', 'other']]], 'pending: each waiting request with its design files, one registered in production too');
  // the download: the bytes, their type and the name in UTF-8
  answer = await call('design-file', {fileId: fileA.fileId});
  eq([answer.kind, answer.http, Buffer.compare(answer.file.bytes, Buffer.from(drawing)), answer.file.contentType, answer.file.name], ['ok', 200, 0, 'application/pdf', 'رسم القالب 1380.pdf'], 'design-file: the PDF as sent, its type, its Arabic name');
  answer = await call('design-file', {fileId: production.fileId});
  eq([answer.file.contentType, answer.file.name, answer.file.bytes.length], ['image/png', 'تصميم الإنتاج.png', png(1200, 900).length], 'production\'s image');
  answer = await call('design-file', {fileId: 99999});
  eq([answer.kind, answer.http, answer.code], ['not_found', 404, 'not_found'], 'an unknown file: 404 in the usual JSON');
  const fake = (status, headers, bytes) => async () => ({status, headers: new Headers(headers), arrayBuffer: async () => bytes, body: {cancel: async () => {}}});
  eq((await callProducts(config, 'design-file', {fileId: 1}, {fetch: fake(200, {'content-type': 'application/json'}, Buffer.from('{"request":{}}'))})).code, 'bad_response', 'JSON in place of a file: not a file');
  eq((await callProducts(config, 'design-file', {fileId: 1}, {fetch: fake(200, {'content-length': String(MOLD_DESIGN_MAX_BYTES + 1)}, Buffer.alloc(0))})).code, 'bad_response', 'a declared size over 25 MiB is not read');
  answer = await callProducts(config, 'design-file', {fileId: 1}, {fetch: fake(200, {'content-type': 'image/svg+xml', 'content-disposition': 'attachment; filename="../../etc/x.svg"'}, Buffer.from('<svg/>'))});
  eq([answer.file.contentType, answer.file.name], ['application/octet-stream', '.._.._etc_x.svg'], 'an SVG is served as plain bytes; a path in the name is flattened');
  // no declared size: the body is read as it arrives and given up past 25 MiB, never held whole first
  const streamed = (chunks, size) => {
    let pulls = 0, cancelled = false;
    const body = new ReadableStream({pull(controller) { pulls++; if (pulls > chunks) controller.close(); else controller.enqueue(new Uint8Array(size).fill(pulls)); }, cancel() { cancelled = true; }});
    return {fetch: async () => ({status: 200, headers: new Headers({'content-type': 'application/pdf'}), body, arrayBuffer: async () => { throw new Error('read whole'); }}), seen: () => ({pulls, cancelled})};
  };
  const endless = streamed(1000, 1024 * 1024);
  answer = await callProducts(config, 'design-file', {fileId: 1}, {fetch: endless.fetch});
  eq([answer.kind, answer.code, endless.seen().cancelled, endless.seen().pulls <= 28], ['retry', 'bad_response', true, true], 'an undeclared size: reading stops once past 25 MiB (about 26 of 1000 MiB read)');
  const small = streamed(3, 1000);
  answer = await callProducts(config, 'design-file', {fileId: 1}, {fetch: small.fetch});
  eq([answer.kind, answer.file.bytes.length, answer.file.bytes[0], answer.file.bytes[2999], small.seen().cancelled], ['ok', 3000, 1, 3, false], 'a streamed file within the limit arrives whole, in order');
  // the 10-file limit counts production's files too
  for (let n = 0; n < 8; n++) eq((await attach('mr-files', 'mdf-n' + n, 'drawing ' + n + '.dwg', Uint8Array.of(n + 1))).http, 201, 'file ' + (n + 3) + ' of 10');
  answer = await attach('mr-files', 'mdf-eleventh', 'one more.dwg', Uint8Array.of(9));
  eq([answer.kind, answer.http, answer.code, answer.fields, answer.reason], ['rejected', 400, 'invalid_payload', ['crmFileId'], 'too_many_files'], 'the eleventh file: 400 crmFileId, reason too_many_files (PR #27)');
  // delete: the CRM's own file, the approvals undone again; then 404 once gone
  await approve('approve', 'mr-files');
  answer = await call('design-file-delete', {crmRequestId: 'mr-files', crmFileId: 'mdf-a'});
  eq([answer.kind, answer.http, moldStatusObject(answer.json.request).designFiles.some(file => file.crmFileId === 'mdf-a'), answer.json.request.waitingStep, answer.json.request.approvals.sales], ['ok', 200, false, 'sales', null], 'design-file-delete: gone, and the approvals undone like an attach');
  eq((await call('design-file-delete', {crmRequestId: 'mr-files', crmFileId: 'mdf-a'})).kind, 'not_found', 'deleting again: 404 (already gone)');
  answer = await attach('mr-files', 'mdf-a', 'رسم القالب 1380.pdf', drawing);
  eq([answer.kind, answer.http, answer.fields, answer.reason, mock.row('mr-files').designFiles.length], ['rejected', 400, ['crmFileId'], 'crm_file_id_used', 9], 'the crmFileId of a file deleted since is never taken again, even with the same bytes: crm_file_id_used');
  eq((await call('design-file-delete', {crmRequestId: 'mr-files', crmFileId: 'bad id'})).fields, ['crmFileId'], 'a malformed crmFileId: 400');
  eq((await call('design-file-delete', {crmRequestId: 'mr-nowhere', crmFileId: 'mdf-a'})).kind, 'not_found', 'an unknown request: 404');
  // the approvals complete: the request is not editable, attach and delete answer 409 request_locked with the status
  await approve('approve', 'mr-files'); mock.approve('mr-files', 'production'); mock.approve('mr-files', 'admin');
  answer = await attach('mr-files', 'mdf-late', 'late.pdf', drawing);
  eq([answer.kind, answer.http, answer.code, answer.request.status, answer.request.editable, answer.request.designFiles.length], ['locked', 409, 'request_locked', 'confirmed', false, 9], 'attach after the approvals: 409 with the status object (nine files left)');
  answer = await call('design-file-delete', {crmRequestId: 'mr-files', crmFileId: 'mdf-n0'});
  eq([answer.kind, answer.request.status, mock.row('mr-files').designFiles.some(file => file.crmFileId === 'mdf-n0')], ['locked', 'confirmed', true], 'delete after the approvals: 409, the file stays');
  eq((await attach('mr-files', 'mdf-n1', 'drawing 1.dwg', Uint8Array.of(2))).json?.created, false, 'a repeat of a file production already holds is still answered 200, locked or not');
  // ---- 2026-11-03: payment beside customer, salesman and specs; part of the original data; listed by pending
  answer = await call('requests', {...moldRequestBody({id: 'mr-pay-bad', requestedAt: riyadhIso(Date.now()), customer, salesman, specs}), payment: 'card'});
  eq([answer.kind, answer.http, answer.code, answer.fields, mock.row('mr-pay-bad')], ['rejected', 400, 'invalid_payload', ['payment'], undefined], 'any payment but cash or deferred: 400 invalid_payload fields [payment], nothing stored');
  const paidBody = moldRequestBody({id: 'mr-pay', requestedAt: riyadhIso(Date.now()), customer, salesman, specs, payment: 'deferred'});
  answer = await call('requests', paidBody);
  eq([answer.kind, answer.http, mock.row('mr-pay').payment], ['ok', 201, 'deferred'], 'a new request with its payment');
  const olderBody = moldRequestBody({id: 'mr-pay-old', requestedAt: riyadhIso(Date.now()), customer, salesman, specs});
  answer = await call('requests', olderBody);
  eq([answer.http, mock.row('mr-pay-old').payment], [201, null], 'an older client\'s request without payment: stored as null');
  eq([(await call('requests', olderBody)).json?.created, (await call('requests', paidBody)).json?.created], [false, false], 'each resent as first sent: 200 created false');
  answer = await call('requests', {...olderBody, payment: 'cash'});
  eq([answer.kind, answer.reason], ['locked', 'production_only'], 'a payment added to a request first sent without one is other data: 409 production_only');
  eq((await call('requests', {...paidBody, payment: 'cash'})).reason, 'production_only', 'so is another payment');
  const paidListed = (await call('pending', {})).json.requests.map(item => moldPendingItem(item));
  eq([paidListed.find(item => item.crmRequestId === 'mr-pay').payment, paidListed.find(item => item.crmRequestId === 'mr-pay-old').payment], ['deferred', null], 'pending: each request\'s payment, null for the older one');
  mock.edit('mr-pay', {payment: 'cash'});
  eq(moldPendingItem((await call('pending', {})).json.requests.find(item => item.crmRequestId === 'mr-pay')).payment, 'cash', 'as the production manager may have changed it');
  // ---- 2026-11-03: the production manager restores a cancelled request; the same cancellation again changes nothing
  await approve('approve', 'mr-pay');
  answer = await call('cancel', {crmRequestId: 'mr-pay', reason: 'العميل أجّل'});
  eq([answer.json.request.status, answer.json.request.waitingStep], ['cancelled', 'cancelled'], 'cancelled');
  const restoredNow = mock.restore('mr-pay');
  answer = await call('status', {ids: ['mr-pay']});
  eq([restoredNow.status, answer.json.requests[0].status, answer.json.requests[0].editable, answer.json.requests[0].waitingStep, !!answer.json.requests[0].approvals.sales, answer.json.requests[0].revision > 0], ['received', 'received', true, 'production', true, true], 'restored: back where it stood (the sales manager\'s approval kept), editable, read from status');
  const before = mock.row('mr-pay').revision;
  answer = await call('cancel', {crmRequestId: 'mr-pay', reason: '  العميل   أجّل '});
  eq([answer.kind, answer.http, answer.json.request.status, answer.json.request.revision], ['ok', 200, 'received', before], 'the same reason (spaces aside) after the restore: 200 with the request as it is, nothing cancelled');
  answer = await call('cancel', {crmRequestId: 'mr-pay', reason: 'سبب جديد'});
  eq([answer.json.request.status, mock.row('mr-pay').cancelReason], ['cancelled', 'سبب جديد'], 'a new reason cancels it again');
  eq((await call('cancel', {crmRequestId: 'mr-pay', reason: 'العميل أجّل'})).json.request.status, 'cancelled', 'a cancellation of a cancelled request: 200 with its state, as before');
  mock.restore('mr-pay');
  eq((await call('cancel', {crmRequestId: 'mr-pay', reason: 'سبب جديد'})).json.request.status, 'received', 'restored again: the second reason is used too');
  eq(await Promise.resolve().then(() => mock.restore('mr-pay')).then(() => '', error => error.message), 'not cancelled: mr-pay', 'only a cancelled request is restored');
  mock.remove('mr-pay-old');
  eq([mock.restore('mr-pay-old').status, mock.row('mr-pay-old').deleted], ['received', false], 'a request deleted in production is restored the same way');
  // ---- 2026-11-03 (production's second update): the application before its update ignores the numbers and the categories silently;
  // after it, it takes them, keeps them in the original a retry is compared with, and answers them in every status object and pending item
  const quoted = id => moldRequestBody({id, requestedAt: riyadhIso(Date.now()), customer, salesman, specs, payment: 'cash', quoteNo: 'Q-2026-0153'});
  answer = await call('requests', quoted('mr-qpo-old'));
  eq([answer.http, Object.hasOwn(answer.json.request, 'quoteOrPoMissing'), mock.row('mr-qpo-old').quoteNo, moldQuotePoAnswered(moldStatusObject(answer.json.request))], [201, false, null, false], 'the older application: the number is dropped without a word, and nothing says it was (nothing learned)');
  const quoteBytes = pdf('quotation before the update');
  answer = await attach('mr-qpo-old', 'mdf-qpo-old', 'عرض سعر.pdf', quoteBytes, undefined);
  ok(answer.kind === 'ok', 'a design file first (no category)');
  answer = await call('design-files', moldDesignFileBody({crmRequestId: 'mr-qpo-old', crmFileId: 'mdf-qpo-old-q', name: 'عرض سعر 2.pdf', category: 'quote'}, quoteBytes));
  eq([answer.http, answer.json.file.category, answer.json.request.designFiles.length, Object.hasOwn(answer.json.request, 'quoteFiles')], [201, undefined, 2, false], 'and a category it ignores: kept as a design file (so the CRM never sends one before the update)');
  mock.setQuotePo(true);
  answer = await call('status', {ids: ['mr-qpo-old']});
  const afterUpdate = answer.json.requests[0];
  eq([afterUpdate.quoteOrPoMissing, afterUpdate.quoteNo, afterUpdate.poNo, afterUpdate.designFiles.length, afterUpdate.quoteFiles, moldQuotePoAnswered(moldStatusObject(afterUpdate))], [true, '', '', 2, [], true], 'after the update (as it stands since 2026-11-05): a request taken before keeps its files as design files, so it has no quotation or PO file and finance has not approved: «missing»; the key says the update is live');
  eq([(await call('requests', quoted('mr-qpo-old'))).reason, (await call('requests', moldRequestBody({id: 'mr-qpo-old', requestedAt: JSON.parse(mock.state.calls.find(c => c.route === 'requests' && c.body.includes('mr-qpo-old')).body).requestedAt, customer, salesman, specs, payment: 'cash'}))).http],
    ['production_only', 200], 'and a resend cannot add the number it dropped (409 production_only); the request without it is the original (200)');
  // New requests: the numbers normalized, refused beyond 60 characters or when not a text, part of the original
  const fresh = (id, extra) => ({...moldRequestBody({id, requestedAt: riyadhIso(Date.now()), customer, salesman, specs, payment: 'deferred'}), ...extra});
  answer = await call('requests', fresh('mr-qpo', {quoteNo: '  Q-٢٠٢٦-0153 ', poNo: ''}));
  eq([answer.http, mock.row('mr-qpo').quoteNo, mock.row('mr-qpo').poNo, answer.json.request.quoteNo, answer.json.request.poNo, answer.json.request.quoteOrPoMissing], [201, 'Q-2026-0153', null, 'Q-2026-0153', '', true], 'a request with its quotation number: still taken and stored normalized ("" is none), but not counted (2026-11-05): missing until a file comes');
  for (const [extra, field] of [[{quoteNo: 'x'.repeat(61)}, 'quoteNo'], [{poNo: 7781}, 'poNo'], [{quoteNo: 'a\u0001b'}, 'quoteNo']]) {
    answer = await call('requests', fresh('mr-qpo-bad', extra));
    eq([answer.kind, answer.http, answer.code, answer.fields, mock.row('mr-qpo-bad')], ['rejected', 400, 'invalid_payload', [field], undefined], JSON.stringify(extra).slice(0, 40) + ': 400 invalid_payload naming ' + field + ', nothing stored');
  }
  eq((await call('requests', fresh('mr-qpo-60', {poNo: '٧'.repeat(60) + ' '}))).http, 201, '60 characters after normalizing pass');
  const original = JSON.parse(mock.state.calls.findLast(c => c.route === 'requests' && c.body.includes('"mr-qpo"') && c.signed).body);
  eq([(await call('requests', original)).http, (await call('requests', {...original, poNo: 'PO-1'})).reason, (await call('requests', {...original, quoteNo: 'Q-other'})).reason, (await call('requests', {...original, quoteNo: undefined})).reason],
    [200, 'production_only', 'production_only', 'production_only'], 'the retry with the same data: 200; adding, changing or removing a number: 409 production_only');
  answer = await call('requests', fresh('mr-qpo-none', {}));
  eq([answer.json.request.quoteOrPoMissing, answer.json.request.quoteNo, answer.json.request.poNo], [true, '', ''], 'a request taken after the update without either: quoteOrPoMissing');
  // The production manager adds or corrects a number in the products application: the status shows it, the original stays the CRM's
  eq([mock.setNumbers('mr-qpo-none', {poNo: ' PO-٧٧٨١ '}).poNo, (await call('status', {ids: ['mr-qpo-none']})).json.requests[0].quoteOrPoMissing], ['PO-7781', true], 'the production manager adds a PO number: stored, still missing (a number alone is not enough)');
  eq((await call('requests', JSON.parse(mock.state.calls.findLast(c => c.route === 'requests' && c.body.includes('"mr-qpo-none"') && c.signed).body))).http, 200, 'the CRM\'s first data (without the number) is still the original a retry is compared with');
  mock.setNumbers('mr-qpo', {quoteNo: 'Q-2026-0153-B'});
  eq([(await call('status', {ids: ['mr-qpo']})).json.requests[0].quoteNo, (await call('requests', original)).http], ['Q-2026-0153-B', 200], 'a correction is production\'s: the status says it, a retry of the original stays 200');
  let pendingNow = (await call('pending', {})).json.requests;
  const pendingItem = id => moldPendingItem(pendingNow.find(item => item.crmRequestId === id));
  eq([pendingItem('mr-qpo').quoteNo, pendingItem('mr-qpo').quoteOrPoMissing, pendingItem('mr-qpo-none').poNo, pendingItem('mr-qpo-60').poNo.length], ['Q-2026-0153-B', true, 'PO-7781', 60], 'pending: each request\'s numbers as production holds them now, missing without a file');
  eq((await call('cancel', {crmRequestId: 'mr-qpo-60', reason: 'x'})).json.request.quoteOrPoMissing, false, 'a cancelled request is never «missing»');
  // design-files: the category, a PDF or an image for a quotation or PO, each kind's own limit, the same crmFileId with another category
  const filed = (crmFileId, name, bytes, category) => call('design-files', moldDesignFileBody({crmRequestId: 'mr-qpo', crmFileId, name, category}, bytes));
  answer = await filed('mdf-q1', 'عرض سعر.pdf', pdf('quotation'), 'quote');
  eq([answer.http, answer.json.file.category, answer.json.request.quoteFiles.map(file => [file.crmFileId, file.category]), answer.json.request.designFiles, answer.json.request.quoteOrPoMissing], [201, 'quote', [['mdf-q1', 'quote']], [], false], 'a quotation file: in quoteFiles with its category, not in designFiles; no longer missing');
  eq([(await filed('mdf-q1', 'عرض سعر.pdf', pdf('quotation'), 'quote')).http, (await filed('mdf-q1', 'عرض سعر.pdf', pdf('quotation'), 'po')).reason, (await filed('mdf-q1', 'عرض سعر.pdf', pdf('quotation'))).reason],
    [200, 'crm_file_id_used', 'crm_file_id_used'], 'the same file with the same category again: 200; the same crmFileId with another category: crm_file_id_used');
  answer = await filed('mdf-p-dwg', 'رسم.dwg', Uint8Array.from([65, 67]), 'po');
  eq([answer.http, answer.fields, answer.reason], [400, ['name'], 'not_document'], 'a drawing as the PO: 400 fields [name], reason not_document');
  eq((await call('design-files', Buffer.from('{"crmRequestId":"mr-qpo","crmFileId":"mdf-c","name":"a.pdf","category":"invoice"}\n%PDF-1.4'))).fields, ['category'], 'another category: 400 fields [category]');
  for (let n = 2; n <= 5; n++) eq((await filed('mdf-q' + n, 'عرض ' + n + '.png', png(4, 4), 'quote')).http, 201, 'quotation file ' + n);
  eq([(await filed('mdf-q6', 'عرض 6.pdf', pdf('6'), 'quote')).reason, (await filed('mdf-p1', 'PO.pdf', pdf('po'), 'po')).http, (await filed('mdf-d1', 'رسم.dwg', Uint8Array.from([65]), undefined)).http], ['too_many_files', 201, 201], 'a sixth quotation file: too_many_files; the PO and the design files have their own places');
  const quoteFileId = mock.row('mr-qpo').designFiles.find(file => file.crmFileId === 'mdf-q1').fileId;
  answer = await call('design-file', {fileId: quoteFileId});
  eq([answer.kind, answer.file.contentType, Buffer.from(answer.file.bytes).equals(Buffer.from(pdf('quotation')))], ['ok', 'application/pdf', true], 'design-file downloads a quotation file by its fileId too');
  const productionPo = mock.addProductionFile('mr-qpo', {name: 'PO الإنتاج.pdf', category: 'po'});
  pendingNow = (await call('pending', {})).json.requests;
  eq([pendingItem('mr-qpo').quoteFiles.length, pendingItem('mr-qpo').poFiles.map(file => [file.source, file.category]), pendingItem('mr-qpo').designFiles.map(file => file.crmFileId)], [5, [['crm', 'po'], ['production', 'po']], ['mdf-d1']], 'pending lists the quotation\'s and PO\'s files (production\'s own too), designFiles the design files only');
  eq((await call('design-file-delete', {crmRequestId: 'mr-qpo', crmFileId: 'mdf-q1'})).json.request.quoteFiles.length, 4, 'a quotation file is deleted as a design file is');
  // 2026-11-05: a quotation's or PO's file attached or deleted keeps the approvals; a design file still undoes them. Missing follows the
  // files (the CRM's and production's own) and finance's approval alone.
  answer = await call('requests', fresh('mr-qpo-keep', {}));
  eq([answer.json.request.quoteOrPoMissing, (await approve('approve', 'mr-qpo-keep')).json.request.approvals.sales !== null], [true, true], 'a new request without a file: missing; the sales manager approves it');
  const keep = (crmFileId, name, bytes, category) => call('design-files', moldDesignFileBody({crmRequestId: 'mr-qpo-keep', crmFileId, name, category}, bytes));
  answer = await keep('mdf-keep-q', 'عرض سعر.pdf', pdf('kept'), 'quote');
  eq([answer.http, answer.json.request.approvals.sales !== null, answer.json.request.waitingStep, answer.json.request.quoteOrPoMissing], [201, true, 'production', false], 'its quotation file attached: the approval stays (it waits for production), no longer missing');
  answer = await keep('mdf-keep-p', 'PO.png', png(4, 4), 'po');
  eq([answer.json.request.approvals.sales !== null, answer.json.request.poFiles.length], [true, 1], 'a PO file too: the approval stays');
  answer = await call('design-file-delete', {crmRequestId: 'mr-qpo-keep', crmFileId: 'mdf-keep-q'});
  eq([answer.json.request.approvals.sales !== null, answer.json.request.quoteOrPoMissing], [true, false], 'the quotation file deleted: the approval stays; the PO file still counts');
  answer = await call('design-file-delete', {crmRequestId: 'mr-qpo-keep', crmFileId: 'mdf-keep-p'});
  eq([answer.json.request.approvals.sales !== null, answer.json.request.quoteOrPoMissing], [true, true], 'the last one deleted: the approval stays, missing again');
  answer = await keep('mdf-keep-d', 'رسم.pdf', pdf('design'), undefined);
  eq([answer.json.request.approvals.sales, answer.json.request.waitingStep], [null, 'sales'], 'a design file still undoes the approvals: back with the sales manager');
  await approve('approve', 'mr-qpo-keep');
  answer = await keep('mdf-keep-q2', 'عرض 2.pdf', pdf('kept 2'), 'quote');
  answer = await call('design-file-delete', {crmRequestId: 'mr-qpo-keep', crmFileId: 'mdf-keep-d'});
  eq([answer.json.request.approvals.sales, answer.json.request.quoteOrPoMissing], [null, false], 'and so does deleting one');
  mock.addProductionFile('mr-qpo-none', {name: 'PO الإنتاج.pdf', category: 'po'});
  eq((await call('status', {ids: ['mr-qpo-none']})).json.requests[0].quoteOrPoMissing, false, 'production\'s own PO file counts as well (its production manager attached it)');
  answer = await call('requests', fresh('mr-qpo-fin', {}));
  mock.approve('mr-qpo-fin', 'sales'); mock.approve('mr-qpo-fin', 'production'); mock.approve('mr-qpo-fin', 'admin');
  eq((await call('status', {ids: ['mr-qpo-fin']})).json.requests[0].quoteOrPoMissing, false, 'finance approved without a file: no longer missing');
  eq([productionPo.category, (await call('design-file', {fileId: productionPo.fileId})).kind], ['po', 'ok'], 'production\'s own PO file is downloaded by its fileId');
  mock.setQuotePo(false);
  ok(mock.state.calls.every(c => !JSON.stringify(c.headers).includes(mock.state.secret)), 'the secret never travels');
} finally { await mock.stop(); }

// ---- the products side's second message of 2026-11-05: the order number comes at production's approval, requestRef is the key
{
  const REF = '0f8e2c1a-5b7d-4c3e-9a1f-2b3c4d5e6f70', OTHER = '6d1f0e2a-3b4c-4d5e-8f90-a1b2c3d4e5f6';
  const base = {crmRequestId: 'mr-ref-1', orderNo: 92, status: 'received', editable: true, stages: {}, delivered: false, revision: 3, waitingStep: 'sales', waitingSince: '2026-11-05T10:00:00+03:00', approvals: {required: true, sales: null, production: null, admin: null}};
  // The status object: the application of today (no requestRef) reads exactly as before; the new one's orderNo null and its requestRef.
  const today = moldStatusObject(base);
  eq([Object.hasOwn(today, 'requestRef'), today.orderNo], [false, 92], 'today\'s status: no requestRef key at all, the number as given');
  const fresh = moldStatusObject({...base, orderNo: null, requestRef: REF});
  eq([fresh.orderNo, fresh.requestRef, fresh.status, fresh.revision], [null, REF, 'received', 3], 'the new application: no number yet, its requestRef');
  eq([moldStatusObject({...base, orderNo: undefined}).orderNo, moldStatusObject({...base, orderNo: 0}).orderNo, moldStatusObject({...base, orderNo: '93'}).orderNo], [null, null, null], 'an absent, zero or text number reads as none');
  // A malformed requestRef is dropped, never the status that carried it.
  for (const odd of ['not-a-uuid', 42, '', '0f8e2c1a5b7d4c3e9a1f2b3c4d5e6f70', REF + 'x']) { const read = moldStatusObject({...base, orderNo: null, requestRef: odd}); eq([read?.status, Object.hasOwn(read || {}, 'requestRef')], ['received', false], 'a malformed requestRef (' + JSON.stringify(odd) + '): ignored, the status kept'); }
  eq(moldStatusObject({...base, crmRequestId: null, orderNo: null, requestRef: REF}, {manual: true}).requestRef, REF, 'a request registered in production (an approval\'s answer): read with its requestRef');
  eq(rules.moldRequestRef(REF.toUpperCase()), REF.toUpperCase(), 'a UUID in capitals is one, sent back as it came');
  // A pending item: read with no number, named by crmRequestId, requestRef or number; one named by nothing is left out.
  const pend = {crmRequestId: null, source: 'manual', customer: {name: 'م'}, salesman: {name: 'س'}, specs: {description: 'd'}};
  eq([moldPendingItem({...pend, orderNo: null, requestRef: REF}).orderNo, moldPendingItem({...pend, orderNo: null, requestRef: REF}).requestRef], [null, REF], 'an item without a number, named by its requestRef');
  eq(moldPendingItem({...pend, requestRef: REF}).orderNo, null, 'orderNo absent: none');
  eq([moldPendingItem({...pend, orderNo: null}), moldPendingItem({...pend, orderNo: null, requestRef: 'bad'})], [null, null], 'nothing names it (no number, no valid requestRef, no crmRequestId): left out');
  eq([moldPendingItem({...pend, crmRequestId: 'mr-x', source: 'crm', orderNo: null}).crmRequestId, Object.hasOwn(moldPendingItem({...pend, orderNo: 101, requestRef: 'bad'}), 'requestRef'), moldPendingItem({...pend, orderNo: 101, requestRef: 'bad'}).orderNo], ['mr-x', false, 101], 'the CRM\'s item by its crmRequestId; a malformed requestRef beside a number: the number names it');
  eq(Object.hasOwn(moldPendingItem({...pend, orderNo: 101}), 'requestRef'), false, 'today\'s item: no requestRef key');
  // The approval body: requestRef for a request registered in production; one name only.
  eq(moldApprovalBody({requestRef: REF, action: 'approve', by: {name: 'm', email: 'm@yourrest.org'}}), {requestRef: REF, action: 'approve', by: {name: 'm', email: 'm@yourrest.org'}}, 'by requestRef: no orderNo in the body');
  for (const [input, field] of [[{requestRef: 'nope', action: 'approve', by: {name: 'm'}}, /requestRef/], [{requestRef: REF, orderNo: 3, action: 'approve', by: {name: 'm'}}, /crmRequestId|requestRef|orderNo/], [{id: 'r', requestRef: REF, action: 'approve', by: {name: 'm'}}, /crmRequestId/]]) { assert.throws(() => moldApprovalBody(input), field); checks++; }

  // The page's rules (lib/mold-requests.ts, transpiled): the key, the target, the links, the number in words, the list for an old page.
  const root = process.cwd(), modules = new Map();
  const load = (filename, source) => {
    if (modules.has(filename)) return modules.get(filename);
    const exports = {}; modules.set(filename, exports);
    const resolve = name => name === '@/portable/mold-rules.mjs' ? rules : name.startsWith('./') ? load(path.join(path.dirname(filename), name) + '.ts') : (() => { throw new Error('not loaded here: ' + name); })();
    vm.runInNewContext(ts.transpileModule(source ?? readFileSync(path.join(root, filename), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}, fileName: filename}).outputText, {exports, require: resolve, Date, JSON}, {filename});
    return exports;
  };
  const lib = load('lib/mold-requests.ts'), same = (a, b, m) => eq(JSON.parse(JSON.stringify(a)), b, m);
  const crmItem = {orderNo: null, requestRef: OTHER, crmRequestId: 'mr-own'}, manualRef = {orderNo: null, requestRef: REF, crmRequestId: null}, manualOld = {orderNo: 95, crmRequestId: null};
  eq([lib.moldPendingKey(crmItem), lib.moldPendingKey(manualRef), lib.moldPendingKey(manualOld)], ['crm:mr-own', 'ref:' + REF, 'order:95'], 'the key: crmRequestId, else requestRef, else (an older application) the number');
  eq(lib.moldPendingKey({...manualRef, orderNo: 100}), lib.moldPendingKey({...manualRef, orderNo: 101}), 'renumbered (or numbered at last): the same key');
  same([lib.moldPendingTarget(crmItem), lib.moldPendingTarget(manualRef), lib.moldPendingTarget(manualOld), lib.moldPendingTarget({orderNo: null, crmRequestId: null})], [{crmRequestId: 'mr-own'}, {requestRef: REF}, {orderNo: 95}, null], 'what the approval sends: never orderNo beside a requestRef');
  const file = {fileId: 7, crmFileId: null, name: 'a.pdf', kind: 'pdf', size: 1, source: 'production', uploadedAt: null};
  eq([lib.moldPendingFiles({...manualRef, designFiles: [file]}).designFiles[0].href, lib.moldPendingFiles({...crmItem, designFiles: [file]}).designFiles[0].href, lib.moldPendingFiles({...manualOld, designFiles: [], poFiles: [file]}).poFiles[0].href],
    ['/api/mold-requests/design-file?ref=' + REF + '&file=7', '/api/mold-requests/design-file?crm=mr-own&file=7', '/api/mold-requests/design-file?order=95&file=7'], 'each item\'s files linked by its name: ref=, crm=, and order= for an older application\'s only');
  const say = (ar, en) => ar + '|' + en;
  eq([lib.moldOrderNoText({orderNo: 100}, say), lib.moldOrderNoText({orderNo: null}, say), lib.moldOrderNoText(null, say), lib.moldOrderNoText({orderNo: null}, say, {cancelled: true})],
    ['100', 'لم يأخذ رقمًا بعد (يأخذه عند اعتماد الإنتاج)|No number yet (given at production approval)', '—', '—'], 'the number in words: as given, «no number yet», none before a status, none for one cancelled without a number');
  eq([lib.moldPendingAgain({...manualRef, waitingSince: '2026-11-05T10:00:00+03:00'}, [{...manualRef, orderNo: null, waitingSince: '2026-11-05T11:00:00+03:00'}]), lib.moldPendingAgain({...manualRef, waitingSince: '2026-11-05T10:00:00+03:00'}, [{...manualOld, waitingSince: '2026-11-05T11:00:00+03:00'}])], [true, false], 'waiting again is told by the key, not by a number');
  // A page loaded before this release: it keys every item by orderNo (React keys, errors, «approved» memory, the approval's body), so it
  // gets only numbered items, each with a whole number, and a list error its own wording names.
  const listed = {items: [{...manualOld, inCrm: false}, {...manualRef, inCrm: false}, {...crmItem, inCrm: true}], error: null, at: '2026-11-05T10:00:00.000Z'};
  const old = lib.moldPendingForOldPage(listed);
  eq([old.items.map(item => item.orderNo), old.error.code, lib.moldPendingForOldPage({...listed, items: [listed.items[0]]}) === undefined], [[95], 'bad_response', false], 'the old page\'s list: numbered items only, and bad_response');
  eq(lib.moldPendingForOldPage({...listed, items: [listed.items[0]]}).error, null, 'all numbered (the application of today): the list as it is');
  eq(lib.moldPendingForOldPage(null), null, 'no list (not a sales manager): none');
  eq([lib.moldPendingForOldPage({...listed, items: [listed.items[0]], unreadable: 1}).error.code, lib.moldPendingForOldPage({...listed, items: [listed.items[0]], unreadable: 1}).items.length], ['bad_response', 1], 'items production sent that could not be read: the old page told the list failed');
  eq(lib.moldPendingUnreadableText(2, (ar, en) => en), '2 request(s) from production could not be read (missing or invalid data) and are not shown; tell the production manager.', 'and this release says how many');
  const released = load('lib/released-mold-requests.ts', execFileSync('git', ['show', '1dcd37e:lib/mold-requests.ts'], {cwd: root, encoding: 'utf8'}));
  eq([released.moldErrorText(old.error.code, (ar) => ar), old.items.every(item => Number.isInteger(item.orderNo) && item.orderNo > 0), new Set(old.items.map(item => item.orderNo)).size], ['رد غير متوقع من تطبيق الإنتاج', true, old.items.length], 'the release live today names that error, and every item it gets has its own whole number');

  // The stand-in: the application of today ignores requestRef; the new numbering numbers at production's approval.
  const refMock = await startProductsMock({requestRefs: true});
  try {
    const fetch = fetchWith(refMock.ca), config = moldConfig({YR_PRODUCTS_API_URL: refMock.url, YR_PRODUCTS_SECRET: refMock.state.secret}), call = (route, body) => callProducts(config, route, body, {fetch});
    refMock.state.nextOrder = 101;
    const first = moldRequestBody({id: 'mr-ref-a', requestedAt: riyadhIso(Date.now()), customer, salesman, specs});
    let answer = await call('requests', first);
    const a = moldStatusObject(answer.json.request);
    eq([answer.http, a.orderNo, rules.MOLD_REQUEST_REF.test(a.requestRef)], [201, null, true], 'a new request: no number, a requestRef');
    answer = await call('requests', first);
    eq([answer.http, moldStatusObject(answer.json.request).requestRef], [200, a.requestRef], 'sent again: 200, the same requestRef');
    eq((await call('status', {ids: ['mr-ref-a']})).json.requests.map(item => [item.orderNo, item.requestRef]), [[null, a.requestRef]], 'status: the same');
    const manual = refMock.registerManual({customerName: 'مسجّل'}), other = refMock.registerManual({customerName: 'آخر'});
    let items = (await call('pending', {})).json.requests.map(item => moldPendingItem(item));
    eq(items.map(item => [item.orderNo, item.requestRef === manual.requestRef || item.requestRef === other.requestRef || item.requestRef === a.requestRef]), [[null, true], [null, true], [null, true]], 'pending: no numbers, every item with its requestRef');
    answer = await call('approval', moldApprovalBody({requestRef: manual.requestRef, action: 'approve', by: {name: 'مدير'}}));
    const approvedManual = moldStatusObject(answer.json.request, {manual: true});
    eq([answer.kind, approvedManual.waitingStep, approvedManual.orderNo, JSON.parse(refMock.state.calls.at(-1).body).orderNo], ['ok', 'production', null, undefined], 'the sales manager approves by requestRef: still no number, none in the body');
    eq([(await call('approval', {requestRef: 'nope', action: 'approve', by: {name: 'm'}})).fields, (await call('approval', {requestRef: OTHER, action: 'approve', by: {name: 'm'}})).kind], [['requestRef'], 'not_found'], 'a malformed requestRef: 400 naming it; an unknown one: 404');
    eq((await call('approval', moldApprovalBody({orderNo: 101, action: 'approve', by: {name: 'm'}}))).kind, 'not_found', 'no request has 101 yet: none is numbered');
    eq(refMock.approve(manual.requestRef, 'production').orderNo, 101, 'production approves: the last number + 1');
    refMock.approve('mr-ref-a', 'sales'); refMock.approve('mr-ref-a', 'production');
    eq(moldStatusObject((await call('status', {ids: ['mr-ref-a']})).json.requests[0]).orderNo, 102, 'the CRM\'s request numbered at production\'s approval: 102');
    eq((await call('approval', moldApprovalBody({orderNo: 101, action: 'withdraw', by: {name: 'm'}}))).kind, 'locked', 'orderNo still names a numbered request (production approved: no withdrawal)');
    const revision = refMock.row('mr-ref-a').revision;
    eq([refMock.renumber(101), refMock.row('mr-ref-a').orderNo, refMock.byRef(manual.requestRef).orderNo, refMock.row('mr-ref-a').revision], [[100, 101], 101, 100, revision], 'renumbered: 101 and up down by one, the same revision');
    eq(moldStatusObject((await call('status', {ids: ['mr-ref-a']})).json.requests[0]).orderNo, 101, 'the next status says the new number');
    assert.throws(() => refMock.remove('mr-ref-a'), /no longer deletes/); checks++;
    assert.throws(() => refMock.removeOrder(101), /no longer deletes/); checks++;
    eq([refMock.cancelHere('mr-ref-a').status, refMock.row('mr-ref-a').orderNo], ['cancelled', 101], 'production cancels it: it keeps its number');
    // The application of today: requestRef unknown to it (as any field it does not know); it numbers at creation as before.
    refMock.setRequestRefs(false);
    answer = await call('requests', moldRequestBody({id: 'mr-ref-b', requestedAt: riyadhIso(Date.now()), customer, salesman, specs}));
    eq([Number.isInteger(answer.json.request.orderNo), Object.hasOwn(answer.json.request, 'requestRef')], [true, false], 'today\'s application: numbered at once, no requestRef');
    eq((await call('approval', {requestRef: other.requestRef, action: 'approve', by: {name: 'm'}})).fields, ['crmRequestId'], 'it ignores requestRef: the body names no request (400)');
  } finally { await refMock.stop(); }
}

console.log(JSON.stringify({ok: true, checks, realProductionTested: false}));
