// How the built app feels on a slow phone with production-sized data, in a real Chromium: 2,300 customers and 6,000 visits,
// a 390 px phone whose processor is four times slower than this machine. A manager (who sees every customer) and a representative
// (one region) open the app, switch pages, type in the customer search and open a customer; each step must stay inside a budget
// that the code before 2026-10-29 missed by far (a letter took about 21 s and a page switch about 40 s for the manager). The budgets
// are generous on purpose: they catch a return of the whole-list scans, not normal machine noise. The search must still find the
// right customer. Run `pnpm build` first. Synthetic isolated fixtures only: temporary SQLite, no production data.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require = createRequire(import.meta.url), {chromium} = require('playwright');
const members = [
  {id: 'owner', role: 'admin', name: 'مدير النظام'}, {id: 'sm', role: 'manager', name: 'سعد مدير المبيعات'}, {id: 'sup', role: 'supervisor', sup: 'sm', name: 'ماجد المشرف'},
  {id: 'rep', role: 'rep', sup: 'sup', region: 'eastern', name: 'أحمد المندوب'}, {id: 'rep2', role: 'rep', sup: 'sup', name: 'سالم المندوب'}
];
const CUSTOMERS = 2300, VISITS = 6000, CPU = 4;
// Budgets in milliseconds, on the throttled phone.
const BUDGET = {data: 20000, pageSwitch: 3500, letter: 800, letterP75: 450, sheet: 3500};
const REGIONS = ['الشرقية', 'الغربية', 'الوسطى', 'الجنوبية', 'الشمالية'];
const UNIQUE = 'مصنع الياسمين للطوب الأحمر';
let checks = 0, browser, app;
const errors = [], measured = {};
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const within = (value, budget, message) => { assert.ok(value <= budget, `${message}: ${Math.round(value)} ms > budget ${budget} ms`); checks++; };

