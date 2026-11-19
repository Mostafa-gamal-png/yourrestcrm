// The requests that exist only in the products application (the owner, 2026-11-19: «كل الطلبات» shows them, read-only, so the filters
// count them) in a real Chromium against the BUILT release (run the build first), with the stand-in production API serving `orders`:
// - the administrator on a computer, in Arabic: the CRM's requests and the products application's in one list by the day asked for; each
//   order's card marked «مسجّل في تطبيق المنتجات · للعرض فقط» or «من الشيت القديم · للعرض فقط», with production's chip, order number,
//   stages and salesman; «المصدر» among the filters («الـCRM»، «تطبيق المنتجات»، «الشيت القديم») and each source narrowing the list;
//   «الحالة», «واقف عند», «المندوب» (production's salesman by name), the days and «بحث» counting the orders; «يظهر n من m»;
//   the read-only sheet (where it came from, the stages, the facts, the specifications as production holds them, the files with their
//   links) opened without asking the server for it, no action button, its file downloaded through the CRM;
// - the same in English, with no Arabic left in the orders' words (the names are data);
// - phones of 320 and 360 px (touch), a tablet upright and on its side, and a computer, in Arabic and English: no page scrolls sideways,
//   no card's mark off the screen, the sheet of an order within the screen, a source chosen by touch;
// - the sales manager: «طلبات بانتظار اعتمادي» unchanged, «كل الطلبات» with his team's orders, and an order waiting for him says to
//   approve it from there;
// - a representative on a phone: his own order among his requests, never another's.
// Screenshots for the report. Synthetic fixtures only: temporary SQLite, the stand-in production, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';
import {MOLD_STAGES} from '../portable/mold-rules.mjs';

