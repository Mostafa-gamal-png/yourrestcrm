import {context,checkOrigin,replyError,readJsonBody,requireSession,requireSalesRole,requirePages,requireCell} from '@/lib/crm-server';
import {workAreasGet,workAreasPost} from '@/lib/work-areas-server';
export const dynamic='force-dynamic';
/** The representatives' work areas on «خريطة المصانع» (lib/work-areas*.ts, migration 0023). The sales team only (customer service 403); the
 * map hidden from the member answers 404 (lib/permissions.ts). GET ?list=1: the representatives the reader may look at; GET ?member=<id>: that
 * representative's area (a field member: their own). POST {action:'save'|'delete',…}: «خريطة المصانع · تحرير» («رسم مناطق عمل المناديب»).
 * Never cached. */
export async function GET(req:Request){try{
 const c=await context({load:'identity'});requireSalesRole(c.me);requirePages(c.me,'map');
 return Response.json(await workAreasGet(c,new URL(req.url)),{headers:{'Cache-Control':'no-store'}});
}catch(error){return replyError(error);}}
export async function POST(req:Request){try{
 checkOrigin(req);await requireSession();
 const body=await readJsonBody(req),c=await context({load:'identity'});requireSalesRole(c.me);requirePages(c.me,'map');requireCell(c.me,'map','edit');
 return Response.json(await workAreasPost(c,body),{headers:{'Cache-Control':'no-store'}});
}catch(error){return replyError(error);}}
