// «خطة الغد» of 2026-11-22 (the port of GSCO 2.13.85; app/daily-plans.tsx) in a real Chromium against the BUILT release (run the build first),
// the server's and the pages' clocks at a Wednesday 20:30 Riyadh (Thursday's plan is the next). A representative in the Android app on a 360 px
// phone with 350 late follow-ups and two due on Thursday: «إضافة متابعات الغد (2)» adds the two; «المتابعات المتأخرة (350)» opens a list of 30
// rows (oldest first) with «عرض المزيد», the search narrows it, «تحديد كل نتائج البحث» takes the ten found and «إضافة إلى خطة الغد (10)» moves
// them to Thursday and adds them; three others go to another day with «ترحيل إلى تاريخ…» (the day-load picker, the date field no later than 30
// days); «تغيير الموعد» of a stop to another day takes it out after the warning; without a network the bulk actions say so and stay off; the
// targets typed with Arabic digits are sent. The supervisor on a computer reads the targets and «ترحيل جماعي: 14 متابعة» with each move, and
// changes a target (marked). Every screen at 320 and 360 px phones, a tablet upright and on its side and a computer, in Arabic and in English (no
// Arabic left but the names and the data), without sideways scrolling, every button at least 44 px high on a touch screen. Synthetic fixtures
// only: temporary SQLite, mocked sendmail.
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
// What the data holds (names, places, the follow-ups' next action): not the interface.
const NAMES = ['المشرف سالم', 'المندوب أحمد', 'مدير المبيعات', 'مدير النظام', 'مصنع رقم', 'مصنع الغد', 'متابعة العرض', 'الدمام', 'الشرقية'];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-plan-followups-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const SIZES = {phone320: {width: 320, height: 640}, phone360: {width: 360, height: 800}, tabletUp: {width: 768, height: 1024}, tabletSide: {width: 1024, height: 768}, desktop: {width: 1280, height: 900}};
const riyadh = at => new Date(at + 3 * 3600000).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
let wednesday = Date.parse(riyadh(Date.now()) + 'T17:30:00.000Z');
while (new Date(wednesday).getUTCDay() !== 3 || wednesday < Date.now()) wednesday += 86400000;
const offset = wednesday - Date.now();
const W = riyadh(wednesday), D = riyadh(wednesday + 86400000);
const pageNow = () => Date.now() + offset;

