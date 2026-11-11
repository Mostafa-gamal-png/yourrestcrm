// The customer's signature inside a mold request's PDFs and the link the customer signs from (the owner, 2026-11-10), in a real Chromium
// against the BUILT release (run `pnpm build` first), sending to the stand-in production API: on a phone of 360 px in Arabic, the
// representative fills a request with a real PDF, chooses «ابعت للعميل لينك يوقّع منه» at the signing step, gets the link on the
// request's sheet, copies it (the clipboard holds it) and has WhatsApp ready on the customer's mobile; the card says «بانتظار توقيع
// العميل». The customer opens the link in a fresh browser (no session) on a phone: the request, its files shown on the page (the PDF drawn
// page after page, since the owner's «يوقع داخل pdf» of 2026-11-10, and opened through the link), English and back, then, in the box after
// the last page, the name, the pad (a finger), the consent and «توقيع»: «تم التوقيع، شكرًا» with the signed copy; the
// request reaches production. The signed copy's last page is rendered (poppler's pdftoppm, when on the machine) as a screenshot showing
// the block with the Arabic shaped by the browser. On a computer in English the sheet's link panel makes a new link; in Arabic the
// representative's device signing makes the signed copy, marked «نسخة موقّعة» on the sheet. Screenshots for the report. Synthetic
// fixtures only: temporary SQLite, PDFs made here, no production data, no real production app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {PDFDocument, StandardFonts} from 'pdf-lib';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';
import {signRequest} from '../scripts/lib/signature-pad.mjs';

const require = createRequire(import.meta.url), {chromium} = require('playwright');
const members = [{id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'}, {id: 'sup', role: 'supervisor', sup: 'sm'}, {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'أحمد عبد العزيز'}];
const screenshots = process.env.YR_MOLD_SCREENSHOT_DIR ? path.resolve(process.env.YR_MOLD_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-mold-sign-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1280, height: 900};
async function makePdf(label) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) { const page = doc.addPage([595, 842]); page.drawText(label + ' - page ' + (i + 1), {x: 60, y: 760, size: 20, font}); page.drawText('Synthetic drawing for the test', {x: 60, y: 400, size: 14, font}); }
  return Buffer.from(await doc.save());
}

