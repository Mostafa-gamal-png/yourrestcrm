// The products update of 2026-11-10 in a real Chromium against the BUILT release (run the build first), sending to the stand-in
// production API as the updated application (schema 17):
// - on a phone of 360 px in Arabic the representative asks for a mold paid «آجل»: «طريقة الدفع المتفق عليها» appears with its three
//   choices only then and is required («اختر طريقة الدفع المتفق عليها»); the customer signs the terms with the rest (the signing step
//   says them); the card says «الدفع: آجل · <the terms>»; production receives paymentTerms;
// - the sales manager, on a phone in Arabic: the request in «طلبات بانتظار اعتمادي» with its terms, «اعتماد» waits for the box
//   «تمت الموافقة على التصنيع بشروط الدفع المذكورة وقت الإستلام», and the approval goes with termsAccepted;
// - finance sends it back: the representative's card says «أعادتها المالية: <السبب>», the list offers the filter «أعادتها المالية»,
//   the sheet says «أعادته المالية (<name>): <reason> · <time>» and offers «تعديل وإعادة الإرسال»; the dialog says why, the change is
//   signed again, saved and sent as a correction; the sheet says «أُرسل التعديل إلى الإنتاج»; the sales manager's list says why too, in
//   Arabic and in English (a computer), and approving again clears it.
// No page scrolls sideways at 360 px. Screenshots for the report. Synthetic fixtures only: temporary SQLite, PDFs made here, no
// production data, no real production app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {PDFDocument, StandardFonts} from 'pdf-lib';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';
import {signRequest} from '../scripts/lib/signature-pad.mjs';
import {signatureInput} from '../scripts/lib/signature-png.mjs';

const require = createRequire(import.meta.url), {chromium} = require('playwright');
const members = [{id: 'owner', role: 'admin'}, {id: 'sm', role: 'manager'}, {id: 'sup', role: 'supervisor', sup: 'sm'}, {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'أحمد عبد العزيز'}];
const screenshots = process.env.YR_MOLD_SCREENSHOT_DIR ? path.resolve(process.env.YR_MOLD_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-mold-nov10-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1280, height: 900};
const REASON = 'الحد الائتماني للعميل لا يسمح بالمبلغ';
async function makePdf(label) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) doc.addPage([595, 842]).drawText(label + ' - page ' + (i + 1), {x: 60, y: 760, size: 20, font});
  return Buffer.from(await doc.save());
}

