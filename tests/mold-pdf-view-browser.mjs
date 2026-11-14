// The customer reads the request's documents as ONE document and signs on its last page (the owner, 2026-11-11: «pdf يتفتح ويكون عبارة
// عن عرض السعر او po وبعدين التصميم وفى اخره خانة للتوقيع بحيث الموقع يكون عارف هو بيوقع على ايه كأنه بيوقع على ورق حقيقى»; before it,
// 2026-11-10: each file under its own heading and a box after them), in a real Chromium against the BUILT release (run the build first),
// sending to the stand-in production API:
// 1. the representative's device step, on a phone of 360 px in Arabic inside the Android app's stand-in (its user agent and bridge): a
//    quotation of 2 pages, a design of 3 pages and a picture, chosen in the form and still on the device, shown as one document in that
//    order, white sheets one under another with ONE counter («صفحة n من 7»: the signature page is the 7th) and a discreet caption under
//    each page; pdf.js in a real worker and pdf-lib loaded only now (the pages before never load them); «تكبير»; the last page is the
//    signature page («إقرار وتوقيع العميل», what is signed for, «المستندات في هذا الملف» with each document's pages, the consent, the name and
//    the pad inside its box, the moment); the customer signs, and ONE signed file «طلب القالب - موقّع.pdf» of 7 pages is made, its last page
//    the signature page as composed (the name and the drawing in the box: rendered by poppler);
// 2. the device step from the request's sheet («يوقّع العميل الآن على الجهاز») on a tablet in English: the uploaded files through the CRM,
//    a damaged PDF and a drawing named only on the signature page, the counter in English and no Arabic left in the viewer's own words;
// 3. the customer's link page on a phone in Arabic, then English, then a computer: the same document through the link's file route
//    (inline, application/pdf), the consent and «توقيع» under the signature page; signing makes the one signed file, downloaded from the
//    thank-you page;
// 4. the link page on a tablet, upright then on its side, with the processor slowed four times: a PDF of 30 pages and 20 MB drawn a few
//    pages at a time as it is scrolled (every page drawn once reached, the first given back at the end), a damaged quotation named on the
//    signature page; signing makes a file of 31 pages;
// 5. a request whose only file is a drawing: the signature page alone, the drawing named on it.
// No page scrolls sideways. Screenshots for the report. Synthetic fixtures only: temporary SQLite, PDFs and pictures made here, no
// production data, no real production app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {PDFDict, PDFDocument, PDFName, StandardFonts, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject} from 'pdf-lib';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';
import {installNativeBridge, NATIVE_USER_AGENT} from '../scripts/lib/native-bridge.mjs';
import {signRequest} from '../scripts/lib/signature-pad.mjs';
import {signaturePng} from '../scripts/lib/signature-png.mjs';
import {DAMAGED_PDF as DAMAGED, makePdf} from '../scripts/lib/signed-document-fixtures.mjs';
import {moldImageSize} from '../portable/mold-rules.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [{id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'}, {id: 'sup', role: 'supervisor', sup: 'sm'}, {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'أحمد عبد العزيز'}];
const screenshots = process.env.YR_MOLD_SCREENSHOT_DIR ? path.resolve(process.env.YR_MOLD_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-mold-pdf-view-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const PHONE = {width: 360, height: 800}, TABLET = {width: 820, height: 1180}, DESKTOP = {width: 1280, height: 900};
/** A PDF of 30 pages and about 20 MB: each page a picture of random pixels (it does not compress) under its label. */
async function bigPdf(pages = 30, side = 480) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const image = doc.context.register(doc.context.stream(randomBytes(side * side * 3), {Type: 'XObject', Subtype: 'Image', Width: side, Height: side, ColorSpace: 'DeviceRGB', BitsPerComponent: 8}));
    const page = doc.addPage([595, 842]), name = page.node.newXObject('Im', image);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(420, 0, 0, 420, 88, 260), drawObject(name), popGraphicsState());
    page.drawText('Big drawing - page ' + (i + 1), {x: 60, y: 760, size: 24, font});
  }
  return Buffer.from(await doc.save({useObjectStreams: false}));
}
/** A long Arabic file name (2026-11-11): it wraps inside its cell on the signature page, the pages beside its first line. */
const LONG_DESIGN = 'ملف تصميم قالب البلوك الكبير للمصنع الشرقي الجديد في المنطقة الصناعية الثانية.pdf';
const PICTURE = signaturePng({width: 640, height: 360, seed: 7});
const DRAWING = Buffer.from('AC1027 synthetic drawing bytes');
/** The last page of a PDF rendered by poppler (when on the machine) into a PNG saved with the screenshots; its path, or null. */
function renderLastPage(bytes, label) {
  const file = path.join(screenshots, label + '.pdf');
  fs.writeFileSync(file, bytes);
  try {
    const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [file], {encoding: 'utf8'}))[1]);
    execFileSync('pdftoppm', ['-png', '-r', '72', '-singlefile', '-f', String(pages), '-l', String(pages), file, path.join(screenshots, label + '-last-page')]);
    return path.join(screenshots, label + '-last-page.png');
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

