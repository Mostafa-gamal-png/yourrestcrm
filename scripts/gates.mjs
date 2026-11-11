// One command for a release's gates (npm run gates; tests/CHECKS.md «بوابة الإصدار السريعة»): a clean build, then the default gate and
// the selected release-build and browser tests through a worker pool, each test in its own process group with its own log, then the
// tests that must run alone, then every failure rerun once alone. Selection (tests/test-areas.json, scripts/lib/test-areas.mjs): the
// whole default gate always; release-build and browser tests of the areas a change touches, everything when a shared file changed.
//   node scripts/gates.mjs [--full | --since <git-ref> [--to <git-ref>]] [--plan] [--no-build] [--jobs N] [--browser-jobs N]
//                          [--check-jobs N] [--default-gate alongside|first] [--browser-executable <path>]
// The default gate (scripts/check.mjs, itself parallel with --check-jobs) runs as one slot of the pool beside the other tests, or
// alone before them with --default-gate first.
// Nothing is deployed or packaged; no live site is called. Proxy variables are removed for every process (the tests talk to
// 127.0.0.1); YR_BROWSER_EXECUTABLE (flag or caller's environment) and per-test screenshot folders reach browser tests only.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn, execFileSync} from 'node:child_process';
import {loadAreas, selectTests, validateAreas, gatedTests, globToRegExp} from './lib/test-areas.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const usage = 'Usage: node scripts/gates.mjs [--full | --since <git-ref> [--to <git-ref>]] [--plan] [--no-build] [--jobs N] [--browser-jobs N] [--check-jobs N] [--default-gate alongside|first] [--browser-executable <path>]';
const options = {full: false, plan: false, build: true, jobs: 6, browserJobs: 5, checkJobs: 4, defaultGate: 'alongside', since: null, to: null, browserExecutable: process.env.YR_BROWSER_EXECUTABLE || ''};
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i], value = () => { const next = process.argv[++i]; if (!next || next.startsWith('--')) throw Error(arg + ' needs a value. ' + usage); return next; };
  if (arg === '--full') options.full = true;
  else if (arg === '--plan') options.plan = true;
  else if (arg === '--no-build') options.build = false;
  else if (arg === '--since') options.since = value();
  else if (arg === '--to') options.to = value();
  else if (arg === '--jobs') options.jobs = Number(value());
  else if (arg === '--browser-jobs') options.browserJobs = Number(value());
  else if (arg === '--check-jobs') options.checkJobs = Number(value());
  else if (arg === '--default-gate') options.defaultGate = value();
  else if (arg === '--browser-executable') options.browserExecutable = path.resolve(value());
  else throw Error('Unknown option ' + arg + '. ' + usage);
}
if (!['alongside', 'first'].includes(options.defaultGate)) throw Error('--default-gate is alongside or first');
for (const name of ['jobs', 'browserJobs', 'checkJobs']) if (!Number.isInteger(options[name]) || options[name] < 1 || options[name] > 16) throw Error('--' + name.replace('J', '-j') + ' must be 1..16');
if (options.full && (options.since || options.to)) throw Error('--full runs everything; leave out --since/--to.');
if (options.to && !options.since) throw Error('--to needs --since.');

const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 64 << 20});
const commit = ref => { try { return git('rev-parse', '--verify', '--quiet', ref + '^{commit}').trim(); } catch { return null; } };

// The commit the package named by deploy/request.json was built from: its "package:" commit says "built from <sha>"; without that line,
// the commit before the one that added the package (a package commit adds only the archive).
function packagedCommit() {
  let request;
  try { request = JSON.parse(fs.readFileSync(path.join(root, 'deploy/request.json'), 'utf8')); } catch { return {error: 'deploy/request.json is missing or unreadable'}; }
  if (typeof request.package !== 'string') return {error: 'deploy/request.json names no package'};
  const added = git('log', '--diff-filter=A', '--format=%H%x00%B%x01', '--', request.package).split('\x01').map(entry => entry.trim()).filter(Boolean).at(-1);
  if (!added) return {error: request.package + ' was never committed'};
  const [sha, body] = added.split('\x00');
  const built = body.match(/built from ([0-9a-f]{7,40})/)?.[1], builtSha = built && commit(built);
  if (builtSha) return {sha: builtSha, why: `deploy/request.json names ${request.package}; its package commit ${sha.slice(0, 7)} says "built from ${built}"`};
  const parent = commit(sha + '^');
  return parent ? {sha: parent, why: `deploy/request.json names ${request.package}; it was added by ${sha.slice(0, 7)}, so the source before it`} : {error: 'no parent of ' + sha};
}

