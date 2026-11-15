// A new opportunity needs its result and its next step (lib/opportunity-entry.ts) in a real Chromium against the BUILT release (run the build
// first), on a 360 px phone. The representative in the Android app's web view: «زيارة جديدة» saved without «نتيجة الزيارة» and without the
// next action says so beside each field, in Modern Standard Arabic, focuses the first, and sends nothing; each message leaves as its field
// is filled; an empty follow-up date says so too; a call asks «نتيجة التواصل»; complete, it is saved. The same in English with no Arabic in
// the messages. Customer service's «فرصة جديدة» asks «نتيجة التواصل». An entry saved on the device by an earlier page without its result
// comes back «تحتاج مراجعة» with the message; the representative adds the result in «حالة الحفظ» and the same entry is saved once. Editing
// a saved visit asks nothing new. Screenshots for the report. Synthetic fixtures only: temporary SQLite, mocked sendmail.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [{id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'مدير المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'sm', name: 'المشرف سالم'},
  {id: 'rep', role: 'rep', sup: 'sup', name: 'أحمد المندوب'}, {id: 'cs', role: 'customer_service', name: 'ممثل خدمة العملاء'}];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-required-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const PHONE = {width: 360, height: 800};
const HERE = {latitude: 26.437341, longitude: 50.034499, accuracy: 8};
const AR = {visit: 'اكتب نتيجة الزيارة قبل حفظ الفرصة (3 أحرف على الأقل).', contact: 'اكتب نتيجة التواصل قبل حفظ الفرصة (3 أحرف على الأقل).', nextAction: 'اكتب الإجراء القادم قبل حفظ الفرصة.', nextDate: 'حدد موعد المتابعة قبل حفظ الفرصة.'};
const EN = {visit: 'Write the visit result before saving the opportunity (at least 3 letters).', nextAction: 'Enter the next action before saving the opportunity.'};
const riyadhClock = () => new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date());
while (riyadhClock() >= '23:55') await new Promise(resolve => setTimeout(resolve, 20000));
const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date());

