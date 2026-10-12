// A release that adds a database migration (15 -> 16), exercised end to end on real SQLite with the real packager,
// the pinned activator and the application's own startup upgrade. Isolated fixtures only: no hosting, no production data.
// The activator never writes to the database; the application applies 0015 on its first start, after a private backup.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

const root = process.cwd(), require = createRequire(import.meta.url), umask = process.umask(0o077);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-schema-update-test-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const put = (file, bytes) => { fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700}); fs.writeFileSync(file, bytes, {mode: 0o600}); };
const read = file => fs.readFileSync(file, 'utf8');
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const rejects = async (fn, code, message) => { await assert.rejects(fn, {code}, message); checks++; };
const NEWEST = '0015_member_devices.sql', oldFetch = globalThis.fetch;
let helper, release, manifest, statuses = {};
try {
  // ---- package a 16-migration release exactly as the real packager does
  const build = path.join(work, 'build');
  for (const name of ['node_modules', 'dist/server', 'dist/client', 'drizzle', 'operations']) fs.mkdirSync(path.join(build, name), {recursive: true, mode: 0o700});
  for (const name of ['app.cjs', 'server.js']) put(path.join(build, name), '// isolated release fixture\n');
  put(path.join(build, 'package.json'), '{}\n');
  for (const name of ['config.cjs', 'initialize.mjs', 'upgrade.mjs']) fs.copyFileSync(path.join(root, 'portable', name), path.join(build, 'operations', name));
  const migrations = fs.readdirSync(path.join(root, 'drizzle')).filter(name => name.endsWith('.sql')).sort();
  eq([migrations.length, migrations[15]], [16, NEWEST], 'the repository ships 16 migrations');
  for (const name of migrations) fs.copyFileSync(path.join(root, 'drizzle', name), path.join(build, 'drizzle', name));
  put(path.join(build, 'drizzle/manifest.json'), JSON.stringify({format: 'yourrest-migrations-v1', files: migrations.map(name => ({name, sha256: hash(fs.readFileSync(path.join(build, 'drizzle', name)))}))}));
  const archive = path.join(work, 'update.zip');
  const packaged = JSON.parse(execFileSync('python3', [path.join(root, 'scripts/package-ui-refresh-update.py'), '--release', build, '--output', archive, '--release-name', 'update', '--release-date', '20261012', '--stage-name', 'yourrest-crm-update-20261012', '--helper-name', 'yourrest-activate-update.cjs', '--new-migration', NEWEST, '--verify-route', '/api/device-status=401'], {encoding: 'utf8'}));
  eq([packaged.schemaBefore, packaged.schemaAfter, packaged.newMigrations], [15, 16, [NEWEST]]);
  const extracted = path.join(work, 'extracted');
  execFileSync('python3', ['-c', 'import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', archive, extracted]);
  release = path.join(extracted, 'release'); manifest = read(path.join(extracted, 'RELEASE-SHA256SUMS.txt'));
  helper = require(path.join(extracted, 'yourrest-activate-update.cjs'));
  eq([helper.SCHEMA_BEFORE, helper.SCHEMA_AFTER, helper.NEW_MIGRATIONS, helper.EXTRA_ROUTES], [15, 16, [NEWEST], [['/api/device-status', 401]]]);

  function fixture(name, {schema = 15, extraRows = 0} = {}) {
    const home = path.join(work, name); fs.mkdirSync(home, {mode: 0o700}); const p = helper.pathsFor(home);
    for (const dir of [p.app, p.stage, p.data, path.join(p.data, 'objects'), p.current]) fs.mkdirSync(dir, {recursive: true, mode: 0o700});
    fs.cpSync(release, p.newRelease, {recursive: true}); put(p.manifest, manifest);
    put(path.join(p.current, 'old-version'), 'old release retained'); put(path.join(p.app, 'app.cjs'), '// preserved root launcher\n');
    const database = path.join(p.data, 'database.sqlite'), db = new DatabaseSync(database); fs.chmodSync(database, 0o600);
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE yr_schema_migrations(name TEXT PRIMARY KEY NOT NULL,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)');
    for (const file of migrations.slice(0, schema)) { const sql = read(path.join(build, 'drizzle', file)); db.exec(sql); db.prepare('INSERT INTO yr_schema_migrations VALUES(?,?,?)').run(file, hash(sql), '2026-10-11T00:00:00Z'); }
    db.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,region_scope,active,target,created_at) VALUES('owner','fixture-owner','fixture-owner@yourrest.org','Fixture','admin','Test','all',1,0,'2026-10-11')").run();
    db.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,region_scope,active,target,created_at) VALUES('rep','fixture-rep','fixture-rep@yourrest.org','Rep','rep','Test','eastern',1,0,'2026-10-11')").run();
    db.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','fixture-owner')").run();
    for (let i = 0; i <= extraRows; i++) db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at) VALUES(?,'customer',NULL,'rep','Test',?,'2026-10-11','2026-10-11')").run('customer-' + i, JSON.stringify({name: 'Isolated customer ' + i, code: 'ERP-' + i, region: 'الشرقية'}));
    if (schema >= 15) db.exec("INSERT OR IGNORE INTO crm_customer_numbers(customer_id,number) SELECT id,ROW_NUMBER() OVER (ORDER BY id) FROM crm_records WHERE kind='customer'");
    const attachment = Buffer.from('isolated attachment bytes'); put(path.join(p.data, 'objects', hash('visit/sample')), attachment);
    db.prepare("INSERT INTO crm_visit_files(id,object_key,customer_id,name,content_type,size,uploaded_by,created_at) VALUES('file','visit/sample','customer-0','sample.txt','text/plain',?,'owner','2026-10-11')").run(attachment.length);
    db.close();
    put(path.join(p.app, 'settings.cjs'), 'module.exports=' + JSON.stringify({YR_APP_ORIGIN: 'https://crm.yourrest.org', YR_DATABASE_PATH: database, YR_OBJECTS_PATH: path.join(p.data, 'objects'), YR_AUTH_SECRET: randomBytes(32).toString('hex'), YR_MAIL_TRANSPORT: 'sendmail', YR_MAIL_FROM: 'fixture@yourrest.org', YR_SENDMAIL_PATH: '/usr/sbin/sendmail'}) + ';\n');
    return p;
  }
  const quiet = () => {}, emptyProc = path.join(work, 'empty-proc'); fs.mkdirSync(emptyProc, {mode: 0o700});
  const stopped = paths => helper.ensureStopped(paths, emptyProc);
  const options = (iso, extra = {}) => ({log: quiet, stopped, now: () => new Date(iso), ...extra});
  const logs = []; const collect = message => logs.push(message);
  const probes = [];
  globalThis.fetch = async (url, settings) => { probes.push(url); eq(settings.redirect, 'manual'); return new Response('', {status: statuses[new URL(url).pathname] ?? 404}); };
  const healthy = {'/login': 200, '/api/crm': 401, '/api/device-status': 401};
  const tables = file => { const db = new DatabaseSync(file, {readOnly: true}); try { return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name); } finally { db.close(); } };
  const rows = (file, sql) => { const db = new DatabaseSync(file, {readOnly: true}); try { return db.prepare(sql).all(); } finally { db.close(); } };

  // ---- the complete route: check, stop, switch, first start, verify
  {
    const p = fixture('happy', {extraRows: 2}), database = path.join(p.data, 'database.sqlite');
    const before = helper.inventory(p.home); logs.length = 0;
    await helper.run(p, 'check', {log: collect, stopped: () => { throw Error('the application is running'); }});
    eq(logs.some(line => line.includes('SCHEMA CHANGE: ' + NEWEST)), true, 'check announces the schema change');
    eq(logs.some(line => line.startsWith('PACKAGE AND CONFIGURATION: READY')), true, 'check passes with the application running');
    helper.assertSameInventory(before, helper.inventory(p.home)); checks++;

    logs.length = 0;
    const state = await helper.run(p, 'apply', options('2026-10-12T05:00:00Z', {log: collect}));
    eq(state.phase, 'switched', 'the release is switched');
    eq(read(path.join(state.transaction, 'old-release', 'old-version')), 'old release retained', 'the previous release is kept');
    eq(rows(database, 'SELECT COUNT(*) n FROM yr_schema_migrations')[0].n, 15, 'the activator leaves the database at 15 migrations');
    eq(tables(database).includes('crm_member_devices'), false, 'and without the new table');
    eq(logs.some(line => line.includes('THE FIRST START APPLIES ' + NEWEST)), true, 'it tells the operator the first start migrates');
    eq(state.baseline.migrations, 15, 'the baseline records the 15-migration database');
    eq(rows(path.join(state.transaction, 'data', 'database.sqlite'), 'SELECT COUNT(*) n FROM yr_schema_migrations')[0].n, 15, 'the full backup holds the 15-migration database');

    await rejects(() => helper.run(p, 'verify', {log: quiet, stopped}), 'MIGRATION_NOT_APPLIED_START_APP_FIRST', 'verifying before the application started is refused with a clear reason');
    eq(probes.length, 0, 'no HTTP probe runs before the migration is applied');

    // The application's own startup routine (portable/app.cjs) applies the migration.
    const {upgradeExistingDatabase} = await import(pathToFileURL(path.join(p.current, 'operations/upgrade.mjs')).href);
    const upgrade = await upgradeExistingDatabase({filename: database, migrations: path.join(p.current, 'drizzle'), appRoot: p.app});
    eq([upgrade.upgraded, upgrade.migrations], [true, 16], 'the application applied 0015 at start');
    eq(path.basename(upgrade.backup).startsWith('before-0015_member_devices-'), true, 'after a private schema backup');
    eq(rows(upgrade.backup, 'SELECT COUNT(*) n FROM yr_schema_migrations')[0].n, 15, 'that backup holds the 15-migration database');
    eq(tables(database).includes('crm_member_devices'), true, 'the new table exists');
    eq(rows(database, 'SELECT COUNT(*) n FROM crm_records')[0].n, 3, 'every record survived');
    eq(rows(database, 'PRAGMA foreign_key_check').length, 0, 'foreign keys are intact');
    eq(rows(database, 'SELECT COUNT(*) n FROM crm_member_devices')[0].n, 0, 'the new table starts empty');

    statuses = {...healthy}; logs.length = 0;
    const verified = await helper.run(p, 'verify', {log: collect, stopped});
    eq(verified.migrations, 16, 'verification sees 16 migrations');
    eq(logs.includes('MIGRATIONS: 16 / DATABASE: OK / CUSTOMER CODES: OK'), true);
    eq(logs.includes('MIGRATION APPLIED: ' + NEWEST), true);
    eq(logs.includes('LOGIN HTTP: 200 / ANONYMOUS CRM API: 401 / /api/device-status: 401'), true, 'the new route is part of the verification');
    eq(logs.at(-1), 'DEPLOYMENT VERIFIED');
    eq(probes.map(url => new URL(url).pathname), ['/login', '/api/crm', '/api/device-status'], 'the new route is probed anonymously');
    // A second run after a completed switch must not repeat anything.
    logs.length = 0; await helper.run(p, 'apply', options('2026-10-12T06:00:00Z', {log: collect}));
    eq(logs.some(line => line.startsWith('ALREADY SWITCHED')), true, 'a repeated apply only reminds the operator');
  }

  // ---- the new route is really verified
  for (const [name, patch] of [['route-missing', {'/api/device-status': 404}], ['route-open', {'/api/device-status': 200}], ['crm-open', {'/api/crm': 200}]]) {
    const p = fixture(name), database = path.join(p.data, 'database.sqlite');
    await helper.run(p, 'apply', options('2026-10-12T05:00:00Z'));
    const {upgradeExistingDatabase} = await import(pathToFileURL(path.join(p.current, 'operations/upgrade.mjs')).href);
    await upgradeExistingDatabase({filename: database, migrations: path.join(p.current, 'drizzle'), appRoot: p.app});
    statuses = {...healthy, ...patch}; probes.length = 0;
    await rejects(() => helper.run(p, 'verify', {log: quiet, stopped}), 'HTTP_VERIFICATION_FAILED', 'verification fails when ' + name);
  }

  // ---- states in which nothing may change
  {
    const p = fixture('already-16', {schema: 16}), data = helper.inventory(p.data), app = helper.inventory(p.app, {allowSymlinks: true});
    await rejects(() => helper.run(p, 'apply', options('2026-10-12T05:00:00Z')), 'UNEXPECTED_MIGRATION_HISTORY', 'a database that already holds 16 migrations is not touched');
    helper.assertSameInventory(data, helper.inventory(p.data)); helper.assertSameInventory(app, helper.inventory(p.app, {allowSymlinks: true})); checks++;
    eq(read(path.join(p.current, 'old-version')), 'old release retained'); eq(fs.existsSync(p.lock), false, 'no lock left behind');
  }
  {
    const p = fixture('still-14', {schema: 14}), before = helper.inventory(p.data);
    await rejects(() => helper.run(p, 'apply', options('2026-10-12T05:00:00Z')), 'UNEXPECTED_MIGRATION_HISTORY', 'a database two migrations behind is refused');
    helper.assertSameInventory(before, helper.inventory(p.data)); checks++;
    eq(read(path.join(p.current, 'old-version')), 'old release retained');
  }
  {
    const p = fixture('tampered-migration'), file = path.join(p.newRelease, 'drizzle', NEWEST);
    put(file, read(file) + '\n-- altered after packaging\n');
    await rejects(() => helper.run(p, 'apply', options('2026-10-12T05:00:00Z')), 'RELEASE_CHECKSUM_MISMATCH', 'a migration edited after packaging is rejected by the pinned manifest');
    eq(read(path.join(p.current, 'old-version')), 'old release retained');
  }
  {
    const p = fixture('missing-migration'), before = helper.inventory(p.data);
    fs.rmSync(path.join(p.newRelease, 'drizzle', NEWEST));
    await rejects(() => helper.run(p, 'apply', options('2026-10-12T05:00:00Z')), 'RELEASE_INVENTORY_MISMATCH', 'a release that lost its migration is rejected');
    helper.assertSameInventory(before, helper.inventory(p.data)); checks++;
  }
  {
    // Verification only reads: running it again, or after the operator has used the system, changes nothing.
    const p = fixture('verify-twice'), database = path.join(p.data, 'database.sqlite');
    await helper.run(p, 'apply', options('2026-10-12T05:00:00Z'));
    const {upgradeExistingDatabase} = await import(pathToFileURL(path.join(p.current, 'operations/upgrade.mjs')).href);
    await upgradeExistingDatabase({filename: database, migrations: path.join(p.current, 'drizzle'), appRoot: p.app});
    statuses = {...healthy};
    const first = await helper.run(p, 'verify', {log: quiet, stopped});
    const db = new DatabaseSync(database); db.prepare("INSERT INTO crm_member_devices(member_id,platform,app_version,reported_at,data,version) VALUES('rep','browser',NULL,'2026-10-12T06:00:00.000Z','{}',1)").run(); db.close();
    const second = await helper.run(p, 'verify', {log: quiet, stopped});
    eq([first.migrations, second.migrations], [16, 16], 'verification can be repeated, also after the new table received rows');
    const again = await upgradeExistingDatabase({filename: database, migrations: path.join(p.current, 'drizzle'), appRoot: p.app});
    eq(again.upgraded, false, 'a later restart of the application finds nothing to migrate');
  }
  console.log(JSON.stringify({ok: true, checks, realSqlite: true, productionDataUsed: false, httpStub: true, scope: '15-to-16 package, check, switch, application startup migration with private backup, verification of the new route, and the states that must not change'}));
} finally {
  globalThis.fetch = oldFetch; fs.rmSync(work, {recursive: true, force: true}); process.umask(umask);
}
