import {z} from 'zod';
import {env} from 'cloudflare:workers';
import {context,accessGuard,checkOrigin,requireSession,readJsonBody,CRMError,replyError} from '@/lib/crm-server';
import {validateMoldSpecs,moldApprovalBody,MOLD_ID,MOLD_REQUEST_REF,moldApprovalRefusal,moldCancelReasonUsed,moldPayment,moldQuotePoNumber,moldStatusObject,moldRequestCity,moldSignatureBytes,moldSignatureCheck,moldSignatureRequired,moldSigner,MOLD_LIMITS,MOLD_PAYMENT_REQUIRED,MOLD_PRODUCTION_ONLY,MOLD_PRODUCTION_ONLY_TEXT,MOLD_SIGNATURE_BAD,MOLD_SIGNATURE_REQUIRED,MOLD_SIGNER_MAX,MOLD_SIGNER_MIN,MOLD_SIGNER_REQUIRED} from '@/portable/mold-rules.mjs';
import {callProducts} from '@/portable/mold-client.mjs';
import {canApproveMoldRequests,canCreateMoldRequest,canReadMoldRequest,canUseMoldRequests,moldApprovalWaitsFor,moldApprovesRequest,moldDesignCount,moldDesignMayBeRemote,moldDesignRefused,moldDesignStopped,moldEditable,moldErrorText,moldHeldFor,moldNeverSent,moldPermissions,moldPendingForOldPage,moldRequestView,moldSignatureOf,yourrestNumber,MOLD_SAME_REASON_TEXT,type MoldPayment,type MoldRequestData,type MoldRequestsAnswer} from '@/lib/mold-requests';
import {regionScope} from '@/lib/regions';
import {isServiceRole} from '@/lib/customer-service';
import {canOpenMoldRequest,forgetPendingApprovals,keepMoldRetrying,loadMoldDesignFiles,loadMoldRequest,loadMoldRequests,moldCancelReasons,moldDesignFilesByRequest,moldPendingFor as pendingFor,moldRequestRefKnown,moldQuotePoSupported,moldViewReasons,noteMoldQuotePo,productsLink,pullMoldStatuses,requestedNow,sendDueMoldRequests,sendMoldDesignFile,sendMoldRequest,sendDueMoldDesignFiles,storeMoldRemote,MOLD_DESIGN_REFUSED_SQL,MOLD_DESIGN_STOPPED_SQL,MOLD_NEVER_SENT_SQL,type SendOutcome} from '@/lib/mold-requests-server';
export const dynamic='force-dynamic';

const reader=async()=>{const c=await context({load:'customers'});if(!canUseMoldRequests(c.me.role))throw new CRMError('طلبات تصنيع القوالب غير متاحة لهذا الدور',403);return c;};
/** The customers a member may ask a mold for: their own scope, or for customer service the customers of their branch in their regions
 * (the same ones their visits page lists, lib/customer-service.ts serviceVisitRecords). */
const askable=(c:Awaited<ReturnType<typeof reader>>,customerId:string)=>isServiceRole(c.me.role)
 ?c.regionalRecords.find(row=>row.id===customerId&&row.kind==='customer'&&row.branch===c.me.branch)
 :c.visible.find(row=>row.id===customerId&&row.kind==='customer');

/** The requests the reader may see, with their status pulled once (one call for all of them, or for the one asked for by ?id=), each
 * with its design files (the CRM's and production's). quotePo: production's update of 2026-11-03 is known to be live (learned from any
 * answer, this page's pulls included), so the form asks for the quotation's or PO's file (one at least, 2026-11-05; no number). The list is the reader's own
 * (canReadMoldRequest: the sales manager's and their team's for a sales manager); ?id= also opens, for the sales manager, a request
 * «طلبات بانتظار اعتمادي» shows them now without their list doing so (canOpenMoldRequest: customer service's, say). refs=1: this
 * release's page, which names a pending item by its requestRef or crmRequestId; without it (a page loaded before) the waiting list keeps
 * the items production has numbered only (moldPendingForOldPage). */
export async function GET(req:Request){try{
 const c=await reader(),link=productsLink(),url=new URL(req.url),id=url.searchParams.get('id'),refs=url.searchParams.get('refs')==='1';
 keepMoldRetrying();void sendDueMoldRequests(c.db,{link}).catch(()=>{});
 const one=id?await loadMoldRequest(c.db,id):null;
 const rows=id?(one&&await canOpenMoldRequest(one,c,link)?[one]:[]):(await loadMoldRequests(c.db)).filter(row=>canReadMoldRequest(row,c));
 if(id&&!rows.length)throw new CRMError('الطلب غير متاح',404);
 const statusError=await pullMoldStatuses(c.db,rows,{link}),files=await moldDesignFilesByRequest(c.db,rows.map(row=>row.id)),reasons=await moldViewReasons(c.db,rows,c.me);
 const listed=id?null:await pendingFor(c,link),pending=refs?listed:moldPendingForOldPage(listed),quotePo=await moldQuotePoSupported(c.db);
 const answer:MoldRequestsAnswer={generatedAt:new Date().toISOString(),linkReady:link.ok,linkProblem:link.ok?'':link.reason,requests:rows.map(row=>moldRequestView(row,c.me,c.members,link.ok,files.get(row.id),reasons.get(row.id),quotePo,moldApprovesRequest(row,c))),statusError,canCreate:canCreateMoldRequest(c.me),pending,quotePo,signatureRequired:moldSignatureRequired(c.me.role)};
 return Response.json(answer,{headers:{'Cache-Control':'no-store'}});
}catch(e){return replyError(e);}}

