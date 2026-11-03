// Attaching a design file to a mold request (the contract's addition «ملفات التصميم», 2026-11-02): the requester only, while production
// still accepts changes. The file is checked as production checks it (name, extension, 25 MiB, a real PDF, an image of at most 80 000 000
// pixels, 10 files a request with production's), kept in the CRM's object store with its row and audit entry (a receipt makes a repeated
// tap harmless; the entry never holds the contents), then sent with design-files as soon as production holds the request. A send that
// takes long goes on in the background. Attaching undoes the approvals given (the screen warns first).
import {z} from 'zod';
import {env} from 'cloudflare:workers';
import {context,accessGuard,checkOrigin,requireSession,CRMError,replyError} from '@/lib/crm-server';
import {readRequestForm} from '@/lib/request-body';
import {moldDesignFileCheck,MOLD_DESIGN_MAX_FILES} from '@/portable/mold-rules.mjs';
import {canReadMoldRequest,canUseMoldRequests,moldDesignCount,moldDesignRefusalText,moldEditable,moldRequestView} from '@/lib/mold-requests';
import {keepMoldRetrying,loadMoldDesignFiles,loadMoldRequest,moldViewReasons,productsLink,sendMoldDesignFile,MOLD_DESIGN_REFUSED_SQL,type DesignOutcome} from '@/lib/mold-requests-server';
export const dynamic='force-dynamic';

