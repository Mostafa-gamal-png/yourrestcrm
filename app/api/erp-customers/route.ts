import {z} from 'zod';
import {context,replyError,checkOrigin,parseJsonBody} from '@/lib/crm-server';
import {readRequestText} from '@/lib/request-body';
import {importErpCustomers,requireErpCustomersRole} from '@/lib/erp-customers-server';
export const dynamic='force-dynamic';
const noStore={'Cache-Control':'no-store'};
function errorResponse(error:unknown){if(error instanceof z.ZodError)return Response.json({error:error.issues.map(issue=>issue.message).join(' • ')},{status:400,headers:noStore});return replyError(error);}
// The session and the role are checked before the file is read: an anonymous caller gets 401, any other role 403. The ERP code is not
// part of the customer list sent to the products application, so nothing is nudged there.
export async function POST(request:Request){try{checkOrigin(request);const c=await context({load:'customers'});requireErpCustomersRole(c.me);const body=parseJsonBody(await readRequestText(request));return Response.json(await importErpCustomers(c,body),{headers:noStore});}catch(error){return errorResponse(error);}}
