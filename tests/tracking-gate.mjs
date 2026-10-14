// The mandatory-tracking decision for representatives, run on the real native-state normalizer and the real
// gate module. It decides from facts the Android app reports; no device, GPS or browser is involved here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compiler = {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true};
function load(file, require) { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: compiler}).outputText, {exports, require, console, Date, Intl}); return exports; }
const native = load('lib/native-tracking.ts', () => ({}));
const update = load('lib/app-update.ts', name => name === './native-tracking' ? native : {});
const gate = load('lib/tracking-gate.ts', name => name === './native-tracking' ? native : name === './app-update' ? update : {});
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message); checks++; };

// A phone that is fully set up, as the Android app reports it (JSON null = field absent from the app).
const ready = {tracking: true, permission: 'granted', pendingCount: 0, pendingGapCount: 0, lastFixAt: '2026-10-12T08:00:00.000Z', accuracy: 8, error: null, syncError: null, memberId: 'rep-1', regionScope: 'all', enrolledRole: 'rep', stopId: null,
  workHoursSupported: true, fridayExclusionSupported: true, trackingWindowActive: true, nextTrackingWindowAt: '2026-10-13T03:00:00.000Z', continuousSupported: true, enrolled: true, backgroundPermission: 'granted', appVersion: '1.0.10',
  fineLocationPermission: 'granted', notificationPermission: 'granted', locationServicesEnabled: true, continuousConsent: true, mapsLaunchSupported: true, foregroundDirectionsSupported: true, immutableBindingSupported: true, accountRecoverySupported: true, directionsSupported: true};
const device = (patch = {}, memberId = 'rep-1') => gate.gateDeviceFrom(native.normalizeNativeState({...ready, ...patch}), memberId);
const rep = {role: 'rep', active: 1};
const source = (patch = {}) => ({native: true, loading: false, failed: false, upgradeRequired: false, device: device(), ...patch});
const decide = (input = {}) => gate.trackingGateDecision({...rep, ...source(), requiredVersion: '1.0.10', ...input});
const blocked = (reason, missing = []) => ({status: 'blocked', reason, missing});

// Only an active representative is gated; everyone else, and an unknown member, passes through untouched.
for (const role of ['admin', 'manager', 'supervisor', 'customer_service', 'customer_service_manager', undefined]) {
  eq(decide({role, native: false, device: null}), {status: 'allowed'}, 'Other roles are never gated: ' + role);
  eq(decide({role, device: device({continuousConsent: false, enrolled: false, backgroundPermission: 'denied'})}), {status: 'allowed'}, 'Other roles are not gated even on a broken phone: ' + role);
}
eq(decide({active: 0, native: false, device: null}), {status: 'allowed'}, 'A deactivated representative sees the account error, not a tracking screen');
eq(decide({role: undefined, active: undefined, native: false, device: null}), {status: 'allowed'}, 'While the CRM is still loading the member, nothing is blocked');

// Browser, iPhone, PWA: no native collector exists.
eq(decide({native: false, device: null}), blocked('browser'), 'A representative in a browser is blocked');
eq(decide({native: false, loading: true, device: null}), blocked('browser'), 'The browser block does not wait for loading');

// The Android bridge has not answered yet, then fails or times out.
eq(decide({device: null}), {status: 'checking'}, 'No answer yet is checking, not a block');
eq(decide({device: null, loading: true}), {status: 'checking'}, 'Loading is checking');
eq(decide({device: null, failed: true}), blocked('bridge'), 'A failed bridge read is a block');
eq(decide({device: null, checkingExpired: true}), blocked('bridge'), 'A bridge that never answers is a block after the timeout');
eq(decide({loading: true}), {status: 'allowed'}, 'A known healthy phone is allowed even while the journey list loads');

// Old or incomplete app.
eq(decide({upgradeRequired: true}), blocked('upgrade'), 'The app asked for an upgrade');
eq(decide({device: device({appVersion: '1.0.6'})}), blocked('upgrade'), 'Version 1.0.6 has no work-hours schedule');
eq(decide({device: device({appVersion: '1.0.7'}), requiredVersion: '1.0.7'}), {status: 'allowed'}, 'Version 1.0.7 is the first supported, when it is the served one');
eq(decide({device: device({continuousSupported: false})}), blocked('upgrade'), 'No continuous support');
eq(decide({device: device({workHoursSupported: false})}), blocked('upgrade'), 'No work-hours support');
eq(decide({device: device({fridayExclusionSupported: false})}), blocked('upgrade'), 'No Friday exclusion');
eq(decide({device: device({pendingGapCount: null})}), blocked('upgrade'), 'Unknown gap queue');

