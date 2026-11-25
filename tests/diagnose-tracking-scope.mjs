// The read-only check of the phones that refuse tracking after an account change (scripts/diagnose/tracking-scope.cjs) on a synthetic
// database built from the real migrations: a marketing officer whose phone reports «تغيرت أذونات الحساب» while every route day was
// recorded under the five regions ticked one by one and the account now says «كل المناطق», a representative whose region really
// changed, one whose route days match (not listed), an inactive member and a supervisor (never read). Scope kinds, counts, flags and
// times only: no name, email, full member id or region printed, and the database unchanged. No network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';

const root = process.cwd(), require = createRequire(import.meta.url);
const {run, scopeKind, messageKind} = require(path.join(root, 'scripts/diagnose/tracking-scope.cjs'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yr-diagnose-tracking-scope-')), file = path.join(temp, 'database.sqlite');
process.on('exit', () => fs.rmSync(temp, {recursive: true, force: true}));
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

const db = new DatabaseSync(file);
for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter(n => /^\d+.*\.sql$/.test(n)).sort()) db.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8').replaceAll('--> statement-breakpoint', ''));
const now = '2026-11-25T06:00:00.000Z', created = '2026-10-01T08:00:00.000Z';
const columns = db.prepare('PRAGMA table_info(crm_members)').all().map(c => c.name);
const member = (id, role, scope, active = 1) => {
  const values = {id, user_id: 'u-' + id, email: id + '@yourrest.org', name: 'SECRET-NAME-' + id, role, branch: 'main', region_scope: scope, active, target: 0, created_at: created, updated_at: created};
  const keys = Object.keys(values).filter(k => columns.includes(k));
  db.prepare(`INSERT INTO crm_members(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...keys.map(k => values[k]));
};
let serial = 0;
const day = (memberId, scope, date, open = false) => db.prepare('INSERT INTO crm_mobile_route_days(id,member_id,device_id,date,region_scope,started_at,ended_at,data) VALUES(?,?,?,?,?,?,?,?)').run('day-' + (++serial), memberId, '11111111-1111-4111-8111-111111111111', date, scope, date + 'T03:00:00.000Z', open ? null : date + 'T15:00:00.000Z', '{"gaps":[]}');
const device = (memberId, data) => db.prepare('INSERT INTO crm_member_devices(member_id,platform,app_version,reported_at,data) VALUES(?,?,?,?,?)').run(memberId, 'android-app', '1.0.15', '2026-11-25T05:52:00.000Z', JSON.stringify(data));

const FIVE = 'central,eastern,western,northern,southern';
member('marketing-officer-1', 'marketing', 'all');
member('rep-moved-1', 'rep', 'eastern');
member('rep-steady-1', 'rep', 'all');
member('rep-gone-1', 'rep', 'central', 0);
member('sup-1', 'supervisor', 'central');
day('marketing-officer-1', FIVE, '2026-11-20'); day('marketing-officer-1', FIVE, '2026-11-23'); day('marketing-officer-1', FIVE, '2026-11-24', true);
day('rep-moved-1', 'central', '2026-11-22'); day('rep-moved-1', 'eastern', '2026-11-24');
day('rep-steady-1', 'all', '2026-11-24');
day('rep-gone-1', 'all', '2026-11-24');
day('sup-1', 'central', '2026-11-24');
device('marketing-officer-1', {gate: 'setup', missing: ['enrollment'], enrolled: false, tracking: false, pendingCount: 856, pendingGapCount: 67, quarantinedCount: 0, error: 'تغيرت أذونات الحساب؛ محفوظ على الجهاز 856 نقطة و67 انقطاع من المنطقة السابقة. راجع الإدارة؛ الزيارات والخرائط متاحة', syncError: ''});
device('rep-moved-1', {gate: 'setup', missing: ['enrollment'], enrolled: false, tracking: false, pendingCount: 12, pendingGapCount: 0, quarantinedCount: 0, error: 'تغيرت منطقة الحساب؛ محفوظ 12 نقطة و0 انقطاع. راجع الإدارة قبل تفعيل منطقة جديدة؛ الزيارات والخرائط متاحة', syncError: ''});
device('rep-steady-1', {gate: 'ok', missing: [], enrolled: true, tracking: true, pendingCount: 0, pendingGapCount: 0, quarantinedCount: 0, error: '', syncError: ''});
device('rep-gone-1', {gate: 'setup', error: 'تغيرت أذونات الحساب؛ محفوظ على الجهاز 1 نقطة و0 انقطاع من المنطقة السابقة.'});
db.close();
const digest = () => createHash('sha256').update(fs.readFileSync(file)).digest('hex'), before = digest();

eq(scopeKind('all'), {all: true}, 'all regions is one kind');
eq(scopeKind(FIVE), {all: false, regions: 5, ofRegions: 6, unassignedIncluded: false, unknownParts: 0, everyRegionTicked: false}, 'five regions ticked one by one');
eq(scopeKind(FIVE + ',unassigned').everyRegionTicked, true, 'every region ticked one by one');
eq([messageKind(''), messageKind('تغيرت أذونات الحساب؛ …'), messageKind('تغيرت منطقة الحساب؛ …'), messageKind('تغير نطاق صلاحية المندوب'), messageKind('الحساب الحالي لا يطابق مندوب التسجيل'), messageKind('خطأ آخر')], ['none', 'account-permissions-changed', 'region-changed', 'scope-mismatch', 'role-mismatch', 'other'], 'the phone messages by kind');

process.env.TRACKING_DIAG_DATABASE = file; process.env.TRACKING_DIAG_NOW = now;
const report = run(), printed = JSON.stringify(report);
eq(report.readOnly, true, 'the report says it read only');
eq([report.fieldMembers, report.byRole], [3, {marketing: 1, rep: 2}], 'active representatives and marketing officers only');
eq([report.phonesReportingAccountChanged, report.latestDayScopeDiffers], [2, 1], 'the two phones that refuse, and the one whose latest route day has another scope text (the moved representative already recorded a day in the new region)');
eq(report.members.map(m => m.member), ['marketin', 'rep-move'], 'the steady representative, the inactive one and the supervisor are not listed; ids are cut to 8 characters');
const officer = report.members[0];
eq(officer.currentScope, {all: true}, 'the officer covers every region now');
eq(officer.routeDayScopes, [{scopeKind: scopeKind(FIVE), sameTextAsCurrent: false, days: 3, firstDate: '2026-11-20', lastDate: '2026-11-24', lastStartedAt: '2026-11-24T03:00:00.000Z'}], 'every route day was recorded under the five regions ticked one by one');
eq(officer.latestDay, {date: '2026-11-24', sameScopeTextAsCurrent: false, open: true}, 'the latest day, still open, under the other text');
eq(officer.phone, {reportedAt: '2026-11-25T05:52:00.000Z', appVersion: '1.0.15', gate: 'setup', missing: ['enrollment'], enrolled: false, tracking: false, pendingCount: 856, pendingGapCount: 67, quarantinedCount: 0, error: 'account-permissions-changed', syncError: 'none'}, 'the phone report by kind and counts');
const moved = report.members[1];
eq([moved.currentScope, moved.routeDayScopes.map(s => [s.scopeKind.regions, s.sameTextAsCurrent, s.days]), moved.phone.error], [scopeKind('eastern'), [[1, false, 1], [1, true, 1]], 'region-changed'], 'a real move from one region to another');
eq(report.verdict, 'FIELD MEMBERS 3; PHONES REPORTING A CHANGED ACCOUNT 2; LATEST ROUTE DAY IN ANOTHER SCOPE TEXT 1', 'the verdict');
ok(!printed.includes('SECRET-NAME') && !printed.includes('@yourrest.org') && !printed.includes('marketing-officer-1') && !printed.includes('rep-moved-1'), 'no name, email or full member id');
ok(!/"(central|eastern|western|northern|southern|unassigned)"|central,|,eastern/.test(printed) && !printed.includes('محفوظ على الجهاز'), 'no region and no message text is printed, only their kinds');
eq(digest(), before, 'the database is unchanged');

console.log(JSON.stringify({ok: true, checks, realHostingTested: false}));
