import {context,replyError,requireSalesRole,requirePages} from '@/lib/crm-server';
import {requireJourneyReport} from '@/lib/journeys-server';
import {readTeamToday} from '@/lib/team-today-server';
export const dynamic='force-dynamic';
/** «فريقي اليوم» (lib/team-today*.ts). GET only: today's row for each member of the reader's «تقرير يوم المندوب» (names, counts and
 * times). The same doors as the day report (GET /api/journeys?date=): signed in (401), a sales role (customer service 403), the
 * administrator, a sales manager or a supervisor (a representative 403), and the screen not hidden (404, which does not lock the page's
 * offline session). Never cached. */
export async function GET(){try{
 const c=await context({load:'directory'});requireSalesRole(c.me);requireJourneyReport(c);requirePages(c.me,'journeys');
 return Response.json(await readTeamToday(c),{headers:{'Cache-Control':'no-store'}});
}catch(error){return replyError(error);}}
