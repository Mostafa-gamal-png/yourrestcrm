'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {AlertCircle,ArrowDown,ArrowUp,BellRing,CalendarCheck,CalendarDays,CheckCheck,ClipboardCheck,Clock,Loader2,MessageSquareText,Pencil,Plus,RefreshCw,Save,Search,Send,Trash2,Undo2,Users,X} from 'lucide-react';
import {toast} from 'sonner';
import {t,useLanguage} from '@/lib/i18n';
import {submitJson} from '@/lib/client-submit';
import {offlineSubmit} from '@/lib/offline-submit';
import {listOutbox,subscribeOffline,type OfflineJob} from '@/lib/offline-store';
import {can,pageAllowed} from '@/lib/permissions';
import {isNativeTrackingApp} from '@/lib/native-tracking';
import {isFieldRole} from '@/lib/roles';
import {memberCanAccessRegion} from '@/lib/regions';
import type {Member,Row} from '@/lib/crm';
import {ACTIVITY_TYPE_TEXT} from '@/lib/supervisor-reviews';
import {planTables} from '@/lib/list-export-plans';
import {ACTIVITY_PLACE_TEXT,PLAN_AHEAD_DAYS,PLAN_FRIDAY_DEADLINE_HOUR,PLAN_INBOX_FOCUS_MS,PLAN_INBOX_INTERVAL_MS,PLAN_LATE_TEXT,PLAN_MAX_STOPS,PLAN_NOTE_MAX,PLAN_NOTE_MIN,PLAN_REASON_MAX,PLAN_REASON_MIN,PLAN_STATE_TEXT,PLAN_STOP_NOTE_MAX,STOP_COMPLETION_TEXT,STOP_KINDS,STOP_KIND_TEXT,SUPERVISOR_STATE_TEXT,addDays,isPlanWorkingDay,lockedForMember,memberMayEdit,nextPlanDay,planDateProblem,planDeadline,planDeadlineHour,planDeadlineWords,planNoticeStep,planNoticeStorageKey,planReminderLines,rememberedPlanNotices,reviewsPlans,riyadhDayOf,validPlanExport,validPlanInbox,validPlanList,validPlanView,type PlanInbox,type PlanList,type PlanReminderLine,type PlanState,type PlanStopView,type PlanView,type StopKind,type SupervisorState} from '@/lib/daily-plans';
import {ExportExcelButton} from './export-excel-button';
import VoiceField from './voice-field';
import './daily-plans.css';

/** «خطة الغد» (a representative or a marketing officer) and «خطط المناديب» (a supervisor, a sales manager, the administrator), lib/daily-plans.ts.
 * The member prepares the next working day's plan (customers, each a visit, a call or a WhatsApp contact, in order, with an optional time and
 * note), keeps it on the device as they type (it works without a network: «إرسال» waits in the device's outbox and goes when the
 * connection is back, with the time it was pressed), and sends it. The reviewer reads their team's plans of a day, approves, approves with
 * edits, returns with a reason and writes one note on the member's day; on «تقرير يوم المندوب» the same card sits above the day's review.
 * Every page carries the reminder card (PlanInboxCard). The plan never stops the recording of a visit or a contact. */

const selectText=(language:string,ar:string,en:string)=>language==='en'?en:ar;
const pair=(words:readonly [string,string],language:string)=>language==='en'?words[1]:words[0];
const today=()=>riyadhDayOf(Date.now());
const dayFormats=new Map<string,Intl.DateTimeFormat>(),clockFormats=new Map<string,Intl.DateTimeFormat>();
function dayLabel(date:string,language:string){
 const at=Date.parse(date+'T12:00:00Z');if(!Number.isFinite(at))return date;
 const locale=language==='en'?'en-GB':'ar-SA';let format=dayFormats.get(locale);
 if(!format){format=new Intl.DateTimeFormat(locale,{calendar:'gregory',numberingSystem:'latn',timeZone:'UTC',weekday:'long',day:'numeric',month:'long'});dayFormats.set(locale,format);}
 return format.format(new Date(at));
}
/** A moment on Riyadh's wall clock («20 نوفمبر، 21:40»). hourCycle h23, not hour12:false: a browser that reads hour12:false as h24 for
 *  ar-SA would write Saturday's deadline (midnight) as «24:00» of the next day. */
function stamp(value:string|null|undefined,language:string){
 if(!value||!Number.isFinite(Date.parse(value)))return '—';
 const locale=language==='en'?'en-GB':'ar-SA';let format=clockFormats.get(locale);
 if(!format){format=new Intl.DateTimeFormat(locale,{calendar:'gregory',numberingSystem:'latn',timeZone:'Asia/Riyadh',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});clockFormats.set(locale,format);}
 return format.format(new Date(value));
}
/** «آخر موعد للإرسال» of the plan of `date`: the moment, and for Saturday's plan (due at midnight between Friday and Saturday, the owner
 *  2026-11-21) the words before it, so that «00:00» of Saturday is read as the end of Friday. One element (no nested span: the meta line
 *  lays its spans out as flex boxes). */
function DeadlineMoment({date,deadline,language}:{date:string;deadline:string;language:string}){
 const moment=stamp(deadline,language),friday=planDeadlineHour(date)===PLAN_FRIDAY_DEADLINE_HOUR;
 return <time dateTime={deadline} dir="auto" data-plan-deadline-words={friday?'':undefined}>{friday?pair(planDeadlineWords(date),language)+' ('+moment+')':moment}</time>;
}
const errorText=(error:unknown,fallback:string)=>error instanceof Error&&error.message?t(error.message):fallback;
/** This browser's storage, which a private window or a full disk may refuse. */
function stored(key:string):string|null{try{return localStorage.getItem(key);}catch{return null;}}
function store(key:string,value:string|null){try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}catch{/* not kept: the page still works */}}
/** Said after every write of this page, so the reminder card asks again at once. */
const PLANS_CHANGED='yourrest:daily-plans-changed';
const plansChanged=()=>{if(typeof window!=='undefined')window.dispatchEvent(new Event(PLANS_CHANGED));};
const draftKey=(memberId:string,date:string)=>'yourrest.daily-plan.draft:'+memberId+':'+date;
const cacheKey=(memberId:string,date:string)=>'yourrest.daily-plan.cache:'+memberId+':'+date;

export function PlanStateChip({state,late}:{state:PlanState;late?:boolean}){
 const {language}=useLanguage();
 return <span className="plan-chips"><span className={'plan-chip state-'+state} data-plan-state={state}>{pair(PLAN_STATE_TEXT[state],language)}</span>{late&&<span className="plan-chip late" data-plan-late>{pair(PLAN_LATE_TEXT,language)}</span>}</span>;
}

