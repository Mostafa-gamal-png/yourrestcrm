// Dependency policy + ordinary Drizzle/TypeScript workflows. No development server or attack payload.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';

const root=process.env.DEPENDENCY_TEST_ROOT||fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(resolve(root,'package.json'));
const drizzle=createRequire(require.resolve('drizzle-kit'));
const loader=createRequire(drizzle.resolve('@esbuild-kit/esm-loader'));
const core=createRequire(loader.resolve('@esbuild-kit/core-utils'));
const esbuild=core('esbuild');
let checks=0;
// Explicit characterization mode is used only to capture before/after compatibility evidence.
if(!process.argv.includes('--compatibility-only')){
 const [major,minor,patch]=esbuild.version.split('.').map(Number);
 assert(major===0&&minor===25&&patch>=12,`Drizzle loader must use the tested patched 0.25.x line, >=0.25.12; found ${esbuild.version}`);checks++;
}
const utils=loader('@esbuild-kit/core-utils');
const code='enum Region { West = "west" }; export const result: {region: Region, count: number} = {region: Region.West, count: 4};';
const synchronous=utils.transformSync(code,'/ordinary/customer.cts');
const cjs={exports:{}};vm.runInNewContext(synchronous.code,{module:cjs,exports:cjs.exports,require});
assert.equal(cjs.exports.result.region,'west');checks++;
assert.equal(cjs.exports.result.count,4);checks++;
assert(synchronous.map.sources.some(source=>source.endsWith('customer.cts')));checks++;
const asynchronous=await utils.transform(code,'/ordinary/customer.mts');
const loadedModule=await import('data:text/javascript;base64,'+Buffer.from(asynchronous.code).toString('base64'));
assert.deepEqual(loadedModule.result,{region:'west',count:4});checks++;
assert(asynchronous.map.sources.some(source=>source.endsWith('customer.mts')));checks++;

const scratch=mkdtempSync(join(tmpdir(),'yourrest-drizzle-compat-'));
let db;
try{
 // The installed legacy loader itself must import a TypeScript enum, not merely resolve a package.
 const fixture=join(scratch,'fixture.mts');writeFileSync(fixture,code+'\nconsole.log(JSON.stringify(result));\n');
 const loaded=spawnSync(process.execPath,['--loader',pathToFileURL(drizzle.resolve('@esbuild-kit/esm-loader')).href,fixture],{cwd:root,encoding:'utf8',timeout:30000,env:{...process.env,ESBK_DISABLE_CACHE:'1'}});
 assert.equal(loaded.status,0,loaded.stderr);checks++;
 assert.deepEqual(JSON.parse(loaded.stdout.trim()),{region:'west',count:4});checks++;
 const cli=join(dirname(require.resolve('drizzle-kit')),'bin.cjs');
 const out=join(scratch,'migrations');
 const config=join(scratch,'drizzle.config.ts');
 // An isolated config deliberately points to the real application schema but only temporary output.
 writeFileSync(config,'export default '+JSON.stringify({dialect:'sqlite',schema:join(root,'db/schema.ts'),out:'./migrations'})+';\n');
 const invoke=()=>spawnSync(process.execPath,[cli,'generate','--config',config,'--name','compatibility'],{cwd:scratch,encoding:'utf8',timeout:60000,env:{...process.env,DO_NOT_TRACK:'1'}});
 const generated=invoke();assert.equal(generated.status,0,generated.stdout+'\n'+generated.stderr);checks++;
 const files=readdirSync(out).filter(name=>name.endsWith('.sql'));assert.equal(files.length,1);checks++;
 const sql=readFileSync(join(out,files[0]),'utf8');
 db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys = ON');db.exec(sql);
 const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row=>row.name));
 for(const table of ['crm_records','crm_members','crm_sales','crm_customer_numbers','crm_customer_code_aliases']){assert(tables.has(table),table+' must remain in the generated schema');checks++;}
 const again=invoke();assert.equal(again.status,0,again.stdout+'\n'+again.stderr);checks++;
 assert.match(again.stdout+'\n'+again.stderr,/No schema changes/i);checks++;
 assert.equal(readdirSync(out).filter(name=>name.endsWith('.sql')).length,1);checks++;
 console.log(JSON.stringify({ok:true,checks,esbuild:esbuild.version,tables:tables.size,compatibilityOnly:process.argv.includes('--compatibility-only'),productionDatabaseTouched:false,exploitReproduction:false}));
}finally{db?.close();rmSync(scratch,{recursive:true,force:true});}
