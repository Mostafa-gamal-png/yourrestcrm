import type {Member} from './crm';
import {isOfflineLogoutPending} from './offline-auth';
import {submitJson,SubmitError,isJsonObject,NOT_SERVER_ANSWER,type UploadProgress} from './client-submit';
import {customerLocationProblem} from './customer-fields';
import {fileReferences,offlineAnswerOf,replaceFileReferences,stuckToRelease} from './offline-review';
import {acknowledgeOffline,augmentOfflineSnapshot,idbDone,idbRequest,listOutbox,loadOfflineSnapshot,lockOfflineSession,offlineSessionGeneration,offlineChanged,offlineDB,offlineOwner,readOfflineStore,requireOfflineOwner,saveOfflineSnapshot,unlockedOfflineOwner,updateOfflineJob,SYNC_LEASE_KEY,type OfflineAnswer,type OfflineJob,type OfflineKind,type OfflineReceipt,type OfflineSnapshot} from './offline-store';

type Options={me:Member;language?:string;label:string;kind?:OfflineKind};
export type OfflineSubmitResult={ok:true;id:string;queued:boolean;blocked?:boolean;message?:string;[key:string]:unknown};
const supported=new Set(['/api/crm','/api/visits','/api/customer-followups','/api/customer-service','/api/daily-plans']);
const LEASE_MS=90000;
// Form observers do not own or alter durable outbox retries.
const fileProgress=new Map<string,(progress:UploadProgress)=>void>();
async function briefSync(me:Member){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([flushOutbox(me).catch(()=>{}),new Promise<void>(resolve=>{timer=setTimeout(resolve,1500);})]);}finally{clearTimeout(timer);}}
let drain:Promise<{synced:number;blocked:number;pending:number}>|null=null;
function say(language:string|undefined,ar:string,en:string){return language==='en'?en:ar;}
async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(byte=>byte.toString(16).padStart(2,'0')).join('');}
function kindOf(url:string,body:Record<string,unknown>):OfflineKind{if(url==='/api/crm'&&body.kind==='customer'&&body.action==='save'&&!body.id)return'customer';if(url==='/api/visits'&&!body.id)return'visit';if(url==='/api/customer-followups'&&!body.id)return'followup';if(url==='/api/customer-service'&&body.action==='create'&&!body.id)return'service';if(url==='/api/daily-plans'&&body.action==='send')return'plan';throw new Error('هذه العملية تحتاج اتصالًا بالإنترنت.');}
function recordId(kind:OfflineKind,ownerId:string,key:string){return kind==='customer'?`crm-${ownerId}-${key}`:kind==='visit'?`customer-visit-${key}`:kind==='followup'?`customer-followup-${key}`:kind==='plan'?`daily-plan-${key}`:`service-${key}`;}
function requestKey(body:Record<string,unknown>,kind:OfflineKind){const key=kind==='service'||kind==='plan'?body.requestId:body.createKey;if(typeof key!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key))throw new Error('تعذر تحديد عملية الحفظ. افتح النموذج مجددًا.');return key;}
async function enqueue(job:OfflineJob){const db=await offlineDB(),tx=db.transaction(['meta','outbox','receipts'],'readwrite'),done=idbDone(tx);let found:OfflineJob|OfflineReceipt|undefined;const session=tx.objectStore('meta').get('session');session.onsuccess=()=>{if(session.result?.ownerId!==job.ownerId||session.result?.stamp!==job.owner.stamp||isOfflineLogoutPending()){tx.abort();return;}const receipt=tx.objectStore('receipts').get(job.id);receipt.onsuccess=()=>{if(receipt.result){found=receipt.result;return;}const existing=tx.objectStore('outbox').get(job.id);existing.onsuccess=()=>{if(existing.result)found=existing.result;else tx.objectStore('outbox').add(job);};};};await done;if(found&&found.fingerprint!==job.fingerprint)throw new Error('العملية محفوظة على الجهاز ببيانات مختلفة. راجع قائمة الحفظ المعلّق قبل إدخال نسخة جديدة.');offlineChanged();return found;}
async function submissionState(id:string){const db=await offlineDB(),tx=db.transaction(['outbox','receipts'],'readonly');const [receipt,job]=await Promise.all([idbRequest<OfflineReceipt|undefined>(tx.objectStore('receipts').get(id)),idbRequest<OfflineJob|undefined>(tx.objectStore('outbox').get(id))]);return{receipt,job};}
/** Local commit happens before the first HTTP mutation; uncertainty always replays the frozen request. */
export async function offlineSubmit<T=Record<string,unknown>>(url:string,body:string,options:Options):Promise<T&OfflineSubmitResult>{if(!supported.has(url))throw new Error('Unsupported offline endpoint');const owner=await requireOfflineOwner(options.me),input=JSON.parse(body),kind=kindOf(url,input),key=requestKey(input,kind),capturedAt=new Date().toISOString(),id=owner.id+':'+kind+':'+key;const job:OfflineJob={id,ownerId:owner.id,owner,kind,label:options.label||kind,status:'pending',message:'',createdAt:capturedAt,capturedAt,localId:recordId(kind,owner.id,key),url,body:JSON.stringify({...input,offline:{memberId:owner.id,capturedAt}}),fingerprint:await digest(url+'\n'+body),language:options.language||'ar',attempts:0};const existing=await enqueue(job);if(existing&&'result'in existing)return{...existing.result,ok:true,id:String(existing.result.id),queued:false} as T&OfflineSubmitResult;
 if(typeof navigator==='undefined'||navigator.onLine!==false)await briefSync(options.me);
 const state=await submissionState(id),receipt=state.receipt;if(receipt)return{...receipt.result,ok:true,id:String(receipt.result.id),queued:false} as T&OfflineSubmitResult;
 const stored=state.job;if(!stored)throw new Error('تعذر تأكيد الحفظ المحلي. أعد المحاولة بنفس البيانات.');return{ok:true,id:stored.localId,queued:true,blocked:stored.status==='blocked',message:stored.message,...(kind==='service'?{customerId:input.customerId}:{})} as T&OfflineSubmitResult;}
