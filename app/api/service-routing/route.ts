import {context,CRMError,replyError,requirePages} from '@/lib/crm-server';
import {routingView} from '@/lib/service-sales-server';
export const dynamic='force-dynamic';
/** «اعتماد وإحالة» (the owner, 2026-11-16, item 5 of the GSCO list): GET ?id= what the customer-service manager (or the administrator) sees
 *  before deciding an opportunity waiting for their approval: whether customer service may keep it and why, the open opportunities of the
 *  customer with sales (a warning), the sales managers and the customer-service members to choose from. The decision itself is POST
 *  /api/customer-service {action:'approve',route:'sales'|'service'}. No session 401; «الزيارات» hidden 404; a case the reader may not read
 *  404; one not waiting for their approval 409. Never cached. */
export async function GET(req:Request){try{
 const probe=await context({load:'identity'});
 requirePages(probe.me,'activity');
 const id=new URL(req.url).searchParams.get('id')||'';
 if(!id||id.length>200)throw new CRMError('الطلب غير متاح',404);
 return Response.json(await routingView(await context(),id),{headers:{'Cache-Control':'no-store'}});
}catch(e){return replyError(e);}}
