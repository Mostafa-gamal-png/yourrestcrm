// Saving without a network and the sync that sends what the device kept (lib/offline-submit.ts), on the real modules transpiled as the build
// does, over stand-ins of IndexedDB, localStorage and BroadcastChannel (scripts/lib/fake-browser-storage.mjs) and a stand-in server that keeps
// the routes' contract (a request key saved once; the same body again answers the same record; another body 409). The clock and the timers
// are fixed; every member, customer and key is made up.
// 1. What may be kept: the five endpoints and their new records only, the request key (a UUID, never with Arabic digits, marks or spaces).
// 2. Kept offline: the entry, its local id and fingerprint, the device time; the same send again is the same entry, another body refused.
// 3. Sent: in order, the frozen body, the receipt; a send repeated after a network cut (the server saved it, the answer was lost) makes no
//    duplicate; what is retried (no connection, a timeout of the form, 408, 429, 5xx, a page that was not the server's, a save not confirmed)
//    and what is held for review (the server's own 4xx with its error; 403 stops the sync, 401 also closes the device session).
// 4. The account at the start of a sync: signed out (held with «sign in again», then released after the sign-in), another member, changed
//    access, a malformed answer, a 5xx, no network.
// 5. The lease between tabs, the drain shared by callers, «sending now», and a sign-out during a sync; one member's entries never sent with
//    another's session.
// 6. Dependencies: a new customer before what is recorded on it, an attachment's server id put in the body, held entries released.
// 7. Attachments: size, type by the first bytes, the name, the same key once.
// 8. Completing a visit, moving a new customer, retrying; and the server's reading of the device's capture time (lib/offline-server.ts).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {createFakeIndexedDB,createFakeLocalStorage,createFakeBroadcast} from '../scripts/lib/fake-browser-storage.mjs';

const NativeDate=Date;let clock=NativeDate.parse('2026-11-22T06:00:00.000Z');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const made=[];process.on('exit',()=>{globalThis.Date=NativeDate;for(const dir of made)fs.rmSync(dir,{recursive:true,force:true});});
function compiler(prefix){
 const base=fs.mkdtempSync(path.join(runtime,prefix));made.push(base);
 const written=new Map(),seen=new Set();
 fs.writeFileSync(path.join(base,'env.mjs'),'export const env=globalThis.testEnv||{};');
 fs.writeFileSync(path.join(base,'auth.mjs'),'export async function getApplicationUser(){return null;}');
 function compile(relative){
  if(seen.has(relative))return;seen.add(relative);
  const src=path.join(root,relative),target=relative.replace(/\.tsx?$/,'.mjs'),dest=path.join(base,target);
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
   if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(base,'env.mjs'));
   if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(base,'auth.mjs'));
   if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
   let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
   if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';
   compile(source);return 'from '+JSON.stringify(path.join(base,source.replace(/\.tsx?$/,'.mjs')));
  });
  fs.writeFileSync(dest,code);written.set(target,code);
 }
 return {base,written,compile,load:rel=>import(pathToFileURL(path.join(base,rel)))};
}
const main=compiler('offline-submit-unit-');
for(const file of ['lib/offline-submit.ts','lib/offline-store.ts','lib/offline-auth.ts','lib/offline-review.ts','lib/client-submit.ts'])main.compile(file);
/** Another tab: the same modules loaded afresh over the same storage. */
async function tab(){
 const dir=fs.mkdtempSync(path.join(runtime,'offline-submit-unit-'));made.push(dir);
 for(const [rel,code] of main.written){const dest=path.join(dir,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,code.split(main.base).join(dir));}
 const load=rel=>import(pathToFileURL(path.join(dir,rel)));
 return {O:await load('lib/offline-submit.mjs'),S:await load('lib/offline-store.mjs')};
}

// The browser.
const idb=createFakeIndexedDB(),storage=createFakeLocalStorage(),broadcast=createFakeBroadcast();
const timers=new Map();let timerId=0;
globalThis.setTimeout=(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;};
globalThis.clearTimeout=id=>{timers.delete(id);};
const fire=delay=>{for(const [id,timer] of [...timers])if(timer.delay===delay){timers.delete(id);timer.callback();}};
const window=new EventTarget();Object.assign(window,{localStorage:storage.localStorage,location:{origin:'https://crm.yourrest.org'},setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout});
globalThis.window=window;globalThis.indexedDB=idb.indexedDB;globalThis.BroadcastChannel=broadcast.BroadcastChannel;
Object.defineProperty(globalThis,'navigator',{value:{onLine:false},configurable:true,writable:true});
const DB='yourrest-offline-v1',LOGOUT='yr-offline-pending-logout-v1';
const until=async(predicate,message)=>{for(let i=0;i<5000;i++){if(predicate())return;await new Promise(resolve=>setImmediate(resolve));}throw new Error('Never reached: '+message);};

// The server: GET /api/crm answers the session's snapshot; each POST saves its request key once.
const rep={id:'rep-1',userId:'u-rep-1',email:'rep.one@yourrest.org',name:'مندوب الرياض',role:'rep',branch:'الرئيسي',regionScope:'central',supervisorId:'sup-1',authVersion:3,active:1,target:0};
const peer={id:'rep-2',userId:'u-rep-2',email:'rep.two@yourrest.org',name:'مندوب جدة',role:'rep',branch:'جدة',regionScope:'western',supervisorId:'sup-1',authVersion:1,active:1,target:0};
const snapshotOf=(me,records=[])=>({me,records,members:[me],audits:[]});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const html=(status,text='<html><body>Service Unavailable</body></html>')=>new Response(text,{status,headers:{'Content-Type':'text/html'}});
const server={member:rep,saved:new Map(),calls:[],queue:[],files:new Map()};
server.answer=call=>{
 if(call.method==='GET'&&call.url==='/api/crm')return json(snapshotOf(server.member));
 if(call.url==='/api/visit-files'){const form=call.body,key=form.get('uploadKey'),file=form.get('file');if(!server.files.has(key))server.files.set(key,{id:'file-'+key.slice(-4),name:file.name,customerId:form.get('customerId'),memberId:form.get('memberId')});return json({ok:true,...server.files.get(key)});}
 const body=JSON.parse(call.body),key=body.createKey||body.requestId;
 if(server.saved.has(key)){const prior=server.saved.get(key);return prior.body===call.body?json({ok:true,id:prior.id,alreadySaved:true}):json({error:'العملية محفوظة ببيانات مختلفة. حدّث الصفحة.'},409);}
 const id='srv-'+key.slice(-4);server.saved.set(key,{id,body:call.body,url:call.url});return json({ok:true,id});
};
globalThis.fetch=async(url,init={})=>{const call={url:String(url),method:init.method||'GET',init,body:init.body};server.calls.push(call);const step=server.queue.shift();return step?step(call):server.answer(call);};
const posts=()=>server.calls.filter(call=>call.method==='POST'),gets=()=>server.calls.filter(call=>call.method==='GET');

