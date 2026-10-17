// Dictation on the forms, in a real Chromium against the BUILT release (run `pnpm build` first): a representative on the Android app emulator
// dictates into the visit form (the next step, the customer's need, another goal, and a new customer), reads the service's own error,
// cancels, and moves from one field to another with one session at a time; the English page asks for English; the administrator's customer
// form and customer service's complaint form dictate through the browser's own speech engine (a controlled stand-in, since a headless
// browser has no microphone); and on every form opened, each free-text field has its microphone while the fields that stay typed (codes,
// phones, amounts, search) do not. The app's speech service is the emulator's (scripts/lib/native-bridge.mjs): no microphone, speech
// service, device or OS claim is made.
// Synthetic isolated fixtures only: temporary SQLite, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge, nativeControl} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require('playwright');
const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'سعد مدير المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'sm', name: 'ماجد المشرف'},
  {id: 'rep', role: 'rep', sup: 'sup', name: 'أحمد المندوب'},
  {id: 'csm', role: 'customer_service_manager', sup: 'sm', name: 'منى مديرة الخدمة'}, {id: 'cs', role: 'customer_service', sup: 'csm', name: 'ريم خدمة العملاء'}
];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-dictation-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1280, height: 900};
const HERE = {latitude: 26.437341, longitude: 50.034499, accuracy: 8};
const CUSTOMER = 'مصنع الأمل للبلاستيك';
const NEXT = 'زيارة متابعة يوم الأحد', NEXT_MORE = 'ثم اتصال بالمشتري', NEED = 'قوالب جديدة للبلاستيك', GOAL = 'عرض منتج جديد';
const HEARD = 'نص من محرك المتصفح';

// A stand-in for the browser's speech engine: it answers with what window.__heard holds, like the engine would after the person spoke.
const browserEngine = () => {
  window.__heard = 'نص من محرك المتصفح'; window.__engine = [];
  class StandInRecognition {
    constructor() { this.lang = ''; this.aborted = false; window.__engine.push({created: true}); }
    start() { window.__engine.push({started: true, lang: this.lang}); setTimeout(() => { if (this.aborted) return; this.onresult?.({resultIndex: 0, results: [Object.assign([{transcript: window.__heard}], {isFinal: true})]}); this.onend?.(); }, 40); }
    abort() { this.aborted = true; }
  }
  window.SpeechRecognition = StandInRecognition; window.webkitSpeechRecognition = StandInRecognition;
};