export async function uploadOfflineVisitFile(file:File,options:{me:Member;customerId:string;language?:string;uploadKey?:string;onUploadProgress?:(progress:UploadProgress)=>void}):Promise<OfflineSubmitResult&{name:string}>{if(!options.customerId)throw new Error('اختر العميل أولًا.');if(!file.size||file.size>10*1024*1024)throw new Error('ارفع ملف PDF أو صورة JPEG أو PNG أو WebP بحجم لا يزيد عن 10 ميجابايت.');const header=new Uint8Array(await file.slice(0,12).arrayBuffer()),text=new TextDecoder().decode(header),valid=text.startsWith('%PDF-')||header[0]===255&&header[1]===216&&header[2]===255||header.slice(0,8).join(',')==='137,80,78,71,13,10,26,10'||text.slice(0,4)==='RIFF'&&text.slice(8,12)==='WEBP';if(!valid)throw new Error('الملف ليس PDF أو صورة مدعومة.');const owner=await requireOfflineOwner(options.me),key=options.uploadKey||crypto.randomUUID(),createdAt=new Date().toISOString(),id=owner.id+':file:'+key,localId='local-file:'+key,name=file.name.replace(/[\x00-\x1f\x7f]/g,'').slice(0,200)||'عرض المنافس';await enqueue({id,ownerId:owner.id,owner,kind:'file',label:name,status:'pending',message:'',createdAt,capturedAt:createdAt,localId,url:'/api/visit-files',fingerprint:key,language:options.language||'ar',blob:file,fileName:name,customerId:options.customerId,uploadKey:key,attempts:0});if(options.onUploadProgress)fileProgress.set(id,options.onUploadProgress);try{if(typeof navigator==='undefined'||navigator.onLine!==false)await briefSync(options.me);const receipt=await readOfflineStore<OfflineReceipt|undefined>('receipts',id);return{ok:true,id:receipt?String(receipt.result.id):localId,name:receipt?String(receipt.result.name):name,queued:!receipt};}finally{fileProgress.delete(id);}}
async function lease(token:string,release=false){const db=await offlineDB(),tx=db.transaction('meta','readwrite'),done=idbDone(tx),store=tx.objectStore('meta'),request=store.get(SYNC_LEASE_KEY);let acquired=false;request.onsuccess=()=>{const held=request.result;if(release){if(held?.token===token)store.delete(SYNC_LEASE_KEY);return;}if(!held||held.expires<=Date.now()||held.token===token){store.put({key:SYNC_LEASE_KEY,token,expires:Date.now()+LEASE_MS});acquired=true;}};await done;return acquired;}
async function blocked(job:OfflineJob,message:string,status?:number,answer?:OfflineAnswer){await updateOfflineJob({...job,status:'blocked',message,httpStatus:status,answer});}
/** The device's own words for an answer that was not the server's (a page of a proxy or of the host while it restarts, an HTML 404 or 413,
 *  JSON without its error: lib/client-submit.ts). GSCO 2.13.81: such an answer never holds an entry for review; it is sent again. */
