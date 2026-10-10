import {z} from 'zod';
import {context,replyError,checkOrigin,parseJsonBody} from '@/lib/crm-server';
import {readRequestText} from '@/lib/request-body';
import {erpSalesConfiguration,importErpSales} from '@/lib/erp-sales-server';
export const dynamic='force-dynamic';
const noStore={'Cache-Control':'no-store'};
function errorResponse(error:unknown){if(error instanceof z.ZodError)return Response.json({error:error.issues.map(issue=>issue.message).join(' • ')},{status:400,headers:noStore});return replyError(error);}
export async function GET(){try{return Response.json(await erpSalesConfiguration(await context()),{headers:noStore});}catch(error){return errorResponse(error);}}
export async function POST(request:Request){try{checkOrigin(request);const c=await context(),body=parseJsonBody(await readRequestText(request,7_200_000));return Response.json(await importErpSales(c,body),{headers:noStore});}catch(error){return errorResponse(error);}}