let checks=0;const counts={};
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
const rejects=async(promise,test,message)=>{await assert.rejects(promise,test,message);checks++;};
const counted=async(part,fn)=>{const before=checks;await fn();counts[part]=checks-before;};
const sha=text=>createHash('sha256').update(text).digest('hex');
const K=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const outbox=()=>idb.all(DB,'outbox'),receipts=()=>idb.all(DB,'receipts'),job=id=>idb.get(DB,'outbox',id),meta=key=>idb.get(DB,'meta',key);
const bodies={
 customer:(key,data={})=>JSON.stringify({action:'save',kind:'customer',createKey:key,data:{name:'مصنع الريان',branch:'الرئيسي',location:'24.7136, 46.6753',...data}}),
 visit:(key,customerId='crm-existing',data={})=>JSON.stringify({createKey:key,customerId,data:{type:'visit',result:'تم عرض القوالب',nextAction:'متابعة',nextDate:'2026-11-25',...data}}),
 followup:(key,customerId='crm-existing')=>JSON.stringify({createKey:key,customerId,sourceId:'customer-visit-old',data:{date:'2026-11-23'}}),
 service:(key,customerId='crm-existing')=>JSON.stringify({action:'create',requestId:key,customerId,registration:{subject:'صيانة قالب'}}),
 plan:key=>JSON.stringify({action:'send',requestId:key,date:'2026-11-23',stops:[]})
};
const urls={customer:'/api/crm',visit:'/api/visits',followup:'/api/customer-followups',service:'/api/customer-service',plan:'/api/daily-plans'};
const {O,S}={O:await main.load('lib/offline-submit.mjs'),S:await main.load('lib/offline-store.mjs')};
const R=await main.load('lib/offline-review.mjs'),C=await main.load('lib/client-submit.mjs');
async function fresh(me=rep){idb.clear(DB);storage.map.clear();storage.refuse(false);storage.refuseWrites(false);server.member=me;server.saved.clear();server.files.clear();server.calls.length=0;server.queue.length=0;timers.clear();navigator.onLine=false;await S.saveOfflineSnapshot(snapshotOf(me));}
const tick=(ms=60000)=>{clock+=ms;};
const afterCheck=(...steps)=>server.queue.push(call=>server.answer(call),...steps);
const submit=(kind,key,extra={},me=rep)=>O.offlineSubmit(urls[kind],extra.body??bodies[kind](key),{me,label:extra.label??kind+' '+key.slice(-2),language:extra.language});

await counted('what may be kept',async()=>{
 await fresh();
 await rejects(O.offlineSubmit('/api/other',bodies.visit(K(1)),{me:rep,label:'x'}),/Unsupported offline endpoint/,'an endpoint the device does not keep');
 await rejects(O.offlineSubmit('/api/visits?x=1',bodies.visit(K(1)),{me:rep,label:'x'}),/Unsupported offline endpoint/,'only the exact path');
 const online='هذه العملية تحتاج اتصالًا بالإنترنت.';
 for(const [url,body] of [['/api/crm',{action:'save',kind:'customer',id:'crm-1',createKey:K(1)}],['/api/crm',{action:'save',kind:'activity',createKey:K(1)}],['/api/crm',{action:'delete',kind:'customer',createKey:K(1)}],['/api/visits',{id:'v1',createKey:K(1)}],['/api/customer-followups',{id:'f1',createKey:K(1)}],['/api/customer-service',{action:'update',requestId:K(1)}],['/api/customer-service',{action:'create',id:'s1',requestId:K(1)}],['/api/daily-plans',{action:'approve',requestId:K(1)}]])
  await rejects(O.offlineSubmit(url,JSON.stringify(body),{me:rep,label:'x'}),error=>error.message===online,'needs the network: '+url+' '+JSON.stringify(body));
 const key='تعذر تحديد عملية الحفظ. افتح النموذج مجددًا.';
 for(const value of [undefined,'','not-a-uuid',123,K(1)+' ','‏'+K(1),K(1).replace(/0/g,'٠'),K(1).slice(0,-1),K(1).replace(/-/g,'')])
  await rejects(O.offlineSubmit('/api/visits',JSON.stringify({createKey:value,customerId:'c',data:{}}),{me:rep,label:'x'}),error=>error.message===key,'a request key that is not a UUID: '+JSON.stringify(value));
 await rejects(O.offlineSubmit('/api/customer-service',JSON.stringify({action:'create',createKey:K(1),customerId:'c'}),{me:rep,label:'x'}),error=>error.message===key,'a service registration is keyed by its requestId');
 await rejects(O.offlineSubmit('/api/visits','{"createKey":',{me:rep,label:'x'}),SyntaxError,'a body that is not JSON');
 await rejects(O.offlineSubmit('/api/visits',bodies.visit(K(1)),{me:{...rep,role:'supervisor'},label:'x'}),/افتح التطبيق/,'a member whose access changed since the device session');
 eq([outbox(),server.calls],[[],[]],'nothing kept and nothing sent');
 const upper=await O.offlineSubmit('/api/visits',bodies.visit('ABCDEF01-0000-4000-8000-00000000AB10'),{me:rep,label:'زيارة'});
 eq(upper.queued,true,'a key in capitals is a key');
});

await counted('kept offline',async()=>{
 await fresh();
 const results={};
 const stamps={};
 for(const [index,kind] of ['customer','visit','followup','service','plan'].entries()){tick(1000);stamps[kind]=new NativeDate(clock).toISOString();results[kind]=await submit(kind,K(20+index),kind==='visit'?{label:'زيارة مصنع',language:'en'}:{});}
 eq(results.customer,{ok:true,id:'crm-rep-1-'+K(20),queued:true,blocked:false,message:''},'a new customer: its local id is the member and the key');
 eq([results.visit.id,results.followup.id,results.service.id,results.plan.id],['customer-visit-'+K(21),'customer-followup-'+K(22),'service-'+K(23),'daily-plan-'+K(24)],'the local id of each kind');
 eq(results.service.customerId,'crm-existing','a service registration names its customer');
 eq(server.calls,[],'offline: no request at all');
 const visit=job('rep-1:visit:'+K(21)),captured=stamps.visit;
 eq([visit.ownerId,visit.kind,visit.label,visit.status,visit.message,visit.createdAt,visit.capturedAt,visit.url,visit.language,visit.attempts,visit.wireBody],['rep-1','visit','زيارة مصنع','pending','',captured,captured,'/api/visits','en',0,undefined],'the entry as kept');
 eq(JSON.parse(visit.body),{...JSON.parse(bodies.visit(K(21))),offline:{memberId:'rep-1',capturedAt:captured}},'its body: what the form sent and who recorded it when, on the device');
 eq(visit.fingerprint,sha('/api/visits\n'+bodies.visit(K(21))),'its fingerprint: the endpoint and the body the form sent');
 eq([job('rep-1:customer:'+K(20)).label,job('rep-1:customer:'+K(20)).language],['customer '+K(20).slice(-2),'ar'],'a label and Arabic by default');
 eq(visit.owner,S.offlineOwner(rep),'the owner\'s stamp travels with it');
 const again=await submit('visit',K(21),{label:'زيارة مصنع',language:'en'});
 eq([again,outbox().length],[results.visit,5],'the same send again is the same entry');
 await rejects(submit('visit',K(21),{body:bodies.visit(K(21),'crm-existing',{result:'نتيجة أخرى'})}),/العملية محفوظة على الجهاز ببيانات مختلفة/,'the same key with another body is refused');
 eq(JSON.parse(job('rep-1:visit:'+K(21)).body).data.result,'تم عرض القوالب','and the kept entry is untouched');
 const shown=await O.currentOfflineSnapshot();
 eq(shown.records.map(record=>[record.id,record.data._offlineState]),[['crm-rep-1-'+K(20),'pending'],['customer-visit-'+K(21),'pending'],['customer-followup-'+K(22),'pending'],['intake-service-'+K(23),'pending']],'the screen shows what is kept (a plan projects nothing)');
 eq(await O.flushOutbox(rep),{synced:0,blocked:0,pending:5},'a sync while offline sends nothing');
 eq(server.calls,[],'not even the account check');
 idb.faults.commit=1;
 await rejects(submit('visit',K(29)),S.OfflineStorageError,'storage that refuses the entry: the save fails');
 eq([job('rep-1:visit:'+K(29)),server.calls],[undefined,[]],'nothing kept, nothing sent');
 // A sign-out that lands while the entry is being kept (after the session was checked, while its fingerprint is computed).
 const digest=crypto.subtle.digest;
 Object.defineProperty(crypto.subtle,'digest',{configurable:true,value:(...args)=>{storage.map.set(LOGOUT,'1');return digest.apply(crypto.subtle,args);}});
 try{await rejects(submit('visit',K(27)),S.OfflineStorageError,'a sign-out during the save: the entry is refused');}finally{delete crypto.subtle.digest;}
 eq([crypto.subtle.digest===digest,job('rep-1:visit:'+K(27))],[true,undefined],'and not kept');
 await rejects(submit('visit',K(28)),/افتح التطبيق/,'nothing is recorded while a sign-out waits');
 eq(await O.flushOutbox(rep),{synced:0,blocked:0,pending:0},'and nothing is sent');
 storage.map.delete(LOGOUT);
 eq(await O.currentOfflineSnapshot().then(value=>value.me.id),'rep-1','the session is back once the flag is gone');
 eq(await (async()=>{await S.lockOfflineSession();return O.currentOfflineSnapshot();})(),null,'a locked device shows nothing');
});

