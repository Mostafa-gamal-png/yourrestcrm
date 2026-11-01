// Links the mold requests made before the CRM screen to CRM requests. The production application imported them with their order
// numbers 1–91 (MOLD-REQUESTS-CONTRACT-AR.md, historical import): for each row of mold-requests-source.json this finds the CRM
// customer and representative, asks production to link its legacy order to a CRM request id (legacyOrderNo), and only then saves
// the CRM request, already accepted, so it shows on «طلبات تصنيع القوالب» with its stages. Nothing is guessed: a row whose customer
// or representative is not found exactly, or matches more than once, is skipped and listed with its reason.
//
//   node mold-import.mjs --source <mold-requests-source.json> --compare            read-only: does the sheet's customer number match
//                                                                                    the Yourrest code, the ERP code, both or neither?
//   node mold-import.mjs --source <file> --key yourrest|erp --dry-run               read-only: what would be linked, what is skipped
//   node mold-import.mjs --source <file> --key yourrest|erp --apply                 links and saves (after the owner confirmed)
//
// The database and the production link come from yourrest-crm/settings.cjs (YR_DATABASE_PATH, YR_PRODUCTS_API_URL,
// YR_PRODUCTS_SECRET); MOLD_IMPORT_DATABASE and MOLD_IMPORT_APP point elsewhere for a copy or a test (never a YR_* variable:
// the settings check refuses any YR_* value beside settings.cjs). The report is JSON with order
// numbers, counts and reasons only: no customer or representative names unless --show-names is given (for the owner's terminal).
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {validateMoldSpecs, moldRequestBody, moldStatusObject, MOLD_LIMITS} from './mold-rules.mjs';
import {moldConfig, callProducts} from './mold-client.mjs';

const require = createRequire(import.meta.url);
/** Spaces, tatweel and compatibility forms do not make two names different; letters do. */
export const sameName = value => String(value ?? '').normalize('NFKC').replace(/ـ/g, '').replace(/\s+/g, ' ').trim();
const text = (value, max) => { const clean = String(value ?? '').trim(); return [...clean].length > max ? [...clean].slice(0, max).join('') : clean; };

/** The historical rows: legacy order 1..n, each with a customer number, a representative's name and specifications. */
export function readSource(file) {
  const source = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = Array.isArray(source) ? source : source?.requests;
  if (!Array.isArray(rows) || !rows.length) throw new Error('the source has no requests');
  const seen = new Set();
  for (const row of rows) {
    if (!Number.isInteger(row?.legacyOrderNo) || row.legacyOrderNo < 1 || seen.has(row.legacyOrderNo)) throw new Error('every row needs a distinct legacyOrderNo');
    if (!Number.isInteger(row.customer?.crmNumber)) throw new Error('row ' + row.legacyOrderNo + ' has no customer number');
    seen.add(row.legacyOrderNo);
  }
  return rows.sort((a, b) => a.legacyOrderNo - b.legacyOrderNo);
}

/** What the CRM holds to match against: customers by Yourrest number and by ERP code, representatives by name. */
export function readCrm(db) {
  const customers = db.prepare("SELECT r.id, r.data, n.number FROM crm_records r LEFT JOIN crm_customer_numbers n ON n.customer_id = r.id WHERE r.kind = 'customer'").all()
    .map(row => ({id: row.id, number: row.number, data: JSON.parse(row.data)}));
  const byNumber = new Map(), byErp = new Map();
  for (const customer of customers) {
    if (Number.isInteger(customer.number)) byNumber.set(customer.number, customer);
    const code = String(customer.data.code ?? '').trim();
    if (code) byErp.set(code, [...(byErp.get(code) || []), customer]);
  }
  const reps = db.prepare("SELECT id, name, email, active FROM crm_members WHERE role = 'rep'").all();
  const byName = new Map();
  for (const rep of reps) { const key = sameName(rep.name); byName.set(key, [...(byName.get(key) || []), rep]); }
  const linked = new Map(db.prepare('SELECT legacy_order_no AS legacy, id FROM crm_mold_requests WHERE legacy_order_no IS NOT NULL').all().map(row => [row.legacy, row.id]));
  return {byNumber, byErp, byName, linked};
}

