import type {Member,Row} from './crm';
import {customerPlanSource} from './customer-visits';
import {followupClosed} from './customer-followups';
import {memberCanAccessRegion,regionScope} from './regions';
import {salesScopeMemberIds} from './access';
import {riyadhDate,visitResult} from './visits';
import {workingHoursBetween} from './working-hours';

/** Customer-service assistance: a sales member asks customer service to contact a customer, and a visit that went
 * unanswered is routed to customer service on its own. A request is a `crm_records` row of kind `support` with no
 * parent (so no customer-tree rule, deletion rule or older release ever treats it as a visit or a case); everything it
 * carries is in `data`. Nothing here feeds a sales target, a sales evaluation or a movement calculation: the figures are
 * for follow-up, and the customer-service evaluation (`lib/service-kpi.ts`) reads the requests to evaluate customer service itself. */
export const SUPPORT_KIND='support';
/** Working hours customer service has to answer a request that is waiting, from the moment it was made. */
export const SUPPORT_TARGET_HOURS=4;
/** A visit with a negative result is missed once its follow-up date is this many days behind us ... */
export const MISSED_VISIT_GRACE_DAYS=2;
/** ... and is routed for this many days after that, so old history never floods customer service. */
export const MISSED_VISIT_WINDOW_DAYS=30;
/** Finished requests stay in the lists for this long. */
export const SUPPORT_HISTORY_DAYS=30;
/** A list holds this many entries unless its caller asks for all of them; the route always reports the true total beside it. */
export const SUPPORT_LIST_LIMIT=300;
export const SUPPORT_NOTE_MAX=2000;
export const supportOutcomes:Record<string,string>={reached_interested:'تم التواصل والعميل مهتم',reached_not_interested:'تم التواصل والعميل غير مهتم',wants_visit:'العميل يطلب زيارة في موعد',no_answer:'لم يرد العميل',wrong_number:'الرقم غير صحيح أو غير متاح',other:'أخرى'};
export const supportChannels:Record<string,string>={any:'أي وسيلة',call:'اتصال',whatsapp:'واتساب'};
export const supportActions:Record<string,string>={request:'طلب مساندة خدمة العملاء',take:'تولّي التواصل',assign:'تكليف ممثل خدمة العملاء',result:'تسجيل نتيجة التواصل',cancel:'إلغاء الطلب',seen:'الاطلاع على الرد'};

export type SupportStatus='open'|'done'|'cancelled';
export type SupportOrigin='rep'|'missed_visit';
export type SupportState='waiting'|'in_progress'|'done'|'cancelled';
export type SupportPlan={visitId:string;visitDate:string;result:string;nextAction:string;nextDate:string};
export type SupportResult={outcome:string;note:string;nextDate:string;by:string;at:string};
export type SupportData={
 kind:'support';customerId:string;origin:SupportOrigin;status:SupportStatus;
 requestedBy:string;requestedAt:string;/** The customer's responsible member when the request was made. */repId:string;note:string;channel:string;plan?:SupportPlan;
 /** Empty while nobody has taken it. */handlerId:string;handlerAt:string;handlerBy:string;
 result?:SupportResult;cancelledBy?:string;cancelledAt?:string;cancelReason?:string;answerSeenAt?:string;answerSeenBy?:string;
};
export type SupportRow={id:string;branch:string;assignedTo:string;data:SupportData;createdAt:string;updatedAt:string;version:number};
export type SupportContext={me:Member;members:Member[];all:Row[];visible:Row[];support:SupportRow[]};
export type SupportAwaiting='take'|'contact'|'assign'|'answer'|null;
export type SupportEntry={
 id:string;customerId:string;customerName:string;customerPhone:string;customerCity:string;customerRegion:string;customerVersion:number;
 origin:SupportOrigin;state:SupportState;note:string;channel:string;plan:SupportPlan|null;
 requestedBy:string;requestedByName:string;repId:string;repName:string;handlerId:string;handlerName:string;
 result:{outcome:string;note:string;nextDate:string;by:string;byName:string;at:string}|null;
 answerSeen:boolean;cancelReason:string;cancelledByName:string;
 createdAt:string;updatedAt:string;version:number;
 stageHours:number;targetHours:number;late:boolean;
 /** Nobody in customer service covers this customer's branch and region. */
 unrouted:boolean;awaiting:SupportAwaiting;
 permissions:{take:boolean;assign:boolean;result:boolean;cancel:boolean;seen:boolean};
 candidates:{id:string;name:string;role:string}[];
};
export type MissedEntry={
 id:string;visitId:string;customerId:string;customerName:string;customerPhone:string;customerCity:string;customerRegion:string;customerVersion:number;
 repId:string;repName:string;plan:SupportPlan;overdueDays:number;missedSince:string;
 /** The customer-service member whose region this is, when exactly one is assigned to it. */
 routedToId:string;routedToName:string;unrouted:boolean;
 permissions:{take:boolean};
};

