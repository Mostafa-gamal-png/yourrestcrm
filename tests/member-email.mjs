// A member's sign-in email and edit snapshot. lib/member-email.ts cleans what a paste from an Arabic message brings (direction marks,
// zero-width characters, spaces, capitals) so one person never becomes two accounts; lib/member-edit.ts is the compare-and-swap
// snapshot that stops two administrators from overwriting each other's edit of the same member: every field a person can change must
// change it, and a missing optional field must equal its default. No database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'member-email-'));
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
const load = async name => { fs.writeFileSync(path.join(out, name + '.mjs'), ts.transpileModule(fs.readFileSync(path.join(root, 'lib', name + '.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText); return import(path.join(out, name + '.mjs')); };
const {normalizeMemberEmail: email, memberEmailError} = await load('member-email');
const {memberEditToken: token} = await load('member-edit');

let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };

// ---- the email
eq(email('rep@yourrest.org'), 'rep@yourrest.org', 'a clean email is unchanged');
eq(email('Rep@YourRest.ORG'), 'rep@yourrest.org', 'capitals do not make another account');
eq(email('  rep@yourrest.org \n'), 'rep@yourrest.org', 'spaces and a line break around it are dropped');
eq(email('\u200frep@yourrest.org\u200e'), 'rep@yourrest.org', 'right-to-left and left-to-right marks from an Arabic message are dropped');
eq(email('\u061crep@yourrest.org'), 'rep@yourrest.org', 'the Arabic letter mark is dropped');
eq(email('rep\u200b@yourrest.org'), 'rep@yourrest.org', 'a zero-width space inside is dropped');
eq(email('rep\u200c@yourrest.org\u200d'), 'rep@yourrest.org', 'a zero-width non-joiner and joiner are dropped (since 2026-10-31)');
eq(email('\u202brep@yourrest.org\u202c'), 'rep@yourrest.org', 'embedding controls are dropped');
eq(email('\u2066rep@yourrest.org\u2069'), 'rep@yourrest.org', 'isolate controls are dropped');
eq(email('\u2060rep@yourrest.org\ufeff'), 'rep@yourrest.org', 'a word joiner and a byte-order mark are dropped');
eq(email('\u00a0rep@yourrest.org\u00a0'), 'rep@yourrest.org', 'non-breaking spaces around it are dropped');
eq(email('rep @yourrest.org'), 'rep @yourrest.org', 'an inner space is kept, so the format check still refuses it');
eq(email(''), '', 'an empty email stays empty');
eq(memberEmailError.includes('name@yourrest.org'), true, 'the error shows the expected form');

// ---- the edit snapshot
const member = {id: 'rep', email: 'rep@yourrest.org', name: 'أحمد', role: 'rep', branch: 'الرئيسي', supervisorId: 'sup', regionScope: 'eastern', active: true, target: 50, authVersion: 3, userId: 'u-rep'};
eq(token(member), token({...member}), 'the same member gives the same snapshot');
for (const [field, value] of [['id', 'rep2'], ['email', 'rep2@yourrest.org'], ['name', 'أحمد علي'], ['role', 'supervisor'], ['branch', 'الفرع'], ['supervisorId', 'sup2'], ['regionScope', 'western'], ['active', false], ['target', 60], ['authVersion', 4]]) {
  eq(token({...member, [field]: value}) === token(member), false, `a change of ${field} changes the snapshot`);
}
eq(token({...member, userId: 'u-other'}), token(member), 'the sign-in identity is not part of the snapshot');
eq(token({...member, supervisorId: undefined}), token({...member, supervisorId: ''}), 'no supervisor equals an empty supervisor');
eq(token({...member, regionScope: undefined}), token({...member, regionScope: 'all'}), 'no region equals all regions');
eq(token({...member, authVersion: undefined}), token({...member, authVersion: 0}), 'no sign-in version equals version 0');
console.log(JSON.stringify({ok: true, checks}));
