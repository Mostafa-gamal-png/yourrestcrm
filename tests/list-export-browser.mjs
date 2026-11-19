// «تصدير Excel» from every page that shows a list (the owner, 2026-11-19, GSCO 2.13.80; lib/list-export.ts, app/export-excel-button.tsx)
// in a real Chromium against the BUILT release (run the build first): every button, on its page, for a member who may export it, at a
// phone 320 and 360, a tablet upright and on its side, and a computer: the button is on the screen and nothing scrolls sideways, a tap
// gives a file named Yourrest-<page>-<day>.xlsx that the project's own reader opens with the page's columns; in English the button and
// the file's headers are English; a representative sees none (and their CSV no more than before); a member whose cell is switched off
// sees none on that page. The CSV beside it on the pages that had one still downloads. Screenshots for the report. Synthetic fixtures only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const root = process.cwd();
fs.mkdirSync(path.join(root, '.sites-runtime'), {recursive: true});
const out = fs.mkdtempSync(path.join(root, '.sites-runtime', 'list-export-browser-'));
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}');
fs.writeFileSync(path.join(out, 'erp-sales.mjs'), ts.transpileModule(fs.readFileSync(path.join(root, 'lib/erp-sales.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText);
const E = await import(pathToFileURL(path.join(out, 'erp-sales.mjs')));

const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'mgr', role: 'manager', name: 'مدير المبيعات'}, {id: 'mgrx', role: 'manager', name: 'مدير بلا تصدير'},
  {id: 'sup', role: 'supervisor', sup: 'mgr', name: 'المشرف'}, {id: 'rep', role: 'rep', sup: 'sup', name: 'المندوب أحمد'},
  {id: 'csm', role: 'customer_service_manager', sup: 'mgr', name: 'مدير خدمة العملاء'}, {id: 'cs', role: 'customer_service', sup: 'csm', name: 'ممثلة الخدمة'}
];
const screenshots = process.env.YR_GATE_SCREENSHOT_DIR ? path.resolve(process.env.YR_GATE_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-list-export-shots-'));
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
  const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date());
  const insert = (id, kind, parent, assigned, data, when = earlier) => app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,'الرئيسي',?,?,?,1,'fixture')").bind(id, kind, parent, assigned, JSON.stringify(data), when, when).run();
  const customer = (id, name) => insert(id, 'customer', null, 'rep', {name, branch: 'الرئيسي', assignedTo: 'rep', region: 'الوسطى', city: 'الرياض', customerStatus: 'نشط', phone: '0551234567', contact: 'م', code: 'ERP-' + id, location: '24.7136000, 46.6753000', latitude: 24.7136, longitude: 46.6753});
  await customer('k1', 'مصنع النور'); await customer('k2', 'مصنع الريان'); await customer('k3', 'مصنع القمة');
  // A visit with a competitor, a follow-up planned for tomorrow.
  await insert('v1', 'activity', 'k1', 'rep', {type: 'visit', date: day, summary: 'زيارة', result: 'إيجابية', notes: '=1+1', salesStage: 'negotiation', strength: 'strong', nextDate: day, nextAction: 'إرسال العرض', performedBy: 'rep', responsibleId: 'rep', recordedByEmail: 'rep@yourrest.org', startedAt: earlier, endedAt: earlier, hasCompetitor: true, competitorName: 'منافس الشرق', competitorNotes: 'سعره أقل', visitNumber: 41}, earlier);
  await insert('f1', 'activity', 'k2', 'rep', {visitWorkflow: 'followup-v1', type: 'call', date: day, result: 'طلب العميل عرضًا', salesStage: 'negotiation', nextDate: day, nextAction: 'الاتصال مرة أخرى', performedBy: 'rep', responsibleId: 'rep', recordedByEmail: 'rep@yourrest.org'}, now);
  // An opportunity customer service handed to sales (the tracking board), a lost one (the opportunity sources).
  const kase = (id, customerId, data = {}) => app.db.prepare('INSERT INTO crm_service_cases(id,customer_id,status,creator_id,service_manager_id,sales_manager_id,assigned_to,supervisor_id,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,2,?)')
    .bind(id, customerId, 'assigned', 'cs', 'csm', 'mgr', 'rep', 'sup', JSON.stringify({source: 'call', products: ['خدمات صيانة'], strength: 'strong', needs: 'تحديد موعد', nextAction: 'زيارة', nextDate: '2030-01-01', participants: ['cs', 'csm'], approvedAt: earlier, assignedAt: earlier, registration: {type: 'call', visitNumber: 77}, ...data}), earlier, earlier, 'fixture').run();
  await kase('case-open', 'k1');
  await kase('case-lost', 'k3');
  await insert('k-lost', 'activity', 'k3', 'rep', {type: 'call', date: day, result: 'رفض', salesStage: 'lost', lossReason: 'السعر أعلى من المنافس', serviceCaseId: 'case-lost', performedBy: 'rep', responsibleId: 'rep', recordedByEmail: 'rep@yourrest.org'}, now);
  // A complaint and an assistance request, both of the first team.
  await insert('complaint-1', 'complaint', null, 'cs', {kind: 'complaint', customerId: 'k2', complaintNumber: 12, status: 'assigned', registrarId: 'cs', serviceManagerId: 'csm', salesManagerId: 'mgr', supervisorId: 'sup', assigneeId: 'rep', channel: 'call', category: 'product_quality', severity: 'high', description: 'العميل يشتكي من تشقق القوالب', demand: 'استبدال القالب', reference: '', contactName: 'م', contactPhone: '0551234567', submittedAt: earlier, forwardedAt: earlier, returnedAt: '', assignedAt: earlier, delegatedAt: '', updates: [], notes: [], events: []});
  await insert('support-1', 'support', null, 'rep', {kind: 'support', customerId: 'k1', origin: 'rep', status: 'open', requestedBy: 'rep', requestedAt: earlier, repId: 'rep', note: 'العميل لا يرد', channel: 'any', handlerId: '', handlerAt: '', handlerBy: '', events: [{at: earlier, by: 'rep', action: 'request', text: 'العميل لا يرد'}]});
  // A sale of the month, a mold request, the representative's route today.
  await app.db.prepare("INSERT INTO crm_sales(id,customer_id,rep_id,branch,date,reference,reference_key,data,total_cents,status,void_reason,version,mutation_id,create_fingerprint,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'confirmed','',1,?,?,?,?,?)")
    .bind('sale-1', 'k1', 'rep', 'الرئيسي', day, 'INV-501', 'inv-501', JSON.stringify({customerId: 'k1', repId: 'rep', date: day, reference: 'INV-501', items: [{product: 'قوالب البلوك المتحركة', quantity: 2, unitPrice: 6250, description: ''}], discount: 0, notes: ''}), 1250000, 'm1', 'f1', 'owner', now, now).run();
  await app.db.prepare('INSERT INTO crm_mold_requests(id,member_id,customer_id,data,accepted,cancelled_at,cancel_reason,outbox,next_attempt_at,remote,remote_at,created_by,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)')
    .bind('mr-1', 'rep', 'k1', JSON.stringify({requestedAt: earlier, customer: {crmNumber: 1, name: 'مصنع النور', address: 'حي الصناعية', city: 'الرياض'}, salesman: {crmMemberId: 'rep', name: 'المندوب أحمد', email: 'rep@yourrest.org'}, specs: {description: 'قالب بلوك 20 سم', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: 'M-1', quantity: 1, designUrl: '', notes: ''}, payment: 'cash'}), null, null, '', 'send', now, null, null, 'rep', earlier, earlier).run();
  await app.db.prepare('INSERT INTO crm_journey_stops(id,member_id,date,customer_id,region_scope,snapshot,selected_at,closed_at,state,data,version) VALUES(?,?,?,?,?,?,?,?,?,?,1)')
    .bind('stop-1', 'rep', day, 'k1', 'all', JSON.stringify({customerName: 'مصنع النور', region: 'الوسطى', latitude: 24.7136, longitude: 46.6753}), now, null, 'en_route', JSON.stringify({arrivalAt: null, departureAt: null, durationSeconds: null, durationUncertain: false, observedSeconds: 0, gaps: [], events: [{type: 'selected', at: now}]})).run();
  // Every export closed for mgrx.
  const off = Object.fromEntries(['customer', 'activity', 'followup', 'mold-requests', 'journeys', 'sales', 'targets', 'competitors'].map(screen => [screen + ':export', false]));
  await app.db.prepare('INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_at,updated_by) VALUES(?,?,?,1,?,?)').bind('mgrx', JSON.stringify(off), '[]', now, 'owner').run();

  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1', '--disable-dev-shm-usage']});
  const cookies = {};
  for (const member of members) cookies[member.id] = await app.login(member.id);
  async function open(memberId, {english = false, viewport, touch = false, address = '/', native = false}) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: touch, isMobile: touch && viewport.width < 700, acceptDownloads: true});
    const [name, ...value] = cookies[memberId].split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    if (english) await context.addInitScript(() => { try { localStorage.setItem('yr-language', 'en'); } catch { /* storage unavailable */ } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(memberId + ' ' + address + ': ' + error.message));
    if (native) await installNativeBridge(page, {memberId, regionScope: 'all'});
    await page.goto(app.origin + address);
    if (english) await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('.topbar').waitFor();
    return page;
  }
  const noSideways = async (page, label) => eq(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no horizontal scrolling');
  /** The pages: who opens them, where, what to do first, the file's name and the first header of its first sheet. */
  const PAGES = [
    {page: 'customers', who: 'owner', address: '/#customer', file: 'customers', header: ['كود يورست', 'Yourrest code']},
    {page: 'visits', who: 'owner', address: '/#activity', file: 'visits', header: ['رقم الزيارة', 'Visit number']},
    {page: 'support', who: 'owner', address: '/#activity', file: 'customer-contact', header: ['المرجع', 'Reference']},
    {page: 'complaints', who: 'mgr', address: '/#activity', file: 'complaints', header: ['رقم الشكوى', 'Complaint number']},
    {page: 'complaints', who: 'csm', address: '/#complaints', file: 'complaints', header: ['رقم الشكوى', 'Complaint number']},
    {page: 'service-board', who: 'cs', address: '/#activity', file: 'service-tracking', header: ['النوع', 'Kind']},
    {page: 'service-leads', who: 'cs', address: '/#activity', file: 'opportunity-sources', header: ['رقم الفرصة', 'Opportunity number'], before: async page => { await page.locator('details[data-service-leads] > summary').click(); }},
    {page: 'service-kpi', who: 'csm', address: '/#service-kpi', file: 'service-evaluation', header: ['الفريق', 'Team']},
    {page: 'followups', who: 'owner', address: '/#followup', file: 'followups', header: ['العميل', 'Customer']},
    {page: 'mold-requests', who: 'owner', address: '/#mold-requests', file: 'mold-requests', header: ['رقم أمر الإنتاج', 'Production order']},
    {page: 'journeys', who: 'sup', address: '/#journeys', file: 'day-report', header: ['اليوم', 'Day'], before: async page => { const pick = page.locator('.journey-toolbar select'); await page.waitForFunction(() => document.querySelector('.journey-toolbar select option[value="rep"]')); await pick.selectOption('rep'); await page.locator('.journey-stop').first().waitFor(); }},
    {page: 'sales', who: 'owner', address: '/#sales', file: 'sales', header: ['تاريخ البيع', 'Sale date']},
    {page: 'kpis', who: 'mgr', address: '/?tab=results#targets', file: 'performance-results', header: ['الشهر', 'Month']},
    {page: 'collection', who: 'mgr', address: '/?tab=collection#targets', file: 'collection', header: ['المندوب', 'Representative']},
    {page: 'quotations', who: 'mgr', address: '/?tab=quotes#targets', file: 'quotations', header: ['المندوب', 'Representative']},
    {page: 'targets', who: 'mgr', address: '/?tab=targets#targets', file: 'targets', header: ['الشهر', 'Month']},
    {page: 'competitors', who: 'owner', address: '/#competitors', file: 'competitors', header: ['المنافس', 'Competitor']},
    {page: 'team', who: 'owner', address: '/#team', file: 'team', header: ['المستخدم', 'User']},
  ];
  const fileName = new RegExp('^Yourrest-([a-z-]+)-(\\d{4}-\\d{2}(?:-\\d{2})?)\\.xlsx$');
  const seenPages = new Set();
  for (const [label, viewport, touch] of SIZES) for (const item of PAGES) {
    // Every page at every size in Arabic; in English at the phone of 320 and the computer.
    for (const english of label === 'phone-320' || label === 'desktop' ? [false, true] : [false]) {
      const tag = label + '-' + (english ? 'en' : 'ar') + ' ' + item.page + ' (' + item.who + ')';
      const page = await open(item.who, {english, viewport, touch, address: item.address});
      if (item.before) await item.before(page);
      const button = page.locator('[data-list-export="' + item.page + '"] button');
      await button.waitFor();
      await page.waitForFunction(selector => !document.querySelector(selector)?.disabled, '[data-list-export="' + item.page + '"] button');
      await button.scrollIntoViewIfNeeded();
      eq((await button.innerText()).trim(), english ? 'Export to Excel' : 'تصدير Excel', tag + ': the button');
      const box = await button.boundingBox();
      ok(box && box.x >= 0 && box.x + box.width <= viewport.width + 1 && box.height >= 36, tag + ': on the screen and easy to tap (' + JSON.stringify(box) + ')');
      await noSideways(page, tag);
      const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
      const match = fileName.exec(download.suggestedFilename());
      ok(match && match[1] === item.file, tag + ': the file is named for its page: ' + download.suggestedFilename());
      const bytes = fs.readFileSync(await download.path()), book = E.readWorkbookSheets(bytes);
      ok(bytes[0] === 0x50 && bytes[1] === 0x4b && book.length >= 1, tag + ': a workbook');
      eq(book[0].rows[0].cells[0], english ? item.header[1] : item.header[0], tag + ': its first column, in the page\'s language');
      if (english) ok(book.every(sheet => !ARABIC.test(sheet.name) && sheet.rows[0].cells.every(cell => !ARABIC.test(cell))), tag + ': English sheet names and headers');
      ok(book[0].rows.length >= 2, tag + ': with the page\'s rows (' + (book[0].rows.length - 1) + ')');
      await noSideways(page, tag + ' after the export');
      if (!seenPages.has(item.page + label)) { seenPages.add(item.page + label); if (label.startsWith('phone-320') || label === 'desktop') await page.screenshot({path: path.join(screenshots, 'list-export-' + label + '-' + item.page + '.png')}); }
      await page.context().close();
    }
  }
  // The CSV the pages had keeps downloading beside it.
  for (const [address, name] of [['/#customer', /^YourRest-customers-\d{4}-\d{2}-\d{2}\.csv$/], ['/#activity', /^YourRest-visits-\d{4}-\d{2}-\d{2}\.csv$/], ['/#sales', /^Yourrest-sales-\d{4}-\d{2}\.csv$/]]) {
    const page = await open('owner', {viewport: SIZES.at(-1)[1], address});
    const csv = page.getByRole('button', {name: 'تصدير CSV'});
    await csv.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'تصدير CSV' && !button.disabled));
    const [download] = await Promise.all([page.waitForEvent('download'), csv.click()]);
    ok(name.test(download.suggestedFilename()), address + ': the CSV still downloads: ' + download.suggestedFilename());
    await page.context().close();
  }
  // Nobody sees what they may not export: a representative anywhere, a sales manager whose cells are off.
  for (const [who, address] of [['rep', '/#customer'], ['rep', '/#followup'], ['rep', '/#activity'], ['rep', '/#mold-requests'], ['mgrx', '/#customer'], ['mgrx', '/#activity'], ['mgrx', '/#followup'], ['mgrx', '/#sales'], ['mgrx', '/?tab=results#targets'], ['mgrx', '/#competitors'], ['mgrx', '/#mold-requests'], ['mgrx', '/#journeys']]) {
    const page = await open(who, {viewport: SIZES[0][1], touch: true, address, native: who === 'rep'});
    await page.waitForTimeout(1200);
    eq(await page.locator('[data-list-export]').count(), 0, who + ' ' + address + ': no «تصدير Excel»');
    await page.context().close();
  }
  eq(errors, [], 'no error on any page');
  console.log(JSON.stringify({ok: true, checks, screenshots, realBrowser: true, productionDataUsed: false}));
} finally {
  await browser?.close();
  await app?.stop();
}
