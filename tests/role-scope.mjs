import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
// Isolated handler integration checks: real SQL migrations and domain code; mocked identity and R2.
// No network requests or production writes. Run from the repository root.
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'role-scope-')),seen=new Set();
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
member('sm','manager');member('other-sm','manager');member('sup','supervisor','sm');member('other-sup','supervisor','other-sm');
member('rep','rep','sup');member('peer','rep','sup');member('outside','rep','other-sup');member('inactive','rep','sup');member('west','rep','sup','western');
member('csm','customer_service_manager','sm');member('cs','customer_service','csm');
sql.prepare("UPDATE crm_members SET active=0,region_scope='all' WHERE id='inactive'").run();
const now=new Date().toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),month=day.slice(0,7);
const raw=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id),row=id=>({...raw(id),data:JSON.parse(raw(id).data)});
function record(id,kind,parentId,author,data={},assignedTo='outside'){
 sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,1,?)')
  .run(id,kind,parentId,assignedTo,'الرئيسي',JSON.stringify({...author?{performedBy:author,recordedByEmail:author+'@yourrest.org'}:{},...data}),now,now,'fixture');
}
record('factory','customer',null,null,{name:'Shared factory',phone:'0551111111',region:'الشرقية',branch:'الرئيسي',assignedTo:'outside',_visitPlan:{visitId:'contact-outside',nextDate:day,nextAction:'foreign-private-plan'},_stageVisitId:'contact-outside'});
record('west-factory','customer',null,null,{name:'Western factory',region:'الغربية',branch:'الرئيسي',assignedTo:'west'},'west');
record('machine','factory','factory',null,{name:'Shared machine',machineBrand:'QA',machineType:'mobile'});
const baseContact={type:'call',date:day,summary:'متابعة مواصفات القالب',result:'متابعة العميل',salesStage:'new',strength:'strong',nextAction:'متابعة المواصفات',nextDate:day,requestedProducts:['قوالب البلوك المتحركة'],location:'26.437341, 50.034499',locationSource:'device',locationCapturedAt:now,locationAccuracy:12,visitWorkflow:'customer-v1'};
for(const id of ['owner','sm','other-sm','sup','other-sup','rep','peer','outside','inactive','cs'])record('contact-'+id,'activity','factory',id,{...baseContact,summary:'private-'+id});
record('contact-west','activity','west-factory','rep',baseContact,'rep');
record('foreign-request','opportunity','machine','outside',{moldType:'private foreign specifications',stage:'specs',hasRequest:true,nextAction:'private request plan',nextDate:day});
record('nested-own','activity','foreign-request','rep',{...baseContact,requestId:'foreign-request',requestSnapshot:{moldType:'private foreign snapshot'}});
record('legacy-email-foreign','activity','factory',null,{...baseContact,recordedByEmail:'outside@yourrest.org',responsibleId:'rep'},'rep');
record('unknown-email-foreign','activity','factory',null,{...baseContact,recordedByEmail:'deleted-person@yourrest.org',responsibleId:'rep'},'rep');
record('quote-foreign','quote','foreign-request','outside',{status:'draft',items:[]});
record('anonymous-activity','activity','factory',null,{...baseContact,summary:'private-anonymous-activity'},'rep');
record('anonymous-opportunity','opportunity','machine',null,{hasRequest:true,moldType:'private-anonymous-opportunity',stage:'specs',nextAction:'Follow up',nextDate:day},'rep');
record('anonymous-quote','quote','anonymous-opportunity',null,{status:'draft',items:[]},'rep');
for(const id of ['contact-rep','contact-outside','factory'])sql.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)').run('audit-'+id,id,'outside','fixture','audit-private-'+id,now);
sql.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)').run('own-sales-audit','factory','rep','تسجيل بيع','private-sales-total-999',now);
const read=async()=>{const response=await crm.GET();assert.equal(response.status,200);checks++;return response.json();};
const activities=payload=>payload.records.filter(r=>r.kind==='activity').map(r=>r.id).sort();
const expectIds=(payload,ids)=>{assert.deepEqual(activities(payload),ids.sort());checks++;};
user('rep');let payload=await read();expectIds(payload,['contact-rep','nested-own']);
assert.ok(payload.records.some(r=>r.id==='factory'));assert.ok(payload.records.some(r=>r.id==='machine'));assert.ok(!payload.records.some(r=>r.id==='west-factory'||r.kind==='quote'||r.id==='foreign-request'));assert.ok(!payload.records.some(r=>r.id.startsWith('anonymous-')));checks+=4;
const projectedFactory=payload.records.find(r=>r.id==='factory');assert.equal(projectedFactory.data._masterReadOnly,undefined);assert.equal(projectedFactory.data._visitPlan,undefined);assert.equal(projectedFactory.data._stageVisitId,undefined);checks+=3;
const nested=payload.records.find(r=>r.id==='nested-own');assert.equal(nested.parentId,'factory');assert.ok(!nested.data.requestId);assert.equal(nested.data.requestSnapshot,undefined);checks+=3;
assert.ok(!payload.audits.some(a=>a.recordId==='contact-outside'));assert.ok(!JSON.stringify(payload).includes('foreign-private-plan'));assert.ok(!JSON.stringify(payload).includes('private-sales-total-999'));checks+=3;
// Customer assignment is an address-book detail, never ownership of prior visits.
sql.prepare("UPDATE crm_records SET assigned_to='rep',data=json_set(data,'$.assignedTo','rep'),version=version+1 WHERE id='factory'").run();
expectIds(await read(),['contact-rep','nested-own']);
sql.prepare("UPDATE crm_records SET assigned_to='outside',data=json_set(data,'$.assignedTo','outside'),version=version+1 WHERE id='factory'").run();
user('sup');payload=await read();expectIds(payload,['contact-sup','contact-rep','contact-peer','contact-inactive','nested-own']);
const regionalHistoryAuthor=payload.members.find(m=>m.id==='inactive');assert.ok(regionalHistoryAuthor);assert.equal(regionalHistoryAuthor.readOnly,true);assert.equal(regionalHistoryAuthor.target,undefined);checks+=3;
user('sm');payload=await read();expectIds(payload,['contact-sm','contact-sup','contact-other-sup','contact-rep','contact-peer','contact-outside','contact-inactive','nested-own','legacy-email-foreign']);
assert.ok(!JSON.stringify(payload.records).includes('private-other-sm'));assert.ok(!JSON.stringify(payload.records).includes('private-owner'));assert.ok(!payload.records.some(r=>r.id==='west-factory'));checks+=3;
user('owner');payload=await read();assert.ok(payload.records.some(r=>r.id==='contact-west'));assert.equal(payload.records.filter(r=>r.id.startsWith('anonymous-')).length,3);checks+=2;
// Reassigning customer ownership cannot invent a recorder for anonymous imported history.
await post(crm,{action:'save',kind:'customer',id:'factory',version:raw('factory').version,data:{...row('factory').data,assignedTo:'rep'}});
for(const id of ['anonymous-activity','anonymous-opportunity','anonymous-quote']){const d=row(id).data;assert.ok(!d.performedBy&&!d.recordedByEmail&&!d.responsibleId);checks++;}
user('rep');assert.ok(!(await read()).records.some(r=>r.id.startsWith('anonymous-')));checks++;
user('owner');await post(crm,{action:'save',kind:'customer',id:'factory',version:raw('factory').version,data:{...row('factory').data,assignedTo:'outside'}});
// Rep management endpoints are forbidden even when called directly without the UI.
user('rep');assert.equal((await sales.GET(new Request('https://test.invalid/api/sales?month='+month+'&kpis=1'))).status,403);checks++;
for(const name of ['sales','targets','kpis'])await post(await api(name),{},403);
// Only a standalone, new customer is creatable by reps; forged parent links remain forbidden.
for(const kind of ['customer','factory','opportunity','quote']){
 await post(crm,{action:'save',kind,createKey:crypto.randomUUID(),parentId:kind==='factory'?'factory':kind==='quote'?'foreign-request':'machine',data:{name:'forged'}},403);
}
await post(crm,{action:'save',kind:'customer',id:'factory',version:raw('factory').version,data:row('factory').data},200);
await post(crm,{action:'delete',kind:'factory',id:'machine',version:raw('machine').version},403);
await post(crm,{action:'delete',kind:'activity',id:'contact-outside',version:raw('contact-outside').version},404);
// Shared regional customers remain available for visits, even assigned to another team.
const visitBody=(customerId='factory',extra={})=>({createKey:crypto.randomUUID(),customerId,customerVersion:raw(customerId).version,timingMode:'automatic',elapsedMilliseconds:2300,data:{...baseContact,performedBy:'outside',responsibleId:'outside',recordedByEmail:'outside@yourrest.org'},...extra});
let body=visitBody();const created=await post(visits,body);assert.equal(row(created.id).data.performedBy,'rep');assert.equal(row(created.id).data.responsibleId,'rep');assert.equal(row(created.id).data.recordedByEmail,'rep@yourrest.org');checks+=3;
assert.equal((await post(visits,body)).alreadySaved,true);checks++;
await post(visits,visitBody('west-factory'),403);
await post(visits,visitBody('factory',{id:'contact-outside',version:raw('contact-outside').version}),404);
body=visitBody('factory',{id:created.id,version:raw(created.id).version,data:{...row(created.id).data,summary:'تعديل الزيارة',performedBy:'outside',responsibleId:'outside',recordedByEmail:'outside@yourrest.org'}});await post(visits,body,403);user('sup');await post(visits,body);user('rep');
assert.equal(row(created.id).data.performedBy,'rep');assert.equal(row(created.id).data.recordedByEmail,'rep@yourrest.org');checks+=2;
// Reps cannot edit history; an authorized supervisor still preserves a hidden foreign request.
const foreignBefore=raw('foreign-request'),nestedBefore=raw('nested-own');
payload=await read();const nestedEdit=payload.records.find(r=>r.id==='nested-own');
const nestedBody=visitBody('factory',{id:nestedEdit.id,version:nestedEdit.version,data:{...nestedEdit.data,summary:'تحديث زيارتي القديمة'}});await post(visits,nestedBody,403);user('sup');await post(visits,nestedBody);user('rep');
assert.equal(row('nested-own').data.summary,'تحديث زيارتي القديمة');assert.equal(raw('nested-own').parent_id,nestedBefore.parent_id);assert.equal(row('nested-own').data.requestId,'foreign-request');assert.equal(row('nested-own').data.performedBy,'rep');assert.deepEqual(raw('foreign-request'),foreignBefore);checks+=5;
payload=await read();assert.equal(payload.records.find(r=>r.id==='nested-own').parentId,'factory');assert.ok(!JSON.stringify(payload.records).includes('private foreign snapshot'));checks+=2;
// A private request linked only through data.requestId survives a public customer-level edit.
const privateSnapshot={moldType:'private foreign snapshot'};
record('private-linked-own','activity','factory','rep',{...baseContact,requestId:'foreign-request',requestSnapshot:privateSnapshot});
payload=await read();const privateLinked=payload.records.find(r=>r.id==='private-linked-own');assert.ok(!privateLinked.data.requestId);assert.equal(privateLinked.data.requestSnapshot,undefined);checks+=2;
const linkedBody=visitBody('factory',{id:privateLinked.id,version:privateLinked.version,data:{...privateLinked.data,summary:'Edit my private-linked visit'}});await post(visits,linkedBody,403);user('sup');const linkedSaved=await post(visits,linkedBody);user('rep');
assert.equal(linkedSaved.requestId,'');assert.equal(row(privateLinked.id).data.requestId,'foreign-request');assert.deepEqual(row(privateLinked.id).data.requestSnapshot,privateSnapshot);assert.deepEqual(raw('foreign-request'),foreignBefore);checks+=4;
// Legacy generic rep history also denies edits; supervisors cannot synchronize an invisible parent's plan.
record('legacy-own-edit','activity','foreign-request','rep',{type:'call',date:day,summary:'Legacy own visit',result:'متابعة العميل',nextAction:'متابعة خاصة',nextDate:day,location:''});
payload=await read();const legacyEdit=payload.records.find(r=>r.id==='legacy-own-edit'),legacyRequestBefore=raw('foreign-request');
const legacyBody={action:'save',kind:'activity',id:legacyEdit.id,version:legacyEdit.version,parentId:legacyEdit.parentId,syncFollowup:true,data:{...legacyEdit.data,summary:'Legacy own visit updated',nextAction:'must not overwrite foreign request'}};await post(crm,legacyBody,403);user('sup');await post(crm,legacyBody);user('rep');
assert.equal(raw('legacy-own-edit').parent_id,'foreign-request');assert.equal(row('legacy-own-edit').data.summary,'Legacy own visit updated');assert.deepEqual(raw('foreign-request'),legacyRequestBefore);checks+=3;
// A supervisor's own quotation remains editable when its historic request belongs to an administrator.
record('admin-request','opportunity','machine','owner',{hasRequest:true,moldType:'Administrative request',stage:'specs',technicalStatus:'approved',nextAction:'Administrative followup',nextDate:day});
record('supervisor-quote','quote','admin-request','sup',{number:'QA-SUP',date:day,validUntil:day,status:'draft',items:[{description:'QA mold',quantity:1,price:100}],discount:0,taxRate:15,terms:''});
user('sup');payload=await read();const ownQuote=payload.records.find(r=>r.id==='supervisor-quote'),adminRequestBefore=raw('admin-request');assert.equal(ownQuote.parentId,'factory');checks++;
await post(crm,{action:'save',kind:'quote',id:ownQuote.id,version:ownQuote.version,parentId:ownQuote.parentId,data:{...ownQuote.data,terms:'Updated own quotation'}});
assert.equal(raw('supervisor-quote').parent_id,'admin-request');assert.equal(row('supervisor-quote').data.terms,'Updated own quotation');assert.equal(row('supervisor-quote').data.performedBy,'sup');assert.deepEqual(raw('admin-request'),adminRequestBefore);checks+=4;
user('rep');
const followupBody=(sourceId,extra={})=>({createKey:crypto.randomUUID(),customerId:'factory',customerVersion:raw('factory').version,sourceId,sourceVersion:sourceId?raw(sourceId).version:undefined,data:{type:'call',date:day,result:'تمت متابعة الاحتياج',salesStage:'specs',invoiceOutcome:'pending',nextAction:'تحديد المواصفات',nextDate:day,performedBy:'outside',recordedByEmail:'outside@yourrest.org'},...extra});
await post(followups,followupBody('contact-outside'),403);
body=followupBody(created.id);const followed=await post(followups,body);assert.equal(row(followed.id).data.performedBy,'rep');assert.equal(row(followed.id).data.recordedByEmail,'rep@yourrest.org');checks+=2;
user('peer');await post(followups,body,404);
// Guessing a file id or rebinding it to a new visit cannot cross author/team boundaries.
const files=await api('visit-files');globalThis.testEnv.FILES={get:async()=>({body:new Blob(['PDF']).stream()}),put:async()=>{},delete:async()=>{}};
for(const id of ['rep','peer','outside'])sql.prepare('INSERT INTO crm_visit_files(id,object_key,customer_id,name,content_type,size,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run('file-'+id,id,'factory',id+'.pdf','application/pdf',3,id,now);
user('rep');assert.equal((await files.GET(new Request('https://test.invalid/api/visit-files?id=file-rep'))).status,200);assert.equal((await files.GET(new Request('https://test.invalid/api/visit-files?id=file-peer'))).status,404);assert.equal((await files.GET(new Request('https://test.invalid/api/visit-files?id=file-outside'))).status,404);checks+=3;
await post(visits,visitBody('factory',{data:{...baseContact,hasCompetitor:true,competitorName:'Competitor',competitorFileId:'file-outside'}}),403);
user('sup');assert.equal((await files.GET(new Request('https://test.invalid/api/visit-files?id=file-rep'))).status,200);assert.equal((await files.GET(new Request('https://test.invalid/api/visit-files?id=file-outside'))).status,404);checks+=2;
// Team changes take effect on the next request and are rechecked inside writes.
body=visitBody('factory',{id:created.id,version:raw(created.id).version,data:{...row(created.id).data,summary:'must not commit after transfer'}});const before=raw(created.id);
race=()=>sql.prepare("UPDATE crm_members SET supervisor_id='other-sup' WHERE id='rep'").run();await post(visits,body,409);assert.deepEqual(raw(created.id),before);checks++;
payload=await read();assert.ok(!payload.records.some(r=>r.id===created.id||r.id==='contact-rep'));checks++;
user('other-sup');assert.ok((await read()).records.some(r=>r.id===created.id));checks++;
sql.prepare("UPDATE crm_members SET supervisor_id='sup' WHERE id='rep'").run();
user('rep');body=visitBody();race=()=>sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='rep'").run();await post(visits,body,409);assert.equal(raw('customer-visit-'+body.createKey),undefined);checks++;
sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='rep'").run();
// Reports retain own/team inactive history and exclude unrelated administrator/manager data.
const {salesProducts}=await import(path.join(out,'lib/sales.mjs'));
for(const id of ['owner','sm','other-sm','sup','other-sup','rep','peer','outside','inactive']){
 const data={customerId:'factory',repId:id,date:day,reference:'INV-'+id,items:[{product:salesProducts[0],description:'QA',quantity:1,unitPrice:100}],discount:0,notes:''};
 sql.prepare("INSERT INTO crm_sales(id,customer_id,rep_id,branch,date,reference,reference_key,data,total_cents,status,void_reason,version,mutation_id,create_fingerprint,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'confirmed','',1,?,?,?,?,?)").run('sale-'+id,'factory',id,'الرئيسي',day,data.reference,data.reference,JSON.stringify(data),10000,'fixture','fixture',id,now,now);
 for(const kind of ['sales','activity'])sql.prepare('INSERT INTO crm_target_sets(kind,scope_id,month,data,version,mutation_id,updated_by,updated_at) VALUES(?,?,?,?,1,?,?,?)').run(kind,id,month,JSON.stringify(kind==='sales'?{products:salesProducts.map(product=>({product,quantity:10}))}:{newCustomers:10,recoveredCustomers:5,visits:20}),'fixture','owner',now);
}
const readReport=async()=>{const response=await sales.GET(new Request('https://test.invalid/api/sales?month='+month+'&kpis=1'));assert.equal(response.status,200);checks++;return response.json();};
user('sup');let report=await readReport();assert.deepEqual(report.sales.map(s=>s.repId).sort(),['inactive','peer','rep','sup']);assert.ok(!report.targets.sets.some(s=>['owner','other-sm','outside','other-sup'].includes(s.scopeId)));assert.ok(!report.kpis.people.some(p=>['owner','other-sm','outside','other-sup'].includes(p.memberId||p.member?.id)));checks+=3;
user('sm');report=await readReport();assert.deepEqual(report.sales.map(s=>s.repId).sort(),['inactive','other-sup','outside','peer','rep','sm','sup']);assert.ok(!report.targets.sets.some(s=>['owner','other-sm'].includes(s.scopeId)));assert.ok(!report.members.some(m=>['owner','other-sm','cs','csm'].includes(m.id)));checks+=3;
const allowedSources=new Set(['sm','sup','other-sup','rep','peer','outside','inactive']);for(const p of report.performance){assert.ok((p.sourceMemberIds||[]).every(id=>allowedSources.has(id)));assert.ok((p.salesSourceMemberIds||[]).every(id=>allowedSources.has(id)));checks+=2;}
// Management saves cannot target unrelated administrators or other managers.
const {emptyKpiInput}=await import(path.join(out,'lib/kpis.mjs'));
for(const scopeId of ['owner','other-sm']){
 await post(await api('targets'),{kind:'activity',scopeId,month,version:1,inheritedFrom:null,requestId:crypto.randomUUID(),data:{newCustomers:10,recoveredCustomers:5,visits:20}},403);
 await post(await api('kpis'),{memberId:scopeId,month,version:0,requestId:crypto.randomUUID(),input:emptyKpiInput()},404);
}
// A service handoff provides the brief, without exposing another recorder's visits or notes.
const serviceData={source:'call',products:[salesProducts[0]],strength:'strong',needs:'authorized-assignment-brief',nextAction:'متابعة المواصفات',nextDate:day,participants:['cs','csm','sm','sup','rep','outside'],registration:{...baseContact,performedBy:'cs',recordedByEmail:'cs@yourrest.org',summary:'private-service-registration',competitorFileName:'private-service-filename.pdf'}};
sql.prepare("INSERT INTO crm_service_cases(id,customer_id,status,creator_id,service_manager_id,sales_manager_id,assigned_to,supervisor_id,data,created_at,updated_at,version,mutation_id) VALUES('service-fixture','factory','assigned','cs','csm','sm','rep','sup',?,?,?,1,'fixture')").run(JSON.stringify(serviceData),now,now);
for(const id of ['rep','outside']){
 sql.prepare("UPDATE crm_records SET data=json_set(data,'$.serviceCaseId','service-fixture') WHERE id=?").run('contact-'+id);
 sql.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)').run('service-note-'+id,'service-fixture',id,'service:note',JSON.stringify({note:'private-service-note-'+id}),now);
}
user('rep');payload=await read();assert.ok(!payload.records.some(r=>r.id==='intake-service-fixture'));assert.ok(!JSON.stringify(payload.records).includes('private-service-registration'));checks+=2;
let servicePayload=await list(),serviceCase=servicePayload.cases.find(s=>s.id==='service-fixture');assert.ok(serviceCase);assert.deepEqual(serviceCase.contacts.map(r=>r.id),['contact-rep']);assert.equal(serviceCase.data.registration,undefined);assert.ok(!JSON.stringify(serviceCase).includes('private-service-note-outside'));assert.ok(!JSON.stringify(serviceCase).includes('private-service-filename'));checks+=5;
user('sup');servicePayload=await list();serviceCase=servicePayload.cases.find(s=>s.id==='service-fixture');assert.deepEqual(serviceCase.contacts.map(r=>r.id),['contact-rep']);assert.ok(!JSON.stringify(serviceCase).includes('private-service-note-outside'));checks+=2;
// Losing a direct report between reading an assigned service case and saving a note revokes the write.
const caseBefore=sql.prepare("SELECT * FROM crm_service_cases WHERE id='service-fixture'").get();
const auditBefore=sql.prepare("SELECT COUNT(*) AS n FROM crm_audit WHERE record_id='service-fixture'").get().n;
race=()=>sql.prepare("UPDATE crm_members SET supervisor_id='other-sup' WHERE id='rep'").run();
await post(service,{action:'note',requestId:crypto.randomUUID(),id:'service-fixture',version:serviceCase.version,note:'must not save after assignee transfer'},409);
assert.deepEqual(sql.prepare("SELECT * FROM crm_service_cases WHERE id='service-fixture'").get(),caseBefore);assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM crm_audit WHERE record_id='service-fixture'").get().n,auditBefore);checks+=2;
assert.ok(!(await list()).cases.some(s=>s.id==='service-fixture'));checks++;
sql.prepare("UPDATE crm_members SET supervisor_id='sup' WHERE id='rep'").run();
user('cs');servicePayload=await list();serviceCase=servicePayload.cases.find(s=>s.id==='service-fixture');assert.ok(serviceCase.data.registration);assert.ok(serviceCase.contacts.some(r=>r.id==='contact-outside'));checks+=2;
assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length,0);checks++;
console.log(JSON.stringify({roleScopeQA:'passed',checks,features:'immutable recorder, regional directory, own/direct-team/all-sales scopes, reports, regional customer editing with protected visit history, forbidden management routes, attachments, customer reassignment, live team revocation and concurrent guards'}));
