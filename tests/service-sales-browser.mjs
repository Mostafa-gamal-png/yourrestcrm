// Customer service in the sales process (the owner, 2026-11-16, item 5 of the GSCO list) in a real Chromium against the BUILT release (run
// the build first): «تسجيل دور خدمة العملاء» at the top of «الفرص» (recorded once), «مصادر الفرص» and «بدء فرصة جديدة من هذه الفرصة» opening the
// new-opportunity form with its source locked, «مصدر الفرصة» in the form, «اعتماد وإحالة» (the two choices, the reasons, the warning), the
// stage of an opportunity customer service keeps, «أداء خدمة العملاء» with its «تصدير Excel», and the line «منها مبيعات خدمة العملاء بالكامل»
// under the ERP total of «رفع المبيعات». Phone 320 and 360, a tablet upright and on its side, a computer; Arabic and English (no Arabic
// left in English but what people wrote: names); nothing scrolls sideways. Screenshots for the report. Synthetic fixtures only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف'}, {id: 'rep', role: 'rep', sup: 'sup', name: 'المندوب أحمد'},
  {id: 'csm', role: 'customer_service_manager', sup: 'mgr', name: 'مدير خدمة العملاء'}, {id: 'cs', role: 'customer_service', sup: 'csm', name: 'ممثلة الخدمة'},
  // A customer-service team that does not report to the sales manager (the owner's decision 3: he reads his own teams only).
  {id: 'csm2', role: 'customer_service_manager', name: 'مدير خدمة العملاء الثاني'}, {id: 'cs3', role: 'customer_service', sup: 'csm2', name: 'ممثل الفريق الثاني'},
  {id: 'mgr2', role: 'manager', name: 'مدير مبيعات بلا فريق'}
];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-csales-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const SIZES = [['phone-320', {width: 320, height: 720}, true], ['phone-360', {width: 360, height: 800}, true], ['tablet-upright', {width: 768, height: 1024}, true], ['tablet-side', {width: 1024, height: 768}, true], ['desktop', {width: 1280, height: 900}, false]];
// What people wrote stays as written in English too: the members' and the customers' names, the source a person typed.
const NAMES = /تواصلت مع العميل حتى أكد الطلب|مصنع [^\n·|،,]*|مدير النظام|مدير مبيعات بلا فريق|مدير المبيعات|مدير خدمة العملاء الثاني|ممثل الفريق الثاني|مدير خدمة العملاء|ممثلة الخدمة|المندوب أحمد|المشرف/g;
const arabicLeft = text => text.replace(NAMES, '').match(/[؀-ۿ][^\n]{0,40}/)?.[0] || '';

