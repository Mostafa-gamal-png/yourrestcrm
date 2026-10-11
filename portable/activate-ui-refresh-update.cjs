#!/usr/bin/env node
'use strict';
// Standalone release deployment template. Package with scripts/package-ui-refresh-update.py,
// which pins the manifest and injects the release name, date and upload folder below.
// No network downloads, setup, migrations, database writes, or service starts.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const {createInterface} = require('node:readline');
const PIN = '__UI_REFRESH_MANIFEST_SHA256__';
const RELEASE_FILES = 0; // __UI_REFRESH_RELEASE_FILES__
const RELEASE_NAME = 'ui-refresh'; // __UI_REFRESH_RELEASE_NAME__
const RELEASE_DATE = '20261008'; // __UI_REFRESH_RELEASE_DATE__
const STAGE_DIR = 'yourrest-ui-update-20261008'; // __UI_REFRESH_STAGE_DIR__
const ACTIVATION_FORMAT = 'yourrest-' + RELEASE_NAME + '-activation-' + RELEASE_DATE;
// Same-day backups written by earlier activators remain reusable alongside this release's own.
const BACKUP_TRANSACTION = new RegExp('^yourrest-(?:activation-20261007|customer-edit-activation-20261007|ui-refresh-activation-20261008|' + (RELEASE_NAME + '-activation-' + RELEASE_DATE).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')-[A-Za-z0-9-]+$');
const fail = code => { throw Object.assign(new Error(code), {code}); };
const exists = p => { try { fs.lstatSync(p); return true; } catch(e) { if(e.code === 'ENOENT') return false; throw e; } };
const inside = (p, root) => p === root || p.startsWith(root + path.sep);
const RECORD_TABLES = ['crm_records','crm_sales','crm_erp_sales','crm_members'];
function riyadhDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  if(!Number.isFinite(date.getTime())) fail('INVALID_BACKUP_DATE');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(p => [p.type,p.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}
function timestamp(value) { const parsed = typeof value === 'string' ? Date.parse(value) : NaN; if(!Number.isFinite(parsed)) fail('INVALID_BACKUP_DATE'); return parsed; }
function pathsFor(home) {
  const app = path.join(home, 'yourrest-crm'), stage = path.join(home, STAGE_DIR);
  return {home, app, data:path.join(home,'yourrest-crm-data'), stage, current:path.join(app,'release'),
    newRelease:path.join(stage,'release'), manifest:path.join(stage,'RELEASE-SHA256SUMS.txt'),
    state:path.join(stage,RELEASE_NAME + '-activation-state.json'), lock:path.join(stage,RELEASE_NAME + '-activation.lock'),
    dailyRoot:path.join(home,'yourrest-crm-daily-backups'), dailyLock:path.join(home,'yourrest-crm-daily-backups.lock')};
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
  if(!Number.isSafeInteger(RELEASE_FILES) || RELEASE_FILES < 1 || expected.size !== RELEASE_FILES || files.length !== expected.size) fail('RELEASE_INVENTORY_MISMATCH');
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
async function inspect(p, release, config, backup, upgraded = false, expectedSchema = 15) {
  const {DatabaseSync} = require('node:sqlite');
  const {inspectInitializedDatabase} = await import(pathToFileURL(path.join(release,'operations/initialize.mjs')).href);
  const map = original => backup ? path.join(backup,'data',path.relative(p.data,original)) : original;
  const filename = config.check(map(config.c.YR_DATABASE_PATH));
  const objects = config.check(map(config.c.YR_OBJECTS_PATH),{directory:true});
  for(const suffix of ['-wal','-shm','-journal']) if(exists(filename + suffix)) config.check(filename + suffix);
  const result = inspectInitializedDatabase({filename,migrations:path.join(release,'drizzle'),appRoot:p.app});
  if(result.migrations !== 15 || result.pending.join(',') !== (expectedSchema === 14 ? '0014_customer_identities.sql' : '')) fail('UNEXPECTED_MIGRATION_HISTORY');
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
    for(const table of RECORD_TABLES) counts[table] = db.prepare('SELECT COUNT(*) n FROM ' + table).get().n;
    if(expectedSchema === 15 && db.prepare("SELECT COUNT(*) n FROM crm_records r LEFT JOIN crm_customer_numbers n ON n.customer_id=r.id WHERE r.kind='customer' AND n.customer_id IS NULL").get().n) fail('CUSTOMER_CODES_MISSING');
    return {attachments,counts,migrations:expectedSchema};
  } finally { db.close(); }
}
function privateJson(filename) {
  noLinks(filename); const stat = fs.lstatSync(filename);
  if(!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size > 1024 * 1024) fail('UNSAFE_ACTIVATION_STATE');
  return JSON.parse(fs.readFileSync(filename,'utf8'));
}
function inventorySeal(root, {application = false, shmRelative} = {}) {
  const entries = inventory(root,{allowSymlinks:application});
  if(shmRelative && entries.has(shmRelative)) {
    const shm = entries.get(shmRelative);
    if(shm.type !== 'file' || shm.uid !== process.getuid() || (shm.mode & 0o077)) fail('UNSAFE_SQLITE_CACHE');
    // SQLite's derived shared-memory cache can be touched by read-only probes.
    // Its path, file type, size, owner and permissions remain part of the seal.
    entries.set(shmRelative,{...shm,sha256:'volatile-sqlite-shm-cache'});
  }
  return createHash('sha256').update(JSON.stringify([...entries])).digest('hex');
}
function dailyPaths(config,p) {
  return {databaseRelative:path.relative(p.data,config.c.YR_DATABASE_PATH),objectsRelative:path.relative(p.data,config.c.YR_OBJECTS_PATH)};
}
function checkDailyShape(p,index,day,config,now) {
  const relative = dailyPaths(config,p);
  if(!index || index.format !== 'yourrest-daily-backup-v1' || index.home !== p.home || index.day !== day || ![14,15].includes(index.backupSchema) || typeof index.transaction !== 'string' || path.dirname(index.transaction) !== p.home || !BACKUP_TRANSACTION.test(path.basename(index.transaction)) || index.databaseRelative !== relative.databaseRelative || index.objectsRelative !== relative.objectsRelative || !/^[a-f0-9]{64}$/.test(index.applicationSeal || '') || !/^[a-f0-9]{64}$/.test(index.dataSeal || '')) fail('INVALID_DAILY_BACKUP_INDEX');
  if(timestamp(index.createdAt) > timestamp(index.verifiedAt) || timestamp(index.verifiedAt) > now().getTime() || riyadhDay(index.createdAt) !== day || riyadhDay(index.verifiedAt) !== day) fail('INVALID_DAILY_BACKUP_DATE');
  directory(index.transaction,true); directory(path.join(index.transaction,'application')); directory(path.join(index.transaction,'data'),true);
}
async function validateDailyBackup(p,index,day,config,now) {
  checkDailyShape(p,index,day,config,now);
  const application = path.join(index.transaction,'application'), data = path.join(index.transaction,'data');
  const verify = () => {
    if(inventorySeal(application,{application:true}) !== index.applicationSeal || inventorySeal(data,{shmRelative:index.databaseRelative + '-shm'}) !== index.dataSeal) fail('DAILY_BACKUP_SEAL_MISMATCH');
  };
  verify();
  const summary = await inspect(p,p.newRelease,config,index.transaction,false,index.backupSchema);
  verify();
  if(JSON.stringify(summary) !== JSON.stringify(index.baseline)) fail('DAILY_BACKUP_BASELINE_MISMATCH');
  return index;
}
function makeDailyIndex(p,tx,day,config,summary,createdAt,verifiedAt) {
  const relative = dailyPaths(config,p);
  return {format:'yourrest-daily-backup-v1',day,home:p.home,transaction:tx,...relative,backupSchema:summary.migrations,
    applicationSeal:inventorySeal(path.join(tx,'application'),{application:true}),dataSeal:inventorySeal(path.join(tx,'data'),{shmRelative:relative.databaseRelative + '-shm'}),
    baseline:summary,createdAt,verifiedAt};
}
async function adoptLegacyBackup(p,day,config,now) {
  const filename = path.join(p.home,'yourrest-security-update-20261007','activation-state.json');
  if(!exists(filename)) return null;
  const old = privateJson(filename);
  if(old.format !== 'yourrest-activation-20261007' || old.home !== p.home || typeof old.transaction !== 'string' || path.dirname(old.transaction) !== p.home || !path.basename(old.transaction).startsWith('yourrest-activation-20261007-')) fail('INVALID_LEGACY_BACKUP_STATE');
  if(timestamp(old.createdAt) > now().getTime()) fail('INVALID_LEGACY_BACKUP_DATE');
  if(riyadhDay(old.createdAt) !== day) return null;
  if(old.phase !== 'switched') fail('INCOMPLETE_LEGACY_ACTIVATION');
  directory(old.transaction,true);
  const checkpoint = privateJson(path.join(old.transaction,'activation-state.json'));
  if(JSON.stringify(old) !== JSON.stringify(checkpoint) || old.baseline?.migrations !== 14) fail('INVALID_LEGACY_BACKUP_STATE');
  const application = path.join(old.transaction,'application');directory(application);directory(path.join(old.transaction,'data'),true);
  for(const name of ['settings.cjs','app.cjs']) if(!/^[a-f0-9]{64}$/.test(old.rootHashes?.[name] || '') || digest(path.join(application,name)) !== old.rootHashes[name]) fail('LEGACY_BACKUP_CONFIGURATION_MISMATCH');
  // setup.cjs emits a JSON module. Read only that representation; never execute
  // historical configuration code merely to discover its persistent paths.
  const settings = path.join(application,'settings.cjs');
  if(fs.statSync(settings).size > 128 * 1024) fail('LEGACY_BACKUP_CONFIGURATION_UNREADABLE');
  const assignment = /^\s*module\.exports\s*=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(fs.readFileSync(settings,'utf8'));
  let priorConfig;
  try { priorConfig = assignment && JSON.parse(assignment[1]); } catch { fail('LEGACY_BACKUP_CONFIGURATION_UNREADABLE'); }
  if(!priorConfig || typeof priorConfig !== 'object' || Array.isArray(priorConfig)) fail('LEGACY_BACKUP_CONFIGURATION_UNREADABLE');
  for(const name of ['YR_DATABASE_PATH','YR_OBJECTS_PATH']) if(typeof priorConfig[name] !== 'string' || !path.isAbsolute(priorConfig[name]) || path.resolve(priorConfig[name]) !== config.c[name]) fail('LEGACY_BACKUP_STORAGE_PATH_CHANGED');
  if(priorConfig.YR_APP_ORIGIN !== config.c.YR_APP_ORIGIN) fail('LEGACY_BACKUP_CONFIGURATION_MISMATCH');
  assertSameInventory(inventory(path.join(application,'release'),{allowSymlinks:true}),inventory(path.join(old.transaction,'old-release'),{allowSymlinks:true}));
  const baseline = await inspect(p,p.newRelease,config,old.transaction,false,14);
  if(JSON.stringify(baseline) !== JSON.stringify(old.baseline)) fail('LEGACY_BACKUP_BASELINE_MISMATCH');
  return makeDailyIndex(p,old.transaction,day,config,baseline,old.createdAt,now().toISOString());
}
function saveRecordIds(p,tx,config) {
  const {DatabaseSync} = require('node:sqlite'), filename = path.join(tx,'pre-switch-record-ids.jsonl');
  const db = new DatabaseSync(config.c.YR_DATABASE_PATH,{readOnly:true}), fd = fs.openSync(filename,'wx',0o600), counts = {};
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN;');
    for(const table of RECORD_TABLES) {
      let count = 0;
      for(const row of db.prepare('SELECT id FROM ' + table + ' ORDER BY id').iterate()) { fs.writeFileSync(fd,JSON.stringify([table,row.id]) + '\n'); count++; }
      counts[table] = count;
    }
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); db.close(); }
  syncDir(tx); return {file:filename,sha256:digest(filename),counts};
}
async function missingBaselineIds(p,state,after) {
  const evidence = state.baselineIds;
  if(evidence.file !== path.join(state.transaction,'pre-switch-record-ids.jsonl') || !/^[a-f0-9]{64}$/.test(evidence.sha256 || '')) fail('INVALID_RECORD_BASELINE');
  noLinks(evidence.file); const stat = fs.lstatSync(evidence.file);
  if(!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) || digest(evidence.file) !== evidence.sha256) fail('RECORD_BASELINE_MISMATCH');
  const missing = {}, counts = Object.fromEntries(RECORD_TABLES.map(table => [table,0])), lookups = Object.fromEntries(RECORD_TABLES.map(table => [table,after.prepare('SELECT 1 FROM ' + table + ' WHERE id=?')]));
  const input = fs.createReadStream(evidence.file,{flags:fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW}), lines = createInterface({input,crlfDelay:Infinity});
  try {
    for await(const line of lines) {
      const row = JSON.parse(line);
      if(!Array.isArray(row) || row.length !== 2 || !RECORD_TABLES.includes(row[0]) || typeof row[1] !== 'string') fail('INVALID_RECORD_BASELINE');
      counts[row[0]]++; if(!lookups[row[0]].get(row[1])) missing[row[0]] = (missing[row[0]] || 0) + 1;
    }
  } finally { lines.close(); input.destroy(); }
  if(JSON.stringify(counts) !== JSON.stringify(evidence.counts) || digest(evidence.file) !== evidence.sha256) fail('RECORD_BASELINE_MISMATCH');
  return missing;
}
function readState(p) {
  if(!exists(p.state)) return null;
  noLinks(p.state); const s = fs.lstatSync(p.state);
  if(!s.isFile() || s.uid !== process.getuid() || (s.mode & 0o077) || s.size > 1024 * 1024) fail('UNSAFE_ACTIVATION_STATE');
  const value = JSON.parse(fs.readFileSync(p.state,'utf8'));
  if(value.format !== ACTIVATION_FORMAT || value.home !== p.home || typeof value.transaction !== 'string' || path.dirname(value.transaction) !== p.home || !path.basename(value.transaction).startsWith(ACTIVATION_FORMAT + '-')) fail('INVALID_ACTIVATION_STATE');
  return value;
}
async function verifyRunning(p, state, log) {
  if(!state || state.phase !== 'switched') fail('NO_COMPLETED_RELEASE_SWITCH');
  directory(state.transaction,true);
  verifyRelease(p,p.current);
  for(const name of ['settings.cjs','app.cjs']) if(digest(path.join(p.app,name)) !== state.rootHashes[name]) fail('ROOT_CONFIGURATION_CHANGED');
  const config = configFor(p,p.current), summary = await inspect(p,p.current,config,null,true);
  const {DatabaseSync} = require('node:sqlite');
  const after = new DatabaseSync(config.c.YR_DATABASE_PATH,{readOnly:true});
  let before, missing = {};
  try {
    after.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN;');
    if(state.baselineIds) missing = await missingBaselineIds(p,state,after);
    else {
      // Existing successful activations created before the daily policy remain verifiable.
      const original = path.join(state.transaction,'data',path.relative(p.data,config.c.YR_DATABASE_PATH));
      config.check(original); before = new DatabaseSync(original,{readOnly:true});
      for(const table of RECORD_TABLES) {
        let n = 0; const lookup = after.prepare('SELECT 1 FROM ' + table + ' WHERE id=?');
        for(const row of before.prepare('SELECT id FROM ' + table).iterate()) if(!lookup.get(row.id)) n++;
        if(n) missing[table] = n;
      }
    }
  } finally { before?.close(); after.close(); }
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
async function run(p, mode = 'apply', {log = console.log, stopped = ensureStopped, copy, afterCopy, afterInspect, now = () => new Date()} = {}) {
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
  if(mode === 'check') { log('PACKAGE AND CONFIGURATION: READY. APP MAY REMAIN RUNNING.'); log('BACKUP POLICY: ONE VERIFIED FULL BACKUP PER RIYADH CALENDAR DAY; EACH UPDATE RETAINS ITS OWN RECORD-ID CHECK.'); return; }
  stopped(p);
  // mkdir is exclusive. A stale lock is deliberately not deleted automatically.
  try { fs.mkdirSync(p.lock,{mode:0o700}); } catch(e) { if(e.code === 'EEXIST') fail('ACTIVATION_LOCK_EXISTS'); throw e; }
  let ownState, ownDailyLock = false;
  try {
    try { fs.mkdirSync(p.dailyLock,{mode:0o700}); ownDailyLock = true; }
    catch(e) { if(e.code === 'EEXIST') fail('DAILY_BACKUP_LOCK_EXISTS'); throw e; }
    if(!exists(p.dailyRoot)) fs.mkdirSync(p.dailyRoot,{mode:0o700});
    directory(p.dailyRoot,true);
    // Another invocation may have finished between the first state read and
    // our exclusive lock. Its checkpoint must never be overwritten.
    if(readState(p)) fail('PREVIOUS_ATTEMPT_REQUIRES_REVIEW');
    stopped(p);
    const startedAt = now(), day = riyadhDay(startedAt), dailyFile = path.join(p.dailyRoot,day + '.json');
    const sameDay = () => { if(riyadhDay(now()) !== day) fail('RIYADH_DAY_CHANGED_RETRY_REQUIRED'); };
    const tx = fs.mkdtempSync(path.join(p.home,ACTIVATION_FORMAT + '-')); fs.chmodSync(tx,0o700);
    ownState = {format:ACTIVATION_FORMAT,home:p.home,transaction:tx,phase:'preflight',createdAt:startedAt.toISOString(),rootHashes:{}};
    const writeState = update => { ownState = {...ownState,...update}; saveJson(p.state,ownState); saveJson(path.join(tx,RELEASE_NAME + '-activation-state.json'),ownState); };
    writeState({phase:'preflight'});
    log('1/4 APP STOPPED. VALIDATING CURRENT DATA AND TODAY\'S BACKUP...');
    // Read-only SQLite probes may touch SHM. Complete them before sealing the
    // live files against concurrent changes; the database itself is never written.
    const liveSummary = await inspect(p,p.newRelease,config,null,true);
    const baselineIds = saveRecordIds(p,tx,config);
    const appBefore = inventory(p.app,{allowSymlinks:true}), dataBefore = inventory(p.data);
    for(const name of ['settings.cjs','app.cjs']) ownState.rootHashes[name] = digest(path.join(p.app,name));
    const doCopy = copy || ((source,target) => { const r = spawnSync('cp',['-a','--',source,target],{stdio:['ignore','ignore','ignore']}); if(r.error || r.status !== 0) fail('BACKUP_COPY_FAILED'); });
    let daily;
    if(exists(dailyFile)) {
      daily = await validateDailyBackup(p,privateJson(dailyFile),day,config,now);
      log('2/4 TODAY\'S VERIFIED FULL BACKUP REUSED. NO NEW FULL COPY.');
    } else {
      daily = await adoptLegacyBackup(p,day,config,now);
      if(daily) log('2/4 TODAY\'S VERIFIED SECURITY BACKUP ADOPTED. NO NEW FULL COPY.');
      else {
        writeState({phase:'copying'});
        log('2/4 NO VERIFIED BACKUP TODAY. COPYING APPLICATION AND DATA...');
        doCopy(p.app,path.join(tx,'application')); doCopy(p.data,path.join(tx,'data'));
        if(afterCopy) await afterCopy(p,tx);
        stopped(p);
        assertSameInventory(appBefore,inventory(path.join(tx,'application'),{allowSymlinks:true}));
        assertSameInventory(dataBefore,inventory(path.join(tx,'data')));
        const summary = await inspect(p,p.newRelease,config,tx);
        daily = makeDailyIndex(p,tx,day,config,summary,ownState.createdAt,now().toISOString());
      }
      sameDay();
      saveJson(dailyFile,daily);
    }
    writeState({phase:'backup_verified',baseline:liveSummary,baselineIds,dailyBackup:{day,index:dailyFile,transaction:daily.transaction}});
    if(afterInspect) await afterInspect(p,tx);
    log('3/4 BACKUP VERIFIED. CHECKING FINAL STATE...');
    stopped(p);
    // The live source must still match its snapshot after the read-only probes,
    // including WAL and SHM. Daily-backup age never weakens this activation guard.
    assertSameInventory(appBefore,inventory(p.app,{allowSymlinks:true}));
    assertSameInventory(dataBefore,inventory(p.data));
    verifyRelease(p,p.newRelease);
    stopped(p);
    sameDay();
    switchRelease(p,tx,writeState);
    log('4/4 RELEASE SWITCHED'); log('DAILY BACKUP: ' + daily.transaction); log('ACTIVATION CHECKPOINT: ' + tx); log('START APP IN CPANEL');
    return ownState;
  } catch(e) {
    // Preserve the last durable phase for interruption diagnosis. Never undo
    // a completed switch or restore production data on a generic error.
    if(ownState) log('CHECKPOINT: ' + ownState.phase);
    throw e;
  } finally { if(ownDailyLock) fs.rmdirSync(p.dailyLock); fs.rmdirSync(p.lock); }
}
module.exports = {pathsFor,manifestFiles,inventory,assertSameInventory,ensureStopped,switchRelease,run,riyadhDay,PIN,RELEASE_FILES,RELEASE_NAME,RELEASE_DATE,STAGE_DIR,ACTIVATION_FORMAT};
if(require.main === module) {
  process.umask(0o077);
  const args = process.argv.slice(2), modes = {'--check':'check','--verify':'verify'};
  if(args.length > 1 || (args.length && !modes[args[0]])) { console.error('Usage: node ' + path.basename(__filename) + ' [--check|--verify]'); process.exitCode = 1; }
  else run(pathsFor('/home/youriedx'),modes[args[0]] || 'apply').catch(e => {
    console.error('STOP: ' + (/^[A-Z][A-Z0-9_]{1,90}$/.test(e.code || '') ? e.code : 'ACTIVATION_CHECK_FAILED'));
    console.error('Keep the output for review. Do not delete state/lock files or restore old data.');
    process.exitCode = 1;
  });
}
