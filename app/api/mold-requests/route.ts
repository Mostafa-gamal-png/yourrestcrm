import {z} from 'zod';
import {context,accessGuard,checkOrigin,requireSession,readJsonBody,CRMError,replyError} from '@/lib/crm-server';
import {validateMoldSpecs,moldApprovalBody,moldApprovalRefusal,moldStatusObject,moldRequestCity,MOLD_LIMITS} from '@/portable/mold-rules.mjs';
import {callProducts} from '@/portable/mold-client.mjs';
import {canApproveMoldRequests,canCreateMoldRequest,canReadMoldRequest,canUseMoldRequests,moldDesignInFlight,moldErrorText,moldPermissions,moldRequestView,yourrestNumber,type MoldRequestData,type MoldRequestRow,type MoldRequestsAnswer} from '@/lib/mold-requests';
import {regionScope} from '@/lib/regions';
import {isServiceRole} from '@/lib/customer-service';
import {forgetPendingApprovals,keepMoldRetrying,loadMoldDesignFiles,loadMoldRequest,loadMoldRequests,moldDesignFilesByRequest,moldPendingFor as pendingFor,productsLink,pullMoldStatuses,requestedNow,sendDueMoldRequests,sendMoldRequest,sendDueMoldDesignFiles,storeMoldRemote,MOLD_DESIGN_STOPPED_SQL,type SendOutcome} from '@/lib/mold-requests-server';
export const dynamic='force-dynamic';

const reader=async()=>{const c=await context({load:'customers'});if(!canUseMoldRequests(c.me.role))throw new CRMError('طلبات تصنيع القوالب غير متاحة لهذا الدور',403);return c;};
/** The customers a member may ask a mold for: their own scope, or for customer service the customers of their branch in their regions
 * (the same ones their visits page lists, lib/customer-service.ts serviceVisitRecords). */
const askable=(c:Awaited<ReturnType<typeof reader>>,customerId:string)=>isServiceRole(c.me.role)
 ?c.regionalRecords.find(row=>row.id===customerId&&row.kind==='customer'&&row.branch===c.me.branch)
 :c.visible.find(row=>row.id===customerId&&row.kind==='customer');

/** The requests the reader may see, with their status pulled once (one call for all of them, or for the one asked for by ?id=), each
 * with its design files (the CRM's and production's). */
export async function GET(req:Request){try{
 const c=await reader(),link=productsLink(),id=new URL(req.url).searchParams.get('id');
 keepMoldRetrying();void sendDueMoldRequests(c.db,{link}).catch(()=>{});
 const rows=(id?[await loadMoldRequest(c.db,id)].filter((row):row is MoldRequestRow=>!!row):await loadMoldRequests(c.db)).filter(row=>canReadMoldRequest(row,c));
 if(id&&!rows.length)throw new CRMError('الطلب غير متاح',404);
 const statusError=await pullMoldStatuses(c.db,rows,{link}),files=await moldDesignFilesByRequest(c.db,rows.map(row=>row.id));
 const answer:MoldRequestsAnswer={generatedAt:new Date().toISOString(),linkReady:link.ok,linkProblem:link.ok?'':link.reason,requests:rows.map(row=>moldRequestView(row,c.me,c.members,link.ok,files.get(row.id))),statusError,canCreate:canCreateMoldRequest(c.me),pending:id?null:await pendingFor(c,link)};
 return Response.json(answer,{headers:{'Cache-Control':'no-store'}});
}catch(e){return replyError(e);}}

const requestId=z.string().uuid(),id=z.string().regex(/^mr-[0-9a-f-]{36}$/),version=z.number().int().positive();
const specsInput=z.record(z.string(),z.unknown());
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),requestId,customerId:z.string().min(1).max(200),specs:specsInput}).strict(),
 z.object({action:z.literal('update'),requestId,id,version,specs:specsInput}).strict(),
 z.object({action:z.literal('cancel'),requestId,id,version,reason:z.string().trim().max(MOLD_LIMITS.cancelReason,'سبب الإلغاء حتى 500 حرف').default('')}).strict(),
 z.object({action:z.literal('resend'),requestId,id}).strict(),
 z.object({action:z.literal('approve'),requestId,id}).strict(),
 z.object({action:z.literal('withdraw'),requestId,id}).strict(),
 // The sales manager's waiting list names a request by production's order number: the CRM's own, or one registered in production.
 z.object({action:z.literal('approve-order'),requestId,orderNo:z.number().int().positive()}).strict(),
 z.object({action:z.literal('withdraw-order'),requestId,orderNo:z.number().int().positive()}).strict(),
]);
const labels={create:'طلب تصنيع قالب',update:'تعديل طلب تصنيع قالب',cancel:'إلغاء طلب تصنيع قالب',resend:'إعادة إرسال طلب تصنيع قالب',approve:'اعتماد مدير المبيعات لطلب تصنيع قالب',withdraw:'سحب اعتماد مدير المبيعات لطلب تصنيع قالب','approve-order':'اعتماد مدير المبيعات لطلب تصنيع قالب','withdraw-order':'سحب اعتماد مدير المبيعات لطلب تصنيع قالب'};
function checkedSpecs(input:Record<string,unknown>){
 const {specs,errors}=validateMoldSpecs(input);
 if(Object.keys(errors).length)throw Object.assign(new CRMError(Object.values(errors).join(' • '),400),{fields:errors});
 return specs as MoldRequestData['specs'];
}

