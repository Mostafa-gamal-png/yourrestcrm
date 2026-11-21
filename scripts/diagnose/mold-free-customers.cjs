'use strict';
// Read-only (2026-11-21, before the release in which a mold request's customer goes to production exactly as typed, with no link to a
// CRM customer by its code): such a request is sent only once the CRM has learned that production's application takes a customer that is
// not the CRM's (crm_settings row 'mold-free-customers', lib/mold-requests-server.ts); until then it waits (error free_customer). This says,
// as yes/no, times and counts only: whether that row exists and when it was written, how many requests are not linked to a CRM customer
// and how many of those reached production, and how many wait now for that reason. No name, no code, no number of a customer. Nothing is
// written.
//   node mold-free-customers.cjs                                     on the hosting account
//   MOLD_DIAG_APP=<app folder> MOLD_DIAG_DATABASE=<file> node ...    on a copy (tests)
// No YR_* variable is ever used or set: the settings check refuses any YR_* value beside settings.cjs.
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');

function report(db) {
  const learned = db.prepare("SELECT owner_id AS at FROM crm_settings WHERE id='mold-free-customers'").get();
  const columns = new Set(db.prepare('PRAGMA table_info(crm_mold_requests)').all().map(column => column.name));
  const pick = name => columns.has(name) ? name : 'NULL';
  const rows = db.prepare(`SELECT customer_id AS customerId, ${pick('remote')} AS remote, ${pick('last_error')} AS error, ${pick('cancelled_at')} AS cancelledAt FROM crm_mold_requests`).all();
  const unlinked = rows.filter(row => !row.customerId);
  const waitingFree = rows.filter(row => String(row.error || '').includes('free_customer') && !row.cancelledAt).length;
  const result = {
    mode: 'mold-free-customers', readOnly: true,
    learned: !!learned, learnedAt: learned ? String(learned.at || '') : null,
    requests: rows.length, notLinked: unlinked.length, notLinkedReachedProduction: unlinked.filter(row => row.remote).length,
    waitingForFreeCustomers: waitingFree
  };
  result.verdict = `FREE CUSTOMERS LEARNED: ${result.learned ? 'YES (' + result.learnedAt + ')' : 'NO'}; REQUESTS: ${result.requests}, NOT LINKED: ${result.notLinked}, OF THEM REACHED PRODUCTION: ${result.notLinkedReachedProduction}; WAITING FOR IT NOW: ${result.waitingForFreeCustomers}`;
  return result;
}

function run() {
  const home = process.env.HOME || '/home/youriedx', app = process.env.MOLD_DIAG_APP || path.join(home, 'yourrest-crm');
  const database = process.env.MOLD_DIAG_DATABASE || require(path.join(app, 'release', 'operations', 'config.cjs')).loadSettings(app).YR_DATABASE_PATH;
  const db = new DatabaseSync(database, {readOnly: true});
  try { return report(db); } finally { db.close(); }
}

if (require.main === module) {
  try { const result = run(); console.log(JSON.stringify(result, null, 2)); console.log(result.verdict); }
  catch (error) { console.log('DIAGNOSE STOP: ' + (error && error.message ? error.message : String(error))); process.exitCode = 1; }
}
module.exports = {run, report};
