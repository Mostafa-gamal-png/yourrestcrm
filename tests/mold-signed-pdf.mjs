// The customer's signature inside a mold request's PDFs and the signing link (the owner, 2026-11-10), its rules without a build: the
// stamping (lib/mold-signed-pdf.ts, transpiled) on PDFs made here with pdf-lib (the last page only, its size and place on a page of each
// rotation and of an unusual size, the original untouched, a protected or damaged PDF and a non-PDF refused), its pixels when poppler's
// pdftoppm is on the machine (the block is drawn where the page shows its bottom-left, upright); the copy's name and id, the block's
// checks, the moment's window and the PDFs seen (portable/mold-rules.mjs); why a request is kept (moldHeldFor's customer_signature, last)
// and how far the signing is (moldSigningView); the token (256 random bits, base64url, only its SHA-256 kept) and the page's key
// (lib/mold-sign-server.ts, transpiled with a stand-in environment). Synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {PDFDict, PDFDocument, PDFName, StandardFonts, degrees} from 'pdf-lib';
import * as rules from '../portable/mold-rules.mjs';
import {signaturePng} from '../scripts/lib/signature-png.mjs';

let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const near = (actual, expected, message, within = 0.01) => { assert.ok(Math.abs(actual - expected) <= within, message + ': ' + actual + ' vs ' + expected); checks++; };
globalThis.signTestEnv = {YR_APP_ORIGIN: 'https://crm.yourrest.org'};
const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'mold-signed-pdf-')), seen = new Set();
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
for (const file of ['lib/mold-signed-pdf.ts', 'lib/mold-requests.ts', 'lib/mold-sign-server.ts']) compile(file);
const stamp = await import(path.join(out, 'lib/mold-signed-pdf.mjs'));
const lib = await import(path.join(out, 'lib/mold-requests.mjs'));
const server = await import(path.join(out, 'lib/mold-sign-server.mjs'));

const block = signaturePng({width: 960, height: 300, seed: 4});
async function makePdf({pages = 2, size = [595, 842], rotate = 0} = {}) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) { const page = doc.addPage(size); page.drawText('page ' + (i + 1), {x: size[0] / 2 - 20, y: size[1] / 2, size: 14, font}); if (i === pages - 1 && rotate) page.setRotation(degrees(rotate)); }
  return new Uint8Array(await doc.save());
}
const images = doc => doc.getPages().map(page => page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)?.keys().length || 0);

// ---- the placement on a displayed page: bottom-left, 37% of the displayed width, capped at 30% of its height, upright
{
  const a4 = {x: 0, y: 0, width: 595, height: 842};
  let placed = stamp.blockPlacement({...a4, rotation: 0}, {width: 960, height: 300});
  near(placed.width, 0.37 * 595, 'a portrait page: 37% of its width'); near(placed.height, placed.width * 300 / 960, 'the block keeps its shape');
  check([placed.rotate, placed.x === placed.y, placed.x > 5 && placed.x < 25], [0, true, true], 'bottom-left, a margin from both edges');
  placed = stamp.blockPlacement({...a4, rotation: 90}, {width: 960, height: 300});
  near(placed.width, 0.37 * 842, 'turned 90°: 37% of the displayed (landscape) width');
  check([placed.rotate, placed.x > 595 - 25, placed.y < 25], [90, true, true], 'turned 90°: at the user space\'s right edge (the displayed bottom), upright when shown');
  check([stamp.blockPlacement({...a4, rotation: 180}, {width: 960, height: 300}).rotate, stamp.blockPlacement({...a4, rotation: 270}, {width: 960, height: 300}).rotate, stamp.blockPlacement({...a4, rotation: -90}, {width: 960, height: 300}).rotate], [180, 270, 270], 'each rotation, -90 read as 270');
  // An unusual size: a wide, low strip caps the block at 30% of its height; a box not at the origin moves it with the box.
  placed = stamp.blockPlacement({x: 0, y: 0, width: 2000, height: 200, rotation: 0}, {width: 960, height: 300});
  near(placed.height, 60, 'a low page: the block at 30% of its height'); near(placed.width, 60 * 960 / 300, 'and narrower than 37%');
  placed = stamp.blockPlacement({x: 100, y: 50, width: 595, height: 842, rotation: 0}, {width: 960, height: 300});
  check([placed.x > 100, placed.y > 50], [true, true], 'a crop box away from the origin');
}