await counted('sent, receipts and replays',async()=>{
 await fresh();
 const stamps={};
 for(const [index,kind] of ['customer','visit','followup','service','plan'].entries()){tick(1000);stamps[kind]=new NativeDate(clock).toISOString();await submit(kind,K(30+index));}
 navigator.onLine=true;
 eq(await O.flushOutbox(rep),{synced:5,blocked:0,pending:0},'everything is sent');
 eq(server.calls.map(call=>call.method+' '+call.url),['GET /api/crm','POST /api/crm','POST /api/visits','POST /api/customer-followups','POST /api/customer-service','POST /api/daily-plans','GET /api/crm'],'the account first, then the entries oldest first, then a fresh snapshot');
 const visitCall=posts()[1];
 eq([visitCall.init.headers['Content-Type'],visitCall.init.credentials,JSON.parse(visitCall.body).offline],['application/json','same-origin',{memberId:'rep-1',capturedAt:stamps.visit}],'sent as JSON with the session, carrying the device time');
 eq([outbox(),receipts().length,server.saved.size,meta(S.SYNC_LEASE_KEY),timers.size],[[],5,5,undefined,0],'the queue is empty, five receipts, five records, the lease given back, no timer left');
 const receipt=idb.get(DB,'receipts','rep-1:visit:'+K(31));
 eq([receipt.result,receipt.projection.id,receipt.projection.data._offlineAcknowledged],[{ok:true,id:'srv-0031'},'srv-0031',true],'the receipt keeps the server\'s answer');
 const calls=server.calls.length;
 eq(await submit('visit',K(31)),{ok:true,id:'srv-0031',queued:false},'the same send after it reached the server answers from the receipt');
 eq(server.calls.length,calls,'without asking the server again');
 await rejects(submit('visit',K(31),{body:bodies.visit(K(31),'crm-existing',{result:'تغيّرت'})}),/ببيانات مختلفة/,'another body under a key already sent is refused');

 // The connection drops after the server saved the visit: the same request is sent again and the server answers the same record.
 navigator.onLine=false;tick();const cut=new NativeDate(clock).toISOString();await submit('visit',K(40));navigator.onLine=true;
 afterCheck(call=>{server.answer(call);throw new TypeError('Failed to fetch');});
 server.calls.length=0;
 eq(await O.flushOutbox(rep),{synced:0,blocked:0,pending:1},'the answer is lost');
 const waiting=job('rep-1:visit:'+K(40));
 eq([waiting.status,waiting.message,waiting.attempts,waiting.httpStatus],['pending','محفوظ على الجهاز؛ في انتظار الاتصال لإكمال الرفع.',1,undefined],'the entry waits, kept as it was');
 eq(await O.flushOutbox(rep),{synced:1,blocked:0,pending:0},'the next sync sends it again');
 const [first,second]=posts();
 eq([first.body===second.body,JSON.parse(second.body).offline.capturedAt,[...server.saved.keys()].filter(key=>key===K(40)).length,idb.get(DB,'receipts','rep-1:visit:'+K(40)).result.id],[true,cut,1,'srv-0040'],'the same body, the same device time, one record on the server, one receipt');

 // A form that waits for its sync no longer than 1.5 seconds; the entry is then sent in the background.
 let release;afterCheck(()=>new Promise(resolve=>{release=resolve;}));
 server.calls.length=0;tick();
 const pending=submit('visit',K(41));
 await until(()=>posts().length===1,'the send of the form');
 ok(timers.size>=2&&[...timers.values()].some(timer=>timer.delay===1500)&&[...timers.values()].some(timer=>timer.delay===25000),'the form waits 1.5 s for the sync; the send itself 25 s');
 fire(1500);
 const early=await pending;
 eq([early.queued,early.id,job('rep-1:visit:'+K(41)).status],[true,'customer-visit-'+K(41),'syncing'],'the form is told it is kept while it is being sent');
 eq(O.outboxDraining(),true,'«sending now»');
 release(server.answer(posts()[0]));
 await O.flushOutbox(rep);
 eq([job('rep-1:visit:'+K(41)),idb.get(DB,'receipts','rep-1:visit:'+K(41)).result.id,O.outboxDraining()],[undefined,'srv-0041',false],'then acknowledged in the background');
});

