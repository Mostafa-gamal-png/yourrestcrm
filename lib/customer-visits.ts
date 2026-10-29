import {type Row,type Member,isSalesRequest,scopeRecords} from './crm';
export const visitProducts=['قوالب البلوك المتحركة','قوالب البلوك الثابتة','لمامة البلوك','ماكينة إنتاج البلوكة المتحركة','قطع غيار المكائن المتحركة','خلاطات البلوك','خلاطات الخرسانة الجاهزة'];
export const strengthLabels:Record<string,string>={weak:'ضعيفة',medium:'متوسطة',strong:'قوية'};
// A lookup by id for each records array, kept while the array lives, so the two helpers below cost one lookup per step instead of
// a scan of every record (they run once per visit in lists of thousands). Records arrays are snapshots that are never changed in
// place; the length check still rebuilds the lookup if one ever grows or shrinks. The first record of an id wins, as with find().
const lookups=new WeakMap<readonly Row[],{length:number;byId:Map<unknown,Row>}>();
function byIdOf(records:readonly Row[]){
 let entry=lookups.get(records);
 if(!entry||entry.length!==records.length){const byId=new Map<unknown,Row>();for(const row of records)if(!byId.has(row.id))byId.set(row.id,row);entry={length:records.length,byId};lookups.set(records,entry);}
 return entry.byId;
}
export function visitCustomer(row:Row|undefined,records:Row[]):Row|undefined{const byId=byIdOf(records);for(let i=0;row&&i<5;i++){if(row.kind==='customer')return row;row=byId.get(row.parentId);}return undefined;}
export function visitRequest(row:Row|undefined,records:Row[]):Row|undefined{if(!row)return;const candidate=byIdOf(records).get(row.data.requestId||row.parentId);return candidate&&isSalesRequest(candidate)?candidate:undefined;}
export function customerVisits(customerId:string,records:Row[]){
 // Build an index for this invocation only. Preserve first-match semantics and
 // the legacy five-level ancestry limit without a full scan for every activity.
 const indexed=new Map<string,Row>();for(const row of records)if(!indexed.has(row.id))indexed.set(row.id,row);
 const visits:{row:Row;order:string}[]=[];
 for(const row of records){if(row.kind!=='activity')continue;let parent:Row|undefined=row,customer:Row|undefined;
  for(let depth=0;parent&&depth<5;depth++){if(parent.kind==='customer'){customer=parent;break;}parent=parent.parentId!==null?indexed.get(parent.parentId):undefined;}
  if(customer?.id===customerId)visits.push({row,order:visitOrder(row)});
 }
 return visits.sort((a,b)=>b.order.localeCompare(a.order)).map(item=>item.row);
}
// One formatter for every call: building an Intl formatter costs far more than using one, and visitOrder runs inside sorts.
const riyadhDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'});
export function visitOrder(r:Row){const eventAt=r.data.offlineRecordedAt&&Number.isFinite(Date.parse(r.data.offlineRecordedAt))?r.data.offlineRecordedAt:r.createdAt;const candidates=[(r.kind==='quote'||r.data.visitWorkflow==='followup-v1')&&r.data.date===riyadhDay.format(new Date(eventAt))?eventAt:undefined,r.data.startedAt,r.data.date?r.data.date+'T00:00:00+03:00':undefined,eventAt];const time=candidates.find(value=>value&&Number.isFinite(Date.parse(value)));const created=Number.isFinite(Date.parse(eventAt))?new Date(eventAt).toISOString():'';return (time?new Date(time).toISOString():'0000-01-01T00:00:00.000Z')+'|'+created+'|'+r.id;}
export function visitResponsibleOptions(customer:Row|undefined,members:Member[],me:Member){if(!customer)return members.filter(m=>m.active&&m.id===me.id);return members.filter(m=>m.active&&(['admin','manager'].includes(me.role)||m.id===me.id||me.role==='supervisor'&&m.supervisorId===me.id)&&scopeRecords([customer],members,m).length>0);}
/** Latest customer plan, shared by follow-ups and the dashboard. Visit snapshots stay unchanged. */
export function customerPlanSource(customerId:string,records:Row[]){
 const visit=customerVisits(customerId,records).find(r=>r.data.visitWorkflow!=='service-intake-v1');
 const requests=records.filter(r=>r.kind==='opportunity'&&visitCustomer(r,records)?.id===customerId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 const request=requests[0];if(!visit)return request;if(!request)return visit;
 const linked=visitRequest(visit,records);
 if(visit.data.visitWorkflow!=='followup-v1'&&linked&&['won','lost'].includes(linked.data.stage))return request.updatedAt>linked.updatedAt?request:linked;
 return request.updatedAt>visitOrder(visit).split('|')[0]?request:visit;
}
/** customerPlanSource for every customer of `records` at once, in one pass instead of one pass per customer (a list of 2,300 customers
 * scanned every record 2,300 times on each screen update). Each customer gets exactly what customerPlanSource gives it: the latest
 * visit other than an intake, the most recently updated request, and the same choice between them. */
export function customerPlanSources(records:Row[]):Map<string,Row|undefined>{
 const indexed=new Map<string,Row>();for(const row of records)if(!indexed.has(row.id))indexed.set(row.id,row);
 const root=(row:Row|undefined)=>{for(let depth=0;row&&depth<5;depth++){if(row.kind==='customer')return row;row=row.parentId!==null?indexed.get(row.parentId):undefined;}return undefined;};
 // The first of the latest wins a tie, as the stable sorts of customerVisits and customerPlanSource keep it first.
 const visits=new Map<string,{row:Row;order:string}>(),requests=new Map<string,Row>();
 for(const row of records){
  if(row.kind==='activity'){if(row.data.visitWorkflow==='service-intake-v1')continue;const customer=root(row);if(!customer)continue;const order=visitOrder(row),best=visits.get(customer.id);if(!best||order.localeCompare(best.order)>0)visits.set(customer.id,{row,order});}
  else if(row.kind==='opportunity'){const customer=root(row);if(!customer)continue;const best=requests.get(customer.id);if(!best||row.updatedAt.localeCompare(best.updatedAt)>0)requests.set(customer.id,row);}
 }
 const plans=new Map<string,Row|undefined>();
 for(const customer of records){
  if(customer.kind!=='customer'||plans.has(customer.id))continue;
  const visit=visits.get(customer.id)?.row,request=requests.get(customer.id);
  if(!visit||!request){plans.set(customer.id,visit||request);continue;}
  const candidate=indexed.get(visit.data.requestId||visit.parentId),linked=candidate&&isSalesRequest(candidate)?candidate:undefined;
  if(visit.data.visitWorkflow!=='followup-v1'&&linked&&['won','lost'].includes(linked.data.stage))plans.set(customer.id,request.updatedAt>linked.updatedAt?request:linked);
  else plans.set(customer.id,request.updatedAt>visitOrder(visit).split('|')[0]?request:visit);
 }
 return plans;
}
export function customerVisitDue(records:Row[],plans:Map<string,Row|undefined>=customerPlanSources(records)){return records.filter(r=>r.kind==='customer').flatMap(c=>{const source=plans.get(c.id);return source&&!['won','lost'].includes(source.data.salesStage||source.data.stage||'new')&&source.data.followupStatus!=='closed'?[source]:[];});}
