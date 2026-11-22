// The customer's signing link on the server, unit by unit (the owner's unit-test plan, 2026-11-22): lib/mold-sign-server.ts called directly
// (no build, no HTTP: tests/mold-sign-link-http.mjs and tests/mold-sign-document-http.mjs cover the routes; tests/mold-signed-pdf.mjs the
// token's shape, the page's key and which files a link shows) on an in-memory SQLite with every migration and an object store in memory,
// compiled into .sites-runtime so the coverage measure sees it, the clock fixed. The address's count of the public page (120 a minute a
// client, 1200 in all, the next minute again, the client never stored as itself); the token looked up (not a text, another shape, Arabic
// digits, unknown, expired to the millisecond, cancelled, sent, sent and returned by finance, signed within the day and after it); the
// public page (refused when over the count, its summary exactly, the files it serves and those it names only); the signing's every refusal
// (gone, changed, the signer, the drawing, the block, its moment, the page and its documents, no place left, no store), each writing
// nothing; the signature saved once (the request, its file, the receipt, the audit naming the customer), the per-file signed copies of a
// page of the release before (made in the files' order, a protected and a damaged PDF skipped with their reason), the same body again
// within the day answering the same and any other body or a day later refused; the ONE signed document of 2026-11-11 (its pages in the
// order the page listed, the signature page last); a change or a cancellation between the check and the save, and a failed save, leaving
// no object behind; a send that never answers or fails; the copies (no block, a size that differs, a signature replaced meanwhile, made
// once, no place left, production's larger limits once its update is known); the signed document (waiting for its parts, made once, too
// large, no place, its page missing) and production refusing it after it was sent; and the old copies a new signature drops. Made-up
// requests, customers and signatures only; the secret is a made-up value inside the stand-in environment.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {PDFDocument} from 'pdf-lib';
import * as rules from '../portable/mold-rules.mjs';
import {signaturePng} from '../scripts/lib/signature-png.mjs';
import {DAMAGED_PDF, encryptedPdf, makePdf, signaturePagePng} from '../scripts/lib/signed-document-fixtures.mjs';

const NativeDate = Date; let clock = NativeDate.parse('2026-11-20T09:00:00.000Z');
globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } };
const iso = (ms = clock) => new NativeDate(ms).toISOString();

