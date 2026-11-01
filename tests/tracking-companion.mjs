// A representative's second device (a tablet beside the work phone): when it is a companion that may work without recording,
// decided on the real module from what the server reports for today's day. No device, GPS, network or browser is involved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const store = new Map();
const window = {localStorage: {getItem: key => store.has(key) ? store.get(key) : null, setItem: (key, value) => { store.set(key, String(value)); }}};
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/tracking-companion.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {exports, window, Number, String});
const {companionDecision, readCompanionMemory, writeCompanionMemory, COMPANION_MEMORY_MS} = exports;
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message); checks++; };
const now = Date.parse('2026-11-01T08:00:00.000Z');
const base = {role: 'rep', native: true, ownDayId: null, serverDay: null, serverKnown: true, windowOpen: true, rememberedAt: null, now};
const decide = patch => companionDecision({...base, ...patch});
const yes = (remember = true) => ({companion: true, remember}), no = (remember = false) => ({companion: false, remember});

// During working hours: only a day being recorded right now by another device makes this one a companion.
eq(decide({serverDay: {id: 'phone-day', endedAt: null}}), yes(), 'Another device records today: companion, remembered');
eq(decide({serverDay: {id: 'phone-day', endedAt: null}, ownDayId: 'tablet-day'}), yes(), 'Even when this device has a day of its own');
eq(decide({serverDay: {id: 'own-day', endedAt: null}, ownDayId: 'own-day'}), no(), 'The day is this device\'s own: not a companion (its own tracking decides)');
eq(decide({serverDay: null}), no(), 'Nothing recorded (the other device went quiet, or never started): not a companion');
eq(decide({serverDay: {id: 'phone-day', endedAt: '2026-11-01T07:30:00.000Z'}}), no(), 'A closed day is not recording');
eq(decide({serverDay: null, rememberedAt: now - 60_000}), no(), 'During hours, memory alone never makes a companion');
// Outside working hours: another device recorded today, or this device was a companion within the last week.
eq(decide({windowOpen: false, serverDay: {id: 'phone-day', endedAt: '2026-11-01T15:00:00.000Z'}}), yes(), 'After 6 PM: the other device recorded today');
eq(decide({windowOpen: false, serverDay: {id: 'own-day', endedAt: '2026-11-01T15:00:00.000Z'}, ownDayId: 'own-day'}), no(), 'After 6 PM, the phone that recorded is not a companion');
eq(decide({windowOpen: false, rememberedAt: now - 2 * 24 * 3600_000}), yes(false), 'Friday or before 6 AM: a recent companion stays one');
eq(decide({windowOpen: false, rememberedAt: now - COMPANION_MEMORY_MS}), no(), 'Memory older than a week is forgotten');
eq(decide({windowOpen: false, rememberedAt: now + 60_000}), no(), 'A memory from the future is ignored');
eq(decide({windowOpen: false, rememberedAt: null}), no(), 'A device that never was a companion is gated as before');
// Never for anyone else, a browser, or before the server has answered.
for (const role of ['admin', 'manager', 'supervisor', 'customer_service', undefined]) eq(decide({role, serverDay: {id: 'phone-day', endedAt: null}}), no(), 'Not for role ' + role);
eq(decide({native: false, serverDay: {id: 'phone-day', endedAt: null}}), no(), 'A browser is never a companion');
eq(decide({serverKnown: false, serverDay: {id: 'phone-day', endedAt: null}}), no(), 'No decision before the server answers');

// The per-device memory survives storage being unavailable.
eq(readCompanionMemory('rep-1'), null, 'No memory yet');
writeCompanionMemory('rep-1', now);eq(readCompanionMemory('rep-1'), now, 'Remembered per member');eq(readCompanionMemory('rep-2'), null, 'Another member on the same device is separate');
store.set('yourrest-companion:rep-1', 'garbage');eq(readCompanionMemory('rep-1'), null, 'A damaged value is no memory');
window.localStorage.getItem = () => { throw new Error('blocked'); };window.localStorage.setItem = () => { throw new Error('blocked'); };
eq(readCompanionMemory('rep-1'), null, 'Blocked storage reads as no memory');writeCompanionMemory('rep-1', now);checks++;
console.log(JSON.stringify({ok: true, checks}));
