import {z} from 'zod';
import {context,replyError,requireSalesRole,requirePages} from '@/lib/crm-server';
import {requireJourneyReport} from '@/lib/journeys-server';
import {dateSchema,reviewsMade} from '@/lib/supervisor-reviews-server';
export const dynamic='force-dynamic';
/** «تقرير مراجعاتي» (lib/supervisor-reviews*.ts ReviewsMade): GET ?date=&reviewerId= what a reviewer wrote on that Riyadh day, for the roles
 * that open «تقرير يوم المندوب» (a representative and customer service: 403; the screen hidden from the member: 404). reviewerId is the
 * reader by default; another reviewer only as reviewerChoices allows (403 otherwise). Read-only, never cached. */
export async function GET(req:Request){try{
 const c=await context(),url=new URL(req.url);requireSalesRole(c.me);requireJourneyReport(c);requirePages(c.me,'journeys');
 const date=dateSchema.parse(url.searchParams.get('date')),reviewerId=url.searchParams.get('reviewerId')||c.me.id;
 return Response.json(await reviewsMade(c,date,reviewerId),{headers:{'Cache-Control':'no-store'}});
}catch(error){if(error instanceof z.ZodError)return Response.json({error:'بيانات تقرير خط السير غير صحيحة'},{status:400});return replyError(error);}}
