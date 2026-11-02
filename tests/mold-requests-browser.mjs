// Mold manufacturing requests in a real Chromium against the BUILT release (run `pnpm build` first), sending to the stand-in production
// API (scripts/lib/products-mock.mjs): a representative opens «طلبات تصنيع القوالب», asks for a mold for a customer of their own (search,
// choose, the form with the usual sizes), the request is saved and sent (order 92, seven stages not started); production moves it on
// (stages done, locked); production unreachable (kept waiting, resend); the form refuses an incomplete request; the phone keeps the
// representative's five tabs and opens the page from the account sheet. Since 2026-11-01: each request says where it waits and since
// when, with the three approvals; the sales manager approves (and withdraws) from the request; four half-block choices; a supervisor and
// customer service ask too. Since 2026-11-02: a request deleted in production reads «cancelled in production», with no «production has
// started» note; a sent request offers no edit (its approvals pending or not: the production manager edits it in the products
// application), only cancelling and its design files, and its specifications say so; a request production refused before storing it is
// still edited, in a dialog over the request, until its first send reaches production; an edit saved after its send reached production
// meanwhile is refused with the reason (in English too) and the request behind drops its edit at once; the sales manager's
// «طلبات بانتظار اعتمادي» and the request's sheet they approve from show the request as the production manager edited it in the
// products application; a change the earlier release queued that production refuses for good (production_only) is said on the request,
// in Arabic and in English, with which specifications it shows. Screenshots for the report. Synthetic fixtures only: temporary SQLite,
// no production data, no real production app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require('playwright');
const members = [
  {id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'}, {id: 'sup', role: 'supervisor', sup: 'sm'},
  {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'أحمد عبد العزيز'}, {id: 'csm', role: 'customer_service_manager', sup: 'sm'}
];
const screenshots = process.env.YR_MOLD_SCREENSHOT_DIR ? path.resolve(process.env.YR_MOLD_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-mold-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1280, height: 900};
const LABEL = 'طلبات تصنيع القوالب';

const mock = await startProductsMock();
const app = await bootBuiltApp({members}, {tls: true, env: {YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret, NODE_EXTRA_CA_CERTS: mock.ca}});
try {
  const now = new Date().toISOString();
  const customer = (id, assignedTo, region) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, assignedTo, JSON.stringify({name: 'مصنع ' + id, region, city: 'الدمام', address: 'حي الصناعية', phone: '0551234567', code: 'ERP-' + id, branch: 'الرئيسي', assignedTo}), now, now).run();
  await customer('east1', 'rep', 'الشرقية'); await customer('east2', 'rep', 'الشرقية');
  const {scope} = await app.db.prepare('SELECT region_scope AS scope FROM crm_members WHERE id=?').bind('rep').first();
  const stale = () => app.db.prepare("UPDATE crm_mold_requests SET remote_at='2026-01-01T00:00:00.000Z'").run();
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  /** A signed-in page; a representative runs in the Android app emulator with tracking set up (the gate lets them in). language: 'en'
   *  opens it in English (the saved choice, as the language switch stores it). */
  async function open(memberId, {viewport = DESKTOP, language = 'ar'} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block'});
    if (language === 'en') await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (memberId === 'rep') await installNativeBridge(page, {memberId: 'rep', regionScope: scope});
    await page.goto(app.origin + '/');
    await page.locator('.workspace').waitFor();
    return page;
  }
  const shot = async (page, label) => { await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const noOverflow = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal overflow');
  const goMolds = async page => { await page.locator('button.nav-item', {hasText: new RegExp(LABEL + '|Mold requests')}).first().click(); await page.locator('.mold-page').waitFor(); };
  const sheet = page => page.locator('.mold-sheet');
  const fill = async (dialog, customerName) => {
    if (customerName) { await dialog.locator('.mold-customer-search input').fill(customerName); await dialog.locator('.mold-customer-matches button', {hasText: customerName}).click(); }
    await dialog.locator('label.mold-field', {hasText: 'وصف القالب'}).locator('input').fill('200*400*27.5TH MM OPEN');
    for (const text of ['مفتوح', 'موديل قديم', 'بدون بلوكة نص']) await dialog.locator('.mold-choice label', {hasText: text}).click();
    await dialog.locator('.mold-choice', {hasText: 'عدد الرجاجات'}).locator('label', {hasText: '2'}).click();
    await dialog.locator('label.mold-field', {hasText: 'عرض القالب'}).locator('.mold-usual button', {hasText: '1380'}).click();
    await dialog.locator('label.mold-field', {hasText: 'مقاس الجلب'}).locator('.mold-usual button', {hasText: '795'}).click();
  };

  // ---- 1. The representative asks for a mold: saved, sent, order 92, seven stages not started
  const rep = await open('rep');
  await goMolds(rep);
  check(await rep.locator('.page-heading .heading-actions button:visible').count(), 0, 'no generic add or export button over the page');
  check(await rep.locator('.mold-page h2').count(), 0, 'the page title is said once');
  await rep.locator('.mold-page .empty', {hasText: 'لا توجد طلبات تصنيع قوالب بعد.'}).waitFor();
  await rep.locator('button.mold-new').click();
  const dialog = rep.locator('.mold-dialog');
  await dialog.waitFor();
  // An incomplete request is refused on the device: no call reaches production.
  const before = mock.state.calls.length;
  await dialog.getByRole('button', {name: 'حفظ وإرسال للإنتاج'}).click();
  ok(await dialog.locator('.field-error', {hasText: 'اختر العميل'}).count() === 1, 'the form asks for the customer');
  ok(await dialog.locator('.field-error').count() >= 5, 'and points at each missing field');
  check(mock.state.calls.length, before, 'nothing was sent for an incomplete form');
  await fill(dialog, 'مصنع east1');
  check(await dialog.locator('.field-error').count(), 0, 'each message goes once its field is filled');
  await shot(rep, 'mold-form-desktop');
  await dialog.getByRole('button', {name: 'حفظ وإرسال للإنتاج'}).click();
  await sheet(rep).waitFor();
  const facts = sheet(rep).locator('.mold-facts').first();
  await facts.locator('dd', {hasText: '92'}).waitFor();
  check(await sheet(rep).locator('.mold-stages li').count(), 7, 'seven stages');
  check(await sheet(rep).locator('.mold-stages li[data-done="true"]').count(), 0, 'none started');
  ok((await facts.innerText()).includes('YR-C-'), 'the customer by its Yourrest code');
  check([await sheet(rep).getByRole('button', {name: 'تعديل الطلب'}).count(), await sheet(rep).getByRole('button', {name: 'إلغاء الطلب'}).count()], [0, 1], 'sent: no edit (the production manager edits it in the products application); cancel while received');
  ok((await sheet(rep).locator('.mold-specs-note').innerText()).includes('يعدّلها مدير الإنتاج في تطبيق المنتجات فقط'), 'the specifications say so');
  check((await sheet(rep).locator('.mold-waiting').innerText()).includes('بانتظار اعتماد مدير المبيعات'), true, 'it says where it waits');
  ok(/من \d/.test(await sheet(rep).locator('.mold-waiting').innerText()), 'and since when');
  check([await sheet(rep).locator('.mold-approvals li').count(), await sheet(rep).locator('.mold-approvals li[data-done="true"]').count()], [3, 0], 'three approvals, none given yet');
  check(await sheet(rep).getByRole('button', {name: 'اعتماد', exact: true}).count(), 0, 'a representative does not approve');
  await shot(rep, 'mold-sheet-received');
  const sent = JSON.parse(mock.state.calls.findLast(call => call.route === 'requests').body);
  check([sent.customer.name, sent.specs.moldWidth, sent.specs.gelbaSize, sent.specs.vibrators], ['مصنع east1', 1380, 795, 2], 'production received what was chosen');
  await rep.keyboard.press('Escape');
  await rep.locator('.mold-card').first().waitFor();
  check(await rep.locator('.mold-card').count(), 1, 'the list shows the request');
  check(await rep.locator('.mold-card .mold-chip').first().innerText(), 'بانتظار اعتماد مدير المبيعات', 'the card too');

  // ---- 2. Production moves it on: two stages done, the request locked
  mock.produce(sent.crmRequestId, {stages: ['laserCutting', 'box'], moldSerial: 'S-1001'});
  await stale();
  await rep.locator('.mold-heading-tools button').first().click();
  await rep.locator('.mold-card').first().click();
  await sheet(rep).locator('.mold-stages li[data-done="true"]').nth(1).waitFor();
  check(await sheet(rep).locator('.mold-stages li[data-done="true"]').count(), 2, 'two stages done');
  await sheet(rep).locator('.mold-locked').waitFor();
  check([await sheet(rep).getByRole('button', {name: 'تعديل الطلب'}).count(), await sheet(rep).getByRole('button', {name: 'إلغاء الطلب'}).count()], [0, 0], 'no edit or cancel once production started');
  ok((await sheet(rep).locator('.mold-facts').first().innerText()).includes('S-1001'), 'the serial is shown');
  await shot(rep, 'mold-sheet-in-production');
  await rep.keyboard.press('Escape');

  // ---- 3. Production unreachable: kept waiting, then resent
  mock.state.down = true;
  await rep.locator('button.mold-new').click();
  await dialog.waitFor();
  await fill(dialog, 'مصنع east2');
  await dialog.getByRole('button', {name: 'حفظ وإرسال للإنتاج'}).click();
  await sheet(rep).locator('.mold-sending').waitFor();
  ok((await sheet(rep).locator('.mold-sending').innerText()).length > 0, 'the request says it waits to be sent');
  await shot(rep, 'mold-sheet-waiting');
  mock.state.down = false;
  await sheet(rep).getByRole('button', {name: 'إعادة الإرسال'}).click();
  await sheet(rep).locator('.mold-facts').first().locator('dd', {hasText: '93'}).waitFor();
  check(await sheet(rep).locator('.mold-sending').count(), 0, 'sent: nothing waits any more');
  await rep.keyboard.press('Escape');
  await noOverflow(rep, 'desktop list'); await shot(rep, 'mold-list-desktop');
  await rep.context().close();

  // ---- 3b. The sales manager approves from the request, and may withdraw until production approves
  const second = JSON.parse(mock.state.calls.findLast(call => call.route === 'requests').body).crmRequestId;
  const manual = mock.registerManual({customerName: 'مصنع مسجّل في الإنتاج', salesmanName: 'مندوب الإنتاج', createdBy: 'prod@yourrest.org', description: 'manual mold'});
  // The production manager edits the CRM's request in the products application (2026-11-02): what the sales manager approves is that.
  mock.edit(second, {customerName: 'مصنع east2 (عدّله الإنتاج)', salesmanName: 'مندوب عدّله الإنتاج', quantity: 3, description: 'وصف عدّله مدير الإنتاج'});
  const sm = await open('sm');
  await goMolds(sm);
  // «طلبات بانتظار اعتمادي» first: the CRM's request and the one registered in production
  const pendingCard = sm.locator('.mold-pending', {hasText: 'مصنع مسجّل في الإنتاج'});
  await pendingCard.waitFor();
  check([await sm.locator('.mold-tabs [aria-selected="true"]').innerText(), await sm.locator('.mold-pending').count()], ['طلبات بانتظار اعتمادي 2', 2], 'the sales manager opens on the requests waiting for them, both kinds');
  ok((await pendingCard.innerText()).includes('مسجّل في تطبيق الإنتاج') && (await pendingCard.innerText()).includes('prod@yourrest.org'), 'registered in production, and by whom');
  // The CRM's request as production holds it now: its customer, salesman and specifications as the production manager edited them.
  const crmPendingText = await sm.locator('.mold-pending', {hasText: 'مصنع east2 (عدّله الإنتاج)'}).innerText();
  ok(crmPendingText.includes('من الـCRM') && crmPendingText.includes('وصف عدّله مدير الإنتاج') && crmPendingText.includes('مندوب عدّله الإنتاج') && /الكمية:\s*3/.test(crmPendingText) && !crmPendingText.includes('200*400*27.5TH MM OPEN'),
    'the CRM\'s request in the list as production holds it now, not the CRM\'s copy: ' + crmPendingText);
  await shot(sm, 'mold-pending-manager');
  // Registered in production meanwhile: the approval's answer reads the list again (the server keeps it a minute otherwise).
  const gone = mock.registerManual({customerName: 'مصنع اتمسح من الإنتاج', salesmanName: 'مندوب الإنتاج', createdBy: 'prod@yourrest.org', description: 'gone mold'});
  await pendingCard.getByRole('button', {name: 'اعتماد', exact: true}).click();
  await sm.locator('.mold-pending[data-done]', {hasText: 'مصنع مسجّل في الإنتاج'}).waitFor();
  check([mock.state.byOrder.get(manual.orderNo).approvals.sales?.via, await sm.locator('.mold-pending:not([data-done])', {hasNotText: 'مصنع اتمسح من الإنتاج'}).count()], ['crm', 1], 'approved at production by its order number; one left waiting');
  // A request production deletes while it waits on the list: the refusal stays readable after the request leaves the list.
  const goneCard = sm.locator('.mold-pending', {hasText: 'مصنع اتمسح من الإنتاج'});
  await goneCard.waitFor();
  mock.removeOrder(gone.orderNo);
  await goneCard.getByRole('button', {name: 'اعتماد', exact: true}).click();
  await sm.locator('.mold-pending-gone').waitFor();
  const goneText = await sm.locator('.mold-pending-gone').innerText();
  ok(goneText.includes(String(gone.orderNo)) && goneText.includes('لم يعد بانتظار اعتمادك'), 'the refusal names the order and stays readable: ' + goneText);
  check(await goneCard.count(), 0, 'the deleted request left the list');
  await sm.locator('.mold-tabs button', {hasText: 'كل الطلبات'}).click();
  const waitingCard = sm.locator('.mold-card', {hasText: 'مصنع east2'});
  await waitingCard.waitFor();
  check(await waitingCard.locator('.mold-chip').innerText(), 'بانتظار اعتمادك', 'the sales manager reads «waiting for you»');
  await waitingCard.click();
  // Approved from the request's sheet too, what is shown there is what production lists now, said so.
  await sheet(sm).locator('.mold-specs-note[data-source="production"]').waitFor();
  const askedNow = await sheet(sm).locator('.mold-facts').nth(1).innerText();
  check([await sheet(sm).locator('[data-slot="sheet-title"]').innerText(), askedNow.includes('وصف عدّله مدير الإنتاج'), /الكمية\s*3/.test(askedNow), (await sheet(sm).locator('.mold-facts').first().innerText()).includes('مندوب عدّله الإنتاج')],
    ['مصنع east2 (عدّله الإنتاج)', true, true, true], 'the sheet the sales manager approves from shows the request as production holds it now');
  await sm.waitForTimeout(400);
  await shot(sm, 'mold-sheet-approver-production-data');
  await sheet(sm).getByRole('button', {name: 'اعتماد', exact: true}).click();
  await sheet(sm).locator('.mold-waiting', {hasText: 'بانتظار اعتماد الإنتاج'}).waitFor();
  check(await sheet(sm).locator('.mold-approvals li[data-done="true"]').count(), 1, 'the sales manager\'s approval is shown as given');
  ok((await sheet(sm).locator('.mold-approvals li').first().innerText()).includes('sm@yourrest.org'), 'with who gave it');
  check(mock.row(second).approvals.sales?.via, 'crm', 'production recorded it as given in the CRM');
  await shot(sm, 'mold-sheet-approved');
  await sheet(sm).getByRole('button', {name: 'سحب الاعتماد'}).click();
  await sheet(sm).getByRole('button', {name: 'اعتماد', exact: true}).waitFor();
  check(mock.row(second).approvals.sales, null, 'withdrawn at production too');
  await sheet(sm).getByRole('button', {name: 'اعتماد', exact: true}).click();
  await sheet(sm).getByRole('button', {name: 'سحب الاعتماد'}).waitFor();
  await sm.context().close();

  // ---- 3c. A sent request offers no edit, approved or not: cancelling and its design files only. One production refused before storing
  //  it is still edited, in a dialog over the request (four half-block choices), until its first send reaches production.
  mock.answerNext('requests', 400, {error: {code: 'invalid_payload', message: 'Some fields are missing or invalid.', fields: ['specs.notes']}});
  const refused = (await (await app.as(await app.login('rep'))('/api/mold-requests', {method: 'POST', body: {action: 'create', requestId: crypto.randomUUID(), customerId: 'east1', specs: {description: 'refused by production', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, quantity: 1}}})).json()).request;
  check([refused.sending.state, refused.remote, refused.can.edit], ['rejected', null, true], 'production refused it before storing it (400): still the requester\'s to edit');
  const editor = await open('rep');
  await goMolds(editor);
  await editor.locator('.mold-card', {hasText: 'مصنع east2'}).click();
  await sheet(editor).locator('.mold-approvals li[data-done="true"]').waitFor();
  check([await sheet(editor).getByRole('button', {name: 'تعديل الطلب'}).count(), await sheet(editor).getByRole('button', {name: 'إلغاء الطلب'}).count(), await sheet(editor).locator('.mold-design-tools').count()], [0, 1, 1], 'approved by the sales manager: no edit; cancelling and the design files as before');
  await editor.waitForTimeout(400);
  await shot(editor, 'mold-sheet-sent-no-edit');
  await editor.keyboard.press('Escape');
  await editor.locator('.mold-card', {hasText: 'refused by production'}).click();
  await sheet(editor).locator('.mold-sending[data-state="rejected"]').waitFor();
  ok((await sheet(editor).locator('.mold-sending').innerText()).includes('عدّل الطلب أو أعد إرساله'), 'it says it may still be edited');
  check(await sheet(editor).locator('.mold-specs-note').count(), 0, 'and no note about the production manager: production does not hold it');
  await sheet(editor).getByRole('button', {name: 'تعديل الطلب'}).click();
  const edit = editor.locator('.mold-dialog');
  await edit.waitFor();
  ok((await edit.innerText()).includes('الطلب لم يصل للإنتاج بعد'), 'the dialog says why it may still change');
  check(await edit.locator('.mold-banner').count(), 0, 'no warning about approvals: there are none to undo');
  check(await edit.locator('.mold-choice', {hasText: 'بلوكة النص'}).locator('label').allInnerTexts(), ['بدون بلوكة نص', 'بلوكة نص واحدة', 'بلوكتين نص', '3 بلوكات نص'], 'none to three half blocks');
  // The dialog opened from the request is above the request, everywhere they overlap.
  check(await editor.evaluate(() => { const box = document.querySelector('.mold-dialog').getBoundingClientRect(), sheetBox = document.querySelector('.mold-sheet').getBoundingClientRect(); const x = Math.max(box.left, sheetBox.left) + 20, y = box.top + box.height / 2; return !!document.elementFromPoint(x, y)?.closest('.mold-dialog'); }), true, 'the edit dialog is on top of the request it was opened from');
  await editor.waitForTimeout(400);
  await shot(editor, 'mold-edit-unsent');
  await edit.locator('label.mold-field', {hasText: 'الكمية'}).locator('input').fill('2');
  await edit.getByRole('button', {name: 'حفظ وإرسال التعديل'}).click();
  await edit.waitFor({state: 'detached'});
  await sheet(editor).locator('.mold-specs-note').waitFor();
  check([await sheet(editor).locator('.mold-sending').count(), await sheet(editor).getByRole('button', {name: 'تعديل الطلب'}).count(), mock.row(refused.id)?.quantity], [0, 0, 2], 'the change was sent; production holds it now, so no more edits');
  await editor.context().close();

  // ---- 3c'. In English: the edit form is open on a request production never stored when its send reaches production (a resend from
  //  elsewhere). Saving is refused with the reason in English, the form stays open with it, and the request behind drops its edit at once.
  mock.answerNext('requests', 400, {error: {code: 'invalid_payload', message: 'Some fields are missing or invalid.', fields: ['specs.notes']}});
  const repApi = app.as(await app.login('rep'));
  const ask = async (description, customerId = 'east1') => (await (await repApi('/api/mold-requests', {method: 'POST', body: {action: 'create', requestId: crypto.randomUUID(), customerId, specs: {description, core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, quantity: 1}}})).json()).request;
  const late = await ask('sent meanwhile');
  check([late.sending.state, late.can.edit], ['rejected', true], 'refused before production stored it: editable');
  const english = await open('rep', {language: 'en'});
  await goMolds(english);
  await english.locator('.mold-card', {hasText: 'sent meanwhile'}).click();
  await sheet(english).getByRole('button', {name: 'Edit request'}).click();
  const lateEdit = english.locator('.mold-dialog');
  await lateEdit.waitFor();
  check((await repApi('/api/mold-requests', {method: 'POST', body: {action: 'resend', requestId: crypto.randomUUID(), id: late.id}})).status, 200, 'meanwhile its send reaches production');
  await lateEdit.locator('label.mold-field', {hasText: 'Quantity'}).locator('input').fill('4');
  await lateEdit.getByRole('button', {name: 'Save and send the change'}).click();
  const lateRefusal = lateEdit.locator('.form-error');
  await lateRefusal.waitFor();
  check(await lateRefusal.innerText(), 'The request\'s data is edited by the production manager only; it was sent to production, so edit it in the products application.', 'refused, with the reason in English; the form stays open');
  await english.waitForTimeout(300);
  await shot(english, 'mold-edit-refused-en');
  await lateEdit.getByRole('button', {name: 'Cancel', exact: true}).click();
  await lateEdit.waitFor({state: 'detached'});
  check([await sheet(english).getByRole('button', {name: 'Edit request'}).count(), await sheet(english).getByRole('button', {name: 'Cancel request'}).count(), mock.row(late.id).quantity], [0, 1, 1], 'the request behind drops its edit at once; production keeps its data');
  await english.context().close();

  // ---- 3f. A change the earlier release queued, refused for good by production (409 production_only): the request says so on its sheet,
  //  with the reason and which specifications it shows: in Arabic, production's last accepted copy; in English, where the CRM never
  //  learned what production accepted (an earlier attempt's answer was lost), the refused change, said to be not production's data
  const later = new Date(Date.now() + 3600_000).toISOString(), queuedAt = new Date().toISOString();
  const queuedKnown = await ask('queued before the release'), queuedLost = await ask('answer lost before the release');
  await app.db.prepare("UPDATE crm_mold_requests SET data=json_set(data,'$.specs.quantity',7),outbox='send',attempts=0,first_failed_at=NULL,next_attempt_at=?,last_error=NULL,version=version+1 WHERE id=?").bind(later, queuedKnown.id).run();
  await app.db.prepare("UPDATE crm_mold_requests SET data=json_set(data,'$.specs.quantity',4),accepted=NULL,remote=NULL,remote_at=NULL,outbox='send',attempts=1,first_failed_at=?,next_attempt_at=?,last_attempt_at=?,last_error=?,version=version+1 WHERE id=?")
    .bind(queuedAt, later, queuedAt, JSON.stringify({code: 'timeout', http: 0, at: queuedAt}), queuedLost.id).run();
  const quantityShown = async page => (await sheet(page).locator('.mold-facts').nth(1).locator('div', {hasText: /الكمية|Quantity/}).locator('dd').innerText()).trim();
  // And one whose first attempt got no answer (it may have arrived, so no edit), then refused for its data: a resend would send the same
  // data, so the sheet points to cancelling it and asking again.
  mock.state.down = true;
  const perhaps = await ask('perhaps sent, then refused');
  mock.state.down = false;
  mock.answerNext('requests', 400, {error: {code: 'invalid_payload', message: 'Some fields are missing or invalid.', fields: ['specs.notes']}});
  const perhapsRefused = (await (await repApi('/api/mold-requests', {method: 'POST', body: {action: 'resend', requestId: crypto.randomUUID(), id: perhaps.id}})).json()).request;
  check([perhapsRefused.sending.state, perhapsRefused.can.edit, perhapsRefused.can.cancel], ['rejected', false, true], 'perhaps sent, then refused for its data: no edit; cancel');
  const known = await open('rep');
  await goMolds(known);
  await known.locator('.mold-card', {hasText: 'queued before the release'}).click();
  await sheet(known).getByRole('button', {name: 'إعادة الإرسال'}).click();
  const knownBanner = sheet(known).locator('.mold-production-only');
  await knownBanner.waitFor();
  const knownText = await knownBanner.innerText();
  ok(knownText.includes('آخر تعديل لم يصل للإنتاج ولن يُعاد إرساله: بيانات الطلب يعدّلها مدير الإنتاج فقط.') && knownText.includes('المواصفات المعروضة آخر ما قبله الإنتاج من الـCRM'), 'the sheet says why, in Arabic, and which specifications it shows: ' + knownText);
  check([await quantityShown(known), await sheet(known).locator('.mold-sending').count(), await sheet(known).getByRole('button', {name: 'إعادة الإرسال'}).count(), mock.row(queuedKnown.id).quantity], ['1', 0, 0, 1], 'production\'s last accepted copy shown; nothing waits, nothing to resend; production keeps its data');
  await known.waitForTimeout(300);
  await shot(known, 'mold-production-only-ar');
  await known.keyboard.press('Escape');
  await sheet(known).waitFor({state: 'detached'});
  await known.locator('.mold-card', {hasText: 'perhaps sent, then refused'}).click();
  const perhapsText = await sheet(known).locator('.mold-sending[data-state="rejected"]').innerText();
  ok(perhapsText.includes('ألغِ الطلب واطلبه من جديد') && !perhapsText.includes('أعد إرساله') && !perhapsText.includes('عدّل الطلب'), 'it points to cancelling and asking again, not to a resend that sends the same data: ' + perhapsText);
  check(await sheet(known).getByRole('button', {name: 'تعديل الطلب'}).count(), 0, 'and offers no edit');
  await known.context().close();
  const englishRep = await open('rep', {language: 'en'});
  await goMolds(englishRep);
  await englishRep.locator('.mold-card', {hasText: 'answer lost before the release'}).click();
  await sheet(englishRep).getByRole('button', {name: 'Resend'}).click();
  const englishBanner = sheet(englishRep).locator('.mold-production-only');
  await englishBanner.waitFor();
  const englishText = await englishBanner.innerText();
  ok(englishText.includes('The last change did not reach production and will not be sent again: The request\'s data is edited by the production manager only.') && englishText.includes('The specifications shown are the change production refused, not its data'), 'in English, with the refused change said to be not production\'s data: ' + englishText);
  check([await quantityShown(englishRep), await sheet(englishRep).locator('.mold-specs-note').count()], ['4', 0], 'the refused change shown, without the «as the CRM sent them» note');
  await englishRep.waitForTimeout(300);
  await shot(englishRep, 'mold-production-only-en');
  // Opened again later: still said, from the request itself.
  await englishRep.reload();
  await goMolds(englishRep);
  await englishRep.locator('.mold-card', {hasText: 'answer lost before the release'}).click();
  ok((await sheet(englishRep).locator('.mold-production-only').innerText()).includes('The specifications shown are the change production refused'), 'opened again: still said');
  await englishRep.context().close();

  // ---- 3d. Deleted in the products application: the representative reads it cancelled there, not «production has started»
  mock.remove(second);
  await stale();
  const reader = await open('rep');
  await goMolds(reader);
  const removedCard = reader.locator('.mold-card', {hasText: 'مصنع east2'});
  // Cancelled there without the CRM asking (deleted or cancelled in production): said so on the card (the products contract).
  await removedCard.locator('.mold-chip', {hasText: 'أُلغي في تطبيق الإنتاج'}).waitFor();
  await removedCard.click();
  await sheet(reader).locator('.mold-banner[data-kind="cancelled"]').waitFor();
  ok((await sheet(reader).locator('.mold-banner[data-kind="cancelled"]').innerText()).includes('أُلغي الطلب في تطبيق الإنتاج'), 'the sheet says it was cancelled in production');
  check(await sheet(reader).locator('.mold-stages li[aria-current]').count(), 0, 'no stage is marked as the current one');
  check([await sheet(reader).locator('.mold-locked').count(), await sheet(reader).getByRole('button', {name: 'تعديل الطلب'}).count(), await sheet(reader).getByRole('button', {name: 'إلغاء الطلب'}).count()], [0, 0, 0], 'no «production has started» note, no edit or cancel');
  await reader.waitForTimeout(400);
  await shot(reader, 'mold-sheet-cancelled-in-production');
  await reader.context().close();

  // ---- 3e. Cancelled in the CRM while production is unreachable: «ملغى» at once, the cancellation waiting to be sent
  const api = app.as(await app.login('rep'));
  const asked = (await (await api('/api/mold-requests', {method: 'POST', body: {action: 'create', requestId: crypto.randomUUID(), customerId: 'east1', specs: {description: 'cancel while down', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, quantity: 1}}})).json()).request;
  mock.state.down = true;
  check((await api('/api/mold-requests', {method: 'POST', body: {action: 'cancel', requestId: crypto.randomUUID(), id: asked.id, version: asked.version, reason: ''}})).status, 200, 'cancelled in the CRM while production is down');
  const canceller = await open('rep');
  await goMolds(canceller);
  const pendingCancel = canceller.locator('.mold-card', {hasText: 'cancel while down'});
  await pendingCancel.waitFor();
  check([await pendingCancel.locator('.mold-chip').innerText(), await pendingCancel.locator('.mold-card-since').count(), await pendingCancel.locator('.mold-card-sending').innerText()], ['ملغى', 0, 'بانتظار الإرسال'], 'the card reads cancelled, not production\'s step, with the cancellation waiting to be sent');
  await pendingCancel.click();
  await sheet(canceller).locator('.mold-banner[data-kind="cancelled"]').waitFor();
  check([await sheet(canceller).locator('.mold-waiting').count(), await sheet(canceller).locator('.mold-stages li[aria-current]').count()], [0, 0], 'the sheet shows no waiting step and no current stage');
  mock.state.down = false;
  await canceller.context().close();

  // ---- 4. The phone keeps the representative's five tabs; the page opens from the account sheet
  const phone = await open('rep', {viewport: PHONE});
  await phone.locator('.mobile-tab[data-page="targets"]').waitFor();
  check(await phone.locator('.mobile-tab[data-page]').evaluateAll(tabs => tabs.map(tab => tab.getAttribute('data-page'))), ['customer', 'map', 'activity', 'followup', 'targets'], 'the same five tabs');
  await phone.locator('button.mobile-profile-trigger').click();
  await phone.locator('.mobile-overflow-pages button[data-page="mold-requests"]').click();
  await phone.locator('.mobile-navigation-sheet').waitFor({state: 'detached'});
  await phone.locator('.mold-page .mold-card').nth(1).waitFor();
  await noOverflow(phone, 'phone list'); await shot(phone, 'mold-list-phone');
  await phone.locator('.mold-card').first().click();
  await sheet(phone).waitFor();
  await phone.waitForFunction(() => { const box = document.querySelector('.mold-sheet')?.getBoundingClientRect(); return !!box && box.left >= -1 && box.right <= innerWidth + 1 && box.width >= innerWidth - 2; });
  await sheet(phone).locator('.mold-stages li').first().waitFor();
  await noOverflow(phone, 'phone sheet'); await shot(phone, 'mold-sheet-phone');
  await phone.context().close();

  // ---- 5. A supervisor follows and asks too; so does customer service
  const sup = await open('sup');
  await goMolds(sup);
  await sup.locator('.mold-card').nth(1).waitFor();
  check(await sup.locator('button.mold-new').count(), 1, 'a supervisor asks for a mold too');
  await sup.context().close();
  const csm = await open('csm');
  await goMolds(csm);
  await csm.locator('.mold-page .mold-empty').waitFor();
  check(await csm.locator('button.mold-new').count(), 1, 'customer service has the page and asks too');
  await csm.context().close();

  check(JSON.stringify(mock.state.calls).includes(mock.state.secret), false, 'the secret never travelled in a body');
  ok(!errors.length, 'no uncaught page errors: ' + errors.join(' | '));
  console.log(JSON.stringify({ok: true, checks, screenshots, realChromium: true, productionApplicationReal: false, productionDataUsed: false}));
} finally {
  await browser?.close(); await app.stop(); await mock.stop();
}
