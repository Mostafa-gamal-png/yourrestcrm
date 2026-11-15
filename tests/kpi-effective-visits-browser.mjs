// «نسبة الزيارات الفعالة» from the supervisor's evaluation (2026-11-15, «موافق تمام»; lib/kpis.ts visitEvaluations) in a real Chromium
// against the BUILT release (run the build first). Synthetic data only: temporary SQLite, mocked sendmail, no production data; the month is
// the real clock's. The sales manager opens «تقييم الأداء» for a representative on a phone of 360 px (Arabic and English) and a desktop:
// - nothing evaluated yet: the indicator is «بيانات مطلوبة» with no score and its reason says «لم يقيّم المشرف زيارات هذا الشهر بعد. زيارات
//   بانتظار تقييم المشرف: 3.»; the indicator is named under «بيانات ناقصة» and the score is the one from the data there is;
// - after the supervisor's notes («فعالة», «سلبية») and a sale with no note: 66.67% · 2 / 3, the reason «الزيارات التي قيّمها المشرف «فعالة»
//   أو «إيجابية» (تم البيع) ÷ الزيارات التي قيّمها. زيارات بانتظار تقييم المشرف: 1.»; in English with no Arabic left but names;
// - nothing scrolls sideways; screenshots of the screen with the indicator's card in the middle for the report (YR_GATE_SCREENSHOT_DIR, else a temporary folder named in
//   the output).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-kpi-effective-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'sm', name: 'المشرف سالم'}, {id: 'rep1', role: 'rep', sup: 'sup', name: 'المندوب أحمد'}
];
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1366, height: 900};
const UNRATED = n => 'لم يقيّم المشرف زيارات هذا الشهر بعد. زيارات بانتظار تقييم المشرف: ' + n + '.';
const RATED = n => 'الزيارات التي قيّمها المشرف «فعالة» أو «إيجابية» (تم البيع) ÷ الزيارات التي قيّمها. زيارات بانتظار تقييم المشرف: ' + n + '.';
const UNRATED_EN = n => "The supervisor has not rated any visit this month yet. Visits awaiting the supervisor's rating: " + n + '.';
const RATED_EN = n => "Visits the supervisor rated «Effective» or «Positive» (sold) ÷ the visits they rated. Visits awaiting the supervisor's rating: " + n + '.';
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const names = new Set([...members.map(m => m.name), 'الرئيسي']);
const arabicLeft = text => text.split('\n').map(line => line.trim()).filter(line => /[؀-ۿ]/.test(line)).filter(line => !line.split(/[·،,()|:←]| - /).map(part => part.trim()).filter(Boolean).every(part => names.has(part) || !/[؀-ۿ]/.test(part)));
const flat = text => text.replace(/\s+/g, ' ').trim();