/** Loads one plan (GET /api/daily-plans?date=&memberId=). The member's own is kept on the device, so it shows without a network. */
function usePlanView(memberId:string,date:string,own:boolean){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 const [revision,setRevision]=useState(0),key=memberId+'|'+date+'|'+revision;
 const [state,setState]=useState<{key:string;plan:PlanView|null;error:string;cached:boolean}>({key:'',plan:null,error:'',cached:false});
 useEffect(()=>{
  const controller=new AbortController(),params=new URLSearchParams({date,memberId});
  void submitJson<PlanView>('/api/daily-plans?'+params,{cache:'no-store',signal:controller.signal},{language}).then(body=>{
   if(controller.signal.aborted)return;
   if(!validPlanView(body))throw new Error(say('تعذر تحميل الخطة.','Could not load the plan.'));
   if(own)store(cacheKey(memberId,date),JSON.stringify(body));
   setState({key,plan:body,error:'',cached:false});
  }).catch(error=>{
   if(controller.signal.aborted||error?.name==='AbortError')return;
   let cached:PlanView|null=null;
   if(own){try{const value:unknown=JSON.parse(stored(cacheKey(memberId,date))||'null');cached=validPlanView(value)?value:null;}catch{cached=null;}}
   setState({key,plan:cached,error:errorText(error,say('تعذر تحميل الخطة.','Could not load the plan.')),cached:!!cached});
  });
  return()=>controller.abort();
 // eslint-disable-next-line react-hooks/exhaustive-deps -- key names the member, the day and the revision; say follows language
 },[key,own,language]);
 // While a new answer is on its way, the last plan of the same member and day stays on screen.
 const same=state.key.slice(0,state.key.lastIndexOf('|'))===memberId+'|'+date;
 const current=state.key===key?{...state,loading:false}:{key,plan:same?state.plan:null,error:'',cached:false,loading:true};
 const setPlan=useCallback((plan:PlanView)=>{if(own)store(cacheKey(plan.memberId,plan.date),JSON.stringify(plan));plansChanged();setState({key:plan.memberId+'|'+plan.date+'|'+revision,plan,error:'',cached:false});},[own,revision]);
 return {...current,reload:()=>setRevision(value=>value+1),setPlan};
}

