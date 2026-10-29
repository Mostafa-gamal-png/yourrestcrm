// Opening the app on the device's copy of the data (app/crm-app.tsx, 2026-10-29): in a real Chromium on the BUILT app, the
// server's answer is held back on purpose so each step is seen in order, not guessed from timings.
//   1. A representative who opened the app once sees their customers at once on the next opening, with «يتم تحديث البيانات…»,
//      before the server has answered; the answer then replaces the copy (a customer added meanwhile appears) and the line goes.
//   2b. A server that cannot be reached leaves the copy on screen, without an error.
//   2. Another account signing in on the same device never sees that copy: the screen waits for its own data.
//   3. A session that ended on the server: the copy may show for a moment, and goes as soon as the server says so.
// Working without a network on the copy is tests/offline-browser.mjs.
// Run `pnpm build` first. Synthetic isolated fixtures only: temporary SQLite, no production data.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require('playwright');
const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'سعد مدير المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'sm', name: 'ماجد المشرف'},
  {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'أحمد المندوب'}, {id: 'rep2', role: 'rep', sup: 'sup', region: 'western', name: 'سالم المندوب'}
];
const MINE = 'مصنع الياسمين للطوب', LATER = 'مصنع الندى الجديد', OTHER = 'مصنع الريحان الغربي';
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