const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'mold-sign-server-unit-')), seen = new Set();
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
fs.writeFileSync(path.join(out, 'env.mjs'), 'export const env=new Proxy({},{get:(_,key)=>globalThis.signServerEnv?.[key]});');
fs.writeFileSync(path.join(out, 'auth.mjs'), 'export async function getApplicationUser(){return null;}');
// The same compilation as tests/mold-signed-document.mjs and tests/mold-design-files-server.mjs (the portable modules as they are), so the
// coverage measure merges the runs of one module.
function compile(relative) {
  if (seen.has(relative)) return; seen.add(relative);
  const source = path.join(root, relative), dest = path.join(out, relative.replace(/\.tsx?$/, '.mjs'));
  fs.mkdirSync(path.dirname(dest), {recursive: true});
  let code = ts.transpileModule(fs.readFileSync(source, 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
  code = code.replace(/from (['"])([^'"]+)\1/g, (match, quote, imported) => {
    if (imported === 'cloudflare:workers') return 'from ' + JSON.stringify(path.join(out, 'env.mjs'));
    if (imported === '@/app/application-auth') return 'from ' + JSON.stringify(path.join(out, 'auth.mjs'));
    if (!imported.startsWith('.') && !imported.startsWith('@/')) return match;
    let target = imported.startsWith('@/') ? imported.slice(2) : path.relative(root, path.resolve(path.dirname(source), imported));
    if (target.endsWith('.mjs')) return 'from ' + JSON.stringify(path.join(root, target));
    if (!/\.tsx?$/.test(target)) target += fs.existsSync(path.join(root, target + '.ts')) ? '.ts' : '.tsx';
    compile(target); return 'from ' + JSON.stringify(path.join(out, target.replace(/\.tsx?$/, '.mjs')));
  });
  fs.writeFileSync(dest, code);
}
compile('lib/mold-sign-server.ts');
const S = await import(path.join(out, 'lib/mold-sign-server.mjs'));
const lib = await import(path.join(out, 'lib/mold-requests.mjs'));

let checks = 0;
const plain = value => value === undefined ? value : JSON.parse(JSON.stringify(value));
const eq = (actual, expected, message) => { assert.deepEqual(plain(actual), plain(expected), message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function refused(promise, status, message, text, fields) {
  let error; try { await promise; } catch (caught) { error = caught; }
  assert.ok(error instanceof S.SignLinkRefusal, message + ': not a refusal (' + (error?.message || 'none') + ')');
  eq([error.status, error.message], [status, text], message);
  if (fields !== undefined) eq(error.fields || null, fields, message + ' (the fields)');
}

// ---- the database and the object store
const sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON');
for (const name of fs.readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) sql.exec(fs.readFileSync('drizzle/' + name, 'utf8'));
class Statement {
  constructor(query, args = []) { this.query = query; this.args = args; }
  bind(...args) { return new Statement(this.query, args); }
  execute() { const statement = sql.prepare(this.query); if (statement.columns().length) return {results: statement.all(...this.args), meta: {changes: 0}}; return {results: [], meta: {changes: Number(statement.run(...this.args).changes)}}; }
  async first() { return sql.prepare(this.query).get(...this.args) || null; }
  async all() { return this.execute(); }
  async run() { return this.execute(); }
}
let beforeBatch = null;
const DB = {prepare: query => new Statement(query), batch: async statements => {
  if (beforeBatch) { const hook = beforeBatch; beforeBatch = null; hook(); }
  sql.exec('BEGIN IMMEDIATE'); try { const results = statements.map(statement => statement.execute()); sql.exec('COMMIT'); return results; } catch (error) { sql.exec('ROLLBACK'); throw error; }
}};
const objects = new Map();
const store = {
  async get(key) { const bytes = objects.get(key); return bytes ? {arrayBuffer: async () => bytes.slice().buffer} : null; },
  async put(key, bytes) { objects.set(key, new Uint8Array(bytes)); },
  async delete(key) { objects.delete(key); },
};
const SECRET = 'made-up-auth-secret-for-this-test-only';
globalThis.signServerEnv = {DB, FILES: store, YR_APP_ORIGIN: 'https://crm.example.invalid', YR_AUTH_SECRET: SECRET, YR_AUTH_CLIENT_KEY: headers => headers.get('x-test-client') ? 'client:' + headers.get('x-test-client') : null};

const data = (extra = {}) => ({requestedAt: '2026-11-20T12:00:00+03:00', customer: {crmNumber: null, name: 'مصنع الاختبار للبلوك', address: 'المنطقة الصناعية الثانية', city: 'Damam - الدمام', erpCode: 'C-7781'},
  salesman: {crmMemberId: 'rep', name: 'مندوب تجريبي', email: 'rep@example.invalid'},
  specs: {description: '200*400*27.5TH MM OPEN', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: 'YR099-9', quantity: 1, designUrl: '', notes: ''},
  payment: 'deferred', paymentTerms: 'advance_before_shipping', designRequired: true, awaitsSignature: true, ...extra});
function insertRequest(id, {link, values = {}, extra = {}} = {}) {
  const at = iso(), row = {outbox: 'send', accepted: null, remote: null, cancelled_at: null, last_attempt_at: null, last_error: null, version: 1, ...values};
  sql.prepare('INSERT INTO crm_mold_requests(id,member_id,customer_id,data,accepted,cancelled_at,outbox,next_attempt_at,last_attempt_at,last_error,remote,created_by,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?)')
    .run(id, 'rep', 'cust-' + id, JSON.stringify(data({...(link ? {signatureLink: link} : {}), ...extra})), row.accepted && JSON.stringify(row.accepted), row.cancelled_at, row.outbox, row.last_attempt_at, row.last_error && JSON.stringify(row.last_error), row.remote && JSON.stringify(row.remote), 'rep', at, at, row.version);
}
let fileSeq = 0;
const uuid = n => String(n).padStart(8, '0') + '-aaaa-4bbb-8ccc-' + String(n).padStart(12, '0');
function addFile(requestId, {name, bytes, kind = 'pdf', category = 'design', id = 'mdf-' + uuid(++fileSeq), size, deletedAt = null, outbox = 'send', lastError = null, nextAttemptAt = iso(), sentAt = null, createdAt = iso(NativeDate.parse('2026-11-19T08:00:00.000Z') + fileSeq * 60_000), objectKey}) {
  const key = objectKey === undefined ? 'mold-design/' + requestId + '/' + id + '/obj' : objectKey;
  if (key) objects.set(key, new Uint8Array(bytes));
  const type = kind === 'pdf' ? 'application/pdf' : kind === 'image' ? 'image/png' : 'application/octet-stream';
  sql.prepare('INSERT INTO crm_mold_design_files(id,request_id,member_id,name,kind,content_type,size,sha256,object_key,created_at,deleted_at,outbox,next_attempt_at,last_error,sent_at,version,category) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)')
    .run(id, requestId, 'rep', name, kind, type, size ?? bytes.length, sha(bytes), key, createdAt, deletedAt, outbox, nextAttemptAt, lastError && JSON.stringify(lastError), sentAt, category);
  return id;
}
const requestOf = async id => (await DB.prepare('SELECT * FROM crm_mold_requests WHERE id=?').bind(id).first());
const filesOf = id => sql.prepare('SELECT id,name,kind,category,size,sha256,object_key AS objectKey,deleted_at AS deletedAt,outbox,last_error AS lastError FROM crm_mold_design_files WHERE request_id=? ORDER BY created_at,id').all(id).map(row => ({...row, lastError: row.lastError && JSON.parse(row.lastError)}));
const audits = (id, action) => sql.prepare('SELECT id,actor,action,detail FROM crm_audit WHERE record_id=?' + (action ? ' AND action=?' : '') + ' ORDER BY created_at,rowid').all(...(action ? [id, action] : [id])).map(row => ({...row, detail: row.detail.startsWith('{') ? JSON.parse(row.detail) : row.detail}));
const count = table => Number(sql.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n);
const snapshot = () => [count('crm_mold_design_files'), count('crm_audit'), objects.size, sql.prepare('SELECT group_concat(version) AS v FROM crm_mold_requests').get().v];

// ---- the address's count of the public page (the sign-in's limiter: auth_limits)
{
  const headers = client => new Headers(client ? {'x-test-client': client} : {});
  const results = [];
  for (let n = 0; n < 121; n++) results.push(await S.signLinkPermit(DB, headers('a'), clock));
  eq([results.slice(0, 120).every(Boolean), results[120]], [true, false], '120 a minute for one client, the 121st refused');
  eq(await S.signLinkPermit(DB, headers('b'), clock), true, 'another client: its own count');
  eq(await S.signLinkPermit(DB, headers('a'), clock + 60_000), true, 'the next minute: counted afresh');
  const keys = sql.prepare("SELECT key FROM auth_limits WHERE key LIKE 'mold-sign:%' ORDER BY key").all().map(row => row.key);
  eq(keys, ['mold-sign:client:' + sha(SECRET + ':mold-sign:client:a'), 'mold-sign:client:' + sha(SECRET + ':mold-sign:client:b'), 'mold-sign:global'].sort(), 'each client by the hash of the secret and its key; one global count');
  ok(!keys.some(key => key.endsWith(':a') || key.endsWith(':b')), 'the client is never stored as itself');
  eq(await S.signLinkPermit(DB, headers(''), clock + 60_000), true, 'an address the hosting cannot tell: counted');
  ok(sql.prepare('SELECT 1 FROM auth_limits WHERE key=?').get('mold-sign:client:' + sha(SECRET + ':mold-sign:independent:shared')), 'under one shared count (independent:shared)');
  const minute = Math.floor((clock + 120_000) / 60_000) * 60_000;
  sql.prepare("UPDATE auth_limits SET window_start=?,count=1200 WHERE key='mold-sign:global'").run(minute);
  eq(await S.signLinkPermit(DB, headers('c'), clock + 120_000), false, '1200 in all within the minute: a new client refused too');
  eq(await S.signLinkPermit(DB, headers('c'), clock + 180_000), true, 'the next minute: open again');
  const saved = signServerEnv.YR_AUTH_SECRET; delete signServerEnv.YR_AUTH_SECRET;
  eq(await S.signLinkPermit(DB, headers('d'), clock + 180_000), true, 'without a secret: still counted');
  ok(sql.prepare('SELECT 1 FROM auth_limits WHERE key=?').get('mold-sign:client:' + sha(':mold-sign:client:d')), 'by the hash of the client key alone');
  signServerEnv.YR_AUTH_SECRET = saved;
  sql.exec("DELETE FROM auth_limits");
}

// ---- the token looked up
const quotePdf = await makePdf('Q-77', 2), designPdf = await makePdf('design', 1), picture = signaturePng({width: 300, height: 200, seed: 9});
const made = await S.newSignLink('rep', iso());
insertRequest('mr-open', {link: made.link});
const quoteId = addFile('mr-open', {name: 'عرض سعر Q-77.pdf', bytes: quotePdf, category: 'quote'});
const designId = addFile('mr-open', {name: 'تصميم القالب.pdf', bytes: designPdf});
const pictureId = addFile('mr-open', {name: 'صورة البلوك.png', bytes: picture, kind: 'image'});
addFile('mr-open', {name: 'رسم.dwg', bytes: Buffer.from('AC1027 made-up drawing'), kind: 'other'});
const protectedId = addFile('mr-open', {name: 'محمي.pdf', bytes: await encryptedPdf()});
const damagedId = addFile('mr-open', {name: 'تالف.pdf', bytes: DAMAGED_PDF});
addFile('mr-open', {name: 'مرفوض.pdf', bytes: await makePdf('refused', 1), outbox: 'send', nextAttemptAt: null, lastError: {code: 'invalid_payload', http: 400, at: iso(), final: true}});
addFile('mr-open', {name: 'محذوف.pdf', bytes: await makePdf('deleted', 1), deletedAt: iso(), outbox: null});
{
  for (const token of [undefined, null, 42, '', made.token.slice(1), made.token + 'A', made.token.slice(0, 42) + '+', made.token.slice(0, 42) + '=', '٠'.repeat(43), ' ' + made.token.slice(1)])
    eq(await S.findBySignToken(DB, token, clock), null, 'not a token of the shape: refused before any lookup (' + JSON.stringify(token)?.slice(0, 12) + ')');
  eq(await S.findBySignToken(DB, S.newSignToken(), clock), null, 'a token of the shape that names no request');
  const found = await S.findBySignToken(DB, made.token, clock);
  eq([found.state, found.row.id, found.hash], ['open', 'mr-open', sha(made.token)], 'the request by the SHA-256 of the token alone');
  const expires = NativeDate.parse(made.link.expiresAt);
  eq([(await S.findBySignToken(DB, made.token, expires - 1))?.state, await S.findBySignToken(DB, made.token, expires)], ['open', null], 'open until the millisecond it expires (14 days)');
  eq(expires - clock, 14 * 86400_000, 'fourteen days');
  const other = await S.newSignLink('rep', iso());
  insertRequest('mr-cancelled', {link: other.link, values: {cancelled_at: iso()}});
  eq(await S.findBySignToken(DB, other.token, clock), null, 'a cancelled request: refused');
  const sent = await S.newSignLink('rep', iso());
  insertRequest('mr-sent', {link: sent.link, values: {outbox: null, accepted: data()}});
  eq(await S.findBySignToken(DB, sent.token, clock), null, 'a request production holds (nothing to send): refused');
  const returned = await S.newSignLink('rep', iso());
  const remote = status => ({crmRequestId: 'mr-returned', orderNo: 101, status, editable: true, stages: {}, stagesDone: 0, stagesTotal: 7, delivered: false, revision: 3, waitingStep: 'sales', approvals: {required: true, sales: null, production: null, admin: null}, returned: {by: 'finance', name: 'المالية', reason: 'ناقص ختم العميل', at: '2026-11-19T10:00:00+03:00', correctedAt: null}});
  insertRequest('mr-returned', {link: returned.link, values: {accepted: data(), remote: remote('received'), last_attempt_at: iso()}});
  eq((await S.findBySignToken(DB, returned.token, clock))?.state, 'open', 'finance returned it to the sales manager: the corrected request may be signed again from a new link');
  sql.prepare('UPDATE crm_mold_requests SET remote=? WHERE id=?').run(JSON.stringify(remote('cancelled')), 'mr-returned');
  eq(await S.findBySignToken(DB, returned.token, clock), null, 'returned, then cancelled by production: refused');
  sql.prepare("DELETE FROM crm_mold_requests WHERE id IN ('mr-cancelled','mr-sent','mr-returned')").run();
}

// ---- the public page
{
  const headers = new Headers({'x-test-client': 'page'});
  const page = await S.loadSignLinkPage(DB, made.token, headers, clock);
  const files = await (await import(path.join(out, 'lib/mold-requests-server.mjs'))).loadMoldDesignFiles(DB, 'request_id=?', ['mr-open']);
  eq([page.key, page.expiresAt, page.now], [await S.moldSignKey((await S.findBySignToken(DB, made.token, clock)).row, files), made.link.expiresAt, iso()], 'the page\'s key, the link\'s expiry, the server\'s now');
  eq(page.summary, {customerName: 'مصنع الاختبار للبلوك', erpCode: 'C-7781', address: 'المنطقة الصناعية الثانية', city: 'Damam - الدمام', description: '200*400*27.5TH MM OPEN', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none',
    moldWidth: 1380, gelbaSize: 795, quantity: 1, payment: 'deferred', paymentTerms: 'advance_before_shipping', quoteNo: '', poNo: ''}, 'the summary: the customer as typed and the specs, nothing internal (no CRM number, no representative)');
  ok(!JSON.stringify(page).includes('rep@example.invalid') && !JSON.stringify(page).includes('مندوب تجريبي'), 'no representative on the public page');
  eq(page.files.map(file => [file.name, file.kind, file.category, file.href]), [
    ['عرض سعر Q-77.pdf', 'pdf', 'quote', '/sign/m/' + made.token + '/file/' + quoteId], ['تصميم القالب.pdf', 'pdf', 'design', '/sign/m/' + made.token + '/file/' + designId],
    ['صورة البلوك.png', 'image', 'design', '/sign/m/' + made.token + '/file/' + pictureId], ['محمي.pdf', 'pdf', 'design', '/sign/m/' + made.token + '/file/' + protectedId], ['تالف.pdf', 'pdf', 'design', '/sign/m/' + made.token + '/file/' + damagedId]],
  'the PDFs and pictures it serves, oldest first, each through the token; none refused for good, none deleted');
  eq(page.others, [{name: 'رسم.dwg', category: 'design'}], 'the other files: named only');
  eq(S.signFileHref(made.token, 'mdf-أ ب/1'), '/sign/m/' + made.token + '/file/mdf-%D8%A3%20%D8%A8%2F1', 'a file\'s address: its id encoded');
  for (const [extra, payment, terms] of [[{payment: 'cash'}, 'cash', null], [{payment: undefined, paymentTerms: undefined}, null, null], [{payment: 'bank'}, null, null], [{payment: 'deferred', paymentTerms: undefined}, 'deferred', null]]) {
    const link = await S.newSignLink('rep', iso());
    insertRequest('mr-pay', {link: link.link, extra: {...extra, customer: {crmNumber: 27, name: 'مصنع مربوط', address: 7, city: null, erpCode: 551}, quoteNo: 'Q-9', poNo: 'PO-1'}});
    const shown = (await S.loadSignLinkPage(DB, link.token, headers, clock)).summary;
    eq([shown.payment, shown.paymentTerms, shown.erpCode, shown.address, shown.city, shown.quoteNo, shown.poNo], [payment, terms, '', '', '', 'Q-9', 'PO-1'], 'the payment as ' + JSON.stringify(extra) + ': terms only with deferred; what is not text shown empty');
    sql.prepare("DELETE FROM crm_mold_requests WHERE id='mr-pay'").run();
  }
  eq(await S.loadSignLinkPage(DB, S.newSignToken(), headers, clock), null, 'an unknown token: no page');
  sql.prepare('INSERT OR REPLACE INTO auth_limits(key,window_start,count) VALUES(?,?,120)').run('mold-sign:client:' + sha(SECRET + ':mold-sign:client:page'), Math.floor(clock / 60_000) * 60_000);
  eq(await S.loadSignLinkPage(DB, made.token, headers, clock), null, 'over the address\'s count: no page, as any refusal');
  sql.exec('DELETE FROM auth_limits');
}

// ---- the signing's refusals: nothing is written by any of them
const block = signaturePng({width: 900, height: 300, seed: 5});
const keyOf = async id => { const found = await (await import(path.join(out, 'lib/mold-requests-server.mjs'))).loadMoldRequest(DB, id); return S.moldSignKey(found, await (await import(path.join(out, 'lib/mold-requests-server.mjs'))).loadMoldDesignFiles(DB, 'request_id=?', [id])); };
const input = (token, key, extra = {}) => ({requestId: 'ignored', token, key, signer: 'م. خالد العتيبي', png: signaturePng({seed: 2}).toString('base64'), block: block.toString('base64'), blockAt: iso(), consent: true, ...extra});
const sends = [];
const send = (requestId, told) => { sends.push(requestId); told({kind: 'ok'}); sql.prepare('UPDATE crm_mold_requests SET outbox=NULL WHERE id=?').run(requestId); return Promise.resolve(); };
{
  const key = await keyOf('mr-open'), before = snapshot();
  await refused(S.signFromLink(DB, input(S.newSignToken(), key), {send}), 404, 'a token that names nothing', S.SIGN_LINK_GONE);
  await refused(S.signFromLink(DB, input('short', key), {send}), 404, 'a token of another shape', S.SIGN_LINK_GONE);
  await refused(S.signFromLink(DB, input(made.token, key.replace(/^./, c => c === 'a' ? 'b' : 'a')), {send}), 409, 'the page opened on another version or other files', S.SIGN_LINK_CHANGED);
  for (const signer of ['', 'أ', 42, null, '‏‏‫', 'ن'.repeat(81)])
    await refused(S.signFromLink(DB, input(made.token, key, {signer}), {send}), 400, 'the signer ' + JSON.stringify(signer).slice(0, 12), rules.MOLD_SIGNER_REQUIRED, {signer: rules.MOLD_SIGNER_REQUIRED});
  await refused(S.signFromLink(DB, input(made.token, key, {png: undefined}), {send}), 400, 'no drawing', rules.MOLD_SIGNATURE_REQUIRED, {signature: rules.MOLD_SIGNATURE_REQUIRED});
  await refused(S.signFromLink(DB, input(made.token, key, {png: 'not base64!'}), {send}), 400, 'a drawing that is not base64: none', rules.MOLD_SIGNATURE_REQUIRED, {signature: rules.MOLD_SIGNATURE_REQUIRED});
  await refused(S.signFromLink(DB, input(made.token, key, {png: Buffer.from(await makePdf('x', 1)).toString('base64')}), {send}), 400, 'a drawing that is not a PNG', rules.MOLD_SIGNATURE_BAD, {signature: rules.MOLD_SIGNATURE_BAD});
  await refused(S.signFromLink(DB, input(made.token, key, {signer: '', png: undefined}), {send}), 400, 'both wrong: both said', rules.MOLD_SIGNER_REQUIRED + ' • ' + rules.MOLD_SIGNATURE_REQUIRED, {signer: rules.MOLD_SIGNER_REQUIRED, signature: rules.MOLD_SIGNATURE_REQUIRED});
  await refused(S.signFromLink(DB, input(made.token, key, {block: signaturePng({width: 300, height: 300}).toString('base64')}), {send}), 400, 'a block of another shape', rules.MOLD_SIGNATURE_BAD, {signature: rules.MOLD_SIGNATURE_BAD});
  await refused(S.signFromLink(DB, input(made.token, key, {block: undefined}), {send}), 400, 'no block', rules.MOLD_SIGNATURE_BAD, {signature: rules.MOLD_SIGNATURE_BAD});
  const late = 'وقت التوقيع غير صحيح؛ افتح الرابط مرة أخرى ووقّع.';
  for (const blockAt of [iso(clock - 11 * 60_000), iso(clock + 11 * 60_000), '٢٠٢٦-١١-٢٠T09:00:00.000Z', iso().replace('Z', '+00:00'), 1763629200000, '‎' + iso()])
    await refused(S.signFromLink(DB, input(made.token, key, {blockAt}), {send}), 400, 'the block\'s moment ' + JSON.stringify(blockAt), late, {signature: late});
  await refused(S.signFromLink(DB, input(made.token, key, {document: {page: 'not a png', parts: []}}), {send}), 400, 'a signature page that is not one', rules.MOLD_SIGNATURE_BAD, {signature: rules.MOLD_SIGNATURE_BAD});
  await refused(S.signFromLink(DB, input(made.token, key, {document: {page: signaturePagePng().toString('base64'), parts: 'all'}}), {send}), 400, 'documents that are not a list', rules.MOLD_SIGNATURE_BAD, {signature: rules.MOLD_SIGNATURE_BAD});
  await refused(S.signFromLink(DB, input(made.token, key, {document: {page: signaturePagePng().toString('base64'), parts: [{sha256: sha(Buffer.from('not here')), category: 'quote', kind: 'pdf', name: 'x.pdf', pages: 1}]}}), {send}), 409, 'a document the link does not serve', S.SIGN_LINK_CHANGED);
  await refused(S.signFromLink(DB, input(made.token, key, {document: {page: signaturePagePng().toString('base64'), parts: [{sha256: sha(quotePdf), category: 'quote', kind: 'pdf', name: 'عرض سعر Q-77.pdf', pages: 3}]}}), {send}), 409, 'its pages counted otherwise than the page said', S.SIGN_LINK_CHANGED);
  signServerEnv.FILES = undefined;
  await refused(S.signFromLink(DB, input(made.token, key), {send}), 503, 'no object store', 'التوقيع غير متاح الآن؛ أعد المحاولة بعد قليل.');
  signServerEnv.FILES = store;
  eq([snapshot(), sends.length], [before, 0], 'none of them wrote, stored or sent anything');
  const full = await S.newSignLink('rep', iso());
  insertRequest('mr-full', {link: full.link});
  for (let n = 0; n < 10; n++) addFile('mr-full', {name: 'تصميم ' + n + '.pdf', bytes: Buffer.from('%PDF-1.4 design ' + n)});
  const fullBefore = snapshot();
  await refused(S.signFromLink(DB, input(full.token, await keyOf('mr-full')), {send}), 409, 'ten design files: no place for the signature\'s picture', 'الطلب غير جاهز للتوقيع الآن؛ تواصل مع المندوب.');
  eq(snapshot(), fullBefore, 'nothing written');
}

// ---- the signature saved once, from a page of the release before: the per-file copies
let first;
{
  const key = await keyOf('mr-open');
  clock += 1000;
  first = await S.signFromLink(DB, input(made.token, key, {signer: '  ‏م. خالد   العتيبي‏ '}), {send});
  const row = await requestOf('mr-open'), stored = JSON.parse(row.data), signature = stored.signature;
  eq([first.ok, first.signer, first.signedAt, first.sent], [true, 'م. خالد العتيبي', iso(), true], 'signed: the name cleaned of its marks and spaces, the server\'s moment, sent at once');
  eq(sends, ['mr-open'], 'the request sent once, through the usual send');
  eq([signature.via, signature.link, signature.block.width, signature.block.height, signature.block.at, signature.block.sha256, Object.hasOwn(stored, 'awaitsSignature'), Object.hasOwn(stored, 'signatureLink'), Object.hasOwn(signature, 'document')],
    ['link', {hash: sha(made.token), at: iso()}, 900, 300, iso(), sha(block), false, false, false], 'the request\'s data: via the link, its hash, the block; the wait and the link removed; no document from a page of before');
  eq([row.version, row.next_attempt_at, row.updated_at], [2, iso(), iso()], 'the request is due now, its version one more');
  const files = filesOf('mr-open'), drawing = files.find(file => file.id === signature.fileId);
  eq([drawing.kind, drawing.category, drawing.name, drawing.size, drawing.sha256, drawing.outbox], ['image', 'design', 'توقيع العميل - م. خالد العتيبي.png', signaturePng({seed: 2}).length, sha(signaturePng({seed: 2})), 'send'], 'the drawing: one design picture of the request, waiting to go');
  ok(signature.fileId.startsWith('mds-') && objects.has(drawing.objectKey) && objects.has(signature.block.key), 'its bytes and the block\'s in the store');
  const copies = files.filter(file => lib.moldSignedCopyOf(file.id, signature.fileId));
  eq(copies.map(file => [file.name, file.category, file.outbox, file.deletedAt === null, file.lastError?.reason ?? null]), [
    ['عرض سعر Q-77 - موقّع.pdf', 'quote', 'send', true, null], ['تصميم القالب - موقّع.pdf', 'design', 'send', true, null], ['محمي - موقّع.pdf', 'design', null, false, 'protected'], ['تالف - موقّع.pdf', 'design', null, false, 'damaged']],
  'a signed copy of every PDF the page showed, in the files\' order, of the original\'s category; a protected and a damaged one recorded as not made');
  for (const copy of copies.filter(file => file.objectKey)) { const doc = await PDFDocument.load(objects.get(copy.objectKey)); ok(doc.getPageCount() === (copy.category === 'quote' ? 2 : 1) && sha(objects.get(copy.objectKey)) === copy.sha256, copy.name + ': the original\'s pages, its hash stored'); }
  eq(first.copies.map(copy => [copy.name, copy.href]), copies.filter(file => file.objectKey).map(file => [file.name, '/sign/m/' + made.token + '/file/' + file.id]), 'the answer: the copies to download through the token');
  eq(first.skipped, [{name: 'محمي.pdf', reason: 'protected'}, {name: 'تالف.pdf', reason: 'damaged'}], 'and the PDFs that got none, with why');
  const receipt = audits('mr-open', 'mold-sign-receipt');
  eq([receipt.length, receipt[0].id, receipt[0].actor], [1, 'mold-sign-receipt:' + sha(made.token), 'م. خالد العتيبي (العميل، من الرابط)'], 'one receipt, named by the link');
  const signed = audits('mr-open', 'mold-request:sign')[0];
  eq([signed.actor, signed.detail.via, signed.detail.customerName, signed.detail.signature.stamped, signed.detail.signature.fileId], ['م. خالد العتيبي (العميل، من الرابط)', 'link', 'مصنع الاختبار للبلوك', true, signature.fileId], 'the audit names the customer, from the link');
  eq([audits('mr-open', 'mold-design:signed-copy').length, audits('mr-open', 'mold-design:signed-copy-skipped').map(entry => entry.detail.reason)], [2, ['protected', 'damaged']], 'one audit entry for each copy, made or not');
  // The same body again within the day: the same answer, nothing more; any other body refused as any refusal.
  const again = await S.signFromLink(DB, input(made.token, key, {signer: '  ‏م. خالد   العتيبي‏ '}), {send});
  eq(again, first, 'the same body within the day: the same answer');
  eq([filesOf('mr-open').length, audits('mr-open', 'mold-sign-receipt').length, sends.length], [files.length, 1, 1], 'nothing saved twice, nothing sent again');
  await refused(S.signFromLink(DB, input(made.token, key, {png: signaturePng({seed: 7}).toString('base64'), blockAt: iso(clock - 1000)}), {send}), 404, 'another drawing on the used link', S.SIGN_LINK_GONE);
  eq((await S.findBySignToken(DB, made.token, clock))?.state, 'signed', 'the token names the signed request for its copies');
  eq(S.signLinkFiles((await S.findBySignToken(DB, made.token, clock)).row, await (await import(path.join(out, 'lib/mold-requests-server.mjs'))).loadMoldDesignFiles(DB, 'request_id=?', ['mr-open']), 'signed').map(file => file.name), ['عرض سعر Q-77 - موقّع.pdf', 'تصميم القالب - موقّع.pdf'], 'and serves what the signature made, nothing else');
  eq(S.signLinkFiles({data: {}}, [], 'signed'), [], 'a request with no signature serves nothing once signed');
  eq(await S.loadSignLinkPage(DB, made.token, new Headers(), clock), null, 'the signing page no longer opens');
  const signedAt = NativeDate.parse(signature.signedAt);
  eq([(await S.findBySignToken(DB, made.token, signedAt + 24 * 3600_000 - 1))?.state, await S.findBySignToken(DB, made.token, signedAt + 24 * 3600_000), await S.findBySignToken(DB, made.token, signedAt - 1)], ['signed', null, null], 'its copies for a day after signing, never before it');
  clock = signedAt + 24 * 3600_000;
  await refused(S.signFromLink(DB, input(made.token, key, {signer: '  ‏م. خالد   العتيبي‏ ', blockAt: iso(signedAt - 1000)}), {send}), 404, 'the same body a day later', S.SIGN_LINK_GONE);
  clock = signedAt;
  sql.prepare("UPDATE crm_mold_requests SET cancelled_at=? WHERE id='mr-open'").run(iso());
  eq(await S.findBySignToken(DB, made.token, clock), null, 'cancelled after signing: its copies no longer served');
}

// ---- the ONE signed document (2026-11-11): its pages in the page's order, the signature page last
let docRequest;
{
  const link = await S.newSignLink('rep', iso());
  insertRequest('mr-doc', {link: link.link});
  const quote = addFile('mr-doc', {name: 'Q-88.pdf', bytes: await makePdf('Q-88', 2), category: 'quote'});
  addFile('mr-doc', {name: 'رسم.png', bytes: picture, kind: 'image'});
  addFile('mr-doc', {name: 'PO-5.pdf', bytes: await makePdf('PO-5', 1), category: 'po'});
  const parts = [{sha256: sha(await makePdf('Q-88', 2)), category: 'quote', kind: 'pdf', name: 'Q-88.pdf', pages: 2}, {sha256: sha(await makePdf('PO-5', 1)), category: 'po', kind: 'pdf', name: 'PO-5.pdf', pages: 1}, {sha256: sha(picture), category: 'design', kind: 'image', name: 'رسم.png', pages: 1}];
  const page = signaturePagePng();
  const done = await S.signFromLink(DB, input(link.token, await keyOf('mr-doc'), {document: {page: page.toString('base64'), parts, category: 'quote'}}), {send});
  const stored = JSON.parse((await requestOf('mr-doc')).data).signature, docId = lib.moldSignedDocumentId(stored.fileId);
  eq([stored.document.parts, stored.document.width, stored.document.height, stored.document.category, stored.document.sha256, objects.has(stored.document.key)], [parts, 1240, 1754, 'quote', sha(page), true], 'the page and its documents kept with the signature');
  eq(done.copies.map(copy => [copy.id, copy.name]), [[docId, 'طلب القالب - موقّع.pdf']], 'one signed document, nothing per file');
  const file = filesOf('mr-doc').find(row => row.id === docId), pdf = await PDFDocument.load(objects.get(file.objectKey));
  eq([file.category, file.outbox, pdf.getPageCount()], ['quote', 'send', 5], 'of the first document\'s category, sent like the others: 2 + 1 + 1 pages and the signature page');
  eq(pdf.getPages().map(p => [Math.round(p.getWidth()), Math.round(p.getHeight())]).at(-1), [595, 842], 'the signature page last, as an A4 page');
  const entry = audits('mr-doc', 'mold-design:signed-document')[0].detail;
  eq([entry.documents, entry.pages, entry.category, entry.name], [['Q-88.pdf', 'PO-5.pdf', 'رسم.png'], 5, 'quote', 'طلب القالب - موقّع.pdf'], 'its audit lists the documents in the page\'s order');
  eq(audits('mr-doc', 'mold-request:sign')[0].detail.signature.document, 3, 'the signature\'s audit counts them');
  eq(await S.makeSignedDocument(DB, {requestId: 'mr-doc', signatureFileId: stored.fileId, actor: 'x', store}), {made: [], state: 'none'}, 'made once: a second build makes nothing');
  docRequest = {id: 'mr-doc', signatureFileId: stored.fileId, docId, quote};
}

// ---- a change, a cancellation or a failure between the check and the save: nothing of it kept
{
  const fresh = async id => { const link = await S.newSignLink('rep', iso()); insertRequest(id, {link: link.link}); addFile(id, {name: 'a.pdf', bytes: await makePdf(id, 1)}); return link; };
  const changed = await fresh('mr-race'), keys = objects.size;
  beforeBatch = () => sql.prepare("UPDATE crm_mold_requests SET version=version+1 WHERE id='mr-race'").run();
  await refused(S.signFromLink(DB, input(changed.token, await keyOf('mr-race')), {send}), 409, 'edited between the check and the save', S.SIGN_LINK_CHANGED);
  eq([objects.size, filesOf('mr-race').length, audits('mr-race').length], [keys, 1, 0], 'its objects removed, no file, no receipt');
  const cancelled = await fresh('mr-race2');
  beforeBatch = () => sql.prepare("UPDATE crm_mold_requests SET cancelled_at=?,version=version+1 WHERE id='mr-race2'").run(iso());
  await refused(S.signFromLink(DB, input(cancelled.token, await keyOf('mr-race2')), {send}), 404, 'cancelled between the check and the save', S.SIGN_LINK_GONE);
  const broken = await fresh('mr-race3');
  beforeBatch = () => { throw new Error('the database went away'); };
  let error; try { await S.signFromLink(DB, input(broken.token, await keyOf('mr-race3')), {send}); } catch (caught) { error = caught; }
  eq([error?.message, objects.size, filesOf('mr-race3').length], ['the database went away', keys + 1 + 1, 1], 'a failed save: thrown, and its three objects removed (the other files stay)');
  // A send that never answers, and one that fails: the answer waits a little, then says the request has not gone yet.
  const slow = await fresh('mr-slow');
  const pending = await S.signFromLink(DB, input(slow.token, await keyOf('mr-slow')), {send: () => new Promise(() => {}), waitMs: 20});
  eq([pending.ok, pending.sent, pending.copies.length], [true, false, 1], 'a send that never answers: signed, its copy made, not sent yet');
  const failing = await fresh('mr-fail');
  const failed = await S.signFromLink(DB, input(failing.token, await keyOf('mr-fail')), {send: () => Promise.reject(new Error('network')), waitMs: 20});
  eq([failed.ok, failed.sent], [true, false], 'a send that fails: signed, waiting for the timetable');
  const told = await fresh('mr-told');
  eq((await S.signFromLink(DB, input(told.token, await keyOf('mr-told')), {send: (_, tell) => { tell({kind: 'retry'}); return Promise.resolve(); }})).sent, false, 'production not reached: not sent');
}

// ---- the per-file copies directly
{
  const link = await S.newSignLink('rep', iso());
  insertRequest('mr-copies', {link: link.link});
  const a = addFile('mr-copies', {name: 'a.pdf', bytes: await makePdf('a', 1)}), b = addFile('mr-copies', {name: 'b.pdf', bytes: await makePdf('b', 1), size: 10});
  const rows = await (await import(path.join(out, 'lib/mold-requests-server.mjs'))).loadMoldDesignFiles(DB, 'request_id=?', ['mr-copies']);
  const signatureFileId = 'mds-' + uuid(900);
  sql.prepare('UPDATE crm_mold_requests SET data=json_set(data,\'$.signature\',json(?)) WHERE id=?').run(JSON.stringify({signer: 'العميل', signedAt: iso(), fileId: signatureFileId, via: 'link'}), 'mr-copies');
  objects.set('block-key', block);
  eq(await S.makeSignedCopies(DB, {requestId: 'mr-copies', signatureFileId, blockKey: 'block-key', originals: [], actor: 'x'}), {made: [], skipped: []}, 'no originals: nothing');
  signServerEnv.FILES = undefined;
  eq(await S.makeSignedCopies(DB, {requestId: 'mr-copies', signatureFileId, blockKey: 'block-key', originals: rows, actor: 'x'}), {made: [], skipped: []}, 'no store: nothing');
  signServerEnv.FILES = store;
  eq(await S.makeSignedCopies(DB, {requestId: 'mr-copies', signatureFileId: 'mds-' + uuid(901), blockKey: 'block-key', originals: rows, actor: 'x', store}), {made: [], skipped: []}, 'the request\'s signature is another now: nothing');
  const copies = await S.makeSignedCopies(DB, {requestId: 'mr-copies', signatureFileId, blockKey: 'block-key', originals: rows, actor: 'العميل', store});
  eq([copies.made.map(copy => copy.of), copies.skipped.map(copy => [copy.of, copy.reason])], [[a], [[b, 'damaged']]], 'a stored size that is not the bytes\' own: damaged');
  eq(await S.makeSignedCopies(DB, {requestId: 'mr-copies', signatureFileId, blockKey: 'block-key', originals: rows, actor: 'العميل', store}), {made: [], skipped: []}, 'made (or refused) once: a second try makes no row');
  const noBlock = 'mds-' + uuid(902);
  sql.prepare('UPDATE crm_mold_requests SET data=json_set(data,\'$.signature.fileId\',?) WHERE id=?').run(noBlock, 'mr-copies');
  const lost = await S.makeSignedCopies(DB, {requestId: 'mr-copies', signatureFileId: noBlock, blockKey: 'no-such-block', originals: rows, actor: 'العميل', store});
  eq(lost.skipped.map(copy => copy.reason), ['damaged', 'damaged'], 'the block missing from the store: every PDF recorded as not made');
  // No place left: ten design files take the ten places of production before its update (moldSignedCopyMax), twenty after it.
  const crowd = await S.newSignLink('rep', iso());
  insertRequest('mr-crowd', {link: crowd.link});
  const sig = 'mds-' + uuid(903);
  sql.prepare('UPDATE crm_mold_requests SET data=json_set(data,\'$.signature\',json(?)) WHERE id=?').run(JSON.stringify({signer: 'العميل', signedAt: iso(), fileId: sig}), 'mr-crowd');
  for (let n = 0; n < 10; n++) addFile('mr-crowd', {name: n + '.pdf', bytes: await makePdf('crowd ' + n, 1)});
  const crowdRows = await (await import(path.join(out, 'lib/mold-requests-server.mjs'))).loadMoldDesignFiles(DB, 'request_id=?', ['mr-crowd']);
  const full = await S.makeSignedCopies(DB, {requestId: 'mr-crowd', signatureFileId: sig, blockKey: 'block-key', originals: crowdRows.slice(0, 2), actor: 'العميل', store});
  eq(full.skipped.map(copy => copy.reason), ['too_many_files', 'too_many_files'], 'ten design files before production\'s update: no place for a copy');
  sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('mold-nov10',?)").run(iso());
  const sig2 = 'mds-' + uuid(904);
  sql.prepare('UPDATE crm_mold_requests SET data=json_set(data,\'$.signature.fileId\',?) WHERE id=?').run(sig2, 'mr-crowd');
  const roomy = await S.makeSignedCopies(DB, {requestId: 'mr-crowd', signatureFileId: sig2, blockKey: 'block-key', originals: crowdRows.slice(0, 3), actor: 'العميل', store});
  eq([roomy.made.length, roomy.skipped.length], [3, 0], 'once production\'s update of 2026-11-10 is known: twenty places, the copies made');
  sql.exec("DELETE FROM crm_settings WHERE id='mold-nov10'");
}

// ---- the ONE signed document directly: waiting, too large, no place, its page missing; refused by production after it was sent
{
  const docFor = async (id, files, extra = {}) => {
    const link = await S.newSignLink('rep', iso()); insertRequest(id, {link: link.link});
    const ids = []; for (const [name, bytes, category] of files) ids.push(addFile(id, {name, bytes, category}));
    const signatureFileId = 'mds-' + uuid(1000 + fileSeq);
    objects.set('page-' + id, signaturePagePng()); objects.set('block-' + id, block);
    const parts = await Promise.all(files.map(async ([name, bytes, category]) => ({sha256: sha(bytes), category, kind: 'pdf', name, pages: (await PDFDocument.load(bytes)).getPageCount()})));
    sql.prepare('UPDATE crm_mold_requests SET data=json_set(data,\'$.signature\',json(?)) WHERE id=?').run(JSON.stringify({signer: 'العميل', signedAt: iso(), fileId: signatureFileId, via: 'link', block: {key: 'block-' + id, sha256: sha(block), width: 900, height: 300, at: iso()}, document: {key: 'page-' + id, sha256: sha(signaturePagePng()), width: 1240, height: 1754, at: iso(), parts, ...extra}}), id);
    return {signatureFileId, ids, parts};
  };
  eq(await S.makeSignedDocument(DB, {requestId: 'nothing', signatureFileId: 'mds-x', actor: 'x', store}), {made: [], state: 'none'}, 'no request: nothing');
  eq(await S.makeSignedDocument(DB, {requestId: 'mr-copies', signatureFileId: 'mds-' + uuid(902), actor: 'x', store}), {made: [], state: 'none'}, 'a signature with no document (a page of before): nothing');
  const waiting = await docFor('mr-wait', [['w.pdf', await makePdf('w', 1), 'design']]);
  sql.prepare("UPDATE crm_mold_design_files SET deleted_at=? WHERE request_id='mr-wait'").run(iso());
  eq(await S.makeSignedDocument(DB, {requestId: 'mr-wait', signatureFileId: waiting.signatureFileId, actor: 'x', store}), {made: [], state: 'waiting'}, 'a document the page listed not among the files (yet): waiting');
  const big = await docFor('mr-big', [['big.pdf', await makePdf('big', 1), 'design'], ['q.pdf', await makePdf('q', 1), 'quote']]);
  const tooLarge = await S.makeSignedDocument(DB, {requestId: 'mr-big', signatureFileId: big.signatureFileId, actor: 'العميل', store, built: {ok: false, reason: 'too_large'}});
  const bigDoc = filesOf('mr-big').find(file => file.id === lib.moldSignedDocumentId(big.signatureFileId));
  eq([tooLarge.state, tooLarge.made.length, bigDoc.objectKey, bigDoc.lastError.code, bigDoc.lastError.reason, bigDoc.category], ['fallback', 2, null, 'not_signed', 'too_large', 'quote'], 'too large for production: its row of reason (of the quotation\'s category, listed second), and a signed copy of each PDF instead');
  eq(audits('mr-big', 'mold-design:signed-document-skipped')[0].detail.fallback, 'signed-copies', 'the audit says the copies were made instead');
  const noPage = await docFor('mr-nopage', [['np.pdf', await makePdf('np', 1), 'design']]);
  objects.delete('page-mr-nopage');
  eq((await S.makeSignedDocument(DB, {requestId: 'mr-nopage', signatureFileId: noPage.signatureFileId, actor: 'x', store})).state, 'fallback', 'its signature page missing from the store: the copies instead');
  eq(filesOf('mr-nopage').find(file => file.id === lib.moldSignedDocumentId(noPage.signatureFileId)).lastError.reason, 'mismatch', 'recorded as mismatch');
  const crowded = await docFor('mr-qfull', [['q1.pdf', await makePdf('q1', 1), 'quote'], ['q2.pdf', await makePdf('q2', 1), 'quote'], ['q3.pdf', await makePdf('q3', 1), 'quote'], ['q4.pdf', await makePdf('q4', 1), 'quote'], ['q5.pdf', await makePdf('q5', 1), 'quote']]);
  const qfull = await S.makeSignedDocument(DB, {requestId: 'mr-qfull', signatureFileId: crowded.signatureFileId, actor: 'x', store});
  eq([qfull.state, qfull.made], ['fallback', []], 'five quotation files before production\'s update: no place for the document, nor for a copy');
  eq(Object.hasOwn(audits('mr-qfull', 'mold-design:signed-document-skipped')[0].detail, 'fallback'), false, 'its audit names no fallback');
  const again = await S.makeSignedDocument(DB, {requestId: 'mr-qfull', signatureFileId: crowded.signatureFileId, actor: 'x', store});
  eq(again, {made: [], state: 'none'}, 'its row of reason is the document\'s: not tried again');
  // Production refuses the document after it was sent (413, or no place there): the copies, once.
  eq(await S.signedDocumentRefused(DB, docRequest.id, 'mdc-other-doc', {store}), [], 'another document: nothing');
  const instead = await S.signedDocumentRefused(DB, docRequest.id, docRequest.docId, {store, now: () => iso()});
  const madeCopies = filesOf(docRequest.id).filter(file => lib.moldSignedCopyOf(file.id, docRequest.signatureFileId));
  eq([instead.length, madeCopies.map(file => file.name)], [2, ['Q-88 - موقّع.pdf', 'PO-5 - موقّع.pdf']], 'a copy of each PDF the document listed (the picture has none)');
  const told = audits(docRequest.id, 'mold-design:signed-document-skipped').at(-1);
  eq([told.actor, told.detail.copies, told.detail.fallback], ['النظام', 2, 'signed-copies'], 'one audit entry by the system');
  eq(await S.signedDocumentRefused(DB, docRequest.id, docRequest.docId, {store}), [], 'a second refusal: the copies are there, nothing more');
  signServerEnv.FILES = undefined;
  eq(await S.signedDocumentRefused(DB, docRequest.id, docRequest.docId), [], 'no store: nothing');
  signServerEnv.FILES = store;
}

// ---- another sender between the check and the save: the same copy (nothing more), or the category filled up (said so)
{
  const race = async (id, files) => {
    const link = await S.newSignLink('rep', iso()); insertRequest(id, {link: link.link});
    const ids = []; for (const name of files) ids.push(addFile(id, {name, bytes: await makePdf(id + name, 1)}));
    const sig = 'mds-' + uuid(2000 + fileSeq);
    sql.prepare('UPDATE crm_mold_requests SET data=json_set(data,\'$.signature\',json(?)) WHERE id=?').run(JSON.stringify({signer: 'العميل', signedAt: iso(), fileId: sig, via: 'link', block: {key: 'block-key', sha256: sha(block), width: 900, height: 300, at: iso()}}), id);
    return {sig, ids, rows: await (await import(path.join(out, 'lib/mold-requests-server.mjs'))).loadMoldDesignFiles(DB, 'request_id=?', [id])};
  };
  const insertRow = (id, requestId, name, objectKey) => sql.prepare("INSERT INTO crm_mold_design_files(id,request_id,member_id,name,kind,content_type,size,sha256,object_key,created_at,outbox,next_attempt_at,version,category) VALUES(?,?,'rep',?,'pdf','application/pdf',1,'x',?,?,'send',?,1,'design')").run(id, requestId, name, objectKey, iso(), iso());
  const twin = await race('mr-twin', ['t.pdf']), twinId = lib.moldSignedCopyId(twin.sig, twin.ids[0]), keys = objects.size;
  beforeBatch = () => insertRow(twinId, 'mr-twin', 't - موقّع.pdf', 'other-sender');
  eq(await S.makeSignedCopies(DB, {requestId: 'mr-twin', signatureFileId: twin.sig, blockKey: 'block-key', originals: twin.rows, actor: 'x', store}), {made: [], skipped: []}, 'the same copy made by another sender first: nothing more');
  eq([objects.size, filesOf('mr-twin').filter(file => file.id === twinId).map(file => file.objectKey)], [keys, ['other-sender']], 'its own bytes removed; the other sender\'s row kept');
  const filled = await race('mr-filled', ['f.pdf']);
  beforeBatch = () => { for (let n = 0; n < 9; n++) insertRow('mdf-' + uuid(3000 + n), 'mr-filled', n + '.pdf', 'k' + n); };
  const late = await S.makeSignedCopies(DB, {requestId: 'mr-filled', signatureFileId: filled.sig, blockKey: 'block-key', originals: filled.rows, actor: 'x', store});
  eq([late.made, late.skipped.map(copy => copy.reason)], [[], ['too_many_files']], 'the category filled up meanwhile: recorded as no place');
}

// ---- the copies of an old signature a new one replaces
{
  const old = 'mds-' + uuid(950), copy = id => lib.moldSignedCopyId(old, id);
  const rows = [
    {id: copy('mdf-' + uuid(951)), objectKey: 'k1', deletedAt: null, sentAt: null, lastAttemptAt: null},
    {id: copy('mdf-' + uuid(952)), objectKey: 'k2', deletedAt: null, sentAt: iso(), lastAttemptAt: iso()},
    {id: copy('mdf-' + uuid(953)), objectKey: 'k3', deletedAt: null, sentAt: null, lastAttemptAt: iso()},
    {id: copy('mdf-' + uuid(954)), objectKey: null, deletedAt: iso(), sentAt: null, lastAttemptAt: null},
    {id: lib.moldSignedDocumentId(old), objectKey: 'k5', deletedAt: null, sentAt: null, lastAttemptAt: null},
    {id: 'mdf-' + uuid(955), objectKey: 'k6', deletedAt: null, sentAt: null, lastAttemptAt: null},
  ];
  const dropped = S.dropOldCopies(DB, rows, old, 'mr-old', 'mutation-1', iso());
  eq([dropped.keys, dropped.statements.length], [['k1', 'k5'], 2], 'only what never reached production (no send, no attempt), the document too; an ordinary file never');
  ok(dropped.statements.every(statement => /mutation_id=\?/.test(statement.query) && statement.args.at(-1) === 'mutation-1'), 'each gated on the edit\'s own mutation');
}

console.log(JSON.stringify({ok: true, checks}));
