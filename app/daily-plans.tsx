'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {AlertCircle,ArrowDown,ArrowUp,BellRing,CalendarCheck,CalendarClock,CalendarDays,CheckCheck,ClipboardCheck,Clock,ListChecks,Loader2,MessageSquareText,Pencil,Plus,RefreshCw,Save,Search,Send,Target,Trash2,Undo2,Users,X} from 'lucide-react';
import {toast} from 'sonner';
import {t,useLanguage} from '@/lib/i18n';
import {submitJson} from '@/lib/client-submit';
import {offlineSubmit} from '@/lib/offline-submit';
import {listOutbox,subscribeOffline,type OfflineJob} from '@/lib/offline-store';
import {can,pageAllowed} from '@/lib/permissions';
import {isNativeTrackingApp} from '@/lib/native-tracking';
import {isFieldRole} from '@/lib/roles';
import type {Member,Row} from '@/lib/crm';
import {ACTIVITY_TYPE_TEXT} from '@/lib/supervisor-reviews';
import {planTables} from '@/lib/list-export-plans';
import {BULK_MESSAGES,NO_TARGETS,TARGET_KEYS,TARGET_MESSAGES,TARGET_TEXT,addToPlanText,bulkLastDay,bulkMovesTitle,bulkParts,bulkSummary,dueButtonText,followupsDueOn,hasTarget,lateLabel,memberFollowups,overdueFollowups,planTargetValid,readTarget,searchFollowups,stopsNeeded,stopsToAdd,targetFigure,targetLine,targetsProblem,toggleAll,toggleOne,validNextDateAnswer,visibleFollowups,type NextDateResult,type PlanBulkMove,type PlanFollowup,type PlanTargets} from '@/lib/daily-plan-followups';
import {ACTIVITY_PLACE_TEXT,MANAGER_STATE_TEXT,PLAN_AHEAD_DAYS,PLAN_INBOX_FOCUS_MS,PLAN_INBOX_INTERVAL_MS,PLAN_LATE_TEXT,PLAN_MAX_STOPS,PLAN_NOTE_MAX,PLAN_NOTE_MIN,PLAN_REASON_MAX,PLAN_REASON_MIN,PLAN_STATE_TEXT,PLAN_STOP_NOTE_MAX,PLAN_UNAPPROVED_TEXT,STOP_COMPLETION_TEXT,STOP_KINDS,STOP_KIND_TEXT,TARGETS_EDITED_TEXT,addDays,isPlanWorkingDay,lockedForMember,memberMayEdit,nextPlanDay,planDateProblem,planDeadline,planDeadlineWords,planDay,planNoticeStep,planNoticeStorageKey,planReminderLines,rememberedPlanNotices,reviewsPlans,riyadhDayOf,stopMark,stopMarkText,validPlanExport,validPlanInbox,validPlanList,validPlanView,withTargets,type PlanInbox,type PlanList,type PlanReminderLine,type PlanState,type PlanEditor,type PlanStopView,type PlanView,type StopKind,type StopMark,type SupervisorState} from '@/lib/daily-plans';
import {ExportExcelButton} from './export-excel-button';
import {FollowupDatePicker} from './followup-date-picker';
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
export function dayLabel(date:string,language:string){
 const at=Date.parse(date+'T12:00:00Z');if(!Number.isFinite(at))return date;
 const locale=language==='en'?'en-GB':'ar-SA';let format=dayFormats.get(locale);
 if(!format){format=new Intl.DateTimeFormat(locale,{calendar:'gregory',numberingSystem:'latn',timeZone:'UTC',weekday:'long',day:'numeric',month:'long'});dayFormats.set(locale,format);}
 return format.format(new Date(at));
}
/** A moment on Riyadh's wall clock («20 نوفمبر، 21:40»). hourCycle h23, not hour12:false: a browser that reads hour12:false as h24 for
 *  ar-SA would write Saturday's deadline (midnight) as «24:00» of the next day. */
export function stamp(value:string|null|undefined,language:string){
 if(!value||!Number.isFinite(Date.parse(value)))return '—';
 const locale=language==='en'?'en-GB':'ar-SA';let format=clockFormats.get(locale);
 if(!format){format=new Intl.DateTimeFormat(locale,{calendar:'gregory',numberingSystem:'latn',timeZone:'Asia/Riyadh',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});clockFormats.set(locale,format);}
 return format.format(new Date(value));
}
/** «آخر موعد للإرسال» of the plan of `date`: midnight at the start of the plan's day (GSCO 2.13.86, every day since 2026-11-22; Saturday's
 *  since 2026-11-21), in words and then the moment, so that «00:00» of the plan's day is read as the end of the day before («منتصف الليل بين
 *  السبت والأحد (23 نوفمبر، 00:00)»). One element (no nested span: the meta line lays its spans out as flex boxes). */
function DeadlineMoment({date,deadline,language}:{date:string;deadline:string;language:string}){
 return <time dateTime={deadline} dir="auto" data-plan-deadline-words="">{pair(planDeadlineWords(date),language)+' ('+stamp(deadline,language)+')'}</time>;
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

/** The state of a plan; «غير معتمدة» (GSCO 2.13.86) in place of a state that waited when its day began without an approval. */
export function PlanStateChip({state,late,unapproved}:{state:PlanState;late?:boolean;unapproved?:boolean}){
 const {language}=useLanguage();
 return <span className="plan-chips"><span className={'plan-chip state-'+(unapproved?'unapproved':state)} data-plan-state={state} data-plan-unapproved={unapproved?'':undefined}>{pair(unapproved?PLAN_UNAPPROVED_TEXT:PLAN_STATE_TEXT[state],language)}</span>{late&&<span className="plan-chip late" data-plan-late>{pair(PLAN_LATE_TEXT,language)}</span>}</span>;
}
/** The mark of a stop a reviewer decided: who and what (a plan read from a server before 2026-11-22 has none: the supervisor's). */
export const stopMarkOf=(stop:Pick<PlanStopView,'supervisorState'|'mark'>):StopMark|null=>stop.mark===undefined?stopMark(stop.supervisorState,undefined):stop.mark;
export function StopMarkChip({mark,name}:{mark:StopMark|null;name?:string}){
 const {language}=useLanguage();
 if(!mark||mark.kind==='removed')return null;
 return <span className={'plan-chip supervisor'+(mark.by==='manager'?' manager':'')} data-stop-mark={mark.by}>{pair(stopMarkText(mark.kind,mark.by),language)}{name?' · '+name:''}</span>;
}
const targetsEditedText=(by:PlanEditor|null|undefined)=>TARGETS_EDITED_TEXT[by==='manager'?'manager':'supervisor'];

/** Loads one plan (GET /api/daily-plans?date=&memberId=). The member's own is kept on the device, so it shows without a network. */
export function usePlanView(memberId:string,date:string,own:boolean){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 const [revision,setRevision]=useState(0),key=memberId+'|'+date+'|'+revision;
 const [state,setState]=useState<{key:string;plan:PlanView|null;error:string;cached:boolean}>({key:'',plan:null,error:'',cached:false});
 useEffect(()=>{
  const controller=new AbortController(),params=new URLSearchParams({date,memberId});
  void submitJson<PlanView>('/api/daily-plans?'+params,{cache:'no-store',signal:controller.signal},{language}).then(body=>{
   if(controller.signal.aborted)return;
   if(!validPlanView(body))throw new Error(say('تعذر تحميل الخطة.','Could not load the plan.'));
   if(own)store(cacheKey(memberId,date),JSON.stringify(body));
   setState({key,plan:withTargets(body),error:'',cached:false});
  }).catch(error=>{
   if(controller.signal.aborted||error?.name==='AbortError')return;
   let cached:PlanView|null=null;
   if(own){try{const value:unknown=JSON.parse(stored(cacheKey(memberId,date))||'null');cached=validPlanView(value)?withTargets(value):null;}catch{cached=null;}}
   setState({key,plan:cached,error:errorText(error,say('تعذر تحميل الخطة.','Could not load the plan.')),cached:!!cached});
  });
  return()=>controller.abort();
 // eslint-disable-next-line react-hooks/exhaustive-deps -- key names the member, the day and the revision; say follows language
 },[key,own,language]);
 // While a new answer is on its way, the last plan of the same member and day stays on screen.
 const same=state.key.slice(0,state.key.lastIndexOf('|'))===memberId+'|'+date;
 const current=state.key===key?{...state,loading:false}:{key,plan:same?state.plan:null,error:'',cached:false,loading:true};
 const setPlan=useCallback((plan:PlanView)=>{if(own)store(cacheKey(plan.memberId,plan.date),JSON.stringify(plan));plansChanged();setState({key:plan.memberId+'|'+plan.date+'|'+revision,plan:withTargets(plan),error:'',cached:false});},[own,revision]);
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
   return withTargets(answer.plan);
  }finally{setBusy('');}
 },[language]);
 return {post,busy};
}

