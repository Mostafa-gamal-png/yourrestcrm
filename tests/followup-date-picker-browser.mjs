// «اختيار موعد المتابعة» (GSCO 2.13.84, 2026-11-19; app/followup-date-picker.tsx, lib/followup-day-picker.ts) in a real Chromium against the
// BUILT release (run the build first). Synthetic data only: temporary SQLite, mocked sendmail, made-up places around one point in Dammam.
// - The representative in the Android app's emulator, a new visit on a phone of 360 px in Arabic: 14 days from tomorrow, the counts of their
//   own follow-ups (the customer being visited left out, another representative's never), the Fridays «إجازة», a full day «ممتلئ», a
//   scattered one «متفرق», «📍 2 قريبة», the suggestion «الأنسب» with «اختيار هذا اليوم», what each day chosen means (near, full and far,
//   scattered, far with the city), «تاريخ آخر» and its date field, the keyboard (arrows, Home, End, one tab stop), the names a screen
//   reader hears, a tap; the visit saved with the day chosen.
// - The follow-up executed from the follow-ups page: the same picker, saved with its day.
// - Without a network (the page already open): the same days from the records on the device.
// - A customer without a pin: the counts only. English with no Arabic left. A supervisor on a computer reads the representative's.
// - Phones of 320 and 360 px, a tablet upright and on its side and a computer: 7 days a row (5 on 320), every day 40 px wide at least and
//   inside the screen, nothing scrolls sideways, no text under 12 px; screenshots (YR_GATE_SCREENSHOT_DIR, else a temporary folder).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [{id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'مدير المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'sm', name: 'المشرف سالم'},
  {id: 'rep', role: 'rep', sup: 'sup', name: 'أحمد المندوب'}, {id: 'rep2', role: 'rep', sup: 'sup', name: 'خالد المندوب'}];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-followup-picker-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
const SIZES = {phone320: {width: 320, height: 640}, phone360: {width: 360, height: 800}, tabletUp: {width: 768, height: 1024}, tabletSide: {width: 1024, height: 768}, desktop: {width: 1366, height: 900}};
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
// The day is Riyadh's; a run that starts a few minutes before midnight waits for the new day (the days are worked out once).
const riyadhClock = () => new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date());
while (riyadhClock() >= '23:50') await new Promise(resolve => setTimeout(resolve, 20000));
const TODAY = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date());
const addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = day => new Date(day + 'T12:00:00Z').getUTCDay();
const DAYS = Array.from({length: 14}, (_, i) => addDays(TODAY, i + 1)), FRIDAYS = DAYS.filter(day => weekday(day) === 5), WORKING = DAYS.filter(day => weekday(day) !== 5);
const [FULL, NEAR, SCATTERED, FAR] = WORKING;
const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'], EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'], EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const title = (day, lang = 'ar') => { const [y, m, d] = day.split('-').map(Number), year = y === Number(TODAY.slice(0, 4)) ? '' : ' ' + y; return lang === 'en' ? `${EN_DAYS[weekday(day)]} ${d} ${EN_MONTHS[m - 1]}${year}` : `${AR_DAYS[weekday(day)]} ${d} ${AR_MONTHS[m - 1]}${year}`; };
// Made-up places: the customer being visited in Dammam, the others north or east of it (1 degree of latitude = 111.195 km).
const HERE = {latitude: 26.437341, longitude: 50.034499, accuracy: 8}, KM = 6371 * Math.PI / 180;
const north = km => ({latitude: HERE.latitude + km / KM, longitude: HERE.longitude}), east = km => ({latitude: HERE.latitude, longitude: HERE.longitude + km / (KM * Math.cos(HERE.latitude * Math.PI / 180))});

