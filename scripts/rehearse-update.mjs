// Full rehearsal of a hosting update on a throwaway "home" folder, before anything is uploaded.
//
//   node scripts/rehearse-update.mjs --old-release <previous dist/standalone> --package <update.zip> [--out report.json] [--keep]
//
// It lays out an installed site exactly like the hosting account (root launcher, private settings.cjs, release/,
// data folder), runs the PREVIOUS release with synthetic data created through its own API, then follows the
// upgrade guide step by step with the packaged activator: --check while the app runs, refusal while another program
// still holds the application folder, the application started again as the host does after Stop App (the activator stops that
// Node.js server itself), switch, start, --verify. It then proves that data, settings and API results are unchanged and that
// a tampered package is refused without touching the live release.
//
// When the package declares a database migration (activator constant NEW_MIGRATIONS) the rehearsal also proves that the
// activator leaves the database at the old schema, that --verify refuses before the application has started, that the
// application's first start applies the migration after a private schema backup, that every pre-existing table is
// byte-identical afterwards, and that the new feature works for the right roles on the upgraded database.
//
// Only temporary folders and loopback sockets are used. No production data, DNS, mailbox or hosting access.
import assert from 'node:assert/strict';
import {spawn, spawnSync, execFileSync} from 'node:child_process';
import {request as httpRequest} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import {createServer} from 'node:net';
import {once} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

// Verification fetches https://<site origin>; resolve it to loopback and accept the throwaway certificate.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname === 'crm.yourrest.org') url.hostname = '127.0.0.1';
  return realFetch(url, init);
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const option = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const oldRelease = option('--old-release') && path.resolve(option('--old-release'));
const packageZip = option('--package') && path.resolve(option('--package'));
if (!oldRelease || !packageZip) { console.error('Usage: node scripts/rehearse-update.mjs --old-release DIR --package ZIP [--out FILE] [--keep]'); process.exit(2); }
for (const required of ['app.cjs', 'server.js', 'operations/config.cjs', 'drizzle']) assert(fs.existsSync(path.join(oldRelease, required)), 'Previous release is incomplete: ' + required);

// The package's own constants, read from its activator before anything is installed: the schema the live database must hold,
// and the anonymous probes the verification adds for routes this release introduces.
const listing = execFileSync('python3', ['-c', 'import zipfile,sys;print("\\n".join(i.filename for i in zipfile.ZipFile(sys.argv[1]).infolist() if "/" not in i.filename.rstrip("/")))', packageZip], {encoding: 'utf8'}).split('\n').filter(Boolean);
const helperName = listing.find(name => name.endsWith('.cjs'));
assert(helperName, 'the package carries one activator at its top level');
const helperSource = execFileSync('python3', ['-c', 'import zipfile,sys;sys.stdout.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode())', packageZip, helperName], {encoding: 'utf8'});
const constant = name => { const found = new RegExp('const ' + name + ' = (.+?);').exec(helperSource); assert(found, 'the activator carries ' + name); return JSON.parse(found[1]); };
const schemaBefore = constant('SCHEMA_BEFORE'), extraRoutes = constant('EXTRA_ROUTES');

const steps = [];
const note = (name, detail = {}) => { steps.push({step: name, ...detail}); console.error('[ok] ' + name); };
const sha = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = async () => { const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const {port} = probe.address(); await new Promise(resolve => probe.close(resolve)); return port; };
const stable = value => JSON.stringify(value, (key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

/** One installed site, laid out like the hosting account. */
/** `exactOrigin` serves https://crm.yourrest.org on port 443, which the activator's site guard requires. */
async function installSite(work, label, {exactOrigin = false} = {}) {
  const home = path.join(work, label);
  fs.mkdirSync(home, {mode: 0o700});
  const app = path.join(home, 'yourrest-crm'), data = path.join(home, 'yourrest-crm-data'), objects = path.join(data, 'objects');
  for (const dir of [app, data, objects]) fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  fs.cpSync(oldRelease, path.join(app, 'release'), {recursive: true});
  fs.copyFileSync(path.join(root, 'portable/launcher.cjs'), path.join(app, 'app.cjs'));
  const sendmail = path.join(home, 'sendmail.cjs'), mailFile = path.join(home, 'mail.jsonl');
  fs.writeFileSync(sendmail, '#!' + process.execPath + '\n' + `const fs=require('node:fs');let m='';process.stdin.on('data',b=>m+=b);process.stdin.on('end',()=>fs.appendFileSync(${JSON.stringify(mailFile)},JSON.stringify({to:process.argv.at(-1),message:m})+'\\n'));`, {mode: 0o700});
  const backend = await freePort(), front = exactOrigin ? 443 : await freePort(), hostHeader = exactOrigin ? 'crm.yourrest.org' : 'crm.yourrest.org:' + front, origin = 'https://' + hostHeader;
  const settings = {YR_APP_ORIGIN: origin, YR_AUTH_SECRET: randomBytes(32).toString('hex'), YR_DATABASE_PATH: path.join(data, 'database.sqlite'), YR_OBJECTS_PATH: objects, YR_MAIL_TRANSPORT: 'sendmail', YR_MAIL_FROM: 'noreply@yourrest.org', YR_SENDMAIL_PATH: sendmail};
  fs.writeFileSync(path.join(app, 'settings.cjs'), 'module.exports=' + JSON.stringify(settings, null, 2) + ';\n', {mode: 0o600});
  const db = new DatabaseSync(settings.YR_DATABASE_PATH);
  fs.chmodSync(settings.YR_DATABASE_PATH, 0o600);
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE yr_schema_migrations(name TEXT PRIMARY KEY NOT NULL,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)');
  const migrations = fs.readdirSync(path.join(oldRelease, 'drizzle')).filter(name => /^\d+.*\.sql$/.test(name)).sort();
  assert.equal(migrations.length, schemaBefore, 'the previous release must carry the ' + schemaBefore + '-migration schema the package expects');
  for (const name of migrations) { const sql = fs.readFileSync(path.join(oldRelease, 'drizzle', name), 'utf8'); db.exec(sql); db.prepare('INSERT INTO yr_schema_migrations VALUES(?,?,?)').run(name, sha(sql), '2026-10-07T00:00:00Z'); }
  const members = [['owner', 'admin', null, 'all'], ['mgr', 'manager', null, 'all'], ['sup', 'supervisor', 'mgr', 'all'], ['rep1', 'rep', 'sup', 'eastern'], ['repw', 'rep', 'mgr', 'western'], ['csm', 'customer_service_manager', 'mgr', 'all'], ['cs', 'customer_service', 'csm', 'all']];
  for (const [id, role, supervisor, region] of members) db.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,active,target,created_at,region_scope) VALUES(?,?,?,?,?,?,?,1,0,?,?)').run(id, 'opaque-' + id, id + '@yourrest.org', id, role, 'الرئيسي', supervisor, '2026-10-07T00:00:00Z', region);
  db.prepare('INSERT INTO crm_settings(id,owner_id) VALUES(?,?)').run('company', 'opaque-owner');
  db.close();
  fs.chmodSync(settings.YR_DATABASE_PATH, 0o600);

  const key = path.join(home, 'key.pem'), cert = path.join(home, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], {stdio: 'ignore'});
  const proxy = createHttpsServer({key: fs.readFileSync(key), cert: fs.readFileSync(cert)}, (incoming, outgoing) => {
    const forwarded = httpRequest({host: '127.0.0.1', port: backend, path: incoming.url, method: incoming.method, headers: {...incoming.headers, host: hostHeader, 'x-forwarded-proto': 'https'}}, response => { outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing); });
    forwarded.on('error', () => { outgoing.writeHead(502); outgoing.end('app stopped'); });
    incoming.pipe(forwarded);
  });
  proxy.listen(front, '127.0.0.1');
  await once(proxy, 'listening');

  let child, log = '';
  const site = {home, app, data, settings, origin, mailFile, proxy, get log() { return log; },
    async start() {
      child = spawn(process.execPath, ['app.cjs'], {cwd: app, env: {PATH: process.env.PATH, PORT: String(backend)}, stdio: ['ignore', 'pipe', 'pipe']});
      child.stdout.on('data', chunk => log += chunk); child.stderr.on('data', chunk => log += chunk);
      for (let attempt = 0; attempt < 150; attempt++) {
        if (child.exitCode !== null || child.signalCode !== null) throw Error('The app exited while starting: ' + log.slice(-600));
        try { if ((await site.request('/login')).status === 200) return; } catch { /* not listening yet */ }
        await sleep(100);
      }
      throw Error('The app did not start: ' + log.slice(-600));
    },
    // A child ended by a signal has exitCode null, so signalCode must be checked too or stop() would wait for an event that already fired.
    async stop() { if (!site.running) return; child.kill('SIGTERM'); await once(child, 'exit'); await sleep(300); },
    get running() { return !!child && child.exitCode === null && child.signalCode === null; },
    request(url, {method = 'GET', headers = {}, body} = {}) {
      let payload = body;
      const merged = {Host: hostHeader, 'X-Forwarded-Proto': 'https', ...headers};
      if (payload !== undefined && !Buffer.isBuffer(payload)) { payload = Buffer.from(JSON.stringify(payload)); merged['Content-Type'] = 'application/json'; }
      if (payload !== undefined) merged['Content-Length'] = String(payload.length);
      return new Promise((resolve, reject) => {
        const req = httpRequest({host: '127.0.0.1', port: backend, path: url, method, headers: merged, timeout: 20000}, res => {
          const parts = []; res.on('data', part => parts.push(part));
          res.on('end', () => { const bytes = Buffer.concat(parts), text = bytes.toString('utf8'); resolve({status: res.statusCode, headers: res.headers, bytes, text, json: () => JSON.parse(text)}); });
        });
        req.on('error', reject); req.on('timeout', () => req.destroy(Error('timeout ' + url)));
        if (payload !== undefined) req.write(payload);
        req.end();
      });
    },
    async login(id) {
      const email = id + '@yourrest.org', db = new DatabaseSync(settings.YR_DATABASE_PATH);
      try { db.exec('DELETE FROM auth_limits'); } finally { db.close(); }
      const challenge = await site.request('/api/auth/request', {method: 'POST', headers: {Origin: origin}, body: {email}});
      assert.equal(challenge.status, 200, 'sign-in code request');
      const cookie = name => (challenge.headers['set-cookie'] || []).find(c => c.startsWith(name + '='))?.split(';')[0];
      let mail;
      for (let attempt = 0; attempt < 60 && !mail; attempt++) { try { mail = fs.readFileSync(mailFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(m => m.to === email).at(-1); } catch { /* not yet */ } if (!mail) await sleep(100); }
      assert(mail, 'a sign-in code mail reached the mocked sendmail');
      const code = Buffer.from(mail.message.split('\r\n\r\n')[1].replaceAll('\r\n', ''), 'base64').toString('utf8').match(/\b\d{6}\b/)[0];
      const verified = await site.request('/api/auth/verify', {method: 'POST', headers: {Origin: origin, Cookie: cookie('__Host-yourrest_challenge')}, body: {code, return_to: '/'}});
      assert.equal(verified.status, 200, 'sign-in code verification');
      const session = (verified.headers['set-cookie'] || []).find(c => c.startsWith('__Host-yourrest_session='))?.split(';')[0];
      return (url, options = {}) => site.request(url, {...options, headers: {Origin: origin, Cookie: session, ...options.headers}});
    },
    close() { proxy.close(); proxy.closeAllConnections?.(); }};
  return site;
}