try {
  app = await bootBuiltApp({members}, {tls: true});
  const now = new Date().toISOString(), earlier = new Date(Date.now() - 30 * 3600000).toISOString(), longAgo = new Date(Date.now() - 200 * 86400000).toISOString();
  const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()), month = day.slice(0, 7);
  const insert = (id, kind, parent, assigned, data, when = earlier) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,'الرئيسي',?,?,?,1,'fixture')").bind(id, kind, parent, assigned, JSON.stringify(data), when, when).run();
  const customer = (id, name, code = '') => insert(id, 'customer', null, 'rep', {name, branch: 'الرئيسي', assignedTo: 'rep', region: 'الوسطى', city: 'الرياض', customerStatus: 'نشط', phone: '0551234567', contact: 'م', code}, longAgo);
  const kase = (id, customerId, status, extra = {}, data = {}) => app.db.prepare('INSERT INTO crm_service_cases(id,customer_id,status,creator_id,service_manager_id,sales_manager_id,assigned_to,supervisor_id,data,created_at,updated_at,version,mutation_id,lead_group,lead_source,route,routed_by,routed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,2,?,?,?,?,?,?)')
    .bind(id, customerId, status, 'cs', 'csm', extra.salesManager ?? null, extra.assigned ?? null, null, JSON.stringify({source: 'call', products: ['خدمات صيانة'], strength: 'strong', needs: 'تحديد موعد زيارة', nextAction: 'زيارة', nextDate: '2030-01-01', participants: ['cs', 'csm'], registration: {type: 'call', visitNumber: extra.number ?? 50}, ...data}), extra.created ?? earlier, earlier, 'fixture', extra.group ?? 'service', extra.source ?? 'واتساب', extra.route ?? null, extra.route ? 'csm' : null, extra.route ? earlier : null).run();
  const runs = SIZES.flatMap(([label]) => ['ar', 'en'].map(language => label + '-' + language));
  // For each size and language: an opportunity customer service keeps, won now (its owner's role task), with its own customer.
  for (const [index, tag] of runs.entries()) {
    await customer('cust-won-' + tag, 'مصنع الفوز ' + (index + 1), 'W' + index);
    await kase('case-won-' + tag, 'cust-won-' + tag, 'service', {assigned: 'cs', route: 'service', number: 200 + index}, {approvedAt: earlier, serviceStages: [{stage: 'won', lossReason: '', note: '', by: 'cs', at: new Date().toISOString()}]});
  }
  // A lost opportunity (the list «فرص مفقودة للاسترداد»), a dormant customer, one waiting for approval with an open sales visit, one kept and open.
  await customer('cust-lost', 'مصنع المفقودة', 'L1');
  await kase('case-lost', 'cust-lost', 'assigned', {assigned: 'rep', salesManager: 'mgr', route: 'sales', number: 301}, {approvedAt: earlier, assignedAt: earlier});
  await insert('k-lost', 'activity', 'cust-lost', 'rep', {type: 'call', date: day, result: 'رفض العرض', salesStage: 'lost', lossReason: 'السعر أعلى من المنافس', serviceCaseId: 'case-lost', performedBy: 'rep', responsibleId: 'rep', recordedByEmail: 'rep@yourrest.org'}, earlier);
  await customer('cust-dorm', 'مصنع المنقطع', 'D1');
  await app.db.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('imp','owner','fp','synthetic.xlsx','{}',?)").bind(now).run();
  const erp = (id, code, date, cents, refs = []) => app.db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'h','m',?,'sale',?,'E1','rep','الرئيسي','all',?,'عميل اصطناعي',?,?,'imp','owner',?)")
    .bind(id, 'doc-' + id, 'INV-' + id, date, code, JSON.stringify({items: [{product: 'قوالب البلوك المتحركة', quantity: 2, unitPrice: cents / 200}], discount: 0, ...(refs.length ? {quotationRefs: refs} : {})}), cents, now).run();
  await erp('old-dorm', 'D1', new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date(Date.now() - 150 * 86400000)), 10000);
  await customer('cust-wait', 'مصنع بانتظار الاعتماد', '');
  await kase('case-wait', 'cust-wait', 'pending_approval', {number: 302});
  await insert('k-wait-sales', 'activity', 'cust-wait', 'rep', {type: 'visit', date: day, result: 'تم أخذ موعد', salesStage: 'quoted', performedBy: 'rep', responsibleId: 'rep', recordedByEmail: 'rep@yourrest.org'}, earlier);
  await customer('cust-held', 'مصنع لدى الخدمة', 'H1');
  await kase('case-held', 'cust-held', 'service', {assigned: 'cs', route: 'service', number: 303, created: now}, {approvedAt: earlier});
  await insert('q-held', 'quote', 'cust-held', 'rep', {number: 'Qut-990', date: day, validUntil: day, status: 'sent', items: [{description: 'قالب', quantity: 1, price: 1200}], discount: 0, taxRate: 15, total: 1380}, now);
  await erp('e-full', 'H1', day, 120000, ['Qut-990']);
  await erp('e-plain', 'L1', day, 40000);
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});
  const cookies = {};
  for (const member of members) cookies[member.id] = await app.login(member.id);

  async function open(memberId, {english = false, viewport, touch = false, hash = '', search = ''}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: touch, isMobile: touch && viewport.width < 700, acceptDownloads: true});
    const [name, ...value] = cookies[memberId].split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    if (english) await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    await page.goto(app.origin + '/' + search + hash);
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('.topbar').waitFor();
    return page;
  }
  const shot = async (page, label) => { await page.waitForTimeout(250); await page.screenshot({path: path.join(screenshots, label + '.png'), fullPage: false}); };
  const noSideways = async (page, label) => eq(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scrolling');
  const english = async (locator, label) => eq(arabicLeft(await locator.innerText()), '', label + ': no Arabic left in English');
  const close = async page => { await page.context().close(); };

  for (const [label, viewport, touch] of SIZES) for (const inEnglish of [false, true]) {
    const tag = label + '-' + (inEnglish ? 'en' : 'ar'), say = (ar, en) => inEnglish ? en : ar;
    // ---- customer service: the role task, «مصادر الفرص», the start from a lost opportunity, the new-opportunity form
    let page = await open('cs', {english: inEnglish, viewport, touch, hash: '#activity'});
    const tasks = page.locator('[data-role-tasks]');
    await tasks.waitFor();
    const task = tasks.locator('[data-role-task="case-won-' + tag + '"]');
    ok((await task.innerText()).includes(say('تم الفوز', 'Won')), tag + ': the won opportunity\'s role task waits for her');
    await task.getByRole('button', {name: say('تسجيل الدور', 'Record the role')}).click();
    const form = task.locator('[data-role-task-form]');
    await form.getByLabel(say('جلب العميل', 'Bringing the customer')).check();
    await form.locator('textarea').fill(say('تواصلت مع العميل حتى أكد الطلب', 'I followed the customer up until the order'));
    if (inEnglish) await english(tasks, tag + ' (role task)');
    await noSideways(page, tag + ' (role task form)');
    await shot(page, 'csales-' + tag + '-role-task');
    await form.getByRole('button', {name: say('حفظ الدور', 'Save the role')}).click();
    await task.locator('.role-task-done').waitFor();
    ok((await task.innerText()).includes(say('جلب العميل', 'Bringing the customer')), tag + ': recorded, with its role');
    const leads = page.locator('[data-service-leads]');
    await leads.locator('summary').click();
    const lost = leads.locator('[data-lead-row="case-lost"]');
    await lost.waitFor();
    ok((await lost.innerText()).includes(say('السعر أعلى من المنافس', 'Price higher than the competitor')) || (await lost.innerText()).includes('#301'), tag + ': the lost opportunity with its loss reason');
    if (inEnglish) await english(leads, tag + ' («مصادر الفرص»)');
    await noSideways(page, tag + ' (opportunity sources)');
    await shot(page, 'csales-' + tag + '-lead-lists');
    await leads.getByRole('tab', {name: say('عملاء منقطعون عن الشراء 90 يومًا', 'Customers who have not bought for 90 days')}).click();
    await leads.locator('[data-lead-row="cust-dorm"]').waitFor();
    ok(true, tag + ': the dormant customer is listed');
    ok((await leads.locator('[data-lead-row="cust-won-' + tag + '"][data-never-bought="1"]').innerText()).includes(say('لم يشترِ من قبل', 'Never bought')), tag + ': and one who never bought, after it, marked (the owner\'s decision 4)');
    ok((await leads.locator('[data-dormant-counts]').innerText()).includes(say('لم يشتروا من قبل', 'Never bought before')), tag + ': with the counts by kind');
    if (inEnglish) await english(leads.locator('[data-dormant-counts]'), tag + ' (the counts)');
    await noSideways(page, tag + ' (the dormant list)');
    await shot(page, 'csales-' + tag + '-dormant-list');
    await leads.getByRole('tab', {name: say('فرص مفقودة للاسترداد', 'Lost opportunities to win back')}).click();
    await leads.locator('[data-lead-row="case-lost"] [data-lead-start] button').click();
    const dialog = page.locator('.customer-visit-dialog');
    await dialog.locator('[data-lead-locked]').waitFor();
    ok((await dialog.locator('[data-lead-locked]').innerText()).includes(say('فرصة مفقودة سابقة', 'A previously lost opportunity')), tag + ': «بدء فرصة جديدة من هذه الفرصة» opens the form with the source locked');
    if (inEnglish) await english(dialog.locator('[data-lead-section]'), tag + ' (the locked source)');
    await noSideways(page, tag + ' (new opportunity from a lost one)');
    await shot(page, 'csales-' + tag + '-start-from-lost');
    await page.keyboard.press('Escape');
    await dialog.waitFor({state: 'detached'}).catch(async () => { await page.getByRole('button', {name: say('أكمل التسجيل', 'Keep editing')}).count(); });
    await close(page);
    // ---- the new-opportunity form asks for the source
    page = await open('cs', {english: inEnglish, viewport, touch, hash: '#activity'});
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('yourrest:start-opportunity', {detail: null})));
    // «فرصة جديدة» of the top bar (on a phone it may sit in the compact bar; waited for, then required on the larger screens).
    const newButton = page.getByRole('button', {name: say('فرصة جديدة', 'New opportunity')}).first();
    const shown = await newButton.waitFor({timeout: 8000}).then(() => true, () => false);
    if (!touch || viewport.width >= 768) ok(shown, tag + ': «فرصة جديدة» is offered');
    if (shown) {
      await newButton.click();
      const field = page.locator('.customer-visit-dialog [data-lead-source]');
      await field.waitFor();
      const options = await field.locator('select option').allInnerTexts();
      ok(options.includes(say('واتساب', 'WhatsApp')) && options.includes(say('توصية من عميل', 'Customer referral')), tag + ': «مصدر الفرصة» offers the sources customer service brings in');
      // Asked by the form's own checks after the others (a browser's own «required» stopped the form before «نتيجة التواصل» was shown).
      eq([await field.locator('select').getAttribute('required'), await field.locator('select').getAttribute('aria-required')], [null, 'true'], tag + ': the source is marked as required and checked by the form, not by the browser');
      if (inEnglish) await english(field, tag + ' (the source field)');
      await noSideways(page, tag + ' (new opportunity form)');
      await shot(page, 'csales-' + tag + '-lead-field');
    }
    await close(page);
    // ---- the owner's stage on the opportunity customer service keeps
    page = await open('cs', {english: inEnglish, viewport, touch, hash: '#service-case=case-held'});
    const held = page.locator('.service-sheet [data-held-stage]');
    await held.waitFor();
    ok((await page.locator('.service-sheet').innerText()).includes(say('لدى خدمة العملاء', 'With customer service')), tag + ': «لدى خدمة العملاء»');
    if (inEnglish) await english(held, tag + ' (the stage form)');
    await noSideways(page, tag + ' (opportunity kept by customer service)');
    await shot(page, 'csales-' + tag + '-held-stage');
    await close(page);
    // ---- «اعتماد وإحالة» and «أداء خدمة العملاء» for the customer-service manager
    page = await open('csm', {english: inEnglish, viewport, touch, hash: '#service-case=case-wait'});
    const decision = page.locator('.service-sheet [data-routing-decision]');
    await decision.waitFor();
    ok((await decision.locator('[data-routing-warning]').innerText()).includes(say('تنبيه: للعميل فرصة مفتوحة لدى المبيعات', 'Warning: the customer has an open opportunity with sales')), tag + ': the warning of an open sales opportunity');
    await decision.getByLabel(say('تتولاها خدمة العملاء', 'Customer service takes it')).check();
    ok((await decision.innerText()).includes(say('ممثل خدمة العملاء الذي يتولاها', 'Customer-service member who takes it')), tag + ': the customer-service member to give it to');
    if (inEnglish) await english(decision, tag + ' (the decision)');
    await noSideways(page, tag + ' (approval decision)');
    await shot(page, 'csales-' + tag + '-routing');
    await page.keyboard.press('Escape');
    await close(page);
    page = await open('csm', {english: inEnglish, viewport, touch, hash: '#activity'});
    const performance = page.locator('[data-service-performance]');
    await performance.locator('summary').click();
    await performance.locator('[data-performance-team]').first().waitFor();
    ok((await performance.innerText()).includes(say('مبيعات بالكامل', 'Full customer-service sales')), tag + ': the dashboard\'s columns');
    if (inEnglish) await english(performance, tag + ' («أداء خدمة العملاء»)');
    const [download] = await Promise.all([page.waitForEvent('download'), performance.locator('[data-performance-export] button').click()]);
    eq(download.suggestedFilename(), 'Yourrest-service-performance-' + month + '.xlsx', tag + ': «تصدير Excel»');
    await noSideways(page, tag + ' (performance)');
    await performance.scrollIntoViewIfNeeded();
    await shot(page, 'csales-' + tag + '-performance');
    await close(page);
    // ---- the sales manager reads the customer-service teams under him only (the owner's decision 3)
    page = await open('mgr', {english: inEnglish, viewport, touch, hash: '#activity'});
    const managerView = page.locator('[data-service-performance]');
    await managerView.locator('summary').click();
    await managerView.locator('[data-performance-team]').first().waitFor();
    eq(await managerView.locator('[data-performance-team]').evaluateAll(list => list.map(item => item.getAttribute('data-performance-team'))), ['csm'], tag + ': the sales manager reads the team of the customer-service manager under him, not another');
    ok(!(await managerView.innerText()).includes('ممثل الفريق الثاني'), tag + ': nor any member of another team');
    ok((await managerView.locator('[data-performance-reach]').innerText()).includes(say('تظهر هنا فرق خدمة العملاء التي يتبعك مديروها فقط.', 'Only the customer-service teams whose managers report to you are shown here.')), tag + ': and says so');
    if (inEnglish) await english(managerView, tag + ' (the sales manager\'s «أداء خدمة العملاء»)');
    await noSideways(page, tag + ' (the sales manager\'s performance)');
    await managerView.scrollIntoViewIfNeeded();
    await shot(page, 'csales-' + tag + '-manager-performance');
    await close(page);
    // ---- a sales manager no customer-service team reports to: an empty answer and words, not an error
    page = await open('mgr2', {english: inEnglish, viewport, touch, hash: '#activity'});
    const lonely = page.locator('[data-service-performance]');
    await lonely.locator('summary').click();
    await lonely.locator('[data-performance-no-team]').waitFor();
    ok((await lonely.locator('[data-performance-no-team]').innerText()).includes(say('لا يتبعك فريق خدمة عملاء', 'No customer-service team reports to you')), tag + ': «لا يتبعك فريق خدمة عملاء»');
    eq(await lonely.locator('[data-performance-export]').count(), 0, tag + ': and nothing to export');
    if (inEnglish) await english(lonely, tag + ' (no team)');
    await noSideways(page, tag + ' (a sales manager with no team)');
    await lonely.locator('[data-performance-no-team]').scrollIntoViewIfNeeded();
    await shot(page, 'csales-' + tag + '-manager-no-team');
    await close(page);
    // ---- «رفع المبيعات»: the ERP total and the line under it
    page = await open('mgr', {english: inEnglish, viewport, touch, hash: '#targets', search: '?tab=sales'});
    const line = page.locator('[data-service-full-line]');
    await line.waitFor();
    ok((await line.innerText()).includes(say('منها مبيعات خدمة العملاء بالكامل', 'Of which full customer-service sales')) && (await line.innerText()).includes('1,200'), tag + ': the line under the ERP total');
    ok((await page.locator('.sales-metrics').innerText()).includes('1,600'), tag + ': the total keeps the ERP sales (1,200 + 400)');
    if (inEnglish) await english(line, tag + ' (the line)');
    await noSideways(page, tag + ' (sales report)');
    await line.scrollIntoViewIfNeeded();
    await shot(page, 'csales-' + tag + '-sales-line');
    await close(page);
  }
  eq(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks, screenshots, sizes: SIZES.map(size => size[0])}));
} finally {
  await browser?.close();
  await app?.stop();
}
