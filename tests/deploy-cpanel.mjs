// The deploy to the hosting account through cPanel's API (scripts/deploy-cpanel.mjs) with the two scripts that run there
// (scripts/hosting-cron.sh and scripts/hosting-deploy.sh), against a pretend cPanel kept in a temporary folder: its file calls act on
// that folder and its cron runs the real scripts with bash whenever the deploy waits. A pretend activator and a pretend CloudLinux
// selector stand in for the packaged activator and the host. No network, no real account, no token.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {deploy, DeployError, CRON_COMMAND, SCRIPTS, cleanSetting, cpanelBase, accountHints, dailyBackupTime} from '../scripts/deploy-cpanel.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', USER = 'youriedx', STAGE = 'yourrest-crm-update-test-20261029', HELPER = 'yourrest-activate-update-test.cjs';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yr-deploy-cpanel-'));
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

// ---- the package: the pretend activator answers like the real one; FAKE_* in the environment of the cron decide how it goes
const ACTIVATOR = `const fs = require('fs'), path = require('path'), home = process.env.HOME, mode = process.argv[2] || 'apply';
fs.appendFileSync(path.join(home, 'activator.log'), mode + '\\n');
if (mode === '--check') console.log('PACKAGE AND CONFIGURATION: READY. APP MAY REMAIN RUNNING.');
else if (mode === '--verify') {
  const verify = process.env.FAKE_VERIFY || 'always';
  if (verify === 'never' || (verify === 'after-start' && !fs.existsSync(path.join(home, 'started')))) { console.log('STOP LOGIN_HTTP_503'); process.exit(1); }
  console.log('MIGRATIONS: 16'); console.log('DEPLOYMENT VERIFIED');
} else if (process.env.FAKE_FAIL === 'before-switch') { console.log('1/4 APP STOPPED. VALIDATING CURRENT DATA AND TODAY\\'S BACKUP...'); console.log('STOP APP_OR_DATA_STILL_IN_USE'); process.exit(1); }
else { console.log('4/4 RELEASE SWITCHED'); console.log('START APP IN CPANEL'); }
`;
function makePackage(name, sums) {
  const src = fs.mkdtempSync(path.join(temp, 'src-'));
  fs.mkdirSync(path.join(src, 'release'));
  fs.writeFileSync(path.join(src, 'release', 'server.js'), '// release\n');
  fs.writeFileSync(path.join(src, 'RELEASE-SHA256SUMS.txt'), sums);
  fs.writeFileSync(path.join(src, HELPER), ACTIVATOR);
  const zip = path.join(temp, name);
  const made = spawnSync('python3', ['-I', '-c', 'import os,sys,zipfile\nz=zipfile.ZipFile(sys.argv[1],"w")\nfor d,_,fs in os.walk(sys.argv[2]):\n  for f in fs: p=os.path.join(d,f); z.write(p,os.path.relpath(p,sys.argv[2]))\nz.close()', zip, src]);
  assert.equal(made.status, 0, String(made.stderr));
  const bytes = fs.readFileSync(zip);
  return {zip: new Blob([bytes]), zipName: name, sha256: createHash('sha256').update(bytes).digest('hex')};
}
const PACKAGE = makePackage('Yourrest-CRM-Update-Test-20261029.zip', 'aaaa  release/server.js\n');
const OTHER = makePackage('Yourrest-CRM-Update-Other-20261029.zip', 'bbbb  release/server.js\n');
const scripts = Object.fromEntries(SCRIPTS.map(name => [name, new Blob([fs.readFileSync(path.join(root, 'scripts', name))])]));

// ---- the pretend selector: records what it was asked; "get" carries an environment variable that must never be printed
const withSelector = fs.mkdtempSync(path.join(temp, 'bin-')), withoutSelector = fs.mkdtempSync(path.join(temp, 'bin-'));
fs.writeFileSync(path.join(withSelector, 'cloudlinux-selector'), `#!/bin/bash
echo "$*" >> "$HOME/selector.log"
case "$1" in
  get) echo '{"result": "success", "users": {"${USER}": {"applications": {"yourrest-crm": {"app_status": "started", "nodejs_version": "22", "domain": "crm.yourrest.org", "env_vars": {"YR_SECRET": "do-not-print-me"}}}}}}';;
  stop) rm -f "$HOME/started"; echo '{"result": "success"}';;
  start) if [ -n "$FAKE_START_FAILS" ]; then echo '{"result": "error", "messages": ["cannot start"]}'; else touch "$HOME/started"; echo '{"result": "success"}'; fi;;
esac
`, {mode: 0o755});

