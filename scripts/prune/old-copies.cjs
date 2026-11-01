'use strict';
// Frees space on the hosting account (2026-11-01, asked by the owner): removes the old copies named in a list, and only those, after
// checking that each one is an old copy the app no longer needs and that the data are safe without it. Runs ON the hosting account
// (mode=prune of .github/workflows/deploy.yml uploads it as yourrest-deploy/prune.cjs, with the list as prune.json).
//   node old-copies.cjs <prune.json>        prune.json: {"remove": ["<name in the home folder>", ...], "dryRun": true|false}
// Every check runs before anything is removed; one failed check removes nothing (PRUNE STOP <code>):
//   - each name is a plain name of ours directly in the home folder (yourrest-..., or an uploaded Yourrest-CRM-...zip), a folder or a zip,
//     not a link, not the app, the live data, the nightly backups, the daily index or the deploy work folder;
//   - nothing in it changed in the last 48 hours (today's and yesterday's copies stay), and it is not the checkpoint that holds the
//     newest day's full copy in the activators' daily index;
//   - no link under the app or its Node.js environment points into it, and no cron line names it;
//   - no update, activation or backup is running (their locks), and the last nightly backup succeeded less than 30 hours ago and
//     verifies now with the live release's own restore.mjs.
// A name already gone is reported and skipped, so the same list can run again. Prints names and sizes only, opens no record.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const PROTECTED = new Set(['yourrest-crm', 'yourrest-crm-data', 'yourrest-crm-backups', 'yourrest-crm-daily-backups', 'yourrest-crm-daily-backups.lock', 'yourrest-deploy']);
const OURS = /^(yourrest-[a-z0-9][A-Za-z0-9._-]{0,127}|Yourrest-CRM-[A-Za-z0-9._-]{1,120}\.zip)$/;
const RECENT_MS = 48 * 3600_000, NIGHTLY_MAX_AGE_MS = 30 * 3600_000, LIMIT = 200;

class PruneStop extends Error { constructor(code, detail) { super(code + (detail ? ': ' + detail : '')); this.code = code; } }

function measure(target) {
  let bytes = 0, newest = 0;
  const walk = p => {
    let st; try { st = fs.lstatSync(p); } catch { return; }
    newest = Math.max(newest, st.mtimeMs);
    if (st.isDirectory()) { for (const name of fs.readdirSync(p)) walk(path.join(p, name)); }
    else if (st.isFile()) bytes += st.size;
  };
  walk(target);
  return {bytes, newest};
}
// Every link under a folder, without following any.
function links(folder, found = []) {
  let entries; try { entries = fs.readdirSync(folder, {withFileTypes: true}); } catch { return found; }
  for (const entry of entries) {
    const full = path.join(folder, entry.name);
    if (entry.isSymbolicLink()) found.push(full); else if (entry.isDirectory()) links(full, found);
  }
  return found;
}
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);

