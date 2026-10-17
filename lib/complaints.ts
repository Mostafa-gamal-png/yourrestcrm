import type {Member,Row} from './crm';
import {memberCanAccessRegion} from './regions';
import {salesScopeMemberIds} from './access';
import {serviceSources} from './customer-service';
import {workingHoursBetween} from './working-hours';

/** Customer complaints: customer service registers what a customer complained about, the customer-service manager reviews it
 * and hands it to a sales manager, who assigns a representative to put it right with the customer; the representative records
 * each contact and the resolution, and customer service confirms with the customer and closes it. A complaint is a `crm_records`
 * row of kind `complaint` with no parent (so no customer-tree rule, deletion rule, visit rule or older release ever treats it as
 * anything else); everything it carries is in `data`. Nothing here feeds a target, an evaluation, a KPI or a movement calculation:
 * the figures are for follow-up only. */
export const COMPLAINT_KIND='complaint';
/** Working hours each stage may take before it is shown as late: the manager's review, the sales manager's assignment, a
 * supervisor's delegation, the representative's first contact and resolution (both from the assignment), and customer
 * service's closure after the resolution. */
export const COMPLAINT_TARGET_HOURS={review:4,assignment:4,delegation:4,first_contact:24,resolution:50,closure:24} as const;
/** A closed complaint may be reopened for this many days; after that the customer's return is a new complaint. */
export const COMPLAINT_REOPEN_DAYS=14;
/** Closed and cancelled complaints stay in the lists for this long. */
export const COMPLAINT_HISTORY_DAYS=30;
/** A list holds this many entries unless its caller asks for all of them; the route always reports the true total beside it. */
export const COMPLAINT_LIST_LIMIT=300;
export const COMPLAINT_TEXT_MAX=2000;
export const COMPLAINT_DEMAND_MAX=500;
export const COMPLAINT_SHORT_MAX=250;
export const complaintChannels:Record<string,string>=serviceSources;
export const complaintCategories:Record<string,string>={product_quality:'جودة المنتج أو القالب',delivery_delay:'التأخر في التسليم',invoice_price:'الفاتورة أو السعر',service_conduct:'الخدمة أو التعامل',maintenance_support:'الصيانة والدعم الفني',other:'أخرى'};
export const complaintSeverities:Record<string,string>={normal:'عادية',high:'عالية'};
export const resolutionOutcomes:Record<string,string>={solved:'حُلّت',partially_solved:'حُلّت جزئيًا',not_solvable:'تعذر الحل',customer_withdrew:'العميل تنازل عن الشكوى'};
export const closureOutcomes:Record<string,string>={satisfied:'العميل راضٍ',not_satisfied:'أُغلقت دون رضا العميل',withdrawn:'تنازل العميل',unreachable:'تعذر الوصول إلى العميل'};
export const complaintStatusLabels:Record<string,string>={submitted:'بانتظار مراجعة مدير خدمة العملاء',returned:'مطلوب تعديل',pending_assignment:'بانتظار تكليف المبيعات',assigned:'مكلّف بها',resolved:'بانتظار تأكيد الإغلاق',closed:'مغلقة',cancelled:'ملغاة'};
export const complaintActions:Record<string,string>={register:'تسجيل شكوى',edit:'تعديل الشكوى وإعادة إرسالها',forward:'إحالة الشكوى إلى مدير المبيعات',return:'إعادة الشكوى للتعديل',assign:'تكليف المبيعات بالشكوى',delegate:'تكليف مندوب بالشكوى',reassign:'إعادة تكليف الشكوى',seen:'فتح الشكوى',update:'تحديث على الشكوى',resolve:'تسجيل حل الشكوى',reject:'إعادة الشكوى إلى المندوب',close:'إغلاق الشكوى',reopen:'إعادة فتح الشكوى',cancel:'إلغاء الشكوى',note:'ملاحظة داخلية على الشكوى'};
/** English wording, keyed like the Arabic tables. */
export const complaintChannelsEn:Record<string,string>={visit:'Visit',call:'Phone call',email:'Email',whatsapp:'WhatsApp',website:'Website',social:'Social media'};
export const complaintCategoriesEn:Record<string,string>={product_quality:'Product or mold quality',delivery_delay:'Delivery delay',invoice_price:'Invoice or price',service_conduct:'Service or conduct',maintenance_support:'Maintenance and technical support',other:'Other'};
export const complaintSeveritiesEn:Record<string,string>={normal:'Normal',high:'High'};
export const resolutionOutcomesEn:Record<string,string>={solved:'Solved',partially_solved:'Partly solved',not_solvable:'Could not be solved',customer_withdrew:'Customer withdrew the complaint'};
export const closureOutcomesEn:Record<string,string>={satisfied:'Customer satisfied',not_satisfied:'Closed without the customer\'s satisfaction',withdrawn:'Customer withdrew',unreachable:'Customer could not be reached'};
export const complaintStatusLabelsEn:Record<string,string>={submitted:'Waiting for the customer-service manager\'s review',returned:'Needs correction',pending_assignment:'Waiting for sales assignment',assigned:'Assigned',resolved:'Waiting for closure confirmation',closed:'Closed',cancelled:'Cancelled'};
export const complaintActionsEn:Record<string,string>={register:'Complaint registered',edit:'Complaint corrected and resent',forward:'Forwarded to the sales manager',return:'Returned for correction',assign:'Assigned to sales',delegate:'Delegated to a representative',reassign:'Reassigned',seen:'Opened',update:'Update',resolve:'Resolution recorded',reject:'Returned to the representative',close:'Closed',reopen:'Reopened',cancel:'Cancelled',note:'Internal note'};