await counted('retried or held',async()=>{
 const isRefusal=O.isServerRefusal,E=C.SubmitError;
 eq([[400,{error:'x'}],[401,{error:'x'}],[403,{error:'x'}],[404,{error:'x'}],[409,{error:'x'}],[422,{error:'x'}],[499,{error:'x'}],[401,null],[401,{}]].map(([status,body])=>isRefusal(new E('m',status,body))),Array(9).fill(true),'the server\'s own 4xx with its error, or a 401');
 eq([[408,{error:'x'}],[429,{error:'x'}],[500,{error:'x'}],[503,{error:'x'}],[400,{error:''}],[400,{error:'   '}],[400,{error:7}],[400,null],[400,[]],[0,null],[399,{error:'x'}]].map(([status,body])=>isRefusal(new E('m',status,body))),Array(11).fill(false),'not a 408, 429, 5xx, an empty or missing error, no answer');
 eq([isRefusal(new E('m',401,null,true)),isRefusal(new E('m',400,{error:'x'},true)),isRefusal(new Error('x')),isRefusal({status:400,body:{error:'x'}}),isRefusal(null)],[false,false,false,false,false],'never a page that was not the server\'s, nor another error');
 eq(O.offlineNotAnswers(),Object.values(C.NOT_SERVER_ANSWER).flat(),'the device\'s own words for an answer that was not the server\'s');
 const retried=[['no connection',()=>{throw new TypeError('Failed to fetch');}],['503 with an error',()=>json({error:'الخادم مشغول'},503)],['502 page',()=>html(502)],['404 page',()=>html(404,'<html>Not Found</html>')],['413 page',()=>html(413)],['401 page',()=>html(401)],['403 page',()=>html(403)],['408',()=>json({error:'انتهت المهلة'},408)],['429',()=>json({error:'طلبات كثيرة'},429)],['200 not confirmed',()=>json({ok:false})],['200 without id',()=>json({ok:true})],['200 empty id',()=>json({ok:true,id:''})],['200 numeric id',()=>json({ok:true,id:7})],['200 array',()=>json([])],['400 without error',()=>json({message:'x'},400)]];
 for(const [name,answer] of retried){
  await fresh();await submit('visit',K(50),{language:name==='408'?'en':undefined});navigator.onLine=true;
  afterCheck(answer);
  const summary=await O.flushOutbox(rep),entry=job('rep-1:visit:'+K(50));
  eq([summary,entry.status,entry.message,entry.attempts,receipts(),meta(S.SYNC_LEASE_KEY)],[{synced:0,blocked:0,pending:1},'pending',name==='408'?'Saved on this device; waiting for a connection to upload.':'محفوظ على الجهاز؛ في انتظار الاتصال لإكمال الرفع.',1,[],undefined],'retried with the same entry: '+name);
  ok((await O.currentOfflineSnapshot())?.me.id==='rep-1','and the device session stays open: '+name);
  eq(await O.flushOutbox(rep),{synced:1,blocked:0,pending:0},'then sent: '+name);
 }
 // The form's own timeout (25 s) while the server keeps the request: the same entry is retried.
 await fresh();await submit('visit',K(51));navigator.onLine=true;
 afterCheck(()=>new Promise(()=>{}));
 const stuck=O.flushOutbox(rep);await until(()=>posts().length===1,'the send that hangs');fire(25000);
 eq([await stuck,job('rep-1:visit:'+K(51)).status],[{synced:0,blocked:0,pending:1},'pending'],'a send that times out is retried');

 // The server's own refusals: held for review with its words and what it said; 400/409 go on, 403 stops, 401 closes the device session.
 await fresh();
 for(let index=0;index<4;index++){tick(1000);await submit('visit',K(60+index));}
 navigator.onLine=true;
 const answers=[json({error:'العميل لم يعد متاحًا.',code:'CUSTOMER_UNAVAILABLE',duplicate:{id:'x y',date:'bad'}},404),json({error:'تم حفظ هذه المتابعة بالفعل.',code:'DUPLICATE',duplicate:{id:'customer-followup-old',date:'2026-11-20'},secret:'ignored'},409)];
 afterCheck(()=>answers[0],()=>answers[1],()=>json({error:'لا تملك صلاحية.'},403));
 eq(await O.flushOutbox(rep),{synced:0,blocked:3,pending:1},'two held and the sync goes on; a 403 is held and stops it');
 const held=id=>{const entry=job('rep-1:visit:'+id);return [entry.status,entry.message,entry.httpStatus,entry.answer];};
 eq(held(K(60)),['blocked','العميل لم يعد متاحًا.',404,{code:'CUSTOMER_UNAVAILABLE'}],'the server\'s words, its status and its known code (a malformed duplicate is dropped)');
 eq(held(K(61)),['blocked','تم حفظ هذه المتابعة بالفعل.',409,{code:'DUPLICATE',duplicate:{id:'customer-followup-old',date:'2026-11-20'}}],'a duplicate keeps the record it repeats, nothing else of the body');
 eq(held(K(62))[0],'blocked','the 403');
 eq([job('rep-1:visit:'+K(63)).status,job('rep-1:visit:'+K(63)).attempts,posts().length],['pending',0,3],'the entry after a 403 is not sent');
 eq((await O.flushOutbox(rep)).synced,1,'the next sync sends it (the held ones are not released: the server refused them)');
 eq(held(K(60))[0],'blocked','still held');
 await fresh();tick();await submit('visit',K(64));tick();await submit('visit',K(65));navigator.onLine=true;
 afterCheck(()=>json({error:'سجّل الدخول للوصول إلى التطبيق.'},401));
 eq(await O.flushOutbox(rep),{synced:0,blocked:0,pending:0},'a 401 on a send: the device session closes, so nothing is listed');
 eq([job('rep-1:visit:'+K(64)).status,job('rep-1:visit:'+K(64)).httpStatus,job('rep-1:visit:'+K(65)).status,posts().length],['blocked',401,'pending',1],'the entry is held, the next one is not sent');
 eq([await S.loadOfflineSnapshot(),meta('session')],[null,undefined],'and nothing of the member is shown until they sign in again');
 // Mended 2026-11-23 (found by the unit tests): the entry held by the 401 carries the server's words, not SIGN_IN_AGAIN, and stayed held
 // after the same member signed in again. It goes back to the queue now, and the one behind it follows.
 await S.lockOfflineSession();await S.saveOfflineSnapshot(snapshotOf(rep));
 eq(await O.flushOutbox(rep),{synced:2,blocked:0,pending:0},'after the same member signs in again: the entry the 401 held is sent, then the next');
 eq([job('rep-1:visit:'+K(64)),job('rep-1:visit:'+K(65))],[undefined,undefined],'both left the outbox');
});

await counted('the account at the start of a sync',async()=>{
 const prepare=async()=>{await fresh();tick();await submit('visit',K(70),{language:'en'});tick();await submit('followup',K(71));navigator.onLine=true;};
 await prepare();server.queue.push(()=>json({error:'سجّل الدخول للوصول إلى التطبيق.'},401));
 eq(await O.flushOutbox(rep),{synced:0,blocked:0,pending:0},'signed out on the server: nothing is sent');
 eq([job('rep-1:visit:'+K(70)).message,job('rep-1:followup:'+K(71)).message,job('rep-1:visit:'+K(70)).httpStatus,posts().length],[R.SIGN_IN_AGAIN[1],R.SIGN_IN_AGAIN[0],401,0],'each entry asks to sign in with the same account, in its language');
 eq([meta('session'),await S.loadOfflineSnapshot()],[undefined,null],'the device session is closed');
 await S.lockOfflineSession();await S.saveOfflineSnapshot(snapshotOf(rep));
 eq(await O.flushOutbox(rep),{synced:2,blocked:0,pending:0},'after the same member signs in, the held entries go back to the queue and are sent');
 for(const [name,answer] of [['403 page',()=>html(403)],['503',()=>json({error:'x'},503)],['no network',()=>{throw new TypeError('Failed to fetch');}]]){
  await prepare();server.queue.push(answer);
  eq([await O.flushOutbox(rep),posts().length,!!meta('session'),job('rep-1:visit:'+K(70)).status],[{synced:0,blocked:0,pending:2},0,true,'pending'],'an account check that was not answered changes nothing: '+name);
 }
 await prepare();server.member=peer;
 eq([await O.flushOutbox(rep),posts().length,meta('session'),job('rep-1:visit:'+K(70)).status],[{synced:0,blocked:0,pending:0},0,undefined,'pending'],'the browser is signed in as another member: the device session closes and nothing is sent or held');
 await prepare();server.queue.push(()=>json({me:rep,records:'x',members:[]}));
 await O.flushOutbox(rep);
 eq([job('rep-1:visit:'+K(70)).status,job('rep-1:visit:'+K(70)).message,meta('session')],['blocked',R.SIGN_IN_AGAIN[1],undefined],'an answer that does not confirm the account is treated as signed out');
 await prepare();server.queue.push(()=>json(snapshotOf({...rep,active:0})));
 await O.flushOutbox(rep);eq(job('rep-1:visit:'+K(70)).status,'blocked','and so is a deactivated member');
 // Access changed (a new role): every entry is held for review, the new snapshot kept; a retry sends it under the new access.
 await prepare();const promoted={...rep,role:'supervisor',authVersion:4};server.member=promoted;
 eq(await O.flushOutbox(rep),{synced:0,blocked:2,pending:0},'changed access: held, not sent');
 eq([job('rep-1:visit:'+K(70)).message,job('rep-1:visit:'+K(70)).httpStatus,(await S.loadOfflineSnapshot()).me.role,posts().length],['Account permissions changed. Review the entries and retry each record.',403,'supervisor',0],'the member reviews each entry; the new access is kept');
 eq((await O.retryOutbox('rep-1:visit:'+K(70),promoted)).synced,1,'a retry sends it under the new access');
 eq([idb.get(DB,'receipts','rep-1:visit:'+K(70)).ownerStamp,job('rep-1:followup:'+K(71)).status],[S.offlineOwner(promoted).stamp,'blocked'],'only that one');
 // An entry recorded under the earlier access while the device already holds the new one.
 await fresh();await S.saveOfflineSnapshot(snapshotOf(rep));tick();await submit('visit',K(72));
 const newer={...rep,authVersion:5};await S.lockOfflineSession();await S.saveOfflineSnapshot(snapshotOf(newer));server.member=newer;navigator.onLine=true;
 eq(await O.flushOutbox(newer),{synced:0,blocked:1,pending:0},'an entry of the earlier access is held');
 eq(job('rep-1:visit:'+K(72)).message,'تغيّرت صلاحيات الحساب منذ تسجيل البيانات. راجعها وأعد المحاولة.','with its reason');
 await rejects(O.retryOutbox('rep-1:visit:'+K(72),rep),/افتح التطبيق/,'not retried under the earlier access');
 eq((await O.retryOutbox('rep-1:visit:'+K(72),newer)).synced,1,'retried and sent under the current one');
 await rejects(O.retryOutbox('rep-1:visit:missing',newer),/السجل غير متاح لهذا الحساب/,'a retry of an entry that is not there');
});

