'use client';
import React,{useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {BadgeCheck,Factory,Hourglass,Loader2,Lock,Paperclip,RefreshCw,Search,Send,TriangleAlert,Undo2,Wrench} from 'lucide-react';
import {Sheet,SheetContent,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {useLanguage,direction,getLanguage,t} from '@/lib/i18n';
import {definiteSubmitRejection,submitJson,SubmitError} from '@/lib/client-submit';
import type {Member,Row} from '@/lib/crm';
import {MOLD_STAGES,MOLD_STAGE_NAMES,MOLD_CORES,MOLD_MODELS,MOLD_HALF_BLOCKS,MOLD_PENDING_REFRESH_MS,MOLD_QUOTE_PO_MISSING_TEXT,MOLD_QUOTE_PO_REQUIRED_TEXT,MOLD_SAME_REASON_TEXT,moldApprovalNames,moldChangeRefused,moldErrorText,moldFieldNames,moldPaymentNames,moldPendingAgain,moldQuotePoNames,moldRestoredText,moldSendingNames,moldStatusNames,moldWaitingNames,yourrestNumber,type MoldFileCategory,type MoldPayment,type MoldPendingAnswer,type MoldQuotePoView,type MoldRequestView,type MoldRequestsAnswer,type MoldSpecs} from '@/lib/mold-requests';
import {MOLD_CATEGORY_MAX_FILES,MOLD_LIMITS,MOLD_QUOTE_PO_MAX,MOLD_USUAL,moldCancelReasonUsed,moldPayment,validateMoldQuotePo,validateMoldSpecs} from '@/portable/mold-rules.mjs';
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
/** The quotation and PO numbers to show (production's now, or the CRM's own before production holds the request), each that is given. */
function QuotePoNumbers({numbers,say}:{numbers:Pick<MoldQuotePoView,'quoteNo'|'poNo'>|null;say:Say}){
 if(!numbers||!numbers.quoteNo&&!numbers.poNo)return null;
 return <>{(['quoteNo','poNo'] as const).filter(key=>numbers[key]).map(key=><span key={key} className="mold-quote-po" data-field={key}>{say(...moldQuotePoNames[key])}: <b><bdi dir="ltr">{numbers[key]}</bdi></b></span>)}</>;
}
/** Production marks the request as lacking both numbers (quoteOrPoMissing): its production manager adds one. */
const QuotePoMissing=({say}:{say:Say})=><p className="mold-quote-po-missing" role="status"><TriangleAlert size={14} aria-hidden="true"/>{say(...MOLD_QUOTE_PO_MISSING_TEXT)}</p>;

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

/** One write. A retry after an unclear failure keeps its identifier, so a request is never saved twice. A refusal that carries the
 *  request as it now stands goes to onRefused when given (the edit form stays open with the reason), else to onDone. */
function useMoldAction(onDone:(view:MoldRequestView|null)=>void,onRefused?:(view:MoldRequestView)=>void){
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
   if(reply?.request)(onRefused||onDone)(reply.request);
   return null;
  }finally{lock.current=false;setBusy(false);}
 },[onDone,onRefused]);
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
    // A request carrying a quotation or PO number is kept until production's update is known to be live (never sent without them).
    :sending.state==='held'?say('الطلب محفوظ في الـCRM ومعه رقم عرض السعر / الـ PO، ويُرسل بعد تحديث تطبيق المنتجات.','The request is saved in the CRM with its quotation / PO number and is sent once the products application is updated.')
    :sending.state==='rejected'?say('رفض الإنتاج: ','Production refused: ')+((sending.error?.fields||[]).map(field=>say(...(moldFieldNames[field]||[field,field]))).join('، ')||moldErrorText(sending.error?.code||'',say))+'. '
     // Edited only while it has certainly never reached production; otherwise a resend sends the same refused data, so the way on is
     // to cancel it and ask again.
     +(view.can.edit?say('عدّل الطلب أو أعد إرساله.','Edit the request or resend it.'):say('ألغِ الطلب واطلبه من جديد.','Cancel the request and ask again.'))
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
   {/* Design files, then the quotation's and PO's together (production's update of 2026-11-03). */}
   {(()=>{const designs=view.designFiles.filter(file=>(file.category||'design')==='design').length,documents=view.designFiles.length-designs;return <>
    {!!designs&&<span className="mold-card-files"><Paperclip size={13} aria-hidden="true"/>{say('ملفات التصميم','Design files')}: <b>{designs}</b></span>}
    {!!documents&&<span className="mold-card-files" data-category="quote-po"><Paperclip size={13} aria-hidden="true"/>{say('ملفات عرض السعر والـ PO','Quotation and PO files')}: <b>{documents}</b></span>}</>;})()}
   <QuotePoNumbers numbers={view.quotePo} say={say}/>
  </div>
  {view.quotePo?.missing&&<QuotePoMissing say={say}/>}
  {view.sending.state!=='sent'&&<small className="mold-card-sending" data-state={view.sending.state}>{say(...moldSendingNames[linkReady?view.sending.state:'off'])}</small>}
  {!!unsent&&<small className="mold-card-sending" data-state="rejected">{say('ملفات تصميم لم تُرفع: ','Design files not uploaded: ')+unsent+' · '+say('افتح الطلب للتفاصيل','open the request for details')}</small>}
 </button>;
}

