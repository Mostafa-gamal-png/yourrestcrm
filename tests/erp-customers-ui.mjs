// «استيراد من ERP» (app/erp-customers-import.tsx), the real component with controlled React hooks and a stand-in for the server: the
// file is read and previewed at once; the dialog opens on the rows that need a choice; a choice is previewed again (one request at a
// time, the last choices win) and «تحديث الأكواد» waits for it; the apply carries the preview's snapshot and choices; an unconfirmed
// apply locks the dialog and is retried with the very same request; a stale preview (409) asks for a new one, which starts the choices
// over; two rows on one customer keep the button off even with another change, and its handler sends nothing; a number held outside the
// manager's regions, too many matches and a code that is another row explain themselves; a server message is shown in English with its
// row; a reload that fails after the apply offers «تحديث العرض بس»; Arabic and English. No browser, no network, no layout claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';

let checks = 0;
// Values made inside the component's own context (its arrays and objects) are compared by their content.
const eq = (actual, expected, message) => { assert.deepEqual(actual === undefined ? undefined : JSON.parse(JSON.stringify(actual)), expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const compiler = {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true};
class FakeReader { readAsDataURL(file) { setTimeout(() => { this.result = 'data:application/octet-stream;base64,' + Buffer.from(file.name).toString('base64'); this.onload(); }, 0); } }
const globals = {crypto: globalThis.crypto, Error, TypeError, AbortController, setTimeout, clearTimeout, structuredClone, FileReader: FakeReader, requestAnimationFrame: callback => callback(), XMLHttpRequest: undefined};
function load(file, require) { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: compiler}).outputText, {exports, require, console, ...globals}); return exports; }
const submit = load('lib/client-submit.ts', () => ({})), identity = load('lib/customer-identity.ts', () => ({}));
const pass = ({children}) => children, noop = () => {}, Icon = () => null;
function Dialog() {} function UploadStatus() {}
function nodes(tree, predicate) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate)); return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)]; }
function text(tree) { if (tree === null || tree === undefined || typeof tree === 'boolean') return ''; if (typeof tree !== 'object') return String(tree); return Array.isArray(tree) ? tree.map(text).join('') : text(tree.props?.children); }
const source = ts.createSourceFile('import.tsx', fs.readFileSync('app/erp-customers-import.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), stateNames = [];
(function find(node) { if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(source) === 'useState') stateNames.push(node.name.elements[0].name.getText(source)); ts.forEachChild(node, find); })(source);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(condition, what) { for (let i = 0; i < 100; i++) { if (condition()) return; await tick(); } throw Error('timed out waiting for ' + what); }

function harness(language, {failImports = 0} = {}) {
  const state = {}, refs = [], requests = [];
  let cursor = 0, refCursor = 0, closed = 0, imported = 0, tree;
  const hooks = {...React, useState(initial) { const name = stateNames[cursor++]; if (!Object.hasOwn(state, name)) state[name] = typeof initial === 'function' ? initial() : initial; return [state[name], value => { state[name] = typeof value === 'function' ? value(state[name]) : value; }]; }, useRef(value) { const index = refCursor++; return refs[index] || (refs[index] = {current: value}); }, useEffect: noop, useMemo: fn => fn(), useCallback: fn => fn};
  const submitJson = (url, options) => new Promise((resolve, reject) => requests.push({url, raw: options.body, body: JSON.parse(options.body), resolve: value => resolve(structuredClone(value)), reject}));
  const modules = {'react': hooks, 'react/jsx-runtime': jsx, '@/lib/i18n': {useLanguage: () => ({language}), t: value => value}, '@/lib/client-submit': {SubmitError: submit.SubmitError, definiteSubmitRejection: submit.definiteSubmitRejection, submitJson}, '@/lib/customer-identity': identity, '@/components/ui/dialog': {Dialog, DialogContent: pass, DialogTitle: pass, DialogDescription: pass}, './upload-status': {__esModule: true, default: UploadStatus}, 'lucide-react': new Proxy({}, {get: () => Icon})};
  const Component = load('app/erp-customers-import.tsx', name => modules[name] || (name.endsWith('.css') ? {} : assert.fail('unexpected import ' + name))).default;
  return {state, requests, closed: () => closed, imported: () => imported, tree: () => tree, render() { cursor = refCursor = 0; tree = Component({onClose: () => closed++, onImported: async () => { imported++; if (imported <= failImports) throw new Error('reload failed'); }}); return tree; }};
}
const say = (language, ar, en) => language === 'en' ? en : ar;
const button = (h, label) => nodes(h.tree(), node => node.type === 'button' && text(node).trim() === label)[0];
const radio = (h, row, value) => nodes(h.tree(), node => node.type === 'input' && node.props.type === 'radio' && node.props.name === 'erp-row-' + row && node.props.value === value)[0];
const fieldset = (h, row) => nodes(h.tree(), node => node.type === 'fieldset' && nodes(node, child => child.props?.name === 'erp-row-' + row).length)[0];
const pressed = h => text(nodes(h.tree(), node => node.type === 'button' && node.props['aria-pressed'] === true)[0]).trim();
const tiles = h => nodes(h.tree(), node => node.props?.className === 'erp-import-counts')[0].props.children.map(tile => text(tile));

const candidate = (id, name, number, code = '') => ({id, name, internalCode: 'YR-C-' + String(number).padStart(6, '0'), code, region: 'الوسطى', phones: ['4567'], matchedBy: 'name'});
const base = {row: 0, code: '', name: '', phones: [], status: 'auto', issue: '', matchedBy: '', candidates: [], customerId: '', chosen: false, conflict: false, codeRow: 0, from: '', to: '', change: false, mapping: false, sharedWith: 0};
const summary = changes => ({rows: 3, auto: 1, same: 0, choose: 1, missing: 1, outOfRegion: 0, heldOutside: 0, invalid: 0, conflicts: 0, pending: changes > 1 ? 0 : 1, changes, codeChanges: changes, mappings: 1});
const first = {fileName: 'Customer.xlsx', sheet: 'Customer', snapshot: 'a'.repeat(64), summary: summary(1), rows: [
  {...base, row: 3, code: '12', name: 'مصنع النور', phones: ['4567'], matchedBy: 'both', candidates: [{...candidate('nour', 'مصنع النور', 1, 'OLD'), matchedBy: 'both'}], customerId: 'nour', from: 'OLD', to: '12', change: true, mapping: true, sharedWith: 1},
  {...base, row: 5, code: '55', name: 'مصنع التوأم', status: 'choose', candidates: [candidate('twinA', 'مصنع التوأم', 4, 'T-1'), candidate('twinB', 'مصنع التوأم', 5)], to: '55'},
  {...base, row: 6, code: '77', name: 'مصنع غير موجود', status: 'missing', to: '77'},
]};
const chosen = id => ({...first, summary: summary(2), rows: first.rows.map(row => row.row === 5 ? {...row, customerId: id, chosen: true, matchedBy: 'name', change: true, from: id === 'twinA' ? 'T-1' : ''} : row)});

for (const language of ['ar', 'en']) {
  const t = (ar, en) => say(language, ar, en), h = harness(language);
  h.render();
  eq(button(h, t('معاينة جديدة', 'New preview')), undefined, 'no preview before a file');
  // ---- choosing a file reads it and previews it at once
  const input = nodes(h.tree(), node => node.type === 'input' && node.props.id === 'erp-customers-file')[0];
  input.props.onChange({target: {files: [{name: 'Customer.csv', size: 10}], value: 'x'}});
  await tick(); h.render();
  eq(h.requests.length, 0, 'a file that is not .xlsx is refused on the device');
  ok(text(h.tree()).includes(t('.xlsx', '.xlsx')), 'with a message');
  input.props.onChange({target: {files: [{name: 'Customer.xlsx', size: 2 * 1024 * 1024}], value: 'x'}});
  await tick(); eq(h.requests.length, 0, 'a file over 1 MB is refused on the device');
  input.props.onChange({target: {files: [{name: 'Customer.xlsx', size: 1200}], value: 'x'}});
  await until(() => h.requests.length === 1, 'the preview');
  eq([h.requests[0].url, h.requests[0].body.action, h.requests[0].body.fileName, h.requests[0].body.choices], ['/api/erp-customers', 'preview', 'Customer.xlsx', []], 'the file is previewed at once, with no choice');
  h.requests[0].resolve(first); await until(() => h.state.preview, 'the preview shown'); h.render();
  eq(tiles(h), [t('هيتغير', 'Will change') + '1', t('يحتاج اختيار', 'Needs a choice') + '1', t('من غير تغيير', 'No change') + '0', t('مش في الـCRM', 'Not in the CRM') + '1'], 'the counts');
  eq(pressed(h), t('يحتاج اختيار', 'Needs a choice') + ' 1', 'the dialog opens on the rows that need a choice');
  eq([radio(h, 5, 'twinA').props.checked, radio(h, 5, 'twinB').props.checked, radio(h, 5, '').props.checked], [false, false, false], 'nothing is chosen for an ambiguous row');
  ok(text(h.tree()).includes('YR-C-000004') && text(h.tree()).includes('YR-C-000005'), 'each candidate with its Yourrest code');
  eq(button(h, t('تحديث الأكواد', 'Update codes')).props.disabled, false, 'the matched rows can be applied as they are');

  // ---- a choice is previewed again; choices made meanwhile follow in one more request, the last one wins
  radio(h, 5, 'twinA').props.onChange(); h.render();
  await until(() => h.requests.length === 2, 'the preview with the choice');
  eq(h.requests[1].body.choices, [{row: 5, customerId: 'twinA'}], 'the choice goes with the preview');
  eq(button(h, t('تحديث الأكواد', 'Update codes')).props.disabled, true, 'no apply while the preview catches up');
  radio(h, 5, 'twinB').props.onChange(); radio(h, 5, '').props.onChange(); radio(h, 5, 'twinB').props.onChange(); h.render();
  eq(radio(h, 5, 'twinB').props.checked, true, 'the latest choice shows at once');
  h.requests[1].resolve(chosen('twinA'));
  await until(() => h.requests.length === 3, 'one more preview for the later choices');
  eq([h.requests.length, h.requests[2].body.choices], [3, [{row: 5, customerId: 'twinB'}]], 'only the latest choices are sent again');
  h.requests[2].resolve(chosen('twinB')); await until(() => !h.state.refreshing, 'the preview settled'); h.render();
  eq(h.state.preview.rows[1].customerId, 'twinB', 'the last answer is the one shown');
  const apply = button(h, t('تحديث الأكواد', 'Update codes'));
  eq(apply.props.disabled, false, 'ready to apply');

  // ---- the apply: lost answer → locked, retried with the very same request
  apply.props.onClick();
  await until(() => h.requests.length === 4, 'the apply');
  const sent = h.requests[3];
  eq([sent.body.action, sent.body.snapshot, sent.body.choices, /^[0-9a-f-]{36}$/.test(sent.body.requestId), sent.body.base64], ['apply', 'a'.repeat(64), [{row: 5, customerId: 'twinB'}], true, h.requests[0].body.base64], 'the apply carries the same file, the snapshot, the choices and a request id');
  sent.reject(new submit.SubmitError('Disconnected')); await until(() => h.state.pending, 'the unconfirmed state'); h.render();
  ok(button(h, t('تأكيد الحفظ', 'Confirm save')), 'an unconfirmed apply offers to confirm it');
  eq(fieldset(h, 5).props.disabled, true, 'the choices are locked');
  nodes(h.tree(), node => node.type === Dialog)[0].props.onOpenChange(false);
  eq(h.closed(), 0, 'the dialog cannot be dismissed with an unconfirmed write');
  button(h, t('تأكيد الحفظ', 'Confirm save')).props.onClick();
  await until(() => h.requests.length === 5, 'the retry');
  eq(h.requests[4].raw, sent.raw, 'the retry is the very same request, request id included');
  h.requests[4].resolve({ok: true, updated: 2, mappings: 1, changed: 2, unchanged: 0, skipped: 0, missing: 1, outOfRegion: 0, invalid: 0, changes: [{row: 3, customerId: 'nour', from: 'OLD', to: '12', mapping: true}, {row: 5, customerId: 'twinB', from: '', to: '55', mapping: false}], alreadySaved: true});
  await until(() => h.imported() === 1, 'the customers reload'); h.render();
  ok(text(h.tree()).includes(t('تم تحديث الأكواد', 'Codes updated')), 'the result');
  eq(nodes(h.tree(), node => node.type === 'ol')[0].props.children.length, 2, 'the changes listed');
  ok(text(h.tree()).includes('مصنع النور · YR-C-000001') || text(h.tree()).includes('YR-C-000001'), 'by name and Yourrest code');
  eq(button(h, t('تحديث الأكواد', 'Update codes')), undefined, 'nothing more to apply');
  button(h, t('تم', 'Done')).props.onClick(); eq(h.closed(), 1, 'done closes');

  // ---- a stale preview: 409 → a new preview, which starts the choices over
  const s = harness(language); s.render();
  nodes(s.tree(), node => node.type === 'input' && node.props.id === 'erp-customers-file')[0].props.onChange({target: {files: [{name: 'Customer.xlsx', size: 1200}], value: ''}});
  await until(() => s.requests.length === 1, 'the preview'); s.requests[0].resolve(first); await until(() => s.state.preview, 'shown'); s.render();
  radio(s, 5, 'twinA').props.onChange(); await until(() => s.requests.length === 2, 're-preview'); s.requests[1].resolve(chosen('twinA')); await until(() => !s.state.refreshing, 'settled'); s.render();
  button(s, t('تحديث الأكواد', 'Update codes')).props.onClick(); await until(() => s.requests.length === 3, 'the apply');
  s.requests[2].reject(new submit.SubmitError('اتغيرت بيانات العملاء من وقت المعاينة؛ اعمل معاينة جديدة', 409, {error: 'اتغيرت بيانات العملاء من وقت المعاينة؛ اعمل معاينة جديدة'}));
  await until(() => s.state.stale, 'the stale state'); s.render();
  ok(text(s.tree()).includes(t('اتغيرت بيانات العملاء من وقت المعاينة؛ اعمل معاينة جديدة', 'Customer data changed since the preview. Run a new preview.')), 'the stale message, in the reader\'s language');
  eq([s.state.pending, fieldset(s, 5).props.disabled, !!button(s, t('تحديث الأكواد', 'Update codes'))], [false, true, false], 'no retry of the stale request; choices locked; no apply');
  nodes(nodes(s.tree(), node => node.type === 'footer')[0], node => node.type === 'button' && text(node).trim() === t('معاينة جديدة', 'New preview'))[0].props.onClick();
  await until(() => s.requests.length === 4, 'a new preview');
  eq([s.requests[3].body.action, s.requests[3].body.choices], ['preview', []], 'the new preview starts the choices over');
  s.requests[3].resolve(first); await until(() => !s.state.stale, 'fresh'); s.render();
  eq(Object.keys(s.state.choices).length, 0, 'no choice carried over');

  // ---- two rows on one customer, and nothing to change: the button stays off
  const c = harness(language); c.render();
  nodes(c.tree(), node => node.type === 'input' && node.props.id === 'erp-customers-file')[0].props.onChange({target: {files: [{name: 'Customer.xlsx', size: 1200}], value: ''}});
  await until(() => c.requests.length === 1, 'the preview');
  // Another row still has a change to make: only the conflict keeps the button off.
  c.requests[0].resolve({...first, summary: {...summary(1), conflicts: 2, changes: 1}, rows: [{...first.rows[0], status: 'choose', conflict: true}, {...first.rows[0], row: 4, code: '13', status: 'choose', conflict: true}, {...first.rows[0], row: 7, code: '70', candidates: [candidate('fajr', 'مصنع الفجر', 2)], customerId: 'fajr', from: '', to: '70', mapping: false, sharedWith: 0}]});
  await until(() => c.state.preview, 'shown'); c.render();
  eq(button(c, t('تحديث الأكواد', 'Update codes')).props.disabled, true, 'two rows on one customer: no apply, although another row would change');
  ok(text(c.tree()).includes(t('سيبه', 'Leave it')), 'each conflicting row can be left');
  ok(text(c.tree()).includes(t('نفس العميل في أكتر من سطر', 'Same customer on several rows')), 'and says why');
  button(c, t('تحديث الأكواد', 'Update codes')).props.onClick(); await tick(); await tick();
  eq([c.requests.length, c.state.busy], [1, null], 'the handler itself refuses while the button is off: nothing is sent');

  // ---- rows that explain themselves: a number held outside the regions, too many matches, a code that is another row of the file
  const e = harness(language); e.render();
  nodes(e.tree(), node => node.type === 'input' && node.props.id === 'erp-customers-file')[0].props.onChange({target: {files: [{name: 'Customer.xlsx', size: 1200}], value: ''}});
  await until(() => e.requests.length === 1, 'the preview');
  e.requests[0].resolve({...first, summary: {...summary(0), heldOutside: 1, invalid: 1, choose: 1, pending: 1, changes: 0}, rows: [
    {...base, row: 3, code: '12', name: 'مصنع الوسط', status: 'held-outside', to: '12'},
    {...base, row: 4, code: '13', name: 'مصنع مشترك', status: 'invalid', issue: 'too-many-matches', to: '13'},
    {...base, row: 5, code: '14', name: 'مصنع كثير الأرقام', status: 'invalid', issue: 'too-many-phones', to: '14'},
    {...base, row: 6, code: '57', name: 'شركة اخرى', status: 'choose', codeRow: 3, candidates: [{...candidate('amal', 'مصنع الأمل', 9, '12'), matchedBy: 'phone'}], to: '57'},
  ]});
  await until(() => e.state.preview, 'shown'); e.render(); e.state.filter = 'all'; e.render();
  const all = text(e.tree());
  ok(all.includes(t('الرقم عند عميل خارج مناطقك', 'Number held outside your regions')) && all.includes(t('ربطه لمدير النظام', 'only the system administrator can link it')), 'a number held outside the regions: why, and who can link it');
  ok(all.includes(t('بيطابق عملاء كتير', 'Matches too many customers')) && all.includes(t('أكتر من 20 عميل', 'More than 20 customers')), 'too many matches');
  ok(all.includes(t('أرقام جوال كتير في السطر', 'Too many phone numbers in the row')), 'too many phone numbers');
  ok(all.includes(t('موجود في سطر 3 من الملف', 'is row 3 of the file')), 'a code that is another row: the user confirms');
  eq([!!fieldset(e, 3), !!fieldset(e, 4), !!fieldset(e, 6)], [false, false, true], 'only the row with a candidate offers a choice');
  ok(all.includes(t('الرقم عند عميل خارج مناطقك', 'Number held outside your regions') + ': 1'), 'counted in the summary line');

  // ---- a server message in the reader's language, with its row
  const m = harness(language); m.render();
  nodes(m.tree(), node => node.type === 'input' && node.props.id === 'erp-customers-file')[0].props.onChange({target: {files: [{name: 'Sales.xlsx', size: 1200}], value: ''}});
  await until(() => m.requests.length === 1, 'the preview');
  const wrong = 'ده مش ملف عملاء ERP: لازم يكون فيه عمود «رقم العميل» ومعاه عمود الاسم أو الجوال. صدّر ملف العملاء من ERP زي ما هو.';
  m.requests[0].reject(new submit.SubmitError(wrong, 400, {error: wrong}));
  await until(() => m.state.error, 'the refusal'); m.render();
  ok(text(m.tree()).includes(t(wrong, 'This is not an ERP customer file')), 'the wrong-file refusal in the reader\'s language');
  nodes(m.tree(), node => node.type === 'input' && node.props.id === 'erp-customers-file')[0].props.onChange({target: {files: [{name: 'Customer.xlsx', size: 1200}], value: ''}});
  await until(() => m.requests.length === 2, 'another preview');
  m.requests[1].reject(new submit.SubmitError('السطر 14: التقرير يحتوي معادلات؛ صدّره بالقيم فقط', 400));
  await until(() => m.state.error, 'the refusal'); m.render();
  ok(text(m.tree()).includes(t('السطر 14: التقرير يحتوي معادلات؛ صدّره بالقيم فقط', 'Row 14: the file contains formulas')), 'a message with its row');

  // ---- the codes were updated but the customers did not reload: «تحديث العرض بس» reloads only, it never sends the update again
  const f = harness(language, {failImports: 1}); f.render();
  nodes(f.tree(), node => node.type === 'input' && node.props.id === 'erp-customers-file')[0].props.onChange({target: {files: [{name: 'Customer.xlsx', size: 1200}], value: ''}});
  await until(() => f.requests.length === 1, 'the preview'); f.requests[0].resolve(first); await until(() => f.state.preview, 'shown'); f.render();
  button(f, t('تحديث الأكواد', 'Update codes')).props.onClick(); await until(() => f.requests.length === 2, 'the apply');
  f.requests[1].resolve({ok: true, updated: 1, mappings: 1, changed: 1, unchanged: 0, skipped: 1, missing: 1, outOfRegion: 0, heldOutside: 0, invalid: 0, changes: [{row: 3, customerId: 'nour', from: 'OLD', to: '12', mapping: true}]});
  await until(() => f.state.refreshFailed, 'the failed reload'); f.render();
  ok(text(f.tree()).includes(t('اتحدثت الأكواد، لكن تعذر تحديث قائمة العملاء', 'The codes were updated, but the customer list could not refresh')), 'the update is kept and the failed reload is said');
  button(f, t('تحديث العرض بس', 'Refresh view only')).props.onClick();
  await until(() => f.imported() === 2 && !f.state.busy, 'the second reload'); f.render();
  eq([f.requests.length, f.state.refreshFailed, !!button(f, t('تحديث العرض بس', 'Refresh view only'))], [2, false, false], 'it reloads without sending the update again, and the button goes once the list is fresh');
}

console.log(JSON.stringify({ok: true, checks, coverage: 'ERP customer import dialog: file checks, immediate preview, needs-choice first, serialized re-preview with the latest choices, apply payload, unconfirmed apply locked and retried byte for byte, stale 409 and a fresh preview, conflicts (button and handler), held-outside / too many matches / too many phones / code in another row, server messages in English, a failed reload after the apply; Arabic/English', realBrowser: false}));
