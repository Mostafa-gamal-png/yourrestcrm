// «استيراد من ERP» (app/erp-customers-import.tsx), the real component with controlled React hooks and a stand-in for the server: the
// file is read and previewed at once; the summary line and counts (codes that change, rows that need a choice, new customers); the
// «محتاج تختار» section with «ده هو» / «سيبه» and, for a similar name, «عميل جديد» (nothing pressed until the user chooses); the «عملاء
// جداد هيتضافوا» section with its «سيبه» toggle, the region select and a row's own region; a choice is previewed again (one request at a
// time, the last choices win) and «حدّث X كود وضيف Y عميل» waits for it; the apply carries the preview's snapshot, choices and regions; an unconfirmed
// apply locks the dialog and is retried with the very same request; a stale preview (409) asks for a new one, which starts the choices
// over; two rows on one customer keep the button off even with another change, and its handler sends nothing; a number held outside the
// manager's regions, too many matches and a code that is another row explain themselves; a server message is shown in English with its
// row; the result lists what changed and what was added; a reload that fails after the apply offers «تحديث العرض بس»; Arabic and
// English (no Arabic left in the screen's own words in English). No browser, no network, no layout claim.
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
const submit = load('lib/client-submit.ts', () => ({})), identity = load('lib/customer-identity.ts', () => ({})), shared = load('lib/erp-customers-shared.ts', () => ({}));
const pass = ({children}) => children, noop = () => {}, Icon = () => null;
function Dialog() {} function UploadStatus() {}
function nodes(tree, predicate) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate)); return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)]; }
function text(tree) { if (tree === null || tree === undefined || typeof tree === 'boolean') return ''; if (typeof tree !== 'object') return String(tree); return Array.isArray(tree) ? tree.map(text).join('') : text(tree.props?.children); }
/** The screen's own words: everything but the data it shows inside <bdi> (names, codes, numbers) and <option> values. */
function chrome(tree) { if (tree === null || tree === undefined || typeof tree === 'boolean') return ''; if (typeof tree !== 'object') return String(tree); if (Array.isArray(tree)) return tree.map(chrome).join(' '); if (tree.type === 'bdi') return ''; return chrome(tree.props?.children); }
const source = ts.createSourceFile('import.tsx', fs.readFileSync('app/erp-customers-import.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), stateNames = [];
(function find(node) { if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(source) === 'useState') stateNames.push(node.name.elements[0].name.getText(source)); ts.forEachChild(node, find); })(source);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(condition, what) { for (let i = 0; i < 100; i++) { if (condition()) return; await tick(); } throw Error('timed out waiting for ' + what); }

function harness(language, {failImports = 0} = {}) {
  const state = {}, refs = [], requests = [];
  let cursor = 0, refCursor = 0, closed = 0, imported = 0, tree;
  const hooks = {...React, useState(initial) { const name = stateNames[cursor++]; if (!Object.hasOwn(state, name)) state[name] = typeof initial === 'function' ? initial() : initial; return [state[name], value => { state[name] = typeof value === 'function' ? value(state[name]) : value; }]; }, useRef(value) { const index = refCursor++; return refs[index] || (refs[index] = {current: value}); }, useEffect: noop, useMemo: fn => fn(), useCallback: fn => fn};
  const submitJson = (url, options) => new Promise((resolve, reject) => requests.push({url, raw: options.body, body: JSON.parse(options.body), resolve: value => resolve(structuredClone(value)), reject}));
  const modules = {'react': hooks, 'react/jsx-runtime': jsx, '@/lib/i18n': {useLanguage: () => ({language}), t: value => value}, '@/lib/client-submit': {SubmitError: submit.SubmitError, definiteSubmitRejection: submit.definiteSubmitRejection, submitJson}, '@/lib/customer-identity': identity, '@/lib/erp-customers-shared': shared, '@/components/ui/dialog': {Dialog, DialogContent: pass, DialogTitle: pass, DialogDescription: pass}, './upload-status': {__esModule: true, default: UploadStatus}, 'lucide-react': new Proxy({}, {get: () => Icon})};
  const Component = load('app/erp-customers-import.tsx', name => modules[name] || (name.endsWith('.css') ? {} : assert.fail('unexpected import ' + name))).default;
  return {state, requests, closed: () => closed, imported: () => imported, tree: () => tree, render() { cursor = refCursor = 0; tree = Component({onClose: () => closed++, onImported: async () => { imported++; if (imported <= failImports) throw new Error('reload failed'); }}); return tree; }};
}
const say = (language, ar, en) => language === 'en' ? en : ar;
const button = (h, label) => nodes(h.tree(), node => node.type === 'button' && text(node).trim() === label)[0];
const applyButton = h => nodes(h.tree(), node => node.type === 'button' && /erp-customers-apply/.test(node.props.className || ''))[0];
const pick = (h, row, value) => nodes(h.tree(), node => node.type === 'button' && node.props['data-row'] === row && node.props['data-choice'] === value)[0];
const section = (h, name) => nodes(h.tree(), node => node.type === 'section' && node.props['data-section'] === name)[0];
const rowsIn = (h, name) => nodes(section(h, name), node => node.type === 'article').map(node => node.props['data-row']);
const tiles = h => nodes(h.tree(), node => node.props?.className === 'erp-import-counts')[0].props.children.map(tile => text(tile));
const select = (h, predicate) => nodes(h.tree(), node => node.type === 'select' && predicate(node))[0];
const ADD = shared.ERP_ADD_CUSTOMER;

const candidate = (id, name, number, code = '') => ({id, name, internalCode: 'YR-C-' + String(number).padStart(6, '0'), code, region: 'الوسطى', phones: ['4567'], matchedBy: 'name'});
const base = {row: 0, code: '', name: '', phones: [], status: 'auto', issue: '', matchedBy: '', candidates: [], customerId: '', add: false, chosen: false, conflict: false, codeRow: 0, from: '', to: '', change: false, mapping: false, sharedWith: 0};
const summary = (changes, adds = 1) => ({rows: 3, auto: 1, same: 0, choose: 1, similar: 0, new: 1, outOfRegion: 0, heldOutside: 0, invalid: 0, conflicts: 0, pending: changes > 1 ? 0 : 1, changes, codeChanges: changes, mappings: 1, adds});
const regions = ['', 'الوسطى', 'الشرقية', 'الغربية', 'الشمالية', 'الجنوبية'];
const first = {fileName: 'Customer.xlsx', sheet: 'Customer', snapshot: 'a'.repeat(64), summary: summary(1), newRegions: regions, newRegion: '', rows: [
  {...base, row: 3, code: '12', name: 'مصنع النور', phones: ['4567'], matchedBy: 'both', candidates: [{...candidate('nour', 'مصنع النور', 1, 'OLD'), matchedBy: 'both'}], customerId: 'nour', from: 'OLD', to: '12', change: true, mapping: true, sharedWith: 1},
  {...base, row: 5, code: '55', name: 'مصنع التوأم', status: 'choose', candidates: [candidate('twinA', 'مصنع التوأم', 4, 'T-1'), candidate('twinB', 'مصنع التوأم', 5)], to: '55'},
  {...base, row: 6, code: '77', name: 'مصنع غير موجود', status: 'new', add: true, to: '77'},
]};
const chosen = id => ({...first, summary: summary(2), rows: first.rows.map(row => row.row === 5 ? {...row, customerId: id, chosen: true, matchedBy: 'name', change: true, from: id === 'twinA' ? 'T-1' : ''} : row)});
const apply = (language, changes, adds) => say(language, `حدّث ${changes} كود وضيف ${adds} عميل`, `Update ${changes} code(s) and add ${adds} customer(s)`);
const arabic = /[؀-ۿ]/;
async function opened(language, answer) {
  const h = harness(language); h.render();
  nodes(h.tree(), node => node.type === 'input' && node.props.id === 'erp-customers-file')[0].props.onChange({target: {files: [{name: 'Customer.xlsx', size: 1200}], value: ''}});
  await until(() => h.requests.length === 1, 'the preview'); h.requests[0].resolve(answer); await until(() => h.state.preview, 'shown'); h.render();
  return h;
}

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
  eq(tiles(h), [t('هيتغير', 'Will change') + '1', t('محتاج تختار', 'Needs a choice') + '1', t('عملاء جداد', 'New customers') + '1', t('من غير تغيير', 'No change') + '0'], 'the counts');
  ok(text(h.tree()).includes(t('1 كود هيتغير، 1 عميل محتاج تختار، 1 عميل جديد هيتضاف.', '1 code(s) will change, 1 customer(s) need a choice, 1 new customer(s) will be added.')), 'the summary line: codes that change, customers to choose, new customers');
  eq([rowsIn(h, 'choose'), rowsIn(h, 'new'), rowsIn(h, 'rest')], [[5], [6], [3]], 'the sections: «محتاج تختار», «عملاء جداد هيتضافوا», the rest of the file');
  eq([pick(h, 5, 'twinA').props['aria-pressed'], pick(h, 5, 'twinB').props['aria-pressed'], pick(h, 5, '').props['aria-pressed'], !!pick(h, 5, ADD)], [false, false, false, false], 'nothing is chosen for an ambiguous row, and a choose row offers no «عميل جديد»');
  eq([text(pick(h, 5, 'twinA')), text(pick(h, 5, ''))], [t('ده هو', 'This one'), t('سيبه', 'Leave it')], '«ده هو» and «سيبه»');
  ok(text(h.tree()).includes('YR-C-000004') && text(h.tree()).includes('YR-C-000005'), 'each candidate with its Yourrest code');
  ok(text(section(h, 'choose')).includes(t('السبب', 'Why') + ': ' + t('بالاسم', 'by name')) && text(section(h, 'choose')).includes(t('الوسطى', 'Central')), 'and why it is offered, and its region');
  ok(text(section(h, 'new')).includes(t('هيتضافوا باسمك', 'added under your name')) && text(section(h, 'new')).includes(t('«تعديل»', '“Edit”')), 'new customers: under the uploader\'s name, movable later from «تعديل»');
  eq([pick(h, 6, '').props['aria-pressed'], text(pick(h, 6, ''))], [false, t('سيبه', 'Leave it')], 'a new row is added unless «سيبه» is pressed');
  const regionSelect = select(h, node => node.props.id === 'erp-customers-region');
  eq([regionSelect.props.value, nodes(regionSelect, node => node.type === 'option').map(option => [option.props.value, text(option)])], ['', regions.map(value => [value, value ? t(value, {'الوسطى': 'Central', 'الشرقية': 'Eastern', 'الغربية': 'Western', 'الشمالية': 'Northern', 'الجنوبية': 'Southern'}[value]) : t('المنطقة غير محددة', 'Region not specified')])], 'the region of the new customers: «المنطقة غير محددة» by default, the regions the server allows');
  eq([text(applyButton(h)).trim(), applyButton(h).props.disabled], [apply(language, 1, 1), false], 'the matched rows can be applied as they are: «حدّث 1 كود وضيف 1 عميل»');
  if (language === 'en') ok(!arabic.test(chrome(h.tree())), 'English: no Arabic left in the screen\'s own words (preview): ' + chrome(h.tree()).match(/[^ ]*[؀-ۿ][^ ]*/g)?.slice(0, 5).join(' | '));

  // ---- a choice is previewed again; choices made meanwhile follow in one more request, the last one wins
  pick(h, 5, 'twinA').props.onClick(); h.render();
  await until(() => h.requests.length === 2, 'the preview with the choice');
  eq(h.requests[1].body.choices, [{row: 5, customerId: 'twinA'}], 'the choice goes with the preview');
  eq(applyButton(h).props.disabled, true, 'no apply while the preview catches up');
  pick(h, 5, 'twinB').props.onClick(); pick(h, 5, '').props.onClick(); pick(h, 5, 'twinB').props.onClick(); h.render();
  eq(pick(h, 5, 'twinB').props['aria-pressed'], true, 'the latest choice shows at once');
  h.requests[1].resolve(chosen('twinA'));
  await until(() => h.requests.length === 3, 'one more preview for the later choices');
  eq([h.requests.length, h.requests[2].body.choices], [3, [{row: 5, customerId: 'twinB'}]], 'only the latest choices are sent again');
  h.requests[2].resolve(chosen('twinB')); await until(() => !h.state.refreshing, 'the preview settled'); h.render();
  eq(h.state.preview.rows[1].customerId, 'twinB', 'the last answer is the one shown');
  eq([text(applyButton(h)).trim(), applyButton(h).props.disabled], [apply(language, 2, 1), false], 'ready to apply, the counts live: «حدّث 2 كود وضيف 1 عميل»');
  // the region for every new customer, and one row's own
  select(h, node => node.props.id === 'erp-customers-region').props.onChange({target: {value: 'الوسطى'}}); h.render();
  const own = select(h, node => node.props.id !== 'erp-customers-region');
  eq([own.props.value, text(nodes(own, node => node.type === 'option')[0])], ['*', t('زي المنطقة اللي فوق', 'Same as above')], 'a new row follows the region above unless given its own');
  own.props.onChange({target: {value: 'الشرقية'}}); h.render();
  eq([select(h, node => node.props.id === 'erp-customers-region').props.value, select(h, node => node.props.id !== 'erp-customers-region').props.value, h.requests.length], ['الوسطى', 'الشرقية', 3], 'the regions change without a new preview');

  // ---- the apply: lost answer → locked, retried with the very same request
  applyButton(h).props.onClick();
  await until(() => h.requests.length === 4, 'the apply');
  const sent = h.requests[3];
  eq([sent.body.action, sent.body.snapshot, sent.body.choices, /^[0-9a-f-]{36}$/.test(sent.body.requestId), sent.body.base64, sent.body.region, sent.body.regions, sent.body.adds], ['apply', 'a'.repeat(64), [{row: 5, customerId: 'twinB'}], true, h.requests[0].body.base64, 'الوسطى', [{row: 6, region: 'الشرقية'}], 1], 'the apply carries the same file, the snapshot, the choices, the regions, the number of new customers shown (additions are opt-in on the server) and a request id');
  sent.reject(new submit.SubmitError('Disconnected')); await until(() => h.state.pending, 'the unconfirmed state'); h.render();
  ok(button(h, t('تأكيد الحفظ', 'Confirm save')), 'an unconfirmed apply offers to confirm it');
  eq([pick(h, 5, 'twinA').props.disabled, pick(h, 6, '').props.disabled, select(h, node => node.props.id === 'erp-customers-region').props.disabled], [true, true, true], 'the choices and the regions are locked');
  nodes(h.tree(), node => node.type === Dialog)[0].props.onOpenChange(false);
  eq(h.closed(), 0, 'the dialog cannot be dismissed with an unconfirmed write');
  button(h, t('تأكيد الحفظ', 'Confirm save')).props.onClick();
  await until(() => h.requests.length === 5, 'the retry');
  eq(h.requests[4].raw, sent.raw, 'the retry is the very same request, request id included');
  h.requests[4].resolve({ok: true, updated: 2, mappings: 1, changed: 2, added: 1, unchanged: 0, skipped: 0, outOfRegion: 0, invalid: 0, changes: [{row: 3, customerId: 'nour', from: 'OLD', to: '12', mapping: true}, {row: 5, customerId: 'twinB', from: '', to: '55', mapping: false}], additions: [{row: 6, customerId: 'crm-owner-erp-x-6', code: '77', name: 'مصنع غير موجود', region: 'الشرقية', internalCode: 'YR-C-000042'}], alreadySaved: true});
  await until(() => h.imported() === 1, 'the customers reload'); h.render();
  ok(text(h.tree()).includes(t('تم تحديث الأكواد وإضافة العملاء', 'Codes updated and customers added')), 'the result');
  eq(nodes(h.tree(), node => node.type === 'ol').map(list => list.props.children.length), [2, 1], 'what changed and what was added, listed');
  ok(text(h.tree()).includes('YR-C-000001') && text(h.tree()).includes('YR-C-000042') && text(h.tree()).includes(t('الشرقية', 'Eastern')), 'by Yourrest code, the added one with its new number and region');
  ok(text(h.tree()).includes(t('عملاء اتضافوا', 'Customers added') + ': 1') && text(h.tree()).includes(t('متساب', 'Left') + ': 0'), 'the counts: added, left');
  ok(text(h.tree()).includes(t('مفيش سطور اتسابت.', 'No rows were left.')), 'and nothing left to list');
  if (language === 'en') ok(!arabic.test(chrome(h.tree())), 'English: no Arabic left in the result');
  eq(applyButton(h), undefined, 'nothing more to apply');
  button(h, t('تم', 'Done')).props.onClick(); eq(h.closed(), 1, 'done closes');

  // ---- a new row left out («سيبه»), then added again; a similar name: «ده هو», «عميل جديد», «سيبه», nothing pressed at first
  const similarRow = {...base, row: 8, code: '9001', name: 'مصنع الصفا للبلوك الحديث', status: 'similar', candidates: [{...candidate('c302', 'مصنع الصفا للبلوك الاسمنتي', 302, '345'), matchedBy: 'similar'}], to: '9001'};
  const withSimilar = {...first, summary: {...summary(1), similar: 1, pending: 2}, rows: [...first.rows, similarRow]};
  const n = await opened(language, withSimilar);
  eq([rowsIn(n, 'choose'), pick(n, 8, 'c302').props['aria-pressed'], pick(n, 8, ADD).props['aria-pressed'], pick(n, 8, '').props['aria-pressed']], [[5, 8], false, false, false], 'a similar row is in «محتاج تختار» with nothing pressed');
  eq(text(pick(n, 8, ADD)), t('عميل جديد', 'New customer'), 'with «عميل جديد»');
  ok(text(section(n, 'choose')).includes(t('اسم قريب', 'similar name')) && text(section(n, 'choose')).includes(t('لو ما اخترتش مش هيتغير حاجة', 'Without a choice nothing changes')), 'why it is offered, and that no choice changes nothing');
  ok(text(n.tree()).includes(t('2 عميل محتاج تختار', '2 customer(s) need a choice')), 'counted as needing a choice');
  pick(n, 8, ADD).props.onClick(); n.render();
  await until(() => n.requests.length === 2, 'the preview with «عميل جديد»');
  eq(n.requests[1].body.choices, [{row: 8, customerId: ADD}], '«عميل جديد» goes as its own value');
  n.requests[1].resolve({...withSimilar, summary: {...withSimilar.summary, adds: 2, pending: 1}, rows: withSimilar.rows.map(row => row.row === 8 ? {...row, add: true, chosen: true} : row)}); await until(() => !n.state.refreshing, 'settled'); n.render();
  eq([pick(n, 8, ADD).props['aria-pressed'], text(applyButton(n)).trim()], [true, apply(language, 1, 2)], '«عميل جديد» pressed, and one more customer to add');
  pick(n, 6, '').props.onClick(); n.render();
  await until(() => n.requests.length === 3, 'the preview with a new row left');
  eq(n.requests[2].body.choices, [{row: 6, customerId: ''}, {row: 8, customerId: ADD}], '«سيبه» on a new row');
  n.requests[2].resolve({...withSimilar, summary: {...withSimilar.summary, adds: 1, pending: 1}, rows: withSimilar.rows.map(row => row.row === 8 ? {...row, add: true, chosen: true} : row.row === 6 ? {...row, add: false, chosen: true} : row)}); await until(() => !n.state.refreshing, 'settled'); n.render();
  eq([pick(n, 6, '').props['aria-pressed'], text(applyButton(n)).trim(), !!select(n, node => node.props.id !== 'erp-customers-region')], [true, apply(language, 1, 1), false], 'the row is left: pressed, not counted, no region of its own');
  ok(text(section(n, 'new')).includes(t('متساب؛ مش هيتضاف.', 'Left; it will not be added.')), 'and says so');
  pick(n, 6, '').props.onClick(); n.render();
  await until(() => n.requests.length === 4, 'the preview with the new row back');
  eq(n.requests[3].body.choices, [{row: 8, customerId: ADD}], 'pressing «سيبه» again puts the row back (its default: added)');

  // ---- accessible names: each «ده هو» names its candidate; a new row's «سيبه» is inside a group named by its row
  const named = await opened(language, first);
  eq([pick(named, 5, 'twinA').props['aria-label'], pick(named, 5, 'twinB').props['aria-label']], [t('ده هو', 'This one') + ': مصنع التوأم · YR-C-000004', t('ده هو', 'This one') + ': مصنع التوأم · YR-C-000005'], '«ده هو» is named with the candidate\'s name and Yourrest code, so two candidates never read the same');
  const newGroup = nodes(section(named, 'new'), node => node.props?.role === 'group')[0];
  eq([newGroup?.props['aria-label'], nodes(newGroup, node => node.type === 'button' && node.props['data-row'] === 6).length], [t('سطر 6 · رقم ERP 77', 'Row 6 · ERP number 77'), 1], 'a new row\'s «سيبه» is in a group named by its row and ERP number');
  eq(nodes(section(named, 'choose'), node => node.props?.role === 'group').map(group => group.props['aria-label']), [t('العميل لـسطر 5 · رقم ERP 55', 'Customer for Row 5 · ERP number 55')], 'and the candidates\' group by the row and its ERP number');

  // ---- only a similar row, switched to «عميل جديد»: the region select, the note about the uploader, and the region sent with the apply
  const onlySimilar = {...first, summary: {...summary(0, 0), choose: 0, new: 0, similar: 1, pending: 1}, rows: [similarRow]};
  const o = await opened(language, onlySimilar);
  eq([!!section(o, 'new'), !!select(o, node => node.props.id === 'erp-customers-region')], [false, false], 'nothing to add yet: no new-customers part');
  pick(o, 8, ADD).props.onClick(); await until(() => o.requests.length === 2, 'the preview with «عميل جديد»');
  o.requests[1].resolve({...onlySimilar, summary: {...onlySimilar.summary, adds: 1, pending: 0}, rows: [{...similarRow, add: true, chosen: true}]}); await until(() => !o.state.refreshing, 'settled'); o.render();
  ok(!!section(o, 'new') && text(section(o, 'new')).includes(t('هيتضافوا باسمك', 'added under your name')) && text(section(o, 'new')).includes(t('«تعديل»', '“Edit”')), 'a similar row marked «عميل جديد» shows the new-customers part with the note about the uploader');
  ok(text(section(o, 'new')).includes(t('منهم 1 من «محتاج تختار» اخترت لهم «عميل جديد».', '1 of them are rows in “Needs a choice” you marked “New customer”.')), 'and says where that customer comes from');
  eq([rowsIn(o, 'new'), rowsIn(o, 'choose')], [[], [8]], 'the row itself stays where it was chosen');
  select(o, node => node.props.id === 'erp-customers-region').props.onChange({target: {value: 'الشرقية'}}); o.render();
  eq([text(applyButton(o)).trim(), applyButton(o).props.disabled], [apply(language, 0, 1), false], '«حدّث 0 كود وضيف 1 عميل»');
  applyButton(o).props.onClick(); await until(() => o.requests.length === 3, 'the apply');
  eq([o.requests[2].body.choices, o.requests[2].body.region, o.requests[2].body.adds], [[{row: 8, customerId: ADD}], 'الشرقية', 1], 'the region chosen for it goes with the apply, and the one customer it adds');

  // ---- a row stays in the part where the user acted on it: a conflict resolved there, or a preselected row picked again
  const cRow = {...base, row: 3, code: '12', name: 'مصنع النور', phones: ['4567'], status: 'choose', conflict: true, matchedBy: 'phone', candidates: [{...candidate('nour', 'مصنع النور', 1, 'OLD'), matchedBy: 'phone'}], customerId: 'nour', from: 'OLD', to: '12', change: false};
  const sRow = {...similarRow, candidates: [{...candidate('nour', 'مصنع النور', 1, 'OLD'), matchedBy: 'similar'}], customerId: 'nour', chosen: true, conflict: true};
  const sameRow = {...base, row: 9, code: 'T-1', name: 'مصنع التوأم', status: 'same', matchedBy: 'name', candidates: [candidate('twinA', 'مصنع التوأم', 4, 'T-1'), candidate('twinB', 'مصنع التوأم', 5)], customerId: 'twinA', from: 'T-1', to: 'T-1'};
  const moving = {...first, summary: {...summary(0, 0), conflicts: 2}, rows: [cRow, sRow, sameRow]};
  const k = await opened(language, moving);
  eq([rowsIn(k, 'choose'), rowsIn(k, 'rest')], [[3, 8], [9]], 'the two rows on one customer are in «محتاج تختار»');
  pick(k, 3, '').props.onClick(); await until(() => k.requests.length === 2, 'the preview with row 3 left');
  k.requests[1].resolve({...moving, summary: {...moving.summary, conflicts: 0, changes: 1}, rows: [{...cRow, status: 'auto', conflict: false, customerId: '', chosen: true, matchedBy: ''}, {...sRow, conflict: false, change: true}, sameRow]}); await until(() => !k.state.refreshing, 'settled'); k.render();
  eq([rowsIn(k, 'choose'), pick(k, 3, '').props['aria-pressed']], [[3, 8], true], 'row 3, left there, stays in «محتاج تختار» with «سيبه» pressed (it does not vanish into the other rows)');
  k.state.filter = 'same'; k.render();
  pick(k, 9, 'twinA').props.onClick(); await until(() => k.requests.length === 3, 'the preview with row 9 picked again');
  k.requests[2].resolve({...moving, summary: {...moving.summary, conflicts: 0, changes: 1}, rows: [{...cRow, status: 'auto', conflict: false, customerId: '', chosen: true, matchedBy: ''}, {...sRow, conflict: false, change: true}, {...sameRow, status: 'choose', chosen: true}]}); await until(() => !k.state.refreshing, 'settled'); k.render();
  eq([rowsIn(k, 'choose'), rowsIn(k, 'rest')], [[3, 8], [9]], 'a preselected row picked again in «باقي سطور الملف» stays there, still shown under its filter');

  // ---- a stale preview: 409 → a new preview, which starts the choices over
  const s = await opened(language, first);
  pick(s, 5, 'twinA').props.onClick(); await until(() => s.requests.length === 2, 're-preview'); s.requests[1].resolve(chosen('twinA')); await until(() => !s.state.refreshing, 'settled'); s.render();
  applyButton(s).props.onClick(); await until(() => s.requests.length === 3, 'the apply');
  s.requests[2].reject(new submit.SubmitError('اتغيرت بيانات العملاء من وقت المعاينة؛ اعمل معاينة جديدة', 409, {error: 'اتغيرت بيانات العملاء من وقت المعاينة؛ اعمل معاينة جديدة'}));
  await until(() => s.state.stale, 'the stale state'); s.render();
  ok(text(s.tree()).includes(t('اتغيرت بيانات العملاء من وقت المعاينة؛ اعمل معاينة جديدة', 'Customer data changed since the preview. Run a new preview.')), 'the stale message, in the reader\'s language');
  eq([s.state.pending, pick(s, 5, 'twinA').props.disabled, !!applyButton(s)], [false, true, false], 'no retry of the stale request; choices locked; no apply');
  nodes(nodes(s.tree(), node => node.type === 'footer')[0], node => node.type === 'button' && text(node).trim() === t('معاينة جديدة', 'New preview'))[0].props.onClick();
  await until(() => s.requests.length === 4, 'a new preview');
  eq([s.requests[3].body.action, s.requests[3].body.choices], ['preview', []], 'the new preview starts the choices over');
  s.requests[3].resolve(first); await until(() => !s.state.stale, 'fresh'); s.render();
  eq([Object.keys(s.state.choices).length, s.state.region, Object.keys(s.state.rowRegions).length], [0, null, 0], 'no choice or region carried over');

  // ---- two rows on one customer, and nothing to change: the button stays off
  // Another row still has a change to make: only the conflict keeps the button off.
  const c = await opened(language, {...first, summary: {...summary(1, 0), conflicts: 2, changes: 1}, rows: [{...first.rows[0], status: 'choose', conflict: true}, {...first.rows[0], row: 4, code: '13', status: 'choose', conflict: true}, {...first.rows[0], row: 7, code: '70', candidates: [candidate('fajr', 'مصنع الفجر', 2)], customerId: 'fajr', from: '', to: '70', mapping: false, sharedWith: 0}]});
  eq(applyButton(c).props.disabled, true, 'two rows on one customer: no apply, although another row would change');
  ok(!!pick(c, 3, '') && !!pick(c, 4, ''), 'each conflicting row can be left');
  ok(text(c.tree()).includes(t('نفس العميل في أكتر من سطر', 'Same customer on several rows')), 'and says why');
  applyButton(c).props.onClick(); await tick(); await tick();
  eq([c.requests.length, c.state.busy], [1, null], 'the handler itself refuses while the button is off: nothing is sent');
  const z = await opened(language, {...first, summary: {...summary(0, 0), pending: 0}, rows: [{...first.rows[0], customerId: 'nour', change: false, mapping: false, from: '12'}]});
  eq([text(applyButton(z)).trim(), applyButton(z).props.disabled], [apply(language, 0, 0), true], 'nothing to change or add: «حدّث 0 كود وضيف 0 عميل», off');
  const big = await opened(language, {...first, summary: {...summary(1), adds: shared.ERP_CUSTOMERS_MAX_ADDS + 1}});
  eq(applyButton(big).props.disabled, true, 'more new customers than one apply may add: off');
  ok(text(big.tree()).includes(t(`أقصى عدد للعملاء الجداد في المرة الواحدة ${shared.ERP_CUSTOMERS_MAX_ADDS}`, `At most ${shared.ERP_CUSTOMERS_MAX_ADDS} new customers`)), 'and says how many at most');

  // ---- rows that explain themselves: a number held outside the regions, too many matches, a code that is another row, no name, by code
  const e = await opened(language, {...first, summary: {...summary(0, 0), heldOutside: 1, invalid: 3, choose: 1, pending: 1, changes: 0}, rows: [
    {...base, row: 3, code: '12', name: 'مصنع الوسط', status: 'held-outside', to: '12'},
    {...base, row: 4, code: '13', name: 'مصنع مشترك', status: 'invalid', issue: 'too-many-matches', to: '13'},
    {...base, row: 5, code: '14', name: 'مصنع كثير الأرقام', status: 'invalid', issue: 'too-many-phones', to: '14'},
    {...base, row: 6, code: '57', name: 'شركة اخرى', status: 'choose', codeRow: 3, candidates: [{...candidate('amal', 'مصنع الأمل', 9, '12'), matchedBy: 'phone'}], to: '57'},
    {...base, row: 7, code: '58', name: '', status: 'invalid', issue: 'no-name', to: '58'},
    {...base, row: 9, code: '345', name: 'اسم تاني', status: 'same', matchedBy: 'code', candidates: [{...candidate('coded', 'مصنع مختلف', 10, '345'), matchedBy: 'code'}], customerId: 'coded', from: '345', to: '345'},
  ]});
  e.state.filter = 'all'; e.render();
  const all = text(e.tree());
  ok(all.includes(t('الرقم عند عميل خارج مناطقك', 'Number held outside your regions')) && all.includes(t('ربطه لمدير النظام', 'only the system administrator can link it')), 'a number held outside the regions: why, and who can link it');
  ok(all.includes(t('بيطابق عملاء كتير', 'Matches too many customers')) && all.includes(t('أكتر من 20 عميل', 'More than 20 customers')), 'too many matches');
  ok(all.includes(t('أرقام جوال كتير في السطر', 'Too many phone numbers in the row')), 'too many phone numbers');
  ok(all.includes(t('موجود في سطر 3 من الملف', 'is row 3 of the file')), 'a code that is another row: the user confirms');
  ok(all.includes(t('من غير اسم', 'No name')) && all.includes(t('مش هيتضاف', 'it is not added')), 'a row without a name is not added');
  ok(all.includes(t('نفس الكود', 'same code')) && all.includes(t('مش هيتغير حاجة ومش هيتضاف عميل', 'nothing changes and no customer is added')), 'a row found by its code: nothing changes, nothing added');
  eq([!!pick(e, 3, ''), !!pick(e, 4, ''), !!pick(e, 6, ''), !!pick(e, 7, ''), !!pick(e, 9, 'coded')], [false, false, true, false, true], 'only the rows with a candidate offer a choice');
  ok(all.includes(t('الرقم عند عميل خارج مناطقك', 'Number held outside your regions') + ': 1'), 'counted in the summary line');
  if (language === 'en') ok(!arabic.test(chrome(e.tree())), 'English: no Arabic left in the explanations');

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
  for (const [message, english] of [['السطر 6 مش عميل جديد؛ اعمل معاينة جديدة', 'Row 6 is not a new customer'], ['الشاشة دي ما عرضتش العملاء الجداد اللي هيتضافوا؛ حدّث الصفحة واعمل معاينة جديدة', 'Reload the page and run a new preview'], ['لا يمكنك إنشاء أو نقل عميل خارج منطقتك المسموح بها', 'outside your regions'], ['أقصى عدد للعملاء الجداد في المرة الواحدة 2000؛ سيب الباقي وضيفهم في مرة تانية.', 'At most 2000 new customers'], ['لا توجد أكواد تتغير ولا عملاء جدد في هذا الملف.', 'Nothing in this file changes a code or adds a customer']]) {
    const x = await opened(language, first); applyButton(x).props.onClick(); await until(() => x.requests.length === 2, 'the apply');
    x.requests[1].reject(new submit.SubmitError(message, 400, {error: message})); await until(() => x.state.error, 'the refusal'); x.render();
    ok(text(x.tree()).includes(t(message, english)), 'the new refusals in the reader\'s language: ' + english);
  }

  // ---- saved but the customers did not reload: «تحديث العرض بس» reloads only, it never sends the update again
  const f = harness(language, {failImports: 1}); f.render();
  nodes(f.tree(), node => node.type === 'input' && node.props.id === 'erp-customers-file')[0].props.onChange({target: {files: [{name: 'Customer.xlsx', size: 1200}], value: ''}});
  await until(() => f.requests.length === 1, 'the preview'); f.requests[0].resolve(first); await until(() => f.state.preview, 'shown'); f.render();
  applyButton(f).props.onClick(); await until(() => f.requests.length === 2, 'the apply');
  eq([f.requests[1].body.region, f.requests[1].body.regions], ['', []], 'the default region goes with the apply');
  f.requests[1].resolve({ok: true, updated: 1, mappings: 1, changed: 1, added: 1, unchanged: 0, skipped: 1, outOfRegion: 0, heldOutside: 0, invalid: 0, changes: [{row: 3, customerId: 'nour', from: 'OLD', to: '12', mapping: true}], additions: [{row: 6, customerId: 'crm-owner-erp-y-6', code: '77', name: 'مصنع غير موجود', region: '', internalCode: 'YR-C-000043'}]});
  await until(() => f.state.refreshFailed, 'the failed reload'); f.render();
  const leftList = nodes(f.tree(), node => node.type === 'ol' && /erp-customers-left/.test(node.props.className || ''))[0];
  eq([leftList?.props.children.length, text(leftList).includes('55') && text(leftList).includes('مصنع التوأم') && text(leftList).includes(t('سطر', 'Row') + ' 5'), text(leftList).includes(t('ما اخترتش العميل', 'No customer chosen'))], [1, true, true], 'what was left is listed too: the row, its ERP number and name, and why (no choice made)');
  if (language === 'en') ok(!arabic.test(chrome(nodes(f.tree(), node => node.type === 'section' && node.props.className === 'erp-customers-result')[0])), 'English: no Arabic left in the result lists');
  ok(text(f.tree()).includes(t('اتحفظ التحديث، لكن تعذر تحديث قائمة العملاء', 'The update was saved, but the customer list could not refresh')), 'the update is kept and the failed reload is said');
  button(f, t('تحديث العرض بس', 'Refresh view only')).props.onClick();
  await until(() => f.imported() === 2 && !f.state.busy, 'the second reload'); f.render();
  eq([f.requests.length, f.state.refreshFailed, !!button(f, t('تحديث العرض بس', 'Refresh view only'))], [2, false, false], 'it reloads without sending the update again, and the button goes once the list is fresh');
}

console.log(JSON.stringify({ok: true, checks, coverage: 'ERP customer import dialog: file checks, immediate preview, summary line and counts, the needs-choice / new-customers / rest sections, «ده هو» / «عميل جديد» / «سيبه» (nothing pressed on a similar row), a new row left and put back, the region select and a row\'s own region, serialized re-preview with the latest choices, the live apply label, apply payload with regions, unconfirmed apply locked and retried byte for byte, stale 409 and a fresh preview, conflicts (button and handler), nothing to apply, the 2000 limit, held-outside / too many matches / too many phones / code in another row / no name / by code, server messages in English, what changed and what was added, a failed reload after the apply; Arabic/English with no Arabic left in English', realBrowser: false}));
