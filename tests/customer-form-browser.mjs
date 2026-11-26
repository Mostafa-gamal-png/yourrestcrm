// The customer form the owner approved on 2026-11-21 (the mockup «عميل جديد»: six numbered sections, several contacts, the place as one line;
// «الداتا اللى فى الفورم القديمة كلها مهمة») in a real Chromium against the BUILT release (run the build first). At 320 and 360 px in the
// simulated Android app, a tablet upright and on its side and a desktop, in Arabic and in English: the title, the heading with the region and
// the codes, the six sections in order (two columns from 1024 px, one below), nothing under «بيانات إضافية», nothing running off the screen,
// every control inside it, the save bar reachable, no Arabic left in English. The representative's new customer on a phone: contacts added,
// one made the primary, one deleted, a role chosen; the place «تم تحديد موقعك الحالي · الدقة 8 م · الآن» and «تغيير الموقع» opening the
// earlier choices; «نشط» chosen; saved, with every value where the server keeps it. The sales manager's edit of a customer that holds every
// field of the earlier form: each value shown in its place (nothing lost), the codes read only, saved unchanged; the sheet lists every
// contact with call and WhatsApp. Screenshots for the report. Synthetic fixtures only.
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
  {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'المندوب أحمد'}
];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-customer-form-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const SIZES = {'phone-320': {width: 320, height: 700}, 'phone-360': {width: 360, height: 800}, 'tablet-upright': {width: 768, height: 1024}, 'tablet-sideways': {width: 1024, height: 768}, desktop: {width: 1280, height: 900}};
const HERE = {latitude: 26.43, longitude: 50.03};
const TITLES = {ar: ['المصنع', 'المسؤولون', 'الموقع', 'التصنيف والمسؤولية', 'الطاقة والاحتياج', 'ملاحظات'], en: ['Factory', 'Contacts', 'Location', 'Classification and responsibility', 'Capacity and demand', 'Notes']};
const FULL = 'مصنع كل البيانات';

