// «تصدير Excel» of the customer-service monthly reports (the owner, 2026-11-16, item 3 of the GSCO list, after GSCO 2.13.77 commit
// 128c54f: «زرار «تصدير Excel» في كل تبويب من «تقارير خدمة العملاء»: الملف فيه 3 أوراق: «الملخص»، و«زمن المراحل»، و«التفاصيل» (سطر لكل طلب
// أو شكوى). كل مستخدم يصدّر اللي مسموحله يقراه بس.»). Yourrest has two monthly reports, not GSCO's three tabs: the requests report
// (app/service-report.tsx, on «الزيارات») and the complaints report (app/complaint-report.tsx, on «الشكاوى», or «الزيارات» for the sales
// manager); Yourrest has no monthly report of support requests, so there is nothing of that tab to export.
// The workbook has the figures the screen shows («الملخص», «زمن المراحل»), worked out by the very report function of the screen over the
// same records, and «التفاصيل»: one row per request or complaint of the month the reader may already read (canReadService /
// canReadComplaint, the report's own scope). The screen's tiles and stage rows are defined once (lib/service-report-view.ts), so the page and the file cannot
// drift. Pure: no database, no request; the route (app/api/service-report/export) loads the records and checks who may ask.
import {xlsxBook,type BookCell,type BookSheet} from './xlsx-write';
import {canReadService,serviceContacts,serviceLossReason,serviceState,serviceStatusLabels,serviceStatusLabelsEn,type ServiceContext} from './customer-service';
import {caseProgress,SERVICE_TARGET_HOURS} from './service-queue';
import {serviceContactType,serviceMonthOf,serviceReport,type ServiceReport} from './service-report';
import {complaintReportFlow,complaintReportStages,complaintReportTiles,contactTypeText,percent,sayIn,serviceReportFileName,serviceReportNote,serviceReportStages,serviceReportTiles,serviceReportTitle,type ExportLanguage,type Say,type ServiceReportKind} from './service-report-view';
export {SERVICE_REPORT_KINDS,isServiceReportKind,serviceReportFileName,type ExportLanguage,type ServiceReportKind} from './service-report-view';
import {complaintDispatchBefore,complaintMonthOf,complaintReport,type ComplaintReport} from './complaint-report';
import {COMPLAINT_TARGET_HOURS,canReadComplaint,closureOutcomes,closureOutcomesEn,complaintCategories,complaintCategoriesEn,complaintChannels,complaintChannelsEn,complaintOwner,complaintProgress,complaintReader,complaintSeverities,complaintSeveritiesEn,complaintStatusLabels,complaintStatusLabelsEn,dispatchedAt,resolutionOutcomes,resolutionOutcomesEn,type ComplaintContext} from './complaints';
import {workingHoursBetween} from './working-hours';

// ---- the details sheet
const stampFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
/** «YYYY-MM-DD HH:mm» in Riyadh time; empty for no moment. */
export function riyadhStamp(iso:string|undefined|null){
 if(!iso||!Number.isFinite(Date.parse(iso)))return '';
 const parts=Object.fromEntries(stampFormat.formatToParts(new Date(iso)).map(part=>[part.type,part.value]));
 return `${parts.year}-${parts.month}-${parts.day} ${parts.hour==='24'?'00':parts.hour}:${parts.minute}`;
}
/** Whether a stage took longer than its target in working hours: from its start to its end, or to now while the record still waits at it
 *  (`current`). Empty when the stage was never reached. */
export function lateMark(from:string|undefined,to:string|undefined,target:number,now:string,current:boolean,say:Say){
 if(!from)return '';
 const end=to||(current?now:'');
 if(!end)return '';
 return workingHoursBetween(from,end)>target?say('نعم','Yes'):say('لا','No');
}
const yesNo=(late:boolean,say:Say)=>late?say('نعم','Yes'):say('لا','No');
/** Words of the application with an English form (the product list of a request and the regions, as lib/locales/en.json has them); what
 *  people typed (names, cities, reasons) stays as typed. */