try {
  app = await bootBuiltApp({members}, {tls: true});
  const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()), now = new Date().toISOString();
  const insert = (id, kind, parent, assigned, data) => app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id, kind, parent, assigned, 'الرئيسي', JSON.stringify(data), now, now).run();
  const visit = (id, extra = {}) => insert(id, 'activity', 'c1', 'rep1', {type: 'visit', date: day, summary: 'تعريف بالمنتجات', result: 'العميل مهتم', performedBy: 'rep1', responsibleId: 'rep1', recordedByEmail: 'rep1@yourrest.org', salesStage: 'specs', ...extra});
  await insert('c1', 'customer', null, 'rep1', {name: 'مصنع الاختبار', region: 'الشرقية', city: 'الدمام'});
  await visit('v1', {salesStage: 'quoted'}); await visit('v2'); await visit('v3', {salesStage: 'new'});
  const supervisor = app.as(await app.login('sup'));
  const rate = async (activityId, rating) => check((await supervisor('/api/reviews', {method: 'POST', body: {kind: 'entry', requestId: crypto.randomUUID(), activityId, version: null, result: 'زيارة جيدة', action: 'جهّز عرض السعر', rating}})).status, 200, 'the supervisor evaluates ' + activityId);

  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});
  async function open(who, {viewport = PHONE, english = false} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: viewport.width < 900, isMobile: viewport.width < 500});
    const [name, ...value] = (await app.login(who)).split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    if (english) await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(who + ': ' + error.message));
    await page.goto(app.origin + '/?tab=results#targets');
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('.kpi-workspace tr', {hasText: 'المندوب أحمد'}).waitFor();
    await page.locator('.kpi-workspace tr', {hasText: 'المندوب أحمد'}).locator('td').last().locator('button').click();
    await page.locator('.kpi-person-heading', {hasText: 'المندوب أحمد'}).waitFor();
    return page;
  }
  const indicator = (page, english) => page.locator('.kpi-indicator', {has: page.locator('strong', {hasText: english ? 'Effective visit rate' : 'نسبة الزيارات الفعالة'})}).first();
  const noSideways = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no sideways scrolling');
  // The screen as the reader sees it, the indicator's card in the middle with its reason open.
  const shot = async (page, box, name) => { await box.evaluate(element => element.scrollIntoView({block: 'center'})); await page.waitForTimeout(300); await page.screenshot({path: path.join(screenshots, name + '.png')}); };
  // The axis card «الكفاءة والإنتاجية» that holds the indicator, opened on its reason.
  const card = async (page, english, label) => {
    const box = indicator(page, english);await box.waitFor();
    await box.locator('summary').click();
    const text = await box.innerText(), axis = page.locator('.kpi-axis', {has: box});
    return {box, axis, text, flat: flat(text), label};
  };

  // ---- nothing evaluated yet: missing, 3 waiting (phone 360, Arabic)
  let page = await open('sm');
  let seen = await card(page, false);
  ok(seen.flat.includes('بيانات مطلوبة') && !seen.flat.includes('%'), 'phone ar: «بيانات مطلوبة» and no score: ' + seen.flat);
  ok(seen.flat.includes('— / 2'), 'phone ar: no points of the 2: ' + seen.flat);
  ok(seen.flat.includes('البيانات المطلوبة / طريقة الحساب') && seen.flat.includes(UNRATED(3)), 'phone ar: the reason says nothing is evaluated and 3 wait: ' + seen.flat);
  const notice = flat(await page.locator('.kpi-workspace > .kpi-partial-notice').innerText());
  ok(notice.includes('بيانات ناقصة') && notice.includes('نسبة الزيارات الفعالة') && notice.includes('الدرجة محسوبة من البيانات الموجودة فقط'), 'phone ar: named among the missing data, the score from the data there is: ' + notice);
  await noSideways(page, 'phone ar unrated');
  await shot(page, seen.box, 'kpi-effective-unrated-phone360-ar');
  await page.context().close();

  // ---- the same in English
  page = await open('sm', {english: true});
  seen = await card(page, true);
  ok(seen.flat.includes('Data required') && !seen.flat.includes('%') && seen.flat.includes(UNRATED_EN(3)), 'phone en: data required, the reason in English: ' + seen.flat);
  check(arabicLeft(await seen.axis.innerText()), [], 'phone en: no Arabic left in the card');
  await noSideways(page, 'phone en unrated');
  await shot(page, seen.box, 'kpi-effective-unrated-phone360-en');
  await page.context().close();

  // ---- the supervisor's notes: «فعالة», «سلبية», and a sale with no note
  await rate('v1', 'effective'); await rate('v2', 'negative');
  await visit('v4', {salesStage: 'won'});
  page = await open('sm');
  seen = await card(page, false);
  ok(seen.flat.includes('محسوب تلقائيًا') && seen.flat.includes('66.67%') && seen.flat.includes('2 / 3'), 'phone ar: 66.67% · 2 / 3: ' + seen.flat);
  ok(seen.flat.includes('1.33 / 2'), 'phone ar: 1.33 of the 2 points: ' + seen.flat);
  ok(seen.flat.includes('طريقة الحساب') && seen.flat.includes(RATED(1)), 'phone ar: the reason line with 1 waiting: ' + seen.flat);
  await noSideways(page, 'phone ar rated');
  await shot(page, seen.box, 'kpi-effective-rated-phone360-ar');
  await page.context().close();

  // ---- English, phone 360
  page = await open('sm', {english: true});
  seen = await card(page, true);
  ok(seen.flat.includes('66.67%') && seen.flat.includes('2 / 3') && seen.flat.includes(RATED_EN(1)), 'phone en: score and the reason in English: ' + seen.flat);
  check(arabicLeft(await seen.axis.innerText()), [], 'phone en: no Arabic left in the card');
  await noSideways(page, 'phone en rated');
  await shot(page, seen.box, 'kpi-effective-rated-phone360-en');
  await page.context().close();

  // ---- desktop, Arabic
  page = await open('sm', {viewport: DESKTOP});
  seen = await card(page, false);
  ok(seen.flat.includes('66.67%') && seen.flat.includes(RATED(1)), 'desktop ar: the same: ' + seen.flat);
  await noSideways(page, 'desktop ar');
  await shot(page, seen.box, 'kpi-effective-rated-desktop-ar');
  await page.context().close();

  check(errors, [], 'no page errors');
  console.log(JSON.stringify({ok: true, checks, screenshots, syntheticFixtures: true, productionDataUsed: false}));
} finally { await browser?.close(); await app?.stop(); }
