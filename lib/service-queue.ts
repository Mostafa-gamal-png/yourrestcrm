import type {Member,Row} from './crm';
import {canReadService,isServiceRole,serviceContacts,servicePermissions,serviceState,type ServiceCase,type ServiceContext} from './customer-service';
import {workingHoursBetween} from './working-hours';

/** What a sales reader (administrator, manager, supervisor or representative) needs about each customer-service
 * case they may read: the brief, where it stands, who must act next and whether that stage is late. It never carries
 * the customer-service registration text, its attachments or internal notes; those stay behind the case API's rules.
 * The figures feed no target, evaluation or movement calculation. */
export const SERVICE_TARGET_HOURS={approval:4,assignment:4,delegation:4,first_contact:24} as const;
export type QueueStage='approval'|'returned'|'assignment'|'delegation'|'first_contact'|'follow_up'|'closed';
export type QueueAwaiting='approve'|'assign'|'delegate'|'first_contact'|null;
export type ServiceQueueEntry={
 id:string;customerId:string;customerName:string;customerPhone:string;customerCity:string;customerRegion:string;customerVersion:number;
 source:string;products:string[];strength:string;needs:string;nextAction:string;nextDate:string;
 status:string;state:string;salesStage:string;
 creatorId:string;creatorName:string;serviceManagerName:string;salesManagerId:string|null;salesManagerName:string;
 assignedTo:string|null;assignedName:string;assignedRole:string;supervisorName:string;
 /** The representative or supervisor who owns the customer today, offered first when assigning. */
 currentRepId:string;currentRepName:string;
 assignmentNote:string;assignmentNoteBy:string;
 contactCount:number;contactsSinceDispatch:number;lastContactAt:string;
 seenAt:string;seenByName:string;
 stage:QueueStage;stageSince:string;stageHours:number;targetHours:number|null;late:boolean;
 /** Who must act at this stage; null when nobody is expected to. */
 ownerId:string|null;
 /** What the reader themself must do, if anything. */
 awaiting:QueueAwaiting;
 /** Late at a stage owned by someone below the reader. */
 escalated:boolean;
 permissions:ReturnType<typeof servicePermissions>;
 createdAt:string;updatedAt:string;version:number;
};
type QueueContext=ServiceContext&{visible:Row[]};
const STRENGTH_ORDER:Record<string,number>={strong:0,medium:1,weak:2};
const latest=(...values:(string|undefined)[])=>values.filter((value):value is string=>!!value).sort().at(-1)||'';

/** The stage a case is in and since when, from facts the case already carries. */
export function queueStage(item:ServiceCase,state:string,contactsSinceDispatch:number,assignedRole:string):{stage:QueueStage;since:string}{
 if(state==='won'||state==='lost')return {stage:'closed',since:item.updatedAt};
 if(item.status==='returned')return {stage:'returned',since:item.updatedAt};
 if(item.status==='pending_approval')return {stage:'approval',since:item.data.resubmittedAt||item.createdAt};
 if(item.status==='pending_assignment')return {stage:'assignment',since:item.data.approvedAt||item.updatedAt};
 if(item.status==='assigned'){
  const since=latest(item.data.assignedAt,item.data.delegatedAt,item.data.reassignedAt)||item.updatedAt;
  if(contactsSinceDispatch>0)return {stage:'follow_up',since};
  return {stage:assignedRole==='supervisor'?'delegation':'first_contact',since};
 }
 return {stage:'follow_up',since:item.updatedAt};
}
const targetFor=(stage:QueueStage):number|null=>stage==='approval'||stage==='assignment'||stage==='delegation'||stage==='first_contact'?SERVICE_TARGET_HOURS[stage]:null;
function ownerFor(item:ServiceCase,stage:QueueStage):string|null{
 if(stage==='approval')return item.serviceManagerId;
 if(stage==='returned')return item.creatorId;
 if(stage==='assignment')return item.salesManagerId;
 if(stage==='delegation'||stage==='first_contact'||stage==='follow_up')return item.assignedTo;
 return null;
}
function above(me:Member,owner:Member|undefined){
 if(!owner||owner.id===me.id)return false;
 if(me.role==='admin')return true;
 if(me.role==='manager')return ['supervisor','rep'].includes(owner.role);
 if(me.role==='supervisor')return owner.role==='rep'&&owner.supervisorId===me.id;
 return false;
}
/** Entries first by what the reader must do, then the late ones, the strongest opportunities, the oldest. */
export function sortQueue(entries:ServiceQueueEntry[]){
 return [...entries].sort((a,b)=>Number(!!b.awaiting)-Number(!!a.awaiting)||Number(b.late)-Number(a.late)||(STRENGTH_ORDER[a.strength]??3)-(STRENGTH_ORDER[b.strength]??3)||a.stageSince.localeCompare(b.stageSince)||a.id.localeCompare(b.id));
}
/** The number shown on the Visits entry in the navigation. */
export const serviceQueueBadge=(entries:ServiceQueueEntry[])=>entries.filter(entry=>entry.awaiting||entry.escalated).length;

