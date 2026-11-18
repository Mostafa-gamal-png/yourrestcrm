// Going back from «مسؤول تسويق» and the customer classifications (lib/roles.ts, lib/customer-classification.ts, the owner, 2026-11-18) to
// the release before them (update-rep-search-20261118, commit d753f7f), as docs/OPERATIONS-DEVELOPMENT-GUIDE-AR.md 9-أأ «الرجوع إلى
// الإصدار السابق» says (the review of 2026-11-18: the guide said the fields stay unread; they are erased by any save of the customer
// there). One in-memory SQLite with the real migrations (22 in both: no migration), read and written by this release's POST/GET
// /api/crm and by the previous release's, in turn. What this release writes (the four fields set directly by a marketing officer, a
// supervisor's request carrying one, a marketing officer's direct correction in the history, a member of the role) is read by the
// previous release: a save of the customer there erases the four for good, an approval there drops the request's classification, the
// history shows the raw code, the role has no page there and its member cannot even be saved from the team screen. The guide's steps
// hold: its export command (run with node:sqlite: the machine has no sqlite3) lists every classified customer with its codes and the
// four values, read only; and a role changed to a representative's before going back works there as a representative.
// The previous release's sources come from git (`git archive d753f7f`), or from a tree given as the first argument. Synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';

const PREVIOUS = 'd753f7f';
const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const work = fs.mkdtempSync(path.join(runtime, 'marketing-rollback-'));
process.on('exit', () => fs.rmSync(work, {recursive: true, force: true}));
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

// The previous release's tree: the one given, else its sources from git, inside the worktree so its bare imports resolve here.
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