const ENGLISH:Record<string,string>={'قوالب البلوك المتحركة':'Molds for mobile block machines','قوالب البلوك الثابتة':'Molds for stationary block machines','لمامة البلوك':'Block stacker','ماكينة إنتاج البلوكة المتحركة':'Mobile block-making machine','قطع غيار المكائن المتحركة':'Mobile machine spare parts','خلاطات البلوك':'Block mixers','خلاطات الخرسانة الجاهزة':'Ready-mix concrete mixers','خدمات صيانة':'Maintenance services',
 'الوسطى':'Central','الشرقية':'Eastern','الغربية':'Western','الشمالية':'Northern','الجنوبية':'Southern','المنطقة غير محددة':'Region not specified','غير محدد':'Unspecified'};
const english=(text:string,say:Say)=>say(text,ENGLISH[text]||text);
export type DetailTable={header:string[];rows:BookCell[][]};
const nameOf=(members:{id:string;name:string}[])=>(id:string|null|undefined)=>id?members.find(member=>member.id===id)?.name||'':'';

/** One row per customer-service request registered in the month that the reader may read, oldest first. */
export function serviceRequestDetails(c:ServiceContext,month:string,now:string,say:Say):DetailTable{
 const name=nameOf(c.members),T=SERVICE_TARGET_HOURS,customers=new Map(c.all.filter(row=>row.kind==='customer').map(row=>[row.id,row]));
 const header=[say('رقم الطلب','Request number'),say('العميل','Customer'),say('المدينة','City'),say('المنطقة','Region'),say('نوع التواصل','Contact type'),say('الأصناف','Products'),say('سجّله','Registered by'),say('المسؤول الحالي','Current holder'),say('الحالة','State'),
  say('التسجيل','Registered'),say('الاعتماد','Approval'),say('متأخر: الاعتماد','Late: approval'),say('التكليف','Assignment'),say('متأخر: التكليف','Late: assignment'),say('التفويض','Delegation'),say('متأخر: التفويض','Late: delegation'),
  say('أول تواصل بعد التكليف','First contact after assignment'),say('متأخر: أول تواصل','Late: first contact'),say('النتيجة','Outcome'),say('سبب الفقد','Loss reason')];
 const rows=c.serviceCases.filter(item=>canReadService(item,c)&&serviceMonthOf(item)===month).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)).map(item=>{
  const customer=customers.get(item.customerId),contacts=serviceContacts(item,c.all),state=serviceState(item,c.all,c.members),assignee=c.members.find(member=>member.id===item.assignedTo);
  const progress=caseProgress(item,state,contacts,assignee?.role||'',now),stage=progress.stage,data=item.data;
  const approvedAt=data.approvedAt||'',assignedAt=data.assignedAt||'',delegatedAt=data.delegatedAt||'';
  // The report's own measure of the first contact: the earliest contact recorded at or after the assignment.
  const first=assignedAt?contacts.filter(contact=>contact.createdAt>=assignedAt).at(-1)?.createdAt||'':'';
  const holder=stage==='approval'?item.serviceManagerId:stage==='returned'?item.creatorId:stage==='assignment'?item.salesManagerId:stage==='closed'?'':item.assignedTo;
  // The delegation began when the case reached the supervisor: the last assignment or reassignment before it was delegated.
  const reachedSupervisor=[assignedAt,data.reassignedAt||''].filter(stamp=>!!stamp&&(!delegatedAt||stamp<=delegatedAt)).sort().at(-1)||'';
  const visitNumber=data.registration?.visitNumber,number=typeof visitNumber==='number'?visitNumber:'';
  const lossReason=state==='lost'?serviceLossReason(item,c.all)||say('غير محدد','Unspecified'):'';
  return [number,String(customer?.data.name||''),String(customer?.data.city||'').trim(),english(String(customer?.data.region||'').trim(),say),contactTypeText(serviceContactType(item),say),(data.products||[]).map(product=>english(product,say)).join(say('، ',', ')),name(item.creatorId),name(holder),say(serviceStatusLabels[state]||state,serviceStatusLabelsEn[state]||state),
   riyadhStamp(item.createdAt),
   riyadhStamp(approvedAt),approvedAt?lateMark(item.createdAt,approvedAt,T.approval,now,false,say):stage==='approval'?yesNo(progress.late,say):'',
   riyadhStamp(assignedAt),assignedAt&&approvedAt?lateMark(approvedAt,assignedAt,T.assignment,now,false,say):stage==='assignment'?yesNo(progress.late,say):'',
   riyadhStamp(delegatedAt),delegatedAt?lateMark(reachedSupervisor,delegatedAt,T.delegation,now,false,say):stage==='delegation'?yesNo(progress.late,say):'',
   riyadhStamp(first),first?lateMark(assignedAt,first,T.first_contact,now,false,say):stage==='first_contact'?yesNo(progress.late,say):'',
   state==='won'?say('فاز','Won'):state==='lost'?say('فُقد','Lost'):say('مفتوحة','Open'),lossReason];
 });
 return {header,rows};
}

