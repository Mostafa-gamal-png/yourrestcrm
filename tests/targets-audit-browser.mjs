// «المستهدفات وتقييم الأداء» tried whole, against the BUILT release (run the build first) in a real Chromium, by every role (2026-11-11
// audit; the owner: «افحص الصفحة كلها»). Synthetic data only: several representatives in two branches, targets for this month and the
// previous one, weights, a branch target, CRM sales (one voided), ERP sales with a return, sales on the first day of the month and the last
// day of the previous one, customers created either side of midnight in Riyadh, KPI evidence and a management assessment.
// Over HTTP: every number against a hand calculation (attainment per product and weighted, team roll-ups of the supervisor and the sales
// manager, the overall score), the refusals by role, a save replayed, a stale version, a cleared quantity («غير محدد», never zero).
// In Chromium (360 px phone and desktop, Arabic; English on the desktop and the representative's phone): the summary cards and their gauges
// (two decimals), the branch distribution, editing a target in a future month (carried from this month, this month unchanged), the weights
// dialog (99% cannot be saved), the KPI detail, both CSV exports against the screen, the supervisor read only, the representative's
// «مستهدفي» from the Android app, customer service with no page; no sideways scrolling; no page error. Screenshots for the report.
// 2026-11-10 decisions: last month's targets are set by the administrator (the sales manager is refused), and the administrator with no
// target or sale is in no card, column or row; their own checks are tests/targets-decisions-http.mjs and targets-decisions-browser.mjs.
// Synthetic fixtures only: temporary SQLite, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-targets-audit-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
const P = ['قوالب البلوك المتحركة', 'قوالب البلوك الثابتة', 'لمامة البلوك', 'ماكينة إنتاج البلوكة المتحركة', 'قطع غيار المكائن المتحركة', 'خلاطات البلوك', 'خلاطات الخرسانة الجاهزة', 'خدمات صيانة'];
const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'sm', name: 'المشرف أحمد'},
  {id: 'rep1', role: 'rep', sup: 'sup', name: 'مندوب أول'}, {id: 'rep2', role: 'rep', sup: 'sup', name: 'مندوب ثاني'},
  {id: 'rep3', role: 'rep', sup: 'sm', name: 'مندوب ثالث'}, {id: 'repj', role: 'rep', sup: 'sm', name: 'مندوب جدة', branch: 'جدة'},
  {id: 'cs', role: 'customer_service', name: 'خدمة العملاء'}
];
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1366, height: 900};
const riyadh = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit'});
const day = riyadh.format(new Date()), month = day.slice(0, 7);
const shift = n => { const d = new Date(month + '-15T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const prev = shift(-1), next = shift(1), prevLast = new Date(Date.parse(month + '-01T00:00:00Z') - 86400000).toISOString().slice(0, 10);
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const near = (actual, expected, message) => { assert.ok(Math.abs(actual - expected) < 0.006, message + ': ' + actual + ' vs ' + expected); checks++; };
const quantities = values => ({products: P.map((product, i) => ({product, quantity: values[i] === undefined ? 0 : values[i]}))});
const weightRows = values => ({products: P.map((product, i) => ({product, weight: values[i]}))});

try {
  app = await bootBuiltApp({members}, {tls: true});
  const sessions = {};
  for (const m of members) sessions[m.id] = await app.login(m.id);
  const as = who => app.as(sessions[who]);
  const save = (who, kind, scopeId, data, m = month, version = 0, inheritedFrom = null, requestId = crypto.randomUUID()) => as(who)('/api/targets', {method: 'POST', body: {kind, scopeId, month: m, version, inheritedFrom, requestId, data}});

  // ---- fixtures
  const created = '2025-01-01T00:00:00.000Z';
  const customer = (id, name, branch, rep, code, data = {}, createdAt = created) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,?,?,?,?,1,'fixture')")
    .bind(id, rep, branch, JSON.stringify({name, branch, assignedTo: rep, region: 'الوسطى', city: 'الرياض', customerStatus: 'نشط', phone: '0551234567', contact: 'م', code, customerType: 'مصنع', sourceFile: 'fixture', ...data}), createdAt, createdAt).run();
  await customer('c1', 'مصنع الأول', 'الرئيسي', 'rep1', 'C-1'); await customer('c2', 'مصنع الثاني', 'الرئيسي', 'rep2', 'C-2');
  await customer('c3', 'مصنع الثالث', 'الرئيسي', 'rep3', 'C-3'); await customer('cj', 'مصنع جدة', 'جدة', 'repj', 'C-J');
  // Added by hand by rep1 either side of midnight in Riyadh on the first day of this month (UTC+3): only the second is this month's.
  const firstUtc = Date.parse(month + '-01T00:00:00Z');
  await customer('n-before', 'عميل قبل منتصف الليل', 'الرئيسي', 'rep1', '', {sourceFile: undefined, _createdBy: 'rep1'}, new Date(firstUtc - 3.5 * 3600000).toISOString());
  await customer('n-after', 'عميل بعد منتصف الليل', 'الرئيسي', 'rep1', '', {sourceFile: undefined, _createdBy: 'rep1'}, new Date(firstUtc - 2.5 * 3600000).toISOString());

  // Last month has ended: only the administrator sets its targets (decision 1 of 2026-11-10; tests/targets-decisions-http.mjs).
  check((await save('sm', 'weights', 'company', weightRows([40, 20, 10, 10, 10, 5, 5, 0]), prev)).status, 403, 'the sales manager cannot set last month\'s weights');
  check((await save('owner', 'weights', 'company', weightRows([40, 20, 10, 10, 10, 5, 5, 0]), prev)).status, 200, 'weights saved last month by the administrator');
  check((await save('owner', 'sales', 'rep1', quantities([10, 4]), prev)).status, 200, 'rep1 last month');
  check((await save('sm', 'sales', 'rep1', quantities([20, 8]), month, 0, {month: prev, version: 1})).status, 200, 'rep1 this month, replacing what was carried');
  check((await save('sm', 'sales', 'rep2', quantities([10, 4]))).status, 200);
  check((await save('sm', 'sales', 'rep3', quantities([20, 0]))).status, 200);
  check((await save('sm', 'sales', 'repj', quantities([5, 5]))).status, 200);
  check((await save('owner', 'sales', 'branch:الرئيسي', quantities([60, 12]))).status, 200, 'the administrator sets the branch target');
  check((await save('sm', 'activity', 'rep1', {newCustomers: 3, recoveredCustomers: 2, visits: 40})).status, 200);

  const sale = async (rep, customerId, reference, items, date = day) => {
    const res = await as('owner')('/api/sales', {method: 'POST', body: {action: 'save', createKey: crypto.randomUUID(), data: {customerId, repId: rep, date, reference, items: items.map(([i, quantity, unitPrice]) => ({product: P[i], description: '', quantity, unitPrice})), discount: 0, notes: ''}}});
    check(res.status, 200, 'sale ' + reference); return res.json().id;
  };
  await sale('rep1', 'c1', 'A-1', [[0, 5, 100], [1, 8, 50]]);
  const voided = await sale('rep1', 'c1', 'A-VOID', [[0, 100, 100]]);
  check((await as('owner')('/api/sales', {method: 'POST', body: {action: 'void', id: voided, version: 1, reason: 'خطأ'}})).status, 200, 'a voided sale');
  await sale('rep2', 'c2', 'B-1', [[0, 10, 100]]);
  await sale('rep3', 'c3', 'C-1', [[0, 5, 100]]);
  await sale('rep3', 'c3', 'C-FIRST', [[0, 1, 100]], month + '-01');
  await sale('rep3', 'c3', 'C-LAST', [[0, 2, 100]], prevLast);
  await sale('repj', 'cj', 'J-1', [[0, 5, 100], [1, 2, 100]]);
  await sale('rep1', 'c1', 'P-1', [[0, 4, 100]], prev + '-05');
  const now = new Date().toISOString();
  await app.db.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('imp','owner','f','sales.xlsx','{}',?)").bind(now).run();
  let n = 0;
  const erp = (rep, code, date, type, items, total) => app.db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'h','h',?,?,?,'e1',?,'الرئيسي','all',?,'n',?,?,'imp','owner',?)")
    .bind('erp-' + (++n), 'doc-' + n, 'ERP-' + n, type, date, rep, code, JSON.stringify({items: items.map(([i, quantity]) => ({product: P[i], description: '', quantity, unitPrice: 100})), discount: 0, notes: ''}), total, now).run();
  await erp('rep1', 'C-1', day, 'sale', [[0, 6]], 60000);
  await erp('rep1', 'C-1', day, 'return', [[0, -1]], -10000);
  await erp('rep2', 'C-2', prev + '-03', 'sale', [[0, 3]], 30000);

  // ---- the numbers, by hand
  const sales = async (who, m = month, kpis = true) => { const res = await as(who)('/api/sales?month=' + m + (kpis ? '&kpis=1' : '')); check(res.status, 200, who + ' reads the page data'); return res.json(); };
  let data = await sales('sm');
  const perf = Object.fromEntries(data.performance.map(p => [p.member.id, p.attainment]));
  const actual = (id, i) => perf[id].rows[i].actual, target = (id, i) => perf[id].rows[i].target;
  // rep1 product 1: CRM 5 + ERP 6 − 1 returned = 10 (the voided 100 left out); product 2: 8. (10/20 × 40 + 8/8 × 20) / 60 = 66.67
  check([actual('rep1', 0), actual('rep1', 1), target('rep1', 0), target('rep1', 1)], [10, 8, 20, 8], 'rep1 net quantities after the return, the voided sale left out');
  check(perf.rep1.score, 66.67, 'rep1 weighted attainment');
  // rep3: 5 + 1 (the first of the month); the 2 of the previous month's last day belong to that month. 6/20 × 40 / 40 = 30
  check([actual('rep3', 0), perf.rep3.score], [6, 30], 'the first day of the month counts, the last day of the previous month does not');
  check([perf.rep2.score, perf.rep2.status], [null, 'missing_inputs'], 'rep2 sold nothing of a product with a target: unknown, not zero');
  check(perf.repj.score, 80, 'repj (5/5 × 40 + 2/5 × 20) / 60 = 80');
  // supervisor = rep1 + rep2: targets 30 / 12, actual 20 / 8: (20/30 × 40 + 8/12 × 20) / 60 = 66.67
  check([target('sup', 0), target('sup', 1), actual('sup', 0), actual('sup', 1), perf.sup.score], [30, 12, 20, 8, 66.67], 'supervisor roll-up');
  // sales manager = rep1, rep2, rep3, repj: targets 55 / 17, actual 31 / 10: (31/55 × 40 + 10/17 × 20) / 60 = 57.18
  check([target('sm', 0), target('sm', 1), actual('sm', 0), actual('sm', 1)], [55, 17, 31, 10], 'manager roll-up quantities');
  near(perf.sm.score, (31 / 55 * 40 + 10 / 17 * 20) / 60 * 100, 'manager weighted attainment');
  const managerActivity = data.targets.sets.find(s => s.kind === 'activity' && s.scopeId === 'sm');
  check(managerActivity.data, {newCustomers: 3 + 10 * 4, recoveredCustomers: 2 + 5 * 4, visits: 40 + 320 * 4}, 'the manager\'s activity: rep1\'s saved targets + the defaults of the supervisor and three representatives');
  const kpi = id => data.kpis.people.find(p => p.member.id === id);
  check(kpi('rep1').metrics.find(m => m.id === 'new_customers').numerator, 1, 'a customer added after midnight in Riyadh on the 1st is this month\'s; one at 23:30 the day before is not');

  // ---- evidence and the management assessment complete rep1's evaluation
  const options = (await as('sm')('/api/kpi-evidence?memberId=rep1&month=' + month)).json();
  const evidenceBody = {memberId: 'rep1', month, version: 0, requestId: crypto.randomUUID(), salesRevision: options.salesRevision, evidenceRevision: options.evidenceRevision, input: {collection: {dueCents: 1000000, collectedCents: 800000, reference: 'كشف التحصيل'}, history: {complete: true, reference: 'تقرير ERP'}, quotationsComplete: true, quotations: []}};
  check((await as('sup')('/api/kpi-evidence', {method: 'POST', body: evidenceBody})).status, 403, 'a supervisor reads the evidence and cannot save it');
  check((await as('sm')('/api/kpi-evidence', {method: 'POST', body: evidenceBody})).status, 200, 'the sales manager saves the evidence');
  const assessment = {memberId: 'rep1', month, version: 0, requestId: crypto.randomUUID(), input: {reviewed: 10, correct: 9, review_note: '', conduct: Object.fromEntries(['responsibility', 'teamwork', 'honesty', 'professionalism', 'appearance'].map(k => [k, {score: 80, note: ''}]))}};
  for (const who of ['sup', 'rep1', 'cs']) check((await as(who)('/api/kpis', {method: 'POST', body: assessment})).status, 403, who + ' cannot save an assessment');
  check((await as('sm')('/api/kpis', {method: 'POST', body: assessment})).status, 200, 'the sales manager saves the assessment');
  check((await as('sm')('/api/kpis', {method: 'POST', body: assessment})).status, 200, 'the same request again is answered, not saved twice');
  check((await as('sm')('/api/kpis', {method: 'POST', body: {...assessment, requestId: crypto.randomUUID()}})).status, 409, 'a new save on the stale version is refused');
  data = await sales('sm');
  const full = kpi('rep1');
  // attainment 66.67 × 25% = 16.6675, collection 80% × 20 = 16, growth min(100, (10 − 4) / 4) × 5 = 5, variety 0, new customers 33.33% × 5 = 1.6665,
  // recovered 0, retention 1/1 × 5 = 5, visits 0, quality 90% × 5 = 4.5, conduct 80% × 10 = 8 → 56.834 of an applicable 87
  // (effective visits 2, quotes 3, orders 3 and documentation 5 do not apply) → 65.33 / 100.
  check(Object.fromEntries(full.metrics.map(m => [m.id, m.score])), {attainment: 66.67, collection: 80, growth: 100, variety: 0, new_customers: 33.33, recovered: 0, retention: 100, visits: 0, positive: null, quotes: null, orders: null, quality: 90, documentation: null, responsibility: 80, teamwork: 80, honesty: 80, professionalism: 80, appearance: 80}, 'each indicator of rep1');
  check([full.summary.earned, full.summary.applicableWeight, full.summary.total, full.summary.complete], [56.83, 87, 65.33, true], 'rep1 overall score by hand');

  // ---- refusals and save paths
  for (const who of ['sup', 'rep1', 'cs']) check((await save(who, 'sales', 'rep2', quantities([1, 1]))).status, 403, who + ' cannot set a target');
  for (const who of ['rep1', 'cs']) check((await as(who)('/api/sales?month=' + month)).status, 403, who + ' cannot read the team page data');
  check((await as('cs')('/api/targets?month=' + month)).status, 403, 'customer service has no «مستهدفي»');
  check((await as('sup')('/api/targets?month=' + month)).status, 403, '«مستهدفي» is the representative\'s');
  const requestId = crypto.randomUUID(), cleared = {products: P.map((product, i) => ({product, quantity: i === 1 ? null : i === 0 ? 20 : 0}))};
  check((await save('sm', 'sales', 'rep3', cleared, month, 1, null, requestId)).status, 200, 'a quantity cleared');
  check((await save('sm', 'sales', 'rep3', cleared, month, 1, null, requestId)).status, 200, 'the same save replayed is answered');
  check((await save('sm', 'sales', 'rep3', quantities([20, 0]), month, 1)).status, 409, 'a stale version is refused');
  const after = (await sales('sm', month, false)).performance.find(p => p.member.id === 'rep3').attainment;
  check([after.rows[1].target, after.score, after.status], [null, null, 'missing_inputs'], 'a cleared quantity is «غير محدد», never a zero target');
  check((await save('sm', 'sales', 'rep3', quantities([20, 0]), month, 2)).status, 200, 'and is set again');
  check((await save('sm', 'activity', 'rep2', {newCustomers: 7, recoveredCustomers: 0, visits: 320})).status, 400, 'an activity target of zero is refused (the form says so too)');
  const own = (await as('rep1')('/api/targets?month=' + month)).json();
  check(own.sales.products.slice(0, 2).map(p => [p.quantity, p.actualQuantity, p.remainingQuantity, p.achievement]), [[20, 10, 10, 50], [8, 8, 0, 100]], 'rep1\'s own targets: the same net quantities');

  // ---- Chromium
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});
  const downloads = path.join(screenshots, 'downloads'); fs.mkdirSync(downloads, {recursive: true});
  async function open(who, {viewport = DESKTOP, english = false} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: true, geolocation: {latitude: 24.7136, longitude: 46.6753, accuracy: 8}, permissions: ['geolocation']});
    const [name, ...value] = (await app.login(who)).split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    if (english) await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(who + ': ' + error.message));
    if (members.find(m => m.id === who).role === 'rep') await installNativeBridge(page, {memberId: who, regionScope: 'all'});
    await page.goto(app.origin + '/#targets');
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    return page;
  }
  const ready = page => page.locator('.targets-summary-card').first().waitFor();
  const shot = async (page, label) => { await page.waitForTimeout(250); await page.screenshot({path: path.join(screenshots, label + '.png'), fullPage: true}); };
  const noSideways = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no sideways scrolling');
  const card = (page, name) => page.locator('.targets-summary-card').filter({has: page.locator('h3', {hasText: new RegExp('^' + name + '$')})});
  const gauges = async (page, name) => (await card(page, name).locator('.target-gauge-value').allTextContents()).map(text => text.trim());
  const arabicIn = text => text.split('\n').map(line => line.trim()).filter(line => /[؀-ۿ]/.test(line));
  const download = async (page, label) => { const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', {name: label, exact: true}).click()]); const target = path.join(downloads, file.suggestedFilename()); await file.saveAs(target); return fs.readFileSync(target, 'utf8').replace(/^﻿/, '').split('\r\n').map(line => line.slice(1, -1).split('","')); };

  // The sales manager, desktop, Arabic.
  const sm = await open('sm');
  await ready(sm);
  check(await gauges(sm, 'مدير المبيعات'), [(Math.round((31 / 55 * 40 + 10 / 17 * 20) / 60 * 10000) / 100) + '%', '56.36%'], 'the manager\'s card: weighted 57.18%, product 31/55 written 56.36% (two decimals, as beside it)');
  check(await gauges(sm, 'المشرف أحمد'), ['66.67%', '66.67%'], 'the supervisor\'s card: 20/30 written 66.67%, not 66.666667%');
  check(await gauges(sm, 'مندوب أول'), ['66.67%', '50%'], 'rep1\'s card');
  check(await card(sm, 'مندوب أول').locator('.targets-summary-total strong').innerText(), '65.33 / 100', 'rep1\'s overall score on the card');
  check(await gauges(sm, 'مندوب ثاني'), ['—', '100%'], 'rep2: the weighted attainment is unknown, the first product 10/10');
  await noSideways(sm, 'manager desktop');
  await shot(sm, 'targets-sm-desktop-ar');
  // Exports against the screen.
  const targetsCsv = await download(sm, 'تصدير كل المستهدفات');
  check(targetsCsv[0], ['الشهر', 'المندوب / الفرع', 'نوع المستهدف', 'الصنف / المؤشر', 'الكمية / الوزن', 'ساري من'], 'targets CSV headers');
  check(targetsCsv.some(row => /^(branch:|company$)/.test(row[1] || '')), false, 'the targets CSV names the branch and the company weights, never their ids');
  check(targetsCsv.filter(row => row[1] === 'الفرع بالكامل · الرئيسي').map(row => row[4]).slice(0, 2), ['60', '12'], 'the branch target row');
  check(targetsCsv.filter(row => row[1] === 'كل المناديب').map(row => row[4]), ['40', '20', '10', '10', '10', '5', '5', '0'], 'the weights rows');
  check(targetsCsv.filter(row => row[1] === 'مندوب ثاني' && row[2] === 'مستهدفات العملاء والزيارات').map(row => [row[4], row[5]]), [['10', 'المستهدفات الافتراضية'], ['5', 'المستهدفات الافتراضية'], ['320', 'المستهدفات الافتراضية']], 'the default activity targets the table shows are in the file');
  check(targetsCsv.filter(row => row[1] === 'مدير المبيعات' && row[2] === 'مستهدفات الأصناف').map(row => row[4]).slice(0, 2), ['55', '17'], 'the manager computed from the team');
  const kpiCsv = await download(sm, 'تصدير التقييم');
  const overall = kpiCsv.find(row => row[1] === 'مندوب أول' && row[2] === 'درجة التقييم الكلية');
  check(overall?.slice(3), ['87', '65.33', '56.83', 'الوزن الذي تم تقييمه: 87 / 87%'], 'the evaluation CSV ends each person with the overall line the page shows');
  check(kpiCsv.find(row => row[1] === 'مندوب أول' && row[2] === 'التحصيل')?.slice(3, 6), ['20', '80', '16'], 'an indicator row');
  // The branch: its target and what is left to distribute (rep1 20 + rep2 10 + rep3 20 = 50 of 60; 8 + 4 + 0 = 12 of 12).
  await sm.locator('.sales-toolbar').getByRole('combobox', {name: 'الفرع'}).click();
  await sm.getByRole('option', {name: 'الرئيسي', exact: true}).click();
  const difference = sm.locator('.quantity-targets-table tbody tr').locator('td:last-child');
  await sm.locator('.quantity-targets-table thead').getByText('فرق التوزيع').waitFor();
  check((await difference.allInnerTexts()).slice(0, 3).map(text => text.trim()), ['10 غير موزع', 'موزع بالكامل', 'موزع بالكامل'], 'the branch distribution');
  await shot(sm, 'targets-sm-branch-desktop-ar');
  // The KPI detail of rep1.
  await card(sm, 'مندوب أول').getByRole('button', {name: 'عرض التفاصيل'}).click();
  await sm.locator('.kpi-person-heading').getByText('مندوب أول').waitFor();
  check((await sm.locator('.kpi-overview .panel strong').allInnerTexts()).map(text => text.trim()), ['65.33 / 100', '56.83', '87 / 87%'], 'the KPI detail: score, points and weight');
  // A future month: editing rep1 carries this month's values, and this month keeps them.
  await sm.locator('.sales-toolbar input[type=month]').fill(next);
  await sm.locator('.targets-summary-future').first().waitFor();
  await sm.locator('.quantity-targets-table thead th').filter({hasText: 'مندوب أول'}).getByRole('button', {name: 'تعديل', exact: true}).click();
  const dialog = sm.getByRole('dialog');
  check(await dialog.locator('input').first().inputValue(), '20', 'the editor opens with the values carried from this month');
  ok((await dialog.innerText()).includes('القيم الحالية سارية من شهر: ' + month), 'and says where they come from');
  await dialog.locator('input').first().fill('25');
  await dialog.getByRole('button', {name: 'حفظ المستهدفات'}).click();
  await dialog.waitFor({state: 'detached'});
  await sm.locator('.quantity-targets-table thead th').filter({hasText: 'مندوب أول'}).getByText('ساري من شهر ' + next).waitFor();
  const nextTargets = (await as('sm')('/api/sales?month=' + next)).json().targets.sets.find(s => s.kind === 'sales' && s.scopeId === 'rep1');
  check([nextTargets.month, nextTargets.data.products[0].quantity], [next, 25], 'saved for the next month');
  const thisTargets = (await as('sm')('/api/sales?month=' + month)).json().targets.sets.find(s => s.kind === 'sales' && s.scopeId === 'rep1');
  check([thisTargets.month, thisTargets.data.products[0].quantity], [month, 20], 'this month is unchanged');
  await sm.getByRole('button', {name: 'أوزان التقييم'}).click();
  await dialog.locator('input').first().fill('39');
  check(await dialog.getByRole('button', {name: 'حفظ الأوزان'}).isDisabled(), true, 'weights of 99% cannot be saved');
  ok((await dialog.locator('.form-error').innerText()).includes('99 / 100%'), 'and the dialog says the total');
  await dialog.getByRole('button', {name: 'إلغاء'}).click();
  await sm.close();

  // Every role, Arabic, phone and desktop; the screenshots of the report.
  for (const who of ['owner', 'sm', 'sup']) for (const [label, viewport] of [['phone', PHONE], ['desktop', DESKTOP]]) {
    const page = await open(who, {viewport});
    await ready(page);
    await noSideways(page, who + ' ' + label);
    // The edit buttons (the table's «تعديل», the phone cards' «تعديل الأصناف» …), not «سجل التعديلات».
    const edits = await page.locator('.targets-workspace').getByRole('button', {name: /^تعديل/}).count();
    if (who === 'sup') {
      check([edits, await page.getByRole('button', {name: 'أوزان التقييم'}).count(), await page.getByRole('button', {name: 'تصدير كل المستهدفات'}).count()], [0, 0, 1], 'the supervisor reads and exports, and edits nothing');
      check((await page.locator('.targets-summary-card h3').allInnerTexts()).sort(), ['المشرف أحمد', 'مندوب أول', 'مندوب ثاني'].sort(), 'the supervisor sees their own team only');
    } else ok(edits > 0, who + ' edits targets');
    // The administrator has no target and no sale this month: no card, no column, no row of theirs (decision 4 of 2026-11-10).
    check(await page.locator('.targets-summary-card h3', {hasText: /^مدير النظام$/}).count(), 0, who + ' ' + label + ': the administrator who does not sell is not listed');
    await shot(page, 'targets-' + who + '-' + label + '-ar');
    await page.close();
  }
  // The representative, from the Android app.
  for (const [label, viewport, english] of [['phone', PHONE, false], ['phone-en', PHONE, true]]) {
    const page = await open('rep1', {viewport, english});
    await page.locator('.my-target-product').first().waitFor();
    check(await page.locator('.my-target-product').first().locator('.target-gauge-value').textContent(), '50%', 'rep1 «مستهدفي»: 10 of 20');
    check([await page.locator('.targets-workspace').count(), await page.locator('.kpi-workspace').count(), await page.getByRole('button', {name: english ? 'Edit' : 'تعديل'}).count()], [0, 0, 0], 'no team targets, no evaluation, no edit');
    if (english) check(arabicIn(await page.locator('.my-targets').innerText()).filter(line => line !== 'مندوب أول'), [], 'English «My targets» keeps no Arabic but the person\'s name');
    await noSideways(page, 'rep1 ' + label);
    await shot(page, 'targets-rep1-' + label);
    await page.close();
  }
  // English desktop: no Arabic but the names typed by people (members, branches).
  const english = await open('sm', {english: true});
  await ready(english);
  const names = new Set([...members.map(m => m.name), 'الرئيسي', 'جدة']);
  const leftover = arabicIn(await english.locator('.targets-performance-workspace').innerText()).filter(line => !line.split(/[·،,\t]| - /).map(part => part.trim()).filter(Boolean).every(part => names.has(part) || /^[\x00-\x7F]*$/.test(part) || [...names].some(name => part.endsWith(name) && /^[\x00-\x7F]*$/.test(part.slice(0, -name.length)))));
  check(leftover, [], 'English: no Arabic left but people\'s and branches\' names');
  await shot(english, 'targets-sm-desktop-en');
  await english.close();
  // Customer service has no page: the address opens their home, and the menu has no such item.
  const service = await open('cs');
  await service.waitForTimeout(2500);
  check([await service.locator('.targets-performance-workspace').count(), await service.locator('.my-targets').count(), await service.getByRole('button', {name: 'المستهدفات وتقييم الأداء'}).count()], [0, 0, 0], 'customer service: no targets page and no menu item');
  await service.close();
  check(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks, screenshots, builtRelease: true, realBrowser: true, syntheticFixtures: true, productionDataUsed: false}));
} finally {
  await browser?.close();
  await app?.stop();
}
