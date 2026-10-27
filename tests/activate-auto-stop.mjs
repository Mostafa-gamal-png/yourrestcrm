// The activator stops the application's own Node.js processes when the host has started them again after "Stop App", and
// nothing else: not a shell sitting in the folder, not the helper or the terminal that ran it, not unrelated programs.
// Fake /proc trees give the exact cases (respawn, ignored SIGTERM, zombies); real child processes prove the real /proc is read right.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const helper = require('../portable/activate-ui-refresh-update.cjs');
const {pathsFor, ensureStopped, appServerProcesses, terminateApp} = helper;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-auto-stop-'));
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const dir = name => { const d = path.join(work, name); fs.mkdirSync(d, {recursive: true, mode: 0o700}); return d; };

const home = dir('home'), p = pathsFor(home);
fs.mkdirSync(p.app, {mode: 0o700}); fs.mkdirSync(p.data, {mode: 0o700});
const elsewhere = dir('elsewhere');

/** One fake /proc/<id>: cwd, argv, comm, state, parent and the files it holds open. */
const fake = (root, id, {cwd = home, argv = ['node', 'x'], comm = 'node', state = 'S', parent = 1, fds = []} = {}) => {
  const base = path.join(root, String(id));
  fs.mkdirSync(path.join(base, 'fd'), {recursive: true});
  fs.symlinkSync(cwd, path.join(base, 'cwd'));
  fs.writeFileSync(path.join(base, 'cmdline'), argv.join('\0') + '\0');
  fs.writeFileSync(path.join(base, 'comm'), comm + '\n');
  fs.writeFileSync(path.join(base, 'stat'), `${id} (${comm}) ${state} ${parent} 1 1 0 -1 0 0 0 0 0\n`);
  fds.forEach((target, i) => fs.symlinkSync(target, path.join(base, 'fd', String(i + 3))));
};
const gone = (root, id) => fs.rmSync(path.join(root, String(id)), {recursive: true, force: true});
const quiet = () => {};
const sleepNow = async () => {};

// 1. What counts as the application's server process.
{
  const root = dir('proc-detect');
  fake(root, 41001, {cwd: p.app, argv: [`lsnode:${p.app}/`], comm: `lsnode:${home.slice(0, 7)}`});
  fake(root, 41002, {cwd: p.data, argv: ['/opt/alt/alt-nodejs22/root/usr/bin/node', 'whatever.js'], comm: 'node'});
  fake(root, 41003, {cwd: elsewhere, argv: ['node', `${p.app}/app.cjs`], comm: 'node'});
  fake(root, 41004, {cwd: elsewhere, argv: ['node', 'worker.js'], comm: 'node', fds: [path.join(p.data, 'database.sqlite-wal')]});
  fake(root, 41005, {cwd: p.app, argv: ['-bash'], comm: 'bash'});
  fake(root, 41006, {cwd: p.app, argv: ['sleep', '300'], comm: 'sleep'});
  fake(root, 41007, {cwd: elsewhere, argv: ['node', 'other-project.js'], comm: 'node'});
  fake(root, 41008, {cwd: elsewhere, argv: ['node', 'other.js'], comm: 'node', fds: [path.join(home, 'yourrest-crm-data-other/database.sqlite')]});
  fake(root, 41009, {cwd: p.app, argv: ['/usr/bin/nodemon', 'x'], comm: 'nodemon'});
  eq(appServerProcesses(p, root).sort(), ['41001', '41002', '41003', '41004'], 'lsnode and node processes holding the app or its data');
  assert.throws(() => ensureStopped(p, root), {code: 'APP_OR_DATA_STILL_IN_USE'}); checks++;
}

// 2. Neither this helper, nor the shell or terminal chain that started it, is ever a target.
{
  const root = dir('proc-protected');
  const grand = 71000 + (process.pid % 1000);
  fake(root, process.pid, {cwd: p.app, argv: ['node', 'activate.cjs'], parent: process.ppid});
  fake(root, process.ppid, {cwd: p.app, argv: ['node', 'wrapper.js'], parent: grand});
  fake(root, grand, {cwd: p.app, argv: ['node', 'terminal-host.js'], parent: 1});
  fake(root, 42001, {cwd: p.app, argv: ['node', 'app.cjs']});
  eq(appServerProcesses(p, root), ['42001'], 'only the unrelated application process');
}

// 3. SIGTERM is enough: they are gone, nothing is forced.
{
  const root = dir('proc-term'), log = [], signals = [];
  fake(root, 43001, {cwd: p.app, argv: [`lsnode:${p.app}/`], comm: 'lsnode'});
  fake(root, 43002, {cwd: p.app, argv: ['node', 'app.cjs']});
  const kill = (id, signal) => { signals.push(`${id}:${signal}`); gone(root, id); };
  const stopped = await terminateApp(p, {procRoot: root, kill, sleep: sleepNow, log: line => log.push(line)});
  eq(stopped, 2); eq(signals.sort(), ['43001:SIGTERM', '43002:SIGTERM']);
  ok(log.some(line => line.includes('STOPPING IT NOW')) && log.some(line => line === 'APP PROCESSES STOPPED: 2'), 'the output says what was done');
  ensureStopped(p, root); checks++;
}