// ---- the editor of the stops
type EditStop={key:string;id?:string;customerId:string;kind:StopKind;time:string;note:string;state:SupervisorState;/** who decided it (GSCO 2.13.86) */mark?:StopMark|null};
const fromView=(stops:readonly PlanStopView[]):EditStop[]=>stops.filter(stop=>stop.supervisorState!=='removed').map(stop=>({key:stop.id,id:stop.id,customerId:stop.customerId,kind:stop.kind,time:stop.time,note:stop.note,state:stop.supervisorState,mark:stopMarkOf(stop)}));
const wireStops=(stops:readonly EditStop[])=>stops.map(stop=>({...(stop.id?{id:stop.id}:{}),customerId:stop.customerId,kind:stop.kind,time:stop.time,note:stop.note.trim()}));
const validDraft=(value:unknown):value is {baseVersion:number|null;stops:EditStop[];targets?:unknown;savedAt:string}=>!!value&&typeof value==='object'&&Array.isArray((value as {stops:unknown}).stops)&&(value as {stops:unknown[]}).stops.every(stop=>!!stop&&typeof stop==='object'&&typeof (stop as EditStop).key==='string'&&typeof (stop as EditStop).customerId==='string'&&(STOP_KINDS as readonly unknown[]).includes((stop as EditStop).kind));
const draftTargets=(value:unknown):PlanTargets|null=>{if(!value||typeof value!=='object')return null;const raw=value as Record<string,unknown>,one=(v:unknown)=>typeof v==='number'?v:null;return {opportunities:one(raw.opportunities),customers:one(raw.customers)};};
/** A follow-up stop of the plan (2026-11-22): every new stop is one of the member's follow-ups, so its customer is fixed; the note starts as
 *  the follow-up's next action. */
const followupStop=(item:PlanFollowup):EditStop=>({key:crypto.randomUUID(),customerId:item.customerId,kind:'visit',time:'',note:item.nextAction.slice(0,PLAN_STOP_NOTE_MAX),state:''});

/** mode 'member': a stop a reviewer added or changed is shown, never changed or deleted (it may move in the order); the member's own stops
 *  carry «تغيير الموعد» of their follow-up (`reschedule`). mode 'reviewer': every stop is editable but its customer (one of the member's taken
 *  out is kept as «حذفها المشرف» by the server), except, for a supervisor, the stops the sales manager decided (`fixed`, GSCO 2.13.86:
 *  shown, never changed, deleted or moved past). New stops come from the member's follow-ups only (2026-11-22): no free «إضافة محطة». */
function StopsEditor({stops,onChange,names,mode,disabled,reschedule,fixed}:{stops:EditStop[];onChange:(stops:EditStop[])=>void;names:ReadonlyMap<string,string>;mode:'member'|'reviewer';disabled:boolean;reschedule?:(stop:EditStop)=>React.ReactNode;fixed?:(stop:EditStop)=>boolean}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 const update=(key:string,patch:Partial<EditStop>)=>onChange(stops.map(stop=>stop.key===key?{...stop,...patch}:stop));
 const move=(index:number,by:number)=>{const next=[...stops],[item]=next.splice(index,1);next.splice(index+by,0,item);onChange(next);};
 const pinned=(index:number)=>!!fixed&&!!stops[index]&&fixed(stops[index]);
 return <div className="plan-editor">
  {!stops.length&&<p className="plan-muted" data-plan-empty>{mode==='member'?say('لم تُضف متابعات بعد. أضف متابعات يوم الخطة أو اختر من المتابعات المتأخرة، وحدّد المستهدف.','No follow-ups yet. Add the plan day\'s follow-ups or choose from the late ones, and set the targets.'):say('لا توجد متابعات في هذه الخطة؛ المستهدف وحده.','This plan has no follow-ups; the targets alone.')}</p>}
  <ol className="plan-edit-list">{stops.map((stop,index)=>{
   const manager=stop.mark?.by==='manager',locked=mode==='member'&&lockedForMember(stop.state)||mode==='reviewer'&&pinned(index);
   // A supervisor never moves a stop of the sales manager, nor another stop past one (the server keeps their place: GSCO 2.13.86 review A10).
   const stuck=(by:number)=>pinned(index)||pinned(index+by);
   return <li key={stop.key} className={'plan-edit-stop'+(locked?' locked':'')+(manager?' manager':'')} data-plan-edit-stop={index+1} data-plan-locked={locked?'yes':undefined}>
    <div className="plan-stop-head"><span className="plan-number">{index+1}</span><StopMarkChip mark={stop.mark??(stop.state?stopMark(stop.state,undefined):null)}/>
     <span className="plan-stop-tools"><button type="button" className="icon-button" disabled={disabled||index===0||stuck(-1)} aria-label={say('نقل المحطة لأعلى','Move the stop up')} onClick={()=>move(index,-1)}><ArrowUp size={17} aria-hidden/></button><button type="button" className="icon-button" disabled={disabled||index===stops.length-1||stuck(1)} aria-label={say('نقل المحطة لأسفل','Move the stop down')} onClick={()=>move(index,1)}><ArrowDown size={17} aria-hidden/></button>{!locked&&<button type="button" className="icon-button danger" disabled={disabled} aria-label={say('حذف المحطة','Delete the stop')} data-plan-remove={index+1} onClick={()=>onChange(stops.filter(item=>item.key!==stop.key))}><Trash2 size={17} aria-hidden/></button>}</span></div>
    {locked?<p className="plan-locked-note">{mode==='reviewer'?say('أضافها مدير المبيعات أو عدّلها؛ لا يمكن للمشرف تغييرها أو حذفها أو تغيير موضعها.','Added or edited by the sales manager; the supervisor cannot change, delete or move it.'):manager?say('أضافها مدير المبيعات أو عدّلها: لا يمكنك تغييرها أو حذفها.','Added or edited by the sales manager: you cannot change or delete it.'):say('أضافها المشرف أو عدّلها: لا يمكنك تغييرها أو حذفها.','Added or edited by the supervisor: you cannot change or delete it.')}</p>:null}
    <p className="plan-customer-chosen"><strong data-plan-customer={stop.customerId}>{names.get(stop.customerId)||say('عميل غير متاح','Customer not available')}</strong></p>
    <fieldset className="plan-kinds" disabled={disabled||locked}><legend>{say('النوع','Kind')}</legend><div>{STOP_KINDS.map(kind=><label key={kind} className={'plan-kind'+(stop.kind===kind?' chosen':'')}><input type="radio" name={'kind-'+stop.key} value={kind} checked={stop.kind===kind} onChange={()=>update(stop.key,{kind})}/><span>{pair(STOP_KIND_TEXT[kind],language)}</span></label>)}</div></fieldset>
    <div className="plan-stop-extra">
     <label className="plan-field"><span>{say('الوقت (اختياري)','Time (optional)')}</span><input type="time" value={stop.time} disabled={disabled||locked} onChange={event=>update(stop.key,{time:event.target.value})}/></label>
     <VoiceField className="plan-voice" label={say('ملاحظة (اختيارية)','Note (optional)')} value={stop.note} disabled={disabled||locked} contextKey={'plan-stop-'+stop.key} onChange={note=>update(stop.key,{note})} inputProps={{maxLength:PLAN_STOP_NOTE_MAX}}/>
    </div>
    {mode==='member'&&!locked&&reschedule?reschedule(stop):null}
   </li>;
  })}</ol>
 </div>;
}
const stopsProblem=(stops:readonly EditStop[],targets:PlanTargets,say:(ar:string,en:string)=>string)=>!stops.length&&!hasTarget(targets)?say(TARGET_MESSAGES.empty,'Add one follow-up at least or set a target above zero before sending.'):'';

/** «المستهدف في يوم الخطة» (2026-11-22, GSCO 2.13.85 decision c): the new sales opportunities the member will record and the new customers
 *  they will add on the plan's day, whole numbers 0 to 50 (Arabic digits read), required to send; the achieved numbers beside them from that
 *  day on; a reviewer's change marked, with what the member had (decision d). A value typed that is not one is -1 for the form's check. */
