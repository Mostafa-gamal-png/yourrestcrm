// Characterization of existing attachment policy through real routes and migrated SQLite.
// Identity is mocked; no network, production data, or object storage is used.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'visit-attachment-policy-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=? OR email=?').bind(u.userId,u.email).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';
  compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));
 });fs.writeFileSync(dest,code);
}
for(const name of ['visits','customer-followups'])compile('app/api/'+name+'/route.ts');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const filename of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+filename,'utf8'));
let race=null;
class Statement{
 constructor(q,a=[]){this.q=q;this.a=a;}
 bind(...a){return new Statement(this.q,a);}
 async run(){const result=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(result.changes)}};}
 async all(){return{results:sql.prepare(this.q).all(...this.a)};}
 async first(){return sql.prepare(this.q).get(...this.a)||null;}
}
const DB={prepare:q=>new Statement(q),batch:async statements=>{if(race){const action=race;race=null;await action();}sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};

globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const NativeDate=Date,clock=NativeDate.parse('2026-10-05T09:00:00.000Z');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
process.on('exit',()=>{globalThis.Date=NativeDate;});
const now=new Date().toISOString(),day='2026-10-05';
function member(id,role,supervisor='',region='eastern',active=1){sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,?,0,?)').run(id,'u-'+id,id+'@yourrest.org',id,role,'HQ',supervisor||null,region,active,now);}
const raw=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id);
const data=id=>JSON.parse(raw(id).data);
function insert(id,kind,parentId,value,author='rep',createdAt=now){
 sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,1,?)').run(id,kind,parentId,author,'HQ',JSON.stringify(kind==='customer'?{name:id,region:'الشرقية',...value}:{performedBy:author,recordedByEmail:author+'@yourrest.org',...value}),createdAt,createdAt,'fixture');
}
const routes={};for(const name of ['visits','customer-followups'])routes[name]=await import(path.join(out,'app/api/'+name+'/route.mjs'));
let checks=0,caseCount=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const contact={type:'call',summary:'تعريف بمنتجات الشركة',result:'طلب معلومات المنافس',salesStage:'new',strength:'strong',requestedProducts:[],nextAction:'التواصل التالي',nextDate:day,location:'26.437341, 50.034499',locationSource:'device',locationCapturedAt:now,locationAccuracy:12};
const observation={hasCompetitor:true,competitorName:'Synthetic competitor',competitorFileId:'file',competitorFileName:'untrusted-browser-name.pdf'};
function setup({actor='rep',uploader=actor,fileCustomer='customer',linked=false,inactiveUploader=false,region='الشرقية',missing=false}={}){
 race=null;
 sql.exec('DELETE FROM crm_audit; DELETE FROM crm_visit_numbers; DELETE FROM crm_visit_files; DELETE FROM crm_records; DELETE FROM crm_members;');
 member('admin','admin','','all');member('manager','manager');member('supervisor','supervisor');member('rep','rep','supervisor');member('peer','rep','supervisor');member('outside','rep','outside-supervisor');member('service','customer_service');
 if(inactiveUploader)sql.prepare('UPDATE crm_members SET active=0 WHERE id=?').run(uploader);
 globalThis.testUser={userId:'u-'+actor,email:actor+'@yourrest.org',fullName:actor};
 insert('customer','customer',null,{region});insert('other','customer',null,{});
 insert('source','activity','customer',{...contact,visitWorkflow:'customer-v1',date:day},actor,'2026-10-05T07:00:00.000Z');
 if(linked)insert('linked','activity','customer',{...contact,...observation,visitWorkflow:'customer-v1',date:'2026-10-04'},actor,'2026-10-04T07:00:00.000Z');
 if(!missing)sql.prepare('INSERT INTO crm_visit_files(id,object_key,customer_id,name,content_type,size,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run('file','synthetic-object',fileCustomer,'authoritative-quote.pdf','application/pdf',12,uploader,now);
 return {actor};
}
function payload(route,extraObservation=observation){
 const common={createKey:crypto.randomUUID(),customerId:'customer',customerVersion:raw('customer').version};
 return route==='visits'?{...common,timingMode:'automatic',elapsedMilliseconds:120000,data:{...contact,...extraObservation}}:{...common,sourceId:'source',sourceVersion:raw('source').version,data:{type:'call',date:day,result:contact.result,salesStage:'new',invoiceOutcome:'pending',nextAction:contact.nextAction,nextDate:day,...(extraObservation===undefined?{}:{competitorObservation:extraObservation})}};
}
async function post(route,body,expected=200,label=''){
 const response=await routes[route].POST(new Request('https://test.invalid/api/'+route,{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)}));
 const result=await response.json();eq(response.status,expected,route+' '+label+' '+JSON.stringify(result));return result;
}
const activityCount=()=>sql.prepare("SELECT count(*) n FROM crm_records WHERE kind='activity'").get().n;
const auditCount=()=>sql.prepare('SELECT count(*) n FROM crm_audit').get().n;
for(const route of Object.keys(routes)){
 for(const fixture of [{actor:'rep'},{actor:'supervisor',uploader:'rep'},{actor:'manager',uploader:'outside'},{actor:'admin',uploader:'outside'},{actor:'supervisor',uploader:'rep',inactiveUploader:true},{actor:'rep',uploader:'outside',linked:true}]){
  setup(fixture);const body=payload(route),count=activityCount(),saved=await post(route,body,200,JSON.stringify(fixture));caseCount++;
  eq(activityCount(),count+1,'Successful attachment creates exactly one contact');eq(data(saved.id).competitorFileId,'file');eq(data(saved.id).competitorFileName,'authoritative-quote.pdf','Stored metadata wins over browser filename');
  const audit=auditCount();eq((await post(route,body)).alreadySaved,true,'Identical retry returns receipt');eq(activityCount(),count+1);eq(auditCount(),audit,'Retry produces no duplicate audit');
  await post(route,{...body,data:{...body.data,result:'Different retry'}},409,'Changed retry is rejected');
 }
 for(const fixture of [{actor:'rep',uploader:'peer'},{actor:'supervisor',uploader:'outside'},{actor:'rep',fileCustomer:'other'},{actor:'rep',missing:true},{actor:'rep',region:'الغربية'},{actor:'service'}]){
  setup(fixture);const count=activityCount();await post(route,payload(route),403,JSON.stringify(fixture));caseCount++;
  eq(activityCount(),count);eq(auditCount(),0,'Denied attachment produces no write audit');eq(raw('customer').version,1);
 }
 const races=[
  ['file deletion',{},()=>sql.prepare("DELETE FROM crm_visit_files WHERE id='file'").run()],
  ['file customer changed',{},()=>sql.prepare("UPDATE crm_visit_files SET customer_id='other' WHERE id='file'").run()],
  ['file uploader changed',{},()=>sql.prepare("UPDATE crm_visit_files SET uploaded_by='outside' WHERE id='file'").run()],
  ['uploader moved out of team',{actor:'supervisor',uploader:'rep'},()=>sql.prepare("UPDATE crm_members SET supervisor_id='outside-supervisor' WHERE id='rep'").run()],
  ['uploader no longer a sales rep',{actor:'supervisor',uploader:'rep'},()=>sql.prepare("UPDATE crm_members SET role='customer_service' WHERE id='rep'").run()],
  ['actor session revoked',{},()=>sql.prepare("UPDATE crm_members SET auth_version=auth_version+1 WHERE id='rep'").run()],
  ['linked activity changed',{actor:'rep',uploader:'outside',linked:true},()=>sql.prepare("UPDATE crm_records SET version=version+1 WHERE id='linked'").run()],
  ['linked activity removed',{actor:'rep',uploader:'outside',linked:true},()=>sql.prepare("DELETE FROM crm_records WHERE id='linked'").run()],
 ];
 for(const [label,fixture,change] of races){
  setup(fixture);const count=activityCount(),body=payload(route),id='customer-'+(route==='visits'?'visit':'followup')+'-'+body.createKey;
  race=change;await post(route,body,409,label);caseCount++;eq(raw(id),undefined,label+' cannot save a new contact');eq(auditCount(),0,label+' cannot save a receipt/audit');eq(raw('customer').version,1,label+' cannot advance customer plan');
  eq(activityCount(),count-(label==='linked activity removed'?1:0),label+' cannot partially append');
 }
 setup();const ignored={...observation,hasCompetitor:false,competitorFileId:'unknown'};
 const noCompetitor=await post(route,payload(route,ignored));caseCount++;eq(data(noCompetitor.id).competitorFileId,'','Explicit false clears attachment');eq(data(noCompetitor.id).competitorFileName,'');
 setup();const empty={...observation,competitorFileId:'',competitorFileName:'stale-name.pdf'};
 const noFile=await post(route,payload(route,empty));caseCount++;eq(data(noFile.id).competitorFileId,'');
 // Preserve this existing distinction: follow-ups clear a stale filename with
 // an explicit observation, while the visit schema retains the supplied name.
 eq(data(noFile.id).competitorFileName,route==='visits'?'stale-name.pdf':'');
}
eq(sql.prepare('PRAGMA foreign_key_check').all(),[]);
console.log(JSON.stringify({ok:true,checks,cases:caseCount,type:'visit attachment policy characterization; real handlers and SQLite commit races'}));
