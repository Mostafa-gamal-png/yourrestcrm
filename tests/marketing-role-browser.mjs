// «مسؤول تسويق» and the customer classifications as the owner corrected them (lib/roles.ts, lib/customer-classification.ts,
// lib/opportunity-strength.ts, 2026-11-18: «تصنيف الفرصة ده موجود بالفعل بس هيزيد / تصنيف حجم المصنع ده بيتحسب من عدد ماكينات المتسجلة داخل
// المصنع / وهو هيدخل التصنيف العميل بناء على اهتماماته») in a real Chromium against the BUILT release (run the build first). On «العملاء»
// at 320 and 360 px, a tablet upright and sideways and a desktop, in Arabic and in English, as the marketing officer in the simulated
// Android app: two filters («حجم المصنع (محسوب من الماكينات)»، «اهتمام العميل»), the size computed (the machines counted once, D from the
// status «خامل», a stored size never read) on the card, the sheet and the form, never chosen; no grade, notes or «اعتماد المقترح»; the
// interest chosen and saved directly; what the release before stored kept by the save; a status set to «خامل» in the form turns the size
// to D at once; another branch's customer with its size and no interest, its correction sent for approval. A representative: their own
// customer's interest read only, another's hidden but its computed size shown. The administrator: the marks on the desktop table, the
// marketing officer's direct correction in the history (Arabic and English). On «الزيارات»: «قوة الفرصة» A to D, its filter offering D,
// a visit graded D in its form with the owner's description under the field and saved, the table and the cards in both languages.
// Nothing scrolls sideways, every field and filter is inside the screen, no Arabic is left in English but the data. Screenshots for the
// report. Synthetic fixtures only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', region: 'eastern', name: 'المشرف سالم'},
  {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'},
  {id: 'mkt', role: 'marketing', sup: 'sup', region: 'eastern', name: 'مسؤولة التسويق ريم'},
  {id: 'repj', role: 'rep', sup: 'sup', region: 'eastern', branch: 'جدة', name: 'مندوب جدة'}
];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-marketing-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const SIZES = {'phone-320': {width: 320, height: 700}, 'phone-360': {width: 360, height: 800}, 'tablet-upright': {width: 768, height: 1024}, 'tablet-sideways': {width: 1024, height: 768}, desktop: {width: 1280, height: 900}};
const HOPE = 'مصنع الأمل للبلوك', LIGHT = 'مصنع النور', OWN = 'مصنع التسويق', DAWN = 'مصنع الشروق', SEA = 'مصنع البحر';

