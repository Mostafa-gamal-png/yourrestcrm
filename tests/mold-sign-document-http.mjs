// The customer signs ONE document (the owner, 2026-11-11: «ملف واحد موقّع»), over real HTTP against the BUILT release (run the build first),
// sending to the stand-in production API (scripts/lib/products-mock.mjs, with production's updates of 2026-11-03 and 2026-11-10):
// - the device path: a representative's new request signed on the device with the signature page and the documents it lists (a quotation
//   of 2 pages, a design of 3, a picture; a drawing named only) gets ONE signed file once the last of them is uploaded, «طلب القالب -
//   موقّع.pdf», 7 pages, the quotation's category, sent to production once (its answer lost once: sent again, held once), no per-file copy;
//   a document the page listed with another count of pages makes the per-file copies instead, said so; the sheet's device signing of a
//   request whose files are all uploaded makes the file at once;
// - the link path: the page's documents (a damaged PDF left out, named), the signature page and its parts: one signed file, downloaded
//   from the thank-you page, sent once with the right category; the same submission again answers the same and makes nothing more; a
//   file changed between showing and signing (another SHA-256, another count of pages) is refused as a change; over production's limit
//   for one file (two PDFs of 13 MB): signed, the per-file copies made instead, said so;
// - the old way: a page of the release before (no signature page) still signs from the link and the device, with the per-file copies;
// - the signature page refused when it is not an A4 PNG, or its parts are not a list of documents.
// Synthetic isolated fixtures only: temporary SQLite and object store, PDFs and pictures made here, no production data.
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PDFDict, PDFDocument, PDFName, StandardFonts, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState} from 'pdf-lib';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';
import {signaturePng} from '../scripts/lib/signature-png.mjs';
import {DAMAGED_PDF, JPEG_WIDE, makePdf, signaturePagePng} from '../scripts/lib/signed-document-fixtures.mjs';

if (!existsSync(new URL('../dist/standalone/app.cjs', import.meta.url))) throw new Error('Run the build first: this test boots the built release.');
const members = [{id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'}, {id: 'sup', role: 'supervisor', sup: 'sm'}, {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'أحمد عبد العزيز'}];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const specs = {description: 'قالب بلوك 20 سم', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: '', quantity: 3, designUrl: '', notes: ''};
const out = process.env.YR_MOLD_SCREENSHOT_DIR ? path.resolve(process.env.YR_MOLD_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-sign-document-http-'));
fs.mkdirSync(out, {recursive: true});
/** A PDF of about `mb` MB that does not compress (pictures of random pixels). */
async function heavyPdf(label, mb) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica), side = 600, pages = Math.ceil(mb * 1024 * 1024 / (side * side * 3));
  for (let i = 0; i < pages; i++) {
    const image = doc.context.register(doc.context.stream(randomBytes(side * side * 3), {Type: 'XObject', Subtype: 'Image', Width: side, Height: side, ColorSpace: 'DeviceRGB', BitsPerComponent: 8}));
    const page = doc.addPage([595, 842]), name = page.node.newXObject('Im', image);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(420, 0, 0, 420, 88, 260), drawObject(name), popGraphicsState());
    page.drawText(label + ' ' + (i + 1), {x: 60, y: 760, size: 24, font});
  }
  return Buffer.from(await doc.save({useObjectStreams: false}));
}
const DRAWING = Buffer.from('AC1027 synthetic drawing bytes');
const part = (bytes, category, kind, name, pages) => ({sha256: sha(bytes), category, kind, name, pages});
const signature = (parts, extra = {}) => ({signer: 'م. خالد العتيبي', png: signaturePng().toString('base64'), block: signaturePng({width: 960, height: 300, seed: 5}).toString('base64'), blockAt: new Date().toISOString(),
  document: {page: signaturePagePng().toString('base64'), parts}, ...extra});

