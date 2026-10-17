import {z} from 'zod';
import {context,accessGuard,checkOrigin,requireSession,readJsonBody,CRMError,replyError} from '@/lib/crm-server';
import {today,type Member} from '@/lib/crm';
import {regionScope} from '@/lib/regions';
import {COMPLAINT_DEMAND_MAX,COMPLAINT_LIST_LIMIT,COMPLAINT_SHORT_MAX,COMPLAINT_TEXT_MAX,canReadComplaint,canRegisterComplaint,closureOutcomes,complaintActions,complaintBadge,complaintCandidates,complaintCategories,complaintChannels,complaintPermissions,complaintQueue,complaintReader,isOpenComplaint,registrarManager,resolutionOutcomes,type ComplaintData} from '@/lib/complaints';
import {loadComplaint,loadComplaints} from '@/lib/complaint-rows';
export const dynamic='force-dynamic';

/** Re-checks at commit that a member named in the change is still who they were when it was decided. */
function memberGate(m:Member){return{sql:"EXISTS(SELECT 1 FROM crm_members WHERE id=? AND role=? AND active=? AND branch=? AND COALESCE(supervisor_id,'')=? AND region_scope=?)",args:[m.id,m.role,m.active,m.branch,m.supervisorId||'',regionScope(m)]};}

/** What the signed-in member may see: customer service its branch and region, sales members what was handed to them or their
 * team holds, administrators everything. Read-only and never cached. */
export async function GET(){try{
 const probe=await context({load:'identity'});
 const c=['admin','customer_service','customer_service_manager'].includes(probe.me.role)?await context():await context({load:'directory'});
 const now=new Date().toISOString(),complaints=await loadComplaints(c.db,now);
 // The list is cut to what a page can show, but the counts and the badge are taken from the whole of it.
 const every=complaintQueue({me:c.me,members:c.members,all:c.all,complaints},now,Infinity);
 return Response.json({generatedAt:now,complaints:every.slice(0,COMPLAINT_LIST_LIMIT),counts:{complaints:every.length,open:every.filter(entry=>isOpenComplaint(entry)).length,badge:complaintBadge(every)}},{headers:{'Cache-Control':'no-store'}});
}catch(e){return replyError(e);}}

const requestId=z.string().uuid(),idText=z.string().min(1).max(200),version=z.number().int().positive();
const longText=z.string().trim().max(COMPLAINT_TEXT_MAX),shortText=z.string().trim().max(COMPLAINT_SHORT_MAX).default('');
const said=(min:number,message:string)=>longText.pipe(z.string().min(min,message));
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'اختر تاريخًا صحيحًا').refine(value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'التاريخ غير صالح');
const keysOf=(table:Record<string,string>)=>z.enum(Object.keys(table) as [string,...string[]]);
const report={channel:keysOf(complaintChannels),category:keysOf(complaintCategories),severity:z.enum(['normal','high']).default('normal'),description:said(10,'اكتب وصف الشكوى في 10 أحرف على الأقل'),demand:z.string().trim().max(COMPLAINT_DEMAND_MAX).default(''),reference:shortText,contactName:shortText,contactPhone:z.string().trim().max(100).default('')};
const handing={requestId,id:idText,version,targetId:idText,note:z.string().trim().max(COMPLAINT_TEXT_MAX).default('')};
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('register'),requestId,customerId:idText,customerVersion:version,...report}).strict(),
 z.object({action:z.literal('edit'),requestId,id:idText,version,...report}).strict(),
 z.object({action:z.literal('forward'),requestId,id:idText,version,targetId:idText}).strict(),
 z.object({action:z.literal('return'),requestId,id:idText,version,note:said(3,'اكتب ما يلزم تعديله في 3 أحرف على الأقل')}).strict(),
 z.object({action:z.literal('assign'),...handing}).strict(),
 z.object({action:z.literal('delegate'),...handing}).strict(),
 z.object({action:z.literal('reassign'),...handing}).strict(),
 z.object({action:z.literal('seen'),requestId,id:idText,version}).strict(),
 z.object({action:z.literal('update'),requestId,id:idText,version,channel:keysOf(complaintChannels),text:said(3,'اكتب ما حدث في التواصل في 3 أحرف على الأقل'),date:z.union([day,z.literal('')]).default('')}).strict(),
 z.object({action:z.literal('resolve'),requestId,id:idText,version,outcome:keysOf(resolutionOutcomes),note:said(3,'اكتب ما تم لحل الشكوى في 3 أحرف على الأقل')}).strict(),
 z.object({action:z.literal('reject'),requestId,id:idText,version,reason:said(3,'اكتب سبب الإعادة في 3 أحرف على الأقل')}).strict(),
 z.object({action:z.literal('close'),requestId,id:idText,version,outcome:keysOf(closureOutcomes),note:longText.default(''),rating:z.number().int().min(1,'التقييم من 1 إلى 5').max(5,'التقييم من 1 إلى 5').optional()}).strict(),
 z.object({action:z.literal('reopen'),requestId,id:idText,version,reason:said(3,'اكتب سبب إعادة الفتح في 3 أحرف على الأقل')}).strict(),
 z.object({action:z.literal('cancel'),requestId,id:idText,version,reason:z.string().trim().max(500).default('')}).strict(),
 z.object({action:z.literal('note'),requestId,id:idText,version,text:said(3,'اكتب الملاحظة في 3 أحرف على الأقل')}).strict()
]);