function TargetsCard({targets,repTargets,edited,editedBy,actual,editable,onChange}:{targets:PlanTargets;repTargets:PlanTargets|null;edited:boolean;/** who changed them (GSCO 2.13.86) */editedBy?:PlanEditor|null;actual:{opportunities:number;customers:number}|null|undefined;editable:boolean;onChange?:(targets:PlanTargets)=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en),lang=language==='en'?'en':'ar';
 const [text,setText]=useState(()=>({opportunities:targets.opportunities===null?'':String(targets.opportunities),customers:targets.customers===null?'':String(targets.customers)}));
 const typed=(key:keyof PlanTargets,value:string)=>{setText(old=>({...old,[key]:value}));const read=readTarget(value);onChange?.({...targets,[key]:read===null?null:Number.isNaN(read)?-1:read});};
 const wrong=(key:keyof PlanTargets)=>editable&&text[key].trim()!==''&&!planTargetValid(readTarget(text[key]));
 return <section className="plan-targets" aria-label={say('المستهدف في يوم الخطة','The plan day\'s targets')} data-plan-targets={editable?'edit':'read'}>
  <div className="plan-targets-head"><h4><Target size={17} aria-hidden/>{say('المستهدف في يوم الخطة','The plan day\'s targets')}</h4>{edited&&<span className={'plan-chip supervisor'+(editedBy==='manager'?' manager':'')} data-targets-edited={editedBy||'supervisor'}>{pair(targetsEditedText(editedBy),language)}</span>}</div>
  {editable&&<p className="plan-muted">{say('ما تنوي تحقيقه في يوم الخطة؛ مطلوب قبل الإرسال ويمكن أن يكون صفرًا (الحد 50).','What you mean to achieve on the plan\'s day; required before sending and it may be zero (at most 50).')}</p>}
  <div className="plan-target-grid">{TARGET_KEYS.map(key=><div key={key} className="plan-target" data-plan-target={key}>
   {editable?<label className="plan-field"><span>{pair(TARGET_TEXT[key].field,language)} <b aria-hidden="true">*</b></span><input inputMode="numeric" maxLength={3} value={text[key]} aria-invalid={wrong(key)||undefined} placeholder="0" onChange={event=>typed(key,event.target.value)}/></label>
    :<p className="plan-target-value"><span>{pair(TARGET_TEXT[key].short,language)}</span><b>{targets[key]===null?say('لم يُحدَّد','Not set'):targets[key]}</b></p>}
   {wrong(key)&&<small className="plan-error" role="alert">{say(TARGET_MESSAGES.range,'The target is a whole number from 0 to 50.')}</small>}
   {edited&&repTargets&&repTargets[key]!==targets[key]&&<small className="plan-target-was">{say('كان عند المندوب','The representative had')}: {repTargets[key]===null?say('لم يُحدَّد','Not set'):repTargets[key]}</small>}
   {actual&&<small className="plan-target-actual" data-target-actual={actual[key]}>{targetLine(targets[key],actual[key],lang)}</small>}
  </div>)}</div>
 </section>;
}
/** The targets beside the achieved numbers, one line each (a plan as a reviewer reads it, and the member's plan they no longer edit). */
export function TargetsLine({plan}:{plan:PlanView}){
 const {language}=useLanguage(),lang=language==='en'?'en':'ar';
 if(plan.state==='missing'||plan.targets.opportunities===null&&plan.targets.customers===null&&!plan.actual)return null;
 return <p className="plan-target-lines" data-plan-target-lines>{TARGET_KEYS.map(key=><span key={key} data-target-line={key}><b>{pair(TARGET_TEXT[key].short,language)}:</b> {targetLine(plan.targets[key],plan.actual?.[key],lang)}</span>)}{plan.targetsEdited&&<span className={'plan-chip supervisor'+(plan.targetsEditedBy==='manager'?' manager':'')} data-targets-edited={plan.targetsEditedBy||'supervisor'}>{pair(targetsEditedText(plan.targetsEditedBy),language)}</span>}</p>;
}
/** «ترحيل جماعي: N متابعة» for the reviewer (GSCO 2.13.85 review B5): each follow-up the member moved from this day's plan, old date → new. */
function BulkMovesList({moves}:{moves:readonly PlanBulkMove[]}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en),lang=language==='en'?'en':'ar';
 if(!moves.length)return null;
 return <details className="plan-bulk-moves" data-bulk-moves={moves.length}>
  <summary><CalendarClock size={15} aria-hidden/>{bulkMovesTitle(moves.length,lang)}</summary>
  <ul>{moves.map(move=><li key={move.recordId+':'+move.at}><b>{move.customerName||say('عميل غير متاح','Customer not available')}</b> <span className="plan-bulk-dates" dir="auto">{move.from?dayLabel(move.from,language):'—'} {lang==='en'?'→':'←'} {dayLabel(move.to,language)}</span></li>)}</ul>
 </details>;
}

/** POST /api/crm/opportunity-next-dates in parts of 200 (lib/followup-next-dates-server.ts): online only, an answer for each follow-up; the
 *  page's records are read again after it, so the lists and the day load show the new dates. */
function useNextDates({date,offline,onRefresh}:{date:string;offline:boolean;onRefresh?:()=>Promise<void>}){
 const {language}=useLanguage(),[busy,setBusy]=useState(false),running=useRef(false);
 const move=useCallback(async(chosen:readonly PlanFollowup[],next:string,purpose:'plan'|'reschedule'):Promise<NextDateResult[]|null>=>{
  const say=(ar:string,en:string)=>selectText(language,ar,en);
  if(offline||typeof navigator!=='undefined'&&navigator.onLine===false){toast.error(say(BULK_MESSAGES.offline,'Bulk actions need a network connection; no date was changed.'));return null;}
  if(next>bulkLastDay(today())){toast.error(say(BULK_MESSAGES.far,'Follow-ups can be moved up to 30 days from today only.'));return null;}
  if(running.current)return null;
  running.current=true;setBusy(true);const results:NextDateResult[]=[];
  try{for(const part of bulkParts(chosen)){const answer=await submitJson<unknown>('/api/crm/opportunity-next-dates',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({request_id:crypto.randomUUID(),next_date:next,purpose,plan_date:date,items:part.map(item=>({id:item.id,version:item.version}))})},{language});
   if(!validNextDateAnswer(answer))throw new Error(say('الخادم لم يؤكد الحفظ. أعد المحاولة.','The server did not confirm the save. Try again.'));results.push(...answer.results);}}
  catch(failure){toast.error(errorText(failure,say('تعذر الحفظ. أعد المحاولة.','Could not save. Try again.')));}
  finally{running.current=false;setBusy(false);}
  if(results.length&&onRefresh)await onRefresh().catch(()=>{});
  return results;
 },[date,offline,onRefresh,language]);
 return {move,busy};
}

/** «تغيير الموعد» of one follow-up of the member's plan: the day-load picker of 2026-11-19; another day than the plan's takes the stop out of
 *  the plan, after the member reads it on the button. In Yourrest a representative edits no saved visit, so it goes through the same route
 *  as «ترحيل إلى تاريخ…» (one follow-up, the same 30 days). */
function RescheduleStop({item,planDate,me,members,records,offline,busy,onSave}:{item:PlanFollowup;planDate:string;me:Member;members:readonly Member[];records:readonly Row[];offline:boolean;busy:boolean;onSave:(item:PlanFollowup,next:string)=>Promise<boolean>}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en),now=today(),last=bulkLastDay(now);
 const [open,setOpen]=useState(false),[value,setValue]=useState('');
 if(!open)return <div className="plan-reschedule"><button type="button" className="btn subtle small" data-plan-reschedule-open={item.customerId} onClick={()=>{setValue(item.nextDate>=now?item.nextDate:planDate);setOpen(true);}}><CalendarClock size={15} aria-hidden/>{say('تغيير الموعد','Change the date')}</button>
  <small className="plan-muted">{say('موعد المتابعة الحالي','Current follow-up date')}: {dayLabel(item.nextDate,language)}</small></div>;
 const leaving=!!value&&value!==planDate,valid=!!planDay(value)&&value>=now&&value<=last;
 return <div className="plan-reschedule-panel" data-plan-reschedule={item.customerId}>
  <p className="plan-muted">{say('موعد المتابعة الحالي','Current follow-up date')}: <b>{dayLabel(item.nextDate,language)}</b></p>
  <FollowupDatePicker id={'plan-reschedule-'+item.customerId} value={value} onChange={setValue} min={now} max={last} records={records as Row[]} customerId={item.customerId} me={me} members={members as Member[]}/>
  {value>last&&<p className="plan-error" role="alert">{say(BULK_MESSAGES.far,'Follow-ups can be moved up to 30 days from today only.')}</p>}
  {leaving&&valid&&<p className="plan-alert" role="note" data-plan-leaving><AlertCircle size={15} aria-hidden/>{say(`سيُنقل الموعد إلى ${dayLabel(value,'ar')} وتخرج المتابعة من خطة يوم ${dayLabel(planDate,'ar')}.`,`The date moves to ${dayLabel(value,'en')} and the follow-up leaves the plan of ${dayLabel(planDate,'en')}.`)}</p>}
  <div className="plan-actions"><button type="button" className="btn primary small" disabled={busy||offline||!valid||value===item.nextDate} data-plan-reschedule-save onClick={async()=>{if(await onSave(item,value))setOpen(false);}}>{busy?<Loader2 size={15} className="spin" aria-hidden/>:<CalendarClock size={15} aria-hidden/>}{leaving?say('نقل الموعد وإخراجها من الخطة','Move the date and take it out of the plan'):say('حفظ الموعد','Save the date')}</button><button type="button" className="btn subtle small" disabled={busy} onClick={()=>setOpen(false)}>{say('إلغاء','Cancel')}</button></div>
  {offline&&<p className="plan-muted">{say('تغيير الموعد يحتاج اتصالًا بالشبكة.','Changing the date needs a network connection.')}</p>}
 </div>;
}

/** «المتابعات المتأخرة» (GSCO 2.13.85 decision b): the member's late follow-ups, oldest first, searched by the customer's name, code or city, a
 *  page of 30 at a time (smooth with 300 and more on a phone), with checkboxes; «تحديد الكل» takes every result of the search, not only the
 *  rows shown. «إضافة إلى خطة الغد» moves the chosen ones to the plan's day and adds them (decision a); «ترحيل إلى تاريخ…» moves them to one
 *  day chosen with the day load (at most 30 days ahead). Both need a connection. */
