// «استيراد عروض الأسعار من ERP» in a real Chromium against the BUILT release (run `npm run build` first), with a synthetic report written
// as the ERP writes it (scripts/lib/erp-quotes-fixture.mjs): the button sits on the targets page beside the ERP sales import (none on
// «عروض الأسعار», none for a representative); the administrator chooses the «.xls», previews it (five counts, a refused quotation with its
// reason, the customer the CRM does not have, an employee matched by name and one chosen), refreshes the preview, imports (the result),
// then opens «عروض الأسعار»: the imported quotes are listed, one opens with its ERP source, item codes and units, the customer's sheet lists
// it, and it prints (code and unit columns, the ERP's totals, no machine line). On a 360 px phone the supervisor previews the same file
// again (everything unchanged, nothing to import) with no sideways scrolling; in English on a computer and a phone the dialog is left to
// right with no Arabic left in its own words (the data, in <bdi>, and the select's names aside). Screenshots for the report
// (YR_ERP_QUOTES_SCREENSHOT_DIR). Synthetic fixtures only: temporary SQLite, never the owner's file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';
import {quotation, erpQuotesXls} from '../scripts/lib/erp-quotes-fixture.mjs';

const require = createRequire(import.meta.url), {chromium} = require('playwright');
const members = [{id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sup', role: 'supervisor', name: 'مشرف الوسطى'}, {id: 'rep', role: 'rep', sup: 'sup', name: 'أحمد المندوب'}, {id: 'rep2', role: 'rep', sup: 'sup', name: 'سالم المندوب'}];
const screenshots = process.env.YR_ERP_QUOTES_SCREENSHOT_DIR ? path.resolve(process.env.YR_ERP_QUOTES_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-erp-quotes-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const PHONE = {width: 360, height: 780}, DESKTOP = {width: 1280, height: 900};
const rows = [
  ...quotation({code: 'Qut-2001', customerCode: '101', empCode: '7001', empName: 'أحمد المندوب', lines: [{name: 'قالب بلوك 20 سم', qty: 1, price: 18500, code: '10010001'}]}),
  ...quotation({code: 'Qut-2002', customerCode: '102', empCode: '7002', empName: 'موظف ERP آخر', documentDiscount: 100, note: 'يشمل التركيب', lines: [{name: 'قالب انترلوك', qty: 2, price: 9000, discount: 500, code: '10020001', description: 'مع جلبة'}, {name: 'جلبة إضافية', qty: 4, price: 250.5, code: '10030002-1', unit: 'قطعة / PC'}]}),
  ...quotation({code: 'Qut-2003', customerCode: '999', customerName: 'عميل ليس في النظام', empCode: '7001', empName: 'أحمد المندوب', lines: [{name: 'قالب', qty: 1, price: 1000}]}),
];
const file = {name: 'Reports_Invoices_synthetic.xls', mimeType: 'application/vnd.ms-excel', buffer: erpQuotesXls(rows)};

const app = await bootBuiltApp({members}, {tls: true});
try {
  const now = new Date().toISOString();
  const customer = (id, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')")
    .bind(id, JSON.stringify({branch: 'الرئيسي', assignedTo: 'rep', region: 'الوسطى', city: 'الرياض', address: 'حي الصناعية', contact: 'م. خالد', ...data}), now, now).run();
  await customer('c101', {name: 'مصنع الاختبار الأول', code: '101'});
  await customer('c102', {name: 'مصنع الاختبار الثاني', code: '102'});
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});
  async function open(who, {viewport = DESKTOP, english = false, hash = 'targets'} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block'});
    const [name, ...value] = (await app.login(who)).split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    await context.addInitScript(english => { try { localStorage.setItem('yr-language', english ? 'en' : 'ar'); } catch { /* storage unavailable */ } window.__printed = 0; window.print = () => { window.__printed++; }; }, english);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(who + ': ' + error.message));
    if (members.find(m => m.id === who).role === 'rep') await installNativeBridge(page, {memberId: who, regionScope: 'all'});
    await page.goto(app.origin + '/#' + hash);
    await page.locator('.workspace').waitFor();
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    return page;
  }
  const shot = async (page, label) => { await page.waitForTimeout(250); await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const button = (page, english = false) => page.getByRole('button', {name: english ? 'Import quotations from ERP' : 'استيراد عروض الأسعار من ERP', exact: true});
  // The import sits in the targets hub's «عروض الأسعار» tab (2026-11-11).
  const toQuotesTab = async (page, english = false) => { await page.getByRole('tab', {name: english ? 'Quotations' : 'عروض الأسعار'}).click(); };
  const dialogOf = page => page.locator('.erp-quotes-import');
  const posted = page => page.waitForResponse(response => response.url().endsWith('/api/erp-quotes') && response.request().method() === 'POST');
  const tiles = dialog => dialog.locator('.erp-quotes-counts>div').evaluateAll(nodes => nodes.map(node => [node.querySelector('span').textContent.trim(), node.querySelector('strong').textContent.trim()]));
  const noSideways = page => page.evaluate(() => { const dialog = document.querySelector('.erp-quotes-import'), scroll = dialog?.querySelector('.erp-import-scroll'); return document.documentElement.scrollWidth <= innerWidth + 1 && (!dialog || dialog.scrollWidth <= dialog.clientWidth + 1) && (!scroll || scroll.scrollWidth <= scroll.clientWidth + 1); });
  /** The dialog's own words: its text without the data shown in <bdi> (names, codes, file name) and without the select's names. */
  const ownWords = dialog => dialog.evaluate(node => { const copy = node.cloneNode(true); copy.querySelectorAll('bdi,select').forEach(item => item.remove()); return copy.textContent; });

  // ---- 1. The administrator on the targets page, Arabic, computer.
  const admin = await open('owner');
  await toQuotesTab(admin);
  await button(admin).waitFor();
  await shot(admin, '01-targets-page-button-desktop-ar');
  await button(admin).click();
  const dialog = dialogOf(admin);
  await dialog.waitFor();
  check([(await dialog.locator('[data-slot=dialog-title]').innerText()).trim(), await dialog.getAttribute('dir')], ['استيراد عروض الأسعار من ERP', 'rtl'], 'the dialog, right to left');
  await dialog.locator('#erp-quotes-report').setInputFiles(file);
  let answer = posted(admin);
  await dialog.getByRole('button', {name: 'قراءة الملف ومعاينته', exact: true}).click();
  check((await answer).status(), 200, 'preview');
  await dialog.locator('#erp-quotes-preview-heading').waitFor();
  check(await tiles(dialog), [['ستُضاف', '1'], ['ستُحدَّث', '0'], ['بلا تغيير', '0'], ['عُدِّلت في الـCRM', '0'], ['مرفوضة', '2']], 'the five counts');
  ok((await dialog.locator('.erp-quotes-missing').innerText()).includes('عميل ليس في النظام'), 'the customer the CRM does not have');
  ok((await dialog.locator('.erp-import-map-row').first().innerText()).includes('مطابقة تلقائية للاسم'), 'an employee matched by name');
  const refusedRow = dialog.locator('.erp-import-table tbody tr', {hasText: 'Qut-2002'});
  ok((await refusedRow.innerText()).includes('اربط موظف ERP بمندوب'), 'an unmapped employee\'s quotation is refused with its reason');
  await shot(admin, '02-preview-desktop-ar');
  await dialog.getByRole('combobox', {name: 'مندوب الموظف موظف ERP آخر'}).selectOption('rep2');
  await dialog.locator('.erp-import-footer').getByRole('button', {name: 'تحديث المعاينة', exact: true}).click();
  await admin.waitForFunction(() => document.querySelector('.erp-quotes-counts>div:first-child strong')?.textContent.trim() === '2');
  check((await tiles(dialog)).map(t => t[1]), ['2', '0', '0', '0', '1'], 'with the employee chosen, two to add');
  answer = posted(admin);
  await dialog.getByRole('button', {name: 'تأكيد الاستيراد (2)', exact: true}).click();
  check((await answer).status(), 200, 'import');
  await dialog.locator('.erp-import-success').waitFor();
  ok((await dialog.locator('.erp-import-success').innerText()).includes('أُضيفت: 2'), 'the result');
  await shot(admin, '03-result-desktop-ar');
  await dialog.getByRole('button', {name: 'تم', exact: true}).click();
  await dialog.waitFor({state: 'detached'});

  // ---- 2. «عروض الأسعار»: listed, opened, on the customer's sheet, printed; no import button there.
  await admin.goto(app.origin + '/#quote'); await admin.reload();
  await admin.locator('.workspace').waitFor();
  const quoteRow = admin.locator('tr', {hasText: 'Qut-2002'});
  await quoteRow.waitFor();
  check(await button(admin).count(), 0, 'no import button on «عروض الأسعار»');
  ok((await quoteRow.innerText()).includes('مصنع الاختبار الثاني'), 'listed with its customer');
  await shot(admin, '04-quotes-list-desktop-ar');
  await quoteRow.locator('.name-cell').click();
  const sheet = admin.locator('.crm-sheet');
  await sheet.waitFor();
  const sheetText = await sheet.innerText();
  ok(['Qut-2002', 'مستورد من ERP', 'كود العميل في ERP', '102', '10030002-1 · قطعة / PC', 'شروط الدفع'].every(text => sheetText.includes(text)), 'the quote\'s ERP source, item code and unit');
  await shot(admin, '05-imported-quote-desktop-ar');
  await sheet.getByRole('button', {name: 'طباعة', exact: true}).click();
  const printed = admin.locator('article.print-document');
  await printed.waitFor({state: 'attached'});
  const printText = await printed.innerText();
  ok(['Qut-2002', 'كود الصنف', 'الوحدة', '10020001', '21,162.3'].every(text => printText.includes(text)) && !printText.includes('الماكينة / خط الإنتاج'), 'printed with code and unit, the ERP\'s total, no machine line');
  await admin.waitForFunction(() => window.__printed > 0);
  check(await admin.evaluate(() => window.__printed), 1, 'the print dialog asked once');
  await admin.emulateMedia({media: 'print'});
  await shot(admin, '06-printed-quote-ar');
  await admin.emulateMedia({media: 'screen'});
  await admin.evaluate(() => window.dispatchEvent(new Event('afterprint')));

  // ---- 3. The supervisor on a 360 px phone: the same file again, nothing to import, nothing scrolls sideways.
  const phone = await open('sup', {viewport: PHONE});
  await toQuotesTab(phone);
  await button(phone).waitFor();
  ok(await noSideways(phone), 'the targets page fits a 360 px phone');
  await shot(phone, '08-targets-page-button-phone-ar');
  await button(phone).click();
  const phoneDialog = dialogOf(phone);
  await phoneDialog.waitFor();
  await phoneDialog.locator('#erp-quotes-report').setInputFiles(file);
  answer = posted(phone);
  await phoneDialog.getByRole('button', {name: 'قراءة الملف ومعاينته', exact: true}).click();
  await answer;
  await phoneDialog.locator('#erp-quotes-preview-heading').waitFor();
  check((await tiles(phoneDialog)).map(t => t[1]), ['0', '0', '2', '0', '1'], 'the same file again: everything unchanged');
  ok(await phoneDialog.getByRole('button', {name: 'تأكيد الاستيراد (0)', exact: true}).isDisabled(), 'nothing to import');
  ok(await phoneDialog.locator('.erp-import-cards').isVisible() && !(await phoneDialog.locator('.erp-import-table-wrap').isVisible()), 'cards in place of the table');
  ok(await noSideways(phone), 'the dialog fits a 360 px phone');
  await shot(phone, '09-preview-again-phone-ar');
  await phoneDialog.locator('.erp-import-documents').scrollIntoViewIfNeeded();
  await shot(phone, '10-preview-cards-phone-ar');
  await phoneDialog.getByRole('button', {name: 'إغلاق', exact: true}).first().click();
  await phoneDialog.waitFor({state: 'detached'});
  await phone.goto(app.origin + '/#customer'); await phone.reload();
  await phone.locator('.customer-mobile-card').filter({has: phone.locator('h3', {hasText: 'مصنع الاختبار الثاني'})}).locator('.customer-mobile-name').click();
  const customerQuotes = phone.locator('.crm-sheet .customer-quotes');
  await customerQuotes.waitFor();
  ok((await customerQuotes.innerText()).includes('Qut-2002'), 'the customer\'s sheet lists its quotation');
  ok(await noSideways(phone), 'the customer\'s sheet fits a 360 px phone');
  await customerQuotes.scrollIntoViewIfNeeded();
  await shot(phone, '07-customer-quotes-phone-ar');

  // ---- 4. English: computer and phone.
  for (const [viewport, label] of [[DESKTOP, 'desktop'], [PHONE, 'phone']]) {
    const page = await open('owner', {viewport, english: true});
    await toQuotesTab(page, true);
    await button(page, true).waitFor();
    await button(page, true).click();
    const d = dialogOf(page);
    await d.waitFor();
    check([(await d.locator('[data-slot=dialog-title]').innerText()).trim(), await d.getAttribute('dir')], ['Import quotations from ERP', 'ltr'], 'English, left to right (' + label + ')');
    await d.locator('#erp-quotes-report').setInputFiles(file);
    answer = posted(page);
    await d.getByRole('button', {name: 'Read and preview file', exact: true}).click();
    await answer;
    await d.locator('#erp-quotes-preview-heading').waitFor();
    check(await tiles(d), [['To add', '0'], ['To update', '0'], ['Unchanged', '2'], ['Edited in the CRM', '0'], ['Refused', '1']], 'English counts (' + label + ')');
    ok(!/[؀-ۿ]/.test(await ownWords(d)), 'English: no Arabic left in the dialog\'s own words (' + label + ')');
    ok(await noSideways(page), 'English dialog fits (' + label + ')');
    await shot(page, '11-preview-' + label + '-en');
    await page.context().close();
  }

  // ---- 5. A representative has no such button.
  const rep = await open('rep', {viewport: PHONE});
  await rep.waitForTimeout(800);
  check(await button(rep).count(), 0, 'a representative has no import');
  check(errors, [], 'no page errors');
  console.log(`erp-quotes-browser: ${checks} checks passed; screenshots in ${screenshots}`);
} catch (error) {
  console.error(app.log().slice(-3000));
  throw error;
} finally {
  await browser?.close();
  await app.stop();
}
