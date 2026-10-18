import {z} from 'zod';
import {context,accessGuard,checkOrigin,requireSession,readJsonBody,CRMError,replyError} from '@/lib/crm-server';
import {today,type Member} from '@/lib/crm';
import {memberCanAccessRegion,regionScope} from '@/lib/regions';
import {registrarManager} from '@/lib/complaints';
import {SUPPORT_LIST_LIMIT,SUPPORT_NOTE_MAX,canReadSupport,canRequestSupport,missedVisits,supportActions,supportBadge,supportCandidates,supportEvents,supportOutcomes,supportPermissions,supportQueue,supportReader,supportResolutionChannels,supportState,supportStaff,type SupportData} from '@/lib/support';
import {loadSupport,loadSupportRow as loadOne} from '@/lib/support-rows';
export const dynamic='force-dynamic';

/** Re-checks at commit that a member named in the change is still who they were when it was decided. */
function memberGate(m:Member){return{sql:"EXISTS(SELECT 1 FROM crm_members WHERE id=? AND role=? AND active=? AND branch=? AND COALESCE(supervisor_id,'')=? AND region_scope=?)",args:[m.id,m.role,m.active,m.branch,m.supervisorId||'',regionScope(m)]};}

/** What the signed-in member may see: sales members the requests of their team and what was assigned to them, customer service those
 * of its branch and region plus the visits that went unanswered, administrators everything. Read-only and never cached. */
export async function GET(){try{
 // Customer service and administrators need every visit of their customers to know what was missed; the others do not.
 const probe=await context({load:'identity'});
 const c=['admin','customer_service','customer_service_manager'].includes(probe.me.role)?await context():await context({load:'directory'});
 const now=new Date().toISOString(),support=await loadSupport(c.db,now),scope={me:c.me,members:c.members,all:c.all,visible:c.visible,support};
 // Each list is cut to what a page can show, but the counts and the badge are taken from the whole of it.
 const everyRequest=supportQueue(scope,now,Infinity),everyMissed=missedVisits(scope,now,Infinity);
 return Response.json({generatedAt:now,requests:everyRequest.slice(0,SUPPORT_LIST_LIMIT),missed:everyMissed.slice(0,SUPPORT_LIST_LIMIT),counts:{requests:everyRequest.length,missed:everyMissed.length,badge:supportBadge(everyRequest,everyMissed,c.me.role)}},{headers:{'Cache-Control':'no-store'}});
}catch(e){return replyError(e);}}

const requestId=z.string().uuid(),idText=z.string().min(1).max(200),version=z.number().int().positive();
const noteField=z.string().trim().max(SUPPORT_NOTE_MAX);
const said=(min:number,message:string)=>noteField.pipe(z.string().min(min,message));
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'اختر موعدًا صحيحًا').refine(value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'التاريخ غير صالح');
const outcome=z.enum(Object.keys(supportOutcomes) as [string,...string[]]);
const handing={requestId,id:idText,version,targetId:idText,note:noteField.default('')};
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('request'),requestId,origin:z.enum(['rep','missed_visit']).default('rep'),customerId:idText,customerVersion:version,note:noteField.default(''),channel:z.enum(['any','call','whatsapp']).default('any'),visitId:idText.optional()}).strict(),
 z.object({action:z.literal('take'),requestId,id:idText,version}).strict(),
 z.object({action:z.literal('assign'),requestId,id:idText,version,targetId:idText}).strict(),
 z.object({action:z.literal('submit'),requestId,id:idText,version,outcome,note:said(3,'اكتب نتيجة التواصل في 3 أحرف على الأقل'),nextDate:z.union([day,z.literal('')]).default('')}).strict(),
 z.object({action:z.literal('forward'),requestId,id:idText,version,targetId:idText}).strict(),
 z.object({action:z.literal('return'),requestId,id:idText,version,note:said(3,'اكتب ما يلزم تعديله في 3 أحرف على الأقل')}).strict(),
 z.object({action:z.literal('allocate'),...handing}).strict(),
 z.object({action:z.literal('delegate'),...handing}).strict(),
 z.object({action:z.literal('reassign'),...handing}).strict(),
 z.object({action:z.literal('resolve'),requestId,id:idText,version,channel:z.enum(Object.keys(supportResolutionChannels) as [string,...string[]]),outcome,note:said(3,'اكتب ما حدث في التواصل في 3 أحرف على الأقل'),nextDate:z.union([day,z.literal('')]).default('')}).strict(),
 z.object({action:z.literal('reject'),requestId,id:idText,version,reason:said(3,'اكتب سبب الإعادة في 3 أحرف على الأقل')}).strict(),
 z.object({action:z.literal('close'),requestId,id:idText,version,note:noteField.default('')}).strict(),
 z.object({action:z.literal('cancel'),requestId,id:idText,version,reason:noteField.max(500).default('')}).strict(),
 z.object({action:z.literal('seen'),requestId,id:idText,version}).strict()
]);
/** What a contact result may say about a date: a visit the customer asks for needs one, and it cannot be in the past. */
function checkDate(outcomeKey:string,nextDate:string){
 if(outcomeKey==='wants_visit'&&!nextDate)throw new CRMError('حدد الموعد الذي يطلبه العميل للزيارة');
 if(nextDate&&nextDate<today())throw new CRMError('الموعد المقترح يجب أن يكون اليوم أو لاحقًا');
}
/** A request the customer's own state no longer allows is refused before it is saved. */
const OPEN_CUSTOMER="NOT EXISTS(SELECT 1 FROM crm_records existing WHERE existing.kind='support' AND json_extract(existing.data,'$.customerId')=? AND json_extract(existing.data,'$.status') NOT IN ('done','cancelled'))";

