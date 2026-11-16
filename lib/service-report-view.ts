// What the two monthly customer-service reports show, defined once (the owner, 2026-11-16, item 3 of the GSCO list): the tiles, the stage
// rows, «نوع التواصل» in words, the titles and notes, read by the screens (app/service-report.tsx, app/complaint-report.tsx) and by the Excel
// file (lib/service-report-export.ts), so the page and the file cannot drift apart. Pure, and free of the workbook writer, so the page
// bundles none of it.
import {UNKNOWN_CONTACT_TYPE,type ServiceReport} from './service-report';
import type {ComplaintReport} from './complaint-report';
import {contactTypes} from './visits';
import type {ReportTiming} from './report-timing';

export const SERVICE_REPORT_KINDS=['requests','complaints'] as const;
export type ServiceReportKind=typeof SERVICE_REPORT_KINDS[number];
export const isServiceReportKind=(value:unknown):value is ServiceReportKind=>typeof value==='string'&&(SERVICE_REPORT_KINDS as readonly string[]).includes(value);
export type ExportLanguage='ar'|'en';
export type Say=(ar:string,en:string)=>string;
export const sayIn=(language:ExportLanguage):Say=>(ar,english)=>language==='en'?english:ar;
export const percent=(value:number|null)=>value===null?'—':value+'%';

// ---- what the screen shows, defined once (the page and the file read the same lists)
export type ReportTile=[label:string,value:string|number];
export type ReportStage=[label:string,timing:ReportTiming];
export const serviceReportTiles=(r:ServiceReport,say:Say):ReportTile[]=>[[say('الطلبات','Requests'),r.total],[say('مفتوحة','Open'),r.open],[say('فاز','Won'),r.won],[say('فُقد','Lost'),r.lost],[say('نسبة الفوز','Win rate'),percent(r.winRate)],[say('مفتوحة وتجاوزت هدفها','Open past target'),r.openOverTarget]];
export const serviceReportStages=(r:ServiceReport,say:Say):ReportStage[]=>[[say('الاعتماد','Approval'),r.timing.approval],[say('التكليف','Assignment'),r.timing.assignment],[say('أول تواصل بعد التكليف','First contact after assignment'),r.timing.firstContact],[say('من التسجيل إلى أول تواصل','Registration to first contact'),r.timing.totalToFirstContact]];
export const complaintReportTiles=(r:ComplaintReport,say:Say):ReportTile[]=>[[say('الشكاوى','Complaints'),r.total],[say('مفتوحة','Open'),r.open],[say('مغلقة','Closed'),r.closed],[say('ملغاة','Cancelled'),r.cancelled],[say('نسبة رضا العميل','Customer satisfaction'),percent(r.satisfactionRate)],[say('مفتوحة وتجاوزت هدفها','Open past target'),r.openOverTarget],[say('أهمية عالية','High severity'),r.high],[say('عملاء بأكثر من شكوى','Customers with more than one'),r.repeatCustomers]];
export const complaintReportFlow=(r:ComplaintReport,say:Say):ReportTile[]=>[[say('أُعيدت للتعديل','Returned for correction'),r.flow.returned],[say('أُعيدت إلى المندوب','Sent back to the representative'),r.flow.sentBack],[say('أُعيد تكليفها','Reassigned'),r.flow.reassigned],[say('أُعيد فتحها','Reopened'),r.flow.reopened]];
export const complaintReportStages=(r:ComplaintReport,say:Say):ReportStage[]=>[[say('المراجعة','Review'),r.timing.review],[say('التكليف','Assignment'),r.timing.assignment],[say('أول تواصل بعد التكليف','First contact after assignment'),r.timing.firstContact],[say('الحل من التكليف','Resolution from assignment'),r.timing.resolution],[say('تأكيد الإغلاق','Closure confirmation'),r.timing.closure],[say('من التسجيل إلى الإغلاق','Registration to closure'),r.timing.registrationToClosure]];
/** «نوع التواصل» of a request in words; a request with none stored is «غير محدد». */
const CONTACT_TYPES_EN:Record<string,string>={visit:'Visit',call:'Phone call',email:'Email',whatsapp:'WhatsApp',website:'Website',social:'Social media',quote:'Quotation',meeting:'Meeting',followup:'Follow-up'};
export const contactTypeText=(type:string,say:Say)=>type===UNKNOWN_CONTACT_TYPE?say('غير محدد','Unspecified'):say(contactTypes[type]||type,CONTACT_TYPES_EN[type]||type);
export const serviceReportTitle=(kind:ServiceReportKind,say:Say)=>kind==='requests'?say('التقرير الشهري لطلبات خدمة العملاء','Monthly customer-service report'):say('التقرير الشهري للشكاوى','Monthly complaints report');
const REQUESTS_NOTE:[string,string]=['ساعات العمل من السبت إلى الخميس، 8 صباحًا إلى 6 مساءً بتوقيت الرياض. الأرقام للمتابعة فقط ولا تدخل في تقييم أداء المناديب ولا في المستهدفات.','Working hours are Saturday to Thursday, 08:00 to 18:00 Riyadh time. The figures are for follow-up only and feed neither representatives\' evaluation nor targets.'];
const COMPLAINTS_NOTE:[string,string]=['ساعات العمل من السبت إلى الخميس، 8 صباحًا إلى 6 مساءً بتوقيت الرياض. نسبة الرضا هي الشكاوى المغلقة بنتيجة «العميل راضٍ» من كل المغلقة. الأرقام للمتابعة فقط ولا تدخل في تقييم أحد ولا في المستهدفات.','Working hours are Saturday to Thursday, 08:00 to 18:00 Riyadh time. Satisfaction is the share of closed complaints closed as "customer satisfied". The figures are for follow-up only and feed nobody\'s evaluation and no target.'];
export const serviceReportNote=(kind:ServiceReportKind,say:Say)=>say(...(kind==='requests'?REQUESTS_NOTE:COMPLAINTS_NOTE));
export const serviceReportFileName=(kind:ServiceReportKind,month:string)=>'Yourrest-service-report-'+kind+'-'+month+'.xlsx';
