// «خطة الغد» / «خطط المناديب» (app/daily-plans.tsx) in a real Chromium against the BUILT release (run the build first), the server's and the
// pages' clocks at a Wednesday 20:30 Riyadh (the day before Thursday's deadline, after 16:00). A representative in the Android app on a 360 px
// phone: the reminder card on the customers page opens «خطة الغد», two stops are chosen by typing (a visit, a call at 10:30) and sent
// (on time); without a network the plan of the next working day is kept on the device and goes when the connection is back, with the
// time «إرسال» was pressed. The supervisor on a computer: the list of the team, «اعتماد مع تعديل» adding a stop, the note, the Excel file
// (three sheets); «تقرير يوم المندوب» carries the day's plan. The representative sees the approved plan and, once it is returned, the
// supervisor's stop locked (no delete). Every screen at 320 and 360 px phones, a tablet upright and on its side and a computer, in Arabic and
// in English (no Arabic left but the names), without sideways scrolling, every button at least 44 px high on a touch screen. Then Saturday's
// deadline, midnight at the end of Friday (the owner, 2026-11-21), on two more boots of the release: at Friday 22:30 the representative's
// card and plan say «before midnight between Friday and Saturday» and nothing is late, at every size and in both languages, and the
// supervisor's list marks nobody past the deadline; at Saturday 00:00 the representative's card says the plan is late and the supervisor's
// card and list name who has not sent it. Screenshots for the report. Synthetic fixtures only: temporary SQLite, mocked sendmail.
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
const NAMES = ['المشرف سالم', 'المندوب أحمد', 'مسؤول التسويق', 'مدير المبيعات', 'مدير النظام', 'مصنع الشرق', 'مصنع الخليج', 'مصنع الدمام', 'خطة متوازنة', 'أضف مصنع الخليج زيارة', 'متابعة العرض', 'الدمام'];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-daily-plans-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const SIZES = {phone320: {width: 320, height: 640}, phone360: {width: 360, height: 800}, tabletUp: {width: 768, height: 1024}, tabletSide: {width: 1024, height: 768}, desktop: {width: 1280, height: 900}};
const riyadh = at => new Date(at + 3 * 3600000).toISOString().slice(0, 10);
// The coming Wednesday 20:30 Riyadh (17:30 UTC); D is its Thursday, S the Saturday after (Friday is off).
let wednesday = Date.parse(riyadh(Date.now()) + 'T17:30:00.000Z');
while (new Date(wednesday).getUTCDay() !== 3 || wednesday < Date.now()) wednesday += 86400000;
let offset = wednesday - Date.now();
const W = riyadh(wednesday), D = riyadh(wednesday + 86400000), S = riyadh(wednesday + 3 * 86400000);
const pageNow = () => Date.now() + offset;

