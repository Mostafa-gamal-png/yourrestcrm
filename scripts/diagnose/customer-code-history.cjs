'use strict';
// Read-only check (2026-11-03, the owner's report that YR-C-000302's ERP code «جه غلط بعد ما حدّثته»): the ERP code history of one CRM
// customer, by its Yourrest number. Prints only codes, Yourrest numbers, actions, roles and times: its current ERP code and version, the
// old codes kept as aliases, the explicit code mappings that point to it, its audit entries (an ERP import's from/to and row number; a
// form save's time and the saver's role), and which customers hold the ERP numbers asked about (their Yourrest numbers only). It opens
// the database read-only and changes nothing: no names, phones, emails, addresses or settings values are printed.
//   node customer-code-history.cjs              on the hosting account (the database through yourrest-crm/settings.cjs)
//   YR_DIAG_DATABASE=<file> node ...           on a copy
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const CUSTOMER_NUMBER = 302, CODES = ['1', '7', '345'];

function databaseFile() {
  if (process.env.YR_DIAG_DATABASE) return path.resolve(process.env.YR_DIAG_DATABASE);
  const app = path.join(process.env.HOME || '/home/youriedx', 'yourrest-crm');
  const {loadSettings} = require(path.join(app, 'release', 'operations', 'config.cjs'));
  return path.resolve(loadSettings(app).YR_DATABASE_PATH);
}
const key = value => String(value ?? '').replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6F0)).replace(/\s+/g, '').toUpperCase();

function main() {
  const file = databaseFile();
  if (!fs.existsSync(file)) throw new Error('DATABASE_NOT_FOUND');
  const db = new DatabaseSync(file, {readOnly: true});
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000;');
    const number = id => db.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').get(id)?.number ?? null;
    const row = db.prepare("SELECT r.id,r.version,r.updated_at AS updatedAt,json_extract(r.data,'$.code') AS code FROM crm_records r JOIN crm_customer_numbers n ON n.customer_id=r.id WHERE n.number=? AND r.kind='customer'").get(CUSTOMER_NUMBER);
    if (!row) { console.log(JSON.stringify({customer: 'YR-C-' + String(CUSTOMER_NUMBER).padStart(6, '0'), found: false})); return; }
    const roles = new Map(db.prepare('SELECT name,role FROM crm_members').all().map(m => [m.name, m.role]));
    const audits = db.prepare('SELECT action,actor,detail,created_at AS at FROM crm_audit WHERE record_id=? ORDER BY created_at').all(row.id).map(a => {
      let detail = {}; try { detail = JSON.parse(a.detail); } catch { /* a plain-text detail (a form save writes the customer's name) is not printed */ }
      const entry = {at: a.at, action: a.action, by: a.actor === 'system' ? 'system' : roles.get(a.actor) || 'unknown-role'};
      if (a.action === 'erp-customer-code') Object.assign(entry, {from: detail.from ?? null, to: detail.to ?? null, erpRow: detail.row ?? null});
      return entry;
    });
    const holders = Object.fromEntries(CODES.map(code => {
      const current = db.prepare("SELECT n.number,json_extract(r.data,'$.code') AS code FROM crm_records r JOIN crm_customer_numbers n ON n.customer_id=r.id WHERE r.kind='customer' AND json_extract(r.data,'$.code') IS NOT NULL").all().filter(x => key(x.code) === key(code)).map(x => x.number);
      const aliases = db.prepare('SELECT customer_id AS id,source_code AS code FROM crm_customer_code_aliases').all().filter(x => key(x.code) === key(code)).map(x => number(x.id));
      const mapping = db.prepare('SELECT code_key,customer_id AS id,updated_at AS at FROM crm_customer_code_mappings').all().filter(x => key(x.code_key) === key(code)).map(x => ({to: number(x.id), at: x.at}));
      return [code, {currentCodeOf: current, aliasOf: aliases, mappedTo: mapping}];
    }));
    const out = {
      customer: 'YR-C-' + String(CUSTOMER_NUMBER).padStart(6, '0'),
      currentErpCode: row.code ?? null, version: row.version, updatedAt: row.updatedAt,
      aliases: db.prepare('SELECT source_code AS code FROM crm_customer_code_aliases WHERE customer_id=? ORDER BY source_code').all(row.id).map(x => x.code),
      mappingsToIt: db.prepare('SELECT code_key AS code,updated_at AS at FROM crm_customer_code_mappings WHERE customer_id=? ORDER BY code_key').all(row.id),
      audit: audits, holders,
    };
    console.log(JSON.stringify(out, null, 2));
    console.log('VERDICT: current ' + out.currentErpCode + ' | aliases ' + out.aliases.join(',') + ' | erp imports ' + audits.filter(a => a.action === 'erp-customer-code').length + ' | form saves ' + audits.filter(a => a.action === 'تعديل').length);
  } finally { db.close(); }
}
try { main(); } catch (error) { console.log('STOP: ' + (error && error.message ? error.message.replace(/\/home\/[^\s]*/g, '<path>') : 'error')); process.exitCode = 1; }