function tables(site, file = site.settings.YR_DATABASE_PATH) {
  // Every business table, in a stable order. Authentication tables change with sign-ins and are excluded.
  const db = new DatabaseSync(file, {readOnly: true});
  try {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'auth_%' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
    return Object.fromEntries(names.map(name => [name, sha(JSON.stringify(db.prepare('SELECT * FROM ' + name).all().map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? String(v) : v]))).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1))) + ':' + db.prepare('SELECT COUNT(*) n FROM ' + name).get().n]));
  } finally { db.close(); }
}
const fileHash = file => sha(fs.readFileSync(file));
function treeHash(dir) { return sha(fs.readdirSync(dir, {recursive: true, withFileTypes: true}).filter(entry => entry.isFile()).map(entry => path.relative(dir, path.join(entry.parentPath, entry.name)) + ':' + sha(fs.readFileSync(path.join(entry.parentPath, entry.name)))).sort().join('\n')); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-rehearsal-'));
const sites = [];
const report = {date: new Date().toISOString(), node: process.version, oldRelease: path.basename(path.dirname(oldRelease)) === 'dist' ? path.relative(root, oldRelease) : oldRelease, package: path.basename(packageZip), packageSha256: sha(fs.readFileSync(packageZip)), productionDataUsed: false, hostingAccessed: false};
try {
  // ── Site A: the full upgrade ────────────────────────────────────────────────────────────────
  const a = await installSite(work, 'home-a', {exactOrigin: true});
  sites.push(a);
  await a.start();
  note('previous release installed and serving', {origin: a.origin});

  const owner = await a.login('owner');
  const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date()), month = day.slice(0, 7);
  const customers = {};
  for (const [key, name, region, rep] of [['e1', 'مصنع الشرق', 'الشرقية', 'rep1'], ['w1', 'مصنع الغرب', 'الغربية', 'repw']]) {
    const created = await owner('/api/crm', {method: 'POST', body: {action: 'save', kind: 'customer', createKey: crypto.randomUUID(), data: {name, region, city: 'x', code: key, branch: 'الرئيسي', assignedTo: rep, phone: '0500000000', contact: 'م', customerType: 'مصنع', customerStatus: 'نشط'}}});
    assert.equal(created.status, 200, created.text);
    customers[key] = created.json().id;
  }
  const products = ['قوالب البلوك المتحركة', 'قوالب البلوك الثابتة', 'لمامة البلوك', 'ماكينة إنتاج البلوكة المتحركة', 'قطع غيار المكائن المتحركة', 'خلاطات البلوك', 'خلاطات الخرسانة الجاهزة', 'خدمات صيانة'];
  const saveTarget = (kind, scopeId, data) => owner('/api/targets', {method: 'POST', body: {kind, scopeId, month, version: 0, inheritedFrom: null, requestId: crypto.randomUUID(), data}});
  assert.equal((await saveTarget('weights', 'company', {products: products.map((product, index) => ({product, weight: [40, 20, 10, 10, 10, 5, 5, 0][index]}))})).status, 200);
  assert.equal((await saveTarget('sales', 'rep1', {products: products.map((product, index) => ({product, quantity: index === 0 ? 10 : index === 1 ? 4 : 0}))})).status, 200);
  for (const [key, rep, reference, quantity] of [['e1', 'rep1', 'INV-1', 5], ['w1', 'repw', 'INV-2', 2]]) {
    const sale = await owner('/api/sales', {method: 'POST', body: {action: 'save', createKey: crypto.randomUUID(), data: {customerId: customers[key], repId: rep, date: day, reference, items: [{product: products[0], description: '', quantity, unitPrice: 1000}, {product: products[1], description: '', quantity: 8, unitPrice: 50}], discount: 0, notes: ''}}});
    assert.equal(sale.status, 200, sale.text);
  }
  const form = new FormData();
  form.set('customerId', customers.e1); form.set('file', new File([Buffer.from('%PDF-1.4\n%rehearsal\n%%EOF')], 'quote.pdf'));
  const encoded = new Response(form);
  const upload = await owner('/api/visit-files', {method: 'POST', body: Buffer.from(await encoded.arrayBuffer()), headers: {'Content-Type': encoded.headers.get('content-type')}});
  assert.equal(upload.status, 200, upload.text);
  const fileId = upload.json().id;
  {
    const db = new DatabaseSync(a.settings.YR_DATABASE_PATH), now = new Date().toISOString();
    for (const [id, customer, who] of [['v-1', customers.e1, 'rep1'], ['v-2', customers.w1, 'repw']]) db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'activity',?,?,'الرئيسي',?,?,?,1,'rehearsal')").run(id, customer, who, JSON.stringify({type: 'visit', date: day, summary: 's', result: 'تم الشراء', salesStage: 'new', visitWorkflow: 'visit-v2', performedBy: who, responsibleId: who, recordedByEmail: who + '@yourrest.org'}), now, now);
    db.close();
  }
  const views = async () => {
    const result = {queues: {}};
    for (const who of ['owner', 'mgr', 'sup', 'rep1', 'repw']) {
      const call = who === 'owner' ? owner : await a.login(who);
      const crm = await call('/api/crm'); assert.equal(crm.status, 200, who + ' /api/crm');
      // The queue field is new in some releases: it is compared separately, never as a difference in the records.
      const {serviceQueue, ...records} = crm.json();
      result[who] = {crm: records}; result.queues[who] = Array.isArray(serviceQueue) ? serviceQueue.length : null;
      if (['owner', 'mgr', 'sup'].includes(who)) { const sales = await call('/api/sales?month=' + month); assert.equal(sales.status, 200); const body = sales.json(); result[who].sales = {references: body.sales.map(s => s.reference).sort(), performance: body.performance.map(p => [p.member.id, p.invoices, p.attainment.score, p.attainment.status]).sort()}; }
      if (who === 'rep1') { const own = await call('/api/targets?month=' + month); assert.equal(own.status, 200); result[who].targets = own.json(); }
    }
    const download = await owner('/api/visit-files?id=' + fileId);
    result.file = {status: download.status, sha: sha(download.bytes)};
    const anonymous = await a.request('/api/visits', {method: 'POST', headers: {Origin: a.origin}, body: {}});
    result.anonymousVisitsPost = anonymous.status;
    result.anonymousDeviceStatus = (await a.request('/api/device-status')).status;
    result.extra = {};
    for (const [route] of extraRoutes) result.extra[route] = (await a.request(route)).status;
    return result;
  };
  const before = await views();
  note('synthetic data created through the previous release and read back', {customers: 2, sales: 2, visits: 2, attachment: 1, anonymousVisitsPostBefore: before.anonymousVisitsPost});

  // Unpack the package exactly as the guide says.
  const stageName = /const STAGE_DIR = "([^"]+)";/.exec(helperSource)?.[1];
  assert(stageName, 'the activator carries the injected upload folder name');
  const stageA = path.join(a.home, stageName);
  fs.mkdirSync(stageA, {mode: 0o700});
  execFileSync('python3', ['-c', 'import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', packageZip, stageA]);
  const helper = require(path.join(stageA, helperName));
  const paths = helper.pathsFor(a.home);
  const baseline = {settings: fileHash(path.join(a.app, 'settings.cjs')), launcher: fileHash(path.join(a.app, 'app.cjs')), oldRelease: treeHash(path.join(a.app, 'release')), objects: treeHash(a.settings.YR_OBJECTS_PATH)};
  note('package unpacked into the guide folder', {stage: stageName, helper: helperName, releaseFiles: helper.RELEASE_FILES});

  const quiet = () => {};
  const lines = [];
  const log = line => { lines.push(line); console.error('    ' + line); };
  await helper.run(paths, 'check', {log});
  assert(lines.some(line => line.startsWith('PACKAGE AND CONFIGURATION: READY')), '--check reports READY');
  for (const name of helper.NEW_MIGRATIONS) assert(lines.some(line => line.includes('SCHEMA CHANGE: ') && line.includes(name)), '--check announces the schema change ' + name);
  assert(a.running, '--check leaves the app running');
  note('--check passes while the app is still serving');

  // A program that is not the Node.js server and still holds the application folder blocks the switch, and nothing changes.
  await a.stop();
  const holder = spawn('sleep', ['300'], {cwd: a.app, stdio: 'ignore'});
  let refused;
  try {
    try { await helper.run(paths, 'apply', {log: quiet}); } catch (error) { refused = error.code; }
  } finally { holder.kill('SIGKILL'); await once(holder, 'exit'); }
  assert.equal(refused, 'APP_OR_DATA_STILL_IN_USE', 'the activator refuses to switch while another program holds the application folder');
  assert.equal(treeHash(path.join(a.app, 'release')), baseline.oldRelease, 'a refused attempt leaves the live release untouched');
  assert.equal(fs.existsSync(paths.state), false, 'a refused attempt writes no state');
  note('switching is refused while another program holds the application folder', {code: refused});

  // The host starts the application again after Stop App: the activator stops that Node.js server itself and goes on.
  await a.start();
  assert(a.running, 'the application is serving again, as the host does after Stop App');
  const dataBeforeSwitch = tables(a);
  lines.length = 0;
  const state = await helper.run(paths, 'apply', {log});
  assert(lines.some(line => line.includes('STOPPING IT NOW')) && lines.some(line => line.startsWith('APP PROCESSES STOPPED: ')), 'the activator says it stopped the running application');
  assert.equal(a.running, false, 'the running application was stopped by the activator');
  note('the application was running again; the activator stopped it itself and switched', {stopped: lines.filter(line => line.includes('STOPPING IT NOW') || line.startsWith('APP PROCESSES STOPPED'))});
  assert(lines.includes('START APP IN CPANEL'), 'the activator asks for Start App');
  assert.equal(state.phase, 'switched');
  const dataAfterSwitch = tables(a);
  assert.deepEqual(dataAfterSwitch, dataBeforeSwitch, 'every business table is identical after the switch');
  if (helper.NEW_MIGRATIONS.length) {
    assert(lines.some(line => line.startsWith('THE FIRST START APPLIES ' + helper.NEW_MIGRATIONS.join(', '))), 'the activator says the first start applies the migration');
    const ledger = new DatabaseSync(a.settings.YR_DATABASE_PATH, {readOnly: true});
    try { assert.equal(ledger.prepare('SELECT COUNT(*) n FROM yr_schema_migrations').get().n, helper.SCHEMA_BEFORE, 'the activator leaves the database at the old schema'); } finally { ledger.close(); }
    assert.equal(fs.existsSync(path.join(a.data, 'schema-backups')) && fs.readdirSync(path.join(a.data, 'schema-backups')).length > 0 && fs.readdirSync(path.join(a.data, 'schema-backups')).some(name => name.startsWith('before-' + helper.NEW_MIGRATIONS[0].replace(/\.sql$/, '') + '-')), false, 'the schema backup does not exist before the application starts');
    let early;
    try { await helper.run(paths, 'verify', {log: quiet}); } catch (error) { early = error.code; }
    assert.equal(early, 'MIGRATION_NOT_APPLIED_START_APP_FIRST', '--verify before the application started says so plainly');
    note('the activator never touches the database; --verify refuses until the application has started', {code: early});
  }
  assert.equal(fileHash(path.join(a.app, 'settings.cjs')), baseline.settings, 'settings.cjs untouched');
  assert.equal(fileHash(path.join(a.app, 'app.cjs')), baseline.launcher, 'root launcher untouched');
  assert.equal(treeHash(a.settings.YR_OBJECTS_PATH), baseline.objects, 'uploaded files untouched');
  assert.notEqual(treeHash(path.join(a.app, 'release')), baseline.oldRelease, 'the live release is now the new one');
  assert.equal(helper.manifestFiles(paths.manifest).size, helper.RELEASE_FILES);
  {
    // The live release must now equal the pinned manifest, file for file. (The unpacked copy was moved into place.)
    const expected = helper.manifestFiles(paths.manifest), live = [...helper.inventory(paths.current)].filter(([, entry]) => entry.type === 'file');
    assert.equal(live.length, expected.size, 'the live release has exactly the packaged files');
    assert(live.every(([name, entry]) => expected.get(name) === entry.sha256), 'every live file matches its packaged SHA-256');
  }
  assert(fs.existsSync(path.join(state.transaction, 'old-release')) || fs.existsSync(path.join(state.transaction, 'application')), 'the previous release and a full backup are kept');
  note('stopped, backed up and switched; data, settings, launcher and uploads are byte-identical', {phase: state.phase, backupKept: path.basename(state.transaction)});

  await a.start();
  lines.length = 0;
  await helper.run(paths, 'verify', {log});
  assert(lines.includes('DEPLOYMENT VERIFIED'), '--verify ends with DEPLOYMENT VERIFIED');
  note('new release started; --verify prints DEPLOYMENT VERIFIED', {verifyOutput: lines.slice()});
  if (helper.NEW_MIGRATIONS.length) {
    const first = helper.NEW_MIGRATIONS[0];
    assert(lines.includes('MIGRATION APPLIED: ' + first), '--verify names the applied migration');
    for (const [route, expected] of helper.EXTRA_ROUTES) assert(lines.some(line => line.includes(route + ': ' + expected)), '--verify probed ' + route);
    const afterStart = tables(a), unchanged = Object.keys(dataBeforeSwitch).filter(name => name !== 'yr_schema_migrations');
    assert.deepEqual(Object.fromEntries(unchanged.map(name => [name, afterStart[name]])), Object.fromEntries(unchanged.map(name => [name, dataBeforeSwitch[name]])), 'every pre-existing table is byte-identical after the first start');
    const db = new DatabaseSync(a.settings.YR_DATABASE_PATH, {readOnly: true});
    let ledgerCount = 0;
    try {
      const ledger = db.prepare('SELECT name FROM yr_schema_migrations ORDER BY name').all().map(row => row.name);
      ledgerCount = ledger.length;
      assert.equal(ledger.length, helper.SCHEMA_AFTER, 'the ledger holds every migration');
      assert.equal(ledger.at(-1), first, 'the new migration is the last one');
      assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0, 'foreign keys are intact');
    } finally { db.close(); }
    const backups = fs.readdirSync(path.join(a.data, 'schema-backups')).filter(name => name.startsWith('before-' + first.replace(/\.sql$/, '') + '-'));
    assert.equal(backups.length, 1, 'exactly one private schema backup was taken by the first start');
    assert.equal(fs.statSync(path.join(a.data, 'schema-backups', backups[0])).mode & 0o077, 0, 'the schema backup is private');
    assert.deepEqual(tables(a, path.join(a.data, 'schema-backups', backups[0])), dataBeforeSwitch, 'the schema backup equals the database as it was before the migration');
    note('the first start applied ' + first + ' after a private schema backup; every earlier table is byte-identical', {ledger: ledgerCount, backup: backups[0]});
  }

  const after = await views();
  const differences = [];
  for (const who of ['owner', 'mgr', 'sup', 'rep1', 'repw']) for (const part of Object.keys(before[who])) if (stable(before[who][part]) !== stable(after[who][part])) differences.push(who + '.' + part);
  if (stable(before.file) !== stable(after.file)) differences.push('file');
  assert.deepEqual(differences, [], 'API results are identical for every role before and after the update');
  note('every role sees identical records, sales, performance and attachment after the update', {roles: 5});
  assert.equal(after.anonymousVisitsPost, 401, 'the new release answers an anonymous POST with 401');
  // A previous release that already carries the 401 guard answers 401 before as well; one that does not answers 400.
  assert([400, 401].includes(before.anonymousVisitsPost));
  // A route the package declares is new to the previous release (404 before), or carried over from an earlier package of the
  // same day that the previous release already is; either way the new release must answer it as declared.
  const introducedRoute = route => helper.EXTRA_ROUTES.some(([declared]) => declared === route) && before.extra[route] === 404;
  for (const [route, expected] of helper.EXTRA_ROUTES) {
    if (introducedRoute(route)) assert.equal(before.extra[route], 404, 'the previous release has no ' + route);
    else assert.equal(before.extra[route], expected, 'the previous release already answers ' + route + ' with ' + expected + ' without a session');
    assert.equal(after.extra[route], expected, 'the new release answers ' + route + ' with ' + expected + ' without a session');
  }
  if (helper.EXTRA_ROUTES.some(([route]) => route === '/api/service-queue/alerts')) {
    assert(Object.values(before.queues).every(count => count === null), 'the previous release sends no serviceQueue field');
    assert(Object.values(after.queues).every(count => count === 0), 'the new release sends an empty queue to every role while no request exists');
  }
  note('behaviour that is meant to change did change', {anonymousVisitsPost: {before: before.anonymousVisitsPost, after: after.anonymousVisitsPost}, newRoutes: {before: before.extra, after: after.extra}});

  if (helper.NEW_MIGRATIONS.includes('0015_member_devices.sql')) {
    // The new feature on the upgraded database, for the right people only.
    const body = {platform: 'android-app', deviceClass: 'android', gate: 'ok', missing: [], appVersion: '1.0.10', tracking: true, windowActive: true, enrolled: true, consent: true, foreground: 'granted', fineLocation: 'granted', notifications: 'granted', background: 'granted', locationServices: true, lastFixAt: '', accuracy: null, pendingCount: 0, pendingGapCount: 0, quarantinedCount: 0, error: '', syncError: ''};
    const rep1 = await a.login('rep1'), repw = await a.login('repw'), sup = await a.login('sup');
    assert.equal((await rep1('/api/device-status', {method: 'POST', body})).status, 200, 'a representative reports their phone');
    assert.equal((await owner('/api/device-status', {method: 'POST', body})).status, 403, 'an administrator does not');
    const seen = await sup('/api/device-status');
    assert.equal(seen.status, 200);
    assert.deepEqual(seen.json().members.map(member => member.memberId), ['rep1'], 'the supervisor sees only their own representative');
    assert.deepEqual(seen.json().members[0].devices.map(device => [device.platform, device.gate]), [['android-app', 'ok']], 'with the phone report');
    assert.equal((await repw('/api/device-status')).status, 403, 'a representative cannot read tracking state');
    const everyone = await owner('/api/device-status');
    assert.deepEqual(everyone.json().members.map(member => member.memberId).sort(), ['rep1', 'repw'], 'an administrator sees every representative');
    const today = await sup('/api/journeys?date=' + day + '&memberId=rep1');
    assert.equal(today.status, 200, 'the daily report still loads');
    assert(Array.isArray(today.json().tracking) && today.json().tracking.length === 1, 'and carries the tracking coverage');
    note('device status works on the upgraded database for the right roles', {supervisorSees: 1, administratorSees: 2});
  }

  if (helper.EXTRA_ROUTES.some(([route]) => route === '/api/service-queue/alerts')) {
    // The customer-service queue, the phone alert feed and the monthly report on the upgraded database, for the right people only.
    const calls = {};
    for (const who of ['csm', 'cs', 'mgr', 'sup', 'rep1', 'repw']) calls[who] = await a.login(who);
    const getCase = async (call, id) => (await call('/api/customer-service')).json().cases.find(item => item.id === id);
    const act = async (call, id, body) => { const item = await getCase(call, id); return call('/api/customer-service', {method: 'POST', body: {requestId: crypto.randomUUID(), id, version: item?.version, ...body}}); };
    const customerVersion = (() => { const db = new DatabaseSync(a.settings.YR_DATABASE_PATH, {readOnly: true}); try { return db.prepare('SELECT version FROM crm_records WHERE id=?').get(customers.e1).version; } finally { db.close(); } })();
    const registration = {type: 'call', summary: 'PRIVATE-REGISTRATION-SUMMARY', result: 'متابعة العميل', salesStage: 'new', strength: 'strong', requestedProducts: [products[0]], nextAction: 'اتصال بالعميل', nextDate: day, location: '26.437341, 50.034499', locationSource: 'device', locationCapturedAt: new Date().toISOString(), locationAccuracy: 12, customerNeeds: 'قالب جديد', hasCompetitor: true, competitorName: 'Competitor', competitorNotes: 'PRIVATE-COMPETITOR-NOTE'};
    const created = await calls.cs('/api/customer-service', {method: 'POST', body: {action: 'create', requestId: crypto.randomUUID(), customerId: customers.e1, customerVersion, registration, elapsedMilliseconds: 2200}});
    assert.equal(created.status, 200, 'customer service registers a request on the upgraded database: ' + created.text.slice(0, 120));
    const caseId = created.json().id;
    assert.equal((await act(calls.csm, caseId, {action: 'approve', targetId: 'mgr'})).status, 200, 'the customer-service manager approves it to the sales manager');
    assert.equal((await act(calls.mgr, caseId, {action: 'assign', targetId: 'rep1', note: 'ابدأ بالاتصال'})).status, 200, 'the sales manager assigns it with an instruction');
    const alertsOf = async call => (await call('/api/service-queue/alerts')).json().alerts.map(item => [item.id, item.awaiting, item.seen]);
    assert.deepEqual(await alertsOf(calls.rep1), [[caseId, 'first_contact', false]], 'the representative is told: the request waits for their first contact');
    for (const who of ['mgr', 'sup', 'repw', 'cs', 'csm']) assert.deepEqual(await alertsOf(calls[who]), [], who + ' is not told');
    assert.deepEqual(await alertsOf(owner), [], 'the administrator is not personally waited for');
    assert.equal((await a.request('/api/service-queue/alerts')).status, 401, 'an anonymous caller is refused');
    const queueOf = async call => (await call('/api/crm')).json().serviceQueue;
    const repQueue = await queueOf(calls.rep1);
    assert.deepEqual([repQueue.length, repQueue[0].stage, repQueue[0].awaiting, repQueue[0].assignmentNote], [1, 'first_contact', 'first_contact', 'ابدأ بالاتصال'], 'the same request sits in the representative\'s queue with the instruction');
    assert.equal((await queueOf(calls.mgr)).length, 1, 'and in the manager\'s');
    assert.equal((await queueOf(calls.repw)).length, 0, 'but not in another representative\'s');
    assert.equal(JSON.stringify([repQueue, await alertsOf(calls.rep1)]).includes('PRIVATE-'), false, 'no registration text or competitor note reaches the representative');
    assert.equal((await act(calls.rep1, caseId, {action: 'seen'})).status, 200, 'the representative opens it');
    assert.deepEqual(await alertsOf(calls.rep1), [[caseId, 'first_contact', true]], 'once opened, the feed says so');
    const reports = {};
    for (const [who, call] of [['owner', owner], ['mgr', calls.mgr], ['csm', calls.csm], ['sup', calls.sup], ['rep1', calls.rep1], ['repw', calls.repw], ['cs', calls.cs]]) reports[who] = await call('/api/service-report');
    assert.deepEqual(Object.fromEntries(Object.entries(reports).map(([who, response]) => [who, response.status])), {owner: 200, mgr: 200, csm: 200, sup: 403, rep1: 403, repw: 403, cs: 403}, 'the monthly report opens for the administrator, the sales manager and the customer-service manager only');
    assert.deepEqual([reports.owner.json().total, reports.mgr.json().total, reports.csm.json().total], [1, 1, 1], 'each sees the one request they may read');
    assert.equal(reports.owner.text.includes('PRIVATE-') || reports.owner.text.includes('مصنع'), false, 'and no customer name or private text');
    note('the customer-service queue, the phone alert feed and the monthly report work on the upgraded database for the right roles', {request: caseId});
  }

  if (helper.EXTRA_ROUTES.some(([route]) => route === '/api/support')) {
    // Customer-service assistance, a missed visit and the manager's approval count on the upgraded database, for the right people only.
    const calls = {};
    for (const who of ['csm', 'cs', 'mgr', 'sup', 'rep1', 'repw']) calls[who] = await a.login(who);
    const readDb = (sql, ...args) => { const db = new DatabaseSync(a.settings.YR_DATABASE_PATH, {readOnly: true}); try { return db.prepare(sql).get(...args); } finally { db.close(); } };
    const versionOf = id => readDb('SELECT version FROM crm_records WHERE id=?', id).version;
    const support = async call => (await call('/api/support')).json();
    const post = (call, body) => call('/api/support', {method: 'POST', body: {requestId: crypto.randomUUID(), ...body}});
    assert.equal((await a.request('/api/support')).status, 401, 'an anonymous caller is refused');
    for (const who of ['csm', 'cs', 'mgr', 'sup', 'rep1', 'repw']) { const answer = await support(calls[who]); assert.deepEqual([answer.requests.length, answer.missed.length], [0, 0], who + ' starts with nothing'); }
    const asked = await post(calls.rep1, {action: 'request', customerId: customers.e1, customerVersion: versionOf(customers.e1), note: 'يرجى التواصل مع العميل لمعرفة سبب التأخر', channel: 'call'});
    assert.equal(asked.status, 200, 'a representative asks for help with their customer on the upgraded database: ' + asked.text.slice(0, 120));
    const requestId = asked.json().id;
    assert.equal((await post(calls.repw, {action: 'request', customerId: customers.e1, customerVersion: versionOf(customers.e1), note: 'ليس عميلي'})).status, 403, 'another representative cannot');
    const ids = async who => (await support(calls[who])).requests.map(item => item.id);
    for (const who of ['rep1', 'sup', 'mgr', 'cs', 'csm']) assert.deepEqual(await ids(who), [requestId], who + ' sees it');
    assert.deepEqual(await ids('repw'), [], 'another representative does not');
    assert.deepEqual((await support(owner)).requests.map(item => item.id), [requestId], 'the administrator sees it');
    const waiting = (await support(calls.cs)).requests[0];
    assert.deepEqual([waiting.state, waiting.awaiting, waiting.permissions.take], ['waiting', 'take', true], 'the representative for every region may take it');
    assert.equal((await post(calls.cs, {action: 'take', id: requestId, version: waiting.version})).status, 200, 'customer service takes it');
    // The course after taking it: contact and submit, approval, assignment, the sales member's contact, closure, the representative opens the answer.
    const current = async who => (await support(calls[who])).requests.find(item => item.id === requestId);
    const advance = async (who, body, what) => { const found = await current(who); const response = await post(calls[who], {id: requestId, version: found.version, ...body}); assert.equal(response.status, 200, what + ': ' + response.text.slice(0, 160)); };
    await advance('cs', {action: 'submit', outcome: 'wants_visit', note: 'العميل يطلب زيارة', nextDate: day}, 'customer service submits its contact for approval');
    assert.deepEqual(await (async () => { const found = await current('cs'); return [found.state, found.stage, found.awaiting]; })(), ['submitted', 'review', null], 'and sees it wait for its manager');
    assert.deepEqual(await (async () => { const found = await current('csm'); return [found.awaiting, found.permissions.forward]; })(), ['review', true], 'the manager has it to approve');
    await advance('csm', {action: 'forward', targetId: 'mgr'}, 'the customer-service manager approves it to the sales manager');
    await advance('mgr', {action: 'allocate', targetId: 'rep1', note: 'يرجى زيارة العميل'}, 'the sales manager assigns the representative');
    assert.equal((await current('rep1')).awaiting, 'resolve', 'the representative is asked to contact the customer');
    await advance('rep1', {action: 'resolve', channel: 'visit', outcome: 'reached_interested', note: 'زرت العميل'}, 'the representative records the visit');
    assert.equal((await current('cs')).awaiting, 'close', 'customer service has it to close');
    await advance('cs', {action: 'close', note: 'تم التأكد من العميل'}, 'customer service closes it');
    const answer = await current('rep1');
    assert.deepEqual([answer.state, answer.awaiting, answer.result.outcome, answer.result.nextDate, answer.resolution.channel], ['done', 'answer', 'wants_visit', day, 'visit'], 'the representative reads the answer');
    assert.equal((await post(calls.rep1, {action: 'seen', id: requestId, version: answer.version})).status, 200, 'and opens it');
    assert.equal((await support(calls.rep1)).counts.badge, 0, 'which clears the count');
    // A visit that went unanswered, two days past its follow-up date, is customer service's to contact. It must be the customer's
    // latest visit (the fixtures already gave this customer one dated today), so it is stamped now; only its follow-up date is old.
    {
      const db = new DatabaseSync(a.settings.YR_DATABASE_PATH), at = new Date().toISOString(), due = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Riyadh'}).format(new Date(Date.now() - 5 * 86400000));
      db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('v-missed','activity',?,'repw','الرئيسي',?,?,?,1,'rehearsal')").run(customers.w1, JSON.stringify({type: 'visit', date: day, startedAt: at, endedAt: at, summary: 'PRIVATE-VISIT-SUMMARY', result: 'سلبية', salesStage: 'new', nextAction: 'زيارة متابعة', nextDate: due, visitWorkflow: 'customer-v1', performedBy: 'repw', responsibleId: 'repw', recordedByEmail: 'repw@yourrest.org'}), at, at);
      db.close();
    }
    const missed = (await support(calls.cs)).missed;
    assert.deepEqual(missed.map(item => [item.customerId, item.visitId, item.overdueDays, item.permissions.take]), [[customers.w1, 'v-missed', 5, true]], 'customer service has the missed visit');
    assert.equal(JSON.stringify(await support(calls.cs)).includes('PRIVATE-'), false, 'without the visit text');
    for (const who of ['rep1', 'repw', 'sup', 'mgr']) assert.deepEqual((await support(calls[who])).missed, [], who + ' receives no missed visits');
    const took = await post(calls.cs, {action: 'request', origin: 'missed_visit', customerId: customers.w1, customerVersion: missed[0].customerVersion, visitId: 'v-missed'});
    assert.equal(took.status, 200, 'customer service takes it: ' + took.text.slice(0, 120));
    assert.deepEqual([(await support(calls.cs)).missed.length, (await support(calls.repw)).requests.map(item => item.state)], [0, ['in_progress']], 'it leaves the list and the representative sees customer service has it');
    // Nothing of it reached the records, the cases or the visits.
    const crm = (await owner('/api/crm')).json();
    assert.equal(crm.records.some(record => record.kind === 'support') || JSON.stringify(crm.audits).includes('support'), false, 'the administrator\'s records and history carry no assistance request');
    assert.deepEqual((await owner('/api/customer-service')).json().cases, [], 'and no customer-service case was made');
    // The customer-service manager sees what waits for his approval, and the representative registering it sees none.
    const serviceRegistration = {type: 'call', summary: 'PRIVATE-REGISTRATION-SUMMARY', result: 'متابعة العميل', salesStage: 'new', strength: 'strong', requestedProducts: [products[0]], nextAction: 'اتصال بالعميل', nextDate: day, location: '26.437341, 50.034499', locationSource: 'device', locationCapturedAt: new Date().toISOString(), locationAccuracy: 12, customerNeeds: 'قالب جديد', hasCompetitor: false};
    const registered = await calls.cs('/api/customer-service', {method: 'POST', body: {action: 'create', requestId: crypto.randomUUID(), customerId: customers.e1, customerVersion: versionOf(customers.e1), registration: serviceRegistration, elapsedMilliseconds: 2200}});
    assert.equal(registered.status, 200, 'customer service registers a request while an assistance request exists for the same customer: ' + registered.text.slice(0, 120));
    const queueOf = async call => (await call('/api/crm')).json().serviceQueue;
    const waitingForHim = await queueOf(calls.csm);
    assert.deepEqual([waitingForHim.length, waitingForHim[0].stage, waitingForHim[0].awaiting, waitingForHim[0].late], [1, 'approval', 'approve', false], 'the customer-service manager is shown the approval that waits for him');
    assert.deepEqual([(await queueOf(calls.cs)).length, (await queueOf(calls.rep1)).length], [0, 0], 'the registrar and the representative have none');
    note('assistance requests, missed visits and the manager\'s approval queue work on the upgraded database for the right roles', {request: requestId});
  }

  if (helper.EXTRA_ROUTES.some(([route]) => route === '/api/complaints')) {
    // A customer complaint runs its whole course on the upgraded database, for the right people only.
    const calls = {};
    for (const who of ['csm', 'cs', 'mgr', 'sup', 'rep1', 'repw']) calls[who] = await a.login(who);
    const readDb = (sql, ...args) => { const db = new DatabaseSync(a.settings.YR_DATABASE_PATH, {readOnly: true}); try { return db.prepare(sql).get(...args); } finally { db.close(); } };
    const versionOf = id => readDb('SELECT version FROM crm_records WHERE id=?', id).version;
    const complaints = async call => (await call('/api/complaints')).json();
    const post = (call, body) => call('/api/complaints', {method: 'POST', body: {requestId: crypto.randomUUID(), ...body}});
    const act = (call, id, body) => post(call, {id, version: versionOf(id), ...body});
    const report = {channel: 'call', category: 'product_quality', severity: 'high', description: 'القالب يخرج منتجًا مكسورًا من جهة واحدة', demand: 'استبدال القالب', reference: 'INV-1'};
    assert.equal((await a.request('/api/complaints')).status, 401, 'an anonymous caller is refused');
    for (const who of ['csm', 'cs', 'mgr', 'sup', 'rep1', 'repw']) assert.deepEqual((await complaints(calls[who])).complaints, [], who + ' starts with no complaint');
    assert.equal((await post(calls.rep1, {action: 'register', customerId: customers.e1, customerVersion: versionOf(customers.e1), ...report})).status, 403, 'sales does not register complaints');
    const registered = await post(calls.cs, {action: 'register', customerId: customers.e1, customerVersion: versionOf(customers.e1), ...report});
    assert.equal(registered.status, 200, 'customer service registers a complaint on the upgraded database: ' + registered.text.slice(0, 120));
    const complaintId = registered.json().id, row = () => JSON.parse(readDb('SELECT data FROM crm_records WHERE id=?', complaintId).data);
    const shape = readDb('SELECT kind,parent_id FROM crm_records WHERE id=?', complaintId);
    assert.deepEqual([row().status, row().serviceManagerId, shape.kind, shape.parent_id], ['submitted', 'csm', 'complaint', null], 'stored as its own kind with no parent, waiting for the manager');
    const ids = async who => (await complaints(calls[who])).complaints.map(item => item.id);
    assert.deepEqual([await ids('cs'), await ids('csm'), await ids('mgr'), await ids('rep1'), await ids('repw')], [[complaintId], [complaintId], [], [], []], 'customer service and its manager see it; sales not yet');
    assert.equal((await complaints(calls.csm)).counts.badge, 1, 'the manager is asked to review it');
    assert.equal((await act(calls.csm, complaintId, {action: 'forward', targetId: 'mgr'})).status, 200, 'the manager hands it to the sales manager');
    const toAssign = (await complaints(calls.mgr)).complaints[0];
    assert.deepEqual([toAssign.awaiting, toAssign.suggestedId], ['assign', 'rep1'], 'the sales manager is asked to assign it, the customer\'s representative suggested');
    assert.equal((await act(calls.mgr, complaintId, {action: 'assign', targetId: 'rep1', note: 'تابعه اليوم'})).status, 200, 'he assigns it');
    assert.deepEqual([await ids('rep1'), await ids('sup'), await ids('repw')], [[complaintId], [complaintId], []], 'the representative and his supervisor see it; the western one does not');
    assert.equal((await act(calls.rep1, complaintId, {action: 'update', channel: 'visit', text: 'زرت المصنع وفحصت القالب', date: day})).status, 200, 'the representative records his contact');
    assert.equal((await act(calls.rep1, complaintId, {action: 'resolve', outcome: 'solved', note: 'استُبدل القالب'})).status, 200, 'and the resolution');
    assert.equal((await complaints(calls.cs)).complaints[0].awaiting, 'close', 'customer service is asked to confirm the closure');
    assert.equal((await act(calls.cs, complaintId, {action: 'close', outcome: 'satisfied', rating: 4, note: 'أكد العميل'})).status, 200, 'and closes it, with the customer\'s rating');
    assert.deepEqual([row().status, row().events.map(event => event.action)], ['closed', ['register', 'forward', 'assign', 'resolve', 'close']], 'closed with its story');
    // Nothing of it reached the records, the cases, the assistance or the visits.
    const crm = (await owner('/api/crm')).json();
    assert.equal(crm.records.some(record => record.kind === 'complaint') || JSON.stringify(crm.audits).includes('complaint'), false, 'the administrator\'s records and history carry no complaint');
    assert.equal((await owner('/api/customer-service')).json().cases.some(item => String(item.id).startsWith('complaint')), false, 'no customer-service case was made of it');
    note('a customer complaint runs its whole course on the upgraded database for the right roles', {complaint: complaintId});
    if (helper.EXTRA_ROUTES.some(([route]) => route === '/api/complaint-report')) {
      // The monthly report counts what just happened, for the managers only.
      assert.equal((await a.request('/api/complaint-report')).status, 401, 'an anonymous caller is refused the report');
      assert.deepEqual([(await calls.rep1('/api/complaint-report')).status, (await calls.sup('/api/complaint-report')).status, (await calls.cs('/api/complaint-report')).status], [403, 403, 403], 'the representative, the supervisor and customer service are refused the report');
      const monthly = (await calls.csm('/api/complaint-report')).json(), sales = (await calls.mgr('/api/complaint-report')).json();
      assert.deepEqual([monthly.total, monthly.closed, monthly.satisfied, monthly.satisfactionRate, monthly.closureOutcomes, monthly.timing.review.n, monthly.timing.closure.n], [1, 1, 1, 100, [{key: 'satisfied', count: 1}], 1, 1], 'the customer-service manager\'s report counts the closed, satisfied complaint of this month: ' + JSON.stringify(monthly).slice(0, 200));
      assert.deepEqual([sales.total, sales.closed, sales.byCategory.map(row => row.key)], [1, 1, ['product_quality']], 'the sales manager\'s report counts it too');
      assert.equal(/مصنع|القالب|INV-|complaint-/.test(JSON.stringify(monthly) + JSON.stringify(sales)), false, 'and neither carries a customer, a text, a reference or an identifier');
      note('the monthly complaints report counts the complaint for the managers only', {total: monthly.total});
    }
    if (helper.EXTRA_ROUTES.some(([route]) => route === '/api/service-kpi')) {
      // The customer-service evaluation counts what just happened (the closure, its rating, the registration), takes an audit and the settings, for the right roles only.
      assert.equal((await a.request('/api/service-kpi')).status, 401, 'an anonymous caller is refused the evaluation');
      assert.deepEqual([(await calls.rep1('/api/service-kpi')).status, (await calls.sup('/api/service-kpi')).status, (await calls.mgr('/api/service-kpi')).status], [403, 403, 403], 'the representative, the supervisor and the sales manager are refused the evaluation');
      const evaluation = (await calls.csm('/api/service-kpi')).json(), mine = (await calls.cs('/api/service-kpi')).json();
      const cardOf = answer => answer.groups.flatMap(group => group.reps).find(item => item.memberId === 'cs');
      const figure = (answer, key) => cardOf(answer).metrics.find(item => item.key === key);
      const pair = (answer, key) => [figure(answer, key).numerator, figure(answer, key).denominator];
      assert.deepEqual([evaluation.groups.map(group => group.managerId), pair(evaluation, 'customer_rating'), pair(evaluation, 'registration_accuracy'), figure(evaluation, 'closure_timing').denominator], [['csm'], [4, 1], [1, 1], 1], 'the manager\'s evaluation counts the closure, the customer\'s 4 and the first-time review of the complaint: ' + JSON.stringify(evaluation.groups.map(group => group.reps.map(item => item.metrics.map(metric => [metric.key, metric.numerator, metric.denominator])))));
      assert.deepEqual([mine.groups.length, mine.groups[0].reps.map(item => item.memberId), mine.groups[0].manager], [1, ['cs'], null], 'a representative gets only their own card');
      const audit = await calls.csm('/api/service-kpi', {method: 'POST', body: {requestId: crypto.randomUUID(), action: 'audit', repId: 'cs', month: evaluation.month, scores: {greeting: 10, understanding: 15, accuracy: 20, ownership: 15, communication: 15, resolution: 15, closing: 10}, note: 'أداء ممتاز'}});
      assert.equal(audit.status, 200, 'the manager records a quality audit on the upgraded database: ' + audit.text.slice(0, 120));
      assert.deepEqual(pair((await calls.csm('/api/service-kpi')).json(), 'audit_quality'), [100, 1], 'and the figure follows');
      assert.equal((await calls.csm('/api/service-kpi', {method: 'POST', body: {requestId: crypto.randomUUID(), action: 'settings', version: evaluation.settingsVersion, settings: evaluation.settings}})).status, 403, 'a manager cannot change the settings');
      const saved = await owner('/api/service-kpi', {method: 'POST', body: {requestId: crypto.randomUUID(), action: 'settings', version: evaluation.settingsVersion, settings: evaluation.settings}});
      assert.equal(saved.status, 200, 'the administrator can: ' + saved.text.slice(0, 120));
      assert.equal((await calls.csm('/api/service-kpi', {method: 'POST', body: {requestId: crypto.randomUUID(), action: 'close_month', month: evaluation.month, managerId: 'csm'}})).status, 400, 'the running month cannot be closed');
      const afterCrm = (await owner('/api/crm')).json();
      assert.equal(afterCrm.records.some(record => ['service_audit', 'service_kpi_month', 'service_kpi_settings'].includes(record.kind)) || /service-kpi/.test(JSON.stringify(afterCrm.audits)), false, 'the administrator\'s records and history carry no audit, setting or receipt');
      note('the customer-service evaluation counts the closure, its rating and the registration, takes an audit and the settings, for the right roles only', {month: evaluation.month});
    }
  }

  // Command-line wiring of the activator (the hosting home is fixed at /home/youriedx, which does not exist here).
  const cli = spawnSync(process.execPath, [path.join(stageA, helperName), '--bogus'], {encoding: 'utf8'});
  assert.equal(cli.status, 1); assert.match(cli.stderr, /Usage: node .*\.cjs \[--check\|--verify\]/);
  const missingHome = spawnSync(process.execPath, [path.join(stageA, helperName), '--check'], {encoding: 'utf8'});
  assert.equal(missingHome.status, 1); assert.match(missingHome.stderr, /^STOP: [A-Z0-9_]+/m);
  note('command-line usage and failure output behave as the guide describes');
  await a.stop();

  // ── Going back after the migration (guide, case B) ─────────────────────────────────────────
  // The previous release must refuse the migrated database, and restoring the private schema backup plus the previous
  // release must bring back exactly the state before the update. The steps below are the ones the guide gives.
  if (helper.NEW_MIGRATIONS.length) {
    const previousRelease = path.join(state.transaction, 'old-release');
    fs.renameSync(path.join(a.app, 'release'), path.join(a.app, 'release-failed-' + helper.RELEASE_DATE));
    fs.renameSync(previousRelease, path.join(a.app, 'release'));
    assert.equal(treeHash(path.join(a.app, 'release')), baseline.oldRelease, 'the restored release is byte-identical to the one that was installed');
    let oldRefusal = '';
    try { await a.start(); } catch (error) { oldRefusal = String(error.message); }
    assert.match(oldRefusal, /newer than/, 'the previous release refuses a database that carries a newer migration');
    assert.equal(a.running, false);
    const walFiles = fs.readdirSync(a.data).filter(name => /^database\.sqlite-(wal|shm)$/.test(name));
    const schemaBackup = fs.readdirSync(path.join(a.data, 'schema-backups')).find(name => name.startsWith('before-' + helper.NEW_MIGRATIONS[0].replace(/\.sql$/, '') + '-'));
    for (const name of ['database.sqlite', ...walFiles]) fs.renameSync(path.join(a.data, name), path.join(a.data, name + '.migrated-' + helper.RELEASE_DATE));
    fs.copyFileSync(path.join(a.data, 'schema-backups', schemaBackup), path.join(a.data, 'database.sqlite'));
    fs.chmodSync(path.join(a.data, 'database.sqlite'), 0o600);
    await a.start();
    assert.deepEqual(tables(a), dataBeforeSwitch, 'after restoring the schema backup every table, and the migration ledger, equal their state before the update');
    const restoredDb = new DatabaseSync(a.settings.YR_DATABASE_PATH, {readOnly: true});
    try { assert.equal(restoredDb.prepare('SELECT COUNT(*) n FROM yr_schema_migrations').get().n, helper.SCHEMA_BEFORE); assert.equal(restoredDb.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='crm_member_devices'").get().n, 0); } finally { restoredDb.close(); }
    const restored = await views();
    const drift = [];
    for (const who of ['owner', 'mgr', 'sup', 'rep1', 'repw']) for (const part of Object.keys(before[who])) if (stable(before[who][part]) !== stable(restored[who][part])) drift.push(who + '.' + part);
    if (stable(before.file) !== stable(restored.file)) drift.push('file');
    assert.deepEqual(drift, [], 'every role sees what it saw before the update');
    assert.equal(restored.anonymousDeviceStatus, 404, 'the previous release has no device-status route again');
    note('going back after the migration works: the previous release refuses the migrated database; restoring the private schema backup and the previous release returns the exact earlier state', {walFilesMovedAside: walFiles, oldReleaseRefusal: (/Existing migration history[^\n]*/.exec(oldRefusal) || [''])[0].slice(0, 200)});
    await a.stop();
  } else {
    // Nothing in the database changed shape, so going back is only the release: the previous one must run on the data the
    // new one wrote, including a request in the new form. The steps below are the ones the guide gives.
    const previousRelease = path.join(state.transaction, 'old-release');
    fs.renameSync(path.join(a.app, 'release'), path.join(a.app, 'release-failed-' + helper.RELEASE_DATE));
    fs.renameSync(previousRelease, path.join(a.app, 'release'));
    assert.equal(treeHash(path.join(a.app, 'release')), baseline.oldRelease, 'the restored release is byte-identical to the one that was installed');
    await a.start();
    const restored = {};
    for (const who of ['owner', 'mgr', 'sup', 'rep1', 'repw']) {
      const call = await a.login(who);
      const crm = await call('/api/crm'), cases = await call('/api/customer-service');
      assert.deepEqual([who, crm.status, cases.status], [who, 200, 200], 'the previous release serves ' + who + ' on the same database');
      restored[who] = {crm: crm.json(), cases: cases.json().cases};
    }
    const queueIntroduced = introducedRoute('/api/service-queue/alerts'), supportIntroduced = introducedRoute('/api/support'), complaintsIntroduced = introducedRoute('/api/complaints'), supportCarried = helper.EXTRA_ROUTES.some(([route]) => route === '/api/support') && !supportIntroduced, complaintsCarried = helper.EXTRA_ROUTES.some(([route]) => route === '/api/complaints') && !complaintsIntroduced, reportIntroduced = introducedRoute('/api/complaint-report');
    if (queueIntroduced) assert.equal(restored.owner.crm.serviceQueue, undefined, 'the previous release knows nothing of the new queue field');
    else assert(Array.isArray(restored.owner.crm.serviceQueue), 'the previous release already has the queue field');
    // The administrator's case: the request customer service registered during the new release's use (the assistance block); the manager and the representative have no case yet.
    const expectedCases = queueIntroduced ? {owner: 1, mgr: 1, rep1: 1} : supportIntroduced || supportCarried ? {owner: 1, mgr: 0, rep1: 0} : {owner: 0, mgr: 0, rep1: 0};
    for (const who of ['owner', 'mgr', 'rep1']) assert.equal(restored[who].cases.length, expectedCases[who], who + ' sees what the new release recorded, as before');
    let supportAuditLines = null;
    if (supportIntroduced) {
      // Assistance requests are records of a kind the previous release does not know: it serves everyone on them, they are no case and no visit, and nobody but the administrator's raw record list could carry them.
      const supportRows = (() => { const db = new DatabaseSync(a.settings.YR_DATABASE_PATH, {readOnly: true}); try { return db.prepare("SELECT COUNT(*) n FROM crm_records WHERE kind='support'").get().n; } finally { db.close(); } })();
      assert(supportRows >= 2, 'the database still holds the assistance requests the new release wrote');
      assert.deepEqual(['mgr', 'sup', 'rep1', 'repw'].map(who => restored[who].crm.records.filter(record => record.kind === 'support').length), [0, 0, 0, 0], 'no one but the administrator\'s raw record list could carry them');
      assert.equal(restored.owner.cases.some(item => String(item.id).startsWith('support-')), false, 'they are not customer-service cases');
      assert.equal((await a.request('/api/support')).status, 404, 'the new route is gone again with the new release');
      // Recorded, not judged: the previous release has no rule to leave the assistance audit lines out of the administrator's history.
      supportAuditLines = (restored.owner.crm.audits || []).filter(item => /^support/.test(String(item.action))).length;
    }
    if (supportCarried) {
      // The previous release already knows assistance requests: it serves the route again, shows the ones the new release moved along the course as plain requests in hand, and they stay out of every record list and every case.
      assert.equal((await a.request('/api/support')).status, 401, 'the previous release still serves the assistance route');
      const list = (await (await a.login('csm'))('/api/support')).json();
      assert(list.requests.length >= 1, 'the customer-service manager still sees the requests written on the new release');
      assert.deepEqual(['mgr', 'sup', 'rep1', 'repw'].map(who => restored[who].crm.records.filter(record => record.kind === 'support').length), [0, 0, 0, 0], 'and they are in nobody\'s record list');
      assert.equal(restored.owner.cases.some(item => String(item.id).startsWith('support-')), false, 'nor in the cases');
    }
    if (complaintsIntroduced) {
      // Complaints are records of a kind the previous release does not know: it serves everyone on them, and nobody but the administrator's raw record list could carry them.
      const complaintRows = (() => { const db = new DatabaseSync(a.settings.YR_DATABASE_PATH, {readOnly: true}); try { return db.prepare("SELECT COUNT(*) n FROM crm_records WHERE kind='complaint'").get().n; } finally { db.close(); } })();
      assert(complaintRows >= 1, 'the database still holds the complaint the new release wrote');
      assert.deepEqual(['mgr', 'sup', 'rep1', 'repw'].map(who => restored[who].crm.records.filter(record => record.kind === 'complaint').length), [0, 0, 0, 0], 'no one but the administrator\'s raw record list could carry it');
      assert.equal((await a.request('/api/complaints')).status, 404, 'the complaints route is gone again with the new release');
    }
    if (complaintsCarried) {
      // The previous release already knows complaints: the one the new release wrote is served to the right people again, and hidden from the rest as before.
      assert.equal((await a.request('/api/complaints')).status, 401, 'the previous release still serves the complaints route');
      const list = (await (await a.login('csm'))('/api/complaints')).json();
      assert.equal(list.complaints.filter(item => item.status === 'closed').length, 1, 'the customer-service manager sees the complaint closed on the new release');
      assert.deepEqual(['mgr', 'sup', 'rep1', 'repw'].map(who => restored[who].crm.records.filter(record => record.kind === 'complaint').length), [0, 0, 0, 0], 'and it is in nobody\'s record list');
    }
    if (reportIntroduced) assert.equal((await a.request('/api/complaint-report')).status, 404, 'the report route is gone again with the new release');
    if (introducedRoute('/api/service-kpi')) {
      // The evaluation's rows are records of kinds the previous release does not know: it serves everyone on them, and nobody but the administrator's raw record list could carry them.
      const kpiRows = (() => { const db = new DatabaseSync(a.settings.YR_DATABASE_PATH, {readOnly: true}); try { return db.prepare("SELECT COUNT(*) n FROM crm_records WHERE kind IN ('service_audit','service_kpi_settings')").get().n; } finally { db.close(); } })();
      assert(kpiRows >= 2, 'the database still holds the audit and the settings the new release wrote');
      assert.deepEqual(['mgr', 'sup', 'rep1', 'repw'].map(who => restored[who].crm.records.filter(record => ['service_audit', 'service_kpi_month', 'service_kpi_settings'].includes(record.kind)).length), [0, 0, 0, 0], 'no one but the administrator\'s raw record list could carry them');
      assert.equal((await a.request('/api/service-kpi')).status, 404, 'the evaluation route is gone again with the new release');
    }
    if (queueIntroduced) {
      assert.equal(restored.rep1.cases[0].status, 'assigned', 'it keeps its status');
      assert.equal(restored.repw.cases.length, 0, 'and stays hidden from others');
      assert.equal((await a.request('/api/service-queue/alerts')).status, 404, 'the new routes are gone again with the new release');
    }
    const back = await views();
    assert.deepEqual(['owner', 'mgr', 'sup', 'rep1', 'repw'].map(who => (back[who].crm.records || []).filter(record => record.kind === 'customer').length), ['owner', 'mgr', 'sup', 'rep1', 'repw'].map(who => (before[who].crm.records || []).filter(record => record.kind === 'customer').length), 'every role still sees the same customers');
    assert.equal(stable(back.file), stable(before.file), 'the attachment is intact');
    note('going back after use works with no database step: the previous release returns and serves every role from the database the new release wrote to', {restoredStatuses: Object.keys(restored).length, ...(supportAuditLines === null ? {} : {assistanceAuditLinesInTheAdministratorsHistoryOfThePreviousRelease: supportAuditLines})});
    await a.stop();
  }
  a.close();

  // ── Going back before the first start (guide, case A) ──────────────────────────────────────
  {
    const c = await installSite(work, 'home-c', {exactOrigin: true});
    sites.push(c);
    const stageC = path.join(c.home, stageName);
    fs.mkdirSync(stageC, {mode: 0o700});
    execFileSync('python3', ['-c', 'import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', packageZip, stageC]);
    const helperC = require(path.join(stageC, helperName)), pathsC = helperC.pathsFor(c.home);
    await c.start();
    const installedRelease = treeHash(path.join(c.app, 'release')), installedData = tables(c);
    await c.stop();
    const switched = await helperC.run(pathsC, 'apply', {log: () => {}});
    assert.equal(switched.phase, 'switched');
    assert.notEqual(treeHash(path.join(c.app, 'release')), installedRelease);
    fs.renameSync(path.join(c.app, 'release'), path.join(c.app, 'release-failed-' + helper.RELEASE_DATE));
    fs.renameSync(path.join(switched.transaction, 'old-release'), path.join(c.app, 'release'));
    assert.equal(treeHash(path.join(c.app, 'release')), installedRelease, 'the previous release is back, byte for byte');
    await c.start();
    assert.deepEqual(tables(c), installedData, 'the database was never touched');
    note('going back before the first start works: the previous release returns and runs on the untouched database');
    await c.stop();
    c.close();
  }

  // ── Site B: a damaged package is refused and the live release is untouched ──────────────────
  const b = await installSite(work, 'home-b');
  sites.push(b);
  const stageB = path.join(b.home, stageName);
  fs.mkdirSync(stageB, {mode: 0o700});
  execFileSync('python3', ['-c', 'import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', packageZip, stageB]);
  const helperB = require(path.join(stageB, helperName));
  const pathsB = helperB.pathsFor(b.home);
  const liveBefore = treeHash(path.join(b.app, 'release')), dataB = tables(b);
  fs.appendFileSync(path.join(stageB, 'release', 'server.js'), '\n// tampered\n');
  for (const mode of ['check', 'apply']) {
    let code;
    try { await helperB.run(pathsB, mode, {log: () => {}}); } catch (error) { code = error.code; }
    assert.equal(code, 'RELEASE_CHECKSUM_MISMATCH', mode + ' refuses a modified file');
  }
  assert.equal(treeHash(path.join(b.app, 'release')), liveBefore, 'the live release is untouched');
  assert.deepEqual(tables(b), dataB, 'the data is untouched');
  assert.equal(fs.existsSync(pathsB.state), false, 'no activation state was written');
  note('a tampered package is refused by --check and by the switch; live release, data and state unchanged', {code: 'RELEASE_CHECKSUM_MISMATCH'});

  report.ok = true;
  report.steps = steps;
} catch (error) {
  report.ok = false;
  report.steps = steps;
  report.failure = String(error?.stack || error).split('\n').slice(0, 6).join('\n');
  console.error('REHEARSAL FAILED: ' + report.failure);
  process.exitCode = 1;
} finally {
  for (const site of sites) { await site.stop?.().catch(() => {}); site.close?.(); }
  if (argv.includes('--keep')) report.keptAt = work; else fs.rmSync(work, {recursive: true, force: true});
  const out = option('--out');
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ok: report.ok, steps: steps.length, packageSha256: report.packageSha256}));
  // Keep-alive sockets from the verification fetches would otherwise hold the process open.
  process.exit(report.ok ? 0 : 1);
}
