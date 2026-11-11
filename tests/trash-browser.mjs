// «المحذوفات» in a real Chromium against the BUILT release (run `pnpm build` first). On a 360 px phone, in Arabic: the administrator deletes
// a customer from its sheet, opens «المزيد» → «المحذوفات», finds it (type, name, YR-C code, who deleted it), filters by «نوع السجل»,
// restores it behind the confirmation, the list reads «لا توجد محذوفات», and the customer is back in the customers list with the same YR-C
// code; the page never scrolls sideways. The same in English. On the desktop (sidebar item): a quotation whose opportunity is deleted too
// says to restore the opportunity first and cannot be restored until it is. A sales manager has the page (their own deletions); a
// supervisor does not. Screenshots for the report. Synthetic fixtures only: temporary SQLite, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [{id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'مدير المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'sm', name: 'المشرف'}, {id: 'rep', role: 'rep', sup: 'sup', region: 'central', name: 'مندوب الوسطى'}];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-trash-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1280, height: 900};
const ARABIC = 'مصنع الاسترجاع العربي', ENGLISH = 'مصنع الاسترجاع الإنجليزي', KEEP = 'مصنع باق';

try {
  app = await bootBuiltApp({members}, {tls: true});
  const now = new Date().toISOString();
  const customer = (id, name, extra = {}) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')")
    .bind(id, JSON.stringify({name, branch: 'الرئيسي', assignedTo: 'rep', region: 'الوسطى', city: 'الرياض', customerStatus: 'نشط', phone: '0551234567', contact: 'م', code: '', ...extra}), now, now).run();
  await customer('arabic', ARABIC, {code: 'AR-1'}); await customer('english', ENGLISH, {code: 'EN-1'}); await customer('keep', KEEP);
  const code = async id => 'YR-C-' + String((await app.db.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').bind(id).first()).number).padStart(6, '0');
  const codes = {arabic: await code('arabic'), english: await code('english')};
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
    return page;
  }
  const shot = async (page, label) => { await page.waitForTimeout(300); await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const noSideways = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scrolling');
  const card = (page, name) => page.locator('.customer-mobile-card').filter({has: page.locator('h3', {hasText: name})});
  const trashCards = page => page.locator('.trash-card');
  async function deleteFromSheet(page, name, label) {
    await card(page, name).locator('.customer-mobile-name').click();
    await page.locator('.crm-sheet').getByTitle(label.button).click();
    const dialog = page.getByRole('alertdialog');
    ok((await dialog.innerText()).includes(label.note), 'the confirmation says it can be restored');
    await dialog.getByRole('button', {name: label.button, exact: true}).click();
    await dialog.waitFor({state: 'detached'});
    await card(page, name).waitFor({state: 'detached'});
  }
  async function openTrashFromMore(page, label) {
    await page.getByRole('button', {name: label.more, exact: true}).click();
    await page.locator('.mobile-overflow-pages button[data-page="trash"]').click();
    await page.locator('.trash-page').waitFor();
    check((await page.locator('.topbar .breadcrumb strong').innerText()).trim(), label.title, 'the page title');
  }

  for (const [language, label] of [['ar', {name: ARABIC, id: 'arabic', button: 'حذف السجل', note: 'يمكن استرجاعه لاحقًا من «المحذوفات».', more: 'المزيد من الصفحات', title: 'المحذوفات', type: 'عميل', visit: 'زيارة', all: 'كل الأقسام', filter: 'نوع السجل', restore: 'استرجاع', empty: 'لا توجد محذوفات', done: 'تم استرجاع السجل', by: 'حذفه: مدير النظام'}],
    ['en', {name: ENGLISH, id: 'english', button: 'Delete record', note: 'It can be restored later from «Deleted records».', more: 'More pages', title: 'Deleted records', type: 'Customer', visit: 'Visit', all: 'All sections', filter: 'Record type', restore: 'Restore', empty: 'No deleted records', done: 'Record restored', by: 'Deleted by: مدير النظام'}]]) {
    const page = await open('owner', {english: language === 'en'});
    await card(page, label.name).waitFor();
    ok((await card(page, label.name).innerText()).includes(codes[label.id]), language + ': the customer with its YR-C code');
    await deleteFromSheet(page, label.name, label);
    await openTrashFromMore(page, label);
    await trashCards(page).first().waitFor();
    const entry = trashCards(page).filter({hasText: label.name});
    check(await entry.count(), 1, language + ': the deleted customer is listed');
    const text = await entry.innerText();
    ok(text.includes(label.type) && text.includes(codes[label.id]) && text.includes(label.by), language + ': type, YR-C code and who deleted it: ' + text);
    check(await entry.getByRole('button', {name: label.restore + ' ' + label.name}).evaluate(button => button.getBoundingClientRect().height >= 44), true, 'an easy-to-tap «استرجاع»');
    await noSideways(page, language + ' list');
    await shot(page, 'trash-phone-' + language);
    // «نوع السجل»: visits only, then all again
    await page.getByRole('combobox', {name: label.filter}).click();
    await page.getByRole('option', {name: label.visit, exact: true}).click();
    await page.locator('.trash-empty').waitFor();
    ok((await page.locator('.trash-empty').innerText()).includes(label.empty), language + ': no deleted visits');
    await page.getByRole('combobox', {name: label.filter}).click();
    await page.getByRole('option', {name: label.all, exact: true}).click();
    await entry.waitFor();
    // restore behind the confirmation
    await entry.getByRole('button', {name: label.restore + ' ' + label.name}).click();
    const dialog = page.getByRole('alertdialog');
    await shot(page, 'trash-confirm-' + language);
    await dialog.getByRole('button', {name: label.restore, exact: true}).click();
    await page.getByText(label.done).first().waitFor();
    await page.locator('.trash-empty').waitFor();
    ok((await page.locator('.trash-empty').innerText()).includes(label.empty), language + ': «لا توجد محذوفات»');
    await shot(page, 'trash-restored-' + language);
    // back in the customers list, same code
    await page.locator('.mobile-bottom-navigation button[data-page="customer"]').click();
    await card(page, label.name).waitFor();
    ok((await card(page, label.name).innerText()).includes(codes[label.id]), language + ': back in the customers list with the same YR-C code');
    check(await code(label.id), codes[label.id], language + ': the same number in the database');
    await noSideways(page, language + ' customers');
    await shot(page, 'trash-customer-back-' + language);
    await page.context().close();
  }

  // ---- the desktop: the quotation waits for its opportunity
  const insert = (id, kind, parent, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,'rep','الرئيسي',?,?,?,1,'fixture')").bind(id, kind, parent, JSON.stringify(data), now, now).run();
  await insert('opp', 'opportunity', 'keep', {moldType: 'قالب بلدورة', product: 'p', dimensions: 'd', quantity: 1, stage: 'technical', technicalStatus: 'approved', technicalNotes: 'ok', nextAction: 'x', nextDate: '2026-12-01', performedBy: 'owner'});
  await insert('quote', 'quote', 'opp', {number: 'YR-2026-DESK', date: '2026-11-09', validUntil: '2026-11-30', status: 'draft', items: [{description: 'قالب', quantity: 1, price: 10}], taxRate: 15, performedBy: 'owner'});
  const owner = app.as(await app.login('owner'));
  for (const id of ['quote', 'opp']) { const row = await app.db.prepare('SELECT kind,version FROM crm_records WHERE id=?').bind(id).first(); check((await owner('/api/crm', {method: 'POST', body: {action: 'delete', kind: row.kind, id, version: row.version}})).status, 200, 'deleted ' + id); }
  const desk = await open('owner', {viewport: DESKTOP, hash: 'dashboard'});
  await desk.locator('[data-sidebar="menu-button"], .nav-item').filter({hasText: 'المحذوفات'}).first().click();
  await desk.locator('.trash-card').first().waitFor();
  const quote = desk.locator('.trash-card[data-record="quote"]'), opp = desk.locator('.trash-card[data-record="opp"]');
  ok((await quote.locator('.trash-blocked').innerText()).includes('استرجع السجل الأصلي أولًا: الفرصة «قالب بلدورة».'), 'the quotation says which record to restore first');
  check(await quote.locator('.trash-restore').isDisabled(), true, 'and cannot be restored yet');
  ok((await opp.innerText()).includes('العميل: ' + KEEP), 'the opportunity with its customer');
  await shot(desk, 'trash-desktop-ar');
  await opp.locator('.trash-restore').click();
  await desk.getByRole('alertdialog').getByRole('button', {name: 'استرجاع', exact: true}).click();
  await opp.waitFor({state: 'detached'});
  check(await quote.locator('.trash-restore').isDisabled(), false, 'once the opportunity is back, the quotation can be');
  check(await quote.locator('.trash-blocked').count(), 0, 'without the note');
  await desk.context().close();

  // ---- a sales manager has the page (their own deletions); a supervisor does not
  const manager = await open('sm', {hash: 'customer'});
  await manager.getByRole('button', {name: 'المزيد من الصفحات', exact: true}).click();
  check(await manager.locator('.mobile-overflow-pages button[data-page="trash"]').count(), 1, 'the sales manager: «المحذوفات» in «المزيد»');
  await manager.locator('.mobile-overflow-pages button[data-page="trash"]').click();
  await manager.locator('.trash-empty').waitFor();
  ok((await manager.locator('.trash-intro').innerText()).includes('السجلات التي حذفتها'), 'their own deletions (none: the administrator\'s are not theirs)');
  await shot(manager, 'trash-manager-ar');
  await manager.context().close();
  const supervisor = await open('sup', {hash: 'customer'});
  await supervisor.getByRole('button', {name: 'المزيد من الصفحات', exact: true}).click();
  check(await supervisor.locator('.mobile-overflow-pages button[data-page="trash"]').count(), 0, 'the supervisor: no «المحذوفات»');
  await supervisor.context().close();

  ok(!errors.length, 'no uncaught page errors: ' + errors.join(' | '));
  console.log(JSON.stringify({ok: true, checks, screenshots, realChromium: true, syntheticFixtures: true}));
} finally {
  await browser?.close(); await app?.stop();
}
