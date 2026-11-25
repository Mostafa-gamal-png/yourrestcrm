'use strict';
// Read-only (2026-11-25): a marketing officer's Android app (1.0.15) says «تغيرت أذونات الحساب؛ محفوظ على الجهاز 856 نقطة و67 انقطاع
// من المنطقة السابقة» and will not enable tracking, while the owner says the account has covered the whole Kingdom from the start.
// The app compares the region scope and role it enrolled with to what /api/mobile-route answers now (AccountRecoveryPolicy), as text.
// For every active representative and marketing officer whose phone reports that message, or whose current scope is not the scope of
// their latest route day on the server, this prints the scope kinds (all regions, or how many regions were ticked), the route days of
// each scope with their first and last dates, and the phone's last report (time, gate, counts, which message). It prints member ids
// (random, first 8 characters), role keys, counts, flags and times only: no names, emails, regions' customers or places. Nothing is written.
//   node tracking-scope.cjs                                              on the hosting account
//   TRACKING_DIAG_DATABASE=<file> TRACKING_DIAG_NOW=<ISO time> node ...  on a copy (tests)
// No YR_* variable is ever used or set: the settings check refuses any YR_* value beside settings.cjs.
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');

const FIELD_ROLES = ['rep', 'marketing'];
const REGION_IDS = ['central', 'eastern', 'western', 'northern', 'southern', 'unassigned'];
const PRESERVE = 'تغيرت أذونات الحساب', SCOPE_CHANGED = 'تغيرت منطقة الحساب', SCOPE_MISMATCH = 'تغير نطاق صلاحية', ROLE_MISMATCH = 'لا يطابق مندوب التسجيل';

function databaseFile() {
  if (process.env.TRACKING_DIAG_DATABASE) return path.resolve(process.env.TRACKING_DIAG_DATABASE);
  const home = process.env.HOME || '/home/youriedx', app = path.join(home, 'yourrest-crm');
  const {loadSettings} = require(path.join(app, 'release', 'operations', 'config.cjs'));
  return path.resolve(loadSettings(app).YR_DATABASE_PATH);
}
const scopeOf = value => value || 'all';
/** A scope as a kind, never its regions: `all`, or how many known regions it names and whether «غير محددة» is one of them. */
function scopeKind(scope) {
  if (scope === 'all') return {all: true};
  const parts = String(scope).split(',').map(part => part.trim()).filter(Boolean), known = parts.filter(part => REGION_IDS.includes(part));
  return {all: false, regions: known.length, ofRegions: REGION_IDS.length, unassignedIncluded: known.includes('unassigned'), unknownParts: parts.length - known.length, everyRegionTicked: REGION_IDS.every(id => known.includes(id))};
}
const messageKind = text => {
  const value = String(text || '');
  if (!value) return 'none';
  if (value.includes(PRESERVE)) return 'account-permissions-changed';
  if (value.includes(SCOPE_CHANGED)) return 'region-changed';
  if (value.includes(SCOPE_MISMATCH)) return 'scope-mismatch';
  if (value.includes(ROLE_MISMATCH)) return 'role-mismatch';
  return 'other';
};
const isoOrEmpty = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '';

function run(now = process.env.TRACKING_DIAG_NOW ? Date.parse(process.env.TRACKING_DIAG_NOW) : Date.now()) {
  const db = new DatabaseSync(databaseFile(), {readOnly: true});
  try {
    const members = db.prepare(`SELECT id, role, region_scope, auth_version, created_at FROM crm_members WHERE active = 1 AND role IN (${FIELD_ROLES.map(() => '?').join(',')})`).all(...FIELD_ROLES);
    const devices = new Map(db.prepare("SELECT member_id, app_version, reported_at, data FROM crm_member_devices WHERE platform = 'android-app'").all().map(row => [row.member_id, row]));
    const days = db.prepare('SELECT member_id, region_scope, date, started_at, ended_at FROM crm_mobile_route_days ORDER BY started_at, id').all();
    const byMember = new Map();
    for (const day of days) { const list = byMember.get(day.member_id) || []; list.push(day); byMember.set(day.member_id, list); }
    const report = {checkedAt: new Date(now).toISOString(), readOnly: true, fieldMembers: members.length, byRole: {}, phonesReportingAccountChanged: 0, latestDayScopeDiffers: 0, members: []};
    for (const member of members) {
      report.byRole[member.role] = (report.byRole[member.role] || 0) + 1;
      const device = devices.get(member.id);
      let data = {};
      try { data = device ? JSON.parse(device.data || '{}') : {}; } catch { data = {}; }
      const error = messageKind(data.error), syncError = messageKind(data.syncError), current = scopeOf(member.region_scope);
      const list = byMember.get(member.id) || [], latest = list.at(-1);
      const flagged = error === 'account-permissions-changed' || error === 'region-changed' || error === 'scope-mismatch' || syncError === 'scope-mismatch';
      const differs = !!latest && latest.region_scope !== current;
      if (flagged) report.phonesReportingAccountChanged++;
      if (differs) report.latestDayScopeDiffers++;
      if (!flagged && !differs) continue;
      const scopes = new Map();
      for (const day of list) {
        const entry = scopes.get(day.region_scope) || {scopeKind: scopeKind(day.region_scope), sameTextAsCurrent: day.region_scope === current, days: 0, firstDate: day.date, lastDate: day.date, lastStartedAt: ''};
        entry.days++; entry.lastDate = day.date; entry.lastStartedAt = isoOrEmpty(day.started_at);
        scopes.set(day.region_scope, entry);
      }
      report.members.push({
        member: String(member.id).slice(0, 8),
        role: member.role,
        accountCreatedAt: isoOrEmpty(member.created_at),
        currentScope: scopeKind(current),
        routeDays: list.length,
        latestDay: latest ? {date: latest.date, sameScopeTextAsCurrent: latest.region_scope === current, open: !latest.ended_at} : null,
        routeDayScopes: [...scopes.values()],
        phone: device ? {reportedAt: isoOrEmpty(device.reported_at), appVersion: device.app_version || '', gate: data.gate || '', missing: Array.isArray(data.missing) ? data.missing : [], enrolled: data.enrolled === true, tracking: data.tracking === true, pendingCount: data.pendingCount ?? null, pendingGapCount: data.pendingGapCount ?? null, quarantinedCount: data.quarantinedCount ?? null, error, syncError} : null
      });
    }
    report.verdict = `FIELD MEMBERS ${members.length}; PHONES REPORTING A CHANGED ACCOUNT ${report.phonesReportingAccountChanged}; LATEST ROUTE DAY IN ANOTHER SCOPE TEXT ${report.latestDayScopeDiffers}`;
    return report;
  } finally { db.close(); }
}

if (require.main === module) {
  try { const report = run(); console.log(JSON.stringify(report, null, 2)); console.log(report.verdict); }
  catch (error) { console.log('DIAGNOSE STOP: ' + (error && error.message ? error.message : String(error))); process.exitCode = 1; }
}
module.exports = {run, scopeKind, messageKind};