export async function POST(req:Request){try{
 checkOrigin(req);await requireSession();
 const input=schema.parse(await readJsonBody(req));
 const c=await context(),now=new Date().toISOString(),mutation=crypto.randomUUID(),reader=supportReader(c);
 const canonical=JSON.stringify(input),receiptId='support-receipt:'+c.me.id+':'+input.requestId;
 const replay=async()=>{
  const saved=await c.db.prepare('SELECT record_id,detail FROM crm_audit WHERE id=?').bind(receiptId).first<{record_id:string;detail:string}>();
  if(!saved)return null;
  if(saved.detail!==canonical)throw new CRMError('العملية محفوظة ببيانات مختلفة. حدّث الصفحة.',409);
  return Response.json({ok:true,id:saved.record_id,alreadySaved:true});
 };
 const repeated=await replay();if(repeated)return repeated;
 const permission=accessGuard(c),guards=[permission.sql],args:(string|number)[]=[...permission.args];
 const requireMember=(member:Member)=>{const gate=memberGate(member);guards.push(gate.sql);args.push(...gate.args);};
 const rootGuard="EXISTS(SELECT 1 FROM crm_records WHERE id=? AND kind='customer' AND version=?)";
 const statements=[];let id='',revision=1,note='',targetName='',state='',stale='';
 const by=c.me.id;

 if(input.action==='request'){
  const customer=c.all.find(row=>row.id===input.customerId&&row.kind==='customer');
  if(!customer)throw new CRMError('العميل غير متاح',404);
  if(input.customerVersion!==customer.version)throw new CRMError('تغيّرت بيانات العميل أو زيارته الأخيرة. حدّث الصفحة.',409);
  let data:SupportData;
  if(input.origin==='rep'){
   if(!canRequestSupport(customer,c))throw new CRMError('طلب المساندة متاح لمن يتابع هذا العميل فقط',403);
   if(input.note.length<3)throw new CRMError('اكتب سبب طلب المساندة في 3 أحرف على الأقل');
   const routed=supportStaff(customer,c.members).routedTo;
   if(routed)requireMember(routed);
   id='support-'+input.requestId;note=input.note;
   data={kind:'support',customerId:customer.id,origin:'rep',status:'open',requestedBy:by,requestedAt:now,repId:customer.assignedTo,note:input.note,channel:input.channel,handlerId:routed?.id||'',handlerAt:routed?now:'',handlerBy:routed?'auto':'',
    events:[{at:now,by,action:'request',text:input.note},...(routed?[{at:now,by:'',action:'assign',targetId:routed.id}]:[])]};
  }else{
   if(!reader.service&&!reader.lead&&!reader.admin)throw new CRMError('تولّي الزيارات المفقودة لخدمة العملاء فقط',403);
   if(!memberCanAccessRegion(c.me,customer.data.region)||!reader.admin&&customer.branch!==c.me.branch)throw new CRMError('العميل خارج نطاق صلاحيتك',403);
   if(!input.visitId)throw new CRMError('حدد الزيارة المفقودة');
   const entry=missedVisits({me:c.me,members:c.members,all:c.all,support:await loadSupport(c.db,now)},now,Infinity).find(item=>item.visitId===input.visitId&&item.customerId===customer.id);
   if(!entry)throw new CRMError('لم تعد هذه الزيارة ضمن الزيارات المفقودة. حدّث القائمة.',409);
   if(!entry.permissions.take)throw new CRMError('هذه الزيارة مسندة لممثل آخر لخدمة العملاء',403);
   id='support-missed-'+entry.visitId;note=input.note;
   data={kind:'support',customerId:customer.id,origin:'missed_visit',status:'open',requestedBy:by,requestedAt:now,repId:customer.assignedTo,note:input.note,channel:'any',plan:entry.plan,handlerId:by,handlerAt:now,handlerBy:by,
    events:[{at:now,by,action:'request'},{at:now,by,action:'take',targetId:by}]};
  }
  state=supportState(data);stale=customer.id;
  statements.push(c.db.prepare(`INSERT OR IGNORE INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) SELECT ?,'support',NULL,?,?,?,?,?,1,? WHERE ${guards.join(' AND ')} AND ${rootGuard} AND ${OPEN_CUSTOMER}`).bind(id,by,customer.branch,JSON.stringify(data),now,now,mutation,...args,customer.id,customer.version,customer.id));
 }else{
  const found=await loadOne(c.db,input.id);
  const customer=found&&c.all.find(row=>row.id===found.data.customerId&&row.kind==='customer');
  if(!found||!customer||!canReadSupport(found,customer,reader))throw new CRMError('الطلب غير متاح',403);
  if(input.version!==found.version)throw new CRMError('تغيّر الطلب. حدّث البيانات قبل إعادة المحاولة.',409);
  const allowed=supportPermissions(found,customer,reader,c.members),data:SupportData={...found.data,previousAssignees:[...(found.data.previousAssignees||[])],events:[...supportEvents(found)]};
  id=found.id;revision=found.version+1;stale=customer.id;
  const event=(extra:{text?:string;targetId?:string;outcome?:string}={})=>{data.events!.push({at:now,by,action:input.action,...extra});};
  const hand=(target:Member,stamp:'assignedAt'|'delegatedAt'|'reassignedAt',noteText:string)=>{
   requireMember(target);targetName=target.name;
   if(data.assigneeId&&data.assigneeId!==target.id)data.previousAssignees!.push(data.assigneeId);
   data.status='assigned';data.assigneeId=target.id;data.supervisorId=target.role==='supervisor'?target.id:target.supervisorId||'';data[stamp]=now;data.assignmentNote=noteText;
   event({targetId:target.id,text:noteText||undefined});
  };
  if(input.action==='take'){
   if(!allowed.take)throw new CRMError('لا يمكنك تولّي هذا الطلب',403);
   data.handlerId=by;data.handlerAt=now;data.handlerBy=by;event({targetId:by});
  }else if(input.action==='assign'){
   if(!allowed.assign)throw new CRMError('التكليف لمدير خدمة العملاء ومدير النظام فقط',403);
   const target=supportCandidates(found,customer,c,'assign').find(person=>person.id===input.targetId),member=target&&c.members.find(m=>m.id===target.id);
   if(!member)throw new CRMError('اختر ممثلًا لخدمة العملاء يغطي فرع العميل ومنطقته',403);
   requireMember(member);targetName=member.name;
   data.handlerId=member.id;data.handlerAt=now;data.handlerBy=by;event({targetId:member.id});
  }else if(input.action==='submit'){
   if(!allowed.submit)throw new CRMError('رفع نتيجة التواصل للمتولّي أو لمدير خدمة العملاء',403);
   checkDate(input.outcome,input.nextDate);
   if(!data.handlerId){data.handlerId=by;data.handlerAt=now;data.handlerBy=by;}
   // The manager of the member who took it reviews it; a manager who took it reviews it themselves; an administrator's waits for an administrator.
   const holder=c.members.find(member=>member.id===data.handlerId);
   const serviceManagerId=holder?.role==='customer_service'?registrarManager(holder.id,c.members):holder?.role==='customer_service_manager'?holder.id:'';
   const manager=serviceManagerId&&serviceManagerId!==by?c.members.find(member=>member.id===serviceManagerId):undefined;
   if(manager)requireMember(manager);
   note=input.note;
   // The evaluation counts the time to the first submission, so a correction keeps the moment of the first.
   data.result={outcome:input.outcome,note:input.note,nextDate:input.nextDate,by,at:data.status==='returned'&&data.result?.at?data.result.at:now};
   data.status='submitted';data.submittedAt=now;data.returnNote='';data.serviceManagerId=serviceManagerId;
   event({outcome:input.outcome,text:input.note});
  }else if(input.action==='forward'){
   if(!allowed.forward)throw new CRMError('إحالة الطلب لمدير خدمة العملاء ومدير النظام',403);
   const target=supportCandidates(found,customer,c,'forward').find(person=>person.id===input.targetId),member=target&&c.members.find(m=>m.id===target.id);
   if(!member)throw new CRMError('اختر مدير المبيعات المرتبط بك',403);
   requireMember(member);targetName=member.name;
   if(reader.lead)data.serviceManagerId=by;
   data.status='pending_assignment';data.salesManagerId=member.id;data.forwardedAt=now;event({targetId:member.id});
  }else if(input.action==='return'){
   if(!allowed.return)throw new CRMError('إعادة الطلب للتعديل لمدير خدمة العملاء ومدير النظام',403);
   if(reader.lead)data.serviceManagerId=by;
   note=input.note;data.status='returned';data.returnedAt=now;data.returnNote=input.note;event({text:input.note});
  }else if(input.action==='allocate'||input.action==='delegate'||input.action==='reassign'){
   if(!allowed[input.action])throw new CRMError(input.action==='allocate'?'التكليف لمدير المبيعات الذي أُحيل إليه الطلب':input.action==='delegate'?'التفويض لمشرف المبيعات الذي يحمل الطلب':'إعادة التكليف لمدير المبيعات الذي أُحيل إليه الطلب',403);
   const target=supportCandidates(found,customer,c,input.action).find(person=>person.id===input.targetId),member=target&&c.members.find(m=>m.id===target.id);
   if(!member)throw new CRMError(input.action==='delegate'?'اختر مندوبًا من فريقك يغطي منطقة العميل':'اختر مندوبًا أو مشرفًا في فرع العميل يغطي منطقته',403);
   note=input.note;hand(member,input.action==='allocate'?'assignedAt':input.action==='delegate'?'delegatedAt':'reassignedAt',input.note);
  }else if(input.action==='resolve'){
   if(!allowed.resolve)throw new CRMError('تسجيل نتيجة التواصل لمن كُلِّف بالطلب',403);
   checkDate(input.outcome,input.nextDate);
   note=input.note;data.status='resolved';data.resolvedAt=now;data.resolution={outcome:input.outcome,note:input.note,nextDate:input.nextDate,by,at:now,channel:input.channel};event({outcome:input.outcome,text:input.note});
  }else if(input.action==='reject'){
   if(!allowed.reject)throw new CRMError('إعادة الطلب إلى المندوب لمن تولّاه أو لمدير خدمة العملاء',403);
   note=input.reason;data.status='assigned';data.rejectedAt=now;data.rejectReason=input.reason;delete data.resolution;event({text:input.reason});
  }else if(input.action==='close'){
   if(!allowed.close)throw new CRMError('إغلاق الطلب لمن تولّاه أو لمدير خدمة العملاء بعد مراجعة نتيجة المندوب',403);
   note=input.note;data.status='done';data.closedAt=now;data.closure={note:input.note,by,at:now};event({text:input.note||undefined});
  }else if(input.action==='cancel'){
   if(!allowed.cancel)throw new CRMError('إلغاء الطلب لصاحبه أو لمن فوقه في المبيعات أو لمدير النظام، قبل أن يُكلَّف به أحد',403);
   note=input.reason;data.status='cancelled';data.cancelledBy=by;data.cancelledAt=now;data.cancelReason=input.reason;event({text:input.reason||undefined});
  }else{
   if(found.data.answerSeenAt)return Response.json({ok:true,id,alreadySeen:true});
   if(!allowed.seen)throw new CRMError('الاطلاع على الرد لصاحب الطلب أو مسؤول العميل أو من كُلِّف به',403);
   data.answerSeenAt=now;data.answerSeenBy=by;
  }
  state=supportState(data);
  statements.push(c.db.prepare(`UPDATE crm_records SET data=?,updated_at=?,version=version+1,mutation_id=? WHERE id=? AND version=? AND kind='support' AND ${rootGuard} AND ${guards.join(' AND ')}`).bind(JSON.stringify(data),now,mutation,id,found.version,customer.id,customer.version,...args));
 }
 const gate='EXISTS(SELECT 1 FROM crm_records WHERE id=? AND version=? AND mutation_id=?)',ga=[id,revision,mutation];
 statements.push(c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(receiptId,id,c.me.name,'support-receipt',canonical,now,...ga));
 statements.push(c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(crypto.randomUUID(),id,c.me.name,'support:'+input.action,JSON.stringify({label:supportActions[input.action],note,targetName,state}),now,...ga));
 let result;try{result=await c.db.batch(statements);}catch(e){const again=await replay();if(again)return again;throw e;}
 if(result[0].meta.changes!==1){
  const again=await replay();if(again)return again;
  if(input.action==='request'){
   if(await c.db.prepare('SELECT 1 AS found FROM crm_records WHERE id=?').bind(id).first())throw new CRMError('سبق أن تولّى زميل التواصل مع هذا العميل. حدّث القائمة.',409);
   if(await c.db.prepare("SELECT 1 AS found FROM crm_records WHERE kind='support' AND json_extract(data,'$.customerId')=? AND json_extract(data,'$.status') NOT IN ('done','cancelled')").bind(stale).first())throw new CRMError('يوجد طلب مساندة مفتوح لهذا العميل',409);
  }
  throw new CRMError('تغيّرت البيانات أو الصلاحيات أثناء الحفظ. حدّث الصفحة.',409);
 }
 return Response.json({ok:true,id});
}catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(issue=>issue.message).join(' • ')},{status:400});return replyError(e);}}
