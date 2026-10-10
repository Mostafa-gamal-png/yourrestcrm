// ERP source references can be shared; immutable CRM numbers identify factories.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'security-customer-code-')),seen=new Set();
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
compile('app/api/crm/route.ts');
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
sql.prepare('INSERT INTO crm_members(id,email,name,role,branch,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,1,0,?)').run('rep','rep@yourrest.org','Test rep','rep','HQ','eastern',now);
globalThis.testUser={provider:'email-otp',memberId:'rep',memberVersion:sql.prepare("SELECT auth_version FROM crm_members WHERE id='rep'").get().auth_version,userId:'test-rep',email:'rep@yourrest.org',fullName:'Test rep'};
const crm=await import(path.join(out,'app/api/crm/route.mjs'));
let checks=0;
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const raw=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id);
const data=id=>JSON.parse(raw(id).data);
const post=async(body,status=200)=>{
 const response=await crm.POST(new Request('https://test.invalid/api/crm',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)}));
 const payload=await response.json();check(response.status,status,JSON.stringify(payload));return payload;
};
const create=code=>({action:'save',kind:'customer',createKey:crypto.randomUUID(),data:{name:'Test factory',region:'الشرقية',location:'',code}});
const edit=(id,changes)=>({action:'save',kind:'customer',id,version:raw(id).version,data:{...data(id),...changes}});
const number=id=>sql.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').get(id)?.number;

const first=(await post(create('FIRST'))).id,second=(await post(create('SECOND'))).id;
const firstNumber=number(first),secondNumber=number(second);
check(Number.isInteger(firstNumber),true);check(Number.isInteger(secondNumber),true);check(firstNumber!==secondNumber,true);
// Concurrent source-code edits are permitted. The two factory identities and
// their immutable CRM numbers stay distinct even when the ERP code is shared.
beforeBatch=async()=>{await post(edit(second,{code:'CONCURRENT-ERP'}));};
await post(edit(first,{code:'CONCURRENT-ERP'}));
check(number(first),firstNumber);check(number(second),secondNumber);
check(data(first).code,'CONCURRENT-ERP');check(data(second).code,'CONCURRENT-ERP');
const pendingCreate=create('ＣＯＮＣＵＲＲＥＮＴ-ＥＲＰ');
beforeBatch=async()=>{await post(create('concurrent-erp'));};
const third=(await post(pendingCreate)).id;
check(new Set(sql.prepare('SELECT number FROM crm_customer_numbers').all().map(row=>row.number)).size,4);
check(number(third)>0,true);
const directory=await crm.GET(),result=await directory.json();check(directory.status,200);
check(new Set(result.records.filter(row=>row.kind==='customer').map(row=>row.data.internalCode)).size,4,'Every factory has a distinct display code');
const codeBefore=result.records.find(row=>row.id===first).data.internalCode;
await post(edit(first,{internalCode:'YR-C-999999',_erpCodeAliases:['FORGED'],code:''}));
check(number(first),firstNumber);check(data(first).internalCode,undefined,'Client cannot persist a forged CRM number');check(data(first)._erpCodeAliases,undefined,'Client cannot forge historic aliases');
const reloaded=await (await crm.GET()).json();check(reloaded.records.find(row=>row.id===first).data.internalCode,codeBefore);
check(sql.prepare('SELECT source_code FROM crm_customer_code_aliases WHERE customer_id=? ORDER BY source_code').all(first).map(row=>row.source_code),['CONCURRENT-ERP','FIRST'],'Old ERP references survive edits and clearing');
await post(edit(second,{code:''}));check(number(second),secondNumber);
check(sql.prepare('PRAGMA foreign_key_check').all(),[]);
console.log(JSON.stringify({customerIdentityConcurrency:'passed',checks,policy:'ERP references may be shared; CRM numbers are immutable and unique'}));