// ---- stamping real PDFs
{
  const original = await makePdf();
  const result = await stamp.stampSignaturePdf(original, block);
  check([result.ok, result.pages], [true, 2], 'stamped');
  const copy = await PDFDocument.load(result.bytes), before = await PDFDocument.load(original);
  check([copy.getPageCount(), images(copy), images(before)], [2, [0, 1], [0, 0]], 'one image on the last page only; the original untouched');
  check(rules.moldDesignFileCheck('x.pdf', result.bytes).ok, true, 'the copy is a PDF production accepts (its header within the first 1024 bytes)');
  // The page's earlier content is wrapped (q … Q) before the block is drawn, so a transformation it leaves behind cannot move it.
  const last = copy.getPages()[1], contents = last.node.Contents();
  ok(contents && contents.size?.() >= 3, 'the last page\'s content: the wrap, the original, the block');
  for (const rotate of [90, 180, 270]) {
    const turned = await stamp.stampSignaturePdf(await makePdf({rotate}), block);
    check([turned.ok, turned.placement.rotate], [true, rotate], 'a last page turned ' + rotate + '°');
  }
  const odd = await stamp.stampSignaturePdf(await makePdf({pages: 1, size: [1200, 300]}), block);
  check([odd.ok, odd.placement.height <= 0.3 * 300 + 0.001], [true, true], 'an unusual page size: the block within it');
  // Protected, damaged, not a PDF.
  const doc = await PDFDocument.create(); doc.addPage(); doc.context.trailerInfo.Encrypt = doc.context.obj({Filter: 'Standard', V: 1, R: 2});
  check(await stamp.stampSignaturePdf(new Uint8Array(await doc.save()), block), {ok: false, reason: 'protected'}, 'an encrypted PDF: protected');
  check(await stamp.stampSignaturePdf(new TextEncoder().encode('%PDF-1.4\n% not really\n%%EOF\n'), block), {ok: false, reason: 'damaged'}, 'a damaged PDF: damaged');
  check(await stamp.stampSignaturePdf(original.subarray(0, 300), block), {ok: false, reason: 'damaged'}, 'a PDF cut short: damaged');
  check(await stamp.stampSignaturePdf(signaturePng(), block), {ok: false, reason: 'damaged'}, 'not a PDF (an image): damaged');
  check(await stamp.stampSignaturePdf(original, new Uint8Array([1, 2, 3])), {ok: false, reason: 'damaged'}, 'a block that is no PNG: no copy');
  // The pixels, when poppler is here: the block's dark ink in the bottom-left of the displayed last page, the top right left white.
  let poppler = true;
  try { execFileSync('pdftoppm', ['-v'], {stdio: 'ignore'}); } catch { poppler = false; }
  if (poppler) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'signed-pdf-'));
    try {
      for (const rotate of [0, 90, 180, 270]) {
        const turned = await stamp.stampSignaturePdf(await makePdf({rotate}), block), file = path.join(work, 'r' + rotate + '.pdf');
        fs.writeFileSync(file, turned.bytes);
        execFileSync('pdftoppm', ['-gray', '-r', '50', '-f', '2', '-l', '2', file, path.join(work, 'r' + rotate)]);
        const pgm = fs.readdirSync(work).find(name => name.startsWith('r' + rotate + '-') && name.endsWith('.pgm'));
        const bytes = fs.readFileSync(path.join(work, pgm)), header = bytes.toString('latin1', 0, 30).split(/\s+/), width = Number(header[1]), height = Number(header[2]);
        const pixels = bytes.subarray(bytes.length - width * height), dark = (x0, y0, x1, y1) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (pixels[y * width + x] < 200) n++; return n; };
        const sideways = rotate === 90 || rotate === 270;
        check([width > height, sideways], [sideways, sideways], 'rendered as displayed (' + rotate + '°)');
        ok(dark(0, Math.floor(height * 0.85), Math.floor(width * 0.45), height) > 20, 'the block\'s ink at the displayed bottom-left (' + rotate + '°)');
        check(dark(Math.floor(width * 0.55), Math.floor(height * 0.85), width, height), 0, 'nothing at the displayed bottom-right (' + rotate + '°)');
      }
    } finally { fs.rmSync(work, {recursive: true, force: true}); }
  } else console.log(JSON.stringify({note: 'pdftoppm not found: the pixel checks were skipped, the structure checked'}));
}
function ok(value, message) { assert.ok(value, message); checks++; }

