// Freeing space on the hosting account (scripts/prune/old-copies.cjs) on a synthetic account: it removes exactly the old copies named,
// says first what it would remove, and refuses the whole list (removing nothing) when one name is not an old copy of ours, is the app,
// the data or the nightly backups, a link, changed in the last 48 hours, holds the newest daily copy, is used by a link of the app or
// named by a cron line, while an activation or a backup runs, or when last night's backup is missing, old or does not verify.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';

const root = process.cwd(), require = createRequire(import.meta.url);
const tool = path.join(root, 'scripts/prune/old-copies.cjs'), {prune} = require(tool);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yr-prune-'));
process.on('exit', () => fs.rmSync(temp, {recursive: true, force: true}));
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const stops = (fn, code, message) => { assert.throws(fn, error => error.code === code, message + ' (expected ' + code + ')'); checks++; };
const write = (file, bytes = 10) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, 'x'.repeat(bytes)); };
const now = Date.parse('2026-11-01T06:00:00Z'), daysAgo = d => new Date(now - d * 86400_000);
const age = (target, when) => { const walk = p => { const st = fs.lstatSync(p); if (st.isDirectory()) for (const n of fs.readdirSync(p)) walk(path.join(p, n)); if (!st.isSymbolicLink()) fs.utimesSync(p, when, when); }; walk(target); };

const OLD = ['yourrest-update-activation-20261013-k8l61q', 'yourrest-update-reload-notice-activation-20261021-XjrWeW', 'yourrest-crm-update-20261013', 'Yourrest-CRM-Update-Speed-20261029.zip'];
function account() {
  const home = fs.mkdtempSync(path.join(temp, 'home-'));
  const ops = path.join(home, 'yourrest-crm', 'release', 'operations');
  write(path.join(home, 'yourrest-crm', 'release', 'server.js'));
  fs.mkdirSync(ops, {recursive: true});
  // restore.mjs verify DIR, as the release ships it (a pretend one): it fails when the backup holds a file named BROKEN.
  fs.writeFileSync(path.join(ops, 'restore.mjs'), "import fs from 'node:fs';const d=process.argv[3];process.exit(process.argv[2]==='verify'&&fs.existsSync(d)&&!fs.existsSync(d+'/BROKEN')?0:1);\n");
  write(path.join(home, 'yourrest-crm-data', 'database.sqlite'), 500);
  write(path.join(home, 'yourrest-crm-backups', 'yourrest-backup-20261101T001500000Z-ab12', 'database.sqlite'), 400);
  fs.writeFileSync(path.join(home, 'yourrest-crm-backups', 'status.json'), JSON.stringify({state: 'ok', completedAt: new Date(now - 6 * 3600_000).toISOString(), backupName: 'yourrest-backup-20261101T001500000Z-ab12'}));
  write(path.join(home, OLD[0], 'data', 'database.sqlite'), 1000); write(path.join(home, OLD[0], 'old-release', 'server.js'), 300);
  write(path.join(home, OLD[1], 'application', 'x.js'), 700);
  write(path.join(home, OLD[2], 'yourrest-activate-update.cjs'), 50);
  write(path.join(home, OLD[3]), 200);
  write(path.join(home, 'yourrest-update-fast-open-activation-20261029-d1ykA5', 'data', 'database.sqlite'), 900);
  write(path.join(home, 'yourrest-update-android-1011-activation-20261031-hFZIvL', 'old-release', 'server.js'), 300);
  write(path.join(home, 'yourrest-crm-update-android-1011-20261031', 'yourrest-activate-update-android-1011.cjs'), 50);
  write(path.join(home, 'yourrest-crm-daily-backups', '2026-10-29.json'));
  fs.writeFileSync(path.join(home, 'yourrest-crm-daily-backups', '2026-10-29.json'), JSON.stringify({day: '2026-10-29', transaction: path.join(home, 'yourrest-update-fast-open-activation-20261029-d1ykA5')}));
  write(path.join(home, 'mail', 'inbox'), 30);
  for (const name of [...OLD, 'yourrest-update-fast-open-activation-20261029-d1ykA5', 'mail', 'yourrest-crm-daily-backups']) age(path.join(home, name), daysAgo(3));
  age(path.join(home, OLD[0]), daysAgo(19));
  fs.writeFileSync(path.join(home, 'crontab.txt'), `15 20 * * * node ${home}/yourrest-crm/release/operations/backup-scheduled.mjs ${home}/yourrest-crm-backups 14\n`);
  process.env.YR_PRUNE_CRONTAB_FILE = path.join(home, 'crontab.txt');
  return home;
}
const run = (home, remove, dryRun = false, at = now) => prune({home, list: {remove, dryRun}, now: at});
const exists = (home, name) => fs.existsSync(path.join(home, name));

