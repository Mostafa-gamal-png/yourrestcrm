// «تنبيه المصانع القريبة»: what a tapped notification opens, in a real Chromium against the BUILT release (run the build first), the
// Android app emulated (its user agent and bridge). A cold start loads «/#nearby=<id>» (MainActivity): the page opens «خريطة المصانع» on
// that customer's card and the address becomes «#map»; a running page is told by the event «yourrest:open-nearby-customer»: it moves to
// the map on the customer; while a sheet is open it changes nothing and says so (Arabic and English); an id outside the member's data
// (another region), an unknown or a malformed one opens nothing; a representative whose map is hidden gets the customer's own card. Phone 320 and 360, a tablet upright
// and on its side, a computer; Arabic and English; nothing scrolls sideways. Screenshots for the report. Synthetic fixtures only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [{id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sup', role: 'supervisor', region: 'central', name: 'المشرف سالم'}, {id: 'rep', role: 'rep', sup: 'sup', region: 'central', name: 'مندوب الوسطى'}, {id: 'repnomap', role: 'rep', sup: 'sup', region: 'central', name: 'مندوب بلا خريطة'}];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-nearby-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const SIZES = [['phone-320', {width: 320, height: 720}, true], ['phone-360', {width: 360, height: 800}, true], ['tablet-upright', {width: 768, height: 1024}, true], ['tablet-side', {width: 1024, height: 768}, true], ['desktop', {width: 1280, height: 900}, false]];
const NEAR = 'مصنع الأمل للبلوك', OTHER = 'مصنع النور الحديث', ELSE = 'مصنع مندوب آخر';

