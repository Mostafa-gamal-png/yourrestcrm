// Going back from «صور القالب» (2026-11-19) to the release live before it (update-orders-20261119, commit 2845102), as
// docs/OPERATIONS-DEVELOPMENT-GUIDE-AR.md 9-أه «الرجوع إلى الإصدار السابق» says, without a build: one database for both releases' real
// handlers. This release writes photos (rows of crm_visit_files under mold-photo-, their bytes in the object store) and their history
// lines; the previous release, on the same data: has no /api/mold-photos, keeps every row and byte through a customer's edit, lists none
// (GET /api/crm carries no photo, only the history lines as written), serves one only to whoever knows its id through its
// /api/visit-files?id= (a download, by the competitors' offers' rule: the administrator, the uploader and his team; not another
// representative), and its backup copies the photos and its restore gives them back. Coming forward again shows them as they were. The
// previous release's sources come from git (`git archive 2845102`), or from a tree given as the first argument. Synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';

const PREVIOUS = '2845102';
const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const work = fs.mkdtempSync(path.join(runtime, 'mold-photos-rollback-'));
const disk = fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-mold-photos-rollback-'));
process.on('exit', () => { fs.rmSync(work, {recursive: true, force: true}); fs.rmSync(disk, {recursive: true, force: true}); });
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

let previous = process.argv[2] ? path.resolve(process.argv[2]) : '';
if (!previous) {
  previous = path.join(work, 'previous');
  fs.mkdirSync(previous);
  const archive = execFileSync('git', ['archive', '--format=tar', PREVIOUS, 'lib', 'app', 'drizzle', 'portable', 'components', 'hooks'], {cwd: root, maxBuffer: 256 * 1024 * 1024});
  execFileSync('tar', ['-x', '-C', previous], {input: archive});
}
ok(fs.existsSync(path.join(previous, 'app/api/crm/route.ts')), 'the previous release\'s sources');
const migrations = tree => fs.readdirSync(path.join(tree, 'drizzle')).filter(name => name.endsWith('.sql')).sort();
eq(migrations(previous), migrations(root), 'no migration between the two releases: going back is the code only');
eq([fs.existsSync(path.join(previous, 'app/api/mold-photos')), fs.existsSync(path.join(previous, 'lib/mold-photos.ts'))], [false, false], 'the previous release has no mold photos route nor rules');

