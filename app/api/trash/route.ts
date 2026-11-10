// «المحذوفات» (lib/trash.ts, lib/trash-server.ts): GET lists the deletions the reader may restore (?type=, ?before= for the next 40),
// POST {auditId, requestId} restores one. The administrator (all), the sales manager and, since 2026-11-10, whoever has a «حذف» cell on (their
// own deletions; lib/permissions.ts trashScopeOf). A member without the page, or with it hidden, gets 404 as for a hidden screen (never 401/403,
// which lock the offline session); a refused restoration 403 with its reason (lib/trash-server.ts).
import {z} from 'zod';
import {context,checkOrigin,readJsonBody,replyError,requireCell,CRMError} from '@/lib/crm-server';
import {pageAllowed,PAGE_HIDDEN_TEXT} from '@/lib/permissions';
import type {Member} from '@/lib/crm';
import {listTrash,restoreFromTrash} from '@/lib/trash-server';
import {nudgeMoldCustomers} from '@/lib/mold-customers-hook';
export const dynamic='force-dynamic';
/** «المحذوفات» for this member (the role's, or «حذف» on, and not hidden by «استعراض»): else 404. */
function requireTrashPage(me:Member){if(!pageAllowed(me,'trash'))throw new CRMError(PAGE_HIDDEN_TEXT,404);}
export async function GET(req:Request){try{
 const c=await context({load:'identity'});
 // «الصلاحيات»: «المحذوفات» closed when hidden; restoring is its «تحرير».
 requireTrashPage(c.me);
 return Response.json(await listTrash(c,new URL(req.url)),{headers:{'Cache-Control':'no-store'}});
}catch(e){return replyError(e);}}
export async function POST(req:Request){try{
 checkOrigin(req);const body=await readJsonBody(req);const c=await context();
 requireTrashPage(c.me);requireCell(c.me,'trash','edit');
 const answer=await restoreFromTrash(c,body);
 // A restored customer is in the products application's customer list again: the next check sends the changed list (lib/mold-customers-server.ts).
 if(answer.type==='customer')nudgeMoldCustomers({soon:true});
 return Response.json(answer);
}catch(e){if(e instanceof z.ZodError)return Response.json({error:'صيغة البيانات غير صحيحة. أعد المحاولة.'},{status:400});return replyError(e);}}
