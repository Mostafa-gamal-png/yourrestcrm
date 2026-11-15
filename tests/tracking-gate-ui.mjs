// Server-rendered markup of the real gate component for every decision, in both languages. The component runs
// against a controlled tracker context; the browser behaviour (taps, permission changes) is covered by
// tests/tracking-gate-browser.mjs against the built app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const compiler = {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true};
function load(file, require) { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: compiler}).outputText, {exports, require, console, Date, Intl, URL, navigator: {userAgent: 'test'}}); return exports; }
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const no = (value, message) => { assert.ok(!value, message); checks++; };
const native = load('lib/native-tracking.ts', () => ({}));
const update = load('lib/app-update.ts', name => name === './native-tracking' ? native : {});
const gate = load('lib/tracking-gate.ts', name => name === './native-tracking' ? native : name === './app-update' ? update : {});
const release = JSON.parse(fs.readFileSync('lib/app-update-release.json', 'utf8'));
let updateState = null;
const icon = () => null, icons = new Proxy({}, {get: () => icon});
let language = 'ar', tracker;
const component = load('app/tracking-gate.tsx', name => {
  if (name === 'react') return React;
  if (name === 'react/jsx-runtime') return jsx;
  if (name === 'lucide-react') return icons;
  if (name === '@/lib/i18n') return {useLanguage: () => ({language})};
  if (name === '@/lib/tracking-gate') return gate;
  if (name === '@/lib/app-update') return {...update, appUpdateController: () => ({snapshot: () => updateState, subscribe(listener) { listener(updateState); return () => {}; }})};
  if (name === '@/lib/app-update-release.json') return release;
  if (name === './app-update') return {__esModule: true, default: props => React.createElement('section', {className: 'app-update-banner', 'data-in-gate': props?.inGate ? 'yes' : 'no'}, 'IN-APP-UPDATE')};
  if (name === './email-login') return {authRequest: async () => ({ok: true})};
  if (name === './journey-tracker') return {useJourneyTracker: () => tracker, trackingFailureText: message => message};
  if (name === './language-switch') return {__esModule: true, default: () => React.createElement('button', {className: 'language-switch'}, 'lang')};
  return {};
}).default;
const ready = {tracking: true, permission: 'granted', pendingCount: 0, pendingGapCount: 0, lastFixAt: '', accuracy: null, error: null, syncError: null, memberId: 'rep-1', regionScope: 'all', enrolledRole: 'rep', stopId: null,
  workHoursSupported: true, fridayExclusionSupported: true, trackingWindowActive: true, nextTrackingWindowAt: '', continuousSupported: true, enrolled: true, backgroundPermission: 'granted', appVersion: release.versionName,
  fineLocationPermission: 'granted', notificationPermission: 'granted', locationServicesEnabled: true, continuousConsent: true};
const gateOf = (patch = {}, extra = {}) => ({native: true, loading: false, failed: false, upgradeRequired: false, device: gate.gateDeviceFrom(native.normalizeNativeState({...ready, ...patch}), 'rep-1'), ...extra});
const trackerWith = (source, extra = {}) => ({gate: source, busy: false, errorMessage: '', appVersion: release.versionName, retry() {}, setupContinuous: async () => {}, ...extra});
const rep = {id: 'rep-1', name: 'مندوب تجريبي', role: 'rep', active: 1};
const app = React.createElement('div', {id: 'workspace'}, 'WORKSPACE');
const render = (member = rep) => renderToStaticMarkup(React.createElement(component, {me: member}, app));

// Allowed: the workspace is the page and no gate markup exists.
tracker = trackerWith(gateOf());
let html = render();
ok(html.includes('WORKSPACE'), 'A ready representative sees the workspace');
no(html.includes('tracking-gate'), 'No gate markup for a ready representative');
tracker = trackerWith({native: false, loading: false, failed: false, upgradeRequired: false, device: null});
for (const role of ['admin', 'manager', 'supervisor', 'customer_service']) {
  html = render({...rep, role});
  ok(html.includes('WORKSPACE') && !html.includes('tracking-gate'), role + ' passes through in a browser');
}
ok(renderToStaticMarkup(React.createElement(component, {me: null}, app)).includes('WORKSPACE'), 'Nothing is blocked before the member is known');