// 4. A process that ignores SIGTERM is forced after the grace period.
{
  const root = dir('proc-force'), signals = [];
  fake(root, 44001, {cwd: p.app, argv: ['node', 'stubborn.js']});
  const kill = (id, signal) => { signals.push(signal); if(signal === 'SIGKILL') gone(root, id); };
  const stopped = await terminateApp(p, {procRoot: root, kill, sleep: sleepNow, log: quiet, graceMs: 1000, forceMs: 1000, pollMs: 250});
  eq(signals, ['SIGTERM', 'SIGKILL']); eq(stopped, 1);
  eq(appServerProcesses(p, root), []);
}

// 5. A zombie is already stopped: it is neither waited for nor forced.
{
  const root = dir('proc-zombie'), signals = [];
  fake(root, 45001, {cwd: p.app, argv: ['node', 'app.cjs']});
  const kill = (id, signal) => { signals.push(signal); fs.writeFileSync(path.join(root, String(id), 'stat'), `${id} (node) Z 1 1 1 0 -1 0 0 0 0 0\n`); fs.writeFileSync(path.join(root, String(id), 'cmdline'), ''); };
  eq(await terminateApp(p, {procRoot: root, kill, sleep: sleepNow, log: quiet}), 1);
  eq(signals, ['SIGTERM'], 'no SIGKILL for a process that already exited');
}

// 6. The host starts it again between two scans: the next round stops it as well.
{
  const root = dir('proc-respawn'), signals = [];
  fake(root, 46001, {cwd: p.app, argv: [`lsnode:${p.app}/`], comm: 'lsnode'});
  let respawns = 1;
  const kill = (id, signal) => { signals.push(`${id}:${signal}`); gone(root, id); if(respawns-- > 0) fake(root, 46002, {cwd: p.app, argv: [`lsnode:${p.app}/`], comm: 'lsnode'}); };
  eq(await terminateApp(p, {procRoot: root, kill, sleep: sleepNow, log: quiet}), 2);
  eq(signals, ['46001:SIGTERM', '46002:SIGTERM']);
  ensureStopped(p, root); checks++;
}

// 7. A host that never lets it stay stopped ends in the strict refusal, never in an endless loop.
{
  const root = dir('proc-relentless');
  let next = 47001;
  fake(root, next, {cwd: p.app, argv: ['node', 'app.cjs']});
  const kill = (id) => { gone(root, id); next++; fake(root, next, {cwd: p.app, argv: ['node', 'app.cjs']}); };
  eq(await terminateApp(p, {procRoot: root, kill, sleep: sleepNow, log: quiet, rounds: 3}), 3, 'three rounds and no more');
  assert.throws(() => ensureStopped(p, root), {code: 'APP_OR_DATA_STILL_IN_USE'}); checks++;
}

// 8. Signal failures are reported, not thrown: ensureStopped stays the judge.
{
  const root = dir('proc-denied'), log = [];
  fake(root, 48001, {cwd: p.app, argv: ['node', 'app.cjs']});
  const kill = () => { throw Object.assign(new Error('denied'), {code: 'EPERM'}); };
  eq(await terminateApp(p, {procRoot: root, kill, sleep: sleepNow, log: line => log.push(line), graceMs: 500, forceMs: 500, pollMs: 250, rounds: 1}), 0);
  ok(log.some(line => line.startsWith('COULD NOT SIGNAL PROCESS 48001: EPERM')));
  assert.throws(() => ensureStopped(p, root), {code: 'APP_OR_DATA_STILL_IN_USE'}); checks++;
}

// 9. Nothing running: nothing is signalled and nothing is printed.
{
  const root = dir('proc-empty'), log = [];
  eq(await terminateApp(p, {procRoot: root, kill: () => assert.fail('no signal expected'), sleep: sleepNow, log: line => log.push(line)}), 0);
  eq(log, []);
}

// 10. The real /proc: a real Node.js server process sitting in the application folder is stopped, a real sleep there is not.
if(fs.existsSync('/proc/self/stat')) {
  const server = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {cwd: p.app, stdio: 'ignore'});
  const sleeper = spawn('sleep', ['120'], {cwd: p.app, stdio: 'ignore'});
  const exited = child => new Promise(resolve => child.once('exit', (code, signal) => resolve(signal || code)));
  const serverExit = exited(server);
  await new Promise(resolve => setTimeout(resolve, 400));
  try {
    eq(appServerProcesses(p), [String(server.pid)], 'the real Node.js process is found, the real sleep is not');
    const log = [];
    eq(await terminateApp(p, {log: line => log.push(line), graceMs: 5000}), 1);
    eq(await serverExit, 'SIGTERM', 'the server received a polite SIGTERM');
    eq(appServerProcesses(p), []);
    ok(process.kill(sleeper.pid, 0), 'the sleeper is still running');
  } finally { server.kill('SIGKILL'); sleeper.kill('SIGKILL'); }
}

// 11. The wiring in run(): one call, before the first strict check, only when no custom `stopped` was injected, never in --check.
{
  const source = fs.readFileSync(new URL('../portable/activate-ui-refresh-update.cjs', import.meta.url), 'utf8');
  eq(source.split('await terminate(').length - 1, 1, 'terminate is awaited once');
  ok(source.includes('terminate = stopped === ensureStopped ? terminateApp : null'), 'default only with the real strict check');
  ok(/if\(terminate\) await terminate\(p,\{log\}\);\n  stopped\(p\);\n  \/\/ mkdir is exclusive/.test(source), 'right before the first strict check, ahead of any lock');
  ok(source.indexOf("if(mode === 'check')") < source.indexOf('await terminate('), 'after the --check return');
}

fs.rmSync(work, {recursive: true, force: true});
console.log(`activator auto-stop: ${checks} checks passed`);
