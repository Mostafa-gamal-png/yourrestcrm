// «الطاقة الإنتاجية والاحتياج» on the customer's card and «موعد احتياج القوالب المتوقع» on a visit (lib/customer-capacity.ts, the owner,
// 2026-11-21: «الحجات دى تتشاف من بره فى كرت العميل … موعد احتياج القوالب المتوقع دى فى تفاصيل الزيارة») in a real Chromium against the BUILT
// release (run the build first). On «العملاء» at 320 and 360 px in the simulated Android app, a tablet upright and on its side and a desktop,
// in Arabic and in English: the five items on the card or the row without opening anything, each only when it has a value (the machines
// counted and grouped by type, an unknown type by its manufacturer, the sheet's «حسب الشيت» when none is registered, and on the desktop row
// not again beside the sheet's own column), nothing for a customer with none; nothing runs off the screen, no Arabic left in English but the
// data. The representative, on their own customer: the sheet's block, the form's section with its note, a change of the three alone saved
// directly (no request), «١٥» read as 15. On a new visit: the day under «تفاصيل البيع والأصناف», saved, then read on the visit's card. The
// manager's customers export (Excel) carries the six columns. Screenshots for the report. Synthetic fixtures only.
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
  {id: 'rep2', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب خالد'}
];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-capacity-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const SIZES = {'phone-320': {width: 320, height: 700}, 'phone-360': {width: 360, height: 800}, 'tablet-upright': {width: 768, height: 1024}, 'tablet-sideways': {width: 1024, height: 768}, desktop: {width: 1280, height: 900}};
const HERE = {latitude: 26.43, longitude: 50.03};
const HOPE = 'مصنع الأمل للبلوك', SHEET = 'مصنع الشيت', PLAIN = 'مصنع بلا بيانات';
const riyadhClock = () => new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date());
while (riyadhClock() >= '23:55') await new Promise(resolve => setTimeout(resolve, 20000));
const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date());
const later = new Date(Date.parse(today + 'T12:00:00Z') + 120 * 86_400_000).toISOString().slice(0, 10);

