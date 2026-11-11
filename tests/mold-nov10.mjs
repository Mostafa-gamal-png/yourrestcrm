// The products update of 2026-11-10 (schema 17; docs/MOLD-PRODUCTS-MESSAGE-2026-11-10-AR.md and the products team's reply in the
// contract), on the CRM side without a build:
// - a deferred payment's terms (paymentTerms): the three codes and their words, the requests body (right after payment, only when a
//   request carries them, an older request byte for byte; refused with cash or an unknown code), the status object and the pending item
//   (read only when the answer carries the key);
// - the sales manager's acknowledgement (termsAccepted): the approval body (approve only, true only), approvals.sales.termsAccepted read
//   (true only; null or absent says nothing);
// - finance's return (returned): read from a status object and a pending item ({by: 'finance', name, reason, at, correctedAt}, or null),
//   who may correct a returned request (its requester, until the sales manager approves it again, never once cancelled), the hold of a
//   correction that waits for the customer's signature, the files' counts (the signed copies leave the originals' places; 20/10/10 for
//   the copies once the update is known), the words;
// - the stand-in production API (scripts/lib/products-mock.mjs) in both modes against the reply: the application of today ignores the new
//   keys and answers a changed body with 409 production_only; the updated one validates paymentTerms and termsAccepted, keeps and echoes
//   them, sends `returned` with finance's name and an ISO +03:00 time, takes a correction of a returned request once (corrected true,
//   linked false, requestedAt kept), the same correction again changes nothing (corrected false), `corrected` in every answer, a sales
//   approval clears `returned`, and the files' limits are 20/10/10.
// Synthetic data only; no real account, no network beyond the local stand-in.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {request as httpsRequest} from 'node:https';
import ts from 'typescript';
import * as rules from '../portable/mold-rules.mjs';
import {moldConfig, callProducts} from '../portable/mold-client.mjs';
import {startProductsMock, validateRequest} from '../scripts/lib/products-mock.mjs';

