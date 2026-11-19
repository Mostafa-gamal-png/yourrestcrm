// «الإدخالات الواقفة على الجهاز» (the owner, 2026-11-19, from GSCO 2.13.84 and 2.13.81; lib/offline-review.ts) without a build: the rules on
// plain objects and the real follow-ups route compiled as the build does, on a migrated in-memory SQLite; the clock is fixed. Synthetic data.
// 1. Which entries may be deleted from the device, and what goes with them (the entries that need them, however far, and the attachments
//    only they name; archived ones too).
// 2. Which entries a sync releases: those held by an answer that was not the server's (a proxy page, an HTML 404 or 413, JSON without its
//    error), or by an ended session, and those that waited behind them; a real refusal stays. The device's own words are the ones
//    lib/client-submit.ts writes, and a non-JSON answer is marked so (never the server's refusal).
// 3. What a review says by the server's answer: the duplicate (with its day from the server or from the device's copy), the customer or the
//    opportunity no longer available (its code, or the route's own words, held to each route), nothing for anything else; the texts in
//    Arabic and English; the customer registered at the same place.
// 4. The route (POST /api/customer-followups): a follow-up saved twice is refused with the member's own follow-up it repeats (its id and
//    day), never another member's; the customer and the opportunity no longer available carry their codes; a save as before.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

// 09:00 in Riyadh on Thursday 19 November 2026.
const NativeDate=Date;let clock=NativeDate.parse('2026-11-19T06:00:00.000Z');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'offline-stuck-')),seen=new Set();
process.on('exit',()=>{globalThis.Date=NativeDate;fs.rmSync(out,{recursive:true,force:true});});
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const id=globalThis.testIdentity;if(!id)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version,email FROM crm_members WHERE id=?').bind(id).first();return {memberId:m?.id,memberVersion:m?.auth_version,email:m?.email,provider:'email-otp'};}`);
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let rel=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(rel))rel+=fs.existsSync(path.join(root,rel+'.ts'))?'.ts':'.tsx';
  compile(rel);return 'from '+JSON.stringify(path.join(out,rel.replace(/\.tsx?$/,'.mjs')));
 });fs.writeFileSync(dest,code);
}
for(const file of ['lib/offline-review.ts','lib/offline-submit.ts','lib/client-submit.ts','app/api/customer-followups/route.ts'])compile(file);
const load=file=>import(pathToFileURL(path.join(out,file)));
const R=await load('lib/offline-review.mjs'),S=await load('lib/offline-submit.mjs'),C=await load('lib/client-submit.mjs');
let checks=0;const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
const counts={};const counted=async(part,fn)=>{const before=checks;await fn();counts[part]=checks-before;};
const ARABIC=/[؀-ۿ]/;

// Entries as lib/offline-submit.ts keeps them (the fields the rules read).
let order=0;
const entry=(kind,key,fields={})=>{const at=new NativeDate(NativeDate.parse('2026-11-18T06:00:00.000Z')+(order++)*60000).toISOString();const localId=kind==='customer'?'crm-rep-'+key:kind==='visit'?'customer-visit-'+key:kind==='followup'?'customer-followup-'+key:kind==='file'?'local-file:'+key:'service-'+key;return {id:'rep:'+kind+':'+key,ownerId:'rep',kind,label:kind+' '+key,status:'pending',message:'',createdAt:at,capturedAt:at,localId,url:{customer:'/api/crm',visit:'/api/visits',followup:'/api/customer-followups',service:'/api/customer-service',file:'/api/visit-files'}[kind],fingerprint:key,language:'ar',attempts:0,...fields};};
const onCustomer=(customerId,data={},extra={})=>JSON.stringify({createKey:'k',customerId,data,...extra});
const ids=plan=>plan?[plan.root.id,...plan.also.map(item=>item.job.id)]:null;