try {
  app = await bootBuiltApp({members}, {tls: true, env: {NODE_OPTIONS: '--import ' + new URL('../scripts/lib/shifted-clock.mjs', import.meta.url).href, TEST_CLOCK_OFFSET_MS: String(offset)}});
  const now = new Date(pageNow()).toISOString();
  const insert = (id, kind, parent, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,'rep1','الرئيسي',?,?,?,1,'fixture')").bind(id, kind, parent, JSON.stringify(data), now, now).run();
  const followup = async (id, name, nextDate) => {
    await insert(id, 'customer', null, {name, branch: 'الرئيسي', assignedTo: 'rep1', region: 'الشرقية', city: 'الدمام', customerStatus: 'نشط', location: '26.43, 50.03', internalCode: 'YR-' + id});
    await insert('f-' + id, 'activity', id, {type: 'call', date: addDays(W, -60), summary: 'متابعة سابقة', result: 'تمت', performedBy: 'rep1', responsibleId: 'rep1', recordedByEmail: 'rep1@yourrest.org', nextAction: 'متابعة العرض', nextDate, visitWorkflow: 'customer-v1'});
  };
  // 350 late follow-ups (dated over the last 50 days) and two due on Thursday.
  for (let i = 0; i < 350; i++) await followup('l' + String(i).padStart(3, '0'), 'مصنع رقم ' + String(i).padStart(3, '0'), addDays(W, -1 - (i % 50)));
  await followup('d1', 'مصنع الغد الأول', D); await followup('d2', 'مصنع الغد الثاني', D);
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});
  async function open(memberId, {viewport = SIZES.phone360, english = false, hash = '#plans', inApp = false} = {}) {
    const touch = viewport.width < 1100;
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: touch, isMobile: viewport.width < 700, geolocation: {latitude: 26.43, longitude: 50.03, accuracy: 10}, permissions: ['geolocation']});
    await context.clock.install({time: pageNow()});
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
  const nextOf = async id => JSON.parse((await app.db.prepare('SELECT data FROM crm_records WHERE id=?').bind('f-' + id).first()).data).nextDate;

  // ---- 1. The representative: the due follow-ups, the late list, the bulk moves, «تغيير الموعد», the targets.
  const rep = await open('rep1', {inApp: true});
  await rep.locator('[data-daily-plans="member"]').waitFor();
  check(await rep.locator(`[data-plan-day="${D}"]`).getAttribute('aria-pressed'), 'true', 'the plan of Thursday');
  await rep.locator('[data-plan-due]').waitFor();
  check([await rep.locator('[data-plan-due]').getAttribute('data-plan-due'), await rep.locator('[data-plan-overdue-count]').getAttribute('data-plan-overdue-count')], ['2', '350'], '«إضافة متابعات الغد (2)» and «المتابعات المتأخرة (350)»');
  check(await rep.locator('[data-plan-add] button').first().innerText(), 'إضافة متابعات الغد (2)', 'the button names tomorrow');
  check(await rep.locator('input[type=search]').count(), 0, 'no customer search: a customer without a follow-up is no longer added');
  await rep.locator('[data-plan-due]').click();
  check(await rep.locator('[data-plan-edit-stop] [data-plan-customer]').evaluateAll(items => items.map(item => item.dataset.planCustomer)), ['d1', 'd2'], 'the two due follow-ups added with one tap');
  let started = Date.now();
  await rep.locator('[data-plan-overdue-count]').click();
  await rep.locator('[data-overdue-row]').nth(29).waitFor();
  const opened = Date.now() - started;
  check(await rep.locator('[data-overdue-row]').count(), 30, '30 rows first');
  ok(opened < 4000, 'the list of 350 opens in ' + opened + ' ms on the phone');
  const firstDates = await rep.locator('[data-overdue-row] .plan-late-meta small').evaluateAll(items => items.slice(0, 2).map(item => item.textContent));
  ok(firstDates.length === 2, 'each row says its date');
  check(await rep.locator('[data-overdue-row] [data-days-late]').first().getAttribute('data-days-late'), '51', 'oldest first: 51 days late (to Thursday\'s plan: up to today, Wednesday)');
  await rep.locator('[data-overdue-more]').click();
  check(await rep.locator('[data-overdue-row]').count(), 60, '«عرض المزيد» shows 30 more');
  await rep.locator('.plan-late input[type=search]').fill('رقم 01');
  await rep.locator('[data-overdue-row]').nth(9).waitFor();
  check(await rep.locator('[data-overdue-row]').count(), 10, 'the search: 10 follow-ups');
  await rep.locator('[data-overdue-all]').check();
  check(await rep.locator('[data-overdue-selected]').getAttribute('data-overdue-selected'), '10', '«تحديد كل نتائج البحث»: 10');
  await noSideways(rep, 'the late list, 360 px');
  await tall(rep, '.daily-plans .btn, .daily-plans .icon-button', 'the late list');
  await shot(rep, 'plan-followups-late-ar-360');
  await rep.locator('[data-overdue-add]').click();
  await rep.locator('[data-bulk-report="10/10"]').waitFor();
  check(await rep.locator('[data-plan-edit-stop]').count(), 12, 'the ten moved to Thursday and added');
  check(await Promise.all(['l010', 'l015', 'l019'].map(nextOf)), [D, D, D], 'their date is Thursday on the server');
  // «ترحيل إلى تاريخ…»: three others to a day five days ahead.
  await rep.locator('.plan-late input[type=search]').fill('رقم 30');
  await rep.locator('[data-overdue-row]').nth(9).waitFor();
  for (const row of ['l300', 'l301', 'l302']) await rep.locator(`[data-overdue-row="${row}"] input`).check();
  await rep.locator('[data-overdue-move-open]').click();
  await rep.locator('[data-overdue-move] [data-followup-picker]').waitFor();
  const target = addDays(W, 5);
  check(await rep.locator('[data-bulk-limit]').getAttribute('data-bulk-limit'), addDays(W, 30), 'the limit: 30 days');
  const other = rep.locator('[data-overdue-move] .followup-picker-other');
  if (await other.count()) await other.click();
  const field = rep.locator('[data-overdue-move] input[type=date]');
  check(await field.getAttribute('max'), addDays(W, 30), 'the date field takes no day after 30');
  await field.fill(target);
  await shot(rep, 'plan-followups-move-ar-360');
  await rep.locator('[data-overdue-move]').locator('button').filter({hasText: 'ترحيل (3)'}).click();
  await rep.locator('[data-bulk-report="3/3"]').waitFor();
  check(await Promise.all(['l300', 'l301', 'l302'].map(nextOf)), [target, target, target], 'three moved to the chosen day');
  check(await rep.locator('[data-plan-edit-stop]').count(), 12, 'not added to Thursday\'s plan');
  // Without a network: the bulk actions say so and stay off.
  await rep.context().setOffline(true);
  await rep.evaluate(() => window.dispatchEvent(new Event('offline')));
  await rep.locator('[data-bulk-offline]').waitFor();
  check(await rep.locator('[data-overdue-move-open]').isDisabled(), true, 'offline: «ترحيل إلى تاريخ…» is off');
  await rep.context().setOffline(false);
  await rep.evaluate(() => window.dispatchEvent(new Event('online')));
  await rep.locator('[data-plan-overdue-count]').click();
  // «تغيير الموعد» of a stop to another day: the warning, then the stop leaves the plan.
  await rep.locator('[data-plan-reschedule-open="d2"]').click();
  const panel = rep.locator('[data-plan-reschedule="d2"]');
  const otherDay = panel.locator('.followup-picker-other');
  if (await otherDay.count()) await otherDay.click();
  await panel.locator('input[type=date]').fill(addDays(W, 3));
  await panel.locator('[data-plan-leaving]').waitFor();
  ok((await panel.locator('[data-plan-leaving]').innerText()).includes('وتخرج المتابعة من خطة يوم'), 'the warning names the plan it leaves');
  check(await panel.locator('[data-plan-reschedule-save]').innerText(), 'نقل الموعد وإخراجها من الخطة', 'the button says it');
  await shot(rep, 'plan-followups-reschedule-ar-360');
  await panel.locator('[data-plan-reschedule-save]').click();
  await rep.locator('[data-plan-reschedule="d2"]').waitFor({state: 'detached'});
  check([await rep.locator('[data-plan-edit-stop] [data-plan-customer="d2"]').count(), await nextOf('d2')], [0, addDays(W, 3)], 'the stop left the plan and its date moved');
  // The targets, typed with Arabic digits, and the send.
  await rep.locator('[data-plan-target="opportunities"] input').fill('٣');
  await rep.locator('[data-plan-target="customers"] input').fill('51');
  check(await rep.locator('[data-plan-target="customers"] [role=alert]').innerText(), 'المستهدف عدد صحيح من 0 إلى 50.', '51 is refused on the screen');
  await rep.locator('[data-plan-target="customers"] input').fill('2');
  await rep.locator('[data-plan-send]').click();
  await rep.locator('[data-plan-card] [data-plan-state="sent"]').waitFor();
  check({...(await app.db.prepare("SELECT target_opportunities AS o,target_customers AS c,targets_edited AS e FROM crm_daily_plan_targets WHERE plan_id=?").bind('daily-plan:rep1:' + D).first())}, {o: 3, c: 2, e: 0}, 'the targets sent');
  await rep.context().close();

  // ---- 2. The supervisor: the targets, «ترحيل جماعي», a target changed.
  const sup = await open('sup', {viewport: SIZES.desktop});
  await sup.locator('[data-plan-row="rep1"]').waitFor();
  check(await sup.locator('[data-plan-row="rep1"] [data-row-bulk]').getAttribute('data-row-bulk'), '14', 'the list row: «ترحيل جماعي: 14 متابعة»');
  await sup.locator('[data-plan-row="rep1"]').click();
  const card = sup.locator(`[data-plan-card="rep1:${D}"]`);
  await card.locator('[data-bulk-moves]').waitFor();
  check(await card.locator('[data-bulk-moves] summary').innerText(), 'ترحيل جماعي: 14 متابعة', 'the plan card');
  await card.locator('[data-bulk-moves] summary').click();
  check(await card.locator('[data-bulk-moves] li').count(), 14, 'each move listed');
  ok((await card.locator('[data-plan-target-lines]').innerText()).includes('المستهدف 3'), 'the targets read');
  await card.locator('[data-plan-edit]').click();
  await card.locator('[data-plan-targets="edit"] [data-plan-target="customers"] input').fill('4');
  await card.locator('[data-plan-save-edit]').click();
  await card.locator('[data-plan-state="approved_edited"]').waitFor();
  await card.locator('[data-plan-target-lines] [data-targets-edited]').waitFor();
  check({...(await app.db.prepare("SELECT target_customers AS c,rep_target_customers AS r,targets_edited AS e FROM crm_daily_plan_targets WHERE plan_id=?").bind('daily-plan:rep1:' + D).first())}, {c: 4, r: 2, e: 1}, 'the supervisor\'s target, marked, the representative\'s kept');
  await noSideways(sup, 'the supervisor, desktop');
  await shot(sup, 'plan-followups-supervisor-ar-desktop');
  await sup.context().close();

  // ---- 3. Every size, both languages: the representative's plan with the late list open, and the supervisor's card.
  for (const [label, viewport] of Object.entries(SIZES)) for (const english of [false, true]) {
    const lang = english ? 'en' : 'ar', tag = label + ' ' + lang;
    const page = await open('rep1', {viewport, english, inApp: true});
    await page.locator(`[data-plan-day="${addDays(D, 2)}"]`).click();// Saturday's plan, editable
    await page.locator('[data-plan-overdue-count]').waitFor();
    await page.locator('[data-plan-overdue-count]').click();
    await page.locator('[data-overdue-row]').first().waitFor();
    await page.locator('[data-overdue-row] input').first().check();
    await page.locator('[data-overdue-move-open]').click();
    await page.locator('[data-overdue-move] [data-followup-picker]').waitFor();
    await noSideways(page, 'the late list and the picker ' + tag);
    if (viewport.width < 1100) await tall(page, '.daily-plans .btn, .daily-plans .icon-button', 'the late list ' + tag);
    if (english) check(await arabicLeft(page, '[data-daily-plans]'), [], 'the late list ' + tag + ': no Arabic left in English but the names and the data');
    await shot(page, `plan-followups-rep-${lang}-${label}`);
    await page.context().close();
    const reviewer = await open('sup', {viewport, english});
    await reviewer.locator('[data-plan-row="rep1"]').click();
    await reviewer.locator(`[data-plan-card="rep1:${D}"] [data-bulk-moves]`).waitFor();
    await reviewer.locator(`[data-plan-card="rep1:${D}"] [data-bulk-moves] summary`).click();
    await noSideways(reviewer, 'the supervisor ' + tag);
    if (english) {
      check(await reviewer.locator(`[data-plan-card="rep1:${D}"] [data-bulk-moves] summary`).innerText(), 'Bulk move: 14 follow-ups', 'the bulk moves in English');
      check(await arabicLeft(reviewer, '[data-daily-plans]'), [], 'the supervisor ' + tag + ': no Arabic left in English but the names and the data');
    }
    await shot(reviewer, `plan-followups-supervisor-${lang}-${label}`);
    await reviewer.context().close();
  }
  check(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks, screenshots, days: {W, D}}));
} finally {
  await browser?.close();
  await app?.stop();
}
