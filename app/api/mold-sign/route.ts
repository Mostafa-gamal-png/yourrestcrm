// The customer signs a mold request from the link the representative sent (the owner, 2026-11-10: «امكانية ارسال لينك بالpdf طلب القالب
// للتوقيع عليه»): public, no session; the token in the body is the only thing that names the request (lib/mold-sign-server.ts signFromLink:
// the link opens, the page's key is the request's now, the signature and its block are valid; then the signature is stored as the device
// stores it, the PDFs get their signed copies, and the request goes to production at once). Same origin only (the page is the CRM's own),
// counted by address before the body is read, the body bounded (lib/request-body.ts). A refusal of the link is one neutral answer.
import {z} from 'zod';
import {checkOrigin,database,readJsonBody,replyError} from '@/lib/crm-server';
import {MOLD_SIGNATURE_BASE64_MAX,MOLD_SIGNATURE_BLOCK_BASE64_MAX} from '@/portable/mold-rules.mjs';
import {signFromLink,signLinkPermit,SignLinkRefusal} from '@/lib/mold-sign-server';
import {keepMoldRetrying,productsLink,releaseMoldRequest} from '@/lib/mold-requests-server';
export const dynamic='force-dynamic';

const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
/** Its English pairs are in lib/locales/en.json. */
const TOO_MANY='محاولات كتير؛ استنى دقيقة وحاول تاني.',CONSENT='لازم توافق إنك قريت الطلب والملفات قبل التوقيع.',BAD_BODY='بيانات التوقيع غير صحيحة؛ افتح اللينك تاني.';
const schema=z.object({requestId:z.string().uuid(),token:z.string().max(64),key:z.string().max(64),signer:z.string().max(400),png:z.string().max(MOLD_SIGNATURE_BASE64_MAX),
 block:z.string().max(MOLD_SIGNATURE_BLOCK_BASE64_MAX),blockAt:z.string().max(40),consent:z.literal(true)}).strict();

export async function POST(req:Request){try{
 checkOrigin(req);
 const db=database();
 if(!await signLinkPermit(db,req.headers)){void req.body?.cancel().catch(()=>{});return Response.json({error:TOO_MANY},{status:429,headers:{...headers,'Retry-After':'60'}});}
 const body=await readJsonBody(req),parsed=schema.safeParse(body);
 if(!parsed.success){
  const consent=parsed.error.issues.some(issue=>issue.path[0]==='consent');
  return Response.json({error:consent?CONSENT:BAD_BODY,...(consent?{fields:{consent:CONSENT}}:{})},{status:400,headers});
 }
 const link=productsLink();keepMoldRetrying();
 const done=await signFromLink(db,parsed.data,{send:(id,told)=>releaseMoldRequest(db,id,{link,onRequest:told})});
 return Response.json(done,{headers});
}catch(e){
 if(e instanceof SignLinkRefusal)return Response.json({error:e.message,...(e.fields?{fields:e.fields}:{}),...(e.status===404?{gone:true}:{})},{status:e.status,headers});
 return replyError(e);
}}