export type ComplaintStatus='submitted'|'returned'|'pending_assignment'|'assigned'|'resolved'|'closed'|'cancelled';
export type ComplaintStage='review'|'fix'|'assignment'|'delegation'|'first_contact'|'resolution'|'closure'|'closed'|'cancelled';
export type ComplaintAwaiting='review'|'fix'|'assign'|'delegate'|'contact'|'resolve'|'close'|null;
export type ComplaintUpdate={id:string;at:string;by:string;channel:string;date:string;text:string};
export type ComplaintNote={id:string;at:string;by:string;text:string};
/** One step of the complaint's life, kept on the row so the page can tell its story without the audit table. */
export type ComplaintEvent={at:string;by:string;action:string;text?:string;targetId?:string;outcome?:string;rating?:number};
export type ComplaintOutcome={outcome:string;note:string;by:string;at:string;/** The customer's rating out of 5, entered with the closure when the representative asked for it. */rating?:number};
export type ComplaintData={
 kind:'complaint';customerId:string;status:ComplaintStatus;
 /** Who registered it, the customer-service manager it waits for, the sales manager it was handed to, the supervisor it passed through and who holds it now. */
 registrarId:string;serviceManagerId:string;salesManagerId:string;supervisorId:string;assigneeId:string;
 channel:string;category:string;severity:'normal'|'high';description:string;demand:string;reference:string;contactName:string;contactPhone:string;
 submittedAt:string;forwardedAt:string;returnedAt:string;assignedAt:string;delegatedAt:string;reassignedAt:string;rejectedAt:string;reopenedAt:string;resolvedAt:string;closedAt:string;cancelledAt:string;seenAt:string;
 returnNote:string;assignmentNote:string;rejectReason:string;cancelReason:string;
 resolution?:ComplaintOutcome;closure?:ComplaintOutcome;
 previousAssignees:string[];updates:ComplaintUpdate[];notes:ComplaintNote[];events:ComplaintEvent[];
};
export type ComplaintRow={id:string;branch:string;assignedTo:string;data:ComplaintData;createdAt:string;updatedAt:string;version:number};
export type ComplaintContext={me:Member;members:Member[];all:Row[];complaints:ComplaintRow[]};
export type ComplaintPermissions={edit:boolean;forward:boolean;return:boolean;assign:boolean;delegate:boolean;reassign:boolean;seen:boolean;update:boolean;resolve:boolean;close:boolean;reject:boolean;reopen:boolean;cancel:boolean;note:boolean};
export type ComplaintPerson={id:string;name:string;role:string};
export type ComplaintEntry={
 id:string;customerId:string;customerName:string;customerPhone:string;customerCity:string;customerRegion:string;customerVersion:number;
 status:ComplaintStatus;stage:ComplaintStage;stageSince:string;stageHours:number;targetHours:number|null;late:boolean;awaiting:ComplaintAwaiting;ownerId:string;
 channel:string;category:string;severity:'normal'|'high';description:string;demand:string;reference:string;contactName:string;contactPhone:string;
 registrarId:string;registrarName:string;serviceManagerId:string;serviceManagerName:string;salesManagerId:string;salesManagerName:string;supervisorName:string;assigneeId:string;assigneeName:string;assigneeRole:string;
 /** The representative or supervisor who owns the customer today, offered first when assigning. */
 currentRepId:string;currentRepName:string;
 returnNote:string;assignmentNote:string;rejectReason:string;cancelReason:string;
 resolution:(ComplaintOutcome&{byName:string})|null;closure:(ComplaintOutcome&{byName:string})|null;
 updates:(ComplaintUpdate&{byName:string})[];notes:(ComplaintNote&{byName:string})[];events:(ComplaintEvent&{byName:string;targetName:string})[];
 /** Nobody in customer service manages the registrar: the review waits for an administrator. */
 unrouted:boolean;reopenUntil:string;
 createdAt:string;updatedAt:string;version:number;
 permissions:ComplaintPermissions;candidates:ComplaintPerson[];suggestedId:string;
};