const objects = new Map();
globalThis.testEnv = {YR_APP_ORIGIN: 'https://test.invalid', FILES: {async put(key, value) { objects.set(key, new Uint8Array(value)); return {key}; }, async get(key) { const bytes = objects.get(key); return bytes ? {body: bytes, size: bytes.length} : null; }, async delete(key) { for (const k of Array.isArray(key) ? key : [key]) objects.delete(k); }}};
function loader(tree, name) {
  const out = path.join(work, name), seen = new Set();
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'env.mjs'), 'export const env=globalThis.testEnv;');
  fs.writeFileSync(path.join(out, 'auth.mjs'), 'export async function getApplicationUser(){return globalThis.testUser;}');
  fs.writeFileSync(path.join(out, 'mold-hook.mjs'), 'export function nudgeMoldCustomers(){}export function wakeMoldRetries(){}');
  function compile(relative) {
    if (seen.has(relative)) return; seen.add(relative);
    const src = path.join(tree, relative), dest = path.join(out, relative.replace(/\.tsx?$/, '.mjs'));
    fs.mkdirSync(path.dirname(dest), {recursive: true});
    let code = ts.transpileModule(fs.readFileSync(src, 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
    code = code.replace(/from (['"])([^'"]+)\1/g, (match, q, imp) => {
      if (imp === 'cloudflare:workers') return 'from ' + JSON.stringify(path.join(out, 'env.mjs'));
      if (imp === '@/app/application-auth') return 'from ' + JSON.stringify(path.join(out, 'auth.mjs'));
      if (imp === '@/lib/mold-customers-hook') return 'from ' + JSON.stringify(path.join(out, 'mold-hook.mjs'));
      if (!imp.startsWith('.') && !imp.startsWith('@/')) return match;
      let source = imp.startsWith('@/') ? imp.slice(2) : path.relative(tree, path.resolve(path.dirname(src), imp));
      if (/\.(mjs|js)$/.test(source)) return 'from ' + JSON.stringify(pathToFileURL(path.join(tree, source)).href);
      if (!/\.tsx?$/.test(source)) source += fs.existsSync(path.join(tree, source + '.ts')) ? '.ts' : '.tsx';
      compile(source); return 'from ' + JSON.stringify(path.join(out, source.replace(/\.tsx?$/, '.mjs')));
    });
    fs.writeFileSync(dest, code);
  }
  return {route: async route => { compile('app/api/' + route + '/route.ts'); return import(pathToFileURL(path.join(out, 'app/api/' + route + '/route.mjs'))); }};
}

// ---- One database, both releases.
const sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON');
for (const file of migrations(root)) sql.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8'));
class Statement { constructor(q, a = []) { this.q = q; this.a = a; } bind(...a) { return new Statement(this.q, a); } async run() { return {meta: {changes: Number(sql.prepare(this.q).run(...this.a).changes)}}; } async all() { return {results: sql.prepare(this.q).all(...this.a)}; } async first(column) { const row = sql.prepare(this.q).get(...this.a); return row ? (column === undefined ? row : row[column] ?? null) : null; } }
globalThis.testEnv.DB = {prepare: q => new Statement(q), batch: async statements => { sql.exec('BEGIN'); try { const results = []; for (const s of statements) results.push(await s.run()); sql.exec('COMMIT'); return results; } catch (e) { sql.exec('ROLLBACK'); throw e; } }};
const now = new Date().toISOString();
const member = (id, name, role, sup = null, region = 'eastern') => sql.prepare('INSERT INTO crm_members(id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,1,0,?)').run(id, id + '@yourrest.org', name, role, 'الرئيسي', sup, region, now);
member('owner', 'مدير النظام', 'admin', null, 'all'); member('mgr', 'مدير المبيعات', 'manager', null, 'all'); member('sup', 'المشرف', 'supervisor', 'mgr'); member('sup2', 'المشرف الثاني', 'supervisor', 'mgr');
member('rep', 'المندوب', 'rep', 'sup'); member('rep2', 'مندوب آخر', 'rep', 'sup2');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES('c1','customer',NULL,'rep','الرئيسي',?,?,?,1)").run(JSON.stringify({name: 'مصنع الصور', region: 'الشرقية', city: 'الدمام', branch: 'الرئيسي', assignedTo: 'rep', phone: '0551234567'}), now, now);
const user = id => { const m = id && sql.prepare('SELECT * FROM crm_members WHERE id=?').get(id); globalThis.testUser = m ? {provider: 'email-otp', memberId: id, memberVersion: m.auth_version, userId: 'u-' + id, email: m.email, fullName: m.name} : null; };
const current = loader(root, 'current'), before = loader(previous, 'previous');
const photos = await current.route('mold-photos'), photoDelete = await current.route('mold-photos/delete');
const oldCrm = await before.route('crm'), oldFiles = await before.route('visit-files');
const request = (url, init = {}) => new Request('https://test.invalid' + url, {...init, headers: {origin: 'https://test.invalid', ...(init.headers || {})}});
const jpeg = n => { const bytes = new Uint8Array(n); bytes.set([0xff, 0xd8, 0xff, 0xe0]); for (let i = 4; i < n; i++) bytes[i] = (i * 13) % 251; return bytes; };
const upload = async (who, bytes) => { user(who); const form = new FormData(); form.set('file', new File([bytes], 'x.jpg', {type: 'image/jpeg'})); const res = await photos.POST(request('/api/mold-photos?customerId=c1&key=' + crypto.randomUUID(), {method: 'POST', body: form})); const body = await res.json(); eq(res.status, 200, 'upload as ' + who + ': ' + JSON.stringify(body)); return body.photo.id; };
const photoRows = () => sql.prepare("SELECT id,object_key,size,content_type,uploaded_by,customer_id FROM crm_visit_files WHERE substr(id,1,11)='mold-photo-' ORDER BY created_at,id").all().map(row => ({...row}));

// ---- This release writes three photos and deletes one.
const first = jpeg(700), second = jpeg(900), third = jpeg(1100);
const ids = [await upload('rep', first), await upload('sup', second), await upload('rep', third)];
user('rep'); eq((await photoDelete.POST(request('/api/mold-photos/delete', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({id: ids[2]})}))).status, 200, 'this release deletes one');
const kept = photoRows();
eq([kept.length, kept.every(row => objects.has(row.object_key)), objects.size], [2, true, 2], 'two photos and their bytes');

// ---- The previous release on the same data.
user('mgr');
const page = await (await oldCrm.GET()).json();
eq(page.records.filter(record => record.kind === 'customer').map(record => record.id), ['c1'], 'its page reads the customer as before');
ok(!JSON.stringify(page.records).includes('mold-photo'), 'and nothing of a photo travels with the records');
eq(page.audits.filter(entry => entry.recordId === 'c1').map(entry => [entry.action, entry.detail]).sort(), [['إضافة صورة للقالب', 'عدد صور القالب: 1'], ['إضافة صورة للقالب', 'عدد صور القالب: 2'], ['إضافة صورة للقالب', 'عدد صور القالب: 3'], ['حذف صورة من صور القالب', 'عدد صور القالب: 2']], 'the history lines stay as written (the team\'s, for the sales manager)');
const oldFile = async (who, id) => { user(who); const res = await oldFiles.GET(request('/api/visit-files?id=' + encodeURIComponent(id))); return {status: res.status, type: res.headers.get('content-type'), disposition: res.headers.get('content-disposition') || '', bytes: res.status === 200 ? new Uint8Array(await res.arrayBuffer()) : null}; };
for (const who of ['owner', 'rep', 'sup', 'mgr']) {
  const answer = await oldFile(who, ids[0]);
  eq([answer.status, answer.type, /^attachment;/.test(answer.disposition), Buffer.from(answer.bytes).equals(Buffer.from(first))], [200, 'image/jpeg', true, true], who + ': its /api/visit-files?id= gives the photo as a download, by the competitors\' offers\' rule');
}
for (const who of ['rep2', 'sup2']) eq((await oldFile(who, ids[0])).status, 404, who + ': not the uploader\'s team, nothing');
eq((await oldFile('owner', ids[2])).status, 404, 'a photo deleted before going back is gone');
// A customer edit in the previous release leaves the photos as they are.
user('owner');
const stored = sql.prepare("SELECT * FROM crm_records WHERE id='c1'").get();
const saved = await oldCrm.POST(request('/api/crm', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({action: 'save', kind: 'customer', id: 'c1', version: stored.version, data: {...JSON.parse(stored.data), name: 'مصنع الصور المعدّل', assignedTo: 'rep', branch: 'الرئيسي'}})}));
eq(saved.status, 200, 'the previous release edits the customer: ' + JSON.stringify(await saved.clone().json()));
eq(photoRows(), kept, 'and every photo row stays');

