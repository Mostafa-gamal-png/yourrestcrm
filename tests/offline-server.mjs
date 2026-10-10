// Real follow-up handler, authorization, projections and migrated SQLite; identity alone is mocked.
// No network, production records or object storage writes.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'offline-server-')),seen=new Set();
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
for(const name of ['visits','customer-followups','customer-service','crm','visit-files'])compile('app/api/'+name+'/route.ts');
compile('lib/customer-visits.ts');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const filename of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+filename,'utf8'));
let race=null,objectRace=null;
class Statement{
 constructor(q,a=[]){this.q=q;this.a=a;}
 bind(...a){return new Statement(this.q,a);}
 async run(){const result=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(result.changes)}};}
 async all(){return{results:sql.prepare(this.q).all(...this.a)};}
 async first(){return sql.prepare(this.q).get(...this.a)||null;}
}
const DB={prepare:q=>new Statement(q),batch:async statements=>{if(race){const action=race;race=null;await action();}sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
const objects=new Map();
const FILES={put:async(key,bytes,meta)=>{objects.set(key,{bytes:new Uint8Array(bytes),meta});if(objectRace){const action=objectRace;objectRace=null;await action();}},delete:async key=>{objects.delete(key);},get:async key=>{const item=objects.get(key);return item?{body:item.bytes}:null;}};
globalThis.testEnv={DB,FILES,YR_APP_ORIGIN:'https://test.invalid'};
const NativeDate=Date;let clock=NativeDate.parse('2026-10-05T09:00:00.000Z');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
process.on('exit',()=>{globalThis.Date=NativeDate;});
const iso=()=>new Date().toISOString(),captured='2026-10-03T10:00:00.000Z',day='2026-10-03';
function member(id,role,supervisor='',region='eastern',active=1){sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,?,0,?)').run(id,'u-'+id,id+'@yourrest.org',id,role,'الرئيسي',supervisor||null,region,active,iso());}
member('owner','admin','','all');member('supervisor','supervisor');member('rep','rep','supervisor');member('peer','rep','supervisor');member('western','rep','supervisor','western');member('service','customer_service');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const user=id=>{globalThis.testUser=id?{userId:'u-'+id,email:id+'@yourrest.org',fullName:id}:null;};
const raw=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id);
const record=id=>{const r=raw(id);return {...r,parentId:r.parent_id,assignedTo:r.assigned_to,createdAt:r.created_at,updatedAt:r.updated_at,data:JSON.parse(r.data)};};
function insert(id,kind,parentId,data,author='rep',region='الشرقية',createdAt=iso()){
 sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,1,?)').run(id,kind,parentId,author,'الرئيسي',JSON.stringify(kind==='customer'?{name:id,region,...data}:{performedBy:author,recordedByEmail:author+'@yourrest.org',...data}),createdAt,createdAt,'fixture');
}
const routes={};for(const name of ['visits','customer-followups','customer-service','crm','visit-files'])routes[name]=await import(path.join(out,'app/api/'+name+'/route.mjs'));
const {customerVisits}=await import(path.join(out,'lib/customer-visits.mjs'));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
async function post(name,payload,status=200){const response=await routes[name].POST(new Request('https://test.invalid/api/'+name,{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(payload)}));const result=await response.json();eq(response.status,status,JSON.stringify(result));return result;}
const fields={type:'call',summary:'تعريف بمنتجات الشركة',result:'طلب مواصفات القالب',salesStage:'new',strength:'strong',requestedProducts:['قوالب البلوك المتحركة'],nextAction:'متابعة المواصفات',nextDate:day,location:'26.437341, 50.034499',locationSource:'device',locationCapturedAt:captured,locationAccuracy:12};
function visit(customerId,at=captured,extra={}){return{createKey:crypto.randomUUID(),customerId,customerVersion:raw(customerId).version,timingMode:'automatic',elapsedMilliseconds:125000,data:{...fields},offline:{memberId:'rep',capturedAt:at},...extra};}
function fixture(id){insert(id,'customer',null,{});return id;}
function followup(customerId,sourceId){return{createKey:crypto.randomUUID(),customerId,customerVersion:raw(customerId).version,sourceId,sourceVersion:raw(sourceId).version,offline:{memberId:'rep',capturedAt:captured},data:{type:'call',date:day,result:'نتيجة متابعة فعلية',salesStage:'new',invoiceOutcome:'pending',nextAction:'المتابعة التالية',nextDate:day}};}
user('rep');fixture('factory');
let payload=visit('factory'),saved=await post('visits',payload),entry=record(saved.id);
eq(entry.data.date,day,'Stored visit day is capture day, not sync day');eq(entry.data.endedAt,captured);eq(entry.data.startedAt,'2026-10-03T09:57:55.000Z');eq(entry.data.durationSeconds,125);eq(entry.data.receivedAt,iso());eq(entry.createdAt,iso(),'Database creation/audit remain server receipt time');eq(entry.data.performedBy,'rep');
eq((await post('visits',payload)).alreadySaved,true,'Lost response retry returns canonical receipt');
eq(sql.prepare("SELECT count(*) AS n FROM crm_records WHERE kind='activity'").get().n,1,'Retry creates one visit');
await post('visits',{...payload,data:{...payload.data,result:'Changed uncertain attempt'}},409);
await post('visits',visit('factory',captured,{offline:{memberId:'peer',capturedAt:captured}}),403);
await post('visits',visit('factory','2026-10-05T09:01:01.000Z'),400);
await post('visits',visit('factory','2026-02-31T10:00:00.000Z'),400);
await post('visits',visit('factory',captured,{offline:null}),403);
await post('visits',visit('factory',captured,{id:saved.id,version:entry.version}),400);
const planBefore=record('factory').data._visitPlan;
let earlier=await post('visits',visit('factory','2026-10-02T10:00:00.000Z',{customerVersion:1}));
eq(record('factory').data._visitPlan,planBefore,'Older uploaded entry never overwrites newer plan');
let latest=await post('visits',visit('factory','2026-10-04T10:00:00.000Z',{customerVersion:1,data:{...fields,nextDate:'2026-10-04'}}));
eq(record('factory').data._visitPlan.visitId,latest.id,'New offline entry may append after customer version changes');
eq(customerVisits('factory',[record('factory'),entry,record(earlier.id),record(latest.id)]).map(r=>r.id),[latest.id,saved.id,earlier.id],'Visit history sorts original capture times');
const online=visit('factory',iso());delete online.offline;online.data.nextDate='2026-10-05';online.data.locationCapturedAt=iso();online.customerVersion=1;await post('visits',online,409);
// A previously selected stop may already be closed when its queued visit arrives.
fixture('journey-factory');const journeyData={arrivalAt:'2026-10-03T09:55:00.000Z',departureAt:captured,durationSeconds:300,durationUncertain:false,observedSeconds:300,gaps:[],events:[]};
sql.prepare('INSERT INTO crm_journey_stops(id,member_id,date,customer_id,region_scope,snapshot,selected_at,closed_at,state,data,version) VALUES(?,?,?,?,?,?,?,?,?,?,1)').run('closed-offline-stop','rep',day,'journey-factory','eastern',JSON.stringify({customerName:'Journey factory',region:'الشرقية',latitude:26.437341,longitude:50.034499}),'2026-10-03T09:50:00.000Z',captured,'completed',JSON.stringify(journeyData));
const journeyPayload=visit('journey-factory',captured,{data:{...fields,type:'visit',journeyStopId:'closed-offline-stop'}});const journeySaved=await post('visits',journeyPayload);const journeyEntry=record(journeySaved.id);eq(journeyEntry.data.startedAt,journeyData.arrivalAt);eq(journeyEntry.data.endedAt,captured);eq(journeyEntry.data.durationSeconds,300);eq(journeyEntry.data.timingSource,'journey');eq(sql.prepare('SELECT stop_id FROM crm_journey_links WHERE activity_id=?').get(journeySaved.id).stop_id,'closed-offline-stop');
await post('visits',visit('journey-factory','2026-10-04T10:00:00.000Z',{data:{...fields,nextDate:'2026-10-04',type:'visit',journeyStopId:'closed-offline-stop'}}),400);
// Editing online preserves the original capture/receipt evidence.
user('owner');const beforeEdit=record(earlier.id);await post('visits',{createKey:crypto.randomUUID(),id:earlier.id,version:beforeEdit.version,customerId:'factory',customerVersion:raw('factory').version,timingMode:'automatic',elapsedMilliseconds:0,data:{...beforeEdit.data,result:'Manager corrected result'}});eq(record(earlier.id).data.offlineRecordedAt,beforeEdit.data.offlineRecordedAt);eq(record(earlier.id).data.receivedAt,beforeEdit.data.receivedAt);eq(record(earlier.id).data.performedBy,'rep');user('rep');
// Fresh permission and transaction guards also apply to historical offline writes.
fixture('revoked');const revoked=visit('revoked');sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='rep'").run();await post('visits',revoked,403);sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='rep'").run();
fixture('race');const raceBody=visit('race');race=()=>sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='rep'").run();await post('visits',raceBody,409);eq(raw('customer-visit-'+raceBody.createKey),undefined);sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='rep'").run();
user('peer');await post('visits',payload,403);user('rep');
// Followups retain source/customer compare-and-swap instead of rewriting an old plan.
fixture('followup');insert('followup-source','activity','followup',{...fields,date:day,visitWorkflow:'customer-v1'},'rep','الشرقية','2026-10-03T08:00:00.000Z');
payload=followup('followup','followup-source');saved=await post('customer-followups',payload);entry=record(saved.id);eq(entry.data.date,day);eq(entry.data.offlineRecordedAt,captured);eq(entry.data.receivedAt,iso());eq((await post('customer-followups',payload)).alreadySaved,true);
fixture('stale');insert('stale-source','activity','stale',{...fields,date:day,visitWorkflow:'customer-v1'});payload=followup('stale','stale-source');sql.prepare("UPDATE crm_records SET version=version+1 WHERE id='stale-source'").run();await post('customer-followups',payload,409);eq(raw('customer-followup-'+payload.createKey),undefined);
fixture('stale-customer');insert('stale-customer-source','activity','stale-customer',{...fields,date:day,visitWorkflow:'customer-v1'});payload=followup('stale-customer','stale-customer-source');sql.prepare("UPDATE crm_records SET version=version+1 WHERE id='stale-customer'").run();await post('customer-followups',payload,409);
// New customers keep existing deterministic identity, owner and creation receipts.
payload={action:'save',kind:'customer',createKey:crypto.randomUUID(),data:{name:'Offline factory',phone:'0555000100',region:'الشرقية',branch:'الرئيسي',assignedTo:'rep'},offline:{memberId:'rep',capturedAt:captured}};
saved=await post('crm',payload);eq(saved.id,'crm-rep-'+payload.createKey);eq(record(saved.id).data.offlineRecordedAt,captured);eq((await post('crm',payload)).alreadySaved,true);await post('crm',{...payload,offline:{memberId:'peer',capturedAt:captured}},403);await post('visits',visit(saved.id));
user('service');fixture('service-factory');payload={action:'create',requestId:crypto.randomUUID(),customerId:'service-factory',customerVersion:1,registration:{...fields},elapsedMilliseconds:60000,offline:{memberId:'service',capturedAt:captured}};saved=await post('customer-service',payload);let serviceRecord=JSON.parse(sql.prepare('SELECT data FROM crm_service_cases WHERE id=?').get(saved.id).data);eq(serviceRecord.registration.date,day);eq(serviceRecord.registration.endedAt,captured);eq(serviceRecord.registration.receivedAt,iso());eq((await post('customer-service',payload)).alreadySaved,true);await post('customer-service',{...payload,action:'edit',id:saved.id,version:1},400);
const nextService={...payload,requestId:crypto.randomUUID(),offline:{memberId:'service',capturedAt:'2026-10-03T11:00:00.000Z'}};const repeatService=await post('customer-service',nextService);eq(repeatService.id,saved.id);serviceRecord=JSON.parse(sql.prepare('SELECT data FROM crm_service_cases WHERE id=?').get(saved.id).data);eq(serviceRecord.registrations.length,1,'Two queued service visits append without rebasing their customer snapshot');eq(serviceRecord.registrations[0].registration.offlineRecordedAt,'2026-10-03T11:00:00.000Z');await post('customer-service',{...payload,requestId:crypto.randomUUID(),offline:{memberId:'service',capturedAt:'2026-10-02T11:00:00.000Z'}},409);
// Attachment uploads retry exact bytes using per-owner stable keys and current authorization.
user('rep');const pdf='%PDF-1.7\nOffline quotation',files=()=>sql.prepare('SELECT * FROM crm_visit_files').all();
async function upload(key,extra={},status=200){const form=new FormData();form.set('file',new File([extra.bytes||pdf],extra.name||'quote.pdf',{type:'application/pdf'}));form.set('customerId',extra.customerId||'factory');form.set('uploadKey',key);form.set('memberId',extra.memberId||'rep');const response=await routes['visit-files'].POST(new Request('https://test.invalid/api/visit-files',{method:'POST',headers:{origin:'https://test.invalid'},body:form}));const value=await response.json();eq(response.status,status,JSON.stringify(value));return value;}
let key=crypto.randomUUID();saved=await upload(key);eq(objects.size,1);eq(files().length,1);eq((await upload(key)).id,saved.id);eq(objects.size,1);eq(files().length,1);await upload(key,{bytes:pdf+' changed'},409);await upload(key,{name:'renamed.pdf'},409);await upload(key,{memberId:'peer'},403);eq(objects.size,1);eq(files().length,1);
const competitorVisit=visit('factory','2026-10-04T11:00:00.000Z',{data:{...fields,nextDate:'2026-10-04',hasCompetitor:true,competitorName:'Test competitor',competitorFileId:saved.id,competitorFileName:'fake.pdf'}});const attached=await post('visits',competitorVisit);eq(record(attached.id).data.competitorFileName,'quote.pdf');
key=crypto.randomUUID();let winner;objectRace=async()=>{winner=await upload(key);};saved=await upload(key);eq(saved.id,winner.id,'Concurrent same upload returns one identity');eq(files().length,2);eq(objects.size,2,'Losing upload cleans only its own temporary object');for(const file of files())ok(objects.has(file.object_key),'Committed file object still exists');
key=crypto.randomUUID();objectRace=async()=>{winner=await upload(key);};await upload(key,{bytes:pdf+' conflicting'},409);eq(files().length,3);eq(objects.size,3);for(const file of files())ok(objects.has(file.object_key));
key=crypto.randomUUID();objectRace=()=>sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='rep'").run();await upload(key,{},409);eq(files().length,3);eq(objects.size,3,'Scope revoked between object and SQL cleans temporary object');sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='rep'").run();
console.log(JSON.stringify({ok:true,checks,type:'actual SQLite offline captures, source conflicts, new customers, actor/region guards and idempotent file uploads',liveData:false}));