const DAY=86400000;
export const isComplaintRow=(row:{kind?:string})=>row.kind===COMPLAINT_KIND;
export const latestOf=(...values:(string|undefined)[])=>values.filter((value):value is string=>!!value).sort().at(-1)||'';
/** When the holder last received it: an assignment, a delegation, a reassignment, a reopening or a return from customer service. */
export const dispatchedAt=(data:ComplaintData)=>latestOf(data.assignedAt,data.delegatedAt,data.reassignedAt,data.reopenedAt,data.rejectedAt);
/** The holder's updates since they last received it. */
export const updatesSinceDispatch=(data:ComplaintData)=>{const since=dispatchedAt(data);return (data.updates||[]).filter(update=>!since||update.at>=since);};

/** The stage a complaint is in and since when, read from the stamps it carries. */
export function complaintStage(data:ComplaintData,assigneeRole:string):{stage:ComplaintStage;since:string}{
 switch(data.status){
  case 'submitted':return {stage:'review',since:data.submittedAt};
  case 'returned':return {stage:'fix',since:data.returnedAt};
  case 'pending_assignment':return {stage:'assignment',since:data.forwardedAt};
  case 'assigned':{
   const since=dispatchedAt(data);
   if(assigneeRole==='supervisor')return {stage:'delegation',since};
   return {stage:updatesSinceDispatch(data).length?'resolution':'first_contact',since};
  }
  case 'resolved':return {stage:'closure',since:data.resolvedAt};
  case 'closed':return {stage:'closed',since:data.closedAt};
  default:return {stage:'cancelled',since:data.cancelledAt};
 }
}
const targetFor=(stage:ComplaintStage):number|null=>stage==='review'||stage==='assignment'||stage==='delegation'||stage==='first_contact'||stage==='resolution'||stage==='closure'?COMPLAINT_TARGET_HOURS[stage]:null;
/** Where a complaint stands against the target of its stage, in working hours. */
export function complaintProgress(data:ComplaintData,assigneeRole:string,now:string){
 const {stage,since}=complaintStage(data,assigneeRole),targetHours=targetFor(stage),stageHours=since?workingHoursBetween(since,now):0;
 return {stage,since,targetHours,stageHours,late:targetHours!==null&&stageHours>targetHours};
}
export const isOpenComplaint=(data:Pick<ComplaintData,'status'>)=>data.status!=='closed'&&data.status!=='cancelled';
export const reopenUntil=(data:ComplaintData)=>data.status==='closed'&&data.closedAt?new Date(Date.parse(data.closedAt)+COMPLAINT_REOPEN_DAYS*DAY).toISOString():'';

