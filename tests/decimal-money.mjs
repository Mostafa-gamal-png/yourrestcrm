// Money in halalas (lib/decimal-money.ts): a quotation's line, discount and VAT are rounded from the exact decimal product, not from
// its binary floating-point approximation (1.005 * 100 is 100.49999… in JavaScript). Known traps, ties, negatives, scientific
// notation, values the form may hold while typing, and ten thousand random lines against exact integer arithmetic. No database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'decimal-money-'));
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
fs.writeFileSync(path.join(out, 'decimal-money.mjs'), ts.transpileModule(fs.readFileSync(path.join(root, 'lib/decimal-money.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText);
const {roundedDecimalProduct, moneyCents, lineCents, percentCents} = await import(path.join(out, 'decimal-money.mjs'));

let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };

// ---- the floating-point traps the module exists for
eq(Math.round(1.005 * 100), 100, 'the trap itself: plain arithmetic rounds 1.005 down');
eq(moneyCents(1.005), 101, '1.005 SAR is 101 halalas (a tie, rounded up)');
eq(moneyCents(2.675), 268, '2.675 SAR is 268 halalas, not 267');
eq(moneyCents(0.1 + 0.2), 30, '0.1 + 0.2 is 30 halalas');
eq(lineCents(3, 0.1), 30, '3 × 0.10 is 30 halalas, not 30.000000000000004');
eq(lineCents(1.15, 100), 11500, '1.15 × 100 is 11,500 halalas');
eq(lineCents(0.07, 100), 700, '0.07 × 100 is 700 halalas');
eq(lineCents(19.99, 3), 5997, '3 × 19.99 is 5,997 halalas');
eq(lineCents(2.5, 0.25), 63, '2.5 × 0.25 = 0.625: a tie, 63 halalas');

// ---- plain values
eq([moneyCents(0), moneyCents(1), moneyCents(12.34), moneyCents(1234567.89)], [0, 100, 1234, 123456789], 'whole and two-decimal amounts are exact');
eq(moneyCents(0.004), 0, 'under half a halala rounds down');
eq(moneyCents(0.006), 1, 'over half a halala rounds up');
eq(lineCents(0, 999.99), 0, 'a zero quantity is zero');
eq(lineCents(1000, 1000000), 100000000000, 'a large line stays exact');

// ---- negatives keep Math.round's direction for ties (toward +∞), as before
eq(moneyCents(-0.125), Math.round(-12.5), 'a negative tie goes toward +∞ (-12), like Math.round');
eq(moneyCents(-0.126), -13, 'a negative non-tie rounds away');
eq(moneyCents(-1.005), -100, '-1.005 is a tie: -100');
eq(lineCents(-2, 1.25), -250, 'a negative quantity is exact');

// ---- what a number field may hold while the user types
eq(moneyCents(1.5e3), 150000, 'scientific notation (1.5e3)');
eq(moneyCents(1e-7), 0, 'a tiny value is zero');
eq(moneyCents(5e-324), 0, 'the smallest subnormal number is zero, without a huge loop');
eq(lineCents(2e21, 1), 2e23, 'a value beyond safe integers keeps its magnitude');
for (const bad of [Number.NaN, Infinity, -Infinity]) {
  eq(Number.isNaN(moneyCents(bad)), true, `moneyCents(${bad}) is NaN, never a number`);
  eq(Number.isNaN(lineCents(1, bad)), true, `lineCents(1, ${bad}) is NaN`);
}

// ---- VAT and discount: rounded to whole halalas from cents × percent
eq(percentCents(10000, 15), 1500, '15% of 100.00 SAR is 15.00');
eq(percentCents(333, 15), 50, '15% of 3.33 SAR = 0.4995: 50 halalas');
eq(percentCents(1, 50), 1, '50% of one halala: a tie, rounded up');
eq(percentCents(1, 49), 0, '49% of one halala rounds down');
eq(percentCents(12345, 7.5), 926, '7.5% of 123.45 SAR = 9.25875: 926 halalas');
eq(percentCents(0, 15), 0, 'nothing has no VAT');

// ---- the general product and its rounding place
eq(roundedDecimalProduct([1.234, 10], 1), 123, 'rounded to tenths');
eq(roundedDecimalProduct([0.5]), 1, 'a whole-number tie rounds up');
eq(roundedDecimalProduct([2, 3, 0.5]), 3, 'three factors');
eq(roundedDecimalProduct([], 2), 100, 'no factors is one');

// ---- ten thousand random lines against exact integer arithmetic
let seed = 20261031;
const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
for (let i = 0; i < 10000; i++) {
  const quantity = Math.floor(random() * 1000), cents = Math.floor(random() * 10000000);
  if (lineCents(quantity, cents / 100) !== quantity * cents) assert.fail(`${quantity} × ${cents / 100} gave ${lineCents(quantity, cents / 100)}, not ${quantity * cents}`);
  // a price with three decimals ending in 5 is a tie: rounds up for a single unit
  const whole = Math.floor(random() * 100000), tenths = Math.floor(random() * 100);
  const tie = Number(`${whole}.${String(tenths).padStart(2, '0')}5`);
  if (moneyCents(tie) !== whole * 100 + tenths + 1) assert.fail(`${tie} gave ${moneyCents(tie)}`);
}
checks += 20000;
console.log(JSON.stringify({ok: true, checks}));
