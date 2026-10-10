import {readJsonBody} from '@/lib/crm-server';
import {z} from 'zod';
import {context,checkOrigin,CRMError,replyError} from '@/lib/crm-server';
import {saveTargetSet} from '@/lib/targets-server';
import {ownTargets,ownTargetsMonth} from '@/lib/own-targets-server';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{const c=await context({load:'identity'});return Response.json(await ownTargets(c,ownTargetsMonth(req)),{headers:{'cache-control':'private, no-store'}});}catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(i=>i.message).join(' • ')},{status:400,headers:{'cache-control':'private, no-store'}});const response=replyError(e);response.headers.set('cache-control','private, no-store');return response;}}
export async function POST(req:Request){try{checkOrigin(req);const body=await readJsonBody(req);if(JSON.stringify(body).length>30000)throw new CRMError('حجم الطلب كبير');return Response.json(await saveTargetSet(await context({load:'customers'}),body));}catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(i=>i.message).join(' • ')},{status:400});return replyError(e);}}