await counted('delete',async()=>{
 const customer=entry('customer','n1',{status:'blocked',message:'موقع العميل خارج حدود المملكة العربية السعودية. اختر نقطة داخلها.',httpStatus:400,body:JSON.stringify({action:'save',kind:'customer',createKey:'n1',data:{name:'مصنع جديد'}})});
 const photo=entry('file','p1',{status:'blocked',message:'أكمل رفع العميل المرتبط أولًا.',httpStatus:424,customerId:customer.localId,fileName:'photo.jpg'});
 const visit=entry('visit','v1',{status:'blocked',message:'أكمل رفع العميل المرتبط أولًا.',httpStatus:424,body:onCustomer(customer.localId,{competitorFileId:photo.localId})});
 const service=entry('service','s1',{status:'pending',body:JSON.stringify({requestId:'s1',customerId:customer.localId,registration:{competitorFileId:'uploaded-elsewhere'}})});
 const archivedFollowup=entry('followup','f1',{status:'blocked',archivedAt:'2026-11-18T08:00:00.000Z',message:'x',httpStatus:409,body:onCustomer(customer.localId,{},{sourceId:'source-1'})});
 const other=entry('visit','v2',{status:'blocked',message:'اختر العميل',httpStatus:403,body:onCustomer('server-customer')});
 const sharedFile=entry('file','p2',{customerId:'server-customer',fileName:'quote.pdf'});
 const userA=entry('visit','v3',{status:'blocked',message:'x',httpStatus:400,body:onCustomer('server-customer',{competitorFileId:sharedFile.localId})});
 const userB=entry('followup','f2',{status:'pending',body:onCustomer('server-customer',{competitorObservation:{competitorFileId:sharedFile.localId}},{sourceId:'s'})});
 const ownFile=entry('file','p3',{customerId:'server-customer',fileName:'own.pdf'});
 const lone=entry('visit','v4',{status:'blocked',message:'x',httpStatus:400,body:onCustomer('server-customer',{competitorFileId:ownFile.localId})});
 const all=[customer,photo,visit,service,archivedFollowup,other,sharedFile,userA,userB,ownFile,lone];
 eq([customer,photo,archivedFollowup,service,{...service,status:'syncing'}].map(R.deletableOfflineEntry),[true,true,true,false,false],'only an entry that needs review (or an archived one) may be deleted');
 let plan=R.offlineDeletion(customer.id,all);
 eq(ids(plan),[customer.id,photo.id,visit.id,service.id,archivedFollowup.id],'a new customer takes every entry on it: the photo on it, the visit, the waiting opportunity and the archived follow-up');
 eq(plan.also.map(item=>item.attachment),[false,false,false,false],'all needed it (none is only an attachment)');
 plan=R.offlineDeletion(photo.id,all);eq(ids(plan),[photo.id,visit.id],'an attachment takes the visit that names it');
 plan=R.offlineDeletion(visit.id,all);eq([ids(plan),plan.also.map(item=>item.attachment)],[[visit.id,photo.id],[true]],'a visit takes its photo, named by no other entry');
 eq(ids(R.offlineDeletion(userA.id,all)),[userA.id],'an attachment another entry still names stays');
 eq(ids(R.offlineDeletion(lone.id,all)),[lone.id,ownFile.id],'a visit takes its own PDF');
 eq(ids(R.offlineDeletion(other.id,all)),[other.id],'an entry on a server customer takes nothing else');
 eq(R.offlineDeletion('missing',all),null,'an entry not there: nothing');
 // A follow-up on an opportunity that is itself an entry on the device (the rule is general, though the form follows only saved contacts).
 const source=entry('visit','v9',{status:'blocked',message:'x',httpStatus:400,body:onCustomer('server-customer')});
 const onIt=entry('followup','f9',{status:'pending',body:onCustomer('server-customer',{},{sourceId:source.localId})});
 eq(ids(R.offlineDeletion(source.id,[source,onIt])),[source.id,onIt.id],'a follow-up on an opportunity kept on the device goes with it');
 eq([...R.fileReferences({data:{competitorFileId:'local-file:a',competitorObservation:{competitorFileId:'local-file:b'}},registration:{competitorFileId:'uploaded-c'}})],['local-file:a','local-file:b'],'the attachments an entry names');
 eq([...R.entryFiles({kind:'visit',body:JSON.stringify({data:{summary:'local-file:not-an-attachment'}})})],[],'text that resembles a local id is not an attachment');
});

