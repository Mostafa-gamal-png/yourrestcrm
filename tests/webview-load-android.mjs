// Android app 1.0.15 (the owner, 2026-11-19: a Huawei tablet without Google services showed only a white screen; and the camera for
// «صور القالب»), on a real JVM without a device: the pure rules of the panel over a page that cannot be shown and of its watchdog
// (LoadFailureRulesCheck: which callback covers the page with which words, Chromium's version from Google's and Huawei's WebView, the
// deadlines at their edges, an attempt from start to panel and back, the facts for support, and source guards on MainActivity and
// LoadFailurePanel), the probe the page is asked, run here in JavaScript on stand-in documents, the camera's rules (CameraPhotoRulesCheck:
// which inputs offer it, the photo's file and path, the modes, the manifest without a CAMERA permission), the real CameraPhotoProvider on
// Android stand-ins (tests/fixtures/native-camera), then the earlier checks that guard MainActivity and the manifest (the file chooser, the
// design files, the trip start, Maps, activation, account recovery, offline authorization), and source guards for the version, the release
// notes and the documents. With ANDROID_ALL_JAR naming the pinned framework jar the whole main source is compiled against it too. Needs a
// JDK 17+. Not an Android device test: no WebView, network, TLS, renderer, camera app or phone; tests/webview-load-probe-browser.mjs runs the
// probe in a real Chromium on the site's own offline pages; the APK is built on GitHub.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';

const root = process.cwd(), main = path.join(root, 'mobile/android/app/src/main/java/org/yourrest/crm'), checksDir = path.join(root, 'mobile/android/app/src/test/java/org/yourrest/crm');
const fixture = path.join(root, 'tests/fixtures/native-camera');
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
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-webview-jvm-'));
process.on('exit', () => fs.rmSync(work, {recursive: true, force: true}));
const run = (command, args, stdoutOnly = false) => {
  const result = spawnSync(command, args, {cwd: root, encoding: 'utf8', maxBuffer: 16 << 20, timeout: 180000, env: {...process.env, JAVA_TOOL_OPTIONS: ''}});
  const output = (result.stdout || '') + (result.stderr || '');
  if (result.status !== 0) throw Error(path.basename(command) + ' ' + args.slice(-1)[0] + ' failed:\n' + output);
  return stdoutOnly ? result.stdout : output;
};
const javaFiles = directory => fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? javaFiles(path.join(directory, entry.name)) : entry.name.endsWith('.java') ? [path.join(directory, entry.name)] : []);
const counted = (output, label, least) => { const match = output.match(/: (\d+) checks passed/) || output.match(/checks passed: (\d+)/); ok(match && Number(match[1]) >= least, label + ' ran: ' + output.trim().split('\n').pop()); return Number(match[1]); };
const source = name => path.join(main, name + '.java');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// ---- 1. The pure rules (warnings are errors), then their checks with the main source for the source guards.
const rulesOut = path.join(work, 'rules');
fs.mkdirSync(rulesOut);
run(javac, ['--release', '17', '-encoding', 'UTF-8', '-Xlint:all', '-Werror', '-d', rulesOut, ...['LoadFailureRules', 'LoadWatch', 'CameraPhotoRules', 'RouteRules'].map(source), path.join(checksDir, 'LoadFailureRulesCheck.java'), path.join(checksDir, 'CameraPhotoRulesCheck.java')]);
const loadChecks = counted(run(java, ['-cp', rulesOut, 'org.yourrest.crm.LoadFailureRulesCheck', main]), 'LoadFailureRulesCheck', 220);
const cameraChecks = counted(run(java, ['-cp', rulesOut, 'org.yourrest.crm.CameraPhotoRulesCheck', main]), 'CameraPhotoRulesCheck', 140);

