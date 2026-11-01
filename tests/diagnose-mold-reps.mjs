// Why the link dry run found no CRM representative for the earlier mold requests (scripts/diagnose/mold-reps.cjs), as a child process
// against a temporary release folder, a temporary database with every migration and a synthetic source: for each salesman name of the
// sheet, the close CRM members (any role) and how the names differ, and to whom the customers of its orders are assigned. Member ids,
// roles and counts only; nothing written; the same answer from a layout shaped like the hosting account. No real data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const script = path.resolve('scripts/diagnose/mold-reps.cjs');
const {difference} = createRequire(import.meta.url)(script);

// ---- the kinds of difference, alone
eq(difference('أحمد مجدي', 'أحمد  مجدي'), {kind: 'same'}, 'extra spaces are the same name');
eq(difference('عبد الرحمن تامر', 'عبدالرحمن تامر'), {kind: 'spelling', needs: ['spaces']}, 'عبد الرحمن / عبدالرحمن: a space');
eq(difference('أحمد مجدي', 'احمد مجدى'), {kind: 'spelling', needs: ['alef', 'ya']}, 'أ/ا and ي/ى named, each');
eq(difference('محمد عطية', 'محمد عطيه'), {kind: 'spelling', needs: ['ta']}, 'ة/ه');
eq(difference('إسلام شلبي', 'إسلام شلبي محمد'), {kind: 'more_words_in_crm', extraWords: 1, sameStart: true}, 'a longer name in the CRM');
eq(difference('عبد الرحمن تامر', 'عبدالرحمن تامر السيد'), {kind: 'more_words_in_crm', extraWords: 1, sameStart: true}, 'longer, with عبد joined');
eq(difference('أحمد عبد العزيز محمد', 'احمد عبدالعزيز'), {kind: 'fewer_words_in_crm', missingWords: 1}, 'a shorter name in the CRM');
eq(difference('أحمد مجدي', 'أحمد سمير'), {kind: 'first_word_only'}, 'the first name only');
eq(difference('المركز الرئيسي', 'Ahmed'), null, 'not close');

// ---- the script on a copy
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-mold-reps-'));
process.on('exit', () => fs.rmSync(work, {recursive: true, force: true}));
const app = path.join(work, 'yourrest-crm'), operations = path.join(app, 'release', 'operations');
fs.mkdirSync(operations, {recursive: true});
const database = path.join(work, 'crm.sqlite'), source = path.join(work, 'source.json');
const db = new DatabaseSync(database);
for (const file of fs.readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join('drizzle', file), 'utf8'));
const now = '2026-11-01T08:00:00.000Z';
const member = (id, name, role = 'rep', active = 1) => db.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,active,target,created_at,region_scope) VALUES(?,?,?,?,?,'الرئيسي',?,0,?,'eastern')").run(id, 'u-' + id, id + '@yourrest.org', name, role, active, now);
member('m1-spaces', 'عبدالرحمن تامر'); member('m2-letters', 'احمد مجدى'); member('m3-super', 'محمد عطية', 'supervisor'); member('m4-longer', 'إسلام شلبي محمد'); member('m5-latin', 'Ahmed Samir'); member('m6-old', 'أحمد مجدي', 'rep', 0);
// Yourrest numbers follow insertion: c1=1 (m1), c2=2 (m2), c3=3 (m3), c4=4 (m4), c5=5 (nobody).
for (const [id, owner] of [['c1', 'm1-spaces'], ['c2', 'm2-letters'], ['c3', 'm3-super'], ['c4', 'm4-longer'], ['c5', '']]) db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1,'fixture')").run(id, owner, JSON.stringify({name: 'مصنع سري ' + id, code: 'E-' + id}), now, now);
db.close();
const row = (legacyOrderNo, crmNumber, salesmanName) => ({legacyOrderNo, requestedAt: '2026-04-19T13:45:47+03:00', customer: {crmNumber, nameRaw: 'اسم من الشيت'}, salesmanName, specs: {}});
fs.writeFileSync(source, JSON.stringify({requests: [row(1, 5, 'المركز الرئيسي'), row(2, 1, 'عبد الرحمن تامر'), row(3, 2, 'أحمد مجدي'), row(4, 3, 'محمد عطية'), row(5, 4, 'إسلام شلبي'), row(6, 1, 'عبد الرحمن تامر'), row(7, 60, 'عبد الرحمن تامر')]}));
const run = env => spawnSync(process.execPath, [script], {env: {PATH: process.env.PATH, HOME: work, MOLD_DIAG_APP: app, MOLD_DIAG_SOURCE: source, MOLD_DIAG_DATABASE: database, NODE_NO_WARNINGS: '1', ...env}, encoding: 'utf8'});
const NAMES = /مصنع|اسم|المركز|الرحمن|مجد|عطي|شلبي|Ahmed|Samir|@yourrest/;