// The served version is mandatory for everyone who opens the app; the comparison never judges an unknown version.
eq(decide({device: device({appVersion: '1.0.7'})}), blocked('upgrade'), 'An app older than the served version is blocked for a representative');
eq(decide({device: device({appVersion: '1.0.9'})}), blocked('upgrade'), 'however close to it');
for (const role of ['admin', 'manager', 'supervisor']) {
  eq(decide({role, device: device({appVersion: '1.0.7'})}), blocked('upgrade'), role + ' in an outdated app is blocked as well');
  eq(decide({role, device: device({appVersion: '1.0.10', continuousConsent: false, enrolled: false})}), {status: 'allowed'}, role + ' in the served version passes whatever the tracking state');
  eq(decide({role, native: false, device: null}), {status: 'allowed'}, role + ' in a browser is not gated');
}
eq(decide({role: 'manager', active: 0, device: device({appVersion: '1.0.7'})}), {status: 'allowed'}, 'A deactivated account sees the account error, not the update screen');
eq(decide({device: device({appVersion: '1.0.11'})}), {status: 'allowed'}, 'A newer app than the served one is not asked to downgrade');
eq(decide({device: device({appVersion: ''})}), blocked('upgrade'), 'An app that reports no version is judged on its capabilities only, and an app that old lacks the work-hours schedule');
eq(decide({role: 'manager', device: device({appVersion: ''})}), {status: 'allowed'}, 'For another role an unknown version is not judged at all');
eq(decide({device: device({appVersion: '1.0.7'}), requiredVersion: undefined}), {status: 'allowed'}, 'Without a served version nothing is judged');
eq(decide({device: device({appVersion: '1.0.7'}), requiredVersion: 'later'}), {status: 'allowed'}, 'A malformed served version judges nothing');
eq(decide({device: device({appVersion: '1.0.7', backgroundPermission: 'denied'})}), blocked('upgrade'), 'The outdated app is reported before any permission problem');
eq([gate.appOutdated('1.0.7', '1.0.10'), gate.appOutdated('1.0.10', '1.0.10'), gate.appOutdated('1.0.11', '1.0.10'), gate.appOutdated('', '1.0.10'), gate.appOutdated('1.0.7', undefined)], [true, false, false, false, false], 'appOutdated');

// First activation: consent not given, nothing enrolled or granted.
const fresh = {continuousConsent: false, enrolled: false, memberId: null, enrolledRole: null, tracking: false, permission: 'denied', fineLocationPermission: 'denied', notificationPermission: 'denied', backgroundPermission: 'prompt'};
eq(decide({device: device(fresh)}), blocked('setup', ['consent', 'fine_location', 'notifications', 'background_location', 'enrollment']), 'A fresh install lists everything that is needed');
eq(decide({device: device({...fresh, notificationPermission: 'granted'})}), blocked('setup', ['consent', 'fine_location', 'background_location', 'enrollment']), 'Older Android without notification permission');

// Consent given, then something was refused or revoked.
eq(decide({device: device({backgroundPermission: 'denied'})}), blocked('permission', ['background_location']), 'Only while using the app is not enough');
eq(decide({device: device({backgroundPermission: 'prompt'})}), blocked('permission', ['background_location']), 'Background permission never granted');
eq(decide({device: device({fineLocationPermission: 'denied', permission: 'denied'})}), blocked('permission', ['fine_location']), 'Approximate location only');
eq(decide({device: device({notificationPermission: 'denied', permission: 'denied'})}), blocked('permission', ['notifications']), 'Notifications refused');
eq(decide({device: device({fineLocationPermission: 'denied', notificationPermission: 'denied', backgroundPermission: 'denied', permission: 'denied'})}), blocked('permission', ['fine_location', 'notifications', 'background_location']), 'Everything revoked in settings');
eq(decide({device: device({backgroundPermission: 'denied', locationServicesEnabled: false})}), blocked('permission', ['background_location', 'location_services']), 'Permission guidance outranks the GPS switch, and both are listed');

// Phone location service off.
eq(decide({device: device({locationServicesEnabled: false})}), blocked('location_services', ['location_services']), 'GPS switched off in the phone');
eq(decide({device: device({locationServicesEnabled: null})}), {status: 'allowed'}, 'Unknown location service state does not block');

// Not enrolled for this account.
eq(decide({device: device({enrolled: false})}), blocked('setup', ['enrollment']), 'Permissions fine but not enrolled (stopped by the server or the user)');
eq(decide({device: device({memberId: 'someone-else'})}), blocked('setup', ['enrollment']), 'Enrolled for another account');
eq(decide({device: device({memberId: null})}), blocked('setup', ['enrollment']), 'Enrolled for nobody');
eq(decide({device: gate.gateDeviceFrom(native.normalizeNativeState(ready), undefined)}), blocked('setup', ['enrollment']), 'Member id unknown');

// Fields that older apps do not send.
eq(decide({device: device({continuousConsent: null})}), {status: 'allowed'}, 'Unknown consent does not block a fully enrolled phone');
eq(decide({device: device({fineLocationPermission: null, permission: 'denied'})}), blocked('permission', ['fine_location']), 'Without the fine-location field the general permission decides');
eq(decide({device: device({fineLocationPermission: null, notificationPermission: null, permission: 'granted'})}), {status: 'allowed'}, 'Granted general permission passes when detail fields are absent');

// Working states that must never block: tracking is on and the day has trouble.
eq(decide({device: device({tracking: true})}), {status: 'allowed'}, 'Tracking in the work window');
eq(decide({device: device({tracking: false, trackingWindowActive: false})}), {status: 'allowed'}, 'Outside work hours or Friday the collector is idle by design');
eq(decide({device: device({tracking: false, trackingWindowActive: true})}), {status: 'allowed'}, 'A paused collector inside the window is a warning, not a block');
eq(decide({device: device({pendingCount: 4000, pendingGapCount: 12})}), {status: 'allowed'}, 'Queued points do not block');
eq(decide({device: device({error: 'بانتظار موقع حديث؛ الفترة غير المؤكدة تظهر في التقرير'})}), {status: 'allowed'}, 'A GPS wait does not block work');
eq(decide({device: device({syncError: 'لا يوجد اتصال بالخادم'})}), {status: 'allowed'}, 'A network outage does not block work');

// The checklist helper is stable and ordered.
eq(gate.missingRequirements(device({backgroundPermission: 'denied', fineLocationPermission: 'denied', permission: 'denied'})), ['fine_location', 'background_location'], 'Requirements follow the fixed display order');
eq(gate.REQUIREMENT_ORDER, ['consent', 'fine_location', 'notifications', 'background_location', 'location_services', 'enrollment'], 'Fixed display order');
console.log(JSON.stringify({ok: true, checks}));