/** A POST of /api/daily-plans that keeps its request id while the same contents are sent again (a retry answers from the receipt). */
function usePlanPost(){
 const {language}=useLanguage(),last=useRef<{id:string;payload:string}|null>(null),[busy,setBusy]=useState('');
 const post=useCallback(async(label:string,body:Record<string,unknown>)=>{
  const payload=JSON.stringify(body);
  if(last.current?.payload!==payload)last.current={id:crypto.randomUUID(),payload};
  setBusy(label);
  try{
   const answer=await submitJson<{ok:true;plan:unknown}>('/api/daily-plans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,requestId:last.current.id})},{language});
   last.current=null;
   if(!validPlanView(answer.plan))throw new Error(selectText(language,'الخادم لم يؤكد الحفظ. أعد المحاولة.','The server did not confirm the save. Try again.'));
   return answer.plan;
  }finally{setBusy('');}
 },[language]);
 return {post,busy};
}

// ---- the customer picker of a stop
const normalize=(value:string)=>value.normalize('NFKD').replace(/[ً-ٰٟـ]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).toLowerCase().trim();
const customerText=(row:Row)=>normalize([row.data.name,row.data.internalCode,row.data.code,row.data.city,row.data.phone,row.data.phone2,row.data.contact].filter(Boolean).join(' '));
function CustomerPick({customers,value,name,disabled,onChange,label}:{customers:readonly Row[];value:string;name:string;disabled:boolean;onChange:(id:string)=>void;label:string}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 const [query,setQuery]=useState(''),[open,setOpen]=useState(!value);
 const index=useMemo(()=>customers.map(row=>({row,text:customerText(row)})),[customers]);
 const terms=normalize(query).split(/\s+/).filter(Boolean),matches=terms.length?index.filter(entry=>terms.every(term=>entry.text.includes(term))).slice(0,6).map(entry=>entry.row):[];
 if(value&&!open)return <div className="plan-customer-chosen"><strong data-plan-customer={value}>{name||say('عميل غير متاح','Customer not available')}</strong>{!disabled&&<button type="button" className="btn subtle small" onClick={()=>{setOpen(true);setQuery('');}}><Pencil size={14} aria-hidden/>{say('تغيير','Change')}</button>}</div>;
 return <div className="plan-customer-search">
  <label className="plan-field"><span>{label} <b aria-hidden="true">*</b></span><span className="plan-search-input"><Search size={16} aria-hidden/><input type="search" value={query} disabled={disabled} autoComplete="off" enterKeyHint="search" placeholder={say('اكتب اسم العميل أو رقمه أو جواله','Type the customer\'s name, code or mobile')} aria-label={label} onChange={event=>setQuery(event.target.value)}/></span></label>
  {terms.length>0&&<ul className="plan-customer-matches" role="listbox" aria-label={say('العملاء المطابقون','Matching customers')}>{matches.length?matches.map(row=><li key={row.id}><button type="button" role="option" aria-selected={row.id===value} data-plan-pick={row.id} onClick={()=>{onChange(row.id);setOpen(false);setQuery('');}}><strong>{row.data.name}</strong><small>{[row.data.internalCode,row.data.code&&'ERP: '+row.data.code,row.data.city].filter(Boolean).join(' · ')}</small></button></li>):<li className="plan-muted">{say('لا يوجد عميل مطابق في مناطقك.','No matching customer in your regions.')}</li>}</ul>}
  {value&&<button type="button" className="btn subtle small" onClick={()=>setOpen(false)}><X size={14} aria-hidden/>{say('إبقاء العميل المختار','Keep the chosen customer')}</button>}
 </div>;
}

// ---- the editor of the stops
type EditStop={key:string;id?:string;customerId:string;kind:StopKind;time:string;note:string;state:SupervisorState};
const fromView=(stops:readonly PlanStopView[]):EditStop[]=>stops.filter(stop=>stop.supervisorState!=='removed').map(stop=>({key:stop.id,id:stop.id,customerId:stop.customerId,kind:stop.kind,time:stop.time,note:stop.note,state:stop.supervisorState}));
const wireStops=(stops:readonly EditStop[])=>stops.map(stop=>({...(stop.id?{id:stop.id}:{}),customerId:stop.customerId,kind:stop.kind,time:stop.time,note:stop.note.trim()}));
const validDraft=(value:unknown):value is {baseVersion:number|null;stops:EditStop[];savedAt:string}=>!!value&&typeof value==='object'&&Array.isArray((value as {stops:unknown}).stops)&&(value as {stops:unknown[]}).stops.every(stop=>!!stop&&typeof stop==='object'&&typeof (stop as EditStop).key==='string'&&typeof (stop as EditStop).customerId==='string'&&(STOP_KINDS as readonly unknown[]).includes((stop as EditStop).kind));

/** mode 'member': a stop a reviewer added or changed is shown, never changed or deleted (it may move in the order); mode 'reviewer': every
 *  stop is editable (one of the member's taken out is kept as «حذفها المشرف» by the server). */
function StopsEditor({stops,onChange,customers,names,mode,disabled}:{stops:EditStop[];onChange:(stops:EditStop[])=>void;customers:readonly Row[];names:ReadonlyMap<string,string>;mode:'member'|'reviewer';disabled:boolean}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 const update=(key:string,patch:Partial<EditStop>)=>onChange(stops.map(stop=>stop.key===key?{...stop,...patch}:stop));
 const move=(index:number,by:number)=>{const next=[...stops],[item]=next.splice(index,1);next.splice(index+by,0,item);onChange(next);};
 return <div className="plan-editor">
  {!stops.length&&<p className="plan-muted">{say('لا توجد محطات بعد. أضف أول زيارة أو اتصال أو تواصل واتساب.','No stops yet. Add the first visit, call or WhatsApp contact.')}</p>}
  <ol className="plan-edit-list">{stops.map((stop,index)=>{
   const locked=mode==='member'&&lockedForMember(stop.state);
   return <li key={stop.key} className={'plan-edit-stop'+(locked?' locked':'')} data-plan-edit-stop={index+1} data-plan-locked={locked?'yes':undefined}>
    <div className="plan-stop-head"><span className="plan-number">{index+1}</span>{stop.state&&stop.state!=='removed'&&<span className="plan-chip supervisor">{pair(SUPERVISOR_STATE_TEXT[stop.state],language)}</span>}
     <span className="plan-stop-tools"><button type="button" className="icon-button" disabled={disabled||index===0} aria-label={say('نقل المحطة لأعلى','Move the stop up')} onClick={()=>move(index,-1)}><ArrowUp size={17} aria-hidden/></button><button type="button" className="icon-button" disabled={disabled||index===stops.length-1} aria-label={say('نقل المحطة لأسفل','Move the stop down')} onClick={()=>move(index,1)}><ArrowDown size={17} aria-hidden/></button>{!locked&&<button type="button" className="icon-button danger" disabled={disabled} aria-label={say('حذف المحطة','Delete the stop')} data-plan-remove={index+1} onClick={()=>onChange(stops.filter(item=>item.key!==stop.key))}><Trash2 size={17} aria-hidden/></button>}</span></div>
    {locked?<p className="plan-locked-note">{say('أضافها المشرف أو عدّلها: لا يمكنك تغييرها أو حذفها.','Added or edited by the supervisor: you cannot change or delete it.')}</p>:null}
    <CustomerPick customers={customers} value={stop.customerId} name={names.get(stop.customerId)||''} disabled={disabled||locked} label={say('العميل','Customer')} onChange={customerId=>update(stop.key,{customerId})}/>
    <fieldset className="plan-kinds" disabled={disabled||locked}><legend>{say('النوع','Kind')}</legend><div>{STOP_KINDS.map(kind=><label key={kind} className={'plan-kind'+(stop.kind===kind?' chosen':'')}><input type="radio" name={'kind-'+stop.key} value={kind} checked={stop.kind===kind} onChange={()=>update(stop.key,{kind})}/><span>{pair(STOP_KIND_TEXT[kind],language)}</span></label>)}</div></fieldset>
    <div className="plan-stop-extra">
     <label className="plan-field"><span>{say('الوقت (اختياري)','Time (optional)')}</span><input type="time" value={stop.time} disabled={disabled||locked} onChange={event=>update(stop.key,{time:event.target.value})}/></label>
     <VoiceField className="plan-voice" label={say('ملاحظة (اختيارية)','Note (optional)')} value={stop.note} disabled={disabled||locked} contextKey={'plan-stop-'+stop.key} onChange={note=>update(stop.key,{note})} inputProps={{maxLength:PLAN_STOP_NOTE_MAX}}/>
    </div>
   </li>;
  })}</ol>
  <button type="button" className="btn subtle" disabled={disabled||stops.length>=PLAN_MAX_STOPS} data-plan-add onClick={()=>onChange([...stops,{key:crypto.randomUUID(),customerId:'',kind:'visit',time:'',note:'',state:''}])}><Plus size={17} aria-hidden/>{say('إضافة محطة','Add a stop')}</button>
 </div>;
}
const stopsProblem=(stops:readonly EditStop[],say:(ar:string,en:string)=>string)=>!stops.length?say('أضف محطة واحدة على الأقل.','Add one stop at least.'):stops.some(stop=>!stop.customerId)?say('اختر العميل في كل محطة.','Choose the customer of every stop.'):'';

// ---- reading a plan
function StopsView({plan}:{plan:PlanView}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 if(!plan.stops.length)return null;
 return <ol className="plan-stops">{plan.stops.map(stop=><li key={stop.id} className={'plan-stop completion-'+stop.completion} data-plan-stop={stop.position} data-plan-completion={stop.completion}>
  <span className="plan-number">{stop.position}</span>
  <div className="plan-stop-body">
   <p className="plan-stop-title"><strong>{stop.customerName||say('عميل غير متاح','Customer not available')}</strong><span className="plan-chip kind">{pair(STOP_KIND_TEXT[stop.kind],language)}</span>{stop.time&&<span className="plan-time"><Clock size={13} aria-hidden/><bdi>{stop.time}</bdi></span>}</p>
   {stop.note&&<p className="plan-stop-note">{stop.note}</p>}
   <p className="plan-stop-foot"><span className={'plan-chip completion '+stop.completion}>{pair(STOP_COMPLETION_TEXT[stop.completion],language)}</span>{stop.doneAt&&<time dateTime={stop.doneAt} dir="auto">{stamp(stop.doneAt,language)}</time>}{stop.supervisorState&&stop.supervisorState!=='removed'&&<span className="plan-chip supervisor">{pair(SUPERVISOR_STATE_TEXT[stop.supervisorState],language)}{stop.editedByName?' · '+stop.editedByName:''}</span>}</p>
  </div>
 </li>)}</ol>;
}
function PlanSummary({plan}:{plan:PlanView}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en),c=plan.counts;
 if(plan.state==='missing'&&!plan.activities.length)return null;
 return <p className="plan-summary" data-plan-counts={[c.stops,c.done,c.doneOther,c.open,c.outside].join(',')}>
  {plan.state!=='missing'&&<><span>{say('المحطات','Stops')}: <b>{c.stops}</b></span><span>{pair(STOP_COMPLETION_TEXT.done,language)}: <b>{c.done}</b></span><span>{pair(STOP_COMPLETION_TEXT.done_other,language)}: <b>{c.doneOther}</b></span><span>{pair(STOP_COMPLETION_TEXT.open,language)}: <b>{c.open}</b></span></>}
  <span>{pair(ACTIVITY_PLACE_TEXT.outside,language)}: <b>{c.outside}</b></span>{c.extra>0&&<span>{pair(ACTIVITY_PLACE_TEXT.extra,language)}: <b>{c.extra}</b></span>}
 </p>;
}
function OutsideView({plan}:{plan:PlanView}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 if(!plan.activities.length)return null;
 return <div className="plan-outside"><h4>{say('زيارات وتواصل لم يغلق محطة','Visits and contacts that closed no stop')}</h4><ul>{plan.activities.map(item=><li key={item.id} data-plan-outside={item.place}><strong>{item.customerName||say('عميل غير متاح','Customer not available')}</strong> · {pair(ACTIVITY_TYPE_TEXT[item.type]||['تواصل','Contact'],language)} · <time dateTime={item.at} dir="auto">{stamp(item.at,language)}</time> <span className={'plan-chip place '+item.place}>{pair(ACTIVITY_PLACE_TEXT[item.place],language)}</span></li>)}</ul></div>;
}
function NotesView({plan}:{plan:PlanView}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en),others=plan.notes.filter(note=>!plan.myNote||note.reviewerId!==plan.myNote.reviewerId);
 if(!others.length)return null;
 return <div className="plan-notes"><h4><MessageSquareText size={16} aria-hidden/>{say('ملاحظات المراجعين','Reviewers\' notes')}</h4><ul>{others.map(note=><li key={note.reviewerId} data-plan-note={note.reviewerId}><p>{note.note}</p><small>{note.reviewerName} · <time dateTime={note.updatedAt} dir="auto">{stamp(note.updatedAt,language)}</time></small></li>)}</ul></div>;
}
function PlanMeta({plan}:{plan:PlanView}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 return <div className="plan-meta">
  {plan.firstSentAt?<span><Send size={14} aria-hidden/>{say('أُرسلت','Sent')} <time dateTime={plan.firstSentAt} dir="auto">{stamp(plan.firstSentAt,language)}</time>{plan.firstSentSource==='device'?' · '+say('بوقت الجهاز','by the device\'s clock'):''}</span>:plan.state!=='draft'&&<span><Clock size={14} aria-hidden/>{say('آخر موعد للإرسال','Send deadline')} <DeadlineMoment date={plan.date} deadline={plan.deadline} language={language}/></span>}
  {plan.reviewedAt&&<span><CheckCheck size={14} aria-hidden/>{plan.state==='returned'?say('أعادها','Returned by'):say('اعتمدها','Approved by')} {plan.reviewedByName} · <time dateTime={plan.reviewedAt} dir="auto">{stamp(plan.reviewedAt,language)}</time></span>}
 </div>;
}

