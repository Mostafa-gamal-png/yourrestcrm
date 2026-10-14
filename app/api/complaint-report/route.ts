import {z} from 'zod';
import {context,CRMError,replyError} from '@/lib/crm-server';
import {riyadhDate} from '@/lib/visits';
import {REPORT_MONTH} from '@/lib/report-timing';
import {complaintReport,complaintReportAllowed} from '@/lib/complaint-report';
import {loadAllComplaints} from '@/lib/complaint-rows';
export const dynamic='force-dynamic';
const monthSchema=z.string().regex(REPORT_MONTH,'اختر شهرًا صحيحًا');
/** Aggregate figures over the complaints the reader may already read. No customer, text or name leaves here. */
export async function GET(req:Request){try{
 const probe=await context({load:'identity'});
 if(!complaintReportAllowed(probe.me.role))throw new CRMError('تقرير الشكاوى متاح لمدير النظام ومدير المبيعات ومدير خدمة العملاء فقط',403);
 // Customer service reads its branch's customers from the full context, as the complaints route does; a sales manager needs the directory only.
 const c=probe.me.role==='manager'?await context({load:'directory'}):await context();
 const now=new Date().toISOString(),month=monthSchema.parse(new URL(req.url).searchParams.get('month')||riyadhDate(now).slice(0,7));
 const complaints=await loadAllComplaints(c.db);
 return Response.json(complaintReport({me:c.me,members:c.members,all:c.all,complaints},month,now),{headers:{'Cache-Control':'no-store'}});
}catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(i=>i.message).join(' • ')},{status:400});return replyError(e);}}
