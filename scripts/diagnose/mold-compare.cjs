'use strict';
// Read-only comparison (asked by the owner, 2026-11-01): is the «رقم العميل» of the 91 earlier mold requests the customer's
// Yourrest code or its ERP code? It runs the live release's own tool (release/operations/mold-import.mjs --compare) on the live
// data, opened read-only, against the products application's source file of the earlier requests. It changes nothing and prints
// counts and order numbers only: no customer or representative names, no codes.
//   node mold-compare.cjs                     on the hosting account
//   MOLD_DIAG_APP=<app folder> MOLD_DIAG_SOURCE=<file> MOLD_IMPORT_DATABASE=<file> node mold-compare.cjs    on a copy (tests)
// No YR_* variable is ever used or set: the settings check refuses any YR_* value beside settings.cjs.
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

/** Where the products application keeps the earlier requests, first the one given. */
function sourceFile(home) {
  const candidates = [process.env.MOLD_DIAG_SOURCE, path.join(home, 'public_html', 'products', 'private', 'mold-requests-source.json')].filter(Boolean);
  const found = candidates.find(file => { try { return fs.statSync(file).isFile(); } catch { return false; } });
  if (!found) throw new Error('the earlier requests file was not found (public_html/products/private/mold-requests-source.json)');
  return found;
}

async function run() {
  const home = process.env.HOME || '/home/youriedx', app = process.env.MOLD_DIAG_APP || path.join(home, 'yourrest-crm');
  const tool = path.join(app, 'release', 'operations', 'mold-import.mjs');
  if (!fs.existsSync(tool)) throw new Error('the live release has no mold-import.mjs: deploy the mold requests update first');
  // On the hosting account the tool finds yourrest-crm/settings.cjs in the home folder itself; a test copy names its folder.
  if (process.env.MOLD_DIAG_APP) process.env.MOLD_IMPORT_APP = app;
  const {main} = await import(pathToFileURL(tool).href);
  const report = await main(['--source', sourceFile(home), '--compare'], {log: () => {}});
  const verdict = `ROWS ${report.rows}: YOURREST CODE ${report.yourrest}, ERP CODE ${report.erp}, BOTH ${report.both}, NEITHER ${report.neither.length}, ERP AMBIGUOUS ${report.erpAmbiguous.length}`;
  return {...report, verdict};
}

if (require.main === module) {
  run().then(report => { console.log(JSON.stringify(report, null, 2)); console.log(report.verdict); })
    .catch(error => { console.log('DIAGNOSE STOP: ' + (error && error.message ? error.message : String(error))); process.exitCode = 1; });
}
module.exports = {run};