try {
  app = await bootBuiltApp({members}, {tls: true});
  const now = new Date().toISOString();
  // A customer holding every field of the earlier form (and the new ones).
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('full','customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')").bind(JSON.stringify({
    name: FULL, branch: 'الرئيسي', assignedTo: 'rep', region: 'الشرقية', code: 'ERP-77', customerKind: 'مؤسسة', category: 'بلوك', customerType: 'جملة', customerStatus: 'نصف نشط',
    contact: 'م. خالد العتيبي', contactTitle: 'factory_manager', phone: '0551234567', email: 'khaled@factory.example', contact2: 'أ. سعد القحطاني', phone2: '0509876543', email2: 'saad@factory.example',
    contacts: [{name: 'سارة المحاسبة', title: 'accountant', phone: '0533333333', email: ''}], city: 'الدمام', address: 'حي الصناعية الثانية', location: '26.4300000, 50.0300000', latitude: HERE.latitude, longitude: HERE.longitude,
    shortAddress: 'DAMM1234', supplier: 'المورد الحالي', machineCount: 4, machineTypes: 'Besser', notes: 'ملاحظة قديمة مهمة', moldsInUse: 7, productionCapacity: '3000 بلكة', annualDemand: '20 قالبًا'
  }), now, now).run();
  const stored = async id => JSON.parse((await app.db.prepare('SELECT data FROM crm_records WHERE id=?').bind(id).first()).data);
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});

  async function open(memberId, {english = false, viewport = SIZES['phone-360'], inApp = ['rep', 'sup'].includes(memberId)} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: viewport.width < 1100, geolocation: {...HERE, accuracy: 8}, permissions: ['geolocation']});
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    await context.addInitScript(english => { try { localStorage.setItem('yr-language', english ? 'en' : 'ar'); } catch { /* storage unavailable */ } }, english);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (inApp) await installNativeBridge(page, {memberId, regionScope: 'eastern'});
    await page.goto(app.origin + '/#customer');
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('.customer-machines-page').waitFor();
    return page;
  }
  const still = page => page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
  const settle = page => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const shot = async (page, label) => { await settle(page); await page.screenshot({path: path.join(screenshots, label + '.png'), fullPage: false}); };
  const noSideways = async (page, label) => check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scrolling');
  const allInside = async (scope, label) => check(await scope.locator('button:visible, input:visible, textarea:visible, [role=combobox]:visible, label:visible').evaluateAll(nodes => nodes.filter(node => { const box = node.getBoundingClientRect(); return box.width && (box.left < -1 || box.right > innerWidth + 1); }).map(node => (node.getAttribute('aria-label') || node.textContent || node.tagName).trim().slice(0, 40))), [], label + ': every control inside the screen');
  const addCustomer = async page => { await page.locator('main button:visible', {hasText: /^\s*(إضافة عميل|إضافة مصنع|Add customer|Add factory)\s*$/i}).first().click(); const dialog = page.locator('.crm-master-dialog'); await dialog.locator('form').waitFor(); await still(page); return dialog; };
  const sectionTitles = dialog => dialog.locator('[data-customer-section] > h3 > span:not(.customer-form-step)').allInnerTexts().then(texts => texts.map(text => text.trim()));

  // ---- 1. The new-customer form at every size, in both languages.
  for (const english of [false, true]) for (const [label, viewport] of Object.entries(SIZES)) {
    const who = viewport.width >= 1024 ? 'mgr' : 'rep';
    const page = await open(who, {english, viewport});
    const dialog = await addCustomer(page);
    const name = label + (english ? ' en' : ' ar');
    check(await dialog.locator('[data-slot=dialog-title]').innerText(), english ? 'New customer' : 'عميل جديد', name + ': the title');
    check(await sectionTitles(dialog), TITLES[english ? 'en' : 'ar'], name + ': six sections, in order');
    check(await dialog.locator('[data-customer-section]').evaluateAll(nodes => nodes.map(node => node.dataset.customerSection)), ['1', '2', '3', '4', '5', '6'], name + ': numbered');
    check([await dialog.locator('.customer-extra-fields').count(), await dialog.locator('details').count()], [0, 0], name + ': nothing hidden under «بيانات إضافية»');
    ok((await dialog.locator('.customer-form-heading').innerText()).includes(english ? 'The Yourrest code is assigned automatically after saving' : 'كود يورست يُنشأ تلقائيًا بعد الحفظ'), name + ': the codes come later');
    // Two columns from 1024 px: the first two sections side by side; one column below.
    const tops = await dialog.locator('[data-customer-section="1"], [data-customer-section="2"]').evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().top)));
    check(tops[0] === tops[1], viewport.width >= 1024, name + (viewport.width >= 1024 ? ': two columns' : ': one column'));
    await dialog.locator('[data-location-line]').waitFor();
    await noSideways(page, name);
    const save = dialog.locator('button[type=submit]');
    check([await save.isVisible(), await save.innerText().then(text => text.trim())], [true, english ? 'Save customer' : 'حفظ العميل'], name + ': the save bar is reachable');
    // Every section scrolled into view: every control inside the screen.
    for (const step of ['1', '2', '3', '4', '5', '6']) { await dialog.locator('[data-customer-section="' + step + '"]').scrollIntoViewIfNeeded(); await allInside(dialog.locator('[data-customer-section="' + step + '"]'), name + ' section ' + step); }
    if (english) check(await dialog.evaluate(node => { const copy = node.cloneNode(true); copy.querySelectorAll('input,textarea,bdi,select,[aria-hidden=true],.customer-choice span').forEach(item => item.remove()); return copy.textContent; }).then(text => text.match(/[؀-ۿ]+/g) || []), [], name + ': no Arabic left in English (the choices\' values and the data aside)');
    await dialog.locator('[data-customer-section="1"]').scrollIntoViewIfNeeded();
    await shot(page, 'form-new-' + label + (english ? '-en' : '-ar'));
    await dialog.locator('[data-customer-section="2"]').scrollIntoViewIfNeeded();
    await shot(page, 'form-new-contacts-' + label + (english ? '-en' : '-ar'));
    await page.context().close();
  }

  // ---- 2. The representative's new customer, on a phone: contacts, the place, the status, saved.
  let page = await open('rep');
  let dialog = await addCustomer(page);
  await dialog.locator('label.field', {hasText: 'اسم المصنع'}).locator('input').fill('مصنع النموذج الجديد');
  const contact = n => dialog.locator('[data-contact-index="' + (n - 1) + '"]');
  check(await dialog.locator('[data-contact-index]').count(), 1, 'one contact to start, the primary');
  check(await contact(1).locator('[data-contact-primary]').innerText(), 'الأساسي', 'marked «الأساسي»');
  await contact(1).getByRole('textbox', {name: 'اسم المسؤول 1'}).fill('م. أول');
  await contact(1).getByRole('textbox', {name: 'جوال المسؤول 1'}).fill('0551111111');
  await contact(1).getByRole('combobox', {name: 'صفة المسؤول 1'}).click();await page.getByRole('option', {name: 'المالك', exact: true}).click();
  for (const [n, who, phone] of [[2, 'أ. ثاني', '0552222222'], [3, 'أ. ثالث', '0553333333']]) {
    await dialog.getByRole('button', {name: 'إضافة مسؤول آخر', exact: true}).click();
    await contact(n).getByRole('textbox', {name: 'اسم المسؤول ' + n}).fill(who);
    await contact(n).getByRole('textbox', {name: 'جوال المسؤول ' + n}).fill(phone);
  }
  await contact(3).getByRole('textbox', {name: 'بريد المسؤول 3'}).fill('third@factory.example');
  check(await dialog.locator('[data-contact-index]').count(), 3, 'three contacts');
  await contact(3).getByRole('button', {name: 'اجعل المسؤول 3 الأساسي', exact: true}).click();
  check(await contact(1).getByRole('textbox', {name: 'اسم المسؤول 1'}).inputValue(), 'أ. ثالث', '«اجعله الأساسي»: the third is the primary now');
  check(await contact(2).getByRole('textbox', {name: 'اسم المسؤول 2'}).inputValue(), 'م. أول', 'the earlier primary second');
  await contact(3).getByRole('button', {name: 'حذف المسؤول 3', exact: true}).click();
  check(await dialog.locator('[data-contact-index]').count(), 2, '«حذف»: two left');
  await contact(2).scrollIntoViewIfNeeded();
  await shot(page, 'form-contacts-edited-360-ar');
  // The place: one line, then the earlier choices.
  const line = dialog.locator('[data-location-line]');
  await dialog.locator('[data-location-line=device]').waitFor();
  check(await line.locator('.customer-location-text').innerText().then(text => text.replace(/\s+/g, ' ').trim()), 'تم تحديد موقعك الحالي الدقة 8 م · الآن', 'the place as one line, with its accuracy');
  await line.scrollIntoViewIfNeeded();
  await shot(page, 'form-location-line-360-ar');
  await dialog.getByRole('button', {name: 'تغيير الموقع', exact: true}).click();
  check([await dialog.getByRole('radio', {name: 'موقعي الحالي', exact: true}).isChecked(), await dialog.getByRole('radio', {name: 'موقع آخر', exact: true}).isVisible()], [true, true], '«تغيير الموقع»: the earlier choices');
  check(await dialog.getByRole('textbox', {name: 'اللوكيشن (خط العرض، خط الطول)', exact: true}).inputValue(), '26.4300000, 50.0300000', 'with the phone\'s position');
  check(await dialog.getByRole('radio', {name: 'نشط', exact: true}).isChecked(), true, 'a new customer starts «نشط»');
  await dialog.locator('label.customer-choice', {hasText: 'شركة'}).click();
  await dialog.locator('[data-capacity-field=moldsInUse]').fill('9');
  await noSideways(page, 'the filled form');
  const posted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/crm' && response.request().method() === 'POST');
  await dialog.getByRole('button', {name: 'حفظ العميل', exact: true}).click();
  const answer = await (await posted).json();
  ok(answer.ok && answer.id, 'saved: ' + JSON.stringify(answer));
  await dialog.waitFor({state: 'detached'});
  const created = await stored(answer.id);
  check([created.contact, created.phone, created.email, created.contactTitle, created.contact2, created.phone2, created.contactTitle2, created.contacts], ['أ. ثالث', '0553333333', 'third@factory.example', undefined, 'م. أول', '0551111111', 'owner', undefined], 'the primary in the customer\'s own fields, the second in «المسؤول الثاني» with its role');
  check([created.customerStatus, created.customerKind, created.moldsInUse, created.locationSource, created.region], ['نشط', 'شركة', 9, 'device', 'الشرقية'], 'the status, the kind, the molds, the place, the region');
  await page.context().close();

  // ---- 3. The sales manager edits a customer holding every field: nothing lost.
  page = await open('mgr', {viewport: SIZES.desktop});
  await page.locator('.unified-customers tbody tr').filter({has: page.locator('.customer-expand strong', {hasText: FULL})}).getByRole('button', {name: 'بيانات العميل', exact: true}).click();
  let sheet = page.locator('.crm-sheet');await sheet.waitFor();await still(page);
  const contacts = sheet.locator('[data-customer-contacts-list] li');
  check(await contacts.count(), 3, 'the sheet lists the three contacts');
  check(await contacts.first().locator('a[href^="tel:"]').getAttribute('href'), 'tel:0551234567', 'with a call');
  check(await contacts.nth(2).locator('a[href^="https://wa.me/"]').getAttribute('href'), 'https://wa.me/966533333333', 'and WhatsApp, the others too');
  ok((await contacts.first().innerText()).includes('مدير المصنع') && (await contacts.first().innerText()).includes('الأساسي'), 'the primary\'s role and mark');
  await sheet.locator('[data-customer-contacts-list]').scrollIntoViewIfNeeded();
  await shot(page, 'sheet-contacts-desktop-ar');
  await sheet.getByRole('button', {name: 'تعديل', exact: true}).click();
  dialog = page.locator('.crm-master-dialog');await dialog.locator('form').waitFor();await still(page);
  check(await dialog.locator('[data-slot=dialog-title]').innerText(), 'تعديل بيانات العميل', 'the edit title');
  const codes = await dialog.locator('[data-customer-form-codes]').innerText();
  ok(codes.includes('YR-C-') && codes.includes('ERP-77'), 'the codes, read only: ' + codes);
  check(await dialog.locator('input, textarea').evaluateAll(items => items.filter(item => item.value === 'ERP-77' || item.value.startsWith('YR-C-')).length), 0, 'never an input');
  const field = label => dialog.locator('label.field').filter({has: page.locator('span', {hasText: new RegExp('^' + label + '( \\*)?$')})}).locator('input,textarea').first();
  const radio = name => dialog.getByRole('radio', {name, exact: true}).isChecked();
  check([await field('اسم المصنع').inputValue(), await radio('مؤسسة'), await radio('بلوك'), await radio('جملة'), await radio('نصف نشط')], [FULL, true, true, true, true], 'the name, the kind, the category, the classification, the status');
  check([await contact(1).getByRole('textbox', {name: 'اسم المسؤول 1'}).inputValue(), await contact(1).getByRole('combobox', {name: 'صفة المسؤول 1'}).innerText(), await contact(1).getByRole('textbox', {name: 'جوال المسؤول 1'}).inputValue(), await contact(1).getByRole('textbox', {name: 'بريد المسؤول 1'}).inputValue()], ['م. خالد العتيبي', 'مدير المصنع', '0551234567', 'khaled@factory.example'], 'the primary contact, its role, mobile and email');
  check([await contact(2).getByRole('textbox', {name: 'اسم المسؤول 2'}).inputValue(), await contact(2).getByRole('textbox', {name: 'جوال المسؤول 2'}).inputValue(), await contact(2).getByRole('textbox', {name: 'بريد المسؤول 2'}).inputValue()], ['أ. سعد القحطاني', '0509876543', 'saad@factory.example'], 'the second contact');
  check([await contact(3).getByRole('textbox', {name: 'اسم المسؤول 3'}).inputValue(), await contact(3).getByRole('combobox', {name: 'صفة المسؤول 3'}).innerText()], ['سارة المحاسبة', 'المحاسب'], 'the third');
  check([await field('المدينة').inputValue(), await field('العنوان').inputValue(), await field('العنوان الوطني المختصر').inputValue()], ['الدمام', 'حي الصناعية الثانية', 'DAMM1234'], 'the city, the address, the short national address');
  check(await dialog.locator('[data-location-line]').innerText().then(text => text.replace(/\s+/g, ' ').trim()), 'الموقع المحفوظ 26.4300000, 50.0300000 تغيير الموقع', 'the saved place, as one line');
  // Since 2026-11-26 «عدد الماكينات» and «أنواع الماكينات» are fields of «الطاقة والاحتياج» for every customer, starting from what the card shows.
  check([await field('مورد القوالب والقطع').inputValue(), await dialog.locator('[data-capacity-field=machineCount]').inputValue(), await field('أنواع الماكينات').inputValue(), await field('ملاحظات المصنع').inputValue()], ['المورد الحالي', '4', 'Besser', 'ملاحظة قديمة مهمة'], 'the supplier, the machines\' count and types (the sheet\'s, as the card shows them), the notes');
  check([await dialog.locator('[data-capacity-field=moldsInUse]').inputValue(), await field('الطاقة الإنتاجية').inputValue(), await field('حجم الطلب السنوي').inputValue()], ['7', '3000 بلكة', '20 قالبًا'], 'the capacity and demand');
  check([await dialog.getByRole('combobox', {name: 'المندوب المسؤول', exact: true}).innerText(), await field('فرع يورست المسؤول').inputValue()], ['المندوب أحمد', 'الرئيسي'], 'the responsible member and branch');
  for (const step of ['1', '2', '3', '4', '5', '6']) { await dialog.locator('[data-customer-section="' + step + '"]').scrollIntoViewIfNeeded(); await shot(page, 'form-edit-desktop-ar-' + step); }
  const before = await stored('full');
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/crm' && response.request().method() === 'POST');
  await dialog.getByRole('button', {name: 'حفظ العميل', exact: true}).click();
  check((await saved).status(), 200, 'saved unchanged');
  await dialog.waitFor({state: 'detached'});
  const after = await stored('full');
  for (const key of Object.keys(before)) check(after[key], before[key], 'nothing lost: ' + key);
  await page.context().close();

  ok(!errors.length, 'no uncaught page errors: ' + errors.join(' | '));
  console.log(JSON.stringify({ok: true, checks, screenshots, realChromium: true, syntheticFixtures: true}));
} finally {
  await browser?.close(); await app?.stop();
}
