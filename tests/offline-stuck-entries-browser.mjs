// «الإدخالات الواقفة على الجهاز» (the owner, 2026-11-19, GSCO 2.13.84 and 2.13.81) in a real Chromium against the BUILT release (run the
// build first): the representative, in the Android app's emulator, keeps entries on the phone without a network (through the outbox's own
// functions, bundled from lib/ as the page uses them), and then, online, the screen «الإدخالات المحفوظة على الجهاز» of the release shows:
// - a follow-up saved twice: «يبدو أن هذه المتابعة مسجلة بالفعل: متابعة على الفرصة نفسها بتاريخ <اليوم>…» (the server names the follow-up);
// - a follow-up on an opportunity closed since, and a visit on a customer moved to another region: «لم تعد الفرصة متاحة لك…» and
//   «لم يعد العميل متاحًا لك…»;
// - «حذف هذا الإدخال من الجهاز» on a new customer outside the Kingdom: the confirmation lists the visit on it and its photo, the button is
//   disabled with its reason while a sync runs (and the device refuses it then), and the three go with their photo, never sent;
// - a deleted follow-up from the local archive; a new customer whose location is corrected and resent, the visit on it following;
// - a new customer at the place of one the representative already registered: «فتح العميل الموجود» opens that customer's sheet;
// - an HTML 413 answer keeps its entry waiting (never «تحتاج مراجعة»), and an entry held before by a page that was not the server's is
//   released by the next sync and saved once.
// Phones of 320 and 360 pixels, a tablet upright and on its side, a computer, Arabic and English: no sideways scrolling and every button
// inside the screen. Synthetic isolated fixtures only: temporary SQLite and objects, mocked sendmail, made-up names, no device.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', region: 'eastern', name: 'المشرف سالم'},
  {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'}, {id: 'west', role: 'rep', region: 'western', name: 'مندوب الغربية'}
];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-stuck-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
const SIZES = {'phone-320': {width: 320, height: 700}, 'phone-360': {width: 360, height: 800}, 'tablet-upright': {width: 768, height: 1024}, 'tablet-sideways': {width: 1024, height: 768}, desktop: {width: 1280, height: 900}};
const HERE = {latitude: 26.43, longitude: 50.03, accuracy: 8}, PLACE = '26.4300000, 50.0300000';
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const riyadhClock = () => new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date());
while (riyadhClock() >= '23:55' || riyadhClock() < '00:02') await new Promise(resolve => setTimeout(resolve, 20000));

// The outbox's own functions, as the page bundles them (lib/offline-store.ts, lib/offline-submit.ts): they share the page's IndexedDB,
// its lease and its BroadcastChannel, so the release's screen sees what they keep.
const bundle = await build({stdin: {contents: "export * from './lib/offline-store';export * from './lib/offline-submit';", resolveDir: root, loader: 'ts'}, bundle: true, format: 'iife', globalName: '__offline', platform: 'browser', write: false, footer: {js: 'globalThis.__offline=__offline;'}});
const outbox = bundle.outputFiles[0].text;

