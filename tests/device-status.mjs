// Phone status report: schema, sanitising, change detection and the retry/heartbeat state machine,
// driven by a fake clock and fake transport. The server route and database are tested in
// tests/device-status-http.mjs against the built release.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
const compiler = {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true};
const nodeRequire = createRequire(import.meta.url);
function load(file, require) { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: compiler}).outputText, {exports, require, console, Date, Intl, setTimeout, clearTimeout, fetch: globalThis.fetch, AbortController}); return exports; }
const text = load('lib/tracker-text.ts', () => ({}));
const native = load('lib/native-tracking.ts', () => ({}));
const gate = load('lib/tracking-gate.ts', name => name === './native-tracking' ? native : {});
const status = load('lib/device-status.ts', name => name === 'zod' ? nodeRequire('zod') : name === './tracker-text' ? text : {});
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

const ready = {tracking: true, permission: 'granted', pendingCount: 0, pendingGapCount: 0, lastFixAt: '2026-10-12T08:00:00.000Z', accuracy: 8, error: null, syncError: null, memberId: 'rep-1', regionScope: 'all', enrolledRole: 'rep', stopId: null,
  workHoursSupported: true, fridayExclusionSupported: true, trackingWindowActive: true, nextTrackingWindowAt: '', continuousSupported: true, enrolled: true, backgroundPermission: 'granted', appVersion: '1.0.10',
  fineLocationPermission: 'granted', notificationPermission: 'granted', locationServicesEnabled: true, continuousConsent: true, quarantinedCount: 2};
const source = (patch = {}) => ({native: true, loading: false, failed: false, upgradeRequired: false, device: gate.gateDeviceFrom(native.normalizeNativeState({...ready, ...patch}), 'rep-1')});
const rep = {role: 'rep', active: 1};
const build = (patch = {}, sourcePatch = {}) => { const s = {...source(patch), ...sourcePatch}; return status.buildDeviceReport(gate.trackingGateDecision({...rep, ...s}), s, 'desktop'); };

// ---- report content
const healthy = build();
eq(healthy.platform, 'android-app', 'native app platform');
eq(healthy.deviceClass, 'android', 'native app is an Android device');
eq(healthy.gate, 'ok', 'healthy gate');
eq(healthy.missing, [], 'nothing missing');
eq([healthy.tracking, healthy.windowActive, healthy.enrolled, healthy.consent], [true, true, true, true], 'collector facts');
eq([healthy.foreground, healthy.fineLocation, healthy.notifications, healthy.background, healthy.locationServices], ['granted', 'granted', 'granted', 'granted', true], 'permissions');
eq([healthy.lastFixAt, healthy.accuracy, healthy.pendingCount, healthy.pendingGapCount, healthy.quarantinedCount], ['2026-10-12T08:00:00.000Z', 8, 0, 0, 2], 'fix and queue facts');
eq(healthy.appVersion, '1.0.10', 'version');
ok(status.deviceReportSchema.safeParse(healthy).success, 'a built report always passes the server schema');

const blocked = build({backgroundPermission: 'denied', fineLocationPermission: 'denied', permission: 'denied'});
eq([blocked.gate, blocked.missing], ['permission', ['fine_location', 'background_location']], 'blocked report names what is missing');
ok(status.deviceReportSchema.safeParse(blocked).success, 'blocked report passes the schema');
eq(build({error: 'بانتظار موقع حديث', syncError: 'لا يوجد اتصال بالخادم'}).error, 'بانتظار موقع حديث', 'errors travel with the report');
eq(status.buildDeviceReport(gate.trackingGateDecision({...rep, ...source(), device: null}), {...source(), device: null}, 'desktop'), null, 'Checking is never reported');

const browserSource = {native: false, loading: false, failed: false, upgradeRequired: false, device: null};
const browser = status.buildDeviceReport(gate.trackingGateDecision({...rep, ...browserSource}), browserSource, 'iphone');
eq([browser.platform, browser.deviceClass, browser.gate, browser.appVersion, browser.tracking, browser.enrolled, browser.consent], ['browser', 'iphone', 'browser', '', false, false, null], 'browser report');
ok(status.deviceReportSchema.safeParse(browser).success, 'browser report passes the schema');
eq(status.buildDeviceReport(gate.trackingGateDecision({...rep, ...source(), device: null, failed: true}), {...source(), device: null, failed: true}, 'desktop').gate, 'bridge', 'bridge failure is reported');
eq(status.buildDeviceReport(gate.trackingGateDecision({...rep, ...source({memberId: 'someone-else'})}), source({memberId: 'someone-else'}), 'desktop').enrolled, false, 'Enrolled for another account is not enrolment');

