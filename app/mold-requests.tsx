'use client';
import React,{useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {BadgeCheck,Factory,Hourglass,Loader2,Lock,Paperclip,RefreshCw,Search,Send,TriangleAlert,Undo2,Wrench} from 'lucide-react';
import {Sheet,SheetContent,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {useLanguage,direction,getLanguage} from '@/lib/i18n';
import {definiteSubmitRejection,submitJson,SubmitError} from '@/lib/client-submit';
import type {Member,Row} from '@/lib/crm';
import {MOLD_STAGES,MOLD_STAGE_NAMES,MOLD_CORES,MOLD_MODELS,MOLD_HALF_BLOCKS,MOLD_PENDING_REFRESH_MS,moldApprovalNames,moldErrorText,moldFieldNames,moldPendingAgain,moldProductionOnly,moldSendingNames,moldStatusNames,moldWaitingNames,yourrestNumber,type MoldPendingAnswer,type MoldRequestView,type MoldRequestsAnswer,type MoldSpecs} from '@/lib/mold-requests';
import {MOLD_DESIGN_MAX_FILES,MOLD_LIMITS,MOLD_USUAL,validateMoldSpecs} from '@/portable/mold-rules.mjs';
import VoiceField from './voice-field';
import {MoldDesignFiles,MoldDesignPicker,MoldPendingDesignFiles,designNeedsWarning,pendingFilesApprovedNote,designUploadQueue,designUsed,designWarningText,revealCentered,type DesignChoice,type DesignUpload,type DesignUploadQueue} from './mold-design-files';
import './mold-requests.css';

type Say=(ar:string,en:string)=>string;
const messageOf=(error:unknown)=>typeof error==='object'&&error!==null&&'message' in error&&typeof (error as {message:unknown}).message==='string'?(error as {message:string}).message:'';
const stamp=(iso:string|null|undefined)=>iso?new Date(iso).toLocaleString('en-GB',{timeZone:'Asia/Riyadh',dateStyle:'short',timeStyle:'short'}):'—';
const day=(value:string|null|undefined)=>value?value.slice(0,10):'—';
/** Where the request is: the step it waits at (since the approval chain), else production's status; the sales manager reads «waiting
 * for you» on what they can approve. */
// Cancelled in the CRM reads «cancelled» at once, even while the cancellation still waits to reach production (its sending state says so).
const statusText=(view:MoldRequestView,say:Say)=>view.can.approve?say('بانتظار اعتمادك','Waiting for your approval')
 :view.cancelled?say('ملغى','Cancelled'):view.remote?.status==='cancelled'?say('أُلغي في تطبيق الإنتاج','Cancelled in production'):view.remote?.waitingStep?say(...moldWaitingNames[view.remote.waitingStep]):view.remote?say(...moldStatusNames[view.remote.status]):say('لم يصل للإنتاج بعد','Not in production yet');
const waitingSince=(view:MoldRequestView,say:Say)=>!view.cancelled&&view.remote?.waitingSince&&!['done','cancelled'].includes(view.remote.waitingStep||'')?say('من ','Since ')+stamp(view.remote.waitingSince):'';

/** The mold requests the reader may see, with their status as pulled by the server when the list opens. */
export function useMoldRequests(me:Member|null){
 const [data,setData]=useState<MoldRequestsAnswer|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),generation=useRef(0);
 const identity=me?[me.id,me.role,me.authVersion].join(':'):'';
 const refresh=useCallback(async()=>{
  if(!identity)return;
  const current=++generation.current;setLoading(true);
  try{const next=await submitJson<MoldRequestsAnswer>('/api/mold-requests',{cache:'no-store'},{language:getLanguage()});if(current===generation.current){setData(next);setError('');}}
  catch(failure){if(current===generation.current)setError(messageOf(failure));}
  finally{if(current===generation.current)setLoading(false);}
 },[identity]);
 useEffect(()=>{const timer=window.setTimeout(()=>{void refresh();},0);return()=>window.clearTimeout(timer);},[refresh]);
 return {data,error,loading,refresh};
}

/** One write. A retry after an unclear failure keeps its identifier, so a request is never saved twice. */
function useMoldAction(onDone:(view:MoldRequestView|null)=>void){
 const lock=useRef(false),attempt=useRef<{body:string;key:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[fields,setFields]=useState<Record<string,string>>({});
 const run=useCallback(async(body:Record<string,unknown>)=>{
  if(lock.current)return null;
  lock.current=true;setBusy(true);setError('');setFields({});
  const text=JSON.stringify(body);if(attempt.current?.body!==text)attempt.current={body:text,key:crypto.randomUUID()};
  try{
   const reply=await submitJson<{request:MoldRequestView}>('/api/mold-requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,requestId:attempt.current.key})},{language:getLanguage()});
   attempt.current=null;onDone(reply.request);return reply.request;
  }catch(failure){
   // 409 from production comes with the request as production holds it: show both the reason and the restored request.
   const reply=failure instanceof SubmitError?failure.body as {request?:MoldRequestView;fields?:Record<string,string>}|undefined:undefined;
   if(reply?.fields)setFields(reply.fields);
   setError(messageOf(failure));if(definiteSubmitRejection(failure))attempt.current=null;
   if(reply?.request)onDone(reply.request);
   return null;
  }finally{lock.current=false;setBusy(false);}
 },[onDone]);
 return {run,busy,error,fields};
}

/** The seven stages in order, each with the date it was finished when production gave one (§3). */
export function MoldStages({view,say}:{view:MoldRequestView;say:Say}){
 const stages=view.remote?.stages;
 return <ol className="mold-stages" aria-label={say('مراحل التصنيع','Production stages')}>{MOLD_STAGES.map((key,index)=>{
  const stage=stages?.[key],done=!!stage?.done;
  return <li key={key} data-done={done} aria-current={!done&&MOLD_STAGES.slice(0,index).every(prior=>stages?.[prior]?.done)&&!!view.remote&&!view.remote.delivered&&view.remote.status!=='cancelled'&&!view.cancelled?'step':undefined}>
   <span className="mold-stage-dot" aria-hidden="true">{index+1}</span><span className="mold-stage-name" dir="ltr">{MOLD_STAGE_NAMES[key as keyof typeof MOLD_STAGE_NAMES]}</span>
   <small>{done?(stage?.at?day(stage.at):say('منتهية','Done')):say('لم تبدأ','Not yet')}</small>
  </li>;})}</ol>;
}

function SendingState({view,linkReady,say}:{view:MoldRequestView;linkReady:boolean;say:Say}){
 const sending=view.sending;
 if(sending.state==='sent')return null;
 const what=sending.outbox==='cancel'?say('الإلغاء','The cancellation'):say('الطلب','The request');
 return <div className="mold-sending" data-state={sending.state} role="status">
  <TriangleAlert size={16} aria-hidden="true"/>
  <div><strong>{say(...moldSendingNames[sending.state])}</strong>
   <p>{!linkReady?say('الطلب محفوظ في الـCRM، وسيُرسل عند تفعيل الربط مع الإنتاج.','The request is saved in the CRM and will be sent once the production link is set up.')
    :sending.state==='rejected'?say('رفض الإنتاج: ','Production refused: ')+((sending.error?.fields||[]).map(field=>say(...(moldFieldNames[field]||[field,field]))).join('، ')||moldErrorText(sending.error?.code||'',say))+'. '
     // Edited only while it has certainly never reached production; otherwise resent as it is, or cancelled and asked for again.
     +(view.can.edit?say('عدّل الطلب أو أعد إرساله.','Edit the request or resend it.'):say('أعد إرساله، أو ألغِه واطلبه من جديد.','Resend it, or cancel it and ask again.'))
    :what+' '+say('محفوظ في الـCRM ولم يصل للإنتاج بعد','is saved in the CRM and has not reached production yet')+(sending.error?': '+moldErrorText(sending.error.code,say):'')+'.'}</p>
   {linkReady&&sending.state==='waiting'&&<small>{sending.nextAttemptAt?say('المحاولة التالية تلقائيًا: ','Next automatic try: ')+stamp(sending.nextAttemptAt):say('توقفت المحاولات التلقائية بعد 24 ساعة؛ استخدم «إعادة الإرسال».','Automatic tries stopped after 24 hours; use Resend.')}{sending.attempts?' · '+say('محاولات: ','Tries: ')+sending.attempts:''}</small>}
  </div>
 </div>;
}

function MoldCard({view,linkReady,unsent,onOpen,say}:{view:MoldRequestView;linkReady:boolean;unsent:number;onOpen:()=>void;say:Say}){
 const remote=view.remote;
 return <button type="button" className="mold-card" data-status={view.cancelled?'cancelled':remote?.status||'local'} data-sending={view.sending.state} onClick={onOpen}>
  <header><strong>{view.customerName}</strong><span className="mold-chip" data-status={view.cancelled?'cancelled':remote?.status||'local'} data-step={view.cancelled?undefined:remote?.waitingStep||undefined} data-mine={view.can.approve||undefined}>{statusText(view,say)}</span></header>
  {waitingSince(view,say)&&<small className="mold-card-since"><Hourglass size={13} aria-hidden="true"/>{waitingSince(view,say)}</small>}
  <p dir="auto">{view.specs.description}</p>
  <div className="mold-card-facts">
   <span>{say('رقم أمر الإنتاج','Production order')}: <b>{remote?.orderNo??'—'}</b></span>
   <span>{say('الكمية','Quantity')}: <b>{view.specs.quantity}</b></span>
   <span>{say('المراحل','Stages')}: <b>{remote?remote.stagesDone+'/'+remote.stagesTotal:'—'}</b></span>
   <span>{say('مقدّم الطلب','Requested by')}: {view.memberName}</span>
   {!!view.designFiles.length&&<span className="mold-card-files"><Paperclip size={13} aria-hidden="true"/>{say('ملفات التصميم','Design files')}: <b>{view.designFiles.length}</b></span>}
  </div>
  {view.sending.state!=='sent'&&<small className="mold-card-sending" data-state={view.sending.state}>{say(...moldSendingNames[linkReady?view.sending.state:'off'])}</small>}
  {!!unsent&&<small className="mold-card-sending" data-state="rejected">{say('ملفات تصميم لم تُرفع: ','Design files not uploaded: ')+unsent+' · '+say('افتح الطلب للتفاصيل','open the request for details')}</small>}
 </button>;
}

/** The page: the requests the reader may see, the button to ask for a mold, the link's state. */
export function MoldRequestsPage({me,records}:{me:Member;records:Row[]}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const {data,error,loading,refresh}=useMoldRequests(me);
 const [openId,setOpenId]=useState<string|null>(null),[creating,setCreating]=useState(false),[query,setQuery]=useState('');
 const customers=useMemo(()=>records.filter(row=>row.kind==='customer'),[records]);
 const list=useMemo(()=>{const needle=query.trim().toLowerCase();return (data?.requests||[]).filter(view=>!needle||[view.customerName,view.specs.description,view.specs.moldNo,String(view.remote?.orderNo||''),view.memberName].some(text=>String(text||'').toLowerCase().includes(needle)));},[data,query]);
 const open=data?.requests.find(view=>view.id===openId)||null;
 const changed=useCallback(()=>{void refresh();},[refresh]);
 // Design files upload one at a time for as long as the app is open (a request's sheet may close, the member may visit another page and
 // come back to the same uploads); each answer refreshes the list.
 const [uploads]=useState(()=>designUploadQueue(me.id)),uploading=useSyncExternalStore(uploads.subscribe,uploads.snapshot,uploads.snapshot);
 useEffect(()=>uploads.listen('',()=>{void refresh();}),[uploads,refresh]);
 // The sales manager's waiting list comes with the page and is asked for again every few minutes while the page is open.
 const approver=data?.pending!==null&&data?.pending!==undefined,[tab,setTab]=useState<'pending'|'all'>('pending');
 useEffect(()=>{if(!approver)return;const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh();},MOLD_PENDING_REFRESH_MS);return()=>window.clearInterval(timer);},[approver,refresh]);
 const showPending=approver&&tab==='pending';
 return <section className="mold-page" dir={direction()}>
  <div className="mold-heading"><div><p>{say('يصل الطلب لتطبيق الإنتاج تلقائيًا، وتظهر هنا مراحل التصنيع حتى التسليم.','Requests reach the production application automatically; production stages show here until delivery.')}</p></div>
   <div className="mold-heading-tools"><button type="button" className="btn subtle" onClick={()=>void refresh()} disabled={loading} aria-label={say('تحديث','Refresh')}>{loading?<Loader2 className="spin" size={16}/>:<RefreshCw size={16}/>}</button>
    {data?.canCreate&&<button type="button" className="btn primary mold-new" onClick={()=>setCreating(true)}><Wrench size={16} aria-hidden="true"/>{say('طلب تصنيع قالب','Request a mold')}</button>}</div></div>
  {data&&!data.linkReady&&<p className="mold-banner" data-kind="off" role="status"><Lock size={16} aria-hidden="true"/>{say('الربط مع الإنتاج غير مفعَّل. الطلبات تُحفظ هنا وتنتظر الإرسال.','The production link is off. Requests are saved here and wait to be sent.')}</p>}
  {data?.statusError&&<p className="mold-banner" data-kind="stale" role="status"><TriangleAlert size={16} aria-hidden="true"/>{say('تعذّر تحديث المراحل الآن','Stages could not be refreshed now')}: {moldErrorText(data.statusError.code,say)}. {say('المعروض آخر حالة معروفة، ويتحدث عند الفتح التالي.','Showing the last known status; it refreshes next time.')}</p>}
  {error&&<p className="form-error" role="alert">{error}</p>}
  {approver&&<div className="mold-tabs" role="tablist">
   <button type="button" role="tab" aria-selected={tab==='pending'} className={tab==='pending'?'is-active':''} onClick={()=>setTab('pending')}>{say('طلبات بانتظار اعتمادي','Waiting for my approval')} <span className="mold-count">{data!.pending!.items.length}</span></button>
   <button type="button" role="tab" aria-selected={tab==='all'} className={tab==='all'?'is-active':''} onClick={()=>setTab('all')}>{say('كل الطلبات','All requests')}</button>
  </div>}
  {showPending&&<MoldPendingList pending={data!.pending!} say={say} onOpen={id=>setOpenId(id)} onChanged={changed}/>}
  {!showPending&&<>
  {!!data?.requests.length&&<label className="mold-search"><Search size={16} aria-hidden="true"/><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder={say('ابحث بالعميل أو الوصف أو رقم أمر الإنتاج','Search by customer, description or order')}/></label>}
  {data&&!list.length&&<p className="empty mold-empty">{data.requests.length?say('لا نتائج','No results'):say('لا توجد طلبات تصنيع قوالب بعد.','No mold requests yet.')}</p>}
  {!data&&!error&&<p className="empty"><Loader2 className="spin" size={16}/> {say('جارٍ التحميل…','Loading…')}</p>}
  <div className="mold-list">{list.map(view=><MoldCard key={view.id} view={view} linkReady={!!data?.linkReady} unsent={uploading.filter(upload=>upload.moldId===view.id&&upload.phase==='failed').length} say={say} onOpen={()=>setOpenId(view.id)}/>)}</div>
  </>}
  {open&&<MoldRequestSheet key={open.id+':'+open.version} view={open} linkReady={!!data?.linkReady} statusAt={open.remoteAt} customers={customers} uploads={uploads} uploading={uploading} onClose={()=>setOpenId(null)} onChanged={changed}/>}
  {creating&&<MoldRequestDialog customers={customers} uploads={uploads} onClose={()=>setCreating(false)} onSaved={view=>{setCreating(false);void refresh();if(view)setOpenId(view.id);}}/>}
 </section>;
}

/** «طلبات بانتظار اعتمادي»: every request production holds for the sales manager, the CRM's and those registered in production, the
 * longest waiting first, each with what was asked for and an Approve button. Approved here, a request leaves the list; until the page
 * is refreshed it stays below with Withdraw approval, in case it was a mistake, its files named without links (they open from the list
 * only while the request waits for the sales manager). Should it come back to the sales manager meanwhile (production lists it waiting
 * since after that approval), it leaves «اعتمدتها الآن» for the list above, as production now holds it, files and links included. */
function MoldPendingList({pending,say,onOpen,onChanged}:{pending:MoldPendingAnswer;say:Say;onOpen:(id:string)=>void;onChanged:()=>void}){
 const [busy,setBusy]=useState<number|null>(null),[errors,setErrors]=useState<Record<number,string>>({}),[approved,setApproved]=useState<MoldPendingAnswer['items']>([]);
 // Read on each new list (state adjusted while rendering, not in an effect): a copy dropped here stays dropped should the request
 // leave the list again later.
 const [listed,setListed]=useState(pending);
 if(listed!==pending){
  setListed(pending);
  if(approved.some(copy=>moldPendingAgain(copy,pending.items)))setApproved(previous=>previous.filter(copy=>!moldPendingAgain(copy,pending.items)));
 }
 const keys=useRef(new Map<string,string>());
 const run=async(item:MoldPendingAnswer['items'][number],action:'approve-order'|'withdraw-order')=>{
  if(busy!==null)return;
  setBusy(item.orderNo);setErrors(previous=>({...previous,[item.orderNo]:''}));
  // A retry after an unclear failure keeps its identifier, so production is asked once.
  const name=action+':'+item.orderNo;if(!keys.current.has(name))keys.current.set(name,crypto.randomUUID());
  try{
   await submitJson('/api/mold-requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,orderNo:item.orderNo,requestId:keys.current.get(name)})},{language:getLanguage()});
   keys.current.delete(name);
   setApproved(previous=>action==='approve-order'?[...previous.filter(other=>other.orderNo!==item.orderNo),item]:previous.filter(other=>other.orderNo!==item.orderNo));
   onChanged();
  }catch(failure){if(definiteSubmitRejection(failure))keys.current.delete(name);setErrors(previous=>({...previous,[item.orderNo]:messageOf(failure)}));if(failure instanceof SubmitError&&failure.status===409)onChanged();}
  finally{setBusy(null);}
 };
 const waiting=pending.items.filter(item=>!approved.some(other=>other.orderNo===item.orderNo));
 // A refusal for a request that has since left the list (production moved it on, cancelled or deleted it) stays readable above it.
 const orphaned=Object.entries(errors).filter(([orderNo,text])=>text&&!pending.items.some(item=>String(item.orderNo)===orderNo)&&!approved.some(item=>String(item.orderNo)===orderNo));
 const card=(item:MoldPendingAnswer['items'][number],done:boolean)=>{
  const specs=item.specs,choice=(names:Record<string,string>,value:string)=>say(names[value]||value,value);
  return <article key={item.orderNo} className="mold-pending" data-source={item.source} data-done={done||undefined}>
   <header><strong>{item.customer.name||'—'}</strong><span className="mold-chip" data-source={item.source}>{item.source==='manual'?say('مسجّل في تطبيق الإنتاج','Registered in production'):say('من الـCRM','From the CRM')}</span></header>
   <p dir="auto">{specs.description}</p>
   <div className="mold-card-facts">
    <span>{say('رقم أمر الإنتاج','Production order')}: <b>{item.orderNo}</b></span><span>{say('الكمية','Quantity')}: <b>{specs.quantity??'—'}</b></span>
    <span>{say('المندوب','Salesman')}: {item.salesman.name||'—'}</span>{item.enteredBy&&<span>{say('سجّله في الإنتاج','Entered in production by')}: <bdi>{item.enteredBy}</bdi></span>}
    <span>{say('تاريخ الطلب','Requested')}: {stamp(item.requestedAt)}</span>{!done&&item.waitingSince&&<span><Hourglass size={13} aria-hidden="true"/> {say('بانتظارك من ','Waiting for you since ')+stamp(item.waitingSince)}</span>}
   </div>
   <p className="mold-pending-specs">{[choice(MOLD_CORES,specs.core),specs.vibrators?say('رجاجات: ','Vibrators: ')+specs.vibrators:'',choice(MOLD_MODELS,specs.model),choice(MOLD_HALF_BLOCKS,specs.halfBlock),specs.moldWidth?say('عرض ','Width ')+specs.moldWidth:'',specs.gelbaSize?say('جلب ','Gelba ')+specs.gelbaSize:'',specs.moldNo?say('قالب ','Mold ')+specs.moldNo:''].filter(Boolean).join(' · ')}</p>
   {specs.notes&&<p className="mold-pending-notes" dir="auto">{specs.notes}</p>}
   {/* Approved just now: the request no longer waits for them, so its files are listed without links (the CRM's request shows them). */}
   <MoldPendingDesignFiles files={item.designFiles} say={say} note={done?pendingFilesApprovedNote(item.inCrm&&!!item.crmRequestId,say):''}/>
   {errors[item.orderNo]&&<p className="form-error" role="alert">{errors[item.orderNo]}</p>}
   <div className="mold-actions">
    {done?<><span className="mold-pending-done"><BadgeCheck size={16} aria-hidden="true"/>{say('اعتمدته الآن','You approved it')}</span><button type="button" className="btn subtle" disabled={busy!==null} onClick={()=>void run(item,'withdraw-order')}>{busy===item.orderNo?<Loader2 className="spin" size={16}/>:<Undo2 size={16}/>}{say('سحب الاعتماد','Withdraw approval')}</button></>
     :<button type="button" className="btn primary" disabled={busy!==null} onClick={()=>void run(item,'approve-order')}>{busy===item.orderNo?<Loader2 className="spin" size={16}/>:<BadgeCheck size={16}/>}{say('اعتماد','Approve')}</button>}
    {item.inCrm&&item.crmRequestId&&<button type="button" className="btn subtle" onClick={()=>onOpen(item.crmRequestId!)}>{say('فتح الطلب','Open request')}</button>}
    {specs.designUrl&&<a className="btn subtle" href={specs.designUrl} target="_blank" rel="noopener noreferrer">{say('رابط التصميم','Design link')}</a>}
   </div>
  </article>;
 };
 return <div className="mold-pending-list">
  {pending.error&&<p className="mold-banner" data-kind="stale" role="status"><TriangleAlert size={16} aria-hidden="true"/>{say('تعذّر تحديث القائمة الآن','The list could not be refreshed now')}: {moldErrorText(pending.error.code,say)}</p>}
  {orphaned.map(([orderNo,text])=><p key={orderNo} className="form-error mold-pending-gone" role="alert">{say('أمر الإنتاج ','Production order ')+orderNo}: {text}</p>)}
  {!waiting.length&&!pending.error&&<p className="empty mold-empty">{say('لا توجد طلبات بانتظار اعتمادك.','Nothing is waiting for your approval.')}</p>}
  {waiting.map(item=>card(item,false))}
  {!!approved.length&&<h3 className="mold-subtitle">{say('اعتمدتها الآن','Approved just now')}</h3>}
  {approved.map(item=>card(item,true))}
 </div>;
}

/** What a request says when production refused a change for good (409 request_locked, production_only): the change did not reach
 *  production and is not sent again, and the specifications shown are the CRM's copy, which may differ from production's. */
const productionOnlyNotice=(error:MoldRequestView['sending']['error'],say:Say)=>say('آخر تعديل لم يصل للإنتاج ولن يُعاد إرساله: ','The last change did not reach production and will not be sent again: ')+moldErrorText(error?.code||'',say,{reason:error?.reason})+'. '
 +say('المواصفات المعروضة هنا نسخة الـCRM وقد تختلف عما في تطبيق الإنتاج.','The specifications shown here are the CRM\'s copy and may differ from production\'s.');

/** One request: where production is, what was asked for, what waits to be sent, and the representative's actions while allowed (an
 *  edit only while it has certainly never reached production: once sent, the production manager edits it in the products application). */
function MoldRequestSheet({view:initial,linkReady,statusAt,customers,uploads,uploading,onClose,onChanged}:{view:MoldRequestView;linkReady:boolean;statusAt:string|null;customers:Row[];uploads:DesignUploadQueue;uploading:DesignUpload[];onClose:()=>void;onChanged:()=>void}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const [view,setView]=useState(initial),[editing,setEditing]=useState(false),[cancelling,setCancelling]=useState(false),[reason,setReason]=useState(''),[pullError,setPullError]=useState<string>('');
 const done=useCallback((next:MoldRequestView|null)=>{if(next)setView(next);onChanged();},[onChanged]);
 const action=useMoldAction(done);
 // Opening one request pulls its status alone (§6: no retry; the last known status stays with its time). An upload's answer that came
 // meanwhile is newer than the pull and stays.
 useEffect(()=>{let live=true;const mark=uploads.mark();void submitJson<MoldRequestsAnswer>('/api/mold-requests?id='+encodeURIComponent(initial.id),{cache:'no-store'},{language:getLanguage()}).then(answer=>{if(!live)return;const fresh=answer.requests[0];if(fresh&&!uploads.newer(initial.id,mark))setView(fresh);setPullError(answer.statusError?moldErrorText(answer.statusError.code,(ar,en)=>getLanguage()==='en'?en:ar):'');}).catch(()=>{});return()=>{live=false;};},[initial.id,uploads]);
 // Each upload of this request answers with the request as it now stands (its files, and the approvals undone).
 useEffect(()=>uploads.listen(initial.id,setView),[uploads,initial.id]);
 const mine=useMemo(()=>uploading.filter(upload=>upload.moldId===initial.id),[uploading,initial.id]);
 const remote=view.remote,specs=view.specs;
 const facts:[string,React.ReactNode][]=[
  [say('رقم أمر الإنتاج','Production order'),remote?.orderNo??'—'],[say('السريال','Serial'),remote?.moldSerial||'—'],[say('تاريخ الإنتاج','Production date'),day(remote?.productionDate)],
  [say('التسليم','Delivery'),remote?.delivered?say('سُلِّم','Delivered')+' · '+day(remote.deliveryDate):say('لم يُسلَّم','Not delivered')],[say('كود يورست','Yourrest code'),'YR-C-'+String(view.crmNumber).padStart(6,'0')],
  [say('تاريخ الطلب','Requested'),stamp(view.requestedAt)],[say('مقدّم الطلب','Requested by'),view.memberName],
 ];
 const asked:[string,React.ReactNode][]=[
  [say('الوصف','Description'),<span dir="auto" key="d">{specs.description}</span>],[say('العلب','Core'),say(MOLD_CORES[specs.core as keyof typeof MOLD_CORES]||specs.core,specs.core)],[say('الرجاجات','Vibrators'),specs.vibrators],
  [say('الموديل','Model'),say(MOLD_MODELS[specs.model as keyof typeof MOLD_MODELS]||specs.model,specs.model)],[say('بلوكة النص','Half block'),say(MOLD_HALF_BLOCKS[specs.halfBlock as keyof typeof MOLD_HALF_BLOCKS]||specs.halfBlock,specs.halfBlock)],
  [say('عرض القالب (مم)','Mold width (mm)'),specs.moldWidth],[say('مقاس الجلب','Gelba size'),specs.gelbaSize],[say('رقم القالب','Mold no.'),specs.moldNo||'—'],[say('الكمية','Quantity'),specs.quantity],
  [say('رابط التصميم','Design link'),specs.designUrl?<a key="u" href={specs.designUrl} target="_blank" rel="noopener noreferrer" dir="ltr">{say('فتح الرابط','Open link')}</a>:'—'],[say('ملاحظات','Notes'),<span dir="auto" key="n">{specs.notes||'—'}</span>],
 ];
 return <Sheet open onOpenChange={open=>{if(!open)onClose();}}>
  <SheetContent side={direction()==='rtl'?'left':'right'} className="mold-sheet" dir={direction()}>
   <SheetTitle>{view.customerName}</SheetTitle>
   <SheetDescription>{statusText(view,say)}{remote?' · '+say('مراحل منتهية','stages done')+' '+remote.stagesDone+'/'+remote.stagesTotal:''}</SheetDescription>
   <SendingState view={view} linkReady={linkReady} say={say}/>
   {pullError&&<p className="mold-banner" data-kind="stale" role="status"><TriangleAlert size={16} aria-hidden="true"/>{say('تعذّر تحديث المراحل الآن','Stages could not be refreshed now')}: {pullError}</p>}
   {view.cancelled&&<p className="mold-banner" data-kind="cancelled">{say('أُلغي الطلب','The request was cancelled')}{view.cancelReason?': '+view.cancelReason:''}</p>}
   {/* A change production refused for good (production_only): production holds the request, and its production manager alone edits it. */}
   {moldProductionOnly(view.sending.error)&&<p className="mold-banner mold-production-only" data-kind="stale" role="status"><TriangleAlert size={16} aria-hidden="true"/>{productionOnlyNotice(view.sending.error,say)}</p>}
   {!view.cancelled&&remote?.status==='cancelled'&&<p className="mold-banner" data-kind="cancelled">{say('أُلغي الطلب في تطبيق الإنتاج؛ لم يعد التعديل أو الإلغاء ممكنًا.','The request was cancelled in the production application; it can no longer be changed.')}</p>}
   {remote?.waitingStep&&!view.cancelled&&<p className="mold-waiting" data-step={remote.waitingStep}><Hourglass size={15} aria-hidden="true"/><strong>{say(...moldWaitingNames[remote.waitingStep])}</strong>{waitingSince(view,say)&&<span>{waitingSince(view,say)}</span>}</p>}
   <MoldApprovals view={view} say={say}/>
   <MoldStages view={view} say={say}/>
   <p className="mold-updated">{say('آخر تحديث للحالة','Status last updated')}: {stamp(view.remoteAt||statusAt)}</p>
   <dl className="mold-facts">{facts.map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
   <h3 className="mold-subtitle">{say('المواصفات','Specifications')}</h3>
   {/* The status object carries no data: what the production manager changes there never shows here. */}
   {remote&&<p className="mold-specs-note">{say('المواصفات كما أرسلها الـCRM. بعد الإرسال يعدّلها مدير الإنتاج في تطبيق المنتجات فقط، وتعديله لا يظهر هنا.','The specifications as the CRM sent them. Once sent, the production manager alone edits them in the products application, and those edits do not show here.')}</p>}
   <dl className="mold-facts">{asked.map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
   <MoldDesignFiles view={view} uploads={mine} queue={uploads} onView={done} say={say}/>
   {!view.editable&&!view.cancelled&&view.can&&!view.can.edit&&remote&&remote.status!=='cancelled'&&<p className="mold-locked"><Lock size={14} aria-hidden="true"/>{remote.status==='confirmed'?say('اكتملت الاعتمادات؛ لم يعد الإلغاء أو تغيير ملفات التصميم ممكنًا.','All approvals are in; the request can no longer be cancelled and its design files can no longer change.'):say('بدأ الإنتاج؛ لم يعد الإلغاء أو تغيير ملفات التصميم ممكنًا.','Production has started; the request can no longer be cancelled and its design files can no longer change.')}</p>}
   {action.error&&<p className="form-error" role="alert">{action.error}</p>}
   <div className="mold-actions">
    {view.can.approve&&<button type="button" className="btn primary" disabled={action.busy} onClick={()=>void action.run({action:'approve',id:view.id})}>{action.busy?<Loader2 className="spin" size={16}/>:<BadgeCheck size={16}/>}{say('اعتماد','Approve')}</button>}
    {view.can.withdraw&&<button type="button" className="btn subtle" disabled={action.busy} onClick={()=>void action.run({action:'withdraw',id:view.id})}>{action.busy?<Loader2 className="spin" size={16}/>:<Undo2 size={16}/>}{say('سحب الاعتماد','Withdraw approval')}</button>}
    {view.can.resend&&<button type="button" className="btn primary" disabled={action.busy||!linkReady} onClick={()=>void action.run({action:'resend',id:view.id})}>{action.busy?<Loader2 className="spin" size={16}/>:<Send size={16}/>}{say('إعادة الإرسال','Resend')}</button>}
    {view.can.edit&&<button type="button" className="btn subtle" disabled={action.busy} onClick={()=>setEditing(true)}>{say('تعديل الطلب','Edit request')}</button>}
    {view.can.cancel&&!cancelling&&<button type="button" className="btn danger-outline" disabled={action.busy} onClick={()=>setCancelling(true)}>{say('إلغاء الطلب','Cancel request')}</button>}
   </div>
   {cancelling&&<form className="mold-cancel" onSubmit={event=>{event.preventDefault();void action.run({action:'cancel',id:view.id,version:view.version,reason}).then(next=>{if(next)setCancelling(false);});}}>
    <VoiceField label={say('سبب الإلغاء (اختياري)','Reason (optional)')} value={reason} onChange={setReason} multiline full inputProps={{maxLength:MOLD_LIMITS.cancelReason}}/>
    <div className="mold-actions"><button type="submit" className="btn danger" disabled={action.busy}>{say('تأكيد الإلغاء','Confirm cancellation')}</button><button type="button" className="btn subtle" onClick={()=>setCancelling(false)}>{say('رجوع','Back')}</button></div>
   </form>}
   {editing&&<MoldRequestDialog customers={customers} editing={view} uploads={uploads} used={designUsed(view,mine)} onClose={()=>setEditing(false)} onSaved={next=>{setEditing(false);if(next)setView(next);onChanged();}}/>}
  </SheetContent>
 </Sheet>;
}

/** The three approvals in order, each with when it was given (and, for the sales manager's, by whom); none for a historical request. */
function MoldApprovals({view,say}:{view:MoldRequestView;say:Say}){
 const approvals=view.remote?.approvals;
 if(!approvals?.required)return null;
 return <ol className="mold-approvals" aria-label={say('الاعتمادات','Approvals')}>{(['sales','production','admin'] as const).map(step=>{
  const given=approvals[step];
  return <li key={step} data-done={!!given}><BadgeCheck size={15} aria-hidden="true"/><span>{say('اعتماد ','Approval: ')+say(...moldApprovalNames[step])}</span>
   <small>{given?say('تم','Done')+(given.at?' · '+stamp(given.at):'')+(step==='sales'&&approvals.sales?.by?' · '+approvals.sales.by:''):say('لم يتم بعد','Not yet')}</small></li>;
 })}</ol>;
}

const blank:Record<string,string>={description:'',core:'',vibrators:'',model:'',halfBlock:'',moldWidth:'',gelbaSize:'',moldNo:'',quantity:'1',designUrl:'',notes:''};
const asForm=(specs:MoldSpecs)=>Object.fromEntries(Object.entries(blank).map(([key])=>[key,specs[key as keyof MoldSpecs]===null||specs[key as keyof MoldSpecs]===undefined?'':String(specs[key as keyof MoldSpecs])]));

/** Ask for a mold (a customer the member can see, then the specifications), or change one that has certainly never reached production
 *  (once sent, its data is edited by the production manager only); either way with design files, which upload once the request is saved
 *  (`used`: the places the request's files already take). */
function MoldRequestDialog({customers,editing,uploads,used=0,onClose,onSaved}:{customers:Row[];editing?:MoldRequestView;uploads:DesignUploadQueue;used?:number;onClose:()=>void;onSaved:(view:MoldRequestView|null)=>void}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const [customerId,setCustomerId]=useState(editing?.customerId||''),[search,setSearch]=useState(''),[form,setForm]=useState<Record<string,string>>(editing?asForm(editing.specs):blank),[shown,setShown]=useState<Record<string,string>>({});
 const action=useMoldAction(onSaved);
 const [files,setFiles]=useState<DesignChoice[]>([]),[asking,setAsking]=useState(false),ready=files.filter(choice=>!choice.refusal);
 const chosen=customers.find(row=>row.id===customerId);
 const matches=useMemo(()=>{const needle=search.trim().toLowerCase();return customers.filter(row=>!needle||[row.data.name,row.data.code,row.data.internalCode,row.data.city].some(text=>String(text||'').toLowerCase().includes(needle))).slice(0,30);},[customers,search]);
 const clear=(key:string)=>setShown(previous=>{if(!(key in previous))return previous;const next={...previous};delete next[key];return next;});
 const set=(key:string,value:string)=>{setForm(previous=>({...previous,[key]:value}));clear(key);};
 const errors={...shown,...action.fields};
 const submit=(event:React.FormEvent)=>{
  event.preventDefault();
  const checked=validateMoldSpecs(form);
  if(!editing&&!customerId){setShown({...checked.errors,customer:say('اختر العميل','Choose the customer')});return;}
  if(Object.keys(checked.errors).length){setShown(checked.errors);return;}
  setShown({});
  // On a request production holds, attaching a file undoes the approvals: said first, then confirmed with the same button.
  if(editing&&ready.length&&designNeedsWarning(editing)&&!asking){setAsking(true);return;}
  setAsking(false);
  // The files go once the request is saved (each with its own requestId, kept for retries), the request's own change first.
  void action.run(editing?{action:'update',id:editing.id,version:editing.version,specs:checked.specs}:{action:'create',customerId,specs:checked.specs}).then(next=>{if(next&&ready.length)uploads.add(next.id,ready);});
 };
 const choice=(key:string,label:string,options:[string,string][])=><fieldset className="mold-choice" aria-invalid={!!errors[key]}><legend>{label}</legend><div>{options.map(([value,text])=><label key={value} data-active={form[key]===value}><input type="radio" name={key} value={value} checked={form[key]===value} onChange={()=>set(key,value)}/>{text}</label>)}</div>{errors[key]&&<small className="field-error">{errors[key]}</small>}</fieldset>;
 const number=(key:string,label:string,usual:number[]=[])=><label className="mold-field" aria-invalid={!!errors[key]}>{label}<input inputMode="numeric" dir="ltr" value={form[key]} onChange={event=>set(key,event.target.value.replace(/[^\d٠-٩]/g,'').replace(/[٠-٩]/g,digit=>String(digit.charCodeAt(0)-0x660)))}/>{!!usual.length&&<span className="mold-usual">{usual.map(value=><button type="button" key={value} className="btn small subtle" onClick={()=>set(key,String(value))}>{value}</button>)}</span>}{errors[key]&&<small className="field-error">{errors[key]}</small>}</label>;
 // Dimensions, the mold number and the design link are typed (a code, a URL); the notes are free text and take dictation.
 const text=(key:string,label:string,max:number,type:'text'|'url'='text')=><label className="mold-field" aria-invalid={!!errors[key]}>{label}<input type={type} maxLength={max} dir="ltr" value={form[key]} onChange={event=>set(key,event.target.value)}/>{errors[key]&&<small className="field-error">{errors[key]}</small>}</label>;
 return <Dialog open onOpenChange={open=>{if(!open&&!action.busy)onClose();}}>
  <DialogContent className="mold-dialog" dir={direction()}>
   <DialogTitle>{editing?say('تعديل طلب تصنيع القالب','Edit mold request'):say('طلب تصنيع قالب','Request a mold')}</DialogTitle>
   <DialogDescription>{editing?say('الطلب لم يصل للإنتاج بعد، فتعديله هنا ممكن. بعد وصوله يعدّل بياناته مدير الإنتاج فقط.','The request has not reached production yet, so it can be changed here. Once it arrives, the production manager alone edits its data.'):say('يُحفظ الطلب في الـCRM ثم يُرسل لتطبيق الإنتاج تلقائيًا.','The request is saved in the CRM, then sent to production automatically.')}</DialogDescription>
   <form className="mold-form" onSubmit={submit} noValidate>
    {editing?<p className="mold-customer-chosen"><Factory size={16} aria-hidden="true"/>{editing.customerName}</p>:chosen?<div className="mold-customer-chosen"><span><Factory size={16} aria-hidden="true"/>{String(chosen.data.name||'')}<small>{String(chosen.data.internalCode||'')}{chosen.data.city?' · '+String(chosen.data.city):''}</small></span><button type="button" className="btn small subtle" onClick={()=>setCustomerId('')}>{say('تغيير','Change')}</button></div>
     :<div className="mold-customer-search" aria-invalid={!!errors.customer}><label>{say('العميل','Customer')}<span className="search"><Search size={16} aria-hidden="true"/><input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder={say('ابحث باسم العميل أو كوده أو مدينته','Search by name, code or city')}/></span></label>
      <div className="mold-customer-matches">{matches.map(row=><button type="button" key={row.id} disabled={!yourrestNumber(row.data.internalCode)} onClick={()=>{setCustomerId(row.id);clear('customer');}}><strong>{String(row.data.name||'')}</strong><small>{String(row.data.internalCode||'')}{row.data.city?' · '+String(row.data.city):''}</small></button>)}{!matches.length&&<p className="empty">{say('لا عملاء مطابقون','No matching customers')}</p>}</div>
      {errors.customer&&<small className="field-error">{errors.customer}</small>}</div>}
    {text('description',say('وصف القالب','Mold description'),MOLD_LIMITS.description)}
    <div className="mold-grid">
     {choice('core',say('العلب','Core'),Object.entries(MOLD_CORES).map(([value,ar])=>[value,say(ar,value)]))}
     {choice('vibrators',say('عدد الرجاجات','Vibrators'),[['2','2'],['3','3'],['4','4']])}
     {choice('model',say('الموديل','Model'),Object.entries(MOLD_MODELS).map(([value,ar])=>[value,say(ar,value)]))}
     {choice('halfBlock',say('بلوكة النص','Half block'),Object.entries(MOLD_HALF_BLOCKS).map(([value,ar])=>[value,say(ar,value)]))}
     {number('moldWidth',say('عرض القالب (مم، 1000–2000)','Mold width (mm, 1000–2000)'),MOLD_USUAL.moldWidth)}
     {number('gelbaSize',say('مقاس الجلب (500–1200)','Gelba size (500–1200)'),MOLD_USUAL.gelbaSize)}
     {text('moldNo',say('رقم القالب (اختياري)','Mold no. (optional)'),MOLD_LIMITS.moldNo)}
     {number('quantity',say('الكمية (1–100)','Quantity (1–100)'))}
    </div>
    {text('designUrl',say('رابط التصميم (اختياري، يبدأ بـ https://)','Design link (optional, https://)'),MOLD_LIMITS.designUrl,'url')}
    <VoiceField label={say('ملاحظات (اختياري)','Notes (optional)')} value={form.notes} onChange={value=>set('notes',value)} multiline full className="mold-notes" inputProps={{maxLength:MOLD_LIMITS.notes}}/>
    <MoldDesignPicker choices={files} onChange={next=>{setFiles(next);setAsking(false);}} room={MOLD_DESIGN_MAX_FILES-used} disabled={action.busy} say={say}/>
    {asking&&!!ready.length&&<div className="mold-design-confirm" role="group" ref={revealCentered} aria-label={say('تأكيد إرفاق الملفات','Confirm attaching the files')}><p><TriangleAlert size={16} aria-hidden="true"/>{designWarningText(say)}</p></div>}
    {action.error&&<p className="form-error" role="alert">{action.error}</p>}
    <div className="mold-actions"><button type="submit" className="btn primary" disabled={action.busy}>{action.busy?<Loader2 className="spin" size={16}/>:asking?<Paperclip size={16}/>:<Send size={16}/>}{asking?say('تأكيد: حفظ وإرفاق الملفات','Confirm: save and attach the files'):editing?say('حفظ وإرسال التعديل','Save and send the change'):say('حفظ وإرسال للإنتاج','Save and send to production')}</button>{asking&&<button type="button" className="btn subtle" onClick={()=>setAsking(false)} disabled={action.busy}>{say('رجوع','Back')}</button>}<button type="button" className="btn subtle" onClick={onClose} disabled={action.busy}>{say('إلغاء','Cancel')}</button></div>
   </form>
  </DialogContent>
 </Dialog>;
}
