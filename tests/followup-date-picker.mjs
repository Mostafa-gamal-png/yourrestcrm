// «اختيار موعد المتابعة» without a build (GSCO 2.13.84, 2026-11-19; lib/followup-day-picker.ts, app/followup-date-picker.tsx):
// 1. Distances (haversine) and the 2 km and 5 km edges; the areas (single-linkage chains of 2 km); the 14 Riyadh days from tomorrow across
//    midnight, a month, a year and a leap day; the weekly day off (Friday).
// 2. Which follow-ups count (the follow-ups page's plans: open or kept for a re-contact, with a next action and a real date, of the
//    customer's representative; one a customer; the customer being visited left out, so it is never counted twice), full days (6, not 5),
//    near ones, scattered days, a customer without a pin (counts only).
// 3. The suggestion's order (most near, then fewest areas, then the earliest; never a full day or the day off; else the lightest day; none
//    when every day is full or off) and the verdict of a chosen day (scattered before near, far past 5 km with the most common city, else
//    the region; nothing between 2 and 5 km or without a pin).
// 4. The words in Modern Standard Arabic and in English (no Arabic in English when the data has none), the supervisor's view of a
//    representative's follow-ups, Arabic number agreement.
// 5. The picker drawn by React (server rendering) in Arabic and English: a radio group of 14 days named for a screen reader, the day off,
//    the full and the scattered day marked, the suggestion, «تاريخ آخر» closed while the value is one of the 14 days and the date field
//    open otherwise (empty, today, a problem), the plain field kept where the grid is off (customer service, a visit read only).
// Made-up people and places only; no network, no database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

// The clock is fixed (Thursday 19 November 2026, 12:00 in Riyadh) for what reads «today» (the picker drawn): no check depends on the day the
// test runs. Every rule is also tried on dates passed to it.
const NativeDate = Date, clock = NativeDate.parse('2026-11-19T09:00:00.000Z');
globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } };
const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'followup-date-picker-')), seen = new Set();
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const counts = {};
const part = async (name, fn) => { const before = checks; await fn(); counts[name] = checks - before; };

