// Linking the earlier mold requests with what the owner confirmed (scripts/mold-link/legacy-link.cjs), as the hosting account runs it:
// a child process with only HOME and PATH, the live release's tool beside settings.cjs, the products application's source file, and the
// stand-in production API seeded with the imported orders. The dry run writes nothing and calls nobody; the link saves each confirmed
// salesman's orders under the CRM member confirmed for it and leaves the head office's orders out; a second run changes nothing; a
// salesman not confirmed, a member no longer an active representative, a CRM name that changed, or a production link not configured
// stops the run before production is called. Synthetic names, ids as confirmed; no real data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';

process.umask(0o077); // the account's private data: folders 0700, files 0600, as the settings check wants
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const script = path.resolve('scripts/mold-link/legacy-link.cjs');
const {holds, CONFIRMED, LEFT_OUT} = createRequire(import.meta.url)(script);

// ---- the owner's list, and the reading of names it was confirmed with
eq([CONFIRMED.map(item => item.order), LEFT_OUT], [[2, 17, 23, 37, 57], [1]], 'the five salesmen confirmed by their first order, the head office left out');
eq(new Set(CONFIRMED.map(item => item.member)).size, 5, 'five different members');
ok(holds('عبدالرحمن سالم محمود فؤاد', 'عبد الرحمن سالم') && holds('احمد عبدالعزيز سالم حسن', 'أحمد عبد العزيز') && holds('إسلام محمود شلبى حسن', 'إسلام شلبي'), 'the CRM name holds the sheet\'s words (spaces in عبد, أ/ا, ي/ى, any order)');
ok(!holds('أحمد سمير حسن', 'أحمد مجدي') && !holds('أحمد مجدي', ''), 'a first name alone is not enough; an empty name holds nothing');

// ---- a hosting account
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mold-link-'));
const mock = await startProductsMock();
process.on('exit', () => fs.rmSync(work, {recursive: true, force: true}));
const home = path.join(work, 'host'), app = path.join(home, 'yourrest-crm'), data = path.join(home, 'yourrest-crm-data'), ops = path.join(app, 'release', 'operations');
fs.mkdirSync(ops, {recursive: true, mode: 0o700}); fs.mkdirSync(path.join(data, 'objects'), {recursive: true, mode: 0o700}); fs.chmodSync(data, 0o700);
const database = path.join(data, 'database.sqlite');
const db = new DatabaseSync(database);
for (const file of fs.readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join('drizzle', file), 'utf8'));
const now = '2026-11-01T08:00:00.000Z';
const member = (id, name, role = 'rep', active = 1) => db.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,active,target,created_at,region_scope) VALUES(?,?,?,?,?,'الرئيسي',?,0,?,'eastern')").run(id, 'u-' + id, id.slice(0, 8) + '@yourrest.org', name, role, active, now);
const [A, B, C, D, E] = CONFIRMED.map(item => item.member);
member('owner', 'مالك سري', 'admin'); member(A, 'أحمد عبدالعزيز سالم حسن'); member(B, 'عبدالرحمن سالم محمود فؤاد'); member(C, 'إسلام محمود شلبى حسن'); member(D, 'أحمد مجدي سالم حسن'); member(E, 'محمد عطيه سالم حسن');
for (let n = 1; n <= 60; n++) db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'owner','الرئيسي',?,?,?,1,'fixture')").run('c' + n, JSON.stringify({name: 'مصنع سري ' + n, city: 'الدمام', address: 'حي', code: 'E-' + n}), now, now);
db.close();
// MOLD_LINK_TEST_OPS=<folder> runs the same checks on another copy of the release's operations files (the one live on the account).
for (const file of ['mold-import.mjs', 'mold-rules.mjs', 'mold-client.mjs', 'config.cjs']) fs.copyFileSync(path.join(process.env.MOLD_LINK_TEST_OPS || 'portable', file), path.join(ops, file));
const base = {YR_APP_ORIGIN: 'https://crm.example.org', YR_AUTH_SECRET: 'a'.repeat(64), YR_DATABASE_PATH: database, YR_OBJECTS_PATH: path.join(data, 'objects'), YR_MAIL_TRANSPORT: 'sendmail', YR_MAIL_FROM: 'noreply@yourrest.org', YR_SENDMAIL_PATH: '/usr/sbin/sendmail'};
const settings = extra => fs.writeFileSync(path.join(app, 'settings.cjs'), 'module.exports = ' + JSON.stringify({...base, ...extra}) + ';\n', {mode: 0o600});
settings({});
const specs = {description: '200*400*27.5TH MM OPEN', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: 'YR001-1', quantity: 1, designUrl: 'https://drive.google.com/d/1', notes: ''};
const row = (legacyOrderNo, salesmanName, extra = {}) => ({legacyOrderNo, requestedAt: '2026-04-19T13:45:47+03:00', customer: {crmNumber: legacyOrderNo, nameRaw: 'اسم من الشيت'}, salesmanName, specs: {...specs, ...extra}, production: {}, dataIssues: []});
const ROWS = [row(1, 'المركز الرئيسي'), row(2, 'أحمد عبد العزيز'), row(3, 'أحمد عبد العزيز'), row(17, 'عبد الرحمن سالم'), row(23, 'إسلام شلبي'), row(37, 'أحمد مجدي'), row(40, 'المركز الرئيسي'), row(57, 'محمد عطية'), row(58, ' محمد  عطية ', {designUrl: 'YR001-1'})];
const products = path.join(home, 'public_html', 'products', 'private'), sourceFile = path.join(products, 'mold-requests-source.json');
fs.mkdirSync(products, {recursive: true});
const source = rows => fs.writeFileSync(sourceFile, JSON.stringify({requests: rows}));
source(ROWS);
const request = path.join(work, 'mold-link.json');
const run = async (dryRun, env = {}) => {
  fs.writeFileSync(request, JSON.stringify(dryRun === undefined ? {} : {dryRun}));
  const child = spawn(process.execPath, [script, request], {env: {PATH: process.env.PATH, HOME: home, NODE_NO_WARNINGS: '1', NODE_EXTRA_CA_CERTS: mock.ca, ...env}});
  let stdout = '', stderr = '';
  child.stdout.on('data', part => { stdout += part; }); child.stderr.on('data', part => { stderr += part; });
  const status = await new Promise(resolve => child.on('close', resolve));
  return {status, stdout, stderr, last: stdout.trim().split('\n').at(-1)};
};
const NAMES = /مصنع|اسم|المركز|عبد|سالم|مجد|عطي|شلب|مالك|@yourrest/;
const saved = () => { const read = new DatabaseSync(database, {readOnly: true}); try { return read.prepare('SELECT legacy_order_no AS legacy, member_id AS member, customer_id AS customer, data FROM crm_mold_requests ORDER BY legacy_order_no').all(); } finally { read.close(); } };
const leftovers = () => fs.readdirSync(home).filter(name => name.startsWith('.yourrest-mold-link-'));
mock.seedLegacy(60);

