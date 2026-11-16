// Item 3 of the GSCO list (the owner, 2026-11-16) in a real Chromium against the BUILT release (run the build first): «أ» the requests report
// «بحسب نوع التواصل»; «ب» «تصدير Excel» on the monthly requests and complaints reports (the download, its name; no button where the cell is
// closed) and the row «تقارير خدمة العملاء» in the permission table; «ج» a tapped «شكوى تنتظرك» on the Android app (emulated: its user
// agent and bridge): a cold start on «/#complaint=<id>» opens the complaint, a running page told by «yourrest:open-complaint» too, an id
// outside the member's complaints opens nothing; «د» «طلب مساندة» inside an opportunity: the form, the request sent to «التواصل مع
// العملاء» and opened with its opportunity, the open request offered instead, the retired «طلب مساعدة داخلية» gone while an open one is
// still answered. Phone 320 and 360, a tablet upright and on its side, a computer; Arabic and English (no Arabic left in English but what
// people wrote); nothing scrolls sideways. Screenshots for the report. Synthetic fixtures only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'mgr', role: 'manager', name: 'مدير المبيعات'}, {id: 'mgrx', role: 'manager', name: 'مدير بلا تصدير'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف'}, {id: 'rep', role: 'rep', sup: 'sup', name: 'المندوب أحمد'},
  {id: 'csm', role: 'customer_service_manager', sup: 'mgr', name: 'مدير خدمة العملاء'}, {id: 'cs', role: 'customer_service', sup: 'csm', name: 'ممثلة الخدمة'}
];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-item3-shots-'));
fs.mkdirSync(screenshots, {recursive: true});
let checks = 0, browser, app;
const errors = [];
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const SIZES = [['phone-320', {width: 320, height: 720}, true], ['phone-360', {width: 360, height: 800}, true], ['tablet-upright', {width: 768, height: 1024}, true], ['tablet-side', {width: 1024, height: 768}, true], ['desktop', {width: 1280, height: 900}, false]];
const ARABIC = /[؀-ۿ]/;

