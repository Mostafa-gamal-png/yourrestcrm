import type {Member,Row} from './crm';
import type {OfflineAnswer,OfflineJob,OfflineKind} from './offline-store';
import {customerCoordinates} from './customer-location';
import {distanceMeters} from './journeys';

/** «الإدخالات الواقفة على الجهاز» (the owner, 2026-11-19, from GSCO 2.13.84 and 2.13.81): an entry kept on the device that the server sent
 *  back «تحتاج مراجعة», what it is about, and what goes with it when it is deleted. Pure: the outbox (lib/offline-store.ts,
 *  lib/offline-submit.ts) and its screen (app/offline-status.tsx) read it, and the follow-ups route writes its codes (lib/offline-server.ts).
 *  GSCO's «الفرصة» is Yourrest's opportunity as a follow-up continues it: the visit or contact it is recorded on (`sourceId`,
 *  lib/opportunity-entry.ts); GSCO's «المشروع» is Yourrest's customer (the factory). */

/** The words a refusal of the server carries beside its message for an entry kept on the device (POST /api/customer-followups): the customer
 *  or the opportunity it needs is no longer the member's (closed, moved or deleted), or the same follow-up is already saved (with the
 *  member's own record it repeats: its id and its day). */
export const OFFLINE_REFUSAL={customerUnavailable:'CUSTOMER_UNAVAILABLE',opportunityUnavailable:'OPPORTUNITY_UNAVAILABLE',duplicate:'DUPLICATE'} as const;
const CODES=new Set<string>(Object.values(OFFLINE_REFUSAL));
const DAY=/^\d{4}-\d{2}-\d{2}$/,RECORD_ID=/^[A-Za-z0-9_:.-]{1,200}$/;
const isObject=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const say=(language:string|undefined,ar:string,en:string)=>language==='en'?en:ar;

/** What of a refusal's body the device keeps with the entry: a known code and the duplicate's id and day, each checked; nothing else. */
export function offlineAnswerOf(body:unknown):OfflineAnswer|undefined{
 if(!isObject(body))return;
 const code=typeof body.code==='string'&&CODES.has(body.code)?body.code:undefined,twin=isObject(body.duplicate)?body.duplicate:undefined;
 const duplicate={...(typeof twin?.id==='string'&&RECORD_ID.test(twin.id)?{id:twin.id}:{}),...(typeof twin?.date==='string'&&DAY.test(twin.date)?{date:twin.date}:{})};
 const named=!!duplicate.id||!!duplicate.date;
 return code||named?{...(code?{code}:{}),...(named?{duplicate}:{})}:undefined;
}

type Entry=Pick<OfflineJob,'id'|'kind'|'localId'|'body'|'customerId'|'status'|'archivedAt'>;
function bodyOf(job:Pick<OfflineJob,'body'>):Record<string,unknown>{try{const value:unknown=JSON.parse(job.body||'{}');return isObject(value)?value:{};}catch{return {};}}
/** The customer an entry is recorded on: a customer saved on the device (its local id) or one of the server. */
export function entryCustomerId(job:Pick<OfflineJob,'kind'|'body'|'customerId'>){const value=job.kind==='file'?job.customerId:bodyOf(job).customerId;return typeof value==='string'?value:'';}
/** The opportunity a follow-up continues (the visit or contact it is recorded on). */
export function entrySourceId(job:Pick<OfflineJob,'kind'|'body'>){const value=job.kind==='followup'?bodyOf(job).sourceId:undefined;return typeof value==='string'?value:'';}
/** Where a visit, a follow-up and a customer-service registration name the competitor's attachment: a file saved on the device is named by
 *  its local id (`local-file:<key>`) until it is uploaded, and the upload's id replaces it in the request then sent. */