// ---- the copy's name, the block's checks, the moment, the PDFs seen
{
  check(rules.moldSignedCopyName('رسم القالب 1380.pdf'), 'رسم القالب 1380 - موقّع.pdf', 'the copy\'s name');
  check(rules.moldSignedCopyName('ORDER.PDF'), 'ORDER - موقّع.pdf', 'an upper-case extension');
  const long = 'ق'.repeat(196) + '.pdf', named = rules.moldSignedCopyName(long);
  check([[...named].length <= 200, named.endsWith(' - موقّع.pdf'), rules.moldDesignName(named)?.kind], [true, true, 'pdf'], 'a long name shortened within 200 characters, still a PDF name production takes');
  check(rules.moldSignatureBlockCheck(block), {ok: true, width: 960, height: 300}, 'the block as the pages compose it');
  check([rules.moldSignatureBlockCheck(signaturePng({width: 480, height: 200})).reason, rules.moldSignatureBlockCheck(signaturePng({width: 700, height: 600})).reason, rules.moldSignatureBlockCheck(null).reason, rules.moldSignatureBlockCheck(new Uint8Array([137, 80, 78, 71])).reason],
    ['size', 'size', 'missing', 'not_png'], 'too small, not wide enough, none, not a PNG');
  const at = Date.parse('2026-11-10T10:00:00.000Z');
  check([rules.moldSignatureBlockAt('2026-11-10T10:05:00.000Z', at), rules.moldSignatureBlockAt('2026-11-10T10:11:00.000Z', at), rules.moldSignatureBlockAt('2026-11-10 10:00', at), rules.moldSignatureBlockAt(5, at)], ['2026-11-10T10:05:00.000Z', null, null, null], 'the moment within 10 minutes of the server\'s');
  const hex = 'A'.repeat(64);
  check([rules.moldSignatureSeen(undefined), rules.moldSignatureSeen([hex, hex.toLowerCase()]), rules.moldSignatureSeen(['nothex']), rules.moldSignatureSeen(Array(21).fill(hex))], [[], ['a'.repeat(64)], null, null], 'the PDFs seen: hex SHA-256, once each, at most 20');
  check(rules.moldSignatureBlockBytes('A'.repeat(rules.MOLD_SIGNATURE_BLOCK_BASE64_MAX + 4)), null, 'a block over its limit is not read');
}