/** A reviewer's decisions on a plan: «اعتماد», «اعتماد مع تعديل» (the editor), «إعادة للمندوب» with a reason, and the one note on the day. */
function ReviewActions({plan,customers,names,onSaved}:{plan:PlanView;customers:readonly Row[];names:ReadonlyMap<string,string>;onSaved:(plan:PlanView)=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en),{post,busy}=usePlanPost();
 const [mode,setMode]=useState<'idle'|'edit'|'return'>('idle'),[stops,setStops]=useState<EditStop[]>([]),[reason,setReason]=useState(''),[note,setNote]=useState(plan.myNote?.note||''),[error,setError]=useState('');
 const run=async(label:string,body:Record<string,unknown>,done:string)=>{setError('');try{const saved=await post(label,body);onSaved(saved);setMode('idle');toast.success(done);}catch(failure){setError(errorText(failure,say('تعذر الحفظ. أعد المحاولة.','Could not save. Try again.')));}};
 const base={memberId:plan.memberId,date:plan.date,baseVersion:plan.version};
 if(!plan.canApprove&&!plan.canReviewEdit&&!plan.canReturn&&!plan.canNote)return null;
 return <div className="plan-review" data-plan-review>
  {mode==='idle'&&(plan.canApprove||plan.canReviewEdit||plan.canReturn)&&<div className="plan-actions">
   {plan.canApprove&&<button type="button" className="btn primary" disabled={!!busy} data-plan-approve onClick={()=>void run('approve',{action:'approve',...base},say('اعتُمدت الخطة','The plan was approved'))}>{busy==='approve'?<Loader2 size={16} className="spin" aria-hidden/>:<CheckCheck size={16} aria-hidden/>}{say('اعتماد','Approve')}</button>}
   {plan.canReviewEdit&&<button type="button" className="btn subtle" disabled={!!busy} data-plan-edit onClick={()=>{setStops(fromView(plan.stops));setMode('edit');setError('');}}><Pencil size={16} aria-hidden/>{say('اعتماد مع تعديل','Approve with edits')}</button>}
   {plan.canReturn&&<button type="button" className="btn subtle" disabled={!!busy} data-plan-return onClick={()=>{setReason('');setMode('return');setError('');}}><Undo2 size={16} aria-hidden/>{say('إعادة للمندوب','Return to the representative')}</button>}
  </div>}
  {mode==='edit'&&<div className="plan-review-edit"><p className="plan-muted">{say('تعديلاتك تُطبَّق فور الاعتماد وتظهر للمندوب على أنها من المشرف، ولا يستطيع تغييرها أو حذفها.','Your edits apply when you approve and show to the representative as the supervisor\'s; they cannot change or delete them.')}</p>
   <StopsEditor stops={stops} onChange={setStops} customers={customers} names={names} mode="reviewer" disabled={!!busy}/>
   <div className="plan-actions"><button type="button" className="btn primary" disabled={!!busy} data-plan-save-edit onClick={()=>{const problem=stopsProblem(stops,say);if(problem){setError(problem);return;}void run('edit',{action:'approve_edited',...base,stops:wireStops(stops)},say('اعتُمدت الخطة مع تعديلاتك','The plan was approved with your edits'));}}>{busy==='edit'?<Loader2 size={16} className="spin" aria-hidden/>:<CheckCheck size={16} aria-hidden/>}{say('اعتماد مع التعديلات','Approve with the edits')}</button><button type="button" className="btn subtle" disabled={!!busy} onClick={()=>{setMode('idle');setError('');}}>{say('إلغاء','Cancel')}</button></div></div>}
  {mode==='return'&&<div className="plan-review-return"><div data-plan-reason><VoiceField className="plan-voice" label={say('سبب الإعادة','Reason for returning')} marked multiline rows={3} value={reason} disabled={!!busy} contextKey={'plan-return-'+plan.memberId+plan.date} onChange={setReason} inputProps={{maxLength:PLAN_REASON_MAX}}/></div>
   <div className="plan-actions"><button type="button" className="btn primary" disabled={!!busy} data-plan-send-return onClick={()=>{if(reason.trim().length<PLAN_REASON_MIN){setError(say(`اكتب سبب الإعادة (${PLAN_REASON_MIN} أحرف على الأقل).`,`Write the reason (${PLAN_REASON_MIN} characters at least).`));return;}void run('return',{action:'return',...base,reason:reason.trim()},say('أُعيدت الخطة للمندوب','The plan was returned to the representative'));}}>{busy==='return'?<Loader2 size={16} className="spin" aria-hidden/>:<Undo2 size={16} aria-hidden/>}{say('إعادة للمندوب','Return to the representative')}</button><button type="button" className="btn subtle" disabled={!!busy} onClick={()=>{setMode('idle');setError('');}}>{say('إلغاء','Cancel')}</button></div></div>}
  {plan.canNote&&mode==='idle'&&<div className="plan-my-note"><div data-plan-note-input><VoiceField className="plan-voice" label={say('ملاحظتك على يوم المندوب','Your note on the representative\'s day')} multiline rows={2} value={note} disabled={!!busy} contextKey={'plan-note-'+plan.memberId+plan.date} onChange={setNote} inputProps={{maxLength:PLAN_NOTE_MAX}}/></div>
   <div className="plan-actions"><button type="button" className="btn subtle" disabled={!!busy||note.trim()===(plan.myNote?.note||'')} data-plan-note-save onClick={()=>{if(note.trim().length<PLAN_NOTE_MIN){setError(say('اكتب الملاحظة (حرفان على الأقل).','Write the note (two characters at least).'));return;}void run('note',{action:'note',memberId:plan.memberId,date:plan.date,note:note.trim(),noteVersion:plan.myNote?.version??null},say('حُفظت ملاحظتك','Your note was saved'));}}>{busy==='note'?<Loader2 size={16} className="spin" aria-hidden/>:<Save size={16} aria-hidden/>}{say('حفظ الملاحظة','Save the note')}</button>{plan.myNote&&<small className="plan-muted">{say('آخر حفظ','Last saved')} <time dateTime={plan.myNote.updatedAt} dir="auto">{stamp(plan.myNote.updatedAt,language)}</time></small>}</div></div>}
  {error&&<p className="plan-error" role="alert"><AlertCircle size={15} aria-hidden/>{error}</p>}
 </div>;
}

/** One plan as a reviewer reads it (the plans page and «تقرير يوم المندوب»): the state, the stops with what became of them, the visits and
 *  contacts outside it, the notes and the reviewer's actions. */
function PlanCard({plan,customers,names,onSaved,heading}:{plan:PlanView;customers:readonly Row[];names:ReadonlyMap<string,string>;onSaved:(plan:PlanView)=>void;heading?:string}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 return <article className={'plan-card state-'+plan.state} data-plan-card={plan.memberId+':'+plan.date}>
  <header><h3>{heading||say('خطة يوم','Plan of')+' '+dayLabel(plan.date,language)}</h3><PlanStateChip state={plan.state} late={plan.late}/></header>
  <PlanMeta plan={plan}/>
  {plan.state==='missing'&&<p className="plan-missing" data-plan-missing>{isPlanWorkingDay(plan.date)?say('لم يُرسل المندوب خطة لهذا اليوم.','The representative sent no plan for this day.'):say('لم تُرسل خطة لهذا اليوم (ليس يوم عمل).','No plan was sent for this day (not a working day).')}</p>}
  {plan.state==='returned'&&plan.returnReason&&<p className="plan-return-reason" data-plan-return-reason><b>{say('سبب الإعادة','Reason for returning')}:</b> {plan.returnReason}</p>}
  <PlanSummary plan={plan}/>
  <StopsView plan={plan}/>
  <OutsideView plan={plan}/>
  <NotesView plan={plan}/>
  <ReviewActions key={plan.memberId+'|'+plan.date+'|'+plan.version+'|'+(plan.myNote?.version||0)} plan={plan} customers={customers} names={names} onSaved={onSaved}/>
 </article>;
}

