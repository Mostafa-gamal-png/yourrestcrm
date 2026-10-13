'use client';
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {CheckCircle2,Clock3,LifeBuoy,Loader2,MessageCircle,PhoneCall} from 'lucide-react';
import {Sheet,SheetContent,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {t,useLanguage,direction,getLanguage} from '@/lib/i18n';
import {definiteSubmitRejection,submitJson} from '@/lib/client-submit';
import {roles,today,type Member,type Row} from '@/lib/crm';
import {canRequestSupport,contactLinks,supportByCustomer,supportChannels,supportChannelsEn,supportGroups,supportOutcomes,supportOutcomesEn,visitedCustomers,type MissedEntry,type SupportEntry,type SupportGroupId} from '@/lib/support';
import {hoursText} from './service-queue';
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
const stateText=(entry:SupportEntry,say:Say)=>entry.state==='waiting'?say('بانتظار التولّي','Waiting to be taken'):entry.state==='in_progress'?say('قيد التواصل','In contact'):entry.state==='done'?say('تم التواصل','Contacted'):say('أُلغي','Cancelled');

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
 if(entry&&(entry.state==='waiting'||entry.state==='in_progress'))return <button type="button" className="support-chip" data-state={entry.state} data-customer={customerId} onClick={()=>support.onOpen(entry)}><LifeBuoy size={15} aria-hidden="true"/>{entry.state==='waiting'?say('بانتظار خدمة العملاء','Waiting for customer service'):say('خدمة العملاء تتواصل','Customer service is in contact')}</button>;
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
 take:{default:['بانتظار تولّيك','Waiting for you to take']},
 mine:{default:['قيد تواصلك','In your contact']},
 missed:{default:['زيارات مفقودة بانتظار التواصل','Missed visits waiting for contact'],customer_service:['زيارات مفقودة في منطقتك','Missed visits in your region']},
 missed_others:{default:['زيارات مفقودة مسندة لزميل','Missed visits routed to a colleague']},
 others:{default:['لدى زملائك','With your colleagues'],customer_service_manager:['لدى فريق خدمة العملاء','With the customer-service team'],admin:['لدى فريق خدمة العملاء','With the customer-service team']},
 waiting:{default:['بانتظار خدمة العملاء','Waiting for customer service']},
 answered:{default:['ردّت خدمة العملاء','Customer service replied']},
 finished:{default:['منتهية','Finished']}
};
const groupTitle=(id:SupportGroupId,role:string,say:Say)=>{const table=GROUP_TEXT[id],pair=table[role]||table.default;return say(pair[0],pair[1]);};
const VISIBLE_MISSED=8;