const FILE_PATHS=[['data','competitorFileId'],['data','competitorObservation','competitorFileId'],['registration','competitorFileId']];
const atPath=(value:unknown,path:string[])=>path.reduce<unknown>((entry,key)=>isObject(entry)?entry[key]:undefined,value);
export function fileReferences(value:unknown){return new Set<string>(FILE_PATHS.map(path=>atPath(value,path)).filter((entry):entry is string=>typeof entry==='string'&&entry.startsWith('local-file:')));}
export function replaceFileReferences(value:unknown,replacements:Map<string,string>){for(const path of FILE_PATHS){const previous=atPath(value,path),replacement=typeof previous==='string'?replacements.get(previous):undefined;if(replacement){const parent=atPath(value,path.slice(0,-1));if(isObject(parent))parent[path[path.length-1]]=replacement;}}return value;}
export function entryFiles(job:Pick<OfflineJob,'kind'|'body'>){return job.kind==='file'||!job.body?new Set<string>():fileReferences(bodyOf(job));}
/** The entries kept on the device that this one needs before it can be sent: the new customer it is recorded on, the attachments it
 *  names, and the entry of the opportunity it continues if that one is on the device too. */
export function entryNeeds<T extends Entry>(job:Entry,jobs:T[]):T[]{
 const customerId=entryCustomerId(job),sourceId=entrySourceId(job),files=entryFiles(job);
 return jobs.filter(other=>other.id!==job.id&&(other.kind==='customer'&&!!customerId&&other.localId===customerId||other.kind==='file'&&files.has(other.localId)||!!sourceId&&other.localId===sourceId));
}

/** «حذف هذا الإدخال من الجهاز» is offered for an entry that needs review (the server sent it back), on the list or in the local archive;
 *  never for one waiting to be sent or being sent. */
export const deletableOfflineEntry=(job:Pick<OfflineJob,'status'|'archivedAt'>)=>job.status==='blocked'||!!job.archivedAt;
export type OfflineDeletion<T extends Entry=OfflineJob>={root:T;also:{job:T;attachment:boolean}[]};
/** What deleting an entry takes with it, among the member's own entries (waiting, needing review or archived): every entry that needs it,
 *  however far (a visit or an attachment on a new customer, an entry that names a deleted attachment, a follow-up on an opportunity on the
 *  device), and the attachments the deleted entries name that no entry left names (the photo or the PDF stays nowhere else). Listed in the
 *  order they were recorded. null when the entry is not there. */
export function offlineDeletion<T extends Entry>(rootId:string,jobs:T[]):OfflineDeletion<T>|null{
 const root=jobs.find(job=>job.id===rootId);if(!root)return null;
 const chosen=new Map<string,boolean>([[root.id,false]]);
 for(let grew=true;grew;){
  grew=false;
  for(const job of jobs)if(!chosen.has(job.id)&&entryNeeds(job,jobs).some(other=>chosen.has(other.id))){chosen.set(job.id,false);grew=true;}
  for(const job of jobs)if(chosen.has(job.id))for(const file of entryNeeds(job,jobs))if(file.kind==='file'&&!chosen.has(file.id)&&jobs.every(other=>!entryFiles(other).has(file.localId)||chosen.has(other.id))){chosen.set(file.id,true);grew=true;}
 }
 const order=new Map(jobs.map((job,index)=>[job.id,index]));
 return {root,also:jobs.filter(job=>job.id!==root.id&&chosen.has(job.id)).sort((a,b)=>order.get(a.id)!-order.get(b.id)!).map(job=>({job,attachment:chosen.get(job.id)!}))};
}

/** The device's own words for an answer that was not the server's (lib/client-submit.ts NOT_SERVER_ANSWER), the words an entry waiting
 *  behind another gets, and the drain's «sign in again»: an entry held for review with one of them before GSCO 2.13.81's fix goes back to the
 *  queue at the next sync (lib/offline-submit.ts), after the server confirmed the same account. */
export const SIGN_IN_AGAIN=['سجّل الدخول بنفس الحساب لإكمال رفع البيانات المحفوظة.','Sign in with the same account to upload your saved entries.'];
export const WAITS_FOR_CUSTOMER=['أكمل رفع العميل المرتبط أولًا.','Upload the linked customer first.'];
export const WAITS_FOR_ATTACHMENT=['يحتاج مرفق عرض السعر إلى المراجعة قبل رفع السجل.','The quotation attachment needs review before this entry can upload.'];
/** Which of the member's entries that need review go back to the queue: those held for an answer that was not the server's (`notAnswers`,
 *  the device's own words) or for an ended session, and those that waited (424) behind entries that no longer need review. An entry
 *  waiting behind one still held, or behind an archived one, stays. `active` is the list (lib/offline-store.ts listOutbox), `all` with the
 *  archive. */
