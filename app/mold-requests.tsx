'use client';
import React,{useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {BadgeCheck,Hourglass,Loader2,Lock,Paperclip,PenLine,RefreshCw,Search,Send,TriangleAlert,Undo2,Wrench} from 'lucide-react';
import {Sheet,SheetContent,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {useLanguage,direction,getLanguage,t} from '@/lib/i18n';
import {definiteSubmitRejection,submitJson,SubmitError} from '@/lib/client-submit';
import type {Member,Row} from '@/lib/crm';
import {MOLD_STAGES,MOLD_STAGE_NAMES,MOLD_CORES,MOLD_MODELS,MOLD_HALF_BLOCKS,MOLD_ADDRESS_TEXT,MOLD_DESIGN_FILE_PICKER_TITLE,MOLD_DESIGN_FILE_REQUIRED_TEXT,MOLD_PENDING_REFRESH_MS,MOLD_QUOTE_FILE_REQUIRED_TEXT,MOLD_QUOTE_PO_MISSING_ATTACH,MOLD_QUOTE_PO_MISSING_OTHERS,MOLD_QUOTE_PO_MISSING_PRODUCTION,MOLD_QUOTE_PO_MISSING_TEXT,MOLD_SAME_REASON_TEXT,MOLD_SIGNATURE_TEXT,moldApprovalNames,moldChangeRefused,moldErrorText,moldFieldNames,moldHeldTexts,MOLD_CUSTOMER_TEXT,moldOrderNoText,moldPaymentNames,moldPendingUnreadableText,moldPendingAgain,moldPendingKey,moldPendingTarget,moldRestoredText,moldSendingNames,moldStatusNames,moldWaitingNames,type MoldFileCategory,type MoldPayment,type MoldPendingAnswer,type MoldRequestView,type MoldRequestsAnswer,type MoldSignature,type MoldSpecs} from '@/lib/mold-requests';
import {MOLD_CATEGORY_MAX_FILES,MOLD_LIMITS,MOLD_USUAL,moldAddress,moldCancelReasonUsed,moldCustomerName,moldErpCode,moldPayment,validateMoldSpecs} from '@/portable/mold-rules.mjs';
import VoiceField from './voice-field';
import MoldCustomerFields,{moldCustomerByErpCode,type MoldCustomerText} from './mold-customer-fields';
import {MoldDesignFiles,MoldDesignPicker,MoldPendingDesignFiles,designNeedsWarning,pendingFilesApprovedNote,designUploadQueue,designUsed,designWarningText,revealCentered,type DesignChoice,type DesignUpload,type DesignUploadQueue} from './mold-design-files';
import {MoldSigningStep} from './mold-signature';
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
/** Production marks the request as having neither a quotation file nor a PO file while finance has not approved it (quoteOrPoMissing,
 *  2026-11-05): «ناقص ملف عرض السعر / الـ PO». hint: on the request's sheet, who attaches it (the requester below, while editable; else
 *  the representative or the production manager). The numbers are not shown any more (production no longer shows them). */
const QuotePoMissing=({say,hint}:{say:Say;hint?:'attach'|'others'|'production'})=><p className="mold-quote-po-missing" role="status"><TriangleAlert size={14} aria-hidden="true"/><span>{say(...MOLD_QUOTE_PO_MISSING_TEXT)}{hint&&<small>{say(...(hint==='attach'?MOLD_QUOTE_PO_MISSING_ATTACH:hint==='production'?MOLD_QUOTE_PO_MISSING_PRODUCTION:MOLD_QUOTE_PO_MISSING_OTHERS))}</small>}</span></p>;
/** Why a request is kept in the CRM (sending.held): its quotation's or PO's file (2026-11-05), its design file (2026-11-08), or production's
 *  update for a customer not in the CRM (free_customer, 2026-11-09), with its words; null otherwise (or for a reason this page cannot
 *  name, which reads as the state). */
const heldTexts=(sending:MoldRequestView['sending'])=>sending.held?moldHeldTexts[sending.held]||null:null;
/** The state a page of this release shows: a request kept for a file (sending.held) as such, else the state the server gives (one every
 *  page knows). */
const shownState=(sending:MoldRequestView['sending'])=>heldTexts(sending)?sending.held==='free_customer'?'needs_update':'needs_file':sending.state;
const sendingName=(sending:MoldRequestView['sending'],linkReady:boolean):[string,string]=>heldTexts(sending)?.name||moldSendingNames[linkReady?sending.state:'off'];
/** «وقّع العميل: <signer> · <time>» (2026-11-04), with the image through the CRM when it is given (the request's sheet), once the image
 *  reached production (state sent). Before that the request says where the signature stands instead: on its way («التوقيع لسه ما وصلش
 *  للإنتاج»), stopped (the resend starts it again) or refused for good (cancel and ask again with a new signature). */
function SignedBy({signature,href,state,say}:{signature:MoldSignature;href?:string|null;state:'sent'|'waiting'|'stopped'|'refused'|'missing';say:Say}){
 const note=state==='waiting'?MOLD_SIGNATURE_TEXT.waiting:state==='stopped'?MOLD_SIGNATURE_TEXT.stopped:state==='refused'?MOLD_SIGNATURE_TEXT.refused:state==='missing'?MOLD_SIGNATURE_TEXT.pendingMissing:null;
 return <div className="mold-signature-view" data-signed={state==='sent'||undefined} data-state={state}>
  {state==='sent'?<p><PenLine size={15} aria-hidden="true"/><span>{say(...MOLD_SIGNATURE_TEXT.signed)}: <b><bdi>{signature.signer}</bdi></b> · <bdi dir="ltr">{stamp(signature.signedAt)}</bdi></span></p>
   :<p className="mold-signature-note" role="status"><TriangleAlert size={15} aria-hidden="true"/><span>{say(...note!)} <small>({say('وقّع: ','Signed by: ')}<bdi>{signature.signer}</bdi> · <bdi dir="ltr">{stamp(signature.signedAt)}</bdi>)</small></span></p>}
  {href&&<img src={href+'&inline=1'} alt={say('توقيع العميل: ','Customer signature: ')+signature.signer} loading="lazy" decoding="async"/>}
 </div>;
}

/** The mold requests the reader may see, with their status as pulled by the server when the list opens. */
export function useMoldRequests(me:Member|null){
 const [data,setData]=useState<MoldRequestsAnswer|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),generation=useRef(0);
 const identity=me?[me.id,me.role,me.authVersion].join(':'):'';
 const refresh=useCallback(async()=>{
  if(!identity)return;
  const current=++generation.current;setLoading(true);
  // refs=1: this page names the waiting list's items by requestRef or crmRequestId, so it gets every item, numbered by production or not
  // yet (the products update of 2026-11-05); a page loaded before asks without it and gets only the numbered ones (moldPendingForOldPage).
  try{const next=await submitJson<MoldRequestsAnswer>('/api/mold-requests?refs=1',{cache:'no-store'},{language:getLanguage()});if(current===generation.current){setData(next);setError('');}}
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
 // The fields the last refusal named, for the caller's follow-up once run has answered (the signing step, 2026-11-04).
 const lastFields=useRef<Record<string,string>>({});
 const run=useCallback(async(body:Record<string,unknown>)=>{
  if(lock.current)return null;
  lock.current=true;setBusy(true);setError('');setFields({});lastFields.current={};
  const text=JSON.stringify(body);if(attempt.current?.body!==text)attempt.current={body:text,key:crypto.randomUUID()};
  try{
   const reply=await submitJson<{request:MoldRequestView}>('/api/mold-requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,requestId:attempt.current.key})},{language:getLanguage()});
   attempt.current=null;onDone(reply.request);return reply.request;
  }catch(failure){
   // 409 from production comes with the request as production holds it: show both the reason and the restored request.
   const reply=failure instanceof SubmitError?failure.body as {request?:MoldRequestView;fields?:Record<string,string>}|undefined:undefined;
   if(reply?.fields){setFields(reply.fields);lastFields.current=reply.fields;}
   setError(messageOf(failure));if(definiteSubmitRejection(failure))attempt.current=null;
   if(reply?.request)(onRefused||onDone)(reply.request);
   return null;
  }finally{lock.current=false;setBusy(false);}
 },[onDone,onRefused]);
 return {run,busy,error,fields,lastFields};
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
 const kept=heldTexts(sending);
 return <div className="mold-sending" data-state={shownState(sending)} data-held={kept?sending.held:undefined} role="status">
  <TriangleAlert size={16} aria-hidden="true"/>
  <div><strong>{say(...(kept?kept.name:moldSendingNames[sending.state]))}</strong>
   <p>{!linkReady&&!kept?say('الطلب محفوظ في الـCRM، وسيُرسل عند تفعيل الربط مع الإنتاج.','The request is saved in the CRM and will be sent once the production link is set up.')
    // A new request kept until its quotation's or PO's file (2026-11-05), or its design file (2026-11-08), is attached; attaching it
    // sends the request, then its files. Its requester is told what to do; a reader who cannot attach (the sales manager, the
    // administrator) whom it waits for.
    :kept?say(...(view.can.attach?kept.waiting:kept.others))
    // A request carrying a quotation or PO number is kept until production's update is known to be live (never sent without them).
    :sending.state==='held'?say('الطلب محفوظ في الـCRM ومعه رقم عرض السعر / الـ PO، ويُرسل بعد تحديث تطبيق المنتجات.','The request is saved in the CRM with its quotation / PO number and is sent once the products application is updated.')
    :sending.state==='rejected'?say('رفض الإنتاج: ','Production refused: ')+((sending.error?.fields||[]).map(field=>say(...(moldFieldNames[field]||[field,field]))).join('، ')||moldErrorText(sending.error?.code||'',say))+'. '
     // Edited only while it has certainly never reached production; otherwise a resend sends the same refused data, so the way on is
     // to cancel it and ask again.
     +(view.can.edit?say('عدّل الطلب أو أعد إرساله.','Edit the request or resend it.'):say('ألغِ الطلب واطلبه من جديد.','Cancel the request and ask again.'))
    :what+' '+say('محفوظ في الـCRM ولم يصل للإنتاج بعد','is saved in the CRM and has not reached production yet')+(sending.error?': '+moldErrorText(sending.error.code,say):'')+'.'}</p>
   {linkReady&&!kept&&sending.state==='waiting'&&<small>{sending.nextAttemptAt?say('المحاولة التالية تلقائيًا: ','Next automatic try: ')+stamp(sending.nextAttemptAt):say('توقفت المحاولات التلقائية بعد 24 ساعة؛ استخدم «إعادة الإرسال».','Automatic tries stopped after 24 hours; use Resend.')}{sending.attempts?' · '+say('محاولات: ','Tries: ')+sending.attempts:''}</small>}
  </div>
 </div>;
}

function MoldCard({view,linkReady,unsent,onOpen,say}:{view:MoldRequestView;linkReady:boolean;unsent:number;onOpen:()=>void;say:Say}){
 const remote=view.remote;
 return <button type="button" className="mold-card" data-status={view.cancelled?'cancelled':remote?.status||'local'} data-sending={view.sending.state} onClick={onOpen}>
  <header><strong>{view.customerName}</strong><span className="mold-chip" data-status={view.cancelled?'cancelled':remote?.status||'local'} data-step={view.cancelled?undefined:remote?.waitingStep||undefined} data-mine={view.can.approve||undefined}>{statusText(view,say)}</span></header>
  {waitingSince(view,say)&&<small className="mold-card-since"><Hourglass size={13} aria-hidden="true"/>{waitingSince(view,say)}</small>}
  {/* The customer's ERP code (2026-11-09), and «غير مسجل في الـCRM» for a customer not in the CRM (no Yourrest number). */}
  {(!!view.customerErpCode||view.crmNumber===null)&&<p className="mold-card-customer">{!!view.customerErpCode&&<span>{say('كود ERP','ERP code')}: <bdi dir="ltr">{view.customerErpCode}</bdi></span>}{view.crmNumber===null&&<span className="mold-not-in-crm">{say(...MOLD_CUSTOMER_TEXT.notInCrm)}</span>}</p>}
  <p dir="auto">{view.specs.description}</p>
  <div className="mold-card-facts">
   {/* The number from the latest status pulled (production gives it at its approval, 2026-11-05, and renumbered once): never kept elsewhere. */}
   <span>{say('رقم أمر الإنتاج','Production order')}: <b data-order={remote?.orderNo??undefined}>{moldOrderNoText(remote,say,{cancelled:view.cancelled||remote?.status==='cancelled'})}</b></span>
   <span>{say('الكمية','Quantity')}: <b>{view.specs.quantity}</b></span>
   <span>{say('المراحل','Stages')}: <b>{remote?remote.stagesDone+'/'+remote.stagesTotal:'—'}</b></span>
   <span>{say('مقدّم الطلب','Requested by')}: {view.memberName}</span>
   {/* Design files, then the quotation's and PO's together (production's update of 2026-11-03). */}
   {(()=>{const designs=view.designFiles.filter(file=>(file.category||'design')==='design').length,documents=view.designFiles.length-designs;return <>
    {!!designs&&<span className="mold-card-files"><Paperclip size={13} aria-hidden="true"/>{say('ملفات التصميم','Design files')}: <b>{designs}</b></span>}
    {!!documents&&<span className="mold-card-files" data-category="quote-po"><Paperclip size={13} aria-hidden="true"/>{say('ملفات عرض السعر والـ PO','Quotation and PO files')}: <b>{documents}</b></span>}</>;})()}
  </div>
  {view.quotePo?.missing&&<QuotePoMissing say={say}/>}
  {/* Kept for its quotation's or PO's file (2026-11-05): said whatever the link's state, since attaching it is the representative's to do. */}
  {view.sending.state!=='sent'&&<small className="mold-card-sending" data-state={shownState(view.sending)} data-held={heldTexts(view.sending)?view.sending.held:undefined}>{say(...sendingName(view.sending,linkReady))}</small>}
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
  {open&&<MoldRequestSheet key={open.id+':'+open.version} view={open} current={data?.pending?.items.find(item=>item.inCrm&&item.crmRequestId===open.id)||null} linkReady={!!data?.linkReady} quotePo={!!data?.quotePo} signs={!!data?.signatureRequired} statusAt={open.remoteAt} customers={customers} uploads={uploads} uploading={uploading} onClose={()=>{setOpenId(null);setApproverView(null);}} onChanged={changed}/>}
  {creating&&<MoldRequestDialog customers={customers} uploads={uploads} quotePo={!!data?.quotePo} signs={!!data?.signatureRequired} onClose={()=>setCreating(false)} onSaved={view=>{setCreating(false);void refresh();if(view)setOpenId(view.id);}}/>}
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
 // Every item is named by moldPendingKey (the CRM's request by its crmRequestId, one registered in production by its requestRef), never by
 // its order number: none until production approves it, and renumbered once (the products update of 2026-11-05). errors keeps, with each
 // refusal, how to name the request should it leave the list.
 const [busy,setBusy]=useState<string|null>(null),[errors,setErrors]=useState<Record<string,{text:string;label:string}>>({}),[approved,setApproved]=useState<MoldPendingAnswer['items']>([]);
 // Read on each new list (state adjusted while rendering, not in an effect): a copy dropped here stays dropped should the request
 // leave the list again later.
 const [listed,setListed]=useState(pending);
 if(listed!==pending){
  setListed(pending);
  if(approved.some(copy=>moldPendingAgain(copy,pending.items)))setApproved(previous=>previous.filter(copy=>!moldPendingAgain(copy,pending.items)));
 }
 const keys=useRef(new Map<string,string>());
 const labelOf=(item:MoldPendingAnswer['items'][number])=>(item.customer.name||'—')+(item.orderNo?' · '+say('أمر الإنتاج ','Production order ')+item.orderNo:'');
 const failed=(item:MoldPendingAnswer['items'][number],text:string)=>setErrors(previous=>({...previous,[moldPendingKey(item)]:{text,label:labelOf(item)}}));
 const run=async(item:MoldPendingAnswer['items'][number],action:'approve-order'|'withdraw-order')=>{
  if(busy!==null)return;
  const key=moldPendingKey(item),target=moldPendingTarget(item);
  setBusy(key);failed(item,'');
  // A retry after an unclear failure keeps its identifier, so production is asked once.
  const name=action+':'+key;if(!keys.current.has(name))keys.current.set(name,crypto.randomUUID());
  try{
   if(!target)throw new Error(say('تعذّر تحديد الطلب؛ حدّث الصفحة.','The request could not be named; refresh the page.'));
   // page 'refs': this release's page, whose number (an item production gave no requestRef) the server checks against production now.
   await submitJson('/api/mold-requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...target,page:'refs',requestId:keys.current.get(name)})},{language:getLanguage()});
   keys.current.delete(name);
   setApproved(previous=>action==='approve-order'?[...previous.filter(other=>moldPendingKey(other)!==key),item]:previous.filter(other=>moldPendingKey(other)!==key));
   onChanged();
  }catch(failure){if(definiteSubmitRejection(failure))keys.current.delete(name);failed(item,messageOf(failure));if(failure instanceof SubmitError&&failure.status===409)onChanged();}
  finally{setBusy(null);}
 };
 const opening=async(item:MoldPendingAnswer['items'][number])=>{
  failed(item,'');
  try{await onOpen(item.crmRequestId!);}catch(failure){failed(item,messageOf(failure));}
 };
 const waiting=pending.items.filter(item=>!approved.some(other=>moldPendingKey(other)===moldPendingKey(item)));
 // A refusal for a request that has since left the list (production moved it on or cancelled it) stays readable above it.
 const orphaned=Object.entries(errors).filter(([key,error])=>error.text&&!pending.items.some(item=>moldPendingKey(item)===key)&&!approved.some(item=>moldPendingKey(item)===key));
 const card=(item:MoldPendingAnswer['items'][number],done:boolean)=>{
  const specs=item.specs,choice=(names:Record<string,string>,value:string)=>say(names[value]||value,value);
  // The CRM's own request in the manager's own list (theirs or their team's) still opens once approved; one only this list shows does not.
  const inList=item.inCrm&&!!item.crmRequestId&&ownList.has(item.crmRequestId);
  const key=moldPendingKey(item),error=errors[key]?.text;
  return <article key={key} className="mold-pending" data-source={item.source} data-done={done||undefined}>
   <header><strong>{item.customer.name||'—'}</strong><span className="mold-chip" data-source={item.source}>{item.source==='manual'?say('مسجّل في تطبيق الإنتاج','Registered in production'):say('من الـCRM','From the CRM')}</span></header>
   <p dir="auto">{specs.description}</p>
   <div className="mold-card-facts">
    <span>{say('رقم أمر الإنتاج','Production order')}: <b data-order={item.orderNo??undefined}>{moldOrderNoText(item,say)}</b></span><span>{say('الكمية','Quantity')}: <b>{specs.quantity??'—'}</b></span>
    <span>{say('المندوب','Salesman')}: {item.salesman.name||'—'}</span>{item.enteredBy&&<span>{say('سجّله في الإنتاج','Entered in production by')}: <bdi>{item.enteredBy}</bdi></span>}
    <span>{say('تاريخ الطلب','Requested')}: {stamp(item.requestedAt)}</span>{!done&&item.waitingSince&&<span><Hourglass size={13} aria-hidden="true"/> {say('بانتظارك من ','Waiting for you since ')+stamp(item.waitingSince)}</span>}
    {/* How the customer pays, as production holds it now (none for a request asked for before 2026-11-03). */}
    {item.payment&&<span className="mold-payment" data-payment={item.payment}>{say('الدفع','Payment')}: <b>{say(...moldPaymentNames[item.payment])}</b></span>}
   </div>
   {/* Production has neither a quotation file nor a PO file (2026-11-05): for one of the CRM's requests whoever asked for it (or the
       production manager) attaches one; for one registered in the products application, its production manager. */}
   {item.quoteOrPoMissing&&<QuotePoMissing say={say} hint={item.inCrm?'others':'production'}/>}
   {/* The customer's signature on the CRM's request (2026-11-04); its image is among the design files, labelled so. */}
   {item.signature&&<SignedBy signature={item.signature} state={item.signatureDelivered?'sent':'missing'} say={say}/>}
   <p className="mold-pending-specs">{[choice(MOLD_CORES,specs.core),specs.vibrators?say('رجاجات: ','Vibrators: ')+specs.vibrators:'',choice(MOLD_MODELS,specs.model),choice(MOLD_HALF_BLOCKS,specs.halfBlock),specs.moldWidth?say('عرض ','Width ')+specs.moldWidth:'',specs.gelbaSize?say('جلب ','Gelba ')+specs.gelbaSize:'',specs.moldNo?say('قالب ','Mold ')+specs.moldNo:''].filter(Boolean).join(' · ')}</p>
   {specs.notes&&<p className="mold-pending-notes" dir="auto">{specs.notes}</p>}
   {/* Approved just now: the request no longer waits for them, so its files are listed without links (the CRM's request shows them). */}
   <MoldPendingDesignFiles files={item.designFiles} say={say} note={done?pendingFilesApprovedNote(inList,say):''}/>
   {/* The quotation's and PO's files, the same way. */}
   {(['quote','po'] as const).map(category=><MoldPendingDesignFiles key={category} category={category} files={category==='quote'?item.quoteFiles:item.poFiles} say={say} note={done?pendingFilesApprovedNote(inList,say):''}/>)}
   {error&&<p className="form-error" role="alert">{error}</p>}
   <div className="mold-actions">
    {done?<><span className="mold-pending-done"><BadgeCheck size={16} aria-hidden="true"/>{say('اعتمدته الآن','You approved it')}</span><button type="button" className="btn subtle" disabled={busy!==null} onClick={()=>void run(item,'withdraw-order')}>{busy===key?<Loader2 className="spin" size={16}/>:<Undo2 size={16}/>}{say('سحب الاعتماد','Withdraw approval')}</button></>
     :<button type="button" className="btn primary" disabled={busy!==null} onClick={()=>void run(item,'approve-order')}>{busy===key?<Loader2 className="spin" size={16}/>:<BadgeCheck size={16}/>}{say('اعتماد','Approve')}</button>}
    {item.inCrm&&item.crmRequestId&&(!done||inList)&&<button type="button" className="btn subtle" onClick={()=>void opening(item)}>{say('فتح الطلب','Open request')}</button>}
    {/* An older request's design link, as production holds it (no longer asked for since 2026-11-03): shown read-only. */}
    {specs.designUrl&&<a className="btn subtle" href={specs.designUrl} target="_blank" rel="noopener noreferrer">{say('رابط التصميم','Design link')}</a>}
   </div>
  </article>;
 };
 return <div className="mold-pending-list">
  {!!pending.unreadable&&<p className="mold-banner mold-pending-unreadable" data-kind="stale" role="status"><TriangleAlert size={16} aria-hidden="true"/>{moldPendingUnreadableText(pending.unreadable,say)}</p>}
  {pending.error&&<p className="mold-banner" data-kind="stale" role="status"><TriangleAlert size={16} aria-hidden="true"/>{say('تعذّر تحديث القائمة الآن','The list could not be refreshed now')}: {moldErrorText(pending.error.code,say)}</p>}
  {orphaned.map(([key,error])=><p key={key} className="form-error mold-pending-gone" role="alert"><bdi>{error.label}</bdi>: {error.text}</p>)}
  {!waiting.length&&!pending.error&&!pending.unreadable&&<p className="empty mold-empty">{say('لا توجد طلبات بانتظار اعتمادك.','Nothing is waiting for your approval.')}</p>}
  {waiting.map(item=>card(item,false))}
  {!!approved.length&&<h3 className="mold-subtitle">{say('اعتمدتها الآن','Approved just now')}</h3>}
  {approved.map(item=>card(item,true))}
 </div>;
}

/** What a request says when production refused its last change for good (final: 409 production_only among them, or a change to a
 *  request production holds refused for its data): the change did not reach production and is not sent again, with why. And which
 *  specifications it shows: the change production refused (unconfirmed: the CRM never learned what production holds; said for as long
 *  as it stands, whatever error is stored later), or the last production accepted from the CRM. */
function changeRefusedNotice(view:Pick<MoldRequestView,'sending'|'unconfirmed'>,say:Say){
 const error=view.sending.error,refused=moldChangeRefused(error);
 const why=!error||!refused?'':error.fields?.length?say('رفض الإنتاج: ','Production refused: ')+error.fields.map(field=>say(...(moldFieldNames[field]||[field,field]))).join('، '):moldErrorText(error.code,say,{reason:error.reason});
 return (refused?say('آخر تعديل لم يصل للإنتاج ولن يُعاد إرساله: ','The last change did not reach production and will not be sent again: ')+why+'. ':'')
  +(view.unconfirmed?say('المواصفات المعروضة هي التعديل الذي رفضه الإنتاج، وليست بياناته: الطلب لديه ببياناته، ويعدّلها مدير الإنتاج فقط.','The specifications shown are the change production refused, not its data: production holds the request with its own data, which the production manager alone edits.')
   :say('المواصفات المعروضة آخر ما قبله الإنتاج من الـCRM؛ بعدها يعدّلها مدير الإنتاج فقط.','The specifications shown are the last production accepted from the CRM; since then only the production manager edits them.'));
}

/** One request: where production is, what was asked for, what waits to be sent, and the representative's actions while allowed (an
 *  edit only while it has certainly never reached production: once sent, the production manager edits it in the products application).
 *  The sales manager approves from here what production lists now (current, from «طلبات بانتظار اعتمادي»: the customer, salesman and
 *  specifications after the production manager's edits), so the approval is for what will be made; without that listing, no approval
 *  here. */
function MoldRequestSheet({view:initial,current,linkReady,quotePo=false,signs=false,statusAt,customers,uploads,uploading,onClose,onChanged}:{view:MoldRequestView;current:MoldPendingAnswer['items'][number]|null;linkReady:boolean;quotePo?:boolean;signs?:boolean;statusAt:string|null;customers:Row[];uploads:DesignUploadQueue;uploading:DesignUpload[];onClose:()=>void;onChanged:()=>void}){
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
 // Production lacks the quotation's and PO's file (2026-11-05): from the pending item when approving from it, else the status object;
 // nothing from an application older than production's update of 2026-11-03. The numbers are not shown.
 const missing=approving&&current!.quoteOrPoMissing!==undefined?current!.quoteOrPoMissing:!!view.quotePo?.missing;
 const deliveryAddress=approving?current!.customer.address:view.customerAddress||'';
 // Active again after a cancellation (the production manager restored it, 2026-11-03): said while it may still change (not once the
 // approvals are complete, production started, or production cancelled it again), with what a new cancellation needs for the one who
 // may cancel it.
 const restored=view.editable&&!view.cancelled&&remote?.status!=='cancelled'?moldRestoredText(view.sending.error,say,{cancellable:view.can.cancel}):'';
 const facts:[string,React.ReactNode][]=[
  [say('رقم أمر الإنتاج','Production order'),moldOrderNoText(remote,say,{cancelled:view.cancelled||remote?.status==='cancelled'})],[say('السريال','Serial'),remote?.moldSerial||'—'],[say('تاريخ الإنتاج','Production date'),day(remote?.productionDate)],
  [say('التسليم','Delivery'),remote?.delivered?say('سُلِّم','Delivered')+' · '+day(remote.deliveryDate):say('لم يُسلَّم','Not delivered')],
  // A customer not in the CRM (2026-11-09) has no Yourrest code: said so; the ERP code the request carries (typed, or the customer's).
  [say('كود يورست','Yourrest code'),view.crmNumber===null?<span className="mold-not-in-crm" key="y">{say(...MOLD_CUSTOMER_TEXT.notInCrm)}</span>:'YR-C-'+String(view.crmNumber).padStart(6,'0')],
  ...(view.customerErpCode?[[say('كود ERP','ERP code'),<bdi dir="ltr" key="e">{view.customerErpCode}</bdi>] as [string,React.ReactNode]]:[]),
  // Where the mold is delivered (2026-11-09): the request's own address, which may differ from the customer's registered one (as
  // production lists it now when approving from «طلبات بانتظار اعتمادي»); nothing for a request stored without one.
  ...(deliveryAddress?[[say('عنوان التسليم','Delivery address'),<span dir="auto" key="a">{deliveryAddress}</span>] as [string,React.ReactNode]]:[]),
  [say('تاريخ الطلب','Requested'),stamp(view.requestedAt)],[say('مقدّم الطلب','Requested by'),view.memberName],
  ...(approving?[[say('المندوب','Salesman'),current!.salesman.name||'—'] as [string,React.ReactNode]]:[]),
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
   {(moldChangeRefused(view.sending.error)||view.unconfirmed)&&<p className="mold-banner mold-production-only" data-kind="stale" role="status"><TriangleAlert size={16} aria-hidden="true"/>{changeRefusedNotice(view,say)}</p>}
   {!view.cancelled&&remote?.status==='cancelled'&&<p className="mold-banner" data-kind="cancelled">{say('أُلغي الطلب في تطبيق الإنتاج؛ لم يعد التعديل أو الإلغاء ممكنًا.','The request was cancelled in the production application; it can no longer be changed.')}</p>}
   {missing&&<QuotePoMissing say={say} hint={view.can.attach?'attach':'others'}/>}
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
   {/* The customer's signature (2026-11-04): who signed and when, and the image through the CRM, for whoever may open the request. */}
   {view.signature&&<SignedBy signature={view.signature} href={view.signature.href} state={view.signature.state} say={say}/>}
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
   {editing&&<MoldRequestDialog customers={customers} editing={view} uploads={uploads} quotePo={quotePo} signs={signs} used={{design:designUsed(view,mine),quote:designUsed(view,mine,'quote'),po:designUsed(view,mine,'po')}} onClose={()=>setEditing(false)} onSaved={next=>{setEditing(false);if(next)setView(next);onChanged();}} onRefused={next=>{setView(next);onChanged();}}/>}
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
const blank:Record<string,string>={description:'',core:'',vibrators:'',model:'',halfBlock:'',moldWidth:'',gelbaSize:'',moldNo:'',quantity:'1',notes:'',payment:''};
/** The form of a request being edited: its specifications and its payment ('' for one asked for before 2026-11-03: to be chosen now). The
 *  quotation and PO numbers are not on the form any more (2026-11-05): a request that has some keeps them as stored. */
const asForm=(specs:MoldSpecs,payment:MoldPayment|null)=>({...Object.fromEntries(Object.entries(blank).map(([key])=>[key,specs[key as keyof MoldSpecs]===null||specs[key as keyof MoldSpecs]===undefined?'':String(specs[key as keyof MoldSpecs])])),payment:payment||''});

/** Whether an edit changes the customer (2026-11-09): another of the CRM's customers, or one linked or unlinked; for a customer not in the
 *  CRM, its name or ERP code (compared as stored: moldCustomerName, moldErpCode). A linked customer's ERP code is shown only, never part
 *  of what was signed. */
function customerChanges(editing:MoldRequestView,linkedId:string,name:string,code:string){
 if(editing.customerId||linkedId)return linkedId!==editing.customerId;
 return moldCustomerName(name).name!==editing.customerName||moldErpCode(code).erpCode!==(editing.customerErpCode||'');
}
/** Whether an edit changes what the customer signed (2026-11-04): the specifications (an older request's own design link stays as it is),
 *  the payment, the delivery address (2026-11-09, compared as stored: moldAddress), or the customer (customerChanges, 2026-11-09); the
 *  server decides the same way and asks for the signature when it finds a change. */
function editChanges(editing:MoldRequestView,specs:Record<string,unknown>,payment:string|null,address:string,customerChanged:boolean){
 const keys=['description','core','vibrators','model','halfBlock','moldWidth','gelbaSize','moldNo','quantity','notes'] as const;
 return keys.some(key=>(specs[key]??'')!==(editing.specs[key]??''))||payment!==editing.payment||address!==moldAddress(editing.customerAddress||'').address||customerChanged;
}

/** Ask for a mold (a customer the member can see, then the specifications), or change one that has certainly never reached production
 *  (once sent, its data is edited by the production manager only); either way with design files, which upload once the request is saved
 *  (`used`: the places the request's files already take). An edit the server refuses (it was sent meanwhile) keeps the form open with
 *  the reason, and onRefused takes the request as it now stands (no more edit). signs: the reader is a sales role (2026-11-04), so «حفظ
 *  وإرسال» opens «توقيع العميل» first (a new request, or an edit that changes what was signed), and the signature is sent with it; it
 *  takes one of the 10 design files' places, so the picker leaves room for it. quotePo: production's update of 2026-11-03 is known, so a
 *  new request needs at least one quotation or PO file (2026-11-05, every role; no number any more): refused on the device without one,
 *  and uploaded first once the request is saved (the server keeps the request until one arrives, then sends it and its files). Every new
 *  request needs at least one design file too (2026-11-08, every role; the customer's signature does not count), and so does the edit of
 *  a request asked for under that rule (designRequired) that has none yet: refused the same way, before the signing step. The delivery
 *  address (2026-11-09) sits under the customer: filled in from the customer's registered address when one is chosen (again when another
 *  is), from the request's own when editing; changed for this request only, required, up to 300 characters, and read by the customer
 *  before signing. The customer is typed (the owner, 2026-11-09): its name and ERP code, with the CRM's customers as suggestions
 *  (MoldCustomerFields). Choosing one, or typing an ERP code exactly one of them has, links the request to it (customerId; its address
 *  filled in, when none is typed yet); anything else is a customer not in the CRM, sent with the name and ERP code (both required then).
 *  The address is asked for always. The edit of a request never sent changes the customer the same way (a change of what was signed). */
function MoldRequestDialog({customers,editing,uploads,used={},quotePo=false,signs=false,onClose,onSaved,onRefused}:{customers:Row[];editing?:MoldRequestView;uploads:DesignUploadQueue;used?:Partial<Record<MoldFileCategory,number>>;quotePo?:boolean;signs?:boolean;onClose:()=>void;onSaved:(view:MoldRequestView|null)=>void;onRefused?:(view:MoldRequestView)=>void}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const [chosenId,setChosenId]=useState(editing?.customerId||''),[address,setAddress]=useState(editing?.customerAddress||''),[customerText,setCustomerText]=useState<MoldCustomerText>({name:editing?.customerName||'',code:editing?.customerErpCode||''}),[form,setForm]=useState<Record<string,string>>(editing?asForm(editing.specs,editing.payment):blank),[shown,setShown]=useState<Record<string,string>>({});
 // A refusal that carries the request as it now stands (it was sent meanwhile): counted, so the signing step gives way to the form, which
 // says why (2026-11-04).
 const refusals=useRef(0),refused=useCallback((view:MoldRequestView)=>{refusals.current++;onRefused?.(view);},[onRefused]);
 const action=useMoldAction(onSaved,onRefused?refused:undefined);
 // The quotation's and PO's files: offered once production's update of 2026-11-03 is known to be live; one at least for a new request.
 const asks=quotePo,needsFile=asks&&!editing;
 // A design file (2026-11-08): one at least for a new request, or for the edit of one asked for under that rule while none of its own
 // counts (deleted, refused, or the customer's signature do not); an older request keeps «(اختياري)».
 const designRequired=!editing||editing.designRequired,hasDesign=!!editing?.designFiles.some(file=>file.category==='design'&&file.source==='crm'&&!file.signature&&!['rejected','locked','deleting'].includes(file.state));
 const [designs,setDesigns]=useState<DesignChoice[]>([]),[quotes,setQuotes]=useState<DesignChoice[]>([]),[pos,setPos]=useState<DesignChoice[]>([]),[asking,setAsking]=useState(false);
 // The signing step (2026-11-04): the request as it will be sent, and what the customer reads before signing it.
 const [signing,setSigning]=useState<{body:Record<string,unknown>;summary:[string,React.ReactNode][];again:boolean}|null>(null);
 // A place of the 10 design files is the signature's, unless the request being edited holds one already (the new one replaces it).
 const signatureRoom=signs&&!editing?.signature?1:0;
 // The quotation's and PO's files upload first: the first one releases the request kept for it (2026-11-05), so it reaches production
 // without waiting for the design files.
 const files=asks?[...quotes,...pos,...designs]:designs,ready=files.filter(choice=>!choice.refusal);
 // The customer the request is linked to: the one chosen (or, editing, the request's own, which the page may not list), else the one the
 // ERP code names alone; none: a customer not in the CRM.
 const kept=useMemo<Row|null>(()=>editing?.customerId&&editing.crmNumber!==null?{id:editing.customerId,kind:'customer',parentId:null,assignedTo:'',branch:'',data:{name:editing.customerName,internalCode:'YR-C-'+String(editing.crmNumber).padStart(6,'0'),code:editing.customerErpCode},createdAt:'',updatedAt:'',version:0} as unknown as Row:null,[editing]);
 const chosen=chosenId?customers.find(row=>row.id===chosenId)||(kept?.id===chosenId?kept:null):null;
 const linked=chosen||moldCustomerByErpCode(customers,customerText.code),linkedId=linked?.id||'';
 // Linked by its ERP code alone: its registered address fills an address not typed yet.
 const lastLinked=useRef(linkedId);
 useEffect(()=>{if(linkedId&&linkedId!==lastLinked.current&&linked&&!address.trim()&&linked.data.address){setAddress(String(linked.data.address));}lastLinked.current=linkedId;},[linkedId,linked,address]);
 // The customer's suggestions are showing (2026-11-09): Esc closes them, not the dialog.
 const suggesting=useRef(false),onSuggesting=useCallback((open:boolean)=>{suggesting.current=open;},[]);
 const clear=(key:string)=>setShown(previous=>{if(!(key in previous))return previous;const next={...previous};delete next[key];return next;});
 const set=(key:string,value:string)=>{setForm(previous=>({...previous,[key]:value}));clear(key);};
 const errors={...shown,...action.fields};
 const submit=(event:React.FormEvent)=>{
  event.preventDefault();
  // How the customer pays is required (2026-11-03): cash or deferred.
  // A new request needs a quotation or PO file once production's update is live (2026-11-05): one chosen that will upload.
  // No design link is sent: the server keeps an older request's own as it is; no number either (an edited request keeps its own).
  const checked=validateMoldSpecs(form),payment=moldPayment(form.payment),place=moldAddress(address),typedName=moldCustomerName(customerText.name),typedCode=moldErpCode(customerText.code);
  const errors:Record<string,string>={...checked.errors,...(payment?{}:{payment:say('اختار طريقة الدفع: نقدي أو آجل','Choose how the customer pays: cash or deferred')}),
   ...(needsFile&&![...quotes,...pos].some(choice=>!choice.refusal)?{quoteFile:say(...MOLD_QUOTE_FILE_REQUIRED_TEXT)}:{}),
   ...(designRequired&&!hasDesign&&!designs.some(choice=>!choice.refusal)?{designFile:say(...MOLD_DESIGN_FILE_REQUIRED_TEXT)}:{}),
   // The delivery address (2026-11-09): required, up to 300 characters as the server counts.
   ...(place.error?{address:say(...MOLD_ADDRESS_TEXT[place.error])}:{}),
   // The customer (2026-11-09): a linked one needs nothing more (its ERP code, if typed, up to 50 characters); one not in the CRM its
   // name and ERP code, as the server counts them.
   ...(!linked&&typedName.error?{'customer.name':say(...MOLD_CUSTOMER_TEXT[typedName.error==='required'?'nameRequired':'nameLong'])}:{}),
   ...(typedCode.error==='long'||!linked&&typedCode.error?{'customer.erpCode':say(...MOLD_CUSTOMER_TEXT[typedCode.error==='required'?'erpRequired':'erpLong'])}:{})};
  if(Object.keys(errors).length){setShown(errors);return;}
  setShown({});
  // On a request production holds, attaching a design file undoes the approvals: said first, then confirmed with the same button (not
  // for a quotation's or PO's file, which no longer does, 2026-11-05).
  if(editing&&ready.some(choice=>designNeedsWarning(editing,choice.category))&&!asking){setAsking(true);return;}
  setAsking(false);
  // The files go once the request is saved (each with its own requestId, kept for retries), the request's own change first.
  const specs={...checked.specs};delete specs.designUrl;
  // The customer: the linked one by its id (with the ERP code typed, if any), or the name and ERP code of one not in the CRM.
  const customer={...(linkedId?{customerId:linkedId}:{}),customer:{name:typedName.name,erpCode:typedCode.erpCode}};
  const body=editing?{action:'update',id:editing.id,version:editing.version,...customer,specs,payment,address:place.address}:{action:'create',...customer,specs,payment,address:place.address};
  // What the customer reads before signing: the customer, the mold and how they pay: the request's data the signature covers (its files
  // may change later without a new signature, so they are not part of it; no number since 2026-11-05).
  const choose=(names:Record<string,string>,value:string)=>say(names[value]||value,value);
  // The customer as it goes (2026-11-09): the linked one's registered name, or the name typed; its ERP code when there is one.
  const summary:[string,React.ReactNode][]=[[say('العميل','Customer'),<span dir="auto" key="c">{linked?String(linked.data.name||''):typedName.name}</span>],
   ...(typedCode.erpCode?[[say('كود ERP','ERP code'),<bdi dir="ltr" key="e">{typedCode.erpCode}</bdi>] as [string,React.ReactNode]]:[]),
   ...(!linked?[[say('كود يورست','Yourrest code'),say(...MOLD_CUSTOMER_TEXT.notInCrm)] as [string,React.ReactNode]]:[]),
   [say('العنوان','Address'),<span dir="auto" key="a">{place.address}</span>],[say('الوصف','Description'),<span dir="auto" key="d">{String(specs.description||'')}</span>],
   [say('الكمية','Quantity'),String(specs.quantity??'')],[say('العلب','Core'),choose(MOLD_CORES,String(specs.core||''))],[say('الموديل','Model'),choose(MOLD_MODELS,String(specs.model||''))],
   ...(payment?[[say('الدفع','Payment'),say(...moldPaymentNames[payment as MoldPayment])] as [string,React.ReactNode]]:[])];
  // A sales role's new request, or an edit that changes what was signed, is signed by the customer first (2026-11-04).
  if(signs&&(!editing||editChanges(editing,specs,payment,place.address,customerChanges(editing,linkedId,customerText.name,customerText.code)))){setSigning({body,summary,again:!!editing?.signature});return;}
  send(body,summary,false);
 };
 /** The request saved (then its files go); a refusal that asks for the signature opens the signing step, and one of the form's own fields
  *  goes back to the form, where each is said. */
 const send=(body:Record<string,unknown>,summary:[string,React.ReactNode][],signed:boolean)=>{const before=refusals.current;void action.run(body).then(next=>{
  if(next){if(ready.length)uploads.add(next.id,ready);return;}
  const named=Object.keys(action.lastFields.current);
  if(!signed&&named.includes('signature'))setSigning({body,summary,again:!!editing?.signature});
  else if(signed&&(refusals.current!==before||named.some(key=>key!=='signature'&&key!=='signer')))setSigning(null);
 });};
 const choice=(key:string,label:string,options:[string,string][])=><fieldset className="mold-choice" aria-invalid={!!errors[key]}><legend>{label}</legend><div>{options.map(([value,text])=><label key={value} data-active={form[key]===value}><input type="radio" name={key} value={value} checked={form[key]===value} onChange={()=>set(key,value)}/>{text}</label>)}</div>{errors[key]&&<small className="field-error">{errors[key]}</small>}</fieldset>;
 const number=(key:string,label:string,usual:number[]=[])=><label className="mold-field" aria-invalid={!!errors[key]}>{label}<input inputMode="numeric" dir="ltr" value={form[key]} onChange={event=>set(key,event.target.value.replace(/[^\d٠-٩]/g,'').replace(/[٠-٩]/g,digit=>String(digit.charCodeAt(0)-0x660)))}/>{!!usual.length&&<span className="mold-usual">{usual.map(value=><button type="button" key={value} className="btn small subtle" onClick={()=>set(key,String(value))}>{value}</button>)}</span>}{errors[key]&&<small className="field-error">{errors[key]}</small>}</label>;
 // Dimensions and the mold number are typed (a code); the notes are free text and take dictation.
 const text=(key:string,label:string,max:number)=><label className="mold-field" aria-invalid={!!errors[key]}>{label}<input type="text" maxLength={max} dir="ltr" value={form[key]} onChange={event=>set(key,event.target.value)}/>{errors[key]&&<small className="field-error">{errors[key]}</small>}</label>;
 const picker=(category:MoldFileCategory,choices:DesignChoice[],change:(next:DesignChoice[])=>void)=>{
  const reserved=category==='design'?signatureRoom:0;
  // Choosing a file of a required kind clears its «one at least» refusal.
  const required=category==='design'&&designRequired;
  return <MoldDesignPicker key={category} category={category} choices={choices} onChange={next=>{change(next);setAsking(false);clear(category==='design'?'designFile':'quoteFile');}} room={MOLD_CATEGORY_MAX_FILES[category]-(used[category]||0)-reserved} disabled={action.busy} say={say}
   {...(reserved?{overflow:'signature_room',note:say(...MOLD_SIGNATURE_TEXT.room)}:{})}{...(required?{title:say(...MOLD_DESIGN_FILE_PICKER_TITLE),error:errors.designFile||''}:{})}/>;
 };
 return <Dialog open onOpenChange={open=>{if(!open&&!action.busy)onClose();}}>
  <DialogContent className="mold-dialog" dir={direction()} onEscapeKeyDown={event=>{if(suggesting.current)event.preventDefault();}}>
   <DialogTitle>{editing?say('تعديل طلب تصنيع القالب','Edit mold request'):say('طلب تصنيع قالب','Request a mold')}</DialogTitle>
   <DialogDescription>{editing?say('الطلب لم يصل للإنتاج بعد، فتعديله هنا ممكن. بعد وصوله يعدّل بياناته مدير الإنتاج فقط.','The request has not reached production yet, so it can be changed here. Once it arrives, the production manager alone edits its data.'):say('يُحفظ الطلب في الـCRM ثم يُرسل لتطبيق الإنتاج تلقائيًا.','The request is saved in the CRM, then sent to production automatically.')}</DialogDescription>
   {signing&&<MoldSigningStep summary={signing.summary} busy={action.busy} error={action.error} fields={action.fields} again={signing.again} say={say} onBack={()=>setSigning(null)} onConfirm={signature=>send({...signing.body,signature},signing.summary,true)}/>}
   <form className="mold-form" onSubmit={submit} noValidate hidden={!!signing}>
    {/* The customer as typed, name and ERP code, with the CRM's customers as suggestions (the owner, 2026-11-09: «اسم العميل بيتكتب نص
        وبيجى ترشيحات من النظام»); a customer not in the CRM never blocks the request. Editable on the edit of a request never sent too. */}
    <MoldCustomerFields customers={customers} chosenId={chosen?chosenId:''} linked={linked} text={customerText} onOpenChange={onSuggesting} say={say}
     errors={{name:errors['customer.name']&&t(errors['customer.name']),code:errors['customer.erpCode']&&t(errors['customer.erpCode']),customer:errors.customer&&t(errors.customer)}}
     onText={next=>{setCustomerText(next);clear('customer');clear('customer.name');clear('customer.erpCode');}}
     onChoose={row=>{if(!row){setChosenId('');return;}setChosenId(row.id);setAddress(String(row.data.address||''));clear('address');}}/>
    {/* The delivery address (2026-11-09), asked for always: filled in from the linked customer's registered address, typed for another. */}
    <div className="mold-address" aria-invalid={!!errors.address}>
     <VoiceField label={say('العنوان','Address')} value={address} onChange={value=>{setAddress(value);clear('address');}} multiline rows={2} contextKey={'mold-address:'+(editing?.id||'new')} inputProps={{dir:'auto',autoComplete:'street-address','aria-invalid':!!errors.address||undefined}}/>
     {errors.address&&<small className="field-error">{t(errors.address)}</small>}</div>
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
    {/* The quotation's or PO's file (2026-11-05): one at least for a new request, a PDF or an image; the numbers are gone. */}
    {asks&&<fieldset className="mold-quote-files" aria-invalid={!!errors.quoteFile} data-required={needsFile||undefined}><legend>{needsFile?say('عرض السعر أو الـ PO (ملف واحد على الأقل)','Quotation or PO (at least one file)'):say('عرض السعر والـ PO','Quotation and PO')}</legend>
     {picker('quote',quotes,setQuotes)}
     {picker('po',pos,setPos)}
     {errors.quoteFile&&<small className="field-error" role="alert">{errors.quoteFile}</small>}
    </fieldset>}
    {picker('design',designs,setDesigns)}
    {asking&&!!ready.length&&<div className="mold-design-confirm" role="group" ref={revealCentered} aria-label={say('تأكيد إرفاق الملفات','Confirm attaching the files')}><p><TriangleAlert size={16} aria-hidden="true"/>{designWarningText(say)}</p></div>}
    {action.error&&!signing&&<p className="form-error" role="alert">{t(action.error)}</p>}
    <div className="mold-actions"><button type="submit" className="btn primary" disabled={action.busy}>{action.busy?<Loader2 className="spin" size={16}/>:asking?<Paperclip size={16}/>:<Send size={16}/>}{asking?say('تأكيد: حفظ وإرفاق الملفات','Confirm: save and attach the files'):editing?say('حفظ وإرسال التعديل','Save and send the change'):say('حفظ وإرسال للإنتاج','Save and send to production')}</button>{asking&&<button type="button" className="btn subtle" onClick={()=>setAsking(false)} disabled={action.busy}>{say('رجوع','Back')}</button>}<button type="button" className="btn subtle" onClick={onClose} disabled={action.busy}>{say('إلغاء','Cancel')}</button></div>
   </form>
  </DialogContent>
 </Dialog>;
}
