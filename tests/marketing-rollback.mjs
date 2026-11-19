// Going back from the owner's correction of the classifications (2026-11-18: «تصنيف الفرصة ده موجود بالفعل بس هيزيد / تصنيف حجم المصنع ده
// بيتحسب من عدد ماكينات المتسجلة داخل المصنع / وهو هيدخل التصنيف العميل بناء على اهتماماته») to the release live before it
// (update-marketing-20261118, commit 0d35aa6), as docs/OPERATIONS-DEVELOPMENT-GUIDE-AR.md 9-أب «الرجوع إلى الإصدار السابق» says. One
// in-memory SQLite with the real migrations (22 in both: no migration), read and written in turn by both releases' POST/GET /api/crm and
// POST /api/visits. The customer-level grade, notes and size the previous release stored survive this release's saves untouched and read
// there as before; «اهتمام العميل» is the same field in both. A visit's «قوة الفرصة» D (`excluded`), which only this release writes: the
// previous release sends it to the page but has no words for it (the visits list «غير مسجلة», the queue's chip the code itself, ranked as
// no grade), refuses to save that visit while it keeps D (400) and saves it once another grade is chosen; its service-opportunity form
// refuses D too. The guide's export of 9-أأ (the release before) still lists every classified customer: run with node:sqlite (the machine
// has no sqlite3), and handed by bash to a stand-in sqlite3 exactly as written. The previous release's sources come from git
// (`git archive 0d35aa6`), or from a tree given as the first argument. Synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';

const PREVIOUS = '0d35aa6';
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
// A later release's 0022 (the daily plans, 2026-11-19) is left out: these are the two releases' own migrations, up to 0021.
const migrations = tree => fs.readdirSync(path.join(tree, 'drizzle')).filter(name => name.endsWith('.sql') && name <= '0021_service_sales_process.sql').sort();
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
const now2 = loader(root, 'current'), before = loader(previous, 'previous');
const current = await now2.route('crm'), old = await before.route('crm'), currentVisits = await now2.route('visits'), oldVisits = await before.route('visits');
const post = async (crm, who, body, status = 200) => { user(who); const res = await crm.POST(request(body)), data = await res.json(); eq(res.status, status, who + ' ' + JSON.stringify(body).slice(0, 120) + ' -> ' + JSON.stringify(data).slice(0, 200)); return data; };
const read = async (crm, who) => { user(who); const res = await crm.GET(); return {status: res.status, body: await res.json()}; };
const edit = (id, extra = {}) => { const value = row(id); return {action: 'save', kind: 'customer', id, version: value.version, editKey: crypto.randomUUID(), data: {...value.data, assignedTo: value.assigned_to, branch: value.branch, ...extra}}; };

// ---- The previous release (live) writes the customer-level classifications, as it lets the marketing officer.
const FIELDS = ['opportunityGrade', 'gradeNotes', 'factorySize', 'customerInterest'];
const four = id => FIELDS.map(field => row(id).data[field]);
const created = {};
for (const [key, name] of [['rep', 'مصنع المندوب'], ['mkt', 'مصنع التسويق'], ['plain', 'مصنع بلا تصنيف']]) {
  created[key] = (await post(old, 'mgr', {action: 'save', kind: 'customer', createKey: crypto.randomUUID(), data: {name, region: 'الشرقية', city: 'الدمام', phone: '0500000000', location: '26.437341, 50.034499', branch: 'الرئيسي', assignedTo: key === 'mkt' ? 'mkt' : 'rep'}})).id;
}
const [cRep, cMkt, cPlain] = [created.rep, created.mkt, created.plain];
const NOTES = 'صاحب القرار، طلب "عرض سعر"\nوزيارة ثانية';
await post(old, 'mkt', edit(cRep, {opportunityGrade: 'A', gradeNotes: NOTES, factorySize: 'D', customerInterest: 'price'}));
await post(old, 'mkt', edit(cMkt, {opportunityGrade: 'B', factorySize: 'C', customerInterest: 'trust'}));
eq([four(cRep), four(cMkt)], [['A', NOTES, 'D', 'price'], ['B', undefined, 'C', 'trust']], 'the previous release stores the four on the customer');

// ---- This release: every save carries the grade, the notes and the size untouched; the interest is the same field.
await post(current, 'mgr', edit(cRep, {phone: '0511111111'}));
await post(current, 'mkt', edit(cRep, {city: 'الخبر', opportunityGrade: 'C', factorySize: 'A', gradeNotes: ''}));
eq([row(cRep).data.phone, row(cRep).data.city, ...four(cRep)], ['0511111111', 'الخبر', 'A', NOTES, 'D', 'price'], 'this release\'s saves leave the three exactly as the previous release stored them, whatever they send');
await post(current, 'mkt', edit(cMkt, {customerInterest: 'service'}));
eq(four(cMkt), ['B', undefined, 'C', 'service'], 'the interest changes as in the previous release');
// ---- Back in the previous release: everything reads as it left it, and its own saves keep it.
let page = await read(old, 'mgr');
eq(FIELDS.map(field => page.body.records.find(record => record.id === cRep).data[field]), ['A', NOTES, 'D', 'price'], 'the previous release reads the grade, the notes and the size it stored');
await post(old, 'mgr', edit(cRep, {phone: '0522222222'}));
eq(four(cRep), ['A', NOTES, 'D', 'price'], 'and its saves keep them (its schema knows them)');