try {
  app = await bootBuiltApp({members}, {tls: true});
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});
  const created = new Date().toISOString();
  const customer = (id, name, assignedTo = 'rep') => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, assignedTo, JSON.stringify({name, region: 'الشرقية', city: 'الدمام', phone: '0551234567', contact: 'م', code: id, branch: 'الرئيسي', assignedTo, location: `${HERE.latitude.toFixed(7)}, ${HERE.longitude.toFixed(7)}`, latitude: HERE.latitude, longitude: HERE.longitude, locationSource: 'device', locationCapturedAt: created, locationAccuracy: 8}), created, created).run();
  await customer('near', 'مصنع القريب'); await customer('second', 'مصنع الثاني'); await customer('queued', 'مصنع المعلّق');
  const visits = async () => (await app.db.prepare("SELECT id,data FROM crm_records WHERE kind='activity' ORDER BY created_at,id").all()).results.map(row => ({id: row.id, data: JSON.parse(row.data)}));

  async function open(memberId, {language = 'ar', inApp = memberId === 'rep'} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport: PHONE, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: true, geolocation: HERE, permissions: ['geolocation']});
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    if (language === 'en') await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (inApp) await installNativeBridge(page, {memberId, regionScope: 'all'});
    await page.goto(app.origin + '/');
    if (language === 'en') await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('.workspace').waitFor();
    return page;
  }
  const settle = page => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const shot = async (page, label) => { await settle(page); await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const noSideways = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scrolling');
  const goPhone = async (page, id) => { await page.locator('.mobile-bottom-navigation').waitFor(); await page.locator('.mobile-tab[data-page="' + id + '"]').click(); await page.locator('.mobile-tab[data-page="' + id + '"][aria-current="page"]').waitFor(); await page.locator('.page-heading').waitFor(); };
  const pick = async (page, scope, name, option) => { await scope.getByRole('combobox', {name, exact: true}).click(); await page.getByRole('option', {name: option, exact: true}).click(); await page.getByRole('option').first().waitFor({state: 'hidden'}); };
  const openNewVisit = async (page, label) => { await page.locator('.heading-actions').getByRole('button', {name: label, exact: true}).click(); const dialog = page.getByRole('dialog'); await dialog.waitFor(); return dialog; };
  const chooseCustomer = async (dialog, name) => { await dialog.locator('#visit-customer-search').fill(name); await dialog.getByRole('option').filter({hasText: name}).click(); await dialog.locator('.visit-selected-customer').filter({hasText: name}).waitFor(); };
  const problems = dialog => dialog.locator('[data-field-problem]').evaluateAll(items => items.map(item => [item.id, item.textContent.trim()]));

  // ---- 1. The representative in the app, Arabic: a new visit without its result and next action.
  const rep = await open('rep');
  await goPhone(rep, 'activity');
  let dialog = await openNewVisit(rep, 'زيارة جديدة');
  await chooseCustomer(dialog, 'مصنع القريب');
  await dialog.locator('.location-status').filter({hasText: 'تم تحديد الموقع تلقائيًا'}).waitFor();
  await pick(rep, dialog, 'اختر الهدف من الزيارة', 'تعريف بمنتجات الشركة');
  const before = (await visits()).length;
  const sent = [];
  rep.on('request', request => { if (request.method() === 'POST' && /\/api\/visits$/.test(request.url())) sent.push(request.url()); });
  await dialog.getByRole('button', {name: 'حفظ الزيارة', exact: true}).click();
  await dialog.locator('[data-field-problem]').first().waitFor();
  check(await problems(dialog), [['visit-result-problem', AR.visit], ['visit-next-action-problem', AR.nextAction]], 'the result and the next action: each says so under its field, in Modern Standard Arabic');
  check(await rep.evaluate(() => document.activeElement?.id), 'visit-result', 'the first of them is focused');
  const red = await rep.evaluate(() => { const probe = document.createElement('span'); probe.style.color = 'var(--destructive)'; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; });
  check(await dialog.locator('[data-field-problem]').evaluateAll(items => items.map(item => getComputedStyle(item).color)), [red, red], 'in the theme\'s red (--destructive), as the field\'s own words');
  check([await dialog.locator('#visit-result').getAttribute('aria-invalid'), await dialog.locator('#visit-result').getAttribute('aria-describedby')], ['true', 'visit-result-problem'], 'and named for a screen reader');
  check([sent.length, (await visits()).length], [0, before], 'nothing was sent, nothing saved');
  await noSideways(rep, 'the form with its messages');
  await shot(rep, 'required-visit-ar-360');
  await dialog.locator('#visit-next-action-problem').scrollIntoViewIfNeeded();
  await shot(rep, 'required-next-action-ar-360');
  await pick(rep, dialog, 'نتيجة الزيارة', 'متابعة العميل');
  check((await problems(dialog)).map(([id]) => id), ['visit-next-action-problem'], 'choosing the result takes its message away');
  await dialog.getByRole('textbox', {name: /^الإجراء القادم/}).fill('إرسال عرض السعر');
  check(await problems(dialog), [], 'typing the next action takes its message away');
  await dialog.locator('#visit-next-date').fill('');
  await dialog.getByRole('button', {name: 'حفظ الزيارة', exact: true}).click();
  await dialog.locator('#visit-next-date-problem').waitFor();
  check(await problems(dialog), [['visit-next-date-problem', AR.nextDate]], 'an empty follow-up date says so under it');
  await shot(rep, 'required-visit-date-ar-360');
  await dialog.locator('#visit-next-date').fill(today);
  // A call asks for «نتيجة التواصل».
  await pick(rep, dialog, 'نوع التواصل', 'اتصال');
  check(await dialog.getByRole('combobox', {name: 'نتيجة الزيارة', exact: true}).innerText(), 'متابعة العميل', 'the chosen result stays');
  await dialog.getByRole('button', {name: 'حفظ الزيارة', exact: true}).click();
  await dialog.waitFor({state: 'detached'});
  const saved = (await visits()).at(-1);
  check([saved.data.result, saved.data.nextAction, saved.data.nextDate, (await visits()).length], ['متابعة العميل', 'إرسال عرض السعر', today, before + 1], 'complete: saved once');
  dialog = await openNewVisit(rep, 'زيارة جديدة');
  await chooseCustomer(dialog, 'مصنع الثاني');
  await dialog.locator('.location-status').filter({hasText: 'تم تحديد الموقع تلقائيًا'}).waitFor();
  await pick(rep, dialog, 'اختر الهدف من الزيارة', 'تعريف بمنتجات الشركة');
  await pick(rep, dialog, 'نوع التواصل', 'اتصال');
  await dialog.getByRole('textbox', {name: /^الإجراء القادم/}).fill('اتصال');
  await dialog.getByRole('button', {name: 'حفظ الزيارة', exact: true}).click();
  await dialog.locator('#visit-result-problem').waitFor();
  check(await problems(dialog), [['visit-result-problem', AR.contact]], 'a call: «نتيجة التواصل»');
  await shot(rep, 'required-call-ar-360');
  await rep.context().close();

  // ---- 2. English: the same words in English, no Arabic left in them.
  const repEn = await open('rep', {language: 'en'});
  await goPhone(repEn, 'activity');
  dialog = await openNewVisit(repEn, 'New visit');
  await dialog.locator('#visit-customer-search').fill('مصنع القريب'); await dialog.getByRole('option').filter({hasText: 'مصنع القريب'}).click();
  await dialog.locator('.location-status').filter({hasText: 'Location captured automatically'}).waitFor();
  await pick(repEn, dialog, 'Select the visit purpose', 'Introduce company products');
  await dialog.getByRole('button', {name: 'Save visit', exact: true}).click();
  await dialog.locator('[data-field-problem]').first().waitFor();
  const english = await problems(dialog);
  check(english, [['visit-result-problem', EN.visit], ['visit-next-action-problem', EN.nextAction]], 'English messages beside the fields');
  ok(english.every(([, text]) => !/[؀-ۿ]/.test(text)), 'no Arabic left in them');
  await noSideways(repEn, 'English form');
  await shot(repEn, 'required-visit-en-360');
  await repEn.context().close();

  // ---- 3. Customer service: «فرصة جديدة» asks «نتيجة التواصل».
  const cs = await open('cs', {inApp: false});
  await cs.getByRole('button', {name: 'فرصة جديدة', exact: true}).first().click();
  dialog = cs.locator('.customer-visit-dialog');
  await dialog.waitFor();
  await chooseCustomer(dialog, 'مصنع القريب');
  await dialog.locator('.location-status').filter({hasText: 'تم تحديد الموقع تلقائيًا'}).waitFor();
  await pick(cs, dialog, 'اختر الهدف من التواصل', 'تعريف بمنتجات الشركة');
  await dialog.getByRole('button', {name: 'حفظ الفرصة', exact: true}).click();
  await dialog.locator('[data-field-problem]').first().waitFor();
  check((await problems(dialog))[0], ['visit-result-problem', AR.contact], 'customer service: «اكتب نتيجة التواصل قبل حفظ الفرصة»');
  await shot(cs, 'required-service-ar-360');
  await cs.context().close();

  // ---- 4. An entry saved on the device by an earlier page, without its result.
  const queuedRep = await open('rep');
  const key = crypto.randomUUID(), capturedAt = new Date(Date.now() - 120_000).toISOString();
  const input = {createKey: key, customerId: 'queued', customerVersion: 1, timingMode: 'automatic', elapsedMilliseconds: 5000, data: {type: 'call', summary: 'تعريف بمنتجات الشركة', result: '', nextAction: 'متابعة المواصفات', nextDate: today, location: `${HERE.latitude.toFixed(7)}, ${HERE.longitude.toFixed(7)}`, locationSource: 'device', locationCapturedAt: capturedAt, locationAccuracy: 8}};
  // The app's own offline session (written when the page first loads online); the database is opened only once the app has made it, so
  // its stores exist (opening it first would make an empty one).
  const sessionReady = () => queuedRep.evaluate(async () => {
    if (!(await indexedDB.databases()).some(db => db.name === 'yourrest-offline-v1')) return false;
    return new Promise(resolve => { const request = indexedDB.open('yourrest-offline-v1', 1); request.onsuccess = () => { const db = request.result; if (!db.objectStoreNames.contains('meta')) { db.close(); resolve(false); return; } const get = db.transaction('meta').objectStore('meta').get('session'); get.onsuccess = () => { db.close(); resolve(!!get.result); }; get.onerror = () => { db.close(); resolve(false); }; }; request.onerror = () => resolve(false); });
  });
  for (let tries = 0; !(await sessionReady()); tries++) { if (tries > 100) throw Error('The offline session was never written'); await queuedRep.waitForTimeout(200); }
  await queuedRep.evaluate(async ({input, key, capturedAt}) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('yourrest-offline-v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const session = await new Promise(resolve => { const get = db.transaction('meta').objectStore('meta').get('session'); get.onsuccess = () => resolve(get.result); });
    const body = JSON.stringify({...input, offline: {memberId: session.ownerId, capturedAt}});
    await new Promise((resolve, reject) => { const tx = db.transaction('outbox', 'readwrite'); tx.objectStore('outbox').add({id: session.ownerId + ':visit:' + key, ownerId: session.ownerId, owner: {id: session.ownerId, stamp: session.stamp}, kind: 'visit', label: 'مصنع المعلّق', status: 'pending', message: '', createdAt: capturedAt, capturedAt, localId: 'customer-visit-' + key, url: '/api/visits', body, fingerprint: 'earlier-page', language: 'ar', attempts: 0}); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
  }, {input, key, capturedAt});
  await queuedRep.reload();
  await queuedRep.locator('.offline-sync-strip.has-errors').waitFor();
  ok((await queuedRep.locator('.offline-sync-strip').innerText()).includes('إدخالات محفوظة تحتاج مراجعة'), 'uploaded, it came back «تحتاج مراجعة»');
  check((await visits()).some(row => row.id === 'customer-visit-' + key), false, 'and nothing was saved');
  await queuedRep.locator('.offline-sync-strip button').click();
  const entry = queuedRep.locator('.offline-sync-list > li').filter({hasText: 'مصنع المعلّق'});
  await entry.waitFor();
  check((await entry.locator('.offline-sync-error').innerText()).trim(), AR.contact, 'with the message of the missing result');
  const complete = entry.locator('[data-offline-complete]');
  await complete.waitFor();
  check(await complete.locator('select, input').evaluateAll(fields => fields.map(field => field.id.replace(/^.*-(result|nextAction|nextDate)$/, '$1'))), ['result'], 'only the missing field is asked');
  await complete.locator('[data-offline-complete-save]').click();
  check((await complete.locator('[data-field-problem]').innerText()).trim(), AR.contact, 'nothing chosen: the same words, and nothing sent');
  await noSideways(queuedRep, 'the save status with the completion');
  await shot(queuedRep, 'required-offline-ar-360');
  await complete.locator('select').selectOption('متابعة العميل');
  await complete.locator('[data-offline-complete-save]').click();
  await entry.waitFor({state: 'detached'});
  const uploaded = (await visits()).find(row => row.id === 'customer-visit-' + key);
  check([uploaded?.data.result, uploaded?.data.offlineRecordedAt, uploaded?.data.nextAction], ['متابعة العميل', capturedAt, 'متابعة المواصفات'], 'the same entry is saved with the result added, the moment it was recorded on the device kept');
  check((await visits()).filter(row => row.id === 'customer-visit-' + key).length, 1, 'once');
  await shot(queuedRep, 'required-offline-done-ar-360');
  await queuedRep.context().close();

  // ---- 5. Editing a saved visit asks nothing new (the administrator, an earlier visit with no result).
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('old-visit','activity','near','rep','الرئيسي',?,?,?,1,'fixture')").bind(JSON.stringify({type: 'call', date: today, summary: 'تعريف بمنتجات الشركة', result: '', nextAction: 'اتصال', nextDate: today, visitWorkflow: 'customer-v1', performedBy: 'rep', responsibleId: 'rep', recordedByEmail: 'rep@yourrest.org', visitNumber: 900}), created, created).run();
  const owner = await open('owner', {inApp: false});
  const status = await owner.evaluate(async ({today}) => {
    const snapshot = await (await fetch('/api/crm')).json(), row = snapshot.records.find(record => record.id === 'old-visit'), customer = snapshot.records.find(record => record.id === 'near');
    const response = await fetch('/api/visits', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({createKey: crypto.randomUUID(), id: 'old-visit', version: row.version, customerId: 'near', customerVersion: customer.version, timingMode: 'automatic', elapsedMilliseconds: 0, data: {...row.data, summary: 'تعديل الإدارة', nextDate: today}})});
    return response.status;
  }, {today});
  check(status, 200, 'editing a visit that has no result: saved');
  await owner.context().close();

  ok(!errors.length, 'no uncaught page errors: ' + errors.join(' | '));
  console.log(JSON.stringify({ok: true, checks, screenshots, realChromium: true, syntheticFixtures: true}));
} finally {
  await browser?.close(); await app?.stop();
}
