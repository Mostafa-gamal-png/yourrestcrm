// Leave and absence in the evaluation (2026-11-15, the owner: «الإجازات تتحسب في التقييم (GSCO 2.13.50): الأيام اللي المندوب كان فيها في إجازة
// ما تتحسبش ضده»; lib/kpi-baseline.ts) in a real Chromium against the BUILT release (run the build first). Synthetic data only: temporary
// SQLite, mocked sendmail, no production data; the months are of 2025 (closed), picked in the month field as a person does. A representative
// on leave all of August 2025 (the representative in the Android app's emulator, scripts/lib/native-bridge.mjs):
// - the sales manager's «تقييم الأداء» of November 2025: under «العملاء والسوق» the line «أشهر المقارنة: يوليو 2025، سبتمبر 2025 وأكتوبر 2025»
//   and «أشهر بلا نشاط لم تُحتسب: أغسطس 2025», and the reason of «الحفاظ على العملاء الحاليين» ending with the same months;
// - August 2025: «بلا نشاط في هذا الشهر – خارج التقييم» last in the comparison, without numbers, and on the representative's page;
// - the representative's own «أهدافي» of August: the mark and why; of July: none;
// at phones of 320 and 360 px, a tablet upright and on its side and a desktop, in Arabic and in English (no Arabic left but names); nothing
// scrolls sideways; screenshots of each changed screen (YR_GATE_SCREENSHOT_DIR, else a temporary folder named in the output).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-kpi-leave-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'sm', name: 'المشرف سالم'}, {id: 'rep1', role: 'rep', sup: 'sup', name: 'المندوب أحمد'}, {id: 'rep2', role: 'rep', sup: 'sup', name: 'المندوب خالد'}
];
const SIZES = {phone320: {width: 320, height: 640}, phone360: {width: 360, height: 800}, tabletUp: {width: 768, height: 1024}, tabletSide: {width: 1024, height: 768}, desktop: {width: 1366, height: 900}};
const TEXT = {
  ar: {axis: 'العملاء والسوق', compared: 'أشهر المقارنة: يوليو 2025، سبتمبر 2025 وأكتوبر 2025', skipped: 'أشهر بلا نشاط لم تُحتسب: أغسطس 2025', out: 'بلا نشاط في هذا الشهر – خارج التقييم', retention: 'الحفاظ على العملاء الحاليين', ownWhy: 'لا يُحتسب الشهر عليك في التقييم'},
  en: {axis: 'Customers and market', compared: 'Months compared: July 2025, September 2025 and October 2025', skipped: 'Months without activity not counted: August 2025', out: 'No activity this month – excluded from the evaluation', retention: 'Customer retention', ownWhy: 'does not count against you'}
};
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const names = new Set([...members.map(m => m.name), 'الرئيسي']);
const arabicLeft = text => text.split('\n').map(line => line.trim()).filter(line => /[؀-ۿ]/.test(line)).filter(line => !line.split(/[·،,()|:←]| - /).map(part => part.trim()).filter(Boolean).every(part => names.has(part) || !/[؀-ۿ]/.test(part)));
const flat = text => text.replace(/\s+/g, ' ').trim();

