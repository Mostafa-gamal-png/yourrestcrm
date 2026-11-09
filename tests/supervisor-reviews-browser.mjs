// The supervisor's notes (lib/supervisor-reviews*.ts, app/supervisor-reviews.tsx) in a real Chromium against the BUILT release (run the
// build first): on «تقرير يوم المندوب» the supervisor adds «النتيجة» and «الإجراء المطلوب» under their representative's visit and on
// the whole day, on a desktop in Arabic and on a 360 px phone in English («لم تُقرأ بعد» / «Not read yet»); the representative, in the
// Android app emulator, finds «ملاحظات المشرف على شغلك» at the top of every page with its count, a «قرأت» that fails offline keeps the
// note and says why, «قرأت» hides one, «قرأت الكل» the rest (in English); the supervisor then sees «تمت القراءة» with the time. No
// horizontal scroll and 44 px buttons on the phone. Synthetic fixtures only: temporary SQLite, mocked mail, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [{id: 'owner', role: 'admin'}, {id: 'mgr', role: 'manager', name: 'مدير المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف سالم'}, {id: 'rep1', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'}];
const screenshots = process.env.YR_REVIEWS_SCREENSHOT_DIR ? path.resolve(process.env.YR_REVIEWS_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-reviews-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser;
const errors = [];
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1280, height: 900};
const app = await bootBuiltApp({members}, {tls: true});
try {
  const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()), now = new Date().toISOString();
  const insert = (id, kind, parent, assigned, data) => app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id, kind, parent, assigned, 'الرئيسي', JSON.stringify(data), now, now).run();
  await insert('c1', 'customer', null, 'rep1', {name: 'مصنع الاختبار', region: 'الشرقية', city: 'الدمام', location: '26.43, 50.03', phone: '0551234567'});
  for (const [id, type, result] of [['visit-rep1', 'visit', 'العميل طلب عرض سعر'], ['call-rep1', 'call', 'اتصال للتذكير بالعرض']])
    await insert(id, 'activity', 'c1', 'rep1', {type, date: day, summary: 'تعريف بالمنتجات', result, performedBy: 'rep1', responsibleId: 'rep1', recordedByEmail: 'rep1@yourrest.org'});
  const {scope} = await app.db.prepare('SELECT region_scope AS scope FROM crm_members WHERE id=?').bind('rep1').first();
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  async function open(memberId, {viewport = DESKTOP, language = 'ar', hash = ''} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block'});
    if (language === 'en') await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (memberId.startsWith('rep')) await installNativeBridge(page, {memberId, regionScope: scope});
    await page.goto(app.origin + '/' + hash);
    await page.locator('.workspace').waitFor();
    return page;
  }
  const shot = async (page, label) => { await page.waitForTimeout(250); await page.screenshot({path: path.join(screenshots, label + '.png'), fullPage: false}); };
  const noOverflow = async (page, label) => eq(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scroll');
  const smallButtons = (page, scopeSelector) => page.evaluate(selector => [...document.querySelectorAll(selector + ' button')].filter(button => button.offsetParent && button.getBoundingClientRect().height < 43.5).map(button => button.textContent.trim() || button.getAttribute('aria-label')), scopeSelector);
  async function openReport(page) {
    await page.locator('.journey-toolbar select').waitFor();
    await page.locator('.journey-toolbar select').selectOption('rep1');
    await page.locator('.journey-communications').waitFor();
  }
  async function writeNote(block, result, action, saveLabel) {
    await block.locator('textarea').nth(0).fill(result);
    await block.locator('textarea').nth(1).fill(action);
    await block.getByRole('button', {name: saveLabel, exact: true}).click();
    await block.locator('.review-saved').waitFor();
  }

  // ---- 1. The supervisor on a desktop, in Arabic: a note on the visit and on the day.
  const sup = await open('sup', {hash: '#journeys'});
  await openReport(sup);
  const visit = sup.locator('[data-entry-review="visit-rep1"]');
  await visit.locator('[data-review-add="visit-rep1"]').click();
  eq(await visit.locator('.voice-field > span').allInnerTexts().then(texts => texts.map(text => text.replace(/\s*\*$/, '').trim())), ['النتيجة', 'الإجراء المطلوب'], 'the two fields, each a dictation field');
  await visit.getByRole('button', {name: 'حفظ', exact: true}).click();
  eq(await visit.locator('.review-error').innerText(), 'اكتب النتيجة والإجراء المطلوب؛ الخانتان إلزاميتان.', 'both fields are required before anything is sent');
  await writeNote(visit, 'زيارة جيدة والعميل جاد', 'جهّز عرض السعر قبل الخميس', 'حفظ');
  ok((await visit.innerText()).includes('لم تُقرأ بعد') && (await visit.innerText()).includes('المشرف سالم'), 'the saved note: who wrote it and «لم تُقرأ بعد»');
  await sup.locator('[data-review-add-day="rep1"]').click();
  await writeNote(sup.locator('[data-day-review="rep1"]'), 'يوم منظم', 'زد الزيارات غدًا', 'حفظ');
  ok((await sup.locator('[data-day-review="rep1"]').innerText()).includes('تقييم اليوم · المندوب أحمد'), 'the day note names the representative');
  await noOverflow(sup, 'the report with its notes on a desktop');
  await shot(sup, '01-supervisor-desktop-ar');

  // ---- 2. The supervisor on a 360 px phone, in English: a note on the call.
  const supPhone = await open('sup', {viewport: PHONE, language: 'en', hash: '#journeys'});
  await openReport(supPhone);
  const call = supPhone.locator('[data-entry-review="call-rep1"]');
  await call.getByRole('button', {name: 'Add result and action'}).click();
  eq(await smallButtons(supPhone, '[data-entry-review="call-rep1"]'), [], 'every button of the form at least 44 px on the phone');
  await writeNote(call, 'Good follow-up call', 'Send the quotation today', 'Save');
  ok((await call.innerText()).includes('Not read yet'), '«Not read yet» in English');
  ok((await supPhone.locator('[data-entry-review="visit-rep1"]').innerText()).includes('زيارة جيدة والعميل جاد'), 'the visit note written on the desktop shows on the phone');
  await noOverflow(supPhone, 'the report on a 360 px phone');
  await call.scrollIntoViewIfNeeded();
  await shot(supPhone, '02-supervisor-phone-en');

  // ---- 3. The representative on a phone (the Android app), in Arabic: the card on every page.
  const rep = await open('rep1', {viewport: PHONE});
  const card = rep.locator('[data-review-inbox]');
  await card.waitFor();
  eq(await card.locator('[data-review-count]').innerText(), '3', 'three unread notes');
  const text = await card.innerText();
  for (const words of ['ملاحظات المشرف على شغلك', 'النتيجة', 'الإجراء المطلوب', 'تقييم اليوم', 'زيارة · مصنع الاختبار', 'جهّز عرض السعر قبل الخميس', 'المشرف سالم', 'قرأت الكل']) ok(text.includes(words), 'the card shows ' + words);
  eq(await smallButtons(rep, '[data-review-inbox]'), [], 'the card\'s buttons are at least 44 px');
  await noOverflow(rep, 'the card on a 360 px phone');
  await shot(rep, '03-representative-card-ar');
  // A «قرأت» that cannot reach the server keeps the note and says so.
  await rep.route('**/api/review-inbox', route => route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue());
  await card.locator('[data-review-read="visit-rep1"]').click();
  await card.locator('.review-error').waitFor();
  eq([await card.locator('[data-review-item]').count(), await card.locator('[data-review-count]').innerText()], [3, '3'], 'the note stays after a failed «قرأت»');
  await rep.unroute('**/api/review-inbox');
  await card.locator('[data-review-read="visit-rep1"]').click();
  await card.locator('[data-review-item="visit-rep1"]').waitFor({state: 'detached'});
  eq(await card.locator('[data-review-count]').innerText(), '2', '«قرأت» hides the note');
  // Another page: the card is still at the top.
  const button = rep.locator('.mobile-bottom-navigation [data-page=customer]');
  if (await button.count()) await button.click(); else { await rep.getByRole('button', {name: /^(المزيد من الصفحات|More pages)$/}).click(); await rep.locator('.mobile-overflow-pages [data-page=customer]').click(); }
  await rep.locator('.mobile-navigation-sheet').waitFor({state: 'detached'});
  await rep.locator('.page-heading', {hasText: 'العملاء'}).waitFor();
  await card.waitFor();
  eq(await card.locator('[data-review-count]').innerText(), '2', 'the card on another page');

  // ---- 4. The representative in English on a desktop: «Mark all read».
  const repEn = await open('rep1', {language: 'en'});
  const cardEn = repEn.locator('[data-review-inbox]');
  await cardEn.waitFor();
  ok((await cardEn.innerText()).includes('Your supervisor’s notes on your work') && (await cardEn.innerText()).includes('Required action'), 'the card in English');
  await shot(repEn, '04-representative-card-en');
  await cardEn.locator('[data-review-read-all]').click();
  await cardEn.waitFor({state: 'detached'});
  ok(true, '«Mark all read» empties and hides the card');

  // ---- 5. The supervisor sees «تمت القراءة» with the time.
  await sup.locator('.journey-toolbar button', {hasText: 'تحديث التقرير'}).click();
  await sup.locator('[data-entry-review="visit-rep1"] [data-review-read="yes"]').waitFor();
  const readLine = await sup.locator('[data-entry-review="visit-rep1"] [data-review-read="yes"]').innerText();
  ok(readLine.startsWith('تمت القراءة') && /\d{2}:\d{2}/.test(readLine), '«تمت القراءة» and the time: ' + readLine);
  ok((await sup.locator('[data-day-review="rep1"] [data-review-read="yes"]').innerText()).startsWith('تمت القراءة'), 'the day note read too');
  await sup.locator('[data-entry-review="visit-rep1"]').scrollIntoViewIfNeeded();
  await shot(sup, '05-supervisor-read-ar');
  await supPhone.reload();await openReport(supPhone);
  ok((await supPhone.locator('[data-entry-review="call-rep1"] [data-review-read="yes"]').innerText()).startsWith('Read'), '«Read» with the time in English');
  // An edit makes it unread again.
  const edited = sup.locator('[data-entry-review="visit-rep1"]');
  await edited.locator('[data-review-edit]').click();
  await writeNote(edited, 'زيارة جيدة جدًا', 'جهّز عرض السعر اليوم', 'حفظ');
  ok((await edited.innerText()).includes('لم تُقرأ بعد'), 'the edited note is unread again');
  await rep.reload();await rep.locator('[data-review-inbox] [data-review-item="visit-rep1"]').waitFor();
  ok(true, 'and it is back on the representative\'s card');

  eq(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks, screenshots}));
} finally {
  await browser?.close();
  await app.stop();
}
