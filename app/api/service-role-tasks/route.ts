import {z} from 'zod';
import {context,checkOrigin,readJsonBody,replyError,requirePages,requireSession,CRMError} from '@/lib/crm-server';
import {recordRoleTask,roleTasksView} from '@/lib/service-sales-server';
import {leadReader} from '@/lib/service-sales';
export const dynamic='force-dynamic';
const errorResponse=(e:unknown)=>e instanceof z.ZodError?Response.json({error:e.issues.map(i=>i.message).join(' • ')},{status:400}):replyError(e);
/** «تسجيل دور خدمة العملاء» (the owner, 2026-11-16, item 5 of the GSCO list): when an opportunity customer service took part in is won or
 *  lost, a task comes back to the customer-service member to write their role (lib/service-sales-server.ts). GET: the tasks the reader
 *  follows (a member their own, a customer-service manager their team's, the administrator everyone's). POST {caseId,roles,note,requestId}:
 *  the member records it once. No session 401; a sales role 403; «الزيارات» hidden 404. Never cached. */
export async function GET(){try{
 const probe=await context({load:'identity'});
 if(!leadReader(probe.me.role))throw new CRMError('تسجيل دور خدمة العملاء متاح لخدمة العملاء ومدير النظام.',403);
 requirePages(probe.me,'activity');
 return Response.json(await roleTasksView(await context({load:'identity'}),new Date().toISOString()),{headers:{'Cache-Control':'no-store'}});
}catch(e){return errorResponse(e);}}
export async function POST(req:Request){try{
 checkOrigin(req);await requireSession();
 const body=await readJsonBody(req);
 const c=await context({load:'identity'});
 if(!leadReader(c.me.role))throw new CRMError('تسجيل دور خدمة العملاء متاح لخدمة العملاء ومدير النظام.',403);
 requirePages(c.me,'activity');
 return Response.json(await recordRoleTask(c,body,new Date().toISOString()),{headers:{'Cache-Control':'no-store'}});
}catch(e){return errorResponse(e);}}
