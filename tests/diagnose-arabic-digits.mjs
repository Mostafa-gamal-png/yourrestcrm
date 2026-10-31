// The read-only check of Arabic digits in invoice numbers and customer codes (scripts/diagnose/arabic-digits.cjs), on a synthetic
// database built from the real migrations: it finds each way the digits split one record into two (a manual invoice entered twice,
// an ERP invoice counted besides its manual twin, an ERP sale that reaches no customer, two customers sharing a code), counts what
// is merely written in Arabic digits, changes nothing in the file, and prints no reference, name or code. No network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

const root = process.cwd(), require = createRequire(import.meta.url);
const {run, fold, invoiceKey, codeKey} = require(path.join(root, 'scripts/diagnose/arabic-digits.cjs'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'yr-diagnose-digits-')), file = path.join(work, 'database.sqlite');
process.on('exit', () => fs.rmSync(work, {recursive: true, force: true}));
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };

// ---- the keys: as the application's today, and folded
eq(fold('INV-١٠٢٣ ۴۵'), 'INV-1023 45', 'Arabic-Indic and Persian digits fold to plain digits');
eq(invoiceKey('‏inv-١٠٢٣'), 'INV-١٠٢٣', 'the invoice key as today keeps Arabic digits');
eq(codeKey(' c-١٢ '), 'C-١٢', 'the customer key as today keeps Arabic digits');

// ---- a synthetic database from the real migrations
const db = new DatabaseSync(file);
for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter(f => /^\d+.*\.sql$/.test(f)).sort()) db.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8'));
const now = '2026-10-20T08:00:00.000Z';
db.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,active,region_scope,target,created_at) VALUES('rep','u-rep','rep@yourrest.org','مندوب','rep','الرئيسي',1,'all',0,?)").run(now);
const customer = (id, code) => db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')").run(id, JSON.stringify({name: 'عميل سري ' + id, code, phone: '0551234567'}), now, now);
customer('cust-latin', 'C-100');          // ERP sales under C-100 reach it today
customer('cust-arabic', 'C-١٠١');         // ERP sales under C-101 reach it only once folded
customer('cust-twin-a', 'C-200');
customer('cust-twin-b', 'C-٢٠٠');         // the same code as cust-twin-a once folded
customer('cust-alias', 'C-300');
db.prepare("INSERT INTO crm_customer_code_aliases(customer_id,source_code) VALUES('cust-alias','C-٣٠١')").run();
const sale = (id, customerId, reference, cents, status = 'confirmed', date = '2026-10-20') => db.prepare("INSERT INTO crm_sales(id,customer_id,rep_id,branch,date,reference,reference_key,data,total_cents,status,void_reason,version,mutation_id,create_fingerprint,created_by,created_at,updated_at) VALUES(?,?,'rep','الرئيسي',?,?,?,'{}',?,?,'',1,'fixture','{}','rep',?,?)").run(id, customerId, date, reference, invoiceKey(reference), cents, status, now, now);
sale('s1', 'cust-latin', 'INV-1001', 10000);
sale('s2', 'cust-latin', 'INV-١٠٠١', 10000);            // the same invoice entered twice for one customer
sale('s3', 'cust-latin', 'INV-١٠٠٢', 25000);            // its ERP twin is INV-1002
sale('s4', 'cust-latin', 'INV-١٠٠٣', 5000, 'void');     // void: not counted
sale('s5', 'cust-arabic', 'INV-2001', 7000);
db.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('imp','rep','f','erp.xlsx','{}',?)").run(now);
const erp = (id, reference, code, cents, type = 'sale', date = '2026-10-21') => db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'h','m',?,?,?,'e1','rep','الرئيسي','all',?,'اسم من ERP','{}',?,'imp','rep',?)").run(id, 'doc-' + id, reference, type, date, code, cents, now);
erp('e1', 'INV-1002', 'C-100', 25000);                  // counted besides the manual INV-١٠٠٢
erp('e2', 'INV-3001', 'C-101', 40000);                  // C-101 reaches cust-arabic (C-١٠١) only once folded
erp('e3', 'INV-3002', 'C-100', 1000);                   // ordinary
erp('e4', 'INV-١٠٠٤', 'C-٩٩٩', 500);                    // written in Arabic digits, splits nothing
erp('e5', 'INV-1003', 'C-100', 5000);                   // its manual twin INV-١٠٠٣ is void: no double count
erp('e6', 'INV-1002', 'C-100', 25000, 'sale', '2025-12-30'); // another year: another invoice
db.close();
const before = createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// ---- the report
process.env.YR_DIAG_DATABASE = file;
const report = run();
eq(report.readOnly, true, 'the report says it read only');
eq(report.manualSales, {total: 5, confirmed: 4, withArabicDigits: 2, totalSarWithArabicDigits: 350, sameInvoiceTwiceForOneCustomer: 1, examples: ['s2', 's3']}, 'manual sales: two confirmed in Arabic digits (350 SAR), one invoice entered twice for one customer; the void one is not counted');
eq(report.erpSales, {total: 6, sales: 6, referencesWithArabicDigits: 1, customerCodesWithArabicDigits: 1, countedTwiceWithAManualSale: 1, totalSarCountedTwice: 250, examples: ['e1']}, 'ERP: one invoice counted besides its manual twin (250 SAR); a void twin and another year are not counted');
// The database itself keeps every code a customer has had in crm_customer_code_aliases (a trigger of migration 0014), so the two
// Arabic-digit codes are there too, besides the one alias added by hand.
eq(report.customerCodes, {customers: 5, customersWithArabicDigitCodes: 3, aliasesWithArabicDigits: 3, mappingsWithArabicDigits: 0, codesSharedOnlyAfterFolding: 1, erpSalesReachingNoCustomerToday: 1, erpSarReachingNoCustomerToday: 400, examples: ['cust-arabic', 'cust-twin-b', 'cust-alias']}, 'customers: three with Arabic-digit codes, two that share a code once folded, one ERP sale of 400 SAR that reaches no customer today');
eq(report.verdict, 'ARABIC DIGITS SPLIT RECORDS THAT ARE THE SAME: 4', 'the verdict counts what is split');

