// «استيراد من ERP» in a real Chromium against the BUILT release (run `pnpm build` first): the administrator opens Customers, the new
// button is there and «ربط عملاء ERP» is gone; a synthetic ERP customer export is chosen and previewed (counts, filters, before → after,
// the shared-number note); one ambiguous row gets its customer; «تحديث الأكواد» applies, the result lists the changes and the customers
// reload; the dialog fits a 360 px phone without horizontal scrolling, in Arabic and in English. The sales manager has the button; a
// representative has neither. Screenshots for the report. Synthetic fixtures only: temporary SQLite, never the owner's file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {zipSync, strToU8} from 'fflate';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require('playwright');
const members = [{id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager', region: 'central'}, {id: 'rep', role: 'rep', sup: 'sm', region: 'central', name: 'مندوب الوسطى'}];
const screenshots = process.env.YR_ERP_CUSTOMERS_SCREENSHOT_DIR ? path.resolve(process.env.YR_ERP_CUSTOMERS_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-erp-customers-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1280, height: 900};

const header = ['رقم العميل', 'رقم الهوية', 'الاسم بالعربي', 'الاسم بالانجليزي', 'رقم الجوال', 'رقم الهاتف', 'البريد الالكتروني', 'العنوان', 'التاريخ'];
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const cell = value => `<c t="inlineStr"><is><t>${escape(value)}</t></is></c>`;
const row = (code, name, mobile = '', phone = '') => [code, '1000000000', name, name, mobile, phone, '', 'A B C D 1 2 3 4', '2026/11/01'];
const workbook = rows => Buffer.from(zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
  'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="Customer" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
  'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${[['Customer'], header, ...rows].map((cells, index) => `<row r="${index + 1}">${cells.map(cell).join('')}</row>`).join('')}</sheetData></worksheet>`),
}));
const file = {name: 'Customer_synthetic.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: workbook([
  row('12', 'مصنع النور', '+966551234567'),        // 3: auto by phone and name; 12 is also held by «مصنع قديم» → mapping note
  row('44', 'شركة الفجر للبلوك', '', '0501234567'), // 4: auto by phone only
  row('55', 'مصنع التوأم الصناعي'),                  // 5: two customers with this name → choose
  row('77', 'مصنع غير موجود', '0599999999'),        // 6: not in the CRM
  row('33', 'مصنع البدر', '0561234567'),            // 7: same code already
])};