try {
  app = await bootBuiltApp({members}, {tls: true});
  const now = new Date().toISOString();
  const insert = (id, kind, parent, assigned, data) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,'الرئيسي',?,?,?,1,'fixture')").bind(id, kind, parent, assigned, JSON.stringify(data), now, now).run();
  const customer = (id, name, assigned, data = {}) => insert(id, 'customer', null, assigned, {name, branch: 'الرئيسي', assignedTo: assigned, region: 'الشرقية', city: 'الدمام', customerStatus: 'نشط', phone: '0551234567', contact: 'أبو فهد', location: '26.4300000, 50.0300000', latitude: HERE.latitude, longitude: HERE.longitude, code: 'ERP-' + id, ...data});
  const machine = (id, parent, data) => insert(id, 'factory', parent, 'rep', {name: 'خط ' + id, recordType: 'machine', machineBrand: 'Besser', modelCondition: 'new', ...data});
  await customer('c1', HOPE, 'rep', {machineCount: 9, machineTypes: 'خط ثابت', moldsInUse: 12, productionCapacity: '5000 بلكة يوميًا', annualDemand: '40 قالبًا'});
  await machine('m1', 'c1', {machineType: 'stationary', quantity: 2});
  await machine('m2', 'c1', {machineType: 'mobile'});
  await machine('m3', 'c1', {machineType: 'unknown', machineBrand: 'QGM', quantity: 3});
  await machine('c1:source-machines-v1', 'c1', {name: 'ماكينات الشيت', recordType: 'group', quantity: 9, machineType: 'unknown'});
  await customer('c2', SHEET, 'rep', {machineCount: 5, machineTypes: 'Besser'});
  await customer('c3', PLAIN, 'rep');
  const stored = async id => JSON.parse((await app.db.prepare('SELECT data FROM crm_records WHERE id=?').bind(id).first()).data);
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});

  async function open(memberId, {english = false, viewport = SIZES['phone-360'], inApp = ['rep', 'rep2', 'sup'].includes(memberId), view = 'customer', downloads = false} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: viewport.width < 1100, geolocation: {...HERE, accuracy: 8}, permissions: ['geolocation'], acceptDownloads: downloads});
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    await context.addInitScript(english => { try { localStorage.setItem('yr-language', english ? 'en' : 'ar'); } catch { /* storage unavailable */ } }, english);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (inApp) await installNativeBridge(page, {memberId, regionScope: 'eastern'});
    await page.goto(app.origin + '/#' + view);
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator(view === 'customer' ? '.customer-machines-page' : '.workspace').first().waitFor();
    return page;
  }
  const still = page => page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
  const settle = page => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const shot = async (page, label) => { await settle(page); await page.screenshot({path: path.join(screenshots, label + '.png'), fullPage: false}); };
  const noSideways = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scrolling');
  const allInside = async (locator, label) => check(await locator.evaluateAll(nodes => nodes.filter(node => { const box = node.getBoundingClientRect(); return box.width && (box.left < -1 || box.right > innerWidth + 1); }).map(node => node.textContent.trim().slice(0, 40))), [], label + ': inside the screen');
  const compact = page => page.locator('.customer-mobile-card').first().isVisible();
  /** The block of a customer as the list shows it: its items (key and words), on the card or the desktop row. */
  const block = async (page, name) => {
    const holder = await compact(page) ? page.locator('.customer-mobile-card').filter({has: page.locator('h3', {hasText: name})}) : page.locator('.unified-customers tbody tr').filter({has: page.locator('.customer-expand strong', {hasText: name})});
    await holder.first().waitFor();
    return holder.first().locator('[data-capacity-item]').evaluateAll(items => items.map(item => [item.dataset.capacityItem, item.textContent.replace(/\s+/g, ' ').trim()]));
  };

  // ---- 1. The card and the row, at every size, in both languages.
  for (const english of [false, true]) for (const [label, viewport] of Object.entries(SIZES)) {
    const page = await open('rep', {english, viewport});
    const phone = await compact(page);
    const hope = await block(page, HOPE);
    check(hope.map(([key]) => key), ['machineCount', 'machineTypes', 'moldsInUse', 'productionCapacity', 'annualDemand'], label + (english ? ' en' : ' ar') + ': five items without opening anything');
    check(hope.map(([, words]) => words), english
      ? ['Machines6', 'Machine typesQGM ×3 · Stationary ×2 · Mobile ×1', 'Molds in use12', 'Production capacity5000 بلكة يوميًا', 'Annual demand40 قالبًا']
      : ['عدد الماكينات6', 'أنواع الماكيناتQGM ×3 · ثابتة ×2 · متحركة ×1', 'عدد القوالب المستخدمة12', 'الطاقة الإنتاجية5000 بلكة يوميًا', 'حجم الطلب السنوي40 قالبًا'],
    label + ': the registered machines (2+1+3 = 6, never the sheet\'s 9 added), grouped, an unknown type by its manufacturer; the entered three');
    const sheet = await block(page, SHEET);
    check(sheet.map(([, words]) => words), phone ? (english ? ['Machines5 · per the sheet', 'Machine typesBesser · per the sheet'] : ['عدد الماكينات5 · حسب الشيت', 'أنواع الماكيناتBesser · حسب الشيت']) : [],
      label + (phone ? ': no machine registered, the sheet\'s, marked' : ': beside the row\'s own sheet column, the sheet\'s are not said twice'));
    check(await block(page, PLAIN), [], label + ': nothing to say, no block');
    await noSideways(page, label);
    await allInside(page.locator('[data-customer-capacity]:visible, [data-customer-capacity]:visible *'), label + ' the block');
    if (english) check(await page.locator('[data-customer-capacity]:visible').evaluateAll(nodes => nodes.map(node => { const copy = node.cloneNode(true); copy.querySelectorAll('[data-capacity-item=productionCapacity] dd,[data-capacity-item=annualDemand] dd,bdi').forEach(item => item.remove()); return copy.textContent; }).join(' ')).then(text => /[؀-ۿ]/.test(text)), false, label + ': no Arabic left in English but the data');
    await page.locator('[data-customer-capacity]:visible').first().scrollIntoViewIfNeeded();
    await shot(page, 'capacity-card-' + label + (english ? '-en' : '-ar'));
    await page.context().close();
  }

  // ---- 2. The representative, their own customer: the sheet, the form's section, a direct save.
  let page = await open('rep');
  await page.getByRole('button', {name: 'بيانات العميل: ' + HOPE, exact: true}).click();
  const sheetPanel = page.locator('.crm-sheet');await sheetPanel.waitFor();await still(page);
  check(await sheetPanel.locator('[data-capacity-summary] [data-capacity-item]').evaluateAll(items => items.map(item => item.dataset.capacityItem)), ['machineCount', 'machineTypes', 'moldsInUse', 'productionCapacity', 'annualDemand'], 'the sheet: the five, under «الطاقة الإنتاجية والاحتياج»');
  check(await sheetPanel.locator('.detail-grid span').allInnerTexts().then(texts => texts.includes('عدد الماكينات حسب الشيت')), true, 'with registered machines, the sheet\'s own count stays in the grid (it differs)');
  await sheetPanel.locator('[data-capacity-summary]').scrollIntoViewIfNeeded();
  await shot(page, 'capacity-sheet-360-ar');
  await sheetPanel.getByRole('button', {name: 'تعديل', exact: true}).click();
  let dialog = page.locator('.crm-master-dialog');await dialog.locator('form').waitFor();await still(page);
  const section = dialog.locator('[data-customer-section="5"]');
  await section.scrollIntoViewIfNeeded();
  check([await section.locator('h3').innerText().then(text => text.replace(/\s+/g, ' ').trim()), await section.locator('[data-capacity-direct-note]').isVisible()], ['5 الطاقة والاحتياج اختياري · يظهر على كارت العميل', true], 'the form\'s section and its note of the direct save');
  check(await section.locator('[data-capacity-field=moldsInUse]').inputValue(), '12', 'the molds as stored');
  check(await dialog.locator('button[type=submit]').innerText().then(text => text.trim()), 'إرسال التعديل للموافقة', 'nothing changed yet: the button of a correction that waits');
  await section.locator('[data-capacity-field=moldsInUse]').fill('١٥');
  await section.getByRole('textbox', {name: /^حجم الطلب السنوي/}).fill('نحو 60 قالبًا');
  check(await dialog.locator('button[type=submit]').innerText().then(text => text.trim()), 'حفظ العميل', 'the three alone changed: «حفظ العميل» (saved directly)');
  const phone = dialog.getByRole('textbox', {name: 'جوال المسؤول 1', exact: true});
  await phone.fill('0559999999');
  check(await dialog.locator('button[type=submit]').innerText().then(text => text.trim()), 'إرسال التعديل للموافقة', 'with another field: the whole edit waits');
  await phone.fill('0551234567');
  await noSideways(page, 'the form at 360');
  await shot(page, 'capacity-form-360-ar');
  const posted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/crm' && response.request().method() === 'POST');
  await dialog.locator('button[type=submit]').click();
  const reply = await (await posted).json();
  check([reply.ok, reply.pendingApproval], [true, undefined], 'saved directly, no request: ' + JSON.stringify(reply));
  await dialog.waitFor({state: 'detached'});
  const saved = await stored('c1');
  check([saved.moldsInUse, saved.annualDemand, saved.productionCapacity], [15, 'نحو 60 قالبًا', '5000 بلكة يوميًا'], '«١٥» read as 15, the annual demand changed, the capacity kept');
  check((await app.db.prepare("SELECT COUNT(*) AS n FROM crm_audit WHERE record_id='c1' AND action='customer-edit:request'").first()).n, 0, 'no request was made');
  await page.context().close();

  // ---- 3. The visit: «موعد احتياج القوالب المتوقع».
  page = await open('rep', {view: 'activity'});
  await page.locator('.heading-actions').getByRole('button', {name: 'زيارة جديدة', exact: true}).click();
  dialog = page.getByRole('dialog');await dialog.waitFor();
  await dialog.locator('#visit-customer-search').fill(HOPE);await dialog.getByRole('option').filter({hasText: HOPE}).click();await dialog.locator('.visit-selected-customer').filter({hasText: HOPE}).waitFor();
  await dialog.locator('.location-status').filter({hasText: 'تم تحديد الموقع تلقائيًا'}).waitFor();
  const pick = async (name, option) => { await dialog.getByRole('combobox', {name, exact: true}).click(); await page.getByRole('option', {name: option, exact: true}).click(); await page.getByRole('option').first().waitFor({state: 'hidden'}); };
  await pick('اختر الهدف من الزيارة', 'تعريف بمنتجات الشركة');
  await pick('نتيجة الزيارة', 'متابعة العميل');
  await dialog.getByRole('textbox', {name: /^الإجراء القادم/}).fill('إرسال عرض السعر');
  const sales = dialog.locator('details.visit-sales-details');
  if (!await sales.evaluate(node => node.open)) await sales.locator('summary').click();
  const need = dialog.locator('#visit-mold-need');
  await need.scrollIntoViewIfNeeded();
  check([await need.getAttribute('type'), await need.getAttribute('min')], ['date', today], 'a date, from the day of recording');
  check(await dialog.locator('label.visit-mold-need > span').first().innerText(), 'موعد احتياج القوالب المتوقع', 'its label');
  await need.fill(later);
  await noSideways(page, 'the visit form');
  await allInside(dialog.locator('label.visit-mold-need, label.visit-mold-need *'), 'the visit\'s field');
  await shot(page, 'mold-need-visit-360-ar');
  await dialog.getByRole('button', {name: 'حفظ الزيارة', exact: true}).click();
  await dialog.waitFor({state: 'detached'});
  const visit = JSON.parse((await app.db.prepare("SELECT data FROM crm_records WHERE kind='activity' ORDER BY created_at DESC LIMIT 1").first()).data);
  check(visit.moldNeedBy, later, 'saved with the visit');
  const card = page.locator('.rep-record-card').filter({hasText: HOPE}).first();
  await card.waitFor();
  check(await card.locator('[data-mold-need]').innerText().then(text => text.replace(/\s+/g, ' ').trim()), 'احتياج القوالب المتوقع: ' + later, 'read on the visit\'s card');
  await card.scrollIntoViewIfNeeded();
  await shot(page, 'mold-need-card-360-ar');
  await page.context().close();
  page = await open('rep', {view: 'activity', english: true});
  const enCard = page.locator('.rep-record-card').filter({hasText: HOPE}).first();
  await enCard.waitFor();
  check(await enCard.locator('[data-mold-need]').innerText().then(text => text.replace(/\s+/g, ' ').trim()), 'Expected mold need: ' + later, 'in English');
  await page.context().close();

  // ---- 4. The manager's customers export carries the six columns.
  page = await open('mgr', {viewport: SIZES.desktop, downloads: true});
  const download = page.waitForEvent('download');
  await page.getByRole('button', {name: /^تصدير Excel/}).first().click();
  const file = await (await download).path();
  const bytes = fs.readFileSync(file);
  const {inflateRawSync} = await import('node:zlib');
  // The workbook's first sheet (lib/xlsx-write.ts): read its shared or inline strings for the header row.
  const entries = []; for (let at = 0; at < bytes.length - 30; at++) if (bytes.readUInt32LE(at) === 0x04034b50) { const method = bytes.readUInt16LE(at + 8), size = bytes.readUInt32LE(at + 18), nameLength = bytes.readUInt16LE(at + 26), extra = bytes.readUInt16LE(at + 28), name = bytes.subarray(at + 30, at + 30 + nameLength).toString(), start = at + 30 + nameLength + extra; entries.push({name, data: method === 8 ? inflateRawSync(bytes.subarray(start, start + size)) : bytes.subarray(start, start + size)}); }
  const sheetXml = entries.find(entry => /worksheets\/sheet1\.xml$/.test(entry.name)).data.toString();
  for (const header of ['عدد الماكينات', 'مصدر عدد الماكينات', 'أنواع الماكينات', 'عدد القوالب المستخدمة', 'الطاقة الإنتاجية', 'حجم الطلب السنوي']) ok(sheetXml.includes('>' + header + '<'), 'the export has «' + header + '»');
  ok(sheetXml.includes('QGM ×3 · ثابتة ×2 · متحركة ×1'), 'and the types of a customer');
  await page.context().close();

  ok(!errors.length, 'no uncaught page errors: ' + errors.join(' | '));
  console.log(JSON.stringify({ok: true, checks, screenshots, realChromium: true, syntheticFixtures: true}));
} finally {
  await browser?.close(); await app?.stop();
}
