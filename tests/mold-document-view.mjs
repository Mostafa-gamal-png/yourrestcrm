// The documents on the mold signing screens (the owner, 2026-11-10: «ملف pdf يظهر على الشاشة ... وخانة فى الاخر العميل بيوقع داخلها»),
// their rules without a browser (lib/mold-document-view.ts, transpiled): the order (the quotation's, the PO's, then the design's, each in
// the order attached), which uploaded files the customer reads on the device (not the signature, not a signed copy, not one refused or
// being deleted, not production's), the headings and words in Arabic and English, and the size a page is drawn at (the screen's width ×
// its density, at most 2, × 2 zoomed; never more than 6 million pixels nor 4096 a side). And the build: pdf.js is a chunk of its own
// loaded by the signing screens only (lib/pdf-viewer-loader.ts: the legacy build, its worker by its address), and the offline shell
// carries none of it. Synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'mold-document-view-'));
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
const source = fs.readFileSync(path.join(root, 'lib/mold-document-view.ts'), 'utf8');
ok(!/^import (?!type)/m.test(source), 'the rules import types only (nothing of the server, nothing of the browser)');
fs.writeFileSync(path.join(out, 'view.mjs'), ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText);
const view = await import(path.join(out, 'view.mjs'));
const ar = (arabic) => arabic, en = (_arabic, english) => english;

// ---- the order: quotation, PO, design; each category as attached
{
  const files = [['d1', 'design'], ['q1', 'quote'], ['d2', 'design'], ['p1', 'po'], ['q2', 'quote']].map(([key, category]) => ({key, category}));
  check(view.orderViewerFiles(files).map(file => file.key), ['q1', 'q2', 'p1', 'd1', 'd2'], 'the quotation\'s first, then the PO\'s, then the design\'s, each in its order');
  check(files.map(file => file.key), ['d1', 'q1', 'd2', 'p1', 'q2'], 'the list given is not changed');
  check(view.orderViewerFiles([]), [], 'no files: none');
}

// ---- the uploaded files read on the device
{
  const file = (key, extra = {}) => ({key, name: key + '.pdf', kind: 'pdf', source: 'crm', state: 'sent', href: '/api/mold-requests/design-file?id=r&file=' + key, viewable: true, category: 'design', ...extra});
  const listed = view.viewerFilesFromRequest([
    file('design-1'), file('signature', {kind: 'image', signature: true}), file('copy', {signedCopy: true}), file('refused', {state: 'rejected'}), file('locked', {state: 'locked'}), file('deleting', {state: 'deleting'}),
    file('production', {source: 'production'}), file('quote-1', {category: 'quote'}), file('drawing', {name: 'drawing.dwg', kind: 'other', viewable: false}), file('waiting', {state: 'waiting'}), file('po-1', {category: 'po', kind: 'image', name: 'po.png'}),
  ]);
  check(listed.map(entry => entry.key), ['crm:quote-1', 'crm:po-1', 'crm:design-1', 'crm:drawing', 'crm:waiting'], 'the CRM\'s own files, ordered; not the signature, a signed copy, one refused, locked, being deleted, or production\'s');
  check([listed[0].href, listed[0].link], ['/api/mold-requests/design-file?id=r&file=quote-1', '/api/mold-requests/design-file?id=r&file=quote-1&inline=1'], 'a PDF read through the CRM, opened inline');
  check([listed[3].kind, listed[3].href, listed[3].link], ['other', undefined, '/api/mold-requests/design-file?id=r&file=drawing'], 'another kind: never read, downloaded as it is');
}

// ---- the words
{
  check(['quote', 'po', 'design'].map(category => view.viewerLabel(category, ar)), ['عرض السعر', 'PO', 'التصميم'], 'the headings in Arabic');
  check(['quote', 'po', 'design'].map(category => view.viewerLabel(category, en)), ['Quotation', 'PO', 'Design'], 'and in English');
  check([view.viewerPageText(2, 3, ar), view.viewerPageText(2, 3, en)], ['صفحة 2 من 3', 'Page 2 of 3'], 'each page numbered');
  check([1, 2, 3, 11, 30].map(pages => view.viewerPagesText(pages, ar)), ['صفحة واحدة', 'صفحتين', '3 صفحات', '11 صفحة', '30 صفحة'], 'the count of pages as Arabic says it');
  check([view.viewerPagesText(1, en), view.viewerPagesText(30, en)], ['1 page', '30 pages'], 'and English');
  check(view.viewerOtherText('mold.dwg', ar), 'ملف mold.dwg (مش PDF) — هيتبعت للإنتاج زي ما هو', 'another kind, in the owner\'s words');
  check(view.viewerOtherText('mold.dwg', en), 'File mold.dwg (not a PDF) — it goes to production as it is', 'and English');
  for (const [key, pair] of Object.entries(view.MOLD_VIEWER_TEXT)) ok(Array.isArray(pair) && pair.length === 2 && /[؀-ۿ]/.test(pair[0]) && !/[؀-ۿ]/.test(pair[1]) && pair[1].length > 1, 'the words of ' + key + ': Arabic, and English with no Arabic left');
  check(view.MOLD_VIEWER_TEXT.failed, ['ما قدرناش نعرض الملف ده', 'We could not show this file'], 'a file that cannot be shown says so');
}