try {
  app = await bootBuiltApp({members}, {tls: true});
  const now = new Date().toISOString();
  const insert = (id, kind, parent, assigned, data, branch = 'الرئيسي') => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,1,'fixture')").bind(id, kind, parent, assigned, branch, JSON.stringify(data), now, now).run();
  const customer = (id, name, assigned, data = {}, branch = 'الرئيسي') => insert(id, 'customer', null, assigned, {name, branch, assignedTo: assigned, region: 'الشرقية', city: 'الدمام', customerStatus: 'نشط', phone: '0551234567', contact: 'أبو فهد', location: '26.43, 50.03', code: 'ERP-' + id, ...data}, branch);
  const machine = (id, parent, assigned, quantity, extra = {}) => insert(id, 'factory', parent, assigned, {name: 'خط ' + id, recordType: 'machine', quantity, machineBrand: 'Besser', modelCondition: 'new', machineType: 'stationary', ...extra});
  // Two machines in the sheet, imported as its group (app/api/machines/import), and the same two registered one by one: two, never four.
  await customer('c1', HOPE, 'rep', {machineCount: 2});
  await machine('m1', 'c1', 'rep', 2, {name: 'خط البلوك'});
  await machine('c1:source-machines-v1', 'c1', 'rep', 2, {name: 'ماكينات الشيت', recordType: 'group', machineType: 'unknown'});
  // The supervisor's customer, three machines, and a grade the release before stored (retired: never shown).
  await customer('c4', DAWN, 'sup', {opportunityGrade: 'C', customerInterest: 'service'});
  for (const n of [1, 2, 3]) await machine('m4-' + n, 'c4', 'sup', 1);
  // Another branch's (Jeddah's): its interest hidden from the marketing officer; a size stored by hand is never read.
  await customer('c5', SEA, 'repj', {opportunityGrade: 'A', factorySize: 'B', customerInterest: 'price', gradeNotes: 'سرية لفرع جدة'}, 'جدة');
  // «خامل»: D «متوقف» from its status; the grade, notes and size the release before stored stay as they are.
  await customer('c2', LIGHT, 'rep', {customerStatus: 'خامل', opportunityGrade: 'A', gradeNotes: 'طلب عرض سعر', factorySize: 'A', customerInterest: 'price'});
  await customer('c3', OWN, 'mkt', {customerInterest: 'trust'});
  // Two visits for «قوة الفرصة»: B on HOPE, D on DAWN.
  const visit = (id, parent, author, strength, day) => { const at = '2026-11-' + day + 'T07:00:00.000Z'; return insert(id, 'activity', parent, author, {visitWorkflow: 'customer-v1', type: 'call', date: at.slice(0, 10), summary: 'تعريف بمنتجات الشركة', result: 'متابعة العميل', nextAction: 'إرسال المواصفات', nextDate: '2099-12-10', salesStage: 'new', strength, requestedProducts: [], hasCompetitor: false, performedBy: author, responsibleId: author, recordedByEmail: author + '@yourrest.org', location: '26.43, 50.03', latitude: 26.43, longitude: 50.03, locationSource: 'device', locationCapturedAt: at, locationAccuracy: 5, startedAt: at, endedAt: at}); };
  await visit('v1', 'c1', 'rep', 'medium', '10');
  await visit('v2', 'c4', 'sup', 'excluded', '11');
  const stored = async id => JSON.parse((await app.db.prepare('SELECT data FROM crm_records WHERE id=?').bind(id).first()).data);
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});

  async function open(memberId, {english = false, viewport = SIZES['phone-360'], inApp = true, hash = '#customer'} = {}) {
    const touch = viewport.width < 1100;
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: touch, geolocation: {latitude: 26.43, longitude: 50.03, accuracy: 8}, permissions: ['geolocation']});
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    await context.addInitScript(english => { try { localStorage.setItem('yr-language', english ? 'en' : 'ar'); } catch { /* storage unavailable */ } }, english);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (inApp) await installNativeBridge(page, {memberId, regionScope: 'eastern'});
    await page.goto(app.origin + '/' + hash);
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator(hash === '#customer' ? '.customer-machines-page' : '.visits-table:visible, .rep-record-card:visible').first().waitFor();
    return page;
  }
  // The sheet slides in and the dialog zooms in: measured once their animations have finished.
  const still = page => page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
  const settle = page => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const shot = async (page, label) => { await settle(page); await page.screenshot({path: path.join(screenshots, label + '.png'), fullPage: false}); };
  const noSideways = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scrolling');
  const allInside = async (locator, label) => check(await locator.evaluateAll(nodes => nodes.filter(node => { const box = node.getBoundingClientRect(); return box.width && (box.left < -1 || box.right > innerWidth + 1); }).map(node => node.textContent.trim().slice(0, 40))), [], label + ': inside the screen');
  const noArabic = async (locator, label) => { const words = await locator.evaluate(node => { const copy = node.cloneNode(true); copy.querySelectorAll('bdi,textarea,input,.classification-notes').forEach(item => item.remove()); return copy.textContent; }); check(/[؀-ۿ]/.test(words), false, label + ': no Arabic left but the data (' + words.slice(0, 200) + ')'); };
  const compactList = page => page.locator('.customer-mobile-card').first().isVisible();
  const shownNames = async page => (await compactList(page)) ? page.locator('.customer-mobile-card h3').allInnerTexts() : page.locator('.unified-customers tbody .customer-expand strong').allInnerTexts();
  const openFilters = async (page, filter = '[data-classification-filter]') => { if (await page.locator('#crm-page-filters').isHidden()) await page.locator('.mobile-filter-toggle').click(); await page.locator(filter).first().waitFor(); };
  const pick = async (page, label, option) => { await page.getByRole('combobox', {name: label, exact: true}).click(); await page.getByRole('option', {name: option, exact: true}).click(); await page.getByRole('option').first().waitFor({state: 'hidden'}); };
  const openSheet = async (page, name, english) => {
    if (await compactList(page)) await page.getByRole('button', {name: (english ? 'Customer details: ' : 'بيانات العميل: ') + name, exact: true}).click();
    else await page.locator('.unified-customers tbody tr').filter({has: page.locator('strong', {hasText: name})}).getByRole('button', {name: english ? 'Customer details' : 'بيانات العميل', exact: true}).click();
    await page.locator('.crm-sheet').waitFor();await still(page);
    return page.locator('.crm-sheet');
  };
  const openForm = async (page, sheet, english) => { await sheet.getByRole('button', {name: english ? 'Edit' : 'تعديل', exact: true}).click(); const dialog = page.locator('.crm-master-dialog'); await dialog.locator('form').waitFor(); await still(page); return dialog; };
  const closeAll = async page => { for (let i = 0; i < 3 && await page.locator('[role=dialog]').count(); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); } };

  // ---- 1. The marketing officer at 360 px in Arabic: filters, sheet, form, a direct save.
  let page = await open('mkt');
  check(await page.evaluate(() => document.querySelector('.workspace')?.classList.contains('representative-workspace')), true, 'the representative\'s workspace in the app');
  check(await page.locator('.tracking-gate-screen, [data-gate="blocked"]').count(), 0, 'the tracking gate lets a set-up app through');
  await openFilters(page);
  check(await page.locator('[data-classification-filter]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-classification-filter'))), ['factorySize', 'customerInterest'], 'two classification filters: the computed size and the interest (no grade)');
  const sizeFilter = 'حجم المصنع (محسوب من الماكينات)';
  await pick(page, sizeFilter, 'C · صغير');
  check(await shownNames(page), [HOPE], 'C: two machines (the sheet\'s two are not added)');
  await pick(page, sizeFilter, 'B · متوسط');
  check(await shownNames(page), [DAWN], 'B: three machines');
  await pick(page, sizeFilter, 'D · متوقف');
  check(await shownNames(page), [LIGHT], 'D: the customer whose status is «خامل» (its stored A is not read)');
  await pick(page, sizeFilter, 'A · كبير');
  check(await shownNames(page), [], 'A: nobody (no stored size counts)');
  await pick(page, sizeFilter, 'غير محدد');
  check((await shownNames(page)).sort(), [OWN, SEA].sort(), '«غير محدد»: no machines (another branch\'s stored B is not read)');
  await pick(page, sizeFilter, 'كل أحجام المصانع');
  await pick(page, 'اهتمام العميل', 'غير محدد');
  check(await shownNames(page), [HOPE], 'no interest: another branch\'s customer is in no interest filter (its interest is not theirs to read)');
  await page.getByRole('button', {name: 'مسح الفلاتر', exact: true}).click();
  check((await shownNames(page)).sort(), [DAWN, HOPE, LIGHT, OWN, SEA].sort(), 'cleared: every customer');
  const badges = name => page.locator('.customer-mobile-card').filter({has: page.locator('h3', {hasText: name})}).locator('[data-classification-badges] .badge').allInnerTexts();
  check(await badges(LIGHT), ['الحجم: D · متوقف', 'الاهتمام: سعري'], 'the card: the computed size and the interest, no grade');
  check(await badges(DAWN), ['الحجم: B · متوسط', 'الاهتمام: خدمي'], 'the supervisor\'s customer: its size from its machines, nothing of its old grade');
  check(await badges(SEA), [], 'another branch\'s: no interest, and no size (no machines)');
  let sheet = await openSheet(page, HOPE);
  const summary = sheet.locator('[data-classification-summary]');
  check(await summary.locator('[data-classification-value="factorySize"] dt').innerText(), 'حجم المصنع (محسوب من الماكينات)', 'the sheet names the size as computed');
  check(await summary.locator('[data-classification-value="factorySize"] dd').innerText().then(text => text.replace(/\s+/g, ' ').trim()), 'C · صغير ماكينتان مسجلتان', 'C, from the two registered machines');
  check([await summary.locator('[data-classification-value="opportunityGrade"]').count(), await summary.locator('[data-classification-value="gradeNotes"]').count()], [0, 0], 'no grade and no notes');
  await noSideways(page, 'the sheet, 360');
  let dialog = await openForm(page, sheet);
  const editor = dialog.locator('[data-classification-editor]');
  await editor.waitFor();
  check(await dialog.locator('[data-customer-edit-note]').count(), 0, 'no «waits for approval» note: a marketing officer saves directly');
  check([await editor.locator('[data-classification="factorySize"]').count(), await editor.locator('[data-classification="opportunityGrade"]').count(), await editor.locator('textarea').count(), await editor.getByRole('button', {name: 'اعتماد المقترح'}).count()], [0, 0, 0, 0], 'no choice of size, no grade, no notes, no «اعتماد المقترح»');
  check(await editor.locator('[data-computed-size]').getAttribute('data-computed-size'), 'C', 'the size, computed, read only');
  check(await editor.locator('[data-classification="customerInterest"] label.customer-choice').allInnerTexts().then(texts => texts.map(text => text.replace(/\s+/g, ' ').trim())), ['غير محدد', 'فني الجودة والأداء: مقارنة فنية', 'سعري السعر هو الحاسم: عرض سعر تنافسي', 'خدمي سرعة التوريد والصيانة وخدمات ما بعد البيع', 'الثقة بناء علاقة مع العميل وعرض عملاء تعاملوا معنا'], 'the interest with its help');
  // The status set to «خامل» in the form turns the size to D at once; put back, it is C again.
  const status = value => dialog.locator('fieldset.customer-choice-field').filter({has: page.locator('legend', {hasText: 'حالة العميل'})}).locator('label.customer-choice').filter({hasText: new RegExp('^\\s*' + value + '\\s*$')});
  await status('خامل').click();
  check([await editor.locator('[data-computed-size]').getAttribute('data-computed-size'), await editor.locator('[data-computed-size] dd').innerText().then(text => text.replace(/\s+/g, ' ').trim())], ['D', 'D · متوقف حالة العميل «خامل»'], 'a status of «خامل»: D at once, and why');
  await status('نشط').click();
  check(await editor.locator('[data-computed-size]').getAttribute('data-computed-size'), 'C', 'back to «نشط»: C');
  await editor.locator('[data-classification="customerInterest"] label.customer-choice').filter({hasText: 'فني'}).click();
  await allInside(editor.locator('label.customer-choice, dd, button'), 'the classification fields, 360');
  await noSideways(page, 'the form, 360');
  await editor.scrollIntoViewIfNeeded();
  await shot(page, 'marketing-form-ar-360');
  let saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/crm' && response.request().method() === 'POST');
  await dialog.locator('button[type=submit]').click();
  const reply = await (await saved).json();
  check([reply.ok, reply.pendingApproval], [true, undefined], 'saved directly');
  let data = await stored('c1');
  check([data.customerInterest, data.customerStatus, 'factorySize' in data, 'opportunityGrade' in data], ['technical', 'نشط', false, false], 'stored: the interest; no size or grade written');
  await page.locator('.crm-master-dialog').waitFor({state: 'hidden'});
  await closeAll(page);
  // What the release before stored survives the form's save untouched.
  sheet = await openSheet(page, LIGHT);
  check(await sheet.locator('[data-classification-value="factorySize"] dd').innerText().then(text => text.replace(/\s+/g, ' ').trim()), 'D · متوقف حالة العميل «خامل»', 'D, from its status «خامل»');
  dialog = await openForm(page, sheet);
  await dialog.locator('[data-classification-editor] [data-classification="customerInterest"] label.customer-choice').filter({hasText: 'خدمي'}).click();
  saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/crm' && response.request().method() === 'POST');
  await dialog.locator('button[type=submit]').click();
  check((await (await saved).json()).ok, true, 'saved');
  data = await stored('c2');
  check([data.customerInterest, data.opportunityGrade, data.gradeNotes, data.factorySize], ['service', 'A', 'طلب عرض سعر', 'A'], 'the old grade, notes and size untouched by the save');
  await page.locator('.crm-master-dialog').waitFor({state: 'hidden'});
  await closeAll(page);
  await page.context().close();

  // ---- 1b. Another branch's customer (Jeddah's): its computed size and no interest, and the correction goes for approval.
  page = await open('mkt');
  sheet = await openSheet(page, SEA);
  check([await sheet.locator('[data-classification-value="factorySize"]').getAttribute('data-computed-size'), await sheet.locator('[data-classification-value="customerInterest"]').count()], ['none', 0], 'another branch\'s customer: «غير محدد» for its size (its stored B not read), no interest');
  check(await page.evaluate(async () => { const reply = await fetch('/api/crm', {cache: 'no-store'}); const data = (await reply.json()).records.find(record => record.id === 'c5').data; return [Object.keys(data).filter(key => ['opportunityGrade', 'gradeNotes', 'factorySize', 'customerInterest'].includes(key)), data._classificationHidden]; }), [[], true], 'none sent to the page, the customer marked hidden');
  dialog = await openForm(page, sheet);
  check([await dialog.locator('[data-classification-editor]').count(), await dialog.locator('[data-classification-readonly]').count(), await dialog.locator('[data-classification-readonly] input').count(), await dialog.locator('[data-customer-edit-note]').count()], [0, 1, 0, 1], 'the form: the computed size read only, no field, the note that the edit waits for approval');
  check(await dialog.locator('button[type=submit]').innerText().then(text => text.includes('إرسال التعديل للموافقة')), true, 'the button sends a request');
  await dialog.getByRole('textbox', {name: 'الجوال', exact: true}).fill('0559998877');
  await noSideways(page, 'the other branch\'s form, 360');
  await shot(page, 'marketing-other-branch-form-ar-360');
  const asked = page.waitForResponse(response => new URL(response.url()).pathname === '/api/crm' && response.request().method() === 'POST');
  await dialog.locator('button[type=submit]').click();
  const request = await (await asked).json();
  check([request.ok, request.pendingApproval, request.approvalStage], [true, true, 'supervisor'], 'sent to their supervisor');
  const sea = await stored('c5');
  check([sea.phone, sea.customerInterest, sea.opportunityGrade, sea.factorySize, sea.gradeNotes, '_classificationHidden' in sea], ['0551234567', 'price', 'A', 'B', 'سرية لفرع جدة', false], 'the customer unchanged while it waits; everything stored kept, no marker stored');
  await closeAll(page);
  await page.context().close();

  // ---- 2. Every size, Arabic and English: the filters and the form fit, the English has no Arabic left.
  for (const [label, viewport] of Object.entries(SIZES)) for (const english of [false, true]) {
    const tag = label + '-' + (english ? 'en' : 'ar');
    page = await open('mkt', {english, viewport});
    await openFilters(page);
    await allInside(page.locator('[data-classification-filter] [role=combobox]'), 'the filters, ' + tag);
    if (english) {
      check(await page.locator('[data-classification-filter] [role=combobox]').allInnerTexts().then(texts => texts.map(text => text.trim())), ['All factory sizes', 'All customer interests'], 'the filters in English, ' + tag);
      await noArabic(page.locator('.filterbar'), 'the filters, ' + tag);
      await pick(page, 'Customer interest', 'Technical');
      check(await shownNames(page), [HOPE], 'filtered in English, ' + tag);
      await noArabic(page.locator('[data-classification-badges]').first(), 'the marks, ' + tag);
      await page.getByRole('button', {name: 'Clear filters', exact: true}).click();
    }
    await noSideways(page, 'the customers page, ' + tag);
    if (label === 'phone-320' || label === 'desktop') await shot(page, 'marketing-customers-' + tag);
    sheet = await openSheet(page, HOPE, english);
    await allInside(sheet.locator('[data-classification-summary] dd'), 'the sheet, ' + tag);
    if (english) {
      await noArabic(sheet.locator('[data-classification-summary]'), 'the sheet, ' + tag);
      check(await sheet.locator('[data-classification-value="factorySize"] dt').innerText(), 'Factory size (computed from the machines)', 'the computed size named in English, ' + tag);
      check(await sheet.locator('[data-classification-value="factorySize"] dd').innerText().then(text => text.replace(/\s+/g, ' ').trim()), 'C · Small 2 registered machines', 'its value and why in English, ' + tag);
    }
    dialog = await openForm(page, sheet, english);
    const fields = dialog.locator('[data-classification-editor]');
    await fields.waitFor();
    await fields.scrollIntoViewIfNeeded();
    await allInside(fields.locator('label.customer-choice, dd, button, legend'), 'the classification fields, ' + tag);
    await noSideways(page, 'the form, ' + tag);
    if (english) { await noArabic(fields, 'the classification fields, ' + tag); check(await fields.locator('[data-classification="customerInterest"] input:checked + span b').innerText(), 'Technical', 'the chosen interest in English, ' + tag); }
    await shot(page, 'marketing-form-' + tag);
    await closeAll(page);
    await page.context().close();
  }

  // ---- 3. A representative: their own customer's interest read only; another's hidden, its computed size shown.
  page = await open('rep');
  sheet = await openSheet(page, HOPE);
  check(await sheet.locator('[data-classification-value="customerInterest"] strong').innerText(), 'فني', 'a representative reads their own customer\'s interest');
  dialog = await openForm(page, sheet);
  check([await dialog.locator('[data-classification-readonly]').count(), await dialog.locator('[data-classification-editor]').count(), await dialog.locator('[data-classification-readonly] input').count()], [1, 0, 0], 'read only in their form: no field to change');
  await noSideways(page, 'the representative\'s form, 360');
  await dialog.locator('[data-classification-readonly]').scrollIntoViewIfNeeded();
  await shot(page, 'rep-form-readonly-ar-360');
  await closeAll(page);
  sheet = await openSheet(page, OWN);
  check([await sheet.locator('[data-classification-value="customerInterest"]').count(), await sheet.locator('[data-classification-value="factorySize"]').getAttribute('data-computed-size')], [0, 'none'], 'another\'s customer (the marketing officer\'s): no interest, its size computed («غير محدد»)');
  await closeAll(page);
  check(await badges(DAWN), ['الحجم: B · متوسط'], 'the supervisor\'s customer: its size from its three machines (computed from what everyone reads), no interest');
  await openFilters(page);
  await pick(page, 'اهتمام العميل', 'غير محدد');
  check(await shownNames(page), [], '«غير محدد» of the interest lists none of the customers whose interest is not theirs');
  await pick(page, 'اهتمام العميل', 'كل اهتمامات العملاء');
  await pick(page, 'حجم المصنع (محسوب من الماكينات)', 'B · متوسط');
  check(await shownNames(page), [DAWN], 'the computed size filters every customer');
  await pick(page, 'حجم المصنع (محسوب من الماكينات)', 'كل أحجام المصانع');
  check(await page.evaluate(async () => { const reply = await fetch('/api/crm', {cache: 'no-store'}); const data = await reply.json(); return Object.keys(data.records.find(record => record.id === 'c3').data).filter(key => ['opportunityGrade', 'gradeNotes', 'factorySize', 'customerInterest'].includes(key)); }), [], 'nothing of another\'s classifications sent to the representative\'s page');
  await page.context().close();

  // ---- 4. The administrator on the desktop table, and the history.
  page = await open('owner', {viewport: SIZES.desktop, inApp: false});
  const row = page.locator('.unified-customers tbody tr').filter({has: page.locator('strong', {hasText: LIGHT})});
  check(await row.locator('[data-classification-badges] .badge').allInnerTexts(), ['الحجم: D · متوقف', 'الاهتمام: خدمي'], 'the marks on the table row');
  await openFilters(page);
  await pick(page, 'اهتمام العميل', 'فني');
  check(await shownNames(page), [HOPE], 'the administrator filters too');
  await noSideways(page, 'the administrator\'s table');
  await shot(page, 'owner-customers-desktop-ar');
  await page.getByRole('button', {name: 'مسح الفلاتر', exact: true}).click();
  for (const english of [false, true]) {
    if (english) { await page.context().close(); page = await open('owner', {viewport: SIZES.desktop, inApp: false, english}); }
    sheet = await openSheet(page, HOPE, english);
    await sheet.getByRole('tab', {name: english ? 'Change log' : 'سجل التغييرات', exact: true}).click();
    const entry = sheet.locator('.audit-item[data-audit-action="direct"]').first();
    await entry.waitFor();
    check(await entry.locator('strong').first().innerText(), (english ? 'Marketing officer\'s edit of the customer details' : 'تعديل مسؤول التسويق لبيانات العميل') + ' · ' + HOPE, 'the history names the direct correction, ' + (english ? 'en' : 'ar'));
    check(await entry.locator('[data-customer-edit-field]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-customer-edit-field'))), ['customerInterest'], 'the one field it changed');
    check(await entry.locator('[data-customer-edit-field="customerInterest"] .cer-after').innerText().then(text => text.replace(/\s+/g, ' ').trim()), english ? 'After Technical' : 'بعد فني', 'with its words, before and after');
    check(await entry.locator('[data-customer-edit-field="customerInterest"] .cer-before').innerText().then(text => text.replace(/\s+/g, ' ').trim()), english ? 'Before —' : 'قبل —', 'nothing before');
    if (english) await noArabic(entry.locator('.cer-changes'), 'the history\'s changes, en');
    await allInside(entry.locator('dt, dd'), 'the history, ' + (english ? 'en' : 'ar'));
    await shot(page, 'owner-history-direct-' + (english ? 'en' : 'ar'));
    await closeAll(page);
  }
  await page.context().close();

  // ---- 5. «قوة الفرصة» A to D on «الزيارات»: the filter, the form with D and its description, the table and the cards.
  const visitRows = async page => (await page.locator('.rep-record-card').first().isVisible()) ? page.locator('.rep-record-card .rep-record-customer').allInnerTexts() : page.locator('.visits-table tbody tr').evaluateAll(rows => rows.map(row => row.querySelectorAll('td')[1]?.textContent.trim() || ''));
  const strengthFilter = english => english ? 'Opportunity strength' : 'قوة الفرصة';
  page = await open('owner', {inApp: false, hash: '#activity'});
  await openFilters(page, '[data-strength-filter] [role=combobox]');
  check(await page.locator('[data-strength-filter]').count(), 1, 'the visits list has a «قوة الفرصة» filter beside «مرحلة البيع»');
  await page.getByRole('combobox', {name: strengthFilter(false), exact: true}).click();
  check(await page.getByRole('option').allInnerTexts(), ['كل درجات قوة الفرصة', 'غير محددة', 'A · مرتفعة', 'B · متوسطة', 'C · ضعيفة', 'D · مستبعدة'], 'it offers A to D');
  await page.getByRole('option', {name: 'D · مستبعدة', exact: true}).click(); await page.getByRole('option').first().waitFor({state: 'hidden'});
  check((await visitRows(page)).map(text => text.trim()), [DAWN], 'D: the one visit graded D');
  await pick(page, strengthFilter(false), 'كل درجات قوة الفرصة');
  await page.locator('.rep-record-card').filter({hasText: HOPE}).getByRole('button', {name: 'عرض / تعديل الزيارة', exact: true}).click();
  dialog = page.locator('.customer-visit-dialog'); await dialog.waitFor(); await still(page);
  if (await dialog.locator('.visit-sales-details').getAttribute('open') === null) await dialog.locator('.visit-sales-details>summary').click();
  const grade = dialog.getByRole('combobox', {name: 'قوة الفرصة', exact: true});
  check(await dialog.locator('[data-strength-help]').innerText(), 'يوجد اهتمام ولكن القرار مؤجل ويحتاج إلى دراسة', 'the stored B with its description');
  await grade.click();
  check(await page.getByRole('option').allInnerTexts(), ['غير محددة', 'A · مرتفعة', 'B · متوسطة', 'C · ضعيفة', 'D · مستبعدة'], 'the form offers A to D');
  await page.getByRole('option', {name: 'D · مستبعدة', exact: true}).click(); await page.getByRole('option').first().waitFor({state: 'hidden'});
  check([await dialog.locator('[data-strength-help]').getAttribute('data-strength-help'), await dialog.locator('[data-strength-help]').innerText()], ['excluded', 'رفض التعامل لارتباطه الكامل بالمورد'], 'D, with the owner\'s description under the field');
  await allInside(dialog.locator('.visit-sales-details .field'), 'the visit form, 360');
  await noSideways(page, 'the visit form, 360');
  await dialog.locator('[data-strength-help]').scrollIntoViewIfNeeded();
  await shot(page, 'visit-strength-d-ar-360');
  saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/visits' && response.request().method() === 'POST');
  await dialog.getByRole('button', {name: 'حفظ التعديلات', exact: true}).click();
  check((await saved).status(), 200, 'the visit saved with D');
  await dialog.waitFor({state: 'detached'});
  check((await stored('v1')).strength, 'excluded', 'stored as `excluded`');
  await pick(page, strengthFilter(false), 'D · مستبعدة');
  check((await visitRows(page)).map(text => text.trim()).sort(), [DAWN, HOPE].sort(), 'D: both visits now');
  await noSideways(page, 'the visits list, 360');
  await shot(page, 'visits-strength-filter-ar-360');
  await page.context().close();
  for (const english of [false, true]) {
    page = await open('owner', {inApp: false, hash: '#activity', viewport: SIZES.desktop, english});
    const cells = await page.locator('.visits-table tbody tr').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent.trim())));
    const gradeColumn = await page.locator('.visits-table thead th').allInnerTexts().then(heads => heads.findIndex(head => head.trim() === (english ? 'Opportunity strength' : 'قوة الفرصة')));
    check([gradeColumn >= 0, cells.map(cellsOf => cellsOf[gradeColumn]).sort()], [true, [english ? 'D · Excluded' : 'D · مستبعدة', english ? 'D · Excluded' : 'D · مستبعدة']], 'the table writes D, ' + (english ? 'en' : 'ar'));
    await openFilters(page, '[data-strength-filter] [role=combobox]');
    await page.getByRole('combobox', {name: strengthFilter(english), exact: true}).click();
    const options = await page.getByRole('option').allInnerTexts();
    check(options, english ? ['All opportunity strengths', 'Not specified', 'A · High', 'B · Medium', 'C · Low', 'D · Excluded'] : ['كل درجات قوة الفرصة', 'غير محددة', 'A · مرتفعة', 'B · متوسطة', 'C · ضعيفة', 'D · مستبعدة'], 'the filter\'s choices, ' + (english ? 'en' : 'ar'));
    if (english) check(options.some(text => /[؀-ۿ]/.test(text)), false, 'no Arabic in the English choices');
    await page.keyboard.press('Escape');
    await noSideways(page, 'the visits table, ' + (english ? 'en' : 'ar'));
    await shot(page, 'visits-table-desktop-' + (english ? 'en' : 'ar'));
    await page.context().close();
  }

  check(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks, screenshots, realBrowser: true}));
} finally {
  await browser?.close();
  await app?.stop();
}
