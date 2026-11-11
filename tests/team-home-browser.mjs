// «عملاء واقفين» and «فريقي اليوم» in a real Chromium against the BUILT release (run the build first). A representative (the Android
// app emulated, a 360 px phone, Arabic then English) finds the card on their first screen and the badge on «العملاء»; «اعرضهم» opens
// the customers page with «لم يشترِ منذ 60 يومًا» and «عملائي فقط» on, listing exactly their stalled customers (not another
// representative's in the same region); «مسح الفلاتر» clears both. A supervisor (a computer, Arabic) sees the team card per
// representative and «فريقي اليوم» with one representative not started and one with a visit and an unread note, no badge on
// «العملاء»; a name opens the customers page filtered to that representative, «تقرير اليوم» opens the day report on that
// representative; the day report links back. The same on a 360 px phone in English. Nothing scrolls sideways at 360 px; every tap
// target is at least 44 px high on the phone. Screenshots for the report. Synthetic fixtures only: temporary SQLite, mocked sendmail.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [{id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'مدير المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'sm', region: 'central', name: 'المشرف سالم'},
  {id: 'rep', role: 'rep', sup: 'sup', region: 'central', name: 'مندوب الوسطى'}, {id: 'rep2', role: 'rep', sup: 'sup', region: 'central', name: 'مندوب ثاني'}];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-team-home-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1280, height: 900};
const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
const day = back => new Date(Date.parse(today + 'T00:00:00Z') - back * 86400000).toISOString().slice(0, 10);
const OLD = 'مصنع اشترى من زمان', NEVER = 'مصنع لم يشتر', RECENT = 'مصنع اشترى قريبا', OTHER = 'مصنع المندوب الثاني', OTHER_RECENT = 'مصنع الثاني الحديث';

