// The four targets decisions of 2026-11-10 in a real Chromium against the BUILT release (run the build first). Synthetic data only:
// temporary SQLite, mocked sendmail, no production data; the months are the real clock's (this month in Riyadh and the one before).
// - Phone 360 (Arabic and English): «توزيع المستهدفات» is one card for each person (products: target / achieved / %, customers and
//   visits, the edit buttons where allowed, «سجل التعديلات»); no sideways scrolling. Desktop and tablet keep the table.
// - «سجل التعديلات»: the dialog lists who, when, which month and before → after, newest first, on the desktop and the phone.
// - A finished month: the sales manager reads it with the owner's note and no edit button; the administrator edits it, and the
//   history marks the change.
// - The administrator with no target and no sale is in no card, column or picker. Screenshots for the report.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-targets-decisions-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
const P = ['قوالب البلوك المتحركة', 'قوالب البلوك الثابتة', 'لمامة البلوك', 'ماكينة إنتاج البلوكة المتحركة', 'قطع غيار المكائن المتحركة', 'خلاطات البلوك', 'خلاطات الخرسانة الجاهزة', 'خدمات صيانة'];
const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'sm', name: 'المشرف أحمد'},
  {id: 'rep1', role: 'rep', sup: 'sup', name: 'مندوب أول'}, {id: 'rep2', role: 'rep', sup: 'sup', name: 'مندوب ثاني'}
];
const PHONE = {width: 360, height: 800}, TABLET = {width: 820, height: 1180}, DESKTOP = {width: 1366, height: 900};
const riyadh = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit'});
const day = riyadh.format(new Date()), month = day.slice(0, 7);
const shift = n => { const d = new Date(month + '-15T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const prev = shift(-1);
const CLOSED = 'انتهى هذا الشهر؛ تعديل مستهدفاته لمدير النظام فقط';
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const quantities = values => ({products: P.map((product, i) => ({product, quantity: values[i] === undefined ? 0 : values[i]}))});

try {
  app = await bootBuiltApp({members}, {tls: true});
  const sessions = {};
  for (const m of members) sessions[m.id] = await app.login(m.id);
  const as = who => app.as(sessions[who]);
  const save = (who, kind, scopeId, data, m = month, version = 0, inheritedFrom = null) => as(who)('/api/targets', {method: 'POST', body: {kind, scopeId, month: m, version, inheritedFrom, requestId: crypto.randomUUID(), data}});
  check((await save('owner', 'weights', 'company', {products: P.map((product, i) => ({product, weight: [40, 20, 10, 10, 10, 5, 5, 0][i]}))}, prev)).status, 200, 'the weights of last month, by the administrator');
  check((await save('owner', 'sales', 'rep1', quantities([10, 4]), prev)).status, 200, 'rep1 last month, by the administrator');
  check((await save('sm', 'sales', 'rep1', quantities([20, 8]), month, 0, {month: prev, version: 1})).status, 200, 'rep1 this month over the carried values');
  check((await save('sm', 'sales', 'rep2', quantities([10, 4]))).status, 200);
  check((await save('sm', 'activity', 'rep1', {newCustomers: 3, recoveredCustomers: 2, visits: 40})).status, 200);
  const now = new Date().toISOString();
  await app.db.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('imp','owner','f','sales.xlsx','{}',?)").bind(now).run();
  await app.db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES('erp-1','doc-1','h','h','ERP-1','sale',?,'e1','rep1','الرئيسي','all','C-1','n',?,100000,'imp','owner',?)")
    .bind(day, JSON.stringify({items: [{product: P[0], description: '', quantity: 10, unitPrice: 100}], discount: 0, notes: ''}), now).run();

  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});
  async function open(who, {viewport = DESKTOP, english = false, monthValue = month} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: viewport.width < 900, isMobile: viewport.width < 500});
    const [name, ...value] = (await app.login(who)).split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    if (english) await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(who + ': ' + error.message));
    await page.goto(app.origin + '/#targets');
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    if (monthValue !== month) await page.locator('.sales-toolbar input[type=month]').fill(monthValue);
    await page.locator('.targets-workspace').waitFor();
    await page.locator('.targets-workspace .panel-heading bdi', {hasText: monthValue}).first().waitFor();
    return page;
  }
  const shot = async (page, label, fullPage = true) => { await page.waitForTimeout(250); await page.screenshot({path: path.join(screenshots, label + '.png'), fullPage}); };
  const noSideways = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no sideways scrolling');
  const card = (page, name) => page.locator('.target-card').filter({has: page.locator('h3', {hasText: new RegExp('^' + name + '$')})});
  const arabicIn = text => text.split('\n').map(line => line.trim()).filter(line => /[؀-ۿ]/.test(line));
  const names = new Set([...members.map(m => m.name), 'الرئيسي']);
  const onlyNames = lines => lines.filter(line => !line.split(/[·،,]/).map(part => part.trim()).filter(Boolean).every(part => names.has(part) || /^[\x00-\x7F]*$/.test(part)));

  // ---- the phone, Arabic: one card for each person
  let page = await open('sm', {viewport: PHONE});
  await page.locator('.target-card').first().waitFor();
  check([await page.locator('.quantity-targets-table').isVisible(), await page.locator('.target-activity-panel').isVisible(), await page.locator('.target-cards').isVisible()], [false, false, true], 'phone: the cards in place of both tables');
  check((await page.locator('.target-card h3').allInnerTexts()).sort(), ['مدير المبيعات', 'المشرف أحمد', 'مندوب أول', 'مندوب ثاني'].sort(), 'one card for each person the sales manager reads');
  const rep1 = card(page, 'مندوب أول');
  const firstProduct = (await rep1.locator('.target-card-product').first().locator('dd b').allInnerTexts()).map(text => text.trim());
  check(firstProduct, ['20', '10', '50%'], 'rep1, first product: target 20, achieved 10, 50%');
  check((await rep1.locator('.target-card-product').nth(1).locator('dd b').allInnerTexts()).map(text => text.trim()), ['8', '—', '—'], 'second product: 8, nothing sold of it: unknown («—»), as the summary card');
  check((await rep1.locator('.target-card-activity dd').allInnerTexts()).map(text => text.trim()), ['3', '2', '40'], 'and the customer and visit targets');
  check([await rep1.getByRole('button', {name: 'تعديل الأصناف'}).count(), await rep1.getByRole('button', {name: 'تعديل العملاء والزيارات'}).count(), await rep1.getByRole('button', {name: 'سجل التعديلات · مندوب أول'}).count()], [1, 1, 1], 'its edit buttons and its history');
  check(await card(page, 'مدير المبيعات').getByRole('button', {name: /^تعديل/}).count(), 0, 'the sales manager\'s card is computed from the team: no edit button');
  await noSideways(page, 'manager phone ar');
  await shot(page, 'decisions-cards-phone-ar');
  // Editing from a card works as from the table.
  await rep1.getByRole('button', {name: 'تعديل العملاء والزيارات'}).click();
  let dialog = page.getByRole('dialog');
  await dialog.locator('input').nth(2).fill('45');
  await dialog.getByRole('button', {name: 'حفظ المستهدفات'}).click();
  await dialog.waitFor({state: 'detached'});
  await card(page, 'مندوب أول').locator('.target-card-activity dd', {hasText: /^45$/}).waitFor();
  ok(true, 'a target saved from a card');
  // The history from a card, on the phone.
  await card(page, 'مندوب أول').getByRole('button', {name: 'سجل التعديلات · مندوب أول'}).click();
  dialog = page.getByRole('dialog');
  await dialog.locator('.target-history-entry').first().waitFor();
  const phoneEntries = dialog.locator('.target-history-entry');
  check(await phoneEntries.count(), 4, 'rep1: four changes (customers and visits twice, products this month, products last month)');
  ok((await phoneEntries.first().innerText()).includes('مستهدفات العملاء والزيارات') && (await phoneEntries.first().innerText()).includes('40 ← 45'), 'the newest first: visits 40 ← 45');
  await noSideways(page, 'history phone ar');
  await shot(page, 'decisions-history-phone-ar', false);
  await page.close();

  // ---- the phone, English
  page = await open('sm', {viewport: PHONE, english: true});
  await page.locator('.target-card').first().waitFor();
  const englishCards = await page.locator('.target-cards').innerText();
  check(onlyNames(arabicIn(englishCards)), [], 'English cards: no Arabic but people\'s names');
  ok(englishCards.includes('Edit products') && englishCards.includes('Achieved') && englishCards.includes('Change history'), 'English labels');
  await noSideways(page, 'manager phone en');
  await shot(page, 'decisions-cards-phone-en');
  await card(page, 'مندوب أول').getByRole('button', {name: 'Change history · مندوب أول'}).click();
  dialog = page.getByRole('dialog');
  await dialog.locator('.target-history-entry').first().waitFor();
  check(onlyNames(arabicIn(await dialog.innerText())), [], 'English history: no Arabic but people\'s names');
  ok((await dialog.innerText()).includes('40 → 45') && (await dialog.innerText()).includes('Finished month'), 'English: before → after, and the finished-month mark');
  await shot(page, 'decisions-history-phone-en', false);
  await page.close();

  // ---- desktop and tablet keep the table
  for (const [label, viewport] of [['desktop', DESKTOP], ['tablet', TABLET]]) {
    page = await open('sm', {viewport});
    check([await page.locator('.quantity-targets-table').isVisible(), await page.locator('.target-cards').isVisible()], [true, false], label + ': the table, not the cards');
    await noSideways(page, 'manager ' + label);
    if (label === 'desktop') {
      await page.locator('.quantity-targets-table thead th').filter({hasText: 'مندوب أول'}).getByRole('button', {name: 'سجل التعديلات · مندوب أول'}).click();
      dialog = page.getByRole('dialog');
      await dialog.locator('.target-history-entry').nth(3).waitFor();
      const texts = await dialog.locator('.target-history-entry').allInnerTexts();
      ok(texts[2].includes('مدير المبيعات') && texts[2].includes('بدل القيم المنقولة من شهر') && texts[2].includes('10 قالب ← 20 قالب') && texts[2].includes('4 قالب ← 8 قالب'), 'this month\'s products: who, carried from last month, 10 ← 20 and 4 ← 8 molds');
      ok(texts[3].includes('مدير النظام') && texts[3].includes('شهر منتهي') && texts[3].includes(prev), 'last month\'s, by the administrator, marked as a finished month');
      await shot(page, 'decisions-history-desktop-ar', false);
      await dialog.getByRole('button', {name: 'إغلاق'}).first().click();
      await page.getByRole('button', {name: 'سجل الأوزان'}).click();
      await page.getByRole('dialog').locator('.target-history-entry').first().waitFor();
      ok((await page.getByRole('dialog').innerText()).includes('40%'), 'the weights history');
      await page.getByRole('dialog').getByRole('button', {name: 'إغلاق'}).first().click();
    }
    await shot(page, 'decisions-table-' + label + '-ar');
    await page.close();
  }

  // ---- a finished month: read only for the sales manager, with the note
  for (const [label, viewport] of [['desktop', DESKTOP], ['phone', PHONE]]) {
    page = await open('sm', {viewport, monthValue: prev});
    const note = page.locator('.target-closed-note');
    check([await note.isVisible(), (await note.innerText()).trim()], [true, CLOSED], label + ': the owner\'s note on a finished month');
    check([await page.locator('.targets-workspace').getByRole('button', {name: /^تعديل/}).count(), await page.getByRole('button', {name: 'أوزان التقييم'}).count()], [0, 0], label + ': no edit button and no weights button');
    ok(await page.locator('.targets-workspace').getByRole('button', {name: /^سجل/}).count() > 0, label + ': the history is still there');
    await noSideways(page, 'finished month ' + label);
    await shot(page, 'decisions-closed-month-sm-' + label + '-ar');
    await page.close();
  }
  // The administrator edits it; the history marks the change.
  page = await open('owner', {monthValue: prev});
  ok((await page.locator('.target-closed-note').innerText()).includes('مدير النظام'), 'the administrator is told the month has ended and that they can edit it');
  await page.locator('.quantity-targets-table thead th').filter({hasText: 'مندوب أول'}).getByRole('button', {name: 'تعديل', exact: true}).click();
  dialog = page.getByRole('dialog');
  await dialog.locator('input').first().fill('12');
  await dialog.getByRole('button', {name: 'حفظ المستهدفات'}).click();
  await dialog.waitFor({state: 'detached'});
  await page.locator('.quantity-targets-table tbody tr').first().getByText('12', {exact: true}).waitFor();
  await page.locator('.quantity-targets-table thead th').filter({hasText: 'مندوب أول'}).getByRole('button', {name: 'سجل التعديلات · مندوب أول'}).click();
  dialog = page.getByRole('dialog');
  await dialog.locator('.target-history-entry').first().waitFor();
  const newest = await dialog.locator('.target-history-entry').first().innerText();
  ok(newest.includes('مدير النظام') && newest.includes('شهر منتهي') && newest.includes('10 قالب ← 12 قالب'), 'the administrator\'s change of the finished month: 10 ← 12, marked');
  await shot(page, 'decisions-closed-month-owner-desktop-ar', false);
  await page.close();
  // The administrator who does not sell is in no column, card or picker (this month).
  for (const [label, viewport] of [['desktop', DESKTOP], ['phone', PHONE]]) {
    page = await open('owner', {viewport});
    check(await page.locator('.quantity-targets-table thead th, .target-card h3, .targets-summary-card h3').filter({hasText: /^مدير النظام$/}).count(), 0, 'owner ' + label + ': the administrator is not listed');
    await page.locator('.sales-toolbar').getByRole('combobox', {name: 'المندوب'}).click();
    check(await page.getByRole('option', {name: 'مدير النظام', exact: true}).count(), 0, 'owner ' + label + ': nor offered in the picker');
    await page.keyboard.press('Escape');
    await shot(page, 'decisions-owner-' + label + '-ar');
    await page.close();
  }
  check(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks, screenshots, builtRelease: true, realBrowser: true, syntheticFixtures: true, productionDataUsed: false, months: {prev, month}}));
} finally {
  await browser?.close();
  await app?.stop();
}
