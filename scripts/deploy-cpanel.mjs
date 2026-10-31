// Puts an update package on the hosting account of crm.yourrest.org through cPanel's own API, the way the Sadeem CRM is updated.
// The session that builds a package cannot reach the hosting account, so .github/workflows/deploy.yml runs this on GitHub with a cPanel
// API token (cPanel > Security > Manage API Tokens). cPanel's API moves files but runs no command, so the commands of the update guide run
// through a temporary cron line: every minute it starts scripts/hosting-cron.sh, which runs scripts/hosting-deploy.sh once for the
// request this script leaves in ~/yourrest-deploy and writes the output beside it; this script reads the output back through the API and
// removes the line again, whatever happened. A request nobody took is deleted, so it can never run later on its own.
// The token travels in a header only; nothing here prints it.
//
//   node scripts/deploy-cpanel.mjs --mode check|deploy|verify --package <zip> --sha256 <hex> --stage <folder> --helper <file> --run <id>
//   node scripts/deploy-cpanel.mjs --mode diagnose --script scripts/diagnose/<name>.cjs --run <id>   (a read-only check, no package)
//   node scripts/deploy-cpanel.mjs --mode backup --run <id>   (a verified backup now, then the daily backup cron line, added once)
//
// The account comes from CPANEL_HOST, CPANEL_USER and CPANEL_API_TOKEN.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const WORK = 'yourrest-deploy', APP_ROOT = 'yourrest-crm', SCRIPTS = ['hosting-deploy.sh', 'hosting-cron.sh'], DIAGNOSE = 'diagnose.cjs';
export const CRON_COMMAND = `/bin/bash $HOME/${WORK}/hosting-cron.sh >/dev/null 2>&1`;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, RUN = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/, STALE_RUNNING_MS = 2 * 3600_000;

export class DeployError extends Error { constructor(message) { super(message); this.name = 'DeployError'; } }

/** A value pasted into GitHub's settings may bring spaces, a line break and, copied out of a right-to-left message, marks of direction. */
export const cleanSetting = value => String(value ?? '').replace(/\p{Cf}/gu, '').trim();

/** The base address of cPanel's API: a bare host gets https and port 2083. */
export function cpanelBase(value) {
  const text = value.replace(/\/+$/, '');
  if (/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(text)) return text;
  if (!/^[A-Za-z0-9.-]+(:\d+)?$/.test(text)) throw new DeployError('CPANEL_HOST is not a host name, e.g. premium137.web-hosting.com');
  return text.includes(':') ? `https://${text}` : `https://${text}:2083`;
}

/** The daily backup runs at 03:15 Riyadh (00:15 UTC); cron reads the server's own clock, whose offset the hosting run printed (+hhmm). */
export function dailyBackupTime(offset) {
  const m = /^([+-])(\d\d)(\d\d)$/.exec(offset ?? '');
  if (!m) throw new DeployError(`the server's UTC offset could not be read (${offset})`);
  const local = ((15 + (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]))) % 1440 + 1440) % 1440;
  return {minute: String(local % 60), hour: String(Math.floor(local / 60))};
}

/** What can be said about a refused token without saying it: the shape of the two values. */
export function accountHints(user, token) {
  const hints = [];
  if (/[@\s/]/.test(user)) hints.push('CPANEL_USER must be the cPanel account name (the folder after /home/), not an e-mail');
  if (!/^[A-Z0-9]{32}$/.test(token)) hints.push(`CPANEL_API_TOKEN is ${token.length} characters${/[^A-Z0-9]/.test(token) ? ' with signs other than capitals and digits' : ''}: a cPanel token is 32 capitals and digits (copied whole?)`);
  return hints.join('; ');
}

function checkConfig(c) {
  if (!['check', 'deploy', 'verify', 'diagnose', 'backup'].includes(c.mode)) throw new DeployError('mode must be check, deploy, verify, diagnose or backup');
  if (c.mode === 'diagnose' && !c.diagnose) throw new DeployError('diagnose needs the check script');
  if (!c.user || !c.token) throw new DeployError('CPANEL_USER and CPANEL_API_TOKEN are needed');
  if (!/^[a-z][a-z0-9]{0,31}$/.test(c.user)) throw new DeployError('CPANEL_USER must be the cPanel account name (small letters and digits)');
  for (const [label, value] of [['stage', c.stage], ['helper', c.helper]]) if (!NAME.test(value ?? '')) throw new DeployError(`${label} must be a plain file name`);
  if (!RUN.test(c.run ?? '')) throw new DeployError('run must be letters, digits and -');
  if (c.mode === 'check' || c.mode === 'deploy') {
    if (!NAME.test(c.zipName ?? '') || !c.zip) throw new DeployError('the package is needed for check and deploy');
    if (!/^[0-9a-f]{64}$/.test(c.sha256 ?? '')) throw new DeployError('sha256 must be the 64 hex digits of the package');
  }
  for (const name of SCRIPTS) if (!c.scripts?.[name]) throw new DeployError(`scripts/${name} is needed`);
  cpanelBase(c.host);
}

