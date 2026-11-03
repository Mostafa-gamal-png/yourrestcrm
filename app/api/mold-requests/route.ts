import {z} from 'zod';
import {context,accessGuard,checkOrigin,requireSession,readJsonBody,CRMError,replyError} from '@/lib/crm-server';
import {validateMoldSpecs,validateMoldQuotePo,moldApprovalBody,moldApprovalRefusal,moldCancelReasonUsed,moldPayment,moldQuotePoNumber,moldStatusObject,moldRequestCity,MOLD_LIMITS,MOLD_PAYMENT_REQUIRED,MOLD_PRODUCTION_ONLY,MOLD_PRODUCTION_ONLY_TEXT} from '@/portable/mold-rules.mjs';
import {callProducts} from '@/portable/mold-client.mjs';
import {canApproveMoldRequests,canCreateMoldRequest,canReadMoldRequest,canUseMoldRequests,moldApprovesRequest,moldDesignInFlight,moldDesignStopped,moldEditable,moldErrorText,moldNeverSent,moldPermissions,moldRequestView,yourrestNumber,MOLD_QUOTE_PO_PRODUCTION_ONLY_TEXT,MOLD_SAME_REASON_TEXT,type MoldPayment,type MoldRequestData,type MoldRequestsAnswer} from '@/lib/mold-requests';
import {regionScope} from '@/lib/regions';
import {isServiceRole} from '@/lib/customer-service';
import {canOpenMoldRequest,forgetPendingApprovals,keepMoldRetrying,loadMoldDesignFiles,loadMoldRequest,loadMoldRequests,moldCancelReasons,moldDesignFilesByRequest,moldPendingFor as pendingFor,moldQuotePoSupported,moldViewReasons,noteMoldQuotePo,productsLink,pullMoldStatuses,requestedNow,sendDueMoldRequests,sendMoldRequest,sendDueMoldDesignFiles,storeMoldRemote,MOLD_DESIGN_STOPPED_SQL,MOLD_NEVER_SENT_SQL,type SendOutcome} from '@/lib/mold-requests-server';
export const dynamic='force-dynamic';

const reader=async()=>{const c=await context({load:'customers'});if(!canUseMoldRequests(c.me.role))throw new CRMError('طلبات تصنيع القوالب غير متاحة لهذا الدور',403);return c;};
/** The customers a member may ask a mold for: their own scope, or for customer service the customers of their branch in their regions
 * (the same ones their visits page lists, lib/customer-service.ts serviceVisitRecords). */
const askable=(c:Awaited<ReturnType<typeof reader>>,customerId:string)=>isServiceRole(c.me.role)
 ?c.regionalRecords.find(row=>row.id===customerId&&row.kind==='customer'&&row.branch===c.me.branch)
 :c.visible.find(row=>row.id===customerId&&row.kind==='customer');

/** The requests the reader may see, with their status pulled once (one call for all of them, or for the one asked for by ?id=), each
 * with its design files (the CRM's and production's). quotePo: production's update of 2026-11-03 is known to be live (learned from any
 * answer, this page's pulls included), so the form asks for the quotation and PO numbers and their files. The list is the reader's own
 * (canReadMoldRequest: the sales manager's and their team's for a sales manager); ?id= also opens, for the sales manager, a request
 * «طلبات بانتظار اعتمادي» shows them now without their list doing so (canOpenMoldRequest: customer service's, say). */
export async function GET(req:Request){try{
 const c=await reader(),link=productsLink(),id=new URL(req.url).searchParams.get('id');
 keepMoldRetrying();void sendDueMoldRequests(c.db,{link}).catch(()=>{});
 const one=id?await loadMoldRequest(c.db,id):null;
 const rows=id?(one&&await canOpenMoldRequest(one,c,link)?[one]:[]):(await loadMoldRequests(c.db)).filter(row=>canReadMoldRequest(row,c));
 if(id&&!rows.length)throw new CRMError('الطلب غير متاح',404);
 const statusError=await pullMoldStatuses(c.db,rows,{link}),files=await moldDesignFilesByRequest(c.db,rows.map(row=>row.id)),reasons=await moldViewReasons(c.db,rows,c.me);
 const pending=id?null:await pendingFor(c,link),quotePo=await moldQuotePoSupported(c.db);
 const answer:MoldRequestsAnswer={generatedAt:new Date().toISOString(),linkReady:link.ok,linkProblem:link.ok?'':link.reason,requests:rows.map(row=>moldRequestView(row,c.me,c.members,link.ok,files.get(row.id),reasons.get(row.id),quotePo,moldApprovesRequest(row,c))),statusError,canCreate:canCreateMoldRequest(c.me),pending,quotePo};
 return Response.json(answer,{headers:{'Cache-Control':'no-store'}});
}catch(e){return replyError(e);}}

