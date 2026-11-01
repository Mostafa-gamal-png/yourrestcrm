'use strict';
// Links the earlier mold requests (imported by the products application with their numbers) to CRM requests, with what the owner
// confirmed on 2026-11-01: the customer by its Yourrest code (91 of 91 matched), and the salesman names of the sheet to these CRM
// representatives. The sheet writes each salesman shorter than the CRM does (the CRM name holds the same words and more), so the link
// tool's own exact match found none; the owner confirmed each one below. The orders of «the head office» have no CRM account and stay
// unlinked, as the owner chose. Nothing is guessed here: a salesman name not listed, a listed member who is no longer an active
// representative, or a CRM name that no longer holds the sheet's words stops the run before anything is read from production.
//
// It runs the live release's own tool (release/operations/mold-import.mjs --key yourrest), on a private copy of the earlier requests in
// which each confirmed salesman carries the CRM name of the member confirmed for it and the head office's orders are left out:
//   dry run  (dryRun: true)   the database opened read-only, production not called: what would be linked and what skipped, and why
//   apply    (dryRun: false)  each order linked at production first, then saved in the CRM as accepted; a second run changes nothing
// Prints order numbers, counts and reasons only: no names, no emails, no codes. The private copy is removed whatever happens.
//   node legacy-link.cjs <request.json>       on the hosting account ({"dryRun": true|false}, written by scripts/deploy-cpanel.mjs)
// No YR_* variable is ever used or set: the settings check refuses any YR_* value beside settings.cjs.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {DatabaseSync} = require('node:sqlite');

/** The salesman named in each of these earlier orders is the CRM representative beside it (confirmed by the owner, 2026-11-01). */
const CONFIRMED = [
  {order: 2, member: '800c75f2-16ec-4612-baa0-586550749598'},
  {order: 17, member: 'a4455849-6226-4589-a3f7-b0d5e15c4034'},
  {order: 23, member: '6b94c7dd-85ad-4eb8-8a4d-682701c33fe5'},
  {order: 37, member: 'a1ed216c-2dc9-4a1d-92ef-58e9194738ff'},
  {order: 57, member: '478dba0e-bdb6-4a2d-93c5-dc683ff6e5e4'}
];
/** The salesman named in these orders is the head office: no CRM account; its orders stay unlinked (the owner's choice). */
const LEFT_OUT = [1];

class LinkStop extends Error {}
/** Words of a name with the spellings the sheet and the CRM may differ in made one (marks, أ/ا, ى/ي, ة/ه, ؤ ئ ء, case), «عبد» kept with
 *  the next word: the same reading as scripts/diagnose/mold-reps.cjs, whose answer the owner confirmed. */
const words = value => String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().replace(/عبد /g, 'عبد').replace(/[ـً-ٰٟ]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ء/g, '').toLowerCase().split(' ').filter(Boolean);
const holds = (crmName, sheetName) => { const crm = words(crmName), sheet = words(sheetName); return sheet.length > 0 && sheet.every(word => crm.includes(word)); };

/** Where the products application keeps the earlier requests. */
function sourceFile(home) {
  const file = path.join(home, 'public_html', 'products', 'private', 'mold-requests-source.json');
  try { if (fs.statSync(file).isFile()) return file; } catch { /* reported below */ }
  throw new LinkStop('the earlier requests file was not found (public_html/products/private/mold-requests-source.json)');
}

