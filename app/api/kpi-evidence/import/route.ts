import {z} from 'zod';
import {context,replyError,checkOrigin,parseJsonBody,requirePages,requireCell,requireSalesWorkspace} from '@/lib/crm-server';
import {readRequestText} from '@/lib/request-body';
import {collectionImportConfiguration,importErpCollections} from '@/lib/erp-collections-server';
export const dynamic='force-dynamic';
const noStore={'Cache-Control':'private, no-store'};
// «استيراد كشف التحصيل من ERP»: the rights of saving «بيانات المؤشرات» by hand (app/api/kpi-evidence): the page «المستهدفات وتقييم الأداء»
// and its «تحرير»; the role (the administrator or a sales manager) is checked by lib/erp-collections-server.ts.
const permitted=async()=>{const c=await context();requireSalesWorkspace(c.me);requirePages(c.me,'targets');requireCell(c.me,'targets','edit');return c;};
function errorResponse(error:unknown){const response=error instanceof z.ZodError?Response.json({error:error.issues.map(issue=>issue.message).join(' • ')},{status:400}):replyError(error);response.headers.set('cache-control','private, no-store');return response;}
export async function GET(){try{return Response.json(await collectionImportConfiguration(await permitted()),{headers:noStore});}catch(error){return errorResponse(error);}}
// A 2 MB statement as base64 is under 2.8 MB; the bytes are bounded before JSON is parsed.
export async function POST(request:Request){try{checkOrigin(request);const c=await permitted(),body=parseJsonBody(await readRequestText(request,3_000_000));return Response.json(await importErpCollections(c,body),{headers:noStore});}catch(error){return errorResponse(error);}}
