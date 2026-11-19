// The probe the Android app 1.0.15 asks a page with (LoadFailureRules.PROBE: does the page show anything yet?), run in a real Chromium on
// the site's own offline pages served from public/ and on made-up pages: the offline page and the offline shell drawn by its script come
// up; the offline shell whose script cannot run (its module refused, as on an engine too old for it) stays blank, which is what makes the
// app's watchdog show its panel; an empty body, a body with only <noscript>, hidden text and a script that fails are blank; a picture with
// a size is up; a page still being parsed waits, then comes up. No build: the pages are public/'s. Needs Playwright with Chromium
// (YR_BROWSER_EXECUTABLE to name a browser) and a JDK 17+ (the probe is read from the app's own class). Not a WebView: the same engine
// family, not Huawei's or an old one.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';

const root = process.cwd();
const require = createRequire(import.meta.url), {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

// The probe exactly as the app sends it.
const tool = name => {
  const fromHome = process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin', name);
  if (fromHome && fs.existsSync(fromHome)) return fromHome;
  const found = spawnSync('sh', ['-c', 'command -v ' + name], {encoding: 'utf8'}).stdout.trim();
  if (!found) throw Error('This test reads the probe from the app\'s class: it needs a JDK 17+ (' + name + ').');
  return found;
};
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-probe-browser-'));
const main = path.join(root, 'mobile/android/app/src/main/java/org/yourrest/crm');
const javaRun = (command, args) => { const result = spawnSync(tool(command), args, {cwd: root, encoding: 'utf8', env: {...process.env, JAVA_TOOL_OPTIONS: ''}}); if (result.status !== 0) throw Error(command + ' failed: ' + result.stdout + result.stderr); return result.stdout; };
javaRun('javac', ['--release', '17', '-encoding', 'UTF-8', '-d', work, ...['LoadFailureRules', 'LoadWatch', 'RouteRules'].map(name => path.join(main, name + '.java')), path.join(root, 'mobile/android/app/src/test/java/org/yourrest/crm/LoadFailureRulesCheck.java')]);
const appProbe = javaRun('java', ['-cp', work, 'org.yourrest.crm.LoadFailureRulesCheck', '--print-probe']);
ok(appProbe.startsWith("(function(){try{if(location.origin!=='https://crm.yourrest.org')return 'elsewhere';"), 'the app\'s probe read from LoadFailureRules');

// public/ as the site serves it, and the made-up pages.
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2'};
const made = {
  '/t/text': '<!doctype html><html lang="ar" dir="rtl"><body><p>يورست للصناعات</p></body></html>',
  '/t/blank': '<!doctype html><html><body></body></html>',
  '/t/noscript': '<!doctype html><html><body><div id="root"></div><noscript>يحتاج التطبيق تشغيل JavaScript. / JavaScript is required.</noscript></body></html>',
  '/t/hidden': '<!doctype html><html><body><p style="display:none">مخفي</p><div style="visibility:hidden">hidden</div></body></html>',
  '/t/image': '<!doctype html><html><body><img src="/yourrest-logo.png" width="120" height="40" alt=""></body></html>',
  '/t/broken': '<!doctype html><html><body><div id="app"></div><script>const a = ;</script></body></html>',
};
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (made[url.pathname]) { response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'}); response.end(made[url.pathname]); return; }
  if (url.pathname === '/t/slow') {
    response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    response.write('<!doctype html><html><head><title>slow</title></head><body>' + ' '.repeat(2048));
    setTimeout(() => response.end('<p>Yourrest</p></body></html>'), 2500);
    return;
  }
  const file = path.join(root, 'public', path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(path.join(root, 'public') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404, {'Content-Type': 'text/plain'}); response.end('not found'); return; }
  response.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'});
  fs.createReadStream(file).pipe(response);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
// The same probe for this test's origin (LoadFailureRules.probeFor), and the app's own for crm.yourrest.org.
const probe = javaRun('java', ['-cp', work, 'org.yourrest.crm.LoadFailureRulesCheck', '--print-probe', origin]);
eq(probe, appProbe.replace("'https://crm.yourrest.org'", "'" + origin + "'"), 'the probe differs from the app\'s by its origin only');

const browser = await chromium.launch({headless: true, ...(process.env.YR_BROWSER_EXECUTABLE ? {executablePath: process.env.YR_BROWSER_EXECUTABLE} : {}), args: ['--no-sandbox']});
// Asked again when a navigation replaced the document meanwhile (Chromium's error page commits after the failed load).
const ask = async (page, code = probe) => {
  for (let attempt = 0; ; attempt++) {
    try { return await page.evaluate(text => (0, eval)(text), code); }
    catch (error) { if (attempt >= 10 || !/context was destroyed|navigat/i.test(String(error && error.message))) throw error; await new Promise(resolve => setTimeout(resolve, 200)); }
  }
};
const settle = async (page, expected, ms) => { const until = Date.now() + ms; let last; while (Date.now() < until) { last = await ask(page); if (last === expected) return last; await page.waitForTimeout(200); } return last; };
try {
  const context = await browser.newContext({viewport: {width: 360, height: 800}, isMobile: true, hasTouch: true, serviceWorkers: 'block'});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));

  await page.goto(origin + '/t/text'); eq(await ask(page), 'up', 'Arabic text: up');
  eq(await ask(page, appProbe), 'elsewhere', 'the app\'s probe on a document that is not the CRM\'s: elsewhere');
  await page.goto('about:blank'); eq(await ask(page), 'elsewhere', 'a blank page shown while the next one loads: elsewhere');
  await page.goto('http://127.0.0.1:9/').catch(() => {});
  await page.waitForLoadState('load').catch(() => {});
  ok(!(await page.evaluate(() => location.origin).catch(() => '')).startsWith('http'), 'Chromium shows its own error page for the refused connection');
  eq(await ask(page), 'elsewhere', 'Chromium\'s own error page for a refused connection (it has text): elsewhere, never up');
  await page.goto(origin + '/t/blank'); eq(await ask(page), 'blank', 'an empty body: blank');
  await page.goto(origin + '/t/noscript'); eq(await ask(page), 'blank', 'only <noscript> (hidden while scripts run) and an empty root: blank');
  await page.goto(origin + '/t/hidden'); eq(await ask(page), 'blank', 'hidden text is not content');
  await page.goto(origin + '/t/image'); eq(await ask(page), 'up', 'a picture with a size: up');
  await page.goto(origin + '/t/broken'); eq(await ask(page), 'blank', 'a page whose script fails and draws nothing: blank');
  ok(errors.some(error => /SyntaxError/.test(error)), 'the made-up script did fail');

  // A page still being parsed: wait, then up when its text arrives.
  const navigation = page.goto(origin + '/t/slow', {waitUntil: 'commit'});
  await navigation;
  await page.waitForTimeout(600);
  eq(await ask(page), 'wait', 'a body still being parsed, nothing in it yet: wait');
  eq(await settle(page, 'up', 6000), 'up', 'then its text arrives: up');

  // The site's own offline pages (public/).
  await page.goto(origin + '/offline.html'); eq(await ask(page), 'up', 'the site\'s offline page: up');
  await page.goto(origin + '/offline-app.html');
  eq(await settle(page, 'up', 15000), 'up', 'the site\'s offline shell, drawn by its own script: up');
  const shellText = (await page.evaluate(() => document.body.innerText)).trim();
  ok(shellText.length > 0, 'the shell shows text: ' + shellText.slice(0, 60).replace(/\s+/g, ' '));

  // The same shell when its script cannot run (the module refused, as on an engine that cannot run it): it stays blank.
  const refused = await browser.newContext({viewport: {width: 360, height: 800}, isMobile: true, hasTouch: true, serviceWorkers: 'block'});
  const stuck = await refused.newPage();
  await stuck.route('**/offline-app/assets/*.js', route => route.abort());
  await stuck.goto(origin + '/offline-app.html');
  await stuck.waitForTimeout(2500);
  eq(await ask(stuck), 'blank', 'the offline shell without its script: blank, so the app\'s watchdog would show its panel');
  eq(await stuck.evaluate(() => document.querySelector('#yourrest-offline-app').childElementCount), 0, 'its root stayed empty');
  await refused.close();

  // The probe reads nothing and changes nothing.
  await page.goto(origin + '/t/text');
  const before = await page.evaluate(() => document.documentElement.outerHTML);
  await ask(page); await ask(page);
  eq(await page.evaluate(() => document.documentElement.outerHTML), before, 'asking twice leaves the page as it was');
  await context.close();
} finally {
  await browser.close();
  server.close();
  fs.rmSync(work, {recursive: true, force: true});
}
console.log(`webview load probe browser checks passed: ${checks} (Chromium, public/ offline pages and made-up pages; not a WebView)`);
