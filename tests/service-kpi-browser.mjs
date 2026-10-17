// The customer-service evaluation in a real Chromium against the BUILT release (run `pnpm build` first): a representative closes a
// complaint with the customer's rating and finds it in "My evaluation"; the customer-service manager opens the evaluation page,
// opens a representative's card and a figure's cases, records and deletes a quality audit from the suggested sample; the
// administrator changes the weights, is stopped by a total that is not 100, closes a team's month and reopens it; the phone
// layout; the English page. Synthetic isolated fixtures only: temporary SQLite, mocked sendmail, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const require = createRequire(import.meta.url), {chromium} = require('playwright');
const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'سعد مدير المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'sm', name: 'ماجد المشرف'}, {id: 'rep', role: 'rep', sup: 'sup', name: 'أحمد المندوب'},
  {id: 'csm', role: 'customer_service_manager', sup: 'sm', name: 'منى مديرة الخدمة'},
  {id: 'cs1', role: 'customer_service', sup: 'csm', name: 'ريم ممثلة الخدمة'}, {id: 'cs2', role: 'customer_service', sup: 'csm', name: 'هند ممثلة الخدمة'}
];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-service-kpi-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const PHONE = {width: 360, height: 800}, DESKTOP = {width: 1280, height: 900};
const NAMES = ['مصنع الأمل للبلاستيك', 'مصنع النور للخرسانة', 'مصنع الصقر للحديد'];
const SEPT = '2026-09';