const mock = await startProductsMock({quotePo: true, nov10: true});
const app = await bootBuiltApp({members}, {env: {YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret, NODE_EXTRA_CA_CERTS: mock.ca}});
try {
  const now = new Date().toISOString();
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind('east1', 'rep', JSON.stringify({name: 'مصنع الشرق للطابوق', region: 'الشرقية', city: 'الدمام', address: 'حي الصناعية', code: 'ERP-77', phone: '0551234567', internalCode: 'YR-C-000027', branch: 'الرئيسي', assignedTo: 'rep'}), now, now).run();
  for (const id of ['mold-quote-po', 'mold-nov10']) await app.db.prepare('INSERT OR IGNORE INTO crm_settings(id,owner_id) VALUES(?,?)').bind(id, now).run();
  const rep = app.as(await app.login('rep')), anonymous = app.as(null);
  const post = body => rep('/api/mold-requests', {method: 'POST', body: {requestId: crypto.randomUUID(), ...body}});
  const create = extra => post({action: 'create', customerId: 'east1', specs, payment: 'deferred', paymentTerms: 'advance_after_shipping', address: 'الدمام، الصناعية الثانية', ...extra});
  const upload = async (id, name, bytes, category = 'design', requestId = crypto.randomUUID()) => {
    const form = new FormData();
    form.set('requestId', requestId); form.set('id', id); form.set('file', new Blob([bytes]), name); if (category !== 'design') form.set('category', category);
    const encoded = new Response(form);
    return rep('/api/mold-requests/design-files', {method: 'POST', body: Buffer.from(await encoded.arrayBuffer()), headers: {'Content-Type': encoded.headers.get('content-type')}});
  };
  const view = async id => (await (await rep('/api/mold-requests?id=' + id)).json()).requests[0];
  const dataOf = async id => JSON.parse((await app.db.prepare('SELECT data FROM crm_mold_requests WHERE id=?').bind(id).first()).data);
  const rows = async id => (await app.db.prepare('SELECT * FROM crm_mold_design_files WHERE request_id=? ORDER BY created_at,id').bind(id).all()).results;
  const sentFiles = id => (mock.row(id)?.designFiles || []);
  const sends = crmFileId => mock.state.calls.filter(call => call.route === 'design-files' && call.signed && call.body.includes('"crmFileId":"' + crmFileId + '"')).length;
  const until = async (test, message, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await test()) return; await new Promise(resolve => setTimeout(resolve, 150)); } assert.fail('timed out: ' + message); };
  const pagesOf = async bytes => { const doc = await PDFDocument.load(bytes); return doc.getPages(); };
  const images = page => page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)?.keys().length || 0;
  const quote2 = await makePdf('Quotation Q-77', 2), design3 = await makePdf('Mold design', 3, {rotate: {3: 90}});

  // ---- the device path: one signed file once the last document is uploaded, sent once (its answer lost once), no per-file copy
  const deviceParts = [part(quote2, 'quote', 'pdf', 'Q-77.pdf', 2), part(design3, 'design', 'pdf', 'تصميم القالب.pdf', 3), part(JPEG_WIDE, 'design', 'image', 'صورة القالب.jpg', 1)];
  const createId = crypto.randomUUID(), createBody = {action: 'create', requestId: createId, customerId: 'east1', specs, payment: 'deferred', paymentTerms: 'advance_after_shipping', address: 'الدمام، الصناعية الثانية', signature: signature(deviceParts, {seen: [sha(quote2), sha(design3)]})};
  let answer = await rep('/api/mold-requests', {method: 'POST', body: createBody});
  check(answer.status, 200, 'the device signature with its signature page and the documents it lists is taken');
  const deviceId = answer.json().request.id;
  check((await rep('/api/mold-requests', {method: 'POST', body: createBody})).status, 200, 'the same create again (an answer lost on the way): the same request');
  check((await app.db.prepare("SELECT COUNT(*) AS n FROM crm_mold_requests WHERE json_extract(data,'$.customer.name')=?").bind('مصنع الشرق للطابوق').first()).n, 1, 'one request');
  let data = await dataOf(deviceId);
  check([typeof data.signature.document.key, data.signature.document.parts.map(item => item.pages), data.signature.document.width, data.signature.document.height], ['string', [2, 3, 1], 1240, 1754], 'the data names the signature page\'s object and the documents in order');
  check(JSON.stringify(await view(deviceId)).includes('mold-sign-page/'), false, 'the signature page\'s object key is never shown');
  check((await view(deviceId)).signing.document, {state: 'waiting', missing: ['Q-77.pdf', 'تصميم القالب.pdf', 'صورة القالب.jpg']}, 'it waits for the files the customer saw');
  check((await upload(deviceId, 'Q-77.pdf', quote2, 'quote')).status, 200, 'the quotation uploaded');
  check((await upload(deviceId, 'رسم.dwg', DRAWING)).status, 200, 'a drawing (named only)');
  check((await upload(deviceId, 'تصميم القالب.pdf', design3)).status, 200, 'the design uploaded');
  check((await view(deviceId)).signing.document, {state: 'waiting', missing: ['صورة القالب.jpg']}, 'still one to come');
  mock.loseNext('design-files');
  const lastUpload = crypto.randomUUID();
  check((await upload(deviceId, 'صورة القالب.jpg', JPEG_WIDE, 'design', lastUpload)).status, 200, 'the last of them: the picture');
  let shown = await view(deviceId);
  const documentId = 'mdc-' + data.signature.fileId.slice(4) + '-doc';
  check([shown.signing.document, shown.signing.copies], [{state: 'made', pages: 7}, 0], 'ONE signed file: 7 pages (2 + 3 + 1 and the signature page), no per-file copy');
  const signedFile = shown.designFiles.find(file => file.signedDocument);
  check([signedFile?.name, signedFile?.category, signedFile?.signedCopy, signedFile?.canDelete, signedFile?.crmFileId], ['طلب القالب - موقّع.pdf', 'quote', true, false, documentId], 'named so, of the quotation\'s category, marked, not deletable');
  check((await upload(deviceId, 'صورة القالب.jpg', JPEG_WIDE, 'design', lastUpload)).status, 200, 'the same upload again (a network cut): answered as before');
  check((await rows(deviceId)).filter(row => row.id.startsWith('mdc-')).map(row => row.id), [documentId], 'and nothing more made');
  // Production: the answer of one send was lost; sent again, held once.
  for (const row of await rows(deviceId)) if (row.outbox === 'send') await app.db.prepare('UPDATE crm_mold_design_files SET next_attempt_at=? WHERE id=?').bind(new Date(Date.now() - 1000).toISOString(), row.id).run();
  await rep('/api/mold-requests');
  await until(async () => sentFiles(deviceId).some(file => file.crmFileId === documentId) && (await rows(deviceId)).every(row => !row.outbox), 'the request, its files and the signed file reach production');
  for (const row of await rows(deviceId)) if (row.outbox === 'send') await app.db.prepare('UPDATE crm_mold_design_files SET next_attempt_at=? WHERE id=?').bind(new Date(Date.now() - 1000).toISOString(), row.id).run();
  const held = sentFiles(deviceId);
  check([held.filter(file => file.crmFileId === documentId).length, held.find(file => file.crmFileId === documentId).category, held.filter(file => file.name.endsWith(' - موقّع.pdf')).map(file => file.name)], [1, 'quote', ['طلب القالب - موقّع.pdf']], 'production holds the signed file once, as a quotation\'s file; no per-file copy');
  ok(sends(documentId) >= 1, 'sent (' + sends(documentId) + ' call(s))');
  check([(await view(deviceId)).remote?.status, mock.row(deviceId).approvals?.sales ?? null], ['received', null], 'it reached production with the request, before any approval (a quotation\'s file: it would undo none anyway)');
  // A retry of the same file (its answer lost, as production may see): the same crmFileId with the same bytes: 200 created:false, held once.
  const callsBefore = sends(documentId);
  await app.db.prepare("UPDATE crm_mold_design_files SET outbox='send',sent_at=NULL,next_attempt_at=? WHERE id=?").bind(new Date(Date.now() - 1000).toISOString(), documentId).run();
  await rep('/api/mold-requests');
  await until(async () => !(await rows(deviceId)).find(row => row.id === documentId).outbox, 'sent again');
  check([sends(documentId) - callsBefore, sentFiles(deviceId).filter(file => file.crmFileId === documentId).length, sha(sentFiles(deviceId).find(file => file.crmFileId === documentId).bytes)], [1, 1, sha((await rep(signedFile.href)).bytes)], 'sent again under the same crmFileId with byte-identical content: production holds it once');
  check(held.filter(file => !file.name.endsWith(' - موقّع.pdf') && !file.name.startsWith('توقيع العميل')).map(file => [file.name, file.category]).sort(), [['Q-77.pdf', 'quote'], ['رسم.dwg', 'design'], ['تصميم القالب.pdf', 'design'], ['صورة القالب.jpg', 'design']].sort(), 'the originals go as they are');
  const merged = (await rep(signedFile.href)).bytes;
  fs.writeFileSync(path.join(out, 'device-signed.pdf'), merged);
  let pages = await pagesOf(merged);
  check([pages.length, pages.map(page => page.getRotation().angle), pages.map(images)], [7, [0, 0, 0, 0, 90, 0, 0], [0, 0, 0, 0, 0, 1, 1]], 'the file: 7 pages, the design\'s turned page kept, the picture a page, the signature page last');
  check(Math.round(pages[6].getSize().width), 595, 'the signature page A4');
  const audit = await app.db.prepare("SELECT actor,detail FROM crm_audit WHERE record_id=? AND action='mold-design:signed-document'").bind(deviceId).first();
  check([audit.actor, JSON.parse(audit.detail).pages, JSON.parse(audit.detail).name], ['أحمد عبد العزيز', 7, 'طلب القالب - موقّع.pdf'], 'audited by the representative');

  // A document listed with another count of pages than the file has: no single file, the per-file copies instead, said so.
  answer = await create({signature: signature([part(quote2, 'quote', 'pdf', 'Q-77.pdf', 2), part(design3, 'design', 'pdf', 'تصميم.pdf', 4)], {seen: [sha(quote2), sha(design3)]})});
  const mismatchId = answer.json().request.id;
  await upload(mismatchId, 'Q-77.pdf', quote2, 'quote'); await upload(mismatchId, 'تصميم.pdf', design3);
  shown = await view(mismatchId);
  check([shown.signing.document, shown.signing.copies, shown.designFiles.filter(file => file.signedCopy).map(file => file.name).sort()], [{state: 'fallback', reason: 'mismatch'}, 2, ['Q-77 - موقّع.pdf', 'تصميم - موقّع.pdf'].sort()], 'not what the page listed: a signed copy of each PDF instead, said so');
  check((await app.db.prepare("SELECT COUNT(*) AS n FROM crm_audit WHERE record_id=? AND action='mold-design:signed-document-skipped'").bind(mismatchId).first()).n, 1, 'audited once');

  // Nothing the page could open (a quotation's PDF it named only): the signed file is the signature page alone, made at once, of the
  // quotation's category the page saw.
  const pageOnly = signature([]); pageOnly.document.category = 'quote';
  answer = await create({signature: pageOnly});
  const pageOnlyId = answer.json().request.id;
  shown = await view(pageOnlyId);
  check([shown.signing.document, shown.designFiles.filter(file => file.signedDocument).map(file => file.category)], [{state: 'made', pages: 1}, ['quote']], 'the signature page alone, as a quotation\'s file');
  const badCategory = signature([]); badCategory.document.category = 'other';
  answer = await create({signature: badCategory});
  check([answer.status, (await view(answer.json().request.id)).designFiles.filter(file => file.signedDocument).map(file => file.category)], [200, ['design']], 'a category that is not one of the three is not taken (design)');

  // Production refuses the signed file once sent: 413 (over its limit for one file) or too_many_files (its category full there: it keeps no
  // mark of a signed copy, so the signed file takes a place): the per-file copies are made instead and sent, said so on the request.
  for (const [http, body, reason] of [[413, {error: {code: 'payload_too_large', message: 'The file is larger than 25 MB.'}}, 'too_large'], [400, {error: {code: 'invalid_payload', message: 'A request holds at most 10 files of this kind.', fields: ['crmFileId'], details: {reason: 'too_many_files'}}}, 'too_many_files']]) {
    mock.answerNextFile(/^mdc-.+-doc$/, http, body);
    answer = await create({signatureLink: true});
    const refusedId = answer.json().request.id;
    await upload(refusedId, 'Q-r.pdf', quote2, 'quote'); await upload(refusedId, 'رسم r.pdf', design3);
    shown = await view(refusedId);
    check((await post({action: 'sign', id: refusedId, version: shown.version, signature: signature([part(quote2, 'quote', 'pdf', 'Q-r.pdf', 2), part(design3, 'design', 'pdf', 'رسم r.pdf', 3)])})).status, 200, 'signed (' + http + ' to come)');
    await until(async () => (await view(refusedId)).signing.document?.state === 'fallback', 'production\'s refusal read: ' + http);
    shown = await view(refusedId);
    check([shown.signing.document, shown.signing.copies], [{state: 'fallback', reason}, 2], 'refused there (' + http + '): a signed copy of each PDF instead, said so');
    // Due again: the copies (never the refused signed file: refused for good, it is not tried again).
    for (const row of await rows(refusedId)) if (row.outbox === 'send' && !JSON.parse(row.last_error || '{}').final) await app.db.prepare('UPDATE crm_mold_design_files SET next_attempt_at=? WHERE id=?').bind(new Date(Date.now() - 1000).toISOString(), row.id).run();
    await rep('/api/mold-requests');
    await until(() => sentFiles(refusedId).filter(file => file.name.endsWith(' - موقّع.pdf')).length === 2, 'the copies reach production');
    check(sentFiles(refusedId).filter(file => file.name.endsWith(' - موقّع.pdf')).map(file => [file.name, file.category]).sort(), [['Q-r - موقّع.pdf', 'quote'], ['رسم r - موقّع.pdf', 'design']], 'the copies sent, each of its original\'s category; the signed file not held there');
  }
  // No place left in the CRM's count of production's places: production's limits before its update of 2026-11-10 (5 quotation files),
  // the quotation's 5 taken by the originals: the copies instead, where they have room, before anything is sent.
  await app.db.prepare("DELETE FROM crm_settings WHERE id='mold-nov10'").run();
  answer = await create({signatureLink: true});
  const fullId = answer.json().request.id;
  for (let n = 0; n < 4; n++) await upload(fullId, 'عرض ' + n + '.pdf', await makePdf('quote ' + n, 1), 'quote');
  await upload(fullId, 'Q-full.pdf', quote2, 'quote'); await upload(fullId, 'رسم full.pdf', design3);
  shown = await view(fullId);
  check((await post({action: 'sign', id: fullId, version: shown.version, signature: signature([part(quote2, 'quote', 'pdf', 'Q-full.pdf', 2), part(design3, 'design', 'pdf', 'رسم full.pdf', 3)])})).status, 200, 'signed with the quotation\'s places all taken');
  shown = await view(fullId);
  check([shown.signing.document, shown.designFiles.filter(file => file.signedCopy).map(file => file.name), shown.signing.skipped.map(item => [item.name, item.reason])], [{state: 'fallback', reason: 'too_many_files'}, ['رسم full - موقّع.pdf'], [['Q-full.pdf', 'too_many_files']]], 'no place for the signed file: the copy of the design (its category has room), none for the quotation (said why)');
  check(sends('mdc-' + (await dataOf(fullId)).signature.fileId.slice(4) + '-doc'), 0, 'nothing sent that production would refuse');
  await app.db.prepare('INSERT OR IGNORE INTO crm_settings(id,owner_id) VALUES(?,?)').bind('mold-nov10', now).run();

  // The sheet's device signing of a request whose files are all uploaded: the file at once.
  answer = await create({signatureLink: true});
  const sheetId = answer.json().request.id;
  await upload(sheetId, 'Q-9.pdf', quote2, 'quote'); await upload(sheetId, 'رسم الجهاز.pdf', design3);
  shown = await view(sheetId);
  answer = await post({action: 'sign', id: sheetId, version: shown.version, signature: signature([part(quote2, 'quote', 'pdf', 'Q-9.pdf', 2), part(design3, 'design', 'pdf', 'رسم الجهاز.pdf', 3)])});
  check(answer.status, 200, 'signed on the device from the sheet');
  check(answer.json().request.signing.document, {state: 'made', pages: 6}, 'the signed file made at once: 6 pages');
  await until(async () => sentFiles(sheetId).some(file => file.name === 'طلب القالب - موقّع.pdf'), 'it reaches production');

  // ---- the link path
  answer = await create({signatureLink: true});
  const linkId = answer.json().request.id, token = answer.json().link.url.split('/').pop();
  for (const [name, bytes, category] of [['Q-77.pdf', quote2, 'quote'], ['تصميم القالب.pdf', design3, 'design'], ['تالف.pdf', DAMAGED_PDF, 'design'], ['صورة القالب.jpg', JPEG_WIDE, 'design'], ['رسم.dwg', DRAWING, 'design']]) check((await upload(linkId, name, bytes, category)).status, 200, 'uploaded ' + name);
  let page = await anonymous('/sign/m/' + token);
  check(page.status, 200, 'the link page opens');
  const key = /"key":"([0-9a-f]{32})"/.exec(page.text.replaceAll('\\"', '"'))?.[1];
  ok(key, 'it carries its key');
  // What the page lists (its viewer plans the same with pdf-lib): the quotation, the design, the picture; the damaged PDF and the drawing named only.
  const linkParts = [part(quote2, 'quote', 'pdf', 'Q-77.pdf', 2), part(design3, 'design', 'pdf', 'تصميم القالب.pdf', 3), part(JPEG_WIDE, 'design', 'image', 'صورة القالب.jpg', 1)];
  const body = extra => ({requestId: crypto.randomUUID(), token, key, signer: 'سالم العميل', png: signaturePng({seed: 9}).toString('base64'), block: signaturePng({width: 960, height: 300, seed: 5}).toString('base64'), blockAt: new Date().toISOString(), consent: true,
    document: {page: signaturePagePng(7).toString('base64'), parts: linkParts}, ...extra});
  const sign = extra => anonymous('/api/mold-sign', {method: 'POST', body: body(extra)});
  check((await sign({document: {page: signaturePng({width: 1240, height: 1240}).toString('base64'), parts: linkParts}})).status, 400, 'a signature page that is not A4: refused');
  check((await sign({document: {page: signaturePagePng().toString('base64'), parts: 'x'}})).status, 400, 'parts that are not a list: refused');
  check((await sign({document: {page: signaturePagePng().toString('base64'), parts: [part(Buffer.from('another file'), 'quote', 'pdf', 'Q-77.pdf', 2), ...linkParts.slice(1)]}})).json(), {error: 'الطلب اتعدّل، افتح اللينك تاني.'}, 'a file changed between showing and signing (another SHA-256): refused as a change');
  check((await sign({document: {page: signaturePagePng().toString('base64'), parts: [{...linkParts[0], pages: 3}, ...linkParts.slice(1)]}})).status, 409, 'another count of pages than the file has: refused as a change');
  check((await dataOf(linkId)).awaitsSignature, true, 'nothing signed by those');
  const firstBody = body({});
  const signed = await anonymous('/api/mold-sign', {method: 'POST', body: firstBody});
  check(signed.status, 200, 'the customer signs from the link');
  const done = signed.json();
  check(done.copies.map(copy => copy.name), ['طلب القالب - موقّع.pdf'], 'one signed file, to download');
  const linkMerged = (await anonymous(done.copies[0].href + '?download=1')).bytes;
  pages = await pagesOf(linkMerged);
  check([pages.length, pages.map(images)], [7, [0, 0, 0, 0, 0, 1, 1]], 'downloaded from the thank-you page: 7 pages, the damaged PDF and the drawing left out');
  fs.writeFileSync(path.join(out, 'link-signed.pdf'), linkMerged);
  check((await anonymous('/api/mold-sign', {method: 'POST', body: firstBody})).json().copies.map(copy => copy.name), ['طلب القالب - موقّع.pdf'], 'the same submission again answers the same');
  await until(async () => sentFiles(linkId).some(file => file.name === 'طلب القالب - موقّع.pdf'), 'the request and its files go at once, the signed file with them');
  await new Promise(resolve => setTimeout(resolve, 800));
  const linkDoc = (await rows(linkId)).find(row => row.id.endsWith('-doc'));
  check([sentFiles(linkId).filter(file => file.name === 'طلب القالب - موقّع.pdf').length, sentFiles(linkId).find(file => file.name === 'طلب القالب - موقّع.pdf').category, sends(linkDoc.id), (await rows(linkId)).filter(row => row.id.startsWith('mdc-')).length], [1, 'quote', 1, 1], 'sent once, as a quotation\'s file; one made');
  shown = await view(linkId);
  check([shown.signing.via, shown.signing.document, shown.signing.copies], ['link', {state: 'made', pages: 7}, 0], 'the sheet: signed from the link, the signed file');
  check((await app.db.prepare("SELECT detail FROM crm_audit WHERE record_id=? AND action='mold-request:sign'").bind(linkId).first()).detail.includes('"document":3'), true, 'the signing audited with its documents');

  // Over production's limit for one file: two PDFs of 13 MB each: signed, the per-file copies instead, said so.
  const heavyA = await heavyPdf('A', 13), heavyB = await heavyPdf('B', 13);
  answer = await create({signatureLink: true});
  const heavyId = answer.json().request.id, heavyToken = answer.json().link.url.split('/').pop();
  await upload(heavyId, 'كبير أ.pdf', heavyA, 'quote'); await upload(heavyId, 'كبير ب.pdf', heavyB);
  page = await anonymous('/sign/m/' + heavyToken);
  const heavyKey = /"key":"([0-9a-f]{32})"/.exec(page.text.replaceAll('\\"', '"'))?.[1];
  const heavyCount = async bytes => (await PDFDocument.load(bytes)).getPageCount();
  answer = await anonymous('/api/mold-sign', {method: 'POST', body: body({token: heavyToken, key: heavyKey, document: {page: signaturePagePng().toString('base64'), parts: [part(heavyA, 'quote', 'pdf', 'كبير أ.pdf', await heavyCount(heavyA)), part(heavyB, 'design', 'pdf', 'كبير ب.pdf', await heavyCount(heavyB))]}})});
  check(answer.status, 200, 'signed');
  check(answer.json().copies.map(copy => copy.name).sort(), ['كبير أ - موقّع.pdf', 'كبير ب - موقّع.pdf'].sort(), 'the single file would pass 25 MB: a signed copy of each PDF instead');
  check((await view(heavyId)).signing.document, {state: 'fallback', reason: 'too_large'}, 'said so on the request');

  // ---- the old way: a page of the release before (no signature page): the per-file copies of before, from the link and from the device
  answer = await create({signatureLink: true});
  const oldId = answer.json().request.id, oldToken = answer.json().link.url.split('/').pop();
  await upload(oldId, 'Q-old.pdf', quote2, 'quote'); await upload(oldId, 'رسم قديم.pdf', design3);
  page = await anonymous('/sign/m/' + oldToken);
  const oldKey = /"key":"([0-9a-f]{32})"/.exec(page.text.replaceAll('\\"', '"'))?.[1];
  const oldBody = body({token: oldToken, key: oldKey}); delete oldBody.document;
  answer = await anonymous('/api/mold-sign', {method: 'POST', body: oldBody});
  check([answer.status, answer.json().copies.map(copy => copy.name).sort()], [200, ['Q-old - موقّع.pdf', 'رسم قديم - موقّع.pdf'].sort()], 'an old page\'s signature from the link: the per-file copies, as before');
  check((await view(oldId)).signing.document, undefined, 'no single file said for it');
  answer = await create({signature: {signer: 'م. خالد', png: signaturePng().toString('base64'), block: signaturePng({width: 960, height: 300, seed: 5}).toString('base64'), blockAt: new Date().toISOString(), seen: [sha(design3)]}});
  const oldDevice = answer.json().request.id;
  await upload(oldDevice, 'Q-1.pdf', quote2, 'quote'); await upload(oldDevice, 'رسم الجهاز القديم.pdf', design3);
  check((await view(oldDevice)).designFiles.filter(file => file.signedCopy).map(file => file.name), ['رسم الجهاز القديم - موقّع.pdf'], 'an old page\'s device signature: the copy of the PDF it saw, as before');
  // A signature page without its block (the fallback needs it) is refused.
  const noBlock = signature(deviceParts); delete noBlock.block; delete noBlock.blockAt;
  check((await create({signature: noBlock})).status, 400, 'a signature page without the block: refused');
  // ---- production's signed flag (schema 19): never sent to the application before; sent once seen, and kept there
  const designCalls = () => mock.state.calls.filter(call => call.route === 'design-files' && call.signed).map(call => JSON.parse(call.body));
  check([designCalls().length > 10, designCalls().some(line => Object.hasOwn(line, 'signed')), !!await app.db.prepare("SELECT 1 FROM crm_settings WHERE id='mold-signed-flag'").first()], [true, false, false], 'the application before: no "signed" key ever sent, nothing learned');
  mock.setSignedFlag(true);
  answer = await create({signatureLink: true});
  const flagId = answer.json().request.id, flagToken = answer.json().link.url.split('/').pop();
  await upload(flagId, 'Q-flag.pdf', quote2, 'quote'); await upload(flagId, 'رسم flag.pdf', design3);
  page = await anonymous('/sign/m/' + flagToken);
  const flagKey = /"key":"([0-9a-f]{32})"/.exec(page.text.replaceAll('\\"', '"'))?.[1];
  check((await anonymous('/api/mold-sign', {method: 'POST', body: body({token: flagToken, key: flagKey, document: {page: signaturePagePng().toString('base64'), parts: [part(quote2, 'quote', 'pdf', 'Q-flag.pdf', 2), part(design3, 'design', 'pdf', 'رسم flag.pdf', 3)]}})})).status, 200, 'signed from the link, schema 19 at production');
  await until(() => sentFiles(flagId).some(file => file.name === 'طلب القالب - موقّع.pdf'), 'the signed file reaches production');
  const flagLines = designCalls().filter(line => line.crmRequestId === flagId);
  check([flagLines.filter(line => line.signed === true).map(line => line.name), flagLines.filter(line => !Object.hasOwn(line, 'signed')).map(line => line.name).sort()], [['طلب القالب - موقّع.pdf'], ['Q-flag.pdf', 'رسم flag.pdf', 'توقيع العميل - سالم العميل.png'].sort()], 'learned from production\'s first file object: the signed file sent with "signed": true, the others as before');
  check([!!await app.db.prepare("SELECT 1 FROM crm_settings WHERE id='mold-signed-flag'").first(), sentFiles(flagId).find(file => file.name === 'طلب القالب - موقّع.pdf').signed, sentFiles(flagId).find(file => file.name === 'Q-flag.pdf').signed], [true, true, false], 'kept by the CRM; production marks it a signed copy');
  // Read from production's own data: the status the CRM keeps carries production's mark on each file object.
  await until(async () => (await view(flagId)).remote?.quoteFiles?.some(file => file.name === 'طلب القالب - موقّع.pdf'), 'production\'s listing read');
  shown = await view(flagId);
  check([shown.remote.quoteFiles.find(file => file.name === 'طلب القالب - موقّع.pdf').signed, shown.remote.quoteFiles.find(file => file.name === 'Q-flag.pdf').signed, shown.designFiles.find(file => file.name === 'طلب القالب - موقّع.pdf').signedCopy], [true, false, true], 'production\'s mark read with its listing (signed true / false), the sheet\'s «الملف الموقّع»');
  check(mock.state.calls.every(call => !JSON.stringify(call.headers).includes(mock.state.secret)), true, 'the shared secret never travels');
  console.log(JSON.stringify({ok: true, checks, files: out, scope: 'one signed document: the device and the link, sent once, a change refused, the size fallback, the old way', productionDataUsed: false}));
} finally {
  await app.stop(); await mock.stop();
}