const DAY=86400000;
/** `YYYY-MM-DD` plus a whole number of days; calendar arithmetic only, no time zone involved. */
export function addDays(date:string,days:number){const time=Date.parse(date+'T00:00:00Z');return Number.isFinite(time)&&/^\d{4}-\d{2}-\d{2}$/.test(date)?new Date(time+days*DAY).toISOString().slice(0,10):'';}
export function daysBetween(from:string,to:string){const a=Date.parse(from+'T00:00:00Z'),b=Date.parse(to+'T00:00:00Z');return Number.isFinite(a)&&Number.isFinite(b)?Math.round((b-a)/DAY):0;}
/** The instant a Riyadh calendar day begins (UTC+3 all year). */
export const riyadhDayStart=(date:string)=>{const time=Date.parse(date+'T00:00:00Z');return Number.isFinite(time)?new Date(time-3*3600000).toISOString():'';};
/** Only a visit's own recorded result counts; a follow-up's result is free text and never reads as negative. */
export const isNegativeResult=(data:{result?:string;outcome?:string})=>{const result=visitResult(data);return result==='سلبية'||result==='لم يتم التواصل';};
export const isSupportRow=(row:{kind?:string})=>row.kind===SUPPORT_KIND;
export const supportState=(data:Pick<SupportData,'status'|'handlerId'>):SupportState=>data.status==='done'?'done':data.status==='cancelled'?'cancelled':data.handlerId?'in_progress':'waiting';

/** A phone number as typed, as dial and WhatsApp links. WhatsApp needs the international form, so it is offered only for a
 * Saudi mobile number or a number written with its country code. */
export function contactLinks(phone:unknown):{tel:string;whatsapp:string}{
 const raw=String(phone??'').replace(/[٠-٩]/g,digit=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).trim(),digits=raw.replace(/\D/g,'');
 if(digits.length<7||digits.length>15)return {tel:'',whatsapp:''};
 const tel='tel:'+(raw.startsWith('+')?'+':'')+digits;
 let international='';
 if(raw.startsWith('+'))international=digits;
 else if(digits.startsWith('00'))international=digits.slice(2);
 else if(/^05\d{8}$/.test(digits))international='966'+digits.slice(1);
 else if(/^5\d{8}$/.test(digits))international='966'+digits;
 else if(/^9665\d{8}$/.test(digits))international=digits;
 return {tel,whatsapp:international.length>=10&&international.length<=15?'https://wa.me/'+international:''};
}

export type SupportReader={me:Member;admin:boolean;service:boolean;lead:boolean;sales:boolean;team:Set<string>};
/** What the reader is, and whose records their team covers; built once per request. */
export function supportReader(c:{me:Member;members:Member[]}):SupportReader{
 const role=c.me.role;
 return {me:c.me,admin:role==='admin',service:role==='customer_service',lead:role==='customer_service_manager',sales:role==='rep'||role==='supervisor'||role==='manager',team:salesScopeMemberIds(c.members,c.me)};
}
/** The customer-service members who cover a customer's branch and region, and the one a request is routed to when exactly
 * one of them is assigned to that region by name (the rest, assigned to every region, share what is not routed). */
