// The mold requests contract, version 1 (docs/MOLD-REQUESTS-CONTRACT-AR.md and its addendum), on the CRM side: the signature against
// the contract's test vector, the settings check, the form checks, the request body, the status object, how answers are read, the
// §6 retry timetable, the design files of 2026-11-02 (names, bytes, pixels, the body, designFiles), and every route against a stand-in
// production API that applies the same checks as the PHP. Since 2026-11-02 a sent request's data is edited by the production manager only:
// the requests route's 409 production_only, its text, which answers prove production never stored a send, and the edit rule (the
// portable rule and lib/mold-requests.ts's permission, transpiled). Since 2026-11-03 (yourrest-products): the third approval is shown
// as «اعتماد المالية» (still keyed admin); `payment` (cash or deferred) beside customer, salesman and specs, required for a new request,
// sent only when the request has it (an older request is resent exactly as first sent), refused by production otherwise (fields
// ['payment']) and listed by pending; and a cancellation the production manager restores, after which a reason used before answers 200
// with the request as it is and only a new reason cancels it. Synthetic files only; no real account.
import assert from 'node:assert/strict';
import {request as httpsRequest} from 'node:https';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {MOLD_STAGES, MOLD_LIMITS, MOLD_HALF_BLOCKS, MOLD_CUSTOMERS_BODY_LIMIT, validateMoldSpecs, moldRequestBody, moldApprovalBody, moldApprovalRefusal, moldPendingItem, moldStatusObject, readMoldAnswer, moldNextAttempt, riyadhIso, moldText, sheetCity, moldRequestCity, moldCustomerEntry, moldCustomerCalls,
  MOLD_DESIGN_EXTENSIONS, MOLD_DESIGN_MAX_BYTES, MOLD_DESIGN_MAX_FILES, MOLD_DESIGN_MAX_PIXELS, MOLD_DESIGN_REASONS, MOLD_DESIGN_PLACE_REASONS, moldDesignName, moldDesignDisplayName, moldImageSize, moldDesignFileCheck, moldDesignContentType, moldDispositionName, moldContentDisposition, moldDesignFileBody, moldDesignFileEntry,
  MOLD_PRODUCTION_ONLY, MOLD_PRODUCTION_ONLY_TEXT, moldAnswerNotStored, moldNeverSent, MOLD_PAYMENTS, MOLD_PAYMENT_REQUIRED, MOLD_WAITING_STEPS, MOLD_APPROVAL_STEPS, moldPayment, moldCancelReasonKey, moldCancelReasonUsed} from '../portable/mold-rules.mjs';
import * as rules from '../portable/mold-rules.mjs';
import {moldSignature, moldConfig, callProducts, moldRouteTimeout} from '../portable/mold-client.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';

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
  eq(moldStatusObject(raw).designFiles, [{fileId: 501, crmFileId: 'mdf-1', name: 'رسم.pdf', kind: 'pdf', size: 1200, source: 'crm', uploadedAt: '2026-11-02T10:00:00+03:00'}, {fileId: 'p-9', crmFileId: null, name: 'تصميم الإنتاج.dwg', kind: 'other', size: null, source: 'production', uploadedAt: null}],
    'designFiles: the contract fields of the valid entries, each fileId once; production\'s file has no crmFileId; an unknown kind is shown as other');
  eq([moldStatusObject({...raw, designFiles: undefined}).designFiles, moldStatusObject({...raw, designFiles: []}).designFiles, moldDesignFileEntry({fileId: 3, crmFileId: 'mdf-3', name: 'x.pdf', kind: 'pdf', source: 'crm'}).size], [null, [], null], 'none sent (an older application) is null; an empty list is empty');
  const pending = {orderNo: 101, crmRequestId: null, source: 'manual', customer: {}, salesman: {}, specs: {}};
  eq([moldPendingItem(pending).designFiles, moldPendingItem({...pending, designFiles: listed}).designFiles.map(file => file.fileId)], [[], [501, 'p-9']], 'a pending item carries its design files, those registered in production too');
  eq(readMoldAnswer(400, {error: {code: 'invalid_payload', fields: ['file'], details: {reason: 'not_pdf'}}}), {kind: 'rejected', code: 'invalid_payload', fields: ['file'], reason: 'not_pdf'}, 'a refused file names its reason');
  eq([readMoldAnswer(400, {error: {code: 'invalid_payload', fields: ['crmFileId'], details: {reason: 'too_many_files'}}}), readMoldAnswer(400, {error: {code: 'invalid_payload', fields: ['crmFileId'], details: {reason: 'crm_file_id_used'}}})],
    [{kind: 'rejected', code: 'invalid_payload', fields: ['crmFileId'], reason: 'too_many_files'}, {kind: 'rejected', code: 'invalid_payload', fields: ['crmFileId'], reason: 'crm_file_id_used'}], 'PR #27: a refusal for the file\'s place names crmFileId and its reason, final like the others');
  eq([readMoldAnswer(400, {error: {code: 'invalid_payload', fields: ['file'], details: {reason: '<b>'}}}).reason, readMoldAnswer(413, {error: {code: 'payload_too_large'}}).kind, readMoldAnswer(404, {error: {code: 'not_found'}}).kind], [undefined, 'rejected', 'not_found'], 'a reason that is not a word is not read; 413 and 404 are final');
  eq([moldRouteTimeout('design-files'), moldRouteTimeout('design-file'), moldRouteTimeout('design-file-delete'), moldRouteTimeout('requests')], [120_000, 120_000, 10_000, 10_000], '120 seconds for the two file routes, 10 for the rest');
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
  ok(mock.state.calls.every(c => !JSON.stringify(c.headers).includes(mock.state.secret)), 'the secret never travels');
} finally { await mock.stop(); }

console.log(JSON.stringify({ok: true, checks, realProductionTested: false}));
