// «زيارات ومتابعات بلا نتيجة أو إجراء» (app/review-pending.tsx, GET /api/reviews/pending) in a real Chromium against the BUILT release (run the
// build first). The supervisor on a computer (Arabic): the red card at the very top of the first screen, above «فريقي اليوم», in the
// theme's red, with the total of the last 7 days, 8 lines (the representative, the day, the count) and «وأيام أخرى: 2»; a line opens «تقرير
// يوم المندوب» on that representative and that day, where a note is saved, and back on the first screen the line has dropped; pressing the
// card opens the newest line. The same on a 360 px phone (Arabic, English with no Arabic left but the names, the dark theme) and in the
// Android app's web view: nothing scrolls sideways, every tap target is at least 44 px high. The sales manager gets their team's card;
// the administrator, a representative (the app) and a supervisor whose «تقرير يوم المندوب» is hidden get none. Screenshots for the report.
// Synthetic fixtures only: temporary SQLite, mocked sendmail.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [{id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'مدير المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'sm', region: 'central', name: 'المشرف سالم'},
  {id: 'rep', role: 'rep', sup: 'sup', region: 'central', name: 'المندوب أحمد'}, {id: 'rep2', role: 'rep', sup: 'sup', region: 'central', name: 'المندوب خالد'},
  {id: 'sup2', role: 'supervisor', sup: 'sm', region: 'central', name: 'مشرف آخر'}, {id: 'rep3', role: 'rep', sup: 'sup2', region: 'central', name: 'مندوب فريق آخر'}];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-redcard-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1280, height: 900};
const riyadhClock = () => new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date());
while (riyadhClock() >= '23:55') await new Promise(resolve => setTimeout(resolve, 20000));
const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
const day = back => new Date(Date.parse(today + 'T12:00:00Z') - back * 86400000).toISOString().slice(0, 10);