// ---- schema strictness
const parse = patch => status.deviceReportSchema.safeParse({...healthy, ...patch}).success;
ok(parse({}), 'baseline');
ok(!parse({platform: 'ios'}), 'unknown platform');
ok(!parse({gate: 'maybe'}), 'unknown gate');
ok(!parse({missing: ['camera']}), 'unknown requirement');
ok(!parse({missing: Array(9).fill('consent')}), 'too many requirements');
ok(!parse({appVersion: '1.0.10 <script>'}), 'version must be plain');
ok(!parse({appVersion: 'x'.repeat(33)}), 'version length');
ok(!parse({pendingCount: -1}), 'negative count');
ok(!parse({pendingCount: 1.5}), 'fractional count');
ok(!parse({pendingCount: 10_000_001}), 'absurd count');
ok(!parse({accuracy: -1}), 'negative accuracy');
ok(!parse({accuracy: Infinity}), 'infinite accuracy');
ok(!parse({lastFixAt: 'yesterday'}), 'bad time');
ok(parse({lastFixAt: ''}), 'empty time is allowed');
ok(!parse({error: 'x'.repeat(401)}), 'error length');
ok(!parse({foreground: 'maybe'}), 'permission value');
ok(!status.deviceReportSchema.safeParse({...healthy, memberId: 'other'}).success, 'unknown keys (such as a member id) are rejected');
ok(!status.deviceReportSchema.safeParse({platform: 'browser'}).success, 'missing keys are rejected');

// ---- text hygiene
eq(status.cleanStatusText('see https://evil.example/x?token=abc now'), 'see [link] now', 'links are removed');
ok(!status.cleanStatusText('Authorization: Bearer abc.def.ghi').includes('abc.def.ghi') && status.cleanStatusText('Authorization: Bearer abc.def.ghi').includes('[redacted]'), 'credentials are redacted');
ok(!status.cleanStatusText('password=hunter2 and cookie: sessionid').includes('hunter2'), 'passwords are redacted');
eq(status.cleanStatusText('line one\nline two'), 'line one', 'only the first line');
eq(status.cleanStatusText('ok‮gnirts\u0000\u0007'), 'okgnirts', 'bidi override and control characters are removed');
eq(status.cleanStatusText('x'.repeat(500)).length, 240, 'length is capped');
eq(status.cleanStatusText(undefined), '', 'undefined is empty');
eq(status.cleanStatusText({message: 'obj'}), 'obj', 'error objects use their message');