try {
  // ---- before the update: a clear stop
  fs.renameSync(path.join(ops, 'mold-import.mjs'), path.join(ops, 'mold-import.off'));
  let result = await run(true);
  eq([result.status, result.last], [2, 'MOLD LINK STOP: the live release has no mold-import.mjs: deploy the mold requests update first'], 'no tool yet: says so');
  fs.renameSync(path.join(ops, 'mold-import.off'), path.join(ops, 'mold-import.mjs'));
  result = await run(undefined);
  eq([result.status, result.last], [2, 'MOLD LINK STOP: the request must say dryRun: true (show only) or false (link)'], 'a request must say which');

  // ---- the dry run: read-only, nobody called, the products link not configured yet (said, not needed)
  const before = fs.readFileSync(database), calls = mock.state.calls.length;
  result = await run(true);
  eq(result.status, 0, result.stdout + result.stderr);
  const dry = JSON.parse(result.stdout.trim().split('\n').slice(0, -1).join('\n'));
  eq([dry.mode, dry.readOnly, dry.rows, dry.toLink, dry.skipped, dry.leftOut, dry.productionLink], ['dry-run', true, 9, [2, 3, 17, 23, 37, 57, 58], {}, [1, 40], 'not_configured'], 'every confirmed salesman\'s order to link, the head office\'s left out');
  eq(result.last, 'MOLD LINK DRY RUN: ROWS 9: LEFT OUT (HEAD OFFICE) 2, TO LINK 7, DESIGN LINKS NOT KEPT 1, PRODUCTION LINK NOT CONFIGURED (not_configured)', 'one verdict line');
  ok(!NAMES.test(result.stdout + result.stderr), 'no names or emails in the output');
  ok(fs.readFileSync(database).equals(before) && mock.state.calls.length === calls, 'the database is unchanged and production was not called');
  eq(leftovers(), [], 'the private copy of the requests is removed');

  // ---- the link needs the production link configured: a clear stop, nothing done
  result = await run(false);
  eq([result.status, result.last], [2, 'MOLD LINK STOP: the production link is not configured in settings.cjs (not_configured): nothing is linked'], 'not configured: stops');
  ok(fs.readFileSync(database).equals(before) && mock.state.calls.length === calls, 'nothing written, nobody called');

  // ---- what stops the run before production is called
  settings({YR_PRODUCTS_API_URL: mock.url, YR_PRODUCTS_SECRET: mock.state.secret});
  source([...ROWS, row(59, 'مندوب لم يُؤكَّد')]);
  result = await run(false);
  eq([result.status, result.last], [2, 'MOLD LINK STOP: orders 59 name a salesman the owner did not confirm: nothing is linked'], 'a salesman not confirmed: stops, with the orders');
  source(ROWS.filter(item => item.legacyOrderNo !== 23));
  result = await run(true);
  eq([result.status, result.last], [2, 'MOLD LINK STOP: order 23 is not in the earlier requests: the confirmed list does not fit this file'], 'a different file: stops');
  source(ROWS);
  const change = sql => { const write = new DatabaseSync(database); write.prepare(sql).run(); write.close(); };
  change(`UPDATE crm_members SET active = 0 WHERE id = '${D}'`);
  result = await run(false);
  eq([result.status, result.last], [2, 'MOLD LINK STOP: the CRM member confirmed for the salesman of order 37 is no longer an active representative: ask the owner again'], 'an inactive member: stops');
  change(`UPDATE crm_members SET active = 1, role = 'supervisor' WHERE id = '${D}'`);
  result = await run(false);
  ok(result.status === 2 && result.last.includes('order 37 is no longer an active representative'), 'another role: stops');
  change(`UPDATE crm_members SET role = 'rep', name = 'حسن سالم' WHERE id = '${D}'`);
  result = await run(false);
  eq([result.status, result.last], [2, 'MOLD LINK STOP: the CRM name of the member confirmed for the salesman of order 37 changed: ask the owner again'], 'a CRM name that changed: stops');
  change(`UPDATE crm_members SET name = 'أحمد مجدي سالم حسن' WHERE id = '${D}'`);
  eq(saved(), [], 'none of these wrote anything');
  eq(mock.state.calls.length, calls, 'or called production');
  eq(leftovers(), [], 'or left a copy behind');

  // ---- the link: production first, then the CRM, each order under the member confirmed for its salesman
  mock.state.byOrder.get(3).crmRequestId = 'mr-elsewhere';
  result = await run(false);
  eq(result.status, 1, 'an order production refused makes the run fail: ' + result.stdout + result.stderr);
  const applied = JSON.parse(result.stdout.trim().split('\n').slice(0, -1).join('\n'));
  eq([applied.mode, applied.linked, applied.failed.map(item => [item.legacy, item.code]), applied.leftOut], ['apply', [2, 17, 23, 37, 57, 58], [[3, 'request_locked']], [1, 40]], 'linked, the refused one reported');
  eq(result.last, 'MOLD LINK APPLIED: ROWS 9: LEFT OUT (HEAD OFFICE) 2, LINKED 6, FAILED 1', 'one verdict line');
  const rows = saved();
  eq(rows.map(item => [item.legacy, item.member, item.customer]), [[2, A, 'c2'], [17, B, 'c17'], [23, C, 'c23'], [37, D, 'c37'], [57, E, 'c57'], [58, E, 'c58']], 'each order under its confirmed member and its customer by Yourrest number');
  eq(JSON.parse(rows[0].data).salesman, {crmMemberId: A, name: 'أحمد عبدالعزيز سالم حسن', email: A.slice(0, 8) + '@yourrest.org'}, 'the CRM member\'s own name and email are sent');
  eq([JSON.parse(rows[5].data).specs.designUrl, mock.state.byOrder.get(58).crmRequestId], ['', 'mr-legacy-58'], 'a mold code in the design column is not kept as a link; production linked its order');
  ok(!NAMES.test(result.stdout + result.stderr), 'no names in the output of the link either');
  eq([mock.state.byOrder.get(1).crmRequestId, mock.state.byOrder.get(40).crmRequestId], [null, null], 'the head office\'s orders are not linked');
  eq(leftovers(), [], 'the private copy is removed');

  // ---- again, once production lets order 3 go: only it is linked; nothing twice
  mock.state.byOrder.get(3).crmRequestId = null;
  result = await run(false);
  eq(result.status, 0, result.stdout + result.stderr);
  const again = JSON.parse(result.stdout.trim().split('\n').slice(0, -1).join('\n'));
  eq([again.linked, again.failed, again.skipped.already_linked], [[3], [], [2, 17, 23, 37, 57, 58]], 'the rest are already linked');
  eq(saved().length, 7, 'seven saved, none twice');
  result = await run(true);
  eq(result.last, 'MOLD LINK DRY RUN: ROWS 9: LEFT OUT (HEAD OFFICE) 2, TO LINK 0, ALREADY_LINKED 7, DESIGN LINKS NOT KEPT 0, PRODUCTION LINK CONFIGURED', 'a dry run afterwards: nothing left to link');
  ok(!/YR_[A-Z_]+ *=|env\.YR_/.test(fs.readFileSync(script, 'utf8')), 'the tool reads and sets no YR_* variable');
} finally { await mock.stop(); }
console.log(JSON.stringify({ok: true, checks, productionDataUsed: false, realProductionTested: false}));
