// Rules for the place of a customer: which text is read as coordinates, what a hand-placed point is stored as, and what a form may
// check before saving or queuing (the server's rules except the clock). Pure logic; no browser, database or network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
const place = {}, fields = {};
vm.runInNewContext(compile('lib/customer-location.ts'), {exports: place});
vm.runInNewContext(compile('lib/customer-fields.ts'), {exports: fields, require: name => name === 'zod' ? require('zod') : name === './customer-location' ? place : (() => { throw Error('unexpected import ' + name); })(), Date, Number, Math, Object});
// Objects built in the compiled modules belong to another realm: compare them by value.
const plain = value => JSON.parse(JSON.stringify(value ?? null));
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(plain(actual), plain(expected), message); checks++; };

// What is read as coordinates, and what is not
for (const [text, expected] of [
  ['24.7136, 46.6753', [24.7136, 46.6753]], ['24.7136,46.6753', [24.7136, 46.6753]], ['  -33.86 , 151.2  ', [-33.86, 151.2]],
  ['21.4858، 39.1925', [21.4858, 39.1925]],
  ['https://www.google.com/maps/@24.7136,46.6753,17z', [24.7136, 46.6753]], ['https://www.google.com/maps/place/Jeddah/@21.5433,39.1728,17z', [21.5433, 39.1728]],
  ['https://www.google.com/maps?q=26.4373,50.0344', [26.4373, 50.0344]], ['https://www.google.com/maps/search/?api=1&query=26.4373%2C50.0344', [26.4373, 50.0344]]
]) eq(place.coordinatesFromText(text), {latitude: expected[0], longitude: expected[1]}, 'read as coordinates: ' + text);
for (const text of ['', '   ', 'الدمام', 'abc', '26.4373', '26.4373; 50.0344', '26.4373 50.0344', '91, 50', '-91, 50', '26, 181', '26, -181', '0, 0', 'https://maps.app.goo.gl/AbCdEf123', 'https://www.google.com/maps/place/Dammam']) eq(place.coordinatesFromText(text), null, 'not coordinates: ' + JSON.stringify(text));
eq(place.customerCoordinates({location: 'الدمام', latitude: 26.4, longitude: 50.1}), {latitude: 26.4, longitude: 50.1}, 'stored numbers win over the text');
eq(place.customerCoordinates({location: '26.5, 50.2'}), {latitude: 26.5, longitude: 50.2}, 'and the text is read when there are no numbers');

// A pasted maps link outgrows the 250-character field: it is kept as the plain coordinates it points to, other text as typed
const longLink = 'https://www.google.com/maps/place/' + encodeURIComponent('مصنع '.repeat(30)) + '/@21.4858,39.1925,17z/data=!3m1!4b1!4m6!3m5!1s0x15c3d0f0f0f0f0f0:0x1234567890abcdef!8m2!3d21.4858!4d39.1925';
eq(longLink.length > 250, true, 'the fixture link is longer than the field');
eq(place.tidyLocationText(longLink), '21.4858000, 39.1925000', 'a long link becomes its coordinates');
eq(place.tidyLocationText('https://www.google.com/maps/@24.7136,46.6753,17z'), '24.7136000, 46.6753000', 'a short one too');
eq(place.tidyLocationText('https://www.google.com/maps?q=26.4373,50.0344'), '26.4373000, 50.0344000', 'and a q= link');
for (const text of ['24.7136, 46.6753', '21.4858، 39.1925', '  -33.86 , 151.2  ', 'الدمام', '', 'https://maps.app.goo.gl/AbCdEf123', '0, 0']) eq(place.tidyLocationText(text), text, 'left as typed: ' + JSON.stringify(text));
eq(place.coordinatesFromText(place.tidyLocationText(longLink)), place.coordinatesFromText(longLink), 'the tidied text reads back as the same place');