// ---- the pretend cPanel
function cpanel({env = {}, selector = false, cronRuns = true, token = TOKEN, app = true} = {}) {
  const home = fs.mkdtempSync(path.join(temp, 'home-')), state = {home, env, cron: [], calls: [], uploads: [], clock: Date.parse('2026-10-29T12:00:00Z')};
  if (app) fs.mkdirSync(path.join(home, 'yourrest-crm'));
  const local = p => { const prefix = `/home/${USER}`; assert.ok(p === prefix || p.startsWith(prefix + '/'), 'a path outside the account: ' + p); return path.join(home, p.slice(prefix.length)); };
  const json = body => new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}});
  const uapiError = message => json({status: 0, errors: [message], data: null});
  const api2 = (data, error) => json({cpanelresult: {event: {result: error ? 0 : 1}, data, ...(error ? {error} : {})}});
  state.fetch = async (url, init = {}) => {
    const u = new URL(url);
    assert.equal(u.origin, 'https://premium137.web-hosting.com:2083');
    assert.equal(init.redirect, 'manual');
    if (init.headers?.Authorization !== `cpanel ${USER}:${token}`) return new Response('<html>Access denied</html>', {status: 401});
    const q = u.searchParams, body = init.body;
    const p = body instanceof URLSearchParams ? body : q;
    state.calls.push(u.pathname === '/json-api/cpanel' ? `${q.get('cpanel_jsonapi_module')}::${q.get('cpanel_jsonapi_func')}` : u.pathname.split('/').slice(2).join('::'));
    switch (u.pathname) {
      case '/execute/Fileman/list_files': {
        const dir = local(q.get('dir'));
        if (!fs.existsSync(dir)) return uapiError('Invalid directory');
        return json({status: 1, data: fs.readdirSync(dir, {withFileTypes: true}).map(entry => { const s = fs.statSync(path.join(dir, entry.name)); return {file: entry.name, type: entry.isDirectory() ? 'dir' : 'file', size: s.size, mtime: Math.floor(s.mtimeMs / 1000)}; })});
      }
      case '/execute/Fileman/upload_files': {
        assert.equal(init.method, 'POST');
        const dir = local(body.get('dir'));
        assert.equal(body.get('overwrite'), '1');
        const uploads = [];
        for (const [key, file] of body.entries()) if (key.startsWith('file-')) { fs.writeFileSync(path.join(dir, file.name), Buffer.from(await file.arrayBuffer())); uploads.push({file: file.name}); state.uploads.push(file.name); }
        return json({status: 1, data: {succeeded: uploads.length, failed: 0, uploads}});
      }
      case '/execute/Fileman/get_file_content': {
        const file = path.join(local(q.get('dir')), q.get('file'));
        return fs.existsSync(file) ? json({status: 1, data: {content: fs.readFileSync(file, 'utf8')}}) : uapiError('The file does not exist');
      }
      case '/execute/Fileman/save_file_content': {
        assert.equal(init.method, 'POST');
        fs.writeFileSync(path.join(local(p.get('dir')), p.get('file')), p.get('content'));
        return json({status: 1, data: {}});
      }
      case '/json-api/cpanel': {
        assert.equal(q.get('cpanel_jsonapi_apiversion'), '2');
        const call = `${q.get('cpanel_jsonapi_module')}::${q.get('cpanel_jsonapi_func')}`;
        if (call === 'Fileman::mkdir') { fs.mkdirSync(path.join(local(q.get('path')), q.get('name'))); return api2([{result: 1}]); }
        if (call === 'Fileman::fileop') { assert.equal(q.get('op'), 'unlink'); fs.rmSync(local(q.get('sourcefiles'))); return api2([{result: 1}]); }
        if (call === 'Cron::listcron') return api2([...state.cron.map((row, i) => ({...row, commandnumber: i + 1})), {count: state.cron.length}]);
        if (call === 'Cron::add_line') {
          // The deploy's temporary line runs every minute; the daily backup line once a day at the time it was given.
          const daily = q.get('command').includes('backup-scheduled.mjs');
          for (const key of daily ? ['day', 'month', 'weekday'] : ['minute', 'hour', 'day', 'month', 'weekday']) assert.equal(q.get(key), '*');
          state.cron.push({command: q.get('command'), linekey: 'k' + (state.cron.length + 1), ...(daily ? {minute: q.get('minute'), hour: q.get('hour')} : {})}); return api2([{status: 1, linekey: 'k' + state.cron.length}]);
        }
        if (call === 'Cron::remove_line') { state.cron = state.cron.filter(row => row.linekey !== q.get('linekey')); return api2([{status: 1}]); }
        return api2([], 'unknown call ' + call);
      }
    }
    return new Response('not found', {status: 404});
  };
  // Every wait of the deploy is a minute of cron: each line starts, as cron would, through /bin/sh with the account's HOME.
  state.sleep = async ms => {
    state.clock += ms;
    if (!cronRuns) return;
    for (const row of state.cron) {
      const run = spawnSync('/bin/sh', ['-c', row.command], {env: {...process.env, ...state.env, HOME: home, PATH: `${selector ? withSelector : withoutSelector}:${process.env.PATH}`, YR_HOSTING_NODE: process.execPath, YR_VERIFY_PAUSE: '0'}, timeout: 60_000});
      assert.equal(run.status, 0, 'the cron line itself never fails: ' + String(run.stderr));
    }
  };
  state.now = () => state.clock;
  state.logs = []; state.lines = [];
  state.run = (mode, extra = {}) => deploy({host: 'premium137.web-hosting.com', user: USER, token: TOKEN, mode, stage: STAGE, helper: HELPER, run: '900-1', scripts,
    ...(mode === 'check' || mode === 'deploy' ? PACKAGE : {}), ...extra}, {fetch: state.fetch, sleep: state.sleep, now: state.now, log: line => state.logs.push(line), out: line => state.lines.push(line), pollMs: 10_000, ...extra.deps});
  state.file = name => fs.readFileSync(path.join(home, name), 'utf8');
  return state;
}
const lines = text => text.trim().split('\n');
function check_(result, s) {
  check(result.code, 0, 'the check ends well');
  check(lines(result.output), ['MANUAL SALES WITH ARABIC DIGITS: 2', 'DONE with HOME'], 'its output comes back as it printed it, run in the account\'s home');
  check(s.uploads, ['hosting-deploy.sh', 'hosting-cron.sh', 'diagnose.cjs'], 'the two scripts and the check script are uploaded, no package');
  check(fs.existsSync(path.join(s.home, 'selector.log')), false, 'the app is neither stopped nor started');
  check(s.cron, [], 'and no cron line stays');
}

