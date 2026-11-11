// The four targets decisions the owner approved on 2026-11-10 («نفذ 1 و2 و3 و4»), their pure rules. Synthetic data, fixed clocks.
// 1. A finished month (before this month in Riyadh) is read only for everyone but the administrator.
// 2. «سجل التعديلات»: an audit row read as who / when / month / what changed (before → after); a row written before the earlier
//    values were kept shows the saved values with «تفاصيل غير متاحة».
// 3. The phone cards of «توزيع المستهدفات» (≤ 480 px) are in the page and its stylesheet.
// 4. The administrator is left out of a month's targets unless they have a target effective that month or a confirmed sale in it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';

const root = process.cwd(), nativeRequire = createRequire(import.meta.url), cache = new Map();
const compiler = {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true};
function load(file, require) { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {compilerOptions: compiler}).outputText, {exports, require, console, Intl, Date, structuredClone}); return exports; }
function library(file) { if (cache.has(file)) return cache.get(file); const result = load(file, name => name.startsWith('.') ? library(path.join(path.dirname(file), name) + '.ts') : nativeRequire(name)); cache.set(file, result); return result; }
const targets = library('lib/targets.ts'), history = library('lib/targets-history.ts');
const {riyadhMonth, targetMonthClosed, canEditTargetMonth, hiddenAdminIds, CLOSED_MONTH_MESSAGE, targetProducts, defaultActivityTargets} = targets;
let checks = 0;
const plain = value => value === undefined ? value : JSON.parse(JSON.stringify(value));
const eq = (actual, expected, message) => { assert.deepEqual(plain(actual), plain(expected), message); checks++; };

