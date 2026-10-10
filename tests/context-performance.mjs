import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

// Shape/read-budget regression, not a hosting capacity benchmark. Real migrations,
// SQLite and route handlers; only authenticated identity is replaced in this test.
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'context-performance-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),'export async function getApplicationUser(){return globalThis.testUser;}');
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const source=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let child=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(source),imp));
  if(!/\.tsx?$/.test(child))child+=fs.existsSync(path.join(root,child+'.ts'))?'.ts':'.tsx';
  compile(child);return 'from '+JSON.stringify(path.join(out,child.replace(/\.tsx?$/,'.mjs')));
 });fs.writeFileSync(dest,code);
}
for(const file of ['lib/crm-server.ts','lib/mobile-route-server.ts','lib/customer-service.ts','app/api/mobile-route/route.ts','app/api/targets/route.ts','app/api/kpis/route.ts','app/api/visits/route.ts','app/api/customer-followups/route.ts'])compile(file);
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const file of fs.readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+file,'utf8'));
let reads=[];
class Statement{
 constructor(q,a=[]){this.q=q;this.a=a;}
 bind(...a){return new Statement(this.q,a);}
 async all(){const results=sql.prepare(this.q).all(...this.a);reads.push({q:this.q,a:this.a,rows:results.length,bytes:results.reduce((n,r)=>n+(typeof r.data==='string'?Buffer.byteLength(r.data):0),0)});return{results};}
 async first(){return sql.prepare(this.q).get(...this.a)||null;}
 async run(){const result=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(result.changes)}};}
}
const DB={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const now=new Date().toISOString(),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function member(id,role='rep',region='eastern',supervisor=null,active=1){sql.prepare('INSERT INTO crm_members(id,email,name,role,branch,supervisor_id,region_scope,active,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,id+'@yourrest.org',id,role,'main',supervisor,region,active,now);}
member('owner','admin','all');member('manager','manager');member('sup','supervisor','eastern','manager');member('rep','rep','eastern','sup');member('peer');member('moved','rep','western','sup');member('inactive','rep','eastern','sup',0);member('cs','customer_service');member('csm','customer_service_manager');member('unassigned','rep','unassigned');member('all','rep','all');
const insert=sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)');
function row(id,kind='customer',parent=null,data={},author='rep'){insert.run(id,kind,parent,author,'main',JSON.stringify(data),now,now);}
row('east','customer',null,{name:'East',region:'الشرقية',code:'global-east',_visitPlan:{visitId:'peer-activity'},_stageVisitId:'peer-activity'});
row('west','customer',null,{name:'West',region:'الغربية',code:'global-west'});
row('variant','customer',null,{name:'Variant',region:'  المنطقة\u00a0الشرقية  '});
row('coded','customer',null,{name:'Coded',region:'eastern'});
row('unknown','customer',null,{name:'Unassigned',region:'unknown-territory'});
row('nested-west','customer','east',{name:'Independent customer root',region:'western'});
row('machine','factory','east',{name:'Machine'});row('opportunity','opportunity','machine',{performedBy:'peer'});
for(const id of ['rep','peer','moved','inactive'])row(id+'-activity','activity','opportunity',{performedBy:id,type:'visit',date,requestId:'opportunity',requestSnapshot:{secret:'hidden if unowned'},sourceId:'peer-activity',_serviceWorkflow:{secret:true}});
row('email-activity','activity','east',{recordedByEmail:' MOVED@YOURREST.ORG ',type:'call',date});
row('west-activity','activity','west',{performedBy:'rep',type:'visit',date});
row('orphan','activity','missing',{performedBy:'rep'});row('cycle-a','activity','cycle-b',{performedBy:'rep'});row('cycle-b','activity','cycle-a',{performedBy:'rep'});
const service=sql.prepare("INSERT INTO crm_service_cases(id,customer_id,status,creator_id,assigned_to,data,created_at,updated_at,mutation_id) VALUES(?,?,'assigned','cs','rep',?,?,?,'fixture')");
service.run('east-service','east',JSON.stringify({participants:['cs'],registration:{performedBy:'cs',type:'call',date}}),now,now);
service.run('west-service','west',JSON.stringify({participants:['cs'],registration:{performedBy:'cs',type:'call',date}}),now,now);
row('service-contact','activity','east',{performedBy:'rep',serviceCaseId:'east-service',salesStage:'new',type:'call',date});

const server=await import(path.join(out,'lib/crm-server.mjs')),regions=await import(path.join(out,'lib/regions.mjs')),crm=await import(path.join(out,'lib/crm.mjs')),services=await import(path.join(out,'lib/customer-service.mjs')),access=await import(path.join(out,'lib/access.mjs')),customerVisits=await import(path.join(out,'lib/customer-visits.mjs'));
const mobileServer=await import(path.join(out,'lib/mobile-route-server.mjs')),mobile=await import(path.join(out,'app/api/mobile-route/route.mjs')),targets=await import(path.join(out,'app/api/targets/route.mjs')),kpis=await import(path.join(out,'app/api/kpis/route.mjs'));
function user(id){globalThis.testUser=id?{memberId:id,email:id+'@yourrest.org',memberVersion:sql.prepare('SELECT auth_version FROM crm_members WHERE id=?').get(id).auth_version,provider:'email-otp'}:null;}
let checks=0;const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
// Legacy parity excludes only the two new server-owned identity projections.
const sorted=rows=>rows.map(row=>{const data={...row.data};delete data.internalCode;delete data._erpCodeAliases;return{...row,data};}).sort((a,b)=>a.id.localeCompare(b.id));
// Independent pre-optimization projection, using the original public per-row
// permissions instead of the new projection-local access index.
function legacyScope(all,members,me){
 all=regions.regionRecords(all,me);if(['customer_service','customer_service_manager'].includes(me.role))return[];if(me.role==='admin')return all;
 const indexed=new Map(all.map(row=>[row.id,row])),allowed=all.filter(row=>access.canReadSalesRecord(row,members,me)),ids=new Set(allowed.map(row=>row.id));
 const rootCustomer=row=>{let current=row;const seen=new Set();while(current&&current.kind!=='customer'&&!seen.has(current.id)){seen.add(current.id);current=current.parentId?indexed.get(current.parentId):undefined;}return current?.kind==='customer'?current:undefined;};
 return allowed.map(row=>{const data={...row.data};let parentId=row.parentId;if(row.kind==='customer'){if(data._visitPlan&&!ids.has(data._visitPlan.visitId))delete data._visitPlan;if(data._stageVisitId&&!ids.has(data._stageVisitId))delete data._stageVisitId;if(!access.canEditCustomerDetails(row,members,me))data._masterReadOnly=true;if(!access.canManageMasterRecord(row,members,me))data._masterRoutingReadOnly=true;}if(row.kind==='factory'&&!access.canManageMasterRecord(row,members,me))data._masterReadOnly=true;if(['activity','quote'].includes(row.kind)&&parentId&&!ids.has(parentId))parentId=rootCustomer(row)?.id||parentId;if(data.requestSnapshot&&(!data.requestId||!ids.has(data.requestId)))delete data.requestSnapshot;if(data.requestId&&!ids.has(data.requestId))delete data.requestId;if(data.sourceId&&!ids.has(data.sourceId))delete data.sourceId;if(data._serviceWorkflow)delete data._serviceWorkflow;return{...row,parentId,data};});
}
function baseline(c){const all=sql.prepare('SELECT id,kind,parent_id AS parentId,assigned_to AS assignedTo,branch,data,created_at AS createdAt,updated_at AS updatedAt,version FROM crm_records ORDER BY created_at DESC').all().map(row=>({...row,data:JSON.parse(row.data)})),serviceCases=sql.prepare('SELECT id,customer_id AS customerId,status,creator_id AS creatorId,service_manager_id AS serviceManagerId,sales_manager_id AS salesManagerId,assigned_to AS assignedTo,supervisor_id AS supervisorId,data,created_at AS createdAt,updated_at AS updatedAt,version FROM crm_service_cases ORDER BY created_at DESC,id DESC').all().map(row=>({...row,data:JSON.parse(row.data)})),regionalRecords=regions.regionRecords(all,c.me);return{...c,all,serviceCases,regionalRecords,visible:legacyScope(regionalRecords,c.members,c.me)};}
// Semantic parity includes author history after relocation/deactivation, nested
// parents, privacy projections, service intake and exact region normalization.
for(const id of ['owner','manager','sup','rep','peer','moved','cs','csm','unassigned','all']){
 user(id);const c=await server.context(),old=baseline(c);
 eq(sorted(c.visible),sorted(old.visible),'Visible parity '+id);
 eq(sorted(c.regionalRecords),sorted(old.regionalRecords),'Regional parity '+id);
 eq(sorted(services.serviceVisitRecords(c)),sorted(services.serviceVisitRecords(old)),'Service projection parity '+id);
 eq(c.all.filter(r=>r.kind==='customer').length,6,'Global master validations retained '+id);
 const directory=await server.context({load:'directory'});
 eq(sorted(directory.visible),sorted(old.visible),'Metadata hydration author/ancestor parity '+id);
 eq(sorted(services.serviceVisitRecords(directory)),sorted(services.serviceVisitRecords(old)),'Metadata hydration service parity '+id);
 for(const customer of old.visible.filter(row=>row.kind==='customer'))eq(services.activeServiceCase(customer.id,directory)?.id,services.activeServiceCase(customer.id,old)?.id,'Latest service state parity '+id);
}
user('sup');let c=await server.context();ok(c.visible.some(row=>row.id==='moved-activity'),'Moved member regional authored history remains');ok(c.visible.some(row=>row.id==='inactive-activity'),'Inactive member history remains');
user('rep');c=await server.context();eq(c.visible.find(row=>row.id==='rep-activity').parentId,'east');eq(c.visible.find(row=>row.id==='rep-activity').data.requestSnapshot,undefined);eq(c.visible.find(row=>row.id==='east').data._visitPlan,undefined);

const stopInsert=sql.prepare("INSERT INTO crm_journey_stops(id,member_id,date,customer_id,region_scope,snapshot,selected_at,closed_at,state,data) VALUES(?,?,?,?,?,?,?,?,'en_route',?)");
const stopData={events:[],gaps:[],lastPoint:null,arrivalAt:null,departureAt:null,durationSeconds:null,durationUncertain:false};
stopInsert.run('open-stop','rep',date,'east','eastern',JSON.stringify({customerName:'East'}),now,null,JSON.stringify(stopData));
stopInsert.run('replay-stop','rep',date,'variant','eastern',JSON.stringify({customerName:'Variant'}),now,now,JSON.stringify(stopData));
stopInsert.run('foreign-stop','peer',date,'coded','eastern',JSON.stringify({customerName:'Coded'}),now,null,JSON.stringify(stopData));
const device=crypto.randomUUID();sql.prepare("INSERT INTO crm_mobile_route_days(id,member_id,device_id,date,region_scope,started_at,ended_at,data) VALUES('own-day','rep',?,?,'eastern',?,NULL,?)").run(device,date,now,JSON.stringify({gaps:[]}));
async function mobileRead(body={}){reads=[];const c=await mobileServer.mobileContext(body);const rows=reads.filter(read=>read.q.includes('JOIN crm_records'));return{c,rows,recordRows:rows.reduce((n,r)=>n+r.rows,0),recordBytes:rows.reduce((n,r)=>n+r.bytes,0),serviceReads:reads.filter(read=>read.q.includes('FROM crm_service_cases')).length,mappingReads:reads.filter(read=>read.q.includes('crm_customer_code_mappings')).length};}
let small=await mobileRead();eq(small.c.all.map(row=>row.id),['east']);eq(small.serviceReads,0);eq(small.mappingReads,0,'Mobile GPS does not load global ERP mappings');
const payload='large-history-marker-'+('x'.repeat(1000));sql.exec('BEGIN');for(let n=0;n<24000;n++)row('bulk-'+n,'activity',n<20000?'west':'east',{performedBy:'peer',type:'call',date,result:payload},'peer');sql.exec('COMMIT');
const large=await mobileRead();eq(large.recordRows,small.recordRows,'GPS root row budget independent of 24000 unrelated history rows');eq(large.recordBytes,small.recordBytes,'GPS JSON allocation independent of unrelated history size');eq(large.serviceReads,0);eq(large.mappingReads,0);
const selected=await mobileRead({points:[{stopId:'replay-stop'},{stopId:'foreign-stop'}]});eq(selected.c.all.map(row=>row.id).sort(),['east','variant']);
const dayRead=await mobileRead({dayId:'own-day'});eq(dayRead.c.all.map(row=>row.id).sort(),['east','variant']);
const foreignDay=await mobileRead({dayId:'foreign-day'});eq(foreignDay.c.all.map(row=>row.id),['east']);
// Verify the hot path retrieves root IDs through SQLite indexes, not a scan of
// the activities table. Query plans remain diagnostic, not timing assertions.
const plan=sql.prepare('EXPLAIN QUERY PLAN '+large.rows[0].q).all(...large.rows[0].a).map(row=>row.detail);
ok(plan.some(detail=>/SEARCH crm_records USING INDEX .*\(id=\?\)/.test(detail)),'Mobile permission roots use primary-key customer lookups');
ok(!plan.some(detail=>/crm_records_kind|^SCAN crm_records\b/.test(detail)),'No whole-customer-directory or history scan for mobile context');
reads=[];c=await server.context();eq(c.all.filter(row=>row.id.startsWith('bulk-')).length,4000,'Regional context excludes 20000 foreign history records');ok(c.all.some(row=>row.id==='west'),'Global duplicate-code master remains internal');eq(c.visible.some(row=>row.id==='west'),false,'Foreign customer is never serialized as visible');
eq(reads.filter(r=>r.q.includes('FROM crm_records')).reduce((n,r)=>n+r.rows,0),4014,'Regional raw CRM rows are bounded to masters and local descendants');
reads=[];const identity=await server.context({load:'identity'});eq(identity.all,[]);eq(identity.serviceCases,[]);eq(reads.some(r=>r.q.includes('FROM crm_records')||r.q.includes('FROM crm_service_cases')),false);
reads=[];const customers=await server.context({load:'customers'});eq(customers.all.length,6);eq(customers.serviceCases,[]);eq(reads.reduce((n,r)=>n+(r.q.includes('FROM crm_records')?r.rows:0),0),6);
// Route-level proof: frequent mobile refresh and personal targets use narrow
// contexts; management-only KPI save rejects a rep without loading CRM history.
reads=[];eq((await mobile.GET()).status,200);eq(reads.filter(r=>r.q.includes('JOIN crm_records')).reduce((n,r)=>n+r.rows,0),1);
reads=[];eq((await targets.GET(new Request('https://test.invalid/api/targets?month='+date.slice(0,7)))).status,200);eq(reads.some(r=>r.q.includes('FROM crm_records')||r.q.includes('FROM crm_service_cases')),false);
reads=[];eq((await kpis.POST(new Request('https://test.invalid/api/kpis',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:'{}'}))).status,403);eq(reads.some(r=>r.q.includes('FROM crm_records')||r.q.includes('FROM crm_service_cases')),false);
// Hydration retains an invisible latest service contact: it can close a case
// without revealing that author's result in the reader's activity projection.
row('hidden-service-close','activity','east',{performedBy:'peer',serviceCaseId:'east-service',salesStage:'won',type:'call',date,startedAt:new Date(Date.now()+1000).toISOString()});
row('unknown-author-email','activity','east',{recordedByEmail:'unknown@yourrest.org',responsibleId:'rep',type:'call',date});
for(const [index,value] of [true,false,1,0,{},['rep'],null].entries())row('typed-author-'+index,'activity','east',{performedBy:value,recordedByEmail:'',responsibleId:'rep',type:'call',date});
for(const reader of ['rep','sup','manager','cs']){user(reader);const ordinary=baseline(await server.context()),directory=await server.context({load:'directory'});eq(sorted(directory.visible),sorted(ordinary.visible),'Exact legacy author coercion '+reader);eq(sorted(services.serviceVisitRecords(directory)),sorted(services.serviceVisitRecords(ordinary)),'Invisible final service contact parity '+reader);eq(services.activeServiceCase('east',directory),undefined,'Hidden won contact closes intake '+reader);eq(directory.visible.some(row=>row.id==='unknown-author-email'),false,'Unknown email suppresses fallback '+reader);if(reader==='rep'){eq(directory.visible.some(row=>row.id==='hidden-service-close'),false);ok(directory.all.some(row=>row.id==='hidden-service-close'),'Hidden latest contact hydrated only internally');}}
// The customer-graph writer preserves independent legacy ordering/projection,
// private request links and errors without hydrating unrelated customer history.
const legacyVisits=(id,rows)=>rows.filter(r=>r.kind==='activity'&&customerVisits.visitCustomer(r,rows)?.id===id).sort((a,b)=>customerVisits.visitOrder(b).localeCompare(customerVisits.visitOrder(a)));
const specimen=(id,kind,parentId,data={})=>({id,kind,parentId,data,assignedTo:'rep',branch:'main',createdAt:now,updatedAt:now,version:1});
const orderFixture=[specimen('root','customer',null),specimen('other','customer',null),specimen('p1','factory','root'),specimen('p2','opportunity','p1'),specimen('p3','opportunity','p2'),specimen('p4','opportunity','p3'),specimen('duplicate','factory','root'),specimen('duplicate','factory','other'),specimen('cycle','opportunity','cycle'),specimen('','customer',null)];
for(let i=0;i<60;i++)orderFixture.push(specimen('case-'+i,'activity',['root','other','p2','p3','p4','missing','cycle','duplicate',''][i%9],{date,startedAt:i%3===0?now:'',visitWorkflow:i%4===0?'followup-v1':'customer-v1'}));
for(const id of ['root','other',''])eq(customerVisits.customerVisits(id,orderFixture),legacyVisits(id,orderFixture),'Order/depth/first-duplicate parity '+id);
row('visit-target','customer',null,{name:'Target factory',region:'eastern'});
row('hidden-request','opportunity','visit-target',{performedBy:'peer',responsibleId:'peer',hasRequest:true,stage:'new'});
const contact={type:'call',date,summary:'مصنع الاختبار',result:'تم التواصل',salesStage:'new',strength:'medium',nextAction:'اتصال لاحق',nextDate:date,location:'26.43, 50.03',locationSource:'device',locationCapturedAt:now,locationAccuracy:10};
row('old-target-visit','activity','visit-target',{...contact,visitWorkflow:'customer-v1',performedBy:'rep',responsibleId:'rep',recordedByEmail:'rep@yourrest.org',requestId:'hidden-request',requestSnapshot:{secret:'preserved-private-request'}});
user('sup');reads=[];const graph=await server.context({load:'customer-graph',customerId:'visit-target',recordIds:['old-target-visit']});
eq(graph.all.length,3);eq(graph.visible.map(r=>r.id).sort(),['old-target-visit','visit-target']);eq(graph.visible.find(r=>r.id==='old-target-visit').data.requestId,undefined);eq(graph.all.find(r=>r.id==='old-target-visit').data.requestId,'hidden-request');eq(reads.filter(r=>r.q.includes('FROM crm_records')).reduce((n,r)=>n+r.rows,0),3,'Writer reads only its complete customer graph');
const expectedGraph=baseline(graph);eq(sorted(graph.visible),sorted(expectedGraph.visible.filter(r=>['visit-target','old-target-visit'].includes(r.id))));
const visitsApi=await import(path.join(out,'app/api/visits/route.mjs')),followupsApi=await import(path.join(out,'app/api/customer-followups/route.mjs'));
async function post(api,body,status){const response=await api.POST(new Request('https://test.invalid/api/visits',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)}));const result=await response.json();eq(response.status,status,JSON.stringify(result));return result;}
const visitInput={createKey:crypto.randomUUID(),customerId:'visit-target',customerVersion:1,timingMode:'automatic',elapsedMilliseconds:2000,data:contact};
user('rep');await post(visitsApi,{...visitInput,customerId:'west'},403);
user('sup');await post(visitsApi,{...visitInput,id:'west-activity',version:1},404);await post(visitsApi,{...visitInput,id:'rep-activity',version:1},400);await post(visitsApi,{...visitInput,requestId:'hidden-request'},403);await post(visitsApi,{...visitInput,requestId:'missing-request'},403);
await post(followupsApi,{...visitInput,sourceId:'west-activity',sourceVersion:1},403);await post(followupsApi,{...visitInput,sourceId:'rep-activity',sourceVersion:1},403);
const edited=await post(visitsApi,{...visitInput,id:'old-target-visit',version:1},200);eq(edited.id,'old-target-visit');const privateData=JSON.parse(sql.prepare("SELECT data FROM crm_records WHERE id='old-target-visit'").get().data);eq(privateData.requestId,'hidden-request');eq(privateData.requestSnapshot,{secret:'preserved-private-request'});
user('rep');const savedBody={...visitInput,createKey:crypto.randomUUID(),customerVersion:sql.prepare("SELECT version FROM crm_records WHERE id='visit-target'").get().version};const saved=await post(visitsApi,savedBody,200);eq((await post(visitsApi,savedBody,200)).alreadySaved,true);
const oldRegion=sql.prepare("SELECT data FROM crm_records WHERE id='visit-target'").get().data;sql.prepare("UPDATE crm_records SET data=json_set(data,'$.region','western'),version=version+1 WHERE id='visit-target'").run();await post(visitsApi,savedBody,404);eq(sql.prepare('SELECT COUNT(*) n FROM crm_records WHERE id=?').get(saved.id).n,1,'Moved-customer retry cannot duplicate or disclose saved entry');sql.prepare("UPDATE crm_records SET data=?,version=version+1 WHERE id='visit-target'").run(oldRegion);
// No permission cache: a previously authenticated session is invalid after
// mutation; a fresh session sees changed scope. Commit guards also stay live.
user('rep');c=await mobileServer.mobileContext();const guard=server.accessGuard(c,c.all[0]);sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='rep'").run();
await assert.rejects(()=>server.context({load:'identity'}),error=>error.status===403);checks++;
eq(sql.prepare('SELECT 1 AS allowed WHERE '+guard.sql).get(...guard.args),undefined,'Old permission snapshot cannot commit');
user('rep');const changed=await mobileServer.mobileContext();eq(changed.me.regionScope,'western');eq(changed.visible.length,0,'Old open customer hidden after scope change');
eq((await mobile.GET()).status,200);eq((await (await mobile.GET()).json()).activeStop,null);
user(null);reads=[];eq((await mobile.GET()).status,401);eq(reads.length,0);
eq(sql.prepare('PRAGMA foreign_key_check').all(),[]);
console.log(JSON.stringify({contextPerformanceQA:'passed',checks,unrelatedHistoryRows:24000,mobileRecordRows:large.recordRows,mobileRecordBytes:large.recordBytes,productionDataUsed:false,loadCapacityClaim:false,mobileQueryPlan:plan}));
