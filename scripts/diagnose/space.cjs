'use strict';
// Read-only inventory (2026-11-01, asked by the owner before freeing space): what fills the hosting account. It lists the home folder's
// entries with their size and date, groups them (the app, the live data, the nightly backups, each update's activation checkpoint and
// unpacked package, the uploaded packages, the rest), and opens only two kinds of our own small files: the nightly backup's status.json
// and the activators' daily index (<day>.json), from which it takes the state, dates and folder names. It never opens a record, a
// setting or a file of the live data, and changes nothing.
//   node space.cjs                       on the hosting account (HOME is the account)
//   YR_DIAG_HOME=<dir> node ...          on a copy
const fs = require('node:fs');
const path = require('node:path');

const CHECKPOINT = /^yourrest-[a-z0-9-]*activation-(\d{8})-[A-Za-z0-9]+$/, STAGE = /^yourrest-crm-[a-z0-9-]+-(\d{8})$/, PACKAGE = /^Yourrest-CRM-[A-Za-z0-9-]+\.zip$/i;
const KNOWN = {'yourrest-crm': 'app', 'yourrest-crm-data': 'live data', 'yourrest-crm-backups': 'nightly backups', 'yourrest-crm-daily-backups': 'daily backup index', 'yourrest-deploy': 'deploy work folder'};

// Bytes and files of a file or folder, without following links.
function measure(target) {
  let bytes = 0, files = 0;
  const walk = p => {
    let st; try { st = fs.lstatSync(p); } catch { return; }
    if (st.isDirectory()) { let names = []; try { names = fs.readdirSync(p); } catch { return; } for (const name of names) walk(path.join(p, name)); }
    else if (st.isFile()) { bytes += st.size; files++; }
  };
  walk(target);
  return {bytes, files};
}
const day = date => date.toISOString().slice(0, 10);
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const parts = folder => { try { return fs.readdirSync(folder).sort().map(name => ({name, ...measure(path.join(folder, name))})); } catch { return []; } };

function run() {
  const home = path.resolve(process.env.YR_DIAG_HOME || process.env.HOME || '/home/youriedx');
  const entries = fs.readdirSync(home, {withFileTypes: true}).filter(entry => !entry.isSymbolicLink()).map(entry => {
    const full = path.join(home, entry.name), st = fs.lstatSync(full), size = measure(full);
    const kind = KNOWN[entry.name] || (entry.isDirectory() && CHECKPOINT.test(entry.name) ? 'activation checkpoint' : entry.isDirectory() && STAGE.test(entry.name) ? 'unpacked update package'
      : entry.isFile() && PACKAGE.test(entry.name) ? 'uploaded update package' : entry.isDirectory() ? 'other folder' : 'other file');
    return {name: entry.name, kind, bytes: size.bytes, files: size.files, modified: day(st.mtime)};
  }).sort((a, b) => b.bytes - a.bytes);

  const report = {checkedAt: new Date().toISOString(), readOnly: true, home: path.basename(home), totalBytes: entries.reduce((sum, e) => sum + e.bytes, 0)};
  report.byKind = {};
  for (const e of entries) { const k = report.byKind[e.kind] ||= {count: 0, bytes: 0}; k.count++; k.bytes += e.bytes; }

  // ---- the activators' checkpoints, oldest first, with what each holds (application/ and data/ are that day's full copy)
  report.checkpoints = entries.filter(e => e.kind === 'activation checkpoint').map(e => ({name: e.name, day: e.name.match(CHECKPOINT)[1], bytes: e.bytes, holds: parts(path.join(home, e.name)).map(p => p.name + ' ' + p.bytes)}))
    .sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name));
  // ---- the daily index: which checkpoint holds each day's full copy
  const indexRoot = path.join(home, 'yourrest-crm-daily-backups');
  report.dailyIndex = parts(indexRoot).filter(p => /^\d{8}\.json$/.test(p.name)).map(p => { const index = readJson(path.join(indexRoot, p.name)); return {day: p.name.slice(0, 8), checkpoint: index && typeof index.transaction === 'string' ? path.basename(index.transaction) : null, verifiedAt: index?.verifiedAt || null}; });
  // ---- the unpacked packages and the uploaded zips
  report.stages = entries.filter(e => e.kind === 'unpacked update package').map(e => ({name: e.name, day: e.name.match(STAGE)[1], bytes: e.bytes, holds: parts(path.join(home, e.name)).map(p => p.name)})).sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name));
  report.packages = entries.filter(e => e.kind === 'uploaded update package').map(e => ({name: e.name, bytes: e.bytes, modified: e.modified}));
  // ---- inside the app folder: the live release and anything left beside it (an older release kept by hand, a failed one)
  report.app = parts(path.join(home, 'yourrest-crm')).map(p => ({name: p.name, bytes: p.bytes}));
  // ---- the nightly backups
  const nightly = path.join(home, 'yourrest-crm-backups'), status = readJson(path.join(nightly, 'status.json'));
  report.nightly = {exists: fs.existsSync(nightly), state: status?.state || null, completedAt: status?.completedAt || null, backupName: status?.backupName || null,
    kept: parts(nightly).filter(p => p.name.startsWith('yourrest-backup-')).map(p => p.name + ' ' + p.bytes)};
  report.otherEntries = entries.filter(e => e.kind.startsWith('other')).map(e => ({name: e.name, kind: e.kind, bytes: e.bytes, modified: e.modified}));
  try { const st = fs.statfsSync(home); report.disk = {freeBytes: st.bavail * st.bsize, totalBytes: st.blocks * st.bsize, note: 'filesystem figures; the cPanel quota may be lower'}; } catch { report.disk = null; }

  const gb = bytes => (bytes / 1024 ** 3).toFixed(2) + ' GB', cp = report.byKind['activation checkpoint'];
  report.verdict = `HOME ${gb(report.totalBytes)}; ACTIVATION CHECKPOINTS ${cp ? cp.count + ' / ' + gb(cp.bytes) : '0'}; NIGHTLY BACKUP ${report.nightly.state || 'NONE'}${report.nightly.completedAt ? ' ' + report.nightly.completedAt : ''}, ${report.nightly.kept.length} KEPT`;
  return report;
}

if (require.main === module) {
  try { const report = run(); console.log(JSON.stringify(report, null, 2)); console.log(report.verdict); }
  catch (error) { console.log('DIAGNOSE STOP: ' + (error && error.message ? error.message : String(error))); process.exitCode = 1; }
}
module.exports = {run};