const mock = await startProductsMock();
const app = await bootBuiltApp({members}, {tls: true, env: {YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret, NODE_EXTRA_CA_CERTS: mock.ca}});
try {
  const now = new Date().toISOString();
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind('east1', 'rep', JSON.stringify({name: 'مصنع الشرق', region: 'الشرقية', city: 'الدمام', address: 'حي الصناعية', phone: '0551234567', code: 'ERP-east1', internalCode: 'YR-C-000027', branch: 'الرئيسي', assignedTo: 'rep'}), now, now).run();
  const {scope} = await app.db.prepare('SELECT region_scope AS scope FROM crm_members WHERE id=?').bind('rep').first();
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  async function open(memberId, {viewport = DESKTOP, language = 'ar', touch = false} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', ...(touch ? {hasTouch: true, isMobile: true} : {})});
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {origin: app.origin});
    if (language === 'en') await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (memberId === 'rep') await installNativeBridge(page, {memberId: 'rep', regionScope: scope});
    await page.goto(app.origin + '/');
    await page.locator('.workspace').waitFor();
    return page;
  }
  const shot = async (page, label) => { await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const noOverflow = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal overflow');
  const goMolds = async page => {
    const more = page.locator('.mobile-bottom-navigation button[aria-haspopup="dialog"]');
    await page.locator('.mobile-bottom-navigation button[aria-haspopup="dialog"]:visible, button.nav-item:visible').first().waitFor();
    if (await more.isVisible()) { await more.click(); await page.locator('.mobile-overflow-pages button[data-page="mold-requests"]').click(); await page.locator('.mobile-navigation-sheet').waitFor({state: 'detached'}); }
    else await page.locator('button.nav-item', {hasText: /طلبات تصنيع القوالب|Mold requests/}).first().click();
    await page.locator('.mold-page').waitFor();
  };
  const sheet = page => page.locator('.mold-sheet');
  const fill = async (dialog, file) => {
    await dialog.locator('.mold-customer-field[data-field="name"] input').fill('مصنع الشرق');
    await dialog.locator('.mold-customer-suggestions [role="option"]').filter({hasText: 'مصنع الشرق'}).first().click();
    await dialog.locator('.mold-customer-chosen').waitFor();
    await dialog.locator('label.mold-field', {hasText: 'وصف القالب'}).locator('input').fill('200*400*27.5TH MM OPEN');
    for (const text of ['مفتوح', 'موديل قديم', 'بدون بلوكة نص']) await dialog.locator('.mold-choice label', {hasText: text}).click();
    await dialog.locator('.mold-choice', {hasText: 'عدد الرجاجات'}).locator('label', {hasText: '2'}).click();
    await dialog.locator('label.mold-field', {hasText: 'عرض القالب'}).locator('.mold-usual button', {hasText: '1380'}).click();
    await dialog.locator('label.mold-field', {hasText: 'مقاس الجلب'}).locator('.mold-usual button', {hasText: '795'}).click();
    await dialog.locator('.mold-choice', {hasText: 'طريقة الدفع'}).first().locator('label', {hasText: 'نقدي'}).click();
    const picker = dialog.locator('.mold-design-picker[data-category="design"]');
    await picker.locator('input[type=file]').setInputFiles(file);
    await picker.locator('.mold-design-file[data-state="ready"]').first().waitFor();
  };
  const until = async (test, message, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await test()) return; await new Promise(resolve => setTimeout(resolve, 200)); } assert.fail('timed out: ' + message); };

  // ---- 1. On a phone in Arabic: the representative chooses the link, gets it, copies it
  const rep = await open('rep', {viewport: PHONE, touch: true});
  await goMolds(rep);
  await rep.locator('.mold-new').click();
  const dialog = rep.locator('.mold-dialog');
  await fill(dialog, {name: 'رسم القالب.pdf', mimeType: 'application/pdf', buffer: await makePdf('Design A')});
  await dialog.getByRole('button', {name: 'حفظ وإرسال للإنتاج'}).click();
  await dialog.locator('.mold-signing').waitFor();
  check(await dialog.locator('.mold-signing-mode label').allInnerTexts(), ['العميل يوقّع دلوقتي', 'ابعت للعميل لينك يوقّع منه'], 'the two choices at the signing step');
  await dialog.locator('.mold-signing-mode label', {hasText: 'ابعت للعميل لينك يوقّع منه'}).click();
  ok(await dialog.locator('.mold-signing-link-note').isVisible(), 'what the link does is said');
  check(await dialog.locator('.mold-signing .mold-signature-pad').count(), 0, 'no pad for the link');
  await noOverflow(rep, 'the link choice at 360 px');
  await shot(rep, '01-rep-link-choice-360-ar');
  await dialog.getByRole('button', {name: 'حفظ وعمل اللينك'}).click();
  const panel = sheet(rep).locator('.mold-sign-link');
  await panel.waitFor();
  const url = await panel.locator('.mold-sign-link-url input').inputValue();
  ok(url.startsWith(app.origin + '/sign/m/') && /\/sign\/m\/[A-Za-z0-9_-]{43}$/.test(url), 'the link on the CRM\'s origin, shown on the sheet');
  await panel.getByRole('button', {name: 'نسخ اللينك'}).click();
  check(await rep.evaluate(() => navigator.clipboard.readText()), url, '«نسخ اللينك» puts it on the clipboard');
  ok(await panel.getByRole('button', {name: 'اتنسخ اللينك'}).isVisible(), 'and says so');
  const whatsapp = await panel.locator('a', {hasText: 'إرسال واتساب'}).getAttribute('href');
  ok(whatsapp.startsWith('https://wa.me/966551234567?text=') && decodeURIComponent(whatsapp).includes(url), 'WhatsApp on the customer\'s mobile with the link');
  await until(async () => (await sheet(rep).locator('.mold-sending').innerText()).includes('بانتظار توقيع العميل'), 'the request waits for the customer\'s signature once its file is up');
  await noOverflow(rep, 'the sheet with the link at 360 px');
  await panel.scrollIntoViewIfNeeded();
  await shot(rep, '02-rep-sheet-link-360-ar');
  await rep.keyboard.press('Escape');
  const card = rep.locator('.mold-card').first();
  await until(async () => (await card.innerText()).includes('بانتظار توقيع العميل'), 'the card says it');
  ok((await card.locator('.mold-sign-link-line').innerText()).includes('ينتهي'), 'the card says when the link was made and until when');
  await shot(rep, '03-rep-card-360-ar');
  const requestId = (await app.db.prepare('SELECT id FROM crm_mold_requests ORDER BY created_at DESC LIMIT 1').first()).id;
  check(mock.state.calls.filter(call => call.route === 'requests' && call.body.includes(requestId)).length, 0, 'not sent while it waits');

  // ---- 2. The customer, in a fresh browser on a phone: the request, a PDF through the link, English and back, the signature
  const customerContext = await browser.newContext({ignoreHTTPSErrors: true, viewport: PHONE, deviceScaleFactor: 1, hasTouch: true, isMobile: true, serviceWorkers: 'block'});
  const customer = await customerContext.newPage();
  customer.on('pageerror', error => errors.push('customer: ' + error.message));
  await customer.goto(url);
  await customer.locator('.sign-card h1').waitFor();
  check(await customer.locator('.sign-card h1').innerText(), 'طلب تصنيع قالب — مصنع الشرق', 'the page: «طلب تصنيع قالب — <the customer>»');
  // Since 2026-11-11 what is signed for is on the document's signature page, its last page.
  await customer.locator('.sign-documents .mold-doc-viewer[data-ready]').waitFor({timeout: 60000});
  ok((await customer.locator('.mold-doc-sign-sheet .mold-signing-summary').innerText()).includes('مصنع الشرق'), 'what the customer signs for');
  check(await customer.locator('.workspace, nav, .mobile-bottom-navigation').count(), 0, 'no CRM navigation');
  check(await customer.evaluate(() => document.querySelector('meta[name="robots"]')?.content || ''), 'noindex, nofollow, nocache', 'not indexed');
  await noOverflow(customer, 'the customer\'s page at 360 px');
  await shot(customer, '04-customer-page-360-ar');
  // The PDF is the document itself (since 2026-11-11 one document): its two pages, then the signature page, «صفحة n من 3».
  const sheets = customer.locator('.sign-documents .mold-doc-sheet');
  check(await sheets.evaluateAll(items => items.map(item => [item.dataset.kind, item.querySelector('.mold-doc-counter').textContent.trim(), (item.querySelector('.mold-doc-caption')?.textContent || '').trim()])),
    [['pdf', 'صفحة 1 من 3', 'التصميم · رسم القالب.pdf'], ['pdf', 'صفحة 2 من 3', 'التصميم · رسم القالب.pdf'], ['signature', 'صفحة 3 من 3', '']], 'the design\'s PDF, both pages, and the signature page last');
  const fileId = (await app.db.prepare("SELECT id FROM crm_mold_design_files WHERE request_id=(SELECT id FROM crm_mold_requests ORDER BY created_at DESC LIMIT 1) AND name='رسم القالب.pdf'").first()).id;
  const href = new URL(url).pathname + '/file/' + fileId;
  // Fetched by the page itself (the browser maps the CRM's name to the test server; a request from Node would not).
  const fetched = target => customer.evaluate(async address => { const reply = await fetch(address, {cache: 'no-store'}), bytes = new Uint8Array(await reply.arrayBuffer()); let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); return {status: reply.status, type: reply.headers.get('content-type'), base64: btoa(text)}; }, target);
  const opened = await fetched(href);
  check([opened.status, opened.type, Buffer.from(opened.base64, 'base64').subarray(0, 5).toString('latin1')], [200, 'application/pdf', '%PDF-'], 'the PDF opens through the link');
  await customer.getByRole('button', {name: 'English'}).click();
  await until(async () => (await customer.locator('.sign-card h1').innerText()).startsWith('Mold manufacturing request'), 'English');
  ok((await customer.locator('.sign-consent').innerText()).includes('I have read the request and its files'), 'the consent in English');
  await noOverflow(customer, 'the customer\'s page in English');
  await shot(customer, '05-customer-page-360-en');
  await customer.getByRole('button', {name: 'العربية'}).click();
  await until(async () => (await customer.locator('.sign-card h1').innerText()).startsWith('طلب تصنيع قالب'), 'back to Arabic');
  await customer.locator('.sign-under').getByRole('button', {name: 'توقيع'}).click();
  ok(await customer.locator('.sign-form .field-error').count() >= 2, 'a name, a signature and the consent are required');
  await customer.locator('.sign-form input[name="signer"]').fill('سالم الحربي');
  const pad = customer.locator('.sign-form .mold-signature-pad');
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox(), cdp = await customerContext.newCDPSession(customer);
  const point = i => ({x: box.x + (0.12 + i * 0.024) * box.width, y: box.y + (0.5 + Math.sin(i / 3) * 0.28) * box.height, id: 1});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [point(0)]});
  for (let i = 1; i < 32; i++) await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [point(i)]});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await customer.locator('.sign-consent input').check();
  await shot(customer, '06-customer-signed-pad-360-ar');
  await customer.locator('.sign-under').getByRole('button', {name: 'توقيع'}).click();
  await customer.locator('.sign-done').waitFor({timeout: 40000});
  check(await customer.locator('.sign-done h1').innerText(), 'تم التوقيع، شكرًا', '«تم التوقيع، شكرًا»');
  const copyLink = customer.locator('.sign-done .sign-files a').first();
  check(await customer.locator('.sign-done .sign-files li bdi').allInnerTexts(), ['طلب القالب - موقّع.pdf'], 'the ONE signed file to download (2026-11-11)');
  await noOverflow(customer, 'the thank-you page');
  await shot(customer, '07-customer-done-360-ar');
  await until(() => mock.state.calls.some(call => call.route === 'requests' && call.signed && call.body.includes(requestId)), 'the request reaches production');
  await until(() => (mock.row(requestId)?.designFiles || []).some(file => file.name === 'طلب القالب - موقّع.pdf'), 'its signed file too');
  // The signed file's last page as a picture: the signature page, the Arabic shaped by the browser's canvas.
  const copy = await fetched(await copyLink.getAttribute('href'));
  const copyBytes = Buffer.from(copy.base64, 'base64');
  check([copy.status, copyBytes.subarray(0, 5).toString('latin1')], [200, '%PDF-'], 'the signed copy downloads');
  const signedFile = path.join(screenshots, 'signed-copy.pdf');
  fs.writeFileSync(signedFile, copyBytes);
  try {
    check((await PDFDocument.load(copyBytes)).getPageCount(), 3, 'the signed file: the design\'s two pages and the signature page');
    execFileSync('pdftoppm', ['-png', '-r', '110', '-f', '3', '-l', '3', '-singlefile', signedFile, path.join(screenshots, '08-signed-copy-last-page')]);
    execFileSync('pdftoppm', ['-png', '-r', '200', '-f', '3', '-l', '3', '-singlefile', '-x', '0', '-y', '1150', '-W', '1654', '-H', '1100', signedFile, path.join(screenshots, '09-signed-copy-block-zoom')]);
    ok(fs.existsSync(path.join(screenshots, '08-signed-copy-last-page.png')), 'the signed copy\'s last page rendered');
  } catch { console.log(JSON.stringify({note: 'pdftoppm not available: the signed copy was checked as a file, not rendered'})); }

  // ---- 3. On a computer in English: the sheet's panel makes a new link for a request whose link was made elsewhere
  const apiCreate = await rep.evaluate(async () => (await fetch('/api/mold-requests', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({requestId: crypto.randomUUID(), action: 'create', customerId: 'east1', specs: {description: 'قالب بلوك 15', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: '', quantity: 1, notes: ''}, payment: 'cash', address: 'الدمام', signatureLink: true})})).status);
  check(apiCreate, 200, 'a second request with a link');
  const english = await open('rep', {language: 'en'});
  await goMolds(english);
  await english.locator('.mold-card', {hasText: 'قالب بلوك 15'}).click();
  const englishPanel = sheet(english).locator('.mold-sign-link');
  await englishPanel.waitFor();
  ok((await englishPanel.innerText()).includes('The link is shown once'), 'the address is not known here: said so');
  await englishPanel.getByRole('button', {name: 'Send a new link'}).click();
  await englishPanel.locator('.mold-sign-link-url input').waitFor();
  ok((await englishPanel.innerText()).includes('Customer signing link') && (await englishPanel.innerText()).includes('Send on WhatsApp'), 'the panel in English, the new link shown');
  await shot(english, '10-rep-sheet-new-link-desktop-en');

  // ---- 4. The representative's device signing makes the signed copy, marked on the sheet (Arabic, a computer)
  const desk = await open('rep');
  await goMolds(desk);
  await desk.locator('.mold-new').click();
  const form = desk.locator('.mold-dialog');
  await fill(form, {name: 'مخطط الجهاز.pdf', mimeType: 'application/pdf', buffer: await makePdf('Device')});
  await form.getByRole('button', {name: 'حفظ وإرسال للإنتاج'}).click();
  await signRequest(desk, {signer: 'م. خالد العتيبي'});
  await sheet(desk).waitFor();
  await until(async () => (await sheet(desk).locator('.mold-design-file[data-signed-copy]').count()) === 1, 'the signed file appears on the sheet', 60000);
  check(await sheet(desk).locator('.mold-design-file[data-signed-copy] .mold-chip').innerText(), 'الملف الموقّع', 'marked «الملف الموقّع» (2026-11-11: one file)');
  check(await sheet(desk).locator('.mold-design-file[data-signed-copy] .mold-design-delete').count(), 0, 'not deletable');
  await until(async () => (await sheet(desk).locator('.mold-signing-notes [data-document="made"]').count()) === 1, 'the sheet says the signed file was made');
  ok((await sheet(desk).locator('.mold-signing-notes [data-document="made"]').innerText()).includes('3 صفحات'), 'with its pages (the PDF\'s two pages and the signature page)');
  await sheet(desk).locator('.mold-design-file[data-signed-copy]').scrollIntoViewIfNeeded();
  await shot(desk, '11-rep-sheet-signed-copy-desktop-ar');

  check(errors, [], 'no page errors');
  console.log(JSON.stringify({ok: true, checks, screenshots, builtRelease: true, productionDataUsed: false}));
} finally {
  await browser?.close(); await app.stop(); await mock.stop();
}
