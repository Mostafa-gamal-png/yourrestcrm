// The rule that a visit is recorded where the customer is, as pure functions: how far the phone's point may be from the customer's
// (300 m, widened by the phone's own accuracy up to 100 m more), a fix too weak to judge, arrival the route tracking already
// confirmed, a customer with no point of their own, the words of the refusal in Arabic and English, and that the Arabic words the
// server sends translate through the English dictionary's patterns. Distances are built on the meridian, where one degree of
// latitude is exactly 6371000 x pi / 180 = 111194.927 metres in the formula the route tracking uses. No database, no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'visit-place-')), seen = new Set();
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
function compile(relative) {
  if (seen.has(relative)) return; seen.add(relative);
  const src = path.join(root, relative), dest = path.join(out, relative.replace(/\.tsx?$/, '.mjs')); fs.mkdirSync(path.dirname(dest), {recursive: true});
  let code = ts.transpileModule(fs.readFileSync(src, 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
  code = code.replace(/from (['"])([^'"]+)\1/g, (match, quote, imported) => {
    if (!imported.startsWith('.')) return match;
    let child = path.relative(root, path.resolve(path.dirname(src), imported));
    if (!/\.tsx?$/.test(child)) child += fs.existsSync(path.join(root, child + '.ts')) ? '.ts' : '.tsx';
    compile(child); return 'from ' + JSON.stringify(path.join(out, child.replace(/\.tsx?$/, '.mjs')));
  });
  fs.writeFileSync(dest, code);
}
compile('lib/visit-place.ts');
const P = await import(path.join(out, 'lib/visit-place.mjs'));
// The English dictionary's own translation function, with the dictionary read from its file.
const dictionary = fs.readFileSync(path.join(root, 'lib/locales/en.json'), 'utf8');
const i18nCode = ts.transpileModule(fs.readFileSync(path.join(root, 'lib/i18n.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
fs.writeFileSync(path.join(out, 'i18n.mjs'), i18nCode);
const {translateText, installEnglish} = await import(path.join(out, 'i18n.mjs'));
installEnglish(JSON.parse(dictionary)); // downloaded on demand in the app; handed over here

let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };

const DEGREE = 6371000 * Math.PI / 180;
const customer = {latitude: 24.7136, longitude: 46.6753};
// A fix this many metres due north of the customer, with the phone's accuracy.
const fix = (meters, accuracy = 0) => ({latitude: customer.latitude + meters / DEGREE, longitude: customer.longitude, accuracy});
const round = value => Math.round(value * 10) / 10;

// ---- how far the phone's own accuracy lets the point stray
eq([P.VISIT_PLACE_METERS, P.VISIT_PLACE_ACCURACY_ALLOWANCE, P.VISIT_PLACE_MAX_ACCURACY], [300, 100, 300], 'the three limits');
eq([0, 40, 100, 250, 1000, -5, NaN].map(P.visitPlaceAllowed), [300, 340, 400, 400, 400, 300, 300], 'an accuracy of 40 adds 40 metres, 100 and more add 100, a negative or unreadable one adds nothing');

// ---- near and far
let r = P.visitPlaceCheck(customer, fix(299.9));
eq([r.ok, r.reason, round(r.distance), r.allowed], [true, 'near', 299.9, 300], '299.9 metres from the customer is at the customer');
r = P.visitPlaceCheck(customer, fix(300.5));
eq([r.ok, r.reason, round(r.distance), r.allowed, r.accuracy], [false, 'far', 300.5, 300, 0], '300.5 metres is not, and the refusal carries the figures');
eq([P.visitPlaceCheck(customer, fix(339, 40)).ok, P.visitPlaceCheck(customer, fix(341, 40)).ok], [true, false], 'an accuracy of 40 makes 339 metres fine and 341 too far');
eq([P.visitPlaceCheck(customer, fix(399, 250)).ok, P.visitPlaceCheck(customer, fix(401, 250)).ok], [true, false], 'an accuracy of 250 adds only 100: 399 metres fine, 401 too far');
r = P.visitPlaceCheck(customer, fix(380, 300));
eq([r.ok, r.reason], [true, 'near'], 'an accuracy of exactly 300 is still judged: 380 metres is within 400');
r = P.visitPlaceCheck(customer, fix(0, 20));
eq([r.ok, r.reason, round(r.distance)], [true, 'near', 0], 'standing on the customer');
// East-west: a degree of longitude at 24.7136 degrees north is 111194.927 x cos(24.7136 deg) = 101010 metres, so 0.003 degrees is 303.03.
const east = accuracy => ({latitude: customer.latitude, longitude: customer.longitude + 0.003, accuracy});
r = P.visitPlaceCheck(customer, east(0));
eq([r.ok, round(r.distance)], [false, 303], 'east-west distances use the same formula: 0.003 degrees of longitude is 303.0 metres, past the 300 allowed at accuracy 0');
eq(P.visitPlaceCheck(customer, east(10)).ok, true, 'and inside the 310 allowed at accuracy 10');

// ---- a fix too weak to judge
r = P.visitPlaceCheck(customer, fix(100, 301));
eq([r.ok, r.reason, r.accuracy], [false, 'uncertain', 301], 'an accuracy of 301 says too little: neither accepted nor refused as far');
r = P.visitPlaceCheck(customer, fix(700, 450));
eq([r.ok, r.reason], [false, 'uncertain'], 'weak, and 700 minus 450 leaves 250, inside the 400 allowed: still uncertain');
r = P.visitPlaceCheck(customer, fix(5000, 450));
eq([r.ok, r.reason], [false, 'far'], 'weak, but 5000 minus 450 is far outside the 400 allowed: clearly away');

// ---- arrival the route tracking confirmed, and customers with no place of their own
r = P.visitPlaceCheck(customer, fix(5000, 10), {journeyArrived: true});
eq([r.ok, r.reason, Math.round(r.distance)], [true, 'journey', 5000], 'arrival already confirmed settles it, wherever the fix is');
r = P.visitPlaceCheck(customer, fix(100, 500), {journeyArrived: true});
eq([r.ok, r.reason], [true, 'journey'], 'even a weak fix');
for (const empty of [{}, {location: ''}, {location: 'الدمام، حي الفيحاء'}, {latitude: 0, longitude: 0}, {latitude: null, longitude: null, location: ''}]) {
  r = P.visitPlaceCheck(empty, fix(5000, 10));
  eq([r.ok, r.reason, r.distance], [true, 'no_customer_location', null], 'a customer with no point has nothing to be far from: ' + JSON.stringify(empty));
}
r = P.visitPlaceCheck({location: '24.7136, 46.6753'}, fix(5000, 10));
eq([r.ok, r.reason], [false, 'far'], 'a point written only as the customer\'s location text counts');
r = P.visitPlaceCheck({latitude: 24.7136, longitude: 46.6753, location: 'not used'}, fix(10, 5));
eq([r.ok, r.reason], [true, 'near'], 'numbers win over text');

// ---- the words of the refusal
const far = {ok: false, reason: 'far', distance: 1823.4, allowed: 320, accuracy: 20.4};
const weak = {ok: false, reason: 'uncertain', distance: 100, allowed: 400, accuracy: 450.2};
const farAr = 'لا يمكن تسجيل الزيارة إلا عند العميل. أنت على بعد 1823 متر من موقع «مصنع الأمل» (الدقة ±20 متر). انتقل إلى موقع العميل ثم اضغط تحديث موقع الجهاز.';
const farEn = 'A visit can only be recorded at the customer\'s place. You are 1823 meters from «مصنع الأمل» (accuracy ±20 meters). Go to the customer\'s place, then tap Refresh device location.';
const weakAr = 'دقة الموقع ضعيفة (±450 متر) فلا يمكن التأكد أنك عند «مصنع الأمل». اخرج إلى مكان مكشوف أو شغّل GPS ثم اضغط تحديث موقع الجهاز.';
const weakEn = 'The location accuracy is weak (±450 meters), so it cannot be confirmed that you are at «مصنع الأمل». Go outdoors or turn on GPS, then tap Refresh device location.';
eq([P.visitPlaceMessage(far, 'مصنع الأمل'), P.visitPlaceMessage(far, 'مصنع الأمل', 'en')], [farAr, farEn], 'the refusal for a far visit, in both languages, with whole metres');
eq([P.visitPlaceMessage(weak, 'مصنع الأمل'), P.visitPlaceMessage(weak, 'مصنع الأمل', 'en')], [weakAr, weakEn], 'the refusal for a weak fix, in both languages');
eq([P.visitPlaceMessage(far, '').includes('«العميل»'), P.visitPlaceMessage(far, '', 'en').includes('«the customer»')], [true, true], 'a customer without a name is still named');
eq([translateText(farAr, 'en'), translateText(weakAr, 'en')], [farEn, weakEn], 'the Arabic words the server sends read in English through the dictionary\'s patterns, the name and the figures kept');
eq(translateText(farAr, 'ar'), farAr, 'and are untouched in Arabic');
eq([translateText('على بعد 1823 متر والمسموح 320 متر', 'en'), translateText('محاولة تسجيل زيارة بعيدة عن العميل', 'en'), translateText('تسجيل موقع العميل من زيارة', 'en')], ['1823 meters away; 320 meters allowed', 'Attempt to record a visit away from the customer', 'Customer location recorded from a visit'], 'so do the lines the refusal and the adopted place leave in the customer\'s history');

// ---- the line beside a saved visit
eq([P.visitPlaceNote({placeOutside: true, placeDistance: 1823.4}), P.visitPlaceNote({placeOutside: true, placeDistance: 1823.4}, 'en'), P.visitPlaceNote({placeOutside: true}), P.visitPlaceNote({placeDistance: 120.2}), P.visitPlaceNote({placeDistance: 120.2}, 'en'), P.visitPlaceNote({}), P.visitPlaceNote({placeDistance: 'x'})],
  ['سُجّلت بعيدًا عن العميل · 1823 م', 'Recorded away from the customer · 1823 m', 'سُجّلت بعيدًا عن العميل', 'على بعد 120 م من العميل', '120 m from the customer', '', ''], 'away with its distance, away alone, near, and nothing');
console.log(JSON.stringify({ok: true, checks, pureFunctions: true, productionDataUsed: false}));