// ---- device class
eq(status.detectDeviceClass('Mozilla/5.0 (Linux; Android 14; SM-S911B) Chrome/126'), 'android', 'android browser');
eq(status.detectDeviceClass('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)'), 'iphone', 'iphone');
eq(status.detectDeviceClass('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5), 'iphone', 'iPad desktop mode');
eq(status.detectDeviceClass('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'desktop', 'windows');
eq(status.detectDeviceClass('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0), 'desktop', 'mac');
eq(status.detectDeviceClass(''), 'other', 'unknown');

// ---- signature: volatile fields do not trigger a report, meaningful ones do
const sig = status.reportSignature;
eq(sig(build({lastFixAt: '2026-10-12T08:05:00.000Z', accuracy: 30})), sig(healthy), 'fix time and accuracy are volatile');
eq(sig(build({pendingCount: 17})) === sig(healthy), false, 'a queue appearing is meaningful');
eq(sig(build({pendingCount: 17})), sig(build({pendingCount: 400})), 'queue size alone is not');
for (const patch of [{tracking: false}, {trackingWindowActive: false}, {enrolled: false}, {backgroundPermission: 'denied'}, {fineLocationPermission: 'denied', permission: 'denied'}, {notificationPermission: 'denied', permission: 'denied'}, {locationServicesEnabled: false}, {continuousConsent: false}, {appVersion: '1.0.11'}, {error: 'x'}, {syncError: 'y'}])
  eq(sig(build(patch)) === sig(healthy), false, 'meaningful change: ' + JSON.stringify(patch));

// ---- reporter state machine on a fake clock
let clock = 1_000_000, timers = [], sends = [], plan = [], blockOn = null, timerId = 0;
const options = (extra = {}) => ({now: () => clock, setTimer: (callback, delay) => { const t = {id: ++timerId, at: clock + delay, callback}; timers.push(t); return t.id; }, clearTimer: id => { timers = timers.filter(t => t.id !== id); },
  send: report => { sends.push({at: clock, report}); if (blockOn) return new Promise(resolve => { blockOn.resolve = resolve; }); return Promise.resolve(plan.shift() || 'ok'); }, ...extra});
const settle = () => new Promise(resolve => setImmediate(resolve));
async function advance(ms) {
  const end = clock + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    const next = timers[0];
    if (!next || next.at > end) break;
    timers.shift(); clock = Math.max(clock, next.at); next.callback(); await settle();
  }
  clock = end; await settle();
}
const reset = () => { clock = 1_000_000; timers = []; sends = []; plan = []; blockOn = null; };
const A = healthy, B = build({backgroundPermission: 'denied'}), C = build({locationServicesEnabled: false});

reset(); let reporter = status.createDeviceReporter(options());
reporter.submit(A); await advance(0);
eq(sends.length, 1, 'the first report goes out at once');
reporter.submit({...A, lastFixAt: '2026-10-12T08:01:00.000Z'}); await advance(10 * 60_000);
eq(sends.length, 1, 'volatile changes alone do not resend before the heartbeat');
await advance(5 * 60_000 + 1);
eq(sends.length, 2, 'the heartbeat resends an unchanged phone after 15 minutes');
eq(sends[1].report.lastFixAt, '2026-10-12T08:01:00.000Z', 'the heartbeat carries the freshest volatile fields');
reporter.dispose();

reset(); reporter = status.createDeviceReporter(options());
reporter.submit(A); await advance(0);
await advance(20_000); reporter.submit(B); await advance(1000);
eq(sends.length, 1, 'a change within a minute of the last report waits');
reporter.submit(C); await advance(38_000);
eq(sends.length, 1, 'still waiting');
await advance(2_000);
eq(sends.length, 2, 'it is sent one minute after the previous report');
eq(sends[1].report.gate, 'location_services', 'rapid changes coalesce into the latest state');
eq(sends[1].at - sends[0].at, 60_000, 'reports are at least a minute apart');
reporter.dispose();

reset(); blockOn = {}; reporter = status.createDeviceReporter(options());
reporter.submit(A); await advance(0);
reporter.submit(B); await advance(120_000);
eq(sends.length, 1, 'nothing is sent while a report is in flight');
const release = blockOn.resolve; blockOn = null; release('ok'); await settle();
await advance(0);
eq(sends.length, 1, 'the spacing is counted from the moment the server acknowledged the report');
await advance(60_000);
eq(sends.length, 2, 'the state that changed meanwhile is sent one minute after that');
eq(sends[1].report.gate, 'permission', 'and it is the newest');
reporter.dispose();

reset(); plan = ['throttled', 'ok']; reporter = status.createDeviceReporter(options());
reporter.submit(A); await advance(0);
eq(sends.length, 1, 'sent');
await advance(59_000); eq(sends.length, 1, 'throttled reports retry after a minute');
await advance(2_000); eq(sends.length, 2, 'retried');
await advance(3_600_000); eq(sends.length > 2, true, 'then it continues with heartbeats');
reporter.dispose();

reset(); plan = ['failed', 'failed', 'failed', 'ok']; reporter = status.createDeviceReporter(options());
reporter.submit(A); await advance(0);
eq(sends.length, 1, 'first attempt');
await advance(61_000); eq(sends.length, 2, 'first retry after one minute');
await advance(118_000); eq(sends.length, 2, 'back-off doubles');
await advance(2_000); eq(sends.length, 3, 'second retry after two minutes');
await advance(238_000); eq(sends.length, 3, 'back-off doubles again');
await advance(2_000); eq(sends.length, 4, 'third retry after four minutes, which succeeds');
await advance(10 * 60_000); eq(sends.length, 4, 'success resets to the heartbeat cadence');
reporter.dispose();

reset(); plan = Array(12).fill('failed'); reporter = status.createDeviceReporter(options());
reporter.submit(A); await advance(0);
await advance(3 * 3_600_000);
const gaps = sends.slice(1).map((s, i) => s.at - sends[i].at);
eq(Math.max(...gaps) <= 15 * 60_000, true, 'back-off is capped at fifteen minutes');
reporter.dispose();

reset(); plan = ['failed', 'ok']; reporter = status.createDeviceReporter(options());
reporter.submit(A); await advance(0);
reporter.nudge(); await advance(0); eq(sends.length, 1, 'a plain nudge does not bypass the back-off');
reporter.nudge(true); await advance(0); eq(sends.length, 2, 'a forced nudge (network is back) retries now');
reporter.dispose();

reset(); plan = ['rejected']; reporter = status.createDeviceReporter(options());
reporter.submit(A); await advance(0);
await advance(3_600_000); eq(sends.length, 1, 'a rejected report is not repeated');
reporter.submit(B); await advance(0); eq(sends.length, 2, 'a changed state is tried again');
reporter.dispose();

reset(); reporter = status.createDeviceReporter(options());
reporter.submit(A); reporter.dispose(); await advance(3_600_000);
eq(sends.length <= 1, true, 'a disposed reporter sends nothing more');
reset(); blockOn = {}; reporter = status.createDeviceReporter(options());
reporter.submit(A); await advance(0); reporter.dispose(); const late = blockOn.resolve; blockOn = null; late('ok'); await advance(3_600_000);
eq(sends.length, 1, 'a result arriving after disposal is ignored');

console.log(JSON.stringify({ok: true, checks}));
