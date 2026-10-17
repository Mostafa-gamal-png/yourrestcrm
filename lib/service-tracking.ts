import type {ComplaintEntry} from './complaints';
import type {QueueStage} from './service-queue';

/** What customer service follows on the Opportunities page: every opportunity it handed to sales and every complaint it registered,
 * on one board that says where each one stands, who holds it and for how long, and whether that is late against the target of its
 * stage. The functions here are pure: they take what the case and complaint routes already return and build the board's rows, so the
 * server, the page and the tests read the same rules. The figures are for display and follow-up; they feed no target, evaluation or
 * movement calculation. */
export const TRACKING_FINISHED_DAYS=30;
const DAY=86400000;

type Pair=[string,string];
export type TrackingKind='opportunity'|'complaint';
/** Where the item waits: with customer service, with sales, or finished. */
export type TrackingSide='service'|'sales'|'done';
export type TrackingStepId='registered'|'approval'|'review'|'assignment'|'delegation'|'first_contact'|'follow_up'|'resolution'|'closure'|'finished';
export type TrackingStep={id:TrackingStepId;state:'done'|'current'|'upcoming';/** The current step is waiting for the registrar to correct and resend. */returned:boolean};
export type TrackingHolderRole='service_manager'|'registrar'|'sales_manager'|'supervisor'|'rep'|'sales'|'admin';
export type TrackingFilter='all'|'late'|'service'|'sales'|'finished';
export const trackingFilters:TrackingFilter[]=['all','late','service','sales','finished'];
export const trackingFilterLabels:Record<TrackingFilter,Pair>={all:['الكل','All'],late:['متأخرة','Late'],service:['عند خدمة العملاء','With customer service'],sales:['عند المبيعات','With sales'],finished:['منتهية (30 يومًا)','Finished (30 days)']};
export const trackingStepLabels:Record<TrackingStepId,Pair>={
 registered:['تسجيل','Registered'],approval:['اعتماد خدمة العملاء','Service approval'],review:['مراجعة المدير','Manager review'],assignment:['تكليف المبيعات','Sales assignment'],
 delegation:['تفويض المشرف','Supervisor delegation'],first_contact:['أول تواصل','First contact'],follow_up:['متابعة','Follow-up'],resolution:['الحل','Resolution'],closure:['الإغلاق','Closure'],finished:['فوز أو فقد','Won or lost']
};
export const trackingHolderLabels:Record<TrackingHolderRole,Pair>={
 service_manager:['مدير خدمة العملاء','customer-service manager'],registrar:['خدمة العملاء','customer service'],sales_manager:['مدير المبيعات','sales manager'],supervisor:['مشرف المبيعات','sales supervisor'],
 rep:['مندوب المبيعات','sales representative'],sales:['مسؤول المبيعات','sales owner'],admin:['مدير النظام','administrator']
};
/** The words for where an item stands, by stage; the stages of an opportunity and of a complaint share one table. */
export const trackingStageText:Record<string,Pair>={
 approval:['بانتظار اعتماد خدمة العملاء','Awaiting service approval'],review:['بانتظار مراجعة المدير','Awaiting manager review'],returned:['مطلوب تعديل','Needs correction'],fix:['مطلوب تعديل','Needs correction'],
 assignment:['بانتظار تكليف المبيعات','Awaiting sales assignment'],delegation:['لدى المشرف بانتظار التفويض','With the supervisor, awaiting delegation'],first_contact:['بانتظار أول تواصل','Awaiting first contact'],
 follow_up:['قيد متابعة المبيعات','Sales follow-up in progress'],resolution:['قيد الحل مع المندوب','Being resolved by the representative'],closure:['بانتظار تأكيد الإغلاق مع العميل','Awaiting closure with the customer'],
 closed:['منتهية','Finished'],cancelled:['ملغاة','Cancelled']
};
/** How a finished opportunity ended. */
export const trackingOpportunityOutcomes:Record<string,Pair>={won:['تم الفوز','Won'],lost:['تم الفقد','Lost']};