// ---- a dry run says what it would remove and removes nothing; the real run removes exactly those
{
  const home = account();
  const dry = run(home, OLD, true);
  eq(dry.plan.map(item => [item.name, item.bytes]), [[OLD[0], 1300], [OLD[1], 700], [OLD[2], 50], [OLD[3], 200]], 'the dry run lists each old copy with its size');
  eq([dry.wouldFreeBytes, dry.freedBytes, dry.nightlyBackup.verified], [2250, 0, true], 'what it would free; last night\'s backup verified first');
  ok(OLD.every(name => exists(home, name)), 'a dry run removes nothing');
  const done = run(home, OLD);
  eq(done.freedBytes, 2250, 'the real run frees the same');
  ok(OLD.every(name => !exists(home, name)), 'the old copies are gone');
  ok(['yourrest-crm', 'yourrest-crm-data', 'yourrest-crm-backups', 'yourrest-update-fast-open-activation-20261029-d1ykA5', 'yourrest-update-android-1011-activation-20261031-hFZIvL', 'yourrest-crm-update-android-1011-20261031', 'mail', 'yourrest-crm-daily-backups'].every(name => exists(home, name)), 'everything not named stays');
  const again = run(home, OLD);
  eq([again.plan, again.alreadyGone], [[], OLD], 'the same list again: nothing to remove, each one already gone');
}

// ---- one name that may not go refuses the whole list, and nothing is removed
{
  const home = account();
  const refused = [
    [['mail'], 'NOT_AN_OLD_COPY', 'a folder that is not ours'],
    [['yourrest-crm'], 'NOT_AN_OLD_COPY', 'the app'],
    [['yourrest-crm-data'], 'NOT_AN_OLD_COPY', 'the live data'],
    [['yourrest-crm-backups'], 'NOT_AN_OLD_COPY', 'the nightly backups'],
    [['yourrest-crm-daily-backups'], 'NOT_AN_OLD_COPY', 'the daily index'],
    [['yourrest-deploy'], 'NOT_AN_OLD_COPY', 'the deploy work folder'],
    [['../etc'], 'NOT_AN_OLD_COPY', 'a path out of the home folder'],
    [['yourrest-crm/release'], 'NOT_AN_OLD_COPY', 'a path into the app'],
    [['yourrest-update-android-1011-activation-20261031-hFZIvL'], 'CHANGED_IN_THE_LAST_48_HOURS', 'yesterday\'s checkpoint (the way back from the last update)'],
    [['yourrest-crm-update-android-1011-20261031'], 'CHANGED_IN_THE_LAST_48_HOURS', 'the live update\'s unpacked package'],
    [['yourrest-update-fast-open-activation-20261029-d1ykA5'], 'HOLDS_THE_NEWEST_DAILY_COPY', 'the checkpoint the newest daily index names'],
  ];
  for (const [names, code, what] of refused) stops(() => run(home, [OLD[0], ...names]), code, what);
  fs.symlinkSync(path.join(home, 'mail'), path.join(home, 'yourrest-link'));
  stops(() => run(home, [OLD[0], 'yourrest-link']), 'NOT_AN_OLD_COPY', 'a link');
  fs.symlinkSync(path.join(home, OLD[2]), path.join(home, 'yourrest-crm', 'release', 'helper'));
  stops(() => run(home, [OLD[0], OLD[2]]), 'IN_USE_BY_A_LINK', 'a folder a link of the app points into');
  fs.rmSync(path.join(home, 'yourrest-crm', 'release', 'helper'));
  fs.appendFileSync(path.join(home, 'crontab.txt'), `0 1 * * * ls ${home}/${OLD[1]}\n`);
  stops(() => run(home, [OLD[0], OLD[1]]), 'NAMED_BY_A_CRON_LINE', 'a folder a cron line names');
  stops(() => run(home, [OLD[0], OLD[0]]), 'BAD_LIST', 'a name twice');
  stops(() => prune({home, list: {remove: [OLD[0]]}, now}), 'BAD_LIST', 'no dryRun');
  ok(fs.readdirSync(home).length >= 12 && exists(home, OLD[0]), 'after every refusal the first name is still there: nothing was removed');
}

