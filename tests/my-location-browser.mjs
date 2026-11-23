// «موقعي» on the customers' map (app/my-location.tsx, the owner, 2026-11-23: «عايز فى الخريطة اقدر اشوف انا واقف فين بالظبط») in a real
// Chromium against the BUILT release (run the build first), the device's position played by Chromium's own geolocation and OpenStreetMap's
// tiles by a flat picture (nothing leaves this machine). A representative in the Android app on a 360 px phone with the location already
// allowed: the blue dot shows by itself with «أنت هنا · الدقة ±8 م», without moving the map; «موقعي» centres the map on it; the device moves
// and the dot follows. A browser that has not given the permission: nothing is asked until «موقعي», then the refusal is said. Every size
// (320 and 360 px phones, a tablet upright and on its side, a computer) in Arabic and in English (no Arabic left but the names): no sideways
// scrolling, the button and the line inside the screen, the button at least 44 px on a touch screen. Screenshots for the report. Synthetic fixtures only: temporary SQLite, mocked sendmail.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [{id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', region: 'eastern', name: 'المشرف سالم'}, {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'}];
const NAMES = ['المشرف سالم', 'المندوب أحمد', 'مدير المبيعات', 'مدير النظام', 'مصنع الشرق', 'مصنع الخليج', 'الشرقية', 'الدمام'];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-my-location-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const SIZES = {phone320: {width: 320, height: 640}, phone360: {width: 360, height: 800}, tabletUp: {width: 768, height: 1024}, tabletSide: {width: 1024, height: 768}, desktop: {width: 1280, height: 900}};
const TILE = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8efe6"/><path d="M0 0H256V256" fill="none" stroke="#c9d6c5"/></svg>';
const HERE = {latitude: 26.4207, longitude: 50.0888, accuracy: 8};

