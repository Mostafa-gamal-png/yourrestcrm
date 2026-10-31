'use strict';
// Read-only search (2026-10-31, asked by the owner): is the Android signing key of the Yourrest app on the hosting account, and where are
// the APK files? It walks the account's home by file NAME only and prints path, size and date of key stores (.jks, .keystore, .p12, .pfx,
// keystore.properties) and APKs. It never opens, reads, copies or prints the content of any file, and looks for no password. A key store
// under public_html can be downloaded by anyone who guesses its address, so that is said first.
//   node signing-key.cjs                 on the hosting account (HOME is the account)
//   YR_DIAG_HOME=<dir> node ...          on a copy
const fs = require('node:fs');
const path = require('node:path');

const KEY_STORE = /\.(jks|keystore|p12|pfx|bks)$|^keystore\.properties$|^signing\.properties$/i, APK = /\.apk$/i;
// Folders with nothing of ours to find, and many files: libraries, caches, mail, and each update's copied release.
const SKIP = new Set(['node_modules', '.cache', '.npm', '.trash', 'mail', '.cpanel', 'tmp', 'logs', '.git']);
const LIMIT = 200;

function run() {
  const home = path.resolve(process.env.YR_DIAG_HOME || process.env.HOME || '/home/youriedx');
  const keyStores = [], apks = [];
  let folders = 0, unreadable = 0;
  const walk = dir => {
    let entries;
    try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { unreadable++; return; }
    folders++;
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { if (!SKIP.has(entry.name)) walk(full); continue; }
      if (!entry.isFile()) continue;
      const kind = KEY_STORE.test(entry.name) ? keyStores : APK.test(entry.name) ? apks : null;
      if (!kind || kind.length >= LIMIT) continue;
      let st; try { st = fs.statSync(full); } catch { continue; }
      const relative = path.relative(home, full);
      kind.push({path: relative, bytes: st.size, modified: st.mtime.toISOString().slice(0, 10), publicWeb: relative.split(path.sep)[0] === 'public_html' || /^[^/]+\.(com|org|net)\//.test(relative)});
    }
  };
  walk(home);
  const exposed = keyStores.filter(item => item.publicWeb);
  const report = {checkedAt: new Date().toISOString(), readOnly: true, contentsRead: false, foldersSearched: folders, unreadableFolders: unreadable, skipped: [...SKIP], keyStores, apks};
  report.verdict = exposed.length ? 'SIGNING KEY FILE UNDER A PUBLIC WEB FOLDER: ' + exposed.map(item => item.path).join(', ')
    : keyStores.length ? 'POSSIBLE SIGNING KEY FILES FOUND: ' + keyStores.length
    : 'NO SIGNING KEY FILE ON THE HOSTING ACCOUNT';
  return report;
}

if (require.main === module) {
  try { const report = run(); console.log(JSON.stringify(report, null, 2)); console.log(report.verdict); }
  catch (error) { console.log('DIAGNOSE STOP: ' + (error && error.message ? error.message : String(error))); process.exitCode = 1; }
}
module.exports = {run};
