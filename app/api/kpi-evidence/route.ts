import {z} from 'zod';
import {context,checkOrigin,CRMError,readJsonBody,replyError} from '@/lib/crm-server';
import {getKpiEvidenceOptions,saveKpiEvidence} from '@/lib/kpi-evidence-server';
export const dynamic='force-dynamic';
function errorResponse(error:unknown){const response=error instanceof z.ZodError?Response.json({error:error.issues.map(issue=>issue.message).join(' • ')},{status:400}):replyError(error);response.headers.set('cache-control','private, no-store');return response;}
export async function GET(req:Request){try{const query=new URL(req.url).searchParams;if([...query.keys()].some(key=>!['memberId','month'].includes(key))||query.getAll('memberId').length!==1||query.getAll('month').length!==1)throw new CRMError('حدد المندوب والشهر فقط.',400);const memberId=z.string().min(1).max(200).parse(query.get('memberId'));return Response.json(await getKpiEvidenceOptions(await context(),memberId,query.get('month')||''),{headers:{'cache-control':'private, no-store'}});}catch(error){return errorResponse(error);}}
export async function POST(req:Request){try{checkOrigin(req);const body=await readJsonBody(req);if(JSON.stringify(body).length>100000)throw new CRMError('حجم بيانات المؤشرات كبير.',413);return Response.json(await saveKpiEvidence(await context(),body),{headers:{'cache-control':'private, no-store'}});}catch(error){return errorResponse(error);}}
