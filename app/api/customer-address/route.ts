import {z} from 'zod';
import {env} from 'cloudflare:workers';
import {context,checkOrigin,replyError,parseJsonBody,CRMError} from '@/lib/crm-server';
import {readRequestText} from '@/lib/request-body';
import {allowCustomerAddressLookup,lookupCustomerAddress} from '@/lib/customer-address-server';

export const dynamic='force-dynamic';
const input=z.object({latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180),language:z.enum(['ar','en']).default('ar')}).strict().refine(point=>point.latitude!==0||point.longitude!==0,'الموقع غير صالح');
const headers={'Cache-Control':'no-store'};

export async function POST(req:Request){try{
 checkOrigin(req);
 const c=await context({load:'identity'});
 if(!['admin','manager','supervisor','rep','customer_service','customer_service_manager'].includes(c.me.role))throw new CRMError('ليس لديك صلاحية إضافة عميل',403);
 const point=input.parse(parseJsonBody(await readRequestText(req,2048)));
 // Do not send coordinates to a third party until the server integration is configured.
 if(!env.YR_NATIONAL_ADDRESS_API_KEY?.trim())return Response.json({status:'not_configured'},{headers});
 if(!allowCustomerAddressLookup(c.me.id))return Response.json({status:'unavailable',message:'انتظر دقيقة ثم حاول تحديد العنوان مرة أخرى.'},{status:429,headers:{...headers,'Retry-After':'60'}});
 return Response.json(await lookupCustomerAddress(point,point.language),{headers});
 }catch(error){if(error instanceof z.ZodError)return Response.json({error:'إحداثيات الموقع غير صحيحة.'},{status:400,headers});const response=replyError(error);response.headers.set('Cache-Control','no-store');return response;}}