function RequestCard({entry,me,say,busy,onOpen,onTake}:{entry:SupportEntry;me:Member;say:Say;busy:boolean;onOpen:(entry:SupportEntry)=>void;onTake:(entry:SupportEntry)=>void}){
 const open=entry.state==='waiting'||entry.state==='in_progress',missed=entry.origin==='missed_visit';
 return <article className="support-card" data-request={entry.id} data-state={entry.state} data-awaiting={entry.awaiting||'none'} data-late={entry.late?'true':'false'} data-origin={entry.origin}>
  <header><div><h4>{entry.customerName}</h4>{(entry.customerPhone||entry.customerCity)&&<span className="support-phone" dir="ltr">{[entry.customerPhone,entry.customerCity].filter(Boolean).join(' · ')}</span>}</div><span className="badge pending">{stateText(entry,say)}</span></header>
  <div className="support-meta">
   <span className="support-chip-static">{missed?say('زيارة مفقودة','Missed visit'):say('طلب مساندة','Support request')}</span>
   {open&&<span className="support-chip-static"><Clock3 size={12} aria-hidden="true"/> {hoursText(entry.stageHours,say)}</span>}
   {entry.late&&<span className="support-chip-static" data-kind="late">{say('متأخر عن هدف '+entry.targetHours+' ساعات عمل','Late against a '+entry.targetHours+'-working-hour target')}</span>}
   {entry.unrouted&&<span className="support-chip-static" data-kind="escalated">{say('لا أحد يغطي منطقة العميل','Nobody covers this customer\'s region')}</span>}
   {entry.state==='done'&&entry.result&&<span className="support-chip-static" data-kind="done">{outcomeText(entry.result.outcome,say)}</span>}
  </div>
  {entry.note&&<p><b>{say('السبب: ','Reason: ')}</b>{entry.note}</p>}
  {entry.plan&&<p><b>{say('الزيارة المخطط لها: ','Planned visit: ')}</b>{[entry.plan.nextAction,entry.plan.nextDate].filter(Boolean).join(' · ')}</p>}
  {entry.result&&<p className="support-result"><b>{say('النتيجة: ','Result: ')}</b>{entry.result.note}{entry.result.nextDate&&<> · {say('موعد الزيارة المقترح ','Suggested visit date ')}<bdi>{entry.result.nextDate}</bdi></>}</p>}
  <small>{missed?say('فتحها: ','Opened by: '):say('طلبها: ','Asked by: ')}{entry.requestedByName||'—'}{entry.repName?' · '+say('مسؤول العميل: ','Customer owner: ')+entry.repName:''}{entry.handlerName?' · '+say('المتولّي: ','Holder: ')+entry.handlerName:''}</small>
  <div className="support-actions">
   {open&&isStaff(me.role)&&<ContactLinks phone={entry.customerPhone} say={say}/>}
   {entry.permissions.take&&<button type="button" className="btn primary" disabled={busy} onClick={()=>onTake(entry)}>{say('تولّي التواصل','Take this contact')}</button>}
   <button type="button" className={'btn '+(entry.awaiting==='contact'||entry.awaiting==='answer'?'primary':'subtle')} onClick={()=>onOpen(entry)}>{entry.awaiting==='contact'&&entry.permissions.result?say('تسجيل النتيجة','Record the result'):entry.awaiting==='answer'?say('عرض الرد','See the reply'):say('التفاصيل','Details')}</button>
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

/** What each role sees on the Visits page: customer service its work, sales members their requests and the replies. */
export function SupportPanel({data,me,onOpen,onChanged}:{data:SupportData|null;me:Member;onOpen:(entry:SupportEntry)=>void;onChanged:()=>Promise<void>}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const action=useAction(onChanged);
 if(!data)return null;
 const groups=supportGroups(data.requests,data.missed,me.role);
 if(!groups.length)return null;
 // The lists are cut at a fixed size; the counts come from the whole of them so nothing is hidden without being said.
 const missedTotal=Math.max(data.counts?.missed??0,data.missed.length),requestTotal=Math.max(data.counts?.requests??0,data.requests.length);
 const staff=isStaff(me.role),count=data.requests.filter(entry=>entry.state==='waiting'||entry.state==='in_progress').length+(staff?missedTotal:0);
 const cut=[missedTotal>data.missed.length?say('تُعرض '+data.missed.length+' من أصل '+missedTotal+' زيارة مفقودة، الأكثر تأخرًا أولًا، وتظهر البقية كلما عولجت هذه.','Showing '+data.missed.length+' of '+missedTotal+' missed visits, the most overdue first. The rest appear as these are handled.'):'',requestTotal>data.requests.length?say('تُعرض '+data.requests.length+' من أصل '+requestTotal+' طلبًا.','Showing '+data.requests.length+' of '+requestTotal+' requests.'):''].filter(Boolean);
 const takeRequest=(entry:SupportEntry)=>void action.run({action:'take',id:entry.id,version:entry.version});
 const takeMissed=(entry:MissedEntry)=>void action.run({action:'request',origin:'missed_visit',customerId:entry.customerId,customerVersion:entry.customerVersion,visitId:entry.visitId});
 return <section className="support-panel panel" aria-label={staff?say('التواصل مع العملاء','Customer contact'):say('مساندة خدمة العملاء','Customer-service assistance')} data-role={me.role} dir={language==='en'?'ltr':'rtl'}>
  <div className="support-heading"><div><h2><LifeBuoy size={18} aria-hidden="true"/> {staff?say('التواصل مع العملاء','Customer contact'):say('مساندة خدمة العملاء','Customer-service assistance')}</h2><p>{staff?say('طلبات المساندة من المبيعات والزيارات المفقودة في نطاقك.','Assistance requests from sales and missed visits in your scope.'):me.role==='rep'?say('طلباتك لخدمة العملاء وردودها.','Your requests to customer service and their replies.'):say('طلبات فريقك لخدمة العملاء وردودها.','Your team\'s requests to customer service and their replies.')}</p></div><span className="support-count">{count}</span></div>
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
  <DialogDescription>{say('تتواصل خدمة العملاء مع هذا العميل نيابة عنك وتصلك النتيجة هنا: ','Customer service contacts this customer for you and the result comes back here: ')}<b>{customer.data.name}</b></DialogDescription>
  <fieldset disabled={action.busy} className="support-form">
   <label className="field"><span>{say('ما المطلوب من خدمة العملاء؟','What should customer service do?')} <b>*</b></span><textarea value={note} onChange={event=>setNote(event.target.value)} maxLength={2000} rows={4} placeholder={say('مثال: العميل لا يرد على اتصالاتي، اسألوه عن موعد مناسب للزيارة','For example: the customer is not answering my calls, ask for a suitable visit date')}/></label>
   <label className="field"><span>{say('وسيلة التواصل المفضلة','Preferred way to reach them')}</span><select value={channel} onChange={event=>setChannel(event.target.value)}>{Object.keys(supportChannels).map(key=><option key={key} value={key}>{channelText(key,say)}</option>)}</select></label>
   <p className="form-note">{say('تظهر ملاحظتك لخدمة العملاء في منطقة العميل ولمن فوقك في المبيعات. لا تُحتسب زيارة ولا تغيّر خطة المتابعة.','Your note is shown to customer service for the customer\'s region and to those above you in sales. It does not count as a visit and does not change the follow-up plan.')}</p>
   {action.error&&<div className="form-error" role="alert">{t(action.error)}</div>}
   <div className="service-button-row"><button type="button" className="btn primary" disabled={note.trim().length<3} onClick={()=>void action.run({action:'request',origin:'rep',customerId:customer.id,customerVersion:customer.version,note:note.trim(),channel})}>{action.busy?<Loader2 className="spin" size={16}/>:<LifeBuoy size={16} aria-hidden="true"/>}{say('إرسال الطلب','Send the request')}</button><button type="button" className="btn subtle" onClick={onClose}>{say('إلغاء','Cancel')}</button></div>
  </fieldset>
 </DialogContent></Dialog>;
}

/** One request: who asked and why, where it stands and what the reader may do with it. */
export function SupportSheet({entry,onClose,onChanged}:{entry:SupportEntry;onClose:()=>void;onChanged:()=>Promise<void>}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const action=useAction(onChanged),[outcome,setOutcome]=useState(''),[note,setNote]=useState(''),[nextDate,setNextDate]=useState(''),[target,setTarget]=useState(entry.candidates[0]?.id||''),[reason,setReason]=useState('');
 const opened=useRef('');
 const {run}=action;
 useEffect(()=>{
  if(!entry.permissions.seen||opened.current===entry.id+':'+entry.version)return;
  opened.current=entry.id+':'+entry.version;void run({action:'seen',id:entry.id,version:entry.version});
 },[entry.id,entry.version,entry.permissions.seen,run]);
 const links=contactLinks(entry.customerPhone),open=entry.state==='waiting'||entry.state==='in_progress';
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
  ...(open?[[say('مدة الانتظار','Waiting'),hoursText(entry.stageHours,say)+(entry.late?' · '+say('متأخر','late'):'')] as [string,React.ReactNode]]:[]),
  ...(entry.result?[[say('النتيجة','Result'),outcomeText(entry.result.outcome,say)] as [string,React.ReactNode],[say('تفاصيل النتيجة','Result details'),entry.result.note] as [string,React.ReactNode],...(entry.result.nextDate?[[say('موعد الزيارة المقترح','Suggested visit date'),entry.result.nextDate] as [string,React.ReactNode]]:[]),[say('سجّلها','Recorded by'),(entry.result.byName||'—')+' · '+stamp(entry.result.at)] as [string,React.ReactNode]]:[]),
  ...(entry.state==='cancelled'?[[say('سبب الإلغاء','Cancellation reason'),entry.cancelReason||'—'] as [string,React.ReactNode]]:[])
 ];
 const perform=(body:Record<string,unknown>)=>void run({...body,id:entry.id,version:entry.version});
 return <Sheet open onOpenChange={value=>{if(!value)onClose();}}><SheetContent side={direction()==='rtl'?'left':'right'} className="crm-sheet service-sheet support-sheet" dir={direction()}>
  <SheetTitle>{say('مساندة خدمة العملاء','Customer-service assistance')}</SheetTitle><SheetDescription>{entry.customerName}</SheetDescription>
  <div className="service-detail"><div className="service-status"><span className="badge pending">{stateText(entry,say)}</span>{entry.late&&<span className="support-chip-static" data-kind="late">{say('متأخر','Late')}</span>}</div>
   <dl className="service-facts">{facts.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
   <fieldset disabled={action.busy} className="service-actions">
    {entry.permissions.take&&<div className="service-button-row"><button type="button" className="btn primary" onClick={()=>perform({action:'take'})}>{say('تولّي التواصل','Take this contact')}</button></div>}
    {entry.permissions.assign&&entry.candidates.length>0&&<div className="service-routing"><label className="field"><span>{say('تكليف ممثل لخدمة العملاء','Assign a customer-service member')}</span><select value={target} onChange={event=>setTarget(event.target.value)}>{entry.candidates.map(member=><option key={member.id} value={member.id}>{member.name} · {t(roles[member.role])}</option>)}</select></label><button type="button" className="btn subtle" disabled={!target} onClick={()=>perform({action:'assign',targetId:target})}>{say('تأكيد التكليف','Confirm the assignment')}</button></div>}
    {entry.permissions.result&&<div className="service-internal"><label className="field"><span>{say('نتيجة التواصل','Result of the contact')}</span><select value={outcome} onChange={event=>setOutcome(event.target.value)}><option value="">{say('اختر','Choose')}</option>{Object.keys(supportOutcomes).map(key=><option key={key} value={key}>{outcomeText(key,say)}</option>)}</select></label>
     {outcome==='wants_visit'&&<label className="field"><span>{say('الموعد الذي يطلبه العميل','The date the customer asks for')}</span><input type="date" min={today()} value={nextDate} onChange={event=>setNextDate(event.target.value)}/></label>}
     <label className="field"><span>{say('ما حدث في التواصل','What happened in the contact')}</span><textarea value={note} onChange={event=>setNote(event.target.value)} maxLength={2000} rows={3} placeholder={say('اكتب ما قاله العميل وما اتُّفق عليه','Write what the customer said and what was agreed')}/></label>
     <p className="form-note">{say('تصل النتيجة إلى المندوب ومن فوقه، ولا تُحتسب زيارة.','The result reaches the representative and those above them. It does not count as a visit.')}</p>
     <button type="button" className="btn primary" disabled={!outcome||note.trim().length<3||outcome==='wants_visit'&&!nextDate} onClick={()=>perform({action:'result',outcome,note:note.trim(),nextDate:outcome==='wants_visit'?nextDate:''})}><CheckCircle2 size={16} aria-hidden="true"/>{say('تسجيل النتيجة','Record the result')}</button></div>}
    {entry.permissions.cancel&&<div className="service-routing"><label className="field"><span>{say('إلغاء الطلب (اختياري: السبب)','Cancel the request (optional reason)')}</span><input type="text" value={reason} maxLength={500} onChange={event=>setReason(event.target.value)}/></label><button type="button" className="btn subtle danger" onClick={()=>perform({action:'cancel',reason:reason.trim()})}>{say('إلغاء الطلب','Cancel the request')}</button></div>}
   </fieldset>
   {action.busy&&<p role="status">{say('جارٍ الحفظ','Saving')}</p>}{action.error&&<div className="form-error" role="alert">{t(action.error)}</div>}
  </div>
 </SheetContent></Sheet>;
}