try {
  app = await bootBuiltApp({members}, {tls: true, env: {NODE_OPTIONS: '--import ' + new URL('../scripts/lib/shifted-clock.mjs', import.meta.url).href, TEST_CLOCK_OFFSET_MS: String(offset)}});
  const now = new Date().toISOString();
  const insert = (id, kind, parent, assignedTo, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,'الرئيسي',?,?,?,1,'fixture')").bind(id, kind, parent, assignedTo, JSON.stringify(data), now, now).run();
  for (const [id, name, phone] of [['c1', 'مصنع الشرق', '0551111111'], ['c2', 'مصنع الخليج', '0552222222'], ['c3', 'مصنع الدمام', '0553333333']])
    await insert(id, 'customer', null, 'rep1', {name, branch: 'الرئيسي', assignedTo: 'rep1', region: 'الشرقية', city: 'الدمام', customerStatus: 'نشط', phone, contact: 'م', location: '26.43, 50.03'});
  // Since 2026-11-22 (GSCO 2.13.85) the plan's stops are the member's follow-ups: c1 and c2 are due on Thursday, c3 on Saturday.
  const followups = async () => { for (const [id, date] of [['c1', D], ['c2', D], ['c3', S]]) await insert('f-' + id, 'activity', id, 'rep1', {type: 'call', date: W, summary: 'متابعة سابقة', result: 'تمت', performedBy: 'rep1', responsibleId: 'rep1', recordedByEmail: 'rep1@yourrest.org', nextAction: 'متابعة العرض', nextDate: date, visitWorkflow: 'customer-v1'}); };
  await followups();
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});
  async function open(memberId, {viewport = SIZES.phone360, english = false, hash = '#plans', inApp = false} = {}) {
    const touch = viewport.width < 1100;
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: touch, isMobile: viewport.width < 700, geolocation: {latitude: 26.43, longitude: 50.03, accuracy: 8}, permissions: ['geolocation']});
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
  const plan = async (memberId, date) => { const row = await app.db.prepare('SELECT status,late,first_sent_source AS source,version FROM crm_daily_plans WHERE member_id=? AND date=?').bind(memberId, date).first(); return row ? {...row} : null; };
  // «إضافة متابعات الغد (N)» adds the follow-ups due on the plan's day; the targets are typed (required to send).
  const addDue = async page => { await page.locator('[data-plan-due]').click(); return page.locator('[data-plan-edit-stop]'); };
  const targets = async (page, opportunities, customers) => { await page.locator('[data-plan-target="opportunities"] input').fill(opportunities); await page.locator('[data-plan-target="customers"] input').fill(customers); };

  // ---- 1. The representative in the Android app on a 360 px phone: the card, the plan, the send.
  const rep = await open('rep1', {hash: '#customer', inApp: true});
  const card = rep.locator('[data-plan-inbox="member"]');
  await card.waitFor();
  ok((await card.innerText()).includes('خطة الغد لم تُرسل بعد'), 'the reminder card on the customers page: tomorrow\'s plan not sent');
  check(await card.locator('[data-plan-notify]').count(), 0, 'inside the Android app the device notification is not offered (its web view has none)');
  await tall(rep, '[data-plan-inbox] button', 'the card');
  await shot(rep, 'plans-rep-card-ar-360');
  await card.locator('[data-plan-inbox-line="due"] button').click();
  await rep.locator('[data-daily-plans="member"]').waitFor();
  check(await rep.locator(`[data-plan-day="${D}"]`).getAttribute('aria-pressed'), 'true', 'the card opens Thursday\'s plan');
  await rep.locator('[data-plan-deadline]').waitFor();
  check([await rep.locator('h1').count(), (await rep.locator('.page-heading h1').innerText()).trim()], [1, 'خطة الغد'], 'the representative\'s screen is «خطة الغد»');
  const added = await addDue(rep);
  check(await added.locator('[data-plan-customer]').evaluateAll(items => items.map(item => item.dataset.planCustomer)), ['c2', 'c1'], 'the two follow-ups due on Thursday added with one tap (by the customer\'s name)');
  await rep.locator('[data-plan-edit-stop="2"] .icon-button').first().click();// «نقل المحطة لأعلى»
  check(await added.locator('[data-plan-customer]').evaluateAll(items => items.map(item => item.dataset.planCustomer)), ['c1', 'c2'], 'reordered');
  const second = added.nth(1);
  await second.locator('.plan-kind').filter({hasText: 'اتصال'}).click();
  await second.locator('input[type=time]').fill('10:30');
  await targets(rep, '٠', '1');
  await noSideways(rep, 'the representative\'s plan, 360 px');
  await tall(rep, '.daily-plans .btn, .daily-plans .icon-button, .daily-plans .plan-day', 'the plan editor');
  await shot(rep, 'plans-rep-editor-ar-360');
  await rep.locator('[data-plan-send]').click();
  await rep.locator('[data-plan-card] [data-plan-state="sent"]').waitFor();
  check(await plan('rep1', D), {status: 'sent', late: 0, source: 'device', version: 1}, 'sent on time, by the device\'s clock (the outbox carries it)');
  await rep.locator('[data-plan-stop]').first().waitFor();
  check(await rep.locator('[data-plan-stop]').evaluateAll(items => items.map(item => item.querySelector('.plan-stop-title strong').textContent)), ['مصنع الشرق', 'مصنع الخليج'], 'the plan as sent');
  // Offline: Saturday's plan is kept on the device and goes when the connection is back.
  await rep.locator(`[data-plan-day="${S}"]`).click();
  await rep.locator('[data-plan-add]').waitFor();
  await rep.context().setOffline(true);
  await rep.evaluate(() => window.dispatchEvent(new Event('offline')));
  (await addDue(rep)).first().locator('.plan-kind').filter({hasText: 'واتساب'}).click();
  await targets(rep, '0', '0');
  await rep.locator('[data-plan-send]').click();
  await rep.locator('[data-plan-queued="pending"]').waitFor();
  check(await plan('rep1', S), null, 'nothing reached the server offline');
  await shot(rep, 'plans-rep-offline-ar-360');
  await rep.context().setOffline(false);
  await rep.evaluate(() => window.dispatchEvent(new Event('online')));
  for (let attempt = 0; attempt < 60 && !(await plan('rep1', S)); attempt++) await new Promise(resolve => setTimeout(resolve, 1000));
  const saturday = await plan('rep1', S);
  check([saturday?.status, saturday?.late, saturday?.source], ['sent', 0, 'device'], 'once back online the kept plan reached the server with the time it was sent');
  await rep.context().close();

  // ---- 2. The supervisor on a computer: the list, «اعتماد مع تعديل», the note, the Excel file, the day report.
  const sup = await open('sup', {viewport: SIZES.desktop});
  await sup.locator('[data-daily-plans="reviewer"]').waitFor();
  await sup.locator('[data-plan-row="rep1"]').waitFor();
  check(await sup.locator('[data-plan-row]').evaluateAll(items => items.map(item => item.dataset.planRow)), ['rep1', 'mk1'], 'the team: the plan waiting first, then the officer without one');
  await sup.locator('[data-plan-row="rep1"]').click();
  const detail = sup.locator(`[data-plan-card="rep1:${D}"]`);
  await detail.locator('[data-plan-edit]').click();
  // The supervisor adds nothing since 2026-11-22: he changes the second stop to a visit and the targets.
  await detail.locator('[data-plan-edit-stop="2"] .plan-kind').filter({hasText: 'زيارة'}).click();
  await detail.locator('[data-plan-targets="edit"] [data-plan-target="opportunities"] input').fill('2');
  await detail.locator('[data-plan-save-edit]').click();
  await detail.locator('[data-plan-state="approved_edited"]').waitFor();
  check(await detail.locator('[data-plan-stop]').evaluateAll(items => items.map(item => [item.querySelector('.plan-stop-title strong').textContent, !!item.querySelector('.plan-chip.supervisor')])), [['مصنع الشرق', false], ['مصنع الخليج', true]], 'the changed stop shows as the supervisor\'s');
  ok((await detail.locator('[data-plan-target-lines]').innerText()).includes('عدّل المشرف المستهدف'), 'the targets changed by the supervisor are marked');
  await sup.locator(`[data-plan-card="rep1:${D}"] [data-plan-note-input] textarea`).fill('خطة متوازنة');
  await sup.locator(`[data-plan-card="rep1:${D}"] [data-plan-note-save]`).click();
  // Saved: the reviewer's own note comes back with its «آخر حفظ» line.
  await sup.locator(`[data-plan-card="rep1:${D}"] .plan-my-note small`).waitFor();
  check(Number((await app.db.prepare('SELECT COUNT(*) n FROM crm_daily_plan_notes').first()).n), 1, 'the note saved');
  check([await sup.locator('h1').count(), await sup.locator('.page-export-action').count(), (await sup.locator('.page-heading h1').innerText()).trim()], [1, 0, 'خطط المناديب'], 'one title, the page\'s own, and no CSV button of the generic heading');
  await noSideways(sup, 'the supervisor, desktop');
  await shot(sup, 'plans-supervisor-ar-desktop');
  const [download] = await Promise.all([sup.waitForEvent('download'), sup.locator('[data-list-export="plans"] button').click()]);
  check(download.suggestedFilename(), 'Yourrest-daily-plans-' + D + '.xlsx', 'the Excel file of the day');
  const bytes = fs.readFileSync(await download.path());
  ok(bytes.subarray(0, 2).toString() === 'PK' && ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml'].every(name => bytes.includes(Buffer.from(name))), 'an .xlsx with three sheets');
  await sup.locator('.app-sidebar .nav-item').filter({hasText: 'تقرير يوم المندوب'}).click();
  await sup.locator('.journey-report select').selectOption('rep1');
  await sup.locator('[data-plan-day-panel] [data-plan-missing]').waitFor();
  ok((await sup.locator('[data-plan-day-panel]').innerText()).includes('لم يُرسل المندوب خطة لهذا اليوم'), '«تقرير يوم المندوب» carries the day\'s plan (none for today)');
  await shot(sup, 'plans-day-report-ar-desktop');
  await sup.context().close();

  // ---- 3. The representative: the approved plan; once returned, the supervisor's stop is locked.
  let back = await open('rep1', {inApp: true});
  await back.locator('[data-plan-card] [data-plan-state="approved_edited"]').waitFor();
  check(await back.locator('[data-plan-member-edit]').count(), 0, 'an approved plan cannot be edited');
  const version = (await plan('rep1', D)).version;
  const login = await app.login('sup');
  const returned = await app.as(login)('/api/daily-plans', {method: 'POST', body: {action: 'return', memberId: 'rep1', date: D, baseVersion: version, reason: 'أضف مصنع الخليج زيارة', requestId: crypto.randomUUID()}});
  check(returned.status, 200, 'returned by the supervisor');
  await back.reload();
  await back.locator('[data-plan-card] [data-plan-state="returned"]').waitFor();
  await back.locator('[data-plan-member-edit]').click();
  const locked = back.locator('[data-plan-locked="yes"]');
  check([await locked.count(), await locked.locator('[data-plan-remove]').count()], [1, 0], 'the supervisor\'s stop: shown, no delete');
  await shot(back, 'plans-rep-returned-ar-360');
  await back.context().close();

  // ---- 4. Every size, both languages: the representative (the app) and the supervisor.
  for (const [label, viewport] of Object.entries(SIZES)) for (const english of [false, true]) {
    const lang = english ? 'en' : 'ar';
    const page = await open('rep1', {viewport, english, inApp: true});
    await page.locator('[data-daily-plans="member"] [data-plan-card]').waitFor();
    await page.locator('[data-plan-card] [data-plan-state]').first().waitFor();
    await noSideways(page, 'representative ' + label + ' ' + lang);
    if (viewport.width < 1100) await tall(page, '.daily-plans .btn, .daily-plans .plan-day', 'representative ' + label + ' ' + lang);
    if (english) check(await arabicLeft(page, '[data-daily-plans]'), [], 'representative ' + label + ': no Arabic left in English but the names');
    await shot(page, `plans-rep-${lang}-${label}`);
    await page.context().close();
    const reviewer = await open('sup', {viewport, english});
    await reviewer.locator('[data-plan-row="rep1"]').click();
    await reviewer.locator(`[data-plan-card="rep1:${D}"]`).waitFor();
    await noSideways(reviewer, 'supervisor ' + label + ' ' + lang);
    if (viewport.width < 1100) await tall(reviewer, '.daily-plans .btn, .daily-plans .plan-day, .daily-plans .plan-row', 'supervisor ' + label + ' ' + lang);
    if (english) check(await arabicLeft(reviewer, '[data-daily-plans]'), [], 'supervisor ' + label + ': no Arabic left in English but the names');
    await shot(reviewer, `plans-supervisor-${lang}-${label}`);
    await reviewer.context().close();
  }
  // ---- 5. Saturday's deadline (2026-11-21): midnight at the end of Friday. The server and the pages at the coming Friday 22:30 Riyadh (19:30
  // UTC), then at the Saturday 00:00 after it; each a release booted with its own clock and the same made-up customers.
  let friday = Date.parse(riyadh(Date.now()) + 'T19:30:00.000Z');
  while (new Date(friday).getUTCDay() !== 5 || friday < Date.now()) friday += 86400000;
  const SAT = riyadh(friday + 3 * 3600000);
  const reboot = async at => {
    await app.stop();
    offset = at - Date.now();
    app = await bootBuiltApp({members}, {tls: true, env: {NODE_OPTIONS: '--import ' + new URL('../scripts/lib/shifted-clock.mjs', import.meta.url).href, TEST_CLOCK_OFFSET_MS: String(offset)}});
    for (const [id, name, phone] of [['c1', 'مصنع الشرق', '0551111111'], ['c2', 'مصنع الخليج', '0552222222'], ['c3', 'مصنع الدمام', '0553333333']])
      await insert(id, 'customer', null, 'rep1', {name, branch: 'الرئيسي', assignedTo: 'rep1', region: 'الشرقية', city: 'الدمام', customerStatus: 'نشط', phone, contact: 'م', location: '26.43, 50.03'});
    await followups();
  };
  await reboot(friday);
  for (const [label, viewport] of Object.entries(SIZES)) for (const english of [false, true]) {
    const lang = english ? 'en' : 'ar', tag = 'Friday 22:30 ' + label + ' ' + lang;
    const page = await open('rep1', {viewport, english, hash: '#customer', inApp: true});
    const card = page.locator('[data-plan-inbox="member"]');
    await card.waitFor();
    check(await card.locator('[data-plan-inbox-line]').evaluateAll(items => items.map(item => item.dataset.planInboxLine)), ['due'], tag + ': the card says «not sent yet», not late');
    ok((await card.innerText()).includes(english ? 'send it to your supervisor before midnight between Friday and Saturday.' : 'أرسلها للمشرف قبل منتصف الليل بين الجمعة والسبت.'), tag + ': the card names midnight between Friday and Saturday');
    ok(!(await card.innerText()).includes('22:00'), tag + ': and not 22:00');
    await noSideways(page, tag + ', the card');
    if (viewport.width < 1100) await tall(page, '[data-plan-inbox] button', tag + ', the card');
    if (english) check(await arabicLeft(page, '[data-plan-inbox]'), [], tag + ': the card has no Arabic left');
    if (label === 'phone360') await shot(page, `plans-friday-card-${lang}-${label}`);
    await card.locator('[data-plan-inbox-line="due"] button').click();
    await page.locator('[data-plan-deadline]').waitFor();
    check(await page.locator(`[data-plan-day="${SAT}"]`).getAttribute('aria-pressed'), 'true', tag + ': the card opens Saturday\'s plan');
    const deadline = await page.locator('[data-plan-deadline]').innerText();
    ok(deadline.includes(english ? 'midnight between Friday and Saturday' : 'منتصف الليل بين الجمعة والسبت') && deadline.includes('00:00') && !deadline.includes('22:00') && !deadline.includes('24:00') && !(english ? /late/i : /متأخرة/).test(deadline), tag + ': «' + deadline + '»');
    ok((await page.locator('.plan-intro').innerText()).includes(english ? 'Saturday\'s plan before midnight between Friday and Saturday' : 'وخطة يوم السبت قبل منتصف الليل بين الجمعة والسبت'), tag + ': the page names Saturday\'s deadline');
    // Each «آخر موعد للإرسال» of the plan (its line and the form's) is one element of plain text, not a flex box that would set its pieces
    // apart: the words, then the moment in brackets.
    check(await page.locator('[data-plan-deadline-words]').evaluateAll(items => items.map(item => [/flex|grid/.test(getComputedStyle(item).display), item.children.length, /^(منتصف الليل بين الجمعة والسبت|midnight between Friday and Saturday) \(\d{1,2} \S+[،,] 00:00\)$/.test(item.textContent)])), [[false, 0, true], [false, 0, true]], tag + ': the deadline written «words (day, 00:00)» as plain text');
    await noSideways(page, tag + ', the plan');
    if (viewport.width < 1100) await tall(page, '.daily-plans .btn, .daily-plans .plan-day', tag + ', the plan');
    if (english) check(await arabicLeft(page, '[data-daily-plans]'), [], tag + ': the plan has no Arabic left');
    await shot(page, `plans-friday-rep-${lang}-${label}`);
    await page.context().close();
  }
  for (const english of [false, true]) {
    const reviewer = await open('sup', {viewport: SIZES.desktop, english});
    await reviewer.locator('[data-plan-row="rep1"]').waitFor();
    check(await reviewer.locator('.plan-overdue').count(), 0, 'Friday 22:30, the supervisor ' + (english ? 'en' : 'ar') + ': nobody is past the deadline yet');
    await reviewer.context().close();
  }
  await reboot(friday + 90 * 60000);
  for (const english of [false, true]) {
    const lang = english ? 'en' : 'ar';
    const rep0 = await open('rep1', {viewport: SIZES.phone360, english, hash: '#customer', inApp: true});
    await rep0.locator('[data-plan-inbox-line="late"]').waitFor();
    ok((await rep0.locator('[data-plan-inbox="member"]').innerText()).includes(english ? 'The plan is late' : 'الخطة متأخرة'), 'Saturday 00:00, ' + lang + ': the card says Saturday\'s plan is late');
    await noSideways(rep0, 'Saturday 00:00 representative ' + lang);
    await shot(rep0, `plans-saturday-card-${lang}-phone360`);
    await rep0.context().close();
    const reviewer = await open('sup', {viewport: SIZES.desktop, english, hash: '#customer'});
    const missing = reviewer.locator('[data-plan-inbox-line="missing"]');
    await missing.waitFor();
    ok((await missing.innerText()).includes('المندوب أحمد') && (await missing.innerText()).includes('مسؤول التسويق'), 'Saturday 00:00, ' + lang + ': the supervisor\'s card names who has not sent it');
    if (english) check(await arabicLeft(reviewer, '[data-plan-inbox]'), [], 'Saturday 00:00: the supervisor\'s card has no Arabic left');
    await shot(reviewer, `plans-saturday-supervisor-card-${lang}-desktop`);
    await missing.locator('button').click();
    await reviewer.locator('[data-plan-row="rep1"]').waitFor();
    check(await reviewer.locator('.plan-overdue').count(), 2, 'Saturday 00:00, ' + lang + ': the card opens Saturday\'s list, both past the deadline');
    await shot(reviewer, `plans-saturday-supervisor-${lang}-desktop`);
    await reviewer.context().close();
  }
  check(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks, screenshots, days: {W, D, S, friday: riyadh(friday), saturday: SAT}}));
} finally {
  await browser?.close();
  await app?.stop();
}
