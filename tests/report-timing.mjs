// The monthly reports' arithmetic (lib/report-timing.ts): the month the report asks for, a share in percent with one decimal, and a
// stage's timing — how many, the median and the average in working hours, and how many went over the stage's target. Empty months,
// odd and even counts, unsorted input, values on the target and rounding. No database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'report-timing-'));
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
fs.writeFileSync(path.join(out, 'report-timing.mjs'), ts.transpileModule(fs.readFileSync(path.join(root, 'lib/report-timing.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText);
const {REPORT_MONTH, reportRate: rate, reportTiming: timing} = await import(path.join(out, 'report-timing.mjs'));

let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };

// ---- the month a report asks for
for (const month of ['2026-01', '2026-10', '2026-12', '1999-07']) eq(REPORT_MONTH.test(month), true, `${month} is a month`);
for (const month of ['2026-00', '2026-13', '2026-1', '26-10', '2026/10', '2026-10-01', ' 2026-10', '2026-10 ', '', '٢٠٢٦-١٠']) eq(REPORT_MONTH.test(month), false, `"${month}" is not a month`);

// ---- a share in percent, one decimal
eq(rate(1, 3), 33.3, 'one in three is 33.3%');
eq(rate(2, 3), 66.7, 'two in three is 66.7%');
eq(rate(1, 8), 12.5, 'one in eight is 12.5%');
eq(rate(3, 3), 100, 'all is 100%');
eq(rate(0, 5), 0, 'none is 0%');
eq([rate(0, 0), rate(5, 0)], [null, null], 'nothing to divide by is no share, not 0% or infinity');

// ---- a stage's timing
eq(timing([], 4), {n: 0, median: null, average: null, target: 4, overTarget: 0}, 'an empty month has no median and no average');
eq(timing([], null), {n: 0, median: null, average: null, target: null, overTarget: 0}, 'and no target means nothing is over it');
eq(timing([5], 4), {n: 1, median: 5, average: 5, target: 4, overTarget: 1}, 'one item');
eq(timing([9, 1, 5], 4).median, 5, 'an odd count: the middle value, whatever the order given');
eq(timing([8, 2, 4, 6], 4).median, 5, 'an even count: the mean of the two middle values');
eq(timing([1, 2], null).average, 1.5, 'the average');
eq(timing([1, 1, 2], null).average, 1.33, 'the average to two decimals');
eq(timing([0.333, 0.333], null).median, 0.33, 'the median to two decimals');
eq(timing([4, 4, 4.01, 3.99], 4).overTarget, 1, 'a value on the target is not over it');
eq(timing([10, 20, 30], null).overTarget, 0, 'no target: nothing is over it');
eq(timing([10, 20, 30], 0).overTarget, 3, 'a target of zero is a target: everything above it is over');
const given = [3, 1, 2];
timing(given, 2);
eq(given, [3, 1, 2], 'the caller\'s list is not reordered');
eq(timing([2, 10, 1, 3], 2.5), {n: 4, median: 2.5, average: 4, target: 2.5, overTarget: 2}, 'the whole result');
console.log(JSON.stringify({ok: true, checks}));