try {
  app = await bootBuiltApp({members}, {tls: true});
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  async function eventually(probe, message, timeoutMs = 20000) {
    const until = Date.now() + timeoutMs;
    for (;;) { const value = await probe(); if (value) { checks++; return value; } if (Date.now() > until) throw Error(message + ' (timed out)'); await pause(150); }
  }
  /** A signed-in page. native: the Android app emulator (its speech service answers what the test sets); engine: the browser's own engine stand-in. */
  async function open(memberId, {native = false, engine = false, viewport = DESKTOP, language = 'ar'} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', geolocation: HERE, permissions: ['geolocation']});
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    if (language === 'en') await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (native) await installNativeBridge(page, {memberId, regionScope: 'all', ...(native === true ? {} : native)});
    if (engine) await page.addInitScript(browserEngine);
    await page.goto(app.origin + '/');
    await page.locator('.workspace').waitFor();
    return {page, context, phone: native ? nativeControl(page) : null};
  }
  const settle = page => page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const shot = async (page, label) => { await settle(page); await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const noOverflow = async (page, label) => { const geometry = await page.evaluate(() => ({overflow: document.documentElement.scrollWidth > innerWidth + 1, width: innerWidth})); check(geometry.overflow, false, label + ': no horizontal overflow at ' + geometry.width + 'px'); };
  const goPhone = async (page, id) => { await page.locator('.mobile-bottom-navigation').waitFor(); await page.locator('.mobile-tab[data-page="' + id + '"]').click(); await page.locator('.mobile-tab[data-page="' + id + '"][aria-current="page"]').waitFor(); await page.locator('.page-heading').waitFor(); };
  const goDesktop = async (page, label) => { await page.locator('button.nav-item', {hasText: label}).first().click(); await page.locator('.page-heading h1', {hasText: label}).waitFor(); };
  const pick = async (page, scope, name, option) => { await scope.getByRole('combobox', {name, exact: true}).click(); await page.getByRole('option', {name: option, exact: true}).click(); await page.getByRole('option').first().waitFor({state: 'hidden'}); };

  /** The field with this label, and its microphone. */
  const field = (scope, label) => scope.locator('label.voice-field', {hasText: label}).first();
  const control = (scope, label) => field(scope, label).locator('input, textarea').first();
  const micIn = (scope, label) => field(scope, label).locator('.voice-button');
  const alone = (scope, label) => scope.locator('.voice-button[aria-label$="' + label + '"]');
  /** What a form leaves typed: free-text fields with no microphone, other than the ones named (by their label) as meant to stay typed. */
  const withoutMic = (scope, allowed = []) => scope.evaluate((root, stays) => {
    const bad = [];
    for (const el of root.querySelectorAll('input, textarea')) {
      const kind = el.tagName === 'TEXTAREA' ? 'textarea' : (el.getAttribute('type') || 'text').toLowerCase();
      if (kind !== 'textarea' && kind !== 'text') continue;
      if (el.readOnly || el.disabled || el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete')) continue;
      if (!el.getClientRects().length) continue;
      const label = (el.closest('label')?.querySelector(':scope > span')?.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || '').replace(/\s+/g, ' ').trim();
      if (stays.some(name => label.includes(name))) continue;
      const row = el.closest('.voice-field, .dictation-row');
      if (!row || !row.querySelector('.voice-button')) bad.push(label || el.outerHTML.slice(0, 80));
    }
    return bad;
  }, allowed);
  const heard = (phone, text, options) => phone.speech({text}, options);
  const tap = async mic => { await mic.click(); await mic.page().locator('.voice-button[aria-pressed="true"]').waitFor({state: 'detached'}); };

  // ---- fixtures: the customer of the representative, at the place the browser reports
  const created = new Date().toISOString();
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('f1','customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')")
    .bind(JSON.stringify({name: CUSTOMER, region: 'الشرقية', city: 'الدمام', phone: '0551234567', contact: 'أبو خالد', code: 'f1', branch: 'الرئيسي', assignedTo: 'rep', location: `${HERE.latitude.toFixed(7)}, ${HERE.longitude.toFixed(7)}`, latitude: HERE.latitude, longitude: HERE.longitude, locationSource: 'device', locationCapturedAt: created, locationAccuracy: 8}), created, created).run();

  // ---- 1. A representative on the Android app emulator dictates into the visit form
  const first = await open('rep', {native: true, viewport: PHONE});
  const rep = first.page, phone = first.phone;
  {
    await goPhone(rep, 'activity');
    await rep.locator('.heading-actions').getByRole('button', {name: 'زيارة جديدة', exact: true}).click();
    const dialog = rep.getByRole('dialog');
    await dialog.waitFor();
    await dialog.locator('#visit-customer-search').fill(CUSTOMER);
    await dialog.getByRole('option').filter({hasText: CUSTOMER}).click();
    await dialog.locator('.visit-selected-customer').filter({hasText: CUSTOMER}).waitFor();
    await dialog.locator('.visit-place[data-state="near"]').waitFor();
    await pick(rep, dialog, 'اختر الهدف من الزيارة', 'هدف آخر');
    await micIn(dialog, 'الإجراء القادم').waitFor();
    await eventually(async () => !(await micIn(dialog, 'الإجراء القادم').isDisabled()), 'the microphone is ready once the app has said what it can do');
    check(await field(dialog, 'الإجراء القادم').getAttribute('class').then(text => text.includes('has-voice-input')), true, 'the app\'s speech service is reported to the field');
    // every free-text field of the form has its microphone, the sales details included
    await dialog.locator('.visit-sales-details > summary').click();
    check(await withoutMic(dialog), [], 'every free-text field of the visit form has its microphone');
    await shot(rep, 'dictation-visit-phone');
    await noOverflow(rep, 'the visit form');

    await heard(phone, NEXT);
    await tap(micIn(dialog, 'الإجراء القادم'));
    check(await control(dialog, 'الإجراء القادم').inputValue(), NEXT, 'what is said is written into the next step');
    await heard(phone, NEXT_MORE);
    await tap(micIn(dialog, 'الإجراء القادم'));
    check(await control(dialog, 'الإجراء القادم').inputValue(), NEXT + ' ' + NEXT_MORE, 'and a second time is added after it, with one space');
    check((await phone.speechCalls()).filter(call => call.method === 'speechStart').map(call => call.payload.language), ['ar-SA', 'ar-SA'], 'in Arabic, the language of the page');
    await control(dialog, 'احتياج العميل').fill('قوالب');
    await heard(phone, 'جديدة للبلاستيك');
    await tap(micIn(dialog, 'احتياج العميل'));
    check(await control(dialog, 'احتياج العميل').inputValue(), NEED, 'a text area takes what is said after what was typed');
    await heard(phone, GOAL);
    await tap(alone(dialog, 'الهدف الآخر من الزيارة'));
    check(await dialog.getByRole('textbox', {name: 'الهدف الآخر من الزيارة'}).inputValue(), GOAL, 'a control that keeps its own markup (the other goal) is dictated with the button beside it');

    // the service's own refusal is shown under the field, and trying again works
    await phone.speech({error: 'speech_permission'}, {once: true});
    await micIn(dialog, 'احتياج العميل').click();
    await field(dialog, 'احتياج العميل').locator('small[role=alert]').waitFor();
    ok((await field(dialog, 'احتياج العميل').locator('small[role=alert]').innerText()).includes('اسمح لخدمة الإملاء'), 'the refusal says what to do');
    check(await control(dialog, 'احتياج العميل').inputValue(), NEED, 'and changes nothing');
    await shot(rep, 'dictation-refused-phone');
    await heard(phone, ' وصيانة');
    await tap(micIn(dialog, 'احتياج العميل'));
    check(await control(dialog, 'احتياج العميل').inputValue(), NEED + ' وصيانة', 'trying again works, and the message is gone');
    check(await field(dialog, 'احتياج العميل').locator('small[role=alert]').count(), 0, 'with no message left');

    // one session at a time: a second field takes over, and tapping the first again cancels it
    await phone.speech({hold: true});
    await phone.clearCalls();
    await micIn(dialog, 'الإجراء القادم').click();
    await rep.locator('label.voice-field', {hasText: 'الإجراء القادم'}).locator('.voice-button[aria-pressed="true"]').waitFor();
    ok(await rep.locator('label.voice-field', {hasText: 'الإجراء القادم'}).locator('small[role=status]').isVisible(), 'while it listens it says to speak');
    await micIn(dialog, 'احتياج العميل').click();
    await rep.locator('label.voice-field', {hasText: 'احتياج العميل'}).locator('.voice-button[aria-pressed="true"]').waitFor();
    check(await micIn(dialog, 'الإجراء القادم').getAttribute('aria-pressed'), 'false', 'the first field stops listening when another starts');
    await micIn(dialog, 'احتياج العميل').click();
    await eventually(async () => (await micIn(dialog, 'احتياج العميل').getAttribute('aria-pressed')) === 'false', 'tapping again stops it');
    check((await phone.speechCalls()).map(call => call.method), ['speechStart', 'speechCancel', 'speechStart', 'speechCancel'], 'two sessions started, each ended by a cancel, never two at once');
    check([await control(dialog, 'الإجراء القادم').inputValue(), await control(dialog, 'احتياج العميل').inputValue()], [NEXT + ' ' + NEXT_MORE, NEED + ' وصيانة'], 'and nothing was written');

    // the dictated form saves as it reads
    await pick(rep, dialog, 'نتيجة الزيارة', 'متابعة العميل');
    const response = rep.waitForResponse(r => new URL(r.url()).pathname === '/api/visits' && r.request().method() === 'POST');
    await dialog.getByRole('button', {name: 'حفظ الزيارة', exact: true}).click();
    check((await response).status(), 200, 'the visit saves');
    await dialog.waitFor({state: 'detached'});
    const saved = (await app.db.prepare("SELECT data FROM crm_records WHERE kind='activity' ORDER BY created_at DESC").first());
    const data = JSON.parse(saved.data);
    check([data.nextAction, data.customerNeeds, data.summary], [NEXT + ' ' + NEXT_MORE, NEED + ' وصيانة', GOAL], 'the visit holds the dictated text');
  }

  // ---- 2. A new customer from the visit form: the fields that are text are dictated, the phone and the ERP code are not
  {
    await rep.locator('.heading-actions').getByRole('button', {name: 'زيارة جديدة', exact: true}).click();
    const dialog = rep.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByRole('button', {name: /إضافة عميل/}).first().click();
    await dialog.locator('.visit-new-customer-name').waitFor();
    await dialog.locator('details.visit-new-customer-extra > summary').click();
    check(await withoutMic(dialog, ['كود العميل في ERP', 'العنوان الوطني', 'اللوكيشن']), [], 'the new-customer fields have their microphones, but for the ERP code, the national address and the coordinates');
    await heard(phone, 'مصنع الريان للصناعات');
    await eventually(async () => !(await micIn(dialog, 'اسم المصنع').isDisabled()), 'the name field\'s microphone is ready');
    await tap(micIn(dialog, 'اسم المصنع'));
    check(await control(dialog, 'اسم المصنع').inputValue(), 'مصنع الريان للصناعات', 'the factory name is dictated');
    await heard(phone, 'جدة');
    await tap(micIn(dialog, 'المدينة'));
    check(await control(dialog, 'المدينة').inputValue(), 'جدة', 'and the city');
    check(await dialog.locator('label', {hasText: 'رقم الجوال'}).locator('.voice-button').count(), 0, 'the phone number has no microphone');
    await shot(rep, 'dictation-new-customer-phone');
    await first.context.close();
  }

  // ---- 3. The English page asks the speech service for English and names the field in English
  {
    const english = await open('rep', {native: true, viewport: PHONE, language: 'en'});
    await goPhone(english.page, 'activity');
    await english.page.locator('.heading-actions').getByRole('button', {name: 'New visit', exact: true}).click();
    const dialog = english.page.getByRole('dialog');
    await dialog.waitFor();
    const mic = dialog.locator('.voice-button[aria-label="Dictate: Next action"]');
    await mic.waitFor();
    await eventually(async () => !(await mic.isDisabled()), 'the English microphone is ready');
    await english.phone.speech({text: 'Visit on Sunday'});
    await mic.click();
    await eventually(async () => (await dialog.getByRole('textbox', {name: /^Next action/}).inputValue()) === 'Visit on Sunday', 'English text is written');
    check((await english.phone.speechCalls()).find(call => call.method === 'speechStart').payload.language, 'en-US', 'the service is asked for English');
    await english.context.close();
  }

  // ---- 4. The administrator's machine form and customer form dictate through the browser's own engine
  {
    const admin = await open('owner', {engine: true});
    const page = admin.page;
    await goDesktop(page, 'العملاء');
    const row = page.locator('table tbody tr', {hasText: CUSTOMER}).first();
    await row.waitFor();
    await row.locator('button[title="إضافة ماكينة للمصنع"]').click();
    let dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await eventually(async () => !(await micIn(dialog, 'اسم / رقم الماكينة').isDisabled()), 'the microphone is ready on the browser\'s engine');
    check(await withoutMic(dialog), [], 'every free-text field of the machine form has its microphone');
    await tap(micIn(dialog, 'اسم / رقم الماكينة'));
    check(await control(dialog, 'اسم / رقم الماكينة').inputValue(), HEARD, 'the browser\'s engine writes the machine name');
    check((await page.evaluate(() => window.__engine)).find(call => call.started).lang, 'ar-SA', 'in Arabic');
    await page.evaluate(() => { window.__heard = 'ملاحظات تشغيل من الصوت'; });
    await tap(micIn(dialog, 'ملاحظات التشغيل والمواصفات'));
    check(await control(dialog, 'ملاحظات التشغيل والمواصفات').inputValue(), 'ملاحظات تشغيل من الصوت', 'and a text area');
    await shot(page, 'dictation-machine-form-desktop');
    await dialog.getByRole('button', {name: 'إلغاء', exact: true}).click();
    await dialog.getByRole('button', {name: 'خروج بدون حفظ', exact: true}).click().catch(() => {});
    await dialog.waitFor({state: 'detached'});

    await row.getByRole('button', {name: 'بيانات العميل', exact: true}).click();
    const sheet = page.locator('.crm-sheet');
    await sheet.waitFor();
    await sheet.getByRole('button', {name: 'تعديل', exact: true}).click();
    dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await eventually(async () => !(await micIn(dialog, 'اسم المصنع').isDisabled()), 'the microphone is ready on the customer form');
    check(await withoutMic(dialog, ['كود العميل في ERP', 'العنوان الوطني', 'اللوكيشن', 'فرع يورست المسؤول']), [], 'every free-text field of the customer form has its microphone, but for the ERP code, the branch, the national address and the coordinates');
    check(await dialog.locator('label', {hasText: 'كود العميل في ERP'}).locator('.voice-button').count(), 0, 'the ERP code stays typed');
    await page.evaluate(() => { window.__heard = 'مورد قوالب من الصوت'; });
    await tap(micIn(dialog, 'مورد القوالب والقطع'));
    check(await control(dialog, 'مورد القوالب والقطع').inputValue(), 'مورد قوالب من الصوت', 'the supplier is dictated');
    await shot(page, 'dictation-customer-form-desktop');
    await admin.context.close();
  }

  // ---- 5. Customer service dictates the complaint
  {
    const service = await open('cs', {engine: true});
    const page = service.page;
    await goDesktop(page, 'الشكاوى');
    await page.locator('.heading-actions').getByRole('button', {name: 'تسجيل شكوى', exact: true}).click();
    const dialog = page.locator('.complaint-dialog');
    await dialog.waitFor();
    await dialog.getByRole('searchbox').fill('الأمل');
    await dialog.locator('[data-customer="f1"]').click();
    await eventually(async () => !(await micIn(dialog, 'وصف الشكوى').isDisabled()), 'the microphone is ready on the complaint form');
    check(await withoutMic(dialog), [], 'every free-text field of the complaint form has its microphone');
    await page.evaluate(() => { window.__heard = 'القالب يخرج بلوكًا مكسورًا من الجهة اليمنى'; });
    await tap(micIn(dialog, 'وصف الشكوى'));
    check(await control(dialog, 'وصف الشكوى').inputValue(), 'القالب يخرج بلوكًا مكسورًا من الجهة اليمنى', 'the description is dictated');
    await page.evaluate(() => { window.__heard = 'استبدال القالب'; });
    await tap(micIn(dialog, 'ما يطلبه العميل'));
    await shot(page, 'dictation-complaint-form-desktop');
    const submit = dialog.getByRole('button', {name: 'تسجيل الشكوى', exact: true});
    check(await submit.isEnabled(), true, 'the dictated description enables the registration');
    await submit.click();
    await dialog.waitFor({state: 'detached'});
    const stored = await eventually(async () => (await app.db.prepare("SELECT data FROM crm_records WHERE kind='complaint'").first()), 'the complaint is stored');
    check([JSON.parse(stored.data).description, JSON.parse(stored.data).demand], ['القالب يخرج بلوكًا مكسورًا من الجهة اليمنى', 'استبدال القالب'], 'the complaint holds the dictated text');
    // the complaint's own sheet: the internal note is dictated too
    const complaint = page.locator('.complaint-card').first();
    await complaint.locator('button').click();
    const sheet = page.locator('.complaint-sheet');
    await sheet.waitFor();
    await sheet.locator('label.voice-field', {hasText: 'ملاحظة داخلية'}).waitFor();
    check(await withoutMic(sheet), [], 'every free-text field on the complaint sheet has its microphone');
    await page.evaluate(() => { window.__heard = 'تم الاتصال بالعميل وسنزوره غدًا'; });
    await tap(micIn(sheet, 'ملاحظة داخلية'));
    check(await control(sheet, 'ملاحظة داخلية').inputValue(), 'تم الاتصال بالعميل وسنزوره غدًا', 'the internal note is dictated');
    await shot(page, 'dictation-complaint-sheet-desktop');
    await service.context.close();
  }

  check(errors, [], 'the pages raised no script errors');
  console.log(JSON.stringify({ok: true, checks, browser: 'Chromium', actual_built_release: true, real_sqlite: true, androidApp: 'emulated bridge', browserEngine: 'controlled stand-in', microphone: false, speechService: false, physical_device_tested: false, production_data_used: false, screenshots: fs.readdirSync(screenshots).filter(name => name.startsWith('dictation-')).length}));
} finally {
  await browser?.close();
  await app?.stop();
}