try {
  // ---- small parts
  check(cleanSetting('‏ youriedx\n'), 'youriedx', 'marks of direction, spaces and line breaks are taken out of a setting');
  check(cpanelBase('premium137.web-hosting.com'), 'https://premium137.web-hosting.com:2083', 'a bare host gets https and port 2083');
  check(cpanelBase('https://premium137.web-hosting.com:2083/'), 'https://premium137.web-hosting.com:2083', 'a full address is kept');
  assert.throws(() => cpanelBase('premium137 web-hosting.com'), DeployError); checks++;
  check(accountHints(USER, TOKEN), '', 'a well-formed account and token give no hint');
  ok(/32 capitals and digits/.test(accountHints(USER, 'abc')), 'a short token is named as short');
  check(CRON_COMMAND, '/bin/bash $HOME/yourrest-deploy/hosting-cron.sh >/dev/null 2>&1', 'the cron line runs the script by $HOME and prints nothing (no cron mail)');

  // ---- 1. check, no selector: package and scripts uploaded, the run done by cron, the line removed, nothing left waiting
  {
    const s = cpanel(), result = await s.run('check');
    check(result.code, 0, 'check passes');
    check(lines(result.output), [`PACKAGE UNPACKED IN ${STAGE}`, 'PACKAGE AND CONFIGURATION: READY. APP MAY REMAIN RUNNING.', 'CLOUDLINUX SELECTOR: NOT AVAILABLE (Stop App and Start App stay in cPanel)'], 'check prints the unpacking, the activator and the selector');
    check(s.lines, lines(result.output), 'every line of the hosting account is shown as it comes');
    check(s.uploads, [PACKAGE.zipName, 'hosting-deploy.sh', 'hosting-cron.sh'], 'the package goes to the home folder and the two scripts beside the request');
    ok(fs.existsSync(path.join(s.home, PACKAGE.zipName)) && fs.existsSync(path.join(s.home, STAGE, HELPER)), 'the package is in the home folder and unpacked into the stage folder of the guide');
    check(s.file('activator.log'), '--check\n', 'check runs the activator with --check only');
    check(s.cron, [], 'the cron line is removed after the run');
    check(fs.readdirSync(path.join(s.home, 'yourrest-deploy')).sort(), ['done-900-1', 'hosting-cron.sh', 'hosting-deploy.sh', 'log-900-1'], 'no request and no running marker stay behind; the log and the exit code stay as a record');
    ok(s.logs.includes('the token opens the account and yourrest-crm is there') && s.logs.includes('the cron line was removed'), 'this side says what it did');
    check(s.calls.filter(call => call === 'Cron::add_line').length, 1, 'one cron line is added');
  }
  // ---- 2. check with the selector: the app's state is shown, its environment variables are not
  {
    const s = cpanel({selector: true}), result = await s.run('check');
    check(result.code, 0, 'check with the selector passes');
    ok(result.output.includes('CLOUDLINUX SELECTOR: AVAILABLE\nAPP IN SELECTOR: app_status=started, nodejs_version=22, domain=crm.yourrest.org'), 'the selector and the app state are shown');
    ok(!result.output.includes('do-not-print-me') && !result.output.includes('YR_SECRET'), 'the environment variables of the app are never printed');
  }
  // ---- 3. deploy with the selector: stop, the activator, start, verify; a second check of the same package reuses the folder
  {
    const s = cpanel({selector: true, env: {FAKE_VERIFY: 'after-start'}});
    check((await s.run('check')).code, 0, 'check first');
    const result = await s.run('deploy', {run: '901-1'});
    check(result.code, 0, 'deploy passes');
    check(lines(result.output), [`PACKAGE ALREADY UNPACKED IN ${STAGE}`, 'PACKAGE AND CONFIGURATION: READY. APP MAY REMAIN RUNNING.', 'APP STOPPED THROUGH CLOUDLINUX SELECTOR', '4/4 RELEASE SWITCHED', 'START APP IN CPANEL', 'APP STARTED THROUGH CLOUDLINUX SELECTOR', 'MIGRATIONS: 16', 'DEPLOYMENT VERIFIED'], 'deploy goes in the order of the guide');
    check(lines(s.file('selector.log')).slice(1), ['stop --json --interpreter nodejs --app-root yourrest-crm', 'start --json --interpreter nodejs --app-root yourrest-crm'], 'the app is stopped before the activator and started after it');
    check(s.file('activator.log'), '--check\n--check\napply\n--verify\n', 'the activator: check, apply, verify');
    check(s.cron, [], 'no cron line stays');
  }
  // ---- 4. the activator stops before the switch: the app stopped for it is started again, unchanged, and the run fails
  {
    const s = cpanel({selector: true, env: {FAKE_FAIL: 'before-switch'}}), result = await s.run('deploy');
    check(result.code, 3, 'a STOP of the activator fails the deploy');
    ok(result.output.includes('STOP APP_OR_DATA_STILL_IN_USE\nTHE ACTIVATOR STOPPED BEFORE THE SWITCH: STARTING THE UNCHANGED APP AGAIN\nAPP STARTED THROUGH CLOUDLINUX SELECTOR\nDEPLOY STOP: the activator ended with code 1; its lines above say why'), 'the STOP is shown and the old app comes back');
    check(lines(s.file('selector.log')), ['stop --json --interpreter nodejs --app-root yourrest-crm', 'start --json --interpreter nodejs --app-root yourrest-crm'], 'stopped, then started again');
    ok(!s.file('activator.log').includes('--verify'), 'nothing is verified after a STOP');
  }
  // ---- 5. the selector refuses to start after the switch: the run fails and says so
  {
    const s = cpanel({selector: true, env: {FAKE_START_FAILS: '1'}}), result = await s.run('deploy');
    check(result.code, 1, 'a start the selector refuses fails the deploy');
    ok(result.output.endsWith('START APP IN CPANEL\nCLOUDLINUX SELECTOR start DID NOT SUCCEED: {"result": "error", "messages": ["cannot start"]}'), 'the selector\'s answer is shown');
  }
  // ---- 6. no selector and the app does not come back by itself: switched, Start App asked for, then verify alone
  {
    const s = cpanel({env: {FAKE_VERIFY: 'never'}}), result = await s.run('deploy');
    check(result.code, 4, 'no selector and no answer: Start App is needed');
    ok(result.output.includes('CLOUDLINUX SELECTOR NOT AVAILABLE: THE ACTIVATOR STOPS THE RUNNING APP ITSELF') && result.output.includes('VERIFY ATTEMPT 6 DID NOT PASS') && result.output.endsWith('START APP IN CPANEL NOW, THEN ASK FOR mode=verify'), 'six attempts, then the request for Start App');
    s.env.FAKE_VERIFY = 'always'; // Start App pressed
    const uploadsBefore = s.uploads.length, verify = await s.run('verify', {run: '902-1'});
    check(verify.code, 0, 'verify alone passes');
    check(verify.output, 'MIGRATIONS: 16\nDEPLOYMENT VERIFIED', 'verify runs --verify only');
    check(s.uploads.slice(uploadsBefore), ['hosting-deploy.sh', 'hosting-cron.sh'], 'verify uploads no package');
  }
  // ---- 7. no selector and the host starts the app on the next request: verified without Start App
  {
    const s = cpanel(), result = await s.run('deploy');
    check(result.code, 0, 'the host started the app by itself');
    ok(result.output.endsWith('START APP IN CPANEL\nMIGRATIONS: 16\nDEPLOYMENT VERIFIED'), 'verified straight after the switch');
  }
  // ---- 8. refusals on the hosting account: another checksum, another package in the same folder
  {
    const s = cpanel(), result = await s.run('check', {sha256: '0'.repeat(64)});
    check([result.code, result.output.split('\n').at(-1)], [2, 'DEPLOY STOP: package checksum differs from the one built'], 'a package that is not the one built is refused');
    check((await s.run('check', {run: '903-1'})).code, 0, 'the right package unpacks');
    const other = await s.run('check', {...OTHER, run: '904-1'});
    check([other.code, other.output], [2, `DEPLOY STOP: ${STAGE} already holds another package`], 'another package is never unpacked over a stage folder');
  }
  // ---- 9. the token: refused (with a hint, never the token), and cleaned of what a paste brings
  {
    const s = cpanel({token: 'SOMETHINGELSE'});
    await assert.rejects(s.run('check'), error => error instanceof DeployError && /HTTP 401/.test(error.message) && !error.message.includes(TOKEN)); checks++;
    const t = cpanel(), result = await t.run('check', {user: '‏YourIedx\n', token: ` ${TOKEN}‎`});
    check(result.code, 0, 'a user with capitals and marks, and a token with spaces and marks, still work');
    ok(t.logs[0] === 'invisible marks of direction were taken out of user, token', 'the cleaning is said, the values are not');
  }
  // ---- 10. the wrong account, a run still going, a stale one, a cron line left from before
  {
    const s = cpanel({app: false});
    await assert.rejects(s.run('check'), /no yourrest-crm folder/); checks++;
    check(s.uploads, [], 'nothing is uploaded to an account without the app');
    const t = cpanel();
    fs.mkdirSync(path.join(t.home, 'yourrest-deploy')); fs.writeFileSync(path.join(t.home, 'yourrest-deploy', 'running-800-1'), 'deploy\n');
    const clock = t.clock / 1000; fs.utimesSync(path.join(t.home, 'yourrest-deploy', 'running-800-1'), clock - 600, clock - 600);
    await assert.rejects(t.run('check'), /an earlier run is still going/); checks++;
    check(t.uploads, [], 'nothing is uploaded while another run goes on');
    fs.utimesSync(path.join(t.home, 'yourrest-deploy', 'running-800-1'), clock - 3 * 3600, clock - 3 * 3600);
    t.cron.push({command: CRON_COMMAND, linekey: 'old'});
    check((await t.run('check')).code, 0, 'a marker older than two hours does not block');
    ok(t.logs.some(line => line.includes('running-800-1 is more than two hours old')), 'the stale marker is named');
    check([t.calls.filter(call => call === 'Cron::add_line').length, t.cron], [0, []], 'a line left from before is used, not doubled, and removed after');
  }
  // ---- 11. cron never starts it: the deploy gives up, deletes the request and removes the line, so it can never run later
  {
    const s = cpanel({cronRuns: false});
    await assert.rejects(s.run('deploy'), /did not start the run in 6 minutes/); checks++;
    check([s.cron, fs.existsSync(path.join(s.home, 'yourrest-deploy', 'request'))], [[], false], 'no line and no request stay behind');
    ok(s.logs.includes('the request nobody took was deleted'), 'the deletion is said');
  }
  // ---- 12. the request read by the cron script: two starts in the same minute run it once
  {
    const s = cpanel();
    s.cron.push({command: CRON_COMMAND, linekey: 'twin-1'}, {command: CRON_COMMAND, linekey: 'twin-2'});
    check((await s.run('check')).code, 0, 'two lines, one run');
    check(s.cron, [], 'both lines are removed');
    check(s.file('activator.log'), '--check\n', 'the second start found the request taken');
  }
  // ---- 12b. a read-only check of the live data: the check script is uploaded and run with the account's node, no package, no stop
  {
    const s = cpanel({selector: true});
    const check = new Blob(["console.log('MANUAL SALES WITH ARABIC DIGITS: 2'); console.log('DONE ' + (process.env.HOME ? 'with HOME' : 'without HOME'));\n"]);
    const result = await s.run('diagnose', {diagnose: check, stage: 'ignored', helper: 'ignored'});
    check_(result, s);
  }
  {
    const s = cpanel();
    await assert.rejects(s.run('diagnose'), /diagnose needs the check script/); checks++;
    check([s.calls, s.uploads], [[], []], 'no check script: refused before any call');
  }

  // ---- 12c. the daily backup: a backup now with the live release's own tools, verified, then the daily line, added once
  {
    const tools = (s, {backupFails = false} = {}) => {
      const ops = path.join(s.home, 'yourrest-crm', 'release', 'operations');
      fs.mkdirSync(ops, {recursive: true});
      // backup-scheduled.mjs ROOT 14, restore.mjs verify DIR, backup-cron.mjs ROOT 14, as the release ships them (pretend versions).
      fs.writeFileSync(path.join(ops, 'backup-scheduled.mjs'), backupFails
        ? "console.error(JSON.stringify({ok:false,errorCode:'DISK_FULL'}));process.exitCode=1;\n"
        : "import fs from 'node:fs';fs.mkdirSync(process.argv[2]+'/yourrest-backup-20261031T001500000Z-1a2b',{recursive:true});fs.appendFileSync(process.env.HOME+'/backup.log','backup '+process.argv.slice(2).join(' ')+'\\n');console.log(JSON.stringify({ok:true,state:'ok',backupName:'yourrest-backup-20261031T001500000Z-1a2b',objects:3,bytes:1000}));\n");
      fs.writeFileSync(path.join(ops, 'restore.mjs'), "import fs from 'node:fs';fs.appendFileSync(process.env.HOME+'/backup.log','restore '+process.argv.slice(2).join(' ')+'\\n');if(process.argv[2]!=='verify'||!fs.existsSync(process.argv[3]))process.exit(1);console.log(JSON.stringify({ok:true,objects:3,liveDataModified:false}));\n");
      fs.writeFileSync(path.join(ops, 'backup-cron.mjs'), "console.log(JSON.stringify({enabled:false,command:\"true # '\"+process.argv[2]+\"' backup-scheduled.mjs 14\"}));\n");
    };
    const s = cpanel({env: {TZ: 'Asia/Riyadh'}});
    tools(s);
    const result = await s.run('backup', {stage: 'ignored', helper: 'ignored'});
    check(result.code, 0, 'the backup run ends well');
    check(s.uploads, ['hosting-deploy.sh', 'hosting-cron.sh'], 'only the two scripts are uploaded: the backup tools are the live release\'s');
    check(s.file('backup.log'), `backup ${s.home}/yourrest-crm-backups 14\nrestore verify ${s.home}/yourrest-crm-backups/yourrest-backup-20261031T001500000Z-1a2b\n`, 'one backup into yourrest-crm-backups keeping 14, then that very backup verified');
    ok(lines(result.output).includes('BACKUP VERIFIED: yourrest-backup-20261031T001500000Z-1a2b'), 'the hosting account says it verified');
    check(s.cron.map(({command, minute, hour}) => ({command, minute, hour})), [{command: `true # '${s.home}/yourrest-crm-backups' backup-scheduled.mjs 14`, minute: '15', hour: '3'}], 'the temporary line is gone and one daily backup line stays, at 03:15 on a server that keeps Riyadh time');
    ok(s.logs.some(line => line.startsWith('the daily backup is scheduled every day at 03:15 server time (UTC +0300)')), 'the workflow says when it runs');
    check(fs.existsSync(path.join(s.home, 'selector.log')), false, 'the app is neither stopped nor started');
    const again = await s.run('backup', {stage: 'ignored', helper: 'ignored'});
    check([again.code, s.cron.filter(row => row.command.includes('backup-scheduled.mjs')).length], [0, 1], 'a second run takes another backup but does not add a second daily line');
    ok(s.logs.some(line => line.startsWith('the daily backup was already scheduled')), 'and says so');
  }
  {
    const s = cpanel();
    const ops = path.join(s.home, 'yourrest-crm', 'release', 'operations');
    fs.mkdirSync(ops, {recursive: true});
    fs.writeFileSync(path.join(ops, 'backup-scheduled.mjs'), "console.error(JSON.stringify({ok:false,errorCode:'DISK_FULL'}));process.exitCode=1;\n");
    const result = await s.run('backup', {stage: 'ignored', helper: 'ignored'});
    check(result.code, 3, 'a backup that fails ends the run with code 3');
    ok(lines(result.output).includes('BACKUP STOP: the backup did not finish (code 1)'), 'and says why, after the tool\'s own answer');
    check(s.cron, [], 'no daily line is added after a failed backup');
  }
  check([dailyBackupTime('+0000'), dailyBackupTime('-0400'), dailyBackupTime('+0530')], [{minute: '15', hour: '0'}, {minute: '15', hour: '20'}, {minute: '45', hour: '5'}], '03:15 Riyadh on a server in UTC, in New York summer time, in India');
  assert.throws(() => dailyBackupTime('EDT'), /UTC offset could not be read/); checks++;

  // ---- 13. what this side refuses before calling cPanel
  for (const [extra, pattern] of [[{mode: 'install'}, /mode must be/], [{stage: '../yourrest-crm'}, /stage must be a plain file name/], [{helper: 'a/b.cjs'}, /helper must be/], [{run: 'x y'}, /run must be/], [{sha256: 'abc'}, /sha256 must be/], [{zip: null}, /package is needed/], [{user: 'me@example.com'}, /account name/]]) {
    const s = cpanel();
    await assert.rejects(s.run(extra.mode ?? 'check', extra), pattern); checks++;
    check(s.calls, [], 'refused before any call: ' + pattern);
  }
  console.log(JSON.stringify({ok: true, checks}));
} finally {
  fs.rmSync(temp, {recursive: true, force: true});
}