// ---- read-only, and nothing private printed
eq(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), before, 'the database file is unchanged');
const printed = spawnSync(process.execPath, [path.join(root, 'scripts/diagnose/arabic-digits.cjs')], {env: {...process.env, YR_DIAG_DATABASE: file}, encoding: 'utf8'});
eq(printed.status, 0, 'run on its own it ends well');
eq(printed.stdout.trim().split('\n').at(-1), 'ARABIC DIGITS SPLIT RECORDS THAT ARE THE SAME: 4', 'and ends with the verdict');
for (const secret of ['INV-', 'C-1', 'C-٢', 'عميل سري', 'اسم من ERP', '0551234567', 'rep@yourrest.org']) eq(printed.stdout.includes(secret), false, `prints no "${secret}"`);

// ---- a clean database, and a missing one
const clean = path.join(work, 'clean.sqlite'), cdb = new DatabaseSync(clean);
for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter(f => /^\d+.*\.sql$/.test(f)).sort()) cdb.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8'));
cdb.close();
process.env.YR_DIAG_DATABASE = clean;
eq(run().verdict, 'NO ARABIC DIGITS IN INVOICE NUMBERS OR CUSTOMER CODES', 'a database without Arabic digits says so');
const missing = spawnSync(process.execPath, [path.join(root, 'scripts/diagnose/arabic-digits.cjs')], {env: {...process.env, YR_DIAG_DATABASE: path.join(work, 'none.sqlite')}, encoding: 'utf8'});
eq([missing.status, missing.stdout.startsWith('DIAGNOSE STOP: ')], [1, true], 'a database that is not there stops with DIAGNOSE STOP');
eq(fs.existsSync(path.join(work, 'none.sqlite')), false, 'and is not created');
console.log(JSON.stringify({ok: true, checks}));
