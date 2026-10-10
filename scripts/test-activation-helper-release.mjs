// Actual uploaded ZIP, synthetic data only, no external HTTP or production filesystem access.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

const require = createRequire(import.meta.url);
const sourceRoot = path.resolve(import.meta.dirname, '..');
const helperFile = path.join(sourceRoot, 'portable/activate-security-update.cjs');
const helper = require(helperFile);
const zip = process.env.YOURREST_RELEASE_ZIP || path.resolve(sourceRoot, '../yourrest-publish-20261007/Yourrest-CRM-Security-Update-20261007.zip');
const previousUmask = process.umask(0o077);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-activation-smoke-'));
const reportPath = path.join(sourceRoot, 'output/publish-preflight/activation-helper-smoke.json');
fs.mkdirSync(path.dirname(reportPath), {recursive:true, mode:0o700});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let checks = 0, result;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const rejects = async (fn, code) => { await assert.rejects(fn, code ? {code} : undefined); checks++; };
const mkdir = p => fs.mkdirSync(p, {recursive:true, mode:0o700});
const file = (p, content) => fs.writeFileSync(p, content, {mode:0o600});
const fetchBefore = globalThis.fetch;
globalThis.fetch = async () => { throw Error('Network forbidden in activation smoke test'); };

try {
  eq(hash(fs.readFileSync(zip)), '2cfae0b666d0c5ba9419d91360a33f5f29910b7c9bdbbe5db19451ad85a48e9d');
  const template = path.join(work, 'template');
  const extracted = spawnSync('python3', ['-c', 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zip, template], {encoding:'utf8'});
  eq(extracted.status, 0, extracted.stderr);
  eq(helper.manifestFiles(path.join(template, 'RELEASE-SHA256SUMS.txt')).size, 2842);
  const manifest = JSON.parse(fs.readFileSync(path.join(template, 'release/drizzle/manifest.json'), 'utf8'));
  eq(manifest.files.length, 15);

  function fixture(name) {
    const home = path.join(work, name); mkdir(home);
    const p = helper.pathsFor(home); mkdir(p.app); mkdir(p.data);
    fs.cpSync(template, p.stage, {recursive:true});
    mkdir(p.current); file(path.join(p.current, 'old-version'), 'previous release');
    file(path.join(p.app, 'app.cjs'), '// Synthetic old root launcher: preserved, never executed.\n');
    const database = path.join(p.data, 'database.sqlite'), objects = path.join(p.data, 'objects'); mkdir(objects);
    const settings = {YR_APP_ORIGIN:'https://crm.yourrest.org', YR_DATABASE_PATH:database, YR_OBJECTS_PATH:objects,
      YR_AUTH_SECRET:randomBytes(32).toString('hex'), YR_MAIL_TRANSPORT:'sendmail', YR_MAIL_FROM:'synthetic@yourrest.org', YR_SENDMAIL_PATH:'/synthetic-unused-sendmail'};
    const settingsPath = path.join(p.app, 'settings.cjs');
    file(settingsPath, 'module.exports=' + JSON.stringify(settings) + ';\n');
    const db = new DatabaseSync(database);
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE yr_schema_migrations(name TEXT PRIMARY KEY NOT NULL,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)');
    for (const entry of manifest.files.slice(0, 14)) {
      db.exec(fs.readFileSync(path.join(p.newRelease, 'drizzle', entry.name), 'utf8'));
      db.prepare('INSERT INTO yr_schema_migrations VALUES(?,?,?)').run(entry.name, entry.sha256, '2026-10-07T00:00:00Z');
    }
    const insert = (table, row) => db.prepare('INSERT INTO ' + table + ' (' + Object.keys(row).join(',') + ') VALUES (' + Object.keys(row).map(() => '?').join(',') + ')').run(...Object.values(row));
    const now = '2026-10-07T08:00:00Z';
    insert('crm_members', {id:'owner', user_id:'synthetic-owner', email:'synthetic@yourrest.org', name:'Synthetic owner', role:'admin', branch:'Test', active:1, target:1, created_at:now, region_scope:'all'});
    insert('crm_settings', {id:'company', owner_id:'synthetic-owner'});
    insert('crm_records', {id:'synthetic-customer', kind:'customer', assigned_to:'owner', branch:'Test', data:'{"name":"Synthetic factory","code":"ERP1"}', created_at:now, updated_at:now, version:1, mutation_id:'synthetic-record'});
    const objectKey = 'synthetic/attachment', bytes = Buffer.from('%PDF-synthetic-attachment');
    const attachment = path.join(objects, hash(objectKey)); file(attachment, bytes);
    insert('crm_visit_files', {id:'synthetic-file', object_key:objectKey, customer_id:'synthetic-customer', name:'synthetic.pdf', content_type:'application/pdf', size:bytes.length, uploaded_by:'owner', created_at:now});
    db.close(); fs.chmodSync(database, 0o600);
    return {p, database, attachment, settings, settingsPath};
  }
  const readState = p => JSON.parse(fs.readFileSync(p.state, 'utf8'));
  const ledgerCount = filename => { const db = new DatabaseSync(filename, {readOnly:true}); try { return db.prepare('SELECT COUNT(*) n FROM yr_schema_migrations').get().n; } finally { db.close(); } };
  const logs = [];
  const quiet = {log:s => logs.push(s), stopped:() => {}};

  // Full real package activation takes a new complete backup and swaps only release.
  {
    const {p, database, attachment, settingsPath} = fixture('success');
    const originalApp = helper.inventory(p.app, {allowSymlinks:true});
    const originalData = helper.inventory(p.data);
    const settingsHash = hash(fs.readFileSync(settingsPath));
    const state = await helper.run(p, 'apply', quiet);
    eq(state.phase, 'switched');
    helper.assertSameInventory(originalApp, helper.inventory(path.join(state.transaction, 'application'), {allowSymlinks:true})); checks++;
    helper.assertSameInventory(originalData, helper.inventory(path.join(state.transaction, 'data'))); checks++;
    helper.assertSameInventory(originalData, helper.inventory(p.data)); checks++;
    eq(hash(fs.readFileSync(settingsPath)), settingsHash);
    eq(fs.readFileSync(path.join(state.transaction, 'old-release/old-version'), 'utf8'), 'previous release');
    eq(fs.existsSync(p.newRelease), false);
    eq(fs.existsSync(p.lock), false);
    eq(ledgerCount(database), 14, 'Activation must not migrate or write the live database');
    eq(fs.statSync(state.transaction).mode & 0o777, 0o700);
    eq(fs.statSync(p.state).mode & 0o777, 0o600);
    const beforeRerun = fs.readdirSync(p.home).sort();
    eq((await helper.run(p, 'apply', quiet)).transaction, state.transaction);
    eq(fs.readdirSync(p.home).sort(), beforeRerun, 'Repeat apply creates no backup or swap');
    const {initializeDatabase} = await import(pathToFileURL(path.join(p.current, 'operations/initialize.mjs')).href);
    initializeDatabase({filename:database, migrations:path.join(p.current, 'drizzle'), appRoot:p.app});
    eq(ledgerCount(database), 15);
    const fetched = [];
    globalThis.fetch = async url => {
      fetched.push(url);
      assert.ok(['https://crm.yourrest.org/login', 'https://crm.yourrest.org/api/crm'].includes(url));
      return {status:url.endsWith('/login') ? 200 : 401, body:{cancel:async () => {}}};
    };
    const verified = await helper.run(p, 'verify', quiet);
    eq(verified.migrations, 15);
    eq(fetched.length, 2);
    eq(ledgerCount(path.join(state.transaction, 'data/database.sqlite')), 14);
    eq(fs.readFileSync(attachment, 'utf8'), '%PDF-synthetic-attachment');
    globalThis.fetch = async () => { throw Error('Network forbidden'); };
  }
  // Corruption in a completed copy is detected before moving either release.
  {
    const {p} = fixture('copy-corruption');
    await rejects(() => helper.run(p, 'apply', {...quiet, afterCopy(_p, tx) {
      const backupSettings = path.join(tx, 'application/settings.cjs');
      const bytes = fs.readFileSync(backupSettings); bytes[0] ^= 1; file(backupSettings, bytes);
    }}), 'BACKUP_CONTENT_MISMATCH');
    eq(fs.readFileSync(path.join(p.current, 'old-version'), 'utf8'), 'previous release');
    eq(fs.existsSync(p.newRelease), true);
    eq(readState(p).phase, 'copying');
    await rejects(() => helper.run(p, 'apply', quiet), 'PREVIOUS_ATTEMPT_REQUIRES_REVIEW');
  }
  // A source change after backup inspection must not cause a stale-backup deployment.
  {
    const {p, attachment} = fixture('live-change');
    await rejects(() => helper.run(p, 'apply', {...quiet, afterInspect() {
      const bytes = fs.readFileSync(attachment); bytes[bytes.length - 1] ^= 1; file(attachment, bytes);
    }}), 'BACKUP_CONTENT_MISMATCH');
    eq(fs.readFileSync(path.join(p.current, 'old-version'), 'utf8'), 'previous release');
    eq(readState(p).phase, 'backup_verified');
    eq(fs.existsSync(p.lock), false);
  }

  // Verify both reviewed defects using temporary copies with one fix removed.
  const helperText = fs.readFileSync(helperFile, 'utf8');
  function mutation(name, needle, replacement) {
    assert.ok(helperText.includes(needle));
    const filename = path.join(work, name + '.cjs');
    file(filename, helperText.replace(needle, replacement));
    return require(filename);
  }
  async function stateRace(engine, name) {
    const {p} = fixture(name);
    let checksStopped = 0, copies = 0;
    const prior = {format:'yourrest-activation-20261007', home:p.home, transaction:path.join(p.home, 'yourrest-activation-20261007-prior'), phase:'backup_verified'};
    mkdir(prior.transaction);
    let error;
    try {
      await engine.run(p, 'apply', {...quiet, stopped() {
        if (++checksStopped === 1) file(p.state, JSON.stringify(prior));
      }, copy() { copies++; throw Object.assign(Error('copy must not start'), {code:'TEST_COPY_REACHED'}); }});
    } catch (e) { error = e; }
    assert.equal(error?.code, 'PREVIOUS_ATTEMPT_REQUIRES_REVIEW');
    assert.equal(copies, 0);
    assert.deepEqual(readState(p), prior);
    assert.equal(fs.readdirSync(p.home).filter(x => x.startsWith('yourrest-activation-20261007-')).length, 1);
  }
  await stateRace(helper, 'state-race-fixed'); checks++;
  const withoutRaceGuard = mutation('without-race-guard', "    if(readState(p)) fail('PREVIOUS_ATTEMPT_REQUIRES_REVIEW');", '    // Deliberately removed only for the regression experiment.');
  await rejects(() => stateRace(withoutRaceGuard, 'state-race-old'), 'ERR_ASSERTION');

  async function pathEscape(engine, name) {
    const {p, database, settings, settingsPath} = fixture(name);
    const outside = path.join(p.home, 'other-private-data'); mkdir(outside);
    fs.copyFileSync(database, path.join(outside, 'database.sqlite'));
    settings.YR_DATABASE_PATH = p.data + '/../other-private-data/database.sqlite';
    file(settingsPath, 'module.exports=' + JSON.stringify(settings) + ';\n');
    await assert.rejects(() => engine.run(p, 'check', quiet), {code:'DATA_OUTSIDE_EXPECTED_DIRECTORY'});
    assert.equal(fs.existsSync(p.state), false);
  }
  await pathEscape(helper, 'path-escape-fixed'); checks++;
  const withoutNormalization = mutation('without-path-normalization', '    c[name] = path.resolve(c[name]);', '    // Deliberately removed only for the regression experiment.');
  await rejects(() => pathEscape(withoutNormalization, 'path-escape-old'), 'ERR_ASSERTION');
  result = {ok:true, checks, packageSha256:hash(fs.readFileSync(zip)), realPackageFiles:2842, fullApplyAndRerun:true, backupByteComparison:true,
    corruptionAndLateSourceChangeBlocked:true, oldFailsNewPasses:['state-race-before-lock','data-path-dotdot-escape'],
    schemaAfterApply:14, schemaAfterSyntheticStartup:15, verifyHttp:'stubbed; no requests sent', productionDataUsed:false, productionModified:false};
} catch (error) {
  result = {ok:false, checks, error:error.message, code:error.code, productionDataUsed:false, productionModified:false};
  process.exitCode = 1;
} finally {
  globalThis.fetch = fetchBefore;
  fs.rmSync(work, {recursive:true, force:true});
  process.umask(previousUmask);
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2) + '\n', {mode:0o600});
  console.log(JSON.stringify(result));
}