// ---- the data must be safe without the old copies, and nothing may be running
{
  const home = account(), status = path.join(home, 'yourrest-crm-backups', 'status.json'), saved = fs.readFileSync(status, 'utf8');
  stops(() => run(home, [OLD[0]], false, now + 40 * 3600_000), 'NO_RECENT_NIGHTLY_BACKUP', 'last night\'s backup is 46 hours old');
  fs.writeFileSync(status, JSON.stringify({state: 'failed', completedAt: new Date(now).toISOString()}));
  stops(() => run(home, [OLD[0]]), 'NO_RECENT_NIGHTLY_BACKUP', 'the last backup failed');
  fs.writeFileSync(status, saved);
  write(path.join(home, 'yourrest-crm-backups', 'yourrest-backup-20261101T001500000Z-ab12', 'BROKEN'));
  stops(() => run(home, [OLD[0]]), 'NIGHTLY_BACKUP_DOES_NOT_VERIFY', 'the backup does not verify');
  fs.rmSync(path.join(home, 'yourrest-crm-backups', 'yourrest-backup-20261101T001500000Z-ab12', 'BROKEN'));
  fs.mkdirSync(path.join(home, 'yourrest-crm-update-android-1011-20261031', 'update-android-1011-activation.lock'));
  stops(() => run(home, [OLD[0]]), 'ACTIVATION_RUNNING', 'an activation is running');
  fs.rmdirSync(path.join(home, 'yourrest-crm-update-android-1011-20261031', 'update-android-1011-activation.lock'));
  fs.mkdirSync(path.join(home, 'yourrest-crm-data', '.yourrest-backup.lock'));
  stops(() => run(home, [OLD[0]]), 'BACKUP_RUNNING', 'a backup is running');
  fs.rmdirSync(path.join(home, 'yourrest-crm-data', '.yourrest-backup.lock'));
  ok(exists(home, OLD[0]), 'nothing was removed');
  eq(run(home, [OLD[0]]).freedBytes, 1300, 'with everything in order it goes');
}

// ---- as the hosting run calls it: the list beside it, one line per name, and the exit code
{
  const home = account(), list = path.join(temp, 'prune.json');
  const cli = remove => { fs.writeFileSync(list, JSON.stringify(remove)); return spawnSync(process.execPath, [tool, list], {env: {...process.env, YR_PRUNE_HOME: home}, encoding: 'utf8'}); };
  // The CLI uses the real clock: the old copies are made old against it.
  for (const name of OLD) age(path.join(home, name), new Date(Date.now() - 3 * 86400_000));
  fs.writeFileSync(path.join(home, 'yourrest-crm-backups', 'status.json'), JSON.stringify({state: 'ok', completedAt: new Date(Date.now() - 3600_000).toISOString(), backupName: 'yourrest-backup-20261101T001500000Z-ab12'}));
  let out = cli({remove: OLD.slice(0, 2), dryRun: true});
  eq([out.status, out.stdout.trim().split('\n')], [0, [`WOULD REMOVE ${OLD[0]} 1300`, `WOULD REMOVE ${OLD[1]} 700`, out.stdout.trim().split('\n')[2], 'PRUNE DRY RUN: 2 WOULD BE REMOVED, 0.00 GB WOULD BE FREED; NOTHING WAS REMOVED']], 'the dry run prints each name and size, then the total');
  ok(out.stdout.includes('NIGHTLY BACKUP VERIFIED: yourrest-backup-20261101T001500000Z-ab12'), 'and that last night\'s backup verified');
  out = cli({remove: ['yourrest-crm-data'], dryRun: false});
  eq([out.status, out.stdout.trim()], [2, 'PRUNE STOP NOT_AN_OLD_COPY: yourrest-crm-data'], 'a refusal: exit 2 and its reason');
  out = cli({remove: OLD.slice(0, 2), dryRun: false});
  ok(out.status === 0 && out.stdout.includes(`REMOVED ${OLD[0]} 1300`) && out.stdout.includes('PRUNE DONE: 2 REMOVED'), 'the real run');
  ok(!exists(home, OLD[0]) && !exists(home, OLD[1]) && exists(home, OLD[2]), 'it removed the two named, not the others');
}

console.log(JSON.stringify({ok: true, checks, realHostingTested: false}));
