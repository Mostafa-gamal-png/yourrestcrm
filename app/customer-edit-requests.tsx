'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {AlertCircle,Check,FilePenLine,Loader2,Undo2,X} from 'lucide-react';
import {toast} from 'sonner';
import {t,useLanguage} from '@/lib/i18n';
import {submitJson} from '@/lib/client-submit';
import VoiceField from './voice-field';
import {CUSTOMER_EDITS_CHANGED,CUSTOMER_EDITS_FOCUS_MS,CUSTOMER_EDITS_INTERVAL_MS,CUSTOMER_EDIT_FIELD_TEXT,CUSTOMER_EDIT_WORD_FIELDS,REJECT_REASON_MAX,customerEditStatusText,rejectReason,validCustomerEditList,type CustomerEditChange,type CustomerEditList,type CustomerEditRequest} from '@/lib/customer-edit-requests';
import './customer-edit-requests.css';

/** «طلبات تعديل بيانات العميل» (lib/customer-edit-requests.ts, GET /api/customer-edits, POST /api/crm {action:'customer-edit'}). On the
 * first screen (app/team-home.tsx): what the reader may decide now (a supervisor their representatives' requests, the sales manager and the
 * administrator what has passed the supervisor) and their own requests with their answers; in the customer's details: that customer's
 * requests. Each shows who sent it and when, where it waits, every changed field before and after, the reason of a rejection; «موافقة»,
 * «رفض» with its reason, or «إلغاء الطلب» for its sender. Asked when shown, every 5 minutes on the first screen, when the page comes back
 * (at most once a minute) and after a send or a decision; never offline, and a failed check keeps what was shown. */

/** A request was sent or decided: every list on the page asks again. */
export const announceCustomerEdits=()=>{if(typeof window!=='undefined')window.dispatchEvent(new Event(CUSTOMER_EDITS_CHANGED));};
const selectText=(language:string,ar:string,en:string)=>language==='en'?en:ar;
const stampFormats=new Map<string,Intl.DateTimeFormat>();
function stamp(value:string|null|undefined,language:string){
 if(!value||!Number.isFinite(Date.parse(value)))return '—';
 const locale=language==='en'?'en-GB':'ar-SA';
 let format=stampFormats.get(locale);
 if(!format){format=new Intl.DateTimeFormat(locale,{calendar:'gregory',numberingSystem:'latn',timeZone:'Asia/Riyadh',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});stampFormats.set(locale,format);}
 return format.format(new Date(value));
}
function errorText(error:unknown,fallback:string){return error instanceof Error&&error.message?t(error.message):fallback;}

function useCustomerEdits(customerId:string|null,offline:boolean,poll:boolean){
 const [data,setData]=useState<CustomerEditList|null>(null);
 const last=useRef(0),pending=useRef(false),offlineNow=useRef(offline);
 useEffect(()=>{offlineNow.current=offline;},[offline]);
 const load=useCallback(async(force=false)=>{
  if(pending.current||offlineNow.current||!force&&Date.now()-last.current<CUSTOMER_EDITS_FOCUS_MS)return;
  pending.current=true;last.current=Date.now();
  try{const response=await fetch('/api/customer-edits'+(customerId?'?customerId='+encodeURIComponent(customerId):''),{cache:'no-store',credentials:'same-origin'});if(response.ok){const body:unknown=await response.json();if(validCustomerEditList(body))setData(body);}}
  catch{/* offline or unreachable: the next check retries */}
  finally{pending.current=false;}
 },[customerId]);
 useEffect(()=>{
  const first=setTimeout(()=>{void load(true);},0),changed=()=>{void load(true);},again=()=>{if(document.visibilityState!=='hidden')void load();};
  const timer=poll?setInterval(()=>{if(document.visibilityState!=='hidden')void load(true);},CUSTOMER_EDITS_INTERVAL_MS):undefined;
  window.addEventListener(CUSTOMER_EDITS_CHANGED,changed);document.addEventListener('visibilitychange',again);window.addEventListener('focus',again);window.addEventListener('online',again);
  return()=>{clearTimeout(first);if(timer)clearInterval(timer);window.removeEventListener(CUSTOMER_EDITS_CHANGED,changed);document.removeEventListener('visibilitychange',again);window.removeEventListener('focus',again);window.removeEventListener('online',again);};
 },[load,poll]);
 return data;
}

function ChangeValue({change,side}:{change:CustomerEditChange;side:'before'|'after'}){
 const value=change[side];
 if(!value)return <span className="cer-empty">—</span>;
 return <bdi dir={change.field==='location'||change.field==='shortAddress'?'ltr':'auto'}>{CUSTOMER_EDIT_WORD_FIELDS.has(change.field)?t(value):value}</bdi>;
}

