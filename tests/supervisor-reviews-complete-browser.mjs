// The five additions to the supervisor's notes (2026-11-15; lib/supervisor-reviews*.ts, app/supervisor-reviews.tsx) in a real Chromium
// against the BUILT release (run the build first). On a 360 px phone unless said: the supervisor evaluates each visit or contact («فعالة» /
// «سلبية» required, «إيجابية» shown by itself on a sale), then opens «تقرير مراجعاتي» (Arabic and English; a sales manager on a desktop
// chooses the supervisor); the representative in the Android app emulator reads the card with «قرأت» on each note (no «قرأت الكل»), is
// told on the open page when a new note arrives (and no device notification is tried inside the app), and sees «ملاحظات المشرف السابقة»
// on the follow-up screen and, in English, on the customer's details; the supervisor, noted by the sales manager, in a phone browser in
// English: the card offers the device's notification, a new note brings the page's message and the device's notification (without the
// note's words). 44 px buttons, no horizontal scroll. Synthetic fixtures only: temporary SQLite, mocked mail, no production data.
//   node tests/supervisor-reviews-complete-browser.mjs [--shots <folder>]   (screenshots: review-*.png there, else a temporary folder)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const shotsArg = process.argv.indexOf('--shots'), screenshots = shotsArg > 0 && process.argv[shotsArg + 1] ? path.resolve(process.argv[shotsArg + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-reviews-complete-'));
fs.mkdirSync(screenshots, {recursive: true});
const members = [{id: 'owner', role: 'admin'}, {id: 'mgr', role: 'manager', name: 'مدير المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف سالم'}, {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'}];
let checks = 0, browser;
const errors = [];
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1280, height: 900};
const app = await bootBuiltApp({members}, {tls: true});
try {
  const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()), now = Date.now();
  const insert = (id, kind, parent, assigned, data, at = new Date(now).toISOString()) => app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id, kind, parent, assigned, 'الرئيسي', JSON.stringify(data), at, at).run();
  await insert('c1', 'customer', null, 'rep1', {name: 'مصنع الاختبار', region: 'الشرقية', city: 'الدمام', location: '26.43, 50.03', phone: '0551234567', customerStatus: 'نشط'});
  await insert('c2', 'customer', null, 'rep1', {name: 'مصنع البيع', region: 'الشرقية', city: 'الخبر', location: '26.28, 50.20', phone: '0551234568', customerStatus: 'نشط'});
  const contact = (id, customer, type, result, extra, at) => insert(id, 'activity', customer, 'rep1', {visitWorkflow: 'customer-v1', type, date: day, summary: 'تعريف بالمنتجات', result, performedBy: 'rep1', responsibleId: 'rep1', recordedByEmail: 'rep1@yourrest.org', ...extra}, new Date(at).toISOString());
  await contact('call-c1', 'c1', 'call', 'اتصال للتعريف', {salesStage: 'new', nextAction: 'زيارة المصنع', nextDate: day}, now - 3 * 3600_000);
  await contact('visit-open', 'c1', 'visit', 'العميل طلب عرض سعر', {salesStage: 'quoted', nextAction: 'متابعة العرض', nextDate: day}, now - 2 * 3600_000);
  await contact('visit-won', 'c2', 'visit', 'تم البيع للعميل', {salesStage: 'won', orderRef: 'ORD-1'}, now - 3600_000);
  const {scope} = await app.db.prepare('SELECT region_scope AS scope FROM crm_members WHERE id=?').bind('rep1').first();
  const supApi = app.as(await app.login('sup'));
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  /** notification: a stand-in for the browser's Notification (what it records is window.__notices); null leaves the browser's own. */
  async function open(memberId, {viewport = PHONE, language = 'ar', hash = '', native = false, notification = null, clock = false} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: viewport.width < 600});
    if (language === 'en') await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    if (notification) await context.addInitScript(permission => {
      window.__notices = []; window.__permissionAsked = 0;
      // The permission given survives a reload, as the browser's own does.
      class StandIn { constructor(title, options = {}) { window.__notices.push({title, ...options}); } close() {} static async requestPermission() { window.__permissionAsked++; StandIn.permission = 'granted'; try { localStorage.setItem('__standInPermission', 'granted'); } catch { /* storage unavailable */ } return 'granted'; } }
      let given = null; try { given = localStorage.getItem('__standInPermission'); } catch { /* storage unavailable */ }
      StandIn.permission = given || permission;
      Object.defineProperty(window, 'Notification', {value: StandIn, configurable: true, writable: true});
    }, notification);
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (native) await installNativeBridge(page, {memberId, regionScope: scope});
    if (clock) await page.clock.install();
    await page.goto(app.origin + '/' + hash);
    await page.locator('.workspace').waitFor();
    return page;
  }
  const shot = async (page, label) => { await page.waitForTimeout(300); await page.screenshot({path: path.join(screenshots, 'review-' + label + '.png'), fullPage: false}); };
  const noOverflow = async (page, label) => eq(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scroll');
  const small = (page, selector, role = 'button') => page.evaluate(([scopeSelector, kind]) => [...document.querySelectorAll(scopeSelector + ' ' + (kind === 'button' ? 'button' : 'label.review-rating-option'))].filter(element => element.offsetParent && element.getBoundingClientRect().height < 43.5).map(element => element.textContent.trim()), [selector, role]);
  async function nav(page, id) {
    await page.locator('.mobile-bottom-navigation').waitFor({state: 'attached'});
    const button = page.locator('.mobile-bottom-navigation [data-page=' + id + ']');
    if (await button.count()) await button.click(); else { await page.getByRole('button', {name: /^(المزيد من الصفحات|More pages)$/}).click(); await page.locator('.mobile-overflow-pages [data-page=' + id + ']').click(); }
    await page.locator('.mobile-navigation-sheet').waitFor({state: 'detached'});
    await page.locator('.page-heading').waitFor();
  }
  async function openReport(page) {
    await page.locator('.journey-toolbar select').first().waitFor();
    await page.locator('#journey-panel-day .journey-toolbar select').selectOption('rep1');
    await page.locator('[data-entry-review="visit-open"]').waitFor();
  }
  async function write(block, rating, result, action, saveLabel) {
    if (rating) await block.getByRole('radio', {name: rating, exact: true}).check();
    await block.locator('textarea').nth(0).fill(result);
    await block.locator('textarea').nth(1).fill(action);
    await block.getByRole('button', {name: saveLabel, exact: true}).click();
    await block.locator('.review-saved').waitFor();
  }

  // ---- 1. The evaluation, on a phone in Arabic.
  const sup = await open('sup', {hash: '#journeys'});
  await openReport(sup);
  const sale = sup.locator('[data-entry-review="visit-won"]');
  await sale.locator('[data-review-add="visit-won"]').click();
  eq([await sale.getByRole('radio').count(), (await sale.locator('[data-rating-auto]').innerText()).replace(/\s+/g, ' ').trim()], [0, 'التقييم إيجابية تلقائي: تم البيع'], 'the sale: «إيجابية» by itself, nothing to choose');
  await write(sale, '', 'بيع ممتاز', 'تابع التوريد', 'حفظ');
  eq(await sale.locator('[data-entry-rating]').innerText(), 'إيجابية', 'saved «إيجابية»');
  const visit = sup.locator('[data-entry-review="visit-open"]');
  await visit.locator('[data-review-add="visit-open"]').click();
  eq(await visit.getByRole('radio').evaluateAll(radios => radios.map(radio => radio.closest('label').textContent.trim())), ['فعالة', 'سلبية'], 'two evaluations to choose');
  eq(await small(sup, '[data-entry-review="visit-open"]', 'label'), [], 'each choice at least 44 px high');
  eq(await small(sup, '[data-entry-review="visit-open"]'), [], 'every button of the form at least 44 px high');
  await visit.locator('textarea').nth(0).fill('زيارة جيدة');await visit.locator('textarea').nth(1).fill('جهّز العرض');
  await visit.getByRole('button', {name: 'حفظ', exact: true}).click();
  eq(await visit.locator('.review-error').innerText(), 'اختر التقييم: فعالة أو سلبية.', 'no evaluation: nothing is sent');
  await visit.locator('.review-rating-choice').scrollIntoViewIfNeeded();
  await shot(sup, '01-evaluation-choice-phone-ar');
  await write(visit, 'فعالة', 'زيارة جيدة والعميل جاد', 'جهّز عرض السعر قبل الخميس', 'حفظ');
  eq(await visit.locator('[data-entry-rating]').innerText(), 'فعالة', 'saved «فعالة»');
  const call = sup.locator('[data-entry-review="call-c1"]');
  await call.locator('[data-review-add="call-c1"]').click();
  await write(call, 'سلبية', 'اتصال قصير بلا نتيجة', 'اتصل مرة أخرى غدًا', 'حفظ');
  eq(await call.locator('[data-entry-rating]').innerText(), 'سلبية', 'saved «سلبية»');
  await noOverflow(sup, 'the report with its evaluations on a 360 px phone');
  await visit.scrollIntoViewIfNeeded();
  await shot(sup, '02-evaluation-saved-phone-ar');

  // ---- 2. «تقرير مراجعاتي» on the phone, in Arabic.
  await sup.locator('[data-journey-tab="reviews"]').click();
  const made = sup.locator('[data-reviews-made]');
  await made.locator('[data-reviews-counts]').waitFor();
  eq(await sup.locator('[data-journey-tab]').evaluateAll(tabs => tabs.map(tab => [tab.textContent.trim(), tab.getAttribute('aria-selected'), tab.getBoundingClientRect().height >= 44])), [['تقرير اليوم', 'false', true], ['تقرير مراجعاتي', 'true', true]], 'two tabs, 44 px');
  const count = async (page, key) => Number(await page.locator('[data-reviews-made] [data-count=' + key + '] dd').innerText());
  eq([await count(sup, 'notes'), await count(sup, 'positive'), await count(sup, 'effective'), await count(sup, 'negative'), await count(sup, 'unread'), await count(sup, 'members')], [3, 1, 1, 1, 3, 1], 'the counts at the top');
  eq(await made.locator('select').count(), 0, 'a supervisor has nobody else to choose');
  eq(await made.locator('[data-review-made]').evaluateAll(items => items.map(item => item.dataset.reviewMade)), ['visit-won', 'visit-open', 'call-c1'], 'each note of the day, in the order written');
  const opened = await made.locator('[data-review-made="visit-open"]').innerText();
  for (const words of ['المندوب أحمد', 'مصنع الاختبار', 'فعالة', 'ما سجّله المندوب', 'العميل طلب عرض سعر', 'النتيجة', 'زيارة جيدة والعميل جاد', 'الإجراء المطلوب', 'جهّز عرض السعر قبل الخميس', 'لم تُقرأ بعد']) ok(opened.includes(words), 'the note shows ' + words);
  eq(await made.locator('input[type=date]').inputValue(), day, 'today by default');
  eq(await made.locator('[data-review-made="visit-open"] time').getAttribute('dir'), 'auto', 'the moment keeps the Arabic order (day, month, time)');
  await noOverflow(sup, '«تقرير مراجعاتي» on a 360 px phone');
  await shot(sup, '03-my-reviews-phone-ar');
  await made.locator('[data-review-made="visit-open"]').scrollIntoViewIfNeeded();
  await shot(sup, '03b-my-reviews-list-phone-ar');
  await made.locator('input[type=date]').fill('2026-01-05');
  await made.locator('.reviews-made-empty').waitFor();
  eq(await count(sup, 'notes'), 0, 'another day: none');
  await made.locator('input[type=date]').fill(day);
  await made.locator('[data-review-made="visit-open"]').waitFor();

  // ---- 3. The same in English.
  const supEn = await open('sup', {language: 'en', hash: '#journeys'});
  await supEn.locator('[data-journey-tab="reviews"]').click();
  await supEn.locator('[data-reviews-made] [data-review-made="visit-open"]').waitFor();
  const english = await supEn.locator('[data-reviews-made]').innerText();
  for (const words of ['What was reviewed by', 'Notes', 'Positive', 'Effective', 'Negative', 'Not read yet', 'What the representative recorded', 'Required action', 'Day reviews', 'Notes on visits and contacts']) ok(english.includes(words), 'English: ' + words);
  for (const words of ['النتيجة', 'الإجراء المطلوب', 'فعالة', 'تقييم', 'لم تُقرأ']) ok(!english.includes(words), 'no Arabic label left: ' + words);
  await noOverflow(supEn, '«My reviews report» on a 360 px phone');
  await shot(supEn, '04-my-reviews-phone-en');

  // ---- 4. A sales manager on a desktop chooses the supervisor.
  const mgr = await open('mgr', {viewport: DESKTOP, hash: '#journeys'});
  await mgr.locator('[data-journey-tab="reviews"]').click();
  const mgrMade = mgr.locator('[data-reviews-made]');
  await mgrMade.locator('select').waitFor();
  eq(await mgrMade.locator('select option').allInnerTexts(), ['مدير المبيعات', 'المشرف سالم'], 'the sales manager: themself and their supervisor');
  await mgrMade.locator('select').selectOption('sup');
  await mgrMade.locator('[data-review-made="visit-open"]').waitFor();
  eq(await mgrMade.locator('[data-review-made]').count(), 3, 'the supervisor\'s three notes');
  await noOverflow(mgr, 'the reviews report on a desktop');
  await shot(mgr, '05-my-reviews-manager-desktop-ar');

  // ---- 5. The representative in the Android app: the card, «قرأت» on each note, and the notice of a new one on the open page.
  const rep = await open('rep1', {native: true, notification: 'granted', clock: true});
  const card = rep.locator('[data-review-inbox]');
  await card.waitFor();
  eq([await card.locator('[data-review-count]').innerText(), await card.locator('[data-review-read-all]').count(), await card.locator('[data-review-notify]').count()], ['3', 0, 0], 'three notes, no «قرأت الكل», no device notification to offer inside the app');
  eq(await card.locator('[data-entry-rating]').allInnerTexts(), ['سلبية', 'فعالة', 'إيجابية'], 'each note with its evaluation');
  eq(await rep.locator('[data-sonner-toast]').count(), 0, 'the first check announces nothing: the card shows the notes');
  await supApi('/api/reviews', {method: 'POST', headers: {Origin: app.origin}, body: {kind: 'day', memberId: 'rep1', date: day, result: 'يوم منظم', action: 'زد الزيارات غدًا', version: null, requestId: crypto.randomUUID()}});
  await rep.clock.fastForward('05:01');
  const toast = rep.locator('[data-sonner-toast]').filter({hasText: 'ملاحظة جديدة من المشرف'});
  await toast.waitFor();
  ok((await toast.innerText()).includes('المشرف سالم · تقييم اليوم ' + day), 'the message on the open page names who wrote it and on what');
  ok(!(await toast.innerText()).includes('يوم منظم'), 'and not the note\'s words');
  eq([await card.locator('[data-review-count]').innerText(), await card.locator('[data-review-kind="day"][data-review-new="yes"] .review-new').innerText()], ['4', 'جديدة'], 'the card counts it and marks it new');
  eq(await rep.evaluate(() => window.__notices.length), 0, 'no device notification is tried inside the app');
  await noOverflow(rep, 'the card and the message on a 360 px phone');
  await shot(rep, '06-notice-app-ar');
  await toast.getByRole('button', {name: 'عرض'}).click();
  await card.locator('[data-review-read="visit-open"]').click();
  await card.locator('[data-review-item="visit-open"]').waitFor({state: 'detached'});
  eq(await card.locator('[data-review-count]').innerText(), '3', '«قرأت» on one note');
  eq(await small(rep, '[data-review-inbox]'), [], 'the card\'s buttons are at least 44 px');
  // The earlier notes on the follow-up screen.
  await nav(rep, 'followup');
  await rep.locator('.rep-record-card').filter({hasText: 'مصنع الاختبار'}).getByRole('button', {name: 'تنفيذ المتابعة', exact: true}).click();
  const dialog = rep.locator('.followup-record-dialog'), history = dialog.locator('[data-review-history]');
  await history.waitFor();
  const historyText = await history.innerText();
  for (const words of ['ملاحظات المشرف السابقة', 'فعالة', 'سلبية', 'زيارة جيدة والعميل جاد', 'اتصل مرة أخرى غدًا', 'المشرف سالم']) ok(historyText.includes(words), 'the follow-up screen shows ' + words);
  eq(await history.locator('[data-review-note]').evaluateAll(items => items.map(item => item.dataset.reviewNote)), ['visit-open', 'call-c1'], 'newest first, this customer\'s only');
  eq(await rep.evaluate(() => document.querySelector('.followup-record-dialog').scrollWidth > document.querySelector('.followup-record-dialog').clientWidth + 1), false, 'the follow-up screen does not scroll sideways');
  await history.scrollIntoViewIfNeeded();
  await shot(rep, '07-followup-notes-app-ar');

  // ---- 6. A reviewed member in a phone browser (a representative works only in the app; a supervisor's own day is noted by the sales
  // manager), in English: the card offers the device's notification; a new note brings the page's message and the device's notification.
  const mgrApi = app.as(await app.login('mgr'));
  const dayNote = version => mgrApi('/api/reviews', {method: 'POST', headers: {Origin: app.origin}, body: {kind: 'day', memberId: 'sup', date: day, result: 'إشراف جيد ' + (version || 0), action: 'راجع زيارات الفريق', version, requestId: crypto.randomUUID()}});
  eq((await dayNote(null)).status, 200, 'the sales manager notes the supervisor\'s day');
  const supBrowser = await open('sup', {language: 'en', notification: 'default'});
  const cardEn = supBrowser.locator('[data-review-inbox]');
  await cardEn.waitFor();
  const notify = cardEn.locator('[data-review-notify]');
  eq([await notify.innerText(), (await notify.boundingBox()).height >= 44, await cardEn.locator('[data-review-read-all]').count()], ['Notify me of new notes on this device', true, 0], 'the card offers the device\'s notification, and «Read» on each note only');
  await noOverflow(supBrowser, 'the card in English on a 360 px phone');
  await shot(supBrowser, '08-notify-offer-phone-en');
  await notify.click();
  await notify.waitFor({state: 'detached'});
  eq(await supBrowser.evaluate(() => window.__permissionAsked), 1, 'asked once, on the tap');
  eq((await dayNote(1)).status, 200, 'the sales manager edits the note: a new version');
  await supBrowser.reload();
  const toastEn = supBrowser.locator('[data-sonner-toast]').filter({hasText: 'New note from your supervisor'});
  await toastEn.waitFor();
  await supBrowser.waitForFunction(() => window.__notices.length > 0);
  const notices = await supBrowser.evaluate(() => window.__notices);
  eq(notices.map(notice => [notice.title, notice.body, notice.dir, notice.tag.startsWith('yourrest-review:')]), [['New note from your supervisor', 'مدير المبيعات · Day review ' + day, 'ltr', true]], 'the device\'s notification: who and on what, never the note\'s words');
  ok((await cardEn.locator('[data-review-kind="day"]').innerText()).includes('New'), 'the edited note is marked new');
  await noOverflow(supBrowser, 'the card and the message in English on a 360 px phone');
  await shot(supBrowser, '09-notice-browser-en');
  // The customer's details, in English, in the app.
  const repEn = await open('rep1', {language: 'en', native: true});
  await nav(repEn, 'customer');
  await repEn.getByRole('button', {name: 'Customer details: مصنع البيع', exact: true}).click();
  const sheet = repEn.locator('.crm-sheet');
  await sheet.getByRole('tab', {name: 'Visit history'}).click();
  const sheetHistory = sheet.locator('[data-review-history]');
  await sheetHistory.waitFor();
  eq([await sheetHistory.locator('h3').innerText(), await sheetHistory.locator('[data-entry-rating]').allInnerTexts()], ['Earlier supervisor notes', ['Positive']], 'the customer\'s details: the earlier note, «Positive» on the sale');
  // The notes fit the details (the sheet's own tab row is wider than a 360 px phone in English, as before this change: not measured here).
  eq(await repEn.evaluate(() => { const sheet = document.querySelector('.crm-sheet').getBoundingClientRect(), notes = document.querySelector('.crm-sheet [data-review-history]'); return [notes, ...notes.querySelectorAll('*')].some(element => { const box = element.getBoundingClientRect(); return box.width && (box.left < sheet.left - 1 || box.right > sheet.right + 1); }) || notes.scrollWidth > notes.clientWidth + 1; }), false, 'the earlier notes fit the details on a 360 px phone');
  await shot(repEn, '10-customer-notes-app-en');

  // ---- 7. The supervisor's report shows the read.
  await made.locator('.reviews-made-toolbar button').click();
  await sup.waitForFunction(() => document.querySelector('[data-reviews-made] [data-count=read] dd')?.textContent === '1');
  ok((await made.locator('[data-review-made="visit-open"] [data-review-read="yes"]').innerText()).startsWith('تمت القراءة'), '«تمت القراءة» in the reviews report');

  eq(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks, screenshots}));
} finally {
  await browser?.close();
  await app.stop();
}
