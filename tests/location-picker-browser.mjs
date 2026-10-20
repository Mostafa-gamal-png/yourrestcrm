// A new customer's location in a real Chromium against the BUILT release (run `pnpm build` first): the phone's position stays the
// default; "Another location" lets the member type coordinates or paste a maps link, or tap the place on a map (and drag the
// pin); a phone that never answers, or no network, no longer stops the member from adding the customer. The same switch exists in the
// visit form's inline "add customer". The OpenStreetMap tiles and the national-address provider are answered locally;
// the phone's consent and permissions are the emulator's (scripts/lib/native-bridge.mjs): no device, GPS or OS claim is made.
// Synthetic isolated fixtures only: temporary SQLite, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require('playwright');
const members = [{id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'rep', role: 'rep', name: 'أحمد المندوب'}];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-location-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [], addressCalls = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1280, height: 900};
const HERE = {latitude: 26.437341, longitude: 50.034499, accuracy: 8};
const TILE = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8efe6"/><path d="M0 0H256V256" fill="none" stroke="#c9d6c5"/></svg>';
const LOCATION = 'اللوكيشن (خط العرض، خط الطول)', DEVICE = 'موقعي الحالي', OTHER = 'موقع آخر', MAP = 'اختيار على الخريطة';
const BAD_TEXT_HINT = 'اكتب الإحداثيات هكذا', BAD_TEXT_ERROR = 'أدخل اللوكيشن كخط عرض، خط طول';

