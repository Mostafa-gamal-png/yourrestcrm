'use client';
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Clock3,Flag,MessageSquareWarning,Route,Sparkles} from 'lucide-react';
import {t,useLanguage,getLanguage} from '@/lib/i18n';
import {submitJson} from '@/lib/client-submit';
import type {Member,Row} from '@/lib/crm';
import {closureOutcomes,closureOutcomesEn,complaintCategories,complaintCategoriesEn,type ComplaintEntry} from '@/lib/complaints';
import {filterTracking,trackingCounts,trackingFilterLabels,trackingFilters,trackingHolderLabels,trackingItems,trackingOpportunityOutcomes,trackingStageText,trackingStepLabels,type TrackedCase,type TrackingFilter,type TrackingItem} from '@/lib/service-tracking';
import {hoursText} from './service-queue';
import './service-tracking.css';

type Say=(ar:string,en:string)=>string;
/** The board shows this many cards until the member asks for the rest. */
export const TRACKING_VISIBLE=6;
const stamp=(iso:string)=>iso?new Date(iso).toLocaleDateString('en-GB',{timeZone:'Asia/Riyadh'}):'—';
const clip=(text:string,length:number)=>text.length>length?text.slice(0,length).trimEnd()+'…':text;
const pair=(table:Record<string,[string,string]>,key:string,say:Say)=>{const found=table[key];return found?say(found[0],found[1]):key;};

/** The opportunities customer service handed to sales, loaded beside the page for the board and refreshed with it and every ten minutes. */
export function useServiceTracking({me,records}:{me:Member|null;records:Row[]}){
 const enabled=!!me&&(me.role==='customer_service'||me.role==='customer_service_manager');
 const identity=enabled&&me?[me.id,me.role,me.authVersion,me.regionScope,me.branch].join(':'):'';
 const [loaded,setLoaded]=useState<{identity:string;cases:TrackedCase[]}|null>(null),generation=useRef(0);
 // What was loaded for another account, or before signing out, is never shown.
 const cases=loaded&&loaded.identity===identity?loaded.cases:null;
 const refresh=useCallback(async()=>{
  if(!identity||typeof navigator!=='undefined'&&navigator.onLine===false)return;
  const current=++generation.current;
  try{const next=await submitJson<{cases:TrackedCase[]}>('/api/customer-service?scope=board',{cache:'no-store'},{language:getLanguage()});if(current===generation.current)setLoaded({identity,cases:Array.isArray(next.cases)?next.cases:[]});}catch{/* the board keeps what it last had */}
 },[identity]);
 useEffect(()=>{
  if(!identity)return;
  const timer=window.setTimeout(()=>{void refresh();},0);
  return()=>window.clearTimeout(timer);
 },[identity,refresh,records]);
 useEffect(()=>{
  if(!identity)return;
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh();},600000);
  return()=>window.clearInterval(timer);
 },[identity,refresh]);
 return {cases,refresh};
}

/** The stage bar: each step an item passes through, the finished ones filled and the current one marked. */
export function TrackingSteps({item,say,layout='card'}:{item:Pick<TrackingItem,'steps'|'outcome'|'kind'>;say:Say;layout?:'card'|'sheet'}){
 if(!item.steps.length)return null;
 const outcome=item.kind==='opportunity'?trackingOpportunityOutcomes[item.outcome]:undefined;
 return <ol className="tracking-steps" data-layout={layout} aria-label={say('مراحل المتابعة','Stages')}>
  {item.steps.map(step=>{
   const [ar,en]=step.id==='finished'&&step.state==='done'&&outcome?outcome:trackingStepLabels[step.id],state=step.state==='done'?say('تمّت','done'):step.state==='current'?say('المرحلة الحالية','current stage'):say('لاحقة','upcoming');
   return <li key={step.id} data-step={step.id} data-state={step.state} data-returned={step.returned?'true':undefined} aria-current={step.state==='current'?'step':undefined}>
    <span className="tracking-dot" aria-hidden="true"/><span className="tracking-step-label">{say(ar,en)}</span><span className="sr-only"> ({state})</span>
   </li>;
  })}
 </ol>;
}

