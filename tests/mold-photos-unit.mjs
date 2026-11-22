// «صور القالب», the parts tests/mold-photos.mjs leaves (the owner's unit-test plan, 2026-11-22): lib/mold-photos.ts and
// lib/mold-photos-server.ts transpiled exactly as that test transpiles them (the coverage measure merges both runs), called directly on an
// in-memory SQLite with every migration and the real context (lib/crm-server.ts). A role the CRM does not know (refused, never let in);
// the photo's address and the object key's prefix; the list a page accepts (each field of the wrong type refused); the file with no object
// store (503) and with its bytes gone (404); an upload with no object store (503, after the bytes are checked), one whose commit lost to
// the same upload from another tab (the saved photo answered, its own object removed), and one whose commit failed (its object removed);
// a deletion that lost to another (already deleted) and one refused because the photo changed meanwhile. Made-up members and photos only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';

// The compilation of tests/mold-photos.mjs, line for line, so both runs are one version of each module.
const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'mold-photos-unit-')), seen = new Set();
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
fs.writeFileSync(path.join(out, 'env.mjs'), 'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out, 'auth.mjs'), 'export async function getApplicationUser(){return globalThis.testUser;}');
fs.writeFileSync(path.join(out, 'mold-hook.mjs'), 'export function nudgeMoldCustomers(){}export function wakeMoldRetries(){}');
function compile(relative) {
  if (seen.has(relative)) return; seen.add(relative);
  const src = path.join(root, relative), dest = path.join(out, relative.replace(/\.tsx?$/, '.mjs'));
  fs.mkdirSync(path.dirname(dest), {recursive: true});
  let code = ts.transpileModule(fs.readFileSync(src, 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
  code = code.replace(/from (['"])([^'"]+)\1/g, (match, q, imp) => {
    if (imp === 'cloudflare:workers') return 'from ' + JSON.stringify(path.join(out, 'env.mjs'));
    if (imp === '@/app/application-auth') return 'from ' + JSON.stringify(path.join(out, 'auth.mjs'));
    if (imp === '@/lib/mold-customers-hook') return 'from ' + JSON.stringify(path.join(out, 'mold-hook.mjs'));
    if (!imp.startsWith('.') && !imp.startsWith('@/')) return match;
    let source = imp.startsWith('@/') ? imp.slice(2) : path.relative(root, path.resolve(path.dirname(src), imp));
    if (!/\.tsx?$/.test(source)) source += fs.existsSync(path.join(root, source + '.ts')) ? '.ts' : '.tsx';
    compile(source); return 'from ' + JSON.stringify(path.join(out, source.replace(/\.tsx?$/, '.mjs')));
  });
  fs.writeFileSync(dest, code);
}
for (const file of ['lib/mold-photos.ts', 'lib/mold-photos-server.ts', 'lib/crm-server.ts']) compile(file);

const sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON');
for (const file of fs.readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) sql.exec(fs.readFileSync('drizzle/' + file, 'utf8'));
class Statement {
  constructor(query, args = []) { this.query = query; this.args = args; }
  bind(...args) { return new Statement(this.query, args); }
  async run() { return {meta: {changes: Number(sql.prepare(this.query).run(...this.args).changes)}}; }
  async all() { return {results: sql.prepare(this.query).all(...this.args)}; }
  async first(column) { const row = sql.prepare(this.query).get(...this.args); return row ? (column === undefined ? row : row[column] ?? null) : null; }
}
let beforeBatch = null;
const DB = {prepare: query => new Statement(query), batch: async statements => { const race = beforeBatch; beforeBatch = null; await race?.(); sql.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; } catch (error) { sql.exec('ROLLBACK'); throw error; } }};
const objects = new Map();
const FILES = {async put(key, value) { objects.set(key, new Uint8Array(value)); return {key}; }, async get(key) { const bytes = objects.get(key); return bytes ? {body: bytes, size: bytes.length} : null; }, async delete(key) { for (const k of Array.isArray(key) ? key : [key]) objects.delete(k); }};
globalThis.testEnv = {DB, FILES, YR_APP_ORIGIN: 'https://test.invalid'};
const now = new Date().toISOString();
const member = (id, name, role, {region = 'all', supervisor = null} = {}) => sql.prepare("INSERT INTO crm_members(id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,'HQ',?,?,1,0,?)").run(id, id + '@example.invalid', name, role, supervisor, region, now);
member('owner', 'مدير النظام', 'admin'); member('sup', 'المشرف', 'supervisor'); member('rep1', 'المندوب الأول', 'rep', {region: 'eastern', supervisor: 'sup'});
sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES('c1','customer',NULL,'rep1','HQ',?,?,?,1)").run(JSON.stringify({name: 'مصنع المندوب الأول', region: 'الشرقية', city: 'الدمام', branch: 'HQ', assignedTo: 'rep1'}), now, now);
const login = id => { const m = sql.prepare('SELECT * FROM crm_members WHERE id=?').get(id); globalThis.testUser = {provider: 'email-otp', memberId: id, memberVersion: m.auth_version, userId: 'test-' + id, email: m.email, fullName: m.name}; };
const rules = await import(path.join(out, 'lib/mold-photos.mjs')), server = await import(path.join(out, 'lib/mold-photos-server.mjs')), crm = await import(path.join(out, 'lib/crm-server.mjs'));

let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const refusal = async (promise, status, text, message) => { let error; try { await promise; } catch (caught) { error = caught; } ok(error instanceof crm.CRMError && error.status === status && error.message === text, message + ' (' + (error?.status ?? 'none') + ': ' + (error?.message || 'no error') + ')'); };
const JPEG = n => { const bytes = new Uint8Array(Math.max(n, 4)); bytes.set([0xff, 0xd8, 0xff, 0xe0]); for (let i = 4; i < bytes.length; i++) bytes[i] = (i * 31) % 251; return bytes; };

// ---- the pure parts
{
  const customer = {kind: 'customer', assignedTo: 'rep1', branch: 'HQ'};
  for (const role of ['viewer', '', 'ADMIN', 'rep ']) check(rules.moldPhotoAddRefusal(customer, [], {id: 'x', role, branch: 'HQ', access: null}), rules.MOLD_PHOTO_TEXT.addRefused, 'a role the CRM does not know: refused (' + JSON.stringify(role) + ')');
  check([rules.isMoldPhotoKey('mold-photo/abc'), rules.isMoldPhotoKey('mold-design/abc'), rules.isMoldPhotoKey(42), rules.isMoldPhotoKey(null)], [true, false, false, false], 'the object key of a photo by its prefix');
  check(rules.moldPhotoSrc('mold-photo-' + 'a'.repeat(64)), '/api/mold-photos?id=mold-photo-' + 'a'.repeat(64), 'its address');
  check(rules.moldPhotoSrc('a b/ج'), '/api/mold-photos?id=a%20b%2F%D8%AC', 'an id that is not one is encoded, never a path');
  const photo = {id: 'mold-photo-' + 'b'.repeat(64), contentType: 'image/jpeg', size: 10, createdAt: now, uploadedBy: 'المندوب', mine: true, canDelete: true};
  const list = {ok: true, customerId: 'c1', photos: [photo], max: 20, canAdd: true};
  check(rules.validMoldPhotoList(list), true, 'the list as the server sends it');
  check(rules.validMoldPhotoList({...list, photos: []}), true, 'with no photo');
  for (const [bad, why] of [[null, 'nothing'], ['list', 'text'], [{...list, ok: false}, 'not ok'], [{...list, customerId: 7}, 'a customer id that is not text'], [{...list, max: '20'}, 'a limit as text'], [{...list, canAdd: 'yes'}, 'canAdd as text'],
    [{...list, photos: 'none'}, 'photos not a list'], [{...list, photos: [null]}, 'a photo that is nothing'], [{...list, photos: [{...photo, id: 'queued-file-1'}]}, 'a photo id of another kind'], [{...list, photos: [{...photo, createdAt: 1763629200000}]}, 'a moment that is not text'], [{...list, photos: [{id: photo.id}]}, 'a photo with no moment']])
    check(rules.validMoldPhotoList(bad), false, 'refused: ' + why);
}

// ---- the server: the file, an upload and a deletion that meet something else
{
  login('rep1');
  let c = await crm.context();
  const customer = c.all.find(row => row.id === 'c1');
  const saved = await (await server.addMoldPhoto(c, customer, 'key-1', new File([JPEG(64)], 'a.jpg'))).json();
  check([saved.ok, saved.count], [true, 1], 'a photo added');
  const row = await server.moldPhotoRow(DB, saved.photo.id);
  delete globalThis.testEnv.FILES;
  await refusal(server.moldPhotoResponse(row), 503, rules.MOLD_PHOTO_TEXT.storage, 'the file with no object store: 503');
  await refusal(server.addMoldPhoto(c, customer, 'key-2', new File([JPEG(64)], 'b.jpg')), 503, rules.MOLD_PHOTO_TEXT.storage, 'an upload with no object store: 503');
  await refusal(server.addMoldPhoto(c, customer, 'key-2', new File([new TextEncoder().encode('%PDF-1.4')], 'b.pdf')), 415, rules.MOLD_PHOTO_TEXT.notImage, 'the bytes are checked before the store is asked for');
  globalThis.testEnv.FILES = FILES;
  objects.delete(row.object_key);
  await refusal(server.moldPhotoResponse(row), 404, rules.MOLD_PHOTO_TEXT.photoGone, 'its bytes gone: 404');
  await refusal(server.addMoldPhoto(c, customer, 'key-big', new File([JPEG(rules.MOLD_PHOTO_MAX_BYTES + 1)], 'big.jpg')), 413, rules.MOLD_PHOTO_TEXT.tooLarge, 'over 2 MB: 413');
  // The same upload saved from another tab between this one's reads and its commit: the saved photo answered, this one's object removed.
  c = await crm.context();
  const objectsBefore = objects.size;
  beforeBatch = async () => { const other = await crm.context(); await server.addMoldPhoto(other, other.all.find(r => r.id === 'c1'), 'key-3', new File([JPEG(80)], 'c.jpg')); };
  const raced = await (await server.addMoldPhoto(c, customer, 'key-3', new File([JPEG(80)], 'c.jpg'))).json();
  check([raced.ok, raced.alreadySaved, raced.count, objects.size - objectsBefore], [true, true, 2, 1], 'the same upload won by another tab: answered as saved, one object kept');
  // A commit that fails: its own object removed, the failure thrown.
  c = await crm.context();
  const objectsNow = objects.size;
  beforeBatch = () => { throw new Error('the disk is full'); };
  let error; try { await server.addMoldPhoto(c, customer, 'key-4', new File([JPEG(90)], 'd.jpg')); } catch (caught) { error = caught; }
  check([error?.message, objects.size], ['the disk is full', objectsNow], 'a failed commit: thrown, and its object removed');
  // A deletion another tab made first: already deleted; a photo replaced meanwhile: refused as a change.
  c = await crm.context();
  const target = await server.moldPhotoRow(DB, saved.photo.id);
  sql.prepare('DELETE FROM crm_visit_files WHERE id=?').run(target.id);
  sql.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)").run(rules.moldPhotoDeleteReceipt(target.id), 'c1', 'المندوب الأول', rules.MOLD_PHOTO_DELETE_ACTION, rules.MOLD_PHOTO_COUNT_DETAIL + '1', now);
  check(await (await server.deleteMoldPhoto(c, customer, target)).json(), {ok: true, alreadyDeleted: true}, 'deleted by another tab first: already deleted');
  const second = await server.moldPhotoRow(DB, raced.photo.id);
  sql.prepare('UPDATE crm_visit_files SET object_key=? WHERE id=?').run(second.object_key + '-moved', second.id);
  await refusal(server.deleteMoldPhoto(c, customer, second), 409, rules.MOLD_PHOTO_TEXT.changed, 'the photo changed since it was read: refused, nothing deleted');
  ok(await server.moldPhotoRow(DB, second.id), 'the photo stays');
}

console.log(JSON.stringify({ok: true, checks}));
