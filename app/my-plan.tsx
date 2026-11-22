'use client';
import {useEffect,useMemo,useState} from 'react';
import {AlertCircle,CalendarPlus,CheckCircle2,ChevronLeft,ChevronRight,CloudUpload,ListChecks,Loader2,MessageCircle,Phone,RefreshCw,Target,UserRound} from 'lucide-react';
import {toast} from 'sonner';
import {useLanguage} from '@/lib/i18n';
import {pageAllowed} from '@/lib/permissions';
import type {Member,Row} from '@/lib/crm';
import {PLAN_LATE_TEXT,STOP_KIND_TEXT,isPlanWorkingDay,riyadhDayOf,type PlanStopView,type StopKind} from '@/lib/daily-plans';
import {TARGET_KEYS,TARGET_TEXT,targetLine} from '@/lib/daily-plan-followups';
import {TAP_HINT,msToRiyadhMidnight,myPlanBanner,myPlanStops,queuedToday,stopDoneText,stopTap} from '@/lib/my-plan';
import {StopMarkChip,dayLabel,stopMarkOf,usePlanView} from './daily-plans';
import './daily-plans.css';
import './my-plan.css';

/** «خطتي» (2026-11-22, the port of GSCO 2.13.86; lib/my-plan.ts): a field member's plan of today in its order, its state on top, each stop a
 * button that opens the follow-up form of its customer (app/crm-app.tsx openFollowup, the checks of «المتابعات»), a done one the customer,
 * one whose customer is gone a message; the day's targets beside what was achieved under it. It reads GET /api/daily-plans like «خطة الغد»
 * and keeps the answer on the device (usePlanView), so it opens without a network; at midnight in Riyadh it turns to the new day's plan
 * (useRiyadhToday), never yesterday's. «المتابعات» is unchanged. TodayPlanCard is the home card «خطة اليوم» that opens it. */

type Words=readonly [string,string];
const pair=(words:Words,language:string)=>language==='en'?words[1]:words[0];

/** Today in Riyadh, turned at midnight (a timer to the next midnight, checked again when the page comes back to the front). */
export function useRiyadhToday(){
 const [today,setToday]=useState(()=>riyadhDayOf(Date.now()));
 useEffect(()=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const check=()=>setToday(riyadhDayOf(Date.now()));
  const arm=()=>{if(timer!==undefined)clearTimeout(timer);timer=setTimeout(()=>{check();arm();},msToRiyadhMidnight(Date.now()));};
  const again=()=>{if(document.visibilityState==='visible'){check();arm();}};
  arm();
  document.addEventListener('visibilitychange',again);window.addEventListener('focus',again);
  return()=>{if(timer!==undefined)clearTimeout(timer);document.removeEventListener('visibilitychange',again);window.removeEventListener('focus',again);};
 },[]);
 return today;
}

const KindIcon=({kind}:{kind:StopKind})=>kind==='call'?<Phone size={15} aria-hidden/>:kind==='whatsapp'?<MessageCircle size={15} aria-hidden/>:<UserRound size={15} aria-hidden/>;