/**
 * Runs one mode of scripts/hosting-deploy.sh on the account and returns {code, output}: the script's exit code and everything it printed.
 * deps: fetch, sleep(ms), log(line) for this side's steps, out(line) for each line the hosting account printed, now() in ms,
 * and optionally pollMs, claimMs (how long the cron line may take to start the run) and runMs (how long the run may take).
 */
export async function deploy(given, deps) {
  const marked = ['host', 'user', 'token'].filter(key => /\p{Cf}/u.test(given[key] ?? ''));
  if (marked.length) deps.log(`invisible marks of direction were taken out of ${marked.join(', ')}`);
  const c = {...given, host: cleanSetting(given.host), user: cleanSetting(given.user).toLowerCase(), token: cleanSetting(given.token)};
  // A diagnose run carries no package: hosting-deploy.sh runs the uploaded check script in place of an activator.
  if (c.mode === 'diagnose') Object.assign(c, {stage: 'none', helper: DIAGNOSE});
  // A backup run carries nothing either: hosting-deploy.sh runs the live release's own backup tools.
  if (c.mode === 'backup') Object.assign(c, {stage: 'none', helper: 'none'});
  checkConfig(c);
  const packaged = c.mode === 'check' || c.mode === 'deploy';
  const {fetch, sleep, log, out = () => {}, now = Date.now, pollMs = 10_000, claimMs = 6 * 60_000, runMs = 45 * 60_000} = deps;
  const base = cpanelBase(c.host), home = `/home/${c.user}`, dir = `${home}/${WORK}`;
  const auth = {Authorization: `cpanel ${c.user}:${c.token}`};

  async function call(pathAndQuery, init = {}, what = 'cPanel') {
    let response;
    try {
      response = await fetch(base + pathAndQuery, {...init, headers: {...auth, ...(init.headers ?? {})}, redirect: 'manual', signal: AbortSignal.timeout(init.body instanceof FormData ? 600_000 : 120_000)});
    } catch (error) { throw new DeployError(`cPanel could not be reached for ${what} (${error.message})`); }
    if (response.status === 401 || response.status === 403) {
      const hints = accountHints(c.user, c.token);
      throw new DeployError(`cPanel refused the token (HTTP ${response.status}): check CPANEL_USER and CPANEL_API_TOKEN${hints ? ` (${hints})` : ''}`);
    }
    if (!response.ok) throw new DeployError(`cPanel answered HTTP ${response.status} to ${what}`);
    try { return await response.json(); } catch { throw new DeployError(`cPanel answered ${what} with something that is not JSON (is CPANEL_HOST the cPanel server?)`); }
  }
  /** UAPI (/execute/Module/function): status 1, or the errors cPanel gave. */
  async function uapi(func, params, what, init = {}) {
    const answer = await call(`/execute/Fileman/${func}${params ? '?' + new URLSearchParams(params) : ''}`, init, what);
    if (answer?.status !== 1) throw new DeployError(`${what} refused by cPanel: ${answer?.errors?.filter(Boolean).join('; ') || 'no reason given'}`);
    return answer.data;
  }
  /** API 2 (/json-api/cpanel): the rows, or the error cPanel gave. */
  async function api2(module, func, params, what) {
    const answer = (await call('/json-api/cpanel?' + new URLSearchParams({cpanel_jsonapi_apiversion: '2', cpanel_jsonapi_module: module, cpanel_jsonapi_func: func, ...params}), {}, what))?.cpanelresult;
    const rows = Array.isArray(answer?.data) ? answer.data : [];
    if (!answer || answer.event?.result !== 1 || answer.error) throw new DeployError(`${what} refused by cPanel: ${answer?.error || rows.map(row => row?.reason || row?.statusmsg).filter(Boolean).join('; ') || 'no reason given'}`);
    return rows;
  }
  const list = async folder => (await uapi('list_files', {dir: folder, types: 'dir|file', show_hidden: '0'}, `reading ${folder === home ? 'the home folder' : WORK}`)) ?? [];
  const read = async name => (await uapi('get_file_content', {dir, file: name}, `reading ${WORK}/${name}`))?.content ?? '';
  const unlink = name => api2('Fileman', 'fileop', {op: 'unlink', sourcefiles: `${dir}/${name}`, doubledecode: '0'}, `removing ${WORK}/${name}`);
  const ourLines = async () => (await api2('Cron', 'listcron', {}, 'reading the cron jobs')).filter(row => typeof row?.command === 'string' && row.command.includes(`${WORK}/hosting-cron.sh`));
  async function upload(folder, files, what) {
    const form = new FormData();
    form.set('dir', folder); form.set('overwrite', '1');
    files.forEach(([name, blob], i) => form.set(`file-${i + 1}`, blob, name));
    const done = await uapi('upload_files', null, what, {method: 'POST', body: form});
    if (done && done.succeeded !== undefined && done.succeeded < files.length) throw new DeployError(`${what} failed: ${done.uploads?.map(entry => entry.reason).filter(Boolean).join('; ') || 'no reason given'}`);
  }

  // 0. The token opens the account, and the account is the one that runs the app.
  const homeFiles = await list(home);
  if (!homeFiles.some(entry => entry.file === APP_ROOT && entry.type === 'dir')) throw new DeployError(`the account has no ${APP_ROOT} folder in its home: is CPANEL_USER the account of crm.yourrest.org?`);
  log(`the token opens the account and ${APP_ROOT} is there`);
  if (!homeFiles.some(entry => entry.file === WORK && entry.type === 'dir')) {
    await api2('Fileman', 'mkdir', {path: home, name: WORK}, `making ${WORK}`);
  }
  // A run another workflow left on the account (the workflow gave up, the run did not) must end first; one older than two hours died.
  const nowSeconds = now() / 1000;
  for (const entry of await list(dir)) {
    if (!/^running-/.test(entry.file)) continue;
    if (nowSeconds - Number(entry.mtime ?? 0) < STALE_RUNNING_MS / 1000) throw new DeployError(`an earlier run is still going on the hosting account (${WORK}/${entry.file}): wait for it`);
    log(`${WORK}/${entry.file} is more than two hours old: that run ended without a word`);
  }

  // 1. The package beside the app (as the guide uploads it), and the two scripts.
  if (packaged) {
    await upload(home, [[c.zipName, c.zip]], 'the upload of the package');
    log(`uploaded ${c.zipName} (${Math.round(c.zip.size / 1024 / 1024)} MB)`);
  }
  await upload(dir, [...SCRIPTS.map(name => [name, c.scripts[name]]), ...(c.mode === 'diagnose' ? [[DIAGNOSE, c.diagnose]] : [])], 'the upload of the scripts');

  // 2. The request, then the cron line that runs it. The request goes last: a line left from before must not find half of it.
  const output = [];
  let result, streamed = 0;
  try {
    await uapi('save_file_content', null, 'writing the request', {method: 'POST', body: new URLSearchParams({dir, file: 'request', content: (packaged ? [c.run, c.mode, c.zipName, c.stage, c.helper, c.sha256] : [c.run, c.mode, 'none', c.stage, c.helper, 'none']).join(' ') + '\n'})});
    if (!(await ourLines()).length) {
      const added = await api2('Cron', 'add_line', {command: CRON_COMMAND, minute: '*', hour: '*', day: '*', month: '*', weekday: '*'}, 'adding the cron line');
      if (added.some(row => row?.status === 0)) throw new DeployError(`adding the cron line refused by cPanel: ${added.map(row => row.statusmsg).filter(Boolean).join('; ') || 'no reason given'}`);
    }
    log(`asked for ${c.mode}; a cron line starts it within a minute`);

    // 3. Wait for the run, showing what the hosting account prints as it comes.
    const started = now();
    let taken = false;
    const show = async final => {
      const text = await read(`log-${c.run}`);
      const end = final ? text.length : text.lastIndexOf('\n') + 1;
      if (end <= streamed) return;
      for (const line of text.slice(streamed, end).replace(/\n$/, '').split('\n')) { output.push(line); out(line); }
      streamed = end;
    };
    for (;;) {
      await sleep(pollMs);
      const names = new Set((await list(dir)).map(entry => entry.file));
      if (!taken && !names.has('request')) { taken = true; log('the hosting account started the run'); }
      if (names.has(`log-${c.run}`)) await show(false);
      if (names.has(`done-${c.run}`)) {
        const code = Number.parseInt((await read(`done-${c.run}`)).trim(), 10);
        await show(true);
        result = {code: Number.isInteger(code) ? code : 1, output: output.join('\n')};
        break;
      }
      if (!taken && now() - started > claimMs) throw new DeployError(`the cron line did not start the run in ${Math.round(claimMs / 60_000)} minutes: are cron jobs allowed on the account? (cPanel > Cron Jobs)`);
      if (now() - started > runMs) throw new DeployError(`no result after ${Math.round(runMs / 60_000)} minutes; the run may still be going on the hosting account: its output is in ${WORK}/log-${c.run}`);
    }
  } finally {
    // Whatever happened: no request waits for a later minute, and no cron line stays behind.
    try {
      if ((await list(dir)).some(entry => entry.file === 'request')) { await unlink('request'); log('the request nobody took was deleted'); }
    } catch (error) { log(`could not check for a request left behind (${error.message})`); }
    try {
      for (const row of await ourLines()) await api2('Cron', 'remove_line', row.linekey ? {linekey: row.linekey} : {line: String(row.commandnumber ?? row.count)}, 'removing the cron line');
      if ((await ourLines()).length) log('the cron line is still there: remove it in cPanel > Cron Jobs (it does nothing without a request)');
      else log('the cron line was removed');
    } catch (error) { log(`could not remove the cron line (${error.message}): remove it in cPanel > Cron Jobs (it does nothing without a request)`); }
  }
  // 4. After a verified backup, the daily backup line: once, at 03:15 Riyadh, with the command the release's backup-cron.mjs made.
  if (c.mode === 'backup' && result.code === 0) {
    const command = /^BACKUP CRON COMMAND: (.+)$/m.exec(result.output)?.[1], offset = /^SERVER UTC OFFSET: (\S+)$/m.exec(result.output)?.[1];
    if (!command || !command.includes('backup-scheduled.mjs') || /[\r\n]/.test(command)) throw new DeployError('the backup was verified but the hosting account gave no daily backup command');
    const {minute, hour} = dailyBackupTime(offset);
    const daily = (await api2('Cron', 'listcron', {}, 'reading the cron jobs')).filter(row => typeof row?.command === 'string' && row.command.includes('backup-scheduled.mjs'));
    if (daily.length) log(`the daily backup was already scheduled (${daily.length} line): nothing added`);
    else {
      const added = await api2('Cron', 'add_line', {command, minute, hour, day: '*', month: '*', weekday: '*'}, 'adding the daily backup line');
      if (added.some(row => row?.status === 0)) throw new DeployError(`adding the daily backup line refused by cPanel: ${added.map(row => row.statusmsg).filter(Boolean).join('; ') || 'no reason given'}`);
      log(`the daily backup is scheduled every day at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')} server time (UTC ${offset}), 03:15 Riyadh, keeping the last 14`);
    }
  }
  return result;
}

