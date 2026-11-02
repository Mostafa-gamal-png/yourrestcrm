import {z} from 'zod';
import {context,replyError,checkOrigin,parseJsonBody} from '@/lib/crm-server';
import {readRequestText} from '@/lib/request-body';
import {importErpCustomers,requireErpCustomersRole} from '@/lib/erp-customers-server';
import {nudgeMoldCustomers} from '@/lib/mold-customers-hook';
export const dynamic='force-dynamic';
const noStore={'Cache-Control':'no-store'};
function errorResponse(error:unknown){if(error instanceof z.ZodError)return Response.json({error:error.issues.map(issue=>issue.message).join(' • ')},{status:400,headers:noStore});return replyError(error);}
// The session and the role are checked before the file is read: an anonymous caller gets 401, any other role 403. The ERP code is part
// of the customer list sent to the products application (since 2026-11-02), so an apply nudges that list to go shortly after.
export async function POST(request:Request){try{checkOrigin(request);const c=await context({load:'customers'});requireErpCustomersRole(c.me);const body=parseJsonBody(await readRequestText(request));const result=await importErpCustomers(c,body);if((body as {action?:unknown}|null)?.action==='apply')nudgeMoldCustomers({soon:true});return Response.json(result,{headers:noStore});}catch(error){return errorResponse(error);}}
