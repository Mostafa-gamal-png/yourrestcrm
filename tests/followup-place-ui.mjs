// The place section of a follow-up that is a visit, with the real hook and the real component under controlled device callbacks: the
// point is taken once when the form is open and the kind is a visit, never for another kind or for customer service, a failure waits
// for the member instead of looping, a retry takes it again, a closed form ignores a late fix, and what the section reports against
// the customer's place is the rule of lib/visit-place.ts (held for a representative, only marked for the others, settled by arrival
// the route tracking confirmed). Render contracts with hand-driven hooks: no browser, no device.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';

const nativeRequire = createRequire(import.meta.url), root = process.cwd(), cache = new Map();
const compiler = {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true};
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {compilerOptions: compiler}).outputText;
let checks = 0, language = 'ar';
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const nodes = (tree, predicate) => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(node => nodes(node, predicate)) : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join('') : typeof tree.type === 'function' && tree.type.name === 'VisitPlaceStatus' ? '[' + tree.props.view.status + ']' : text(tree.props?.children);
const button = (tree, label) => nodes(tree, node => node.type === 'button' && text(node).trim() === label)[0];
// The pure modules are compiled as they are; the timers belong to the test.
function library(file, globals = {}) {
  const own = !!globals.setTimeout; // a module with its own timers is built afresh for every form
  if (!own && cache.has(file)) return cache.get(file);
  const exports = {}; if (!own) cache.set(file, exports);
  vm.runInNewContext(compile(file), {exports, require: name => name.startsWith('.') ? library(path.join(path.dirname(file), name) + '.ts') : nativeRequire(name), Date, Error, Math, Number, Intl, ...globals});
  return exports;
}
const Fake = name => Object.defineProperty(() => null, 'name', {value: name});
const customer = {id: 'factory', kind: 'customer', data: {name: 'Factory', location: '21.5, 39.2'}};
const position = (latitude, accuracy = 12) => ({coords: {latitude, longitude: 39.2, accuracy}, timestamp: Date.parse('2026-10-01T12:00:00Z')});
let tracker = null;

function setup(input, lang = 'ar') {
  const states = [], refs = [], deps = [], effects = [], cleanups = [], callbacks = [], timers = new Map(), fixes = [];
  let cursor = 0, refCursor = 0, effectCursor = 0, callbackCursor = 0, next = 0;
  const props = {enabled: true, customer, type: 'visit', role: 'rep', ...input};
  const geo = {getCurrentPosition: (success, error, options) => fixes.push({success, error, options})};
  const clocks = {setTimeout: (callback, delay) => { const id = ++next; timers.set(id, {callback, delay}); return id; }, clearTimeout: id => timers.delete(id)};
  const location = library('lib/visit-location.ts', clocks);
  const changed = (before, after) => !before || !after || before.length !== after.length || after.some((value, index) => !Object.is(value, before[index]));
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useRef(initial) { const index = refCursor++; return refs[index] || (refs[index] = {current: initial}); },
    useEffect(effect, nextDeps) { const index = effectCursor++; if (!deps[index] || changed(deps[index], nextDeps)) { deps[index] = nextDeps; effects.push({effect, index}); } },
    useCallback(fn, nextDeps) { const index = callbackCursor++; if (!callbacks[index] || changed(callbacks[index].deps, nextDeps)) callbacks[index] = {fn, deps: nextDeps}; return callbacks[index].fn; }
  };
  const exports = {};
  const require = name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? jsx : name === 'lucide-react' ? {Loader2: Fake('Loader2'), MapPin: Fake('MapPin')} : name === '@/lib/i18n' ? {t: value => language === 'en' && typeof value === 'string' ? value : value, useLanguage: () => ({language: lang})}
    : name === '@/lib/visit-location' ? location : name === '@/lib/visit-place' ? library('lib/visit-place.ts') : name === './visit-place-status' ? {__esModule: true, default: Fake('VisitPlaceStatus')} : name === './journey-tracker' ? {useJourneyTracker: () => ({active: tracker})} : (() => { throw Error('Unexpected import ' + name); })();
  vm.runInNewContext(compile('app/followup-place.tsx'), {exports, require, AbortController, navigator: {geolocation: geo}, window: clocks});
  let place;
  const render = () => {
    cursor = refCursor = effectCursor = callbackCursor = 0;
    place = exports.useFollowupPlace(props);
    const tree = exports.FollowupPlace({place, busy: !!props.busy});
    for (const {effect, index} of effects.splice(0)) { cleanups[index]?.(); cleanups[index] = effect(); }
    return tree;
  };
  // The form starts its capture from a zero-delay timer, after painting; this runs those and leaves the watchdog's own.
  const tick = () => { for (const [id, timer] of [...timers]) if (timer.delay === 0) { timers.delete(id); timer.callback(); } };
  return {props, fixes, timers, render, tick, place: () => place, unmount: () => cleanups.forEach(fn => fn?.())};
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

// A form as it stands once it has painted and started its capture.
const open = (input, lang) => { const form = setup(input, lang); form.render(); form.tick(); form.render(); return form; };
const again = form => { form.render(); form.tick(); return form.render(); };

