import {context,CRMError,replyError,requirePages} from '@/lib/crm-server';
import {loadSupport} from '@/lib/support-rows';
import {isOpportunitySupportRefusal,mayAskFromOpportunity,opportunitySupport,SUPPORT_OPPORTUNITY_ROLES} from '@/lib/support-opportunity';
export const dynamic='force-dynamic';
/** «طلب مساندة» inside an opportunity (the owner, 2026-11-16, item 3 of the GSCO list; lib/support-opportunity.ts): what the button needs
 *  before its form, read-only. GET ?id=<the opportunity's case id>: no session 401; customer service 403 (it is the one asked); «الزيارات»
 *  hidden from the member 404 (the sheet that shows the opportunity is there); an opportunity the reader may not read 404; else the
 *  opportunity (its request number, whether it is open), its customer (or null: not in the customer list) and the customer's open support
 *  request (with whether the reader may open it). Never cached. */
export async function GET(request:Request){try{
 const probe=await context({load:'identity'});
 if(!mayAskFromOpportunity(probe.me.role))throw new CRMError(SUPPORT_OPPORTUNITY_ROLES,403);
 requirePages(probe.me,'activity');
 const id=String(new URL(request.url).searchParams.get('id')||'').slice(0,200);
 // The full context, as the request sheet itself reads it (app/api/customer-service): the case is decided exactly as it is shown.
 const c=await context(),now=new Date().toISOString(),found=opportunitySupport({me:c.me,members:c.members,all:c.all,serviceCases:c.serviceCases,support:await loadSupport(c.db,now)},id);
 if(isOpportunitySupportRefusal(found))throw new CRMError(found.error,found.status);
 return Response.json(found,{headers:{'Cache-Control':'no-store'}});
}catch(e){return replyError(e);}}
