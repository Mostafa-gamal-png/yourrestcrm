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
function load(file, require) { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: compiler}).outputText, {exports, require, console, Date, Intl, navigator: {userAgent: 'test'}}); return exports; }
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const no = (value, message) => { assert.ok(!value, message); checks++; };
const native = load('lib/native-tracking.ts', () => ({}));
const gate = load('lib/tracking-gate.ts', name => name === './native-tracking' ? native : {});
const icon = () => null, icons = new Proxy({}, {get: () => icon});
let language = 'ar', tracker;
const component = load('app/tracking-gate.tsx', name => {
  if (name === 'react') return React;
  if (name === 'react/jsx-runtime') return jsx;
  if (name === 'lucide-react') return icons;
  if (name === '@/lib/i18n') return {useLanguage: () => ({language})};
  if (name === '@/lib/tracking-gate') return gate;
  if (name === './email-login') return {authRequest: async () => ({ok: true})};
  if (name === './journey-tracker') return {useJourneyTracker: () => tracker, trackingFailureText: message => message};
  if (name === './language-switch') return {__esModule: true, default: () => React.createElement('button', {className: 'language-switch'}, 'lang')};
  return {};
}).default;
const ready = {tracking: true, permission: 'granted', pendingCount: 0, pendingGapCount: 0, lastFixAt: '', accuracy: null, error: null, syncError: null, memberId: 'rep-1', regionScope: 'all', enrolledRole: 'rep', stopId: null,
  workHoursSupported: true, fridayExclusionSupported: true, trackingWindowActive: true, nextTrackingWindowAt: '', continuousSupported: true, enrolled: true, backgroundPermission: 'granted', appVersion: '1.0.10',
  fineLocationPermission: 'granted', notificationPermission: 'granted', locationServicesEnabled: true, continuousConsent: true};
const gateOf = (patch = {}, extra = {}) => ({native: true, loading: false, failed: false, upgradeRequired: false, device: gate.gateDeviceFrom(native.normalizeNativeState({...ready, ...patch}), 'rep-1'), ...extra});
const trackerWith = (source, extra = {}) => ({gate: source, busy: false, errorMessage: '', appVersion: '1.0.10', retry() {}, setupContinuous: async () => {}, ...extra});
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
ok(html.includes('/downloads/yourrest-crm-android-v1.0.10-11.apk') && html.includes('تحديث تطبيق أندرويد'), 'An old app is offered the update');
ok(html.includes('إصدار التطبيق: ') && html.includes('1.0.10'), 'The installed version is shown');
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
console.log(JSON.stringify({ok: true, checks}));
