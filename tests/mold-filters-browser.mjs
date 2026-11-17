// The filters of «طلبات القوالب» (the owner, 2026-11-17: «ضيف الفلاتر دى فى طلبات القوالب ماعدا المصدر لان المصدر عندك واحد») in a real
// Chromium against the BUILT release (run the build first), on eight made-up requests stored in a temporary SQLite (the production link
// off, so each keeps the status written here):
// - the administrator on a computer, in Arabic: «الحالة», «واقف عند», «المندوب», «من تاريخ», «إلى تاريخ» and «بحث» above the list, no
//   «المصدر»; the choices offered are those the list holds, in the card's words; each narrows the list; the days are Riyadh's (a request
//   asked for at 00:30 in Riyadh is that day's, not the UTC day before), both ends included, and a range typed the wrong way round is turned
//   round; the search finds by the customer's name without its hamza, the ERP code, the Yourrest code, the requester, the description, the
//   mold number and the order number in Arabic digits, and the serial; the filters together, and with «أعادتها المالية» (its text as
//   before: «أعادتها المالية 1»); «يظهر n من m» and «مسح الفلاتر» once one is set, which clears them all; «لا نتائج» when nothing is left;
// - the same in English, with no Arabic left in the panel, its choices or the cards' words (the customers' and requesters' names are data);
// - phones of 320 and 360 px (touch), a tablet upright and on its side, and a computer, in Arabic and in English: no page scrolls sideways,
//   every control of the panel is inside the screen, no card's customer name is squeezed beside its chip (a long English chip at 320 px
//   had left the name a letter a line), and a choice narrows the list there too; the page's own title in English («Mold requests»);
// - a representative on a phone: their own requests, no «المندوب» (one requester);
// - «طلبات بانتظار اعتمادي» is not touched (tests/mold-nov10-browser.mjs).
// Screenshots for the report. Synthetic fixtures only: temporary SQLite, no production data, no production app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';
import {MOLD_STAGES} from '../portable/mold-rules.mjs';