const customerNames=(records:readonly Row[])=>new Map(records.filter(row=>row.kind==='customer').map(row=>[row.id,String(row.data.name||'')]));
const planCustomers=(records:readonly Row[],member:Member|undefined)=>records.filter(row=>row.kind==='customer'&&!row.data._offlineState&&!row.data._offlineAcknowledged&&(!member||memberCanAccessRegion(member,row.data.region)));

// ---- the member: «خطة الغد»
const jobDate=(job:OfflineJob)=>{try{return String(JSON.parse(job.body||'{}').date||'');}catch{return '';}};
function MemberPlans({me,records,offline,initialDate}:{me:Member;records:readonly Row[];offline:boolean;initialDate?:string}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en),now=today(),next=nextPlanDay(now);
 const [date,setDate]=useState(()=>initialDate&&planDateProblem(initialDate,now)===null?initialDate:next);
 const view=usePlanView(me.id,date,true),plan=view.plan,[jobs,setJobs]=useState<OfflineJob[]>([]),pending=useRef(0),reload=useRef(view.reload);
 useEffect(()=>{reload.current=view.reload;});
 // The sends of this day waiting on the device: shown, and the plan read again once one reached the server.
 useEffect(()=>{
  let live=true;
  const read=()=>{void listOutbox(me).then(list=>{if(!live)return;const mine=list.filter(job=>job.kind==='plan'&&jobDate(job)===date);if(pending.current&&!mine.length)reload.current();pending.current=mine.length;setJobs(mine);}).catch(()=>{});};
  read();const stop=subscribeOffline(read);return()=>{live=false;stop();};
 },[me,date]);
 const days=[...isPlanWorkingDay(now)?[now]:[],next,...Array.from({length:PLAN_AHEAD_DAYS},(_,index)=>addDays(now,index+1)).filter(day=>day!==next&&isPlanWorkingDay(day)).slice(0,2)];
 const state:PlanState=plan?.state||'missing';
 return <section className="daily-plans member" data-daily-plans="member">
  <p className="plan-intro">{say('رتّب زياراتك واتصالاتك وتواصل الواتساب ليوم العمل التالي وأرسلها للمشرف قبل الساعة 22:00، وخطة يوم السبت قبل منتصف الليل بين الجمعة والسبت. الخطة لا تمنعك من تسجيل أي زيارة أو تواصل.','Arrange your visits, calls and WhatsApp contacts for the next working day and send them to your supervisor before 22:00; Saturday\'s plan before midnight between Friday and Saturday. The plan never stops you from recording any visit or contact.')}</p>
  <div className="plan-days" role="group" aria-label={say('يوم الخطة','Plan day')}>{days.map(day=><button type="button" key={day} className={'plan-day'+(day===date?' chosen':'')} aria-pressed={day===date} data-plan-day={day} onClick={()=>setDate(day)}><CalendarDays size={15} aria-hidden/>{day===now?say('اليوم','Today'):dayLabel(day,language)}</button>)}
   <label className="plan-field plan-date-field"><span>{say('يوم آخر','Another day')}</span><input type="date" value={date} min={addDays(now,-30)} max={addDays(now,PLAN_AHEAD_DAYS)} onChange={event=>{if(event.target.value)setDate(event.target.value);}}/></label></div>
  <article className={'plan-card own state-'+state} data-plan-card={me.id+':'+date}>
   <header><h3>{say('خطة يوم','Plan of')} {dayLabel(date,language)}</h3><PlanStateChip state={state} late={plan?.late}/></header>
   {view.loading&&!plan&&<p className="plan-muted" role="status"><Loader2 size={15} className="spin" aria-hidden/>{say('جارٍ تحميل الخطة…','Loading the plan…')}</p>}
   {view.error&&<p className={view.cached?'plan-muted':'plan-error'} role={view.cached?'status':'alert'}>{view.cached?say('لا يوجد اتصال: تظهر آخر نسخة محفوظة على الجهاز.','No connection: the last copy kept on the device is shown.'):view.error}{!offline&&<button type="button" className="btn subtle small" onClick={view.reload}><RefreshCw size={14} aria-hidden/>{say('إعادة المحاولة','Try again')}</button>}</p>}
   {plan&&<PlanMeta plan={plan}/>}
   {plan?.state==='returned'&&<p className="plan-return-reason" data-plan-return-reason><b>{say('أعادها','Returned by')} {plan.reviewedByName}:</b> {plan.returnReason}</p>}
   {jobs.map(job=><p key={job.id} className={job.status==='blocked'?'plan-error':'plan-queued'} data-plan-queued={job.status} role={job.status==='blocked'?'alert':'status'}>{job.status==='blocked'?<>{say('لم تُرسل الخطة المحفوظة على الجهاز:','The plan kept on the device was not sent:')} {t(job.message)}</>:<>{say('الخطة محفوظة على الجهاز بانتظار الاتصال، بوقت','The plan is kept on the device waiting for the connection, with the time')} <time dateTime={job.capturedAt} dir="auto">{stamp(job.capturedAt,language)}</time></>}</p>)}
   {(!view.loading||plan)&&<MemberPlanForm key={date+'|'+(plan?.version??'none')+'|'+(view.cached?'device':'server')} me={me} date={date} plan={plan} records={records} offline={offline} onPlan={view.setPlan}/>}
   {plan&&<NotesView plan={{...plan,myNote:null}}/>}
  </article>
 </section>;
}
/** The member's own plan of one day: the editor while they may change it (kept on the device as they type, restored while it was made on
 *  the version the server still has), or the plan as it is with what became of each stop. */