/** The bar inside a sheet, under its title: the steps, and for an open item who holds it and since when. */
export function TrackingSheetSteps({item,caption=false}:{item:TrackingItem;caption?:boolean}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const holder=item.holder,role=holder?trackingHolderLabels[holder.role]:null;
 if(!item.steps.length)return null;
 return <section className="tracking-sheet-steps" data-late={item.late?'true':'false'} aria-label={say('أين وصلت','Where it stands')}>
  <h3>{say('أين وصلت','Where it stands')}</h3>
  <TrackingSteps item={item} say={say} layout="sheet"/>
  {caption&&item.side!=='done'&&role&&<p className="form-note tracking-sheet-holder">{say('عند: ','With: ')}<b>{holder?.name?holder.name+' ('+say(role[0],role[1])+')':say(role[0],role[1])}</b> · {say('منذ '+hoursText(item.stageHours,say),'for '+hoursText(item.stageHours,say))}{item.late&&<span className="tracking-late">{say('متأخر عن هدف '+item.targetHours+' ساعات عمل','Late against a '+item.targetHours+'-working-hour target')}</span>}</p>}
 </section>;
}

function outcomeText(item:TrackingItem,say:Say){
 if(item.outcome==='cancelled')return pair(trackingStageText,'cancelled',say);
 if(item.kind==='opportunity')return trackingOpportunityOutcomes[item.outcome]?say(...trackingOpportunityOutcomes[item.outcome]):pair(trackingStageText,'closed',say);
 return closureOutcomes[item.outcome]?say(closureOutcomes[item.outcome],closureOutcomesEn[item.outcome]||item.outcome):pair(trackingStageText,'closed',say);
}
const LAST_KIND:Record<string,[string,string]>={contact:['تواصل','Contact'],update:['تحديث','Update'],note:['ملاحظة','Note']};