/** The part of a case from `GET /api/customer-service` that the board reads. */
export type TrackedCase={
 id:string;state:string;creatorId:string;creatorName:string;serviceManagerName:string;salesManagerName:string;assignedName:string;createdAt:string;updatedAt:string;
 data:{products?:string[];needs?:string;delegatedAt?:string};
 customer:{id:string;name:string};
 progress?:{stage:QueueStage;since:string;stageHours:number;targetHours:number|null;late:boolean;assigneeRole?:string;finishedAt?:string};
 contacts?:{createdAt:string;result?:string;summary?:string;actor:string}[];
 history?:{createdAt:string;actor:string;action?:string;detail:{note?:string}}[];
};
export type TrackingLast={kind:'contact'|'update'|'note';at:string;by:string;text:string};
export type TrackingItem={
 key:string;kind:TrackingKind;id:string;customerId:string;customerName:string;
 /** An opportunity's products and need; a complaint's category key, description and number (null before numbering began) and importance. */
 products:string[];needs:string;category:string;complaintNumber:number|null;severity:'normal'|'high';
 registeredAt:string;registrarId:string;registrarName:string;
 stage:string;stageSince:string;stageHours:number;targetHours:number|null;late:boolean;
 side:TrackingSide;steps:TrackingStep[];delegated:boolean;holder:{name:string;role:TrackingHolderRole}|null;
 /** When it ended and how: `won` or `lost` for an opportunity, a closure outcome or `cancelled` for a complaint; empty while open. */
 finishedAt:string;outcome:string;
 last:TrackingLast|null;
};

const OPPORTUNITY_STEPS:TrackingStepId[]=['registered','approval','assignment','delegation','first_contact','follow_up','finished'];
const COMPLAINT_STEPS:TrackingStepId[]=['registered','review','assignment','delegation','first_contact','resolution','closure'];
const CURRENT_STEP:Record<string,TrackingStepId>={approval:'approval',returned:'approval',review:'review',fix:'review',assignment:'assignment',delegation:'delegation',first_contact:'first_contact',follow_up:'follow_up',resolution:'resolution',closure:'closure'};
const SERVICE_STAGES=new Set(['approval','returned','review','fix','closure']);
const SALES_STAGES=new Set(['assignment','delegation','first_contact','follow_up','resolution']);

/** The side of the process an item waits on, from its stage. */
export const trackingSide=(stage:string):TrackingSide=>SERVICE_STAGES.has(stage)?'service':SALES_STAGES.has(stage)?'sales':'done';

/** The stage bar: every step an item passes through, marked done, current or upcoming. The supervisor's delegation appears only when
 * the item is with a supervisor or has been through one; a finished item has every step done; a cancelled one has no bar. */
export function trackingSteps(kind:TrackingKind,stage:string,delegated:boolean):TrackingStep[]{
 if(stage==='cancelled')return [];
 const sequence=(kind==='opportunity'?OPPORTUNITY_STEPS:COMPLAINT_STEPS).filter(id=>id!=='delegation'||delegated||stage==='delegation');
 const finished=stage==='closed',current=finished?-1:sequence.indexOf(CURRENT_STEP[stage]);
 return sequence.map((id,index)=>({id,state:index===0||finished||index<current?'done':index===current?'current':'upcoming',returned:index===current&&(stage==='returned'||stage==='fix')}));
}

const holderOf=(stage:string,names:{serviceManager:string;registrar:string;salesManager:string;assignee:string},assigneeRole:string):TrackingItem['holder']=>{
 const sales:TrackingHolderRole=assigneeRole==='supervisor'?'supervisor':assigneeRole==='rep'?'rep':'sales';
 switch(stage){
  // Nobody to hold the review means an administrator does.
  case 'approval':case 'review':return {name:names.serviceManager,role:names.serviceManager?'service_manager':'admin'};
  case 'returned':case 'fix':case 'closure':return {name:names.registrar,role:'registrar'};
  case 'assignment':return {name:names.salesManager,role:'sales_manager'};
  case 'delegation':return {name:names.assignee,role:'supervisor'};
  case 'first_contact':case 'follow_up':case 'resolution':return {name:names.assignee,role:sales};
  default:return null;
 }
};
const newest=(entries:TrackingLast[])=>[...entries].sort((a,b)=>b.at.localeCompare(a.at))[0]||null;
const NOTE_ACTIONS=new Set(['service:note','service:assist','service:reply']);

/** An opportunity the registrar handed to sales, as a board row; a case without its progress is placed at registration. */
export function trackedOpportunity(item:TrackedCase):TrackingItem{
 const progress=item.progress,stage=progress?.stage||'approval',delegated=!!item.data.delegatedAt;
 const finished=stage==='closed',outcome=finished?(item.state==='won'||item.state==='lost'?item.state:''):'';
 const last=newest([
  ...(item.contacts||[]).map(contact=>({kind:'contact' as const,at:contact.createdAt,by:contact.actor,text:String(contact.result||contact.summary||'')})),
  ...(item.history||[]).filter(entry=>NOTE_ACTIONS.has(entry.action||'')&&!!entry.detail.note).map(entry=>({kind:'note' as const,at:entry.createdAt,by:entry.actor,text:String(entry.detail.note)}))
 ]);
 return {
  key:'opportunity:'+item.id,kind:'opportunity',id:item.id,customerId:item.customer.id,customerName:item.customer.name,
  products:Array.isArray(item.data.products)?item.data.products.map(String):[],needs:String(item.data.needs||''),category:'',complaintNumber:null,severity:'normal',
  registeredAt:item.createdAt,registrarId:item.creatorId,registrarName:item.creatorName,
  stage,stageSince:progress?.since||item.createdAt,stageHours:progress?.stageHours||0,targetHours:progress?.targetHours??null,late:!!progress?.late&&!finished,
  side:trackingSide(stage),steps:trackingSteps('opportunity',stage,delegated),delegated,
  holder:holderOf(stage,{serviceManager:item.serviceManagerName,registrar:item.creatorName,salesManager:item.salesManagerName,assignee:item.assignedName},progress?.assigneeRole||''),
  finishedAt:finished?(progress?.finishedAt||item.updatedAt):'',outcome,last
 };
}