function MemberPlanForm({me,date,plan,records,offline,onPlan}:{me:Member;date:string;plan:PlanView|null;records:readonly Row[];offline:boolean;onPlan:(plan:PlanView)=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en),now=today();
 const customers=useMemo(()=>planCustomers(records,me),[records,me]),names=useMemo(()=>customerNames(records),[records]);
 const restored=useMemo(()=>{
  let draft:unknown=null;try{draft=JSON.parse(stored(draftKey(me.id,date))||'null');}catch{draft=null;}
  return validDraft(draft)&&draft.baseVersion===(plan?.version??null)?draft.stops:null;
 // eslint-disable-next-line react-hooks/exhaustive-deps -- read once for this day and version (the parent's key)
 },[]);
 const [stops,setStops]=useState<EditStop[]>(()=>restored||(plan?fromView(plan.stops):[]));
 const [editing,setEditing]=useState(!!restored),[busy,setBusy]=useState(''),[error,setError]=useState(''),[openedAt]=useState(()=>Date.now());
 const request=useRef<{id:string;payload:string}|null>(null);
 useEffect(()=>{if(!restored)store(draftKey(me.id,date),null);},[restored,me.id,date]);
 const editable=plan?plan.canEdit:can(me,'plans','add')&&planDateProblem(date,now)===null;
 const draftOnly=!plan||plan.state==='missing'||plan.state==='draft',removed=plan?.stops.filter(stop=>stop.supervisorState==='removed')||[];
 const change=(next:EditStop[])=>{setStops(next);setEditing(true);setError('');store(draftKey(me.id,date),JSON.stringify({baseVersion:plan?.version??null,stops:next,savedAt:new Date().toISOString()}));};
 const keyOf=(body:Record<string,unknown>)=>{const payload=JSON.stringify(body);if(request.current?.payload!==payload)request.current={id:crypto.randomUUID(),payload};return request.current.id;};
 const send=async()=>{
  const problem=stopsProblem(stops,say);if(problem){setError(problem);return;}
  const body={action:'send',date,stops:wireStops(stops),baseVersion:plan?.version??null};
  setBusy('send');setError('');
  try{
   const result=await offlineSubmit<{plan?:unknown}>('/api/daily-plans',JSON.stringify({...body,requestId:keyOf(body)}),{me,language,label:say('خطة يوم ','Plan of ')+date,kind:'plan'});
   if(result.blocked){setError(t(result.message||say('لم تُرسل الخطة. راجع الإدخالات المحفوظة على الجهاز.','The plan was not sent. Review the entries kept on the device.')));return;}
   request.current=null;store(draftKey(me.id,date),null);setEditing(false);
   if(!result.queued&&validPlanView(result.plan)){onPlan(result.plan);toast.success(say('أُرسلت الخطة إلى المشرف','The plan was sent to the supervisor'));}
   else toast.info(say('حُفظت الخطة على الجهاز وستُرسل عند عودة الاتصال بوقت الضغط على «إرسال».','The plan is kept on the device and will be sent when the connection is back, with the time you pressed Send.'));
  }catch(failure){setError(errorText(failure,say('تعذر إرسال الخطة. أعد المحاولة.','Could not send the plan. Try again.')));}
  finally{setBusy('');}
 };
 const saveDraft=async()=>{
  if(offline){store(draftKey(me.id,date),JSON.stringify({baseVersion:plan?.version??null,stops,savedAt:new Date().toISOString()}));toast.info(say('حُفظت المسودة على هذا الجهاز.','The draft is kept on this device.'));return;}
  const body={action:'save',date,stops:wireStops(stops.filter(stop=>stop.customerId)),baseVersion:plan?.version??null};
  setBusy('save');setError('');
  try{
   const answer=await submitJson<{plan:unknown}>('/api/daily-plans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,requestId:keyOf(body)})},{language});
   request.current=null;
   if(validPlanView(answer.plan)){store(draftKey(me.id,date),null);setEditing(false);onPlan(answer.plan);toast.success(say('حُفظت المسودة','The draft was saved'));}
  }catch(failure){setError(errorText(failure,say('تعذر حفظ المسودة. أعد المحاولة.','Could not save the draft. Try again.')));}
  finally{setBusy('');}
 };
 return <>
  {!plan?.firstSentAt&&<p className="plan-deadline" data-plan-deadline><Clock size={15} aria-hidden/>{say('آخر موعد للإرسال','Send deadline')}: <DeadlineMoment date={date} deadline={planDeadline(date)} language={language}/>{openedAt>=Date.parse(planDeadline(date))?' · '+say('ما يُرسل الآن يُقبل ويُعلَّم «متأخرة».','Sent now, it is accepted and marked late.'):''}</p>}
  {editable?<>
   {plan&&!draftOnly&&!editing&&<><PlanSummary plan={plan}/><StopsView plan={plan}/><div className="plan-actions"><button type="button" className="btn subtle" data-plan-member-edit onClick={()=>setEditing(true)}><Pencil size={16} aria-hidden/>{say('تعديل الخطة','Edit the plan')}</button></div></>}
   {(draftOnly||editing)&&<><StopsEditor stops={stops} onChange={change} customers={customers} names={names} mode="member" disabled={!!busy}/>
    {removed.length>0&&<p className="plan-muted">{say('حذف المشرف','The supervisor removed')}: {removed.map(stop=>stop.customerName||say('عميل غير متاح','Customer not available')).join('، ')}</p>}
    <div className="plan-actions sticky">
     <button type="button" className="btn primary" disabled={!!busy||!stops.length} data-plan-send onClick={()=>void send()}>{busy==='send'?<Loader2 size={16} className="spin" aria-hidden/>:<Send size={16} aria-hidden/>}{draftOnly?say('إرسال للمشرف','Send to the supervisor'):say('إرسال التعديل للمشرف','Send the change to the supervisor')}</button>
     {draftOnly&&<button type="button" className="btn subtle" disabled={!!busy} data-plan-save-draft onClick={()=>void saveDraft()}>{busy==='save'?<Loader2 size={16} className="spin" aria-hidden/>:<Save size={16} aria-hidden/>}{say('حفظ مسودة','Save a draft')}</button>}
     {editing&&plan&&!draftOnly&&<button type="button" className="btn subtle" disabled={!!busy} onClick={()=>{store(draftKey(me.id,date),null);setStops(fromView(plan.stops));setEditing(false);setError('');}}>{say('إلغاء التعديل','Cancel the change')}</button>}
    </div></>}
  </>:plan&&<><PlanSummary plan={plan}/><StopsView plan={plan}/><OutsideView plan={plan}/>{plan.state!=='missing'&&!memberMayEdit(plan.status)&&<p className="plan-muted">{say('الخطة معتمدة. إذا احتجت إلى تعديلها فاطلب من المشرف إعادتها إليك.','The plan is approved. If you need to change it, ask your supervisor to return it to you.')}</p>}{plan.state==='missing'&&<p className="plan-muted">{say('لا خطة لهذا اليوم.','No plan for this day.')}</p>}</>}
  {error&&<p className="plan-error" role="alert"><AlertCircle size={15} aria-hidden/>{error}</p>}
 </>;
}

// ---- the reviewer: «خطط المناديب»
function ReviewerPlans({me,records,members,initialDate,initialMemberId}:{me:Member;records:readonly Row[];members:readonly Member[];initialDate?:string;initialMemberId?:string}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en),now=today();
 const [date,setDate]=useState(()=>initialDate&&/^\d{4}-\d{2}-\d{2}$/.test(initialDate)?initialDate:nextPlanDay(now));
 const [revision,setRevision]=useState(0),[memberId,setMemberId]=useState(initialMemberId||''),key=date+'|'+revision;
 const [answer,setAnswer]=useState<{key:string;list:PlanList|null;error:string}>({key:'',list:null,error:''});
 const [from,setFrom]=useState(date),[to,setTo]=useState(date);
 const choose=(day:string)=>{setDate(day);setMemberId('');setFrom(day);setTo(day);};
 useEffect(()=>{
  const controller=new AbortController();
  void submitJson<PlanList>('/api/daily-plans?'+new URLSearchParams({date}),{cache:'no-store',signal:controller.signal},{language}).then(body=>{if(controller.signal.aborted)return;if(!validPlanList(body))throw new Error(say('تعذر تحميل الخطط.','Could not load the plans.'));setAnswer({key,list:body,error:''});}).catch(failure=>{if(!controller.signal.aborted&&failure?.name!=='AbortError')setAnswer({key,list:null,error:errorText(failure,say('تعذر تحميل الخطط.','Could not load the plans.'))});});
  return()=>controller.abort();
 // eslint-disable-next-line react-hooks/exhaustive-deps -- key names the day and the revision; say follows language
 },[key,language]);
 const loading=answer.key!==key,error=loading?'':answer.error,list=answer.key.startsWith(date+'|')?answer.list:null;
 const exportTables=async(lang:'ar'|'en')=>{
  if(!from||!to||from>to)throw new Error(say('اختر فترة صحيحة للتصدير.','Choose a valid period to export.'));
  const body=await submitJson<unknown>('/api/daily-plans?'+new URLSearchParams({from,to}),{cache:'no-store'},{language});
  if(!validPlanExport(body))throw new Error(say('تعذر تحميل الخطط للتصدير.','Could not load the plans to export.'));
  return planTables(body.plans,lang);
 };
 const waiting=list?.rows.filter(row=>row.state==='sent').length||0;
 return <section className="daily-plans reviewer" data-daily-plans="reviewer">
  <p className="plan-intro">{say('خطط فريقك ليوم العمل: اعتمدها، أو اعتمدها مع تعديل، أو أعدها للمندوب مع السبب. تُعلَّم المحطة «تمت» تلقائيًا عند تسجيل الزيارة أو التواصل.','Your team\'s plans for a working day: approve them, approve them with edits, or return them with the reason. A stop is marked done automatically once the visit or contact is recorded.')}</p>
  <div className="plan-toolbar">
   <div className="plan-days" role="group" aria-label={say('يوم الخطط','Plans day')}>
    {[now,nextPlanDay(now)].map(day=><button type="button" key={day} className={'plan-day'+(day===date?' chosen':'')} aria-pressed={day===date} data-plan-day={day} onClick={()=>choose(day)}><CalendarDays size={15} aria-hidden/>{day===now?say('اليوم','Today'):dayLabel(day,language)}</button>)}
    <label className="plan-field plan-date-field"><span>{say('يوم آخر','Another day')}</span><input type="date" value={date} max={addDays(now,PLAN_AHEAD_DAYS)} onChange={event=>{if(event.target.value)choose(event.target.value);}}/></label>
    <button type="button" className="btn subtle" disabled={loading} onClick={()=>setRevision(value=>value+1)}><RefreshCw size={16} className={loading?'spin':''} aria-hidden/>{say('تحديث','Refresh')}</button>
   </div>
   {can(me,'plans','export')&&<div className="plan-export"><label className="plan-field"><span>{say('من','From')}</span><input type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label><label className="plan-field"><span>{say('إلى','To')}</span><input type="date" value={to} onChange={event=>setTo(event.target.value)}/></label><ExportExcelButton page="plans" me={me} day={from===to?from:undefined} disabled={!from||!to||from>to} build={exportTables}/></div>}
  </div>
  {error&&<p className="plan-error" role="alert"><AlertCircle size={15} aria-hidden/>{error}</p>}
  {loading&&!list&&<p className="plan-muted" role="status"><Loader2 size={15} className="spin" aria-hidden/>{say('جارٍ تحميل الخطط…','Loading the plans…')}</p>}
  {list&&<div className="plan-board">
   <div className="plan-list-wrap"><h2><Users size={17} aria-hidden/>{say('فريقك','Your team')} · {dayLabel(list.date,language)}{waiting>0&&<span className="plan-count" data-plan-waiting>{waiting}</span>}</h2>
    {!list.workingDay&&<p className="plan-muted">{say('ليس يوم عمل: الخطة غير مطلوبة.','Not a working day: no plan is required.')}</p>}
    {!list.rows.length?<p className="plan-muted">{say('لا يتبعك مندوبون.','No representatives report to you.')}</p>:<ul className="plan-list">{list.rows.map(row=><li key={row.memberId}><button type="button" className={'plan-row'+(row.memberId===memberId?' chosen':'')+(row.overdue?' overdue':'')} aria-pressed={row.memberId===memberId} data-plan-row={row.memberId} onClick={()=>{setMemberId(row.memberId);if(typeof window!=='undefined'&&window.innerWidth<900)requestAnimationFrame(()=>document.querySelector('.plan-detail-wrap')?.scrollIntoView({block:'start',behavior:'smooth'}));}}>
     <span className="plan-row-name"><strong>{row.name}</strong>{row.firstSentAt&&<small>{say('أُرسلت','Sent')} <time dateTime={row.firstSentAt} dir="auto">{stamp(row.firstSentAt,language)}</time></small>}{row.overdue&&<small className="plan-overdue">{say('تجاوز آخر موعد للإرسال','Past the send deadline')}</small>}</span>
     <PlanStateChip state={row.state} late={row.late}/>
     {row.state!=='missing'&&<span className="plan-row-counts">{row.counts.done+row.counts.doneOther}/{row.counts.stops}</span>}
    </button></li>)}</ul>}
   </div>
   <div className="plan-detail-wrap">{memberId?<PlanDetail key={memberId+':'+date} me={me} memberId={memberId} date={date} records={records} members={members} onSaved={()=>setRevision(value=>value+1)}/>:<p className="plan-muted plan-pick-hint">{say('اختر مندوبًا لعرض خطته.','Choose a representative to see their plan.')}</p>}</div>
  </div>}
 </section>;
}
function PlanDetail({me,memberId,date,records,members,onSaved,heading}:{me:Member;memberId:string;date:string;records:readonly Row[];members:readonly Member[];onSaved?:()=>void;heading?:string}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en),view=usePlanView(memberId,date,false);
 const member=members.find(item=>item.id===memberId),customers=useMemo(()=>planCustomers(records,member),[records,member]),names=useMemo(()=>customerNames(records),[records]);
 void me;
 if(view.loading&&!view.plan)return <p className="plan-muted" role="status"><Loader2 size={15} className="spin" aria-hidden/>{say('جارٍ تحميل الخطة…','Loading the plan…')}</p>;
 if(!view.plan)return view.error?<p className="plan-error" role="alert"><AlertCircle size={15} aria-hidden/>{view.error}<button type="button" className="btn subtle small" onClick={view.reload}>{say('إعادة المحاولة','Try again')}</button></p>:null;
 return <PlanCard plan={view.plan} customers={customers} names={names} heading={heading||(view.plan.memberName+' · '+dayLabel(view.plan.date,language))} onSaved={plan=>{view.setPlan(plan);onSaved?.();}}/>;
}

