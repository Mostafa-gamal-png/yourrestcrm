// «تصدير كل المستهدفات» and «تصدير التقييم» hold what the page shows (2026-11-11 audit of «المستهدفات وتقييم الأداء»):
// the branch target and the company weights are named as the page names them (never «branch:…» or «company»); a person with
// nothing saved gets the default customer and visit targets and «غير محدد» product targets, as the tables show; each person's
// evaluation ends with the overall line (score, points, evaluated / applicable weight). And the product gauge of a summary card
// writes two decimals (54.55%, not 54.545455%), the same figure as the card's «نسبة تحقيق الصنف». Pure functions, synthetic data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';

const root = process.cwd(), nativeRequire = createRequire(import.meta.url), cache = new Map();
const compiler = {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true};
function load(file, require) { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {compilerOptions: compiler}).outputText, {exports, require, console, Intl, structuredClone}); return exports; }
function library(file) { if (cache.has(file)) return cache.get(file); const result = load(file, name => name.startsWith('.') ? library(path.join(path.dirname(file), name) + '.ts') : nativeRequire(name)); cache.set(file, result); return result; }
const {targetsCsvRows, performanceCsvRows, targetScopeName, targetsCsvHeaders, performanceCsvHeaders} = library('lib/targets-export.ts');
const {shownAchievement} = library('lib/targets-performance-summary.ts');
const {targetProducts, defaultActivityTargets} = library('lib/targets.ts'), {operationalIndicators, kpiSummary, metric} = library('lib/kpis.ts');
const dictionary = JSON.parse(fs.readFileSync('lib/locales/en.json', 'utf8'));
let checks = 0;
// Values made inside the vm realm are compared as plain data.
const plain = value => value === undefined ? value : JSON.parse(JSON.stringify(value));
const eq = (actual, expected, message) => { assert.deepEqual(plain(actual), plain(expected), message); checks++; };
const ar = value => value, en = value => dictionary[value] || value;

const members = [
  {id: 'owner', name: 'مدير النظام', role: 'admin', active: 1, branch: 'الرئيسي'},
  {id: 'sm', name: 'مدير المبيعات', role: 'manager', active: 1, branch: 'الرئيسي'},
  {id: 'sup', name: 'المشرف', role: 'supervisor', active: 1, branch: 'الرئيسي'},
  {id: 'rep1', name: 'مندوب أول', role: 'rep', active: 1, branch: 'الرئيسي'},
  {id: 'off', name: 'مندوب معطل', role: 'rep', active: 0, branch: 'الرئيسي'},
  {id: 'old', name: 'زميل سابق', role: 'rep', active: 1, branch: '', readOnly: true}
];
const quantities = values => ({products: targetProducts.map((p, i) => ({product: p.id, quantity: values[i] ?? 0}))});
const state = {month: '2026-11', branches: ['الرئيسي'], sets: [
  {kind: 'sales', scopeId: 'rep1', month: '2026-11', version: 1, updatedAt: '', data: quantities([20, 8])},
  {kind: 'sales', scopeId: 'branch:الرئيسي', month: '2026-11', version: 1, updatedAt: '', data: quantities([60, 12])},
  {kind: 'weights', scopeId: 'company', month: '2026-10', version: 1, updatedAt: '', data: {products: targetProducts.map((p, i) => ({product: p.id, weight: [40, 20, 10, 10, 10, 5, 5, 0][i]}))}},
  {kind: 'activity', scopeId: 'rep1', month: '2026-11', version: 1, updatedAt: '', data: {newCustomers: 3, recoveredCustomers: 2, visits: 40}},
  {kind: 'sales', scopeId: 'sm', month: '2026-11', version: 0, updatedAt: '', computed: true, teamMemberIds: ['rep1'], data: quantities([20, 8])},
  {kind: 'activity', scopeId: 'sm', month: '2026-11', version: 0, updatedAt: '', computed: true, teamMemberIds: ['sup', 'rep1'], data: {newCustomers: 13, recoveredCustomers: 7, visits: 360}},
  {kind: 'sales', scopeId: 'sup', month: '2026-11', version: 0, updatedAt: '', computed: true, teamMemberIds: ['rep1'], data: quantities([20, 8])}
]};

