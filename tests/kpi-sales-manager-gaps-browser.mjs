// Item 2 of the GSCO list (2026-11-16, «تمام موافق ابدأ»; GSCO 2.13.76) in a real Chromium against the BUILT release (run the build first).
// Synthetic fixtures only: temporary SQLite, mocked sendmail, no production data. The month is October 2025 (closed), picked in the month
// field as a person does. The sales manager has an ERP employee code, an ERP sale of his own and an old assessment.
// - The sales manager's «نتائج الأداء»: the box «المطلوب لاكتمال التقييم» above «مقارنة أداء المناديب», each action with its weight and
//   whom it concerns; the comparison without himself; under each incomplete score «بيانات ناقصة» with the names and weights; the person's
//   page of a representative with the checklist «المؤشر (الوزن): المطلوب»; the picker «المندوب» without him.
// - The administrator's «المستهدفات والأوزان»: «مستهدفات العملاء والزيارات» without the sales manager, his card with no customer and visit
//   targets and why (his products target stays).
// - The supervisor's «نتائج الأداء»: the box and his team.
// At phones of 320 and 360 px, a tablet upright and on its side and a desktop, in Arabic and in English (no Arabic left but names); nothing
// scrolls sideways; screenshots of each screen (YR_GATE_SCREENSHOT_DIR, else a temporary folder named in the output).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-kpi-gaps-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'sm', name: 'المشرف سالم'}, {id: 'rep1', role: 'rep', sup: 'sup', name: 'المندوب أحمد'}, {id: 'rep2', role: 'rep', sup: 'sup', name: 'المندوب خالد'}
];
const PRODUCTS = ['قوالب البلوك المتحركة', 'قوالب البلوك الثابتة', 'لمامة البلوك', 'ماكينة إنتاج البلوكة المتحركة', 'قطع غيار المكائن المتحركة', 'خلاطات البلوك', 'خلاطات الخرسانة الجاهزة', 'خدمات صيانة'];
const SIZES = {phone320: {width: 320, height: 680}, phone360: {width: 360, height: 800}, tabletUp: {width: 768, height: 1024}, tabletSide: {width: 1024, height: 768}, desktop: {width: 1366, height: 900}};
const TEXT = {
  ar: {title: 'المطلوب لاكتمال التقييم', missing: 'بيانات ناقصة', target: 'حدّد مستهدف كل صنف له وزن', collection: 'ارفع كشف التحصيل لهذا الشهر', conduct: 'تقييم السلوك من الإدارة (10%)', attainment: 'تحقيق المستهدف البيعي (25%)', everyone: 'كل المناديب', out: 'مدير المبيعات خارج التقييم ومستهدفات العملاء والزيارات.', activity: 'مستهدفات العملاء والزيارات', team: 'محسوب من الفريق'},
  en: {title: 'What completes the evaluation', missing: 'Missing data', target: 'Set a target for every weighted product', collection: 'Upload this month’s collection statement', conduct: 'Conduct assessment by management (10%)', attainment: 'Sales target achievement (25%)', everyone: 'All sales reps', out: 'The sales manager is outside the evaluation and the customer and visit targets.', activity: 'Customer and visit targets', team: 'Calculated from the team'}
};
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const names = [...members.map(m => m.name), 'الرئيسي'];
const arabicLeft = text => { let rest = text; for (const name of names) rest = rest.split(name).join(''); return rest.match(/[^\s]*[؀-ۿ][^\s]*/g) || []; };
const flat = text => text.replace(/\s+/g, ' ').trim();

