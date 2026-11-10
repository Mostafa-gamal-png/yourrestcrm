import {z} from 'zod';
import {context,CRMError,replyError,requirePages,requireSalesWorkspace} from '@/lib/crm-server';
import {targetHistory} from '@/lib/targets-server';
export const dynamic='force-dynamic';
/** «سجل التعديلات» of a target: the team page's readers (administrator, sales manager, supervisor) with «المستهدفات وتقييم الأداء»
 *  open; the scope check (whose targets this account reads) is targetHistory's. Read only. */
export async function GET(req:Request){try{
 const c=await context({load:'identity'});requireSalesWorkspace(c.me);requirePages(c.me,'targets');
 const query=new URL(req.url).searchParams;
 if([...query.keys()].some(key=>!['scopeId','offset'].includes(key))||query.getAll('scopeId').length!==1||query.getAll('offset').length>1)throw new CRMError('حدد المستهدف فقط.',400);
 const scopeId=z.string().min(1).max(300).parse(query.get('scopeId')),offset=z.coerce.number().int().min(0).max(100000).parse(query.get('offset')??'0');
 return Response.json(await targetHistory(c,scopeId,offset),{headers:{'cache-control':'private, no-store'}});
}catch(e){const response=e instanceof z.ZodError?Response.json({error:e.issues.map(i=>i.message).join(' • ')},{status:400}):replyError(e);response.headers.set('cache-control','private, no-store');return response;}}