function TrackingCard({item,say,showRegistrar,onOpen}:{item:TrackingItem;say:Say;showRegistrar:boolean;onOpen:(item:TrackingItem)=>void}){
 const open=item.side!=='done',holder=item.holder,role=holder?trackingHolderLabels[holder.role]:null;
 const category=item.category?say(complaintCategories[item.category]||item.category,complaintCategoriesEn[item.category]||item.category):'';
 return <article className="tracking-card" data-tracking-card={item.key} data-kind={item.kind} data-stage={item.stage} data-side={item.side} data-late={item.late?'true':'false'} data-severity={item.severity}>
  <header>
   <div>
    <span className="tracking-kind" data-kind={item.kind}>{item.kind==='complaint'?<MessageSquareWarning size={13} aria-hidden="true"/>:<Sparkles size={13} aria-hidden="true"/>}{item.kind==='complaint'?say('شكوى','Complaint'):say('فرصة','Opportunity')}</span>
    <h4>{item.customerName}</h4>
   </div>
   <span className="badge pending">{open?pair(trackingStageText,item.stage,say):outcomeText(item,say)}</span>
  </header>
  {item.kind==='complaint'
   ?<p className="tracking-subject">{item.complaintNumber&&<bdi className="tracking-number">#{item.complaintNumber} </bdi>}{category}{item.needs&&<span> · {clip(item.needs,110)}</span>}</p>
   :<p className="tracking-subject">{item.products.map(product=>t(product)).join(' · ')}{item.needs&&<span>{item.products.length?' · ':''}{clip(item.needs,110)}</span>}</p>}
  <TrackingSteps item={item} say={say}/>
  {open&&role&&<p className="tracking-holder"><Clock3 size={14} aria-hidden="true"/><span><b>{say('عند: ','With: ')}</b>{holder?.name?holder.name+' ('+say(role[0],role[1])+')':say(role[0],role[1])} · {say('منذ '+hoursText(item.stageHours,say),'for '+hoursText(item.stageHours,say))}</span>{item.late&&<span className="tracking-late">{say('متأخر عن هدف '+item.targetHours+' ساعات عمل','Late against a '+item.targetHours+'-working-hour target')}</span>}</p>}
  {!open&&<p className="tracking-holder"><Flag size={14} aria-hidden="true"/><span>{say('انتهت ','Finished ')}{stamp(item.finishedAt)} · {outcomeText(item,say)}</span></p>}
  {item.last&&<small className="tracking-last"><b>{say('آخر ما سُجّل: ','Last recorded: ')}</b>{pair(LAST_KIND,item.last.kind,say)} · {stamp(item.last.at)}{item.last.by?' · '+item.last.by:''}{item.last.text?': '+clip(item.last.text,140):''}</small>}
  <small className="tracking-registered">{say('سُجّلت ','Registered ')}{stamp(item.registeredAt)}{showRegistrar&&item.registrarName?' · '+say('سجّلها: ','by ')+item.registrarName:''}</small>
  <div className="tracking-actions"><button type="button" className="btn subtle" onClick={()=>onOpen(item)}>{item.kind==='complaint'?say('فتح الشكوى','Open the complaint'):say('فتح الفرصة','Open the opportunity')}</button></div>
 </article>;
}

/** The board without its state: the rows, the filter chosen and whether the rest is shown. */
export function TrackingBoardView({items,filter,onFilter,expanded,onExpand,role,loaded,onOpen}:{items:TrackingItem[];filter:TrackingFilter;onFilter:(filter:TrackingFilter)=>void;expanded:boolean;onExpand:(expanded:boolean)=>void;role:string;loaded:boolean;onOpen:(item:TrackingItem)=>void}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const counts=trackingCounts(items),shown=filterTracking(items,filter),cards=expanded?shown:shown.slice(0,TRACKING_VISIBLE),manager=role==='customer_service_manager';
 return <section className="tracking-board panel" aria-label={say('متابعة ما سُجّل','Tracking what was registered')} data-role={role} dir={language==='en'?'ltr':'rtl'}>
  <div className="tracking-heading"><div>
   <h2><Route size={18} aria-hidden="true"/> {manager?say('متابعة ما سجّله فريقك وما سجّلته','Tracking what your team and you registered'):say('متابعة ما سجّلته','Tracking what you registered')}</h2>
   <p>{say('الفرص التي سلّمتها للمبيعات والشكاوى التي سجّلتها: أين وصلت، ومن يحملها الآن، ومنذ متى. الأرقام للمتابعة فقط ولا تدخل في التقييم.','The opportunities handed to sales and the complaints registered: where each stands, who holds it now and since when. The figures are for follow-up only and feed no evaluation.')}</p>
  </div></div>
  <div className="tracking-tabs" role="group" aria-label={say('تصنيف المتابعة','Tracking filter')}>
   {trackingFilters.map(id=><button key={id} type="button" className="tracking-tab" data-filter={id} data-late-tab={id==='late'&&counts.late>0?'true':undefined} aria-pressed={filter===id} onClick={()=>onFilter(id)}>{say(trackingFilterLabels[id][0],trackingFilterLabels[id][1])} <span className="tracking-count">{counts[id]}</span></button>)}
  </div>
  {!items.length
   ?<p className="tracking-empty" role="status">{loaded?say('لا فرص ولا شكاوى مسجّلة بعد. ما تسجّله يظهر هنا مع مرحلته.','Nothing registered yet. What you register appears here with its stage.'):say('جارٍ تحميل المتابعة','Loading the tracking')}</p>
   :!shown.length?<p className="tracking-empty" role="status">{say('لا شيء في هذا التصنيف.','Nothing in this filter.')}</p>
   :<div className="tracking-cards">{cards.map(item=><TrackingCard key={item.key} item={item} say={say} showRegistrar={manager} onOpen={onOpen}/>)}</div>}
  {shown.length>TRACKING_VISIBLE&&<button type="button" className="btn subtle tracking-more" aria-expanded={expanded} onClick={()=>onExpand(!expanded)}>{expanded?say('عرض أقل','Show fewer'):say('عرض الكل ('+shown.length+')','Show all ('+shown.length+')')}</button>}
 </section>;
}

/** The board at the top of the Opportunities page for customer-service members. */
export function ServiceTrackingBoard({me,cases,complaints,onOpenCase,onOpenComplaint}:{me:Member;cases:TrackedCase[]|null;complaints:ComplaintEntry[]|null|undefined;onOpenCase:(id:string)=>void;onOpenComplaint:(id:string)=>void}){
 const [filter,setFilter]=useState<TrackingFilter>('all'),[expanded,setExpanded]=useState(false);
 const items=useMemo(()=>trackingItems({me,cases,complaints}),[me,cases,complaints]);
 if(me.role!=='customer_service'&&me.role!=='customer_service_manager')return null;
 return <TrackingBoardView items={items} filter={filter} onFilter={next=>{setFilter(next);setExpanded(false);}} expanded={expanded} onExpand={setExpanded} role={me.role} loaded={cases!==null} onOpen={item=>item.kind==='complaint'?onOpenComplaint(item.id):onOpenCase(item.id)}/>;
}