export function supportStaff(customer:Row,members:Member[]){
 const covers=(member:Member)=>!!member.active&&member.branch===customer.branch&&memberCanAccessRegion(member,customer.data.region);
 const reps=members.filter(member=>member.role==='customer_service'&&covers(member)),leads=members.filter(member=>member.role==='customer_service_manager'&&covers(member));
 const named=reps.filter(member=>regionScope(member)!=='all');
 return {reps,leads,routedTo:named.length===1?named[0]:undefined};
}
/** Whether the reader may see this request: administrators all, customer service their branch and region, sales members what their team asked for or owns. */
export function canReadSupport(row:SupportRow,customer:Row|undefined,reader:SupportReader){
 if(!customer||customer.kind!=='customer'||!memberCanAccessRegion(reader.me,customer.data.region))return false;
 if(reader.admin)return true;
 if(reader.service||reader.lead)return customer.branch===reader.me.branch;
 return reader.sales&&[row.data.requestedBy,row.data.repId,customer.assignedTo].some(id=>!!id&&reader.team.has(id));
}
/** Customers the reader has a visit record under: a representative asks for help with a customer they have visited. */
export function visitedCustomers(visible:Row[]){
 const indexed=new Map(visible.map(row=>[row.id,row])),found=new Set<string>();
 for(const row of visible){
  if(row.kind!=='activity')continue;
  let parent:Row|undefined=row;
  for(let depth=0;parent&&depth<5&&parent.kind!=='customer';depth++)parent=parent.parentId?indexed.get(parent.parentId):undefined;
  if(parent?.kind==='customer')found.add(parent.id);
 }
 return found;
}
/** Who may ask customer service for help with a customer: an administrator, or a sales member whose team owns the customer or has visited them. */
export function canRequestSupport(customer:Row|undefined,c:{me:Member;members:Member[];visible:Row[]},visited?:Set<string>){
 if(!customer||customer.kind!=='customer'||!memberCanAccessRegion(c.me,customer.data.region))return false;
 if(c.me.role==='admin')return true;
 const reader=supportReader(c);
 if(!reader.sales)return false;
 return (!!customer.assignedTo&&reader.team.has(customer.assignedTo))||(visited||visitedCustomers(c.visible)).has(customer.id);
}
export function supportPermissions(row:SupportRow,customer:Row,reader:SupportReader){
 const open=row.data.status==='open',handler=row.data.handlerId,asked=row.data.requestedBy;
 return {
  take:open&&!handler&&(reader.service||reader.lead||reader.admin),
  assign:open&&(reader.lead||reader.admin),
  result:open&&(reader.admin||reader.lead||reader.service&&(!handler||handler===reader.me.id)),
  cancel:open&&(reader.admin||asked===reader.me.id||reader.sales&&reader.team.has(asked)||reader.lead&&row.data.origin==='missed_visit'),
  seen:row.data.status==='done'&&!row.data.answerSeenAt&&reader.sales&&[asked,row.data.repId,customer.assignedTo].includes(reader.me.id)
 };
}

const finishedRecently=(row:SupportRow,now:string)=>row.data.status==='open'||Date.parse(now)-Date.parse(row.updatedAt)<=SUPPORT_HISTORY_DAYS*DAY;
/** The requests the reader may see: what waits for them first, then the late ones, the oldest open ones, the newest answers. */
export function sortSupport(entries:SupportEntry[]){
 return [...entries].sort((a,b)=>Number(!!b.awaiting)-Number(!!a.awaiting)||Number(b.late)-Number(a.late)||Number(a.state==='done'||a.state==='cancelled')-Number(b.state==='done'||b.state==='cancelled')||(a.state==='done'||a.state==='cancelled'?b.updatedAt.localeCompare(a.updatedAt):a.createdAt.localeCompare(b.createdAt))||a.id.localeCompare(b.id));
}
export function supportQueue(c:SupportContext,now:string=new Date().toISOString(),limit:number=SUPPORT_LIST_LIMIT):SupportEntry[]{
 const reader=supportReader(c),member=(id:string|null|undefined)=>id?c.members.find(m=>m.id===id):undefined,name=(id:string|null|undefined)=>member(id)?.name||'';
 if(!reader.admin&&!reader.service&&!reader.lead&&!reader.sales)return [];
 const customers=new Map(c.all.filter(row=>row.kind==='customer').map(row=>[row.id,row])),entries:SupportEntry[]=[];
 for(const row of c.support){
  const customer=customers.get(row.data.customerId);
  if(!customer||!canReadSupport(row,customer,reader)||!finishedRecently(row,now))continue;
  const staff=supportStaff(customer,c.members),state=supportState(row.data),open=row.data.status==='open',permissions=supportPermissions(row,customer,reader);
  const stageHours=open?workingHoursBetween(row.createdAt,now):0,late=open&&stageHours>SUPPORT_TARGET_HOURS,unrouted=open&&!row.data.handlerId&&!staff.reps.length;
  const awaiting:SupportAwaiting=permissions.seen?'answer':reader.service?(state==='waiting'&&permissions.take?'take':state==='in_progress'&&row.data.handlerId===reader.me.id?'contact':null):(reader.lead||reader.admin)?(open&&(late||unrouted)?'assign':open&&row.data.handlerId===reader.me.id?'contact':null):null;
  const result=row.data.result;
  entries.push({
   id:row.id,customerId:customer.id,customerName:String(customer.data.name||''),customerPhone:String(customer.data.phone||''),customerCity:String(customer.data.city||''),customerRegion:String(customer.data.region||''),customerVersion:customer.version,
   origin:row.data.origin,state,note:String(row.data.note||''),channel:String(row.data.channel||'any'),plan:row.data.plan||null,
   requestedBy:row.data.requestedBy,requestedByName:name(row.data.requestedBy),repId:row.data.repId,repName:name(row.data.repId||customer.assignedTo),handlerId:row.data.handlerId||'',handlerName:name(row.data.handlerId),
   result:result?{outcome:result.outcome,note:result.note,nextDate:result.nextDate,by:result.by,byName:name(result.by),at:result.at}:null,
   answerSeen:!!row.data.answerSeenAt,cancelReason:String(row.data.cancelReason||''),cancelledByName:name(row.data.cancelledBy),
   createdAt:row.createdAt,updatedAt:row.updatedAt,version:row.version,
   stageHours,targetHours:SUPPORT_TARGET_HOURS,late,unrouted,awaiting,permissions,
   candidates:permissions.assign?[...staff.reps,...staff.leads].filter(m=>m.id!==row.data.handlerId).map(m=>({id:m.id,name:m.name,role:m.role})):[]
  });
 }
 return sortSupport(entries).slice(0,limit);
}

