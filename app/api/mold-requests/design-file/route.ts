// Downloading a mold request's design file through the CRM (the contract's addition «ملفات التصميم», 2026-11-02): never a link to
// production, and only after the reader may see the request.
// ?id=<request>&file=<crmFileId or production's fileId>: whoever may open the request (canOpenMoldRequest: what their list shows, and for
//  the sales manager a request «طلبات بانتظار اعتمادي» shows them now that their list does not, as customer service's), for a file the request shows
//  (moldDesignFilesView: a file the CRM deleted is never served, even while an older status lists it, nor one whose deletion is still on
//  its way to production). A CRM file whose bytes the CRM keeps is served from the object store; any other is fetched from production
//  with design-file.
// ?order=<orderNo>&file=<fileId>: the sales manager, for a request in their pending list as production answers it now (the list's own
//  rule, moldPendingFor: who asked and the regions; a list kept from before a failed call is not enough), registered in production or in
//  the CRM, and a file that item lists.
// A file is any of the request's: a design file, or (since production's update of 2026-11-03) the quotation's or the PO's, named by its
//  fileId whichever list it is in.
// &inline=1 opens a PDF or an image in the browser; anything else always downloads, as plain bytes (an SVG or a drawing is never rendered).
//  Opened as a page of its own, a failure is said in words on that page rather than as JSON.
import {env} from 'cloudflare:workers';
import {context,CRMError,replyError} from '@/lib/crm-server';
import {callProducts} from '@/portable/mold-client.mjs';
import {moldContentDisposition,moldDesignContentType} from '@/portable/mold-rules.mjs';
import {canApproveMoldRequests,canUseMoldRequests,moldDesignFilesView,moldErrorText,moldListedFiles,type MoldDesignFile,type MoldDesignFileRow} from '@/lib/mold-requests';
import {canOpenMoldRequest,loadMoldDesignFiles,loadMoldRequest,moldPendingFor,moldQuotePoSupported,productsLink} from '@/lib/mold-requests-server';
export const dynamic='force-dynamic';

// Each file is held whole in memory (up to 25 MiB: production's answer, or the CRM's copy as the object store reads it) until the
// browser has read it: a few at a time per process. A download keeps its place until its body is read to the end or abandoned, and at
// most DOWNLOAD_HOLD_MS, so a body nobody reads cannot keep it.
const maxConcurrentDownloads=4,DOWNLOAD_HOLD_MS=10*60_000,CHUNK=64*1024;
let activeDownloads=0;
/** The body of a download, which gives back its place once read, cancelled or failed: the bytes as they are (handed on in slices,
 *  never copied), or the object store's stream. */
function held(body:Uint8Array|ReadableStream<Uint8Array>):ReadableStream<Uint8Array>{
 const reader=body instanceof ReadableStream?body.getReader():null;let offset=0;
 let free=()=>{free=()=>{};clearTimeout(timer);activeDownloads--;};
 const timer=setTimeout(()=>free(),DOWNLOAD_HOLD_MS);(timer as {unref?:()=>void}).unref?.();
 return new ReadableStream<Uint8Array>({
  async pull(controller){
   try{
    if(reader){const {done,value}=await reader.read();if(done){free();controller.close();}else controller.enqueue(value);return;}
    const bytes=body as Uint8Array;
    if(offset<bytes.length){controller.enqueue(bytes.subarray(offset,offset+CHUNK));offset+=CHUNK;}
    if(offset>=bytes.length){free();controller.close();}
   }catch(error){free();controller.error(error);}
  },
  cancel(reason){free();return reader?.cancel(reason);},
 },{highWaterMark:0});
}
const busy=()=>Response.json({error:'تنزيل الملفات مشغول مؤقتًا. أعد المحاولة بعد لحظات.'},{status:429,headers:{'Retry-After':'5','Cache-Control':'private, no-store'}});
/** «Open» (&inline=1) is a browser tab of its own: there a failure reads as a short page in words, not as raw JSON. A download, or a
 *  script's call, keeps the JSON answer. */
