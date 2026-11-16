// Customer service in the sales process, on the server (the owner, 2026-11-16, item 5 of the GSCO list, after GSCO 2.13.78; the rules are
// lib/service-sales.ts). The records an opportunity is started from and the two lists of «مصادر الفرص», the facts the customer-service
// manager decides the routing on, the «تسجيل دور خدمة العملاء» tasks, the sales attribution and the full customer-service sales that leave
// every achievement, and the dashboard «أداء خدمة العملاء» with its Excel file. Reading never writes; every write is one batch.
import {z} from 'zod';
import {context,CRMError} from './crm-server';
import type {Member,Row} from './crm';
import {memberCanAccessRegion} from './regions';
import {activeServiceCase,canReadService,heldStage,isServiceRole,serviceCandidates,serviceClosedAt,serviceContacts,servicePermissions,serviceState,type ServiceCase} from './customer-service';
import {customerVisits} from './customer-visits';
import {isSalesRequest,isOpen} from './crm';
import {customerErpCodes,customerCodeKey,uniqueCustomerCodes} from './customer-identity';
import {readCustomerIdentityState} from './customer-identity-store';
import {readLastPurchases} from './customer-last-purchase-server';
import {canReadSupport,supportReader,type SupportRow} from './support';
import {loadAllSupport} from './support-rows';
import {canReadComplaint,complaintReader} from './complaints';
import {loadAllComplaints} from './complaint-rows';
import {quotationRefKey,storedQuotationRefs} from './quotation-refs';
import {xlsxBook,type BookCell} from './xlsx-write';
import {
 DORMANT_DAYS,LEAD_LIST_LIMIT,LEAD_OTHER,ROLE_TASK_HOURS,SALES_MANAGER_SEES_ALL_SERVICE_TEAMS,SUPPORT_SALES_DAYS,SUPPORT_SALES_OUTCOMES,
 attributeSales,creditedMember,dormantCustomer,dormantListed,fullSalesIds,leadInputSchema,leadLabel,leadLabelEn,leadReader,performanceAllowed,performanceColumns,performanceNote,performanceNoteEn,performanceTotal,
 riyadhDayOf,roleTaskHours,roleTaskLate,roleTaskSchema,roleTaskTarget,routingEligible,routingReasons,salesCategoryLabels,salesCategoryLabelsEn,serviceLeadProblem,servicePerformance,systemLeadSources,
 type CaseFact,type InvoiceFact,type Lead,type LeadList,type LeadRefKind,type PerformanceMember,type QuoteFact,type RoleTaskFact,type RoutingFacts,type SupportContactFact
} from './service-sales';
import {loadSettings} from './service-kpi-rows';
import type {ConversionFact} from './service-kpi';

type Context=Awaited<ReturnType<typeof context>>;
const text=(value:unknown)=>value===null||value===undefined?'':String(value);
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const riyadhMonth=(iso:string)=>riyadhDayOf(iso).slice(0,7);
/** The day in Riyadh now. */
export const riyadhToday=()=>riyadhDayOf(new Date().toISOString());
export function requestedMonth(url:URL,now:string){const asked=url.searchParams.get('month');if(!asked)return riyadhMonth(now);if(!MONTH.test(asked))throw new CRMError('اختر شهرًا صحيحًا.',400);return asked;}
const caseNumber=(item:ServiceCase)=>{const value=item.data.registration?.visitNumber;return typeof value==='number'&&Number.isSafeInteger(value)?value:null;};
const nameOf=(members:readonly Member[])=>(id:string|null|undefined)=>id?members.find(member=>member.id===id)?.name||'':'';

// ------------------------------------------------------------------------------------------------------------- A. «مصادر الفرص»
/** The customers a reader may start an opportunity on, as the opportunity form offers them: an administrator every customer of their
 *  regions; customer service the customers of their branch and regions (the same as app/api/customer-service customerChoices). */
const inReach=(me:Member,customer:Row|undefined)=>!!customer&&customer.kind==='customer'&&memberCanAccessRegion(me,customer.data.region)&&(me.role==='admin'||customer.branch===me.branch);
export type LeadReference={kind:LeadRefKind;id:string;source:string;label:string;customerId:string;customerName:string;/** Why it cannot be started now ('' when it can). */blocked:string};
const STARTED='بدأت فرصة جديدة من هذا السجل من قبل.';
const OPEN_CASE='للعميل فرصة مفتوحة لدى خدمة العملاء أو المبيعات؛ تابعها بدل بدء فرصة جديدة.';
/** Whether an opportunity was already started from this record (any state: a record starts one opportunity). */
const startedFrom=(c:Pick<Context,'serviceCases'>,kind:LeadRefKind,id:string)=>c.serviceCases.some(item=>item.leadRefKind===kind&&item.leadRefId===id);
/** The record an opportunity is started from, as this reader may read it, with the source the system fills in. 404 for a record the
 *  reader may not read (or that is not there), 409 for one that cannot start an opportunity (not lost, has bought, the wrong kind). */
