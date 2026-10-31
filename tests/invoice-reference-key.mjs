// One invoice, one key (lib/invoice-reference.ts), the function alone (tests/invoice-reference.mjs runs it through the sales route): a manual sale and the ERP import must reach the same key for the same invoice, or
// the invoice is counted twice. The key folds what a paste brings (direction marks, a byte-order mark, wide letters, runs of spaces,
// case) and nothing else. No database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'invoice-reference-key-'));
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
fs.writeFileSync(path.join(out, 'invoice-reference.mjs'), ts.transpileModule(fs.readFileSync(path.join(root, 'lib/invoice-reference.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText);
const {canonicalInvoiceReference: key} = await import(path.join(out, 'invoice-reference.mjs'));

let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };

eq(key('INV-1023'), 'INV-1023', 'a clean reference is unchanged');
eq(key('inv-1023'), 'INV-1023', 'case does not matter');
eq(key('  INV-1023  '), 'INV-1023', 'spaces around it do not matter');
eq(key('INV  -\t1023'), 'INV - 1023', 'runs of spaces and tabs become one space (inner spaces are kept)');
eq(key('\u200fINV-1023\u200e'), 'INV-1023', 'right-to-left and left-to-right marks copied from an Arabic page are dropped');
eq(key('\u202bINV-1023\u202c'), 'INV-1023', 'embedding controls are dropped');
eq(key('\u2067INV-1023\u2069'), 'INV-1023', 'isolate controls are dropped');
eq(key('\ufeffINV-1023'), 'INV-1023', 'a byte-order mark from an exported file is dropped');
eq(key('INV\u200b-1023'), 'INV-1023', 'a zero-width space inside is dropped');
eq(key('ＩＮＶ－１０２３'), 'INV-1023', 'wide letters and digits (NFKC) become plain ones');
eq(key('فاتورة 77'), 'فاتورة 77', 'Arabic words stay as they are');
eq(key(''), '', 'an empty reference stays empty');
eq(key('\u200f \u200e'), '', 'marks and spaces only is empty');
// The pairs that must meet: what a person types or pastes, and what the ERP file carries.
for (const [manual, erp] of [['inv-1023', 'INV-1023'], ['\u200fINV-1023', 'INV-1023 '], ['ＩＮＶ－１０２３', 'INV-1023'], ['A  12', 'a 12']]) {
  eq(key(manual), key(erp), `"${manual}" and "${erp}" are the same invoice`);
}
// Different invoices stay different.
for (const [a, b] of [['INV-1023', 'INV-1024'], ['INV-1023', 'INV1023'], ['A 12', 'A12']]) {
  eq(key(a) === key(b), false, `"${a}" and "${b}" are different invoices`);
}
console.log(JSON.stringify({ok: true, checks}));