try {
  app = await bootBuiltApp({members}, {tls: true});
  const now = new Date().toISOString();
  const insert = (id, kind, parent, assignedTo, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, kind, parent, assignedTo, JSON.stringify(data), now, now).run();
  await insert('c1', 'customer', null, 'rep', {name: 'مصنع الاختبار', branch: 'الرئيسي', assignedTo: 'rep', region: 'الوسطى', city: 'الرياض', customerStatus: 'نشط', phone: '0551234567', contact: 'م', location: '24.71, 46.67'});
  await insert('c3', 'customer', null, 'rep3', {name: 'مصنع الفريق الآخر', branch: 'الرئيسي', assignedTo: 'rep3', region: 'الوسطى', city: 'الرياض', customerStatus: 'نشط', phone: '0551234568', contact: 'م', location: '24.72, 46.68'});
  const visit = (id, by, customer, date, extra = {}) => insert(id, 'activity', customer, by, {type: 'visit', date, summary: 'تعريف بالمنتجات', result: 'العميل مهتم', nextAction: 'اتصال', nextDate: today, performedBy: by, responsibleId: by, recordedByEmail: by + '@yourrest.org', ...extra});
  // rep: every one of the last 7 days (two today: a visit and a call); rep2: three days; rep3 (another team): today; an eighth day back is outside.
  await visit('rep-0a', 'rep', 'c1', day(0)); await visit('rep-0b', 'rep', 'c1', day(0), {type: 'call'});
  for (let back = 1; back < 7; back++) await visit('rep-' + back, 'rep', 'c1', day(back));
  await visit('rep-7', 'rep', 'c1', day(7));
  for (const back of [1, 3, 5]) await visit('rep2-' + back, 'rep2', 'c1', day(back), back === 3 ? {type: 'whatsapp'} : {});
  await visit('rep3-0', 'rep3', 'c3', day(0));
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});

  async function open(memberId, {english = false, dark = false, viewport = PHONE, hash = '#dashboard', app: inApp = false} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: viewport === PHONE, geolocation: {latitude: 24.7136, longitude: 46.6753, accuracy: 8}, permissions: ['geolocation']});
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    await context.addInitScript(({english, dark}) => { try { if (english) localStorage.setItem('yr-language', 'en'); if (dark) localStorage.setItem('yr-theme', 'dark'); } catch { /* storage unavailable */ } }, {english, dark});
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (inApp) await installNativeBridge(page, {memberId, regionScope: 'all'});
    await page.goto(app.origin + '/' + hash);
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('.workspace').waitFor();
    return page;
  }
  const settle = page => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const shot = async (page, label) => { await settle(page); await page.screenshot({path: path.join(screenshots, label + '.png'), fullPage: false}); };
  const noSideways = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scrolling');
  const tall = async (locator, label) => check(await locator.evaluateAll(items => items.filter(item => item.getBoundingClientRect().height && item.getBoundingClientRect().height < 44).length), 0, label + ': every tap target at least 44 px high');
  const card = page => page.locator('[data-review-pending]');
  const lineKeys = page => card(page).locator('[data-review-pending-line]').evaluateAll(items => items.map(item => item.dataset.reviewPendingLine));
  const destructive = page => page.evaluate(() => { const probe = document.createElement('span'); probe.style.color = 'var(--destructive)'; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; });

  // ---- 1. The supervisor on a computer, Arabic.
  const sup = await open('sup', {viewport: DESKTOP});
  await card(sup).waitFor();
  check(await sup.locator('.team-home > *').first().evaluate(node => node.hasAttribute('data-review-pending')), true, 'the red card is the first thing on the first screen');
  ok(await sup.evaluate(() => { const red = document.querySelector('[data-review-pending]').getBoundingClientRect(), team = document.querySelector('[data-team-today]').getBoundingClientRect(); return red.bottom <= team.top; }), 'above «فريقي اليوم»');
  check((await card(sup).locator('[data-review-pending-total]').innerText()).trim(), '11', 'the total: rep\'s 8 visits of the 7 days and rep2\'s 3 (not rep3, another team\'s; not the eighth day back)');
  ok((await card(sup).locator('.review-pending-title').innerText()).startsWith('زيارات ومتابعات بلا نتيجة أو إجراء'), 'its title');
  check(await lineKeys(sup), ['rep|' + day(0), 'rep|' + day(1), 'rep2|' + day(1), 'rep|' + day(2), 'rep|' + day(3), 'rep2|' + day(3), 'rep|' + day(4), 'rep|' + day(5)], 'eight lines, the newest day first');
  check((await card(sup).locator('[data-review-pending-more]').innerText()).trim(), 'وأيام أخرى: 2', 'then «وأيام أخرى: 2»');
  check(await card(sup).locator('[data-review-pending-line="rep|' + day(0) + '"]').evaluate(line => [line.querySelector('.review-pending-name').textContent, line.querySelector('time').textContent, line.querySelector('.review-pending-count').textContent]), ['المندوب أحمد', 'اليوم', '2'], 'a line: the representative, the day and the count');
  check(await card(sup).locator('[data-review-pending-line="rep2|' + day(1) + '"] time').innerText(), 'أمس', 'yesterday in words');
  const red = await destructive(sup);
  check(await card(sup).evaluate(node => [getComputedStyle(node).borderTopColor, getComputedStyle(node.querySelector('.review-pending-title')).color]), [red, red], 'drawn in the theme\'s own red (--destructive)');
  await shot(sup, 'redcard-supervisor-ar-desktop');
  // A line opens the day report on that representative and that day; a note saved there takes the visit off.
  await card(sup).locator('[data-review-pending-line="rep2|' + day(3) + '"]').click();
  await sup.waitForFunction(() => document.querySelector('.journey-report select')?.value === 'rep2');
  check([await sup.locator('.journey-report select').inputValue(), await sup.locator('.journey-report input[type=date]').inputValue()], ['rep2', day(3)], 'the line opens «تقرير يوم المندوب» on that representative and that day');
  const block = sup.locator('[data-entry-review="rep2-3"]');
  await block.locator('[data-review-add="rep2-3"]').click();
  await block.getByRole('radio', {name: 'فعالة', exact: true}).check();
  await block.locator('textarea').nth(0).fill('تواصل جيد');await block.locator('textarea').nth(1).fill('أرسل عرض السعر');
  await block.getByRole('button', {name: 'حفظ', exact: true}).click();
  await block.locator('.review-saved').waitFor();
  await shot(sup, 'redcard-supervisor-day-report-ar-desktop');
  await sup.locator('.app-sidebar .nav-item').filter({hasText: 'لوحة المتابعة'}).click();
  await card(sup).waitFor();
  await sup.waitForFunction(() => document.querySelector('[data-review-pending-total]')?.textContent === '10');
  ok(!(await lineKeys(sup)).includes('rep2|' + day(3)), 'back on the first screen: that day\'s line is gone (its only visit noted), the total 10');
  // Pressing the card opens the newest line.
  await card(sup).locator('[data-review-pending-open]').click();
  await sup.waitForFunction(() => document.querySelector('.journey-report select')?.value === 'rep');
  check(await sup.locator('.journey-report input[type=date]').inputValue(), today, 'the card itself opens the newest line: rep, today');
  await sup.context().close();

  // ---- 2. The supervisor on a 360 px phone: Arabic, English, dark; and in the Android app.
  const phone = await open('sup');
  await card(phone).waitFor();
  await noSideways(phone, 'the supervisor\'s phone, Arabic');
  await tall(card(phone).locator('button'), 'the red card on a phone');
  check(await card(phone).evaluate(node => node.getBoundingClientRect().width <= innerWidth), true, 'the card fits the phone');
  await shot(phone, 'redcard-supervisor-ar-360');
  // A press on the card's empty space opens the newest line too.
  await card(phone).locator('[data-review-pending-more]').scrollIntoViewIfNeeded();
  const box = await card(phone).boundingBox();
  check(await phone.evaluate(([x, y]) => !document.elementFromPoint(x, y)?.closest('button') && !!document.elementFromPoint(x, y)?.closest('[data-review-pending]'), [box.x + 5, box.y + box.height - 4]), true, 'the point pressed is the card itself, not a line');
  await phone.mouse.click(box.x + 5, box.y + box.height - 4);
  await phone.waitForFunction(() => document.querySelector('.journey-report select')?.value === 'rep');
  check(await phone.locator('.journey-report input[type=date]').inputValue(), today, 'a press on the card itself: the newest line');
  await phone.context().close();
  const english = await open('sup', {english: true});
  await card(english).waitFor();
  const words = await card(english).innerText();
  ok(words.includes('Visits and follow-ups with no result or action: 10') && words.includes('And other days: 1') && words.includes('Today'), 'English: ' + words.slice(0, 120));
  ok(!/[؀-ۿ]/.test(words.replace(/المندوب (أحمد|خالد)/g, '')), 'no Arabic left in English but the names (data)');
  await noSideways(english, 'English, the phone');
  await shot(english, 'redcard-supervisor-en-360');
  await english.context().close();
  const dark = await open('sup', {dark: true});
  await card(dark).waitFor();
  check(await dark.evaluate(() => document.documentElement.classList.contains('dark')), true, 'the dark theme is on');
  const pink = await destructive(dark);
  check([pink, await card(dark).evaluate(node => getComputedStyle(node).borderTopColor)], ['rgb(255, 165, 185)', 'rgb(255, 165, 185)'], 'the dark theme\'s own red (--destructive is #ffa5b9 there)');
  await shot(dark, 'redcard-supervisor-dark-360');
  await dark.context().close();
  const inApp = await open('sup', {app: true});
  await card(inApp).waitFor();
  await noSideways(inApp, 'the Android app');
  await shot(inApp, 'redcard-supervisor-app-ar-360');
  await inApp.context().close();

  // ---- 3. The sales manager: their team; nobody else.
  const manager = await open('sm', {viewport: DESKTOP});
  await card(manager).waitFor();
  check((await card(manager).locator('[data-review-pending-total]').innerText()).trim(), '11', 'the sales manager: rep, rep2 and rep3 (10 + 1)');
  ok((await lineKeys(manager)).includes('rep3|' + today), 'with the other supervisor\'s representative');
  await shot(manager, 'redcard-manager-ar-desktop');
  await manager.context().close();
  const other = await open('sup2', {viewport: DESKTOP});
  await card(other).waitFor();
  check(await lineKeys(other), ['rep3|' + today], 'the other supervisor: their own representative only');
  await other.context().close();
  for (const [memberId, options, label] of [['owner', {viewport: DESKTOP}, 'the administrator'], ['rep', {app: true, hash: ''}, 'a representative in the app']]) {
    const page = await open(memberId, options);
    await page.waitForTimeout(2000);
    check(await card(page).count(), 0, label + ': no red card');
    await page.context().close();
  }
  await app.db.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('sup','{}','[\"journeys\"]',1,'owner',?)").bind(now).run();
  const hidden = await open('sup', {viewport: DESKTOP});
  await hidden.waitForTimeout(1500);
  check(await card(hidden).count(), 0, '«تقرير يوم المندوب» hidden from the supervisor: no red card');
  await hidden.context().close();

  ok(!errors.length, 'no uncaught page errors: ' + errors.join(' | '));
  console.log(JSON.stringify({ok: true, checks, screenshots, realChromium: true, syntheticFixtures: true}));
} finally {
  await browser?.close(); await app?.stop();
}