await counted('release',async()=>{
 // The device's own words for an answer that was not the server's, as lib/client-submit.ts writes them, and the mark on such an error.
 const failure=async(answer,language='ar')=>{const saved=globalThis.fetch;globalThis.fetch=async()=>answer;try{await C.submitJson('/api/visits',{method:'POST'},{language});}catch(e){return e;}finally{globalThis.fetch=saved;}};
 const html=status=>({ok:false,status,url:'',redirected:false,json:async()=>{throw new SyntaxError('Unexpected token <');}});
 const notAnswers=S.offlineNotAnswers();
 eq(notAnswers.length,6,'three local words, each in Arabic and English');
 for(const [status,language] of [[404,'ar'],[413,'ar'],[502,'en'],[403,'ar'],[401,'en'],[200,'ar']]){const e=await failure(html(status),language);eq([e.name,e.status,e.invalidResponse,e.body,notAnswers.includes(e.message)],['SubmitError',status,true,null,true],'a page that is not JSON ('+status+', '+language+'): marked and worded by the device');eq(S.isServerRefusal(e),false,'and never the server\'s refusal ('+status+')');}
 const noError=await failure({ok:false,status:404,json:async()=>({message:'Not Found'})});eq([noError.invalidResponse,notAnswers.includes(noError.message),S.isServerRefusal(noError)],[false,true,false],'JSON without its error: the device\'s words, retried');
 const refusal=await failure({ok:false,status:409,json:async()=>({error:'تم حفظ هذه المتابعة بالفعل. افتح تسجيل متابعة جديدة.',code:'DUPLICATE'})});eq([refusal.invalidResponse,refusal.status,S.isServerRefusal(refusal)],[false,409,true],'the server\'s own refusal holds the entry');
 eq(S.isServerRefusal(new C.SubmitError('انتهت جلسة الدخول.',401)),true,'a redirect to the sign-in page still ends the session as before');
 for(const status of [408,429,500,503,0])eq(S.isServerRefusal(new C.SubmitError('x',status,{error:'x'})),false,'retried: '+status);
 eq(S.isServerRefusal(new Error('x')),false,'not an answer at all');
 // What a sync releases.
 const held=(kind,key,message,status,extra={})=>entry(kind,key,{status:'blocked',message,httpStatus:status,...extra});
 const proxyPage=held('customer','c1',C.NOT_SERVER_ANSWER.invalid[0],404,{body:JSON.stringify({data:{name:'x'}})});
 const english=held('visit','v1',C.NOT_SERVER_ANSWER.invalid[1],413,{body:onCustomer('server-customer')});
 const behind=held('visit','v2','أكمل رفع العميل المرتبط أولًا.',424,{body:onCustomer(proxyPage.localId)});
 const signIn=held('followup','f1','سجّل الدخول بنفس الحساب لإكمال رفع البيانات المحفوظة.',401,{body:onCustomer('server-customer')});
 const real=held('customer','c2','لا يمكنك إنشاء أو نقل عميل خارج منطقتك المسموح بها',403,{body:JSON.stringify({data:{name:'y'}})});
 const behindReal=held('file','p1','أكمل رفع العميل المرتبط أولًا.',424,{customerId:real.localId});
 const archived=held('customer','c3',C.NOT_SERVER_ANSWER.session[0],403,{archivedAt:'2026-11-18T09:00:00.000Z',body:JSON.stringify({data:{name:'z'}})});
 const behindArchived=held('visit','v3','أكمل رفع العميل المرتبط أولًا.',424,{body:onCustomer(archived.localId)});
 const file=held('file','p2',C.NOT_SERVER_ANSWER.unsaved[0],400,{customerId:'server-customer'});
 const behindFile=held('visit','v4','يحتاج مرفق عرض السعر إلى المراجعة قبل رفع السجل.',424,{body:onCustomer('server-customer',{competitorFileId:file.localId})});
 const pending=entry('visit','v5',{body:onCustomer('server-customer')});
 const active=[proxyPage,english,behind,signIn,real,behindReal,behindArchived,file,behindFile,pending],all=[...active,archived];
 eq([...R.stuckToRelease(active,all,notAnswers)].sort(),[proxyPage.id,english.id,behind.id,signIn.id,file.id,behindFile.id].sort(),'released: the answers that were not the server\'s, the ended session, and what waited behind them only');
 eq(R.stuckToRelease([behind],[behind,{...proxyPage,status:'pending'}],notAnswers).has(behind.id),true,'one that waited behind a customer now waiting to be sent goes too');
 eq(R.stuckToRelease([behind],[behind],notAnswers).has(behind.id),true,'and behind one already sent (no longer on the device)');
});