// ---- the scope column
eq(targetScopeName('branch:الرئيسي', members, ar), 'الفرع بالكامل · الرئيسي', 'a branch target is named as the page names it');
eq(targetScopeName('company', members, ar), 'كل المناديب', 'the company weights are named as the weights dialog names them');
eq(targetScopeName('branch:الرئيسي', members, en), 'Entire branch · الرئيسي', 'and in English');
eq(targetScopeName('rep1', members, ar), 'مندوب أول', 'a person by name');
eq(targetScopeName('gone', members, ar), 'gone', 'an id nobody can name stays as it is');

const rows = targetsCsvRows(state, members, '2026-11', ar);
eq(rows.every(row => row.length === targetsCsvHeaders.length), true, 'every row fills every column');
eq(rows.some(row => /^(branch:|company$)/.test(String(row[1]))), false, 'no raw scope id reaches the file');
const of = (scope, kind) => rows.filter(row => row[1] === scope && row[2] === kind);
eq(of('الفرع بالكامل · الرئيسي', 'مستهدفات الأصناف').map(row => row[4]), [60, 12, 0, 0, 0, 0, 0, 0], 'the branch target with its quantities');
eq(of('كل المناديب', 'أوزان التقييم').map(row => [row[4], row[5]]), [40, 20, 10, 10, 10, 5, 5, 0].map(w => [w, '2026-10']), 'the weights with the month they are effective from');
eq(of('مندوب أول', 'مستهدفات العملاء والزيارات').map(row => row[4]), [3, 2, 40], 'a saved activity target');
eq(of('مدير المبيعات', 'مستهدفات العملاء والزيارات').map(row => [row[4], row[5]]), [[13, 'محسوب من الفريق'], [7, 'محسوب من الفريق'], [360, 'محسوب من الفريق']], 'the manager computed from the team');
// The page lists the administrator, the supervisor and the deactivated representative with the defaults: so does the file.
for (const name of ['مدير النظام', 'المشرف', 'مندوب معطل']) {
  if (name === 'مندوب معطل') { eq(of(name, 'مستهدفات العملاء والزيارات').length, 0, 'a deactivated person with nothing saved is not on the page, nor in the file'); continue; }
  eq(of(name, 'مستهدفات العملاء والزيارات').map(row => [row[3], row[4], row[5]]), [['العملاء الجدد', defaultActivityTargets.newCustomers, 'المستهدفات الافتراضية'], ['العملاء المستردون', defaultActivityTargets.recoveredCustomers, 'المستهدفات الافتراضية'], ['الزيارات الفعلية', defaultActivityTargets.visits, 'المستهدفات الافتراضية']], name + ': the default customer and visit targets the table shows');
}
eq(of('مدير النظام', 'مستهدفات الأصناف').map(row => [row[4], row[5]]), targetProducts.map(() => ['', 'غير محدد']), 'no product target: every product «غير محدد», never a zero');
eq(of('المشرف', 'مستهدفات الأصناف').every(row => row[5] === 'محسوب من الفريق'), true, 'the supervisor\'s products stay computed (no «غير محدد» rows beside them)');
eq(rows.some(row => row[1] === 'زميل سابق'), false, 'a colleague read only for history is not listed');
// 2026-11-10 decision 4: an administrator the page leaves out (no target or sale of theirs this month) is left out of the file too.
const withoutAdmin = targetsCsvRows(state, members, '2026-11', ar, ['owner']);
eq(withoutAdmin.some(row => row[1] === 'مدير النظام'), false, 'a hidden administrator has no row in the file');
eq(withoutAdmin.length, rows.length - targetProducts.length - 3, 'only the administrator\'s default rows go (8 products «غير محدد» and 3 activity defaults)');
const english = targetsCsvRows(state, members, '2026-11', en);
eq(english.find(row => row[1] === 'مدير النظام' && row[5] === 'Default targets')?.[2], 'Customer and visit targets', 'English labels');
eq(english.find(row => row[1] === 'All sales reps')?.[2], 'Performance weights', 'English weights');