/** A complaint the registrar raised, as a board row. */
export function trackedComplaint(entry:ComplaintEntry):TrackingItem{
 const stage=entry.stage,cancelled=stage==='cancelled',finished=stage==='closed'||cancelled,delegated=entry.events.some(event=>event.action==='delegate');
 const last=newest([
  ...entry.updates.map(update=>({kind:'update' as const,at:update.at,by:update.byName,text:update.text})),
  ...entry.notes.map(note=>({kind:'note' as const,at:note.at,by:note.byName,text:note.text}))
 ]);
 return {
  key:'complaint:'+entry.id,kind:'complaint',id:entry.id,customerId:entry.customerId,customerName:entry.customerName,
  products:[],needs:entry.description,category:entry.category,complaintNumber:entry.complaintNumber,severity:entry.severity,
  registeredAt:entry.createdAt,registrarId:entry.registrarId,registrarName:entry.registrarName,
  stage,stageSince:entry.stageSince,stageHours:entry.stageHours,targetHours:entry.targetHours,late:entry.late&&!finished,
  side:trackingSide(stage),steps:trackingSteps('complaint',stage,delegated),delegated,
  holder:holderOf(stage,{serviceManager:entry.serviceManagerName,registrar:entry.registrarName,salesManager:entry.salesManagerName,assignee:entry.assigneeName},entry.assigneeRole),
  finishedAt:finished?(entry.stageSince||entry.updatedAt):'',outcome:cancelled?'cancelled':finished?entry.closure?.outcome||'':'',last
 };
}

/** The open ones first (the late, then the longest waiting in their stage, then the newest), then the finished, the latest first. */
export function sortTracking(items:TrackingItem[]):TrackingItem[]{
 const done=(item:TrackingItem)=>item.side==='done';
 return [...items].sort((a,b)=>Number(done(a))-Number(done(b))||(done(a)?b.finishedAt.localeCompare(a.finishedAt):Number(b.late)-Number(a.late)||b.stageHours-a.stageHours||b.registeredAt.localeCompare(a.registeredAt))||a.key.localeCompare(b.key));
}
const withinWindow=(finishedAt:string,now:string)=>{const age=Date.parse(now)-Date.parse(finishedAt);return Number.isFinite(age)&&age<=TRACKING_FINISHED_DAYS*DAY;};

/** The board's rows for a customer-service member. A representative follows what they registered; a manager what their team and they
 * registered (the routes already limit what each may read, and a manager reads no one else's). Finished items stay for thirty days. */
export function trackingItems(input:{me:{id:string;role:string};cases:TrackedCase[]|null|undefined;complaints:ComplaintEntry[]|null|undefined;now?:string}):TrackingItem[]{
 const {me}=input,now=input.now||new Date().toISOString();
 if(me.role!=='customer_service'&&me.role!=='customer_service_manager')return [];
 const own=me.role==='customer_service';
 const items=[
  ...(input.cases||[]).filter(item=>!own||item.creatorId===me.id).map(trackedOpportunity),
  ...(input.complaints||[]).filter(entry=>!own||entry.registrarId===me.id).map(trackedComplaint)
 ].filter(item=>item.side!=='done'||withinWindow(item.finishedAt,now));
 return sortTracking(items);
}
export function filterTracking(items:TrackingItem[],filter:TrackingFilter):TrackingItem[]{
 if(filter==='late')return items.filter(item=>item.side!=='done'&&item.late);
 if(filter==='service'||filter==='sales')return items.filter(item=>item.side===filter);
 if(filter==='finished')return items.filter(item=>item.side==='done');
 return items;
}
/** The number beside each filter. */
export const trackingCounts=(items:TrackingItem[]):Record<TrackingFilter,number>=>Object.fromEntries(trackingFilters.map(filter=>[filter,filterTracking(items,filter).length])) as Record<TrackingFilter,number>;