function RequestItem({request,showCustomer,offline,onOpenCustomer,onChanged}:{request:CustomerEditRequest;showCustomer:boolean;offline:boolean;onOpenCustomer?:(customerId:string)=>void;onChanged?:()=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[rejecting,setRejecting]=useState(false),[note,setNote]=useState('');
 const [statusAr,statusEn]=customerEditStatusText(request),decides=request.canDecide,reason=rejectReason(note);
 const send=async(decision:'approve'|'reject'|'cancel')=>{
  if(busy)return;
  if(offline){setError(say('لا يوجد اتصال. أعد المحاولة عند عودة الاتصال.','You are offline. Try again once you are back online.'));return;}
  if(decision==='reject'&&!reason.ok){setError(t(reason.error));return;}
  setBusy(decision);setError('');
  try{
   const answer=await submitJson<{ok:true;status?:string;stage?:string}>('/api/crm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'customer-edit',decision,id:request.id,...(decision==='reject'?{note:reason.ok?reason.note:''}:{})})},{language,timeout:25000});
   toast.success(decision==='cancel'?say('أُلغي طلب التعديل','The edit request was cancelled'):decision==='reject'?say('رُفض طلب التعديل','The edit request was rejected'):answer.status==='approved'?say('تمت الموافقة وطُبّق التعديل على العميل','Approved: the edit now applies to the customer'):say('تمت موافقتك، وأُرسل الطلب إلى مدير المبيعات','Approved: the request now goes to the sales manager'));
   setRejecting(false);setNote('');announceCustomerEdits();onChanged?.();
  }catch(e){setError(errorText(e,say('تعذر الحفظ. حاول مرة أخرى.','Could not save. Try again.')));}
  finally{setBusy('');}
 };
 const tone=request.status==='pending'?'waiting':request.status;
 return <li className="cer-item" data-customer-edit={request.status} data-customer-edit-stage={request.stage||undefined} data-customer-edit-id={request.id}>
  <div className="cer-item-head">
   {showCustomer?(onOpenCustomer?<button type="button" className="cer-customer" onClick={()=>onOpenCustomer(request.customerId)}><bdi>{request.customerName}</bdi></button>:<strong className="cer-customer-name"><bdi>{request.customerName}</bdi></strong>):<strong className="cer-customer-name">{say('طلب تعديل','Edit request')}</strong>}
   <span className={'cer-status cer-status-'+tone} data-customer-edit-status>{say(statusAr,statusEn)}</span>
  </div>
  <p className="cer-meta">{request.mine?say('طلبك','Your request'):<>{say('أرسله','Sent by')} <bdi>{request.requestedByName}</bdi></>} · <time dateTime={request.createdAt} dir="auto">{stamp(request.createdAt,language)}</time></p>
  {request.supervisorName&&<p className="cer-meta" data-customer-edit-supervisor>{say('وافق المشرف','Approved by the supervisor')}: <bdi>{request.supervisorName}</bdi></p>}
  {request.changes.length>0&&<dl className="cer-changes">{request.changes.map(change=>{const [ar,en]=CUSTOMER_EDIT_FIELD_TEXT[change.field]||[change.field,change.field];return <div key={change.field} data-customer-edit-field={change.field}>
   <dt>{say(ar,en)}</dt>
   <dd><span className="cer-before"><span className="cer-side">{say('الحالي','Current')}</span><ChangeValue change={change} side="before"/></span><span className="cer-after"><span className="cer-side">{say('المطلوب','Requested')}</span><ChangeValue change={change} side="after"/></span></dd>
  </div>;})}</dl>}
  {request.stale&&<p className="cer-alert" role="status" data-customer-edit-stale><AlertCircle size={15} aria-hidden/>{decides?say('تغيرت البيانات نفسها بعد إرسال الطلب، فلا يمكن اعتماده. ارفضه ليعيد صاحبه إرساله على البيانات الحالية.','The same details changed after the request was sent, so it cannot be approved. Reject it so its sender can resend it on the current details.'):say('تغيرت البيانات نفسها بعد إرسال الطلب. ألغِه وأرسله من جديد على البيانات الحالية.','The same details changed after the request was sent. Cancel it and send it again on the current details.')}</p>}
  {request.status==='rejected'&&<p className="cer-reason" data-customer-edit-reason><strong>{say('سبب الرفض','Reason for rejection')}{request.decidedByName?<> (<bdi>{request.decidedByName}</bdi>)</>:''}:</strong> <bdi dir="auto">{request.note}</bdi></p>}
  {request.status!=='pending'&&request.status!=='rejected'&&request.decidedByName&&<p className="cer-meta">{request.status==='approved'?say('وافق','Approved by'):say('ألغاه','Cancelled by')} <bdi>{request.decidedByName}</bdi> · <time dateTime={request.decidedAt||''} dir="auto">{stamp(request.decidedAt,language)}</time></p>}
  {error&&<p className="cer-alert" role="alert"><AlertCircle size={15} aria-hidden/>{error}</p>}
  {decides&&(rejecting?<div className="cer-reject">
   <VoiceField label={say('سبب الرفض','Reason for rejection')} marked multiline rows={2} value={note} onChange={setNote} disabled={!!busy} contextKey={'customer-edit:'+request.id} inputProps={{maxLength:REJECT_REASON_MAX,placeholder:say('اكتب سبب الرفض ليقرأه صاحب الطلب','Write the reason the sender will read'),'aria-label':say('سبب الرفض','Reason for rejection')}}/>
   <div className="cer-actions"><button type="button" className="btn primary small" disabled={!!busy||!reason.ok} onClick={()=>{void send('reject');}} data-customer-edit-confirm-reject>{busy==='reject'?<Loader2 size={15} className="spin" aria-hidden/>:<X size={15} aria-hidden/>}{say('تأكيد الرفض','Confirm rejection')}</button><button type="button" className="btn subtle small" disabled={!!busy} onClick={()=>{setRejecting(false);setError('');}}>{say('رجوع','Back')}</button></div>
  </div>:<div className="cer-actions">
   <button type="button" className="btn primary small" disabled={!!busy||request.stale} onClick={()=>{void send('approve');}} data-customer-edit-approve>{busy==='approve'?<Loader2 size={15} className="spin" aria-hidden/>:<Check size={15} aria-hidden/>}{say('موافقة','Approve')}</button>
   <button type="button" className="btn subtle small" disabled={!!busy} onClick={()=>{setRejecting(true);setError('');}} data-customer-edit-reject>{say('رفض','Reject')}</button>
  </div>)}
  {request.canCancel&&!decides&&<div className="cer-actions"><button type="button" className="btn subtle small" disabled={!!busy} onClick={()=>{void send('cancel');}} data-customer-edit-cancel>{busy==='cancel'?<Loader2 size={15} className="spin" aria-hidden/>:<Undo2 size={15} aria-hidden/>}{say('إلغاء الطلب','Cancel request')}</button></div>}
 </li>;
}

/** The first screen's card: nothing shows while there is nothing to decide and no request of the reader's own. */
export function CustomerEditInbox({offline=false,onOpenCustomer,onChanged}:{offline?:boolean;onOpenCustomer?:(customerId:string)=>void;onChanged?:()=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 const data=useCustomerEdits(null,offline,true);
 if(!data?.requests.length)return null;
 const title=say('طلبات تعديل بيانات العملاء','Customer detail edit requests');
 return <section className="cer-card no-print" aria-label={title} data-customer-edit-inbox>
  <header><h2><FilePenLine size={19} aria-hidden/>{title}{data.waiting>0&&<span className="cer-count" data-customer-edit-waiting title={say('بانتظار قرارك','Awaiting your decision')}>{data.waiting}</span>}</h2></header>
  {data.waiting>0&&<p className="cer-hint">{say('طلبات تنتظر قرارك: وافق عليها أو ارفضها بسبب يقرؤه صاحبها.','Requests awaiting your decision: approve them, or reject them with a reason their sender will read.')}</p>}
  <ol>{data.requests.map(request=><RequestItem key={request.id+':'+request.status+':'+(request.stage||'')} request={request} showCustomer offline={offline} onOpenCustomer={onOpenCustomer} onChanged={onChanged}/>)}</ol>
 </section>;
}

/** In the customer's details: that customer's requests the reader may read; nothing shows when there is none. */
export function CustomerEditHistory({customerId,offline=false,onChanged}:{customerId:string;offline?:boolean;onChanged?:()=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 const data=useCustomerEdits(customerId,offline,false);
 if(!data?.requests.length)return null;
 const title=say('طلبات تعديل بيانات العميل','Edit requests on this customer');
 return <section className="cer-card cer-card-customer" aria-label={title} data-customer-edit-history>
  <header><h3><FilePenLine size={17} aria-hidden/>{title}</h3></header>
  <ol>{data.requests.map(request=><RequestItem key={request.id+':'+request.status+':'+(request.stage||'')} request={request} showCustomer={false} offline={offline} onChanged={onChanged}/>)}</ol>
 </section>;
}
