// The update packager injects the release name, date, upload folder and helper name into the pinned activator.
// Checks the wiring with non-default values, the unsafe-input guards and that the activator derives every path from them.
// Synthetic release fixture only: no production data, no hosting access.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync, spawnSync} from 'node:child_process';

const root = process.cwd(), require = createRequire(import.meta.url);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-package-params-'));
const hash = value => createHash('sha256').update(value).digest('hex');
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const put = (file, text) => { fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700}); fs.writeFileSync(file, text, {mode: 0o600}); };
const allMigrations = fs.readdirSync(path.join(root, 'drizzle')).filter(name => name.endsWith('.sql')).sort();
/** A release fixture holding the first `count` repository migrations. */
function fixture(name, count) {
  const build = path.join(work, name);
  for (const folder of ['node_modules', 'dist/server', 'dist/client', 'drizzle', 'operations']) fs.mkdirSync(path.join(build, folder), {recursive: true, mode: 0o700});
  for (const file of ['app.cjs', 'server.js']) put(path.join(build, file), '// isolated release fixture\n');
  put(path.join(build, 'package.json'), '{}\n');
  for (const file of ['config.cjs', 'initialize.mjs']) fs.copyFileSync(path.join(root, 'portable', file), path.join(build, 'operations', file));
  const migrations = allMigrations.slice(0, count);
  for (const file of migrations) fs.copyFileSync(path.join(root, 'drizzle', file), path.join(build, 'drizzle', file));
  put(path.join(build, 'drizzle/manifest.json'), JSON.stringify({format: 'yourrest-migrations-v1', files: migrations.map(file => ({name: file, sha256: hash(fs.readFileSync(path.join(build, 'drizzle', file)))}))}));
  return build;
}
try {
  eq(allMigrations.length, 16, 'the repository carries the 15-migration baseline plus 0015');
  eq(allMigrations[15], '0015_member_devices.sql', 'the newest migration is the device status table');
  const build = fixture('build', 15);
  const script = path.join(root, 'scripts/package-ui-refresh-update.py');
  const stage = 'yourrest-crm-update-20261011', helperName = 'yourrest-activate-update.cjs';
  const guide = path.join(work, 'guide.txt');
  put(guide, 'تحديث تجريبي\n/home/youriedx/' + stage + '\nnode ' + helperName + ' --check\n');
  const archive = path.join(work, 'update.zip');
  const packaged = JSON.parse(execFileSync('python3', [script, '--release', build, '--output', archive, '--release-name', 'update', '--release-date', '20261011', '--stage-name', stage, '--helper-name', helperName, '--guide', guide], {encoding: 'utf8'}));
  eq([packaged.releaseName, packaged.releaseDate, packaged.stageDir, packaged.helper, packaged.guide], ['update', '20261011', stage, helperName, 'UPDATE-20261011-AR.txt']);
  eq([packaged.schemaBefore, packaged.schemaAfter, packaged.settingsOrProductionDataIncluded], [15, 15, false]);
  const extracted = path.join(work, 'extracted');
  execFileSync('python3', ['-c', 'import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', archive, extracted]);
  eq(fs.existsSync(path.join(extracted, 'yourrest-activate-ui-refresh.cjs')), false, 'the default helper name is not emitted for a renamed release');
  eq(fs.readFileSync(path.join(extracted, 'UPDATE-20261011-AR.txt'), 'utf8').includes(stage), true, 'the supplied guide is embedded');
  const source = fs.readFileSync(path.join(extracted, helperName), 'utf8');
  for (const token of ['__UI_REFRESH_', '__CUSTOMER_EDIT_']) eq(source.includes(token), false, 'no template token left: ' + token);
  const helper = require(path.join(extracted, helperName));
  const manifest = fs.readFileSync(path.join(extracted, 'RELEASE-SHA256SUMS.txt'));
  eq([helper.PIN, helper.RELEASE_FILES], [hash(manifest), packaged.files], 'pin and file count match the packaged manifest');
  eq([helper.RELEASE_NAME, helper.RELEASE_DATE, helper.STAGE_DIR, helper.ACTIVATION_FORMAT], ['update', '20261011', stage, 'yourrest-update-activation-20261011']);
  const paths = helper.pathsFor('/home/youriedx');
  eq([paths.stage, paths.state, paths.lock], ['/home/youriedx/' + stage, '/home/youriedx/' + stage + '/update-activation-state.json', '/home/youriedx/' + stage + '/update-activation.lock'], 'every path derives from the injected stage and name');
  eq(paths.current, '/home/youriedx/yourrest-crm/release', 'the live release location is unchanged');

  // Unsafe or inconsistent input is refused before anything is written.
  const refuse = (extra, message) => {
    const output = path.join(work, 'refused.zip');
    const result = spawnSync('python3', [script, '--release', build, '--output', output, ...extra], {encoding: 'utf8'});
    eq([result.status !== 0, fs.existsSync(output)], [true, false], message);
  };
  refuse(['--release-name', '../evil'], 'path-like release name');
  refuse(['--release-name', 'Update'], 'upper-case release name');
  refuse(['--release-date', '2026-10-11'], 'malformed release date');
  refuse(['--stage-name', 'yourrest/../x'], 'path-like stage folder');
  refuse(['--helper-name', 'sub/helper.cjs'], 'helper name with a directory');
  refuse(['--helper-name', 'helper.js'], 'helper must be a .cjs file');
  put(path.join(work, 'wrong-guide.txt'), 'does not mention the folder or the helper\n');
  refuse(['--stage-name', stage, '--helper-name', helperName, '--guide', path.join(work, 'wrong-guide.txt')], 'a guide that does not match the folder and helper');

  // A release that adds migrations must declare exactly them, and the activator carries the declaration.
  const grown = fixture('grown', 16), newest = '0015_member_devices.sql';
  const growth = JSON.parse(execFileSync('python3', [script, '--release', grown, '--output', path.join(work, 'grown.zip'), '--release-name', 'update', '--release-date', '20261012', '--stage-name', 'yourrest-crm-update-20261012', '--helper-name', helperName, '--new-migration', newest, '--verify-route', '/api/device-status=401'], {encoding: 'utf8'}));
  eq([growth.schemaBefore, growth.schemaAfter, growth.newMigrations, growth.verifyRoutes], [15, 16, [newest], [['/api/device-status', 401]]], 'the packaging report states the schema change');
  const grownDir = path.join(work, 'grown-extracted');
  execFileSync('python3', ['-c', 'import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', path.join(work, 'grown.zip'), grownDir]);
  const grownHelper = require(path.join(grownDir, helperName));
  eq([grownHelper.SCHEMA_BEFORE, grownHelper.SCHEMA_AFTER, grownHelper.NEW_MIGRATIONS, grownHelper.EXTRA_ROUTES], [15, 16, [newest], [['/api/device-status', 401]]], 'the pinned activator carries the schema change and the extra probe');
  eq(fs.readFileSync(path.join(grownDir, helperName), 'utf8').includes('__UI_REFRESH_'), false, 'no template token left in the grown activator');
  eq([helper.SCHEMA_BEFORE, helper.SCHEMA_AFTER, helper.NEW_MIGRATIONS, helper.EXTRA_ROUTES], [15, 15, [], []], 'a package without a schema change keeps the baseline');
  const refuseFor = (releasePath, extra, message) => {
    const output = path.join(work, 'refused-migrations.zip');
    const result = spawnSync('python3', [script, '--release', releasePath, '--output', output, ...extra], {encoding: 'utf8'});
    eq([result.status !== 0, fs.existsSync(output)], [true, false], message);
  };
  refuseFor(grown, [], 'a build with an undeclared migration');
  refuseFor(build, ['--new-migration', newest], 'a declared migration the build does not contain');
  refuseFor(grown, ['--new-migration', '0014_customer_identities.sql'], 'declaring a baseline migration as new');
  refuseFor(grown, ['--new-migration', newest, '--new-migration', newest], 'declaring the same migration twice');
  refuseFor(grown, ['--new-migration', '../0015_member_devices.sql'], 'a path-like migration name');
  refuseFor(grown, ['--new-migration', '0015_Member.sql'], 'a malformed migration name');
  for (const route of ['api/device-status=401', '/api/device-status', '/api/device-status=abc', '/api/device-status=99', '/api/x?y=1=401', '/api/../x=401', '/=200=200'])
    refuseFor(grown, ['--new-migration', newest, '--verify-route', route], 'an unsafe verification route: ' + route);
  // A release that changes no schema on top of an already migrated database states its baseline instead.
  const flat = JSON.parse(execFileSync('python3', [script, '--release', grown, '--output', path.join(work, 'flat.zip'), '--release-name', 'update', '--release-date', '20261013', '--stage-name', 'yourrest-crm-update-20261013', '--helper-name', helperName, '--schema-baseline', '16', '--verify-route', '/api/service-report=401', '--verify-route', '/api/service-queue/alerts=401'], {encoding: 'utf8'}));
  eq([flat.schemaBefore, flat.schemaAfter, flat.newMigrations, flat.verifyRoutes], [16, 16, [], [['/api/service-report', 401], ['/api/service-queue/alerts', 401]]], 'the report states a 16-migration baseline with nothing new');
  const flatDir = path.join(work, 'flat-extracted');
  execFileSync('python3', ['-c', 'import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', path.join(work, 'flat.zip'), flatDir]);
  const flatHelper = require(path.join(flatDir, helperName));
  eq([flatHelper.SCHEMA_BEFORE, flatHelper.SCHEMA_AFTER, flatHelper.NEW_MIGRATIONS, flatHelper.EXTRA_ROUTES], [16, 16, [], [['/api/service-report', 401], ['/api/service-queue/alerts', 401]]], 'the pinned activator carries the baseline and the extra probes');
  eq(fs.readFileSync(path.join(flatDir, helperName), 'utf8').includes('__UI_REFRESH_'), false, 'no template token left in the 16-baseline activator');
  eq(fs.readFileSync(path.join(flatDir, 'UPDATE-UI-REFRESH-AR.txt'), 'utf8').includes('(16 ترحيلًا)'), true, 'the default guide names the baseline');
  refuseFor(build, ['--schema-baseline', '16'], 'a build with fewer migrations than the stated baseline');
  refuseFor(grown, ['--schema-baseline', '15'], 'a build with an undeclared migration beyond the baseline');
  refuseFor(grown, ['--schema-baseline', '17'], 'a baseline above what the build carries');
  refuseFor(grown, ['--schema-baseline', '16', '--new-migration', newest], 'a declared migration that is part of the baseline');
  for (const baseline of ['14', '0', '-1', '100', '15.5', 'abc', '']) refuseFor(grown, ['--schema-baseline', baseline], 'an unusable baseline: ' + JSON.stringify(baseline));
  fs.rmSync(path.join(grown, 'drizzle', newest));
  refuseFor(grown, ['--new-migration', newest], 'a manifest entry whose file is missing from the build');

  // Private files are never packaged.
  put(path.join(build, 'settings.cjs'), 'module.exports={};\n');
  refuse([], 'a settings file inside the release');
  console.log(JSON.stringify({ok: true, checks, productionDataUsed: false, scope: 'update packager parameters, pinned activator constants, unsafe input and private file guards'}));
} finally {
  fs.rmSync(work, {recursive: true, force: true});
}