export type ComplaintReader={me:Member;admin:boolean;service:boolean;lead:boolean;manager:boolean;supervisor:boolean;rep:boolean;team:Set<string>};
/** What the reader is, and whose records their team covers; built once per request. */
export function complaintReader(c:{me:Member;members:Member[]}):ComplaintReader{
 const role=c.me.role;
 return {me:c.me,admin:role==='admin',service:role==='customer_service',lead:role==='customer_service_manager',manager:role==='manager',supervisor:role==='supervisor',rep:role==='rep',team:salesScopeMemberIds(c.members,c.me)};
}
/** The customer-service manager a registrar reports to; empty when nobody does, and then the review waits for an administrator. */
export function registrarManager(registrarId:string,members:Member[]){
 const registrar=members.find(member=>member.id===registrarId);
 const manager=registrar?.supervisorId?members.find(member=>member.id===registrar.supervisorId&&member.role==='customer_service_manager'&&!!member.active):undefined;
 return manager?.id||'';
}
/** Whether this customer-service manager reviews the complaint: it was routed to him, or he manages its registrar, or nobody manages the registrar. */
function reviews(data:ComplaintData,reader:ComplaintReader,members:Member[]){
 if(!reader.lead)return false;
 return data.serviceManagerId===reader.me.id||!data.serviceManagerId||members.some(member=>member.id===data.registrarId&&member.supervisorId===reader.me.id&&!!member.active);
}
/** Whether the reader may see this complaint: administrators all; customer service and its manager their branch and region; sales
 * members what was handed to them or is held by someone in their team. */
export function canReadComplaint(row:ComplaintRow,customer:Row|undefined,reader:ComplaintReader,members:Member[]){
 if(!customer||customer.kind!=='customer'||!memberCanAccessRegion(reader.me,customer.data.region))return false;
 if(reader.admin)return true;
 const data=row.data;
 if(reader.service)return customer.branch===reader.me.branch;
 if(reader.lead)return customer.branch===reader.me.branch&&(reviews(data,reader,members)||data.serviceManagerId===reader.me.id);
 if(reader.manager)return data.salesManagerId===reader.me.id||!!data.assigneeId&&reader.team.has(data.assigneeId);
 if(reader.supervisor||reader.rep)return !!data.assigneeId&&reader.team.has(data.assigneeId);
 return false;
}
/** Who registers a complaint: customer service, its manager and administrators, for a customer of their branch and region. */
export function canRegisterComplaint(customer:Row|undefined,c:{me:Member}){
 if(!customer||customer.kind!=='customer'||!memberCanAccessRegion(c.me,customer.data.region))return false;
 if(c.me.role==='admin')return true;
 return (c.me.role==='customer_service'||c.me.role==='customer_service_manager')&&customer.branch===c.me.branch;
}
/** The people a step may hand the complaint to: sales managers for the forward, representatives and supervisors of the customer's
 * branch and region for an assignment or reassignment, the supervisor's own representatives for a delegation. */