try {
  app = await bootBuiltApp({members}, {tls: true});
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  async function eventually(probe, message, timeoutMs = 20000) {
    const until = Date.now() + timeoutMs;
    for (;;) { const value = await probe(); if (value) { checks++; return value; } if (Date.now() > until) throw Error(message + ' (timed out)'); await pause(150); }
  }
  async function open(memberId, {viewport = DESKTOP} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', geolocation: {latitude: 26.437341, longitude: 50.034499, accuracy: 8}, permissions: ['geolocation']});
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
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
    await tab.click();
    await page.locator('.mobile-tab[data-page="' + id + '"][aria-current="page"]').waitFor();
  };
  const api = async (id, month, extra = '') => (await app.as(await app.login(id))('/api/service-kpi?month=' + month + extra)).json();
  const scoreOf = (answer, id) => { for (const group of answer.groups) for (const card of [...group.reps, ...(group.manager ? [group.manager] : [])]) if (card.memberId === id) return card.score; return undefined; };
  const rowsOf = async kind => (await app.db.prepare('SELECT id,data,version FROM crm_records WHERE kind=? ORDER BY created_at,id').bind(kind).all()).results.map(row => ({...row, data: JSON.parse(row.data)}));

  // ---- fixtures: three customers, September 2026 (the 6th is a Sunday) for cs1 and cs2, one complaint waiting for cs1 to confirm now, and the settings with every figure counting from one case
  const stamp = '2026-08-01T05:00:00.000Z';
  const customer = (id, name, region = 'الشرقية') => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')")
    .bind(id, JSON.stringify({name, region, city: 'الدمام', phone: '0551234567', contact: 'أبو خالد', code: id, branch: 'الرئيسي', assignedTo: 'rep'}), stamp, stamp).run();
  await customer('f1', NAMES[0]); await customer('f2', NAMES[1]); await customer('f3', NAMES[2]);
  const pad = n => String(n).padStart(2, '0');
  const T = (day, hour) => `2026-09-${pad(day)}T${pad(hour)}:00:00.000Z`;
  const base = at => ({kind: 'complaint', status: 'assigned', registrarId: 'cs1', serviceManagerId: 'csm', salesManagerId: 'sm', supervisorId: 'sup', assigneeId: 'rep', channel: 'call', category: 'product_quality', severity: 'normal', description: 'القالب يخرج منتجًا مكسورًا من الجهة اليمنى', demand: 'استبدال القالب', reference: 'INV-1', contactName: 'أبو خالد', contactPhone: '0551234567',
    submittedAt: at, forwardedAt: at, returnedAt: '', assignedAt: at, delegatedAt: '', reassignedAt: '', rejectedAt: '', reopenedAt: '', resolvedAt: '', closedAt: '', cancelledAt: '', seenAt: at, returnNote: '', assignmentNote: '', rejectReason: '', cancelReason: '', previousAssignees: [], updates: [], notes: [], events: []});
  const complaint = async (id, customerId, registrar, events, extra = {}) => {
    const list = events.map(([at, by, action, more]) => ({at, by, action, ...(more || {})}));
    const data = {...base(list[0].at), customerId, registrarId: registrar, events: list, ...extra};
    await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'complaint',NULL,?,'الرئيسي',?,?,?,1,'fixture')").bind('complaint-' + id, registrar, JSON.stringify(data), list[0].at, list.at(-1).at).run();
  };
  await complaint('A', 'f1', 'cs1', [[T(6, 5), 'cs1', 'register'], [T(6, 6), 'csm', 'forward', {targetId: 'sm'}], [T(6, 8), 'sm', 'assign', {targetId: 'rep'}], [T(7, 5), 'rep', 'resolve', {outcome: 'solved'}], [T(7, 7), 'cs1', 'close', {outcome: 'satisfied', rating: 5}]], {status: 'closed', closedAt: T(7, 7)});
  await complaint('B', 'f2', 'cs1', [[T(6, 6), 'cs1', 'register'], [T(6, 7), 'csm', 'return', {text: 'x'}], [T(6, 8), 'cs1', 'edit'], [T(6, 9), 'csm', 'forward'], [T(8, 5), 'rep', 'resolve'], [T(10, 5), 'cs1', 'reject', {text: 'x'}], [T(10, 7), 'rep', 'resolve'], [T(12, 5), 'cs1', 'close', {outcome: 'satisfied', rating: 3}]], {status: 'closed', closedAt: T(12, 5), severity: 'high'});
  await complaint('C', 'f3', 'cs1', [[T(7, 5), 'cs1', 'register'], [T(7, 11), 'csm', 'forward'], [T(9, 5), 'rep', 'resolve']], {status: 'resolved', resolvedAt: T(9, 5), resolution: {outcome: 'solved', note: 'تم الحل', by: 'rep', at: T(9, 5)}});
  await complaint('G', 'f1', 'cs2', [[T(8, 5), 'cs2', 'register'], [T(8, 6), 'csm', 'forward'], [T(9, 5), 'rep', 'resolve'], [T(9, 7), 'cs2', 'close', {outcome: 'satisfied', rating: 5}]], {registrarId: 'cs2', status: 'closed', closedAt: T(9, 7)});
  const hoursAgo = hours => new Date(Date.now() - hours * 3600000).toISOString();
  await complaint('live', 'f2', 'cs1', [[hoursAgo(30), 'cs1', 'register'], [hoursAgo(29), 'csm', 'forward', {targetId: 'sm'}], [hoursAgo(28), 'sm', 'assign', {targetId: 'rep'}], [hoursAgo(1), 'rep', 'resolve', {outcome: 'solved'}]], {status: 'resolved', resolvedAt: hoursAgo(1), resolution: {outcome: 'solved', note: 'استُبدل القالب وجُرّب أمام العميل', by: 'rep', at: hoursAgo(1)}});
  const support = async (id, handler, requestedAt, result, origin = 'rep', customerId = 'f1') => {
    const data = {kind: 'support', customerId, origin, status: result ? 'done' : 'open', requestedBy: 'rep', requestedAt, repId: 'rep', note: 'يحتاج متابعة', channel: 'any', handlerId: handler, handlerAt: requestedAt, handlerBy: 'x', ...(result ? {result: {outcome: 'reached_interested', note: 'تم التواصل', nextDate: '', by: handler, at: result}} : {})};
    await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'support',NULL,?,'الرئيسي',?,?,?,1,'fixture')").bind('support-' + id, handler, JSON.stringify(data), requestedAt, result || requestedAt).run();
  };
  await support('S1', 'cs1', T(6, 5), T(6, 7)); await support('S2', 'cs1', T(7, 5), T(7, 12), 'rep', 'f2'); await support('M1', 'cs1', T(9, 5), T(9, 7), 'missed_visit', 'f3'); await support('S4', 'cs2', T(29, 5), '', 'rep', 'f2');
  const audit = async (id, repId, total, note) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'service_audit',NULL,'csm','الرئيسي',?,?,?,1,'fixture')")
    .bind('service-audit-' + id, JSON.stringify({kind: 'service_audit', repId, month: SEPT, date: '', reference: {type: '', id: ''}, scores: {greeting: 8, understanding: 12, accuracy: 18, ownership: 12, communication: 12, resolution: 12, closing: 8}, total, result: total >= 90 ? 'pass' : total >= 80 ? 'coach' : 'fail', verification: {called: false, rating: null}, note, auditorId: 'csm', at: T(20, 6)}), T(20, 6), T(20, 6)).run();
  await audit('AU1', 'cs1', 88, 'لم يؤكد الموعد مع العميل'); await audit('AU2', 'cs2', 94, 'أداء ممتاز');
  const settings = {...(await (async () => (await api('owner', SEPT)).settings)())};
  for (const part of [settings.rep, settings.manager]) for (const key of Object.keys(part)) part[key].min = 1;
  settings.manager.backlog.min = 0; settings.closeGraceDays = 0;
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('service-kpi-settings','service_kpi_settings',NULL,'owner','الرئيسي',?,?,?,1,'fixture')").bind(JSON.stringify(settings), stamp, stamp).run();
  const month = (await api('owner', SEPT)).months[0];

  // ---- 1. A representative closes a complaint with the customer's rating and finds it in "My evaluation"
  const cs = await open('cs1');
  {
    await cs.locator('button.nav-item', {hasText: 'الشكاوى'}).waitFor();
    check(await cs.locator('button.nav-item').allInnerTexts().then(texts => texts.map(text => text.split('\n')[0].trim())), ['الزيارات', 'الشكاوى'], 'a representative has the Visits and Complaints pages, and no evaluation page');
    await goDesktop(cs, 'الشكاوى');
    const mine = cs.locator('details.service-kpi-mine');
    check([await mine.count(), await mine.locator('.sk-card').count()], [1, 0], '"My evaluation" is there, folded and unloaded');
    await cs.locator('.complaint-card[data-complaint="complaint-live"]').getByRole('button', {name: 'تأكيد الإغلاق', exact: true}).click();
    const sheet = cs.locator('.complaint-sheet');
    await sheet.waitFor();
    const close = sheet.locator('.complaint-close');
    await close.locator('select').selectOption('unreachable');
    check(await close.locator('.complaint-rating').count(), 0, 'no rating is asked when the customer could not be reached');
    await close.locator('select').selectOption('satisfied');
    const rating = close.locator('.complaint-rating');
    await rating.waitFor();
    check(await rating.locator('.complaint-rating-button').allInnerTexts(), ['1', '2', '3', '4', '5'], 'a satisfied customer can be given a rating from 1 to 5');
    await rating.locator('.complaint-rating-button', {hasText: '4'}).click();
    check(await rating.locator('.complaint-rating-button[aria-pressed=true]').allInnerTexts(), ['4'], 'the 4 is chosen');
    await rating.locator('.complaint-rating-button', {hasText: '4'}).click();
    check(await rating.locator('.complaint-rating-button[aria-pressed=true]').count(), 0, 'pressing it again takes it back: the rating is optional');
    await rating.locator('.complaint-rating-button', {hasText: '4'}).click();
    await close.locator('textarea').fill('أكد العميل أن القالب يعمل');
    await shot(cs, 'service-kpi-closure-rating');
    await close.getByRole('button', {name: 'إغلاق الشكوى', exact: true}).click();
    const closed = await eventually(async () => { const found = (await rowsOf('complaint')).find(row => row.id === 'complaint-live'); return found.data.status === 'closed' ? found : null; }, 'closed');
    check([closed.data.closure.rating, closed.data.closure.outcome, closed.data.events.at(-1).action, closed.data.events.at(-1).rating, closed.data.events.at(-1).by], [4, 'satisfied', 'close', 4, 'cs1'], 'the rating is kept with the closure and with its event');
    await sheet.getByText('تقييم العميل 4/5').first().waitFor();
    checks++;
    await cs.keyboard.press('Escape');
    await sheet.waitFor({state: 'detached'});

    await mine.locator('summary').click();
    const nowCard = mine.locator('.sk-card');
    await nowCard.waitFor();
    check(await mine.locator('.sk-month select').inputValue(), month, 'it opens on the current month');
    check((await nowCard.locator('.sk-name').innerText()).includes('ريم ممثلة الخدمة'), true, 'her own card');
    await nowCard.locator('tr[data-figure="customer_rating"]').waitFor();
    check((await nowCard.locator('tr[data-figure="customer_rating"] .sk-value').innerText()).trim(), '4.0 / 5', 'her rating this month is the 4 she just entered');
    check(await mine.locator('.sk-card').count(), 1, 'and no one else\'s card');
    await mine.locator('.sk-month select').selectOption(SEPT);
    await eventually(async () => (await mine.locator('.sk-card .sk-score').innerText()).trim() === String((scoreOf(await api('cs1', SEPT), 'cs1')).toFixed(1)), 'September\'s score is the route\'s');
    await mine.locator('tr[data-figure="closure_timing"] .sk-toggle').click();
    const items = mine.locator('.sk-items[data-figure="closure_timing"] li');
    check(await items.count(), 3, 'a figure opens onto its cases: A\'s closure, B\'s send-back and B\'s closure');
    ok((await items.first().innerText()).includes(NAMES[0]), 'with the customer\'s name');
    check(await mine.locator('.sk-audit-list li').count(), 1, 'her one audit of September is listed');
    ok((await mine.locator('.sk-audit-list li').innerText()).includes('لم يؤكد الموعد مع العميل'), 'with the manager\'s note');
    check(await mine.getByRole('button', {name: 'حذف التدقيق'}).count(), 0, 'and no way to delete it');
    await layoutOk(cs, 'representative: my evaluation'); await shot(cs, 'service-kpi-mine');
    await cs.context().close();
  }

  // ---- 2. The customer-service manager opens the page, a card, a figure's cases, and records a quality audit from the sample
  const csm = await open('csm');
  let auditId;
  {
    await csm.locator('button.nav-item', {hasText: 'تقييم خدمة العملاء'}).waitFor();
    check(await csm.locator('button.nav-item').allInnerTexts().then(texts => texts.map(text => text.split('\n')[0].trim())), ['الزيارات', 'الشكاوى', 'تقييم خدمة العملاء'], 'the manager has the evaluation page beside Complaints');
    await goDesktop(csm, 'تقييم خدمة العملاء');
    const pageRoot = csm.locator('.service-kpi-page');
    await pageRoot.waitFor();
    await csm.locator('.sk-month select').selectOption(SEPT);
    const group = pageRoot.locator('.sk-group[data-group="csm"]');
    await group.waitFor();
    await eventually(async () => await group.locator('.sk-card').count() === 3, 'his card and his two representatives');
    check(await group.locator('.sk-group-head h3').innerText(), 'فريق منى مديرة الخدمة', 'the group is his team');
    check(await pageRoot.locator('.sk-group').count(), 1, 'and no other');
    check(await group.locator('.sk-card[data-role=manager] .sk-name').innerText().then(text => text.includes('بطاقة المدير')), true, 'his own card is labelled');
    const answer = await api('csm', SEPT);
    for (const id of ['cs1', 'cs2']) check((await group.locator('.sk-card[data-member="' + id + '"] .sk-score').innerText()).trim(), scoreOf(answer, id).toFixed(1), id + '\'s score on the page is the route\'s');
    check((await group.locator('.sk-card[data-role=manager] .sk-score').innerText()).trim(), scoreOf(answer, 'csm').toFixed(1), 'and his own');
    ok(await group.locator('.sk-compare').isVisible(), 'the two representatives are compared side by side');
    await group.locator('.sk-card[data-member="cs1"] .sk-card-head').click();
    const table = group.locator('.sk-card[data-member="cs1"] .sk-table');
    await table.waitFor();
    check(await table.locator('tbody tr.sk-row').count(), 8, 'cs1\'s card opens onto her eight figures');
    await table.locator('tr[data-figure="support_response"] .sk-toggle').click();
    await eventually(async () => await group.locator('.sk-items[data-figure="support_response"] li').count() === 2, 'the cases arrive');
    ok((await group.locator('.sk-items[data-figure="support_response"]').innerText()).includes(NAMES[0]), 'with the customers\' names');
    await layoutOk(csm, 'manager: evaluation page'); await shot(csm, 'service-kpi-manager-page');

    // the suggested sample, and an audit from it
    const sample = pageRoot.locator('.sk-sample-rep').filter({hasText: 'ريم ممثلة الخدمة'});
    await sample.waitFor();
    check(await sample.locator('li').count(), 3, 'three cases are suggested for her');
    const suggested = await sample.locator('li').first().getAttribute('data-sample');
    await sample.locator('li').first().getByRole('button', {name: 'تدقيق', exact: true}).click();
    const dialog = csm.locator('.sk-dialog');
    await dialog.waitFor();
    check(await dialog.locator('select').first().inputValue(), 'cs1', 'the representative is chosen');
    ok((await dialog.locator('select').nth(1).inputValue()).length > 0, 'and so is the case');
    const save = dialog.getByRole('button', {name: 'حفظ التدقيق', exact: true});
    check(await save.isDisabled(), true, 'nothing is saved before every mark is given');
    const inputs = dialog.locator('.sk-criteria input');
    check(await inputs.count(), 7, 'seven criteria');
    await inputs.first().fill('99');
    for (let index = 1; index < 7; index++) await inputs.nth(index).fill('1');
    check(await save.isDisabled(), true, 'a mark above its criterion\'s maximum keeps saving shut');
    const marks = [8, 12, 16, 12, 12, 12, 8];
    for (let index = 0; index < 7; index++) await inputs.nth(index).fill(String(marks[index]));
    ok((await dialog.locator('.sk-total').innerText()).includes('80'), 'the total follows: 80');
    ok((await dialog.locator('.sk-total .sk-chip').innerText()).includes('يحتاج تدريبًا'), 'with its verdict');
    await dialog.locator('.sk-check input').check();
    await dialog.locator('select').last().selectOption('4');
    await dialog.locator('textarea').fill('ينقصه تأكيد الموعد كتابةً');
    await shot(csm, 'service-kpi-audit-dialog');
    check(await save.isDisabled(), false, 'then it is open');
    await save.click();
    await dialog.waitFor({state: 'detached'});
    const stored = await eventually(async () => (await rowsOf('service_audit')).find(row => row.data.note === 'ينقصه تأكيد الموعد كتابةً'), 'the audit is stored');
    auditId = stored.id;
    check([stored.data.repId, stored.data.month, stored.data.total, stored.data.result, stored.data.auditorId, stored.data.verification, stored.data.reference.type.length > 0], ['cs1', SEPT, 80, 'coach', 'csm', {called: true, rating: 4}, true], 'it is stored with its verdict, its month, the call and its case');
    const entry = pageRoot.locator('.sk-audit-list li[data-audit="' + auditId + '"]');
    await entry.waitFor();
    ok((await entry.innerText()).includes('80/100') && (await entry.innerText()).includes('يحتاج تدريبًا') && (await entry.innerText()).includes('★ 4'), 'it is listed with its total, verdict and the customer\'s rating');
    await eventually(async () => (await sample.locator('li[data-sample="' + suggested + '"]').count()) === 0, 'the case audited leaves the sample');
    check(await sample.locator('li').count(), 3, 'and another takes its place');
    const afterAudit = await api('csm', SEPT);
    check((await group.locator('.sk-card[data-member="cs1"] .sk-score').innerText()).trim(), scoreOf(afterAudit, 'cs1').toFixed(1), 'cs1\'s score on the page follows the audit');
    ok(scoreOf(afterAudit, 'cs1') !== scoreOf(answer, 'cs1'), 'and it has moved');
    // deleting it
    await entry.getByRole('button', {name: 'حذف التدقيق'}).click();
    await eventually(async () => (await rowsOf('service_audit')).find(row => row.id === auditId).data.deleted?.by === 'csm', 'the audit is marked deleted');
    await eventually(async () => await pageRoot.locator('.sk-audit-list li[data-audit="' + auditId + '"]').count() === 0, 'and leaves the list');
    check((await group.locator('.sk-card[data-member="cs1"] .sk-score').innerText()).trim(), scoreOf(answer, 'cs1').toFixed(1), 'the score goes back');
    await layoutOk(csm, 'manager: after the audit');
  }

  // ---- 3. The administrator changes the weights, is stopped by a total that is not 100, closes a team's month and reopens it
  const owner = await open('owner');
  {
    await goDesktop(owner, 'تقييم خدمة العملاء');
    await owner.locator('.sk-month select').selectOption(SEPT);
    const group = owner.locator('.sk-group[data-group="csm"]');
    await group.waitFor();
    check(await owner.getByRole('button', {name: 'إعدادات التقييم'}).count(), 1, 'the administrator has the settings button');
    const before = await api('owner', SEPT);
    await owner.getByRole('button', {name: 'إعدادات التقييم'}).click();
    const dialog = owner.locator('.sk-settings');
    await dialog.waitFor();
    const sums = dialog.locator('.sk-settings-table .sk-sum');
    check(await sums.allInnerTexts().then(texts => texts.map(text => text.replace(/\s+/g, ' ').trim())), ['مجموع الأوزان 100 / 100', 'مجموع الأوزان 100 / 100'], 'both cards\' weights add up to 100');
    const weight = name => dialog.getByLabel(name + ' · الوزن', {exact: true});
    await weight('تقييم العميل').fill('5');
    ok((await dialog.locator('.form-error').innerText()).includes('95'), 'a total of 95 is refused, saying so');
    check(await dialog.getByRole('button', {name: 'حفظ الإعدادات', exact: true}).isDisabled(), true, 'and saving is shut');
    await weight('جودة الأداء').fill('20');
    check([await dialog.locator('.form-error').count(), await dialog.getByRole('button', {name: 'حفظ الإعدادات', exact: true}).isDisabled()], [0, false], 'back to 100: the error goes and saving opens');
    await shot(owner, 'service-kpi-settings');
    await dialog.getByRole('button', {name: 'حفظ الإعدادات', exact: true}).click();
    await dialog.waitFor({state: 'detached'});
    const saved = (await rowsOf('service_kpi_settings'))[0];
    check([saved.version, saved.data.rep.customer_rating.weight, saved.data.rep.audit_quality.weight], [2, 5, 20], 'saved as the new version');
    const after = await api('owner', SEPT);
    ok(scoreOf(after, 'cs1') !== scoreOf(before, 'cs1'), 'and cs1\'s score moved with the weights');
    await eventually(async () => (await group.locator('.sk-card[data-member="cs1"] .sk-score').innerText()).trim() === scoreOf(after, 'cs1').toFixed(1), 'the page shows the new score');
    check(await owner.locator('.sk-group').count() >= 1, true, 'the administrator sees every group');

    // closing a team's month
    await group.getByRole('button', {name: 'إقفال الشهر'}).click();
    const confirm = group.locator('.sk-confirm');
    await confirm.waitFor();
    await shot(owner, 'service-kpi-close-confirm');
    await confirm.getByRole('button', {name: 'تأكيد', exact: true}).click();
    await group.locator('.sk-chip[data-kind=closed]').waitFor();
    const certificate = (await rowsOf('service_kpi_month')).find(row => row.id === 'service-kpi-month-csm-' + SEPT);
    check([certificate.data.managerId, certificate.data.closedBy, certificate.data.team.sort(), certificate.data.settings.rep.customer_rating.weight], ['csm', 'owner', ['cs1', 'cs2'], 5], 'the certificate names the team, who closed it and the settings used');
    check(certificate.data.scores.cs1, scoreOf(after, 'cs1'), 'with the score reached');
    check([await group.getByRole('button', {name: 'إقفال الشهر'}).count(), await group.getByRole('button', {name: 'إعادة فتح الشهر'}).count()], [0, 1], 'the group can be reopened, not closed again');
    await shot(owner, 'service-kpi-closed');

    // the manager meets the closed month
    await csm.reload();
    await csm.locator('.sk-month select').selectOption(SEPT);
    const lead = csm.locator('.sk-group[data-group="csm"]');
    await lead.locator('.sk-chip[data-kind=closed]').waitFor();
    check([await lead.getByRole('button', {name: 'إقفال الشهر'}).count(), await lead.getByRole('button', {name: 'إعادة فتح الشهر'}).count(), await csm.locator('.sk-sample').count()], [0, 0, 0], 'a closed month has nothing for the manager to close or reopen, and no sample');
    await csm.getByRole('button', {name: 'تدقيق جديد'}).click();
    const closedDialog = csm.locator('.sk-dialog');
    await closedDialog.waitFor();
    check(await closedDialog.locator('select').first().locator('option').allInnerTexts().then(texts => texts.map(text => text.trim())), ['اختر'], 'and no representative of his to audit');
    await csm.keyboard.press('Escape');
    await closedDialog.waitFor({state: 'detached'});
    const refused = await app.as(await app.login('csm'))('/api/service-kpi', {method: 'POST', body: {requestId: crypto.randomUUID(), action: 'audit', repId: 'cs1', month: SEPT, scores: {greeting: 8, understanding: 12, accuracy: 16, ownership: 12, communication: 12, resolution: 12, closing: 8}}});
    check(refused.status, 409, 'the route refuses an audit for that month too');

    // reopening it
    await group.getByRole('button', {name: 'إعادة فتح الشهر'}).click();
    await group.locator('.sk-confirm').getByRole('button', {name: 'تأكيد', exact: true}).click();
    await eventually(async () => (await group.locator('.sk-chip[data-kind=closed]').count()) === 0, 'the closed mark goes');
    const reopened = (await rowsOf('service_kpi_month')).find(row => row.id === 'service-kpi-month-csm-' + SEPT);
    check([reopened.data.reopened.by, reopened.version], ['owner', 2], 'the certificate stays, marked reopened');
    await eventually(async () => await group.getByRole('button', {name: 'إقفال الشهر'}).count() === 1, 'and it can be closed again');
    await owner.context().close();
  }

  // ---- 4. The phone
  const phone = await open('csm', {viewport: PHONE});
  {
    await goPhone(phone, 'service-kpi');
    await phone.locator('.service-kpi-page').waitFor();
    await phone.locator('.sk-month select').selectOption(SEPT);
    await phone.locator('.sk-group .sk-card').first().waitFor();
    await layoutOk(phone, 'phone: evaluation page');
    await phone.locator('.sk-card[data-member="cs1"] .sk-card-head').click();
    await phone.locator('.sk-card[data-member="cs1"] .sk-table').waitFor();
    await layoutOk(phone, 'phone: a card open');
    await shot(phone, 'service-kpi-phone');
    await phone.context().close();
  }

  // ---- 5. English
  {
    await csm.reload();
    await csm.locator('.sk-month select').selectOption(SEPT);
    await csm.locator('.sk-group').first().waitFor();
    await csm.getByRole('button', {name: 'Switch to English', exact: true}).click();
    await csm.locator('html[lang=en]').waitFor();
    await csm.locator('.sk-group').first().waitFor();
    const text = await csm.locator('.service-kpi-page').innerText();
    ok(text.includes('Team of') && text.includes('Quality audits') && text.includes('Close the month'), 'the English page');
    check((await csm.locator('.page-heading h1').innerText()).trim(), 'Customer-service evaluation', 'with its title');
    check(/[؀-ۿ]/.test(text.replace(/منى مديرة الخدمة|ريم ممثلة الخدمة|هند ممثلة الخدمة|مصنع [؀-ۿ ]+|[؀-ۿ ]+(?=\n|$)/g, '')), false, 'without Arabic apart from the names and what was typed');
    await shot(csm, 'service-kpi-english');
    await csm.context().close();
  }

  check(errors, [], 'no page error was raised');
  console.log(JSON.stringify({ok: true, checks, screenshots, scope: 'the customer-service evaluation in real Chromium on the built release: the rating at a complaint\'s closure, my evaluation, the manager\'s page and cards and cases, a quality audit from the sample and its deletion, the administrator\'s weights and their total, closing and reopening a team\'s month, the phone and English layouts', productionDataUsed: false}));
} finally {
  await browser?.close();
  await app?.stop();
}
