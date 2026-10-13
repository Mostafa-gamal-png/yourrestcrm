// Customer-service assistance in a real Chromium against the BUILT release (run `pnpm build` first): a representative, on the
// Android app emulator, asks for help beside a visit; the customer-service member of the region sees it and a missed visit on
// the Visits page, takes the visit, answers the request; the representative reads the answer and the count clears; a late
// request nobody covers reaches the customer-service manager, who assigns it; a supervisor reads their team's requests without
// being able to act on them. The phone's consent, permissions and enrolment are the emulator's (scripts/lib/native-bridge.mjs):
// no device, GPS or OS claim is made.
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
  {id: 'csm', role: 'customer_service_manager', sup: 'sm', name: 'منى مديرة الخدمة'},
  {id: 'cs_east', role: 'customer_service', sup: 'csm', region: 'eastern', name: 'ريم الشرقية'}, {id: 'cs_west', role: 'customer_service', sup: 'csm', region: 'western', name: 'هند الغربية'}, {id: 'cs_all', role: 'customer_service', sup: 'csm', name: 'سارة كل المناطق'}
];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-support-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1280, height: 900};
const CUSTOMER = 'مصنع الأمل للبلاستيك', MISSED = 'مصنع النور للخرسانة', CENTRAL = 'مصنع الوسط للبلوك';
const NOTE = 'العميل لا يرد على اتصالاتي، اسألوه عن موعد مناسب للزيارة', ANSWER = 'العميل مهتم ويطلب زيارة فنية يوم الأحد';

