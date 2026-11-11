// «استيراد من ERP» in a real Chromium against the BUILT release (run `pnpm build` first): the administrator opens Customers, the new
// button is there and «ربط عملاء ERP» is gone; a synthetic ERP customer export is chosen and previewed (the summary line and counts,
// the «محتاج تختار» and «عملاء جدد سيُضافون» sections, filters, before → after, the shared-number note); one ambiguous row gets its
// customer with «هو نفسه», a similar name gets «عميل جديد» (nothing pressed before), the new customers' region is chosen; «حدّث X كود
// وضيف Y عميل» applies, the result lists what changed and what was added and the customers reload; the dialog fits a 360 px phone
// without horizontal scrolling, in Arabic and in English (no Arabic left in the screen's own words); each «هو نفسه» is named with its
// candidate; the phone's region selects are 16 px and 46 px tall; a file whose only unmatched row is a similar name marked «عميل جديد» shows
// the region select and applies the region chosen. The sales manager has the button;
// a representative has neither. Since 2026-11-09: the same file again after the apply names no longer the customer its similar row
// pointed to, so «عملاء غير موجودين في الشيت: سيُمسح كود ERP الخاص بهم (1)» lists it with the box checked; unchecked there is nothing to apply;
// the apply clears its code (kept as an alias) and the result says so; the English section and box; a later apply with the box unchecked
// clears nothing. Screenshots for the report. Synthetic fixtures only: temporary SQLite, never the owner's file.
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
  row('77', 'مصنع غير موجود', '0599999999'),        // 6: not in the CRM → new, added
  row('33', 'مصنع البدر', '0561234567'),            // 7: same code already
  row('9001', 'مصنع الصفا للبلوك الحديث'),          // 8: one word different from «مصنع الصفا للبلوك الاسمنتي» → similar
])};
const english = {name: 'Customer_english.xlsx', mimeType: file.mimeType, buffer: workbook([row('9101', 'مصنع الصفا للبلوك القديم'), row('9102', 'مصنع السلام')])};

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
  await customer('safa', {name: 'مصنع الصفا للبلوك الاسمنتي', code: '345'});
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
  check(preview.rows.map(r => r.status), ['auto', 'auto', 'choose', 'new', 'same', 'similar'], 'the server matched every row');
  check((await app.db.prepare("SELECT count(*) AS n FROM crm_audit WHERE action LIKE 'erp-customer%'").first()).n, 0, 'the preview wrote nothing');
  const tiles = async () => dialog.locator('.erp-import-counts > div').evaluateAll(items => items.map(item => [item.querySelector('span').textContent, item.querySelector('strong').textContent]));
  check(await tiles(), [['سيتغيّر', '2'], ['يحتاج إلى اختيارك', '2'], ['عملاء جدد', '1'], ['بلا تغيير', '1']], 'the counts');
  check((await dialog.locator('.erp-customers-summary').innerText()).trim(), '2 كود سيتغيّر، 2 عميل يحتاج إلى اختيارك، 1 عميل جديد سيُضاف.', 'the summary line');
  check([preview.clears, await dialog.locator('[data-section=clear]').count()], [[], 0], 'every customer with a code is in the file: no «عملاء غير موجودين في الشيت»');
  const choose = dialog.locator('[data-section=choose]'), fresh = dialog.locator('[data-section=new]');
  check(await choose.locator('.erp-customers-row').evaluateAll(items => items.map(item => Number(item.dataset.row))), [5, 8], '«محتاج تختار»: the ambiguous row and the similar name');
  check(await fresh.locator('.erp-customers-row').evaluateAll(items => items.map(item => Number(item.dataset.row))), [6], '«عملاء جدد سيُضافون»: the row the CRM does not have');
  const ambiguous = choose.locator('.erp-customers-row[data-row="5"]'), similar = choose.locator('.erp-customers-row[data-row="8"]');
  check(await ambiguous.locator('button.erp-customers-pick').allInnerTexts(), ['هو نفسه', 'هو نفسه', 'اتركه'], 'two candidates with «هو نفسه», and «اتركه»');
  check([await ambiguous.getByRole('button', {name: 'هو نفسه: مصنع التوأم الصناعي · ' + await internal('twinA'), exact: true}).count(), await ambiguous.getByRole('button', {name: 'هو نفسه: مصنع التوأم الصناعي · ' + await internal('twinB'), exact: true}).count()], [1, 1], 'each «هو نفسه» is named with its candidate\'s name and Yourrest code (two candidates never read the same)');
  ok((await ambiguous.innerText()).includes(await internal('twinA')) && (await ambiguous.innerText()).includes(await internal('twinB')), 'each candidate with its Yourrest code');
  check(await similar.locator('button.erp-customers-pick').allInnerTexts(), ['هو نفسه', 'عميل جديد', 'اتركه'], 'a similar name: «هو نفسه», «عميل جديد», «اتركه»');
  check(await similar.locator('button.erp-customers-pick[aria-pressed=true]').count(), 0, 'nothing pressed on the similar row');
  ok((await similar.innerText()).includes(await internal('safa')) && (await similar.innerText()).includes('اسم قريب') && (await similar.innerText()).includes('345'), 'the similar customer: Yourrest code, current ERP code, why');
  ok((await fresh.innerText()).includes('سيُضافون باسمك') && (await fresh.innerText()).includes('«تعديل»'), 'new customers: under the uploader\'s name, movable later from «تعديل»');
  check(await dialog.locator('#erp-customers-region').inputValue(), '', 'the region of the new customers: «المنطقة غير محددة» by default');
  check((await dialog.locator('.erp-customers-apply').innerText()).trim(), 'حدّث 2 كود وأضف 1 عميل', 'the apply button says what it will do');
  await shot(admin, 'erp-customers-preview-desktop');

  // ---- 3. One ambiguous row gets its customer: previewed again with the choice
  answer = posted(admin, 'preview');
  await ambiguous.locator('.erp-customers-candidate', {hasText: await internal('twinB')}).getByRole('button', {name: 'هو نفسه'}).click();
  const rechecked = await answer;
  check(JSON.parse(rechecked.request().postData()).choices, [{row: 5, customerId: 'twinB'}], 'the choice goes with the preview');
  await admin.waitForFunction(() => [...document.querySelectorAll('.erp-import-counts strong')][0]?.textContent === '3');
  check(await tiles(), [['سيتغيّر', '3'], ['يحتاج إلى اختيارك', '1'], ['عملاء جدد', '1'], ['بلا تغيير', '1']], 'the counts follow the choice');
  check(await ambiguous.locator('button[data-choice=twinB]').getAttribute('aria-pressed'), 'true', 'the chosen customer stays selected');
  answer = posted(admin, 'preview');
  await similar.getByRole('button', {name: 'عميل جديد'}).click();
  check(JSON.parse((await answer).request().postData()).choices, [{row: 5, customerId: 'twinB'}, {row: 8, customerId: '+new'}], '«عميل جديد» goes with the preview');
  await admin.waitForFunction(() => [...document.querySelectorAll('.erp-import-counts strong')][2]?.textContent === '2');
  check(await tiles(), [['سيتغيّر', '3'], ['يحتاج إلى اختيارك', '0'], ['عملاء جدد', '2'], ['بلا تغيير', '1']], 'one more customer to add, nothing left to choose');
  check([await similar.locator('button[data-choice="+new"]').getAttribute('aria-pressed'), (await dialog.locator('.erp-customers-apply').innerText()).trim()], ['true', 'حدّث 3 كود وأضف 2 عميل'], '«عميل جديد» pressed; the apply button follows');
  await dialog.locator('#erp-customers-region').selectOption('الوسطى');
  await dialog.locator('.erp-customers-filters button', {hasText: 'سيتغيّر'}).click();
  const changes = dialog.locator('[data-section=rest] .erp-customers-row');
  check(await changes.count(), 2, 'the other rows that will change');
  const nour = changes.filter({hasText: 'مصنع النور'});
  ok((await nour.locator('.erp-customers-change').innerText()).includes('OLD-1'), 'before → after: the old code');
  ok((await nour.locator('.erp-customers-change').innerText()).includes(await internal('nour')), 'with the customer\'s Yourrest code');
  check((await nour.locator('.erp-customers-shared').innerText()).trim(), 'هذا الكود لدى 1 عميل آخر أيضًا؛ ستُحتسب الفواتير لهذا العميل', 'the shared-number note');
  ok((await changes.filter({hasText: 'شركة الفجر'}).innerText()).includes('بالجوال'), 'matched by phone');
  ok(!(await dialog.innerText()).match(/551234567|501234567/), 'phones are shown as their last 4 digits only');
  await shot(admin, 'erp-customers-will-change-desktop');

  // ---- 4. The phone: the dialog fits 360 px
  await admin.setViewportSize(PHONE);
  await admin.waitForTimeout(300);
  await fits(admin, 'phone preview');
  await shot(admin, 'erp-customers-preview-phone');
  await choose.scrollIntoViewIfNeeded();
  await fits(admin, 'phone, «محتاج تختار»');
  await shot(admin, 'erp-customers-choose-phone');
  await fresh.scrollIntoViewIfNeeded();
  await fits(admin, 'phone, new customers');
  check(await dialog.locator('#erp-customers-region, .erp-customers-row-region select').evaluateAll(items => items.map(item => [getComputedStyle(item).fontSize, item.getBoundingClientRect().height >= 46])), [['16px', true], ['16px', true]], 'phone: the region selects are 16 px and at least 46 px tall, like the dialog\'s other selects (no zoom on focus)');
  await shot(admin, 'erp-customers-new-phone');
  await dialog.locator('.erp-customers-filters button', {hasText: 'الكل'}).click();
  await fits(admin, 'phone, every row');

  // ---- 5. «حدّث 3 كود وأضف 2 عميل»: applied in one step, the result listed, the customers reloaded
  const applied = posted(admin, 'apply'), reloaded = admin.waitForResponse(response => new URL(response.url()).pathname === '/api/crm' && response.request().method() === 'GET');
  await dialog.getByRole('button', {name: 'حدّث 3 كود وأضف 2 عميل', exact: true}).click();
  const applyResponse = await applied;
  check(applyResponse.status(), 200, 'applied');
  const sent = JSON.parse(applyResponse.request().postData());
  check([sent.snapshot, sent.choices, /^[0-9a-f-]{36}$/.test(sent.requestId), sent.region, sent.regions, sent.adds], [preview.snapshot, [{row: 5, customerId: 'twinB'}, {row: 8, customerId: '+new'}], true, 'الوسطى', [], 2], 'the apply carries the preview\'s snapshot, the choices, the region, the two new customers it showed and a request id');
  check((await reloaded).status(), 200, 'the customers are reloaded');
  await dialog.locator('.erp-import-success').waitFor();
  ok((await dialog.locator('.erp-import-success').innerText()).includes('تم تحديث الأكواد وإضافة العملاء'), 'the result says so');
  check(await dialog.locator('.erp-customers-changes:not(.erp-customers-added):not(.erp-customers-left) > li').count(), 3, 'three changes listed');
  ok((await dialog.locator('.erp-customers-changes:not(.erp-customers-added):not(.erp-customers-left)').innerText()).includes(await internal('twinB')), 'by name and Yourrest code');
  check([await dialog.locator('.erp-customers-left > li').count(), (await dialog.locator('#erp-customers-left-heading').innerText()).trim()], [0, 'ما تُرك'], 'and what was left: nothing this time');
  const addedIds = (await app.db.prepare("SELECT id FROM crm_records WHERE id LIKE 'crm-owner-erp-%' ORDER BY id").all()).results.map(r => r.id);
  check(addedIds.length, 2, 'two customers added');
  check(await dialog.locator('.erp-customers-added > li').count(), 2, 'and listed as added');
  for (const id of addedIds) ok((await dialog.locator('.erp-customers-added').innerText()).includes(await internal(id)), 'with the Yourrest number of ' + id.slice(-1));
  check((await app.db.prepare("SELECT json_extract(data,'$.code') AS code,json_extract(data,'$.region') AS region,assigned_to AS owner FROM crm_records WHERE id LIKE 'crm-owner-erp-%' ORDER BY json_extract(data,'$.code')").all()).results.map(r => ({...r})), [{code: '77', region: 'الوسطى', owner: 'owner'}, {code: '9001', region: 'الوسطى', owner: 'owner'}], 'the new customers: their ERP codes, the chosen region, the uploader responsible');
  check([await code('nour'), await code('fajr'), await code('twinB'), await code('twinA'), await code('holder'), await code('badr'), await code('safa')], ['12', '44', '55', 'T-1', '12', '33', '345'], 'the ERP codes in the database (the similar customer untouched)');
  check((await app.db.prepare('SELECT code_key,customer_id FROM crm_customer_code_mappings').all()).results.map(r => ({...r})), [{code_key: '12', customer_id: 'nour'}], 'the shared number is mapped');
  await fits(admin, 'phone result');
  await shot(admin, 'erp-customers-result-phone');
  await dialog.getByRole('button', {name: 'تم', exact: true}).click();
  await dialog.waitFor({state: 'detached'});

  // ---- 5b. 2026-11-09: the same file again. Its row 8 is now the added customer, so «مصنع الصفا للبلوك الاسمنتي» (345) is named by no row:
  //  «عملاء غير موجودين في الشيت: سيُمسح كود ERP الخاص بهم (1)», the box checked by default; the apply clears its code and says so
  await admin.setViewportSize(DESKTOP);
  await importButton(admin).click();
  await dialog.waitFor();
  answer = posted(admin, 'preview');
  await dialog.locator('#erp-customers-file').setInputFiles(file);
  preview = await (await answer).json();
  const clearSection = dialog.locator('[data-section=clear]');
  await clearSection.waitFor();
  check(preview.clears.map(c => [c.customerId, c.code]), [['safa', '345']], 'the server lists the customer the file no longer names');
  check((await clearSection.locator('h3').innerText()).trim(), 'عملاء غير موجودين في الشيت: سيُمسح كود ERP الخاص بهم (1)', 'the section heading with the count');
  const clearBox = clearSection.getByRole('checkbox', {name: 'امسح كود ERP للعملاء غير الموجودين في الشيت'});
  check(await clearBox.isChecked(), true, 'the box, checked by default');
  const clearText = await clearSection.locator('.erp-customers-clears').innerText();
  ok(clearText.includes('مصنع الصفا للبلوك الاسمنتي') && clearText.includes(await internal('safa')) && clearText.includes('345'), 'each customer: name, Yourrest code, current ERP code');
  check([(await dialog.locator('.erp-customers-summary').innerText()).trim(), (await dialog.locator('.erp-customers-apply').innerText()).trim()], ['0 كود سيتغيّر، 0 عميل يحتاج إلى اختيارك، 0 عميل جديد سيُضاف، 1 كود ERP سيُمسح.', 'حدّث 0 كود وأضف 0 عميل وامسح 1 كود'], 'the summary line and the button count the code cleared');
  await clearSection.scrollIntoViewIfNeeded();
  await shot(admin, 'erp-customers-clear-desktop');
  await clearBox.uncheck();
  check([(await dialog.locator('.erp-customers-apply').innerText()).trim(), await dialog.locator('.erp-customers-apply').isDisabled()], ['حدّث 0 كود وأضف 0 عميل', true], 'unchecked: nothing to apply');
  await clearBox.check();
  await admin.setViewportSize(PHONE);
  await admin.waitForTimeout(300);
  await clearSection.scrollIntoViewIfNeeded();
  await fits(admin, 'phone, the customers not in the sheet');
  check(await clearBox.evaluate(item => item.closest('label').getBoundingClientRect().height >= 44), true, 'phone: the box and its label are a 44 px target');
  await shot(admin, 'erp-customers-clear-phone');
  const clearApplied = posted(admin, 'apply');
  await dialog.getByRole('button', {name: 'حدّث 0 كود وأضف 0 عميل وامسح 1 كود', exact: true}).click();
  const clearResponse = await clearApplied, clearSent = JSON.parse(clearResponse.request().postData());
  check([clearResponse.status(), clearSent.clearCodes, clearSent.clearSnapshot, (await clearResponse.json()).cleared], [200, true, preview.clearSnapshot, 1], 'the apply carries the box and the preview\'s list; one code cleared');
  await dialog.locator('.erp-import-success').waitFor();
  ok((await dialog.locator('.erp-import-success').innerText()).includes('مُسح كود ERP لـ 1 عميل غير موجود في الشيت'), 'the result message says how many codes were cleared');
  ok((await dialog.locator('.erp-customers-cleared-list').innerText()).includes('مصنع الصفا للبلوك الاسمنتي'), 'and lists the customer');
  check([await code('safa'), (await app.db.prepare("SELECT source_code FROM crm_customer_code_aliases WHERE customer_id='safa'").all()).results.map(r => r.source_code)], ['', ['345']], 'its ERP code is empty, the old one kept');
  await fits(admin, 'phone, the result with a cleared code');
  await shot(admin, 'erp-customers-clear-result-phone');
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
  check([(await tiles())[0], (await tiles())[2]], [['Will change', '0'], ['New customers', '0']], 'the same file again: nothing left to change or add');
  check(await dialog.getByRole('button', {name: 'Update 0 code(s) and add 0 customer(s)', exact: true}).isDisabled(), true, 'so nothing to apply');
  /** The screen's own words: the dialog's text without the data it shows in <bdi> (names, codes, numbers). */
  const ownWords = () => dialog.evaluate(node => { const copy = node.cloneNode(true); copy.querySelectorAll('bdi').forEach(item => item.remove()); return copy.textContent; });
  ok(!/[\u0600-\u06ff]/.test(await ownWords()), 'English: no Arabic left in the preview');
  answer = posted(admin, 'preview');
  await dialog.locator('#erp-customers-file').setInputFiles(english);
  await answer;
  await dialog.locator('[data-section=new]').waitFor();
  check(await tiles(), [['Will change', '0'], ['Needs a choice', '1'], ['New customers', '1'], ['No change', '0']], 'English: a similar name and a new customer');
  const englishClears = dialog.locator('[data-section=clear]'), englishBox = englishClears.getByRole('checkbox', {name: 'Clear the ERP code of the customers not in the sheet'});
  ok((await englishClears.locator('h3').innerText()).trim().startsWith('Customers not in the sheet: their ERP code will be cleared ('), 'English: the section of the customers not in the sheet');
  check(await englishBox.isChecked(), true, 'English: the box, checked');
  ok(/^Update 0 code\(s\), add 1 customer\(s\) and clear \d+ code\(s\)$/.test((await dialog.locator('.erp-customers-apply').innerText()).trim()), 'English: the button says it clears');
  ok(!/[\u0600-\u06ff]/.test(await ownWords()), 'English: no Arabic left with the clear section');
  await englishClears.scrollIntoViewIfNeeded();
  await shot(admin, 'erp-customers-clear-desktop-en');
  await englishBox.uncheck();
  ok((await englishClears.innerText()).includes('Their ERP codes will not change.'), 'English: unchecked, the codes stay');
  check([await dialog.locator('[data-section=choose] button.erp-customers-pick').allInnerTexts(), (await dialog.locator('.erp-customers-apply').innerText()).trim()], [['This one', 'This one', 'New customer', 'Leave it'], 'Update 0 code(s) and add 1 customer(s)'], 'English buttons');
  check(await dialog.locator('#erp-customers-region option').allInnerTexts(), ['Region not specified', 'Central', 'Eastern', 'Western', 'Northern', 'Southern'], 'English region names');
  const words = await ownWords();
  ok(!/[\u0600-\u06ff]/.test(words), 'English: no Arabic left with the choose and new sections: ' + (words.match(/\S*[\u0600-\u06ff]\S*/g) || []).slice(0, 5).join(' | '));
  await admin.setViewportSize(PHONE);
  await admin.waitForTimeout(300);
  await fits(admin, 'phone, English');
  await shot(admin, 'erp-customers-preview-phone-en');
  await dialog.getByRole('button', {name: 'Close', exact: true}).last().click();
  await dialog.waitFor({state: 'detached'});

  // ---- 6b. A file whose only unmatched row has a similar name: «New customer» brings the region select, and the region chosen is applied
  await importButton(admin).click();
  await dialog.waitFor();
  answer = posted(admin, 'preview');
  await dialog.locator('#erp-customers-file').setInputFiles({name: 'Customer_similar.xlsx', mimeType: file.mimeType, buffer: workbook([row('9201', 'مصنع الصفا للبلوك المتطور')])});
  check((await (await answer).json()).rows.map(r => r.status), ['similar'], 'only a similar row');
  await dialog.locator('[data-section=choose]').waitFor();
  check([await dialog.locator('[data-section=new]').count(), await dialog.locator('#erp-customers-region').count()], [0, 0], 'nothing to add yet: no region select');
  answer = posted(admin, 'preview');
  await dialog.locator('[data-section=choose]').getByRole('button', {name: 'New customer', exact: true}).click();
  await answer;
  await dialog.locator('#erp-customers-region').waitFor();
  ok((await dialog.locator('[data-section=new]').innerText()).includes('under your name') && (await dialog.locator('[data-section=new]').innerText()).includes('“Edit”'), '«New customer» on a similar row: the new-customers part with the note about the uploader');
  check(await dialog.locator('#erp-customers-region').evaluate(item => [getComputedStyle(item).fontSize, item.getBoundingClientRect().height >= 46]), ['16px', true], 'phone: 16 px, at least 46 px tall');
  await dialog.locator('#erp-customers-region').selectOption('الشرقية');
  await dialog.locator('[data-section=clear]').getByRole('checkbox').uncheck();
  await fits(admin, 'phone, a similar row added');
  const similarApplied = posted(admin, 'apply');
  await dialog.getByRole('button', {name: 'Update 0 code(s) and add 1 customer(s)', exact: true}).click();
  const similarSent = await similarApplied;
  check([similarSent.status(), JSON.parse(similarSent.request().postData()).region, JSON.parse(similarSent.request().postData()).choices, 'clearCodes' in JSON.parse(similarSent.request().postData()), (await similarSent.json()).cleared], [200, 'الشرقية', [{row: 3, customerId: '+new'}], false, 0], 'the region chosen goes with the apply (the box unchecked: no code cleared)');
  check((await app.db.prepare("SELECT json_extract(data,'$.region') AS region FROM crm_records WHERE json_extract(data,'$.code')='9201'").all()).results.map(r => r.region), ['الشرقية'], 'and the new customer has it');
  await dialog.locator('.erp-import-success').waitFor();
  await dialog.getByRole('button', {name: 'Done', exact: true}).click();
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