await counted('lease, tabs and sign-out',async()=>{
 await fresh();tick();await submit('visit',K(80));tick();await submit('visit',K(81));navigator.onLine=true;
 idb.put(DB,'meta',{key:S.SYNC_LEASE_KEY,token:'another-tab',expires:clock+90000});
 eq([await O.flushOutbox(rep),server.calls.length],[{synced:0,blocked:0,pending:2},0],'another tab is sending: this one asks nothing');
 idb.put(DB,'meta',{key:S.SYNC_LEASE_KEY,token:'another-tab',expires:clock});
 const seen=[],stop=O.subscribeOutboxDraining(()=>seen.push(O.outboxDraining()));
 afterCheck(call=>{seen.push('sending:'+O.outboxDraining()+':'+JSON.stringify(meta(S.SYNC_LEASE_KEY)?.expires));return server.answer(call);});
 const one=O.flushOutbox(rep),two=O.flushOutbox(rep);
 eq(one===two,true,'callers share one sync');
 eq(await one,{synced:2,blocked:0,pending:0},'an expired lease is taken over');
 eq([seen,gets().length],[[true,'sending:true:'+(clock+90000),false],2],'«sending now» while the lease (90 s) is held, once, and one account check');
 stop();await fresh();tick();await submit('visit',K(82));navigator.onLine=true;await O.flushOutbox(rep);eq(seen.length,3,'an unsubscribed listener hears nothing more');
 eq(meta(S.SYNC_LEASE_KEY),undefined,'the lease is given back');

 // Another tab takes the lease while this one waited more than 90 s: this tab stops and leaves the other tab's lease alone.
 await fresh();tick();await submit('visit',K(83));tick();await submit('visit',K(84));navigator.onLine=true;
 afterCheck(call=>{clock+=91000;idb.put(DB,'meta',{key:S.SYNC_LEASE_KEY,token:'another-tab',expires:clock+90000});return server.answer(call);});
 eq(await O.flushOutbox(rep),{synced:1,blocked:0,pending:1},'the first is acknowledged, the second left to the other tab');
 eq([posts().length,meta(S.SYNC_LEASE_KEY).token],[1,'another-tab'],'the other tab\'s lease is not removed');
 idb.delete(DB,'meta',S.SYNC_LEASE_KEY);

 // Only entries that need review and none to release: no request and no lease.
 await fresh();tick();await submit('visit',K(85));navigator.onLine=true;afterCheck(()=>json({error:'اختر نتيجة الزيارة.'},400));await O.flushOutbox(rep);
 server.calls.length=0;
 const writes=idb.stats.writes;
 eq([await O.flushOutbox(rep),server.calls.length],[{synced:0,blocked:1,pending:0},0],'nothing to send: no request');
 eq(idb.stats.writes,writes,'and no lease written (deleting stays open)');

 // A sign-out asked during a sync: the next entry is not sent and nothing more is kept for the member.
 await fresh();tick();await submit('visit',K(86));tick();await submit('visit',K(87));navigator.onLine=true;
 afterCheck(call=>{storage.map.set(LOGOUT,'1');server.member={...rep,name:'اسم تغيّر'};return server.answer(call);});
 eq(await O.flushOutbox(rep),{synced:1,blocked:0,pending:0},'one sent before the sign-out; the rest is not listed any more');
 eq([posts().length,job('rep-1:visit:'+K(87)).status,idb.get(DB,'snapshots','rep-1').snapshot.me.name],[1,'pending','مندوب الرياض'],'the second waits on the device and the refreshed snapshot is not kept');
 storage.map.delete(LOGOUT);

 // The next member on the same device: their sync sends their entries only, never the first member's with their session.
 await fresh();tick();await submit('visit',K(88));
 storage.map.set(LOGOUT,'1');await S.lockOfflineSession();storage.map.delete(LOGOUT);
 await S.saveOfflineSnapshot(snapshotOf(peer));server.member=peer;tick();await submit('visit',K(89),{},peer);navigator.onLine=true;
 eq(await O.flushOutbox(rep),{synced:0,blocked:0,pending:0},'a sync asked for the first member under the second\'s session does nothing');
 eq(server.calls.length,0,'not even the account check');
 eq(await O.flushOutbox(peer),{synced:1,blocked:0,pending:0},'the second member\'s own sync');
 eq([posts().map(call=>JSON.parse(call.body).offline.memberId),job('rep-1:visit:'+K(88)).status],[['rep-2'],'pending'],'sends only their entry; the first member\'s stays on the device, untouched');
 await rejects(O.retryOutbox('rep-1:visit:'+K(88),peer),/السجل غير متاح لهذا الحساب/,'nor can the second member retry it');
 // A tab opened afterwards works on the same queue.
 const other=await tab();tick();navigator.onLine=false;await other.O.offlineSubmit('/api/visits',bodies.visit(K(90)),{me:peer,label:'x'});navigator.onLine=true;
 eq((await O.flushOutbox(peer)).synced,1,'an entry kept by another tab is sent by this one');
});

