// Classification of a day's GPS coverage per representative: working day, rest day, tracking hours, and what
// each status means for a supervisor. Pure functions; no database, no clock other than the supplied instants.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compiler = {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true};
function load(file, require) { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: compiler}).outputText, {exports, require, console, Date, Intl}); return exports; }
const windowPolicy = load('lib/tracking-window.ts', () => ({}));
const coverage = load('lib/tracking-coverage.ts', name => name === './tracking-window' ? windowPolicy : {});
const text = load('lib/tracking-coverage-text.ts', name => name === './tracking-coverage' ? coverage : {});
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message); checks++; };

// 2026-10-07 is a Wednesday, 2026-10-09 a Friday, 2026-10-10 a Saturday. Saudi Arabia is UTC+3 all year.
const none = {pointsOnDate: 0, dayStartedAt: null, lastPointAt: null};
const at = (date, hhmm) => date + 'T' + hhmm + ':00+03:00';
const status = (entry, date, now) => coverage.coverageStatus({...none, ...entry}, date, new Date(now).toISOString());

eq(status({}, '2026-10-07', at('2026-10-07', '15:00')), 'never_tracked', 'Working day, hours running, nothing ever arrived');
eq(status({lastPointAt: '2026-10-05T10:00:00.000Z'}, '2026-10-07', at('2026-10-07', '15:00')), 'no_points_today', 'Points arrived on other days');
eq(status({dayStartedAt: '2026-10-07T03:05:00.000Z'}, '2026-10-07', at('2026-10-07', '15:00')), 'day_without_points', 'A tracking day was opened but empty');
eq(status({dayStartedAt: '2026-10-07T03:05:00.000Z', lastPointAt: '2026-10-05T10:00:00.000Z'}, '2026-10-07', at('2026-10-07', '15:00')), 'day_without_points', 'An opened empty day outranks older points');
eq(status({pointsOnDate: 1}, '2026-10-07', at('2026-10-07', '15:00')), 'tracked', 'A single point counts as tracked');
eq(status({pointsOnDate: 900, dayStartedAt: '2026-10-07T03:05:00.000Z'}, '2026-10-07', at('2026-10-07', '15:00')), 'tracked', 'Normal day');

// Days on which no tracking is expected must not look like failures.
eq(status({}, '2026-10-09', at('2026-10-09', '12:00')), 'rest_day', 'Friday');
eq(status({}, '2026-10-09', at('2026-10-12', '12:00')), 'rest_day', 'A past Friday');
eq(status({pointsOnDate: 5}, '2026-10-09', at('2026-10-09', '12:00')), 'tracked', 'Points on a Friday are still points');
eq(status({}, '2026-10-10', at('2026-10-10', '12:00')), 'never_tracked', 'Saturday is a working day');
eq(status({}, '2026-10-07', at('2026-10-07', '05:59')), 'not_started', 'Before 06:00 Riyadh time today');
eq(status({}, '2026-10-07', at('2026-10-07', '06:00')), 'never_tracked', 'From 06:00 the window is open');
eq(status({dayStartedAt: '2026-10-07T03:00:00.000Z'}, '2026-10-07', at('2026-10-07', '05:59')), 'not_started', 'Before 06:00 even an odd early day record is not a problem yet');
eq(status({}, '2026-10-07', at('2026-10-07', '19:00')), 'never_tracked', 'After 18:00 the day is over and still has no points');
eq(status({}, '2026-10-08', at('2026-10-07', '15:00')), 'future', 'Tomorrow');
eq(status({}, '2026-10-06', at('2026-10-07', '02:00')), 'never_tracked', 'Yesterday viewed in the small hours is judged as a finished day');
eq(status({}, '2026-10-07', '2026-10-06T21:30:00.000Z'), 'not_started', 'Midnight is in Riyadh, not UTC: 00:30 on the 7th is before the window');
eq(coverage.coverageProblem('never_tracked') && coverage.coverageProblem('no_points_today') && coverage.coverageProblem('day_without_points'), true, 'Three statuses are problems');
eq(['tracked', 'rest_day', 'not_started', 'future'].some(coverage.coverageProblem), false, 'The others are not');

