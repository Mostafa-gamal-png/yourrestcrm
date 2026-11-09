// «الصلاحيات» in a real Chromium against the BUILT release (run the build first). The supervisor and the sales manager open their pages
// first (release day: «المبيعات» in the supervisor's navigation, «حذف السجل» on a customer's sheet for the manager). The administrator, on
// the desktop in Arabic, opens the supervisor in «الفريق والصلاحيات», reads the matrix («الكل», «—», «*»), unticks «استعراض» of «المبيعات»
// and saves; opens the sales manager, tries «انسخ الصلاحيات من» (what was not copied is listed), undoes it, unticks «حذف» of «العملاء»
// and saves. After a refresh: the supervisor's sidebar (desktop, Arabic) and «المزيد» (phone 360, English) no longer list «المبيعات»,
// #sales opens another page and the server answers its requests 404; the manager's customer sheet (phone, Arabic and English) has no
// «حذف السجل» and the server refuses the delete (403, with its message). No horizontal page scroll on the phone. Screenshots for the
// report. Synthetic fixtures only: temporary SQLite, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [{id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'مدير المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'sm', name: 'المشرف سالم'}, {id: 'rep', role: 'rep', sup: 'sup', region: 'central', name: 'مندوب الوسطى'}];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-permissions-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1280, height: 900};
const FACTORY = 'مصنع الصلاحيات';