// The guide's commands as a shell reads them: a stand-in sqlite3 on the PATH writes the arguments it was given into the file named.
const shell = path.join(work, 'shell'), stub = path.join(shell, 'bin', 'sqlite3');
fs.mkdirSync(path.dirname(stub), {recursive: true});
fs.writeFileSync(stub, '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n', {mode: 0o755});
const asShellRuns = (command, file) => { execFileSync('bash', ['-c', command], {cwd: shell, env: {...process.env, PATH: path.dirname(stub) + path.delimiter + process.env.PATH}}); return JSON.parse(fs.readFileSync(path.join(shell, file), 'utf8')); };
const readOnlyQuery = (command, file) => {
  ok(new RegExp('^sqlite3 -readonly -header -csv \\S+ ".+" > ' + file.replace('.', '\\.') + '$').test(command), 'read only, with a header, as CSV, into ' + file + ': ' + command.slice(0, 80));
  const query = command.match(/ "(.+)" > /)[1];
  ok(/^SELECT /.test(query) && !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|PRAGMA)\b/i.test(query), 'a SELECT and nothing that writes');
  ok(!/["`\\]|\$\(|\$\{|\$[A-Za-z_]/.test(query), 'nothing the shell would expand or end inside the double quotes');
  eq(asShellRuns(command, file), ['-readonly', '-header', '-csv', '/home/ACCOUNT/yourrest-crm-data/database.sqlite', query], 'bash hands sqlite3 the query exactly, into ' + file);
  return query;
};

// ---- A visit's «قوة الفرصة» D (`excluded`): only this release writes it.
const stamp = '2026-11-10T07:00:00.000Z';
const visitData = {visitWorkflow: 'customer-v1', type: 'call', date: '2026-11-10', summary: 'تعريف بمنتجات الشركة', result: 'العميل مرتبط بمورده', nextAction: 'متابعة بعد شهر', nextDate: '2099-12-10', salesStage: 'new', strength: 'excluded', requestedProducts: [], hasCompetitor: false, competitorName: '', competitorNotes: '', performedBy: 'rep', responsibleId: 'rep', recordedByEmail: 'rep@yourrest.org', location: '26.437341, 50.034499', latitude: 26.437341, longitude: 50.034499, locationSource: 'device', locationCapturedAt: stamp, locationAccuracy: 5, startedAt: stamp, endedAt: stamp, customerNeeds: ''};
sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES('v-d','activity',?,'rep','الرئيسي',?,?,?,1)").run(cRep, JSON.stringify(visitData), stamp, stamp);
const visitRequest = body => new Request('https://test.invalid/api/visits', {method: 'POST', headers: {origin: 'https://test.invalid', 'content-type': 'application/json'}, body: JSON.stringify(body)});
const saveVisit = async (route, who, data, status) => { user(who); const visit = row('v-d'), res = await route.POST(visitRequest({createKey: crypto.randomUUID(), id: 'v-d', version: visit.version, customerId: cRep, customerVersion: row(cRep).version, timingMode: 'automatic', data})), body = await res.json(); eq(res.status, status, who + ' saves the visit -> ' + JSON.stringify(body).slice(0, 200)); return body; };
await saveVisit(currentVisits, 'mgr', {...visitData, summary: 'مراجعة المدير'}, 200);
eq([row('v-d').data.strength, row('v-d').data.summary], ['excluded', 'مراجعة المدير'], 'this release edits it and keeps D');
// A customer-service opportunity with D, and one with another grade.
for (const [id, grade] of [['case-d', 'excluded'], ['case-b', 'medium']]) sql.prepare("INSERT INTO crm_service_cases(id,customer_id,status,creator_id,data,created_at,updated_at,version,mutation_id) VALUES(?,?,'pending_approval','rep',?,?,?,1,'fixture')").run(id, cMkt, JSON.stringify({source: 'call', products: [], strength: grade, needs: 'احتياج', nextAction: 'اتصال', nextDate: '2099-12-10'}), stamp, stamp);
// The guide's listing of the D, before going back.
const correctionGuide = fs.readFileSync(path.join(root, 'docs/OPERATIONS-DEVELOPMENT-GUIDE-AR.md'), 'utf8'), correctionSection = correctionGuide.slice(correctionGuide.indexOf('## 9-أب.'), correctionGuide.indexOf('\n## 10.'));
const dCommands = [...correctionSection.matchAll(/^sqlite3 .+$/mg)].map(match => match[0]);
eq(dCommands.length, 1, 'the way back lists the D with one sqlite3 command');
const dQuery = readOnlyQuery(dCommands[0], 'excluded-opportunities.csv');
eq(sql.prepare(dQuery).all().map(line => ({...line})), [{source: 'service', record_id: 'case-d', visit_number: null, customer: 'مصنع التسويق', day: '2026-11-10'}, {source: 'visit', record_id: 'v-d', visit_number: row('v-d').data.visitNumber, customer: 'مصنع المندوب', day: '2026-11-10'}], 'it lists the visit and the service opportunity with D, and nothing else');
page = await read(old, 'mgr');
eq(page.body.records.find(record => record.id === 'v-d').data.strength, 'excluded', 'the previous release sends D to the page as stored');
const oldStrength = await before.lib('customer-visits'), oldQueue = await before.lib('service-queue'), oldService = await before.lib('customer-service');
eq([oldStrength.strengthLabels.excluded, oldStrength.strengthLabels.strong], [undefined, 'قوية'], 'but has no words for it: its visits list writes «غير مسجلة» and its queue\'s chip the code itself');
const entry = (id, strength) => ({id, awaiting: null, late: false, strength, stageSince: id});
eq(oldQueue.sortQueue([entry('1-d', 'excluded'), entry('2-none', ''), entry('3-c', 'weak'), entry('4-a', 'strong')]).map(item => item.id), ['4-a', '3-c', '1-d', '2-none'], 'its queue ranks D as no grade (after C, by age with the ungraded)');
const refused = await saveVisit(oldVisits, 'mgr', {...row('v-d').data, summary: 'تعديل في الإصدار السابق'}, 400);
ok(typeof refused.error === 'string' && refused.error.length > 0, 'the previous release refuses to save a visit that keeps D: ' + refused.error);
eq([row('v-d').data.strength, row('v-d').data.summary], ['excluded', 'مراجعة المدير'], 'nothing is written');
await saveVisit(oldVisits, 'mgr', {...row('v-d').data, strength: 'weak', summary: 'تعديل في الإصدار السابق'}, 200);
eq([row('v-d').data.strength, row('v-d').data.summary], ['weak', 'تعديل في الإصدار السابق'], 'once another grade is chosen it saves');
const oldIntake = oldService.serviceIntakeSchemaForDay(), intakeStrength = (oldIntake.shape || oldIntake._def.schema.shape).strength;
eq([intakeStrength.safeParse('excluded').success, intakeStrength.safeParse('weak').success], [false, true], 'its customer-service opportunity form refuses D too');
const NEW_REFUSAL = refused.error;

// ---- The guide.
const guide = fs.readFileSync(path.join(root, 'docs/OPERATIONS-DEVELOPMENT-GUIDE-AR.md'), 'utf8');
const section = guide.slice(guide.indexOf('## 9-أأ.'), guide.indexOf('\n## 9-أب.'));
const correction = guide.slice(guide.indexOf('## 9-أب.'), guide.indexOf('\n## 10.'));
ok(guide.includes('## 9-أب.') && correction.includes('**الرجوع إلى الإصدار السابق (update-marketing-20261118).**'), 'the guide has the way back from this release');
ok(correction.includes('«قوة الفرصة»') && correction.includes('`excluded`') && correction.includes(NEW_REFUSAL), 'it names the D and the refusal the previous release answers with: ' + NEW_REFUSAL);
ok(section.includes('**الرجوع إلى الإصدار السابق (update-rep-search-20261118).**'), 'and keeps the way back of the release before');
// The export of 9-أأ, the one sqlite3 command of the chapter, on the classifications the previous release stored.
const commands = [...section.matchAll(/^sqlite3 .+$/mg)].map(match => match[0]);
eq(commands.length, 1, 'one sqlite3 command in 9-أأ');
const command = commands[0];
const query = readOnlyQuery(command, 'customer-classifications.csv');
const exported = sql.prepare(query).all();
eq(Object.keys(exported[0]), ['customer_id', 'yourrest_code', 'erp_code', 'name', 'opportunity_grade', 'grade_notes', 'factory_size', 'customer_interest'], 'its columns');
eq(exported.map(line => ({...line})), [cMkt, cRep].sort().map(id => ({customer_id: id, yourrest_code: sql.prepare("SELECT printf('YR-C-%06d',number) AS code FROM crm_customer_numbers WHERE customer_id=?").get(id).code, erp_code: '', name: row(id).data.name, opportunity_grade: row(id).data.opportunityGrade ?? null, grade_notes: row(id).data.gradeNotes ?? null, factory_size: row(id).data.factorySize ?? null, customer_interest: row(id).data.customerInterest ?? null})), 'every classified customer with its codes and the four values (a customer with none is not listed)');
ok(exported.every(line => /^YR-C-\d{6}$/.test(line.yourrest_code)), 'the Yourrest code as the page writes it');
ok(!exported.some(line => line.customer_id === cPlain), 'nothing for a customer with no classification');

console.log(JSON.stringify({ok: true, checks, previous: process.argv[2] ? 'argument' : PREVIOUS, refusal: NEW_REFUSAL, realSqlite: true, sqlite3Cli: false, productionDataUsed: false}));
