import {z} from 'zod';
import {context,replyError,checkOrigin,parseJsonBody} from '@/lib/crm-server';
import {readRequestText} from '@/lib/request-body';
import {erpQuotesConfiguration,importErpQuotes,requireErpQuotesImport} from '@/lib/erp-quotes-server';
export const dynamic='force-dynamic';
const noStore={'Cache-Control':'no-store'};
// «استيراد عروض الأسعار من ERP» (lib/erp-quotes-server.ts): the session first (401), then whoever may import ERP sales and add a quotation
// (the sales workspace; «المبيعات» or «عروض الأسعار» hidden: 404; «استيراد» on «المبيعات» or «إضافة» on «عروض الأسعار» off: 403), all before the file is read. The body is bounded like the ERP
// sales import's (a 5 MB file as base64).
const permitted=async()=>{const c=await context();requireErpQuotesImport(c.me);return c;};
function errorResponse(error:unknown){if(error instanceof z.ZodError)return Response.json({error:error.issues.map(issue=>issue.message).join(' • ')},{status:400,headers:noStore});return replyError(error);}
export async function GET(){try{return Response.json(await erpQuotesConfiguration(await permitted()),{headers:noStore});}catch(error){return errorResponse(error);}}
export async function POST(request:Request){try{checkOrigin(request);const c=await permitted(),body=parseJsonBody(await readRequestText(request,7_200_000));return Response.json(await importErpQuotes(c,body),{headers:noStore});}catch(error){return errorResponse(error);}}