try {
  app = await bootBuiltApp({members}, {tls: true});
  const now = new Date().toISOString(), earlier = new Date(Date.now() - 30 * 3600000).toISOString();
  const insert = (id, kind, parent, assigned, data, when = earlier) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,'الرئيسي',?,?,?,1,'fixture')").bind(id, kind, parent, assigned, JSON.stringify(data), when, when).run();
  const customer = (id, name) => insert(id, 'customer', null, 'rep', {name, branch: 'الرئيسي', assignedTo: 'rep', region: 'الوسطى', city: 'الرياض', customerStatus: 'نشط', phone: '0551234567', contact: 'م', code: ''});
  const kase = (id, customerId, data = {}) => app.db.prepare('INSERT INTO crm_service_cases(id,customer_id,status,creator_id,service_manager_id,sales_manager_id,assigned_to,supervisor_id,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,2,?)')
    .bind(id, customerId, 'assigned', 'cs', 'csm', 'mgr', 'rep', 'sup', JSON.stringify({source: 'call', products: ['خدمات صيانة'], strength: 'strong', needs: 'تحديد موعد زيارة', nextAction: 'زيارة', nextDate: '2030-01-01', participants: ['cs', 'csm'], approvedAt: earlier, assignedAt: earlier, seenAt: earlier, seenBy: 'rep', registration: {type: 'call', visitNumber: 77}, ...data}), earlier, earlier, 'fixture').run();
  // One open opportunity per size and language (a customer has one open support request at a time), a busy one, one with an open internal help.
  const runs = SIZES.flatMap(([label]) => ['ar', 'en'].map(language => label + '-' + language));
  for (const [index, tag] of runs.entries()) { await customer('cust-' + tag, 'مصنع رقم ' + (index + 1)); await kase('case-' + tag, 'cust-' + tag, {registration: {type: 'call', visitNumber: 100 + index}}); }
  await customer('cust-busy', 'مصنع الطلب المفتوح'); await kase('case-busy', 'cust-busy');
  await insert('support-busy', 'support', null, 'rep', {kind: 'support', customerId: 'cust-busy', origin: 'rep', status: 'open', requestedBy: 'rep', requestedAt: earlier, repId: 'rep', note: 'طلب سابق', channel: 'any', handlerId: '', handlerAt: '', handlerBy: '', events: [{at: earlier, by: 'rep', action: 'request', text: 'طلب سابق'}]});
  await customer('cust-assist', 'مصنع المساعدة الداخلية'); await kase('case-assist', 'cust-assist', {assistanceOpen: true});
  await app.db.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES('assist-old','case-assist','ممثلة الخدمة','service:assist',?,?)").bind(JSON.stringify({label: 'طلب مساعدة داخلية', note: 'برجاء متابعة عرض السعر داخليًا', targetName: '', state: 'assigned'}), earlier).run();
  // An OLD request (no source, only its registration's type) and one with neither, for the report by contact type.
  await customer('cust-old', 'مصنع الطلب القديم'); await kase('case-old', 'cust-old', {source: undefined, registration: {type: 'email'}});
  // Complaints: one waiting for the representative's contact, one for another representative's team (never his).
  const complaintBase = {kind: 'complaint', status: 'assigned', registrarId: 'cs', serviceManagerId: 'csm', salesManagerId: 'mgr', supervisorId: 'sup', assigneeId: 'rep', channel: 'call', category: 'product_quality', severity: 'high', description: 'العميل يشتكي من تشقق القوالب', demand: 'استبدال القالب', reference: '', contactName: 'م', contactPhone: '0551234567', submittedAt: earlier, forwardedAt: earlier, returnedAt: '', assignedAt: earlier, delegatedAt: '', reassignedAt: '', rejectedAt: '', reopenedAt: '', resolvedAt: '', closedAt: '', cancelledAt: '', seenAt: '', returnNote: '', assignmentNote: '', rejectReason: '', cancelReason: '', previousAssignees: [], updates: [], notes: [], events: []};
  await customer('cust-complaint', 'مصنع الشكوى');
  await insert('complaint-rep', 'complaint', null, 'cs', {...complaintBase, customerId: 'cust-complaint', complaintNumber: 12});
  await insert('complaint-other', 'complaint', null, 'cs', {...complaintBase, customerId: 'cust-complaint', complaintNumber: 13, assigneeId: 'sup', status: 'pending_assignment', salesManagerId: 'mgrx'});
  // The export closed for mgrx.
  await app.db.prepare('INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_at,updated_by) VALUES(?,?,?,1,?,?)').bind('mgrx', JSON.stringify({'service-reports:export': false}), '[]', now, 'owner').run();
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});
  const cookies = {};
  for (const member of members) cookies[member.id] = await app.login(member.id);

  async function open(memberId, {english = false, viewport, touch = false, hash = '', native = false}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: touch, isMobile: touch && viewport.width < 700, acceptDownloads: true});
    const [name, ...value] = cookies[memberId].split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    if (english) await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (native) await installNativeBridge(page, {memberId, regionScope: 'all'});
    await page.goto(app.origin + '/' + hash);
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('.topbar').waitFor();
    return page;
  }
  const shot = async (page, label) => { await page.waitForTimeout(250); await page.screenshot({path: path.join(screenshots, label + '.png'), fullPage: false}); };
  const noSideways = async (page, label) => eq(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scrolling');
  const close = async page => { await page.context().close(); };

  for (const [label, viewport, touch] of SIZES) for (const english of [false, true]) {
    const tag = label + '-' + (english ? 'en' : 'ar'), say = (ar, en) => english ? en : ar;
    // ---- «أ» and «ب»: the sales manager's two reports on «الزيارات», their «تصدير Excel».
    let page = await open('mgr', {english, viewport, touch, hash: '#activity'});
    const requests = page.locator('details.service-report:not(.complaint-report)');
    await requests.locator('summary').click();
    const types = requests.locator('[data-report-contact-types]');
    await types.waitFor();
    eq((await requests.locator('h3').first().innerText()).trim(), say('بحسب نوع التواصل', 'By contact type'), tag + ': the requests report «بحسب نوع التواصل»');
    const rows = (await types.locator('tbody tr').allInnerTexts()).map(text => text.split('\t')[0].trim());
    ok(rows.includes(say('اتصال', 'Phone call')) && rows.includes(say('بريد إلكتروني', 'Email')), tag + ': the old request counts under its registration\'s type: ' + rows.join(' | '));
    const exportButton = requests.locator('[data-report-export="requests"] button');
    eq((await exportButton.innerText()).trim(), say('تصدير Excel', 'Export to Excel'), tag + ': «تصدير Excel» beside the month');
    let [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
    ok(/^Yourrest-service-report-requests-\d{4}-\d{2}\.xlsx$/.test(download.suggestedFilename()), tag + ': the requests workbook downloads: ' + download.suggestedFilename());
    ok((await fs.promises.stat(await download.path())).size > 1500, tag + ': with something in it');
    if (english) ok(!ARABIC.test(await requests.innerText().then(text => text.replace(/مصنع[^\n]*/g, ''))), tag + ': no Arabic left in the English report');
    await noSideways(page, tag + ' (requests report)');
    await requests.locator('[data-report-export]').scrollIntoViewIfNeeded();
    await shot(page, 'item3-' + tag + '-requests-report');
    const complaintReport = page.locator('details.complaint-report');
    await complaintReport.locator('summary').click();
    const complaintExport = complaintReport.locator('[data-report-export="complaints"] button');
    await complaintExport.waitFor();
    [download] = await Promise.all([page.waitForEvent('download'), complaintExport.click()]);
    ok(/^Yourrest-service-report-complaints-\d{4}-\d{2}\.xlsx$/.test(download.suggestedFilename()), tag + ': the complaints workbook downloads');
    await noSideways(page, tag + ' (complaints report)');
    await close(page);

    // ---- «ج»: a tapped «شكوى تنتظرك» on the Android app.
    page = await open('rep', {english, viewport, touch, native: true, hash: '#complaint=complaint-rep'});
    const sheet = page.locator('.complaint-sheet');
    await sheet.waitFor();
    ok((await sheet.innerText()).includes('مصنع الشكوى'), tag + ': a cold start opens the complaint the notice named');
    ok(!(await page.evaluate(() => location.hash)).includes('complaint='), tag + ': and forgets it from the address');
    await noSideways(page, tag + ' (complaint opened from a notice)');
    await shot(page, 'item3-' + tag + '-complaint-from-notice');
    await page.keyboard.press('Escape'); await sheet.waitFor({state: 'detached'});
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('yourrest:open-complaint', {detail: {id: 'complaint-other'}})));
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('yourrest:open-complaint', {detail: {id: '../x'}})));
    await page.waitForTimeout(700);
    eq(await page.locator('.complaint-sheet').count(), 0, tag + ': a complaint outside his own, or a malformed id, opens nothing');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('yourrest:open-complaint', {detail: {id: 'complaint-rep'}})));
    await page.locator('.complaint-sheet').waitFor();
    ok(true, tag + ': a running page told by the app opens it');
    await close(page);

    // ---- «د»: «طلب مساندة» inside the opportunity.
    page = await open('rep', {english, viewport, touch, native: true, hash: '#service-case=case-' + tag});
    const caseSheet = page.locator('.service-sheet');
    await caseSheet.locator('[data-opportunity-support-start]').waitFor();
    eq(await caseSheet.getByRole('button', {name: say('طلب مساعدة داخلية', 'Request internal assistance')}).count(), 0, tag + ': «طلب مساعدة داخلية» is gone');
    await caseSheet.locator('[data-opportunity-support-start]').click();
    const text = caseSheet.locator('[data-opportunity-support] textarea');
    await text.waitFor();
    ok((await caseSheet.locator('.opportunity-support-facts').innerText()).includes(String(100 + runs.indexOf(tag))), tag + ': the form names the customer and the opportunity\'s number');
    await text.fill(say('العميل لا يرد على اتصالاتي، اسألوه عن موعد مناسب', 'The customer is not answering, please ask for a suitable time'));
    if (english) ok(!ARABIC.test((await caseSheet.locator('[data-opportunity-support]').innerText()).replace(/مصنع رقم \d+/g, '')), tag + ': the support form in English');
    await noSideways(page, tag + ' (support form)');
    await shot(page, 'item3-' + tag + '-support-form');
    await caseSheet.locator('[data-opportunity-support-send]').click();
    await caseSheet.locator('[data-opportunity-support-sent]').waitFor();
    ok((await caseSheet.locator('[data-opportunity-support-sent]').innerText()).includes(say('«التواصل مع العملاء»', '«Customer contact»')), tag + ': sent to «التواصل مع العملاء»');
    await caseSheet.locator('[data-opportunity-support-sent] button').click();
    const supportSheet = page.locator('.support-sheet');
    await supportSheet.waitFor();
    ok((await supportSheet.innerText()).includes(say('من الفرصة رقم ' + (100 + runs.indexOf(tag)), 'From opportunity no. ' + (100 + runs.indexOf(tag)))), tag + ': the request opens with the opportunity it came from');
    await noSideways(page, tag + ' (the request opened)');
    await shot(page, 'item3-' + tag + '-support-request');
    await close(page);
    // The busy customer: the open request offered instead.
    page = await open('rep', {english, viewport, touch, native: true, hash: '#service-case=case-busy'});
    await page.locator('.service-sheet [data-opportunity-support-start]').click();
    const problem = page.locator('[data-opportunity-support-problem="open-request"]');
    await problem.waitFor();
    eq(await page.locator('.service-sheet [data-opportunity-support] textarea').count(), 0, tag + ': no form while the customer has an open request');
    await problem.locator('[data-opportunity-support-open-request]').click();
    await page.locator('.support-sheet').waitFor();
    ok((await page.locator('.support-sheet').innerText()).includes('طلب سابق'), tag + ': «فتح الطلب المفتوح» opens it');
    await close(page);
  }

  // ---- once each: the open internal help still answered; the closed export; the permission row.
  for (const english of [false, true]) {
    const say = (ar, en) => english ? en : ar, tag = english ? 'en' : 'ar';
    let page = await open('rep', {english, viewport: {width: 360, height: 800}, touch: true, native: true, hash: '#service-case=case-assist'});
    const sheet = page.locator('.service-sheet');
    await sheet.locator('[data-assistance-open]').waitFor();
    ok((await sheet.getByRole('button', {name: say('الرد وإغلاق طلب المساعدة', 'Reply and close assistance request')}).count()) === 1, tag + ': an open internal help request is still answered');
    ok((await sheet.innerText()).includes(say('طلب مساعدة داخلية', 'Request internal assistance')), tag + ': and its history is read');
    await shot(page, 'item3-phone-360-' + tag + '-old-assistance');
    await close(page);
    page = await open('mgrx', {english, viewport: {width: 1280, height: 900}, hash: '#activity'});
    await page.locator('details.service-report:not(.complaint-report) summary').click();
    await page.locator('details.service-report:not(.complaint-report) [data-report-contact-types]').waitFor();
    eq(await page.locator('[data-report-export]').count(), 0, tag + ': the export closed for this manager: no button');
    await close(page);
    for (const [label, viewport] of [['desktop', {width: 1280, height: 900}], ['phone-360', {width: 360, height: 800}]]) {
      page = await open('owner', {english, viewport, hash: '#team'});
      await page.getByRole('row').filter({has: page.locator('strong', {hasText: /^مدير المبيعات$/})}).getByTitle(say('تعديل المستخدم', 'Edit user')).click().catch(async () => {
        await page.locator('tr, .team-member-card').filter({hasText: 'مدير المبيعات'}).first().getByRole('button', {name: say('تعديل المستخدم', 'Edit user')}).click();
      });
      const row = page.locator('[data-matrix-row="service-reports"]');
      await row.waitFor();
      eq((await row.locator('th').innerText()).split('\n')[0].trim(), say('تقارير خدمة العملاء', 'Customer-service reports'), tag + ' ' + label + ': the row «تقارير خدمة العملاء»');
      eq(await row.locator('[data-cell="service-reports:export"] input').isChecked(), true, tag + ' ' + label + ': «تصدير» on by default for a sales manager');
      ok((await row.locator('[data-cell="browse:service-reports"]').innerText()).includes('—'), tag + ' ' + label + ': no «استعراض» of its own');
      await row.scrollIntoViewIfNeeded();
      await noSideways(page, tag + ' ' + label + ' (permission table)');
      await shot(page, 'item3-' + label + '-' + tag + '-permission-row');
      await close(page);
    }
  }
  eq(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks, screenshots, syntheticFixtures: true, productionDataUsed: false}));
} finally { await browser?.close(); await app?.stop(); }
