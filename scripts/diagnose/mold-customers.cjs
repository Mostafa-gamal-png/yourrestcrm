'use strict';
// Read-only check (2026-11-01, after the mold customers update): has the CRM sent its customer list to the products application?
// Each successful send is one crm_audit row (record 'mold-customers', action 'mold-customers:sync') holding counts and a fingerprint
// only; a failed send writes nothing and waits for the next check. This prints those rows' counts and times, how many CRM customers
// would go, whether the two products settings are present (true/false only, never their values), and whether anyone used the CRM
// since a given time (the sync starts with the first page that loads). It opens the database read-only and changes nothing: no names,
// codes, emails, ids or settings values are printed.
//   node mold-customers.cjs            on the hosting account (finds the database and settings through yourrest-crm/settings.cjs)
//   YR_DIAG_DATABASE=<file> node ...  on a copy (settings then read as absent)
//   YR_DIAG_SINCE=<ISO time>           the time activity is counted from (default: the newest mold customers activation checkpoint)
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');

function setup() {
  if (process.env.YR_DIAG_DATABASE) return {file: path.resolve(process.env.YR_DIAG_DATABASE), settings: null, home: null};
  const home = process.env.HOME || '/home/youriedx', app = path.join(home, 'yourrest-crm');
  const {loadSettings} = require(path.join(app, 'release', 'operations', 'config.cjs'));
  const settings = loadSettings(app);
  return {file: path.resolve(settings.YR_DATABASE_PATH), settings, home};
}

/** When the update went live: the newest activation checkpoint folder of the mold customers update, or YR_DIAG_SINCE. */
function since(home) {
  if (process.env.YR_DIAG_SINCE) return new Date(Date.parse(process.env.YR_DIAG_SINCE)).toISOString();
  if (!home) return null;
  let newest = 0;
  for (const name of fs.readdirSync(home)) {
    if (!/^yourrest-update-mold-customers-activation-\d{8}-[A-Za-z0-9]+$/.test(name)) continue;
    newest = Math.max(newest, fs.statSync(path.join(home, name)).mtimeMs);
  }
  return newest ? new Date(newest).toISOString() : null;
}

const NUMBERS = ['calls', 'count', 'sheetCities', 'received', 'inserted', 'updated', 'deactivated', 'activeCustomers'];

function run({file, settings, home} = setup(), now = Date.now()) {
  const from = since(home);
  const db = new DatabaseSync(file, {readOnly: true});
  try {
    const rows = db.prepare("SELECT n.number, r.data FROM crm_records r JOIN crm_customer_numbers n ON n.customer_id = r.id WHERE r.kind = 'customer'").all();
    let named = 0;
    for (const row of rows) { try { if (String(JSON.parse(row.data).name ?? '').trim()) named++; } catch { /* a broken record is left out */ } }
    const customers = db.prepare("SELECT COUNT(*) AS n FROM crm_records WHERE kind = 'customer'").get().n;
    const sends = db.prepare("SELECT detail, created_at AS at FROM crm_audit WHERE record_id = 'mold-customers' AND action = 'mold-customers:sync' ORDER BY created_at DESC").all().map(row => {
      let detail = {};
      try { detail = JSON.parse(row.detail) || {}; } catch { /* counted as unreadable */ }
      const send = {at: row.at, mode: detail.mode === 'full' || detail.mode === 'upsert' ? detail.mode : 'unknown'};
      for (const key of NUMBERS) send[key] = Number.isFinite(Number(detail[key])) ? Number(detail[key]) : null;
      return send;
    });
    const fromMs = from ? Date.parse(from) : null;
    const activity = fromMs === null ? null : {
      since: from,
      signIns: db.prepare('SELECT COUNT(*) AS n FROM auth_events WHERE created_at >= ?').get(fromMs).n,
      newSessions: db.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE created_at >= ?').get(fromMs).n,
      phoneReports: db.prepare('SELECT COUNT(*) AS n FROM crm_member_devices WHERE reported_at >= ?').get(from).n,
      recordChanges: db.prepare("SELECT COUNT(*) AS n FROM crm_records WHERE updated_at >= ?").get(from).n,
    };
    const report = {
      checkedAt: new Date(now).toISOString(), readOnly: true,
      settings: settings ? {productsUrlPresent: Boolean(String(settings.YR_PRODUCTS_API_URL ?? '').trim()), productsSecretPresent: Boolean(String(settings.YR_PRODUCTS_SECRET ?? ''))} : 'not read (copy)',
      crm: {customers, withYourrestNumber: rows.length, withNumberAndName: named},
      sends: {total: sends.length, latest: sends.slice(0, 5)},
      activity,
    };
    const latest = sends[0];
    if (latest) report.verdict = `SENT: ${sends.length} SEND(S), LATEST ${latest.at} (${latest.mode}, ${latest.calls} CALL(S)): CRM ${latest.count}, RECEIVED ${latest.received}, INSERTED ${latest.inserted}, UPDATED ${latest.updated}, DEACTIVATED ${latest.deactivated}, ACTIVE IN PRODUCTS ${latest.activeCustomers}`;
    else if (settings && !(report.settings.productsUrlPresent && report.settings.productsSecretPresent)) report.verdict = 'NOT SENT: THE PRODUCTS SETTINGS ARE MISSING';
    else if (activity && !activity.signIns && !activity.newSessions && !activity.phoneReports && !activity.recordChanges) report.verdict = 'NOT SENT YET: NOBODY HAS USED THE CRM SINCE THE UPDATE (THE FIRST PAGE THAT LOADS STARTS IT)';
    else report.verdict = 'NOT SENT: THE CRM WAS USED BUT NO SEND IS RECORDED (A FAILED SEND WAITS FOR THE NEXT 10-MINUTE CHECK)';
    return report;
  } finally { db.close(); }
}

if (require.main === module) {
  try { const report = run(); console.log(JSON.stringify(report, null, 2)); console.log(report.verdict); }
  catch (error) { console.log('DIAGNOSE STOP: ' + (error && error.message ? error.message : String(error))); process.exitCode = 1; }
}
module.exports = {run};
