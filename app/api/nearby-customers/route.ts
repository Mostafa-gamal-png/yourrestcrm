import {context,CRMError,replyError,requirePages} from '@/lib/crm-server';
import {NEARBY_REP_ONLY} from '@/lib/nearby-customers';
import {readNearbyCustomers} from '@/lib/nearby-customers-server';
import {isFieldRole} from '@/lib/roles';
export const dynamic='force-dynamic';
/** «تنبيه المصانع القريبة» (lib/nearby-customers*.ts): asked by the Android app of a representative every five minutes while it records
 *  the route (06:00–18:00 Riyadh, not Friday), and again just before a notification. GET only, read-only, never cached. Signed in (401),
 *  a representative (any other role 403), «العملاء» not hidden from them (404, which does not lock the page's offline session). */
export async function GET(){try{
 const c=await context({load:'identity'});
 if(!isFieldRole(c.me.role))throw new CRMError(NEARBY_REP_ONLY,403);
 requirePages(c.me,'customer');
 return Response.json(await readNearbyCustomers(c),{headers:{'Cache-Control':'no-store'}});
}catch(error){return replyError(error);}}
