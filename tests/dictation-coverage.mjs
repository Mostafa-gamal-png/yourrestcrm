// Every free-text field of every form carries the dictation button: a text input or text area written anywhere under app/ is either inside
// the VoiceField component, beside a DictationButton, or on the explicit list below of fields that stay typed (with the reason). A new
// field added later without a microphone and without a reason on the list fails here. Read from the source with the TypeScript parser:
// no browser, no device. What the button does is native-speech.mjs; how it looks in real forms is dictation-browser.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };

// Inputs that are not free text, or cannot be edited, need no microphone.
const NON_TEXT = new Set(['number', 'date', 'time', 'datetime-local', 'month', 'week', 'tel', 'email', 'password', 'search', 'hidden', 'checkbox', 'radio', 'file', 'range', 'color', 'url', 'submit', 'button']);

// Free-text fields that stay typed, each matched by a piece of its own source and kept honest: an entry that matches nothing fails.
const STAYS_TYPED = [
  {file: 'app/competitor-fields.tsx', snippet: "type=\"text\"", reason: 'the competitor name is chosen from earlier names (a suggestion list); the notes beside it are dictated'},
  {file: 'app/customer-entry-fields.tsx', snippet: 'ABCD1234', reason: 'the short national address is a code'},
  {file: 'app/customer-entry-fields.tsx', snippet: "'اللوكيشن (خط العرض، خط الطول)'", reason: 'coordinates: dictating digits makes more errors than it saves, and the point is taken from the device or the map'},
  {file: 'app/email-login.tsx', snippet: 'placeholder="name"', reason: 'sign-in: the name field takes the account name typed as the mail provider shows it'},
  {file: 'app/email-login.tsx', snippet: 'autoComplete="one-time-code"', reason: 'sign-in: a numeric code'},
  {file: 'app/kpi-evidence-editor.tsx', snippet: 'name="due"', reason: 'an amount in riyals: digits are typed, dictating them makes more errors than it saves'},
  {file: 'app/kpi-evidence-editor.tsx', snippet: 'name="collected"', reason: 'an amount in riyals: digits are typed, dictating them makes more errors than it saves'},
  {file: 'app/sales-workspace.tsx', snippet: "mode==='sales'?'العميل أو مرجع البيع'", reason: 'a search box'},
  {file: 'app/sales-workspace.tsx', snippet: 'maxLength={100} value={data.reference}', reason: 'the sale reference is a code from the invoice'},
  {file: 'app/visit-customer-picker.tsx', snippet: 'value={draft.code}', reason: 'the ERP customer code is a code'},
  // The shared helpers hand text and text areas to VoiceField and keep only the other types for themselves; the guard is checked below.
  {file: 'app/crm-app.tsx', snippet: "type={type === 'plain' ? 'text' : type}", reason: 'field(): only the types other than text and textarea reach this input; "plain" is an identifier or administrative value', guard: 'field'},
  {file: 'app/followups.tsx', snippet: 'type={type} required={required}', reason: 'field(): only the types other than text and textarea reach this input', guard: 'field'},
  {file: 'app/visit-fields.tsx', snippet: 'type={type} required={required}', reason: 'input(): only the types other than text and textarea reach this input', guard: 'input'}
];

const files = fs.readdirSync(path.join(root, 'app')).filter(name => name.endsWith('.tsx')).map(name => 'app/' + name).sort();
const parse = file => ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const TAGS = new Set(['input', 'textarea', 'Input', 'Textarea']);
const attributeOf = (element, name) => element.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.getText() === name);
const literalOf = attribute => attribute && attribute.initializer && ts.isStringLiteral(attribute.initializer) ? attribute.initializer.text : undefined;
// An attribute that is simply there (readOnly) or set to true; one that depends on a condition (readOnly={!manual}) leaves the field editable.
const always = attribute => !!attribute && (!attribute.initializer || attribute.initializer.getText() === '{true}');
const elementOf = node => ts.isJsxSelfClosingElement(node) ? node : node.openingElement;

