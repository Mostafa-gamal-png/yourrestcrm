// «نسخة تطبيق أندرويد جاهزة للتجربة» (app/app-release-pilot.tsx, lib/app-release-approval.ts; 2026-11-25, item 2 of «اعمل التلاتة») in a
// real Chromium against the BUILT release (run the build first). The pilot route is answered by the page's own request route, so the test
// does not depend on which pilots the build ships (tests/app-release-approval-unit.mjs checks the route and the served release). The owner
// sees the card with the version, its notes and the download of its file; «اعتماد التحديث للجميع» asks once more before it sends the
// approval of that very version, a refusal is shown with its reason and nothing else changes; an administrator over some regions, a sales
// manager and a representative never ask and see nothing; no pilot, nothing shown. Every size (320 and 360 px phones, a tablet upright and
// on its side, a computer) in Arabic and in English: no sideways scrolling, the card and its buttons inside the screen, no Arabic left in
// English. Synthetic only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [{id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'admin2', role: 'admin', region: 'eastern', name: 'مدير المنطقة'}, {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', region: 'eastern', name: 'المشرف سالم'}, {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'}];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-release-pilot-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const SIZES = {phone320: {width: 320, height: 640}, phone360: {width: 360, height: 800}, tabletUp: {width: 768, height: 1024}, tabletSide: {width: 1024, height: 768}, desktop: {width: 1280, height: 900}};
const PILOT = {versionName: '9.0.1', versionCode: 901, apkPath: '/downloads/yourrest-crm-android-v9.0.1-901.apk', sizeBytes: 9_437_184,
  notes: {ar: ['تحسين تجريبي في تسجيل خط السير.', 'لا يطلب التحديث أذونات جديدة.'], en: ['A trial improvement to route recording.', 'The update asks for no new permission.']}};
const SERVED = {versionName: '9.0.0', versionCode: 900};

