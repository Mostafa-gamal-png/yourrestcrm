// The customer signs ONE document (the owner, 2026-11-11: «pdf يتفتح ويكون عبارة عن عرض السعر او po وبعدين التصميم وفى اخره خانة
// للتوقيع ... كأنه بيوقع على ورق حقيقى»), its rules without a build: the signature page's checks and the documents it lists
// (portable/mold-rules.mjs), the page ranges, the order, the category, which pictures are pages and how a picture's page is laid out, the
// page count by pdf-lib (lib/mold-signed-document.ts), the signed document built with pdf-lib (lib/mold-signed-pdf.ts, transpiled): every
// page as it is (a rotated and a cropped page kept so), each picture an A4 page, the signature page last, a document that is not what the
// page listed refused (another count, a damaged PDF, a missing file, a GIF), over the limit refused (the caller falls back to the per-file
// copies); its last page rendered by poppler when it is on the machine; how the request's files are matched to the parts, the document's
// id, and how far the signing is (lib/mold-requests.ts). Synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {PDFDict, PDFDocument, PDFName} from 'pdf-lib';
import * as rules from '../portable/mold-rules.mjs';
import {signaturePng} from '../scripts/lib/signature-png.mjs';
import {DAMAGED_PDF, JPEG_TALL, JPEG_WIDE, encryptedPdf, makePdf, signaturePagePng} from '../scripts/lib/signed-document-fixtures.mjs';
import {request as httpsRequest} from 'node:https';
import {moldConfig, callProducts} from '../portable/mold-client.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';

let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const near = (actual, expected, message, within = 0.01) => { assert.ok(Math.abs(actual - expected) <= within, message + ': ' + actual + ' vs ' + expected); checks++; };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
globalThis.signTestEnv = {YR_APP_ORIGIN: 'https://crm.yourrest.org'};
const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'mold-signed-document-')), seen = new Set();
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
fs.writeFileSync(path.join(out, 'env.mjs'), 'export const env=globalThis.signTestEnv||{};');
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
for (const file of ['lib/mold-signed-document.ts', 'lib/mold-signed-pdf.ts', 'lib/mold-requests.ts', 'lib/mold-document-view.ts']) compile(file);
const doc = await import(path.join(out, 'lib/mold-signed-document.mjs'));
const pdf = await import(path.join(out, 'lib/mold-signed-pdf.mjs'));
const lib = await import(path.join(out, 'lib/mold-requests.mjs'));
const view = await import(path.join(out, 'lib/mold-document-view.mjs'));
const ar = (a) => a, en = (a, b) => b;

// ---- the signature page: a whole PNG of an A4 sheet, 1000..1800 wide, 1 MiB at most
{
  const page = signaturePagePng();
  check(rules.moldSignaturePageCheck(page), {ok: true, width: 1240, height: 1754}, 'an A4 PNG of 1240 × 1754 is taken');
  check(rules.moldSignaturePageCheck(signaturePng({width: 1000, height: 1414})).ok, true, 'from 1000 pixels wide');
  check(rules.moldSignaturePageCheck(signaturePng({width: 1240, height: 1240})), {ok: false, reason: 'size'}, 'a square is not a page');
  check(rules.moldSignaturePageCheck(signaturePng({width: 900, height: 1273})), {ok: false, reason: 'size'}, 'too narrow');
  check(rules.moldSignaturePageCheck(signaturePng({width: 1900, height: 2687})), {ok: false, reason: 'size'}, 'too wide');
  check(rules.moldSignaturePageCheck(page.subarray(0, page.length - 20)), {ok: false, reason: 'not_png'}, 'cut short');
  check(rules.moldSignaturePageCheck(JPEG_TALL), {ok: false, reason: 'not_png'}, 'a JPEG is not taken');
  check(rules.moldSignaturePageCheck(new Uint8Array(rules.MOLD_SIGNATURE_PAGE_MAX_BYTES + 1)), {ok: false, reason: 'too_large'}, 'over 1 MiB');
  check(rules.moldSignaturePageCheck(null), {ok: false, reason: 'missing'}, 'none');
  check(Buffer.from(rules.moldSignaturePageBytes(page.toString('base64'))).equals(page), true, 'its bytes from the base64 the form sends');
  check([rules.moldSignaturePageBytes('A'.repeat(rules.MOLD_SIGNATURE_PAGE_BASE64_MAX + 4)), rules.moldSignaturePageBytes('not base64!'), rules.moldSignaturePageBytes(12)], [null, null, null], 'too long, not base64, not text: none');
}