const mock = await startProductsMock({quotePo: true, nov10: true});
const app = await bootBuiltApp({members}, {tls: true, env: {YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret, NODE_EXTRA_CA_CERTS: mock.ca}});
try {
  const now = new Date().toISOString();
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind('east1', 'rep', JSON.stringify({name: 'مصنع الشرق', region: 'الشرقية', city: 'الدمام', address: 'حي الصناعية', phone: '0551234567', code: 'ERP-east1', internalCode: 'YR-C-000027', branch: 'الرئيسي', assignedTo: 'rep'}), now, now).run();
  // Production's updates of 2026-11-03 (quotation and PO files) and 2026-11-10 are known, as after their first answers.
  for (const id of ['mold-quote-po', 'mold-nov10']) await app.db.prepare('INSERT OR IGNORE INTO crm_settings(id,owner_id) VALUES(?,?)').bind(id, now).run();
  const {scope} = await app.db.prepare('SELECT region_scope AS scope FROM crm_members WHERE id=?').bind('rep').first();
  const [quote2, design3, big30] = [await makePdf('Quotation Q-77', 2), await makePdf('Mold design', 3), await bigPdf()];
  ok(big30.length > 19 * 1024 * 1024 && big30.length < 25 * 1024 * 1024, 'the large PDF is about 20 MB: ' + (big30.length / 1024 / 1024).toFixed(1) + ' MB');
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  const watchAssets = page => { const seen = []; page.on('request', request => { const url = request.url(); if (/pdf\.(?:min|worker)/.test(url)) seen.push(url); }); return seen; };
  async function open(memberId, {viewport = DESKTOP, language = 'ar', touch = false, native = true} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', ...(touch ? {hasTouch: true, isMobile: true} : {})});
    if (language === 'en') await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    const assets = watchAssets(page), workers = [];
    page.on('worker', worker => workers.push(worker.url()));
    // A representative works in the Android app (as the other mold browser tests set up), on a phone, a tablet or a computer's window.
    if (native) await installNativeBridge(page, {memberId: 'rep', regionScope: scope});
    await page.goto(app.origin + '/');
    await page.locator('.workspace').waitFor();
    return {page, assets, workers};
  }
  const shot = async (page, label) => { await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const noOverflow = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal overflow');
  const until = async (test, message, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await test()) return; await new Promise(resolve => setTimeout(resolve, 200)); } assert.fail('timed out: ' + message); };
  const goMolds = async page => {
    const more = page.locator('.mobile-bottom-navigation button[aria-haspopup="dialog"]');
    await page.locator('.mobile-bottom-navigation button[aria-haspopup="dialog"]:visible, button.nav-item:visible').first().waitFor();
    if (await more.isVisible()) { await more.click(); await page.locator('.mobile-overflow-pages button[data-page="mold-requests"]').click(); await page.locator('.mobile-navigation-sheet').waitFor({state: 'detached'}); }
    else await page.locator('button.nav-item', {hasText: /طلبات تصنيع القوالب|Mold requests/}).first().click();
    await page.locator('.mold-page').waitFor();
  };
  const sheet = page => page.locator('.mold-sheet');
  /** The document as shown: each sheet's kind, its counter and its caption. */
  const sheets = viewer => viewer.locator('.mold-doc-sheet').evaluateAll(items => items.map(item => [item.dataset.kind, (item.querySelector('.mold-doc-counter')?.textContent || '').trim(), (item.querySelector('.mold-doc-caption')?.textContent || '').trim()]));
  /** How many coloured (not white, not grey) pixels a drawn page has, sampled. */
  const coloured = canvas => canvas.evaluate(element => { const g = element.getContext('2d'), {width, height} = element; if (!width || !height) return 0; const data = g.getImageData(0, 0, width, height).data; let count = 0; for (let i = 0; i < data.length; i += 4 * 7) { const [r, gr, b] = [data[i], data[i + 1], data[i + 2]]; if (Math.max(r, gr, b) - Math.min(r, gr, b) > 60) count++; } return count; });
  /** The signature page is the last sheet, after every page, and the same width. */
  const signatureLast = viewer => viewer.evaluate(element => { const items = [...element.querySelectorAll('.mold-doc-sheet')], last = items.at(-1); return last?.dataset.kind === 'signature' && items.slice(0, -1).every(item => item.getBoundingClientRect().bottom <= last.getBoundingClientRect().top + 1) && items.every(item => Math.abs(item.querySelector('.mold-doc-paper').getBoundingClientRect().width - last.querySelector('.mold-doc-paper').getBoundingClientRect().width) <= 1); });
  /** The lines of the signature page's lists. */
  // Each document a row of cells (kind | name | pages or note, 2026-11-11), read back as «kind: name — pages».
  const listedOn = viewer => viewer.locator('.mold-sign-page-list li').evaluateAll(rows => rows.map(row => [...row.children].map(cell => cell.textContent.replace(/[\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim())).map(([kind, name, rest]) => kind + ': ' + name + ' — ' + rest));
  /** The signature page's cells where the browser put them: in Arabic every label cell right of its value cell, every row kind | name |
   *  pages from the right on one line, the pages on one line beside the name's first line, their numbers left to right («1» before «2»). */
  const cellLayout = viewer => viewer.locator('.mold-doc-sign-sheet').evaluate(page => {
    const rtl = getComputedStyle(page).direction === 'rtl', box = element => element.getBoundingClientRect(), problems = [];
    const after = (a, b) => rtl ? b.right <= a.left + 1 : b.left >= a.right - 1;
    for (const fact of page.querySelectorAll('.mold-sign-page-facts > div')) {
      const [label, value] = [fact.querySelector('dt'), fact.querySelector('dd')].map(box);
      if (!after(label, value) || Math.abs(label.top - value.top) > 3) problems.push('fact ' + fact.textContent);
    }
    for (const row of page.querySelectorAll('.mold-sign-page-list li')) {
      const [kind, name, rest] = [...row.children], [k, n, r] = [kind, name, rest].map(box), line = parseFloat(getComputedStyle(rest).lineHeight) || 24;
      if (!after(k, n) || !after(n, r)) problems.push('order ' + row.textContent);
      if (Math.abs(r.top - n.top) > 3 || Math.abs(k.top - n.top) > 3) problems.push('not one row ' + row.textContent);
      if (rest.classList.contains('mold-sign-page-range')) { const whole = document.createRange(); whole.selectNodeContents(rest); const tops = new Set([...whole.getClientRects()].map(item => Math.round(item.top))); if (tops.size !== 1 || r.height > line * 1.4) problems.push('range wraps ' + row.textContent); }
      const text = rest.firstChild, digits = /(\d+)\u2013(\d+)/.exec(text?.data || '');
      if (digits) {
        const at = digits.index, range = document.createRange(), rect = index => { range.setStart(text, index); range.setEnd(text, index + 1); return range.getBoundingClientRect(); };
        if (!(rect(at).left < rect(at + digits[0].length - 1).left)) problems.push('numbers reversed ' + row.textContent);
      }
    }
    return problems;
  });
  /** A request made through the API with its files, waiting for the customer's signature from a link; returns its id and token. */
  async function requestWithLink(api, description, files) {
    const answer = await api('/api/mold-requests', {method: 'POST', body: {action: 'create', requestId: crypto.randomUUID(), customerId: 'east1', specs: {description, core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: '', quantity: 3, notes: ''}, payment: 'deferred', paymentTerms: 'advance_after_shipping', address: 'الدمام - حي الصناعية', signatureLink: true}});
    check(answer.status, 200, 'a request with a signing link: ' + description);
    const id = answer.json().request.id, token = answer.json().link.url.split('/').pop();
    for (const [name, bytes, category] of files) {
      const form = new FormData();
      form.set('requestId', crypto.randomUUID()); form.set('id', id); form.set('file', new Blob([bytes]), name); if (category !== 'design') form.set('category', category);
      const encoded = new Response(form), uploaded = await api('/api/mold-requests/design-files', {method: 'POST', body: Buffer.from(await encoded.arrayBuffer()), headers: {'Content-Type': encoded.headers.get('content-type')}});
      check(uploaded.status, 200, 'uploaded ' + name);
    }
    return {id, token};
  }
  /** Draws a wave on a pad with real touch (as the Android WebView and a phone send it). */
  async function touchSign(page, pad) {
    await pad.scrollIntoViewIfNeeded();
    const box = await pad.boundingBox(), cdp = await page.context().newCDPSession(page);
    const point = i => ({x: box.x + (0.12 + i * 0.024) * box.width, y: box.y + (0.5 + Math.sin(i / 3) * 0.28) * box.height, id: 1});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [point(0)]});
    for (let i = 1; i < 32; i++) await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [point(i)]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []}); await cdp.detach();
  }
  /** The ONE signed file of a request (its row), once made. */
  const signedFileOf = async id => (await app.db.prepare("SELECT * FROM crm_mold_design_files WHERE request_id=? AND id LIKE 'mdc-%-doc' AND object_key IS NOT NULL").bind(id).first()) || null;
  const pagesOf = async bytes => (await PDFDocument.load(bytes)).getPages();
  const images = page => page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)?.keys().length || 0;
  const api = app.as(await app.login('rep'));

  // ---- 1. The device step in the form: a phone of 360 px, Arabic, inside the Android app's stand-in
  const {page: rep, assets: repAssets, workers: repWorkers} = await open('rep', {viewport: PHONE, touch: true});
  check(await rep.evaluate(() => [navigator.userAgent.includes('YourrestCRM-Android'), typeof window.__yourrestNative]), [true, 'object'], 'the page runs as the Android app shows it (its user agent and bridge)');
  ok(NATIVE_USER_AGENT.includes('Android'), 'the stand-in is an Android WebView');
  await goMolds(rep);
  check(repAssets, [], 'pdf.js is not loaded by the pages everyone opens');
  await rep.locator('.mold-new').click();
  const dialog = rep.locator('.mold-dialog');
  await dialog.locator('.mold-customer-field[data-field="name"] input').fill('مصنع الشرق');
  await dialog.locator('.mold-customer-field[data-field="code"] input').fill('ERP-east1'); // typed, no suggestions (2026-11-14): the ERP code links the request
  await dialog.locator('.mold-customer-chosen').waitFor();
  await dialog.locator('label.mold-field', {hasText: 'وصف القالب'}).locator('input').fill('قالب بلوك 20 - مستند واحد');
  for (const text of ['مفتوح', 'موديل قديم', 'بدون بلوكة نص']) await dialog.locator('.mold-choice label', {hasText: text}).click();
  await dialog.locator('.mold-choice', {hasText: 'عدد الرجاجات'}).locator('label', {hasText: '2'}).click();
  await dialog.locator('label.mold-field', {hasText: 'عرض القالب'}).locator('.mold-usual button', {hasText: '1380'}).click();
  await dialog.locator('label.mold-field', {hasText: 'مقاس الجلب'}).locator('.mold-usual button', {hasText: '795'}).click();
  await dialog.locator('.mold-choice', {hasText: 'طريقة الدفع'}).first().locator('label', {hasText: 'نقدي'}).click();
  const quotePicker = dialog.locator('.mold-design-picker[data-category="quote"]'), designPicker = dialog.locator('.mold-design-picker[data-category="design"]');
  await quotePicker.locator('input[type=file]').setInputFiles({name: 'عرض سعر Q-77.pdf', mimeType: 'application/pdf', buffer: quote2});
  await quotePicker.locator('.mold-design-file[data-state="ready"]').waitFor();
  // The design's PDF and its picture, in the order chosen.
  await designPicker.locator('input[type=file]').setInputFiles([{name: 'رسم القالب.pdf', mimeType: 'application/pdf', buffer: design3}, {name: 'صورة القالب.png', mimeType: 'image/png', buffer: PICTURE}]);
  await until(async () => (await designPicker.locator('.mold-design-file[data-state="ready"]').count()) === 2, 'both design files ready');
  check(repAssets, [], 'nor by the form');
  await dialog.getByRole('button', {name: 'حفظ وإرسال للإنتاج'}).click();
  const step = dialog.locator('.mold-signing');
  await step.waitFor();
  const viewer = step.locator('.mold-doc-viewer');
  await viewer.and(rep.locator('[data-ready]')).waitFor({timeout: 60000});
  check(await viewer.getAttribute('data-pages'), '7', 'one document of 7 pages: 2 + 3 + the picture + the signature page');
  check(await sheets(viewer), [['pdf', 'صفحة 1 من 7', 'عرض السعر · عرض سعر Q-77.pdf'], ['pdf', 'صفحة 2 من 7', 'عرض السعر · عرض سعر Q-77.pdf'], ['pdf', 'صفحة 3 من 7', 'التصميم · رسم القالب.pdf'], ['pdf', 'صفحة 4 من 7', 'التصميم · رسم القالب.pdf'], ['pdf', 'صفحة 5 من 7', 'التصميم · رسم القالب.pdf'], ['image', 'صفحة 6 من 7', 'التصميم · صورة القالب.png'], ['signature', 'صفحة 7 من 7', '']],
    'the quotation\'s pages, the design\'s, the picture, then the signature page: one counter, a caption under each page');
  check(await viewer.locator('.mold-doc-file, .mold-doc-head').count(), 0, 'no card or heading per file any more');
  ok(repAssets.some(url => /pdf\.min-[\w-]+\.js$/.test(url)) && repAssets.some(url => /pdf\.worker\.min\.[\w-]+\.mjs$/.test(url)), 'pdf.js and its worker load now, from the CRM\'s own origin');
  ok(repAssets.every(url => url.startsWith(app.origin + '/')), 'nothing from elsewhere');
  await until(() => repWorkers.some(url => /pdf\.worker\.min/.test(url)), 'a real worker runs pdf.js');
  const firstPage = viewer.locator('.mold-doc-sheet[data-page="1"]');
  await viewer.locator('.mold-doc-sheet[data-page="1"][data-state="drawn"]').waitFor();
  ok(await coloured(firstPage.locator('canvas')) > 200, 'the quotation\'s first page is drawn (its coloured band)');
  check(await firstPage.locator('canvas').evaluate(canvas => [canvas.width > 300, Math.abs(canvas.getBoundingClientRect().width - canvas.parentElement.clientWidth) <= 1]), [true, true], 'as wide as the screen allows');
  check(await firstPage.locator('canvas').evaluate(canvas => [getComputedStyle(canvas).direction, getComputedStyle(document.documentElement).direction]), ['ltr', 'rtl'], 'the page drawn left to right inside the right-to-left screen');
  check(await step.locator('h3').first().innerText(), 'توقيع العميل', 'the step\'s title at its top');
  check(await step.locator('.mold-doc-title-line').innerText(), 'طلب تصنيع قالب — مصنع الشرق', 'a short title above the document');
  check(await rep.evaluate(() => document.querySelector('.mold-dialog').scrollTop), 0, 'the step opens at its top');
  await noOverflow(rep, 'the document at 360 px');
  await shot(rep, '01-device-document-top-phone-ar');
  // A page boundary: the end of the quotation and the start of the design, with their counters and captions.
  await viewer.locator('.mold-doc-sheet[data-page="2"] .mold-doc-sheet-bar').evaluate(element => element.scrollIntoView({block: 'center'}));
  await viewer.locator('.mold-doc-sheet[data-page="3"][data-state="drawn"]').waitFor();
  await shot(rep, '02-device-page-boundary-phone-ar');
  // «تكبير»: the page twice as wide, scrolled sideways inside its own frame; the page itself never scrolls sideways.
  const zoomPage = viewer.locator('.mold-doc-sheet[data-page="3"]');
  await zoomPage.getByRole('button', {name: 'تكبير'}).click();
  await zoomPage.and(rep.locator('[data-zoom][data-state="drawn"]')).waitFor();
  check(await zoomPage.locator('.mold-doc-frame').evaluate(frame => { const canvas = frame.querySelector('canvas'); return [Math.round(canvas.getBoundingClientRect().width / frame.clientWidth), frame.scrollWidth > frame.clientWidth + 10]; }), [2, true], '«تكبير»: twice as wide, scrolled inside its frame');
  await noOverflow(rep, 'a zoomed page at 360 px');
  await zoomPage.getByRole('button', {name: 'تصغير'}).click();
  await zoomPage.and(rep.locator(':not([data-zoom])[data-state="drawn"]')).waitFor();
  // The picture as a page of the document.
  await rep.waitForFunction(() => document.querySelector('.mold-doc-sheet[data-kind="image"] .mold-doc-image')?.naturalWidth > 0);
  check(await viewer.locator('.mold-doc-sheet[data-kind="image"] .mold-doc-paper').evaluate(paper => { const r = paper.getBoundingClientRect(); return Math.round(100 * r.width / r.height) / 100; }), Math.round(100 * 841.89 / 595.28) / 100, 'the wide picture on an A4 sheet on its side');
  // The signature page: the last sheet, the same width, what is signed for, the documents and their pages, the consent, the box.
  ok(await signatureLast(viewer), 'the signature page is the last page, as wide as the others');
  const signPage = viewer.locator('.mold-doc-sign-sheet');
  check(await signPage.locator('.mold-sign-page-title').innerText(), 'إقرار وتوقيع العميل', 'its title');
  check(await listedOn(viewer), ['عرض السعر: عرض سعر Q-77.pdf — صفحات 1–2', 'التصميم: رسم القالب.pdf — صفحات 3–5', 'صورة: صورة القالب.png — صفحة 6'], '«المستندات في هذا الملف» with each document\'s pages');
  const summary = await signPage.locator('.mold-signing-summary').innerText();
  ok(['مصنع الشرق', 'قالب بلوك 20 - مستند واحد', 'نقدي'].every(text => summary.includes(text)) && /الكمية\s*1/.test(summary), 'what is signed for: ' + summary.replace(/\s+/g, ' '));
  check(await signPage.locator('.mold-sign-page-consent').innerText(), 'أقر بأني اطلعت على عرض السعر والتصميم الموضحين في الصفحات السابقة وأوافق عليهم.', 'the consent sentence');
  check([await signPage.locator('.mold-sign-page-box input[name="signer"]').count(), await signPage.locator('.mold-sign-page-box .mold-signature-pad').count(), await signPage.locator('.mold-sign-page-box').getByRole('button', {name: 'مسح'}).count()], [1, 1, 1], 'the name and the pad inside the page\'s signature box');
  ok(/^التاريخ: \d{2}\/\d{2}\/\d{4} - \d{2}:\d{2} \(توقيت الرياض\)$/.test((await signPage.locator('.mold-sign-page-date').innerText()).trim()), 'the moment in Riyadh');
  check([await step.locator('.mold-sign-actions').getByRole('button', {name: 'تأكيد وإرسال'}).count(), await step.locator('.mold-sign-actions').getByRole('button', {name: 'العودة إلى الطلب'}).count()], [1, 1], '«تأكيد وإرسال» and «العودة إلى الطلب» right under the page');
  await signPage.scrollIntoViewIfNeeded();
  await signPage.evaluate(element => element.scrollIntoView({block: 'start'}));
  await noOverflow(rep, 'the signature page at 360 px');
  check(await cellLayout(viewer), [], 'the signature page at 360 px as cells: labels right of values, kind | name | pages on one line, «1–2» in order');
  await rep.setViewportSize({width: 320, height: 800});
  await rep.waitForTimeout(300);
  await noOverflow(rep, 'the signature page at 320 px');
  check(await cellLayout(viewer), [], 'and at 320 px');
  await signPage.evaluate(element => element.scrollIntoView({block: 'start'}));
  await shot(rep, '03b-device-signature-page-phone320-ar');
  await rep.setViewportSize(PHONE);
  await rep.waitForTimeout(300);
  await signPage.evaluate(element => element.scrollIntoView({block: 'start'}));
  await shot(rep, '03-device-signature-page-before-phone-ar');
  await signPage.locator('input[name="signer"]').fill('م. خالد العتيبي');
  await touchSign(rep, signPage.locator('.mold-signature-pad'));
  await signPage.evaluate(element => element.scrollIntoView({block: 'start'}));
  await shot(rep, '04-device-signature-page-after-phone-ar');
  // The body sent: the signature page and the documents it lists.
  const sent = rep.waitForRequest(request => request.url().endsWith('/api/mold-requests') && request.method() === 'POST');
  await step.getByRole('button', {name: 'تأكيد وإرسال'}).click();
  const body = JSON.parse((await sent).postData());
  check(body.signature.document.parts.map(part => [part.category, part.kind, part.name, part.pages]), [['quote', 'pdf', 'عرض سعر Q-77.pdf', 2], ['design', 'pdf', 'رسم القالب.pdf', 3], ['design', 'image', 'صورة القالب.png', 1]], 'the documents it lists, in order, with their pages');
  const composed = Buffer.from(body.signature.document.page, 'base64');
  fs.writeFileSync(path.join(screenshots, '05-device-signature-page-composed.png'), composed);
  check([moldImageSize(composed).width, moldImageSize(composed).height], [1240, 1754], 'the signature page composed as an A4 PNG');
  await sheet(rep).waitFor({timeout: 60000});
  const deviceId = (await app.db.prepare('SELECT id FROM crm_mold_requests ORDER BY created_at DESC LIMIT 1').first()).id;
  await until(async () => !!await signedFileOf(deviceId), 'the signed file made once its documents are uploaded', 90000);
  await until(async () => (await sheet(rep).locator('.mold-design-file[data-signed-document]').count()) === 1, 'the signed file on the sheet', 60000);
  check([await sheet(rep).locator('.mold-design-file[data-signed-document] .mold-design-name').innerText(), await sheet(rep).locator('.mold-design-file[data-signed-copy]').count()], ['طلب القالب - موقّع.pdf', 1], 'ONE signed file, no per-file copy');
  ok((await sheet(rep).locator('.mold-signing-notes [data-document="made"]').innerText()).includes('7'), 'the sheet says the signed file has 7 pages');
  await until(() => (mock.row(deviceId)?.designFiles || []).some(file => file.name === 'طلب القالب - موقّع.pdf' && file.category === 'quote'), 'production receives it, of the quotation\'s category', 60000);
  check((mock.row(deviceId).designFiles || []).filter(file => file.name.endsWith(' - موقّع.pdf')).length, 1, 'once');
  const deviceFile = (await api('/api/mold-requests/design-file?id=' + deviceId + '&file=' + (await signedFileOf(deviceId)).id)).bytes;
  let pages = await pagesOf(deviceFile);
  check([pages.length, pages.map(images)], [7, [0, 0, 0, 0, 0, 1, 1]], 'its 7 pages: the documents as they are, the picture a page, the signature page last');
  const lastPng = renderLastPage(deviceFile, '06-device-signed-file');
  if (lastPng) {
    // The rendered last page: ink in the name line and in the box where the drawing is (the box's lower part).
    const ink = await rep.evaluate(async dataUrl => { const image = new Image(); image.src = dataUrl; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const g = canvas.getContext('2d'); g.drawImage(image, 0, 0); const dark = (y0, y1) => { const data = g.getImageData(0, Math.round(y0 * image.height), image.width, Math.max(1, Math.round((y1 - y0) * image.height))).data; let n = 0; for (let i = 0; i < data.length; i += 4) if (data[i] < 90 && data[i + 1] < 90 && data[i + 2] < 90) n++; return n; }; return {top: dark(0.03, 0.12), box: dark(0.65, 0.95)}; }, 'data:image/png;base64,' + fs.readFileSync(lastPng).toString('base64'));
    ok(ink.top > 50 && ink.box > 50, 'the rendered last page shows the title and, in the box, the name and the drawing: ' + JSON.stringify(ink));
  }
  await rep.context().close();

  // ---- 2. The device step from the request's sheet: a tablet in English, the uploaded files through the CRM
  const sheetRequest = await requestWithLink(api, 'SHEET SIGN 2', [['Q-88.pdf', quote2, 'quote'], ['broken design.pdf', DAMAGED, 'design'], ['mold photo.png', PICTURE, 'design'], ['model.dwg', DRAWING, 'design']]);
  const {page: tab, assets: tabAssets} = await open('rep', {language: 'en', viewport: TABLET, touch: true});
  await goMolds(tab);
  check(tabAssets, [], 'no pdf.js on the list');
  await tab.locator('.mold-card', {hasText: 'SHEET SIGN 2'}).click();
  await sheet(tab).locator('.mold-sign-link').getByRole('button', {name: 'The customer signs now on the device'}).click();
  const tabStep = tab.locator('.mold-dialog .mold-signing'), tabViewer = tabStep.locator('.mold-doc-viewer');
  await tabViewer.and(tab.locator('[data-ready]')).waitFor({timeout: 60000});
  await tabViewer.locator('.mold-doc-sheet[data-page="1"][data-state="drawn"]').waitFor();
  check(await sheets(tabViewer), [['pdf', 'Page 1 of 4', 'Quotation · Q-88.pdf'], ['pdf', 'Page 2 of 4', 'Quotation · Q-88.pdf'], ['image', 'Page 3 of 4', 'Design · mold photo.png'], ['signature', 'Page 4 of 4', '']], 'in English: the quotation\'s pages, the picture, the signature page');
  check(await listedOn(tabViewer), ['Quotation: Q-88.pdf — pages 1–2', 'Picture: mold photo.png — page 3', 'Design: broken design.pdf — could not be opened — it goes to production as it is', 'Design: model.dwg — it goes to production as it is'], 'the damaged PDF and the drawing named on the signature page');
  check(await cellLayout(tabViewer), [], 'the signature page in English on a tablet as cells');
  check(await tabStep.locator('.mold-sign-page-title').innerText(), 'Customer acknowledgement and signature', 'the signature page in English');
  ok(!/[؀-ۿ]/.test(await tabViewer.evaluate(element => [...element.querySelectorAll('.mold-doc-counter, .mold-sign-page-title, .mold-sign-page-heading, .mold-sign-page h3, .mold-sign-page-list li, .mold-sign-page-consent, .mold-sign-page-date, .mold-sign-page-facts dt, .mold-doc-sheet-bar button')].map(node => node.textContent).join(' ').replace(/[^\s]*(?:مصنع|الشرق)[^\s]*/g, ''))), 'no Arabic left in the document\'s own words in English (the customer\'s name is data)');
  ok(await signatureLast(tabViewer), 'the signature page last');
  await noOverflow(tab, 'the sheet\'s device step on a tablet');
  await shot(tab, '07-device-sheet-tablet-en');
  await signRequest(tab, {signer: 'Khalid Al-Otaibi', confirm: 'Confirm and send', input: 'pen'});
  await until(async () => !!await signedFileOf(sheetRequest.id), 'the signed file made at once (its files are uploaded)', 60000);
  pages = await pagesOf((await api('/api/mold-requests/design-file?id=' + sheetRequest.id + '&file=' + (await signedFileOf(sheetRequest.id)).id)).bytes);
  check(pages.length, 4, 'a file of 4 pages');
  await tab.context().close();

  // ---- 3. The customer's link page: a phone in Arabic, English, a computer; the document through the link
  const linkRequest = await requestWithLink(api, 'LINK PAGE 3', [['عرض سعر.pdf', quote2, 'quote'], [LONG_DESIGN, design3, 'design'], ['صورة.png', PICTURE, 'design'], ['مجسم.step', DRAWING, 'design']]);
  const customerContext = await browser.newContext({ignoreHTTPSErrors: true, viewport: PHONE, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block'});
  const customer = await customerContext.newPage();
  customer.setDefaultTimeout(30000);
  customer.on('pageerror', error => errors.push('customer: ' + error.message));
  const served = [];
  customer.on('response', response => { if (response.url().includes('/file/')) served.push([response.status(), response.headers()['content-type'], response.headers()['content-disposition'] || '']); });
  await customer.goto(app.origin + '/sign/m/' + linkRequest.token);
  const linkViewer = customer.locator('.sign-documents .mold-doc-viewer');
  await linkViewer.and(customer.locator('[data-ready]')).waitFor({timeout: 60000});
  check(await customer.locator('.sign-card h1').innerText(), 'طلب تصنيع قالب — مصنع الشرق', 'the page\'s title');
  check((await sheets(linkViewer)).map(([kind, counter]) => kind + ' ' + counter), ['pdf صفحة 1 من 7', 'pdf صفحة 2 من 7', 'pdf صفحة 3 من 7', 'pdf صفحة 4 من 7', 'pdf صفحة 5 من 7', 'image صفحة 6 من 7', 'signature صفحة 7 من 7'], 'the link\'s document: 2-page quotation, 3-page design, the picture, the signature page');
  check(await listedOn(linkViewer), ['عرض السعر: عرض سعر.pdf — صفحات 1–2', 'التصميم: ' + LONG_DESIGN + ' — صفحات 3–5', 'صورة: صورة.png — صفحة 6', 'التصميم: مجسم.step — يُرسل إلى الإنتاج كما هو'], 'its documents and the model named');
  check(await cellLayout(linkViewer), [], 'the signature page on the link page at 360 px as cells');
  await linkViewer.locator('.mold-doc-sheet[data-page="1"][data-state="drawn"]').waitFor();
  const linkWidth = Math.round(await linkViewer.evaluate(element => element.getBoundingClientRect().width));
  check(await linkViewer.locator('.mold-doc-sheet[data-page="1"] canvas').evaluate(canvas => [canvas.width, Math.round(canvas.getBoundingClientRect().width)]), [2 * linkWidth, linkWidth], 'a screen of density 2: drawn at twice its width in pixels');
  await customer.setViewportSize({width: 320, height: 800});
  await customer.waitForTimeout(300);
  await noOverflow(customer, 'the link page at 320 px');
  check(await cellLayout(linkViewer), [], 'and at 320 px: the long Arabic file name wraps in its cell, its pages beside its first line');
  await linkViewer.locator('.mold-doc-sign-sheet').evaluate(element => element.scrollIntoView({block: 'start'}));
  await shot(customer, '09b-link-signature-page-phone320-ar');
  await customer.setViewportSize(PHONE);
  await customer.waitForTimeout(300);
  await customer.evaluate(() => window.scrollTo(0, 0));
  ok(served.length >= 3 && served.every(([status]) => status === 200) && served.filter(([, type]) => type === 'application/pdf').length === 2 && served.every(([, , disposition]) => disposition.startsWith('inline')), 'the link\'s file route served them inline with their types: ' + JSON.stringify(served));
  ok((await linkViewer.locator('.mold-signing-summary').innerText()).includes('دفعة مقدمة واستكمال باقي المبلغ بعد الترحيل'), 'what is signed for, the payment terms included');
  check([await customer.locator('.sign-under .sign-consent').count(), await customer.locator('.sign-under').getByRole('button', {name: 'توقيع'}).count()], [1, 1], 'the consent and «توقيع» under the page');
  await noOverflow(customer, 'the link page at 360 px');
  await shot(customer, '08-link-page-top-phone-ar');
  await linkViewer.locator('.mold-doc-sign-sheet').evaluate(element => element.scrollIntoView({block: 'start'}));
  await shot(customer, '09-link-signature-page-phone-ar');
  await customer.getByRole('button', {name: 'English'}).click();
  await until(async () => (await customer.locator('.sign-card h1').innerText()).startsWith('Mold manufacturing request'), 'English');
  check((await sheets(linkViewer)).map(([, counter]) => counter).slice(-2), ['Page 6 of 7', 'Page 7 of 7'], 'the counter in English');
  check(await linkViewer.locator('.mold-sign-page-title').innerText(), 'Customer acknowledgement and signature', 'the signature page in English');
  await noOverflow(customer, 'the link page in English');
  await shot(customer, '10-link-signature-page-phone-en');
  await customer.getByRole('button', {name: 'العربية'}).click();
  await until(async () => (await customer.locator('.sign-card h1').innerText()).startsWith('طلب تصنيع قالب'), 'back to Arabic');
  // A computer: the document as wide as the cards (640 px), drawn again at that width.
  await customer.setViewportSize(DESKTOP);
  await until(async () => Math.round(await linkViewer.evaluate(element => element.getBoundingClientRect().width)) === 640, 'the document 640 px wide on a computer');
  await linkViewer.locator('.mold-doc-sheet[data-page="1"]').evaluate(element => element.scrollIntoView({block: 'start'}));
  await until(async () => await linkViewer.locator('.mold-doc-sheet[data-page="1"] canvas').evaluate(canvas => canvas.width === 1280), 'drawn again at the computer\'s width');
  await noOverflow(customer, 'the link page on a computer');
  await shot(customer, '11-link-page-desktop-ar');
  await customer.setViewportSize(PHONE);
  await linkViewer.locator('input[name="signer"]').fill('سالم الحربي');
  await touchSign(customer, linkViewer.locator('.mold-signature-pad'));
  await customer.locator('.sign-under .sign-consent input').check();
  await customer.locator('.sign-under').getByRole('button', {name: 'توقيع'}).click();
  await customer.locator('.sign-done').waitFor({timeout: 60000});
  check(await customer.locator('.sign-done .sign-files li > bdi').allInnerTexts(), ['طلب القالب - موقّع.pdf'], 'signed: ONE signed file, to download');
  check(await customer.locator('.sign-done h2').innerText(), 'الملف الموقّع', 'named as one file');
  await shot(customer, '12-link-done-phone-ar');
  const href = await customer.locator('.sign-done .sign-files a').getAttribute('href');
  const linkFile = (await app.as(null)(href)).bytes;
  check((await pagesOf(linkFile)).length, 7, 'its 7 pages');
  renderLastPage(linkFile, '13-link-signed-file');
  await until(() => (mock.row(linkRequest.id)?.designFiles || []).some(file => file.name === 'طلب القالب - موقّع.pdf'), 'the signed file reaches production', 60000);
  await customerContext.close();

  // ---- 4. A tablet, a PDF of 30 pages and 20 MB, the processor slowed four times; a damaged quotation named on the signature page
  const bigRequest = await requestWithLink(api, 'BIG PDF 4', [['تالف.pdf', DAMAGED, 'quote'], ['كتالوج القالب.pdf', big30, 'design']]);
  const tabletContext = await browser.newContext({ignoreHTTPSErrors: true, viewport: TABLET, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block'});
  const tablet = await tabletContext.newPage();
  tablet.setDefaultTimeout(60000);
  tablet.on('pageerror', error => errors.push('tablet: ' + error.message));
  const throttle = await tabletContext.newCDPSession(tablet);
  await throttle.send('Emulation.setCPUThrottlingRate', {rate: 4});
  const opened = Date.now();
  await tablet.goto(app.origin + '/sign/m/' + bigRequest.token);
  const bigViewer = tablet.locator('.sign-documents .mold-doc-viewer');
  await bigViewer.locator('.mold-doc-sheet[data-page="1"][data-state="drawn"]').waitFor({timeout: 120000});
  const firstDrawnMs = Date.now() - opened;
  await bigViewer.and(tablet.locator('[data-ready]')).waitFor({timeout: 90000});
  check(await bigViewer.getAttribute('data-pages'), '31', 'thirty pages and the signature page');
  check(await listedOn(bigViewer), ['التصميم: كتالوج القالب.pdf — صفحات 1–30', 'عرض السعر: تالف.pdf — تعذّر فتحه — يُرسل إلى الإنتاج كما هو'], 'the damaged quotation named on the signature page');
  const drawnNow = () => bigViewer.locator('.mold-doc-sheet[data-kind="pdf"]').evaluateAll(items => items.filter(item => item.dataset.state === 'drawn' && item.querySelector('canvas').width > 0).map(item => Number(item.dataset.page)));
  const atTop = await drawnNow();
  ok(atTop.length >= 1 && atTop.length <= 6, 'at the top only the pages near the screen are drawn: ' + atTop.join(','));
  await noOverflow(tablet, 'the tablet upright');
  await shot(tablet, '14-link-big-pdf-tablet-ar');
  // Scroll to the end, a screen at a time: every page drawn once reached, a few at a time.
  const everDrawn = new Set(atTop);
  let most = atTop.length;
  for (let round = 0; round < 200; round++) {
    const done = await tablet.evaluate(() => { const before = scrollY; scrollBy(0, innerHeight * 0.8); return scrollY === before; });
    await tablet.waitForTimeout(250);
    await until(async () => (await bigViewer.locator('.mold-doc-sheet[data-state="drawing"]').count()) === 0, 'the near pages drawn', 60000);
    const now2 = await drawnNow();
    now2.forEach(page => everDrawn.add(page)); most = Math.max(most, now2.length);
    if (done && everDrawn.has(30)) break;
  }
  check([...everDrawn].sort((a, b) => a - b), Array.from({length: 30}, (_, i) => i + 1), 'every page drawn once reached');
  ok(most <= 12, 'never more than a few pages held drawn at once: at most ' + most);
  check(await bigViewer.locator('.mold-doc-sheet[data-page="1"] canvas').evaluate(canvas => [canvas.width, canvas.height]), [0, 0], 'the first page\'s canvas given back at the end');
  ok(await signatureLast(bigViewer), 'the signature page after the 30th page');
  // On its side: the pages drawn again at the new width.
  await tablet.setViewportSize({width: TABLET.height, height: TABLET.width});
  await until(async () => (await bigViewer.locator('.mold-doc-sheet[data-page="30"] canvas').evaluate(canvas => canvas.width)) === 2 * 640, 'the last page drawn again on its side (640 px wide, density 2)', 60000);
  await noOverflow(tablet, 'the tablet on its side');
  await bigViewer.locator('.mold-doc-sign-sheet').scrollIntoViewIfNeeded();
  await shot(tablet, '15-link-big-pdf-end-tablet-landscape-ar');
  await bigViewer.locator('input[name="signer"]').fill('م. ياسر القحطاني');
  // A stylus on the tablet (pen pointer events).
  await bigViewer.locator('.mold-signature-pad').evaluate(element => {
    const rect = element.getBoundingClientRect(), event = (type, i, buttons = 1) => new PointerEvent(type, {pointerId: 9, pointerType: 'pen', isPrimary: true, bubbles: true, cancelable: true, pressure: 0.6, button: 0, buttons, clientX: rect.left + (0.12 + i * 0.024) * rect.width, clientY: rect.top + (0.5 + Math.sin(i / 3) * 0.28) * rect.height});
    element.dispatchEvent(event('pointerdown', 0));
    for (let i = 1; i < 32; i++) element.dispatchEvent(event('pointermove', i));
    element.dispatchEvent(event('pointerup', 31, 0));
  });
  await tablet.locator('.sign-under .sign-consent input').check();
  await throttle.send('Emulation.setCPUThrottlingRate', {rate: 1});
  await tablet.locator('.sign-under').getByRole('button', {name: 'توقيع'}).click();
  await tablet.locator('.sign-done').waitFor({timeout: 90000});
  check(await tablet.locator('.sign-done .sign-files li > bdi').allInnerTexts(), ['طلب القالب - موقّع.pdf'], 'the 30-page PDF signed into one file');
  check((await pagesOf((await api('/api/mold-requests/design-file?id=' + bigRequest.id + '&file=' + (await signedFileOf(bigRequest.id)).id)).bytes)).length, 31, 'of 31 pages');
  console.log(JSON.stringify({bigPdfMB: +(big30.length / 1024 / 1024).toFixed(1), firstPageMs: firstDrawnMs, mostDrawnAtOnce: most, cpuThrottle: 4}));
  await tabletContext.close();

  // ---- 5. A request whose only file is a drawing: the signature page alone, the drawing named on it
  const drawingOnly = await requestWithLink(api, 'DRAWING ONLY 5', [['قالب.dwg', DRAWING, 'design']]);
  const lone = await browser.newPage({ignoreHTTPSErrors: true, viewport: PHONE});
  lone.on('pageerror', error => errors.push('drawing only: ' + error.message));
  await lone.goto(app.origin + '/sign/m/' + drawingOnly.token);
  const loneViewer = lone.locator('.mold-doc-viewer');
  await loneViewer.and(lone.locator('[data-ready]')).waitFor();
  check([(await sheets(loneViewer)).map(([kind, counter]) => kind + ' ' + counter), await listedOn(loneViewer), await loneViewer.locator('.mold-sign-page-none').innerText()], [['signature صفحة 1 من 1'], ['التصميم: قالب.dwg — يُرسل إلى الإنتاج كما هو'], 'لا توجد مستندات معروضة في هذا الملف.'], 'only a drawing: the signature page alone, the drawing named');
  await noOverflow(lone, 'only a drawing at 360 px');
  await shot(lone, '16-link-drawing-only-phone-ar');
  await lone.close();

  check(errors, [], 'no page errors');
  console.log(JSON.stringify({ok: true, checks, screenshots, builtRelease: true, productionDataUsed: false}));
} finally {
  await browser?.close(); await app.stop(); await mock.stop();
}