let result = run();
ok(result.stdout.includes('DIAGNOSE STOP') && result.stdout.includes('deploy the mold requests update first'), 'no tool yet: says so');
for (const file of ['mold-import.mjs', 'mold-rules.mjs', 'mold-client.mjs']) fs.copyFileSync(path.join('portable', file), path.join(operations, file));
const before = fs.readFileSync(database);
result = run();
eq(result.status, 0, result.stdout + result.stderr);
const output = result.stdout.trim().split('\n'), verdictLines = output.filter(line => line.startsWith('SALESMAN OF ORDER'));
const report = JSON.parse(output.slice(0, output.length - verdictLines.length).join('\n'));
eq([report.mode, report.readOnly, report.rows, report.latinNames], ['reps', true, 7, 1], 'read-only, every row, the Latin-script names counted');
eq(report.members, {rep: {active: 4, inactive: 1}, supervisor: {active: 1, inactive: 0}}, 'members by role');
const by = Object.fromEntries(report.salesmen.map(item => [item.label, item]));
eq(Object.keys(by), ['salesman of order 1', 'salesman of order 2', 'salesman of order 3', 'salesman of order 4', 'salesman of order 5'], 'one entry per salesman name, by its first order');
eq([by['salesman of order 1'].close, by['salesman of order 1'].customersAssignedTo], [[], [{id: 'nobody', orders: 1}]], 'the head office: no member, its customer assigned to nobody');
eq(by['salesman of order 2'].orders, 3, 'orders counted');
eq(by['salesman of order 2'].close, [{id: 'm1-spaces', role: 'rep', active: true, kind: 'spelling', needs: ['spaces']}], 'a space apart');
eq(by['salesman of order 2'].customersAssignedTo, [{id: 'm1-spaces', role: 'rep', active: true, orders: 2}, {id: 'customer_not_found', orders: 1}], 'and its customers are assigned to that member');
eq(by['salesman of order 3'].close, [{id: 'm2-letters', role: 'rep', active: true, kind: 'spelling', needs: ['alef', 'ya']}, {id: 'm6-old', role: 'rep', active: false, kind: 'same'}], 'letters apart, and an inactive account with the same name');
eq(by['salesman of order 4'].close, [{id: 'm3-super', role: 'supervisor', active: true, kind: 'same'}], 'the same name, another role');
eq(by['salesman of order 5'].close, [{id: 'm4-longer', role: 'rep', active: true, kind: 'more_words_in_crm', extraWords: 1, sameStart: true}], 'a longer name in the CRM');
eq(verdictLines[1], 'SALESMAN OF ORDER 2 (3): CLOSE 1 [spelling (spaces) rep m1-space], CUSTOMERS MOSTLY m1-space rep 2/3', 'a one-line verdict per salesman');
ok(!NAMES.test(result.stdout), 'no names or emails in the output');
ok(fs.readFileSync(database).equals(before), 'the database is unchanged');
result = run({MOLD_DIAG_SOURCE: path.join(work, 'missing.json')});
ok(result.stdout.includes('DIAGNOSE STOP') && result.stdout.includes('was not found'), 'no source file: says where it looked');

// ---- shaped like the hosting account: settings.cjs, nothing in the environment but HOME and PATH
const home = path.join(work, 'host'), hostApp = path.join(home, 'yourrest-crm'), hostData = path.join(home, 'yourrest-crm-data'), hostOps = path.join(hostApp, 'release', 'operations');
fs.mkdirSync(hostOps, {recursive: true, mode: 0o700}); fs.mkdirSync(path.join(hostData, 'objects'), {recursive: true, mode: 0o700}); fs.chmodSync(hostData, 0o700);
for (const file of ['mold-import.mjs', 'mold-rules.mjs', 'mold-client.mjs', 'config.cjs']) fs.copyFileSync(path.join('portable', file), path.join(hostOps, file));
const hostDatabase = path.join(hostData, 'database.sqlite');
fs.copyFileSync(database, hostDatabase); fs.chmodSync(hostDatabase, 0o600);
fs.writeFileSync(path.join(hostApp, 'settings.cjs'), 'module.exports = ' + JSON.stringify({YR_APP_ORIGIN: 'https://crm.example.org', YR_AUTH_SECRET: 'a'.repeat(64), YR_DATABASE_PATH: hostDatabase, YR_OBJECTS_PATH: path.join(hostData, 'objects'), YR_MAIL_TRANSPORT: 'sendmail', YR_MAIL_FROM: 'noreply@yourrest.org', YR_SENDMAIL_PATH: '/usr/sbin/sendmail'}) + ';\n', {mode: 0o600});
const products = path.join(home, 'public_html', 'products', 'private');
fs.mkdirSync(products, {recursive: true}); fs.copyFileSync(source, path.join(products, 'mold-requests-source.json'));
const hostBefore = fs.readFileSync(hostDatabase);
result = spawnSync(process.execPath, [script], {env: {PATH: process.env.PATH, HOME: home, NODE_NO_WARNINGS: '1'}, encoding: 'utf8'});
eq(result.status, 0, 'on the hosting shape it runs from settings.cjs: ' + result.stdout + result.stderr);
eq(result.stdout.trim().split('\n').filter(line => line.startsWith('SALESMAN OF ORDER')), verdictLines, 'the same verdict from the live layout');
ok(!NAMES.test(result.stdout), 'no names there either');
ok(fs.readFileSync(hostDatabase).equals(hostBefore), 'and the live-shaped database is unchanged');
ok(!/YR_[A-Z_]+ *=|env\.YR_/.test(fs.readFileSync(script, 'utf8')), 'the script reads and sets no YR_* variable');
console.log(JSON.stringify({ok: true, checks, productionDataUsed: false}));