// What changed: the diff since..to (or since..the working tree, untracked files included), minus what only looks changed.
function changes(since, to) {
  const names = git('diff', '--name-only', '--no-renames', since, ...(to ? [to] : []), '--').split('\n').filter(Boolean);
  if (!to) names.push(...git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean));
  const ignored = [], kept = [];
  for (const file of [...new Set(names)].sort()) {
    if (file === map.generated.serviceWorker) {
      const lines = git('diff', '-U0', since, ...(to ? [to] : []), '--', file).split('\n').filter(line => /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line));
      if (lines.length && lines.every(line => /^[+-]const BUILD_REVISION = '[0-9a-f]+';$/.test(line))) { ignored.push({file, why: 'only its BUILD_REVISION changed (written by the build)'}); continue; }
    }
    if (/^lib\/locales\/[^/]+\.json$/.test(file)) {
      const read = ref => { try { return JSON.parse(ref ? git('show', ref + ':' + file) : fs.readFileSync(path.join(root, file), 'utf8')); } catch { return null; } };
      const before = read(since), after = read(to);
      if (before && after && Object.entries(before).every(([key, value]) => Object.hasOwn(after, key) && after[key] === value)) { ignored.push({file, why: 'only adds keys (' + (Object.keys(after).length - Object.keys(before).length) + ')'}); continue; }
    }
    kept.push(file);
  }
  return {files: kept, ignored};
}

const areaData = loadAreas(root), {map, manifest} = areaData;
const tracked = git('ls-files').split('\n').filter(Boolean);
const mapProblems = validateAreas(areaData, [...tracked, ...git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)]);
if (mapProblems.length) throw Error('tests/test-areas.json is not valid:\n  ' + mapProblems.join('\n  '));

let selection, rule;
if (options.full) {
  selection = selectTests([], areaData); selection.full = true; selection.tests = gatedTests(manifest).map(test => test.file); selection.reasons = ['--full'];
  rule = {mode: 'full', why: '--full'};
} else {
  let since = options.since && commit(options.since), why = options.since ? '--since ' + options.since : '';
  if (options.since && !since) throw Error('Not a commit: ' + options.since);
  if (options.to && !commit(options.to)) throw Error('Not a commit: ' + options.to);
  if (!since) {
    const found = packagedCommit();
    if (found.error) throw Error('Cannot tell what the last package was built from (' + found.error + '). Pass --since <git-ref> or --full.');
    since = found.sha; why = found.why;
  }
  const changed = changes(since, options.to && commit(options.to));
  selection = selectTests(changed.files, areaData);
  rule = {mode: selection.full ? 'full' : 'selective', since, to: options.to ? commit(options.to) : 'working tree', why, changedFiles: changed.files.length, ignored: changed.ignored};
}