// What the hosting account said that matters at a glance: one annotation, since the session that asked reads annotations first.
const KEY_LINE = /STOP|READY|VERIFIED|SWITCHED|SELECTOR|START APP|STARTED|STOPPED|MIGRATIONS|DATABASE|CUSTOMER CODES|LOGIN HTTP|ANONYMOUS|BACKUP|CHECKPOINT|UNPACKED|ATTEMPT/;
const annotation = text => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

async function main() {
  const args = new Map();
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new DeployError(`usage: --mode check|deploy|verify --package <zip> --sha256 <hex> --stage <folder> --helper <file> --run <id>, --mode diagnose --script <file> --run <id>, or --mode backup --run <id>`);
    args.set(argv[i].slice(2), argv[i + 1]);
  }
  const mode = args.get('mode'), pkg = args.get('package'), packaged = mode === 'check' || mode === 'deploy';
  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const scripts = Object.fromEntries(await Promise.all(SCRIPTS.map(async name => [name, await fs.openAsBlob(path.join(scriptsDir, name))])));
  const result = await deploy({
    host: process.env.CPANEL_HOST ?? '', user: process.env.CPANEL_USER ?? '', token: process.env.CPANEL_API_TOKEN ?? '',
    mode, stage: args.get('stage'), helper: args.get('helper'), run: args.get('run'), scripts,
    zip: packaged ? await fs.openAsBlob(pkg) : null, zipName: packaged ? path.basename(pkg) : null, sha256: args.get('sha256'),
    diagnose: mode === 'diagnose' ? await fs.openAsBlob(args.get('script')) : null,
  }, {
    fetch, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    log: line => console.log(`::notice title=deploy::${annotation(line)}`), out: line => console.log(line),
  });
  const keyLines = result.output.split('\n').filter(line => KEY_LINE.test(line)).slice(-40).join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${mode} on crm.yourrest.org: exit ${result.code}\n\n\`\`\`\n${result.output}\n\`\`\`\n`);
  if (keyLines) console.log(`::notice title=hosting said::${annotation(keyLines)}`);
  if (result.code === 0) { console.log(`::notice title=deploy result::${mode} passed`); return; }
  const why = result.code === 4 ? 'the release is switched but the app did not answer: press Start App for yourrest-crm in cPanel, then ask for mode=verify'
    : result.code === 2 ? 'stopped before anything changed' : 'stopped; read the lines of the hosting account above before anything else';
  console.log(`::error title=deploy failed::${mode} ended with code ${result.code}: ${why}`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.log(`::error title=deploy failed::${annotation(error instanceof DeployError ? error.message : `unexpected: ${error.message}`)}`);
    process.exitCode = 1;
  });
}
