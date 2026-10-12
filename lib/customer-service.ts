import {z} from 'zod';
import {type Member,type Row,today} from './crm';
import {memberCanAccessRegion} from './regions';
import {salesScopeMemberIds,canReadSalesRecord} from './access';
import {riyadhDate} from './visits';
import {visitOrder,visitProducts} from './customer-visits';
import {customerAddressFields} from './customer-fields';

export const serviceRoles=['customer_service','customer_service_manager'];
export const isServiceRole=(role:string)=>serviceRoles.includes(role);
export const serviceSources:Record<string,string>={visit:'زيارة',call:'اتصال',email:'بريد إلكتروني',whatsapp:'واتساب',website:'عن طريق الويبسايت',social:'عن طريق مواقع التواصل الاجتماعي'};
export const serviceStatusLabels:Record<string,string>={pending_approval:'بانتظار اعتماد خدمة العملاء',returned:'مطلوب تعديل',pending_assignment:'بانتظار تكليف المبيعات',with_supervisor:'لدى مشرف المبيعات',assigned:'قيد متابعة المبيعات',won:'تم الفوز',lost:'تم الفقد'};
export const serviceActions:Record<string,string>={create:'تسجيل طلب خدمة العملاء',edit:'تعديل وإعادة إرسال',approve:'اعتماد وإحالة للمبيعات',return:'إعادة للتعديل',assign:'تكليف المبيعات',delegate:'تكليف مندوب',reassign:'إعادة تكليف',seen:'فتح الطلب',note:'ملاحظة داخلية',assist:'طلب مساعدة داخلية'};
export type ServiceRegistration={date?:string;type?:string;performedBy?:string;competitorFileId?:string;offlineRecordedAt?:string;[key:string]:unknown};
export type ServiceRegistrationEntry={id:string;registration:ServiceRegistration;createdAt:string};
export type ServiceCaseData={participants?:string[];registration?:ServiceRegistration;registrations?:ServiceRegistrationEntry[];assistanceOpen?:boolean;source?:string;products?:string[];strength?:string;needs?:string;nextAction?:string;nextDate?:string;approvedBy?:string;approvedAt?:string;assignedAt?:string;assignedBy?:string;delegatedAt?:string;delegatedBy?:string;reassignedAt?:string;reassignedBy?:string;previousAssignees?:string[];resubmittedAt?:string;assignmentNote?:string;assignmentNoteBy?:string;seenAt?:string;seenBy?:string;[key:string]:unknown};
export type ServiceCase={id:string;customerId:string;status:string;creatorId:string;serviceManagerId:string|null;salesManagerId:string|null;assignedTo:string|null;supervisorId:string|null;data:ServiceCaseData;createdAt:string;updatedAt:string;version:number};
export type ServiceContext={me:Member;members:Member[];all:Row[];serviceCases:ServiceCase[]};
const required=z.string().trim().min(1,'هذا الحقل مطلوب').max(250);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'اختر موعد المتابعة').refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'التاريخ غير صالح');
export function serviceIntakeSchemaForDay(recordedDay?:string){return z.object({source:z.enum(['visit','call','email','whatsapp','website','social']),products:z.array(z.string().refine(p=>[...visitProducts,'خدمات صيانة'].includes(p),'اختر الصنف من القائمة')).min(1,'اختر صنفًا واحدًا على الأقل').max(8),strength:z.enum(['weak','medium','strong']),needs:z.string().trim().min(3,'اكتب احتياج العميل').max(4000),nextAction:required,nextDate:date.refine(v=>v>=(recordedDay||today()),'موعد المتابعة يجب أن يكون يوم التسجيل أو لاحقًا')}).strict();}
export const serviceIntakeSchema=serviceIntakeSchemaForDay();
export const serviceCustomerSchema=z.object({name:required,contact:z.string().trim().max(250).default(''),phone:z.string().trim().min(1,'أدخل رقم التواصل').max(100),city:z.string().trim().max(250).default(''),region:z.string().trim().max(250).default(''),address:z.string().trim().max(250).default(''),customerType:z.string().trim().max(250).default(''),customerStatus:z.string().trim().max(250).default(''),category:z.string().trim().max(250).default(''),...customerAddressFields}).strict();
const contactIndexes=new WeakMap<Row[],Map<string,Row[]>>();
export function serviceContacts(item:ServiceCase,all:Row[]){let index=contactIndexes.get(all);if(!index){index=new Map();for(const r of all){if(r.kind!=='activity'||!r.data.serviceCaseId)continue;const contacts=index.get(r.data.serviceCaseId)||[];contacts.push(r);index.set(r.data.serviceCaseId,contacts);}for(const contacts of index.values())contacts.sort((a,b)=>visitOrder(b).localeCompare(visitOrder(a)));contactIndexes.set(all,index);}return index.get(item.id)||[];}
export function serviceState(item:ServiceCase,all:Row[],members:Member[]){const contact=serviceContacts(item,all)[0],stage=contact?.data.salesStage||'new';return ['won','lost'].includes(stage)?stage:item.status==='assigned'&&members.find(m=>m.id===item.assignedTo)?.role==='supervisor'?'with_supervisor':item.status;}
const activeIndexes=new WeakMap<ServiceContext,Map<string,ServiceCase>>();
export function activeServiceCase(customerId:string,c:ServiceContext){let index=activeIndexes.get(c);if(!index){index=new Map();for(const s of c.serviceCases)if(!index.has(s.customerId)&&!['won','lost'].includes(serviceState(s,c.all,c.members)))index.set(s.customerId,s);activeIndexes.set(c,index);}return index.get(customerId);}
/** Once a later intake exists, its predecessor's contact history cannot be rewritten. */
export function serviceHistoryLocked(record:Row,c:ServiceContext){const item=c.serviceCases.find(s=>s.id===record.data.serviceCaseId);return !!item&&c.serviceCases.some(s=>s.customerId===item.customerId&&s.id!==item.id&&s.createdAt>=item.createdAt);}
export function canReadService(item:ServiceCase,c:ServiceContext){
 const customer=c.all.find(r=>r.kind==='customer'&&r.id===item.customerId);if(!customer||!memberCanAccessRegion(c.me,customer.data.region))return false;
 if(c.me.role==='admin')return true;
 if(['rep','supervisor','manager'].includes(c.me.role)){
  const team=salesScopeMemberIds(c.members,c.me);
  return !!item.assignedTo&&team.has(item.assignedTo)||c.me.role==='manager'&&item.salesManagerId===c.me.id;
 }
 if(customer.branch!==c.me.branch)return false;
 const participants=[item.creatorId,item.serviceManagerId,...(item.data.participants||[])];
 if(participants.includes(c.me.id))return true;
 return c.me.role==='customer_service_manager'&&c.members.some(m=>m.id===item.creatorId&&m.supervisorId===c.me.id&&m.active);
}
export function serviceTeamIds(me:Member,members:Member[]){const ids=salesScopeMemberIds(members,me,{activeOnly:true});ids.delete(me.id);return ids;}
export function serviceCandidates(item:ServiceCase,c:ServiceContext,action:'approve'|'assign'|'delegate'|'reassign'){
 const customer=c.all.find(r=>r.id===item.customerId)!;const team=serviceTeamIds(c.me,c.members);
 // Moving a case (re-assignment, or a supervisor delegating again) never offers the member who already holds it.
 return c.members.filter(m=>m.active&&memberCanAccessRegion(m,customer.data.region)&&(action==='approve'?m.role==='manager'&&(c.me.role==='admin'||m.id===c.me.supervisorId):['rep','supervisor'].includes(m.role)&&m.branch===customer.branch&&(c.me.role==='admin'||team.has(m.id))&&(action!=='delegate'||m.role==='rep'&&m.supervisorId===c.me.id)&&(action==='assign'||m.id!==item.assignedTo)));
}
/** The people a case passes through; a reader inside this chain may see what the others wrote on it. */
export function serviceChainIds(item:ServiceCase){return [item.creatorId,item.serviceManagerId,item.salesManagerId,item.supervisorId,item.assignedTo].filter((id):id is string=>!!id);}
export function servicePermissions(item:ServiceCase,c:ServiceContext){const state=serviceState(item,c.all,c.members),closed=state==='won'||state==='lost',admin=c.me.role==='admin',pending=['pending_approval','returned'].includes(item.status),manager=c.me.role==='customer_service_manager'&&(item.serviceManagerId===c.me.id||c.members.some(m=>m.id===item.creatorId&&m.active&&m.supervisorId===c.me.id)),assignee=c.members.find(m=>m.id===item.assignedTo),held=item.status==='assigned'&&!closed;return{edit:pending&&(admin||item.creatorId===c.me.id&&isServiceRole(c.me.role)),approve:item.status==='pending_approval'&&(admin||manager),assign:item.status==='pending_assignment'&&(admin||c.me.role==='manager'&&item.salesManagerId===c.me.id),// A supervisor hands a case to one of their representatives, whether it sits with the supervisor or with another of their representatives.
 delegate:held&&c.me.role==='supervisor'&&(item.assignedTo===c.me.id||assignee?.role==='rep'&&assignee.supervisorId===c.me.id),// Only the sales manager the case was routed to, or an administrator, moves a held case to someone else.
 reassign:held&&(admin||c.me.role==='manager'&&item.salesManagerId===c.me.id),seen:held&&item.assignedTo===c.me.id,followup:['assigned','with_supervisor'].includes(state)&&!isServiceRole(c.me.role)&&(admin||c.me.role==='manager'&&item.salesManagerId===c.me.id||item.assignedTo===c.me.id),note:canReadService(item,c)};}