export function stuckToRelease<T extends Entry&Pick<OfflineJob,'message'|'httpStatus'>>(active:T[],all:T[],notAnswers:readonly string[]):Set<string>{
 const held=(job:T)=>job.status==='blocked'&&!job.archivedAt;
 const released=new Set(active.filter(job=>held(job)&&(notAnswers.includes(job.message)||SIGN_IN_AGAIN.includes(job.message))).map(job=>job.id));
 for(let grew=true;grew;){
  grew=false;
  for(const job of active){
   if(released.has(job.id)||!held(job)||job.httpStatus!==424||![...WAITS_FOR_CUSTOMER,...WAITS_FOR_ATTACHMENT].includes(job.message))continue;
   if(entryNeeds(job,all).every(other=>!other.archivedAt&&(other.status!=='blocked'||released.has(other.id)))){released.add(job.id);grew=true;}
  }
 }
 return released;
}

/** Why an entry that needs review cannot be sent, when that is known: the server already has it (a duplicate), or the record it needs is no
 *  longer the member's. `date` is the day of the record it repeats; `recordId` that record. */
export type OfflineReview={kind:'duplicate';date?:string;recordId?:string}|{kind:'unavailable';target:'customer'|'opportunity'};
/** The routes' own refusals that mean the record an entry needs is no longer the member's (closed, moved or deleted): the customer is not
 *  among what the member sees (deleted, or moved to another member or region), or the opportunity a follow-up continues is gone or closed.
 *  Read for an entry held before the follow-ups route sent its codes, and for the routes that send none (tests/offline-stuck-entries.mjs
 *  holds each to its route). */
export const UNAVAILABLE_REFUSALS:{url:string;status:number;error:string;target:'customer'|'opportunity'}[]=[
 {url:'/api/visits',status:403,error:'اختر العميل',target:'customer'},
 {url:'/api/customer-followups',status:403,error:'اختر العميل',target:'customer'},
 {url:'/api/customer-followups',status:403,error:'المتابعة لا تتبع هذا العميل',target:'opportunity'},
 {url:'/api/customer-followups',status:400,error:'المتابعة تتطلب زيارة سابقة بها إجراء قادم وموعد متابعة.',target:'opportunity'},
 {url:'/api/customer-service',status:403,error:'العميل خارج نطاق صلاحيتك',target:'customer'},
 {url:'/api/visit-files',status:403,error:'العميل غير متاح',target:'customer'}
];
/** The routes' refusals of a request whose key is already saved with other data: the entry itself is on the server. */
export const ALREADY_SAVED=/تم حفظ هذه (?:العملية|المتابعة) بالفعل|العملية محفوظة ببيانات مختلفة|الزيارة محفوظة بالفعل|تم رفع هذا الملف ببيانات مختلفة/;
const riyadhDay=(value:string)=>{const at=Date.parse(value);return Number.isFinite(at)?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at)):'';};
/** The day a record is of: a visit's or a follow-up's own day, else the day it was saved (Riyadh). */
export const recordDay=(record:Pick<Row,'data'|'createdAt'>)=>typeof record.data?.date==='string'&&DAY.test(record.data.date)?record.data.date:riyadhDay(record.createdAt);
const confirmed=(records:Row[])=>records.filter(row=>!row.data?._offlineState);
/** The member's own follow-up on the same opportunity (the visit or contact `sourceId`) of the same customer, other than `except`: the
 *  newest, among `records` (what the member sees). What a follow-up saved twice meets; the server's follow-ups route asks it too. */