/** The page «خطط المناديب» («خطة الغد» for a member who prepares plans). */
export default function DailyPlansPage({me,records,members,offline,initialDate,initialMemberId}:{me:Member;records:readonly Row[];members:readonly Member[];offline:boolean;initialDate?:string;initialMemberId?:string}){
 if(!pageAllowed(me,'plans'))return null;
 return isFieldRole(me.role)?<MemberPlans key={me.id+':'+(me.authVersion||0)} me={me} records={records} offline={offline} initialDate={initialDate}/>:reviewsPlans(me)?<ReviewerPlans key={me.id+':'+(me.authVersion||0)} me={me} records={records} members={members} initialDate={initialDate} initialMemberId={initialMemberId}/>:null;
}

/** On «تقرير يوم المندوب» (app/journey-report.tsx): the plan of the field member and day on screen, with the reviewer's actions. */
export function PlanDayPanel({me,memberId,date,memberRole,records,members}:{me:Member;memberId:string;date:string;memberRole:string;records:readonly Row[];members:readonly Member[]}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 if(!memberId||memberId==='all'||!isFieldRole(memberRole)||!pageAllowed(me,'plans')||!reviewsPlans(me))return null;
 return <section className="plan-day-panel no-print" data-plan-day-panel><PlanDetail key={memberId+':'+date} me={me} memberId={memberId} date={date} records={records} members={members} heading={say('خطة اليوم','The day\'s plan')+' · '+dayLabel(date,language)}/></section>;
}