const requestId=z.string().uuid(),id=z.string().regex(/^mr-[0-9a-f-]{36}$/),version=z.number().int().positive();
const specsInput=z.record(z.string(),z.unknown()),paymentInput=z.unknown().optional(),numberInput=z.unknown().optional();
const schema=z.discriminatedUnion('action',[
 // payment (2026-11-03): cash or deferred, required (checkedRequest says so with the field's own message). quoteNo and poNo (the second
 // update of 2026-11-03): one at least once production's update is known to be live, none before (checkedRequest).
 z.object({action:z.literal('create'),requestId,customerId:z.string().min(1).max(200),specs:specsInput,payment:paymentInput,quoteNo:numberInput,poNo:numberInput}).strict(),
 z.object({action:z.literal('update'),requestId,id,version,specs:specsInput,payment:paymentInput,quoteNo:numberInput,poNo:numberInput}).strict(),
 z.object({action:z.literal('cancel'),requestId,id,version,reason:z.string().trim().max(MOLD_LIMITS.cancelReason,'سبب الإلغاء حتى 500 حرف').default('')}).strict(),
 z.object({action:z.literal('resend'),requestId,id}).strict(),
 z.object({action:z.literal('approve'),requestId,id}).strict(),
 z.object({action:z.literal('withdraw'),requestId,id}).strict(),
 // The sales manager's waiting list names a request by production's order number: the CRM's own, or one registered in production.
 z.object({action:z.literal('approve-order'),requestId,orderNo:z.number().int().positive()}).strict(),
 z.object({action:z.literal('withdraw-order'),requestId,orderNo:z.number().int().positive()}).strict(),
]);
const labels={create:'طلب تصنيع قالب',update:'تعديل طلب تصنيع قالب',cancel:'إلغاء طلب تصنيع قالب',resend:'إعادة إرسال طلب تصنيع قالب',approve:'اعتماد مدير المبيعات لطلب تصنيع قالب',withdraw:'سحب اعتماد مدير المبيعات لطلب تصنيع قالب','approve-order':'اعتماد مدير المبيعات لطلب تصنيع قالب','withdraw-order':'سحب اعتماد مدير المبيعات لطلب تصنيع قالب'};
/** A sent request's data is edited by the production manager in the products application only (yourrest-products, 2026-11-02): the
 *  CRM's update is refused, and a change production still refuses as production_only is final. Each text has its English pair in
 *  lib/locales/en.json; the request's sheet says which specifications it shows. */
const PRODUCTION_ONLY=MOLD_PRODUCTION_ONLY_TEXT[0]+'؛ الطلب أُرسل للإنتاج، فتعديله من تطبيق المنتجات.';
const PRODUCTION_ONLY_SENT=MOLD_PRODUCTION_ONLY_TEXT[0]+'؛ التعديل لم يصل للإنتاج ولن يُعاد إرساله.';
/** The same once production's update of 2026-11-03 is live: the quotation and PO numbers are the request's data too, added by the
 *  production manager only (never by a resend). */
const PRODUCTION_ONLY_QUOTE_PO=PRODUCTION_ONLY_SENT+' '+MOLD_QUOTE_PO_PRODUCTION_ONLY_TEXT[0]+'.';
/** A quotation or PO number sent before production's update is known to be live (no form asks for one then). */
const QUOTE_PO_NOT_YET='تطبيق المنتجات لسه ما اتحدّثش لاستقبال رقم عرض السعر والـ PO؛ حدّث الصفحة وابعت الطلب من غيرهم.';
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
/** The specifications, the payment (cash or deferred, 2026-11-03) and the quotation and PO numbers (the second update of 2026-11-03) of
 *  a new request or of an edit before the first send; every wrong field named at once. quotePo: production's update is known to be live,
 *  so at least one number is required; before it none is taken (no form asks for one), and one given is refused (409). The numbers come
 *  back normalized ('' for none). designUrl: the request's own design link, kept as stored ('' for a new request, so it carries none and
 *  sends none); the form sends none, and a link it sends that is not that one is refused (DESIGN_URL_GONE). */
