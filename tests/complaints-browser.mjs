// Customer complaints in a real Chromium against the BUILT release (run `pnpm build` first): customer service registers a
// complaint on its own page, its manager returns it and then hands it to the sales manager, who assigns it from the Visits page
// with the customer's representative suggested; the representative, on the Android app emulator, sees it with a count on Visits,
// records a contact and the resolution; customer service confirms with the customer and closes it; the administrator reads it
// on the customer's sheet; a late one is marked; the English page. The phone's consent and permissions are the emulator's
// (scripts/lib/native-bridge.mjs): no device, GPS or OS claim is made. Synthetic isolated fixtures only: temporary SQLite,
// mocked sendmail, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require('playwright');
const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'سعد مدير المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'sm', name: 'ماجد المشرف'},
  {id: 'rep', role: 'rep', sup: 'sup', name: 'أحمد المندوب'}, {id: 'rep2', role: 'rep', sup: 'sup', name: 'سالم المندوب'},
  {id: 'csm', role: 'customer_service_manager', sup: 'sm', name: 'منى مديرة الخدمة'},
  {id: 'cs_east', role: 'customer_service', sup: 'csm', region: 'eastern', name: 'ريم الشرقية'}, {id: 'cs_west', role: 'customer_service', sup: 'csm', region: 'western', name: 'هند الغربية'}
];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-complaints-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1280, height: 900};
const CUSTOMER = 'مصنع الأمل للبلاستيك', OTHER = 'مصنع النور للخرسانة';
const DESCRIPTION = 'القالب الجديد يخرج بلوكًا مكسورًا من الجهة اليمنى منذ أسبوع', CORRECTED = DESCRIPTION + '، قالب بلوك 20 سم';

