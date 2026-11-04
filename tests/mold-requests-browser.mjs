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
// in Arabic and in English, with which specifications it shows. Since 2026-11-03: the form's required «طريقة الدفع» (نقدي / آجل, Cash /
// Deferred), the payment on the request and on the sales manager's list, the third approval as «اعتماد المالية», and a request the
// production manager restored after its cancellation: active again with why, a reason used before refused on the device, a new one
// cancelling it; the restore no longer said once the approvals completed or production cancelled it again, and said without the
// instruction to cancel to the sales manager; the payment the sales manager approves is production's now; the payment choice at phone
// width. Since production's second update of 2026-11-03: no number asked before the update is learned; then «رقم عرض السعر» and «رقم الـ
// PO» (one at least, Arabic digits) with the quotation's and PO's pickers, the request's numbers as production holds them (corrected
// there), the note when production lacks both, the sales manager's list with the numbers and the quotation's files, in English and at
// phone width. «رابط التصميم» no longer on the form, an older request's link read-only; customer service's request opened from the sales
// manager's «طلبات بانتظار اعتمادي» and approved there, not in his list (2026-11-03). Screenshots for the report. Synthetic fixtures only: temporary SQLite,
// no production data, no real production app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';
import {withSignature} from '../scripts/lib/signature-png.mjs';
import {drawSignature, padInked, signaturePad, signRequest} from '../scripts/lib/signature-pad.mjs';

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
  async function open(memberId, {viewport = DESKTOP, language = 'ar', touch = false} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', ...(touch ? {hasTouch: true, isMobile: true} : {})});
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
  const fill = async (dialog, customerName, payment = 'نقدي') => {
    if (customerName) { await dialog.locator('.mold-customer-search input').fill(customerName); await dialog.locator('.mold-customer-matches button', {hasText: customerName}).click(); }
    await dialog.locator('label.mold-field', {hasText: 'وصف القالب'}).locator('input').fill('200*400*27.5TH MM OPEN');
    for (const text of ['مفتوح', 'موديل قديم', 'بدون بلوكة نص']) await dialog.locator('.mold-choice label', {hasText: text}).click();
    await dialog.locator('.mold-choice', {hasText: 'عدد الرجاجات'}).locator('label', {hasText: '2'}).click();
    await dialog.locator('label.mold-field', {hasText: 'عرض القالب'}).locator('.mold-usual button', {hasText: '1380'}).click();
    await dialog.locator('label.mold-field', {hasText: 'مقاس الجلب'}).locator('.mold-usual button', {hasText: '795'}).click();
    await dialog.locator('.mold-choice', {hasText: 'طريقة الدفع'}).locator('label', {hasText: payment}).click();
  };
  // ---- The customer's signature (2026-11-04): drawn on the pad with pointer events, as a mouse, a finger (real touch through the DevTools
  //  protocol: the Android WebView's and a phone's) or a stylus (pen pointer events, a tablet's) does; 'dot' is a tap, no signature.
  const pad = signaturePad, drawOn = drawSignature, inked = padInked, sign = signRequest;
  const SIGNATURE_BLANK = 'التوقيع فاضي أو صغير قوي؛ خلّي العميل يوقّع بصباعه أو بالقلم', SIGNER_REQUIRED = 'اكتب اسم اللي بيوقّع عن العميل (من 2 إلى 80 حرف)';
  const goMoldsAnywhere = async page => {
    const more = page.locator('.mobile-bottom-navigation button[aria-haspopup="dialog"]');
    await page.locator('.mobile-bottom-navigation button[aria-haspopup="dialog"]:visible, button.nav-item:visible').first().waitFor();
    if (!await more.isVisible()) return goMolds(page);
    await more.click(); await page.locator('.mobile-overflow-pages button[data-page="mold-requests"]').click();
    await page.locator('.mobile-navigation-sheet').waitFor({state: 'detached'}); await page.locator('.mold-page').waitFor();
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
  check([await dialog.getByText('رابط التصميم').count(), await dialog.locator('input[type="url"]').count()], [0, 0], 'no «رابط التصميم» on the form any more (the owner, 2026-11-03)');
  // An incomplete request is refused on the device: no call reaches production.
  const before = mock.state.calls.length;
  await dialog.getByRole('button', {name: 'حفظ وإرسال للإنتاج'}).click();
  ok(await dialog.locator('.field-error', {hasText: 'اختر العميل'}).count() === 1, 'the form asks for the customer');
  ok(await dialog.locator('.field-error').count() >= 5, 'and points at each missing field');
  // How the customer pays: a required choice of two (2026-11-03).
  const paymentChoice = dialog.locator('.mold-choice', {hasText: 'طريقة الدفع'});
  check([await paymentChoice.locator('label').allInnerTexts(), await paymentChoice.locator('.field-error').innerText(), await paymentChoice.getAttribute('aria-invalid')], [['نقدي', 'آجل'], 'اختار طريقة الدفع: نقدي أو آجل', 'true'], 'the payment: نقدي or آجل, required');
  check(mock.state.calls.length, before, 'nothing was sent for an incomplete form');
  await fill(dialog, 'مصنع east1');
  check(await dialog.locator('.field-error').count(), 0, 'each message goes once its field is filled');
  await shot(rep, 'mold-form-desktop');
  await dialog.getByRole('button', {name: 'حفظ وإرسال للإنتاج'}).click();
  // ---- 1b. The customer signs first (2026-11-04): what they sign, who signs, the pad; nothing drawn, a tap, no name refused; «امسح» clears
  const step = dialog.locator('.mold-signing');
  await step.waitFor();
  check([await dialog.locator('form.mold-form').isVisible(), mock.state.calls.length, await step.locator('h3').innerText()], [false, before, 'توقيع العميل'], 'not sent yet: «حفظ وإرسال» opens «توقيع العميل» first');
  const summary = await step.locator('.mold-signing-summary').innerText();
  ok(['مصنع east1', '200*400*27.5TH MM OPEN', 'نقدي', 'مفتوح', 'موديل قديم'].every(text => summary.includes(text)) && /الكمية\s*1/.test(summary) && !summary.includes('الملفات'), 'the summary the customer reads: customer, mold, quantity, payment (no files: they may change without a new signature): ' + summary);
  check(await pad(rep).evaluate(canvas => getComputedStyle(canvas).touchAction), 'none', 'the pad takes the finger: no scroll or zoom while drawing');
  await step.getByRole('button', {name: 'تأكيد وإرسال'}).click();
  check(await step.locator('.field-error').allInnerTexts(), [SIGNER_REQUIRED, SIGNATURE_BLANK], 'no name and nothing drawn: both refused on the device');
  await step.locator('input[name="signer"]').fill('م. خالد العتيبي');
  await drawOn(rep, {shape: 'dot'});
  await step.getByRole('button', {name: 'تأكيد وإرسال'}).click();
  check([await inked(rep), await step.locator('.field-error').allInnerTexts()], [true, [SIGNATURE_BLANK]], 'a tap is no signature');
  await drawOn(rep);
  await step.getByRole('button', {name: 'امسح'}).click();
  check([await inked(rep), await step.getByRole('button', {name: 'امسح'}).isDisabled()], [false, true], '«امسح» clears the pad');
  await step.getByRole('button', {name: 'تأكيد وإرسال'}).click();
  check([await step.locator('.field-error').allInnerTexts(), mock.state.calls.length], [[SIGNATURE_BLANK], before], 'cleared: refused again; nothing was sent meanwhile');
  await drawOn(rep);
  check(await step.locator('.field-error').count(), 0, 'drawing clears the message');
  await shot(rep, 'mold-signing-desktop');
  await step.getByRole('button', {name: 'تأكيد وإرسال'}).click();
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
  check(await sheet(rep).locator('.mold-approvals li > span').allInnerTexts(), ['اعتماد مدير المبيعات', 'اعتماد الإنتاج', 'اعتماد المالية'], 'the third approval is finance\'s («اعتماد المالية»)');
  ok(/الدفع\s*نقدي/.test(await sheet(rep).locator('.mold-facts').nth(1).innerText()), 'the payment chosen is on the request');
  await shot(rep, 'mold-sheet-received');
  const sent = JSON.parse(mock.state.calls.findLast(call => call.route === 'requests').body);
  check([sent.customer.name, sent.specs.moldWidth, sent.specs.gelbaSize, sent.specs.vibrators, sent.payment], ['مصنع east1', 1380, 795, 2, 'cash'], 'production received what was chosen, the payment beside the specifications');
  check([Object.hasOwn(sent.specs, 'designUrl'), await sheet(rep).locator('.mold-facts dt', {hasText: 'رابط التصميم'}).count()], [false, 0], 'no design link sent, and none shown on the request');
  // The signature on the request: who and when, its image through the CRM, among the design files labelled and not deletable; at
  // production as a design image, sent after the request without category; the requests body carries nothing of it.
  const signedBy = sheet(rep).locator('.mold-signature-view');
  await signedBy.locator('img').waitFor();
  ok(/^وقّع العميل: م\. خالد العتيبي · \d/.test(await signedBy.locator('p').innerText()), '«وقّع العميل: <signer> · <time>»: ' + await signedBy.locator('p').innerText());
  await rep.waitForFunction(() => document.querySelector('.mold-sheet .mold-signature-view img')?.naturalWidth > 0);
  const signatureRow = sheet(rep).locator('.mold-design-file[data-signature="true"]');
  check([await signatureRow.locator('.mold-chip').innerText(), await signatureRow.locator('.mold-design-delete').count(), await signatureRow.locator('.mold-design-state').innerText()], ['توقيع العميل', 0, 'وصل للإنتاج'], 'in the files: labelled «توقيع العميل», no delete, delivered to production');
  const signatureLine = mock.state.calls.find(call => call.route === 'design-files' && call.body.includes(sent.crmRequestId));
  check([Object.keys(JSON.parse(signatureLine.body)), JSON.parse(signatureLine.body).name, mock.state.calls.indexOf(signatureLine) > mock.state.calls.findIndex(call => call.route === 'requests' && call.body.includes(sent.crmRequestId)), Object.keys(sent).includes('signature')],
    [['crmRequestId', 'crmFileId', 'name'], 'توقيع العميل - م. خالد العتيبي.png', true, false], 'production got the PNG as a design file without category, after the request; the body has no signature');
  const atProduction = mock.row(sent.crmRequestId).designFiles[0];
  check([atProduction.kind, atProduction.type, atProduction.bytes.subarray(1, 4).toString('latin1')], ['image', 'image/png', 'PNG'], 'a real PNG at production');
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
  await fill(dialog, 'مصنع east2', 'آجل');
  await dialog.getByRole('button', {name: 'حفظ وإرسال للإنتاج'}).click();
  await sign(rep, {signer: 'أ. منى'});
  await sheet(rep).locator('.mold-sending').waitFor();
  // Signed, but its image waits with the request: not said as signed yet.
  check([await sheet(rep).locator('.mold-signature-view').getAttribute('data-state'), (await sheet(rep).locator('.mold-signature-view p').innerText()).startsWith('التوقيع لسه ما وصلش للإنتاج'), await sheet(rep).locator('.mold-signature-view[data-signed]').count()], ['waiting', true, 0], 'the signature not at production yet: «التوقيع لسه ما وصلش للإنتاج»');
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
  // The payment too: the representative chose آجل (the CRM keeps that); the production manager made it نقدي.
  mock.edit(second, {customerName: 'مصنع east2 (عدّله الإنتاج)', salesmanName: 'مندوب عدّله الإنتاج', quantity: 3, description: 'وصف عدّله مدير الإنتاج', payment: 'cash'});
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
  ok(/الدفع:\s*نقدي/.test(crmPendingText) && !crmPendingText.includes('آجل') && !(await pendingCard.innerText()).includes('الدفع'), 'the payment with each request waiting as production holds it now, not the CRM\'s آجل (none for one registered without it)');
  // The CRM's request was signed by the customer (2026-11-04): said on its card, its image among the design files labelled so.
  const signedPending = sm.locator('.mold-pending', {hasText: 'مصنع east2 (عدّله الإنتاج)'});
  check([(await signedPending.locator('.mold-signature-view p').innerText()).startsWith('وقّع العميل: أ. منى'), await signedPending.locator('.mold-design-file[data-signature="true"] .mold-chip').innerText(), await sm.locator('.mold-pending', {hasText: 'مصنع مسجّل في الإنتاج'}).locator('.mold-signature-view').count()],
    [true, 'توقيع العميل', 0], '«طلبات بانتظار اعتمادي»: «وقّع العميل» on the CRM\'s signed request, none on one registered in production');
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
  check([await sheet(sm).locator('[data-slot="sheet-title"]').innerText(), askedNow.includes('وصف عدّله مدير الإنتاج'), /الكمية\s*3/.test(askedNow), (await sheet(sm).locator('.mold-facts').first().innerText()).includes('مندوب عدّله الإنتاج'), /الدفع\s*نقدي/.test(askedNow), askedNow.includes('آجل')],
    ['مصنع east2 (عدّله الإنتاج)', true, true, true, true, false], 'the sheet the sales manager approves from shows the request as production holds it now, its payment too');
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
  const refused = (await (await app.as(await app.login('rep'))('/api/mold-requests', {method: 'POST', body: withSignature('rep', {action: 'create', requestId: crypto.randomUUID(), customerId: 'east1', specs: {description: 'refused by production', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, quantity: 1}, payment: 'cash'})})).json()).request;
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
  // The quantity changed what the customer signed (2026-11-04): signed again, the new signature replacing the old.
  await edit.locator('.mold-signing-again').waitFor();
  const firstSigned = JSON.parse((await app.db.prepare('SELECT data FROM crm_mold_requests WHERE id=?').bind(refused.id).first()).data).signature.fileId;
  ok(/الكمية\s*2/.test(await edit.locator('.mold-signing-summary').innerText()), 'the summary shows the change the customer signs');
  await sign(editor, {signer: 'م. خالد العتيبي'});
  await edit.waitFor({state: 'detached'});
  const reSigned = JSON.parse((await app.db.prepare('SELECT data FROM crm_mold_requests WHERE id=?').bind(refused.id).first()).data).signature.fileId;
  check([reSigned !== firstSigned, (await app.db.prepare('SELECT deleted_at FROM crm_mold_design_files WHERE id=?').bind(firstSigned).first()).deleted_at !== null], [true, true], 'signed again: a new signature, the old one (never at production) removed');
  await sheet(editor).locator('.mold-specs-note').waitFor();
  check([await sheet(editor).locator('.mold-sending').count(), await sheet(editor).getByRole('button', {name: 'تعديل الطلب'}).count(), mock.row(refused.id)?.quantity], [0, 0, 2], 'the change was sent; production holds it now, so no more edits');
  await editor.context().close();

  // ---- 3c'. In English: the edit form is open on a request production never stored when its send reaches production (a resend from
  //  elsewhere). Saving is refused with the reason in English, the form stays open with it, and the request behind drops its edit at once.
  mock.answerNext('requests', 400, {error: {code: 'invalid_payload', message: 'Some fields are missing or invalid.', fields: ['specs.notes']}});
  const repApi = app.as(await app.login('rep'));
  const ask = async (description, customerId = 'east1') => (await (await repApi('/api/mold-requests', {method: 'POST', body: withSignature('rep', {action: 'create', requestId: crypto.randomUUID(), customerId, specs: {description, core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, quantity: 1}, payment: 'cash'})})).json()).request;
  const late = await ask('sent meanwhile');
  check([late.sending.state, late.can.edit], ['rejected', true], 'refused before production stored it: editable');
  const english = await open('rep', {language: 'en'});
  await goMolds(english);
  await english.locator('.mold-card', {hasText: 'sent meanwhile'}).click();
  await sheet(english).getByRole('button', {name: 'Edit request'}).click();
  const lateEdit = english.locator('.mold-dialog');
  await lateEdit.waitFor();
  check([await lateEdit.locator('.mold-choice', {hasText: 'Payment'}).locator('label').allInnerTexts(), await lateEdit.locator('.mold-choice', {hasText: 'Payment'}).locator('label[data-active="true"]').innerText()], [['Cash', 'Deferred'], 'Cash'], 'in English: Cash or Deferred, the request\'s own chosen');
  check((await repApi('/api/mold-requests', {method: 'POST', body: {action: 'resend', requestId: crypto.randomUUID(), id: late.id}})).status, 200, 'meanwhile its send reaches production');
  await lateEdit.locator('label.mold-field', {hasText: 'Quantity'}).locator('input').fill('4');
  await lateEdit.getByRole('button', {name: 'Save and send the change'}).click();
  // In English: the customer signs the change first («Customer signature»), then the server refuses it; the form comes back with why.
  check(await lateEdit.locator('.mold-signing h3').innerText(), 'Customer signature', 'the signing step in English');
  await sign(english, {signer: 'Khalid Al-Otaibi', input: 'pen', confirm: 'Confirm and send'});
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
  const asked = (await (await api('/api/mold-requests', {method: 'POST', body: withSignature('rep', {action: 'create', requestId: crypto.randomUUID(), customerId: 'east1', specs: {description: 'cancel while down', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, quantity: 1}, payment: 'deferred'})})).json()).request;
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

  // ---- 3g. 2026-11-03: the third approval is finance's; a cancellation the production manager restores
  const financeStep = await ask('waiting for finance');
  mock.approve(financeStep.id, 'sales'); mock.approve(financeStep.id, 'production');
  const SAME_REASON = 'مدير الإنتاج رجّع الطلب؛ عشان تلغيه تاني اكتب سبب جديد';
  const undone = await ask('restored after cancelling');
  check((await repApi('/api/mold-requests', {method: 'POST', body: {action: 'cancel', requestId: crypto.randomUUID(), id: undone.id, version: undone.version, reason: 'العميل أجّل'}})).status, 200, 'cancelled by the representative');
  mock.restore(undone.id);
  await stale();
  const restorer = await open('rep');
  await goMolds(restorer);
  const financeCard = restorer.locator('.mold-card', {hasText: 'waiting for finance'});
  check(await financeCard.locator('.mold-chip').innerText(), 'بانتظار اعتماد المالية', 'the card says it waits for finance');
  await financeCard.click();
  await sheet(restorer).locator('.mold-waiting', {hasText: 'بانتظار اعتماد المالية'}).waitFor();
  check([await sheet(restorer).locator('.mold-approvals li[data-done="true"]').count(), (await sheet(restorer).locator('.mold-approvals li').nth(2).innerText()).includes('اعتماد المالية'), (await sheet(restorer).innerText()).includes('مدير النظام')], [2, true, false], 'two approvals given, finance\'s next; the system administrator named nowhere');
  await restorer.waitForTimeout(300);
  await shot(restorer, 'mold-sheet-waiting-finance');
  await restorer.keyboard.press('Escape');
  await sheet(restorer).waitFor({state: 'detached'});
  // The production manager restored a cancelled request: the next status pull shows it active again, and says why.
  const undoneCard = restorer.locator('.mold-card', {hasText: 'restored after cancelling'});
  check(await undoneCard.locator('.mold-chip').innerText(), 'بانتظار اعتماد مدير المبيعات', 'the card shows where it stands again, not «cancelled»');
  await undoneCard.click();
  const restoredBanner = sheet(restorer).locator('.mold-restored');
  await restoredBanner.waitFor();
  check([await restoredBanner.innerText(), await sheet(restorer).locator('.mold-banner[data-kind="cancelled"]').count()], ['رجّعه مدير الإنتاج بعد الإلغاء؛ عشان تلغيه تاني اكتب سبب جديد.', 0], 'said on the request; no «cancelled» banner');
  await sheet(restorer).getByRole('button', {name: 'إلغاء الطلب'}).click();
  const cancelForm = sheet(restorer).locator('form.mold-cancel');
  await cancelForm.locator('textarea').fill(' العميل  أجّل ');
  ok((await cancelForm.innerText()).includes('سبب الإلغاء (سبب جديد)'), 'the form asks for a new reason');
  const cancelsBefore = mock.state.calls.filter(call => call.route === 'cancel').length;
  await cancelForm.getByRole('button', {name: 'تأكيد الإلغاء'}).click();
  check([await cancelForm.locator('.mold-reason-error').innerText(), mock.state.calls.filter(call => call.route === 'cancel').length - cancelsBefore], [SAME_REASON, 0], 'the reason used before is refused on the device, nothing sent');
  await restorer.waitForTimeout(300);
  await shot(restorer, 'mold-sheet-restored-same-reason');
  await cancelForm.locator('textarea').fill('سبب جديد');
  check(await cancelForm.locator('.mold-reason-error').count(), 0, 'the message goes as the reason changes');
  await cancelForm.getByRole('button', {name: 'تأكيد الإلغاء'}).click();
  await sheet(restorer).locator('.mold-banner[data-kind="cancelled"]', {hasText: 'سبب جديد'}).waitFor();
  check([mock.row(undone.id).cancelled, mock.row(undone.id).cancelReason, await sheet(restorer).locator('.mold-restored').count()], [true, 'سبب جديد', 0], 'a new reason cancels it, in production too');
  await restorer.context().close();
  // Restored, then moved on: the approvals completed, or production cancelled it again. The restore is no longer said (no «write a new
  // reason» where nothing can be cancelled). The sales manager, who may not cancel it, reads only that it was restored.
  const movedOn = await ask('restored, then approved'), cancelledAgain = await ask('restored, then cancelled there'), managerReads = await ask('restored, read by the manager');
  for (const request of [movedOn, cancelledAgain, managerReads]) {
    check((await repApi('/api/mold-requests', {method: 'POST', body: {action: 'cancel', requestId: crypto.randomUUID(), id: request.id, version: request.version, reason: 'تأجيل'}})).status, 200, 'cancelled by the representative');
    mock.restore(request.id);
  }
  await stale();
  const pulled = (await (await repApi('/api/mold-requests')).json()).requests;
  check([movedOn, cancelledAgain, managerReads].map(request => pulled.find(item => item.id === request.id)?.sending.error?.code), ['restored', 'restored', 'restored'], 'a pull shows each active again, and why is kept');
  for (const step of ['sales', 'production', 'admin']) mock.approve(movedOn.id, step);
  mock.remove(cancelledAgain.id);
  await stale();
  const movedOnPage = await open('rep');
  await goMolds(movedOnPage);
  await movedOnPage.locator('.mold-card', {hasText: 'restored, then approved'}).click();
  await sheet(movedOnPage).locator('.mold-locked').waitFor();
  check([await sheet(movedOnPage).locator('.mold-restored').count(), await sheet(movedOnPage).getByRole('button', {name: 'إلغاء الطلب'}).count()], [0, 0], 'restored, then the approvals completed: no restored banner, no cancelling');
  await movedOnPage.keyboard.press('Escape');
  await sheet(movedOnPage).waitFor({state: 'detached'});
  await movedOnPage.locator('.mold-card', {hasText: 'restored, then cancelled there'}).click();
  await sheet(movedOnPage).locator('.mold-banner[data-kind="cancelled"]').waitFor();
  check([await sheet(movedOnPage).locator('.mold-restored').count(), (await sheet(movedOnPage).locator('.mold-banner[data-kind="cancelled"]').innerText()).includes('أُلغي الطلب في تطبيق الإنتاج')], [0, true], 'cancelled again in production: said so, with no restored banner');
  await movedOnPage.context().close();
  const managerSheet = await open('sm');
  await goMolds(managerSheet);
  await managerSheet.locator('.mold-tabs button', {hasText: 'كل الطلبات'}).click();
  await managerSheet.locator('.mold-card', {hasText: 'restored, read by the manager'}).click();
  const managerBanner = sheet(managerSheet).locator('.mold-restored');
  await managerBanner.waitFor();
  check([await managerBanner.innerText(), await sheet(managerSheet).getByRole('button', {name: 'إلغاء الطلب'}).count()], ['رجّعه مدير الإنتاج بعد الإلغاء.', 0], 'the sales manager reads that it was restored, with no instruction to cancel (the requester\'s alone)');
  await managerSheet.context().close();

  // ---- 4. The phone keeps the representative's five tabs and adds «المزيد», where the page opens (the owner, 2026-11-03)
  const phone = await open('rep', {viewport: PHONE});
  await phone.locator('.mobile-tab[data-page="targets"]').waitFor();
  check(await phone.locator('.mobile-tab[data-page]').evaluateAll(tabs => tabs.map(tab => tab.getAttribute('data-page'))), ['customer', 'map', 'activity', 'followup', 'targets'], 'the same five tabs');
  {const more = phone.locator('.mobile-bottom-navigation button[aria-haspopup="dialog"]'), box = await more.boundingBox(), bar = await phone.locator('.mobile-bottom-navigation').boundingBox()
   check([await more.getAttribute('aria-label'), box.height >= 44, box.width >= 44, Math.round(bar.x + bar.width) <= PHONE.width], ['المزيد من الصفحات', true, true, true], '«المزيد» sits beside the five tabs, big enough to tap, inside the screen')
   await noOverflow(phone, 'phone bar with «المزيد»'); await more.click()}
  await phone.locator('.mobile-overflow-pages button[data-page="mold-requests"]').click();
  await phone.locator('.mobile-navigation-sheet').waitFor({state: 'detached'});
  await phone.locator('.mold-page .mold-card').nth(1).waitFor();
  await noOverflow(phone, 'phone list'); await shot(phone, 'mold-list-phone');
  await phone.locator('.mold-card').first().click();
  await sheet(phone).waitFor();
  await phone.waitForFunction(() => { const box = document.querySelector('.mold-sheet')?.getBoundingClientRect(); return !!box && box.left >= -1 && box.right <= innerWidth + 1 && box.width >= innerWidth - 2; });
  await sheet(phone).locator('.mold-stages li').first().waitFor();
  await noOverflow(phone, 'phone sheet'); await shot(phone, 'mold-sheet-phone');
  await phone.keyboard.press('Escape');
  await sheet(phone).waitFor({state: 'detached'});
  // The form at phone width: «طريقة الدفع» fits, and either choice can be tapped.
  await phone.locator('button.mold-new').click();
  const phonePayment = phone.locator('.mold-dialog .mold-choice', {hasText: 'طريقة الدفع'});
  await phonePayment.scrollIntoViewIfNeeded();
  for (const text of ['آجل', 'نقدي']) {
    await phonePayment.locator('label', {hasText: text}).click();
    check(await phonePayment.locator('label[data-active="true"]').innerText(), text, 'tapped on the phone: ' + text);
  }
  check(await phonePayment.evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= -1 && box.right <= innerWidth + 1; }), true, 'the payment choice fits the phone');
  await noOverflow(phone, 'phone form'); await shot(phone, 'mold-form-phone-payment');
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

  // ---- 5b. «رابط التصميم» is no longer asked for (the owner, 2026-11-03): an older request keeps its own link, shown read-only on its
  //  sheet and in the edit of a request never sent; the form sends none, so the link stays as stored and goes with the edit.
  const linkedId = 'mr-' + crypto.randomUUID(), linkedAt = new Date().toISOString(), east1Number = (await app.db.prepare("SELECT number FROM crm_customer_numbers WHERE customer_id='east1'").first()).number;
  const linkedData = {requestedAt: '2026-11-02T10:00:00+03:00', customer: {crmNumber: east1Number, name: 'مصنع east1', address: 'حي الصناعية', city: 'Damam - الدمام'}, salesman: {crmMemberId: 'rep', name: 'أحمد عبد العزيز', email: 'rep@yourrest.org'},
    specs: {description: 'older, with a design link', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: '', quantity: 1, designUrl: 'https://drive.google.com/older-design', notes: ''}, payment: 'cash'};
  // Saved by the earlier release and never sent yet (its next try far away): still the representative's to edit.
  await app.db.prepare("INSERT INTO crm_mold_requests(id,member_id,customer_id,data,outbox,next_attempt_at,created_by,created_at,updated_at,version) VALUES(?,'rep','east1',?,'send','2099-01-01T00:00:00.000Z','rep',?,?,1)").bind(linkedId, JSON.stringify(linkedData), linkedAt, linkedAt).run();
  const linkedPage = await open('rep');
  await goMolds(linkedPage);
  await linkedPage.locator('.mold-card', {hasText: 'older, with a design link'}).click();
  const linkRow = sheet(linkedPage).locator('.mold-facts > div', {hasText: 'رابط التصميم'});
  await linkRow.waitFor();
  check([await linkRow.locator('a').getAttribute('href'), await linkRow.locator('a').innerText()], ['https://drive.google.com/older-design', 'فتح الرابط'], 'the older request\'s design link, shown read-only on its sheet');
  await sheet(linkedPage).getByRole('button', {name: 'تعديل الطلب'}).click();
  const linkedEdit = linkedPage.locator('.mold-dialog');
  await linkedEdit.waitFor();
  check([await linkedEdit.locator('.mold-design-link-kept a').getAttribute('href'), await linkedEdit.locator('input[type="url"]').count(), await linkedEdit.locator('label.mold-field', {hasText: 'رابط التصميم'}).count()],
    ['https://drive.google.com/older-design', 0, 0], 'its edit shows the link read-only (kept as it is), with no field to change it');
  await linkedPage.waitForTimeout(400);
  await shot(linkedPage, 'mold-edit-older-design-link');
  await linkedEdit.locator('label.mold-field', {hasText: 'الكمية'}).locator('input').fill('2');
  await linkedEdit.getByRole('button', {name: 'حفظ وإرسال التعديل'}).click();
  // An older request (no signature): its changing edit is signed by the customer now (no «sign again» note: there was none before).
  check(await linkedEdit.locator('.mold-signing-again').count(), 0, 'an older request had no signature: signed now, not «again»');
  await sign(linkedPage);
  await linkedEdit.waitFor({state: 'detached'});
  const linkedSent = JSON.parse(mock.state.calls.filter(call => call.route === 'requests' && call.body.includes(linkedId)).at(-1).body);
  check([linkedSent.specs.designUrl, linkedSent.specs.quantity, JSON.parse((await app.db.prepare('SELECT data FROM crm_mold_requests WHERE id=?').bind(linkedId).first()).data).specs.designUrl],
    ['https://drive.google.com/older-design', 2, 'https://drive.google.com/older-design'], 'saved and sent with its link exactly as stored');
  await linkedPage.context().close();

  // ---- 5c. Who sees which (the owner, 2026-11-03): customer service's request is not in the sales manager's list (his own and his team's);
  //  it waits for him in «طلبات بانتظار اعتمادي», opens from there («فتح الطلب») and is approved from its sheet.
  const csmApi = app.as(await app.login('csm'));
  const fromService = (await (await csmApi('/api/mold-requests', {method: 'POST', body: {action: 'create', requestId: crypto.randomUUID(), customerId: 'east1', specs: {description: 'طلب خدمة العملاء', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, quantity: 1}, payment: 'cash'}})).json()).request;
  // An approval by order number reads production's waiting list afresh (the server keeps it a minute otherwise); none has that number.
  await app.as(await app.login('sm'))('/api/mold-requests', {method: 'POST', body: {action: 'approve-order', requestId: crypto.randomUUID(), orderNo: 999999}});
  const serviceManager = await open('sm');
  await goMolds(serviceManager);
  const serviceCard = serviceManager.locator('.mold-pending', {hasText: 'طلب خدمة العملاء'});
  await serviceCard.waitFor();
  await serviceCard.getByRole('button', {name: 'فتح الطلب'}).click();
  await sheet(serviceManager).locator('.mold-specs-note[data-source="production"]').waitFor();
  check([await sheet(serviceManager).locator('[data-slot="sheet-title"]').innerText(), (await sheet(serviceManager).locator('.mold-facts').first().innerText()).includes('csm')], ['مصنع east1', true], 'customer service\'s request opens from the waiting list, though his list does not hold it');
  await serviceManager.waitForTimeout(400);
  await shot(serviceManager, 'mold-sheet-approver-customer-service');
  await sheet(serviceManager).getByRole('button', {name: 'اعتماد', exact: true}).click();
  await sheet(serviceManager).getByRole('button', {name: 'سحب الاعتماد'}).waitFor();
  check(!!mock.row(fromService.id).approvals.sales, true, 'approved from its sheet, at production too');
  await serviceManager.keyboard.press('Escape');
  await sheet(serviceManager).waitFor({state: 'detached'});
  await serviceManager.locator('.mold-tabs button', {hasText: 'كل الطلبات'}).click();
  await serviceManager.locator('.mold-card').first().waitFor();
  check(await serviceManager.locator('.mold-card', {hasText: 'طلب خدمة العملاء'}).count(), 0, 'and it is not in his list (his own and his team\'s)');
  await serviceManager.context().close();

  // ---- 6. 2026-11-03 (production's second update): the quotation and PO numbers. Before the update the form asks nothing new; once the
  // CRM learns it (a pull), «رقم عرض السعر» and «رقم الـ PO» (one at least, Arabic digits accepted) and their files' pickers (a PDF or an
  // image); the request shows production's numbers (its production manager's correction included) and the note when production lacks
  // both; the sales manager's list shows the numbers and the quotation's files; in English; at phone width
  const quoteRep = await open('rep');
  await goMolds(quoteRep);
  await quoteRep.locator('button.mold-new').click();
  let quoteDialog = quoteRep.locator('.mold-dialog');
  await quoteDialog.waitFor();
  check([await quoteDialog.locator('input[name="quoteNo"]').count(), await quoteDialog.locator('.mold-design-picker').count()], [0, 1], 'the older products application: no number field, the design files\' picker only');
  await quoteRep.keyboard.press('Escape');
  await quoteDialog.waitFor({state: 'detached'});
  mock.setQuotePo(true);
  await stale();
  await quoteRep.locator('.mold-heading-tools button').first().click();
  await quoteRep.waitForFunction(() => !document.querySelector('.mold-heading-tools button .spin'));
  await quoteRep.locator('button.mold-new').click();
  quoteDialog = quoteRep.locator('.mold-dialog');
  const numbers = quoteDialog.locator('.mold-quote-po-fields');
  await numbers.waitFor();
  check([await numbers.locator('legend').innerText(), await numbers.locator('label.mold-field').allInnerTexts()], ['عرض السعر والـ PO (واحد على الأقل)', ['رقم عرض السعر', 'رقم الـ PO']], 'learned from a pull: the two numbers, one at least');
  const pickers = await quoteDialog.locator('.mold-design-picker').evaluateAll(list => list.map(picker => [picker.getAttribute('data-category'), picker.querySelector('legend').textContent, picker.querySelector('input[type=file]').getAttribute('accept')]));
  check([pickers.map(([category, legend]) => [category, legend]), pickers[0][2].includes('.dwg'), pickers[1][2], pickers[2][2]],
    [[['design', 'ملفات التصميم (اختياري)'], ['quote', 'ملفات عرض السعر (اختياري)'], ['po', 'ملفات الـ PO (اختياري)']], true, '.pdf,.png,.jpg,.jpeg,.webp,.gif', '.pdf,.png,.jpg,.jpeg,.webp,.gif'], 'and the quotation\'s and PO\'s pickers, a PDF or an image only');
  await fill(quoteDialog, 'مصنع east2');
  const unsent = mock.state.calls.length;
  await quoteDialog.getByRole('button', {name: 'حفظ وإرسال للإنتاج'}).click();
  check([await numbers.locator('.field-error').innerText(), await numbers.getAttribute('aria-invalid'), mock.state.calls.length], ['اكتب رقم عرض السعر أو رقم الـ PO (واحد على الأقل)', 'true', unsent], 'neither: refused on the device, nothing sent');
  await quoteDialog.locator('input[name="quoteNo"]').fill('Q-٢٠٢٦-٠١٥٣');
  check(await numbers.locator('.field-error').count(), 0, 'typing one clears it');
  await quoteDialog.locator('.mold-design-picker[data-category="quote"] input[type=file]').setInputFiles([{name: 'رسم.dwg', mimeType: 'application/octet-stream', buffer: Buffer.from('AC1027')}, {name: 'عرض سعر Q-2026-0153.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 synthetic quotation')}]);
  const quotePicker = quoteDialog.locator('.mold-design-picker[data-category="quote"]');
  await quotePicker.locator('.mold-design-reason').waitFor();
  check([await quotePicker.locator('.mold-design-reason').innerText(), await quotePicker.locator('.mold-design-file[data-state="ready"]').count()], ['ملف عرض السعر أو الـ PO لازم يكون PDF أو صورة', 1], 'a drawing as the quotation: refused on the device; the PDF will go');
  await shot(quoteRep, 'mold-form-quote-po');
  await quoteDialog.getByRole('button', {name: 'حفظ وإرسال للإنتاج'}).click();
  ok((await quoteDialog.locator('.mold-signing-summary').innerText()).includes('Q-2026-0153'), 'the customer signs with the quotation number in the summary');
  await sign(quoteRep);
  await sheet(quoteRep).waitFor();
  const quoteSent = JSON.parse(mock.state.calls.findLast(call => call.route === 'requests' && call.signed).body), quotedId = quoteSent.crmRequestId;
  check([quoteSent.quoteNo, Object.hasOwn(quoteSent, 'poNo')], ['Q-2026-0153', false], 'sent with the quotation number in ASCII digits, no PO number');
  const quoteFacts = sheet(quoteRep).locator('.mold-facts').first();
  await quoteFacts.locator('dd', {hasText: 'Q-2026-0153'}).waitFor();
  ok(/رقم الـ PO\s*—/.test(await quoteFacts.innerText()), 'the PO number not given: —');
  const quoteGroup = sheet(quoteRep).locator('section.mold-design[data-category="quote"]');
  await quoteGroup.locator('.mold-design-file', {hasText: 'عرض سعر Q-2026-0153.pdf'}).locator('.mold-design-state', {hasText: 'وصل للإنتاج'}).waitFor();
  check([await sheet(quoteRep).locator('section.mold-design').evaluateAll(sections => sections.map(section => section.getAttribute('data-category'))), await quoteGroup.locator('.mold-design-count').innerText()], [['design', 'quote', 'po'], '1/5'], 'the request\'s files in three groups; the quotation file reached production in its own (1 of 5)');
  check(mock.row(quotedId).designFiles.map(file => [file.category, file.name.startsWith('توقيع العميل')]), [['design', true], ['quote', false]], 'production holds it as the quotation\'s (beside the customer\'s signature, a design file)');
  await quoteRep.waitForFunction(() => { const box = document.querySelector('.mold-sheet')?.getBoundingClientRect(); return !!box && box.left >= -1 && box.right <= innerWidth + 1; });
  await quoteGroup.scrollIntoViewIfNeeded();
  await shot(quoteRep, 'mold-sheet-quote-po');
  await quoteRep.keyboard.press('Escape');
  await sheet(quoteRep).waitFor({state: 'detached'});
  // The production manager corrects and adds in the products application: the request shows production's numbers
  mock.setNumbers(quotedId, {quoteNo: 'Q-2026-0153-B', poNo: 'PO-٧٧٨١'});
  await stale();
  await quoteRep.locator('.mold-heading-tools button').first().click();
  const quoteCard = quoteRep.locator('.mold-card', {hasText: 'Q-2026-0153-B'});
  await quoteCard.waitFor();
  check(await quoteCard.locator('.mold-quote-po').allInnerTexts(), ['رقم عرض السعر: Q-2026-0153-B', 'رقم الـ PO: PO-7781'], 'the card shows production\'s numbers now');
  // Production lacks both (its production manager cleared them): the note, on the card and the request
  mock.setNumbers(quotedId, {quoteNo: '', poNo: ''});
  await stale();
  await quoteRep.locator('.mold-heading-tools button').first().click();
  const missingCard = quoteRep.locator('.mold-card', {has: quoteRep.locator('.mold-quote-po-missing')});
  await missingCard.waitFor();
  check(await missingCard.locator('.mold-quote-po-missing').innerText(), 'ناقص عرض السعر / الـ PO، يضيفه مدير الإنتاج', 'the card says production lacks both');
  await missingCard.click();
  await sheet(quoteRep).locator('.mold-quote-po-missing').waitFor();
  await quoteRep.context().close();
  mock.setNumbers(quotedId, {quoteNo: 'Q-2026-0153-B'});
  // The sales manager's list: the numbers as production holds them, and the quotation's files with their links
  const quoteManager = await open('sm');
  await goMolds(quoteManager);
  const quotePending = quoteManager.locator('.mold-pending', {hasText: 'Q-2026-0153-B'});
  await quotePending.waitFor();
  check([await quotePending.locator('.mold-quote-po').allInnerTexts(), await quotePending.locator('.mold-quote-po-missing').count()], [['رقم عرض السعر: Q-2026-0153-B'], 0], 'waiting for the sales manager: production\'s number, nothing missing');
  const quoteFiles = quotePending.locator('.mold-design-compact[data-category="quote"]');
  check([await quoteFiles.locator('.mold-design-title').innerText(), await quoteFiles.locator('a', {hasText: 'تنزيل'}).count()], ['ملفات عرض السعر (1)', 1], 'the quotation\'s files, each to download');
  const [download] = await Promise.all([quoteManager.waitForEvent('download'), quoteFiles.locator('a', {hasText: 'تنزيل'}).click()]);
  check(Buffer.compare(fs.readFileSync(await download.path()), Buffer.from('%PDF-1.7 synthetic quotation')), 0, 'downloaded through the CRM');
  await shot(quoteManager, 'mold-pending-quote-po');
  await quoteManager.context().close();
  // In English, and at phone width
  const englishPhone = await open('rep', {language: 'en', viewport: PHONE});
  // «المزيد» (More) beside the five tabs since the merge of the representative's sixth tab; the account sheet lists no pages any more.
  await englishPhone.locator('.mobile-bottom-navigation button[aria-haspopup="dialog"]').click();
  await englishPhone.locator('.mobile-overflow-pages button[data-page="mold-requests"]').click();
  await englishPhone.locator('.mobile-navigation-sheet').waitFor({state: 'detached'});
  await englishPhone.locator('button.mold-new').click();
  const englishNumbers = englishPhone.locator('.mold-dialog .mold-quote-po-fields');
  await englishNumbers.waitFor();
  await englishPhone.locator('.mold-dialog').getByRole('button', {name: 'Save and send to production'}).click();
  check([await englishNumbers.locator('legend').innerText(), await englishNumbers.locator('label.mold-field').allInnerTexts(), await englishNumbers.locator('.field-error').first().innerText()],
    ['Quotation and PO (at least one)', ['Quotation no.', 'PO no.'], 'Type the quotation number or the PO number (at least one)'], 'in English');
  await englishNumbers.scrollIntoViewIfNeeded();
  check(await englishNumbers.evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= -1 && box.right <= innerWidth + 1; }), true, 'the numbers fit the phone');
  await noOverflow(englishPhone, 'phone form with the numbers'); await shot(englishPhone, 'mold-form-quote-po-phone');
  await englishPhone.context().close();

  // ---- 6. The customer signs on a phone (360 px, a finger: real touch events, Arabic) and on a tablet (a stylus, English) turned from
  //  portrait to landscape while signing: the pad fits, the page does not scroll while drawing, the drawing survives the turn.
  const signPhone = await open('rep', {viewport: PHONE, touch: true});
  await goMoldsAnywhere(signPhone);
  await signPhone.locator('button.mold-new').click();
  const phoneDialog = signPhone.locator('.mold-dialog');
  await fill(phoneDialog, 'مصنع east1');
  // production's update of 2026-11-03 is known by now: a number at least
  await phoneDialog.locator('input[name="poNo"]').fill('PO-٤٤');
  await phoneDialog.getByRole('button', {name: 'حفظ وإرسال للإنتاج'}).click();
  await phoneDialog.locator('.mold-signing').waitFor();
  ok((await phoneDialog.locator('.mold-signing-summary').innerText()).includes('PO-44'), 'the PO number in what the customer signs');
  check(await signPhone.evaluate(() => { const dialog = document.querySelector('.mold-dialog'), title = dialog.querySelector('.mold-signing h3').getBoundingClientRect(); return [dialog.scrollTop, title.top >= 0 && title.bottom <= innerHeight]; }), [0, true], 'the step opens at its top: the customer reads the summary first');
  await pad(signPhone).scrollIntoViewIfNeeded();
  const phonePad = await pad(signPhone).boundingBox();
  check([phonePad.x >= 0, phonePad.x + phonePad.width <= PHONE.width, phonePad.width >= 260, Math.round(phonePad.width / phonePad.height)], [true, true, true, 2], 'the pad fits the phone, 2:1');
  await noOverflow(signPhone, 'phone signing step');
  const scrolled = () => signPhone.evaluate(() => [scrollY, document.querySelector('.mold-dialog').scrollTop]);
  const beforeDrawing = await scrolled();
  await drawOn(signPhone, {input: 'touch'});
  check([await inked(signPhone), await scrolled()], [true, beforeDrawing], 'a finger draws, and neither the page nor the dialog scrolls');
  // Turned to landscape and back: the pad changes width and redraws the same signature each time.
  for (const viewport of [{width: PHONE.height, height: PHONE.width}, PHONE]) {
    const width = (await pad(signPhone).boundingBox()).width;
    await signPhone.setViewportSize(viewport);
    await signPhone.waitForFunction(old => Math.abs(document.querySelector('.mold-signing .mold-signature-pad').getBoundingClientRect().width - old) > 1, width);
    await signPhone.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const turned = await pad(signPhone).boundingBox();
    check([await inked(signPhone), Math.round(turned.width / turned.height), turned.x + turned.width <= viewport.width], [true, 2, true], 'the phone turned to ' + viewport.width + '×' + viewport.height + ': the signature redrawn on the resized pad');
  }
  await phoneDialog.locator('input[name="signer"]').fill('م. سالم الدوسري');
  await shot(signPhone, 'mold-signing-phone');
  await phoneDialog.getByRole('button', {name: 'تأكيد وإرسال'}).click();
  await sheet(signPhone).locator('.mold-signature-view img').waitFor();
  ok((await sheet(signPhone).locator('.mold-signature-view p').innerText()).startsWith('وقّع العميل: م. سالم الدوسري'), 'signed on the phone: the sheet says so');
  await signPhone.waitForFunction(() => document.querySelector('.mold-sheet .mold-signature-view img')?.naturalWidth > 0);
  await sheet(signPhone).locator('.mold-signature-view').scrollIntoViewIfNeeded();
  await noOverflow(signPhone, 'phone sheet with the signature'); await shot(signPhone, 'mold-sheet-signature-phone');
  await signPhone.context().close();
  const TABLET = {width: 820, height: 1180};
  const tablet = await open('rep', {viewport: TABLET, language: 'en', touch: true});
  await goMoldsAnywhere(tablet);
  await tablet.locator('button.mold-new').click();
  const tabletDialog = tablet.locator('.mold-dialog');
  await tabletDialog.locator('.mold-customer-search input').fill('مصنع east2');
  await tabletDialog.locator('.mold-customer-matches button', {hasText: 'مصنع east2'}).click();
  await tabletDialog.locator('label.mold-field', {hasText: 'Mold description'}).locator('input').fill('TABLET MOLD 400');
  for (const text of ['open', 'old', 'none']) await tabletDialog.locator('.mold-choice label', {hasText: new RegExp('^' + text + '$')}).click();
  await tabletDialog.locator('.mold-choice', {hasText: 'Vibrators'}).locator('label', {hasText: '3'}).click();
  await tabletDialog.locator('label.mold-field', {hasText: 'Mold width'}).locator('.mold-usual button', {hasText: '1375'}).click();
  await tabletDialog.locator('label.mold-field', {hasText: 'Gelba size'}).locator('.mold-usual button', {hasText: '800'}).click();
  await tabletDialog.locator('.mold-choice', {hasText: 'Payment'}).locator('label', {hasText: 'Deferred'}).click();
  await tabletDialog.locator('input[name="quoteNo"]').fill('Q-TAB-7');
  // The customer signature takes the tenth design place: said by the picker before anything is chosen.
  check(await tabletDialog.locator('.mold-design-picker[data-category="design"] .mold-signature-room').innerText(), 'The customer\'s signature takes one of the 10 places; up to 9 design files', 'the form leaves room for the signature, and says so');
  await tabletDialog.locator('.mold-design-picker[data-category="design"] input[type=file]').setInputFiles(Array.from({length: 10}, (_, n) => ({name: 'drawing ' + (n + 1) + '.dwg', mimeType: 'application/octet-stream', buffer: Buffer.from('AC1027 ' + n)})));
  const tenth = tabletDialog.locator('.mold-design-picker[data-category="design"] .mold-design-file[data-state="refused"]');
  await tenth.waitFor();
  check([await tenth.count(), await tenth.locator('.mold-design-reason').innerText(), await tabletDialog.locator('.mold-design-picker[data-category="design"] .mold-design-file[data-state="ready"]').count()], [1, 'The tenth place is the customer\'s signature; up to 9 design files', 9], 'ten chosen: nine go, the tenth is refused for the signature\'s place');
  await tenth.getByRole('button', {name: /Remove/}).click();
  await tabletDialog.getByRole('button', {name: 'Save and send to production'}).click();
  const tabletStep = tabletDialog.locator('.mold-signing');
  await tabletStep.waitFor();
  const summaryEn = await tabletStep.locator('.mold-signing-summary').innerText();
  ok(['مصنع east2', 'TABLET MOLD 400', 'Deferred', 'open', 'old', 'Q-TAB-7'].every(text => summaryEn.includes(text)) && !summaryEn.includes('Files'), 'what the customer signs, in English (the request\'s data, not its files): ' + summaryEn);
  await tabletStep.getByRole('button', {name: 'Confirm and send'}).click();
  check(await tabletStep.locator('.field-error').allInnerTexts(), ['Type the name of the person signing for the customer (2 to 80 characters)', 'The signature is empty or too small; have the customer sign with a finger or a stylus'], 'refused in English: the name and the blank pad');
  const portraitPad = await pad(tablet).boundingBox();
  await drawOn(tablet, {input: 'pen'});
  check(await inked(tablet), true, 'a stylus draws (pen pointer events)');
  await tablet.setViewportSize({width: TABLET.height, height: TABLET.width});
  await tablet.waitForFunction(() => innerWidth > innerHeight);
  await tablet.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const landscapePad = await pad(tablet).boundingBox();
  check([await inked(tablet), Math.round(landscapePad.width / landscapePad.height), landscapePad.x + landscapePad.width <= TABLET.height, Math.abs(landscapePad.width - portraitPad.width) < 2], [true, 2, true, true], 'turned to landscape: the pad keeps its place in the dialog, its shape and the signature');
  await noOverflow(tablet, 'tablet landscape signing step');
  await tabletStep.locator('input[name="signer"]').fill('Khalid Al-Otaibi');
  await shot(tablet, 'mold-signing-tablet-landscape');
  await tabletStep.getByRole('button', {name: 'Confirm and send'}).click();
  await sheet(tablet).locator('.mold-signature-view img').waitFor();
  ok((await sheet(tablet).locator('.mold-signature-view p').innerText()).startsWith('Signed by the customer: Khalid Al-Otaibi'), 'the sheet in English: «Signed by the customer: <signer> · <time>»');
  const tabletSigned = sheet(tablet).locator('.mold-design-file[data-signature="true"]');
  await tabletSigned.waitFor();
  check([await tabletSigned.locator('.mold-chip').innerText(), await tabletSigned.locator('.mold-design-delete').count(), await sheet(tablet).locator('section.mold-design[data-category="design"] .mold-design-count').innerText()], ['Customer signature', 0, '10/10'], 'labelled, not deletable, and the tenth of the ten places once the nine upload');
  await tablet.context().close();

  // ---- 6b. A 320×640 phone (density 2): the answer of «تأكيد وإرسال» is lost (the server saved the request; the connection dropped), the
  //  representative turns the phone and taps again: the same signature, the same body, the same identifier: one request, not two. A
  //  server refusal of the name clears as soon as the name is changed.
  const lost = await open('rep', {viewport: {width: 320, height: 640}, touch: true});
  await goMoldsAnywhere(lost);
  await lost.locator('button.mold-new').click();
  const lostDialog = lost.locator('.mold-dialog');
  await fill(lostDialog, 'مصنع east1');
  await lostDialog.locator('label.mold-field', {hasText: 'وصف القالب'}).locator('input').fill('LOST ANSWER MOLD');
  await lostDialog.locator('input[name="quoteNo"]').fill('Q-LOST-1');
  await lostDialog.getByRole('button', {name: 'حفظ وإرسال للإنتاج'}).click();
  const lostStep = lostDialog.locator('.mold-signing');
  await lostStep.waitFor();
  check(await lost.evaluate(() => document.querySelector('.mold-dialog').scrollTop), 0, '320 px: the step opens at its top');
  await noOverflow(lost, '320 px signing step');
  await lostStep.locator('input[name="signer"]').fill('م. خالد');
  await drawSignature(lost, {input: 'touch'});
  const posts = [];
  let dropAnswer = true;
  await lost.route('**/api/mold-requests', async route => {
    const request = route.request();
    if (request.method() !== 'POST') return route.continue();
    posts.push(request.postData());
    if (!dropAnswer) return route.continue();
    dropAnswer = false;
    // The server does the work; the answer never reaches the phone.
    const url = new URL(request.url()), host = url.host; url.hostname = '127.0.0.1';
    await route.fetch({url: url.toString(), headers: {...request.headers(), host}});
    return route.abort('connectionreset');
  });
  const lostCount = () => app.db.prepare("SELECT COUNT(*) AS n FROM crm_mold_requests WHERE json_extract(data,'$.specs.description')='LOST ANSWER MOLD'").first();
  await lostStep.getByRole('button', {name: 'تأكيد وإرسال'}).click();
  await lostStep.locator('.form-error').waitFor();
  check((await lostCount()).n, 1, 'the first tap was saved by the server, though its answer was lost');
  await lost.setViewportSize({width: 640, height: 320});
  await lost.waitForFunction(() => innerWidth > innerHeight);
  await lostStep.getByRole('button', {name: 'تأكيد وإرسال'}).click();
  await sheet(lost).locator('.mold-signature-view').waitFor();
  const [firstPost, secondPost] = posts.map(text => JSON.parse(text));
  check([posts.length, posts[0] === posts[1], firstPost.requestId === secondPost.requestId, (await lostCount()).n, (await app.db.prepare("SELECT COUNT(*) AS n FROM crm_mold_design_files WHERE name='توقيع العميل - م. خالد.png'").first()).n],
    [2, true, true, 1, 1], 'turned and tapped again: the very same body under the same identifier, one request and one signature');
  await lost.unrouteAll();
  await lost.context().close();
  // The server's refusal of the name (a page whose own check passed it, here a name of control characters only once normalized) is said
  // beside the field until the name changes.
  const nameCheck = await open('rep', {viewport: PHONE, touch: true});
  await goMoldsAnywhere(nameCheck);
  await nameCheck.locator('button.mold-new').click();
  const nameDialog = nameCheck.locator('.mold-dialog');
  await fill(nameDialog, 'مصنع east2');
  await nameDialog.locator('input[name="poNo"]').fill('PO-NAME');
  await nameDialog.getByRole('button', {name: 'حفظ وإرسال للإنتاج'}).click();
  await nameDialog.locator('.mold-signing').waitFor();
  await nameCheck.route('**/api/mold-requests', route => route.request().method() === 'POST' ? route.fulfill({status: 400, contentType: 'application/json', body: JSON.stringify({error: SIGNER_REQUIRED, fields: {signer: SIGNER_REQUIRED}})}) : route.continue());
  await sign(nameCheck, {signer: 'م. سالم'});
  const signerError = nameDialog.locator('.mold-signer .field-error');
  await signerError.waitFor();
  check(await signerError.innerText(), SIGNER_REQUIRED, 'the server\'s refusal of the name, beside it');
  await nameDialog.locator('input[name="signer"]').fill('م. سالم الدوسري');
  check(await signerError.count(), 0, 'gone as soon as the name changes');
  await nameCheck.unrouteAll();
  await nameCheck.context().close();

  check(JSON.stringify(mock.state.calls).includes(mock.state.secret), false, 'the secret never travelled in a body');
  ok(!errors.length, 'no uncaught page errors: ' + errors.join(' | '));
  console.log(JSON.stringify({ok: true, checks, screenshots, realChromium: true, productionApplicationReal: false, productionDataUsed: false}));
} finally {
  await browser?.close(); await app.stop(); await mock.stop();
}