const openedAsPage=(req:Request)=>new URL(req.url).searchParams.get('inline')==='1'&&(req.headers.get('sec-fetch-dest')==='document'||!req.headers.get('sec-fetch-dest')&&/text\/html/.test(req.headers.get('accept')||''));
const escapeHtml=(text:string)=>text.replace(/[&<>"']/g,char=>'&#'+char.charCodeAt(0)+';');
async function failurePage(reply:Response){
 let message='';
 try{message=String(((await reply.clone().json()) as {error?:unknown}).error||'');}catch{message='';}
 const html='<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>تعذّر فتح الملف</title></head>'
  +'<body style="font-family:system-ui,sans-serif;margin:24px;line-height:1.7"><h1 style="font-size:20px">تعذّر فتح الملف</h1><p>'+escapeHtml(message||'تعذّر فتح الملف. حاول مرة أخرى.')+'</p><p>أغلق هذه الصفحة وارجع إلى الطلب.</p></body></html>';
 const headers=new Headers({'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"});
 const retry=reply.headers.get('retry-after');if(retry)headers.set('Retry-After',retry);
 return new Response(html,{status:reply.status,headers});
}

export async function GET(req:Request){const reply=await answer(req);return reply.ok||!openedAsPage(req)?reply:failurePage(reply);}
async function answer(req:Request):Promise<Response>{try{
 const c=await context({load:'customers'});
 if(!canUseMoldRequests(c.me.role))throw new CRMError('طلبات تصنيع القوالب غير متاحة لهذا الدور',403);
 const url=new URL(req.url),id=url.searchParams.get('id'),order=url.searchParams.get('order'),key=url.searchParams.get('file')||'',inline=url.searchParams.get('inline')==='1';
 if(!/^[A-Za-z0-9_-]{1,64}$/.test(key)||(id===null)===(order===null))throw new CRMError('حدد الملف');
 const link=productsLink();
 let entry:MoldDesignFile|undefined,own:MoldDesignFileRow|undefined;
 if(id!==null){
  const row=await loadMoldRequest(c.db,id);
  if(!row||!await canOpenMoldRequest(row,c,link))throw new CRMError('الملف غير متاح',404);
  const files=await loadMoldDesignFiles(c.db,'request_id=?',[row.id]),shown=moldDesignFilesView(row,files,c.me,link.ok,await moldQuotePoSupported(c.db)).find(file=>file.key===key||file.fileId===key);
  // A file its requester deleted is not served while the deletion is still on its way to production (the screen offers no link to it).
  if(!shown||shown.state==='deleting')throw new CRMError('الملف غير متاح',404);
  own=shown.source==='crm'?files.find(file=>file.id===shown.crmFileId):undefined;
  entry=shown.fileId===null?undefined:moldListedFiles(row.remote).find(file=>String(file.fileId)===shown.fileId);
  if(!entry&&!(own?.objectKey&&env.FILES))throw new CRMError(own?'نسخة الملف في الـCRM غير موجودة ولم يصل للإنتاج بعد':'الملف غير متاح',404);
 }else{
  if(!canApproveMoldRequests(c.me))throw new CRMError('ملفات الطلبات بانتظار الاعتماد لمدير المبيعات',403);
  const orderNo=Number(order);
  if(!/^\d{1,9}$/.test(order||'')||orderNo<1)throw new CRMError('حدد الملف');
  if(!link.ok)throw new CRMError('الربط مع الإنتاج غير مفعَّل',503);
  // The order must wait for them now: when production's list could not be had, the one kept from before may name an order that has
  // since moved on (approved, cancelled), so nothing is served on it.
  const pending=await moldPendingFor(c,link);
  if(pending?.error)throw new CRMError(moldErrorText(pending.error.code,ar=>ar)+'؛ تعذّر التأكد من أن الطلب ما زال بانتظار اعتمادك. حاول مرة أخرى.',502);
  const item=pending?.items.find(waiting=>waiting.orderNo===orderNo);
  if(!item)throw new CRMError('الطلب لم يعد بانتظار اعتمادك. حدّث الصفحة.',404);
  entry=[...item.designFiles,...item.quoteFiles,...item.poFiles].find(file=>String(file.fileId)===key);
  if(!entry)throw new CRMError('الملف غير متاح',404);
 }
 if(activeDownloads>=maxConcurrentDownloads)return busy();
 activeDownloads++;
 // From here the place is the body's (held) once a file is answered; any other way out gives it back.
 let handed=false;
 try{
  /** The answer, its headers made first: the place becomes the body's (held) only once nothing else can fail. */
  const served=(body:Uint8Array|ReadableStream<Uint8Array>,size:number,type:string,name:string,show:boolean)=>{
   const headers={'Content-Type':type,'Content-Length':String(size),'Content-Disposition':moldContentDisposition(name,show&&type!=='application/octet-stream'),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
   const stream=held(body);handed=true;
   return new Response(stream,{headers});
  };
  if(own?.objectKey&&env.FILES){
   const object=await env.FILES.get(own.objectKey);
   if(object)return served(object.body as Uint8Array|ReadableStream<Uint8Array>,object.size??own.size,moldDesignContentType(own.contentType),own.name,inline&&own.kind!=='other');
  }
  if(!entry)throw new CRMError('نسخة الملف في الـCRM غير موجودة ولم يصل للإنتاج بعد',404);
  if(!link.ok)throw new CRMError('الربط مع الإنتاج غير مفعَّل',503);
  const call=await callProducts(link,'design-file',{fileId:entry.fileId});
  if(call.kind==='not_found')throw new CRMError('الملف غير موجود لدى الإنتاج',404);
  if(call.kind!=='ok'||!call.file)throw new CRMError(moldErrorText(call.code,ar=>ar,{file:true})+'. حاول مرة أخرى.',502);
  // The listed kind decides what may be shown: a drawing stays plain bytes whatever type production sent.
  const type=entry.kind==='other'?'application/octet-stream':moldDesignContentType(call.file.contentType);
  return served(call.file.bytes,call.file.bytes.length,type,entry.name||call.file.name,inline&&entry.kind!=='other');
 }finally{if(!handed)activeDownloads--;}
}catch(e){return replyError(e);}}
