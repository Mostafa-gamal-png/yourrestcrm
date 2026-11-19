import {context,checkOrigin,replyError,readJsonBody,requireSession,requireSalesRole,requirePages,requireCell,CRMError,isRecord} from '@/lib/crm-server';
import {planDay,PLAN_MESSAGES} from '@/lib/daily-plans';
import {readPlanExport,readPlanList,readPlanView,writeMemberPlan,writeReviewerPlan} from '@/lib/daily-plans-server';
import {isFieldRole} from '@/lib/roles';
export const dynamic='force-dynamic';
/** «خطة الغد» and «خطط المناديب» (lib/daily-plans*.ts, migration 0022). The sales team only (customer service 403); the screen hidden from
 * the member answers 404 (lib/permissions.ts). GET:
 * - ?date=&memberId=: one member's plan of that day (the member's own, or a field member a reviewer reads; another 403);
 * - ?date= alone: a representative or a marketing officer reads their own; a reviewer the list of their team's plans that day;
 * - ?from=&to=: a reviewer's export of their team's plans (at most 31 days; «خطط المناديب · تصدير»).
 * POST: {action:'save'|'send',…} the member's own plan («خطط المناديب · إضافة»); {action:'approve'|'approve_edited'|'return'|'note',…} a
 * reviewer's decision or note («خطط المناديب · تحرير»). Never cached. */
export async function GET(req:Request){try{
 const c=await context(),url=new URL(req.url);requireSalesRole(c.me);requirePages(c.me,'plans');
 const from=url.searchParams.get('from'),to=url.searchParams.get('to');
 if(from!==null||to!==null){requireCell(c.me,'plans','export');return Response.json(await readPlanExport(c,String(from),String(to)),{headers:{'Cache-Control':'no-store'}});}
 const date=planDay(url.searchParams.get('date'));if(!date)throw new CRMError(PLAN_MESSAGES.invalid,400);
 const memberId=url.searchParams.get('memberId');
 if(memberId||isFieldRole(c.me.role))return Response.json(await readPlanView(c,memberId||c.me.id,date),{headers:{'Cache-Control':'no-store'}});
 return Response.json(await readPlanList(c,date),{headers:{'Cache-Control':'no-store'}});
}catch(error){return replyError(error);}}
export async function POST(req:Request){try{
 checkOrigin(req);await requireSession();
 const body=await readJsonBody(req),c=await context();requireSalesRole(c.me);requirePages(c.me,'plans');
 if(!isRecord(body))throw new CRMError(PLAN_MESSAGES.invalid,400);
 if(body.action==='save'||body.action==='send'){requireCell(c.me,'plans','add');return Response.json(await writeMemberPlan(c,body),{headers:{'Cache-Control':'no-store'}});}
 requireCell(c.me,'plans','edit');
 return Response.json(await writeReviewerPlan(c,body),{headers:{'Cache-Control':'no-store'}});
}catch(error){return replyError(error);}}