const app = await bootBuiltApp({members}, {tls: true});
try {
  const now = new Date().toISOString();
  const customer = (id, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')")
    .bind(id, JSON.stringify({branch: 'الرئيسي', assignedTo: 'rep', region: 'الوسطى', city: 'الرياض', address: 'حي الصناعية', phone: '', phone2: '', code: '', ...data}), now, now).run();
  await customer('nour', {name: 'مصنع النور', phone: '0551234567', code: 'OLD-1'});
  await customer('fajr', {name: 'مصنع الفجر', phone2: '0501234567'});
  await customer('holder', {name: 'مصنع قديم', code: '12'});
  await customer('twinA', {name: 'مصنع التوأم الصناعي', code: 'T-1'});
  await customer('twinB', {name: 'مصنع التوأم الصناعي', city: 'الخرج'});
  await customer('badr', {name: 'مصنع البدر', phone: '0561234567', code: '33'});
  const code = async id => JSON.parse((await app.db.prepare('SELECT data FROM crm_records WHERE id=?').bind(id).first()).data).code;
  const internal = async id => 'YR-C-' + String((await app.db.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').bind(id).first()).number).padStart(6, '0');
  const {scope} = await app.db.prepare('SELECT region_scope AS scope FROM crm_members WHERE id=?').bind('rep').first();
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  async function open(memberId, {viewport = DESKTOP} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block'});
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
  const shot = async (page, label) => { await page.waitForTimeout(250); await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const customers = async page => { await page.locator('button.nav-item', {hasText: 'العملاء'}).first().click(); await page.locator('.customer-expand').first().waitFor(); };
  const importButton = page => page.locator('.heading-actions button', {hasText: /^(استيراد من ERP|Import from ERP)$/});
  const oldButton = page => page.getByRole('button', {name: /ربط عملاء ERP|Link ERP customers/});
  const posted = (page, action) => page.waitForResponse(response => new URL(response.url()).pathname === '/api/erp-customers' && response.request().method() === 'POST' && JSON.parse(response.request().postData()).action === action);
  /** Nothing wider than the screen: neither the page nor the dialog scrolls sideways. */
  const fits = async (page, label) => check(await page.evaluate(() => { const dialog = document.querySelector('.erp-customers-dialog'), scroll = dialog?.querySelector('.erp-import-scroll'); return [document.documentElement.scrollWidth > innerWidth + 1, !!dialog && dialog.getBoundingClientRect().right > innerWidth + 1, !!scroll && scroll.scrollWidth > scroll.clientWidth + 1]; }), [false, false, false], label + ': no horizontal overflow');

  // ---- 1. The administrator: the new button on Customers, the old one gone
  const admin = await open('owner');
  await customers(admin);
  await importButton(admin).waitFor();
  check(await oldButton(admin).count(), 0, '«ربط عملاء ERP» is gone');
  check(await importButton(admin).count(), 1, '«استيراد من ERP» is on the customers page');
  await admin.locator('button.nav-item', {hasText: 'الزيارات'}).first().click();
  await admin.locator('.page-heading').waitFor();
  check(await importButton(admin).count(), 0, 'and on no other page');
  await customers(admin);

  // ---- 2. Choose the file: the server previews it, nothing written
  await importButton(admin).click();
  const dialog = admin.locator('.erp-customers-dialog');
  await dialog.waitFor();
  check((await dialog.locator('[data-slot=dialog-title]').innerText()).trim(), 'استيراد من ERP', 'the dialog title');
  check(await dialog.getAttribute('dir'), 'rtl', 'right to left in Arabic');
  let answer = posted(admin, 'preview');
  await dialog.locator('#erp-customers-file').setInputFiles(file);
  let preview = await (await answer).json();
  await dialog.locator('#erp-customers-preview-heading').waitFor();
  check(preview.rows.map(r => r.status), ['auto', 'auto', 'choose', 'missing', 'same'], 'the server matched every row');
  check((await app.db.prepare("SELECT count(*) AS n FROM crm_audit WHERE action LIKE 'erp-customer%'").first()).n, 0, 'the preview wrote nothing');
  const tiles = async () => dialog.locator('.erp-import-counts > div').evaluateAll(items => items.map(item => [item.querySelector('span').textContent, item.querySelector('strong').textContent]));
  check(await tiles(), [['هيتغير', '2'], ['يحتاج اختيار', '1'], ['من غير تغيير', '1'], ['مش في الـCRM', '1']], 'the counts');
  check((await dialog.locator('.erp-customers-filters button[aria-pressed=true]').textContent()).replace(/\s+/g, ' ').trim(), 'يحتاج اختيار 1', 'it opens on the rows that need a choice');
  const ambiguous = dialog.locator('.erp-customers-row').first();
  check(await ambiguous.locator('input[type=radio]').count(), 3, 'two candidates and «سيبه»');
  ok((await ambiguous.innerText()).includes(await internal('twinA')) && (await ambiguous.innerText()).includes(await internal('twinB')), 'each candidate with its Yourrest code');
  ok((await ambiguous.innerText()).includes('سيبه'), '«سيبه» leaves the row');
  await shot(admin, 'erp-customers-preview-desktop');

  // ---- 3. One ambiguous row gets its customer: previewed again with the choice
  answer = posted(admin, 'preview');
  await ambiguous.locator('label.erp-customers-candidate', {hasText: await internal('twinB')}).click();
  const rechecked = await answer;
  check(JSON.parse(rechecked.request().postData()).choices, [{row: 5, customerId: 'twinB'}], 'the choice goes with the preview');
  await admin.waitForFunction(() => [...document.querySelectorAll('.erp-import-counts strong')][0]?.textContent === '3');
  check(await tiles(), [['هيتغير', '3'], ['يحتاج اختيار', '0'], ['من غير تغيير', '1'], ['مش في الـCRM', '1']], 'the counts follow the choice');
  check(await ambiguous.locator('input[value=twinB]').isChecked(), true, 'the chosen customer stays selected');
  await dialog.locator('.erp-customers-filters button', {hasText: 'هيتغير'}).click();
  const changes = dialog.locator('.erp-customers-row');
  check(await changes.count(), 3, 'three rows will change');
  const nour = changes.filter({hasText: 'مصنع النور'});
  ok((await nour.locator('.erp-customers-change').innerText()).includes('OLD-1'), 'before → after: the old code');
  ok((await nour.locator('.erp-customers-change').innerText()).includes(await internal('nour')), 'with the customer\'s Yourrest code');
  check((await nour.locator('.erp-customers-shared').innerText()).trim(), 'الكود ده كمان عند 1 عميل تاني؛ الفواتير هتتحسب للعميل ده', 'the shared-number note');
  ok((await changes.filter({hasText: 'شركة الفجر'}).innerText()).includes('بالجوال'), 'matched by phone');
  ok(!(await dialog.innerText()).match(/551234567|501234567/), 'phones are shown as their last 4 digits only');
  await shot(admin, 'erp-customers-will-change-desktop');

  // ---- 4. The phone: the dialog fits 360 px
  await admin.setViewportSize(PHONE);
  await admin.waitForTimeout(300);
  await fits(admin, 'phone preview');
  await shot(admin, 'erp-customers-preview-phone');
  await dialog.locator('.erp-customers-filters button', {hasText: 'الكل'}).click();
  await fits(admin, 'phone, every row');

  // ---- 5. «تحديث الأكواد»: applied in one step, the result listed, the customers reloaded
  const applied = posted(admin, 'apply'), reloaded = admin.waitForResponse(response => new URL(response.url()).pathname === '/api/crm' && response.request().method() === 'GET');
  await dialog.getByRole('button', {name: 'تحديث الأكواد', exact: true}).click();
  const applyResponse = await applied;
  check(applyResponse.status(), 200, 'applied');
  const sent = JSON.parse(applyResponse.request().postData());
  check([sent.snapshot, sent.choices, /^[0-9a-f-]{36}$/.test(sent.requestId)], [preview.snapshot, [{row: 5, customerId: 'twinB'}], true], 'the apply carries the preview\'s snapshot, the choice and a request id');
  check((await reloaded).status(), 200, 'the customers are reloaded');
  await dialog.locator('.erp-import-success').waitFor();
  ok((await dialog.locator('.erp-import-success').innerText()).includes('تم تحديث الأكواد'), 'the result says so');
  check(await dialog.locator('.erp-customers-changes > li').count(), 3, 'three changes listed');
  ok((await dialog.locator('.erp-customers-changes').innerText()).includes(await internal('twinB')), 'by name and Yourrest code');
  check([await code('nour'), await code('fajr'), await code('twinB'), await code('twinA'), await code('holder'), await code('badr')], ['12', '44', '55', 'T-1', '12', '33'], 'the ERP codes in the database');
  check((await app.db.prepare('SELECT code_key,customer_id FROM crm_customer_code_mappings').all()).results.map(r => ({...r})), [{code_key: '12', customer_id: 'nour'}], 'the shared number is mapped');
  await fits(admin, 'phone result');
  await shot(admin, 'erp-customers-result-phone');
  await dialog.getByRole('button', {name: 'تم', exact: true}).click();
  await dialog.waitFor({state: 'detached'});

  // ---- 6. English, left to right
  await admin.setViewportSize(DESKTOP);
  await admin.locator('.topbar-tools .language-switch').click();
  await admin.waitForFunction(() => document.documentElement.lang === 'en');
  await importButton(admin).click();
  await dialog.waitFor();
  check([(await dialog.locator('[data-slot=dialog-title]').innerText()).trim(), await dialog.getAttribute('dir')], ['Import from ERP', 'ltr'], 'the English dialog, left to right');
  answer = posted(admin, 'preview');
  await dialog.locator('#erp-customers-file').setInputFiles(file);
  await answer;
  await dialog.locator('#erp-customers-preview-heading').waitFor();
  check((await tiles())[0], ['Will change', '0'], 'the same file again: nothing left to change');
  check(await dialog.getByRole('button', {name: 'Update codes', exact: true}).isDisabled(), true, 'so nothing to apply');
  await admin.setViewportSize(PHONE);
  await admin.waitForTimeout(300);
  await fits(admin, 'phone, English');
  await shot(admin, 'erp-customers-preview-phone-en');
  await dialog.getByRole('button', {name: 'Close', exact: true}).last().click();
  await dialog.waitFor({state: 'detached'});
  await admin.context().close();

  // ---- 7. The sales manager has the button; a representative has neither
  const manager = await open('sm');
  await customers(manager);
  await importButton(manager).waitFor();
  check(await oldButton(manager).count(), 0, 'the manager: no old button');
  await manager.context().close();
  const rep = await open('rep');
  await customers(rep);
  await rep.waitForTimeout(500);
  check([await importButton(rep).count(), await oldButton(rep).count()], [0, 0], 'a representative has no import button and no old one');
  await rep.context().close();

  ok(!errors.length, 'no uncaught page errors: ' + errors.join(' | '));
  console.log(JSON.stringify({ok: true, checks, screenshots, realChromium: true, syntheticWorkbook: true, ownerFileUsed: false}));
} finally {
  await browser?.close(); await app.stop();
}
