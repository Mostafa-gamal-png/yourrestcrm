'use strict';
// Read-only check (2026-10-31): are the data backed up every day? It reads the account's cron table, the backup folder that the
// daily job (release/operations/backup-scheduled.mjs) writes, the activators' daily checkpoints and the space they use. It changes
// nothing and prints paths, dates, counts and sizes only: no record, name or setting value.
//   node backups.cjs                     on the hosting account (HOME is the account; settings from yourrest-crm/settings.cjs)
//   YR_DIAG_HOME=<dir> YR_DIAG_CRONTAB_FILE=<file> YR_DIAG_DATABASE=<file> YR_DIAG_OBJECTS=<dir> node ...   on a copy
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');


function cronTable() {
  if (process.env.YR_DIAG_CRONTAB_FILE) return fs.existsSync(process.env.YR_DIAG_CRONTAB_FILE) ? fs.readFileSync(process.env.YR_DIAG_CRONTAB_FILE, 'utf8') : '';
  try { return execFileSync('crontab', ['-l'], {encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore']}); }
  catch { return ''; } // "no crontab for user" exits 1
}

// Total bytes of a file or a folder, without following links.
function sizeOf(target) {
  let total = 0;
  const walk = p => {
    let st; try { st = fs.lstatSync(p); } catch { return; }
    if (st.isDirectory()) { for (const name of fs.readdirSync(p)) walk(path.join(p, name)); }
    else if (st.isFile()) total += st.size;
  };
  walk(target);
  return total;
}

function dataPaths(home) {
  if (process.env.YR_DIAG_DATABASE) return {database: process.env.YR_DIAG_DATABASE, objects: process.env.YR_DIAG_OBJECTS || ''};
  const app = path.join(home, 'yourrest-crm');
  const {loadSettings} = require(path.join(app, 'release', 'operations', 'config.cjs'));
  const settings = loadSettings(app);
  return {database: path.resolve(settings.YR_DATABASE_PATH), objects: settings.YR_OBJECTS_PATH ? path.resolve(settings.YR_OBJECTS_PATH) : ''};
}

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

function backupRoot(root, now) {
  const out = {path: root, exists: fs.existsSync(root)};
  if (!out.exists) return out;
  const status = readJson(path.join(root, 'status.json'));
  out.status = status ? {state: status.state, startedAt: status.startedAt, completedAt: status.completedAt || null, backupName: status.backupName || null, objects: status.objects ?? null, bytes: status.bytes ?? null, retain: status.retain ?? null, errorCode: status.errorCode || null} : null;
  const backups = fs.readdirSync(root).filter(name => name.startsWith('yourrest-backup-') && fs.statSync(path.join(root, name)).isDirectory()).sort();
  out.backups = backups.length;
  out.newest = backups.at(-1) || null;
  out.oldest = backups[0] || null;
  out.totalBytes = sizeOf(root);
  const last = status && status.state === 'ok' && status.completedAt ? Date.parse(status.completedAt) : NaN;
  out.hoursSinceLastOk = Number.isFinite(last) ? Math.round((now - last) / 3600000 * 10) / 10 : null;
  try { out.lastRunLog = fs.readFileSync(path.join(root, 'last-run.log'), 'utf8').trim().slice(-400); } catch { out.lastRunLog = null; }
  return out;
}

function run(now = Date.now()) {
  const home = path.resolve(process.env.YR_DIAG_HOME || process.env.HOME || '/home/youriedx');
  const report = {checkedAt: new Date(now).toISOString(), readOnly: true};

  // ---- the cron table: which lines run the daily backup (the temporary line of this very run is not one)
  const lines = cronTable().split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const backupLines = lines.filter(line => line.includes('backup-scheduled.mjs'));
  report.cron = {
    lines: lines.length,
    backupJobs: backupLines.map(line => {
      const fields = line.split(/\s+/), args = line.match(/backup-scheduled\.mjs'?\s+'?([^'\s]+)'?\s+(\d+)/);
      return {schedule: fields.slice(0, 5).join(' '), backupRoot: args ? args[1] : null, retain: args ? Number(args[2]) : null};
    }),
    temporaryDeployLines: lines.filter(line => line.includes('yourrest-deploy/hosting-cron.sh')).length,
    otherLines: lines.filter(line => !line.includes('backup-scheduled.mjs') && !line.includes('yourrest-deploy/hosting-cron.sh')).length,
  };

  // ---- the backup folders: the ones the cron lines name, and the one the guide names
  const roots = [...new Set([...report.cron.backupJobs.map(job => job.backupRoot).filter(Boolean), path.join(home, 'yourrest-crm-backups')])];
  report.backupFolders = roots.map(root => backupRoot(root, now));

  // ---- the activators' daily checkpoints (a full copy taken on each day an update was activated)
  const checkpoints = fs.readdirSync(home).filter(name => /^yourrest-.*activation-\d{8}-[A-Za-z0-9]+$/.test(name) && fs.statSync(path.join(home, name)).isDirectory())
    .map(name => ({name, day: name.match(/activation-(\d{8})-/)[1], bytes: sizeOf(path.join(home, name))})).sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name));
  report.activationCheckpoints = {count: checkpoints.length, totalBytes: checkpoints.reduce((sum, c) => sum + c.bytes, 0), days: [...new Set(checkpoints.map(c => c.day))], newest: checkpoints.at(-1)?.name || null};

  // ---- the live data and the space left
  const data = dataPaths(home);
  report.data = {databaseBytes: fs.existsSync(data.database) ? sizeOf(data.database) + sizeOf(data.database + '-wal') : null, objectsBytes: data.objects && fs.existsSync(data.objects) ? sizeOf(data.objects) : null};
  try { const st = fs.statfsSync(home); report.disk = {freeBytes: st.bavail * st.bsize, totalBytes: st.blocks * st.bsize, note: 'filesystem figures; the cPanel quota may be lower'}; } catch { report.disk = null; }

  // ---- verdict
  const folders = report.backupFolders.filter(f => f.exists && f.status);
  const freshest = folders.filter(f => f.hoursSinceLastOk !== null).sort((a, b) => a.hoursSinceLastOk - b.hoursSinceLastOk)[0];
  if (!report.cron.backupJobs.length) report.verdict = 'NO DAILY BACKUP SCHEDULED' + (freshest ? ' (last manual backup ' + freshest.status.completedAt + ')' : '') + '; ACTIVATION CHECKPOINTS ON ' + report.activationCheckpoints.days.length + ' DAYS';
  else if (!freshest) report.verdict = 'DAILY BACKUP SCHEDULED BUT NO SUCCESSFUL RUN FOUND';
  else if (freshest.hoursSinceLastOk > 30) report.verdict = 'DAILY BACKUP SCHEDULED BUT THE LAST SUCCESS IS ' + freshest.hoursSinceLastOk + ' HOURS OLD';
  else report.verdict = 'DAILY BACKUPS RUNNING: LAST SUCCESS ' + freshest.status.completedAt + ', ' + freshest.backups + ' KEPT';
  return report;
}

if (require.main === module) {
  try { const report = run(); console.log(JSON.stringify(report, null, 2)); console.log(report.verdict); }
  catch (error) { console.log('DIAGNOSE STOP: ' + (error && error.message ? error.message : String(error))); process.exitCode = 1; }
}
module.exports = {run};
