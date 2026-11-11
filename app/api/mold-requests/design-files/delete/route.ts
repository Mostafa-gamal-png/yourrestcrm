// Deleting a design file the CRM attached (the contract's addition «ملفات التصميم», 2026-11-02): the requester only, and only the CRM's
// own files (production manages the ones it attached). The quotation's and PO's files (2026-11-03) are deleted the same way. A file production never held (never tried, or refused for good) is removed in the
// CRM alone, at any time. One production may hold goes through design-file-delete while the request is editable, which undoes the
// approvals given for a design file (the screen warns first) and no longer for a quotation's or PO's (2026-11-05: no warning); a send
// still in flight is let finish first, so the deletion never overtakes the file. Deleting the last quotation or PO file of a new request
// that has not reached production keeps it in the CRM again until another is attached.
// A receipt makes a repeated tap harmless; the audit entry names the file, never its contents.
// The customer's signature (2026-11-04) is not deleted while the request's data names it: an edit that changes what was signed replaces it.
// Nor is a signed copy the signature names (2026-11-10).
import {z} from 'zod';
import {env} from 'cloudflare:workers';
import {context,accessGuard,checkOrigin,requireSession,readJsonBody,CRMError,replyError,requirePages} from '@/lib/crm-server';
import {canReadMoldRequest,canUseMoldRequests,moldApprovesRequest,moldDesignMayBeRemote,moldEditable,moldRequestView,moldSignatureOf,moldSignedOutputOf} from '@/lib/mold-requests';
import {keepMoldRetrying,loadMoldDesignFiles,loadMoldRequest,moldDesignClaimed,moldQuotePoSupported,moldViewReasons,productsLink,sendMoldDesignFile,type DesignOutcome} from '@/lib/mold-requests-server';
export const dynamic='force-dynamic';

/** Its English pair is in lib/locales/en.json. */
const SIGNATURE_KEPT='توقيع العميل ما بيتحذفش من الطلب؛ لو اتغيّرت بيانات الطلب قبل إرساله بيوقّع العميل من جديد.';
/** A signed copy the signature names (2026-11-10) stays with it, the same way. Its English pair is in lib/locales/en.json. */
const COPY_KEPT='النسخة الموقّعة ما بتتحذفش من الطلب طول ما التوقيع اللي عليها هو توقيع الطلب.';
const schema=z.object({requestId:z.string().uuid(),id:z.string().regex(/^mr-[0-9a-f-]{36}$/),fileId:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)}).strict();

