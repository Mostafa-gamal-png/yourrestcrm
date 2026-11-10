// «تصنيف العميل» and «نوع العميل» in a real Chromium against the BUILT release (run the build first), on a 360 px phone, in Arabic and in
// English: the customer sheet shows «تصنيف العميل» (the old «نوع العميل» field) and the new «نوع العميل»; a customer classified «خدمات»
// before keeps it shown on its sheet and chosen in its own form, while the new-customer form no longer offers it; the edit form has the
// two groups next to each other with the four types; choosing «محل تجاري» and saving stores it with «خدمات» untouched; the page never
// scrolls sideways. Screenshots for the report. Synthetic fixtures only: temporary SQLite, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [{id: 'owner', role: 'admin', name: 'مدير النظام'}];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-customer-kind-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const PHONE = {width: 360, height: 800};
const LEGACY = 'مصنع الخدمات القديم', PLAIN = 'مصنع بلا نوع';

try {
  app = await bootBuiltApp({members}, {tls: true});
  const now = new Date().toISOString();
  const customer = (id, name, data = {}) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'owner','الرئيسي',?,?,?,1,'fixture')")
    .bind(id, JSON.stringify({name, branch: 'الرئيسي', assignedTo: 'owner', region: 'الوسطى', city: 'الرياض', customerStatus: 'نشط', phone: '0551234567', contact: 'م', code: '', location: '24.7136, 46.6753', latitude: 24.7136, longitude: 46.6753, ...data}), now, now).run();
  await customer('legacy', LEGACY, {customerType: 'خدمات', customerKind: 'مصنع'});
  await customer('plain', PLAIN, {customerType: 'جملة'});
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});

  async function open({english = false} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport: PHONE, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', geolocation: {latitude: 24.7136, longitude: 46.6753, accuracy: 8}, permissions: ['geolocation']});
    const cookie = await app.login('owner'), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    if (english) await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(app.origin + '/#customer');
    await page.locator('.customer-mobile-card').first().waitFor();
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    return page;
  }
  const shot = async (page, label) => { await page.waitForTimeout(250); await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const noSideways = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scrolling at 360 px');
  const sheetValues = page => page.locator('.crm-sheet .detail-grid > div').evaluateAll(items => Object.fromEntries(items.map(item => [item.querySelector('span')?.textContent.trim(), item.querySelector('strong')?.textContent.trim()])));
  const openSheet = async (page, name, english) => {
    await page.locator('.customer-mobile-card').filter({has: page.locator('h3', {hasText: name})}).locator('.customer-mobile-name').click();
    await page.locator('.crm-sheet .detail-grid').waitFor();
    if (english) await page.waitForFunction(() => [...document.querySelectorAll('.crm-sheet .detail-grid span')].some(span => span.textContent.trim() === 'Customer classification'));
  };
  const groups = dialog => dialog.locator('fieldset.customer-choice-field').evaluateAll(sets => sets.filter(set => set.querySelector('input[name^="customer-choice-"]')).map(set => ({
    legend: set.querySelector('legend').textContent.trim(),
    choices: [...set.querySelectorAll('label.customer-choice')].map(label => label.textContent.trim()),
    checked: [...set.querySelectorAll('input:checked')].map(input => input.value)
  })));
  const row = async id => JSON.parse((await app.db.prepare('SELECT data FROM crm_records WHERE id=?').bind(id).first()).data);

  // ---- Arabic: the sheet of a customer classified «خدمات»
  const page = await open();
  await openSheet(page, LEGACY);
  const values = await sheetValues(page);
  check([values['تصنيف العميل'], values['نوع العميل']], ['خدمات', 'مصنع'], 'the sheet: «تصنيف العميل» keeps «خدمات», «نوع العميل» reads «مصنع»');
  await noSideways(page, 'the sheet');
  await page.locator('.crm-sheet .detail-grid > div', {has: page.locator('span', {hasText: /^تصنيف العميل$/})}).scrollIntoViewIfNeeded();
  await shot(page, 'customer-kind-sheet-ar');
  // its edit form: the two groups next to each other, «خدمات» still chosen for this customer
  await page.locator('.crm-sheet').getByRole('button', {name: 'تعديل', exact: true}).click();
  const dialog = page.locator('.crm-master-dialog');
  await dialog.locator('fieldset.customer-choice-field').first().waitFor();
  check((await groups(dialog)).slice(0, 2), [
    {legend: 'تصنيف العميل', choices: ['دوليون', 'مميزون', 'جملة', 'قطاعي', 'تجاري', 'خدمات'], checked: ['خدمات']},
    {legend: 'نوع العميل', choices: ['مصنع', 'مؤسسة', 'شركة', 'محل تجاري'], checked: ['مصنع']}
  ], 'the edit form: «تصنيف العميل» with its stored «خدمات», then «نوع العميل»');
  const kindGroup = dialog.locator('fieldset.customer-choice-field').filter({has: page.locator('legend', {hasText: /^نوع العميل$/})});
  await kindGroup.scrollIntoViewIfNeeded();
  await noSideways(page, 'the edit form');
  await shot(page, 'customer-kind-form-legacy-ar');
  await kindGroup.locator('label.customer-choice', {hasText: 'محل تجاري'}).click();
  check(await kindGroup.locator('input:checked').evaluate(input => input.value), 'محل تجاري', 'a tap chooses «محل تجاري»');
  await dialog.locator('button[type=submit]').click();
  await dialog.waitFor({state: 'hidden'});
  for (let attempt = 0; attempt < 50 && (await row('legacy')).customerKind !== 'محل تجاري'; attempt++) await page.waitForTimeout(100);
  check([(await row('legacy')).customerKind, (await row('legacy')).customerType], ['محل تجاري', 'خدمات'], 'saved: the new type, «خدمات» untouched');

  // ---- another customer's form never offers «خدمات»
  await page.keyboard.press('Escape');
  await page.locator('.crm-sheet').waitFor({state: 'hidden'}).catch(() => {});
  await openSheet(page, PLAIN);
  check([(await sheetValues(page))['تصنيف العميل'], (await sheetValues(page))['نوع العميل']], ['جملة', '—'], 'a customer with no type: «—»');
  await page.locator('.crm-sheet').getByRole('button', {name: 'تعديل', exact: true}).click();
  await dialog.locator('fieldset.customer-choice-field').first().waitFor();
  check((await groups(dialog)).slice(0, 2), [
    {legend: 'تصنيف العميل', choices: ['دوليون', 'مميزون', 'جملة', 'قطاعي', 'تجاري'], checked: ['جملة']},
    {legend: 'نوع العميل', choices: ['مصنع', 'مؤسسة', 'شركة', 'محل تجاري'], checked: []}
  ], 'another customer: no «خدمات», no type chosen yet');
  await dialog.getByRole('button', {name: 'إلغاء', exact: true}).click();
  await dialog.waitFor({state: 'hidden'});
  await page.close();

  // ---- the new-customer form
  const fresh = await open();
  await fresh.getByRole('button', {name: 'إضافة مصنع', exact: true}).first().click();
  const newDialog = fresh.locator('.crm-master-dialog');
  await newDialog.locator('fieldset.customer-choice-field').first().waitFor();
  check((await groups(newDialog)).slice(0, 2).map(group => [group.legend, group.choices, group.checked]), [
    ['تصنيف العميل', ['دوليون', 'مميزون', 'جملة', 'قطاعي', 'تجاري'], []],
    ['نوع العميل', ['مصنع', 'مؤسسة', 'شركة', 'محل تجاري'], []]
  ], 'a new customer: five classifications, the four types, nothing chosen');
  await newDialog.locator('fieldset.customer-choice-field').first().scrollIntoViewIfNeeded();
  await noSideways(fresh, 'the new-customer form');
  await shot(fresh, 'customer-kind-form-new-ar');
  await fresh.context().close();

  // ---- English
  const english = await open({english: true});
  await openSheet(english, LEGACY, true);
  const en = await sheetValues(english);
  check([en['Customer classification'], en['Customer type']], ['Services', 'Retail shop'], 'English sheet: the labels and the values');
  await noSideways(english, 'the English sheet');
  await english.locator('.crm-sheet .detail-grid > div', {has: english.locator('span', {hasText: /^Customer classification$/})}).scrollIntoViewIfNeeded();
  await shot(english, 'customer-kind-sheet-en');
  await english.locator('.crm-sheet').getByRole('button', {name: 'Edit', exact: true}).click();
  const enDialog = english.locator('.crm-master-dialog');
  await enDialog.locator('fieldset.customer-choice-field').first().waitFor();
  const enGroups = (await groups(enDialog)).slice(0, 2);
  check(enGroups, [
    {legend: 'Customer classification', choices: ['International', 'Premium', 'Wholesale', 'Retail', 'Commercial', 'Services'], checked: ['خدمات']},
    {legend: 'Customer type', choices: ['Factory', 'Establishment', 'Company', 'Retail shop'], checked: ['محل تجاري']}
  ], 'English form: the two groups, «Services» still chosen for this customer');
  ok(enGroups.every(group => !/[؀-ۿ]/.test(group.legend + group.choices.join(''))), 'no Arabic left in the two groups');
  await enDialog.locator('fieldset.customer-choice-field').nth(1).scrollIntoViewIfNeeded();
  await noSideways(english, 'the English form');
  await shot(english, 'customer-kind-form-en');
  await english.context().close();

  ok(!errors.length, 'no uncaught page errors: ' + errors.join(' | '));
  console.log(JSON.stringify({ok: true, checks, screenshots, realChromium: true, syntheticFixtures: true}));
} finally {
  await browser?.close(); await app?.stop();
}