try {
  app = await bootBuiltApp({members}, {tls: true});
  const now = new Date().toISOString();
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('perm-customer','customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')")
    .bind(JSON.stringify({name: FACTORY, branch: 'الرئيسي', assignedTo: 'rep', region: 'الوسطى', city: 'الرياض', customerStatus: 'نشط', phone: '0551234567', contact: 'م', code: ''}), now, now).run();
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});
  async function open(memberId, {english = false, viewport = PHONE, hash = 'customer'} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block'});
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    if (english) await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    await page.goto(app.origin + '/#' + hash);
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('.topbar').waitFor();
    return page;
  }
  const shot = async (page, label) => { await page.waitForTimeout(300); await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const noSideways = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scrolling');
  const sidebarPages = async page => { await page.locator('.app-sidebar .nav-item').first().waitFor(); await page.waitForTimeout(300); return page.locator('.app-sidebar .nav-item').allInnerTexts(); };
  const fetchStatus = (page, url, init) => page.evaluate(async ([url, init]) => { const response = await fetch(url, {credentials: 'same-origin', ...(init ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(init)} : {})}); return [response.status, (await response.json()).error || '']; }, [url, init]);
  const sheetDelete = async (page, language) => {
    await page.locator('.customer-mobile-card').filter({has: page.locator('h3', {hasText: FACTORY})}).locator('.customer-mobile-name').click();
    await page.locator('.crm-sheet').waitFor();
    const count = await page.locator('.crm-sheet').getByTitle(language === 'en' ? 'Delete record' : 'حذف السجل').count();
    return count;
  };

  // ---- 1. Release day: what the supervisor and the manager have.
  const supDesk = await open('sup', {viewport: DESKTOP, hash: 'dashboard'});
  ok((await sidebarPages(supDesk)).some(text => text.includes('المبيعات')), 'before: «المبيعات» in the supervisor\'s sidebar');
  const smPhone = await open('sm', {hash: 'customer'});
  check(await sheetDelete(smPhone, 'ar'), 1, 'before: the manager has «حذف السجل» on the customer\'s sheet');
  await shot(smPhone, 'permissions-manager-before-ar');
  await smPhone.keyboard.press('Escape');

  // ---- 2. The administrator, on the desktop in Arabic.
  const admin = await open('owner', {viewport: DESKTOP, hash: 'team'});
  const editMember = async name => { await admin.getByRole('row').filter({has: admin.locator('strong', {hasText: new RegExp('^' + name + '$')})}).getByTitle('تعديل المستخدم').click(); await admin.locator('[data-permission-matrix]').waitFor(); };
  await editMember('المشرف سالم');
  const matrix = admin.locator('[data-permission-matrix]');
  check(await matrix.locator('thead th').allInnerTexts(), ['الشاشة', 'الكل', 'استعراض', 'إضافة', 'تحرير', 'حذف', 'تصدير', 'استيراد'], 'the columns');
  ok((await matrix.locator('[data-cell="customer:delete"]').innerText()).includes('—'), '«—»: the supervisor does not delete customers');
  ok((await matrix.locator('[data-cell="activity:delete"]').innerText()).includes('*'), '«*»: a cell with a note');
  check(await admin.locator('[data-permission="viewAll"] input').isChecked(), false, '«عرض بيانات الفريق بالكامل» off by default');
  // «الكل» of «عروض الأسعار» takes the row off and on again.
  const all = admin.getByRole('checkbox', {name: 'الكل · عروض الأسعار'});
  await all.uncheck();
  check(await admin.getByRole('checkbox', {name: 'إضافة · عروض الأسعار'}).isChecked(), false, '«الكل» unticked the row');
  await all.check();
  check(await admin.getByRole('checkbox', {name: 'تصدير · عروض الأسعار'}).isChecked(), true, 'and ticked it again');
  check(await admin.locator('[data-save-permissions]').isDisabled(), true, 'back as saved: nothing to save');
  await admin.getByRole('checkbox', {name: 'استعراض · المبيعات'}).uncheck();
  await shot(admin, 'permissions-admin-matrix-ar');
  await admin.locator('[data-save-permissions]').click();
  await admin.getByText('تم حفظ الصلاحيات').first().waitFor();
  await admin.keyboard.press('Escape');
  await admin.locator('[data-permission-matrix]').waitFor({state: 'detached'});
  // The sales manager: «انسخ الصلاحيات من» the supervisor, then undo; untick «حذف» of «العملاء».
  await editMember('مدير المبيعات');
  await admin.getByLabel('انسخ الصلاحيات من').selectOption({label: 'مدير النظام · مدير النظام'});
  const skipped = await admin.locator('[data-permissions-skipped]').innerText();
  ok(skipped.includes('الفريق والصلاحيات · إضافة') && skipped.includes('الشكاوى · إضافة'), 'copying the administrator lists what a sales manager\'s role cannot hold: ' + skipped);
  await admin.getByLabel('انسخ الصلاحيات من').selectOption({label: 'المشرف سالم · مشرف المبيعات'});
  check(await admin.locator('[data-permissions-skipped]').count(), 0, 'copying the supervisor skips nothing (the manager\'s role holds all of it)');
  check([await admin.getByRole('checkbox', {name: 'استعراض · المبيعات'}).isChecked(), await admin.getByRole('checkbox', {name: 'حذف · العملاء'}).isChecked()], [false, false], 'the copy hid «المبيعات» as the supervisor\'s, and what a supervisor does not do comes over off');
  await shot(admin, 'permissions-admin-copy-ar');
  await admin.getByRole('button', {name: 'تراجع عن التغييرات'}).click();
  check(await admin.getByRole('checkbox', {name: 'استعراض · المبيعات'}).isChecked(), true, 'undone');
  await admin.getByRole('checkbox', {name: 'حذف · العملاء'}).uncheck();
  await admin.locator('[data-save-permissions]').click();
  await admin.getByText('تم حفظ الصلاحيات').first().waitFor();
  await shot(admin, 'permissions-admin-manager-ar');
  check(await app.db.prepare('SELECT COUNT(*) n FROM crm_member_permissions').first().then(row => Number(row.n)), 2, 'two saved rows');
  check(await app.db.prepare('SELECT auth_version v FROM crm_members WHERE id=?').bind('sup').first().then(row => row.v), 1, 'nobody was signed out');
  await admin.context().close();

  // ---- 3. After a refresh: the supervisor (desktop, Arabic; phone, English).
  await supDesk.reload();await supDesk.locator('.topbar').waitFor();
  ok(!(await sidebarPages(supDesk)).some(text => text.includes('المبيعات')), 'after: no «المبيعات» in the sidebar');
  ok((await sidebarPages(supDesk)).some(text => text.includes('المستهدفات')), 'the other screens stay');
  check(await fetchStatus(supDesk, '/api/sales/import'), [404, 'هذا الجزء غير متاح لحسابك. راجع مدير النظام.'], 'the server answers the hidden screen\'s requests 404');
  await supDesk.goto(app.origin + '/#sales');await supDesk.locator('.topbar').waitFor();
  ok(!(await supDesk.locator('.topbar .breadcrumb strong').innerText()).includes('المبيعات'), '#sales opens another page');
  await shot(supDesk, 'permissions-supervisor-desktop-ar');
  await supDesk.context().close();
  const supPhone = await open('sup', {english: true, hash: 'dashboard'});
  await supPhone.getByRole('button', {name: 'More pages', exact: true}).click();
  const pages = await supPhone.locator('.mobile-overflow-pages button, .mobile-bottom-navigation button').evaluateAll(buttons => buttons.map(button => button.getAttribute('data-page')).filter(Boolean));
  ok(!pages.includes('sales') && pages.includes('targets'), 'phone, English: «Sales» neither a tab nor in «More»: ' + pages.join(','));
  await noSideways(supPhone, 'supervisor phone');
  await shot(supPhone, 'permissions-supervisor-phone-en');
  await supPhone.context().close();

  // ---- 4. The manager after a refresh (phone, Arabic and English): no «حذف السجل»; the server refuses the delete.
  await smPhone.reload();await smPhone.locator('.topbar').waitFor();
  check(await sheetDelete(smPhone, 'ar'), 0, 'after: no «حذف السجل» on the sheet');
  await shot(smPhone, 'permissions-manager-after-ar');
  const version = (await app.db.prepare("SELECT version FROM crm_records WHERE id='perm-customer'").first()).version;
  check(await fetchStatus(smPhone, '/api/crm', {action: 'delete', kind: 'customer', id: 'perm-customer', version}), [403, 'مش مسموح لك بالحذف في العملاء. راجع مدير النظام.'], 'the server refuses the delete with its message');
  check(await app.db.prepare("SELECT COUNT(*) n FROM crm_records WHERE id='perm-customer'").first().then(row => Number(row.n)), 1, 'the customer is kept');
  await noSideways(smPhone, 'manager phone');
  await smPhone.context().close();
  const smEnglish = await open('sm', {english: true, hash: 'customer'});
  check(await sheetDelete(smEnglish, 'en'), 0, 'English: no «Delete record» either');
  ok(await smEnglish.locator('.crm-sheet').getByRole('button', {name: 'Edit'}).count() > 0, 'editing the customer stays');
  await shot(smEnglish, 'permissions-manager-after-en');
  await smEnglish.context().close();

  ok(!errors.length, 'no uncaught page errors: ' + errors.join(' | '));
  console.log(JSON.stringify({ok: true, checks, screenshots, realChromium: true, syntheticFixtures: true}));
} finally {
  await browser?.close(); await app?.stop();
}