const requestId=z.string().uuid(),id=z.string().regex(/^mr-[0-9a-f-]{36}$/),version=z.number().int().positive();
const specsInput=z.record(z.string(),z.unknown()),paymentInput=z.unknown().optional(),numberInput=z.unknown().optional();
/** The customer's signature (2026-11-04): {signer, png} with the PNG as base64, checked by readSignature (each refusal by its field). */
const signatureInput=z.unknown().optional();
const pendingTarget={requestId,crmRequestId:z.string().regex(MOLD_ID,'حدد الطلب').optional(),requestRef:z.string().regex(MOLD_REQUEST_REF,'مرجع الطلب غير صحيح؛ حدّث الصفحة.').optional(),orderNo:z.number().int().positive().nullable().optional(),
 // This release's page marks its approval (as its GET asks with refs=1): it names an item by number only when production gave it no
 // requestRef, so its number is checked against production's list as it is now, never refused for being a number.
 page:z.literal('refs').optional()};
const schema=z.discriminatedUnion('action',[
 // payment (2026-11-03): cash or deferred, required (checkedRequest says so with the field's own message). quoteNo and poNo (the second
 // update of 2026-11-03) are no longer asked for (2026-11-05): read only to refuse one a page loaded before sends (checkedRequest).
 // signature (2026-11-04): the customer's, required of the sales roles for a new request and for an edit that changes what was signed.
 z.object({action:z.literal('create'),requestId,customerId:z.string().min(1).max(200),specs:specsInput,payment:paymentInput,quoteNo:numberInput,poNo:numberInput,signature:signatureInput}).strict(),
 z.object({action:z.literal('update'),requestId,id,version,specs:specsInput,payment:paymentInput,quoteNo:numberInput,poNo:numberInput,signature:signatureInput}).strict(),
 z.object({action:z.literal('cancel'),requestId,id,version,reason:z.string().trim().max(MOLD_LIMITS.cancelReason,'سبب الإلغاء حتى 500 حرف').default('')}).strict(),
 z.object({action:z.literal('resend'),requestId,id}).strict(),
 z.object({action:z.literal('approve'),requestId,id}).strict(),
 z.object({action:z.literal('withdraw'),requestId,id}).strict(),
 // The sales manager's waiting list names a request as moldPendingTarget does (lib/mold-requests.ts): the CRM's own by its crmRequestId,
 // one registered in production by its requestRef (the products update of 2026-11-05, the second of the day), and only one of the
 // application before that update (no requestRef) by its order number; one of them only. A page loaded before this release names every
 // item by its order number, null for an item production has not numbered yet: refused with ORDER_PAGE_OUTDATED.
 z.object({action:z.literal('approve-order'),...pendingTarget}).strict(),
 z.object({action:z.literal('withdraw-order'),...pendingTarget}).strict(),
]);
const labels={create:'طلب تصنيع قالب',update:'تعديل طلب تصنيع قالب',cancel:'إلغاء طلب تصنيع قالب',resend:'إعادة إرسال طلب تصنيع قالب',approve:'اعتماد مدير المبيعات لطلب تصنيع قالب',withdraw:'سحب اعتماد مدير المبيعات لطلب تصنيع قالب','approve-order':'اعتماد مدير المبيعات لطلب تصنيع قالب','withdraw-order':'سحب اعتماد مدير المبيعات لطلب تصنيع قالب'};
/** A sent request's data is edited by the production manager in the products application only (yourrest-products, 2026-11-02): the
 *  CRM's update is refused, and a change production still refuses as production_only is final. Each text has its English pair in
 *  lib/locales/en.json; the request's sheet says which specifications it shows. */
const PRODUCTION_ONLY=MOLD_PRODUCTION_ONLY_TEXT[0]+'؛ الطلب أُرسل للإنتاج، فتعديله من تطبيق المنتجات.';
const PRODUCTION_ONLY_SENT=MOLD_PRODUCTION_ONLY_TEXT[0]+'؛ التعديل لم يصل للإنتاج ولن يُعاد إرساله.';
/** The quotation and PO numbers are no longer asked for (production's update of 2026-11-05: the file counts). A page loaded before
 *  this release still shows the two fields: a number it sends that is not the request's own (any, for a new request) is refused, so
 *  nothing typed is dropped silently and no stored request changes; the request's own numbers, sent back unchanged, are kept as stored.
 *  Its English pair is in lib/locales/en.json. */
const QUOTE_PO_GONE='رقم عرض السعر ورقم الـ PO اتشالوا من الطلب؛ حدّث الصفحة وأرفق ملف عرض السعر أو الـ PO بدالهم.';
/** The products update of 2026-11-05 (the second): a request has no order number until production approves it, and the numbers from
 *  101 up move down by one once, so an order number no longer names a request. A page loaded before this release still does (its item
 *  without a number sends null): it is asked to reload, never answered on a number. Its English pair is in lib/locales/en.json. */
const ORDER_PAGE_OUTDATED='الطلبات بقت بتتعرّف بمرجعها مش برقم الأمر؛ حدّث الصفحة واعتمد من جديد.';
/** A request named by its number while production's list (or the status of the CRM's request holding that number) could not be read
 *  just now: the number is never resolved against an older copy (it may have moved since). Its English pair is in lib/locales/en.json. */
const ORDER_UNSURE='تعذّر التأكد من الطلب الآن؛ حدّث الصفحة وحاول مرة أخرى.';
/** Production refused how the approval named the request (400 naming requestRef). */
const APPROVAL_TARGET_REFUSED='تطبيق الإنتاج لم يقبل تعريف الطلب؛ حدّث الصفحة وحاول مرة أخرى.';
/** A resend of a request kept for its quotation or PO file (2026-11-05): nothing to resend; attaching the file sends it. */
const QUOTE_FILE_FIRST='الطلب بانتظار ملف عرض السعر / الـ PO؛ أرفق الملف ويتبعت الطلب لوحده.';
/** The same for a request kept for its design file (2026-11-08). Its English pair is in lib/locales/en.json. */
const DESIGN_FILE_FIRST='الطلب بانتظار ملف التصميم؛ أرفق ملف تصميم ويتبعت الطلب لوحده.';
/** A refusal of production's for what was sent: a cancellation it refused (cancelled there, or the approvals or production came first),
 *  or the request's data refused as locked for another reason. */
