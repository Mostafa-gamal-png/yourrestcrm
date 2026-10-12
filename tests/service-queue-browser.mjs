// Customer-service requests reaching sales, in a real Chromium against the BUILT release (run `pnpm build` first):
// the manager assigns from the Visits page, the supervisor delegates, the representative (on the Android app emulator)
// is told on every page, opens the request, records the first contact, and the banner leaves by itself; the monthly
// report opens for the people who run the service and for nobody else. The phone's consent, permissions and enrolment
// are the emulator's (scripts/lib/native-bridge.mjs): no device, GPS or OS claim is made.
// Synthetic isolated fixtures only: temporary SQLite, mocked sendmail, no production data.
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
  {id: 'csm', role: 'customer_service_manager', sup: 'sm', name: 'منى مديرة الخدمة'}, {id: 'cs', role: 'customer_service', sup: 'csm', name: 'ريم خدمة العملاء'}
];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-queue-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1280, height: 900};
const CUSTOMER = 'مصنع الأمل للبلاستيك', CUSTOMER_2 = 'مصنع النور للخرسانة';

try {
  app = await bootBuiltApp({members}, {tls: true});
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date());
  const sessions = {};
  for (const member of members) sessions[member.id] = await app.login(member.id);
  const as = id => app.as(sessions[id]);
  const cases = async id => (await as(id)('/api/customer-service')).json();
  const getCase = async (id, caseId) => (await cases(id)).cases.find(item => item.id === caseId);
  const act = async (id, caseId, body) => { const item = await getCase(id, caseId); return as(id)('/api/customer-service', {method: 'POST', body: {requestId: crypto.randomUUID(), id: caseId, version: item?.version, ...body}}); };
  const caseRow = async caseId => { const row = await app.db.prepare('SELECT status,assigned_to AS assignedTo,supervisor_id AS supervisorId,data FROM crm_service_cases WHERE id=?').bind(caseId).first(); return row && {...row, data: JSON.parse(row.data)}; };
  async function eventually(probe, message, timeoutMs = 20000) {
    const until = Date.now() + timeoutMs;
    for (;;) { const value = await probe(); if (value) { checks++; return value; } if (Date.now() > until) throw Error(message + ' (timed out)'); await pause(150); }
  }

  /** A signed-in page. native: false = plain browser, object = the Android app emulator (the phone is set up for that account). */
  async function open(memberId, {native = false, viewport = PHONE, clock = false, hash = ''} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', geolocation: {latitude: 26.437341, longitude: 50.034499, accuracy: 8}, permissions: ['geolocation']});
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (clock) await page.clock.install();
    if (native) await installNativeBridge(page, native === true ? {} : native);
    await page.goto(app.origin + '/' + hash);
    await page.locator('.workspace').waitFor();
    return page;
  }
  const settle = page => page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const shot = async (page, label) => { await settle(page); await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const pick = async (page, scope, name, option) => { await scope.getByRole('combobox', {name, exact: true}).click(); await page.getByRole('option', {name: option, exact: true}).click(); await page.getByRole('option').first().waitFor({state: 'hidden'}); };
  const layoutOk = async (page, label) => { const geometry = await page.evaluate(() => ({overflow: document.documentElement.scrollWidth > innerWidth + 1, width: innerWidth})); check(geometry.overflow, false, label + ': no horizontal overflow at ' + geometry.width + 'px'); };
  const goDesktop = async (page, label) => { await page.locator('button.nav-item', {hasText: label}).first().click(); await page.locator('.page-heading h1', {hasText: label}).waitFor(); };
  const goPhone = async (page, id) => { await page.locator('.mobile-tab[data-page="' + id + '"]').click(); await page.locator('.mobile-tab[data-page="' + id + '"][aria-current="page"]').waitFor(); };
  // Ten minutes pass for the page's timers; its wall clock stays on real time so that everything it records is stamped honestly.
  const tenMinutes = async page => { await page.clock.fastForward(601000); await page.clock.setSystemTime(new Date()); };
  const badgeOf = async locator => (await locator.count()) ? (await locator.first().innerText()).trim() : '';
  const private_ = text => /PRIVATE-/.test(text);

  // ---- fixtures: one customer owned by a representative, one customer-service request approved to the manager
  const stamp = new Date().toISOString();
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('f1','customer',NULL,'rep2','الرئيسي',?,?,?,1,'fixture')")
    .bind(JSON.stringify({name: CUSTOMER, region: 'الشرقية', city: 'الدمام', phone: '0500000001', contact: 'م', code: 'f1', branch: 'الرئيسي', assignedTo: 'rep2'}), stamp, stamp).run();
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('f2','customer',NULL,'rep2','الرئيسي',?,?,?,1,'fixture')")
    .bind(JSON.stringify({name: CUSTOMER_2, region: 'الشرقية', city: 'الخبر', phone: '0500000002', contact: 'ع', code: 'f2', branch: 'الرئيسي', assignedTo: 'rep2'}), stamp, stamp).run();
  const registration = {type: 'call', summary: 'PRIVATE-REGISTRATION-SUMMARY', result: 'متابعة العميل', salesStage: 'new', strength: 'strong', requestedProducts: ['قوالب البلوك المتحركة', 'خدمات صيانة'], nextAction: 'اتصال بالعميل', nextDate: day, location: '26.437341, 50.034499', locationSource: 'device', locationCapturedAt: stamp, locationAccuracy: 12, customerNeeds: 'قالب جديد وصيانة للقالب الحالي', hasCompetitor: true, competitorName: 'Competitor', competitorNotes: 'PRIVATE-COMPETITOR-NOTE'};
  const created = await as('cs')('/api/customer-service', {method: 'POST', body: {action: 'create', requestId: crypto.randomUUID(), customerId: 'f1', customerVersion: 1, registration, elapsedMilliseconds: 2200}});
  check(created.status, 200, 'customer service registers a request: ' + created.text.slice(0, 100));
  const caseId = created.json().id;
  check((await act('csm', caseId, {action: 'approve', targetId: 'sm'})).status, 200, 'the customer-service manager approves it to the sales manager');

  // ---- 1. The manager: a count on Visits, the request waiting for his assignment, the sheet, the instruction
  const manager = await open('sm', {viewport: DESKTOP});
  {
    const badge = manager.locator('button.nav-item .nav-badge');
    await badge.first().waitFor();
    check([await badgeOf(badge), (await badge.first().getAttribute('aria-label')).includes('1')], ['1', true], 'the Visits entry counts the one request waiting for him');
    check(await manager.locator('.service-queue-banner').count(), 0, 'the banner is for representatives only');
    await goDesktop(manager, 'الزيارات');
    const panel = manager.locator('.service-queue');
    await panel.waitFor();
    check(await panel.getAttribute('data-role'), 'manager', 'the panel knows whose it is');
    const card = panel.locator(`.service-queue-group[data-group="mine"] [data-case="${caseId}"]`);
    await card.waitFor();
    check([await card.getAttribute('data-stage'), await card.getAttribute('data-awaiting'), await card.getAttribute('data-late')], ['assignment', 'assign', 'false'], 'waiting for his assignment, within target');
    const text = await card.innerText();
    ok(text.includes(CUSTOMER) && text.includes('قوالب البلوك المتحركة') && text.includes('قالب جديد وصيانة للقالب الحالي') && text.includes('بانتظار تكليف المبيعات'), 'the brief: customer, products, need, stage');
    ok(!private_(await panel.innerText()) && !private_(await manager.content()), 'the registration text and competitor notes are not on the page');
    await layoutOk(manager, 'manager panel'); await shot(manager, 'queue-manager-panel');

    await card.getByRole('button', {name: 'تكليف', exact: true}).click();
    const sheet = manager.locator('.service-sheet');
    await sheet.locator('.service-routing select').waitFor();
    const select = sheet.locator('.service-routing select');
    check(await select.inputValue(), 'rep2', 'the customer\'s current representative is suggested');
    ok((await select.locator('option[value="rep2"]').innerText()).includes('المندوب الحالي للعميل'), 'and named as such');
    check(await select.locator('option').evaluateAll(options => options.map(option => option.value).filter(Boolean).sort()), ['rep', 'rep2', 'sup'], 'the manager may pick the supervisor or either representative');
    await select.selectOption('sup');
    await sheet.locator('.service-routing textarea').fill('ركّز على قطع الغيار');
    await shot(manager, 'queue-manager-assign-sheet');
    await sheet.getByRole('button', {name: 'تأكيد التكليف'}).click();
    const assigned = await eventually(async () => { const row = await caseRow(caseId); return row.assignedTo === 'sup' && row; }, 'the case is assigned to the supervisor');
    check([assigned.status, assigned.data.assignmentNote, assigned.data.assignmentNoteBy], ['assigned', 'ركّز على قطع الغيار', 'sm'], 'saved with the instruction and its author');
    await manager.keyboard.press('Escape');
    await sheet.waitFor({state: 'detached'});
    await eventually(async () => (await manager.locator('button.nav-item .nav-badge').count()) === 0, 'the count leaves the Visits entry');
    const followed = manager.locator(`.service-queue-group[data-group="active"] [data-case="${caseId}"]`);
    await followed.waitFor();
    check([await followed.getAttribute('data-stage'), await followed.getAttribute('data-awaiting')], ['delegation', 'none'], 'he now follows it with the supervisor');
    ok((await followed.innerText()).includes('لم يفتحه المكلَّف بعد'), 'and sees that the holder has not opened it');
  }

  // ---- 2. The supervisor: the instruction, delegation to a representative
  const supervisor = await open('sup', {viewport: DESKTOP});
  {
    const badge = supervisor.locator('button.nav-item .nav-badge');
    await badge.first().waitFor();
    check(await badgeOf(badge), '1', 'the supervisor\'s Visits entry counts it');
    await goDesktop(supervisor, 'الزيارات');
    const card = supervisor.locator(`.service-queue [data-case="${caseId}"]`);
    await card.waitFor();
    check([await card.getAttribute('data-stage'), await card.getAttribute('data-awaiting')], ['delegation', 'delegate'], 'waiting for his delegation');
    const note = card.locator('.service-queue-note');
    ok((await note.innerText()).includes('ركّز على قطع الغيار') && (await note.innerText()).includes('سعد مدير المبيعات'), 'the manager\'s instruction, signed');
    await card.getByRole('button', {name: 'تفويض مندوب', exact: true}).click();
    const sheet = supervisor.locator('.service-sheet');
    const select = sheet.locator('.service-routing select');
    await select.waitFor();
    check(await select.locator('option').evaluateAll(options => options.map(option => option.value).filter(Boolean).sort()), ['rep', 'rep2'], 'only his representatives are offered, not himself');
    await select.selectOption('rep');
    await sheet.locator('.service-routing textarea').fill('ابدأ بالاتصال');
    await sheet.getByRole('button', {name: 'تكليف مندوب'}).click();
    const delegated = await eventually(async () => { const row = await caseRow(caseId); return row.assignedTo === 'rep' && row; }, 'the case is delegated to the representative');
    check([delegated.data.assignmentNote, delegated.data.assignmentNoteBy, delegated.data.seenAt], ['ابدأ بالاتصال', 'sup', undefined], 'the latest instruction replaces the earlier; nobody has opened it yet');
    check(await app.db.prepare("SELECT assigned_to FROM crm_records WHERE id='f1'").first('assigned_to'), 'rep', 'the customer moved to the representative with the case');
    await supervisor.keyboard.press('Escape');
    await eventually(async () => (await supervisor.locator('button.nav-item .nav-badge').count()) === 0, 'the count leaves his entry');
    const tracked = supervisor.locator(`.service-queue [data-case="${caseId}"]`);
    check([await tracked.getAttribute('data-stage'), await tracked.getAttribute('data-awaiting')], ['first_contact', 'none'], 'he follows it as it waits for the first contact');
    ok((await tracked.innerText()).includes('لم يفتحه المكلَّف بعد'), 'not opened yet');
    await shot(supervisor, 'queue-supervisor-panel');
  }

  // ---- 3. The representative, on the Android app emulator: told on every page, opens it, records the first contact
  {
    const rep = await open('rep', {native: {memberId: 'rep', regionScope: 'all'}, clock: true});
    let crmGets = 0;
    rep.on('request', request => { if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/crm') crmGets++; });
    const banner = rep.locator('.service-queue-banner');
    await banner.waitFor();
    check([await banner.getAttribute('role'), await banner.getAttribute('data-count')], ['status', '1'], 'a status banner announces the one waiting request');
    let text = await banner.innerText();
    ok(text.includes(CUSTOMER) && text.includes('قالب جديد وصيانة للقالب الحالي') && text.includes('توجيه: ابدأ بالاتصال'), 'it names the customer, the need and the supervisor\'s instruction');
    ok(!private_(text) && !private_(await rep.content()), 'and carries none of the registration text');
    const tab = rep.locator('.mobile-tab[data-page="activity"] .nav-badge');
    check([await badgeOf(tab), (await tab.getAttribute('aria-label')).includes('1')], ['1', true], 'the Visits tab carries the count');
    await layoutOk(rep, 'rep banner'); await shot(rep, 'queue-rep-banner');
    await goPhone(rep, 'customer');
    check(await banner.count(), 1, 'the banner stays on every page, not only on Visits');
    await goPhone(rep, 'activity');
    const waiting = rep.locator(`.service-queue-group[data-group="new"] [data-case="${caseId}"]`);
    await waiting.waitFor();
    check([await waiting.getAttribute('data-stage'), await waiting.getAttribute('data-awaiting')], ['first_contact', 'first_contact'], 'on Visits the same request waits for his first contact');
    ok((await waiting.locator('.service-queue-note').innerText()).includes('ابدأ بالاتصال'), 'with the instruction');
    check(await waiting.locator('button', {hasText: 'تسجيل زيارة'}).count(), 1, 'and a one-tap way to record the visit');
    await layoutOk(rep, 'rep Visits page'); await shot(rep, 'queue-rep-panel');

    // opening the request is recorded once, for the manager to see
    await banner.getByRole('button', {name: 'فتح الطلب'}).click();
    const sheet = rep.locator('.service-sheet');
    await sheet.waitFor();
    const opened = await eventually(async () => { const row = await caseRow(caseId); return row.data.seenAt && row; }, 'the opening is recorded');
    check([opened.data.seenBy, opened.assignedTo], ['rep', 'rep'], 'by the holder');
    text = await sheet.innerText();
    ok(text.includes('ابدأ بالاتصال') && text.includes('توجيه المدير') && !private_(text), 'the sheet shows the instruction and no private text');
    await rep.keyboard.press('Escape');
    await sheet.waitFor({state: 'detached'});
    check(await banner.count(), 1, 'opening is not a contact: the banner stays');
    await manager.reload();
    await manager.locator('.workspace').waitFor();
    await goDesktop(manager, 'الزيارات');
    const watched = manager.locator(`.service-queue [data-case="${caseId}"]`);
    await watched.waitFor();
    ok((await watched.innerText()).includes('فتحه أحمد المندوب'), 'the manager now reads who opened it');

    // a request that arrives while he is idle reaches him within ten minutes, with no action of his
    const second = await as('cs')('/api/customer-service', {method: 'POST', body: {action: 'create', requestId: crypto.randomUUID(), customerId: 'f2', customerVersion: 1, data: {source: 'whatsapp', products: ['خلاطات البلوك'], strength: 'medium', needs: 'عرض سعر لخلاط', nextAction: 'اتصال', nextDate: day}}});
    check(second.status, 200, 'customer service registers a second request: ' + second.text.slice(0, 80));
    const secondId = second.json().id;
    check((await act('csm', secondId, {action: 'approve', targetId: 'sm'})).status, 200, 'approved');
    check((await act('sm', secondId, {action: 'assign', targetId: 'rep', note: 'عميل جديد'})).status, 200, 'and assigned straight to the representative');
    await pause(1200);
    check(await banner.getAttribute('data-count'), '1', 'nothing changes on his screen before the ten minutes');
    const before = crmGets;
    await tenMinutes(rep);
    await eventually(async () => (await banner.getAttribute('data-count')) === '2', 'the second request reaches the idle representative');
    ok(crmGets > before, 'by an ordinary reload');
    ok((await banner.innerText()).includes('و1 أخرى'), 'the banner says there is another');
    check(await badgeOf(tab), '2', 'and the tab counts two');

    // a tapped notification: the app tells the running page, which opens that request and records the opening
    await rep.evaluate(id => window.dispatchEvent(new CustomEvent('yourrest:open-service-case', {detail: {id}})), secondId);
    const named = rep.locator('.service-sheet');
    await named.waitFor();
    ok((await named.innerText()).includes(CUSTOMER_2), 'a tapped notification opens that request on the running page');
    const namedRow = await eventually(async () => { const row = await caseRow(secondId); return row.data.seenAt && row; }, 'the opening through the notification is recorded');
    check(namedRow.data.seenBy, 'rep', 'by the holder');
    await rep.keyboard.press('Escape');
    await named.waitFor({state: 'detached'});
    await rep.evaluate(() => { for (const id of ['', 'a b', '"><x>', 'x'.repeat(201), 42, null]) window.dispatchEvent(new CustomEvent('yourrest:open-service-case', {detail: {id}})); });
    await pause(600);
    check(await rep.locator('.service-sheet').count(), 0, 'an identifier that is not plain opens nothing');
    // a cold start from a notification or a link carries the request in its address and consumes it
    const cold = await open('rep', {native: {memberId: 'rep', regionScope: 'all'}, hash: '#service-case=' + caseId});
    await cold.locator('.service-sheet').waitFor();
    ok((await cold.locator('.service-sheet').innerText()).includes(CUSTOMER), 'a cold start opens the request named in the address');
    check(await cold.evaluate(() => location.hash), '#activity', 'and leaves the address on the Visits page');
    await cold.keyboard.press('Escape');
    await cold.locator('.service-sheet').waitFor({state: 'detached'});
    await cold.context().close();

    // an open editor is never reloaded underneath the person typing
    await banner.getByRole('button', {name: 'تسجيل زيارة'}).click();
    const dialog = rep.locator('.customer-visit-dialog');
    await dialog.waitFor();
    ok((await dialog.innerText()).includes(CUSTOMER), 'the visit opens for the first request\'s customer');
    check(await dialog.locator('input[aria-label="لوكيشن الزيارة التلقائي"]').inputValue(), '26.4373410, 50.0344990', 'with the location taken by the app');
    const next = dialog.getByRole('textbox', {name: /^الإجراء القادم/});
    check(await next.inputValue(), 'اتصال بالعميل', 'the next step comes from the request');
    await next.fill('اتصال أول بالعميل لتحديد موعد');
    await rep.evaluate(id => window.dispatchEvent(new CustomEvent('yourrest:open-service-case', {detail: {id}})), secondId);
    await rep.locator('[data-sonner-toast]', {hasText: 'أنهِ ما بين يديك'}).waitFor();
    check([await rep.locator('.service-sheet').count(), await next.inputValue(), await dialog.count()], [0, 'اتصال أول بالعميل لتحديد موعد', 1], 'a notification tapped while a visit is being written never replaces it: a notice only');
    const mid = crmGets;
    await tenMinutes(rep);
    await pause(1500);
    check([crmGets, await next.inputValue(), await dialog.count()], [mid, 'اتصال أول بالعميل لتحديد موعد', 1], 'ten more minutes: no reload, the editor and what was typed are untouched');
    await pick(rep, dialog, 'نوع التواصل', 'اتصال');
    await pick(rep, dialog, 'اختر الهدف من الزيارة', 'تعريف بمنتجات الشركة');
    await pick(rep, dialog, 'نتيجة الزيارة', 'متابعة العميل');
    await shot(rep, 'queue-rep-visit');
    await dialog.getByRole('button', {name: 'حفظ الزيارة'}).click();
    await dialog.waitFor({state: 'detached'});
    const contacts = await eventually(async () => { const n = await app.db.prepare("SELECT COUNT(*) AS n FROM crm_records WHERE kind='activity' AND json_extract(data,'$.serviceCaseId')=?").bind(caseId).first('n'); return n === 1 && n; }, 'the first contact is recorded against the request');
    check(contacts, 1, 'one contact on the first request');
    await eventually(async () => (await banner.getAttribute('data-count')) === '1', 'the banner now counts only the second request');
    ok((await banner.innerText()).includes(CUSTOMER_2) && !(await banner.innerText()).includes(CUSTOMER + ':'), 'and names it');
    const progressed = rep.locator(`.service-queue [data-case="${caseId}"]`);
    await progressed.waitFor();
    check([await progressed.getAttribute('data-stage'), await progressed.getAttribute('data-awaiting')], ['follow_up', 'none'], 'the first request is now in sales follow-up and no longer waits for him');
    check(await badgeOf(tab), '1', 'the tab counts the one that still waits');

    // the last contact is made elsewhere (any channel); the idle screen clears by itself
    const visit = await as('rep')('/api/visits', {method: 'POST', body: {createKey: crypto.randomUUID(), customerId: 'f2', customerVersion: await app.db.prepare("SELECT version FROM crm_records WHERE id='f2'").first('version'), timingMode: 'automatic', elapsedMilliseconds: 2000, data: {type: 'call', date: day, summary: 'تواصل مع العميل', result: 'تم التواصل', salesStage: 'new', strength: 'medium', nextAction: 'زيارة فنية', nextDate: day, location: '26.43, 50.03', locationSource: 'device', locationCapturedAt: new Date().toISOString(), locationAccuracy: 10}}});
    check(visit.status, 200, 'a contact recorded from another device: ' + visit.text.slice(0, 80));
    await tenMinutes(rep);
    await banner.waitFor({state: 'detached'});
    await eventually(async () => (await rep.locator('.mobile-tab[data-page="activity"] .nav-badge').count()) === 0, 'the count leaves the tab');
    await layoutOk(rep, 'rep after the contacts'); await shot(rep, 'queue-rep-cleared');
    await rep.context().close();
  }

  // ---- 4. The monthly report: for the people who run the service, nobody else
  {
    const section = manager.locator('details.service-report');
    await section.waitFor();
    check(await section.evaluate(element => element.open), false, 'collapsed until opened');
    await section.locator('summary').click();
    await section.locator('.service-report-kpis').waitFor();
    const kpis = await section.locator('.service-report-kpi').evaluateAll(items => items.map(item => item.innerText.replace(/\s+/g, ' ').trim()));
    check(kpis, ['2 الطلبات', '2 مفتوحة', '0 فاز', '0 فُقد', '— نسبة الفوز', '0 مفتوحة وتجاوزت هدفها'], 'two requests this month, both open, no win rate yet');
    const channels = await section.locator('table').first().locator('tbody tr').evaluateAll(rows => rows.map(row => row.innerText.replace(/\s+/g, ' ').trim()));
    check(channels, ['اتصال 1 0 0 1 —', 'واتساب 1 0 0 1 —'], 'by the channel each came through');
    const stages = await section.locator('table').nth(1).locator('tbody tr').evaluateAll(rows => rows.map(row => row.innerText.replace(/\s+/g, ' ').trim().split(' ')[0]));
    check(stages.length, 4, 'four stages are timed');
    const timed = await section.locator('table').nth(1).locator('tbody tr').evaluateAll(rows => rows.map(row => row.querySelectorAll('td')[1].innerText.trim()));
    check(timed, ['2', '2', '2', '2'], 'each stage has both requests, since both were approved, assigned and contacted');
    ok((await section.locator('.service-report-states').innerText()).includes('قيد متابعة المبيعات: 2'), 'both are in sales follow-up');
    ok(!private_(await section.innerText()) && !(await section.innerText()).includes(CUSTOMER), 'no customer name and no private text in the report');
    await layoutOk(manager, 'manager report'); await shot(manager, 'queue-manager-report');
    check(await supervisor.locator('details.service-report').count(), 0, 'a supervisor has no report section');
    const service = await open('cs', {viewport: DESKTOP});
    check([await service.locator('.service-queue').count(), await service.locator('button.nav-item .nav-badge').count()], [0, 0], 'customer service has its own screens, not the sales queue');
    await service.context().close();
    const csm = await open('csm', {viewport: DESKTOP});
    await goDesktop(csm, 'الزيارات');
    await csm.locator('details.service-report').waitFor();
    check(await csm.locator('.service-queue').count(), 0, 'the customer-service manager gets the report but not the sales queue');
    await csm.context().close();
    await manager.context().close();
    await supervisor.context().close();
  }

  check(errors, [], 'no page errors in any browser');
  console.log(JSON.stringify({ok: true, checks, builtRelease: true, browser: 'chromium', androidApp: 'emulated bridge', physicalDevice: false, productionDataUsed: false, screenshots}));
} finally {
  await browser?.close();
  await app?.stop();
}
