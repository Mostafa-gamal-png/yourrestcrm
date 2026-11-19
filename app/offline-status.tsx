'use client';
import {useEffect,useId,useState,useSyncExternalStore} from 'react';
import {CloudUpload,Loader2,WifiOff,CheckCircle2,AlertCircle,Trash2,MapPin} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {t,useLanguage,direction} from '@/lib/i18n';
import type {Member,Row} from '@/lib/crm';
import {listOutbox,listOfflineArchive,archiveOfflineJob,deleteOfflineEntry,subscribeOffline,OfflineDeletionError,type OfflineJob} from '@/lib/offline-store';
import {completeOfflineEntry,currentOfflineSnapshot,flushOutbox,offlineEntryFields,offlineNotAnswers,outboxDraining,relocateOfflineCustomer,retryOutbox,subscribeOutboxDraining,OFFLINE_CUSTOMER_PLACE_FIELDS,type OfflineEntryFields} from '@/lib/offline-submit';
import {deletableOfflineEntry,offlineDeletion,offlineDeletionRefusalText,offlineEntryNoun,offlineReview,offlineReviewText,samePlaceCustomer,OPEN_CUSTOMER_EVENT,type OfflineDeletion} from '@/lib/offline-review';
import CustomerLocationFields,{type CustomerData} from './customer-entry-fields';
import {opportunityProblems,type OpportunityField} from '@/lib/opportunity-entry';
import {serviceText} from '@/lib/service-wording';
import {visitResults} from '@/lib/visits';
import VoiceField from './voice-field';
import './offline-status.css';

const messageOf=(e:unknown)=>typeof e==='object'&&e!==null&&'message' in e&&typeof e.message==='string'?e.message:'';
type JobFields={name?:string;summary?:string;result?:string;nextAction?:string;nextDate?:string;customerNeeds?:string;location?:string;competitorName?:string;competitorNotes?:string;competitorFileName?:string;competitorObservation?:JobFields};
type JobPayload={customerId?:string;data?:JobFields;registration?:JobFields};
const riyadhDay=(value:string)=>{const at=Date.parse(value);return Number.isFinite(at)?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at)):'';};
/** A queued new visit or contact the server sent back for lacking its result or next step (lib/opportunity-entry.ts): the member adds
 *  what is missing here, with the form's own choices and words, and the same entry is sent again (lib/offline-submit.ts completeOfflineEntry).
 *  Nothing is shown for any other entry, nor once it has what it needs (its message then is another and «إعادة المحاولة» stays). */
