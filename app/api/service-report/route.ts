import {z} from 'zod';
import {context,CRMError,replyError} from '@/lib/crm-server';
import {riyadhDate} from '@/lib/visits';
import {REPORT_MONTH,serviceReport,serviceReportAllowed} from '@/lib/service-report';
export const dynamic='force-dynamic';
const monthSchema=z.string().regex(REPORT_MONTH,'اختر شهرًا صحيحًا');
/** Aggregate figures over the customer-service cases the reader may already read. No customer, text or note leaves here. */
export async function GET(req:Request){try{
 const c=await context({load:'directory'});
 if(!serviceReportAllowed(c.me.role))throw new CRMError('التقرير متاح لمدير النظام ومدير المبيعات ومدير خدمة العملاء فقط',403);
 const now=new Date().toISOString(),month=monthSchema.parse(new URL(req.url).searchParams.get('month')||riyadhDate(now).slice(0,7));
 return Response.json(serviceReport(c,month,now),{headers:{'Cache-Control':'no-store'}});
}catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(i=>i.message).join(' • ')},{status:400});return replyError(e);}}
