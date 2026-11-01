// The read-only link dry run on the hosting account (scripts/diagnose/mold-link-dry-run.cjs, the owner chose the Yourrest code), as a
// child process against a temporary release folder, a temporary database with every migration and a synthetic source: order numbers
// and reasons only, nothing written, clear stops when the tool or the source is missing, and the same verdict from a layout shaped like
// the hosting account (settings.cjs, no YR_* variable in the environment). No real data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-mold-link-'));
process.on('exit', () => fs.rmSync(work, {recursive: true, force: true}));
const app = path.join(work, 'yourrest-crm'), operations = path.join(app, 'release', 'operations');
fs.mkdirSync(operations, {recursive: true});
const database = path.join(work, 'crm.sqlite'), source = path.join(work, 'source.json');
const db = new DatabaseSync(database);
for (const file of fs.readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join('drizzle', file), 'utf8'));
const now = '2026-11-01T08:00:00.000Z';
for (const [id, name] of [['r1', 'مندوب سري'], ['r2', 'مندوب مكرر'], ['r3', 'مندوب مكرر']]) db.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,active,target,created_at,region_scope) VALUES(?,?,?,?,'rep','الرئيسي',1,0,?,'eastern')").run(id, 'u-' + id, id + '@yourrest.org', name, now);
// Yourrest numbers follow insertion: c1=1, c2=2, c3=3.
for (const id of ['c1', 'c2', 'c3']) db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'r1','الرئيسي',?,?,?,1,'fixture')").run(id, JSON.stringify({name: 'مصنع سري ' + id, city: 'الدمام', address: 'حي', code: 'E-' + id}), now, now);
db.close();
const specs = {description: '200*400*27.5TH MM OPEN', core: 'open', vibrators: 2, model: 'old', halfBlock: 'none', moldWidth: 1380, gelbaSize: 795, moldNo: 'YR001-1', quantity: 1, designUrl: 'YR001-1', notes: ''};
const row = (legacyOrderNo, crmNumber, salesmanName, extra = {}) => ({legacyOrderNo, requestedAt: '2026-04-19T13:45:47+03:00', customer: {crmNumber, nameRaw: 'اسم من الشيت'}, salesmanName, specs: {...specs, ...extra}});
fs.writeFileSync(source, JSON.stringify({requests: [
  row(1, 1, 'مندوب سري'), row(2, 2, ' مندوب  سري ', {designUrl: 'https://drive.google.com/d/1'}), row(3, 3, 'مندوب غير موجود'),
  row(4, 1, 'مندوب مكرر'), row(5, 50, 'مندوب سري'), row(6, 2, 'مندوب سري', {moldWidth: 50})
]}));
const script = path.resolve('scripts/diagnose/mold-link-dry-run.cjs');
const run = env => spawnSync(process.execPath, [script], {env: {PATH: process.env.PATH, HOME: work, MOLD_DIAG_APP: app, MOLD_DIAG_SOURCE: source, MOLD_IMPORT_DATABASE: database, NODE_NO_WARNINGS: '1', ...env}, encoding: 'utf8'});
const VERDICT = 'ROWS 6: TO LINK 2, REPRESENTATIVE_NOT_FOUND 1, REPRESENTATIVE_AMBIGUOUS 1, CUSTOMER_NOT_FOUND 1, SPECS_INVALID 1, DESIGN LINKS NOT KEPT 1';
const NAMES = /مصنع|مندوب|اسم/;