export async function resolveLeadReference(c:Context,kind:LeadRefKind,id:string):Promise<LeadReference>{
 if(!leadReader(c.me.role))throw new CRMError('مصادر الفرص متاحة لخدمة العملاء ومدير النظام.',403);
 const source=systemLeadSources[kind],customers=new Map(c.all.filter(row=>row.kind==='customer').map(row=>[row.id,row]));
 const finish=(customerId:string,label:string):LeadReference=>{
  const customer=customers.get(customerId);
  if(!inReach(c.me,customer))throw new CRMError('العميل غير متاح لك.',404);
  const blocked=startedFrom(c,kind,id)?STARTED:activeServiceCase(customerId,c)?OPEN_CASE:'';
  return {kind,id,source,label,customerId,customerName:text(customer!.data.name),blocked};
 };
 if(kind==='opportunity'){
  const item=c.serviceCases.find(row=>row.id===id);
  if(!item||!inReach(c.me,customers.get(item.customerId)))throw new CRMError('الفرصة غير متاحة لك.',404);
  if(serviceState(item,c.all,c.members)!=='lost')throw new CRMError('تبدأ الفرصة الجديدة من فرصة مفقودة فقط.',409);
  return finish(item.customerId,'#'+(caseNumber(item)??'—')+' · '+text(customers.get(item.customerId)?.data.name));
 }
 if(kind==='customer'){
  const customer=customers.get(id);
  if(!inReach(c.me,customer))throw new CRMError('العميل غير متاح لك.',404);
  const last=(await readLastPurchases(c.db,c.all)).get(id);
  if(!dormantCustomer(last,riyadhToday()))throw new CRMError('العميل اشترى خلال 90 يومًا؛ لا يُبدأ له مصدر «عميل منقطع عن الشراء».',409);
  return finish(id,text(customer!.data.name));
 }
 if(kind==='support'||kind==='missed_visit'){
  const row=(await loadAllSupport(c.db)).find(entry=>entry.id===id);
  if(!row||!canReadSupport(row,customers.get(row.data.customerId),supportReader(c)))throw new CRMError('الطلب غير متاح لك.',404);
  if((row.data.origin==='missed_visit')!==(kind==='missed_visit'))throw new CRMError('نوع الطلب لا يطابق مصدر الفرصة.',409);
  return finish(row.data.customerId,text(customers.get(row.data.customerId)?.data.name));
 }
 const row=(await loadAllComplaints(c.db)).find(entry=>entry.id===id);
 if(!row||!canReadComplaint(row,customers.get(row.data.customerId),complaintReader(c),c.members))throw new CRMError('الشكوى غير متاحة لك.',404);
 const number=(row.data as {complaintNumber?:unknown}).complaintNumber;
 return finish(row.data.customerId,(typeof number==='number'?'#'+number+' · ':'')+text(customers.get(row.data.customerId)?.data.name));
}
/** The lead of a new opportunity (POST /api/customer-service create). `present`: whether the request carried the field; the form always
 *  sends it, so only a save queued on a device by an older page (or an older tool) arrives without it and keeps «غير محدد». */
export async function intakeLead(c:Context,raw:unknown,present:boolean,customerId:string):Promise<Lead|null>{
 if(!present)return null;
 if(raw===null||raw===undefined)throw new CRMError('اختر مصدر الفرصة.',400);
 const parsed=leadInputSchema.safeParse(raw);
 if(!parsed.success)throw new CRMError('اختر مصدر الفرصة من القائمة.',400);
 const input=parsed.data,problem=serviceLeadProblem(input);
 if(problem)throw new CRMError(problem,400);
 if(input.group==='system'){
  const ref=await resolveLeadReference(c,input.refKind!,input.refId!);
  if(input.source&&input.source!==ref.source)throw new CRMError('مصدر الفرصة يحدده النظام من السجل الذي بدأت منه.',400);
  if(ref.customerId!==customerId)throw new CRMError('اختر عميل السجل الذي بدأت منه الفرصة.',400);
  if(ref.blocked===STARTED)throw new CRMError(STARTED,409);
  return {group:'system',source:ref.source,note:'',refKind:input.refKind!,refId:input.refId!};
 }
 return {group:'service',source:input.source,note:input.source===LEAD_OTHER?input.note:'',refKind:null,refId:null};
}
export type LostRow={id:string;number:number|null;customerId:string;customerName:string;lossReason:string;lostAt:string;holderName:string;registrarName:string};
export type DormantRow={id:string;name:string;code:string;city:string;phone:string;repName:string;lastPurchase:string};
/** The loss reason of a lost opportunity: the stage customer service recorded, or the contact that closed it with sales. */
function lossReasonOf(item:ServiceCase,all:Row[]){if(item.status==='service')return text(heldStage(item)?.lossReason);const contact=serviceContacts(item,all)[0];return text(contact?.data.lossReason);}
/** GET /api/service-leads?list=lost|dormant&q=: the lists of «مصادر الفرص», what the reader may start an opportunity on, newest first. */
export async function leadList(c:Context,list:LeadList,query:string){
 const q=query.trim().toLowerCase().slice(0,60),match=(...values:unknown[])=>!q||values.some(value=>text(value).toLowerCase().includes(q));
 const customers=new Map(c.all.filter(row=>row.kind==='customer').map(row=>[row.id,row])),name=nameOf(c.members);
 if(list==='lost'){
  const rows:LostRow[]=[];
  for(const item of c.serviceCases){
   const customer=customers.get(item.customerId);
   if(!inReach(c.me,customer)||serviceState(item,c.all,c.members)!=='lost'||startedFrom(c,'opportunity',item.id)||activeServiceCase(item.customerId,c))continue;
   const row={id:item.id,number:caseNumber(item),customerId:item.customerId,customerName:text(customer!.data.name),lossReason:lossReasonOf(item,c.all),lostAt:serviceClosedAt(item,c.all)||item.updatedAt,holderName:name(item.assignedTo),registrarName:name(item.creatorId)};
   if(match(row.number,row.customerName,row.lossReason,row.holderName,row.registrarName))rows.push(row);
  }
  rows.sort((a,b)=>b.lostAt.localeCompare(a.lostAt)||a.id.localeCompare(b.id));
  return {list,total:rows.length,rows:rows.slice(0,LEAD_LIST_LIMIT)};
 }
 const last=await readLastPurchases(c.db,c.all),today=riyadhToday(),rows:DormantRow[]=[];
 for(const customer of customers.values()){
  if(!inReach(c.me,customer)||activeServiceCase(customer.id,c))continue;
  const lastPurchase=last.get(customer.id)||'';
  if(!dormantListed(lastPurchase,today))continue;
  const row={id:customer.id,name:text(customer.data.name),code:text(customer.data.code),city:text(customer.data.city),phone:text(customer.data.phone||customer.data.phone2),repName:name(customer.assignedTo),lastPurchase};
  if(match(row.name,row.code,row.city,row.phone,row.repName))rows.push(row);
 }
 rows.sort((a,b)=>b.lastPurchase.localeCompare(a.lastPurchase)||a.name.localeCompare(b.name,'ar')||a.id.localeCompare(b.id));
 return {list,total:rows.length,rows:rows.slice(0,LEAD_LIST_LIMIT),days:DORMANT_DAYS};
}

