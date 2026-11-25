// «تنبيه المصانع القريبة» in the Android app (mobile/android NearbyRules, NearbyCustomers, NearbyApi; the owner, 2026-11-16, item 7 of the
// GSCO comparison list), on a real JVM: the pure rules (NearbyRulesCheck: the 1 km edge, the confirmation, the grouping, once a Riyadh
// day, the cooldown, the list's identity, the requests, the words in Arabic and English), then the real NearbyCustomers compiled against
// Android stand-ins (tests/fixtures/native-nearby: the list asked and asked again before a notice, one grouped notice, a restart, the next
// morning, a revoked session, a muted channel, another member, English), then source guards for what the JVM cannot run (the route
// tracker's hooks, the activity's tap and language, the fixed-origin request, the manifest's permissions, the version). Needs a JDK 17+
// (javac and java on the PATH or under JAVA_HOME). Not an Android device test: no GPS, notification shade, Doze or real server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = process.cwd(), main = path.join(root, 'mobile/android/app/src/main/java/org/yourrest/crm'), checksDir = path.join(root, 'mobile/android/app/src/test/java/org/yourrest/crm');
const fixture = path.join(root, 'tests/fixtures/native-nearby');
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const tool = name => {
  const fromHome = process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin', name);
  if (fromHome && fs.existsSync(fromHome)) return fromHome;
  const found = spawnSync('sh', ['-c', 'command -v ' + name], {encoding: 'utf8'}).stdout.trim();
  if (!found) throw Error('The Android JVM checks need a JDK 17+ (' + name + ' on the PATH or under JAVA_HOME).');
  return found;
};
const javac = tool('javac'), java = tool('java');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-nearby-jvm-'));
process.on('exit', () => fs.rmSync(work, {recursive: true, force: true}));
const run = (command, args) => {
  const result = spawnSync(command, args, {encoding: 'utf8', maxBuffer: 16 << 20, timeout: 180000, env: {...process.env, JAVA_TOOL_OPTIONS: ''}});
  const output = (result.stdout || '') + (result.stderr || '');
  if (result.status !== 0) throw Error(path.basename(command) + ' ' + args.slice(-1)[0] + ' failed:\n' + output);
  return output;
};
const javaFiles = directory => fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? javaFiles(path.join(directory, entry.name)) : entry.name.endsWith('.java') ? [path.join(directory, entry.name)] : []);
const counted = (output, label) => { const match = output.match(/: (\d+) checks passed/); ok(match && Number(match[1]) > 50, label + ' ran: ' + output.trim().split('\n').pop()); return Number(match[1]); };

// ---- 1. The pure rules, compiled with the production RouteRules and ContinuousPolicy.
const rulesOut = path.join(work, 'rules');
fs.mkdirSync(rulesOut);
run(javac, ['--release', '17', '-encoding', 'UTF-8', '-Xlint:all', '-Werror', '-d', rulesOut, ...['RouteRules', 'ContinuousPolicy', 'NearbyRules'].map(name => path.join(main, name + '.java')), path.join(checksDir, 'NearbyRulesCheck.java')]);
const rulesChecks = counted(run(java, ['-cp', rulesOut, 'org.yourrest.crm.NearbyRulesCheck']), 'NearbyRulesCheck');

// ---- 2. The real NearbyCustomers on Android stand-ins.
const glueOut = path.join(work, 'glue');
fs.mkdirSync(glueOut);
run(javac, ['--release', '17', '-encoding', 'UTF-8', '-d', glueOut, ...javaFiles(path.join(fixture, 'stubs')), ...['NearbyCustomers', 'NearbyRules', 'RouteRules', 'ContinuousPolicy'].map(name => path.join(main, name + '.java')), path.join(fixture, 'NearbyCustomersCheck.java')]);
const glueChecks = counted(run(java, ['-cp', glueOut, 'org.yourrest.crm.NearbyCustomersCheck']), 'NearbyCustomersCheck');
ok(!fs.readdirSync(path.join(fixture, 'stubs/org/yourrest/crm')).some(name => ['NearbyCustomers.java', 'NearbyRules.java', 'RouteRules.java', 'ContinuousPolicy.java'].includes(name)), 'the stand-ins never replace the classes under check');

