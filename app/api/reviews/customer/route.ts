import {context,replyError} from '@/lib/crm-server';
import {customerNotes} from '@/lib/supervisor-reviews-server';
export const dynamic='force-dynamic';
/** The reviewers' earlier notes on one customer's visits and contacts (lib/supervisor-reviews*.ts CustomerNotes), shown read-only on the
 * follow-up screen and the customer's details: GET ?customerId=. Every signed-in member may ask; each gets only what customerNotes allows
 * them (their own work, and a reviewer's team as the day report shows it) of a customer they may open (404 otherwise). Never cached. */
export async function GET(req:Request){try{
 const c=await context({load:'customer-graph',customerId:new URL(req.url).searchParams.get('customerId')||''});
 return Response.json(await customerNotes(c,new URL(req.url).searchParams.get('customerId')||''),{headers:{'Cache-Control':'no-store'}});
}catch(error){return replyError(error);}}
