'use client';
import {BellRing,ClipboardList,Clock3,PhoneCall} from 'lucide-react';
import {t,useLanguage} from '@/lib/i18n';
import {stageLabels,type Member} from '@/lib/crm';
import {strengthLabels} from '@/lib/customer-visits';
import {serviceSources,serviceStatusLabels} from '@/lib/customer-service';
import {queueGroups,serviceQueueBadge,serviceRoleWarning,type QueueGroupId,type QueueStage,type ServiceQueueEntry} from '@/lib/service-queue';
import './service-queue.css';

type Say=(ar:string,en:string)=>string;
const STAGE_TEXT:Record<QueueStage,[string,string]>={
 approval:['بانتظار اعتماد خدمة العملاء','Awaiting customer-service approval'],
 returned:['مطلوب تعديل','Needs correction'],
 assignment:['بانتظار تكليف المبيعات','Awaiting sales assignment'],
 delegation:['لدى المشرف بانتظار التفويض','With the supervisor, awaiting delegation'],
 first_contact:['بانتظار أول تواصل','Awaiting first contact'],
 follow_up:['قيد متابعة المبيعات','Sales follow-up in progress'],
 closed:['منتهي','Closed']
};
const GROUP_TEXT:Record<QueueGroupId,Record<string,[string,string]>>={
 mine:{default:['بانتظار إجرائي','Waiting for my action'],admin:['بانتظار اعتماد أو تكليف','Waiting for approval or assignment'],manager:['بانتظار تكليفي','Waiting for my assignment'],customer_service_manager:['بانتظار اعتمادي','Waiting for my approval']},
 late:{default:['تأخرت عند فريقك','Late with your team'],admin:['متأخرة عن هدفها','Late against target']},
 new:{default:['جديد: طلبات محالة إليك','New: requests assigned to you']},
 active:{default:['قيد المتابعة','In progress']},
 closed:{default:['منتهية','Closed']}
};
const groupTitle=(id:QueueGroupId,role:string,say:Say)=>{const table=GROUP_TEXT[id],pair=table[role]||table.default;return say(pair[0],pair[1]);};
const ACTION_TEXT:Record<string,[string,string]>={approve:['اعتماد أو إعادة','Approve or return'],assign:['تكليف','Assign'],delegate:['تفويض مندوب','Delegate'],first_contact:['فتح الطلب','Open request']};

/** "n working hours", rounded, with a floor wording. */
export function hoursText(hours:number,say:Say){
 if(!(hours>=1))return say('أقل من ساعة عمل','under a working hour');
 const whole=Math.round(hours);return say(whole+' ساعة عمل',whole+(whole===1?' working hour':' working hours'));
}
const stamp=(iso:string)=>new Date(iso).toLocaleString('en-GB',{timeZone:'Asia/Riyadh'});

