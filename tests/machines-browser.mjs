// Machines in a real Chromium against the BUILT release (run `pnpm build` first): a representative, on the Android app emulator,
// adds a machine to their own customer (model and bushings new or old, no place and no number asked), sees it on the card and in
// the details, corrects it, and is offered neither adding nor correcting on a colleague's customer; the sales manager sees the
// same record. Synthetic isolated fixtures only: temporary SQLite, mocked sendmail, no production data, no device.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'سعد مدير المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'sm', name: 'ماجد المشرف'},
  {id: 'rep', role: 'rep', sup: 'sup', name: 'أحمد المندوب', region: 'eastern'}, {id: 'rep2', role: 'rep', sup: 'sup', name: 'سالم المندوب', region: 'eastern'}
];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-machines-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const DESKTOP = {width: 1280, height: 900};
const OWN = 'مصنع المندوب الأول', OTHER = 'مصنع الزميل';

try {
  app = await bootBuiltApp({members}, {tls: true});
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});
  const now = new Date().toISOString();
  const customer = (id, name, assignedTo) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')")
    .bind(id, assignedTo, JSON.stringify({name, code: id, region: 'الشرقية', city: 'الدمام', phone: '0551234567', contact: 'م', branch: 'الرئيسي', assignedTo}), now, now).run();
  await customer('own', OWN, 'rep'); await customer('other', OTHER, 'rep2');
  await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('other-machine','factory','other','rep2','الرئيسي',?,?,?,1,'fixture')")
    .bind(JSON.stringify({name: 'خط الزميل', recordType: 'machine', quantity: 1, machineBrand: 'Besser', machineModel: 'V1', machineType: 'stationary', modelCondition: 'old', bushingCondition: 'new', machineSerial: 'HIDDEN-SERIAL-9', location: 'HIDDEN-PLACE'}), now, now).run();
  const machineRows = async () => (await app.db.prepare("SELECT id,assigned_to,data,version FROM crm_records WHERE kind='factory' ORDER BY created_at,id").all()).results.map(row => ({...row, data: JSON.parse(row.data)}));

  async function open(memberId, {native = false} = {}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport: DESKTOP, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', geolocation: {latitude: 26.437341, longitude: 50.034499, accuracy: 8}, permissions: ['geolocation']});
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
  const settle = page => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const shot = async (page, label) => { await settle(page); await page.screenshot({path: path.join(screenshots, label + '.png')}); };
  const openCustomers = async page => { await page.locator('button.nav-item', {hasText: 'العملاء'}).first().click(); await page.locator('.customer-expand').first().waitFor(); };
  const rowOf = (page, name) => page.locator('tr', {has: page.getByText(name, {exact: false})}).filter({has: page.locator('.customer-expand')}).first();
  const pick = async (dialog, label, option) => { await dialog.getByRole('combobox', {name: label}).click(); await dialog.page().getByRole('option', {name: option, exact: true}).click(); };

  // ---- the representative
  const rep = await open('rep', {native: {memberId: 'rep', regionScope: 'eastern'}});
  await openCustomers(rep);
  await rowOf(rep, OWN).locator('.customer-expand').click();
  const ownAdd = rep.locator('.machines-expanded').getByRole('button', {name: 'إضافة ماكينة'});
  check(await ownAdd.count(), 1, 'their own customer offers adding a machine');
  await rowOf(rep, OTHER).locator('.customer-expand').click();
  const otherPanel = rep.locator('.machines-expanded', {hasText: OTHER});
  await otherPanel.waitFor();
  check([await otherPanel.getByRole('button', {name: 'إضافة ماكينة'}).count(), await otherPanel.getByRole('button', {name: 'تعديل'}).count()], [0, 0], 'a colleague\'s customer offers neither adding nor correcting');
  const otherText = await otherPanel.innerText();
  ok(otherText.includes('الموديل جديد أم قديم') && otherText.includes('نوع الجلب'), 'the card shows the model and bushing conditions');
  ok(!otherText.includes('HIDDEN-SERIAL-9') && !otherText.includes('HIDDEN-PLACE') && !/رقم الماكينة|موقع الماكينة/.test(otherText), 'the stored place and number are not shown');
  await rowOf(rep, OWN).locator('.customer-expand').click();
  await ownAdd.click();
  const dialog = rep.locator('[role=dialog]');
  await dialog.waitFor();
  const labels = await dialog.locator('label.field span, legend').allInnerTexts();
  ok(!labels.some(text => /موقع الماكينة|رقم الماكينة \/ الخط/.test(text)), 'the form no longer asks for the machine\'s place or number');
  ok(labels.some(text => text.includes('الموديل جديد أم قديم')) && labels.some(text => text.includes('نوع الجلب جديد أم قديم')), 'the form asks whether the model and the bushings are new or old');
  await dialog.locator('label.voice-field', {hasText: 'اسم / رقم الماكينة أو خط الإنتاج'}).locator('input').fill('خط البلوك 1');
  await dialog.locator('label.voice-field', {hasText: 'الشركة المصنعة للماكينة'}).locator('input').fill('Besser');
  await dialog.locator('label.voice-field', {hasText: 'موديل الماكينة'}).locator('input').fill('V3-12');
  await pick(dialog, 'الموديل جديد أم قديم', 'جديد');
  await pick(dialog, 'نوع الجلب جديد أم قديم', 'قديم');
  await rep.waitForTimeout(500);
  await shot(rep, 'machines-form-rep');
  const saved = rep.waitForResponse(response => response.url().endsWith('/api/crm') && response.request().method() === 'POST');
  await dialog.getByRole('button', {name: /^حفظ /}).click();
  check((await saved).status(), 200, 'the representative\'s machine is saved');
  await dialog.waitFor({state: 'detached'});
  const created = (await machineRows()).find(row => row.data.name === 'خط البلوك 1');
  check([created.assigned_to, created.data.machineBrand, created.data.machineModel, created.data.modelCondition, created.data.bushingCondition, created.data.machineSerial, created.data.location], ['rep', 'Besser', 'V3-12', 'new', 'old', undefined, undefined], 'it belongs to the customer\'s representative and carries the two conditions only');
  const card = rep.locator('.machine-card', {hasText: 'خط البلوك 1'});
  await card.waitFor();
  const cardText = await card.innerText();
  ok(cardText.includes('V3-12') && cardText.includes('جديد') && cardText.includes('قديم'), 'the card shows the model and both conditions');
  await shot(rep, 'machines-card-rep');
  // ---- correcting it
  await card.getByRole('button', {name: 'تعديل'}).click();
  await dialog.waitFor();
  await pick(dialog, 'نوع الجلب جديد أم قديم', 'جديد');
  const corrected = rep.waitForResponse(response => response.url().endsWith('/api/crm') && response.request().method() === 'POST');
  await dialog.getByRole('button', {name: /^حفظ /}).click();
  check((await corrected).status(), 200, 'the representative corrects their machine');
  await dialog.waitFor({state: 'detached'});
  check((await machineRows()).find(row => row.id === created.id).data.bushingCondition, 'new', 'the correction is stored');
  // ---- nothing of the colleague's changes, by any route
  const response = await rep.evaluate(async ({id, version}) => (await fetch('/api/crm', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({action: 'save', kind: 'factory', id, version, data: {name: 'x', machineBrand: 'x', machineModel: 'x'}})})).status, {id: 'other-machine', version: 1});
  check(response, 403, 'the server refuses a correction of a colleague\'s machine');
  await rep.context().close();

  // ---- the sales manager reads it
  const manager = await open('sm');
  await openCustomers(manager);
  await rowOf(manager, OWN).locator('.customer-expand').click();
  const managerCard = manager.locator('.machine-card', {hasText: 'خط البلوك 1'});
  await managerCard.waitFor();
  ok((await managerCard.innerText()).includes('V3-12'), 'the manager reads the representative\'s machine');
  await manager.context().close();
  check(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks, builtRelease: true, browser: 'chromium', androidApp: 'emulated bridge', productionDataUsed: false, screenshots}));
} finally {
  await browser?.close();
  await app?.stop();
}