function OverduePicker({items,planDate,inPlan,room,offline,busy,me,members,records,onAdd,onMove,onClose}:{items:readonly PlanFollowup[];planDate:string;inPlan:ReadonlySet<string>;room:number;offline:boolean;busy:boolean;me:Member;members:readonly Member[];records:readonly Row[];
 onAdd:(chosen:readonly PlanFollowup[])=>Promise<NextDateResult[]|null>;onMove:(chosen:readonly PlanFollowup[],date:string)=>Promise<NextDateResult[]|null>;onClose:()=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en),lang=language==='en'?'en':'ar',now=today(),last=bulkLastDay(now);
 const [query,setQuery]=useState(''),[selected,setSelected]=useState<ReadonlySet<string>>(()=>new Set<string>()),[pages,setPages]=useState(1);
 const [moving,setMoving]=useState(false),[moveDate,setMoveDate]=useState(''),[report,setReport]=useState<{done:number;failures:{id:string;name:string;text:string}[]}|null>(null);
 const found=useMemo(()=>searchFollowups(items,query),[items,query]);
 const shown=visibleFollowups(found,pages),chosen=items.filter(item=>selected.has(item.id)),need=stopsNeeded(chosen,inPlan);
 const allFound=found.length>0&&found.every(item=>selected.has(item.id)),blocked=offline||busy,tooFar=!!planDay(moveDate)&&moveDate>last;
 async function run(job:Promise<NextDateResult[]|null>,names:ReadonlyMap<string,string>){
  const results=await job;if(!results)return;
  const summary=bulkSummary(results);
  setReport({done:summary.done,failures:summary.failures.map(failure=>({id:failure.id,name:names.get(failure.id)||'',text:failure.text}))});
  setSelected(old=>{const next=new Set(old);for(const id of summary.doneIds)next.delete(id);return next;});
  if(summary.done)setMoving(false);
 }
 const names=()=>new Map(chosen.map(item=>[item.id,item.customerName] as const));
 return <div className="plan-late" data-plan-overdue={items.length}>
  <div className="plan-late-head"><b>{say('المتابعات المتأخرة','Late follow-ups')}</b><small>{say('الأقدم أولًا','Oldest first')} · {items.length}</small><button type="button" className="icon-button" aria-label={say('إغلاق القائمة','Close the list')} onClick={onClose}><X size={17} aria-hidden/></button></div>
  <label className="plan-search-input"><Search size={16} aria-hidden/><input type="search" value={query} autoComplete="off" enterKeyHint="search" aria-label={say('ابحث في المتابعات المتأخرة','Search the late follow-ups')} placeholder={say('اسم العميل أو رمزه أو مدينته','The customer\'s name, code or city')} onChange={event=>{setQuery(event.target.value);setPages(1);}}/></label>
  <div className="plan-late-tools">
   <label className="plan-check"><input type="checkbox" checked={allFound} disabled={!found.length} data-overdue-all onChange={()=>setSelected(toggleAll(selected,found))}/><span>{query.trim()?say('تحديد كل نتائج البحث','Select every search result'):say('تحديد الكل','Select all')} ({found.length})</span></label>
   <span className="plan-muted" data-overdue-selected={chosen.length}>{say('المحدد','Selected')}: <b>{chosen.length}</b></span>
  </div>
  {offline&&<p className="plan-alert" role="status" data-bulk-offline><AlertCircle size={15} aria-hidden/>{say(BULK_MESSAGES.offline,'Bulk actions need a network connection; no date was changed.')}</p>}
  <ul className="plan-late-list">{shown.map(item=><li key={item.id}><label className={'plan-late-row'+(selected.has(item.id)?' selected':'')} data-overdue-row={item.customerId}>
   <input type="checkbox" checked={selected.has(item.id)} onChange={()=>setSelected(toggleOne(selected,item.id))} aria-label={item.customerName}/>
   <span className="plan-late-text"><b>{item.customerName||say('عميل غير متاح','Customer not available')}</b>
    {(item.customerCode||item.erpCode)&&<small dir="auto">{[item.customerCode,item.erpCode&&'ERP: '+item.erpCode].filter(Boolean).join(' · ')}</small>}
    <small className="plan-late-action">{say('الإجراء القادم','Next action')}: {item.nextAction}</small>
    <span className="plan-late-meta"><span className={'plan-chip '+(item.daysLate?'late':'kind')} data-days-late={item.daysLate}>{item.daysLate?lateLabel(item.daysLate,lang):say('مستحقة اليوم','Due today')}</span><small>{dayLabel(item.nextDate,language)}</small>{item.area&&<small>{item.area}</small>}{inPlan.has(item.customerId)&&<span className="plan-chip supervisor">{say('عميلها في الخطة','Its customer is in the plan')}</span>}</span>
   </span></label></li>)}</ul>
  {!found.length&&<p className="plan-muted">{items.length?say('لا توجد متابعات مطابقة للبحث.','No follow-up matches the search.'):say('لا توجد متابعات متأخرة.','No late follow-ups.')}</p>}
  {found.length>shown.length&&<button type="button" className="btn subtle" data-overdue-more={found.length-shown.length} onClick={()=>setPages(n=>n+1)}>{say('عرض المزيد','Show more')} ({found.length-shown.length})</button>}
  {chosen.length>0&&!moving&&<>
   <div className="plan-actions"><button type="button" className="btn primary" disabled={blocked||need>room} data-overdue-add onClick={()=>void run(onAdd(chosen),names())}>{busy?<Loader2 size={16} className="spin" aria-hidden/>:<Plus size={16} aria-hidden/>}{pair(addToPlanText(planDate,now),language)} ({chosen.length})</button>
    <button type="button" className="btn subtle" disabled={blocked} data-overdue-move-open onClick={()=>{setMoving(true);setReport(null);}}><CalendarClock size={16} aria-hidden/>{say('ترحيل إلى تاريخ…','Move to a date…')}</button></div>
   <p className={need>room?'plan-error':'plan-muted'}>{need>room?say(BULK_MESSAGES.room,'The plan has no room for every chosen follow-up; choose fewer or use «Move to a date…».'):say('يُنقل موعد المتابعات المحددة إلى يوم الخطة وتُضاف إليها.','The chosen follow-ups move to the plan\'s day and are added to it.')}</p>
  </>}
  {moving&&chosen.length>0&&<div className="plan-late-move" data-overdue-move>
   <b>{say('ترحيل المتابعات المحددة إلى تاريخ','Move the chosen follow-ups to a date')} ({chosen.length})</b>
   <FollowupDatePicker id="plan-bulk-date" label={say('التاريخ الجديد','The new date')} value={moveDate} onChange={setMoveDate} min={now} max={last} records={records as Row[]} customerId={chosen.length===1?chosen[0].customerId:undefined} moving={chosen.map(item=>item.customerId)} me={me} members={members as Member[]}/>
   <p className={tooFar?'plan-error':'plan-muted'} data-bulk-limit={last}>{say(BULK_MESSAGES.far,'Follow-ups can be moved up to 30 days from today only.')}</p>
   {moveDate===planDate&&<p className="plan-muted">{say('هذا يوم الخطة: تُضاف المتابعات إلى الخطة أيضًا.','This is the plan\'s day: the follow-ups are added to the plan too.')}</p>}
   <div className="plan-actions"><button type="button" className="btn primary" disabled={blocked||!planDay(moveDate)||moveDate<now||tooFar||moveDate===planDate&&need>room} data-overdue-move onClick={()=>void run(onMove(chosen,moveDate),names())}>{busy?<Loader2 size={16} className="spin" aria-hidden/>:<CalendarClock size={16} aria-hidden/>}{say('ترحيل','Move')} ({chosen.length})</button>
    <button type="button" className="btn subtle" disabled={busy} onClick={()=>setMoving(false)}>{say('إلغاء','Cancel')}</button></div>
  </div>}
  {report&&<div className={'plan-bulk-report'+(report.failures.length?' partial':'')} role="status" data-bulk-report={report.done+'/'+(report.done+report.failures.length)}>
   <b>{say('تغيّر الموعد','Date changed')}: {report.done} / {report.done+report.failures.length}</b>
   {report.failures.length>0&&<><span>{say('تعذر تغيير موعد هذه المتابعات:','These follow-ups could not be moved:')}</span><ul>{report.failures.map(failure=><li key={failure.id}><b>{failure.name||say('عميل غير متاح','Customer not available')}</b> — {t(failure.text)}</li>)}</ul></>}
  </div>}
 </div>;
}

// ---- reading a plan
/** The text of a stop's completion: «حذفها مدير المبيعات» for a stop the sales manager took out (GSCO 2.13.86). */
const completionText=(stop:Pick<PlanStopView,'completion'|'supervisorState'|'mark'>)=>stop.completion==='removed'&&stopMarkOf(stop)?.by==='manager'?MANAGER_STATE_TEXT.removed:STOP_COMPLETION_TEXT[stop.completion];
function StopsView({plan}:{plan:PlanView}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 if(!plan.stops.length)return null;
 return <ol className="plan-stops">{plan.stops.map(stop=>{const mark=stopMarkOf(stop);return <li key={stop.id} className={'plan-stop completion-'+stop.completion+(mark?.by==='manager'?' by-manager':'')} data-plan-stop={stop.position} data-plan-completion={stop.completion} data-plan-stop-by={mark?.by}>
  <span className="plan-number">{stop.position}</span>
  <div className="plan-stop-body">
   <p className="plan-stop-title"><strong>{stop.customerName||say('عميل غير متاح','Customer not available')}</strong><span className="plan-chip kind">{pair(STOP_KIND_TEXT[stop.kind],language)}</span>{stop.time&&<span className="plan-time"><Clock size={13} aria-hidden/><bdi>{stop.time}</bdi></span>}</p>
   {stop.note&&<p className="plan-stop-note">{stop.note}</p>}
   <p className="plan-stop-foot"><span className={'plan-chip completion '+stop.completion}>{pair(completionText(stop),language)}</span>{stop.doneAt&&<time dateTime={stop.doneAt} dir="auto">{stamp(stop.doneAt,language)}</time>}<StopMarkChip mark={mark} name={stop.editedByName}/></p>
  </div>
 </li>;})}</ol>;
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
  {plan.managerEdit&&<span className="plan-meta-manager" data-plan-manager-edit><Pencil size={14} aria-hidden/>{say('آخر تعديل من مدير المبيعات','Last change by the sales manager')}: {plan.managerEdit.byName} · <time dateTime={plan.managerEdit.at} dir="auto">{stamp(plan.managerEdit.at,language)}</time></span>}
 </div>;
}