await counted('review',async()=>{
 const me={id:'rep'},notAnswers=S.offlineNotAnswers();
 const twin={id:'customer-followup-first',kind:'activity',parentId:'c1',assignedTo:'rep',branch:'الرئيسي',data:{visitWorkflow:'followup-v1',sourceId:'c1-v',performedBy:'rep',date:'2026-11-17'},createdAt:'2026-11-17T07:00:00.000Z',updatedAt:'',version:1};
 const theirs={...twin,id:'customer-followup-sup',data:{...twin.data,performedBy:'sup',date:'2026-11-18'},createdAt:'2026-11-18T07:00:00.000Z'};
 const queued={...twin,id:'customer-followup-queued',data:{...twin.data,_offlineState:'pending',date:'2026-11-19'},createdAt:'2026-11-19T07:00:00.000Z'};
 const saved={id:'customer-visit-k9',kind:'activity',parentId:'c1',data:{date:'2026-11-16'},createdAt:'2026-11-16T10:00:00.000Z'};
 const customerRow={id:'crm-rep-n2',kind:'customer',parentId:null,data:{name:'مصنع النخيل',_createdBy:'rep'},createdAt:'2026-11-15T22:30:00.000Z'};
 const followup=(message,status,answer)=>({...entry('followup','f1',{status:'blocked',message,httpStatus:status,answer,body:onCustomer('c1',{},{sourceId:'c1-v'})})});
 const review=(job,records=[])=>R.offlineReview(job,records,me,notAnswers);
 eq(review(followup('تغيّرت بيانات العميل أو متابعته الأخيرة. حدّث البيانات ثم أعد المحاولة.',409,{code:'DUPLICATE',duplicate:{id:'customer-followup-first',date:'2026-11-17'}})),{kind:'duplicate',date:'2026-11-17',recordId:'customer-followup-first'},'the server\'s duplicate with its day');
 eq(review(followup('تغيّرت المتابعة السابقة. حدّث البيانات ثم أعد المحاولة.',409),[twin,theirs,queued]),{kind:'duplicate',date:'2026-11-17',recordId:twin.id},'an older server: the device\'s copy names the member\'s own follow-up on the same opportunity');
 eq(review(followup('تغيّرت المتابعة السابقة. حدّث البيانات ثم أعد المحاولة.',409),[theirs,queued]),null,'another member\'s follow-up, or one still on the device, is no duplicate');
 eq(review(followup('تم حفظ هذه المتابعة بالفعل. افتح تسجيل متابعة جديدة.',409),[{...twin,id:'customer-followup-f1',data:{...twin.data,date:'2026-11-15'}}]),{kind:'duplicate',date:'2026-11-15',recordId:'customer-followup-f1'},'the same request already saved: the entry\'s own record and its day');
 eq(review(followup('تم حفظ هذه المتابعة بالفعل. افتح تسجيل متابعة جديدة.',409)),{kind:'duplicate',recordId:'customer-followup-f1'},'with no copy of it on the device: no day');
 const visit=entry('visit','k9',{status:'blocked',message:'تم حفظ هذه العملية بالفعل. أعد فتح الزيارة لحفظ تعديلات إضافية.',httpStatus:409,body:onCustomer('c1')});
 eq(review(visit,[saved]),{kind:'duplicate',date:'2026-11-16',recordId:'customer-visit-k9'},'a visit saved already, its day');
 const customer=entry('customer','n2',{status:'blocked',message:'تم حفظ هذه العملية بالفعل. أعد فتح السجل لحفظ تعديلات إضافية.',httpStatus:409,body:JSON.stringify({data:{name:'مصنع النخيل'}})});
 eq(review(customer,[customerRow]),{kind:'duplicate',date:'2026-11-16',recordId:'crm-rep-n2'},'a customer saved already: the day it was saved in Riyadh');
 eq(review(entry('file','p1',{status:'blocked',message:'تم رفع هذا الملف ببيانات مختلفة. أعد اختيار المرفق.',httpStatus:409})),{kind:'duplicate',recordId:'local-file:p1'},'an attachment uploaded already');
 eq(review(entry('service','s1',{status:'blocked',message:'العملية محفوظة ببيانات مختلفة. حدّث الصفحة.',httpStatus:409,body:onCustomer('c1')})),{kind:'duplicate',recordId:'service-s1'},'a customer-service registration saved already');
 eq(review(followup('اختر العميل',403,{code:'CUSTOMER_UNAVAILABLE'})),{kind:'unavailable',target:'customer'},'the customer\'s code');
 eq(review(followup('المتابعة لا تتبع هذا العميل',403,{code:'OPPORTUNITY_UNAVAILABLE'})),{kind:'unavailable',target:'opportunity'},'the opportunity\'s code');
 for(const item of R.UNAVAILABLE_REFUSALS){const kind=Object.entries({visit:'/api/visits',followup:'/api/customer-followups',service:'/api/customer-service',file:'/api/visit-files'}).find(([,url])=>url===item.url)[0];eq(review(entry(kind,'x',{status:'blocked',message:item.error,httpStatus:item.status,body:onCustomer('c1')})),{kind:'unavailable',target:item.target},'an entry held before the codes: «'+item.error+'» of '+item.url);}
 eq(review(entry('visit','x',{status:'blocked',message:'اختر العميل',httpStatus:400,body:onCustomer('c1')})),null,'the same words with another status: not that refusal');
 eq(review(entry('visit','x',{status:'blocked',message:'الزيارة غير متاحة',httpStatus:404,body:onCustomer('c1')})),{kind:'unavailable',target:'customer'},'a record of the server no longer the member\'s (404)');
 eq(review(entry('visit','x',{status:'blocked',message:C.NOT_SERVER_ANSWER.invalid[0],httpStatus:404,body:onCustomer('c1')})),null,'a 404 page that was not the server\'s says nothing: it goes back to the queue');
 eq(review(entry('visit','x',{status:'blocked',message:'تغيّرت صلاحيات الحساب. راجع الإدخالات ثم أعد محاولة رفع كل سجل.',httpStatus:403,body:onCustomer('c1')})),null,'the permissions changed: the message alone');
 eq(review(entry('visit','x',{status:'blocked',message:'اكتب نتيجة الزيارة قبل حفظ الفرصة (3 أحرف على الأقل).',httpStatus:400,body:onCustomer('c1')})),null,'a field to complete: the message alone');
 eq(review({...followup('اختر العميل',403,{code:'CUSTOMER_UNAVAILABLE'}),status:'pending'}),null,'an entry waiting to be sent: nothing');
 eq(R.offlineAnswerOf({error:'x',code:'DUPLICATE',duplicate:{id:'customer-followup-1',date:'2026-11-17',name:'مصنع',performedBy:'other'},extra:1}),{code:'DUPLICATE',duplicate:{id:'customer-followup-1',date:'2026-11-17'}},'kept from the answer: the code, the id and the day only');
 eq([R.offlineAnswerOf({error:'x',code:'SOMETHING'}),R.offlineAnswerOf({error:'x',duplicate:{id:'<script>',date:'17/11/2026'}}),R.offlineAnswerOf(null),R.offlineAnswerOf('text'),R.offlineAnswerOf([1])],[undefined,undefined,undefined,undefined,undefined],'an unknown code, an id or day of another shape, no object: nothing');
 // The words.
 const text=(value,kind,language)=>R.offlineReviewText(value,kind,language);
 eq(text({kind:'duplicate',date:'2026-11-17'},'followup','ar'),{text:'يبدو أن هذه المتابعة مسجلة بالفعل: متابعة على الفرصة نفسها بتاريخ 2026-11-17. إن كانت مكررة فاحذفها من الجهاز.',date:'2026-11-17'},'the duplicate follow-up in the words asked for');
 eq(text({kind:'unavailable',target:'opportunity'},'followup','ar').text,'لم تعد الفرصة متاحة لك (أُغلقت أو نُقلت أو حُذفت)، لذلك لا يمكن إرسال هذا الإدخال. يمكنك حذفه من الجهاز.','the opportunity no longer available, in the words asked for');
 eq(text({kind:'unavailable',target:'customer'},'visit','ar').text,'لم يعد العميل متاحًا لك (نُقل أو حُذف)، لذلك لا يمكن إرسال هذا الإدخال. يمكنك حذفه من الجهاز.','the customer no longer available');
 eq(text({kind:'duplicate',date:'2026-11-16'},'visit','ar').text,'يبدو أن هذه الزيارة مسجلة بالفعل: زيارة للعميل نفسه بتاريخ 2026-11-16. إن كانت مكررة فاحذفها من الجهاز.','a visit');
 eq(text({kind:'duplicate',date:'2026-11-16'},'customer','ar').text,'يبدو أن هذا العميل مسجل بالفعل: عميل سجّلته بتاريخ 2026-11-16. إن كان مكررًا فاحذفه من الجهاز.','a customer');
 eq(text({kind:'duplicate'},'followup','ar'),{text:'يبدو أن هذه المتابعة مسجلة بالفعل: متابعة على الفرصة نفسها محفوظة على الخادم. إن كانت مكررة فاحذفها من الجهاز.'},'no day known');
 eq(text({kind:'duplicate',date:'2026-11-16'},'file','ar'),{text:'يبدو أن هذا المرفق مرفوع بالفعل. إن كان مكررًا فاحذفه من الجهاز.'},'an attachment has no day');
 for(const kind of ['customer','visit','followup','service','file'])for(const value of [{kind:'duplicate',date:'2026-11-16'},{kind:'duplicate'},{kind:'unavailable',target:'customer'},{kind:'unavailable',target:'opportunity'}]){const ar=text(value,kind,'ar').text,en=text(value,kind,'en').text;ok(ARABIC.test(ar)&&!ARABIC.test(en)&&en.length>30,'Arabic and its English: '+kind+' '+JSON.stringify(value));}
 eq(['customer','visit','followup','service','file'].map(kind=>R.offlineEntryNoun(kind,'ar')),['عميل جديد','زيارة','متابعة','فرصة','مرفق'],'the nouns of the list');
 for(const reason of ['syncing','not-review','changed'])ok(ARABIC.test(R.offlineDeletionRefusalText(reason,'ar'))&&!ARABIC.test(R.offlineDeletionRefusalText(reason,'en')),'a refused deletion in both languages: '+reason);
 // The customer registered at the same place.
 const at=(location,extra={})=>({kind:'customer',localId:'crm-rep-new',body:JSON.stringify({data:{name:'مصنع جديد',location,...extra}})});
 const near={id:'mine',kind:'customer',parentId:null,data:{name:'مصنع الأمل',_createdBy:'rep',location:'26.4300000, 50.0300000',latitude:26.43,longitude:50.03},createdAt:''};
 const nearer={...near,id:'mine-nearer',data:{...near.data,name:'مصنع الأمل الجديد',latitude:26.43005,longitude:50.03,location:'26.43005, 50.03'}};
 const otherMember={...near,id:'other',data:{...near.data,_createdBy:'rep2'}},onDevice={...near,id:'queued',data:{...near.data,_offlineState:'pending'}},itself={...near,id:'crm-rep-new'};
 eq(R.samePlaceCustomer(at('26.4300800, 50.0300000'),[near,otherMember,onDevice,itself],me)?.id,'mine','a customer the member registered 9 metres away');
 eq(R.samePlaceCustomer(at('26.43006، 50.03'),[near,nearer],me)?.id,'mine-nearer','the nearest, an Arabic comma read');
 eq(R.samePlaceCustomer(at('26.4306000, 50.0300000'),[near],me),undefined,'67 metres away: another place');
 eq(R.samePlaceCustomer(at('26.43, 50.03'),[otherMember,onDevice,itself],me),undefined,'another member\'s, one still on the device, the entry itself: none');
 eq([R.samePlaceCustomer(at(''),[near],me),R.samePlaceCustomer({...at('26.43, 50.03'),kind:'visit'},[near],me)],[undefined,undefined],'no place, or not a new customer: none');
 // Each route's own words, as the device reads them.
 for(const item of R.UNAVAILABLE_REFUSALS){const route=fs.readFileSync(path.join('app',item.url,'route.ts'),'utf8'),quoted="'"+item.error+"'";ok(route.includes('CRMError('+quoted+','+item.status+')')||route.includes('Refusal('+quoted+','+item.status)||item.status===400&&route.includes('const message='+quoted),'«'+item.error+'» is '+item.url+'\'s own refusal with '+item.status);}
 for(const [url,words] of [['/api/visits','تم حفظ هذه العملية بالفعل. أعد فتح الزيارة لحفظ تعديلات إضافية.'],['/api/customer-followups','تم حفظ هذه المتابعة بالفعل. افتح تسجيل متابعة جديدة.'],['/api/crm','تم حفظ هذه العملية بالفعل. أعد فتح السجل لحفظ تعديلات إضافية.'],['/api/customer-service','العملية محفوظة ببيانات مختلفة. حدّث الصفحة.'],['/api/visit-files','تم رفع هذا الملف ببيانات مختلفة. أعد اختيار المرفق.']]){ok(fs.readFileSync(path.join('app',url,'route.ts'),'utf8').includes("'"+words+"'"),url+' still refuses a saved request so');ok(R.ALREADY_SAVED.test(words),'and the device reads it as saved already');}
});