const mock = await startProductsMock({nov10: true});
const app = await bootBuiltApp({members}, {tls: true, env: {YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret, NODE_EXTRA_CA_CERTS: mock.ca}});
try {
  const now = new Date().toISOString();
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind('east1', 'rep', JSON.stringify({name: 'مصنع الشرق', region: 'الشرقية', city: 'الدمام', address: 'حي الصناعية', phone: '0551234567', code: 'ERP-east1', internalCode: 'YR-C-000027', branch: 'الرئيسي', assignedTo: 'rep'}), now, now).run();
  const {scope} = await app.db.prepare('SELECT region_scope AS scope FROM crm_members WHERE id=?').bind('rep').first();
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
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
  const goMolds = async page => {
    const more = page.locator('.mobile-bottom-navigation button[aria-haspopup="dialog"]');
    await page.locator('.mobile-bottom-navigation button[aria-haspopup="dialog"]:visible, button.nav-item:visible').first().waitFor();
    if (await more.isVisible()) { await more.click(); await page.locator('.mobile-overflow-pages button[data-page="mold-requests"]').click(); await page.locator('.mobile-navigation-sheet').waitFor({state: 'detached'}); }
    else await page.locator('button.nav-item', {hasText: /طلبات تصنيع القوالب|Mold requests/}).first().click();
    await page.locator('.mold-page').waitFor();
  };
  const refresh = async page => { await page.locator('.mold-heading-tools button').first().click(); await page.waitForTimeout(300); await page.locator('.mold-heading-tools button:not([disabled])').first().waitFor(); };
  const sheet = page => page.locator('.mold-sheet');
  /** A sheet or a dialog done sliding in, for its screenshot. */
  const still = locator => locator.evaluate(element => Promise.all(element.getAnimations({subtree: true}).map(animation => animation.finished.catch(() => null))));
  const until = async (test, message, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await test()) return; await new Promise(resolve => setTimeout(resolve, 200)); } assert.fail('timed out: ' + message); };
  const age = id => app.db.prepare("UPDATE crm_mold_requests SET remote_at='2026-01-01T00:00:00.000Z' WHERE id=?").bind(id).run();
  /** The sales manager's waiting list is kept a minute by the server; an approval by a number nobody has reads it afresh. */
  const freshPending = async () => app.as(await app.login('sm'))('/api/mold-requests', {method: 'POST', body: {action: 'approve-order', requestId: crypto.randomUUID(), orderNo: 999999, termsAccepted: true}});

  // ---- 0. An earlier request teaches the CRM that production is updated (its answer carries paymentTerms and returned)
  const api = app.as(await app.login('rep')), DESCRIPTION = '200*400*27.5TH MM OPEN';
  const earlier = await api('/api/mold-requests', {method: 'POST', body: {action: 'create', requestId: crypto.randomUUID(), customerId: 'east1', specs: {description: 'طلب سابق', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: '', quantity: 1, designUrl: '', notes: ''}, payment: 'cash', address: 'حي الصناعية', signature: signatureInput()}});
  const form = new FormData();
  form.set('requestId', crypto.randomUUID()); form.set('id', earlier.json().request.id); form.set('file', new Blob([await makePdf('Earlier')]), 'سابق.pdf');
  const encoded = new Response(form);
  await api('/api/mold-requests/design-files', {method: 'POST', body: Buffer.from(await encoded.arrayBuffer()), headers: {'Content-Type': encoded.headers.get('content-type')}});
  await until(async () => !!(await app.db.prepare("SELECT 1 AS k FROM crm_settings WHERE id='mold-nov10'").first()), 'the update learned');

  // ---- 1. The representative on a phone, Arabic: «آجل» asks for the agreed terms
  const rep = await open('rep', {viewport: PHONE, touch: true});
  await goMolds(rep);
  await rep.locator('.mold-new').click();
  const dialog = rep.locator('.mold-dialog');
  await dialog.locator('.mold-customer-field[data-field="name"] input').fill('مصنع الشرق');
  await dialog.locator('.mold-customer-field[data-field="code"] input').fill('ERP-east1'); // typed, no suggestions (2026-11-14): the ERP code links the request
  await dialog.locator('.mold-customer-chosen').waitFor();
  await dialog.locator('label.mold-field', {hasText: 'وصف القالب'}).locator('input').fill(DESCRIPTION);
  for (const text of ['مفتوح', 'موديل قديم', 'بدون بلوكة نص']) await dialog.locator('.mold-choice label', {hasText: text}).click();
  await dialog.locator('.mold-choice', {hasText: 'عدد الرجاجات'}).locator('label', {hasText: '2'}).click();
  await dialog.locator('label.mold-field', {hasText: 'عرض القالب'}).locator('.mold-usual button', {hasText: '1380'}).click();
  await dialog.locator('label.mold-field', {hasText: 'مقاس الجلب'}).locator('.mold-usual button', {hasText: '795'}).click();
  const payment = dialog.locator('.mold-choice', {hasText: 'طريقة الدفع'}).first();
  await payment.locator('label', {hasText: 'نقدي'}).click();
  check(await dialog.locator('.mold-payment-terms-choice').count(), 0, 'cash: no terms asked');
  await payment.locator('label', {hasText: 'آجل'}).click();
  const terms = dialog.locator('.mold-payment-terms-choice');
  check([await terms.locator('legend').innerText(), await terms.locator('label').allInnerTexts()], ['طريقة الدفع المتفق عليها', ['دفعة مقدمة واستكمال باقي المبلغ قبل الترحيل', 'دفعة مقدمة واستكمال باقي المبلغ بعد الترحيل', 'دفعة مقدمة واستكمال باقي المبلغ حد ائتماني']], 'deferred: the three agreed terms, in the owner\'s words');
  const picker = dialog.locator('.mold-design-picker[data-category="design"]');
  await picker.locator('input[type=file]').setInputFiles({name: 'رسم القالب.pdf', mimeType: 'application/pdf', buffer: await makePdf('Design')});
  await picker.locator('.mold-design-file[data-state="ready"]').first().waitFor();
  await dialog.getByRole('button', {name: 'حفظ وإرسال للإنتاج'}).click();
  check([await terms.locator('.field-error').innerText(), await terms.locator('.mold-choice').getAttribute('aria-invalid')], ['اختر طريقة الدفع المتفق عليها', 'true'], 'required: said under the choice');
  await terms.scrollIntoViewIfNeeded();
  await noOverflow(rep, 'the form with the terms at 360 px');
  await shot(rep, '01-rep-form-terms-required-360-ar');
  await terms.locator('label', {hasText: 'بعد الترحيل'}).click();
  check(await terms.locator('.field-error').count(), 0, 'chosen: the refusal goes');
  await dialog.getByRole('button', {name: 'حفظ وإرسال للإنتاج'}).click();
  const step = dialog.locator('.mold-signing');
  await step.waitFor();
  const summary = await step.locator('.mold-signing-summary').innerText(); // on the document's signature page (2026-11-11)
  ok(summary.includes('آجل') && summary.includes('دفعة مقدمة واستكمال باقي المبلغ بعد الترحيل'), 'the customer signs the terms with the rest');
  await noOverflow(rep, 'the signing step at 360 px');
  await shot(rep, '02-rep-signing-summary-terms-360-ar');
  await signRequest(rep, {signer: 'م. خالد العتيبي', input: 'touch'});
  await sheet(rep).waitFor();
  const requestId = (await app.db.prepare('SELECT id FROM crm_mold_requests ORDER BY created_at DESC LIMIT 1').first()).id;
  await until(() => !!mock.row(requestId) && mock.row(requestId).paymentTerms === 'advance_after_shipping', 'production receives the terms');
  check(JSON.parse(mock.state.calls.find(call => call.route === 'requests' && call.body.includes(requestId)).body).paymentTerms, 'advance_after_shipping', 'sent as paymentTerms');
  await rep.keyboard.press('Escape');
  await sheet(rep).waitFor({state: 'detached'});
  const card = rep.locator('.mold-card', {hasText: DESCRIPTION});
  await until(async () => (await card.innerText()).includes('دفعة مقدمة واستكمال باقي المبلغ بعد الترحيل'), 'the card says the terms');
  ok(/الدفع:\s*آجل · دفعة مقدمة واستكمال باقي المبلغ بعد الترحيل/.test(await card.locator('.mold-payment-terms').innerText()), 'the card: «الدفع: آجل · …»');
  await noOverflow(rep, 'the card at 360 px');
  await shot(rep, '03-rep-card-terms-360-ar');

  // ---- 2. The sales manager on a phone, Arabic: the terms on the waiting list, «اعتماد» waits for the box
  await freshPending();
  const sm = await open('sm', {viewport: PHONE, touch: true});
  await goMolds(sm);
  const pendingCard = sm.locator('.mold-pending', {hasText: DESCRIPTION}).first();
  await pendingCard.waitFor();
  ok((await pendingCard.locator('.mold-payment').innerText()).includes('آجل · دفعة مقدمة واستكمال باقي المبلغ بعد الترحيل'), 'the list says the terms');
  const approve = pendingCard.getByRole('button', {name: 'اعتماد', exact: true}), box = pendingCard.locator('.mold-terms-accept input');
  check([await pendingCard.locator('.mold-terms-accept').innerText(), await approve.isDisabled()], ['تمت الموافقة على التصنيع بشروط الدفع المذكورة وقت الإستلام', true], 'the box, and «اعتماد» waits for it');
  await noOverflow(sm, 'the waiting list at 360 px');
  await pendingCard.locator('.mold-payment').scrollIntoViewIfNeeded();
  await shot(sm, '04a-manager-pending-terms-360-ar');
  await pendingCard.locator('.mold-actions').evaluate(element => element.scrollIntoView({block: 'center'}));
  await shot(sm, '04b-manager-approve-waits-for-box-360-ar');
  await box.check();
  check(await approve.isDisabled(), false, 'ticked: «اعتماد» may be pressed');
  await approve.click();
  await sm.locator('.mold-pending[data-done]', {hasText: DESCRIPTION}).waitFor();
  check([mock.row(requestId).approvals.sales.termsAccepted, JSON.parse(mock.state.calls.filter(call => call.route === 'approval').at(-1).body).termsAccepted], [true, true], 'approved with termsAccepted');
  await shot(sm, '05-manager-approved-360-ar');

  // ---- 3. Finance sends it back
  mock.approve(requestId, 'production');
  mock.financeReturn(requestId, REASON);
  await age(requestId);
  await refresh(rep);
  await until(async () => (await card.innerText()).includes('أعادتها المالية'), 'the card says finance returned it');
  ok((await card.locator('.mold-returned-badge').innerText()).includes('أعادتها المالية: ' + REASON), 'the card: «أعادتها المالية: <السبب>»');
  const filter = rep.locator('.mold-returned-filter');
  check([(await filter.innerText()).replace(/\s+/g, ' '), await filter.getAttribute('aria-pressed')], ['أعادتها المالية 1', 'false'], 'the filter, with how many');
  await filter.click();
  check([await filter.getAttribute('aria-pressed'), await rep.locator('.mold-card').count()], ['true', 1], 'narrowed to the returned ones');
  await noOverflow(rep, 'the returned card at 360 px');
  await shot(rep, '06-rep-card-returned-filter-360-ar');
  await card.click();
  const note = sheet(rep).locator('.mold-returned');
  await note.waitFor();
  const noteText = await note.innerText();
  ok(noteText.includes('أعادته المالية (finance@yourrest.org):') && noteText.includes(REASON) && noteText.includes('عدّل الطلب وأعد إرساله'), 'the sheet: who, why, when, and what to do');
  const correct = sheet(rep).getByRole('button', {name: 'تعديل وإعادة الإرسال'});
  check([await correct.isVisible(), await sheet(rep).getByRole('button', {name: 'تعديل الطلب', exact: true}).count()], [true, 0], '«تعديل وإعادة الإرسال» (no ordinary edit: production holds it)');
  await noOverflow(rep, 'the sheet at 360 px');
  await still(sheet(rep));
  await note.evaluate(element => element.scrollIntoView({block: 'start'}));
  await shot(rep, '07a-rep-sheet-returned-360-ar');
  await correct.evaluate(element => element.scrollIntoView({block: 'center'}));
  await shot(rep, '07b-rep-sheet-correct-button-360-ar');
  await correct.click();
  const edit = rep.locator('.mold-dialog');
  await edit.locator('.mold-returned').waitFor();
  ok((await edit.locator('[data-slot="dialog-description"]').innerText()).includes('أعادت المالية الطلب'), 'the dialog says why it is open');
  await edit.locator('label.mold-field', {hasText: 'الكمية'}).locator('input').fill('3');
  const save = edit.getByRole('button', {name: 'حفظ وإعادة الإرسال للإنتاج'});
  await noOverflow(rep, 'the correction dialog at 360 px');
  await still(edit);
  await edit.locator('.mold-returned').evaluate(element => element.scrollIntoView({block: 'start'}));
  await shot(rep, '08a-rep-correction-dialog-360-ar');
  await save.evaluate(element => element.scrollIntoView({block: 'center'}));
  await shot(rep, '08b-rep-correction-save-360-ar');
  await save.click();
  await edit.locator('.mold-signing').waitFor();
  ok((await edit.locator('.mold-signing .mold-signing-summary').innerText()).includes('دفعة مقدمة واستكمال باقي المبلغ بعد الترحيل'), 'a change of what the customer signed: signed again');
  await signRequest(rep, {signer: 'م. خالد العتيبي', input: 'touch'});
  await edit.waitFor({state: 'detached'});
  await until(() => mock.row(requestId).quantity === 3 && typeof mock.row(requestId).returned?.correctedAt === 'string', 'production takes the correction');
  await until(async () => (await sheet(rep).locator('.mold-returned small[data-corrected]').count()) === 1, 'the sheet says the correction arrived');
  ok((await sheet(rep).locator('.mold-returned small[data-corrected]').innerText()).includes('أُرسل التعديل إلى الإنتاج'), '«أُرسل التعديل إلى الإنتاج»');
  await still(sheet(rep));
  await sheet(rep).locator('.mold-returned').evaluate(element => element.scrollIntoView({block: 'start'}));
  await shot(rep, '09-rep-sheet-corrected-360-ar');

  // ---- 4. The sales manager reads why, in Arabic and in English, and approves again
  await freshPending();
  await refresh(sm);
  const back = sm.locator('.mold-pending:not([data-done])', {hasText: DESCRIPTION}).first();
  await back.locator('.mold-returned').waitFor();
  ok((await back.locator('.mold-returned').innerText()).includes(REASON), 'the waiting list says why it came back');
  await back.locator('.mold-returned').evaluate(element => element.scrollIntoView({block: 'center'}));
  await noOverflow(sm, 'the returned item at 360 px');
  await shot(sm, '10-manager-pending-returned-360-ar');
  await freshPending();
  const english = await open('sm', {language: 'en'});
  await goMolds(english);
  const englishCard = english.locator('.mold-pending', {hasText: DESCRIPTION}).first();
  await englishCard.locator('.mold-returned').waitFor();
  const englishText = await englishCard.innerText();
  ok(englishText.includes('Finance returned it (finance@yourrest.org):') && englishText.includes('Manufacturing is approved on the payment terms stated at receipt') && englishText.includes('An advance payment, the rest after shipping'), 'in English: the return, the box and the terms');
  await englishCard.locator('.mold-returned').evaluate(element => element.scrollIntoView({block: 'center'}));
  await shot(english, '11-manager-pending-returned-desktop-en');
  await englishCard.locator('.mold-terms-accept input').check();
  await englishCard.getByRole('button', {name: 'Approve', exact: true}).click();
  await english.locator('.mold-pending[data-done]', {hasText: DESCRIPTION}).waitFor();
  check([mock.row(requestId).returned, mock.row(requestId).approvals.sales.termsAccepted], [null, true], 'approved again: returned cleared at production');
  await rep.keyboard.press('Escape');
  await sheet(rep).waitFor({state: 'detached'});
  await age(requestId);
  await refresh(rep);
  await until(async () => (await card.locator('.mold-returned-badge').count()) === 0, 'the card no longer says returned');
  check([await rep.locator('.mold-returned-filter').count(), await rep.locator('.mold-card').count()], [0, 2], 'nothing returned: no filter, every request listed');

  check(errors, [], 'no page errors');
  console.log(JSON.stringify({ok: true, checks, screenshots, builtRelease: true, productionDataUsed: false}));
} finally {
  await browser?.close(); await app.stop(); await mock.stop();
}