// ---- Its backup copies the photos, its restore gives them back.
const appRoot = path.join(disk, 'application'), data = path.join(disk, 'data'), objectsPath = path.join(data, 'objects');
fs.mkdirSync(appRoot, {mode: 0o700}); fs.mkdirSync(objectsPath, {recursive: true, mode: 0o700}); fs.chmodSync(data, 0o700);
const databasePath = path.join(data, 'database.sqlite');
sql.exec('CREATE TABLE IF NOT EXISTS yr_schema_migrations(name TEXT PRIMARY KEY,sha256 TEXT,applied_at TEXT)');
for (const name of migrations(root)) sql.prepare('INSERT OR IGNORE INTO yr_schema_migrations VALUES(?,?,?)').run(name, 'x', now);
sql.exec(`VACUUM INTO '${databasePath.replaceAll("'", "''")}'`); fs.chmodSync(databasePath, 0o600);
const {privateObjects} = await import(pathToFileURL(path.join(previous, 'portable/storage.mjs')).href);
const store = privateObjects(objectsPath);
for (const [key, bytes] of objects) await store.put(key, bytes);
const oldBackup = await import(pathToFileURL(path.join(previous, 'portable/backup-core.mjs')).href);
const config = {YR_DATABASE_PATH: databasePath, YR_OBJECTS_PATH: objectsPath};
const backup = await oldBackup.createBackup({config, appRoot, destination: path.join(disk, 'backup')});
eq(backup.objects, 2, 'the previous release\'s backup copies the two photos');
const restored = path.join(disk, 'restored');
eq((await oldBackup.restoreBackup({directory: path.join(disk, 'backup'), destination: restored, appRoot})).objects, 2, 'and its restore gives them back');
const restoredDb = new DatabaseSync(path.join(restored, 'database.sqlite'), {readOnly: true});
eq(restoredDb.prepare("SELECT id FROM crm_visit_files WHERE substr(id,1,11)='mold-photo-' ORDER BY created_at,id").all().map(row => row.id), kept.map(row => row.id), 'with their rows');
restoredDb.close();

// ---- Coming forward again: the photos as they were.
user('rep2');
const list = await (await photos.GET(request('/api/mold-photos?customerId=c1'))).json();
eq(list.photos.map(photo => photo.id), kept.map(row => row.id), 'this release shows them again');
user('owner');
const image = await photos.GET(request('/api/mold-photos?id=' + ids[0]));
eq([image.status, Buffer.from(new Uint8Array(await image.arrayBuffer())).equals(Buffer.from(first))], [200, true], 'with their bytes');

// ---- The guide says so.
const guide = fs.readFileSync(path.join(root, 'docs/OPERATIONS-DEVELOPMENT-GUIDE-AR.md'), 'utf8'), section = guide.slice(guide.indexOf('## 9-أه.'), guide.indexOf('\n## 10.'));
ok(section.includes('**الرجوع إلى الإصدار السابق (update-orders-20261119).**') && section.includes('`/api/visit-files?id=`') && section.includes('بـ404'), 'the guide has the way back from this release');
ok(!/^sqlite3 /m.test(section), 'and no command to run');

console.log(JSON.stringify({ok: true, checks, previous: PREVIOUS, syntheticData: true}));