// ---- the documents a signed document lists
{
  const a = sha(Buffer.from('a')), b = sha(Buffer.from('b'));
  const good = [{sha256: a.toUpperCase(), category: 'quote', kind: 'pdf', name: 'Q-77.pdf', pages: 2}, {sha256: b, category: 'design', kind: 'image', name: 'رسم.png', pages: 1}];
  check(rules.moldSignedDocumentParts(good), [{sha256: a, category: 'quote', kind: 'pdf', name: 'Q-77.pdf', pages: 2}, {sha256: b, category: 'design', kind: 'image', name: 'رسم.png', pages: 1}], 'listed in order, the hash in small letters');
  check(rules.moldSignedDocumentParts([]), [], 'none listed (every file named only)');
  for (const [bad, why] of [[{...good[0], sha256: 'x'}, 'a hash that is not one'], [{...good[0], category: 'other'}, 'another category'], [{...good[0], kind: 'other'}, 'a kind that is no page'],
    [{...good[1], pages: 2}, 'a picture of two pages'], [{...good[0], pages: 0}, 'no page'], [{...good[0], pages: 1.5}, 'half a page'], [{...good[0], name: ''}, 'no name'], [{...good[0], name: 'a\u0001b.pdf'}, 'a control character'],
    [{...good[0], name: 'x'.repeat(201)}, 'a name over 200']]) check(rules.moldSignedDocumentParts([bad]), null, 'refused: ' + why);
  check([rules.moldSignedDocumentParts(Array(21).fill(good[0])), rules.moldSignedDocumentParts([{...good[0], pages: 2001}]), rules.moldSignedDocumentParts('x'), rules.moldSignedDocumentParts([null])], [null, null, null, null], 'more than 20, more than 2000 pages, not a list');
  check(rules.MOLD_SIGNED_DOCUMENT_NAME, 'طلب القالب - موقّع.pdf', 'one name for every request');
  check(['quote', 'po', 'design', 'other', undefined, 3].map(rules.moldSignedDocumentCategory), ['quote', 'po', 'design', null, null, null], 'the category the page saw: one of the three, else none');
  const pdfBytes = await makePdf('x', 1);
  for (const category of ['quote', 'po', 'design']) check(rules.moldDesignFileCheck(rules.MOLD_SIGNED_DOCUMENT_NAME, pdfBytes, category).ok, true, 'production\'s rules take the name as a PDF of ' + category);
}

