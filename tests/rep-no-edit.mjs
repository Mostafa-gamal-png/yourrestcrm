import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
// Authenticated route integration on an isolated real SQLite database; no production/network writes.
// Permission checks are independent of the time this suite is launched. Keep
// only this fixture's advancing clock within Saudi route collection hours.
const RealDate=Date,clockOffset=RealDate.parse('2026-10-05T09:00:00.000Z')-RealDate.now();
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[RealDate.now()+clockOffset]));}static now(){return RealDate.now()+clockOffset;}};
process.on('exit',()=>{globalThis.Date=RealDate;});
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'rep-no-edit-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=? OR email=?').bind(u.userId,u.email).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
for(const name of ['crm','visits','followups','customer-followups','journeys'])compile('app/api/'+name+'/route.ts');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+f,'utf8'));
let race=null;
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{if(race){const fn=race;race=null;await fn();}sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const now=new Date().toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const member=(id,role,region='eastern',branch='الرئيسي')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org',id,role,branch,region,now);
member('owner','admin','all');member('rep','rep');member('peer','rep');member('west','rep','western');member('all-rep','rep','all');member('unassigned-rep','rep','unassigned');member('cs','customer_service');member('manager','manager');member('supervisor','supervisor');
sql.prepare("UPDATE crm_members SET supervisor_id='supervisor' WHERE id='rep'").run();
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const user=id=>{globalThis.testUser=id?{userId:'u-'+id,email:id+'@yourrest.org',fullName:id}:null;};
const crm=await import(path.join(out,'app/api/crm/route.mjs')),visits=await import(path.join(out,'app/api/visits/route.mjs'));
const raw=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id),row=id=>({...raw(id),data:JSON.parse(raw(id).data)});
const count=()=>sql.prepare("SELECT COUNT(*) n FROM crm_records WHERE kind='customer'").get().n;
let checks=0;
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const request=(body,origin='https://test.invalid')=>new Request('https://test.invalid/api/crm',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
const post=async(body,status=200,route=crm,origin)=>{const res=await route.POST(request(body,origin)),data=await res.json();check(res.status,status,JSON.stringify(data));return data;};
const read=async()=>{const res=await crm.GET();check(res.status,200);return res.json();};

const customerFollowups=await import(path.join(out,'app/api/customer-followups/route.mjs')),legacyFollowups=await import(path.join(out,'app/api/followups/route.mjs')),journeys=await import(path.join(out,'app/api/journeys/route.mjs'));
const capture=()=>sql.prepare('SELECT * FROM crm_records ORDER BY id').all();
const create={action:'save',kind:'customer',createKey:crypto.randomUUID(),data:{name:'مصنع اختبار الصلاحيات',region:'الشرقية',location:'26.437341, 50.034499'}};
const gps={location:'26.437341, 50.034499',locationSource:'device',locationCapturedAt:now,locationAccuracy:12};
user('rep');const customer=await post(create);check((await post(create)).alreadySaved,true);
const contactData={type:'call',date:day,summary:'تعريف بمنتجات الشركة',result:'متابعة العميل',salesStage:'new',strength:'strong',nextAction:'متابعة المواصفات',nextDate:day,...gps};
const visitBody=()=>({createKey:crypto.randomUUID(),customerId:customer.id,customerVersion:raw(customer.id).version,timingMode:'automatic',elapsedMilliseconds:2000,data:contactData});
const firstVisit=visitBody(),visit=await post(firstVisit,200,visits);check((await post(firstVisit,200,visits)).alreadySaved,true);
check(row(visit.id).data.performedBy,'rep');check(row(customer.id).data._visitPlan.visitId,visit.id);
// Saved records reject direct edits/deletes through both the current and generic APIs.
const beforeDenied=capture();
await post({...firstVisit,id:visit.id,version:raw(visit.id).version,createKey:crypto.randomUUID(),data:{...contactData,result:'forbidden edit'}},403,visits);
await post({action:'save',kind:'activity',id:visit.id,version:raw(visit.id).version,data:contactData},403);
await post({action:'delete',kind:'activity',id:visit.id,version:raw(visit.id).version},403);

await post({action:'delete',kind:'customer',id:customer.id,version:raw(customer.id).version},403);
check(capture(),beforeDenied,'Blocked operations cannot alter stored records');
// Current policy allows regional customer details to be corrected, while visits remain append-only.
await post({action:'save',kind:'customer',id:customer.id,version:raw(customer.id).version,data:{...row(customer.id).data,name:'Updated factory',location:'26.44, 50.04'}});
check(row(customer.id).data.name,'Updated factory');check(row(customer.id).data.location,'26.44, 50.04');
// Followups append new history while maintaining the automatic current plan.
const followupBody={createKey:crypto.randomUUID(),customerId:customer.id,customerVersion:raw(customer.id).version,sourceId:visit.id,sourceVersion:raw(visit.id).version,data:{type:'call',date:day,result:'تم التواصل وتحديد المتطلبات',salesStage:'specs',invoiceOutcome:'pending',nextAction:'استكمال المواصفات',nextDate:day}};
const followed=await post(followupBody,200,customerFollowups);check((await post(followupBody,200,customerFollowups)).alreadySaved,true);check(row(followed.id).data.performedBy,'rep');check(row(visit.id).data.result,contactData.result);check(row(customer.id).data._visitPlan.visitId,followed.id);
await post({action:'delete',kind:'activity',id:followed.id,version:raw(followed.id).version},403);
// A previous scheduled contact is mandatory; stale contact IDs cannot execute again.
const unchanged=capture();
await post({...followupBody,createKey:crypto.randomUUID(),customerVersion:raw(customer.id).version},409,customerFollowups);
check(capture(),unchanged,'Stale-source rejection preserves history');
const unvisited=await post({...create,createKey:crypto.randomUUID(),data:{...create.data,name:'مصنع بلا زيارة سابقة'}});
await post({...followupBody,createKey:crypto.randomUUID(),customerId:unvisited.id,customerVersion:raw(unvisited.id).version,sourceId:undefined,sourceVersion:undefined},400,customerFollowups);
// Legacy new-contact entry remains append-only, including its existing retry receipt.
const legacyContact={type:'call',date:day,summary:'اتصال جديد',result:'تم التواصل',nextAction:'اتصال لاحق',nextDate:day,...gps};
const genericBody={action:'save',kind:'activity',parentId:customer.id,createKey:crypto.randomUUID(),data:legacyContact};
const generic=await post(genericBody);check((await post(genericBody)).alreadySaved,true);
await post({...genericBody,id:generic.id,version:raw(generic.id).version,data:{...legacyContact,result:'forbidden'}},403);
await post({...genericBody,id:generic.id,version:raw(generic.id).version,clockAction:'finish'},403);
const legacyBody={createKey:crypto.randomUUID(),parentId:customer.id,data:{hasRequest:false,followupTitle:'متابعة جديدة',quantity:1,stage:'new',nextAction:'متابعة المتطلبات',nextDate:day},contact:legacyContact};
const legacy=await post(legacyBody,200,legacyFollowups);check((await post(legacyBody,200,legacyFollowups)).alreadySaved,true);
await post({...legacyBody,id:legacy.id,version:raw(legacy.id).version,createKey:crypto.randomUUID(),data:{...legacyBody.data,followupTitle:'forbidden'}},403,legacyFollowups);
await post({...legacyBody,createKey:crypto.randomUUID(),adoptId:generic.id,adoptVersion:raw(generic.id).version,contact:undefined},403,legacyFollowups);
check(raw(generic.id).parent_id,customer.id);
// A new visit cannot be used as a back door to rewrite an existing mold request.
const requestBody={...visitBody(),requestData:{hasRequest:true,moldType:'قالب متحرك',product:'بلوك',dimensions:'40x20x20',quantity:1,stage:'new',nextAction:'مراجعة الطلب',nextDate:day}};
const requested=await post(requestBody,200,visits);check(!!requested.requestId,true);
const requestBefore=row(requested.requestId);
await post({...visitBody(),requestId:requested.requestId,requestVersion:requestBefore.version,requestData:{...requestBefore.data,quantity:2}},403,visits);
check(row(requested.requestId),requestBefore);
const linked=await post({...visitBody(),requestId:requested.requestId},200,visits);check(row(linked.id).data.requestId,requested.requestId);
// Viewing the same history and recording a physical journey remains available.
const payload=await read();for(const id of [customer.id,visit.id,followed.id,requested.id,linked.id])check(payload.records.some(r=>r.id===id),true);
const selected=await post({action:'select',createKey:crypto.randomUUID(),customerId:customer.id},200,journeys);check(selected.stop.memberId,'rep');
const physical=await post({...visitBody(),data:{...contactData,type:'visit',journeyStopId:selected.stop.id}},200,visits);check(row(physical.id).data.journeyStopId,selected.stop.id);
await post({action:'end',stopId:selected.stop.id,reason:'contact_type_changed'},200,journeys);check(!!sql.prepare('SELECT closed_at FROM crm_journey_stops WHERE id=?').get(selected.stop.id).closed_at,true);
// Managers and supervisors keep team edit rights. A role change before commit blocks
// the edit atomically, and a regional change before an append blocks that new entry.
for(const role of ['manager','supervisor']){
 user(role);const edit={...visitBody(),id:visit.id,version:raw(visit.id).version,data:{...row(visit.id).data,result:'تحديث '+role}};
 await post(edit,200,visits);check(row(visit.id).data.result,'تحديث '+role);
 const state=capture();race=()=>sql.prepare("UPDATE crm_members SET role='rep' WHERE id=?").run(role);
 await post({...edit,version:raw(visit.id).version,createKey:crypto.randomUUID(),data:{...row(visit.id).data,result:'forbidden race'}},409,visits);
 check(capture(),state);sql.prepare('UPDATE crm_members SET role=? WHERE id=?').run(role,role);
}
user('manager');const beforeDelete=capture();race=()=>sql.prepare("UPDATE crm_members SET role='rep' WHERE id='manager'").run();
await post({action:'delete',kind:'activity',id:linked.id,version:raw(linked.id).version},409);check(capture(),beforeDelete);sql.prepare("UPDATE crm_members SET role='manager' WHERE id='manager'").run();
user('rep');const beforeAppend=capture();race=()=>sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='rep'").run();await post(visitBody(),409,visits);check(capture(),beforeAppend);sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='rep'").run();
user('manager');await post({action:'delete',kind:'activity',id:linked.id,version:raw(linked.id).version});check(raw(linked.id),undefined);
check(sql.prepare('PRAGMA foreign_key_check').all(),[]);
console.log(JSON.stringify({repEditPermissionsQA:'passed',checks,productionDataUsed:false,features:'rep customer correction allowed; visit edit/delete denied, append creation and retry preserved, request/adoption backdoor denied, history visible, journey automatic updates preserved, manager/supervisor rights and commit-time role/region race guards'}));