// ------------------------------------------------------------------------------------------------------------- B. routing at approval
export type SalesWarning={kind:'visit'|'request';stage:string;ownerName:string;date:string};
/** Open opportunities of the customer with sales: the latest visit or follow-up of a sales member (outside this case) at an open stage,
 *  and its open mold requests. A warning only: it decides nothing. */
export function openSalesWarnings(c:Pick<Context,'all'|'members'>,item:ServiceCase):SalesWarning[]{
 const name=nameOf(c.members),sales=(id:unknown)=>['rep','supervisor','manager'].includes(c.members.find(member=>member.id===id)?.role||'');
 const warnings:SalesWarning[]=[];
 const latest=customerVisits(item.customerId,c.all).find(row=>row.data.serviceCaseId!==item.id&&sales(row.data.performedBy||row.data.responsibleId||row.assignedTo)&&!!row.data.salesStage);
 if(latest&&!['won','lost'].includes(latest.data.salesStage))warnings.push({kind:'visit',stage:text(latest.data.salesStage),ownerName:name(text(latest.data.performedBy||latest.data.responsibleId||latest.assignedTo)),date:text(latest.data.date)});
 const indexed=new Map(c.all.map(row=>[row.id,row]));
 const rootOf=(row:Row)=>{let current:Row|undefined=row;for(let depth=0;current&&current.kind!=='customer'&&depth<5;depth++)current=current.parentId?indexed.get(current.parentId):undefined;return current?.kind==='customer'?current.id:'';};
 for(const row of c.all)if(isSalesRequest(row)&&isOpen(row)&&rootOf(row)===item.customerId&&sales(row.assignedTo))warnings.push({kind:'request',stage:text(row.data.stage),ownerName:name(row.assignedTo),date:text(row.data.nextDate)});
 return warnings.slice(0,10);
}
/** Whether customer service may keep this opportunity, from the facts the system holds today. */
export async function routingFactsOf(c:Context,item:ServiceCase):Promise<RoutingFacts>{
 const customer=c.all.find(row=>row.kind==='customer'&&row.id===item.customerId);
 const last=customer?(await readLastPurchases(c.db,c.all)).get(customer.id):undefined;
 return {unlinked:!customer||!customerErpCodes(customer).length,dormant:dormantCustomer(last,riyadhToday()),serviceEffort:item.leadGroup==='service'};
}
/** GET /api/service-routing?id=: what the approver sees before deciding. Only for the opportunity waiting for this reader's approval. */
export async function routingView(c:Context,id:string){
 const item=c.serviceCases.find(row=>row.id===id);
 if(!item||!canReadService(item,c))throw new CRMError('الطلب غير متاح',404);
 if(!servicePermissions(item,c).approve)throw new CRMError('الفرصة ليست بانتظار اعتمادك.',409);
 const facts=await routingFactsOf(c,item),eligible=routingEligible(facts);
 return {id,version:item.version,eligible,reasons:routingReasons(facts),facts,warnings:openSalesWarnings(c,item),
  salesManagers:serviceCandidates(item,c,'approve').map(m=>({id:m.id,name:m.name})),serviceMembers:eligible?serviceCandidates(item,c,'keep').map(m=>({id:m.id,name:m.name,role:m.role})):[],registrarId:item.creatorId};
}