// ---- the size a page is drawn at
{
  const a4 = {pageWidth: 595, pageHeight: 842};
  const phone = view.viewerRenderSize({cssWidth: 336, density: 3, ...a4});
  check([phone.pixelWidth, phone.pixelHeight, Math.round(phone.cssHeight)], [672, 950, 475], 'a phone of density 3 is drawn at 2 (the cap), the page\'s own shape');
  const flat = view.viewerRenderSize({cssWidth: 336, density: 1, ...a4});
  check([flat.pixelWidth, Math.round(flat.scale * 1000) / 1000], [336, 0.565], 'density 1: one pixel a CSS pixel');
  const zoomed = view.viewerRenderSize({cssWidth: 1280, density: 2, ...a4});
  ok(zoomed.pixelWidth * zoomed.pixelHeight <= view.MOLD_VIEWER_MAX_PIXELS && zoomed.pixelWidth < 2560, 'zoomed on a computer: held under 6 million pixels (' + zoomed.pixelWidth + '×' + zoomed.pixelHeight + ')');
  check(Math.round(zoomed.cssHeight), Math.round(1280 * 842 / 595), 'its place on the screen keeps the page\'s shape');
  const strip = view.viewerRenderSize({cssWidth: 600, density: 2, pageWidth: 200, pageHeight: 14400});
  ok(strip.pixelHeight <= view.MOLD_VIEWER_MAX_SIDE && strip.pixelWidth >= 1, 'a very long page: no side over 4096 (' + strip.pixelWidth + '×' + strip.pixelHeight + ')');
  const odd = view.viewerRenderSize({cssWidth: 0, density: Number.NaN, pageWidth: 0, pageHeight: 0});
  ok(odd.pixelWidth >= 1 && odd.pixelHeight >= 1 && Number.isFinite(odd.scale), 'nothing measured yet, or a page of no size: still a valid canvas');
  ok(view.MOLD_VIEWER_KEEP_PX > view.MOLD_VIEWER_NEAR_PX, 'a page is kept further than it is drawn ahead (no drawing and dropping at one edge)');
}

// ---- pdf.js: loaded by the signing screens only; the legacy build; the offline shell carries none
{
  const loader = fs.readFileSync(path.join(root, 'lib/pdf-viewer-loader.ts'), 'utf8');
  check([...loader.matchAll(/import\('([^']+)'\)/g)].map(match => match[1]), ['pdfjs-dist/legacy/build/pdf.min.mjs', 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', './pdf-viewer-fonts', 'pdf-lib'], 'the legacy build, its worker by address and the standard fonts, each a dynamic import; since 2026-11-11 pdf-lib too (it counts the pages as the server builds them)');
  // pdf-lib on the client only through the loader (lib/mold-signed-document.ts takes it as an argument: no import of it).
  const shared = fs.readFileSync(path.join(root, 'lib/mold-signed-document.ts'), 'utf8');
  ok(!/from ['"]pdf-lib['"]|import\(['"]pdf-lib/.test(shared), 'the shared rules of the signed document import no pdf-lib');
  const fonts = fs.readFileSync(path.join(root, 'lib/pdf-viewer-fonts.ts'), 'utf8'), bundled = fs.readdirSync(path.join(root, 'node_modules/pdfjs-dist/standard_fonts')).filter(name => !name.startsWith('LICENSE')).sort();
  check([...fonts.matchAll(/from 'pdfjs-dist\/standard_fonts\/([^?']+)\?url'/g)].map(match => match[1]).sort(), bundled, 'every standard font of pdf.js, by its address (fetched only when a PDF needs it)');
  ok(!/^import (?!type)/m.test(loader), 'no static import of pdf.js');
  const importers = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) { const full = path.join(dir, entry.name); if (entry.isDirectory()) { if (!['node_modules', '.next', 'dist', '.sites-runtime', 'public', 'mobile', 'vendor'].includes(entry.name)) walk(full); } else if (/\.(tsx?|mjs)$/.test(entry.name) && !full.includes(path.sep + 'tests' + path.sep)) { const text = fs.readFileSync(full, 'utf8'); if (!full.endsWith('.d.ts') && /import\s*\(\s*['"]pdfjs-dist|^import\s+(?!type\b)[^;\n]*from\s*['"]pdfjs-dist/m.test(text)) importers.push(path.relative(root, full)); if (/pdf-viewer-loader['"]/.test(text)) importers.push('loader:' + path.relative(root, full)); if (/pdf-viewer-fonts['"]/.test(text)) importers.push('fonts:' + path.relative(root, full)); } } };
  walk(root);
  check(importers.sort(), ['fonts:lib/pdf-viewer-loader.ts', 'lib/pdf-viewer-fonts.ts', 'lib/pdf-viewer-loader.ts', 'loader:app/mold-document-viewer.tsx', 'loader:lib/pdf-viewer-loader.offline.ts'].sort(), 'pdf.js is reached through the loader (its fonts too), and the loader by the viewer only');
  const offline = path.join(root, 'public/offline-app/assets');
  const shell = fs.readdirSync(offline).map(name => fs.readFileSync(path.join(offline, name), 'utf8')).join('\n');
  ok(!/GlobalWorkerOptions|pdf\.worker|4\.10\.38|PDFDocumentLoadingTask/.test(shell), 'the offline shell carries no pdf.js');
  ok(!/EncryptedPDFError|wrapContentStreams/.test(shell), 'nor pdf-lib (2026-11-11)');
  const shellManifest = JSON.parse(fs.readFileSync(path.join(root, 'public/offline-shell-manifest.json'), 'utf8'));
  ok(shellManifest.assets.every(asset => !/pdf/i.test(asset.url)), 'nor does its cache list');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  check(pkg.dependencies['pdfjs-dist'], '4.10.38', 'pdfjs-dist on the reviewed version, exactly');
}
console.log(JSON.stringify({ok: true, checks, scope: 'mold signing documents: order, files, words, page size, pdf.js loading'}));
