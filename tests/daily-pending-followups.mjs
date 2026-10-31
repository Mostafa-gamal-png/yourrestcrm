// The follow-ups a day's report lists as due (lib/daily-followups.ts): each customer's latest plan as it stood on the chosen Saudi day,
// due on or before that day, with a next action, open, and made by a member in the reader's scope. Records saved after the day do not
// leak into it (the report shows the day as it was known), the day is Riyadh's (a visit saved at 01:30 Riyadh on the 21st is still
// the 20th in UTC), an offline visit counts from when it was recorded, and the list is ordered by date, name and id.
// tests/daily-report.mjs covers how the report shows the list; this is how the list is made. No database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'daily-pending-followups-')), seen = new Set();
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
function compile(relative) {
  if (seen.has(relative)) return; seen.add(relative);
  const src = path.join(root, relative), dest = path.join(out, relative.replace(/\.tsx?$/, '.mjs')); fs.mkdirSync(path.dirname(dest), {recursive: true});
  let code = ts.transpileModule(fs.readFileSync(src, 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
  code = code.replace(/from (['"])([^'"]+)\1/g, (match, quote, imported) => {
    if (!imported.startsWith('.')) return match;
    let child = path.relative(root, path.resolve(path.dirname(src), imported));
    if (!/\.tsx?$/.test(child)) child += fs.existsSync(path.join(root, child + '.ts')) ? '.ts' : '.tsx';
    compile(child); return 'from ' + JSON.stringify(path.join(out, child.replace(/\.tsx?$/, '.mjs')));
  });
  fs.writeFileSync(dest, code);
}
compile('lib/daily-followups.ts');
const {dailyPendingFollowups: due} = await import(path.join(out, 'lib/daily-followups.mjs'));

let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const members = [{id: 'rep', name: 'أحمد', email: 'rep@yourrest.org', role: 'rep'}, {id: 'rep2', name: 'سالم', email: 'rep2@yourrest.org', role: 'rep'}, {id: 'outsider', name: 'خارج', email: 'out@yourrest.org', role: 'rep'}];
const scope = new Set(['rep', 'rep2']);
const customer = (id, name, assignedTo = 'rep') => ({id, kind: 'customer', parentId: null, assignedTo, branch: 'الرئيسي', data: {name}, createdAt: '2026-09-01T08:00:00.000Z', updatedAt: '2026-09-01T08:00:00.000Z', version: 1});
// A visit made on `date`, saved at `at` (UTC), planning `nextAction` on `nextDate`.
const visit = (id, parentId, {date = '2026-10-20', at = '2026-10-20T08:00:00.000Z', nextDate = '2026-10-25', nextAction = 'اتصال متابعة', by = 'rep', stage = 'new', extra = {}} = {}) =>
  ({id, kind: 'activity', parentId, assignedTo: by, branch: 'الرئيسي', data: {type: 'visit', date, visitWorkflow: 'customer-v1', result: 'تمت الزيارة', salesStage: stage, nextAction, nextDate, performedBy: by, ...extra}, createdAt: at, updatedAt: at, version: 1});
const list = (records, date, memberId = 'all') => due(records, members, scope, date, memberId);
const idsOf = items => items.map(item => item.id);

// ---- the basic case
const base = [customer('c1', 'مصنع الأمل'), visit('v1', 'c1')];
eq(list(base, '2026-10-25'), [{id: 'v1', customerId: 'c1', customerName: 'مصنع الأمل', memberId: 'rep', memberName: 'أحمد', nextDate: '2026-10-25', nextAction: 'اتصال متابعة'}], 'due on its day: listed with the customer and the member');
eq(idsOf(list(base, '2026-10-30')), ['v1'], 'overdue: still listed');
eq(list(base, '2026-10-24'), [], 'not yet due: not listed');

// ---- the day as it was known: nothing saved after it
eq(list(base, '2026-10-19'), [], 'a visit made after the chosen day is not known on that day');
eq(list([customer('c1', 'مصنع الأمل'), visit('v1', 'c1', {date: '2026-10-20', at: '2026-10-26T08:00:00.000Z'})], '2026-10-25'), [], 'a visit dated earlier but saved after the day was not known on that day');
const followed = [...base, visit('v2', 'c1', {date: '2026-10-26', at: '2026-10-26T08:00:00.000Z', nextDate: '2026-11-02', nextAction: 'عرض سعر'})];
eq(idsOf(list(followed, '2026-10-25')), ['v1'], 'on the 25th the plan was the first visit\'s');
eq(list(followed, '2026-10-30'), [], 'on the 30th the newer visit had moved the plan to November');
eq(idsOf(list(followed, '2026-11-02')), ['v2'], 'and on the 2nd of November that plan is due');

// ---- the Saudi day, not the UTC day
// A visit of the 20th entered after midnight Riyadh: still the 20th in UTC, already the 21st in Riyadh.
const lateNight = [customer('c1', 'مصنع الأمل'), visit('v1', 'c1', {date: '2026-10-20', at: '2026-10-20T22:30:00.000Z', nextDate: '2026-10-20'})];
eq(list(lateNight, '2026-10-20'), [], 'saved at 01:30 Riyadh on the 21st (22:30 UTC on the 20th): not known on the 20th');
eq(idsOf(list(lateNight, '2026-10-21')), ['v1'], 'known (and overdue) on the 21st');
const evening = [customer('c1', 'مصنع الأمل'), visit('v1', 'c1', {date: '2026-10-20', at: '2026-10-20T20:30:00.000Z', nextDate: '2026-10-20'})];
eq(idsOf(list(evening, '2026-10-20')), ['v1'], 'saved at 23:30 Riyadh on the 20th: known on the 20th');

// ---- an offline visit counts from when it was recorded on the phone
const offline = [customer('c1', 'مصنع الأمل'), visit('v1', 'c1', {date: '2026-10-20', at: '2026-10-27T08:00:00.000Z', nextDate: '2026-10-22', extra: {offlineRecordedAt: '2026-10-20T08:00:00.000Z'}})];
eq(idsOf(list(offline, '2026-10-22')), ['v1'], 'recorded on the phone on the 20th, uploaded on the 27th: known from the 20th');

// ---- what is not a pending follow-up
eq(list([customer('c1', 'مصنع الأمل'), visit('v1', 'c1', {stage: 'won'})], '2026-10-30'), [], 'a won customer has nothing to follow up');
eq(list([customer('c1', 'مصنع الأمل'), visit('v1', 'c1', {stage: 'lost'})], '2026-10-30'), [], 'a lost customer neither');
eq(list([customer('c1', 'مصنع الأمل'), visit('v1', 'c1', {extra: {followupStatus: 'closed'}})], '2026-10-30'), [], 'a closed follow-up neither');
eq(list([customer('c1', 'مصنع الأمل'), visit('v1', 'c1', {nextAction: '   '})], '2026-10-30'), [], 'no next action: nothing to do');
eq(list([customer('c1', 'مصنع الأمل'), visit('v1', 'c1', {nextDate: ''})], '2026-10-30'), [], 'no next date: not due');
eq(list([customer('c1', 'مصنع الأمل'), visit('v1', 'c1', {nextDate: '30/10/2026'})], '2026-10-30'), [], 'a date that is not YYYY-MM-DD: not due');
eq(list([customer('c1', 'مصنع الأمل')], '2026-10-30'), [], 'a customer never visited has no plan');
eq(list([visit('v1', 'missing')], '2026-10-30'), [], 'a visit whose customer is not visible is not listed');

// ---- whose follow-up, and who may see it
eq(list([customer('c1', 'مصنع الأمل'), visit('v1', 'c1', {by: 'outsider'})], '2026-10-30'), [], 'a member outside the reader\'s scope is not shown');
const two = [customer('c1', 'مصنع الأمل'), customer('c2', 'مصنع النور', 'rep2'), visit('v1', 'c1'), visit('v2', 'c2', {by: 'rep2'})];
eq(idsOf(list(two, '2026-10-30')), ['v1', 'v2'], 'all members in scope');
eq(idsOf(list(two, '2026-10-30', 'rep2')), ['v2'], 'one member chosen');
eq(list([customer('c1', 'مصنع الأمل'), visit('v1', 'c1', {by: '', extra: {performedBy: '', recordedByEmail: 'REP2@yourrest.org'}})], '2026-10-30').map(item => item.memberId), ['rep2'], 'an older visit with only the recorder\'s email belongs to that member');

// ---- order: date, then customer name, then id
const many = [customer('c1', 'مصنع ب'), customer('c2', 'مصنع أ'), customer('c3', 'مصنع أ'), visit('v1', 'c1', {nextDate: '2026-10-23'}), visit('v3', 'c3', {nextDate: '2026-10-24'}), visit('v2', 'c2', {nextDate: '2026-10-24'})];
eq(idsOf(list(many, '2026-10-30')), ['v1', 'v2', 'v3'], 'the earliest first; the same day by customer name, then by id');
console.log(JSON.stringify({ok: true, checks}));
