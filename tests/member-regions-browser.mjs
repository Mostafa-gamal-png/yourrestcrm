// Several regions for one member, in a real Chromium against the BUILT release (run `pnpm build` first): the administrator ticks
// a second region on the team form and the table lists both; the representative, on the Android app emulator, then sees the
// customers of both regions and nothing of a third, and a new customer's form offers exactly those two regions. The phone is
// the emulator's (scripts/lib/native-bridge.mjs): no device or OS claim is made. Synthetic isolated fixtures only: temporary
// SQLite, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require('playwright');
const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'سعد مدير المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'sm', name: 'ماجد المشرف'},
  {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'أحمد المندوب'}, {id: 'rep2', role: 'rep', sup: 'sup', region: 'western', name: 'سالم المندوب'}
];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-member-regions-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1280, height: 900};
const EAST = 'مصنع الشرق للبلوك', CENTRAL = 'مصنع الوسط للخرسانة', WEST = 'مصنع الغرب للطوب';

try {
  app = await bootBuiltApp({members}, {tls: true});
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  const scopeOf = async id => (await app.db.prepare('SELECT region_scope AS scope FROM crm_members WHERE id=?').bind(id).first()).scope;
  async function eventually(probe, message, timeoutMs = 20000) {
    const until = Date.now() + timeoutMs;
    for (;;) { const value = await probe(); if (value) { checks++; return value; } if (Date.now() > until) throw Error(message + ' (timed out)'); await pause(150); }
  }
  async function open(memberId, {native = false, viewport = DESKTOP} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', geolocation: {latitude: 26.437341, longitude: 50.034499, accuracy: 8}, permissions: ['geolocation']});
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (native) await installNativeBridge(page, native === true ? {} : native);
    await page.goto(app.origin + '/');
    await page.locator('.workspace').waitFor();
    return page;
  }
  const settle = page => page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const shot = async (page, label) => { await settle(page); await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const layoutOk = async (page, label) => { const geometry = await page.evaluate(() => ({overflow: document.documentElement.scrollWidth > innerWidth + 1, width: innerWidth})); check(geometry.overflow, false, label + ': no horizontal overflow at ' + geometry.width + 'px'); };
  const goDesktop = async (page, label) => { await page.locator('button.nav-item', {hasText: label}).first().click(); await page.locator('.page-heading h1', {hasText: label}).waitFor(); };
  const goPhone = async (page, id) => {
    await page.locator('.mobile-bottom-navigation').waitFor();
    const tab = page.locator('.mobile-tab[data-page="' + id + '"]');
    if (await tab.count()) { await tab.click(); await page.locator('.mobile-tab[data-page="' + id + '"][aria-current="page"]').waitFor(); return; }
    await page.getByRole('button', {name: /^(المزيد من الصفحات|More pages)$/}).click();
    await page.locator('.mobile-overflow-pages [data-page=' + id + ']').click();
    await page.locator('.mobile-navigation-sheet').waitFor({state: 'detached'});
    await page.locator('.page-heading').waitFor();
  };

  // ---- fixtures: a customer in each of three regions
  const created = new Date().toISOString();
  const customer = (id, name, region, assignedTo) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, assignedTo, JSON.stringify({name, region, city: 'الدمام', phone: '0551234567', contact: 'أبو خالد', code: id, branch: 'الرئيسي', assignedTo}), created, created).run();
  await customer('c-east', EAST, 'الشرقية', 'rep'); await customer('c-central', CENTRAL, 'الوسطى', 'rep'); await customer('c-west', WEST, 'الغربية', 'rep2');

  // ---- 1. The administrator gives the representative a second region
  const admin = await open('owner');
  {
    await goDesktop(admin, 'الفريق والصلاحيات');
    const row = admin.locator('tr', {hasText: 'rep@yourrest.org'});
    await row.waitFor();
    check((await row.innerText()).includes('الشرقية') && !(await row.innerText()).includes('الوسطى'), true, 'the table lists the representative\'s single region');
    await row.getByRole('button').first().click();
    const field = admin.locator('.member-region-field');
    await field.waitFor();
    const box = label => field.locator('label.customer-choice').filter({hasText: label}).locator('input');
    check([await box('كل المناطق').isChecked(), await box('الشرقية').isChecked(), await box('الوسطى').isChecked()], [false, true, false], 'the form shows the current region ticked');
    await box('الوسطى').check();
    check((await field.locator('small').innerText()).includes('الوسطى، الشرقية'), true, 'the form names the chosen regions');
    await layoutOk(admin, 'administrator: member form'); await shot(admin, 'member-regions-form');
    await admin.locator('form button[type="submit"]').click();
    await eventually(async () => (await scopeOf('rep')) === 'central,eastern', 'the two regions are stored as one canonical text');
    await eventually(async () => (await row.innerText()).includes('الوسطى، الشرقية'), 'the table lists both regions');
    // All regions again: the other boxes stay unticked and disabled.
    await row.getByRole('button').first().click();
    await field.waitFor();
    await box('كل المناطق').check();
    check([await box('الشرقية').isChecked(), await box('الشرقية').isDisabled()], [false, true], 'all regions clears and disables the single regions');
    await admin.keyboard.press('Escape');
    await admin.context().close();
  }

  // ---- 2. The representative, on the app, sees the customers of both regions and may place a new customer in either
  const rep = await open('rep', {native: {memberId: 'rep', regionScope: 'central,eastern'}, viewport: PHONE});
  {
    await goPhone(rep, 'customer');
    const named = name => rep.getByRole('button', {name: 'بيانات العميل: ' + name, exact: true});
    await named(EAST).waitFor();
    check([await named(EAST).count(), await named(CENTRAL).count(), await named(WEST).count()], [1, 1, 0], 'the eastern and the central customers are listed, the western one is not');
    await layoutOk(rep, 'representative: customers of two regions'); await shot(rep, 'member-regions-rep-customers');
    await rep.getByRole('button', {name: 'إضافة عميل', exact: true}).click();
    const region = rep.locator('fieldset.customer-region-field');
    await region.waitFor();
    check([await region.isDisabled(), await region.locator('input[type=radio]').count(), await region.locator('label.customer-choice').allInnerTexts().then(texts => texts.map(text => text.trim()))], [false, 2, ['الشرقية', 'الوسطى']], 'the new customer may be placed in either of the two regions, and no other');
    check((await region.locator('small').innerText()).includes('الوسطى، الشرقية'), true, 'the form names the member\'s regions');
    await rep.keyboard.press('Escape');
    await rep.context().close();
  }

  // ---- 3. The other representative still sees his region only
  const other = await open('rep2', {native: {memberId: 'rep2', regionScope: 'western'}, viewport: PHONE});
  {
    await goPhone(other, 'customer');
    const named = name => other.getByRole('button', {name: 'بيانات العميل: ' + name, exact: true});
    await named(WEST).waitFor();
    check([await named(EAST).count(), await named(CENTRAL).count(), await named(WEST).count()], [0, 0, 1], 'a representative of one region is unchanged');
    await other.context().close();
  }

  check(errors, [], 'no page error was raised');
  console.log(JSON.stringify({ok: true, checks, screenshots, scope: 'several regions for a member in real Chromium on the built release: the team form and table, the representative\'s customers and new-customer regions on the Android emulator, a one-region representative unchanged', realBrowser: true, realDevice: false}));
} finally {
  await browser?.close();
  await app?.stop();
}