// ---- 2. The probe the page is asked (LoadFailureRules.PROBE), run in JavaScript on stand-in documents.
const probe = run(java, ['-cp', rulesOut, 'org.yourrest.crm.LoadFailureRulesCheck', '--print-probe'], true);
ok(probe.startsWith("(function(){try{if(location.origin!=='https://crm.yourrest.org')return 'elsewhere';") && probe.length < 1300, 'the probe as the app sends it');
const script = new vm.Script(probe);
const element = (width, height) => ({getBoundingClientRect: () => ({width, height})});
const page = ({readyState = 'complete', body = {}, origin = 'https://crm.yourrest.org'} = {}) => {
  const document = {readyState, body: body === null ? null : {innerText: body.text ?? '', querySelectorAll: () => body.elements || []}};
  if (body && body.throws) Object.defineProperty(document.body, 'innerText', {get() { throw Error('no layout'); }});
  if (body && body.noInnerText) delete document.body.innerText;
  return script.runInNewContext({document, location: {origin}});
};
eq(page({readyState: 'loading', body: null}), 'wait', 'no body while the document is parsed: wait');
eq(page({readyState: 'interactive', body: null}), 'blank', 'no body once parsed: blank');
eq(page({body: {text: ''}}), 'blank', 'the offline shell before its script draws it (its noscript is hidden, its root empty): blank');
eq(page({readyState: 'loading', body: {text: ''}}), 'wait', 'an empty body still being parsed: wait');
eq(page({body: {text: ' \n\t  '}}), 'blank', 'white space is not content');
eq(page({body: {text: 'يورست للصناعات'}}), 'up', 'text shows: up');
eq(page({readyState: 'loading', body: {text: 'Yourrest'}}), 'up', 'text shows while still loading: up');
eq(page({body: {text: '', elements: [element(0, 0), element(24, 0)]}}), 'blank', 'a picture or control without a size is not content');
eq(page({body: {text: '', elements: [element(0, 0), element(120, 40)]}}), 'up', 'a picture or control with a size: up');
eq(page({body: {noInnerText: true, elements: [element(10, 10)]}}), 'up', 'an engine without innerText still counts what shows');
eq(page({body: {noInnerText: true}}), 'blank', 'and nothing is nothing');
eq(page({body: {throws: true}}), 'error', 'a page that throws while asked: error (the app reads it as no answer)');
eq(page({body: {text: '', elements: [...Array(220).fill(element(0, 0)), element(50, 50)]}}), 'blank', 'at most 200 elements are measured');
eq(script.runInNewContext({}), 'error', 'no document at all: error, never a throw into the page');
eq(page({body: {text: 'Webpage not available'}, origin: 'null'}), 'elsewhere', 'WebView\'s own error page (its text is not the CRM coming up): elsewhere');
eq(page({body: {text: 'x'}, origin: 'https://crm.yourrest.org.evil.example'}), 'elsewhere', 'another origin: elsewhere');
ok(!/=>|`|\?\.|\?\?|\.\.\.|\b(let|const|class|async|await)\b/.test(probe), 'ES5 only, so an old engine runs it');
let es5 = 'skipped (acorn not found)';
try {
  const require = createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || path.join(root, 'node_modules'), 'noop.js'));
  const acorn = require('acorn');
  acorn.parse(probe, {ecmaVersion: 5});
  ok(true, 'the probe parses as ECMAScript 5');
  es5 = 'parsed as ES5';
} catch (problem) { if (!/Cannot find module/.test(String(problem && problem.message))) throw problem; }

// ---- 3. The real CameraPhotoProvider on Android stand-ins.
const providerClasses = ['CameraPhotoProvider', 'CameraPhotoRules'];
const providerOut = path.join(work, 'provider');
fs.mkdirSync(providerOut);
run(javac, ['--release', '17', '-encoding', 'UTF-8', '-Xlint:all', '-d', providerOut, ...javaFiles(path.join(fixture, 'stubs')), ...providerClasses.map(source), path.join(fixture, 'CameraPhotoProviderCheck.java')]);
const providerChecks = counted(run(java, ['-cp', providerOut, 'org.yourrest.crm.CameraPhotoProviderCheck']), 'CameraPhotoProviderCheck', 45);
ok(!javaFiles(path.join(fixture, 'stubs')).some(file => file.includes('/org/yourrest/')), 'the stand-ins are Android\'s only, never the classes under check');

// ---- 4. The earlier checks that guard MainActivity and the manifest, with every pure main class.
const pure = fs.readdirSync(main).filter(name => name.endsWith('.java') && !/^import (android|org\.json)\./m.test(fs.readFileSync(path.join(main, name), 'utf8')));
ok(['LoadFailureRules.java', 'LoadWatch.java', 'CameraPhotoRules.java', 'RouteRules.java', 'FileChooserRules.java', 'DesignFileRules.java', 'OutboxDrain.java'].every(name => pure.includes(name)) && !pure.includes('MainActivity.java'), 'the pure main classes');
const allOut = path.join(work, 'all');
fs.mkdirSync(allOut);
run(javac, ['--release', '17', '-encoding', 'UTF-8', '-d', allOut, ...pure.map(name => path.join(main, name)), ...javaFiles(checksDir)]);
const earlier = {};
for (const [check, least] of [['FileChooserCheck', 60], ['DesignFileCheck', 300], ['TripStartCheck', 170], ['MapsLaunchCheck', 110], ['ActivationRecoveryCheck', 50], ['AccountRecoveryCheck', 85], ['OfflineAuthorizationCheck', 140]])
  earlier[check] = counted(run(java, ['-cp', allOut, 'org.yourrest.crm.' + check, main]), check, least);

// ---- 5. Optional: the whole main source against the pinned Android 35 framework jar (with a stub R).
let frameworkCompiled = false;
const framework = process.env.ANDROID_ALL_JAR;
if (framework && fs.existsSync(framework)) {
  const gen = path.join(work, 'gen/org/yourrest/crm'), out = path.join(work, 'framework');
  fs.mkdirSync(gen, {recursive: true}); fs.mkdirSync(out);
  fs.writeFileSync(path.join(gen, 'R.java'), 'package org.yourrest.crm;\npublic final class R { public static final class drawable { public static final int ic_location=1, ic_service_request=2; } }\n');
  const output = run(javac, ['--release', '17', '-encoding', 'UTF-8', '-Xlint:all,-classfile', '-Xmaxwarns', '2000', '-cp', framework, '-d', out, ...javaFiles(path.join(root, 'mobile/android/app/src/main/java')), path.join(gen, 'R.java')]);
  ok(!/(LoadFailure|LoadWatch|CameraPhoto)\w*\.java:\d+: warning/.test(output), 'the new classes compile against the framework without a warning');
  const activityWarnings = [...output.matchAll(/MainActivity\.java:\d+: warning: \[(\w+)\] (.*)/g)].map(match => match[1] + ' ' + match[2]);
  // 1.0.14's own: the system bars' insets, the two file-URL switches it turns off, and the back key (twice).
  const earlierWarnings = ['onBackPressed() in Activity', 'onBackPressed() in Activity', 'getSystemWindowInsetLeft() in WindowInsets', 'getSystemWindowInsetTop() in WindowInsets', 'getSystemWindowInsetRight() in WindowInsets', 'getSystemWindowInsetBottom() in WindowInsets', 'consumeSystemWindowInsets() in WindowInsets', 'setAllowFileAccessFromFileURLs(boolean) in WebSettings', 'setAllowUniversalAccessFromFileURLs(boolean) in WebSettings'].map(api => 'deprecation ' + api + ' has been deprecated');
  eq(activityWarnings.sort(), earlierWarnings.sort(), 'MainActivity adds no warning: only the deprecations it already had');
  frameworkCompiled = true;
}

// ---- 6. Source guards: the version, the manifest, the release notes, the site the camera serves, the documents.
const gradle = read('mobile/android/app/build.gradle'), manifest = read('mobile/android/app/src/main/AndroidManifest.xml');
ok(Number(gradle.match(/versionCode\s+(\d+)/)?.[1]) >= 16 && /^1\.0\.(1[5-9]|[2-9]\d)$/.test(gradle.match(/versionName\s+'([^']+)'/)?.[1] || ''), 'the app is 1.0.15 (16) or later (1.0.16 keeps the white-screen panel and the camera)');
eq([...manifest.matchAll(/uses-permission android:name="android\.permission\.([A-Z_]+)"/g)].map(match => match[1]).sort(),
  ['ACCESS_BACKGROUND_LOCATION', 'ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'ACCESS_NETWORK_STATE', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION', 'INTERNET', 'POST_NOTIFICATIONS', 'RECEIVE_BOOT_COMPLETED', 'REQUEST_INSTALL_PACKAGES'], 'no permission is added: no CAMERA');
ok(manifest.includes('<provider android:name=".CameraPhotoProvider" android:authorities="org.yourrest.crm.camera" android:exported="false" android:grantUriPermissions="true" />'), 'the camera\'s provider: not exported, per-URI grants');
ok(!/\.proceed\(/.test(fs.readdirSync(main).map(name => fs.readFileSync(path.join(main, name), 'utf8')).join('\n')), 'no TLS failure is ever allowed through');
const publish = read('scripts/publish-android-release.mjs');
const notesBlock = publish.slice(publish.indexOf('releaseNotes:{ar:['), publish.indexOf(']},publishedAt'));
const [arBlock, enBlock] = notesBlock.split('],en:[');
const notes = block => [...block.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(match => match[1]);
const ar = notes(arBlock), en = notes(enBlock);
ok(ar.length >= 1 && ar.length <= 5 && en.length === ar.length && [...ar, ...en].every(note => note.length <= 200), 'one to five notes of at most 200 characters, as many in English as in Arabic');
ok(ar.every(note => /[؀-ۿ]/.test(note)) && en.every(note => !/[؀-ۿ]/.test(note)), 'Arabic notes and English notes');
ok(ar.some(note => note.includes('الكاميرا')) && en.some(note => /camera/i.test(note)), 'the notes name the camera');
ok(ar.some(note => note.includes('شاشة بيضاء') && note.includes('إعادة المحاولة')) && en.some(note => /white screen/i.test(note)), 'and the end of the white screen');
ok(ar.some(note => note.includes('أذونات جديدة')) && en.some(note => /no new permission/i.test(note)), 'and that no permission is asked');
// The input the camera is for, and the offline shell the panel leaves to the site.
ok(/type="file" accept="image\/\*" multiple hidden data-mold-photo-input/.test(read('app/customer-mold-photos.tsx')), '«صور القالب» is an image input of several photos (the camera or the gallery)');
const sw = read('public/sw.js');
ok(sw.includes("if (request.mode === 'navigate')") && sw.includes('return await fetch(request);') && sw.includes('await cache.match(fallback)'), 'the site\'s service worker answers a failed navigation with its offline shell, so WebView reports no error and the panel stays away');
// The documents.
const readme = read('mobile/android/README.md'), guide = read('docs/OPERATIONS-DEVELOPMENT-GUIDE-AR.md'), changelog = read('docs/CHANGELOG-HISTORY.md'), checksDoc = read('tests/CHECKS.md');
ok(/^# Yourrest CRM Android 1\.0\.(1[5-9]|[2-9]\d) \(versionCode (1[6-9]|[2-9]\d)\)/.test(readme) && readme.includes('LoadFailureRules') && readme.includes('CameraPhotoProvider'), 'the Android README names the version and what it brings');
ok(guide.indexOf('## 9-أو.') > guide.indexOf('## 9-أه.') && guide.indexOf('## 9-أو.') < guide.indexOf('## 10.'), 'the guide\'s section 9-أو closes chapter 9');
ok(changelog.indexOf('1.0.15') > 0 && changelog.indexOf('1.0.15') < changelog.indexOf('## «صور القالب»'), 'the release history starts with 1.0.15');
ok(checksDoc.includes('`node tests/webview-load-android.mjs`') && checksDoc.includes('`node tests/webview-load-probe-browser.mjs`'), 'tests/CHECKS.md lists both tests');

console.log(`webview load android checks passed: ${checks} (LoadFailureRulesCheck ${loadChecks}, CameraPhotoRulesCheck ${cameraChecks}, CameraPhotoProviderCheck ${providerChecks}, probe ${es5}, ${Object.entries(earlier).map(([name, count]) => name + ' ' + count).join(', ')}, framework compile ${frameworkCompiled ? 'done' : 'skipped (ANDROID_ALL_JAR not set)'})`);