try {
  app = await bootBuiltApp({members}, {tls: true});
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  const created = new Date().toISOString();
  const customer = (id, name, region, owner) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, owner, JSON.stringify({name, region, city: region === 'الشرقية' ? 'الدمام' : 'جدة', phone: '0550000' + id.length + '00', contact: 'م', code: id.toUpperCase(), branch: 'الرئيسي', assignedTo: owner}), created, created).run();
  await customer('c-mine', MINE, 'الشرقية', 'rep');
  await customer('c-other', OTHER, 'الغربية', 'rep2');
  for (let i = 0; i < 40; i++) await customer('f' + i, 'مصنع رقم ' + (i + 1), i % 2 ? 'الشرقية' : 'الغربية', i % 2 ? 'rep' : 'rep2');

  const context = await browser.newContext({ignoreHTTPSErrors: true, viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block', geolocation: {latitude: 26.437341, longitude: 50.034499, accuracy: 8}, permissions: ['geolocation']});
  const signIn = async memberId => { const cookie = await app.login(memberId), [name, ...value] = cookie.split('='); await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]); };
  // The server's answer to /api/crm waits until the test lets it go.
  let hold = null, held = 0, failNext = false, failed = 0;
  await context.route('**/api/crm', async route => {
    if (route.request().method() === 'GET' && failNext) { failNext = false; failed++; return route.abort('internetdisconnected'); }
    if (route.request().method() !== 'GET' || !hold) return route.continue();
    held++; await hold.promise; return route.continue().catch(() => {});
  });
  const holdAnswers = () => { let release; hold = {promise: new Promise(resolve => { release = resolve; })}; hold.release = () => { const h = hold; hold = null; release(); return h; }; };
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await installNativeBridge(page, {memberId: 'rep', regionScope: 'eastern'});
  const shown = name => page.locator('.workspace').getByText(name, {exact: true}).locator('visible=true');
  const notice = page.locator('.refresh-notice');
  const skeleton = page.locator('[data-slot=skeleton]');
  const openCustomers = async () => { await page.locator('.mobile-tab[data-page="customer"]').click(); await page.locator('.mobile-tab[data-page="customer"][aria-current="page"]').waitFor(); };

  // ---- 1. the first opening ever: nothing on the device, the screen waits for the server
  await signIn('rep');
  holdAnswers();
  await page.goto(app.origin + '/');
  await page.waitForTimeout(1500);
  check(await skeleton.count() > 0, true, 'the first opening waits for the server: there is no copy on the device yet');
  check(await notice.count(), 0, 'no updating line without a copy on screen');
  hold.release();
  await page.locator('.page-heading h1').waitFor();
  await openCustomers();
  await shown(MINE).first().waitFor();
  // Saved on the device after it is on screen: the copy is there once the page is quiet.
  await page.waitForFunction(async () => { const db = await new Promise((resolve, reject) => { const r = indexedDB.open('yourrest-offline-v1'); r.onsuccess = () => resolve(r.result); r.onerror = reject; }).catch(() => null); if (!db || !db.objectStoreNames.contains('snapshots')) return false; const rows = await new Promise(resolve => { const r = db.transaction('snapshots').objectStore('snapshots').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve([]); }); db.close(); return rows.some(row => row.ownerId === 'rep'); }, null, {polling: 250});
  ok(true, 'the snapshot is saved on the device after the data is shown');

  // ---- 2. the next opening: the copy at once, the server's answer replaces it
  await customer('c-later', LATER, 'الشرقية', 'rep'); // added on the server while the app was closed
  holdAnswers();
  await page.reload();
  await shown(MINE).first().waitFor({timeout: 15000});
  check(held >= 1, true, 'the server has not answered yet (held back)');
  ok(await notice.isVisible(), 'the updating line shows while the copy is on screen');
  check((await notice.textContent()).trim(), 'يتم تحديث البيانات…', 'the updating line says so in Arabic');
  check(await shown(LATER).count(), 0, 'what the server added meanwhile is not in the copy');
  check(await skeleton.count(), 0, 'no loading placeholders over the copy');
  if (process.env.YR_GATE_SCREENSHOT_DIR) await page.screenshot({path: process.env.YR_GATE_SCREENSHOT_DIR + '/open-cached-updating.png'});
  hold.release();
  await shown(LATER).first().waitFor();
  await notice.waitFor({state: 'detached'});
  ok(await shown(MINE).first().isVisible(), 'the server\'s answer replaced the copy and kept what was there');

  // ---- 2b. the server cannot be reached (a weak signal the phone still calls online): the copy stays, without an error
  failNext = true;
  await page.reload();
  await shown(MINE).first().waitFor({timeout: 15000});
  await page.waitForFunction(() => !document.querySelector('.refresh-notice'), null, {timeout: 20000});
  ok(await shown(LATER).first().isVisible(), 'the last copy (with what the server sent before) stays on screen');
  check(await page.locator('.error-banner').count(), 0, 'and no error replaces it');
  check(failed, 1, 'the request did fail');

  // ---- 3. another account on the same device: signing in locks the copy; the screen waits for that account's own data
  await context.clearCookies();
  await page.goto(app.origin + '/login');
  await page.waitForTimeout(800);
  await signIn('sm');
  holdAnswers();
  await page.goto(app.origin + '/#customer');
  await page.waitForTimeout(2000);
  check(await shown(MINE).count(), 0, 'the representative\'s copy is never shown to the manager who signed in after them');
  check(await notice.count(), 0, 'and no updating line: there is no copy for this account');
  ok(await skeleton.count() > 0, 'the manager waits for their own data');
  hold.release();
  await shown(OTHER).first().waitFor();
  ok(true, 'the manager sees their own data once the server answers');

  // ---- 4. the session ended on the server (signed out elsewhere): whether the page or the data asks first, the copy does not stay
  await page.reload(); // the manager's copy is now on the device
  await shown(OTHER).first().waitFor();
  await page.waitForTimeout(1000);
  await app.db.prepare("UPDATE auth_sessions SET revoked_at=? WHERE revoked_at IS NULL").bind(new Date().toISOString()).run();
  holdAnswers();
  await page.reload();
  await page.waitForTimeout(1500);
  hold.release();
  await page.waitForFunction(() => location.pathname === '/login' || document.querySelector('.error-banner a[href="/login"]'), null, {timeout: 20000});
  check(await shown(OTHER).count(), 0, 'once the server refuses the session the copy is not on the screen');
  ok(await page.evaluate(async () => { const db = await new Promise(resolve => { const r = indexedDB.open('yourrest-offline-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(null); }); if (!db) return true; const session = await new Promise(resolve => { const r = db.transaction('meta').objectStore('meta').get('session'); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(null); }); db.close(); return !session; }), 'and the device copy is locked: no account is unlocked on the device');

  check(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks}));
} finally {
  await browser?.close(); await app?.stop();
}
