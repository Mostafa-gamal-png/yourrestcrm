import {context,checkOrigin,replyError,readJsonBody,requireSession} from '@/lib/crm-server';
import {markReviewsRead,reviewInbox} from '@/lib/supervisor-reviews-server';
export const dynamic='force-dynamic';
/** «ملاحظات المشرف على شغلك» (lib/supervisor-reviews*.ts). GET: the signed-in member's own unread notes of the last 30 days. POST
 * {items:[{kind,ref,version}]}: «قرأت» on those of them that are theirs at that version; answers with what is still unread. Every role
 * that can be noted (whoever appears in a reviewer's day report) reads here; nobody reads another member's notes. Never cached. */
export async function GET(){try{
 const c=await context({load:'identity'});
 return Response.json(await reviewInbox(c),{headers:{'Cache-Control':'no-store'}});
}catch(error){return replyError(error);}}
export async function POST(req:Request){try{
 checkOrigin(req);await requireSession();
 const body=await readJsonBody(req),c=await context({load:'identity'});
 return Response.json(await markReviewsRead(c,body),{headers:{'Cache-Control':'no-store'}});
}catch(error){return replyError(error);}}