const NOT_ANSWERS:readonly string[]=Object.values(NOT_SERVER_ANSWER).flat();
export const offlineNotAnswers=()=>NOT_ANSWERS;
/** Only the server's own refusal holds an entry for review: a 4xx (not 408 or 429) whose body is JSON with its error, or a redirect to the
 *  sign-in page. Anything else (no connection, a timeout, a 5xx, a page that was not the server's answer) is retried with the same entry. */
export function isServerRefusal(error:unknown):error is SubmitError{
 return error instanceof SubmitError&&!error.invalidResponse&&error.status>=400&&error.status<500&&error.status!==408&&error.status!==429&&(isJsonObject(error.body)&&typeof error.body.error==='string'&&!!error.body.error.trim()||error.status===401);
}
/** Entries held for review by an answer that was not the server's, or by an ended session, and those that waited behind them, go back to the
 *  queue (lib/offline-review.ts stuckToRelease): called once the server confirmed the same account at the start of a sync. */
async function releaseStuck(me:Member){
 const active=await listOutbox(me),all=(await readOfflineStore<OfflineJob[]>('outbox')).filter(job=>job.ownerId===me.id);
 for(const id of stuckToRelease(active,all,NOT_ANSWERS)){const job=active.find(item=>item.id===id);if(job)await updateOfflineJob({...job,status:'pending',message:'',httpStatus:undefined,answer:undefined});}
}
/** Whether this tab is sending entries now (it holds the sync's lease): «حذف هذا الإدخال من الجهاز» waits for it (app/offline-status.tsx). */
let draining=false;const drainListeners=new Set<()=>void>();
function setDraining(value:boolean){if(draining===value)return;draining=value;for(const listener of drainListeners)listener();}
export const outboxDraining=()=>draining;
export function subscribeOutboxDraining(listener:()=>void){drainListeners.add(listener);return()=>{drainListeners.delete(listener);};}
async function sessionSnapshot():Promise<OfflineSnapshot>{const snapshot=await submitJson<OfflineSnapshot>('/api/crm',{method:'GET',cache:'no-store',credentials:'same-origin'},{timeout:15000});if(!snapshot?.me?.id||!snapshot.me.active||!Array.isArray(snapshot.records)||!Array.isArray(snapshot.members))throw new SubmitError('تعذر تأكيد الحساب الحالي.',401);return snapshot;}
async function summary(me:Member,synced=0){const queue=await listOutbox(me);return{synced,blocked:queue.filter(job=>job.status==='blocked').length,pending:queue.filter(job=>job.status!=='blocked').length};}
async function runDrain(me?:Member){if(isOfflineLogoutPending())return{synced:0,blocked:0,pending:0};const cached=await loadOfflineSnapshot();if(!cached||me&&cached.me.id!==me.id)return{synced:0,blocked:0,pending:0};me=cached.me;const jobs=await listOutbox(me);if(!jobs.length||typeof navigator!=='undefined'&&navigator.onLine===false)return summary(me);
 // Only entries that need review, none of them to release: nothing to send, so no request and no lease (the screen's «حذف» stays open).
 if(jobs.every(job=>job.status==='blocked')&&!stuckToRelease(jobs,(await readOfflineStore<OfflineJob[]>('outbox')).filter(job=>job.ownerId===me!.id),NOT_ANSWERS).size)return summary(me);
const token=crypto.randomUUID();if(!await lease(token))return summary(me);let synced=0,snapshot:OfflineSnapshot;
 setDraining(true);
 try{const sessionGeneration=offlineSessionGeneration();try{snapshot=await sessionSnapshot();}catch(error){if(error instanceof SubmitError&&!error.invalidResponse&&[401,403].includes(error.status)){for(const job of jobs)await blocked(job,say(job.language,'سجّل الدخول بنفس الحساب لإكمال رفع البيانات المحفوظة.','Sign in with the same account to upload your saved entries.'),error.status);await lockOfflineSession();}return summary(me);}
  const unlocked=await unlockedOfflineOwner();if(!unlocked||isOfflineLogoutPending())return summary(me);if(snapshot.me.id!==unlocked.id||snapshot.me.id!==me.id){await lockOfflineSession();return summary(me);}const freshOwner=offlineOwner(snapshot.me);
  if(freshOwner.stamp!==offlineOwner(me).stamp){for(const job of jobs)await blocked(job,say(job.language,'تغيّرت صلاحيات الحساب. راجع الإدخالات ثم أعد محاولة رفع كل سجل.','Account permissions changed. Review the entries and retry each record.'),403);await saveOfflineSnapshot(snapshot,sessionGeneration);return summary(snapshot.me);}
  await saveOfflineSnapshot(snapshot,sessionGeneration);
  await releaseStuck(me);
  for(let job of await listOutbox(me)){
   // The entry as it is now: one deleted, archived or held since the list was read is not sent.
   const stored=await readOfflineStore<OfflineJob|undefined>('outbox',job.id);if(!stored||stored.ownerId!==me.id||stored.status==='blocked'||stored.archivedAt)continue;job=stored;
   const current=await unlockedOfflineOwner();if(isOfflineLogoutPending()||!current||current.id!==me.id||current.stamp!==freshOwner.stamp||!await lease(token))break;
   if(job.owner.stamp!==freshOwner.stamp){await blocked(job,say(job.language,'تغيّرت صلاحيات الحساب منذ تسجيل البيانات. راجعها وأعد المحاولة.','Permissions changed since this entry was recorded. Review it and retry.'),403);continue;}
   const queue=await listOutbox(me),customerId=job.kind==='file'?job.customerId:job.body?JSON.parse(job.body).customerId:undefined;
   const customerDependency=queue.find(other=>other.kind==='customer'&&other.localId===customerId&&other.id!==job.id);
   if(customerDependency){if(customerDependency.status==='blocked')await blocked(job,say(job.language,'أكمل رفع العميل المرتبط أولًا.','Upload the linked customer first.'),424);continue;}
   if(job.kind!=='file'&&!job.wireBody){const refs=fileReferences(JSON.parse(job.body!)),receipts=await readOfflineStore<OfflineReceipt[]>('receipts'),replacements=new Map<string,string>();let missing=false;
    for(const local of refs){const receipt=receipts.find(item=>item.ownerId===me!.id&&item.localId===local);if(receipt)replacements.set(local,String(receipt.result.id));else{missing=true;const dependency=queue.find(item=>item.localId===local);if(!dependency||dependency.status==='blocked')await blocked(job,say(job.language,'يحتاج مرفق عرض السعر إلى المراجعة قبل رفع السجل.','The quotation attachment needs review before this entry can upload.'),424);}}
    if(missing)continue;job={...job,wireBody:JSON.stringify(replaceFileReferences(JSON.parse(job.body!),replacements))};await updateOfflineJob(job);
   }
   job={...job,status:'syncing',message:'',attempts:job.attempts+1,httpStatus:undefined,answer:undefined};await updateOfflineJob(job);
   try{let result:Record<string,unknown>;if(job.kind==='file'){const form=new FormData();form.set('file',job.blob!,job.fileName);form.set('customerId',job.customerId!);form.set('uploadKey',job.uploadKey!);form.set('memberId',job.ownerId);result=await submitJson('/api/visit-files',{method:'POST',body:form,credentials:'same-origin'},{language:job.language,timeout:45000,onUploadProgress:progress=>fileProgress.get(job.id)?.(progress)});}else result=await submitJson(job.url,{method:'POST',headers:{'Content-Type':'application/json'},body:job.wireBody,credentials:'same-origin'},{language:job.language,timeout:25000});
    if((job.kind==='file'?typeof result?.name!=='string':!result?.ok)||typeof result.id!=='string'||!result.id)throw new SubmitError(say(job.language,'لم يؤكد الخادم الحفظ؛ ستتم إعادة المحاولة بنفس البيانات.','The server did not confirm the save; the same entry will be retried.'));
    await acknowledgeOffline(job,result,me);synced++;
   }catch(error){if(isServerRefusal(error)){await blocked(job,error.message,error.status,offlineAnswerOf(error.body));if(error.status===401){await lockOfflineSession();break;}if(error.status===403)break;}else{await updateOfflineJob({...job,status:'pending',message:say(job.language,'محفوظ على الجهاز؛ في انتظار الاتصال لإكمال الرفع.','Saved on this device; waiting for a connection to upload.')} );break;}}
  }
  if(synced){try{const refreshGeneration=offlineSessionGeneration(),refreshed=await sessionSnapshot(),current=await unlockedOfflineOwner();if(current?.id===refreshed.me.id&&current.stamp===offlineOwner(refreshed.me).stamp)await saveOfflineSnapshot(refreshed,refreshGeneration);}catch(error){if(error instanceof SubmitError&&[401,403].includes(error.status))await lockOfflineSession();/* ACKs remain durable until the next authorized refresh. */}}
  return summary(me,synced);
 }finally{await lease(token,true);setDraining(false);}
}
export function flushOutbox(me?:Member){if(!drain)drain=runDrain(me).finally(()=>{drain=null;});return drain;}
export async function retryOutbox(id:string,me:Member){const owner=await requireOfflineOwner(me),job=await readOfflineStore<OfflineJob|undefined>('outbox',id);if(!job||job.ownerId!==owner.id)throw new Error('السجل غير متاح لهذا الحساب.');await updateOfflineJob({...job,owner,status:'pending',message:'',httpStatus:undefined,answer:undefined,archivedAt:undefined});return flushOutbox(me);}
/** The fields of a queued visit or contact a member may complete on the device (lib/opportunity-entry.ts): its result, the next action and
 *  the follow-up date. */
