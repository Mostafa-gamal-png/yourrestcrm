// «خطتي» and the home card «خطة اليوم» (2026-11-22, the port of GSCO 2.13.86; app/my-plan.tsx, lib/my-plan.ts) in a real Chromium against
// the BUILT release (run the build first), the server's and the pages' clocks at a Thursday 10:00 Riyadh, the plan's day. A representative in
// the Android app: the home card «خطة اليوم» says the plan approved with edits, late, one stop of four done, and opens «خطتي»; «خطتي» is the
// first page of «المزيد»; the stops in order with their state («تمت» on the one done) and the sales manager's purple mark; a tap on a stop
// not done opens the follow-up form of its customer, on the done one the customer, on one whose customer is gone a message; the targets
// beside what was achieved; without a network the page opens from the copy kept on the device; at midnight it turns to the new day and never
// shows yesterday's plan. A marketing officer's plan not approved by midnight reads «غير معتمدة». The supervisor's screen shows the sales
// manager's purple marks and «غير معتمدة». Every screen at 320 and 360 px phones, a tablet upright and on its side and a computer, in Arabic
// and in English (no Arabic left but the names), without sideways scrolling, every button at least 44 px high on a touch screen.
// Screenshots for the report. Synthetic fixtures only: temporary SQLite, mocked sendmail.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [{id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', region: 'eastern', name: 'المشرف سالم'}, {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'},
  {id: 'mk1', role: 'marketing', sup: 'sup', region: 'eastern', name: 'مسؤول التسويق'}];
const NAMES = ['المشرف سالم', 'المندوب أحمد', 'مسؤول التسويق', 'مدير المبيعات', 'مدير النظام', 'مصنع الشرق', 'مصنع الخليج', 'مصنع الدمام', 'مصنع الجبيل', 'مصنع التسويق', 'متابعة العرض', 'أحضر العينة', 'الدمام', 'الشرقية'];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-my-plan-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const SIZES = {phone320: {width: 320, height: 640}, phone360: {width: 360, height: 800}, tabletUp: {width: 768, height: 1024}, tabletSide: {width: 1024, height: 768}, desktop: {width: 1280, height: 900}};
const riyadh = at => new Date(at + 3 * 3600000).toISOString().slice(0, 10);
// The coming Thursday 10:00 Riyadh (07:00 UTC): D, the plan's day; W the Wednesday before it.
let thursday = Date.parse(riyadh(Date.now()) + 'T07:00:00.000Z');
while (new Date(thursday).getUTCDay() !== 4 || thursday < Date.now()) thursday += 86400000;
const offset = thursday - Date.now(), D = riyadh(thursday), W = riyadh(thursday - 86400000);
const pageNow = () => Date.now() + offset;