/** One row per complaint registered in the month that the reader may read, by its number (oldest first for those without one). */
export function complaintDetails(c:ComplaintContext,month:string,now:string,say:Say):DetailTable{
 const reader=complaintReader(c),name=nameOf(c.members),T=COMPLAINT_TARGET_HOURS,customers=new Map(c.all.filter(row=>row.kind==='customer').map(row=>[row.id,row]));
 const header=[say('رقم الشكوى','Complaint number'),say('العميل','Customer'),say('المدينة','City'),say('المنطقة','Region'),say('التصنيف','Category'),say('وسيلة الوصول','Channel'),say('الأهمية','Severity'),say('سجّلها','Registered by'),say('المسؤول الحالي','Current holder'),say('الحالة','State'),
  say('التسجيل','Registered'),say('المراجعة','Review'),say('متأخر: المراجعة','Late: review'),say('التكليف','Assignment'),say('متأخر: التكليف','Late: assignment'),say('أول تواصل','First contact'),say('متأخر: أول تواصل','Late: first contact'),
  say('الحل','Resolution'),say('متأخر: الحل','Late: resolution'),say('تأكيد الإغلاق','Closure confirmation'),say('متأخر: تأكيد الإغلاق','Late: closure confirmation'),say('نتيجة الحل','Resolution outcome'),say('نتيجة الإغلاق','Closure outcome'),say('تقييم العميل من 5','Customer rating out of 5')];
 const order=(row:{data:{complaintNumber?:number};createdAt:string;id:string})=>[typeof row.data.complaintNumber==='number'?row.data.complaintNumber:0,row.createdAt,row.id] as const;
 const rows=c.complaints.filter(row=>{const customer=customers.get(row.data.customerId);return !!customer&&canReadComplaint(row,customer,reader,c.members)&&complaintMonthOf(row)===month;})
  .sort((a,b)=>{const x=order(a),y=order(b);return x[0]-y[0]||x[1].localeCompare(y[1])||x[2].localeCompare(y[2]);}).map(row=>{
  const data=row.data,customer=customers.get(data.customerId),assignee=c.members.find(member=>member.id===data.assigneeId),progress=complaintProgress(data,assignee?.role||'',now),stage=progress.stage;
  const first=[...(data.updates||[])].sort((a,b)=>a.at.localeCompare(b.at))[0]?.at||'',resolved=data.resolution?.at||'',closed=data.status==='closed'?data.closure?.at||data.closedAt||'':'';
  const holding=data.status==='assigned',severity=data.severity==='high'?'high':'normal';
  return [typeof data.complaintNumber==='number'&&data.complaintNumber>0?data.complaintNumber:'',String(customer?.data.name||''),String(customer?.data.city||'').trim(),english(String(customer?.data.region||'').trim(),say),
   say(complaintCategories[data.category]||data.category||'',complaintCategoriesEn[data.category]||data.category||''),say(complaintChannels[data.channel]||data.channel||'',complaintChannelsEn[data.channel]||data.channel||''),say(complaintSeverities[severity],complaintSeveritiesEn[severity]),
   name(data.registrarId),name(complaintOwner(data,stage)),say(complaintStatusLabels[data.status]||data.status,complaintStatusLabelsEn[data.status]||data.status),
   riyadhStamp(row.createdAt),
   riyadhStamp(data.forwardedAt),lateMark(data.submittedAt,data.forwardedAt,T.review,now,data.status==='submitted',say),
   riyadhStamp(data.assignedAt),lateMark(data.forwardedAt,data.assignedAt,T.assignment,now,data.status==='pending_assignment',say),
   riyadhStamp(first),first?lateMark(complaintDispatchBefore(data,first),first,T.first_contact,now,false,say):holding&&(stage==='first_contact'||stage==='delegation')?lateMark(dispatchedAt(data),'',T.first_contact,now,true,say):'',
   riyadhStamp(resolved),resolved?lateMark(complaintDispatchBefore(data,resolved),resolved,T.resolution,now,false,say):holding?lateMark(dispatchedAt(data),'',T.resolution,now,true,say):'',
   riyadhStamp(closed),closed&&resolved?lateMark(resolved,closed,T.closure,now,false,say):data.status==='resolved'?lateMark(data.resolvedAt||resolved,'',T.closure,now,true,say):'',
   data.resolution?say(resolutionOutcomes[data.resolution.outcome]||data.resolution.outcome,resolutionOutcomesEn[data.resolution.outcome]||data.resolution.outcome):'',
   data.status==='closed'&&data.closure?say(closureOutcomes[data.closure.outcome]||data.closure.outcome,closureOutcomesEn[data.closure.outcome]||data.closure.outcome):'',
   data.status==='closed'&&typeof data.closure?.rating==='number'?data.closure.rating:''];
 });
 return {header,rows};
}