export function CompleteOfflineEntry({job,me,offline,busy,onSave}:{job:OfflineJob;me:Member;offline:boolean;busy:boolean;onSave:(fields:OfflineEntryFields)=>Promise<void>}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar,w=(text:string)=>t(serviceText(me.role,text));
 const stored=offlineEntryFields(job),missing=stored?opportunityProblems(stored,me.role):{};
 const [fields,setFields]=useState<OfflineEntryFields>(()=>({result:typeof stored?.result==='string'?stored.result:'',nextAction:typeof stored?.nextAction==='string'?stored.nextAction:'',nextDate:typeof stored?.nextDate==='string'?stored.nextDate:''}));
 const [problems,setProblems]=useState<Partial<Record<OpportunityField,string>>>({});
 if(!stored||job.status!=='blocked'||job.archivedAt||!Object.keys(missing).length)return null;
 const asked=(Object.keys(missing) as OpportunityField[]),min=riyadhDay(job.capturedAt)||undefined,base='offline-complete-'+job.id.replace(/[^a-zA-Z0-9_-]/g,'-');
 const set=(field:OpportunityField,value:string)=>{setFields(current=>({...current,[field]:value}));setProblems(current=>{if(!current[field])return current;const next={...current};delete next[field];return next;});};
 const problem=(field:OpportunityField)=>problems[field]?<small className="field-problem" role="alert" id={base+'-'+field+'-problem'} data-field-problem>{w(problems[field]!)}</small>:null;
 const resultLabel=w(stored.type==='visit'?'نتيجة الزيارة':'نتيجة التواصل');
 return <form className="offline-complete" noValidate data-offline-complete={job.id} onSubmit={event=>{event.preventDefault();if(busy||offline)return;const found=opportunityProblems({type:stored.type,...stored,...fields},me.role);const shown=Object.fromEntries(asked.filter(field=>found[field]).map(field=>[field,found[field]]));setProblems(shown);if(Object.keys(shown).length){document.getElementById(base+'-'+Object.keys(shown)[0])?.focus();return;}void onSave(Object.fromEntries(asked.map(field=>[field,fields[field]||''])));}}>
  <p className="offline-complete-intro">{say('أكمل ما ينقص هذا الإدخال، ثم يُرسل مرة أخرى بنفس بياناته ووقت تسجيله.','Complete what this entry lacks; it is then sent again with its own entries and recording time.')}</p>
  {asked.includes('result')&&<label className={'field'+(problems.result?' has-problem':'')}><span>{resultLabel} <b>*</b></span><select id={base+'-result'} value={fields.result||''} aria-invalid={problems.result?true:undefined} aria-describedby={problems.result?base+'-result-problem':undefined} onChange={event=>set('result',event.target.value)} disabled={busy}><option value="">{w(stored.type==='visit'?'اختر نتيجة الزيارة':'اختر نتيجة التواصل')}</option>{visitResults.map(result=><option key={result} value={result}>{t(result)}</option>)}</select>{problem('result')}</label>}
  {asked.includes('nextAction')&&<VoiceField label={t('الإجراء القادم')} marked value={fields.nextAction||''} onChange={value=>set('nextAction',value)} disabled={busy} contextKey={'offline-complete:'+job.id} problem={problems.nextAction?w(problems.nextAction):''} inputProps={{id:base+'-nextAction',maxLength:250}}/>}
  {asked.includes('nextDate')&&<label className={'field'+(problems.nextDate?' has-problem':'')}><span>{t('موعد المتابعة القادمة')} <b>*</b></span><input id={base+'-nextDate'} type="date" min={min} value={fields.nextDate||''} aria-invalid={problems.nextDate?true:undefined} aria-describedby={problems.nextDate?base+'-nextDate-problem':undefined} onChange={event=>set('nextDate',event.target.value)} disabled={busy}/>{problem('nextDate')}</label>}
  <button type="submit" className="btn primary small" disabled={busy||offline} data-offline-complete-save>{say('حفظ وإعادة المحاولة','Save and retry')}</button>
 </form>;
}

/** The message with its day kept left to right inside the Arabic. */
function dated({text,date}:{text:string;date?:string}){if(!date||!text.includes(date))return text;const [before,...after]=text.split(date);return <>{before}<bdi dir="ltr">{date}</bdi>{after.join(date)}</>;}
const entryName=(job:OfflineJob,language:string)=>job.kind==='file'?job.fileName||job.label:job.label||offlineEntryNoun(job.kind,language);

/** «تعديل موقع العميل» of a new customer kept on the device that needs review (lib/offline-submit.ts relocateOfflineCustomer): the customer
 *  form's own location fields (typed, chosen on the map, or the phone's current position), then the same entry is sent again. */