function checkedRequest(input:Record<string,unknown>,paymentValue:unknown,numbers:{quoteNo?:unknown;poNo?:unknown},quotePo:boolean,designUrl=''){
 if(!quotePo&&[numbers.quoteNo,numbers.poNo].some(value=>moldQuotePoNumber(value)!==''))throw new CRMError(QUOTE_PO_NOT_YET,409);
 const {specs,errors}=validateMoldSpecs(input),payment=moldPayment(paymentValue) as MoldPayment|null,checked=validateMoldQuotePo(numbers,{required:quotePo});
 const typedUrl=errors.designUrl!==undefined||specs.designUrl!==''&&specs.designUrl!==designUrl;
 delete errors.designUrl;specs.designUrl=designUrl;
 const fields:Record<string,string>={...errors,...(typedUrl?{designUrl:DESIGN_URL_GONE}:{}),...(payment?{}:{payment:MOLD_PAYMENT_REQUIRED}),...(quotePo?checked.errors:{})};
 if(Object.keys(fields).length)throw Object.assign(new CRMError(Object.values(fields).join(' • '),400),{fields});
 return {specs:specs as MoldRequestData['specs'],payment:payment as MoldPayment,quoteNo:quotePo?checked.quoteNo:'',poNo:quotePo?checked.poNo:''};
}
/** A request's data with its numbers: each kept only when given, so a request without them is stored (and sent) exactly as before. */
function withNumbers(data:MoldRequestData,{quoteNo,poNo}:{quoteNo:string;poNo:string}):MoldRequestData{
 const next={...data};delete next.quoteNo;delete next.poNo;
 return {...next,...(quoteNo?{quoteNo}:{}),...(poNo?{poNo}:{})};
}

/**
 * create, update, cancel, resend. The change is saved in the CRM first (with its audit entry, as a receipt that makes a repeated
 * tap harmless), then sent; the answer carries the request as it now stands and what the send gave. update only while the request has
 * certainly never reached production (moldNeverSent; MOLD_NEVER_SENT_SQL guards the save): once sent, 409 with production_only's text.
 * approve, withdraw (the sales manager): production's approval route is called first, and only its answer is saved, with the receipt.
 */
