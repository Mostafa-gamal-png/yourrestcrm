// The mold requests contract, version 1 (docs/MOLD-REQUESTS-CONTRACT-AR.md and its addendum), on the CRM side: the signature against
// the contract's test vector, the settings check, the form checks, the request body, the status object, how answers are read, the
// §6 retry timetable, and every route against a stand-in production API that applies the same checks as the PHP. No real account.
import assert from 'node:assert/strict';
import {request as httpsRequest} from 'node:https';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {MOLD_STAGES, MOLD_LIMITS, MOLD_HALF_BLOCKS, validateMoldSpecs, moldRequestBody, moldApprovalBody, moldStatusObject, readMoldAnswer, moldNextAttempt, riyadhIso, moldText} from '../portable/mold-rules.mjs';
import {moldSignature, moldConfig, callProducts} from '../portable/mold-client.mjs';
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
  eq(moldRequestBody({id: 'r', requestedAt: 'x', customer: {crmNumber: 1, name: 'a', city: 'c'.repeat(101)}, salesman: {name: 'b', email: 'not-an-email'}, specs}).customer, {crmNumber: 1, name: 'a'}, 'an over-long optional city and a bad email are left out, never cut');
  eq([Object.keys(body.customer), Object.keys(body.salesman)], [['crmNumber', 'name', 'address', 'city'], ['crmMemberId', 'name', 'email']], 'only the contract fields: no phone, customer email, visit or sales data (§3)');
  eq(riyadhIso('2026-10-29T07:15:00Z'), '2026-10-29T10:15:00+03:00', 'requestedAt in Riyadh time with its offset');
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
  for (const [input, field] of [[{id: 'r 1', action: 'approve', by: {name: 'm'}}, /crmRequestId/], [{id: 'r', action: 'approved', by: {name: 'm'}}, /action/], [{id: 'r', action: 'approve', by: {name: ' '}}, /by.name/]]) { assert.throws(() => moldApprovalBody(input), field); checks++; }
  eq(readMoldAnswer(201, {request: raw}).kind, 'ok');
  eq(readMoldAnswer(409, {error: {code: 'request_locked', details: {request: raw}}}).request.orderNo, 92, '409 carries the current state');
  eq(readMoldAnswer(404, {error: {code: 'not_found'}}).kind, 'not_found');
  eq(readMoldAnswer(400, {error: {code: 'invalid_payload', fields: ['specs.moldWidth']}}), {kind: 'rejected', code: 'invalid_payload', fields: ['specs.moldWidth']}, 'a refusal names its fields');
  eq([readMoldAnswer(503, {error: {code: 'not_configured'}}).kind, readMoldAnswer(401, {error: {code: 'stale_timestamp'}}).kind, readMoldAnswer(500, null).kind, readMoldAnswer(502, null).code], ['retry', 'retry', 'retry', 'http_502'], 'everything else is tried again');
}

// ---- §6: 1 minute, 5, 30, 2 hours, then every 2 hours up to 24 hours
{
  const first = '2026-11-01T08:00:00.000Z', at = minutes => new Date(Date.parse(first) + minutes * 60_000).toISOString();
  eq([moldNextAttempt(1, first, first), moldNextAttempt(2, first, at(1)), moldNextAttempt(3, first, at(6)), moldNextAttempt(4, first, at(36)), moldNextAttempt(5, first, at(156))], [at(1), at(6), at(36), at(156), at(276)], 'the timetable');
  eq(moldNextAttempt(9, first, at(22 * 60)), at(24 * 60), 'the last try falls at 24 hours');
  eq(moldNextAttempt(10, first, at(23 * 60)), null, 'nothing after 24 hours: the resend button is the way on');
}

// ---- every route against the stand-in production API
function fetchWith(caFile) {
  const authority = readFileSync(caFile);
  return (url, init) => new Promise((resolve, reject) => {
    const req = httpsRequest(url, {method: init.method, headers: init.headers, ca: authority, signal: init.signal}, res => {
      const parts = []; res.on('data', part => parts.push(part)); res.on('end', () => { const bytes = Buffer.concat(parts); resolve({status: res.statusCode, arrayBuffer: async () => bytes}); });
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
  answer = await call('requests', {...body, specs: {...body.specs, quantity: 2}});
  eq([answer.http, answer.json.request.revision, answer.json.request.waitingStep, answer.json.request.approvals.sales], [200, 5, 'sales', null], 'an edit while received: 200, revision up, the approvals given are undone');
  await approve('approve'); mock.approve('mr-1', 'production');
  answer = await approve('withdraw');
  eq([answer.kind, answer.code, answer.request.waitingStep], ['locked', 'request_locked', 'admin'], 'after production approved: the withdrawal is refused with the current state');
  mock.approve('mr-1', 'admin');
  eq((await call('status', {ids: ['mr-1']})).json.requests[0].status, 'confirmed', 'all three approvals: confirmed');
  eq((await call('approval', moldApprovalBody({id: 'mr-none', action: 'approve', by: {name: 'm'}}))).kind, 'not_found', 'an unknown request: 404');
  mock.produce('mr-1', {stages: ['laserCutting', 'box'], moldSerial: '093', productionDate: '2026-11-01'});
  answer = await call('requests', {...body, specs: {...body.specs, quantity: 3}});
  eq([answer.kind, answer.code, answer.request.status, answer.request.editable, answer.request.stagesDone], ['locked', 'request_locked', 'in_production', false, 2], 'production started: 409 request_locked with the current state');
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
  ok(mock.state.calls.every(c => !JSON.stringify(c.headers).includes(mock.state.secret)), 'the secret never travels');
} finally { await mock.stop(); }

console.log(JSON.stringify({ok: true, checks, realProductionTested: false}));
