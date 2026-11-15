// «طلبات تعديل بيانات العميل» (app/customer-edit-requests.tsx, the customer form of app/crm-app.tsx) in a real Chromium against the BUILT release
// (run the build first). The representative in the Android app on a 360 px phone (Arabic): the customer's form says the edit waits and
// sends it «للموافقة», the customer is unchanged, the request shows on the customer with where it waits and «إلغاء الطلب»; on a 320 px
// phone their first screen lists it. The supervisor on a tablet upright (Arabic): «رفض» asks for a reason first (the confirmation stays
// off until there is one), then «موافقة» passes it on. The sales manager on a computer (English, no Arabic left but the data): approves
// it, and the customer is updated. A rejection reaches the representative in English with its reason (360 px). Customer service on a
// tablet on its side: its request waits for the sales manager and «إلغاء الطلب» withdraws it. Nothing scrolls sideways anywhere, every
// button of the card is at least 44 px high on a phone, screenshots of each screen. Synthetic fixtures only: temporary SQLite, mocked mail.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'mgr', role: 'manager', name: 'مدير المبيعات'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', region: 'eastern', name: 'المشرف سالم'},
  {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'},
  {id: 'csm', role: 'customer_service_manager', sup: 'mgr', name: 'مدير خدمة العملاء'}, {id: 'cs', role: 'customer_service', sup: 'csm', name: 'ممثلة خدمة العملاء'}
];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-customer-edits-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const PHONE = {width: 360, height: 800}, SMALL = {width: 320, height: 700}, UPRIGHT = {width: 768, height: 1024}, SIDEWAYS = {width: 1024, height: 768}, DESKTOP = {width: 1280, height: 900};