/** A reviewer's decisions on a plan: «اعتماد», «اعتماد مع تعديل» (the editor), «إعادة للمندوب» with a reason, and the one note on the day. */
function ReviewActions({plan,names,onSaved}:{plan:PlanView;names:ReadonlyMap<string,string>;onSaved:(plan:PlanView)=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en),{post,busy}=usePlanPost();
 const [mode,setMode]=useState<'idle'|'edit'|'return'>('idle'),[stops,setStops]=useState<EditStop[]>([]),[reason,setReason]=useState(''),[note,setNote]=useState(plan.myNote?.note||''),[error,setError]=useState('');
 // The reviewer may change the targets in «اعتماد مع تعديل» (GSCO 2.13.85 decision d): the change is marked for the member.
 const [targets,setTargets]=useState<PlanTargets>(plan.targets),targetsChanged=targets.opportunities!==plan.targets.opportunities||targets.customers!==plan.targets.customers;
 const run=async(label:string,body:Record<string,unknown>,done:string)=>{setError('');try{const saved=await post(label,body);onSaved(saved);setMode('idle');toast.success(done);}catch(failure){setError(errorText(failure,say('تعذر الحفظ. أعد المحاولة.','Could not save. Try again.')));}};
 const base={memberId:plan.memberId,date:plan.date,baseVersion:plan.version};
 if(!plan.canApprove&&!plan.canReviewEdit&&!plan.canReturn&&!plan.canNote)return null;
 return <div className="plan-review" data-plan-review>
  {mode==='idle'&&(plan.canApprove||plan.canReviewEdit||plan.canReturn)&&<div className="plan-actions">
   {plan.canApprove&&<button type="button" className="btn primary" disabled={!!busy} data-plan-approve onClick={()=>void run('approve',{action:'approve',...base},say('اعتُمدت الخطة','The plan was approved'))}>{busy==='approve'?<Loader2 size={16} className="spin" aria-hidden/>:<CheckCheck size={16} aria-hidden/>}{say('اعتماد','Approve')}</button>}
   {plan.canReviewEdit&&<button type="button" className="btn subtle" disabled={!!busy} data-plan-edit onClick={()=>{setStops(fromView(plan.stops));setTargets(plan.targets);setMode('edit');setError('');}}><Pencil size={16} aria-hidden/>{say('اعتماد مع تعديل','Approve with edits')}</button>}
   {plan.canReturn&&<button type="button" className="btn subtle" disabled={!!busy} data-plan-return onClick={()=>{setReason('');setMode('return');setError('');}}><Undo2 size={16} aria-hidden/>{say('إعادة للمندوب','Return to the representative')}</button>}
  </div>}
  {mode==='edit'&&<div className="plan-review-edit"><p className="plan-muted" data-plan-edit-note={plan.salesManager?'manager':'supervisor'}>{plan.salesManager?say('تعديلاتك تُطبَّق فور الحفظ وتُعلَّم «عدّلها مدير المبيعات»، ولا يغيّرها المشرف ولا المندوب، ويصل تنبيه إلى المندوب ومشرفه.','Your edits apply when you save and are marked “Edited by the sales manager”; neither the supervisor nor the representative can change them, and the representative and their supervisor are notified.'):say('تعديلاتك تُطبَّق فور الاعتماد وتظهر للمندوب على أنها من المشرف، ولا يستطيع تغييرها أو حذفها.','Your edits apply when you approve and show to the representative as the supervisor\'s; they cannot change or delete them.')}</p>
   <StopsEditor stops={stops} onChange={setStops} names={names} mode="reviewer" disabled={!!busy} fixed={plan.salesManager?undefined:stop=>stop.mark?.by==='manager'}/>
   <TargetsCard targets={targets} repTargets={plan.repTargets} edited={plan.targetsEdited} editedBy={plan.targetsEditedBy} actual={null} editable={plan.salesManager||plan.targetsEditedBy!=='manager'} onChange={setTargets}/>
   <div className="plan-actions"><button type="button" className="btn primary" disabled={!!busy} data-plan-save-edit onClick={()=>{const problem=(targetsChanged?targetsProblem(targets,true):'')||stopsProblem(stops,targets,say);if(problem){setError(t(problem));return;}void run('edit',{action:'approve_edited',...base,stops:wireStops(stops),...(targetsChanged?{targets}:{})},say('اعتُمدت الخطة مع تعديلاتك','The plan was approved with your edits'));}}>{busy==='edit'?<Loader2 size={16} className="spin" aria-hidden/>:<CheckCheck size={16} aria-hidden/>}{say('اعتماد مع التعديلات','Approve with the edits')}</button><button type="button" className="btn subtle" disabled={!!busy} onClick={()=>{setMode('idle');setError('');}}>{say('إلغاء','Cancel')}</button></div></div>}
  {mode==='return'&&<div className="plan-review-return"><div data-plan-reason><VoiceField className="plan-voice" label={say('سبب الإعادة','Reason for returning')} marked multiline rows={3} value={reason} disabled={!!busy} contextKey={'plan-return-'+plan.memberId+plan.date} onChange={setReason} inputProps={{maxLength:PLAN_REASON_MAX}}/></div>
   <div className="plan-actions"><button type="button" className="btn primary" disabled={!!busy} data-plan-send-return onClick={()=>{if(reason.trim().length<PLAN_REASON_MIN){setError(say(`اكتب سبب الإعادة (${PLAN_REASON_MIN} أحرف على الأقل).`,`Write the reason (${PLAN_REASON_MIN} characters at least).`));return;}void run('return',{action:'return',...base,reason:reason.trim()},say('أُعيدت الخطة للمندوب','The plan was returned to the representative'));}}>{busy==='return'?<Loader2 size={16} className="spin" aria-hidden/>:<Undo2 size={16} aria-hidden/>}{say('إعادة للمندوب','Return to the representative')}</button><button type="button" className="btn subtle" disabled={!!busy} onClick={()=>{setMode('idle');setError('');}}>{say('إلغاء','Cancel')}</button></div></div>}
  {plan.canNote&&mode==='idle'&&<div className="plan-my-note"><div data-plan-note-input><VoiceField className="plan-voice" label={say('ملاحظتك على يوم المندوب','Your note on the representative\'s day')} multiline rows={2} value={note} disabled={!!busy} contextKey={'plan-note-'+plan.memberId+plan.date} onChange={setNote} inputProps={{maxLength:PLAN_NOTE_MAX}}/></div>
   <div className="plan-actions"><button type="button" className="btn subtle" disabled={!!busy||note.trim()===(plan.myNote?.note||'')} data-plan-note-save onClick={()=>{if(note.trim().length<PLAN_NOTE_MIN){setError(say('اكتب الملاحظة (حرفان على الأقل).','Write the note (two characters at least).'));return;}void run('note',{action:'note',memberId:plan.memberId,date:plan.date,note:note.trim(),noteVersion:plan.myNote?.version??null},say('حُفظت ملاحظتك','Your note was saved'));}}>{busy==='note'?<Loader2 size={16} className="spin" aria-hidden/>:<Save size={16} aria-hidden/>}{say('حفظ الملاحظة','Save the note')}</button>{plan.myNote&&<small className="plan-muted">{say('آخر حفظ','Last saved')} <time dateTime={plan.myNote.updatedAt} dir="auto">{stamp(plan.myNote.updatedAt,language)}</time></small>}</div></div>}
  {mode==='idle'&&plan.canReviewEdit&&!plan.canReturn&&plan.managerDecided&&!plan.salesManager&&<p className="plan-muted" data-plan-return-locked>{say('اعتمد مدير المبيعات هذه الخطة أو عدّلها أو أعادها؛ القرار له، ولا يمكن للمشرف إعادتها إلى المندوب.','The sales manager approved, edited or returned this plan; the decision is theirs, and the supervisor cannot return it to the representative.')}</p>}
  {error&&<p className="plan-error" role="alert"><AlertCircle size={15} aria-hidden/>{error}</p>}
 </div>;
}

/** What a reviewer reads above the plan since 2026-11-22 (GSCO 2.13.86): «غير معتمدة» once its day began without an approval; for a
 *  supervisor, that their window closed at midnight; for the sales manager, that they act until the plan's day ends. */
