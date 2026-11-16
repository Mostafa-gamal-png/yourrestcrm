import {context,CRMError,replyError,requirePages} from '@/lib/crm-server';
import {can,cellRefusalText} from '@/lib/permissions';
import {performanceView,performanceWorkbook,requestedMonth} from '@/lib/service-sales-server';
import {performanceAllowed} from '@/lib/service-sales';
export const dynamic='force-dynamic';
const noStore={'Cache-Control':'private, no-store'};
/** «تصدير Excel» of «أداء خدمة العملاء» (the owner, 2026-11-16, item 5 of the GSCO list): GET ?month=YYYY-MM&lang=ar|en gives the .xlsx of
 *  three sheets («الملخص»، «الفواتير»، «الفرص») with what the reader sees on the screen. No session 401; a role it is not for 403; «الزيارات»
 *  hidden 404; «تقارير خدمة العملاء · تصدير» switched off (or not the role's) 403; a month that is not one 400. Never cached. */
export async function GET(req:Request){try{
 const c=await context({load:'identity'});
 if(!performanceAllowed(c.me.role))throw new CRMError('أداء خدمة العملاء متاح لمدير النظام ومدير المبيعات ومدير خدمة العملاء وممثل خدمة العملاء لنفسه.',403);
 requirePages(c.me,'activity');
 // «تقارير خدمة العملاء · تصدير»: the role's (the administrator, the sales manager, the customer-service manager) unless switched off for the member.
 if(!can(c.me,'service-reports','export'))throw new CRMError(cellRefusalText('service-reports','export'),403);
 const url=new URL(req.url),now=new Date().toISOString(),month=requestedMonth(url,now),language=url.searchParams.get('lang')==='en'?'en':'ar';
 const file=performanceWorkbook(await performanceView(c,month,now),language);
 return new Response(file.bytes,{headers:{...noStore,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="'+file.fileName+'"','X-Content-Type-Options':'nosniff'}});
}catch(e){const response=replyError(e);response.headers.set('cache-control','private, no-store');return response;}}
