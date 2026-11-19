// «شكوى تنتظرك» and the background alert check in the Android app (mobile/android ComplaintAlertRules, ComplaintAlertFeed, ComplaintAlerts,
// ComplaintAlertApi, AlertJobRules, AlertCheckJob; the owner, 2026-11-16, item 3 of the GSCO list), on a real JVM: the pure rules
// (ComplaintAlertRulesCheck: the window 06:00 to 18:00 Riyadh and Friday at their edges, the fifteen-minute period, the ten-minute
// cadence, which rows notify and which go, high importance first, the words in Arabic and English, the deep link), then the real
// ComplaintAlerts, ComplaintAlertFeed and AlertCheckJob compiled against Android stand-ins (tests/fixtures/native-complaints), then the
// existing ServiceAlertCheck (ServiceAlerts changed: it now reports when a background check is done), then source guards for what the
// JVM cannot run (the activity's tap, language and sign-out, the tracking service, the manifest's job service and permissions, the version,
// the release notes). With ANDROID_ALL_JAR naming the pinned framework jar (android-all-15-robolectric-12650502.jar, the one
// tools/build-oss.py uses), the whole main source is also compiled against it. Needs a JDK 17+. Not an Android device test: no
// notification shade, Doze, JobScheduler or real server; the APK is built on GitHub.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = process.cwd(), main = path.join(root, 'mobile/android/app/src/main/java/org/yourrest/crm'), checksDir = path.join(root, 'mobile/android/app/src/test/java/org/yourrest/crm');
const fixture = path.join(root, 'tests/fixtures/native-complaints');
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
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-complaints-jvm-'));
process.on('exit', () => fs.rmSync(work, {recursive: true, force: true}));
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, {cwd, encoding: 'utf8', maxBuffer: 16 << 20, timeout: 180000, env: {...process.env, JAVA_TOOL_OPTIONS: ''}});
  const output = (result.stdout || '') + (result.stderr || '');
  if (result.status !== 0) throw Error(path.basename(command) + ' ' + args.slice(-1)[0] + ' failed:\n' + output);
  return output;
};
const javaFiles = directory => fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? javaFiles(path.join(directory, entry.name)) : entry.name.endsWith('.java') ? [path.join(directory, entry.name)] : []);
const counted = (output, label, least) => { const match = output.match(/: (\d+) checks passed/); ok(match && Number(match[1]) >= least, label + ' ran: ' + output.trim().split('\n').pop()); return Number(match[1]); };
const source = name => path.join(main, name + '.java');

// ---- 1. The pure rules, with the production RouteRules, ContinuousPolicy and ServiceAlertPolicy.
const rulesOut = path.join(work, 'rules');
fs.mkdirSync(rulesOut);
run(javac, ['--release', '17', '-encoding', 'UTF-8', '-Xlint:all', '-Werror', '-d', rulesOut, ...['ComplaintAlertRules', 'AlertJobRules', 'RouteRules', 'ContinuousPolicy', 'ServiceAlertPolicy'].map(source), path.join(checksDir, 'ComplaintAlertRulesCheck.java')]);
const rulesChecks = counted(run(java, ['-cp', rulesOut, 'org.yourrest.crm.ComplaintAlertRulesCheck']), 'ComplaintAlertRulesCheck', 60);

// ---- 2. The real ComplaintAlerts, ComplaintAlertFeed and AlertCheckJob on Android stand-ins.
const underCheck = ['ComplaintAlerts', 'ComplaintAlertRules', 'ComplaintAlertFeed', 'ComplaintAlertApi', 'ServiceAlertApi', 'AlertCheckJob', 'AlertJobRules', 'RouteRules', 'ContinuousPolicy', 'NearbyRules'];
const glueOut = path.join(work, 'glue');
fs.mkdirSync(glueOut);
run(javac, ['--release', '17', '-encoding', 'UTF-8', '-d', glueOut, ...javaFiles(path.join(fixture, 'stubs')), ...underCheck.map(source), path.join(fixture, 'ComplaintAlertsCheck.java')]);
const glueChecks = counted(run(java, ['-cp', glueOut, 'org.yourrest.crm.ComplaintAlertsCheck']), 'ComplaintAlertsCheck', 50);
ok(!fs.readdirSync(path.join(fixture, 'stubs/org/yourrest/crm')).some(name => underCheck.includes(name.replace(/\.java$/, ''))), 'the stand-ins never replace the classes under check');