// Combining reports and tracking tables.
const report = (platform, reportedAt, patch = {}) => ({platform, deviceClass: platform === 'browser' ? 'desktop' : 'android', gate: platform === 'browser' ? 'browser' : 'ok', missing: [], appVersion: platform === 'browser' ? '' : '1.0.10', tracking: true, windowActive: true, enrolled: true, consent: true, foreground: 'granted', fineLocation: 'granted', notifications: 'granted', background: 'granted', locationServices: true, lastFixAt: '', accuracy: null, pendingCount: 0, pendingGapCount: 0, quarantinedCount: 0, error: '', syncError: '', reportedAt, ...patch});
const overview = [
  {memberId: 'a', memberName: 'أ', devices: [report('android-app', '2026-10-07T08:00:00.000Z'), report('android-app', '2026-10-07T09:00:00.000Z', {gate: 'permission'}), report('browser', '2026-10-06T08:00:00.000Z'), report('browser', '2026-10-07T07:00:00.000Z')], lastPointAt: null, dayStartedAt: null, pointsOnDate: 0, tripsOnDate: 0},
  {memberId: 'b', memberName: 'ب', devices: [], lastPointAt: '2026-10-05T10:00:00.000Z', dayStartedAt: null, pointsOnDate: 20, tripsOnDate: 1}
];
const built = coverage.buildTrackingCoverage(overview, '2026-10-07', new Date(at('2026-10-07', '15:00')).toISOString());
eq(built.map(entry => [entry.memberId, entry.status]), [['a', 'never_tracked'], ['b', 'tracked']], 'Statuses follow the overview');
eq([built[0].phone.reportedAt, built[0].phone.gate, built[0].browser.reportedAt], ['2026-10-07T09:00:00.000Z', 'permission', '2026-10-07T07:00:00.000Z'], 'The newest report of each platform is kept');
eq([built[1].phone, built[1].browser], [null, null], 'No reports means none');

// Wording.
eq(text.riyadhStamp('2026-10-05T11:15:00.000Z'), '2026-10-05 14:15', 'Riyadh time');
eq(text.riyadhStamp('2026-10-05T22:30:00.000Z'), '2026-10-06 01:30', 'The date rolls over in Riyadh time');
eq(text.riyadhStamp('2026-10-05T11:15:00+03:00'), '2026-10-05 11:15', 'Offsets are honoured');
eq([text.riyadhStamp(null), text.riyadhStamp('nope'), text.riyadhStamp('')], ['', '', ''], 'Unusable input is empty');
for (const language of ['ar', 'en']) for (const state of ['tracked', 'never_tracked', 'no_points_today', 'day_without_points', 'rest_day', 'not_started', 'future']) {
  const entry = {...built[0], status: state, lastPointAt: '2026-10-05T11:15:00.000Z', dayStartedAt: '2026-10-07T03:10:00.000Z', pointsOnDate: 7};
  eq([text.coverageLabel(state, language).length > 3, text.coverageSentence(entry, language).length > 10, /undefined|NaN|\[object/.test(text.coverageSentence(entry, language) + text.coverageLabel(state, language))], [true, true, false], `${language} wording for ${state}`);
}
eq(text.coverageSentence({...built[0], status: 'tracked', pointsOnDate: 7}, 'ar'), 'وصلت 7 نقطة موقع.', 'Tracked sentence');
eq(text.coverageSentence({...built[0], status: 'day_without_points', dayStartedAt: '2026-10-07T03:10:00.000Z'}, 'en'), 'A tracking day opened at 06:10 but no location points arrived.', 'English opened-day sentence');
const phone = patch => ({...built[0], phone: report('android-app', '2026-10-07T07:30:00.000Z', patch), browser: null});
eq(text.phoneSentence(phone({gate: 'ok'}), 'ar'), 'آخر تقرير من الهاتف 2026-10-07 10:30 · الإصدار 1.0.10: التتبع يعمل.', 'Healthy phone');
eq(text.phoneSentence(phone({gate: 'ok', pendingCount: 3}), 'ar').endsWith('توجد 3 نقطة محفوظة على الهاتف لم تُرفع بعد.'), true, 'Queue is mentioned');
eq(text.phoneSentence(phone({gate: 'permission', missing: ['fine_location', 'background_location']}), 'ar'), 'آخر تقرير من الهاتف 2026-10-07 10:30 · الإصدار 1.0.10: أذونات ناقصة — الناقص: الموقع الدقيق، الموقع طوال الوقت.', 'Missing permissions are listed');
eq(text.phoneSentence(phone({gate: 'bridge', error: 'native_unavailable'}), 'ar').includes('(native_unavailable)'), true, 'The phone error is appended');
eq(text.phoneSentence({...built[0], phone: null, browser: report('browser', '2026-10-07T07:00:00.000Z', {deviceClass: 'iphone'})}, 'en').startsWith('The representative last opened the system from a browser (iPhone)'), true, 'Browser-only wording');
eq(text.phoneSentence({...built[0], phone: null, browser: null}, 'ar'), 'لم يصل أي تقرير من هاتف المندوب بعد؛ لم يفتح النظام منذ تفعيل إلزام التتبع.', 'No report at all');
eq(text.phoneBrief(phone({gate: 'ok'}), 'ar'), 'التطبيق 1.0.10 · التتبع يعمل · 2026-10-07 10:30', 'Short line');
eq(text.phoneBrief({...built[0], phone: null, browser: report('browser', '2026-10-07T07:00:00.000Z')}, 'ar'), 'متصفح (حاسوب) · 2026-10-07 10:00', 'Short browser line');
eq(text.phoneBrief({...built[0], phone: null, browser: null}, 'en'), 'No phone report yet', 'Short empty line');
console.log(JSON.stringify({ok: true, checks}));
