// «إخفاء تبويبات صفحة المستهدفات لكل حساب» (the owner, 2026-11-16, item 6 of the GSCO list) in a real Chromium against the BUILT release
// (run the build first). Synthetic fixtures only: temporary SQLite, mocked sendmail, no production data.
// - The administrator, on the desktop in Arabic, opens the supervisor in «الفريق والصلاحيات»: under «المستهدفات وتقييم الأداء» a row for each
//   of «نتائج الأداء»، «التحصيل»، «عروض الأسعار»، «المستهدفات والأوزان», «استعراض» only («—» elsewhere), with the screen's note; the
//   screen's «استعراض» off disables them; «الكل» of the screen covers them; unticks «نتائج الأداء» and «التحصيل» and saves (the row stored).
// - The supervisor: the hub has «رفع المبيعات»، «عروض الأسعار»، «المستهدفات والأوزان»; ?tab=collection and the browser's remembered
//   «نتائج الأداء» both open «رفع المبيعات» (the address then names it); the page's own requests of a hidden tab answer 404.
// - Every tab hidden: the page stays with «رفع المبيعات»; with «المبيعات» hidden too, the menus (desktop sidebar, the phone's «المزيد»)
//   no longer offer it and #targets opens another page.
// - The supervisor's hub and the administrator's matrix at phone 320 and 360, tablet upright and on its side, desktop, in Arabic and in
//   English (no Arabic left but names): nothing scrolls sideways (the matrix scrolls inside its own box). Screenshots for the report
//   (YR_GATE_SCREENSHOT_DIR, else a temporary folder).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-targets-tabs-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
const members = [{id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'مدير المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'sm', name: 'المشرف سالم'}, {id: 'rep', role: 'rep', sup: 'sup', name: 'مندوب الوسطى'}];
const VIEWPORTS = {phone320: {width: 320, height: 740}, phone360: {width: 360, height: 800}, tablet: {width: 820, height: 1180}, tabletSideways: {width: 1180, height: 820}, desktop: {width: 1440, height: 900}};
const KEYS = ['targets.results', 'targets.collection', 'targets.quotes', 'targets.targets'];
const HIDDEN = 'هذا الجزء غير متاح لحسابك. راجع مدير النظام.';
const TAB_NAMES = {ar: ['نتائج الأداء', 'رفع المبيعات', 'التحصيل', 'عروض الأسعار', 'المستهدفات والأوزان'], en: ['Performance results', 'Sales upload', 'Collection', 'Quotations', 'Targets & weights']};
const names = new Set(members.map(member => member.name));
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const arabicLeft = text => text.split('\n').map(line => line.trim()).filter(line => /[؀-ۿ]/.test(line)).filter(line => !line.split(/[·،,()|:]/).map(part => part.trim()).filter(Boolean).every(part => names.has(part) || !/[؀-ۿ]/.test(part)));

try {
  app = await bootBuiltApp({members}, {tls: true});
  const month = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()).slice(0, 7);
  const stored = async id => JSON.parse((await app.db.prepare('SELECT hidden FROM crm_member_permissions WHERE member_id=?').bind(id).first())?.hidden || '[]');
  const version = async id => Number((await app.db.prepare('SELECT version FROM crm_member_permissions WHERE member_id=?').bind(id).first())?.version || 0);
  const owner = app.as(await app.login('owner'));
  const saveHidden = async (id, hidden) => { const response = await owner('/api/crm', {method: 'POST', body: {action: 'permissions', memberId: id, version: await version(id), cells: {}, hidden, viewAll: false, requestId: crypto.randomUUID()}}); check(response.status, 200, 'save ' + id + ' ' + JSON.stringify(hidden) + ' -> ' + response.text.slice(0, 200)); };
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});
  async function open(memberId, {viewport = VIEWPORTS.desktop, english = false, url = '/#targets', remember = null} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: viewport.width < 900, isMobile: viewport.width < 500});
    const [name, ...value] = (await app.login(memberId)).split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    if (english) await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    if (remember) await context.addInitScript(([key, tab]) => { try { localStorage.setItem(key, tab); } catch { /* storage unavailable */ } }, ['yr-targets-tab:' + memberId, remember]);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    await page.goto(app.origin + url);
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('.topbar').waitFor();
    return page;
  }
  const shot = async (page, label, fullPage = true) => { await page.waitForTimeout(250); await page.screenshot({path: path.join(screenshots, label + '.png'), fullPage}); };
  const noSideways = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': nothing scrolls sideways');
  const tabs = async page => { await page.locator('.targets-hub-tabs [role=tab]').first().waitFor(); return (await page.locator('.targets-hub-tabs [role=tab]').allInnerTexts()).map(text => text.trim()); };
  const selected = page => page.locator('.targets-hub-tabs [aria-selected=true]').innerText().then(text => text.trim());
  const ready = page => page.locator('.targets-hub-panel').waitFor();
  const fetchAnswer = (page, url, body) => page.evaluate(async ([url, body]) => { const response = await fetch(url, {credentials: 'same-origin', ...(body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {})}); const data = await response.json().catch(() => ({})); return [response.status, data.error || '', data]; }, [url, body]);
  const editMember = async (page, name, english = false) => {
    await page.getByRole('row').filter({has: page.locator('strong', {hasText: new RegExp('^' + name + '$')})}).getByTitle(english ? 'Edit user' : 'تعديل المستخدم').click();
    await page.locator('[data-permission-matrix]').waitFor();
  };
  const sidebarPages = async page => { await page.locator('.app-sidebar .nav-item').first().waitFor(); await page.waitForTimeout(300); return (await page.locator('.app-sidebar .nav-item').allInnerTexts()).map(text => text.trim()); };

  // ---- 1. The administrator, desktop, Arabic: the tab rows in the supervisor's matrix.
  const admin = await open('owner', {url: '/#team'});
  await editMember(admin, 'المشرف سالم');
  const matrix = admin.locator('[data-permission-matrix]');
  const rows = await matrix.locator('tbody tr').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-matrix-row')));
  check(rows.slice(rows.indexOf('targets'), rows.indexOf('targets') + 5), ['targets', ...KEYS], 'the four tab rows right under «المستهدفات وتقييم الأداء»');
  check(await Promise.all(KEYS.map(key => matrix.locator(`[data-matrix-row="${key}"] th`).innerText().then(text => text.replace('↲', '').trim()))), ['تبويب «نتائج الأداء»', 'تبويب «التحصيل»', 'تبويب «عروض الأسعار»', 'تبويب «المستهدفات والأوزان»'], 'named as the tabs');
  for (const key of KEYS) {
    check(await matrix.locator(`[data-cell="browse:${key}"] input`).isChecked(), true, key + ': «استعراض» ticked (nothing hidden by default)');
    check(await matrix.locator(`[data-matrix-row="${key}"] td`).evaluateAll(cells => cells.slice(2).map(cell => cell.textContent.trim())), ['—', '—', '—', '—', '—'], key + ': «—» for every other action');
  }
  ok((await matrix.locator('[data-matrix-row="targets"] [data-row-note]').innerText()).includes('«رفع المبيعات» يتبع «استعراض» في «المبيعات»'), 'the screen\'s note');
  // The screen's «استعراض» off: the tabs go with it (disabled); on again: free.
  const screenView = admin.getByRole('checkbox', {name: 'استعراض · المستهدفات وتقييم الأداء', exact: true});
  await screenView.uncheck();
  check(await matrix.locator('[data-cell="browse:targets.results"] input').isDisabled(), true, 'the screen hidden: its tabs disabled');
  ok((await matrix.locator('[data-matrix-row="targets.results"] [data-row-note]').innerText()).includes('الشاشة مخفية، فتُخفى تبويباتها معها'), 'and says why');
  await screenView.check();
  check(await matrix.locator('[data-cell="browse:targets.results"] input').isDisabled(), false, 'the screen shown: free again');
  check(await admin.locator('[data-save-permissions]').isDisabled(), true, 'back as saved: nothing to save');
  // Untick «نتائج الأداء» and «التحصيل».
  await admin.getByRole('checkbox', {name: 'استعراض · المستهدفات وتقييم الأداء · نتائج الأداء'}).uncheck();
  await admin.getByRole('checkbox', {name: 'استعراض · المستهدفات وتقييم الأداء · التحصيل'}).uncheck();
  check(await admin.getByRole('checkbox', {name: 'الكل · المستهدفات وتقييم الأداء', exact: true}).isChecked(), false, '«الكل» of the screen unticked while a tab is hidden');
  check(await admin.getByRole('checkbox', {name: 'الكل · المستهدفات وتقييم الأداء · التحصيل'}).isChecked(), false, '«الكل» of a tab row follows its «استعراض»');
  await matrix.locator('[data-matrix-row="targets"]').scrollIntoViewIfNeeded();
  await shot(admin, 'tabs-matrix-desktop-ar', false);
  await admin.locator('[data-save-permissions]').click();
  await admin.getByText('تم حفظ الصلاحيات').first().waitFor();
  check(await stored('sup'), ['targets.results', 'targets.collection'], 'stored: the two tabs');
  const audit = JSON.parse((await app.db.prepare("SELECT detail FROM crm_audit WHERE action='صلاحيات' AND record_id='sup'").first()).detail);
  check([audit.before.hidden, audit.after.hidden], [[], ['targets.results', 'targets.collection']], 'the «صلاحيات» history entry: before and after');
  await admin.context().close();

  // ---- 2. The supervisor, desktop, Arabic: the hub without the two tabs.
  let sup = await open('sup');
  await ready(sup);
  check(await tabs(sup), ['رفع المبيعات', 'عروض الأسعار', 'المستهدفات والأوزان'], 'the supervisor\'s hub: the three tabs left');
  check(await selected(sup), 'رفع المبيعات', 'the first tab shown is drawn in place of «نتائج الأداء»');
  await shot(sup, 'tabs-hub-desktop-ar', false);
  check(await fetchAnswer(sup, '/api/kpi-evidence/import').then(answer => answer.slice(0, 2)), [404, HIDDEN], 'the page\'s request of a hidden tab («التحصيل»): 404 with the hidden answer');
  check(await fetchAnswer(sup, '/api/sales?month=' + month + '&kpis=1').then(answer => [answer[0], answer[2].kpis !== null]), [200, true], 'the shared read still serves «عروض الأسعار»');
  await sup.locator('.targets-hub-tabs [role=tab]', {hasText: 'عروض الأسعار'}).click();
  await sup.locator('.kpi-evidence-panel').waitFor();
  check(await selected(sup), 'عروض الأسعار', '«عروض الأسعار» opens');
  check(new URL(sup.url()).searchParams.get('tab'), 'quotes', 'and the address keeps it');
  await sup.context().close();
  // The address names a hidden tab: the first shown is drawn, and the address names it.
  sup = await open('sup', {url: '/?tab=collection#targets'});
  await ready(sup);
  check(await selected(sup), 'رفع المبيعات', '?tab=collection (hidden): «رفع المبيعات» is drawn');
  await sup.waitForFunction(() => new URLSearchParams(location.search).get('tab') === 'sales');
  check(new URL(sup.url()).searchParams.get('tab'), 'sales', 'and the address names it');
  check(await sup.locator('.kpi-evidence-panel').count(), 0, 'nothing of «التحصيل» is drawn');
  await sup.context().close();
  // The browser remembers «نتائج الأداء» (chosen before it was hidden): the first shown is drawn; the memory is kept.
  sup = await open('sup', {remember: 'results'});
  await ready(sup);
  check(await selected(sup), 'رفع المبيعات', 'the remembered «نتائج الأداء» (hidden): «رفع المبيعات» is drawn');
  check([await sup.locator('.targets-overview').count(), await sup.locator('.targets-performance-summary, .kpi-workspace').count()], [0, 0], 'nothing of «نتائج الأداء» is drawn');
  check(await sup.evaluate(() => localStorage.getItem('yr-targets-tab:sup')), 'results', 'the browser keeps the member\'s choice for when the tab is shown again');
  await sup.context().close();

  // ---- 3. Every size, Arabic and English: the supervisor's hub and the administrator's matrix.
  for (const [label, viewport] of Object.entries(VIEWPORTS)) for (const english of [false, true]) {
    const lang = english ? 'en' : 'ar', expected = [1, 3, 4].map(index => TAB_NAMES[lang][index]);
    const page = await open('sup', {viewport, english});
    await ready(page);
    check(await tabs(page), expected, label + ' ' + lang + ': the three tabs');
    check(await selected(page), expected[0], label + ' ' + lang + ': «' + expected[0] + '» drawn');
    await noSideways(page, label + ' ' + lang + ' hub');
    if (english) check(arabicLeft(await page.locator('.targets-hub').innerText()), [], label + ': no Arabic left in the hub\'s card');
    await page.evaluate(() => scrollTo(0, 0));
    await shot(page, `tabs-hub-${label}-${lang}`, false);
    await page.context().close();
    const team = await open('owner', {viewport, english, url: '/#team'});
    await editMember(team, 'المشرف سالم', english);
    const box = team.locator('[data-permission-matrix]');
    check(await box.locator('[data-matrix-row^="targets."]').count(), 4, label + ' ' + lang + ': the four tab rows');
    check(await Promise.all(['targets.results', 'targets.collection', 'targets.quotes', 'targets.targets'].map(key => box.locator(`[data-cell="browse:${key}"] input`).isChecked())), [false, false, true, true], label + ' ' + lang + ': as saved');
    if (english) {
      check(await Promise.all(KEYS.map(key => box.locator(`[data-matrix-row="${key}"] th`).innerText().then(text => text.replace('↲', '').trim()))), ['Tab «Performance results»', 'Tab «Collection»', 'Tab «Quotations»', 'Tab «Targets & weights»'], label + ': the rows in English');
      check(arabicLeft(await box.locator('[data-matrix-row^="targets"]').allInnerTexts().then(texts => texts.join('\n'))), [], label + ': no Arabic left in the targets rows');
    }
    await noSideways(team, label + ' ' + lang + ' matrix (the table scrolls inside its own box)');
    await box.locator('[data-matrix-row="targets.results"]').scrollIntoViewIfNeeded();
    await shot(team, `tabs-matrix-${label}-${lang}`, false);
    await team.context().close();
  }

  // ---- 4. Every tab hidden: the page keeps «رفع المبيعات»; with «المبيعات» hidden too, it goes from the menus.
  await saveHidden('sup', KEYS);
  sup = await open('sup');
  await ready(sup);
  check(await tabs(sup), ['رفع المبيعات'], 'every tab hidden, «المبيعات» shown: «رفع المبيعات» only');
  ok((await sidebarPages(sup)).includes('المستهدفات وتقييم الأداء'), 'and the page stays in the menu');
  await shot(sup, 'tabs-hub-only-sales-desktop-ar', false);
  await sup.context().close();
  await saveHidden('sup', ['sales', ...KEYS]);
  sup = await open('sup', {url: '/#dashboard'});
  const pages = await sidebarPages(sup);
  ok(!pages.includes('المستهدفات وتقييم الأداء') && !pages.includes('المبيعات'), 'every tab and «المبيعات» hidden: neither in the sidebar: ' + pages.join(' | '));
  await sup.goto(app.origin + '/#targets');await sup.locator('.topbar').waitFor();await sup.waitForTimeout(800);
  check(await sup.locator('.targets-hub').count(), 0, '#targets opens another page');
  ok(!(await sup.locator('.topbar .breadcrumb strong').innerText()).includes('المستهدفات'), 'the page shown is another one (as for any hidden screen)');
  check(await fetchAnswer(sup, '/api/sales?month=' + month).then(answer => answer.slice(0, 2)), [404, HIDDEN], 'its read answers 404');
  await shot(sup, 'tabs-page-gone-desktop-ar', false);
  await sup.context().close();
  const phone = await open('sup', {viewport: VIEWPORTS.phone360, english: true, url: '/#dashboard'});
  await phone.locator('.mobile-bottom-navigation').waitFor();
  const more = phone.getByRole('button', {name: 'More pages'});
  if (await more.count()) { await more.click(); await phone.locator('.mobile-overflow-pages').waitFor(); }
  check(await phone.locator('[data-page="targets"]').count(), 0, 'the phone (English): neither a tab nor in «More»');
  await noSideways(phone, 'phone 360 en, the page gone');
  await shot(phone, 'tabs-page-gone-phone360-en', false);
  await phone.context().close();
  // Shown again: the five tabs.
  await saveHidden('sup', []);
  sup = await open('sup');
  await ready(sup);
  check(await tabs(sup), TAB_NAMES.ar, 'everything shown again: the five tabs');
  await sup.context().close();
  check(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks, screenshots, syntheticFixtures: true, productionDataUsed: false}));
} finally {
  await browser?.close();
  await app?.stop();
}
