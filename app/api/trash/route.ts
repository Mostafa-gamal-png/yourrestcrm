// «المحذوفات» (lib/trash.ts, lib/trash-server.ts): GET lists the deletions the reader may restore (?type=, ?before= for the next 40),
// POST {auditId, requestId} restores one. The administrator and the sales manager only (lib/access.ts trashScope).
import {z} from 'zod';
import {context,checkOrigin,readJsonBody,replyError,requirePages,requireCell} from '@/lib/crm-server';
import {listTrash,restoreFromTrash} from '@/lib/trash-server';
import {nudgeMoldCustomers} from '@/lib/mold-customers-hook';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{
 const c=await context({load:'identity'});
 // «الصلاحيات»: «المحذوفات» closed when hidden; restoring is its «تحرير».
 requirePages(c.me,'trash');
 return Response.json(await listTrash(c,new URL(req.url)),{headers:{'Cache-Control':'no-store'}});
}catch(e){return replyError(e);}}
export async function POST(req:Request){try{
 checkOrigin(req);const body=await readJsonBody(req);const c=await context();
 requirePages(c.me,'trash');requireCell(c.me,'trash','edit');
 const answer=await restoreFromTrash(c,body);
 // A restored customer is in the products application's customer list again: the next check sends the changed list (lib/mold-customers-server.ts).
 if(answer.type==='customer')nudgeMoldCustomers({soon:true});
 return Response.json(answer);
}catch(e){if(e instanceof z.ZodError)return Response.json({error:'صيغة البيانات غير صحيحة. أعد المحاولة.'},{status:400});return replyError(e);}}
