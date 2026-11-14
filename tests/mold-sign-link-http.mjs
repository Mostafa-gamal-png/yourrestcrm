// The customer's signature inside a mold request's PDFs and the link the customer signs from (the owner, 2026-11-10), over real HTTP
// against the BUILT release (run `pnpm build` first), sending to the stand-in production API (scripts/lib/products-mock.mjs):
// - the device path: a representative's request signed on the device with its block and the PDFs seen gets a signed copy of each seen PDF
//   as it is uploaded («… - موقّع.pdf», the same category, sent right after its original), none for a PDF attached after the signature, a
//   protected one or a damaged one (each said, with why), none when the category is full (said); a copy is not deletable; a page loaded
//   before (no block) makes no copy, as before;
// - the link path: a request made with the link is held («بانتظار توقيع العميل»), never sent (save, timetable, resend refused); only the
//   link's SHA-256 is stored; the public page and its files open through the token alone (another request's file, a forged, expired,
//   replaced or used link, a cancelled request: one neutral page); the customer's signature from the link is stored as the device's is,
//   the PDFs get their copies, the request and its files go to production at once; a request changed after the page was opened is
//   refused; the same submission again answers the same; the representative's own device signing from the sheet ends the link; who may
//   make or stop a link.
// Synthetic isolated fixtures only (PDFs made here with pdf-lib): temporary SQLite and object store, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PDFDict, PDFDocument, PDFName, StandardFonts, degrees} from 'pdf-lib';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';
import {signaturePng} from '../scripts/lib/signature-png.mjs';