try {
  app = await bootBuiltApp({members}, {tls: true, env: {NODE_OPTIONS: '--import ' + new URL('../scripts/lib/shifted-clock.mjs', import.meta.url).href, TEST_CLOCK_OFFSET_MS: String(offset)}});
  const now = new Date().toISOString();
  const insert = (id, kind, parent, assignedTo, data, when = now) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,'الرئيسي',?,?,?,1,'fixture')").bind(id, kind, parent, assignedTo, JSON.stringify(data), when, when).run();
  for (const [id, name, owner] of [['c1', 'مصنع الشرق', 'rep1'], ['c2', 'مصنع الخليج', 'rep1'], ['c3', 'مصنع الدمام', 'rep1'], ['c4', 'مصنع الجبيل', 'rep1'], ['m1', 'مصنع التسويق', 'mk1']]) {
    await insert(id, 'customer', null, owner, {name, branch: 'الرئيسي', assignedTo: owner, region: 'الشرقية', city: 'الدمام', customerStatus: 'نشط', phone: '055' + String(id.charCodeAt(1)).padStart(7, '0'), contact: 'م', location: '26.43, 50.03'});
    await insert('f-' + id, 'activity', id, owner, {type: 'call', date: W, summary: 'متابعة سابقة', result: 'تمت', performedBy: owner, responsibleId: owner, recordedByEmail: owner + '@yourrest.org', nextAction: 'متابعة العرض', nextDate: D, visitWorkflow: 'customer-v1'}, new Date(Date.parse(now) - 86400000).toISOString());
  }
  // The plans, through the routes: rep1's sent at 10:00 on its day (late), approved by the sales manager with a stop added; mk1's sent late
  // and not approved (the supervisor's window closed at midnight).
  const as = {};
  for (const id of ['rep1', 'mk1', 'mgr']) as[id] = app.as(await app.login(id));
  const post = async (who, body) => { const response = await as[who]('/api/daily-plans', {method: 'POST', body: {requestId: crypto.randomUUID(), ...body}}); assert.equal(response.status, 200, who + ' ' + body.action + ' -> ' + response.text.slice(0, 300)); return response.json(); };
  const stop = (customerId, kind = 'visit', extra = {}) => ({customerId, kind, time: '', note: '', ...extra});
  let plan = (await post('rep1', {action: 'send', date: D, stops: [stop('c1'), stop('c2', 'call', {time: '10:30', note: 'أحضر العينة'}), stop('c3', 'whatsapp')], baseVersion: null, targets: {opportunities: 1, customers: 2}})).plan;
  plan = (await post('mgr', {action: 'approve_edited', memberId: 'rep1', date: D, baseVersion: plan.version, stops: [...plan.stops.map(item => ({id: item.id, customerId: item.customerId, kind: item.kind, time: item.time, note: item.note})), stop('c4')]})).plan;
  check([plan.state, plan.late, plan.stops.map(item => item.mark?.by || '')], ['approved_edited', true, ['', '', '', 'manager']], 'the fixture: approved by the sales manager with a stop added, sent late');
  await post('mk1', {action: 'send', date: D, stops: [stop('m1')], baseVersion: null, targets: {opportunities: 0, customers: 1}});
  // A visit to c1 this morning closes its stop; a customer added by hand today counts for the targets.
  await insert('v1', 'activity', 'c1', 'rep1', {type: 'visit', date: D, summary: 'زيارة', result: 'تمت', performedBy: 'rep1', responsibleId: 'rep1', recordedByEmail: 'rep1@yourrest.org', nextAction: 'متابعة العرض', nextDate: riyadh(thursday + 5 * 86400000), visitWorkflow: 'customer-v1'});
  await insert('n1', 'customer', null, 'rep1', {name: 'مصنع جديد', branch: 'الرئيسي', assignedTo: 'rep1', region: 'الشرقية', city: 'الدمام', customerStatus: 'نشط', _createdBy: 'rep1'}, new Date(thursday - 3600000).toISOString());// added at 09:00 on the plan's day
  NAMES.push('مصنع جديد');

  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});
  async function open(memberId, {viewport = SIZES.phone360, english = false, hash = '#my-plan', inApp = false, time = pageNow()} = {}) {
    const touch = viewport.width < 1100;
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: touch, isMobile: viewport.width < 700, geolocation: {latitude: 26.43, longitude: 50.03, accuracy: 8}, permissions: ['geolocation']});
    await context.clock.install({time});
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    await context.addInitScript(english => { try { localStorage.setItem('yr-language', english ? 'en' : 'ar'); } catch { /* storage unavailable */ } }, english);
    const page = await context.newPage();
    page.setDefaultTimeout(25000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (inApp) await installNativeBridge(page, {memberId, regionScope: 'eastern'});
    await page.goto(app.origin + '/' + hash);
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('.workspace').waitFor();
    return page;
  }
  const settle = page => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const shot = async (page, label) => { await settle(page); await page.screenshot({path: path.join(screenshots, label + '.png'), fullPage: false}); };
  const noSideways = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scrolling');
  const tall = async (page, selector, label) => check(await page.locator(selector).evaluateAll(items => items.filter(item => { const box = item.getBoundingClientRect(); return box.height && box.height < 44; }).map(item => item.textContent.trim().slice(0, 30))), [], label + ': every button at least 44 px high');
  const arabicLeft = async (page, selector) => { let words = await page.locator(selector).innerText(); for (const name of [...NAMES].sort((a, b) => b.length - a.length)) words = words.split(name).join(''); return (words.match(/[؀-ۿ]+/g) || []).slice(0, 8); };
  const stops = page => page.locator('[data-my-plan-stop]').evaluateAll(items => items.map(item => [item.querySelector('strong').textContent, item.querySelector('[data-my-stop-state]').dataset.myStopState, item.querySelector('[data-stop-mark]')?.dataset.stopMark || '', item.querySelector('[data-my-stop-tap]').dataset.myStopTap]));

  // ---- 1. The representative in the Android app on a 360 px phone: the home card, «المزيد», «خطتي», the taps.
  const rep = await open('rep1', {hash: '#activity', inApp: true});
  const home = rep.locator('[data-my-plan-home]');
  await rep.locator('[data-my-plan-home="approved_edited"]').waitFor();
  const homeText = await home.innerText();
  ok(homeText.includes('خطة اليوم') && homeText.includes('معتمدة مع تعديل') && homeText.includes('متأخرة') && homeText.includes('تمت 1 من 4') && homeText.includes('عدّلها مدير المبيعات'), 'the home card «خطة اليوم»: approved with edits, late, one of four done, edited by the sales manager («' + homeText.replace(/\s+/g, ' ') + '»)');
  await tall(rep, '[data-my-plan-home]', 'the home card');
  await noSideways(rep, 'the home with its card');
  await shot(rep, 'my-plan-home-card-ar-360');
  await home.click();
  await rep.locator('[data-my-plan="approved_edited"]').waitFor();
  check(new URL(rep.url()).hash, '#my-plan', 'the card opens «خطتي»');
  check(await stops(rep), [['مصنع الشرق', 'done', '', 'customer'], ['مصنع الخليج', 'open', '', 'followup'], ['مصنع الدمام', 'open', '', 'followup'], ['مصنع الجبيل', 'open', 'manager', 'followup']], 'the stops in order: «تمت» on the visited one, the sales manager\'s mark on the one they added');
  ok((await rep.locator('[data-my-stop-state="done"]').innerText()).includes('تمت'), '«تمت» written on the done stop');
  check(await rep.locator('[data-stop-mark="manager"]').evaluate(item => getComputedStyle(item).color), 'rgb(91, 58, 166)', 'the sales manager\'s mark in purple');
  check(await rep.locator('[data-my-target]').evaluateAll(items => items.map(item => item.textContent.replace(/\s+/g, ' ').trim())), ['فرص بيع جديدة: المستهدف 1 · المحقق 0', 'عملاء جدد: المستهدف 2 · المحقق 1'], 'the targets beside what was achieved');
  // «المزيد»: «خطتي» first.
  await rep.locator('.mobile-bottom-navigation button[aria-haspopup="dialog"]').click();
  check(await rep.locator('[role="dialog"] button[data-page]').evaluateAll(items => items.map(item => item.dataset.page)), ['my-plan', 'plans', 'mold-requests'], '«خطتي» is the first page of «المزيد»');
  await shot(rep, 'my-plan-more-ar-360');
  await rep.keyboard.press('Escape');
  // A tap on a stop not done opens the follow-up form of its customer.
  await rep.locator('[data-my-plan-stop="2"] [data-my-stop-tap]').click();
  const form = rep.locator('.followup-record-dialog');
  await form.waitFor();
  ok((await form.innerText()).includes('مصنع الخليج'), 'the follow-up form of «مصنع الخليج» opens directly');
  await shot(rep, 'my-plan-followup-ar-360');
  await rep.keyboard.press('Escape');
  await form.waitFor({state: 'detached'});
  // The done one opens the customer.
  await rep.locator('[data-my-plan-stop="1"] [data-my-stop-tap]').click();
  const sheet = rep.locator('.crm-sheet');
  await sheet.waitFor();
  ok((await sheet.innerText()).includes('مصنع الشرق'), 'the done stop opens its customer');
  await rep.keyboard.press('Escape');
  await sheet.waitFor({state: 'detached'});
  // Offline: opened again from the copy kept on the device.
  await rep.locator('.mobile-bottom-navigation button[data-page="customer"]').click();
  await rep.context().setOffline(true);
  await rep.evaluate(() => window.dispatchEvent(new Event('offline')));
  await rep.locator('.mobile-bottom-navigation button[aria-haspopup="dialog"]').click();
  await rep.locator('[role="dialog"] button[data-page="my-plan"]').click();
  await rep.locator('[data-my-plan-cached]').waitFor();
  check((await stops(rep)).map(row => row[0]), ['مصنع الشرق', 'مصنع الخليج', 'مصنع الدمام', 'مصنع الجبيل'], 'without a network: the plan from the device\'s copy');
  await shot(rep, 'my-plan-offline-ar-360');
  await rep.context().setOffline(false);
  await rep.evaluate(() => window.dispatchEvent(new Event('online')));
  await rep.context().close();
  // A customer deleted since the plan was made: the stop says so instead of doing nothing (the rows are put back afterwards).
  const kept = (await app.db.prepare("SELECT * FROM crm_records WHERE id IN ('c3','f-c3')").all()).results.map(row => ({...row}));
  await app.db.prepare("DELETE FROM crm_records WHERE id IN ('c3','f-c3')").run();
  const gone = await open('rep1', {inApp: true});
  await gone.locator('[data-my-plan="approved_edited"]').waitFor();
  await gone.locator('[data-my-plan-stop="3"] [data-my-stop-tap="gone"]').click();
  ok((await gone.locator('[data-my-stop-gone]').innerText()).includes('لم يعد هذا العميل متاحًا لك'), 'a customer deleted: the stop says it is no longer available');
  await shot(gone, 'my-plan-gone-ar-360');
  await gone.context().close();
  for (const row of kept) { const keys = Object.keys(row); await app.db.prepare('INSERT INTO crm_records(' + keys.join(',') + ') VALUES(' + keys.map(() => '?').join(',') + ')').bind(...keys.map(key => row[key])).run(); }

  // ---- 2. At midnight the page turns to the new day: never yesterday's plan.
  // The page's clock runs on from 23:58:30 (a minute and a half to load the page), then jumps past midnight.
  const late = await open('rep1', {inApp: true, time: Date.parse(D + 'T23:58:30+03:00')});
  await late.locator('[data-my-plan="approved_edited"]').waitFor();
  check(await late.evaluate(() => new Date(Date.now() + 3 * 3600000).toISOString().slice(11, 16) < '24:00' && new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)), D, 'before midnight: the plan\'s day');
  await late.clock.fastForward(95000);
  await late.locator('[data-my-plan="missing"]').waitFor();
  check([await late.locator('[data-my-plan-stop]').count(), await late.locator('[data-my-plan-tomorrow]').count() > 0], [0, true], 'after midnight: the new day has no plan; yesterday\'s stops are gone, and «إعداد خطة الغد» is offered');
  await shot(late, 'my-plan-midnight-ar-360');
  await late.context().close();

  // ---- 3. «غير معتمدة»: the marketing officer's plan, not approved by midnight.
  const officer = await open('mk1', {inApp: true});
  await officer.locator('[data-my-plan="unapproved"]').waitFor();
  ok((await officer.locator('.my-plan-banner').innerText()).includes('لم يعتمد المشرف الخطة قبل منتصف الليل'), '«غير معتمدة»: the plan stays as sent');
  await shot(officer, 'my-plan-unapproved-ar-360');
  await officer.context().close();

  // ---- 4. Every size, both languages: «خطتي», and the supervisor's screen with the sales manager's marks and «غير معتمدة».
  for (const [label, viewport] of Object.entries(SIZES)) for (const english of [false, true]) {
    const lang = english ? 'en' : 'ar', tag = label + ' ' + lang;
    const page = await open('rep1', {viewport, english, inApp: true});// a representative works in the Android app (a browser asks them to share their position first)
    await page.locator('[data-my-plan="approved_edited"]').waitFor();
    await page.locator('[data-my-plan-stop]').first().waitFor();
    if (english) ok((await page.locator('[data-my-plan-status]').innerText()).includes('Approved with edits') && (await page.locator('[data-my-stop-state="done"]').innerText()).includes('Done'), tag + ': the state and «Done» in English');
    await noSideways(page, tag + ' «خطتي»');
    if (viewport.width < 1100) await tall(page, '.my-plan button', tag + ' «خطتي»');
    if (english) check(await arabicLeft(page, '.my-plan'), [], tag + ': no Arabic left in English but the names');
    await shot(page, `my-plan-${lang}-${label}`);
    await page.context().close();
  }
  for (const english of [false, true]) for (const [label, viewport] of [['phone360', SIZES.phone360], ['desktop', SIZES.desktop]]) {
    const lang = english ? 'en' : 'ar', tag = 'supervisor ' + label + ' ' + lang;
    const reviewer = await open('sup', {viewport, english, hash: '#plans'});
    await reviewer.locator(`[data-plan-day="${D}"]`).click();// the list opens on the next working day; today's plans
    await reviewer.locator('[data-plan-row="rep1"]').waitFor();
    check(await reviewer.locator('[data-plan-row="mk1"] [data-plan-unapproved]').count(), 1, tag + ': the marketing officer\'s plan «غير معتمدة» in the list');
    await reviewer.locator('[data-plan-row="rep1"]').click();
    await reviewer.locator('[data-plan-card] [data-stop-mark="manager"]').first().waitFor();
    ok((await reviewer.locator('[data-plan-card] [data-stop-mark="manager"]').first().innerText()).includes(english ? 'by the sales manager' : 'مدير المبيعات'), tag + ': the sales manager\'s mark');
    ok((await reviewer.locator('[data-plan-window="closed"]').innerText()).length > 10, tag + ': the supervisor\'s window closed at midnight');
    check(await reviewer.locator('[data-plan-approve], [data-plan-edit], [data-plan-return]').count(), 0, tag + ': no approval, edit or return after midnight');
    ok((await reviewer.locator('[data-plan-manager-edit]').innerText()).includes('مدير المبيعات'), tag + ': the sales manager\'s last change in the meta line');
    await noSideways(reviewer, tag);
    if (english) check(await arabicLeft(reviewer, '[data-daily-plans]'), [], tag + ': no Arabic left in English but the names');
    await shot(reviewer, `my-plan-supervisor-${lang}-${label}`);
    await reviewer.context().close();
  }
  check(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks, screenshots, day: D}));
} finally {
  if (browser) await browser.close();
  if (app) await app.stop();
}
