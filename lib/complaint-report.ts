import type {Row} from './crm';
import {COMPLAINT_TARGET_HOURS,canReadComplaint,complaintProgress,complaintReader,isOpenComplaint,type ComplaintContext,type ComplaintData,type ComplaintRow} from './complaints';
import {workingHoursBetween} from './working-hours';
import {riyadhDate} from './visits';
import {reportRate,reportTiming,type ReportTiming} from './report-timing';

/** Monthly view of customer complaints for the people who run customer service and sales: how many came, by which
 * channel, about what and how grave, how they ended and whether the customer was satisfied, how quickly each stage moved in
 * working hours against its target, and how many open ones are late now. Aggregate only (no customer, no text, no name) and,
 * like every complaint figure, for follow-up: it feeds no target, evaluation or movement calculation. */
export type ComplaintReportRow={key:string;total:number;open:number;closed:number;satisfied:number;satisfactionRate:number|null};
export type ComplaintReportCount={key:string;count:number};
export type ComplaintReport={
 month:string;months:string[];generatedAt:string;
 total:number;open:number;closed:number;cancelled:number;high:number;satisfied:number;satisfactionRate:number|null;openOverTarget:number;
 /** Customers with more than one complaint registered in the month. */
 repeatCustomers:number;
 /** How many complaints of the month went back a step at least once: returned for correction, sent back to the representative, reassigned, reopened. */
 flow:{returned:number;sentBack:number;reassigned:number;reopened:number};
 byState:Record<string,number>;byCategory:ComplaintReportRow[];byChannel:ComplaintReportRow[];bySeverity:ComplaintReportRow[];byRegion:ComplaintReportRow[];
 resolutionOutcomes:ComplaintReportCount[];closureOutcomes:ComplaintReportCount[];
 timing:{review:ReportTiming;assignment:ReportTiming;firstContact:ReportTiming;resolution:ReportTiming;closure:ReportTiming;registrationToClosure:ReportTiming};
 targets:typeof COMPLAINT_TARGET_HOURS;
};
/** Administrators, sales managers and customer-service managers; each sees only the complaints they may already read. */
export const complaintReportAllowed=(role:string)=>role==='admin'||role==='manager'||role==='customer_service_manager';
const monthOf=(row:ComplaintRow)=>riyadhDate(row.createdAt).slice(0,7);
/** The dispatch the holder received last before `at`: an assignment, a delegation, a reassignment, a return from customer service or a reopening. */
const dispatchBefore=(data:ComplaintData,at:string)=>[data.assignedAt,data.delegatedAt,data.reassignedAt,data.rejectedAt,data.reopenedAt].filter(stamp=>!!stamp&&stamp<=at).sort().at(-1)||'';
function tally(groups:Map<string,ComplaintReportRow>,key:string,open:boolean,closed:boolean,satisfied:boolean){
 const row=groups.get(key)||{key,total:0,open:0,closed:0,satisfied:0,satisfactionRate:null};
 row.total++;if(open)row.open++;if(closed)row.closed++;if(satisfied)row.satisfied++;
 groups.set(key,row);
}
const rows=(groups:Map<string,ComplaintReportRow>)=>[...groups.values()].map(row=>({...row,satisfactionRate:reportRate(row.satisfied,row.closed)})).sort((a,b)=>b.total-a.total||a.key.localeCompare(b.key));
const counts=(found:Map<string,number>)=>[...found.entries()].map(([key,count])=>({key,count})).sort((a,b)=>b.count-a.count||a.key.localeCompare(b.key));
const bump=(found:Map<string,number>,key:string)=>found.set(key,(found.get(key)||0)+1);

