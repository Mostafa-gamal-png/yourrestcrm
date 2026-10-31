// The read-only search for the Android signing key on the hosting account (scripts/diagnose/signing-key.cjs), on a synthetic account:
// key stores and APKs are found by name with their path, size and date, a key store under a public web folder is said first, library
// and cache folders are skipped, links are not followed, and no file's content is printed. No network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';

const root = process.cwd(), require = createRequire(import.meta.url);
const {run} = require(path.join(root, 'scripts/diagnose/signing-key.cjs'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yr-diagnose-signing-'));
process.on('exit', () => fs.rmSync(home, {recursive: true, force: true}));
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(home, file)), {recursive: true}); fs.writeFileSync(path.join(home, file), text); };
const SECRET = 'PRIVATE-KEY-BYTES-MUST-NOT-BE-PRINTED';
process.env.YR_DIAG_HOME = home;

// ---- an account with nothing
write('yourrest-crm/release/server.js', '// app\n');
let report = run();
eq([report.keyStores, report.apks, report.verdict], [[], [], 'NO SIGNING KEY FILE ON THE HOSTING ACCOUNT'], 'nothing found is said plainly');

// ---- a key kept privately, an APK the app serves, and copies the search must skip or not follow
write('android-signing/yourrest-release.jks', SECRET);
write('android-signing/keystore.properties', 'storePassword=' + SECRET);
write('yourrest-crm/release/public/downloads/yourrest-1.0.10.apk', 'apk');
write('yourrest-crm/release/node_modules/some-lib/test.jks', 'library fixture');
fs.symlinkSync(path.join(home, 'android-signing'), path.join(home, 'link-to-signing'));
report = run();
eq(report.keyStores.map(item => item.path).sort(), ['android-signing/keystore.properties', 'android-signing/yourrest-release.jks'], 'the key store and its properties file, by name; not the library fixture, not twice through a link');
eq(report.keyStores.find(item => item.path.endsWith('.jks')).bytes, SECRET.length, 'with its size');
eq(/^\d{4}-\d\d-\d\d$/.test(report.keyStores[0].modified), true, 'and its date');
eq(report.apks.map(item => item.path), ['yourrest-crm/release/public/downloads/yourrest-1.0.10.apk'], 'the APK the app serves');
eq(report.verdict, 'POSSIBLE SIGNING KEY FILES FOUND: 2', 'found, kept privately');
eq(report.contentsRead, false, 'the report says no content was read');

// ---- a key store anyone could download is said first
write('public_html/old/yourrest.keystore', SECRET);
report = run();
eq(report.verdict, 'SIGNING KEY FILE UNDER A PUBLIC WEB FOLDER: public_html/old/yourrest.keystore', 'a key store under public_html is the verdict');

// ---- run on its own: the verdict last, and no content anywhere in what it printed
const printed = spawnSync(process.execPath, [path.join(root, 'scripts/diagnose/signing-key.cjs')], {env: process.env, encoding: 'utf8'});
eq(printed.status, 0, 'run on its own it ends well');
eq(printed.stdout.trim().split('\n').at(-1), 'SIGNING KEY FILE UNDER A PUBLIC WEB FOLDER: public_html/old/yourrest.keystore', 'and ends with the verdict');
eq(printed.stdout.includes(SECRET), false, 'no file content or password is printed');
console.log(JSON.stringify({ok: true, checks}));