// Multipart parsing, hashing and the object write stay bounded together (per Node process, as for visit files).
const maxConcurrentUploads=2;
let activeUploads=0;
/** How long the answer waits for the send to production before saying «waiting»; the send itself goes on (up to 120 seconds). */
const SEND_WAIT_MS=15_000;
const sha256=async(bytes:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
/** The CRM's live files of a request in SQL, as moldDesignCount counts them: not deleted (or whose deletion has not reached production),
 *  not refused for good. */
const LIVE_FILES=`SELECT COUNT(*) FROM crm_mold_design_files WHERE request_id=? AND (deleted_at IS NULL OR outbox='delete') AND NOT ${MOLD_DESIGN_REFUSED_SQL}`;

export async function POST(req:Request){let objectKey='',admitted=false;try{
 checkOrigin(req);await requireSession();
 const c=await context({load:'customers'});
 if(!canUseMoldRequests(c.me.role))throw new CRMError('طلبات تصنيع القوالب غير متاحة لهذا الدور',403);
 if(!env.FILES)throw new CRMError('رفع الملفات غير متاح مؤقتًا.',503);
 if(activeUploads>=maxConcurrentUploads){void req.body?.cancel().catch(()=>{});return Response.json({error:'رفع الملفات مشغول مؤقتًا. أعد المحاولة بعد لحظات.'},{status:429,headers:{'Retry-After':'5','Cache-Control':'private, no-store'}});}
 activeUploads++;admitted=true;
 const form=await readRequestForm(req),file=form.get('file');
 const requestId=z.string().uuid().parse(form.get('requestId')),id=z.string().regex(/^mr-[0-9a-f-]{36}$/).parse(form.get('id'));
 if(!(file instanceof File))throw new CRMError('اختر ملف التصميم');
 const bytes=new Uint8Array(await file.arrayBuffer()),checked=moldDesignFileCheck(file.name,bytes);
 if(!checked.ok){const message=moldDesignRefusalText(checked.reason,ar=>ar);throw Object.assign(new CRMError(message,checked.reason==='too_large'?413:400),{fields:{[checked.field]:message},reason:checked.reason});}
 const hash=await sha256(bytes),crmFileId='mdf-'+requestId,link=productsLink();keepMoldRetrying();
 const canonical=JSON.stringify({action:'attach',id,name:checked.name,size:bytes.length,sha256:hash}),receiptId='mold-design-receipt:'+c.me.id+':'+requestId;
 const answer=async(status=200,send:DesignOutcome|null=null,error='')=>{
  const row=await loadMoldRequest(c.db,id);
  if(!row||!canReadMoldRequest(row,c))throw new CRMError('الطلب غير متاح',404);
  const view=moldRequestView(row,c.me,c.members,link.ok,await loadMoldDesignFiles(c.db,'request_id=?',[row.id]),(await moldViewReasons(c.db,[row],c.me)).get(row.id));
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
 const count=moldDesignCount(row,await loadMoldDesignFiles(c.db,'request_id=?',[row.id])),full='الحد '+MOLD_DESIGN_MAX_FILES+' ملفات للطلب (ملفاتك وملفات الإنتاج). احذف ملفًا أولًا.';
 if(count.crm+count.production>=MOLD_DESIGN_MAX_FILES)throw new CRMError(full,409);
 // Every attempt owns a separate object: a losing concurrent retry removes only its own, never the saved file's.
 objectKey='mold-design/'+row.id+'/'+crmFileId+'/'+crypto.randomUUID();
 await env.FILES.put(objectKey,bytes,{httpMetadata:{contentType:checked.contentType}});
 const now=new Date().toISOString(),mutation=crypto.randomUUID(),permission=accessGuard(c),gate='EXISTS(SELECT 1 FROM crm_mold_design_files WHERE id=? AND mutation_id=?)';
 const detail={label:'إرفاق ملف تصميم لطلب تصنيع قالب',customerName:row.data.customer.name,name:checked.name,kind:checked.kind,size:bytes.length};
 // Saved only while the request is still the requester's, not cancelled, editable as last known, and within the 10 places.
 const result=await c.db.batch([
  c.db.prepare(`INSERT OR IGNORE INTO crm_mold_design_files(id,request_id,member_id,name,kind,content_type,size,sha256,object_key,created_at,outbox,next_attempt_at,version,mutation_id)
   SELECT ?,?,?,?,?,?,?,?,?,?,'send',?,1,? WHERE ${permission.sql} AND EXISTS(SELECT 1 FROM crm_mold_requests WHERE id=? AND member_id=? AND cancelled_at IS NULL AND (remote IS NULL OR json_extract(remote,'$.editable')=1)) AND (${LIVE_FILES})<?`)
   .bind(crmFileId,row.id,c.me.id,checked.name,checked.kind,checked.contentType,bytes.length,hash,objectKey,now,now,mutation,...permission.args,row.id,c.me.id,row.id,MOLD_DESIGN_MAX_FILES-count.production),
  c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(receiptId,row.id,c.me.name,'mold-design-receipt',canonical,now,crmFileId,mutation),
  c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(crypto.randomUUID(),row.id,c.me.name,'mold-design:attach',JSON.stringify(detail),now,crmFileId,mutation),
 ]).catch(async error=>{const again=await replay();if(again)return again;throw error;});
 if(result instanceof Response||result[0].meta.changes!==1){
  const again=result instanceof Response?result:await replay();
  await env.FILES.delete(objectKey).catch(()=>{});objectKey='';
  if(again)return again;
  const fresh=await loadMoldRequest(c.db,row.id),places=fresh&&moldDesignCount(fresh,await loadMoldDesignFiles(c.db,'request_id=?',[row.id]));
  throw new CRMError(places&&places.crm+places.production>=MOLD_DESIGN_MAX_FILES?full:'تغيّرت حالة الطلب أو صلاحياتك أثناء الحفظ. حدّث الصفحة.',409);
 }
 objectKey='';
 // Saved. When production holds the request the file goes now; the answer waits a little for it.
 let outcome:DesignOutcome|null=null;
 if(row.accepted&&link.ok){
  let timer:ReturnType<typeof setTimeout>|undefined;
  outcome=await Promise.race([sendMoldDesignFile(c.db,crmFileId,{link}).catch(()=>null),new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),SEND_WAIT_MS);})]);
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
