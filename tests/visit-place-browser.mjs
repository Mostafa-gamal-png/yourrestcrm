// A visit is recorded where the customer is, in a real Chromium against the BUILT release (run `pnpm build` first), with the browser's
// own geolocation moved by the test: a representative 2.2 km from the customer reads the refusal and cannot save; moving to the
// customer and tapping "Refresh device location" lets the visit save, with the distance kept on it; a stale far point is refused by
// the server and the refusal is kept in the customer's history; a customer with no place of their own takes the first visit's point,
// shown on their sheet, and the next visit from afar is held; a supervisor away from the customer saves, marked on the visit and in
// the list; offline, the refusal comes before anything is queued; and the English page says the same. The device, its consent and
// its GPS are the browser's emulation: no physical device claim is made.
// Synthetic isolated fixtures only: temporary SQLite, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require('playwright');
const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'سعد مدير المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'sm', name: 'ماجد المشرف'},
  {id: 'rep', role: 'rep', sup: 'sup', name: 'أحمد المندوب'}
];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-place-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1280, height: 900};
const HERE = {latitude: 26.437341, longitude: 50.034499, accuracy: 8};
const DEGREE = 6371000 * Math.PI / 180;
const north = (meters, base = HERE) => ({latitude: base.latitude + meters / DEGREE, longitude: base.longitude, accuracy: base.accuracy});
const NEAR = 'مصنع القريب', FAR = 'مصنع البعيد', NONE = 'مصنع بلا موقع';
const dayOf = offset => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date(Date.now() + offset * 86400000));

