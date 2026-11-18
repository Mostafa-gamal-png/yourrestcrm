// «مسؤول تسويق» and the customer classifications (lib/roles.ts, lib/customer-classification.ts, the owner, 2026-11-18) in a real Chromium
// against the BUILT release (run the build first). The marketing officer, in the simulated Android app (a field member: the tracking
// gate as a representative's, the app enrolled as «rep»), on «العملاء» at 320 and 360 px, a tablet upright and sideways and a desktop, in
// Arabic and in English: the three filters («تصنيف الفرصة»، «حجم المصنع»، «اهتمام العميل») narrow the list, the customer's sheet shows
// the classifications with the size suggested from the registered machines, the form offers the fields with their help, «اعتماد
// المقترح» and «متوقف» by hand, and saves directly (no «إرسال التعديل للموافقة»); nothing scrolls sideways, every field and filter is inside
// the screen, and no Arabic is left in English but the data. The review of 2026-11-18: the machines are counted once (the sheet's group
// beside the machines registered one by one), another branch's customer shows the marketing officer nothing of its classifications and
// its correction goes for approval, a representative sees no mark, no suggested size and no filter match for another's customer, and the
// history shows a marketing officer's direct correction field by field (Arabic and English). A representative reads them read only on
// their own customer. The administrator sees the marks on the desktop table. Screenshots for the report. Synthetic fixtures only.
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
  // The supervisor's customer, three machines and nothing stored for its size; another branch's (Jeddah's), classified.
  await customer('c4', DAWN, 'sup', {opportunityGrade: 'C', customerInterest: 'service'});
  for (const n of [1, 2, 3]) await machine('m4-' + n, 'c4', 'sup', 1);
  await customer('c5', SEA, 'repj', {opportunityGrade: 'A', factorySize: 'B', customerInterest: 'price', gradeNotes: 'سرية لفرع جدة'}, 'جدة');
  await customer('c2', LIGHT, 'rep', {opportunityGrade: 'A', gradeNotes: 'طلب عرض سعر', factorySize: 'D', customerInterest: 'price'});
  await customer('c3', OWN, 'mkt', {opportunityGrade: 'C', customerInterest: 'trust'});
  const stored = async id => JSON.parse((await app.db.prepare('SELECT data FROM crm_records WHERE id=?').bind(id).first()).data);
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});

  async function open(memberId, {english = false, viewport = SIZES['phone-360'], inApp = true} = {}) {
    const touch = viewport.width < 1100;
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: touch, geolocation: {latitude: 26.43, longitude: 50.03, accuracy: 8}, permissions: ['geolocation']});
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    await context.addInitScript(english => { try { localStorage.setItem('yr-language', english ? 'en' : 'ar'); } catch { /* storage unavailable */ } }, english);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (inApp) await installNativeBridge(page, {memberId, regionScope: 'eastern'});
    await page.goto(app.origin + '/#customer');
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('.customer-machines-page').waitFor();
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
  const openFilters = async page => { if (await page.locator('#crm-page-filters').isHidden()) await page.locator('.mobile-filter-toggle').click(); await page.locator('[data-classification-filter]').first().waitFor(); };
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
  check(await page.locator('[data-classification-filter]').count(), 3, 'three classification filters');
  await pick(page, 'تصنيف الفرصة', 'A · مرتفعة');
  check(await shownNames(page), [LIGHT], 'by grade: only the A customer');
  await pick(page, 'تصنيف الفرصة', 'كل تصنيفات الفرصة');
  await pick(page, 'تصنيف الفرصة', 'غير محدد');
  check(await shownNames(page), [HOPE], 'not graded: another branch\'s customer is in no filter (its classifications are not theirs to read)');
  await pick(page, 'تصنيف الفرصة', 'كل تصنيفات الفرصة');
  await pick(page, 'حجم المصنع', 'C · صغير');
  check(await shownNames(page), [HOPE], 'by size: the size suggested from two machines counts (the sheet\'s two are not added)');
  await pick(page, 'حجم المصنع', 'B · متوسط');
  check(await shownNames(page), [DAWN], 'B: three machines suggest it; another branch\'s stored B is not shown');
  await pick(page, 'حجم المصنع', 'D · متوقف');
  check(await shownNames(page), [LIGHT], '«متوقف» stored by hand');
  await pick(page, 'حجم المصنع', 'كل أحجام المصانع');
  await pick(page, 'اهتمام العميل', 'غير محدد');
  check(await shownNames(page), [HOPE], 'no interest set');
  await page.getByRole('button', {name: 'مسح الفلاتر', exact: true}).click();
  check((await shownNames(page)).sort(), [DAWN, HOPE, LIGHT, OWN, SEA].sort(), 'cleared: every customer');
  check(await page.locator('.customer-mobile-card').filter({has: page.locator('h3', {hasText: SEA})}).locator('[data-classification-badges] .badge').count(), 0, 'another branch\'s customer: no mark on its card');
  check(await page.locator('.customer-mobile-card').filter({has: page.locator('h3', {hasText: LIGHT})}).locator('[data-classification-badges] .badge').allInnerTexts(), ['الفرصة: A · مرتفعة', 'الحجم: D · متوقف', 'الاهتمام: سعري'], 'the card carries the marks');
  let sheet = await openSheet(page, HOPE);
  const summary = sheet.locator('[data-classification-summary]');
  check(await summary.locator('[data-classification-value="factorySize"] strong').innerText(), 'C · صغير (مقترح من ماكينتان مسجلتان)', 'the sheet: the size suggested from the two registered machines');
  check(await summary.locator('[data-classification-value="opportunityGrade"]').innerText().then(text => text.includes('غير محدد')), true, 'no grade yet');
  await noSideways(page, 'the sheet, 360');
  let dialog = await openForm(page, sheet);
  const editor = dialog.locator('[data-classification-editor]');
  await editor.waitFor();
  check(await dialog.locator('[data-customer-edit-note]').count(), 0, 'no «waits for approval» note: a marketing officer saves directly');
  check(await dialog.locator('button[type=submit]').innerText().then(text => text.includes('إرسال التعديل للموافقة')), false, 'the button saves (no request)');
  check(await editor.locator('[data-classification="opportunityGrade"] label.customer-choice').allInnerTexts().then(texts => texts.map(text => text.replace(/\s+/g, ' ').trim())), ['غير محدد', 'A · مرتفعة اهتمام بالمنتج وصاحب القرار متفاعل وطلب عرض سعر', 'B · متوسطة يوجد اهتمام ولكن القرار مؤجل ويحتاج إلى دراسة', 'C · ضعيفة اهتمام محدود ولا توجد نية', 'D · مستبعدة رفض التعامل لارتباطه الكامل بالمورد'], 'each grade with its help');
  check(await editor.locator('[data-size-suggestion]').getAttribute('data-size-suggestion'), 'C', 'the size suggested');
  await editor.locator('[data-classification="opportunityGrade"] label.customer-choice').filter({hasText: 'B · متوسطة'}).click();
  await editor.locator('textarea').fill('القرار بعد زيارة المدير');
  await editor.getByRole('button', {name: 'اعتماد المقترح', exact: true}).click();
  check(await editor.locator('[data-classification="factorySize"] input:checked').getAttribute('value'), 'C', '«اعتماد المقترح» chooses the suggested size');
  await editor.locator('[data-classification="customerInterest"] label.customer-choice').filter({hasText: 'فني'}).click();
  await allInside(editor.locator('label.customer-choice, textarea, button'), 'the classification fields, 360');
  await noSideways(page, 'the form, 360');
  await editor.scrollIntoViewIfNeeded();
  await shot(page, 'marketing-form-ar-360');
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/crm' && response.request().method() === 'POST');
  await dialog.locator('button[type=submit]').click();
  const reply = await (await saved).json();
  check([reply.ok, reply.pendingApproval], [true, undefined], 'saved directly');
  const data = await stored('c1');
  check([data.opportunityGrade, data.gradeNotes, data.factorySize, data.customerInterest], ['B', 'القرار بعد زيارة المدير', 'C', 'technical'], 'stored on the customer at once');
  await page.locator('.crm-master-dialog').waitFor({state: 'hidden'});
  await closeAll(page);
  await page.context().close();

  // ---- 1b. Another branch's customer (Jeddah's): nothing of its classifications, and the correction goes for approval as a representative's.
  page = await open('mkt');
  sheet = await openSheet(page, SEA);
  check(await sheet.locator('[data-classification-summary]').count(), 0, 'another branch\'s customer: no classification on the sheet');
  check(await page.evaluate(async () => { const reply = await fetch('/api/crm', {cache: 'no-store'}); const data = (await reply.json()).records.find(record => record.id === 'c5').data; return [Object.keys(data).filter(key => ['opportunityGrade', 'gradeNotes', 'factorySize', 'customerInterest'].includes(key)), data._classificationHidden]; }), [[], true], 'none sent to the page, the customer marked hidden');
  dialog = await openForm(page, sheet);
  check([await dialog.locator('[data-classification-editor]').count(), await dialog.locator('[data-classification-readonly]').count(), await dialog.locator('[data-customer-edit-note]').count()], [0, 0, 1], 'the form: no classification, the note that the edit waits for approval');
  check(await dialog.locator('button[type=submit]').innerText().then(text => text.includes('إرسال التعديل للموافقة')), true, 'the button sends a request');
  await dialog.getByRole('textbox', {name: 'الجوال', exact: true}).fill('0559998877');
  await noSideways(page, 'the other branch\'s form, 360');
  await shot(page, 'marketing-other-branch-form-ar-360');
  const asked = page.waitForResponse(response => new URL(response.url()).pathname === '/api/crm' && response.request().method() === 'POST');
  await dialog.locator('button[type=submit]').click();
  const request = await (await asked).json();
  check([request.ok, request.pendingApproval, request.approvalStage], [true, true, 'supervisor'], 'sent to their supervisor');
  const sea = await stored('c5');
  check([sea.phone, sea.opportunityGrade, sea.gradeNotes, '_classificationHidden' in sea], ['0551234567', 'A', 'سرية لفرع جدة', false], 'the customer unchanged while it waits; its classifications kept, no marker stored');
  await closeAll(page);
  await page.context().close();

  // ---- 2. Every size, Arabic and English: the filters and the form fit, the English has no Arabic left.
  for (const [label, viewport] of Object.entries(SIZES)) for (const english of [false, true]) {
    const tag = label + '-' + (english ? 'en' : 'ar');
    page = await open('mkt', {english, viewport});
    await openFilters(page);
    await allInside(page.locator('[data-classification-filter] [role=combobox]'), 'the filters, ' + tag);
    if (english) {
      check(await page.locator('[data-classification-filter] [role=combobox]').allInnerTexts().then(texts => texts.map(text => text.trim())), ['All opportunity grades', 'All factory sizes', 'All customer interests'], 'the filters in English, ' + tag);
      await noArabic(page.locator('.filterbar'), 'the filters, ' + tag);
      await pick(page, 'Opportunity grade', 'B · Medium');
      check(await shownNames(page), [HOPE], 'filtered in English, ' + tag);
      await noArabic(page.locator('[data-classification-badges]').first(), 'the marks, ' + tag);
      await page.getByRole('button', {name: 'Clear filters', exact: true}).click();
    }
    await noSideways(page, 'the customers page, ' + tag);
    if (label === 'phone-320' || label === 'desktop') await shot(page, 'marketing-customers-' + tag);
    sheet = await openSheet(page, HOPE, english);
    await allInside(sheet.locator('[data-classification-summary] dd'), 'the sheet, ' + tag);
    if (english) { await noArabic(sheet.locator('[data-classification-summary]'), 'the sheet, ' + tag); check(await sheet.locator('[data-classification-value="factorySize"] strong').innerText(), 'C · Small', 'the confirmed size in English, ' + tag); }
    dialog = await openForm(page, sheet, english);
    const fields = dialog.locator('[data-classification-editor]');
    await fields.waitFor();
    await fields.scrollIntoViewIfNeeded();
    await allInside(fields.locator('label.customer-choice, textarea, button, legend'), 'the classification fields, ' + tag);
    await noSideways(page, 'the form, ' + tag);
    if (english) { await noArabic(fields, 'the classification fields, ' + tag); check(await fields.locator('[data-classification="customerInterest"] input:checked + span b').innerText(), 'Technical', 'the chosen interest in English, ' + tag); }
    await shot(page, 'marketing-form-' + tag);
    await closeAll(page);
    await page.context().close();
  }

  // ---- 3. A representative: read only on their own customer (c1), nothing of another's (c3, the marketing officer's, classified).
  page = await open('rep');
  sheet = await openSheet(page, HOPE);
  check(await sheet.locator('[data-classification-value="opportunityGrade"] strong').innerText(), 'B · متوسطة', 'a representative reads their own customer\'s grade');
  dialog = await openForm(page, sheet);
  check([await dialog.locator('[data-classification-readonly]').count(), await dialog.locator('[data-classification-editor]').count(), await dialog.locator('[data-classification-readonly] input').count()], [1, 0, 0], 'read only in their form: no field to change');
  await noSideways(page, 'the representative\'s form, 360');
  await dialog.locator('[data-classification-readonly]').scrollIntoViewIfNeeded();
  await shot(page, 'rep-form-readonly-ar-360');
  await closeAll(page);
  sheet = await openSheet(page, OWN);
  check(await sheet.locator('[data-classification-summary]').count(), 0, 'another\'s customer (the marketing officer\'s): no classification shown');
  await closeAll(page);
  // The supervisor's customer with three machines: no mark, no size suggested from them, and in no classification filter.
  check(await page.locator('.customer-mobile-card').filter({has: page.locator('h3', {hasText: DAWN})}).locator('[data-classification-badges] .badge').count(), 0, 'another\'s customer: no mark on the card, not even a suggested size');
  sheet = await openSheet(page, DAWN);
  check(await sheet.locator('[data-classification-summary]').count(), 0, 'nor on the sheet');
  await closeAll(page);
  await openFilters(page);
  await pick(page, 'تصنيف الفرصة', 'غير محدد');
  check(await shownNames(page), [], '«غير محدد» lists none of the customers whose classifications are not theirs');
  await pick(page, 'تصنيف الفرصة', 'كل تصنيفات الفرصة');
  await pick(page, 'حجم المصنع', 'B · متوسط');
  check(await shownNames(page), [], 'nor does a size suggested from another\'s machines');
  await pick(page, 'حجم المصنع', 'كل أحجام المصانع');
  check((await shownNames(page)).length, 5, 'no filter: every customer');
  check(await page.evaluate(async () => { const reply = await fetch('/api/crm', {cache: 'no-store'}); const data = await reply.json(); return Object.keys(data.records.find(record => record.id === 'c3').data).filter(key => ['opportunityGrade', 'gradeNotes', 'factorySize', 'customerInterest'].includes(key)); }), [], 'nor sent to the representative\'s page');
  await closeAll(page);
  await page.context().close();

  // ---- 4. The administrator on the desktop table.
  page = await open('owner', {viewport: SIZES.desktop, inApp: false});
  const row = page.locator('.unified-customers tbody tr').filter({has: page.locator('strong', {hasText: LIGHT})});
  check(await row.locator('[data-classification-badges] .badge').allInnerTexts(), ['الفرصة: A · مرتفعة', 'الحجم: D · متوقف', 'الاهتمام: سعري'], 'the marks on the table row');
  await openFilters(page);
  await pick(page, 'اهتمام العميل', 'فني');
  check(await shownNames(page), [HOPE], 'the administrator filters too');
  await noSideways(page, 'the administrator\'s table');
  await shot(page, 'owner-customers-desktop-ar');
  await page.getByRole('button', {name: 'مسح الفلاتر', exact: true}).click();
  // The history: the marketing officer's direct correction of section 1, field by field, before and after.
  for (const english of [false, true]) {
    if (english) { await page.context().close(); page = await open('owner', {viewport: SIZES.desktop, inApp: false, english}); }
    sheet = await openSheet(page, HOPE, english);
    await sheet.getByRole('tab', {name: english ? 'Change log' : 'سجل التغييرات', exact: true}).click();
    const entry = sheet.locator('.audit-item[data-audit-action="direct"]').first();
    await entry.waitFor();
    check(await entry.locator('strong').first().innerText(), (english ? 'Marketing officer\'s edit of the customer details' : 'تعديل مسؤول التسويق لبيانات العميل') + ' · ' + HOPE, 'the history names the direct correction, ' + (english ? 'en' : 'ar'));
    check(await entry.locator('[data-customer-edit-field]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-customer-edit-field')).sort()), ['customerInterest', 'factorySize', 'gradeNotes', 'opportunityGrade'], 'every field it changed');
    check(await entry.locator('[data-customer-edit-field="opportunityGrade"] .cer-after').innerText().then(text => text.replace(/\s+/g, ' ').trim()), english ? 'After B · Medium' : 'بعد B · متوسطة', 'with its words, before and after');
    check(await entry.locator('[data-customer-edit-field="opportunityGrade"] .cer-before').innerText().then(text => text.replace(/\s+/g, ' ').trim()), english ? 'Before —' : 'قبل —', 'nothing before');
    if (english) await noArabic(entry.locator('.cer-changes'), 'the history\'s changes, en');
    await allInside(entry.locator('dt, dd'), 'the history, ' + (english ? 'en' : 'ar'));
    await shot(page, 'owner-history-direct-' + (english ? 'en' : 'ar'));
    await closeAll(page);
  }
  await page.context().close();

  check(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks, screenshots, realBrowser: true}));
} finally {
  await browser?.close();
  await app?.stop();
}
