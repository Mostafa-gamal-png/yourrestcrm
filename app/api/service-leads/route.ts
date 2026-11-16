import {z} from 'zod';
import {context,CRMError,replyError,requirePages} from '@/lib/crm-server';
import {leadList,resolveLeadReference} from '@/lib/service-sales-server';
import {isLeadRefKind,leadReader} from '@/lib/service-sales';
export const dynamic='force-dynamic';
/** «مصادر الفرص» (the owner, 2026-11-16, item 5 of the GSCO list; lib/service-sales-server.ts). GET ?list=lost|dormant&q= gives a list;
 *  GET ?kind=&id= the record a new opportunity is started from, with the source the system fills in. In order: no session 401; a role
 *  other than customer service or the administrator 403; «الزيارات» («الفرص» for customer service) hidden 404; a list or a kind that is not
 *  one 400; a record the reader may not read 404. Never cached. */
export async function GET(req:Request){try{
 const probe=await context({load:'identity'});
 if(!leadReader(probe.me.role))throw new CRMError('مصادر الفرص متاحة لخدمة العملاء ومدير النظام.',403);
 requirePages(probe.me,'activity');
 const url=new URL(req.url),kind=url.searchParams.get('kind'),id=url.searchParams.get('id'),list=url.searchParams.get('list');
 if(kind||id){
  if(!isLeadRefKind(kind)||!id||id.length>200)throw new CRMError('السجل المطلوب غير صحيح.',400);
  return Response.json({reference:await resolveLeadReference(await context(),kind,id)},{headers:{'Cache-Control':'no-store'}});
 }
 if(list!=='lost'&&list!=='dormant')throw new CRMError('اختر القائمة المطلوبة.',400);
 return Response.json(await leadList(await context(),list,url.searchParams.get('q')||''),{headers:{'Cache-Control':'no-store'}});
}catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(i=>i.message).join(' • ')},{status:400});return replyError(e);}}
