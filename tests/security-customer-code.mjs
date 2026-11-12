// The ERP code is read-only for everyone (since 2026-11-12: only the ERP customers import writes it); immutable CRM numbers identify factories.
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
const addMember=(id,role,scope)=>sql.prepare('INSERT INTO crm_members(id,email,name,role,branch,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,1,0,?)').run(id,id+'@yourrest.org','Test '+role,role,'HQ',scope,now);
addMember('rep','rep','eastern');addMember('manager','manager','eastern');addMember('admin','admin','all');
let current='rep';const as=id=>{current=id;globalThis.testUser={provider:'email-otp',memberId:id,memberVersion:sql.prepare('SELECT auth_version FROM crm_members WHERE id=?').get(id).auth_version,userId:'test-'+id,email:id+'@yourrest.org',fullName:'Test '+id};};
as('rep');
const crm=await import(path.join(out,'app/api/crm/route.mjs'));
let checks=0;
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const raw=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id);
const data=id=>JSON.parse(raw(id).data);
const post=async(body,status=200)=>{
 const response=await crm.POST(new Request('https://test.invalid/api/crm',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)}));
 const payload=await response.json();check(response.status,status,JSON.stringify(payload));return payload;
};
const LOCKED='كود ERP لا يُكتب ولا يُعدَّل يدويًا لأي مستخدم، ولا لمدير النظام؛ يُحدَّث من ملف عملاء ERP فقط («استيراد من ERP»).';
const create=code=>({action:'save',kind:'customer',createKey:crypto.randomUUID(),data:{name:'Test factory',region:'الشرقية',location:'',assignedTo:current,branch:'HQ',...(code===undefined?{}:{code})}});
const edit=(id,changes)=>({action:'save',kind:'customer',id,version:raw(id).version,data:{...data(id),...changes}});
const number=id=>sql.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').get(id)?.number;
const customers=()=>sql.prepare("SELECT COUNT(*) n FROM crm_records WHERE kind='customer'").get().n;
/** What the ERP customers import does (lib/erp-customers-server.ts): the only writer of a customer's ERP code. */
const erpImport=(id,code)=>sql.prepare("UPDATE crm_records SET data=json_set(data,'$.code',?),version=version+1 WHERE id=?").run(code,id);

// A customer added by hand has no ERP code: one sent with a code is refused for every role, and nothing is written; an empty or absent code is fine.
for(const member of ['rep','manager','admin']){as(member);const before=customers();check((await post(create('NEW-'+member),403)).error,LOCKED,'a hand-made customer gets no ERP code ('+member+')');check(customers(),before);}
as('rep');
const first=(await post(create(''))).id,second=(await post(create())).id;
check([data(first).code,data(second).code],['',''],'a new customer has no ERP code');
const firstNumber=number(first),secondNumber=number(second);
check(Number.isInteger(firstNumber),true);check(Number.isInteger(secondNumber),true);check(firstNumber!==secondNumber,true);
erpImport(first,'FIRST');erpImport(second,'SECOND');
// Nobody types, changes or clears the ERP code by hand, the administrator with every region included (the owner, 2026-11-12).
for(const member of ['rep','manager','admin']){
 as(member);const version=raw(first).version;
 for(const code of ['OTHER','SECOND','','  ','FIRST-2'])check((await post(edit(first,{code}),403)).error,LOCKED,'the code cannot be changed to «'+code+'» ('+member+')');
 check([data(first).code,raw(first).version],['FIRST',version],'nothing was written ('+member+')');
 // A save that keeps the code (in any spelling of the same key) or does not send it is accepted, and keeps the stored code exactly.
 await post(edit(first,{code:' first ',contact:'by '+member}));check([data(first).code,data(first).contact],['FIRST','by '+member],'the same code in another spelling keeps the stored one ('+member+')');
 const withoutCode=edit(first,{contact:'no code '+member});delete withoutCode.data.code;await post(withoutCode);check([data(first).code,data(first).contact],['FIRST','no code '+member],'a page that sends no code keeps it ('+member+')');
}
erpImport(second,'١٢٣');as('rep');await post(edit(second,{code:'123',contact:'digits'}));check(data(second).code,'١٢٣','Arabic digits of the same code are the same code: the stored spelling stays');
// An edit that started before the ERP import moved the code fails on the record version, so it never writes the old code back.
as('admin');const stale=edit(first,{contact:'stale'});erpImport(first,'FIRST-ERP');await post(stale,409);check(data(first).code,'FIRST-ERP','the import\'s code stays');
// A concurrent ERP import between the read and the commit: the version check refuses the edit, and nothing is written.
const contactBefore=data(first).contact,racing=edit(first,{contact:'race'});beforeBatch=async()=>{erpImport(first,'RACED');};await post(racing,409);check([data(first).code,data(first).contact],['RACED',contactBefore],'the import won the race; the edit wrote nothing');
const directory=await crm.GET(),result=await directory.json();check(directory.status,200);
check(new Set(result.records.filter(row=>row.kind==='customer').map(row=>row.data.internalCode)).size,2,'Every factory has a distinct display code');
const codeBefore=result.records.find(row=>row.id===first).data.internalCode;
await post(edit(first,{internalCode:'YR-C-999999',_erpCodeAliases:['FORGED']}));
check(number(first),firstNumber);check(data(first).internalCode,undefined,'Client cannot persist a forged CRM number');check(data(first)._erpCodeAliases,undefined,'Client cannot forge historic aliases');
const reloaded=await (await crm.GET()).json();check(reloaded.records.find(row=>row.id===first).data.internalCode,codeBefore);
erpImport(first,'');
check(sql.prepare('SELECT source_code FROM crm_customer_code_aliases WHERE customer_id=? ORDER BY source_code').all(first).map(row=>row.source_code),['FIRST','FIRST-ERP','RACED'],'Old ERP references survive the import\'s changes and clearing (as history)');
// A cleared customer stays without a code: typing one back is refused too.
check((await post(edit(first,{code:'FIRST'}),403)).error,LOCKED);check(data(first).code,'');
await post(edit(second,{contact:'kept'}));check([number(second),data(second).code],[secondNumber,'١٢٣']);
check(sql.prepare('PRAGMA foreign_key_check').all(),[]);
console.log(JSON.stringify({customerCodeLock:'passed',checks,policy:'the ERP code is read-only for every role (only the ERP customers import writes it; an edit racing an import fails on the version); CRM numbers are immutable and unique'}));
