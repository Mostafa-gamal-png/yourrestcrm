// The products update of 2026-11-10 (schema 17) over real HTTP against the BUILT release (run the build first), sending to the stand-in
// production API (scripts/lib/products-mock.mjs) as the application of today, then as the updated one:
// - a deferred payment's terms: refused without them (a page loaded before: refresh), with another value, or with cash; kept in the CRM
//   (shown, audited) and never sent while the update is not known; learned from a status object carrying both keys (paymentTerms and
//   returned); sent right after payment from then on; a request that may have reached production without them is resent without them
//   (byte for byte, production takes it as the same request), one certainly refused at production's door takes them on its next send;
// - the sales manager's acknowledgement: an approval without it is refused (409 refresh), false is refused by its field, true is taken,
//   audited with the words, and sent to production only once the update is known (approvals.sales.termsAccepted read back); the same for
//   «طلبات بانتظار اعتمادي», whose items carry the terms;
// - the signed copies: once the update is known one fits beside ten originals (production takes 20), the originals keep their 10; a copy
//   production refuses for its count stops nothing;
// - finance's return: «رجّعته المالية» read from the status object (with finance's name and the ISO time), audited once, shown to the
//   requester (who may correct it), the supervisor and the sales manager (its pending item too); files go on as before; the correction
//   needs a new signature (device or link), is sent through the requests route as a correction (corrected true; the same body again is
//   taken without a change), keeps requestedAt and the cleared approvals, is audited; the sales manager's new approval clears returned
//   (its event stays); a request not returned, or returned and cancelled, is refused as before (409).
// Synthetic isolated fixtures only (PDFs made here with pdf-lib): temporary SQLite and object store, no production data.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {PDFDocument, StandardFonts} from 'pdf-lib';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';
import {signatureInput, signaturePng} from '../scripts/lib/signature-png.mjs';
import * as rules from '../portable/mold-rules.mjs';

if (!existsSync(new URL('../dist/standalone/app.cjs', import.meta.url))) throw new Error('Run the build first: this test boots the built release.');
const members = [{id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'}, {id: 'sup', role: 'supervisor', sup: 'sm'}, {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'أحمد عبد العزيز'}, {id: 'rep2', role: 'rep', sup: 'sm', region: 'eastern'}];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const specs = {description: 'قالب بلوك 20 سم', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: '', quantity: 1, designUrl: '', notes: ''};
const TERMS_REFRESH = 'حدّث الصفحة: اعتماد طلب القالب بقى محتاج تأكيد الموافقة على شروط الدفع.', TERMS_REQUIRED = 'علّم «' + rules.MOLD_TERMS_ACCEPT + '» قبل الاعتماد.';
const PRODUCTION_ONLY = rules.MOLD_PRODUCTION_ONLY_TEXT[0] + '؛ الطلب أُرسل للإنتاج، فتعديله من تطبيق المنتجات.', SIGNATURE_REFRESH = rules.MOLD_SIGNATURE_REQUIRED + '؛ حدّث الصفحة لو مش ظاهر مكان التوقيع.';
const REASON = 'الحد الائتماني للعميل لا يسمح بالمبلغ';
const png = (width, height) => { const b = Buffer.alloc(33); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b, 0); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20); b[24] = 8; b[25] = 6; return b; };
async function makePdf(label) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) doc.addPage([595, 842]).drawText(label + ' page ' + (i + 1), {x: 60, y: 760, size: 22, font});
  return Buffer.from(await doc.save());
}
const blockSignature = seen => ({...signatureInput(), block: signaturePng({width: 960, height: 300, seed: 5}).toString('base64'), blockAt: new Date().toISOString(), seen});