try {
  app = await bootBuiltApp({members}, {tls: true});
  const now = new Date().toISOString();
  const insert = (id, kind, parent, assignedTo, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, kind, parent, assignedTo, JSON.stringify(data), now, now).run();
  const customer = (id, name, assignedTo, data = {}) => insert(id, 'customer', null, assignedTo, {name, branch: 'الرئيسي', assignedTo, region: 'الوسطى', city: 'الرياض', customerStatus: 'نشط', phone: '0551234567', contact: 'م', code: '', location: '24.71, 46.67', ...data});
  await customer('old', OLD, 'rep', {code: 'C-1'}); await customer('never', NEVER, 'rep'); await customer('recent', RECENT, 'rep', {code: 'C-2'});
  await customer('other', OTHER, 'rep2'); await customer('other-recent', OTHER_RECENT, 'rep2', {code: 'C-3'});
  await app.db.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('imp','owner','f','sales.xml','{}',?)").bind(now).run();
  let n = 0;
  const erp = (code, date) => app.db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'h','h',?,'sale',?,'e1','rep','الرئيسي','all',?,'n','{}',10000,'imp','owner',?)")
    .bind('erp-' + (++n), 'doc-' + n, 'INV-' + n, date, code, now).run();
  await erp('C-1', day(61)); await erp('C-2', day(5)); await erp('C-3', day(2));
  // Today: the representative visited one customer; the supervisor noted it (not read yet). rep2 did nothing.
  await insert('visit-today', 'activity', 'recent', 'rep', {type: 'visit', date: today, summary: 'تعريف بالمنتجات', result: 'العميل مهتم', performedBy: 'rep', responsibleId: 'rep', recordedByEmail: 'rep@yourrest.org'});
  await app.db.prepare("INSERT INTO crm_daily_entry_reviews(activity_id,member_id,date,result,action,reviewed_by,version,mutation_id,created_at,updated_at) VALUES('visit-today','rep',?,'زيارة جيدة','جهّز عرض السعر','sup',1,'fixture-note',?,?)").bind(today, now, now).run();
  const {scope} = await app.db.prepare('SELECT region_scope AS scope FROM crm_members WHERE id=?').bind('rep').first();
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});

  async function open(memberId, {english = false, viewport = PHONE, hash = ''} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: viewport === PHONE, geolocation: {latitude: 24.7136, longitude: 46.6753, accuracy: 8}, permissions: ['geolocation']});
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    if (english) await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (memberId.startsWith('rep')) await installNativeBridge(page, {memberId, regionScope: scope});
    await page.goto(app.origin + '/' + hash);
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    return page;
  }
  const shot = async (page, label) => { await page.waitForTimeout(250); await page.screenshot({path: path.join(screenshots, label + '.png'), fullPage: true}); };
  const noSideways = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scrolling');
  const names = async page => (await page.locator('.customer-mobile-card .customer-mobile-name h3').allInnerTexts()).map(text => text.trim()).sort();
  const filterBadge = async page => { const b = page.locator('.mobile-filter-toggle b'); return await b.count() ? (await b.innerText()).trim() : null; };
  const tall = async (locator, label) => check(await locator.evaluateAll(items => items.filter(item => item.getBoundingClientRect().height && item.getBoundingClientRect().height < 44).length), 0, label + ': every tap target at least 44 px high');

  // ---- 1. The representative on the phone app, Arabic.
  const rep = await open('rep');
  const own = rep.locator('[data-inactive-card="own"]');
  await own.waitFor();
  check((await own.locator('[data-inactive-count]').innerText()).trim(), '2', 'the representative\'s card: two of their customers (61 days and never; the recent one and rep2\'s are not theirs or not stalled)');
  ok((await own.innerText()).includes('عملاؤك الذين لم يشتروا منذ 60 يوم'), 'in Egyptian Arabic');
  check((await rep.locator('.mobile-bottom-navigation [data-page="customer"] [data-inactive-badge]').innerText()).trim(), '2', 'the badge on «العملاء» in the bottom bar');
  check(await rep.locator('[data-team-today]').count(), 0, 'no «فريقي اليوم» for a representative');
  await tall(own.locator('button'), 'the representative\'s card');
  await noSideways(rep, 'the representative\'s first screen');
  await shot(rep, 'team-home-rep-card-ar-360');
  await own.locator('[data-inactive-open]').click();
  await rep.locator('.customer-mobile-card').first().waitFor();
  check(await names(rep), [OLD, NEVER].sort(), '«اعرضهم»: exactly their two stalled customers');
  check(await filterBadge(rep), '2', 'two filters counted: «لم يشترِ منذ 60 يومًا» and «عملائي فقط»');
  if (await rep.locator('#crm-page-filters').isHidden()) await rep.locator('.mobile-filter-toggle').click();
  check(await rep.locator('#crm-page-filters .inactive-customers-filter').getAttribute('aria-pressed'), 'true', 'the stalled filter is on');
  check(await rep.locator('#crm-page-filters .own-customers-filter').getAttribute('aria-pressed'), 'true', '«عملائي فقط» is on');
  await noSideways(rep, 'the filtered customers');
  await shot(rep, 'team-home-rep-customers-ar-360');
  await rep.locator('#crm-page-filters .own-customers-filter').click();
  await rep.waitForFunction(() => document.querySelectorAll('.customer-mobile-card').length === 3);
  check(await names(rep), [OLD, NEVER, OTHER].sort(), 'without «عملائي فقط»: their region\'s stalled customers, as the filter alone shows');
  await rep.locator('#crm-page-filters').getByRole('button', {name: 'مسح الفلاتر', exact: true}).click();
  await rep.waitForFunction(() => document.querySelectorAll('.customer-mobile-card').length === 5);
  check(await filterBadge(rep), null, '«مسح الفلاتر»: none counted');
  await rep.context().close();

  // ---- 2. The representative in English.
  const repEn = await open('rep', {english: true});
  const ownEn = repEn.locator('[data-inactive-card="own"]');
  await ownEn.waitFor();
  ok((await ownEn.innerText()).includes('Your customers with no purchase in 60 days'), 'English card');
  ok(!/[؀-ۿ]/.test(await ownEn.innerText()), 'no Arabic left in the English card');
  check(await repEn.locator('.mobile-bottom-navigation [data-page="customer"] [data-inactive-badge]').getAttribute('aria-label'), '2 of your customers have not bought in 60 days', 'the English badge words');
  await noSideways(repEn, 'English, the representative');
  await shot(repEn, 'team-home-rep-card-en-360');
  await ownEn.getByRole('button', {name: 'Show them'}).click();
  await repEn.locator('.customer-mobile-card').first().waitFor();
  check(await names(repEn), [OLD, NEVER].sort(), 'English: the same two');
  if (await repEn.locator('#crm-page-filters').isHidden()) await repEn.locator('.mobile-filter-toggle').click();
  ok((await repEn.locator('#crm-page-filters .own-customers-filter').innerText()).includes('My customers only'), 'English «My customers only»');
  await shot(repEn, 'team-home-rep-customers-en-360');
  await repEn.context().close();

  // ---- 3. The supervisor on a computer, Arabic.
  const sup = await open('sup', {viewport: DESKTOP, hash: '#dashboard'});
  const team = sup.locator('[data-inactive-card="team"]');
  await team.waitFor();
  check((await team.locator('[data-inactive-count]').innerText()).trim(), '3', 'the supervisor\'s team: three stalled customers');
  check(await team.locator('[data-inactive-member]').evaluateAll(items => items.map(item => [item.dataset.inactiveMember, item.querySelector('b').textContent.trim()])), [['rep', '2'], ['rep2', '1']], 'per representative, most first');
  check(await sup.locator('[data-inactive-badge]').count(), 0, 'no badge on «العملاء» for the supervisor');
  check(await team.evaluate(card => { const list = card.querySelector('.inactive-team-list').getBoundingClientRect(), box = card.getBoundingClientRect(); return Math.round(box.bottom - list.bottom); }) <= 20, true, 'the team card ends right under its names (no empty space)');
  check(await sup.locator('[data-team-today] tbody th').evaluateAll(cells => cells.every(cell => getComputedStyle(cell).fontWeight >= 600)), true, 'each name heads its row in bold, not in the column heads\' grey');
  const summary = sup.locator('[data-team-today]');
  await summary.locator('tr[data-member]').first().waitFor();
  check(await summary.locator('tr[data-member]').evaluateAll(rows => rows.map(row => [row.dataset.member, row.dataset.started])), [['rep2', 'no'], ['rep', 'yes']], '«فريقي اليوم»: rep2 not started first, then the representative who visited');
  check((await summary.locator('[data-team-today-totals]').innerText()).trim(), 'بدأوا 1 من 2 · زيارات 1 · ملاحظات غير مقروءة 1', 'the header totals');
  ok((await summary.locator('tr[data-member="rep2"]').innerText()).includes('لم يبدأ بعد'), '«لم يبدأ بعد»');
  check(await summary.locator('tr[data-member="rep"] [data-cell="visits"]').innerText(), '1', 'one visit today');
  check((await summary.locator('tr[data-member="rep"] [data-cell="notes"]').innerText()).trim(), '1', 'one unread note');
  ok((await summary.locator('tr[data-member="rep"] [data-cell="started"]').innerText()).includes('أول تسجيل'), 'started by the visit recorded');
  await shot(sup, 'team-home-supervisor-dashboard-ar-desktop');
  await team.locator('[data-inactive-member="rep2"]').click();
  await sup.locator('.customer-expand').first().waitFor();
  check(await sup.locator('.customer-expand strong').allInnerTexts().then(items => items.map(item => item.trim()).sort()), [OTHER], 'a name: the customers page with that representative\'s stalled customer');
  check(await sup.locator('.inactive-customers-filter').getAttribute('aria-pressed'), 'true', 'with «لم يشترِ منذ 60 يومًا» on');
  ok((await sup.locator('#crm-page-filters [role="combobox"]').allInnerTexts()).some(text => text.includes('مندوب ثاني')), 'and the representative chosen in «المندوب»');
  await shot(sup, 'team-home-supervisor-customers-ar-desktop');
  await sup.locator('.app-sidebar .nav-item').filter({hasText: 'لوحة المتابعة'}).click();
  await summary.locator('[data-team-today-report="rep"]').click();
  await sup.locator('.journey-report select').waitFor();
  await sup.waitForFunction(() => document.querySelector('.journey-report select')?.value === 'rep');
  check(await sup.locator('.journey-report select').inputValue(), 'rep', '«تقرير اليوم»: the day report opens on that representative');
  await sup.locator('.journey-overview, .journey-empty h2').first().waitFor();
  ok(await sup.locator('[data-team-today-link]').isVisible(), 'the day report links back to «فريقي اليوم»');
  await shot(sup, 'team-home-supervisor-day-report-ar-desktop');
  await sup.locator('[data-team-today-link]').click();
  await summary.waitFor();
  check(await sup.evaluate(() => location.hash), '#dashboard', 'back to the dashboard');
  await sup.context().close();

  // ---- 4. The supervisor on a 360 px phone, English.
  const supPhone = await open('sup', {english: true, hash: '#dashboard'});
  const phoneSummary = supPhone.locator('[data-team-today]');
  await phoneSummary.locator('tr[data-member]').first().waitFor();
  check((await phoneSummary.locator('[data-team-today-totals]').innerText()).trim(), 'Started 1 of 2 · Visits 1 · Unread notes 1', 'English totals');
  ok((await phoneSummary.locator('tr[data-member="rep2"]').innerText()).includes('Not started yet'), 'English «Not started yet»');
  ok((await supPhone.locator('[data-inactive-card="team"]').innerText()).includes('Stalled customers in your team: 3'), 'English team card');
  const english = (await supPhone.locator('[data-inactive-card="team"] h2, [data-inactive-card="team"] p, [data-team-today] h2, [data-team-today] thead, [data-team-today] td, [data-team-today-totals], .team-today-foot').allInnerTexts()).join(' ');
  ok(!/[؀-ۿ]/.test(english), 'no Arabic left in the English words (the names are data): ' + english.slice(0, 200));
  check(await phoneSummary.locator('thead').isVisible(), false, 'on a phone each row is a card (no table head)');
  await tall(supPhone.locator('[data-inactive-member], [data-team-today-report], [data-team-today-refresh]'), 'the supervisor\'s phone');
  await noSideways(supPhone, 'English, the supervisor\'s phone');
  await shot(supPhone, 'team-home-supervisor-dashboard-en-360');
  await supPhone.context().close();

  ok(!errors.length, 'no uncaught page errors: ' + errors.join(' | '));
  console.log(JSON.stringify({ok: true, checks, screenshots, realChromium: true, syntheticFixtures: true}));
} finally {
  await browser?.close(); await app?.stop();
}