const require = createRequire(import.meta.url), {chromium} = require('playwright');
const members = [{id: 'owner', role: 'admin', name: 'Owner'}, {id: 'sm', role: 'manager', region: 'eastern', name: 'مدير الشرقية'}, {id: 'rep1', role: 'rep', sup: 'sm', region: 'eastern', name: 'أحمد العتيبي'}, {id: 'rep2', role: 'rep', sup: 'sm', region: 'eastern', name: 'خالد الشمري'}];
const screenshots = process.env.YR_MOLD_SCREENSHOT_DIR ? path.resolve(process.env.YR_MOLD_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-mold-orders-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const ARABIC = /[؀-ۿ]/;
const SIZES = {phone320: {width: 320, height: 720}, phone360: {width: 360, height: 800}, tabletUpright: {width: 768, height: 1024}, tabletSide: {width: 1024, height: 768}, desktop: {width: 1366, height: 900}};

const mock = await startProductsMock({requestRefs: true, quotePo: true, orders: true});
const app = await bootBuiltApp({members}, {tls: true, env: {YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret, NODE_EXTRA_CA_CERTS: mock.ca}});
try {
  const now = new Date().toISOString();
  const addCustomer = async (id, assignedTo, code) => {
    await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
      .bind(id, assignedTo, JSON.stringify({name: 'مصنع ' + id, region: 'الشرقية', city: 'الدمام', address: 'حي الصناعية', phone: '0551234567', code, branch: 'الرئيسي', assignedTo}), now, now).run();
    return (await app.db.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').bind(id).first()).number;
  };
  const east1 = await addCustomer('east1', 'rep1', 'ERP-501'), east2 = await addCustomer('east2', 'rep2', 'ERP-502');
  // ---- two of the CRM's own requests (kept in the CRM: nothing is sent)
  const names = Object.fromEntries(members.map(member => [member.id, member.name]));
  const stages = done => Object.fromEntries(MOLD_STAGES.map((key, index) => [key, {done: index < done, at: index < done ? '2026-11-1' + index + 'T09:00:00.000Z' : null}]));
  async function crm(key, member, customerId, crmNumber, customer, requestedAt, remote = null) {
    const id = 'mr-' + crypto.randomUUID(), data = {requestedAt, customer: {crmNumber, name: customer, address: 'حي الصناعية', city: 'Damam - الدمام'}, salesman: {crmMemberId: member, name: names[member], email: member + '@yourrest.org'},
      specs: {description: 'قالب بلوك 20 سم', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: 'M-' + key, quantity: 1, designUrl: '', notes: ''}, payment: 'cash'};
    const status = remote ? {crmRequestId: id, orderNo: null, requestRef: crypto.randomUUID(), status: 'received', editable: true, moldSerial: null, productionDate: null, stages: stages(0), stagesDone: 0, stagesTotal: 7, delivered: false, deliveryDate: null, updatedAt: now, revision: 1, waitingStep: 'sales', waitingSince: now, approvals: {required: true, sales: null, production: null, admin: null}, designFiles: [], ...remote} : null;
    await app.db.prepare('INSERT INTO crm_mold_requests(id,member_id,customer_id,data,accepted,remote,remote_at,created_by,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,1)')
      .bind(id, member, customerId, JSON.stringify(data), status ? JSON.stringify(data) : null, status ? JSON.stringify(status) : null, status ? now : null, member, requestedAt, requestedAt).run();
    return [key, customer];
  }
  // ---- the products application's own: registered there, and from the old workbook
  const order = (key, customerName, options) => { const row = mock.registerManual({customerName, ...options}); return [key, customerName, row]; };
  const O = [
    order('making', 'مصنع الإنتاج المباشر', {salesmanId: 'rep1', salesmanName: 'أحمد العتيبي', customerNo: east1, customerErpCode: 'ERP-501', requestedAt: '2026-11-10T09:00:00.000Z', description: 'قالب إنتاج مباشر', moldNo: 'P-77', quantity: 3, payment: 'deferred', customerAddress: 'المنطقة الصناعية الثانية'}),
    order('waiting', 'مصنع بانتظار المدير', {salesmanId: 'rep1', customerNo: east1, requestedAt: '2026-11-03T09:00:00.000Z', description: 'قالب بانتظار الاعتماد'}),
    order('cancelled', 'مصنع ملغى في الإنتاج', {salesmanId: 'rep2', customerNo: east2, requestedAt: '2026-11-12T09:00:00.000Z', description: 'قالب ملغى'}),
  ];
  mock.registerLegacy({customerName: 'مصنع الشيت القديم', customerErpCode: 'OLD-1', salesmanName: 'مندوب قديم', requestedAt: '2026-10-20T06:00:00.000Z', description: 'قالب من الشيت', moldSerial: 'YR-SHEET-07'});
  const [, , making] = O[0];
  making.paymentTerms = 'advance_credit_limit';
  for (const step of ['sales', 'production', 'admin']) mock.approve(making.requestRef, step);
  Object.assign(making, {moldSerial: '049 / 050', stages: {...making.stages, laserCutting: {done: true, at: '2026-11-11'}, box: {done: true, at: '2026-11-12'}}});
  mock.cancelHere(O[2][2].requestRef);
  const file = mock.addProductionFile(making.requestRef, {name: 'تصميم الإنتاج المباشر.pdf', bytes: Buffer.from('%PDF-1.4 production drawing of the order')});
  mock.addProductionFile(making.requestRef, {name: 'عرض سعر.pdf', bytes: Buffer.from('%PDF-1.4 quotation'), category: 'quote'});
  const R = Object.fromEntries([
    await crm('crmA', 'rep1', 'east1', east1, 'مصنع الشرق', '2026-11-05T09:00:00.000Z', {}),
    await crm('crmB', 'rep2', 'east2', east2, 'مصنع الوادي', '2026-11-14T09:00:00.000Z'),
    ...O.map(([key, name]) => [key, name]), ['legacy', 'مصنع الشيت القديم'],
  ]);
  const expect = (...keys) => keys.map(key => R[key]).sort();
  const {scope} = await app.db.prepare('SELECT region_scope AS scope FROM crm_members WHERE id=?').bind('rep1').first();

  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
  async function open(memberId, {viewport = SIZES.desktop, language = 'ar', touch = false, tab = 'all'} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', ...(touch ? {hasTouch: true, isMobile: true} : {})});
    if (language === 'en') await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    page.asked = [];
    page.on('request', request => { if (request.url().includes('/api/mold-requests')) page.asked.push(new URL(request.url()).search); });
    if (memberId.startsWith('rep')) await installNativeBridge(page, {memberId, regionScope: scope});
    await page.goto(app.origin + '/');
    await page.locator('.workspace').waitFor();
    const more = page.locator('.mobile-bottom-navigation button[aria-haspopup="dialog"]');
    await page.locator('.mobile-bottom-navigation button[aria-haspopup="dialog"]:visible, button.nav-item:visible').first().waitFor();
    if (await more.isVisible()) { await more.click(); await page.locator('.mobile-overflow-pages button[data-page="mold-requests"]').click(); await page.locator('.mobile-navigation-sheet').waitFor({state: 'detached'}); }
    else await page.locator('button.nav-item', {hasText: /طلبات تصنيع القوالب|Mold requests/}).first().click();
    if (tab === 'pending') { await page.locator('.mold-pending-list').waitFor(); return page; }
    if (await page.locator('.mold-tabs').count()) await page.locator('.mold-tabs [role="tab"]').nth(1).click();
    await page.locator('.mold-page .mold-filters').waitFor();
    await page.locator('.mold-order-card').first().waitFor();
    return page;
  }
  const shot = async (page, label) => { await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const noOverflow = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal overflow');
  const cards = async page => (await page.locator('.mold-card header strong').allInnerTexts()).sort();
  const orderCards = async page => (await page.locator('.mold-order-card header strong').allInnerTexts()).sort();
  const panel = page => page.locator('.mold-filters');
  const select = (page, filter) => panel(page).locator(`[data-filter="${filter}"] select`);
  const input = (page, filter) => panel(page).locator(`[data-filter="${filter}"] input`);
  const options = async (page, filter) => (await select(page, filter).locator('option').allInnerTexts()).map(text => text.trim());
  const clear = page => panel(page).locator('.mold-filter-clear');
  const reset = async page => { if (await clear(page).count()) await clear(page).click(); await page.locator('.mold-filter-clear').waitFor({state: 'detached'}); };
  const cardOf = (page, customer) => page.locator('.mold-card', {has: page.locator('header strong', {hasText: customer})});
  /** An order's sheet, once it has slid in (its opening animation done). */
  const sheetOf = async page => { const sheet = page.locator('.mold-order-sheet'); await sheet.waitFor(); await sheet.evaluate(element => Promise.all(element.getAnimations({subtree: true}).map(animation => animation.finished.catch(() => null)))); return sheet; };

  // ---- 1. The administrator on a computer, Arabic
  const owner = await open('owner');
  check(await cards(owner), expect('crmA', 'crmB', 'making', 'waiting', 'cancelled', 'legacy'), 'the CRM\'s two requests and the products application\'s four in one list');
  check(await owner.locator('.mold-card header strong').allInnerTexts(), [R.crmB, R.cancelled, R.making, R.crmA, R.waiting, R.legacy], 'by the day each was asked for, newest first');
  check(owner.asked.filter(query => query.startsWith('?refs=1')), ['?refs=1&orders=1'], 'the page asks for the orders with its list, once');
  check(await owner.locator('.mold-order-card').evaluateAll(list => list.map(card => [card.querySelector('header strong').textContent, card.querySelector('.mold-card-origin').textContent, card.querySelector('.mold-chip').textContent])),
    [[R.cancelled, 'مسجّل في تطبيق المنتجات · للعرض فقط', 'أُلغي في تطبيق الإنتاج'], [R.making, 'مسجّل في تطبيق المنتجات · للعرض فقط', 'في التصنيع'], [R.waiting, 'مسجّل في تطبيق المنتجات · للعرض فقط', 'بانتظار اعتماد مدير المبيعات'], [R.legacy, 'من الشيت القديم · للعرض فقط', 'تم التسليم']],
    'each order\'s card: where it came from, that it is read-only, and production\'s chip');
  const makingFacts = (await cardOf(owner, R.making).locator('.mold-card-facts').innerText()).replace(/\s+/g, ' ');
  ok(/رقم أمر الإنتاج: \d+/.test(makingFacts) && makingFacts.includes('المراحل: 2/7') && makingFacts.includes('المندوب: أحمد العتيبي') && makingFacts.includes('الكمية: 3') && makingFacts.includes('ملفات التصميم: 1') && makingFacts.includes('ملفات عرض السعر والـ PO: 1'), 'its order number, stages, salesman, quantity and files: ' + makingFacts);
  check(await panel(owner).locator('.mold-filter > span:first-child').allInnerTexts(), ['الحالة', 'واقف عند', 'المندوب', 'المصدر', 'من تاريخ', 'إلى تاريخ', 'بحث'], '«المصدر» among the filters, with more than one source');
  check(await options(owner, 'source'), ['كل المصادر', 'الـCRM', 'تطبيق المنتجات', 'الشيت القديم'], 'its three sources');
  for (const [label, expected] of [['الـCRM', expect('crmA', 'crmB')], ['تطبيق المنتجات', expect('making', 'waiting', 'cancelled')], ['الشيت القديم', expect('legacy')]]) {
    await select(owner, 'source').selectOption({label}); check(await cards(owner), expected, '«المصدر» ' + label);
  }
  check(await panel(owner).locator('.mold-filter-count').innerText(), 'يظهر 1 من 6', 'the count holds the orders');
  await reset(owner);
  check(await options(owner, 'member'), ['كل المندوبين', 'أحمد العتيبي', 'خالد الشمري', 'مندوب قديم'], '«المندوب»: the CRM\'s requesters and production\'s salesman the CRM does not know, by name');
  await select(owner, 'member').selectOption({label: 'أحمد العتيبي'});
  check(await cards(owner), expect('crmA', 'making', 'waiting'), 'a representative\'s requests and the orders production names him on');
  await select(owner, 'member').selectOption({label: 'مندوب قديم'});
  check(await cards(owner), expect('legacy'), 'production\'s salesman by name');
  await reset(owner);
  await select(owner, 'status').selectOption({label: 'أُلغي في تطبيق الإنتاج'});
  check(await cards(owner), expect('cancelled'), '«الحالة»: cancelled in production');
  await select(owner, 'status').selectOption({label: 'تم التسليم للعميل'});
  check(await cards(owner), expect('legacy'), '«الحالة»: delivered');
  await reset(owner);
  await select(owner, 'step').selectOption({label: 'في التصنيع · Core and Connector'});
  check(await cards(owner), expect('making'), '«واقف عند»: the stage reached');
  await reset(owner);
  await input(owner, 'from').fill('2026-11-10'); await input(owner, 'to').fill('2026-11-12');
  check([await cards(owner), await panel(owner).locator('.mold-filter-count').innerText()], [expect('making', 'cancelled'), 'يظهر 2 من 6'], 'the days count the orders (Riyadh\'s, both ends)');
  await input(owner, 'from').fill('2026-10-01'); await input(owner, 'to').fill('2026-10-31');
  check(await cards(owner), expect('legacy'), 'a month of the old workbook');
  await reset(owner);
  for (const [query, expected, what] of [['YR-SHEET', expect('legacy'), 'the serial'], ['OLD-1', expect('legacy'), 'the ERP code'], ['P-77', expect('making'), 'the mold number'], ['050', expect('making'), 'the serial\'s part']]) { await input(owner, 'query').fill(query); check(await cards(owner), expected, '«بحث»: ' + what); }
  await reset(owner);
  await shot(owner, '01-desktop-ar-list');
  // The read-only sheet, without asking the server for it.
  const askedBefore = owner.asked.length;
  await cardOf(owner, R.making).click();
  const sheet = await sheetOf(owner);
  check(owner.asked.length, askedBefore, 'the order\'s sheet opens without asking the server');
  check([await sheet.locator('h2, [data-slot="sheet-title"]').first().innerText(), (await sheet.locator('.mold-order-readonly').innerText()).trim()], [R.making, 'سُجّل هذا الطلب في تطبيق المنتجات مباشرة، ويظهر هنا للاطلاع فقط: تعديله وإلغاؤه وملفاته من تطبيق المنتجات.'], 'the customer, and that it is read-only, changed in the products application');
  const facts = Object.fromEntries(await sheet.locator('.mold-facts > div').evaluateAll(rows => rows.map(row => [row.querySelector('dt').textContent, row.querySelector('dd').textContent])));
  ok(/^\d+$/.test(facts['رقم أمر الإنتاج']) && facts['حالة الإنتاج'] === 'قيد التصنيع' && facts['السريال'] === '049 / 050' && facts['المندوب'] === 'أحمد العتيبي' && facts['كود العميل'] === 'ERP-501' && facts['عنوان التسليم'] === 'المنطقة الصناعية الثانية' && facts['رقم القالب'] === 'P-77' && facts['الكمية'] === '3' && facts['الدفع'] === 'آجل' && facts['التسليم'] === 'لم يُسلَّم' && facts['سجّله في الإنتاج'] === 'staff@yourrest.org', 'its facts and specifications: ' + JSON.stringify(facts));
  check([await sheet.locator('.mold-approvals li[data-done="true"]').count(), await sheet.locator('.mold-stages li[data-done="true"]').count(), await sheet.locator('.mold-waiting').innerText().then(text => text.includes('في التصنيع'))], [3, 2, true], 'its three approvals, its two stages, where it waits');
  check(await sheet.locator('.mold-actions button, .mold-design-delete, input[type="file"]').count(), 0, 'no action: no edit, cancel, attach, delete, resend or approve');
  check(await sheet.locator('.mold-design-file .mold-design-name').allInnerTexts(), ['تصميم الإنتاج المباشر.pdf', 'عرض سعر.pdf'], 'its design file and its quotation\'s file');
  const href = await sheet.locator('.mold-design-file a[href*="design-file"]').first().getAttribute('href');
  ok(href.includes('ref=' + making.requestRef) && href.includes('file=' + file.fileId), 'its file through the CRM by its reference: ' + href);
  const downloaded = await owner.evaluate(async url => { const res = await fetch(url); return [res.status, await res.text()]; }, href);
  check(downloaded, [200, '%PDF-1.4 production drawing of the order'], 'downloaded through the CRM');
  await noOverflow(owner, 'the order\'s sheet on a computer');
  await shot(owner, '02-desktop-ar-order-sheet');
  await owner.keyboard.press('Escape');
  await sheet.waitFor({state: 'detached'});
  await cardOf(owner, R.legacy).click();
  await owner.locator('.mold-order-sheet').waitFor();
  check([(await owner.locator('.mold-order-readonly').innerText()).trim(), await owner.locator('.mold-order-sheet .mold-approvals').count()], ['طلب قديم من شيت الإنتاج غير مرتبط بطلب في الـCRM، ويظهر هنا للاطلاع فقط.', 0], 'the legacy order: from the workbook, read-only, no approvals needed');
  await owner.keyboard.press('Escape');
  await owner.context().close();

  // ---- 2. English: no Arabic left in the orders' words
  const english = await open('owner', {language: 'en'});
  check(await options(english, 'source'), ['All sources', 'The CRM', 'The products application', 'The old workbook'], '«Source» in English');
  check(await english.locator('.mold-order-card .mold-card-origin').allInnerTexts(), ['Registered in the products application · view only', 'Registered in the products application · view only', 'Registered in the products application · view only', 'From the old workbook · view only'], 'the marks in English');
  await cardOf(english, R.making).click();
  await sheetOf(english);
  const words = await english.evaluate(() => [...document.querySelectorAll('.mold-order-card .mold-chip, .mold-order-card .mold-card-origin, .mold-order-card .mold-card-facts > span, .mold-order-sheet .mold-banner, .mold-order-sheet dt, .mold-order-sheet .mold-specs-note, .mold-order-sheet .mold-waiting strong, .mold-order-sheet .mold-approvals span, .mold-order-sheet .mold-design-title, .mold-filters [data-filter="source"]')]
    .map(element => element.cloneNode(true)).map(clone => { clone.querySelectorAll('b, bdi').forEach(data => data.remove()); return clone.textContent; }));
  check(words.filter(text => ARABIC.test(text)), [], 'no Arabic left in English (the names and values are data): ' + words.join(' | ').slice(0, 400));
  await shot(english, '03-desktop-en-order-sheet');
  await english.context().close();

  // ---- 3. Every size, Arabic and English
  for (const [size, viewport] of Object.entries(SIZES)) for (const language of ['ar', 'en']) {
    const touch = size !== 'desktop', label = size + ' ' + language;
    const page = await open('owner', {viewport, language, touch});
    await noOverflow(page, label);
    check(await page.evaluate(() => [...document.querySelectorAll('.mold-order-card .mold-card-origin, .mold-order-card .mold-chip')].filter(element => { const box = element.getBoundingClientRect(); return box.left < -0.5 || box.right > innerWidth + 0.5; }).length), 0, label + ': every order\'s mark and chip inside the screen');
    await select(page, 'source').selectOption('legacy');
    check(await cards(page), expect('legacy'), label + ': a source chosen');
    if (touch) await clear(page).tap(); else await clear(page).click();
    await page.locator('.mold-filter-clear').waitFor({state: 'detached'});
    const card = cardOf(page, R.making);
    if (touch) await card.tap(); else await card.click();
    const opened = await sheetOf(page);
    check(await opened.evaluate(element => element.scrollWidth > element.clientWidth + 1 || element.getBoundingClientRect().right > innerWidth + 0.5 || element.getBoundingClientRect().left < -0.5), false, label + ': the order\'s sheet within the screen');
    await noOverflow(page, label + ' with the sheet open');
    if (language === 'en') check((await opened.locator('.mold-order-readonly, dt').allInnerTexts()).filter(text => ARABIC.test(text)), [], label + ': the sheet\'s words in English');
    await shot(page, '04-' + size + '-' + language);
    await page.context().close();
  }

  // ---- 4. The sales manager: his waiting list unchanged, his team's orders in «كل الطلبات»
  const sm = await open('sm', {tab: 'pending'});
  const pendingNames = await sm.locator('.mold-pending header strong').allInnerTexts();
  ok(pendingNames.includes(R.waiting) && !pendingNames.includes(R.making), '«طلبات بانتظار اعتمادي»: the order waiting for him, as before (' + pendingNames.join('، ') + ')');
  await sm.locator('.mold-tabs [role="tab"]').nth(1).click();
  await sm.locator('.mold-order-card').first().waitFor();
  check(await cards(sm), expect('crmA', 'crmB', 'making', 'waiting', 'cancelled'), 'his list: his team\'s CRM requests and their orders; not the workbook\'s order of no customer he knows');
  await cardOf(sm, R.waiting).click();
  await sheetOf(sm);
  ok((await sm.locator('.mold-order-readonly').innerText()).includes('اعتماده من «طلبات بانتظار اعتمادي».'), 'an order waiting for him: approve it from «طلبات بانتظار اعتمادي»');
  check(await sm.locator('.mold-order-sheet button.btn.primary').count(), 0, 'no approve button in the order\'s sheet');
  await shot(sm, '05-sm-desktop-order-waiting');
  await sm.context().close();

  // ---- 5. A representative on a phone: his own order, never another's
  const rep = await open('rep1', {viewport: SIZES.phone360, touch: true});
  check(await cards(rep), expect('crmA', 'making', 'waiting'), 'the representative: his CRM request and the orders production names him on');
  check(await orderCards(rep), expect('making', 'waiting'), 'never another representative\'s order');
  check([await panel(rep).locator('[data-filter="member"]').count(), await options(rep, 'source')], [0, ['كل المصادر', 'الـCRM', 'تطبيق المنتجات']], 'one requester (no «المندوب»), two sources');
  await select(rep, 'source').selectOption({label: 'تطبيق المنتجات'});
  check(await cards(rep), expect('making', 'waiting'), 'a source chosen on the phone');
  await noOverflow(rep, 'the representative at 360 px');
  await shot(rep, '06-rep-phone360-ar');
  await rep.context().close();

  check(errors, [], 'no page errors');
  console.log(JSON.stringify({ok: true, checks, screenshots, builtRelease: true, productionDataUsed: false}));
} finally {
  await browser?.close(); await app.stop(); await mock.stop();
}
