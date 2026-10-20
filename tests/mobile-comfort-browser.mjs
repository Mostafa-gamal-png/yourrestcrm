// Phone and tablet comfort in a real Chromium against the BUILT release (run `pnpm build` first): no page widens beyond the screen,
// every control a finger must hit is at least 40px, no visible text is under 12px, the customer sheet has a 44px close button at the
// reading end with its tabs in one row that follows the reading direction, and the scripts and styles are served compressed.
// Synthetic isolated fixtures only: temporary SQLite, mocked sendmail, no production data, no device.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'سعد مدير المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'sm', name: 'ماجد المشرف'},
  {id: 'rep', role: 'rep', sup: 'sup', name: 'أحمد المندوب', region: 'eastern'}
];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-comfort-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const SCREENS = [{label: 'phone-360', width: 360, height: 800}, {label: 'phone-412', width: 412, height: 860}, {label: 'tablet-768', width: 768, height: 1100}, {label: 'tablet-820', width: 820, height: 1100}, {label: 'tablet-landscape-1024', width: 1024, height: 768}];
const VIEWS = {rep: ['customer', 'activity', 'followup', 'targets', 'map'], sm: ['dashboard', 'customer', 'activity', 'quote', 'targets']};

// What the audit reads from a rendered page: width past the screen, controls under 40px, text under 12px (the map's legal credit is excluded), titles squeezed onto two lines.
const measure = () => {
  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0' && r.bottom > 0 && r.right > 0 && r.left < innerWidth; };
  const name = el => (el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '') + ' ' + (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 24)).trim();
  const legal = el => !!el.closest('.leaflet-control-attribution');
  const small = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=combobox], [role=checkbox], [role=switch], summary')]
    .filter(visible).filter(el => !legal(el)).filter(el => { const r = el.getBoundingClientRect(); return Math.min(r.width, r.height) < 40; }).map(el => name(el) + ' ' + Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height));
  const tiny = [...document.querySelectorAll('body *')].filter(el => [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim()) && visible(el) && !legal(el) && !el.closest('.sr-only') && !el.classList.contains('sr-only'))
    .filter(el => parseFloat(getComputedStyle(el).fontSize) < 12).map(el => name(el) + ' ' + getComputedStyle(el).fontSize);
  const wrapped = [...document.querySelectorAll('.page-heading h1')].filter(visible).filter(el => el.getBoundingClientRect().height > 1.4 * parseFloat(getComputedStyle(el).lineHeight)).map(el => el.innerText.trim());
  return {overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, small, tiny, wrapped};
};