// Blocked: the workspace markup never appears.
const reasons = [
  ['browser', trackerWith({native: false, loading: false, failed: false, upgradeRequired: false, device: null}), 'تطبيق يورست على أندرويد'],
  ['upgrade', trackerWith(gateOf({appVersion: '1.0.6'})), 'حدّث تطبيق يورست'],
  ['setup', trackerWith(gateOf({continuousConsent: false, enrolled: false, memberId: null, permission: 'denied', fineLocationPermission: 'denied', notificationPermission: 'denied', backgroundPermission: 'prompt'})), 'فعّل تتبع خط السير لبدء العمل'],
  ['permission', trackerWith(gateOf({backgroundPermission: 'denied'})), 'أذونات تتبع خط السير ناقصة'],
  ['location_services', trackerWith(gateOf({locationServicesEnabled: false})), 'خدمة الموقع في الهاتف مغلقة'],
  ['bridge', trackerWith(gateOf({}, {device: null, failed: true})), 'تعذر الاتصال بخدمة التتبع']
];
for (const [reason, context, title] of reasons) {
  tracker = context; language = 'ar';
  html = render();
  no(html.includes('WORKSPACE'), reason + ': the workspace is not rendered');
  ok(html.includes('data-gate="blocked"') && html.includes('data-gate-reason="' + reason + '"'), reason + ': marked as blocked for this reason');
  ok(html.includes(title), reason + ': Arabic title');
  ok(html.includes('dir="rtl"'), reason + ': right-to-left');
  ok(html.includes('تسجيل الخروج'), reason + ': sign-out is always offered');
  ok(html.includes('مندوب تجريبي'), reason + ': shows the signed-in account');
  language = 'en';
  html = render();
  ok(html.includes('dir="ltr"') && html.includes('Sign out'), reason + ': English layout');
}
language = 'ar';