try {
  app = await bootBuiltApp({members}, {tls: true});
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  const dayOf = offset => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date(Date.now() + offset * 86400000));
  const rows = async () => (await app.db.prepare("SELECT id,data,version FROM crm_records WHERE kind='complaint' ORDER BY created_at,id").all()).results.map(row => ({...row, data: JSON.parse(row.data)}));
  const rowFor = async customerId => (await rows()).filter(row => row.data.customerId === customerId).at(-1);
  async function eventually(probe, message, timeoutMs = 20000) {
    const until = Date.now() + timeoutMs;
    for (;;) { const value = await probe(); if (value) { checks++; return value; } if (Date.now() > until) throw Error(message + ' (timed out)'); await pause(150); }
  }
  /** A signed-in page. native: false = plain browser, object = the Android app emulator (the phone is set up for that account). */
  async function open(memberId, {native = false, viewport = DESKTOP} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', geolocation: {latitude: 26.437341, longitude: 50.034499, accuracy: 8}, permissions: ['geolocation']});
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (native) await installNativeBridge(page, native === true ? {} : native);
    await page.goto(app.origin + '/');
    await page.locator('.workspace').waitFor();
    return page;
  }
  const settle = page => page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const shot = async (page, label) => { await settle(page); await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const layoutOk = async (page, label) => { const geometry = await page.evaluate(() => ({overflow: document.documentElement.scrollWidth > innerWidth + 1, width: innerWidth})); check(geometry.overflow, false, label + ': no horizontal overflow at ' + geometry.width + 'px'); };
  const goDesktop = async (page, label) => { await page.locator('button.nav-item', {hasText: label}).first().click(); await page.locator('.page-heading h1', {hasText: label}).waitFor(); };
  const goPhone = async (page, id) => {
    await page.locator('.mobile-bottom-navigation').waitFor();
    const tab = page.locator('.mobile-tab[data-page="' + id + '"]');
    if (await tab.count()) { await tab.click(); await page.locator('.mobile-tab[data-page="' + id + '"][aria-current="page"]').waitFor(); return; }
    await page.getByRole('button', {name: /^(المزيد من الصفحات|More pages)$/}).click();
    await page.locator('.mobile-overflow-pages [data-page=' + id + ']').click();
    await page.locator('.mobile-navigation-sheet').waitFor({state: 'detached'});
    await page.locator('.page-heading').waitFor();
  };
  const badgeOf = async locator => (await locator.count()) ? (await locator.first().innerText()).trim() : '';
  const card = (page, id) => page.locator('.complaint-card[data-complaint="' + id + '"]');
  const sheetOf = page => page.locator('.complaint-sheet');

  // ---- fixtures: an eastern customer of the representative, a western one, and a complaint registered three days ago that waits late for its review
  const created = new Date().toISOString();
  const customer = (id, name, region, assignedTo = 'rep') => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, assignedTo, JSON.stringify({name, region, city: 'الدمام', phone: '0551234567', contact: 'أبو خالد', code: id, branch: 'الرئيسي', assignedTo}), created, created).run();
  await customer('f1', CUSTOMER, 'الشرقية'); await customer('f2', OTHER, 'الغربية', 'rep2');
  const old = dayOf(-3) + 'T05:00:00.000Z';
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('complaint-old','complaint',NULL,'cs_east','الرئيسي',?,?,?,1,'fixture')")
    .bind(JSON.stringify({kind: 'complaint', customerId: 'f1', status: 'submitted', registrarId: 'cs_east', serviceManagerId: 'csm', salesManagerId: '', supervisorId: '', assigneeId: '', channel: 'whatsapp', category: 'delivery_delay', severity: 'normal', description: 'تأخر تسليم الطلبية السابقة أسبوعين عن الموعد', demand: '', reference: '', contactName: 'أبو خالد', contactPhone: '0551234567', submittedAt: old, forwardedAt: '', returnedAt: '', assignedAt: '', delegatedAt: '', reassignedAt: '', rejectedAt: '', reopenedAt: '', resolvedAt: '', closedAt: '', cancelledAt: '', seenAt: '', returnNote: '', assignmentNote: '', rejectReason: '', cancelReason: '', previousAssignees: [], updates: [], notes: [], events: [{at: old, by: 'cs_east', action: 'register'}]}), old, old).run();

  // ---- 1. Customer service registers a complaint on its own page
  const cs = await open('cs_east');
  let complaintId;
  {
    await cs.locator('button.nav-item', {hasText: 'الشكاوى'}).waitFor();
    check(await cs.locator('button.nav-item').allInnerTexts().then(texts => texts.map(text => text.trim())), ['الزيارات', 'الشكاوى'], 'customer service has the Visits page and the Complaints page');
    await goDesktop(cs, 'الشكاوى');
    const page = cs.locator('.complaints-page');
    await page.waitFor();
    ok(await card(cs, 'complaint-old').isVisible(), 'the complaint registered three days ago is listed');
    check((await card(cs, 'complaint-old').innerText()).includes('بانتظار مراجعة مدير خدمة العملاء'), true, 'waiting for the manager');
    check(await cs.locator('.heading-actions').getByRole('button', {name: 'زيارة جديدة'}).count(), 0, 'the complaints page offers no visit button');
    await cs.locator('.heading-actions').getByRole('button', {name: 'تسجيل شكوى', exact: true}).click();
    const dialog = cs.locator('.complaint-dialog');
    await dialog.waitFor();
    await dialog.getByRole('searchbox').fill('الأمل');
    check(await dialog.locator('[data-customer]').count(), 1, 'the search narrows to the customer');
    check(await dialog.locator('[data-customer="f2"]').count(), 0, 'the western customer is not offered to customer service of the east');
    await dialog.locator('[data-customer="f1"]').click();
    await dialog.getByText('لهذا العميل 1 شكوى مفتوحة بالفعل').waitFor();
    checks++;
    const submit = dialog.getByRole('button', {name: 'تسجيل الشكوى', exact: true});
    check(await submit.isDisabled(), true, 'nothing is sent before a description');
    check(await dialog.locator('input[name=complaint-severity][value=normal]').isChecked(), true, 'normal severity by default');
    await dialog.locator('textarea').first().fill(DESCRIPTION);
    await dialog.locator('label.customer-choice').filter({hasText: 'عالية'}).click();
    await dialog.locator('textarea').nth(1).fill('استبدال القالب');
    await dialog.locator('label.field').filter({hasText: 'مرجع'}).locator('input').fill('INV-2026-100');
    check(await dialog.locator('label.field').filter({hasText: 'رقم التواصل'}).locator('input').inputValue(), '0551234567', 'the customer\'s phone is filled in');
    check(await submit.isDisabled(), false, 'then it is enabled');
    await layoutOk(cs, 'customer service: registration'); await shot(cs, 'complaints-register');
    await submit.click();
    await dialog.waitFor({state: 'detached'});
    const stored = await eventually(async () => { const found = await rowFor('f1'); return found && found.id !== 'complaint-old' ? found : null; }, 'the complaint is stored');
    complaintId = stored.id;
    check([stored.data.status, stored.data.registrarId, stored.data.serviceManagerId, stored.data.severity, stored.data.category, stored.data.description, stored.data.demand, stored.data.reference, stored.data.contactPhone], ['submitted', 'cs_east', 'csm', 'high', 'product_quality', DESCRIPTION, 'استبدال القالب', 'INV-2026-100', '0551234567'], 'with everything typed, waiting for the manager');
    await card(cs, complaintId).waitFor();
    check([await card(cs, complaintId).getAttribute('data-severity'), (await card(cs, complaintId).innerText()).includes('أهمية عالية')], ['high', true], 'the new card is marked high');
    await layoutOk(cs, 'customer service: complaints page'); await shot(cs, 'complaints-cs-page');
  }

  // ---- 2. The manager returns it, customer service corrects it, the manager hands it to sales
  const csm = await open('csm');
  {
    await eventually(async () => (await badgeOf(csm.locator('button.nav-item', {hasText: 'الشكاوى'}).locator('.nav-badge'))) === '2', 'the manager\'s Complaints entry counts the two reviews that wait');
    await goDesktop(csm, 'الشكاوى');
    const act = csm.locator('.support-group[data-group="act"]');
    await act.waitFor();
    check(await act.locator('.complaint-card').count(), 2, 'both wait for his review');
    check([await card(csm, 'complaint-old').getAttribute('data-late'), (await card(csm, 'complaint-old').innerText()).includes('متأخر عن هدف 4 ساعة عمل')], ['true', true], 'the old one is late against the review target');
    check(await act.locator('.complaint-card').first().getAttribute('data-complaint'), 'complaint-old', 'and comes first');
    await layoutOk(csm, 'manager: complaints page'); await shot(csm, 'complaints-manager-page');
    await card(csm, complaintId).getByRole('button', {name: 'مراجعة الشكوى', exact: true}).click();
    const sheet = sheetOf(csm);
    await sheet.waitFor();
    ok((await sheet.innerText()).includes(DESCRIPTION) && (await sheet.innerText()).includes('INV-2026-100'), 'the sheet shows the report');
    await sheet.locator('label.field').filter({hasText: 'إعادة للتعديل'}).locator('input').fill('أضف مقاس القالب في الوصف');
    await sheet.getByRole('button', {name: 'إعادة للتعديل', exact: true}).click();
    await eventually(async () => (await rowFor('f1')).data.status === 'returned', 'it is returned to the registrar');
    await sheet.getByText('مطلوب تعديل').first().waitFor();
    checks++;
    await csm.keyboard.press('Escape');
    await sheet.waitFor({state: 'detached'});
  }
  {
    await cs.reload();
    await cs.locator('.workspace').waitFor();
    await goDesktop(cs, 'الشكاوى');
    const mine = card(cs, complaintId);
    await mine.waitFor();
    await mine.getByRole('button', {name: 'تعديل وإعادة الإرسال', exact: true}).click();
    const sheet = sheetOf(cs);
    await sheet.waitFor();
    ok((await sheet.innerText()).includes('أضف مقاس القالب في الوصف'), 'the registrar reads why it came back');
    await sheet.getByRole('button', {name: 'تعديل الشكوى', exact: true}).click();
    await sheet.locator('textarea').first().fill(CORRECTED);
    await sheet.getByRole('button', {name: 'حفظ وإعادة الإرسال', exact: true}).click();
    await eventually(async () => { const found = await rowFor('f1'); return found.data.status === 'submitted' && found.data.description === CORRECTED; }, 'corrected and resent');
    await cs.keyboard.press('Escape');
    await sheet.waitFor({state: 'detached'});
  }
  {
    await csm.reload();
    await csm.locator('.workspace').waitFor();
    await goDesktop(csm, 'الشكاوى');
    await card(csm, complaintId).getByRole('button', {name: 'مراجعة الشكوى', exact: true}).click();
    const sheet = sheetOf(csm);
    await sheet.waitFor();
    const select = sheet.locator('select').first();
    check(await select.locator('option').allInnerTexts().then(texts => texts.map(text => text.trim()).filter(Boolean)), ['اختر', 'سعد مدير المبيعات · مدير المبيعات'], 'the only sales manager offered is the one linked to him');
    await select.selectOption('sm');
    await sheet.getByRole('button', {name: 'إحالة الشكوى', exact: true}).click();
    await eventually(async () => (await rowFor('f1')).data.status === 'pending_assignment', 'handed to the sales manager');
    await csm.keyboard.press('Escape');
    await sheet.waitFor({state: 'detached'});
    await eventually(async () => (await badgeOf(csm.locator('button.nav-item', {hasText: 'الشكاوى'}).locator('.nav-badge'))) === '1', 'only the old review still counts for him');
    await csm.context().close();
  }

  // ---- 3. The sales manager assigns it from the Visits page, the customer's representative suggested
  const sm = await open('sm');
  {
    check(await sm.locator('button.nav-item', {hasText: 'الشكاوى'}).count(), 0, 'sales has no complaints page');
    await eventually(async () => (await badgeOf(sm.locator('button.nav-item', {hasText: 'الزيارات'}).locator('.nav-badge'))) === '1', 'the complaint counts on Visits instead');
    await goDesktop(sm, 'الزيارات');
    const panel = sm.locator('.complaints-panel');
    await panel.waitFor();
    check(await panel.locator('.complaint-card').count(), 1, 'the panel shows the complaint that came to him');
    await layoutOk(sm, 'sales manager: Visits with the complaints panel'); await shot(sm, 'complaints-sales-manager');
    await card(sm, complaintId).getByRole('button', {name: 'تكليف مندوب', exact: true}).click();
    const sheet = sheetOf(sm);
    await sheet.waitFor();
    const select = sheet.locator('select').first();
    const options = await select.locator('option').allInnerTexts().then(texts => texts.map(text => text.trim()));
    check([options[1].startsWith('أحمد المندوب'), options[1].includes('المندوب الحالي للعميل'), await select.inputValue()], [true, true, 'rep'], 'the customer\'s own representative is first and preselected');
    await sheet.locator('label.field').filter({hasText: 'ملاحظة للمكلَّف'}).locator('input').fill('العميل مهم، تواصل معه اليوم');
    await sheet.getByRole('button', {name: 'تكليف', exact: true}).click();
    const assigned = await eventually(async () => { const found = await rowFor('f1'); return found.data.status === 'assigned' ? found : null; }, 'assigned');
    check([assigned.data.assigneeId, assigned.data.supervisorId, assigned.data.assignmentNote], ['rep', 'sup', 'العميل مهم، تواصل معه اليوم'], 'to the representative, his supervisor remembered');
    await sm.keyboard.press('Escape');
    await sheet.waitFor({state: 'detached'});
    await sm.context().close();
  }

  // ---- 4. The representative, on the Android app emulator, records a contact and the resolution
  const rep = await open('rep', {native: {memberId: 'rep', regionScope: 'all'}, viewport: PHONE});
  {
    await rep.locator('.mobile-bottom-navigation').waitFor();
    await eventually(async () => (await badgeOf(rep.locator('.mobile-tab[data-page="activity"] .nav-badge'))) === '1', 'the Visits tab counts the complaint');
    await goPhone(rep, 'activity');
    const panel = rep.locator('.complaints-panel');
    await panel.waitFor();
    const mine = card(rep, complaintId);
    check([(await mine.innerText()).includes('بانتظار أول تواصل من المندوب'), (await mine.innerText()).includes(CUSTOMER)], [true, true], 'the card says the first contact is expected');
    await layoutOk(rep, 'representative: Visits with the complaint'); await shot(rep, 'complaints-rep-phone');
    await mine.getByRole('button', {name: 'تسجيل التواصل', exact: true}).click();
    const sheet = sheetOf(rep);
    await sheet.waitFor();
    await eventually(async () => !!(await rowFor('f1')).data.seenAt, 'opening it is recorded');
    ok((await sheet.innerText()).includes('العميل مهم، تواصل معه اليوم') && (await sheet.innerText()).includes('tel:') === false, 'the assignment note is shown');
    check(await sheet.locator('a[href^="tel:"]').count(), 1, 'with a dial link to the customer');
    const update = sheet.locator('.complaint-update');
    await update.locator('select').selectOption('visit');
    await update.locator('textarea').fill('زرت المصنع وفحصت القالب: التلف في الجهة اليمنى فعلًا');
    await update.getByRole('button', {name: 'حفظ التواصل', exact: true}).click();
    await eventually(async () => (await rowFor('f1')).data.updates.length === 1, 'the contact is recorded');
    await sheet.getByText('تواصل مع العميل · زيارة').waitFor();
    checks++;
    await layoutOk(rep, 'representative: complaint sheet'); await shot(rep, 'complaints-rep-sheet');
    const resolve = sheet.locator('.complaint-resolve');
    await resolve.locator('select').selectOption('solved');
    await resolve.locator('textarea').fill('استُبدل القالب بقالب جديد وجُرّب أمام العميل');
    await resolve.getByRole('button', {name: 'تسجيل الحل', exact: true}).click();
    const resolved = await eventually(async () => { const found = await rowFor('f1'); return found.data.status === 'resolved' ? found : null; }, 'resolved');
    check(resolved.data.resolution.outcome, 'solved', 'with its outcome');
    await rep.keyboard.press('Escape');
    await sheet.waitFor({state: 'detached'});
    await eventually(async () => (await badgeOf(rep.locator('.mobile-tab[data-page="activity"] .nav-badge'))) === '', 'nothing waits for him any more');
    await rep.context().close();
  }

  // ---- 5. Customer service confirms with the customer and closes it
  {
    await cs.reload();
    await cs.locator('.workspace').waitFor();
    await eventually(async () => (await badgeOf(cs.locator('button.nav-item', {hasText: 'الشكاوى'}).locator('.nav-badge'))) === '1', 'the closure counts for the registrar');
    await goDesktop(cs, 'الشكاوى');
    await card(cs, complaintId).getByRole('button', {name: 'تأكيد الإغلاق', exact: true}).click();
    const sheet = sheetOf(cs);
    await sheet.waitFor();
    ok((await sheet.innerText()).includes('حُلّت · استُبدل القالب'), 'the registrar reads the resolution');
    const close = sheet.locator('.complaint-close');
    await close.locator('select').selectOption('satisfied');
    await close.locator('textarea').fill('أكد العميل أن المشكلة انتهت');
    await close.getByRole('button', {name: 'إغلاق الشكوى', exact: true}).click();
    const closed = await eventually(async () => { const found = await rowFor('f1'); return found.data.status === 'closed' ? found : null; }, 'closed');
    check([closed.data.closure.outcome, closed.data.events.map(event => event.action)], ['satisfied', ['register', 'return', 'edit', 'forward', 'assign', 'resolve', 'close']], 'with its whole story');
    await sheet.getByText('إعادة فتح الشكوى: لماذا؟').waitFor();
    checks++;
    await shot(cs, 'complaints-closed');
    await cs.keyboard.press('Escape');
    await sheet.waitFor({state: 'detached'});
    await cs.locator('.support-folded[data-group="finished"] summary').click();
    ok(await card(cs, complaintId).isVisible(), 'it moved to the finished section');
    // English
    await cs.getByRole('button', {name: 'Switch to English', exact: true}).click();
    await cs.locator('html[lang=en]').waitFor();
    const text = await cs.locator('.complaints-page').innerText();
    ok(text.includes('Customer complaints') && text.includes('Closed and cancelled in the last 30 days'), 'the English page');
    check(await cs.locator('.heading-actions').getByRole('button', {name: 'Register a complaint', exact: true}).count(), 1, 'with its registration button among the page actions');
    check(/[؀-ۿ]/.test(text.replace(/مصنع الأمل للبلاستيك|ريم الشرقية|منى مديرة الخدمة|أحمد المندوب|سعد مدير المبيعات|[؀-ۿ\s،.:]+?(?=\n|$)/g, '')) && !/Waiting|Closed/.test(text), false, 'without Arabic apart from the names and the typed text');
    await cs.context().close();
  }

  // ---- 6. The administrator reads it on the customer's sheet
  const admin = await open('owner', {viewport: PHONE});
  {
    await goPhone(admin, 'customer');
    await admin.getByRole('button', {name: 'بيانات العميل: ' + CUSTOMER, exact: true}).click();
    const sheet = admin.locator('.crm-sheet');
    await sheet.waitFor();
    const tab = sheet.getByRole('tab', {name: 'الشكاوى', exact: true});
    await tab.waitFor();
    await tab.click();
    const cards = sheet.locator('.customer-complaints .complaint-card');
    await cards.first().waitFor();
    check(await cards.count(), 2, 'the customer\'s sheet lists both complaints');
    await layoutOk(admin, 'administrator: customer sheet'); await shot(admin, 'complaints-customer-sheet');
    await cards.filter({has: admin.locator('[data-status="closed"]')}).first().getByRole('button').click().catch(() => {});
    await admin.context().close();
  }

  check(errors, [], 'no page error was raised');
  console.log(JSON.stringify({ok: true, checks, screenshots, scope: 'complaints in real Chromium on the built release: registration on the customer-service page, return and correction, forward, assignment from the Visits panel with the suggested representative, the representative on the Android emulator with the Visits count, contact and resolution, closure, late mark, the customer sheet, English', realBrowser: true, realDevice: false}));
} finally {
  await browser?.close();
  await app?.stop();
}
