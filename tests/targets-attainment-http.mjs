// Weighted target attainment and team roll-ups over real HTTP against the BUILT release (run `pnpm build` first).
// Pins the business formulas end to end: per product min(1, actual / target) x weight, products with a zero target leave the
// denominator, unknown sales stay unavailable, and supervisor / manager results aggregate their reporting line.
// Synthetic isolated fixtures only: temporary SQLite, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members = [
  {id: 'owner', role: 'admin'}, {id: 'mgr', role: 'manager'}, {id: 'mgrw', role: 'manager', region: 'western'}, {id: 'sup', role: 'supervisor', sup: 'mgr'},
  {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern'}, {id: 'rep2', role: 'rep', sup: 'sup', region: 'eastern'}, {id: 'rep3', role: 'rep', sup: 'mgr', region: 'eastern'}
];
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const app = await bootBuiltApp({members});
try {
  const sessions = {};
  for (const member of members) sessions[member.id] = await app.login(member.id);
  const admin = app.as(sessions.owner);
  const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()), month = day.slice(0, 7);
  const products = ['قوالب البلوك المتحركة', 'قوالب البلوك الثابتة', 'لمامة البلوك', 'ماكينة إنتاج البلوكة المتحركة', 'قطع غيار المكائن المتحركة', 'خلاطات البلوك', 'خلاطات الخرسانة الجاهزة', 'خدمات صيانة'];
  const weights = [40, 20, 10, 10, 10, 5, 5, 0];
  const customer = (await admin('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', createKey: crypto.randomUUID(), data: {name: 'E', region: 'الشرقية', city: 'x', code: 'E', branch: 'الرئيسي', assignedTo: 'rep1', phone: '0501234567', contact: 'م', customerType: 'مصنع', customerStatus: 'نشط'}}})).json().id;
  const save = (who, kind, scopeId, data) => app.as(sessions[who])('/api/targets', {method: 'POST', body: {kind, scopeId, month, version: 0, inheritedFrom: null, requestId: crypto.randomUUID(), data}});
  const quantities = (first, second) => ({products: products.map((product, index) => ({product, quantity: index === 0 ? first : index === 1 ? second : 0}))});
  const weightRows = values => ({products: products.map((product, index) => ({product, weight: values[index]}))});

  // Weights: all-region administrators and managers only, company scope, must total exactly 100.
  check((await save('owner', 'weights', 'company', weightRows([40, 20, 10, 10, 10, 5, 5, 1]))).status, 400, 'weights totalling 101 are rejected');
  check((await save('sup', 'weights', 'company', weightRows(weights))).status, 403, 'a supervisor cannot set company weights');
  check((await save('mgrw', 'weights', 'company', weightRows(weights))).status, 403, 'a regional manager cannot set company weights');
  check((await save('rep1', 'weights', 'company', weightRows(weights))).status, 403, 'a representative cannot set company weights');
  check((await save('mgr', 'weights', 'company', weightRows(weights))).status, 200, 'an all-region manager saves valid weights');
  // Quantity targets: managers and administrators only, and only for people inside their own scope.
  check((await save('rep1', 'sales', 'rep1', quantities(10, 4))).status, 403, 'representatives cannot set targets');
  check((await save('sup', 'sales', 'rep1', quantities(10, 4))).status, 403, 'a supervisor cannot edit targets, even for their own representatives');
  check((await save('mgrw', 'sales', 'rep1', quantities(10, 4))).status, 403, 'a regional manager cannot target a representative of another region');
  check((await save('mgr', 'sales', 'sup', quantities(1, 1))).status >= 400, true, 'supervisor and manager quantities are computed from their team, never typed');
  check((await save('mgr', 'sales', 'rep1', quantities(10, 4))).status, 200, 'manager targets a representative');
  check((await save('mgr', 'sales', 'rep2', quantities(10, 4))).status, 200);
  check((await save('mgr', 'sales', 'rep3', quantities(20, 0))).status, 200);

  const sale = async (rep, reference, items) => (await admin('/api/sales', {method: 'POST', body: {action: 'save', createKey: crypto.randomUUID(), data: {customerId: customer, repId: rep, date: day, reference, items: items.map(([index, quantity, unitPrice]) => ({product: products[index], description: '', quantity, unitPrice})), discount: 0, notes: ''}}})).status;
  check(await sale('rep1', 'A', [[0, 5, 100], [1, 8, 50]]), 200);
  check(await sale('rep2', 'B', [[0, 10, 100]]), 200);
  check(await sale('rep3', 'C', [[0, 5, 100]]), 200);

  const summary = async who => {
    const response = await app.as(sessions[who])('/api/sales?month=' + month);
    check(response.status, 200);
    return Object.fromEntries(response.json().performance.map(row => [row.member.id, {score: row.attainment.score, status: row.attainment.status}]));
  };
  // rep1: 0.5 x 40 + min(1, 8/4) x 20 = 40 over applicable weight 60 (zero-target products leave the denominator) = 66.67
  // rep2: the second product has a target but no recorded sales, so the result is unavailable rather than guessed
  // rep3: 0.25 x 40 = 10 over applicable weight 40 = 25
  // sup (rep1 + rep2 targets 20 / 8, actual 15 / 8): 0.75 x 40 + 1 x 20 = 50 over 60 = 83.33
  // mgr (all three reps, targets 40 / 8, actual 20 / 8): 0.5 x 40 + 1 x 20 = 40 over 60 = 66.67
  const manager = await summary('mgr');
  check(manager.rep1, {score: 66.67, status: 'ready'}, 'representative weighted attainment');
  check(manager.rep2, {score: null, status: 'missing_inputs'}, 'unknown product sales stay unavailable');
  check(manager.rep3, {score: 25, status: 'ready'}, 'a product with a zero target does not dilute the score');
  check(manager.sup, {score: 83.33, status: 'ready'}, 'supervisor aggregates the supervised representatives');
  check(manager.mgr, {score: 66.67, status: 'ready'}, 'manager aggregates the whole reporting line');
  const supervisor = await summary('sup');
  check(Object.keys(supervisor).sort(), ['rep1', 'rep2', 'sup'], 'supervisor sees only their own team');
  check(supervisor.sup, {score: 83.33, status: 'ready'});

  // A representative sees only their own quantities through the own-target endpoint.
  const own = await app.as(sessions.rep3)('/api/targets?month=' + month);
  check(own.status, 200);
  check(own.json().member.id, 'rep3');
  console.log(JSON.stringify({ok: true, checks, builtRelease: true, syntheticFixtures: true, productionDataUsed: false}));
} finally {
  await app.stop();
}
