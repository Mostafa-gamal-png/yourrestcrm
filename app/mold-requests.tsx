'use client';
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Factory,Loader2,Lock,RefreshCw,Search,Send,TriangleAlert,Wrench} from 'lucide-react';
import {Sheet,SheetContent,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {useLanguage,direction,getLanguage} from '@/lib/i18n';
import {definiteSubmitRejection,submitJson,SubmitError} from '@/lib/client-submit';
import type {Member,Row} from '@/lib/crm';
import {MOLD_STAGES,MOLD_STAGE_NAMES,MOLD_CORES,MOLD_MODELS,MOLD_HALF_BLOCKS,moldErrorText,moldFieldNames,moldSendingNames,moldStatusNames,yourrestNumber,type MoldRequestView,type MoldRequestsAnswer,type MoldSpecs} from '@/lib/mold-requests';
import {MOLD_LIMITS,MOLD_USUAL,validateMoldSpecs} from '@/portable/mold-rules.mjs';
import './mold-requests.css';

type Say=(ar:string,en:string)=>string;
const messageOf=(error:unknown)=>typeof error==='object'&&error!==null&&'message' in error&&typeof (error as {message:unknown}).message==='string'?(error as {message:string}).message:'';
const stamp=(iso:string|null|undefined)=>iso?new Date(iso).toLocaleString('en-GB',{timeZone:'Asia/Riyadh',dateStyle:'short',timeStyle:'short'}):'—';
const day=(value:string|null|undefined)=>value?value.slice(0,10):'—';
const statusText=(view:MoldRequestView,say:Say)=>view.remote?say(...moldStatusNames[view.remote.status]):view.cancelled?say('ملغى','Cancelled'):say('لم يصل للإنتاج بعد','Not in production yet');

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
  return <li key={key} data-done={done} aria-current={!done&&MOLD_STAGES.slice(0,index).every(prior=>stages?.[prior]?.done)&&!!view.remote&&!view.remote.delivered?'step':undefined}>
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
    :sending.state==='rejected'?say('رفض الإنتاج: ','Production refused: ')+((sending.error?.fields||[]).map(field=>say(...(moldFieldNames[field]||[field,field]))).join('، ')||moldErrorText(sending.error?.code||'',say))+'. '+say('عدّل الطلب أو أعد إرساله.','Edit the request or resend it.')
    :what+' '+say('محفوظ في الـCRM ولم يصل للإنتاج بعد','is saved in the CRM and has not reached production yet')+(sending.error?': '+moldErrorText(sending.error.code,say):'')+'.'}</p>
   {linkReady&&sending.state==='waiting'&&<small>{sending.nextAttemptAt?say('المحاولة التالية تلقائيًا: ','Next automatic try: ')+stamp(sending.nextAttemptAt):say('توقفت المحاولات التلقائية بعد 24 ساعة؛ استخدم «إعادة الإرسال».','Automatic tries stopped after 24 hours; use Resend.')}{sending.attempts?' · '+say('محاولات: ','Tries: ')+sending.attempts:''}</small>}
  </div>
 </div>;
}

function MoldCard({view,linkReady,onOpen,say}:{view:MoldRequestView;linkReady:boolean;onOpen:()=>void;say:Say}){
 const remote=view.remote;
 return <button type="button" className="mold-card" data-status={remote?.status||(view.cancelled?'cancelled':'local')} data-sending={view.sending.state} onClick={onOpen}>
  <header><strong>{view.customerName}</strong><span className="mold-chip" data-status={remote?.status||'local'}>{statusText(view,say)}</span></header>
  <p dir="auto">{view.specs.description}</p>
  <div className="mold-card-facts">
   <span>{say('رقم أمر الإنتاج','Production order')}: <b>{remote?.orderNo??'—'}</b></span>
   <span>{say('الكمية','Quantity')}: <b>{view.specs.quantity}</b></span>
   <span>{say('المراحل','Stages')}: <b>{remote?remote.stagesDone+'/'+remote.stagesTotal:'—'}</b></span>
   <span>{say('المندوب','Representative')}: {view.memberName}</span>
  </div>
  {view.sending.state!=='sent'&&<small className="mold-card-sending" data-state={view.sending.state}>{say(...moldSendingNames[linkReady?view.sending.state:'off'])}</small>}
 </button>;
}