// Tests that need a file of the owner's that is never in the repository.
const workbook = process.env.ERP_TEST_WORKBOOK || path.resolve(root, '../../upload/Reports_Invoices_14480422_094904.xlsx'); // as tests/erp-sales-browser.mjs reads it
const ownerFiles = {
  'tests/erp-sales-browser.mjs': fs.existsSync(workbook) ? null : 'ERP_TEST_WORKBOOK',
  'erp-workbook': process.env.ERP_TEST_WORKBOOK && fs.existsSync(process.env.ERP_TEST_WORKBOOK) ? null : 'ERP_TEST_WORKBOOK',
  'erp-customers-workbook': process.env.ERP_CUSTOMERS_WORKBOOK && fs.existsSync(process.env.ERP_CUSTOMERS_WORKBOOK) ? null : 'ERP_CUSTOMERS_WORKBOOK',
  'erp-quotes-workbook': process.env.ERP_QUOTES_WORKBOOK && fs.existsSync(process.env.ERP_QUOTES_WORKBOOK) ? null : 'ERP_QUOTES_WORKBOOK'
};
const gateOf = new Map(gatedTests(manifest).map(test => [test.file, test.gate]));
const serial = new Set(Object.keys(map.serial?.tests || {}));
const jobs = [{name: 'default-gate', gate: 'default', args: ['scripts/check.mjs', '--jobs', String(options.checkJobs)], timeout: 3600}];
for (const gate of ['erp-workbook', 'erp-customers-workbook', 'erp-quotes-workbook']) jobs.push({name: gate, gate, args: ['scripts/check.mjs', '--gate', gate], timeout: 1800, skip: ownerFiles[gate] && `needs the owner's ERP file (${ownerFiles[gate]})`});
for (const file of selection.tests) {
  const gate = gateOf.get(file);
  jobs.push({name: path.basename(file, '.mjs'), file, gate, args: [file], timeout: gate === 'browser' ? 1200 : 900, serial: serial.has(file), skip: ownerFiles[file] && `needs the owner's ERP file (${ownerFiles[file]})`});
}

// Longest first: the latest summary's seconds, else the map's typical seconds.
const typical = {...map.typicalSeconds};
try {
  const runs = fs.readdirSync(path.join(root, 'output/gates')).filter(name => /^\d{8}-\d{6}$/.test(name)).sort().reverse();
  for (const run of runs) {
    const file = path.join(root, 'output/gates', run, 'summary.json');
    if (!fs.existsSync(file)) continue;
    for (const row of JSON.parse(fs.readFileSync(file, 'utf8')).tests) if (row.status === 'passed' && row.seconds) typical[row.file || row.name] = row.seconds;
    break;
  }
} catch { /* first run */ }
const estimate = job => typical[job.file || job.name] ?? 60;

if (options.plan) {
  console.log(JSON.stringify({rule, reasons: selection.reasons, shared: selection.shared, unmatched: selection.unmatched, areas: selection.areas, changedTests: selection.changedTests, generated: selection.generated, defaultGateOnly: selection.defaultGateOnly.length, build: options.build, jobs: options.jobs, browserJobs: options.browserJobs, defaultGate: options.defaultGate, checkJobs: options.checkJobs,
    run: jobs.map(job => ({name: job.name, gate: job.gate, ...(job.serial ? {serial: true} : {}), ...(job.skip ? {skip: job.skip} : {}), estimateSeconds: estimate(job)})),
    counts: {releaseBuild: selection.tests.filter(file => gateOf.get(file) === 'release-build').length, browser: selection.tests.filter(file => gateOf.get(file) === 'browser').length, of: gatedTests(manifest).length}}, null, 2));
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const runDir = path.join(root, 'output/gates', stamp);
fs.mkdirSync(path.join(runDir, 'screenshots'), {recursive: true});
const rel = file => path.relative(root, file);

// Environment: the caller's, without proxy variables; YR_BROWSER_EXECUTABLE and screenshot folders only for browser tests.
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(https?|all|no)_proxy$/i.test(name) && !/^GLOBAL_AGENT_.*PROXY$/i.test(name) && name !== 'NODE_USE_ENV_PROXY' && name !== 'YR_BROWSER_EXECUTABLE'));
const screenshotVariables = ['YR_GATE_SCREENSHOT_DIR', 'YR_OFFLINE_SCREENSHOT_DIR', 'YR_UPDATE_SCREENSHOT_DIR', 'YR_COMPETITORS_SCREENSHOT_DIR', 'YR_COMPETITOR_INTELLIGENCE_SCREENSHOT_DIR', 'YR_ERP_CUSTOMERS_SCREENSHOT_DIR', 'YR_ERP_SCREENSHOT_DIR', 'YR_KPI_SCREENSHOT_DIR', 'YR_MOLD_SCREENSHOT_DIR', 'YR_PWA_SCREENSHOT_DIR', 'YR_WORKFLOW_SCREENSHOT_DIR'];
function environment(job) {
  if (job.gate === 'release-build' || job.gate === 'build') return {...baseEnv, NODE_NO_WARNINGS: '1'};
  if (job.gate !== 'browser') return {...baseEnv};
  const shots = path.join(runDir, 'screenshots', job.name);
  fs.mkdirSync(shots, {recursive: true});
  return {...baseEnv, ...(options.browserExecutable ? {YR_BROWSER_EXECUTABLE: options.browserExecutable} : {}), ...Object.fromEntries(screenshotVariables.map(name => [name, shots]))};
}

