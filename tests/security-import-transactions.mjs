// Import handler transactions on isolated SQLite. No network or production data.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'security-import-transactions-')),seen=new Set();
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
let rejectAudit=false;
class Statement{
 constructor(query,args=[]){this.query=query;this.args=args;}
 bind(...args){return new Statement(this.query,args);}
 async run(){if(rejectAudit&&this.query.startsWith('INSERT INTO crm_audit'))throw Error('synthetic-audit-write-failure');return{meta:{changes:Number(sql.prepare(this.query).run(...this.args).changes)}};}
 async all(){return{results:sql.prepare(this.query).all(...this.args)};}
 async first(){return sql.prepare(this.query).get(...this.args)||null;}
}
const DB={prepare:query=>new Statement(query),batch:async statements=>{
 sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}
}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const now=new Date().toISOString();
sql.prepare('INSERT INTO crm_members(id,email,name,role,branch,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,1,0,?)').run('owner','owner@yourrest.org','Test admin','admin','HQ','all',now);
globalThis.testUser={provider:'email-otp',memberId:'owner',memberVersion:sql.prepare("SELECT auth_version FROM crm_members WHERE id='owner'").get().auth_version,userId:'test-owner',email:'owner@yourrest.org',fullName:'Test admin'};
const customers=await import(path.join(out,'app/api/customers/import/route.mjs')),machines=await import(path.join(out,'app/api/machines/import/route.mjs'));
let checks=0;
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const post=async(route,body,status=200)=>{
 const response=await route.POST(new Request('https://test.invalid/api/import',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)}));
 const payload=await response.json();check(response.status,status,JSON.stringify(payload));return payload;
};
const recordCount=kind=>sql.prepare('SELECT COUNT(*) n FROM crm_records WHERE kind=?').get(kind).n;
const audits=()=>sql.prepare('SELECT * FROM crm_audit ORDER BY created_at,id').all();
const sourceHash='a'.repeat(64),sourceKey='b'.repeat(64),customerId='yr-import-'+sourceKey.slice(0,32);
const input={sourceHash,sourceFile:'synthetic-fixture.csv',rows:[{id:customerId,data:{name:'Import test factory',region:'الشرقية',location:'26.4, 50.0',sourceKey,sourceRow:1,machineCount:2,machineTypes:'Test block machines'}}]};

rejectAudit=true;await post(customers,input,500);rejectAudit=false;
check(recordCount('customer'),0,'A failed customer audit must roll back its imported rows');
check(audits().length,0);
const saved=await post(customers,input);
check(saved.inserted,1);check(saved.skipped,0);check(saved.sourceTotal,1);check(saved.mapped,1);
check(audits().length,1);check(audits()[0].record_id,customerId);check(audits()[0].detail,'1 مصنع من synthetic-fixture.csv');
check((await post(customers,input)).inserted,0);check(audits().length,1,'An identical import retry must not duplicate its audit');

rejectAudit=true;await post(machines,{sourceHash},500);rejectAudit=false;
check(recordCount('factory'),0,'A failed machine audit must roll back its imported rows');
check(audits().length,1);
const linked=await post(machines,{sourceHash});
check(linked.inserted,1);check(linked.skipped,0);check(linked.totalGroups,1);check(linked.linkedCustomers,1);check(linked.recordedUnits,2);
check(audits().length,2);check(audits().find(row=>row.action==='استيراد الماكينات').detail,'ربط بيانات الماكينات بـ 1 مصنع من شيت العملاء');
check((await post(machines,{sourceHash})).inserted,0);check(audits().length,2);
check((await post(machines,{sourceHash,afterId:'zzzz'})).inserted,0);check(audits().length,2);

// A partially pre-existing batch records only fresh rows and a fresh record ID.
const nextKey='c'.repeat(64),nextId='yr-import-'+nextKey.slice(0,32);
const mixed={...input,rows:[...input.rows,{id:nextId,data:{...input.rows[0].data,name:'Second fixture',sourceKey:nextKey,sourceRow:2}}]};
const mixedResult=await post(customers,mixed);check(mixedResult.inserted,1);check(mixedResult.skipped,1);
const mixedAudit=audits().find(row=>row.record_id===nextId);check(!!mixedAudit,true);check(mixedAudit.detail,'1 مصنع من synthetic-fixture.csv');
check(sql.prepare('PRAGMA foreign_key_check').all(),[]);
console.log(JSON.stringify({importTransactions:'passed',checks}));