export type OfflineEntryFields={result?:string;nextAction?:string;nextDate?:string};
/** What the queued body of a visit or a customer-service registration holds (its data or registration), or null for any other entry. */
export function offlineEntryFields(job:Pick<OfflineJob,'kind'|'body'>):{type?:unknown;result?:unknown;nextAction?:unknown;nextDate?:unknown}|null{
 if((job.kind!=='visit'&&job.kind!=='service')||!job.body)return null;
 try{const body=JSON.parse(job.body),fields=job.kind==='service'?body.registration:body.data;return isJsonObject(fields)?fields:null;}catch{return null;}
}
/** A queued new visit or contact the server sent back «تحتاج مراجعة» because it lacked its result or next step (a new opportunity's rule,
 *  lib/opportunity-entry.ts): the member adds what is missing on the device, and the same entry (its key, the moment it was recorded on the
 *  device, its place and timing) is sent again with it. Only an entry of this member that needs review; nothing else of it changes. */
export async function completeOfflineEntry(id:string,me:Member,fields:OfflineEntryFields){
 const owner=await requireOfflineOwner(me),job=await readOfflineStore<OfflineJob|undefined>('outbox',id);
 if(!job||job.ownerId!==owner.id||job.status!=='blocked'||job.archivedAt||!offlineEntryFields(job))throw new Error('السجل غير متاح لهذا الحساب.');
 const body=JSON.parse(job.body!),target=job.kind==='service'?'registration':'data',patch:Record<string,string>={};
 for(const key of ['result','nextAction','nextDate'] as const)if(typeof fields[key]==='string')patch[key]=fields[key]!.trim();
 body[target]={...body[target],...patch};
 const {offline:_offline,...input}=body;void _offline;
 await updateOfflineJob({...job,body:JSON.stringify(body),wireBody:undefined,fingerprint:await digest(job.url+'\n'+JSON.stringify(input))});
 return retryOutbox(id,me);
}
export async function currentOfflineSnapshot(){const snapshot=await loadOfflineSnapshot();return snapshot?augmentOfflineSnapshot(snapshot):null;}
/** The location of a new customer kept on the device that the server sent back for review (app/offline-status.tsx, the owner, 2026-11-19,
 *  GSCO 2.13.84): the member corrects it (typed, chosen on the map or the phone's current position, app/customer-entry-fields.tsx) and the
 *  same entry, with its key and the moment it was recorded, is sent again; the national address the new place found fills only what was
 *  empty, as in the customer form. The place is checked by the server's own rules first (lib/customer-fields.ts). Nothing else changes. */