function crontab() {
  if (process.env.YR_PRUNE_CRONTAB_FILE) return fs.existsSync(process.env.YR_PRUNE_CRONTAB_FILE) ? fs.readFileSync(process.env.YR_PRUNE_CRONTAB_FILE, 'utf8') : '';
  try { return execFileSync('crontab', ['-l'], {encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore']}); } catch { return ''; }
}

/** Checks the whole list, then removes it (or only says what it would remove). Returns the report; throws PruneStop before removing anything. */
function prune({home, list, now = Date.now(), node = process.execPath}) {
  if (!list || !Array.isArray(list.remove) || typeof list.dryRun !== 'boolean') throw new PruneStop('BAD_LIST', 'remove (names) and dryRun (true or false) are needed');
  const names = list.remove;
  if (!names.length || names.length > LIMIT || new Set(names).size !== names.length) throw new PruneStop('BAD_LIST', `1 to ${LIMIT} different names`);

  // ---- nothing running that could be writing into the home folder
  if (fs.existsSync(path.join(home, 'yourrest-crm-daily-backups.lock'))) throw new PruneStop('ACTIVATION_RUNNING', 'the daily backup lock exists');
  if (fs.existsSync(path.join(home, 'yourrest-crm-data', '.yourrest-backup.lock'))) throw new PruneStop('BACKUP_RUNNING', 'the backup lock exists');
  for (const entry of fs.readdirSync(home, {withFileTypes: true})) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !entry.name.startsWith('yourrest-crm-')) continue;
    let inner = []; try { inner = fs.readdirSync(path.join(home, entry.name)); } catch {}
    if (inner.some(name => name.endsWith('-activation.lock'))) throw new PruneStop('ACTIVATION_RUNNING', entry.name);
  }

  // ---- the data are safe without the old copies: last night's backup succeeded and verifies now
  const nightly = path.join(home, 'yourrest-crm-backups'), status = readJson(path.join(nightly, 'status.json'));
  const completed = status && status.state === 'ok' ? Date.parse(status.completedAt) : NaN;
  if (!Number.isFinite(completed) || now - completed > NIGHTLY_MAX_AGE_MS || now < completed) throw new PruneStop('NO_RECENT_NIGHTLY_BACKUP', status ? `${status.state} ${status.completedAt}` : 'no status.json');
  if (!/^yourrest-backup-[A-Za-z0-9-]+$/.test(status.backupName || '') || !fs.lstatSync(path.join(nightly, status.backupName), {throwIfNoEntry: false})?.isDirectory()) throw new PruneStop('NO_RECENT_NIGHTLY_BACKUP', 'the backup it names is not there');
  try { execFileSync(node, [path.join(home, 'yourrest-crm', 'release', 'operations', 'restore.mjs'), 'verify', path.join(nightly, status.backupName)], {stdio: ['ignore', 'ignore', 'ignore'], timeout: 600_000}); }
  catch { throw new PruneStop('NIGHTLY_BACKUP_DOES_NOT_VERIFY', status.backupName); }

  // ---- what must stay
  const indexRoot = path.join(home, 'yourrest-crm-daily-backups');
  let indexes = []; try { indexes = fs.readdirSync(indexRoot).filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort(); } catch {}
  const newestIndex = indexes.length ? readJson(path.join(indexRoot, indexes.at(-1))) : null;
  const heldByIndex = newestIndex && typeof newestIndex.transaction === 'string' ? path.basename(newestIndex.transaction) : null;
  const linked = [...links(path.join(home, 'yourrest-crm')), ...links(path.join(home, 'nodevenv'))].map(link => { try { return fs.realpathSync(link); } catch { return null; } }).filter(Boolean);
  const cron = crontab();

  // ---- every name, checked before anything is removed
  const plan = [], gone = [];
  for (const name of names) {
    if (typeof name !== 'string' || !OURS.test(name) || name.includes('..') || PROTECTED.has(name)) throw new PruneStop('NOT_AN_OLD_COPY', String(name));
    const full = path.join(home, name), st = fs.lstatSync(full, {throwIfNoEntry: false});
    if (!st) { gone.push(name); continue; }
    if (st.isSymbolicLink() || !(st.isDirectory() || (st.isFile() && name.endsWith('.zip')))) throw new PruneStop('NOT_AN_OLD_COPY', name + ' is not a folder or a package');
    if (name === heldByIndex) throw new PruneStop('HOLDS_THE_NEWEST_DAILY_COPY', name);
    const size = measure(full);
    if (now - Math.max(size.newest, st.mtimeMs) < RECENT_MS) throw new PruneStop('CHANGED_IN_THE_LAST_48_HOURS', name);
    const real = fs.realpathSync(full);
    if (linked.some(target => inside(target, real))) throw new PruneStop('IN_USE_BY_A_LINK', name);
    if (cron.includes(name)) throw new PruneStop('NAMED_BY_A_CRON_LINE', name);
    plan.push({name, bytes: size.bytes});
  }

  const total = plan.reduce((sum, item) => sum + item.bytes, 0), removed = [];
  if (!list.dryRun) {
    for (const item of plan) {
      try { fs.rmSync(path.join(home, item.name), {recursive: true}); }
      catch (error) { throw new PruneStop('REMOVE_FAILED', `${item.name} (${error.code || error.message}); removed before it: ${removed.map(r => r.name).join(', ') || 'nothing'}`); }
      removed.push(item);
    }
  }
  return {dryRun: list.dryRun, nightlyBackup: {backupName: status.backupName, completedAt: status.completedAt, verified: true}, keptByRule: heldByIndex, alreadyGone: gone, plan, freedBytes: list.dryRun ? 0 : total, wouldFreeBytes: total};
}

if (require.main === module) {
  const gb = bytes => (bytes / 1024 ** 3).toFixed(2) + ' GB';
  try {
    const home = path.resolve(process.env.YR_PRUNE_HOME || process.env.HOME);
    const report = prune({home, list: readJson(process.argv[2] || '')});
    for (const item of report.plan) console.log(`${report.dryRun ? 'WOULD REMOVE' : 'REMOVED'} ${item.name} ${item.bytes}`);
    for (const name of report.alreadyGone) console.log(`ALREADY GONE ${name}`);
    console.log(`NIGHTLY BACKUP VERIFIED: ${report.nightlyBackup.backupName} (${report.nightlyBackup.completedAt})`);
    console.log(report.dryRun ? `PRUNE DRY RUN: ${report.plan.length} WOULD BE REMOVED, ${gb(report.wouldFreeBytes)} WOULD BE FREED; NOTHING WAS REMOVED`
      : `PRUNE DONE: ${report.plan.length} REMOVED, ${gb(report.freedBytes)} FREED`);
  } catch (error) {
    console.log('PRUNE STOP ' + (error instanceof PruneStop ? error.message : 'UNEXPECTED: ' + (error && error.message ? error.message : String(error))));
    process.exitCode = error instanceof PruneStop ? 2 : 1;
  }
}
module.exports = {prune, PruneStop};