const customerBy = (crm, key, number) => {
  if (key === 'yourrest') { const found = crm.byNumber.get(number); return found ? {customer: found} : {reason: 'customer_not_found'}; }
  const found = crm.byErp.get(String(number)) || [];
  return found.length === 1 ? {customer: found[0]} : {reason: found.length ? 'customer_ambiguous' : 'customer_not_found'};
};

/** Read-only: for each row, whether its customer number is a Yourrest number, an ERP code, both or neither. */
export function compare(rows, crm) {
  const result = {rows: rows.length, yourrest: 0, erp: 0, both: 0, neither: [], onlyYourrest: [], onlyErp: [], erpAmbiguous: []};
  for (const row of rows) {
    const yr = crm.byNumber.has(row.customer.crmNumber), erp = (crm.byErp.get(String(row.customer.crmNumber)) || []).length;
    if (yr) result.yourrest++;
    if (erp === 1) result.erp++;
    if (erp > 1) result.erpAmbiguous.push(row.legacyOrderNo);
    if (yr && erp === 1) result.both++;
    else if (yr) result.onlyYourrest.push(row.legacyOrderNo);
    else if (erp === 1) result.onlyErp.push(row.legacyOrderNo);
    else if (!erp) result.neither.push(row.legacyOrderNo);
  }
  return result;
}

/** What each row becomes: the CRM request (id, member, customer, data) or the reason it is skipped. Pure, for the dry run and apply. */
export function plan(rows, crm, key) {
  const items = [];
  for (const row of rows) {
    const legacy = row.legacyOrderNo, id = 'mr-legacy-' + legacy;
    if (crm.linked.has(legacy)) { items.push({legacy, id: crm.linked.get(legacy), skip: 'already_linked'}); continue; }
    const found = customerBy(crm, key, row.customer.crmNumber);
    if (!found.customer) { items.push({legacy, skip: found.reason}); continue; }
    const reps = crm.byName.get(sameName(row.salesmanName)) || [];
    if (reps.length !== 1) { items.push({legacy, skip: reps.length ? 'representative_ambiguous' : 'representative_not_found', salesmanName: row.salesmanName}); continue; }
    if (!Number.isInteger(found.customer.number)) { items.push({legacy, skip: 'customer_has_no_yourrest_number'}); continue; }
    const specs = {...row.specs};
    // Rows 12 onward kept the mold code in the design-link column; like production, the CRM keeps only an https link.
    const designDropped = !!specs.designUrl && !/^https:\/\//i.test(String(specs.designUrl));
    if (designDropped) specs.designUrl = '';
    const checked = validateMoldSpecs(specs);
    if (Object.keys(checked.errors).length) { items.push({legacy, skip: 'specs_invalid', fields: Object.keys(checked.errors)}); continue; }
    const rep = reps[0], customer = found.customer;
    const data = {
      requestedAt: String(row.requestedAt || ''),
      customer: {crmNumber: customer.number, name: text(customer.data.name, MOLD_LIMITS.customerName), address: text(customer.data.address, MOLD_LIMITS.address), city: text(customer.data.city, MOLD_LIMITS.city)},
      salesman: {crmMemberId: rep.id, name: text(rep.name, MOLD_LIMITS.salesmanName), email: text(rep.email, MOLD_LIMITS.email)},
      specs: checked.specs
    };
    if (!data.customer.name) { items.push({legacy, skip: 'customer_has_no_name'}); continue; }
    items.push({legacy, id, memberId: rep.id, customerId: customer.id, data, designDropped, customerName: data.customer.name, salesmanName: rep.name});
  }
  return items;
}

const summary = (items, showNames) => {
  const out = {toLink: [], skipped: {}, designLinksDropped: 0};
  for (const item of items) {
    if (item.skip) { (out.skipped[item.skip] ||= []).push(showNames && item.salesmanName ? item.legacy + ' (' + item.salesmanName + ')' : item.legacy); continue; }
    out.toLink.push(showNames ? item.legacy + ' ' + item.customerName + ' / ' + item.salesmanName : item.legacy);
    if (item.designDropped) out.designLinksDropped++;
  }
  return out;
};