const CANCELLED_THERE='أُلغي الطلب في تطبيق الإنتاج؛ لم يعد التعديل أو الإلغاء ممكنًا.';
const CANCEL_LOCKED='اكتملت الاعتمادات أو بدأ الإنتاج قبل وصول الإلغاء؛ لم يعد الإلغاء ممكنًا.';
const SEND_LOCKED='رفض الإنتاج الإرسال لأن الطلب مقفل لديه؛ لن يُعاد إرساله.';
/** A cancellation with the reason of an earlier one the production manager undid (2026-11-03): production would answer it with the
 *  request as it is, so it is refused here before sending. */
const SAME_REASON=MOLD_SAME_REASON_TEXT[0];
/** The same, once the request may no longer be cancelled (restored, then the approvals completed or production started): no new reason
 *  would help, so none is asked for. */
const RESTORED_LOCKED='رجّعه مدير الإنتاج بعد الإلغاء، واكتملت الاعتمادات أو بدأ الإنتاج؛ لم يعد الإلغاء ممكنًا.';
/** «رابط التصميم» is no longer asked for (the owner, 2026-11-03): a link from a page loaded before (which still shows the field), for a
 *  new request or one changed or added by an edit, is refused, so nothing typed is dropped silently. Its English pair is in
 *  lib/locales/en.json. */
const DESIGN_URL_GONE='رابط التصميم اتلغى من الطلب؛ حدّث الصفحة، وأرفق التصميم كملف.';
/** The specifications and the payment (cash or deferred, 2026-11-03) of a new request or of an edit before the first send; every wrong
 *  field named at once. The quotation and PO numbers are no longer taken (2026-11-05): the request keeps its own as stored (none for a
 *  new request), and a number sent that is not that one (a page loaded before this release) is refused by its field (QUOTE_PO_GONE); not
 *  sent at all (this release's form), the stored ones stay. designUrl: the request's own design link, kept as stored ('' for a new
 *  request, so it carries none and sends none); the form sends none, and a link it sends that is not that one is refused (DESIGN_URL_GONE). */