/** Every record under its customer, in one pass: each customer's own slice is then read with the same rule the follow-up
 * lists use (`customerPlanSource`), so "the customer's latest plan" has one definition. */
export function groupByCustomer(all:Row[]){
 const indexed=new Map(all.map(row=>[row.id,row])),groups=new Map<string,Row[]>();
 for(const row of all){
  let current:Row|undefined=row;
  for(let depth=0;current&&depth<5&&current.kind!=='customer';depth++)current=current.parentId?indexed.get(current.parentId):undefined;
  if(current?.kind!=='customer')continue;
  const list=groups.get(current.id);
  if(list)list.push(row);else groups.set(current.id,[row]);
 }
 return groups;
}
/** Visits whose last result was negative and whose follow-up date is two days behind us with no contact since, for the customers
 * customer service covers (an administrator: all). They are derived on read: nothing is stored until someone takes one.
 * The most overdue come first; `limit` cuts the list for display, and `Infinity` returns every one for counting and for taking. */
export function missedVisits(c:{me:Member;members:Member[];all:Row[];support:SupportRow[]},now:string=new Date().toISOString(),limit:number=SUPPORT_LIST_LIMIT):MissedEntry[]{
 const me=c.me,admin=me.role==='admin',service=me.role==='customer_service',lead=me.role==='customer_service_manager';
 if(!admin&&!service&&!lead)return [];
 const day=riyadhDate(now),member=(id:string|null|undefined)=>id?c.members.find(m=>m.id===id):undefined;
 const handledPlans=new Set(c.support.map(row=>row.data.plan?.visitId).filter((id):id is string=>!!id)),openCustomers=new Set(c.support.filter(row=>row.data.status==='open').map(row=>row.data.customerId));
 const groups=groupByCustomer(c.all),entries:MissedEntry[]=[];
 for(const row of c.all){
  if(row.kind!=='customer'||!memberCanAccessRegion(me,row.data.region)||!admin&&row.branch!==me.branch||openCustomers.has(row.id))continue;
  const source=customerPlanSource(row.id,groups.get(row.id)||[row]);
  if(!source||source.kind!=='activity'||['followup-v1','service-intake-v1'].includes(source.data.visitWorkflow)||!isNegativeResult(source.data))continue;
  if(followupClosed(source.data.salesStage||'')||source.data.followupStatus==='closed'||handledPlans.has(source.id))continue;
  const nextDate=String(source.data.nextDate||''),missedFrom=addDays(nextDate,MISSED_VISIT_GRACE_DAYS);
  if(!missedFrom||day<missedFrom||day>=addDays(missedFrom,MISSED_VISIT_WINDOW_DAYS))continue;
  const staff=supportStaff(row,c.members),routed=staff.routedTo;
  entries.push({
   id:'missed-'+source.id,visitId:source.id,customerId:row.id,customerName:String(row.data.name||''),customerPhone:String(row.data.phone||''),customerCity:String(row.data.city||''),customerRegion:String(row.data.region||''),customerVersion:row.version,
   repId:row.assignedTo,repName:member(row.assignedTo)?.name||'',
   plan:{visitId:source.id,visitDate:String(source.data.date||''),result:String(visitResult(source.data)),nextAction:String(source.data.nextAction||''),nextDate},
   overdueDays:daysBetween(nextDate,day),missedSince:riyadhDayStart(missedFrom),
   routedToId:routed?.id||'',routedToName:routed?.name||'',unrouted:!staff.reps.length,
   permissions:{take:lead||admin||service&&(!routed||routed.id===me.id)}
  });
 }
 return entries.sort((a,b)=>b.overdueDays-a.overdueDays||a.customerName.localeCompare(b.customerName)||a.id.localeCompare(b.id)).slice(0,limit);
}