// ---- 3. The service-request alerts' own check (ServiceAlerts changed).
const serviceOut = path.join(work, 'service');
fs.mkdirSync(serviceOut);
run(javac, ['--release', '17', '-encoding', 'UTF-8', '-d', serviceOut, ...['ServiceAlertPolicy', 'RouteRules', 'ContinuousPolicy', 'NearbyRules'].map(source), path.join(checksDir, 'ServiceAlertCheck.java')]);
const serviceChecks = counted(run(java, ['-cp', serviceOut, 'org.yourrest.crm.ServiceAlertCheck']), 'ServiceAlertCheck', 70);

// ---- 4. Optional: the whole main source against the pinned Android 35 framework jar (with a stub R).
let frameworkCompiled = false;
const framework = process.env.ANDROID_ALL_JAR;
if (framework && fs.existsSync(framework)) {
  const gen = path.join(work, 'gen/org/yourrest/crm'), out = path.join(work, 'framework');
  fs.mkdirSync(gen, {recursive: true}); fs.mkdirSync(out);
  fs.writeFileSync(path.join(gen, 'R.java'), 'package org.yourrest.crm;\npublic final class R { public static final class drawable { public static final int ic_location=1, ic_service_request=2; } }\n');
  const output = run(javac, ['--release', '17', '-encoding', 'UTF-8', '-Xlint:all', '-cp', framework, '-d', out, ...javaFiles(path.join(root, 'mobile/android/app/src/main/java')), path.join(gen, 'R.java')]);
  ok(!/(ComplaintAlert|AlertCheckJob|AlertJobRules)\w*\.java:\d+: warning/.test(output), 'the new classes compile against the framework without a warning');
  frameworkCompiled = true;
}