export async function POST(req:Request){try{
 checkOrigin(req);await requireSession();
 const input=schema.parse(await readJsonBody(req));
 const c=await context(),now=new Date().toISOString(),mutation=crypto.randomUUID(),reader=complaintReader(c);
 const canonical=JSON.stringify(input),receiptId='complaint-receipt:'+c.me.id+':'+input.requestId;
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
 const statements=[];let id='',revision=1,note='',targetName='',state='';
 const by=c.me.id;

 if(input.action==='register'){
  const customer=c.all.find(row=>row.id===input.customerId&&row.kind==='customer');
  if(!customer)throw new CRMError('العميل غير متاح',404);
  if(input.customerVersion!==customer.version)throw new CRMError('تغيّرت بيانات العميل. حدّث الصفحة.',409);
  if(!canRegisterComplaint(customer,c))throw new CRMError('تسجيل الشكاوى لخدمة العملاء في فرع العميل ومنطقته',403);
  // The registrar's own manager reviews it; a manager registering reviews his own; an administrator's waits for an administrator.
  const serviceManagerId=c.me.role==='customer_service'?registrarManager(c.me.id,c.members):c.me.role==='customer_service_manager'?c.me.id:'';
  const manager=serviceManagerId&&serviceManagerId!==c.me.id?c.members.find(member=>member.id===serviceManagerId):undefined;
  if(manager)requireMember(manager);
  id='complaint-'+input.requestId;note=input.description;
  const data:ComplaintData={kind:'complaint',customerId:customer.id,status:'submitted',registrarId:by,serviceManagerId,salesManagerId:'',supervisorId:'',assigneeId:'',
   channel:input.channel,category:input.category,severity:input.severity,description:input.description,demand:input.demand,reference:input.reference,contactName:input.contactName||String(customer.data.contact||''),contactPhone:input.contactPhone||String(customer.data.phone||''),
   submittedAt:now,forwardedAt:'',returnedAt:'',assignedAt:'',delegatedAt:'',reassignedAt:'',rejectedAt:'',reopenedAt:'',resolvedAt:'',closedAt:'',cancelledAt:'',seenAt:'',
   returnNote:'',assignmentNote:'',rejectReason:'',cancelReason:'',previousAssignees:[],updates:[],notes:[],events:[{at:now,by,action:'register'}]};
  state=data.status;
  statements.push(c.db.prepare(`INSERT OR IGNORE INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) SELECT ?,'complaint',NULL,?,?,?,?,?,1,? WHERE ${guards.join(' AND ')} AND ${rootGuard}`).bind(id,by,customer.branch,JSON.stringify(data),now,now,mutation,...args,customer.id,customer.version));
 }else{
  const found=await loadComplaint(c.db,input.id);
  const customer=found&&c.all.find(row=>row.id===found.data.customerId&&row.kind==='customer');
  if(!found||!customer||!canReadComplaint(found,customer,reader,c.members))throw new CRMError('الشكوى غير متاحة',403);
  if(input.version!==found.version)throw new CRMError('تغيّرت الشكوى. حدّث البيانات قبل إعادة المحاولة.',409);
  const allowed=complaintPermissions(found,customer,reader,c.members,now),data:ComplaintData={...found.data,previousAssignees:[...(found.data.previousAssignees||[])],updates:[...(found.data.updates||[])],notes:[...(found.data.notes||[])],events:[...(found.data.events||[])]};
  id=found.id;revision=found.version+1;
  const event=(extra:{text?:string;targetId?:string;outcome?:string;rating?:number}={})=>data.events.push({at:now,by,action:input.action,...extra});
  const hand=(target:Member,stamp:'assignedAt'|'delegatedAt'|'reassignedAt',noteText:string)=>{
   requireMember(target);targetName=target.name;
   if(data.assigneeId&&data.assigneeId!==target.id)data.previousAssignees.push(data.assigneeId);
   data.status='assigned';data.assigneeId=target.id;data.supervisorId=target.role==='supervisor'?target.id:target.supervisorId||'';data[stamp]=now;data.assignmentNote=noteText;
   event({targetId:target.id,text:noteText});
  };
  if(input.action==='edit'){
   if(!allowed.edit)throw new CRMError('تعديل الشكوى لمن سجّلها ما دامت لم تُحل بعد',403);
   Object.assign(data,{channel:input.channel,category:input.category,severity:input.severity,description:input.description,demand:input.demand,reference:input.reference,contactName:input.contactName||data.contactName,contactPhone:input.contactPhone||data.contactPhone});
   if(data.status==='returned'){data.status='submitted';data.submittedAt=now;data.returnNote='';}
   note=input.description;event();
  }else if(input.action==='forward'){
   if(!allowed.forward)throw new CRMError('إحالة الشكوى لمدير خدمة العملاء ومدير النظام',403);
   const target=complaintCandidates(found,customer,c,'forward').find(person=>person.id===input.targetId),member=target&&c.members.find(m=>m.id===target.id);
   if(!member)throw new CRMError('اختر مدير المبيعات المرتبط بك',403);
   requireMember(member);targetName=member.name;
   if(reader.lead)data.serviceManagerId=by;
   data.status='pending_assignment';data.salesManagerId=member.id;data.forwardedAt=now;event({targetId:member.id});
  }else if(input.action==='return'){
   if(!allowed.return)throw new CRMError('إعادة الشكوى للتعديل لمدير خدمة العملاء ومدير النظام',403);
   if(reader.lead)data.serviceManagerId=by;
   note=input.note;data.status='returned';data.returnedAt=now;data.returnNote=input.note;event({text:input.note});
  }else if(input.action==='assign'||input.action==='delegate'||input.action==='reassign'){
   if(!allowed[input.action])throw new CRMError(input.action==='assign'?'التكليف لمدير المبيعات الذي أُحيلت إليه الشكوى':input.action==='delegate'?'التفويض لمشرف المبيعات الذي يحمل الشكوى':'إعادة التكليف لمدير المبيعات الذي أُحيلت إليه الشكوى',403);
   const target=complaintCandidates(found,customer,c,input.action).find(person=>person.id===input.targetId),member=target&&c.members.find(m=>m.id===target.id);
   if(!member)throw new CRMError(input.action==='delegate'?'اختر مندوبًا من فريقك يغطي منطقة العميل':'اختر مندوبًا أو مشرفًا في فرع العميل يغطي منطقته',403);
   note=input.note;hand(member,input.action==='assign'?'assignedAt':input.action==='delegate'?'delegatedAt':'reassignedAt',input.note);
  }else if(input.action==='seen'){
   if(!allowed.seen)return Response.json({ok:true,id,alreadySeen:true});
   data.seenAt=now;
  }else if(input.action==='update'){
   if(!allowed.update)throw new CRMError('التحديث لمن يحمل الشكوى',403);
   note=input.text;data.updates.push({id:'u-'+input.requestId,at:now,by,channel:input.channel,date:input.date||today(),text:input.text});
  }else if(input.action==='resolve'){
   if(!allowed.resolve)throw new CRMError('تسجيل الحل لمن يحمل الشكوى',403);
   note=input.note;data.status='resolved';data.resolvedAt=now;data.resolution={outcome:input.outcome,note:input.note,by,at:now};event({outcome:input.outcome,text:input.note});
  }else if(input.action==='reject'){
   if(!allowed.reject)throw new CRMError('إعادة الشكوى إلى المندوب لمن سجّلها أو لمدير خدمة العملاء',403);
   note=input.reason;data.status='assigned';data.rejectedAt=now;data.rejectReason=input.reason;delete data.resolution;event({text:input.reason});
  }else if(input.action==='close'){
   if(!allowed.close)throw new CRMError('إغلاق الشكوى لمن سجّلها أو لمدير خدمة العملاء بعد تأكيد العميل',403);
   // The customer's rating out of 5 is optional, and only a customer who was reached and gave an opinion can give one.
   if(input.rating&&!['satisfied','not_satisfied'].includes(input.outcome))throw new CRMError('تقييم العميل متاح عند رضاه أو عدم رضاه فقط',400);
   const rated=input.rating?{rating:input.rating}:{};
   note=input.note;data.status='closed';data.closedAt=now;data.closure={outcome:input.outcome,note:input.note,by,at:now,...rated};event({outcome:input.outcome,text:input.note,...rated});
  }else if(input.action==='reopen'){
   if(!allowed.reopen)throw new CRMError('إعادة فتح الشكوى لخدمة العملاء خلال 14 يومًا من إغلاقها',403);
   note=input.reason;data.status='assigned';data.reopenedAt=now;delete data.closure;delete data.resolution;data.rejectReason='';event({text:input.reason});
  }else if(input.action==='cancel'){
   if(!allowed.cancel)throw new CRMError('إلغاء الشكوى لمن سجّلها أو لمدير خدمة العملاء ما دامت لم تُكلَّف بعد',403);
   note=input.reason;data.status='cancelled';data.cancelledAt=now;data.cancelReason=input.reason;event({text:input.reason});
  }else{
   if(!allowed.note)throw new CRMError('الملاحظة لمن يرى الشكوى ما دامت مفتوحة',403);
   note=input.text;data.notes.push({id:'n-'+input.requestId,at:now,by,text:input.text});
  }
  state=data.status;
  statements.push(c.db.prepare(`UPDATE crm_records SET data=?,updated_at=?,version=version+1,mutation_id=? WHERE id=? AND version=? AND kind='complaint' AND ${rootGuard} AND ${guards.join(' AND ')}`).bind(JSON.stringify(data),now,mutation,id,found.version,customer.id,customer.version,...args));
 }
 const gate='EXISTS(SELECT 1 FROM crm_records WHERE id=? AND version=? AND mutation_id=?)',ga=[id,revision,mutation];
 statements.push(c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(receiptId,id,c.me.name,'complaint-receipt',canonical,now,...ga));
 statements.push(c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(crypto.randomUUID(),id,c.me.name,'complaint:'+input.action,JSON.stringify({label:complaintActions[input.action],note,targetName,state}),now,...ga));
 let result;try{result=await c.db.batch(statements);}catch(e){const again=await replay();if(again)return again;throw e;}
 if(result[0].meta.changes!==1){
  const again=await replay();if(again)return again;
  if(input.action==='register'&&await c.db.prepare('SELECT 1 AS found FROM crm_records WHERE id=?').bind(id).first())throw new CRMError('سبق تسجيل هذه الشكوى. حدّث القائمة.',409);
  throw new CRMError('تغيّرت البيانات أو الصلاحيات أثناء الحفظ. حدّث الصفحة.',409);
 }
 return Response.json({ok:true,id});
}catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(issue=>issue.message).join(' • ')},{status:400});return replyError(e);}}