function OfflineCustomerPlace({job,offline,busy,onSave,onClose}:{job:OfflineJob;offline:boolean;busy:boolean;onSave:(fields:Record<string,unknown>)=>Promise<string>;onClose:()=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar;
 const [draft,setDraft]=useState<CustomerData>(()=>{try{const body=JSON.parse(job.body||'{}');return typeof body.data==='object'&&body.data?{...body.data}:{};}catch{return {};}});
 const [pending,setPending]=useState(false),[problem,setProblem]=useState(''),errorId=useId();
 const save=async()=>{if(busy||offline||pending)return;setProblem('');if(!String(draft.location||'').trim()){setProblem(say('أدخل موقع العميل أو اختره على الخريطة.','Enter the customer\'s location or choose it on the map.'));return;}const fields=Object.fromEntries(OFFLINE_CUSTOMER_PLACE_FIELDS.map(key=>[key,draft[key]]));const failure=await onSave(fields);if(failure)setProblem(failure);};
 return <div className="offline-place" data-offline-place={job.id}>
  <p className="offline-complete-intro">{say('صحّح موقع العميل، ثم يُرسل الإدخال مرة أخرى بنفس بياناته ووقت تسجيله.','Correct the customer\'s location; the entry is then sent again with its own entries and recording time.')}</p>
  <CustomerLocationFields data={draft} editing disabled={busy} onUpdate={update=>{setProblem('');setDraft(current=>update(current));}} onPendingChange={setPending}/>
  {problem&&<p className="offline-sync-error" role="alert" id={errorId}>{t(problem)}</p>}
  <div className="offline-entry-actions">
   <button type="button" className="btn primary small" disabled={busy||offline||pending} aria-describedby={problem?errorId:undefined} onClick={()=>void save()} data-offline-place-save>{say('حفظ الموقع وإعادة المحاولة','Save location and retry')}</button>
   <button type="button" className="btn subtle small" disabled={busy} onClick={onClose}>{say('إلغاء','Cancel')}</button>
  </div>
 </div>;
}

/** «حذف هذا الإدخال من الجهاز»: what goes with it is listed first, and nothing is deleted while a sync is running (the reason is shown). */
function OfflineEntryDelete({job,plan,open,syncing,busy,onOpen,onCancel,onConfirm}:{job:OfflineJob;plan:OfflineDeletion|null;open:boolean;syncing:boolean;busy:boolean;onOpen:()=>void;onCancel:()=>void;onConfirm:()=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar,reasonId=useId();
 const reason=syncing?<small className="offline-delete-reason" id={reasonId}>{offlineDeletionRefusalText('syncing',language)}</small>:null;
 if(!open)return <div className="offline-delete-row">
  <button type="button" className="text-button danger" disabled={busy||syncing} aria-describedby={syncing?reasonId:undefined} onClick={onOpen} data-offline-delete={job.id}><Trash2 size={15}/>{say('حذف هذا الإدخال من الجهاز','Delete this entry from the device')}</button>{reason}
 </div>;
 return <div className="offline-delete-confirm" role="group" aria-label={say('تأكيد حذف الإدخال من الجهاز','Confirm deleting the entry from the device')} data-offline-delete-confirm={job.id}>
  <p>{say('سيُحذف هذا الإدخال من هذا الجهاز ولن يُرسل إلى الخادم. لا يمكن التراجع عن ذلك.','This entry will be deleted from this device and will not be sent to the server. This cannot be undone.')}</p>
  {!!plan?.also.length&&<>
   <p>{say('ويُحذف معه أيضًا ما يرتبط به من إدخالات ومرفقات ('+plan.also.length+'):','Also deleted with it, the entries and attachments linked to it ('+plan.also.length+'):')}</p>
   <ul className="offline-delete-list">{plan.also.map(({job:item})=><li key={item.id} data-offline-delete-item={item.id}>{offlineEntryNoun(item.kind,language)} · <bdi>{entryName(item,language)}</bdi>{item.archivedAt?' · '+say('مؤرشف','archived'):''}</li>)}</ul>
  </>}
  <div className="offline-entry-actions">
   <button type="button" className="btn danger small" disabled={busy||syncing||!plan} aria-describedby={syncing?reasonId:undefined} onClick={onConfirm} data-offline-delete-confirm-button>{busy?<Loader2 size={15} className="spin"/>:<Trash2 size={15}/>}{say('تأكيد الحذف','Confirm delete')}</button>
   <button type="button" className="btn subtle small" disabled={busy} onClick={onCancel}>{say('إلغاء','Cancel')}</button>
  </div>
  {reason}
 </div>;
}

/** Device-only entries stay visibly separate from confirmed server records. An entry that needs review says why when that is known (lib/
 *  offline-review.ts: already saved on the server, or its customer or opportunity no longer the member's), and may be deleted from the
 *  device; a new customer may have its location corrected, and opens the customer the member already registered at the same place. */
export default function OfflineStatus({me,offline}:{me:Member;offline:boolean}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar;
 const [jobs,setJobs]=useState<OfflineJob[]>([]),[archive,setArchive]=useState<OfflineJob[]>([]),[showArchive,setShowArchive]=useState(false),[archiveId,setArchiveId]=useState(''),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [records,setRecords]=useState<Row[]>([]),[deleteId,setDeleteId]=useState(''),[placeId,setPlaceId]=useState(''),[notice,setNotice]=useState(''),draining=useSyncExternalStore(subscribeOutboxDraining,outboxDraining,()=>false);
 useEffect(()=>{let alive=true;setJobs([]);setArchive([]);setArchiveId('');setDeleteId('');setPlaceId('');const read=()=>{void Promise.all([listOutbox(me),listOfflineArchive(me)]).then(([rows,archived])=>{if(alive){setJobs(rows);setArchive(archived);}}).catch(()=>{if(alive)setError(say('تعذر قراءة الإدخالات المحفوظة على الجهاز.','Could not read entries saved on this device.'));});};read();const unsub=subscribeOffline(read);return()=>{alive=false;unsub();};},[me.id,me.authVersion,me.role,me.regionScope,language]);
 // What the server holds, as this device last read it: only while the list is open with entries that need review (the duplicate's day, the
 // customer at the same place).
 const reviewing=open&&[...jobs,...archive].some(deletableOfflineEntry);
 // A sync changes the outbox many times in a row: the copy is read again once they settle.
 useEffect(()=>{if(!reviewing)return;let alive=true,timer:ReturnType<typeof setTimeout>|undefined;const read=()=>{void currentOfflineSnapshot().then(snapshot=>{if(alive)setRecords(snapshot?.records||[]);}).catch(()=>{});};read();const unsub=subscribeOffline(()=>{clearTimeout(timer);timer=setTimeout(read,300);});return()=>{alive=false;clearTimeout(timer);unsub();};},[reviewing,me.id]);
 // A sync sends entries now: this tab holds the lease (lib/offline-submit.ts) or an entry is being sent from any tab.
 const sending=draining||jobs.some(job=>job.status==='syncing'),blocked=jobs.filter(job=>job.status==='blocked').length,syncing=busy||sending;
 const everything=[...jobs,...archive],notAnswers=offlineNotAnswers();
 async function sync(id?:string){if(busy||offline)return;setBusy(true);setError('');setNotice('');try{if(id)await retryOutbox(id,me);else await flushOutbox(me);}catch(e){setError(messageOf(e)||say('تعذرت المزامنة؛ الإدخالات محفوظة.','Sync failed; your entries are still saved.'));}finally{setBusy(false);}}
 async function complete(job:OfflineJob,fields:OfflineEntryFields){if(busy||offline)return;setBusy(true);setError('');setNotice('');try{await completeOfflineEntry(job.id,me,fields);}catch(e){setError(messageOf(e)||say('تعذرت المزامنة؛ الإدخالات محفوظة.','Sync failed; your entries are still saved.'));}finally{setBusy(false);}}
 async function archiveEntry(job:OfflineJob){if(busy)return;setBusy(true);setError('');setNotice('');try{await archiveOfflineJob(job.id,me);setArchiveId('');}catch(e){setError(messageOf(e));}finally{setBusy(false);}}
 async function removeEntry(job:OfflineJob,plan:OfflineDeletion|null){
  if(busy||sending||!plan)return;setBusy(true);setError('');setNotice('');
  try{const removed=await deleteOfflineEntry(job.id,me,[plan.root.id,...plan.also.map(item=>item.job.id)]);setDeleteId('');setNotice(removed.length>1?say('حُذف الإدخال من الجهاز مع ما يرتبط به ('+(removed.length-1)+').','The entry was deleted from this device with what was linked to it ('+(removed.length-1)+').'):say('حُذف الإدخال من الجهاز.','The entry was deleted from this device.'));}
  catch(e){setError(e instanceof OfflineDeletionError?offlineDeletionRefusalText(e.reason,language):t(messageOf(e))||say('تعذر حذف الإدخال من الجهاز.','The entry could not be deleted from this device.'));}
  finally{setBusy(false);}
 }
 async function relocate(job:OfflineJob,fields:Record<string,unknown>){
  if(busy||offline)return '';setBusy(true);setError('');setNotice('');
  try{await relocateOfflineCustomer(job.id,me,fields);setPlaceId('');return '';}catch(e){return messageOf(e)||say('تعذرت المزامنة؛ الإدخالات محفوظة.','Sync failed; your entries are still saved.');}finally{setBusy(false);}
 }
 function openExisting(id:string){setOpen(false);window.dispatchEvent(new CustomEvent(OPEN_CUSTOMER_EVENT,{detail:{id}}));}
 function details(job:OfflineJob){let payload:JobPayload={};try{payload=JSON.parse(job.body||'{}');}catch{}const data=payload.data||payload.registration||{},observation=data.competitorObservation||data;return [
  [say('العميل','Customer'),data.name||payload.customerId],
  [say('الهدف','Purpose'),data.summary],
  [say('النتيجة','Outcome'),data.result],
  [say('الإجراء القادم','Next action'),data.nextAction],
  [say('موعد المتابعة','Follow-up date'),data.nextDate],
  [say('المنافس','Competitor'),observation.competitorName],
  [say('ملاحظات المنافس','Competitor notes'),observation.competitorNotes],
  [say('الاحتياج','Customer needs'),data.customerNeeds],
  [say('الموقع','Location'),data.location],
  [say('المرفق','Attachment'),job.fileName||observation.competitorFileName],
 ].filter(([,value])=>typeof value==='string'&&value.trim());}
 return <>
  {(offline||jobs.length>0||archive.length>0||error)&&<div className={'offline-sync-strip'+(blocked?' has-errors':'')} role="status">
   {offline?<WifiOff size={18}/>:syncing?<Loader2 size={18} className="spin"/>:blocked?<AlertCircle size={18}/>:<CloudUpload size={18}/>}
   <span>{offline?say('بدون شبكة · التسجيل محفوظ على الجهاز','Offline · entries are saved on this device'):syncing?say('جارٍ رفع الإدخالات المحفوظة…','Syncing saved entries…'):blocked?say('إدخالات محفوظة تحتاج مراجعة','Saved entries need review'):!jobs.length&&archive.length?say('إدخالات مؤرشفة للمراجعة','Entries archived for review'):say('إدخالات بانتظار الرفع','Entries waiting to sync')}{jobs.length>0&&<b> · {jobs.length}</b>}</span>
   <button type="button" onClick={()=>setOpen(true)}>{say('حالة الحفظ','Save status')}</button>
  </div>}
  <Dialog open={open} onOpenChange={value=>{setOpen(value);if(!value){setDeleteId('');setPlaceId('');setNotice('');}}}><DialogContent className="crm-dialog offline-sync-dialog" dir={direction()}>
   <DialogTitle>{say('الإدخالات المحفوظة على الجهاز','Entries saved on this device')}</DialogTitle>
   <DialogDescription>{say('تُرفع تلقائيًا عند رجوع الإنترنت والتطبيق مفتوح، وتظل محفوظة هنا حتى يؤكد الخادم استلامها.','Entries sync automatically when internet returns and the app is open. They remain here until the server confirms receipt.')}</DialogDescription>
   {error&&<p className="form-error" role="alert">{error}</p>}
   <p className="offline-sync-notice" role="status">{notice}</p>
   {archive.length>0&&<button type="button" className="text-button" aria-pressed={showArchive} onClick={()=>setShowArchive(value=>!value)}>{say('الأرشيف المحلي','Local archive')} ({archive.length})</button>}
   {!jobs.length&&!showArchive?<p className="offline-sync-empty"><CheckCircle2 size={22}/>{say('لا توجد إدخالات بانتظار الرفع.','No entries waiting to sync.')}</p>:<ul className="offline-sync-list">{[...jobs,...(showArchive?archive:[])].map(job=>{
    const review=offlineReview(job,records,me,notAnswers),reviewNote=review?offlineReviewText(review,job.kind,language):null;
    const active=job.status==='blocked'&&!job.archivedAt,twin=active?samePlaceCustomer(job,records,me):undefined,plan=deleteId===job.id?offlineDeletion(job.id,everything):null;
    return <li key={job.id} data-offline-entry={job.id}>
    <div className="offline-sync-title"><strong>{job.label||say('إدخال محفوظ','Saved entry')}</strong><span>{job.archivedAt?say('مؤرشف على الجهاز','Archived on this device'):job.status==='blocked'?say('تحتاج مراجعة','Needs review'):job.status==='syncing'?say('جارٍ الرفع','Syncing'):say('بانتظار الرفع','Waiting to sync')}</span></div>
    <time dateTime={job.capturedAt}>{new Intl.DateTimeFormat(language==='en'?'en-GB':'ar-SA',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Riyadh'}).format(new Date(job.capturedAt))}</time>
    {review&&reviewNote&&<p className="offline-review-note" data-offline-review={review.kind}>{dated(reviewNote)}</p>}
    {job.message&&<p className="offline-sync-error">{review?<span className="offline-sync-server">{say('رد الخادم: ','Server reply: ')}</span>:null}{t(job.message)}</p>}
    {twin&&<div className="offline-same-place" data-offline-same-place={twin.id}><p>{say('يوجد عميل سجّلته في الموقع نفسه: ','A customer you registered is at the same place: ')}<bdi>{String(twin.data?.name||'')}</bdi>{say('. إن كان هو نفسه فافتحه واحذف هذا الإدخال من الجهاز.','. If it is the same one, open it and delete this entry from the device.')}</p><button type="button" className="btn subtle small" onClick={()=>openExisting(twin.id)} data-offline-open-existing>{say('فتح العميل الموجود','Open the existing customer')}</button></div>}
    <CompleteOfflineEntry key={job.id+':'+job.fingerprint} job={job} me={me} offline={offline} busy={busy} onSave={fields=>complete(job,fields)}/>
    {active&&job.kind==='customer'&&(placeId===job.id?<OfflineCustomerPlace key={job.id+':'+job.fingerprint} job={job} offline={offline} busy={busy} onSave={fields=>relocate(job,fields)} onClose={()=>setPlaceId('')}/>:<button type="button" className="text-button" disabled={busy} onClick={()=>{setPlaceId(job.id);setDeleteId('');}} data-offline-place-open={job.id}><MapPin size={15}/>{say('تعديل موقع العميل','Edit the customer\'s location')}</button>)}
    <details><summary>{say('عرض البيانات المحفوظة','View saved entries')}</summary><dl>{details(job).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>
    {active&&<button type="button" className="btn subtle small" disabled={offline||busy} onClick={()=>void sync(job.id)}>{say('إعادة المحاولة','Retry')}</button>}
    {active&&(archiveId===job.id?<div className="offline-archive-confirm"><p>{say('يظل الإدخال محفوظًا في الأرشيف المحلي ولن يُرفع تلقائيًا. راجع سجل العميل ثم سجّل متابعة صحيحة عند الحاجة.','This entry stays in the local archive and will not upload automatically. Review the customer history before recording a new follow-up.')}</p><button type="button" className="btn subtle small" disabled={busy} onClick={()=>void archiveEntry(job)}>{say('تأكيد الأرشفة','Confirm archive')}</button><button type="button" className="btn subtle small" disabled={busy} onClick={()=>setArchiveId('')}>{say('إلغاء','Cancel')}</button></div>:<button type="button" className="text-button" disabled={busy} onClick={()=>setArchiveId(job.id)}>{say('أرشفة للمراجعة','Archive for review')}</button>)}
    {job.archivedAt&&<p className="muted">{say('نسخة محفوظة محليًا للمراجعة؛ لا تدخل في المزامنة الآلية.','A local review copy; excluded from automatic sync.')}</p>}
    {deletableOfflineEntry(job)&&<OfflineEntryDelete job={job} plan={plan} open={deleteId===job.id} syncing={sending} busy={busy} onOpen={()=>{setDeleteId(job.id);setArchiveId('');setPlaceId('');setNotice('');}} onCancel={()=>setDeleteId('')} onConfirm={()=>void removeEntry(job,plan)}/>}
   </li>;})}</ul>}
   <footer className="form-footer"><button type="button" className="btn subtle" onClick={()=>setOpen(false)}>{say('إغلاق','Close')}</button><button type="button" className="btn primary" disabled={offline||busy||!jobs.length} onClick={()=>void sync()}>{busy?<Loader2 size={17} className="spin"/>:<CloudUpload size={17}/>} {say('مزامنة الآن','Sync now')}</button></footer>
  </DialogContent></Dialog>
 </>;
}
