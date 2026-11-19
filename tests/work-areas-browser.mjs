// «خريطة المصانع» (app/customer-map.tsx, app/work-area-map.tsx, the port of GSCO 2.13.81 and 2.13.82) in a real Chromium against the BUILT
// release (run the build first), Overpass played by a local stand-in the server asks (YR_OVERPASS_URL) and OpenStreetMap's tiles by a flat
// picture (nothing leaves this machine). A representative in the Android app on a 360 px phone: the colour key with «بيانات ناقصة»، «شارع بلا
// عملاء» and «منطقة العمل», his estimated area (500 m around his two customers that are not «خامل») and its count of street pieces with no
// customer, the card of a customer whose data is incomplete naming what is missing, «إخفاء علامات الشوارع» kept on the device after a reload,
// and without a connection «الشوارع غير متاحة دون اتصال.». The sales manager on a computer: chooses the representative in the panel, draws an
// area of four corners on the map, saves it (the database holds it), sees it described, deletes it in two steps. The supervisor reads the area
// and has no drawing tools. Every screen at 320 and 360 px phones, a tablet upright and on its side and a computer, in Arabic and in English (no
// Arabic left but the names), without sideways scrolling, the colour key inside the screen, every button of the area at least 44 px high on a
// touch screen. Screenshots for the report. Synthetic fixtures only: temporary SQLite, mocked sendmail.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [{id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', region: 'eastern', name: 'المشرف سالم'}, {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'},
  {id: 'mk1', role: 'marketing', sup: 'sup', region: 'eastern', name: 'مسؤول التسويق'}];
const NAMES = ['المشرف سالم', 'المندوب أحمد', 'مسؤول التسويق', 'مدير المبيعات', 'مدير النظام', 'مصنع الشرق', 'مصنع الخليج', 'مصنع خامل', 'مصنع آخر', 'الشرقية', 'الدمام'];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-work-areas-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const SIZES = {phone320: {width: 320, height: 640}, phone360: {width: 360, height: 800}, tabletUp: {width: 768, height: 1024}, tabletSide: {width: 1024, height: 768}, desktop: {width: 1280, height: 900}};
const TILE = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8efe6"/><path d="M0 0H256V256" fill="none" stroke="#c9d6c5"/></svg>';

// The stand-in for Overpass: streets beside the customers and across empty land around them.
const asked = [];
const lines = [[[26.42973, 50.096], [26.42973, 50.104]], [[26.4335, 50.0985], [26.4335, 50.1015]], [[26.427, 50.097], [26.436, 50.106]]];
const overpass = createServer((request, response) => {
  request.resume();request.on('end', () => {
    asked.push(request.headers['user-agent']);
    response.writeHead(200, {'Content-Type': 'application/json'});
    response.end(JSON.stringify({version: 0.6, elements: lines.map((line, i) => ({type: 'way', id: i + 1, tags: {highway: 'residential', name: 'شارع الاختبار ' + (i + 1), 'name:en': 'Test street ' + (i + 1)}, geometry: line.map(([lat, lon]) => ({lat, lon}))}))}));
  });
});
overpass.listen(0, '127.0.0.1');await once(overpass, 'listening');

