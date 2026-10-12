// Mandatory route tracking for representatives in a real Chromium against the BUILT release (run `pnpm build` first).
// The Android app is emulated through scripts/lib/native-bridge.mjs: the web code, the server and the database are real,
// the phone's consent, permissions and enrolment are the emulator's. No device, GPS or OS claim is made.
// Synthetic isolated fixtures only: temporary SQLite, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge, nativeControl} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require('playwright');
const members = [
  {id: 'owner', role: 'admin', name: 'QA admin'}, {id: 'mgr', role: 'manager', name: 'QA manager'}, {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'QA supervisor', region: 'western'},
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => ({id: 'rep' + n, role: 'rep', sup: 'sup', region: 'western', name: 'مندوب ' + n}))
];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-gate-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1280, height: 900};

try {
  app = await bootBuiltApp({members}, {tls: true});
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  /** A signed-in page. native: false = plain browser, true/object = the Android app emulator (object = bridge options). */
  async function open(memberId, {native = false, viewport = PHONE, userAgent} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', ...(userAgent ? {userAgent} : {})});
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (native) await installNativeBridge(page, native === true ? {} : native);
    await page.goto(app.origin + '/');
    return page;
  }
  const gateOf = page => page.locator('main.tracking-gate');
  const waitGate = (page, reason) => page.locator(`main.tracking-gate[data-gate="blocked"][data-gate-reason="${reason}"]`).waitFor();
  const waitWorkspace = async page => { await page.locator('.workspace').waitFor(); check(await gateOf(page).count(), 0, 'no gate once the workspace shows'); };
  const noWorkspace = async (page, message) => { check([await page.locator('.workspace').count(), await page.locator('.app-shell').count()], [0, 0], message); };
  const shot = async (page, label) => { await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const layoutOk = async (page, label) => { const geometry = await page.evaluate(() => ({overflow: document.documentElement.scrollWidth > innerWidth + 1, width: innerWidth})); check(geometry.overflow, false, label + ': no horizontal overflow at ' + geometry.width + 'px'); };
  const reportOf = async (memberId, platform) => { const row = await app.db.prepare('SELECT data,reported_at AS reportedAt FROM crm_member_devices WHERE member_id=? AND platform=?').bind(memberId, platform).first(); return row ? {...JSON.parse(row.data), reportedAt: row.reportedAt} : null; };
  async function waitReport(memberId, platform, predicate = () => true, timeoutMs = 15000) {
    const until = Date.now() + timeoutMs;
    for (;;) { const report = await reportOf(memberId, platform); if (report && predicate(report)) return report; if (Date.now() > until) throw Error(`No matching ${platform} report for ${memberId}: ${JSON.stringify(report)}`); await pause(150); }
  }
  const texts = page => gateOf(page).innerText();

  // ---- 1. A representative in an ordinary browser is blocked, on every kind of device
  {
    const page = await open('rep1', {viewport: PHONE});
    await waitGate(page, 'browser');
    check(await gateOf(page).getAttribute('data-gate'), 'blocked');
    await noWorkspace(page, 'browser: no workspace, no navigation, no data tables');
    const text = await texts(page);
    ok(text.includes('تطبيق يورست') && text.includes('أندرويد'), 'the block names the Android app');
    ok(text.includes('مندوب 1'), 'the block shows whose account it is');
    check(await page.locator('a[href$=".apk"]').count(), 0, 'a desktop browser is not offered an APK');
    check(await page.getByRole('button', {name: 'تسجيل الخروج'}).count(), 1, 'sign-out stays available');
    check(await page.locator('main.tracking-gate button:has-text("تفعيل التتبع")').count(), 0, 'a browser cannot activate tracking');
    await layoutOk(page, 'browser block'); await shot(page, 'gate-browser-desktop-ua');
    const report = await waitReport('rep1', 'browser');
    check([report.gate, report.deviceClass, report.platform, report.tracking, report.enrolled], ['browser', 'desktop', 'browser', false, false], 'the browser attempt is reported to the server');
    await page.context().close();

    const android = await open('rep2', {userAgent: ANDROID_CHROME});
    await waitGate(android, 'browser');
    check(await android.locator('a[href$=".apk"]').count(), 1, 'Chrome on Android is offered the app download');
    ok((await android.locator('a[href$=".apk"]').getAttribute('href')).includes('yourrest-crm-android'), 'the download is the app');
    await layoutOk(android, 'browser block on Android'); await shot(android, 'gate-browser-android-chrome');
    check((await waitReport('rep2', 'browser')).deviceClass, 'android', 'reported as an Android browser');
    await android.context().close();

    const iphone = await open('rep3', {userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'});
    await waitGate(iphone, 'browser');
    check(await iphone.locator('a[href$=".apk"]').count(), 0, 'an iPhone is not offered an APK');
    check((await waitReport('rep3', 'browser')).deviceClass, 'iphone', 'reported as an iPhone');
    await iphone.context().close();
  }

  // ---- 2. Everyone else is untouched, in a plain browser
  for (const id of ['owner', 'mgr', 'sup']) {
    const page = await open(id, {viewport: DESKTOP});
    await waitWorkspace(page);
    check(await page.locator('main.tracking-gate').count(), 0, id + ' is never gated');
    await page.context().close();
  }
  check(await app.db.prepare("SELECT COUNT(*) n FROM crm_member_devices WHERE member_id IN ('owner','mgr','sup')").first('n'), 0, 'only representatives report a phone');

  // ---- 3. A freshly installed app: consent, permissions, enrolment
  {
    const page = await open('rep4', {native: {regionScope: 'western'}});
    await waitGate(page, 'setup');
    await noWorkspace(page, 'fresh install: still blocked');
    const needed = await page.locator('li[data-requirement][data-needed="yes"]').evaluateAll(items => items.map(item => item.dataset.requirement));
    check(needed, ['consent', 'fine_location', 'notifications', 'background_location', 'enrollment'], 'the checklist lists what is missing');
    check(await page.locator('li[data-requirement="location_services"]').getAttribute('data-needed'), 'no', 'the phone GPS switch is already on');
    await layoutOk(page, 'setup block'); await shot(page, 'gate-setup');
    const phone = nativeControl(page);
    await page.clock.install();
    await page.getByRole('button', {name: 'تفعيل التتبع'}).click();
    await waitWorkspace(page);
    const calls = (await phone.calls()).map(call => call.method);
    ok(calls.indexOf('prepare') > -1 && calls.indexOf('enroll') > calls.indexOf('prepare'), 'activation asks for permissions, then enrols: ' + calls.join(','));
    check((await phone.calls()).find(call => call.method === 'prepare').payload, {continuous: true}, 'the continuous recording consent flow is used');
    check((await phone.calls()).find(call => call.method === 'enroll').payload, {memberId: 'rep4'}, 'the phone is enrolled for this account');
    check((await phone.state()).enrolled, true, 'the phone ends up enrolled');
    const first = await reportOf('rep4', 'android-app');
    check(first === null || first.gate === 'setup', true, 'the first report, if already sent, was the blocked state');
    // The page's clock jumps a minute; the server's clock cannot, so its copy of the previous report ages by the same minute.
    await app.db.prepare("UPDATE crm_member_devices SET reported_at=? WHERE member_id='rep4' AND platform='android-app'").bind(new Date(Date.now() - 61000).toISOString()).run();
    await page.clock.fastForward(61000);
    const settled = await waitReport('rep4', 'android-app', report => report.gate === 'ok');
    check([settled.enrolled, settled.consent, settled.background, settled.fineLocation, settled.notifications, settled.missing, settled.appVersion], [true, true, 'granted', 'granted', 'granted', [], '1.0.10'], 'the server learns the phone is set up');
    await page.context().close();
  }

  // ---- 4. Refusals keep the block and say exactly what to do
  {
    const declined = await open('rep5', {native: {regionScope: 'western', grant: {consent: false}}});
    await waitGate(declined, 'setup');
    await declined.getByRole('button', {name: 'تفعيل التتبع'}).click();
    await declined.locator('.tracking-gate-error').waitFor();
    ok((await texts(declined)).includes('يلزم الموافقة'), 'declining consent shows the reason');
    await waitGate(declined, 'setup'); await noWorkspace(declined, 'consent declined: still blocked');
    await declined.context().close();

    const noBackground = await open('rep6', {native: {regionScope: 'western', grant: {background: false}}});
    await waitGate(noBackground, 'setup');
    const phone = nativeControl(noBackground);
    await noBackground.getByRole('button', {name: 'تفعيل التتبع'}).click();
    await waitGate(noBackground, 'permission');
    await noWorkspace(noBackground, 'background location refused: still blocked');
    check(await noBackground.locator('li[data-requirement][data-needed="yes"]').evaluateAll(items => items.map(item => item.dataset.requirement)), ['background_location', 'enrollment'], 'only the refused permission and enrolment remain');
    ok((await texts(noBackground)).includes('السماح طوال الوقت'), 'the exact setting is named');
    await shot(noBackground, 'gate-permission');
    // The person grants it in Android settings and returns; the phone reports the change.
    await phone.grant({background: true});
    await phone.set({backgroundPermission: 'granted'});
    await waitGate(noBackground, 'setup');
    await noBackground.getByRole('button', {name: 'تفعيل التتبع'}).click();
    await waitWorkspace(noBackground);
    await noBackground.context().close();

    const noFine = await open('rep7', {native: {regionScope: 'western', grant: {fine: false}}});
    await waitGate(noFine, 'setup');
    await noFine.getByRole('button', {name: 'تفعيل التتبع'}).click();
    await waitGate(noFine, 'permission');
    ok((await texts(noFine)).includes('استخدام الموقع الدقيق'), 'approximate location is explained');
    await noFine.context().close();
  }

  // ---- 5. A set-up phone works, and loses access the moment a requirement is withdrawn
  {
    const page = await open('rep8', {native: {memberId: 'rep8', regionScope: 'western'}});
    await waitWorkspace(page);
    const phone = nativeControl(page);
    ok((await phone.calls()).some(call => call.method === 'status'), 'the app asked the phone for its state');
    await layoutOk(page, 'workspace with tracking');
    const withdraw = async (patch, reason, text, label) => {
      const before = Object.fromEntries(Object.keys(patch).map(key => [key, null]));
      const original = await phone.state();
      const restore = Object.fromEntries(Object.keys(patch).map(key => [key, original[key]]));
      await phone.set(patch);
      await waitGate(page, reason);
      await noWorkspace(page, label + ': workspace removed');
      ok((await texts(page)).includes(text), label + ': says what is wrong');
      await shot(page, 'gate-' + label.replace(/\W+/g, '-'));
      await phone.set(restore);
      await waitWorkspace(page);
      return before;
    };
    await withdraw({backgroundPermission: 'denied'}, 'permission', 'السماح طوال الوقت', 'background location withdrawn');
    await withdraw({notificationPermission: 'denied'}, 'permission', 'الإشعارات', 'notifications withdrawn');
    await withdraw({fineLocationPermission: 'denied'}, 'permission', 'الموقع الدقيق', 'precise location withdrawn');
    await withdraw({locationServicesEnabled: false}, 'location_services', 'الموقع (GPS)', 'phone GPS switched off');
    await withdraw({appVersion: '1.0.6'}, 'upgrade', 'حدّث تطبيق', 'outdated app version');
    await withdraw({enrolled: false, memberId: null}, 'setup', 'تسجيل هذا الهاتف', 'enrolment lost');
    // Trouble during the day is not a block: GPS waits, queued points, no network, a paused collector.
    for (const patch of [{error: 'بانتظار موقع حديث؛ الفترة غير المؤكدة تظهر في التقرير'}, {syncError: 'لا يوجد اتصال بالخادم؛ يجري حفظ الموقع على الجهاز لحين عودة الشبكة', pendingCount: 400, pendingGapCount: 3}, {lastFixAt: '2026-10-12T05:00:00.000Z', accuracy: 900}]) {
      await phone.set(patch); await pause(400);
      check([await gateOf(page).count(), await page.locator('.workspace').count()], [0, 1], 'daytime trouble does not block: ' + JSON.stringify(Object.keys(patch)));
    }
    await page.context().close();
  }

  // ---- 6. The bridge itself: slow, then fine; or never there
  {
    const slow = await open('rep9', {native: {memberId: 'rep9', regionScope: 'western', lateBridgeMs: 2500}});
    await slow.locator('main.tracking-gate[data-gate="checking"]').waitFor();
    await noWorkspace(slow, 'while the app has not answered, the workspace is not shown');
    await waitWorkspace(slow);
    await slow.context().close();

    const silent = await open('rep10', {native: {memberId: 'rep10', regionScope: 'western', noBridge: true}});
    await silent.locator('main.tracking-gate[data-gate="checking"]').waitFor();
    await waitGate(silent, 'bridge');
    await noWorkspace(silent, 'a silent bridge blocks');
    ok((await texts(silent)).includes('أغلق التطبيق'), 'the person is told to reopen the app');
    check(await silent.getByRole('button', {name: 'إعادة المحاولة'}).count(), 1, 'and can try again');
    await silent.context().close();
  }

  // ---- 7. Supervisors see why a representative has no GPS
  {
    // rep2 and rep1 tried browsers earlier; rep3 an iPhone. rep7 never reported a browser. Look at a finished working day.
    const page = await open('sup', {viewport: DESKTOP});
    await waitWorkspace(page);
    await page.locator('.nav-item', {hasText: 'تقرير يوم المندوب'}).first().click();
    await page.locator('.journey-toolbar select').waitFor();
    await page.locator('.journey-toolbar input[type=date]').fill('2026-10-07');
    const coverage = async memberId => {
      await page.locator('.journey-toolbar select').selectOption(memberId);
      await page.locator('[data-coverage-panel="problems"]').waitFor();
      const rows = await page.locator('[data-coverage-panel="problems"] li').evaluateAll(items => items.map(item => ({member: item.dataset.member, status: item.dataset.status, text: item.innerText})));
      check(rows.map(row => row.member), [memberId], 'the panel concerns the selected representative only');
      return rows[0];
    };
    const one = await coverage('rep1');
    check(one.status, 'never_tracked', 'no GPS point ever arrived');
    ok(one.text.includes('لم يُفعَّل تتبع المسار على هاتف المندوب قط') && one.text.includes('المتصفح') && one.text.includes('حاسوب'), 'rep1: never activated, and the supervisor sees a computer browser was tried: ' + one.text);
    await shot(page, 'report-coverage-panel'); await layoutOk(page, 'coverage panel');
    ok((await coverage('rep3')).text.includes('آيفون'), 'rep3: an iPhone');
    ok((await coverage('rep4')).text.includes('التتبع يعمل'), 'rep4 set up tracking: the phone says it is working even though no point arrived yet');
    const sixth = (await coverage('rep6')).text;
    ok(sixth.includes('آخر تقرير من الهاتف') && sixth.includes('1.0.10'), 'rep6: the last phone report with its version: ' + sixth);
    ok((await coverage('rep7')).text.includes('الناقص'), 'rep7 refused a permission: the report names what is missing');
    const silent = (await coverage('rep5')).text;
    ok(silent.includes('آخر تقرير من الهاتف'), 'rep5 declined consent and said so: ' + silent);
    await page.locator('.journey-toolbar input[type=date]').fill('2026-10-09');
    await page.locator('.journey-toolbar select').selectOption('rep1');
    await page.locator('.journey-day, .journey-empty').first().waitFor();
    check(await page.locator('[data-coverage-panel]').count(), 0, 'Friday raises no tracking alarm');
    await page.context().close();

    const admin = await open('owner', {viewport: DESKTOP});
    await waitWorkspace(admin);
    await admin.locator('.nav-item', {hasText: 'الفريق والصلاحيات'}).first().click();
    await admin.locator('th', {hasText: 'التتبع'}).waitFor();
    await admin.locator('.team-tracking[data-member="rep1"]').waitFor();
    const cell = await admin.locator('.team-tracking[data-member="rep1"]').innerText();
    ok(/متصفح|التطبيق/.test(cell), 'the team page shows the phone line for rep1: ' + cell);
    ok(['tracked', 'never_tracked', 'no_points_today', 'day_without_points', 'rest_day', 'not_started'].includes(await admin.locator('.team-tracking[data-member="rep1"]').getAttribute('data-status')), 'with a known status');
    check(await admin.locator('tr', {has: admin.locator('strong', {hasText: /^QA supervisor$/})}).locator('.team-tracking').count(), 0, 'supervisors have no tracking cell');
    await shot(admin, 'team-tracking-column');
    await admin.context().close();
  }

  // ---- 8. The app launches cleanly: no hydration error, and no "update the app" notice before the app has reported itself
  {
    const notice = page => page.locator('.journey-form-notice', {hasText: 'حدّث تطبيق أندرويد إلى 1.0.10'});
    const slow = await open('sup', {native: {lateBridgeMs: 2500}, viewport: DESKTOP});
    await waitWorkspace(slow);
    await pause(900);
    check(await notice(slow).count(), 0, 'before the bridge answers, no outdated-app notice flashes');
    await slow.waitForFunction(() => window.__yourrestNative !== undefined);
    await pause(1500);
    check(await notice(slow).count(), 0, 'a current app never sees it');
    await slow.context().close();
    const old = await open('sup', {native: {state: {foregroundDirectionsSupported: false}}, viewport: DESKTOP});
    await waitWorkspace(old);
    await notice(old).waitFor();
    check(await notice(old).count(), 1, 'an app without foreground directions is still told to update, once it has reported itself');
    await old.context().close();
  }

  ok(!errors.length, 'no uncaught page errors: ' + errors.join(' | '));
  console.log(JSON.stringify({ok: true, checks, screenshots, realChromium: true, androidAppEmulated: true, physicalDevice: false, productionDataUsed: false}));
} finally {
  await browser?.close(); await app?.stop();
}