try {
  app = await bootBuiltApp({members}, {tls: true});
  const now = new Date().toISOString();
  const insert = (id, assignedTo, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, assignedTo, JSON.stringify({name: data.name, branch: 'الرئيسي', assignedTo, region: 'الوسطى', city: 'الرياض', customerStatus: 'نشط', phone: '0551234567', contact: 'م', code: '', ...data}), now, now).run();
  await insert('near-1', 'rep', {name: NEAR, location: '24.7136, 46.6753', latitude: 24.7136, longitude: 46.6753});
  await insert('near-2', 'rep', {name: OTHER, location: '24.7200, 46.6800', latitude: 24.72, longitude: 46.68});
  await insert('near-3', 'repnomap', {name: ELSE, location: '24.7300, 46.6900', latitude: 24.73, longitude: 46.69});
  await insert('west-1', 'sup', {name: 'مصنع في منطقة أخرى', region: 'الغربية', city: 'جدة', location: '21.5, 39.2', latitude: 21.5, longitude: 39.2});
  await app.db.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_at,updated_by) VALUES('repnomap','{}','[\"map\"]',1,?,'sup')").bind(now).run();
  const {scope} = await app.db.prepare('SELECT region_scope AS scope FROM crm_members WHERE id=?').bind('rep').first();
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});
  const cookies = {rep: await app.login('rep'), repnomap: await app.login('repnomap')};

  async function open(memberId, {english = false, viewport, touch, hash = ''}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: touch, isMobile: touch && viewport.width < 700});
    const [name, ...value] = cookies[memberId].split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    if (english) await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    await installNativeBridge(page, {memberId, regionScope: scope});
    await page.goto(app.origin + '/' + hash);
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    return page;
  }
  const shot = async (page, label) => { await page.waitForTimeout(300); await page.screenshot({path: path.join(screenshots, label + '.png'), fullPage: false}); };
  const noSideways = async (page, label) => eq(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scrolling');
  const selected = page => page.locator('.cm-selected-card h2');
  const tell = (page, id) => page.evaluate(id => window.dispatchEvent(new CustomEvent('yourrest:open-nearby-customer', {detail: {id}})), id);

  for (const [label, viewport, touch] of SIZES) for (const english of [false, true]) {
    const tag = label + '-' + (english ? 'en' : 'ar');
    // ---- A cold start from the notification: the map on the customer.
    const page = await open('rep', {english, viewport, touch, hash: '#nearby=near-1'});
    await selected(page).waitFor({state: 'visible'});
    eq((await selected(page).innerText()).trim(), NEAR, tag + ': a cold start opens the factory map on the customer the notice named');
    eq(await page.evaluate(() => location.hash), '#map', tag + ': the address becomes the map\'s');
    await noSideways(page, tag + ' (map)');
    await shot(page, 'nearby-' + tag + '-cold-start');
    // ---- A running page (the customers screen): the event moves to the map on the other customer.
    const compact = viewport.width < 1024, customerRow = () => compact ? page.locator('.customer-mobile-card').filter({hasText: NEAR}).first() : page.locator('tr').filter({hasText: NEAR}).first();
    await page.goto(app.origin + '/?running=1#customer');
    await customerRow().waitFor({state: 'visible'});
    await tell(page, 'near-2');
    await page.waitForFunction(name => document.querySelector('.cm-selected-card h2')?.textContent?.trim() === name, OTHER);
    eq(await page.evaluate(() => location.hash), '#map', tag + ': a running page goes to the map');
    eq((await selected(page).innerText()).trim(), OTHER, tag + ': on the customer the notice named');
    // ---- An id outside this member's data (another region), an unknown one or a malformed one: the card stays as it is.
    await tell(page, 'west-1'); await tell(page, 'missing-1'); await tell(page, '../x'); await tell(page, 'a b'); await page.waitForTimeout(400);
    eq((await selected(page).innerText()).trim(), OTHER, tag + ': an id outside the member\'s data, unknown or malformed opens nothing');
    // ---- A sheet open: nothing changes underneath; the person is told.
    await page.goto(app.origin + '/?sheet=1#customer');
    const row = customerRow();
    await row.waitFor({state: 'visible'});
    await (compact ? row.locator('.customer-mobile-name') : row.getByRole('button', {name: english ? 'Customer details' : 'بيانات العميل', exact: true})).click();
    await page.locator('.crm-sheet').waitFor({state: 'visible'});
    await tell(page, 'near-2');
    const toast = page.locator('[data-sonner-toast]').filter({hasText: english ? 'You are near a factory that needs a visit' : 'اقتربت من مصنع بحاجة إلى زيارة'});
    await toast.first().waitFor({state: 'visible'});
    eq((await toast.first().innerText()).includes(english ? 'Finish what you are doing, then open it from the factory map.' : 'أنهِ ما بين يديك ثم افتحه من «خريطة المصانع».'), true, tag + ': a sheet open: the person is told, in their language');
    eq([await page.locator('.crm-sheet').isVisible(), await page.evaluate(() => location.hash)], [true, '#customer'], tag + ': and nothing is replaced underneath');
    if (english) ok(!/[؀-ۿ]/.test(await toast.first().innerText()), tag + ': no Arabic in the English notice');
    await noSideways(page, tag + ' (sheet and notice)');
    await shot(page, 'nearby-' + tag + '-sheet-open');
    await page.context().close();
  }
  // ---- A representative whose map is hidden: the customer's own card opens instead.
  for (const english of [false, true]) {
    const page = await open('repnomap', {english, viewport: {width: 360, height: 800}, touch: true, hash: '#nearby=near-3'});
    await page.locator('.crm-sheet').waitFor({state: 'visible'});
    eq((await page.locator('.crm-sheet h2').first().innerText()).trim(), ELSE, (english ? 'en' : 'ar') + ': the map hidden: the customer\'s card');
    eq(await page.locator('.cm-shell').count(), 0, (english ? 'en' : 'ar') + ': and no map');
    await noSideways(page, 'map hidden ' + (english ? 'en' : 'ar'));
    await shot(page, 'nearby-map-hidden-' + (english ? 'en' : 'ar'));
    await page.context().close();
  }
  eq(errors, [], 'no page errors');
  console.log(JSON.stringify({ok: true, checks, screenshots, syntheticFixtures: true, productionDataUsed: false}));
} finally { await browser?.close(); await app?.stop(); }