/** The rows the tool is given: confirmed salesmen under their CRM names, the head office's orders out. Checks everything first. */
function prepare(rows, sameName, members) {
  const byOrder = new Map(rows.map(row => [row.legacyOrderNo, row]));
  const named = order => { const row = byOrder.get(order); if (!row) throw new LinkStop(`order ${order} is not in the earlier requests: the confirmed list does not fit this file`); return sameName(row.salesmanName); };
  const leftOut = new Set(LEFT_OUT.map(named)), crmName = new Map(), seen = new Set();
  for (const {order, member} of CONFIRMED) {
    const name = named(order), found = members.get(member);
    if (crmName.has(name) || leftOut.has(name) || seen.has(member)) throw new LinkStop(`the confirmed list names the salesman of order ${order} twice`);
    if (!found || found.role !== 'rep' || found.active !== 1) throw new LinkStop(`the CRM member confirmed for the salesman of order ${order} is no longer an active representative: ask the owner again`);
    if (!holds(found.name, rows.find(row => sameName(row.salesmanName) === name).salesmanName)) throw new LinkStop(`the CRM name of the member confirmed for the salesman of order ${order} changed: ask the owner again`);
    crmName.set(name, found.name); seen.add(member);
  }
  const unknown = rows.filter(row => !crmName.has(sameName(row.salesmanName)) && !leftOut.has(sameName(row.salesmanName))).map(row => row.legacyOrderNo);
  if (unknown.length) throw new LinkStop(`orders ${unknown.join(', ')} name a salesman the owner did not confirm: nothing is linked`);
  const kept = rows.filter(row => crmName.has(sameName(row.salesmanName))).map(row => ({...row, salesmanName: crmName.get(sameName(row.salesmanName))}));
  return {kept, leftOut: rows.filter(row => leftOut.has(sameName(row.salesmanName))).map(row => row.legacyOrderNo)};
}

async function run(requestFile) {
  const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
  if (typeof request.dryRun !== 'boolean') throw new LinkStop('the request must say dryRun: true (show only) or false (link)');
  const home = process.env.HOME || '/home/youriedx', app = path.join(home, 'yourrest-crm'), operations = path.join(app, 'release', 'operations');
  const tool = path.join(operations, 'mold-import.mjs');
  if (!fs.existsSync(tool)) throw new LinkStop('the live release has no mold-import.mjs: deploy the mold requests update first');
  const {readSource, sameName, main} = await import(pathToFileURL(tool).href);
  const {moldConfig} = await import(pathToFileURL(path.join(operations, 'mold-client.mjs')).href);
  const settings = require(path.join(operations, 'config.cjs')).loadSettings(app);
  const products = moldConfig(settings);
  const rows = readSource(sourceFile(home));
  const db = new DatabaseSync(settings.YR_DATABASE_PATH, {readOnly: true});
  let prepared;
  try { prepared = prepare(rows, sameName, new Map(db.prepare('SELECT id, name, role, active FROM crm_members').all().map(member => [member.id, member]))); } finally { db.close(); }
  if (!request.dryRun && !products.ok) throw new LinkStop(`the production link is not configured in settings.cjs (${products.reason}): nothing is linked`);
  const folder = fs.mkdtempSync(path.join(home, '.yourrest-mold-link-'));
  try {
    fs.chmodSync(folder, 0o700);
    const copy = path.join(folder, 'requests.json');
    fs.writeFileSync(copy, JSON.stringify({requests: prepared.kept}), {mode: 0o600});
    const report = await main(['--source', copy, '--key', 'yourrest', request.dryRun ? '--dry-run' : '--apply'], {log: () => {}});
    const skipped = Object.entries(report.skipped || {}).map(([reason, orders]) => `${reason.toUpperCase()} ${orders.length}`).join(', ');
    const head = `ROWS ${rows.length}: LEFT OUT (HEAD OFFICE) ${prepared.leftOut.length}`;
    const verdict = request.dryRun
      ? `${head}, TO LINK ${report.toLink.length}${skipped ? ', ' + skipped : ''}, DESIGN LINKS NOT KEPT ${report.designLinksDropped}, PRODUCTION LINK ${products.ok ? 'CONFIGURED' : 'NOT CONFIGURED (' + products.reason + ')'}`
      : `${head}, LINKED ${report.linked.length}, FAILED ${report.failed.length}${skipped ? ', ' + skipped : ''}`;
    return {...report, rows: rows.length, leftOut: prepared.leftOut, productionLink: products.ok ? 'configured' : products.reason, verdict};
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
}

if (require.main === module) {
  run(process.argv[2] || path.join(os.homedir(), 'yourrest-deploy', 'mold-link.json')).then(report => {
    console.log(JSON.stringify(report, null, 2));
    console.log('MOLD LINK ' + (report.mode === 'apply' ? 'APPLIED' : 'DRY RUN') + ': ' + report.verdict);
    if (report.mode === 'apply' && report.failed.length) process.exitCode = 1;
  }).catch(error => { console.log('MOLD LINK STOP: ' + (error && error.message ? error.message : String(error))); process.exitCode = error instanceof LinkStop ? 2 : 1; });
}
module.exports = {run, prepare, holds, CONFIRMED, LEFT_OUT};