const found = [], dictationUses = {voiceField: 0, button: 0}, labels = [];
for (const file of files) {
  const source = parse(file);
  const visit = node => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxElement(node)) {
      const element = elementOf(node), tag = element.tagName.getText();
      if (tag === 'VoiceField') {
        dictationUses.voiceField++;
        const label = literalOf(attributeOf(element, 'label'));
        if (label !== undefined) labels.push({file, label});
      }
      if (tag === 'DictationButton') dictationUses.button++;
      if (TAGS.has(tag)) {
        const type = attributeOf(element, 'type'), typeText = literalOf(type);
        const parent = node.parent;
        const siblings = parent && (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) ? parent.children : [];
        const beside = siblings.some(child => (ts.isJsxSelfClosingElement(child) || ts.isJsxElement(child)) && elementOf(child).tagName.getText() === 'DictationButton');
        let enclosing = node.parent;
        while (enclosing && !ts.isArrowFunction(enclosing) && !ts.isFunctionDeclaration(enclosing)) enclosing = enclosing.parent;
        found.push({
          file, line: source.getLineAndCharacterOfPosition(element.getStart()).line + 1, tag, text: element.getText(),
          nonText: (typeText !== undefined && NON_TEXT.has(typeText)) || always(attributeOf(element, 'readOnly')) || always(attributeOf(element, 'hidden')),
          implementation: file === 'app/voice-field.tsx', beside, enclosing: enclosing ? enclosing.getText() : ''
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

// ---- the scanner sees the forms (a positive control: a scanner that finds nothing would pass vacuously)
ok(found.length > 60, 'the scan found the inputs of the app: ' + found.length);
ok(dictationUses.voiceField >= 38, 'VoiceField is used across the forms: ' + dictationUses.voiceField);
ok(dictationUses.button >= 1, 'DictationButton is used where a control keeps its own markup');
ok(found.filter(item => item.implementation).length === 2, 'the VoiceField component itself holds the one input and the one text area');

// ---- every free-text field is dictated, or stays typed for a stated reason
const unexplained = [];
const used = new Set();
for (const item of found) {
  if (item.nonText || item.implementation || item.beside) continue;
  const index = STAYS_TYPED.findIndex(entry => entry.file === item.file && item.text.includes(entry.snippet));
  if (index >= 0) { used.add(index); continue; }
  unexplained.push(item.file + ':' + item.line + ' ' + item.text.slice(0, 120));
}
eq(unexplained, [], 'a free-text field without a microphone and without a reason to stay typed');
eq(STAYS_TYPED.filter((entry, index) => !used.has(index)).map(entry => entry.file + ' ' + entry.snippet), [], 'every reason on the list still matches a field (no stale entries)');
for (const entry of STAYS_TYPED) ok(entry.reason.length > 10, 'a reason is written for ' + entry.file + ' ' + entry.snippet);

// ---- the shared helpers send text and text areas to VoiceField
for (const entry of STAYS_TYPED.filter(item => item.guard)) {
  const item = found.find(candidate => candidate.file === entry.file && candidate.text.includes(entry.snippet));
  ok(item, 'the helper input of ' + entry.file + ' is found');
  ok(/\bVoiceField\b/.test(item.enclosing) && /type\s*===\s*'text'\s*\|\|\s*type\s*===\s*'textarea'/.test(item.enclosing), entry.file + ': the ' + entry.guard + ' helper that holds the input gives text and textarea to VoiceField first');
}

// ---- the labels of dictated fields read in English too
const english = JSON.parse(fs.readFileSync(path.join(root, 'lib/locales/en.json'), 'utf8'));
const missing = labels.filter(({label}) => /[؀-ۿ]/.test(label) && english[label.replace(/\s+/g, ' ').trim()] === undefined).map(({file, label}) => file + ' ' + label);
eq(missing, [], 'a dictated field whose label has no English entry');

console.log(JSON.stringify({ok: true, checks, inputsScanned: found.length, dictated: dictationUses.voiceField + dictationUses.button, stayTyped: STAYS_TYPED.length, source: 'TypeScript parser over app/*.tsx', browser: false, device: false}));
