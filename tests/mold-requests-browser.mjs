// Mold manufacturing requests in a real Chromium against the BUILT release (run `pnpm build` first), sending to the stand-in production
// API (scripts/lib/products-mock.mjs): a representative opens «طلبات تصنيع القوالب», asks for a mold for a customer of their own (search,
// choose, the form with the usual sizes), the request is saved and sent (order 92, seven stages not started); production moves it on
// (stages done, locked); production unreachable (kept waiting, resend); the form refuses an incomplete request; the phone keeps the
// representative's five tabs and opens the page from the account sheet. Since 2026-11-01: each request says where it waits and since
// when, with the three approvals; the sales manager approves (and withdraws) from the request; an edit warns that it undoes the
// approvals; four half-block choices; a supervisor and customer service ask too. Screenshots for the report. Synthetic fixtures only: temporary SQLite, no production data, no real production app.
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
  check((await sheet(rep).locator('.mold-waiting').innerText()).includes('بانتظار اعتماد مدير المبيعات'), true, 'it says where it waits');
  ok(/من \d/.test(await sheet(rep).locator('.mold-waiting').innerText()), 'and since when');
  check([await sheet(rep).locator('.mold-approvals li').count(), await sheet(rep).locator('.mold-approvals li[data-done="true"]').count()], [3, 0], 'three approvals, none given yet');
  check(await sheet(rep).getByRole('button', {name: 'اعتماد', exact: true}).count(), 0, 'a representative does not approve');
  await shot(rep, 'mold-sheet-received');
  const sent = JSON.parse(mock.state.calls.findLast(call => call.route === 'requests').body);
  check([sent.customer.name, sent.specs.moldWidth, sent.specs.gelbaSize, sent.specs.vibrators], ['مصنع east1', 1380, 795, 2], 'production received what was chosen');
  await rep.keyboard.press('Escape');
  await rep.locator('.mold-card').first().waitFor();
  check(await rep.locator('.mold-card').count(), 1, 'the list shows the request');
  check(await rep.locator('.mold-card .mold-chip').first().innerText(), 'بانتظار اعتماد مدير المبيعات', 'the card too');

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

  // ---- 3b. The sales manager approves from the request, and may withdraw until production approves
  const second = JSON.parse(mock.state.calls.findLast(call => call.route === 'requests').body).crmRequestId;
  const manual = mock.registerManual({customerName: 'مصنع مسجّل في الإنتاج', salesmanName: 'مندوب الإنتاج', createdBy: 'prod@yourrest.org', description: 'manual mold'});
  const sm = await open('sm');
  await goMolds(sm);
  // «طلبات بانتظار اعتمادي» first: the CRM's request and the one registered in production
  const pendingCard = sm.locator('.mold-pending', {hasText: 'مصنع مسجّل في الإنتاج'});
  await pendingCard.waitFor();
  check([await sm.locator('.mold-tabs [aria-selected="true"]').innerText(), await sm.locator('.mold-pending').count()], ['طلبات بانتظار اعتمادي 2', 2], 'the sales manager opens on the requests waiting for them, both kinds');
  ok((await pendingCard.innerText()).includes('مسجّل في تطبيق الإنتاج') && (await pendingCard.innerText()).includes('prod@yourrest.org'), 'registered in production, and by whom');
  await shot(sm, 'mold-pending-manager');
  await pendingCard.getByRole('button', {name: 'اعتماد', exact: true}).click();
  await sm.locator('.mold-pending[data-done]', {hasText: 'مصنع مسجّل في الإنتاج'}).waitFor();
  check([mock.state.byOrder.get(manual.orderNo).approvals.sales?.via, await sm.locator('.mold-pending:not([data-done])').count()], ['crm', 1], 'approved at production by its order number; one left waiting');
  await sm.locator('.mold-tabs button', {hasText: 'كل الطلبات'}).click();
  const waitingCard = sm.locator('.mold-card', {hasText: 'مصنع east2'});
  await waitingCard.waitFor();
  check(await waitingCard.locator('.mold-chip').innerText(), 'بانتظار اعتمادك', 'the sales manager reads «waiting for you»');
  await waitingCard.click();
  await sheet(sm).getByRole('button', {name: 'اعتماد', exact: true}).click();
  await sheet(sm).locator('.mold-waiting', {hasText: 'بانتظار اعتماد الإنتاج'}).waitFor();
  check(await sheet(sm).locator('.mold-approvals li[data-done="true"]').count(), 1, 'the sales manager\'s approval is shown as given');
  ok((await sheet(sm).locator('.mold-approvals li').first().innerText()).includes('sm@yourrest.org'), 'with who gave it');
  check(mock.row(second).approvals.sales?.via, 'crm', 'production recorded it as given in the CRM');
  await shot(sm, 'mold-sheet-approved');
  await sheet(sm).getByRole('button', {name: 'سحب الاعتماد'}).click();
  await sheet(sm).getByRole('button', {name: 'اعتماد', exact: true}).waitFor();
  check(mock.row(second).approvals.sales, null, 'withdrawn at production too');
  await sheet(sm).getByRole('button', {name: 'اعتماد', exact: true}).click();
  await sheet(sm).getByRole('button', {name: 'سحب الاعتماد'}).waitFor();
  await sm.context().close();

  // ---- 3c. An edit after an approval says first that it undoes the approvals; four half-block choices
  const editor = await open('rep');
  await goMolds(editor);
  await editor.locator('.mold-card', {hasText: 'مصنع east2'}).click();
  await sheet(editor).getByRole('button', {name: 'تعديل الطلب'}).click();
  const edit = editor.locator('.mold-dialog');
  await edit.locator('.mold-banner', {hasText: 'أي تعديل هيلغي الاعتمادات'}).waitFor();
  check(await edit.locator('.mold-choice', {hasText: 'بلوكة النص'}).locator('label').allInnerTexts(), ['بدون بلوكة نص', 'بلوكة نص واحدة', 'بلوكتين نص', '3 بلوكات نص'], 'none to three half blocks');
  // The dialog opened from the request is above the request, everywhere they overlap.
  check(await editor.evaluate(() => { const box = document.querySelector('.mold-dialog').getBoundingClientRect(), sheetBox = document.querySelector('.mold-sheet').getBoundingClientRect(); const x = Math.max(box.left, sheetBox.left) + 20, y = box.top + box.height / 2; return !!document.elementFromPoint(x, y)?.closest('.mold-dialog'); }), true, 'the edit dialog is on top of the request it was opened from');
  await editor.waitForTimeout(400);
  await shot(editor, 'mold-edit-warning');
  await edit.getByRole('button', {name: 'إلغاء', exact: true}).click();
  await editor.context().close();

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

  // ---- 5. A supervisor follows and asks too; so does customer service
  const sup = await open('sup');
  await goMolds(sup);
  await sup.locator('.mold-card').nth(1).waitFor();
  check(await sup.locator('button.mold-new').count(), 1, 'a supervisor asks for a mold too');
  await sup.context().close();
  const csm = await open('csm');
  await goMolds(csm);
  await csm.locator('.mold-page .mold-empty').waitFor();
  check(await csm.locator('button.mold-new').count(), 1, 'customer service has the page and asks too');
  await csm.context().close();

  check(JSON.stringify(mock.state.calls).includes(mock.state.secret), false, 'the secret never travelled in a body');
  ok(!errors.length, 'no uncaught page errors: ' + errors.join(' | '));
  console.log(JSON.stringify({ok: true, checks, screenshots, realChromium: true, productionApplicationReal: false, productionDataUsed: false}));
} finally {
  await browser?.close(); await app.stop(); await mock.stop();
}