globalThis.testEnv = {YR_APP_ORIGIN: 'https://test.invalid', YR_AUTH_SECRET: 'a'.repeat(64)};
/** A tree's TypeScript as ES modules in its own folder (as tests/marketing-role.mjs compiles), the auth and the environment stubbed. */
function loader(tree, name) {
  const out = path.join(work, name), seen = new Set();
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'env.mjs'), 'export const env=globalThis.testEnv;');
  fs.writeFileSync(path.join(out, 'auth.mjs'), `export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=?').bind(u.userId).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
  function compile(relative) {
    if (seen.has(relative)) return; seen.add(relative);
    const src = path.join(tree, relative), dest = path.join(out, relative.replace(/\.tsx?$/, '.mjs'));
    fs.mkdirSync(path.dirname(dest), {recursive: true});
    let code = ts.transpileModule(fs.readFileSync(src, 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
    code = code.replace(/from (['"])([^'"]+)\1/g, (match, q, imp) => {
      if (imp === 'cloudflare:workers') return 'from ' + JSON.stringify(path.join(out, 'env.mjs'));
      if (imp === '@/app/application-auth') return 'from ' + JSON.stringify(path.join(out, 'auth.mjs'));
      if (!imp.startsWith('.') && !imp.startsWith('@/')) return match;
      let source = imp.startsWith('@/') ? imp.slice(2) : path.relative(tree, path.resolve(path.dirname(src), imp));
      if (/\.json$/.test(source)) { const target = path.join(out, source); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.copyFileSync(path.join(tree, source), target); return 'from ' + JSON.stringify(target) + ' with {type:"json"}'; }
      if (/\.(mjs|js)$/.test(source)) return 'from ' + JSON.stringify(pathToFileURL(path.join(tree, source)).href);
      if (/\.css$/.test(source)) return 'from "data:text/javascript,"';
      if (!/\.tsx?$/.test(source)) source += fs.existsSync(path.join(tree, source + '.ts')) ? '.ts' : '.tsx';
      compile(source); return 'from ' + JSON.stringify(path.join(out, source.replace(/\.tsx?$/, '.mjs')));
    });
    code = code.replace(/^import\s+(['"])[^'"]+\.css\1;?$/mg, '');
    fs.writeFileSync(dest, code);
  }
  return {route: async route => { compile('app/api/' + route + '/route.ts'); return import(pathToFileURL(path.join(out, 'app/api/' + route + '/route.mjs'))); },
    lib: async lib => { compile('lib/' + lib + '.ts'); return import(pathToFileURL(path.join(out, 'lib/' + lib + '.mjs'))); }};
}

// ---- One database, both releases.
const sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON');
for (const file of migrations(root)) sql.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8'));
class Statement { constructor(q, a = []) { this.q = q; this.a = a; } bind(...a) { return new Statement(this.q, a); } async run() { const r = sql.prepare(this.q).run(...this.a); return {meta: {changes: Number(r.changes)}}; } async all() { return {results: sql.prepare(this.q).all(...this.a)}; } async first() { return sql.prepare(this.q).get(...this.a) || null; } }
let pending = Promise.resolve();
globalThis.testEnv.DB = {prepare: q => new Statement(q), batch: statements => { const run = pending.then(async () => { sql.exec('BEGIN'); try { const results = []; for (const s of statements) results.push(await s.run()); sql.exec('COMMIT'); return results; } catch (e) { sql.exec('ROLLBACK'); throw e; } }); pending = run.catch(() => {}); return run; }};
const now = new Date().toISOString();
const member = (id, role, sup = null, region = 'eastern', branch = 'الرئيسي') => sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id, 'u-' + id, id + '@yourrest.org', 'اسم ' + id, role, branch, sup, region, now);
member('owner', 'admin', null, 'all'); member('mgr', 'manager', null, 'all'); member('sup', 'supervisor', 'mgr'); member('rep', 'rep', 'sup'); member('mkt', 'marketing', 'sup');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const user = id => { globalThis.testUser = id ? {userId: 'u-' + id, email: id + '@yourrest.org', fullName: id} : null; };
const raw = id => sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id), row = id => ({...raw(id), data: JSON.parse(raw(id).data)});
const request = body => new Request('https://test.invalid/api/crm', {method: 'POST', headers: {origin: 'https://test.invalid', 'content-type': 'application/json'}, body: JSON.stringify(body)});
const current = await loader(root, 'current').route('crm'), before = loader(previous, 'previous'), old = await before.route('crm');
const post = async (crm, who, body, status = 200) => { user(who); const res = await crm.POST(request(body)), data = await res.json(); eq(res.status, status, who + ' ' + JSON.stringify(body).slice(0, 120) + ' -> ' + JSON.stringify(data).slice(0, 200)); return data; };
const read = async (crm, who) => { user(who); const res = await crm.GET(); return {status: res.status, body: await res.json()}; };
const edit = (id, extra = {}) => { const value = row(id); return {action: 'save', kind: 'customer', id, version: value.version, editKey: crypto.randomUUID(), data: {...value.data, assignedTo: value.assigned_to, branch: value.branch, ...extra}}; };
const FIELDS = ['opportunityGrade', 'gradeNotes', 'factorySize', 'customerInterest'];
const four = id => FIELDS.map(field => row(id).data[field]);

// ---- This release writes.
const created = {};
for (const [key, name] of [['rep', 'مصنع المندوب'], ['mkt', 'مصنع التسويق'], ['plain', 'مصنع بلا تصنيف']]) {
  created[key] = (await post(current, 'mgr', {action: 'save', kind: 'customer', createKey: crypto.randomUUID(), data: {name, region: 'الشرقية', city: 'الدمام', phone: '0500000000', location: '26.437341, 50.034499', branch: 'الرئيسي', assignedTo: key === 'mkt' ? 'mkt' : 'rep'}})).id;
}
const [cRep, cMkt, cPlain] = [created.rep, created.mkt, created.plain];
await post(current, 'mkt', edit(cRep, {opportunityGrade: 'A', gradeNotes: 'صاحب القرار، طلب "عرض سعر"\nوزيارة ثانية', factorySize: 'D', customerInterest: 'price'}));
await post(current, 'mkt', edit(cMkt, {opportunityGrade: 'B', factorySize: 'C', customerInterest: 'trust'}));
eq([four(cRep), four(cMkt)], [['A', 'صاحب القرار، طلب "عرض سعر"\nوزيارة ثانية', 'D', 'price'], ['B', undefined, 'C', 'trust']], 'this release stores the four on the customer');
const waitingRequest = await post(current, 'sup', edit(cMkt, {opportunityGrade: 'A', phone: '0522222222'}));
eq([waitingRequest.pendingApproval, waitingRequest.approvalStage], [true, 'sales_manager'], 'a supervisor\'s request carrying a classification waits for the sales manager');
eq(sql.prepare("SELECT COUNT(*) AS n FROM crm_audit WHERE action='customer-edit:direct'").get().n, 2, 'the marketing officer\'s two direct corrections are in the history');

// ---- The guide's export, before going back: the one command it gives, run here with node:sqlite (no sqlite3 on this machine).
const guide = fs.readFileSync(path.join(root, 'docs/OPERATIONS-DEVELOPMENT-GUIDE-AR.md'), 'utf8');
const section = guide.slice(guide.indexOf('## 9-أأ.'), guide.indexOf('\n## 10.'));
ok(section.includes('**الرجوع إلى الإصدار السابق'), 'the guide has the way back in its section');
ok(!section.includes('يترك الحقول في بيانات العملاء دون قراءة'), 'and no longer says the fields are only left unread');
const commands = [...section.matchAll(/^sqlite3 .+$/mg)].map(match => match[0]);
eq(commands.length, 1, 'one sqlite3 command');
const command = commands[0];
ok(/^sqlite3 -readonly -header -csv \S+ ".+" > customer-classifications\.csv$/.test(command), 'read only, with a header, as CSV, into one file: ' + command.slice(0, 80));
const query = command.match(/ "(.+)" > /)[1];
ok(/^SELECT /.test(query) && !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|PRAGMA)\b/i.test(query), 'a SELECT and nothing that writes');
ok(!/["`\\]|\$\(|\$\{|\$[A-Za-z_]/.test(query), 'nothing the shell would expand or end inside the double quotes');
// The command as a shell reads it: a stand-in sqlite3 on the PATH writes the arguments it was given into the file the command names.
const shell = path.join(work, 'shell'), stub = path.join(shell, 'bin', 'sqlite3');
fs.mkdirSync(path.dirname(stub), {recursive: true});
fs.writeFileSync(stub, '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n', {mode: 0o755});
execFileSync('bash', ['-c', command], {cwd: shell, env: {...process.env, PATH: path.dirname(stub) + path.delimiter + process.env.PATH}});
eq(JSON.parse(fs.readFileSync(path.join(shell, 'customer-classifications.csv'), 'utf8')), ['-readonly', '-header', '-csv', '/home/ACCOUNT/yourrest-crm-data/database.sqlite', query], 'bash hands sqlite3 the query exactly, into customer-classifications.csv');
const exported = sql.prepare(query).all();
eq(Object.keys(exported[0]), ['customer_id', 'yourrest_code', 'erp_code', 'name', 'opportunity_grade', 'grade_notes', 'factory_size', 'customer_interest'], 'its columns');
eq(exported.map(line => ({...line})), [cMkt, cRep].sort().map(id => ({customer_id: id, yourrest_code: sql.prepare("SELECT printf('YR-C-%06d',number) AS code FROM crm_customer_numbers WHERE customer_id=?").get(id).code, erp_code: '', name: row(id).data.name, opportunity_grade: row(id).data.opportunityGrade ?? null, grade_notes: row(id).data.gradeNotes ?? null, factory_size: row(id).data.factorySize ?? null, customer_interest: row(id).data.customerInterest ?? null})), 'every classified customer with its codes and the four values (a customer with none is not listed)');
ok(exported.every(line => /^YR-C-\d{6}$/.test(line.yourrest_code)), 'the Yourrest code as the page writes it');
ok(!exported.some(line => line.customer_id === cPlain), 'nothing for a customer with no classification');

// ---- The marketing member in the previous release, before its role is changed.
let page = await read(old, 'mkt');
eq(page.status, 200, 'the previous release answers the marketing member');
const oldAccess = await before.lib('access');
eq(['customer', 'map', 'activity', 'followup', 'targets', 'mold-requests'].filter(view => oldAccess.canViewPage('marketing', view)), [], 'but gives the role no page');
const team = (await read(old, 'owner')).body.members.find(entry => entry.id === 'mkt');
const memberSave = extra => ({action: 'member', memberSnapshot: team.editToken, data: {id: 'mkt', name: 'اسم mkt', email: 'mkt@yourrest.org', role: 'marketing', branch: 'الرئيسي', supervisorId: 'sup', regionScope: 'eastern', active: 1, target: 0, ...extra}});
ok(/Invalid enum value/.test((await post(old, 'owner', memberSave({}), 400)).error), 'its administrator cannot save the member there (role unknown: 400)');
ok(/Invalid enum value/.test((await post(old, 'owner', memberSave({active: 0}), 400)).error), 'not even to deactivate them');
eq({...sql.prepare("SELECT role,active FROM crm_members WHERE id='mkt'").get()}, {role: 'marketing', active: 1}, 'so the guide says: change the role before going back');

// ---- The history and the classifications in the previous release.
const directLines = audits => audits.filter(audit => audit.action === 'customer-edit:direct');
const ownerDirect = directLines((await read(old, 'owner')).body.audits);
eq([ownerDirect.length, Array.isArray(JSON.parse(ownerDirect[0].detail).fields)], [2, true], 'a direct correction reads there as its code with its JSON (the administrator), as the guide says');
page = await read(old, 'mgr');
eq(directLines(page.body.audits).length, 0, 'the sales manager does not see them while their author\'s role is unknown there');
eq(FIELDS.map(field => page.body.records.find(record => record.id === cRep).data[field]), four(cRep), 'its page receives the four with the customer\'s data (it has no field to draw them)');
const repOld = (await read(old, 'rep')).body.records.find(record => record.id === cMkt).data;
eq(FIELDS.map(field => repOld[field]), four(cMkt), 'to every reader, a representative for another\'s customer too (the guide says so)');
eq(four(cRep)[0], 'A', 'reading there erases nothing');
// A save of the customer there erases the four for good.
await post(old, 'mgr', edit(cRep, {phone: '0511111111'}));
eq([row(cRep).data.phone, four(cRep)], ['0511111111', [undefined, undefined, undefined, undefined]], 'a save of the customer in the previous release erases the four');
// The supervisor's request approved there: its other fields only.
const approved = await post(old, 'mgr', {action: 'customer-edit', decision: 'approve', id: waitingRequest.requestId});
eq([approved.status, row(cMkt).data.phone, row(cMkt).data.opportunityGrade], ['approved', '0522222222', undefined], 'a waiting request approved there applies its other fields and drops the classification (and the save erases the rest)');
eq(four(cMkt), [undefined, undefined, undefined, undefined], 'the customer\'s four are gone with it');
// Back to this release: nothing comes back by itself; the export holds them.
const back = await read(current, 'mgr');
eq(FIELDS.some(field => field in back.body.records.find(record => record.id === cRep).data), false, 'coming back to this release does not bring them back');
eq(exported.find(line => line.customer_id === cRep).opportunity_grade, 'A', 'the export taken before going back still has them');

// ---- The guide's step: the role changed to a representative's in this release, before going back.
const currentTeam = (await read(current, 'owner')).body.members.find(entry => entry.id === 'mkt');
await post(current, 'owner', {action: 'member', memberSnapshot: currentTeam.editToken, data: {id: 'mkt', name: 'اسم mkt', email: 'mkt@yourrest.org', role: 'rep', branch: 'الرئيسي', supervisorId: 'sup', regionScope: ['eastern'], active: 1, target: 0}});
eq(sql.prepare("SELECT role FROM crm_members WHERE id='mkt'").get().role, 'rep', 'this release changes the role');
eq(directLines((await read(old, 'mgr')).body.audits).length, 2, 'the sales manager then reads the history lines there too (by their code)');
page = await read(old, 'mkt');
eq([page.status, page.body.me.role, oldAccess.canViewPage(page.body.me.role, 'customer')], [200, 'rep', true], 'the previous release then serves them as a representative');
ok(page.body.records.some(record => record.id === cMkt), 'with their customers');
const oldTeam = (await read(old, 'owner')).body.members.find(entry => entry.id === 'mkt');
await post(old, 'owner', {action: 'member', memberSnapshot: oldTeam.editToken, data: {id: 'mkt', name: 'اسم mkt', email: 'mkt@yourrest.org', role: 'rep', branch: 'الرئيسي', supervisorId: 'sup', regionScope: 'eastern', active: 0, target: 0}});
eq(sql.prepare("SELECT active FROM crm_members WHERE id='mkt'").get().active, 0, 'and their administrator can save (here: deactivate) them there');

console.log(JSON.stringify({ok: true, checks, previous: process.argv[2] ? 'argument' : PREVIOUS, realSqlite: true, sqlite3Cli: false, productionDataUsed: false}));
