import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
// Isolated handler integration checks: real SQL migrations and domain code; mocked identity and R2.
// No network requests or production writes. Run from the repository root.
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'crm-regression-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=? OR email=?').bind(u.userId,u.email).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let destSource=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(destSource))destSource+=fs.existsSync(path.join(root,destSource+'.ts'))?'.ts':'.tsx';compile(destSource);return 'from '+JSON.stringify(path.join(out,destSource.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
for(const r of ['crm','customer-service','visits','customer-followups','followups','sales','targets','kpis','visit-files'])compile('app/api/'+r+'/route.ts');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+f,'utf8'));
let race=null,auditFailure=false;
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){if(auditFailure&&this.q.startsWith('INSERT INTO crm_audit'))throw new Error('test-audit-failure');const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async ss=>{if(race){const f=race;race=null;await f();}sql.exec('BEGIN');try{const results=[];for(const s of ss)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
sql.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,active,region_scope,target,created_at) VALUES('owner','u-owner','owner@yourrest.org','owner','admin','الرئيسي',1,'all',0,?)").run(new Date().toISOString());
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();const user=id=>{globalThis.testUser={userId:'u-'+id,email:id+'@yourrest.org',fullName:id};};user('owner');
const api=async name=>import(path.join(out,'app/api/'+name+'/route.mjs'));
const crm=await api('crm'),service=await api('customer-service'),followups=await api('customer-followups'),visits=await api('visits'),sales=await api('sales');
let checks=0;
const req=body=>new Request('https://test.invalid/api/test',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)});
async function post(route,body,status=200){const res=await route.POST(req(body)),data=await res.json();assert.equal(res.status,status,JSON.stringify(data));checks++;return data;}
async function list(){const r=await service.GET();assert.equal(r.status,200);checks++;return r.json();}
const getCase=async id=>(await list()).cases.find(s=>s.id===id);
await crm.GET();
const member=(id,role,supervisor='',region='eastern',branch='الرئيسي')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org',id,role,branch,supervisor||null,region,new Date().toISOString());
member('sm','manager');member('other-sm','manager');member('sup','supervisor','sm');member('rep','rep','sup');member('rep2','rep','sm');member('outside','rep','other-sm');member('west','rep','sm','western');member('csm','customer_service_manager','sm');member('cs','customer_service','csm');member('cs2','customer_service','csm');member('other-csm','customer_service_manager','other-sm');member('csw','customer_service','other-csm','western');member('unrouted','customer_service');
const now=new Date().toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function customer(id,region='الشرقية'){sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,\'customer\',NULL,\'outside\',\'الرئيسي\',?,?,?,1,\'fixture\')').run(id,JSON.stringify({name:id,phone:'0551111111',region,branch:'الرئيسي',assignedTo:'outside'}),now,now);}
customer('factory');customer('west-factory','الغربية');
sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(\'old-contact\',\'activity\',\'factory\',\'outside\',\'الرئيسي\',?,?,?,1,\'fixture\')').run(JSON.stringify({type:'visit',date:day,performedBy:'outside',summary:'private previous activity'}),now,now);
const raw=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id),row=id=>({...raw(id),data:JSON.parse(raw(id).data)});
const intake={source:'website',products:['قوالب البلوك المتحركة'],strength:'strong',needs:'احتياج لقوالب جديدة',nextAction:'تحديد المواصفات',nextDate:day};
const create=async(customerId='factory',status=200,extra={})=>post(service,{action:'create',requestId:crypto.randomUUID(),customerId,customerVersion:raw(customerId)?.version,data:intake,...extra},status);
const act=async(item,action,extra={},status=200)=>post(service,{action,requestId:crypto.randomUUID(),id:item.id,version:item.version,...extra},status);
user('cs');let projected=(await (await crm.GET()).json()).records;assert.deepEqual(projected.map(r=>r.id),['factory']);assert.equal(projected[0].data._readOnly,true);checks+=2;
await post(crm,{action:'save',kind:'customer',data:{name:'forged',branch:'الرئيسي',assignedTo:'cs'}},403);
assert.equal((await sales.GET(new Request('https://test.invalid/api/sales'))).status,403);checks++;
await create('west-factory',403);await create('factory',400,{data:{...intake,nextAction:''}});
const created=await create(),id=created.id;let item=await getCase(id);assert.equal(item.state,'pending_approval');assert.equal(item.assignedTo,null);assert.equal(item.serviceManagerId,'csm');checks+=3;
await create('factory',409);await act(item,'approve',{targetId:'sm'},403);await act(item,'assign',{targetId:'rep'},403);
user('cs2');assert.equal((await list()).cases.length,0);checks++;
user('other-csm');assert.equal((await list()).cases.length,0);checks++;
user('csm');item=await getCase(id);assert.deepEqual(item.candidates.map(m=>m.id),['sm']);checks++;await act(item,'approve',{targetId:'other-sm'},403);
await act(item,'return',{note:'استكمل المواصفات المطلوبة'});user('cs');item=await getCase(id);assert.equal(item.state,'returned');checks++;
await act(item,'edit',{data:intake});user('csm');item=await getCase(id);const approval={action:'approve',requestId:crypto.randomUUID(),id,version:item.version,targetId:'sm'};await post(service,approval);assert.equal((await post(service,approval)).alreadySaved,true);checks++;
await post(service,{...approval,requestId:crypto.randomUUID()},409);
user('sm');item=await getCase(id);assert.equal(item.state,'pending_assignment');checks++;await act(item,'assign',{targetId:'owner'},403);await act(item,'assign',{targetId:'west'},403);
// Target reassignment between read and transaction denies the whole dispatch.
race=()=>sql.prepare("UPDATE crm_members SET supervisor_id='other-sm' WHERE id='rep'").run();await act(item,'assign',{targetId:'rep'},409);assert.equal(raw('factory').assigned_to,'outside');checks++;sql.prepare("UPDATE crm_members SET supervisor_id='sup' WHERE id='rep'").run();
await act(item,'assign',{targetId:'sup'});assert.equal(raw('factory').assigned_to,'sup');assert.equal(raw('old-contact').assigned_to,'sup');assert.equal(row('old-contact').data.performedBy,'outside');checks+=3;
user('sup');item=await getCase(id);assert.equal(item.state,'with_supervisor');assert.deepEqual(item.candidates.map(m=>m.id),['rep']);checks+=2;await act(item,'delegate',{targetId:'rep2'},403);await act(item,'delegate',{targetId:'rep'});
assert.equal(raw('factory').assigned_to,'rep');assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM crm_records WHERE kind='activity'").get().n,1);checks+=2;
user('cs');item=await getCase(id);assert.equal(item.contacts.length,0);checks++;await act(item,'edit',{data:intake},403);await act(item,'assist',{note:'برجاء متابعة عرض السعر داخليًا'});item=await getCase(id);assert.equal(item.data.assistanceOpen,true);checks++;
for(const name of ['visits','customer-followups','followups'])await post(await api(name),{createKey:crypto.randomUUID(),customerId:'factory'},403);
// A true sales contact is recorded by its real actor and becomes part of the service case only.
user('rep');const v=await post(visits,{createKey:crypto.randomUUID(),customerId:'factory',customerVersion:raw('factory').version,timingMode:'automatic',elapsedMilliseconds:2000,data:{type:'visit',date:day,summary:'تعريف بمنتجات الشركة',result:'متابعة العميل',salesStage:'new',strength:'strong',requestedProducts:['قوالب البلوك المتحركة'],nextAction:'متابعة عرض السعر',nextDate:day,location:'26.437341, 50.034499',locationSource:'device',locationCapturedAt:new Date().toISOString(),locationAccuracy:12}});assert.equal(row(v.id).data.serviceCaseId,id);assert.equal(row(v.id).data.performedBy,'rep');checks+=2;
item=await getCase(id);await act(item,'reply',{note:'تم التواصل وتحديد الاحتياج'});assert.equal((await getCase(id)).data.assistanceOpen,false);checks++;
const closed=await post(followups,{createKey:crypto.randomUUID(),customerId:'factory',customerVersion:raw('factory').version,sourceId:v.id,sourceVersion:raw(v.id).version,data:{type:'call',date:day,result:'تم إتمام البيع مع العميل',salesStage:'won',invoiceOutcome:'pending'}});assert.equal(row(closed.id).data.serviceCaseId,id);checks++;
user('cs');item=await getCase(id);assert.equal(item.state,'won');assert.equal(item.contacts.length,2);assert.equal(item.contacts.some(r=>r.id==='old-contact'),false);checks+=3;
// Historic participants keep tracking, but the region remains a ceiling.
sql.prepare("UPDATE crm_members SET supervisor_id='other-csm' WHERE id='cs'").run();assert.equal((await getCase(id)).state,'won');checks++;sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='cs'").run();assert.equal((await list()).cases.length,0);checks++;sql.prepare("UPDATE crm_members SET region_scope='eastern',supervisor_id='csm' WHERE id='cs'").run();
const fresh=await create();assert.notEqual(fresh.id,id);checks++;
// Intake creates a new customer atomically; audit failure rolls both back.
user('cs');const nc={action:'create',requestId:crypto.randomUUID(),newCustomer:{name:'New factory',phone:'0500000000',region:'الشرقية'},data:{...intake,source:'social'}};auditFailure=true;await post(service,nc,500);auditFailure=false;assert.equal(raw('service-customer-'+nc.requestId),undefined);checks++;
const ncResult=await post(service,nc);assert.equal((await post(service,nc)).alreadySaved,true);assert.equal(row(ncResult.customerId).data._createdBy,'cs');checks+=2;
// Missing routing is visible to admin alone until it is configured.
user('unrouted');const ur=await post(service,{...nc,requestId:crypto.randomUUID(),newCustomer:{...nc.newCustomer,name:'Unrouted'}});user('csm');assert.equal((await list()).cases.some(s=>s.id===ur.id),false);checks++;user('owner');assert.equal((await getCase(ur.id)).permissions.approve,true);checks++;
// Administrators can delete historical contacts, without replacing the newer active case.
user('owner');await post(crm,{action:'delete',kind:'activity',id:closed.id,version:raw(closed.id).version});assert.equal(raw(closed.id),undefined);assert.equal((await getCase(fresh.id)).state,'pending_approval');checks+=2;
await post(visits,{id:v.id,version:raw(v.id).version,createKey:crypto.randomUUID(),customerId:'factory'},409);
// Same-region branch transfer still removes non-management participant access.
user('cs');sql.prepare("UPDATE crm_members SET branch='آخر' WHERE id='cs'").run();assert.equal((await list()).cases.length,0);checks++;sql.prepare("UPDATE crm_members SET branch='الرئيسي' WHERE id='cs'").run();
// Manager acquiring visibility via reporting line cannot keep it through a racing revocation.
member('new-csm','customer_service_manager','sm');sql.prepare("UPDATE crm_members SET supervisor_id='new-csm' WHERE id='cs'").run();user('new-csm');const dynamicCase=await getCase(fresh.id);assert.ok(dynamicCase);checks++;
race=()=>sql.prepare("UPDATE crm_members SET supervisor_id='csm' WHERE id='cs'").run();await act(dynamicCase,'note',{note:'Must not retain revoked visibility'},409);assert.equal((await list()).cases.some(s=>s.id===fresh.id),false);checks++;
// Region revocation at commit leaves the case unchanged.
user('cs');const regionalCase=await getCase(fresh.id);race=()=>sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='cs'").run();await act(regionalCase,'note',{note:'Must not save outside region'},409);sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='cs'").run();
// Direct file IDs do not expose unrelated customer files to service participants.
const files=await api('visit-files');globalThis.testEnv.FILES={get:async()=>({body:new Blob(['PDF']).stream()})};
sql.prepare('INSERT INTO crm_visit_files(id,object_key,customer_id,name,content_type,size,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run('f-related','a','factory','quote.pdf','application/pdf',3,'rep',now);
sql.prepare('INSERT INTO crm_visit_files(id,object_key,customer_id,name,content_type,size,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run('f-unrelated','b','factory','secret.pdf','application/pdf',3,'outside',now);
sql.prepare("UPDATE crm_records SET data=json_set(data,'$.competitorFileId','f-related') WHERE id=?").run(v.id);
assert.equal((await files.GET(new Request('https://test.invalid/api/visit-files?id=f-related'))).status,200);assert.equal((await files.GET(new Request('https://test.invalid/api/visit-files?id=f-unrelated'))).status,404);checks+=2;
user('owner');
// A concurrent deletion of the closing contact prevents creating a second active case.
user('owner');customer('race-factory');const rc=await create('race-factory');let rcItem=await getCase(rc.id);await act(rcItem,'approve',{targetId:'sm'});rcItem=await getCase(rc.id);await act(rcItem,'assign',{targetId:'rep'});
user('rep');await post(followups,{createKey:crypto.randomUUID(),customerId:'race-factory',customerVersion:raw('race-factory').version,data:{type:'call',date:day,result:'لا توجد زيارة سابقة',salesStage:'lost',invoiceOutcome:'pending',lossReason:'السعر أعلى من المنافس'}},400);
const raceVisit=await post(visits,{createKey:crypto.randomUUID(),customerId:'race-factory',customerVersion:raw('race-factory').version,timingMode:'automatic',elapsedMilliseconds:2000,data:{type:'call',date:day,summary:'تعريف بمنتجات الشركة',result:'متابعة العميل',salesStage:'new',strength:'strong',nextAction:'متابعة المواصفات',nextDate:day,location:'26.437341, 50.034499',locationSource:'device',locationCapturedAt:new Date().toISOString(),locationAccuracy:12}});
const closeRace=await post(followups,{createKey:crypto.randomUUID(),customerId:'race-factory',customerVersion:raw('race-factory').version,sourceId:raceVisit.id,sourceVersion:raw(raceVisit.id).version,data:{type:'call',date:day,result:'لم يتم الاتفاق مع العميل',salesStage:'lost',invoiceOutcome:'pending',lossReason:'السعر أعلى من المنافس'}});
user('cs');race=async()=>{const priorUser=globalThis.testUser;user('owner');await post(crm,{action:'delete',kind:'activity',id:closeRace.id,version:raw(closeRace.id).version});globalThis.testUser=priorUser;};await create('race-factory',409);user('owner');assert.equal((await getCase(rc.id)).state,'assigned');checks++;
user('owner');
// New service roles excluded from KPI participants and team targets.
const report=await (await sales.GET(new Request('https://test.invalid/api/sales?month='+day.slice(0,7)+'&kpis=1'))).json();assert.equal(report.members.some(m=>m.role.startsWith('customer_service')),false);assert.equal(report.targets.sets.some(s=>s.teamMemberIds?.some(id=>['cs','csm'].includes(id))),false);checks+=2;
await post(crm,{action:'member',data:{name:'UI CSR',email:'ui@yourrest.org',role:'customer_service',branch:'الرئيسي',regionScope:'eastern',supervisorId:'csm',active:1,target:0}});
await post(crm,{action:'member',data:{name:'Invalid CSR',email:'bad@yourrest.org',role:'customer_service',branch:'الرئيسي',regionScope:'eastern',supervisorId:'sup',active:1,target:0}},400);
assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length,0);checks++;
// Upload permission shares the narrow CSR customer scope, without widening attachment reads.
user('cs');globalThis.testEnv.FILES.put=async()=>{};globalThis.testEnv.FILES.delete=async()=>{};
const upload=async(customerId)=>{const form=new FormData();form.set('customerId',customerId);form.set('file',new File(['%PDF-1.4 test'],'test.pdf',{type:'application/pdf'}));return files.POST(new Request('https://test.invalid/api/visit-files',{method:'POST',headers:{origin:'https://test.invalid'},body:form}));};
const uploadResult=await upload('factory');assert.equal(uploadResult.status,200);const uploaded=await uploadResult.json();assert.equal(sql.prepare('SELECT uploaded_by FROM crm_visit_files WHERE id=?').get(uploaded.id).uploaded_by,'cs');assert.equal((await files.GET(new Request('https://test.invalid/api/visit-files?id='+uploaded.id))).status,200);assert.equal((await upload('west-factory')).status,403);checks+=4;
user('cs2');assert.equal((await files.GET(new Request('https://test.invalid/api/visit-files?id='+uploaded.id))).status,404);checks++;
// Unified registration: shared fields, repeat contacts, durable numbers, immutable actor/GPS, no sales writes.
user('cs');
const inline=await post(crm,{action:'save',kind:'customer',data:{name:'Inline unified',region:'الشرقية',assignedTo:'rep',branch:'forged'}});
assert.equal(raw(inline.id).assigned_to,'cs');assert.equal(raw(inline.id).branch,'الرئيسي');assert.equal(row(inline.id).data._createdBy,'cs');checks+=3;
await post(crm,{action:'save',kind:'customer',id:inline.id,version:1,data:row(inline.id).data},403);
await post(crm,{action:'delete',kind:'customer',id:inline.id,version:1},403);
await post(crm,{action:'save',kind:'factory',parentId:inline.id,data:{}},403);
await post(crm,{action:'save',kind:'customer',data:{name:'West forbidden',region:'الغربية',assignedTo:'cs',branch:'الرئيسي'}},403);
const registration={type:'call',summary:'تعريف بمنتجات الشركة',result:'متابعة العميل',salesStage:'won',strength:'strong',requestedProducts:['قوالب البلوك المتحركة','خدمات صيانة'],nextAction:'متابعة الاحتياج',nextDate:day,location:'26.437341, 50.034499',locationSource:'device',locationCapturedAt:new Date().toISOString(),locationAccuracy:12,performedBy:'rep',responsibleId:'rep',recordedByEmail:'rep@yourrest.org',customerNeeds:'طلب صيانة وقالب',hasCompetitor:true,competitorName:'Competitor',competitorNotes:'Quote pending'};
const registerBody=(customerId,extra={})=>({action:'create',requestId:crypto.randomUUID(),customerId,customerVersion:raw(customerId).version,registration:{...registration},elapsedMilliseconds:2200,...extra});
const contactCount=()=>sql.prepare("SELECT COUNT(*) AS n FROM crm_records WHERE kind='activity'").get().n;
const rawCount=contactCount(),numberCount=()=>sql.prepare('SELECT COUNT(*) AS n FROM crm_visit_numbers').get().n;
let payload=registerBody(inline.id);const unified=await post(service,payload);await post(service,payload);await post(service,{...payload,registration:{...registration,result:'changed'}},409);
let unifiedItem=await getCase(unified.id),saved=unifiedItem.data.registration;
assert.equal(saved.performedBy,'cs');assert.equal(saved.responsibleId,'cs');assert.equal(saved.recordedByEmail,'cs@yourrest.org');assert.equal(saved.salesStage,'new');assert.equal(saved.date,day);assert.equal(saved.durationSeconds,2);assert.ok(saved.visitNumber);assert.equal(contactCount(),rawCount);checks+=8;
const crmPayload=async()=> (await (await crm.GET()).json()).records;
projected=await crmPayload();let projection=projected.find(r=>r.id==='intake-'+unified.id);assert.equal(projection.data.visitNumber,saved.visitNumber);assert.equal(projection.data._readOnly,false);assert.equal(projection.data.visitWorkflow,'service-intake-v1');assert.ok(projected.every(r=>r.kind!=='activity'||r.data.date));assert.ok(!projected.some(r=>r.id==='west-factory'||r.id==='old-contact'));checks+=5;
await post(service,{action:'edit',requestId:crypto.randomUUID(),id:unified.id,version:unifiedItem.version,registration:{...saved,location:'25, 45'}},400);
await post(service,{action:'edit',requestId:crypto.randomUUID(),id:unified.id,version:unifiedItem.version,registration:{...saved,summary:'متابعة مواصفات القالب',startedAt:now,performedBy:'rep'} });
unifiedItem=await getCase(unified.id);assert.equal(unifiedItem.data.registration.startedAt,saved.startedAt);assert.equal(unifiedItem.data.registration.performedBy,'cs');assert.equal(unifiedItem.data.registration.visitNumber,saved.visitNumber);checks+=3;
const repeat=registerBody(inline.id,{registration:{...registration,type:'whatsapp'}});const again=await post(service,repeat);assert.equal(again.id,unified.id);await post(service,repeat);unifiedItem=await getCase(unified.id);assert.equal(unifiedItem.data.registrations.length,1);assert.notEqual(unifiedItem.data.registrations[0].registration.visitNumber,saved.visitNumber);assert.equal(contactCount(),rawCount);checks+=4;
assert.equal((await crmPayload()).filter(r=>r.data.serviceIntakeId===unified.id).length,2);checks++;
// A failed transaction cannot save a partial repeated contact or visit number.
let beforeNumbers=numberCount();payload=registerBody(inline.id);auditFailure=true;await post(service,payload,500);auditFailure=false;assert.equal(numberCount(),beforeNumbers);assert.equal((await getCase(unified.id)).data.registrations.length,1);checks+=2;
race=()=>sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='cs'").run();await post(service,payload,409);sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='cs'").run();assert.equal(numberCount(),beforeNumbers);checks++;
// Read projections confer no mutation access to sales activity.
const prior=raw(v.id);await post(visits,{id:v.id,createKey:crypto.randomUUID(),customerId:'factory',data:registration},403);await post(crm,{action:'delete',kind:'activity',id:v.id,version:prior.version},403);assert.deepEqual(raw(v.id),prior);checks++;
// Legacy intake conversion preserves missing historic GPS/time instead of inventing them.
let legacy=await getCase(fresh.id);await post(service,{action:'edit',requestId:crypto.randomUUID(),id:fresh.id,version:legacy.version,registration:{...registration,location:'',locationSource:undefined,locationCapturedAt:'',locationAccuracy:undefined}});legacy=await getCase(fresh.id);assert.equal(legacy.data.registration.startedAt,'');assert.equal(legacy.data.registration.location,'');assert.equal(legacy.data.registration.performedBy,'cs');checks+=3;
const {customerPlanSource}=await import(path.join(out,'lib/customer-visits.mjs'));
assert.equal(customerPlanSource('factory',await crmPayload()).id,v.id);assert.equal((await getCase(id)).state,'assigned');checks+=2;
// Attachments on both the first and a repeat registration are visible only to case participants.
for(const suffix of ['first','repeat'])sql.prepare('INSERT INTO crm_visit_files(id,object_key,customer_id,name,content_type,size,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run('f-'+suffix,suffix,inline.id,suffix+'.pdf','application/pdf',3,'cs',now);
let current=await getCase(unified.id);await post(service,{action:'edit',requestId:crypto.randomUUID(),id:unified.id,version:current.version,registration:{...current.data.registration,competitorFileId:'f-first'}});
await post(service,registerBody(inline.id,{registration:{...registration,competitorFileId:'f-repeat'}}));
user('csm');assert.equal((await files.GET(new Request('https://test.invalid/api/visit-files?id=f-first'))).status,200);assert.equal((await files.GET(new Request('https://test.invalid/api/visit-files?id=f-repeat'))).status,200);checks+=2;
current=await getCase(unified.id);await act(current,'approve',{targetId:'sm'});assert.equal((await crmPayload()).find(r=>r.id==='intake-'+unified.id).data._readOnly,true);checks++;
user('cs2');assert.ok((await crmPayload()).some(r=>r.id===inline.id));assert.ok(!(await crmPayload()).some(r=>r.data.serviceIntakeId===unified.id));assert.equal((await files.GET(new Request('https://test.invalid/api/visit-files?id=f-first'))).status,404);checks+=3;
user('cs');sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='cs'").run();assert.ok(!(await crmPayload()).some(r=>r.id===inline.id||r.data.serviceIntakeId===unified.id));checks++;sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='cs'").run();
user('owner');const afterReport=await (await sales.GET(new Request('https://test.invalid/api/sales?month='+day.slice(0,7)+'&kpis=1'))).json();assert.deepEqual(afterReport.kpis,report.kpis);checks++;
// Focused regressions from the full-application audit.
user('owner');
const genericBody={action:'save',kind:'customer',createKey:crypto.randomUUID(),data:{name:'Retry customer',region:'الشرقية',branch:'الرئيسي',assignedTo:'rep'}};
const generic=await post(crm,genericBody);assert.equal((await post(crm,genericBody)).alreadySaved,true);assert.equal(sql.prepare("SELECT count(*) n FROM crm_records WHERE json_extract(data,'$.name')='Retry customer'").get().n,1);checks+=2;
await post(crm,{...genericBody,data:{...genericBody.data,name:'Different draft'}},409);
const machineBody={action:'save',kind:'factory',createKey:crypto.randomUUID(),parentId:generic.id,data:{name:'Retry machine',machineBrand:'QA',machineModel:'M1',machineType:'mobile'}};
const machine=await post(crm,machineBody);assert.equal((await post(crm,machineBody)).id,machine.id);checks++;
const specification={action:'save',kind:'opportunity',createKey:crypto.randomUUID(),parentId:machine.id,data:{moldType:'QA mold',product:'Block',dimensions:'400 × 200 × 200',quantity:1,value:500,stage:'specs',nextAction:'Review drawing',nextDate:day,technicalStatus:'pending'}};
const mold=await post(crm,specification);assert.equal((await post(crm,specification)).id,mold.id);checks++;
const quoteBody={action:'save',kind:'quote',createKey:crypto.randomUUID(),parentId:mold.id,data:{date:day,validUntil:day,status:'draft',items:[{description:'QA mold',quantity:2,price:100}],discount:10,taxRate:15,terms:'QA'}};
await post(crm,quoteBody,400);
user('rep');await post(crm,{action:'save',kind:'opportunity',id:mold.id,version:raw(mold.id).version,data:{...row(mold.id).data,technicalStatus:'approved',technicalNotes:'Reviewed'}},403);
user('owner');await post(crm,{action:'save',kind:'opportunity',id:mold.id,version:raw(mold.id).version,data:{...row(mold.id).data,technicalStatus:'approved',technicalNotes:'Reviewed'}});
const quotation=await post(crm,quoteBody);assert.equal((await post(crm,quoteBody)).id,quotation.id);assert.equal(row(quotation.id).data.total,218.5);checks+=2;
await post(crm,{...quoteBody,createKey:crypto.randomUUID(),data:{...quoteBody.data,items:[{description:'a',quantity:.004,price:1},{description:'b',quantity:.004,price:1}],discount:.008}},400);
// Legacy direct-customer requests can attach only to a machine belonging to the same customer.
{
const legacy=await post(crm,{...specification,createKey:crypto.randomUUID(),parentId:generic.id});
const otherCustomer=await post(crm,{...genericBody,createKey:crypto.randomUUID(),data:{...genericBody.data,name:'Other customer'}}),otherMachine=await post(crm,{...machineBody,createKey:crypto.randomUUID(),parentId:otherCustomer.id});
const legacyEdit={action:'save',kind:'opportunity',id:legacy.id,version:raw(legacy.id).version,parentId:machine.id,data:row(legacy.id).data};
await post(crm,{...legacyEdit,parentId:otherMachine.id},400);
await post(crm,{...legacyEdit,data:{...legacyEdit.data,technicalStatus:'approved',technicalNotes:'Premature'}},400);
await post(crm,legacyEdit);assert.equal(raw(legacy.id).parent_id,machine.id);checks++;
await post(crm,{...legacyEdit,version:raw(legacy.id).version,data:{...row(legacy.id).data,technicalStatus:'approved',technicalNotes:'Reviewed after machine link'}});
const racingLegacy=await post(crm,{...specification,createKey:crypto.randomUUID(),parentId:generic.id});race=()=>sql.prepare('UPDATE crm_records SET version=version+1 WHERE id=?').run(machine.id);
await post(crm,{...legacyEdit,id:racingLegacy.id,version:1,data:row(racingLegacy.id).data},409);assert.equal(raw(racingLegacy.id).parent_id,generic.id);checks++;
}
// Frozen assignee role and branch prevent a stale assignment committing.
for(const [column,value] of [['role','customer_service'],['branch','آخر']]){race=()=>sql.prepare('UPDATE crm_members SET '+column+'=? WHERE id=?').run(value,'rep');await post(crm,{...genericBody,createKey:crypto.randomUUID(),data:{...genericBody.data,name:'racing '+column}},409);sql.prepare("UPDATE crm_members SET role='rep',branch='الرئيسي' WHERE id='rep'").run();}
// The response-loss retry is also safe for inline CSR-created customers.
user('cs');const csrBody={...genericBody,createKey:crypto.randomUUID(),data:{...genericBody.data,name:'CSR retry'}};const csrCreated=await post(crm,csrBody);assert.equal((await post(crm,csrBody)).id,csrCreated.id);checks++;
// Authentication and cross-origin checks exercise every current application entry point.
const endpointNames=['crm','customer-service','visits','customer-followups','followups','sales','targets','kpis'];
for(const name of endpointNames){globalThis.testUser=null;await post(await api(name),{action:'create',requestId:crypto.randomUUID(),createKey:crypto.randomUUID(),customerId:'factory'},401);}
for(const name of ['crm','customer-service','sales']){const route=await api(name);assert.equal((await route.GET(new Request('https://test.invalid/api/'+name))).status,401);checks++;}
assert.equal((await files.GET(new Request('https://test.invalid/api/visit-files?id=f-related'))).status,401);checks++;
user('not-on-team');assert.equal((await crm.GET()).status,403);checks++;user('cs');sql.prepare("UPDATE crm_members SET active=0 WHERE id='cs'").run();assert.equal((await crm.GET()).status,403);checks++;sql.prepare("UPDATE crm_members SET active=1 WHERE id='cs'").run();
user('owner');for(const name of endpointNames){const response=await (await api(name)).POST(new Request('https://test.invalid/api/'+name,{method:'POST',headers:{origin:'https://evil.invalid','content-type':'application/json'},body:'{}'}));assert.equal(response.status,403);checks++;}
// Quote cycles and filters use actual domain helpers, with separate historical fixtures.
const {customerHasQuotation}=await import(path.join(out,'lib/customer-followups.mjs'));
const domainCustomer={id:'cycle-c',kind:'customer',data:{name:'Cycle factory'},createdAt:'2026-09-01T06:00:00Z',updatedAt:'2026-09-01T06:00:00Z'};
const contact=(id,n,data={})=>({id,kind:'activity',parentId:'cycle-c',createdAt:`2026-09-${String(n).padStart(2,'0')}T06:00:00Z`,updatedAt:`2026-09-${String(n).padStart(2,'0')}T06:00:00Z`,data:{date:`2026-09-${String(n).padStart(2,'0')}`,type:'call',salesStage:'new',...data}});
const oldQuoted=contact('quoted',1,{salesStage:'quoted',hasQuotation:true}),oldClosed=contact('closed',2,{salesStage:'won',hasQuotation:true,invoiceOutcome:'invoiced'}),newCycle=contact('new-cycle',3,{salesStage:'specs'});
const oldQuote={id:'old-quote',kind:'quote',parentId:'old-request',data:{status:'accepted'},createdAt:oldQuoted.createdAt,updatedAt:'2026-09-20T06:00:00Z'};
const oldRequest={id:'old-request',kind:'opportunity',parentId:'cycle-c',data:{hasRequest:true,stage:'won'},createdAt:oldQuoted.createdAt,updatedAt:oldClosed.createdAt};
const cycles=[domainCustomer,oldQuoted,oldClosed,newCycle,oldRequest,oldQuote];assert.equal(customerHasQuotation('cycle-c',cycles),false);assert.equal(customerHasQuotation('cycle-c',[...cycles,contact('current-quote',4,{type:'quote'})]),true);checks+=2;
const newRequest={...oldRequest,id:'new-request',createdAt:newCycle.createdAt,updatedAt:newCycle.createdAt,data:{hasRequest:true,stage:'specs'}},linked=contact('linked',4,{requestId:newRequest.id});
assert.equal(customerHasQuotation('cycle-c',[...cycles,newRequest,linked]),false);const newQuote={...oldQuote,id:'new-quote',parentId:newRequest.id,createdAt:newCycle.createdAt};assert.equal(customerHasQuotation('cycle-c',[...cycles,newRequest,linked,newQuote]),true);checks+=2;
assert.equal(customerHasQuotation('cycle-c',cycles.filter(r=>r.id!==newCycle.id)),true);assert.equal(customerHasQuotation('cycle-c',[...cycles,contact('direct-close',4,{salesStage:'won',invoiceOutcome:'pending'})]),false);checks+=2;
assert.equal(customerHasQuotation('cycle-c',[...cycles,contact('csr-intake',5,{visitWorkflow:'service-intake-v1',salesStage:'quoted'})]),false);assert.equal(customerHasQuotation('cycle-c',cycles.filter(r=>r.id!==newCycle.id),{id:'new-service',createdAt:'2026-09-03T06:00:00Z'}),false);checks+=2;
const assignedCycle={id:'new-service',createdAt:'2026-09-03T06:00:00Z'},oldLinked=contact('old-linked',4,{requestId:oldRequest.id});
assert.equal(customerHasQuotation('cycle-c',[...cycles,oldLinked],assignedCycle),false);assert.equal(customerHasQuotation('cycle-c',[...cycles,oldLinked,contact('current-linked-quote',5,{requestId:oldRequest.id,type:'quote'})],assignedCycle),true);checks+=2;
const backfilledClose={...oldClosed,createdAt:'2026-09-20T06:00:00Z',data:{...oldClosed.data,visitWorkflow:'followup-v1'}},afterBackfillQuote={...oldQuote,createdAt:'2026-09-03T06:00:00Z',data:{status:'draft',date:'2026-09-03'}};
assert.equal(customerHasQuotation('cycle-c',[domainCustomer,oldQuoted,backfilledClose,newCycle,oldRequest,afterBackfillQuote]),true);
const sameDayClose={...oldClosed,createdAt:'2026-09-03T05:00:00Z',data:{...oldClosed.data,date:'2026-09-03',visitWorkflow:'followup-v1'}},laterContact=contact('later',4);
assert.equal(customerHasQuotation('cycle-c',[domainCustomer,oldQuoted,sameDayClose,laterContact,oldRequest,afterBackfillQuote]),true);assert.equal(customerHasQuotation('cycle-c',[domainCustomer,oldQuoted,sameDayClose,laterContact,oldRequest,{...afterBackfillQuote,createdAt:'2026-09-03T04:00:00Z'}]),false);checks+=3;
compile('lib/visit-list.ts');const {filterVisitRows}=await import(path.join(out,'lib/visit-list.mjs'));const searchable=[domainCustomer,contact('one',3,{customerNeeds:'needle needs',performedBy:'rep',salesStage:'specs'}),contact('two',4,{competitorName:'needle competitor',performedBy:'rep',salesStage:'specs'}),contact('three',5,{requestedProducts:['needle product'],performedBy:'other',salesStage:'new'})];
assert.deepEqual(filterVisitRows(searchable,{query:'needle'}).map(r=>r.id),['three','two','one']);assert.deepEqual(filterVisitRows(searchable,{query:'needle',staff:'rep',stage:'specs'}).map(r=>r.id),['two','one']);checks+=2;
await post(crm,{action:'member',data:{name:'Outside email',email:'person@example.com',role:'rep',branch:'الرئيسي',active:1,target:0}},400);
// Malformed input must be a validation error, not an internal crash.
await post(crm,{action:'member',data:{name:'Invalid email',email:'bad'}},400);
for(const name of endpointNames)for(const body of ['{','null','[]']){const malformed=await (await api(name)).POST(new Request('https://test.invalid/api/'+name,{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body}));assert.equal(malformed.status,400,name+body);checks++;}
console.log(JSON.stringify({fullQA:'passed',checks,features:'auth, all roles, customer CRUD, quotes, sales cycles, data retries, assignment races, visit filters, service workflow, attachments, KPIs, region boundaries'}));