function checkedRequest(input:Record<string,unknown>,paymentValue:unknown,numbers:{quoteNo?:unknown;poNo?:unknown},stored:{quoteNo?:string;poNo?:string},designUrl='',more:Record<string,string>={}){
 const {specs,errors}=validateMoldSpecs(input),payment=moldPayment(paymentValue) as MoldPayment|null;
 const typedUrl=errors.designUrl!==undefined||specs.designUrl!==''&&specs.designUrl!==designUrl;
 delete errors.designUrl;specs.designUrl=designUrl;
 const typedNumbers=Object.fromEntries((['quoteNo','poNo'] as const).filter(key=>numbers[key]!==undefined&&moldQuotePoNumber(numbers[key])!==(stored[key]||'')).map(key=>[key,QUOTE_PO_GONE]));
 const fields:Record<string,string>={...errors,...(typedUrl?{designUrl:DESIGN_URL_GONE}:{}),...(payment?{}:{payment:MOLD_PAYMENT_REQUIRED}),...typedNumbers,...more};
 if(Object.keys(fields).length)throw Object.assign(new CRMError([...new Set(Object.values(fields))].join(' • '),400),{fields});
 return {specs:specs as MoldRequestData['specs'],payment:payment as MoldPayment};
}
/** The customer's signature as checked (moldSignatureCheck): who signed, the file's name, the PNG and its hash. */
type SignatureFile={signer:string;name:string;bytes:Uint8Array<ArrayBuffer>;contentType:string;sha256:string};
const sha256=async(bytes:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
/** The signature a create or an edit carries (2026-11-04): none (absent, or null), or {signer, png} checked as production checks a design
 *  image (a real PNG of at most 256 KiB and 1200 pixels a side), each refusal by its field: signer (2 to 80 characters), signature. */
async function readSignature(value:unknown):Promise<{signature:SignatureFile|null;fields:Record<string,string>}>{
 if(value===undefined||value===null)return {signature:null,fields:{}};
 const source=typeof value==='object'&&!Array.isArray(value)?value as {signer?:unknown;png?:unknown}:{};
 const signer=moldSigner(source.signer),named=signer!==undefined&&[...signer].length>=MOLD_SIGNER_MIN&&[...signer].length<=MOLD_SIGNER_MAX;
 const bytes=moldSignatureBytes(source.png),checked=moldSignatureCheck(named?signer:'--',bytes);
 const fields:Record<string,string>={...(named?{}:{signer:MOLD_SIGNER_REQUIRED}),...(!checked.ok&&checked.field==='signature'?{signature:checked.reason==='missing'&&!source.png?MOLD_SIGNATURE_REQUIRED:MOLD_SIGNATURE_BAD}:{})};
 if(Object.keys(fields).length||!checked.ok||!bytes)return {signature:null,fields};
 const file=new Uint8Array(bytes);
 return {signature:{signer:checked.signer,name:checked.name,bytes:file,contentType:checked.contentType,sha256:await sha256(file)},fields:{}};
}
/** The receipt of a write: the request as sent, with the signature's PNG as its hash (an audit entry never holds a file's contents). */
async function receiptOf(input:Record<string,unknown>){
 const signature=input.signature as {signer?:unknown;png?:unknown}|null|undefined;
 if(!signature||typeof signature!=='object')return JSON.stringify(input);
 return JSON.stringify({...input,signature:{signer:signature.signer,png:typeof signature.png==='string'?await sha256(new TextEncoder().encode(signature.png)):signature.png}});
}
/** A sales role's write with no signature at all: most likely a page loaded before the signature (2026-11-04), which shows no pad, so the
 *  refusal says to refresh. Its English pair is in lib/locales/en.json. */
const SIGNATURE_REFRESH=MOLD_SIGNATURE_REQUIRED+'؛ حدّث الصفحة لو مش ظاهر مكان التوقيع.';
/** The specifications as compared for «nothing changed»: validated (normalized as stored) and their keys in one order, so an older row
 *  stored with its keys in another order (or a field written loosely) is not taken as changed. The request's own design link as stored. */
const specsKey=(value:Record<string,unknown>,designUrl:string)=>{const {specs}=validateMoldSpecs(value),out:Record<string,unknown>={...specs,designUrl};return JSON.stringify(Object.keys(out).sort().map(key=>[key,out[key]]));};
/** An edit needing a new signature where the request's 10 design files leave no place for it. Its English pair is in lib/locales/en.json. */
const SIGNATURE_NO_ROOM='الطلب فيه 10 ملفات تصميم؛ احذف ملف عشان يتسع لتوقيع العميل.';
/** How long the answer waits for the signature to reach production once the request has; the send itself goes on (up to 120 seconds). */
const SIGNATURE_WAIT_MS=15_000;

/**
 * create, update, cancel, resend. The change is saved in the CRM first (with its audit entry, as a receipt that makes a repeated
 * tap harmless), then sent; the answer carries the request as it now stands and what the send gave. update only while the request has
 * certainly never reached production (moldNeverSent; MOLD_NEVER_SENT_SQL guards the save): once sent, 409 with production_only's text.
 * approve, withdraw (the sales manager): production's approval route is called first, and only its answer is saved, with the receipt.
 */
export async function POST(req:Request){let objectKey='';try{
 checkOrigin(req);await requireSession();
 // The role is checked before the body is read: customer service is refused (403) whatever it sends.
 const c=await reader(),input=schema.parse(await readJsonBody(req)),now=new Date().toISOString(),mutation=crypto.randomUUID(),link=productsLink();keepMoldRetrying();
 const canonical=await receiptOf(input),receiptId='mold-request-receipt:'+c.me.id+':'+input.requestId;
 /** The request as it now stands, with what the send gave; a 409 (the CRM's refusal, given as `refusal`, or production's) carries the
  * request too, so the screen follows the server's rule at once. */
 const answer=async(rowId:string,outcome:SendOutcome|null,status=200,refusal='')=>{
  const row=await loadMoldRequest(c.db,rowId);
  if(!row)throw new CRMError('الطلب غير متاح',404);
  // Read again: the send's own answer may just have taught the CRM that production's update is live.
  const known=await moldQuotePoSupported(c.db);
  // 409 from production: the change is withdrawn, the request shows production's status, and the reason is the one production gave.
  // A cancellation production answered with the request not cancelled (restored, this reason used): a new reason is needed, while it
  // may still be cancelled.
  const refused=refusal||(outcome?.kind==='restored'?(moldEditable(row)?SAME_REASON:RESTORED_LOCKED):outcome?.reason===MOLD_PRODUCTION_ONLY?PRODUCTION_ONLY_SENT:row.remote?.status==='cancelled'?CANCELLED_THERE:outcome?.sent==='cancel'?CANCEL_LOCKED:SEND_LOCKED);
  return Response.json({ok:status<400,request:moldRequestView(row,c.me,c.members,link.ok,await loadMoldDesignFiles(c.db,'request_id=?',[row.id]),(await moldViewReasons(c.db,[row],c.me)).get(row.id),known,moldApprovesRequest(row,c)),send:outcome?{kind:outcome.kind,code:outcome.code,fields:outcome.fields||[]}:null,quotePo:known,...(status===409?{error:refused}:{})},{status});
 };
 /** The request as it now stands, as its reader receives it (an approval's answer). */
 const answerView=async(rowId:string)=>{const row=(await loadMoldRequest(c.db,rowId))!;return moldRequestView(row,c.me,c.members,link.ok,await loadMoldDesignFiles(c.db,'request_id=?',[row.id]),(await moldViewReasons(c.db,[row],c.me)).get(row.id),await moldQuotePoSupported(c.db),moldApprovesRequest(row,c));};
 const replay=async()=>{
  const saved=await c.db.prepare('SELECT record_id,detail FROM crm_audit WHERE id=?').bind(receiptId).first<{record_id:string;detail:string}>();
  if(!saved)return null;
  if(saved.detail!==canonical)throw new CRMError('العملية محفوظة ببيانات مختلفة. حدّث الصفحة.',409);
  return answer(saved.record_id,null);
 };
 if(input.action==='approve-order'||input.action==='withdraw-order'){
  if(!canApproveMoldRequests(c.me))throw new CRMError('اعتماد طلبات القوالب لمدير المبيعات',403);
  const approving=input.action==='approve-order',byNumber=input.orderNo!==undefined,orderNo=input.orderNo??null,ref=input.requestRef??null;
  if([input.crmRequestId,input.requestRef,input.orderNo].filter(value=>value!==undefined).length!==1)throw new CRMError('حدد الطلب',400);
  // A page loaded before this release (it names items by number) reads the list as it always did (moldPendingForOldPage).
  const listFor=async()=>{const list=await pendingFor(c,link);return byNumber?moldPendingForOldPage(list):list;};
  const saved=await c.db.prepare('SELECT detail FROM crm_audit WHERE id=?').bind(receiptId).first<{detail:string}>();
  if(saved){if(saved.detail!==canonical)throw new CRMError('العملية محفوظة ببيانات مختلفة. حدّث الصفحة.',409);return Response.json({ok:true,status:null,pending:await listFor()});}
  if(!link.ok)throw new CRMError('الربط مع الإنتاج غير مفعَّل',503);
  // The CRM's own request goes by its crmRequestId, with the CRM's own checks: one this manager approves (moldApprovesRequest, as
  // «طلبات بانتظار اعتمادي» lists it). One registered in production goes by its requestRef, approved only while production still lists it
  // as waiting within the manager's regions; a requestRef the CRM's own request holds goes as that request. An order number names a
  // request only as production answers now (its list and the holder's status pulled here, never an older copy): the CRM's own whose
  // status still holds it without a requestRef, or one registered in production listed with it and no requestRef. A page loaded before
  // this release (no page 'refs') is refused once the update of 2026-11-05 is known; this release's page names by number only an item
  // production gave no requestRef (the application before it, rolled back, or an item answered without one), so it is checked, not refused.
  let own=null,listed=null;
  if(byNumber){
   if(orderNo===null)throw new CRMError(ORDER_PAGE_OUTDATED,409);
   // The number is read against production as it answers now: its list asked for again (never the copy kept from before a failed
   // call), and the status of the CRM's request holding that number (or, without one, of the latest the CRM holds) pulled again. Both
   // also teach the CRM the products update, should it be live since.
   const fresh=await pendingFor(c,link,{force:true});
   if(!fresh||fresh.error)throw new CRMError(ORDER_UNSURE,409);
   const holder=(await loadMoldRequests(c.db,"json_extract(remote,'$.orderNo')=?",[orderNo]))[0],probe=holder||(await loadMoldRequests(c.db,'remote IS NOT NULL'))[0];
   if(probe&&await pullMoldStatuses(c.db,[probe],{link,force:true}))throw new CRMError(ORDER_UNSURE,409);
   // A page loaded before this release, once the update is known: refused whatever the number (it may name another request now).
   if(input.page!=='refs'&&await moldRequestRefKnown(c.db))throw new CRMError(ORDER_PAGE_OUTDATED,409);
   // The CRM's own request holds that number only if its status pulled just now still says so, without a requestRef.
   if(holder&&(holder.remote?.orderNo!==orderNo||holder.remote?.requestRef))throw new CRMError(ORDER_PAGE_OUTDATED,409);
   own=holder||null;
   if(!own&&approving){
    listed=fresh.items.find(item=>item.orderNo===orderNo&&!item.crmRequestId);
    if(!listed)throw new CRMError('الطلب لم يعد بانتظار اعتمادك. حدّث الصفحة.',409);
    // Production names it by its requestRef now: the page's number is from an older list.
    if(listed.requestRef)throw new CRMError(ORDER_PAGE_OUTDATED,409);
   }else if(!own&&(fresh.items.some(item=>item.requestRef)||probe?.remote?.requestRef))throw new CRMError(ORDER_PAGE_OUTDATED,409);
  }else if(input.crmRequestId!==undefined){
   own=await loadMoldRequest(c.db,input.crmRequestId);
   if(!own)throw new CRMError('الطلب غير متاح',404);
  }else{
   own=(await loadMoldRequests(c.db,"json_extract(remote,'$.requestRef')=?",[ref!]))[0];
   if(!own&&approving){listed=(await pendingFor(c,link,{force:true}))!.items.find(item=>item.requestRef===ref&&!item.crmRequestId);if(!listed)throw new CRMError('الطلب لم يعد بانتظار اعتمادك. حدّث الصفحة.',409);}
  }
  if(own){
   if(!moldApprovesRequest(own,c))throw new CRMError('الطلب غير متاح',404);
   // A design file on its way undoes the approvals when it arrives; a quotation's or PO's no longer does (2026-11-05).
   const filesOnTheWay=(await loadMoldDesignFiles(c.db,'request_id=?',[own.id])).some(moldApprovalWaitsFor);
   if(own.cancelledAt||own.outbox||filesOnTheWay)throw new CRMError(own.cancelledAt?'الطلب ملغى':'في تغيير على الطلب لسه ما وصلش للإنتاج؛ استنى لما يوصل',409);
  }else if(!approving&&regionScope(c.me)!=='all')throw new CRMError('سحب اعتماد طلب مسجّل في الإنتاج لمدير مبيعات كل المناطق',403);
  const by={name:c.me.name,email:c.me.email},action=approving?'approve':'withdraw';
  const call=await callProducts(link,'approval',moldApprovalBody(own?{id:own.id,action,by}:ref?{requestRef:ref,action,by}:{orderNo,action,by}));
  const status=call.kind==='ok'?moldStatusObject(call.json?.request,{manual:!own}):call.kind==='locked'?call.request:null,at=new Date().toISOString();
  if(own&&status)await storeMoldRemote(c.db,own.id,status,at);
  else await noteMoldQuotePo(c.db,[status],at);
  forgetPendingApprovals();
  if(call.kind==='locked')return Response.json({ok:false,status,pending:await listFor(),error:moldApprovalRefusal(status,approving)},{status:409});
  // 404: production holds no request by that name: said, refresh.
  // 400 naming requestRef: production does not take that name; any other 400 as before (its data refused).
  if(call.kind==='rejected'&&call.fields.includes('requestRef'))throw new CRMError(APPROVAL_TARGET_REFUSED,409);
  if(call.kind!=='ok'||!status)throw new CRMError(call.kind==='not_found'?'الطلب غير موجود لدى الإنتاج؛ حدّث الصفحة.':moldErrorText(call.code,ar=>ar)+'. حاول مرة أخرى.',call.kind==='not_found'?409:502);
  // The audit names a request registered in production by its requestRef (mold-ref:), by its number only in the application before
  // (mold-order:, as older entries do); the number recorded is the one production answered with (none yet, before its approval).
  const named=ref||status.requestRef||null,recordId=own?.id||(named?'mold-ref:'+named:'mold-order:'+orderNo);
  const detail={label:labels[input.action],customerName:own?.data.customer.name||listed?.customer.name||'',orderNo:status.orderNo??orderNo,...(named?{requestRef:named}:{}),source:own?'crm':'manual',waitingStep:status.waitingStep};
  await c.db.batch([
   c.db.prepare('INSERT OR IGNORE INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(receiptId,recordId,c.me.name,'mold-request-receipt',canonical,at),
   c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),recordId,c.me.name,'mold-request:'+(approving?'approve':'withdraw'),JSON.stringify(detail),at),
  ]);
  return Response.json({ok:true,status,request:own?await answerView(own.id):null,pending:await listFor()});
 }
 const repeated=await replay();if(repeated)return repeated;
 // Production's update of 2026-11-03 known to be live: a new request needs its quotation's or PO's file (2026-11-05) and is kept until
 // one is attached (data.fileRequired); before it, a request goes as it always did. Every new request needs a design file too
 // (2026-11-08, data.designRequired, whatever is known of production: design files go to it since 2026-11-02).
 const permission=accessGuard(c),quotePo=await moldQuotePoSupported(c.db);
 let rowId:string,statement,restart:D1PreparedStatement|null=null,detail:Record<string,unknown>;
 // The customer's signature (2026-11-04): its file's row, saved in the same batch as the request (never a request without it), its bytes
 // put in the object store first; an old signature the edit replaces, removed in the CRM alone when production never held it.
 let signing:{file:SignatureFile;id:string}|null=null,replaced:{key:string|null;at:number}|null=null;
 const signatureRows:D1PreparedStatement[]=[];
 const signatureRow=(file:SignatureFile,fileId:string,requestRow:string)=>c.db.prepare(`INSERT INTO crm_mold_design_files(id,request_id,member_id,name,kind,content_type,size,sha256,object_key,created_at,outbox,next_attempt_at,version,mutation_id,category)
  SELECT ?,?,?,?,'image',?,?,?,?,?,'send',?,1,?,'design' WHERE EXISTS(SELECT 1 FROM crm_mold_requests WHERE id=? AND mutation_id=?)`).bind(fileId,requestRow,c.me.id,file.name,file.contentType,file.bytes.length,file.sha256,objectKey,now,now,mutation,requestRow,mutation);
 if(input.action==='create'){
  if(!canCreateMoldRequest(c.me))throw new CRMError('طلبات تصنيع القوالب غير متاحة لهذا الدور',403);
  const customer=askable(c,input.customerId);
  if(!customer)throw new CRMError('اختر عميلًا من العملاء المتاحين لك',404);
  const crmNumber=yourrestNumber(customer.data.internalCode);
  if(!crmNumber)throw new CRMError('كود يورست للعميل غير متاح. حدّث الصفحة.',409);
  const name=String(customer.data.name||'').trim();
  if(!name||[...name].length>MOLD_LIMITS.customerName)throw new CRMError('اسم العميل أطول من '+MOLD_LIMITS.customerName+' حرفًا؛ اختصره من صفحة العميل أولًا',409);
  // The sales roles' new request carries the customer's signature (2026-11-04); customer service's and the administrator's may, checked alike.
  const signed=await readSignature(input.signature),required:Record<string,string>=moldSignatureRequired(c.me.role)&&!signed.signature&&!Object.keys(signed.fields).length?{signature:input.signature===undefined?SIGNATURE_REFRESH:MOLD_SIGNATURE_REQUIRED}:{};
  const asked=checkedRequest(input.specs,input.payment,input,{},'',{...signed.fields,...required});
  rowId='mr-'+input.requestId;
  if(signed.signature)signing={file:signed.signature,id:'mds-'+input.requestId};
  // No number (2026-11-05). Once production's update is known, the request waits in the CRM for its quotation's or PO's file, whoever
  // asked (the owner: every role); and always for its design file (2026-11-08, every role: «إجباري على الكل»). The markers are the
  // request's data, never part of the requests body.
  const data:MoldRequestData={requestedAt:requestedNow(now),customer:{crmNumber,name,address:String(customer.data.address||''),city:moldRequestCity(customer.data.city)},salesman:{crmMemberId:c.me.id,name:c.me.name,email:c.me.email},specs:asked.specs,payment:asked.payment,...(quotePo?{fileRequired:true as const}:{}),designRequired:true};
  if(signing)data.signature={signer:signing.file.signer,signedAt:now,fileId:signing.id};
  detail={label:labels.create,customerName:name,description:data.specs.description,quantity:data.specs.quantity,payment:data.payment,...(data.fileRequired?{fileRequired:true}:{}),designRequired:true,...(signing?{signature:{signer:signing.file.signer,fileId:signing.id,size:signing.file.bytes.length}}:{})};
  statement=c.db.prepare(`INSERT INTO crm_mold_requests(id,member_id,customer_id,data,outbox,next_attempt_at,created_by,created_at,updated_at,version,mutation_id) SELECT ?,?,?,?,'send',?,?,?,?,1,? WHERE ${permission.sql} AND EXISTS(SELECT 1 FROM crm_records WHERE id=? AND kind='customer' AND version=?)`)
   .bind(rowId,c.me.id,customer.id,JSON.stringify(data),now,c.me.id,now,now,mutation,...permission.args,customer.id,customer.version);
 }else{
  const row=await loadMoldRequest(c.db,input.id),approval=input.action==='approve'||input.action==='withdraw';
  // A sales manager approves, or withdraws, exactly the requests «طلبات بانتظار اعتمادي» lists for them (moldApprovesRequest: customer
  // service's too, which their list does not show); anyone else reaches only what they may read (and is refused below).
  if(!row||!(approval&&canApproveMoldRequests(c.me)?moldApprovesRequest(row,c):canReadMoldRequest(row,c)))throw new CRMError('الطلب غير متاح',404);
  const files=await loadMoldDesignFiles(c.db,'request_id=?',[row.id]),allowed=moldPermissions(row,c.me,files,moldApprovesRequest(row,c));rowId=row.id;
  if(approval){
   const approving=input.action==='approve';
   if(!canApproveMoldRequests(c.me))throw new CRMError('اعتماد طلبات القوالب لمدير المبيعات',403);
   if(approving?!allowed.approve:!allowed.withdraw)throw new CRMError(row.cancelledAt?'الطلب ملغى':row.outbox||files.some(moldApprovalWaitsFor)?'في تغيير على الطلب لسه ما وصلش للإنتاج؛ استنى لما يوصل':approving?'الطلب مش بانتظار اعتماد مدير المبيعات. حدّث الصفحة.':'لا يوجد اعتماد يمكن سحبه. حدّث الصفحة.',409);
   if(!link.ok)throw new CRMError('الربط مع الإنتاج غير مفعَّل',503);
   const call=await callProducts(link,'approval',moldApprovalBody({id:row.id,action:input.action,by:{name:c.me.name,email:c.me.email}}));
   const remote=call.kind==='ok'?moldStatusObject(call.json?.request):call.kind==='locked'?call.request:null,at=new Date().toISOString();
   if(remote)await storeMoldRemote(c.db,row.id,remote,at);
   forgetPendingApprovals();
   if(call.kind==='locked')return Response.json({ok:false,request:await answerView(row.id),error:moldApprovalRefusal(remote,approving)},{status:409});
   if(call.kind!=='ok'||!remote)throw new CRMError(call.kind==='not_found'?'الطلب غير موجود لدى الإنتاج':moldErrorText(call.code,ar=>ar)+'. حاول مرة أخرى.',call.kind==='not_found'?409:502);
   const gate='EXISTS(SELECT 1 FROM crm_mold_requests WHERE id=?)',detail={label:labels[input.action],customerName:row.data.customer.name,orderNo:remote.orderNo,waitingStep:remote.waitingStep};
   await c.db.batch([
    c.db.prepare(`INSERT OR IGNORE INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(receiptId,row.id,c.me.name,'mold-request-receipt',canonical,at,row.id),
    c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(crypto.randomUUID(),row.id,c.me.name,'mold-request:'+input.action,JSON.stringify(detail),at,row.id),
   ]);
   return answer(row.id,null);
  }
  // Sent (or perhaps sent): the production manager edits it in the products application; the CRM no longer does, whatever copy the
  // screen held. The refusal carries the request as it stands, so the screen drops its edit at once.
  if(input.action==='update'&&!allowed.edit){
   if(row.memberId!==c.me.id)throw new CRMError('تعديل الطلب لمن طلبه',403);
   return answer(row.id,null,409,row.cancelledAt?'الطلب ملغى':row.remote?.status==='cancelled'?CANCELLED_THERE:PRODUCTION_ONLY);
  }
  if(input.action!=='resend'&&input.version!==row.version)throw new CRMError('تغيّر الطلب. حدّث الصفحة.',409);
  const guard=`id=? AND version=? AND member_id=? AND ${permission.sql}`,guardArgs=[row.id,row.version,c.me.id,...permission.args];
  if(input.action==='update'){
   // The request's own design link (an older request's) stays exactly as stored.
   const signed=await readSignature(input.signature);
   const {specs,payment}=checkedRequest(input.specs,input.payment,input,row.data,row.data.specs.designUrl||'',signed.fields);
   // The request's numbers (one asked for before 2026-11-05) and whether it waits for its quotation's, PO's or design file stay as stored.
   const edited:MoldRequestData={...row.data,specs,payment};
   // An edit that changes nothing keeps the request as it is, its signature too (a signature sent with it is not taken).
   if(specsKey(specs,specs.designUrl||'')===specsKey(row.data.specs,row.data.specs.designUrl||'')&&payment===row.data.payment)return answer(row.id,null);
   // What the customer signed changed (2026-11-04): a sales role signs again. The new signature replaces the old in the data; the old file
   // is removed in the CRM alone when production never held it (else it stays as a design file). Without a new one the data names none.
   // A request the customer signed is never sent changed without a new signature, whatever the editor's role is now.
   const old=moldSignatureOf(row.data),oldFile=old?files.find(file=>file.id===old.fileId&&!file.deletedAt):undefined,removable=!!oldFile&&!moldDesignMayBeRemote(oldFile);
   if((moldSignatureRequired(c.me.role)||old)&&!signed.signature){const text=input.signature===undefined?SIGNATURE_REFRESH:MOLD_SIGNATURE_REQUIRED;throw Object.assign(new CRMError(text,400),{fields:{signature:text}});}
   if(signed.signature){
    // The old signature frees its place only when it takes one (a file refused for good takes none: moldDesignCount leaves it out).
    const places=moldDesignCount(row,files,'design'),freed=removable&&!!oldFile&&!moldDesignRefused(oldFile)?1:0;
    if(places.crm+places.production-freed+1>places.max)throw new CRMError(SIGNATURE_NO_ROOM,409);
    signing={file:signed.signature,id:'mds-'+input.requestId};
    edited.signature={signer:signing.file.signer,signedAt:now,fileId:signing.id};
   }else delete edited.signature;
   if(oldFile&&removable)replaced={key:oldFile.objectKey,at:0};
   detail={label:labels.update,customerName:row.data.customer.name,description:specs.description,quantity:specs.quantity,payment,...(signing?{signature:{signer:signing.file.signer,fileId:signing.id,size:signing.file.bytes.length}}:{}),...(old?{replacedSignature:old.fileId}:{})};
   // Production never stored any of it, so the edited request starts as never attempted; the guard holds that in SQL, so a send claimed
   // since the check (it may arrive) keeps the request as it is.
   statement=c.db.prepare(`UPDATE crm_mold_requests SET data=?,outbox='send',attempts=0,first_failed_at=NULL,next_attempt_at=?,last_attempt_at=NULL,last_error=NULL,updated_at=?,version=version+1,mutation_id=? WHERE ${guard} AND ${MOLD_NEVER_SENT_SQL}`).bind(JSON.stringify(edited),now,now,mutation,...guardArgs);
   // The old signature, never held by production (never tried, or refused for good): removed in the CRM alone, as the delete route does.
   if(oldFile&&removable)signatureRows.push(c.db.prepare(`UPDATE crm_mold_design_files SET deleted_at=?,outbox=NULL,next_attempt_at=NULL,object_key=NULL,version=version+1 WHERE id=? AND deleted_at IS NULL AND sent_at IS NULL AND (last_attempt_at IS NULL OR ${MOLD_DESIGN_REFUSED_SQL}) AND EXISTS(SELECT 1 FROM crm_mold_requests WHERE id=? AND mutation_id=?)`).bind(now,oldFile.id,row.id,mutation));
  }else if(input.action==='cancel'){
   if(!allowed.cancel)throw new CRMError(row.cancelledAt?'الطلب ملغى من قبل':row.memberId!==c.me.id?'إلغاء الطلب لمن طلبه':'بدأ الإنتاج؛ لم يعد الإلغاء ممكنًا',row.memberId!==c.me.id?403:409);
   // Cancelled before and restored by the production manager (2026-11-03): a reason used already is refused here, not sent.
   if(moldCancelReasonUsed(input.reason,(await moldCancelReasons(c.db,[row.id])).get(row.id)))return answer(row.id,null,409,SAME_REASON);
   detail={label:labels.cancel,customerName:row.data.customer.name,reason:input.reason};
   statement=c.db.prepare(`UPDATE crm_mold_requests SET cancelled_at=?,cancel_reason=?,outbox='cancel',attempts=0,first_failed_at=NULL,next_attempt_at=?,last_error=NULL,updated_at=?,version=version+1,mutation_id=? WHERE ${guard}`).bind(now,input.reason,now,now,mutation,...guardArgs);
  }else{
   // Something the resend would start: the request's own change, or a design file whose sending or deletion stopped (not one refused).
   const waiting=!!row.outbox||files.some(moldDesignStopped);
   // Kept for its quotation's or PO's file (2026-11-05), or its design file (2026-11-08): nothing to resend until one is attached,
   // which sends it.
   const held=!allowed.resend&&row.memberId===c.me.id?moldHeldFor(row,files):null;
   if(held)throw new CRMError(held==='quote_file'?QUOTE_FILE_FIRST:DESIGN_FILE_FIRST,409);
   if(!allowed.resend)throw new CRMError(waiting?'إعادة الإرسال لمن طلبه':'وصل الطلب للإنتاج؛ لا شيء ينتظر الإرسال',waiting?403:409);
   if(!link.ok)throw new CRMError('الربط مع الإنتاج غير مفعَّل. الطلب محفوظ وينتظر الإرسال.',503);
   detail={label:labels.resend,customerName:row.data.customer.name};
   // The request's own change, if any, and its design files whose sending or deletion stopped after 24 hours start the timetable again.
   statement=c.db.prepare(`UPDATE crm_mold_requests SET attempts=CASE WHEN outbox IS NULL THEN attempts ELSE 0 END,first_failed_at=CASE WHEN outbox IS NULL THEN first_failed_at END,next_attempt_at=CASE WHEN outbox IS NULL THEN next_attempt_at ELSE ? END,updated_at=?,mutation_id=?
    WHERE id=? AND member_id=? AND (outbox IS NOT NULL OR EXISTS(SELECT 1 FROM crm_mold_design_files WHERE request_id=? AND ${MOLD_DESIGN_STOPPED_SQL})) AND ${permission.sql}`)
    .bind(now,now,mutation,row.id,c.me.id,row.id,...permission.args);
   restart=c.db.prepare(`UPDATE crm_mold_design_files SET attempts=0,first_failed_at=NULL,next_attempt_at=? WHERE request_id=? AND ${MOLD_DESIGN_STOPPED_SQL} AND EXISTS(SELECT 1 FROM crm_mold_requests WHERE id=? AND mutation_id=?)`)
    .bind(now,row.id,row.id,mutation);
  }
 }
 const gate='EXISTS(SELECT 1 FROM crm_mold_requests WHERE id=? AND mutation_id=?)',ga=[rowId,mutation];
 // The signature's bytes first (each attempt its own object, removed should the save not happen), then its row with the request.
 if(signing){
  if(!env.FILES)throw new CRMError('رفع الملفات غير متاح مؤقتًا.',503);
  objectKey='mold-design/'+rowId+'/'+signing.id+'/'+crypto.randomUUID();
  await env.FILES.put(objectKey,signing.file.bytes,{httpMetadata:{contentType:signing.file.contentType}});
  signatureRows.unshift(signatureRow(signing.file,signing.id,rowId));
 }
 if(replaced)replaced.at=1+(signing?1:0);
 const drop=async()=>{if(objectKey&&env.FILES)await env.FILES.delete(objectKey).catch(()=>{});objectKey='';};
 const result=await c.db.batch([statement,...signatureRows,...(restart?[restart]:[]),
  c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(receiptId,rowId,c.me.name,'mold-request-receipt',canonical,now,...ga),
  c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(crypto.randomUUID(),rowId,c.me.name,'mold-request:'+input.action,JSON.stringify(detail),now,...ga),
 ]).catch(async error=>{await drop();const again=await replay();if(again)return again;throw error;});
 if(result instanceof Response){await drop();return result;}
 if(result[0].meta.changes!==1){
  await drop();
  const again=await replay();if(again)return again;
  // An update stopped by its guard because a send was claimed since the check (it may arrive): refused as a sent request is.
  const current=input.action==='update'?await loadMoldRequest(c.db,rowId):null;
  if(current&&!moldNeverSent(current))return answer(rowId,null,409,PRODUCTION_ONLY);
  throw new CRMError('تغيّرت البيانات أو الصلاحيات أثناء الحفظ. حدّث الصفحة.',409);
 }
 objectKey='';
 // The old signature removed with the edit: its bytes leave the CRM now.
 if(replaced&&result[replaced.at]?.meta.changes===1&&replaced.key&&env.FILES)await env.FILES.delete(replaced.key).catch(()=>{});
 // Saved. Now the send (up to 10 seconds); a failure leaves the request waiting on the timetable.
 const outcome=await sendMoldRequest(c.db,rowId,{link});
 // Then the customer's signature, as a design file, once production holds the request; the answer waits a little for it, and the
 // timetable takes it from there.
 if(signing&&outcome.kind==='ok'&&link.ok){
  let timer:ReturnType<typeof setTimeout>|undefined;
  await Promise.race([sendMoldDesignFile(c.db,signing.id,{link}).catch(()=>null),new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),SIGNATURE_WAIT_MS);})]);
  clearTimeout(timer);
 }
 // A resend also starts the request's design files whose turn has come again (they go in the background, up to 120 seconds each).
 if(input.action==='resend')void sendDueMoldDesignFiles(c.db,{link}).catch(()=>{});
 return answer(rowId,outcome,outcome.kind==='locked'||outcome.kind==='restored'?409:200);
}catch(e){
 if(objectKey&&env.FILES)await env.FILES.delete(objectKey).catch(()=>{});
 if(e instanceof z.ZodError)return Response.json({error:e.issues.map(issue=>issue.message).join(' • ')},{status:400});
 if(e instanceof CRMError&&'fields' in e)return Response.json({error:e.message,fields:(e as CRMError&{fields:Record<string,string>}).fields},{status:e.status});
 return replyError(e);
}}
