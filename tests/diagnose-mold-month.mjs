// The read-only count of a month's mold requests per sales manager (scripts/diagnose/mold-month.cjs) on a synthetic database: the
// requests of the current and the previous Riyadh month (a request asked at 01:00 Riyadh on the 1st is the new month's), how many each
// active sales manager's list holds and why the others are not in it, how many of those he approves, and the requests asked in another
// month than they were created. It prints member ids cut to 8 characters and counts only (no names, customers or codes), and the
// database is unchanged. No network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';

const root = process.cwd(), require = createRequire(import.meta.url);
const {run, teamManager} = require(path.join(root, 'scripts/diagnose/mold-month.cjs'));
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'yr-diagnose-mold-month-'));
process.on('exit', () => fs.rmSync(folder, {recursive: true, force: true}));
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const SECRET = 'PRIVATE-CUSTOMER-0551234567';

const file = path.join(folder, 'database.sqlite'), db = new DatabaseSync(file);
db.exec("CREATE TABLE crm_mold_requests(id TEXT, member_id TEXT, customer_id TEXT, data TEXT, cancelled_at TEXT, created_at TEXT); CREATE TABLE crm_members(id TEXT, name TEXT, role TEXT, supervisor_id TEXT, region_scope TEXT, active INT); CREATE TABLE crm_records(id TEXT, kind TEXT, data TEXT)");
const member = (id, role, supervisor = null, scope = 'central', active = 1) => db.prepare('INSERT INTO crm_members VALUES (?,?,?,?,?,?)').run(id, SECRET, role, supervisor, scope, active);
member('manager-central', 'manager'); member('manager-west', 'manager', null, 'western'); member('manager-gone', 'manager', null, 'central', 0);
member('supervisor-1', 'supervisor', 'manager-central'); member('rep-1', 'rep', 'supervisor-1'); member('marketing-1', 'marketing', 'manager-central');
member('rep-west', 'rep', 'manager-west', 'western'); member('cs-1', 'customer_service', null); member('admin-1', 'admin', null, 'all');
db.prepare('INSERT INTO crm_records VALUES (?,?,?)').run('customer-central', 'customer', JSON.stringify({region: 'الوسطى', name: SECRET}));
db.prepare('INSERT INTO crm_records VALUES (?,?,?)').run('customer-west', 'customer', JSON.stringify({region: 'المنطقة الغربية', name: SECRET}));
const request = (id, memberId, customerId, requestedAt, createdAt = requestedAt, cancelled = null) =>
  db.prepare('INSERT INTO crm_mold_requests VALUES (?,?,?,?,?,?)').run(id, memberId, customerId, JSON.stringify({requestedAt, customer: {name: SECRET}}), cancelled, createdAt);
request('team-rep', 'rep-1', 'customer-central', '2026-11-03T08:00:00.000Z');
request('team-marketing', 'marketing-1', 'customer-central', '2026-11-04T08:00:00.000Z');
request('first-of-month', 'rep-1', 'customer-central', '2026-10-31T22:00:00.000Z');
request('admin', 'admin-1', 'customer-central', '2026-11-05T08:00:00.000Z');
request('service', 'cs-1', 'customer-central', '2026-11-06T08:00:00.000Z', undefined, '2026-11-07T08:00:00.000Z');
request('other-team', 'rep-west', 'customer-west', '2026-11-08T08:00:00.000Z');
request('team-outside', 'rep-1', 'customer-west', '2026-11-09T08:00:00.000Z');
request('deleted-customer', 'rep-1', 'customer-gone', '2026-11-10T08:00:00.000Z');
request('sheet', 'rep-1', 'customer-central', '2026-10-12T08:00:00.000Z', '2026-11-02T08:00:00.000Z');
request('older', 'rep-1', 'customer-central', '2026-09-12T08:00:00.000Z');
db.close();
const before = createHash('sha256').update(fs.readFileSync(file)).digest('hex');

process.env.MOLD_DIAG_DATABASE = file; process.env.MOLD_DIAG_NOW = '2026-11-19T06:00:00.000Z';
const report = run(), [november, october] = report.months;
eq([report.readOnly, report.today, report.total, november.month, october.month], [true, '2026-11-19', 10, '2026-11', '2026-10'], 'today in Riyadh, the current and the previous month');
eq([november.requests, november.cancelled, october.requests], [8, 1, 1], 'a request asked at 01:00 Riyadh on the 1st is November\'s; the cancelled one counted; the sheet request is October\'s by its requestedAt');
eq(november.byRequesterRole, {rep: 5, marketing: 1, admin: 1, customer_service: 1}, 'by the requester\'s role');
eq(november.managers.map(item => item.manager), ['manager-', 'manager-'], 'the active sales managers only, ids cut to 8 characters');
const [central, west] = november.managers;
eq([central.regions, central.visible, central.hidden, central.hiddenApprovedByHim], ['central', 3, 5, 2], 'the central manager: his team\'s three in his region; five not, two of them his to approve (the administrator\'s, customer service\'s)');
eq(central.reasons, {'requester_in_no_managers_team:admin': 1, 'requester_in_no_managers_team:customer_service': 1, requester_in_another_managers_team: 1, customer_outside_his_regions: 1, customer_not_in_crm: 1}, 'and why each of the others is not in his list');
eq([west.visible, west.hidden, west.hiddenApprovedByHim], [1, 7, 1], 'the western manager: his rep\'s one; he approves the central team\'s request for a western customer');
eq(report.requestedMonthDiffersFromCreated, 1, 'the sheet request asked in October and created in November');
eq([teamManager('rep-1', new Map([['rep-1', {id: 'rep-1', role: 'rep', supervisor_id: 'rep-1'}]])), teamManager('nobody', new Map())], ['', ''], 'a cycle or a missing member: no team');
const printed = JSON.stringify(report);
eq([printed.includes(SECRET), printed.includes('customer-central'), printed.includes('rep-1')], [false, false, false], 'no name, no customer and no full member id is printed');
eq(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), before, 'the database is unchanged');
console.log(JSON.stringify({ok: true, checks}));
