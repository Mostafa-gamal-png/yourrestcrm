// The read-only count of Android versions on the phones (scripts/diagnose/app-versions.cjs) on a synthetic database built from the
// real migrations: the latest Android report of each active member by version and role, the representatives by version and by how
// recent their report is, the ones with no Android report, no inactive member, no browser report, no name, email or id printed, and
// the database unchanged. No network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';

const root = process.cwd(), require = createRequire(import.meta.url);
const {run} = require(path.join(root, 'scripts/diagnose/app-versions.cjs'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yr-diagnose-versions-')), file = path.join(temp, 'database.sqlite');
process.on('exit', () => fs.rmSync(temp, {recursive: true, force: true}));
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

const db = new DatabaseSync(file);
for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter(n => /^\d+.*\.sql$/.test(n)).sort()) db.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8').replaceAll('--> statement-breakpoint', ''));
const now = Date.parse('2026-11-01T07:00:00Z'), hoursAgo = h => new Date(now - h * 3600_000).toISOString();
const columns = db.prepare('PRAGMA table_info(crm_members)').all().map(c => c.name);
const member = (id, role, active = 1) => {
  const values = {id, user_id: 'u-' + id, email: id + '@yourrest.org', name: 'SECRET-NAME-' + id, role, branch: 'main', region_scope: 'all', active, target: 0, created_at: hoursAgo(500), updated_at: hoursAgo(500)};
  const keys = Object.keys(values).filter(k => columns.includes(k));
  db.prepare(`INSERT INTO crm_members(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...keys.map(k => values[k]));
};
const device = (id, platform, version, at) => db.prepare('INSERT INTO crm_member_devices(member_id,platform,app_version,reported_at,data) VALUES(?,?,?,?,?)').run(id, platform, version, at, '{}');
for (const id of ['r1', 'r2', 'r3', 'r4', 'r5']) member(id, 'rep');
member('r-old', 'rep', 0); member('s1', 'supervisor'); member('m1', 'manager');
device('r1', 'android-app', '1.0.11', hoursAgo(1));
device('r2', 'android-app', '1.0.10', hoursAgo(3));
device('r3', 'android-app', '1.0.10', hoursAgo(30));
device('r4', 'browser', null, hoursAgo(1));
device('r-old', 'android-app', '1.0.9', hoursAgo(1));
device('s1', 'android-app', '1.0.11', hoursAgo(5));
db.close();
const digest = () => createHash('sha256').update(fs.readFileSync(file)).digest('hex'), before = digest();

process.env.YR_DIAG_DATABASE = file;
const report = run(now), printed = JSON.stringify(report);
eq(report.readOnly, true, 'the report says it read only');
eq(report.activeMembers, 7, 'active members only');
eq(report.representatives, {total: 5, byVersion: {'1.0.11': 1, '1.0.10': 2}, reportedLast24h: {'1.0.11': 1, '1.0.10': 1}, reportedLast2h: {'1.0.11': 1}, noAndroidReport: 2}, 'the representatives by version, by how recent, and without an Android report (a browser report is not one)');
eq(report.byRole, {rep: {'1.0.11': 1, '1.0.10': 2, 'no android report': 2}, supervisor: {'1.0.11': 1}, manager: {'no android report': 1}}, 'every active member by role and version');
eq(report.newestReportOfVersion, {'1.0.11': hoursAgo(1), '1.0.10': hoursAgo(3)}, 'the newest report of each version');
eq(report.verdict, 'REPRESENTATIVES 5: 1.0.11: 1, 1.0.10: 2, NO ANDROID REPORT: 2', 'the verdict');
ok(!printed.includes('SECRET-NAME') && !printed.includes('@yourrest.org') && !/"r\d"|r-old|"s1"|"m1"/.test(printed), 'no name, email or member id is printed');
eq(digest(), before, 'the database is unchanged');

console.log(JSON.stringify({ok: true, checks, realHostingTested: false}));
