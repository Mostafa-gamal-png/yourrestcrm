// Real follow-up handler, authorization, projections and migrated SQLite; identity alone is mocked.
// No network, production records or object storage writes.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'competitor-followups-')),seen=new Set();
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
compile('app/api/customer-followups/route.ts');compile('lib/competitors.ts');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const filename of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+filename,'utf8'));
let race=null,auditFailure=false;
class Statement{
 constructor(q,a=[]){this.q=q;this.a=a;}
 bind(...a){return new Statement(this.q,a);}
 async run(){if(auditFailure&&this.q.startsWith('INSERT INTO crm_audit'))throw new Error('fixture audit failure');const result=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(result.changes)}};}
 async all(){return{results:sql.prepare(this.q).all(...this.a)};}
 async first(){return sql.prepare(this.q).get(...this.a)||null;}
}
const DB={prepare:q=>new Statement(q),batch:async statements=>{if(race){const action=race;race=null;await action();}sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const NativeDate=Date;let clock=NativeDate.parse('2026-10-03T09:00:00.000Z');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
process.on('exit',()=>{globalThis.Date=NativeDate;});
const iso=()=>new Date().toISOString(),day='2026-10-03';
function member(id,role,supervisor='',region='eastern',active=1){sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,?,0,?)').run(id,'u-'+id,id+'@yourrest.org',id,role,'الرئيسي',supervisor||null,region,active,iso());}
member('owner','admin','','all');member('manager','manager');member('supervisor','supervisor','manager');member('other-supervisor','supervisor','manager');member('rep','rep','supervisor');member('peer','rep','supervisor');member('outsider','rep','other-supervisor');member('western','rep','supervisor','western');member('service','customer_service');member('inactive','rep','supervisor','eastern',0);
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const user=id=>{globalThis.testUser=id?{userId:'u-'+id,email:id+'@yourrest.org',fullName:id}:null;};
const raw=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id);
const record=id=>{const r=raw(id);return {...r,parentId:r.parent_id,assignedTo:r.assigned_to,createdAt:r.created_at,updatedAt:r.updated_at,data:JSON.parse(r.data)};};
function insert(id,kind,parentId,data,author='rep',region='الشرقية'){
 sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,1,?)').run(id,kind,parentId,author,'الرئيسي',JSON.stringify(kind==='customer'?{name:id,region,...data}:{performedBy:author,recordedByEmail:author+'@yourrest.org',...data}),iso(),iso(),'fixture');
}
function file(id,customerId,author='rep',name=id+'.pdf'){sql.prepare('INSERT INTO crm_visit_files(id,object_key,customer_id,name,content_type,size,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,'competitor/'+id,customerId,name,'application/pdf',20,author,iso());}
const priorFields={hasCompetitor:true,competitorName:'ألـفا',competitorNotes:'Original observation, not newly confirmed',competitorFileId:'prior-file',competitorFileName:'prior.pdf'};
function fixture(id,author='rep',region='الشرقية',data={}){
 insert(id,'customer',null,{},author,region);
 insert(id+'-source','activity',id,{visitWorkflow:'customer-v1',type:'call',date:day,summary:'Previous call',result:'Discussed requirement',salesStage:'new',nextAction:'Ask for specifications',nextDate:day,...data},author);
 return id+'-source';
}
const route=await import(path.join(out,'app/api/customer-followups/route.mjs'));
const {buildCompetitors}=await import(path.join(out,'lib/competitors.mjs'));
const {context}=await import(path.join(out,'lib/crm-server.mjs'));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
function body(customerId,sourceId=customerId+'-source',observation){clock+=1000;return{createKey:crypto.randomUUID(),customerId,customerVersion:raw(customerId).version,sourceId,sourceVersion:raw(sourceId).version,data:{type:'call',date:day,result:'New customer follow-up',salesStage:'new',nextAction:'Request specifications',nextDate:day,...observation===undefined?{}:{competitorObservation:observation}}};}
const observe=(extra={})=>({hasCompetitor:true,competitorName:' الفا ',competitorNotes:' Fresh details ',...extra});
async function post(payload,status=200){const response=await route.POST(new Request('https://test.invalid/api/customer-followups',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(payload)}));const result=await response.json();eq(response.status,status,JSON.stringify(result));return result;}
const projection=async()=>{const c=await context();return buildCompetitors(c.visible,c.members);};

// Old clients and an explicit null never copy source competitor evidence or mutate that source.
user('rep');fixture('history','rep','الشرقية',priorFields);file('prior-file','history');
const original=raw('history-source');let payload=body('history');
Object.assign(payload.data,{hasCompetitor:true,competitorName:'Forged top-level observation',competitorFileId:'prior-file'});
let saved=await post(payload);
for(const key of Object.keys(priorFields))eq(record(saved.id).data[key],undefined,'Omitted nested observation does not populate '+key);
eq(record(saved.id).data.competitorObservation,undefined,'Wire-only observation wrapper is not persisted');
eq(raw('history-source'),original,'Source observation stays untouched');
eq((await projection()).find(entry=>entry.key==='الفا').contactCount,1,'Ordinary follow-up does not duplicate an old observation');
const nullSaved=await post(body('history',saved.id,null));
for(const key of Object.keys(priorFields))eq(record(nullSaved.id).data[key],undefined,'Null observation does not populate '+key);
eq(raw('history-source'),original,'Null observation leaves previous evidence intact');

// Fresh observations aggregate under normalized names and canonical database filenames.
file('fresh-file','history','rep','Canonical quote.pdf');
payload=body('history',nullSaved.id,observe({competitorFileId:'fresh-file',competitorFileName:'Forged filename.pdf'}));
saved=await post(payload);const stored=record(saved.id).data;
eq(stored.hasCompetitor,true);eq(stored.competitorName,'الفا');eq(stored.competitorNotes,'Fresh details');eq(stored.competitorFileId,'fresh-file');eq(stored.competitorFileName,'Canonical quote.pdf');eq(stored.competitorObservation,undefined);
eq(stored.performedBy,'rep','Authenticated recorder owns the follow-up');
let aggregate=(await projection()).find(entry=>entry.key==='الفا');eq(aggregate.contactCount,2);eq(aggregate.quoteCount,2);eq(aggregate.customerCount,1);eq(aggregate.contacts[0].id,saved.id,'New follow-up is the latest explicit observation');
eq(raw('history-source'),original,'Fresh follow-up does not rewrite original competitor notes or file');

// Receipts freeze the original request and never overwrite the saved observation.
const frozen=raw(saved.id),beforeCount=sql.prepare('SELECT COUNT(*) n FROM crm_records').get().n;
eq((await post(payload)).alreadySaved,true,'Exact retry succeeds despite changed customer/source versions');
eq(raw(saved.id),frozen,'Exact retry preserves saved data');eq(sql.prepare('SELECT COUNT(*) n FROM crm_records').get().n,beforeCount,'Exact retry creates no duplicate');
await post({...payload,data:{...payload.data,competitorObservation:observe({competitorNotes:'Drifted retry'})}},409);
eq(raw(saved.id),frozen,'Changed retry cannot overwrite evidence');

// Notes and a quote are optional; blank names are rejected only for affirmative observations.
payload=body('history',saved.id,{hasCompetitor:true,competitorName:'Beta',competitorFileName:'Filename without file.pdf'});saved=await post(payload);
eq(record(saved.id).data.competitorNotes,'');eq(record(saved.id).data.competitorFileId,'');eq(record(saved.id).data.competitorFileName,'','No file cannot retain a filename');
for(const observation of [{hasCompetitor:true},{hasCompetitor:true,competitorName:'   '},{hasCompetitor:'true',competitorName:'Beta'},observe({competitorName:'x'.repeat(251)}),observe({competitorNotes:'x'.repeat(6001)})])await post(body('history',saved.id,observation),400);
payload=body('history',saved.id,{hasCompetitor:false,competitorName:'Stale',competitorNotes:'Stale notes',competitorFileId:'nonexistent-file',competitorFileName:'Stale.pdf'});saved=await post(payload);
eq(Object.fromEntries(Object.keys(priorFields).map(key=>[key,record(saved.id).data[key]])),{hasCompetitor:false,competitorName:'',competitorNotes:'',competitorFileId:'',competitorFileName:''},'Negative observation clears stale submitted details without loading the file');
eq((await projection()).find(entry=>entry.key==='الفا').contactCount,2,'Cleared observation does not add competitor evidence');
saved=await post(body('history',saved.id,{}));eq(record(saved.id).data.hasCompetitor,false,'Empty explicit object uses visit-compatible defaults');

// File ownership/customer scope, role, region and private source rules apply at the route.
fixture('access');fixture('second');fixture('west','western','الغربية');fixture('foreign-source','outsider');
file('allowed','access');file('other-customer','second');file('private-peer','access','peer');file('private-outsider','access','outsider');file('western-file','west','western');
for(const fileId of ['missing','other-customer','private-peer','private-outsider','western-file'])await post(body('access',undefined,observe({competitorFileId:fileId})),403);
await post(body('west',undefined,observe()),403);await post(body('foreign-source',undefined,observe()),403);
for(const role of ['service','inactive']){user(role);await post(body('access',undefined,observe()),403);}
user(null);await post(body('access',undefined,observe()),401);
user('supervisor');saved=await post(body('access',undefined,observe({competitorFileId:'private-peer'})));eq(record(saved.id).data.competitorFileName,'private-peer.pdf','Supervisor can attach a current team upload');
user('manager');fixture('manager-access');file('manager-file','manager-access','outsider');saved=await post(body('manager-access',undefined,observe({competitorFileId:'manager-file'})));eq(record(saved.id).data.competitorFileId,'manager-file','Manager can attach authorized regional sales upload');
user('owner');saved=await post(body('west',undefined,observe({competitorFileId:'western-file'})));eq(record(saved.id).data.competitorFileId,'western-file','Admin supports authorized cross-region records');

// Each race occurs after validation but before the transaction's first write.
const assertRejectedRace=async(name,mutation,restore,author='rep',fileAuthor=author)=>{
 fixture(name,author);file(name+'-file',name,fileAuthor);const attempt=body(name,undefined,observe({competitorFileId:name+'-file'})),prior=raw(name);
 race=mutation;await post(attempt,409);eq(raw('customer-followup-'+attempt.createKey),undefined,name+' writes no activity');eq(raw(name),prior,name+' leaves customer plan untouched');eq(sql.prepare('SELECT COUNT(*) n FROM crm_audit WHERE record_id=?').get('customer-followup-'+attempt.createKey).n,0,name+' writes no receipt');if(restore)restore();
};
user('rep');
await assertRejectedRace('file-delete',()=>sql.prepare("DELETE FROM crm_visit_files WHERE id='file-delete-file'").run());
await assertRejectedRace('file-rebind',()=>sql.prepare("UPDATE crm_visit_files SET customer_id='second' WHERE id='file-rebind-file'").run());
await assertRejectedRace('file-uploader',()=>sql.prepare("UPDATE crm_visit_files SET uploaded_by='outsider' WHERE id='file-uploader-file'").run());
await assertRejectedRace('actor-region',()=>sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='rep'").run(),()=>sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='rep'").run());
await assertRejectedRace('actor-role',()=>sql.prepare("UPDATE crm_members SET role='customer_service' WHERE id='rep'").run(),()=>sql.prepare("UPDATE crm_members SET role='rep' WHERE id='rep'").run());
user('supervisor');
await assertRejectedRace('uploader-transfer',()=>sql.prepare("UPDATE crm_members SET supervisor_id='other-supervisor' WHERE id='peer'").run(),()=>sql.prepare("UPDATE crm_members SET supervisor_id='supervisor' WHERE id='peer'").run(),'supervisor','peer');
await assertRejectedRace('uploader-role',()=>sql.prepare("UPDATE crm_members SET role='customer_service' WHERE id='peer'").run(),()=>sql.prepare("UPDATE crm_members SET role='rep' WHERE id='peer'").run(),'supervisor','peer');