export function ownFollowupOn<T extends Pick<Row,'id'|'kind'|'parentId'|'data'|'createdAt'>>(records:T[],customerId:string,sourceId:unknown,memberId:string,except:string):T|undefined{
 if(typeof sourceId!=='string'||!sourceId||!customerId)return undefined;
 return records.filter(row=>row.kind==='activity'&&row.id!==except&&!row.data?._offlineState&&row.parentId===customerId&&row.data?.visitWorkflow==='followup-v1'&&row.data?.sourceId===sourceId&&row.data?.performedBy===memberId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
}
/** The same for a follow-up kept on the device, read from the device's copy of the server's records. */
export function followupTwin(job:Pick<OfflineJob,'kind'|'body'|'localId'>,records:Row[],me:Pick<Member,'id'>):Row|undefined{
 return job.kind==='followup'?ownFollowupOn(records,entryCustomerId(job),entrySourceId(job),me.id,job.localId):undefined;
}
/** What an entry that needs review is about (null when nothing more than the server's message is known): first the server's code, then its
 *  words, then the device's copy of the records (a follow-up on an opportunity the member already followed). An entry held for an answer
 *  that was not the server's says nothing here: it goes back to the queue at the next sync. */
export function offlineReview(job:Pick<OfflineJob,'kind'|'url'|'body'|'localId'|'status'|'archivedAt'|'message'|'httpStatus'|'answer'>,records:Row[],me:Pick<Member,'id'>,notAnswers:readonly string[]=[]):OfflineReview|null{
 if(!deletableOfflineEntry(job)||notAnswers.includes(job.message))return null;
 const status=job.httpStatus||0,code=job.answer?.code;
 if(code===OFFLINE_REFUSAL.customerUnavailable)return {kind:'unavailable',target:'customer'};
 if(code===OFFLINE_REFUSAL.opportunityUnavailable)return {kind:'unavailable',target:'opportunity'};
 const known=UNAVAILABLE_REFUSALS.find(item=>item.url===job.url&&item.status===status&&item.error===job.message);
 if(known)return {kind:'unavailable',target:known.target};
 if(status===404||status===410)return {kind:'unavailable',target:'customer'};
 if(status!==409)return null;
 const rows=confirmed(records),named=job.answer?.duplicate;
 if(code===OFFLINE_REFUSAL.duplicate||ALREADY_SAVED.test(job.message)){
  const recordId=named?.id||(ALREADY_SAVED.test(job.message)?job.localId:followupTwin(job,records,me)?.id),record=recordId?rows.find(row=>row.id===recordId):undefined;
  const date=named?.date||(record?recordDay(record):undefined);
  return {kind:'duplicate',...(date?{date}:{}),...(recordId?{recordId}:{})};
 }
 const twin=followupTwin(job,records,me);
 return twin?{kind:'duplicate',date:recordDay(twin),recordId:twin.id}:null;
}

/** What the member reads: the date, when known, is returned apart so the screen can keep it left to right. */
export function offlineReviewText(review:OfflineReview,kind:OfflineKind,language?:string):{text:string;date?:string}{
 if(review.kind==='unavailable')return {text:review.target==='opportunity'
  ?say(language,'لم تعد الفرصة متاحة لك (أُغلقت أو نُقلت أو حُذفت)، لذلك لا يمكن إرسال هذا الإدخال. يمكنك حذفه من الجهاز.','The opportunity is no longer available to you (it was closed, moved or deleted), so this entry cannot be sent. You can delete it from the device.')
  :say(language,'لم يعد العميل متاحًا لك (نُقل أو حُذف)، لذلك لا يمكن إرسال هذا الإدخال. يمكنك حذفه من الجهاز.','The customer is no longer available to you (it was moved or deleted), so this entry cannot be sent. You can delete it from the device.')};
 const date=review.date;
 const dated:Record<OfflineKind,[string,string]>={
  followup:[`يبدو أن هذه المتابعة مسجلة بالفعل: متابعة على الفرصة نفسها بتاريخ ${date}. إن كانت مكررة فاحذفها من الجهاز.`,`This follow-up seems to be recorded already: a follow-up on the same opportunity dated ${date}. If it is a duplicate, delete it from the device.`],
  visit:[`يبدو أن هذه الزيارة مسجلة بالفعل: زيارة للعميل نفسه بتاريخ ${date}. إن كانت مكررة فاحذفها من الجهاز.`,`This visit seems to be recorded already: a visit to the same customer dated ${date}. If it is a duplicate, delete it from the device.`],
  service:[`يبدو أن هذه الفرصة مسجلة بالفعل: فرصة للعميل نفسه بتاريخ ${date}. إن كانت مكررة فاحذفها من الجهاز.`,`This opportunity seems to be recorded already: an opportunity for the same customer dated ${date}. If it is a duplicate, delete it from the device.`],
  customer:[`يبدو أن هذا العميل مسجل بالفعل: عميل سجّلته بتاريخ ${date}. إن كان مكررًا فاحذفه من الجهاز.`,`This customer seems to be registered already: a customer you registered on ${date}. If it is a duplicate, delete it from the device.`],
  file:['يبدو أن هذا المرفق مرفوع بالفعل. إن كان مكررًا فاحذفه من الجهاز.','This attachment seems to be uploaded already. If it is a duplicate, delete it from the device.']
 };
 const undated:Record<OfflineKind,[string,string]>={
  followup:['يبدو أن هذه المتابعة مسجلة بالفعل: متابعة على الفرصة نفسها محفوظة على الخادم. إن كانت مكررة فاحذفها من الجهاز.','This follow-up seems to be recorded already: a follow-up on the same opportunity is saved on the server. If it is a duplicate, delete it from the device.'],
  visit:['يبدو أن هذه الزيارة مسجلة بالفعل على الخادم. إن كانت مكررة فاحذفها من الجهاز.','This visit seems to be recorded already on the server. If it is a duplicate, delete it from the device.'],
  service:['يبدو أن هذه الفرصة مسجلة بالفعل على الخادم. إن كانت مكررة فاحذفها من الجهاز.','This opportunity seems to be recorded already on the server. If it is a duplicate, delete it from the device.'],
  customer:['يبدو أن هذا العميل مسجل بالفعل على الخادم. إن كان مكررًا فاحذفه من الجهاز.','This customer seems to be registered already on the server. If it is a duplicate, delete it from the device.'],
  file:dated.file
 };
 const [ar,en]=(date&&kind!=='file'?dated:undated)[kind];
 return {text:say(language,ar,en),...(date&&kind!=='file'?{date}:{})};
}

/** The kind of an entry as the list names it (customer service records opportunities, not visits: lib/service-wording.ts). */
export function offlineEntryNoun(kind:OfflineKind,language?:string){
 const nouns:Record<OfflineKind,[string,string]>={customer:['عميل جديد','New customer'],visit:['زيارة','Visit'],followup:['متابعة','Follow-up'],service:['فرصة','Opportunity'],file:['مرفق','Attachment']};
 return say(language,...nouns[kind]);
}

/** «فتح العميل الموجود»: a customer the same member registered (its `_createdBy`), among what the member sees on the server, at the same
 *  place as a new customer kept on the device: within SAME_PLACE_METERS of it (two fixes of the same phone at the same factory differ by a
 *  few metres to some tens). The nearest one, or none. */
export const SAME_PLACE_METERS=50;
/** The event that opens that customer's sheet in the CRM page (app/crm-app.tsx listens), only if this member's data holds it. */
export const OPEN_CUSTOMER_EVENT='yourrest:open-customer';
export function samePlaceCustomer(job:Pick<OfflineJob,'kind'|'body'|'localId'>,records:Row[],me:Pick<Member,'id'>):Row|undefined{
 if(job.kind!=='customer')return;
 const data=bodyOf(job).data,point=isObject(data)?customerCoordinates({location:typeof data.location==='string'?data.location:'',latitude:typeof data.latitude==='number'?data.latitude:null,longitude:typeof data.longitude==='number'?data.longitude:null}):null;
 if(!point)return;
 let best:{row:Row;meters:number}|undefined;
 for(const row of confirmed(records)){
  if(row.kind!=='customer'||row.id===job.localId||row.data?._createdBy!==me.id)continue;
  const there=customerCoordinates(row.data||{});if(!there)continue;
  const meters=distanceMeters(point,there);if(meters<=SAME_PLACE_METERS&&(!best||meters<best.meters))best={row,meters};
 }
 return best?.row;
}

/** Why a deletion was refused: a sync is running, the entry no longer needs review, or what goes with it changed after it was shown. */
export type OfflineDeletionRefusal='syncing'|'not-review'|'changed';
export function offlineDeletionRefusalText(reason:OfflineDeletionRefusal,language?:string){
 return reason==='syncing'?say(language,'الحذف غير متاح أثناء المزامنة. انتظر حتى تنتهي ثم أعد المحاولة.','Deleting is not available while a sync is running. Wait until it finishes, then try again.')
  :reason==='not-review'?say(language,'يمكن حذف الإدخالات التي تحتاج إلى مراجعة فقط. لا يزال هذا الإدخال في انتظار الرفع.','Only entries that need review can be deleted. This entry is still waiting to be sent.')
  :say(language,'تغيّرت الإدخالات المرتبطة بهذا الإدخال. راجع القائمة ثم أعد المحاولة.','The entries linked to this one changed. Review the list, then try again.');
}
