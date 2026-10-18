'use client';
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {CheckCircle2,Clock3,LifeBuoy,Loader2,MessageCircle,PhoneCall} from 'lucide-react';
import {Sheet,SheetContent,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {t,useLanguage,direction,getLanguage} from '@/lib/i18n';
import {definiteSubmitRejection,submitJson} from '@/lib/client-submit';
import {roles,today,type Member,type Row} from '@/lib/crm';
import {canRequestSupport,contactLinks,isOpenState,supportActions,supportActionsEn,supportByCustomer,supportChannels,supportChannelsEn,supportGroups,supportOutcomes,supportOutcomesEn,supportResolutionChannels,supportResolutionChannelsEn,visitedCustomers,type MissedEntry,type SupportEntry,type SupportGroupId} from '@/lib/support';
import {trackedSupport} from '@/lib/service-tracking';
import {hoursText} from './service-queue';
import {TrackingSheetSteps} from './service-tracking';
import VoiceField from './voice-field';
import './support-panel.css';

type Say=(ar:string,en:string)=>string;
export type SupportData={generatedAt:string;requests:SupportEntry[];missed:MissedEntry[];counts:{requests:number;missed:number;badge:number}};
/** What a visit row or a customer needs to offer the button: the customer's current request, who may ask, and what to open. */
export type SupportBinding={byCustomer:Record<string,SupportEntry|undefined>;canRequest:(customerId:string)=>boolean;onRequest:(customerId:string)=>void;onOpen:(entry:SupportEntry)=>void};
const messageOf=(error:unknown)=>typeof error==='object'&&error!==null&&'message' in error&&typeof (error as {message:unknown}).message==='string'?(error as {message:string}).message:'';
const stamp=(iso:string)=>iso?new Date(iso).toLocaleString('en-GB',{timeZone:'Asia/Riyadh'}):'—';
const isStaff=(role:string)=>role==='customer_service'||role==='customer_service_manager'||role==='admin';
const outcomeText=(key:string,say:Say)=>say(supportOutcomes[key]||key,supportOutcomesEn[key]||key);
const channelText=(key:string,say:Say)=>say(supportChannels[key]||supportChannels.any,supportChannelsEn[key]||supportChannelsEn.any);
const wayText=(key:string,say:Say)=>say(supportResolutionChannels[key]||supportResolutionChannels.other,supportResolutionChannelsEn[key]||supportResolutionChannelsEn.other);
const actionText=(key:string,say:Say)=>say(supportActions[key]||key,supportActionsEn[key]||key);
const STATE_TEXT:Record<string,[string,string]>={waiting:['بانتظار التولّي','Waiting to be taken'],in_progress:['قيد التواصل','In contact'],submitted:['بانتظار مراجعة المدير','Waiting for the manager\'s review'],returned:['مطلوب تعديل','Needs correction'],pending_assignment:['بانتظار تكليف المبيعات','Waiting for sales assignment'],resolved:['بانتظار إغلاق خدمة العملاء','Waiting for customer-service closure'],done:['تم التواصل','Contacted'],cancelled:['أُلغي','Cancelled']};
/** Where the request stands, in words: its state, refined while sales holds it. */
const stateText=(entry:SupportEntry,say:Say)=>entry.state==='assigned'?(entry.stage==='delegation'?say('لدى مشرف المبيعات','With the sales supervisor'):say('بانتظار تواصل المندوب','Waiting for the representative\'s contact')):say(...(STATE_TEXT[entry.state]||STATE_TEXT.waiting));
/** What the chip beside a visit says to the sales member who asked: the stage the request is in. */
const CHIP_TEXT:Record<string,[string,string]>={waiting:['بانتظار خدمة العملاء','Waiting for customer service'],in_progress:['خدمة العملاء تتواصل','Customer service is in contact'],submitted:['قيد مراجعة خدمة العملاء','Under customer-service review'],returned:['قيد مراجعة خدمة العملاء','Under customer-service review'],pending_assignment:['بانتظار تكليف المبيعات','Waiting for sales assignment'],assigned:['لدى المبيعات','With sales'],resolved:['بانتظار إغلاق خدمة العملاء','Waiting for customer-service closure']};
/** What the main button of a card offers: the step the reader is asked to take. */
const askText=(entry:SupportEntry,say:Say)=>entry.awaiting==='contact'?say('تسجيل النتيجة ورفعها','Record the result and submit'):entry.awaiting==='fix'?say('تعديل وإعادة الرفع','Correct and submit again'):entry.awaiting==='review'?say('مراجعة الطلب','Review the request'):entry.awaiting==='assign'?say('تكليف ممثل','Assign a member'):entry.awaiting==='allocate'?say('تكليف مندوب','Assign a representative'):entry.awaiting==='delegate'?say('تفويض مندوب','Delegate to a representative'):entry.awaiting==='resolve'?say('تسجيل نتيجة التواصل','Record the contact'):entry.awaiting==='close'?say('تأكيد الإغلاق','Confirm the closure'):entry.awaiting==='answer'?say('عرض الرد','See the reply'):say('التفاصيل','Details');

/** The assistance data of the signed-in member, loaded beside the page and refreshed with it and every ten minutes. */
export function useSupport({me,records,members}:{me:Member|null;records:Row[];members:Member[]}){
 const [loaded,setLoaded]=useState<{identity:string;data:SupportData}|null>(null),generation=useRef(0),lastLoad=useRef({identity:'',at:0});
 const identity=me?[me.id,me.role,me.authVersion,me.regionScope,me.branch].join(':'):'';
 // What was loaded for another account, or before signing out, is never shown.
 const data=loaded&&loaded.identity===identity?loaded.data:null;
 // A change the member just made always reloads; the page's own reloads (focus, visibility, a refreshed snapshot) are at most one per fifteen seconds.
 const refresh=useCallback(async(force:boolean=true)=>{
  if(!identity||typeof navigator!=='undefined'&&navigator.onLine===false)return;
  if(!force&&lastLoad.current.identity===identity&&Date.now()-lastLoad.current.at<15000)return;
  const current=++generation.current;
  try{const next=await submitJson<SupportData>('/api/support',{cache:'no-store'},{language:getLanguage()});if(current===generation.current){lastLoad.current={identity,at:Date.now()};setLoaded({identity,data:next});}}catch{/* the page works without it */}
 },[identity]);
 useEffect(()=>{
  if(!identity)return;
  const timer=window.setTimeout(()=>{void refresh(false);},0);
  return()=>window.clearTimeout(timer);
 },[identity,refresh,records]);
 useEffect(()=>{
  if(!identity)return;
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh();},600000);
  return()=>window.clearInterval(timer);
 },[identity,refresh]);
 const byCustomer=useMemo(()=>supportByCustomer(data?.requests||[]),[data]);
 const visited=useMemo(()=>me&&me.role!=='admin'?visitedCustomers(records):new Set<string>(),[me,records]);
 const canRequest=useCallback((customerId:string)=>{
  if(!me)return false;
  const customer=records.find(row=>row.id===customerId&&row.kind==='customer');
  return canRequestSupport(customer,{me,members,visible:records},visited);
 },[me,members,records,visited]);
 return {data,refresh,byCustomer,canRequest,badge:data?.counts.badge||0};
}

