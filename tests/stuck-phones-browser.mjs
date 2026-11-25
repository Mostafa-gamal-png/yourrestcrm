// «هواتف مناديب متوقفة الآن» (app/stuck-phones-alert.tsx, the owner, 2026-11-25, item 3) in a real Chromium against the BUILT release
// (run the build first). The server's list is answered by the page's own request route, so the test does not depend on the time of day
// (tests/device-status-unit.mjs checks the server's rules and window). The administrator and a supervisor see the card at the top of the
// workspace with each representative's name, problem and minutes, are told once (the page's own notice) and not again for the same phone;
// a representative never asks; a refusal stops the asking. Every size (320 and 360 px phones, a tablet upright and on its side, a computer)
// in Arabic and in English: no sideways scrolling, the card inside the screen, no Arabic left in English but the names. Synthetic only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [{id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', region: 'eastern', name: 'المشرف سالم'}, {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'}, {id: 'rep2', role: 'marketing', sup: 'sup', region: 'eastern', name: 'المسوق محمد'}];
const NAMES = ['المشرف سالم', 'المندوب أحمد', 'المسوق محمد', 'مدير المبيعات', 'مدير النظام'];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-stuck-phones-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const SIZES = {phone320: {width: 320, height: 640}, phone360: {width: 360, height: 800}, tabletUp: {width: 768, height: 1024}, tabletSide: {width: 1024, height: 768}, desktop: {width: 1280, height: 900}};
const STUCK = [
  {memberId: 'rep2', memberName: 'المسوق محمد', problem: 'setup', since: '2026-11-25T05:00:00.000Z', minutes: 75, reportedAt: '2026-11-25T05:50:00.000Z', appVersion: '1.0.15', error: 'تغيرت أذونات الحساب؛ محفوظ على الجهاز 856 نقطة و67 انقطاع من المنطقة السابقة.'},
  {memberId: 'rep1', memberName: 'المندوب أحمد', problem: 'location_services', since: '2026-11-25T05:40:00.000Z', minutes: 35, reportedAt: '2026-11-25T06:10:00.000Z', appVersion: '1.0.16', error: ''}
];

try {
  app = await bootBuiltApp({members}, {tls: true});
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  async function open(memberId, {viewport = SIZES.desktop, english = false, answer = {status: 200, body: {serverTime: '2026-11-25T06:15:00.000Z', stuck: STUCK}}} = {}) {
    const touch = viewport.width < 1100;
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: touch, isMobile: viewport.width < 700});
    const asked = [];
    await context.route('**/api/device-status?alerts=1', route => { asked.push(route.request().url()); route.fulfill({status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body)}); });
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    await context.addInitScript(english => { try { localStorage.setItem('yr-language', english ? 'en' : 'ar'); } catch { /* storage unavailable */ } }, english);
    const page = await context.newPage();
    page.setDefaultTimeout(25000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    await page.goto(app.origin + '/');
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('.workspace-notices').waitFor();
    return {page, context, asked};
  }
  const settle = page => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const card = page => page.locator('.stuck-phones');
  const noSideways = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scrolling');

  // The administrator on a computer: the card, its two phones (the longest first, as the server sends), the problem and the minutes.
  let {page, context, asked} = await open('owner');
  await card(page).waitFor();
  check(await card(page).getAttribute('data-stuck-phones'), '2', 'two stopped phones');
  const text = await card(page).innerText();
  ok(text.includes('هواتف مناديب متوقفة الآن (2)') && text.includes('المسوق محمد') && text.includes('تتبع خط السير غير مفعّل على الهاتف') && text.includes('منذ 75 دقيقة'), 'the marketing officer: not enabled, for 75 minutes');
  ok(text.includes('المندوب أحمد') && text.includes('خدمة الموقع (GPS) مغلقة على الهاتف') && text.includes('منذ 35 دقيقة'), 'the representative: GPS off, for 35 minutes');
  ok(text.includes('856 نقطة') && text.includes('تقرير يوم المندوب'), 'the phone\'s own words, and where to look');
  check(await page.locator('[data-stuck-member]').evaluateAll(items => items.map(item => item.getAttribute('data-stuck-member'))), ['rep2', 'rep1'], 'in the server\'s order');
  ok(await page.locator('[data-sonner-toast]').filter({hasText: 'هاتف مندوب متوقف'}).count() >= 1, 'the page says it once');
  check(asked.length, 1, 'asked once on opening');
  await page.reload();await card(page).waitFor();await page.waitForTimeout(800);
  check(await page.locator('[data-sonner-toast]').filter({hasText: 'هاتف مندوب متوقف'}).count(), 0, 'the same phones are not announced again after a reload');
  await settle(page);await page.screenshot({path: path.join(screenshots, 'stuck-phones-owner-desktop-ar.png')});
  await context.close();

  // A supervisor sees it too; a representative never asks; a refusal stops the asking; nothing is shown when every phone works.
  ({page, context, asked} = await open('sup', {viewport: SIZES.phone360}));
  await card(page).waitFor();ok((await card(page).innerText()).includes('المسوق محمد'), 'the supervisor sees their team\'s stopped phones');
  await context.close();
  ({page, context, asked} = await open('rep1', {viewport: SIZES.phone360}));
  await page.waitForTimeout(1500);check([asked.length, await card(page).count()], [0, 0], 'a representative never asks and sees no card');
  await context.close();
  ({page, context, asked} = await open('owner', {answer: {status: 403, body: {error: 'x'}}}));
  await page.waitForTimeout(1500);check(await card(page).count(), 0, 'a refusal shows nothing');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));await page.waitForTimeout(500);
  check(asked.length, 1, 'and stops the asking');
  await context.close();
  ({page, context, asked} = await open('mgr', {answer: {status: 200, body: {serverTime: '2026-11-25T06:15:00.000Z', stuck: []}}}));
  await page.waitForTimeout(1500);check([asked.length, await card(page).count()], [1, 0], 'every phone works: nothing shown');
  await context.close();

  // Every size, in Arabic and in English.
  for (const english of [false, true]) for (const [size, viewport] of Object.entries(SIZES)) {
    const label = size + (english ? ' en' : ' ar');
    ({page, context} = await open('owner', {viewport, english}));
    await card(page).waitFor();await settle(page);
    await noSideways(page, label);
    const box = await card(page).boundingBox();
    ok(box && box.x >= 0 && box.x + box.width <= viewport.width + 1, label + ': the card inside the screen');
    if (english) {
      const words = await card(page).innerText();
      ok(words.includes('Representative phones stopped now (2)') && words.includes('Route tracking is not enabled on the phone') && words.includes('for 75 minutes'), label + ': in English');
      const left = NAMES.concat(['تغيرت أذونات الحساب؛ محفوظ على الجهاز 856 نقطة و67 انقطاع من المنطقة السابقة.']).reduce((all, name) => all.replaceAll(name, ''), words);
      ok(!/[؀-ۿ]/.test(left), label + ': no Arabic left but the names and the phone\'s own words');
    }
    await page.screenshot({path: path.join(screenshots, 'stuck-phones-' + size + (english ? '-en' : '-ar') + '.png')});
    await context.close();
  }
  check(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks, screenshots}));
} finally {
  await browser?.close();
  await app?.stop();
}