try {
  app = await bootBuiltApp({members}, {tls: true});
  const stamp = '2025-01-01T00:00:00.000Z';
  const insert = (id, kind, parent, assigned, data) => app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id, kind, parent, assigned, 'الرئيسي', JSON.stringify(data), stamp, stamp).run();
  for (const id of ['rep1', 'rep2', 'sup', 'sm']) await insert('c-' + id, 'customer', null, id, {name: 'مصنع ' + id, region: 'الشرقية', city: 'الدمام'});
  for (const [by, date] of [['rep1', '2025-09-10'], ['rep1', '2025-10-10'], ['rep2', '2025-10-12'], ['sup', '2025-10-14'], ['sm', '2025-10-16']]) await insert('v-' + by + '-' + date, 'activity', 'c-' + by, by, {type: 'visit', date, summary: 'تعريف بالمنتجات', result: 'العميل مهتم', performedBy: by, responsibleId: by, recordedByEmail: by + '@yourrest.org', salesStage: 'specs'});
  const target = (kind, scope, data) => app.db.prepare('INSERT INTO crm_target_sets(kind,scope_id,month,data,version,mutation_id,updated_by,updated_at) VALUES(?,?,?,?,1,?,?,?)').bind(kind, scope, '2025-01', JSON.stringify(data), 'fixture', 'owner', stamp).run();
  // The weights (two products), rep1's targets of both and rep2's of the first only: rep2's attainment waits for a target.
  await target('weights', 'company', {products: PRODUCTS.map((product, i) => ({product, weight: [60, 40][i] || 0}))});
  await target('sales', 'rep1', {products: PRODUCTS.map((product, i) => ({product, quantity: [10, 5][i] ?? 0}))});
  await target('sales', 'rep2', {products: PRODUCTS.map((product, i) => ({product, quantity: i === 1 ? null : i === 0 ? 8 : 0}))});
  await target('activity', 'rep1', {newCustomers: 2, recoveredCustomers: 1, visits: 4});
  await app.db.prepare('INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES(?,?,?,?,?,?)').bind('erp-import-1', 'owner', 'fp-1', 'synthetic.xlsx', JSON.stringify({coverage: {complete: true, from: '2025-01-01', to: '2025-10-31', months: [], partialMonths: [], repIds: ['rep1', 'rep2'], allReps: false, importerId: 'owner', importer: 'مدير النظام', at: stamp, importId: 'erp-import-1'}}), stamp).run();
  let n = 0;
  const erp = async (rep, code, date, product, employee = 'E-' + rep) => { n++; await app.db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'h','m',?,'sale',?,?,?,'الرئيسي','all',?,'عميل اصطناعي',?,10000,'erp-import-1','owner',?)").bind('erp-' + n, 'doc-' + n, 'INV-' + n, date, employee, rep, code, JSON.stringify({items: [{product, quantity: 2, unitPrice: 100}], discount: 0}), stamp).run(); };
  for (const [code, date] of [['A', '2025-07-05'], ['A', '2025-10-05']]) await erp('rep1', code, date, PRODUCTS[0]);
  await erp('rep2', 'E', '2025-10-06', PRODUCTS[0]);
  // «حتى لو له كود موظف أو تقييمات قديمة»: an ERP employee number mapped to the sales manager, his own sale, and his old assessment.
  await app.db.prepare('INSERT INTO crm_erp_employee_mappings(employee_id,rep_id,updated_by,updated_at) VALUES(?,?,?,?)').bind('E-SM', 'sm', 'owner', stamp).run();
  await erp('sm', 'M', '2025-10-08', PRODUCTS[0], 'E-SM');
  const grade = score => ({score, note: ''});
  await app.db.prepare('INSERT INTO crm_kpi_assessments(member_id,month,input,version,mutation_id,updated_by,updated_at) VALUES(?,?,?,1,?,?,?)').bind('sm', '2025-10', JSON.stringify({reviewed: null, correct: null, review_note: '', conduct: {responsibility: grade(70), teamwork: grade(70), honesty: grade(70), professionalism: grade(70), appearance: grade(70)}}), 'old-sm', 'owner', stamp).run();

  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});
  const cookies = {};
  async function open(who, hash, {viewport, english}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: viewport.width < 1100, isMobile: viewport.width < 500});
    cookies[who] ??= await app.login(who);
    const [name, ...value] = cookies[who].split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    await context.addInitScript(lang => { try { localStorage.setItem('yr-language', lang); } catch { /* storage unavailable */ } }, english ? 'en' : 'ar');
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(who + ': ' + error.message));
    await page.goto(app.origin + hash);
    await page.waitForFunction(lang => document.documentElement.lang === lang, english ? 'en' : 'ar');
    await page.locator('.targets-hub-month input').fill('2025-10');
    return page;
  }
  const noSideways = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no sideways scrolling');
  const shot = async (page, box, name, block = 'start') => { await box.evaluate((element, where) => element.scrollIntoView({block: where}), block); await page.waitForTimeout(250); await page.screenshot({path: path.join(screenshots, name + '.png')}); };

  for (const [size, viewport] of Object.entries(SIZES)) {
    for (const lang of ['ar', 'en']) {
      const english = lang === 'en', T = TEXT[lang], label = size + ' ' + lang;
      // ---- The sales manager's «نتائج الأداء»: the box above the comparison, the comparison without him, the names and weights.
      let page = await open('sm', '/?tab=results#targets', {viewport, english});
      const table = page.locator('.kpi-workspace table'), box = page.locator('[data-kpi-gaps-summary]');
      await page.locator('.kpi-workspace tr', {hasText: 'المندوب خالد'}).waitFor();
      await box.waitFor();
      ok((await box.boundingBox()).y < (await table.boundingBox()).y, label + ': the box sits above the comparison');
      const boxText = flat(await box.innerText());
      ok(boxText.startsWith(T.title), label + ': its title');
      ok(boxText.includes(T.target) && boxText.includes(T.collection) && boxText.includes(T.everyone), label + ': its actions, with whom they concern: ' + boxText.slice(0, 300));
      ok(/— 25% —/.test(boxText) && /— 10% —/.test(boxText), label + ': with their weights');
      const rows = await page.locator('.kpi-workspace tbody tr').allInnerTexts();
      check(rows.some(row => row.includes('مدير المبيعات')), false, label + ': the sales manager is not in the comparison');
      check(rows.filter(row => /المندوب أحمد|المندوب خالد|المشرف سالم/.test(row)).length, 3, label + ': his team is');
      const rep2 = flat(rows.find(row => row.includes('المندوب خالد')));
      ok(rep2.includes(T.missing + ': ' + T.attainment) && rep2.includes(T.conduct), label + ': rep2\'s missing indicators with their weights: ' + rep2);
      if (english) { check(arabicLeft(boxText), [], label + ': no Arabic left in the box'); check(arabicLeft(rows.join('\n')), [], label + ': no Arabic left in the comparison'); }
      await noSideways(page, label + ' comparison');
      await shot(page, box, 'kpi-gaps-comparison-' + size + '-' + lang);
      // The picker «المندوب» on this tab: his team, not him.
      if (size === 'desktop' || size === 'phone360') {
        await page.locator('.targets-hub-toolbar [role=combobox]').nth(1).click();
        const options = await page.locator('[role=option]').allInnerTexts();
        ok(options.some(option => option.includes('المندوب خالد')) && !options.some(option => option.includes('مدير المبيعات')), label + ': the picker lists his team, not him: ' + options.join(' | '));
        await page.keyboard.press('Escape');
      }
      // The person's page: the checklist.
      await page.locator('.kpi-workspace tr', {hasText: 'المندوب خالد'}).locator('td').last().locator('button').click();
      await page.locator('.kpi-person-heading', {hasText: 'المندوب خالد'}).waitFor();
      const notice = page.locator('.kpi-workspace .kpi-partial-notice');
      const items = (await notice.locator('[data-kpi-gap]').allInnerTexts()).map(flat);
      ok(items.some(item => item.startsWith(T.attainment + ': ' + T.target)), label + ': the checklist names attainment and what completes it: ' + items.join(' | '));
      ok(items.some(item => item.startsWith(T.conduct + ':')), label + ': and conduct');
      ok(flat(await notice.innerText()).includes(T.title + ':'), label + ': under «' + T.title + '»');
      if (english) check(arabicLeft(await notice.innerText()), [], label + ': no Arabic left in the checklist');
      await noSideways(page, label + ' person');
      await shot(page, notice, 'kpi-gaps-person-' + size + '-' + lang);
      await page.context().close();
      // ---- The administrator's «المستهدفات والأوزان»: no customer and visit targets for the sales manager.
      page = await open('owner', '/?tab=targets#targets', {viewport, english});
      const card = page.locator('.target-card[data-scope="sm"]');
      await card.waitFor({state: 'attached'});
      const cardText = flat(await card.textContent());
      ok(cardText.includes(T.out) && cardText.includes(T.team), label + ': his card says why, and his products target is still computed from his team');
      check(await card.locator('.target-card-activity').count(), 0, label + ': no customer and visit targets on his card');
      check(await page.locator('.target-card[data-scope="sup"] .target-card-activity').count(), 1, label + ': the supervisor\'s card keeps them');
      const activityRows = await page.locator('.target-activity-panel tbody tr').evaluateAll(rows => rows.map(row => row.textContent));
      ok(activityRows.some(row => row.includes('المشرف سالم')) && !activityRows.some(row => row.includes('مدير المبيعات')), label + ': «' + T.activity + '» without him');
      if (english) check(arabicLeft(flat(await card.innerText())), [], label + ': no Arabic left in his card');
      await noSideways(page, label + ' targets');
      if (viewport.width < 480) await shot(page, card.locator('[data-activity-out]'), 'kpi-gaps-targets-card-' + size + '-' + lang, 'center');
      else await shot(page, page.locator('.target-activity-panel'), 'kpi-gaps-targets-activity-' + size + '-' + lang);
      await page.context().close();
    }
  }
  // ---- The supervisor: the box above his team's comparison.
  for (const lang of ['ar', 'en']) {
    const page = await open('sup', '/?tab=results#targets', {viewport: SIZES.desktop, english: lang === 'en'});
    await page.locator('.kpi-workspace tr', {hasText: 'المندوب خالد'}).waitFor();
    const box = page.locator('[data-kpi-gaps-summary]');
    ok(flat(await box.innerText()).startsWith(TEXT[lang].title), 'the supervisor sees the box (' + lang + ')');
    check((await page.locator('.kpi-workspace tbody tr').allInnerTexts()).some(row => row.includes('مدير المبيعات')), false, 'and his team without the sales manager (' + lang + ')');
    await shot(page, box, 'kpi-gaps-supervisor-desktop-' + lang);
    await page.context().close();
  }
  check(errors, [], 'no page errors');
  console.log(JSON.stringify({ok: true, checks, screenshots, syntheticFixtures: true, productionDataUsed: false}));
} finally { await browser?.close(); await app?.stop(); }
