// Mold request design files (the contract's addition «ملفات التصميم», 2026-11-02) in a real Chromium against the BUILT release (run
// `pnpm build` first), sending to the stand-in production API (scripts/lib/products-mock.mjs): a representative chooses design files in
// the new-request form (a PDF that may go, and one the device refuses with its reason), saves, and sees the PDF sent once production holds
// the request; production attaches its own file, shown in the request as production's and opened through the CRM; a drawing attached
// from the request's sheet is confirmed first (the warning that it undoes the approvals), the server's «busy» answers with a retry hint
// and the retry sends it (nothing is uploaded before the confirmation); the representative deletes their PDF after confirming the same
// warning; an upload outlives the page (the representative moves to another page while it is on its way, comes back to it still uploading,
// and later to its failure with the reason and Retry, also said on the request's card); the request on a phone keeps every button within
// the screen, each at least 44 px (the refused files' dismiss button too); the sales manager sees each pending request's files (one
// registered in production too), is told why a download or an opened file failed while production is unreachable, downloads one
// through the CRM, and, having approved a request, sees its card under «اعتمدتها الآن» with the files named but no links. Screenshots
// for the report. Synthetic fixtures only: temporary SQLite, no production data, no real production app.
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
  const picker = dialog.locator('.mold-design-picker');
  check((await picker.locator('input[type=file]').getAttribute('accept')).split(',').slice(0, 3), ['.pdf', '.png', '.jpg'], 'the picker offers the contract\'s extensions');
  await picker.locator('input[type=file]').setInputFiles([{name: 'رسم القالب.pdf', mimeType: 'application/pdf', buffer: drawingPdf}, {name: 'ليس-pdf.pdf', mimeType: 'application/pdf', buffer: Buffer.from('this is not a pdf')}]);
  await picker.locator('.mold-design-file[data-state="refused"]').waitFor();
  check([await picker.locator('.mold-design-file[data-state="ready"]').count(), await fileRow(picker, 'رسم القالب.pdf').locator('.mold-design-state').innerText()], [1, 'يُرفع بعد حفظ الطلب'], 'the PDF waits for the request to be saved');
  check(await fileRow(picker, 'ليس-pdf.pdf').locator('.mold-design-reason').innerText(), 'الملف ليس PDF فعلًا', 'the device refuses a false PDF and says why, before anything is sent');
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

  // ---- 5b. A file chosen while editing the request: the save asks for the same confirmation first, then the file follows the edit
  await sheet(rep).getByRole('button', {name: 'تعديل الطلب'}).click();
  const edit = rep.locator('.mold-dialog');
  await edit.locator('.mold-design-picker input[type=file]').setInputFiles({name: 'مقطع جانبي.png', mimeType: 'image/png', buffer: pixel});
  await edit.locator('.mold-design-file[data-state="ready"]').waitFor();
  await edit.getByRole('button', {name: 'حفظ وإرسال التعديل'}).click();
  const editWarning = edit.locator('.mold-design-confirm');
  await editWarning.waitFor();
  ok((await editWarning.innerText()).includes(WARNING), 'the edit form warns before attaching too');
  check(mock.row(requestId).designFiles.length, 2, 'nothing sent before the confirmation');
  await shot(rep, 'mold-design-edit-warning');
  await edit.getByRole('button', {name: 'تأكيد: حفظ وإرفاق الملفات'}).click();
  await edit.waitFor({state: 'detached'});
  await fileRow(sheet(rep), 'مقطع جانبي.png').and(rep.locator('[data-state="sent"]')).waitFor();
  check(names(mock.row(requestId)), ['صورة من الإنتاج.png', 'مسقط.dwg', 'مقطع جانبي.png'], 'the file chosen in the edit form reached production');

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
  await phone.locator('button.mobile-profile-trigger').click();
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
  await shot(sm, 'mold-design-pending-approved');
  await sm.context().close();

  check(JSON.stringify(mock.state.calls).includes(mock.state.secret), false, 'the secret never travelled in a body');
  ok(!errors.length, 'no uncaught page errors: ' + errors.join(' | '));
  console.log(JSON.stringify({ok: true, checks, screenshots, realChromium: true, productionApplicationReal: false, productionDataUsed: false}));
} finally {
  await browser?.close(); await app.stop(); await mock.stop();
}
