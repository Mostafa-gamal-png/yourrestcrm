import {context,replyError,requireSalesRole,requirePages} from '@/lib/crm-server';
import {requireJourneyReport} from '@/lib/journeys-server';
import {reviewPending} from '@/lib/supervisor-reviews-server';
export const dynamic='force-dynamic';
/** «زيارات ومتابعات بلا نتيجة أو إجراء» (lib/supervisor-reviews*.ts ReviewPending, the red card on the first screen): GET only, read-only,
 * never cached. The same doors as the day report's notes (GET /api/reviews): signed in (401), a sales role (customer service 403), a role
 * that opens «تقرير يوم المندوب» (a representative 403) and the screen not hidden from the member (404, which does not lock the page's
 * offline session); then a supervisor or a sales manager only (the administrator 403). Each counts only their own team's work. */
export async function GET(){try{
 const c=await context({load:'directory'});requireSalesRole(c.me);requireJourneyReport(c);requirePages(c.me,'journeys');
 return Response.json(await reviewPending(c),{headers:{'Cache-Control':'no-store'}});
}catch(error){return replyError(error);}}