/** The page: the requests the reader may see, the representative's button to ask for a mold, the link's state. */
export function MoldRequestsPage({me,records}:{me:Member;records:Row[]}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const {data,error,loading,refresh}=useMoldRequests(me);
 const [openId,setOpenId]=useState<string|null>(null),[creating,setCreating]=useState(false),[query,setQuery]=useState('');
 const customers=useMemo(()=>records.filter(row=>row.kind==='customer'),[records]);
 const list=useMemo(()=>{const needle=query.trim().toLowerCase();return (data?.requests||[]).filter(view=>!needle||[view.customerName,view.specs.description,view.specs.moldNo,String(view.remote?.orderNo||''),view.memberName].some(text=>String(text||'').toLowerCase().includes(needle)));},[data,query]);
 const open=data?.requests.find(view=>view.id===openId)||null;
 const changed=useCallback(()=>{void refresh();},[refresh]);
 return <section className="mold-page" dir={direction()}>
  <div className="mold-heading"><div><p>{say('يصل الطلب لتطبيق الإنتاج تلقائيًا، وتظهر هنا مراحل التصنيع حتى التسليم.','Requests reach the production application automatically; production stages show here until delivery.')}</p></div>
   <div className="mold-heading-tools"><button type="button" className="btn subtle" onClick={()=>void refresh()} disabled={loading} aria-label={say('تحديث','Refresh')}>{loading?<Loader2 className="spin" size={16}/>:<RefreshCw size={16}/>}</button>
    {data?.canCreate&&<button type="button" className="btn primary mold-new" onClick={()=>setCreating(true)}><Wrench size={16} aria-hidden="true"/>{say('طلب تصنيع قالب','Request a mold')}</button>}</div></div>
  {data&&!data.linkReady&&<p className="mold-banner" data-kind="off" role="status"><Lock size={16} aria-hidden="true"/>{say('الربط مع الإنتاج غير مفعَّل. الطلبات تُحفظ هنا وتنتظر الإرسال.','The production link is off. Requests are saved here and wait to be sent.')}</p>}
  {data?.statusError&&<p className="mold-banner" data-kind="stale" role="status"><TriangleAlert size={16} aria-hidden="true"/>{say('تعذّر تحديث المراحل الآن','Stages could not be refreshed now')}: {moldErrorText(data.statusError.code,say)}. {say('المعروض آخر حالة معروفة، ويتحدث عند الفتح التالي.','Showing the last known status; it refreshes next time.')}</p>}
  {error&&<p className="form-error" role="alert">{error}</p>}
  {!!data?.requests.length&&<label className="mold-search"><Search size={16} aria-hidden="true"/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={say('ابحث بالعميل أو الوصف أو رقم أمر الإنتاج','Search by customer, description or order')}/></label>}
  {data&&!list.length&&<p className="empty mold-empty">{data.requests.length?say('لا نتائج','No results'):say('لا توجد طلبات تصنيع قوالب بعد.','No mold requests yet.')}</p>}
  {!data&&!error&&<p className="empty"><Loader2 className="spin" size={16}/> {say('جارٍ التحميل…','Loading…')}</p>}
  <div className="mold-list">{list.map(view=><MoldCard key={view.id} view={view} linkReady={!!data?.linkReady} say={say} onOpen={()=>setOpenId(view.id)}/>)}</div>
  {open&&<MoldRequestSheet key={open.id+':'+open.version} view={open} linkReady={!!data?.linkReady} statusAt={open.remoteAt} customers={customers} onClose={()=>setOpenId(null)} onChanged={changed}/>}
  {creating&&<MoldRequestDialog customers={customers} onClose={()=>setCreating(false)} onSaved={view=>{setCreating(false);void refresh();if(view)setOpenId(view.id);}}/>}
 </section>;
}

