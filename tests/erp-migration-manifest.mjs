import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { initializeDatabase, inspectInitializedDatabase } from '../portable/initialize.mjs';
import { upgradeExistingDatabase } from '../portable/upgrade.mjs';

const root = path.resolve(import.meta.dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-erp-manifest-'));
const oldNames = fs.readdirSync(path.join(root, 'drizzle')).filter(name => /^\d+.*\.sql$/.test(name) && name < '0012').sort();
const newName = '0012_erp_sales_import.sql';
const staleName = '0000_bitter_chat.sql';
const hash = value => createHash('sha256').update(value).digest('hex');
const digest = file => hash(fs.readFileSync(file));
let checks = 0;
function check(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
function rejects(fn, pattern, message) { assert.throws(fn, pattern, message); checks++; }
async function rejectsAsync(fn, pattern, message) { await assert.rejects(fn, pattern, message); checks++; }
function readDb(filename, fn) { const db = new DatabaseSync(filename, { readOnly: true }); try { return fn(db); } finally { db.close(); } }
function manifest(directory, names = oldNames) {
  const data = { format: 'yourrest-migrations-v1', files: names.map(name => ({ name, sha256: digest(path.join(directory, name)) })) };
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(data));
  return data;
}
function addStale(directory) {
  fs.writeFileSync(path.join(directory, staleName), 'CREATE TABLE auth_challenges(id TEXT); CREATE TABLE foreign_schema_marker(id TEXT);');
  fs.writeFileSync(path.join(directory, '0029_unrelated.sql'), 'INSERT INTO missing_foreign_table VALUES(1);');
}

// Build a minimal synthetic snapshot from the schema, never the bundled customer export.
const seedTables = ['crm_members', 'crm_settings', 'crm_records', 'crm_visit_numbers', 'crm_visit_files', 'crm_sales', 'crm_performance_targets', 'crm_target_sets', 'crm_kpi_assessments', 'crm_service_cases', 'crm_audit'];
const schema = new DatabaseSync(':memory:');
for (const name of oldNames) schema.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8'));
const tables = Object.fromEntries(seedTables.map(table => [table, { columns: [schema.prepare(`PRAGMA table_info("${table}")`).all()[0].name], rows: [] }]));
schema.close();
tables.crm_members = {
  columns: ['id', 'user_id', 'email', 'name', 'role', 'branch', 'created_at', 'region_scope'],
  rows: [{ id: 'owner', user_id: 'synthetic-owner', email: 'manifest-test@yourrest.org', name: 'Synthetic owner', role: 'admin', branch: 'test', created_at: '2026-10-01T00:00:00Z', region_scope: 'all' }],
};
tables.crm_settings = { columns: ['id', 'owner_id'], rows: [{ id: 'company', owner_id: 'synthetic-owner' }] };
tables.crm_records = {
  columns: ['id', 'kind', 'assigned_to', 'branch', 'data', 'created_at', 'updated_at'],
  rows: [{ id: 'synthetic-customer', kind: 'customer', assigned_to: 'owner', branch: 'test', data: '{"name":"Synthetic factory"}', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }],
};
const seed = path.join(work, 'synthetic-seed.json'), checksum = path.join(work, 'synthetic-seed.sha256');
fs.writeFileSync(seed, JSON.stringify({ format: 'yourrest-namecheap-export-v1', tables }));
fs.writeFileSync(checksum, digest(seed));

function fixture(name, { stale = false } = {}) {
  const parent = path.join(work, name), appRoot = path.join(parent, 'app'), migrations = path.join(appRoot, 'release', 'drizzle');
  const data = path.join(parent, 'private-data'), filename = path.join(data, 'database.sqlite');
  fs.mkdirSync(migrations, { recursive: true, mode: 0o700 });
  fs.mkdirSync(data, { mode: 0o700 });
  for (const migration of oldNames) fs.copyFileSync(path.join(root, 'drizzle', migration), path.join(migrations, migration));
  manifest(migrations);
  if (stale) addStale(migrations);
  const options = { filename, migrations, appRoot, seed, checksum };
  const result = initializeDatabase(options);
  check(result.migrations, 12, 'the twelve canonical migrations initialize successfully');
  const db = new DatabaseSync(filename);
  db.exec("UPDATE crm_members SET target=987654 WHERE id='owner'; CREATE TABLE synthetic_session(token TEXT PRIMARY KEY, value TEXT); INSERT INTO synthetic_session VALUES('keep-token','keep-value');");
  db.close();
  return options;
}
function oldState(filename) {
  return readDb(filename, db => ({
    records: db.prepare('SELECT * FROM crm_records ORDER BY id').all(),
    members: db.prepare('SELECT * FROM crm_members ORDER BY id').all(),
    sessions: db.prepare('SELECT * FROM synthetic_session ORDER BY token').all(),
  }));
}
function addErp(options) {
  fs.copyFileSync(path.join(root, 'drizzle', newName), path.join(options.migrations, newName));
  manifest(options.migrations, [...oldNames, newName]);
}
function noBackup(options) { return !fs.existsSync(path.join(path.dirname(options.filename), 'schema-backups')); }

try {
  check(oldNames.length, 12);
  const overlay = fixture('overlay', { stale: true });
  check(inspectInitializedDatabase(overlay), { pending: [], migrations: 12 }, 'unlisted numeric SQL must not become a pending migration');
  check(readDb(overlay.filename, db => db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='foreign_schema_marker'").get().n), 0);
  check(readDb(overlay.filename, db => db.prepare('SELECT count(*) n FROM yr_schema_migrations').get().n), 12);
  check((await upgradeExistingDatabase(overlay)).upgraded, false);
  check(noBackup(overlay), true, 'stale files alone do not create an upgrade or backup');
  check(fs.existsSync(path.join(overlay.migrations, staleName)), true, 'ignored SQL is retained, not deleted');

  const tampered = fixture('checksum');
  fs.appendFileSync(path.join(tampered.migrations, oldNames[0]), '\n-- unexpected modification');
  const beforeTampered = digest(tampered.filename);
  await rejectsAsync(() => upgradeExistingDatabase(tampered), /checksum mismatch/, 'canonical hash mismatches reject before writes');
  check(digest(tampered.filename), beforeTampered);
  check(noBackup(tampered), true);

  const missing = fixture('missing');
  fs.unlinkSync(path.join(missing.migrations, oldNames[0]));
  const beforeMissing = digest(missing.filename);
  await rejectsAsync(() => upgradeExistingDatabase(missing), /ENOENT/, 'missing manifest files reject');
  check(digest(missing.filename), beforeMissing);
  check(noBackup(missing), true);

  const unknown = fixture('unknown-applied', { stale: true });
  const unknownDb = new DatabaseSync(unknown.filename);
  unknownDb.prepare('INSERT INTO yr_schema_migrations VALUES(?,?,?)').run(staleName, digest(path.join(unknown.migrations, staleName)), '2026-10-01T00:00:00Z');
  unknownDb.close();
  const beforeUnknown = digest(unknown.filename);
  await rejectsAsync(() => upgradeExistingDatabase(unknown), /migration history/, 'unlisted applied history must reject even if the matching SQL exists');
  check(digest(unknown.filename), beforeUnknown);
  check(noBackup(unknown), true);

  const invalid = fixture('invalid-manifest');
  const validManifest = JSON.parse(fs.readFileSync(path.join(invalid.migrations, 'manifest.json'), 'utf8'));
  for (const [bad, pattern] of [
    [{ ...validManifest, format: 'another-app' }, /Invalid release/],
    [{ ...validManifest, files: [] }, /Invalid release/],
    [{ ...validManifest, files: [validManifest.files[0], validManifest.files[0]] }, /Duplicate/],
    [{ ...validManifest, files: [{ name: '../outside.sql', sha256: 'a'.repeat(64) }] }, /Invalid release/],
  ]) {
    fs.writeFileSync(path.join(invalid.migrations, 'manifest.json'), JSON.stringify(bad));
    rejects(() => inspectInitializedDatabase(invalid), pattern);
  }
  check(noBackup(invalid), true);

  const upgrade = fixture('erp-upgrade', { stale: true }), beforeUpgrade = oldState(upgrade.filename);
  addErp(upgrade);
  check(inspectInitializedDatabase(upgrade), { pending: [newName], migrations: 13 });
  const upgraded = await upgradeExistingDatabase(upgrade);
  check(upgraded.upgraded, true);
  check(upgraded.migrations, 13);
  check(fs.statSync(upgraded.backup).mode & 0o777, 0o600);
  check(fs.statSync(path.dirname(upgraded.backup)).mode & 0o777, 0o700);
  check(oldState(upgraded.backup), beforeUpgrade, 'automatic backup retains existing data and sessions');
  check(oldState(upgrade.filename), beforeUpgrade, 'upgrade preserves existing data and sessions');
  check(readDb(upgraded.backup, db => db.prepare('SELECT count(*) n FROM yr_schema_migrations').get().n), 12);
  check(readDb(upgraded.backup, db => db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='crm_erp_sales'").get().n), 0);
  check(readDb(upgrade.filename, db => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'crm_erp_%' ORDER BY name").all().map(row => row.name)), ['crm_erp_category_mappings', 'crm_erp_employee_mappings', 'crm_erp_import_state', 'crm_erp_imports', 'crm_erp_sales']);
  check(readDb(upgrade.filename, db => ({ ...db.prepare('SELECT * FROM crm_erp_import_state').get() })), { id: 'yourrest-industries', revision: 0 });
  check(readDb(upgrade.filename, db => db.prepare("SELECT sha256 FROM yr_schema_migrations WHERE name=?").get(newName).sha256), digest(path.join(upgrade.migrations, newName)));
  check(readDb(upgrade.filename, db => db.prepare('PRAGMA integrity_check').get().integrity_check), 'ok');
  check(readDb(upgrade.filename, db => db.prepare('PRAGMA foreign_key_check').all()), []);
  const upgradedHash = digest(upgrade.filename);
  check(await upgradeExistingDatabase(upgrade), { upgraded: false, migrations: 13 });
  check(digest(upgrade.filename), upgradedHash);
  check(fs.readdirSync(path.dirname(upgraded.backup)).length, 1, 'ordinary restarts do not create duplicate backups');

  const badPending = fixture('bad-pending');
  addErp(badPending);
  fs.appendFileSync(path.join(badPending.migrations, newName), '\n-- changed pending migration');
  await rejectsAsync(() => upgradeExistingDatabase(badPending), /checksum mismatch/);
  check(noBackup(badPending), true);

  // Exercise Passenger's actual startup entry: schema migration and private backup
  // must complete before it imports a server that depends on the new ERP tables.
  const startup = fixture('passenger-startup', { stale: true });
  addErp(startup);
  const release = path.dirname(startup.migrations), objects = path.join(path.dirname(startup.filename), 'objects');
  fs.mkdirSync(objects, { mode: 0o700 });
  fs.cpSync(path.join(root, 'portable'), path.join(release, 'operations'), { recursive: true });
  fs.copyFileSync(path.join(root, 'portable', 'app.cjs'), path.join(release, 'app.cjs'));
  fs.writeFileSync(path.join(release, 'server.js'), "const {DatabaseSync}=require('node:sqlite');const fs=require('node:fs'),path=require('node:path');const db=new DatabaseSync(process.env.YR_DATABASE_PATH);console.log(JSON.stringify({started:true,erp:db.prepare('SELECT count(*) n FROM crm_erp_sales').get().n,ledger:db.prepare('SELECT count(*) n FROM yr_schema_migrations').get().n,backups:fs.readdirSync(path.join(path.dirname(process.env.YR_DATABASE_PATH),'schema-backups')).length}));db.close();");
  const started = spawnSync(process.execPath, ['app.cjs'], { cwd: release, encoding: 'utf8', timeout: 15000, env: { PATH: process.env.PATH, YR_APP_ORIGIN: 'https://crm.yourrest.org', YR_AUTH_SECRET: 'a'.repeat(64), YR_DATABASE_PATH: startup.filename, YR_OBJECTS_PATH: objects } });
  check(started.error, undefined, 'Passenger child process must actually run');
  check(started.status, 0, started.stderr);
  check(JSON.parse(started.stdout.trim()), { started: true, erp: 0, ledger: 13, backups: 1 });

  // Exercise real packaging logic without rebuilding the UI: a stub vinext build
  // creates only the expected server entry, leaving manifest generation untouched.
  const packaging = path.join(work, 'packaging'), output = path.join(packaging, 'dist', 'standalone');
  fs.mkdirSync(path.join(packaging, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(packaging, 'node_modules', 'vinext', 'dist'), { recursive: true });
  fs.mkdirSync(path.join(output, 'drizzle'), { recursive: true });
  fs.cpSync(path.join(root, 'portable'), path.join(packaging, 'portable'), { recursive: true });
  fs.cpSync(path.join(root, 'drizzle'), path.join(packaging, 'drizzle'), { recursive: true });
  fs.copyFileSync(path.join(root, 'scripts', 'build-independent.mjs'), path.join(packaging, 'scripts', 'build-independent.mjs'));
  // UI compilation is deliberately outside this migration packaging fixture.
  fs.writeFileSync(path.join(packaging,'scripts','build-offline-shell.mjs'),'// UI build stub for migration-manifest integration only.\n');
  const stubServer = 'const port = Number.parseInt(process.env.PORT ?? "3000", 10);';
  fs.writeFileSync(path.join(packaging, 'node_modules', 'vinext', 'dist', 'cli.js'), `require('node:fs').writeFileSync('dist/standalone/server.js',${JSON.stringify(stubServer)});\n`);
  fs.writeFileSync(path.join(output, 'drizzle', staleName), 'SELECT stale_unrelated_sql;');
  const built = spawnSync(process.execPath, ['scripts/build-independent.mjs'], { cwd: packaging, encoding: 'utf8', timeout: 15000 });
  check(built.error, undefined, 'Packaging child process must actually run');
  check(built.status, 0, built.stderr);
  const generated = JSON.parse(fs.readFileSync(path.join(output, 'drizzle', 'manifest.json'), 'utf8'));
  check(generated.format, 'yourrest-migrations-v1');
  check(generated.files.map(row => row.name), fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort());
  check(generated.files.every(row => row.sha256 === digest(path.join(output, 'drizzle', row.name))), true, 'generated manifest hashes the packaged canonical SQL');
  check(generated.files.some(row => row.name === staleName), false, 'stale output files do not enter the release manifest');
  check(fs.readFileSync(path.join(output, 'operations', 'initialize.mjs'), 'utf8'), fs.readFileSync(path.join(root, 'portable', 'initialize.mjs'), 'utf8'));
  check(fs.readFileSync(path.join(output, 'server.js'), 'utf8').includes('portValue.startsWith'), true, 'packaging retains Unix socket support');

  console.log(JSON.stringify({ ok: true, checks, upgradeFromTwelveToThirteen: true, staleSqlIgnored: true, unknownAppliedHistoryRejected: true, canonicalHashesVerified: true, privateBackupVerified: true, passengerStartupVerified: true, releaseManifestGenerationVerified: true, noProductionDataUsed: true }));
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