try {
  app = await bootBuiltApp({members}, {tls: true});
  const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()), week = new Date(Date.now() - 7 * 86400000).toISOString();
  const later = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date(Date.now() + 7 * 86400000));
  const insert = (id, kind, parent, assigned, data, at = week) => app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,1,?)')
    .bind(id, kind, parent, assigned, 'الرئيسي', JSON.stringify(data), at, at, 'fixture').run();
  const customer = (id, name, extra = {}) => insert(id, 'customer', null, 'rep', {name, region: 'الشرقية', city: 'الدمام', branch: 'الرئيسي', assignedTo: 'rep', customerStatus: 'نشط', phone: '0551234567', location: '26.4100000, 50.0100000', latitude: 26.41, longitude: 50.01, ...extra});
  const source = (id, customerId) => insert(id, 'activity', customerId, 'rep', {visitWorkflow: 'customer-v1', type: 'visit', date: week.slice(0, 10), summary: 'زيارة تعريفية', result: 'العميل مهتم بالقوالب', salesStage: 'specs', nextAction: 'اتصال للمتابعة', nextDate: day, performedBy: 'rep', responsibleId: 'rep', recordedByEmail: 'rep@yourrest.org'});
  await customer('c1', 'مصنع الأمل'); await source('c1-v', 'c1');
  await customer('c2', 'مصنع النخيل'); await source('c2-v', 'c2');
  await customer('c3', 'مصنع الشروق');
  await customer('cx', 'مصنع موجود', {_createdBy: 'rep', location: PLACE, latitude: HERE.latitude, longitude: HERE.longitude});
  const rows = async (sql, ...args) => (await app.db.prepare(sql).bind(...args).all()).results;
  const version = async id => (await app.db.prepare('SELECT version FROM crm_records WHERE id=?').bind(id).first()).version;

  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});
  const context = await browser.newContext({ignoreHTTPSErrors: true, viewport: SIZES['phone-360'], deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: true, geolocation: HERE, permissions: ['geolocation']});
  const cookie = await app.login('rep'), [name, ...value] = cookie.split('=');
  await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
  await context.addInitScript(() => { try { localStorage.setItem('yr-language', localStorage.getItem('yr-test-language') || 'ar'); } catch { /* storage unavailable */ } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await installNativeBridge(page, {memberId: 'rep', regionScope: 'eastern'});
  // The page's answers a test needs to shape: the HTML 413 of a proxy once, and the start of a sync held.
  let htmlFor = '', htmlServed = 0, holdSync = false, releaseSync = () => {};
  await page.route('**/api/visits', async route => { if (htmlFor && (route.request().postData() || '').includes(htmlFor)) { htmlServed++; return route.fulfill({status: 413, contentType: 'text/html', body: '<html><body><h1>413 Request Entity Too Large</h1><p>nginx</p></body></html>'}); } return route.continue(); });
  await page.route('**/api/crm', async route => { if (holdSync && route.request().method() === 'GET') { holdSync = false; await new Promise(resolve => { releaseSync = resolve; }); } return route.continue(); });
  const start = async () => {
    // The same address with only its fragment would not load the page again: a reload does.
    if (page.url().startsWith(app.origin)) await page.reload(); else await page.goto(app.origin + '/#customer');
    await page.locator('.customer-machines-page').first().waitFor();
    await page.evaluate(outbox);
    for (let i = 0; i < 100 && !await page.evaluate(async () => !!await __offline.loadOfflineSnapshot()); i++) await pause(100);
  };
  await start();
  const me = await page.evaluate(async () => (await __offline.loadOfflineSnapshot()).me);
  check([me.id, me.role], ['rep', 'rep'], 'the representative\'s copy is on the device');

  // ---- Entries kept on the phone without a network.
  const at = new Date().toISOString(), where = {location: '26.4100000, 50.0100000', latitude: 26.41, longitude: 50.01, locationSource: 'device', locationCapturedAt: at, locationAccuracy: 9};
  const call = (customerId, extra = {}) => ({createKey: crypto.randomUUID(), customerId, customerVersion: 1, timingMode: 'automatic', elapsedMilliseconds: 60000, data: {type: 'call', summary: 'تعريف بمنتجات الشركة', result: 'متابعة العميل', nextAction: 'إرسال العرض', nextDate: later, ...where, ...extra}});
  const followup = async (customerId, sourceId, data = {}) => ({createKey: crypto.randomUUID(), customerId, customerVersion: await version(customerId), sourceId, sourceVersion: await version(sourceId), data: {type: 'call', date: day, result: 'تحدثت مع العميل عن العرض', salesStage: 'specs', invoiceOutcome: 'pending', nextAction: 'إرسال المواصفات', nextDate: later, lossReason: '', lossDetails: '', ...data}});
  const newCustomer = (name, location, region = 'الشرقية') => ({action: 'save', kind: 'customer', createKey: crypto.randomUUID(), data: {name, region, city: 'الدمام', customerType: 'مصنع', phone: '0559876543', location, assignedTo: 'rep', branch: 'الرئيسي'}});
  const keep = (url, body, label, kind) => page.evaluate(async ({url, body, label, kind}) => __offline.offlineSubmit(url, JSON.stringify(body), {me: (await __offline.loadOfflineSnapshot()).me, label, kind, language: 'ar'}), {url, body, label, kind});
  await context.setOffline(true);
  const dup = await followup('c1', 'c1-v'), closing = await followup('c2', 'c2-v');
  await keep('/api/customer-followups', dup, 'مصنع الأمل', 'followup');
  await keep('/api/customer-followups', closing, 'مصنع النخيل', 'followup');
  const n1 = newCustomer('مصنع القاهرة الجديد', '30.0444000, 31.2357000'), n1Id = 'crm-rep-' + n1.createKey;
  await keep('/api/crm', n1, 'مصنع القاهرة الجديد', 'customer');
  const photoKey = crypto.randomUUID();
  const photo = await page.evaluate(async ({customerId, key}) => __offline.uploadOfflineVisitFile(new File([new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1])], 'photo.jpg', {type: 'image/jpeg'}), {me: (await __offline.loadOfflineSnapshot()).me, customerId, uploadKey: key, language: 'ar'}), {customerId: n1Id, key: photoKey});
  check([photo.queued, photo.id], [true, 'local-file:' + photoKey], 'the photo of the competitor\'s offer kept on the phone');
  const v1 = call(n1Id, {hasCompetitor: true, competitorName: 'منافس الاختبار', competitorFileId: photo.id, competitorFileName: 'photo.jpg'});
  await keep('/api/visits', v1, 'مصنع القاهرة الجديد', 'visit');
  const n3 = newCustomer('مصنع عمّان الجديد', '31.9539000, 35.9106000'), n3Id = 'crm-rep-' + n3.createKey;
  await keep('/api/crm', n3, 'مصنع عمّان الجديد', 'customer');
  const v3 = call(n3Id); await keep('/api/visits', v3, 'مصنع عمّان الجديد', 'visit');
  const stuck = call('c1', {result: 'تم الاتفاق على موعد'}); await keep('/api/visits', stuck, 'مصنع الأمل', 'visit');
  const proxied = call('c1', {result: 'طلب العميل عرضًا جديدًا'}); await keep('/api/visits', proxied, 'مصنع الأمل', 'visit');
  const moved = call('c3'); await keep('/api/visits', moved, 'مصنع الشروق', 'visit');
  const n2 = newCustomer('مصنع موجود مكرر', PLACE, 'الغربية');
  await keep('/api/crm', n2, 'مصنع موجود مكرر', 'customer');
  const id = (kind, key) => 'rep:' + kind + ':' + key;
  const J = {dup: id('followup', dup.createKey), closing: id('followup', closing.createKey), n1: id('customer', n1.createKey), photo: id('file', photoKey), v1: id('visit', v1.createKey), n3: id('customer', n3.createKey), v3: id('visit', v3.createKey), stuck: id('visit', stuck.createKey), proxied: id('visit', proxied.createKey), moved: id('visit', moved.createKey), n2: id('customer', n2.createKey)};
  const stored = key => page.evaluate(async key => { const job = await __offline.readOfflineStore('outbox', key); return job ? {status: job.status, message: job.message, httpStatus: job.httpStatus ?? null, answer: job.answer ?? null, archived: !!job.archivedAt, blob: job.blob instanceof Blob} : null; }, key);
  check((await page.evaluate(async () => (await __offline.readOfflineStore('outbox')).length)), 11, 'eleven entries kept, nothing sent');
  // An entry held before this release by a proxy page (an HTML 404): «تحتاج مراجعة» with the device's own words.
  await page.evaluate(async key => { const job = await __offline.readOfflineStore('outbox', key); await __offline.updateOfflineJob({...job, status: 'blocked', message: 'الخادم لم يرجع نتيجة صالحة. احتفظ بالبيانات وأعد المحاولة بعد التأكد من الاتصال.', httpStatus: 404}); }, J.stuck);
  // Meanwhile on the server: the same follow-up saved online, the second opportunity closed, the third customer moved to the west.
  const online = await app.as(cookie)('/api/customer-followups', {method: 'POST', body: {...dup, createKey: crypto.randomUUID()}});
  check(online.status, 200, 'the same follow-up saved online meanwhile');
  const first = online.json().id;
  await app.db.prepare("UPDATE crm_records SET data=json_set(data,'$.salesStage','won','$.nextAction','','$.nextDate','') WHERE id='c2-v'").run();
  await app.db.prepare("UPDATE crm_records SET assigned_to='west',data=json_set(data,'$.assignedTo','west','$.region','الغربية') WHERE id='c3'").run();

  // ---- Back online: the screen, synced until nothing more is sent.
  const dialog = page.locator('.offline-sync-dialog'), item = key => dialog.locator(`[data-offline-entry="${key}"]`);
  const openList = async () => { if (!await dialog.isVisible()) { await page.getByRole('button', {name: /حالة الحفظ|Save status/}).first().click(); await dialog.waitFor(); } };
  await openList();
  await item(J.stuck).waitFor();
  check([await item(J.stuck).locator('.offline-sync-title span').innerText(), await item(J.stuck).locator('[data-offline-review]').count()], ['تحتاج مراجعة', 0], 'the entry held by a proxy page: needs review, nothing more said of it');
  htmlFor = proxied.createKey;
  await context.setOffline(false);
  const leaseFree = () => page.evaluate(async () => { const lease = await __offline.readOfflineStore('meta', 'sync-lease'); return !lease || lease.expires <= Date.now(); });
  const syncButton = () => dialog.getByRole('button', {name: /مزامنة الآن|Sync now/});
  const syncOnce = async () => { for (let i = 0; i < 100 && !await leaseFree(); i++) await pause(150); if (await syncButton().isEnabled()) await syncButton().click(); await pause(200); for (let i = 0; i < 150 && (!await leaseFree() || !await syncButton().isEnabled()); i++) await pause(150); };
  const settled = async () => { const all = await page.evaluate(async () => (await __offline.readOfflineStore('outbox')).map(job => job.status)); return all.every(status => status === 'blocked'); };
  // While the proxy answers that entry with its HTML 413, it waits; the rest behind it wait for it.
  for (let round = 0; round < 6 && htmlServed < 2; round++) await syncOnce();
  ok(htmlServed >= 2, 'the proxy page answered the entry twice (' + htmlServed + ')');
  for (let i = 0; i < 100 && !await leaseFree(); i++) await pause(100);
  const waiting = await stored(J.proxied);
  check([waiting.status, waiting.httpStatus, waiting.message], ['pending', null, 'محفوظ على الجهاز؛ في انتظار الاتصال لإكمال الرفع.'], 'the HTML 413 of a proxy: kept waiting to be sent again, never «تحتاج مراجعة»');
  check(await item(J.proxied).locator('.offline-sync-title span').innerText(), 'بانتظار الرفع', 'and the list says so');
  htmlFor = '';
  for (let round = 0; round < 10 && !await settled(); round++) await syncOnce();
  ok(await settled(), 'every entry left needs review');
  check([await stored(J.stuck), await stored(J.proxied)], [null, null], 'the entry held by a proxy page released and saved, and the one the proxy answered sent again and saved');
  check((await rows("SELECT id FROM crm_records WHERE id IN (?,?)", 'customer-visit-' + stuck.createKey, 'customer-visit-' + proxied.createKey)).length, 2, 'both on the server, once each');
  check((await stored(J.dup)), {status: 'blocked', message: 'تغيّرت بيانات العميل أو متابعته الأخيرة. حدّث البيانات ثم أعد المحاولة.', httpStatus: 409, answer: {code: 'DUPLICATE', duplicate: {id: first, date: day}}, archived: false, blob: false}, 'the follow-up saved twice: held with the server\'s answer');
  check((await stored(J.closing)).answer, {code: 'OPPORTUNITY_UNAVAILABLE'}, 'the follow-up on the closed opportunity');
  check([(await stored(J.moved)).message, (await stored(J.moved)).httpStatus], ['اختر العميل', 403], 'the visit on the moved customer: the visits route\'s own words');
  check([(await stored(J.n1)).httpStatus, (await stored(J.photo)).httpStatus, (await stored(J.v1)).httpStatus, (await stored(J.photo)).blob], [400, 424, 424, true], 'the customer outside the Kingdom held, its photo and visit waiting behind it, the photo still on the phone');

  const note = key => item(key).locator('[data-offline-review]');
  check(await note(J.dup).innerText(), `يبدو أن هذه المتابعة مسجلة بالفعل: متابعة على الفرصة نفسها بتاريخ ${day}. إن كانت مكررة فاحذفها من الجهاز.`, 'the duplicate follow-up in the words asked for, with the day of the one saved');
  check(await note(J.dup).locator('bdi').innerText(), day, 'its day kept left to right');
  check(await item(J.dup).locator('.offline-sync-error').innerText(), 'رد الخادم: تغيّرت بيانات العميل أو متابعته الأخيرة. حدّث البيانات ثم أعد المحاولة.', 'the server\'s own reply kept under it');
  check(await note(J.closing).innerText(), 'لم تعد الفرصة متاحة لك (أُغلقت أو نُقلت أو حُذفت)، لذلك لا يمكن إرسال هذا الإدخال. يمكنك حذفه من الجهاز.', 'the opportunity closed');
  check(await note(J.moved).innerText(), 'لم يعد العميل متاحًا لك (نُقل أو حُذف)، لذلك لا يمكن إرسال هذا الإدخال. يمكنك حذفه من الجهاز.', 'the customer moved');
  check(await item(J.n2).locator('[data-offline-same-place]').getAttribute('data-offline-same-place'), 'cx', 'the new customer at the place of one already registered');
  ok((await item(J.n2).locator('[data-offline-same-place] p').innerText()).includes('مصنع موجود'), 'naming it');
  check(await item(J.v1).locator('[data-offline-delete]').count(), 1, 'an entry waiting behind another may be deleted too');
  check(await page.evaluate(selector => { const probe = document.body.appendChild(Object.assign(document.createElement('span'), {className: 'danger'})), expected = getComputedStyle(probe).color; probe.remove(); return getComputedStyle(document.querySelector(selector)).color === expected; }, `[data-offline-entry="${J.v1}"] [data-offline-delete]`), true, 'the delete link in the colour of a deletion');

  // ---- The layout with the confirmation of a deletion and the location editor, at every size.
  const noSideways = async label => { check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scrolling'); check(await dialog.evaluate(node => node.scrollWidth > node.clientWidth + 1), false, label + ': nothing wider than the dialog'); };
  const allInside = async label => check(await dialog.locator('button:visible, input:visible').evaluateAll(nodes => nodes.filter(node => { const box = node.getBoundingClientRect(); return box.width && (box.left < -1 || box.right > innerWidth + 1); }).map(node => node.textContent.trim().slice(0, 40) || node.tagName)), [], label + ': every button inside the screen');
  const shot = async label => { await page.evaluate(() => document.fonts.ready); await pause(250); await page.screenshot({path: path.join(screenshots, 'offline-stuck-' + label + '.png')}); };
  await item(J.n1).locator('[data-offline-delete]').click();
  const confirm = item(J.n1).locator('[data-offline-delete-confirm]');
  check(await confirm.locator('p').first().innerText(), 'سيُحذف هذا الإدخال من هذا الجهاز ولن يُرسل إلى الخادم. لا يمكن التراجع عن ذلك.', 'the confirmation\'s words');
  check(await confirm.locator('[data-offline-delete-item]').allInnerTexts(), ['مرفق · photo.jpg', 'زيارة · مصنع القاهرة الجديد'], 'what goes with it: its photo and the visit on it');
  for (const [label, size] of Object.entries(SIZES)) {
    await page.setViewportSize(size);await openList();
    await confirm.scrollIntoViewIfNeeded();
    await noSideways('delete ' + label); await allInside('delete ' + label); await shot('delete-' + label);
  }
  await page.setViewportSize(SIZES['phone-360']);
  // With only entries that need review there is nothing to send: «مزامنة الآن» asks nothing of the server and holds no lease.
  const asked = [];const count = request => { if (request.url().endsWith('/api/crm') && request.method() === 'GET') asked.push(request.url()); };
  page.on('request', count);await syncButton().click();await pause(800);page.off('request', count);
  check([asked.length, await leaseFree(), await confirm.locator('.offline-delete-reason').count()], [0, true, 0], 'nothing to send: no request, no lease, «حذف» stays available');
  // A sync running (the moved customer's visit tried again): the button waits, with its reason, and the device refuses the deletion meanwhile.
  holdSync = true;
  await item(J.moved).getByRole('button', {name: 'إعادة المحاولة'}).click();
  await confirm.locator('.offline-delete-reason').waitFor();
  check([await confirm.locator('.offline-delete-reason').innerText(), await confirm.locator('[data-offline-delete-confirm-button]').isDisabled()], ['الحذف غير متاح أثناء المزامنة. انتظر حتى تنتهي ثم أعد المحاولة.', true], 'during a sync: disabled, with its reason');
  check(await page.evaluate(async ids => { try { await __offline.deleteOfflineEntry(ids[0], (await __offline.loadOfflineSnapshot()).me, ids); return 'deleted'; } catch (error) { return error.reason || error.message; } }, [J.n1, J.photo, J.v1]), 'syncing', 'the device refuses a deletion under the sync\'s lease (another tab)');
  releaseSync();
  await confirm.locator('.offline-delete-reason').waitFor({state: 'detached'});
  await syncOnce();
  ok(await confirm.locator('[data-offline-delete-confirm-button]').isEnabled(), 'enabled again once the sync ended');
  await confirm.locator('[data-offline-delete-confirm-button]').click();
  await item(J.n1).waitFor({state: 'detached'});
  check([await stored(J.n1), await stored(J.photo), await stored(J.v1)], [null, null, null], 'the customer, its visit and its photo deleted from the phone');
  check(await page.evaluate(async () => (await __offline.readOfflineStore('outbox')).some(job => job.blob instanceof Blob)), false, 'no photo left on the phone');
  check(await dialog.locator('.offline-sync-notice').innerText(), 'حُذف الإدخال من الجهاز مع ما يرتبط به (2).', 'said so');
  check((await rows("SELECT id FROM crm_records WHERE json_extract(data,'$.name')='مصنع القاهرة الجديد'")).length + (await rows('SELECT id FROM crm_visit_files')).length, 0, 'none of them ever sent');

  // ---- The location corrected and resent; the visit on it follows.
  await item(J.n3).locator('[data-offline-place-open]').click();
  const editor = item(J.n3).locator('[data-offline-place]');
  for (const [label, size] of Object.entries(SIZES)) {
    await page.setViewportSize(size);await openList();
    await editor.scrollIntoViewIfNeeded();
    await noSideways('location ' + label); await allInside('location ' + label); await shot('location-' + label);
  }
  await page.setViewportSize(SIZES['phone-360']);
  const field = editor.getByLabel('اللوكيشن (خط العرض، خط الطول)');
  await field.fill('31.9539000, 35.9106000');
  await editor.locator('[data-offline-place-save]').click();
  check(await editor.locator('[role="alert"]').innerText(), 'موقع العميل خارج حدود المملكة العربية السعودية. اختر نقطة داخلها.', 'a place still outside the Kingdom: refused on the phone with the server\'s words');
  await field.fill('26.4500000, 50.1000000');await field.blur();
  await editor.locator('[data-offline-place-save]').click();
  for (let i = 0; i < 150 && (await stored(J.n3) || await stored(J.v3)); i++) { await pause(200); if (i % 20 === 19) await syncOnce(); }
  check([await stored(J.n3), await stored(J.v3)], [null, null], 'the customer resent with its new place, and the visit that waited behind it, both saved');
  const saved = (await rows('SELECT data FROM crm_records WHERE id=?', n3Id)).map(row => JSON.parse(row.data));
  check(saved.map(data => [data.name, data.location, data.latitude, data.longitude]), [['مصنع عمّان الجديد', '26.4500000, 50.1000000', 26.45, 50.1]], 'on the server with the corrected place');
  check((await rows('SELECT id FROM crm_records WHERE parent_id=?', n3Id)).length, 1, 'and the visit on it');

  // ---- The duplicate deleted; the closed opportunity's follow-up archived and then deleted from the archive.
  await item(J.dup).locator('[data-offline-delete]').click();
  check(await item(J.dup).locator('[data-offline-delete-item]').count(), 0, 'nothing goes with a follow-up');
  await item(J.dup).locator('[data-offline-delete-confirm-button]').click();
  await item(J.dup).waitFor({state: 'detached'});
  check(await stored(J.dup), null, 'the duplicate gone from the phone');
  check((await rows("SELECT id FROM crm_records WHERE parent_id='c1' AND json_extract(data,'$.visitWorkflow')='followup-v1'")).map(row => row.id), [first], 'one follow-up on the server');
  await item(J.closing).getByRole('button', {name: 'أرشفة للمراجعة'}).click();
  await item(J.closing).getByRole('button', {name: 'تأكيد الأرشفة'}).click();
  await item(J.closing).waitFor({state: 'detached'});
  await dialog.getByRole('button', {name: /الأرشيف المحلي/}).click();
  await item(J.closing).waitFor();
  check(await item(J.closing).locator('.offline-sync-title span').innerText(), 'مؤرشف على الجهاز', 'in the local archive');
  await item(J.closing).locator('[data-offline-delete]').click();
  await item(J.closing).locator('[data-offline-delete-confirm-button]').click();
  await item(J.closing).waitFor({state: 'detached'});
  check(await stored(J.closing), null, 'deleted from the archive too');

  // ---- English.
  await page.evaluate(() => localStorage.setItem('yr-test-language', 'en'));
  await start();
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  await openList();
  await item(J.moved).waitFor();
  const noArabic = async (locator, label) => { const words = await locator.evaluate(node => { const copy = node.cloneNode(true); copy.querySelectorAll('bdi').forEach(entry => entry.remove()); return copy.textContent; }); check(/[؀-ۿ]/.test(words), false, label + ': no Arabic left (' + words.slice(0, 160) + ')'); };
  check(await note(J.moved).innerText(), 'The customer is no longer available to you (it was moved or deleted), so this entry cannot be sent. You can delete it from the device.', 'the moved customer in English');
  await noArabic(note(J.moved), 'the note'); await noArabic(item(J.moved).locator('[data-offline-delete]'), 'the delete button');
  await noArabic(item(J.n2).locator('[data-offline-same-place]'), 'the same place');
  check(await item(J.n2).locator('[data-offline-open-existing]').innerText(), 'Open the existing customer', 'its button');
  await item(J.n2).locator('[data-offline-delete]').click();
  await noArabic(item(J.n2).locator('[data-offline-delete-confirm]'), 'the confirmation');
  await item(J.n2).getByRole('button', {name: 'Cancel', exact: true}).click();
  for (const label of ['phone-320', 'desktop']) { await page.setViewportSize(SIZES[label]); await openList(); await noSideways('english ' + label); await allInside('english ' + label); await shot('english-' + label); }
  await page.setViewportSize(SIZES['phone-360']);
  await page.evaluate(() => localStorage.setItem('yr-test-language', 'ar'));
  await start();
  await openList();

  // ---- «فتح العميل الموجود».
  await item(J.n2).locator('[data-offline-open-existing]').click();
  await dialog.waitFor({state: 'detached'});
  const sheet = page.locator('.crm-sheet');
  await sheet.waitFor();
  ok((await sheet.innerText()).includes('مصنع موجود'), 'the existing customer\'s sheet opens');
  await shot('open-existing-phone-360');
  check(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks, screenshots, realBrowser: true, builtRelease: true}));
} catch (error) {
  console.error(error);
  if (app) console.error(app.log().slice(-3000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await app?.stop();
}
