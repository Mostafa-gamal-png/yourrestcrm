// A release that adds no migration on top of an already migrated database (16 -> 16), packaged with --schema-baseline 16,
// exercised end to end on real SQLite with the real packager and the pinned activator: check, switch, verification of the
// new routes, refusal of a database at another schema, and the Saudi day's one full backup being reused by this activator
// after the 15 -> 16 activation took it. Isolated fixtures only: no hosting, no production data.
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
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-baseline-update-test-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const put = (file, bytes) => { fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700}); fs.writeFileSync(file, bytes, {mode: 0o600}); };
const read = file => fs.readFileSync(file, 'utf8');
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const rejects = async (fn, code, message) => { await assert.rejects(fn, {code}, message); checks++; };
const NEWEST = '0015_member_devices.sql', oldFetch = globalThis.fetch;
let statuses = {};
try {
  const migrations = fs.readdirSync(path.join(root, 'drizzle')).filter(name => name.endsWith('.sql')).sort();
  eq([migrations.length, migrations[15]], [16, NEWEST], 'the repository ships 16 migrations');

  /** A standalone build fixture, differing between packages only by its launcher text. */
  function build(name, marker) {
    const dir = path.join(work, name);
    for (const folder of ['node_modules', 'dist/server', 'dist/client', 'drizzle', 'operations']) fs.mkdirSync(path.join(dir, folder), {recursive: true, mode: 0o700});
    put(path.join(dir, 'app.cjs'), '// isolated release fixture ' + marker + '\n'); put(path.join(dir, 'server.js'), '// isolated release fixture\n'); put(path.join(dir, 'package.json'), '{}\n');
    for (const file of ['config.cjs', 'initialize.mjs', 'upgrade.mjs']) fs.copyFileSync(path.join(root, 'portable', file), path.join(dir, 'operations', file));
    for (const file of migrations) fs.copyFileSync(path.join(root, 'drizzle', file), path.join(dir, 'drizzle', file));
    put(path.join(dir, 'drizzle/manifest.json'), JSON.stringify({format: 'yourrest-migrations-v1', files: migrations.map(file => ({name: file, sha256: hash(fs.readFileSync(path.join(dir, 'drizzle', file)))}))}));
    return dir;
  }
  /** Package it like the real packager and load the pinned activator that came out. */
  function packageIt(name, release, args) {
    const archive = path.join(work, name + '.zip'), extracted = path.join(work, name + '-extracted');
    const report = JSON.parse(execFileSync('python3', [path.join(root, 'scripts/package-ui-refresh-update.py'), '--release', release, '--output', archive, '--helper-name', 'yourrest-activate-update.cjs', ...args], {encoding: 'utf8'}));
    execFileSync('python3', ['-c', 'import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', archive, extracted]);
    return {report, helper: require(path.join(extracted, 'yourrest-activate-update.cjs')), release: path.join(extracted, 'release'), manifest: read(path.join(extracted, 'RELEASE-SHA256SUMS.txt'))};
  }
  const earlier = packageIt('earlier', build('build-earlier', 'earlier'), ['--release-name', 'update', '--release-date', '20261012', '--stage-name', 'yourrest-crm-update-20261012', '--new-migration', NEWEST, '--verify-route', '/api/device-status=401']);
  const later = packageIt('later', build('build-later', 'later'), ['--release-name', 'update', '--release-date', '20261013', '--stage-name', 'yourrest-crm-update-20261013', '--schema-baseline', '16', '--verify-route', '/api/service-report=401', '--verify-route', '/api/service-queue/alerts=401']);
  const newest = packageIt('newest', build('build-newest', 'newest'), ['--release-name', 'update', '--release-date', '20261014', '--stage-name', 'yourrest-crm-update-20261014', '--schema-baseline', '16', '--verify-route', '/api/support=401']);
  // A second release on the same day needs a name and a stage folder of its own, since the first one's are already on the hosting.
  const located = packageIt('located', build('build-located', 'located'), ['--release-name', 'update-location', '--release-date', '20261014', '--stage-name', 'yourrest-crm-update-location-20261014', '--schema-baseline', '16']);
  eq([located.report.schemaBefore, located.report.schemaAfter, located.report.newMigrations, located.helper.RELEASE_NAME, located.helper.STAGE_DIR, located.helper.EXTRA_ROUTES], [16, 16, [], 'update-location', 'yourrest-crm-update-location-20261014', []], 'a second package of the same day carries its own name and stage folder and no new routes');
  const third = packageIt('third', build('build-third', 'third'), ['--release-name', 'update-complaints', '--release-date', '20261014', '--stage-name', 'yourrest-crm-update-complaints-20261014', '--schema-baseline', '16', '--verify-route', '/api/complaints=401']);
  eq([third.helper.RELEASE_NAME, third.helper.EXTRA_ROUTES], ['update-complaints', [['/api/complaints', 401]]], 'a third package of the same day, with the route it introduces');
  const fourth = packageIt('fourth', build('build-fourth', 'fourth'), ['--release-name', 'update-complaints-report', '--release-date', '20261014', '--stage-name', 'yourrest-crm-update-complaints-report-20261014', '--schema-baseline', '16', '--verify-route', '/api/complaints=401', '--verify-route', '/api/complaint-report=401']);
  eq([fourth.helper.RELEASE_NAME, fourth.helper.EXTRA_ROUTES], ['update-complaints-report', [['/api/complaints', 401], ['/api/complaint-report', 401]]], 'a fourth package of the same day, with both routes it must find');
  const fifth = packageIt('fifth', build('build-fifth', 'fifth'), ['--release-name', 'update-regions', '--release-date', '20261014', '--stage-name', 'yourrest-crm-update-regions-20261014', '--schema-baseline', '16', '--verify-route', '/api/complaint-report=401']);
  eq([fifth.helper.RELEASE_NAME, fifth.helper.EXTRA_ROUTES], ['update-regions', [['/api/complaint-report', 401]]], 'a fifth package of the same day');
  eq([earlier.report.schemaBefore, earlier.report.schemaAfter, earlier.report.newMigrations], [15, 16, [NEWEST]], 'the earlier package adds the migration');
  eq([newest.report.schemaBefore, newest.report.schemaAfter, newest.report.newMigrations, newest.helper.EXTRA_ROUTES], [16, 16, [], [['/api/support', 401]]], 'the package after that states the same baseline, adds nothing and checks its own route');
  eq([later.report.schemaBefore, later.report.schemaAfter, later.report.newMigrations], [16, 16, []], 'the later package states the baseline and adds nothing');
  const helper = later.helper;
  eq([helper.SCHEMA_BEFORE, helper.SCHEMA_AFTER, helper.NEW_MIGRATIONS, helper.EXTRA_ROUTES], [16, 16, [], [['/api/service-report', 401], ['/api/service-queue/alerts', 401]]], 'the pinned activator carries them');

  /** A hosting home whose live database holds `schema` migrations, with the stage of each given package unpacked in it. */
  function home(name, schema, ...stages) {
    const dir = path.join(work, name); fs.mkdirSync(dir, {mode: 0o700});
    const first = stages[0].helper.pathsFor(dir);
    for (const folder of [first.app, first.data, path.join(first.data, 'objects'), first.current]) fs.mkdirSync(folder, {recursive: true, mode: 0o700});
    put(path.join(first.current, 'old-version'), 'old release retained'); put(path.join(first.app, 'app.cjs'), '// preserved root launcher\n');
    for (const stage of stages) { const p = stage.helper.pathsFor(dir); fs.mkdirSync(p.stage, {recursive: true, mode: 0o700}); fs.cpSync(stage.release, p.newRelease, {recursive: true}); put(p.manifest, stage.manifest); }
    const database = path.join(first.data, 'database.sqlite'), db = new DatabaseSync(database); fs.chmodSync(database, 0o600);
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE yr_schema_migrations(name TEXT PRIMARY KEY NOT NULL,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)');
    for (const file of migrations.slice(0, schema)) { const sql = read(path.join(root, 'drizzle', file)); db.exec(sql); db.prepare('INSERT INTO yr_schema_migrations VALUES(?,?,?)').run(file, hash(sql), '2026-10-11T00:00:00Z'); }
    db.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,region_scope,active,target,created_at) VALUES('owner','fixture-owner','fixture-owner@yourrest.org','Fixture','admin','Test','all',1,0,'2026-10-11')").run();
    db.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,region_scope,active,target,created_at) VALUES('rep','fixture-rep','fixture-rep@yourrest.org','Rep','rep','Test','eastern',1,0,'2026-10-11')").run();
    db.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','fixture-owner')").run();
    for (let i = 0; i < 3; i++) db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at) VALUES(?,'customer',NULL,'rep','Test',?,'2026-10-11','2026-10-11')").run('customer-' + i, JSON.stringify({name: 'Isolated customer ' + i, code: 'ERP-' + i, region: 'الشرقية'}));
    if (schema >= 15) db.exec("INSERT OR IGNORE INTO crm_customer_numbers(customer_id,number) SELECT id,ROW_NUMBER() OVER (ORDER BY id) FROM crm_records WHERE kind='customer'");
    const attachment = Buffer.from('isolated attachment bytes'); put(path.join(first.data, 'objects', hash('visit/sample')), attachment);
    db.prepare("INSERT INTO crm_visit_files(id,object_key,customer_id,name,content_type,size,uploaded_by,created_at) VALUES('file','visit/sample','customer-0','sample.txt','text/plain',?,'owner','2026-10-11')").run(attachment.length);
    db.close();
    put(path.join(first.app, 'settings.cjs'), 'module.exports=' + JSON.stringify({YR_APP_ORIGIN: 'https://crm.yourrest.org', YR_DATABASE_PATH: database, YR_OBJECTS_PATH: path.join(first.data, 'objects'), YR_AUTH_SECRET: randomBytes(32).toString('hex'), YR_MAIL_TRANSPORT: 'sendmail', YR_MAIL_FROM: 'fixture@yourrest.org', YR_SENDMAIL_PATH: '/usr/sbin/sendmail'}) + ';\n');
    return dir;
  }
  const quiet = () => {}, emptyProc = path.join(work, 'empty-proc'); fs.mkdirSync(emptyProc, {mode: 0o700});
  const stopped = paths => helper.ensureStopped(paths, emptyProc);
  const options = (iso, extra = {}) => ({log: quiet, stopped, now: () => new Date(iso), ...extra});
  const probes = [];
  globalThis.fetch = async (url, settings) => { probes.push(url); eq(settings.redirect, 'manual'); return new Response('', {status: statuses[new URL(url).pathname] ?? 404}); };
  const healthy = {'/login': 200, '/api/crm': 401, '/api/device-status': 401, '/api/service-report': 401, '/api/service-queue/alerts': 401, '/api/support': 401, '/api/complaints': 401, '/api/complaint-report': 401};
  const rows = (file, sql) => { const db = new DatabaseSync(file, {readOnly: true}); try { return db.prepare(sql).all(); } finally { db.close(); } };
  const databaseOf = p => path.join(p.data, 'database.sqlite');

  // ---- the complete route on a database that is already at 16
  {
    const dir = home('flat', 16, later), p = helper.pathsFor(dir), database = databaseOf(p), logs = [], collect = message => logs.push(message);
    const before = helper.inventory(p.home), rowsBefore = rows(database, 'SELECT COUNT(*) n FROM crm_records')[0].n;
    await helper.run(p, 'check', {log: collect, stopped: () => { throw Error('the application is running'); }});
    eq([logs.some(line => line.includes('SCHEMA CHANGE')), logs.some(line => line.startsWith('PACKAGE AND CONFIGURATION: READY'))], [false, true], 'check passes with the application running and announces no schema change');
    helper.assertSameInventory(before, helper.inventory(p.home)); checks++;

    logs.length = 0;
    const state = await helper.run(p, 'apply', options('2026-10-13T05:00:00Z', {log: collect}));
    eq(state.phase, 'switched', 'the release is switched');
    eq(read(path.join(state.transaction, 'old-release', 'old-version')), 'old release retained', 'the previous release is kept');
    eq(state.baseline.migrations, 16, 'the baseline records the 16-migration database');
    eq([rows(database, 'SELECT COUNT(*) n FROM yr_schema_migrations')[0].n, rows(database, 'SELECT COUNT(*) n FROM crm_records')[0].n], [16, rowsBefore], 'the activator leaves the database exactly as it was');
    eq(rows(path.join(state.transaction, 'data', 'database.sqlite'), 'SELECT COUNT(*) n FROM yr_schema_migrations')[0].n, 16, 'the full backup holds the 16-migration database');
    eq(logs.some(line => line.includes('FIRST START APPLIES')), false, 'no migration is announced for the first start');
    eq(read(path.join(p.current, 'app.cjs')), '// isolated release fixture later\n', 'the new release is live');

    statuses = {...healthy}; logs.length = 0; probes.length = 0;
    const verified = await helper.run(p, 'verify', {log: collect, stopped});
    eq(verified.migrations, 16, 'verification sees 16 migrations');
    eq(logs.includes('MIGRATIONS: 16 / DATABASE: OK / CUSTOMER CODES: OK'), true, 'database and customer codes are verified');
    eq(logs.some(line => line.startsWith('MIGRATION APPLIED')), false, 'and nothing claims a migration was applied');
    eq(logs.at(-1), 'DEPLOYMENT VERIFIED');
    eq(probes.map(url => new URL(url).pathname), ['/login', '/api/crm', '/api/service-report', '/api/service-queue/alerts'], 'the new routes are probed anonymously');
    logs.length = 0; await helper.run(p, 'apply', options('2026-10-13T06:00:00Z', {log: collect}));
    eq(logs.some(line => line.startsWith('ALREADY SWITCHED')), true, 'a repeated apply only reminds the operator');
  }

  // ---- the new routes are really verified
  for (const [name, patch] of [['report-missing', {'/api/service-report': 404}], ['report-open', {'/api/service-report': 200}], ['alerts-missing', {'/api/service-queue/alerts': 404}], ['alerts-open', {'/api/service-queue/alerts': 200}], ['crm-open', {'/api/crm': 200}]]) {
    const dir = home(name, 16, later), p = helper.pathsFor(dir);
    await helper.run(p, 'apply', options('2026-10-13T05:00:00Z'));
    statuses = {...healthy, ...patch}; probes.length = 0;
    await rejects(() => helper.run(p, 'verify', {log: quiet, stopped}), 'HTTP_VERIFICATION_FAILED', 'verification fails when ' + name);
  }

  // ---- a database at another schema is never touched
  {
    const dir = home('still-15', 15, later), p = helper.pathsFor(dir), data = helper.inventory(p.data), app = helper.inventory(p.app, {allowSymlinks: true});
    await rejects(() => helper.run(p, 'apply', options('2026-10-13T05:00:00Z')), 'UNEXPECTED_MIGRATION_HISTORY', 'a database one migration behind the baseline is refused');
    helper.assertSameInventory(data, helper.inventory(p.data)); helper.assertSameInventory(app, helper.inventory(p.app, {allowSymlinks: true})); checks++;
    eq([read(path.join(p.current, 'old-version')), fs.existsSync(p.lock)], ['old release retained', false], 'nothing was switched and no lock is left');
  }
  {
    const dir = home('earlier-package-on-16', 16, earlier), p = earlier.helper.pathsFor(dir);
    await rejects(() => earlier.helper.run(p, 'apply', {log: quiet, stopped: paths => earlier.helper.ensureStopped(paths, emptyProc), now: () => new Date('2026-10-12T05:00:00Z')}), 'UNEXPECTED_MIGRATION_HISTORY', 'the earlier package still refuses a database that already holds its migration');
  }

  // ---- the same Saudi day: the full backup the 15 -> 16 activation took is reused, and sealed as before
  {
    const dir = home('same-day', 15, earlier, later), pe = earlier.helper.pathsFor(dir), pl = later.helper.pathsFor(dir), database = databaseOf(pl), logs = [], collect = message => logs.push(message);
    const first = await earlier.helper.run(pe, 'apply', {log: quiet, stopped: paths => earlier.helper.ensureStopped(paths, emptyProc), now: () => new Date('2026-10-12T05:00:00Z')});
    const {upgradeExistingDatabase} = await import(pathToFileURL(path.join(pe.current, 'operations/upgrade.mjs')).href);
    await upgradeExistingDatabase({filename: database, migrations: path.join(pe.current, 'drizzle'), appRoot: pe.app});
    eq(rows(database, 'SELECT COUNT(*) n FROM yr_schema_migrations')[0].n, 16, 'the application applied 0015 at its first start');
    const dailyIndex = JSON.parse(read(path.join(pe.dailyRoot, '2026-10-12.json')));
    eq([dailyIndex.backupSchema, dailyIndex.transaction], [15, first.transaction], 'the day\'s backup was taken at 15 migrations');
    statuses = {...healthy};
    await earlier.helper.run(pe, 'verify', {log: quiet, stopped: paths => earlier.helper.ensureStopped(paths, emptyProc)});

    const second = await helper.run(pl, 'apply', options('2026-10-12T09:00:00Z', {log: collect}));
    eq(logs.includes('2/4 TODAY\'S VERIFIED FULL BACKUP REUSED. NO NEW FULL COPY.'), true, 'the later activator reuses the backup taken earlier that day');
    eq([second.phase, second.baseline.migrations, second.dailyBackup.transaction], ['switched', 16, first.transaction], 'it switches on the 16-migration database, citing that backup');
    eq(rows(database, 'SELECT COUNT(*) n FROM yr_schema_migrations')[0].n, 16, 'the database is untouched');
    eq(read(path.join(pl.current, 'app.cjs')), '// isolated release fixture later\n', 'the later release is live');
    statuses = {...healthy};
    await helper.run(pl, 'verify', {log: quiet, stopped});
    eq(logs.length > 0, true); checks--;
  }

  // ---- the release after that, on the same Saudi day as the one before it: that day's full backup is reused again
  {
    const dir = home('same-day-next', 16, later, newest), pl = later.helper.pathsFor(dir), pn = newest.helper.pathsFor(dir), database = databaseOf(pn), logs = [], collect = message => logs.push(message);
    const first = await later.helper.run(pl, 'apply', {log: quiet, stopped: paths => later.helper.ensureStopped(paths, emptyProc), now: () => new Date('2026-10-14T05:00:00Z')});
    statuses = {...healthy};
    await later.helper.run(pl, 'verify', {log: quiet, stopped: paths => later.helper.ensureStopped(paths, emptyProc)});
    const second = await newest.helper.run(pn, 'apply', {log: collect, stopped: paths => newest.helper.ensureStopped(paths, emptyProc), now: () => new Date('2026-10-14T09:00:00Z')});
    eq(logs.includes('2/4 TODAY\'S VERIFIED FULL BACKUP REUSED. NO NEW FULL COPY.'), true, 'the next activator reuses the backup the 2026-10-13 activator took that day');
    eq([second.phase, second.baseline.migrations, second.dailyBackup.transaction], ['switched', 16, first.transaction], 'it switches on the 16-migration database, citing that backup');
    eq(rows(database, 'SELECT COUNT(*) n FROM yr_schema_migrations')[0].n, 16, 'the database is untouched');
    eq(read(path.join(pn.current, 'app.cjs')), '// isolated release fixture newest\n', 'the newest release is live');
    statuses = {...healthy};
    await newest.helper.run(pn, 'verify', {log: quiet, stopped: paths => newest.helper.ensureStopped(paths, emptyProc)});
    eq(logs.length > 0, true); checks--;
  }

  // ---- a second release on the same Saudi day, under its own name: it reuses the backup the first release of that day took
  {
    const dir = home('same-day-second', 16, newest, located), pn = newest.helper.pathsFor(dir), pw = located.helper.pathsFor(dir), database = databaseOf(pw), logs = [], collect = message => logs.push(message);
    const first = await newest.helper.run(pn, 'apply', {log: quiet, stopped: paths => newest.helper.ensureStopped(paths, emptyProc), now: () => new Date('2026-10-14T05:00:00Z')});
    statuses = {...healthy};
    await newest.helper.run(pn, 'verify', {log: quiet, stopped: paths => newest.helper.ensureStopped(paths, emptyProc)});
    const second = await located.helper.run(pw, 'apply', {log: collect, stopped: paths => located.helper.ensureStopped(paths, emptyProc), now: () => new Date('2026-10-14T09:00:00Z')});
    eq(logs.includes('2/4 TODAY\'S VERIFIED FULL BACKUP REUSED. NO NEW FULL COPY.'), true, 'the second release of the day reuses the backup the first one took');
    eq([second.phase, second.baseline.migrations, second.dailyBackup.transaction], ['switched', 16, first.transaction], 'it switches on the 16-migration database, citing that backup');
    eq(rows(database, 'SELECT COUNT(*) n FROM yr_schema_migrations')[0].n, 16, 'the database is untouched');
    eq(read(path.join(pw.current, 'app.cjs')), '// isolated release fixture located\n', 'the second release is live');
    statuses = {...healthy};
    await located.helper.run(pw, 'verify', {log: quiet, stopped: paths => located.helper.ensureStopped(paths, emptyProc)});
  }

  // ---- a third release on the same Saudi day reuses the backup whichever earlier activator of that day took it
  for (const [label, earlierOne] of [['the first', newest], ['the second', located]]) {
    const dir = home('same-day-third-after-' + earlierOne.helper.RELEASE_NAME, 16, earlierOne, third), pe = earlierOne.helper.pathsFor(dir), pt = third.helper.pathsFor(dir), logs = [], collect = message => logs.push(message);
    const first = await earlierOne.helper.run(pe, 'apply', {log: quiet, stopped: paths => earlierOne.helper.ensureStopped(paths, emptyProc), now: () => new Date('2026-10-14T05:00:00Z')});
    statuses = {...healthy};
    await earlierOne.helper.run(pe, 'verify', {log: quiet, stopped: paths => earlierOne.helper.ensureStopped(paths, emptyProc)});
    const next = await third.helper.run(pt, 'apply', {log: collect, stopped: paths => third.helper.ensureStopped(paths, emptyProc), now: () => new Date('2026-10-14T11:00:00Z')});
    eq(logs.includes('2/4 TODAY\'S VERIFIED FULL BACKUP REUSED. NO NEW FULL COPY.'), true, 'the third release reuses the backup ' + label + ' release of the day took');
    eq([next.phase, next.dailyBackup.transaction], ['switched', first.transaction], 'and switches citing it');
    eq(read(path.join(pt.current, 'app.cjs')), '// isolated release fixture third\n', 'the third release is live');
  }

  // ---- a fourth release on the same Saudi day reuses the backup whichever earlier activator of that day took it, the third's included
  for (const [label, earlierOne] of [['the first', newest], ['the second', located], ['the third', third]]) {
    const dir = home('same-day-fourth-after-' + earlierOne.helper.RELEASE_NAME, 16, earlierOne, fourth), pe = earlierOne.helper.pathsFor(dir), pf = fourth.helper.pathsFor(dir), logs = [], collect = message => logs.push(message);
    const first = await earlierOne.helper.run(pe, 'apply', {log: quiet, stopped: paths => earlierOne.helper.ensureStopped(paths, emptyProc), now: () => new Date('2026-10-14T05:00:00Z')});
    statuses = {...healthy};
    await earlierOne.helper.run(pe, 'verify', {log: quiet, stopped: paths => earlierOne.helper.ensureStopped(paths, emptyProc)});
    const next = await fourth.helper.run(pf, 'apply', {log: collect, stopped: paths => fourth.helper.ensureStopped(paths, emptyProc), now: () => new Date('2026-10-14T13:00:00Z')});
    eq(logs.includes('2/4 TODAY\'S VERIFIED FULL BACKUP REUSED. NO NEW FULL COPY.'), true, 'the fourth release reuses the backup ' + label + ' release of the day took');
    eq([next.phase, next.dailyBackup.transaction], ['switched', first.transaction], 'and switches citing it');
    eq(read(path.join(pf.current, 'app.cjs')), '// isolated release fixture fourth\n', 'the fourth release is live');
  }

  // ---- a fifth release on the same Saudi day reuses the backup whichever of the four earlier activators took it
  for (const [label, earlierOne] of [['the first', newest], ['the second', located], ['the third', third], ['the fourth', fourth]]) {
    const dir = home('same-day-fifth-after-' + earlierOne.helper.RELEASE_NAME, 16, earlierOne, fifth), pe = earlierOne.helper.pathsFor(dir), pv = fifth.helper.pathsFor(dir), logs = [], collect = message => logs.push(message);
    const first = await earlierOne.helper.run(pe, 'apply', {log: quiet, stopped: paths => earlierOne.helper.ensureStopped(paths, emptyProc), now: () => new Date('2026-10-14T05:00:00Z')});
    statuses = {...healthy};
    await earlierOne.helper.run(pe, 'verify', {log: quiet, stopped: paths => earlierOne.helper.ensureStopped(paths, emptyProc)});
    const next = await fifth.helper.run(pv, 'apply', {log: collect, stopped: paths => fifth.helper.ensureStopped(paths, emptyProc), now: () => new Date('2026-10-14T14:00:00Z')});
    eq(logs.includes('2/4 TODAY\'S VERIFIED FULL BACKUP REUSED. NO NEW FULL COPY.'), true, 'the fifth release reuses the backup ' + label + ' release of the day took');
    eq([next.phase, next.dailyBackup.transaction], ['switched', first.transaction], 'and switches citing it');
    eq(read(path.join(pv.current, 'app.cjs')), '// isolated release fixture fifth\n', 'the fifth release is live');
  }

  // ---- the releases of 2026-10-17 to 2026-10-27: a release reuses the day's backup whichever earlier release of the day took it (an update refused for this on the hosting account, so every earlier name is listed here)
  {
    const named = (key, name, date, extra = []) => packageIt(key, build('build-' + key, key), ['--release-name', name, '--release-date', date, '--stage-name', 'yourrest-crm-' + name + '-' + date, '--schema-baseline', '16', ...extra]);
    const kpi = named('kpi', 'update-service-kpi', '20261017'), voice = named('voice', 'update-visit-place-voice', '20261017'), message = named('message', 'update-customer-message', '20261018'), chain = named('chain', 'update-support-chain', '20261018', ['--verify-route', '/api/support=401']), chainB = named('chainb', 'update-support-chain-b', '20261018', ['--verify-route', '/api/support=401']), machines = named('machines', 'update-machines', '20261020'), mobile = named('mobile', 'update-mobile-comfort', '20261020'), notice = named('notice', 'update-reload-notice', '20261021'), autostop = named('autostop', 'update-auto-stop', '20261027');
    for (const [label, first, second, d1, d2] of [
      ['the KPI release', kpi, voice, new Date('2026-10-17T05:00:00Z'), new Date('2026-10-17T10:00:00Z')],
      ['the customer-message release', message, chain, new Date('2026-10-18T05:00:00Z'), new Date('2026-10-18T10:00:00Z')],
      ['the support-chain release (B)', chainB, machines, new Date('2026-10-20T05:00:00Z'), new Date('2026-10-20T10:00:00Z')],
      ['the machines release', machines, mobile, new Date('2026-10-20T05:00:00Z'), new Date('2026-10-20T10:00:00Z')],
      ['the phone and tablet comfort release', mobile, notice, new Date('2026-10-21T05:00:00Z'), new Date('2026-10-21T10:00:00Z')],
      ['the update-notice release', notice, autostop, new Date('2026-10-27T05:00:00Z'), new Date('2026-10-27T10:00:00Z')]
    ]) {
      const dir = home('same-day-' + second.helper.RELEASE_NAME + '-after-' + first.helper.RELEASE_NAME, 16, first, second), pe = first.helper.pathsFor(dir), pn = second.helper.pathsFor(dir), logs = [], collect = text => logs.push(text);
      const took = await first.helper.run(pe, 'apply', {log: quiet, stopped: paths => first.helper.ensureStopped(paths, emptyProc), now: () => d1});
      statuses = {...healthy};
      await first.helper.run(pe, 'verify', {log: quiet, stopped: paths => first.helper.ensureStopped(paths, emptyProc)});
      const next = await second.helper.run(pn, 'apply', {log: collect, stopped: paths => second.helper.ensureStopped(paths, emptyProc), now: () => d2});
      eq(logs.includes('2/4 TODAY\'S VERIFIED FULL BACKUP REUSED. NO NEW FULL COPY.'), true, second.helper.RELEASE_NAME + ' reuses the backup ' + label + ' of the day took');
      eq([next.phase, next.dailyBackup.transaction], ['switched', took.transaction], 'and switches citing it');
    }
  }

  // ---- a stale or foreign daily backup is still refused
  for (const [name, schema] of [['backup-13', 13], ['backup-17', 17], ['backup-text', 'fifteen']]) {
    const dir = home(name, 16, later), p = helper.pathsFor(dir);
    fs.mkdirSync(p.dailyRoot, {mode: 0o700});
    put(path.join(p.dailyRoot, '2026-10-13.json'), JSON.stringify({format: 'yourrest-daily-backup-v1', day: '2026-10-13', home: p.home, backupSchema: schema, transaction: path.join(p.home, 'yourrest-activation-fixture'), createdAt: '2026-10-13T02:00:00.000Z', verifiedAt: '2026-10-13T02:01:00.000Z'}));
    await rejects(() => helper.run(p, 'apply', options('2026-10-13T05:00:00Z')), 'INVALID_DAILY_BACKUP_INDEX', 'a daily backup recorded at schema ' + JSON.stringify(schema) + ' is refused');
    eq(read(path.join(p.current, 'old-version')), 'old release retained', 'nothing was switched');
  }
  console.log(JSON.stringify({ok: true, checks, realSqlite: true, productionDataUsed: false, httpStub: true, scope: '16-to-16 package with --schema-baseline 16: check, switch, verification of the new routes, states that must not change, and reuse of the day\'s backup taken by the 15-to-16 activation'}));
} finally {
  globalThis.fetch = oldFetch; fs.rmSync(work, {recursive: true, force: true}); process.umask(umask);
}
