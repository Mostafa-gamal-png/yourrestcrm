'use strict';
// Read-only (2026-11-01): the link dry run with the Yourrest code matched every customer but found no CRM representative for any of
// the 91 earlier mold requests (the tool matches a salesman name letter for letter, spaces and tatweel aside, among role 'rep').
// For each salesman name of the earlier requests, labelled by its first order number: which CRM members come close (any role) and
// exactly how the names differ, and to whom the CRM customers of those orders are assigned. It prints member ids (random), roles,
// counts and the kind of difference only: no names, no emails, no codes. Nothing is written.
//   node mold-reps.cjs                        on the hosting account
//   MOLD_DIAG_APP=<app folder> MOLD_DIAG_SOURCE=<file> MOLD_DIAG_DATABASE=<file> node mold-reps.cjs    on a copy (tests)
// No YR_* variable is ever used or set: the settings check refuses any YR_* value beside settings.cjs.
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {DatabaseSync} = require('node:sqlite');

/** Each step one spelling difference the link tool does not forgive; a name differs by the steps it needs. */
const STEPS = [
  ['spaces', text => text.replace(/\s+/g, '')],
  ['marks', text => text.replace(/[ـً-ٰٟ]/g, '')],
  ['alef', text => text.replace(/[أإآٱ]/g, 'ا')],
  ['ya', text => text.replace(/ى/g, 'ي')],
  ['ta', text => text.replace(/ة/g, 'ه')],
  ['hamza', text => text.replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ء/g, '')],
  ['case', text => text.toLowerCase()]
];
const base = value => String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const loose = (value, skip) => STEPS.reduce((text, [name, step]) => name === skip ? text : step(text), base(value));
/** Words with every letter step, «عبد» kept with the word after it (عبد الرحمن = عبدالرحمن). */
const words = value => loose(base(value).replace(/عبد\s+/g, 'عبد'), 'spaces').split(' ').filter(Boolean);

/** How a CRM member's name differs from a salesman name of the sheet, or null when they are not close. */
function difference(sheet, member) {
  if (loose(sheet) === loose(member)) {
    const needs = STEPS.map(([name]) => name).filter(name => loose(sheet, name) !== loose(member, name));
    return needs.length ? {kind: 'spelling', needs} : {kind: 'same'};
  }
  const a = words(sheet), b = words(member);
  if (a.length && a.every(word => b.includes(word))) return {kind: 'more_words_in_crm', extraWords: b.length - a.length, sameStart: a.every((word, index) => b[index] === word)};
  if (b.length && b.every(word => a.includes(word))) return {kind: 'fewer_words_in_crm', missingWords: a.length - b.length};
  if (a[0] && a[0] === b[0]) return {kind: 'first_word_only'};
  return null;
}

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
  const {readSource, sameName} = await import(pathToFileURL(tool).href);
  const rows = readSource(sourceFile(home));
  const database = process.env.MOLD_DIAG_DATABASE || require(path.join(app, 'release', 'operations', 'config.cjs')).loadSettings(app).YR_DATABASE_PATH;
  const db = new DatabaseSync(database, {readOnly: true});
  try {
    const members = db.prepare('SELECT id, name, role, active FROM crm_members').all();
    const byId = new Map(members.map(member => [member.id, member]));
    const assigned = new Map(db.prepare("SELECT n.number, r.assigned_to FROM crm_customer_numbers n JOIN crm_records r ON r.id = n.customer_id WHERE r.kind = 'customer'").all().map(row => [row.number, row.assigned_to]));
    const who = id => { const member = byId.get(id); return member ? {id, role: member.role, active: member.active === 1} : {id: id ? 'not_a_member' : 'nobody'}; };
    const roles = {};
    for (const member of members) { const role = (roles[member.role] ||= {active: 0, inactive: 0}); role[member.active === 1 ? 'active' : 'inactive']++; }
    const groups = new Map();
    for (const row of rows) {
      const key = sameName(row.salesmanName);
      if (!groups.has(key)) groups.set(key, {name: row.salesmanName, orders: []});
      groups.get(key).orders.push(row.legacyOrderNo);
    }
    const salesmen = [...groups.values()].map(group => {
      const close = members.map(member => ({...who(member.id), ...difference(group.name, member.name)})).filter(item => item.kind);
      const tally = new Map();
      for (const order of group.orders) {
        const number = rows.find(row => row.legacyOrderNo === order).customer.crmNumber, owner = assigned.has(number) ? assigned.get(number) : undefined;
        const key = owner === undefined ? 'customer_not_found' : owner || '';
        tally.set(key, (tally.get(key) || 0) + 1);
      }
      const customersAssignedTo = [...tally].sort((a, b) => b[1] - a[1]).map(([id, orders]) => id === 'customer_not_found' ? {id, orders} : {...who(id), orders});
      return {label: 'salesman of order ' + group.orders[0], orders: group.orders.length, close, customersAssignedTo};
    });
    const latinNames = members.filter(member => /[A-Za-z]/.test(member.name)).length;
    const verdict = salesmen.map(item => {
      const best = item.close.find(close => close.kind === 'same' || close.kind === 'spelling') || item.close.find(close => close.kind.endsWith('_in_crm'));
      const top = item.customersAssignedTo[0];
      const closeText = best ? `${best.kind}${best.needs ? ' (' + best.needs.join('+') + ')' : ''} ${best.role}${best.active ? '' : ' inactive'} ${best.id.slice(0, 8)}` : 'none';
      return `${item.label.toUpperCase()} (${item.orders}): CLOSE ${item.close.length} [${closeText}], CUSTOMERS MOSTLY ${top.id.slice(0, 8)} ${top.role || ''} ${top.orders}/${item.orders}`.replace(/ +/g, ' ');
    }).join('\n');
    return {mode: 'reps', readOnly: true, rows: rows.length, members: roles, latinNames, salesmen, verdict};
  } finally { db.close(); }
}

if (require.main === module) {
  run().then(report => { console.log(JSON.stringify(report, null, 2)); console.log(report.verdict); })
    .catch(error => { console.log('DIAGNOSE STOP: ' + (error && error.message ? error.message : String(error))); process.exitCode = 1; });
}
module.exports = {run, difference};
