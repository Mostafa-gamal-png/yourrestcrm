import {readJsonBody} from '@/lib/crm-server';
import {z} from 'zod';
import {context,checkOrigin,CRMError,replyError} from '@/lib/crm-server';
import {saveKpi} from '@/lib/kpis-server';
export const dynamic='force-dynamic';
export async function POST(req:Request){try{checkOrigin(req);const body=await readJsonBody(req);if(JSON.stringify(body).length>20000)throw new CRMError('حجم البيانات كبير');return Response.json(await saveKpi(await context({load:'identity'}),body));}catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(i=>i.message).join(' • ')},{status:400});return replyError(e);}}