/** One write to the assistance route. A retry after an unclear failure keeps its identifier, so it can never save twice. */
function useAction(onDone:()=>Promise<void>|void){
 const lock=useRef(false),attempt=useRef<{body:string;key:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const run=useCallback(async(body:Record<string,unknown>)=>{
  if(lock.current)return false;
  lock.current=true;setBusy(true);setError('');
  const text=JSON.stringify(body);if(attempt.current?.body!==text)attempt.current={body:text,key:crypto.randomUUID()};
  try{
   await submitJson('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,requestId:attempt.current.key})},{language:getLanguage()});
   attempt.current=null;await onDone();return true;
  }catch(failure){setError(messageOf(failure));if(definiteSubmitRejection(failure))attempt.current=null;return false;}
  finally{lock.current=false;setBusy(false);}
 },[onDone]);
 return {run,busy,error};
}

/** The button beside a visit or a customer: ask for help, or see where the request stands. */
export function SupportButton({customerId,support}:{customerId:string;support?:SupportBinding}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 if(!support||!customerId)return null;
 const entry=support.byCustomer[customerId];
 if(entry&&isOpenState(entry.state))return <button type="button" className="support-chip" data-state={entry.state} data-customer={customerId} onClick={()=>support.onOpen(entry)}><LifeBuoy size={15} aria-hidden="true"/>{say(...(CHIP_TEXT[entry.state]||CHIP_TEXT.waiting))}</button>;
 if(entry&&entry.state==='done')return <button type="button" className="support-chip" data-state="done" data-unseen={entry.permissions.seen?'true':'false'} data-customer={customerId} onClick={()=>support.onOpen(entry)}><CheckCircle2 size={15} aria-hidden="true"/>{say('ردّت خدمة العملاء','Customer service replied')}</button>;
 if(!support.canRequest(customerId))return null;
 return <button type="button" className="btn subtle support-request-button" data-customer={customerId} onClick={()=>support.onRequest(customerId)}><LifeBuoy size={17} aria-hidden="true"/>{say('طلب مساندة خدمة العملاء','Ask customer service for help')}</button>;
}

function ContactLinks({phone,say}:{phone:string;say:Say}){
 const links=contactLinks(phone);
 if(!links.tel)return null;
 return <span className="support-links"><a className="support-link" href={links.tel}><PhoneCall size={14} aria-hidden="true"/>{say('اتصال','Call')}</a>{links.whatsapp&&<a className="support-link" href={links.whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} aria-hidden="true"/>{say('واتساب','WhatsApp')}</a>}</span>;
}

const GROUP_TEXT:Record<SupportGroupId,Record<string,[string,string]>>={
 decide:{default:['تحتاج قرارك','Needs your decision']},
 review:{default:['بانتظار مراجعتك','Waiting for your review']},
 take:{default:['بانتظار تولّيك','Waiting for you to take']},
 mine:{default:['قيد تواصلك','In your contact']},
 fix:{default:['مطلوب تعديلك','Needs your correction']},
 close:{default:['بانتظار إغلاقك','Waiting for your closure']},
 allocate:{default:['بانتظار تكليفك','Waiting for your assignment']},
 delegate:{default:['بانتظار تفويضك','Waiting for your delegation']},
 resolve:{default:['بانتظار تواصلك مع العميل','Waiting for your contact with the customer']},
 missed:{default:['زيارات مفقودة بانتظار التواصل','Missed visits waiting for contact'],customer_service:['زيارات مفقودة في منطقتك','Missed visits in your region']},
 missed_others:{default:['زيارات مفقودة مسندة لزميل','Missed visits routed to a colleague']},
 following:{default:['رُفعت وهي في طريقها','Submitted and on their way']},
 others:{default:['لدى زملائك','With your colleagues'],customer_service_manager:['لدى فريق خدمة العملاء','With the customer-service team'],admin:['لدى فريق خدمة العملاء','With the customer-service team']},
 waiting:{default:['قيد المعالجة','In progress']},
 answered:{default:['ردّت خدمة العملاء','Customer service replied']},
 finished:{default:['منتهية','Finished']}
};
const groupTitle=(id:SupportGroupId,role:string,say:Say)=>{const table=GROUP_TEXT[id],pair=table[role]||table.default;return say(pair[0],pair[1]);};
const VISIBLE_MISSED=8;

function RequestCard({entry,me,say,busy,onOpen,onTake}:{entry:SupportEntry;me:Member;say:Say;busy:boolean;onOpen:(entry:SupportEntry)=>void;onTake:(entry:SupportEntry)=>void}){
 const open=isOpenState(entry.state),missed=entry.origin==='missed_visit',holds=entry.assigneeName||entry.salesManagerName;
 return <article className="support-card" data-request={entry.id} data-state={entry.state} data-stage={entry.stage} data-awaiting={entry.awaiting||'none'} data-late={entry.late?'true':'false'} data-origin={entry.origin}>
  <header><div><h4>{entry.customerName}</h4>{(entry.customerPhone||entry.customerCity)&&<span className="support-phone" dir="ltr">{[entry.customerPhone,entry.customerCity].filter(Boolean).join(' · ')}</span>}</div><span className="badge pending">{stateText(entry,say)}</span></header>
  <div className="support-meta">
   <span className="support-chip-static">{missed?say('زيارة مفقودة','Missed visit'):say('طلب مساندة','Support request')}</span>
   {open&&entry.stageHours>0&&<span className="support-chip-static"><Clock3 size={12} aria-hidden="true"/> {hoursText(entry.stageHours,say)}</span>}
   {entry.late&&entry.targetHours!==null&&<span className="support-chip-static" data-kind="late">{say('متأخر عن هدف '+entry.targetHours+' ساعات عمل','Late against a '+entry.targetHours+'-working-hour target')}</span>}
   {entry.unrouted&&<span className="support-chip-static" data-kind="escalated">{say('لا أحد يغطي منطقة العميل','Nobody covers this customer\'s region')}</span>}
   {entry.noManager&&<span className="support-chip-static" data-kind="escalated">{say('بلا مدير لخدمة العملاء','No customer-service manager')}</span>}
   {entry.state==='done'&&(entry.resolution||entry.result)&&<span className="support-chip-static" data-kind="done">{outcomeText((entry.resolution||entry.result)!.outcome,say)}</span>}
  </div>
  {entry.note&&<p><b>{say('السبب: ','Reason: ')}</b>{entry.note}</p>}
  {entry.plan&&<p><b>{say('الزيارة المخطط لها: ','Planned visit: ')}</b>{[entry.plan.nextAction,entry.plan.nextDate].filter(Boolean).join(' · ')}</p>}
  {entry.returnNote&&entry.state==='returned'&&<p><b>{say('سبب الإعادة للتعديل: ','Why it was returned: ')}</b>{entry.returnNote}</p>}
  {entry.rejectReason&&entry.state==='assigned'&&<p><b>{say('أُعيد إلى المندوب لأن: ','Returned to the representative because: ')}</b>{entry.rejectReason}</p>}
  {entry.result&&<p className="support-result"><b>{say('نتيجة تواصل خدمة العملاء: ','Customer service\'s contact: ')}</b>{entry.result.note}{entry.result.nextDate&&<> · {say('موعد الزيارة المقترح ','Suggested visit date ')}<bdi>{entry.result.nextDate}</bdi></>}</p>}
  {entry.resolution&&<p className="support-result" data-by="sales"><b>{say('تواصل المندوب: ','The representative\'s contact: ')}</b>{wayText(entry.resolution.channel,say)} · {entry.resolution.note}{entry.resolution.nextDate&&<> · {say('موعد الزيارة المقترح ','Suggested visit date ')}<bdi>{entry.resolution.nextDate}</bdi></>}</p>}
  <small>{missed?say('فتحها: ','Opened by: '):say('طلبها: ','Asked by: ')}{entry.requestedByName||'—'}{entry.repName?' · '+say('مسؤول العميل: ','Customer owner: ')+entry.repName:''}{entry.handlerName?' · '+say('المتولّي: ','Holder: ')+entry.handlerName:''}{holds?' · '+(entry.assigneeName?say('لدى المبيعات: ','With sales: ')+entry.assigneeName:say('لدى مدير المبيعات: ','With the sales manager: ')+entry.salesManagerName):''}</small>
  <div className="support-actions">
   {open&&isStaff(me.role)&&<ContactLinks phone={entry.customerPhone} say={say}/>}
   {entry.permissions.take&&<button type="button" className="btn primary" disabled={busy} onClick={()=>onTake(entry)}>{say('تولّي التواصل','Take this contact')}</button>}
   <button type="button" className={'btn '+(entry.awaiting&&entry.awaiting!=='take'?'primary':'subtle')} onClick={()=>onOpen(entry)}>{askText(entry,say)}</button>
  </div>
 </article>;
}

function MissedCard({entry,say,busy,onTake}:{entry:MissedEntry;say:Say;busy:boolean;onTake:(entry:MissedEntry)=>void}){
 return <article className="support-card" data-missed={entry.visitId} data-origin="missed_visit" data-routed={entry.routedToId||'none'}>
  <header><div><h4>{entry.customerName}</h4>{(entry.customerPhone||entry.customerCity)&&<span className="support-phone" dir="ltr">{[entry.customerPhone,entry.customerCity].filter(Boolean).join(' · ')}</span>}</div><span className="badge pending">{say('زيارة مفقودة','Missed visit')}</span></header>
  <div className="support-meta">
   <span className="support-chip-static" data-kind="late">{say('متأخرة '+entry.overdueDays+' يومًا','Behind by '+entry.overdueDays+(entry.overdueDays===1?' day':' days'))}</span>
   {entry.routedToName&&<span className="support-chip-static">{say('مسندة إلى '+entry.routedToName,'Routed to '+entry.routedToName)}</span>}
   {entry.unrouted&&<span className="support-chip-static" data-kind="escalated">{say('لا أحد يغطي منطقة العميل','Nobody covers this customer\'s region')}</span>}
  </div>
  <p><b>{say('الزيارة المخطط لها: ','Planned visit: ')}</b>{[entry.plan.nextAction,entry.plan.nextDate].filter(Boolean).join(' · ')}</p>
  <p><b>{say('نتيجة آخر زيارة: ','Last visit result: ')}</b>{entry.plan.result?t(entry.plan.result):'—'}{entry.plan.visitDate&&<> · <bdi>{entry.plan.visitDate}</bdi></>}</p>
  <small>{say('مندوب المبيعات: ','Sales representative: ')}{entry.repName||'—'}</small>
  <div className="support-actions">
   <ContactLinks phone={entry.customerPhone} say={say}/>
   {entry.permissions.take&&<button type="button" className="btn primary" disabled={busy} onClick={()=>onTake(entry)}>{say('تولّي التواصل','Take this contact')}</button>}
   {!entry.permissions.take&&<small>{say('مسندة لممثل آخر','Routed to another representative')}</small>}
  </div>
 </article>;
}

/** What each role sees on the Visits page: customer service its work, sales members their requests, what was handed to them and the replies. */
export function SupportPanel({data,me,onOpen,onChanged}:{data:SupportData|null;me:Member;onOpen:(entry:SupportEntry)=>void;onChanged:()=>Promise<void>}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const action=useAction(onChanged);
 if(!data)return null;
 const groups=supportGroups(data.requests,data.missed,me.role,undefined,me.id);
 if(!groups.length)return null;
 // The lists are cut at a fixed size; the counts come from the whole of them so nothing is hidden without being said.
 const missedTotal=Math.max(data.counts?.missed??0,data.missed.length),requestTotal=Math.max(data.counts?.requests??0,data.requests.length);
 const staff=isStaff(me.role),count=data.requests.filter(entry=>isOpenState(entry.state)).length+(staff?missedTotal:0);
 const cut=[missedTotal>data.missed.length?say('تُعرض '+data.missed.length+' من أصل '+missedTotal+' زيارة مفقودة، الأكثر تأخرًا أولًا، وتظهر البقية كلما عولجت هذه.','Showing '+data.missed.length+' of '+missedTotal+' missed visits, the most overdue first. The rest appear as these are handled.'):'',requestTotal>data.requests.length?say('تُعرض '+data.requests.length+' من أصل '+requestTotal+' طلبًا.','Showing '+data.requests.length+' of '+requestTotal+' requests.'):''].filter(Boolean);
 const takeRequest=(entry:SupportEntry)=>void action.run({action:'take',id:entry.id,version:entry.version});
 const takeMissed=(entry:MissedEntry)=>void action.run({action:'request',origin:'missed_visit',customerId:entry.customerId,customerVersion:entry.customerVersion,visitId:entry.visitId});
 const intro=staff?say('طلبات المساندة من المبيعات والزيارات المفقودة في نطاقك. ما ترفعه يمر على مدير خدمة العملاء ثم مدير المبيعات ويعود إليك للإغلاق.','Assistance requests from sales and missed visits in your scope. What you submit goes through the customer-service manager and the sales manager and comes back to you to close.'):me.role==='rep'?say('طلباتك لخدمة العملاء وردودها وما أُسند إليك منها.','Your requests to customer service, their replies and what was assigned to you.'):me.role==='manager'?say('طلبات فريقك لخدمة العملاء وردودها وما أُحيل إليك منها لتكليف مندوب.','Your team\'s requests to customer service, their replies and what was handed to you to assign.'):say('طلبات فريقك لخدمة العملاء وردودها وما أُسند إليك منها.','Your team\'s requests to customer service, their replies and what was assigned to you.');
 return <section className="support-panel panel" aria-label={staff?say('التواصل مع العملاء','Customer contact'):say('مساندة خدمة العملاء','Customer-service assistance')} data-role={me.role} dir={language==='en'?'ltr':'rtl'}>
  <div className="support-heading"><div><h2><LifeBuoy size={18} aria-hidden="true"/> {staff?say('التواصل مع العملاء','Customer contact'):say('مساندة خدمة العملاء','Customer-service assistance')}</h2><p>{intro}</p></div><span className="support-count">{count}</span></div>
  {action.error&&<div className="form-error" role="alert">{t(action.error)}</div>}
  {cut.length>0&&<p className="support-cut" role="note">{cut.join(' ')}</p>}
  {groups.map(group=>{
   const cards=[...group.requests.map(entry=><RequestCard key={entry.id} entry={entry} me={me} say={say} busy={action.busy} onOpen={onOpen} onTake={takeRequest}/>),...group.missed.slice(0,VISIBLE_MISSED).map(entry=><MissedCard key={entry.id} entry={entry} say={say} busy={action.busy} onTake={takeMissed}/>)];
   const rest=group.missed.slice(VISIBLE_MISSED);
   const more=rest.length>0&&<details className="support-more"><summary>{say('عرض الباقي ('+rest.length+')','Show the rest ('+rest.length+')')}</summary><div className="support-cards">{rest.map(entry=><MissedCard key={entry.id} entry={entry} say={say} busy={action.busy} onTake={takeMissed}/>)}</div></details>;
   const total=group.requests.length+group.missed.length;
   if(['finished','missed_others','others'].includes(group.id))return <details key={group.id} className="support-folded" data-group={group.id}><summary>{groupTitle(group.id,me.role,say)} <span className="support-count">{total}</span></summary><div className="support-cards">{cards}</div>{more}</details>;
   return <div key={group.id} className="support-group" data-group={group.id}><h3>{groupTitle(group.id,me.role,say)} <span className="support-count">{total}</span></h3><div className="support-cards">{cards}</div>{more}</div>;
  })}
 </section>;
}

/** Ask customer service to contact a customer. */
export function SupportRequestDialog({customer,onClose,onSaved}:{customer:Row;onClose:()=>void;onSaved:()=>Promise<void>|void}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const [note,setNote]=useState(''),[channel,setChannel]=useState('any');
 const action=useAction(async()=>{await onSaved();onClose();});
 return <Dialog open onOpenChange={open=>{if(!open&&!action.busy)onClose();}}><DialogContent className="support-dialog" dir={direction()}>
  <DialogTitle>{say('طلب مساندة خدمة العملاء','Ask customer service for help')}</DialogTitle>
  <DialogDescription>{say('تتواصل خدمة العملاء مع هذا العميل ثم يمر الطلب على مدير خدمة العملاء ومدير المبيعات، وتصلك النتيجة هنا بعد إغلاقه: ','Customer service contacts this customer, then the request goes through the customer-service manager and the sales manager, and the result comes back here once it is closed: ')}<b>{customer.data.name}</b></DialogDescription>
  <fieldset disabled={action.busy} className="support-form">
   <VoiceField label={say('ما المطلوب من خدمة العملاء؟','What should customer service do?')} marked multiline rows={4} value={note} onChange={setNote} contextKey="support-request" inputProps={{maxLength:2000,placeholder:say('مثال: العميل لا يرد على اتصالاتي، اسألوه عن موعد مناسب للزيارة','For example: the customer is not answering my calls, ask for a suitable visit date')}}/>
   <label className="field"><span>{say('وسيلة التواصل المفضلة','Preferred way to reach them')}</span><select value={channel} onChange={event=>setChannel(event.target.value)}>{Object.keys(supportChannels).map(key=><option key={key} value={key}>{channelText(key,say)}</option>)}</select></label>
   <p className="form-note">{say('تظهر ملاحظتك لخدمة العملاء في منطقة العميل ولمن فوقك في المبيعات. لا تُحتسب زيارة ولا تغيّر خطة المتابعة.','Your note is shown to customer service for the customer\'s region and to those above you in sales. It does not count as a visit and does not change the follow-up plan.')}</p>
   {action.error&&<div className="form-error" role="alert">{t(action.error)}</div>}
   <div className="service-button-row"><button type="button" className="btn primary" disabled={note.trim().length<3} onClick={()=>void action.run({action:'request',origin:'rep',customerId:customer.id,customerVersion:customer.version,note:note.trim(),channel})}>{action.busy?<Loader2 className="spin" size={16}/>:<LifeBuoy size={16} aria-hidden="true"/>}{say('إرسال الطلب','Send the request')}</button><button type="button" className="btn subtle" onClick={onClose}>{say('إلغاء','Cancel')}</button></div>
  </fieldset>
 </DialogContent></Dialog>;
}

/** The outcome, the way, the text and the date a contact recorded, and who recorded it and when. */
function contactFacts(label:string,labelEn:string,contact:{outcome:string;note:string;nextDate:string;byName:string;at:string;channel?:string},say:Say):[string,React.ReactNode][]{
 return [
  [say(label,labelEn),(contact.channel?wayText(contact.channel,say)+' · ':'')+outcomeText(contact.outcome,say)],
  [say('تفاصيل التواصل','Contact details'),contact.note],
  ...(contact.nextDate?[[say('موعد الزيارة المقترح','Suggested visit date'),contact.nextDate] as [string,React.ReactNode]]:[]),
  [say('سجّله','Recorded by'),(contact.byName||'—')+' · '+stamp(contact.at)]
 ];
}

/** One request: who asked and why, where it stands, what each stage recorded, and what the reader may do with it. */
export function SupportSheet({entry,onClose,onChanged}:{entry:SupportEntry;onClose:()=>void;onChanged:()=>Promise<void>}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const action=useAction(onChanged),returned=entry.status==='returned'&&!!entry.result;
 const [outcome,setOutcome]=useState(returned?entry.result!.outcome:''),[note,setNote]=useState(returned?entry.result!.note:''),[nextDate,setNextDate]=useState(returned?entry.result!.nextDate:''),[way,setWay]=useState('call');
 const [target,setTarget]=useState(entry.suggestedId||entry.candidates[0]?.id||''),[assignNote,setAssignNote]=useState(''),[closeNote,setCloseNote]=useState(''),[returnReason,setReturnReason]=useState(''),[rejectReason,setRejectReason]=useState(''),[cancelReason,setCancelReason]=useState('');
 const opened=useRef('');
 const {run}=action,p=entry.permissions;
 useEffect(()=>{
  if(!entry.permissions.seen||opened.current===entry.id+':'+entry.version)return;
  opened.current=entry.id+':'+entry.version;void run({action:'seen',id:entry.id,version:entry.version});
 },[entry.id,entry.version,entry.permissions.seen,run]);
 const links=contactLinks(entry.customerPhone),open=isOpenState(entry.state);
 const handing=p.forward?'forward':p.allocate?'allocate':p.reassign?'reassign':p.delegate?'delegate':p.assign?'assign':null;
 const dateNeeded=(key:string,date:string)=>key==='wants_visit'&&!date;
 const facts:[string,React.ReactNode][]=[
  [say('العميل','Customer'),entry.customerName],
  [say('رقم التواصل','Phone'),<span key="p" dir="ltr">{entry.customerPhone||'—'}{links.tel&&<> <ContactLinks phone={entry.customerPhone} say={say}/></>}</span>],
  [say('المدينة والمنطقة','City and region'),[entry.customerCity,entry.customerRegion].filter(Boolean).join(' · ')||'—'],
  [entry.origin==='missed_visit'?say('فتحها','Opened by'):say('طلبها','Asked by'),entry.requestedByName||'—'],
  [say('مسؤول العميل في المبيعات','Sales owner'),entry.repName||'—'],
  ...(entry.note?[[say('السبب','Reason'),entry.note] as [string,React.ReactNode]]:[]),
  ...(entry.plan?[[say('الزيارة المخطط لها','Planned visit'),[entry.plan.nextAction,entry.plan.nextDate].filter(Boolean).join(' · ')||'—'] as [string,React.ReactNode],[say('نتيجة آخر زيارة','Last visit result'),entry.plan.result?t(entry.plan.result):'—'] as [string,React.ReactNode]]:[]),
  [say('الوسيلة المفضلة','Preferred way'),channelText(entry.channel,say)],
  [say('وقت الطلب','Requested at'),stamp(entry.createdAt)],
  [say('المتولّي','Holder'),entry.handlerName||say('لم يتولّه أحد بعد','Nobody has taken it yet')],
  ...(entry.serviceManagerName?[[say('مدير خدمة العملاء','Customer-service manager'),entry.serviceManagerName] as [string,React.ReactNode]]:entry.noManager?[[say('مدير خدمة العملاء','Customer-service manager'),say('بلا مدير: تنتظر مدير النظام','None: waits for an administrator')] as [string,React.ReactNode]]:[]),
  ...(entry.salesManagerName?[[say('مدير المبيعات','Sales manager'),entry.salesManagerName] as [string,React.ReactNode]]:[]),
  ...(entry.assigneeName?[[say('لدى المبيعات','With sales'),entry.assigneeName+(entry.assigneeRole?' · '+t(roles[entry.assigneeRole]):'')+(entry.supervisorName&&entry.assigneeRole==='rep'?' · '+say('المشرف: ','Supervisor: ')+entry.supervisorName:'')] as [string,React.ReactNode]]:[]),
  ...(entry.assignmentNote?[[say('ملاحظة التكليف','Assignment note'),entry.assignmentNote] as [string,React.ReactNode]]:[]),
  ...(entry.returnNote&&entry.state==='returned'?[[say('سبب الإعادة للتعديل','Why it was returned'),entry.returnNote] as [string,React.ReactNode]]:[]),
  ...(entry.rejectReason&&entry.state==='assigned'?[[say('أُعيد إلى المندوب لأن','Returned to the representative because'),entry.rejectReason] as [string,React.ReactNode]]:[]),
  ...(open&&entry.targetHours!==null?[[say('في هذه المرحلة منذ','At this stage for'),hoursText(entry.stageHours,say)+' · '+say('الهدف '+entry.targetHours+' ساعة عمل','target '+entry.targetHours+' working hours')+(entry.late?' · '+say('متأخر','late'):'')] as [string,React.ReactNode]]:[]),
  ...(entry.result?contactFacts('نتيجة تواصل خدمة العملاء','Customer service\'s contact',entry.result,say):[]),
  ...(entry.resolution?contactFacts('نتيجة تواصل المندوب','The representative\'s contact',entry.resolution,say):[]),
  ...(entry.closure?[[say('الإغلاق','Closure'),(entry.closure.note?entry.closure.note+' · ':'')+(entry.closure.byName||'—')+' · '+stamp(entry.closure.at)] as [string,React.ReactNode]]:[]),
  ...(entry.state==='cancelled'?[[say('سبب الإلغاء','Cancellation reason'),entry.cancelReason||'—'] as [string,React.ReactNode]]:[])
 ];
 const story=[...entry.events].map((event,index)=>({id:'e'+index,at:event.at,title:actionText(event.action,say)+(event.targetName?' · '+event.targetName:'')+(event.outcome?' · '+outcomeText(event.outcome,say):''),actor:event.byName,text:event.text||''})).sort((a,b)=>b.at.localeCompare(a.at)||b.id.localeCompare(a.id));
 const perform=(body:Record<string,unknown>)=>void run({...body,id:entry.id,version:entry.version});
 const pick=(label:string)=><label className="field"><span>{label}</span><select value={target} onChange={event=>setTarget(event.target.value)}><option value="">{say('اختر','Choose')}</option>{entry.candidates.map(person=><option key={person.id} value={person.id}>{person.name} · {t(roles[person.role])}{person.id===entry.suggestedId?' · '+say('مندوب العميل الحالي','the customer\'s current representative'):''}</option>)}</select></label>;
 const outcomeSelect=<label className="field"><span>{say('نتيجة التواصل','Result of the contact')}</span><select value={outcome} onChange={event=>setOutcome(event.target.value)}><option value="">{say('اختر','Choose')}</option>{Object.keys(supportOutcomes).map(key=><option key={key} value={key}>{outcomeText(key,say)}</option>)}</select></label>;
 const dateField=outcome==='wants_visit'&&<label className="field"><span>{say('الموعد الذي يطلبه العميل','The date the customer asks for')}</span><input type="date" min={today()} value={nextDate} onChange={event=>setNextDate(event.target.value)}/></label>;
 return <Sheet open onOpenChange={value=>{if(!value)onClose();}}><SheetContent side={direction()==='rtl'?'left':'right'} className="crm-sheet service-sheet support-sheet" dir={direction()}>
  <SheetTitle>{say('مساندة خدمة العملاء','Customer-service assistance')}</SheetTitle><SheetDescription>{entry.customerName}</SheetDescription>
  <div className="service-detail"><div className="service-status"><span className="badge pending">{stateText(entry,say)}</span>{entry.late&&<span className="support-chip-static" data-kind="late">{say('متأخر','Late')}</span>}</div>
   <TrackingSheetSteps item={trackedSupport(entry)} caption/>
   <dl className="service-facts">{facts.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
   <fieldset disabled={action.busy} className="service-actions">
    {p.take&&<div className="service-button-row"><button type="button" className="btn primary" onClick={()=>perform({action:'take'})}>{say('تولّي التواصل','Take this contact')}</button></div>}
    {handing&&entry.candidates.length>0&&<div className="service-routing">
     {pick(handing==='forward'?say('إحالة إلى مدير المبيعات','Hand to the sales manager'):handing==='delegate'?say('تفويض مندوب من فريقك','Delegate to one of your representatives'):handing==='reassign'?say('نقل الطلب إلى','Move the request to'):handing==='allocate'?say('تكليف مندوب أو مشرف','Assign a representative or supervisor'):say('تكليف ممثل لخدمة العملاء','Assign a customer-service member'))}
     {(handing==='allocate'||handing==='reassign'||handing==='delegate')&&<VoiceField label={say('ملاحظة للمكلَّف (اختياري)','A note for the assignee (optional)')} value={assignNote} onChange={setAssignNote} contextKey={'support-assign:'+entry.id} inputProps={{maxLength:2000}}/>}
     <button type="button" className={handing==='assign'?'btn subtle':'btn primary'} disabled={!target} onClick={()=>perform(handing==='forward'?{action:'forward',targetId:target}:handing==='assign'?{action:'assign',targetId:target}:{action:handing,targetId:target,note:assignNote.trim()})}>{handing==='forward'?say('اعتماد وإحالة','Approve and hand over'):handing==='delegate'?say('تفويض','Delegate'):handing==='reassign'?say('نقل الطلب','Move the request'):handing==='allocate'?say('تكليف','Assign'):say('تأكيد التكليف','Confirm the assignment')}</button></div>}
    {handing&&!entry.candidates.length&&<p className="form-note">{handing==='forward'?say('لا مدير مبيعات مرتبط بك يغطي منطقة العميل. راجع صفحة الفريق.','No sales manager linked to you covers the customer\'s region. Check the team page.'):say('لا أحد يغطي فرع العميل ومنطقته.','Nobody covers the customer\'s branch and region.')}</p>}
    {p.return&&<div className="service-routing"><VoiceField label={say('إعادة للتعديل: ما الذي يلزم؟','Return for correction: what is missing?')} value={returnReason} onChange={setReturnReason} contextKey={'support-return:'+entry.id} inputProps={{maxLength:2000}}/><button type="button" className="btn subtle" disabled={returnReason.trim().length<3} onClick={()=>perform({action:'return',note:returnReason.trim()})}>{say('إعادة للتعديل','Return for correction')}</button></div>}
    {p.submit&&<div className="service-internal"><h3>{returned?say('تعديل النتيجة وإعادة رفعها','Correct the result and submit it again'):say('رفع نتيجة التواصل للاعتماد','Submit the result of the contact for approval')}</h3>{outcomeSelect}{dateField}
     <VoiceField label={say('ما حدث في التواصل','What happened in the contact')} multiline value={note} onChange={setNote} contextKey={'support-result:'+entry.id} inputProps={{maxLength:2000,placeholder:say('اكتب ما قاله العميل وما اتُّفق عليه','Write what the customer said and what was agreed')}}/>
     <p className="form-note">{say('يصل إلى مدير خدمة العملاء للاعتماد، ثم إلى مدير المبيعات الذي يكلّف مندوبًا بالتواصل مع العميل، ثم يعود إليك للإغلاق. لا تُحتسب زيارة.','It goes to the customer-service manager for approval, then to the sales manager, who assigns a representative to contact the customer, and then comes back to you to close. It does not count as a visit.')}</p>
     <button type="button" className="btn primary" disabled={!outcome||note.trim().length<3||dateNeeded(outcome,nextDate)} onClick={()=>perform({action:'submit',outcome,note:note.trim(),nextDate:outcome==='wants_visit'?nextDate:''})}><CheckCircle2 size={16} aria-hidden="true"/>{returned?say('إعادة الرفع للاعتماد','Submit again for approval'):say('رفع للاعتماد','Submit for approval')}</button></div>}
    {p.resolve&&<div className="service-internal"><h3>{say('تسجيل نتيجة التواصل مع العميل','Record the result of your contact with the customer')}</h3>
     <label className="field"><span>{say('كيف تواصلت','How you reached the customer')}</span><select value={way} onChange={event=>setWay(event.target.value)}>{Object.keys(supportResolutionChannels).map(key=><option key={key} value={key}>{wayText(key,say)}</option>)}</select></label>{outcomeSelect}{dateField}
     <VoiceField label={say('ما حدث','What happened')} multiline value={note} onChange={setNote} contextKey={'support-resolve:'+entry.id} inputProps={{maxLength:2000,placeholder:say('ما قاله العميل وما فعلته وما اتُّفق عليه','What the customer said, what you did and what was agreed')}}/>
     <p className="form-note">{say('تعود النتيجة إلى خدمة العملاء لتراجعها وتغلق الطلب. لا تُحتسب زيارة ولا تغيّر خطة المتابعة؛ سجّل الزيارة أو المتابعة كالمعتاد إن أجريتها.','The result goes back to customer service to review and close the request. It does not count as a visit or change the follow-up plan; record the visit or follow-up as usual if you made one.')}</p>
     <button type="button" className="btn primary" disabled={!outcome||note.trim().length<3||dateNeeded(outcome,nextDate)} onClick={()=>perform({action:'resolve',channel:way,outcome,note:note.trim(),nextDate:outcome==='wants_visit'?nextDate:''})}><CheckCircle2 size={16} aria-hidden="true"/>{say('تسجيل النتيجة','Record the result')}</button></div>}
    {p.close&&<div className="service-internal"><h3>{say('مراجعة نتيجة المندوب وإغلاق الطلب','Review the representative\'s result and close the request')}</h3>
     <VoiceField label={say('ملاحظة الإغلاق (اختياري)','Closing note (optional)')} multiline rows={2} value={closeNote} onChange={setCloseNote} contextKey={'support-close:'+entry.id} inputProps={{maxLength:2000}}/>
     <div className="service-button-row"><button type="button" className="btn primary" onClick={()=>perform({action:'close',note:closeNote.trim()})}><CheckCircle2 size={16} aria-hidden="true"/>{say('إغلاق الطلب','Close the request')}</button></div>
     {p.reject&&<><VoiceField label={say('أو إعادته إلى المندوب: لماذا؟','Or return it to the representative: why?')} value={rejectReason} onChange={setRejectReason} contextKey={'support-reject:'+entry.id} inputProps={{maxLength:2000}}/><button type="button" className="btn subtle" disabled={rejectReason.trim().length<3} onClick={()=>perform({action:'reject',reason:rejectReason.trim()})}>{say('إعادة إلى المندوب','Return to the representative')}</button></>}</div>}
    {p.cancel&&<div className="service-routing"><VoiceField label={say('إلغاء الطلب (اختياري: السبب)','Cancel the request (optional reason)')} value={cancelReason} onChange={setCancelReason} contextKey={'support-cancel:'+entry.id} inputProps={{maxLength:500}}/><button type="button" className="btn subtle danger" onClick={()=>perform({action:'cancel',reason:cancelReason.trim()})}>{say('إلغاء الطلب','Cancel the request')}</button></div>}
   </fieldset>
   {action.busy&&<p role="status">{say('جارٍ الحفظ','Saving')}</p>}{action.error&&<div className="form-error" role="alert">{t(action.error)}</div>}
   <section className="service-history support-story"><h3>{say('سير الطلب','The request\'s story')}</h3>{story.map(moment=><article key={moment.id}><header><strong>{moment.title}</strong><time>{stamp(moment.at)}</time></header><small>{moment.actor}</small>{moment.text&&<p>{moment.text}</p>}</article>)}</section>
  </div>
 </SheetContent></Sheet>;
}