function QueueCard({entry,me,say,onOpen,onVisit}:{entry:ServiceQueueEntry;me:Member;say:Say;onOpen:(entry:ServiceQueueEntry)=>void;onVisit:(entry:ServiceQueueEntry)=>void}){
 const stage=entry.stage==='closed'?serviceStatusLabels[entry.state]||STAGE_TEXT.closed[0]:undefined;
 const holderView=entry.assignedTo===me.id&&(entry.stage==='first_contact'||entry.stage==='delegation');
 const trackSeen=!holderView&&(entry.stage==='first_contact'||entry.stage==='delegation');
 const action=entry.awaiting?ACTION_TEXT[entry.awaiting]:undefined;
 return <article className="service-queue-card" data-case={entry.id} data-stage={entry.stage} data-awaiting={entry.awaiting||'none'} data-late={entry.late?'true':'false'}>
  <header><div><h4>{entry.customerName}</h4>{(entry.customerPhone||entry.customerCity)&&<span className="service-queue-phone" dir="ltr">{[entry.customerPhone,entry.customerCity].filter(Boolean).join(' · ')}</span>}</div>
   <span className="badge pending">{stage?t(stage):say(STAGE_TEXT[entry.stage][0],STAGE_TEXT[entry.stage][1])}</span></header>
  <div className="service-queue-meta">
   {entry.source&&<span className="service-queue-chip">{t(serviceSources[entry.source]||entry.source)}</span>}
   {entry.strength&&<span className="service-queue-chip" data-kind={entry.strength==='strong'?'strong':undefined}>{t(strengthLabels[entry.strength]||entry.strength)}</span>}
   {entry.stage!=='closed'&&entry.stage!=='follow_up'&&<span className="service-queue-chip"><Clock3 size={12} aria-hidden="true"/> {hoursText(entry.stageHours,say)}</span>}
   {entry.late&&<span className="service-queue-chip" data-kind="late">{say('متأخر عن هدف '+entry.targetHours+' ساعات عمل','Late against a '+entry.targetHours+'-working-hour target')}</span>}
   {entry.escalated&&<span className="service-queue-chip" data-kind="escalated">{say('تأخر عند '+(entry.assignedName||entry.salesManagerName),'Late with '+(entry.assignedName||entry.salesManagerName))}</span>}
   {entry.salesStage&&entry.stage==='follow_up'&&stageLabels[entry.salesStage]&&<span className="service-queue-chip">{t(stageLabels[entry.salesStage])}</span>}
  </div>
  {entry.products.length>0&&<p><b>{say('الأصناف: ','Products: ')}</b>{entry.products.map(product=>t(product)).join(' · ')}</p>}
  {entry.needs&&<p><b>{say('الاحتياج: ','Need: ')}</b>{entry.needs}</p>}
  {(entry.nextAction||entry.nextDate)&&<p><b>{say('الخطوة القادمة: ','Next step: ')}</b>{[entry.nextAction,entry.nextDate].filter(Boolean).join(' · ')}</p>}
  {holderView&&entry.assignmentNote&&<p className="service-queue-note"><b>{say('توجيه من '+(entry.assignmentNoteBy||'المدير')+': ','Instruction from '+(entry.assignmentNoteBy||'your manager')+': ')}</b>{entry.assignmentNote}</p>}
  <small>{say('سجّله: ','Registered by: ')}{entry.creatorName||'—'}{entry.assignedName?' · '+say('المكلَّف: ','Holder: ')+entry.assignedName:''}</small>
  {trackSeen&&<small>{entry.seenAt?say('فتحه '+entry.seenByName+' في '+stamp(entry.seenAt),'Opened by '+entry.seenByName+' on '+stamp(entry.seenAt)):say('لم يفتحه المكلَّف بعد','Not opened by the holder yet')}</small>}
  <div className="service-queue-actions">
   {entry.awaiting==='first_contact'&&<button type="button" className="btn primary" onClick={()=>onVisit(entry)}><PhoneCall size={16} aria-hidden="true"/>{say('تسجيل زيارة','Record a visit')}</button>}
   <button type="button" className={'btn '+(entry.awaiting&&entry.awaiting!=='first_contact'?'primary':'subtle')} onClick={()=>onOpen(entry)}>{action&&entry.awaiting!=='first_contact'?say(action[0],action[1]):say('تفاصيل الطلب','Request details')}</button>
  </div>
 </article>;
}

