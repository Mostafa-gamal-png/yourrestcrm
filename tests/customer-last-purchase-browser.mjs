// «لم يشترِ منذ 60 يومًا» in a real Chromium against the BUILT release (run `pnpm build` first), on a 360 px phone: the customers page's
// «فلترة» sheet offers the toggle; on, it lists the active customers whose last purchase is more than 60 days old or who never bought
// (exactly 60 days is still recent; «خامل» and unspecified statuses are left out), each card reading «آخر شراء: …» or «لم يشترِ بعد»;
// the filter counts in the badge, works with the search and the region filter, and «مسح الفلاتر» clears it; the page never scrolls
// sideways. The same in English. A representative (on the Android app emulator) gets it for their own customers. Off, no card shows the
// line; the desktop table shows the same line under the codes. Screenshots for the report. Synthetic fixtures only: temporary SQLite, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [{id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'مدير المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'sm', name: 'المشرف'}, {id: 'rep', role: 'rep', sup: 'sup', region: 'central', name: 'مندوب الوسطى'}];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-inactive-customers-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const PHONE = {width: 360, height: 800};
const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
const day = back => new Date(Date.parse(today + 'T00:00:00Z') - back * 86400000).toISOString().slice(0, 10);
const RECENT = 'مصنع اشترى قريبا', BOUNDARY = 'مصنع اشترى من ستين يوما', OLD = 'مصنع اشترى من زمان', NEVER = 'مصنع لم يشتر', SLEEPY = 'مصنع خامل', UNSET = 'مصنع بلا حالة', EAST = 'مصنع الشرقية القديم';

