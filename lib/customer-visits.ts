import {type Row,type Member,isSalesRequest,scopeRecords} from './crm';
export const visitProducts=['قوالب البلوك المتحركة','قوالب البلوك الثابتة','لمامة البلوك','ماكينة إنتاج البلوكة المتحركة','قطع غيار المكائن المتحركة','خلاطات البلوك','خلاطات الخرسانة الجاهزة'];
export const strengthLabels:Record<string,string>={weak:'ضعيفة',medium:'متوسطة',strong:'قوية'};
export function visitCustomer(row:Row|undefined,records:Row[]):Row|undefined{for(let i=0;row&&i<5;i++){if(row.kind==='customer')return row;row=records.find(r=>r.id===row?.parentId);}return undefined;}
export function visitRequest(row:Row|undefined,records:Row[]):Row|undefined{if(!row)return;const candidate=records.find(r=>r.id===(row.data.requestId||row.parentId));return candidate&&isSalesRequest(candidate)?candidate:undefined;}
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
export function visitOrder(r:Row){const eventAt=r.data.offlineRecordedAt&&Number.isFinite(Date.parse(r.data.offlineRecordedAt))?r.data.offlineRecordedAt:r.createdAt;const candidates=[(r.kind==='quote'||r.data.visitWorkflow==='followup-v1')&&r.data.date===new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(eventAt))?eventAt:undefined,r.data.startedAt,r.data.date?r.data.date+'T00:00:00+03:00':undefined,eventAt];const time=candidates.find(value=>value&&Number.isFinite(Date.parse(value)));const created=Number.isFinite(Date.parse(eventAt))?new Date(eventAt).toISOString():'';return (time?new Date(time).toISOString():'0000-01-01T00:00:00.000Z')+'|'+created+'|'+r.id;}
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
export function customerVisitDue(records:Row[]){return records.filter(r=>r.kind==='customer').flatMap(c=>{const source=customerPlanSource(c.id,records);return source&&!['won','lost'].includes(source.data.salesStage||source.data.stage||'new')&&source.data.followupStatus!=='closed'?[source]:[];});}
