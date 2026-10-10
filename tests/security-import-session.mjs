// Import commit authorization on isolated SQLite. No real credentials or network.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'security-import-session-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),'export async function getApplicationUser(){return globalThis.testUser;}');
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';
  compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
for(const endpoint of ['customers/import','machines/import'])compile('app/api/'+endpoint+'/route.ts');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const file of fs.readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+file,'utf8'));
let beforeBatch;
class Statement{
 constructor(query,args=[]){this.query=query;this.args=args;}
 bind(...args){return new Statement(this.query,args);}
 async run(){return{meta:{changes:Number(sql.prepare(this.query).run(...this.args).changes)}};}
 async all(){return{results:sql.prepare(this.query).all(...this.args)};}
 async first(){return sql.prepare(this.query).get(...this.args)||null;}
}
const DB={prepare:query=>new Statement(query),batch:async statements=>{
 if(beforeBatch){const race=beforeBatch;beforeBatch=undefined;await race();}
 sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}
}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const now=new Date().toISOString();
sql.prepare('INSERT INTO crm_members(id,email,name,role,branch,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,1,0,?)').run('owner','owner@yourrest.org','Test admin','admin','HQ','all',now);
const login=()=>{globalThis.testUser={provider:'email-otp',memberId:'owner',memberVersion:sql.prepare("SELECT auth_version FROM crm_members WHERE id='owner'").get().auth_version,userId:'test-owner',email:'owner@yourrest.org',fullName:'Test admin'};};
const revoke=()=>sql.prepare("UPDATE crm_members SET auth_version=auth_version+1 WHERE id='owner'").run();
login();
const customers=await import(path.join(out,'app/api/customers/import/route.mjs')),machines=await import(path.join(out,'app/api/machines/import/route.mjs'));
let checks=0;
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const post=async(route,body,status=200,headers={})=>{
 const response=await route.POST(new Request('https://test.invalid/api/import',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json',...headers},body:JSON.stringify(body)}));
 const payload=await response.json();check(response.status,status,JSON.stringify(payload));return payload;
};
const recordCount=kind=>sql.prepare('SELECT COUNT(*) n FROM crm_records WHERE kind=?').get(kind).n;
const auditCount=()=>sql.prepare('SELECT COUNT(*) n FROM crm_audit').get().n;
const sourceHash='a'.repeat(64),sourceKey='b'.repeat(64),customerId='yr-import-'+sourceKey.slice(0,32);
const input={sourceHash,sourceFile:'synthetic-fixture.csv',rows:[{id:customerId,data:{name:'Import test factory',region:'الشرقية',location:'26.4, 50.0',sourceKey,sourceRow:1,machineCount:2,machineTypes:'Test block machines'}}]};

// Revocation preserves the admin role, so a role-only predicate is insufficient.
beforeBatch=revoke;await post(customers,input,409);
check(recordCount('customer'),0);check(auditCount(),0);
login();check((await post(customers,input)).inserted,1);
beforeBatch=revoke;await post(machines,{sourceHash},409);
check(recordCount('factory'),0);check(auditCount(),1);
login();check((await post(machines,{sourceHash})).inserted,1);
check((await post(customers,input)).inserted,0,'Already-imported rows remain an ordinary replay');
check((await post(machines,{sourceHash})).inserted,0);

// Source-token authorization is independent of a browser session. Keep it
// restricted to the configured source and an active global administrator.
globalThis.testUser=null;
globalThis.testEnv.CUSTOMER_IMPORT_TOKEN='synthetic-source-token';
globalThis.testEnv.CUSTOMER_IMPORT_SOURCE_HASH=sourceHash;
globalThis.testEnv.MACHINE_IMPORT_TOKEN='synthetic-machine-token';
globalThis.testEnv.MACHINE_IMPORT_SOURCE_HASH=sourceHash;
const nextKey='c'.repeat(64),nextId='yr-import-'+nextKey.slice(0,32),nextInput={...input,rows:[{id:nextId,data:{...input.rows[0].data,sourceKey:nextKey}}]};
beforeBatch=revoke;check((await post(customers,nextInput,200,{'x-customer-import-token':'synthetic-source-token'})).inserted,1);
beforeBatch=revoke;check((await post(machines,{sourceHash},200,{'x-machine-import-token':'synthetic-machine-token'})).inserted,1);
await post(customers,nextInput,401,{'x-customer-import-token':'wrong-synthetic-token'});
await post(machines,{sourceHash:'d'.repeat(64)},401,{'x-machine-import-token':'synthetic-machine-token'});
check(sql.prepare('PRAGMA foreign_key_check').all(),[]);
console.log(JSON.stringify({importSessionGuard:'passed',checks}));
