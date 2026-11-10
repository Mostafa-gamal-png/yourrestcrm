// Attaching a design file to a mold request (the contract's addition «ملفات التصميم», 2026-11-02): the requester only, while production
// still accepts changes. The file is checked as production checks it (name, extension, 25 MiB, a real PDF, an image of at most 80 000 000
// pixels, 10 files a request with production's), kept in the CRM's object store with its row and audit entry (a receipt makes a repeated
// tap harmless; the entry never holds the contents), then sent with design-files as soon as production holds the request. A send that
// takes long goes on in the background. Attaching a design file undoes the approvals given (the screen warns first).
// The quotation's and PO's files (yourrest-products, second update of 2026-11-03) come the same way with `category` (quote or po): a PDF or
// an image only, at most 5 of each kind (production's included), and only once production's update is known to be live; a design file
// is one without category, as before (10 a request). Since 2026-11-05 one of them is required of a new request, kept in the CRM until
// then: the first attached releases it (the request is sent, then its files, releaseMoldRequest). Attaching one no longer undoes the
// approvals (production's update of 2026-11-05), so no warning is shown for it. Since 2026-11-08 a design file of its own (not the
// customer's signature) is required of every new request too, kept the same way: the file that leaves nothing missing releases it.
// Since 2026-11-10 a PDF the customer saw on the device when signing (its SHA-256 among the signature's seen) gets its signed copy as it
// arrives (lib/mold-sign-server.ts makeSignedCopies), saved right after it and sent after it; one attached after the signature gets none.
import {z} from 'zod';
import {env} from 'cloudflare:workers';
import {context,accessGuard,checkOrigin,requireSession,CRMError,replyError,requirePages} from '@/lib/crm-server';
import {readRequestForm} from '@/lib/request-body';
import {moldDesignFileCheck,MOLD_CATEGORY_MAX_FILES} from '@/portable/mold-rules.mjs';
import {canReadMoldRequest,canUseMoldRequests,moldApprovesRequest,moldDesignCount,moldDesignRefusalText,moldEditable,moldHeldFor,moldRequestView,moldSignatureOf,type MoldFileCategory} from '@/lib/mold-requests';
import {makeSignedCopies} from '@/lib/mold-sign-server';
import {keepMoldRetrying,loadMoldDesignFiles,loadMoldRequest,moldQuotePoSupported,moldViewReasons,productsLink,releaseMoldRequest,sendMoldDesignFile,MOLD_DESIGN_REFUSED_SQL,type DesignOutcome} from '@/lib/mold-requests-server';
export const dynamic='force-dynamic';

