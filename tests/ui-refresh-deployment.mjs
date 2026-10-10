import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// Exercise the exact release-specific package with the shared, proven real-SQLite
// scenarios. Keeping the scenario sources avoids a second divergent 400-line suite.
const root = process.cwd();
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'yourrest-ui-package-test-'));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const put = (name, text) => {
  const file = path.join(work, name);
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  fs.writeFileSync(file, text, {mode: 0o600});
};
const adapt = source => source
  .replaceAll('customer-edit', 'ui-refresh')
  .replaceAll('__CUSTOMER_EDIT_', '__UI_REFRESH_')
  .replaceAll('yourrest-ui-refresh-activation-20261007', 'yourrest-ui-refresh-activation-20261008');
const crossUpdateScenarios = String.raw`
 // The new helper accepts the same-day sealed backup written by the actual
 // previous customer-edit helper; other applications and prior journals survive.
 {
  const p=fixture('cross-update-kind');
  const oldTemplate=read(path.join(root,'portable/activate-customer-edit-update.cjs'));
  const oldPinned=oldTemplate.replace('__CUSTOMER_EDIT_MANIFEST_SHA256__',hash(manifest)).replace('const RELEASE_FILES = 0; // __CUSTOMER_EDIT_RELEASE_FILES__','const RELEASE_FILES = '+packaged.files+';');
  const oldModule=path.join(work,'prior-customer-helper.cjs');put(oldModule,oldPinned);
  const prior=require(oldModule),old=prior.pathsFor(p.home);
  fs.mkdirSync(old.stage,{mode:0o700});fs.cpSync(release,old.newRelease,{recursive:true});put(old.manifest,manifest);
  for(const site of ['gscoinvest-crm','yourrest-group','products-portal'])put(path.join(p.home,site,'preserve.txt'),'unrelated application');
  const first=await prior.run(old,'apply',options('2026-10-08T05:00:00Z'));
  const oldJournal=read(old.state),backupBefore=helper.inventory(first.dailyBackup.transaction);
  addCustomer(p,'added-after-earlier-update');const currentData=helper.inventory(p.data);copies=0;
  const state=await helper.run(p,'apply',options('2026-10-08T11:00:00Z',{copy:countCopy}));
  eq(copies,0,'UI update reuses the verified same-day customer update backup');
  eq(state.dailyBackup.transaction,first.dailyBackup.transaction);eq(read(old.state),oldJournal);
  eq(path.basename(p.stage),'yourrest-ui-update-20261008');
  eq(path.basename(p.state),'ui-refresh-activation-state.json');
  eq(state.format,'yourrest-ui-refresh-activation-20261008');
  helper.assertSameInventory(backupBefore,helper.inventory(first.dailyBackup.transaction));checks++;
  assertUnchanged(currentData,p);
  for(const site of ['gscoinvest-crm','yourrest-group','products-portal'])eq(read(path.join(p.home,site,'preserve.txt')),'unrelated application');
  eq(read(state.baselineIds.file).includes('added-after-earlier-update'),true);
  eq((await helper.run(p,'verify',options('2026-10-08T11:05:00Z'))).migrations,15);
 }
 // Read-only package preparation may run while the live application is serving.
 {
  const p=fixture('live-preflight'),before=helper.inventory(p.home);let stoppedCalls=0;
  await helper.run(p,'check',{log:quiet,stopped:()=>{stoppedCalls++;throw Error('application is running');}});
  eq(stoppedCalls,0);helper.assertSameInventory(before,helper.inventory(p.home));checks++;
 }
 // Accidentally selecting GSCO or another origin must not create a transaction.
 {
  const p=fixture('wrong-application'),settings=path.join(p.app,'settings.cjs');
  put(settings,read(settings).replace('https://crm.yourrest.org','https://crm.gscoinvest.com'));
  const before=helper.inventory(p.home);
  await rejects(()=>helper.run(p,'check',options('2026-10-08T11:00:00Z')),'WRONG_SITE');
  helper.assertSameInventory(before,helper.inventory(p.home));checks++;
 }
`;

try {
  for (const name of [
    'portable/config.cjs', 'portable/initialize.mjs',
    'portable/activate-ui-refresh-update.cjs', 'portable/activate-customer-edit-update.cjs',
    'scripts/package-ui-refresh-update.py', 'tests/activate-security-update.mjs',
  ]) put(name, read(name));
  for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter(name => name.endsWith('.sql'))) {
    put('drizzle/' + name, read('drizzle/' + name));
  }
  put('tests/ui-activation.mjs', adapt(read('tests/activate-customer-edit-update.mjs')));
  const daily = adapt(read('tests/daily-deploy-backup.mjs'));
  const insertion = ' console.log(JSON.stringify({ok:true,checks,realSqlite:true';
  assert.equal(daily.split(insertion).length, 2, 'Daily scenario insertion point remains unambiguous');
  put('tests/ui-daily.mjs', daily.replace(insertion, crossUpdateScenarios + insertion));
  const results = ['ui-activation', 'ui-daily'].map(name => JSON.parse(execFileSync(
    process.execPath, [path.join(work, 'tests', name + '.mjs')],
    {cwd: work, encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe']},
  ).trim()));
  assert.ok(results.every(result => result.ok));
  console.log(JSON.stringify({
    ok: true, checks: results.reduce((total, result) => total + result.checks + (result.inheritedChecks || 0), 0),
    suites: results, productionDataUsed: false, httpStub: true,
    scope: 'UI release package, same-day cross-update reuse, live preflight, unchanged legacy helpers and other applications',
  }));
} finally {
  fs.rmSync(work, {recursive: true, force: true});
}