const require = createRequire(import.meta.url), {chromium} = require('playwright');
const members = [{id: 'owner', role: 'admin', name: 'Owner'}, {id: 'rep1', role: 'rep', region: 'eastern', name: 'أحمد العتيبي'}, {id: 'rep2', role: 'rep', region: 'eastern', name: 'خالد الشمري'}, {id: 'cs1', role: 'customer_service', name: 'سارة الحربي'}];
const screenshots = process.env.YR_MOLD_SCREENSHOT_DIR ? path.resolve(process.env.YR_MOLD_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-mold-filters-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ARABIC = /[\u0600-\u06ff]/;
const SIZES = {phone320: {width: 320, height: 720}, phone360: {width: 360, height: 800}, tabletUpright: {width: 768, height: 1024}, tabletSide: {width: 1024, height: 768}, desktop: {width: 1366, height: 900}};

const app = await bootBuiltApp({members}, {tls: true});
try {
  // ---- eight requests, each with what a card shows of it
  const now = new Date().toISOString();
  const stages = done => Object.fromEntries(MOLD_STAGES.map((key, index) => [key, {done: index < done, at: index < done ? '2026-11-1' + index + 'T09:00:00.000Z' : null}]));
  const remote = (id, extra) => ({crmRequestId: id, orderNo: null, requestRef: crypto.randomUUID(), status: 'received', editable: false, moldSerial: null, productionDate: null, stages: stages(0), stagesDone: 0, stagesTotal: 7, delivered: false, deliveryDate: null, updatedAt: now, revision: 1, waitingStep: 'sales', waitingSince: now, approvals: null, designFiles: [], ...extra});
  const names = Object.fromEntries(members.map(member => [member.id, member.name]));
  let created = 0;
  async function store(key, {member, customer, erpCode = '', crmNumber = 27, requestedAt, description = 'قالب بلوك 20 سم', moldNo = 'M-1', status = null, cancelled = false, outbox = null, extra = {}}) {
    const id = 'mr-' + crypto.randomUUID(), data = {requestedAt, customer: {crmNumber, name: customer, address: 'حي الصناعية', city: 'الدمام', ...(erpCode ? {erpCode} : {})}, salesman: {crmMemberId: member, name: names[member], email: member + '@yourrest.org'},
      specs: {description, core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo, quantity: 1, designUrl: '', notes: ''}, payment: 'cash', ...extra};
    const at = new Date(Date.parse('2026-11-01T00:00:00.000Z') + (++created) * 60_000).toISOString();
    await app.db.prepare('INSERT INTO crm_mold_requests(id,member_id,customer_id,data,accepted,cancelled_at,cancel_reason,outbox,next_attempt_at,remote,remote_at,created_by,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)')
      .bind(id, member, 'east1', JSON.stringify(data), status ? JSON.stringify(data) : null, cancelled ? now : null, cancelled ? 'خطأ في المقاس' : '', outbox, outbox ? now : null, status ? JSON.stringify(remote(id, status)) : null, status ? now : null, member, at, at).run();
    return [key, customer];
  }
  const R = Object.fromEntries([
    await store('design', {member: 'rep1', customer: 'مؤسسة الإبداع للبلوك', requestedAt: '2026-10-31T21:30:00.000Z', outbox: 'send', extra: {designRequired: true}}),
    await store('off', {member: 'rep1', customer: 'مصنع الشرق', requestedAt: '2026-11-05T09:00:00.000Z', outbox: 'send'}),
    await store('sales', {member: 'rep2', customer: 'مصنع الوادي', requestedAt: '2026-11-05T09:00:00.000Z', status: {waitingStep: 'sales'}}),
    await store('finance', {member: 'rep2', customer: 'مصنع النخيل', requestedAt: '2026-11-10T08:00:00.000Z', status: {waitingStep: 'admin', returned: {by: 'finance', name: 'finance@yourrest.org', reason: 'الحد الائتماني للعميل لا يسمح بالمبلغ', at: now, correctedAt: null}}}),
    await store('making', {member: 'rep1', customer: 'مصنع الجنوب', erpCode: 'ERP-7781', crmNumber: 114, requestedAt: '2026-11-12T12:00:00.000Z', description: '200*400*27.5TH MM OPEN', moldNo: 'YR-14', status: {status: 'in_production', waitingStep: 'manufacturing', orderNo: 117, moldSerial: '049 / 050', stages: stages(2), stagesDone: 2}}),
    await store('ready', {member: 'cs1', customer: 'مصنع الساحل', requestedAt: '2026-11-15T20:59:59.000Z', status: {status: 'produced', waitingStep: 'delivery', orderNo: 98, stages: stages(7), stagesDone: 7}}),
    await store('delivered', {member: 'rep2', customer: 'مصنع القمة', requestedAt: '2026-10-01T09:00:00.000Z', status: {status: 'delivered', waitingStep: 'done', delivered: true, deliveryDate: '2026-11-14', orderNo: 90, stages: stages(7), stagesDone: 7}}),
    await store('cancelled', {member: 'rep1', customer: 'مصنع الأفق', requestedAt: '2026-11-08T09:00:00.000Z', cancelled: true, outbox: 'cancel', status: {waitingStep: 'production'}}),
  ]);
  const customerOf = R;
  const {scope} = await app.db.prepare('SELECT region_scope AS scope FROM crm_members WHERE id=?').bind('rep1').first();

  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  async function open(memberId, {viewport = SIZES.desktop, language = 'ar', touch = false} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', ...(touch ? {hasTouch: true, isMobile: true} : {})});
    if (language === 'en') await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (memberId.startsWith('rep')) await installNativeBridge(page, {memberId, regionScope: scope});
    await page.goto(app.origin + '/');
    await page.locator('.workspace').waitFor();
    const more = page.locator('.mobile-bottom-navigation button[aria-haspopup="dialog"]');
    await page.locator('.mobile-bottom-navigation button[aria-haspopup="dialog"]:visible, button.nav-item:visible').first().waitFor();
    if (await more.isVisible()) { await more.click(); await page.locator('.mobile-overflow-pages button[data-page="mold-requests"]').click(); await page.locator('.mobile-navigation-sheet').waitFor({state: 'detached'}); }
    else await page.locator('button.nav-item', {hasText: /طلبات تصنيع القوالب|Mold requests/}).first().click();
    await page.locator('.mold-page .mold-filters').waitFor();
    await page.locator('.mold-card').first().waitFor();
    return page;
  }
  const shot = async (page, label) => { await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const panelShot = async (page, label) => { await page.locator('.mold-filters').scrollIntoViewIfNeeded(); await shot(page, label); };
  const noOverflow = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal overflow');
  const cards = async page => (await page.locator('.mold-card header strong').allInnerTexts()).sort();
  const expect = (...keys) => keys.map(key => customerOf[key]).sort();
  const panel = page => page.locator('.mold-filters');
  const select = (page, filter) => panel(page).locator(`[data-filter="${filter}"] select`);
  const input = (page, filter) => panel(page).locator(`[data-filter="${filter}"] input`);
  const options = async (page, filter) => (await select(page, filter).locator('option').allInnerTexts()).map(text => text.trim());
  const clear = page => panel(page).locator('.mold-filter-clear');
  const reset = async page => { if (await clear(page).count()) await clear(page).click(); await page.locator('.mold-filter-clear').waitFor({state: 'detached'}); };
  const insideScreen = page => page.evaluate(() => [...document.querySelectorAll('.mold-filters .mold-filter, .mold-filters button')].filter(element => element.getClientRects().length).map(element => { const box = element.getBoundingClientRect(); return {name: element.getAttribute('data-filter') || element.className, inside: box.left >= -0.5 && box.right <= innerWidth + 0.5 && box.width > 0}; }).filter(item => !item.inside).map(item => item.name));
  const ALL = Object.keys(R);

  // ---- 1. The administrator on a computer, Arabic
  const owner = await open('owner');
  check(await cards(owner), expect(...ALL), 'every request listed before any filter');
  check(await panel(owner).locator('.mold-filter > span:first-child').allInnerTexts(), ['الحالة', 'واقف عند', 'المندوب', 'من تاريخ', 'إلى تاريخ', 'بحث'], 'the owner\'s filters, «المصدر» left out');
  check([await panel(owner).getAttribute('aria-label'), await input(owner, 'query').getAttribute('placeholder'), await input(owner, 'query').getAttribute('type')], ['تصفية طلبات القوالب', 'عميل، مندوب، وصف، سريال، رقم أمر...', 'search'], 'the panel\'s name and the wide search');
  check(await options(owner, 'status'), ['كل الحالات', 'المفتوحة (لم تُسلَّم)', 'لم يصل للإنتاج بعد', 'بانتظار ملف التصميم', 'الربط مع الإنتاج غير مفعَّل', 'أعادتها المالية', 'استلمه الإنتاج', 'قيد التصنيع', 'تم التصنيع', 'تم التسليم للعميل', 'ملغى'], '«الحالة»: the statuses the list holds, in the card\'s words');
  check(await options(owner, 'step'), ['كل المراحل', 'بانتظار اعتماد مدير المبيعات', 'بانتظار اعتماد المالية', 'في التصنيع', 'في التصنيع · Core and Connector', 'بانتظار التسليم'], '«واقف عند»: the steps and the stage reached');
  check(await options(owner, 'member'), ['كل المندوبين', 'أحمد العتيبي', 'خالد الشمري', 'سارة الحربي'], '«المندوب»: every requester once, by name');
  check([await clear(owner).count(), await panel(owner).locator('.mold-filter-count').count(), await panel(owner).locator('.mold-returned-filter').innerText().then(text => text.replace(/\s+/g, ' ').trim())], [0, 0, 'أعادتها المالية 1'], 'nothing set: no «مسح الفلاتر»; «أعادتها المالية» as before');
  const chips = await owner.locator('.mold-card').evaluateAll(list => list.map(card => [card.querySelector('header strong').textContent, card.querySelector('.mold-chip').textContent, card.querySelector('.mold-card-sending')?.textContent || '']));
  check(Object.fromEntries(chips.map(([name, chip, line]) => [name, [chip, line]])), {
    [customerOf.design]: ['لم يصل للإنتاج بعد', 'بانتظار ملف التصميم'], [customerOf.off]: ['لم يصل للإنتاج بعد', 'الربط مع الإنتاج غير مفعَّل'], [customerOf.sales]: ['بانتظار اعتماد مدير المبيعات', ''], [customerOf.finance]: ['بانتظار اعتماد المالية', ''],
    [customerOf.making]: ['في التصنيع', ''], [customerOf.ready]: ['بانتظار التسليم', ''], [customerOf.delivered]: ['تم التسليم', ''], [customerOf.cancelled]: ['ملغى', 'الربط مع الإنتاج غير مفعَّل'],
  }, 'the cards say what the choices say');
  await noOverflow(owner, 'the computer, Arabic');
  await panelShot(owner, '01-desktop-ar-filters');

  const byStatus = {'المفتوحة (لم تُسلَّم)': expect('design', 'off', 'sales', 'finance', 'making', 'ready'), 'لم يصل للإنتاج بعد': expect('design', 'off'), 'بانتظار ملف التصميم': expect('design'), 'الربط مع الإنتاج غير مفعَّل': expect('off', 'cancelled'), 'أعادتها المالية': expect('finance'), 'استلمه الإنتاج': expect('sales', 'finance'), 'قيد التصنيع': expect('making'), 'تم التصنيع': expect('ready'), 'تم التسليم للعميل': expect('delivered'), 'ملغى': expect('cancelled')};
  for (const [label, expected] of Object.entries(byStatus)) { await select(owner, 'status').selectOption({label}); check(await cards(owner), expected, '«الحالة» ' + label); }
  check(await panel(owner).locator('.mold-filter-count').innerText(), 'يظهر 1 من 8', 'how many are shown');
  await clear(owner).click();
  check([await select(owner, 'status').inputValue(), await clear(owner).count(), (await cards(owner)).length], ['', 0, 8], '«مسح الفلاتر»: all again, and it goes');
  const byStep = {'بانتظار اعتماد مدير المبيعات': expect('sales'), 'بانتظار اعتماد المالية': expect('finance'), 'في التصنيع': expect('making'), 'في التصنيع · Core and Connector': expect('making'), 'بانتظار التسليم': expect('ready')};
  for (const [label, expected] of Object.entries(byStep)) { await select(owner, 'step').selectOption({label}); check(await cards(owner), expected, '«واقف عند» ' + label); }
  await reset(owner);
  for (const [label, expected] of Object.entries({'أحمد العتيبي': expect('design', 'off', 'making', 'cancelled'), 'خالد الشمري': expect('sales', 'finance', 'delivered'), 'سارة الحربي': expect('ready')})) { await select(owner, 'member').selectOption({label}); check(await cards(owner), expected, '«المندوب» ' + label); }
  await reset(owner);

  // The days: Riyadh's, both ends, turned round, one end only.
  const days = async (from, to) => { await input(owner, 'from').fill(from); await input(owner, 'to').fill(to); return cards(owner); };
  check(await days('2026-11-01', '2026-11-01'), expect('design'), 'one day: the request asked for at 00:30 in Riyadh (21:30 UTC the day before) is that day\'s');
  check(await days('2026-10-31', '2026-10-31'), [], 'and not the UTC day before');
  await owner.locator('.mold-empty', {hasText: 'لا نتائج'}).waitFor();
  check(await days('2026-11-05', '2026-11-12'), expect('off', 'sales', 'finance', 'making', 'cancelled'), 'both ends included');
  check([await days('2026-11-12', '2026-11-05'), await input(owner, 'from').inputValue()], [expect('off', 'sales', 'finance', 'making', 'cancelled'), '2026-11-12'], 'typed the wrong way round: turned round (the fields keep what was typed)');
  check(await days('2026-11-13', ''), expect('ready'), 'from a day only: 23:59:59 on the 15th in Riyadh is the 15th');
  check(await days('', '2026-10-31'), expect('delivered'), 'to a day only');
  await panelShot(owner, '02-desktop-ar-dates');
  await reset(owner);
  check([await input(owner, 'from').inputValue(), await input(owner, 'to').inputValue()], ['', ''], '«مسح الفلاتر» empties the days too');

  // «بحث»: every field.
  const search = async query => { await input(owner, 'query').fill(query); return cards(owner); };
  for (const [query, expected, what] of [['الابداع', expect('design'), 'the customer without its hamza'], ['erp-7781', expect('making'), 'the ERP code'], ['YR-C-000114', expect('making'), 'the Yourrest code'], ['الشمري', expect('sales', 'finance', 'delivered'), 'the requester'],
    ['27.5TH', expect('making'), 'the description'], ['YR-١٤', expect('making'), 'the mold number in Arabic digits'], ['050', expect('making'), 'the serial'], ['١١٧', expect('making'), 'the order number in Arabic digits'], ['الجنوب 117', expect('making'), 'words across fields'], ['لا يوجد شيء كهذا', [], 'nothing']]) check(await search(query), expected, '«بحث»: ' + what);
  await owner.locator('.mold-empty', {hasText: 'لا نتائج'}).waitFor();
  await reset(owner);

  // Together, and with «أعادتها المالية».
  await select(owner, 'member').selectOption({label: 'خالد الشمري'});
  await select(owner, 'status').selectOption({label: 'استلمه الإنتاج'});
  check(await cards(owner), expect('sales', 'finance'), 'requester AND status');
  await input(owner, 'query').fill('النخيل');
  check(await cards(owner), expect('finance'), 'AND words');
  await panel(owner).locator('.mold-returned-filter').click();
  check([await cards(owner), await panel(owner).locator('.mold-returned-filter').getAttribute('aria-pressed'), await panel(owner).locator('.mold-filter-count').innerText()], [expect('finance'), 'true', 'يظهر 1 من 8'], 'AND «أعادتها المالية»');
  await input(owner, 'from').fill('2026-11-11');
  check(await cards(owner), [], 'AND a day it was not asked for: nothing');
  await owner.locator('.mold-empty', {hasText: 'لا نتائج'}).waitFor();
  await panelShot(owner, '03-desktop-ar-combined-none');
  await clear(owner).click();
  check([await cards(owner), await panel(owner).locator('.mold-returned-filter').getAttribute('aria-pressed'), await select(owner, 'member').inputValue(), await input(owner, 'query').inputValue()], [expect(...ALL), 'false', '', ''], '«مسح الفلاتر» clears every filter, «أعادتها المالية» too');
  await panel(owner).locator('.mold-returned-filter').click();
  await select(owner, 'member').selectOption({label: 'أحمد العتيبي'});
  check(await cards(owner), [], '«أعادتها المالية» AND another requester: nothing');
  await reset(owner);

  // ---- 2. The same in English: no Arabic left in the panel, its choices or the cards' words
  const english = await open('owner', {language: 'en'});
  check(await panel(english).locator('.mold-filter > span:first-child').allInnerTexts(), ['Status', 'Waiting at', 'Sales rep', 'From date', 'To date', 'Search'], 'the labels in English');
  check(await options(english, 'status'), ['All statuses', 'Open (not delivered)', 'Not in production yet', 'Waiting for the design file', 'The production link is off', 'Returned by finance', 'Received by production', 'In production', 'Produced', 'Delivered', 'Cancelled'], 'the statuses in English');
  check(await options(english, 'step'), ['All stages', 'Waiting for the sales manager\'s approval', 'Waiting for finance approval', 'In manufacturing', 'In manufacturing · Core and Connector', 'Waiting for delivery'], 'the steps in English');
  check((await options(english, 'member'))[0], 'All sales reps', 'the requesters\' first choice in English (the names are data)');
  await select(english, 'step').selectOption({label: 'In manufacturing · Core and Connector'});
  await input(english, 'query').fill('١١٧');
  check(await cards(english), expect('making'), 'in English, the stage and the order number in Arabic digits');
  const words = await english.evaluate(() => {
    const panel = document.querySelector('.mold-filters');
    const member = panel.querySelector('[data-filter="member"] select');
    return [panel.getAttribute('aria-label'), panel.querySelector('[data-filter="query"] input').placeholder, ...[...panel.querySelectorAll('.mold-filter > span:first-child, .mold-filter-actions')].map(element => element.textContent),
      ...[...panel.querySelectorAll('select')].flatMap(element => [...element.options].filter(option => element !== member || option.value === '').map(option => option.textContent)),
      ...[...document.querySelectorAll('.mold-card .mold-chip, .mold-card .mold-card-sending, .mold-heading p, .mold-empty, .page-heading h1, .breadcrumb strong, .nav-item[data-active="true"]')].map(element => element.textContent)];
  });
  check(words.filter(text => ARABIC.test(text)), [], 'no Arabic left in English: ' + words.join(' | ').slice(0, 300));
  check([await english.locator('.page-heading h1').innerText(), await english.locator('.breadcrumb strong').innerText(), (await english.locator('.nav-item[data-active="true"]').innerText()).trim()], ['Mold requests', 'Mold requests', 'Mold requests'], 'the page\'s own title in English too (it was left in Arabic before)');
  check(await panel(english).locator('.mold-filter-actions').innerText().then(text => text.replace(/\s+/g, ' ').trim()), 'Returned by finance 1 Showing 1 of 8 Clear filters', '«Returned by finance», the count and «Clear filters»');
  await noOverflow(english, 'the computer, English');
  await panelShot(english, '04-desktop-en-filtered');
  await english.locator('.mold-filter-clear').click();
  check((await cards(english)).length, 8, 'English: cleared');
  await english.context().close();

  // ---- 3. Every size, Arabic and English: nothing off the screen, and a choice narrows the list
  for (const [size, viewport] of Object.entries(SIZES)) for (const language of ['ar', 'en']) {
    const touch = size !== 'desktop';
    const page = await open('owner', {viewport, language, touch});
    const label = size + ' ' + language;
    await noOverflow(page, label);
    check(await insideScreen(page), [], label + ': every control of the panel inside the screen');
    check(await page.evaluate(() => [...document.querySelectorAll('.mold-card header strong')].filter(name => name.getBoundingClientRect().width < 100).map(name => name.textContent)), [], label + ': no customer\'s name squeezed beside its chip');
    check(await panel(page).locator('.mold-filter').count(), 6, label + ': the six filters');
    await select(page, 'status').selectOption('status:in_production');
    await input(page, 'query').fill('YR-١٤');
    check(await cards(page), expect('making'), label + ': a status and a search narrow the list');
    if (touch) await clear(page).tap(); else await clear(page).click();
    await page.locator('.mold-filter-clear').waitFor({state: 'detached'});
    check((await cards(page)).length, 8, label + ': «مسح الفلاتر» by ' + (touch ? 'a tap' : 'a click'));
    await input(page, 'from').fill('2026-11-05');
    await input(page, 'to').fill('2026-11-01');
    check(await cards(page), expect('design', 'off', 'sales'), label + ': the days turned round');
    await noOverflow(page, label + ' with filters set');
    check(await insideScreen(page), [], label + ': still inside the screen with «مسح الفلاتر» and the count');
    if (language === 'en') check((await page.locator('.mold-filters').innerText()).split('\n').filter(text => ARABIC.test(text) && !members.some(member => text.includes(member.name))), [], label + ': no Arabic in the panel');
    await panelShot(page, '05-' + size + '-' + language);
    await page.context().close();
  }

  // ---- 4. A representative on a phone: their own requests, no «المندوب»
  const rep = await open('rep1', {viewport: SIZES.phone360, touch: true});
  check(await cards(rep), expect('design', 'off', 'making', 'cancelled'), 'the representative\'s own requests');
  check([await panel(rep).locator('[data-filter="member"]').count(), await panel(rep).locator('.mold-filter').count()], [0, 5], 'one requester: no «المندوب»');
  check(await options(rep, 'status'), ['كل الحالات', 'المفتوحة (لم تُسلَّم)', 'لم يصل للإنتاج بعد', 'بانتظار ملف التصميم', 'الربط مع الإنتاج غير مفعَّل', 'قيد التصنيع', 'ملغى'], 'their statuses only');
  await select(rep, 'step').selectOption({label: 'في التصنيع'});
  check(await cards(rep), expect('making'), 'a step narrows their list');
  await noOverflow(rep, 'the representative at 360 px');
  await panelShot(rep, '06-rep-phone360-ar');
  await rep.context().close();

  check(errors, [], 'no page errors');
  console.log(JSON.stringify({ok: true, checks, screenshots, builtRelease: true, productionDataUsed: false}));
} finally {
  await browser?.close(); await app.stop();
}
