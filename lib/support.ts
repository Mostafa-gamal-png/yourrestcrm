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
 * for follow-up, and the customer-service evaluation (`lib/service-kpi.ts`) reads the requests to evaluate customer service itself.
 *
 * A request follows the course a complaint does: the customer-service member who takes it contacts the customer and submits what
 * came of it, the customer-service manager approves it (or returns it for correction) and hands it to a sales manager, who assigns
 * a representative or a supervisor (who may delegate); that member contacts the customer by visit, call or any other way and records
 * the result, and the customer-service member confirms it and closes the request (or returns it to the representative). */
export const SUPPORT_KIND='support';
/** Working hours customer service has to answer a request that is waiting, from the moment it was made. */
export const SUPPORT_TARGET_HOURS=4;
/** Working hours each later stage may take before it is shown as late: the manager's review, the sales manager's assignment, a
 * supervisor's delegation, the representative's contact (from the assignment) and customer service's closure. */
export const SUPPORT_STAGE_HOURS={review:4,assignment:4,delegation:4,first_contact:24,closure:24} as const;
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
export const supportActions:Record<string,string>={request:'طلب مساندة خدمة العملاء',take:'تولّي التواصل',assign:'تكليف ممثل خدمة العملاء',result:'تسجيل نتيجة التواصل',submit:'رفع نتيجة التواصل للاعتماد',forward:'اعتماد وإحالة إلى مدير المبيعات',return:'إعادة للتعديل',allocate:'تكليف المبيعات',reassign:'إعادة تكليف',delegate:'تفويض مندوب',resolve:'تسجيل نتيجة تواصل المندوب',reject:'إعادة إلى المندوب',close:'إغلاق الطلب',cancel:'إلغاء الطلب',seen:'الاطلاع على الرد'};
export const supportActionsEn:Record<string,string>={request:'Request opened',take:'Contact taken',assign:'Assigned to a customer-service member',result:'Contact result recorded',submit:'Contact result submitted for approval',forward:'Approved and handed to the sales manager',return:'Returned for correction',allocate:'Assigned to sales',reassign:'Reassigned',delegate:'Delegated to a representative',resolve:'Representative\'s contact recorded',reject:'Returned to the representative',close:'Closed',cancel:'Cancelled',seen:'Reply opened'};
/** How the sales member reached the customer. */
export const supportResolutionChannels:Record<string,string>={visit:'زيارة',call:'اتصال',whatsapp:'واتساب',email:'بريد إلكتروني',other:'وسيلة أخرى'};
export const supportResolutionChannelsEn:Record<string,string>={visit:'Visit',call:'Phone call',whatsapp:'WhatsApp',email:'E-mail',other:'Another way'};