// docs/ files tests rewrite (tests/test-areas.json docsWrittenByTests): put back at the end exactly as they were at the start.
const docsStatus = () => new Map(git('status', '--porcelain=v1', '-z', '--untracked-files=all', '--', 'docs').split('\0').filter(Boolean).map(line => [line.slice(3), line.slice(0, 2)]));
const writtenByTests = (globs => file => globs.some(re => re.test(file)))(map.docsWrittenByTests.globs.map(globToRegExp));
const docsBefore = docsStatus(), docsBackup = path.join(runDir, 'docs-before');
for (const file of docsBefore.keys()) if (fs.existsSync(file) && fs.statSync(file).isFile()) { fs.mkdirSync(path.dirname(path.join(docsBackup, file)), {recursive: true}); fs.copyFileSync(file, path.join(docsBackup, file)); }
const statusBefore = git('status', '--porcelain=v1', '--untracked-files=all');
function restoreDocs() {
  const restored = [];
  for (const [file, code] of docsStatus()) {
    if (!writtenByTests(file)) continue; // reported in worktreeChangedByRun, never undone (it may be someone's edit)
    if (docsBefore.has(file)) {
      const backup = path.join(docsBackup, file);
      if (fs.existsSync(backup) && (!fs.existsSync(file) || !fs.readFileSync(file).equals(fs.readFileSync(backup)))) { fs.copyFileSync(backup, file); restored.push(file); }
      continue;
    }
    if (code === '??') fs.rmSync(file, {force: true}); else git('checkout', '--', file);
    restored.push(file);
  }
  return restored;
}

// One test: its own process group (the release, its HTTPS front and Chromium die with it), its own log, its timeout.
const running = new Set();
function run(job, label = job.name, suffix = '') {
  const log = path.join(runDir, label + suffix + '.log'), started = Date.now();
  job.startedAt = started;
  const descriptor = fs.openSync(log, 'w', 0o600);
  const child = spawn(process.execPath, job.args, {cwd: root, env: environment(job), stdio: ['ignore', descriptor, descriptor], detached: true});
  fs.closeSync(descriptor);
  running.add(child);
  const group = signal => { try { process.kill(-child.pid, signal); } catch { /* already gone */ } };
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; group('SIGTERM'); setTimeout(() => group('SIGKILL'), 10000).unref(); }, job.timeout * 1000);
  return new Promise(resolve => child.on('exit', (code, signal) => {
    clearTimeout(timer); group('SIGKILL'); running.delete(child);
    const text = fs.readFileSync(log, 'utf8'), last = text.trim().split('\n').at(-1) || '';
    const checks = Number(last.match(/"checks":(\d+)/)?.[1] ?? text.match(/(\d+)\/\d+ checks passed/)?.[1] ?? NaN);
    resolve({passed: code === 0 && !timedOut, exitCode: code, signal, timedOut, seconds: Math.round((Date.now() - started) / 100) / 10, checks: Number.isNaN(checks) ? null : checks, log: rel(log), tail: code === 0 ? '' : text.slice(-1500)});
  }));
}

process.on('SIGINT', () => { for (const child of running) try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } const restored = restoreDocs(); console.error('\nInterrupted; docs restored: ' + restored.length); process.exit(130); });

