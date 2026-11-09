// «الصلاحيات» in a real Chromium against the BUILT release (run the build first). The supervisor, the sales manager and the representative
// open their pages first (release day: «المبيعات» in the supervisor's navigation; «حذف» off for everyone but the administrator, so no «حذف
// السجل» on a customer's sheet for the manager and no «حذف» on the representative's own visit). The administrator, on the desktop in Arabic,
// opens the supervisor in «الفريق والصلاحيات», reads the matrix («الكل», «—», «*», the delete cells unticked), unticks «استعراض» of
// «المبيعات» and saves; opens the sales manager, tries «انسخ الصلاحيات من» (what was not copied is listed), undoes it, ticks «حذف» of
// «العملاء» and saves; opens the representative and ticks «حذف» of «الزيارات». After a refresh: the supervisor's sidebar (desktop, Arabic)
// and «المزيد» (phone 360, English) no longer list «المبيعات», #sales opens another page and the server answers its requests 404; the
// manager's customer sheet (phone, Arabic and English) has «حذف السجل»; the representative (phone, Arabic) sees «حذف» on their own visit
// and deletes it, and in English sees «Delete» on their other visit; the supervisor, never granted, is refused (403, with its message). No
// horizontal page scroll on the phone. Screenshots for the report. Synthetic fixtures only: temporary SQLite, mocked sendmail, no
// production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [{id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'مدير المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'sm', name: 'المشرف سالم'}, {id: 'rep', role: 'rep', sup: 'sup', region: 'central', name: 'مندوب الوسطى'}, {id: 'rep2', role: 'rep', sup: 'sup', region: 'central', name: 'مندوب تاني'}];
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
  // Visits on another customer (so the first stays deletable): two by the representative, one by another representative.
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('perm-visits','customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')")
    .bind(JSON.stringify({name: 'مصنع الزيارات', branch: 'الرئيسي', assignedTo: 'rep', region: 'الوسطى', city: 'الرياض', customerStatus: 'نشط', phone: '0551234568', contact: 'م', code: ''}), now, now).run();
  const day = now.slice(0, 10);
  for (const [id, author, summary] of [['perm-visit-1', 'rep', 'زيارة المندوب الأولى'], ['perm-visit-2', 'rep', 'زيارة المندوب التانية'], ['perm-visit-3', 'rep2', 'زيارة مندوب تاني']])
    await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'activity','perm-visits',?,'الرئيسي',?,?,?,1,'fixture')")
      .bind(id, author, JSON.stringify({visitWorkflow: 'customer-v1', type: 'call', date: day, summary, result: 'متابعة العميل', nextAction: 'اتصال', nextDate: day, salesStage: 'new', strength: 'medium', requestedProducts: [], performedBy: author, responsibleId: author, recordedByEmail: author + '@yourrest.org'}), now, now).run();
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});
  async function open(memberId, {english = false, viewport = PHONE, hash = 'customer'} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block'});
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    if (english) await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    // A representative uses the Android app: its bridge, as a set-up phone (scripts/lib/native-bridge.mjs).
    const member = members.find(m => m.id === memberId);
    if (member.role === 'rep') await installNativeBridge(context, {memberId, regionScope: member.region || 'all'});
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
  check(await sheetDelete(smPhone, 'ar'), 0, 'release day: «حذف» is off, no «حذف السجل» on the manager\'s customer sheet');
  await shot(smPhone, 'permissions-manager-before-ar');
  await smPhone.keyboard.press('Escape');
  // The visit cards with «حذف»: the page shows its saved copy first and then the server's answer, so the count is read once it settles on
  // what is expected (or after 10 s, when the check reports what is there).
  const visitDeletes = async (page, expected) => {
    await page.locator('.rep-record-actions').first().waitFor();
    const cards = page.locator('.rep-record-actions').filter({has: page.getByRole('button', {name: /^(حذف الزيارة|Delete visit)$/})});
    for (let tries = 0; tries < 40 && await cards.count() !== expected; tries++) await page.waitForTimeout(250);
    if (expected === 0) await page.waitForTimeout(1000);
    return cards.count();
  };
  const repPhone = await open('rep', {hash: 'activity'});
  check(await visitDeletes(repPhone, 0), 0, 'release day: the representative has no «حذف» on their visits');

  // ---- 2. The administrator, on the desktop in Arabic.
  const admin = await open('owner', {viewport: DESKTOP, hash: 'team'});
  const editMember = async name => { await admin.getByRole('row').filter({has: admin.locator('strong', {hasText: new RegExp('^' + name + '$')})}).getByTitle('تعديل المستخدم').click(); await admin.locator('[data-permission-matrix]').waitFor(); };
  await editMember('المشرف سالم');
  const matrix = admin.locator('[data-permission-matrix]');
  check(await matrix.locator('thead th').allInnerTexts(), ['الشاشة', 'الكل', 'استعراض', 'إضافة', 'تحرير', 'حذف', 'تصدير', 'استيراد'], 'the columns');
  ok((await matrix.locator('[data-cell="customer:import"]').innerText()).includes('—'), '«—»: the supervisor does not import customers');
  check([await matrix.locator('[data-cell="customer:delete"] input').count(), await admin.getByRole('checkbox', {name: 'حذف · العملاء'}).isChecked(), await admin.getByRole('checkbox', {name: 'حذف · الزيارات'}).isChecked()], [1, false, false], '«حذف»: grantable to the supervisor, unticked by default');
  ok((await matrix.locator('[data-cell="activity:delete"]').innerText()).includes('*'), '«*»: a cell with a note');
  check(await admin.locator('[data-permission="viewAll"] input').isChecked(), false, '«عرض بيانات الفريق بالكامل» off by default');
  // «الكل» of «عروض الأسعار» takes the row off and on again.
  const all = admin.getByRole('checkbox', {name: 'الكل · عروض الأسعار'});
  check(await all.isChecked(), false, '«الكل» of «عروض الأسعار» unticked: its «حذف» is off by default');
  await all.check();
  check(await admin.getByRole('checkbox', {name: 'حذف · عروض الأسعار'}).isChecked(), true, '«الكل» ticks the row, «حذف» included');
  await all.uncheck();
  check(await admin.getByRole('checkbox', {name: 'إضافة · عروض الأسعار'}).isChecked(), false, '«الكل» unticked the row');
  await all.check();
  check(await admin.getByRole('checkbox', {name: 'تصدير · عروض الأسعار'}).isChecked(), true, 'and ticked it again');
  await admin.getByRole('checkbox', {name: 'حذف · عروض الأسعار'}).uncheck();
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
  check([await admin.getByRole('checkbox', {name: 'استعراض · المبيعات'}).isChecked(), await admin.getByRole('checkbox', {name: 'حذف · العملاء'}).isChecked(), await admin.getByRole('checkbox', {name: 'استيراد · العملاء'}).isChecked()], [false, false, false], 'the copy hid «المبيعات» as the supervisor\'s, «حذف» as theirs (off), and what a supervisor does not do comes over off');
  await shot(admin, 'permissions-admin-copy-ar');
  await admin.getByRole('button', {name: 'تراجع عن التغييرات'}).click();
  check(await admin.getByRole('checkbox', {name: 'استعراض · المبيعات'}).isChecked(), true, 'undone');
  check(await admin.getByRole('checkbox', {name: 'حذف · العملاء'}).isChecked(), false, 'the manager\'s «حذف» unticked by default');
  await admin.getByRole('checkbox', {name: 'حذف · العملاء'}).check();
  await admin.locator('[data-save-permissions]').click();
  await admin.getByText('تم حفظ الصلاحيات').first().waitFor();
  await shot(admin, 'permissions-admin-manager-ar');
  await admin.keyboard.press('Escape');
  await admin.locator('[data-permission-matrix]').waitFor({state: 'detached'});
  // The representative: «حذف» of «الزيارات» ticked.
  await editMember('مندوب الوسطى');
  check(await admin.getByRole('checkbox', {name: 'حذف · الزيارات'}).isChecked(), false, 'the representative\'s «حذف» on visits: shown, unticked');
  ok((await matrix.locator('[data-cell="activity:delete"]').getAttribute('title')).includes('للمندوب: زياراته ومتابعاته هو بس'), 'its note gives the representative\'s scope');
  await admin.getByRole('checkbox', {name: 'حذف · الزيارات'}).check();
  await admin.locator('[data-save-permissions]').click();
  await admin.getByText('تم حفظ الصلاحيات').first().waitFor();
  await shot(admin, 'permissions-admin-rep-ar');
  check(await app.db.prepare('SELECT COUNT(*) n FROM crm_member_permissions').first().then(row => Number(row.n)), 3, 'three saved rows');
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

  // ---- 4. The manager after a refresh (phone, Arabic and English): «حذف السجل» granted.
  await smPhone.reload();await smPhone.locator('.topbar').waitFor();
  check(await sheetDelete(smPhone, 'ar'), 1, 'after: «حذف السجل» on the sheet');
  await shot(smPhone, 'permissions-manager-after-ar');
  await noSideways(smPhone, 'manager phone');
  await smPhone.context().close();
  const smEnglish = await open('sm', {english: true, hash: 'customer'});
  check(await sheetDelete(smEnglish, 'en'), 1, 'English: «Delete record» too');
  await shot(smEnglish, 'permissions-manager-after-en');
  await smEnglish.context().close();
  // The supervisor, never granted, is refused by the server with its message (an old page or a direct request).
  const supCheck = await open('sup', {hash: 'customer'});
  const version = (await app.db.prepare("SELECT version FROM crm_records WHERE id='perm-visit-2'").first()).version;
  check(await fetchStatus(supCheck, '/api/crm', {action: 'delete', kind: 'activity', id: 'perm-visit-2', version}), [403, 'مش مسموح لك بالحذف في الزيارات. راجع مدير النظام.'], 'the supervisor\'s delete is refused with its message');
  await supCheck.context().close();

  // ---- 5. The representative after a refresh (phone, Arabic): «حذف» on their own visits only; deleting one.
  await repPhone.reload();await repPhone.locator('.topbar').waitFor();
  check(await visitDeletes(repPhone, 2), 2, 'after: «حذف» on each of their two visits');
  ok(!(await repPhone.locator('body').innerText()).includes('زيارة مندوب تاني'), 'another representative\'s visit is not on their page');
  await shot(repPhone, 'permissions-rep-visits-ar');
  await repPhone.locator('.rep-record-actions').filter({has: repPhone.getByRole('button', {name: 'حذف الزيارة'})}).first().getByRole('button', {name: 'حذف الزيارة'}).click();
  await repPhone.getByRole('alertdialog').getByRole('button', {name: 'حذف السجل'}).click();
  await repPhone.getByText('تم حذف السجل').first().waitFor();
  check(await app.db.prepare("SELECT COUNT(*) n FROM crm_records WHERE id IN ('perm-visit-1','perm-visit-2')").first().then(row => Number(row.n)), 1, 'one of their visits deleted');
  check(await app.db.prepare("SELECT COUNT(*) n FROM crm_records WHERE id='perm-visit-3'").first().then(row => Number(row.n)), 1, 'the other representative\'s visit kept');
  check(await app.db.prepare("SELECT COUNT(*) n FROM crm_audit WHERE action='حذف' AND json_extract(detail,'$.deletedBy')='rep'").first().then(row => Number(row.n)), 1, 'with its «حذف» entry for the administrator\'s «المحذوفات»');
  check(await visitDeletes(repPhone, 1), 1, 'the remaining visit keeps its «حذف»');
  await noSideways(repPhone, 'representative phone');
  await shot(repPhone, 'permissions-rep-deleted-ar');
  await repPhone.context().close();
  const repEnglish = await open('rep', {english: true, hash: 'activity'});
  check(await visitDeletes(repEnglish, 1), 1, 'English: «Delete visit» on their remaining visit');
  await shot(repEnglish, 'permissions-rep-visits-en');
  await repEnglish.context().close();

  ok(!errors.length, 'no uncaught page errors: ' + errors.join(' | '));
  console.log(JSON.stringify({ok: true, checks, screenshots, realChromium: true, syntheticFixtures: true}));
} finally {
  await browser?.close(); await app?.stop();
}