/** One request: where production is, what was asked for, what waits to be sent, and the representative's actions while allowed. */
function MoldRequestSheet({view:initial,linkReady,statusAt,customers,onClose,onChanged}:{view:MoldRequestView;linkReady:boolean;statusAt:string|null;customers:Row[];onClose:()=>void;onChanged:()=>void}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const [view,setView]=useState(initial),[editing,setEditing]=useState(false),[cancelling,setCancelling]=useState(false),[reason,setReason]=useState(''),[pullError,setPullError]=useState<string>('');
 const done=useCallback((next:MoldRequestView|null)=>{if(next)setView(next);onChanged();},[onChanged]);
 const action=useMoldAction(done);
 // Opening one request pulls its status alone (§6: no retry; the last known status stays with its time).
 useEffect(()=>{let live=true;void submitJson<MoldRequestsAnswer>('/api/mold-requests?id='+encodeURIComponent(initial.id),{cache:'no-store'},{language:getLanguage()}).then(answer=>{if(!live)return;const fresh=answer.requests[0];if(fresh)setView(fresh);setPullError(answer.statusError?moldErrorText(answer.statusError.code,(ar,en)=>getLanguage()==='en'?en:ar):'');}).catch(()=>{});return()=>{live=false;};},[initial.id]);
 const remote=view.remote,specs=view.specs;
 const facts:[string,React.ReactNode][]=[
  [say('رقم أمر الإنتاج','Production order'),remote?.orderNo??'—'],[say('السريال','Serial'),remote?.moldSerial||'—'],[say('تاريخ الإنتاج','Production date'),day(remote?.productionDate)],
  [say('التسليم','Delivery'),remote?.delivered?say('سُلِّم','Delivered')+' · '+day(remote.deliveryDate):say('لم يُسلَّم','Not delivered')],[say('كود يورست','Yourrest code'),'YR-C-'+String(view.crmNumber).padStart(6,'0')],
  [say('تاريخ الطلب','Requested'),stamp(view.requestedAt)],[say('المندوب','Representative'),view.memberName],
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
   <MoldStages view={view} say={say}/>
   <p className="mold-updated">{say('آخر تحديث للحالة','Status last updated')}: {stamp(view.remoteAt||statusAt)}</p>
   <dl className="mold-facts">{facts.map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
   <h3 className="mold-subtitle">{say('المواصفات','Specifications')}</h3>
   <dl className="mold-facts">{asked.map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
   {!view.editable&&!view.cancelled&&view.can&&!view.can.edit&&remote&&<p className="mold-locked"><Lock size={14} aria-hidden="true"/>{say('بدأ الإنتاج؛ لم يعد التعديل أو الإلغاء ممكنًا.','Production has started; the request can no longer be changed or cancelled.')}</p>}
   {action.error&&<p className="form-error" role="alert">{action.error}</p>}
   <div className="mold-actions">
    {view.can.resend&&<button type="button" className="btn primary" disabled={action.busy||!linkReady} onClick={()=>void action.run({action:'resend',id:view.id})}>{action.busy?<Loader2 className="spin" size={16}/>:<Send size={16}/>}{say('إعادة الإرسال','Resend')}</button>}
    {view.can.edit&&<button type="button" className="btn subtle" disabled={action.busy} onClick={()=>setEditing(true)}>{say('تعديل الطلب','Edit request')}</button>}
    {view.can.cancel&&!cancelling&&<button type="button" className="btn danger-outline" disabled={action.busy} onClick={()=>setCancelling(true)}>{say('إلغاء الطلب','Cancel request')}</button>}
   </div>
   {cancelling&&<form className="mold-cancel" onSubmit={event=>{event.preventDefault();void action.run({action:'cancel',id:view.id,version:view.version,reason}).then(next=>{if(next)setCancelling(false);});}}>
    <label>{say('سبب الإلغاء (اختياري)','Reason (optional)')}<textarea maxLength={MOLD_LIMITS.cancelReason} value={reason} onChange={event=>setReason(event.target.value)}/></label>
    <div className="mold-actions"><button type="submit" className="btn danger" disabled={action.busy}>{say('تأكيد الإلغاء','Confirm cancellation')}</button><button type="button" className="btn subtle" onClick={()=>setCancelling(false)}>{say('رجوع','Back')}</button></div>
   </form>}
   {editing&&<MoldRequestDialog customers={customers} editing={view} onClose={()=>setEditing(false)} onSaved={next=>{setEditing(false);if(next)setView(next);onChanged();}}/>}
  </SheetContent>
 </Sheet>;
}

const blank:Record<string,string>={description:'',core:'',vibrators:'',model:'',halfBlock:'',moldWidth:'',gelbaSize:'',moldNo:'',quantity:'1',designUrl:'',notes:''};
const asForm=(specs:MoldSpecs)=>Object.fromEntries(Object.entries(blank).map(([key])=>[key,specs[key as keyof MoldSpecs]===null||specs[key as keyof MoldSpecs]===undefined?'':String(specs[key as keyof MoldSpecs])]));

/** Ask for a mold (a customer of the representative's, then the specifications), or change one while production has not started. */
function MoldRequestDialog({customers,editing,onClose,onSaved}:{customers:Row[];editing?:MoldRequestView;onClose:()=>void;onSaved:(view:MoldRequestView|null)=>void}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const [customerId,setCustomerId]=useState(editing?.customerId||''),[search,setSearch]=useState(''),[form,setForm]=useState<Record<string,string>>(editing?asForm(editing.specs):blank),[shown,setShown]=useState<Record<string,string>>({});
 const action=useMoldAction(onSaved);
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
  void action.run(editing?{action:'update',id:editing.id,version:editing.version,specs:checked.specs}:{action:'create',customerId,specs:checked.specs});
 };
 const choice=(key:string,label:string,options:[string,string][])=><fieldset className="mold-choice" aria-invalid={!!errors[key]}><legend>{label}</legend><div>{options.map(([value,text])=><label key={value} data-active={form[key]===value}><input type="radio" name={key} value={value} checked={form[key]===value} onChange={()=>set(key,value)}/>{text}</label>)}</div>{errors[key]&&<small className="field-error">{errors[key]}</small>}</fieldset>;
 const number=(key:string,label:string,usual:number[]=[])=><label className="mold-field" aria-invalid={!!errors[key]}>{label}<input inputMode="numeric" dir="ltr" value={form[key]} onChange={event=>set(key,event.target.value.replace(/[^\d٠-٩]/g,'').replace(/[٠-٩]/g,digit=>String(digit.charCodeAt(0)-0x660)))}/>{!!usual.length&&<span className="mold-usual">{usual.map(value=><button type="button" key={value} className="btn small subtle" onClick={()=>set(key,String(value))}>{value}</button>)}</span>}{errors[key]&&<small className="field-error">{errors[key]}</small>}</label>;
 const text=(key:string,label:string,max:number,area=false,ltr=false)=><label className="mold-field" aria-invalid={!!errors[key]}>{label}{area?<textarea maxLength={max} value={form[key]} onChange={event=>set(key,event.target.value)}/>:<input maxLength={max} dir={ltr?'ltr':'auto'} value={form[key]} onChange={event=>set(key,event.target.value)}/>}{errors[key]&&<small className="field-error">{errors[key]}</small>}</label>;
 return <Dialog open onOpenChange={open=>{if(!open&&!action.busy)onClose();}}>
  <DialogContent className="mold-dialog" dir={direction()}>
   <DialogTitle>{editing?say('تعديل طلب تصنيع القالب','Edit mold request'):say('طلب تصنيع قالب','Request a mold')}</DialogTitle>
   <DialogDescription>{say('يُحفظ الطلب في الـCRM ثم يُرسل لتطبيق الإنتاج تلقائيًا.','The request is saved in the CRM, then sent to production automatically.')}</DialogDescription>
   <form className="mold-form" onSubmit={submit} noValidate>
    {editing?<p className="mold-customer-chosen"><Factory size={16} aria-hidden="true"/>{editing.customerName}</p>:chosen?<div className="mold-customer-chosen"><span><Factory size={16} aria-hidden="true"/>{String(chosen.data.name||'')}<small>{String(chosen.data.internalCode||'')}{chosen.data.city?' · '+String(chosen.data.city):''}</small></span><button type="button" className="btn small subtle" onClick={()=>setCustomerId('')}>{say('تغيير','Change')}</button></div>
     :<div className="mold-customer-search" aria-invalid={!!errors.customer}><label>{say('العميل','Customer')}<span className="search"><Search size={16} aria-hidden="true"/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder={say('ابحث باسم العميل أو كوده أو مدينته','Search by name, code or city')}/></span></label>
      <div className="mold-customer-matches">{matches.map(row=><button type="button" key={row.id} disabled={!yourrestNumber(row.data.internalCode)} onClick={()=>{setCustomerId(row.id);clear('customer');}}><strong>{String(row.data.name||'')}</strong><small>{String(row.data.internalCode||'')}{row.data.city?' · '+String(row.data.city):''}</small></button>)}{!matches.length&&<p className="empty">{say('لا عملاء مطابقون','No matching customers')}</p>}</div>
      {errors.customer&&<small className="field-error">{errors.customer}</small>}</div>}
    {text('description',say('وصف القالب','Mold description'),MOLD_LIMITS.description,false,true)}
    <div className="mold-grid">
     {choice('core',say('العلب','Core'),Object.entries(MOLD_CORES).map(([value,ar])=>[value,say(ar,value)]))}
     {choice('vibrators',say('عدد الرجاجات','Vibrators'),[['2','2'],['3','3'],['4','4']])}
     {choice('model',say('الموديل','Model'),Object.entries(MOLD_MODELS).map(([value,ar])=>[value,say(ar,value)]))}
     {choice('halfBlock',say('بلوكة النص','Half block'),Object.entries(MOLD_HALF_BLOCKS).map(([value,ar])=>[value,say(ar,value)]))}
     {number('moldWidth',say('عرض القالب (مم، 1000–2000)','Mold width (mm, 1000–2000)'),MOLD_USUAL.moldWidth)}
     {number('gelbaSize',say('مقاس الجلب (500–1200)','Gelba size (500–1200)'),MOLD_USUAL.gelbaSize)}
     {text('moldNo',say('رقم القالب (اختياري)','Mold no. (optional)'),MOLD_LIMITS.moldNo,false,true)}
     {number('quantity',say('الكمية (1–100)','Quantity (1–100)'))}
    </div>
    {text('designUrl',say('رابط التصميم (اختياري، يبدأ بـ https://)','Design link (optional, https://)'),MOLD_LIMITS.designUrl,false,true)}
    {text('notes',say('ملاحظات (اختياري)','Notes (optional)'),MOLD_LIMITS.notes,true)}
    {action.error&&<p className="form-error" role="alert">{action.error}</p>}
    <div className="mold-actions"><button type="submit" className="btn primary" disabled={action.busy}>{action.busy?<Loader2 className="spin" size={16}/>:<Send size={16}/>}{editing?say('حفظ وإرسال التعديل','Save and send the change'):say('حفظ وإرسال للإنتاج','Save and send to production')}</button><button type="button" className="btn subtle" onClick={onClose} disabled={action.busy}>{say('إلغاء','Cancel')}</button></div>
   </form>
  </DialogContent>
 </Dialog>;
}
