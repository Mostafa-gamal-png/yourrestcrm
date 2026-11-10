// «المحذوفات» for whoever was granted «حذف» (the owner, 2026-11-10), in a real Chromium against the BUILT release (run the build first).
// The administrator, on the desktop in Arabic, opens the representative in «الفريق والصلاحيات»: the matrix has the «المحذوفات» row with its
// note («لمن عنده «حذف»: اللي حذفه هو بس»); ticks «حذف» of «الزيارات» and saves. The representative, on a 360 px phone in Arabic (the
// Android app's bridge), deletes their own visit (the confirmation says it can be restored from «المحذوفات»), opens «المزيد» → «المحذوفات»,
// finds only their own deletion, restores it, and the visit is back in «الزيارات»; on the desktop in English the same from the sidebar
// («Deleted records»). Another representative, never granted, has no «المحذوفات» in «المزيد» and GET /api/trash answers 404. A sales manager
// granted «حذف» with «المحذوفات» hidden reads that the administrator can restore it. The administrator's matrix in English on the phone. No
// horizontal page scroll on the phone. Screenshots for the report. Synthetic fixtures only: temporary SQLite, mocked sendmail, no production
// data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [{id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'مدير المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'sm', name: 'المشرف'}, {id: 'rep', role: 'rep', sup: 'sup', region: 'central', name: 'مندوب الوسطى'}, {id: 'rep2', role: 'rep', sup: 'sup', region: 'central', name: 'مندوب تاني'}];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-trash-own-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1280, height: 900};
const ARABIC = 'زيارة المندوب للاسترجاع', ENGLISH = 'زيارة المندوب على الكمبيوتر', OTHER = 'زيارة مندوب تاني', FACTORY = 'مصنع المحذوفات';