// ---- the page ranges, the lines of the signature page, the order and the category
{
  const parts = [{sha256: 'q', category: 'quote', kind: 'pdf', name: 'Q-77.pdf', pages: 2}, {sha256: 'd', category: 'design', kind: 'pdf', name: 'تصميم.pdf', pages: 3}, {sha256: 'p', category: 'design', kind: 'image', name: 'صورة.png', pages: 1}];
  check(doc.docRanges(parts), [{first: 1, last: 2}, {first: 3, last: 5}, {first: 6, last: 6}], 'each document\'s pages in the whole');
  check([doc.docTotal(parts), doc.docTotal([])], [7, 1], 'the signature page counted: 7; a document of no page is the signature page alone');
  check(doc.docPartLines(parts, ar).map(line => line.label + ': ' + line.name + ' — ' + line.range.replace(/[\u2066-\u2069]/g, '')), ['عرض السعر: Q-77.pdf — صفحات 1–2', 'التصميم: تصميم.pdf — صفحات 3–5', 'صورة: صورة.png — صفحة 6'], 'the lines as the owner asked for them');
  check(doc.docPartLines(parts, ar)[0].range, 'صفحات \u20661–2\u2069', 'the range kept left to right inside the Arabic line');
  check(doc.docPartLines(parts, en).map(line => line.label + ': ' + line.range), ['Quotation: pages 1–2', 'Design: pages 3–5', 'Picture: page 6'], 'and in English');
  check(doc.docLeftLines([{name: 'mold.dwg', category: 'design', kind: 'other', reason: 'other'}, {name: 'محمي.pdf', category: 'quote', kind: 'pdf', reason: 'unopened'}], ar).map(line => line.label + ': ' + line.name + ' — ' + line.note),
    ['التصميم: mold.dwg — يُرسل إلى الإنتاج كما هو', 'عرض السعر: محمي.pdf — تعذّر فتحه — يُرسل إلى الإنتاج كما هو'], 'the files named only, each with why');
  check([doc.docPageText(3, 7, ar), doc.docPageText(3, 7, en), doc.docPageText(3, null, ar)], ['صفحة 3 من 7', 'Page 3 of 7', 'صفحة 3'], 'one counter for the whole document');
  check(view.orderViewerFiles([{category: 'design', n: 1}, {category: 'po', n: 2}, {category: 'quote', n: 3}, {category: 'design', n: 4}, {category: 'quote', n: 5}]).map(file => file.n), [3, 5, 2, 1, 4], 'the quotation\'s, the PO\'s, then the design\'s, each in its order');
  check([doc.docCategory(parts), doc.docCategory(parts.slice(1)), doc.docCategory([{category: 'po'}, {category: 'design'}]), doc.docCategory([], [{category: 'po'}]), doc.docCategory([])], ['quote', 'design', 'po', 'po', 'design'], 'the document\'s category: the first document\'s (quotation, else PO, else design)');
  check(doc.signPageMoment(new Date('2026-11-11T09:05:00Z')), '11/11/2026 - 12:05', 'the moment in Riyadh');
}

// ---- which pictures are pages, and how
{
  const header = (format, width, height) => { if (format === 'png') { const b = Buffer.alloc(33); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b, 0); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20); return b; }
    if (format === 'gif') { const b = Buffer.alloc(16); b.write('GIF89a', 0, 'latin1'); b.writeUInt16LE(width, 6); b.writeUInt16LE(height, 8); return b; }
    const b = Buffer.alloc(30); b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); b.write('VP8X', 12, 'latin1'); b.writeUIntLE(width - 1, 24, 3); b.writeUIntLE(height - 1, 27, 3); return b; };
  check([doc.imageLeftReason(signaturePng()), doc.imageLeftReason(JPEG_WIDE), doc.imageLeftReason(header('gif', 10, 10)), doc.imageLeftReason(header('webp', 10, 10)), doc.imageLeftReason(header('png', 5000, 4001)), doc.imageLeftReason(header('png', 5000, 4000)), doc.imageLeftReason(Buffer.from('nothing'))],
    [null, null, 'format', 'format', 'large', null, 'unopened'], 'PNG and JPEG are pages; GIF and WEBP named only; a PNG over 20 million pixels named only; what is no picture named only');
  const wide = doc.imagePageLayout(64, 40), tall = doc.imagePageLayout(40, 64);
  check([wide.pageWidth > wide.pageHeight, tall.pageWidth < tall.pageHeight], [true, true], 'a wide picture\'s page on its side, an upright one\'s upright');
  near(wide.x, (wide.pageWidth - wide.width) / 2, 'centred across'); near(wide.y, (wide.pageHeight - wide.height) / 2, 'and up and down');
  near(Math.max(wide.width / (wide.pageWidth - 56), wide.height / (wide.pageHeight - 56)), 1, 'it fills the page inside its margin');
  near(wide.width / wide.height, 64 / 40, 'its shape kept');
  near(tall.share.left + tall.share.width / 2, 0.5, 'the screen draws it at the same place (shares of the page)');
}

// ---- pdf-lib's count, as the device and the server read it
{
  const lib2 = {PDFDocument};
  check([await doc.pdfPageCount(lib2, await makePdf('a', 2)), await doc.pdfPageCount(lib2, await makePdf('b', 3, {rotate: {2: 90}})), await doc.pdfPageCount(lib2, await encryptedPdf()), await doc.pdfPageCount(lib2, DAMAGED_PDF)],
    [2, 3, null, null], 'pages counted; a protected or a damaged PDF does not open');
  const shapes = await doc.pdfPagePlan(lib2, await makePdf('c', 3, {rotate: {2: 90}, crop: [3]}));
  check([shapes.pages, shapes.aspects.map(value => Math.round(value * 1000) / 1000)], [3, [1.415, 0.707, 0.708]], 'each page\'s shape as shown: upright, turned (wider than high), cropped to its half');
}