export function complaintCandidates(row:ComplaintRow,customer:Row,c:{me:Member;members:Member[]},action:'forward'|'assign'|'delegate'|'reassign'):ComplaintPerson[]{
 const me=c.me,admin=me.role==='admin',team=salesScopeMemberIds(c.members,me,{activeOnly:true});
 const fits=(member:Member)=>!!member.active&&memberCanAccessRegion(member,customer.data.region);
 let found:Member[];
 if(action==='forward')found=c.members.filter(member=>member.role==='manager'&&fits(member)&&(admin||member.id===me.supervisorId));
 else if(action==='delegate')found=c.members.filter(member=>member.role==='rep'&&fits(member)&&member.branch===customer.branch&&member.supervisorId===me.id&&member.id!==row.data.assigneeId);
 else found=c.members.filter(member=>['rep','supervisor'].includes(member.role)&&fits(member)&&member.branch===customer.branch&&(admin||team.has(member.id))&&(action==='assign'||member.id!==row.data.assigneeId));
 // The customer's own representative first, then by name.
 return found.sort((a,b)=>Number(b.id===customer.assignedTo)-Number(a.id===customer.assignedTo)||a.name.localeCompare(b.name)).map(member=>({id:member.id,name:member.name,role:member.role}));
}
export function complaintPermissions(row:ComplaintRow,customer:Row,reader:ComplaintReader,members:Member[],now:string):ComplaintPermissions{
 const data=row.data,me=reader.me.id,status=data.status,admin=reader.admin,registrar=data.registrarId===me,reviewer=admin||reviews(data,reader,members);
 const assignee=members.find(member=>member.id===data.assigneeId),holder=status==='assigned'&&data.assigneeId===me;
 const closer=admin||registrar&&reader.service||reviews(data,reader,members);
 const pending=status==='submitted'||status==='returned';
 return {
  edit:pending&&(admin||registrar&&(reader.service||reader.lead)),
  forward:status==='submitted'&&reviewer,
  return:status==='submitted'&&reviewer,
  assign:status==='pending_assignment'&&(admin||reader.manager&&data.salesManagerId===me),
  delegate:status==='assigned'&&reader.supervisor&&(data.assigneeId===me||!!assignee&&assignee.role==='rep'&&assignee.supervisorId===me),
  reassign:status==='assigned'&&(admin||reader.manager&&data.salesManagerId===me),
  seen:holder&&(!data.seenAt||data.seenAt<dispatchedAt(data)),
  update:status==='assigned'&&(holder||admin),
  resolve:status==='assigned'&&(holder||admin),
  close:status==='resolved'&&closer,
  reject:status==='resolved'&&closer,
  reopen:status==='closed'&&closer&&now<=reopenUntil(data),
  cancel:isOpenComplaint(data)&&(admin||pending&&(registrar||reviews(data,reader,members))),
  note:isOpenComplaint(data)&&canReadComplaint(row,customer,reader,members)
 };
}
/** What the reader themself must do about it, if anything. */
export function complaintAwaiting(data:ComplaintData,permissions:ComplaintPermissions,reader:ComplaintReader,members:Member[]):ComplaintAwaiting{
 const me=reader.me.id;
 // An administrator may do everything, but is only asked to when nobody else is there to do it.
 if(data.status==='submitted'&&permissions.forward&&(!reader.admin||!data.serviceManagerId))return 'review';
 if(data.status==='returned'&&data.registrarId===me)return 'fix';
 if(permissions.assign&&!reader.admin)return 'assign';
 if(data.status==='assigned'&&data.assigneeId===me){
  if(reader.supervisor)return 'delegate';
  return updatesSinceDispatch(data).length?'resolve':'contact';
 }
 if(permissions.close){
  // The registrar confirms with the customer; the manager (or an administrator) steps in when the registrar is no longer there.
  const registrar=members.find(member=>member.id===data.registrarId);
  if(data.registrarId===me||(reader.lead||reader.admin)&&!registrar?.active)return 'close';
 }
 return null;
}
/** Who must act at this stage; empty when nobody is expected to. */
export function complaintOwner(data:ComplaintData,stage:ComplaintStage){
 if(stage==='review')return data.serviceManagerId;
 if(stage==='fix'||stage==='closure')return data.registrarId;
 if(stage==='assignment')return data.salesManagerId;
 if(stage==='delegation'||stage==='first_contact'||stage==='resolution')return data.assigneeId;
 return '';
}
const finishedRecently=(row:ComplaintRow,now:string)=>isOpenComplaint(row.data)||Date.parse(now)-Date.parse(row.updatedAt)<=COMPLAINT_HISTORY_DAYS*DAY;
/** What waits for the reader first, then the late ones, the high ones, the oldest open ones, the newest finished ones. */
export function sortComplaints(entries:ComplaintEntry[]){
 const done=(entry:ComplaintEntry)=>entry.status==='closed'||entry.status==='cancelled';
 return [...entries].sort((a,b)=>Number(!!b.awaiting)-Number(!!a.awaiting)||Number(done(a))-Number(done(b))||Number(b.late)-Number(a.late)||Number(b.severity==='high')-Number(a.severity==='high')||(done(a)?b.updatedAt.localeCompare(a.updatedAt):a.createdAt.localeCompare(b.createdAt))||a.id.localeCompare(b.id));
}
/** The complaints the reader may see, as the page needs them; `limit` cuts the list for display and `Infinity` returns every one. */
export function complaintQueue(c:ComplaintContext,now:string=new Date().toISOString(),limit:number=COMPLAINT_LIST_LIMIT):ComplaintEntry[]{
 const reader=complaintReader(c),member=(id:string|null|undefined)=>id?c.members.find(m=>m.id===id):undefined,name=(id:string|null|undefined)=>member(id)?.name||'';
 if(!reader.admin&&!reader.service&&!reader.lead&&!reader.manager&&!reader.supervisor&&!reader.rep)return [];
 const customers=new Map(c.all.filter(row=>row.kind==='customer').map(row=>[row.id,row])),entries:ComplaintEntry[]=[];
 for(const row of c.complaints){
  const customer=customers.get(row.data.customerId);
  if(!customer||!canReadComplaint(row,customer,reader,c.members)||!finishedRecently(row,now))continue;
  const data=row.data,assignee=member(data.assigneeId),progress=complaintProgress(data,assignee?.role||'',now),permissions=complaintPermissions(row,customer,reader,c.members,now),awaiting=complaintAwaiting(data,permissions,reader,c.members);
  const candidateAction=permissions.forward?'forward':permissions.assign?'assign':permissions.reassign?'reassign':permissions.delegate?'delegate':null;
  const candidates=candidateAction?complaintCandidates(row,customer,c,candidateAction):[];
  const current=member(customer.assignedTo);
  entries.push({
   id:row.id,customerId:customer.id,customerName:String(customer.data.name||''),customerPhone:String(customer.data.phone||''),customerCity:String(customer.data.city||''),customerRegion:String(customer.data.region||''),customerVersion:customer.version,
   status:data.status,stage:progress.stage,stageSince:progress.since,stageHours:progress.stageHours,targetHours:progress.targetHours,late:progress.late,awaiting,ownerId:complaintOwner(data,progress.stage),
   channel:data.channel,category:data.category,severity:data.severity==='high'?'high':'normal',description:data.description,demand:data.demand||'',reference:data.reference||'',contactName:data.contactName||'',contactPhone:data.contactPhone||'',
   registrarId:data.registrarId,registrarName:name(data.registrarId),serviceManagerId:data.serviceManagerId||'',serviceManagerName:name(data.serviceManagerId),salesManagerId:data.salesManagerId||'',salesManagerName:name(data.salesManagerId),supervisorName:name(data.supervisorId),assigneeId:data.assigneeId||'',assigneeName:name(data.assigneeId),assigneeRole:assignee?.role||'',
   currentRepId:current?.id||'',currentRepName:current?.name||'',
   returnNote:data.returnNote||'',assignmentNote:data.assignmentNote||'',rejectReason:data.rejectReason||'',cancelReason:data.cancelReason||'',
   resolution:data.resolution?{...data.resolution,byName:name(data.resolution.by)}:null,closure:data.closure?{...data.closure,byName:name(data.closure.by)}:null,
   updates:(data.updates||[]).map(update=>({...update,byName:name(update.by)})),notes:(data.notes||[]).map(note=>({...note,byName:name(note.by)})),events:(data.events||[]).map(event=>({...event,byName:name(event.by),targetName:name(event.targetId)})),
   unrouted:data.status==='submitted'&&!data.serviceManagerId,reopenUntil:reopenUntil(data),
   createdAt:row.createdAt,updatedAt:row.updatedAt,version:row.version,
   permissions,candidates,suggestedId:candidates.some(person=>person.id===customer.assignedTo)?customer.assignedTo:''
  });
 }
 return sortComplaints(entries).slice(0,limit);
}
/** The number on the navigation: what waits for the reader. */
export const complaintBadge=(entries:ComplaintEntry[])=>entries.filter(entry=>!!entry.awaiting).length;
/** A customer's complaints, newest first, for the customer's own sheet. */
export const complaintsOfCustomer=(entries:ComplaintEntry[],customerId:string)=>entries.filter(entry=>entry.customerId===customerId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));

export type ComplaintGroupId='act'|'open'|'finished';
export type ComplaintGroup={id:ComplaintGroupId;entries:ComplaintEntry[]};
/** The page's sections for a reader, in display order, without the empty ones: what waits for them, the other open ones, the finished ones. */
export function complaintGroups(entries:ComplaintEntry[]):ComplaintGroup[]{
 const groups:ComplaintGroup[]=[],open=entries.filter(entry=>isOpenComplaint(entry)),finished=entries.filter(entry=>!isOpenComplaint(entry));
 const add=(id:ComplaintGroupId,list:ComplaintEntry[])=>{if(list.length)groups.push({id,entries:list});};
 add('act',open.filter(entry=>!!entry.awaiting));
 add('open',open.filter(entry=>!entry.awaiting));
 add('finished',finished);
 return groups;
}