const wallStart = Date.now(), results = new Map();
const print = (job, row) => console.log(`${row.status.padEnd(8)} ${job.name} (${job.gate}${row.seconds != null ? ', ' + row.seconds + ' s' : ''}${row.checks != null ? ', ' + row.checks + ' checks' : ''})${row.reason ? ' — ' + row.reason : ''}`);
console.log(`Gates ${stamp}: ${rule.mode} — ${selection.reasons.join(' | ')}`);
console.log(`${selection.tests.length} of ${gatedTests(manifest).length} release-build/browser tests; pool of ${options.jobs} (at most ${options.browserJobs} browsers); logs in ${rel(runDir)}`);

let build = null;
if (options.build) {
  fs.rmSync(path.join(root, 'dist'), {recursive: true, force: true});
  build = await run({name: 'build', gate: 'build', args: ['scripts/build-independent.mjs'], timeout: 1800});
  print({name: 'build', gate: 'build'}, {...build, status: build.passed ? 'passed' : 'FAILED'});
} else if (!fs.existsSync(path.join(root, 'dist/standalone/server.js'))) throw Error('--no-build needs an existing build in dist/standalone.');

const record = (job, row) => { results.set(job.name, {name: job.name, file: job.file, gate: job.gate, ...row}); print(job, row); };
// A passing default gate whose own pool reran a failure alone (scripts/check.mjs) is flaky, with the entries named.
function passed(job, row) {
  if (job.gate === 'default') {
    try {
      const report = JSON.parse(fs.readFileSync(path.join(root, 'output/check/default-results.json'), 'utf8'));
      if (report.flaky?.length) return record(job, {status: 'flaky', reason: 'scripts/check.mjs reran alone and passed: ' + report.flaky.join(', '), flakyEntries: report.flaky, ...row});
    } catch { /* no report */ }
  }
  record(job, {status: 'passed', ...row});
}
const queue = [], later = [];
for (const job of jobs) {
  if (job.skip) record(job, {status: 'skipped', reason: job.skip});
  else if (build && !build.passed) record(job, {status: 'not run', reason: 'the build failed'});
  else (job.serial ? later : queue).push(job);
}
queue.sort((a, b) => (b.name === 'default-gate') - (a.name === 'default-gate') || estimate(b) - estimate(a));
const firstTry = new Map();
async function worker() {
  for (;;) {
    let index = queue.findIndex(job => job.gate !== 'browser' || [...active].filter(name => jobs.find(j => j.name === name).gate === 'browser').length < options.browserJobs);
    if (index < 0) { if (!queue.length) return; await new Promise(resolve => setTimeout(resolve, 500)); continue; }
    const [job] = queue.splice(index, 1);
    active.add(job.name);
    const row = await run(job);
    active.delete(job.name);
    firstTry.set(job.name, row);
    if (row.passed) passed(job, row); else console.log(`retry    ${job.name} failed in the pool after ${row.seconds} s; it runs again alone at the end`);
  }
}
const active = new Set();
// --default-gate first: the default gate alone before the pool (its own pool then has the machine); alongside: one slot of the pool.
if (options.defaultGate === 'first' && queue[0]?.name === 'default-gate') {
  const [job] = queue.splice(0, 1), row = await run(job);
  firstTry.set(job.name, row);
  if (row.passed) passed(job, row); else console.log(`retry    ${job.name} failed after ${row.seconds} s; its failures run again alone at the end`);
}
await Promise.all(Array.from({length: options.jobs}, worker));
const poolSeconds = Math.round((Date.now() - wallStart) / 1000);
for (const job of later) { const row = await run(job); firstTry.set(job.name, row); if (row.passed) record(job, {status: 'passed', alone: true, ...row}); else console.log(`retry    ${job.name} failed alone; it runs once more`); }