// ---- the reminder card on every page
const notificationsSupported=()=>typeof window!=='undefined'&&'Notification' in window&&!isNativeTrackingApp();
const notificationsGranted=()=>notificationsSupported()&&Notification.permission==='granted';
async function deviceNotice(title:string,body:string,tag:string,language:string){
 if(!notificationsGranted())return;
 const options={body,tag,lang:language==='en'?'en':'ar',dir:(language==='en'?'ltr':'rtl') as NotificationDirection,icon:'/icons/yourrest-company-192.png',data:{url:'/#plans'}};
 try{const registration=await navigator.serviceWorker?.getRegistration('/');if(registration?.active){await registration.showNotification(title,options);return;}}catch{/* the page's own notification */}
 try{const notice=new Notification(title,options);notice.onclick=()=>{window.focus();notice.close();};}catch{/* the card stays */}
}
function lineText(line:PlanReminderLine,inbox:PlanInbox,language:string):{title:string;body:string}{
 const say=(ar:string,en:string)=>selectText(language,ar,en),day=dayLabel(line.date,language);
 switch(line.tone){
  case 'due':{const by=planDeadlineWords(line.date);return {title:say('خطة الغد لم تُرسل بعد','Tomorrow\'s plan is not sent yet'),body:say(`خطة يوم ${day}: أرسلها للمشرف قبل ${by[0]}.`,`The plan of ${day}: send it to your supervisor before ${by[1]}.`)};}
  case 'late':return {title:say('الخطة متأخرة','The plan is late'),body:say(`خطة يوم ${day} لم تُرسل وتجاوزت آخر موعد. أرسلها الآن؛ تُقبل وتُعلَّم «متأخرة».`,`The plan of ${day} was not sent and is past the deadline. Send it now; it is accepted and marked late.`)};
  case 'returned':{const target=inbox.next?.date===line.date?inbox.next:inbox.today;return {title:say('أُعيدت خطتك للتعديل','Your plan was returned for changes'),body:say(`خطة يوم ${day}`,`The plan of ${day}`)+(target?.reviewedByName?' · '+target.reviewedByName:'')+(target?.returnReason?': '+target.returnReason:'')};}
  case 'approved':return {title:say('اعتُمدت خطتك','Your plan was approved'),body:say(`خطة يوم ${day}`,`The plan of ${day}`)};
  case 'pending':{const item=inbox.pending?.find(entry=>entry.memberId===line.memberId&&entry.date===line.date);return {title:say('خطة بانتظار اعتمادك','A plan waits for your approval'),body:(item?.name||'')+' · '+say(`خطة يوم ${day}`,`the plan of ${day}`)+(item?.late?' · '+pair(PLAN_LATE_TEXT,language):'')};}
  default:return {title:say('مناديب لم يرسلوا خطتهم','Representatives who have not sent their plan'),body:say(`خطة يوم ${day}: `,`The plan of ${day}: `)+(inbox.missing?.names.join(say('، ',', '))||'')};
 }
}
/** «خطة الغد» / «خطط تنتظر اعتمادك»: what waits for the member (the next day's plan not sent from 16:00, late, returned; today's not sent)
 *  or the reviewer (plans waiting, and after the deadline who has not sent). Asked on load, every 5 minutes, when the page comes back to
 *  the front (at most once a minute); never offline. A line this browser has not shown is announced on the page and, where the browser
 *  allows it, by the device (never inside the Android app, whose web view has none: lib/daily-plans.ts planNoticeStep). onOpen opens the
 *  plans page on the day (and the member). quiet: on the plans page itself the card hides, the notices still come. */
export function PlanInboxCard({me,offline=false,quiet=false,onOpen}:{me:Member;offline?:boolean;quiet?:boolean;onOpen:(date:string,memberId?:string)=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 const [inbox,setInbox]=useState<PlanInbox|null>(null),[permission,setPermission]=useState<'default'|'granted'|'denied'|'unsupported'>(()=>notificationsSupported()?Notification.permission as 'default'|'granted'|'denied':'unsupported');
 const last=useRef(0),pending=useRef(false),offlineNow=useRef(offline),languageNow=useRef(language),memory=useRef<string[]|null>(null);
 useEffect(()=>{offlineNow.current=offline;},[offline]);
 useEffect(()=>{languageNow.current=language;},[language]);
 const applies=pageAllowed(me,'plans')&&(isFieldRole(me.role)&&can(me,'plans','add')||reviewsPlans(me)&&can(me,'plans','edit'));
 const load=useCallback(async(force=false)=>{
  if(!applies||pending.current||offlineNow.current||!force&&Date.now()-last.current<PLAN_INBOX_FOCUS_MS)return;
  pending.current=true;last.current=Date.now();
  try{
   const response=await fetch('/api/daily-plans/inbox',{cache:'no-store',credentials:'same-origin'});
   if(response.ok){const body:unknown=await response.json();if(validPlanInbox(body)){setInbox(body);
    const key=planNoticeStorageKey(me.id),raw=stored(key),remembered=raw!==null?rememberedPlanNotices(raw):memory.current,step=planNoticeStep(planReminderLines(body),remembered);
    memory.current=step.remember;store(key,JSON.stringify(step.remember));
    for(const line of step.announce.slice(0,3)){const words=lineText(line,body,languageNow.current);toast(words.title,{id:'plan-'+line.key,description:words.body,duration:12000});void deviceNotice(words.title,words.body,'yourrest-plan:'+line.key,languageNow.current);}
   }}
  }catch{/* offline or unreachable: the next check retries */}
  finally{pending.current=false;}
 },[applies,me.id]);
 useEffect(()=>{
  if(!applies)return;
  const first=setTimeout(()=>{void load(true);},0),timer=setInterval(()=>{if(document.visibilityState==='visible')void load(true);},PLAN_INBOX_INTERVAL_MS),again=()=>{if(document.visibilityState==='visible')void load();};
  const changed=()=>{void load(true);};
  document.addEventListener('visibilitychange',again);window.addEventListener('focus',again);window.addEventListener('online',again);window.addEventListener(PLANS_CHANGED,changed);
  return()=>{clearTimeout(first);clearInterval(timer);document.removeEventListener('visibilitychange',again);window.removeEventListener('focus',again);window.removeEventListener('online',again);window.removeEventListener(PLANS_CHANGED,changed);};
 },[applies,load]);
 const lines=planReminderLines(inbox).filter(line=>line.tone!=='approved');
 if(!applies||quiet||!inbox||!lines.length)return null;
 const allow=async()=>{try{setPermission(await Notification.requestPermission() as 'default'|'granted'|'denied');}catch{setPermission('denied');}};
 const title=inbox.role==='member'?say('خطة يوم العمل','The working day\'s plan'):say('خطط المناديب','Representatives\' plans');
 return <section className={'plan-inbox no-print'+(lines.some(line=>line.tone==='late'||line.tone==='missing')?' urgent':'')} aria-label={title} data-plan-inbox={inbox.role}>
  <header><h2><CalendarCheck size={19} aria-hidden/>{title}</h2>{permission==='default'&&<button type="button" className="btn subtle small" data-plan-notify onClick={()=>{void allow();}}><BellRing size={16} aria-hidden/>{say('تنبيهي على هذا الجهاز','Notify me on this device')}</button>}</header>
  <ol>{lines.slice(0,6).map(line=>{const words=lineText(line,inbox,language);return <li key={line.key} data-plan-inbox-line={line.tone}><div><strong>{words.title}</strong><p>{words.body}</p></div><button type="button" className="btn primary small" onClick={()=>onOpen(line.date,line.memberId)}>{line.tone==='pending'?<><ClipboardCheck size={15} aria-hidden/>{say('مراجعة','Review')}</>:line.tone==='missing'?<><Users size={15} aria-hidden/>{say('عرض الخطط','See the plans')}</>:<><Pencil size={15} aria-hidden/>{say('فتح الخطة','Open the plan')}</>}</button></li>;})}</ol>
  {lines.length>6&&<p className="plan-muted">{say(`وخطط أخرى: ${lines.length-6}`,`And other plans: ${lines.length-6}`)}</p>}
 </section>;
}