// Before the update the live release has no tool: a clear stop.
let result = run();
ok(result.stdout.includes('DIAGNOSE STOP') && result.stdout.includes('deploy the mold requests update first'), 'no tool yet: says so');
eq(result.status, 1, 'and fails');
for (const file of ['mold-import.mjs', 'mold-rules.mjs', 'mold-client.mjs']) fs.copyFileSync(path.join('portable', file), path.join(operations, file));
const before = fs.readFileSync(database);
result = run();
eq(result.status, 0, result.stdout + result.stderr);
const lines = result.stdout.trim().split('\n'), report = JSON.parse(lines.slice(0, -1).join('\n'));
eq([report.mode, report.readOnly, report.key, report.rows], ['dry-run', true, 'yourrest', 6], 'a dry run with the Yourrest code');
eq(report.toLink, [1, 2], 'linked: the exact customer number and the exact representative name only (spaces aside)');
eq(report.skipped, {representative_not_found: [3], representative_ambiguous: [4], customer_not_found: [5], specs_invalid: [6]}, 'every skipped order with its reason');
eq(lines.at(-1), VERDICT, 'a one-line verdict');
ok(!NAMES.test(result.stdout), 'no names in the output');
ok(fs.readFileSync(database).equals(before), 'the database is unchanged');
// No source file: a clear stop.
result = run({MOLD_DIAG_SOURCE: path.join(work, 'missing.json')});
ok(result.stdout.includes('DIAGNOSE STOP') && result.stdout.includes('was not found'), 'no source file: says where it looked');
// ---- shaped like the hosting account: settings.cjs (without the products keys: a dry run calls nobody), the live release's
// operations folder, private data, the products folder; nothing in the environment but HOME and PATH.
const home = path.join(work, 'host'), hostApp = path.join(home, 'yourrest-crm'), hostData = path.join(home, 'yourrest-crm-data'), hostOps = path.join(hostApp, 'release', 'operations');
fs.mkdirSync(hostOps, {recursive: true, mode: 0o700}); fs.mkdirSync(path.join(hostData, 'objects'), {recursive: true, mode: 0o700}); fs.chmodSync(hostData, 0o700);
for (const file of ['mold-import.mjs', 'mold-rules.mjs', 'mold-client.mjs', 'config.cjs']) fs.copyFileSync(path.join('portable', file), path.join(hostOps, file));
const hostDatabase = path.join(hostData, 'database.sqlite');
fs.copyFileSync(database, hostDatabase); fs.chmodSync(hostDatabase, 0o600);
fs.writeFileSync(path.join(hostApp, 'settings.cjs'), 'module.exports = ' + JSON.stringify({YR_APP_ORIGIN: 'https://crm.example.org', YR_AUTH_SECRET: 'a'.repeat(64), YR_DATABASE_PATH: hostDatabase, YR_OBJECTS_PATH: path.join(hostData, 'objects'), YR_MAIL_TRANSPORT: 'sendmail', YR_MAIL_FROM: 'noreply@yourrest.org', YR_SENDMAIL_PATH: '/usr/sbin/sendmail'}) + ';\n', {mode: 0o600});
const products = path.join(home, 'public_html', 'products', 'private');
fs.mkdirSync(products, {recursive: true}); fs.copyFileSync(source, path.join(products, 'mold-requests-source.json'));
const onHost = env => spawnSync(process.execPath, [script], {env: {PATH: process.env.PATH, HOME: home, NODE_NO_WARNINGS: '1', ...env}, encoding: 'utf8'});
const hostBefore = fs.readFileSync(hostDatabase);
result = onHost();
eq(result.status, 0, 'on the hosting shape it runs from settings.cjs: ' + result.stdout + result.stderr);
eq(result.stdout.trim().split('\n').at(-1), VERDICT, 'the same verdict from the live layout');
ok(!NAMES.test(result.stdout), 'no names there either');
ok(fs.readFileSync(hostDatabase).equals(hostBefore), 'and the live-shaped database is unchanged');
result = onHost({YR_STRAY: 'x'});
ok(result.status === 1 && result.stdout.includes('Conflicting YR_STRAY'), 'a stray YR_* variable is still refused by the settings check, as it should be');
const text = fs.readFileSync(script, 'utf8');
ok(!/YR_[A-Z_]+ *=|env\.YR_/.test(text), 'the script reads and sets no YR_* variable');
ok(text.includes("'--dry-run'") && !text.includes('--apply') && !text.includes('--show-names'), 'it only ever asks for the dry run, without names');
console.log(JSON.stringify({ok: true, checks, productionDataUsed: false}));
