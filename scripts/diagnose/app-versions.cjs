'use strict';
// Read-only check (2026-11-01, after Android 1.0.11 was made required): which Android version do the phones run? Each phone reports
// its app version with its tracking state (crm_member_devices, one row per member and platform); this counts the latest Android
// report of every active member by version, role and age, so it shows whether representatives manage to update from inside the app.
// It opens the database read-only, changes nothing, and prints counts and times only: no names, emails or member ids.
//   node app-versions.cjs            on the hosting account (finds the database through yourrest-crm/settings.cjs)
//   YR_DIAG_DATABASE=<file> node ...  on a copy
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');

function databaseFile() {
  if (process.env.YR_DIAG_DATABASE) return path.resolve(process.env.YR_DIAG_DATABASE);
  const home = process.env.HOME || '/home/youriedx', app = path.join(home, 'yourrest-crm');
  const {loadSettings} = require(path.join(app, 'release', 'operations', 'config.cjs'));
  return path.resolve(loadSettings(app).YR_DATABASE_PATH);
}
const bump = (map, key) => { map[key] = (map[key] || 0) + 1; };

function run(now = Date.now()) {
  const db = new DatabaseSync(databaseFile(), {readOnly: true});
  try {
    const members = db.prepare('SELECT id, role FROM crm_members WHERE active = 1').all();
    const devices = new Map(db.prepare("SELECT member_id, app_version, reported_at FROM crm_member_devices WHERE platform = 'android-app'").all().map(row => [row.member_id, row]));
    const report = {checkedAt: new Date(now).toISOString(), readOnly: true, activeMembers: members.length, byRole: {}, representatives: {total: 0, byVersion: {}, reportedLast24h: {}, reportedLast2h: {}, noAndroidReport: 0}, newestReportOfVersion: {}};
    for (const member of members) {
      const device = devices.get(member.id), version = device ? (device.app_version || 'unknown') : 'no android report';
      const role = report.byRole[member.role] ||= {};
      bump(role, version);
      if (device) {
        const at = Date.parse(device.reported_at);
        if (!report.newestReportOfVersion[version] || at > Date.parse(report.newestReportOfVersion[version])) report.newestReportOfVersion[version] = new Date(at).toISOString();
      }
      if (member.role !== 'rep') continue;
      const reps = report.representatives;
      reps.total++;
      if (!device) { reps.noAndroidReport++; continue; }
      bump(reps.byVersion, version);
      const age = now - Date.parse(device.reported_at);
      if (age <= 24 * 3600_000) bump(reps.reportedLast24h, version);
      if (age <= 2 * 3600_000) bump(reps.reportedLast2h, version);
    }
    const reps = report.representatives, versions = Object.entries(reps.byVersion).map(([version, count]) => `${version}: ${count}`).join(', ');
    report.verdict = `REPRESENTATIVES ${reps.total}: ${versions || 'no android report'}${reps.noAndroidReport ? `, NO ANDROID REPORT: ${reps.noAndroidReport}` : ''}`;
    return report;
  } finally { db.close(); }
}

if (require.main === module) {
  try { const report = run(); console.log(JSON.stringify(report, null, 2)); console.log(report.verdict); }
  catch (error) { console.log('DIAGNOSE STOP: ' + (error && error.message ? error.message : String(error))); process.exitCode = 1; }
}
module.exports = {run};
