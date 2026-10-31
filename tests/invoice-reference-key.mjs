// One invoice, one key (lib/invoice-reference.ts), the function alone (tests/invoice-reference.mjs runs it through the sales route): a manual sale and the ERP import must reach the same key for the same invoice, or
// the invoice is counted twice. The key folds what a paste brings (direction marks, a byte-order mark, wide letters, runs of spaces,
// case) and the digits of an Arabic keyboard (since 2026-10-31), and nothing else. No database.
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
eq(key('INV-\u0661\u0660\u0662\u0663'), 'INV-1023', 'Arabic-Indic digits (\u0661\u0660\u0662\u0663) become plain ones');
eq(key('INV-\u06f1\u06f0\u06f2\u06f3'), 'INV-1023', 'Persian digits (\u06f1\u06f0\u06f2\u06f3) too');
eq(key('\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669 \u06f0\u06f1\u06f2\u06f3\u06f4\u06f5\u06f6\u06f7\u06f8\u06f9'), '0123456789 0123456789', 'every digit of both sets, each to its own');
eq(key('\u0641\u0627\u062a\u0648\u0631\u0629 \u0667\u0667'), '\u0641\u0627\u062a\u0648\u0631\u0629 77', 'the Arabic word stays, its digits become plain');
eq(key('INV\u066b5\u066c6'), 'INV\u066b5\u066c6', 'the Arabic decimal and thousands marks are not digits and stay');
eq(key('فاتورة 77'), 'فاتورة 77', 'Arabic words stay as they are');
eq(key(''), '', 'an empty reference stays empty');
eq(key('\u200f \u200e'), '', 'marks and spaces only is empty');
// The pairs that must meet: what a person types or pastes, and what the ERP file carries.
for (const [manual, erp] of [['inv-1023', 'INV-1023'], ['\u200fINV-1023', 'INV-1023 '], ['ＩＮＶ－１０２３', 'INV-1023'], ['A  12', 'a 12'], ['inv-\u0661\u0660\u0662\u0663', 'INV-1023'], ['\u200fINV-\u06f1\u06f0\u06f2\u06f3', 'INV-\u0661\u0660\u0662\u0663']]) {
  eq(key(manual), key(erp), `"${manual}" and "${erp}" are the same invoice`);
}
// Different invoices stay different.
for (const [a, b] of [['INV-1023', 'INV-1024'], ['INV-1023', 'INV1023'], ['A 12', 'A12'], ['INV-\u0661\u0660\u0662\u0663', 'INV-1024'], ['INV-\u0661\u0660\u0662\u0663', 'INV-\u0663\u0662\u0660\u0661']]) {
  eq(key(a) === key(b), false, `"${a}" and "${b}" are different invoices`);
}
console.log(JSON.stringify({ok: true, checks}));