// The page's language for the drawing (the real lib/i18n.ts draws Arabic on a server); the dictionary is the real one.
fs.writeFileSync(path.join(out, 'i18n.mjs'), `import fs from 'node:fs';const en=JSON.parse(fs.readFileSync(${JSON.stringify(path.join(root, 'lib/locales/en.json'))},'utf8'));
export const useLanguage=()=>({language:globalThis.pickerLanguage||'ar',setLanguage(){}});export const getLanguage=()=>globalThis.pickerLanguage||'ar';
export const direction=()=>getLanguage()==='ar'?'rtl':'ltr';export function t(value){return typeof value==='string'&&getLanguage()==='en'&&/[\\u0600-\\u06ff]/.test(value)?(en[value.trim()]??value):value;}`);
function compile(relative) {
  if (seen.has(relative)) return; seen.add(relative);
  const src = path.join(root, relative), dest = path.join(out, relative.replace(/\.tsx?$/, '.mjs'));
  fs.mkdirSync(path.dirname(dest), {recursive: true});
  let code = ts.transpileModule(fs.readFileSync(src, 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  code = code.replace(/^import ['"][^'"]+\.css['"];?$/gm, '').replace(/^['"]use client['"];?/m, '');
  code = code.replace(/from (['"])([^'"]+)\1/g, (match, q, imp) => {
    if (imp === '@/lib/i18n' || imp === './i18n') return 'from ' + JSON.stringify(path.join(out, 'i18n.mjs'));
    if (!imp.startsWith('.') && !imp.startsWith('@/')) return match;
    let source = imp.startsWith('@/') ? imp.slice(2) : path.relative(root, path.resolve(path.dirname(src), imp));
    if (!/\.tsx?$/.test(source)) source += fs.existsSync(path.join(root, source + '.ts')) ? '.ts' : '.tsx';
    compile(source);
    return 'from ' + JSON.stringify(path.join(out, source.replace(/\.tsx?$/, '.mjs')));
  });
  fs.writeFileSync(dest, code);
}
compile('lib/followup-day-picker.ts');
const P = await import(pathToFileURL(path.join(out, 'lib/followup-day-picker.mjs')));

// Made-up places: a customer in Dammam and points north of it at a given distance (1 degree of latitude = 6371 x pi / 180 km).
const KM = 6371 * Math.PI / 180, HERE = {latitude: 26.4207, longitude: 50.0888};
const north = (km, from = HERE) => ({latitude: from.latitude + km / KM, longitude: from.longitude});
const east = (km, from = HERE) => ({latitude: from.latitude, longitude: from.longitude + km / (KM * Math.cos(from.latitude * Math.PI / 180))});
const created = '2026-11-01T08:00:00.000Z';
const customer = (id, assignedTo, point, extra = {}) => ({id, kind: 'customer', parentId: null, assignedTo, branch: 'الرئيسي', version: 1, createdAt: created, updatedAt: created,
  data: {name: 'عميل ' + id, code: id, city: 'الدمام', region: 'الشرقية', ...(point ? {latitude: point.latitude, longitude: point.longitude, location: point.latitude.toFixed(7) + ', ' + point.longitude.toFixed(7)} : {}), ...extra}});
let visitNo = 0;
const visit = (customerId, data, at = created) => ({id: 'v' + (++visitNo), kind: 'activity', parentId: customerId, assignedTo: 'rep', branch: 'الرئيسي', version: 1, createdAt: at, updatedAt: at,
  data: {visitWorkflow: 'customer-v1', type: 'visit', date: at.slice(0, 10), summary: 'تعريف بمنتجات الشركة', result: 'متابعة العميل', salesStage: 'new', nextAction: 'اتصال', performedBy: 'rep', ...data}});

await part('distances, areas and days', async () => {
  eq(P.haversineKm(HERE, HERE), 0, 'the same point: 0 km');
  ok(Math.abs(P.haversineKm({latitude: 0, longitude: 0}, {latitude: 1, longitude: 0}) - 111.19493) < 0.0001, 'one degree of latitude: 111.195 km on a sphere of 6371 km');
  const riyadh = {latitude: 24.7136, longitude: 46.6753}, jeddah = {latitude: 21.4858, longitude: 39.1925};
  ok(Math.abs(P.haversineKm(riyadh, jeddah) - P.haversineKm(jeddah, riyadh)) < 1e-9, 'symmetric');
  ok(P.haversineKm(riyadh, jeddah) > 840 && P.haversineKm(riyadh, jeddah) < 860, 'Riyadh to Jeddah: about 849 km (' + P.haversineKm(riyadh, jeddah).toFixed(1) + ')');
  ok(Math.abs(P.haversineKm(HERE, east(3)) - 3) < 0.01, 'a point 3 km east is 3 km away');
  eq([P.NEAR_KM, P.FAR_KM, P.FULL_DAY_LIMIT, P.SCATTERED_AREAS, P.PICKER_DAYS], [2, 5, 5, 3, 14], 'near 2 km, far past 5 km, full past 5, scattered from 3 areas, 14 days');
  eq([P.areaCount([]), P.areaCount([HERE]), P.areaCount([HERE, north(1.99)]), P.areaCount([HERE, north(2.01)])], [0, 1, 1, 2], 'areas: none, one, two points 1.99 km apart are one area, 2.01 km apart two');
  eq(P.areaCount([HERE, north(1.5), north(3)]), 1, 'single linkage: A–B 1.5 km and B–C 1.5 km make one area though A–C is 3 km');
  eq(P.areaCount([north(3), HERE, north(1.5)]), 1, 'whatever the order');
  eq(P.areaCount([HERE, north(10), north(20)]), 3, 'three places 10 km apart: three areas');
  eq(P.areaCount([HERE, north(0.5), east(0.4), north(10), north(10.5), east(30)]), 3, 'two groups and a lone point: three areas');
  const days = P.pickerDates('2026-11-19');
  eq([days.length, days[0], days.at(-1)], [14, '2026-11-20', '2026-12-03'], 'the 14 days from tomorrow, across the end of a month');
  ok(days.every((day, i) => i === 0 || Date.parse(day) - Date.parse(days[i - 1]) === 86400000), 'consecutive days');
  eq([P.pickerDates(new Date('2026-11-19T20:59:59.999Z'))[0], P.pickerDates(new Date('2026-11-19T21:00:00.000Z'))[0]], ['2026-11-20', '2026-11-21'], 'a moment is read on the Riyadh clock: 23:59:59 there is still the 19th, 00:00 is the 20th');
  eq(P.pickerDates(Date.parse('2026-12-24T22:00:00.000Z')).at(-1), '2027-01-08', 'across the end of a year (01:00 on 25 December in Riyadh)');
  ok(P.pickerDates('2028-02-27').includes('2028-02-29'), 'a leap day');
  eq([P.addDays('2026-11-30', 1), P.addDays('2026-03-01', -1), P.addDays('2026-02-30', 1), P.addDays('', 1)], ['2026-12-01', '2026-02-28', '', ''], 'adding days; not a day: nothing');
  const off = days.filter(day => P.dayStats(day, [], null).offDay);
  eq(off, ['2026-11-20', '2026-11-27'], 'the weekly day off: the two Fridays of the 14 days');
});

await part('which follow-ups count', async () => {
  const records = [
    customer('c1', 'rep', north(1)), visit('c1', {nextDate: '2026-11-22'}),
    customer('c2', 'rep', north(1)), visit('c2', {nextDate: '2026-11-22', salesStage: 'won'}),
    customer('c3', 'rep', north(1)), visit('c3', {nextDate: '2026-11-22', salesStage: 'lost', recontact: true, nextAction: 'إعادة التواصل'}),
    customer('c4', 'rep', north(1)), visit('c4', {nextDate: '2026-11-22', nextAction: '  '}),
    customer('c5', 'rep2', north(1)), visit('c5', {nextDate: '2026-11-22'}),
    customer('c6', 'rep', north(1)), visit('c6', {nextDate: '2026-11-23'}, '2026-11-02T08:00:00.000Z'), visit('c6', {nextDate: '2026-11-24'}, '2026-11-03T08:00:00.000Z'),
    customer('c7', 'rep', north(1)), {id: 'opp7', kind: 'opportunity', parentId: 'c7', assignedTo: 'rep', branch: 'الرئيسي', version: 1, createdAt: created, updatedAt: '2026-11-05T08:00:00.000Z', data: {hasRequest: true, moldType: 'قالب', product: 'بلوك', dimensions: '40', quantity: 1, stage: 'quoted', nextAction: 'متابعة العرض', nextDate: '2026-11-22'}},
    customer('c8', 'rep', north(1)), visit('c8', {nextDate: 'غدًا'}),
    customer('c9', 'rep', north(1)), {id: 'opp9', kind: 'opportunity', parentId: 'c9', assignedTo: 'rep', branch: 'الرئيسي', version: 1, createdAt: created, updatedAt: '2026-11-05T08:00:00.000Z', data: {hasRequest: false, followupTitle: 'متابعة', followupStatus: 'closed', stage: 'new', quantity: 1, nextAction: 'اتصال', nextDate: '2026-11-22'}},
    customer('c10', 'rep', north(1)), visit('c10', {nextDate: '٢٠٢٦-١١-٢٢'}),
    customer('c11', 'rep', null)
  ];
  const mine = P.ownerFollowups(records, 'rep');
  eq(mine.map(item => item.customerId).sort(), ['c1', 'c10', 'c3', 'c6', 'c7'], 'open plans with a next action and a real date (Arabic digits read), a lost one kept for a re-contact, an opportunity; not won, not without an action, not another representative\'s, not a closed thread, not «غدًا»');
  eq(mine.find(item => item.customerId === 'c6').date, '2026-11-24', 'one a customer: its latest plan (the earlier visit\'s date no longer counts)');
  eq(mine.find(item => item.customerId === 'c10').date, '2026-11-22', 'the date read as a day');
  eq(P.ownerFollowups(records, 'rep2').map(item => item.customerId), ['c5'], 'a supervisor reading the representative rep2: rep2\'s');
  eq(P.ownerFollowups(records, 'rep', 'c1').map(item => item.customerId).sort(), ['c10', 'c3', 'c6', 'c7'], 'the customer being visited is left out');
  eq([P.ownerFollowups(records, ''), P.ownerFollowups([], 'rep')], [[], []], 'nobody, or no records: nothing');
  const view = P.pickerView(records, {ownerId: 'rep', customer: records[0], today: '2026-11-19'});
  eq(view.days.find(day => day.date === '2026-11-22').count, 3, 'the 22nd for c1\'s visit: c3, c7 and c10 (c1\'s own date is not counted with it)');
  const again = P.pickerView(records, {ownerId: 'rep', customer: records.find(row => row.id === 'c11'), today: '2026-11-19'});
  eq(again.days.find(day => day.date === '2026-11-22').count, 4, 'for another customer c1 counts too: counted once, wherever the record being edited stands');
  eq([again.here, again.days.find(day => day.date === '2026-11-22').near, again.days.find(day => day.date === '2026-11-22').nearestKm], [null, 0, null], 'a customer without a pin: counts only');
  ok(view.days.every(day => day.date > '2026-11-19'), 'today is not in the grid');
});

await part('a day: full, near, scattered, far', async () => {
  const at = (point, extra = {}) => ({customerId: 'x', date: '2026-11-22', point, city: 'الدمام', region: 'الشرقية', ...extra});
  eq(P.dayStats('2026-11-22', Array.from({length: 5}, () => at(HERE)), HERE).full, false, '5 follow-ups: not full');
  const six = P.dayStats('2026-11-22', Array.from({length: 6}, () => at(north(30))), HERE);
  eq([six.count, six.full, six.near, six.areas, six.scattered], [6, true, 0, 1, false], '6 follow-ups: full');
  const near = P.dayStats('2026-11-22', [at(north(1.99)), at(north(2.01)), at(north(0.2)), at(null)], HERE);
  eq([near.count, near.near, near.areas], [4, 2, 1], 'near: within 2 km (1.99 and 0.2 yes, 2.01 no); a follow-up with no pin is counted and has no place; the three located ones chain into one area');
  const scattered = P.dayStats('2026-11-22', [at(north(0.5)), at(north(15)), at(east(30))], HERE);
  eq([scattered.areas, scattered.scattered, scattered.near], [3, true, 1], 'three areas: scattered');
  eq(P.dayVerdict(scattered), {kind: 'scattered', areas: 3, near: 1}, 'a scattered day is said so first, with how many are near');
  eq(P.dayVerdict(near), {kind: 'near', near: 2}, 'a near day');
  const far = P.dayStats('2026-11-22', [at(north(12), {city: 'الخبر'}), at(north(12.5), {city: 'الخبر'}), at(north(13), {city: 'الظهران'})], HERE);
  eq(P.dayVerdict(far), {kind: 'far', km: 12, place: 'الخبر', placeKind: 'city'}, 'far: the nearest is 12 km away, in the most common city');
  const region = P.dayStats('2026-11-22', [at(east(7.26), {city: '', region: 'المنطقة الشرقية'}), at(east(8), {city: '', region: 'الشرقية'})], HERE);
  eq(P.dayVerdict(region), {kind: 'far', km: 7.3, place: 'الشرقية', placeKind: 'region'}, 'no city: the region (with or without «المنطقة»); under 10 km one decimal');
  eq([P.dayVerdict(P.dayStats('2026-11-22', [at(north(5))], HERE)), P.dayVerdict(P.dayStats('2026-11-22', [at(north(3))], HERE))], [{kind: 'none'}, {kind: 'none'}], 'between 2 and 5 km (and exactly 5): nothing to say');
  eq(P.dayVerdict(P.dayStats('2026-11-22', [at(north(1))], null)), {kind: 'none'}, 'no pin: nothing');
  eq(P.dayVerdict(P.dayStats('2026-11-22', [], HERE)), {kind: 'none'}, 'no follow-up: nothing');
  eq(P.dayStats('2026-11-22', [at(north(0.5)), at(north(15)), at(east(30))], null).scattered, false, 'no pin: not scattered either (counts only)');
});

await part('the suggestion', async () => {
  const day = (date, fields) => ({date, offDay: false, count: 0, full: false, near: 0, areas: 0, scattered: false, nearestKm: null, place: '', placeKind: '', ...fields});
  eq(P.bestDay([day('2026-11-21', {count: 2, near: 2, areas: 2}), day('2026-11-22', {count: 3, near: 2, areas: 1}), day('2026-11-23', {count: 6, full: true, near: 4, areas: 1}), day('2026-11-24', {count: 1, near: 1, areas: 1})]).date, '2026-11-22', 'the most near ones; a tie goes to the fewest areas; never a full day');
  eq(P.bestDay([day('2026-11-23', {count: 2, near: 2, areas: 1}), day('2026-11-22', {count: 4, near: 2, areas: 1})]).date, '2026-11-22', 'then the earliest');
  eq(P.bestDay([day('2026-11-27', {offDay: true, count: 3, near: 3, areas: 1}), day('2026-11-28', {count: 1, near: 1, areas: 1})]).date, '2026-11-28', 'never the weekly day off');
  eq(P.bestDay([day('2026-11-21', {count: 3}), day('2026-11-22', {count: 1}), day('2026-11-23', {count: 1}), day('2026-11-27', {offDay: true})]).date, '2026-11-22', 'no near one: the lightest day that is not off, then the earliest');
  eq(P.bestDay([day('2026-11-21', {count: 6, full: true}), day('2026-11-27', {offDay: true})]), null, 'every day full or off: no suggestion');
  eq(P.bestDay([]), null, 'no days: none');
});

await part('words', async () => {
  eq([0, 1, 2, 3, 10, 11, 103].map(n => P.countPhrase(n, 'ar')), ['لا متابعات', 'متابعة واحدة', 'متابعتان', '3 متابعات', '10 متابعات', '11 متابعة', '103 متابعات'], 'Arabic number agreement');
  eq([1, 2, 3, 12].map(n => P.nearPhrase(n, 'ar')), ['متابعة واحدة قريبة', 'متابعتان قريبتان', '3 متابعات قريبة', '12 متابعة قريبة'], 'and near ones');
  eq([0, 1, 3].map(n => P.countPhrase(n, 'en')), ['no follow-ups', '1 follow-up', '3 follow-ups'], 'English counts');
  eq([P.dayTitle('2026-11-22', 'ar', '2026-11-19'), P.dayTitle('2026-11-22', 'en', '2026-11-19'), P.dayTitle('2027-01-02', 'ar', '2026-12-30')], ['الأحد 22 نوفمبر', 'Sunday 22 November', 'السبت 2 يناير 2027'], 'a day\'s title, the year when it is not this one');
  eq([P.weekdayShort('2026-11-20', 'ar'), P.weekdayShort('2026-11-20', 'en'), P.dayMonth('2026-11-02')], ['جمعة', 'Fri', '2/11'], 'the grid\'s weekday and day/month');
  const ar = P.pickerWords('ar', '', '2026-11-19'), en = P.pickerWords('en', '', '2026-11-19');
  const best = {date: '2026-11-22', offDay: false, count: 4, full: false, near: 3, areas: 1, scattered: false, nearestKm: 0.5, place: 'الدمام', placeKind: 'city'};
  eq(ar.best(best), 'الأنسب: الأحد 22 نوفمبر — 3 متابعات قريبة من هذا العميل', 'the banner, as GSCO writes it with Yourrest\'s noun');
  eq(en.best(best), 'Best: Sunday 22 November — 3 follow-ups near this customer', 'in English');
  eq([ar.best({...best, near: 0, count: 0}), ar.best({...best, near: 0, count: 2})], ['الأنسب: الأحد 22 نوفمبر — لا متابعات لديك فيه', 'الأنسب: الأحد 22 نوفمبر — أخف أيامك: متابعتان'], 'the lightest day when none is near');
  eq(ar.verdict({kind: 'near', near: 2}), 'يوم مناسب: لديك متابعات قريبة من هذا العميل.', 'near');
  eq(ar.verdict({kind: 'far', km: 12, place: 'الخبر', placeKind: 'city'}), 'متابعاتك في هذا اليوم في الخبر، بعيدًا عن هذا العميل (12 كم).', 'far, with the city');
  eq(ar.verdict({kind: 'far', km: 7.3, place: 'الشرقية', placeKind: 'region'}), 'متابعاتك في هذا اليوم في المنطقة الشرقية، بعيدًا عن هذا العميل (7.3 كم).', 'far, with the region');
  eq(ar.verdict({kind: 'far', km: 9, place: '', placeKind: ''}), 'متابعاتك في هذا اليوم بعيدة عن هذا العميل (9 كم).', 'far, nowhere named');
  eq([0, 1, 2, 4].map(n => ar.verdict({kind: 'scattered', areas: 3, near: n})), ['متابعاتك في هذا اليوم متفرقة في 3 مناطق، ولا واحدة منها قريبة من هذا العميل.', 'متابعاتك في هذا اليوم متفرقة في 3 مناطق، منها واحدة قريبة من هذا العميل.', 'متابعاتك في هذا اليوم متفرقة في 3 مناطق، منها اثنتان قريبتان من هذا العميل.', 'متابعاتك في هذا اليوم متفرقة في 3 مناطق، منها 4 قريبة من هذا العميل.'], 'scattered, with how many are near');
  eq(ar.verdict({kind: 'scattered', areas: 11, near: 3}), 'متابعاتك في هذا اليوم متفرقة في 11 منطقة، منها 3 قريبة من هذا العميل.', '11 areas: «11 منطقة»');
  eq(ar.full(6), 'هذا اليوم ممتلئ: 6 متابعات (الحد 5). يمكنك اختياره رغم ذلك.', 'a full day: a warning, the day can still be chosen');
  eq(ar.off('2026-11-27'), 'هذا اليوم إجازة أسبوعية (الجمعة). يمكنك اختياره رغم ذلك.', 'the day off');
  eq([ar.chosen('2026-11-22'), ar.chosen('2026-11-19'), ar.chosen('')], ['الموعد المختار: الأحد 22 نوفمبر', 'الموعد المختار: الخميس 19 نوفمبر (اليوم)', 'لم يُحدَّد الموعد بعد.'], 'the chosen date');
  eq(ar.dayLabel({...best, full: false, scattered: true, offDay: false}, true), 'الأحد 22 نوفمبر: 4 متابعات، 3 متابعات قريبة من هذا العميل، متفرق، الأنسب', 'what a screen reader hears of a day');
  eq([en.verdict({kind: 'near', near: 1}), en.verdict({kind: 'far', km: 12, place: 'Khobar', placeKind: 'city'}), en.verdict({kind: 'scattered', areas: 3, near: 1}), en.full(6), en.off('2026-11-27')],
    ['A good day: you have follow-ups near this customer.', 'Your follow-ups on this day are in Khobar, far from this customer (12 km).', 'Your follow-ups on this day are spread across 3 areas; 1 of them is near this customer.', 'This day is full: 6 follow-ups (the limit is 5). You can still choose it.', 'This day is the weekly day off (Friday). You can still choose it.'], 'English');
  const ARABIC = /[؀-ۿ]/, sample = {...best, place: 'Khobar', full: true, scattered: true, offDay: true};
  const english = [en.gridLabel, en.otherDate, en.choose, en.offTag, en.fullTag, en.scatteredTag, en.nearTag(2), en.legend(true), en.legend(false), en.best(sample), en.best({...sample, near: 0}), en.dayLabel(sample, true), en.chosen('2026-11-22'), en.chosen(''),
    en.verdict({kind: 'scattered', areas: 4, near: 0}), en.verdict({kind: 'far', km: 9, place: '', placeKind: ''})];
  ok(english.every(text => !ARABIC.test(text)), 'no Arabic in the English words: ' + english.filter(text => ARABIC.test(text)).join(' | '));
  // A supervisor editing a representative's customer reads the representative's follow-ups by name.
  const sup = P.pickerWords('ar', 'أحمد المندوب', '2026-11-19'), supEn = P.pickerWords('en', 'Ahmad', '2026-11-19');
  eq([sup.verdict({kind: 'near', near: 1}), sup.verdict({kind: 'far', km: 12, place: 'الخبر', placeKind: 'city'}), sup.best({...best, near: 0, count: 0})],
    ['يوم مناسب: لدى أحمد المندوب متابعات قريبة من هذا العميل.', 'متابعات أحمد المندوب في هذا اليوم في الخبر، بعيدًا عن هذا العميل (12 كم).', 'الأنسب: الأحد 22 نوفمبر — لا متابعات لدى أحمد المندوب فيه'], 'the supervisor reads «لدى أحمد المندوب»');
  eq([supEn.verdict({kind: 'near', near: 1}), supEn.verdict({kind: 'scattered', areas: 3, near: 2})], ['A good day: Ahmad has follow-ups near this customer.', 'Ahmad\'s follow-ups on this day are spread across 3 areas; 2 of them are near this customer.'], 'and in English');
  ok(sup.legend(true).includes('متابعات أحمد المندوب'), 'the legend names whose follow-ups the numbers are');
});

await part('the picker drawn', async () => {
  compile('app/followup-date-picker.tsx');
  const require = createRequire(import.meta.url), React = require('react'), {renderToStaticMarkup} = require('react-dom/server');
  const {FollowupDatePicker} = await import(pathToFileURL(path.join(out, 'app/followup-date-picker.mjs')));
  const {today} = await import(pathToFileURL(path.join(out, 'lib/crm.mjs')));
  const day = today(), days = P.pickerDates(day), friday = days.find(date => new Date(date + 'T00:00:00Z').getUTCDay() === 5), working = days.filter(date => date !== friday && new Date(date + 'T00:00:00Z').getUTCDay() !== 5);
  const [fullDay, nearDay, scatteredDay] = working;
  const records = [customer('here', 'rep', HERE), customer('nopin', 'rep', null)];
  let n = 0;
  const plan = (point, date, extra = {}) => { const id = 'p' + (++n); records.push(customer(id, 'rep', point, extra), visit(id, {nextDate: date})); };
  for (let i = 0; i < 6; i++) plan(north(30 + i * 0.1), fullDay);
  plan(north(0.5), nearDay); plan(north(1), nearDay);
  plan(north(0.3), scatteredDay); plan(north(15), scatteredDay); plan(east(40), scatteredDay);
  const me = {id: 'rep', name: 'أحمد المندوب', role: 'rep', email: 'rep@yourrest.org', branch: 'الرئيسي', active: 1, target: 0};
  const draw = (props, language = 'ar') => { globalThis.pickerLanguage = language; try { return renderToStaticMarkup(React.createElement(FollowupDatePicker, {value: '', onChange() {}, records, customerId: 'here', me, id: 'visit-next-date', ...props})); } finally { globalThis.pickerLanguage = 'ar'; } };
  let html = draw({value: nearDay});
  eq((html.match(/role="radio"/g) || []).length, 14, 'fourteen days');
  ok(html.includes('role="radiogroup" aria-label="الأيام الأربعة عشر القادمة"'), 'a radio group named for a screen reader');
  eq((html.match(/aria-checked="true"/g) || []).length, 1, 'the chosen day is checked');
  ok(html.includes('data-date="' + nearDay + '" data-near="2"') && html.includes('📍 2 قريبة'), 'the near day says «📍 2 قريبة»');
  ok(new RegExp('data-date="' + fullDay + '"[^>]*data-full="true"').test(html) && html.includes('>ممتلئ<'), 'the full day is marked «ممتلئ»');
  ok(new RegExp('data-date="' + scatteredDay + '"[^>]*data-scattered="true"').test(html) && html.includes('>متفرق<'), 'the scattered day «متفرق»');
  ok(new RegExp('data-date="' + friday + '" data-off="true"').test(html) && html.includes('>إجازة<'), 'the Friday «إجازة»');
  ok(html.includes('data-best-day="' + nearDay + '"') && html.includes('الأنسب: ' + P.dayTitle(nearDay, 'ar', day) + ' — متابعتان قريبتان من هذا العميل') && html.includes('>اختيار هذا اليوم<'), 'the suggestion: the near day, with «اختيار هذا اليوم»');
  ok(html.includes('يوم مناسب: لديك متابعات قريبة من هذا العميل.'), 'the chosen near day: a good day');
  ok(!html.includes('type="date"') && html.includes('>تاريخ آخر<') && html.includes('aria-expanded="false"'), 'a day of the grid chosen: the date field is behind «تاريخ آخر»');
  ok(html.includes('aria-label="' + P.dayTitle(nearDay, 'ar', day) + ': متابعتان، متابعتان قريبتان من هذا العميل، الأنسب"'), 'a day\'s name for a screen reader');
  ok(/role="status"/.test(html) && !/aria-live/.test(html), 'what the choice means is a status (no aria-live of its own)');
  html = draw({value: fullDay});
  ok(html.includes('هذا اليوم ممتلئ: 6 متابعات (الحد 5). يمكنك اختياره رغم ذلك.') && html.includes('متابعاتك في هذا اليوم في الدمام، بعيدًا عن هذا العميل'), 'the full day: the warning, and far');
  html = draw({value: scatteredDay});
  ok(html.includes('متابعاتك في هذا اليوم متفرقة في 3 مناطق، منها واحدة قريبة من هذا العميل.'), 'the scattered day');
  html = draw({value: friday});
  ok(html.includes('هذا اليوم إجازة أسبوعية (الجمعة). يمكنك اختياره رغم ذلك.'), 'the day off chosen: said so');
  for (const [value, why] of [['', 'empty'], [day, 'today'], ['2030-01-01', 'a later date']]) {
    html = draw({value});
    ok(html.includes('type="date"') && html.includes('id="visit-next-date"') && html.includes('>تاريخ آخر<') && !html.includes('visit-date-shortcuts'), why + ': the date field is open (labelled «تاريخ آخر», no shortcuts)');
    eq((html.match(/aria-checked="true"/g) || []).length, 0, why + ': no day of the grid checked');
  }
  ok(draw({value: ''}).includes('required=""'), 'the field keeps the browser\'s own check');
  html = draw({value: nearDay, problem: 'حدد موعد المتابعة قبل حفظ الفرصة.'});
  ok(html.includes('type="date"') && html.includes('id="visit-next-date-problem"') && html.includes('aria-invalid="true"'), 'a problem opens the field, with its words under it');
  html = draw({value: nearDay, min: working[3]});
  const opening = date => (html.match(new RegExp('<button[^>]*data-date="' + date + '"[^>]*>')) || [''])[0];
  ok(opening(nearDay).includes('disabled=""') && !opening(working[3]).includes('disabled=""'), 'a day before the form\'s own minimum cannot be chosen; the minimum itself can');
  html = draw({value: '', customerId: 'nopin'});
  ok(!html.includes('📍') && html.includes('لا موقع محفوظًا لهذا العميل') && !html.includes('data-scattered'), 'a customer without a pin: counts only');
  ok(html.includes('الأنسب: ') && html.includes(' — لا متابعات لديك فيه'), 'and the lightest day suggested');
  html = draw({value: nearDay, me: {...me, id: 'sup', name: 'المشرف', role: 'supervisor'}, members: [me]});
  ok(html.includes('يوم مناسب: لدى أحمد المندوب متابعات قريبة من هذا العميل.') && html.includes('عدد متابعات أحمد المندوب فيه'), 'a supervisor reads the representative\'s follow-ups');
  html = draw({value: nearDay}, 'en');
  ok(html.includes('Best: ' + P.dayTitle(nearDay, 'en', day) + ' — 2 follow-ups near this customer') && html.includes('A good day: you have follow-ups near this customer.') && html.includes('>Another date<') && html.includes('Next follow-up date'), 'English');
  const visible = html.replace(/<[^>]+>/g, ' ');
  ok(!/[؀-ۿ]/.test(visible.replaceAll('الدمام', '')), 'no Arabic in the English picker but the city as stored: ' + (visible.match(/[؀-ۿ][^<]*/g) || []).join(' | '));
  ok(draw({value: friday}, 'en').includes('This day is the weekly day off (Friday). You can still choose it.'), 'English day off');
  html = draw({value: nearDay, grid: false});
  ok(html.includes('type="date"') && !html.includes('role="radio"') && html.includes('visit-date-shortcuts') && html.includes('موعد المتابعة القادمة'), 'grid off (customer service, a visit read only): the field as it was, with its shortcuts');
  ok(draw({value: '', grid: false, label: 'موعد المتابعة'}, 'en').includes('Follow-up due date'), 'its label translated as before');
});

console.log(JSON.stringify({ok: true, checks, parts: counts}));
