import {z} from 'zod';
import {context,checkOrigin,replyError,readJsonBody,requireSession,CRMError} from '@/lib/crm-server';
import {journeyDate} from '@/lib/journeys';
import {requireJourneyReport} from '@/lib/journeys-server';
import {deviceReportSchema} from '@/lib/device-status';
import {DEVICE_REPORT_MIN_GAP_MS,normalizeDeviceReport,saveDeviceReport,trackingOverview} from '@/lib/device-status-server';
export const dynamic='force-dynamic';
const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value);
/** A representative's phone reports its own tracking state. Nothing else can write here. */
export async function POST(req:Request){try{
 checkOrigin(req);await requireSession();
 const body=await readJsonBody(req);if(JSON.stringify(body).length>4000)throw new CRMError('حجم الطلب كبير');
 const c=await context({load:'identity'});
 if(c.me.role!=='rep')throw new CRMError('حالة الجهاز تخص المندوبين فقط',403);
 const report=deviceReportSchema.parse(body),now=new Date().toISOString();
 const outcome=await saveDeviceReport(c.db,c.me.id,normalizeDeviceReport(report,Date.parse(now)),now);
 if(outcome==='throttled')return Response.json({error:'تقارير الجهاز متقاربة جدًا'},{status:429,headers:{'Retry-After':String(Math.ceil(DEVICE_REPORT_MIN_GAP_MS/1000)),'Cache-Control':'no-store'}});
 return Response.json({ok:true,reportedAt:now},{headers:{'Cache-Control':'no-store'}});
}catch(error){if(error instanceof z.ZodError)return Response.json({error:'بيانات حالة الجهاز غير صحيحة'},{status:400});return replyError(error);}}
/** Supervisors, managers and admins read the tracking state of the representatives they already see in the daily report. */
export async function GET(req:Request){try{
 const c=await context({load:'identity'});requireJourneyReport(c);
 const requested=new URL(req.url).searchParams.get('date'),date=requested===null?journeyDate():dateSchema.parse(requested);
 return Response.json({date,serverTime:new Date().toISOString(),members:await trackingOverview(c,date)},{headers:{'Cache-Control':'no-store'}});
}catch(error){if(error instanceof z.ZodError)return Response.json({error:'تاريخ غير صحيح'},{status:400});return replyError(error);}}