try {
  app = await bootBuiltApp({members}, {tls: true, env: {YR_OVERPASS_URL: 'http://127.0.0.1:' + overpass.address().port + '/api/interpreter'}});
  const now = new Date().toISOString();
  const insert = (id, assignedTo, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,'الرئيسي',?,?,?,1,'fixture')").bind(id, 'customer', null, assignedTo, JSON.stringify({branch: 'الرئيسي', assignedTo, ...data}), now, now).run();
  await insert('c1', 'rep1', {name: 'مصنع الشرق', region: 'الشرقية', city: 'الدمام', phone: '0551111111', contact: 'م', customerKind: 'مصنع', customerStatus: 'نشط', latitude: 26.43, longitude: 50.1});
  await insert('c2', 'rep1', {name: 'مصنع الخليج', region: 'الشرقية', customerStatus: 'نصف نشط', location: '26.432, 50.103'});
  await insert('c3', 'rep1', {name: 'مصنع خامل', region: 'الشرقية', city: 'الدمام', phone: '0553333333', contact: 'م', customerKind: 'مصنع', customerStatus: 'خامل', location: '26.44, 50.11'});
  await insert('c4', 'mk1', {name: 'مصنع آخر', region: 'الشرقية', city: 'الدمام', phone: '0554444444', contact: 'م', customerKind: 'مصنع', customerStatus: 'نشط', location: '26.4335, 50.1'});
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});
  async function open(memberId, {viewport = SIZES.phone360, english = false, inApp = false} = {}) {
    const touch = viewport.width < 1100;
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: touch, isMobile: viewport.width < 700, geolocation: {latitude: 26.43, longitude: 50.1, accuracy: 8}, permissions: ['geolocation']});
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
  // A zoom of the map animates its canvas: the picture is taken once it is still.
  const shot = async (page, label) => { await page.waitForFunction(() => !document.querySelector('.leaflet-zoom-anim')); await page.waitForTimeout(400); await settle(page); await page.screenshot({path: path.join(screenshots, label + '.png'), fullPage: false}); };
  const noSideways = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scrolling');
  // sideways: nothing runs off the left or the right (a panel that scrolls up and down may hold more than the screen's height).
