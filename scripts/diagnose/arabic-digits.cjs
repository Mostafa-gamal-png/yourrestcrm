'use strict';
// Read-only check (2026-10-31): do invoice numbers or customer codes written with Arabic digits (١٢٣ or ۱۲۳) keep the same invoice or
// the same customer apart from its ERP twin? The keys the application compares (lib/invoice-reference.ts, lib/customer-identity.ts)
// fold marks, wide letters, spaces and case, but not Arabic digits: "INV-١٠٢٣" and "INV-1023" are two invoices to them.
// It opens the database read-only, changes nothing, and prints counts, totals and record ids only: no names, phones or references.
//   node arabic-digits.cjs            on the hosting account (finds the database through yourrest-crm/settings.cjs)
//   YR_DIAG_DATABASE=<file> node ...  on a copy
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');

const ARABIC = /[٠-٩۰-۹]/;
const fold = value => value.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0));
// The application's keys, as they are today, and the same keys with Arabic digits folded.
const invoiceKey = value => String(value ?? '').normalize('NFKC').replace(/[​-‏‪-‮⁦-⁩﻿]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const codeKey = value => String(value ?? '').normalize('NFKC').trim().toUpperCase();
const SAMPLE = 5;

function databaseFile() {
  if (process.env.YR_DIAG_DATABASE) return path.resolve(process.env.YR_DIAG_DATABASE);
  const home = process.env.HOME || '/home/youriedx', app = path.join(home, 'yourrest-crm');
  const {loadSettings} = require(path.join(app, 'release', 'operations', 'config.cjs'));
  return path.resolve(loadSettings(app).YR_DATABASE_PATH);
}

function run() {
  const db = new DatabaseSync(databaseFile(), {readOnly: true});
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const has = name => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  const report = {checkedAt: new Date().toISOString(), readOnly: true};
  const sar = cents => Math.round(cents) / 100;

  // ---- manual sales
  const sales = has('crm_sales') ? all("SELECT id,customer_id,date,reference,reference_key,status,total_cents FROM crm_sales") : [];
  const confirmed = sales.filter(row => row.status === 'confirmed');
  const arabicSales = confirmed.filter(row => ARABIC.test(row.reference));
  // Two confirmed sales of one customer that are one invoice once Arabic digits are folded (the unique index lets them both in).
  const byFolded = new Map();
  for (const row of confirmed) { const key = row.customer_id + '|' + fold(invoiceKey(row.reference)); const list = byFolded.get(key) || []; list.push(row); byFolded.set(key, list); }
  const manualTwins = [...byFolded.values()].filter(list => new Set(list.map(row => invoiceKey(row.reference))).size > 1);
  report.manualSales = {total: sales.length, confirmed: confirmed.length, withArabicDigits: arabicSales.length, totalSarWithArabicDigits: sar(arabicSales.reduce((sum, row) => sum + row.total_cents, 0)),
    sameInvoiceTwiceForOneCustomer: manualTwins.length, examples: arabicSales.slice(0, SAMPLE).map(row => row.id)};

  // ---- ERP sales against manual sales: the import refuses an ERP invoice already entered by hand, by year and invoice key
  const erp = has('crm_erp_sales') ? all("SELECT id,date,reference,document_type,customer_code,total_cents FROM crm_erp_sales") : [];
  const erpSales = erp.filter(row => row.document_type === 'sale');
  const manualToday = new Set(confirmed.map(row => row.date.slice(0, 4) + '|' + invoiceKey(row.reference)));
  const manualFolded = new Set(confirmed.map(row => row.date.slice(0, 4) + '|' + fold(invoiceKey(row.reference))));
  const missedConflicts = erpSales.filter(row => !manualToday.has(row.date.slice(0, 4) + '|' + invoiceKey(row.reference)) && manualFolded.has(row.date.slice(0, 4) + '|' + fold(invoiceKey(row.reference))));
  report.erpSales = {total: erp.length, sales: erpSales.length, referencesWithArabicDigits: erp.filter(row => ARABIC.test(row.reference)).length, customerCodesWithArabicDigits: erp.filter(row => ARABIC.test(row.customer_code)).length,
    countedTwiceWithAManualSale: missedConflicts.length, totalSarCountedTwice: sar(missedConflicts.reduce((sum, row) => sum + row.total_cents, 0)), examples: missedConflicts.slice(0, SAMPLE).map(row => row.id)};

  // ---- customer codes
  const customers = has('crm_records') ? all("SELECT id,data FROM crm_records WHERE kind='customer'").map(row => { let data = {}; try { data = JSON.parse(row.data); } catch { /* counted below */ } return {id: row.id, data}; }) : [];
  const aliases = has('crm_customer_code_aliases') ? all('SELECT customer_id,source_code FROM crm_customer_code_aliases') : [];
  const mappings = has('crm_customer_code_mappings') ? all('SELECT code_key,customer_id FROM crm_customer_code_mappings') : [];
  const codesOf = new Map(customers.map(row => [row.id, [row.data.code].filter(value => typeof value === 'string' && codeKey(value))]));
  for (const alias of aliases) if (codesOf.has(alias.customer_id) && codeKey(alias.source_code)) codesOf.get(alias.customer_id).push(alias.source_code);
  const arabicCustomers = [...codesOf].filter(([, codes]) => codes.some(code => ARABIC.test(code))).map(([id]) => id);
  // Customers whose codes become one code once Arabic digits are folded (today they are two).
  const owners = new Map();
  for (const [id, codes] of codesOf) for (const code of new Set(codes.map(value => fold(codeKey(value))))) { const set = owners.get(code) || new Set(); set.add(id); owners.set(code, set); }
  const todayOwners = new Map();
  for (const [id, codes] of codesOf) for (const code of new Set(codes.map(codeKey))) { const set = todayOwners.get(code) || new Set(); set.add(id); todayOwners.set(code, set); }
  const newlyShared = [...owners].filter(([code, ids]) => ids.size > 1 && ![...todayOwners].some(([today, set]) => fold(today) === code && [...ids].every(id => set.has(id)))).length;
  // ERP sales whose customer code finds its customer only once Arabic digits are folded (today they reach no customer).
  const todayCodes = new Set([...todayOwners.keys()]), foldedCodes = new Set([...owners.keys()]);
  const unattributed = erpSales.filter(row => !todayCodes.has(codeKey(row.customer_code)) && foldedCodes.has(fold(codeKey(row.customer_code))));
  report.customerCodes = {customers: customers.length, customersWithArabicDigitCodes: arabicCustomers.length, aliasesWithArabicDigits: aliases.filter(row => ARABIC.test(row.source_code)).length,
    mappingsWithArabicDigits: mappings.filter(row => ARABIC.test(row.code_key)).length, codesSharedOnlyAfterFolding: newlyShared,
    erpSalesReachingNoCustomerToday: unattributed.length, erpSarReachingNoCustomerToday: sar(unattributed.reduce((sum, row) => sum + row.total_cents, 0)), examples: arabicCustomers.slice(0, SAMPLE)};

  const problems = report.manualSales.sameInvoiceTwiceForOneCustomer + report.erpSales.countedTwiceWithAManualSale + report.customerCodes.codesSharedOnlyAfterFolding + report.customerCodes.erpSalesReachingNoCustomerToday;
  const written = report.manualSales.withArabicDigits + report.erpSales.referencesWithArabicDigits + report.erpSales.customerCodesWithArabicDigits + report.customerCodes.customersWithArabicDigitCodes + report.customerCodes.aliasesWithArabicDigits;
  report.verdict = problems ? 'ARABIC DIGITS SPLIT RECORDS THAT ARE THE SAME: ' + problems : written ? 'ARABIC DIGITS PRESENT, NOTHING SPLIT YET: ' + written : 'NO ARABIC DIGITS IN INVOICE NUMBERS OR CUSTOMER CODES';
  db.close();
  return report;
}

if (require.main === module) {
  try { const report = run(); console.log(JSON.stringify(report, null, 2)); console.log(report.verdict); }
  catch (error) { console.log('DIAGNOSE STOP: ' + (error && error.message ? error.message : String(error))); process.exitCode = 1; }
}
module.exports = {run, fold, invoiceKey, codeKey};