// ------------------------------------------------------------------------------------------------------------- C. attribution
/** Every opportunity customer service took part in (registered by it, or by an administrator), as the rules read them. */
export function caseFacts(cases:readonly ServiceCase[],all:Row[],members:readonly Member[]):CaseFact[]{
 const customers=new Map(all.filter(row=>row.kind==='customer').map(row=>[row.id,row]));
 return cases.map(item=>({id:item.id,number:caseNumber(item),customerId:item.customerId,customerName:text(customers.get(item.customerId)?.data.name),registrarId:item.creatorId,
  ownerId:item.status==='service'?text(item.assignedTo):text(item.assignedTo),held:item.status==='service'&&!!item.assignedTo,route:item.route==='service'||item.route==='sales'?item.route:null,
  approved:!!item.data.approvedAt,createdAt:item.createdAt,state:serviceState(item,all,[...members]),closedAt:serviceClosedAt(item,all),leadGroup:item.leadGroup||null,leadSource:item.leadSource||null,leadNote:text(item.leadNote)}));
}
type ServiceRaw={id:string;customerId:string;status:string;creatorId:string;serviceManagerId:string|null;salesManagerId:string|null;assignedTo:string|null;supervisorId:string|null;data:string;createdAt:string;updatedAt:string;version:number;
 leadGroup:string|null;leadSource:string|null;leadRefKind:string|null;leadRefId:string|null;leadNote:string;route:string|null;routedBy:string|null;routedAt:string|null};
