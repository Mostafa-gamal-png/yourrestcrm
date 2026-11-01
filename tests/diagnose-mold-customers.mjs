// The read-only check of the customer list sent to the products application (scripts/diagnose/mold-customers.cjs) on a synthetic
// database built from the real migrations: before any send it tells "nobody used the CRM" from "used but nothing recorded", after
// sends it gives the newest first with their counts, the CRM customers that would go (a Yourrest number and a name), the settings
// as true/false only, no name, code, fingerprint or setting value printed, and the database unchanged. No network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';

const root = process.cwd(), require = createRequire(import.meta.url);
const {run} = require(path.join(root, 'scripts/diagnose/mold-customers.cjs'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yr-diagnose-mold-customers-')), file = path.join(temp, 'database.sqlite');
process.on('exit', () => fs.rmSync(temp, {recursive: true, force: true}));
delete process.env.YR_DIAG_SINCE;
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

const db = new DatabaseSync(file);
for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter(n => /^\d+.*\.sql$/.test(n)).sort()) db.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8').replaceAll('--> statement-breakpoint', ''));
const now = Date.parse('2026-11-01T15:00:00Z'), deployed = '2026-11-01T14:34:00.000Z', minutesAgo = m => new Date(now - m * 60_000).toISOString();
const customer = (id, data, number) => {
  db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,'customer',NULL,'rep-1','main',?,?,?,1)").run(id, JSON.stringify(data), minutesAgo(9000), minutesAgo(9000));
  // The migrations number every new customer; the test pins the number, or takes it away to stand for a customer without one.
  if (number) db.prepare('UPDATE crm_customer_numbers SET number = ? WHERE customer_id = ?').run(number, id);
  else db.prepare('DELETE FROM crm_customer_numbers WHERE customer_id = ?').run(id);
};
customer('c1', {name: 'SECRET-CUSTOMER-1', city: 'الدمام'}, 4101);
customer('c2', {name: 'SECRET-CUSTOMER-2'}, 4102);
customer('c3', {name: '   '}, 4103);
customer('c4', {name: 'SECRET-CUSTOMER-4'}, null);
db.close();
const digest = () => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const settings = {YR_PRODUCTS_API_URL: 'https://products.example.test/crm-api.php', YR_PRODUCTS_SECRET: 'SECRET-KEY-'.padEnd(64, 'x')};
process.env.YR_DIAG_SINCE = deployed;
const report = (options = {}) => run({file, settings, home: null, ...options}, now);

let before = digest(), result = report();
eq(result.readOnly, true, 'the report says it read only');
eq(result.crm, {customers: 4, withYourrestNumber: 3, withNumberAndName: 2}, 'the CRM customers that would go: a Yourrest number and a name');
eq(result.settings, {productsUrlPresent: true, productsSecretPresent: true}, 'the settings as present or not');
eq(result.sends, {total: 0, latest: []}, 'no send yet');
eq(result.activity, {since: deployed, signIns: 0, newSessions: 0, phoneReports: 0, recordChanges: 0}, 'nobody used the CRM since the update');
eq(result.verdict, 'NOT SENT YET: NOBODY HAS USED THE CRM SINCE THE UPDATE (THE FIRST PAGE THAT LOADS STARTS IT)', 'not sent, nobody came');
eq(report({settings: {YR_PRODUCTS_API_URL: settings.YR_PRODUCTS_API_URL}}).verdict, 'NOT SENT: THE PRODUCTS SETTINGS ARE MISSING', 'a missing setting is named');
eq(report({settings: null}).settings, 'not read (copy)', 'a copy reads no settings');
eq(digest(), before, 'the database is unchanged by a read');

const write = new DatabaseSync(file);
write.prepare("INSERT INTO auth_events(id,user_id,event,created_at) VALUES('e1',NULL,'login_success',?)").run(Date.parse(minutesAgo(20)));
write.prepare("INSERT INTO auth_events(id,user_id,event,created_at) VALUES('e0',NULL,'login_success',?)").run(Date.parse(minutesAgo(90)));
write.close();
result = report();
eq(result.activity.signIns, 1, 'only the sign-ins after the update count');
eq(result.verdict, 'NOT SENT: THE CRM WAS USED BUT NO SEND IS RECORDED (A FAILED SEND WAITS FOR THE NEXT 10-MINUTE CHECK)', 'used but not sent');

const audit = new DatabaseSync(file);
const send = (id, at, detail) => audit.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,'mold-customers','system','mold-customers:sync',?,?)").run(id, JSON.stringify(detail), at);
send('a1', minutesAgo(19), {label: 'إرسال', mode: 'full', calls: 1, count: 2, sheetCities: 1, hash: 'SECRET-HASH-1', received: 2, inserted: 2, updated: 0, deactivated: 0, activeCustomers: 2});
send('a2', minutesAgo(5), {label: 'إرسال', mode: 'full', calls: 1, count: 2, sheetCities: 1, hash: 'SECRET-HASH-2', received: 2, inserted: 0, updated: 1, deactivated: 0, activeCustomers: 2});
audit.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES('other','c1','system','customer:update','{}',?)").run(minutesAgo(3));
audit.close();
before = digest();
result = report();
eq(result.sends.total, 2, 'every send counts, nothing else in the audit');
eq(result.sends.latest.map(entry => entry.at), [minutesAgo(5), minutesAgo(19)], 'the newest send first');
eq(result.sends.latest[1], {at: minutesAgo(19), mode: 'full', calls: 1, count: 2, sheetCities: 1, received: 2, inserted: 2, updated: 0, deactivated: 0, activeCustomers: 2}, 'a send with its counts and nothing else');
eq(result.verdict, `SENT: 2 SEND(S), LATEST ${minutesAgo(5)} (full, 1 CALL(S)): CRM 2, RECEIVED 2, INSERTED 0, UPDATED 1, DEACTIVATED 0, ACTIVE IN PRODUCTS 2`, 'the verdict names the newest send');
const printed = JSON.stringify(result);
ok(!printed.includes('SECRET-') && !printed.includes('example.test') && !/410[1-4]|"c[1-4]"/.test(printed), 'no name, code, fingerprint, setting value or record id is printed');
eq(digest(), before, 'the database is unchanged');

console.log(JSON.stringify({ok: true, checks, realHostingTested: false}));
