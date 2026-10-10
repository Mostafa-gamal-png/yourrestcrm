import type {Member,Row} from './crm';
import type {DailyFollowup} from './daily-report';
import {customerFollowupPlans} from './customer-followups';
import {recordAuthorId} from './access';
import {journeyDate} from './journeys';

/** Plan evidence available by the selected Saudi day. Callers pass only visible records.
 * Existing records are not historical snapshots: subsequent edits remain their saved values.
 */
export function dailyPendingFollowups(records:Row[],members:Member[],scope:Set<string>,date:string,memberId:string):DailyFollowup[]{
 const dayOf=(at:unknown)=>typeof at==='string'&&Number.isFinite(Date.parse(at))?journeyDate(at):'';
 const known=records.filter(row=>{
  if(row.kind==='customer'||row.kind==='factory')return true;
  const recordedDay=dayOf(row.data.offlineRecordedAt)||dayOf(row.createdAt);
  const eventDay=typeof row.data.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(row.data.date)?row.data.date:recordedDay;
  return !!recordedDay&&recordedDay<=date&&!!eventDay&&eventDay<=date&&(row.kind!=='opportunity'||dayOf(row.updatedAt)<=date);
 });
 const index=new Map(records.map(row=>[row.id,row])),knownIds=new Set(known.map(row=>row.id)),grouped=new Map<string,Row[]>();
 for(const row of known)if(row.kind==='customer')grouped.set(row.id,[row]);
 for(const row of known){
  if(row.kind==='customer')continue;let ancestor:Row|undefined=row,missingParent=false;
  for(let depth=0;ancestor&&depth<5;depth++){
   // Retain the customer path of an older contact without including a request's future state.
   if(ancestor.kind==='customer'){grouped.get(ancestor.id)?.push(missingParent?{...row,parentId:ancestor.id}:row);break;}
   if(!knownIds.has(ancestor.id))missingParent=true;
   ancestor=ancestor.parentId?index.get(ancestor.parentId):undefined;
  }
 }
 return [...grouped.values()].flatMap(rows=>customerFollowupPlans(rows)).flatMap(plan=>{
  const author=recordAuthorId(plan.source,members);
  if(plan.closed||!plan.nextAction.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(plan.nextDate)||plan.nextDate>date||!author||!scope.has(author)||(memberId!=='all'&&author!==memberId))return [];
  return [{id:plan.source.id,customerId:plan.customer.id,customerName:plan.customer.data.name||'',memberId:author,memberName:members.find(m=>m.id===author)?.name||'',nextDate:plan.nextDate,nextAction:plan.nextAction}];
 }).sort((a,b)=>a.nextDate.localeCompare(b.nextDate)||a.customerName.localeCompare(b.customerName)||a.id.localeCompare(b.id));
}
