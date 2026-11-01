// The read-only comparison run on the hosting account (scripts/diagnose/mold-compare.cjs), as a child process against a temporary
// release folder, a temporary database with every migration and a synthetic source: counts and order numbers only, nothing written,
// clear stops when the tool or the source is missing. No real data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-mold-'));
process.on('exit', () => fs.rmSync(work, {recursive: true, force: true}));
const app = path.join(work, 'yourrest-crm'), operations = path.join(app, 'release', 'operations');
fs.mkdirSync(operations, {recursive: true});
const database = path.join(work, 'crm.sqlite'), source = path.join(work, 'source.json');
const db = new DatabaseSync(database);
for (const file of fs.readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join('drizzle', file), 'utf8'));
const now = '2026-11-01T08:00:00.000Z';
for (const [id, code] of [['c1', '9'], ['c2', '2']]) db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'nobody','الرئيسي',?,?,?,1,'fixture')").run(id, JSON.stringify({name: 'مصنع سري ' + id, code}), now, now);
db.close();
const row = (legacyOrderNo, crmNumber) => ({legacyOrderNo, requestedAt: '2026-04-19T13:45:47+03:00', customer: {crmNumber, nameRaw: 'اسم من الشيت'}, salesmanName: 'مندوب سري', specs: {}});
fs.writeFileSync(source, JSON.stringify({requests: [row(1, 1), row(2, 2), row(3, 9), row(4, 50)]}));
const script = path.resolve('scripts/diagnose/mold-compare.cjs');
const run = env => spawnSync(process.execPath, [script], {env: {PATH: process.env.PATH, HOME: work, YR_DIAG_APP: app, YR_DIAG_SOURCE: source, YR_IMPORT_DATABASE: database, NODE_NO_WARNINGS: '1', ...env}, encoding: 'utf8'});

// Before the update the live release has no tool: a clear stop.
let result = run();
ok(result.stdout.includes('DIAGNOSE STOP') && result.stdout.includes('deploy the mold requests update first'), 'no tool yet: says so');
eq(result.status, 1, 'and fails');
for (const file of ['mold-import.mjs', 'mold-rules.mjs', 'mold-client.mjs']) fs.copyFileSync(path.join('portable', file), path.join(operations, file));
const before = fs.readFileSync(database);
result = run();
eq(result.status, 0, result.stdout + result.stderr);
const lines = result.stdout.trim().split('\n'), report = JSON.parse(lines.slice(0, -1).join('\n'));
eq([report.mode, report.readOnly, report.rows, report.yourrest, report.erp, report.both], ['compare', true, 4, 2, 2, 1], 'counts by code');
eq([report.onlyYourrest, report.onlyErp, report.neither], [[1], [3], [4]], 'order numbers by code');
eq(lines.at(-1), 'ROWS 4: YOURREST CODE 2, ERP CODE 2, BOTH 1, NEITHER 1, ERP AMBIGUOUS 0', 'a one-line verdict');
ok(!/مصنع|مندوب|اسم/.test(result.stdout), 'no names in the output');
ok(fs.readFileSync(database).equals(before), 'the database is unchanged');
// No source file: a clear stop.
result = run({YR_DIAG_SOURCE: path.join(work, 'missing.json')});
ok(result.stdout.includes('DIAGNOSE STOP') && result.stdout.includes('was not found'), 'no source file: says where it looked');
console.log(JSON.stringify({ok: true, checks, productionDataUsed: false}));