try {
  app = await bootBuiltApp({members}, {tls: true});
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});
  const created = new Date(Date.now() - 2 * 86400000).toISOString();
  const insert = (id, kind, parent, assigned, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,'الرئيسي',?,?,?,1,'fixture')").bind(id, kind, parent, assigned, JSON.stringify(data), created, created).run();
  const customer = (id, name, assignedTo, point, city = 'الدمام') => insert(id, 'customer', null, assignedTo, {name, region: 'الشرقية', city, phone: '0551234567', contact: 'م', code: id, branch: 'الرئيسي', assignedTo,
    ...(point ? {location: `${point.latitude.toFixed(7)}, ${point.longitude.toFixed(7)}`, latitude: point.latitude, longitude: point.longitude} : {})});
  let number = 100;
  const plan = (customerId, by, nextDate) => insert('plan-' + customerId, 'activity', customerId, by, {visitWorkflow: 'customer-v1', type: 'visit', date: created.slice(0, 10), summary: 'تعريف بمنتجات الشركة', result: 'متابعة العميل', salesStage: 'new',
    nextAction: 'متابعة العرض', nextDate, performedBy: by, responsibleId: by, recordedByEmail: by + '@yourrest.org', visitNumber: ++number});
  await customer('here', 'مصنع الموقع', 'rep', HERE); await plan('here', 'rep', FAR);   // its own date is never counted with it
  await customer('nopin', 'مصنع بلا موقع', 'rep', null);
  for (let i = 0; i < 6; i++) { await customer('full' + i, 'مصنع الشمال ' + (i + 1), 'rep', north(30 + i * 0.3), 'القطيف'); await plan('full' + i, 'rep', FULL); }
  await customer('near1', 'مصنع الجار الأول', 'rep', north(0.6)); await plan('near1', 'rep', NEAR);
  await customer('near2', 'مصنع الجار الثاني', 'rep', east(0.9)); await plan('near2', 'rep', NEAR);
  await customer('spread1', 'مصنع قريب جدًا', 'rep', north(0.4)); await plan('spread1', 'rep', SCATTERED);
  await customer('spread2', 'مصنع الخبر الأول', 'rep', north(15), 'الخبر'); await plan('spread2', 'rep', SCATTERED);
  await customer('spread3', 'مصنع الأحساء', 'rep', east(40), 'الأحساء'); await plan('spread3', 'rep', SCATTERED);
  await customer('far1', 'مصنع الخبر الثاني', 'rep', north(12), 'الخبر'); await plan('far1', 'rep', FAR);
  await customer('far2', 'مصنع الخبر الثالث', 'rep', north(12.6), 'الخبر'); await plan('far2', 'rep', FAR);
  await customer('other', 'مصنع خالد', 'rep2', north(0.5)); await plan('other', 'rep2', NEAR);   // another representative's: never counted for rep
  const EXPECTED = Object.fromEntries(DAYS.map(day => [day, day === FULL ? 6 : day === NEAR ? 2 : day === SCATTERED ? 3 : day === FAR ? 2 : 0]));

  async function open(who, {viewport = SIZES.phone360, english = false, inApp = who === 'rep'} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: viewport.width < 1100, isMobile: viewport.width < 500, geolocation: HERE, permissions: ['geolocation']});
    const [name, ...value] = (await app.login(who)).split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    await context.addInitScript(lang => { try { localStorage.setItem('yr-language', lang); } catch { /* storage unavailable */ } }, english ? 'en' : 'ar');
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(who + ': ' + error.message));
    if (inApp) await installNativeBridge(page, {memberId: who, regionScope: 'all'});
    await page.goto(app.origin + '/');
    await page.waitForFunction(lang => document.documentElement.lang === lang, english ? 'en' : 'ar');
    await page.locator('.workspace').waitFor();
    return page;
  }
  const settle = page => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const shot = async (page, element, label) => { await element.evaluate(node => node.scrollIntoView({block: 'center'})); await settle(page); await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const goVisits = async page => {
    if (await page.locator('.mobile-bottom-navigation').isVisible()) { await page.locator('.mobile-tab[data-page="activity"]').click(); await page.locator('.mobile-tab[data-page="activity"][aria-current="page"]').waitFor(); }
    else await page.goto(app.origin + '/#activity');
    await page.locator('.page-heading').waitFor();
  };
  const openNewVisit = async (page, label = 'زيارة جديدة') => { await page.locator('.heading-actions').getByRole('button', {name: label, exact: true}).click(); const dialog = page.getByRole('dialog'); await dialog.waitFor(); return dialog; };
  const chooseCustomer = async (dialog, name) => { await dialog.locator('#visit-customer-search').fill(name); await dialog.getByRole('option').filter({hasText: name}).click(); await dialog.locator('.visit-selected-customer').filter({hasText: name}).waitFor(); };
  const pick = async (page, scope, name, option) => { await scope.getByRole('combobox', {name, exact: true}).click(); await page.getByRole('option', {name: option, exact: true}).click(); await page.getByRole('option').first().waitFor({state: 'hidden'}); };
  const picker = scope => scope.locator('[data-followup-picker]');
  const state = scope => picker(scope).evaluate(element => ({
    days: [...element.querySelectorAll('[role=radio]')].map(button => ({date: button.dataset.date, count: Number(button.querySelector('.followup-picker-count').textContent), checked: button.getAttribute('aria-checked') === 'true',
      tag: button.querySelector('.followup-picker-tag')?.textContent || '', near: button.querySelector('.followup-picker-near')?.textContent || '', label: button.getAttribute('aria-label'), tab: button.tabIndex, off: button.hasAttribute('data-off'), background: getComputedStyle(button).backgroundColor})),
    best: element.querySelector('.followup-picker-best p')?.textContent || '', status: element.querySelector('[data-followup-status]')?.innerText.replace(/\s+/g, ' ').trim() || '',
    field: !!element.querySelector('input[type=date]'), legend: element.querySelector('.followup-picker-legend')?.textContent || '', text: element.innerText}));
  const day = (scope, date) => picker(scope).locator('[role=radio][data-date="' + date + '"]');
  const status = scope => picker(scope).locator('[data-followup-status]');
  // The grid at this size: its columns and rows, the narrowest day, every day inside the grid and the screen, no sideways scroll of the page
  // or of the form, no text under 12 px.
  async function layout(page, scope, label, columns) {
    const g = await picker(scope).locator('.followup-picker-grid').evaluate(grid => {
      const cells = [...grid.children].map(cell => cell.getBoundingClientRect()), box = grid.getBoundingClientRect();
      const small = [...grid.closest('[data-followup-picker]').querySelectorAll('*')].filter(node => [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim()) && node.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(node).fontSize) < 12).map(node => node.textContent.trim().slice(0, 20));
      const scroller = grid.closest('.visit-form-scroll');
      return {columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, rows: new Set(cells.map(rect => Math.round(rect.top))).size, narrowest: Math.round(Math.min(...cells.map(rect => rect.width))), lowest: Math.round(Math.min(...cells.map(rect => rect.height))),
        inside: cells.every(rect => rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.left >= 0 && rect.right <= innerWidth + 1), small, page: document.documentElement.scrollWidth > innerWidth + 1, form: scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : false};
    });
    check([g.columns, g.rows], [columns, Math.ceil(14 / columns)], label + ': ' + columns + ' days a row');
    ok(g.narrowest >= 40 && g.lowest >= 44, label + ': every day at least 40 px wide and 44 high (' + g.narrowest + 'x' + g.lowest + ')');
    check([g.inside, g.page, g.form], [true, false, false], label + ': every day inside the grid and the screen, nothing scrolls sideways');
    check(g.small, [], label + ': no text under 12 px');
  }

  // ---- 1. The representative in the app, a phone of 360 px, Arabic: a new visit.
  let page = await open('rep');
  await goVisits(page);
  let dialog = await openNewVisit(page);
  await chooseCustomer(dialog, 'مصنع الموقع');
  await picker(dialog).waitFor();
  let s = await state(dialog);
  check(s.days.map(item => item.date), DAYS, 'the 14 days from tomorrow (Riyadh)');
  check(Object.fromEntries(s.days.map(item => [item.date, item.count])), EXPECTED, 'each day: the representative\'s own follow-ups (the customer being visited and another representative\'s left out)');
  check(s.days.filter(item => item.off).map(item => item.date), FRIDAYS, 'the Fridays are the day off');
  ok(s.days.filter(item => item.off).every(item => item.tag === 'إجازة' && item.label.includes('إجازة')), 'and say «إجازة»');
  ok(s.days.find(item => item.off).background !== s.days.find(item => item.date === WORKING[5]).background, 'in grey');
  check([s.days.find(item => item.date === FULL).tag, s.days.find(item => item.date === SCATTERED).tag], ['ممتلئ', 'متفرق'], 'six follow-ups: «ممتلئ»; three areas: «متفرق»');
  check([s.days.find(item => item.date === NEAR).near, s.days.find(item => item.date === SCATTERED).near, s.days.find(item => item.date === FAR).near], ['📍 2 قريبة', '📍 1 قريبة', ''], 'the near ones: «📍 2 قريبة», «📍 1 قريبة»; 12 km: none');
  check(s.best, 'الأنسب: ' + title(NEAR) + ' — متابعتان قريبتان من هذا العميل', 'the suggestion: the day of two near follow-ups');
  check([s.field, await dialog.locator('#visit-next-date').inputValue()], [true, TODAY], 'today (the form\'s default) is not one of the 14 days: the date field is open with it');
  check(s.status, 'الموعد المختار: ' + title(TODAY) + ' (اليوم)' + (weekday(TODAY) === 5 ? ' هذا اليوم إجازة أسبوعية (الجمعة). يمكنك اختياره رغم ذلك.' : ''), 'the chosen date said');
  check(s.days.filter(item => item.tab === 0).map(item => item.date), [DAYS[0]], 'one tab stop: the first day');
  await layout(page, dialog, 'phone360 ar', 7);
  await shot(page, picker(dialog), 'picker-phone360-ar');
  await picker(dialog).getByRole('button', {name: 'اختيار هذا اليوم', exact: true}).click();
  s = await state(dialog);
  check([s.days.filter(item => item.checked).map(item => item.date), s.field], [[NEAR], false], '«اختيار هذا اليوم»: the day checked, the date field behind «تاريخ آخر» again');
  check(s.status, 'الموعد المختار: ' + title(NEAR) + ' يوم مناسب: لديك متابعات قريبة من هذا العميل.', 'a near day: «يوم مناسب»');
  check(await status(dialog).getAttribute('role'), 'status', 'said to a screen reader as a status');
  await day(dialog, FULL).tap();
  s = await state(dialog);
  check(s.status, 'الموعد المختار: ' + title(FULL) + ' هذا اليوم ممتلئ: 6 متابعات (الحد 5). يمكنك اختياره رغم ذلك. متابعاتك في هذا اليوم في القطيف، بعيدًا عن هذا العميل (30 كم).', 'a full day (a tap): only a warning, and where that day\'s follow-ups are');
  check(s.days.find(item => item.date === FULL).checked, true, 'the full day stays chosen');
  await day(dialog, SCATTERED).click();
  check((await state(dialog)).status, 'الموعد المختار: ' + title(SCATTERED) + ' متابعاتك في هذا اليوم متفرقة في 3 مناطق، منها واحدة قريبة من هذا العميل.', 'a scattered day');
  await day(dialog, FAR).click();
  check((await state(dialog)).status, 'الموعد المختار: ' + title(FAR) + ' متابعاتك في هذا اليوم في الخبر، بعيدًا عن هذا العميل (12 كم).', 'a far day: the city of that day\'s follow-ups');
  await shot(page, picker(dialog), 'picker-far-phone360-ar');
  await day(dialog, FRIDAYS[0]).click();
  ok((await state(dialog)).status.includes('هذا اليوم إجازة أسبوعية (الجمعة). يمكنك اختياره رغم ذلك.'), 'the day off can be chosen, and says so');
  // The keyboard: one radio group, the arrows follow the reading direction.
  await day(dialog, NEAR).click();
  await day(dialog, NEAR).focus();
  await page.keyboard.press('ArrowLeft');
  const after = DAYS[DAYS.indexOf(NEAR) + 1];
  check([(await state(dialog)).days.filter(item => item.checked).map(item => item.date), await page.evaluate(() => document.activeElement?.dataset.date)], [[after], after], 'right to left: ← is the next day, chosen and focused');
  await page.keyboard.press('ArrowRight');
  check(await page.evaluate(() => document.activeElement?.dataset.date), NEAR, '→ the previous one');
  await page.keyboard.press('End');
  check((await state(dialog)).days.filter(item => item.checked).map(item => item.date), [DAYS[13]], 'End: the last day');
  await page.keyboard.press('Home');
  s = await state(dialog);
  check([s.days.filter(item => item.checked).map(item => item.date), s.days.filter(item => item.tab === 0).map(item => item.date)], [[DAYS[0]], [DAYS[0]]], 'Home: the first; the chosen day is the one tab stop');
  ok(await dialog.getByRole('radio', {name: title(NEAR) + ': متابعتان، متابعتان قريبتان من هذا العميل، الأنسب', exact: true}).count() === 1, 'a screen reader hears the day, its count, the near ones and «الأنسب»');
  ok(await dialog.getByRole('radiogroup', {name: 'الأيام الأربعة عشر القادمة', exact: true}).count() === 1, 'the days are a named radio group');
  // «تاريخ آخر»: the date field as it was, focused.
  await picker(dialog).getByRole('button', {name: 'تاريخ آخر', exact: true}).click();
  check(await page.evaluate(() => document.activeElement?.id), 'visit-next-date', '«تاريخ آخر» opens the date field and puts the cursor in it');
  const later = addDays(TODAY, 20);
  await dialog.locator('#visit-next-date').fill(later);
  s = await state(dialog);
  check([s.days.filter(item => item.checked).length, s.field, s.status], [0, true, 'الموعد المختار: ' + title(later)], 'a date after the 14 days: no day checked, the field stays open');
  // Saved with the day chosen.
  await dialog.locator('.location-status').filter({hasText: 'تم تحديد الموقع تلقائيًا'}).waitFor();
  await pick(page, dialog, 'اختر الهدف من الزيارة', 'تعريف بمنتجات الشركة');
  await pick(page, dialog, 'نتيجة الزيارة', 'متابعة العميل');
  await dialog.getByRole('textbox', {name: /^الإجراء القادم/}).fill('إرسال عرض السعر');
  await day(dialog, NEAR).click();
  await dialog.getByRole('button', {name: 'حفظ الزيارة', exact: true}).click();
  await dialog.waitFor({state: 'detached'});
  const savedVisit = await app.db.prepare("SELECT data FROM crm_records WHERE kind='activity' AND parent_id='here' AND id<>'plan-here' ORDER BY created_at DESC LIMIT 1").first();
  check([JSON.parse(savedVisit.data).nextDate, JSON.parse(savedVisit.data).nextAction], [NEAR, 'إرسال عرض السعر'], 'the visit is saved with the day chosen in the grid');

  // ---- 2. The follow-up executed from the follow-ups page (the customer's plan is now the visit just saved: left out, as before).
  await page.locator('.mobile-tab[data-page="followup"]').click();
  const card = page.locator('.rep-record-card', {hasText: 'مصنع الموقع'});
  await card.getByRole('button', {name: 'تنفيذ المتابعة', exact: true}).click();
  dialog = page.locator('.followup-record-dialog');
  await picker(dialog).waitFor();
  s = await state(dialog);
  check(Object.fromEntries(s.days.map(item => [item.date, item.count])), EXPECTED, 'the follow-up form counts the same days');
  check(s.best, 'الأنسب: ' + title(NEAR) + ' — متابعتان قريبتان من هذا العميل', 'and suggests the same day');
  await layout(page, dialog, 'follow-up phone360 ar', 7);
  const trigger = dialog.locator('[aria-label="نوع المتابعة"]');
  await trigger.click(); await page.getByRole('listbox').getByRole('option', {name: 'اتصال', exact: true}).press('Enter'); await page.getByRole('listbox').waitFor({state: 'detached'});
  await dialog.locator('label.voice-field', {hasText: 'ما نتيجة المتابعة؟'}).locator('textarea').fill('العميل طلب موعدًا آخر');
  await day(dialog, SCATTERED).click();
  check((await state(dialog)).status, 'الموعد المختار: ' + title(SCATTERED) + ' متابعاتك في هذا اليوم متفرقة في 3 مناطق، منها واحدة قريبة من هذا العميل.', 'the follow-up form says what the day means');
  await shot(page, picker(dialog), 'picker-followup-phone360-ar');
  await dialog.getByRole('button', {name: 'حفظ المتابعة', exact: true}).click();
  await dialog.waitFor({state: 'detached'});
  const savedFollowup = await app.db.prepare("SELECT data FROM crm_records WHERE parent_id='here' AND json_extract(data,'$.visitWorkflow')='followup-v1'").first();
  check(JSON.parse(savedFollowup.data).nextDate, SCATTERED, 'the follow-up is saved with its day');
  await page.context().close();

  // ---- 3. Without a network: the page already open, the days are worked out from the records on the device.
  page = await open('rep');
  await goVisits(page);
  // The form opened once online, so whatever it loads is on the phone, then closed untouched.
  dialog = await openNewVisit(page);
  await dialog.getByRole('button', {name: 'إلغاء', exact: true}).click();
  await dialog.waitFor({state: 'detached'});
  await page.context().setOffline(true);
  check(await page.evaluate(() => navigator.onLine), false, 'the phone has no network');
  dialog = await openNewVisit(page);
  await chooseCustomer(dialog, 'مصنع الجار الأول');
  await picker(dialog).waitFor();
  s = await state(dialog);
  // For «مصنع الجار الأول»: its own follow-up is left out; «مصنع الموقع» now follows up on the scattered day (the follow-up of part 2).
  check(s.days.find(item => item.date === NEAR).count, 1, 'offline: the near day has the other near follow-up only (this customer\'s own left out)');
  check([s.days.find(item => item.date === FULL).count, s.days.find(item => item.date === SCATTERED).count, s.days.find(item => item.date === FAR).count], [6, 4, 2], 'offline: the other days from the records on the phone (with the follow-up just saved)');
  ok(s.best.startsWith('الأنسب: '), 'offline: a suggestion');
  await day(dialog, FULL).click();
  ok((await state(dialog)).status.includes('هذا اليوم ممتلئ: 6 متابعات (الحد 5).'), 'offline: choosing a day says what it means');
  await shot(page, picker(dialog), 'picker-offline-phone360-ar');
  await page.context().setOffline(false);
  await page.context().close();

  // ---- 4. A customer without a pin: the counts only. Phone of 320 px: five days a row.
  page = await open('rep', {viewport: SIZES.phone320});
  await goVisits(page);
  dialog = await openNewVisit(page);
  await chooseCustomer(dialog, 'مصنع بلا موقع');
  await picker(dialog).waitFor();
  s = await state(dialog);
  check(Object.fromEntries(s.days.map(item => [item.date, item.count])), {...EXPECTED, [SCATTERED]: 4}, 'no pin: the counts («مصنع الموقع» on the day of its latest follow-up, part 2)');
  ok(!s.text.includes('📍') && !s.days.some(item => item.tag === 'متفرق'), 'no pin: no nearness and no «متفرق»');
  ok(s.legend.includes('لا موقع محفوظًا لهذا العميل، فلا تظهر المتابعات القريبة.'), 'and the legend says why');
  check(s.best, 'الأنسب: ' + title(WORKING[4]) + ' — لا متابعات لديك فيه', 'the lightest day suggested (the first working day without a follow-up)');
  await layout(page, dialog, 'phone320 ar', 5);
  await shot(page, picker(dialog), 'picker-phone320-ar');
  await page.context().close();

  // ---- 5. English: phones of 320 and 360 px, no Arabic left in the picker.
  for (const [size, columns] of [['phone320', 5], ['phone360', 7]]) {
    page = await open('rep', {viewport: SIZES[size], english: true});
    await goVisits(page);
    dialog = await openNewVisit(page, 'New visit');
    await chooseCustomer(dialog, 'مصنع الجار الثاني');
    await picker(dialog).waitFor();
    s = await state(dialog);
    ok(s.best.startsWith('Best: ') && s.best.includes(' — '), size + ' en: the suggestion in English: ' + s.best);
    await day(dialog, NEAR).click();
    s = await state(dialog);
    check(s.status, 'Chosen date: ' + title(NEAR, 'en') + ' A good day: you have follow-ups near this customer.', size + ' en: a near day');
    ok(!/[؀-ۿ]/.test(s.text), size + ' en: no Arabic in the picker: ' + (s.text.match(/[؀-ۿ][^\n]*/g) || []).join(' | '));
    ok(s.days.filter(item => item.off).every(item => item.tag === 'Day off') && s.days.find(item => item.date === FULL).tag === 'Full', size + ' en: «Day off», «Full»');
    await day(dialog, NEAR).focus(); await page.keyboard.press('ArrowRight');
    check(await page.evaluate(() => document.activeElement?.dataset.date), DAYS[DAYS.indexOf(NEAR) + 1], size + ' en: left to right: → is the next day');
    await layout(page, dialog, size + ' en', columns);
    await shot(page, picker(dialog), 'picker-' + size + '-en');
    await page.context().close();
  }

  // ---- 6. A tablet upright and on its side (the representative in the app), Arabic and English.
  for (const size of ['tabletUp', 'tabletSide']) for (const english of [false, true]) {
    page = await open('rep', {viewport: SIZES[size], english});
    await goVisits(page);
    dialog = await openNewVisit(page, english ? 'New visit' : 'زيارة جديدة');
    await chooseCustomer(dialog, 'مصنع الموقع');
    await picker(dialog).waitFor();
    s = await state(dialog);
    check(s.days.length, 14, size + (english ? ' en' : ' ar') + ': 14 days');
    if (english) ok(!/[؀-ۿ]/.test(s.text), size + ' en: no Arabic left');
    await layout(page, dialog, size + (english ? ' en' : ' ar'), 7);
    await shot(page, picker(dialog), 'picker-' + size + (english ? '-en' : '-ar'));
    await page.context().close();
  }

  // ---- 7. A supervisor on a computer, a new visit for the representative's customer: the representative's follow-ups, by name.
  for (const english of [false, true]) {
    page = await open('sup', {viewport: SIZES.desktop, english, inApp: false});
    await goVisits(page);
    dialog = await openNewVisit(page, english ? 'New visit' : 'زيارة جديدة');
    await chooseCustomer(dialog, 'مصنع الجار الثاني');
    await picker(dialog).waitFor();
    s = await state(dialog);
    check(s.days.find(item => item.date === FULL).count, 6, 'the supervisor sees the representative\'s six');
    if (english) ok(s.legend.startsWith('The number on each day is أحمد المندوب\'s follow-ups'), 'en: the representative named (the name as stored)');
    else ok(s.legend.startsWith('الرقم في كل يوم عدد متابعات أحمد المندوب فيه'), 'the legend names the representative');
    await day(dialog, NEAR).click();
    check((await state(dialog)).status.split(english ? 'A good day' : 'يوم مناسب')[1], english ? ': أحمد المندوب has follow-ups near this customer.' : ': لدى أحمد المندوب متابعات قريبة من هذا العميل.', 'a near day for the representative');
    await layout(page, dialog, 'desktop ' + (english ? 'en' : 'ar'), 7);
    await shot(page, picker(dialog), 'picker-desktop-' + (english ? 'en' : 'ar'));
    await page.context().close();
  }

  ok(!errors.length, 'no uncaught page errors: ' + errors.join(' | '));
  console.log(JSON.stringify({ok: true, checks, screenshots, realChromium: true, syntheticFixtures: true}));
} finally {
  await browser?.close(); await app?.stop();
}
