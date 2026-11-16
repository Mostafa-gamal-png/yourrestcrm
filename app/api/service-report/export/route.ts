import {z} from 'zod';
import {context,CRMError,replyError,requireCell,requirePages} from '@/lib/crm-server';
import {canViewPage} from '@/lib/access';
import {riyadhDate} from '@/lib/visits';
import {REPORT_MONTH} from '@/lib/report-timing';
import {serviceReportAllowed} from '@/lib/service-report';
import {complaintReportAllowed} from '@/lib/complaint-report';
import {loadAllComplaints} from '@/lib/complaint-rows';
import {complaintsReportWorkbook,isServiceReportKind,requestsReportWorkbook} from '@/lib/service-report-export';
export const dynamic='force-dynamic';
const noStore={'Cache-Control':'private, no-store'};
const monthSchema=z.string().regex(REPORT_MONTH,'اختر شهرًا صحيحًا');
function errorResponse(error:unknown){const response=error instanceof z.ZodError?Response.json({error:error.issues.map(issue=>issue.message).join(' • ')},{status:400}):replyError(error);response.headers.set('cache-control','private, no-store');return response;}
/** «تصدير Excel» of a monthly customer-service report (the owner, 2026-11-16, item 3 of the GSCO list; lib/service-report-export.ts).
 *  GET ?kind=requests|complaints&month=YYYY-MM&lang=ar|en gives the .xlsx of three sheets. In order: no session 401; an unknown kind 400;
 *  a role the report is not for 403 (the report's own words); the screen that shows the report hidden from the member 404 (as any hidden
 *  screen's request); «تقارير خدمة العملاء · تصدير» switched off 403; a month that is not one 400. The file holds only what the reader may
 *  already read, as the report on the screen. Never cached. */
export async function GET(request:Request){try{
 const params=new URL(request.url).searchParams;
 const probe=await context({load:'identity'}),me=probe.me,kind=params.get('kind');
 if(!isServiceReportKind(kind))throw new CRMError('اختر التقرير المطلوب تصديره.',400);
 if(kind==='requests'&&!serviceReportAllowed(me.role))throw new CRMError('التقرير متاح لمدير النظام ومدير المبيعات ومدير خدمة العملاء فقط',403);
 if(kind==='complaints'&&!complaintReportAllowed(me.role))throw new CRMError('تقرير الشكاوى متاح لمدير النظام ومدير المبيعات ومدير خدمة العملاء فقط',403);
 // The requests report is on «الزيارات»; the complaints report on «الشكاوى» for the roles that have that page, else on «الزيارات».
 requirePages(me,kind==='requests'||!canViewPage(me.role,'complaints')?'activity':'complaints');
 requireCell(me,'service-reports','export');
 const now=new Date().toISOString(),month=monthSchema.parse(params.get('month')||riyadhDate(now).slice(0,7)),language=params.get('lang')==='en'?'en':'ar';
 let file:{fileName:string;bytes:Uint8Array<ArrayBuffer>};
 if(kind==='requests')file=requestsReportWorkbook(await context({load:'directory'}),month,now,language);
 else{
  // As the complaints report route: customer service reads its branch's customers from the full context, a sales manager the directory.
  const c=me.role==='manager'?await context({load:'directory'}):await context();
  file=complaintsReportWorkbook({me:c.me,members:c.members,all:c.all,complaints:await loadAllComplaints(c.db)},month,now,language);
 }
 return new Response(file.bytes,{headers:{...noStore,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="'+file.fileName+'"','X-Content-Type-Options':'nosniff'}});
}catch(error){return errorResponse(error);}}
