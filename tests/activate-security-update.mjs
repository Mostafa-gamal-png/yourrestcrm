import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const helper = require('../portable/activate-security-update.cjs');
const {inventory, assertSameInventory, manifestFiles, pathsFor, ensureStopped, switchRelease} = helper;
const previousUmask = process.umask(0o077);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-activation-tests-'));
let checks = 0;
const check = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
const rejects = (operation, message) => {
  assert.throws(operation, message);
  checks++;
};
const digest = value => createHash('sha256').update(value).digest('hex');
const directory = name => {
  const destination = path.join(work, name);
  fs.mkdirSync(destination, {recursive:true, mode:0o700});
  return destination;
};
const file = (root, name, contents = 'fixture', mode = 0o600) => {
  const destination = path.join(root, name);
  fs.mkdirSync(path.dirname(destination), {recursive:true, mode:0o700});
  fs.writeFileSync(destination, contents, {mode});
  return destination;
};

try {
  // A copied tree must retain its data, permissions and complete directory list.
  const source = directory('source');
  file(source, 'settings.cjs', 'module.exports={};\n');
  file(source, 'objects/attachment', Buffer.alloc(600_000, 65));
  fs.mkdirSync(path.join(source, 'empty'), {mode:0o700});
  const copy = path.join(work, 'copy');
  fs.cpSync(source, copy, {recursive:true, preserveTimestamps:true});
  const original = inventory(source);
  check(original instanceof Map, true);
  assertSameInventory(original, inventory(copy));
  checks++;

  // Same length corruption cannot slip through a size-only comparison.
  file(copy, 'objects/attachment', Buffer.alloc(600_000, 66));
  rejects(() => assertSameInventory(original, inventory(copy)));
  fs.copyFileSync(path.join(source, 'objects/attachment'), path.join(copy, 'objects/attachment'));
  fs.unlinkSync(path.join(copy, 'settings.cjs'));
  rejects(() => assertSameInventory(original, inventory(copy)));
  fs.copyFileSync(path.join(source, 'settings.cjs'), path.join(copy, 'settings.cjs'));
  file(copy, 'unexpected-file');
  rejects(() => assertSameInventory(original, inventory(copy)));
  fs.unlinkSync(path.join(copy, 'unexpected-file'));
  fs.rmdirSync(path.join(copy, 'empty'));
  rejects(() => assertSameInventory(original, inventory(copy)));
  fs.mkdirSync(path.join(copy, 'empty'), {mode:0o700});
  fs.chmodSync(path.join(copy, 'settings.cjs'), 0o644);
  rejects(() => assertSameInventory(original, inventory(copy)));
  fs.chmodSync(path.join(copy, 'settings.cjs'), 0o600);
  assertSameInventory(original, inventory(copy));
  checks++;

  // Data links and linked ancestors fail closed, including links to real directories.
  const external = directory('external');
  file(external, 'private-data', 'do not follow this link');
  fs.symlinkSync(external, path.join(copy, 'linked-directory'));
  rejects(() => inventory(copy));
  fs.unlinkSync(path.join(copy, 'linked-directory'));
  fs.symlinkSync(path.join(external, 'private-data'), path.join(copy, 'linked-file'));
  rejects(() => inventory(copy));
  fs.unlinkSync(path.join(copy, 'linked-file'));
  fs.symlinkSync(copy, path.join(work, 'alias'));
  rejects(() => inventory(path.join(work, 'alias')));
  rejects(() => inventory(path.join(work, 'alias/objects')));

  // Application links are preserved as links; inventory never follows their targets.
  const app = directory('app-with-links');
  file(app, 'app.cjs');
  fs.symlinkSync(external, path.join(app, 'node_modules'));
  fs.symlinkSync('missing-target', path.join(app, 'dangling'));
  const appCopy = path.join(work, 'app-copy');
  fs.cpSync(app, appCopy, {recursive:true, verbatimSymlinks:true});
  const appInventory = inventory(app, {allowSymlinks:true});
  assertSameInventory(appInventory, inventory(appCopy, {allowSymlinks:true}));
  checks++;
  file(external, 'private-data', 'changed outside the application');
  assertSameInventory(appInventory, inventory(app, {allowSymlinks:true}));
  checks++;
  check([...appInventory.keys()].some(name => name.endsWith('private-data')), false);
  fs.unlinkSync(path.join(appCopy, 'node_modules'));
  fs.symlinkSync(copy, path.join(appCopy, 'node_modules'));
  rejects(() => assertSameInventory(appInventory, inventory(appCopy, {allowSymlinks:true})));
  rejects(() => inventory(path.join(work, 'alias/objects'), {allowSymlinks:true}));

  // Ownership and type are part of the evidence even if bytes match.
  const firstFile = [...original].find(([, value]) => value.sha256);
  assert.ok(firstFile, 'inventory must contain file digests');
  checks++;
  for (const key of ['uid', 'gid', 'type']) {
    const changed = new Map(original);
    changed.set(firstFile[0], {...firstFile[1], [key]:key === 'type' ? 'different' : firstFile[1][key] + 1});
    rejects(() => assertSameInventory(original, changed));
  }

  // A pinned manifest prevents tampering before a release is considered for activation.
  const manifests = directory('manifests');
  const correct = Array.from({length:2842}, (_, index) =>
    `${digest('fixture-' + index)}  release/fixture-${index}.cjs\n`).join('');
  const manifest = file(manifests, 'RELEASE-SHA256SUMS.txt', correct);
  check(manifestFiles(manifest, digest(correct)).size, 2842);
  rejects(() => manifestFiles(manifest, '0'.repeat(64)));
  const aliasManifest = path.join(manifests, 'alias.txt');
  fs.symlinkSync(manifest, aliasManifest);
  rejects(() => manifestFiles(aliasManifest, digest(correct)));
  for (const invalid of [
    `${digest('one')}  release/../settings.cjs\n`,
    `${digest('one')}  /release/app.cjs\n`,
    `${digest('one')}  settings.cjs\n`,
    `${digest('one')}  release/app.cjs\n${digest('two')}  release/app.cjs\n`,
    `not-a-sha256  release/app.cjs\n`,
  ]) {
    fs.writeFileSync(manifest, invalid);
    rejects(() => manifestFiles(manifest, digest(invalid)));
  }

  // Inspect an isolated proc fixture: cwd, command and open DB descriptors all block activation.
  const processHome = directory('process-home');
  const processPaths = pathsFor(processHome);
  fs.mkdirSync(processPaths.data, {mode:0o700});
  fs.mkdirSync(processPaths.app, {mode:0o700});
  const proc = directory('proc');
  const pid = String(process.pid + 100_000);
  const processRoot = path.join(proc, pid);
  fs.mkdirSync(path.join(processRoot, 'fd'), {recursive:true, mode:0o700});
  fs.symlinkSync(processHome, path.join(processRoot, 'cwd'));
  file(processRoot, 'cmdline', 'unrelated\0process\0');
  ensureStopped(processPaths, proc);
  checks++;
  fs.unlinkSync(path.join(processRoot, 'cwd'));
  fs.symlinkSync(processPaths.app, path.join(processRoot, 'cwd'));
  rejects(() => ensureStopped(processPaths, proc), {code:'APP_OR_DATA_STILL_IN_USE'});
  fs.unlinkSync(path.join(processRoot, 'cwd'));
  fs.symlinkSync(processHome, path.join(processRoot, 'cwd'));
  file(processRoot, 'cmdline', `node\0${processPaths.app}/app.cjs\0`);
  rejects(() => ensureStopped(processPaths, proc), {code:'APP_OR_DATA_STILL_IN_USE'});
  file(processRoot, 'cmdline', 'unrelated\0process\0');
  fs.symlinkSync(path.join(processPaths.data, 'database.sqlite-wal'), path.join(processRoot, 'fd/4'));
  rejects(() => ensureStopped(processPaths, proc), {code:'APP_OR_DATA_STILL_IN_USE'});
  fs.unlinkSync(path.join(processRoot, 'fd/4'));
  fs.symlinkSync(path.join(processHome, 'yourrest-crm-data-other/database.sqlite'), path.join(processRoot, 'fd/5'));
  ensureStopped(processPaths, proc);
  checks++;
  fs.mkdirSync(path.join(processPaths.data, '.yourrest-backup.lock'), {mode:0o700});
  rejects(() => ensureStopped(processPaths, proc), {code:'BACKUP_LOCK_EXISTS'});
  fs.rmdirSync(path.join(processPaths.data, '.yourrest-backup.lock'));
  fs.unlinkSync(path.join(processRoot, 'cwd'));
  file(processRoot, 'cwd', 'not-a-process-link');
  rejects(() => ensureStopped(processPaths, proc), {code:'PROCESS_INSPECTION_FAILED'});

  function switchFixture(name) {
    const home = directory(name);
    const p = pathsFor(home);
    for (const name of [p.current, p.newRelease]) fs.mkdirSync(name, {recursive:true, mode:0o700});
    file(p.current, 'version', 'old');
    file(p.newRelease, 'version', 'new');
    file(p.app, 'settings.cjs', 'preserve-settings');
    const tx = path.join(home, 'transaction');
    fs.mkdirSync(tx, {mode:0o700});
    const phases = [];
    return {p, tx, phases, writeState:update => phases.push(update.phase)};
  }
  const read = filename => fs.readFileSync(filename, 'utf8');

  // A normal switch moves whole directories; root settings and old files survive.
  {
    const {p, tx, phases, writeState} = switchFixture('successful-switch');
    switchRelease(p, tx, writeState);
    check(read(path.join(p.current, 'version')), 'new');
    check(read(path.join(tx, 'old-release/version')), 'old');
    check(read(path.join(p.app, 'settings.cjs')), 'preserve-settings');
    check(fs.existsSync(p.newRelease), false);
    check(phases, ['moving_old', 'installing_new', 'switched']);
  }
  // A failure before installing the new release restores the exact old directory.
  {
    const {p, tx, phases, writeState} = switchFixture('failed-new-rename');
    let renames = 0;
    const rename = (a, b) => {
      if (++renames === 2) throw Object.assign(new Error('injected disk failure'), {code:'EIO'});
      fs.renameSync(a, b);
    };
    rejects(() => switchRelease(p, tx, writeState, rename), {code:'SWITCH_FAILED_OLD_RELEASE_RESTORED'});
    check(read(path.join(p.current, 'version')), 'old');
    check(read(path.join(p.newRelease, 'version')), 'new');
    check(fs.existsSync(path.join(tx, 'old-release')), false);
    check(phases, ['moving_old', 'installing_new', 'old_release_restored']);
  }
  // Existing recovery material must never be overwritten, even if it is empty.
  {
    const {p, tx, phases, writeState} = switchFixture('existing-old-destination');
    fs.mkdirSync(path.join(tx, 'old-release'), {mode:0o700});
    rejects(() => switchRelease(p, tx, writeState), {code:'OLD_RELEASE_DESTINATION_EXISTS'});
    check(read(path.join(p.current, 'version')), 'old');
    check(read(path.join(p.newRelease, 'version')), 'new');
    check(phases, []);
  }
  // State persistence failing before the old move cannot create an untracked swap.
  {
    const {p, tx} = switchFixture('state-before-old-failure');
    rejects(() => switchRelease(p, tx, () => { throw Error('state disk unavailable'); }));
    check(read(path.join(p.current, 'version')), 'old');
    check(read(path.join(p.newRelease, 'version')), 'new');
  }
  // State persistence failing between renames rolls back, while a final state error
  // must retain the newly installed release (it might already have served writes).
  {
    const {p, tx, phases} = switchFixture('state-between-renames-failure');
    rejects(() => switchRelease(p, tx, update => {
      phases.push(update.phase);
      if (update.phase === 'installing_new') throw Error('injected state error');
    }), {code:'SWITCH_FAILED_OLD_RELEASE_RESTORED'});
    check(read(path.join(p.current, 'version')), 'old');
    check(read(path.join(p.newRelease, 'version')), 'new');
    check(phases.at(-1), 'old_release_restored');
  }
  {
    const {p, tx, phases} = switchFixture('state-after-new-failure');
    rejects(() => switchRelease(p, tx, update => {
      phases.push(update.phase);
      if (update.phase === 'switched') throw Error('injected final state error');
    }));
    check(read(path.join(p.current, 'version')), 'new');
    check(read(path.join(tx, 'old-release/version')), 'old');
    check(fs.existsSync(p.newRelease), false);
  }
  // A conflicting current directory after a failed install is preserved for review.
  {
    const {p, tx, writeState} = switchFixture('unexpected-current');
    let renames = 0;
    rejects(() => switchRelease(p, tx, writeState, (a, b) => {
      if (++renames === 2) {
        fs.mkdirSync(p.current, {mode:0o700});
        file(p.current, 'do-not-delete', 'concurrent-change');
        throw Error('injected conflict');
      }
      fs.renameSync(a, b);
    }), {code:'SWITCH_INTERRUPTED_DO_NOT_START_APP'});
    check(read(path.join(p.current, 'do-not-delete')), 'concurrent-change');
    check(read(path.join(tx, 'old-release/version')), 'old');
    check(read(path.join(p.newRelease, 'version')), 'new');
  }
  // A failed restoration explicitly reports that the application cannot be started.
  {
    const {p, tx, writeState} = switchFixture('restore-failure');
    let renames = 0;
    rejects(() => switchRelease(p, tx, writeState, (a, b) => {
      if (++renames > 1) throw Error('injected rename failure');
      fs.renameSync(a, b);
    }), {code:'RESTORE_FAILED_DO_NOT_START_APP'});
    check(fs.existsSync(p.current), false);
    check(read(path.join(tx, 'old-release/version')), 'old');
    check(read(path.join(p.newRelease, 'version')), 'new');
  }

  console.log(JSON.stringify({ok:true, checks, scope:'temporary activation fixtures: exact copy, corruption, paths, links, process guards, pinned manifest, switch and recovery', productionDataUsed:false}));
} finally {
  fs.rmSync(work, {recursive:true, force:true});
  process.umask(previousUmask);
}