// Every failure once more, alone. A default gate failure reruns only its failed entries, the way scripts/check.mjs runs them.
for (const job of jobs.filter(job => firstTry.has(job.name) && !firstTry.get(job.name).passed)) {
  const first = firstTry.get(job.name);
  let again;
  if (job.name === 'default-gate') {
    let failed = [];
    const report = path.join(root, 'output/check/default-results.json');
    // Only this run's report (a gate that was killed leaves the previous one): else the whole gate runs again.
    try { if (fs.statSync(report).mtimeMs >= job.startedAt) failed = JSON.parse(fs.readFileSync(report, 'utf8')).results.filter(row => !row.passed).map(row => row.name); } catch { /* no report */ }
    if (failed.length) {
      const command = name => name === 'typescript' ? ['--max-old-space-size=768', 'node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false'] : name === 'eslint' ? ['--max-old-space-size=2048', 'node_modules/eslint/bin/eslint.js', '.'] : ['--max-old-space-size=512', name];
      const rows = [];
      for (const name of failed) rows.push({name, ...(await run({...job, args: command(name), timeout: 300}, 'default-gate.rerun.' + path.basename(name), ''))});
      again = {passed: rows.every(row => row.passed), seconds: rows.reduce((sum, row) => sum + row.seconds, 0), checks: null, log: rows.map(row => row.log).join(' '), entries: rows.map(row => ({name: row.name, passed: row.passed}))};
    }
  }
  again ??= await run(job, job.name, '.rerun');
  const row = {...again, seconds: first.seconds, checks: again.checks ?? first.checks, log: first.log, firstTry: {exitCode: first.exitCode, signal: first.signal, timedOut: first.timedOut, tail: first.tail}, rerun: {seconds: again.seconds, exitCode: again.exitCode, log: again.log, ...(again.entries ? {entries: again.entries} : {})}};
  record(job, again.passed ? {status: 'flaky', reason: 'failed first, passed when run again alone', ...row} : {status: 'failed', reason: (again.timedOut ? 'timed out' : 'exit ' + again.exitCode) + ' twice', ...row});
}

const restored = restoreDocs();
const statusAfter = git('status', '--porcelain=v1', '--untracked-files=all');
const wall = Math.round((Date.now() - wallStart) / 1000);
const rows = jobs.map(job => results.get(job.name));
const totals = Object.fromEntries(['passed', 'flaky', 'failed', 'skipped', 'not run'].map(status => [status, rows.filter(row => row.status === status).length]));
const summary = {defaultGate: options.defaultGate, checkJobs: options.checkJobs, run: stamp, head: git('rev-parse', '--short', 'HEAD').trim(), rule, reasons: selection.reasons, areas: selection.areas, shared: selection.shared, unmatched: selection.unmatched, changedTests: selection.changedTests,
  jobs: options.jobs, browserJobs: options.browserJobs, cpus: os.availableParallelism(), browserExecutable: options.browserExecutable || null,
  build: build && {status: build.passed ? 'passed' : 'failed', seconds: build.seconds, log: build.log},
  wallClockSeconds: wall, poolSeconds, totals,
  tests: rows.map(({tail, ...row}) => ({...row, ...(row.status === 'failed' ? {tail} : {})})),
  docsRestored: restored, worktreeChangedByRun: statusAfter === statusBefore ? [] : statusAfter.split('\n').filter(line => line && !statusBefore.split('\n').includes(line))};
fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

const width = Math.max(...rows.map(row => row.name.length)), gateWidth = Math.max(...rows.map(row => row.gate.length));
console.log('\n' + 'test'.padEnd(width) + '  ' + 'gate'.padEnd(gateWidth) + '  status    seconds  checks');
for (const row of rows) console.log(row.name.padEnd(width) + '  ' + row.gate.padEnd(gateWidth) + '  ' + row.status.padEnd(8) + '  ' + String(row.seconds ?? '').padStart(7) + '  ' + String(row.checks ?? '').padStart(6) + (row.reason ? '  ' + row.reason : ''));
console.log(`\n${rule.mode} run: ${Object.entries(totals).filter(([, n]) => n).map(([status, n]) => n + ' ' + status).join(', ')}; build ${build ? build.seconds + ' s' : 'skipped'}; wall clock ${Math.floor(wall / 60)} min ${wall % 60} s; docs restored: ${restored.length}; ${rel(path.join(runDir, 'summary.json'))}`);
if (summary.worktreeChangedByRun.length) console.log('Changed during the run and not undone (a test outside docsWrittenByTests, or someone\'s edit):\n  ' + summary.worktreeChangedByRun.join('\n  '));
process.exitCode = totals.failed || totals['not run'] || (build && !build.passed) ? 1 : 0;