// ---- the evaluation: each indicator and then the overall line
const make = (id, scores) => {
  const metrics = operationalIndicators.map(indicator => metric(indicator.id, scores[indicator.id] ?? null, 'سبب', 'automatic', null, null, scores[indicator.id] === 'na' ? 'not_applicable' : undefined));
  return {member: members.find(m => m.id === id), metrics, summary: kpiSummary(metrics)};
};
const full = Object.fromEntries(operationalIndicators.map(i => [i.id, 80]));
const complete = make('rep1', {...full, positive: 'na', quotes: 'na'}), partial = make('sup', {attainment: 66.67});
const kpiRows = performanceCsvRows([complete, partial], '2026-11', ar);
eq(kpiRows.every(row => row.length === performanceCsvHeaders.length), true, 'every evaluation row fills every column');
eq(kpiRows.filter(row => row[2] === 'درجة التقييم الكلية').length, 2, 'one overall line for each person');
eq(kpiRows.length, 2 * (operationalIndicators.length + 1), 'the indicators and the overall line');
const line = name => kpiRows.find(row => row[1] === name && row[2] === 'درجة التقييم الكلية');
// 80 on every applicable indicator: 80 x 95 / 100 = 76 points of an applicable 95 → 80 / 100.
eq(line('مندوب أول').slice(3), [95, 80, 76, 'الوزن الذي تم تقييمه: 95 / 95%'], 'complete: the score, the points and the weight as the page shows them');
// Missing data is not a zero (the owner, 2026-11-14): 16.67 points ÷ the 25% that has data = 66.67, with the share and what is missing.
const missingNames = operationalIndicators.slice(1).map(i => i.name);
eq(line('المشرف').slice(3), [100, 66.67, 16.67, 'غير مكتمل · الدرجة محسوبة من البيانات الموجودة فقط: 25% من الوزن · بيانات ناقصة: ' + missingNames.join('، ') + ' · الوزن الذي تم تقييمه: 25 / 100%'], 'incomplete: the score from the data there is, «غير مكتمل», the share of the weight and the missing indicators');
eq(performanceCsvRows([partial], '2026-11', en, 'en').at(-1)[6].startsWith('Incomplete · The score is calculated from the available data only: 25% of the weight · Missing data: ' + en(operationalIndicators[1].name) + ', '), true, 'the same in English');
const quiet = {...make('rep1', full), summary: {...kpiSummary(operationalIndicators.map(i => metric(i.id, 80, 'سبب')), true)}};
eq(performanceCsvRows([quiet], '2026-11', ar).at(-1).slice(3), [100, '', '', 'بلا نشاط في هذا الشهر – خارج التقييم'], 'out of the evaluation: the sentence, no score and no points');
eq(performanceCsvRows([quiet], '2026-11', en, 'en').at(-1)[6], 'No activity this month – excluded from the evaluation', 'and in English');
const allNa = make('rep1', Object.fromEntries(operationalIndicators.map(i => [i.id, 'na'])));
eq(performanceCsvRows([allNa], '2026-11', ar).at(-1).slice(4), ['', 0, 'لا ينطبق · الوزن الذي تم تقييمه: 0 / 0%'], 'nothing applies: «لا ينطبق», never a score');
eq(performanceCsvRows([partial], '2026-11', en).at(-1)[2], 'Overall score', 'English overall line');

// ---- the summary card's product gauge
for (const [value, expected] of [[30 / 55 * 100, 54.55], [20 / 30 * 100, 66.67], [50, 50], [0, 0], [125.555, 125.56], [-12.345, -12.34], [null, null], [undefined, null], [NaN, null], [Infinity, null]])
  eq(shownAchievement(value), expected, 'the gauge writes ' + value + ' as ' + expected);
const card = fs.readFileSync('app/targets-performance-summary.tsx', 'utf8');
eq(card.includes('<TargetGauge value={shownAchievement(row?.achievement)}'), true, 'the summary card passes the two-decimal figure to its product gauge');
const workspace = fs.readFileSync('app/sales-workspace.tsx', 'utf8');
eq([workspace.includes('targetsCsvRows(payload.targets,members,month,t,hiddenFromTargets)'), workspace.includes('performanceCsvRows(filteredKpiPeople,month,t,language)')], [true, true], 'the page exports through these functions (the targets file leaves out the administrators the page leaves out)');
console.log(JSON.stringify({ok: true, checks, syntheticFixtures: true, productionDataUsed: false}));