try {
  app = await bootBuiltApp({members}, {tls: true});
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  const dayOf = offset => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date(Date.now() + offset * 86400000));
  const sessions = {};
  for (const member of members) sessions[member.id] = await app.login(member.id);
  const as = id => app.as(sessions[id]);
  const rows = async () => (await app.db.prepare("SELECT id,data,version FROM crm_records WHERE kind='support' ORDER BY created_at,id").all()).results.map(row => ({...row, data: JSON.parse(row.data)}));
  const rowFor = async customerId => (await rows()).filter(row => row.data.customerId === customerId).at(-1);
  async function eventually(probe, message, timeoutMs = 20000) {
    const until = Date.now() + timeoutMs;
    for (;;) { const value = await probe(); if (value) { checks++; return value; } if (Date.now() > until) throw Error(message + ' (timed out)'); await pause(150); }
  }

  /** A signed-in page. native: false = plain browser, object = the Android app emulator (the phone is set up for that account). */
  async function open(memberId, {native = false, viewport = PHONE} = {}) {
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
  const settle = page => page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
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

  // ---- fixtures: an eastern customer with two visits, an eastern customer whose visit went unanswered, a central customer nobody is named for
  const created = new Date().toISOString();
  const customer = (id, name, region, assignedTo = 'rep') => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, assignedTo, JSON.stringify({name, region, city: 'الدمام', phone: '0551234567', contact: 'م', code: id, branch: 'الرئيسي', assignedTo}), created, created).run();
  await customer('f1', CUSTOMER, 'الشرقية'); await customer('f2', MISSED, 'الشرقية'); await customer('f3', CENTRAL, 'الوسطى');
  const seedVisit = (id, customerId, number, daysAgo, fields = {}) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'activity',?,'rep','الرئيسي',?,?,?,1,'fixture')")
    .bind(id, customerId, JSON.stringify({type: 'visit', date: dayOf(-daysAgo), startedAt: dayOf(-daysAgo) + 'T07:00:00.000Z', endedAt: dayOf(-daysAgo) + 'T07:30:00.000Z', summary: 'تعريف بمنتجات الشركة', result: 'متابعة العميل', salesStage: 'new', strength: 'medium', nextAction: 'زيارة متابعة', nextDate: dayOf(3), visitWorkflow: 'customer-v1', visitNumber: number, performedBy: 'rep', responsibleId: 'rep', recordedByEmail: 'rep@yourrest.org', ...fields}), dayOf(-daysAgo) + 'T07:00:00.000Z', dayOf(-daysAgo) + 'T07:00:00.000Z').run();
  await seedVisit('visit-f1-old', 'f1', 1, 20); await seedVisit('visit-f1-new', 'f1', 2, 6, {nextDate: dayOf(2)});
  await seedVisit('visit-f2-bad', 'f2', 3, 9, {result: 'سلبية', nextDate: dayOf(-5), nextAction: 'عرض سعر جديد'});
  await seedVisit('visit-f3', 'f3', 4, 4);

  // ---- 1. The representative, on the Android app emulator, asks for help beside the visit
  const rep = await open('rep', {native: {memberId: 'rep', regionScope: 'all'}});
  let requestId;
  {
    await goPhone(rep, 'activity');
    const cards = rep.locator('.rep-mobile-records .rep-record-card');
    await cards.first().waitFor();
    check(await cards.count(), 4, 'the Visits page lists the four visits');
    const button = rep.locator('.rep-mobile-records .support-request-button[data-customer="f1"]');
    check(await button.count(), 1, 'one help button for the customer who has two visits: beside the latest');
    check(await rep.locator('.rep-mobile-records .support-request-button').count(), 3, 'and one beside each other customer');
    ok((await button.locator('xpath=ancestor::article').innerText()).includes('2'), 'it sits on the latest visit, number 2');
    check(await rep.locator('.support-panel').count(), 0, 'with nothing asked yet there is no panel');
    await layoutOk(rep, 'rep Visits page'); await shot(rep, 'support-rep-visits');
    await button.click();
    const dialog = rep.locator('.support-dialog');
    await dialog.waitFor();
    const send = dialog.getByRole('button', {name: 'إرسال الطلب'});
    check(await send.isDisabled(), true, 'Send stays disabled until the reason is written');
    ok((await dialog.innerText()).includes(CUSTOMER), 'the form names the customer');
    await dialog.locator('textarea').fill(NOTE);
    await dialog.locator('select').selectOption('whatsapp');
    check(await send.isDisabled(), false, 'then it is enabled');
    await layoutOk(rep, 'rep request form'); await shot(rep, 'support-rep-dialog');
    await send.click();
    await dialog.waitFor({state: 'detached'});
    const stored = await eventually(async () => rowFor('f1'), 'the request is stored');
    requestId = stored.id;
    check([stored.data.status, stored.data.origin, stored.data.requestedBy, stored.data.repId, stored.data.note, stored.data.channel, stored.data.handlerId], ['open', 'rep', 'rep', 'rep', NOTE, 'whatsapp', 'cs_east'], 'saved with the reason and channel, already routed to the eastern representative');
    const chip = rep.locator('.rep-mobile-records .support-chip[data-customer="f1"]');
    await chip.waitFor();
    check([await chip.getAttribute('data-state'), (await chip.innerText()).includes('خدمة العملاء تتواصل')], ['in_progress', true], 'the button becomes a status chip: customer service is in contact');
    check(await rep.locator('.rep-mobile-records .support-request-button[data-customer="f1"]').count(), 0, 'no second request button for that customer');
    const panel = rep.locator('.support-panel');
    await panel.waitFor();
    check(await panel.getAttribute('data-role'), 'rep', 'the panel knows whose it is');
    const card = panel.locator(`.support-group[data-group="waiting"] [data-request="${requestId}"]`);
    await card.waitFor();
    const text = await card.innerText();
    ok(text.includes(CUSTOMER) && text.includes(NOTE) && text.includes('ريم الشرقية'), 'the card names the customer, the reason and the holder');
    check(await badgeOf(rep.locator('.mobile-tab[data-page="activity"] .nav-badge')), '', 'nothing to count for him yet: the answer has not come');
    await layoutOk(rep, 'rep panel'); await shot(rep, 'support-rep-panel');
    // a second request for the same customer is refused by the server, even from a stale button
    const again = await as('rep')('/api/support', {method: 'POST', body: {requestId: crypto.randomUUID(), action: 'request', customerId: 'f1', customerVersion: 1, note: 'محاولة ثانية'}});
    check(again.status, 409, 'a second request while one is open is refused');
  }

  // ---- 2. Customer service of the east: the request that is theirs and the missed visit, taken and answered
  const east = await open('cs_east', {viewport: DESKTOP});
  {
    const panel = east.locator('.support-panel');
    await panel.waitFor();
    check(await panel.getAttribute('data-role'), 'customer_service', 'the representative of the east has the panel on the Visits page');
    const mine = panel.locator(`.support-group[data-group="mine"] [data-request="${requestId}"]`);
    await mine.waitFor();
    check([await mine.getAttribute('data-awaiting'), await mine.getAttribute('data-origin')], ['contact', 'rep'], 'the request routed to them waits for their contact');
    const text = await mine.innerText();
    ok(text.includes(CUSTOMER) && text.includes('0551234567') && text.includes(NOTE) && text.includes('أحمد المندوب'), 'with the customer, phone, reason and who asked');
    ok((await mine.locator('a[href^="tel:"]').count()) === 1 && (await mine.locator('a[href^="https://wa.me/966551234567"]').count()) === 1, 'a dial link and a WhatsApp link');
    const missed = panel.locator('.support-group[data-group="missed"] [data-missed="visit-f2-bad"]');
    await missed.waitFor();
    const missedText = await missed.innerText();
    ok(missedText.includes(MISSED) && missedText.includes('متأخرة 5 يومًا') && missedText.includes('عرض سعر جديد') && missedText.includes('أحمد المندوب'), 'the unanswered visit: customer, days behind, the plan that was not carried out, the representative');
    check(await panel.locator('[data-missed]').count(), 1, 'only the one missed visit: the customer with an open request and the visits that went well are not on it');
    ok(!/PRIVATE/.test(await panel.innerText()), 'nothing private');
    const badge = east.locator('button.nav-item .nav-badge');
    await badge.first().waitFor();
    check(await badgeOf(badge), '2', 'the Visits entry counts the request to answer and the missed visit to take');
    await layoutOk(east, 'customer-service panel'); await shot(east, 'support-cs-panel');
    // take the missed visit
    await missed.getByRole('button', {name: 'تولّي التواصل'}).click();
    const taken = await eventually(async () => { const row = await rowFor('f2'); return row && row.data.handlerId === 'cs_east' && row; }, 'the missed visit is stored under the one who took it');
    check([taken.id, taken.data.origin, taken.data.status, taken.data.requestedBy, taken.data.repId, taken.data.plan.visitId, taken.data.plan.nextAction], ['support-missed-visit-f2-bad', 'missed_visit', 'open', 'cs_east', 'rep', 'visit-f2-bad', 'عرض سعر جديد'], 'with its plan');
    await panel.locator('[data-missed]').first().waitFor({state: 'detached'});
    check(await panel.locator(`.support-group[data-group="mine"] [data-request]`).count(), 2, 'it leaves the missed list and joins the ones they hold');
    check(await badgeOf(badge), '2', 'two to answer now');
    // answer the request: the customer asks for a visit
    await mine.getByRole('button', {name: 'تسجيل النتيجة'}).click();
    const sheet = east.locator('.support-sheet');
    await sheet.waitFor();
    ok((await sheet.innerText()).includes(NOTE) && (await sheet.innerText()).includes('أحمد المندوب'), 'the sheet shows the facts');
    const record = sheet.getByRole('button', {name: 'تسجيل النتيجة'});
    check(await record.isDisabled(), true, 'recording stays disabled until the outcome and a few words are given');
    await sheet.locator('.service-internal select').selectOption('wants_visit');
    check(await sheet.locator('input[type=date]').count(), 1, 'a visit the customer asks for needs its date');
    await sheet.locator('textarea').fill(ANSWER);
    check(await record.isDisabled(), true, 'still disabled without the date');
    await sheet.locator('input[type=date]').fill(dayOf(3));
    check(await record.isDisabled(), false, 'enabled once complete');
    await shot(east, 'support-cs-sheet');
    await record.click();
    const answered = await eventually(async () => { const row = await rowFor('f1'); return row.data.status === 'done' && row; }, 'the request is answered');
    check([answered.data.result.outcome, answered.data.result.note, answered.data.result.nextDate, answered.data.result.by, answered.data.handlerId, answered.version], ['wants_visit', ANSWER, dayOf(3), 'cs_east', 'cs_east', 2], 'recorded with the outcome, the words, the date the customer asked for and who answered');
    await east.keyboard.press('Escape');
    await sheet.waitFor({state: 'detached'});
    await eventually(async () => (await panel.locator(`.support-group[data-group="mine"] [data-request="${requestId}"]`).count()) === 0, 'the answered request leaves the ones they hold');
    await eventually(async () => (await panel.locator('details[data-group="finished"] [data-request]').count()) === 1, 'and is among the finished ones');
    await eventually(async () => (await badgeOf(badge)) === '1', 'one left to answer: the visit they took');
    // the old cases and records are untouched
    check((await (await as('owner')('/api/customer-service')).json()).cases, [], 'no customer-service case was made');
  }

  // ---- 3. The representative reads the answer; the count clears once it is opened
  {
    await rep.reload();
    await rep.locator('.workspace').waitFor();
    await goPhone(rep, 'activity');
    const chip = rep.locator('.rep-mobile-records .support-chip[data-customer="f1"]');
    await chip.waitFor();
    check([await chip.getAttribute('data-state'), await chip.getAttribute('data-unseen'), (await chip.innerText()).includes('ردّت خدمة العملاء')], ['done', 'true', true], 'the chip says customer service replied, and that he has not opened it');
    const tab = rep.locator('.mobile-tab[data-page="activity"] .nav-badge');
    await tab.first().waitFor();
    check(await badgeOf(tab), '1', 'the Visits tab counts the answer');
    const card = rep.locator(`.support-group[data-group="answered"] [data-request="${requestId}"]`);
    await card.waitFor();
    const text = await card.innerText();
    ok(text.includes(ANSWER) && text.includes(dayOf(3)) && text.includes('ريم الشرقية'), 'the card carries the answer, the date and who gave it');
    await layoutOk(rep, 'rep answer'); await shot(rep, 'support-rep-answer');
    await chip.click();
    const sheet = rep.locator('.support-sheet');
    await sheet.waitFor();
    const sheetText = await sheet.innerText();
    ok(sheetText.includes('العميل يطلب زيارة في موعد') && sheetText.includes(ANSWER) && sheetText.includes(dayOf(3)), 'opening it shows the outcome, the words and the date');
    ok(!(await sheet.getByRole('button', {name: 'تسجيل النتيجة'}).count()) && !(await sheet.getByRole('button', {name: 'تولّي التواصل'}).count()), 'a sales member cannot answer or take');
    const opened = await eventually(async () => { const row = await rowFor('f1'); return row.data.answerSeenAt && row; }, 'opening is recorded');
    check(opened.data.answerSeenBy, 'rep', 'by the one who asked');
    await rep.keyboard.press('Escape');
    await sheet.waitFor({state: 'detached'});
    await eventually(async () => (await tab.count()) === 0, 'the count leaves the Visits tab');
    check(await rep.locator('.rep-mobile-records .support-chip[data-customer="f1"]').getAttribute('data-unseen'), 'false', 'and the chip no longer calls for him');
  }

  // ---- 4. A late request nobody is named for reaches the customer-service manager, who assigns it
  const request3 = await as('rep')('/api/support', {method: 'POST', body: {requestId: crypto.randomUUID(), action: 'request', customerId: 'f3', customerVersion: 1, note: 'العميل المركزي لا يرد على المندوب', channel: 'call'}});
  check(request3.status, 200, 'a request for the central customer');
  const centralId = request3.json().id;
  check((await rowFor('f3')).data.handlerId, '', 'nobody is named for the center, so it waits');
  await app.db.prepare('UPDATE crm_records SET created_at=? WHERE id=?').bind(new Date(Date.now() - 30 * 86400000).toISOString(), centralId).run();
  const csm = await open('csm', {viewport: DESKTOP});
  {
    const panel = csm.locator('.support-panel');
    await panel.waitFor();
    const late = panel.locator(`.support-group[data-group="decide"] [data-request="${centralId}"]`);
    await late.waitFor();
    check([await late.getAttribute('data-late'), await late.getAttribute('data-awaiting'), await late.getAttribute('data-state')], ['true', 'assign', 'waiting'], 'left for a month it is late, and it is the manager\'s to decide');
    ok((await late.innerText()).includes('متأخر عن هدف 4 ساعات عمل'), 'the card says against which target');
    const badge = csm.locator('button.nav-item .nav-badge');
    await badge.first().waitFor();
    check(await badgeOf(badge), '1', 'the Visits entry counts it');
    ok(await panel.locator('.support-group[data-group="missed"] [data-missed]').count() === 0, 'the missed visit that was taken is not offered again');
    await shot(csm, 'support-manager-late');
    await late.getByRole('button', {name: 'التفاصيل'}).click();
    const sheet = csm.locator('.support-sheet');
    await sheet.waitFor();
    const select = sheet.locator('.service-routing select').first();
    check(await select.locator('option').evaluateAll(options => options.map(option => option.value).sort()), ['cs_all', 'csm'], 'only those who cover the center are offered: the representative for every region, and himself');
    await select.selectOption('cs_all');
    await sheet.getByRole('button', {name: 'تأكيد التكليف'}).click();
    const assigned = await eventually(async () => { const row = await rowFor('f3'); return row.data.handlerId === 'cs_all' && row; }, 'the request is assigned');
    check([assigned.data.handlerBy, assigned.data.status], ['csm', 'open'], 'assigned by the manager, still open');
    await csm.keyboard.press('Escape');
    await sheet.waitFor({state: 'detached'});
    await eventually(async () => (await csm.locator('button.nav-item .nav-badge').count()) === 1, 'it is now held, but still late: the count stays until it is answered');
  }

  // ---- 5. Others: the west sees nothing of the east; a supervisor reads their team's requests and cannot act on them
  {
    const west = await open('cs_west', {viewport: DESKTOP});
    await pause(800);
    check([await west.locator('.support-panel').count(), await west.locator('button.nav-item .nav-badge').count()], [0, 0], 'the representative of the west has no panel and no count');
    await west.context().close();
    const supervisor = await open('sup', {viewport: DESKTOP});
    await goDesktop(supervisor, 'الزيارات');
    const panel = supervisor.locator('.support-panel');
    await panel.waitFor();
    check(await panel.getAttribute('data-role'), 'supervisor', 'a supervisor has the panel');
    ok((await panel.innerText()).includes('طلبات فريقك لخدمة العملاء وردودها.'), 'for their team');
    check([await panel.locator('.support-group[data-group="waiting"] [data-request]').count(), await panel.locator('.support-group[data-group="answered"] [data-request]').count()], [2, 1], 'all three of their team\'s requests: the two still open and the one answered');
    check(await panel.getByRole('button', {name: 'تولّي التواصل'}).count(), 0, 'with no way to take one');
    await supervisor.context().close();
    const other = await open('rep2', {native: {memberId: 'rep2', regionScope: 'all'}});
    await goPhone(other, 'activity');
    await pause(800);
    check(await other.locator('.support-panel').count(), 0, 'another representative sees none of it');
    await other.context().close();
  }

  // ---- 6. English: every new text is translated, nothing widens the page
  {
    const phone = await open('cs_east', {viewport: PHONE});
    await phone.locator('.support-panel').waitFor();
    await layoutOk(phone, 'customer-service panel on a phone'); await shot(phone, 'support-cs-panel-phone');
    await phone.getByRole('button', {name: 'English'}).first().click();
    await phone.locator('.support-panel h2', {hasText: 'Customer contact'}).waitFor();
    const english = (await phone.locator('.support-panel').allInnerTexts()).join(' ');
    const leftover = english.replace(new RegExp([CUSTOMER, MISSED, CENTRAL, NOTE, ANSWER, 'ريم الشرقية', 'هند الغربية', 'سارة كل المناطق', 'أحمد المندوب', 'منى مديرة الخدمة', 'عرض سعر جديد', 'الدمام', 'الشرقية'].join('|'), 'g'), '').match(/[؀-ۿ]+/g) || [];
    check(leftover, [], 'no Arabic wording is left in the English panel (names and what people typed aside)');
    ok(english.includes('Finished') || english.includes('In your contact') || english.includes('Waiting for you to take'), 'the English headings are there');
    await layoutOk(phone, 'customer-service panel on a phone in English'); await shot(phone, 'support-cs-panel-phone-en');
    await phone.context().close();
  }
  await rep.context().close();
  await east.context().close();
  await csm.context().close();

  check(errors, [], 'no page errors in any browser');
  console.log(JSON.stringify({ok: true, checks, builtRelease: true, browser: 'chromium', androidApp: 'emulated bridge', physicalDevice: false, productionDataUsed: false, screenshots}));
} finally {
  await browser?.close();
  await app?.stop();
}