function ReviewWindow({plan}:{plan:PlanView}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en),now=today();
 if(plan.state==='missing'||plan.state==='draft'||plan.date<now)return null;
 const waiting=plan.state==='sent'||plan.state==='returned';
 if(!plan.reviewClosed)return null;
 if(plan.salesManager)return plan.canReviewEdit||plan.canApprove?<p className="plan-review-window manager" data-plan-window="manager">{say('بعد منتصف الليل يتصرف مدير المبيعات وحده في الخطة حتى نهاية يومها: تُعلَّم تعديلاتك «عدّلها مدير المبيعات» ويصل تنبيه إلى المندوب ومشرفه.','After midnight only the sales manager acts on the plan until its day ends: your edits are marked “Edited by the sales manager” and the representative and their supervisor are notified.')}</p>:null;
 return <p className="plan-review-window" data-plan-window="closed">{waiting?say('انتهت مهلة الاعتماد عند الساعة 12:00 منتصف الليل؛ تبقى الخطة «غير معتمدة»، ويتصرف فيها مدير المبيعات وحده حتى نهاية يومها.','The approval window closed at 12:00 midnight; the plan stays “Not approved”, and only the sales manager acts on it until its day ends.'):say('انتهت مهلة المشرف عند منتصف الليل؛ يعدّل الخطة مدير المبيعات وحده حتى نهاية يومها.','The supervisor\'s window closed at midnight; only the sales manager edits the plan until its day ends.')}</p>;
}

/** One plan as a reviewer reads it (the plans page and «تقرير يوم المندوب»): the state, the stops with what became of them, the visits and
 *  contacts outside it, the notes and the reviewer's actions. */
function PlanCard({plan,names,onSaved,heading}:{plan:PlanView;names:ReadonlyMap<string,string>;onSaved:(plan:PlanView)=>void;heading?:string}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en);
 return <article className={'plan-card state-'+plan.state} data-plan-card={plan.memberId+':'+plan.date}>
  <header><h3>{heading||say('خطة يوم','Plan of')+' '+dayLabel(plan.date,language)}</h3><PlanStateChip state={plan.state} late={plan.late} unapproved={plan.unapproved}/></header>
  <PlanMeta plan={plan}/>
  <ReviewWindow plan={plan}/>
  {plan.state==='missing'&&<p className="plan-missing" data-plan-missing>{isPlanWorkingDay(plan.date)?say('لم يُرسل المندوب خطة لهذا اليوم.','The representative sent no plan for this day.'):say('لم تُرسل خطة لهذا اليوم (ليس يوم عمل).','No plan was sent for this day (not a working day).')}</p>}
  {plan.state==='returned'&&plan.returnReason&&<p className="plan-return-reason" data-plan-return-reason><b>{say('سبب الإعادة','Reason for returning')}:</b> {plan.returnReason}</p>}
  <PlanSummary plan={plan}/>
  <TargetsLine plan={plan}/>
  <BulkMovesList moves={plan.bulkMoves}/>
  <StopsView plan={plan}/>
  <OutsideView plan={plan}/>
  <NotesView plan={plan}/>
  <ReviewActions key={plan.memberId+'|'+plan.date+'|'+plan.version+'|'+(plan.myNote?.version||0)} plan={plan} names={names} onSaved={onSaved}/>
 </article>;
}

const customerNames=(records:readonly Row[])=>new Map(records.filter(row=>row.kind==='customer').map(row=>[row.id,String(row.data.name||'')]));

// ---- the member: «خطة الغد»
const jobDate=(job:OfflineJob)=>{try{return String(JSON.parse(job.body||'{}').date||'');}catch{return '';}};
function MemberPlans({me,records,members,offline,initialDate,onRefresh,onMyPlan}:{me:Member;records:readonly Row[];members:readonly Member[];offline:boolean;initialDate?:string;onRefresh?:()=>Promise<void>;onMyPlan?:()=>void}){
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
  <p className="plan-intro">{say('رتّب متابعاتك ليوم العمل التالي (زيارة أو اتصال أو واتساب) وحدّد المستهدف، وأرسل الخطة للمشرف قبل الساعة 12:00 منتصف الليل الذي يبدأ به يوم الخطة؛ وما يعتمده المشرف قبل منتصف الليل يصير «معتمدة»، وإلا بقيت «غير معتمدة» وتنفّذها كما أرسلتها. الخطة لا تمنعك من تسجيل أي زيارة أو تواصل.','Arrange your follow-ups for the next working day (a visit, a call or WhatsApp), set the targets, and send the plan to your supervisor before 12:00 midnight, when the plan\'s day begins; what the supervisor approves before midnight is “Approved”, otherwise it stays “Not approved” and you carry it out as you sent it. The plan never stops you from recording any visit or contact.')}</p>
  <div className="plan-days" role="group" aria-label={say('يوم الخطة','Plan day')}>{days.map(day=><button type="button" key={day} className={'plan-day'+(day===date?' chosen':'')} aria-pressed={day===date} data-plan-day={day} onClick={()=>setDate(day)}><CalendarDays size={15} aria-hidden/>{day===now?say('اليوم','Today'):dayLabel(day,language)}</button>)}
   <label className="plan-field plan-date-field"><span>{say('يوم آخر','Another day')}</span><input type="date" value={date} min={addDays(now,-30)} max={addDays(now,PLAN_AHEAD_DAYS)} onChange={event=>{if(event.target.value)setDate(event.target.value);}}/></label></div>
  <article className={'plan-card own state-'+state} data-plan-card={me.id+':'+date}>
   <header><h3>{say('خطة يوم','Plan of')} {dayLabel(date,language)}</h3><PlanStateChip state={state} late={plan?.late} unapproved={!view.cached&&plan?.unapproved}/></header>
   {view.loading&&!plan&&<p className="plan-muted" role="status"><Loader2 size={15} className="spin" aria-hidden/>{say('جارٍ تحميل الخطة…','Loading the plan…')}</p>}
   {view.error&&<p className={view.cached?'plan-muted':'plan-error'} role={view.cached?'status':'alert'}>{view.cached?say('لا يوجد اتصال: تظهر آخر نسخة محفوظة على الجهاز.','No connection: the last copy kept on the device is shown.'):view.error}{!offline&&<button type="button" className="btn subtle small" onClick={view.reload}><RefreshCw size={14} aria-hidden/>{say('إعادة المحاولة','Try again')}</button>}</p>}
   {plan&&<PlanMeta plan={plan}/>}
   {plan?.state==='returned'&&<p className="plan-return-reason" data-plan-return-reason><b>{say('أعادها','Returned by')} {plan.reviewedByName}:</b> {plan.returnReason}</p>}
   {plan?.unapproved&&<p className="plan-alert-note" role="status" data-plan-unapproved-note>{say('لم يعتمد المشرف الخطة قبل منتصف الليل؛ تبقى خطتك كما أرسلتها، فنفّذها وسجّل متابعاتك كالمعتاد.','Your supervisor did not approve the plan before midnight; it stays as you sent it, so carry it out and record your follow-ups as usual.')}</p>}
   {plan?.managerEdit&&<p className="plan-manager-note" data-plan-manager-note><b>{say('عدّل مدير المبيعات هذه الخطة','The sales manager edited this plan')}{plan.managerEdit.byName?': '+plan.managerEdit.byName:''}</b> <span>{say('التعديلات معلَّمة على المحطات؛ لا يمكنك تغييرها.','The changes are marked on the stops; you cannot change them.')}</span></p>}
   {date===now&&plan&&plan.state!=='missing'&&plan.state!=='draft'&&onMyPlan&&<div className="plan-actions"><button type="button" className="btn subtle" data-plan-open-mine onClick={onMyPlan}><ListChecks size={16} aria-hidden/>{say('فتح «خطتي» لتنفيذ الخطة','Open “My plan” to carry out the plan')}</button></div>}
   {jobs.map(job=><p key={job.id} className={job.status==='blocked'?'plan-error':'plan-queued'} data-plan-queued={job.status} role={job.status==='blocked'?'alert':'status'}>{job.status==='blocked'?<>{say('لم تُرسل الخطة المحفوظة على الجهاز:','The plan kept on the device was not sent:')} {t(job.message)}</>:<>{say('الخطة محفوظة على الجهاز بانتظار الاتصال، بوقت','The plan is kept on the device waiting for the connection, with the time')} <time dateTime={job.capturedAt} dir="auto">{stamp(job.capturedAt,language)}</time></>}</p>)}
   {(!view.loading||plan)&&<MemberPlanForm key={date+'|'+(plan?.version??'none')+'|'+(view.cached?'device':'server')} me={me} members={members} date={date} plan={plan} records={records} offline={offline} onPlan={view.setPlan} onRefresh={onRefresh}/>}
   {plan&&<NotesView plan={{...plan,myNote:null}}/>}
  </article>
 </section>;
}
/** The member's own plan of one day: the editor while they may change it (kept on the device as they type, restored while it was made on
 *  the version the server still has), or the plan as it is with what became of each stop. Since 2026-11-22 (GSCO 2.13.85) the stops are the
 *  member's follow-ups only: those due on the plan's day with one tap («إضافة متابعات الغد»), the late ones chosen from «المتابعات
 *  المتأخرة» (moved to the plan's day, or moved to another date with «ترحيل إلى تاريخ…»), each with «تغيير الموعد»; and the day's targets. */
