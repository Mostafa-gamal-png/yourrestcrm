// Boots the BUILT release (dist/standalone) against a throwaway SQLite database,
// a fake sendmail and, optionally, a self-signed HTTPS front for real browsers.
// Only temporary directories are written. No production data, DNS or mailbox is used.
import {spawn, execFileSync} from 'node:child_process';
import {request as httpRequest} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {mkdtemp, mkdir, readFile, readdir, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash, randomBytes} from 'node:crypto';
import {sqliteDatabase} from '../../portable/storage.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const freePort = async () => {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const {port} = probe.address();
  await new Promise(resolve => probe.close(resolve));
  return port;
};

/**
 * @param {{members: {id: string, role: string, sup?: string, region?: string, branch?: string, name?: string}[]}} seed
 * @param {{tls?: boolean}} options tls=true fronts the app with HTTPS on crm.yourrest.org:<port>
 */
export async function bootBuiltApp(seed, {tls = false} = {}) {
  const work = await mkdtemp(path.join(os.tmpdir(), 'yourrest-built-'));
  const data = path.join(work, 'data'), objects = path.join(data, 'objects'), filename = path.join(data, 'database.sqlite');
  await mkdir(objects, {recursive: true, mode: 0o700});
  const db = sqliteDatabase(filename, {create: true});
  await db.exec('CREATE TABLE yr_schema_migrations(name TEXT PRIMARY KEY NOT NULL,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)');
  for (const name of (await readdir(path.join(root, 'drizzle'))).filter(file => /^\d+.*\.sql$/.test(file)).sort()) {
    const source = await readFile(path.join(root, 'drizzle', name), 'utf8');
    await db.exec(source);
    await db.prepare('INSERT INTO yr_schema_migrations VALUES(?,?,?)').bind(name, createHash('sha256').update(source).digest('hex'), new Date().toISOString()).run();
  }
  await db.prepare('INSERT INTO crm_settings(id,owner_id) VALUES(?,?)').bind('company', 'opaque-owner').run();
  const created = new Date().toISOString();
  for (const member of seed.members) {
    await db.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,active,target,created_at,region_scope) VALUES(?,?,?,?,?,?,?,1,0,?,?)')
      .bind(member.id, 'opaque-' + member.id, member.id.toLowerCase() + '@yourrest.org', member.name || member.id, member.role, member.branch || 'الرئيسي', member.sup || null, created, member.region || 'all').run();
  }
  const capture = path.join(work, 'mail.jsonl'), sendmail = path.join(work, 'sendmail.cjs');
  await writeFile(sendmail, '#!' + process.execPath + '\n' + `const fs=require('node:fs');let m='';process.stdin.on('data',b=>m+=b);process.stdin.on('end',()=>fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify({to:process.argv.at(-1),message:m})+'\\n',{mode:0o600}));`, {mode: 0o700});

  const backendPort = await freePort(), tlsPort = tls ? await freePort() : 0;
  const origin = tls ? 'https://crm.yourrest.org:' + tlsPort : 'https://crm.yourrest.org', host = new URL(origin).host;
  let log = '', proxy;
  const child = spawn(process.execPath, ['app.cjs'], {
    cwd: path.join(root, 'dist/standalone'),
    env: {PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(backendPort), HOST: '127.0.0.1', YR_APP_ORIGIN: origin, YR_AUTH_SECRET: randomBytes(32).toString('hex'), YR_NATIONAL_ADDRESS_API_KEY: '', YR_DATABASE_PATH: filename, YR_OBJECTS_PATH: objects, YR_MAIL_TRANSPORT: 'sendmail', YR_MAIL_FROM: 'noreply@yourrest.org', YR_SENDMAIL_PATH: sendmail},
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', chunk => log += chunk);
  child.stderr.on('data', chunk => log += chunk);

  if (tls) {
    const key = path.join(work, 'key.pem'), cert = path.join(work, 'cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], {stdio: 'ignore'});
    proxy = createHttpsServer({key: await readFile(key), cert: await readFile(cert)}, (incoming, outgoing) => {
      const forwarded = httpRequest({host: '127.0.0.1', port: backendPort, path: incoming.url, method: incoming.method, headers: {...incoming.headers, host, 'x-forwarded-proto': 'https'}}, response => { outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing); });
      forwarded.on('error', () => { outgoing.writeHead(502); outgoing.end('Isolated backend is starting'); });
      incoming.pipe(forwarded);
    });
    proxy.listen(tlsPort, '127.0.0.1');
    await once(proxy, 'listening');
  }

  function request(url, options = {}) {
    let body = options.body;
    const headers = {Host: host, 'X-Forwarded-Proto': 'https', ...options.headers};
    if (body !== undefined && !Buffer.isBuffer(body) && typeof body !== 'string') { body = Buffer.from(JSON.stringify(body)); headers['Content-Type'] = 'application/json'; }
    if (body !== undefined) headers['Content-Length'] = String(Buffer.byteLength(body));
    return new Promise((resolve, reject) => {
      const req = httpRequest({host: '127.0.0.1', port: backendPort, path: url, method: options.method || 'GET', headers, timeout: 20000}, res => {
        const parts = [];
        res.on('data', part => parts.push(part));
        res.on('end', () => { const bytes = Buffer.concat(parts), text = bytes.toString('utf8'); resolve({status: res.statusCode, headers: res.headers, bytes, text, json: () => JSON.parse(text)}); });
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(Error('Request timed out: ' + url)));
      if (body !== undefined) req.write(body);
      req.end();
    });
  }
  for (let attempt = 0; ; attempt++) {
    if (child.exitCode !== null) throw Error('Release exited before listening: ' + log);
    if (attempt >= 100) throw Error('Release did not listen: ' + log);
    try { await request('/login'); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }

  const cookieValue = (response, name) => (response.headers['set-cookie'] || []).find(cookie => cookie.startsWith(name + '='))?.split(';')[0] || '';
  /** Full OTP sign-in; returns the session cookie pair. Clears the per-address rate limit that all local callers share. */
  async function login(memberId) {
    const email = memberId.toLowerCase() + '@yourrest.org';
    await db.prepare('DELETE FROM auth_limits').run();
    const challenge = await request('/api/auth/request', {method: 'POST', headers: {Origin: origin}, body: {email}});
    if (challenge.status !== 200) throw Error('auth/request failed: ' + challenge.status);
    let delivered;
    for (let attempt = 0; attempt < 50 && !delivered; attempt++) {
      try { delivered = (await readFile(capture, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(mail => mail.to === email).at(-1); } catch { /* not written yet */ }
      if (!delivered) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!delivered) throw Error('No OTP mail captured for ' + email);
    const text = Buffer.from(delivered.message.split('\r\n\r\n')[1].replaceAll('\r\n', ''), 'base64').toString('utf8');
    const verified = await request('/api/auth/verify', {method: 'POST', headers: {Origin: origin, Cookie: cookieValue(challenge, '__Host-yourrest_challenge')}, body: {code: text.match(/\b\d{6}\b/)[0], return_to: '/'}});
    if (verified.status !== 200) throw Error('auth/verify failed: ' + verified.status);
    return cookieValue(verified, '__Host-yourrest_session');
  }
  /** A request function bound to a session cookie (or anonymous when cookie is falsy). */
  const as = cookie => (url, options = {}) => request(url, {...options, headers: {Origin: origin, ...(cookie ? {Cookie: cookie} : {}), ...options.headers}});

  return {origin, db, request, login, as, log: () => log, async stop() { child.kill(); proxy?.close(); await rm(work, {recursive: true, force: true}); }};
}
