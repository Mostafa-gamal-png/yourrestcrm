import {z} from 'zod';
import {context,replyError,checkOrigin,parseJsonBody,requireSession} from '@/lib/crm-server';
import {readRequestText} from '@/lib/request-body';
import {importRecords,recordImportKind,recordImportTemplate} from '@/lib/record-import-server';
export const dynamic='force-dynamic';
const noStore={'Cache-Control':'private, no-store'};
function errorResponse(error:unknown){const response=error instanceof z.ZodError?Response.json({error:error.issues.map(issue=>issue.message).join(' • ')},{status:400}):replyError(error);response.headers.set('cache-control','private, no-store');return response;}
// «استيراد المستهدفات والمتابعات من قوالب Excel» (lib/record-import-server.ts): the session first (401), then the kind's rights (403, or 404 for
// a page the administrator hid), then the file. GET ?kind=targets|followups&month=YYYY-MM&lang=ar|en gives the template; POST previews or imports.
export async function GET(request:Request){try{
 await requireSession();const params=new URL(request.url).searchParams,kind=recordImportKind(params.get('kind'));
 const c=await context(),file=await recordImportTemplate(c,kind,{month:params.get('month')||undefined,language:params.get('lang')==='en'?'en':'ar'});
 return new Response(file.bytes,{headers:{...noStore,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="'+file.fileName+'"','X-Content-Type-Options':'nosniff'}});
}catch(error){return errorResponse(error);}}
// A 2 MB file as base64 is under 2.8 MB; the bytes are bounded before JSON is parsed.
export async function POST(request:Request){try{checkOrigin(request);await requireSession();const body=parseJsonBody(await readRequestText(request,3_000_000));const c=await context();return Response.json(await importRecords(c,body),{headers:noStore});}catch(error){return errorResponse(error);}}