// ---- 3. Source guards for what the JVM cannot run.
const read = file => fs.readFileSync(path.join(main, file), 'utf8');
const tracker = read('ContinuousRouteTracker.java'), activity = read('MainActivity.java'), api = read('NearbyApi.java'), glue = read('NearbyCustomers.java'), service = read('RouteLocationService.java');
// The route tracker feeds the fix it has just stored (after its own checks), and never lets the notice hold the tracking.
const onFix = tracker.slice(tracker.indexOf('void onFix(Location value)'), tracker.indexOf('private JSONObject ensureDay'));
ok(onFix.indexOf('store.point(') > 0 && onFix.indexOf('nearbyMember=store.get("memberId")') > onFix.indexOf('store.point(') && onFix.indexOf('NearbyCustomers.get(context).onFix(fix,nearbyMember,nearbyScope)') > onFix.indexOf('nearbyMember=store.get("memberId")'), 'the tracker hands over only a fix it stored');
ok(onFix.indexOf('if(!collectionAuthorized())') < onFix.indexOf('store.point(') && onFix.indexOf('if(!canResume())') < onFix.indexOf('store.point('), 'after its consent, permission and authorization checks');
ok(/try\s*\{[\s\S]*\}\s*catch\s*\(RuntimeException ignored\)/.test(glue.slice(glue.indexOf('synchronized void onFix'), glue.indexOf('synchronized boolean busy'))), 'a fault in the notice never throws to the tracker');
ok(/private void disable\(boolean clear\)\{[^\n]*NearbyCustomers\.get\(context\)\.clear\(\);/.test(tracker), 'logout, a revoked account or a scope change (disable) forgets the list and takes the notices away');
ok(/void windowPaused\(\)\{NearbyCustomers\.get\(context\)\.suspend\(\);/.test(tracker) && /void serviceDestroyed\(\)\{NearbyCustomers\.get\(context\)\.suspend\(\);/.test(tracker), 'the hours ending or the service stopping pause it');
ok(!/requestLocationUpdates|requestPermissions|startForegroundService/.test(glue + api), 'it starts no GPS, asks no permission and starts no service');
ok(!/NearbyCustomers/.test(service), 'the location service is unchanged: the notice rides on the tracker');
// The request: one fixed address, no redirect, the session cookie only in its header, a bounded answer.
ok(api.includes('new URL(RouteRules.ORIGIN + NearbyRules.PATH)') && api.includes('setInstanceFollowRedirects(false)') && api.includes('setRequestProperty("Cookie", cookie)') && api.includes('MAX_BYTES'), 'GET /api/nearby-customers on the CRM origin only, without redirects, bounded');
ok(!/Log\.|printStackTrace|System\.out/.test(api + glue), 'nothing is logged');
// The tap: a cold start loads «#nearby=<id>», a running page is told by an event (never replacing unsaved work).
ok(activity.includes('NearbyCustomers.requestedCustomer(getIntent())') && activity.includes('NearbyRules.openFragment(nearby)'), 'a cold start opens the page on the customer');
ok(activity.includes("'yourrest:open-nearby-customer'") && activity.includes('JSONObject.quote(nearby)'), 'a running page is told by an event, the id quoted');
ok(activity.includes('getIntent().removeExtra(NearbyCustomers.EXTRA)') && activity.includes('intent.removeExtra(NearbyCustomers.EXTRA)'), 'the id is used once');
// The language of the notices: the page's own choice, read from the trusted page only.
ok(/private void rememberLanguage\(\)\{\s*if\(web==null\|\|!RouteRules\.trusted\(web\.getUrl\(\)\)\)return;/.test(activity) && activity.includes("localStorage.getItem('yr-language')") && activity.includes('NearbyRules.pageLanguage(value)'), 'the language is read from the trusted page');
ok(activity.includes('installBridge();CookieManager.getInstance().flush();rememberLanguage();') && activity.includes('protected void onPause(){rememberLanguage();'), 'on every page load and when the app goes to the background');
// No new permission: the same list as 1.0.12; a new version for the update.
const manifest = fs.readFileSync(path.join(root, 'mobile/android/app/src/main/AndroidManifest.xml'), 'utf8');
eq([...manifest.matchAll(/uses-permission android:name="android\.permission\.([A-Z_]+)"/g)].map(match => match[1]).sort(),
  ['ACCESS_BACKGROUND_LOCATION', 'ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'ACCESS_NETWORK_STATE', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION', 'INTERNET', 'POST_NOTIFICATIONS', 'RECEIVE_BOOT_COMPLETED', 'REQUEST_INSTALL_PACKAGES'], 'no permission is added');
const gradle = fs.readFileSync(path.join(root, 'mobile/android/app/build.gradle'), 'utf8');
eq([gradle.match(/versionCode\s+(\d+)/)?.[1], gradle.match(/versionName\s+'([^']+)'/)?.[1]], ['17', '1.0.16'], 'the app is 1.0.16 (17): 1.0.13 brought the notice, 1.0.14 the complaint alerts, 1.0.15 the failure panel and the camera, 1.0.16 a region change that no longer stops tracking');
// The page opens what the tap names: «#nearby=<id>» and the event (app/crm-app.tsx).
const page = fs.readFileSync(path.join(root, 'app/crm-app.tsx'), 'utf8');
ok(page.includes("window.addEventListener('yourrest:open-nearby-customer',open)") && page.includes('/^nearby=([A-Za-z0-9_-]{1,200})$/'), 'the page handles the event and the address');
ok(/const openNearby=useCallback\(\(id:string\)=>\{[\s\S]{0,400}if\(editorOpenRef\.current\)\{toast\.info/.test(page), 'a screen with unsaved work is never replaced');

console.log(`nearby customers android checks passed: ${checks} (NearbyRulesCheck ${rulesChecks}, NearbyCustomersCheck ${glueChecks})`);