const inside = async (page, selector, label, {sideways = false} = {}) => check(await page.locator(selector).evaluateAll((items, sideways) => items.filter(item => { const box = item.getBoundingClientRect(); return box.width && (box.left < -1 || box.right > innerWidth + 1 || !sideways && (box.top < -1 || box.bottom > innerHeight + 1)); }).length, sideways), 0, label + (sideways ? ': nothing off the sides' : ': inside the screen'));
  const tall = async (page, selector, label) => check(await page.locator(selector).evaluateAll(items => items.filter(item => { const box = item.getBoundingClientRect(); return box.height && box.height < 44; }).map(item => item.textContent.trim().slice(0, 30))), [], label + ': every button at least 44 px high');
  const arabicLeft = async (page, selector) => { let words = await page.locator(selector).innerText(); for (const name of [...NAMES].sort((a, b) => b.length - a.length)) words = words.split(name).join(''); return (words.match(/[؀-ۿ]+/g) || []).slice(0, 8); };
  const legend = page => page.locator('[data-map-legend]');
  // The colour key never covers the search box or the toolbar (on a short map it scrolls inside its box).
  const clear = async (page, label) => check(await page.evaluate(() => { const key = document.querySelector('[data-map-legend]')?.getBoundingClientRect(), bar = [...document.querySelectorAll('.cm-search-box, .cm-map-controls')].map(item => item.getBoundingClientRect()); return !!key && bar.some(box => key.top < box.bottom && key.bottom > box.top && key.left < box.right && key.right > box.left); }), false, label + ': the colour key leaves the search and the toolbar uncovered');
  const areaLines = page => page.locator('[data-work-area-lines]');

  // ---- 1. The representative in the Android app on a 360 px phone.
  const rep = await open('rep1', {inApp: true});
  await areaLines(rep).filter({hasText: 'جزء شارع بلا عملاء'}).waitFor();
  const repLines = await areaLines(rep).innerText();
  ok(repLines.includes('منطقة تقديرية: 500 م حول عملاء المندوب (2)'), 'his estimated area: 500 m around his two customers that are not «خامل»');
  ok(/\d+ جزء شارع بلا عملاء/.test(repLines), 'the count of street pieces with no customer');
  check(await legend(rep).locator('[data-legend-key]').evaluateAll(items => items.map(item => item.getAttribute('data-legend-key'))), ['incomplete', 'street', 'area'], 'the colour key: missing data, street with no customer, work area');
  ok((await legend(rep).innerText()).includes('بيانات ناقصة'), 'named in Arabic');
  check(asked.length > 0 && asked.every(agent => /^Yourrest-CRM/.test(agent)), true, 'the streets were asked by the server only');
  await rep.locator('.cm-search-box input').fill('مصنع الخليج');
  await rep.locator('.cm-search-result').first().click();
  const missing = rep.locator('[data-customer-missing]');
  await missing.waitFor();
  check(await missing.innerText(), 'بيانات ناقصة: المدينة، الهاتف، اسم المسؤول، نوع العميل', 'the card names what is missing, as the evaluation counts it');
  await shot(rep, 'rep-app-360-incomplete-card');
  await rep.locator('.cm-selected-card .cm-close').click();
  await noSideways(rep, 'rep 360');await inside(rep, '[data-map-legend]', 'rep 360 legend');await clear(rep, 'rep 360');await tall(rep, '[data-street-toggle]', 'rep 360 street switch');
  await shot(rep, 'rep-app-360-area');
  await rep.locator('[data-street-toggle]').click();
  check(await rep.evaluate(() => localStorage.getItem('yourrest.map.hideStreets')), '1', '«إخفاء علامات الشوارع» kept on the device');
  await rep.reload();await rep.locator('.cm-shell').waitFor();await legend(rep).waitFor();
  check(await rep.locator('[data-street-toggle]').getAttribute('aria-pressed'), 'true', 'and still on after a reload');
  ok(!(await areaLines(rep).innerText()).includes('جزء شارع بلا عملاء'), 'hidden marks are not counted under the map');
  await rep.context().setOffline(true);
  await areaLines(rep).filter({hasText: 'الشوارع غير متاحة دون اتصال.'}).waitFor();
  checks++;
  await rep.context().setOffline(false);
  await rep.context().close();

  // ---- 2. The sales manager on a computer: chooses the representative, draws, saves, deletes.
  const mgr = await open('mgr', {viewport: SIZES.desktop});
  const panel = async () => { if (!await mgr.locator('#customer-map-panel.is-open').count()) await mgr.locator('.cm-map-controls .cm-control').first().click(); await mgr.locator('[data-work-area-section]').waitFor(); };
  await panel();
  check(await mgr.locator('[data-work-area-rep] option').evaluateAll(options => options.map(option => option.value)), ['', 'rep1', 'mk1'], 'the representatives of his team, with or without customers, by name');
  await mgr.locator('[data-work-area-rep] select').selectOption('rep1');
  await areaLines(mgr).filter({hasText: 'جزء شارع بلا عملاء'}).waitFor();
  await shot(mgr, 'manager-desktop-area');
  await panel();
  await mgr.locator('[data-work-area-draw]').click();
  await mgr.locator('.cm-area-bar').waitFor();
  check(await legend(mgr).count(), 0, 'while drawing the colour key gives the map its room');
  const box = await mgr.locator('.cm-canvas').boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  for (const [dx, dy] of [[-120, -80], [120, -80], [120, 80], [-120, 80]]) await mgr.mouse.click(cx + dx, cy + dy);
  check(await mgr.locator('[data-work-area-corners]').innerText(), 'عدد النقاط: 4', 'four corners');
  await shot(mgr, 'manager-desktop-drawing');
  await mgr.locator('[data-work-area-save]').click();
  await areaLines(mgr).filter({hasText: 'تم حفظ منطقة العمل.'}).waitFor();
  await areaLines(mgr).filter({hasText: 'منطقة عمل مرسومة'}).waitFor();
  const stored = await app.db.prepare("SELECT vertices,updated_by,version FROM crm_work_areas WHERE member_id='rep1'").first();
  check({...stored}, {vertices: 4, updated_by: 'mgr', version: 1}, 'the database holds the drawn area');
  await shot(mgr, 'manager-desktop-drawn');
  await panel();
  await mgr.locator('[data-work-area-delete]').click();
  await mgr.locator('[data-work-area-confirm-delete]').click();
  // The panel stays open over the legend: its own lines say it.
  await mgr.locator('[data-work-area-section]').filter({hasText: 'تم حذف منطقة العمل.'}).waitFor();
  check(await app.db.prepare("SELECT COUNT(*) AS n FROM crm_work_areas").first('n'), 0, 'deleted in two steps');
  await noSideways(mgr, 'manager desktop');
  await mgr.context().close();

  // ---- 3. The supervisor reads the area and draws nothing.
  const sup = await open('sup', {viewport: SIZES.tabletSide});
  await sup.locator('.cm-map-controls .cm-control').first().click();
  await sup.locator('[data-work-area-rep] select').selectOption('rep1');
  await areaLines(sup).filter({hasText: 'منطقة تقديرية'}).waitFor();
  await sup.locator('.cm-map-controls .cm-control').first().click();
  check(await sup.locator('[data-work-area-draw], [data-work-area-tools]').count(), 0, 'no drawing tools for a supervisor');
  await sup.context().close();

  // ---- 4. Every size, Arabic and English: the representative in the app, the manager in a browser.
  for (const [label, viewport] of Object.entries(SIZES)) for (const english of [false, true]) {
    const tag = label + (english ? '-en' : '-ar');
    const page = await open('rep1', {viewport, english, inApp: true});
    await areaLines(page).filter({hasText: english ? 'street pieces with no customer' : 'جزء شارع بلا عملاء'}).waitFor();
    await noSideways(page, 'rep ' + tag);await inside(page, '[data-map-legend]', 'rep ' + tag + ' legend');await clear(page, 'rep ' + tag);
    if (viewport.width < 1100) await tall(page, '[data-street-toggle]', 'rep ' + tag);
    if (english) { check(await arabicLeft(page, '[data-map-legend]'), [], 'rep ' + tag + ': the legend has no Arabic left'); ok((await legend(page).innerText()).includes('Missing data') && (await legend(page).innerText()).includes('Hide street marks'), 'rep ' + tag + ': the key in English'); }
    await shot(page, 'rep-' + tag);
    await page.context().close();
    const manager = await open('mgr', {viewport, english});
    await manager.locator('.cm-map-controls .cm-control').first().click();
    await manager.locator('[data-work-area-rep] select').selectOption('rep1');
    await areaLines(manager).filter({hasText: english ? 'street pieces with no customer' : 'جزء شارع بلا عملاء'}).waitFor();
    await manager.locator('.cm-map-controls .cm-control').first().click();
    await manager.locator('[data-work-area-draw]').waitFor();
    await noSideways(manager, 'manager panel ' + tag);await inside(manager, '[data-work-area-section] button, [data-work-area-section] select', 'manager panel ' + tag, {sideways: true});
    if (viewport.width < 1100) await tall(manager, '[data-work-area-section] button, [data-work-area-section] select', 'manager panel ' + tag);
    if (english) check(await arabicLeft(manager, '[data-work-area-section]'), [], 'manager ' + tag + ': the area section has no Arabic left');
    await shot(manager, 'manager-panel-' + tag);
    await manager.locator('[data-work-area-draw]').scrollIntoViewIfNeeded();await inside(manager, '[data-work-area-draw]', 'manager panel ' + tag + ', «رسم منطقة العمل» scrolled to');
    await manager.locator('[data-work-area-draw]').click();
    await manager.locator('.cm-area-bar').waitFor();
    await noSideways(manager, 'manager drawing ' + tag);await inside(manager, '.cm-area-bar button', 'manager drawing ' + tag);
    if (viewport.width < 1100) await tall(manager, '.cm-area-bar button', 'manager drawing ' + tag);
    if (english) check(await arabicLeft(manager, '.cm-area-bar'), [], 'manager ' + tag + ': the drawing bar has no Arabic left');
    await shot(manager, 'manager-drawing-' + tag);
    await manager.context().close();
  }
  check(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks, screenshots}));
} finally {
  await browser?.close();
  await app?.stop();
  overpass.close();
}