const mock = await startProductsMock();
const app = await bootBuiltApp({members}, {env: {YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret, NODE_EXTRA_CA_CERTS: mock.ca}});
try {
  const sessions = {};
  for (const member of members) sessions[member.id] = await app.login(member.id);
  const as = id => app.as(id ? sessions[id] : null);
  const now = new Date().toISOString();
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind('east1', 'rep', JSON.stringify({name: 'مصنع الشرق للطابوق', region: 'الشرقية', city: 'الدمام', address: 'حي الصناعية', code: 'ERP-77', phone: '0551234567', internalCode: 'YR-C-000027', branch: 'الرئيسي', assignedTo: 'rep'}), now, now).run();
  const post = (who, body) => as(who)('/api/mold-requests', {method: 'POST', body: {requestId: crypto.randomUUID(), ...body}});
  const ask = (extra = {}) => post('rep', {action: 'create', customerId: 'east1', specs, payment: 'cash', address: 'الدمام، الصناعية الثانية', signature: signatureInput(), ...extra});
  const multipart = async fields => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) if (value && typeof value === 'object' && 'bytes' in value) form.set(key, new Blob([value.bytes]), value.name); else form.set(key, value);
    const encoded = new Response(form);
    return {body: Buffer.from(await encoded.arrayBuffer()), headers: {'Content-Type': encoded.headers.get('content-type')}};
  };
  const upload = async (who, id, name, bytes, category) => {
    const encoded = await multipart({requestId: crypto.randomUUID(), id, file: {name, bytes}, ...(category ? {category} : {})});
    return as(who)('/api/mold-requests/design-files', {method: 'POST', body: encoded.body, headers: encoded.headers});
  };
  const view = async (who, id) => (await as(who)('/api/mold-requests?id=' + id)).json().requests?.[0];
  const pending = async () => (await as('sm')('/api/mold-requests?refs=1')).json().pending;
  const rowOf = id => app.db.prepare('SELECT * FROM crm_mold_requests WHERE id=?').bind(id).first();
  const dataOf = async id => JSON.parse((await rowOf(id)).data);
  const bodies = id => mock.state.calls.filter(call => call.route === 'requests' && call.signed && call.body.includes('"crmRequestId":"' + id + '"')).map(call => call.body);
  const approvalBodies = () => mock.state.calls.filter(call => call.route === 'approval' && call.signed).map(call => JSON.parse(call.body));
  const sentFiles = id => (mock.row(id)?.designFiles || []).map(file => file.name);
  const age = id => app.db.prepare("UPDATE crm_mold_requests SET remote_at='2026-01-01T00:00:00.000Z' WHERE id=?").bind(id).run();
  const known = async () => !!(await app.db.prepare("SELECT 1 AS k FROM crm_settings WHERE id='mold-nov10'").first());
  const audits = async (id, action) => (await app.db.prepare('SELECT detail FROM crm_audit WHERE record_id=? AND action=? ORDER BY created_at').bind(id, action).all()).results.map(row => JSON.parse(row.detail));
  const until = async (test, message, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await test()) return; await new Promise(resolve => setTimeout(resolve, 150)); } assert.fail('timed out: ' + message); };
  const settled = async id => { const row = await rowOf(id), waiting = await app.db.prepare('SELECT COUNT(*) AS n FROM crm_mold_design_files WHERE request_id=? AND outbox IS NOT NULL AND next_attempt_at IS NOT NULL').bind(id).first(); return !!row.accepted && !row.outbox && waiting.n === 0; };
  /** A request the representative asks for, with its design file (it waits for one, 2026-11-08); sent unless told otherwise. */
  const asked = async (extra = {}, {wait = true} = {}) => {
    const res = await ask(extra);
    assert.equal(res.status, 200, JSON.stringify(res.json()));
    const id = res.json().request.id;
    assert.equal((await upload('rep', id, 'تصميم.png', png(800, 600))).status, 200);
    if (wait) await until(() => settled(id), 'the request reaches production');
    return id;
  };
  const count = async () => (await app.db.prepare('SELECT COUNT(*) AS n FROM crm_mold_requests').first()).n;

  // ==== Production as it is today (the update not known)
  // ---- the terms on the form: required with deferred, refused with cash
  const before = await count();
  let res = await ask({payment: 'deferred'});
  check([res.status, res.json().fields], [400, {paymentTerms: rules.MOLD_PAYMENT_TERMS_REFRESH}], 'deferred without its terms (a page loaded before): refresh and choose');
  res = await ask({payment: 'deferred', paymentTerms: 'later'});
  check([res.status, res.json().fields], [400, {paymentTerms: rules.MOLD_PAYMENT_TERMS_REQUIRED}], 'another value: choose one of the three');
  res = await ask({payment: 'deferred', paymentTerms: ''});
  check([res.status, res.json().fields], [400, {paymentTerms: rules.MOLD_PAYMENT_TERMS_REQUIRED}], 'none chosen: the same');
  res = await ask({payment: 'cash', paymentTerms: 'advance_credit_limit'});
  check([res.status, res.json().fields], [400, {paymentTerms: rules.MOLD_PAYMENT_TERMS_CASH}], 'with cash: refused by the field');
  check(await count(), before, 'nothing stored');

  // ---- kept in the CRM, never sent while the update is not known
  const keptId = await asked({payment: 'deferred', paymentTerms: 'advance_after_shipping'});
  let data = await dataOf(keptId);
  check([data.paymentTerms, data.termsSent], ['advance_after_shipping', false], 'stored with the request; decided at its first send: without them');
  check([bodies(keptId).length, bodies(keptId).some(body => body.includes('paymentTerms')), bodies(keptId)[0].includes('"payment":"deferred"')], [1, false, true], 'sent to production without the key, as today');
  let shown = await view('rep', keptId);
  check([shown.payment, shown.paymentTerms, Object.hasOwn(shown.remote, 'paymentTerms'), shown.returned], ['deferred', 'advance_after_shipping', false, null], 'the CRM shows its terms; production\'s status says nothing of them');
  check((await audits(keptId, 'mold-request:create'))[0].paymentTerms, 'advance_after_shipping', 'audited with the request');
  check(await known(), false, 'an answer without the two keys teaches nothing');
  const cashBefore = await asked();
  check(bodies(cashBefore)[0].includes('paymentTerms') || Object.hasOwn(await dataOf(cashBefore), 'termsSent'), false, 'a cash request: neither the key nor the mark');
  // Sent once more later: one whose first answer was lost (it may be at production without the terms), one refused at production's door.
  mock.loseNext('requests');
  const lostId = await asked({payment: 'deferred', paymentTerms: 'advance_before_shipping'}, {wait: false});
  await until(async () => !!mock.row(lostId) && !!(await rowOf(lostId)).last_attempt_at && !(await rowOf(lostId)).accepted, 'the first answer lost');
  mock.state.notConfigured = true;
  const doorId = await asked({payment: 'deferred', paymentTerms: 'advance_credit_limit'}, {wait: false});
  await until(async () => JSON.parse((await rowOf(doorId)).last_error || 'null')?.notStored === true, 'refused at production\'s door');
  mock.state.notConfigured = false;
  check([(await dataOf(lostId)).termsSent, (await dataOf(doorId)).termsSent, mock.row(doorId)], [false, false, undefined], 'both decided without them for now; production never stored the second');

  // ---- the sales manager's acknowledgement
  const approvalsBefore = approvalBodies().length;
  res = await post('sm', {action: 'approve', id: keptId});
  check([res.status, res.json().error], [409, TERMS_REFRESH], 'an approval without it (a page loaded before): refresh');
  res = await post('sm', {action: 'approve', id: keptId, termsAccepted: false});
  check([res.status, res.json().fields], [400, {termsAccepted: TERMS_REQUIRED}], 'the box not ticked: refused by its field');
  check((await post('sm', {action: 'approve', id: keptId, termsAccepted: 'yes'})).status, 400, 'not a boolean: refused');
  check(approvalBodies().length, approvalsBefore, 'nothing asked of production');
  res = await post('sm', {action: 'approve', id: keptId, termsAccepted: true});
  check([res.status, res.json().request.remote.waitingStep], [200, 'production'], 'ticked: approved');
  check(approvalBodies().at(-1), {crmRequestId: keptId, action: 'approve', by: {name: 'sm', email: 'sm@yourrest.org'}}, 'production before its update: the acknowledgement stays in the CRM');
  const approved = (await audits(keptId, 'mold-request:approve')).at(-1);
  check([approved.termsAccepted, approved.terms], [true, rules.MOLD_TERMS_ACCEPT], 'audited with the acknowledgement\'s words');
  // «طلبات بانتظار اعتمادي»: the CRM's own terms beside deferred, and the same acknowledgement.
  const listedId = await asked({payment: 'deferred', paymentTerms: 'advance_credit_limit'});
  let item = (await pending()).items.find(entry => entry.crmRequestId === listedId);
  check([item.payment, item.paymentTerms, Object.hasOwn(item, 'returned')], ['deferred', 'advance_credit_limit', false], 'the list shows the request\'s terms (production lists none yet)');
  res = await post('sm', {action: 'approve-order', crmRequestId: listedId, page: 'refs'});
  check([res.status, res.json().error], [409, TERMS_REFRESH], 'the list\'s approval without it: refresh');
  res = await post('sm', {action: 'approve-order', crmRequestId: listedId, page: 'refs', termsAccepted: false});
  check([res.status, res.json().fields], [400, {termsAccepted: TERMS_REQUIRED}], 'not ticked: refused');
  res = await post('sm', {action: 'approve-order', crmRequestId: listedId, page: 'refs', termsAccepted: true});
  check([res.status, approvalBodies().at(-1)], [200, {crmRequestId: listedId, action: 'approve', by: {name: 'sm', email: 'sm@yourrest.org'}}], 'ticked: approved, without the acknowledgement for production of today');
  check((await audits(listedId, 'mold-request:approve-order')).at(-1)?.termsAccepted ?? (await audits(listedId, 'mold-request:approve')).at(-1)?.termsAccepted, true, 'audited');
  // Today a sent request is not corrected: 409 production_only, and nothing says returned.
  shown = await view('rep', cashBefore);
  res = await post('rep', {action: 'update', id: cashBefore, version: shown.version, specs: {...specs, quantity: 2}, payment: 'cash', signature: signatureInput()});
  check([res.status, res.json().error, Object.hasOwn(shown.can, 'correct')], [409, PRODUCTION_ONLY, false], 'a sent request: 409 production_only as before; no correction offered');

  // ==== Production updated (schema 17)
  mock.setNov10(true);
  await age(keptId);
  shown = (await (await as('rep')('/api/mold-requests')).json()).requests.find(entry => entry.id === keptId);
  check([await known(), shown.remote.paymentTerms, shown.returned], [true, null, null], 'learned from the first status object with both keys (production holds no terms for a request sent before)');
  check(shown.paymentTerms, 'advance_after_shipping', 'the CRM still shows its own');
  // ---- sent from now on, right after payment
  const newId = await asked({payment: 'deferred', paymentTerms: 'advance_before_shipping'});
  check([bodies(newId).length, bodies(newId)[0].includes('"payment":"deferred","paymentTerms":"advance_before_shipping"'), (await dataOf(newId)).termsSent, mock.row(newId).paymentTerms],
    [1, true, true, 'advance_before_shipping'], 'a new deferred request: its terms right after payment; production keeps them');
  check((await view('rep', newId)).remote.paymentTerms, 'advance_before_shipping', 'and says them back');
  const cashAfter = await asked();
  check([bodies(cashAfter)[0].includes('paymentTerms'), Object.hasOwn(await dataOf(cashAfter), 'termsSent')], [false, false], 'cash: no key');
  // ---- the two kept from before
  res = await post('rep', {action: 'resend', id: lostId});
  await until(() => settled(lostId), 'the lost one settles');
  check([bodies(lostId).length, bodies(lostId).every(body => !body.includes('paymentTerms')), bodies(lostId)[0] === bodies(lostId).at(-1), mock.row(lostId).paymentTerms, (await rowOf(lostId)).last_error],
    [2, true, true, null, null], 'may have reached production without them: resent byte for byte, taken as the same request (no 409)');
  res = await post('rep', {action: 'resend', id: doorId});
  await until(() => settled(doorId), 'the refused one settles');
  check([bodies(doorId).at(-1).includes('"payment":"deferred","paymentTerms":"advance_credit_limit"'), (await dataOf(doorId)).termsSent, mock.row(doorId).paymentTerms], [true, true, 'advance_credit_limit'],
    'refused at production\'s door before: its next send carries them');
  // ---- the acknowledgement goes now
  item = (await pending()).items.find(entry => entry.crmRequestId === newId);
  check([item.paymentTerms, item.returned], ['advance_before_shipping', null], 'the list: production\'s terms, returned null');
  res = await post('sm', {action: 'approve', id: newId, termsAccepted: true});
  check([res.status, approvalBodies().at(-1).termsAccepted, mock.row(newId).approvals.sales.termsAccepted, res.json().request.remote.approvals.sales.termsAccepted], [200, true, true, true],
    'sent with the approval, kept by production, read back in approvals.sales.termsAccepted');
  mock.approve(cashAfter, 'sales');
  await age(cashAfter);
  check(Object.hasOwn((await view('rep', cashAfter)).remote.approvals.sales, 'termsAccepted'), false, 'an approval given in production (termsAccepted null there): nothing read');

  // ---- the signed copies: production takes 20 design files now; the originals keep 10
  const lastPdf = await makePdf('tenth');
  res = await ask({signature: blockSignature([sha(lastPdf)])});
  const fullId = res.json().request.id;
  // The customer's signature takes one design place: eight images and the PDF make ten originals.
  for (let n = 0; n < 8; n++) check((await upload('rep', fullId, 'صورة ' + n + '.png', png(100 + n, 100))).status, 200, 'original ' + (n + 2));
  check((await upload('rep', fullId, 'العاشر.pdf', lastPdf)).status, 200, 'the tenth original, a PDF the customer saw');
  await until(() => sentFiles(fullId).includes('العاشر - موقّع.pdf'), 'its signed copy reaches production');
  shown = await view('rep', fullId);
  check([shown.signing.copies, shown.signing.skipped, shown.designFiles.filter(file => file.signedCopy).map(file => [file.name, file.state])], [1, [], [['العاشر - موقّع.pdf', 'sent']]], 'the copy beside ten originals (the eleventh design file)');
  res = await upload('rep', fullId, 'الحادي عشر.png', png(300, 300));
  check(res.status, 409, 'an eleventh original: refused, as before');
  // Production back to the application before (a rollback): it refuses the copy for its count; nothing else stops.
  mock.setNov10(false);
  const rolledPdf = await makePdf('rolled back');
  res = await ask({signature: blockSignature([sha(rolledPdf)])});
  const rolledId = res.json().request.id;
  for (let n = 0; n < 8; n++) await upload('rep', rolledId, 'صورة ' + n + '.png', png(200 + n, 100));
  await upload('rep', rolledId, 'العاشر.pdf', rolledPdf);
  await until(async () => (await view('rep', rolledId)).designFiles.some(file => file.signedCopy && file.state === 'rejected'), 'production refuses the copy');
  shown = await view('rep', rolledId);
  const refusedCopy = shown.designFiles.find(file => file.signedCopy);
  check([refusedCopy.state, refusedCopy.error.reason, shown.sending.state, sentFiles(rolledId).length, (await view('sm', rolledId)).can.approve], ['rejected', 'too_many_files', 'sent', 10, true],
    'refused for its count («ما اتبعتتش: الإنتاج رفض عدد الملفات»): the request and its ten originals went, the sales manager approves');
  mock.setNov10(true);

  // ==== Finance's return
  const returnedId = await asked({payment: 'deferred', paymentTerms: 'advance_before_shipping'});
  check((await post('sm', {action: 'approve', id: returnedId, termsAccepted: true})).status, 200, 'the sales manager approves');
  mock.approve(returnedId, 'production');
  const orderNo = mock.row(returnedId).orderNo;
  mock.financeReturn(returnedId, REASON);
  await age(returnedId);
  shown = (await (await as('rep')('/api/mold-requests')).json()).requests.find(entry => entry.id === returnedId);
  check([shown.returned.by, shown.returned.name, shown.returned.reason, shown.returned.correctedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+03:00$/.test(shown.returned.at)], ['finance', 'finance@yourrest.org', REASON, null, true], '«رجّعته المالية» with finance\'s name, the reason and the time');
  check([shown.remote.status, shown.remote.waitingStep, shown.remote.approvals, shown.remote.orderNo, shown.can.correct, shown.can.edit, shown.can.attach],
    ['received', 'sales', {required: true, sales: null, production: null, admin: null}, orderNo, true, false, true], 'back to the sales manager, every approval cleared, its number kept; its requester corrects it');
  check((await audits(returnedId, 'mold-request:returned')).map(entry => [entry.label, entry.reason, entry.by]), [['رجّعته المالية', REASON, 'finance@yourrest.org']], 'audited when first seen');
  await age(returnedId); await view('rep', returnedId); await (await as('rep')('/api/mold-requests')).json();
  check((await audits(returnedId, 'mold-request:returned')).length, 1, 'once, however often it is read');
  const bySup = await view('sup', returnedId);
  check([bySup.returned.reason, bySup.can.correct], [REASON, false], 'the supervisor reads it; only the requester corrects');
  check((await view('rep2', returnedId)), undefined, 'another representative does not reach it');
  // Files go on as before (and the waiting list is read again).
  const financePdf = await makePdf('finance');
  res = await upload('rep', returnedId, 'ملحق للمالية.pdf', financePdf);
  check(res.status, 200, 'a file attached while it is back: ' + JSON.stringify(res.json()?.error || ''));
  await until(() => sentFiles(returnedId).includes('ملحق للمالية.pdf'), 'it reaches production');
  item = (await pending()).items.find(entry => entry.crmRequestId === returnedId);
  check([item.returned.reason, item.returned.name, item.paymentTerms], [REASON, 'finance@yourrest.org', 'advance_before_shipping'], 'the sales manager\'s list says why');
  check((await view('sm', returnedId)).can.approve, true, 'the sales manager may approve it again');
  // ---- the correction
  shown = await view('rep', returnedId);
  const correction = {action: 'update', id: returnedId, version: shown.version, specs: {...specs, quantity: 3}, payment: 'deferred', paymentTerms: 'advance_credit_limit', address: 'الدمام، الصناعية الثانية'};
  check((await post('rep2', {...correction, signature: signatureInput()})).status, 404, 'another representative cannot correct it');
  res = await post('rep', correction);
  check([res.status, res.json().fields], [400, {signature: SIGNATURE_REFRESH}], 'what the customer signed changed: a new signature first');
  const sentBefore = bodies(returnedId).length;
  res = await post('rep', {...correction, specs, paymentTerms: 'advance_before_shipping'});
  check([res.status, bodies(returnedId).length], [200, sentBefore], 'nothing changed: nothing sent');
  const revision = mock.row(returnedId).revision, firstBody = bodies(returnedId)[0];
  mock.loseNext('requests');
  res = await post('rep', {...correction, signature: signatureInput('م. خالد العتيبي', {seed: 7})});
  check(res.status, 200, 'corrected with a new signature');
  await until(() => bodies(returnedId).length === sentBefore + 1, 'the correction goes');
  data = await dataOf(returnedId);
  check([data.specs.quantity, data.paymentTerms, data.termsSent, data.requestedAt], [3, 'advance_credit_limit', true, JSON.parse(firstBody).requestedAt], 'saved: the new data with its terms, requestedAt as first');
  const corrected = bodies(returnedId).at(-1);
  check([JSON.parse(corrected).requestedAt, JSON.parse(corrected).specs.quantity, corrected.includes('"payment":"deferred","paymentTerms":"advance_credit_limit"')], [JSON.parse(firstBody).requestedAt, 3, true], 'sent through the requests route for the same crmRequestId');
  check([mock.row(returnedId).quantity, mock.row(returnedId).paymentTerms, mock.row(returnedId).revision, typeof mock.row(returnedId).returned.correctedAt], [3, 'advance_credit_limit', revision + 1, 'string'], 'production took it as a correction (its answer lost on the way)');
  const correctionAudit = (await audits(returnedId, 'mold-request:update')).at(-1);
  check([correctionAudit.label, correctionAudit.correction, correctionAudit.returnedReason, correctionAudit.paymentTerms], ['تعديل طلب القالب بعد إرجاع المالية وإعادة إرساله', true, REASON, 'advance_credit_limit'], 'audited as the correction after finance\'s return');
  const correctedAt = mock.row(returnedId).returned.correctedAt, answers = () => mock.state.calls.filter(call => call.route === 'requests' && call.signed && call.body.includes('"crmRequestId":"' + returnedId + '"')).map(call => call.answer);
  check([answers().at(-1).http, answers().at(-1).body.corrected, answers().at(-1).body.linked], [200, true, false], 'production\'s (lost) answer: corrected true, linked false');
  res = await post('rep', {action: 'resend', id: returnedId});
  await until(() => settled(returnedId), 'the correction settles');
  check([bodies(returnedId).at(-1) === corrected, answers().at(-1).http, answers().at(-1).body.created, answers().at(-1).body.corrected, mock.row(returnedId).returned.correctedAt, mock.row(returnedId).quantity, (await rowOf(returnedId)).last_error],
    [true, 200, false, false, correctedAt, 3, null], 'the same body again: 200 corrected false, nothing changed there');
  await until(() => sentFiles(returnedId).some(name => name.startsWith('توقيع العميل')) && mock.row(returnedId).designFiles.filter(file => file.name.startsWith('توقيع العميل')).length === 2, 'the new signature reaches production');
  await age(returnedId);
  shown = await view('rep', returnedId);
  check([typeof shown.returned.correctedAt, shown.remote.approvals.sales, shown.can.correct, shown.signature.signer], ['string', null, true, 'م. خالد العتيبي'], 'the CRM says the correction arrived; the approvals stay cleared');
  // ---- the sales manager approves again: returned cleared, its event kept
  res = await post('sm', {action: 'approve', id: returnedId, termsAccepted: true});
  check([res.status, res.json().request.returned, res.json().request.remote.approvals.sales.termsAccepted, mock.row(returnedId).returnHistory.length], [200, null, true, 1], 'approved again: returned cleared');
  check((await audits(returnedId, 'mold-request:returned')).length, 1, 'the event stays in the history');
  shown = await view('rep', returnedId);
  res = await post('rep', {...correction, version: shown.version, specs: {...specs, quantity: 4}, signature: signatureInput()});
  check([res.status, res.json().error], [409, PRODUCTION_ONLY], 'no longer returned: refused as before');
  // ---- returned, then cancelled: refused
  const cancelledId = await asked({payment: 'deferred', paymentTerms: 'advance_after_shipping'});
  await post('sm', {action: 'approve', id: cancelledId, termsAccepted: true});
  mock.approve(cancelledId, 'production'); mock.financeReturn(cancelledId, REASON);
  await age(cancelledId);
  shown = await view('rep', cancelledId);
  check(shown.can.correct, true, 'returned');
  res = await post('rep', {action: 'cancel', id: cancelledId, version: shown.version, reason: 'العميل اعتذر'});
  check(res.status, 200, 'its requester cancels it');
  shown = await view('rep', cancelledId);
  res = await post('rep', {action: 'update', id: cancelledId, version: shown.version, specs: {...specs, quantity: 5}, payment: 'cash', signature: signatureInput()});
  check([res.status, shown.returned, Object.hasOwn(shown.can, 'correct')], [409, null, false], 'returned and cancelled: no correction');
  // ---- corrected with the customer's link: held until the customer signs, then sent at once
  const linkedId = await asked({payment: 'deferred', paymentTerms: 'advance_after_shipping'});
  await post('sm', {action: 'approve', id: linkedId, termsAccepted: true});
  mock.approve(linkedId, 'production'); mock.financeReturn(linkedId, 'العميل طلب كمية أقل');
  await age(linkedId);
  shown = await view('rep', linkedId);
  const linkSent = bodies(linkedId).length;
  res = await post('rep', {action: 'update', id: linkedId, version: shown.version, specs: {...specs, quantity: 2}, payment: 'deferred', paymentTerms: 'advance_after_shipping', signatureLink: true});
  check([res.status, res.json().request.sending.held, res.json().request.can.link, typeof res.json().link?.url], [200, 'customer_signature', true, 'string'], 'the correction waits for the customer\'s link');
  const token = res.json().link.url.split('/').pop();
  const resent = await post('rep', {action: 'resend', id: linkedId});
  check([bodies(linkedId).length, resent.status >= 400], [linkSent, true], 'never sent while it waits (a resend refused)');
  const page = await as(null)('/sign/m/' + token);
  check([page.status, page.text.includes('دفعة مقدمة واستكمال باقي المبلغ بعد الترحيل')], [200, true], 'the customer\'s page opens, with the terms');
  const key = /"key":"([0-9a-f]{32})"/.exec(page.text.replaceAll('\\"', '"'))?.[1];
  res = await as(null)('/api/mold-sign', {method: 'POST', body: {requestId: crypto.randomUUID(), token, key, signer: 'سالم العميل', png: signaturePng({seed: 9}).toString('base64'), block: signaturePng({width: 960, height: 300, seed: 6}).toString('base64'), blockAt: new Date().toISOString(), consent: true}});
  check(res.status, 200, 'the customer signs from the link');
  await until(() => bodies(linkedId).length === linkSent + 1 && typeof mock.row(linkedId).returned?.correctedAt === 'string', 'the correction goes at once');
  check([mock.row(linkedId).quantity, (await dataOf(linkedId)).signature.via], [2, 'link'], 'production has the correction; signed from the link');
} finally {
  await app.stop?.();
  await mock.stop();
}

console.log(JSON.stringify({ok: true, checks, builtRelease: true, scope: 'mold requests, the products update of 2026-11-10 over HTTP', realProductionTested: false}));