// ---- the workbook
type Table={title:string;header:string[];rows:BookCell[][]};
function breakdowns(kind:ServiceReportKind,report:ServiceReport|ComplaintReport,say:Say):Table[]{
 if(kind==='requests'){
  const r=report as ServiceReport;
  return [
   {title:say('بحسب نوع التواصل','By contact type'),header:[say('نوع التواصل','Contact type'),say('الطلبات','Requests'),say('فاز','Won'),say('فُقد','Lost'),say('مفتوح','Open'),say('نسبة الفوز','Win rate')],rows:r.byContactType.map(row=>[contactTypeText(row.type,say),row.total,row.won,row.lost,row.open,percent(row.winRate)])},
   {title:say('الحالة الحالية','Current state'),header:[say('الحالة','State'),say('العدد','Count')],rows:Object.entries(r.byState).map(([state,count])=>[say(serviceStatusLabels[state]||state,serviceStatusLabelsEn[state]||state),count])},
   {title:say('أسباب الفقد','Loss reasons'),header:[say('السبب','Reason'),say('العدد','Count')],rows:r.lossReasons.map(row=>[row.reason==='غير محدد'?say('غير محدد','Unspecified'):row.reason,row.count])}
  ];
 }
 const r=report as ComplaintReport,group=(title:string,heading:string,list:ComplaintReport['byCategory'],label:(key:string)=>string):Table=>({title,header:[heading,say('الشكاوى','Complaints'),say('مفتوحة','Open'),say('مغلقة','Closed'),say('العميل راضٍ','Satisfied'),say('نسبة الرضا','Satisfaction')],rows:list.map(row=>[label(row.key),row.total,row.open,row.closed,row.satisfied,percent(row.satisfactionRate)])});
 return [
  group(say('بحسب التصنيف','By category'),say('التصنيف','Category'),r.byCategory,key=>say(complaintCategories[key]||key,complaintCategoriesEn[key]||key)),
  group(say('بحسب وسيلة الوصول','By channel'),say('الوسيلة','Channel'),r.byChannel,key=>say(complaintChannels[key]||key,complaintChannelsEn[key]||key)),
  group(say('بحسب المنطقة','By region'),say('المنطقة','Region'),r.byRegion,key=>english(key,say)),
  group(say('بحسب الأهمية','By severity'),say('الأهمية','Severity'),r.bySeverity,key=>say(complaintSeverities[key]||key,complaintSeveritiesEn[key]||key)),
  {title:say('الحالة الحالية','Current state'),header:[say('الحالة','State'),say('العدد','Count')],rows:Object.entries(r.byState).map(([state,count])=>[say(complaintStatusLabels[state]||state,complaintStatusLabelsEn[state]||state),count])},
  {title:say('ما عاد خطوة إلى الوراء','What went a step back'),header:[say('البند','Item'),say('العدد','Count')],rows:complaintReportFlow(r,say)},
  {title:say('نتائج الحل','Resolution outcomes'),header:[say('النتيجة','Outcome'),say('العدد','Count')],rows:r.resolutionOutcomes.map(row=>[say(resolutionOutcomes[row.key]||row.key,resolutionOutcomesEn[row.key]||row.key),row.count])},
  {title:say('نتائج الإغلاق','Closure outcomes'),header:[say('النتيجة','Outcome'),say('العدد','Count')],rows:r.closureOutcomes.map(row=>[say(closureOutcomes[row.key]||row.key,closureOutcomesEn[row.key]||row.key),row.count])}
 ];
}
/** The three sheets: «الملخص» (the tiles, then each breakdown of the screen, then the screen's note), «زمن المراحل» (the stage table) and
 *  «التفاصيل» (one row per record). */