// Multipart parsing, hashing and the object write stay bounded together (per Node process, as for visit files).
const maxConcurrentUploads=2;
let activeUploads=0;
/** How long the answer waits for the send to production before saying «waiting»; the send itself goes on (up to 120 seconds). */
const SEND_WAIT_MS=15_000;
const sha256=async(bytes:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
/** The CRM's live files of a request and a category in SQL, as moldDesignCount counts them: not deleted (or whose deletion has not
 *  reached production), not refused for good. */
const LIVE_FILES=`SELECT COUNT(*) FROM crm_mold_design_files WHERE request_id=? AND category=? AND (deleted_at IS NULL OR outbox='delete') AND NOT ${MOLD_DESIGN_REFUSED_SQL}`;
/** A design file (the form sends no category, as before), the quotation's or the PO's. */
const categoryInput=z.enum(['design','quote','po']);
/** When a category's places are taken, in the representative's words. */
const FULL:Record<MoldFileCategory,string>={design:'الحد '+MOLD_CATEGORY_MAX_FILES.design+' ملفات للطلب (ملفاتك وملفات الإنتاج). احذف ملفًا أولًا.',quote:'الحد '+MOLD_CATEGORY_MAX_FILES.quote+' ملفات لعرض السعر (ملفاتك وملفات الإنتاج). احذف ملفًا أولًا.',po:'الحد '+MOLD_CATEGORY_MAX_FILES.po+' ملفات للـ PO (ملفاتك وملفات الإنتاج). احذف ملفًا أولًا.'};
/** A quotation's or PO's file attached before production's update is known to be live (no screen offers it then). */
const QUOTE_PO_NOT_YET='تطبيق المنتجات لسه ما اتحدّثش لاستقبال ملفات عرض السعر والـ PO؛ حدّث الصفحة.';

export async function POST(req:Request){let objectKey='',admitted=false;try{
 checkOrigin(req);await requireSession();
 const c=await context({load:'customers'});
 if(!canUseMoldRequests(c.me.role))throw new CRMError('طلبات تصنيع القوالب غير متاحة لهذا الدور',403);
 // «الصلاحيات»: part of «طلبات تصنيع القوالب» (closed when hidden).
 requirePages(c.me,'mold-requests');
 if(!env.FILES)throw new CRMError('رفع الملفات غير متاح مؤقتًا.',503);
 if(activeUploads>=maxConcurrentUploads){void req.body?.cancel().catch(()=>{});return Response.json({error:'رفع الملفات مشغول مؤقتًا. أعد المحاولة بعد لحظات.'},{status:429,headers:{'Retry-After':'5','Cache-Control':'private, no-store'}});}
 activeUploads++;admitted=true;
 const form=await readRequestForm(req),file=form.get('file');
 const requestId=z.string().uuid().parse(form.get('requestId')),id=z.string().regex(/^mr-[0-9a-f-]{36}$/).parse(form.get('id'));
 const category:MoldFileCategory=categoryInput.parse(form.get('category')??'design');
 if(!(file instanceof File))throw new CRMError('اختر ملف التصميم');
 if(category!=='design'&&!await moldQuotePoSupported(c.db))throw new CRMError(QUOTE_PO_NOT_YET,409);
 const bytes=new Uint8Array(await file.arrayBuffer()),checked=moldDesignFileCheck(file.name,bytes,category);
 if(!checked.ok){const message=moldDesignRefusalText(checked.reason,ar=>ar,category);throw Object.assign(new CRMError(message,checked.reason==='too_large'?413:400),{fields:{[checked.field]:message},reason:checked.reason});}
 const hash=await sha256(bytes),crmFileId='mdf-'+requestId,link=productsLink();keepMoldRetrying();
 // A design file's receipt reads as before (an upload started before this release is still recognized); another kind names its own.
 const canonical=JSON.stringify({action:'attach',id,name:checked.name,size:bytes.length,sha256:hash,...(category!=='design'?{category}:{})}),receiptId='mold-design-receipt:'+c.me.id+':'+requestId;
 const answer=async(status=200,send:DesignOutcome|null=null,error='')=>{
  const row=await loadMoldRequest(c.db,id);
  if(!row||!canReadMoldRequest(row,c))throw new CRMError('الطلب غير متاح',404);
  const view=moldRequestView(row,c.me,c.members,link.ok,await loadMoldDesignFiles(c.db,'request_id=?',[row.id]),(await moldViewReasons(c.db,[row],c.me)).get(row.id),await moldQuotePoSupported(c.db),moldApprovesRequest(row,c));
  return Response.json({ok:status<400,file:view.designFiles.find(entry=>entry.crmFileId===crmFileId)||null,request:view,send:send?{kind:send.kind,code:send.code,...(send.reason?{reason:send.reason}:{})}:null,...(error?{error}:{})},{status,headers:{'Cache-Control':'no-store'}});
 };
 const replay=async()=>{
  const saved=await c.db.prepare('SELECT detail FROM crm_audit WHERE id=?').bind(receiptId).first<{detail:string}>();
  if(!saved)return null;
  if(saved.detail!==canonical)throw new CRMError('العملية محفوظة ببيانات مختلفة. حدّث الصفحة.',409);
  return answer();
 };
 const repeated=await replay();if(repeated)return repeated;
 const row=await loadMoldRequest(c.db,id);
 if(!row||!canReadMoldRequest(row,c))throw new CRMError('الطلب غير متاح',404);
 if(row.memberId!==c.me.id)throw new CRMError('إرفاق ملفات التصميم لمن طلب القالب',403);
 if(!moldEditable(row))throw new CRMError(row.cancelledAt?'الطلب ملغى':'اكتملت الاعتمادات أو بدأ الإنتاج؛ لم يعد تغيير ملفات الطلب ممكنًا',409);
 const before=await loadMoldDesignFiles(c.db,'request_id=?',[row.id]),count=moldDesignCount(row,before,category),full=FULL[category];
 // A new request kept for its quotation's or PO's file (2026-11-05) or its design file (2026-11-08): this one releases it once saved
 // when, with it, nothing is missing any more (a quotation's file of a request with no design file keeps it, for its design file). The
 // page uploads one file at a time; two kinds saved at once elsewhere leave the request due, and the next timetable check sends it.
 const added={id:crmFileId,category,deletedAt:null,outbox:'send' as const,nextAttemptAt:null,lastError:null,sentAt:null};
 const releases=!!moldHeldFor(row,before)&&!moldHeldFor(row,[...before,added]);
 if(count.crm+count.production>=count.max)throw new CRMError(full,409);
 // Every attempt owns a separate object: a losing concurrent retry removes only its own, never the saved file's.
 objectKey='mold-design/'+row.id+'/'+crmFileId+'/'+crypto.randomUUID();
 await env.FILES.put(objectKey,bytes,{httpMetadata:{contentType:checked.contentType}});
 const now=new Date().toISOString(),mutation=crypto.randomUUID(),permission=accessGuard(c),gate='EXISTS(SELECT 1 FROM crm_mold_design_files WHERE id=? AND mutation_id=?)';
 const detail={label:category==='quote'?'إرفاق ملف عرض سعر لطلب تصنيع قالب':category==='po'?'إرفاق ملف PO لطلب تصنيع قالب':'إرفاق ملف تصميم لطلب تصنيع قالب',customerName:row.data.customer.name,name:checked.name,kind:checked.kind,size:bytes.length,...(category!=='design'?{category}:{})};
 // Saved only while the request is still the requester's, not cancelled, editable as last known, and within its category's places.
 const result=await c.db.batch([
  c.db.prepare(`INSERT OR IGNORE INTO crm_mold_design_files(id,request_id,member_id,name,kind,content_type,size,sha256,object_key,created_at,outbox,next_attempt_at,version,mutation_id,category)
   SELECT ?,?,?,?,?,?,?,?,?,?,'send',?,1,?,? WHERE ${permission.sql} AND EXISTS(SELECT 1 FROM crm_mold_requests WHERE id=? AND member_id=? AND cancelled_at IS NULL AND (remote IS NULL OR json_extract(remote,'$.editable')=1)) AND (${LIVE_FILES})<?`)
   .bind(crmFileId,row.id,c.me.id,checked.name,checked.kind,checked.contentType,bytes.length,hash,objectKey,now,now,mutation,category,...permission.args,row.id,c.me.id,row.id,category,count.max-count.production),
  c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(receiptId,row.id,c.me.name,'mold-design-receipt',canonical,now,crmFileId,mutation),
  c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(crypto.randomUUID(),row.id,c.me.name,'mold-design:attach',JSON.stringify(detail),now,crmFileId,mutation),
 ]).catch(async error=>{const again=await replay();if(again)return again;throw error;});
 if(result instanceof Response||result[0].meta.changes!==1){
  const again=result instanceof Response?result:await replay();
  await env.FILES.delete(objectKey).catch(()=>{});objectKey='';
  if(again)return again;
  const fresh=await loadMoldRequest(c.db,row.id),places=fresh&&moldDesignCount(fresh,await loadMoldDesignFiles(c.db,'request_id=?',[row.id]),category);
  throw new CRMError(places&&places.crm+places.production>=places.max?full:'تغيّرت حالة الطلب أو صلاحياتك أثناء الحفظ. حدّث الصفحة.',409);
 }
 objectKey='';
 // A PDF the customer saw on the device when signing (2026-11-10): its signed copy, saved now, so it follows the original to production.
 const signature=moldSignatureOf(row.data),stamp=row.data.signature;
 let copies:string[]=[];
 if(signature&&stamp?.block?.key&&checked.kind==='pdf'&&(stamp.seen||[]).includes(hash)){
  const original=(await loadMoldDesignFiles(c.db,'id=?',[crmFileId]))[0];
  if(original)copies=(await makeSignedCopies(c.db,{requestId:row.id,signatureFileId:signature.fileId,blockKey:stamp.block.key,originals:[original],actor:c.me.name}).catch(()=>({made:[]}))).made.map(copy=>copy.id);
 }
 // Saved. When production holds the request the file goes now; the answer waits a little for it. The file that releases a request
 // kept for its files sends the request first, then its files oldest first (this one among them), through the usual sends; the
 // answer waits as long for that, and the sends go on in the background beyond it. A signed copy goes right after its original.
 let outcome:DesignOutcome|null=null;
 if((row.accepted||releases)&&link.ok){
  let timer:ReturnType<typeof setTimeout>|undefined;
  const sending=row.accepted?sendMoldDesignFile(c.db,crmFileId,{link}).then(async sent=>{for(const copy of copies)void sendMoldDesignFile(c.db,copy,{link}).catch(()=>null);return sent;}):releaseMoldRequest(c.db,row.id,{link}).then(released=>released.files.get(crmFileId)||null);
  outcome=await Promise.race([sending.catch(()=>null),new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),SEND_WAIT_MS);})]);
  clearTimeout(timer);
 }
 if(outcome?.kind==='locked')return answer(409,outcome,'اكتملت الاعتمادات قبل وصول الملف؛ لم يُرسل. الطلب كما يحمله الإنتاج.');
 return answer(200,outcome);
}catch(e){
 if(objectKey&&env.FILES)await env.FILES.delete(objectKey).catch(()=>{});
 if(e instanceof z.ZodError)return Response.json({error:'بيانات رفع الملف غير صحيحة.'},{status:400});
 if(e instanceof CRMError&&'fields' in e)return Response.json({error:e.message,fields:(e as CRMError&{fields:Record<string,string>}).fields,reason:(e as CRMError&{reason?:string}).reason},{status:e.status});
 return replyError(e);
}finally{if(admitted)activeUploads--;}}
