#!/usr/bin/env node
'use strict';
// Standalone deployment helper for the already uploaded 2026-10-07 package.
// No network downloads, setup, migrations, database writes, or service starts.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const PIN = '8d7321668b107e2cdd4e3f75e72333f7871e60963dbbca7e4c12e1971b043648';
const NEW_MIGRATION = '0014_customer_identities.sql';
const fail = code => { throw Object.assign(new Error(code), {code}); };
const exists = p => { try { fs.lstatSync(p); return true; } catch(e) { if(e.code === 'ENOENT') return false; throw e; } };
const inside = (p, root) => p === root || p.startsWith(root + path.sep);
function pathsFor(home) {
  const app = path.join(home, 'yourrest-crm'), stage = path.join(home, 'yourrest-security-update-20261007');
  return {home, app, data:path.join(home,'yourrest-crm-data'), stage, current:path.join(app,'release'),
    newRelease:path.join(stage,'release'), manifest:path.join(stage,'RELEASE-SHA256SUMS.txt'),
    state:path.join(stage,'activation-state.json'), lock:path.join(stage,'activation.lock')};
}
function noLinks(p) {
  for(let q = path.resolve(p);; q = path.dirname(q)) {
    if(fs.lstatSync(q).isSymbolicLink()) fail('SYMLINK_PATH');
    if(q === path.dirname(q)) break;
  }
}
function directory(p, privateMode = false) {
  noLinks(p); const s = fs.lstatSync(p);
  if(!s.isDirectory() || s.uid !== process.getuid() || (privateMode && (s.mode & 0o077))) fail('UNSAFE_DIRECTORY');
}
function digest(p) {
  const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd); if(!before.isFile()) fail('NOT_REGULAR_FILE');
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(256 * 1024);
    let bytes = 0, n;
    while((n = fs.readSync(fd, buffer, 0, buffer.length, null))) { hash.update(buffer.subarray(0,n)); bytes += n; }
    const after = fs.fstatSync(fd);
    if(bytes !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail('FILE_CHANGED_DURING_READ');
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}
function manifestFiles(filename, expectedManifestHash = PIN) {
  noLinks(filename);
  if(digest(filename) !== expectedManifestHash) fail('MANIFEST_MISMATCH');
  const result = new Map();
  for(const line of fs.readFileSync(filename,'utf8').trimEnd().split('\n')) {
    const match = /^([a-f0-9]{64})  (release\/[^\r\n]+)$/.exec(line);
    if(!match || match[2].includes('\\')) fail('INVALID_MANIFEST');
    const name = match[2].slice(8);
    if(name.split('/').some(x => !x || x === '.' || x === '..') || result.has(name)) fail('INVALID_MANIFEST');
    result.set(name, match[1]);
  }
  return result;
}
function inventory(root, {allowSymlinks = false, ignore = new Set()} = {}) {
  noLinks(root); const out = new Map();
  function visit(p, rel) {
    if(ignore.has(rel)) return;
    const s = fs.lstatSync(p), meta = {mode:s.mode,uid:s.uid,gid:s.gid};
    if(s.isSymbolicLink()) {
      if(!allowSymlinks) fail('UNEXPECTED_SYMLINK');
      out.set(rel, {...meta,type:'link',target:fs.readlinkSync(p)});
    } else if(s.isDirectory()) {
      out.set(rel, {...meta,type:'directory'});
      for(const name of fs.readdirSync(p).sort()) visit(path.join(p,name), rel ? rel + '/' + name : name);
    } else if(s.isFile()) out.set(rel, {...meta,type:'file',size:s.size,sha256:digest(p)});
    else fail('UNSUPPORTED_FILE_TYPE');
  }
  visit(root,''); return out;
}
function assertSameInventory(a, b) {
  if(a.size !== b.size) fail('BACKUP_INVENTORY_MISMATCH');
  for(const [name, value] of a) if(JSON.stringify(value) !== JSON.stringify(b.get(name))) fail('BACKUP_CONTENT_MISMATCH');
}
function verifyRelease(p, release) {
  directory(release); const expected = manifestFiles(p.manifest), actual = inventory(release);
  const files = [...actual].filter(([,s]) => s.type === 'file');
  if(expected.size !== 2842 || files.length !== expected.size) fail('RELEASE_INVENTORY_MISMATCH');
  for(const [name,s] of files) if(expected.get(name) !== s.sha256) fail('RELEASE_CHECKSUM_MISMATCH');
}
function ensureStopped(p, procRoot = '/proc') {
  const active = new Set(), gone = e => ['ENOENT','ESRCH'].includes(e.code);
  for(const id of fs.readdirSync(procRoot).filter(n => /^\d+$/.test(n))) {
    if(Number(id) === process.pid) continue;
    const base = path.join(procRoot,id);
    try {
      if(fs.statSync(base).uid !== process.getuid()) continue;
      const cwd = fs.readlinkSync(path.join(base,'cwd'));
      const cmd = fs.readFileSync(path.join(base,'cmdline'),'utf8').replaceAll('\0',' ');
      if(inside(cwd,p.app) || inside(cwd,p.data) || cmd.includes(p.app + '/') || cmd.includes(p.data + '/')) active.add(id);
      for(const fd of fs.readdirSync(path.join(base,'fd'))) {
        try { if(inside(fs.readlinkSync(path.join(base,'fd',fd)),p.data)) active.add(id); }
        catch(e) { if(!gone(e)) fail('PROCESS_INSPECTION_FAILED'); }
      }
    } catch(e) { if(!gone(e)) fail('PROCESS_INSPECTION_FAILED'); }
  }
  if(active.size) fail('APP_OR_DATA_STILL_IN_USE');
  if(exists(path.join(p.data,'.yourrest-backup.lock'))) fail('BACKUP_LOCK_EXISTS');
}
function syncDir(p) { const fd = fs.openSync(p,'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function saveJson(filename, value) {
  const temp = filename + '.tmp-' + process.pid;
  const fd = fs.openSync(temp,'wx',0o600);
  try { fs.writeFileSync(fd,JSON.stringify(value,null,2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp,filename); syncDir(path.dirname(filename));
}
function switchRelease(p, tx, writeState, rename = fs.renameSync) {
  const old = path.join(tx,'old-release');
  directory(p.current); directory(p.newRelease); directory(tx,true);
  if(exists(old)) fail('OLD_RELEASE_DESTINATION_EXISTS');
  if(new Set([p.current,p.newRelease,p.app,tx].map(x => fs.statSync(x).dev)).size !== 1) fail('DIFFERENT_FILESYSTEMS');
  writeState({phase:'moving_old'});
  rename(p.current,old);
  let installed = false;
  try {
    syncDir(p.app); syncDir(tx);
    writeState({phase:'installing_new'});
    rename(p.newRelease,p.current);
    installed = true;
  } catch(e) {
    if(!installed && !exists(p.current) && exists(old) && exists(p.newRelease)) {
      try { rename(old,p.current); syncDir(p.app); syncDir(tx); }
      catch { fail('RESTORE_FAILED_DO_NOT_START_APP'); }
      writeState({phase:'old_release_restored'});
      fail('SWITCH_FAILED_OLD_RELEASE_RESTORED');
    }
    fail('SWITCH_INTERRUPTED_DO_NOT_START_APP');
  }
  // From here the new app could have started: never roll it back automatically.
  syncDir(p.app); syncDir(p.stage);
  writeState({phase:'switched'});
}
function configFor(p, release) {
  const {loadSettings,validatePrivatePath} = require(path.join(release,'operations/config.cjs'));
  const c = loadSettings(p.app);
  if(c.YR_APP_ORIGIN !== 'https://crm.yourrest.org') fail('WRONG_SITE');
  for(const name of ['YR_DATABASE_PATH','YR_OBJECTS_PATH']) {
    c[name] = path.resolve(c[name]);
    if(c[name] === p.data || !inside(c[name],p.data)) fail('DATA_OUTSIDE_EXPECTED_DIRECTORY');
  }
  return {c,check:validatePrivatePath};
}
async function inspect(p, release, config, backup, upgraded = false) {
  const {DatabaseSync} = require('node:sqlite');
  const {inspectInitializedDatabase} = await import(pathToFileURL(path.join(release,'operations/initialize.mjs')).href);
  const map = original => backup ? path.join(backup,'data',path.relative(p.data,original)) : original;
  const filename = config.check(map(config.c.YR_DATABASE_PATH));
  const objects = config.check(map(config.c.YR_OBJECTS_PATH),{directory:true});
  const result = inspectInitializedDatabase({filename,migrations:path.join(release,'drizzle'),appRoot:p.app});
  if(result.migrations !== 15 || result.pending.join(',') !== (upgraded ? '' : NEW_MIGRATION)) fail('UNEXPECTED_MIGRATION_HISTORY');
  const db = new DatabaseSync(filename,{readOnly:true});
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN;');
    const rows = db.prepare('PRAGMA integrity_check').all();
    if(rows.length !== 1 || rows[0].integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').get()) fail('DATABASE_INTEGRITY_FAILED');
    let attachments = 0;
    for(const r of db.prepare('SELECT object_key,size FROM crm_visit_files').iterate()) {
      if(typeof r.object_key !== 'string' || !r.object_key || r.object_key.includes('\0') || r.object_key.length > 2000 || !Number.isSafeInteger(r.size) || r.size < 0) fail('INVALID_ATTACHMENT_REFERENCE');
      const name = createHash('sha256').update(r.object_key).digest('hex');
      const file = config.check(path.join(objects,name));
      if(fs.statSync(file).size !== r.size) fail('ATTACHMENT_SIZE_MISMATCH');
      attachments++;
    }
    const counts = {};
    for(const table of ['crm_records','crm_sales','crm_erp_sales','crm_members']) counts[table] = db.prepare('SELECT COUNT(*) n FROM ' + table).get().n;
    if(upgraded && db.prepare("SELECT COUNT(*) n FROM crm_records r LEFT JOIN crm_customer_numbers n ON n.customer_id=r.id WHERE r.kind='customer' AND n.customer_id IS NULL").get().n) fail('CUSTOMER_CODES_MISSING');
    return {attachments,counts,migrations:upgraded ? 15 : 14};
  } finally { db.close(); }
}
function readState(p) {
  if(!exists(p.state)) return null;
  noLinks(p.state); const s = fs.lstatSync(p.state);
  if(!s.isFile() || s.uid !== process.getuid() || (s.mode & 0o077) || s.size > 1024 * 1024) fail('UNSAFE_ACTIVATION_STATE');
  const value = JSON.parse(fs.readFileSync(p.state,'utf8'));
  if(value.format !== 'yourrest-activation-20261007' || value.home !== p.home || typeof value.transaction !== 'string' || path.dirname(value.transaction) !== p.home || !path.basename(value.transaction).startsWith('yourrest-activation-20261007-')) fail('INVALID_ACTIVATION_STATE');
  return value;
}
async function verifyRunning(p, state, log) {
  if(!state || state.phase !== 'switched') fail('NO_COMPLETED_RELEASE_SWITCH');
  directory(state.transaction,true);
  verifyRelease(p,p.current);
  for(const name of ['settings.cjs','app.cjs']) if(digest(path.join(p.app,name)) !== state.rootHashes[name]) fail('ROOT_CONFIGURATION_CHANGED');
  const config = configFor(p,p.current), summary = await inspect(p,p.current,config,null,true);
  const {DatabaseSync} = require('node:sqlite');
  const original = path.join(state.transaction,'data',path.relative(p.data,config.c.YR_DATABASE_PATH));
  config.check(original);
  const before = new DatabaseSync(original,{readOnly:true}), after = new DatabaseSync(config.c.YR_DATABASE_PATH,{readOnly:true});
  const missing = {};
  try {
    after.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN;');
    for(const table of ['crm_records','crm_sales','crm_erp_sales','crm_members']) {
      let n = 0; const lookup = after.prepare('SELECT 1 FROM ' + table + ' WHERE id=?');
      for(const row of before.prepare('SELECT id FROM ' + table).iterate()) if(!lookup.get(row.id)) n++;
      if(n) missing[table] = n;
    }
  } finally { before.close(); after.close(); }
  for(const [route,expected] of [['/login',200],['/api/crm',401]]) {
    const response = await fetch(config.c.YR_APP_ORIGIN + route,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'Cache-Control':'no-cache'}});
    await response.body?.cancel();
    if(response.status !== expected) fail('HTTP_VERIFICATION_FAILED');
  }
  log('MIGRATIONS: 15 / DATABASE: OK / CUSTOMER CODES: OK');
  log('LOGIN HTTP: 200 / ANONYMOUS CRM API: 401');
  if(Object.keys(missing).length) { log('RECORDS NO LONGER PRESENT: ' + JSON.stringify(missing)); fail('RECORD_CHANGES_REQUIRE_REVIEW_NO_ROLLBACK'); }
  log('PREVIOUS RECORD IDS: PRESERVED');
  log('DEPLOYMENT VERIFIED');
  return summary;
}
async function run(p, mode = 'apply', {log = console.log, stopped = ensureStopped, copy, afterCopy, afterInspect} = {}) {
  const major = Number(process.versions.node.split('.')[0]);
  if(major < 22 || (major === 22 && Number(process.versions.node.split('.')[1]) < 16)) fail('NODE_22_16_OR_NEWER_REQUIRED');
  for(const q of [p.home,p.app,p.stage]) directory(q);
  directory(p.data,true);
  const state = readState(p);
  if(mode === 'verify') return verifyRunning(p,state,log);
  if(state) {
    if(state.phase === 'switched') {
      verifyRelease(p,p.current); log('ALREADY SWITCHED: DO NOT REPEAT; START APP IN CPANEL, THEN RUN --verify'); return state;
    }
    fail('PREVIOUS_ATTEMPT_REQUIRES_REVIEW');
  }
  verifyRelease(p,p.newRelease);
  directory(p.current);
  const config = configFor(p,p.newRelease);
  if(mode === 'check') { log('PACKAGE AND CONFIGURATION: READY. APP MAY REMAIN RUNNING.'); return; }
  stopped(p);
  // mkdir is exclusive. A stale lock is deliberately not deleted automatically.
  try { fs.mkdirSync(p.lock,{mode:0o700}); } catch(e) { if(e.code === 'EEXIST') fail('ACTIVATION_LOCK_EXISTS'); throw e; }
  let ownState;
  try {
    // Another invocation may have finished between the first state read and
    // our exclusive lock. Its checkpoint must never be overwritten.
    if(readState(p)) fail('PREVIOUS_ATTEMPT_REQUIRES_REVIEW');
    stopped(p);
    const tx = fs.mkdtempSync(path.join(p.home,'yourrest-activation-20261007-')); fs.chmodSync(tx,0o700);
    ownState = {format:'yourrest-activation-20261007',home:p.home,transaction:tx,phase:'copying',createdAt:new Date().toISOString(),rootHashes:{}};
    const writeState = update => { ownState = {...ownState,...update}; saveJson(p.state,ownState); saveJson(path.join(tx,'activation-state.json'),ownState); };
    writeState({phase:'copying'});
    log('1/4 APP STOPPED. COPYING CURRENT APPLICATION AND DATA...');
    const doCopy = copy || ((source,target) => { const r = spawnSync('cp',['-a','--',source,target],{stdio:['ignore','ignore','ignore']}); if(r.error || r.status !== 0) fail('BACKUP_COPY_FAILED'); });
    doCopy(p.app,path.join(tx,'application')); doCopy(p.data,path.join(tx,'data'));
    if(afterCopy) await afterCopy(p,tx);
    stopped(p);
    log('2/4 VERIFYING ALL BACKUP FILES...');
    const appBefore = inventory(p.app,{allowSymlinks:true}), dataBefore = inventory(p.data);
    assertSameInventory(appBefore,inventory(path.join(tx,'application'),{allowSymlinks:true}));
    assertSameInventory(dataBefore,inventory(path.join(tx,'data')));
    for(const name of ['settings.cjs','app.cjs']) ownState.rootHashes[name] = digest(path.join(p.app,name));
    const summary = await inspect(p,p.newRelease,config,tx);
    writeState({phase:'backup_verified',baseline:summary});
    if(afterInspect) await afterInspect(p,tx);
    log('3/4 BACKUP VERIFIED. CHECKING FINAL STATE...');
    stopped(p);
    // The readonly SQLite probe touched only the backup. The live source must
    // still match its own pre-probe snapshot, including its WAL and SHM.
    assertSameInventory(appBefore,inventory(p.app,{allowSymlinks:true}));
    assertSameInventory(dataBefore,inventory(p.data));
    verifyRelease(p,p.newRelease);
    stopped(p);
    switchRelease(p,tx,writeState);
    log('4/4 RELEASE SWITCHED'); log('BACKUP: ' + tx); log('START APP IN CPANEL');
    return ownState;
  } catch(e) {
    // Preserve the last durable phase for interruption diagnosis. Never undo
    // a completed switch or restore production data on a generic error.
    if(ownState) log('CHECKPOINT: ' + ownState.phase);
    throw e;
  } finally { fs.rmdirSync(p.lock); }
}
module.exports = {pathsFor,manifestFiles,inventory,assertSameInventory,ensureStopped,switchRelease,run,PIN};
if(require.main === module) {
  process.umask(0o077);
  const args = process.argv.slice(2), modes = {'--check':'check','--verify':'verify'};
  if(args.length > 1 || (args.length && !modes[args[0]])) { console.error('Usage: node yourrest-activate-update.cjs [--check|--verify]'); process.exitCode = 1; }
  else run(pathsFor('/home/youriedx'),modes[args[0]] || 'apply').catch(e => {
    console.error('STOP: ' + (/^[A-Z][A-Z0-9_]{1,90}$/.test(e.code || '') ? e.code : 'ACTIVATION_CHECK_FAILED'));
    console.error('Keep the output for review. Do not delete state/lock files or restore old data.');
    process.exitCode = 1;
  });
}
