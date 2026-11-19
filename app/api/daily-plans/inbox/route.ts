import {context,replyError} from '@/lib/crm-server';
import {readPlanInbox} from '@/lib/daily-plans-server';
export const dynamic='force-dynamic';
/** The reminder cards of «خطة الغد» and «خطط المناديب» (lib/daily-plans.ts PlanInbox): a member who prepares plans gets the next working
 * day's plan and today's; a reviewer the sent plans waiting for them and who of their team has not sent one after the deadline. Customer
 * service, a member the screen is hidden from, or one whose cell is off gets role 'none' (the card shows nothing). Reads plans and
 * members only. Never cached. */
export async function GET(){try{
 const c=await context({load:'identity'});
 return Response.json(await readPlanInbox(c),{headers:{'Cache-Control':'no-store'}});
}catch(error){return replyError(error);}}