try {
  app = await bootBuiltApp({members}, {tls: true});
  browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});

  // ---- fixtures: 2,300 customers in five regions, 6,000 visits spread over them and half a year
  const created = new Date().toISOString(), dayOf = offset => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date(Date.now() + offset * 86400000));
  const insert = "INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,'الرئيسي',?,?,?,1,'fixture')";
  await app.db.exec('BEGIN');
  for (let i = 0; i < CUSTOMERS; i++) {
    const region = REGIONS[i % REGIONS.length], owner = region === 'الشرقية' && i % 2 ? 'rep' : 'rep2';
    const name = i === 1234 ? UNIQUE : `مصنع ${['الأمل', 'النور', 'الخليج', 'الفجر', 'الواحة'][i % 5]} ${i + 1}`;
    await app.db.prepare(insert).bind('c' + i, 'customer', null, owner, JSON.stringify({name, region, city: 'الدمام', phone: '05' + String(10000000 + i), contact: 'م', code: 'C' + i, branch: 'الرئيسي', assignedTo: owner}), created, created).run();
  }
  for (let i = 0; i < VISITS; i++) {
    const customer = (i * 7919) % CUSTOMERS, region = REGIONS[customer % REGIONS.length], owner = region === 'الشرقية' && customer % 2 ? 'rep' : 'rep2', ago = i % 180, at = dayOf(-ago) + 'T07:00:00.000Z';
    await app.db.prepare(insert).bind('v' + i, 'activity', 'c' + customer, owner, JSON.stringify({type: 'visit', date: dayOf(-ago), startedAt: at, endedAt: dayOf(-ago) + 'T07:30:00.000Z', summary: 'تعريف بمنتجات الشركة', result: 'متابعة العميل', salesStage: 'new', strength: 'medium', nextAction: 'زيارة متابعة', nextDate: dayOf(3 - (i % 9)), visitWorkflow: 'customer-v1', visitNumber: i + 1, performedBy: owner}), at, at).run();
  }
  await app.db.exec('COMMIT');

  async function open(memberId, native) {
    const context = await browser.newContext({ignoreHTTPSErrors: true, viewport: {width: 390, height: 844}, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block', geolocation: {latitude: 26.437341, longitude: 50.034499, accuracy: 8}, permissions: ['geolocation']});
    await context.addInitScript(() => {
      window.__long = []; window.__events = [];
      new PerformanceObserver(list => { for (const e of list.getEntries()) window.__long.push([e.startTime, e.duration]); }).observe({type: 'longtask', buffered: true});
      new PerformanceObserver(list => { for (const e of list.getEntries()) window.__events.push([e.name, e.startTime, e.duration]); }).observe({type: 'event', durationThreshold: 16, buffered: true});
    });
    const cookie = await app.login(memberId), [name, ...value] = cookie.split('=');
    await context.addCookies([{name, value: value.join('='), url: app.origin, httpOnly: true, secure: true, sameSite: 'Lax'}]);
    const page = await context.newPage();
    page.setDefaultTimeout(90000);
    page.on('pageerror', error => errors.push(memberId + ': ' + error.message));
    if (native) await installNativeBridge(page, native);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', {rate: CPU});
    return page;
  }
  // Settled: one second without a long task, read from the page's own clock.
  const settled = async page => { for (let i = 0; i < 400; i++) { if (await page.evaluate(() => { const last = window.__long.at(-1); return !last || performance.now() - (last[0] + last[1]) > 1000; })) return; await page.waitForTimeout(250); } throw Error('the page never settled'); };
  const timed = async (page, action) => { const t0 = Date.now(); await action(); await settled(page); return Date.now() - t0 - 1000; };
  const goPhone = async (page, id) => {
    const tab = page.locator('.mobile-tab[data-page="' + id + '"]');
    if (await tab.count()) { await tab.click(); await page.locator('.mobile-tab[data-page="' + id + '"][aria-current="page"]').waitFor(); return; }
    await page.getByRole('button', {name: /^(المزيد من الصفحات|More pages)$/}).click();
    await page.locator('.mobile-overflow-pages [data-page=' + id + ']').click();
    await page.locator('.mobile-navigation-sheet').waitFor({state: 'detached'});
  };

  for (const [memberId, native, label] of [['sm', null, 'manager'], ['rep', {memberId: 'rep', regionScope: 'eastern'}, 'representative']]) {
    const page = await open(memberId, native), result = measured[label] = {};
    // 1. Opening the app until the data is on the screen.
    const t0 = Date.now();
    await page.goto(app.origin + '/');
    await page.waitForFunction(() => !document.querySelector('[data-slot=skeleton]') && document.querySelector('.page-heading h1'));
    result.data = Date.now() - t0;
    within(result.data, BUDGET.data, `${label}: the data appears after opening the app`);
    await settled(page);
    // 2. Switching pages.
    result.pages = {};
    for (const id of ['customer', 'activity', 'followup', 'customer']) {
      const ms = await timed(page, () => goPhone(page, id));
      result.pages[id] = Math.max(result.pages[id] || 0, ms);
      within(ms, BUDGET.pageSwitch, `${label}: switching to ${id}`);
    }
    // 3. Typing in the customer search: every letter appears, and the list ends on the one matching customer.
    const search = page.locator('.workspace input[type=search]:visible').first();
    const s0 = await page.evaluate(() => performance.now());
    await search.click();
    await search.pressSequentially('الياسمين', {delay: 120});
    await settled(page);
    const letters = await page.evaluate(start => window.__events.filter(([name, at]) => at >= start && /key|input/.test(name)).map(([, , duration]) => duration).sort((a, b) => a - b), s0);
    result.letterMax = letters.at(-1) || 0; result.letterP75 = letters[Math.floor(letters.length * .75)] || 0;
    check(await search.inputValue(), 'الياسمين', `${label}: every letter typed reached the field`);
    within(result.letterMax, BUDGET.letter, `${label}: the slowest letter`);
    within(result.letterP75, BUDGET.letterP75, `${label}: three letters in four`);
    // The customer is in the northern region: the manager finds it, the eastern representative does not see it at all.
    const shown = await page.locator('.workspace').getByText(UNIQUE, {exact: true}).locator('visible=true').count();
    check(shown > 0, label === 'manager', `${label}: the search finds exactly what the region allows`);
    // 4. Opening a customer from the list.
    await search.fill('');
    await settled(page);
    // On a phone the list is cards; the customer's name opens the customer.
    const opener = page.locator('.workspace .customer-mobile-name:visible, .workspace button.name-cell:visible').first();
    await opener.waitFor({timeout: 30000}).catch(async () => { if (process.env.YR_GATE_SCREENSHOT_DIR) await page.screenshot({path: process.env.YR_GATE_SCREENSHOT_DIR + '/perf-budget-' + label + '-list.png'}); });
    check(await opener.count(), 1, `${label}: a customer can be opened from the list`);
    {
      const ms = await timed(page, async () => { await opener.click(); await page.locator('.crm-sheet').first().waitFor(); });
      result.sheet = ms;
      within(ms, BUDGET.sheet, `${label}: opening a customer`);
      await page.keyboard.press('Escape');
    }
    await page.context().close();
  }
  check(errors, [], 'no page error');
  console.log(JSON.stringify({ok: true, checks, measured, budget: BUDGET, data: {customers: CUSTOMERS, visits: VISITS, cpuSlowdown: CPU}}));
} finally {
  await browser?.close(); await app?.stop();
}
