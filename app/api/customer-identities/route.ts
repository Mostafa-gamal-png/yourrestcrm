import {z} from 'zod';
import {context,readJsonBody,checkOrigin,replyError} from '@/lib/crm-server';
import {customerIdentityOptions,saveCustomerIdentity} from '@/lib/customer-identity-server';
export const dynamic='force-dynamic';
export async function GET(){try{return Response.json(await customerIdentityOptions(await context({load:'customers'})),{headers:{'Cache-Control':'no-store'}});}catch(error){return replyError(error);}}
export async function POST(req:Request){try{checkOrigin(req);const input=await readJsonBody(req);return Response.json(await saveCustomerIdentity(await context({load:'customers'}),input));}catch(error){if(error instanceof z.ZodError)return Response.json({error:error.issues.map(issue=>issue.message).join(' • ')},{status:400});return replyError(error);}}
