import {z} from 'zod';
import {context,readJsonBody,checkOrigin,replyError} from '@/lib/crm-server';
import {customerIdentityOptions,saveCustomerIdentity} from '@/lib/customer-identity-server';
import {nudgeMoldCustomers} from '@/lib/mold-customers-hook';
export const dynamic='force-dynamic';
export async function GET(){try{return Response.json(await customerIdentityOptions(await context({load:'customers'})),{headers:{'Cache-Control':'no-store'}});}catch(error){return replyError(error);}}
// A merge or an identity change may change the customer list the products application holds: checked shortly after.
export async function POST(req:Request){try{checkOrigin(req);const input=await readJsonBody(req);const saved=Response.json(await saveCustomerIdentity(await context({load:'customers'}),input));nudgeMoldCustomers({soon:true});return saved;}catch(error){if(error instanceof z.ZodError)return Response.json({error:error.issues.map(issue=>issue.message).join(' • ')},{status:400});return replyError(error);}}