export function serviceReportSheets(kind:ServiceReportKind,report:ServiceReport|ComplaintReport,details:DetailTable,language:ExportLanguage):BookSheet[]{
 const say=sayIn(language),rightToLeft=language!=='en';
 const tiles=kind==='requests'?serviceReportTiles(report as ServiceReport,say):complaintReportTiles(report as ComplaintReport,say);
 const summary:BookCell[][]=[[say('البند','Item'),say('القيمة','Value')],[serviceReportTitle(kind,say),report.month],...tiles],bold=[0],notes:number[]=[];
 for(const table of breakdowns(kind,report,say)){
  if(!table.rows.length)continue;
  summary.push([]);bold.push(summary.length,summary.length+1);summary.push([table.title],table.header,...table.rows);
 }
 summary.push([]);notes.push(summary.length);summary.push([serviceReportNote(kind,say)]);
 const stages=kind==='requests'?serviceReportStages(report as ServiceReport,say):complaintReportStages(report as ComplaintReport,say);
 const timing:BookCell[][]=[[say('المرحلة','Stage'),kind==='requests'?say('الطلبات','Requests'):say('الشكاوى','Complaints'),say('الوسيط (ساعات عمل)','Median (working hours)'),say('المتوسط (ساعات عمل)','Average (working hours)'),say('الهدف (ساعات عمل)','Target (working hours)'),say('تجاوزت الهدف','Over target')],
  ...stages.map(([label,value])=>[label,value.n,value.median??'—',value.average??'—',value.target??'—',value.target===null?'—':value.overTarget])];
 const widths=(header:string[])=>header.map(text=>Math.max(12,Math.min(40,text.length+4)));
 return [
  {name:say('الملخص','Summary'),rows:summary,widths:[46,16,12,12,14,14],rightToLeft,headerRows:bold,noteRows:notes},
  {name:say('زمن المراحل','Stage times'),rows:timing,widths:[34,12,22,22,22,14],rightToLeft,headerRows:[0]},
  {name:say('التفاصيل','Details'),rows:[details.header,...details.rows],widths:widths(details.header),rightToLeft,headerRows:[0]}
 ];
}

/** The whole file of one report for one month, as the reader may read it. */
export function requestsReportWorkbook(c:ServiceContext,month:string,now:string,language:ExportLanguage){
 const say=sayIn(language),report=serviceReport(c,month,now);
 return {fileName:serviceReportFileName('requests',month),bytes:xlsxBook(serviceReportSheets('requests',report,serviceRequestDetails(c,month,now,say),language)),rows:report.total};
}
export function complaintsReportWorkbook(c:ComplaintContext,month:string,now:string,language:ExportLanguage){
 const say=sayIn(language),report=complaintReport(c,month,now);
 return {fileName:serviceReportFileName('complaints',month),bytes:xlsxBook(serviceReportSheets('complaints',report,complaintDetails(c,month,now,say),language)),rows:report.total};
}