function MemberPlanForm({me,members,date,plan,records,offline,onPlan,onRefresh}:{me:Member;members:readonly Member[];date:string;plan:PlanView|null;records:readonly Row[];offline:boolean;onPlan:(plan:PlanView)=>void;onRefresh?:()=>Promise<void>}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en),now=today();
 const names=useMemo(()=>customerNames(records),[records]);
 const restored=useMemo(()=>{
  let draft:unknown=null;try{draft=JSON.parse(stored(draftKey(me.id,date))||'null');}catch{draft=null;}
  return validDraft(draft)&&draft.baseVersion===(plan?.version??null)?{stops:draft.stops,targets:draftTargets(draft.targets)}:null;
 // eslint-disable-next-line react-hooks/exhaustive-deps -- read once for this day and version (the parent's key)
 },[]);
 const [stops,setStops]=useState<EditStop[]>(()=>restored?.stops||(plan?fromView(plan.stops):[]));
 // The targets: once a reviewer changed them they are theirs, and the member's unsaved values give way (GSCO 2.13.85 review A6).
 const [typedTargets,setTypedTargets]=useState<PlanTargets>(()=>restored?.targets||plan?.targets||NO_TARGETS);
 const targets=plan?.targetsEdited?plan.targets:typedTargets;
 const [editing,setEditing]=useState(!!restored),[busy,setBusy]=useState(''),[error,setError]=useState(''),[openedAt]=useState(()=>Date.now()),[picking,setPicking]=useState(false);
 const request=useRef<{id:string;payload:string}|null>(null);
 useEffect(()=>{if(!restored)store(draftKey(me.id,date),null);},[restored,me.id,date]);
 const editable=plan?plan.canEdit:can(me,'plans','add')&&planDateProblem(date,now)===null;
 const draftOnly=!plan||plan.state==='missing'||plan.state==='draft',removed=plan?.stops.filter(stop=>stop.supervisorState==='removed')||[];
 const keep=(next:{stops?:EditStop[];targets?:PlanTargets})=>{const value={baseVersion:plan?.version??null,stops:next.stops??stops,targets:next.targets??targets,savedAt:new Date().toISOString()};store(draftKey(me.id,date),JSON.stringify(value));};
 const change=(next:EditStop[])=>{setStops(next);setEditing(true);setError('');keep({stops:next});};
 const changeTargets=(next:PlanTargets)=>{setTypedTargets(next);setEditing(true);setError('');keep({targets:next});};
 // The member's follow-ups (lib/daily-plan-followups.ts): due on the plan's day, and late; one stop per customer, at most PLAN_MAX_STOPS.
 const followups=useMemo(()=>memberFollowups(records as Row[],me.id,today()),[records,me.id]);
 const byCustomer=useMemo(()=>new Map(followups.map(item=>[item.customerId,item])),[followups]);
 const inPlan=new Set(stops.map(stop=>stop.customerId)),room=Math.max(0,PLAN_MAX_STOPS-stops.length);
 // A follow-up a reviewer took out of the plan is not offered again (GSCO 2.13.86 review A1: the server refuses it as a new stop).
 const blocked=new Set(removed.map(stop=>stop.customerId));
 const overdueAll=useMemo(()=>overdueFollowups(followups,date,today()),[followups,date]);
 const due=followupsDueOn(followups,date).filter(item=>!inPlan.has(item.customerId)&&!blocked.has(item.customerId)),overdue=overdueAll.filter(item=>!blocked.has(item.customerId));
 const {move,busy:moving}=useNextDates({date,offline,onRefresh});
 const addStops=(list:readonly PlanFollowup[])=>{if(list.length)change([...stops,...list.map(followupStop)]);};
 const addDue=()=>{const list=stopsToAdd(due,inPlan,room);if(!list.length){toast.error(say('وصلت الخطة إلى الحد الأعلى للمحطات.','The plan has reached its most stops.'));return;}addStops(list);toast.success(say('أُضيفت المتابعات المستحقة إلى الخطة','The due follow-ups were added to the plan')+' ('+list.length+')');};
 const addFromList=async(chosen:readonly PlanFollowup[])=>{
  if(stopsNeeded(chosen,inPlan)>room){toast.error(say(BULK_MESSAGES.room,'The plan has no room for every chosen follow-up; choose fewer or use «Move to a date…».'));return null;}
  const results=await move(chosen,date,'plan');if(!results)return null;
  const done=new Set(bulkSummary(results).doneIds);addStops(stopsToAdd(chosen.filter(item=>done.has(item.id)),inPlan,room));
  return results;
 };
 const moveFromList=async(chosen:readonly PlanFollowup[],next:string)=>{
  if(next===date&&stopsNeeded(chosen,inPlan)>room){toast.error(say(BULK_MESSAGES.room,'The plan has no room for every chosen follow-up; choose fewer or use «Move to a date…».'));return null;}
  const results=await move(chosen,next,'reschedule');if(!results)return null;
  if(next===date){const done=new Set(bulkSummary(results).doneIds);addStops(stopsToAdd(chosen.filter(item=>done.has(item.id)),inPlan,room));}
  return results;
 };
 /** «تغيير الموعد» of one stop's follow-up: another day than the plan's takes the stop out of the plan. */
 const reschedule=async(item:PlanFollowup,next:string)=>{
  const results=await move([item],next,'reschedule');if(!results)return false;
  const summary=bulkSummary(results);
  if(!summary.done){setError(t(summary.failures[0]?.text||say('تعذر الحفظ. أعد المحاولة.','Could not save. Try again.')));return false;}
  if(next!==date){change(stops.filter(stop=>stop.customerId!==item.customerId));toast.success(say('نُقل موعد المتابعة وخرجت المحطة من الخطة؛ احفظ الخطة أو أرسلها.','The follow-up\'s date was moved and the stop left the plan; save or send the plan.'));}
  else toast.success(say('حُفظ موعد المتابعة','The follow-up date was saved'));
  return true;
 };
 const keyOf=(body:Record<string,unknown>)=>{const payload=JSON.stringify(body);if(request.current?.payload!==payload)request.current={id:crypto.randomUUID(),payload};return request.current.id;};
 const send=async()=>{
  const problem=targetsProblem(targets,true)||stopsProblem(stops,targets,say);if(problem){setError(t(problem));return;}
  const body={action:'send',date,stops:wireStops(stops),baseVersion:plan?.version??null,targets};
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
  const problem=targetsProblem(targets,false);if(problem){setError(t(problem));return;}
  if(offline){keep({});toast.info(say('حُفظت المسودة على هذا الجهاز.','The draft is kept on this device.'));return;}
  const body={action:'save',date,stops:wireStops(stops.filter(stop=>stop.customerId)),baseVersion:plan?.version??null,targets};
  setBusy('save');setError('');
  try{
   const answer=await submitJson<{plan:unknown}>('/api/daily-plans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,requestId:keyOf(body)})},{language});
   request.current=null;
   if(validPlanView(answer.plan)){store(draftKey(me.id,date),null);setEditing(false);onPlan(answer.plan);toast.success(say('حُفظت المسودة','The draft was saved'));}
  }catch(failure){setError(errorText(failure,say('تعذر حفظ المسودة. أعد المحاولة.','Could not save the draft. Try again.')));}
  finally{setBusy('');}
 };
 const rescheduleOf=(stop:EditStop)=>{const item=byCustomer.get(stop.customerId);return item?<RescheduleStop item={item} planDate={date} me={me} members={members} records={records} offline={offline} busy={moving} onSave={reschedule}/>:null;};
 return <>
  {!plan?.firstSentAt&&<p className="plan-deadline" data-plan-deadline><Clock size={15} aria-hidden/>{say('آخر موعد للإرسال','Send deadline')}: <DeadlineMoment date={date} deadline={planDeadline(date)} language={language}/>{openedAt>=Date.parse(planDeadline(date))?' · '+say('ما يُرسل الآن يُقبل ويُعلَّم «متأخرة».','Sent now, it is accepted and marked late.'):''}</p>}
  {editable?<>
   {plan&&!draftOnly&&!editing&&<><PlanSummary plan={plan}/><TargetsLine plan={plan}/><StopsView plan={plan}/><div className="plan-actions"><button type="button" className="btn subtle" data-plan-member-edit onClick={()=>setEditing(true)}><Pencil size={16} aria-hidden/>{say('تعديل الخطة','Edit the plan')}</button></div></>}
   {(draftOnly||editing)&&<><StopsEditor stops={stops} onChange={change} names={names} mode="member" disabled={!!busy||moving} reschedule={rescheduleOf}/>
    <div className="plan-add" data-plan-add>
     <button type="button" className="btn subtle" disabled={!!busy||!due.length||!room} data-plan-due={due.length} onClick={addDue}><CalendarCheck size={16} aria-hidden/>{pair(dueButtonText(date,now),language)} ({due.length})</button>
     <button type="button" className={'btn '+(picking?'primary':'subtle')} disabled={!overdue.length} aria-expanded={picking} data-plan-overdue-count={overdue.length} onClick={()=>setPicking(value=>!value)}><ListChecks size={16} aria-hidden/>{say('المتابعات المتأخرة','Late follow-ups')} ({overdue.length})</button>
    </div>
    {picking&&overdue.length>0&&<OverduePicker key={date} items={overdue} planDate={date} inPlan={inPlan} room={room} offline={offline} busy={moving} me={me} members={members} records={records} onAdd={addFromList} onMove={moveFromList} onClose={()=>setPicking(false)}/>}
    <TargetsCard key={(plan?.version??'none')+':'+(plan?.targetsEdited?'edited':'own')} targets={targets} repTargets={plan?.repTargets||null} edited={!!plan?.targetsEdited} editedBy={plan?.targetsEditedBy} actual={date<=now?plan?.actual:null} editable={!plan?.targetsEdited} onChange={changeTargets}/>
    {removed.length>0&&<p className="plan-muted" data-plan-removed>{removed.map(stop=>pair(completionText(stop),language)+': '+(stop.customerName||say('عميل غير متاح','Customer not available'))).join(say('، ',', '))}</p>}
    <div className="plan-actions sticky">
     <button type="button" className="btn primary" disabled={!!busy||moving||!stops.length&&!hasTarget(targets)} data-plan-send onClick={()=>void send()}>{busy==='send'?<Loader2 size={16} className="spin" aria-hidden/>:<Send size={16} aria-hidden/>}{draftOnly?say('إرسال للمشرف','Send to the supervisor'):say('إرسال التعديل للمشرف','Send the change to the supervisor')}</button>
     {draftOnly&&<button type="button" className="btn subtle" disabled={!!busy||moving} data-plan-save-draft onClick={()=>void saveDraft()}>{busy==='save'?<Loader2 size={16} className="spin" aria-hidden/>:<Save size={16} aria-hidden/>}{say('حفظ مسودة','Save a draft')}</button>}
     {editing&&plan&&!draftOnly&&<button type="button" className="btn subtle" disabled={!!busy} onClick={()=>{store(draftKey(me.id,date),null);setStops(fromView(plan.stops));setTypedTargets(plan.targets);setEditing(false);setError('');}}>{say('إلغاء التعديل','Cancel the change')}</button>}
    </div></>}
  </>:plan&&<><PlanSummary plan={plan}/><TargetsLine plan={plan}/><StopsView plan={plan}/><OutsideView plan={plan}/>{plan.state!=='missing'&&!memberMayEdit(plan.status)&&<p className="plan-muted">{say('الخطة معتمدة. إذا احتجت إلى تعديلها فاطلب من المشرف إعادتها إليك.','The plan is approved. If you need to change it, ask your supervisor to return it to you.')}</p>}{plan.state==='missing'&&<p className="plan-muted">{say('لا خطة لهذا اليوم.','No plan for this day.')}</p>}</>}
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
 // A plan «غير معتمدة» (its day begun without an approval) no longer waits (GSCO 2.13.86).
 const waiting=list?.rows.filter(row=>row.state==='sent'&&!row.unapproved).length||0;
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
     <PlanStateChip state={row.state} late={row.late} unapproved={row.unapproved}/>
     {row.state!=='missing'&&<span className="plan-row-counts">{row.counts.done+row.counts.doneOther}/{row.counts.stops}</span>}
     {row.targets&&(row.targets.opportunities!==null||row.targets.customers!==null)&&<small className="plan-row-targets" data-row-targets>{pair(TARGET_TEXT.opportunities.short,language)} {targetFigure(row.targets.opportunities,row.actual?.opportunities)} · {pair(TARGET_TEXT.customers.short,language)} {targetFigure(row.targets.customers,row.actual?.customers)}{row.targetsEdited?' · '+pair(targetsEditedText(row.targetsEditedBy),language):''}</small>}
     {row.managerEdited&&<small className="plan-row-manager" data-row-manager><Pencil size={13} aria-hidden/>{say('عدّلها مدير المبيعات','Edited by the sales manager')}</small>}
     {!!row.bulkMoves&&<small className="plan-row-bulk" data-row-bulk={row.bulkMoves}><CalendarClock size={13} aria-hidden/>{bulkMovesTitle(row.bulkMoves,language==='en'?'en':'ar')}</small>}
    </button></li>)}</ul>}
   </div>
   <div className="plan-detail-wrap">{memberId?<PlanDetail key={memberId+':'+date} me={me} memberId={memberId} date={date} records={records} members={members} onSaved={()=>setRevision(value=>value+1)}/>:<p className="plan-muted plan-pick-hint">{say('اختر مندوبًا لعرض خطته.','Choose a representative to see their plan.')}</p>}</div>
  </div>}
 </section>;
}
function PlanDetail({me,memberId,date,records,members,onSaved,heading}:{me:Member;memberId:string;date:string;records:readonly Row[];members:readonly Member[];onSaved?:()=>void;heading?:string}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>selectText(language,ar,en),view=usePlanView(memberId,date,false);
 const names=useMemo(()=>customerNames(records),[records]);void members;
 void me;
 if(view.loading&&!view.plan)return <p className="plan-muted" role="status"><Loader2 size={15} className="spin" aria-hidden/>{say('جارٍ تحميل الخطة…','Loading the plan…')}</p>;
 if(!view.plan)return view.error?<p className="plan-error" role="alert"><AlertCircle size={15} aria-hidden/>{view.error}<button type="button" className="btn subtle small" onClick={view.reload}>{say('إعادة المحاولة','Try again')}</button></p>:null;
 return <PlanCard plan={view.plan} names={names} heading={heading||(view.plan.memberName+' · '+dayLabel(view.plan.date,language))} onSaved={plan=>{view.setPlan(plan);onSaved?.();}}/>;
}

