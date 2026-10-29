// Opening the app draws the device's copy of the data at once and the server's answer a moment later (app/crm-app.tsx); when the
// two are the same the screen must not be redrawn, and when anything differs it must be. lib/same-snapshot.ts against every kind of
// difference a snapshot can carry: a record's version or time, data the server adds without a new version (an open service
// intake), a sync state on the device, order, count, the account, the members, the history, the service queue, an added or missing
// part. Then the time it takes on a snapshot the size of production. No database, no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {performance} from 'node:perf_hooks';

const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'same-snapshot-'));
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
fs.writeFileSync(path.join(out, 'same-snapshot.mjs'), ts.transpileModule(fs.readFileSync(path.join(root, 'lib/same-snapshot.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText);
const {sameSnapshot} = await import(path.join(out, 'same-snapshot.mjs'));

let checks = 0;
const yes = (a, b, message) => { assert.equal(sameSnapshot(a, b), true, message); checks++; };
const no = (a, b, message) => { assert.equal(sameSnapshot(a, b), false, message); assert.equal(sameSnapshot(b, a), false, message + ' (the other way)'); checks += 2; };

function snapshot(customers = 4, visits = 6) {
  const me = {id: 'rep', name: 'أحمد', email: 'rep@yourrest.org', role: 'rep', branch: 'الرئيسي', regionScope: 'eastern', supervisorId: 'sup', authVersion: 2, active: true};
  const records = [];
  for (let i = 0; i < customers; i++) records.push({id: 'c' + i, kind: 'customer', parentId: null, assignedTo: 'rep', branch: 'الرئيسي', data: {name: 'مصنع ' + i, region: 'الشرقية', phone: '050000000' + (i % 10)}, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-02T08:00:00.000Z', version: 3});
  for (let i = 0; i < visits; i++) records.push({id: 'v' + i, kind: 'activity', parentId: 'c' + (i % customers), assignedTo: 'rep', branch: 'الرئيسي', data: {type: 'visit', date: '2026-10-2' + (i % 9), result: 'متابعة العميل', nextDate: '2026-11-01'}, createdAt: '2026-10-20T08:00:00.000Z', updatedAt: '2026-10-20T08:00:00.000Z', version: 1});
  return {records, me, members: [me, {id: 'sup', name: 'ماجد', role: 'supervisor'}], audits: [{id: 'a1', recordId: 'v0', actor: 'أحمد', action: 'حفظ', createdAt: '2026-10-20T08:00:00.000Z'}], serviceQueue: []};
}
const base = snapshot(), copy = () => structuredClone(base);

// ---- the same data
yes(base, base, 'the same object');
yes(base, copy(), 'a deep copy (the device copy read back, or the server answer parsed again)');
yes(snapshot(0, 0), snapshot(0, 0), 'two empty snapshots');

// ---- every kind of difference
const change = (message, edit) => { const next = copy(); edit(next); no(base, next, message); };
change('a record with a new version', s => { s.records[2].version = 4; });
change('a record with a new time', s => { s.records[5].updatedAt = '2026-10-29T08:00:00.000Z'; });
change('a record moved to another representative', s => { s.records[1].assignedTo = 'rep2'; });
change('a visit moved to another customer', s => { s.records[6].parentId = 'c3'; });
change('data the server adds without a new version (an open service intake)', s => { s.records[0].data._serviceIntake = {id: 'i1', createdAt: '2026-10-29T08:00:00.000Z'}; });
change('a value inside the data with the same version', s => { s.records[0].data.phone = '0599999999'; });
change('a sync state on the device', s => { s.records[7].data._offlineState = 'blocked'; });
change('an entry the server confirmed', s => { s.records[8].data._offlineAcknowledged = true; });
change('one record fewer', s => { s.records.pop(); });
change('one record more', s => { s.records.push({...s.records[0], id: 'c-new'}); });
change('the same records in another order', s => { [s.records[0], s.records[1]] = [s.records[1], s.records[0]]; });
change('the account changed role', s => { s.me.role = 'supervisor'; });
change('the account signed in again elsewhere', s => { s.me.authVersion = 3; });
change('another member', s => { s.members.push({id: 'rep2', name: 'سالم', role: 'rep'}); });
change('a renamed member', s => { s.members[1].name = 'ماجد علي'; });
change('a new line in the history', s => { s.audits.unshift({id: 'a2', recordId: 'c0', actor: 'أحمد', action: 'تعديل', createdAt: '2026-10-29T08:00:00.000Z'}); });
change('a request in the service queue', s => { s.serviceQueue.push({id: 'q1', customerId: 'c0'}); });
change('a part the snapshot did not have', s => { s.settings = {}; });
change('a part the snapshot lost', s => { delete s.serviceQueue; });
change('records that are not a list', s => { s.records = {}; });

// ---- the size of production: the check must cost far less than the redraw it saves
const big = snapshot(2300, 6000), bigCopy = structuredClone(big);
const started = performance.now();
for (let i = 0; i < 5; i++) assert.equal(sameSnapshot(big, bigCopy), true);
const ms = (performance.now() - started) / 5;
checks++;
assert.ok(ms < 400, `comparing 8,300 records took ${Math.round(ms)} ms`); checks++;
const lastChanged = structuredClone(big); lastChanged.records.at(-1).version = 2;
assert.equal(sameSnapshot(big, lastChanged), false, 'a change in the last record of 8,300 is found'); checks++;
console.log(JSON.stringify({ok: true, checks, compare8300Ms: Math.round(ms * 10) / 10}));