/** Links one planned row at production, then saves it in the CRM as accepted. Production first: a failed link saves nothing. */
async function link(db, config, item, {fetch, now}) {
  const body = moldRequestBody({id: item.id, legacyOrderNo: item.legacy, requestedAt: item.data.requestedAt, customer: item.data.customer, salesman: item.data.salesman, specs: item.data.specs});
  const answer = await callProducts(config, 'requests', body, {fetch, now});
  if (answer.kind !== 'ok') return {legacy: item.legacy, linked: false, code: answer.code, http: answer.http, fields: answer.fields};
  const remote = moldStatusObject(answer.json.request), at = new Date(now()).toISOString(), data = JSON.stringify(item.data);
  if (!remote || remote.orderNo !== item.legacy) return {legacy: item.legacy, linked: false, code: 'unexpected_order', http: answer.http};
  const saved = db.prepare("INSERT OR IGNORE INTO crm_mold_requests(id,member_id,customer_id,legacy_order_no,data,accepted,remote,remote_at,created_by,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,'mold-import',?,?,1,'mold-import')")
    .run(item.id, item.memberId, item.customerId, item.legacy, data, data, JSON.stringify(remote), at, at, at);
  return {legacy: item.legacy, linked: true, saved: Number(saved.changes) === 1, newlyLinked: answer.json.linked === true, status: remote.status};
}

export async function main(argv = process.argv.slice(2), {fetch = globalThis.fetch, now = Date.now, log = text => console.log(text)} = {}) {
  const arg = name => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  const source = arg('--source'), key = arg('--key'), apply = argv.includes('--apply'), dryRun = argv.includes('--dry-run'), showNames = argv.includes('--show-names');
  if (!source) throw new Error('--source <mold-requests-source.json> is required');
  if (!argv.includes('--compare') && !['yourrest', 'erp'].includes(key)) throw new Error('--key yourrest or --key erp (after --compare)');
  if (!argv.includes('--compare') && apply === dryRun) throw new Error('choose --dry-run or --apply');
  const app = process.env.MOLD_IMPORT_APP || path.join(process.env.HOME || '/home/youriedx', 'yourrest-crm');
  let settings = {};
  if (!process.env.MOLD_IMPORT_DATABASE) settings = require(path.join(app, 'release', 'operations', 'config.cjs')).loadSettings(app);
  const database = process.env.MOLD_IMPORT_DATABASE || settings.YR_DATABASE_PATH;
  const rows = readSource(source);
  const db = new DatabaseSync(database, {readOnly: !apply});
  try {
    const crm = readCrm(db);
    if (argv.includes('--compare')) { const report = {mode: 'compare', readOnly: true, ...compare(rows, crm)}; log(JSON.stringify(report, null, 1)); return report; }
    const items = plan(rows, crm, key);
    if (dryRun) { const report = {mode: 'dry-run', readOnly: true, key, rows: rows.length, ...summary(items, showNames)}; log(JSON.stringify(report, null, 1)); return report; }
    const config = moldConfig(process.env.MOLD_IMPORT_DATABASE ? {YR_PRODUCTS_API_URL: process.env.MOLD_IMPORT_PRODUCTS_URL, YR_PRODUCTS_SECRET: process.env.MOLD_IMPORT_PRODUCTS_SECRET} : settings);
    if (!config.ok) throw new Error('the production link is not configured (' + config.reason + ') in settings.cjs');
    const results = [];
    for (const item of items.filter(item => !item.skip)) results.push(await link(db, config, item, {fetch, now}));
    const report = {mode: 'apply', key, rows: rows.length, ...summary(items, showNames), linked: results.filter(result => result.linked).map(result => result.legacy), failed: results.filter(result => !result.linked)};
    delete report.toLink;
    log(JSON.stringify(report, null, 1));
    return report;
  } finally { db.close(); }
}

if (import.meta.url === 'file://' + process.argv[1]) main().catch(error => { console.error('MOLD IMPORT STOP: ' + error.message); process.exitCode = 2; });
