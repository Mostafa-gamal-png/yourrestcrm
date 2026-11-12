// Customer codes (lib/customer-identity.ts): the key that imports, customer saves and the ERP/KPI matching share, a customer's ERP
// code (its CURRENT code only since 2026-11-12: the codes it had before are history and match nothing), the customers each code points
// to, and the reconciliation that picks one customer among a code's current holders, never one the data does not offer. tests/customer-identity-migration.mjs and -ui.mjs cover the table and the
// screen; this is the functions alone. No database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'customer-code-key-'));
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
// The module imports only a type from ./crm, which the transpiler drops.
fs.writeFileSync(path.join(out, 'customer-identity.mjs'), ts.transpileModule(fs.readFileSync(path.join(root, 'lib/customer-identity.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText);
const {customerCodeKey: key, customerErpCodes, customerCodeCandidates, uniqueCustomerCodes, effectiveCodeMapping, erpCodeTaken} = await import(path.join(out, 'customer-identity.mjs'));

let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const customer = (id, code, aliases, extra = {}) => ({id, kind: 'customer', parentId: null, data: {name: id, code, ...(aliases ? {_erpCodeAliases: aliases} : {})}, version: 1, ...extra});
const ids = map => Object.fromEntries([...map].map(([code, rows]) => [code, rows.map(row => row.id)]));

// ---- the key
eq(key('c-102'), 'C-102', 'upper case');
eq(key('  C-102 '), 'C-102', 'spaces around it do not matter');
eq(key('Ｃ－１０２'), 'C-102', 'wide letters and digits (NFKC) become plain ones');
eq(key('c-\u0661\u0660\u0662'), 'C-102', 'Arabic-Indic digits become plain ones (since 2026-10-31)');
eq(key('C-\u06f1\u06f0\u06f2'), 'C-102', 'Persian digits too');
eq(key('\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669'), '0123456789', 'every digit to its own');
eq(key('\u0639-\u0661\u0662'), '\u0639-12', 'an Arabic letter stays, its digits become plain');
eq(key(102), '102', 'a number from a spreadsheet cell becomes its text');
eq([key(null), key(undefined), key('')], ['', '', ''], 'nothing is an empty key');
eq(key('C 102'), 'C 102', 'an inner space is kept: "C 102" and "C102" are different codes');

// ---- a customer's ERP code: the current one only
eq(customerErpCodes(customer('a', 'C-1')), ['C-1'], 'the code alone');
eq(customerErpCodes(customer('a', 'C-1', ['C-2', 'C-3'])), ['C-1'], 'the codes it had before are not matched');
eq(customerErpCodes(customer('a', 'C-1', ['C-1', 'C-2', 'C-2'])), ['C-1'], 'its current code once');
eq(customerErpCodes(customer('a', '', ['C-2'])), [], 'a cleared code: no ERP code at all, whatever it had before');
eq(customerErpCodes(customer('a', undefined, ['C-2'])), [], 'never set: no ERP code');
eq(customerErpCodes(customer('a', '   ', ['  ', 'C-2'])), [], 'a blank code is not a code');
eq(customerErpCodes(customer('a', 102, [103, 'C-4', null])), [], 'a value that is not text is not a code');
eq(customerErpCodes(customer('a', 'C-1', 'C-9')), ['C-1'], 'aliases that are not a list change nothing');

// ---- which customers each code points to: its current holders
const records = [
  customer('north', 'C-1', ['c-2']),
  customer('south', 'C-2'),
  customer('east', 'C-3', ['C-3 ', 'Ｃ-3']),
  customer('west', 'C-4', ['C-1']),
  customer('cleared', '', ['C-3', 'C-5']),
  {id: 'machine', kind: 'factory', parentId: 'north', data: {name: 'machine', code: 'C-1'}},
  {id: 'visit', kind: 'activity', parentId: 'north', data: {code: 'C-1'}}
];
eq(ids(customerCodeCandidates(records)), {'C-1': ['north'], 'C-2': ['south'], 'C-3': ['east'], 'C-4': ['west']}, 'only customers, by their current code: an alias makes no customer a candidate (C-2 is south\'s alone, C-1 north\'s alone), and a cleared customer is a candidate for nothing (C-5 points to nobody)');
eq(ids(customerCodeCandidates([customer('typed', 'C-\u0667'), customer('imported', 'C-8', ['C-\u06f9'])])), {'C-7': ['typed'], 'C-8': ['imported']}, 'a code typed in Arabic digits meets the ERP file\'s plain one; an old code in Persian digits matches nothing');
eq(ids(customerCodeCandidates([customer('a', 'C-\u0665'), customer('b', 'C-5')])), {'C-5': ['a', 'b']}, 'two customers whose current codes differ only in the digits share one code, and the reconciliation screen offers both');
eq(ids(customerCodeCandidates([customer('real', '103'), customer('gone', '', ['103'])])), {'103': ['real']}, 'the owner\'s case: 103 is the ERP customer\'s; the customer whose 103 an import cleared is no longer «مسجل لأكثر من عميل»');
eq(ids(customerCodeCandidates([customer('renamed', 'NEW-1', ['OLD-1']), customer('other', 'OLD-1')])), {'NEW-1': ['renamed'], 'OLD-1': ['other']}, 'a renamed code moves the matching: the old code is the current holder\'s only');

// ---- the reconciliation: an explicit choice among the current holders, never a new association
const shared = [customer('north', 'C-2'), customer('south', 'C-2'), customer('east', 'C-3', ['C-2']), customer('cleared', '', ['C-2'])];
eq(ids(uniqueCustomerCodes(shared)), {'C-2': ['north', 'south'], 'C-3': ['east']}, 'two current holders stay ambiguous without a choice; the alias holders are not candidates');
eq(ids(uniqueCustomerCodes(shared, [{codeKey: 'C-2', customerId: 'south', version: 1}])), {'C-2': ['south'], 'C-3': ['east']}, 'a choice among the current holders settles the shared code');
eq(ids(uniqueCustomerCodes(shared, [{codeKey: 'C-2', customerId: 'east', version: 1}])), {'C-2': ['north', 'south'], 'C-3': ['east']}, 'a choice of a customer that only had the code before is ignored: still ambiguous');
eq(ids(uniqueCustomerCodes(shared, [{codeKey: 'C-2', customerId: 'cleared', version: 1}])), {'C-2': ['north', 'south'], 'C-3': ['east']}, 'a choice of a customer whose code was cleared is ignored');
eq(ids(uniqueCustomerCodes([customer('holder', 'C-6'), customer('cleared', '', ['C-6'])], [{codeKey: 'C-6', customerId: 'cleared', version: 3}])), {'C-6': ['holder']}, 'the current holder wins over a mapping to an alias holder: one holder, that holder');
eq(ids(uniqueCustomerCodes([customer('cleared', '', ['C-7'])], [{codeKey: 'C-7', customerId: 'cleared', version: 1}])).hasOwnProperty('C-7'), false, 'a mapping to a cleared customer matches nothing: nobody carries the code');
eq(ids(uniqueCustomerCodes(shared, [{codeKey: 'C-9', customerId: 'north', version: 1}])).hasOwnProperty('C-9'), false, 'a choice for a code no customer carries creates nothing');
eq(ids(uniqueCustomerCodes(shared, [{codeKey: 'C-2', customerId: 'deleted', version: 1}])), {'C-2': ['north', 'south'], 'C-3': ['east']}, 'a choice of a customer that no longer exists is ignored');
// clearing removes the matching; giving the code back brings it back
const before = [customer('a', 'K-1'), customer('b', 'K-1')], afterClear = [customer('a', 'K-1'), customer('b', '', ['K-1'])];
eq([ids(uniqueCustomerCodes(before)), ids(uniqueCustomerCodes(afterClear))], [{'K-1': ['a', 'b']}, {'K-1': ['a']}], 'clearing one of two holders leaves the other the only one');
eq(ids(uniqueCustomerCodes([customer('b', 'K-1', ['K-1'])])), {'K-1': ['b']}, 'carrying the code again makes it match again');

// ---- effectiveCodeMapping
const holders = [customer('x', 'Z'), customer('y', 'Z')], mapping = {codeKey: 'Z', customerId: 'y', version: 2};
eq(effectiveCodeMapping(mapping, holders), mapping, 'a mapping to a current holder decides');
eq(effectiveCodeMapping({...mapping, customerId: 'gone'}, holders), undefined, 'a mapping to anyone else is ignored');
eq([effectiveCodeMapping(undefined, holders), effectiveCodeMapping(mapping, undefined)], [undefined, undefined], 'no mapping, or nobody carrying the code: nothing decides');

// ---- the refusal of a duplicate code names the code
eq(erpCodeTaken('103'), 'كود ERP «103» مسجّل لعميل آخر في الـCRM؛ لكل عميل كود ERP خاص به لا يتكرر. صحّح الكود، أو اتركه فارغًا إذا لم يكن العميل في ERP.', 'the message');
console.log(JSON.stringify({ok: true, checks}));