try {
  app = await bootBuiltApp({members}, {tls: true});
  const now = new Date().toISOString(), day = now.slice(0, 10);
  const customer = (id, name, assignedTo) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, assignedTo, JSON.stringify({name, branch: 'الرئيسي', assignedTo, region: 'الوسطى', city: 'الرياض', customerStatus: 'نشط', phone: '0551234567', contact: 'م', code: ''}), now, now).run();
  await customer('trash-visits', FACTORY, 'rep'); await customer('manager-customer', 'مصنع المدير', 'rep');
  for (const [id, author, summary] of [['own-ar', 'rep', ARABIC], ['own-en', 'rep', ENGLISH], ['other', 'rep2', OTHER]])
    await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'activity','trash-visits',?,'الرئيسي',?,?,?,1,'fixture')")
      .bind(id, author, JSON.stringify({visitWorkflow: 'customer-v1', type: 'call', date: day, summary, result: 'متابعة العميل', nextAction: 'اتصال', nextDate: day, salesStage: 'new', strength: 'medium', requestedProducts: [], performedBy: author, responsibleId: author, recordedByEmail: author + '@yourrest.org'}), now, now).run();
  // The sales manager: «حذف» on customers, «المحذوفات» hidden (to read the other words of the confirmation).
  await app.db.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('sm','{\"customer:delete\":true}','[\"trash\"]',1,'owner',?)").bind(now).run();
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});
  async function open(memberId, {english = false, viewport = PHONE, hash = 'activity'} = {}) {
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
  const fetchStatus = (page, url) => page.evaluate(async url => { const response = await fetch(url, {credentials: 'same-origin'}); return [response.status, (await response.json()).error || '']; }, url);
  const morePages = async (page, label) => {
    await page.getByRole('button', {name: label, exact: true}).click();
    await page.locator('.mobile-overflow-pages').waitFor();
    return page.locator('.mobile-overflow-pages button').evaluateAll(buttons => buttons.map(button => button.getAttribute('data-page')));
  };
  const deletions = id => app.db.prepare("SELECT COUNT(*) n FROM crm_audit WHERE action='حذف' AND record_id=?").bind(id).first().then(row => Number(row.n));
  const exists = id => app.db.prepare('SELECT COUNT(*) n FROM crm_records WHERE id=?').bind(id).first().then(row => Number(row.n) === 1);

  // ---- 1. Before: the representative has neither «حذف» nor «المحذوفات».
  const before = await open('rep');
  ok(!(await morePages(before, 'المزيد من الصفحات')).includes('trash'), 'before: no «المحذوفات» in «المزيد»');
  check(await fetchStatus(before, '/api/trash'), [404, 'هذا الجزء غير متاح لحسابك. راجع مدير النظام.'], 'before: GET /api/trash 404');
  await before.context().close();

  // ---- 2. The administrator (desktop, Arabic) grants the representative «حذف» on «الزيارات».
  const admin = await open('owner', {viewport: DESKTOP, hash: 'team'});
  await admin.getByRole('row').filter({has: admin.locator('strong', {hasText: /^مندوب الوسطى$/})}).getByTitle('تعديل المستخدم').click();
  const matrix = admin.locator('[data-permission-matrix]');
  await matrix.waitFor();
  check((await matrix.locator('[data-matrix-row="trash"] [data-row-note]').innerText()).trim(), 'لمن عنده «حذف»: اللي حذفه هو بس', 'the matrix: «المحذوفات» for a representative, with its note');
  check([await admin.getByRole('checkbox', {name: 'استعراض · المحذوفات'}).isChecked(), await admin.getByRole('checkbox', {name: 'تحرير · المحذوفات'}).isChecked()], [true, true], '«استعراض» and «تحرير» of «المحذوفات» on (restrict-only)');
  check(await admin.getByRole('checkbox', {name: 'حذف · الزيارات'}).isChecked(), false, '«حذف» of visits unticked by default');
  await admin.getByRole('checkbox', {name: 'حذف · الزيارات'}).check();
  await matrix.locator('[data-matrix-row="trash"]').scrollIntoViewIfNeeded();
  await shot(admin, 'trash-own-admin-grant-ar');
  await admin.locator('[data-save-permissions]').click();
  await admin.getByText('تم حفظ الصلاحيات').first().waitFor();
  await admin.context().close();

  // ---- 3. The representative on the phone, in Arabic: delete their own visit, restore it from «المحذوفات».
  const phone = await open('rep');
  const card = phone.locator('.rep-record-card').filter({hasText: ARABIC});
  await card.getByRole('button', {name: 'حذف الزيارة'}).click();
  const dialog = phone.getByRole('alertdialog');
  ok((await dialog.innerText()).includes('يمكن استرجاعه لاحقًا من «المحذوفات».'), 'the confirmation says it can be restored from «المحذوفات»');
  await shot(phone, 'trash-own-rep-confirm-ar');
  await dialog.getByRole('button', {name: 'حذف السجل', exact: true}).click();
  await phone.getByText('تم حذف السجل').first().waitFor();
  await card.waitFor({state: 'detached'});
  check([await exists('own-ar'), await deletions('own-ar')], [false, 1], 'deleted, with its «حذف» entry');
  const pages = await morePages(phone, 'المزيد من الصفحات');
  ok(pages.includes('trash'), '«المحذوفات» in «المزيد» now: ' + pages.join(','));
  await phone.locator('.mobile-overflow-pages button[data-page="trash"]').click();
  await phone.locator('.trash-card').first().waitFor();
  check((await phone.locator('.topbar .breadcrumb strong').innerText()).trim(), 'المحذوفات', 'the page title');
  check(await phone.locator('.trash-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-record'))), ['own-ar'], 'their own deletion only');
  const entry = phone.locator('.trash-card[data-record="own-ar"]');
  const text = await entry.innerText();
  ok(text.includes(ARABIC) && text.includes('زيارة') && text.includes('حذفه: مندوب الوسطى') && text.includes(FACTORY), 'the card: type, the visit, its customer, who deleted it: ' + text);
  ok((await phone.locator('.trash-intro').innerText()).includes('السجلات اللي انت حذفتها'), 'the intro: the records they deleted');
  const restoreButton = entry.getByRole('button', {name: 'استرجاع ' + ARABIC});
  check([await restoreButton.isDisabled(), await restoreButton.evaluate(button => button.getBoundingClientRect().height >= 44)], [false, true], '«استرجاع» enabled, easy to tap');
  await noSideways(phone, 'phone trash');
  await shot(phone, 'trash-own-rep-list-ar');
  await restoreButton.click();
  await phone.getByRole('alertdialog').getByRole('button', {name: 'استرجاع', exact: true}).click();
  await phone.getByText('تم استرجاع السجل').first().waitFor();
  await phone.locator('.trash-empty').waitFor();
  await shot(phone, 'trash-own-rep-restored-ar');
  check(await exists('own-ar'), true, 'the visit is back in the database');
  await phone.locator('.mobile-bottom-navigation button[data-page="activity"]').click();
  await phone.locator('.rep-record-card').filter({hasText: ARABIC}).waitFor();
  ok(await phone.locator('.rep-record-card').filter({hasText: ARABIC}).getByRole('button', {name: 'حذف الزيارة'}).count() === 1, 'back in «الزيارات», with its «حذف»');
  await noSideways(phone, 'phone visits');
  await shot(phone, 'trash-own-rep-visit-back-ar');
  await phone.context().close();

  // ---- 4. The same on the desktop, in English (sidebar).
  const desk = await open('rep', {viewport: DESKTOP, english: true});
  const row = desk.locator('.rep-desktop-records tr').filter({hasText: ENGLISH});
  await row.getByRole('button', {name: 'Delete visit'}).click();
  const deskDialog = desk.getByRole('alertdialog');
  ok((await deskDialog.innerText()).includes('It can be restored later from «Deleted records».'), 'English confirmation');
  await deskDialog.getByRole('button', {name: 'Delete record', exact: true}).click();
  await desk.getByText('Record deleted').first().waitFor();
  await row.waitFor({state: 'detached'});
  const sidebar = desk.locator('.app-sidebar .nav-item').filter({hasText: 'Deleted records'});
  check(await sidebar.count(), 1, 'the sidebar lists «Deleted records»');
  await sidebar.click();
  const deskEntry = desk.locator('.trash-card[data-record="own-en"]');
  await deskEntry.waitFor();
  const deskText = await deskEntry.innerText();
  ok(deskText.includes('Visit') && deskText.includes('Deleted by: مندوب الوسطى') && deskText.includes('Restore'), 'English card: ' + deskText);
  ok((await desk.locator('.trash-intro').innerText()).includes('Records you deleted.') && (await desk.locator('.trash-intro').innerText()).includes('«Restore» works while «Delete» of the record\'s screen is on for you.'), 'English intro');
  ok(!/[؀-ۿ]/.test((await desk.locator('.trash-toolbar').innerText())), 'no Arabic left in the English toolbar');
  await shot(desk, 'trash-own-rep-desktop-en');
  await deskEntry.getByRole('button', {name: 'Restore ' + ENGLISH}).click();
  await desk.getByRole('alertdialog').getByRole('button', {name: 'Restore', exact: true}).click();
  await desk.getByText('Record restored').first().waitFor();
  await desk.locator('.trash-empty').waitFor();
  check(await exists('own-en'), true, 'English: the visit is back');
  await desk.locator('.app-sidebar .nav-item').filter({hasText: 'Visits'}).first().click();
  await desk.locator('.rep-desktop-records tr').filter({hasText: ENGLISH}).waitFor();
  await shot(desk, 'trash-own-rep-desktop-back-en');
  await desk.context().close();

  // ---- 5. Another representative, never granted: no «المحذوفات», 404 (phone, English).
  const other = await open('rep2', {english: true});
  ok(!(await morePages(other, 'More pages')).includes('trash'), 'rep2: no «Deleted records» in «More»');
  check((await fetchStatus(other, '/api/trash'))[0], 404, 'rep2: GET /api/trash 404');
  await other.goto(app.origin + '/#trash'); await other.locator('.topbar').waitFor();
  ok(!(await other.locator('.topbar .breadcrumb strong').innerText()).includes('Deleted records'), 'rep2: #trash opens another page');
  await noSideways(other, 'rep2 phone');
  await shot(other, 'trash-own-rep2-phone-en');
  await other.context().close();

  // ---- 6. A sales manager granted «حذف» with «المحذوفات» hidden: the administrator restores it.
  const manager = await open('sm', {hash: 'customer'});
  await manager.locator('.customer-mobile-card').filter({has: manager.locator('h3', {hasText: 'مصنع المدير'})}).locator('.customer-mobile-name').click();
  await manager.locator('.crm-sheet').getByTitle('حذف السجل').click();
  const managerDialog = await manager.getByRole('alertdialog').innerText();
  ok(managerDialog.includes('مدير النظام يقدر يسترجعه لاحقًا من «المحذوفات».') && !managerDialog.includes('يمكن استرجاعه لاحقًا'), '«المحذوفات» hidden: the administrator can restore it');
  await shot(manager, 'trash-own-manager-hidden-ar');
  await manager.getByRole('alertdialog').getByRole('button', {name: 'إلغاء', exact: true}).click();
  await manager.context().close();

  // ---- 7. The administrator's matrix in English on the phone: the row note in English.
  const adminPhone = await open('owner', {english: true, hash: 'team'});
  await adminPhone.getByRole('row').filter({has: adminPhone.locator('strong', {hasText: /^مندوب الوسطى$/})}).getByTitle('Edit user').click();
  await adminPhone.locator('[data-permission-matrix]').waitFor();
  check((await adminPhone.locator('[data-matrix-row="trash"] [data-row-note]').innerText()).trim(), 'For whoever has «Delete»: only what they deleted themselves', 'English note');
  check(await adminPhone.getByRole('checkbox', {name: 'Delete · Visits'}).isChecked(), true, 'the grant saved');
  await adminPhone.locator('[data-matrix-row="trash"]').scrollIntoViewIfNeeded();
  await noSideways(adminPhone, 'admin phone matrix');
  await shot(adminPhone, 'trash-own-admin-matrix-phone-en');
  await adminPhone.context().close();

  ok(!errors.length, 'no uncaught page errors: ' + errors.join(' | '));
  console.log(JSON.stringify({ok: true, checks, screenshots, realChromium: true, syntheticFixtures: true}));
} finally {
  await browser?.close(); await app?.stop();
}