export type SupportStatus='open'|'submitted'|'returned'|'pending_assignment'|'assigned'|'resolved'|'done'|'cancelled';
export type SupportOrigin='rep'|'missed_visit';
/** The status, with `open` told apart into waiting for someone to take it and in a member's contact. */
export type SupportState='waiting'|'in_progress'|'submitted'|'returned'|'pending_assignment'|'assigned'|'resolved'|'done'|'cancelled';
export type SupportStage='take'|'contact'|'review'|'fix'|'assignment'|'delegation'|'first_contact'|'closure'|'closed'|'cancelled';
export type SupportPlan={visitId:string;visitDate:string;result:string;nextAction:string;nextDate:string};
/** What came of a contact with the customer: customer service's own (`result`, kept under that name from the first release) and the sales member's (`resolution`, with the way they reached the customer). */
export type SupportResult={outcome:string;note:string;nextDate:string;by:string;at:string;channel?:string};
/** One step of the request's life, kept on the row so the page can tell its story without the audit table. */
export type SupportEvent={at:string;by:string;action:string;text?:string;targetId?:string;outcome?:string};
export type SupportData={
 kind:'support';customerId:string;origin:SupportOrigin;status:SupportStatus;
 requestedBy:string;requestedAt:string;/** The customer's responsible member when the request was made. */repId:string;note:string;channel:string;plan?:SupportPlan;
 /** Empty while nobody has taken it. */handlerId:string;handlerAt:string;handlerBy:string;
 result?:SupportResult;cancelledBy?:string;cancelledAt?:string;cancelReason?:string;answerSeenAt?:string;answerSeenBy?:string;
 /** The customer-service manager it waits for, the sales manager it was handed to, the supervisor it passed through and the member who holds it now; empty until each is known. */
 serviceManagerId?:string;salesManagerId?:string;supervisorId?:string;assigneeId?:string;
 submittedAt?:string;returnedAt?:string;forwardedAt?:string;assignedAt?:string;delegatedAt?:string;reassignedAt?:string;resolvedAt?:string;rejectedAt?:string;closedAt?:string;
 returnNote?:string;assignmentNote?:string;rejectReason?:string;
 resolution?:SupportResult;closure?:{note:string;by:string;at:string};
 previousAssignees?:string[];events?:SupportEvent[];
};
export type SupportRow={id:string;branch:string;assignedTo:string;data:SupportData;createdAt:string;updatedAt:string;version:number};
export type SupportContext={me:Member;members:Member[];all:Row[];visible:Row[];support:SupportRow[]};
export type SupportAwaiting='take'|'contact'|'fix'|'assign'|'review'|'allocate'|'delegate'|'resolve'|'close'|'answer'|null;
export type SupportPermissions={take:boolean;assign:boolean;submit:boolean;forward:boolean;return:boolean;allocate:boolean;reassign:boolean;delegate:boolean;resolve:boolean;reject:boolean;close:boolean;cancel:boolean;seen:boolean};
export type SupportPerson={id:string;name:string;role:string};
export type SupportEntry={
 id:string;customerId:string;customerName:string;customerPhone:string;customerCity:string;customerRegion:string;customerVersion:number;
 origin:SupportOrigin;state:SupportState;status:SupportStatus;note:string;channel:string;plan:SupportPlan|null;
 requestedBy:string;requestedByName:string;repId:string;repName:string;handlerId:string;handlerName:string;
 /** Customer service's contact with the customer, submitted for approval (or, in a request answered before the chain existed, its whole answer). */
 result:{outcome:string;note:string;nextDate:string;by:string;byName:string;at:string}|null;
 /** The sales member's contact with the customer, and customer service's closure. */
 resolution:{outcome:string;note:string;nextDate:string;by:string;byName:string;at:string;channel:string}|null;closure:{note:string;by:string;byName:string;at:string}|null;
 answerSeen:boolean;cancelReason:string;cancelledByName:string;
 createdAt:string;updatedAt:string;version:number;
 stage:SupportStage;stageSince:string;stageHours:number;targetHours:number|null;late:boolean;
 /** Who must act at this stage; empty when nobody is expected to. */
 ownerId:string;
 /** Nobody in customer service covers this customer's branch and region. */
 unrouted:boolean;
 /** The contact result waits for a manager and nobody in customer service manages the member who submitted it. */
 noManager:boolean;awaiting:SupportAwaiting;
 serviceManagerId:string;serviceManagerName:string;salesManagerId:string;salesManagerName:string;supervisorName:string;assigneeId:string;assigneeName:string;assigneeRole:string;
 returnNote:string;assignmentNote:string;rejectReason:string;
 events:(SupportEvent&{byName:string;targetName:string})[];
 permissions:SupportPermissions;
 /** The people the reader's next step may hand the request to, and the one offered first (the customer's own representative). */
 candidates:SupportPerson[];suggestedId:string;
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
export const supportState=(data:Pick<SupportData,'status'|'handlerId'>):SupportState=>data.status==='open'?(data.handlerId?'in_progress':'waiting'):data.status;
/** A request that has not ended: from its opening until it is closed or cancelled. */
export const isOpenSupport=(data:Pick<SupportData,'status'>)=>data.status!=='done'&&data.status!=='cancelled';
export const isOpenState=(state:SupportState)=>state!=='done'&&state!=='cancelled';
const latestOf=(...values:(string|undefined)[])=>values.filter((value):value is string=>!!value).sort().at(-1)||'';
/** When the holder last received it: an assignment, a delegation, a reassignment or a return from customer service. */
export const supportDispatchedAt=(data:SupportData)=>latestOf(data.assignedAt,data.delegatedAt,data.reassignedAt,data.rejectedAt);
/** The stage a request is in and since when, read from the stamps it carries. A request that has not been taken, or is in its taker's
 * contact, counts from the moment it was made, as the first release did. */
export function supportStage(row:Pick<SupportRow,'data'|'createdAt'|'updatedAt'>,assigneeRole:string):{stage:SupportStage;since:string}{
 const data=row.data;
 switch(data.status){
  case 'open':return {stage:data.handlerId?'contact':'take',since:row.createdAt};
  case 'submitted':return {stage:'review',since:data.submittedAt||row.updatedAt};
  case 'returned':return {stage:'fix',since:data.returnedAt||row.updatedAt};
  case 'pending_assignment':return {stage:'assignment',since:data.forwardedAt||row.updatedAt};
  case 'assigned':return {stage:assigneeRole==='supervisor'?'delegation':'first_contact',since:supportDispatchedAt(data)||row.updatedAt};
  case 'resolved':return {stage:'closure',since:data.resolvedAt||row.updatedAt};
  case 'done':return {stage:'closed',since:data.closedAt||data.result?.at||row.updatedAt};
  default:return {stage:'cancelled',since:data.cancelledAt||row.updatedAt};
 }
}
const supportTarget=(stage:SupportStage):number|null=>stage==='take'||stage==='contact'?SUPPORT_TARGET_HOURS:stage==='review'||stage==='assignment'||stage==='delegation'||stage==='first_contact'||stage==='closure'?SUPPORT_STAGE_HOURS[stage]:null;
/** Where a request stands against the target of its stage, in working hours. */
export function supportProgress(row:Pick<SupportRow,'data'|'createdAt'|'updatedAt'>,assigneeRole:string,now:string){
 const {stage,since}=supportStage(row,assigneeRole),targetHours=supportTarget(stage),stageHours=stage!=='closed'&&stage!=='cancelled'&&since?workingHoursBetween(since,now):0;
 return {stage,since,targetHours,stageHours,late:targetHours!==null&&stageHours>targetHours};
}
/** Who must act at this stage; empty when nobody is expected to. */
export function supportOwner(data:SupportData,stage:SupportStage){
 if(stage==='contact'||stage==='fix'||stage==='closure')return data.handlerId||'';
 if(stage==='review')return data.serviceManagerId||'';
 if(stage==='assignment')return data.salesManagerId||'';
 if(stage==='delegation'||stage==='first_contact')return data.assigneeId||'';
 return '';
}
/** The request's story: the steps it recorded, or, for a request made before steps were recorded, the ones its stamps tell. */
export function supportEvents(row:Pick<SupportRow,'data'|'createdAt'>):SupportEvent[]{
 const data=row.data;
 if(data.events&&data.events.length)return data.events;
 const found:SupportEvent[]=[{at:data.requestedAt||row.createdAt,by:data.requestedBy,action:'request',text:data.note||undefined}];
 if(data.handlerId&&data.handlerAt&&data.handlerBy!=='auto'&&data.handlerAt!==data.requestedAt)found.push({at:data.handlerAt,by:data.handlerBy||data.handlerId,action:data.handlerBy&&data.handlerBy!==data.handlerId?'assign':'take',targetId:data.handlerId});
 if(data.result)found.push({at:data.result.at,by:data.result.by,action:'result',outcome:data.result.outcome,text:data.result.note});
 if(data.cancelledAt)found.push({at:data.cancelledAt,by:data.cancelledBy||'',action:'cancel',text:data.cancelReason||undefined});
 return found;
}

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

export type SupportReader={me:Member;admin:boolean;service:boolean;lead:boolean;manager:boolean;supervisor:boolean;rep:boolean;sales:boolean;team:Set<string>};
/** What the reader is, and whose records their team covers; built once per request. */
export function supportReader(c:{me:Member;members:Member[]}):SupportReader{
 const role=c.me.role;
 return {me:c.me,admin:role==='admin',service:role==='customer_service',lead:role==='customer_service_manager',manager:role==='manager',supervisor:role==='supervisor',rep:role==='rep',sales:role==='rep'||role==='supervisor'||role==='manager',team:salesScopeMemberIds(c.members,c.me)};
}
/** Whether this customer-service manager reviews the request: it was routed to them, or they manage the member who submitted it, or nobody manages that member. */
function reviews(data:SupportData,reader:SupportReader,members:Member[]){
 if(!reader.lead)return false;
 return data.serviceManagerId===reader.me.id||!data.serviceManagerId||members.some(member=>member.id===data.handlerId&&member.supervisorId===reader.me.id&&!!member.active);
}
/** The customer-service members who cover a customer's branch and region, and the one a request is routed to when exactly
 * one of them is assigned to that region by name (the rest, assigned to every region, share what is not routed). */
export function supportStaff(customer:Row,members:Member[]){
 const covers=(member:Member)=>!!member.active&&member.branch===customer.branch&&memberCanAccessRegion(member,customer.data.region);
 const reps=members.filter(member=>member.role==='customer_service'&&covers(member)),leads=members.filter(member=>member.role==='customer_service_manager'&&covers(member));
 const named=reps.filter(member=>regionScope(member)!=='all');
 return {reps,leads,routedTo:named.length===1?named[0]:undefined};
}
/** Whether the reader may see this request: administrators all, customer service their branch and region, sales members what their team
 * asked for or owns or was assigned, and a sales manager what was handed to them. */
export function canReadSupport(row:SupportRow,customer:Row|undefined,reader:SupportReader){
 if(!customer||customer.kind!=='customer'||!memberCanAccessRegion(reader.me,customer.data.region))return false;
 if(reader.admin)return true;
 if(reader.service||reader.lead)return customer.branch===reader.me.branch;
 if(!reader.sales)return false;
 return [row.data.requestedBy,row.data.repId,customer.assignedTo,row.data.assigneeId].some(id=>!!id&&reader.team.has(id))||reader.manager&&row.data.salesManagerId===reader.me.id;
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
/** What the reader may do with the request, from its status and who they are. */
export function supportPermissions(row:SupportRow,customer:Row,reader:SupportReader,members:Member[]):SupportPermissions{
 const data=row.data,status=data.status,me=reader.me.id,admin=reader.admin,handler=data.handlerId,asked=data.requestedBy;
 const open=status==='open',assignee=members.find(member=>member.id===data.assigneeId),reviewer=admin||reviews(data,reader,members);
 const holder=status==='assigned'&&data.assigneeId===me,mine=handler===me&&(reader.service||reader.lead);
 // Whoever took it closes it; its manager (or an administrator) steps in when that member is no longer there.
 const closer=admin||mine||reviews(data,reader,members);
 const beforeSales=open||status==='returned'||status==='submitted'||status==='pending_assignment';
 return {
  take:open&&!handler&&(reader.service||reader.lead||admin),
  assign:open&&(reader.lead||admin),
  submit:open&&(admin||reader.lead||reader.service&&(!handler||handler===me))||status==='returned'&&(admin||mine),
  forward:status==='submitted'&&reviewer,
  return:status==='submitted'&&reviewer,
  allocate:status==='pending_assignment'&&(admin||reader.manager&&data.salesManagerId===me),
  reassign:status==='assigned'&&(admin||reader.manager&&data.salesManagerId===me),
  delegate:status==='assigned'&&reader.supervisor&&(data.assigneeId===me||!!assignee&&assignee.role==='rep'&&assignee.supervisorId===me),
  resolve:status==='assigned'&&(holder||admin),
  reject:status==='resolved'&&closer,
  close:status==='resolved'&&closer,
  cancel:isOpenSupport(data)&&(admin||beforeSales&&(asked===me||reader.sales&&reader.team.has(asked)||reader.lead&&(data.origin==='missed_visit'||(status==='submitted'||status==='returned')&&reviews(data,reader,members)))),
  seen:status==='done'&&!data.answerSeenAt&&reader.sales&&[asked,data.repId,customer.assignedTo,data.assigneeId].includes(me)
 };
}
/** The people a step may hand the request to: customer service for an assignment, sales managers for the forward, the representatives and
 * supervisors of the customer's branch and region for an assignment or reassignment, the supervisor's own representatives for a delegation. */
export function supportCandidates(row:SupportRow,customer:Row,c:{me:Member;members:Member[]},action:'assign'|'forward'|'allocate'|'reassign'|'delegate'):SupportPerson[]{
 const me=c.me,admin=me.role==='admin',team=salesScopeMemberIds(c.members,me,{activeOnly:true});
 const fits=(member:Member)=>!!member.active&&memberCanAccessRegion(member,customer.data.region);
 let found:Member[];
 if(action==='assign'){const staff=supportStaff(customer,c.members);found=[...staff.reps,...staff.leads].filter(member=>member.id!==row.data.handlerId);}
 else if(action==='forward')found=c.members.filter(member=>member.role==='manager'&&fits(member)&&(admin||member.id===me.supervisorId));
 else if(action==='delegate')found=c.members.filter(member=>member.role==='rep'&&fits(member)&&member.branch===customer.branch&&member.supervisorId===me.id&&member.id!==row.data.assigneeId);
 else found=c.members.filter(member=>['rep','supervisor'].includes(member.role)&&fits(member)&&member.branch===customer.branch&&(admin||team.has(member.id))&&(action==='allocate'||member.id!==row.data.assigneeId));
 // The customer's own representative first, then by name.
 return found.sort((a,b)=>Number(b.id===customer.assignedTo)-Number(a.id===customer.assignedTo)||a.name.localeCompare(b.name)).map(member=>({id:member.id,name:member.name,role:member.role}));
}
/** What the reader themself must do about the request, if anything. */
function supportAwaiting(row:SupportRow,state:SupportState,permissions:SupportPermissions,reader:SupportReader,members:Member[],late:boolean,unrouted:boolean):SupportAwaiting{
 const data=row.data,me=reader.me.id;
 if(permissions.seen)return 'answer';
 // An administrator may do everything, but is only asked to when nobody else is there to do it.
 if(data.status==='submitted'&&permissions.forward&&(!reader.admin||!data.serviceManagerId))return 'review';
 if(data.status==='returned'&&permissions.submit&&data.handlerId===me)return 'fix';
 if(permissions.allocate&&!reader.admin)return 'allocate';
 if(data.status==='assigned'&&data.assigneeId===me)return reader.supervisor&&permissions.delegate?'delegate':'resolve';
 if(data.status==='resolved'&&permissions.close){
  const handler=members.find(member=>member.id===data.handlerId);
  if(data.handlerId===me||(reader.lead||reader.admin)&&!handler?.active)return 'close';
 }
 if(data.status!=='open')return null;
 if(reader.service)return state==='waiting'&&permissions.take?'take':state==='in_progress'&&data.handlerId===me?'contact':null;
 if(reader.lead||reader.admin)return late||unrouted?'assign':data.handlerId===me?'contact':null;
 return null;
}

const finishedRecently=(row:SupportRow,now:string)=>isOpenSupport(row.data)||Date.parse(now)-Date.parse(row.updatedAt)<=SUPPORT_HISTORY_DAYS*DAY;
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
  const data=row.data,staff=supportStaff(customer,c.members),state=supportState(data),open=data.status==='open',assignee=member(data.assigneeId),permissions=supportPermissions(row,customer,reader,c.members);
  const progress=supportProgress(row,assignee?.role||'',now),late=progress.late,unrouted=open&&!data.handlerId&&!staff.reps.length;
  const awaiting=supportAwaiting(row,state,permissions,reader,c.members,late,unrouted);
  const action:'assign'|'forward'|'allocate'|'reassign'|'delegate'|null=permissions.forward?'forward':permissions.allocate?'allocate':permissions.reassign?'reassign':permissions.delegate?'delegate':permissions.assign?'assign':null;
  const candidates=action?supportCandidates(row,customer,c,action):[];
  const result=data.result,resolution=data.resolution,closure=data.closure;
  entries.push({
   id:row.id,customerId:customer.id,customerName:String(customer.data.name||''),customerPhone:String(customer.data.phone||''),customerCity:String(customer.data.city||''),customerRegion:String(customer.data.region||''),customerVersion:customer.version,
   origin:data.origin,state,status:data.status,note:String(data.note||''),channel:String(data.channel||'any'),plan:data.plan||null,
   requestedBy:data.requestedBy,requestedByName:name(data.requestedBy),repId:data.repId,repName:name(data.repId||customer.assignedTo),handlerId:data.handlerId||'',handlerName:name(data.handlerId),
   result:result?{outcome:result.outcome,note:result.note,nextDate:result.nextDate,by:result.by,byName:name(result.by),at:result.at}:null,
   resolution:resolution?{outcome:resolution.outcome,note:resolution.note,nextDate:resolution.nextDate,by:resolution.by,byName:name(resolution.by),at:resolution.at,channel:String(resolution.channel||'')}:null,
   closure:closure?{note:closure.note,by:closure.by,byName:name(closure.by),at:closure.at}:null,
   answerSeen:!!data.answerSeenAt,cancelReason:String(data.cancelReason||''),cancelledByName:name(data.cancelledBy),
   createdAt:row.createdAt,updatedAt:row.updatedAt,version:row.version,
   stage:progress.stage,stageSince:progress.since,stageHours:progress.stageHours,targetHours:progress.targetHours,late,ownerId:supportOwner(data,progress.stage),unrouted,noManager:data.status==='submitted'&&!data.serviceManagerId,awaiting,
   serviceManagerId:data.serviceManagerId||'',serviceManagerName:name(data.serviceManagerId),salesManagerId:data.salesManagerId||'',salesManagerName:name(data.salesManagerId),supervisorName:name(data.supervisorId),assigneeId:data.assigneeId||'',assigneeName:name(data.assigneeId),assigneeRole:assignee?.role||'',
   returnNote:String(data.returnNote||''),assignmentNote:String(data.assignmentNote||''),rejectReason:String(data.rejectReason||''),
   events:supportEvents(row).map(event=>({...event,byName:name(event.by),targetName:name(event.targetId)})),
   permissions,candidates,suggestedId:candidates.some(person=>person.id===customer.assignedTo)?customer.assignedTo:''
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
 const handledPlans=new Set(c.support.map(row=>row.data.plan?.visitId).filter((id):id is string=>!!id)),openCustomers=new Set(c.support.filter(row=>isOpenSupport(row.data)).map(row=>row.data.customerId));
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

/** The number on the Visits entry of the navigation: what waits for the reader in any role (a customer-service member also counts the
 * missed visits they may take). */
export function supportBadge(entries:SupportEntry[],missed:MissedEntry[],role:string){
 const waiting=entries.filter(entry=>!!entry.awaiting).length;
 return role==='customer_service'?waiting+missed.filter(entry=>entry.permissions.take).length:waiting;
}

/** English wording for the outcomes and channels, keyed like `supportOutcomes` and `supportChannels`. */
export const supportOutcomesEn:Record<string,string>={reached_interested:'Reached, customer is interested',reached_not_interested:'Reached, customer is not interested',wants_visit:'Customer asks for a visit on a date',no_answer:'Customer did not answer',wrong_number:'Wrong or unavailable number',other:'Other'};
export const supportChannelsEn:Record<string,string>={any:'Any way',call:'Phone call',whatsapp:'WhatsApp'};

export type SupportGroupId='decide'|'review'|'take'|'mine'|'fix'|'close'|'allocate'|'delegate'|'resolve'|'missed'|'missed_others'|'following'|'others'|'waiting'|'answered'|'finished';
export type SupportGroup={id:SupportGroupId;requests:SupportEntry[];missed:MissedEntry[]};
/** How long a sales member keeps seeing an answer among the recent ones. */
export const SUPPORT_RECENT_ANSWER_DAYS=7;
/** The panel's sections for a reader, in display order, without the empty ones: first what waits for them, then the rest. */
export function supportGroups(requests:SupportEntry[],missed:MissedEntry[],role:string,now:string=new Date().toISOString(),meId:string=''):SupportGroup[]{
 const open=requests.filter(entry=>isOpenState(entry.state)),finished=requests.filter(entry=>!isOpenState(entry.state));
 const groups:SupportGroup[]=[];
 const add=(id:SupportGroupId,list:SupportEntry[],visits:MissedEntry[]=[])=>{if(list.length||visits.length)groups.push({id,requests:list,missed:visits});};
 const waits=(...kinds:SupportAwaiting[])=>open.filter(entry=>kinds.includes(entry.awaiting));
 if(role==='customer_service'){
  add('take',waits('take'));
  add('mine',waits('contact'));
  add('fix',waits('fix'));
  add('close',waits('close'));
  add('missed',[],missed.filter(entry=>entry.permissions.take));
  // What this member took and sent on its way, and what the colleagues hold.
  add('following',open.filter(entry=>!entry.awaiting&&!!meId&&entry.handlerId===meId));
  add('others',open.filter(entry=>!entry.awaiting&&(!meId||entry.handlerId!==meId)));
  add('missed_others',[],missed.filter(entry=>!entry.permissions.take));
  add('finished',finished);
 }else if(role==='customer_service_manager'||role==='admin'){
  add('review',waits('review'));
  add('decide',waits('assign'));
  add('mine',waits('contact'));
  add('fix',waits('fix'));
  add('close',waits('close'));
  add('others',open.filter(entry=>!entry.awaiting));
  add('missed',[],missed);
  add('finished',finished);
 }else{
  const recent=(entry:SupportEntry)=>Date.parse(now)-Date.parse(entry.updatedAt)<=SUPPORT_RECENT_ANSWER_DAYS*DAY;
  const answered=finished.filter(entry=>entry.state==='done'&&(recent(entry)||entry.awaiting==='answer'));
  add('allocate',waits('allocate'));
  add('delegate',waits('delegate'));
  add('resolve',waits('resolve'));
  add('waiting',open.filter(entry=>!['allocate','delegate','resolve'].includes(entry.awaiting||'')));
  add('answered',[...answered].sort((a,b)=>Number(b.awaiting==='answer')-Number(a.awaiting==='answer')||b.updatedAt.localeCompare(a.updatedAt)));
  add('finished',finished.filter(entry=>!answered.includes(entry)));
 }
 return groups;
}
/** The request a sales row shows beside a customer: the open one, else an answer from the last week. */
export function supportByCustomer(requests:SupportEntry[],now:string=new Date().toISOString()){
 const found:Record<string,SupportEntry|undefined>={};
 for(const entry of requests){
  const open=isOpenState(entry.state),recent=entry.state==='done'&&(Date.parse(now)-Date.parse(entry.updatedAt)<=SUPPORT_RECENT_ANSWER_DAYS*DAY||entry.awaiting==='answer');
  if(!open&&!recent)continue;
  const current=found[entry.customerId];
  if(!current||open&&!isOpenState(current.state)||open===isOpenState(current.state)&&entry.updatedAt>current.updatedAt)found[entry.customerId]=entry;
 }
 return found;
}
