// The customer reads the request's PDFs on the signing screens and signs in a box at their end (the owner, 2026-11-10: «ملف pdf يظهر على
// الشاشة فيه عرض السعر او po + التصميم وخانة فى الاخر العميل بيوقع داخلها»), in a real Chromium against the BUILT release (run the build
// first), sending to the stand-in production API:
// 1. the representative's device step, on a phone of 360 px in Arabic inside the Android app's stand-in (its user agent and bridge): a
//    quotation of 2 pages, a design of 3 pages and a picture, chosen in the form and still on the device, are shown in that order, page
//    after page under their headings («عرض السعر: …», «التصميم: …», «صفحة n من m»), drawn by pdf.js in a real worker loaded only now
//    (the pages before never load it); «تكبير» draws a page twice as wide inside its frame; the box «توقيع العميل» follows the last page;
//    the customer signs in it and the signed copies are made as before;
// 2. the device step from the request's sheet («العميل يوقّع دلوقتي على الجهاز») on a computer in English: the uploaded files through
//    the CRM, a damaged PDF saying «We could not show this file» without stopping the signing, a drawing named with its download;
// 3. the customer's link page on a phone in Arabic, then English, then a computer: the same documents through the link's file route
//    (inline, application/pdf), the box after the last page with the consent; signing makes the signed copies;
// 4. the link page on a tablet, upright then on its side, with the processor slowed four times: a PDF of 30 pages and 20 MB is drawn a few
//    pages at a time as it is scrolled (every page drawn once reached, the first given back at the end), beside a damaged quotation;
// 5. a request whose only file is a drawing: its row and the box.
// No page scrolls sideways. Screenshots for the report. Synthetic fixtures only: temporary SQLite, PDFs and pictures made here, no
// production data, no real production app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject} from 'pdf-lib';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';
import {installNativeBridge, NATIVE_USER_AGENT} from '../scripts/lib/native-bridge.mjs';
import {signRequest} from '../scripts/lib/signature-pad.mjs';
import {signaturePng} from '../scripts/lib/signature-png.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [{id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'}, {id: 'sup', role: 'supervisor', sup: 'sm'}, {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'أحمد عبد العزيز'}];
const screenshots = process.env.YR_MOLD_SCREENSHOT_DIR ? path.resolve(process.env.YR_MOLD_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-mold-pdf-view-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const PHONE = {width: 360, height: 800}, TABLET = {width: 820, height: 1180}, DESKTOP = {width: 1280, height: 900};
const COLORS = [rgb(0.85, 0.2, 0.15), rgb(0.1, 0.45, 0.8), rgb(0.15, 0.6, 0.3)];
/** A PDF of `pages` A4 pages, each with a coloured band and its label (so a drawn page has coloured pixels). */
async function makePdf(label, pages) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawRectangle({x: 40, y: 600, width: 515, height: 200, color: COLORS[i % 3]});
    page.drawText(label + ' - page ' + (i + 1) + ' of ' + pages, {x: 60, y: 560, size: 22, font});
  }
  return Buffer.from(await doc.save());
}
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
const DAMAGED = Buffer.from('%PDF-1.7\nthis is not a real PDF body, it was cut short\n');
const PICTURE = signaturePng({width: 640, height: 360, seed: 7});
const DRAWING = Buffer.from('AC1027 synthetic drawing bytes');

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
  async function open(memberId, {viewport = DESKTOP, language = 'ar', touch = false} = {}) {
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
    if (memberId === 'rep') await installNativeBridge(page, {memberId: 'rep', regionScope: scope});
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
  /** The viewer's files as shown: kind, category, heading. */
  const listed = viewer => viewer.locator('.mold-doc-file').evaluateAll(files => files.map(file => [file.dataset.kind, file.dataset.category, (file.querySelector('.mold-doc-title, .mold-doc-other > span')?.textContent || '').replace(/\s+/g, ' ').trim()]));
  /** How many coloured (not white, not grey) pixels a drawn page has, sampled. */
  const coloured = page => page.evaluate(canvas => { const g = canvas.getContext('2d'), {width, height} = canvas; if (!width || !height) return 0; const data = g.getImageData(0, 0, width, height).data; let count = 0; for (let i = 0; i < data.length; i += 4 * 7) { const [r, gr, b] = [data[i], data[i + 1], data[i + 2]]; if (Math.max(r, gr, b) - Math.min(r, gr, b) > 60) count++; } return count; });
  /** The box comes after the documents: later in the page and below the last page. */
  const boxAfter = (viewerSelector, boxSelector) => ({viewerSelector, boxSelector});
  const boxIsLast = async (page, {viewerSelector, boxSelector}) => page.evaluate(([v, b]) => { const viewer = document.querySelector(v), box = document.querySelector(b), files = viewer.querySelectorAll('.mold-doc-file'), last = files[files.length - 1]; return !!(viewer.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING) && box.getBoundingClientRect().top >= last.getBoundingClientRect().bottom - 1; }, [viewerSelector, boxSelector]);
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
  await dialog.locator('.mold-customer-suggestions [role="option"]').filter({hasText: 'مصنع الشرق'}).first().click();
  await dialog.locator('.mold-customer-chosen').waitFor();
  await dialog.locator('label.mold-field', {hasText: 'وصف القالب'}).locator('input').fill('قالب بلوك 20 - عرض PDF');
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
  await viewer.waitFor();
  check(await listed(viewer), [['pdf', 'quote', 'عرض السعر: عرض سعر Q-77.pdf'], ['pdf', 'design', 'التصميم: رسم القالب.pdf'], ['image', 'design', 'التصميم: صورة القالب.png']], 'the quotation, then the design\'s PDF and its picture, each under its heading');
  await until(async () => (await viewer.locator('.mold-doc-file[data-kind="pdf"][data-state="ready"]').count()) === 2, 'both PDFs opened');
  check(await listed(viewer), [['pdf', 'quote', 'عرض السعر: عرض سعر Q-77.pdf · صفحتين'], ['pdf', 'design', 'التصميم: رسم القالب.pdf · 3 صفحات'], ['image', 'design', 'التصميم: صورة القالب.png']], 'each PDF says how many pages it has');
  check([await viewer.locator('.mold-doc-file').nth(0).locator('.mold-doc-page').count(), await viewer.locator('.mold-doc-file').nth(1).locator('.mold-doc-page').count()], [2, 3], 'every page of each PDF, in its place');
  check(await viewer.locator('.mold-doc-file').nth(1).locator('.mold-doc-page-bar small').allInnerTexts(), ['صفحة 1 من 3', 'صفحة 2 من 3', 'صفحة 3 من 3'], 'each page numbered');
  ok(repAssets.some(url => /pdf\.min-[\w-]+\.js$/.test(url)) && repAssets.some(url => /pdf\.worker\.min\.[\w-]+\.mjs$/.test(url)), 'pdf.js and its worker load now, from the CRM\'s own origin: ' + repAssets.map(url => new URL(url).pathname).join(', '));
  ok(repAssets.every(url => url.startsWith(app.origin + '/')), 'nothing from elsewhere');
  await until(() => repWorkers.some(url => /pdf\.worker\.min/.test(url)), 'a real worker runs pdf.js');
  const firstPage = viewer.locator('.mold-doc-file').nth(0).locator('.mold-doc-page[data-page="1"]');
  await viewer.locator('.mold-doc-file').nth(0).locator('.mold-doc-page[data-page="1"][data-state="drawn"]').waitFor();
  ok(await coloured(firstPage.locator('canvas')) > 200, 'the quotation\'s first page is drawn (its coloured band)');
  check(await firstPage.locator('canvas').evaluate(canvas => [canvas.width > 300, Math.abs(canvas.getBoundingClientRect().width - canvas.parentElement.clientWidth) <= 1]), [true, true], 'as wide as the screen allows');
  check(await firstPage.locator('canvas').evaluate(canvas => [getComputedStyle(canvas).direction, getComputedStyle(document.documentElement).direction]), ['ltr', 'rtl'], 'the page drawn left to right inside the right-to-left screen (a canvas draws text in its own direction)');
  await rep.waitForFunction(() => document.querySelector('.mold-doc-image')?.naturalWidth > 0);
  check(await step.locator('h3').innerText(), 'توقيع العميل', 'the step\'s title stays at its top');
  check(await rep.evaluate(() => document.querySelector('.mold-dialog').scrollTop), 0, 'the step opens at its top');
  ok(await boxIsLast(rep, boxAfter('.mold-signing .mold-doc-viewer', '.mold-signing .mold-sign-box')), 'the signature box comes after the last document');
  check([await step.locator('.mold-sign-box .mold-sign-box-title').innerText(), await step.locator('.mold-sign-box input[name="signer"]').count(), await step.locator('.mold-sign-box .mold-signature-pad').count(), await step.locator('.mold-sign-box').getByRole('button', {name: 'امسح'}).count(), await step.locator('.mold-sign-box').getByRole('button', {name: 'تأكيد وإرسال'}).count(), await step.locator('.mold-sign-box').getByRole('button', {name: 'رجوع للطلب'}).count()],
    ['توقيع العميل', 1, 1, 1, 1, 1], 'the box holds the name, the pad, «امسح», the confirmation and «رجوع للطلب»');
  const summary = await step.locator('.mold-sign-box .mold-signing-summary').innerText();
  ok(['مصنع الشرق', 'قالب بلوك 20 - عرض PDF', 'نقدي'].every(text => summary.includes(text)) && /الكمية\s*1/.test(summary), 'and what is signed for: ' + summary);
  await noOverflow(rep, 'the step with the documents at 360 px');
  await shot(rep, '01-device-step-top-phone-ar');
  await viewer.locator('.mold-doc-file').nth(1).locator('.mold-doc-head').evaluate(element => element.scrollIntoView({block: 'start'}));
  await viewer.locator('.mold-doc-file').nth(1).locator('.mold-doc-page[data-page="1"][data-state="drawn"]').waitFor();
  await shot(rep, '02-device-page-header-phone-ar');
  // «تكبير»: the page twice as wide, scrolled sideways inside its own frame; the page itself never scrolls sideways.
  const zoomPage = viewer.locator('.mold-doc-file').nth(1).locator('.mold-doc-page[data-page="1"]');
  await zoomPage.getByRole('button', {name: 'تكبير'}).click();
  await zoomPage.and(rep.locator('[data-zoom][data-state="drawn"]')).waitFor();
  check(await zoomPage.locator('.mold-doc-frame').evaluate(frame => { const canvas = frame.querySelector('canvas'); return [Math.round(canvas.getBoundingClientRect().width / frame.clientWidth), frame.scrollWidth > frame.clientWidth + 10]; }), [2, true], '«تكبير»: twice as wide, scrolled inside its frame');
  await noOverflow(rep, 'a zoomed page at 360 px');
  await zoomPage.getByRole('button', {name: 'تصغير'}).click();
  await zoomPage.and(rep.locator(':not([data-zoom])[data-state="drawn"]')).waitFor();
  await step.locator('.mold-sign-box').scrollIntoViewIfNeeded();
  await shot(rep, '03-device-end-box-phone-ar');
  await signRequest(rep, {signer: 'م. خالد العتيبي', input: 'touch'});
  await sheet(rep).waitFor();
  const deviceId = (await app.db.prepare('SELECT id FROM crm_mold_requests ORDER BY created_at DESC LIMIT 1').first()).id;
  await until(async () => (await sheet(rep).locator('.mold-design-file[data-signed-copy]').count()) === 2, 'the signed copies appear on the sheet', 60000);
  await until(() => ['عرض سعر Q-77 - موقّع.pdf', 'رسم القالب - موقّع.pdf'].every(name => (mock.row(deviceId)?.designFiles || []).some(file => file.name === name) || (mock.row(deviceId)?.quoteFiles || []).some(file => file.name === name)), 'production receives both signed copies', 60000);
  await rep.context().close();

  // ---- 2. The device step from the request's sheet: a computer in English, the uploaded files through the CRM
  const sheetRequest = await requestWithLink(api, 'SHEET SIGN 2', [['Q-88.pdf', quote2, 'quote'], ['broken design.pdf', DAMAGED, 'design'], ['mold photo.png', PICTURE, 'design'], ['model.dwg', DRAWING, 'design']]);
  const {page: desk, assets: deskAssets} = await open('rep', {language: 'en'});
  await goMolds(desk);
  check(deskAssets, [], 'no pdf.js on the list');
  await desk.locator('.mold-card', {hasText: 'SHEET SIGN 2'}).click();
  await sheet(desk).locator('.mold-sign-link').getByRole('button', {name: 'The customer signs now on the device'}).click();
  const deskStep = desk.locator('.mold-dialog .mold-signing'), deskViewer = deskStep.locator('.mold-doc-viewer');
  await deskViewer.waitFor();
  await until(async () => (await deskViewer.locator('.mold-doc-file[data-state="loading"]').count()) === 0, 'every file read or refused');
  check(await listed(deskViewer), [['pdf', 'quote', 'Quotation: Q-88.pdf · 2 pages'], ['pdf', 'design', 'Design: broken design.pdf'], ['image', 'design', 'Design: mold photo.png'], ['other', 'design', 'Design: File model.dwg (not a PDF) — it goes to production as it is']], 'in English: the quotation, the design\'s damaged PDF, its picture and its drawing');
  check(await deskViewer.locator('.mold-doc-file[data-category="design"][data-kind="pdf"] .mold-doc-error').innerText().then(text => text.split('\n')[0]), 'We could not show this file', 'the damaged PDF says it cannot be shown');
  check(await deskViewer.locator('.mold-doc-file[data-kind="other"] a').getAttribute('href'), '/api/mold-requests/design-file?id=' + sheetRequest.id + '&file=' + (await app.db.prepare("SELECT id FROM crm_mold_design_files WHERE request_id=? AND name='model.dwg'").bind(sheetRequest.id).first()).id, 'the drawing downloads through the CRM, as the sheet offers it');
  check(await deskViewer.locator('.mold-doc-page-bar small').first().innerText(), 'Page 1 of 2', 'the page numbers in English');
  ok(!/[؀-ۿ]/.test((await deskViewer.locator('.mold-doc-file').evaluateAll(files => files.map(file => [...file.querySelectorAll('.mold-doc-title b, .mold-doc-title small, .mold-doc-page-bar, .mold-doc-error, .mold-doc-other b, .mold-doc-other a, .mold-doc-open')].map(node => node.textContent).join(' ')).join(' ')))), 'no Arabic left in the viewer\'s own words in English');
  await deskViewer.locator('.mold-doc-file').nth(0).locator('.mold-doc-page[data-page="1"][data-state="drawn"]').waitFor();
  ok(await boxIsLast(desk, boxAfter('.mold-dialog .mold-doc-viewer', '.mold-dialog .mold-sign-box')), 'the box after the last document');
  await noOverflow(desk, 'the sheet\'s device step on a computer');
  await shot(desk, '06-device-sheet-step-desktop-en');
  await signRequest(desk, {signer: 'Khalid Al-Otaibi', confirm: 'Confirm and send'});
  await until(async () => (await sheet(desk).locator('.mold-design-file[data-signed-copy]').count()) === 1, 'the quotation\'s signed copy', 60000);
  await until(async () => (await sheet(desk).locator('.mold-signing-skipped').count()) === 1, 'the damaged PDF got none, said why', 60000);
  ok((await sheet(desk).locator('.mold-signing-skipped').innerText()).includes('broken design.pdf'), 'the damaged design named');
  await desk.context().close();

  // ---- 3. The customer's link page: a phone in Arabic, English, a computer; the documents through the link
  const linkRequest = await requestWithLink(api, 'LINK PAGE 3', [['عرض سعر.pdf', quote2, 'quote'], ['تصميم.pdf', design3, 'design'], ['صورة.png', PICTURE, 'design'], ['مجسم.step', DRAWING, 'design']]);
  const customerContext = await browser.newContext({ignoreHTTPSErrors: true, viewport: PHONE, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block'});
  const customer = await customerContext.newPage();
  customer.setDefaultTimeout(30000);
  customer.on('pageerror', error => errors.push('customer: ' + error.message));
  const served = [];
  customer.on('response', response => { if (response.url().includes('/file/')) served.push([response.status(), response.headers()['content-type'], response.headers()['content-disposition'] || '']); });
  await customer.goto(app.origin + '/sign/m/' + linkRequest.token);
  const linkViewer = customer.locator('.sign-documents .mold-doc-viewer');
  await linkViewer.waitFor();
  check(await customer.locator('.sign-card h1').innerText(), 'طلب تصنيع قالب', 'the page');
  check(await listed(linkViewer), [['pdf', 'quote', 'عرض السعر: عرض سعر.pdf'], ['pdf', 'design', 'التصميم: تصميم.pdf'], ['image', 'design', 'التصميم: صورة.png'], ['other', 'design', 'التصميم: ملف مجسم.step (مش PDF) — هيتبعت للإنتاج زي ما هو']], 'the link\'s documents: the quotation, the design\'s PDF, its picture, its model named');
  await until(async () => (await linkViewer.locator('.mold-doc-file[data-kind="pdf"][data-state="ready"]').count()) === 2, 'both PDFs opened through the link');
  check([await linkViewer.locator('.mold-doc-file').nth(0).locator('.mold-doc-page').count(), await linkViewer.locator('.mold-doc-file').nth(1).locator('.mold-doc-page').count()], [2, 3], 'two pages, then three');
  await linkViewer.locator('.mold-doc-file').nth(0).locator('.mold-doc-page[data-page="1"][data-state="drawn"]').waitFor();
  check(await linkViewer.locator('.mold-doc-file').nth(0).locator('.mold-doc-page[data-page="1"] canvas').evaluate(canvas => [canvas.width, Math.round(canvas.getBoundingClientRect().width)]), [2 * Math.round(await linkViewer.evaluate(element => element.getBoundingClientRect().width)), Math.round(await linkViewer.evaluate(element => element.getBoundingClientRect().width))], 'a screen of density 2: drawn at twice its width in pixels');
  ok(served.length >= 3 && served.every(([status]) => status === 200) && served.filter(([, type]) => type === 'application/pdf').length === 2 && served.every(([, , disposition]) => disposition.startsWith('inline')), 'the link\'s file route served them inline with their types: ' + JSON.stringify(served));
  check(await linkViewer.locator('.mold-doc-file[data-kind="other"] a').count(), 0, 'a model the link does not serve: named, no link');
  ok(await boxIsLast(customer, boxAfter('.sign-documents .mold-doc-viewer', '.sign-box')), 'the signature box after the last document');
  check([await customer.locator('.sign-box .mold-sign-box-title').innerText(), await customer.locator('.sign-box input[name="signer"]').count(), await customer.locator('.sign-box .mold-signature-pad').count(), await customer.locator('.sign-box .sign-consent').count(), await customer.locator('.sign-box').getByRole('button', {name: 'توقيع'}).count()], ['توقيع العميل', 1, 1, 1, 1], 'the box: name, pad, consent, «توقيع»');
  ok((await customer.locator('.sign-box .sign-facts').innerText()).includes('دفعة مقدمة واستكمال باقي المبلغ بعد الترحيل'), 'what is signed for, the payment terms included');
  await noOverflow(customer, 'the link page at 360 px');
  await shot(customer, '04-link-page-top-phone-ar');
  await linkViewer.locator('.mold-doc-file').nth(1).locator('.mold-doc-head').scrollIntoViewIfNeeded();
  await shot(customer, '05-link-page-header-phone-ar');
  await customer.locator('.sign-box').scrollIntoViewIfNeeded();
  await shot(customer, '06-link-page-end-box-phone-ar');
  await customer.getByRole('button', {name: 'English'}).click();
  await until(async () => (await customer.locator('.sign-card h1').innerText()) === 'Mold manufacturing request', 'English');
  check((await listed(linkViewer)).map(([, , heading]) => heading.split(':')[0]), ['Quotation', 'Design', 'Design', 'Design'], 'the headings in English');
  check(await linkViewer.locator('.mold-doc-file').nth(1).locator('.mold-doc-page-bar small').allInnerTexts(), ['Page 1 of 3', 'Page 2 of 3', 'Page 3 of 3'], 'the pages in English');
  check(await customer.locator('.sign-box .mold-sign-box-title').innerText(), 'Customer signature', 'the box in English');
  await noOverflow(customer, 'the link page in English');
  await customer.locator('.sign-box').scrollIntoViewIfNeeded();
  await shot(customer, '07-link-page-end-box-phone-en');
  await customer.getByRole('button', {name: 'العربية'}).click();
  await until(async () => (await customer.locator('.sign-card h1').innerText()) === 'طلب تصنيع قالب', 'back to Arabic');
  // A computer: the documents as wide as the cards (640 px), drawn again at that width.
  await customer.setViewportSize(DESKTOP);
  await until(async () => Math.round(await linkViewer.evaluate(element => element.getBoundingClientRect().width)) === 640, 'the documents 640 px wide on a computer');
  await linkViewer.locator('.mold-doc-file').nth(0).evaluate(element => element.scrollIntoView({block: 'start'}));
  await until(async () => await linkViewer.locator('.mold-doc-file').nth(0).locator('.mold-doc-page[data-page="1"] canvas').evaluate(canvas => canvas.width === 1280), 'drawn again at the computer\'s width');
  await noOverflow(customer, 'the link page on a computer');
  await shot(customer, '08-link-page-desktop-ar');
  await customer.setViewportSize(PHONE);
  await customer.locator('.sign-box input[name="signer"]').fill('سالم الحربي');
  const pad = customer.locator('.sign-box .mold-signature-pad');
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox(), cdp = await customerContext.newCDPSession(customer);
  const point = i => ({x: box.x + (0.12 + i * 0.024) * box.width, y: box.y + (0.5 + Math.sin(i / 3) * 0.28) * box.height, id: 1});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [point(0)]});
  for (let i = 1; i < 32; i++) await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [point(i)]});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await customer.locator('.sign-box .sign-consent input').check();
  await customer.locator('.sign-box').getByRole('button', {name: 'توقيع'}).click();
  await customer.locator('.sign-done').waitFor({timeout: 60000});
  check((await customer.locator('.sign-done .sign-files li bdi').allInnerTexts()).sort(), ['تصميم - موقّع.pdf', 'عرض سعر - موقّع.pdf'].sort(), 'signed: a signed copy of each PDF, as before');
  await until(() => mock.state.calls.some(call => call.route === 'requests' && call.signed && call.body.includes(linkRequest.id)), 'the request reaches production');
  await customerContext.close();

  // ---- 4. A tablet, a PDF of 30 pages and 20 MB, the processor slowed four times; a damaged quotation beside it
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
  await bigViewer.locator('.mold-doc-file[data-category="quote"] .mold-doc-error').waitFor();
  ok((await bigViewer.locator('.mold-doc-file[data-category="quote"] .mold-doc-error').innerText()).startsWith('ما قدرناش نعرض الملف ده'), 'the damaged quotation: «ما قدرناش نعرض الملف ده»');
  const big = bigViewer.locator('.mold-doc-file[data-category="design"]');
  await big.and(tablet.locator('[data-state="ready"]')).waitFor({timeout: 90000});
  check(await big.locator('.mold-doc-page').count(), 30, 'thirty pages listed');
  await big.locator('.mold-doc-page[data-page="1"][data-state="drawn"]').waitFor({timeout: 90000});
  const firstDrawnMs = Date.now() - opened;
  const drawnNow = () => big.locator('.mold-doc-page').evaluateAll(pages => pages.filter(page => page.dataset.state === 'drawn' && page.querySelector('canvas').width > 0).map(page => Number(page.dataset.page)));
  const atTop = await drawnNow();
  ok(atTop.length >= 1 && atTop.length <= 6, 'at the top only the pages near the screen are drawn: ' + atTop.join(','));
  await noOverflow(tablet, 'the tablet upright');
  await shot(tablet, '09-link-big-pdf-tablet-ar');
  // Scroll to the end, a screen at a time: every page drawn once reached, a few at a time.
  const everDrawn = new Set(atTop);
  let most = atTop.length;
  for (let step = 0; step < 200; step++) {
    const done = await tablet.evaluate(() => { const before = scrollY; scrollBy(0, innerHeight * 0.8); return scrollY === before; });
    await tablet.waitForTimeout(250);
    await until(async () => (await big.locator('.mold-doc-page[data-state="drawing"]').count()) === 0, 'the near pages drawn', 60000);
    const now = await drawnNow();
    now.forEach(page => everDrawn.add(page)); most = Math.max(most, now.length);
    if (done && everDrawn.has(30)) break;
  }
  check([...everDrawn].sort((a, b) => a - b), Array.from({length: 30}, (_, i) => i + 1), 'every page drawn once reached');
  ok(most <= 12, 'never more than a few pages held drawn at once: at most ' + most);
  check(await big.locator('.mold-doc-page[data-page="1"] canvas').evaluate(canvas => [canvas.width, canvas.height]), [0, 0], 'the first page\'s canvas given back at the end');
  ok(await boxIsLast(tablet, boxAfter('.sign-documents .mold-doc-viewer', '.sign-box')), 'the box after the 30th page');
  // On its side: the pages drawn again at the new width.
  await tablet.setViewportSize({width: TABLET.height, height: TABLET.width});
  await until(async () => (await big.locator('.mold-doc-page[data-page="30"] canvas').evaluate(canvas => canvas.width)) === 2 * 640, 'the last page drawn again on its side (640 px wide, density 2)', 60000);
  await noOverflow(tablet, 'the tablet on its side');
  await tablet.locator('.sign-box').scrollIntoViewIfNeeded();
  await shot(tablet, '10-link-big-pdf-end-tablet-landscape-ar');
  await tablet.locator('.sign-box input[name="signer"]').fill('م. ياسر القحطاني');
  // A stylus on the tablet (pen pointer events).
  await tablet.locator('.sign-box .mold-signature-pad').evaluate(element => {
    const rect = element.getBoundingClientRect(), event = (type, i, buttons = 1) => new PointerEvent(type, {pointerId: 9, pointerType: 'pen', isPrimary: true, bubbles: true, cancelable: true, pressure: 0.6, button: 0, buttons, clientX: rect.left + (0.12 + i * 0.024) * rect.width, clientY: rect.top + (0.5 + Math.sin(i / 3) * 0.28) * rect.height});
    element.dispatchEvent(event('pointerdown', 0));
    for (let i = 1; i < 32; i++) element.dispatchEvent(event('pointermove', i));
    element.dispatchEvent(event('pointerup', 31, 0));
  });
  await tablet.locator('.sign-box .sign-consent input').check();
  await throttle.send('Emulation.setCPUThrottlingRate', {rate: 1});
  await tablet.locator('.sign-box').getByRole('button', {name: 'توقيع'}).click();
  await tablet.locator('.sign-done').waitFor({timeout: 90000});
  check(await tablet.locator('.sign-done .sign-files li bdi').allInnerTexts(), ['كتالوج القالب - موقّع.pdf'], 'the 30-page PDF signed; the damaged quotation got no copy');
  ok((await tablet.locator('.sign-done').innerText()).includes('تالف.pdf'), 'and says so');
  console.log(JSON.stringify({bigPdfMB: +(big30.length / 1024 / 1024).toFixed(1), firstPageMs: firstDrawnMs, mostDrawnAtOnce: most, cpuThrottle: 4}));
  await tabletContext.close();

  // ---- 5. A request whose only file is a drawing: its row, and the box
  const drawingOnly = await requestWithLink(api, 'DRAWING ONLY 5', [['قالب.dwg', DRAWING, 'design']]);
  const lone = await browser.newPage({ignoreHTTPSErrors: true, viewport: PHONE});
  lone.on('pageerror', error => errors.push('drawing only: ' + error.message));
  await lone.goto(app.origin + '/sign/m/' + drawingOnly.token);
  await lone.locator('.sign-box').waitFor();
  check(await listed(lone.locator('.mold-doc-viewer')), [['other', 'design', 'التصميم: ملف قالب.dwg (مش PDF) — هيتبعت للإنتاج زي ما هو']], 'only a drawing: its row');
  ok(await boxIsLast(lone, boxAfter('.sign-documents .mold-doc-viewer', '.sign-box')), 'and the box after it');
  await noOverflow(lone, 'only a drawing at 360 px');
  await shot(lone, '11-link-drawing-only-phone-ar');
  await lone.close();

  check(errors, [], 'no page errors');
  console.log(JSON.stringify({ok: true, checks, screenshots, builtRelease: true, productionDataUsed: false}));
} finally {
  await browser?.close(); await app.stop(); await mock.stop();
}