try {
  app = await bootBuiltApp({members}, {tls: true});
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  const sessions = {};
  for (const member of members) sessions[member.id] = await app.login(member.id);
  const as = id => app.as(sessions[id]);
  /** A signed-in page whose browser location is `point`; the test moves it with context.setGeolocation. A representative works in the
   * Android app emulator (the tracking gate lets only the app in) on a phone; the others use the desktop. */
  async function open(memberId, {viewport = memberId === 'rep' ? PHONE : DESKTOP, point = HERE, language = 'ar'} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', geolocation: point, permissions: ['geolocation']});
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    if (language === 'en') await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (memberId === 'rep') await installNativeBridge(page, {memberId: 'rep', regionScope: 'all'});
    await page.goto(app.origin + '/');
    await page.locator('.workspace').waitFor();
    return {page, context};
  }
  const settle = page => page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const shot = async (page, label) => { await settle(page); await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const noOverflow = async (page, label) => { const geometry = await page.evaluate(() => ({overflow: document.documentElement.scrollWidth > innerWidth + 1, width: innerWidth})); check(geometry.overflow, false, label + ': no horizontal overflow at ' + geometry.width + 'px'); };
  const pick = async (page, scope, name, option) => { await scope.getByRole('combobox', {name, exact: true}).click(); await page.getByRole('option', {name: option, exact: true}).click(); await page.getByRole('option').first().waitFor({state: 'hidden'}); };
  const goActivity = async page => { await page.locator('button.nav-item', {hasText: 'الزيارات'}).first().click(); await page.locator('.page-heading h1', {hasText: 'الزيارات'}).waitFor(); };
  const goPhone = async (page, id) => { await page.locator('.mobile-bottom-navigation').waitFor(); await page.locator('.mobile-tab[data-page="' + id + '"]').click(); await page.locator('.mobile-tab[data-page="' + id + '"][aria-current="page"]').waitFor(); await page.locator('.page-heading').waitFor(); };
  const openNewVisit = async page => { await page.locator('.heading-actions').getByRole('button', {name: 'زيارة جديدة', exact: true}).click(); const dialog = page.getByRole('dialog'); await dialog.waitFor(); return dialog; };
  const chooseCustomer = async (dialog, name) => { await dialog.locator('#visit-customer-search').fill(name); await dialog.getByRole('option').filter({hasText: name}).click(); await dialog.locator('.visit-selected-customer').filter({hasText: name}).waitFor(); };
  const fillVisit = async (page, dialog, next = 'متابعة المواصفات') => {
    await pick(page, dialog, 'اختر الهدف من الزيارة', 'تعريف بمنتجات الشركة');
    await pick(page, dialog, 'نتيجة الزيارة', 'متابعة العميل');
    await dialog.getByRole('textbox', {name: /^الإجراء القادم/}).fill(next);
  };
  // Leaving a form that has been touched asks first; both answers end with the dialog gone.
  const closeDialog = async dialog => {
    await dialog.getByRole('button', {name: 'إلغاء', exact: true}).click();
    const discard = dialog.getByRole('button', {name: 'خروج بدون حفظ', exact: true});
    await Promise.race([dialog.waitFor({state: 'detached'}), discard.waitFor({state: 'visible'})]);
    if (await dialog.count()) await discard.click();
    await dialog.waitFor({state: 'detached'});
  };
  const saveButton = dialog => dialog.getByRole('button', {name: 'حفظ الزيارة', exact: true});
  const placeBox = dialog => dialog.locator('.visit-place');
  const visits = async () => (await app.db.prepare("SELECT id,assigned_to AS owner,data FROM crm_records WHERE kind='activity' ORDER BY created_at,id").all()).results.map(row => ({...row, data: JSON.parse(row.data)}));
  const customerRow = async id => { const found = await app.db.prepare('SELECT data,version FROM crm_records WHERE id=?').bind(id).first(); return {version: found.version, data: JSON.parse(found.data)}; };
  const audits = async action => (await app.db.prepare('SELECT record_id AS recordId,actor,detail FROM crm_audit WHERE action=? ORDER BY created_at,id').bind(action).all()).results;

  // ---- fixtures: a customer exactly where the browser is, one 2.2 km north of it, one with no place of their own
  const created = new Date().toISOString();
  const customer = (id, name, point) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')")
    .bind(id, JSON.stringify({name, region: 'الشرقية', city: 'الدمام', phone: '0551234567', contact: 'م', code: id, branch: 'الرئيسي', assignedTo: 'rep', ...(point ? {location: `${point.latitude.toFixed(7)}, ${point.longitude.toFixed(7)}`, latitude: point.latitude, longitude: point.longitude, locationSource: 'device', locationCapturedAt: created, locationAccuracy: 8} : {location: ''})}), created, created).run();
  const FAR_POINT = north(2224);
  await customer('near', NEAR, HERE); await customer('far', FAR, FAR_POINT); await customer('none', NONE, null);

  // ---- 1. A representative 2.2 km from the customer: the refusal, and no way to save
  const first = await open('rep');
  const rep = first.page;
  {
    await goPhone(rep, 'activity');
    const dialog = await openNewVisit(rep);
    await chooseCustomer(dialog, FAR);
    await dialog.locator('.location-status').filter({hasText: 'تم تحديد الموقع تلقائيًا'}).waitFor();
    await fillVisit(rep, dialog);
    const box = placeBox(dialog);
    await box.waitFor();
    check([await box.getAttribute('data-state'), await box.getAttribute('data-blocked'), await box.getAttribute('role')], ['far', 'true', 'alert'], 'the form reports the visit as far, held, and as an alert');
    const message = await box.innerText();
    ok(/^لا يمكن تسجيل الزيارة إلا عند العميل\. أنت على بعد 222\d متر من موقع «مصنع البعيد» \(الدقة ±8 متر\)\. انتقل إلى موقع العميل ثم اضغط تحديث موقع الجهاز\.$/.test(message.trim()), 'with the distance, the customer and what to do: ' + message);
    check(await saveButton(dialog).isDisabled(), true, 'the save button is disabled, though every field is filled');
    check((await dialog.locator('.visit-save-hint[role=alert]').innerText()).trim(), message.trim(), 'and the same words stand beside the button');
    await noOverflow(rep, 'phone refusal');
    await shot(rep, 'place-rep-far-phone');

    // moving to the customer and refreshing the device location releases it
    await first.context.setGeolocation(north(2224 + 40));
    check(await saveButton(dialog).isDisabled(), true, 'moving does nothing by itself: the point is taken when asked');
    await dialog.getByRole('button', {name: 'تحديث موقع الجهاز', exact: true}).click();
    await rep.locator('.visit-place[data-state="near"]').waitFor();
    check([await box.getAttribute('data-blocked'), await box.getAttribute('role')], ['false', 'status'], 'taking the point again at the customer lifts the hold');
    ok(/^أنت عند العميل \(على بعد 4\d م\)\.$/.test((await box.innerText()).trim()), 'and says how far: ' + (await box.innerText()));
    check(await saveButton(dialog).isDisabled(), false, 'the save button is enabled');
    await shot(rep, 'place-rep-near-phone');
    const before = (await visits()).length;
    const response = rep.waitForResponse(r => new URL(r.url()).pathname === '/api/visits' && r.request().method() === 'POST');
    await saveButton(dialog).click();
    check((await response).status(), 200, 'the visit saves');
    await dialog.waitFor({state: 'detached'});
    const all = await visits();
    check(all.length, before + 1, 'one visit was recorded');
    const saved = all.at(-1);
    ok(typeof saved.data.placeDistance === 'number' && saved.data.placeDistance > 30 && saved.data.placeDistance < 50 && saved.data.placeOutside === undefined, 'it keeps how far from the customer it was recorded (' + saved.data.placeDistance + ' m) and is not marked away');
  }

  // ---- 2. A stale point reaches the server: refused with the same words, and kept in the customer's history once
  {
    const version = (await customerRow('far')).version;
    const body = {createKey: crypto.randomUUID(), customerId: 'far', customerVersion: version, timingMode: 'automatic', elapsedMilliseconds: 4000,
      data: {type: 'visit', date: dayOf(0), summary: 'تعريف بمنتجات الشركة', result: 'متابعة العميل', nextAction: 'متابعة المواصفات', nextDate: dayOf(3), location: `${HERE.latitude}, ${HERE.longitude}`, latitude: HERE.latitude, longitude: HERE.longitude, locationSource: 'device', locationCapturedAt: new Date().toISOString(), locationAccuracy: 8}};
    const before = (await visits()).length;
    const refused = await as('rep')('/api/visits', {method: 'POST', body});
    check(refused.status, 400, 'the server refuses a visit recorded 2.2 km from the customer');
    ok(/^لا يمكن تسجيل الزيارة إلا عند العميل\. أنت على بعد 222\d متر/.test(refused.json().error), 'with the same words as the form: ' + refused.json().error);
    check((await visits()).length, before, 'and saves nothing');
    const lines = await audits('محاولة تسجيل زيارة بعيدة عن العميل');
    check([lines.length, lines[0].recordId, lines[0].actor], [1, 'far', 'أحمد المندوب'], 'the refusal is kept in the customer\'s history, under the member\'s name');
  }

  // ---- 3. A customer with no place of their own takes the first visit's point; the next visit from afar is held
  {
    await first.context.setGeolocation(HERE);
    const dialog = await openNewVisit(rep);
    await chooseCustomer(dialog, NONE);
    await dialog.locator('.location-status').filter({hasText: 'تم تحديد الموقع تلقائيًا'}).waitFor();
    const box = placeBox(dialog);
    await rep.locator('.visit-place[data-state="adopt"]').waitFor();
    ok((await box.innerText()).includes('لا موقع مسجل لهذا العميل'), 'the form says the customer has no recorded place and that this one becomes theirs');
    check(await box.getAttribute('data-blocked'), 'false', 'and does not hold the visit');
    await fillVisit(rep, dialog, 'متابعة الطلب');
    await shot(rep, 'place-rep-adopt-phone');
    const response = rep.waitForResponse(r => new URL(r.url()).pathname === '/api/visits' && r.request().method() === 'POST');
    await saveButton(dialog).click();
    check((await response).status(), 200, 'the visit saves');
    await dialog.waitFor({state: 'detached'});
    const adopted = (await customerRow('none')).data;
    check([adopted.latitude, adopted.longitude, adopted.locationSource, adopted.location], [HERE.latitude, HERE.longitude, 'device', `${HERE.latitude.toFixed(7)}, ${HERE.longitude.toFixed(7)}`], 'the customer now has the visit\'s point as theirs');
    const visit = (await visits()).at(-1);
    check([adopted._locationFromVisit.visitId, adopted._locationFromVisit.by], [visit.id, 'rep'], 'with a note of which visit gave it');
    check((await audits('تسجيل موقع العميل من زيارة')).map(line => line.recordId), ['none'], 'and a line in their history');

    // the customer's sheet says where the place came from
    await goPhone(rep, 'customer');
    await rep.locator('.customer-mobile-card', {hasText: NONE}).locator('.customer-mobile-name').click();
    const sheet = rep.locator('.crm-sheet');
    await sheet.waitFor();
    const sheetText = await sheet.innerText();
    ok(sheetText.includes('مصدر اللوكيشن') && sheetText.includes('من زيارة أحمد المندوب'), 'the sheet shows that the location came from a visit by the member');
    await shot(rep, 'place-customer-sheet-source');
    await rep.keyboard.press('Escape');
    await sheet.waitFor({state: 'detached'});

    // and now a visit from 2.2 km away is held, like any customer with a place
    await goPhone(rep, 'activity');
    await first.context.setGeolocation(north(2224));
    const again = await openNewVisit(rep);
    await chooseCustomer(again, NONE);
    await again.locator('.location-status').filter({hasText: 'تم تحديد الموقع تلقائيًا'}).waitFor();
    await rep.locator('.visit-place[data-state="far"]').waitFor();
    check(await saveButton(again).isDisabled(), true, 'the next visit from afar is held');
    await closeDialog(again);
  }

  // ---- 4. Offline, the refusal comes before anything is queued
  {
    await first.context.setGeolocation(HERE);
    const requests = [];
    rep.on('request', request => { if (new URL(request.url()).pathname === '/api/visits' && request.method() === 'POST') requests.push(request.url()); });
    const dialog = await openNewVisit(rep);
    await chooseCustomer(dialog, FAR);
    await dialog.locator('.location-status').filter({hasText: 'تم تحديد الموقع تلقائيًا'}).waitFor();
    await rep.locator('.visit-place[data-state="far"]').waitFor();
    await fillVisit(rep, dialog);
    await first.context.setOffline(true);
    check(await saveButton(dialog).isDisabled(), true, 'offline and away from the customer the save stays disabled');
    await pause(500);
    check(requests.length, 0, 'and no request was made');
    await first.context.setOffline(false);
    await first.context.setGeolocation(FAR_POINT);
    await dialog.getByRole('button', {name: 'تحديث موقع الجهاز', exact: true}).click();
    await rep.locator('.visit-place[data-state="near"]').waitFor();
    check(await saveButton(dialog).isDisabled(), false, 'at the customer again it can be saved');
    await closeDialog(dialog);
  }
  await first.context.close();

  // ---- 5. A supervisor away from the customer is not stopped: the visit is marked, and the list says so
  {
    const supervisor = await open('sup', {point: north(2224)});
    const page = supervisor.page;
    await goActivity(page);
    const dialog = await openNewVisit(page);
    await chooseCustomer(dialog, NEAR);
    await dialog.locator('.location-status').filter({hasText: 'تم تحديد الموقع تلقائيًا'}).waitFor();
    await fillVisit(page, dialog, 'متابعة المشرف');
    const box = placeBox(dialog);
    await page.locator('.visit-place[data-state="far"]').waitFor();
    check([await box.getAttribute('data-blocked'), await box.getAttribute('role')], ['false', 'status'], 'for a supervisor the same finding is a notice, not a hold');
    ok((await box.innerText()).includes('تُحفظ الزيارة وتُوسم «سُجّلت بعيدًا عن العميل»'), 'it says the visit is saved and marked');
    check(await saveButton(dialog).isDisabled(), false, 'the save button is enabled');
    await shot(page, 'place-supervisor-far-desktop');
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/visits' && r.request().method() === 'POST');
    await saveButton(dialog).click();
    check((await response).status(), 200, 'the visit saves');
    await dialog.waitFor({state: 'detached'});
    const saved = (await visits()).at(-1);
    ok(saved.data.placeOutside === true && saved.data.placeDistance > 2200 && saved.data.placeDistance < 2250, 'it is marked as recorded away, with the distance (' + saved.data.placeDistance + ' m)');
    const warning = page.locator('.visit-place-warning:visible').filter({hasText: 'سُجّلت بعيدًا عن العميل'}).first();
    await warning.waitFor();
    ok(/2\d{3}/.test(await warning.innerText()), 'the list shows the mark with its distance: ' + (await warning.innerText()));
    await shot(page, 'place-supervisor-list-marked');
    await supervisor.context.close();
  }

  // ---- 6. The English page says the same
  {
    const english = await open('rep', {point: HERE, language: 'en'});
    const page = english.page;
    await goPhone(page, 'activity');
    await page.locator('.heading-actions').getByRole('button', {name: 'New visit', exact: true}).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.locator('#visit-customer-search').fill(FAR);
    await dialog.getByRole('option').filter({hasText: FAR}).click();
    await page.locator('.visit-place[data-state="far"]').waitFor();
    const text = (await placeBox(dialog).innerText()).trim();
    ok(/^A visit can only be recorded at the customer's place\. You are 222\d meters from «مصنع البعيد» \(accuracy ±8 meters\)\. Go to the customer's place, then tap Refresh device location\.$/.test(text), 'in English, with the customer\'s name kept: ' + text);
    ok(!/[\u0600-\u06FF]/.test(text.replace('مصنع البعيد', '')), 'and no Arabic is left beside the name');
    check(await dialog.getByRole('button', {name: 'Save visit', exact: true}).isDisabled(), true, 'and the save button is disabled');
    await shot(page, 'place-rep-far-english');
    await english.context.close();
  }

  check(errors, [], 'the pages raised no script errors');
  console.log(JSON.stringify({ok: true, checks, browser: 'Chromium', actual_built_release: true, real_sqlite: true, controlled_browser_geolocation: true, physical_device_tested: false, real_gps_tested: false, production_data_used: false, screenshots: fs.readdirSync(screenshots).filter(name => name.startsWith('place-')).length}));
} finally {
  await browser?.close();
  await app?.stop();
}
