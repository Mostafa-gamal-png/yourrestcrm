// The four targets decisions of 2026-11-10, over HTTP against the BUILT release (run the build first). Synthetic data only: temporary
// SQLite, mocked sendmail, no production data. The months are the real clock's (this month in Riyadh and the one before it).
// 1. A finished month: every target kind (a person's products, a person's customers and visits, the company weights, the branch
//    target) refused to the sales manager with the owner's message and nothing written; the administrator saves it and the audit says
//    so; this month and next month unchanged; the KPI evidence and the evaluation entry of the finished month still saved.
// 2. «سجل التعديلات»: newest first, who / when / month / before → after, a row from before the change with «تفاصيل غير متاحة»,
//    twenty a page; the same read scope as the targets (the supervisor's team, the region of a regional manager, branches for a
//    manager over every region, the weights for every reader); refused to a representative, customer service and nobody signed in.
// 3. (the phone cards are the browser test's)
// 4. The administrator out of the month's targets, cards and KPIs unless they have a target or a sale in it; the team totals the same.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const P = ['قوالب البلوك المتحركة', 'قوالب البلوك الثابتة', 'لمامة البلوك', 'ماكينة إنتاج البلوكة المتحركة', 'قطع غيار المكائن المتحركة', 'خلاطات البلوك', 'خلاطات الخرسانة الجاهزة', 'خدمات صيانة'];
const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'boss', role: 'admin', name: 'مدير يبيع'},
  {id: 'sm', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'sm', name: 'المشرف أحمد'}, {id: 'sup2', role: 'supervisor', sup: 'sm', name: 'المشرف سعيد'},
  {id: 'rep1', role: 'rep', sup: 'sup', name: 'مندوب أول'}, {id: 'rep2', role: 'rep', sup: 'sup', name: 'مندوب ثاني'},
  {id: 'rep3', role: 'rep', sup: 'sup2', name: 'مندوب ثالث'},
  {id: 'mgrw', role: 'manager', region: 'western', name: 'مدير الغربية'}, {id: 'repw', role: 'rep', sup: 'mgrw', region: 'western', name: 'مندوب الغربية'},
  {id: 'cs', role: 'customer_service', name: 'خدمة العملاء'}
];
const riyadh = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit'});
const day = riyadh.format(new Date()), month = day.slice(0, 7);
const shift = n => { const d = new Date(month + '-15T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const prev = shift(-1), next = shift(1);
const CLOSED = 'انتهى هذا الشهر؛ تعديل مستهدفاته لمدير النظام فقط';
let checks = 0, app;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const quantities = values => ({products: P.map((product, i) => ({product, quantity: values[i] === undefined ? 0 : values[i]}))});
const weights = values => ({products: P.map((product, i) => ({product, weight: values[i]}))});

try {
  app = await bootBuiltApp({members});
  const sessions = {};
  for (const m of members) sessions[m.id] = await app.login(m.id);
  const as = who => app.as(who ? sessions[who] : '');
  const save = (who, kind, scopeId, data, m = month, version = 0, inheritedFrom = null, requestId = crypto.randomUUID()) => as(who)('/api/targets', {method: 'POST', body: {kind, scopeId, month: m, version, inheritedFrom, requestId, data}});
  const rows = async () => (await app.db.prepare("SELECT kind,scope_id,month,version,data FROM crm_target_sets ORDER BY kind,scope_id,month").all()).results;
  const audits = async () => (await app.db.prepare("SELECT id,record_id,actor,detail FROM crm_audit WHERE id LIKE 'target-set:%' ORDER BY created_at,id").all()).results;
  const historyOf = async (who, scopeId, offset) => as(who)('/api/targets/history?scopeId=' + encodeURIComponent(scopeId) + (offset === undefined ? '' : '&offset=' + offset));

  // ---- 1. a finished month
  const kinds = [['sales', 'rep1', quantities([10, 4])], ['activity', 'rep1', {newCustomers: 4, recoveredCustomers: 2, visits: 50}], ['weights', 'company', weights([40, 20, 10, 10, 10, 5, 5, 0])], ['sales', 'branch:الرئيسي', quantities([60, 12])]];
  const before = await rows(), auditsBefore = (await audits()).length;
  for (const [kind, scopeId, data] of kinds) {
    const refused = await save('sm', kind, scopeId, data, prev);
    check([refused.status, refused.json().error], [403, CLOSED], 'the sales manager cannot change ' + kind + ' of ' + scopeId + ' in the finished month ' + prev);
  }
  check([await rows(), (await audits()).length], [before, auditsBefore], 'and nothing was written, not even an audit row');
  check((await save('sm', 'sales', 'rep1', quantities([10, 4]), prev, 0, {month: shift(-3), version: 1})).status, 403, 'a finished month is refused whatever the request carries');
  for (const [kind, scopeId, data] of kinds) check((await save('owner', kind, scopeId, data, prev)).status, 200, 'the administrator saves ' + kind + ' of ' + scopeId + ' in the finished month');
  const closedAudits = (await audits()).filter(a => JSON.parse(a.detail).month === prev);
  check(closedAudits.map(a => [a.actor, JSON.parse(a.detail).closedMonth]), kinds.map(() => ['مدير النظام', true]), 'each of those saves is in the audit as the administrator\'s, marked as a finished month');
  check((await save('owner', 'sales', 'rep1', quantities([11, 4]), prev, 1)).status, 200, 'and changes it again');
  for (const who of ['sup', 'rep1', 'cs', 'mgrw']) check((await save(who, 'sales', who === 'mgrw' ? 'repw' : 'rep2', quantities([1]), prev)).status, 403, who + ': refused too');
  // This month and the next one: unchanged rules, including carrying this month's values to the next.
  check((await save('sm', 'sales', 'rep1', quantities([20, 8]), month, 0, {month: prev, version: 2})).status, 200, 'this month: the sales manager saves over the values carried from the finished month');
  check((await save('sm', 'sales', 'rep2', quantities([10, 4]))).status, 200, 'this month: a first target');
  check((await save('sm', 'activity', 'rep2', {newCustomers: 3, recoveredCustomers: 5, visits: 40})).status, 200, 'this month: customers and visits');
  check((await save('sm', 'sales', 'rep3', quantities([5, 5]))).status, 200);
  const requestId = crypto.randomUUID();
  check((await save('sm', 'sales', 'rep1', quantities([25, 8]), next, 0, {month, version: 1}, requestId)).status, 200, 'next month: carried from this month');
  check((await save('sm', 'sales', 'rep1', quantities([25, 8]), next, 0, {month, version: 1}, requestId)).status, 200, 'the same request again is answered (the audit row now also keeps what it replaced)');
  check((await save('sm', 'sales', 'rep1', quantities([26, 8]), next, 0, {month, version: 1}, requestId)).status, 409, 'the same request with other values is refused');
  check((await rows()).filter(r => r.scope_id === 'rep1' && r.kind === 'sales').map(r => [r.month, r.version, JSON.parse(r.data).products[0].quantity]), [[prev, 2, 11], [month, 1, 20], [next, 1, 25]], 'each month keeps its own values, saved once');
  // The KPI evidence and the evaluation entry of the finished month are not locked (their data often comes after the month ends).
  const options = (await as('sm')('/api/kpi-evidence?memberId=rep1&month=' + prev)).json();
  const evidence = {memberId: 'rep1', month: prev, version: 0, requestId: crypto.randomUUID(), salesRevision: options.salesRevision, evidenceRevision: options.evidenceRevision, input: {collection: {dueCents: 100000, collectedCents: 50000, reference: 'كشف'}, history: {complete: true, reference: 'تقرير'}, quotationsComplete: true, quotations: []}};
  check((await as('sm')('/api/kpi-evidence', {method: 'POST', body: evidence})).status, 200, 'the sales manager still saves the KPI evidence of ' + prev);
  const assessment = {memberId: 'rep1', month: prev, version: 0, requestId: crypto.randomUUID(), input: {reviewed: 10, correct: 9, review_note: '', conduct: Object.fromEntries(['responsibility', 'teamwork', 'honesty', 'professionalism', 'appearance'].map(k => [k, {score: 80, note: ''}]))}};
  check((await as('sm')('/api/kpis', {method: 'POST', body: assessment})).status, 200, 'and the evaluation entry of ' + prev);

  // ---- 2. the change history
  let res = await historyOf('sm', 'rep1');
  check([res.status, res.headers['cache-control']], [200, 'private, no-store'], 'the sales manager reads rep1\'s history');
  let page = res.json();
  check(page.entries.map(e => [e.kind, e.month]), [['sales', next], ['sales', month], ['sales', prev], ['activity', prev], ['sales', prev]], 'newest first, both kinds of the person');
  const [nextEntry, thisEntry, againEntry] = page.entries;
  check([nextEntry.actor, nextEntry.beforeFrom, nextEntry.beforeMonth, nextEntry.changes.map(c => [c.label, c.before, c.after])], ['مدير المبيعات', 'carried', month, [[P[0], 20, 25]]], 'next month: carried from this month, 20 → 25');
  check([thisEntry.beforeFrom, thisEntry.beforeMonth, thisEntry.closedMonth, thisEntry.changes.map(c => [c.label, c.before, c.after])], ['carried', prev, false, [[P[0], 11, 20], [P[1], 4, 8]]], 'this month: replaced the values of the finished month');
  check([againEntry.actor, againEntry.closedMonth, againEntry.beforeFrom, againEntry.changes.map(c => [c.before, c.after])], ['مدير النظام', true, 'saved', [[10, 11]]], 'the administrator\'s change of the finished month, marked as such');
  check(page.entries[3].changes.map(c => [c.field, c.before, c.after]), [['newCustomers', 10, 4], ['recoveredCustomers', 5, 2], ['visits', 320, 50]], 'a first customers-and-visits target against the defaults the page showed');
  ok(page.entries.every(e => e.detailsAvailable && !Number.isNaN(Date.parse(e.at))), 'every entry has its moment and its details');
  check(page.more, false, 'one page');
  // A row the release before this one wrote (the request alone, nothing about what it replaced).
  await app.db.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)").bind('target-set:sm:old-row', 'target-rep3', 'مدير المبيعات', 'تعديل مستهدفات الأصناف', JSON.stringify({kind: 'sales', scopeId: 'rep3', month: prev, version: 0, inheritedFrom: null, data: quantities([7, 3])}), '2020-01-01T00:00:00.000Z').run();
  page = (await historyOf('sm', 'rep3')).json();
  check(page.entries.map(e => [e.month, e.detailsAvailable]), [[month, true], [prev, false]], 'an older row is listed last');
  check(page.entries[1].changes.slice(0, 2).map(c => [c.before, c.after]), [[null, 7], [null, 3]], 'with the values it saved and no earlier ones («تفاصيل غير متاحة»)');
  // Twenty a page.
  for (let i = 1; i <= 22; i++) check((await save('sm', 'sales', 'rep2', quantities([10 + i, 4]), month, i)).status, 200, 'save ' + i);
  const first = (await historyOf('sm', 'rep2')).json(), second = (await historyOf('sm', 'rep2', 20)).json();
  check([first.entries.length, first.more, second.entries.length, second.more, second.offset], [20, true, 4, false, 20], '24 changes: twenty, then four');
  check([first.entries[0].changes[0].after, first.entries[19].changes[0].after, second.entries[0].changes[0].after], [32, 13, 12], 'newest first across the pages');
  check(new Set([...first.entries, ...second.entries].map(e => e.id)).size, 24, 'no entry twice');
  // Scope: the same as the targets.
  const status = async (who, scopeId) => (await historyOf(who, scopeId)).status;
  check(await status('sup', 'rep1'), 200, 'the supervisor reads their own representative');
  check(await status('sup', 'rep3'), 404, 'not another supervisor\'s representative');
  check(await status('sup', 'branch:الرئيسي'), 404, 'nor the branch target (a manager\'s)');
  check(await status('sup', 'company'), 200, 'the weights, like every reader of the page');
  check(await status('mgrw', 'rep1'), 404, 'a manager of the western region does not read the central representative');
  check(await status('mgrw', 'repw'), 200, 'they read their own');
  check(await status('mgrw', 'branch:الرئيسي'), 404, 'and no branch target (only a manager over every region sees branches)');
  check([await status('sm', 'branch:الرئيسي'), await status('owner', 'company'), await status('owner', 'rep2')], [200, 200, 200], 'the sales manager and the administrator');
  check(await status('sm', 'nobody'), 404, 'an unknown scope is not available');
  for (const who of ['rep1', 'cs']) check(await status(who, 'rep1'), 403, who + ' has no history (not a reader of the team targets)');
  check(await status(null, 'rep1'), 401, 'nobody signed in');
  check([(await as('sm')('/api/targets/history?scopeId=rep1&month=' + month)).status, (await as('sm')('/api/targets/history')).status, (await historyOf('sm', 'rep1', -1)).status], [400, 400, 400], 'a malformed query is refused');
  const branchPage = (await historyOf('sm', 'branch:الرئيسي')).json(), weightsPage = (await historyOf('sup', 'company')).json();
  check([branchPage.entries.length, branchPage.entries[0].changes.map(c => [c.before, c.after]).slice(0, 2), weightsPage.entries[0].changes[0].unit], [1, [[null, 60], [null, 12]], '%'], 'the branch and the weights histories');

  // ---- 4. the administrator in the targets of a month
  const now = new Date().toISOString();
  await app.db.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('imp','owner','f','sales.xlsx','{}',?)").bind(now).run();
  await app.db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES('erp-1','doc-1','h','h','ERP-1','sale',?,'e1','boss','الرئيسي','all','C-1','n',?,30000,'imp','owner',?)")
    .bind(day, JSON.stringify({items: [{product: P[0], description: '', quantity: 3, unitPrice: 100}], discount: 0, notes: ''}), now).run();
  await app.db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES('erp-2','doc-2','h','h','ERP-2','sale',?,'e2','rep1','الرئيسي','all','C-2','n',?,40000,'imp','owner',?)")
    .bind(day, JSON.stringify({items: [{product: P[0], description: '', quantity: 4, unitPrice: 100}], discount: 0, notes: ''}), now).run();
  // The administrators are in the page of an administrator (and of a manager with «عرض بيانات الفريق بالكامل»); a sales manager's
  // own scope never had them.
  const smData = (await as('sm')('/api/sales?month=' + month)).json();
  check([smData.members.some(m => ['owner', 'boss'].includes(m.id)), smData.hiddenFromTargets], [false, []], 'the sales manager\'s page has no administrator either way');
  let data = (await as('owner')('/api/sales?month=' + month + '&kpis=1')).json();
  const ids = list => list.map(p => p.member.id);
  check(data.hiddenFromTargets, ['owner'], 'this month: the administrator with no target and no sale is left out; the one who sold is not');
  check([ids(data.performance).includes('owner'), ids(data.performance).includes('boss'), ids(data.kpis.people).includes('owner'), ids(data.kpis.people).includes('boss')], [false, true, false, true], 'out of the cards and the evaluation, the one who sold stays');
  check(data.members.some(m => m.id === 'owner'), true, 'still a member of the page (a sale can be recorded for them)');
  const team = id => data.performance.find(p => p.member.id === id).attainment.rows[0];
  // rep1 4 + rep2 0 + rep3 0 = 4 for the sales manager; boss's 3 belong to nobody's team. Targets 20 + 32 + 5 = 57.
  check([team('sm').actual, team('sm').target, team('boss').actual], [4, 57, 3], 'the team totals: the administrator\'s sale was never in a roll-up and is not now');
  const prevData = (await as('owner')('/api/sales?month=' + prev)).json();
  check(prevData.hiddenFromTargets, ['owner', 'boss'], prev + ': neither administrator has a target or a sale');
  check((await save('owner', 'sales', 'owner', quantities([2]))).status, 200, 'the administrator gives themself a target this month');
  data = (await as('owner')('/api/sales?month=' + month + '&kpis=1')).json();
  check([data.hiddenFromTargets, ids(data.performance).includes('owner')], [[], true], 'and is shown again, so nothing that counts disappears');
  check([team('sm').actual, team('sm').target], [4, 57], 'the team totals did not move');
  const nextData = (await as('owner')('/api/sales?month=' + next)).json();
  check(nextData.hiddenFromTargets, ['boss'], next + ': the target carries on; the sale was this month only');
  console.log(JSON.stringify({ok: true, checks, builtRelease: true, syntheticFixtures: true, productionDataUsed: false, months: {prev, month, next}}));
} finally {
  await app?.stop();
}