// The mandatory update (the owner's rule, taken from GSCO on 2026-10-31): an app older than the served release, read live with its APK
// answering, is held at the update screen whatever the role. The workspace stays mounted under it, hidden; nothing offers to continue.
const required = (patch = {}) => ({native: true, protocol: 0, phase: 'available', installedVersionCode: null, installedVersionName: '1.0.7', availableVersionCode: release.versionCode, availableVersionName: release.versionName, downloadedBytes: 0, totalBytes: 1, progress: 0, error: '', offline: false, legacyUrl: release.apkUrl, legacyStarted: false, releaseNotes: release.releaseNotes, requiredVersionCode: release.versionCode, requiredVersionName: release.versionName, requiredReleaseNotes: release.releaseNotes, apkReachable: true, ...patch});
const continueWords = /يمكنك متابعة|متابعة العمل|لاحقًا|تخطي|keep working|continue working|Later|Skip/;
const heldWorkspace = html => /<div class="gate-workspace" style="display:none" aria-hidden="true" data-holding="yes"><div id="workspace">WORKSPACE<\/div><\/div>/.test(html);
tracker = trackerWith(gateOf({appVersion: '1.0.7'}), {appVersion: '1.0.7'}); updateState = required(); html = render();
ok(html.includes('data-gate="blocked"') && html.includes('data-gate-update="required"') && html.includes('حدّث تطبيق يورست للمتابعة'), 'An app older than the served version is held at the update screen');
ok(heldWorkspace(html), 'The workspace stays mounted under it, hidden and out of reach (open forms and the queue survive)');
ok(html.includes('الإصدار المثبت على هاتفك 1.0.7 أقدم من الإصدار المطلوب ' + release.versionName) && html.includes('المطلوب: ') && html.includes('إلزامي لجميع المستخدمين'), 'The body names both versions and says the update is required of everyone');
ok(release.releaseNotes.ar.every(note => html.includes(note.replace(/"/g, '&quot;'))) && html.includes('ما الجديد في هذا الإصدار'), 'The release notes of the required version are listed');
ok(html.includes('IN-APP-UPDATE') && html.includes('data-in-gate="yes"'), 'The update panel (download, install, retry, browser path) is inside the screen');
ok(html.includes('تسجيل الخروج') && html.includes('مندوب تجريبي'), 'The account and its sign-out stay reachable');
no(continueWords.test(html), 'Nothing offers to continue or postpone');
no(html.includes('tracking-gate-list'), 'The update comes before any tracking checklist');
for (const role of ['admin', 'manager', 'supervisor', 'customer_service', 'customer_service_manager']) {
  tracker = role.startsWith('customer_service') ? trackerWith({native: true, loading: false, failed: false, upgradeRequired: false, device: null}, {appVersion: ''}) : trackerWith(gateOf({appVersion: '1.0.7'}), {appVersion: '1.0.7'});
  updateState = required(role.startsWith('customer_service') ? {protocol: 1, installedVersionCode: release.versionCode - 1, installedVersionName: '1.0.11', legacyUrl: ''} : {}); html = render({...rep, role});
  ok(html.includes('data-gate-update="required"') && heldWorkspace(html), role + ' in an outdated app is held too');
}
// [label, update state, the version the tracking service reports]
for (const [label, patch, reported] of [
  ['the same version', {installedVersionName: release.versionName}, release.versionName],
  ['a newer version', {installedVersionName: '9.0.0'}, '9.0.0'],
  ['the same exact code', {protocol: 1, installedVersionCode: release.versionCode}, '1.0.7'],
  ['a newer exact code', {protocol: 1, installedVersionCode: release.versionCode + 1}, '1.0.7'],
  ['offline (the update cannot be downloaded)', {offline: true}, '1.0.7'],
  ['an APK that does not answer on the site', {apkReachable: false}, '1.0.7'],
  ['a release that could not be read', {requiredVersionCode: null, requiredVersionName: '', apkReachable: null}, '1.0.7'],
  ['an unknown installed version', {installedVersionName: ''}, '']
]) {
  tracker = trackerWith(gateOf({appVersion: reported || release.versionName}), {appVersion: reported});
  updateState = required(patch); html = render();
  ok(html.includes('<div id="workspace">WORKSPACE</div>') && !html.includes('data-gate') && html.includes('style="display:contents"'), 'Not held: ' + label);
}
tracker = trackerWith(gateOf({appVersion: '1.0.7'}), {appVersion: '1.0.7'}); updateState = required({installedVersionName: ''}); html = render();
ok(html.includes('data-gate-update="required"') && html.includes('الإصدار المثبت على هاتفك 1.0.7 أقدم'), 'An unreported installed version is still judged, and named, by what the tracking service reports');
updateState = required({installedVersionName: release.versionName}); html = render();
ok(html.includes('data-gate-update="required"') && html.includes('الإصدار المثبت على هاتفك 1.0.7 أقدم') && !html.includes('هاتفك ' + release.versionName + ' أقدم'), 'The screen names the older of the two reported versions');
updateState = required(); html = render({...rep, active: 0});
ok(html.includes('WORKSPACE') && !html.includes('data-gate'), 'A deactivated account sees the account error, not the update screen');
html = renderToStaticMarkup(React.createElement(component, {me: null}, app));
ok(html.includes('WORKSPACE') && !html.includes('data-gate'), 'Nothing is held before the member is known');
tracker = trackerWith({native: false, loading: false, failed: false, upgradeRequired: false, device: null}); updateState = null;
for (const role of ['admin', 'customer_service']) { html = render({...rep, role}); ok(html.includes('WORKSPACE') && !html.includes('data-gate'), role + ' in a browser is never held'); }
tracker = trackerWith(gateOf({appVersion: '1.0.6'}), {appVersion: '1.0.6'}); updateState = required({installedVersionName: '1.0.6'}); language = 'en'; html = render();
ok(html.includes('Update the Yourrest app to continue') && html.includes('older than the required version ' + release.versionName) && html.includes('required for every user') && html.includes('What is new in this version') && html.includes('dir="ltr"'), 'English wording');
ok(release.releaseNotes.en.every(note => html.includes(note)), 'English release notes');
no(continueWords.test(html), 'Nothing offers to continue in English either');
no(/[\u0600-\u06ff]/.test(html.replace(/<button class="language-switch">[^<]*<\/button>/, '').replace(/مندوب تجريبي/g, '').replace(/<div id="workspace">[^<]*<\/div>/, '')), 'No Arabic left in the English screen but the member\'s own name');
language = 'ar'; updateState = null;
tracker = trackerWith(gateOf({appVersion: '1.0.6'}), {appVersion: '1.0.6'}); html = render();
ok(html.includes('data-gate-reason="upgrade"') && !html.includes('data-gate-update') && html.includes('حدّث تطبيق يورست لتفعيل تتبع خط السير') && !html.includes('WORKSPACE'), 'With no live requirement, an app lacking a tracking capability keeps the capability screen, without the workspace');
ok(html.includes('href="' + new URL(release.apkUrl).pathname + '"') && html.includes('تحديث تطبيق أندرويد') && !html.includes('IN-APP-UPDATE'), 'an app without the update protocol gets the served file');
updateState = {...required(), protocol: 1, installedVersionCode: 8, legacyUrl: '', requiredVersionCode: null, requiredVersionName: '', apkReachable: null};
html = render();
ok(html.includes('IN-APP-UPDATE') && !html.includes('href="' + new URL(release.apkUrl).pathname + '"'), 'an app with the update protocol gets the in-app flow instead of the file');
updateState = null;
tracker = trackerWith(gateOf({appVersion: release.versionName, continuousSupported: false}), {appVersion: release.versionName}); html = render();
ok(html.includes('حدّث تطبيق يورست لتفعيل تتبع خط السير') && !html.includes('أقدم من الإصدار المطلوب'), 'a current app that lacks a capability keeps the capability wording');

// Content details that matter to the person at the screen.
tracker = reasons.find(r => r[0] === 'setup')[1]; html = render();
ok(html.includes('data-requirement="consent"') && html.includes('data-requirement="enrollment"'), 'The checklist lists every requirement');
ok((html.match(/data-needed="yes"/g) || []).length === 5 && (html.match(/data-needed="no"/g) || []).length === 1, 'A fresh install needs five things; the GPS switch is already on');
ok(html.includes('تفعيل التتبع') && !html.includes('تنزيل تطبيق أندرويد'), 'Setup offers activation, not a download');
tracker = reasons.find(r => r[0] === 'permission')[1]; html = render();
ok(html.includes('السماح طوال الوقت') && html.includes('tracking-gate-steps'), 'The missing permission comes with the exact setting to choose');
ok(!html.includes('الإشعارات ← السماح'), 'Only the missing permissions get a step');
tracker = trackerWith(gateOf({fineLocationPermission: 'denied', notificationPermission: 'denied', backgroundPermission: 'denied', permission: 'denied'})); html = render();
ok(html.includes('الإشعارات ← السماح') && html.includes('الموقع ← السماح، مع تفعيل') && html.includes('الموقع ← «السماح طوال الوقت»'), 'Three missing permissions give three steps');
ok(html.includes('إعادة الفحص'), 'A re-check button exists once permissions were refused');
tracker = reasons.find(r => r[0] === 'upgrade')[1]; html = render();
ok(html.includes(new URL(release.apkUrl).pathname) && html.includes('تحديث تطبيق أندرويد'), 'An old app is offered the update');
ok(html.includes('إصدار التطبيق: ') && html.includes(release.versionName), 'The installed version is shown');
tracker = reasons.find(r => r[0] === 'browser')[1]; html = render();
ok(html.includes('لا يعمل من المتصفح') || html.includes('ويعمل على هواتف أندرويد فقط'), 'The browser block explains why');
no(html.includes('data-requirement'), 'A browser has no checklist');
tracker = trackerWith(reasons.find(r => r[0] === 'permission')[1].gate, {busy: true, operationError: 'background_permission_required'}); html = render();
ok(html.includes('disabled') && html.includes('جارٍ التفعيل'), 'The button is disabled while an activation is running');
ok(html.includes('role="alert"') && html.includes('background_permission_required'), 'A tracker failure is shown as an alert');

// What the last tap did wrong, or what the app itself reports, is shown. A standing permission state is not repeated.
tracker = trackerWith(reasons.find(r => r[0] === 'setup')[1].gate, {operationError: 'لم يبدأ التسجيل؛ يلزم الموافقة على تسجيل الموقع في ساعات العمل', errorMessage: 'fine_location_permission_required'}); html = render();
ok(html.includes('يلزم الموافقة على تسجيل الموقع') && !html.includes('fine_location_permission_required'), 'A declined consent shows its own reason');
tracker = trackerWith(reasons.find(r => r[0] === 'setup')[1].gate, {operationError: '', errorMessage: 'fine_location_permission_required'}); html = render();
no(html.includes('role="alert"') || html.includes('fine_location_permission_required') || html.includes('إذن الموقع الدقيق غير متاح'), 'A first run, not yet asked, shows no standing permission error');
tracker = trackerWith(gateOf({enrolled: false, memberId: null, error: 'توقف التسجيل؛ سجّل الدخول مجددًا للحساب نفسه لرفع النقاط المحفوظة'})); html = render();
ok(html.includes('role="alert"') && html.includes('سجّل الدخول مجددًا للحساب نفسه'), 'A stop reported by the app itself is shown');
tracker = trackerWith(gateOf({backgroundPermission: 'denied'}), {operationError: '', errorMessage: 'background_permission_required'}); html = render();
no(html.includes('role="alert"'), 'The checklist already says which permission is missing');

// Checking is neutral, not an error.
tracker = trackerWith({native: true, loading: true, failed: false, upgradeRequired: false, device: null}); html = render();
ok(html.includes('data-gate="checking"') && html.includes('جارٍ التحقق من تتبع خط السير'), 'Waiting for the app is a checking screen');
no(html.includes('WORKSPACE') || html.includes('data-gate="blocked"'), 'Checking shows neither the workspace nor a block');
// A companion device (a tablet beside the phone that records the route) gets the workspace; once the other device stops
// recording, the setup screen says where the route was recorded and that enabling here moves it to this device.
const setupGate = reasons.find(r => r[0] === 'setup')[1].gate;
tracker = trackerWith({...setupGate, companion: true}); html = render();
ok(html.includes('WORKSPACE') && !html.includes('data-gate'), 'A companion sees the workspace');
tracker = trackerWith(setupGate, {companionRemembered: true}); html = render();
ok(html.includes('data-gate-reason="setup"') && html.includes('data-companion="lost"') && html.includes('جهازك الآخر') && html.includes('ليصبح هذا الجهاز هو الذي يسجّل'), 'A former companion is told where the route was recorded');
tracker = trackerWith(setupGate); html = render();
no(html.includes('data-companion'), 'A device that never was a companion sees the usual setup screen');
console.log(JSON.stringify({ok: true, checks}));