/** The number on the Visits entry of the navigation. A representative of customer service counts what waits for them and
 * the missed visits they may take; a manager or administrator counts the requests that are late or have nobody to take
 * them; a sales member counts the answers they have not opened. */
export function supportBadge(entries:SupportEntry[],missed:MissedEntry[],role:string){
 if(role==='customer_service')return entries.filter(entry=>entry.awaiting).length+missed.filter(entry=>entry.permissions.take).length;
 if(role==='customer_service_manager'||role==='admin')return entries.filter(entry=>entry.awaiting==='assign'||entry.awaiting==='contact').length;
 return entries.filter(entry=>entry.awaiting==='answer').length;
}

/** English wording for the outcomes and channels, keyed like `supportOutcomes` and `supportChannels`. */
export const supportOutcomesEn:Record<string,string>={reached_interested:'Reached, customer is interested',reached_not_interested:'Reached, customer is not interested',wants_visit:'Customer asks for a visit on a date',no_answer:'Customer did not answer',wrong_number:'Wrong or unavailable number',other:'Other'};
export const supportChannelsEn:Record<string,string>={any:'Any way',call:'Phone call',whatsapp:'WhatsApp'};

export type SupportGroupId='decide'|'take'|'mine'|'missed'|'missed_others'|'others'|'waiting'|'answered'|'finished';
export type SupportGroup={id:SupportGroupId;requests:SupportEntry[];missed:MissedEntry[]};
/** How long a sales member keeps seeing an answer among the recent ones. */
export const SUPPORT_RECENT_ANSWER_DAYS=7;
/** The panel's sections for a reader, in display order, without the empty ones. */
export function supportGroups(requests:SupportEntry[],missed:MissedEntry[],role:string,now:string=new Date().toISOString()):SupportGroup[]{
 const open=requests.filter(entry=>entry.state==='waiting'||entry.state==='in_progress'),finished=requests.filter(entry=>entry.state==='done'||entry.state==='cancelled');
 const groups:SupportGroup[]=[];
 const add=(id:SupportGroupId,list:SupportEntry[],visits:MissedEntry[]=[])=>{if(list.length||visits.length)groups.push({id,requests:list,missed:visits});};
 if(role==='customer_service'){
  add('take',open.filter(entry=>entry.awaiting==='take'));
  add('mine',open.filter(entry=>entry.awaiting==='contact'));
  add('missed',[],missed.filter(entry=>entry.permissions.take));
  add('others',open.filter(entry=>!entry.awaiting));
  add('missed_others',[],missed.filter(entry=>!entry.permissions.take));
  add('finished',finished);
 }else if(role==='customer_service_manager'||role==='admin'){
  add('decide',open.filter(entry=>entry.awaiting==='assign'));
  add('mine',open.filter(entry=>entry.awaiting==='contact'));
  add('others',open.filter(entry=>!entry.awaiting));
  add('missed',[],missed);
  add('finished',finished);
 }else{
  const recent=(entry:SupportEntry)=>Date.parse(now)-Date.parse(entry.updatedAt)<=SUPPORT_RECENT_ANSWER_DAYS*DAY;
  const answered=finished.filter(entry=>entry.state==='done'&&(recent(entry)||entry.awaiting==='answer'));
  add('waiting',open);
  add('answered',[...answered].sort((a,b)=>Number(b.awaiting==='answer')-Number(a.awaiting==='answer')||b.updatedAt.localeCompare(a.updatedAt)));
  add('finished',finished.filter(entry=>!answered.includes(entry)));
 }
 return groups;
}
/** The request a sales row shows beside a customer: the open one, else an answer from the last week. */
export function supportByCustomer(requests:SupportEntry[],now:string=new Date().toISOString()){
 const found:Record<string,SupportEntry|undefined>={};
 for(const entry of requests){
  const open=entry.state==='waiting'||entry.state==='in_progress',recent=entry.state==='done'&&(Date.parse(now)-Date.parse(entry.updatedAt)<=SUPPORT_RECENT_ANSWER_DAYS*DAY||entry.awaiting==='answer');
  if(!open&&!recent)continue;
  const current=found[entry.customerId];
  if(!current||open&&current.state!=='waiting'&&current.state!=='in_progress'||open===(current.state==='waiting'||current.state==='in_progress')&&entry.updatedAt>current.updatedAt)found[entry.customerId]=entry;
 }
 return found;
}