if (!existsSync(new URL('../dist/standalone/app.cjs', import.meta.url))) throw new Error('Run pnpm build first: this test boots the built release.');
const members = [{id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'}, {id: 'sup', role: 'supervisor', sup: 'sm'}, {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'أحمد عبد العزيز'},
  {id: 'rep2', role: 'rep', sup: 'sm', region: 'eastern'}, {id: 'csm', role: 'customer_service_manager', sup: 'sm'}, {id: 'cs', role: 'customer_service', sup: 'csm'}];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const specs = {description: 'قالب بلوك 20 سم', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: 'M-20', quantity: 1, designUrl: '', notes: ''};
/** A real PDF of `pages` pages (pdf-lib), its last page turned by `rotate`. */
async function makePdf(label, {pages = 2, rotate = 0} = {}) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) { const page = doc.addPage([595, 842]); page.drawText(label + ' page ' + (i + 1), {x: 60, y: 760, size: 22, font}); if (i === pages - 1 && rotate) page.setRotation(degrees(rotate)); }
  return Buffer.from(await doc.save());
}
async function encryptedPdf() {
  const doc = await PDFDocument.create(); doc.addPage();
  doc.context.trailerInfo.Encrypt = doc.context.obj({Filter: 'Standard', V: 1, R: 2});
  return Buffer.from(await doc.save());
}
const damagedPdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >>\nthis is not a pdf body at all\n%%EOF\n');
const png = (width, height) => { const b = Buffer.alloc(33); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b, 0); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20); b[24] = 8; b[25] = 6; return b; };
const block = () => signaturePng({width: 960, height: 300, seed: 5}).toString('base64');
const signature = (extra = {}) => ({signer: 'م. خالد العتيبي', png: signaturePng().toString('base64'), block: block(), blockAt: new Date().toISOString(), ...extra});

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
  const create = (who, extra) => post(who, {action: 'create', customerId: 'east1', specs, payment: 'cash', address: 'الدمام، الصناعية الثانية', ...extra});
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
  const view = async (who, id) => (await (await as(who)('/api/mold-requests?id=' + id)).json()).requests[0];
  const dataOf = async id => JSON.parse((await app.db.prepare('SELECT data FROM crm_mold_requests WHERE id=?').bind(id).first()).data);
  const fileRows = async id => (await app.db.prepare('SELECT * FROM crm_mold_design_files WHERE request_id=? ORDER BY created_at,id').bind(id).all()).results;
  const sentFiles = id => (mock.row(id)?.designFiles || []).map(file => file.name);
  const requestsSent = id => mock.state.calls.filter(call => call.route === 'requests' && call.signed && call.body.includes('"crmRequestId":"' + id + '"')).length;
  const until = async (test, message, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await test()) return; await new Promise(resolve => setTimeout(resolve, 150)); } assert.fail('timed out: ' + message); };

  // ---- the device path: copies of the PDFs seen, none for the others, each said
  const seenPdf = await makePdf('design A'), rotatedPdf = await makePdf('design R', {rotate: 90}), protectedPdf = await encryptedPdf(), latePdf = await makePdf('late');
  let answer = await create('rep', {signature: signature({seen: [sha(seenPdf), sha(rotatedPdf), sha(protectedPdf), sha(damagedPdf)]})});
  check(answer.status, 200, 'the device signature with its block and the PDFs seen is taken');
  const deviceId = answer.json().request.id;
  let data = await dataOf(deviceId);
  check([data.signature.via, typeof data.signature.block?.key, data.signature.seen.length, Object.hasOwn(data, 'awaitsSignature')], ['device', 'string', 4, false], 'the data keeps how it was signed, the block\'s object and the PDFs seen');
  check(JSON.stringify((await view('rep', deviceId)).signature).includes('mold-sign-block'), false, 'the block\'s object key is never shown');
  for (const [name, bytes] of [['رسم القالب.pdf', seenPdf], ['جانبي.pdf', rotatedPdf], ['محمي.pdf', protectedPdf], ['تالف.pdf', damagedPdf], ['صورة.png', png(800, 600)], ['بعد التوقيع.pdf', latePdf]]) {
    const done = await upload('rep', deviceId, name, bytes);
    check(done.status, 200, 'uploaded: ' + name);
  }
  await until(async () => sentFiles(deviceId).length >= 9, 'the request and its files reach production');
  const sent = sentFiles(deviceId);
  check(sent.filter(name => name.endsWith(' - موقّع.pdf')), ['رسم القالب - موقّع.pdf', 'جانبي - موقّع.pdf'], 'a signed copy of each seen PDF that opens, sent to production');
  check([sent.indexOf('رسم القالب - موقّع.pdf') === sent.indexOf('رسم القالب.pdf') + 1, sent.indexOf('جانبي - موقّع.pdf') === sent.indexOf('جانبي.pdf') + 1], [true, true], 'each copy right after its original');
  let shown = await view('rep', deviceId);
  check(shown.signing.skipped.map(item => [item.name, item.reason]).sort(), [['تالف.pdf', 'damaged'], ['محمي.pdf', 'protected']], 'the protected and the damaged PDF got none, each said with why');
  check(shown.signing.after, ['بعد التوقيع.pdf'], 'a PDF attached after the signature (not seen) gets none, said so');
  check([shown.signing.copies, shown.signing.stamped, shown.signing.via], [2, true, 'device'], 'the sheet counts the copies');
  const copies = shown.designFiles.filter(file => file.signedCopy);
  check([copies.length, copies.every(file => !file.canDelete && file.category === 'design')], [2, true], 'the copies are marked, of the original\'s category, not deletable');
  // The copy is the original with one more image on its last page; the original is untouched.
  const copyBytes = (await as('rep')(copies[0].href)).bytes, copyDoc = await PDFDocument.load(copyBytes), originalDoc = await PDFDocument.load(seenPdf);
  check([copyDoc.getPageCount(), originalDoc.getPageCount()], [2, 2], 'the copy has the original\'s pages');
  const xobjects = doc => doc.getPages().map(page => page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)?.keys().length || 0);
  check(xobjects(copyDoc), [0, 1], 'one image on the last page only');
  check(sha((await as('rep')(shown.designFiles.find(file => file.name === 'رسم القالب.pdf').href)).bytes), sha(seenPdf), 'the original is served unchanged');
  const deleted = await as('rep')('/api/mold-requests/design-files/delete', {method: 'POST', body: {requestId: crypto.randomUUID(), id: deviceId, fileId: copies[0].crmFileId}});
  check([deleted.status, deleted.json().error], [409, 'لا تُحذف النسخة الموقّعة من الطلب ما دام التوقيع الذي عليها هو توقيع الطلب.'], 'a signed copy the signature names is not deleted');
  // Audited by the representative.
  const audits = (await app.db.prepare("SELECT action,actor FROM crm_audit WHERE record_id=? AND action LIKE 'mold-design:signed-copy%' ORDER BY created_at").bind(deviceId).all()).results;
  check([audits.filter(row => row.action === 'mold-design:signed-copy').length, audits.filter(row => row.action === 'mold-design:signed-copy-skipped').length, [...new Set(audits.map(row => row.actor))]], [2, 2, ['أحمد عبد العزيز']], 'each copy and each PDF without one is audited');

  // A page loaded before (a signature without its block): no copy, as before.
  answer = await create('rep', {signature: {signer: 'م. خالد', png: signaturePng().toString('base64')}});
  const oldPageId = answer.json().request.id;
  check((await upload('rep', oldPageId, 'قديم.pdf', await makePdf('old'))).status, 200, 'an older page\'s upload');
  check([(await fileRows(oldPageId)).filter(row => row.id.startsWith('mdc-')).length, (await view('rep', oldPageId)).signing.stamped], [0, false], 'no block: no copy, nothing said');

  // The category full: the copy would be the eleventh design file: none, said so.
  const lastPdf = await makePdf('full');
  answer = await create('rep', {signature: signature({seen: [sha(lastPdf)]})});
  const fullId = answer.json().request.id;
  for (let n = 0; n < 8; n++) await upload('rep', fullId, 'صورة ' + n + '.png', png(100 + n, 100));
  await upload('rep', fullId, 'العاشر.pdf', lastPdf);
  check((await view('rep', fullId)).signing.skipped, [{name: 'العاشر.pdf', reason: 'too_many_files'}], 'no room for a signed copy: none, said so');

  // ---- the link path
  const linkPdf = await makePdf('link design');
  answer = await create('rep', {signatureLink: true});
  check(answer.status, 200, 'a request with the link instead of the pad');
  const linkId = answer.json().request.id, made = answer.json().link;
  ok(made && made.url.startsWith(app.origin + '/sign/m/') && /^[A-Za-z0-9_-]{43}$/.test(made.url.split('/').pop()), 'the link is on the CRM\'s own origin, a 43-character token');
  const token = made.url.split('/').pop();
  data = await dataOf(linkId);
  check([data.awaitsSignature, data.signatureLink.hash, Object.hasOwn(data, 'signature')], [true, sha(token), false], 'kept waiting for the signature; only the token\'s SHA-256 is stored');
  check(Math.round((Date.parse(data.signatureLink.expiresAt) - Date.parse(data.signatureLink.sentAt)) / 86400_000), 14, 'valid 14 days');
  const everything = JSON.stringify((await app.db.prepare('SELECT data FROM crm_mold_requests').all()).results) + JSON.stringify((await app.db.prepare('SELECT detail FROM crm_audit').all()).results);
  check(everything.includes(token), false, 'the token itself is stored nowhere');
  check((await upload('rep', linkId, 'تصميم اللينك.pdf', linkPdf)).status, 200, 'its design file');
  check((await upload('rep', linkId, 'صورة اللينك.png', png(640, 480))).status, 200, 'and an image');
  shown = await view('rep', linkId);
  check([shown.sending.held, shown.signing.awaits, shown.signing.link.expired, shown.can.link], ['customer_signature', true, false, true], '«بانتظار توقيع العميل», its link open, the requester may renew it');
  check(requestsSent(linkId), 0, 'never sent while it waits');
  const resend = await post('rep', {action: 'resend', id: linkId});
  check([resend.status, resend.json().error], [409, 'الطلب بانتظار توقيع العميل؛ يُرسل الطلب تلقائيًا بمجرد أن يوقّع العميل من الرابط.'], 'resend refused with the reason');
  await app.db.prepare('UPDATE crm_mold_requests SET next_attempt_at=? WHERE id=?').bind('2020-01-01T00:00:00.000Z', linkId).run();
  await as('rep')('/api/mold-requests'); await new Promise(resolve => setTimeout(resolve, 1500));
  check(requestsSent(linkId), 0, 'the timetable does not send it either');

  // The public page and its files, without a session, through the token only.
  const anonymous = app.as(null);
  let page = await anonymous('/sign/m/' + token);
  check(page.status, 200, 'the page opens without a session');
  ok(page.text.includes('مصنع الشرق للطابوق') && page.text.includes('تصميم اللينك.pdf') && page.text.includes('صورة اللينك.png'), 'it shows the customer and the files');
  ok(/<meta name="robots" content="[^"]*noindex/.test(page.text), 'not indexed');
  check([page.text.includes('YR-C-'), page.text.includes('أحمد عبد العزيز'), page.text.includes('0551234567')], [false, false, false], 'nothing internal: no Yourrest code, no representative, no phone');
  const listed = (await fileRows(linkId)).filter(row => row.name === 'تصميم اللينك.pdf')[0];
  let file = await anonymous('/sign/m/' + token + '/file/' + listed.id);
  check([file.status, file.headers['content-type'], /^inline/.test(file.headers['content-disposition']), sha(file.bytes)], [200, 'application/pdf', true, sha(linkPdf)], 'its PDF opens inline through the token');
  const other = (await fileRows(deviceId)).find(row => row.name === 'رسم القالب.pdf');
  file = await anonymous('/sign/m/' + token + '/file/' + other.id);
  check([file.status, file.text.includes('هذا الرابط لم يعد صالحًا')], [404, true], 'another request\'s file: the neutral page');
  const forged = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
  for (const bad of [forged, 'short', token + 'x']) check((await anonymous('/sign/m/' + encodeURIComponent(bad))).text.includes('هذا الرابط لم يعد صالحًا'), true, 'forged or malformed: the neutral page');
  // Expired: the same page.
  await app.db.prepare("UPDATE crm_mold_requests SET data=json_set(data,'$.signatureLink.expiresAt','2020-01-01T00:00:00.000Z') WHERE id=?").bind(linkId).run();
  check([(await anonymous('/sign/m/' + token)).text.includes('هذا الرابط لم يعد صالحًا'), (await view('rep', linkId)).signing.link.expired], [true, true], 'expired: neutral page; the sheet says the link expired');
  // A new link (the old stops working) by the requester; another representative or the sales manager may not.
  shown = await view('rep', linkId);
  check((await post('rep2', {action: 'signature-link', op: 'new', id: linkId, version: shown.version})).status, 404, 'another representative does not reach it');
  check((await post('sm', {action: 'signature-link', op: 'new', id: linkId, version: shown.version})).status, 403, 'the sales manager reads it but makes no link');
  answer = await post('rep', {action: 'signature-link', op: 'new', id: linkId, version: shown.version});
  check(answer.status, 200, 'a new link');
  const token2 = answer.json().link.url.split('/').pop();
  check([token2 !== token, (await anonymous('/sign/m/' + token)).text.includes('هذا الرابط لم يعد صالحًا'), (await anonymous('/sign/m/' + token2)).text.includes('تصميم اللينك.pdf')], [true, true, true], 'the old link stops working, the new one opens');

  // Signing from the link: the page's key, the request changed after the page opened, the consent, then the signature.
  page = await anonymous('/sign/m/' + token2);
  const key = /"key":"([0-9a-f]{32})"/.exec(page.text.replaceAll('\\"', '"'))?.[1];
  ok(key, 'the page carries its key');
  const sign = (body, cookie = null) => app.as(cookie)('/api/mold-sign', {method: 'POST', body: {requestId: crypto.randomUUID(), token: token2, key, signer: 'سالم العميل', png: signaturePng({seed: 9}).toString('base64'), block: block(), blockAt: new Date().toISOString(), consent: true, ...body}});
  check((await sign({consent: false})).status, 400, 'no consent: refused');
  check((await sign({key: '0'.repeat(32)})).json(), {error: 'عُدِّل الطلب؛ افتح الرابط مرة أخرى.'}, 'another key (the request changed): refused, open again');
  check((await sign({token: forged})).json().gone, true, 'a forged token: the neutral answer');
  check((await sign({blockAt: '2020-01-01T00:00:00.000Z'})).status, 400, 'a moment far from the server\'s: refused');
  check((await anonymous('/api/mold-sign', {method: 'POST', headers: {Origin: 'https://evil.example'}, body: {}})).status, 403, 'another origin: refused');
  // Changed after the page was opened (a file attached): refused.
  await upload('rep', linkId, 'أضيف بعد الفتح.pdf', await makePdf('added'));
  check((await sign({})).status, 409, 'a file attached after the page opened: refused (changed)');
  page = await anonymous('/sign/m/' + token2);
  const key2 = /"key":"([0-9a-f]{32})"/.exec(page.text.replaceAll('\\"', '"'))?.[1];
  const body = {requestId: crypto.randomUUID(), token: token2, key: key2, signer: 'سالم العميل', png: signaturePng({seed: 9}).toString('base64'), block: block(), blockAt: new Date().toISOString(), consent: true};
  const signed = await anonymous('/api/mold-sign', {method: 'POST', body});
  check(signed.status, 200, 'the customer signs from the link');
  const done = signed.json();
  check([done.ok, done.signer, done.copies.map(copy => copy.name).sort()], [true, 'سالم العميل', ['أضيف بعد الفتح - موقّع.pdf', 'تصميم اللينك - موقّع.pdf']], 'its signed copies, to download');
  data = await dataOf(linkId);
  check([data.signature.via, data.signature.signer, Object.hasOwn(data, 'awaitsSignature'), Object.hasOwn(data, 'signatureLink'), data.signature.link.hash], ['link', 'سالم العميل', false, false, sha(token2)], 'stored as the device stores it, with how: the wait and the link gone');
  await until(async () => requestsSent(linkId) === 1 && sentFiles(linkId).length >= 6, 'the request and its files go at once');
  check(sentFiles(linkId).filter(name => name.endsWith('.pdf')), ['تصميم اللينك.pdf', 'أضيف بعد الفتح.pdf', 'تصميم اللينك - موقّع.pdf', 'أضيف بعد الفتح - موقّع.pdf'], 'the PDFs, then their copies (made after the signature)');
  ok(sentFiles(linkId).some(name => name.startsWith('توقيع العميل - سالم العميل')), 'the signature image goes as today');
  const signAudit = await app.db.prepare("SELECT actor FROM crm_audit WHERE record_id=? AND action='mold-request:sign'").bind(linkId).first();
  check(signAudit.actor, 'سالم العميل (العميل، من الرابط)', 'audited, the customer by name, from the link');
  check((await anonymous('/api/mold-sign', {method: 'POST', body})).json().signer, 'سالم العميل', 'the same submission again answers the same');
  check((await anonymous('/sign/m/' + token2)).text.includes('هذا الرابط لم يعد صالحًا'), true, 'the used link\'s page: neutral');
  check((await anonymous(done.copies[0].href + '?download=1')).status, 200, 'its signed copies download through it that day');
  check((await anonymous('/sign/m/' + token2 + '/file/' + listed.id)).status, 404, 'but nothing else');
  shown = await view('rep', linkId);
  check([shown.signing.via, shown.signing.copies, shown.sending.held ?? null, shown.signature.signer], ['link', 2, null, 'سالم العميل'], 'the sheet: signed from the link, its copies');

  // A cancelled request: its link stops working.
  answer = await create('rep', {signatureLink: true});
  const cancelledId = answer.json().request.id, token3 = answer.json().link.url.split('/').pop();
  check((await anonymous('/sign/m/' + token3)).status, 200, 'its page opens');
  shown = await view('rep', cancelledId);
  check((await post('rep', {action: 'cancel', id: cancelledId, version: shown.version, reason: ''})).status, 200, 'cancelled');
  check((await anonymous('/sign/m/' + token3)).text.includes('هذا الرابط لم يعد صالحًا'), true, 'a cancelled request\'s link: neutral');
  check((await app.as(null)('/api/mold-sign', {method: 'POST', body: {...body, requestId: crypto.randomUUID(), token: token3}})).status, 404, 'and its signing refused');

  // The representative's own device signing from the sheet: the link stops, the request goes.
  answer = await create('rep', {signatureLink: true});
  const sheetId = answer.json().request.id, token4 = answer.json().link.url.split('/').pop();
  await upload('rep', sheetId, 'رسم الجهاز.pdf', await makePdf('sheet'));
  shown = await view('rep', sheetId);
  check((await post('rep', {action: 'sign', id: sheetId, version: shown.version})).status, 400, 'signing on the device needs the signature');
  answer = await post('rep', {action: 'sign', id: sheetId, version: shown.version, signature: signature()});
  check(answer.status, 200, 'the customer signs on the device from the sheet');
  check([(await anonymous('/sign/m/' + token4)).text.includes('هذا الرابط لم يعد صالحًا'), (await dataOf(sheetId)).signature.via], [true, 'device'], 'the link stopped');
  await until(async () => sentFiles(sheetId).includes('رسم الجهاز - موقّع.pdf'), 'its copy goes to production');
  check((await post('rep', {action: 'sign', id: sheetId, version: (await view('rep', sheetId)).version, signature: signature()})).status, 409, 'nothing waits any more');

  // Stopping a link; a signature and a link together are refused.
  answer = await create('rep', {signatureLink: true});
  const stopId = answer.json().request.id, token5 = answer.json().link.url.split('/').pop();
  check((await view('rep', stopId)).sending.held, 'design_file', 'its design file is waited for first (the precedence: files, then the signature)');
  await upload('rep', stopId, 'رسم.png', png(300, 200));
  shown = await view('rep', stopId);
  check((await post('rep', {action: 'signature-link', op: 'cancel', id: stopId, version: shown.version})).status, 200, 'the link stopped');
  check([(await anonymous('/sign/m/' + token5)).text.includes('هذا الرابط لم يعد صالحًا'), (await view('rep', stopId)).signing.link, (await view('rep', stopId)).sending.held], [true, null, 'customer_signature'], 'its page neutral; still waiting for the signature');
  answer = await create('rep', {signatureLink: true, signature: signature()});
  check([answer.status, answer.json().fields?.signature], [400, 'اختر أحد الأمرين: أن يوقّع العميل الآن، أو رابطًا يوقّع منه، لا كليهما.'], 'both together refused');

  // pdf-lib is part of the release itself: bundled into the server's build (so the update package carries it), nothing to install.
  const serverFiles = (dir => { const out = []; const walk = d => { for (const entry of readdirSync(d, {withFileTypes: true})) entry.isDirectory() ? walk(join(d, entry.name)) : out.push(join(d, entry.name)); }; walk(dir); return out; })(fileURLToPath(new URL('../dist/standalone/dist/server', import.meta.url)));
  check([serverFiles.some(file => file.endsWith('.js') && readFileSync(file, 'utf8').includes('wrapContentStreams')), existsSync(fileURLToPath(new URL('../dist/standalone/node_modules/pdf-lib', import.meta.url)))], [true, false], 'pdf-lib is bundled into the built server (no separate module to ship)');
  check(mock.state.calls.every(call => !JSON.stringify(call.headers).includes(mock.state.secret)), true, 'the shared secret never travels');
  console.log(JSON.stringify({ok: true, checks, scope: 'mold signing: signed copies, the signing link', productionDataUsed: false}));
} finally {
  await app.stop(); await mock.stop();
}