// ---- 1. finished months, by the clock of Riyadh (UTC+3)
const lastSecondOfOctober = new Date('2026-10-31T20:59:59Z'), firstSecondOfNovember = new Date('2026-10-31T21:00:00Z');
eq([riyadhMonth(lastSecondOfOctober), riyadhMonth(firstSecondOfNovember)], ['2026-10', '2026-11'], 'the month turns at midnight in Riyadh, not in UTC');
eq([targetMonthClosed('2026-10', lastSecondOfOctober), targetMonthClosed('2026-10', firstSecondOfNovember)], [false, true], 'October closes at the first second of November in Riyadh');
eq(['2025-12', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01'].map(m => targetMonthClosed(m, firstSecondOfNovember)), [true, true, true, false, false, false], 'every earlier month is finished; this month and the next ones are open');
for (const role of ['manager', 'supervisor', 'rep', 'customer_service']) eq(canEditTargetMonth(role, '2026-10', firstSecondOfNovember), false, role + ': a finished month is read only');
eq(canEditTargetMonth('admin', '2026-10', firstSecondOfNovember), true, 'the administrator keeps editing a finished month');
eq([canEditTargetMonth('manager', '2026-11', firstSecondOfNovember), canEditTargetMonth('manager', '2026-12', firstSecondOfNovember)], [true, true], 'this month and a future month stay editable');
eq(CLOSED_MONTH_MESSAGE, 'انتهى هذا الشهر؛ تعديل مستهدفاته لمدير النظام فقط', 'the message the owner chose');
const dictionary = JSON.parse(fs.readFileSync('lib/locales/en.json', 'utf8'));
eq(typeof dictionary[CLOSED_MONTH_MESSAGE] === 'string' && !/[؀-ۿ]/.test(dictionary[CLOSED_MONTH_MESSAGE]), true, 'and its English');
const server = fs.readFileSync('lib/targets-server.ts', 'utf8');
const lock = server.indexOf("if(closed&&c.me.role!=='admin')throw new CRMError(CLOSED_MONTH_MESSAGE,403)"), firstWrite = server.indexOf('c.db.batch([write,audit])');
eq(lock > 0 && lock < firstWrite, true, 'the server refuses a finished month before anything is written');
eq(server.indexOf('if(await replay())return{ok:true};') < lock, true, 'a save already recorded is still answered as saved (a retry after the month turned)');
eq(/kpi-evidence|crm_kpi_assessments/.test(server), false, 'the evidence and the evaluation entry are not touched by the lock');

// ---- 4. the administrator in the targets of a month
const members = [{id: 'owner', role: 'admin'}, {id: 'owner2', role: 'admin'}, {id: 'sm', role: 'manager'}, {id: 'rep1', role: 'rep'}];
const quantities = {products: targetProducts.map(p => ({product: p.id, quantity: 1}))};
const set = (kind, scopeId, month, extra = {}) => ({kind, scopeId, month, version: 1, updatedAt: '', data: kind === 'activity' ? defaultActivityTargets : quantities, ...extra});
const state = (sets, month = '2026-11') => ({month, branches: ['الرئيسي'], sets});
const sale = (repId, date, status = 'confirmed') => ({repId, date, status});
eq(hiddenAdminIds(state([]), members, []), ['owner', 'owner2'], 'no target and no sale: every administrator is left out; nobody else ever is');
eq(hiddenAdminIds(state([set('sales', 'owner', '2026-11')]), members, []), ['owner2'], 'a product target this month keeps the administrator');
eq(hiddenAdminIds(state([set('activity', 'owner', '2026-08')]), members, []), ['owner2'], 'a customer and visit target carried from an earlier month keeps them too');
eq(hiddenAdminIds(state([set('sales', 'owner', '2026-12')]), members, []), ['owner', 'owner2'], 'a target that starts next month does not');
eq(hiddenAdminIds(state([set('weights', 'company', '2026-11'), set('sales', 'branch:الرئيسي', '2026-11')]), members, []), ['owner', 'owner2'], 'the company weights and the branch target are nobody\'s own target');
eq(hiddenAdminIds(state([]), members, [sale('owner', '2026-11-30')]), ['owner2'], 'a confirmed sale this month (CRM or ERP) keeps the administrator');
eq(hiddenAdminIds(state([]), members, [sale('owner', '2026-11-03', 'void'), sale('owner', '2026-10-31')]), ['owner', 'owner2'], 'a voided sale or a sale of another month does not');

// ---- 2. the change history
const row = (detail, extra = {}) => ({id: 'target-set:sm:' + (extra.id || 'a'), actor: 'مدير المبيعات', created_at: '2026-11-10T09:00:00.000Z', detail: JSON.stringify(detail)});
const products = values => ({products: targetProducts.map((p, i) => ({product: p.id, quantity: values[i] ?? null}))});
const base = {kind: 'sales', scopeId: 'rep1', month: '2026-11', version: 1, inheritedFrom: null};
let entry = history.targetHistoryEntry(row({...base, data: products([25, 8, 0]), before: {month: '2026-11', data: products([20, 8, null])}}));
eq([entry.actor, entry.month, entry.kind, entry.detailsAvailable, entry.beforeFrom, entry.closedMonth], ['مدير المبيعات', '2026-11', 'sales', true, 'saved', false], 'a save of this month\'s own set');
eq(entry.changes.map(c => [c.label, c.unit, c.before, c.after]), [[targetProducts[0].name, targetProducts[0].unit, 20, 25], [targetProducts[2].name, targetProducts[2].unit, null, 0]], 'only the products that changed, «غير محدد» (null) to a zero kept apart');
entry = history.targetHistoryEntry(row({...base, version: 0, inheritedFrom: {month: '2026-09', version: 2}, data: products([30]), before: {month: '2026-09', data: products([20])}, closedMonth: true}));
eq([entry.beforeFrom, entry.beforeMonth, entry.closedMonth, entry.changes.map(c => [c.before, c.after])], ['carried', '2026-09', true, [[20, 30]]], 'a save over values carried from an earlier month, by the administrator in a finished month');
entry = history.targetHistoryEntry(row({...base, kind: 'activity', data: {newCustomers: 3, recoveredCustomers: 5, visits: 40}, before: {month: null, data: null}}));
eq([entry.beforeFrom, entry.changes.map(c => [c.field, c.before, c.after])], ['none', [['newCustomers', 10, 3], ['visits', 320, 40]]], 'a first customer and visit target: compared with the defaults the page showed (10 / 5 / 320)');
entry = history.targetHistoryEntry(row({kind: 'weights', scopeId: 'company', month: '2026-11', version: 1, inheritedFrom: null, data: {products: targetProducts.map((p, i) => ({product: p.id, weight: i ? 10 : 30}))}, before: {month: '2026-11', data: {products: targetProducts.map((p, i) => ({product: p.id, weight: i ? 10 : 30}))}}}));
eq([entry.detailsAvailable, entry.changes], [true, []], 'saved again with the same values: no change listed');
entry = history.targetHistoryEntry(row({...base, data: products([20, 8])}));
eq([entry.detailsAvailable, entry.beforeFrom, entry.changes.length, entry.changes[0].after, entry.changes[2].after], [false, null, targetProducts.length, 20, null], 'a row from before 2026-11-10: every saved value, earlier values «تفاصيل غير متاحة»');
eq(history.targetHistoryEntry({id: 'x', actor: 'a', created_at: '', detail: 'not json'}), null, 'a row that cannot be read is skipped');
eq(history.targetHistoryEntry(row({kind: 'other', month: '2026-11'})), null, 'and so is one of another kind');
eq(history.TARGET_HISTORY_PAGE, 20, 'twenty entries a page');
eq(server.includes("record_id=? AND id LIKE 'target-set:%' ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?"), true, 'newest first, a page at a time, from the rows the saves already write');

// ---- 3. the phone cards, and the page wiring
const page = fs.readFileSync('app/targets-workspace.tsx', 'utf8'), css = fs.readFileSync('app/targets-performance.css', 'utf8'), workspace = fs.readFileSync('app/sales-workspace.tsx', 'utf8');
eq(/@media \(max-width:480px\)\{\n \.targets-workspace \[data-slot=table-container\]:has\(>\.quantity-targets-table\),\.targets-workspace \.target-activity-panel\{display:none\}\n \.target-cards\{display:grid/.test(css), true, 'at 480 px and under, the cards replace both tables');
eq(css.includes('.target-cards{display:none}'), true, 'and above it the tables stay');
eq(['className="target-cards"', "say('تعديل الأصناف','Edit products')", "say('تعديل العملاء والزيارات','Edit customers & visits')", 'TargetHistoryDialog', '!hiddenIds.has(m.id)', 'canEditTargetMonth(me.role,state.month)'].map(text => page.includes(text)), [true, true, true, true, true, true], 'the cards, their edit buttons, the history, the hidden administrators and the finished month in the page');
eq(workspace.includes('hidden={hiddenFromTargets} performance={payload.performance}'), true, 'the page hands the workspace the hidden administrators and the achieved quantities');
console.log(JSON.stringify({ok: true, checks, syntheticFixtures: true, productionDataUsed: false}));
