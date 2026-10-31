// Customer codes (lib/customer-identity.ts): the key that imports, customer saves and the ERP/KPI matching share, a customer's ERP
// codes (its code and its aliases), the customers each code points to, and the reconciliation that picks one customer for a code
// shared by several, never one the data does not offer. tests/customer-identity-migration.mjs and -ui.mjs cover the table and the
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
const {customerCodeKey: key, customerErpCodes, customerCodeCandidates, uniqueCustomerCodes} = await import(path.join(out, 'customer-identity.mjs'));

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

// ---- a customer's ERP codes
eq(customerErpCodes(customer('a', 'C-1')), ['C-1'], 'the code alone');
eq(customerErpCodes(customer('a', 'C-1', ['C-2', 'C-3'])), ['C-1', 'C-2', 'C-3'], 'the code and its aliases');
eq(customerErpCodes(customer('a', 'C-1', ['C-1', 'C-2', 'C-2'])), ['C-1', 'C-2'], 'the same spelling twice counts once');
eq(customerErpCodes(customer('a', '', ['C-2'])), ['C-2'], 'no code: the aliases');
eq(customerErpCodes(customer('a', '   ', ['  ', 'C-2'])), ['C-2'], 'blank codes are not codes');
eq(customerErpCodes(customer('a', 102, [103, 'C-4', null])), ['C-4'], 'values that are not text are ignored');
eq(customerErpCodes(customer('a', 'C-1', 'C-9')), ['C-1'], 'aliases that are not a list are ignored');

// ---- which customers each code points to
const records = [
  customer('north', 'C-1', ['c-2']),
  customer('south', 'C-2'),
  customer('east', 'C-3', ['C-3 ', 'Ｃ-3']),
  {id: 'machine', kind: 'factory', parentId: 'north', data: {name: 'machine', code: 'C-1'}},
  {id: 'visit', kind: 'activity', parentId: 'north', data: {code: 'C-1'}}
];
eq(ids(customerCodeCandidates(records)), {'C-1': ['north'], 'C-2': ['north', 'south'], 'C-3': ['east']}, 'only customers; a code shared by two customers points to both; spellings of one code count once per customer');
eq(ids(customerCodeCandidates([customer('typed', 'C-\u0667'), customer('imported', 'C-8', ['C-\u06f9'])])), {'C-7': ['typed'], 'C-8': ['imported'], 'C-9': ['imported']}, 'a code typed in Arabic digits meets the ERP file\'s plain one');
eq(ids(customerCodeCandidates([customer('a', 'C-\u0665'), customer('b', 'C-5')])), {'C-5': ['a', 'b']}, 'two customers whose codes differ only in the digits share one code, and the reconciliation screen offers both');

// ---- the reconciliation: an explicit choice, never a new association
eq(ids(uniqueCustomerCodes(records)), ids(customerCodeCandidates(records)), 'without choices nothing changes');
eq(ids(uniqueCustomerCodes(records, [{codeKey: 'C-2', customerId: 'south', version: 1}])), {'C-1': ['north'], 'C-2': ['south'], 'C-3': ['east']}, 'a choice among the candidates settles the shared code');
eq(ids(uniqueCustomerCodes(records, [{codeKey: 'C-2', customerId: 'east', version: 1}])), {'C-1': ['north'], 'C-2': ['north', 'south'], 'C-3': ['east']}, 'a choice of a customer the code does not point to is ignored');
eq(ids(uniqueCustomerCodes(records, [{codeKey: 'C-9', customerId: 'north', version: 1}])).hasOwnProperty('C-9'), false, 'a choice for a code no customer carries creates nothing');
eq(ids(uniqueCustomerCodes(records, [{codeKey: 'C-1', customerId: 'deleted', version: 1}])), {'C-1': ['north'], 'C-2': ['north', 'south'], 'C-3': ['east']}, 'a choice of a customer that no longer exists is ignored');
console.log(JSON.stringify({ok: true, checks}));
