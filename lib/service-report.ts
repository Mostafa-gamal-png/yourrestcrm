import {canReadService,serviceContacts,serviceLossReason,serviceState,type ServiceCase,type ServiceContext} from './customer-service';
import {lossReasonGroup} from './loss-reason-other';
import {caseProgress,SERVICE_TARGET_HOURS} from './service-queue';
import {workingHoursBetween} from './working-hours';
import {riyadhDate} from './visits';
import {REPORT_MONTH,reportRate,reportTiming,type ReportTiming} from './report-timing';

/** Monthly view of customer-service requests for the people who run the service: how many came by each contact type, how
 * quickly each stage moved in working hours, how many ended in a sale. It is aggregate only (no customer, no text) and
 * feeds no target, evaluation or movement calculation.
 * 2026-11-16 (GSCO list item 3, GSCO 2.13.77): the breakdown is «بحسب نوع التواصل», the «نوع التواصل» customer service picks when it
 * registers the opportunity (stored on the case as `data.source`, and on its registration as `type`). A request saved before either was
 * kept still counts, under the type its registration carries, and one with none under «غير محدد» (UNKNOWN_CONTACT_TYPE). */
export {REPORT_MONTH,type ReportTiming};
export type ReportContactType={type:string;total:number;won:number;lost:number;open:number;winRate:number|null};
/** The key of a request with no stored contact type; the page and the export call it «غير محدد». */
export const UNKNOWN_CONTACT_TYPE='unknown';
/** The contact type of a request as it was registered: the case's own, else its registration's (older rows), else UNKNOWN_CONTACT_TYPE. */
export function serviceContactType(item:Pick<ServiceCase,'data'>){
 const stored=String(item.data.source||'').trim()||String(item.data.registration?.type||'').trim();
 return stored||UNKNOWN_CONTACT_TYPE;
}
/** The month (Riyadh) a request was registered in: the month the report files it under. */
export const serviceMonthOf=(item:Pick<ServiceCase,'createdAt'>)=>riyadhDate(item.createdAt).slice(0,7);
export type ServiceReport={
 month:string;months:string[];generatedAt:string;
 total:number;open:number;won:number;lost:number;winRate:number|null;
 byState:Record<string,number>;byContactType:ReportContactType[];
 timing:{approval:ReportTiming;assignment:ReportTiming;firstContact:ReportTiming;totalToFirstContact:ReportTiming};
 openOverTarget:number;lossReasons:{reason:string;count:number}[];
 targets:typeof SERVICE_TARGET_HOURS;
};
/** Administrators, sales managers and customer-service managers; each sees only the cases they may already read. */
export const serviceReportAllowed=(role:string)=>role==='admin'||role==='manager'||role==='customer_service_manager';
const rate=(won:number,lost:number)=>reportRate(won,won+lost);
const timing=reportTiming;
export function serviceReport(c:ServiceContext,month:string,now:string=new Date().toISOString()):ServiceReport{
 const readable=c.serviceCases.filter(item=>canReadService(item,c)),monthOf=serviceMonthOf;
 const months=[...new Set(readable.map(monthOf))].sort().reverse().slice(0,24);
 const approval:number[]=[],assignment:number[]=[],firstContact:number[]=[],totalFirst:number[]=[];
 const byState:Record<string,number>={},types=new Map<string,ReportContactType>(),reasons=new Map<string,number>();
 let won=0,lost=0,open=0,openOver=0,total=0;
 for(const item of readable){
  if(monthOf(item)!==month)continue;
  total++;
  const contacts=serviceContacts(item,c.all),state=serviceState(item,c.all,c.members),closed=state==='won'||state==='lost';
  byState[state]=(byState[state]||0)+1;
  const type=serviceContactType(item),row=types.get(type)||{type,total:0,won:0,lost:0,open:0,winRate:null};
  row.total++;
  if(state==='won'){won++;row.won++;}else if(state==='lost'){lost++;row.lost++;const reason=lossReasonGroup(serviceLossReason(item,c.all))||'غير محدد';reasons.set(reason,(reasons.get(reason)||0)+1);}else{open++;row.open++;}
  types.set(type,row);
  const approvedAt=item.data.approvedAt,assignedAt=item.data.assignedAt;
  if(approvedAt)approval.push(workingHoursBetween(item.createdAt,approvedAt));
  if(approvedAt&&assignedAt)assignment.push(workingHoursBetween(approvedAt,assignedAt));
  const first=assignedAt?contacts.filter(contact=>contact.createdAt>=assignedAt).at(-1):undefined;
  if(first&&assignedAt){firstContact.push(workingHoursBetween(assignedAt,first.createdAt));totalFirst.push(workingHoursBetween(item.createdAt,first.createdAt));}
  if(!closed){const assignee=c.members.find(member=>member.id===item.assignedTo),progress=caseProgress(item,state,contacts,assignee?.role||'',now);if(progress.late)openOver++;}
 }
 return {
  month,months,generatedAt:now,total,open,won,lost,winRate:rate(won,lost),byState,
  byContactType:[...types.values()].map(row=>({...row,winRate:rate(row.won,row.lost)})).sort((a,b)=>b.total-a.total||a.type.localeCompare(b.type)),
  timing:{approval:timing(approval,SERVICE_TARGET_HOURS.approval),assignment:timing(assignment,SERVICE_TARGET_HOURS.assignment),firstContact:timing(firstContact,SERVICE_TARGET_HOURS.first_contact),totalToFirstContact:timing(totalFirst,null)},
  openOverTarget:openOver,
  lossReasons:[...reasons.entries()].map(([reason,count])=>({reason,count})).sort((a,b)=>b.count-a.count||a.reason.localeCompare(b.reason)).slice(0,8),
  targets:SERVICE_TARGET_HOURS
 };
}
