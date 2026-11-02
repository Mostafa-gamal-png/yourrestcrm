// Downloading a mold request's design file through the CRM (the contract's addition «ملفات التصميم», 2026-11-02): never a link to
// production, and only after the reader may see the request.
// ?id=<request>&file=<crmFileId or production's fileId>: whoever may read the request (canReadMoldRequest), for a file the request shows
//  (moldDesignFilesView: a file the CRM deleted is never served, even while an older status lists it). A CRM file whose bytes the CRM
//  keeps is served from the object store; any other is fetched from production with design-file.
// ?order=<orderNo>&file=<fileId>: the sales manager, for a request in their pending list (the same regions as the list), registered in
//  production or in the CRM, and a file that item lists.
// &inline=1 opens a PDF or an image in the browser; anything else always downloads, as plain bytes (an SVG or a drawing is never rendered).
import {env} from 'cloudflare:workers';
import {context,CRMError,replyError} from '@/lib/crm-server';
import {callProducts} from '@/portable/mold-client.mjs';
import {moldContentDisposition,moldDesignContentType} from '@/portable/mold-rules.mjs';
import {canApproveMoldRequests,canReadMoldRequest,canUseMoldRequests,moldDesignFilesView,moldErrorText,type MoldDesignFile} from '@/lib/mold-requests';
import {loadMoldDesignFiles,loadMoldRequest,moldPendingFor,productsLink} from '@/lib/mold-requests-server';
export const dynamic='force-dynamic';

// Each file fetched from production is held whole (up to 25 MiB) while it is passed on: a few at a time per process.
const maxConcurrentDownloads=4;
let activeDownloads=0;
const served=(body:BodyInit,size:number,type:string,name:string,inline:boolean)=>new Response(body,{headers:{'Content-Type':type,'Content-Length':String(size),'Content-Disposition':moldContentDisposition(name,inline&&type!=='application/octet-stream'),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});

export async function GET(req:Request){try{
 const c=await context({load:'customers'});
 if(!canUseMoldRequests(c.me.role))throw new CRMError('طلبات تصنيع القوالب غير متاحة لهذا الدور',403);
 const url=new URL(req.url),id=url.searchParams.get('id'),order=url.searchParams.get('order'),key=url.searchParams.get('file')||'',inline=url.searchParams.get('inline')==='1';
 if(!/^[A-Za-z0-9_-]{1,64}$/.test(key)||(id===null)===(order===null))throw new CRMError('حدد الملف');
 const link=productsLink();
 let entry:MoldDesignFile|undefined;
 if(id!==null){
  const row=await loadMoldRequest(c.db,id);
  if(!row||!canReadMoldRequest(row,c))throw new CRMError('الملف غير متاح',404);
  const files=await loadMoldDesignFiles(c.db,'request_id=?',[row.id]),shown=moldDesignFilesView(row,files,c.me,link.ok).find(file=>file.key===key||file.fileId===key);
  if(!shown)throw new CRMError('الملف غير متاح',404);
  const own=shown.source==='crm'?files.find(file=>file.id===shown.crmFileId):undefined;
  if(own?.objectKey&&env.FILES){
   const object=await env.FILES.get(own.objectKey);
   if(object)return served(object.body,object.size??own.size,moldDesignContentType(own.contentType),own.name,inline&&own.kind!=='other');
  }
  entry=shown.fileId===null?undefined:(row.remote?.designFiles||[]).find(file=>String(file.fileId)===shown.fileId);
  if(!entry)throw new CRMError(own?'نسخة الملف في الـCRM غير موجودة ولم يصل للإنتاج بعد':'الملف غير متاح',404);
 }else{
  if(!canApproveMoldRequests(c.me))throw new CRMError('ملفات الطلبات بانتظار الاعتماد لمدير المبيعات',403);
  const orderNo=Number(order);
  if(!/^\d{1,9}$/.test(order||'')||orderNo<1)throw new CRMError('حدد الملف');
  const item=(await moldPendingFor(c,link))?.items.find(waiting=>waiting.orderNo===orderNo);
  if(!item)throw new CRMError('الطلب لم يعد بانتظار اعتمادك. حدّث الصفحة.',404);
  entry=item.designFiles.find(file=>String(file.fileId)===key);
  if(!entry)throw new CRMError('الملف غير متاح',404);
 }
 if(!link.ok)throw new CRMError('الربط مع الإنتاج غير مفعَّل',503);
 if(activeDownloads>=maxConcurrentDownloads)return Response.json({error:'تنزيل الملفات مشغول مؤقتًا. أعد المحاولة بعد لحظات.'},{status:429,headers:{'Retry-After':'5','Cache-Control':'private, no-store'}});
 activeDownloads++;
 let call;
 try{call=await callProducts(link,'design-file',{fileId:entry.fileId});}finally{activeDownloads--;}
 if(call.kind==='not_found')throw new CRMError('الملف غير موجود لدى الإنتاج',404);
 if(call.kind!=='ok'||!call.file)throw new CRMError(moldErrorText(call.code,ar=>ar)+'. حاول مرة أخرى.',502);
 // The listed kind decides what may be shown: a drawing stays plain bytes whatever type production sent.
 const type=entry.kind==='other'?'application/octet-stream':moldDesignContentType(call.file.contentType);
 return served(new Uint8Array(call.file.bytes),call.file.bytes.length,type,entry.name||call.file.name,inline&&entry.kind!=='other');
}catch(e){return replyError(e);}}