try {
  app = await bootBuiltApp({members}, {tls: true});
  const stamp = '2025-01-01T00:00:00.000Z';
  const insert = (id, kind, parent, assigned, data) => app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id, kind, parent, assigned, 'الرئيسي', JSON.stringify(data), stamp, stamp).run();
  for (const id of ['rep1', 'rep2']) await insert('c-' + id, 'customer', null, id, {name: 'مصنع ' + id, region: 'الشرقية', city: 'الدمام'});
  for (let m = 1; m <= 11; m++) {
    const month = '2025-' + String(m).padStart(2, '0');
    for (const [by, day] of [['rep1', '10'], ['rep2', '12']]) if (by === 'rep2' || month !== '2025-08') await insert('v-' + by + '-' + month, 'activity', 'c-' + by, by, {type: 'visit', date: month + '-' + day, summary: 'تعريف بالمنتجات', result: 'العميل مهتم', performedBy: by, responsibleId: by, recordedByEmail: by + '@yourrest.org', salesStage: 'specs'});
  }
  await app.db.prepare('INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES(?,?,?,?,?,?)').bind('erp-import-leave', 'owner', 'fp-leave', 'synthetic.xlsx', JSON.stringify({coverage: {complete: true, from: '2025-01-01', to: '2025-11-30', months: [], partialMonths: [], repIds: ['rep1', 'rep2'], allReps: false, importerId: 'owner', importer: 'مدير النظام', at: stamp, importId: 'erp-import-leave'}}), stamp).run();
  let n = 0;
  const erp = async (rep, code, date) => { n++; await app.db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'h','m',?,'sale',?,'E',?,'الرئيسي','eastern',?,'عميل اصطناعي',?,10000,'erp-import-leave','owner',?)").bind('erp-' + n, 'doc-' + n, 'INV-' + n, date, rep, code, JSON.stringify({items: [{product: 'قوالب', quantity: 1, unitPrice: 100}], discount: 0}), stamp).run(); };
  for (const [code, date] of [['A', '2025-07-05'], ['B', '2025-09-05'], ['C', '2025-10-05'], ['D', '2025-05-05'], ['A', '2025-11-05'], ['B', '2025-11-06'], ['D', '2025-11-07']]) await erp('rep1', code, date);
  for (const [code, date] of [['E', '2025-08-05'], ['E', '2025-11-05']]) await erp('rep2', code, date);

  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});
  async function open(who, hash, {viewport, english}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: viewport.width < 1100, isMobile: viewport.width < 500});
    const [name, ...value] = (await app.login(who)).split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    await context.addInitScript(lang => { try { localStorage.setItem('yr-language', lang); } catch { /* storage unavailable */ } }, english ? 'en' : 'ar');
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(who + ': ' + error.message));
    // A representative works from the Android app (its emulator), as everywhere else in the release tests.
    if (members.find(m => m.id === who).role === 'rep') await installNativeBridge(page, {memberId: who, regionScope: 'all'});
    await page.goto(app.origin + hash);
    await page.waitForFunction(lang => document.documentElement.lang === lang, english ? 'en' : 'ar');
    return page;
  }
  const noSideways = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no sideways scrolling');
  const shot = async (page, box, name) => { await box.evaluate(element => element.scrollIntoView({block: 'center'})); await page.waitForTimeout(300); await page.screenshot({path: path.join(screenshots, name + '.png')}); };
  // The manager's evaluation of a month, opened on a person.
  async function evaluation(viewport, english, month) {
    const page = await open('sm', '/?tab=results#targets', {viewport, english});
    await page.locator('.targets-hub-month input').fill(month);
    const row = page.locator('.kpi-workspace tr', {hasText: 'المندوب أحمد'});
    await row.waitFor();
    return {page, row};
  }
  const openPerson = async page => { await page.locator('.kpi-workspace tr', {hasText: 'المندوب أحمد'}).locator('td').last().locator('button').click(); await page.locator('.kpi-person-heading', {hasText: 'المندوب أحمد'}).waitFor(); };

  for (const [size, viewport, langs] of [['phone320', SIZES.phone320, ['ar', 'en']], ['phone360', SIZES.phone360, ['ar', 'en']], ['tabletUp', SIZES.tabletUp, ['ar']], ['tabletSide', SIZES.tabletSide, ['en']], ['desktop', SIZES.desktop, ['ar', 'en']]]) {
    for (const lang of langs) {
      const english = lang === 'en', T = TEXT[lang], label = size + ' ' + lang;
      // ---- November 2025: the months compared and the month skipped, under «العملاء والسوق».
      let {page} = await evaluation(viewport, english, '2025-11');
      await openPerson(page);
      const axis = page.locator('.kpi-axis', {has: page.locator('h3', {hasText: T.axis})});
      const note = axis.locator('.kpi-baseline-note');
      check(await note.count(), 1, label + ': the line under the customers\' axis');
      const noteText = flat(await note.innerText());
      ok(noteText.includes(T.compared) && noteText.includes(T.skipped), label + ': the compared and skipped months: ' + noteText);
      const retention = axis.locator('.kpi-indicator', {has: page.locator('strong', {hasText: T.retention})}).first();
      await retention.locator('summary').click();
      const reason = flat(await retention.innerText());
      ok(reason.includes(english ? 'Months without activity not counted: August 2025.' : 'أشهر بلا نشاط لم تُحتسب: أغسطس 2025.') && reason.includes('66.67%') && reason.includes('2 / 3'), label + ': retention 2 / 3 and its reason names the months: ' + reason);
      if (english) check(arabicLeft(await axis.innerText()), [], label + ': no Arabic left in the customers\' card');
      await noSideways(page, label + ' november');
      await shot(page, note, 'kpi-leave-november-' + size + '-' + lang);
      await page.context().close();
      // ---- August 2025: out of the evaluation, last in the comparison, without numbers; and on the person's page.
      if (size !== 'tabletUp' && size !== 'tabletSide') {
        ({page} = await evaluation(viewport, english, '2025-08'));
        const rows = page.locator('.kpi-workspace tbody tr');
        check(await rows.count() >= 2, true, label + ': the comparison lists the team');
        const last = flat(await rows.last().innerText());
        ok(last.includes('المندوب أحمد') && last.includes(T.out) && !last.includes('/ 100'), label + ': rep1 last, with the sentence and no score: ' + last);
        await noSideways(page, label + ' august comparison');
        await shot(page, rows.last(), 'kpi-leave-august-comparison-' + size + '-' + lang);
        await openPerson(page);
        const line = page.locator('.kpi-inactive-line');
        ok(flat(await line.innerText()).includes(T.out), label + ': the person\'s page says it');
        if (english) check(arabicLeft(await line.innerText()), [], label + ': no Arabic left in the line');
        await noSideways(page, label + ' august person');
        await shot(page, line, 'kpi-leave-august-person-' + size + '-' + lang);
        await page.context().close();
      }
      // ---- The representative's own «أهدافي»: August marked, July not.
      page = await open('rep1', '/#targets', {viewport, english});
      const input = page.locator('.my-targets-toolbar input[type=month]');
      await input.fill('2025-08');
      const mark = page.locator('.my-targets-inactive');
      await mark.waitFor();
      const markText = flat(await mark.innerText());
      ok(markText.includes(T.out) && markText.includes(T.ownWhy), label + ': rep1 sees the mark and why: ' + markText);
      if (english) check(arabicLeft(await mark.innerText()), [], label + ': no Arabic left in the mark');
      await noSideways(page, label + ' own august');
      await shot(page, mark, 'kpi-leave-own-august-' + size + '-' + lang);
      await input.fill('2025-07');
      await page.locator('.my-targets-details').waitFor();
      await page.waitForFunction(() => !document.querySelector('.my-targets-state'));
      check(await mark.count(), 0, label + ': no mark on July');
      await page.context().close();
    }
  }
  check(errors, [], 'no page errors');
  console.log(JSON.stringify({ok: true, checks, screenshots, syntheticFixtures: true, productionDataUsed: false}));
} finally { await browser?.close(); await app?.stop(); }
