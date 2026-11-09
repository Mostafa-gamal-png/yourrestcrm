import {z} from 'zod';
import {context,checkOrigin,replyError,readJsonBody,requireSession,requireSalesRole,requirePages,requireCell,CRMError} from '@/lib/crm-server';
import {requireJourneyReport} from '@/lib/journeys-server';
import {salesScopeMemberIds} from '@/lib/access';
import {dateSchema,reportReviews,saveReview} from '@/lib/supervisor-reviews-server';
export const dynamic='force-dynamic';
/** The supervisor's notes on «تقرير يوم المندوب» (lib/supervisor-reviews*.ts). GET ?date=&memberId=: the notes on the report the reader
 * may open (memberId as in GET /api/journeys: their own day by default, a member of their team, or all), with when each was read, and
 * which entries and whether the day they may note. Read-only, never cached. */
export async function GET(req:Request){try{
 const c=await context(),url=new URL(req.url);requireSalesRole(c.me);requireJourneyReport(c);requirePages(c.me,'journeys');
 const date=dateSchema.parse(url.searchParams.get('date')),memberId=url.searchParams.get('memberId')||c.me.id;
 if(memberId!=='all'&&!salesScopeMemberIds(c.members,c.me,{read:true}).has(memberId))throw new CRMError('الموظف خارج نطاق فريقك',403);
 return Response.json(await reportReviews(c,date,memberId),{headers:{'Cache-Control':'no-store'}});
}catch(error){if(error instanceof z.ZodError)return Response.json({error:'بيانات تقرير خط السير غير صحيحة'},{status:400});return replyError(error);}}
/** POST {kind:'entry',activityId|kind:'day',memberId,date, result, action, version (null for a new note), requestId}: saves the note. */
export async function POST(req:Request){try{
 checkOrigin(req);await requireSession();
 const body=await readJsonBody(req),c=await context();
 // «الصلاحيات»: writing a note is «إضافة» on «تقرير يوم المندوب».
 requirePages(c.me,'journeys');requireCell(c.me,'journeys','add');
 return Response.json(await saveReview(c,body),{headers:{'Cache-Control':'no-store'}});
}catch(error){return replyError(error);}}