try {
  app = await bootBuiltApp({members}, {tls: true});
  const now = new Date().toISOString();
  const insert = (id, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,'الرئيسي',?,?,?,1,'fixture')").bind(id, 'customer', null, 'rep1', JSON.stringify(data), now, now).run();
  await insert('c1', {name: 'مصنع الشرق', region: 'الشرقية', city: 'الدمام', phone: '0551111111', contact: 'م', customerKind: 'مصنع', customerStatus: 'نشط', latitude: 26.43, longitude: 50.1});
  await insert('c2', {name: 'مصنع الخليج', region: 'الشرقية', city: 'الدمام', phone: '0552222222', contact: 'م', customerKind: 'مصنع', customerStatus: 'نصف نشط', location: '26.40, 50.05'});
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  async function open(memberId, {viewport = SIZES.phone360, english = false, inApp = false, allowed = true} = {}) {
    const touch = viewport.width < 1100;
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: touch, isMobile: viewport.width < 700, geolocation: HERE, permissions: allowed ? ['geolocation'] : []});
    await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({status: 200, contentType: 'image/svg+xml', body: TILE}));
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    await context.addInitScript(english => { try { localStorage.setItem('yr-language', english ? 'en' : 'ar'); } catch { /* storage unavailable */ } }, english);
    const page = await context.newPage();
    page.setDefaultTimeout(25000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (inApp) await installNativeBridge(page, {memberId, regionScope: 'eastern'});
    await page.goto(app.origin + '/#map');
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('.cm-shell').waitFor();
    await page.locator('.cm-canvas.leaflet-container').waitFor();
    return page;
  }
  const settle = page => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const shot = async (page, label) => { await page.waitForFunction(() => !document.querySelector('.leaflet-zoom-anim')); await page.waitForTimeout(400); await settle(page); await page.screenshot({path: path.join(screenshots, label + '.png'), fullPage: false}); };
  const button = page => page.locator('.cm-locate');
  const line = page => page.locator('[data-my-location-line]');
  // The blue dot as drawn: the centre of the blue pixels of its pane's canvas, on the page; null when nothing blue is drawn.
  const dot = page => page.evaluate(() => {
    const canvas = document.querySelector('.leaflet-cmMyLocation-pane canvas');if (!canvas) return null;
    const box = canvas.getBoundingClientRect(), context = canvas.getContext('2d'), {width, height} = canvas, data = context.getImageData(0, 0, width, height).data;
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; if (data[i + 3] > 240 && Math.abs(data[i] - 26) < 12 && Math.abs(data[i + 1] - 115) < 12 && Math.abs(data[i + 2] - 232) < 12) { sx += x; sy += y; n++; } }
    if (!n) return null;
    return {x: box.left + sx / n * box.width / width, y: box.top + sy / n * box.height / height};
  });
  const mapCentre = page => page.evaluate(() => { const box = document.querySelector('.cm-canvas').getBoundingClientRect(); return {x: box.left + box.width / 2, y: box.top + box.height / 2}; });
  const near = (a, b, px = 3) => !!a && !!b && Math.abs(a.x - b.x) <= px && Math.abs(a.y - b.y) <= px;
  const noSideways = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scrolling');
  const inside = async (page, selector, label) => check(await page.locator(selector).evaluateAll(items => items.filter(item => { const box = item.getBoundingClientRect(); return box.width && (box.left < -1 || box.right > innerWidth + 1 || box.top < -1 || box.bottom > innerHeight + 1); }).length), 0, label + ': inside the screen');
  const arabicLeft = async (page, selector) => { let words = await page.locator(selector).innerText(); for (const name of [...NAMES].sort((a, b) => b.length - a.length)) words = words.split(name).join(''); return (words.match(/[؀-ۿ]+/g) || []).slice(0, 8); };

  // ---- 1. The representative in the Android app on a 360 px phone, the location already allowed.
  const rep = await open('rep1', {inApp: true});
  await line(rep).filter({hasText: 'أنت هنا'}).waitFor();
  check(await line(rep).innerText(), 'أنت هنا · الدقة ±8 م', 'the dot shows by itself: where and how exact');
  check([await button(rep).getAttribute('aria-label'), await button(rep).getAttribute('data-my-location')], ['موقعي', 'shown'], 'the button «موقعي», marked as showing');
  await rep.waitForFunction(() => !!document.querySelector('.leaflet-cmMyLocation-pane canvas'));
  const before = await dot(rep), centre = await mapCentre(rep);
  ok(!near(before, centre, 20), 'shown without moving the map: the map stays on the customers, not on the dot');
  await shot(rep, 'my-location-rep-auto-360');
  await button(rep).tap();
  await rep.waitForFunction(() => !document.querySelector('.leaflet-zoom-anim'));
  await rep.waitForTimeout(500);
  const centred = await dot(rep);
  ok(near(centred, await mapCentre(rep)), '«موقعي»: the map is centred on the dot (' + JSON.stringify(centred) + ')');
  await shot(rep, 'my-location-rep-centred-360');
  await rep.context().setGeolocation({latitude: 26.4212, longitude: 50.0896, accuracy: 25});
  await line(rep).filter({hasText: '±25'}).waitFor();
  await rep.waitForTimeout(300);
  const moved = await dot(rep);
  ok(moved && !near(moved, centred, 2) && moved.x > centred.x && moved.y < centred.y, 'the device moves north-east: the dot follows, the map stays');
  check(await line(rep).innerText(), 'أنت هنا · الدقة ±25 م', 'and the line says the new accuracy');
  await rep.context().close();

  // ---- 2. A browser that has not given the permission: nothing is asked until «موقعي», then the refusal is said.
  const sup = await open('sup', {viewport: SIZES.desktop, allowed: false});
  await sup.waitForTimeout(800);
  check([await line(sup).count(), await button(sup).getAttribute('data-my-location')], [0, 'off'], 'not allowed: no line and no dot until «موقعي»');
  await button(sup).click();
  await line(sup).filter({hasText: 'إذن الموقع'}).waitFor();
  check(await line(sup).innerText(), 'إذن الموقع غير مفعّل. فعّله من إعدادات تطبيق يورست أو المتصفح، ثم اضغط «موقعي».', 'refused: said, and how to allow it');
  check(await dot(sup), null, 'and no dot');
  await shot(sup, 'my-location-refused-desktop');
  await sup.context().grantPermissions(['geolocation']);
  await button(sup).click();
  await line(sup).filter({hasText: 'أنت هنا'}).waitFor();
  await sup.waitForFunction(() => !document.querySelector('.leaflet-zoom-anim'));await sup.waitForTimeout(500);
  ok(near(await dot(sup), await mapCentre(sup)), 'allowed afterwards: «موقعي» again shows the dot and centres the map');
  await sup.context().close();

  // ---- 3. Every size, in Arabic and in English.
  for (const english of [false, true]) for (const [size, viewport] of Object.entries(SIZES)) {
    const tag = size + (english ? '-en' : '-ar'), page = await open('rep1', {viewport, english, inApp: viewport.width < 1100});
    await line(page).filter({hasText: english ? 'You are here' : 'أنت هنا'}).waitFor();
    await button(page).click();
    await page.waitForFunction(() => !document.querySelector('.leaflet-zoom-anim'));await page.waitForTimeout(400);
    await noSideways(page, tag);
    await inside(page, '.cm-locate, [data-my-location-line]', tag + ': the button and the line');
    if (viewport.width < 1100) check(await button(page).evaluate(item => item.getBoundingClientRect().height >= 44 && item.getBoundingClientRect().width >= 44), true, tag + ': the button at least 44 px');
    check(await button(page).getAttribute('aria-label'), english ? 'My location' : 'موقعي', tag + ': the button named');
    if (english) check(await arabicLeft(page, '.cm-search-area'), [], tag + ': no Arabic left above the map');
    check(await line(page).innerText(), english ? 'You are here · accuracy ±8 m' : 'أنت هنا · الدقة ±8 م', tag + ': the line');
    // The line never covers the search box or the map's buttons.
    check(await page.evaluate(() => { const a = document.querySelector('[data-my-location-line]').getBoundingClientRect(); return [...document.querySelectorAll('.cm-search-box, .cm-map-controls')].some(item => { const b = item.getBoundingClientRect(); return a.top < b.bottom - 1 && a.bottom > b.top + 1 && a.left < b.right && a.right > b.left; }); }), false, tag + ': the line covers neither the search nor the buttons');
    await shot(page, 'my-location-' + tag);
    await page.context().close();
  }
  check(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks, screenshots}));
} finally {
  await browser?.close();
  await app?.stop();
}