/**
 * create, update, cancel, resend. The change is saved in the CRM first (with its audit entry, as a receipt that makes a repeated
 * tap harmless), then sent; the answer carries the request as it now stands and what the send gave.
 * approve, withdraw (the sales manager): production's approval route is called first, and only its answer is saved, with the receipt.
 */
export async function POST(req:Request){try{
 checkOrigin(req);await requireSession();
 // The role is checked before the body is read: customer service is refused (403) whatever it sends.
 const c=await reader(),input=schema.parse(await readJsonBody(req)),now=new Date().toISOString(),mutation=crypto.randomUUID(),link=productsLink();keepMoldRetrying();
 const canonical=JSON.stringify(input),receiptId='mold-request-receipt:'+c.me.id+':'+input.requestId;
 const answer=async(rowId:string,outcome:SendOutcome|null,status=200)=>{
  const row=await loadMoldRequest(c.db,rowId);
  if(!row)throw new CRMError('الطلب غير متاح',404);
  // 409: production refused the change; the request now shows what production holds, and the reason is the one production gave.
  const refused=row.remote?.status==='cancelled'?'أُلغي الطلب في تطبيق الإنتاج؛ لم يعد التعديل أو الإلغاء ممكنًا.':'بدأ الإنتاج قبل وصول التعديل؛ لم يعد التعديل أو الإلغاء ممكنًا. الطلب كما استلمه الإنتاج.';
  return Response.json({ok:status<400,request:moldRequestView(row,c.me,c.members,link.ok,await loadMoldDesignFiles(c.db,'request_id=?',[row.id])),send:outcome?{kind:outcome.kind,code:outcome.code,fields:outcome.fields||[]}:null,...(status===409?{error:refused}:{})},{status});
 };
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
  // The CRM's own request (it holds that order number) goes by its crmRequestId, with the CRM's own checks; one registered in
  // production by its orderNo, approved only while production still lists it as waiting within the manager's regions.
  const own=(await loadMoldRequests(c.db,"json_extract(remote,'$.orderNo')=?",[orderNo]))[0];
  let listed=null;
  if(own){
   if(!canReadMoldRequest(own,c))throw new CRMError('الطلب غير متاح',404);
   const filesOnTheWay=(await loadMoldDesignFiles(c.db,'request_id=?',[own.id])).some(moldDesignInFlight);
   if(own.cancelledAt||own.outbox||filesOnTheWay)throw new CRMError(own.cancelledAt?'الطلب ملغى':'في تغيير على الطلب لسه ما وصلش للإنتاج؛ استنى لما يوصل',409);
  }else if(approving){
   listed=(await pendingFor(c,link,{force:true}))!.items.find(item=>item.orderNo===orderNo&&!item.crmRequestId);
   if(!listed)throw new CRMError('الطلب لم يعد بانتظار اعتمادك. حدّث الصفحة.',409);
  }else if(regionScope(c.me)!=='all')throw new CRMError('سحب اعتماد طلب مسجّل في الإنتاج لمدير مبيعات كل المناطق',403);
  const by={name:c.me.name,email:c.me.email},call=await callProducts(link,'approval',moldApprovalBody(own?{id:own.id,action:approving?'approve':'withdraw',by}:{orderNo,action:approving?'approve':'withdraw',by}));
  const status=call.kind==='ok'?moldStatusObject(call.json?.request,{manual:!own}):call.kind==='locked'?call.request:null,at=new Date().toISOString();
  if(own&&status)await storeMoldRemote(c.db,own.id,status,at);
  forgetPendingApprovals();
  if(call.kind==='locked')return Response.json({ok:false,status,pending:await pendingFor(c,link),error:moldApprovalRefusal(status,approving)},{status:409});
  if(call.kind!=='ok'||!status)throw new CRMError(call.kind==='not_found'?'الطلب غير موجود لدى الإنتاج':moldErrorText(call.code,ar=>ar)+'. حاول مرة أخرى.',call.kind==='not_found'?409:502);
  const recordId=own?.id||'mold-order:'+orderNo,detail={label:labels[input.action],customerName:own?.data.customer.name||listed?.customer.name||'',orderNo,source:own?'crm':'manual',waitingStep:status.waitingStep};
  await c.db.batch([
   c.db.prepare('INSERT OR IGNORE INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(receiptId,recordId,c.me.name,'mold-request-receipt',canonical,at),
   c.db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),recordId,c.me.name,'mold-request:'+(approving?'approve':'withdraw'),JSON.stringify(detail),at),
  ]);
  return Response.json({ok:true,status,request:own?moldRequestView((await loadMoldRequest(c.db,own.id))!,c.me,c.members,link.ok,await loadMoldDesignFiles(c.db,'request_id=?',[own.id])):null,pending:await pendingFor(c,link)});
 }
 const repeated=await replay();if(repeated)return repeated;
 const permission=accessGuard(c);
 let rowId:string,statement,restart:D1PreparedStatement|null=null,detail:Record<string,unknown>;
 if(input.action==='create'){
  if(!canCreateMoldRequest(c.me))throw new CRMError('طلبات تصنيع القوالب غير متاحة لهذا الدور',403);
  const customer=askable(c,input.customerId);
  if(!customer)throw new CRMError('اختر عميلًا من العملاء المتاحين لك',404);
  const crmNumber=yourrestNumber(customer.data.internalCode);
  if(!crmNumber)throw new CRMError('كود يورست للعميل غير متاح. حدّث الصفحة.',409);
  const name=String(customer.data.name||'').trim();
  if(!name||[...name].length>MOLD_LIMITS.customerName)throw new CRMError('اسم العميل أطول من '+MOLD_LIMITS.customerName+' حرفًا؛ اختصره من صفحة العميل أولًا',409);
  const data:MoldRequestData={requestedAt:requestedNow(now),customer:{crmNumber,name,address:String(customer.data.address||''),city:moldRequestCity(customer.data.city)},salesman:{crmMemberId:c.me.id,name:c.me.name,email:c.me.email},specs:checkedSpecs(input.specs)};
  rowId='mr-'+input.requestId;detail={label:labels.create,customerName:name,description:data.specs.description,quantity:data.specs.quantity};
  statement=c.db.prepare(`INSERT INTO crm_mold_requests(id,member_id,customer_id,data,outbox,next_attempt_at,created_by,created_at,updated_at,version,mutation_id) SELECT ?,?,?,?,'send',?,?,?,?,1,? WHERE ${permission.sql} AND EXISTS(SELECT 1 FROM crm_records WHERE id=? AND kind='customer' AND version=?)`)
   .bind(rowId,c.me.id,customer.id,JSON.stringify(data),now,c.me.id,now,now,mutation,...permission.args,customer.id,customer.version);
 }else{
  const row=await loadMoldRequest(c.db,input.id);
  if(!row||!canReadMoldRequest(row,c))throw new CRMError('الطلب غير متاح',404);
  const files=await loadMoldDesignFiles(c.db,'request_id=?',[row.id]),allowed=moldPermissions(row,c.me,files);rowId=row.id;
  if(input.action==='approve'||input.action==='withdraw'){
   const approving=input.action==='approve';
   if(!canApproveMoldRequests(c.me))throw new CRMError('اعتماد طلبات القوالب لمدير المبيعات',403);
   if(approving?!allowed.approve:!allowed.withdraw)throw new CRMError(row.cancelledAt?'الطلب ملغى':row.outbox||files.some(moldDesignInFlight)?'في تغيير على الطلب لسه ما وصلش للإنتاج؛ استنى لما يوصل':approving?'الطلب مش بانتظار اعتماد مدير المبيعات. حدّث الصفحة.':'لا يوجد اعتماد يمكن سحبه. حدّث الصفحة.',409);
   if(!link.ok)throw new CRMError('الربط مع الإنتاج غير مفعَّل',503);
   const call=await callProducts(link,'approval',moldApprovalBody({id:row.id,action:input.action,by:{name:c.me.name,email:c.me.email}}));
   const remote=call.kind==='ok'?moldStatusObject(call.json?.request):call.kind==='locked'?call.request:null,at=new Date().toISOString();
   if(remote)await storeMoldRemote(c.db,row.id,remote,at);
   forgetPendingApprovals();
   if(call.kind==='locked')return Response.json({ok:false,request:moldRequestView((await loadMoldRequest(c.db,row.id))!,c.me,c.members,link.ok,files),error:moldApprovalRefusal(remote,approving)},{status:409});
   if(call.kind!=='ok'||!remote)throw new CRMError(call.kind==='not_found'?'الطلب غير موجود لدى الإنتاج':moldErrorText(call.code,ar=>ar)+'. حاول مرة أخرى.',call.kind==='not_found'?409:502);
   const gate='EXISTS(SELECT 1 FROM crm_mold_requests WHERE id=?)',detail={label:labels[input.action],customerName:row.data.customer.name,orderNo:remote.orderNo,waitingStep:remote.waitingStep};
   await c.db.batch([
    c.db.prepare(`INSERT OR IGNORE INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(receiptId,row.id,c.me.name,'mold-request-receipt',canonical,at,row.id),
    c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(crypto.randomUUID(),row.id,c.me.name,'mold-request:'+input.action,JSON.stringify(detail),at,row.id),
   ]);
   return answer(row.id,null);
  }
  if(input.action!=='resend'&&input.version!==row.version)throw new CRMError('تغيّر الطلب. حدّث الصفحة.',409);
  const guard=`id=? AND version=? AND member_id=? AND ${permission.sql}`,guardArgs=[row.id,row.version,c.me.id,...permission.args];
  if(input.action==='update'){
   if(!allowed.edit)throw new CRMError(row.cancelledAt?'الطلب ملغى':row.memberId!==c.me.id?'تعديل الطلب لمن طلبه':'بدأ الإنتاج؛ لم يعد التعديل ممكنًا',row.memberId!==c.me.id?403:409);
   const specs=checkedSpecs(input.specs);
   if(JSON.stringify(specs)===JSON.stringify(row.data.specs))return answer(row.id,null);
   detail={label:labels.update,customerName:row.data.customer.name,description:specs.description,quantity:specs.quantity};
   statement=c.db.prepare(`UPDATE crm_mold_requests SET data=?,outbox='send',attempts=0,first_failed_at=NULL,next_attempt_at=?,last_error=NULL,updated_at=?,version=version+1,mutation_id=? WHERE ${guard}`).bind(JSON.stringify({...row.data,specs}),now,now,mutation,...guardArgs);
  }else if(input.action==='cancel'){
   if(!allowed.cancel)throw new CRMError(row.cancelledAt?'الطلب ملغى من قبل':row.memberId!==c.me.id?'إلغاء الطلب لمن طلبه':'بدأ الإنتاج؛ لم يعد الإلغاء ممكنًا',row.memberId!==c.me.id?403:409);
   detail={label:labels.cancel,customerName:row.data.customer.name,reason:input.reason};
   statement=c.db.prepare(`UPDATE crm_mold_requests SET cancelled_at=?,cancel_reason=?,outbox='cancel',attempts=0,first_failed_at=NULL,next_attempt_at=?,last_error=NULL,updated_at=?,version=version+1,mutation_id=? WHERE ${guard}`).bind(now,input.reason,now,now,mutation,...guardArgs);
  }else{
   const waiting=row.outbox||files.some(file=>file.outbox);
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
 if(result[0].meta.changes!==1){const again=await replay();if(again)return again;throw new CRMError('تغيّرت البيانات أو الصلاحيات أثناء الحفظ. حدّث الصفحة.',409);}
 // Saved. Now the send (up to 10 seconds); a failure leaves the request waiting on the timetable.
 const outcome=await sendMoldRequest(c.db,rowId,{link});
 // A resend also starts the request's design files whose turn has come again (they go in the background, up to 120 seconds each).
 if(input.action==='resend')void sendDueMoldDesignFiles(c.db,{link}).catch(()=>{});
 return answer(rowId,outcome,outcome.kind==='locked'?409:200);
}catch(e){
 if(e instanceof z.ZodError)return Response.json({error:e.issues.map(issue=>issue.message).join(' • ')},{status:400});
 if(e instanceof CRMError&&'fields' in e)return Response.json({error:e.message,fields:(e as CRMError&{fields:Record<string,string>}).fields},{status:e.status});
 return replyError(e);
}}
