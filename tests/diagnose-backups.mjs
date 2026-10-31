// The read-only check of daily backups (scripts/diagnose/backups.cjs) on a synthetic account: it finds the cron line of the daily
// backup and its folder, says how old the last success is, counts the activators' daily checkpoints, tells a missing, failed or
// stale schedule apart, does not count the deploy workflow's own temporary cron line, and changes nothing. No network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';

const root = process.cwd(), require = createRequire(import.meta.url);
const {run} = require(path.join(root, 'scripts/diagnose/backups.cjs'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yr-diagnose-backups-'));
process.on('exit', () => fs.rmSync(home, {recursive: true, force: true}));
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const write = (file, text) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, text); };
const now = Date.parse('2026-10-31T12:00:00Z'), hoursAgo = h => new Date(now - h * 3600000).toISOString();

// ---- a synthetic account
const backups = path.join(home, 'yourrest-crm-backups'), cron = path.join(home, 'crontab.txt');
write(path.join(home, 'yourrest-crm-data', 'database.sqlite'), 'x'.repeat(1000));
write(path.join(home, 'yourrest-crm-data', 'objects', 'a', 'file.pdf'), 'y'.repeat(500));
for (const name of ['yourrest-backup-20261030T231500000Z-1', 'yourrest-backup-20261031T231500000Z-2']) write(path.join(backups, name, 'manifest.json'), '{}');
write(path.join(backups, 'last-run.log'), '{"ok":true,"state":"ok"}\n');
write(path.join(home, 'yourrest-update-fast-open-activation-20261029-AbC123', 'data', 'database.sqlite'), 'z'.repeat(300));
write(path.join(home, 'yourrest-update-digits-signin-activation-20261031-eukmcA', 'data', 'database.sqlite'), 'z'.repeat(300));
write(path.join(home, 'yourrest-update-notes.txt'), 'not a checkpoint');
const status = state => write(path.join(backups, 'status.json'), JSON.stringify(state));
const crontab = lines => write(cron, lines.join('\n') + '\n');
const dailyLine = `15 2 * * * umask 077; '/opt/alt/alt-nodejs22/root/usr/bin/node' '${home}/yourrest-crm/release/operations/backup-scheduled.mjs' '${backups}' 14 > '${backups}/last-run.log' 2>&1`;
const deployLine = '* * * * * /bin/bash $HOME/yourrest-deploy/hosting-cron.sh >/dev/null 2>&1';
Object.assign(process.env, {YR_DIAG_HOME: home, YR_DIAG_CRONTAB_FILE: cron, YR_DIAG_DATABASE: path.join(home, 'yourrest-crm-data', 'database.sqlite'), YR_DIAG_OBJECTS: path.join(home, 'yourrest-crm-data', 'objects')});
const tree = () => { const hash = createHash('sha256'); const walk = p => { for (const name of fs.readdirSync(p).sort()) { const f = path.join(p, name), st = fs.statSync(f); hash.update(f + st.size + st.mtimeMs); if (st.isDirectory()) walk(f); else hash.update(fs.readFileSync(f)); } }; walk(home); return hash.digest('hex'); };

// ---- running every day
crontab(['MAILTO=""', dailyLine, deployLine, '0 5 * * 1 /usr/bin/true']);
status({format: 'yourrest-backup-status', state: 'ok', startedAt: hoursAgo(5.1), completedAt: hoursAgo(5), backupName: 'yourrest-backup-20261031T231500000Z-2', objects: 1, bytes: 1500, retain: 14});
const before = tree();
let report = run(now);
eq(report.readOnly, true, 'the report says it read only');
eq(report.cron.backupJobs, [{schedule: '15 2 * * *', backupRoot: backups, retain: 14}], 'the daily backup line, its time, folder and how many it keeps');
eq([report.cron.lines, report.cron.temporaryDeployLines, report.cron.otherLines], [4, 1, 2], 'the deploy workflow\'s own temporary line is counted apart, not as a backup');
eq(report.backupFolders.length, 1, 'the cron line\'s folder and the guide\'s folder are the same folder, listed once');
eq([report.backupFolders[0].status.state, report.backupFolders[0].backups, report.backupFolders[0].newest, report.backupFolders[0].hoursSinceLastOk], ['ok', 2, 'yourrest-backup-20261031T231500000Z-2', 5], 'the last success, how many are kept and the newest');
eq(report.activationCheckpoints.count, 2, 'the two activation checkpoints, and not a file that only looks like one');
eq(report.activationCheckpoints.days, ['20261029', '20261031'], 'the days they were taken');
eq([report.data.databaseBytes, report.data.objectsBytes], [1000, 500], 'the size of the live data');
eq(report.verdict, 'DAILY BACKUPS RUNNING: LAST SUCCESS ' + hoursAgo(5) + ', 2 KEPT', 'the verdict');
eq(tree(), before, 'nothing on the account changed');

// ---- the other answers
status({format: 'yourrest-backup-status', state: 'ok', startedAt: hoursAgo(50.1), completedAt: hoursAgo(50), backupName: 'x', retain: 14});
eq(run(now).verdict, 'DAILY BACKUP SCHEDULED BUT THE LAST SUCCESS IS 50 HOURS OLD', 'a schedule that stopped working is told apart');
status({format: 'yourrest-backup-status', state: 'failed', startedAt: hoursAgo(5), completedAt: hoursAgo(5), errorCode: 'DISK_FULL'});
report = run(now);
eq([report.verdict, report.backupFolders[0].status.errorCode], ['DAILY BACKUP SCHEDULED BUT NO SUCCESSFUL RUN FOUND', 'DISK_FULL'], 'a failed last run, with its error code');
crontab([deployLine]);
eq(run(now).verdict, 'NO DAILY BACKUP SCHEDULED; ACTIVATION CHECKPOINTS ON 2 DAYS', 'no backup line: only the activators\' checkpoints');
fs.rmSync(cron);
eq(run(now).cron.lines, 0, 'an account with no cron table at all');

// ---- run on its own it ends with the verdict
crontab([dailyLine]);
status({format: 'yourrest-backup-status', state: 'ok', startedAt: new Date(Date.now() - 3600000).toISOString(), completedAt: new Date(Date.now() - 3500000).toISOString(), backupName: 'yourrest-backup-20261031T231500000Z-2', retain: 14});
const printed = spawnSync(process.execPath, [path.join(root, 'scripts/diagnose/backups.cjs')], {env: process.env, encoding: 'utf8'});
eq(printed.status, 0, 'run on its own it ends well');
eq(printed.stdout.trim().split('\n').at(-1).startsWith('DAILY BACKUPS RUNNING: LAST SUCCESS '), true, 'and ends with the verdict');
console.log(JSON.stringify({ok: true, checks}));
