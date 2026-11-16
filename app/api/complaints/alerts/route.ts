import {context,replyError,requirePages} from '@/lib/crm-server';
import {canViewPage} from '@/lib/access';
import {complaintQueue} from '@/lib/complaints';
import {loadComplaints} from '@/lib/complaint-rows';
import {complaintAlerts} from '@/lib/complaint-alerts';
export const dynamic='force-dynamic';
/** «شكوى تنتظرك» (the owner, 2026-11-16, item 3 of the GSCO list; lib/complaint-alerts.ts): asked by the Android app (1.0.14 and later) when
 *  it opens, every ten minutes from the route tracking service and every fifteen minutes from its background check, with the session cookie.
 *  The complaints that wait for the signed-in member themself, from the same queue as the complaints page: no session 401, a member whose
 *  complaints screen is hidden 404 (the complaints are on «الشكاوى» for the roles that have it, on «الزيارات» for the sales team), any other
 *  member an answer (possibly empty). Read-only and never cached. */
export async function GET(){try{
 const probe=await context({load:'identity'});
 requirePages(probe.me,canViewPage(probe.me.role,'complaints')?'complaints':'activity');
 // As the complaints route: customer service and administrators read every customer of their branch, the sales team the directory.
 const c=['admin','customer_service','customer_service_manager'].includes(probe.me.role)?await context():await context({load:'directory'});
 const now=new Date().toISOString(),complaints=await loadComplaints(c.db,now);
 return Response.json(complaintAlerts(complaintQueue({me:c.me,members:c.members,all:c.all,complaints},now,Infinity),c.me.id,now),{headers:{'Cache-Control':'no-store'}});
}catch(e){return replyError(e);}}