// A point placed by hand is stored as numbers worked out from the text, never as a phone capture
const byHand = (location, extra = {}) => ({location, latitude: null, longitude: null, ...extra});
const placed = text => { const data = byHand(text, {locationSource: undefined, locationCapturedAt: undefined, locationAccuracy: undefined}); return {problem: fields.prepareCustomerLocation(data), data}; };
let result = placed('24.7136, 46.6753');
eq([result.problem, result.data.latitude, result.data.longitude, 'locationSource' in result.data || 'locationCapturedAt' in result.data || 'locationAccuracy' in result.data], [null, 24.7136, 46.6753, false], 'typed coordinates');
result = placed('https://www.google.com/maps/@21.5433,39.1728,17z');
eq([result.problem, result.data.latitude, result.data.longitude, result.data.location], [null, 21.5433, 39.1728, 'https://www.google.com/maps/@21.5433,39.1728,17z'], 'a maps link keeps its text and gets its numbers');
result = placed('');
eq([result.problem, result.data.latitude, result.data.longitude], [null, null, null], 'no place at all is allowed and invents none');
for (const text of ['الدمام', '0, 0', '91, 50']) eq(placed(text).problem, 'أدخل اللوكيشن كخط عرض، خط طول، أو رابط خرائط يحتوي الإحداثيات.', 'refused with the sentence the form shows: ' + text);

// A capture the phone made, then a place typed over it: the stale claim is refused, never relabelled
const capture = {location: '26.4373410, 50.0344990', latitude: 26.437341, longitude: 50.034499, locationSource: 'device', locationCapturedAt: '2026-10-14T07:00:00.000Z', locationAccuracy: 12};
const now = Date.parse('2026-10-14T07:05:00.000Z');
eq(fields.prepareCustomerLocation({...capture}, undefined, now), null, 'an untouched capture passes');
eq(fields.prepareCustomerLocation({...capture, location: '24.7136, 46.6753'}, undefined, now), 'تغيّر اللوكيشن بعد التقاطه. حدّث موقع الجهاز ثم حاول مرة أخرى.', 'a capture whose place was changed is refused');
const withoutClaim = {...capture, location: '24.7136, 46.6753'}; delete withoutClaim.locationSource;
eq([fields.prepareCustomerLocation(withoutClaim, undefined, now), withoutClaim.latitude, withoutClaim.longitude, 'locationCapturedAt' in withoutClaim, 'locationAccuracy' in withoutClaim], [null, 24.7136, 46.6753, false, false], 'without the device claim the old numbers and metadata are replaced by the typed place');

// What a form checks before saving or queuing: the same rules, on a copy, and without the clock
const early = Date.parse('2026-10-14T06:00:00.000Z');
eq(fields.prepareCustomerLocation({...capture}, undefined, early), 'بيانات التقاط الموقع غير مكتملة. حدّث موقع الجهاز ثم حاول مرة أخرى.', 'the server refuses a capture dated after its own clock');
eq(fields.customerLocationProblem({...capture}), null, 'the form does not judge a capture time by the phone\'s own clock: positioning time may differ from it');
eq(fields.customerLocationProblem({...capture, locationCapturedAt: '2099-01-01T00:00:00.000Z'}), null, 'whatever the skew');
eq(fields.customerLocationProblem({...capture, location: '24.7136, 46.6753'}), 'تغيّر اللوكيشن بعد التقاطه. حدّث موقع الجهاز ثم حاول مرة أخرى.', 'but it does refuse a place changed after the capture');
eq(fields.customerLocationProblem({...capture, locationAccuracy: undefined}), 'بيانات التقاط الموقع غير مكتملة. حدّث موقع الجهاز ثم حاول مرة أخرى.', 'and a capture without its accuracy');
eq(fields.customerLocationProblem(byHand('الدمام')), 'أدخل اللوكيشن كخط عرض، خط طول، أو رابط خرائط يحتوي الإحداثيات.', 'and text that is not coordinates');
eq(fields.customerLocationProblem(byHand('24.7136, 46.6753')), null, 'and passes a typed place');
const original = byHand('24.7136, 46.6753', {locationSource: 'device', locationCapturedAt: '2026-10-14T07:00:00.000Z', locationAccuracy: 12});
const before = JSON.stringify(original);
fields.customerLocationProblem(original);
eq(JSON.stringify(original), before, 'the data the form sends is never changed by the check: the server works the numbers out itself');

console.log(JSON.stringify({ok: true, checks, coverage: 'coordinate text formats (Arabic comma, maps links, query links) and refusals; hand-placed points stored as numbers without capture metadata; stale capture claims refused; the form check without the clock and without side effects', realBrowser: false, realDevice: false}));
