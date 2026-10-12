import {context,replyError} from '@/lib/crm-server';
import {serviceAlerts} from '@/lib/service-alerts';
export const dynamic='force-dynamic';
/** Asked by the Android app on opening and every ten minutes in working hours; read-only and light. */
export async function GET(){try{
 const c=await context({load:'directory'});
 return Response.json(serviceAlerts(c),{headers:{'Cache-Control':'no-store'}});
}catch(e){return replyError(e);}}