export default function MyPlanPage({me,records,offline,onFollowup,onCustomer,onTomorrow}:{me:Member;records:readonly Row[];offline:boolean;onFollowup:(customerId:string)=>void;onCustomer:(customerId:string)=>void;onTomorrow:()=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar;
 const today=useRiyadhToday(),view=usePlanView(me.id,today,true);
 // The answer of another day never shows (a page left open over midnight waits for today's).
 const plan=view.plan&&view.plan.date===today?view.plan:null;
 const customerIds=useMemo(()=>new Set(records.filter(row=>row.kind==='customer').map(row=>row.id)),[records]);
 const [notice,setNotice]=useState<{id:string;text:string}|null>(null);
 if(!pageAllowed(me,'my-plan'))return null;
 const Arrow=language==='en'?ChevronRight:ChevronLeft;
 const head=<header className="my-plan-head">
  <div><h2><ListChecks size={20} aria-hidden/>{say('خطة اليوم','Today\'s plan')}</h2><small>{dayLabel(today,language)}</small></div>
  <button type="button" className="btn subtle small" disabled={view.loading||offline} onClick={view.reload} aria-label={say('تحديث الخطة','Refresh the plan')}><RefreshCw size={15} className={view.loading?'spin':''} aria-hidden/>{say('تحديث','Refresh')}</button>
 </header>;
 if(view.loading&&!plan)return <section className="my-plan" data-my-plan="loading">
  <div className="my-plan-banner">{head}<p className="plan-muted" role="status"><Loader2 size={15} className="spin" aria-hidden/>{say('جارٍ تحميل الخطة…','Loading the plan…')}</p></div>
 </section>;
 const banner=myPlanBanner(plan,today),stops=myPlanStops(plan);
 const open=(stop:PlanStopView)=>{
  const tap=stopTap(stop,customerIds);setNotice(null);
  if(tap.kind==='followup'){onFollowup(tap.customerId);return;}
  if(tap.kind==='customer'){onCustomer(tap.customerId);return;}
  const text=pair(tap.message,language);setNotice({id:stop.id,text});toast.error(text);
 };
 return <section className="my-plan" data-my-plan={banner.key} aria-label={say('خطتي','My plan')}>
  <div className={'my-plan-banner tone-'+banner.tone}>{head}
   <p className="plan-chips"><span className={'plan-chip my-plan-status tone-'+banner.tone} data-my-plan-status={banner.key}>{pair(banner.text,language)}</span>{banner.late&&<span className="plan-chip late" data-plan-late>{pair(PLAN_LATE_TEXT,language)}</span>}{view.cached&&<span className="plan-chip" data-my-plan-cached>{say('آخر نسخة محفوظة على الجهاز','The last copy kept on the device')}</span>}</p>
   <p className="my-plan-note">{pair(banner.note,language)}</p>
   {view.error&&!view.cached&&<p className="plan-error" role="alert" data-my-plan-error><AlertCircle size={15} aria-hidden/>{view.error}</p>}
   {plan?.state==='returned'&&plan.returnReason&&<p className="plan-return-reason"><b>{say('سبب الإعادة','Reason for returning')}:</b> {plan.returnReason}</p>}
   {plan?.managerEdit&&<p className="plan-manager-note" data-my-plan-manager><b>{say('عدّل مدير المبيعات هذه الخطة','The sales manager edited this plan')}{plan.managerEdit.byName?': '+plan.managerEdit.byName:''}</b> <span>{say('التعديلات معلَّمة على المحطات.','The changes are marked on the stops.')}</span></p>}
   {!plan&&<div className="plan-actions"><button type="button" className="btn primary" data-my-plan-tomorrow onClick={onTomorrow}><CalendarPlus size={16} aria-hidden/>{say('إعداد خطة الغد','Prepare tomorrow\'s plan')}</button></div>}
  </div>
  {plan&&<>
   <div className="my-plan-section" aria-label={say('محطات الخطة','The plan\'s stops')}>
    <h3>{say('محطات الخطة','The plan\'s stops')} <span className="plan-count">{stops.length}</span></h3>
    {stops.length?<ol className="my-plan-stops">{stops.map((stop,index)=>{
     const tap=stopTap(stop,customerIds),queued=stop.completion==='open'&&queuedToday(stop.customerId,records,today),done=stop.completion==='done'||stop.completion==='done_other';
     return <li key={stop.id} className={'my-plan-stop completion-'+stop.completion} data-my-plan-stop={stop.position}>
      <button type="button" className="my-plan-stop-main" data-my-stop-tap={tap.kind} onClick={()=>open(stop)}>
       <span className="plan-number">{index+1}</span>
       <span className="my-plan-stop-body">
        <strong>{stop.customerName||say('عميل غير متاح','Customer not available')}</strong>
        <span className="my-plan-stop-what"><KindIcon kind={stop.kind}/>{pair(STOP_KIND_TEXT[stop.kind],language)}{stop.time?<> · <bdi>{stop.time}</bdi></>:null}</span>
        {stop.note&&<small className="my-plan-stop-note">{stop.note}</small>}
        <span className="my-plan-stop-badges">
         <span className={'plan-chip completion '+stop.completion} data-my-stop-state={stop.completion}>{done&&<CheckCircle2 size={13} aria-hidden/>}{pair(stopDoneText(stop.completion),language)}</span>
         {queued&&<span className="plan-chip queued" data-my-stop-queued><CloudUpload size={13} aria-hidden/>{say('سُجّلت على الجهاز','Saved on this device')}</span>}
         <StopMarkChip mark={stopMarkOf(stop)}/>
        </span>
       </span>
       <span className="my-plan-stop-go">{pair(TAP_HINT[tap.kind],language)}<Arrow size={16} aria-hidden/></span>
      </button>
      {notice?.id===stop.id&&<p className="plan-error" role="alert" data-my-stop-gone><AlertCircle size={15} aria-hidden/>{notice.text}</p>}
     </li>;})}</ol>:<p className="plan-muted">{say('لا توجد متابعات في هذه الخطة؛ المستهدف وحده.','This plan has no follow-ups; the targets alone.')}</p>}
   </div>
   <div className="my-plan-section my-plan-targets" data-my-plan-targets>
    <h3><Target size={17} aria-hidden/>{say('المستهدف في يوم الخطة','The plan day\'s targets')}</h3>
    {TARGET_KEYS.map(key=><p key={key} data-my-target={key}><b>{pair(TARGET_TEXT[key].short,language)}:</b> {targetLine(plan.targets[key],plan.actual?.[key],language==='en'?'en':'ar')}</p>)}
   </div>
   <div className="plan-actions my-plan-actions">
    <button type="button" className="btn subtle" data-my-plan-tomorrow onClick={onTomorrow}><CalendarPlus size={16} aria-hidden/>{say('خطة الغد','Tomorrow\'s plan')}</button>
    {offline&&<p className="plan-muted">{say('بدون اتصال: تُحفظ المتابعة على الجهاز بتاريخ اليوم وتُرسل عند عودة الشبكة.','Offline: the follow-up is kept on this device with today\'s date and sent when the connection returns.')}</p>}
   </div>
  </>}
 </section>;
}

/** «خطة اليوم» on the member's home: today's plan in a line (its state, how many stops are done, «متأخرة», an edit by the sales manager) that
 *  opens «خطتي». Nothing on a day off without a plan. */
export function TodayPlanCard({me,onOpen}:{me:Member;onOpen:()=>void}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar;
 const today=useRiyadhToday(),view=usePlanView(me.id,today,true),plan=view.plan&&view.plan.date===today?view.plan:null;
 if(!pageAllowed(me,'my-plan')||!plan&&!isPlanWorkingDay(today))return null;
 const Arrow=language==='en'?ChevronRight:ChevronLeft,banner=myPlanBanner(plan,today),stops=myPlanStops(plan);
 const done=stops.filter(stop=>stop.completion==='done'||stop.completion==='done_other').length;
 return <button type="button" className={'my-plan-home no-print tone-'+banner.tone} data-my-plan-home={view.loading&&!plan?'loading':banner.key} onClick={onOpen}>
  <ListChecks size={20} aria-hidden/>
  <span className="my-plan-home-text">
   <strong>{say('خطة اليوم','Today\'s plan')}: <b>{view.loading&&!plan?say('جارٍ التحميل…','Loading…'):pair(banner.text,language)}</b>{banner.late&&<span className="plan-chip late">{pair(PLAN_LATE_TEXT,language)}</span>}</strong>
   {plan&&<small>{stops.length?say(`تمت ${done} من ${stops.length}`,`${done} of ${stops.length} done`):say('المستهدف وحده','The targets alone')}{plan.managerEdit?' · '+say('عدّلها مدير المبيعات — راجعها','Edited by the sales manager — review it'):banner.key==='unapproved'?' · '+say('لم يعتمدها المشرف قبل منتصف الليل','Not approved by your supervisor before midnight'):''}</small>}
  </span>
  <span className="my-plan-home-open">{say('افتح خطتي','Open My plan')}<Arrow size={16} aria-hidden/></span>
 </button>;
}
