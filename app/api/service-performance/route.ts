import {context,CRMError,replyError,requirePages} from '@/lib/crm-server';
import {performanceView,requestedMonth} from '@/lib/service-sales-server';
import {performanceAllowed} from '@/lib/service-sales';
import {can} from '@/lib/permissions';
export const dynamic='force-dynamic';
/** «أداء خدمة العملاء» (the owner, 2026-11-16, item 5 of the GSCO list): GET ?month=YYYY-MM, a row per customer-service member the reader
 *  may see (lib/service-sales-server.ts performanceTeams) with no target. No session 401; a role it is not for 403 (a supervisor, a
 *  representative); «الزيارات» hidden 404; a month that is not one 400. Never cached. */
export async function GET(req:Request){try{
 const probe=await context({load:'identity'});
 if(!performanceAllowed(probe.me.role))throw new CRMError('أداء خدمة العملاء متاح لمدير النظام ومدير المبيعات ومدير خدمة العملاء وممثل خدمة العملاء لنفسه.',403);
 requirePages(probe.me,'activity');
 const now=new Date().toISOString(),month=requestedMonth(new URL(req.url),now);
 return Response.json({...await performanceView(probe,month,now),canExport:can(probe.me,'service-reports','export')},{headers:{'Cache-Control':'no-store'}});
}catch(e){return replyError(e);}}