export function complaintReport(c:ComplaintContext,month:string,now:string=new Date().toISOString()):ComplaintReport{
 const reader=complaintReader(c),customers=new Map(c.all.filter(row=>row.kind==='customer').map(row=>[row.id,row]));
 const readable:[ComplaintRow,Row][]=[];
 for(const row of c.complaints){const customer=customers.get(row.data.customerId);if(customer&&canReadComplaint(row,customer,reader,c.members))readable.push([row,customer]);}
 const months=[...new Set(readable.map(([row])=>monthOf(row)))].sort().reverse().slice(0,24);
 const byCategory=new Map<string,ComplaintReportRow>(),byChannel=new Map<string,ComplaintReportRow>(),bySeverity=new Map<string,ComplaintReportRow>(),byRegion=new Map<string,ComplaintReportRow>();
 const byState:Record<string,number>={},resolutions=new Map<string,number>(),closures=new Map<string,number>(),perCustomer=new Map<string,number>();
 const review:number[]=[],assignment:number[]=[],firstContact:number[]=[],resolution:number[]=[],closure:number[]=[],life:number[]=[];
 const flow={returned:0,sentBack:0,reassigned:0,reopened:0};
 let total=0,open=0,closed=0,cancelled=0,high=0,satisfied=0,openOver=0;
 for(const [row,customer] of readable){
  if(monthOf(row)!==month)continue;
  const data=row.data,isOpen=isOpenComplaint(data),isClosed=data.status==='closed',isSatisfied=isClosed&&data.closure?.outcome==='satisfied';
  total++;
  if(isOpen)open++;else if(isClosed)closed++;else cancelled++;
  if(data.severity==='high')high++;
  if(isSatisfied)satisfied++;
  byState[data.status]=(byState[data.status]||0)+1;
  tally(byCategory,data.category||'other',isOpen,isClosed,isSatisfied);
  tally(byChannel,data.channel||'unknown',isOpen,isClosed,isSatisfied);
  tally(bySeverity,data.severity==='high'?'high':'normal',isOpen,isClosed,isSatisfied);
  tally(byRegion,String(customer.data.region||'').trim()||'غير محدد',isOpen,isClosed,isSatisfied);
  bump(perCustomer,data.customerId);
  if(data.returnedAt)flow.returned++;
  if(data.rejectedAt)flow.sentBack++;
  if(data.reassignedAt)flow.reassigned++;
  if(data.reopenedAt)flow.reopened++;
  if(data.resolution)bump(resolutions,data.resolution.outcome);
  if(isClosed&&data.closure)bump(closures,data.closure.outcome);
  // The review of the submission that was forwarded; the assignment from that forward; the holder's first contact from the
  // dispatch they had received; the resolution standing now from the dispatch before it; the closure from that resolution.
  if(data.forwardedAt&&data.submittedAt)review.push(workingHoursBetween(data.submittedAt,data.forwardedAt));
  if(data.forwardedAt&&data.assignedAt)assignment.push(workingHoursBetween(data.forwardedAt,data.assignedAt));
  const first=[...(data.updates||[])].sort((a,b)=>a.at.localeCompare(b.at))[0],firstDispatch=first?dispatchBefore(data,first.at):'';
  if(first&&firstDispatch)firstContact.push(workingHoursBetween(firstDispatch,first.at));
  const resolvedDispatch=data.resolution?dispatchBefore(data,data.resolution.at):'';
  if(data.resolution&&resolvedDispatch)resolution.push(workingHoursBetween(resolvedDispatch,data.resolution.at));
  if(isClosed&&data.closure&&data.resolution){closure.push(workingHoursBetween(data.resolution.at,data.closure.at));life.push(workingHoursBetween(row.createdAt,data.closure.at));}
  if(isOpen){const assignee=c.members.find(member=>member.id===data.assigneeId);if(complaintProgress(data,assignee?.role||'',now).late)openOver++;}
 }
 return {
  month,months,generatedAt:now,
  total,open,closed,cancelled,high,satisfied,satisfactionRate:reportRate(satisfied,closed),openOverTarget:openOver,
  repeatCustomers:[...perCustomer.values()].filter(count=>count>1).length,
  flow,byState,byCategory:rows(byCategory),byChannel:rows(byChannel),bySeverity:rows(bySeverity),byRegion:rows(byRegion),
  resolutionOutcomes:counts(resolutions),closureOutcomes:counts(closures),
  timing:{review:reportTiming(review,COMPLAINT_TARGET_HOURS.review),assignment:reportTiming(assignment,COMPLAINT_TARGET_HOURS.assignment),firstContact:reportTiming(firstContact,COMPLAINT_TARGET_HOURS.first_contact),resolution:reportTiming(resolution,COMPLAINT_TARGET_HOURS.resolution),closure:reportTiming(closure,COMPLAINT_TARGET_HOURS.closure),registrationToClosure:reportTiming(life,null)},
  targets:COMPLAINT_TARGET_HOURS
 };
}
