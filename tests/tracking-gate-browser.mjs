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
import {SERVED_APP_VERSION, installNativeBridge, nativeControl} from '../scripts/lib/native-bridge.mjs';
import {build} from 'esbuild';

const require = createRequire(import.meta.url), {chromium} = require('playwright');
const members = [
  {id: 'owner', role: 'admin', name: 'QA admin'}, {id: 'mgr', role: 'manager', name: 'QA manager'}, {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'QA supervisor', region: 'western'},
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(n => ({id: 'rep' + n, role: 'rep', sup: 'sup', region: 'western', name: 'مندوب ' + n})),
  {id: 'rep12', role: 'rep', sup: 'sup', region: 'western', name: 'مندوب 12'}, {id: 'cs', role: 'customer_service', region: 'western', name: 'QA customer service'}
];
const SERVED = JSON.parse(fs.readFileSync(new URL('../lib/app-update-release.json', import.meta.url), 'utf8'));
/** The app's update protocol (MainActivity's bridge with NativeAppUpdater.state(), protocol 1 since 1.0.10) over the emulator: an older
 *  installed code, the release read by the app itself, a download that ends ready or, when the test says so, in an error. */
const updateBridgeSource = ({code, name}) => `(() => {
  if (window !== window.top || !window.__yourrestNative) return;
  const base = window.__yourrestNative, state = {updateProtocol: 1, phase: 'idle', installedVersionCode: ${code}, installedVersionName: ${JSON.stringify(name)}, downloadedBytes: 0, totalBytes: 0, progress: 0};
  const emit = () => window.dispatchEvent(new CustomEvent('yourrest:app-update', {detail: JSON.parse(JSON.stringify(state))}));
  const mock = window.__updateMock = {state, calls: [], failDownload: false, set(patch) { Object.assign(state, patch); emit(); }};
  const methods = {
    async updateStatus() { return {...state}; },
    async checkAppUpdate() { const release = await (await fetch('/api/app-update', {cache: 'no-store'})).json(); delete state.error; Object.assign(state, {phase: 'available', availableVersionCode: release.versionCode, availableVersionName: release.versionName, totalBytes: release.sizeBytes, releaseNotes: release.releaseNotes}); return {...state}; },
    async downloadAppUpdate() { Object.assign(state, {phase: 'downloading', progress: 0, downloadedBytes: 0}); emit(); setTimeout(() => { if (mock.failDownload) Object.assign(state, {phase: 'error', error: 'لم يكتمل تنزيل تحديث موثوق'}); else Object.assign(state, {phase: 'ready', progress: 100, downloadedBytes: state.totalBytes}); emit(); }, 400); return {...state}; },
    async installAppUpdate() { Object.assign(state, {phase: 'installing'}); emit(); return {...state}; }
  };
  window.__yourrestNative = {...base, updateProtocol: 1, installedVersionCode: ${code}, installedVersionName: ${JSON.stringify(name)}, async request(method, payload = {}) { mock.calls.push(method); return methods[method] ? methods[method](payload) : base.request(method, payload); }};
})();`;
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
  async function open(memberId, {native = false, update, viewport = PHONE, userAgent, clockAt} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', ...(userAgent ? {userAgent} : {})});
    // A page whose clock starts at a given time and then runs (the server keeps the real one).
    if (clockAt) await context.clock.install({time: clockAt});
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (native) await installNativeBridge(page, native === true ? {} : native);
    if (update) await page.addInitScript({content: updateBridgeSource(update)});
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
    check([settled.enrolled, settled.consent, settled.background, settled.fineLocation, settled.notifications, settled.missing, settled.appVersion], [true, true, 'granted', 'granted', 'granted', [], SERVED_APP_VERSION], 'the server learns the phone is set up');
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
    // An app older than the served release is held at the update screen (lib/app-update.ts appUpdateRequired), whatever else it lacks. The
    // workspace stays mounted under it, hidden, while the representative's tracking works (1.0.7); an app too old to track (1.0.6, no
    // work-hours schedule) has no workspace, as before.
    for (const [appVersion, label, kept] of [['1.0.6', 'outdated app version', 0], ['1.0.7', 'app older than the served version', 1]]) {
      await phone.set({appVersion});
      await page.locator('main.tracking-gate[data-gate-update="required"]').waitFor();
      check([await page.locator('.workspace').count(), await page.locator('.workspace').isVisible()], [kept, false], label + (kept ? ': the workspace is kept but hidden' : ': no workspace for an app that cannot track'));
      ok((await texts(page)).includes('أقدم من الإصدار المطلوب ' + SERVED_APP_VERSION), label + ': says what is wrong');
      await shot(page, 'gate-' + label.replace(/\W+/g, '-'));
      await phone.set({appVersion: SERVED_APP_VERSION});
      await waitWorkspace(page);
    }
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
    ok(sixth.includes('آخر تقرير من الهاتف') && sixth.includes(SERVED_APP_VERSION), 'rep6: the last phone report with its version: ' + sixth);
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
    const notice = page => page.locator('.journey-form-notice', {hasText: 'حدّث تطبيق أندرويد إلى ' + SERVED_APP_VERSION});
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

  // ---- 9. A tablet beside the work phone: while the phone records today's route, the tablet works without recording;
  // once the phone has been quiet for half an hour, the tablet is gated again and says where the route was recorded.
  // The companion screen belongs to working hours (06:00-18:00 Riyadh, not Friday), on the device and on the server: this part
  // runs on its own built app whose clock, like the tablet's, starts at 10:00 of a working day, so it gives the same answer at any hour.
  {
    const riyadhDay = at => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(at);
    const isFriday = at => new Intl.DateTimeFormat('en-US', {timeZone: 'Asia/Riyadh', weekday: 'short'}).format(at) === 'Fri';
    const workday = isFriday(new Date()) ? new Date(Date.now() - 86_400_000) : new Date();
    const offset = Date.parse(riyadhDay(workday) + 'T07:00:00.000Z') - Date.now(), shifted = () => new Date(Date.now() + offset);
    const mainApp = app;
    app = await bootBuiltApp({members}, {tls: true, env: {NODE_OPTIONS: '--import ' + new URL('../scripts/lib/shifted-clock.mjs', import.meta.url).href, TEST_CLOCK_OFFSET_MS: String(offset)}});
    try {
      const today = riyadhDay(shifted());
      const {scope} = await app.db.prepare('SELECT region_scope AS scope FROM crm_members WHERE id=?').bind('rep11').first();
      const ago = minutes => new Date(shifted().getTime() - minutes * 60_000).toISOString();
      await app.db.prepare('INSERT INTO crm_mobile_route_days(id,member_id,device_id,date,region_scope,started_at,ended_at,last_point_at,data,version,mutation_id) VALUES(?,?,?,?,?,?,NULL,?,?,1,?)')
        .bind('mobile-rep11-phone', 'rep11', crypto.randomUUID(), today, scope, ago(20), ago(1), JSON.stringify({gaps: [], trackingWindow: '06-18'}), 'seed').run();
      const tablet = await open('rep11', {native: {regionScope: 'western'}, viewport: {width: 800, height: 1280}, clockAt: shifted()});
      await waitWorkspace(tablet);
      await tablet.locator('[data-tracking="companion"]').first().waitFor();
      check(await gateOf(tablet).count(), 0, 'a tablet that records nothing is not gated while the phone records');
      await layoutOk(tablet, 'companion tablet'); await shot(tablet, 'gate-companion-tablet');
      await pause(2500);
      check(await reportOf('rep11', 'android-app'), null, 'the tablet does not overwrite the phone status report');
      await app.db.prepare('UPDATE crm_mobile_route_days SET started_at=?,last_point_at=? WHERE id=?').bind(ago(90), ago(45), 'mobile-rep11-phone').run();
      await tablet.reload();
      await waitGate(tablet, 'setup');
      await tablet.locator('[data-companion="lost"]').waitFor();
      ok((await texts(tablet)).includes('جهازك الآخر'), 'the setup screen says the route was recorded by the other device');
      await layoutOk(tablet, 'companion lost'); await shot(tablet, 'gate-companion-lost');
      await tablet.context().close();
    } finally { await app.stop(); app = mainApp; }
  }


  // ---- 10. Every published release is mandatory (the owner's rule, taken from GSCO on 2026-10-31): an older app is held at the update
  // screen for every role while the update can proceed. No «continue» or «later»; the workspace stays mounted under the screen, the
  // device's queue keeps being sent, and offline or with the APK not answering nobody is held (GSCO's fail-open).
  {
    const held = page => page.locator('main.tracking-gate[data-gate-update="required"]');
    const panel = page => held(page).locator('.app-update-banner');
    const noWayAround = async (page, label) => {
      const labels = await held(page).locator('button, a').evaluateAll(items => items.map(item => item.innerText.trim()).filter(Boolean));
      check(labels.filter(text => /متابعة|لاحق|تخطي|إغلاق|continue|later|skip|close|dismiss|not now/i.test(text)), [], label + ': no way around the update: ' + labels.join(' | '));
      const sizes = await held(page).locator('.app-update-actions .btn:visible, .tracking-gate-saved .btn:visible').evaluateAll(items => items.map(item => Math.round(item.getBoundingClientRect().height)));
      ok(sizes.length && sizes.every(height => height >= 44), label + ': the update actions are touch targets of 44 px at least: ' + sizes.join(','));
    };
    // What the phone shows first, then the whole screen (a 360 px window tall enough for all of it).
    const shotCard = async (page, label) => { await shot(page, label); const size = page.viewportSize(); await page.setViewportSize({width: size.width, height: 1800}); await pause(150); await shot(page, label + '-full'); await page.setViewportSize(size); };
    // The workspace's own element, marked before the screen holds the app: still the same node afterwards, so nothing was remounted.
    const mark = page => page.evaluate(() => { document.querySelector('.workspace').dataset.qaMark = 'kept'; });
    const marked = page => page.evaluate(() => document.querySelector('.workspace')?.dataset.qaMark === 'kept');
    /** Ask the app to read the release again until the screen is (or is not) shown: a check already in flight answers the first ask. */
    const settleHeld = async (page, wanted, label) => { for (let n = 0; n < 60; n++) { await recheck(page); await pause(250); if ((await held(page).count() > 0) === wanted) { checks++; return; } } throw Error(label + ': the update screen did not ' + (wanted ? 'appear' : 'go')); };
    const workspaceKept = async (page, label) => check([await page.locator('.workspace').count(), await page.locator('.workspace').isVisible(), await page.locator('.gate-workspace').getAttribute('aria-hidden')], [1, false, 'true'], label + ': the workspace is mounted, hidden and out of reach');
    const recheck = page => page.evaluate(() => window.dispatchEvent(new CustomEvent('yourrest:native-ready')));

    // a. The administrator in an app with the update protocol, one build behind (1.0.11, code 12): held, in Arabic and English.
    const admin = await open('owner', {native: {appVersion: '1.0.11', versionCode: SERVED.versionCode - 1}, update: {code: SERVED.versionCode - 1, name: '1.0.11'}});
    await held(admin).waitFor();
    await workspaceKept(admin, 'administrator');
    let text = await texts(admin);
    ok(text.includes('حدّث تطبيق يورست للمتابعة') && text.includes('الإصدار المثبت على هاتفك 1.0.11 أقدم من الإصدار المطلوب ' + SERVED.versionName) && text.includes('إلزامي لجميع المستخدمين'), 'the screen names both versions and says the update is required of everyone: ' + text);
    ok(SERVED.releaseNotes.ar.every(note => text.includes(note)), 'the release notes of the required version are listed');
    ok(text.includes('QA admin') && await admin.getByRole('button', {name: 'تسجيل الخروج'}).isVisible(), 'the account and its sign-out stay reachable');
    await panel(admin).getByRole('button', {name: 'تحديث التطبيق', exact: true}).waitFor();
    await noWayAround(admin, 'Arabic'); await layoutOk(admin, 'update screen'); await shotCard(admin, 'update-required-app-ar');
    await admin.keyboard.press('Escape'); await pause(300);
    check(await held(admin).count(), 1, 'Escape does not leave the screen');
    await held(admin).locator('.language-switch').click();
    await held(admin).locator('h1', {hasText: 'Update the Yourrest app to continue'}).waitFor();
    text = await texts(admin);
    ok(text.includes('The installed version 1.0.11 is older than the required version ' + SERVED.versionName) && text.includes('required for every user') && SERVED.releaseNotes.en.every(note => text.includes(note)), 'English wording and notes');
    check(text.replace(/«[^»]*»/g, '').replace('QA admin', '').replace('العربية', '').match(/[\u0600-\u06ff]+/g), null, 'no Arabic left in the English screen but the switch back to Arabic');
    await noWayAround(admin, 'English'); await layoutOk(admin, 'update screen, English'); await shotCard(admin, 'update-required-app-en');
    await held(admin).locator('.language-switch').click();
    await held(admin).locator('h1', {hasText: 'حدّث تطبيق يورست للمتابعة'}).waitFor();

    // The download fails (the network drops mid-file, the phone is full): still held, with a retry and the browser path.
    await admin.evaluate(() => { window.__updateMock.failDownload = true; });
    await panel(admin).getByRole('button', {name: 'تحديث التطبيق', exact: true}).click();
    await held(admin).locator('.app-update-banner[data-update-phase="error"]').waitFor();
    check(await held(admin).count(), 1, 'a failed download keeps the screen');
    ok((await panel(admin).innerText()).includes('لم يكتمل التحديث') && await panel(admin).getByRole('button', {name: 'إعادة المحاولة'}).isVisible(), 'the failure is explained, with a retry');
    check(await panel(admin).getByRole('link', {name: 'ثبّت عن طريق المتصفح'}).getAttribute('href'), new URL(SERVED.apkUrl).pathname, 'and the browser path to the same APK');
    await noWayAround(admin, 'download failed'); await layoutOk(admin, 'download failed'); await shotCard(admin, 'update-download-failed-ar');
    await admin.evaluate(() => { window.__updateMock.failDownload = false; });
    await panel(admin).getByRole('button', {name: 'إعادة المحاولة'}).click();
    await panel(admin).getByRole('button', {name: 'تحديث التطبيق', exact: true}).click();
    await panel(admin).getByRole('button', {name: 'تثبيت التحديث'}).waitFor();
    check((await admin.evaluate(() => window.__updateMock.calls)).filter(method => method === 'downloadAppUpdate').length, 2, 'the retry downloads again');
    await panel(admin).getByRole('button', {name: 'تثبيت التحديث'}).click();
    await held(admin).locator('.app-update-banner[data-update-phase="installing"]').waitFor();
    check(await held(admin).count(), 1, 'the installer opening is not the update: still held');
    // Android installed it: the app now reports the published code, and the workspace comes back as it was.
    await admin.evaluate(([code, name]) => window.__updateMock.set({phase: 'upToDate', installedVersionCode: code, installedVersionName: name}), [SERVED.versionCode, SERVED.versionName]);
    await nativeControl(admin).set({appVersion: SERVED.versionName});
    await waitWorkspace(admin);
    check(await admin.locator('.gate-workspace').getAttribute('aria-hidden'), null, 'the same version as the published one is not held');
    await admin.context().close();

    // b. Offline, or with the APK not answering on the site, the update cannot proceed: nobody is held; the workspace says why the update
    // waits. Back online with the file answering, the screen returns; what was typed in the workspace is still there.
    const away = await open('owner', {native: {appVersion: '1.0.11', versionCode: SERVED.versionCode - 1}, update: {code: SERVED.versionCode - 1, name: '1.0.11'}});
    await held(away).waitFor();
    await mark(away);
    await away.context().setOffline(true);
    await waitWorkspace(away);
    await away.locator('.workspace-notices .app-update-banner', {hasText: 'هذا التحديث إلزامي، ويمكن تنزيله عند عودة الاتصال بالإنترنت'}).waitFor();
    check(await marked(away), true, 'offline: the same workspace, never remounted');
    await layoutOk(away, 'offline'); await shot(away, 'update-offline-not-held-ar');
    await away.context().setOffline(false);
    await held(away).waitFor();
    await workspaceKept(away, 'back online');
    const apk = '**/downloads/yourrest-crm-android-v*.apk', missingApk = route => route.fulfill({status: 404, body: ''});
    await away.route(apk, missingApk);
    await settleHeld(away, false, 'APK not answering');
    await waitWorkspace(away);
    check(await marked(away), true, 'the workspace under the screen is the same one, with what it held');
    await away.locator('.workspace-notices .app-update-banner', {hasText: 'ملف التحديث غير متاح على الموقع الآن'}).waitFor();
    await shot(away, 'update-apk-unreachable-not-held-ar');
    await away.unroute(apk, missingApk);
    const noRelease = route => route.abort();
    await away.route('**/api/app-update', noRelease);
    await settleHeld(away, false, 'release not readable');
    check(await held(away).count(), 0, 'the release that cannot be read holds nobody');
    await away.unroute('**/api/app-update', noRelease);
    await settleHeld(away, true, 'release readable again');

    // c. A form open when the requirement is found: the screen waits for it to be saved or closed (here the account sheet of the phone layout).
    await away.route(apk, missingApk);
    await settleHeld(away, false, 'before the dialog'); await waitWorkspace(away);
    await away.locator('.mobile-profile-trigger').click();
    await away.locator('[role="dialog"][data-state="open"]').waitFor();
    await away.unroute(apk, missingApk);
    for (let n = 0; n < 8; n++) { await recheck(away); await pause(250); }
    check(await away.evaluate(() => window.__updateMock.state.phase), 'available', 'the release was read again meanwhile');
    check([await held(away).count(), await away.locator('[role="dialog"][data-state="open"]').isVisible()], [0, true], 'an open dialog is never taken from under the person');
    await away.locator('[role="dialog"][data-state="open"]').getByRole('button', {name: 'إغلاق'}).click();
    await held(away).waitFor();
    check(await away.locator('[role="dialog"][data-state="open"]').count(), 0, 'once it is closed, the update screen holds the app');
    // A dialog opened under the screen afterwards (as a notification's request would) does not lift it, and the screen stays tappable.
    await away.evaluate(() => document.querySelector('.mobile-profile-trigger').click());
    await away.locator('[role="dialog"][data-state="open"]').waitFor({state: 'attached'});
    await pause(500);
    check(await held(away).count(), 1, 'a dialog opened under the screen does not lift it');
    await held(away).locator('.language-switch').click();
    await held(away).locator('h1', {hasText: 'Update the Yourrest app to continue'}).waitFor();
    await held(away).locator('.language-switch').click();
    await held(away).locator('h1', {hasText: 'حدّث تطبيق يورست للمتابعة'}).waitFor();
    checks++;
    await away.context().close();

    // d. The device's queue: an entry saved offline is still sent while the screen holds the app, and the screen counts it until then.
    const bundle = (await build({stdin: {contents: "export * from './lib/offline-store';export * from './lib/offline-submit';", resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, format: 'iife', globalName: 'offlineQa', platform: 'browser', write: false})).outputFiles[0].text;
    const queued = await open('owner', {native: {appVersion: '1.0.11', versionCode: SERVED.versionCode - 1}, update: {code: SERVED.versionCode - 1, name: '1.0.11'}});
    await held(queued).waitFor();
    await queued.addScriptTag({content: bundle});
    await queued.waitForFunction(async () => !!(await window.offlineQa.loadOfflineSnapshot()));
    const createKey = crypto.randomUUID(), customerName = 'مصنع محفوظ على الهاتف ' + createKey.slice(0, 6);
    await queued.context().setOffline(true);
    await waitWorkspace(queued);
    const saved = await queued.evaluate(async ({createKey, customerName}) => {
      const me = (await window.offlineQa.loadOfflineSnapshot()).me;
      return window.offlineQa.offlineSubmit('/api/crm', JSON.stringify({action: 'save', kind: 'customer', createKey, data: {name: customerName, phone: '0555000123', region: 'الغربية', branch: 'الرئيسي', assignedTo: me.id}}), {me, label: customerName});
    }, {createKey, customerName});
    check(saved.queued, true, 'the customer is saved on the phone while offline');
    // The server does not answer at first: the entry waits under the screen, which counts it.
    const crmRoute = url => url.pathname === '/api/crm', refusePost = (route, request) => request.method() === 'POST' ? route.abort() : route.fallback();
    await queued.route(crmRoute, refusePost);
    await queued.context().setOffline(false);
    await held(queued).waitFor();
    const waiting = held(queued).locator('.tracking-gate-saved[data-saved-waiting="1"]');
    await waiting.waitFor();
    ok((await waiting.innerText()).includes('إدخالات محفوظة على الهاتف بانتظار الرفع: 1'), 'the screen says one entry waits on the phone and is kept');
    await layoutOk(queued, 'saved entries'); await shotCard(queued, 'update-required-queue-waiting-ar');
    check(await app.db.prepare('SELECT COUNT(*) n FROM crm_records WHERE id=?').bind('crm-owner-' + createKey).first('n'), 0, 'not on the server yet');
    await queued.unroute(crmRoute, refusePost);
    await waiting.getByRole('button', {name: 'رفع الآن'}).click();
    await held(queued).locator('.tracking-gate-saved').waitFor({state: 'detached'});
    check(await app.db.prepare('SELECT COUNT(*) n FROM crm_records WHERE id=?').bind('crm-owner-' + createKey).first('n'), 1, 'the entry reached the server while the update screen held the app');
    check(JSON.parse(await app.db.prepare('SELECT data FROM crm_records WHERE id=?').bind('crm-owner-' + createKey).first('data')).name, customerName, 'with what was saved on the phone');
    check(await queued.evaluate(async () => (await window.offlineQa.listOutbox((await window.offlineQa.loadOfflineSnapshot()).me)).length), 0, 'the phone\'s queue is empty');
    check(await held(queued).count(), 1, 'and the screen still holds the app');
    // A second entry is sent by the workspace's own sending (every 30 s and on reconnecting), with no tap.
    const secondKey = crypto.randomUUID();
    await queued.context().setOffline(true); await waitWorkspace(queued);
    await queued.evaluate(async key => { const me = (await window.offlineQa.loadOfflineSnapshot()).me; return window.offlineQa.offlineSubmit('/api/crm', JSON.stringify({action: 'save', kind: 'customer', createKey: key, data: {name: 'مصنع ثان ' + key.slice(0, 6), phone: '0555000124', region: 'الغربية', branch: 'الرئيسي', assignedTo: me.id}}), {me, label: 'second'}); }, secondKey);
    await queued.context().setOffline(false);
    await held(queued).waitFor();
    for (let n = 0; n < 150 && !await app.db.prepare('SELECT COUNT(*) n FROM crm_records WHERE id=?').bind('crm-owner-' + secondKey).first('n'); n++) await pause(200);
    check(await app.db.prepare('SELECT COUNT(*) n FROM crm_records WHERE id=?').bind('crm-owner-' + secondKey).first('n'), 1, 'sent by itself while the screen holds the app');
    await queued.context().close();

    // e. Every role: customer service (no route tracking at all) and a representative (before any tracking check), in an app without the
    // update protocol that reports only its version name.
    const service = await open('cs', {native: {appVersion: '1.0.11', versionCode: SERVED.versionCode - 1}});
    await held(service).waitFor();
    ok((await texts(service)).includes('QA customer service'), 'customer service in an older app is held as well');
    check(await panel(service).getByRole('link', {name: 'تحديث التطبيق'}).getAttribute('href'), SERVED.apkUrl, 'an app without the update protocol gets the served APK');
    await workspaceKept(service, 'customer service'); await noWayAround(service, 'customer service');
    await service.context().close();
    const representative = await open('rep12', {native: {memberId: 'rep12', regionScope: 'western', appVersion: '1.0.11', versionCode: SERVED.versionCode - 1}});
    await held(representative).waitFor();
    check(await representative.locator('.tracking-gate-list').count(), 0, 'a representative is asked to update before any tracking step');
    await representative.context().close();

    // f. Unaffected: the same version, a newer one, an ordinary browser on a computer and on a phone.
    for (const [label, options] of [['the same version', {native: {appVersion: SERVED.versionName}, update: {code: SERVED.versionCode, name: SERVED.versionName}}], ['a newer version', {native: {appVersion: '9.0.0', versionCode: SERVED.versionCode + 1}, update: {code: SERVED.versionCode + 1, name: '9.0.0'}}]]) {
      const page = await open('owner', options);
      await waitWorkspace(page);
      await page.waitForFunction(() => window.__updateMock?.calls.includes('checkAppUpdate'));
      await pause(800);
      check([await gateOf(page).count(), await page.locator('.app-update-banner').count()], [0, 0], label + ': not held and no update panel');
      await page.context().close();
    }
    const desktop = await open('owner', {viewport: DESKTOP});
    await waitWorkspace(desktop); await pause(800);
    check([await gateOf(desktop).count(), await desktop.locator('.app-update-banner').count()], [0, 0], 'a computer browser is never held');
    await layoutOk(desktop, 'computer browser'); await shot(desktop, 'update-browser-desktop-unaffected');
    await desktop.context().close();
    const phoneBrowser = await open('mgr', {userAgent: ANDROID_CHROME});
    await waitWorkspace(phoneBrowser); await pause(800);
    check([await gateOf(phoneBrowser).count(), await phoneBrowser.locator('.app-update-banner').count()], [0, 0], 'a phone browser is never held');
    await shot(phoneBrowser, 'update-phone-browser-unaffected');
    await phoneBrowser.context().close();
  }

  ok(!errors.length, 'no uncaught page errors: ' + errors.join(' | '));
  console.log(JSON.stringify({ok: true, checks, screenshots, realChromium: true, androidAppEmulated: true, physicalDevice: false, productionDataUsed: false}));
} finally {
  await browser?.close(); await app?.stop();
}