try {
  app = await bootBuiltApp({members}, {tls: true});
  const now = new Date().toISOString();
  const customer = (id, name, data = {}) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')")
    .bind(id, JSON.stringify({name, branch: 'الرئيسي', assignedTo: 'rep', region: 'الوسطى', city: 'الرياض', customerStatus: 'نشط', phone: '0551234567', contact: 'م', code: '', ...data}), now, now).run();
  await customer('recent', RECENT, {code: 'C-1'}); await customer('boundary', BOUNDARY, {code: 'C-2'}); await customer('old', OLD, {code: 'C-3'});
  await customer('never', NEVER); await customer('sleepy', SLEEPY, {customerStatus: 'خامل'}); await customer('unset', UNSET, {customerStatus: ''});
  await customer('east', EAST, {region: 'الشرقية', city: 'الدمام', code: 'E-1'});
  await app.db.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('imp','owner','f','sales.xml','{}',?)").bind(now).run();
  let n = 0;
  const erp = (code, date, type = 'sale', total = 10000) => app.db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'h','h',?,?,?,'e1','rep','الرئيسي','all',?,'n','{}',?,'imp','owner',?)")
    .bind('erp-' + (++n), 'doc-' + n, 'INV-' + n, type, date, code, total, now).run();
  await erp('C-1', day(5)); await erp('C-2', day(60)); await erp('C-3', day(61)); await erp('C-3', day(1), 'return', -500); await erp('E-1', day(120));
  const {scope} = await app.db.prepare('SELECT region_scope AS scope FROM crm_members WHERE id=?').bind('rep').first();
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});

  async function open(memberId, {english = false, viewport = PHONE} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', geolocation: {latitude: 24.7136, longitude: 46.6753, accuracy: 8}, permissions: ['geolocation']});
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    if (english) await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (memberId === 'rep') await installNativeBridge(page, {memberId: 'rep', regionScope: scope});
    await page.goto(app.origin + '/#customer');
    await page.locator(viewport === PHONE ? '.customer-mobile-card' : '.customer-expand').first().waitFor();
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    return page;
  }
  const shot = async (page, label) => { await page.waitForTimeout(250); await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const names = async page => (await page.locator('.customer-mobile-card .customer-mobile-name h3').allInnerTexts()).map(text => text.trim()).sort();
  const lines = page => page.locator('.customer-mobile-card').evaluateAll(cards => Object.fromEntries(cards.map(card => [card.querySelector('h3').textContent.trim(), card.querySelector('.customer-mobile-last-purchase')?.textContent.trim() ?? null])));
  const badge = async page => { const b = page.locator('.mobile-filter-toggle b'); return await b.count() ? (await b.innerText()).trim() : null; };
  const noSideways = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scrolling at 360 px');
  const sheet = page => page.locator('#crm-page-filters');
  const openSheet = async page => { if (await sheet(page).isHidden()) await page.locator('.mobile-filter-toggle').click(); await sheet(page).waitFor(); };
  const toggle = (page, label) => sheet(page).getByRole('button', {name: label, exact: true});

  // ---- the administrator, Arabic
  const owner = await open('owner');
  check(await names(owner), [RECENT, BOUNDARY, OLD, NEVER, SLEEPY, UNSET, EAST].sort(), 'every customer is listed');
  check([await owner.locator('.customer-mobile-last-purchase').count(), await badge(owner)], [0, null], 'off: no «آخر شراء» line and no filter counted');
  await openSheet(owner);
  const arabic = toggle(owner, 'لم يشترِ منذ 60 يومًا');
  check(await arabic.getAttribute('aria-pressed'), 'false', 'the toggle is in the «فلترة» sheet, off');
  check(await arabic.evaluate(item => item.getBoundingClientRect().height >= 44), true, 'and easy to tap');
  await noSideways(owner, 'the open sheet');
  await shot(owner, 'inactive-customers-sheet-ar');
  await arabic.click();
  check(await arabic.getAttribute('aria-pressed'), 'true', 'on');
  check(await names(owner), [OLD, NEVER, EAST].sort(), 'on: 61 days ago or never, active only (60 days is recent; «خامل» and no status left out)');
  check(await lines(owner), {[OLD]: 'آخر شراء: ' + day(61), [NEVER]: 'لم يشترِ بعد', [EAST]: 'آخر شراء: ' + day(120)}, 'each card reads its last purchase (a later return is not one) or that it never bought');
  check([(await owner.locator('.customer-mobile-count strong').innerText()).trim(), await badge(owner)], ['3', '1'], 'the count follows, the badge counts the filter');
  await noSideways(owner, 'the filtered list');
  await shot(owner, 'inactive-customers-on-ar');
  // with the region filter and the search
  await sheet(owner).getByRole('combobox', {name: 'المنطقة'}).click();
  await owner.getByRole('option', {name: 'الوسطى', exact: true}).click();
  check([await names(owner), await badge(owner)], [[OLD, NEVER].sort(), '2'], 'with the region: two filters counted');
  await owner.locator('.mobile-search-row input[type=search]').fill('زمان');
  await owner.waitForFunction(() => document.querySelectorAll('.customer-mobile-card').length === 1);
  check(await names(owner), [OLD], 'and the search');
  await owner.locator('.mobile-search-row input[type=search]').fill('');
  await owner.waitForFunction(() => document.querySelectorAll('.customer-mobile-card').length === 2);
  // «مسح الفلاتر» clears it with the others
  await openSheet(owner);
  await sheet(owner).getByRole('button', {name: 'مسح الفلاتر', exact: true}).click();
  await owner.waitForFunction(() => document.querySelectorAll('.customer-mobile-card').length === 7);
  check([await toggle(owner, 'لم يشترِ منذ 60 يومًا').getAttribute('aria-pressed'), await badge(owner), await owner.locator('.customer-mobile-last-purchase').count()], ['false', null, 0], '«مسح الفلاتر»: off, no badge, no line');
  await owner.context().close();

  // ---- English
  const english = await open('owner', {english: true});
  await openSheet(english);
  const en = toggle(english, 'No purchase in 60 days');
  check(await en.getAttribute('aria-pressed'), 'false', 'English: the toggle');
  await en.click();
  check(await names(english), [OLD, NEVER, EAST].sort(), 'English: the same customers');
  check(await lines(english), {[OLD]: 'Last purchase: ' + day(61), [NEVER]: 'No purchase yet', [EAST]: 'Last purchase: ' + day(120)}, 'English lines');
  check(await badge(english), '1', 'English: the badge');
  check(await english.locator('.customer-mobile-last-purchase').evaluateAll(items => items.every(item => !/[؀-ۿ]/.test(item.textContent))), true, 'no Arabic in the lines');
  await noSideways(english, 'English');
  await shot(english, 'inactive-customers-on-en');
  await sheet(english).getByRole('button', {name: 'Clear filters', exact: true}).click();
  check([await en.getAttribute('aria-pressed'), await badge(english), (await names(english)).length], ['false', null, 7], 'English: «Clear filters»');
  await english.context().close();

  // ---- the desktop table: the same line under the codes of each row
  const desk = await open('owner', {viewport: {width: 1280, height: 900}});
  check(await desk.locator('.customer-last-purchase').count(), 0, 'desktop, off: no line');
  await toggle(desk, 'لم يشترِ منذ 60 يومًا').click();
  check(await desk.locator('tr').filter({has: desk.locator('.customer-expand')}).evaluateAll(rows => Object.fromEntries(rows.map(row => [row.querySelector('.customer-expand strong').textContent.trim(), row.querySelector('.customer-last-purchase')?.textContent.trim() ?? null]))),
    {[OLD]: 'آخر شراء: ' + day(61), [NEVER]: 'لم يشترِ بعد', [EAST]: 'آخر شراء: ' + day(120)}, 'desktop, on: the three rows with their line');
  await shot(desk, 'inactive-customers-desktop-ar');
  await desk.context().close();

  // ---- a representative, on the Android app: their own customers
  const rep = await open('rep');
  check(await names(rep), [RECENT, BOUNDARY, OLD, NEVER, SLEEPY, UNSET].sort(), 'the representative: their region\'s customers');
  await openSheet(rep);
  await toggle(rep, 'لم يشترِ منذ 60 يومًا').click();
  check(await lines(rep), {[OLD]: 'آخر شراء: ' + day(61), [NEVER]: 'لم يشترِ بعد'}, 'the representative: their two');
  check(await badge(rep), '1', 'counted');
  await noSideways(rep, 'the representative');
  await shot(rep, 'inactive-customers-rep-ar');
  await rep.context().close();

  ok(!errors.length, 'no uncaught page errors: ' + errors.join(' | '));
  console.log(JSON.stringify({ok: true, checks, screenshots, realChromium: true, syntheticFixtures: true}));
} finally {
  await browser?.close(); await app?.stop();
}