export function serviceQueue(c:QueueContext,now:string=new Date().toISOString()):ServiceQueueEntry[]{
 if(isServiceRole(c.me.role))return [];
 const member=(id:string|null|undefined)=>id?c.members.find(m=>m.id===id):undefined,name=(id:string|null|undefined)=>member(id)?.name||'';
 const contactRecords=c.me.role==='admin'?c.all:c.visible,customers=new Map(c.all.filter(r=>r.kind==='customer').map(r=>[r.id,r]));
 const entries:ServiceQueueEntry[]=[];
 for(const item of c.serviceCases){
  const customer=customers.get(item.customerId);
  if(!customer||!canReadService(item,c))continue;
  const state=serviceState(item,contactRecords,c.members),contacts=serviceContacts(item,contactRecords),assignee=member(item.assignedTo);
  const dispatchedAt=latest(item.data.assignedAt,item.data.delegatedAt,item.data.reassignedAt),contactsSinceDispatch=contacts.filter(r=>!dispatchedAt||r.createdAt>=dispatchedAt).length;
  const {stage,since}=queueStage(item,state,contactsSinceDispatch,assignee?.role||''),targetHours=targetFor(stage),stageHours=workingHoursBetween(since,now),late=targetHours!==null&&stageHours>targetHours;
  const permissions=servicePermissions(item,c),ownerId=ownerFor(item,stage),mine=item.assignedTo===c.me.id;
  const awaiting:QueueAwaiting=stage==='approval'&&permissions.approve?'approve':stage==='assignment'&&permissions.assign?'assign':stage==='delegation'&&mine?'delegate':stage==='first_contact'&&mine?'first_contact':null;
  const currentRep=member(customer.assignedTo),currentRepId=currentRep&&['rep','supervisor'].includes(currentRep.role)?currentRep.id:'';
  entries.push({
   id:item.id,customerId:customer.id,customerName:String(customer.data.name||''),customerPhone:String(customer.data.phone||''),customerCity:String(customer.data.city||''),customerRegion:String(customer.data.region||''),customerVersion:customer.version,
   source:String(item.data.source||''),products:Array.isArray(item.data.products)?item.data.products.map(String):[],strength:String(item.data.strength||''),needs:String(item.data.needs||''),nextAction:String(contacts[0]?.data.nextAction??item.data.nextAction??''),nextDate:String(contacts[0]?.data.nextDate??item.data.nextDate??''),
   status:item.status,state,salesStage:String(contacts[0]?.data.salesStage||'new'),
   creatorId:item.creatorId,creatorName:name(item.creatorId),serviceManagerName:name(item.serviceManagerId),salesManagerId:item.salesManagerId,salesManagerName:name(item.salesManagerId),
   assignedTo:item.assignedTo,assignedName:name(item.assignedTo),assignedRole:assignee?.role||'',supervisorName:name(item.supervisorId),
   currentRepId,currentRepName:currentRepId?name(currentRepId):'',
   assignmentNote:String(item.data.assignmentNote||''),assignmentNoteBy:name(item.data.assignmentNoteBy),
   contactCount:contacts.length,contactsSinceDispatch,lastContactAt:contacts[0]?.createdAt||'',
   seenAt:String(item.data.seenAt||''),seenByName:name(item.data.seenBy),
   stage,stageSince:since,stageHours,targetHours,late,ownerId,awaiting,escalated:late&&above(c.me,member(ownerId)),
   permissions,createdAt:item.createdAt,updatedAt:item.updatedAt,version:item.version
  });
 }
 return sortQueue(entries);
}