await counted('dependencies and attachments',async()=>{
 await fresh();
 tick();const customer=await submit('customer',K(100));
 tick();await submit('visit',K(101),{body:bodies.visit(K(101),customer.id)});
 tick();const file=await O.uploadOfflineVisitFile(new File(['%PDF-1.7 عرض'],'عرض المنافس.pdf',{type:'application/pdf'}),{me:rep,customerId:customer.id,uploadKey:K(102)});
 tick();await submit('visit',K(103),{body:bodies.visit(K(103),'crm-existing',{competitorObservation:{competitorFileId:file.id}})});
 eq(file,{ok:true,id:'local-file:'+K(102),name:'عرض المنافس.pdf',queued:true},'an attachment kept offline answers its local id');
 navigator.onLine=true;
 eq(await O.flushOutbox(rep),{synced:4,blocked:0,pending:0},'all four sent');
 eq(posts().map(call=>call.url),['/api/crm','/api/visits','/api/visit-files','/api/visits'],'in the order they were recorded: the customer before what is recorded on it');
 const form=posts()[2].body;
 eq([form.get('file').name,form.get('customerId'),form.get('uploadKey'),form.get('memberId')],['عرض المنافس.pdf',customer.id,K(102),'rep-1'],'the attachment is sent with its customer, its key and the member');
 eq(JSON.parse(posts()[3].body).data.competitorObservation.competitorFileId,'file-'+K(102).slice(-4),'the visit names the attachment by its server id');
 eq([server.saved.size,server.files.size,receipts().length],[3,1,4],'each sent once');

 // The customer is refused: what is recorded on it waits for review, and comes back once the customer is corrected.
 await fresh();
 tick();const second=await submit('customer',K(110));
 tick();await submit('visit',K(111),{body:bodies.visit(K(111),second.id)});
 tick();const photo=await O.uploadOfflineVisitFile(new File([new Uint8Array([255,216,255,224,0,16])],'صورة.jpg'),{me:rep,customerId:second.id,uploadKey:K(112),language:'en'});
 tick();await submit('visit',K(113),{body:bodies.visit(K(113),'crm-existing',{competitorFileId:photo.id})});
 tick();await submit('visit',K(114),{body:bodies.visit(K(114),'crm-existing',{competitorFileId:'local-file:'+K(199)})});
 navigator.onLine=true;
 afterCheck(()=>json({error:'موقع العميل خارج حدود المملكة العربية السعودية. اختر نقطة داخلها.'},400));
 eq(await O.flushOutbox(rep),{synced:0,blocked:5,pending:0},'nothing sent: the customer is refused and the rest waits behind it');
 const state=id=>{const entry=job(id);return [entry.status,entry.httpStatus,entry.message];};
 eq(state('rep-1:visit:'+K(111)),['blocked',424,R.WAITS_FOR_CUSTOMER[0]],'the visit on it waits for the customer');
 eq(state('rep-1:file:'+K(112)),['blocked',424,R.WAITS_FOR_CUSTOMER[1]],'so does the attachment on it (in its language)');
 eq(state('rep-1:visit:'+K(113)),['blocked',424,R.WAITS_FOR_ATTACHMENT[0]],'a visit naming that attachment waits for it');
 eq(state('rep-1:visit:'+K(114)),['blocked',424,R.WAITS_FOR_ATTACHMENT[0]],'a visit naming an attachment the device does not have is held');
 eq(posts().length,1,'only the customer was sent');
 await rejects(O.relocateOfflineCustomer('rep-1:customer:'+K(110),rep,{location:'   '}),error=>error.message==='أدخل موقع العميل أو اختره على الخريطة.','a place is required');
 await rejects(O.relocateOfflineCustomer('rep-1:customer:'+K(110),rep,{location:'30.0444, 31.2357'}),/خارج حدود المملكة/,'and checked by the server\'s rules first');
 await rejects(O.relocateOfflineCustomer('rep-1:customer:'+K(110),rep,{location:'الرياض'}),/أدخل اللوكيشن كخط عرض/,'a place that is not coordinates');
 eq(JSON.parse(job('rep-1:customer:'+K(110)).body).data.location,'24.7136, 46.6753','a refused move changes nothing');
 const customerCaptured=job('rep-1:customer:'+K(110)).capturedAt;
 const fields={location:'26.4207, 50.0888',latitude:null,longitude:null,locationSource:undefined,locationCapturedAt:undefined,locationAccuracy:undefined,city:'الدمام',shortAddress:'RDAB1234',name:'اسم آخر'};
 eq((await O.relocateOfflineCustomer('rep-1:customer:'+K(110),rep,fields)).synced,4,'moved and retried: the customer, the visit, the attachment and the visit naming it are sent');
 const sentCustomer=JSON.parse(posts().find(call=>call.url==='/api/crm'&&posts().indexOf(call)>0).body);
 eq([sentCustomer.data.location,sentCustomer.data.city,sentCustomer.data.shortAddress,sentCustomer.data.latitude,sentCustomer.data.name,'locationSource' in sentCustomer.data,sentCustomer.offline.capturedAt],['26.4207, 50.0888','الدمام','RDAB1234',null,'مصنع الريان',false,customerCaptured],'only the place changes; the name and the device time stay');
 eq(state('rep-1:visit:'+K(114))[0],'blocked','the visit naming a missing attachment stays held');

 // A visit recorded before the customer it names (order of the queue): it waits, unheld, and goes at the next sync.
 await fresh();
 const later=new NativeDate(clock+120000).toISOString(),earlier=new NativeDate(clock+60000).toISOString(),owner=S.offlineOwner(rep);
 const kept=(kind,key,body,createdAt)=>({id:'rep-1:'+kind+':'+key,ownerId:'rep-1',owner,kind,label:kind,status:'pending',message:'',createdAt,capturedAt:createdAt,localId:kind==='customer'?'crm-rep-1-'+key:'customer-visit-'+key,url:urls[kind],body:JSON.stringify({...JSON.parse(body),offline:{memberId:'rep-1',capturedAt:createdAt}}),fingerprint:'f',language:'ar',attempts:0});
 idb.put(DB,'outbox',kept('visit',K(121),bodies.visit(K(121),'crm-rep-1-'+K(120)),earlier));idb.put(DB,'outbox',kept('customer',K(120),bodies.customer(K(120)),later));
 navigator.onLine=true;
 eq(await O.flushOutbox(rep),{synced:1,blocked:0,pending:1},'the customer is sent; the visit before it waits');
 eq([job('rep-1:visit:'+K(121)).status,job('rep-1:visit:'+K(121)).message],['pending',''],'not held');
 eq((await O.flushOutbox(rep)).synced,1,'and is sent next time');

 // The body sent is frozen once its attachment is resolved: a retry after a cut sends exactly the same bytes.
 await fresh();tick();const pdf=await O.uploadOfflineVisitFile(new File(['%PDF-1.4'],'a.pdf'),{me:rep,customerId:'crm-existing',uploadKey:K(130)});
 tick();await submit('visit',K(131),{body:bodies.visit(K(131),'crm-existing',{competitorFileId:pdf.id})});navigator.onLine=true;
 afterCheck(call=>server.answer(call),()=>{throw new TypeError('Failed to fetch');});
 await O.flushOutbox(rep);
 const frozen=job('rep-1:visit:'+K(131)).wireBody;
 ok(JSON.parse(frozen).data.competitorFileId==='file-'+K(130).slice(-4),'the body to send is kept with the server id');
 await O.flushOutbox(rep);
 eq(posts().filter(call=>call.url==='/api/visits').map(call=>call.body),[frozen,frozen],'sent twice, the same bytes');
});