try {
  app = await bootBuiltApp({members}, {tls: true});
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  async function open(memberId, {viewport = SIZES.desktop, english = false, pilot = PILOT, post = {status: 200, body: {ok: true, served: {versionName: PILOT.versionName, versionCode: PILOT.versionCode}}}} = {}) {
    const touch = viewport.width < 1100;
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: touch, isMobile: viewport.width < 700});
    const asked = [], posted = [];
    let current = pilot;
    await context.route('**/api/app-update/pilot', route => {
      const request = route.request();
      if (request.method() === 'POST') {
        posted.push(request.postDataJSON());
        if (post.status === 200) current = null;
        return route.fulfill({status: post.status, contentType: 'application/json', body: JSON.stringify(post.body)});
      }
      asked.push(request.url());
      route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({pilot: current, served: SERVED, approval: null})});
    });
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    await context.addInitScript(english => { try { localStorage.setItem('yr-language', english ? 'en' : 'ar'); } catch { /* storage unavailable */ } }, english);
    const page = await context.newPage();
    page.setDefaultTimeout(25000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    await page.goto(app.origin + '/');
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('.workspace-notices').waitFor();
    return {page, context, asked, posted};
  }
  const settle = page => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const card = page => page.locator('.release-pilot');
  const inside = async (locator, viewport, label) => { const box = await locator.boundingBox(); ok(box && box.x >= 0 && box.x + box.width <= viewport.width + 1, label); };

  // The owner on a computer: the card, the version, the notes, the download of the pilot's own file.
  let {page, context, asked, posted} = await open('owner');
  await card(page).waitFor();
  check(await card(page).getAttribute('data-release-pilot'), '901', 'the pilot waiting');
  const text = await card(page).innerText();
  ok(text.includes('نسخة تطبيق أندرويد 9.0.1 جاهزة للتجربة') && text.includes('جرّب التطبيق 10 دقائق') && text.includes('تحسين تجريبي في تسجيل خط السير.'), 'the version, how to try it, its notes');
  const download = card(page).getByRole('link', {name: /تنزيل النسخة للتجربة/});
  check([await download.getAttribute('href'), await download.getAttribute('download')], [PILOT.apkPath, 'Yourrest-CRM-9.0.1.apk'], 'the download is the pilot\'s own file');
  ok((await download.innerText()).includes('9.0 MB'), 'with its size');
  check(asked.length, 1, 'asked once on opening');
  // «اعتماد التحديث للجميع» asks once more; «إلغاء» sends nothing.
  await card(page).getByRole('button', {name: 'اعتماد التحديث للجميع'}).click();
  ok((await card(page).innerText()).includes('هل جرّبت النسخة على هاتف حقيقي؟'), 'asked once more');
  await card(page).getByRole('button', {name: 'إلغاء'}).click();
  check([posted.length, await card(page).getByRole('button', {name: 'اعتماد التحديث للجميع'}).count()], [0, 1], 'cancelled: nothing sent');
  await settle(page);await page.screenshot({path: path.join(screenshots, 'release-pilot-owner-desktop-ar.png')});
  await card(page).getByRole('button', {name: 'اعتماد التحديث للجميع'}).click();
  await card(page).getByRole('button', {name: 'نعم، اعتمدها للجميع'}).click();
  await card(page).waitFor({state: 'detached'});
  check(posted, [{action: 'approve', versionCode: 901}], 'the approval of that very version, sent once');
  ok(await page.locator('[data-sonner-toast]').filter({hasText: 'اعتُمدت النسخة 9.0.1'}).count() >= 1, 'the owner is told every phone is now asked');
  await context.close();

  // A refusal is shown with its reason; the card stays.
  ({page, context, posted} = await open('owner', {viewport: SIZES.phone360, post: {status: 409, body: {error: 'تغيّر اعتماد التحديث للتو. حدّث الصفحة وراجع قبل الاعتماد.'}}}));
  await card(page).waitFor();
  await card(page).getByRole('button', {name: 'اعتماد التحديث للجميع'}).click();
  await card(page).getByRole('button', {name: 'نعم، اعتمدها للجميع'}).click();
  await card(page).getByRole('alert').filter({hasText: 'تغيّر اعتماد التحديث للتو'}).waitFor();
  check([posted.length, await card(page).count()], [1, 1], 'refused: the reason shown, the card stays');
  await context.close();

  // Nobody else asks or sees it; no pilot, nothing shown.
  for (const id of ['admin2', 'mgr', 'sup', 'rep1']) {
    ({page, context, asked} = await open(id, {viewport: SIZES.phone360}));
    await page.waitForTimeout(1200);
    check([asked.length, await card(page).count()], [0, 0], id + ' never asks and sees no card');
    await context.close();
  }
  ({page, context, asked} = await open('owner', {pilot: null}));
  await page.waitForTimeout(1500);check([asked.length, await card(page).count()], [1, 0], 'no pilot: nothing shown');
  await context.close();

  // Every size, in Arabic and in English, with the confirmation open (the widest state).
  for (const english of [false, true]) for (const [size, viewport] of Object.entries(SIZES)) {
    const label = size + (english ? ' en' : ' ar');
    ({page, context} = await open('owner', {viewport, english}));
    await card(page).waitFor();
    await card(page).getByRole('button', {name: english ? 'Approve the update for everyone' : 'اعتماد التحديث للجميع'}).click();
    await settle(page);
    check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scrolling');
    await inside(card(page), viewport, label + ': the card inside the screen');
    for (const button of await card(page).locator('a, button').all()) await inside(button, viewport, label + ': every action inside the screen');
    if (english) {
      const words = await card(page).innerText();
      ok(words.includes('Android app version 9.0.1 is ready to try') && words.includes('Yes, approve for everyone') && words.includes('A trial improvement to route recording.'), label + ': in English');
      ok(!/[؀-ۿ]/.test(words.replaceAll('«', '').replaceAll('»', '')), label + ': no Arabic left');
    }
    await page.screenshot({path: path.join(screenshots, 'release-pilot-' + size + (english ? '-en' : '-ar') + '.png')});
    await context.close();
  }
  check(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks, screenshots}));
} finally {
  await browser?.close();
  await app?.stop();
}
