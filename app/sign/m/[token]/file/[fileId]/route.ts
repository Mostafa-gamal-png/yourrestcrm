// A file of a mold request, served to the customer through the signing link only (2026-11-10): while the link opens, the request's own
// PDFs and images of its design, quotation and PO files (lib/mold-sign-server.ts signLinkFiles); for a day after the customer signed from
// it, the signed copies its signature names. Nothing else: no other request's file, no signature image, nothing of production's. Inline (a
// PDF or an image opens in the browser), ?download=1 as an attachment. Every refusal is the same neutral page. Counted by address.
import {env} from 'cloudflare:workers';
import {database} from '@/lib/crm-server';
import {moldContentDisposition,moldDesignContentType} from '@/portable/mold-rules.mjs';
import {findBySignToken,signLinkFiles,signLinkPermit,SIGN_LINK_GONE} from '@/lib/mold-sign-server';
import {loadMoldDesignFiles} from '@/lib/mold-requests-server';
export const dynamic='force-dynamic';

/** Each file is held whole in memory (up to 25 MiB): a few at a time per process. */
const maxConcurrent=4;
let active=0;
const escapeHtml=(text:string)=>text.replace(/[&<>"']/g,char=>'&#'+char.charCodeAt(0)+';');
/** The neutral page (the same for a forged, expired, used or cancelled link, another request's file, or too many tries). */
function gone(status=404,message=SIGN_LINK_GONE){
 const html='<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>يورست للصناعات</title></head>'
  +'<body style="font-family:system-ui,sans-serif;margin:24px;line-height:1.8"><p>'+escapeHtml(message)+'</p><p lang="en" dir="ltr">This link is not working. Ask the representative for a new link.</p></body></html>';
 return new Response(html,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"}});
}

export async function GET(req:Request,{params}:{params:Promise<{token:string;fileId:string}>}){
 try{
  const {token,fileId}=await params,db=database();
  if(!await signLinkPermit(db,req.headers))return gone(429,'محاولات كتير؛ استنى دقيقة وحاول تاني.');
  const found=await findBySignToken(db,token);
  if(!found)return gone();
  const file=signLinkFiles(found.row,await loadMoldDesignFiles(db,'request_id=?',[found.row.id]),found.state).find(item=>item.id===fileId);
  if(!file?.objectKey||!env.FILES)return gone();
  if(active>=maxConcurrent)return gone(429,'التحميل مشغول دلوقتي؛ حاول بعد لحظات.');
  active++;
  try{
   const object=await env.FILES.get(file.objectKey);
   if(!object)return gone();
   const bytes=new Uint8Array(await object.arrayBuffer()),download=new URL(req.url).searchParams.get('download')==='1',type=moldDesignContentType(file.contentType);
   return new Response(bytes,{headers:{'Content-Type':type,'Content-Length':String(bytes.length),'Content-Disposition':moldContentDisposition(file.name,!download&&type!=='application/octet-stream'),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'}});
  }finally{active--;}
 }catch{return gone(503,'الخدمة مش متاحة دلوقتي؛ حاول بعد شوية.');}
}