// ---- the point is taken once, when the form is open and the kind is a visit
let h = setup(), tree = h.render();
eq(h.fixes.length, 0, 'nothing is taken before the form has painted');
h.tick(); tree = h.render();
eq(h.fixes.length, 1, 'a follow-up that is a visit takes the device\'s point as soon as the form is open');
eq(h.fixes[0].options.enableHighAccuracy, true, 'with a real fix, not a cached one');
ok(text(tree).includes('جارٍ تحديد الموقع'), 'and says it is taking it');
again(h); eq(h.fixes.length, 1, 'rendering again does not ask again');
h.fixes[0].success(position(21.5005)); await settle(); tree = again(h);
eq([h.place().fix.latitude, h.place().fix.locationSource, h.place().fix.locationAccuracy, h.place().fix.location], [21.5005, 'device', 12, '21.5005000, 39.2000000'], 'the point arrives as the visit\'s own fields');
eq([h.place().view.status, h.place().view.blocked], ['near', false], '55.6 metres from the customer is at the customer');
ok(text(tree).includes('تم تحديد الموقع تلقائيًا') && text(tree).includes('[near]') && !!button(tree, 'تحديث موقع الجهاز'), 'the section says it was captured, reports where it stands and offers to take it again');
eq(h.fixes.length, 1, 'a point already taken is not taken again');
button(tree, 'تحديث موقع الجهاز').props.onClick(); eq(h.fixes.length, 2, 'refreshing takes a new one');
h.fixes[1].success(position(21.52)); await settle(); tree = again(h);
eq([h.place().view.status, h.place().view.blocked, Math.round(h.place().view.distance)], ['far', true, 2224], 'now 2.2 km away: a representative is held');
ok(h.place().view.message.startsWith('لا يمكن تسجيل الزيارة إلا عند العميل'), 'with the words of the refusal');

// ---- the other kinds, customer service, and the others' roles
h = open({type: 'call'}); tree = h.render();
eq([h.fixes.length, h.place().wants, h.place().fix, tree], [0, false, null, null], 'a call has no place: nothing is taken and the section is not shown');
h.props.type = 'visit'; again(h); eq(h.fixes.length, 1, 'changing the kind to a visit takes the point then');
h.fixes[0].success(position(21.5005)); await settle(); again(h);
h.props.type = 'quote'; tree = again(h); eq([h.place().wants, h.place().fix, tree], [false, null, null], 'and changing it away hides the point already taken');
h = open({enabled: false}); eq(h.fixes.length, 0, 'customer service is never asked for a place');
h = open({role: 'supervisor'}); h.fixes[0].success(position(21.52)); await settle(); again(h);
eq([h.place().view.status, h.place().view.blocked, h.place().view.message.includes('تُوسم')], ['far', false, true], 'a supervisor away from the customer is not held: the visit is only marked');

// ---- arrival the route tracking confirmed
tracker = {customerId: 'factory', closedAt: null, data: {arrivalAt: '2026-10-01T08:59:00.000Z', departureAt: null}};
h = open(); h.fixes[0].success(position(21.52)); await settle(); again(h);
eq([h.place().view.status, h.place().view.blocked], ['journey', false], 'arrival confirmed at this customer settles it, wherever the fix is');
tracker = {...tracker, data: {...tracker.data, departureAt: '2026-10-01T09:30:00.000Z'}};
h = open(); h.fixes[0].success(position(21.52)); await settle(); again(h);
eq(h.place().view.status, 'far', 'a stop already left does not');
tracker = null;

// ---- failures wait for the member, and a closed form ignores a late fix
h = open(); h.fixes[0].error({code: 1}); await settle(); tree = again(h);
eq(h.fixes.length, 1, 'a refused permission does not loop');
ok(h.place().error.includes('السماح بالموقع مقفول') && text(tree).includes('يلزم السماح بالموقع لحفظ المتابعة'), 'it says what to do and that saving waits');
eq([h.place().fix, h.place().view.status], [null, 'idle'], 'and there is no point to judge');
button(tree, 'إعادة المحاولة').props.onClick(); eq(h.fixes.length, 2, 'the member\'s retry takes it again');
h.fixes[1].success(position(21.5005)); await settle(); tree = again(h);
eq([h.place().error, h.place().view.status], ['', 'near'], 'and clears the failure');
const late = open(); late.unmount(); late.fixes[0].success(position(21.5005)); await settle(); late.render();
eq(late.place().fix, null, 'a fix that arrives after the form closed is ignored');
h = open(); h.fixes[0].success(position(21.5005)); h.fixes[0].success(position(5)); await settle(); again(h);
eq(h.place().fix.latitude, 21.5005, 'a second callback of the same request cannot overwrite the first');
h = open(); for (const {callback} of [...h.timers.values()]) callback(); await settle(); again(h);
ok(h.place().error.includes('انتهت مهلة تحديد الموقع'), 'a device that never answers ends in the timeout message');
eq(h.fixes.length, 1, 'without asking again by itself');
const waiting = open(); const waitingTree = waiting.render();
eq(button(waitingTree, 'إعادة المحاولة'), undefined, 'while it is locating no retry button is offered');
console.log(JSON.stringify({ok: true, checks, coverage: 'the follow-up place section: one capture, kinds and roles, failure and retry, late fixes, tracker arrival', realBrowser: false, realDevice: false}));