/** Read projections never widen the sales write scope in context(). */
export function serviceVisitRecords(c:ServiceContext & {visible:Row[];regionalRecords:Row[]}){
 const records=new Map(c.visible.map(r=>[r.id,r]));
 const readCustomer=(r:Row)=>{if(!records.has(r.id)){const data={...r.data,_readOnly:true};delete data._visitPlan;delete data._stageVisitId;records.set(r.id,{...r,data});}};
 if(isServiceRole(c.me.role))for(const r of c.regionalRecords)if(r.kind==='customer'&&r.branch===c.me.branch)readCustomer(r);
 for(const item of c.serviceCases){
  if(!canReadService(item,c))continue;
  const customer=c.all.find(r=>r.id===item.customerId)!;readCustomer(customer);
  const permissions=servicePermissions(item,c),state=serviceState(item,c.all,c.members);
  const workflow={id:item.id,state,permissions,assistanceOpen:!!item.data.assistanceOpen};
  const registration=item.data.registration||{date:riyadhDate(item.createdAt),type:item.data.source,summary:'',result:'',requestedProducts:item.data.products,strength:item.data.strength,customerNeeds:item.data.needs,nextAction:item.data.nextAction,nextDate:item.data.nextDate,salesStage:'new',performedBy:item.creatorId,responsibleId:item.creatorId};
  const intake:Row={id:'intake-'+item.id,kind:'activity',parentId:customer.id,assignedTo:item.creatorId,branch:customer.branch,data:{...registration,visitWorkflow:'service-intake-v1',serviceIntakeId:item.id,_serviceWorkflow:workflow,_readOnly:!permissions.edit},createdAt:item.createdAt,updatedAt:item.updatedAt,version:item.version};
  if(isServiceRole(c.me.role)||canReadSalesRecord(intake,c.members,c.me))records.set(intake.id,intake);
  for(const entry of item.data.registrations||[]){const contact:Row={id:entry.id,kind:'activity',parentId:customer.id,assignedTo:entry.registration.performedBy||item.creatorId,branch:customer.branch,data:{...entry.registration,visitWorkflow:'service-intake-v1',serviceIntakeId:item.id,_serviceWorkflow:workflow,_readOnly:true},createdAt:entry.createdAt,updatedAt:entry.createdAt,version:item.version};if(isServiceRole(c.me.role)||canReadSalesRecord(contact,c.members,c.me))records.set(contact.id,contact);}
  for(const contact of serviceContacts(item,c.all)){
   const visible=records.get(contact.id);
   if(!isServiceRole(c.me.role)&&!canReadSalesRecord(contact,c.members,c.me))continue;
   records.set(contact.id,{...(visible||contact),parentId:visible?.parentId||customer.id,data:{...(visible||contact).data,_readOnly:!visible||!!visible.data._readOnly,_serviceWorkflow:workflow}});
  }
 }
 return [...records.values()];
}

export function matchesServiceFilter(row:Row,filter:string){const w=row.data._serviceWorkflow;return filter==='all'||filter==='mine'&&!!(w?.permissions.approve||w?.permissions.assign||w?.permissions.delegate)||filter==='assistance'&&!!w?.assistanceOpen||w?.state===filter;}