await counted('attachments',async()=>{
 await fresh();
 const upload=(file,options={})=>{tick(1000);return O.uploadOfflineVisitFile(file,{me:rep,customerId:'crm-existing',...options});};
 await rejects(upload(new File(['%PDF-1.4'],'a.pdf'),{customerId:''}),error=>error.message==='اختر العميل أولًا.','a customer first');
 const size='ارفع ملف PDF أو صورة JPEG أو PNG أو WebP بحجم لا يزيد عن 10 ميجابايت.';
 await rejects(upload(new File([],'a.pdf')),error=>error.message===size,'an empty file');
 await rejects(upload(new File([new Uint8Array(10*1024*1024+1)],'big.pdf')),error=>error.message===size,'over 10 MB');
 const type='الملف ليس PDF أو صورة مدعومة.';
 for(const [name,bytes] of [['text',new TextEncoder().encode('hello world!!')],['gif',new TextEncoder().encode('GIF89a......')],['wave',new TextEncoder().encode('RIFF\0\0\0\0WAVEfmt ')],['pdf late',new TextEncoder().encode(' %PDF-1.4')],['png cut',new Uint8Array([137,80,78,71,13,10,26])],['jpeg cut',new Uint8Array([255,216,254,0])]])
  await rejects(upload(new File([bytes],'x.pdf')),error=>error.message===type,'not a supported file by its first bytes: '+name);
 const big=new Uint8Array(10*1024*1024);big.set(new TextEncoder().encode('%PDF-1.4'));
 for(const [name,bytes,key] of [['pdf',new TextEncoder().encode('%PDF-1.4 x'),K(140)],['jpeg',new Uint8Array([255,216,255,219,1]),K(141)],['png',new Uint8Array([137,80,78,71,13,10,26,10,0]),K(142)],['webp',new TextEncoder().encode('RIFF\x10\0\0\0WEBPVP8 '),K(143)],['exactly 10 MB',big,K(144)]])
  eq((await upload(new File([bytes],'f'),{uploadKey:key})).queued,true,'accepted by its first bytes: '+name);
 eq(server.calls,[],'nothing sent offline');
 eq((await upload(new File(['%PDF-1.4'],'a\u0000b\u001f\u007fc.pdf'),{uploadKey:K(145)})).name,'abc.pdf','control characters are taken out of the name');
 eq((await upload(new File(['%PDF-1.4'],'\u0001\u0002'),{uploadKey:K(146)})).name,'عرض المنافس','a name with nothing left is «عرض المنافس»');
 eq((await upload(new File(['%PDF-1.4'],'ع'.repeat(250)+'.pdf'),{uploadKey:K(147)})).name.length,200,'a name is cut at 200 characters');
 const entry=job('rep-1:file:'+K(140));
 eq([entry.kind,entry.url,entry.fingerprint,entry.uploadKey,entry.customerId,entry.fileName,entry.label,entry.localId,entry.blob instanceof Blob,entry.body],['file','/api/visit-files',K(140),K(140),'crm-existing','f','f','local-file:'+K(140),true,undefined],'the attachment kept with its bytes, its key and its customer');
 const count=outbox().length;
 eq((await upload(new File(['%PDF-1.4 again'],'f'),{uploadKey:K(140)})).id,'local-file:'+K(140),'the same key again (a retry of the same file) is the same entry');
 eq(outbox().length,count,'not a second one');
 const random=await upload(new File(['%PDF-1.4'],'r.pdf'));
 ok(/^local-file:[0-9a-f-]{36}$/.test(random.id),'without a key the device makes one');
 navigator.onLine=true;afterCheck(()=>json({ok:true,id:'file-x'}));
 await O.flushOutbox(rep);
 eq([job('rep-1:file:'+K(140)).status,job('rep-1:file:'+K(140)).message],['pending','محفوظ على الجهاز؛ في انتظار الاتصال لإكمال الرفع.'],'an upload answered without the file\'s name is not taken as saved');
 await O.flushOutbox(rep);
 const online=await upload(new File(['%PDF-1.4'],'online.pdf'),{uploadKey:K(148)});
 eq(online,{ok:true,id:'file-'+K(148).slice(-4),name:'online.pdf',queued:false},'online: the server\'s id and name');
 await S.lockOfflineSession();
 await rejects(upload(new File(['%PDF-1.4'],'x.pdf'),{uploadKey:K(149)}),/افتح التطبيق/,'not kept without a device session');
});

await counted('completing, moving and retrying',async()=>{
 await fresh();tick();await submit('visit',K(150));const createdAt=job('rep-1:visit:'+K(150)).capturedAt;navigator.onLine=true;
 afterCheck(()=>json({error:'أدخل نتيجة الزيارة والإجراء التالي.'},400));
 await O.flushOutbox(rep);
 eq(O.offlineEntryFields(job('rep-1:visit:'+K(150))),JSON.parse(bodies.visit(K(150))).data,'the fields of a kept visit');
 tick(3600000);
 eq((await O.completeOfflineEntry('rep-1:visit:'+K(150),rep,{result:'  تم الاتفاق على عينة  ',nextAction:'\tإرسال عرض\n',nextDate:'2026-11-30',type:'call',summary:7})).synced,1,'completed on the device and sent');
 const sent=JSON.parse(posts().at(-1).body),kept=idb.get(DB,'receipts','rep-1:visit:'+K(150));
 eq([sent.data.result,sent.data.nextAction,sent.data.nextDate,sent.data.type,sent.offline.capturedAt,sent.createKey],['تم الاتفاق على عينة','إرسال عرض','2026-11-30','visit',createdAt,K(150)],'only the three fields change, trimmed; the key and the device time stay');
 const {offline:_drop,...input}=sent;void _drop;
 eq(kept.fingerprint,sha('/api/visits\n'+JSON.stringify(input)),'its fingerprint is the corrected body');
 await fresh();tick();await submit('service',K(151));navigator.onLine=true;afterCheck(()=>json({error:'أدخل النتيجة.'},400));await O.flushOutbox(rep);
 eq((await O.completeOfflineEntry('rep-1:service:'+K(151),rep,{result:'تم'})).synced,1,'a service registration too');
 eq(JSON.parse(posts().at(-1).body).registration,{subject:'صيانة قالب',result:'تم'},'in its registration');
 await fresh();tick();await submit('visit',K(152));tick();await submit('customer',K(153));
 for(const [id,why] of [['rep-1:visit:'+K(152),'waiting to be sent'],['rep-1:customer:'+K(153),'a customer'],['rep-1:visit:missing','not there']])
  await rejects(O.completeOfflineEntry(id,rep,{result:'x'}),/السجل غير متاح لهذا الحساب/,'not completed: '+why);
 idb.put(DB,'outbox',{...job('rep-1:visit:'+K(152)),status:'blocked',archivedAt:'2026-11-22T06:00:00.000Z'});
 await rejects(O.completeOfflineEntry('rep-1:visit:'+K(152),rep,{result:'x'}),/السجل غير متاح لهذا الحساب/,'not completed: archived');
 await rejects(O.relocateOfflineCustomer('rep-1:customer:'+K(153),rep,{location:'24.7, 46.7'}),/السجل غير متاح لهذا الحساب/,'a customer waiting to be sent is not moved');
 idb.put(DB,'outbox',{...job('rep-1:visit:'+K(152)),archivedAt:undefined});
 await rejects(O.relocateOfflineCustomer('rep-1:visit:'+K(152),rep,{location:'24.7, 46.7'}),/السجل غير متاح لهذا الحساب/,'a visit is not a customer');
 eq([O.offlineEntryFields({kind:'customer',body:bodies.customer(K(1))}),O.offlineEntryFields({kind:'visit',body:'{'}),O.offlineEntryFields({kind:'visit',body:JSON.stringify({data:'x'})}),O.offlineEntryFields({kind:'visit'}),O.offlineEntryFields({kind:'service',body:JSON.stringify({registration:[]})})],[null,null,null,null,null],'nothing to complete: a customer, a broken body, no fields');
 // A place taken by the phone is kept with its capture; the server's rule on the capture time is left to the server.
 await fresh();tick();await submit('customer',K(154));navigator.onLine=true;afterCheck(()=>json({error:'موقع العميل خارج حدود المملكة العربية السعودية. اختر نقطة داخلها.'},400));await O.flushOutbox(rep);
 const device={location:'21.5433, 39.1728',latitude:21.5433,longitude:39.1728,locationSource:'device',locationCapturedAt:new NativeDate(clock+3600000).toISOString(),locationAccuracy:15};
 eq((await O.relocateOfflineCustomer('rep-1:customer:'+K(154),rep,device)).synced,1,'a place of the phone, even with a capture time ahead of the device clock');
 eq(JSON.parse(posts().at(-1).body).data.locationSource,'device','sent with its source');
 await fresh();tick();await submit('customer',K(155));navigator.onLine=true;afterCheck(()=>json({error:'x'},400));await O.flushOutbox(rep);
 await rejects(O.relocateOfflineCustomer('rep-1:customer:'+K(155),rep,{...device,latitude:21.6}),/تغيّر اللوكيشن بعد التقاطه/,'a phone place whose coordinates were edited is refused');
});

