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
try {
  const build = path.join(work, 'build');
  for (const name of ['node_modules', 'dist/server', 'dist/client', 'drizzle', 'operations']) fs.mkdirSync(path.join(build, name), {recursive: true, mode: 0o700});
  for (const name of ['app.cjs', 'server.js']) put(path.join(build, name), '// isolated release fixture\n');
  put(path.join(build, 'package.json'), '{}\n');
  for (const name of ['config.cjs', 'initialize.mjs']) fs.copyFileSync(path.join(root, 'portable', name), path.join(build, 'operations', name));
  const migrations = fs.readdirSync(path.join(root, 'drizzle')).filter(name => name.endsWith('.sql')).sort();
  eq(migrations.length, 15, 'the update path requires the 15-migration schema');
  for (const name of migrations) fs.copyFileSync(path.join(root, 'drizzle', name), path.join(build, 'drizzle', name));
  put(path.join(build, 'drizzle/manifest.json'), JSON.stringify({format: 'yourrest-migrations-v1', files: migrations.map(name => ({name, sha256: hash(fs.readFileSync(path.join(build, 'drizzle', name)))}))}));
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

  // Private files are never packaged.
  put(path.join(build, 'settings.cjs'), 'module.exports={};\n');
  refuse([], 'a settings file inside the release');
  console.log(JSON.stringify({ok: true, checks, productionDataUsed: false, scope: 'update packager parameters, pinned activator constants, unsafe input and private file guards'}));
} finally {
  fs.rmSync(work, {recursive: true, force: true});
}
