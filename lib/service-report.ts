import {canReadService,serviceContacts,serviceState,type ServiceCase,type ServiceContext} from './customer-service';
import {caseProgress,SERVICE_TARGET_HOURS} from './service-queue';
import {workingHoursBetween} from './working-hours';
import {riyadhDate} from './visits';

/** Monthly view of customer-service requests for the people who run the service: how many came by each channel, how
 * quickly each stage moved in working hours, how many ended in a sale. It is aggregate only (no customer, no text) and
 * feeds no target, evaluation or movement calculation. */
export type ReportTiming={n:number;median:number|null;average:number|null;target:number|null;overTarget:number};
export type ReportSource={source:string;total:number;won:number;lost:number;open:number;winRate:number|null};
export type ServiceReport={
 month:string;months:string[];generatedAt:string;
 total:number;open:number;won:number;lost:number;winRate:number|null;
 byState:Record<string,number>;bySource:ReportSource[];
 timing:{approval:ReportTiming;assignment:ReportTiming;firstContact:ReportTiming;totalToFirstContact:ReportTiming};
 openOverTarget:number;lossReasons:{reason:string;count:number}[];
 targets:typeof SERVICE_TARGET_HOURS;
};
/** Administrators, sales managers and customer-service managers; each sees only the cases they may already read. */
export const serviceReportAllowed=(role:string)=>role==='admin'||role==='manager'||role==='customer_service_manager';
export const REPORT_MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const round=(value:number)=>Math.round(value*100)/100;
const rate=(won:number,lost:number)=>won+lost?Math.round(won/(won+lost)*1000)/10:null;
function timing(values:number[],target:number|null):ReportTiming{
 const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);
 return {n:sorted.length,median:sorted.length?round(sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2):null,average:sorted.length?round(sorted.reduce((sum,value)=>sum+value,0)/sorted.length):null,target,overTarget:target===null?0:sorted.filter(value=>value>target).length};
}
export function serviceReport(c:ServiceContext,month:string,now:string=new Date().toISOString()):ServiceReport{
 const readable=c.serviceCases.filter(item=>canReadService(item,c)),monthOf=(item:ServiceCase)=>riyadhDate(item.createdAt).slice(0,7);
 const months=[...new Set(readable.map(monthOf))].sort().reverse().slice(0,24);
 const approval:number[]=[],assignment:number[]=[],firstContact:number[]=[],totalFirst:number[]=[];
 const byState:Record<string,number>={},sources=new Map<string,ReportSource>(),reasons=new Map<string,number>();
 let won=0,lost=0,open=0,openOver=0,total=0;
 for(const item of readable){
  if(monthOf(item)!==month)continue;
  total++;
  const contacts=serviceContacts(item,c.all),state=serviceState(item,c.all,c.members),closed=state==='won'||state==='lost';
  byState[state]=(byState[state]||0)+1;
  const source=String(item.data.source||'unknown'),row=sources.get(source)||{source,total:0,won:0,lost:0,open:0,winRate:null};
  row.total++;
  if(state==='won'){won++;row.won++;}else if(state==='lost'){lost++;row.lost++;const reason=String(contacts[0]?.data.lossReason||'').trim()||'غير محدد';reasons.set(reason,(reasons.get(reason)||0)+1);}else{open++;row.open++;}
  sources.set(source,row);
  const approvedAt=item.data.approvedAt,assignedAt=item.data.assignedAt;
  if(approvedAt)approval.push(workingHoursBetween(item.createdAt,approvedAt));
  if(approvedAt&&assignedAt)assignment.push(workingHoursBetween(approvedAt,assignedAt));
  const first=assignedAt?contacts.filter(contact=>contact.createdAt>=assignedAt).at(-1):undefined;
  if(first&&assignedAt){firstContact.push(workingHoursBetween(assignedAt,first.createdAt));totalFirst.push(workingHoursBetween(item.createdAt,first.createdAt));}
  if(!closed){const assignee=c.members.find(member=>member.id===item.assignedTo),progress=caseProgress(item,state,contacts,assignee?.role||'',now);if(progress.late)openOver++;}
 }
 return {
  month,months,generatedAt:now,total,open,won,lost,winRate:rate(won,lost),byState,
  bySource:[...sources.values()].map(row=>({...row,winRate:rate(row.won,row.lost)})).sort((a,b)=>b.total-a.total||a.source.localeCompare(b.source)),
  timing:{approval:timing(approval,SERVICE_TARGET_HOURS.approval),assignment:timing(assignment,SERVICE_TARGET_HOURS.assignment),firstContact:timing(firstContact,SERVICE_TARGET_HOURS.first_contact),totalToFirstContact:timing(totalFirst,null)},
  openOverTarget:openOver,
  lossReasons:[...reasons.entries()].map(([reason,count])=>({reason,count})).sort((a,b)=>b.count-a.count||a.reason.localeCompare(b.reason)).slice(0,8),
  targets:SERVICE_TARGET_HOURS
 };
}