export const OFFLINE_CUSTOMER_PLACE_FIELDS=['location','latitude','longitude','locationSource','locationCapturedAt','locationAccuracy','shortAddress','address','city'] as const;
export async function relocateOfflineCustomer(id:string,me:Member,fields:Record<string,unknown>){
 const owner=await requireOfflineOwner(me),job=await readOfflineStore<OfflineJob|undefined>('outbox',id);
 if(!job||job.ownerId!==owner.id||job.kind!=='customer'||job.status!=='blocked'||job.archivedAt||!job.body)throw new Error('السجل غير متاح لهذا الحساب.');
 const body=JSON.parse(job.body),data:Record<string,unknown>={...(isJsonObject(body.data)?body.data:{})};
 for(const key of OFFLINE_CUSTOMER_PLACE_FIELDS){if(!(key in fields))continue;const value=fields[key];if(value===undefined||value===null&&key!=='latitude'&&key!=='longitude')delete data[key];else data[key]=value;}
 if(typeof data.location!=='string'||!data.location.trim())throw new Error('أدخل موقع العميل أو اختره على الخريطة.');
 const problem=customerLocationProblem(data);if(problem)throw new Error(problem);
 body.data=data;
 const {offline:_offline,...input}=body;void _offline;
 await updateOfflineJob({...job,body:JSON.stringify(body),wireBody:undefined,fingerprint:await digest(job.url+'\n'+JSON.stringify(input))});
 return retryOutbox(id,me);
}
