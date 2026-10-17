// Working hours between two instants (Saturday to Thursday, 08:00 to 18:00 in Riyadh, UTC+3): numbers worked out by hand, and
// the production function against a plain reference that asks the calendar for every day, over many random and edge-case spans.
// The production function reads the weekday by arithmetic because a Date per day made year-long spans slow; this keeps the two
// the same. 2026-09-06 is a Sunday. No database, no network, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'working-hours-'));
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
const dest = path.join(out, 'working-hours.mjs');
fs.writeFileSync(dest, ts.transpileModule(fs.readFileSync(path.join(root, 'lib/working-hours.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText);
const {workingHoursBetween, WORKING_WEEKDAYS, WORKING_DAY_START_HOUR, WORKING_DAY_END_HOUR} = await import(dest);

let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };

// ---- by hand
eq([WORKING_WEEKDAYS, WORKING_DAY_START_HOUR, WORKING_DAY_END_HOUR], [[0, 1, 2, 3, 4, 6], 8, 18], 'Sunday to Thursday and Saturday, 08:00 to 18:00; Friday is the day off');
eq(workingHoursBetween('2026-09-06T05:00:00.000Z', '2026-09-06T15:00:00.000Z'), 10, 'a whole working day, Sunday 08:00 to 18:00 in Riyadh');
eq(workingHoursBetween('2026-09-06T15:00:00.000Z', '2026-09-07T05:00:00.000Z'), 0, 'the night between two working days');
eq(workingHoursBetween('2026-09-10T14:00:00.000Z', '2026-09-12T06:00:00.000Z'), 2, 'Thursday 17:00 to Saturday 09:00: one hour each side of the Friday');
eq(workingHoursBetween('2026-09-10T21:00:00.000Z', '2026-09-11T21:00:00.000Z'), 0, 'the whole of a Friday');
eq(workingHoursBetween('2026-09-05T05:00:00.000Z', '2026-09-12T05:00:00.000Z'), 60, 'a week from Saturday morning to the next: six days of ten hours');
eq(workingHoursBetween('2026-09-06T05:30:00.000Z', '2026-09-06T06:15:00.000Z'), 0.75, 'part of an hour is a decimal');
eq(workingHoursBetween('2026-09-06T03:00:00.000Z', '2026-09-06T20:00:00.000Z'), 10, 'only the working window counts, however wide the span');
eq([workingHoursBetween('2026-09-06T15:00:00.000Z', '2026-09-06T05:00:00.000Z'), workingHoursBetween('2026-09-06T05:00:00.000Z', '2026-09-06T05:00:00.000Z'), workingHoursBetween('not a date', '2026-09-06T05:00:00.000Z'), workingHoursBetween(NaN, 5), workingHoursBetween(5, Infinity)], [0, 0, 0, 0, 0], 'reversed, equal or unreadable instants are zero');
eq(workingHoursBetween(Date.parse('2026-09-06T05:00:00.000Z'), Date.parse('2026-09-06T15:00:00.000Z')), 10, 'milliseconds are accepted as well as text');

// ---- against the reference
const DAY = 86400000, HOUR = 3600000, OFFSET = 3 * HOUR;
function reference(from, to) {
  const start = typeof from === 'number' ? from : Date.parse(from), end = typeof to === 'number' ? to : Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const localStart = start + OFFSET, localEnd = end + OFFSET;
  let day = Math.floor(localStart / DAY) * DAY, total = 0;
  for (let guard = 0; day < localEnd && guard < 40000; guard++, day += DAY) {
    if (![0, 1, 2, 3, 4, 6].includes(new Date(day).getUTCDay())) continue;
    const a = Math.max(day + 8 * HOUR, localStart), b = Math.min(day + 18 * HOUR, localEnd);
    if (b > a) total += (b - a) / HOUR;
  }
  return Math.round(total * 100) / 100;
}
let seed = 7;
const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const base = Date.parse('2024-01-01T00:00:00Z');
let different = 0, pairs = 0;
const same = (from, to) => { pairs++; if (workingHoursBetween(from, to) !== reference(from, to)) different++; };
for (let index = 0; index < 20000; index++) {
  const from = base + Math.floor(random() * 900 * DAY) + Math.floor(random() * DAY);
  same(from, from + (random() < 0.5 ? Math.floor(random() * 3 * DAY) : Math.floor(random() * 800 * DAY)));
}
for (let day = 0; day < 14; day++) for (const hour of [0, 4, 5, 5.0001, 14.9999, 15, 15.0001, 20, 21, 23.9999]) {
  const from = Date.parse('2026-09-05T00:00:00Z') + day * DAY + hour * HOUR;
  for (const span of [0, 1, HOUR, 5 * HOUR, DAY, 7 * DAY, 31 * DAY]) { same(from, from + span); same(from + span, from); }
}
same(-400 * DAY, -390 * DAY); same(-5, 20 * DAY); same(0, 30 * DAY);
eq([pairs > 20000, different], [true, 0], 'the production function and the calendar-asking reference agree on every one of ' + pairs + ' spans: random ones up to two years, every working-hour edge on both sides of a week, and spans before the epoch');
console.log(JSON.stringify({ok: true, checks, pairs, productionDataUsed: false}));
