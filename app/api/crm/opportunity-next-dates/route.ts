import {context,checkOrigin,replyError,readJsonBody,requireSession} from '@/lib/crm-server';
import {followupNextDatesPost} from '@/lib/followup-next-dates-server';
export const dynamic='force-dynamic';
/** «إضافة إلى خطة الغد», «ترحيل إلى تاريخ…» and «تغيير الموعد» of «خطة الغد» (lib/followup-next-dates-server.ts): several follow-ups moved to one
 * date, an answer for each. POST only (any other method 405); without a session 401; from another site 403. Never cached; never queued on the
 * device. */
export async function POST(req:Request){try{
 checkOrigin(req);await requireSession();
 const body=await readJsonBody(req),c=await context();
 return Response.json(await followupNextDatesPost(c,body),{headers:{'Cache-Control':'no-store'}});
}catch(error){return replyError(error);}}