/** The page: the requests the reader may see, the button to ask for a mold, the link's state. */
export function MoldRequestsPage({me,records}:{me:Member;records:Row[]}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const {data,error,loading,refresh}=useMoldRequests(me);
 const [openId,setOpenId]=useState<string|null>(null),[creating,setCreating]=useState(false),[query,setQuery]=useState('');
 // A request «طلبات بانتظار اعتمادي» shows the sales manager that their own list does not (customer service's, say: 2026-11-03), read
 // from the server when opened from there, while it waits for them.
 const [approverView,setApproverView]=useState<MoldRequestView|null>(null);
 const customers=useMemo(()=>records.filter(row=>row.kind==='customer'),[records]);
 const list=useMemo(()=>{const needle=query.trim().toLowerCase();return (data?.requests||[]).filter(view=>!needle||[view.customerName,view.specs.description,view.specs.moldNo,String(view.remote?.orderNo||''),view.memberName].some(text=>String(text||'').toLowerCase().includes(needle)));},[data,query]);
 const open=data?.requests.find(view=>view.id===openId)||(approverView?.id===openId?approverView:null);
 const listed=useMemo(()=>new Set((data?.requests||[]).map(view=>view.id)),[data]);
 const openPending=useCallback(async(id:string)=>{
  if(listed.has(id)){setOpenId(id);return;}
  const answer=await submitJson<MoldRequestsAnswer>('/api/mold-requests?id='+encodeURIComponent(id),{cache:'no-store'},{language:getLanguage()});
  if(answer.requests[0]){setApproverView(answer.requests[0]);setOpenId(id);}
 },[listed]);
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
  {showPending&&<MoldPendingList pending={data!.pending!} ownList={listed} say={say} onOpen={openPending} onChanged={changed}/>}
  {!showPending&&<>
  {!!data?.requests.length&&<label className="mold-search"><Search size={16} aria-hidden="true"/><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder={say('ابحث بالعميل أو الوصف أو رقم أمر الإنتاج','Search by customer, description or order')}/></label>}
  {data&&!list.length&&<p className="empty mold-empty">{data.requests.length?say('لا نتائج','No results'):say('لا توجد طلبات تصنيع قوالب بعد.','No mold requests yet.')}</p>}
  {!data&&!error&&<p className="empty"><Loader2 className="spin" size={16}/> {say('جارٍ التحميل…','Loading…')}</p>}
  <div className="mold-list">{list.map(view=><MoldCard key={view.id} view={view} linkReady={!!data?.linkReady} unsent={uploading.filter(upload=>upload.moldId===view.id&&upload.phase==='failed').length} say={say} onOpen={()=>setOpenId(view.id)}/>)}</div>
  </>}
  {open&&<MoldRequestSheet key={open.id+':'+open.version} view={open} current={data?.pending?.items.find(item=>item.inCrm&&item.crmRequestId===open.id)||null} linkReady={!!data?.linkReady} quotePo={!!data?.quotePo} statusAt={open.remoteAt} customers={customers} uploads={uploads} uploading={uploading} onClose={()=>{setOpenId(null);setApproverView(null);}} onChanged={changed}/>}
  {creating&&<MoldRequestDialog customers={customers} uploads={uploads} quotePo={!!data?.quotePo} onClose={()=>setCreating(false)} onSaved={view=>{setCreating(false);void refresh();if(view)setOpenId(view.id);}}/>}
 </section>;
}

/** «طلبات بانتظار اعتمادي»: every request production holds for the sales manager, the CRM's and those registered in production, the
 * longest waiting first, each with what was asked for and an Approve button. Approved here, a request leaves the list; until the page
 * is refreshed it stays below with Withdraw approval, in case it was a mistake, its files named without links (they open from the list
 * only while the request waits for the sales manager). Should it come back to the sales manager meanwhile (production lists it waiting
 * since after that approval), it leaves «اعتمدتها الآن» for the list above, as production now holds it, files and links included.
 * ownList: the requests of the manager's own list (theirs and their team's); one it does not hold (customer service's, say) opens from
 * here only while it waits for them. */