await counted('the server reads the device time',async()=>{
 globalThis.testEnv={};
 const side=compiler('offline-submit-unit-server-');side.compile('lib/offline-server.ts');
 const V=await side.load('lib/offline-server.mjs'),{CRMError}=await side.load('lib/crm-server.mjs');
 await fresh();await submit('visit',K(160));
 const body=JSON.parse(job('rep-1:visit:'+K(160)).body),arrived=new NativeDate(clock+30000).toISOString();
 eq(V.offlineCapture(body,'rep-1',arrived),{capturedAt:new NativeDate(clock).toISOString(),receivedAt:arrived},'what the device keeps is what the server accepts');
 const received='2026-11-22T06:00:30.000Z';
 eq(V.offlineCapture({createKey:K(1)},'rep-1',received),null,'a save made online has no device time');
 const refused=(offline,memberId,status,pattern,message)=>{assert.throws(()=>V.offlineCapture({offline},memberId,received),error=>error instanceof CRMError&&error.status===status&&pattern.test(error.message),message);checks++;};
 refused(body.offline,'rep-2',403,/تخص حسابًا آخر/,'another member\'s entry');
 for(const value of [null,'rep-1',[],{capturedAt:body.offline.capturedAt}])refused(value,'rep-1',403,/تخص حسابًا آخر/,'not an entry of this member: '+JSON.stringify(value));
 const at=capturedAt=>({memberId:'rep-1',capturedAt});
 for(const value of ['٢٠٢٦-١١-٢٢T06:00:00.000Z','‎2026-11-22T06:00:00.000Z','2026-11-22T06:00:00.000Z‏','2026-11-22 06:00:00Z','2026-11-22T06:00:00+03:00','2026-11-22T06:00:00.0000Z','2026-11-22',' 2026-11-22T06:00:00Z','',1763791200000,'2026-11-22T06:01:30.001Z'])
  refused(at(value),'rep-1',400,/وقت التسجيل على الجهاز غير صحيح/,'a device time refused: '+JSON.stringify(value));
 refused(at('2026-02-29T10:00:00.000Z'),'rep-1',400,/^وقت التسجيل على الجهاز غير صحيح\.$/,'a day that does not exist (29 February 2026)');
 eq(V.offlineCapture({offline:at('2026-11-22T06:01:30.000Z')},'rep-1',received).capturedAt,'2026-11-22T06:01:30.000Z','up to one minute ahead of the server is accepted');
 eq(V.offlineCapture({offline:at('2026-11-22T05:00:00.5Z')},'rep-1',received).capturedAt,'2026-11-22T05:00:00.500Z','written as the server writes it');
 eq(V.offlineCapture({offline:at('2024-02-29T10:00:00Z')},'rep-1',received).capturedAt,'2024-02-29T10:00:00.000Z','29 February of a leap year');
 const capture=V.offlineCapture(body,'rep-1',arrived);
 eq(V.offlineEvidence(capture),{offlineRecordedAt:capture.capturedAt,receivedAt:arrived,recordingTimeSource:'device'},'recorded on the device');
 eq(V.offlineEvidence(null,{offlineRecordedAt:'2026-11-01T00:00:00.000Z',receivedAt:'2026-11-01T01:00:00.000Z',recordingTimeSource:'device'}),{offlineRecordedAt:'2026-11-01T00:00:00.000Z',receivedAt:'2026-11-01T01:00:00.000Z',recordingTimeSource:'device'},'an edit made online keeps the earlier device time');
 eq([V.offlineEvidence(null),V.offlineEvidence(null,{receivedAt:'x'})],[{},{}],'never recorded on a device');
 const gone=V.unavailableRefusal('العميل لم يعد متاحًا.',404,'customer'),closed=V.unavailableRefusal('الفرصة مغلقة.',409,'opportunity');
 eq([gone.status,gone.extra,closed.status,closed.extra],[404,{code:'CUSTOMER_UNAVAILABLE'},409,{code:'OPPORTUNITY_UNAVAILABLE'}],'the record is no longer the member\'s');
 const twin=V.duplicateRefusal('تم حفظ هذه المتابعة بالفعل.',{id:'customer-followup-1',data:{},createdAt:'2026-11-21T21:30:00.000Z'});
 eq([twin.status,twin.extra],[409,{code:'DUPLICATE',duplicate:{id:'customer-followup-1',date:'2026-11-22'}}],'a duplicate names its record and its Riyadh day');
 eq(R.offlineAnswerOf({error:twin.message,...twin.extra}),{code:'DUPLICATE',duplicate:{id:'customer-followup-1',date:'2026-11-22'}},'which the device keeps as it is');
 eq(V.duplicateRefusal('x').extra,{code:'DUPLICATE'},'a duplicate whose record is not named');
});

// Found by an independent mutation review (2026-11-22): a send that fails on the network stops the sync, so a later entry never overtakes
// an earlier one; and a member never completes another member's entry kept on the same device (its body stays as it was).
await counted('order after a failure, and another member\'s entry',async()=>{
 await fresh();tick();await submit('visit',K(160));tick();await submit('visit',K(161));navigator.onLine=true;
 afterCheck(()=>html(503));
 eq(await O.flushOutbox(rep),{synced:0,blocked:0,pending:2},'the first send fails on the network: nothing more is sent in this sync');
 eq([posts().length,job('rep-1:visit:'+K(161)).attempts],[1,0],'the second entry was not tried before the first');
 eq((await O.flushOutbox(rep)).synced,2,'the next sync sends both, in order');
 eq(posts().slice(1).map(call=>JSON.parse(call.body).createKey),[K(160),K(161)],'the earlier one first');
 await fresh();tick();await submit('visit',K(162));navigator.onLine=true;
 afterCheck(()=>json({error:'أدخل نتيجة الزيارة والإجراء التالي.'},400));await O.flushOutbox(rep);
 const before=job('rep-1:visit:'+K(162));eq(before.status,'blocked','held for review');
 storage.map.set(LOGOUT,'1');await S.lockOfflineSession();storage.map.delete(LOGOUT);
 await S.saveOfflineSnapshot(snapshotOf(peer));server.member=peer;
 await rejects(O.completeOfflineEntry('rep-1:visit:'+K(162),peer,{result:'من عضو آخر'}),/السجل غير متاح لهذا الحساب/,'another member cannot complete it');
 eq([job('rep-1:visit:'+K(162)).body,job('rep-1:visit:'+K(162)).fingerprint],[before.body,before.fingerprint],'and its kept body is untouched');
});

eq(idb.stats.callbackErrors,[],'no storage callback threw');
console.log(JSON.stringify({ok:true,checks,counts,realBrowser:false,network:'stand-in server (request key once)',storage:'scripts/lib/fake-browser-storage.mjs',clock:'fixed'}));