/** The customer-service requests a sales reader can see, grouped by what they must do. */
export function ServiceQueuePanel({entries,me,onOpen,onVisit}:{entries:ServiceQueueEntry[];me:Member;onOpen:(entry:ServiceQueueEntry)=>void;onVisit:(entry:ServiceQueueEntry)=>void}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 if(!entries.length)return null;
 const groups=queueGroups(entries,me.role).filter(group=>group.entries.length),open=entries.filter(entry=>entry.stage!=='closed').length;
 return <section className="service-queue panel" aria-label={say('طلبات خدمة العملاء','Customer-service requests')} data-role={me.role} dir={language==='en'?'ltr':'rtl'}>
  <div className="service-queue-heading"><div><h2><ClipboardList size={18} aria-hidden="true"/> {say('طلبات خدمة العملاء','Customer-service requests')}</h2><p>{me.role==='rep'?say('طلبات أحالتها خدمة العملاء إليك لمتابعة العميل.','Requests customer service has assigned to you to follow up with the customer.'):me.role==='customer_service_manager'?say('طلبات بانتظار اعتمادك، وتظهر عليها علامة «متأخر» إن مرّت 4 ساعات عمل دون اعتماد أو إعادة.','Requests waiting for your approval. They are marked late once 4 working hours pass without approval or return.'):say('طلبات خدمة العملاء في نطاقك وما ينتظر إجراءك فيها.','Customer-service requests in your scope and what waits for you.')}</p></div><span className="service-queue-count">{open}</span></div>
  {groups.map(group=>{
   const cards=group.entries.map(entry=><QueueCard key={entry.id} entry={entry} me={me} say={say} onOpen={onOpen} onVisit={onVisit}/>);
   if(group.id==='closed')return <details key={group.id} className="service-queue-closed" data-group={group.id}><summary>{groupTitle(group.id,me.role,say)} <span className="service-queue-count">{group.entries.length}</span></summary><div className="service-queue-cards">{cards}</div></details>;
   return <div key={group.id} className="service-queue-group" data-group={group.id}><h3>{groupTitle(group.id,me.role,say)} <span className="service-queue-count">{group.entries.length}</span></h3><div className="service-queue-cards">{cards}</div></div>;
  })}
 </section>;
}

/** Shown on every page to a representative while a case waits for their first contact. It leaves by itself with that contact. */
export function ServiceQueueBanner({entries,onOpen,onVisit}:{entries:ServiceQueueEntry[];onOpen:(entry:ServiceQueueEntry)=>void;onVisit:(entry:ServiceQueueEntry)=>void}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const waiting=entries.filter(entry=>entry.awaiting==='first_contact');
 if(!waiting.length)return null;
 const first=waiting[0],more=waiting.length-1;
 return <section className="service-queue-banner no-print" role="status" data-count={waiting.length} dir={language==='en'?'ltr':'rtl'}>
  <BellRing size={20} aria-hidden="true"/>
  <div className="service-queue-banner-text"><strong>{say('طلب محال إليك من خدمة العملاء: '+first.customerName,'Customer-service request assigned to you: '+first.customerName)}{more>0&&<> · {say('و'+more+' أخرى','and '+more+' more')}</>}</strong>{first.needs&&<span>{first.needs}</span>}{first.assignmentNote&&<span>{say('توجيه: ','Instruction: ')}{first.assignmentNote}</span>}</div>
  <div className="service-queue-actions"><button type="button" className="btn primary" onClick={()=>onVisit(first)}>{say('تسجيل زيارة','Record a visit')}</button><button type="button" className="btn subtle" onClick={()=>onOpen(first)}>{say('فتح الطلب','Open request')}</button></div>
 </section>;
}

/** The count on the Visits entry of the navigation. */
export function QueueBadge({entries}:{entries:ServiceQueueEntry[]}){
 const {language}=useLanguage(),count=serviceQueueBadge(entries);
 if(!count)return null;
 return <span className="nav-badge" role="img" aria-label={language==='en'?count+' customer-service requests need your action':count+' من طلبات خدمة العملاء تنتظر إجراءك'}>{count}</span>;
}

/** Under a customer-service member on the team page when their reporting line cannot carry a request. */
export function RoleWarning({member,members}:{member:Member;members:Member[]}){
 const {language}=useLanguage(),warning=serviceRoleWarning(member,members);
 if(!warning)return null;
 const say:Say=(ar,en)=>language==='en'?en:ar;
 return <small className="team-role-warning" role="note">{warning==='no_service_manager'?say('غير مرتبط بمدير خدمة عملاء: لا يعتمد طلباته إلا مدير النظام','Not linked to a customer-service manager: only an administrator can approve their requests'):say('غير مرتبط بمدير مبيعات: لا يستطيع إحالة الطلبات','Not linked to a sales manager: cannot route requests')}</small>;
}