try {
  app = await bootBuiltApp({members}, {tls: true});
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  const customerNamed = async name => { const row = await app.db.prepare("SELECT id,assigned_to,data FROM crm_records WHERE kind='customer' AND json_extract(data,'$.name')=?").bind(name).first(); return row && {...row, data: JSON.parse(row.data)}; };
  async function eventually(probe, message, timeoutMs = 20000) {
    const until = Date.now() + timeoutMs;
    for (;;) { const value = await probe(); if (value) { checks++; return value; } if (Date.now() > until) throw Error(message + ' (timed out)'); await pause(150); }
  }

  /** A signed-in page. gps: 'ok' = the phone answers, 'silent' = it never does. native: the Android app emulator for a representative. */
  async function open(memberId, {native = false, viewport = PHONE, gps = 'ok'} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', geolocation: HERE, permissions: ['geolocation']});
    await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({status: 200, contentType: 'image/svg+xml', body: TILE}));
    // The national-address provider is not reachable from a test: the place decides the answer, so a stale one is visible.
    await context.route('**/api/customer-address', route => {
      const body = route.request().postDataJSON();
      addressCalls.push(body);
      route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(body.latitude > 25 ? {status: 'found', shortAddress: 'aaaa1111', address: 'شارع الأول', city: 'الدمام'} : {status: 'found', shortAddress: 'bbbb2222', address: 'شارع الثاني', city: 'الرياض'})});
    });
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (gps === 'silent') await page.addInitScript(() => { Object.defineProperty(navigator.geolocation, 'getCurrentPosition', {value: () => {}, configurable: true}); });
    if (native) await installNativeBridge(page, native === true ? {} : native);
    await page.goto(app.origin + '/');
    await page.locator('.workspace').waitFor();
    return page;
  }
  const settle = page => page.evaluate(async () => { await document.fonts.ready; // A spinner never finishes: waiting for it would hold the page until the phone's own timeout.
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const shot = async (page, label) => { await settle(page); await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const layoutOk = async (page, label) => { const geometry = await page.evaluate(() => ({overflow: document.documentElement.scrollWidth > innerWidth + 1, width: innerWidth})); check(geometry.overflow, false, label + ': no horizontal overflow at ' + geometry.width + 'px'); };
  const goDesktop = async (page, label) => { await page.locator('button.nav-item', {hasText: label}).first().click(); await page.locator('.page-heading h1', {hasText: label}).waitFor(); };
  const goPhone = async (page, id) => {
    await page.locator('.mobile-bottom-navigation').waitFor();
    const tab = page.locator('.mobile-tab[data-page="' + id + '"]');
    if (await tab.count()) { await tab.click(); await page.locator('.mobile-tab[data-page="' + id + '"][aria-current="page"]').waitFor(); return; }
    await page.getByRole('button', {name: /^(المزيد من الصفحات|More pages)$/}).click();
    await page.locator('.mobile-overflow-pages [data-page=' + id + ']').click();
    await page.locator('.mobile-navigation-sheet').waitFor({state: 'detached'});
    await page.locator('.page-heading').waitFor();
  };
  const addCustomer = async page => { await page.locator('.heading-actions').getByRole('button', {name: /^(إضافة عميل|إضافة مصنع)$/}).click(); const dialog = page.locator('.crm-master-dialog'); await dialog.waitFor(); return dialog; };
  const labelled = (scope, label) => scope.locator('label.field').filter({has: scope.page().locator('span').filter({hasText: new RegExp('^' + label + '( \\*)?$')})}).locator('input,textarea').first();
  const placeField = scope => scope.getByRole('textbox', {name: LOCATION, exact: true});
  // The source choice is a group of real radio buttons drawn as the app's other choices: the label is what a person taps.
  const mode = (scope, name) => scope.locator('label.customer-choice').filter({hasText: name});
  const chosen = (scope, name) => scope.getByRole('radio', {name, exact: true}).isChecked();
  const region = (dialog, name) => dialog.locator('label.customer-choice').filter({hasText: name}).click();
  const save = dialog => dialog.locator('button[type=submit]');
  const label = async picker => { const [latitude, longitude] = (await picker.locator('.location-picker-point').innerText()).split(',').map(Number); return {latitude, longitude}; };
  const near = (a, b, within) => Math.abs(a - b) <= within;
  const outbox = page => page.evaluate(() => new Promise((resolve, reject) => {
    const opened = indexedDB.open('yourrest-offline-v1');
    opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const database = opened.result;
      if (!database.objectStoreNames.contains('outbox')) { database.close(); resolve([]); return; }
      const read = database.transaction('outbox', 'readonly').objectStore('outbox').getAll();
      read.onerror = () => reject(read.error);
      read.onsuccess = () => { database.close(); resolve(read.result); };
    };
  }));

  // ---- 1. Desktop, owner: the phone first, then another place typed, then adjusted on the map
  const admin = await open('owner', {viewport: DESKTOP});
  await goDesktop(admin, 'العملاء');
  const posts = [];
  admin.on('request', request => { if (new URL(request.url()).pathname === '/api/crm' && request.method() === 'POST') posts.push(request.postDataJSON()); });
  let dialog = await addCustomer(admin);
  let place = placeField(dialog);
  check([await chosen(dialog, DEVICE), await chosen(dialog, OTHER)], [true, false], 'a new customer starts on the phone\'s own position');
  await eventually(async () => (await place.inputValue()) === '26.4373410, 50.0344990', 'the phone\'s fix fills the field');
  check(await place.evaluate(node => node.readOnly), true, 'which cannot be typed over in this mode');
  check(await dialog.getByRole('button', {name: MAP, exact: true}).count(), 0, 'and offers no map here');
  await eventually(async () => (await labelled(dialog, 'العنوان الوطني المختصر').inputValue()) === 'AAAA1111', 'its national address fills in');
  check(await labelled(dialog, 'المدينة').inputValue(), 'الدمام', 'with the city');
  await labelled(dialog, 'المدينة').fill('القطيف');
  await labelled(dialog, 'اسم المصنع').fill('مصنع الموقع المحدد');
  await region(dialog, 'الشرقية');
  await dialog.locator('.customer-auto-location').scrollIntoViewIfNeeded();
  await shot(admin, 'location-desktop-device');

  await mode(dialog, OTHER).click();
  check([await chosen(dialog, OTHER), await place.evaluate(node => node.readOnly), await place.inputValue()], [true, false, '26.4373410, 50.0344990'], 'choosing another location frees the field and keeps what the phone found until it is replaced');
  ok(await dialog.getByRole('button', {name: MAP, exact: true}).isVisible(), 'and offers the map');
  check(await dialog.getByRole('button', {name: /^(تحديث الموقع|إعادة المحاولة)$/}).count(), 0, 'without the phone refresh button');

  // text that is not coordinates is explained at once and refused on save, before anything is sent
  await place.fill('الدمام');
  check(await place.getAttribute('aria-invalid'), 'true', 'a place name is marked as not usable');
  ok((await dialog.innerText()).includes(BAD_TEXT_HINT), 'and explained beside the field');
  await save(dialog).click();
  await dialog.locator('.form-error').waitFor();
  ok((await dialog.locator('.form-error').innerText()).includes(BAD_TEXT_ERROR), 'saving it says why it was refused');
  check(posts.length, 0, 'and nothing is sent');

  // coordinates typed by hand: the address of that place replaces the one found for the phone's position, typed city kept
  await place.fill('24.7136, 46.6753');
  check(await place.getAttribute('aria-invalid'), null, 'coordinates raise no complaint');
  const fixCalls = addressCalls.length;
  await place.press('Tab');
  await eventually(() => addressCalls.length === fixCalls + 1, 'the typed place is looked up');
  check([addressCalls.at(-1).latitude, addressCalls.at(-1).longitude], [24.7136, 46.6753], 'as that place');
  await eventually(async () => (await labelled(dialog, 'العنوان الوطني المختصر').inputValue()) === 'BBBB2222', 'its national address replaces the phone place\'s');
  check([await labelled(dialog, 'العنوان').inputValue(), await labelled(dialog, 'المدينة').inputValue()], ['شارع الثاني', 'القطيف'], 'the address follows the place and the city the member typed is kept');

  // the map: opens on the typed place, nothing changes until confirmed
  await dialog.getByRole('button', {name: MAP, exact: true}).click();
  let picker = admin.locator('.location-picker-dialog');
  await picker.waitFor();
  const map = picker.locator('.location-picker-map');
  await eventually(async () => (await map.locator('.leaflet-tile-loaded').count()) > 0, 'the map draws its tiles');
  await settle(admin);
  await picker.locator('.location-picker-pin').waitFor();
  const opened = await label(picker);
  check([opened.latitude, opened.longitude], [24.7136, 46.6753], 'the pin starts on the typed place');
  check([await map.locator('path.kingdom-mask').count(), await map.locator('path.kingdom-border').count()], [1, 1], 'the map greys out everything beyond the Kingdom\'s border and draws the border');
  await shot(admin, 'location-desktop-map');
  const box = await map.boundingBox();
  await map.click({position: {x: box.width / 2 + 120, y: box.height / 2 + 60}});
  const clicked = await label(picker);
  ok(clicked.longitude > opened.longitude && clicked.latitude < opened.latitude, 'tapping the map moves the pin there (east and south of the start)');
  await picker.getByRole('button', {name: 'إلغاء', exact: true}).click();
  await picker.waitFor({state: 'detached'});
  check(await place.inputValue(), '24.7136, 46.6753', 'cancelling leaves the field as it was');

  await dialog.getByRole('button', {name: MAP, exact: true}).click();
  picker = admin.locator('.location-picker-dialog');
  await picker.waitFor();
  await picker.locator('.location-picker-pin').waitFor();
  await eventually(async () => (await map.locator('.leaflet-tile-loaded').count()) > 0, 'the map draws its tiles again');
  await settle(admin);
  const pin = await picker.locator('.location-picker-pin').boundingBox();
  await admin.mouse.move(pin.x + pin.width / 2, pin.y + pin.height / 2);
  await admin.mouse.down();
  await admin.mouse.move(pin.x + pin.width / 2 - 70, pin.y + pin.height / 2 + 30, {steps: 12});
  await admin.mouse.up();
  const dragged = await label(picker);
  ok(dragged.longitude < opened.longitude && dragged.latitude < opened.latitude, 'dragging the pin moves the chosen place with it (west and south)');
  ok(near(dragged.longitude, opened.longitude, 0.01) && near(dragged.latitude, opened.latitude, 0.01), 'by a small fine adjustment');
  const beforeConfirm = addressCalls.length;
  await picker.getByRole('button', {name: 'تأكيد الموقع', exact: true}).click();
  await picker.waitFor({state: 'detached'});
  const confirmed = (await place.inputValue()).split(',').map(Number);
  check(confirmed, [dragged.latitude, dragged.longitude], 'the confirmed place is the field\'s value');
  check(await place.evaluate(node => node.readOnly), false, 'still editable');
  await eventually(() => addressCalls.length === beforeConfirm + 1, 'the chosen place is looked up as well');
  check(await save(dialog).isDisabled(), false, 'and saving is open once that is over');
  await shot(admin, 'location-desktop-confirmed');
  const created = admin.waitForResponse(response => new URL(response.url()).pathname === '/api/crm' && response.request().method() === 'POST');
  await save(dialog).click();
  check((await created).status(), 200, 'the customer is saved');
  await dialog.waitFor({state: 'detached'});
  const first = await customerNamed('مصنع الموقع المحدد');
  check([first.data.latitude, first.data.longitude, first.data.region, first.data.city, first.data.shortAddress], [dragged.latitude, dragged.longitude, 'الشرقية', 'القطيف', 'BBBB2222'], 'the stored customer holds the chosen coordinates, region, typed city and the address of that place');
  check([first.data.locationSource, first.data.locationCapturedAt, first.data.locationAccuracy], [undefined, undefined, undefined], 'and is not presented as a phone capture');
  check(posts.length, 1, 'with one request');

  // a pasted maps link
  dialog = await addCustomer(admin);
  place = placeField(dialog);
  await eventually(async () => (await place.inputValue()) === '26.4373410, 50.0344990', 'a second new customer starts on the phone again');
  await mode(dialog, OTHER).click();
  await labelled(dialog, 'اسم المصنع').fill('مصنع رابط الخرائط');
  await region(dialog, 'الغربية');
  await eventually(async () => (await labelled(dialog, 'العنوان الوطني المختصر').inputValue()) === 'AAAA1111', 'with the address of that position');
  const beforeLink = addressCalls.length;
  await place.fill('https://www.google.com/maps/place/Jeddah/@21.5433,39.1728,17z');
  check(await place.getAttribute('aria-invalid'), null, 'a full maps link with coordinates is accepted');
  await place.press('Tab');
  await eventually(() => addressCalls.length === beforeLink + 1 && addressCalls.at(-1).latitude === 21.5433, 'and looked up as that place');
  check(await place.inputValue(), '21.5433000, 39.1728000', 'the pasted link is replaced by the plain coordinates it points to');
  await save(dialog).click();
  await dialog.waitFor({state: 'detached'});
  const linked = await customerNamed('مصنع رابط الخرائط');
  check([linked.data.latitude, linked.data.longitude, linked.data.locationSource, linked.data.location], [21.5433, 39.1728, undefined, '21.5433000, 39.1728000'], 'the link\'s coordinates are stored, not the link');

  // a long link (the field holds 250 characters) pasted and sent with Enter, the keyboard's Go: the field is never left, so it is tidied at submit
  dialog = await addCustomer(admin);
  place = placeField(dialog);
  await eventually(async () => (await place.inputValue()) === '26.4373410, 50.0344990', 'a fourth new customer starts on the phone');
  await mode(dialog, OTHER).click();
  await labelled(dialog, 'اسم المصنع').fill('مصنع الرابط الطويل');
  await region(dialog, 'الغربية');
  const longLink = 'https://www.google.com/maps/place/' + encodeURIComponent('مصنع '.repeat(30)) + '/@21.4858,39.1925,17z/data=!3m1!4b1!4m6!3m5!1s0x15c3d0f0f0f0f0f0:0x1234567890abcdef!8m2!3d21.4858!4d39.1925';
  ok(longLink.length > 250, 'the link is longer than the field allows');
  await place.fill(longLink);
  check(await place.getAttribute('aria-invalid'), null, 'it is accepted');
  const entered = admin.waitForResponse(response => new URL(response.url()).pathname === '/api/crm' && response.request().method() === 'POST');
  await place.press('Enter');
  check((await entered).status(), 200, 'Enter saves it');
  await dialog.waitFor({state: 'detached'});
  const long = await customerNamed('مصنع الرابط الطويل');
  check([long.data.location, long.data.latitude, long.data.longitude], ['21.4858000, 39.1925000', 21.4858, 39.1925], 'as the coordinates it points to');

  // back to the phone: its position replaces the typed one
  dialog = await addCustomer(admin);
  place = placeField(dialog);
  await eventually(async () => (await place.inputValue()) === '26.4373410, 50.0344990', 'a fifth new customer starts on the phone');
  await mode(dialog, OTHER).click();
  await place.fill('24.7136, 46.6753');
  await mode(dialog, DEVICE).click();
  await eventually(async () => (await place.inputValue()) === '26.4373410, 50.0344990', 'choosing the phone again replaces the typed place with its fix');
  check(await place.evaluate(node => node.readOnly), true, 'and locks the field');
  await dialog.getByRole('button', {name: 'إلغاء', exact: true}).click();
  await dialog.waitFor({state: 'detached'}).catch(async () => { await admin.getByRole('button', {name: /^(تجاهل|إغلاق بدون حفظ|نعم)/}).first().click(); await dialog.waitFor({state: 'detached'}); });

  // English: the same screen in the other language, left to right
  await admin.getByRole('button', {name: 'Switch to English', exact: true}).click();
  await admin.locator('html[lang=en]').waitFor();
  await admin.locator('.heading-actions button').last().click();
  dialog = admin.locator('.crm-master-dialog');
  await dialog.waitFor();
  check([await chosen(dialog, 'My current location'), await chosen(dialog, 'Another location')], [true, false], 'English: the same two choices');
  await mode(dialog, 'Another location').click();
  await dialog.getByRole('textbox', {name: 'Location (latitude, longitude)', exact: true}).fill('abc');
  ok((await dialog.innerText()).includes('Enter coordinates like'), 'English: the hint says how to write the coordinates');
  await dialog.getByRole('button', {name: 'Choose on the map', exact: true}).click();
  picker = admin.locator('.location-picker-dialog');
  await picker.waitFor();
  ok((await picker.innerText()).includes('Choose the customer location'), 'English: the map dialog has its title');
  check([await picker.getByRole('button', {name: 'Confirm location', exact: true}).isDisabled(), await picker.locator('.location-picker-point').innerText()], [true, 'No location selected yet.'], 'English: nothing to confirm before a place is chosen');
  await picker.getByRole('button', {name: 'Cancel', exact: true}).click();
  await picker.waitFor({state: 'detached'});
  await admin.context().close();

  // ---- 2. Phone, representative: a phone that never answers does not block adding the customer
  const rep = await open('rep', {native: {memberId: 'rep', regionScope: 'all'}, gps: 'silent'});
  await goPhone(rep, 'customer');
  dialog = await addCustomer(rep);
  place = placeField(dialog);
  await dialog.getByText('جارٍ تحديد الموقع').first().waitFor();
  check(await save(dialog).isDisabled(), true, 'while the phone is still locating, saving waits');
  await dialog.locator('.customer-auto-location').scrollIntoViewIfNeeded();
  await shot(rep, 'location-phone-locating');
  await mode(dialog, OTHER).click();
  check([await save(dialog).isDisabled(), await place.evaluate(node => node.readOnly)], [false, false], 'choosing another location ends the wait: saving opens and the field is editable');
  await layoutOk(rep, 'phone: add customer');
  await labelled(dialog, 'اسم المصنع').fill('مصنع بلا إشارة هاتف');
  await region(dialog, 'الغربية');
  await place.fill('21.4858، 39.1925');
  check(await place.getAttribute('aria-invalid'), null, 'an Arabic comma is read as a separator');
  await mode(dialog, OTHER).scrollIntoViewIfNeeded();
  await shot(rep, 'location-phone-manual');
  await dialog.getByRole('button', {name: MAP, exact: true}).click();
  picker = rep.locator('.location-picker-dialog');
  await picker.waitFor();
  await picker.locator('.location-picker-pin').waitFor();
  await eventually(async () => (await picker.locator('.leaflet-tile-loaded').count()) > 0, 'the phone-sized map draws its tiles');
  await settle(rep);
  const sheet = await picker.boundingBox(), confirmButton = await picker.getByRole('button', {name: 'تأكيد الموقع', exact: true}).boundingBox();
  ok(sheet.x >= -1 && sheet.x + sheet.width <= PHONE.width + 1 && sheet.y >= -1 && sheet.y + sheet.height <= PHONE.height + 1, 'the map dialog fits the phone screen');
  ok(confirmButton.y + confirmButton.height <= PHONE.height && confirmButton.x >= 0 && confirmButton.x + confirmButton.width <= PHONE.width, 'with its confirm button on screen');
  await layoutOk(rep, 'phone: map dialog');
  await shot(rep, 'location-phone-map');
  await picker.getByRole('button', {name: 'إلغاء', exact: true}).click();
  await picker.waitFor({state: 'detached'});
  await save(dialog).click();
  await dialog.waitFor({state: 'detached'});
  const silent = await eventually(() => customerNamed('مصنع بلا إشارة هاتف'), 'the customer is stored');
  check([silent.assigned_to, silent.data.latitude, silent.data.longitude, silent.data.locationSource], ['rep', 21.4858, 39.1925, undefined], 'with the typed place');

  // ---- 3. Phone, representative, no network: the place is kept on the device and saved once the network is back
  await rep.context().setOffline(true);
  await eventually(() => rep.evaluate(() => navigator.onLine === false), 'the phone is offline');
  dialog = await addCustomer(rep);
  place = placeField(dialog);
  await mode(dialog, OTHER).click();
  await labelled(dialog, 'اسم المصنع').fill('مصنع محفوظ بلا شبكة');
  await region(dialog, 'الغربية');
  await place.fill('الرياض');
  await save(dialog).click();
  await dialog.locator('.form-error').waitFor();
  ok((await dialog.locator('.form-error').innerText()).includes(BAD_TEXT_ERROR), 'offline too, a place that is not coordinates is refused at once, not at some later sync');
  check((await outbox(rep)).length, 0, 'and nothing is queued');
  const beforeOffline = addressCalls.length;
  await place.fill('21.5433, 39.1728');
  await place.press('Tab');
  await dialog.getByText('العنوان المختصر غير متاح').waitFor();
  check(addressCalls.length, beforeOffline, 'the address lookup is skipped without a network');
  check(await save(dialog).isDisabled(), false, 'and never blocks saving');
  await save(dialog).click();
  await dialog.waitFor({state: 'detached'});
  const queued = await eventually(async () => { const jobs = await outbox(rep); return jobs.length === 1 && jobs; }, 'the customer is queued on the device');
  // The server works the numbers out from the text when the job is synchronised; the job itself holds what was typed.
  const job = JSON.parse(queued[0].body).data;
  check([job.location, job.locationSource, job.region], ['21.5433, 39.1728', undefined, 'الغربية'], 'holding the typed place, not claimed as a phone capture');
  check(await customerNamed('مصنع محفوظ بلا شبكة'), null, 'and it is not claimed as saved on the server');
  await rep.context().setOffline(false);
  await rep.evaluate(() => window.dispatchEvent(new Event('online')));
  const synced = await eventually(() => customerNamed('مصنع محفوظ بلا شبكة'), 'the queued customer reaches the server once the network is back', 45000);
  check([synced.data.latitude, synced.data.longitude, synced.data.locationSource, synced.assigned_to], [21.5433, 39.1728, undefined, 'rep'], 'with its place');
  await eventually(async () => (await outbox(rep)).length === 0, 'and the queue empties');

  // ---- 4. The visit form's inline "add customer" has the same choice
  await goPhone(rep, 'activity');
  await rep.getByRole('button', {name: 'زيارة جديدة', exact: true}).first().click();
  const visit = rep.locator('.customer-visit-dialog');
  await visit.waitFor();
  await visit.getByRole('combobox', {name: 'نوع التواصل', exact: true}).click();
  await rep.getByRole('option', {name: 'اتصال', exact: true}).click();
  await rep.getByRole('option').first().waitFor({state: 'hidden'});
  await visit.getByRole('button', {name: 'إضافة عميل', exact: true}).click();
  const inline = rep.locator('.visit-new-customer');
  await inline.waitFor();
  await region(inline, 'الغربية');
  await inline.locator('.visit-new-customer-name input').fill('مصنع الزيارة الجديد');
  await inline.getByRole('textbox', {name: /^المدينة/}).fill('جدة');
  const create = inline.getByRole('button', {name: 'حفظ واختيار العميل', exact: true});
  check(await create.isDisabled(), true, 'inline, saving waits while the phone is still locating');
  await mode(inline, OTHER).click();
  check(await create.isDisabled(), false, 'and opens when another location is chosen');
  await placeField(inline).fill('abc');
  await create.click();
  await inline.locator('[role=alert]').filter({hasText: BAD_TEXT_ERROR}).waitFor();
  check(await customerNamed('مصنع الزيارة الجديد'), null, 'a place that is not coordinates is refused there too');
  await placeField(inline).fill('21.6, 39.2');
  await create.click();
  await inline.waitFor({state: 'detached'});
  const inlineRow = await eventually(() => customerNamed('مصنع الزيارة الجديد'), 'the inline customer is stored');
  check([inlineRow.data.latitude, inlineRow.data.longitude, inlineRow.data.locationSource], [21.6, 39.2, undefined], 'with the typed place');
  ok((await visit.locator('.visit-selected-customer').innerText()).includes('مصنع الزيارة الجديد'), 'and selected for the visit');

  check(errors, [], 'no page error was raised');
  console.log(JSON.stringify({ok: true, checks, screenshots, scope: 'new-customer location in real Chromium: phone default, typed coordinates and maps link, map tap and pin drag, silent phone, offline queue, inline visit customer; phone and desktop sizes', realBrowser: true, realDevice: false}));
} finally {
  await browser?.close();
  await app?.stop();
}