// ---- The route.
const migrations=fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const name of migrations)sql.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(/^\s*(SELECT|WITH)/i.test(s.q)?{...await s.all(),meta:{changes:0}}:await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid',YR_AUTH_SECRET:'a'.repeat(64)};
const iso=()=>new Date().toISOString(),member=(id,role,supervisor=null)=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,'الرئيسي',supervisor,role==='admin'?'all':'eastern',iso());
member('owner','admin');member('sup','supervisor');member('rep','rep','sup');member('rep2','rep','sup');member('west','rep');sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='west'").run();
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const insert=(id,kind,parent,data,{created=iso(),assigned='rep'}={})=>sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,1,?)').run(id,kind,parent,assigned,'الرئيسي',JSON.stringify(kind==='customer'?{name:'عميل '+id,region:'الشرقية',...data}:{performedBy:'rep',recordedByEmail:'rep@yourrest.org',responsibleId:'rep',...data}),created,created,'fixture');
const raw=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id);
const route=await load('app/api/customer-followups/route.mjs');
async function post(payload,who='rep'){globalThis.testIdentity=who;const response=await route.POST(new Request('https://test.invalid/api/customer-followups',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(payload)}));return {status:response.status,json:await response.json()};}
const body=(customerId,sourceId,data={},extra={})=>({createKey:crypto.randomUUID(),customerId,customerVersion:raw(customerId)?.version??1,sourceId,sourceVersion:sourceId?raw(sourceId)?.version??1:undefined,data:{type:'call',date:'2026-11-19',result:'تحدثت مع العميل',salesStage:'specs',invoiceOutcome:'pending',nextAction:'إرسال المواصفات',nextDate:'2026-11-26',lossReason:'',lossDetails:'',...data},...extra});
const queued=payload=>({...payload,offline:{memberId:'rep',capturedAt:new NativeDate(clock-3600000).toISOString()}});
const open=(id,assigned='rep',data={})=>{insert(id,'customer',null,{},{assigned});insert(id+'-v','activity',id,{visitWorkflow:'customer-v1',type:'visit',date:'2026-11-12',summary:'زيارة',result:'العميل مهتم',salesStage:'specs',nextAction:'اتصال',nextDate:'2026-11-18',...data},{created:'2026-11-12T07:00:00.000Z',assigned});return id+'-v';};
const asJob=(payload,answer)=>({...entry('followup',payload.createKey,{status:'blocked',message:answer.json.error,httpStatus:answer.status,answer:R.offlineAnswerOf(answer.json),body:JSON.stringify(payload)}),localId:'customer-followup-'+payload.createKey});