// Authorized historical file linkage is usable even if its uploader is outside the current team.
user('rep');fixture('linked','rep','الشرقية',{...priorFields,competitorFileId:'linked-file'});file('linked-file','linked','outsider');
saved=await post(body('linked',undefined,observe({competitorFileId:'linked-file'})));eq(record(saved.id).data.competitorFileId,'linked-file','Visible source attachment remains accessible');
fixture('linked-race','rep','الشرقية',{...priorFields,competitorFileId:'linked-race-file'});file('linked-race-file','linked-race','outsider');
payload=body('linked-race',undefined,observe({competitorFileId:'linked-race-file'}));race=()=>sql.prepare("UPDATE crm_records SET data=json_set(data,'$.performedBy','outsider'),version=version+1 WHERE id='linked-race-source'").run();
await post(payload,409);eq(raw('customer-followup-'+payload.createKey),undefined,'Losing historical source authorization prevents file reuse');

// Audit failure rolls back the observation and customer plan; an exact retry can then succeed.
fixture('rollback');payload=body('rollback',undefined,observe());const customerBefore=raw('rollback');auditFailure=true;await post(payload,500);auditFailure=false;
eq(raw('customer-followup-'+payload.createKey),undefined);eq(raw('rollback'),customerBefore);saved=await post(payload);eq(record(saved.id).data.competitorName,'الفا');
console.log(JSON.stringify({ok:true,checks,type:'real SQLite competitor follow-up observations, privacy, replay, atomicity and commit races'}));