let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'mold-nov10-')), seen = new Set();
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
fs.writeFileSync(path.join(out, 'env.mjs'), 'export const env={};');
fs.writeFileSync(path.join(out, 'auth.mjs'), 'export async function getApplicationUser(){return null;}');
function compile(relative) {
  if (seen.has(relative)) return; seen.add(relative);
  const source = path.join(root, relative), dest = path.join(out, relative.replace(/\.tsx?$/, '.mjs'));
  fs.mkdirSync(path.dirname(dest), {recursive: true});
  let code = ts.transpileModule(fs.readFileSync(source, 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
  code = code.replace(/from (['"])([^'"]+)\1/g, (match, quote, imported) => {
    if (imported === 'cloudflare:workers') return 'from ' + JSON.stringify(path.join(out, 'env.mjs'));
    if (imported === '@/app/application-auth') return 'from ' + JSON.stringify(path.join(out, 'auth.mjs'));
    if (!imported.startsWith('.') && !imported.startsWith('@/')) return match;
    let target = imported.startsWith('@/') ? imported.slice(2) : path.relative(root, path.resolve(path.dirname(source), imported));
    if (target.endsWith('.mjs')) return 'from ' + JSON.stringify(path.join(root, target));
    if (!/\.tsx?$/.test(target)) target += fs.existsSync(path.join(root, target + '.ts')) ? '.ts' : '.tsx';
    compile(target); return 'from ' + JSON.stringify(path.join(out, target.replace(/\.tsx?$/, '.mjs')));
  });
  fs.writeFileSync(dest, code);
}
compile('lib/mold-requests.ts');
const lib = await import(path.join(out, 'lib/mold-requests.mjs'));

const at = '2026-11-10T09:00:00+03:00';
const customer = {crmNumber: 27, name: 'مصنع زايد للطابوق', address: 'الدمام', city: 'Damam - الدمام'};
const salesman = {crmMemberId: 'mem-1', name: 'أحمد عبد العزيز', email: 'name@yourrest.org'};
const specs = {description: 'قالب بلوك 20 سم', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: '', quantity: 1, designUrl: '', notes: ''};
const request = extra => ({id: 'mr-00000000-0000-4000-8000-000000000001', requestedAt: at, customer, salesman, specs, ...extra});

// ---- paymentTerms: the codes, their words, the body
{
  check(rules.MOLD_PAYMENT_TERMS, {advance_before_shipping: 'دفعة مقدمة واستكمال باقي المبلغ قبل الترحيل', advance_after_shipping: 'دفعة مقدمة واستكمال باقي المبلغ بعد الترحيل', advance_credit_limit: 'دفعة مقدمة واستكمال باقي المبلغ حد ائتماني'},
    'the three codes of the products message, with the owner\'s words');
  check(Object.isFrozen(rules.MOLD_PAYMENT_TERMS), true, 'not to be changed at run time');
  check(['advance_before_shipping', 'advance_after_shipping', 'advance_credit_limit', 'ADVANCE_BEFORE_SHIPPING', ' advance_credit_limit', '', 'toString', '__proto__', 'hasOwnProperty', 1, null, undefined, {}].map(rules.moldPaymentTerms),
    ['advance_before_shipping', 'advance_after_shipping', 'advance_credit_limit', null, null, null, null, null, null, null, null, null, null], 'a code is one of the three exactly (no case folding, no trimming, nothing inherited)');
  check([rules.MOLD_PAYMENT_TERMS_REQUIRED, rules.MOLD_PAYMENT_TERMS_REFRESH, rules.MOLD_PAYMENT_TERMS_CASH, rules.MOLD_TERMS_ACCEPT],
    ['اختر طريقة الدفع المتفق عليها', 'حدّث الصفحة واختر طريقة الدفع المتفق عليها', 'طريقة الدفع المتفق عليها للدفع الآجل فقط', 'تمت الموافقة على التصنيع بشروط الدفع المذكورة وقت الإستلام'], 'the words of the refusals and the acknowledgement');
  const cash = rules.moldRequestBody(request({payment: 'cash'})), deferred = rules.moldRequestBody(request({payment: 'deferred'}));
  check([JSON.stringify(rules.moldRequestBody(request({payment: 'cash', paymentTerms: undefined}))), JSON.stringify(rules.moldRequestBody(request({payment: 'deferred', paymentTerms: null})))], [JSON.stringify(cash), JSON.stringify(deferred)],
    'no terms (undefined or null): the body byte for byte as before (an older request, a request kept in the CRM before the update is known)');
  check([Object.hasOwn(cash, 'paymentTerms'), Object.hasOwn(deferred, 'paymentTerms')], [false, false], 'and no key');
  const withTerms = rules.moldRequestBody(request({payment: 'deferred', paymentTerms: 'advance_credit_limit', quoteNo: 'Q-7'}));
  check(Object.keys(withTerms).slice(Object.keys(withTerms).indexOf('payment')), ['payment', 'paymentTerms', 'quoteNo'], 'right after payment, before the numbers');
  check(JSON.stringify(withTerms).includes('"payment":"deferred","paymentTerms":"advance_credit_limit"'), true, 'as production reads it');
  for (const [extra, why] of [[{payment: 'cash', paymentTerms: 'advance_credit_limit'}, 'with cash'], [{paymentTerms: 'advance_credit_limit'}, 'without a payment'], [{payment: 'deferred', paymentTerms: 'later'}, 'an unknown code'], [{payment: 'deferred', paymentTerms: 7}, 'not a text']])
    check((() => { try { rules.moldRequestBody(request(extra)); return 'built'; } catch (error) { return error.message; } })(), 'paymentTerms', 'never built ' + why + ' (production would refuse it: 400 [\'paymentTerms\'])');
}

// ---- termsAccepted: the approval body
{
  const by = {name: 'مدير المبيعات', email: 'sm@yourrest.org'}, id = 'mr-00000000-0000-4000-8000-000000000001';
  check(rules.moldApprovalBody({id, action: 'approve', by}), {crmRequestId: id, action: 'approve', by}, 'without it: as before');
  const body = rules.moldApprovalBody({id, action: 'approve', by, termsAccepted: true});
  check([body, Object.keys(body).at(-1)], [{crmRequestId: id, action: 'approve', by, termsAccepted: true}, 'termsAccepted'], 'an approval with the acknowledgement: termsAccepted true, last');
  check([rules.moldApprovalBody({id, action: 'withdraw', by, termsAccepted: true}), rules.moldApprovalBody({id, action: 'approve', by, termsAccepted: 'true'}), rules.moldApprovalBody({id, action: 'approve', by, termsAccepted: false})],
    [{crmRequestId: id, action: 'withdraw', by}, {crmRequestId: id, action: 'approve', by}, {crmRequestId: id, action: 'approve', by}], 'never with a withdrawal, never anything but true');
  check(rules.moldApprovalBody({requestRef: '0f8e2c1a-5b7d-4c3e-9a1f-2b3c4d5e6f70', action: 'approve', by, termsAccepted: true}).termsAccepted, true, 'by its requestRef too (one registered in production)');
}

// ---- the status object and the pending item: the keys read only when the answer carries them
{
  const base = {crmRequestId: 'mr-00000000-0000-4000-8000-000000000001', orderNo: 92, status: 'received', editable: true, stages: {}, stagesDone: 0, stagesTotal: 7, waitingStep: 'sales', waitingSince: at, revision: 3,
    approvals: {required: true, sales: null, production: null, admin: null}};
  const before = rules.moldStatusObject(base);
  check([Object.hasOwn(before, 'paymentTerms'), Object.hasOwn(before, 'returned')], [false, false], 'the application before: neither key (read exactly as before)');
  const nov10 = rules.moldStatusObject({...base, paymentTerms: null, returned: null});
  check([nov10.paymentTerms, nov10.returned], [null, null], 'the updated application: both keys, null');
  const reply = {...base, paymentTerms: 'advance_before_shipping', returned: {by: 'finance', name: 'finance@yourrest.org', reason: '  الحد الائتماني للعميل لا يسمح بالمبلغ  ', at: '2026-11-10T09:50:20+03:00', correctedAt: null}};
  check(rules.moldStatusObject(reply).returned, {by: 'finance', name: 'finance@yourrest.org', reason: 'الحد الائتماني للعميل لا يسمح بالمبلغ', at: '2026-11-10T09:50:20+03:00', correctedAt: null}, 'the products team\'s example: read whole, the reason trimmed, the time as sent (ISO +03:00)');
  check(rules.moldStatusObject(reply).paymentTerms, 'advance_before_shipping', 'the terms');
  check([rules.moldReturned({by: 'someone', reason: 'سبب'}).by, rules.moldReturned({reason: 'ر'.repeat(600)}).reason.length, Object.hasOwn(rules.moldReturned({reason: 'سبب'}), 'name'), rules.moldReturned({reason: 'سبب', correctedAt: '2026-11-10T10:00:00+03:00'}).correctedAt],
    ['finance', 500, false, '2026-11-10T10:00:00+03:00'], 'always «finance»; the reason capped at 500 characters; no name when none; correctedAt read');
  check([null, 'نص', [], {reason: ''}, {reason: '   '}, {reason: 5}, {name: 'x'}].map(rules.moldReturned), [null, null, null, null, null, null, null], 'anything but an object with a reason: not returned');
  check([rules.moldStatusObject({...base, paymentTerms: 'later', returned: 'yes'}).paymentTerms, rules.moldStatusObject({...base, paymentTerms: 'later', returned: 'yes'}).returned], [null, null], 'an unknown code or a returned that is not one: null');
  const approvals = given => rules.moldStatusObject({...base, approvals: {required: true, sales: given, production: null, admin: null}}).approvals.sales;
  check([approvals({at, by: 'sm', termsAccepted: true}), approvals({at, by: 'sm', termsAccepted: null}), approvals({at, by: 'sm', termsAccepted: 'true'}), approvals({at, by: 'sm'})],
    [{at, by: 'sm', termsAccepted: true}, {at, by: 'sm'}, {at, by: 'sm'}, {at, by: 'sm'}], 'approvals.sales.termsAccepted: true read; null (absent there), a text or nothing: no key');
  const item = {crmRequestId: base.crmRequestId, requestRef: '0f8e2c1a-5b7d-4c3e-9a1f-2b3c4d5e6f70', orderNo: null, source: 'crm', requestedAt: at, waitingSince: at, customer: {crmNumber: 27, name: 'م'}, salesman: {name: 'س'}, specs: {description: 'd'}, payment: 'deferred', revision: 2};
  const oldItem = rules.moldPendingItem(item), newItem = rules.moldPendingItem({...item, paymentTerms: 'advance_after_shipping', returned: reply.returned});
  check([Object.hasOwn(oldItem, 'paymentTerms'), Object.hasOwn(oldItem, 'returned'), newItem.paymentTerms, newItem.returned.reason], [false, false, 'advance_after_shipping', 'الحد الائتماني للعميل لا يسمح بالمبلغ'], 'a pending item: the same reading');
}

// ---- the CRM's rules: who corrects, holds, places, words
{
  const data = {requestedAt: at, customer, salesman, specs, payment: 'deferred', paymentTerms: 'advance_before_shipping', designRequired: true};
  const returned = {by: 'finance', name: 'finance@yourrest.org', reason: 'ناقص', at, correctedAt: null};
  const remote = change => ({crmRequestId: 'mr-1', orderNo: 92, status: 'received', editable: true, waitingStep: 'sales', approvals: {required: true, sales: null, production: null, admin: null}, stages: {}, stagesDone: 0, stagesTotal: 7, revision: 4, designFiles: [], returned, ...change});
  const row = change => ({id: 'mr-1', memberId: 'rep', customerId: 'east1', legacyOrderNo: null, data, accepted: data, cancelledAt: null, cancelReason: '', outbox: null, attempts: 0, firstFailedAt: null, nextAttemptAt: null, lastAttemptAt: at, lastError: null, remote: remote(), remoteAt: at, version: 3, ...change});
  check([lib.moldReturnedNow(row()), lib.moldReturnedNow(row({cancelledAt: at})), lib.moldReturnedNow(row({remote: remote({status: 'cancelled'})})), lib.moldReturnedNow(row({remote: remote({returned: null})})), lib.moldReturnedNow(row({remote: remote({returned: undefined})}))],
    [true, false, false, false, false], 'returned now: production says so and nobody cancelled it');
  const rep = {id: 'rep', role: 'rep'}, other = {id: 'rep2', role: 'rep'}, manager = {id: 'sm', role: 'manager'};
  const mine = lib.moldPermissions(row(), rep, []);
  check([mine.edit, mine.correct, mine.cancel, Object.hasOwn(mine, 'link')], [false, true, true, false], 'its requester: no edit (production holds it) but «تعديل وإعادة الإرسال»');
  check([lib.moldPermissions(row(), other, []).correct, lib.moldPermissions(row(), manager, [], true).correct, lib.moldPermissions(row(), manager, [], true).approve], [false, false, true], 'another representative or the sales manager: no correction; the manager approves it again');
  check([Object.hasOwn(lib.moldPermissions(row({remote: remote({returned: null})}), rep, []), 'correct'), Object.hasOwn(lib.moldPermissions(row({cancelledAt: at}), rep, []), 'correct')], [false, false], 'not returned (or cancelled): no such key, the permissions read as before');
  const waiting = row({outbox: 'send', data: {...data, awaitsSignature: true, signatureLink: {hash: 'h', sentAt: at, expiresAt: '2099-01-01T00:00:00.000Z', by: 'rep'}}});
  check([lib.moldPermissions(waiting, rep, []).link, lib.moldPermissions(waiting, rep, []).resend, lib.moldHeldFor(waiting, [])], [true, false, 'customer_signature'], 'a correction waiting for the customer\'s link: the requester renews or signs on the device; held, never resent');
  check(lib.moldPermissions(row({outbox: 'send', remote: remote({returned: null}), data: {...data, awaitsSignature: true}}), rep, []).link, false, 'the same once the sales manager approved it again (nothing to correct): no link');
  // The originals' places: the signed copies (mdc-…) take none; the copies' own limits.
  const file = (id, change = {}) => ({id, requestId: 'mr-1', memberId: 'rep', name: id + '.pdf', kind: 'pdf', category: 'design', deletedAt: null, outbox: null, sentAt: at, nextAttemptAt: null, lastError: null, lastAttemptAt: at, ...change});
  const files = [file('mdf-1'), file('mdf-2'), file('mdc-mdf-1-0123456789abcdef0123456'), file('mdf-3', {category: 'quote'})];
  const listed = row({remote: remote({designFiles: [{fileId: 9, crmFileId: 'mdc-mdf-9-0123456789abcdef0123456', name: 'x - موقّع.pdf', kind: 'pdf', category: 'design', source: 'crm'}, {fileId: 10, crmFileId: null, name: 'p.pdf', kind: 'pdf', category: 'design', source: 'production'}]})});
  check([lib.moldDesignCount(listed, files, 'design'), lib.moldDesignCount(listed, files, 'design', {originals: true})], [{crm: 3, production: 2, max: 10}, {crm: 2, production: 1, max: 10}], 'every file, or the originals only (production\'s own file counts, a copy production lists does not)');
  check([['design', 'quote', 'po'].map(category => lib.moldSignedCopyMax(category, false)), ['design', 'quote', 'po'].map(category => lib.moldSignedCopyMax(category, true))], [[10, 5, 5], [20, 10, 10]], 'a signed copy fits within production\'s limits: 20/10/10 once its update is known, else 10/5/5');
  check(rules.MOLD_CATEGORY_MAX_FILES, {design: 10, quote: 5, po: 5}, 'the originals keep today\'s limits');
  // Words.
  check([lib.moldReturnedName({name: 'finance@yourrest.org'}), lib.moldReturnedName({name: 'finance'}), lib.moldReturnedName({name: 'المالية'}), lib.moldReturnedName({})], ['finance@yourrest.org', '', '', ''], 'the name only when it says more than «finance»');
  check([lib.MOLD_RETURNED_TEXT.badge[0], lib.MOLD_RETURNED_TEXT.title[0], lib.MOLD_RETURNED_TEXT.correct[0], lib.MOLD_SIGN_LINK_TEXT.copyRefused[0]], ['أعادتها المالية', 'أعادته المالية', 'تعديل وإعادة الإرسال', 'لم تُرسل: رفض الإنتاج عدد الملفات'], 'the owner\'s words');
  check(Object.entries(lib.moldPaymentTermsNames).map(([code, [ar]]) => [code, ar]), Object.entries(rules.MOLD_PAYMENT_TERMS), 'the page\'s names are the rules\' words');
  check(lib.MOLD_TERMS_ACCEPT_TEXT[0], rules.MOLD_TERMS_ACCEPT, 'the box says the acknowledgement production keeps');
}

// ---- the sources: the page and the server send what they should
{
  const page = fs.readFileSync(path.join(root, 'app/mold-requests.tsx'), 'utf8'), server = fs.readFileSync(path.join(root, 'lib/mold-requests-server.ts'), 'utf8'), route = fs.readFileSync(path.join(root, 'app/api/mold-requests/route.ts'), 'utf8');
  check([(page.match(/action:'approve',id:view\.id,termsAccepted:true/g) || []).length, (page.match(/disabled=\{[^}]*!termsAccepted\}/g) || []).length, (page.match(/disabled=\{[^}]*!accepted\[key\]\}/g) || []).length], [1, 1, 1], 'the page sends the acknowledgement with every approval, and its button waits for the box (the sheet and the list)');
  check(/approve-order/.test(page) && /termsAccepted:true/.test(page.slice(page.lastIndexOf('const run='), page.lastIndexOf('const run=') + 1200)), true, 'the list\'s approval too');
  check(server.includes("Object.hasOwn(value,'paymentTerms')&&Object.hasOwn(value,'returned')"), true, 'the update is learned from an answer that carries both keys');
  check((route.match(/moldNov10Known\(c\.db\)/g) || []).length, 2, 'the acknowledgement goes to production only once the update is known (both approval paths)');
}

// ---- the stand-in, field by field (validateRequest)
{
  const body = extra => ({crmRequestId: 'mr-1', requestedAt: at, customer, salesman, specs, payment: 'deferred', ...extra});
  const refused = (extra, options) => { try { validateRequest(body(extra), Date.parse(at), options); return null; } catch (error) { return error.fields; } };
  check([refused({paymentTerms: 'advance_credit_limit'}, {nov10: false}), validateRequest(body({paymentTerms: 'nonsense'}), Date.parse(at)).paymentTerms], [null, null], 'the application of today ignores the key, whatever it holds');
  check([refused({paymentTerms: 'later'}, {nov10: true}), refused({payment: 'cash', paymentTerms: 'advance_credit_limit'}, {nov10: true}), refused({payment: undefined, paymentTerms: 'advance_credit_limit'}, {nov10: true})],
    [['paymentTerms'], ['paymentTerms'], ['paymentTerms']], 'the updated one: 400 [\'paymentTerms\'] for another value, with cash, or without a payment (as the reply says)');
  check([validateRequest(body({paymentTerms: 'advance_credit_limit'}), Date.parse(at), {nov10: true}).paymentTerms, validateRequest(body({}), Date.parse(at), {nov10: true}).paymentTerms], ['advance_credit_limit', null], 'kept; absent: null');
}

// ---- the stand-in over HTTPS, the two modes
function fetchWith(caFile) {
  const authority = fs.readFileSync(caFile);
  return (url, init) => new Promise((resolve, reject) => {
    const req = httpsRequest(url, {method: init.method, headers: init.headers, ca: authority, signal: init.signal}, res => {
      const headers = new Headers(Object.entries(res.headers).flatMap(([key, value]) => Array.isArray(value) ? value.map(item => [key, item]) : [[key, value]]));
      const parts = []; res.on('data', part => parts.push(part)); res.on('end', () => { const bytes = Buffer.concat(parts); resolve({status: res.statusCode, headers, arrayBuffer: async () => bytes}); });
    });
    req.on('error', reject);
    req.end(init.body);
  });
}
const mock = await startProductsMock();
try {
  const fetch = fetchWith(mock.ca), config = moldConfig({YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret}), call = (route, body) => callProducts(config, route, body, {fetch});
  const id = n => 'mr-00000000-0000-4000-8000-00000000000' + n, by = {name: 'مدير المبيعات', email: 'sm@yourrest.org'};
  const send = (n, extra = {}) => call('requests', rules.moldRequestBody({...request({payment: 'deferred'}), id: id(n), ...extra}));
  // The application of today.
  let answer = await send(1, {paymentTerms: 'advance_before_shipping'});
  check([answer.http, Object.hasOwn(answer.json.request, 'paymentTerms'), Object.hasOwn(answer.json.request, 'returned'), Object.hasOwn(answer.json, 'corrected')], [201, false, false, false], 'today: the terms ignored, no new key in the answer');
  answer = await call('approval', {...rules.moldApprovalBody({id: id(1), action: 'approve', by}), termsAccepted: 'yes'});
  check([answer.kind, Object.hasOwn(answer.json.request.approvals.sales, 'termsAccepted')], ['ok', false], 'today: termsAccepted ignored, whatever it holds');
  answer = await send(1, {paymentTerms: 'advance_before_shipping', specs: {...specs, quantity: 4}});
  check([answer.kind, answer.reason], ['locked', 'production_only'], 'today: a changed body is 409 production_only');
  check((() => { try { mock.financeReturn(id(1)); return 'returned'; } catch { return 'refused'; } })(), 'refused', 'and finance returns nothing');
  // The updated application.
  mock.setNov10(true);
  answer = await send(2, {paymentTerms: 'advance_after_shipping'});
  check([answer.http, answer.json.created, answer.json.linked, answer.json.corrected, answer.json.request.paymentTerms, answer.json.request.returned], [201, true, false, false, 'advance_after_shipping', null], 'updated: kept and echoed; returned null; corrected false');
  check((await send(3, {payment: 'cash'})).json.request.paymentTerms, null, 'none: null');
  const raw = async body => { const answer = await call('requests', body); return [answer.http, answer.fields]; };
  check(await raw({...rules.moldRequestBody({...request({payment: 'cash'}), id: id(4)}), paymentTerms: 'advance_credit_limit'}), [400, ['paymentTerms']], 'updated: with cash refused by its field');
  check(await raw({...rules.moldRequestBody({...request({payment: 'deferred'}), id: id(4)}), paymentTerms: 'later'}), [400, ['paymentTerms']], 'an unknown code refused by its field');
  answer = await send(1, {});
  check([answer.http, answer.json.created, answer.json.corrected, answer.json.request.paymentTerms], [200, false, false, null], 'a request first sent without the terms, resent without them: the same request (the terms enter the comparison only when carried)');
  check((await send(1, {paymentTerms: 'advance_before_shipping'})).reason, 'production_only', 'resent with them: other data, 409 production_only');
  answer = await call('approval', {...rules.moldApprovalBody({id: id(2), action: 'approve', by}), termsAccepted: 'yes'});
  check([answer.http, answer.fields], [400, ['termsAccepted']], 'termsAccepted that is not a boolean: 400 [\'termsAccepted\']');
  answer = await call('approval', rules.moldApprovalBody({id: id(2), action: 'approve', by, termsAccepted: true}));
  check([answer.json.request.approvals.sales.termsAccepted, answer.json.request.waitingStep], [true, 'production'], 'kept and echoed in approvals.sales.termsAccepted');
  answer = await call('approval', rules.moldApprovalBody({id: id(3), action: 'approve', by}));
  check(answer.json.request.approvals.sales.termsAccepted, null, 'absent: null');
  check((() => { try { mock.financeReturn(id(2)); return 'returned'; } catch { return 'refused'; } })(), 'refused', 'finance returns only what waits for it');
  mock.approve(id(2), 'production');
  const before = mock.row(id(2)).orderNo, returned = mock.financeReturn(id(2), 'الحد الائتماني للعميل لا يسمح بالمبلغ');
  check([returned.status, returned.waitingStep, returned.approvals, returned.orderNo, returned.returned.by, returned.returned.name, returned.returned.reason, returned.returned.correctedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+03:00$/.test(returned.returned.at)],
    ['received', 'sales', {required: true, sales: null, production: null, admin: null}, before, 'finance', 'finance@yourrest.org', 'الحد الائتماني للعميل لا يسمح بالمبلغ', null, true], 'finance\'s return: received, back to sales, every approval null, its number kept, ISO +03:00');
  const pending = await call('pending', {});
  check(pending.json.requests.find(item => item.crmRequestId === id(2)).returned.reason, 'الحد الائتماني للعميل لا يسمح بالمبلغ', 'the pending item says it too');
  const revision = mock.row(id(2)).revision, requestedAt = mock.row(id(2)).requestedAt;
  const corrected = {...request({payment: 'deferred'}), id: id(2), requestedAt: '2026-11-10T11:11:11+03:00', paymentTerms: 'advance_credit_limit', specs: {...specs, quantity: 3}};
  answer = await call('requests', rules.moldRequestBody(corrected));
  check([answer.http, answer.json.created, answer.json.linked, answer.json.corrected, answer.json.request.revision, answer.json.request.paymentTerms, mock.row(id(2)).quantity, mock.row(id(2)).requestedAt, answer.json.request.approvals.sales, typeof answer.json.request.returned.correctedAt],
    [200, false, false, true, revision + 1, 'advance_credit_limit', 3, requestedAt, null, 'string'], 'the correction: 200 corrected true, every column but requestedAt, a new revision, correctedAt, the approvals still cleared');
  answer = await call('requests', rules.moldRequestBody(corrected));
  check([answer.http, answer.json.corrected, answer.json.request.revision], [200, false, revision + 1], 'the same correction again: 200 corrected false, nothing changed');
  answer = await call('approval', rules.moldApprovalBody({id: id(2), action: 'approve', by, termsAccepted: true}));
  check([answer.json.request.returned, answer.json.request.approvals.sales.termsAccepted, mock.row(id(2)).returnHistory.length], [null, true, 1], 'the next sales approval clears returned (kept in production\'s history)');
  check((await call('requests', rules.moldRequestBody({...corrected, specs: {...specs, quantity: 9}}))).reason, 'production_only', 'no longer returned: 409 production_only again');
  mock.approve(id(3), 'production'); mock.financeReturn(id(3)); mock.remove(id(3));
  check((await send(3, {payment: 'cash', specs: {...specs, quantity: 2}})).reason, 'production_only', 'returned but cancelled: 409 production_only');
  check(mock.state.calls.filter(c => c.route === 'requests' && c.signed).length > 0, true, 'every call signed');
} finally { await mock.stop(); }

console.log(JSON.stringify({ok: true, checks, scope: 'mold requests, the products update of 2026-11-10: payment terms, acknowledgement, finance\'s return, the stand-in in both modes', productionDataUsed: false}));