const SERVICE_COLUMNS="id,customer_id AS customerId,status,creator_id AS creatorId,service_manager_id AS serviceManagerId,sales_manager_id AS salesManagerId,assigned_to AS assignedTo,supervisor_id AS supervisorId,data,created_at AS createdAt,updated_at AS updatedAt,version,lead_group AS leadGroup,lead_source AS leadSource,lead_ref_kind AS leadRefKind,lead_ref_id AS leadRefId,lead_note AS leadNote,route,routed_by AS routedBy,routed_at AS routedAt";
const decodeCases=(rows:ServiceRaw[])=>{const found:ServiceCase[]=[];for(const row of rows){try{found.push({...row,data:JSON.parse(row.data)});}catch{/* a damaged row is left out */}}return found;};
type RecordRaw={id:string;kind:string;parentId:string|null;assignedTo:string;branch:string;data:string;createdAt:string;updatedAt:string;version:number};
const decodeRecords=(rows:RecordRaw[])=>{const found:Row[]=[];for(const row of rows){try{found.push({...row,kind:row.kind as Row['kind'],data:JSON.parse(row.data)});}catch{/* left out */}}return found;};
/** Everything the attribution reads, company-wide and whoever asks (a figure of a member never depends on the reader). */
export type SalesFacts={cases:CaseFact[];quotes:QuoteFact[];invoices:InvoiceFact[];contacts:SupportContactFact[];serviceCases:ServiceCase[];records:Row[];support:SupportRow[]};
async function loadSalesFacts(db:D1Database,members:readonly Member[],options:{heldOnly?:boolean}={}):Promise<SalesFacts|null>{
 const held=(await db.prepare(`SELECT ${SERVICE_COLUMNS} FROM crm_service_cases WHERE route='service'`).all<ServiceRaw>()).results;
 if(options.heldOnly&&!held.length)return null;
 const serviceCases=decodeCases(options.heldOnly
  ?(await db.prepare(`SELECT ${SERVICE_COLUMNS} FROM crm_service_cases WHERE customer_id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify([...new Set(held.map(row=>row.customerId))])).all<ServiceRaw>()).results
  :(await db.prepare(`SELECT ${SERVICE_COLUMNS} FROM crm_service_cases ORDER BY created_at,id`).all<ServiceRaw>()).results);
 const customerIds=JSON.stringify([...new Set(serviceCases.map(item=>item.customerId))]);
 // The customers (every one: an ERP code counts only when one customer holds it), the contacts of the cases, and the quotations of their
 // customers (an ERP quotation's parent is its customer; a quotation of a mold request sits two or three levels below).
 const [customers,contacts,quoteRows,identity]=await Promise.all([
  db.prepare("SELECT id,kind,parent_id AS parentId,assigned_to AS assignedTo,branch,data,created_at AS createdAt,updated_at AS updatedAt,version FROM crm_records WHERE kind='customer'").all<RecordRaw>(),
  db.prepare("SELECT id,kind,parent_id AS parentId,assigned_to AS assignedTo,branch,data,created_at AS createdAt,updated_at AS updatedAt,version FROM crm_records WHERE kind='activity' AND json_extract(data,'$.serviceCaseId') IN (SELECT id FROM crm_service_cases WHERE customer_id IN (SELECT value FROM json_each(?)))").bind(customerIds).all<RecordRaw>(),
  db.prepare(`SELECT q.id,json_extract(q.data,'$.number') AS number,json_extract(q.data,'$.date') AS date,json_extract(q.data,'$.status') AS status,COALESCE(json_extract(q.data,'$.total'),0) AS total,
   CASE WHEN p1.kind='customer' THEN p1.id WHEN p2.kind='customer' THEN p2.id WHEN p3.kind='customer' THEN p3.id ELSE '' END AS customerId
   FROM crm_records q LEFT JOIN crm_records p1 ON p1.id=q.parent_id LEFT JOIN crm_records p2 ON p2.id=p1.parent_id LEFT JOIN crm_records p3 ON p3.id=p2.parent_id
   WHERE q.kind='quote' AND (p1.id IN (SELECT value FROM json_each(?)) OR p2.id IN (SELECT value FROM json_each(?)) OR p3.id IN (SELECT value FROM json_each(?)))`).bind(customerIds,customerIds,customerIds).all<{id:string;number:string|null;date:string|null;status:string|null;total:number;customerId:string}>(),
  readCustomerIdentityState(db)
 ]);
 const customerRows=decodeRecords(customers.results),records=[...customerRows,...decodeRecords(contacts.results)];
 const quotes:QuoteFact[]=quoteRows.results.filter(row=>row.status!=='draft'&&row.customerId&&quotationRefKey(row.number)).map(row=>({id:row.id,ref:quotationRefKey(row.number)!,customerId:row.customerId,date:text(row.date).slice(0,10),total:Number(row.total)||0}));
 const refs=new Set(quotes.map(q=>q.ref));
 const codes=uniqueCustomerCodes(customerRows,identity?.mappings||[]),customerOfCode=(code:string)=>{const matches=codes.get(customerCodeKey(code))||[];return matches.length===1?matches[0].id:'';};
 // The sales documents: those that name a quotation of these customers (for «بالكامل» and «بالمشاركة»), and, beyond the held-only read, every
 // document (for «بالمساندة» and the customers that came back).
 const erp=(await db.prepare(options.heldOnly
  ?"SELECT id,reference,date,document_type,rep_id,customer_code,total_cents,json_extract(data,'$.quotationRefs') AS refs FROM crm_erp_sales WHERE json_array_length(data,'$.quotationRefs')>0"
  :"SELECT id,reference,date,document_type,rep_id,customer_code,total_cents,json_extract(data,'$.quotationRefs') AS refs FROM crm_erp_sales").all<{id:string;reference:string;date:string;document_type:'sale'|'return';rep_id:string;customer_code:string;total_cents:number;refs:string|null}>()).results;
 const invoices:InvoiceFact[]=[];
 for(const row of erp){
  let named:string[]=[];try{named=storedQuotationRefs(JSON.parse(row.refs||'[]'));}catch{named=[];}
  if(options.heldOnly&&!named.some(ref=>refs.has(ref)))continue;
  invoices.push({id:row.id,source:'erp',number:row.reference,date:row.date,type:row.document_type==='return'?'return':'sale',customerId:customerOfCode(row.customer_code),repId:row.rep_id,value:Number(row.total_cents)/100,refs:named.filter(ref=>refs.has(ref))});
 }
 let support:SupportRow[]=[],supportContacts:SupportContactFact[]=[];
 if(!options.heldOnly){
  for(const row of (await db.prepare("SELECT id,reference,date,rep_id,customer_id,total_cents FROM crm_sales WHERE status='confirmed'").all<{id:string;reference:string;date:string;rep_id:string;customer_id:string;total_cents:number}>()).results)
   invoices.push({id:row.id,source:'crm',number:row.reference,date:row.date,type:row.total_cents<0?'return':'sale',customerId:row.customer_id,repId:row.rep_id,value:Number(row.total_cents)/100,refs:[]});
  support=await loadAllSupport(db);
  supportContacts=support.flatMap(row=>{const result=row.data.result;if(row.data.status==='cancelled'||!result||!(SUPPORT_SALES_OUTCOMES as readonly string[]).includes(result.outcome))return [];const handler=text(result.by||row.data.handlerId);return handler&&result.at?[{requestId:row.id,customerId:row.data.customerId,handlerId:handler,at:result.at}]:[];});
 }
 return {cases:caseFacts(serviceCases,records,members),quotes,invoices,contacts:supportContacts,serviceCases,records,support};
}
/** The ids of the sales documents that are full customer-service sales (crm_erp_sales ids): what every achievement, the company counter and
 *  the evaluation leave out (the owner: «منفصلة تمامًا»). Null when customer service keeps no opportunity: nothing more is read then. */
export async function fullServiceSaleIds(db:D1Database,members:readonly Member[]=[]):Promise<Set<string>|null>{
 const facts=await loadSalesFacts(db,members,{heldOnly:true});
 if(!facts)return null;
 return fullSalesIds(attributeSales({cases:facts.cases,quotes:facts.quotes,invoices:facts.invoices,contacts:[],supportDays:0}));
}
const exclusionCache=new WeakMap<object,Promise<Set<string>|null>>();
/** fullServiceSaleIds once a request (the context object is the request's): every reader of the achievement in it asks the same set. */
export function serviceSalesExclusion(c:{db:D1Database;members:readonly Member[]}):Promise<Set<string>|null>{
 let found=exclusionCache.get(c);if(!found){found=fullServiceSaleIds(c.db,c.members);exclusionCache.set(c,found);}return found;
}
/** The support-sales window, from the evaluation's settings (the administrator's «مدة احتساب مبيعات المساندة»). */
export async function readSupportSalesDays(db:D1Database){const days=(await loadSettings(db)).settings.supportSalesDays;return Number.isInteger(days)&&days>=1&&days<=365?days:SUPPORT_SALES_DAYS;}
/** For «نسبة الفرص المتحولة إلى مبيعات»: each opportunity that closed, whose it is and whether it sold (won, or an invoice of its quotation). */
export async function loadConversionFacts(db:D1Database,members:readonly Member[]):Promise<ConversionFact[]>{
 const facts=await loadSalesFacts(db,members);
 if(!facts)return [];
 const closed=facts.cases.filter(item=>(item.state==='won'||item.state==='lost')&&item.closedAt);
 if(!closed.length)return [];
 const attributed=attributeSales({cases:facts.cases,quotes:facts.quotes,invoices:facts.invoices,contacts:[],supportDays:0});
 const invoiced=new Set(attributed.filter(a=>a.caseId&&a.type==='sale'&&a.value>0).map(a=>a.caseId as string));
 return closed.map(item=>({caseId:item.id,customerId:item.customerId,memberId:creditedMember(item),closedAt:item.closedAt,won:item.state==='won',invoiced:invoiced.has(item.id)}));
}

// ------------------------------------------------------------------------------------------------------------- D. role tasks
/** The moment the feature began: migration 0021 applied. An opportunity closed before it asks for no role (nobody was asked then). */
async function featureStart(db:D1Database){return text((await db.prepare("SELECT applied_at FROM yr_schema_migrations WHERE name='0021_service_sales_process.sql'").first<{applied_at:string}>())?.applied_at)||'9999';}
type TaskRaw={case_id:string;outcome:'won'|'lost';member_id:string;basis:RoleTaskFact['basis'];closed_at:string;roles:string;note:string;done_by:string;done_at:string};
/** Every task: the roles recorded, and the closings since the feature began that wait for theirs. */
export async function loadRoleTasks(db:D1Database,members:readonly Member[],facts?:SalesFacts|null):Promise<RoleTaskFact[]>{
 const loaded=facts??await loadSalesFacts(db,members);
 const [start,done]=await Promise.all([featureStart(db),db.prepare('SELECT * FROM crm_service_role_tasks').all<TaskRaw>()]);
 const recorded=new Map(done.results.map(row=>[row.case_id,row]));
 const out:RoleTaskFact[]=[];
 if(!loaded){for(const row of done.results)out.push(fromRaw(row,null,''));return out;}
 const activeService=new Set(members.filter(m=>m.active&&isServiceRole(m.role)).map(m=>m.id));
 const byId=new Map(loaded.cases.map(item=>[item.id,item]));
 for(const row of done.results){const item=byId.get(row.case_id);out.push(fromRaw(row,item?.number??null,item?.customerName||''));}
 for(const item of loaded.cases){
  if(recorded.has(item.id)||!(item.state==='won'||item.state==='lost')||!item.closedAt||item.closedAt<start)continue;
  const handler=loaded.support.filter(row=>row.data.opportunity?.id===item.id&&row.data.handlerId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]?.data.handlerId;
  const target=roleTaskTarget(item,activeService,handler);
  if(target)out.push({caseId:item.id,number:item.number,customerName:item.customerName,outcome:item.state,memberId:target.memberId,basis:target.basis,closedAt:item.closedAt,roles:[],note:'',doneBy:'',doneAt:''});
 }
 return out;
}
function fromRaw(row:TaskRaw,number:number|null,customerName:string):RoleTaskFact{let roles:string[]=[];try{const list=JSON.parse(row.roles);roles=Array.isArray(list)?list.map(String):[];}catch{roles=[];}return {caseId:row.case_id,number,customerName,outcome:row.outcome,memberId:row.member_id,basis:row.basis,closedAt:row.closed_at,roles,note:row.note,doneBy:row.done_by,doneAt:row.done_at};}
/** Whose tasks a reader follows: a member their own; a customer-service manager their own and their team's; an administrator everyone's. */
function taskReach(me:Member,members:readonly Member[]):Set<string>|null{
 if(me.role==='admin')return null;
 if(me.role==='customer_service_manager')return new Set([me.id,...members.filter(m=>m.supervisorId===me.id&&m.role==='customer_service').map(m=>m.id)]);
 if(me.role==='customer_service')return new Set([me.id]);
 return new Set();
}
/** GET /api/service-role-tasks: the tasks the reader follows, open first, then those recorded in the last 30 days. */
export async function roleTasksView(c:Context,now:string){
 if(!leadReader(c.me.role))throw new CRMError('تسجيل دور خدمة العملاء متاح لخدمة العملاء ومدير النظام.',403);
 const reach=taskReach(c.me,c.members),name=nameOf(c.members),since=Date.parse(now)-30*86400000;
 const tasks=(await loadRoleTasks(c.db,c.members)).filter(t=>(!reach||reach.has(t.memberId))&&(!t.doneAt||Date.parse(t.doneAt)>=since))
  .map(t=>({...t,memberName:name(t.memberId),doneByName:name(t.doneBy),hours:Math.round(roleTaskHours(t.closedAt,t.doneAt||now)*10)/10,targetHours:ROLE_TASK_HOURS,late:t.doneAt?roleTaskHours(t.closedAt,t.doneAt)>ROLE_TASK_HOURS:roleTaskLate(t.closedAt,now),canRecord:!t.doneAt&&(t.memberId===c.me.id||c.me.role==='admin')}))
  .sort((a,b)=>Number(!!a.doneAt)-Number(!!b.doneAt)||Number(b.late)-Number(a.late)||a.closedAt.localeCompare(b.closedAt));
 const open=tasks.filter(t=>!t.doneAt),mine=open.filter(t=>t.memberId===c.me.id).length,late=open.filter(t=>t.memberId!==c.me.id&&t.late).length;
 return {generatedAt:now,tasks,counts:{mine,late,badge:mine+late}};
}
const taskPostSchema=z.object({caseId:z.string().min(1).max(200),roles:z.array(z.string().max(80)).max(10),note:z.string().max(1000),requestId:z.string().uuid()}).strict();
/** POST /api/service-role-tasks: the member records the roles and a note, once; one batch with its audit line. */
export async function recordRoleTask(c:Context,body:unknown,now:string){
 if(!leadReader(c.me.role))throw new CRMError('تسجيل دور خدمة العملاء متاح لخدمة العملاء ومدير النظام.',403);
 const input=taskPostSchema.parse(body),parsed=roleTaskSchema.safeParse({roles:input.roles,note:input.note});
 if(!parsed.success)throw new CRMError(parsed.error.issues.map(issue=>issue.message).join(' • '),400);
 const task=(await loadRoleTasks(c.db,c.members)).find(t=>t.caseId===input.caseId);
 if(!task)throw new CRMError('المهمة غير متاحة.',404);
 const reach=taskReach(c.me,c.members);if(reach&&!reach.has(task.memberId))throw new CRMError('المهمة غير متاحة.',404);
 if(task.memberId!==c.me.id&&c.me.role!=='admin')throw new CRMError('يسجّل الدور ممثل خدمة العملاء المكلّف بالمهمة.',403);
 if(task.doneAt)return {ok:true,caseId:task.caseId,alreadyDone:true};
 const roles=[...new Set(parsed.data.roles)],mutation=crypto.randomUUID();
 const result=await c.db.batch([
  c.db.prepare("INSERT INTO crm_service_role_tasks(case_id,outcome,member_id,basis,closed_at,roles,note,done_by,done_at,mutation_id) SELECT ?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM crm_service_role_tasks WHERE case_id=?) AND EXISTS(SELECT 1 FROM crm_members WHERE id=? AND active=1 AND role=? AND auth_version=?)")
   .bind(task.caseId,task.outcome,task.memberId,task.basis,task.closedAt,JSON.stringify(roles),parsed.data.note,c.me.id,now,mutation,task.caseId,c.me.id,c.me.role,c.me.authVersion??1),
  c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM crm_service_role_tasks WHERE case_id=? AND mutation_id=?)')
   .bind(crypto.randomUUID(),task.caseId,c.me.name,'service:role',JSON.stringify({label:'تسجيل دور خدمة العملاء',outcome:task.outcome,roles,note:parsed.data.note,hours:Math.round(roleTaskHours(task.closedAt,now)*10)/10}),now,task.caseId,mutation)
 ]);
 if(!result[0].meta.changes){const again=await c.db.prepare('SELECT done_by FROM crm_service_role_tasks WHERE case_id=?').bind(task.caseId).first();if(again)return {ok:true,caseId:task.caseId,alreadyDone:true};throw new CRMError('تغيّرت المهمة أو الصلاحيات. حدّث القائمة وحاول مجددًا.',409);}
 return {ok:true,caseId:task.caseId};
}

// ------------------------------------------------------------------------------------------------------------- E. the dashboard
/** The members a reader sees, grouped by customer-service manager: an administrator (and the sales manager, question 3) every team, a
 *  customer-service manager his own team and himself, a member himself. Members with no customer-service manager form the last group. */
export function performanceTeams(me:Member,members:readonly Member[]):{managerId:string;managerName:string;members:PerformanceMember[]}[]{
 const service=members.filter(m=>isServiceRole(m.role)&&(m.active||m.id===me.id));
 const asMember=(m:Member):PerformanceMember=>({id:m.id,name:m.name,role:m.role,supervisorId:m.supervisorId||''});
 if(me.role==='customer_service')return [{managerId:me.supervisorId||'',managerName:members.find(m=>m.id===me.supervisorId)?.name||'',members:[asMember(me)]}];
 const all=me.role==='admin'||me.role==='manager'&&SALES_MANAGER_SEES_ALL_SERVICE_TEAMS;
 const managers=me.role==='customer_service_manager'?[me]:service.filter(m=>m.role==='customer_service_manager'&&(all||m.supervisorId===me.id));
 const groups=managers.map(m=>({managerId:m.id,managerName:m.name,members:[asMember(m),...service.filter(x=>x.role==='customer_service'&&x.supervisorId===m.id).map(asMember)]}));
 if(all){const orphans=service.filter(x=>x.role==='customer_service'&&!managers.some(m=>m.id===x.supervisorId)).map(asMember);if(orphans.length)groups.push({managerId:'',managerName:'',members:orphans});}
 return groups;
}
export type PerformanceView=Awaited<ReturnType<typeof performanceView>>;
/** GET /api/service-performance?month=: the dashboard, read-only. No target and no achievement percentage (the owner's decision). */
export async function performanceView(c:Context,month:string,now:string){
 if(!performanceAllowed(c.me.role))throw new CRMError('أداء خدمة العملاء متاح لمدير النظام ومدير المبيعات ومدير خدمة العملاء وممثل خدمة العملاء لنفسه.',403);
 const supportDays=await readSupportSalesDays(c.db),facts=await loadSalesFacts(c.db,c.members);
 const cases=facts?.cases||[],quotes=facts?.quotes||[],invoices=facts?.invoices||[],contacts=facts?.contacts||[];
 const attributed=attributeSales({cases,quotes,invoices,contacts,supportDays}),tasks=await loadRoleTasks(c.db,c.members,facts);
 const groups=performanceTeams(c.me,c.members),visible=groups.flatMap(g=>g.members);
 const rows=servicePerformance({members:visible,cases,quotes,attributed,invoices,contacts,tasks},month,now);
 const teams=groups.map(g=>{const own=rows.filter(r=>g.members.some(m=>m.id===r.memberId));return {managerId:g.managerId,managerName:g.managerName,rows:own,total:performanceTotal(own,g.managerName)};});
 const ids=new Set(visible.map(m=>m.id)),name=nameOf(c.members),number=new Map(cases.map(o=>[o.id,o.number]));
 const invoiceRows=attributed.filter(a=>a.date.slice(0,7)===month&&ids.has(a.memberId)).map(a=>({date:a.date,number:a.number,type:a.type,category:a.category,memberName:name(a.memberId),value:a.value,caseNumber:a.caseId?number.get(a.caseId)??null:null}));
 const opportunities=cases.filter(o=>riyadhMonth(o.createdAt)===month&&ids.has(o.registrarId)).map(o=>({number:o.number,customerName:o.customerName,registrarName:name(o.registrarId),ownerName:o.held?name(o.ownerId):'',leadGroup:o.leadGroup,leadSource:o.leadSource,leadNote:o.leadNote,
  route:o.held?'service':o.route==='sales'||o.approved?'sales':'',state:o.state,createdAt:o.createdAt}));
 return {generatedAt:now,month,supportDays,note:performanceNote,teams,invoices:invoiceRows,opportunities};
}
const stateWords:Record<string,[string,string]>={pending_approval:['بانتظار اعتماد خدمة العملاء','Awaiting customer service approval'],returned:['مطلوب تعديل','Changes requested'],pending_assignment:['بانتظار تكليف المبيعات','Awaiting sales assignment'],
 with_supervisor:['لدى مشرف المبيعات','With sales supervisor'],assigned:['قيد متابعة المبيعات','Sales follow-up in progress'],service:['لدى خدمة العملاء','With customer service'],won:['تم الفوز','Won'],lost:['تم الفقد','Lost']};
/** «تصدير Excel» of the dashboard: «الملخص» (a row a member and a total a team), «الفواتير» (each invoice behind the sales figures) and «الفرص»
 *  (each opportunity registered in the month), right to left in Arabic, in English for an English page. */
export function performanceWorkbook(view:PerformanceView,language:'ar'|'en'){
 const say=(ar:string,en:string)=>language==='en'?en:ar;
 const header=[say('المجموعة','Group'),say('العضو','Member'),...performanceColumns.map(col=>say(col.ar,col.en))];
 const summary:BookCell[][]=[[say('أداء خدمة العملاء','Customer-service performance')+' · '+view.month],[say(performanceNote,performanceNoteEn)],header];
 for(const team of view.teams){
  const group=team.managerName||say('بدون مدير خدمة عملاء','No customer-service manager');
  for(const row of team.rows)summary.push([group,row.memberName,...performanceColumns.map(col=>col.value(row))]);
  summary.push([group,say('الإجمالي','Total'),...performanceColumns.map(col=>col.value(team.total))]);
 }
 const invoices:BookCell[][]=[[say('التاريخ','Date'),say('رقم الفاتورة','Invoice number'),say('النوع','Type'),say('الفئة','Category'),say('العضو','Member'),say('القيمة قبل الضريبة','Value before tax'),say('رقم الفرصة','Opportunity number')],
  ...view.invoices.map(i=>[i.date,i.number,i.type==='return'?say('مرتجع','Return'):say('فاتورة مبيعات','Sales invoice'),say(salesCategoryLabels[i.category],salesCategoryLabelsEn[i.category]),i.memberName,i.value,i.caseNumber===null?'':'#'+i.caseNumber])];
 const opportunities:BookCell[][]=[[say('رقم الفرصة','Opportunity number'),say('العميل','Customer'),say('سجّلها','Registered by'),say('مصدر الفرصة','Opportunity source'),say('قرار الاعتماد','Approval decision'),say('المسؤول من خدمة العملاء','Customer-service owner'),say('الحالة','State'),say('التسجيل','Registered')],
  ...view.opportunities.map(o=>[o.number===null?'':'#'+o.number,o.customerName,o.registrarName,language==='en'?leadLabelEn(o.leadGroup,o.leadSource,o.leadNote):leadLabel(o.leadGroup,o.leadSource,o.leadNote),o.route==='service'?say('تتولاها خدمة العملاء','Customer service takes it'):o.route==='sales'?say('تمرير لمدير المبيعات','Pass to the sales manager'):say('بانتظار القرار','Awaiting decision'),o.ownerName,say(...(stateWords[o.state]||[o.state,o.state])),riyadhDayOf(o.createdAt)])];
 const rtl=language!=='en';
 return {fileName:'Yourrest-service-performance-'+view.month+'.xlsx',bytes:xlsxBook([
  {name:say('الملخص','Summary'),rows:summary,rightToLeft:rtl,headerRows:[2],noteRows:[1],widths:[22,22,...performanceColumns.map(()=>14)]},
  {name:say('الفواتير','Invoices'),rows:invoices,rightToLeft:rtl,headerRows:[0],widths:[12,16,14,20,22,16,14]},
  {name:say('الفرص','Opportunities'),rows:opportunities,rightToLeft:rtl,headerRows:[0],widths:[12,26,20,34,24,22,22,12]}
 ])};
}

// ------------------------------------------------------------------------------------------------------------- the sales report line
export type FullServiceShare={total:number;invoices:number;ids:string[]};
/** «منها مبيعات خدمة العملاء بالكامل»: of the sales the report lists (the ERP total kept), how much customer service made alone. */
export function fullServiceShare(sales:readonly {id:string;status?:string;totalCents:number;documentType?:string}[],excluded:ReadonlySet<string>|null):FullServiceShare{
 if(!excluded||!excluded.size)return {total:0,invoices:0,ids:[]};
 const mine=sales.filter(s=>excluded.has(s.id)&&s.status!=='void');
 return {total:mine.reduce((n,s)=>n+s.totalCents,0)/100,invoices:mine.filter(s=>s.documentType!=='return').length,ids:mine.map(s=>s.id)};
}
