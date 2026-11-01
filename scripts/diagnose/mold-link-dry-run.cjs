'use strict';
// Read-only dry run (the owner chose the Yourrest code on 2026-11-01): which of the 91 earlier mold requests would be linked to a
// CRM request, and which would be skipped and why. It runs the live release's own tool (release/operations/mold-import.mjs
// --key yourrest --dry-run) with the database opened read-only; nothing is written and production is not called. It prints
// counts, order numbers and reasons only: no customer or representative names, no codes.
//   node mold-link-dry-run.cjs                on the hosting account
//   MOLD_DIAG_APP=<app folder> MOLD_DIAG_SOURCE=<file> MOLD_IMPORT_DATABASE=<file> node mold-link-dry-run.cjs    on a copy (tests)
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
  if (process.env.MOLD_DIAG_APP) process.env.MOLD_IMPORT_APP = app;
  const {main} = await import(pathToFileURL(tool).href);
  const report = await main(['--source', sourceFile(home), '--key', 'yourrest', '--dry-run'], {log: () => {}});
  const skipped = Object.entries(report.skipped || {}).map(([reason, orders]) => `${reason.toUpperCase()} ${orders.length}`).join(', ');
  const verdict = `ROWS ${report.rows}: TO LINK ${report.toLink.length}${skipped ? ', ' + skipped : ', SKIPPED 0'}, DESIGN LINKS NOT KEPT ${report.designLinksDropped}`;
  return {...report, verdict};
}

if (require.main === module) {
  run().then(report => { console.log(JSON.stringify(report, null, 2)); console.log(report.verdict); })
    .catch(error => { console.log('DIAGNOSE STOP: ' + (error && error.message ? error.message : String(error))); process.exitCode = 1; });
}
module.exports = {run};