// ---- 5. Source guards for what the JVM cannot run.
const read = file => fs.readFileSync(path.join(main, file), 'utf8');
const activity = read('MainActivity.java'), service = read('RouteLocationService.java'), api = read('ComplaintAlertApi.java'), glue = read('ComplaintAlerts.java'), job = read('AlertCheckJob.java');
// The app asks when it opens; the tracking service asks on its heartbeat; the job is scheduled on opening and on a CRM page with a session.
ok(/protected void onResume\(\)\{super\.onResume\(\);resumed=true;ServiceAlerts\.poll\(this,true\);ComplaintAlerts\.get\(this\)\.pollNow\(\);AlertCheckJob\.schedule\(this\);/.test(activity), 'opening or returning to the app asks and schedules the background check');
ok(activity.includes('rememberLanguage();if(AlertCheckJob.signedIn())AlertCheckJob.schedule(MainActivity.this);'), 'a trusted CRM page with a session schedules it too (after signing in)');
ok(service.includes('ServiceAlerts.poll(RouteLocationService.this,false);ComplaintAlerts.get(RouteLocationService.this).pollIfDue();'), 'the tracking service asks on its own heartbeat');
// Signing out (the bridge, or the page's own request) takes the notices away and cancels the job.
ok(activity.includes('case "logout":ComplaintAlerts.get(MainActivity.this).logout();AlertCheckJob.cancel(MainActivity.this);tracker.logout(reply);break;'), 'the bridge\'s sign-out clears the complaints and cancels the job');
ok(activity.includes('"/api/auth/logout".equals(uri.getPath())){runOnUiThread(()->speech.invalidate());ComplaintAlerts.get(MainActivity.this).logout();AlertCheckJob.cancel(MainActivity.this);'), 'so does the page\'s sign-out');
// The tap: a cold start loads «#complaint=<id>», a running page is told by an event, the id quoted and used once.
ok(activity.includes('complaint=ComplaintAlerts.requestedComplaint(getIntent())') && activity.includes('complaint!=null?ComplaintAlertRules.complaintFragment(complaint)') && activity.includes('getIntent().removeExtra(ComplaintAlerts.EXTRA)'), 'a cold start opens the page on the complaint, once');
ok(activity.includes("'yourrest:open-complaint'") && activity.includes('JSONObject.quote(complaint)') && activity.includes('intent.removeExtra(ComplaintAlerts.EXTRA)'), 'a running page is told by an event, the id quoted');
// The request: one fixed address, no redirect, the session cookie only in its header, a bounded answer, nothing logged.
ok(api.includes('new URL(RouteRules.ORIGIN + ComplaintAlertRules.PATH)') && api.includes('setInstanceFollowRedirects(false)') && api.includes('setRequestProperty("Cookie", cookie)') && api.includes('MAX_BODY_BYTES') && api.indexOf('throw new ServiceAlertApi.Failure(401') < api.indexOf('openConnection()'), 'GET /api/complaints/alerts on the CRM origin only, without redirects, bounded, never without a session');
ok(!/Log\.|printStackTrace|System\.out/.test(api + glue + job), 'nothing is logged');
ok(!/requestLocationUpdates|requestPermissions|startForegroundService|startService/.test(glue + job), 'the alerts and the job start no GPS, no service and ask no permission');
ok(!/description|demand|contactPhone|city/.test(read('ComplaintAlertFeed.java')), 'the feed reads no complaint text, phone or city');
// The job: the platform's own scheduler, no WorkManager.
ok(job.includes('extends JobService') && job.includes('setPeriodic(AlertJobRules.PERIOD_MS)') && job.includes('setPersisted(true)') && job.includes('setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)'), 'a periodic persisted JobScheduler job with a network constraint');
ok(!/^import androidx|WorkManager\.getInstance|WorkRequest/m.test(job) && !fs.readFileSync(path.join(root, 'mobile/android/app/build.gradle'), 'utf8').includes('dependencies'), 'no WorkManager, no new dependency');
// The manifest: the job service, protected; no permission added (a persisted job needs RECEIVE_BOOT_COMPLETED, the network constraint
// ACCESS_NETWORK_STATE, both already declared).
const manifest = fs.readFileSync(path.join(root, 'mobile/android/app/src/main/AndroidManifest.xml'), 'utf8');
ok(manifest.includes('<service android:name=".AlertCheckJob" android:permission="android.permission.BIND_JOB_SERVICE" android:exported="false" />'), 'the job service is declared, bound only by the system and not exported');
eq([...manifest.matchAll(/uses-permission android:name="android\.permission\.([A-Z_]+)"/g)].map(match => match[1]).sort(),
  ['ACCESS_BACKGROUND_LOCATION', 'ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'ACCESS_NETWORK_STATE', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION', 'INTERNET', 'POST_NOTIFICATIONS', 'RECEIVE_BOOT_COMPLETED', 'REQUEST_INSTALL_PACKAGES'], 'no permission is added');
const gradle = fs.readFileSync(path.join(root, 'mobile/android/app/build.gradle'), 'utf8');
eq([gradle.match(/versionCode\s+(\d+)/)?.[1], gradle.match(/versionName\s+'([^']+)'/)?.[1]], ['16', '1.0.15'], 'the app is 1.0.15 (16): 1.0.14 brought the complaint alerts, 1.0.15 keeps them (tests/webview-load-android.mjs checks what it adds)');
// The release notes the publish script writes: at most five of at most 200 characters, in both languages. They describe the release
// being published (1.0.15 since 2026-11-19: tests/webview-load-android.mjs checks what they say).
const publish = fs.readFileSync(path.join(root, 'scripts/publish-android-release.mjs'), 'utf8');
const notesBlock = publish.slice(publish.indexOf('releaseNotes:{ar:['), publish.indexOf(']},publishedAt'));
const [arBlock, enBlock] = notesBlock.split('],en:[');
const notes = block => [...block.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(match => match[1]);
const ar = notes(arBlock), en = notes(enBlock);
ok(ar.length >= 1 && ar.length <= 5 && en.length === ar.length, 'one to five notes, as many in English as in Arabic');
ok([...ar, ...en].every(note => note.length <= 200), 'every note fits the update screen (200 characters)');
ok(ar.every(note => /[؀-ۿ]/.test(note)) && en.every(note => !/[؀-ۿ]/.test(note)), 'Arabic notes and English notes');
// The page opens what the tap names: «#complaint=<id>» and the event (app/crm-app.tsx).
const page = fs.readFileSync(path.join(root, 'app/crm-app.tsx'), 'utf8');
ok(page.includes("window.addEventListener('yourrest:open-complaint',open)") && page.includes('/^complaint=([A-Za-z0-9_-]{1,200})$/'), 'the page handles the event and the address');
ok(/const openComplaint=useCallback\(\(id:string\)=>\{[\s\S]{0,300}if\(editorOpenRef\.current\)\{toast\.info/.test(page), 'a screen with unsaved work is never replaced');

console.log(`complaint alerts android checks passed: ${checks} (ComplaintAlertRulesCheck ${rulesChecks}, ComplaintAlertsCheck ${glueChecks}, ServiceAlertCheck ${serviceChecks}, framework compile ${frameworkCompiled ? 'done' : 'skipped (ANDROID_ALL_JAR not set)'})`);