/** The page «خطط المناديب» («خطة الغد» for a member who prepares plans). */
export default function DailyPlansPage({me,records,members,offline,initialDate,initialMemberId,onRefresh,onMyPlan}:{me:Member;records:readonly Row[];members:readonly Member[];offline:boolean;initialDate?:string;initialMemberId?:string;onRefresh?:()=>Promise<void>;/** opens «خطتي» (GSCO 2.13.86) */onMyPlan?:()=>void}){
 if(!pageAllowed(me,'plans'))return null;
 return isFieldRole(me.role)?<MemberPlans key={me.id+':'+(me.authVersion||0)} me={me} records={records} members={members} offline={offline} initialDate={initialDate} onRefresh={onRefresh} onMyPlan={onMyPlan}/>:reviewsPlans(me)?<ReviewerPlans key={me.id+':'+(me.authVersion||0)} me={me} records={records} members={members} initialDate={initialDate} initialMemberId={initialMemberId}/>:null;
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
  // GSCO 2.13.86: the supervisor's reminder at 23:00, and a change by the sales manager.
  case 'closing':return {title:say('تنتهي مهلة اعتماد الخطط عند منتصف الليل','The approval window closes at midnight'),body:say(`خطط تنتظر اعتمادك: ${line.count||0} (خطة يوم ${day}). بعد الساعة 12:00 منتصف الليل تبقى «غير معتمدة».`,`Plans waiting for your approval: ${line.count||0} (the plan of ${day}). After 12:00 midnight they stay “Not approved”.`)};
  case 'manager':{const edit=(inbox.edits||[]).filter(item=>item.date===line.date&&(!line.memberId||item.memberId===line.memberId)).at(-1);
   return inbox.role==='member'?{title:say('عدّل مدير المبيعات خطتك','The sales manager edited your plan'),body:say(`خطة يوم ${day}`,`The plan of ${day}`)+(edit?.byName?' · '+edit.byName:'')+say(' — راجع التعديلات المعلَّمة.',' — review the marked changes.')}
    :{title:say('عدّل مدير المبيعات خطة ','The sales manager changed the plan of ')+(edit?.name||''),body:say(`خطة يوم ${day}`,`The plan of ${day}`)+(edit?.byName?' · '+edit.byName:'')+say(' — راجع التعديلات المعلَّمة.',' — review the marked changes.')};}
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
 // An approval and a change by the sales manager are told once (the toast and the device's notice) and marked on the plan; the card keeps what
 // waits for the reader.
 const lines=planReminderLines(inbox).filter(line=>line.tone!=='approved'&&line.tone!=='manager');
 if(!applies||quiet||!inbox||!lines.length)return null;
 const allow=async()=>{try{setPermission(await Notification.requestPermission() as 'default'|'granted'|'denied');}catch{setPermission('denied');}};
 const title=inbox.role==='member'?say('خطة يوم العمل','The working day\'s plan'):say('خطط المناديب','Representatives\' plans');
 return <section className={'plan-inbox no-print'+(lines.some(line=>line.tone==='late'||line.tone==='missing'||line.tone==='closing')?' urgent':'')} aria-label={title} data-plan-inbox={inbox.role}>
  <header><h2><CalendarCheck size={19} aria-hidden/>{title}</h2>{permission==='default'&&<button type="button" className="btn subtle small" data-plan-notify onClick={()=>{void allow();}}><BellRing size={16} aria-hidden/>{say('تنبيهي على هذا الجهاز','Notify me on this device')}</button>}</header>
  <ol>{lines.slice(0,6).map(line=>{const words=lineText(line,inbox,language);return <li key={line.key} data-plan-inbox-line={line.tone}><div><strong>{words.title}</strong><p>{words.body}</p></div><button type="button" className="btn primary small" onClick={()=>onOpen(line.date,line.memberId)}>{line.tone==='pending'||line.tone==='closing'?<><ClipboardCheck size={15} aria-hidden/>{say('مراجعة','Review')}</>:line.tone==='missing'?<><Users size={15} aria-hidden/>{say('عرض الخطط','See the plans')}</>:<><Pencil size={15} aria-hidden/>{say('فتح الخطة','Open the plan')}</>}</button></li>;})}</ol>
  {lines.length>6&&<p className="plan-muted">{say(`وخطط أخرى: ${lines.length-6}`,`And other plans: ${lines.length-6}`)}</p>}
 </section>;
}