// ---- the signed document: every page as it is, each picture a page, the signature page last
const quote2 = await makePdf('Quotation Q-77', 2), design3 = await makePdf('Mold design', 3, {rotate: {2: 90}, crop: [1]}), page = signaturePagePng();
const part = (bytes, category, kind, name, pages) => ({part: {sha256: sha(bytes), category, kind, name, pages}, read: async () => new Uint8Array(bytes)});
const at = new Date('2026-11-11T08:00:00Z');
{
  const built = await pdf.buildSignedDocument({sources: [part(quote2, 'quote', 'pdf', 'Q-77.pdf', 2), part(design3, 'design', 'pdf', 'تصميم.pdf', 3), part(JPEG_WIDE, 'design', 'image', 'صورة.jpg', 1)], page, at, maxBytes: rules.MOLD_DESIGN_MAX_BYTES});
  check([built.ok, built.pages], [true, 7], 'the quotation\'s 2 pages, the design\'s 3, the picture and the signature page: 7');
  const merged = await PDFDocument.load(built.bytes), pages = merged.getPages();
  check(pages.length, 7, 'seven pages in the file');
  check(pages.map(item => item.getRotation().angle), [0, 0, 0, 90, 0, 0, 0], 'the design\'s rotated page keeps its /Rotate');
  check([pages[2].getCropBox().height, pages[2].getMediaBox().height], [421, 842], 'the design\'s cropped page keeps its crop box');
  const sizes = pages.map(item => item.getSize()).map(size => [Math.round(size.width), Math.round(size.height)]);
  check([sizes[5], sizes[6]], [[842, 595], [595, 842]], 'the wide picture on an A4 page on its side; the signature page A4');
  const images = item => item.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)?.keys().length || 0;
  check(pages.map(images), [0, 0, 0, 0, 0, 1, 1], 'nothing stamped on the documents\' pages; one picture on the picture\'s page and on the signature page');
  check([merged.getTitle(), merged.getCreationDate()?.toISOString()], ['طلب القالب - موقّع', at.toISOString()], 'its title, and the signing\'s moment as its date');
  const again = await pdf.buildSignedDocument({sources: [part(quote2, 'quote', 'pdf', 'Q-77.pdf', 2), part(design3, 'design', 'pdf', 'تصميم.pdf', 3), part(JPEG_WIDE, 'design', 'image', 'صورة.jpg', 1)], page, at, maxBytes: rules.MOLD_DESIGN_MAX_BYTES});
  check(sha(again.bytes), sha(built.bytes), 'the same signature builds the same file');
  check(rules.moldDesignFileCheck(rules.MOLD_SIGNED_DOCUMENT_NAME, built.bytes, 'quote').ok, true, 'production\'s check of a PDF passes');
  // The last page rendered (poppler on the machine): the signature page's pixels, upright.
  if (process.env.YR_SKIP_PDFTOPPM !== '1') {
    try {
      const file = path.join(out, 'merged.pdf'); fs.writeFileSync(file, built.bytes);
      execFileSync('pdftoppm', ['-png', '-r', '40', '-f', '7', '-l', '7', file, path.join(out, 'last')], {stdio: 'ignore'});
      const png = fs.readFileSync(fs.readdirSync(out).filter(name => name.startsWith('last')).map(name => path.join(out, name))[0]);
      check(rules.moldImageSize(png).height > rules.moldImageSize(png).width, true, 'the rendered last page is upright (A4)');
      if (process.env.YR_MOLD_SCREENSHOT_DIR) fs.copyFileSync(file, path.join(process.env.YR_MOLD_SCREENSHOT_DIR, 'unit-merged.pdf'));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
{
  const sources = [part(quote2, 'quote', 'pdf', 'Q-77.pdf', 2)];
  check((await pdf.buildSignedDocument({sources: [part(quote2, 'quote', 'pdf', 'Q-77.pdf', 3)], page, at, maxBytes: 1e8})), {ok: false, reason: 'mismatch', detail: 'pages'}, 'another count of pages than the page listed: refused (the ranges would be wrong)');
  check((await pdf.buildSignedDocument({sources: [{part: sources[0].part, read: async () => null}], page, at, maxBytes: 1e8})), {ok: false, reason: 'mismatch', detail: 'missing'}, 'a document not found: refused');
  check((await pdf.buildSignedDocument({sources: [part(DAMAGED_PDF, 'quote', 'pdf', 'تالف.pdf', 1)], page, at, maxBytes: 1e8})), {ok: false, reason: 'mismatch', detail: 'unopened'}, 'a damaged PDF listed as a page: refused');
  check((await pdf.buildSignedDocument({sources: [part(await encryptedPdf(), 'quote', 'pdf', 'محمي.pdf', 1)], page, at, maxBytes: 1e8})).reason, 'mismatch', 'a protected PDF listed as a page: refused');
  const gif = Buffer.from('R0lGODlhAQABAAAAACw=', 'base64');
  check((await pdf.buildSignedDocument({sources: [part(gif, 'design', 'image', 'رسم.gif', 1)], page, at, maxBytes: 1e8})), {ok: false, reason: 'mismatch', detail: 'image'}, 'a GIF listed as a page: refused');
  check((await pdf.buildSignedDocument({sources, page, at, maxBytes: 2000})), {ok: false, reason: 'too_large'}, 'over production\'s limit for one file: too_large (the caller makes the per-file copies)');
  const alone = await pdf.buildSignedDocument({sources: [], page, at, maxBytes: 1e8});
  check([alone.ok, alone.pages], [true, 1], 'no document shown: the signature page alone');
  const tall = await pdf.buildSignedDocument({sources: [part(JPEG_TALL, 'po', 'image', 'po.jpg', 1)], page, at, maxBytes: 1e8});
  check((await PDFDocument.load(tall.bytes)).getPages().map(item => Math.round(item.getSize().width)), [595, 595], 'an upright picture on an upright A4 page');
  check((await pdf.buildSignedDocument({sources: [], page: Buffer.from('not a png'), at, maxBytes: 1e8})).reason, 'damaged', 'a signature page pdf-lib cannot embed: damaged');
}

// ---- the request's files matched to the parts, the document's id, how far the signing is
{
  const signatureId = 'mds-0f8e2c1a-5b7d-4c3e-9a1f-2b3c4d5e6f70', other = 'mds-11111111-2222-4333-8444-555555555555';
  const id = lib.moldSignedDocumentId(signatureId);
  check([id, rules.MOLD_ID.test(id), id.length <= 64], ['mdc-0f8e2c1a-5b7d-4c3e-9a1f-2b3c4d5e6f70-doc', true, true], 'the document\'s crmFileId: the contract\'s shape, fixed by the signature');
  check([lib.moldSignedOutputOf(id, signatureId), lib.moldSignedOutputOf(id, other), lib.moldSignedCopyOf(id, signatureId)], ['document', null, null], 'named by its own signature only, never taken for a per-file copy');
  const copy = lib.moldSignedCopyId(signatureId, 'mdf-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  check(lib.moldSignedOutputOf(copy, signatureId), 'mdf-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'a per-file copy is still its original\'s');
  const at2 = '2026-11-11T08:00:00.000Z', after = '2026-11-11T09:00:00.000Z';
  const file = (fileId, change = {}) => ({id: fileId, requestId: 'mr-1', memberId: 'rep', name: fileId + '.pdf', kind: 'pdf', contentType: 'application/pdf', size: 10, sha256: 'x', objectKey: 'k', createdAt: at2, deletedAt: null, outbox: 'send', attempts: 0, firstFailedAt: null, nextAttemptAt: at2, lastAttemptAt: null, lastError: null, remoteFileId: null, sentAt: null, version: 1, category: 'design', ...change});
  const q = file('mdf-11111111-0000-4000-8000-000000000001', {name: 'Q-77.pdf', sha256: 'a'.repeat(64), category: 'quote'}), d1 = file('mdf-11111111-0000-4000-8000-000000000002', {name: 'رسم 1.pdf', sha256: 'b'.repeat(64)}), d2 = file('mdf-11111111-0000-4000-8000-000000000003', {name: 'رسم 2.pdf', sha256: 'b'.repeat(64)});
  const gone = file('mdf-11111111-0000-4000-8000-000000000004', {name: 'محذوف.pdf', sha256: 'c'.repeat(64), deletedAt: at2});
  const parts = [{sha256: 'a'.repeat(64), category: 'quote', kind: 'pdf', name: 'Q-77.pdf', pages: 2}, {sha256: 'b'.repeat(64), category: 'design', kind: 'pdf', name: 'رسم 1.pdf', pages: 1}, {sha256: 'b'.repeat(64), category: 'design', kind: 'pdf', name: 'رسم 2.pdf', pages: 1}];
  let match = lib.moldSignedDocumentFiles(parts, [q, d1, d2]);
  check([match.complete, match.found.map(item => item?.id)], [true, [q.id, d1.id, d2.id]], 'each part a file of its hash and category; the same bytes twice take two files');
  match = lib.moldSignedDocumentFiles(parts, [q, d1]);
  check([match.complete, match.missing.map(item => item.name)], [false, ['رسم 2.pdf']], 'a file not uploaded yet: missing');
  check(lib.moldSignedDocumentFiles([{...parts[0], category: 'po'}], [q]).complete, false, 'another category is not the same document');
  check(lib.moldSignedDocumentFiles([{sha256: 'c'.repeat(64), category: 'design', kind: 'pdf', name: 'محذوف.pdf', pages: 1}], [gone]).complete, false, 'a deleted file is not one');
  const data = {requestedAt: at2, customer: {crmNumber: 27, name: 'مصنع', address: 'الدمام', city: ''}, salesman: {crmMemberId: 'rep', name: 'م', email: ''}, specs: {}, payment: 'cash', designRequired: true};
  const signed = {...data, signature: {signer: 'خالد', signedAt: at2, fileId: signatureId, via: 'device', block: {key: 'k', sha256: 's', width: 960, height: 300, at: at2}, document: {key: 'p', sha256: 's2', width: 1240, height: 1754, at: at2, parts}}};
  check(lib.moldSigningView({data: signed}, [q, d1]).document, {state: 'waiting', missing: ['رسم 2.pdf']}, 'waiting for the files the customer saw');
  const made = file(id, {name: 'طلب القالب - موقّع.pdf', category: 'quote'}), late = file('mdf-11111111-0000-4000-8000-000000000009', {name: 'بعد.pdf', createdAt: after});
  const shown = lib.moldSigningView({data: signed}, [q, d1, d2, made, late]);
  check([shown.document, shown.copies, shown.after, shown.stamped], [{state: 'made', pages: 5}, 0, ['بعد.pdf'], true], 'made (4 pages and the signature page); its parts are not «attached after»; one attached after is');
  const notMade = reason => file(id, {name: 'طلب القالب - موقّع.pdf', size: 0, objectKey: null, deletedAt: at2, outbox: null, nextAttemptAt: null, lastError: {code: 'not_signed', reason, http: 0, at: at2}});
  check([lib.moldSigningView({data: signed}, [q, d1, d2, notMade('too_large')]).document, lib.moldSigningView({data: signed}, [q, d1, d2, notMade('mismatch')]).document, lib.moldSigningView({data: signed}, [q, d1, d2, notMade('too_many_files')]).document],
    [{state: 'fallback', reason: 'too_large'}, {state: 'fallback', reason: 'mismatch'}, {state: 'fallback', reason: 'too_many_files'}], 'not made: why (the per-file copies made instead where they have room)');
  const refusedThere = (lastError) => file(id, {name: 'طلب القالب - موقّع.pdf', outbox: 'send', nextAttemptAt: null, lastError: {...lastError, at: at2, final: true}});
  check([lib.moldSigningView({data: signed}, [q, d1, d2, refusedThere({code: 'payload_too_large', http: 413})]).document, lib.moldSigningView({data: signed}, [q, d1, d2, refusedThere({code: 'invalid_payload', reason: 'too_many_files', http: 400})]).document],
    [{state: 'fallback', reason: 'too_large'}, {state: 'fallback', reason: 'too_many_files'}], 'refused by production once sent (413, or its category full there): the copies instead, said so');
  check(lib.moldSigningView({data: {...data, signature: {...signed.signature, document: undefined}}}, [q]).document, undefined, 'a signature of the release before says nothing of a document');
  const views = lib.moldDesignFilesView({id: 'mr-1', memberId: 'rep', cancelledAt: null, remote: null, accepted: null, data: signed}, [q, made], {id: 'rep'}, true);
  check(views.map(entry => [entry.crmFileId, !!entry.signedCopy, !!entry.signedDocument, entry.canDelete]), [[q.id, false, false, true], [id, true, true, false]], 'the document marked as the signed file, never deletable while its signature is the request\'s');
  check([lib.moldDesignCount({remote: null}, [q, made], 'quote', {originals: true}).crm, lib.moldDesignCount({remote: null}, [q, made], 'quote').crm], [1, 2], 'it takes none of the originals\' places (production counts it)');
}

// ---- production's signed flag (schema 19, yourrest-products#52): the body's line, reading it, learning it, the stand-in in both modes
{
  const line = body => JSON.parse(Buffer.from(body).toString('utf8').split('\n')[0]);
  const bytes = new Uint8Array(Buffer.from('%PDF-1.7 x'));
  check(line(rules.moldDesignFileBody({crmRequestId: 'mr-1', crmFileId: 'mdc-1-doc', name: rules.MOLD_SIGNED_DOCUMENT_NAME, category: 'quote', signed: true}, bytes)), {crmRequestId: 'mr-1', crmFileId: 'mdc-1-doc', name: 'طلب القالب - موقّع.pdf', category: 'quote', signed: true}, 'a signed file\'s line carries "signed": true');
  check([line(rules.moldDesignFileBody({crmRequestId: 'mr-1', crmFileId: 'f1', name: 'a.pdf'}, bytes)), line(rules.moldDesignFileBody({crmRequestId: 'mr-1', crmFileId: 'f1', name: 'a.pdf', signed: 'yes'}, bytes))], [{crmRequestId: 'mr-1', crmFileId: 'f1', name: 'a.pdf'}, {crmRequestId: 'mr-1', crmFileId: 'f1', name: 'a.pdf'}], 'any other line exactly as before');
  const entry = extra => rules.moldDesignFileEntry({fileId: 7, crmFileId: 'mdc-1-doc', name: 'x.pdf', kind: 'pdf', size: 3, source: 'crm', uploadedAt: '2026-11-11T09:00:00+03:00', ...extra}, 'quote');
  check([entry({signed: true}).signed, entry({signed: false}).signed, Object.hasOwn(entry({}), 'signed'), Object.hasOwn(entry({signed: 'yes'}), 'signed')], [true, false, false, false], 'read from production\'s file object when a boolean; none otherwise');
  check([rules.moldSignedFlagAnswered({designFiles: [{fileId: 1, signed: false}]}), rules.moldSignedFlagAnswered({quoteFiles: [{fileId: 1, signed: true}]}), rules.moldSignedFlagAnswered({fileId: 9, source: 'crm', signed: true}), rules.moldSignedFlagAnswered({designFiles: [{fileId: 1}]}), rules.moldSignedFlagAnswered({signed: 'x'}), rules.moldSignedFlagAnswered(null)],
    [true, true, true, false, false, false], 'schema 19 known from a file object carrying the boolean');
  const listed = lib.moldDesignFilesView({id: 'mr-1', memberId: 'rep', cancelledAt: null, accepted: {}, remote: {designFiles: [{fileId: 1, crmFileId: null, name: 'نسخة الإنتاج - موقّع.pdf', kind: 'pdf', size: 3, source: 'production', uploadedAt: null, category: 'design', signed: true}, {fileId: 2, crmFileId: null, name: 'رسم.pdf', kind: 'pdf', size: 3, source: 'production', uploadedAt: null, category: 'design', signed: false}]}, data: {}}, [], {id: 'rep'}, true);
  check(listed.map(file => [file.name, !!file.signedCopy]), [['نسخة الإنتاج - موقّع.pdf', true], ['رسم.pdf', false]], 'production\'s own mark shown as «نسخة موقّعة»');
  // The stand-in: the application before (no signed in file objects, the key ignored) and schema 19 (signed carried, a non-boolean refused).
  const fetchWith = caFile => { const authority = fs.readFileSync(caFile); return (url, init) => new Promise((resolve, reject) => { const req = httpsRequest(url, {method: init.method, headers: init.headers, ca: authority, signal: init.signal}, res => { const headers = new Headers(Object.entries(res.headers).flatMap(([key, value]) => Array.isArray(value) ? value.map(item => [key, item]) : [[key, value]])); const parts = []; res.on('data', part => parts.push(part)); res.on('end', () => { const bytes2 = Buffer.concat(parts); resolve({status: res.statusCode, headers, arrayBuffer: async () => bytes2}); }); }); req.on('error', reject); req.end(init.body ? Buffer.from(init.body) : undefined); }); };
  for (const signedFlag of [false, true]) {
    const mock = await startProductsMock({quotePo: true, nov10: true, signedFlag});
    try {
      const fetch = fetchWith(mock.ca), config = moldConfig({YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret}), call = (route, body) => callProducts(config, route, body, {fetch});
      const at3 = '2026-11-11T09:00:00+03:00', id = 'mr-00000000-0000-4000-8000-0000000000' + (signedFlag ? '19' : '17');
      const made = await call('requests', rules.moldRequestBody({id, requestedAt: at3, customer: {crmNumber: 27, name: 'مصنع', address: 'الدمام', city: 'Damam - الدمام'}, salesman: {crmMemberId: 'mem-1', name: 'أحمد', email: 'a@yourrest.org'}, specs: {description: 'قالب', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: '', quantity: 1, designUrl: '', notes: ''}, payment: 'cash'}));
      check(made.kind, 'ok', 'a request at the stand-in');
      const pdfBytes = new Uint8Array(await makePdf('q', 1));
      const raw = (meta) => { const metaLine = new TextEncoder().encode(JSON.stringify(meta) + '\n'), body = new Uint8Array(metaLine.length + pdfBytes.length); body.set(metaLine); body.set(pdfBytes, metaLine.length); return body; };
      const signedAnswer = await call('design-files', rules.moldDesignFileBody({crmRequestId: id, crmFileId: 'mdc-x-doc', name: rules.MOLD_SIGNED_DOCUMENT_NAME, category: 'quote', signed: true}, pdfBytes));
      const plainAnswer = await call('design-files', rules.moldDesignFileBody({crmRequestId: id, crmFileId: 'f-plain', name: 'Q.pdf', category: 'quote'}, pdfBytes));
      const bad = await call('design-files', raw({crmRequestId: id, crmFileId: 'f-bad', name: 'B.pdf', category: 'quote', signed: 'yes'}));
      const again = await call('design-files', rules.moldDesignFileBody({crmRequestId: id, crmFileId: 'mdc-x-doc', name: rules.MOLD_SIGNED_DOCUMENT_NAME, category: 'quote'}, pdfBytes));
      if (signedFlag) {
        check([signedAnswer.json.file.signed, plainAnswer.json.file.signed, rules.moldSignedFlagAnswered(signedAnswer.json.file), rules.moldSignedFlagAnswered(rules.moldStatusObject(plainAnswer.json.request))], [true, false, true, true], 'schema 19: signed carried on every file object, learned from the answer and the status object');
        check([bad.kind, bad.fields], ['rejected', ['signed']], 'a "signed" that is not a boolean: 400 fields ["signed"]');
        check([again.json.created, again.json.file.signed], [false, true], 'the same crmFileId and bytes again: created false, signed as first sent');
      } else {
        check([Object.hasOwn(signedAnswer.json.file, 'signed'), rules.moldSignedFlagAnswered(signedAnswer.json.file), rules.moldSignedFlagAnswered(rules.moldStatusObject(plainAnswer.json.request)), bad.kind], [false, false, false, 'ok'], 'the application before: the key ignored, no "signed" in the objects, nothing learned');
      }
      check(mock.row(id).quoteFiles?.length ?? (mock.row(id).designFiles || []).filter(file => file.category === 'quote').length, signedFlag ? 2 : 3, 'a signed file takes a place of its category like any other');
    } finally { await mock.stop(); }
  }
}

console.log(JSON.stringify({ok: true, checks, scope: 'one signed document: the signature page, the parts, the ranges, the build with pdf-lib, the matching and the view', productionDataUsed: false}));