// ---- the copy's id, why a request is kept, how far the signing is
{
  const signatureId = 'mds-0f8e2c1a-5b7d-4c3e-9a1f-2b3c4d5e6f70', other = 'mds-11111111-2222-4333-8444-555555555555', original = 'mdf-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const id = lib.moldSignedCopyId(signatureId, original);
  check([id.length <= 64, rules.MOLD_ID.test(id), lib.moldSignedCopyOf(id, signatureId), lib.moldSignedCopyOf(id, other), lib.moldSignedCopyOf(original, signatureId)], [true, true, original, null, null], 'a copy\'s id: fixed by the signature and the original, the contract\'s shape, named by its signature only');
  check(lib.moldSignedCopyId(other, original) === id, false, 'another signature makes another id');
  const at = '2026-11-10T08:00:00.000Z', after = '2026-11-10T09:00:00.000Z';
  const data = {requestedAt: at, customer: {crmNumber: 27, name: 'مصنع', address: 'الدمام', city: ''}, salesman: {crmMemberId: 'rep', name: 'م', email: ''}, specs: {}, payment: 'cash', designRequired: true};
  const row = change => ({outbox: 'send', accepted: null, remote: null, lastAttemptAt: null, lastError: null, ...change});
  const file = (fileId, change = {}) => ({id: fileId, requestId: 'mr-1', memberId: 'rep', name: fileId + '.pdf', kind: 'pdf', contentType: 'application/pdf', size: 10, sha256: 'x', objectKey: 'k', createdAt: at, deletedAt: null, outbox: 'send', attempts: 0, firstFailedAt: null, nextAttemptAt: at, lastAttemptAt: null, lastError: null, remoteFileId: null, sentAt: null, version: 1, category: 'design', ...change});
  const design = file(original);
  check([lib.moldHeldFor(row({data: {...data, awaitsSignature: true}}), []), lib.moldHeldFor(row({data: {...data, awaitsSignature: true}}), [design]), lib.moldHeldFor(row({data: {...data, awaitsSignature: true, fileRequired: true}}), [design]),
    lib.moldHeldFor(row({data: {...data, awaitsSignature: true}, accepted: data}), [design]), lib.moldHeldFor(row({data: {...data, awaitsSignature: true, fileRequired: true}, accepted: data}), []),
    lib.moldHeldFor(row({data}), [design]), lib.moldHeldFor(row({data: {...data, awaitsSignature: true}, outbox: null}), [design])],
    ['design_file', 'customer_signature', 'quote_file', 'customer_signature', 'customer_signature', null, null],
    'customer_signature after the files\' reasons; since finance\'s return (2026-11-10) a correction production holds waits for it too (the files\' reasons are a new request\'s only); nothing for one that does not wait or is not to be sent');
  const signed = {...data, signature: {signer: 'خالد', signedAt: at, fileId: signatureId, via: 'link', block: {key: 'k', sha256: 's', width: 960, height: 300, at}}};
  const made = file(id, {name: 'x - موقّع.pdf'}), skippedId = lib.moldSignedCopyId(signatureId, 'mdf-cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  const skipped = file(skippedId, {name: 'y - موقّع.pdf', size: 0, objectKey: null, deletedAt: at, outbox: null, nextAttemptAt: null, lastError: {code: 'not_signed', reason: 'protected', http: 0, at}});
  const protectedFile = file('mdf-cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee', {name: 'محمي.pdf'}), late = file('mdf-dddddddd-bbbb-4ccc-8ddd-eeeeeeeeeeee', {name: 'متأخر.pdf', createdAt: after}), image = file('mdf-eeeeeeee-bbbb-4ccc-8ddd-eeeeeeeeeeee', {kind: 'image', name: 'صورة.png', createdAt: after});
  const view = lib.moldSigningView({data: signed}, [design, made, protectedFile, skipped, late, image]);
  check(view, {awaits: false, link: null, via: 'link', stamped: true, copies: 1, skipped: [{name: 'محمي.pdf', reason: 'protected'}], after: ['متأخر.pdf']}, 'how far the signing is: one copy, one PDF protected, one attached after (an image is no PDF)');
  const waiting = lib.moldSigningView({data: {...data, awaitsSignature: true, signatureLink: {hash: 'h', sentAt: at, expiresAt: '2020-01-01T00:00:00.000Z', by: 'rep'}}}, []);
  check([waiting.awaits, waiting.link.expired, waiting.stamped, waiting.copies], [true, true, false, 0], 'waiting, its link expired');
  check(lib.moldSigningView({data: {...data, signature: {signer: 'خ', signedAt: at, fileId: signatureId}}}, [design, late]).after, [], 'a signature without its block (asked before) says nothing of copies');
  const views = lib.moldDesignFilesView({id: 'mr-1', memberId: 'rep', cancelledAt: null, remote: null, accepted: null, data: signed}, [design, made, skipped], {id: 'rep'}, true);
  check(views.map(entry => [entry.crmFileId, !!entry.signedCopy, entry.canDelete]), [[original, false, true], [id, true, false]], 'the copy marked and not deletable; the row of a copy not made is not listed');
  check(lib.moldNotSignedText('محمي.pdf', 'protected', ar => ar), 'ما اتحطش التوقيع جوه محمي.pdf: الملف محمي أو تالف', 'the sheet\'s words');
}

// ---- the token and the page's key
{
  const tokens = new Set();
  for (let n = 0; n < 2000; n++) tokens.add(server.newSignToken());
  const one = [...tokens][0], decoded = Buffer.from(one.replace(/-/g, '+').replace(/_/g, '/') + '=', 'base64');
  check([tokens.size, [...tokens].every(token => rules.MOLD_SIGN_TOKEN.test(token)), decoded.length], [2000, true, 32], 'tokens: 32 random bytes (256 bits), base64url, no two alike');
  const made = await server.newSignLink('rep', '2026-11-10T08:00:00.000Z');
  check([made.link.hash, JSON.stringify(made.link).includes(made.token), made.link.expiresAt, server.signLinkUrl(made.token)],
    [createHash('sha256').update(made.token).digest('hex'), false, '2026-11-24T08:00:00.000Z', 'https://crm.yourrest.org/sign/m/' + made.token], 'only the SHA-256 is kept; 14 days; on the CRM\'s origin');
  const request = {id: 'mr-1', version: 3, data: {}}, files = [{id: 'mdf-1', kind: 'pdf', sha256: 'a', deletedAt: null, objectKey: 'k', outbox: null, sentAt: 'x', nextAttemptAt: null, lastError: null}];
  const key = await server.moldSignKey(request, files);
  check([key.length, key === await server.moldSignKey({...request, version: 4}, files), key === await server.moldSignKey(request, [...files, {...files[0], id: 'mdf-2'}]), key === await server.moldSignKey(request, files)], [32, false, false, true], 'the page\'s key changes with the request\'s version and its files');
  // The documents on the page (2026-11-10): the PDFs and pictures served through the link, the other files named only (never served,
  // not part of the key), neither the signature nor a signed copy nor a file deleted or refused for good.
  const row = (id, kind, extra = {}) => ({id, kind, sha256: id, deletedAt: null, objectKey: 'k-' + id, outbox: null, sentAt: 'x', nextAttemptAt: null, lastError: null, ...extra});
  const mixed = [row('mdf-q', 'pdf'), row('mdf-d', 'other'), row('mdf-i', 'image'), row('mds-1', 'image'), row('mdc-x', 'pdf'), row('mdf-gone', 'other', {deletedAt: 'x'}), row('mdf-refused', 'other', {outbox: 'send', sentAt: null, lastError: {final: true}}), row('mdf-z', 'other')];
  check([server.signLinkFiles({data: {}}, mixed, 'open').map(file => file.id), server.signLinkOtherFiles(mixed).map(file => file.id)], [['mdf-q', 'mdf-i'], ['mdf-d', 'mdf-z']], 'the link serves the PDFs and pictures, and names the other files');
  check(await server.moldSignKey(request, mixed) === await server.moldSignKey(request, mixed.filter(file => file.kind !== 'other')), true, 'the other files are not part of the page\'s key');
  const open = {id: 'mr-1', cancelledAt: null, outbox: 'send', accepted: null, remote: null, lastAttemptAt: null, lastError: null, data: {awaitsSignature: true, signatureLink: {hash: 'h', sentAt: '', expiresAt: '2999-01-01T00:00:00.000Z', by: 'rep'}}};
  check([server.signLinkOpen(open), server.signLinkOpen({...open, cancelledAt: 'x'}), server.signLinkOpen({...open, data: {...open.data, signatureLink: {...open.data.signatureLink, expiresAt: '2020-01-01T00:00:00.000Z'}}}),
    server.signLinkOpen({...open, accepted: {}}), server.signLinkOpen({...open, data: {...open.data, signature: {signer: 'x', signedAt: 'y', fileId: 'mds-1'}}}), server.signLinkOpen({...open, data: {signatureLink: open.data.signatureLink}})],
    [true, false, false, false, false, false], 'a link opens only while the request waits for it: not cancelled, expired, sent or signed');
}
console.log(JSON.stringify({ok: true, checks, scope: 'mold signed PDFs and the signing link: stamping, names, holds, tokens'}));