try {
  app = await bootBuiltApp({members}, {tls: true});
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  const now = new Date().toISOString();
  const customer = (id, name, assignedTo, extra = {}) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, assignedTo, JSON.stringify({name, code: id, region: 'الشرقية', city: 'الدمام', phone: '0551234567', contact: 'م', branch: 'الرئيسي', assignedTo, ...extra}), now, now).run();
  await customer('c1', 'مصنع الأمل للبلاستيك', 'rep'); await customer('c2', 'مصنع النور للخرسانة', 'rep'); await customer('c3', 'مؤسسة البناء الحديث', 'rep');
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('m1','factory','c1','rep','الرئيسي',?,?,?,1,'fixture')")
    .bind(JSON.stringify({name: 'خط الأمل', recordType: 'machine', quantity: 1, machineBrand: 'Besser', machineModel: 'V1', machineType: 'stationary', modelCondition: 'old', bushingCondition: 'new'}), now, now).run();

  async function open(memberId, screen) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport: {width: screen.width, height: screen.height}, isMobile: true, hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', geolocation: {latitude: 26.437341, longitude: 50.034499, accuracy: 8}, permissions: ['geolocation']});
    await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#dde7ea"/></svg>'}));
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (memberId === 'rep') await installNativeBridge(page, {memberId: 'rep', regionScope: 'eastern'});
    return page;
  }
  const settle = page => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const goTo = async (page, view) => { await page.goto(app.origin + '/?p=' + Math.random().toString(36).slice(2) + '#' + view); await page.locator('.workspace').waitFor(); await page.waitForTimeout(700); await settle(page); };

  // ---- scripts and styles are served compressed: the first load of a phone is a fraction of the raw bytes
  {
    const page = await open('rep', SCREENS[0]);
    const statics = [];
    page.on('response', async response => { const url = response.url(); if (/\/_next\/static\/.+\.(js|css)$/.test(url)) statics.push({url, encoding: response.headers()['content-encoding'] || '', raw: (await response.body().catch(() => Buffer.alloc(0))).length}); });
    await page.goto(app.origin + '/'); await page.locator('.workspace').waitFor(); await page.waitForTimeout(1500);
    ok(statics.length >= 4, 'the app loads its scripts and styles');
    check(statics.filter(item => item.raw > 20000 && !/^(br|zstd|gzip)$/.test(item.encoding)).map(item => item.url), [], 'every sizeable script and stylesheet is served compressed');
    await page.context().close();
  }

  // ---- every screen: nothing wider than the screen, no control under 40px, no text under 12px
  for (const [memberId, key] of [['rep', 'rep'], ['sm', 'sm']]) for (const screen of SCREENS) {
    const page = await open(memberId, screen);
    for (const view of VIEWS[key]) {
      await goTo(page, view);
      const result = await page.evaluate(measure);
      const where = memberId + ' ' + screen.label + ' #' + view;
      check(result.overflow <= 0, true, where + ' does not widen beyond the screen (' + result.overflow + 'px)');
      check(result.small, [], where + ' has no control under 40px');
      check(result.tiny, [], where + ' has no text under 12px');
      if (screen.width >= 768) check(result.wrapped, [], where + ' keeps its title on one line beside the header actions');
    }
    await page.context().close();
  }

  // ---- the customer sheet: a 44px close button at the reading end, tabs in one row that follow the reading direction
  for (const [memberId, screen] of [['rep', SCREENS[0]], ['sm', SCREENS[0]], ['sm', SCREENS[3]], ['rep', SCREENS[2]]]) {
    const page = await open(memberId, screen);
    await goTo(page, 'customer');
    await page.getByRole('button', {name: /^بيانات العميل/}).or(page.getByRole('button', {name: 'البيانات'})).first().click();
    const sheet = page.locator('[data-slot=sheet-content]');
    await sheet.waitFor();
    await page.waitForTimeout(400);
    const info = await sheet.evaluate(node => {
      const close = node.querySelector('[data-slot=sheet-close]').getBoundingClientRect(), box = node.getBoundingClientRect();
      const tabs = [...node.querySelectorAll('[role=tab]')].map(tab => tab.getBoundingClientRect());
      return {closeW: Math.round(close.width), closeH: Math.round(close.height), closeAtEnd: (getComputedStyle(node).direction === 'rtl') === (close.left - box.left < box.right - close.right), direction: getComputedStyle(node).direction, listDir: getComputedStyle(node.querySelector('[data-slot=tabs]')).direction,
        oneRow: tabs.every(rect => Math.abs(rect.top - tabs[0].top) < 3), tabsHeight: Math.round(Math.min(...tabs.map(rect => rect.height))), firstTabAtStart: node.querySelector('[role=tab]').getBoundingClientRect().left > box.left + box.width / 2, tabCount: tabs.length,
        small: [...node.querySelectorAll('button, a[href], [role=tab], summary')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && Math.min(r.width, r.height) < 40; }).map(el => (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 20))};
    });
    const where = memberId + ' ' + screen.label + ' sheet';
    check([info.closeW >= 44, info.closeH >= 44], [true, true], where + ': the close button is at least 44px');
    check(info.direction, 'rtl', where + ' reads right to left');
    check(info.listDir, 'rtl', where + ': the tabs follow the reading direction');
    check(info.closeAtEnd, true, where + ': the close button is at the reading end, away from the title');
    check([info.oneRow, info.tabsHeight >= 44, info.firstTabAtStart], [true, true, true], where + ': the tabs sit in one row, 44px tall, the first at the reading start');
    check(info.small, [], where + ': no control under 40px');
    await settle(page);
    await page.screenshot({path: path.join(screenshots, `sheet-${memberId}-${screen.label}.png`)});
    await page.context().close();
  }

  check(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks, builtRelease: true, browser: 'chromium', productionDataUsed: false, screenshots}));
} finally {
  await browser?.close();
  await app?.stop();
}