export async function POST(req:Request){try{
 checkOrigin(req);await requireSession();
 // The role is checked before the body is read: customer service is refused (403) whatever it sends.
 const c=await reader(),input=schema.parse(await readJsonBody(req)),now=new Date().toISOString(),mutation=crypto.randomUUID(),link=productsLink();keepMoldRetrying();
 const canonical=JSON.stringify(input),receiptId='mold-request-receipt:'+c.me.id+':'+input.requestId;
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
  const refused=refusal||(outcome?.kind==='restored'?(moldEditable(row)?SAME_REASON:RESTORED_LOCKED):outcome?.reason===MOLD_PRODUCTION_ONLY?(known?PRODUCTION_ONLY_QUOTE_PO:PRODUCTION_ONLY_SENT):row.remote?.status==='cancelled'?CANCELLED_THERE:outcome?.sent==='cancel'?CANCEL_LOCKED:SEND_LOCKED);
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
  const approving=input.action==='approve-order',orderNo=input.orderNo;
  const saved=await c.db.prepare('SELECT detail FROM crm_audit WHERE id=?').bind(receiptId).first<{detail:string}>();
  if(saved){if(saved.detail!==canonical)throw new CRMError('العملية محفوظة ببيانات مختلفة. حدّث الصفحة.',409);return Response.json({ok:true,status:null,pending:await pendingFor(c,link)});}
  if(!link.ok)throw new CRMError('الربط مع الإنتاج غير مفعَّل',503);
  // The CRM's own request (it holds that order number) goes by its crmRequestId, with the CRM's own checks: one this manager approves
  // (moldApprovesRequest, as «طلبات بانتظار اعتمادي» lists it); one registered in production by its orderNo, approved only while
  // production still lists it as waiting within the manager's regions.
  const own=(await loadMoldRequests(c.db,"json_extract(remote,'$.orderNo')=?",[orderNo]))[0];
  let listed=null;
  if(own){
   if(!moldApprovesRequest(own,c))throw new CRMError('الطلب غير متاح',404);
   const filesOnTheWay=(await loadMoldDesignFiles(c.db,'request_id=?',[own.id])).some(moldDesignInFlight);
   if(own.cancelledAt||own.outbox||filesOnTheWay)throw new CRMError(own.cancelledAt?'الطلب ملغى':'في تغيير على الطلب لسه ما وصلش للإنتاج؛ استنى لما يوصل',409);
  }else if(approving){
   listed=(await pendingFor(c,link,{force:true}))!.items.find(item=>item.orderNo===orderNo&&!item.crmRequestId);
   if(!listed)throw new CRMError('الطلب لم يعد بانتظار اعتمادك. حدّث الصفحة.',409);
  }else if(regionScope(c.me)!=='all')throw new CRMError('سحب اعتماد طلب مسجّل في الإنتاج لمدير مبيعات كل المناطق',403);
  const by={name:c.me.name,email:c.me.email},call=await callProducts(link,'approval',moldApprovalBody(own?{id:own.id,action:approving?'approve':'withdraw',by}:{orderNo,action:approving?'approve':'withdraw',by}));
  const status=call.kind==='ok'?moldStatusObject(call.json?.request,{manual:!own}):call.kind==='locked'?call.request:null,at=new Date().toISOString();
  if(own&&status)await storeMoldRemote(c.db,own.id,status,at);
  else await noteMoldQuotePo(c.db,[status],at);
  forgetPendingApprovals();
  if(call.kind==='locked')return Response.json({ok:false,status,pending:await pendingFor(c,link),error:moldApprovalRefusal(status,approving)},{status:409});
  if(call.kind!=='ok'||!status)throw new CRMError(call.kind==='not_found'?'الطلب غير موجود لدى الإنتاج':moldErrorText(call.code,ar=>ar)+'. حاول مرة أخرى.',call.kind==='not_found'?409:502);
  const recordId=own?.id||'mold-order:'+orderNo,detail={label:labels[input.action],customerName:own?.data.customer.name||listed?.customer.name||'',orderNo,source:own?'crm':'manual',waitingStep:status.waitingStep};
  await c.db.batch([
   c.db.prepare('INSERT OR IGNORE INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(receiptId,recordId,c.me.name,'mold-request-receipt',canonical,at),
   c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),recordId,c.me.name,'mold-request:'+(approving?'approve':'withdraw'),JSON.stringify(detail),at),
  ]);
  return Response.json({ok:true,status,request:own?await answerView(own.id):null,pending:await pendingFor(c,link)});
 }
 const repeated=await replay();if(repeated)return repeated;
 // Production's update of 2026-11-03 known to be live: the quotation and PO numbers are asked for (one at least) and sent.
 const permission=accessGuard(c),quotePo=await moldQuotePoSupported(c.db);
 let rowId:string,statement,restart:D1PreparedStatement|null=null,detail:Record<string,unknown>;
 if(input.action==='create'){
  if(!canCreateMoldRequest(c.me))throw new CRMError('طلبات تصنيع القوالب غير متاحة لهذا الدور',403);
  const customer=askable(c,input.customerId);
  if(!customer)throw new CRMError('اختر عميلًا من العملاء المتاحين لك',404);
  const crmNumber=yourrestNumber(customer.data.internalCode);
  if(!crmNumber)throw new CRMError('كود يورست للعميل غير متاح. حدّث الصفحة.',409);
  const name=String(customer.data.name||'').trim();
  if(!name||[...name].length>MOLD_LIMITS.customerName)throw new CRMError('اسم العميل أطول من '+MOLD_LIMITS.customerName+' حرفًا؛ اختصره من صفحة العميل أولًا',409);
  const asked=checkedRequest(input.specs,input.payment,input,quotePo);
  const data:MoldRequestData=withNumbers({requestedAt:requestedNow(now),customer:{crmNumber,name,address:String(customer.data.address||''),city:moldRequestCity(customer.data.city)},salesman:{crmMemberId:c.me.id,name:c.me.name,email:c.me.email},specs:asked.specs,payment:asked.payment},asked);
  rowId='mr-'+input.requestId;detail={label:labels.create,customerName:name,description:data.specs.description,quantity:data.specs.quantity,payment:data.payment,...(data.quoteNo?{quoteNo:data.quoteNo}:{}),...(data.poNo?{poNo:data.poNo}:{})};
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
   if(approving?!allowed.approve:!allowed.withdraw)throw new CRMError(row.cancelledAt?'الطلب ملغى':row.outbox||files.some(moldDesignInFlight)?'في تغيير على الطلب لسه ما وصلش للإنتاج؛ استنى لما يوصل':approving?'الطلب مش بانتظار اعتماد مدير المبيعات. حدّث الصفحة.':'لا يوجد اعتماد يمكن سحبه. حدّث الصفحة.',409);
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
   const checked=checkedRequest(input.specs,input.payment,input,quotePo,row.data.specs.designUrl||''),{specs,payment}=checked;
   // Before production's update the request's numbers are left as they are (it has none: none is taken before).
   const edited=quotePo?withNumbers({...row.data,specs,payment},checked):{...row.data,specs,payment};
   if(JSON.stringify(specs)===JSON.stringify(row.data.specs)&&payment===row.data.payment&&(edited.quoteNo||'')===(row.data.quoteNo||'')&&(edited.poNo||'')===(row.data.poNo||''))return answer(row.id,null);
   detail={label:labels.update,customerName:row.data.customer.name,description:specs.description,quantity:specs.quantity,payment,...(edited.quoteNo?{quoteNo:edited.quoteNo}:{}),...(edited.poNo?{poNo:edited.poNo}:{})};
   // Production never stored any of it, so the edited request starts as never attempted; the guard holds that in SQL, so a send claimed
   // since the check (it may arrive) keeps the request as it is.
   statement=c.db.prepare(`UPDATE crm_mold_requests SET data=?,outbox='send',attempts=0,first_failed_at=NULL,next_attempt_at=?,last_attempt_at=NULL,last_error=NULL,updated_at=?,version=version+1,mutation_id=? WHERE ${guard} AND ${MOLD_NEVER_SENT_SQL}`).bind(JSON.stringify(edited),now,now,mutation,...guardArgs);
  }else if(input.action==='cancel'){
   if(!allowed.cancel)throw new CRMError(row.cancelledAt?'الطلب ملغى من قبل':row.memberId!==c.me.id?'إلغاء الطلب لمن طلبه':'بدأ الإنتاج؛ لم يعد الإلغاء ممكنًا',row.memberId!==c.me.id?403:409);
   // Cancelled before and restored by the production manager (2026-11-03): a reason used already is refused here, not sent.
   if(moldCancelReasonUsed(input.reason,(await moldCancelReasons(c.db,[row.id])).get(row.id)))return answer(row.id,null,409,SAME_REASON);
   detail={label:labels.cancel,customerName:row.data.customer.name,reason:input.reason};
   statement=c.db.prepare(`UPDATE crm_mold_requests SET cancelled_at=?,cancel_reason=?,outbox='cancel',attempts=0,first_failed_at=NULL,next_attempt_at=?,last_error=NULL,updated_at=?,version=version+1,mutation_id=? WHERE ${guard}`).bind(now,input.reason,now,now,mutation,...guardArgs);
  }else{
   // Something the resend would start: the request's own change, or a design file whose sending or deletion stopped (not one refused).
   const waiting=!!row.outbox||files.some(moldDesignStopped);
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
 const result=await c.db.batch([statement,...(restart?[restart]:[]),
  c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(receiptId,rowId,c.me.name,'mold-request-receipt',canonical,now,...ga),
  c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(crypto.randomUUID(),rowId,c.me.name,'mold-request:'+input.action,JSON.stringify(detail),now,...ga),
 ]).catch(async error=>{const again=await replay();if(again)return again;throw error;});
 if(result instanceof Response)return result;
 if(result[0].meta.changes!==1){
  const again=await replay();if(again)return again;
  // An update stopped by its guard because a send was claimed since the check (it may arrive): refused as a sent request is.
  const current=input.action==='update'?await loadMoldRequest(c.db,rowId):null;
  if(current&&!moldNeverSent(current))return answer(rowId,null,409,PRODUCTION_ONLY);
  throw new CRMError('تغيّرت البيانات أو الصلاحيات أثناء الحفظ. حدّث الصفحة.',409);
 }
 // Saved. Now the send (up to 10 seconds); a failure leaves the request waiting on the timetable.
 const outcome=await sendMoldRequest(c.db,rowId,{link});
 // A resend also starts the request's design files whose turn has come again (they go in the background, up to 120 seconds each).
 if(input.action==='resend')void sendDueMoldDesignFiles(c.db,{link}).catch(()=>{});
 return answer(rowId,outcome,outcome.kind==='locked'||outcome.kind==='restored'?409:200);
}catch(e){
 if(e instanceof z.ZodError)return Response.json({error:e.issues.map(issue=>issue.message).join(' • ')},{status:400});
 if(e instanceof CRMError&&'fields' in e)return Response.json({error:e.message,fields:(e as CRMError&{fields:Record<string,string>}).fields},{status:e.status});
 return replyError(e);
}}
