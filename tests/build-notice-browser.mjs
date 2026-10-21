// The "a newer version is available" notice in a real Chromium against the BUILT release (run `pnpm build` first): the page asks the
// server with HEAD whether the scripts it runs still exist; once a script has vanished (a release was deployed) a notice with a
// reload button appears on a phone, nothing reloads by itself, the button reloads, and a server that merely cannot answer (a release
// being switched) raises nothing. Synthetic isolated fixtures only: temporary SQLite, mocked sendmail, no production data, no device.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [{id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'سعد مدير المبيعات'}];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-notice-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const SCRIPT = /\/_next\/static\/chunks\/index-[A-Za-z0-9_-]+\.js$/;
const PHONE = {width: 390, height: 844};

try {
  app = await bootBuiltApp({members}, {tls: true});
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  async function open() {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce', serviceWorkers: 'block'});
    const cookie = await app.login('sm'), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    const heads = [];
    page.on('request', request => { if (request.method() === 'HEAD') heads.push({url: new URL(request.url()).pathname}); });
    return {page, context, heads};
  }
  const notice = page => page.locator('.build-notice');

  // ---- a current page: it asks about its own scripts and shows nothing
  {
    const {page, context, heads} = await open();
    await page.goto(app.origin + '/'); await page.locator('.workspace').waitFor(); await page.evaluate(() => { window.__noReload = 1; }); await page.waitForTimeout(2500);
    ok(heads.length >= 1 && heads.every(item => item.url.startsWith('/_next/static/')), 'the page asks the server about its own scripts, with HEAD: ' + heads.map(item => item.url).join(', '));
    ok(heads.some(item => SCRIPT.test(item.url)), 'including the page entry script, the one whose name changes with every release');
    check(await notice(page).count(), 0, 'a current page shows no notice');
    check(await page.evaluate(() => window.__noReload), 1, 'and reloaded nothing');
    await context.close();
  }

  // ---- a server that cannot answer (a release being switched) raises nothing
  {
    const {page, context} = await open();
    await page.route(SCRIPT, route => route.request().method() === 'HEAD' ? route.fulfill({status: 503, body: ''}) : route.continue());
    await page.goto(app.origin + '/'); await page.locator('.workspace').waitFor(); await page.waitForTimeout(2500);
    check(await notice(page).count(), 0, 'a 503 while the release is switched raises no notice');
    await context.close();
  }

  // ---- a script that has vanished: a newer release is on the server
  {
    const {page, context} = await open();
    let gone = true;
    await page.route(SCRIPT, route => route.request().method() === 'HEAD' && gone ? route.fulfill({status: 404, body: ''}) : route.continue());
    await page.goto(app.origin + '/'); await page.locator('.workspace').waitFor();
    await notice(page).waitFor();
    await page.evaluate(() => { window.__noReload = 1; });
    const text = await notice(page).innerText();
    ok(text.includes('يوجد تحديث للتطبيق') && text.includes('أعد التحميل'), 'the notice appears in Arabic: ' + text.replace(/\n/g, ' · '));
    ok(text.includes('لن تُعاد الصفحة من تلقاء نفسها'), 'and says the page will not reload by itself');
    const button = notice(page).getByRole('button', {name: 'أعد التحميل'});
    const box = await button.boundingBox();
    ok(box.height >= 44, 'the button is at least 44px tall (' + Math.round(box.height) + ')');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(overflow <= 0, true, 'the notice does not widen the phone page (' + overflow + 'px)');
    await page.screenshot({path: path.join(screenshots, 'build-notice-phone.png')});
    await page.waitForTimeout(3000);
    check(await page.evaluate(() => window.__noReload), 1, 'three seconds later the page has still not reloaded by itself');
    // the user chooses: reload with the new release now being served
    gone = false;
    const reloaded = page.waitForEvent('framenavigated', frame => frame === page.mainFrame());
    await button.click();
    await reloaded; await page.locator('.workspace').waitFor(); await page.waitForTimeout(2500);
    check(await notice(page).count(), 0, 'after the reload the notice is gone');
    check(await page.evaluate(() => window.__noReload), undefined, 'the button reloaded the page (the marker is gone)');
    await context.close();
  }

  // ---- English
  {
    const {page, context} = await open();
    await page.route(SCRIPT, route => route.request().method() === 'HEAD' ? route.fulfill({status: 404, body: ''}) : route.continue());
    await page.goto(app.origin + '/'); await page.locator('.workspace').waitFor();
    await page.getByRole('button', {name: /Switch to English|English/}).first().click();
    await notice(page).waitFor();
    const text = await notice(page).innerText();
    ok(text.includes('An app update is available') && text.includes('Reload'), 'the English notice: ' + text.replace(/\n/g, ' · '));
    check(/[؀-ۿ]/.test(text), false, 'no Arabic in the English notice');
    check(await notice(page).getAttribute('dir'), 'ltr', 'left to right');
    await context.close();
  }

  check(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks, builtRelease: true, browser: 'chromium', productionDataUsed: false, screenshots}));
} finally {
  await browser?.close();
  await app?.stop();
}
