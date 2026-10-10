// Unit check for the Escape rule shared by dialogs that host comboboxes. The real Radix capture-phase
// behaviour is covered by tests/competitors-browser.mjs (built app, real Chromium).
import fs from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
const code = ts.transpileModule(fs.readFileSync('lib/dialog-escape.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const {escapeBelongsToOpenPopup} = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
let checks = 0;
const check = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };
const inside = selectors => ({target: {closest: selector => selectors.includes(selector) ? {} : null}});
const open = '[role="combobox"][aria-expanded="true"]';
check(escapeBelongsToOpenPopup(inside([open])), true, 'Escape inside an expanded combobox belongs to its list');
check(escapeBelongsToOpenPopup(inside([])), false, 'Escape elsewhere still closes the dialog');
check(escapeBelongsToOpenPopup({target: null}), false, 'No target');
check(escapeBelongsToOpenPopup({target: {}}), false, 'Target without closest()');
check(escapeBelongsToOpenPopup(inside(['[aria-expanded="true"]'])), false, 'A generic expanded disclosure must not swallow Escape');
console.log(JSON.stringify({ok: true, checks}));
