// Mold manufacturing requests in a real Chromium against the BUILT release (run `pnpm build` first), sending to the stand-in production
// API (scripts/lib/products-mock.mjs): a representative opens «طلبات تصنيع القوالب», asks for a mold for a customer of their own (search,
// choose, the form with the usual sizes), the request is saved and sent (order 92, seven stages not started); production moves it on
// (stages done, locked); production unreachable (kept waiting, resend); the form refuses an incomplete request; the phone keeps the
// representative's five tabs and opens the page from the account sheet; a supervisor follows without asking; customer service has
// no such page. Screenshots for the report. Synthetic fixtures only: temporary SQLite, no production data, no real production app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require('playwright');
const members = [
  {id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'}, {id: 'sup', role: 'supervisor', sup: 'sm'},
  {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'أحمد عبد العزيز'}, {id: 'csm', role: 'customer_service_manager', sup: 'sm'}
];
const screenshots = process.env.YR_MOLD_SCREENSHOT_DIR ? path.resolve(process.env.YR_MOLD_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-mold-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1280, height: 900};
const LABEL = 'طلبات تصنيع القوالب';

const mock = await startProductsMock();
const app = await bootBuiltApp({members}, {tls: true, env: {YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret, NODE_EXTRA_CA_CERTS: mock.ca}});
try {
  const now = new Date().toISOString();
  const customer = (id, assignedTo, region) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, assignedTo, JSON.stringify({name: 'مصنع ' + id, region, city: 'الدمام', address: 'حي الصناعية', phone: '0551234567', code: 'ERP-' + id, branch: 'الرئيسي', assignedTo}), now, now).run();
  await customer('east1', 'rep', 'الشرقية'); await customer('east2', 'rep', 'الشرقية');
  const {scope} = await app.db.prepare('SELECT region_scope AS scope FROM crm_members WHERE id=?').bind('rep').first();
  const stale = () => app.db.prepare("UPDATE crm_mold_requests SET remote_at='2026-01-01T00:00:00.000Z'").run();
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  /** A signed-in page; a representative runs in the Android app emulator with tracking set up (the gate lets them in). */
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
  const shot = async (page, label) => { await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const noOverflow = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal overflow');
  const goMolds = async page => { await page.locator('button.nav-item', {hasText: LABEL}).first().click(); await page.locator('.mold-page').waitFor(); };
  const sheet = page => page.locator('.mold-sheet');
  const fill = async (dialog, customerName) => {
    if (customerName) { await dialog.locator('.mold-customer-search input').fill(customerName); await dialog.locator('.mold-customer-matches button', {hasText: customerName}).click(); }
    await dialog.locator('label.mold-field', {hasText: 'وصف القالب'}).locator('input').fill('200*400*27.5TH MM OPEN');
    for (const text of ['مفتوح', 'موديل قديم', 'بدون بلوكة نص']) await dialog.locator('.mold-choice label', {hasText: text}).click();
    await dialog.locator('.mold-choice', {hasText: 'عدد الرجاجات'}).locator('label', {hasText: '2'}).click();
    await dialog.locator('label.mold-field', {hasText: 'عرض القالب'}).locator('.mold-usual button', {hasText: '1380'}).click();
    await dialog.locator('label.mold-field', {hasText: 'مقاس الجلب'}).locator('.mold-usual button', {hasText: '795'}).click();
  };

  // ---- 1. The representative asks for a mold: saved, sent, order 92, seven stages not started
  const rep = await open('rep');
  await goMolds(rep);
  check(await rep.locator('.page-heading .heading-actions button:visible').count(), 0, 'no generic add or export button over the page');
  check(await rep.locator('.mold-page h2').count(), 0, 'the page title is said once');
  await rep.locator('.mold-page .empty', {hasText: 'لا توجد طلبات تصنيع قوالب بعد.'}).waitFor();
  await rep.locator('button.mold-new').click();
  const dialog = rep.locator('.mold-dialog');
  await dialog.waitFor();
  // An incomplete request is refused on the device: no call reaches production.
  const before = mock.state.calls.length;
  await dialog.getByRole('button', {name: 'حفظ وإرسال للإنتاج'}).click();
  ok(await dialog.locator('.field-error', {hasText: 'اختر العميل'}).count() === 1, 'the form asks for the customer');
  ok(await dialog.locator('.field-error').count() >= 5, 'and points at each missing field');
  check(mock.state.calls.length, before, 'nothing was sent for an incomplete form');
  await fill(dialog, 'مصنع east1');
  check(await dialog.locator('.field-error').count(), 0, 'each message goes once its field is filled');
  await shot(rep, 'mold-form-desktop');
  await dialog.getByRole('button', {name: 'حفظ وإرسال للإنتاج'}).click();
  await sheet(rep).waitFor();
  const facts = sheet(rep).locator('.mold-facts').first();
  await facts.locator('dd', {hasText: '92'}).waitFor();
  check(await sheet(rep).locator('.mold-stages li').count(), 7, 'seven stages');
  check(await sheet(rep).locator('.mold-stages li[data-done="true"]').count(), 0, 'none started');
  ok((await facts.innerText()).includes('YR-C-'), 'the customer by its Yourrest code');
  check(await sheet(rep).getByRole('button', {name: 'تعديل الطلب'}).count(), 1, 'still editable while received');
  await shot(rep, 'mold-sheet-received');
  const sent = JSON.parse(mock.state.calls.findLast(call => call.route === 'requests').body);
  check([sent.customer.name, sent.specs.moldWidth, sent.specs.gelbaSize, sent.specs.vibrators], ['مصنع east1', 1380, 795, 2], 'production received what was chosen');
  await rep.keyboard.press('Escape');
  await rep.locator('.mold-card').first().waitFor();
  check(await rep.locator('.mold-card').count(), 1, 'the list shows the request');

  // ---- 2. Production moves it on: two stages done, the request locked
  mock.produce(sent.crmRequestId, {stages: ['laserCutting', 'box'], moldSerial: 'S-1001'});
  await stale();
  await rep.locator('.mold-heading-tools button').first().click();
  await rep.locator('.mold-card').first().click();
  await sheet(rep).locator('.mold-stages li[data-done="true"]').nth(1).waitFor();
  check(await sheet(rep).locator('.mold-stages li[data-done="true"]').count(), 2, 'two stages done');
  await sheet(rep).locator('.mold-locked').waitFor();
  check([await sheet(rep).getByRole('button', {name: 'تعديل الطلب'}).count(), await sheet(rep).getByRole('button', {name: 'إلغاء الطلب'}).count()], [0, 0], 'no edit or cancel once production started');
  ok((await sheet(rep).locator('.mold-facts').first().innerText()).includes('S-1001'), 'the serial is shown');
  await shot(rep, 'mold-sheet-in-production');
  await rep.keyboard.press('Escape');

  // ---- 3. Production unreachable: kept waiting, then resent
  mock.state.down = true;
  await rep.locator('button.mold-new').click();
  await dialog.waitFor();
  await fill(dialog, 'مصنع east2');
  await dialog.getByRole('button', {name: 'حفظ وإرسال للإنتاج'}).click();
  await sheet(rep).locator('.mold-sending').waitFor();
  ok((await sheet(rep).locator('.mold-sending').innerText()).length > 0, 'the request says it waits to be sent');
  await shot(rep, 'mold-sheet-waiting');
  mock.state.down = false;
  await sheet(rep).getByRole('button', {name: 'إعادة الإرسال'}).click();
  await sheet(rep).locator('.mold-facts').first().locator('dd', {hasText: '93'}).waitFor();
  check(await sheet(rep).locator('.mold-sending').count(), 0, 'sent: nothing waits any more');
  await rep.keyboard.press('Escape');
  await noOverflow(rep, 'desktop list'); await shot(rep, 'mold-list-desktop');
  await rep.context().close();

  // ---- 4. The phone keeps the representative's five tabs; the page opens from the account sheet
  const phone = await open('rep', {viewport: PHONE});
  await phone.locator('.mobile-tab[data-page="targets"]').waitFor();
  check(await phone.locator('.mobile-tab[data-page]').evaluateAll(tabs => tabs.map(tab => tab.getAttribute('data-page'))), ['customer', 'map', 'activity', 'followup', 'targets'], 'the same five tabs');
  await phone.locator('button.mobile-profile-trigger').click();
  await phone.locator('.mobile-overflow-pages button[data-page="mold-requests"]').click();
  await phone.locator('.mobile-navigation-sheet').waitFor({state: 'detached'});
  await phone.locator('.mold-page .mold-card').nth(1).waitFor();
  await noOverflow(phone, 'phone list'); await shot(phone, 'mold-list-phone');
  await phone.locator('.mold-card').first().click();
  await sheet(phone).waitFor();
  await phone.waitForFunction(() => { const box = document.querySelector('.mold-sheet')?.getBoundingClientRect(); return !!box && box.left >= -1 && box.right <= innerWidth + 1 && box.width >= innerWidth - 2; });
  await sheet(phone).locator('.mold-stages li').first().waitFor();
  await noOverflow(phone, 'phone sheet'); await shot(phone, 'mold-sheet-phone');
  await phone.context().close();

  // ---- 5. A supervisor follows without asking; customer service has no such page
  const sup = await open('sup');
  await goMolds(sup);
  await sup.locator('.mold-card').nth(1).waitFor();
  check(await sup.locator('button.mold-new').count(), 0, 'a supervisor cannot ask for a mold');
  await sup.context().close();
  const csm = await open('csm');
  check(await csm.locator('button.nav-item', {hasText: LABEL}).count(), 0, 'customer service has no mold page');
  await csm.context().close();

  check(JSON.stringify(mock.state.calls).includes(mock.state.secret), false, 'the secret never travelled in a body');
  ok(!errors.length, 'no uncaught page errors: ' + errors.join(' | '));
  console.log(JSON.stringify({ok: true, checks, screenshots, realChromium: true, productionApplicationReal: false, productionDataUsed: false}));
} finally {
  await browser?.close(); await app.stop(); await mock.stop();
}
