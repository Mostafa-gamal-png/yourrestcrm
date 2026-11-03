// Mold request design files (the contract's addition «ملفات التصميم», 2026-11-02) in a real Chromium against the BUILT release (run
// `pnpm build` first), sending to the stand-in production API (scripts/lib/products-mock.mjs): a representative chooses design files in
// the new-request form (a PDF that may go, and one the device refuses with its reason), saves, and sees the PDF sent once production holds
// the request; production attaches its own file, shown in the request as production's and opened through the CRM; a drawing attached
// from the request's sheet is confirmed first (the warning that it undoes the approvals), the server's «busy» answers with a retry hint
// and the retry sends it (nothing is uploaded before the confirmation); the representative deletes their PDF after confirming the same
// warning; a request production holds offers no edit (its data is the production manager's, 2026-11-02), its files are still attached
// from the sheet after the same warning; an upload outlives the page (the representative moves to another page while it is on its way, comes back to it still uploading,
// and later to its failure with the reason and Retry, also said on the request's card); the request on a phone keeps every button within
// the screen, each at least 44 px (the refused files' dismiss button too); the sales manager sees each pending request's files (one
// registered in production too), is told why a download or an opened file failed while production is unreachable, downloads one
// through the CRM, and, having approved two requests (one registered in production, one of the CRM's), sees their cards under «اعتمدتها
// الآن» with the files named but no links (the CRM's says to open the request, whose sheet does open them); when the representative then
// attaches a file, which returns the CRM's request to the sales manager, the next refresh puts it back in the waiting list with its new
// file, links and Approve. The device's own check takes production's PR #27 inputs (a PDF whose header follows other bytes, named
// CON.pdf; a PNG named .jpg) and refuses a header beyond the first 1024 bytes. A request production never stored (refused at its door)
// is still edited, and a file chosen in its edit form follows the edit: no warning (production holds nothing to undo), uploaded once the
// change is saved, held in the CRM while the request has not reached production, then sent once it has. Screenshots for the report.
// Synthetic fixtures only: temporary SQLite, no production data, no real production app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require('playwright');
const members = [{id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'}, {id: 'sup', role: 'supervisor', sup: 'sm'}, {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'أحمد عبد العزيز'}];
const screenshots = process.env.YR_MOLD_SCREENSHOT_DIR ? path.resolve(process.env.YR_MOLD_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-mold-design-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1280, height: 900};
const LABEL = 'طلبات تصنيع القوالب', WARNING = 'إرفاق ملف أو حذفه بيتحسب تعديل على الطلب';
const drawingPdf = Buffer.from('%PDF-1.4\n% رسم القالب للعميل\n%%EOF\n'), drawingDwg = Buffer.from('AC1027 synthetic drawing for the browser test'), drawingDxf = Buffer.from('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n');
// A real 1x1 PNG, so the browser can show it.
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const mock = await startProductsMock();
const app = await bootBuiltApp({members}, {tls: true, env: {YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret, NODE_EXTRA_CA_CERTS: mock.ca}});
try {
  const now = new Date().toISOString();
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('east1','customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')")
    .bind(JSON.stringify({name: 'مصنع east1', region: 'الشرقية', city: 'الدمام', address: 'حي الصناعية', code: 'ERP-east1', branch: 'الرئيسي', assignedTo: 'rep'}), now, now).run();
  const {scope} = await app.db.prepare('SELECT region_scope AS scope FROM crm_members WHERE id=?').bind('rep').first();
  const crmNumber = (await app.db.prepare("SELECT number FROM crm_customer_numbers WHERE customer_id='east1'").first()).number;
  const stale = () => app.db.prepare("UPDATE crm_mold_requests SET remote_at='2026-01-01T00:00:00.000Z'").run();
  // A UTF-8 locale, as phones and desktops have: under the C locale Chromium names a download with an Arabic name «download».
  browser = await chromium.launch({headless: true, env: {...process.env, LANG: 'C.UTF-8'}, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  async function open(memberId, {viewport = DESKTOP} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: true});
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
  const shot = async (page, label) => { await page.waitForTimeout(300); await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const noOverflow = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal overflow');
  const goMolds = async page => { await page.locator('button.nav-item', {hasText: LABEL}).first().click(); await page.locator('.mold-page').waitFor(); };
  const sheet = page => page.locator('.mold-sheet');
  const fileRow = (scopeLocator, name) => scopeLocator.locator('.mold-design-file', {hasText: name});
  const names = row => (row?.designFiles || []).map(file => file.name).sort();

  // ---- 1. The new-request form: a PDF that may go and one the device refuses, with the reason
  const rep = await open('rep');
  await goMolds(rep);
  await rep.locator('button.mold-new').click();
  const dialog = rep.locator('.mold-dialog');
  await dialog.waitFor();
  await dialog.locator('.mold-customer-search input').fill('مصنع east1');
  await dialog.locator('.mold-customer-matches button', {hasText: 'مصنع east1'}).click();
  await dialog.locator('label.mold-field', {hasText: 'وصف القالب'}).locator('input').fill('قالب بلوك بتصميم مرفق');
  for (const text of ['مفتوح', 'موديل قديم', 'بدون بلوكة نص']) await dialog.locator('.mold-choice label', {hasText: text}).click();
  await dialog.locator('.mold-choice', {hasText: 'عدد الرجاجات'}).locator('label', {hasText: '2'}).click();
  await dialog.locator('label.mold-field', {hasText: 'عرض القالب'}).locator('.mold-usual button', {hasText: '1380'}).click();
  await dialog.locator('label.mold-field', {hasText: 'مقاس الجلب'}).locator('.mold-usual button', {hasText: '795'}).click();
  await dialog.locator('.mold-choice', {hasText: 'طريقة الدفع'}).locator('label', {hasText: 'نقدي'}).click();
  const picker = dialog.locator('.mold-design-picker');
  check((await picker.locator('input[type=file]').getAttribute('accept')).split(',').slice(0, 3), ['.pdf', '.png', '.jpg'], 'the picker offers the contract\'s extensions');
  await picker.locator('input[type=file]').setInputFiles([{name: 'رسم القالب.pdf', mimeType: 'application/pdf', buffer: drawingPdf}, {name: 'ليس-pdf.pdf', mimeType: 'application/pdf', buffer: Buffer.from('this is not a pdf')}]);
  await picker.locator('.mold-design-file[data-state="refused"]').waitFor();
  check([await picker.locator('.mold-design-file[data-state="ready"]').count(), await fileRow(picker, 'رسم القالب.pdf').locator('.mold-design-state').innerText()], [1, 'يُرفع بعد حفظ الطلب'], 'the PDF waits for the request to be saved');
  check(await fileRow(picker, 'ليس-pdf.pdf').locator('.mold-design-reason').innerText(), 'الملف ليس PDF فعلًا', 'the device refuses a false PDF and says why, before anything is sent');
  // Production's PR #27 inputs, checked by the browser itself (its File, the first bytes it reads): a PDF whose %PDF-1.7 starts at byte
  // 600 named CON.pdf and a PNG named .jpg may go; a header beyond the first 1024 bytes may not. Removed again before saving.
  const leadingPdf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.alloc(597, 0x20), Buffer.from('%PDF-1.7\n% header after 600 bytes\n%%EOF\n')]);
  await picker.locator('input[type=file]').setInputFiles([{name: 'CON.pdf', mimeType: 'application/pdf', buffer: leadingPdf}, {name: 'لقطة.jpg', mimeType: 'image/jpeg', buffer: pixel},
    {name: 'late.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.alloc(1024, 0x20), Buffer.from('%PDF-1.4\n%%EOF\n')])}]);
  await fileRow(picker, 'late.pdf').waitFor();
  check(await Promise.all(['CON.pdf', 'لقطة.jpg', 'late.pdf'].map(name => fileRow(picker, name).getAttribute('data-state'))), ['ready', 'ready', 'refused'], 'on the device: CON.pdf with its header after 600 bytes and a PNG named .jpg may go; a header beyond 1024 bytes may not');
  check(await fileRow(picker, 'late.pdf').locator('.mold-design-reason').innerText(), 'الملف ليس PDF فعلًا', 'and says why');
  for (const name of ['CON.pdf', 'لقطة.jpg', 'late.pdf']) await picker.getByRole('button', {name: 'إزالة ' + name}).click();
  check(await picker.locator('.mold-design-name').allInnerTexts(), ['رسم القالب.pdf', 'ليس-pdf.pdf'], 'removed again: the form keeps its two files');
  await picker.scrollIntoViewIfNeeded();
  await shot(rep, 'mold-design-form');
  const sendsBefore = mock.state.calls.filter(call => call.route === 'design-files').length;
  await dialog.getByRole('button', {name: 'حفظ وإرسال للإنتاج'}).click();

  // ---- 2. Saved, then the PDF uploads and goes to production once production holds the request
  await sheet(rep).waitFor();
  await fileRow(sheet(rep), 'رسم القالب.pdf').and(rep.locator('[data-state="sent"]')).waitFor();
  check(await fileRow(sheet(rep), 'رسم القالب.pdf').locator('.mold-design-state').innerText(), 'وصل للإنتاج', 'the sheet says it reached production');
  check(await fileRow(sheet(rep), 'ليس-pdf.pdf').count(), 0, 'the refused file was never uploaded');
  const requestId = JSON.parse(mock.state.calls.findLast(call => call.route === 'requests').body).crmRequestId;
  check([mock.state.calls.filter(call => call.route === 'design-files').length - sendsBefore, names(mock.row(requestId))], [1, ['رسم القالب.pdf']], 'production received the one file');
  ok(Buffer.compare(mock.row(requestId).designFiles[0].bytes, drawingPdf) === 0, 'byte for byte');
  await shot(rep, 'mold-design-sent');
  await rep.keyboard.press('Escape');

  // ---- 3. Production attaches its own file: shown as production's, opened through the CRM
  mock.addProductionFile(requestId, {name: 'صورة من الإنتاج.png', bytes: pixel});
  await stale();
  await rep.locator('.mold-heading-tools button').first().click();
  await rep.locator('.mold-card', {hasText: 'مصنع east1'}).click();
  const productionRow = fileRow(sheet(rep), 'صورة من الإنتاج.png');
  await productionRow.waitFor();
  check([await productionRow.getAttribute('data-source'), await productionRow.locator('.mold-chip').innerText(), await productionRow.getByRole('button', {name: /حذف/}).count()], ['production', 'من الإنتاج', 0], 'production\'s file, marked as production\'s, not deletable here');
  const hrefs = await sheet(rep).locator('.mold-design a').evaluateAll(links => links.map(link => link.getAttribute('href')));
  ok(hrefs.length >= 4 && hrefs.every(href => href.startsWith('/api/mold-requests/design-file?id=')), 'every open and download link goes through the CRM: ' + hrefs.join(' '));
  const [viewer] = await Promise.all([rep.waitForEvent('popup'), productionRow.getByRole('link', {name: 'عرض صورة من الإنتاج.png'}).click()]);
  await viewer.waitForLoadState();
  const shown = new URL(viewer.url());
  check([shown.pathname, shown.searchParams.get('inline'), await viewer.evaluate(() => document.images[0]?.naturalWidth)], ['/api/mold-requests/design-file', '1', 1], 'the image opens in the browser, from the CRM');
  await viewer.close();

  // ---- 4. A drawing attached from the sheet: the warning first; the server busy (429) says to retry; the retry sends it
  const approve = app.as(await app.login('sm'));
  check((await approve('/api/mold-requests', {method: 'POST', body: {action: 'approve', requestId: crypto.randomUUID(), id: requestId}})).status, 200, 'the sales manager approves meanwhile');
  await rep.keyboard.press('Escape');
  await stale();
  await rep.locator('.mold-heading-tools button').first().click();
  await rep.locator('.mold-card', {hasText: 'مصنع east1'}).click();
  await sheet(rep).locator('.mold-approvals li[data-done="true"]').waitFor();
  // Every upload the page starts is counted: none may leave before the confirmation (the busy answer below is installed only after it).
  const uploadPosts = [];
  rep.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/mold-requests/design-files') uploadPosts.push(request.url()); });
  await sheet(rep).locator('.mold-design-tools input[type=file]').setInputFiles({name: 'مسقط.dwg', mimeType: 'application/octet-stream', buffer: drawingDwg});
  const confirmAttach = sheet(rep).locator('.mold-design-confirm', {hasText: 'مسقط.dwg'});
  await confirmAttach.waitFor();
  ok((await confirmAttach.innerText()).includes(WARNING), 'the warning: attaching undoes the approvals and returns the request to the sales manager');
  await confirmAttach.scrollIntoViewIfNeeded();
  await shot(rep, 'mold-design-attach-warning');
  check([uploadPosts.length, mock.row(requestId).designFiles.length], [0, 2], 'nothing uploaded to the CRM, nor sent to production, before the confirmation');
  let busy = 1;
  await rep.route('**/api/mold-requests/design-files', route => {
    if (route.request().method() === 'POST' && busy-- > 0) return route.fulfill({status: 429, headers: {'Content-Type': 'application/json', 'Retry-After': '5'}, body: JSON.stringify({error: 'رفع الملفات مشغول مؤقتًا. أعد المحاولة بعد لحظات.'})});
    return route.continue();
  });
  await confirmAttach.getByRole('button', {name: 'تأكيد الإرفاق'}).click();
  const failed = fileRow(sheet(rep), 'مسقط.dwg').and(rep.locator('[data-state="upload-failed"]'));
  await failed.waitFor();
  ok((await failed.locator('.mold-design-reason').innerText()).includes('مشغول'), 'busy: said so, with the hint to retry');
  await shot(rep, 'mold-design-busy');
  await failed.getByRole('button', {name: 'إعادة المحاولة'}).click();
  await fileRow(sheet(rep), 'مسقط.dwg').and(rep.locator('[data-state="sent"]')).waitFor();
  await rep.unrouteAll();
  check([names(mock.row(requestId)), mock.row(requestId).approvals.sales], [['رسم القالب.pdf', 'صورة من الإنتاج.png', 'مسقط.dwg'], null], 'the drawing reached production and the approval was undone there');
  await sheet(rep).locator('.mold-approvals li[data-done="true"]').waitFor({state: 'detached'});
  check(await sheet(rep).locator('.mold-waiting strong').innerText(), 'بانتظار اعتماد مدير المبيعات', 'the sheet shows the request back with the sales manager');

  // ---- 5. The representative deletes their PDF after confirming the same warning
  const pdfRow = fileRow(sheet(rep), 'رسم القالب.pdf');
  await pdfRow.getByRole('button', {name: 'حذف رسم القالب.pdf'}).click();
  const confirmDelete = pdfRow.locator('.mold-design-confirm');
  await confirmDelete.waitFor();
  ok((await confirmDelete.innerText()).includes(WARNING), 'the delete is warned about too');
  await shot(rep, 'mold-design-delete-warning');
  await confirmDelete.getByRole('button', {name: 'تأكيد الحذف'}).click();
  await pdfRow.waitFor({state: 'detached'});
  check([names(mock.row(requestId)), await sheet(rep).locator('.mold-design-file').count()], [['صورة من الإنتاج.png', 'مسقط.dwg'], 2], 'deleted at production too; the sheet shows the two left');

  // ---- 5b. A request production holds offers no edit (the production manager edits its data in the products application): another
  //  file is attached from the sheet itself, after the same confirmation, and follows to production
  check([await sheet(rep).getByRole('button', {name: 'تعديل الطلب'}).count(), await sheet(rep).getByRole('button', {name: 'إلغاء الطلب'}).count()], [0, 1], 'no edit on a request production holds; cancel stays');
  await sheet(rep).locator('.mold-design-tools input[type=file]').setInputFiles({name: 'مقطع جانبي.png', mimeType: 'image/png', buffer: pixel});
  const sideWarning = sheet(rep).locator('.mold-design-confirm', {hasText: 'مقطع جانبي.png'});
  await sideWarning.waitFor();
  ok((await sideWarning.innerText()).includes(WARNING), 'the sheet warns before attaching it too');
  check(mock.row(requestId).designFiles.length, 2, 'nothing sent before the confirmation');
  await shot(rep, 'mold-design-sheet-attach-warning');
  await sideWarning.getByRole('button', {name: 'تأكيد الإرفاق'}).click();
  await fileRow(sheet(rep), 'مقطع جانبي.png').and(rep.locator('[data-state="sent"]')).waitFor();
  check(names(mock.row(requestId)), ['صورة من الإنتاج.png', 'مسقط.dwg', 'مقطع جانبي.png'], 'the file attached from the sheet reached production');

  // ---- 5c. An upload outlives the page: the representative moves to another page while it is on its way, comes back to it still
  //  uploading, leaves again, it fails meanwhile (busy), and back on the mold page the card and the sheet say so, with Retry
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await rep.route('**/api/mold-requests/design-files', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    await held;
    return route.fulfill({status: 429, headers: {'Content-Type': 'application/json', 'Retry-After': '5'}, body: JSON.stringify({error: 'رفع الملفات مشغول مؤقتًا. أعد المحاولة بعد لحظات.'})});
  });
  const postsBefore = uploadPosts.length;
  await sheet(rep).locator('.mold-design-tools input[type=file]').setInputFiles({name: 'واجهة أمامية.dxf', mimeType: 'application/octet-stream', buffer: drawingDxf});
  await sheet(rep).locator('.mold-design-confirm', {hasText: 'واجهة أمامية.dxf'}).getByRole('button', {name: 'تأكيد الإرفاق'}).click();
  await fileRow(sheet(rep), 'واجهة أمامية.dxf').and(rep.locator('[data-state="upload-uploading"], [data-state="upload-processing"]')).waitFor();
  const away = async () => { await rep.keyboard.press('Escape'); await sheet(rep).waitFor({state: 'detached'}); await rep.getByRole('button', {name: 'العملاء', exact: true}).click(); await rep.locator('.mold-page').waitFor({state: 'detached'}); };
  const back = async () => { await goMolds(rep); await rep.locator('.mold-card', {hasText: 'مصنع east1'}).click(); await sheet(rep).waitFor(); };
  await away();
  await back();
  await fileRow(sheet(rep), 'واجهة أمامية.dxf').and(rep.locator('[data-state="upload-uploading"], [data-state="upload-processing"]')).waitFor();
  ok(true, 'back on the page while it is still on its way: the upload is shown, not lost');
  await away();
  release();
  await rep.waitForTimeout(500);
  await rep.unrouteAll();
  await goMolds(rep);
  const card = rep.locator('.mold-card', {hasText: 'مصنع east1'});
  await card.locator('.mold-card-sending', {hasText: 'ملفات تصميم لم تُرفع: 1'}).waitFor();
  ok(true, 'the request\'s card says a design file was not uploaded');
  await card.click();
  const failedAway = fileRow(sheet(rep), 'واجهة أمامية.dxf').and(rep.locator('[data-state="upload-failed"]'));
  await failedAway.waitFor();
  ok((await failedAway.locator('.mold-design-reason').innerText()).includes('مشغول'), 'the failure while away: its reason, and Retry');
  await shot(rep, 'mold-design-upload-after-page-change');
  await failedAway.getByRole('button', {name: 'إعادة المحاولة'}).click();
  await fileRow(sheet(rep), 'واجهة أمامية.dxf').and(rep.locator('[data-state="sent"]')).waitFor();
  check([names(mock.row(requestId)).filter(name => name === 'واجهة أمامية.dxf').length, uploadPosts.length - postsBefore, (await app.db.prepare("SELECT COUNT(*) AS n FROM crm_mold_design_files WHERE name='واجهة أمامية.dxf'").first()).n], [1, 2, 1], 'one file: the held upload and its retry, under one requestId');
  await rep.context().close();

  // ---- 6. On a phone: the files and their buttons fit the screen, each button big enough to tap
  const phone = await open('rep', {viewport: PHONE});
  await phone.locator('.mobile-bottom-navigation button[aria-haspopup="dialog"]').click();
  await phone.locator('.mobile-overflow-pages button[data-page="mold-requests"]').click();
  await phone.locator('.mobile-navigation-sheet').waitFor({state: 'detached'});
  await phone.locator('.mold-card', {hasText: 'مصنع east1'}).click();
  await phone.waitForFunction(() => { const box = document.querySelector('.mold-sheet')?.getBoundingClientRect(); return !!box && box.left >= -1 && box.right <= innerWidth + 1; });
  const files = sheet(phone).locator('.mold-design');
  await files.locator('.mold-design-file').nth(1).waitFor();
  await files.scrollIntoViewIfNeeded();
  check(await sheet(phone).evaluate(element => element.scrollWidth > element.clientWidth + 1), false, 'phone sheet: nothing wider than the screen');
  const boxes = await files.locator('.mold-design-actions .btn, .mold-design-attach').evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return {height: box.height, left: box.left, right: box.right}; }));
  ok(boxes.length >= 5 && boxes.every(box => box.height >= 44 && box.left >= 0 && box.right <= 361), 'every button at least 44 px high and on the screen: ' + JSON.stringify(boxes));
  // A file the device refuses: the box saying why, and its dismiss button, as big as the others.
  await files.locator('.mold-design-tools input[type=file]').setInputFiles({name: 'ليس-pdf.pdf', mimeType: 'application/pdf', buffer: Buffer.from('this is not a pdf')});
  const refusedBox = files.locator('.mold-design-refused');
  await refusedBox.waitFor();
  const dismiss = await refusedBox.getByRole('button', {name: 'إخفاء'}).boundingBox();
  ok(dismiss.width >= 44 && dismiss.height >= 44 && dismiss.x >= 0 && dismiss.x + dismiss.width <= 361, 'the refused files\' dismiss button is at least 44 by 44 px: ' + JSON.stringify(dismiss));
  await shot(phone, 'mold-design-refused-phone');
  await refusedBox.getByRole('button', {name: 'إخفاء'}).click();
  await refusedBox.waitFor({state: 'detached'});
  await noOverflow(phone, 'phone');
  await shot(phone, 'mold-design-files-phone');
  await phone.context().close();

  // ---- 7. The sales manager: each pending request's files (one registered in production too), downloaded through the CRM
  const manual = mock.registerManual({customerNo: crmNumber, customerName: 'مصنع مسجّل في الإنتاج', createdBy: 'prod@yourrest.org'});
  mock.addProductionFile(manual.orderNo, {name: 'تصميم من الإنتاج.pdf', bytes: Buffer.from('%PDF-1.4 manual design')});
  const sm = await open('sm');
  await goMolds(sm);
  const crmCard = sm.locator('.mold-pending', {hasText: 'مصنع east1'}), manualCard = sm.locator('.mold-pending', {hasText: 'مصنع مسجّل في الإنتاج'});
  await crmCard.locator('.mold-design-file').nth(1).waitFor();
  check(await crmCard.locator('.mold-design-name').allInnerTexts(), ['صورة من الإنتاج.png', 'مسقط.dwg', 'مقطع جانبي.png', 'واجهة أمامية.dxf'], 'the CRM request\'s files: production\'s and the representative\'s (the deleted PDF is gone)');
  check(await manualCard.locator('.mold-design-name').allInnerTexts(), ['تصميم من الإنتاج.pdf'], 'a request registered in production shows its design');
  await shot(sm, 'mold-design-pending');
  // Production unreachable: the download says why beside the file, and an opened file says why on its page (not raw JSON).
  mock.state.down = true;
  await crmCard.getByRole('link', {name: 'تنزيل مسقط.dwg'}).click();
  const downloadFailure = fileRow(crmCard, 'مسقط.dwg').locator('[role="alert"]');
  await downloadFailure.waitFor();
  ok((await downloadFailure.innerText()).includes('تعذّر الوصول إلى تطبيق الإنتاج'), 'a failed download is said beside the file: ' + await downloadFailure.innerText());
  await shot(sm, 'mold-design-download-failed');
  const [failedView] = await Promise.all([sm.waitForEvent('popup'), manualCard.getByRole('link', {name: 'عرض تصميم من الإنتاج.pdf'}).click()]);
  await failedView.waitForLoadState();
  const failedText = await failedView.locator('body').innerText();
  ok(failedText.includes('تعذّر فتح الملف') && failedText.includes('تعذّر الوصول إلى تطبيق الإنتاج') && !failedText.includes('{"error"'), 'an opened file that failed reads in words: ' + failedText);
  await failedView.close();
  mock.state.down = false;
  const [download, fetched] = await Promise.all([sm.waitForEvent('download'), sm.waitForResponse(response => new URL(response.url()).pathname === '/api/mold-requests/design-file'), crmCard.getByRole('link', {name: 'تنزيل مسقط.dwg'}).click()]);
  const saved = fs.readFileSync(await download.path());
  check([download.suggestedFilename(), Buffer.compare(saved, drawingDwg), fetched.status(), new URL(fetched.url()).searchParams.has('order')], ['مسقط.dwg', 0, 200, true], 'downloaded through the CRM by order number, with its name');
  await downloadFailure.waitFor({state: 'detached'});
  // Approved just now: the card stays below with Withdraw, its files named without links (they open from the list only while the
  // request waits for the sales manager, so a link there would answer 404 «الطلب لم يعد بانتظار اعتمادك»).
  check(await manualCard.locator('.mold-design-actions a').count(), 2, 'waiting: Open and Download for its PDF');
  await manualCard.getByRole('button', {name: 'اعتماد', exact: true}).click();
  const approvedCard = sm.locator('.mold-pending[data-done]', {hasText: 'مصنع مسجّل في الإنتاج'});
  await approvedCard.waitFor();
  check([await approvedCard.locator('.mold-design-name').allInnerTexts(), await approvedCard.locator('a[href*="/api/mold-requests/design-file"]').count(), await approvedCard.locator('.mold-design-actions').count(), await approvedCard.locator('.mold-design-links-off').innerText()],
    [['تصميم من الإنتاج.pdf'], 0, 0, 'بعد اعتمادك لا تُفتح الملفات من هنا.'], 'just approved: the file named, no view or download link, and why');
  ok(await sm.locator('h3.mold-subtitle', {hasText: 'اعتمدتها الآن'}).count() === 1 && await approvedCard.getByRole('button', {name: 'سحب الاعتماد'}).count() === 1, 'under «اعتمدتها الآن», with Withdraw approval');
  // The CRM's request approved from the list too (MoldPendingList's note for a request of the CRM): named without links, and the way to
  // its files is the request itself, whose sheet opens them by the file's id.
  check(await crmCard.locator('.mold-design-actions a').count(), 6, 'waiting: Open and Download for each image, Download for each drawing');
  await crmCard.getByRole('button', {name: 'اعتماد', exact: true}).click();
  const approvedCrmCard = sm.locator('.mold-pending[data-done]', {hasText: 'مصنع east1'});
  await approvedCrmCard.waitFor();
  check([await approvedCrmCard.locator('.mold-design-name').count(), await approvedCrmCard.locator('a[href*="/api/mold-requests/design-file"]').count(), await approvedCrmCard.locator('.mold-design-actions').count(), await approvedCrmCard.locator('.mold-design-links-off').innerText()],
    [4, 0, 0, 'بعد اعتمادك لا تُفتح الملفات من هنا؛ افتح الطلب لعرضها.'], 'the CRM\'s request just approved: its four files named, no view or download link, and where they open');
  check([await sm.locator('.mold-pending[data-done]').count(), await sm.locator('.mold-pending:not([data-done])').count()], [2, 0], 'both under «اعتمدتها الآن», none left waiting');
  await shot(sm, 'mold-design-pending-approved');
  await approvedCrmCard.getByRole('button', {name: 'فتح الطلب'}).click();
  await sheet(sm).locator('.mold-design-file').nth(3).waitFor();
  const sheetLinks = await sheet(sm).locator('.mold-design a').evaluateAll(links => links.map(link => link.getAttribute('href')));
  ok(sheetLinks.length >= 6 && sheetLinks.every(href => href.startsWith('/api/mold-requests/design-file?id=')), 'the request\'s sheet opens them, by the file\'s id: ' + sheetLinks.join(' '));
  check(await sm.evaluate(href => fetch(href).then(response => response.status), sheetLinks[0]), 200, 'and the link answers once the request is approved');
  await sm.keyboard.press('Escape');
  await sheet(sm).waitFor({state: 'detached'});
  // The representative attaches another file: production undoes the approvals and the request waits for the sales manager again. The
  // next refresh takes it out of «اعتمدتها الآن» and back into the list, as production now holds it (the new file, links, Approve).
  const attachment = new FormData();
  attachment.set('requestId', crypto.randomUUID()); attachment.set('id', requestId); attachment.set('file', new Blob([pixel]), 'بعد الاعتماد.png');
  const encoded = new Response(attachment), repUpload = app.as(await app.login('rep'));
  const attached = await repUpload('/api/mold-requests/design-files', {method: 'POST', body: Buffer.from(await encoded.arrayBuffer()), headers: {'Content-Type': encoded.headers.get('content-type')}});
  check([attached.status, mock.row(requestId).approvals.sales, mock.row(requestId).waitingStep], [200, null, 'sales'], 'the file reached production, which undid the approval: the request waits for the sales manager again');
  await sm.locator('.mold-heading-tools button').first().click();
  const backCard = sm.locator('.mold-pending:not([data-done])', {hasText: 'مصنع east1'});
  await backCard.waitFor();
  await backCard.locator('.mold-design-file', {hasText: 'بعد الاعتماد.png'}).waitFor();
  check([await sm.locator('.mold-pending[data-done]', {hasText: 'مصنع east1'}).count(), await backCard.locator('.mold-design-links-off').count(), await backCard.getByRole('link', {name: 'عرض بعد الاعتماد.png'}).count(), await backCard.getByRole('button', {name: 'اعتماد', exact: true}).count()],
    [0, 0, 1, 1], 'back in the list: no longer under «اعتمدتها الآن», its new file with its links, and Approve');
  check(await sm.locator('.mold-pending[data-done]').allInnerTexts().then(texts => texts.map(text => text.includes('مصنع مسجّل في الإنتاج'))), [true], 'the request registered in production stays under «اعتمدتها الآن»');
  await shot(sm, 'mold-design-pending-back');
  await sm.context().close();

  // ---- 8. A request production never stored (refused at its door, 400) is still edited, and a file chosen in its edit form follows the
  //  edit: no warning (production holds nothing whose approvals it would undo); uploaded once the change is saved; held in the CRM while
  //  the request has not reached production (the edit's own send gets no answer); sent as soon as production holds the request.
  mock.answerNext('requests', 400, {error: {code: 'invalid_payload', message: 'Some fields are missing or invalid.', fields: ['specs.notes']}});
  const unsent = (await (await app.as(await app.login('rep'))('/api/mold-requests', {method: 'POST', body: {action: 'create', requestId: crypto.randomUUID(), customerId: 'east1', specs: {description: 'لم يصل للإنتاج بعد', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, quantity: 1}, payment: 'cash'}})).json()).request;
  check([unsent.sending.state, unsent.can.edit, mock.row(unsent.id)], ['rejected', true, undefined], 'refused before production stored it: still editable');
  const editor = await open('rep');
  await goMolds(editor);
  await editor.locator('.mold-card', {hasText: 'لم يصل للإنتاج بعد'}).click();
  await sheet(editor).getByRole('button', {name: 'تعديل الطلب'}).click();
  const edit = editor.locator('.mold-dialog');
  await edit.waitFor();
  await edit.locator('.mold-design-picker input[type=file]').setInputFiles({name: 'مقطع علوي.png', mimeType: 'image/png', buffer: pixel});
  await edit.locator('.mold-design-file[data-state="ready"]').waitFor();
  await edit.locator('label.mold-field', {hasText: 'الكمية'}).locator('input').fill('3');
  const filesSent = mock.state.calls.filter(call => call.route === 'design-files').length;
  mock.state.down = true;
  await edit.getByRole('button', {name: 'حفظ وإرسال التعديل'}).click();
  await edit.waitFor({state: 'detached'});
  check(await editor.locator('.mold-design-confirm').count(), 0, 'no warning: production holds nothing whose approvals a file would undo');
  const heldRow = fileRow(sheet(editor), 'مقطع علوي.png').and(editor.locator('[data-state="held"]'));
  await heldRow.waitFor();
  check([await heldRow.locator('.mold-design-state').innerText(), mock.row(unsent.id), mock.state.calls.filter(call => call.route === 'design-files').length - filesSent, (await app.db.prepare("SELECT COUNT(*) AS n FROM crm_mold_design_files WHERE request_id=? AND name='مقطع علوي.png'").bind(unsent.id).first()).n],
    ['يُرسل بعد وصول الطلب للإنتاج', undefined, 0, 1], 'the file followed the edit into the CRM and waits there for the request; nothing reached production');
  await shot(editor, 'mold-design-edit-held');
  mock.state.down = false;
  await sheet(editor).getByRole('button', {name: 'إعادة الإرسال'}).click();
  await sheet(editor).locator('.mold-sending').waitFor({state: 'detached'});
  // The resend sends the request, then its files whose turn has come, in the background.
  for (let n = 0; n < 100 && !mock.row(unsent.id)?.designFiles?.length; n++) await editor.waitForTimeout(100);
  check([mock.row(unsent.id)?.quantity, names(mock.row(unsent.id))], [3, ['مقطع علوي.png']], 'production holds the edited request, then its file');
  await editor.keyboard.press('Escape');
  await sheet(editor).waitFor({state: 'detached'});
  await editor.locator('.mold-heading-tools button').first().click();
  await editor.locator('.mold-card', {hasText: 'لم يصل للإنتاج بعد'}).click();
  await fileRow(sheet(editor), 'مقطع علوي.png').and(editor.locator('[data-state="sent"]')).waitFor();
  ok(true, 'the request\'s sheet says the file reached production');
  await editor.context().close();

  check(JSON.stringify(mock.state.calls).includes(mock.state.secret), false, 'the secret never travelled in a body');
  ok(!errors.length, 'no uncaught page errors: ' + errors.join(' | '));
  console.log(JSON.stringify({ok: true, checks, screenshots, realChromium: true, productionApplicationReal: false, productionDataUsed: false}));
} finally {
  await browser?.close(); await app.stop(); await mock.stop();
}
