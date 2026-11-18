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
// The field roles (a representative or a marketing officer, 2026-11-18) are the real lib/roles.ts.
const roles = load('lib/roles.ts', () => ({}));
const gate = load('lib/tracking-gate.ts', name => name === './native-tracking' ? native : name === './app-update' ? update : name === './roles' ? roles : {});
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message); checks++; };

// A phone that is fully set up, as the Android app reports it (JSON null = field absent from the app).
const ready = {tracking: true, permission: 'granted', pendingCount: 0, pendingGapCount: 0, lastFixAt: '2026-10-12T08:00:00.000Z', accuracy: 8, error: null, syncError: null, memberId: 'rep-1', regionScope: 'all', enrolledRole: 'rep', stopId: null,
  workHoursSupported: true, fridayExclusionSupported: true, trackingWindowActive: true, nextTrackingWindowAt: '2026-10-13T03:00:00.000Z', continuousSupported: true, enrolled: true, backgroundPermission: 'granted', appVersion: '1.0.10',
  fineLocationPermission: 'granted', notificationPermission: 'granted', locationServicesEnabled: true, continuousConsent: true, mapsLaunchSupported: true, foregroundDirectionsSupported: true, immutableBindingSupported: true, accountRecoverySupported: true, directionsSupported: true};
const device = (patch = {}, memberId = 'rep-1') => gate.gateDeviceFrom(native.normalizeNativeState({...ready, ...patch}), memberId);
const rep = {role: 'rep', active: 1};
const source = (patch = {}) => ({native: true, loading: false, failed: false, upgradeRequired: false, device: device(), ...patch});
const decide = (input = {}) => gate.trackingGateDecision({...rep, ...source(), ...input});
const blocked = (reason, missing = []) => ({status: 'blocked', reason, missing});

// Only an active representative is gated; everyone else, and an unknown member, passes through untouched.
for (const role of ['admin', 'manager', 'supervisor', 'customer_service', 'customer_service_manager', undefined]) {
  eq(decide({role, native: false, device: null}), {status: 'allowed'}, 'Other roles are never gated: ' + role);
  eq(decide({role, device: device({continuousConsent: false, enrolled: false, backgroundPermission: 'denied'})}), {status: 'allowed'}, 'Other roles are not gated even on a broken phone: ' + role);
}
eq(decide({active: 0, native: false, device: null}), {status: 'allowed'}, 'A deactivated representative sees the account error, not a tracking screen');
// A marketing officer works in the field like a representative (lib/roles.ts): gated the same way.
eq(decide({role: 'marketing', native: false, device: null}), blocked('browser'), 'A marketing officer in a browser is blocked like a representative');
eq(decide({role: 'marketing'}), {status: 'allowed'}, 'A marketing officer with a fully set-up phone works');
eq(decide({role: 'marketing', device: device({backgroundPermission: 'denied'})}).status, 'blocked', 'A marketing officer without background location is blocked like a representative');
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
eq(decide({device: device({appVersion: '1.0.7'})}), {status: 'allowed'}, 'Version 1.0.7 is the first with every tracking capability');
eq(decide({device: device({continuousSupported: false})}), blocked('upgrade'), 'No continuous support');
eq(decide({device: device({workHoursSupported: false})}), blocked('upgrade'), 'No work-hours support');
eq(decide({device: device({fridayExclusionSupported: false})}), blocked('upgrade'), 'No Friday exclusion');
eq(decide({device: device({pendingGapCount: null})}), blocked('upgrade'), 'Unknown gap queue');