function MoldPendingList({pending,ownList,say,onOpen,onChanged}:{pending:MoldPendingAnswer;ownList:Set<string>;say:Say;onOpen:(id:string)=>Promise<void>;onChanged:()=>void}){
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
 const opening=async(item:MoldPendingAnswer['items'][number])=>{
  setErrors(previous=>({...previous,[item.orderNo]:''}));
  try{await onOpen(item.crmRequestId!);}catch(failure){setErrors(previous=>({...previous,[item.orderNo]:messageOf(failure)}));}
 };
 const waiting=pending.items.filter(item=>!approved.some(other=>other.orderNo===item.orderNo));
 // A refusal for a request that has since left the list (production moved it on, cancelled or deleted it) stays readable above it.
 const orphaned=Object.entries(errors).filter(([orderNo,text])=>text&&!pending.items.some(item=>String(item.orderNo)===orderNo)&&!approved.some(item=>String(item.orderNo)===orderNo));
 const card=(item:MoldPendingAnswer['items'][number],done:boolean)=>{
  const specs=item.specs,choice=(names:Record<string,string>,value:string)=>say(names[value]||value,value);
  // The CRM's own request in the manager's own list (theirs or their team's) still opens once approved; one only this list shows does not.
  const inList=item.inCrm&&!!item.crmRequestId&&ownList.has(item.crmRequestId);
  return <article key={item.orderNo} className="mold-pending" data-source={item.source} data-done={done||undefined}>
   <header><strong>{item.customer.name||'—'}</strong><span className="mold-chip" data-source={item.source}>{item.source==='manual'?say('مسجّل في تطبيق الإنتاج','Registered in production'):say('من الـCRM','From the CRM')}</span></header>
   <p dir="auto">{specs.description}</p>
   <div className="mold-card-facts">
    <span>{say('رقم أمر الإنتاج','Production order')}: <b>{item.orderNo}</b></span><span>{say('الكمية','Quantity')}: <b>{specs.quantity??'—'}</b></span>
    <span>{say('المندوب','Salesman')}: {item.salesman.name||'—'}</span>{item.enteredBy&&<span>{say('سجّله في الإنتاج','Entered in production by')}: <bdi>{item.enteredBy}</bdi></span>}
    <span>{say('تاريخ الطلب','Requested')}: {stamp(item.requestedAt)}</span>{!done&&item.waitingSince&&<span><Hourglass size={13} aria-hidden="true"/> {say('بانتظارك من ','Waiting for you since ')+stamp(item.waitingSince)}</span>}
    {/* How the customer pays, as production holds it now (none for a request asked for before 2026-11-03). */}
    {item.payment&&<span className="mold-payment" data-payment={item.payment}>{say('الدفع','Payment')}: <b>{say(...moldPaymentNames[item.payment])}</b></span>}
    {/* The quotation and PO numbers as production holds them now (production's update of 2026-11-03). */}
    <QuotePoNumbers numbers={item.quoteOrPoMissing===undefined?null:{quoteNo:item.quoteNo||'',poNo:item.poNo||''}} say={say}/>
   </div>
   {item.quoteOrPoMissing&&<QuotePoMissing say={say}/>}
   <p className="mold-pending-specs">{[choice(MOLD_CORES,specs.core),specs.vibrators?say('رجاجات: ','Vibrators: ')+specs.vibrators:'',choice(MOLD_MODELS,specs.model),choice(MOLD_HALF_BLOCKS,specs.halfBlock),specs.moldWidth?say('عرض ','Width ')+specs.moldWidth:'',specs.gelbaSize?say('جلب ','Gelba ')+specs.gelbaSize:'',specs.moldNo?say('قالب ','Mold ')+specs.moldNo:''].filter(Boolean).join(' · ')}</p>
   {specs.notes&&<p className="mold-pending-notes" dir="auto">{specs.notes}</p>}
   {/* Approved just now: the request no longer waits for them, so its files are listed without links (the CRM's request shows them). */}
   <MoldPendingDesignFiles files={item.designFiles} say={say} note={done?pendingFilesApprovedNote(inList,say):''}/>
   {/* The quotation's and PO's files, the same way. */}
   {(['quote','po'] as const).map(category=><MoldPendingDesignFiles key={category} category={category} files={category==='quote'?item.quoteFiles:item.poFiles} say={say} note={done?pendingFilesApprovedNote(inList,say):''}/>)}
   {errors[item.orderNo]&&<p className="form-error" role="alert">{errors[item.orderNo]}</p>}
   <div className="mold-actions">
    {done?<><span className="mold-pending-done"><BadgeCheck size={16} aria-hidden="true"/>{say('اعتمدته الآن','You approved it')}</span><button type="button" className="btn subtle" disabled={busy!==null} onClick={()=>void run(item,'withdraw-order')}>{busy===item.orderNo?<Loader2 className="spin" size={16}/>:<Undo2 size={16}/>}{say('سحب الاعتماد','Withdraw approval')}</button></>
     :<button type="button" className="btn primary" disabled={busy!==null} onClick={()=>void run(item,'approve-order')}>{busy===item.orderNo?<Loader2 className="spin" size={16}/>:<BadgeCheck size={16}/>}{say('اعتماد','Approve')}</button>}
    {item.inCrm&&item.crmRequestId&&(!done||inList)&&<button type="button" className="btn subtle" onClick={()=>void opening(item)}>{say('فتح الطلب','Open request')}</button>}
    {/* An older request's design link, as production holds it (no longer asked for since 2026-11-03): shown read-only. */}
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

/** What a request says when production refused its last change for good (final: 409 production_only among them, or a change to a
 *  request production holds refused for its data): the change did not reach production and is not sent again, with why. And which
 *  specifications it shows: the change production refused (unconfirmed: the CRM never learned what production holds; said for as long
 *  as it stands, whatever error is stored later), or the last production accepted from the CRM. */
function changeRefusedNotice(view:Pick<MoldRequestView,'sending'|'unconfirmed'>,say:Say,quotePo=false){
 const error=view.sending.error,refused=moldChangeRefused(error);
 // Once production's update is live, a production_only refusal also says who adds a quotation or PO number now.
 const why=!error||!refused?'':error.fields?.length?say('رفض الإنتاج: ','Production refused: ')+error.fields.map(field=>say(...(moldFieldNames[field]||[field,field]))).join('، '):moldErrorText(error.code,say,{reason:error.reason,quotePo});
 return (refused?say('آخر تعديل لم يصل للإنتاج ولن يُعاد إرساله: ','The last change did not reach production and will not be sent again: ')+why+'. ':'')
  +(view.unconfirmed?say('المواصفات المعروضة هي التعديل الذي رفضه الإنتاج، وليست بياناته: الطلب لديه ببياناته، ويعدّلها مدير الإنتاج فقط.','The specifications shown are the change production refused, not its data: production holds the request with its own data, which the production manager alone edits.')
   :say('المواصفات المعروضة آخر ما قبله الإنتاج من الـCRM؛ بعدها يعدّلها مدير الإنتاج فقط.','The specifications shown are the last production accepted from the CRM; since then only the production manager edits them.'));
}

/** One request: where production is, what was asked for, what waits to be sent, and the representative's actions while allowed (an
 *  edit only while it has certainly never reached production: once sent, the production manager edits it in the products application).
 *  The sales manager approves from here what production lists now (current, from «طلبات بانتظار اعتمادي»: the customer, salesman and
 *  specifications after the production manager's edits), so the approval is for what will be made; without that listing, no approval
 *  here. */
function MoldRequestSheet({view:initial,current,linkReady,quotePo=false,statusAt,customers,uploads,uploading,onClose,onChanged}:{view:MoldRequestView;current:MoldPendingAnswer['items'][number]|null;linkReady:boolean;quotePo?:boolean;statusAt:string|null;customers:Row[];uploads:DesignUploadQueue;uploading:DesignUpload[];onClose:()=>void;onChanged:()=>void}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const [view,setView]=useState(initial),[editing,setEditing]=useState(false),[cancelling,setCancelling]=useState(false),[reason,setReason]=useState(''),[reasonError,setReasonError]=useState(''),[pullError,setPullError]=useState<string>('');
 const done=useCallback((next:MoldRequestView|null)=>{if(next)setView(next);onChanged();},[onChanged]);
 const action=useMoldAction(done);
 // Opening one request pulls its status alone (§6: no retry; the last known status stays with its time). An upload's answer that came
 // meanwhile is newer than the pull and stays.
 useEffect(()=>{let live=true;const mark=uploads.mark();void submitJson<MoldRequestsAnswer>('/api/mold-requests?id='+encodeURIComponent(initial.id),{cache:'no-store'},{language:getLanguage()}).then(answer=>{if(!live)return;const fresh=answer.requests[0];if(fresh&&!uploads.newer(initial.id,mark))setView(fresh);setPullError(answer.statusError?moldErrorText(answer.statusError.code,(ar,en)=>getLanguage()==='en'?en:ar):'');}).catch(()=>{});return()=>{live=false;};},[initial.id,uploads]);
 // Each upload of this request answers with the request as it now stands (its files, and the approvals undone).
 useEffect(()=>uploads.listen(initial.id,setView),[uploads,initial.id]);
 const mine=useMemo(()=>uploading.filter(upload=>upload.moldId===initial.id),[uploading,initial.id]);
 const remote=view.remote,approving=view.can.approve&&!!current,specs=approving?current!.specs:view.specs,payment:MoldPayment|null=approving?current!.payment:view.payment;
 // The quotation and PO numbers: production's now (the pending item when approving from it, else the status object), or the CRM's own
 // before production holds the request; none from an application older than production's update of 2026-11-03.
 const numbers:Pick<MoldQuotePoView,'quoteNo'|'poNo'|'missing'>|null=approving&&current!.quoteOrPoMissing!==undefined?{quoteNo:current!.quoteNo||'',poNo:current!.poNo||'',missing:current!.quoteOrPoMissing}:view.quotePo;
 // Active again after a cancellation (the production manager restored it, 2026-11-03): said while it may still change (not once the
 // approvals are complete, production started, or production cancelled it again), with what a new cancellation needs for the one who
 // may cancel it.
 const restored=view.editable&&!view.cancelled&&remote?.status!=='cancelled'?moldRestoredText(view.sending.error,say,{cancellable:view.can.cancel}):'';
 const facts:[string,React.ReactNode][]=[
  [say('رقم أمر الإنتاج','Production order'),remote?.orderNo??'—'],[say('السريال','Serial'),remote?.moldSerial||'—'],[say('تاريخ الإنتاج','Production date'),day(remote?.productionDate)],
  [say('التسليم','Delivery'),remote?.delivered?say('سُلِّم','Delivered')+' · '+day(remote.deliveryDate):say('لم يُسلَّم','Not delivered')],[say('كود يورست','Yourrest code'),'YR-C-'+String(view.crmNumber).padStart(6,'0')],
  [say('تاريخ الطلب','Requested'),stamp(view.requestedAt)],[say('مقدّم الطلب','Requested by'),view.memberName],
  ...(approving?[[say('المندوب','Salesman'),current!.salesman.name||'—'] as [string,React.ReactNode]]:[]),
  ...(numbers?(['quoteNo','poNo'] as const).map(key=>[say(...moldQuotePoNames[key]),numbers[key]?<bdi key={key} dir="ltr">{numbers[key]}</bdi>:'—'] as [string,React.ReactNode]):[]),
 ];
 const asked:[string,React.ReactNode][]=[
  [say('الوصف','Description'),<span dir="auto" key="d">{specs.description}</span>],[say('العلب','Core'),say(MOLD_CORES[specs.core as keyof typeof MOLD_CORES]||specs.core,specs.core)],[say('الرجاجات','Vibrators'),specs.vibrators],
  [say('الموديل','Model'),say(MOLD_MODELS[specs.model as keyof typeof MOLD_MODELS]||specs.model,specs.model)],[say('بلوكة النص','Half block'),say(MOLD_HALF_BLOCKS[specs.halfBlock as keyof typeof MOLD_HALF_BLOCKS]||specs.halfBlock,specs.halfBlock)],
  [say('عرض القالب (مم)','Mold width (mm)'),specs.moldWidth],[say('مقاس الجلب','Gelba size'),specs.gelbaSize],[say('رقم القالب','Mold no.'),specs.moldNo||'—'],[say('الكمية','Quantity'),specs.quantity],
  // «رابط التصميم» is no longer asked for (2026-11-03): an older request's own link is still shown, read-only; nothing for one without.
  ...(specs.designUrl?[[say('رابط التصميم','Design link'),<a key="u" href={specs.designUrl} target="_blank" rel="noopener noreferrer" dir="ltr">{say('فتح الرابط','Open link')}</a>] as [string,React.ReactNode]]:[]),
  [say('ملاحظات','Notes'),<span dir="auto" key="n">{specs.notes||'—'}</span>],
  // How the customer pays: the CRM's own (or, approving, production's now); nothing for a request asked for before 2026-11-03.
  ...(payment?[[say('الدفع','Payment'),say(...moldPaymentNames[payment])] as [string,React.ReactNode]]:[]),
 ];
 return <Sheet open onOpenChange={open=>{if(!open)onClose();}}>
  <SheetContent side={direction()==='rtl'?'left':'right'} className="mold-sheet" dir={direction()}>
   <SheetTitle>{approving&&current!.customer.name||view.customerName}</SheetTitle>
   <SheetDescription>{statusText(view,say)}{remote?' · '+say('مراحل منتهية','stages done')+' '+remote.stagesDone+'/'+remote.stagesTotal:''}</SheetDescription>
   <SendingState view={view} linkReady={linkReady} say={say}/>
   {restored&&<p className="mold-banner mold-restored" data-kind="restored" role="status"><Undo2 size={16} aria-hidden="true"/>{restored}</p>}
   {pullError&&<p className="mold-banner" data-kind="stale" role="status"><TriangleAlert size={16} aria-hidden="true"/>{say('تعذّر تحديث المراحل الآن','Stages could not be refreshed now')}: {pullError}</p>}
   {view.cancelled&&<p className="mold-banner" data-kind="cancelled">{say('أُلغي الطلب','The request was cancelled')}{view.cancelReason?': '+view.cancelReason:''}</p>}
   {/* A change production refused for good (production_only among them), or specifications that are not production's: said plainly. */}
   {(moldChangeRefused(view.sending.error)||view.unconfirmed)&&<p className="mold-banner mold-production-only" data-kind="stale" role="status"><TriangleAlert size={16} aria-hidden="true"/>{changeRefusedNotice(view,say,quotePo)}</p>}
   {!view.cancelled&&remote?.status==='cancelled'&&<p className="mold-banner" data-kind="cancelled">{say('أُلغي الطلب في تطبيق الإنتاج؛ لم يعد التعديل أو الإلغاء ممكنًا.','The request was cancelled in the production application; it can no longer be changed.')}</p>}
   {numbers?.missing&&<QuotePoMissing say={say}/>}
   {remote?.waitingStep&&!view.cancelled&&<p className="mold-waiting" data-step={remote.waitingStep}><Hourglass size={15} aria-hidden="true"/><strong>{say(...moldWaitingNames[remote.waitingStep])}</strong>{waitingSince(view,say)&&<span>{waitingSince(view,say)}</span>}</p>}
   <MoldApprovals view={view} say={say}/>
   <MoldStages view={view} say={say}/>
   <p className="mold-updated">{say('آخر تحديث للحالة','Status last updated')}: {stamp(view.remoteAt||statusAt)}</p>
   <dl className="mold-facts">{facts.map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
   <h3 className="mold-subtitle">{say('المواصفات','Specifications')}</h3>
   {/* The sales manager reads what production lists now; anyone else the CRM's copy (the status object carries no data, so what the
       production manager changes there never shows here), said so. */}
   {approving?<p className="mold-specs-note" data-source="production">{say('بيانات الطلب كما في تطبيق المنتجات الآن (بعد أي تعديل من مدير الإنتاج)، وهي ما تعتمده.','The request\'s data as it is now in the products application (after any edit by the production manager): what you approve.')}</p>
    :view.can.approve?<p className="mold-specs-note" data-source="crm">{say('الاعتماد من «طلبات بانتظار اعتمادي» حيث تظهر بيانات الطلب كما في تطبيق المنتجات الآن؛ حدّث الصفحة.','Approve it from «Waiting for my approval», which shows the request\'s data as it is now in the products application; refresh the page.')}</p>
    :remote&&!view.unconfirmed&&<p className="mold-specs-note" data-source="crm">{say('المواصفات كما أرسلها الـCRM. بعد الإرسال يعدّلها مدير الإنتاج في تطبيق المنتجات فقط، وتعديله لا يظهر هنا.','The specifications as the CRM sent them. Once sent, the production manager alone edits them in the products application, and those edits do not show here.')}</p>}
   <dl className="mold-facts">{asked.map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
   <MoldDesignFiles view={view} uploads={mine} queue={uploads} onView={done} say={say} quotePo={quotePo}/>
   {!view.editable&&!view.cancelled&&view.can&&!view.can.edit&&remote&&remote.status!=='cancelled'&&<p className="mold-locked"><Lock size={14} aria-hidden="true"/>{remote.status==='confirmed'?say('اكتملت الاعتمادات؛ لم يعد الإلغاء أو تغيير ملفات التصميم ممكنًا.','All approvals are in; the request can no longer be cancelled and its design files can no longer change.'):say('بدأ الإنتاج؛ لم يعد الإلغاء أو تغيير ملفات التصميم ممكنًا.','Production has started; the request can no longer be cancelled and its design files can no longer change.')}</p>}
   {action.error&&<p className="form-error" role="alert">{t(action.error)}</p>}
   <div className="mold-actions">
    {approving&&<button type="button" className="btn primary" disabled={action.busy} onClick={()=>void action.run({action:'approve',id:view.id})}>{action.busy?<Loader2 className="spin" size={16}/>:<BadgeCheck size={16}/>}{say('اعتماد','Approve')}</button>}
    {view.can.withdraw&&<button type="button" className="btn subtle" disabled={action.busy} onClick={()=>void action.run({action:'withdraw',id:view.id})}>{action.busy?<Loader2 className="spin" size={16}/>:<Undo2 size={16}/>}{say('سحب الاعتماد','Withdraw approval')}</button>}
    {view.can.resend&&<button type="button" className="btn primary" disabled={action.busy||!linkReady} onClick={()=>void action.run({action:'resend',id:view.id})}>{action.busy?<Loader2 className="spin" size={16}/>:<Send size={16}/>}{say('إعادة الإرسال','Resend')}</button>}
    {view.can.edit&&<button type="button" className="btn subtle" disabled={action.busy} onClick={()=>setEditing(true)}>{say('تعديل الطلب','Edit request')}</button>}
    {view.can.cancel&&!cancelling&&<button type="button" className="btn danger-outline" disabled={action.busy} onClick={()=>setCancelling(true)}>{say('إلغاء الطلب','Cancel request')}</button>}
   </div>
   {/* Cancelled before and restored by the production manager: a reason used already is refused here, before anything is sent (production
       would answer it with the request as it is). */}
   {cancelling&&<form className="mold-cancel" onSubmit={event=>{event.preventDefault();if(moldCancelReasonUsed(reason,view.cancelReasons)){setReasonError(say(...MOLD_SAME_REASON_TEXT));return;}setReasonError('');void action.run({action:'cancel',id:view.id,version:view.version,reason}).then(next=>{if(next)setCancelling(false);});}}>
    <VoiceField label={view.cancelReasons.length?say('سبب الإلغاء (سبب جديد)','Reason (a new one)'):say('سبب الإلغاء (اختياري)','Reason (optional)')} value={reason} onChange={value=>{setReason(value);setReasonError('');}} multiline full inputProps={{maxLength:MOLD_LIMITS.cancelReason}}/>
    {reasonError&&<p className="form-error mold-reason-error" role="alert">{reasonError}</p>}
    <div className="mold-actions"><button type="submit" className="btn danger" disabled={action.busy}>{say('تأكيد الإلغاء','Confirm cancellation')}</button><button type="button" className="btn subtle" onClick={()=>setCancelling(false)}>{say('رجوع','Back')}</button></div>
   </form>}
   {editing&&<MoldRequestDialog customers={customers} editing={view} uploads={uploads} quotePo={quotePo} used={{design:designUsed(view,mine),quote:designUsed(view,mine,'quote'),po:designUsed(view,mine,'po')}} onClose={()=>setEditing(false)} onSaved={next=>{setEditing(false);if(next)setView(next);onChanged();}} onRefused={next=>{setView(next);onChanged();}}/>}
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

/** The form's fields. «رابط التصميم» is not one of them any more (the owner, 2026-11-03): a new request carries none, and an older
 *  request's own link is kept by the server as stored, whatever the form sends (shown read-only while editing). */
const blank:Record<string,string>={description:'',core:'',vibrators:'',model:'',halfBlock:'',moldWidth:'',gelbaSize:'',moldNo:'',quantity:'1',notes:'',payment:'',quoteNo:'',poNo:''};
/** The form of a request being edited: its specifications, its payment ('' for one asked for before 2026-11-03: to be chosen now) and its
 *  quotation and PO numbers (the CRM's own: an edit is only for a request production does not hold). */
const asForm=(specs:MoldSpecs,payment:MoldPayment|null,numbers:MoldQuotePoView|null)=>({...Object.fromEntries(Object.entries(blank).map(([key])=>[key,specs[key as keyof MoldSpecs]===null||specs[key as keyof MoldSpecs]===undefined?'':String(specs[key as keyof MoldSpecs])])),payment:payment||'',
 quoteNo:numbers?.from==='crm'?numbers.quoteNo:'',poNo:numbers?.from==='crm'?numbers.poNo:''});
/** A quotation or PO number's refusal on the device, in the representative's words (validateMoldQuotePo names the field). */
function quotePoErrors(errors:Record<string,string>,say:Say){
 const out:Record<string,string>={};
 for(const key of ['quoteNo','poNo'] as const)if(errors[key])out[key]=/أطول/.test(errors[key])?say(errors[key],(key==='quoteNo'?'The quotation number':'The PO number')+' is longer than '+MOLD_QUOTE_PO_MAX+' characters')
  :say(errors[key],(key==='quoteNo'?'The quotation number':'The PO number')+' has characters that are not allowed');
 if(errors.quotePo)out.quotePo=say(...MOLD_QUOTE_PO_REQUIRED_TEXT);
 return out;
}

/** Ask for a mold (a customer the member can see, then the specifications), or change one that has certainly never reached production
 *  (once sent, its data is edited by the production manager only); either way with design files, which upload once the request is saved
 *  (`used`: the places the request's files already take). An edit the server refuses (it was sent meanwhile) keeps the form open with
 *  the reason, and onRefused takes the request as it now stands (no more edit). */
function MoldRequestDialog({customers,editing,uploads,used={},quotePo=false,onClose,onSaved,onRefused}:{customers:Row[];editing?:MoldRequestView;uploads:DesignUploadQueue;used?:Partial<Record<MoldFileCategory,number>>;quotePo?:boolean;onClose:()=>void;onSaved:(view:MoldRequestView|null)=>void;onRefused?:(view:MoldRequestView)=>void}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const [customerId,setCustomerId]=useState(editing?.customerId||''),[search,setSearch]=useState(''),[form,setForm]=useState<Record<string,string>>(editing?asForm(editing.specs,editing.payment,editing.quotePo):blank),[shown,setShown]=useState<Record<string,string>>({});
 const action=useMoldAction(onSaved,onRefused);
 // The quotation and PO numbers and their files: asked for once production's update of 2026-11-03 is known to be live (or the server
 // has just said it is, refusing a request without them).
 // Once the server has asked for them, they stay asked for (a page loaded before the update): a later attempt that fails without an
 // answer must resend the same body, numbers included, under the same identifier, so the request is never saved twice.
 const demanded=['quotePo','quoteNo','poNo'].some(key=>!!action.fields[key]),[wasDemanded,setWasDemanded]=useState(false);
 if(demanded&&!wasDemanded)setWasDemanded(true);
 const asks=quotePo||demanded||wasDemanded;
 const [designs,setDesigns]=useState<DesignChoice[]>([]),[quotes,setQuotes]=useState<DesignChoice[]>([]),[pos,setPos]=useState<DesignChoice[]>([]),[asking,setAsking]=useState(false);
 const files=asks?[...designs,...quotes,...pos]:designs,ready=files.filter(choice=>!choice.refusal);
 const chosen=customers.find(row=>row.id===customerId);
 const matches=useMemo(()=>{const needle=search.trim().toLowerCase();return customers.filter(row=>!needle||[row.data.name,row.data.code,row.data.internalCode,row.data.city].some(text=>String(text||'').toLowerCase().includes(needle))).slice(0,30);},[customers,search]);
 const clear=(key:string)=>setShown(previous=>{if(!(key in previous))return previous;const next={...previous};delete next[key];return next;});
 const set=(key:string,value:string)=>{setForm(previous=>({...previous,[key]:value}));clear(key);};
 const errors={...shown,...action.fields};
 const submit=(event:React.FormEvent)=>{
  event.preventDefault();
  // How the customer pays is required (2026-11-03): cash or deferred.
  // At least one of the quotation and PO numbers once production's update is live (2026-11-03), normalized as production stores them.
  // No design link is sent: the server keeps an older request's own as it is.
  const checked=validateMoldSpecs(form),payment=moldPayment(form.payment),numbers=validateMoldQuotePo(form,{required:asks});
  const errors:Record<string,string>={...checked.errors,...(payment?{}:{payment:say('اختار طريقة الدفع: نقدي أو آجل','Choose how the customer pays: cash or deferred')}),...(asks?quotePoErrors(numbers.errors,say):{})};
  if(!editing&&!customerId){setShown({...errors,customer:say('اختر العميل','Choose the customer')});return;}
  if(Object.keys(errors).length){setShown(errors);return;}
  setShown({});
  // On a request production holds, attaching a file undoes the approvals: said first, then confirmed with the same button.
  if(editing&&ready.length&&designNeedsWarning(editing)&&!asking){setAsking(true);return;}
  setAsking(false);
  // The files go once the request is saved (each with its own requestId, kept for retries), the request's own change first.
  const typed=asks?{quoteNo:numbers.quoteNo,poNo:numbers.poNo}:{};
  const specs={...checked.specs};delete specs.designUrl;
  void action.run(editing?{action:'update',id:editing.id,version:editing.version,specs,payment,...typed}:{action:'create',customerId,specs,payment,...typed}).then(next=>{if(next&&ready.length)uploads.add(next.id,ready);});
 };
 const choice=(key:string,label:string,options:[string,string][])=><fieldset className="mold-choice" aria-invalid={!!errors[key]}><legend>{label}</legend><div>{options.map(([value,text])=><label key={value} data-active={form[key]===value}><input type="radio" name={key} value={value} checked={form[key]===value} onChange={()=>set(key,value)}/>{text}</label>)}</div>{errors[key]&&<small className="field-error">{errors[key]}</small>}</fieldset>;
 const number=(key:string,label:string,usual:number[]=[])=><label className="mold-field" aria-invalid={!!errors[key]}>{label}<input inputMode="numeric" dir="ltr" value={form[key]} onChange={event=>set(key,event.target.value.replace(/[^\d٠-٩]/g,'').replace(/[٠-٩]/g,digit=>String(digit.charCodeAt(0)-0x660)))}/>{!!usual.length&&<span className="mold-usual">{usual.map(value=><button type="button" key={value} className="btn small subtle" onClick={()=>set(key,String(value))}>{value}</button>)}</span>}{errors[key]&&<small className="field-error">{errors[key]}</small>}</label>;
 // Dimensions and the mold number are typed (a code); the notes are free text and take dictation.
 const text=(key:string,label:string,max:number)=><label className="mold-field" aria-invalid={!!errors[key]}>{label}<input type="text" maxLength={max} dir="ltr" value={form[key]} onChange={event=>set(key,event.target.value)}/>{errors[key]&&<small className="field-error">{errors[key]}</small>}</label>;
 // Typing one number clears the «one at least» refusal too.
 const numberField=(key:'quoteNo'|'poNo',label:string)=><label className="mold-field" aria-invalid={!!errors[key]||!!errors.quotePo}>{label}<input type="text" name={key} maxLength={MOLD_QUOTE_PO_MAX} dir="ltr" autoComplete="off" value={form[key]} onChange={event=>{set(key,event.target.value);clear('quotePo');}}/>{errors[key]&&<small className="field-error">{errors[key]}</small>}</label>;
 const picker=(category:MoldFileCategory,choices:DesignChoice[],change:(next:DesignChoice[])=>void)=><MoldDesignPicker key={category} category={category} choices={choices} onChange={next=>{change(next);setAsking(false);}} room={MOLD_CATEGORY_MAX_FILES[category]-(used[category]||0)} disabled={action.busy} say={say}/>;
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
    {choice('payment',say('طريقة الدفع','Payment'),[['cash',say('نقدي','Cash')],['deferred',say('آجل','Deferred')]])}
    {/* An older request's own design link (no longer asked for, 2026-11-03): kept as it is, shown read-only. */}
    {editing?.specs.designUrl&&<p className="mold-specs-note mold-design-link-kept" data-source="crm">{say('رابط التصميم (من الطلب، يبقى كما هو): ','Design link (from the request, kept as it is): ')}<a href={editing.specs.designUrl} target="_blank" rel="noopener noreferrer" dir="ltr">{say('فتح الرابط','Open link')}</a></p>}
    <VoiceField label={say('ملاحظات (اختياري)','Notes (optional)')} value={form.notes} onChange={value=>set('notes',value)} multiline full className="mold-notes" inputProps={{maxLength:MOLD_LIMITS.notes}}/>
    {asks&&<fieldset className="mold-quote-po-fields" aria-invalid={!!errors.quotePo}><legend>{say('عرض السعر والـ PO (واحد على الأقل)','Quotation and PO (at least one)')}</legend>
     <div className="mold-grid">{numberField('quoteNo',say('رقم عرض السعر','Quotation no.'))}{numberField('poNo',say('رقم الـ PO','PO no.'))}</div>
     {errors.quotePo&&<small className="field-error" role="alert">{errors.quotePo}</small>}
    </fieldset>}
    {picker('design',designs,setDesigns)}
    {asks&&picker('quote',quotes,setQuotes)}
    {asks&&picker('po',pos,setPos)}
    {asking&&!!ready.length&&<div className="mold-design-confirm" role="group" ref={revealCentered} aria-label={say('تأكيد إرفاق الملفات','Confirm attaching the files')}><p><TriangleAlert size={16} aria-hidden="true"/>{designWarningText(say)}</p></div>}
    {action.error&&<p className="form-error" role="alert">{t(action.error)}</p>}
    <div className="mold-actions"><button type="submit" className="btn primary" disabled={action.busy}>{action.busy?<Loader2 className="spin" size={16}/>:asking?<Paperclip size={16}/>:<Send size={16}/>}{asking?say('تأكيد: حفظ وإرفاق الملفات','Confirm: save and attach the files'):editing?say('حفظ وإرسال التعديل','Save and send the change'):say('حفظ وإرسال للإنتاج','Save and send to production')}</button>{asking&&<button type="button" className="btn subtle" onClick={()=>setAsking(false)} disabled={action.busy}>{say('رجوع','Back')}</button>}<button type="button" className="btn subtle" onClick={onClose} disabled={action.busy}>{say('إلغاء','Cancel')}</button></div>
   </form>
  </DialogContent>
 </Dialog>;
}