export async function POST(req:Request){try{
 checkOrigin(req);await requireSession();
 // The role is checked before the body is read.
 const c=await context({load:'customers'});
 if(!canUseMoldRequests(c.me.role))throw new CRMError('طلبات تصنيع القوالب غير متاحة لهذا الدور',403);
 // «الصلاحيات»: part of «طلبات تصنيع القوالب» (closed when hidden).
 requirePages(c.me,'mold-requests');
 const input=schema.parse(await readJsonBody(req)),link=productsLink();keepMoldRetrying();
 const canonical=JSON.stringify({action:'delete',...input}),receiptId='mold-design-receipt:'+c.me.id+':'+input.requestId;
 const answer=async(status=200,send:DesignOutcome|null=null,error='')=>{
  const row=await loadMoldRequest(c.db,input.id);
  if(!row||!canReadMoldRequest(row,c))throw new CRMError('الطلب غير متاح',404);
  return Response.json({ok:status<400,request:moldRequestView(row,c.me,c.members,link.ok,await loadMoldDesignFiles(c.db,'request_id=?',[row.id]),(await moldViewReasons(c.db,[row],c.me)).get(row.id),await moldQuotePoSupported(c.db),moldApprovesRequest(row,c)),send:send?{kind:send.kind,code:send.code,...(send.reason?{reason:send.reason}:{})}:null,...(error?{error}:{})},{status,headers:{'Cache-Control':'no-store'}});
 };
 const replay=async()=>{
  const saved=await c.db.prepare('SELECT detail FROM crm_audit WHERE id=?').bind(receiptId).first<{detail:string}>();
  if(!saved)return null;
  if(saved.detail!==canonical)throw new CRMError('العملية محفوظة ببيانات مختلفة. حدّث الصفحة.',409);
  return answer();
 };
 const repeated=await replay();if(repeated)return repeated;
 const row=await loadMoldRequest(c.db,input.id);
 if(!row||!canReadMoldRequest(row,c))throw new CRMError('الطلب غير متاح',404);
 if(row.memberId!==c.me.id)throw new CRMError('حذف ملفات التصميم لمن طلب القالب',403);
 const file=(await loadMoldDesignFiles(c.db,'id=? AND request_id=?',[input.fileId,row.id]))[0];
 if(!file)throw new CRMError('الملف غير موجود، أو من ملفات الإنتاج التي يديرها الإنتاج',404);
 if(file.deletedAt)return answer();
 const signature=moldSignatureOf(row.data);
 if(signature?.fileId===file.id)throw new CRMError(SIGNATURE_KEPT,409);
 if(signature&&moldSignedOutputOf(file.id,signature.fileId))throw new CRMError(COPY_KEPT,409);
 const remote=moldDesignMayBeRemote(file);
 if(remote&&!moldEditable(row))throw new CRMError(row.cancelledAt?'الطلب ملغى؛ ملفاته باقية كما هي':'اكتملت الاعتمادات أو بدأ الإنتاج؛ لم يعد حذف الملف ممكنًا',409);
 const now=new Date().toISOString(),mutation=crypto.randomUUID(),permission=accessGuard(c),gate='EXISTS(SELECT 1 FROM crm_mold_design_files WHERE id=? AND mutation_id=?)';
 // A send in flight keeps its lease: the deletion goes once it has ended, so it cannot reach production before the file does.
 const after=remote&&file.outbox==='send'&&moldDesignClaimed(file,now)?file.nextAttemptAt!:now;
 // Unchanged since it was read (no send claimed it meanwhile: a claim sets last_attempt_at), the requester's still.
 const unchanged=`id=? AND version=? AND deleted_at IS NULL AND COALESCE(last_attempt_at,'')=? AND ${permission.sql}`,args=[file.id,file.version,file.lastAttemptAt||'',...permission.args];
 const statement=remote
  ?c.db.prepare(`UPDATE crm_mold_design_files SET deleted_at=?,outbox='delete',attempts=0,first_failed_at=NULL,next_attempt_at=?,last_error=NULL,version=version+1,mutation_id=? WHERE ${unchanged}`).bind(now,after,mutation,...args)
  :c.db.prepare(`UPDATE crm_mold_design_files SET deleted_at=?,outbox=NULL,next_attempt_at=NULL,object_key=NULL,version=version+1,mutation_id=? WHERE ${unchanged}`).bind(now,mutation,...args);
 const detail={label:file.category==='quote'?'حذف ملف عرض سعر من طلب تصنيع قالب':file.category==='po'?'حذف ملف PO من طلب تصنيع قالب':'حذف ملف تصميم من طلب تصنيع قالب',customerName:row.data.customer.name,name:file.name,atProduction:remote,...(file.category!=='design'?{category:file.category}:{})};
 const result=await c.db.batch([statement,
  c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(receiptId,row.id,c.me.name,'mold-design-receipt',canonical,now,file.id,mutation),
  c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(crypto.randomUUID(),row.id,c.me.name,'mold-design:delete',JSON.stringify(detail),now,file.id,mutation),
 ]).catch(async error=>{const again=await replay();if(again)return again;throw error;});
 if(result instanceof Response)return result;
 if(result[0].meta.changes!==1){const again=await replay();if(again)return again;throw new CRMError('تغيّر الملف أثناء الحفظ (ربما بدأ إرساله). حدّث الصفحة وأعد المحاولة.',409);}
 if(!remote){
  // Production never held it: the bytes leave the CRM now.
  if(file.objectKey&&env.FILES)await env.FILES.delete(file.objectKey).catch(()=>{});
  return answer();
 }
 const outcome=after===now?await sendMoldDesignFile(c.db,file.id,{link}):null;
 if(outcome?.kind==='locked')return answer(409,outcome,'اكتملت الاعتمادات قبل وصول الحذف؛ الملف باقٍ كما يحمله الإنتاج.');
 return answer(200,outcome);
}catch(e){
 if(e instanceof z.ZodError)return Response.json({error:'بيانات حذف الملف غير صحيحة.'},{status:400});
 return replyError(e);
}}