// The mandatory app version is not this decision's: app/tracking-gate.tsx asks lib/app-update.ts appUpdateRequired first, for every role,
// from the served release read live (GSCO's rule: the oldest app allowed is the newest published one; unknown or unreachable stays open).
eq(decide({device: device({appVersion: '1.0.7'})}), {status: 'allowed'}, 'The tracking decision judges capabilities, not the version');
eq(decide({device: device({appVersion: '1.0.7'}), requiredVersion: '1.0.10'}), {status: 'allowed'}, 'A served version handed to it is ignored');
for (const role of ['admin', 'manager', 'supervisor']) {
  eq(decide({role, device: device({appVersion: '1.0.10', continuousConsent: false, enrolled: false})}), {status: 'allowed'}, role + ' passes whatever the tracking state');
  eq(decide({role, native: false, device: null}), {status: 'allowed'}, role + ' in a browser is not gated');
}
eq(decide({device: device({appVersion: ''})}), blocked('upgrade'), 'An app that reports no version is judged on its capabilities only, and an app that old lacks the work-hours schedule');
eq(decide({role: 'manager', device: device({appVersion: ''})}), {status: 'allowed'}, 'For another role an unknown version is not judged at all');
eq(decide({device: device({appVersion: '1.0.7', backgroundPermission: 'denied'})}), blocked('permission', ['background_location']), 'Under the update screen, the tracking reason is still known');
// appUpdateRequired, on the update state the controller keeps (the served release read live, its APK answering).
const updateState = (patch = {}) => ({native: true, protocol: 0, phase: 'available', installedVersionCode: null, installedVersionName: '1.0.7', availableVersionCode: 11, availableVersionName: '1.0.10', downloadedBytes: 0, totalBytes: 0, progress: 0, error: '', offline: false, legacyUrl: '', legacyStarted: false, releaseNotes: {ar: [], en: []}, requiredVersionCode: 11, requiredVersionName: '1.0.10', requiredReleaseNotes: {ar: [], en: []}, apkReachable: true, ...patch});
const held = (patch, reported) => update.appUpdateRequired(updateState(patch), reported);
eq([held({}), held({installedVersionName: '1.0.9'}), held({installedVersionName: '1.0.10'}), held({installedVersionName: '1.0.11'}), held({installedVersionName: '2.0.0'})], [true, true, false, false, false], 'Older apps are held, however close; the same or a newer one never');
eq([held({installedVersionCode: 10, installedVersionName: '1.0.9'}), held({installedVersionCode: 11, installedVersionName: '1.0.10'}), held({installedVersionCode: 12}), held({installedVersionCode: 11}, '1.0.7')], [true, false, false, false], 'An exact installed code decides, over any name');
eq([held({installedVersionName: ''}), held({installedVersionName: 'unknown'}), held({installedVersionName: ''}, '1.0.7'), held({installedVersionName: ''}, 'x'), held({installedVersionName: '1.0.10'}, '1.0.7')], [false, false, true, false, true], 'An unknown version is never held; the tracking service reporting an older one is');
eq([held({offline: true}), held({requiredVersionCode: null, requiredVersionName: ''}), held({apkReachable: false}), held({apkReachable: null}), held({native: false}), held({requiredVersionName: 'later'})], [false, false, false, false, false, false], 'Offline, an unread release, an APK that does not answer, a browser or a malformed release hold nobody (GSCO: fail-open)');
eq([update.enforcedRequirement(updateState()), update.enforcedRequirement(updateState({offline: true}))], [{code: 11, name: '1.0.10'}, null], 'enforcedRequirement');

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
// A companion device (a tablet beside the phone that records the route) works without tracking of its own.
const tablet = device({enrolled: false, continuousConsent: null, backgroundPermission: 'prompt', notificationPermission: 'prompt', tracking: false});
eq(decide({device: tablet}), blocked('permission', ['background_location', 'enrollment']), 'A device that records nothing is blocked on its own');
eq(decide({device: tablet, companion: true}), {status: 'allowed'}, 'The same device is allowed while another device records the route');
eq(decide({device: device({backgroundPermission: 'denied', locationServicesEnabled: false}), companion: true}), {status: 'allowed'}, 'A companion needs none of the tracking permissions');
eq(decide({device: tablet, companion: false}), blocked('permission', ['background_location', 'enrollment']), 'companion false changes nothing');
eq(decide({device: device({appVersion: '1.0.9'}), companion: true}), {status: 'allowed'}, 'A companion passes the tracking decision; its app version is held by the update screen before it, as everyone\'s');
eq(decide({device: tablet, companion: true, upgradeRequired: true}), blocked('upgrade'), 'A companion on an app without continuous support is still told to update');
eq(decide({native: false, device: null, companion: true}), blocked('browser'), 'A browser never becomes a companion');
eq(decide({device: null, companion: true}), {status: 'checking'}, 'Before the app answers, a companion is still being checked');
eq(decide({device: null, failed: true, companion: true}), blocked('bridge'), 'A broken bridge is reported even for a companion');
for (const role of ['admin', 'manager', 'supervisor']) eq(decide({role, device: tablet, companion: true}), {status: 'allowed'}, 'Other roles are unchanged: ' + role);
// Until the server has answered whether another device records, a device that is not set up waits (nothing is reported).
eq(decide({device: tablet, companionPending: true}), {status: 'checking'}, 'Not set up, server not answered yet: still checking');
eq(decide({device: tablet, companionPending: true, companion: true}), {status: 'allowed'}, 'Known companion: allowed');
eq(decide({device: device(), companionPending: true}), {status: 'allowed'}, 'A phone that is set up never waits for the answer');
eq(decide({device: device({appVersion: '1.0.9'}), companionPending: true}), {status: 'allowed'}, 'A set-up phone never waits for the answer, whatever its version (the update screen holds an outdated one first)');
eq(decide({role: 'supervisor', device: tablet, companionPending: true}), {status: 'allowed'}, 'Other roles never wait');
console.log(JSON.stringify({ok: true, checks}));