try {
  app = await bootBuiltApp({members}, {tls: true});
  const now = new Date().toISOString();
  const customer = (id, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')")
    .bind(id, JSON.stringify({name: 'مصنع ' + id, branch: 'الرئيسي', assignedTo: 'rep', region: 'الشرقية', city: 'الدمام', customerStatus: 'نشط', phone: '0551234567', contact: 'أبو فهد', location: '26.43, 50.03', code: 'ERP-' + id, ...data}), now, now).run();
  await customer('c1', {name: 'مصنع الأمل للبلوك'}); await customer('c2', {name: 'مصنع النور'});
  const stored = async id => JSON.parse((await app.db.prepare('SELECT data FROM crm_records WHERE id=?').bind(id).first()).data);
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});

  async function open(memberId, {english = false, viewport = PHONE, hash = '', inApp = false} = {}) {
    const touch = viewport.width < 1100;
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: touch, geolocation: {latitude: 26.43, longitude: 50.03, accuracy: 8}, permissions: ['geolocation']});
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    await context.addInitScript(english => { try { localStorage.setItem('yr-language', english ? 'en' : 'ar'); } catch { /* storage unavailable */ } }, english);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (inApp) await installNativeBridge(page, {memberId, regionScope: 'eastern'});
    await page.goto(app.origin + '/' + hash);
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('.workspace').waitFor();
    return page;
  }
  const settle = page => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const shot = async (page, label) => { await settle(page); await page.screenshot({path: path.join(screenshots, label + '.png'), fullPage: false}); };
  const noSideways = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scrolling');
  const fits = async (locator, label) => check(await locator.evaluate(node => { const box = node.getBoundingClientRect(); return box.left >= -1 && box.right <= innerWidth + 1; }), true, label + ': inside the screen');
  const tall = async (locator, label) => check(await locator.evaluateAll(items => items.filter(item => item.getBoundingClientRect().height && item.getBoundingClientRect().height < 44).map(item => item.textContent)), [], label + ': every button at least 44 px high');
  const noArabic = async (locator, label) => { const words = await locator.evaluate(node => { const copy = node.cloneNode(true); copy.querySelectorAll('bdi,textarea,input').forEach(item => item.remove()); return copy.textContent; }); check(/[؀-ۿ]/.test(words), false, label + ': no Arabic left but the data (' + words.slice(0, 160) + ')'); };
  const inbox = page => page.locator('[data-customer-edit-inbox]');
  const decision = page => page.waitForResponse(response => new URL(response.url()).pathname === '/api/crm' && response.request().method() === 'POST');

  // ---- 1. The representative in the Android app, 360 px, Arabic: the form sends the edit for approval.
  const rep = await open('rep', {inApp: true, hash: '#customer'});
  await rep.getByRole('button', {name: 'بيانات العميل: مصنع الأمل للبلوك', exact: true}).click();
  const sheet = rep.locator('.crm-sheet');await sheet.waitFor();
  await sheet.getByRole('button', {name: 'تعديل', exact: true}).click();
  const dialog = rep.locator('[role=dialog]').filter({has: rep.locator('form')});await dialog.waitFor();
  check((await dialog.locator('[data-customer-edit-note]').innerText()).trim(), 'لا يظهر تعديلك على العميل قبل الموافقة عليه: يصل الطلب إلى مشرفك أولًا ثم إلى مدير المبيعات، أو إلى مدير المبيعات مباشرةً إن لم يكن لك مشرف.', 'the form says the edit waits');
  check([await dialog.getByRole('button', {name: 'إرسال التعديل للموافقة', exact: true}).count(), await dialog.getByRole('button', {name: /^حفظ /}).count()], [1, 0], 'the button sends it for approval');
  await dialog.getByRole('textbox', {name: 'الجوال', exact: true}).fill('0559999999');
  await dialog.locator('label.voice-field').filter({has: rep.locator('span', {hasText: /^المدينة$/})}).locator('input').fill('الخبر');
  await noSideways(rep, 'the representative\'s form, 360 px');
  await shot(rep, 'rep-form-ar-360');
  const sent = decision(rep);
  await dialog.getByRole('button', {name: 'إرسال التعديل للموافقة', exact: true}).click();
  const sentReply = await (await sent).json();
  check([sentReply.pendingApproval, sentReply.approvalStage], [true, 'supervisor'], 'sent to the supervisor');
  await rep.getByText('تم إرسال التعديل إلى مشرفك للموافقة', {exact: true}).waitFor();checks++;
  await dialog.waitFor({state: 'detached'});
  check([(await stored('c1')).phone, (await stored('c1')).city], ['0551234567', 'الدمام'], 'the customer is unchanged');
  const onCustomer = sheet.locator('[data-customer-edit-history] [data-customer-edit="pending"]');await onCustomer.waitFor();
  check([await onCustomer.getAttribute('data-customer-edit-stage'), (await onCustomer.locator('[data-customer-edit-status]').innerText()).trim(), await onCustomer.locator('[data-customer-edit-cancel]').count()], ['supervisor', 'بانتظار موافقة المشرف', 1], 'on the customer: where it waits, and «إلغاء الطلب»');
  check(await onCustomer.locator('[data-customer-edit-field]').evaluateAll(items => items.map(item => [item.dataset.customerEditField, item.querySelector('.cer-before bdi')?.textContent, item.querySelector('.cer-after bdi')?.textContent])), [['phone', '0551234567', '0559999999'], ['city', 'الدمام', 'الخبر']], 'each change, before and after');
  await onCustomer.scrollIntoViewIfNeeded();
  await fits(sheet.locator('[data-customer-edit-history]'), 'the list in the customer\'s sheet');
  await tall(sheet.locator('[data-customer-edit-history] button'), 'the list in the customer\'s sheet, phone');
  await shot(rep, 'rep-customer-request-ar-360');
  await rep.context().close();
  // The 320 px phone: the first screen lists the request.
  const small = await open('rep', {inApp: true, viewport: SMALL});
  await inbox(small).waitFor();
  check((await inbox(small).locator('[data-customer-edit="pending"] .cer-meta').first().innerText()).startsWith('طلبك'), true, 'the representative\'s own request on their first screen');
  await noSideways(small, 'the first screen, 320 px');await fits(inbox(small), 'the card, 320 px');await tall(inbox(small).locator('button'), 'the card, 320 px');
  await shot(small, 'rep-home-ar-320');
  await small.context().close();

  // ---- 2. The supervisor on a tablet upright, Arabic: a rejection asks for its reason; then the approval passes it on.
  const sup = await open('sup', {viewport: UPRIGHT});
  await inbox(sup).waitFor();
  const supItem = inbox(sup).locator('[data-customer-edit="pending"]');
  check([(await inbox(sup).locator('[data-customer-edit-waiting]').innerText()).trim(), (await supItem.locator('.cer-customer').innerText()).trim()], ['1', 'مصنع الأمل للبلوك'], 'the count and the customer');
  await supItem.locator('[data-customer-edit-reject]').click();
  const confirm = supItem.locator('[data-customer-edit-confirm-reject]');
  check(await confirm.isDisabled(), true, 'no reason, no rejection');
  await supItem.locator('textarea').fill('‏ ');check(await confirm.isDisabled(), true, 'invisible marks are no reason');
  await supItem.locator('textarea').fill('رقم الجوال غير صحيح');check(await confirm.isDisabled(), false, 'a reason: the rejection may be confirmed');
  await noSideways(sup, 'the supervisor, tablet upright');
  await shot(sup, 'supervisor-reject-reason-ar-tablet');
  await supItem.getByRole('button', {name: 'رجوع', exact: true}).click();
  const passed = decision(sup);await supItem.locator('[data-customer-edit-approve]').click();
  check((await (await passed).json()).stage, 'sales_manager', 'the supervisor passes it on');
  await inbox(sup).waitFor({state: 'detached'});checks++;
  check((await stored('c1')).phone, '0551234567', 'the customer still waits for the sales manager');
  await sup.context().close();

  // ---- 3. The sales manager on a computer, English: approves; the customer is updated.
  const mgr = await open('mgr', {english: true, viewport: DESKTOP});
  await inbox(mgr).waitFor();
  const mgrItem = inbox(mgr).locator('[data-customer-edit="pending"]');
  check((await mgrItem.locator('[data-customer-edit-status]').innerText()).trim(), 'Awaiting the sales manager’s approval', 'English: where it waits');
  ok((await mgrItem.locator('[data-customer-edit-supervisor]').innerText()).includes('Approved by the supervisor'), 'English: who approved first');
  await noArabic(inbox(mgr), 'the sales manager\'s card in English');
  await noSideways(mgr, 'the sales manager, computer');
  await shot(mgr, 'manager-inbox-en-desktop');
  const applied = decision(mgr);await mgrItem.locator('[data-customer-edit-approve]').click();
  check((await (await applied).json()).status, 'approved', 'approved');
  await mgr.getByText('Approved: the edit now applies to the customer', {exact: true}).waitFor();checks++;
  check([(await stored('c1')).phone, (await stored('c1')).city, (await stored('c1')).code], ['0559999999', 'الخبر', 'ERP-c1'], 'applied; the ERP code stays');
  await mgr.context().close();
  // The sales manager on a computer, Arabic: the customer's sheet keeps the approved request.
  const mgrAr = await open('mgr', {viewport: DESKTOP, hash: '#customer'});
  await mgrAr.locator('tr').filter({hasText: 'مصنع الأمل للبلوك'}).getByRole('button', {name: 'بيانات العميل', exact: true}).click();
  const mgrSheet = mgrAr.locator('.crm-sheet');await mgrSheet.waitFor();
  await mgrSheet.locator('[data-customer-edit-history] [data-customer-edit="approved"]').waitFor();
  check((await mgrSheet.locator('[data-customer-edit="approved"] [data-customer-edit-status]').innerText()).trim(), 'تمت الموافقة وطُبّق التعديل', 'the approved request on the customer');
  await shot(mgrAr, 'manager-customer-history-ar-desktop');
  await mgrAr.context().close();

  // ---- 4. A rejection reaches the representative in English, with its reason (360 px).
  const call = async (who, body) => { const page = await open(who, {viewport: SIDEWAYS}); const reply = await page.evaluate(async body => { const response = await fetch('/api/crm', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}); return {status: response.status, data: await response.json()}; }, body); await page.context().close(); return reply; };
  const row = async id => { const value = await app.db.prepare('SELECT data,version FROM crm_records WHERE id=?').bind(id).first(); return {data: JSON.parse(value.data), version: value.version}; };
  const second = await row('c2');
  const repeat = await call('rep', {action: 'save', kind: 'customer', id: 'c2', version: second.version, editKey: crypto.randomUUID(), data: {...second.data, supplier: 'مورد جديد'}});
  check([repeat.status, repeat.data.approvalStage], [200, 'supervisor'], 'a second request');
  check((await call('sup', {action: 'customer-edit', decision: 'reject', id: repeat.data.requestId, note: 'المورد غير معروف لدينا'})).status, 200, 'the supervisor rejects it with a reason');
  const repEn = await open('rep', {inApp: true, english: true});
  const rejected = inbox(repEn).locator('[data-customer-edit="rejected"]');await rejected.waitFor();
  check([(await rejected.locator('[data-customer-edit-status]').innerText()).trim(), (await rejected.locator('[data-customer-edit-reason] > bdi').innerText()).trim()], ['Rejected', 'المورد غير معروف لدينا'], 'the representative reads «Rejected» and the reason');
  ok((await rejected.locator('[data-customer-edit-reason]').innerText()).startsWith('Reason for rejection'), 'English: the reason\'s label');
  await noArabic(inbox(repEn), 'the representative\'s card in English');
  await noSideways(repEn, 'the representative in English, 360 px');await tall(inbox(repEn).locator('button'), 'the card in English, phone');
  await shot(repEn, 'rep-rejected-en-360');
  await repEn.context().close();

  // ---- 5. Customer service on a tablet on its side: its request waits for the sales manager; «إلغاء الطلب» withdraws it.
  const third = await row('c2');
  const service = await call('cs', {action: 'save', kind: 'customer', id: 'c2', version: third.version, editKey: crypto.randomUUID(), data: {...third.data, contact2: 'مسؤول المشتريات'}});
  check([service.status, service.data.approvalStage], [200, 'sales_manager'], 'customer service\'s request goes to the sales manager');
  const cs = await open('cs', {viewport: SIDEWAYS});
  const csItem = inbox(cs).locator('[data-customer-edit="pending"]');await csItem.waitFor();
  check((await csItem.locator('[data-customer-edit-status]').innerText()).trim(), 'بانتظار موافقة مدير المبيعات', 'with the sales manager');
  await noSideways(cs, 'customer service, tablet on its side');
  await shot(cs, 'customer-service-home-ar-tablet');
  const withdrawn = decision(cs);await csItem.locator('[data-customer-edit-cancel]').click();
  check((await (await withdrawn).json()).status, 'cancelled', 'customer service cancels it');
  await inbox(cs).locator('[data-customer-edit="cancelled"]').waitFor();checks++;
  check((await stored('c2')).contact2, undefined, 'nothing applied');
  await shot(cs, 'customer-service-cancelled-ar-tablet');
  await cs.context().close();
  // The sales manager's English card on a tablet upright and a 360 px phone: nothing sideways.
  const again = await row('c2');
  check((await call('rep', {action: 'save', kind: 'customer', id: 'c2', version: again.version, editKey: crypto.randomUUID(), data: {...again.data, notes: 'ملاحظة طويلة '.repeat(40)}})).status, 200, 'a request with a long note');
  check((await call('sup', {action: 'customer-edit', decision: 'approve', id: (await app.db.prepare("SELECT id FROM crm_audit WHERE action='customer-edit:request' AND record_id='c2' ORDER BY created_at DESC LIMIT 1").first()).id})).status, 200, 'passed on');
  for (const [viewport, label] of [[UPRIGHT, 'tablet'], [PHONE, '360']]) {
    const page = await open('mgr', {english: true, viewport});
    await inbox(page).locator('[data-customer-edit="pending"]').waitFor();
    await noSideways(page, 'the sales manager in English, ' + label);await fits(inbox(page), 'the card, ' + label);
    if (viewport === PHONE) await tall(inbox(page).locator('button'), 'the sales manager\'s card, phone');
    await noArabic(inbox(page), 'the sales manager\'s card in English, ' + label);
    await shot(page, 'manager-inbox-long-note-en-' + label);
    await page.context().close();
  }
  check(errors, [], 'no page errors');
  console.log(JSON.stringify({ok: true, checks, screenshots, scope: 'customer edit requests in Chromium: the representative\'s form and request (app, 360 and 320 px), the supervisor\'s reason and approval (tablet upright), the sales manager\'s approval in English (computer, tablet, 360 px), a rejection read in English, customer service\'s cancel (tablet on its side); nothing sideways, 44 px buttons on a phone', realBrowser: true}));
} finally {
  await browser?.close().catch(() => {});
  await app?.stop();
}
