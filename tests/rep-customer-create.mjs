import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
// Authenticated route integration on an isolated real SQLite database; no production/network writes.
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'rep-customer-create-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=? OR email=?').bind(u.userId,u.email).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
for(const name of ['crm','visits','customer-address','customer-service'])compile('app/api/'+name+'/route.ts');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+f,'utf8'));
let race=null;
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{if(race){const fn=race;race=null;await fn();}sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const now=new Date().toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const member=(id,role,region='eastern',branch='الرئيسي')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org',id,role,branch,region,now);
member('owner','admin','all');member('rep','rep');member('peer','rep');member('west','rep','western');member('all-rep','rep','all');member('unassigned-rep','rep','unassigned');member('cs','customer_service');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const user=id=>{globalThis.testUser=id?{userId:'u-'+id,email:id+'@yourrest.org',fullName:id}:null;};
const crm=await import(path.join(out,'app/api/crm/route.mjs')),visits=await import(path.join(out,'app/api/visits/route.mjs')),addressApi=await import(path.join(out,'app/api/customer-address/route.mjs')),serviceApi=await import(path.join(out,'app/api/customer-service/route.mjs'));
const addressProvider=await import(path.join(out,'lib/customer-address-server.mjs'));
const raw=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id),row=id=>({...raw(id),data:JSON.parse(raw(id).data)});
const count=()=>sql.prepare("SELECT COUNT(*) n FROM crm_records WHERE kind='customer'").get().n;
let checks=0;
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const request=(body,origin='https://test.invalid')=>new Request('https://test.invalid/api/crm',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
const post=async(body,status=200,route=crm,origin)=>{const res=await route.POST(request(body,origin)),data=await res.json();check(res.status,status,JSON.stringify(data));return data;};
const read=async()=>{const res=await crm.GET();check(res.status,200);return res.json();};
const create=(data={},extra={})=>({action:'save',kind:'customer',createKey:crypto.randomUUID(),data:{name:'مصنع اختبار الإضافة',region:'الشرقية',location:'26.437341, 50.034499',...data},...extra});
user('rep');const body=create({code:'REP-001',assignedTo:'west',branch:'فرع مزور',_createdBy:'owner',sourceFile:'forged-import',sourceKey:'forged-row'}),saved=await post(body),created=row(saved.id);
check(created.assigned_to,'rep');check(created.branch,'الرئيسي');check(created.parent_id,null);check(created.data.assignedTo,'rep');check(created.data.branch,'الرئيسي');check(created.data._createdBy,'rep');check(created.data.sourceFile,undefined);check(created.data.sourceKey,undefined);check(created.data.latitude,26.437341);check(created.data.longitude,50.034499);
let payload=await read();const projected=payload.records.find(r=>r.id===saved.id);check(!!projected,true);check(projected.data._masterReadOnly,undefined);check(projected.data._readOnly,undefined);
// An identical transport retry returns the existing record and cannot duplicate the audit or customer.
const beforeCount=count();check((await post(body)).alreadySaved,true);check(count(),beforeCount);check(sql.prepare("SELECT COUNT(*) n FROM crm_audit WHERE record_id=? AND action='إضافة'").get(saved.id).n,1);
await post({...body,data:{...body.data,name:'changed retry'}},409);check(row(saved.id).data.name,body.data.name);
const sharedSource=await post(create({code:'REP-001'}));check(count(),beforeCount+1);check(sql.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').get(sharedSource.id).number!==sql.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').get(saved.id).number,true,'Shared ERP references keep distinct CRM numbers');
await post(create({}, {createKey:undefined}),400);await post(create({}, {createKey:'invalid'}),400);
for(const region of ['الغربية','','unknown','المنطقة غير محددة'])await post(create({region}),403);
await post(create({}, {parentId:saved.id}),403);
// Regional representatives may update customer details, but cannot delete or reassign.
const editCustomer=(id,data={},version=row(id).version)=>({action:'save',kind:'customer',id,version,data:{...row(id).data,...data}});
await post(editCustomer(saved.id,{location:'24.7, 46.6',latitude:null,longitude:null,phone:'0501234567'}));
check(row(saved.id).data.latitude,24.7);check(row(saved.id).data.longitude,46.6);check(row(saved.id).data.phone,'0501234567');
await post(editCustomer(saved.id,{},1),409);
await post(editCustomer(saved.id,{assignedTo:'peer'}),403);
await post(editCustomer(saved.id,{branch:'forged'}),403);
await post(editCustomer(saved.id,{region:'الغربية'}),403);
await post(editCustomer(saved.id,{location:'999,999',latitude:null,longitude:null}),400);
await post({action:'delete',kind:'customer',id:saved.id,version:row(saved.id).version},403);
for(const kind of ['opportunity','quote'])await post({...create(),kind,parentId:saved.id},403);
// A machine of the representative's own customer is theirs to record, so a customer's fields offered as a machine fail on the machine's own rules, not on the role.
await post({...create(),kind:'factory',parentId:saved.id},400);
user('peer');await post(editCustomer(saved.id,{contact:'Regional correction'}));check(row(saved.id).assigned_to,'rep');check(row(saved.id).data.contact,'Regional correction');
user('west');await post(editCustomer(saved.id,{contact:'Forbidden'}),404);check(row(saved.id).data.contact,'Regional correction');
user('rep');const beforeRace=row(saved.id).version;race=()=>sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='rep'").run();await post(editCustomer(saved.id,{contact:'Race'}),409);check(row(saved.id).version,beforeRace);sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='rep'").run();
check(row(saved.id).data.name,body.data.name);
// The newly created customer's region, map coordinates and contact workflow become available immediately.
user('peer');check((await read()).records.some(r=>r.id===saved.id),true);
user('west');check((await read()).records.some(r=>r.id===saved.id),false);
user('rep');const visit={createKey:crypto.randomUUID(),customerId:saved.id,customerVersion:raw(saved.id).version,timingMode:'automatic',elapsedMilliseconds:2000,data:{type:'call',date:day,summary:'تعريف بمنتجات الشركة',result:'متابعة العميل',salesStage:'new',strength:'strong',nextAction:'متابعة المواصفات',nextDate:day,requestedProducts:['قوالب البلوك المتحركة'],location:'26.437341, 50.034499',locationSource:'device',locationCapturedAt:new Date().toISOString(),locationAccuracy:12,visitWorkflow:'customer-v1'}};
const contact=await post(visit,200,visits);check(row(contact.id).data.performedBy,'rep');check(raw(contact.id).parent_id,saved.id);
// Losing regional access between saving and retrying never returns the old protected record.
sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='rep'").run();await post(body,404);check((await read()).records.some(r=>r.id===saved.id),false);sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='rep'").run();
// Account, role, reporting line and territorial changes at commit revoke the insert atomically.
for(const [column,value] of [['region_scope','western'],['active',0],['role','customer_service'],['auth_version',9],['branch','آخر'],['supervisor_id','owner']]){
 const attempted=create({code:'RACE-'+column}),snapshot=sql.prepare("SELECT * FROM crm_members WHERE id='rep'").get(),previous=count();
 race=()=>sql.prepare('UPDATE crm_members SET '+column+'=? WHERE id=?').run(column==='auth_version'?snapshot.auth_version+1:value,'rep');
 await post(attempted,409);check(count(),previous);check(raw('crm-rep-'+attempted.createKey),undefined);
 sql.prepare('UPDATE crm_members SET '+column+'=? WHERE id=?').run(snapshot[column],'rep');
}
// Another factory may share the ERP reference, but receives a distinct CRM number.
const duplicate=create({code:'CONCURRENT-CODE'}),previous=count();race=()=>sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('racing-customer','customer',NULL,'peer','الرئيسي',?,?,?,1,'race')").run(JSON.stringify({name:'race winner',code:'CONCURRENT-CODE',region:'الشرقية'}),now,now);
const simultaneous=await post(duplicate);check(count(),previous+2);check(!!raw(simultaneous.id),true);check(sql.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').get(simultaneous.id).number!==sql.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').get('racing-customer').number,true);
// All-regions and explicitly unassigned reps retain their existing territory definitions.
user('all-rep');const all=await post(create({region:'الغربية'}));check(row(all.id).data.region,'الغربية');check(row(all.id).assigned_to,'all-rep');
user('unassigned-rep');const unassigned=await post(create({region:''}));check(row(unassigned.id).data.region,'');await post(create({region:'الشرقية'}),403);
// The existing service intake creation and admin workflows are unaffected.
user('cs');const service=await post(create({assignedTo:'cs',branch:'الرئيسي'}));check(row(service.id).data._createdBy,'cs');
user('owner');await post({action:'save',kind:'customer',id:saved.id,version:raw(saved.id).version,data:{...row(saved.id).data,name:'تحديث الإدارة'}});check(row(saved.id).data.name,'تحديث الإدارة');
user('rep');const finalCount=count();await post(create(),403,crm,'https://foreign.invalid');user(null);await post(create(),401);check(count(),finalCount);
// New customer GPS and short-address fields survive persistence, retries, and old-client admin edits.
user('rep');const capturedAt=new Date().toISOString(),gps={latitude:26.437341,longitude:50.034499,locationSource:'device',locationCapturedAt:capturedAt,locationAccuracy:12,shortAddress:' abcd 1234 ',customerType:'جملة',customerStatus:'نصف نشط',category:'بلوك'};
const gpsBody=create(gps),gpsSaved=await post(gpsBody),gpsRow=row(gpsSaved.id);
check(gpsRow.data.shortAddress,'ABCD1234');check(gpsRow.data.locationSource,'device');check(gpsRow.data.locationCapturedAt,capturedAt);check(gpsRow.data.locationAccuracy,12);check(gpsRow.data.category,'بلوك');check((await post(gpsBody)).alreadySaved,true);
for(const bad of [{shortAddress:'12345'},{shortAddress:'ABC12345'},{shortAddress:'العنوان'},{locationAccuracy:-1},{latitude:28},{longitude:51},{locationCapturedAt:'invalid'},{locationCapturedAt:new Date(Date.now()+600000).toISOString()},{locationSource:'device',locationCapturedAt:undefined},{locationSource:'device',locationAccuracy:undefined}])await post(create({...gps,...bad}),400);
// GPS denial still permits a deliberate save without an invented point/address.
const noGps=await post(create({location:'',customerType:'مصنع',category:'Imported custom category'}));check(row(noGps.id).data.latitude,null);check(row(noGps.id).data.shortAddress,'');check(row(noGps.id).data.category,'Imported custom category');
// A place typed or chosen on a map instead of the phone's position (the body the form sends in that mode): the server works the numbers out and never calls it a phone capture.
const byHand={latitude:null,longitude:null,locationSource:undefined,locationCapturedAt:undefined,locationAccuracy:undefined};
const handPlaces=[['24.7136, 46.6753',24.7136,46.6753],['21.4858، 39.1925',21.4858,39.1925],['https://www.google.com/maps/place/Jeddah/@21.5433,39.1728,17z',21.5433,39.1728],['https://www.google.com/maps?q=26.4373,50.0344',26.4373,50.0344],['21.5432000, 39.1728000',21.5432,39.1728]];
for(const [text,latitude,longitude] of handPlaces){
 const placed=row((await post(create({...byHand,location:text,shortAddress:'dmma1234'}))).id).data;
 check([placed.location,placed.latitude,placed.longitude,placed.locationSource,placed.locationCapturedAt,placed.locationAccuracy,placed.shortAddress],[text,latitude,longitude,undefined,undefined,undefined,'DMMA1234'],'a hand-placed point: '+text);
}
// ...even when the form still carries the phone's capture from before the place was changed: the stale claim is refused, never relabelled
await post(create({...gps,location:'24.7136, 46.6753'}),400);
const staleNumbers=row((await post(create({...gps,location:'24.7136, 46.6753',locationSource:undefined}))).id).data;
check([staleNumbers.latitude,staleNumbers.longitude,staleNumbers.locationSource,staleNumbers.locationCapturedAt,staleNumbers.locationAccuracy],[24.7136,46.6753,undefined,undefined,undefined],'a point without the device source takes its numbers from the typed place and is never stored as a capture');
// text that is not coordinates, a pair outside the globe and the null island are refused with the sentence the form shows
for(const text of ['الدمام','abc','91, 50','26, 181','0, 0','26.4373','26.4373; 50.0344']){
 const refused=await post(create({...byHand,location:text}),400);
 check(JSON.stringify(refused).includes('أدخل اللوكيشن'),true,'refused: '+text);
}
user('owner');const oldClient={...gpsRow.data};for(const field of ['shortAddress','locationSource','locationCapturedAt','locationAccuracy'])delete oldClient[field];
await post({action:'save',kind:'customer',id:gpsSaved.id,version:raw(gpsSaved.id).version,data:{...oldClient,name:'old client edit'}});check(row(gpsSaved.id).data.shortAddress,'ABCD1234');check(row(gpsSaved.id).data.locationCapturedAt,capturedAt);
await post({action:'save',kind:'customer',id:gpsSaved.id,version:raw(gpsSaved.id).version,data:{...row(gpsSaved.id).data,location:'26.45,50.05',latitude:26.45,longitude:50.05}},400);
const manual={...row(gpsSaved.id).data,location:'26.45,50.05',latitude:null,longitude:null,locationSource:undefined,locationCapturedAt:'',locationAccuracy:undefined};
await post({action:'save',kind:'customer',id:gpsSaved.id,version:raw(gpsSaved.id).version,data:manual});check(row(gpsSaved.id).data.locationSource,undefined);check(row(gpsSaved.id).data.locationAccuracy,undefined);check(row(gpsSaved.id).data.latitude,26.45);
// The strict legacy service-inline schema accepts and retains the same new fields.
user('cs');sql.prepare("UPDATE crm_members SET supervisor_id='owner' WHERE id='cs'").run();
const inlineBody={action:'create',requestId:crypto.randomUUID(),newCustomer:{name:'Inline GPS customer',phone:'0551111111',region:'الشرقية',location:'26.437341, 50.034499',...gps},data:{source:'website',products:['قوالب البلوك المتحركة'],strength:'strong',needs:'احتياج لقوالب جديدة',nextAction:'تحديد المواصفات',nextDate:day}};
await post(inlineBody,200,serviceApi);check(row('service-customer-'+inlineBody.requestId).data.shortAddress,'ABCD1234');check(row('service-customer-'+inlineBody.requestId).data.locationSource,'device');
// Address resolution authorizes before provider access and never transmits GPS when unconfigured.
const point={latitude:26.437341,longitude:50.034499};let fetches=0;const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{fetches++;throw Error('unexpected network call');};
user(null);await post(point,401,addressApi);user('rep');await post(point,403,addressApi,'https://foreign.invalid');check(fetches,0);
check((await post(point,200,addressApi)).status,'not_configured');check(fetches,0);
for(const bad of [{latitude:91,longitude:50},{latitude:26,longitude:181},{latitude:'26',longitude:50},{latitude:0,longitude:0},{...point,url:'https://foreign.invalid'}])await post(bad,400,addressApi);
await post({latitude:26,longitude:50,extra:'x'.repeat(3000)},413,addressApi);check(fetches,0);
globalThis.testEnv.YR_NATIONAL_ADDRESS_API_KEY='private-provider-test-key';
let providerPayload={success:true,Addresses:[{ShortAddress:' abcd1234 ',Address1:'شارع الاختبار',City:'الدمام',PostCode:'12345'}]};
globalThis.fetch=async(input,options)=>{fetches++;const url=new URL(input);check(url.origin,'https://apina.address.gov.sa');check(url.pathname,'/NationalAddress/v3.1/address/address-geocode');check(url.searchParams.get('api_key'),'private-provider-test-key');check(url.searchParams.get('lat'),String(point.latitude));check(url.searchParams.get('long'),String(point.longitude));check(options.redirect,'error');return Response.json(providerPayload);};
let resolved=await post(point,200,addressApi);check(resolved,{status:'found',shortAddress:'ABCD1234',address:'شارع الاختبار',city:'الدمام'});check(JSON.stringify(resolved).includes('private-provider-test-key'),false);
providerPayload={success:true,Addresses:[{BuildingNumber:'1234',PostCode:'56789',Address1:'عنوان فقط',City:'الدمام'}]};resolved=await post(point,200,addressApi);check(resolved.shortAddress,undefined);check(resolved.address,'عنوان فقط');
providerPayload={success:true,Addresses:[]};check((await post(point,200,addressApi)).status,'not_found');
providerPayload={success:true,Addresses:[{ShortAddress:'ABCD1234'},{ShortAddress:'EFGH5678'}]};check((await post(point,200,addressApi)).status,'ambiguous');
providerPayload={success:false,error:'provider-private-error'};resolved=await post(point,200,addressApi);check(resolved,{status:'unavailable'});
globalThis.fetch=async()=>new Response('secret provider auth failed',{status:401});check((await post(point,200,addressApi)).status,'unavailable');
globalThis.fetch=async()=>new Response('{bad-json');check((await post(point,200,addressApi)).status,'unavailable');
globalThis.fetch=async()=>new Response('x'.repeat(512001));check((await post(point,200,addressApi)).status,'unavailable');
globalThis.fetch=async()=>{throw Error('Network failure with private-provider-test-key');};check((await post(point,200,addressApi)).status,'unavailable');
// Timeout is bounded even when an upstream connection never settles.
const realSetTimeout=globalThis.setTimeout;globalThis.setTimeout=(callback,delay,...args)=>realSetTimeout(callback,delay===8000?5:delay,...args);globalThis.fetch=async()=>new Promise(()=>{});check((await post(point,200,addressApi)).status,'unavailable');globalThis.setTimeout=realSetTimeout;
const beforeLimit=fetches;check((await post(point,429,addressApi)).status,'unavailable');check(fetches,beforeLimit);
// No matches or errors ever return arbitrary upstream fields.
check(addressProvider.parseCustomerAddressResponse({success:true,Addresses:[{ShortAddress:'12345678',PostCode:'99999'}]}),{status:'not_found'});
check(addressProvider.parseCustomerAddressResponse({success:true,totalSearchResults:2,Addresses:[{ShortAddress:'ABCD1234'}]}),{status:'ambiguous'});
check(addressProvider.parseCustomerAddressResponse({Addresses:[{ShortAddress:'ABCD1234'}]}),{status:'unavailable'});
delete globalThis.testEnv.YR_NATIONAL_ADDRESS_API_KEY;globalThis.fetch=originalFetch;
check(sql.prepare('PRAGMA foreign_key_check').all(),[]);
// Admin deletion preserves source integrity, removes stale plans and is transactional.
user('owner');
const removable=await post(create({code:'DELETE-QA',assignedTo:'rep',branch:'الرئيسي'}));
const insertContact=(id,extra={})=>sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,'activity',?,'rep','الرئيسي',?,?,?,1)").run(id,removable.id,JSON.stringify({performedBy:'rep',visitWorkflow:'customer-v1',date:day,...extra}),now,now);
insertContact('delete-source');insertContact('delete-child',{sourceId:'delete-source',visitWorkflow:'followup-v1'});
const del=id=>({action:'delete',kind:'activity',id,version:row(id).version});
await post(del('delete-source'),400);check(!!raw('delete-source'),true);
user('rep');await post(del('delete-child'),403);check(!!raw('delete-child'),true);user('owner');
await post({...del('delete-child'),version:0},409);
await post(del('delete-child'));check(raw('delete-child'),undefined);
sql.prepare("UPDATE crm_records SET data=json_set(data,'$._visitPlan',json(?),'$._stageVisitId','delete-source') WHERE id=?").run(JSON.stringify({visitId:'delete-source'}),removable.id);
await post(del('delete-source'));check(raw('delete-source'),undefined);check(row(removable.id).data._visitPlan,undefined);check(row(removable.id).data._stageVisitId,undefined);
const evidence=JSON.parse(sql.prepare("SELECT detail FROM crm_audit WHERE record_id='delete-source' AND action='حذف'").get().detail);check(evidence.deletedBy,'owner');check(evidence.record.id,'delete-source');
insertContact('delete-race');race=()=>insertContact('delete-race-child',{sourceId:'delete-race',visitWorkflow:'followup-v1'});await post(del('delete-race'),409);check(!!raw('delete-race'),true);check(sql.prepare("SELECT count(*) n FROM crm_audit WHERE record_id='delete-race' AND action='حذف'").get().n,0);
// A routine contact must persist without inventing a buying need.
user('rep');
const noNeedCustomer=await post(create({code:'NO-NEED-REGRESSION'}));
for(const omitted of [false,true]){
 const input={...visit,createKey:crypto.randomUUID(),customerId:noNeedCustomer.id,customerVersion:raw(noNeedCustomer.id).version,data:{...visit.data,salesStage:'',strength:'',requestedProducts:[]}};
 if(omitted){delete input.data.salesStage;delete input.data.strength;delete input.data.requestedProducts;}
 const receipt=await post(input,200,visits),stored=row(receipt.id).data;
 check(stored.salesStage||'','');check(stored.strength||'','');check(stored.requestedProducts,[]);check(stored.requestId||'','');check(stored.nextAction,visit.data.nextAction);
}
const chosen={...visit,createKey:crypto.randomUUID(),customerId:noNeedCustomer.id,customerVersion:raw(noNeedCustomer.id).version,data:{...visit.data,salesStage:'qualified',strength:'weak',requestedProducts:['خلاطات البلوك']}};
chosen.data.salesStage='new';
const chosenReceipt=await post(chosen,200,visits);check(row(chosenReceipt.id).data.salesStage,'new');check(row(chosenReceipt.id).data.strength,'weak');check(row(chosenReceipt.id).data.requestedProducts,['خلاطات البلوك']);
console.log(JSON.stringify({repCustomerCreateQA:'passed',checks,features:'scoped customer creation, authenticated ownership, regional customer edits with protected ownership, immediate map and visit use, retry identity, race revocation, immutable CRM numbers with shared ERP source references, CS/admin regression, GPS/address persistence, optional SPL lookup, authorization and provider failures'}));
