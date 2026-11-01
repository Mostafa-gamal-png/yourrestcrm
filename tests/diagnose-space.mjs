// The read-only space inventory of the hosting account (scripts/diagnose/space.cjs) on a synthetic account: it groups the home folder
// (the app, the live data, the nightly backups, each update's checkpoint and unpacked package, the uploaded zips, the rest) with sizes,
// lists the checkpoints oldest first with what each holds, maps the daily index to its checkpoint, prints no file's content beyond the
// two status files it names, follows no link, and changes nothing. No network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const root = process.cwd(), require = createRequire(import.meta.url);
const {run} = require(path.join(root, 'scripts/diagnose/space.cjs'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yr-diagnose-space-')), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'yr-diagnose-space-outside-'));
process.on('exit', () => { fs.rmSync(home, {recursive: true, force: true}); fs.rmSync(outside, {recursive: true, force: true}); });
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const write = (file, bytes, text) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, text ?? 'x'.repeat(bytes)); };
const SECRET = 'PRIVATE-RECORD-0551234567';

// ---- a synthetic account
write(path.join(home, 'yourrest-crm', 'release', 'server.js'), 400);
write(path.join(home, 'yourrest-crm', 'settings.cjs'), 0, `module.exports={YR_SECRET:'${SECRET}'}`);
write(path.join(home, 'yourrest-crm-data', 'database.sqlite'), 0, SECRET.repeat(50));
write(path.join(home, 'yourrest-crm-backups', 'yourrest-backup-20261031T001500000Z-a', 'database.sqlite'), 900);
write(path.join(home, 'yourrest-crm-backups', 'status.json'), 0, JSON.stringify({state: 'ok', completedAt: '2026-11-01T00:15:05.000Z', backupName: 'yourrest-backup-20261031T001500000Z-a'}));
const cps = ['yourrest-update-activation-20261013-Aa1', 'yourrest-update-fast-open-activation-20261029-Bb2', 'yourrest-update-digits-signin-activation-20261031-eukmcA', 'yourrest-update-android-1011-activation-20261031-hFZIvL'];
write(path.join(home, cps[0], 'application', 'release', 'x.js'), 3000); write(path.join(home, cps[0], 'data', 'database.sqlite'), 0, SECRET);
write(path.join(home, cps[1], 'old-release', 'x.js'), 2000);
write(path.join(home, cps[2], 'application', 'x.js'), 1000); write(path.join(home, cps[2], 'old-release', 'x.js'), 500);
write(path.join(home, cps[3], 'old-release', 'x.js'), 500); write(path.join(home, cps[3], 'activation-state.json'), 10);
write(path.join(home, 'yourrest-crm-daily-backups', '20261031.json'), 0, JSON.stringify({day: '20261031', transaction: path.join(home, cps[2]), verifiedAt: '2026-10-31T05:00:00.000Z', applicationSeal: SECRET}));
write(path.join(home, 'yourrest-crm-update-fast-open-20261029', 'yourrest-activate-update-fast-open.cjs'), 200);
write(path.join(home, 'yourrest-crm-update-android-1011-20261031', 'yourrest-activate-update-android-1011.cjs'), 200);
write(path.join(home, 'Yourrest-CRM-Update-Android-1011-20261031.zip'), 700);
write(path.join(home, 'yourrest-deploy', 'log-1'), 50);
write(path.join(home, 'public_html', 'index.html'), 80);
write(path.join(home, 'yourrest-update-notes.txt'), 0, SECRET);
write(path.join(outside, 'big.bin'), 99999);
fs.symlinkSync(outside, path.join(home, 'link-elsewhere'));
const tree = () => { const hash = createHash('sha256'); const walk = p => { for (const name of fs.readdirSync(p).sort()) { const f = path.join(p, name), st = fs.lstatSync(f); hash.update(f + st.size + st.mtimeMs); if (st.isDirectory()) walk(f); } }; walk(home); return hash.digest('hex'); };

process.env.YR_DIAG_HOME = home;
const before = tree();
const report = run(), printed = JSON.stringify(report);
eq(report.readOnly, true, 'the report says it read only');
eq(report.checkpoints.map(c => [c.name, c.day]), [[cps[0], '20261013'], [cps[1], '20261029'], [cps[3], '20261031'], [cps[2], '20261031']], 'every checkpoint, oldest day first');
eq(report.checkpoints[0].holds, ['application 3000', 'data ' + SECRET.length], 'what a checkpoint holds, by name and size');
eq(report.dailyIndex, [{day: '20261031', checkpoint: cps[2], verifiedAt: '2026-10-31T05:00:00.000Z'}], 'the daily index names the checkpoint that holds the day\'s full copy');
eq(report.stages.map(s => s.name), ['yourrest-crm-update-fast-open-20261029', 'yourrest-crm-update-android-1011-20261031'], 'the unpacked packages');
eq(report.packages.map(p => [p.name, p.bytes]), [['Yourrest-CRM-Update-Android-1011-20261031.zip', 700]], 'the uploaded zip');
eq(report.byKind['activation checkpoint'], {count: 4, bytes: 3000 + SECRET.length + 2000 + 1500 + 510}, 'checkpoints counted and summed');
eq([report.nightly.state, report.nightly.completedAt, report.nightly.kept], ['ok', '2026-11-01T00:15:05.000Z', ['yourrest-backup-20261031T001500000Z-a 900']], 'the nightly backup state and what it keeps');
eq(report.app.map(a => a.name), ['release', 'settings.cjs'], 'what is in the app folder, by name');
eq(report.otherEntries.map(e => e.name).sort(), ['public_html', 'yourrest-update-notes.txt'], 'the rest, by name; a link is not followed');
ok(!printed.includes(SECRET), 'no content of a setting, a record, a checkpoint or the index is printed');
ok(!printed.includes('99999') && report.totalBytes < 99999, 'the linked folder outside the account is not measured');
ok(report.verdict.startsWith('HOME ') && report.verdict.includes('ACTIVATION CHECKPOINTS 4 /') && report.verdict.includes('NIGHTLY BACKUP ok 2026-11-01T00:15:05.000Z, 1 KEPT'), 'the verdict: ' + report.verdict);
eq(tree(), before, 'nothing on the account changed');

console.log(JSON.stringify({ok: true, checks, realHostingTested: false}));