await counted('route',async()=>{
 const source=open('c1');
 const later=queued(body('c1',source,{result:'اتصلت بالعميل وأكد الطلب'}));    // recorded on the phone before the same follow-up was saved online
 let answer=await post(body('c1',source));eq(answer.status,200,'the follow-up saved online');const first=answer.json.id;eq(Object.keys(answer.json).sort(),['id','ok'],'a save answers as before');
 answer=await post(later);
 eq([answer.status,answer.json],[409,{error:'تغيّرت بيانات العميل أو متابعته الأخيرة. حدّث البيانات ثم أعد المحاولة.',code:'DUPLICATE',duplicate:{id:first,date:'2026-11-19'}}],'the one kept on the phone: the same refusal, with the member\'s follow-up it repeats');
 eq(R.offlineReview(asJob(later,answer),[],{id:'rep'},S.offlineNotAnswers()),{kind:'duplicate',date:'2026-11-19',recordId:first},'read on the device as a duplicate of that day');
 const fresh=queued(body('c1',source));answer=await post(fresh);
 eq([answer.status,answer.json.error,answer.json.code,answer.json.duplicate],[409,'تغيّرت المتابعة السابقة. حدّث البيانات ثم أعد المحاولة.','DUPLICATE',{id:first,date:'2026-11-19'}],'with the customer as it is now: the opportunity moved on to the member\'s own follow-up');
 const again=body('c1',first);answer=await post(again);eq(answer.status,200,'the next follow-up on the latest one');
 answer=await post({...again,data:{...again.data,result:'نتيجة أخرى مختلفة'}});
 eq([answer.status,answer.json],[409,{error:'تم حفظ هذه المتابعة بالفعل. افتح تسجيل متابعة جديدة.',code:'DUPLICATE',duplicate:{id:answer.json.duplicate?.id,date:'2026-11-19'}}],'the same request key with other data: saved already');eq(answer.json.duplicate.id,'customer-followup-'+again.createKey,'and it names that follow-up');
 // Another member's follow-up on the same opportunity is not named.
 const theirs=open('c2');const before=queued(body('c2',theirs));
 insert('c2-sup','activity','c2',{visitWorkflow:'followup-v1',type:'call',date:'2026-11-18',sourceId:theirs,performedBy:'sup',responsibleId:'sup',recordedByEmail:'sup@yourrest.org',result:'تابع المشرف',nextAction:'زيارة',nextDate:'2026-11-25'},{created:'2026-11-18T08:00:00.000Z'});
 sql.prepare("UPDATE crm_records SET version=version+1 WHERE id='c2'").run();
 answer=await post(before);eq([answer.status,answer.json],[409,{error:'تغيّرت بيانات العميل أو متابعته الأخيرة. حدّث البيانات ثم أعد المحاولة.'}],'the supervisor\'s follow-up on the opportunity: the refusal alone, nothing of it');
 eq(R.offlineReview(asJob(before,answer),[],{id:'rep'},S.offlineNotAnswers()),null,'and the device reads no duplicate');
 // No longer the member's.
 const moved=open('c3');sql.prepare("UPDATE crm_records SET assigned_to='west',data=json_set(data,'$.assignedTo','west','$.region','الغربية') WHERE id IN ('c3','c3-v')").run();
 const toMoved=queued(body('c3',moved));answer=await post(toMoved);
 eq([answer.status,answer.json],[403,{error:'اختر العميل',code:'CUSTOMER_UNAVAILABLE'}],'a customer moved to a representative of another region');
 eq(R.offlineReview(asJob(toMoved,answer),[],{id:'rep'}),{kind:'unavailable',target:'customer'},'read as the customer no longer available');
 answer=await post(queued(body('missing-customer','missing-v')));eq([answer.status,answer.json.code],[403,'CUSTOMER_UNAVAILABLE'],'a deleted customer');
 const gone=open('c4');sql.prepare('DELETE FROM crm_records WHERE id=?').run(gone);
 const toGone=queued(body('c4',gone));answer=await post(toGone);
 eq([answer.status,answer.json],[403,{error:'المتابعة لا تتبع هذا العميل',code:'OPPORTUNITY_UNAVAILABLE'}],'the opportunity deleted');
 eq(R.offlineReview(asJob(toGone,answer),[],{id:'rep'}),{kind:'unavailable',target:'opportunity'},'read as the opportunity no longer available');
 const closed=open('c5','rep',{salesStage:'won',nextAction:'',nextDate:''});
 const toClosed=queued(body('c5',closed));answer=await post(toClosed);
 eq([answer.status,answer.json],[400,{error:'المتابعة تتطلب زيارة سابقة بها إجراء قادم وموعد متابعة.',code:'OPPORTUNITY_UNAVAILABLE'}],'the opportunity closed');
 const unnamed=body('c5');delete unnamed.sourceId;answer=await post(unnamed);eq([answer.status,answer.json],[400,{error:'المتابعة تتطلب زيارة سابقة بها إجراء قادم وموعد متابعة.'}],'no opportunity named, none open: the refusal alone');
 globalThis.testIdentity=null;const anonymous=await route.POST(new Request('https://test.invalid/api/customer-followups',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body('c1',first))}));eq([anonymous.status,Object.keys(await anonymous.json())],[401,['error']],'no session: 401, nothing else');
 eq(sql.prepare("SELECT COUNT(*) n FROM crm_records WHERE json_extract(data,'$.visitWorkflow')='followup-v1' AND json_extract(data,'$.performedBy')='rep'").get().n,2,'only the two follow-ups saved');
});

eq(migrations.length,22,'no new migration (22)');
console.log(JSON.stringify({ok:true,checks,parts:counts}));
