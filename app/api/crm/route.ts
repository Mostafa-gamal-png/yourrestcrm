import {readJsonBody,isRecord} from '@/lib/crm-server';
import {canUseSalesWorkspace,salesScopeMemberIds,recordAuthorId} from '@/lib/access';
import {activeServiceCase,serviceHistoryLocked,isServiceRole,serviceVisitRecords,canReadService} from '@/lib/customer-service';
import {requireSalesRole} from '@/lib/crm-server';
import {z} from 'zod';
import {regionScopes,regionScope,memberCanAccessRegion} from '@/lib/regions';
import {validateFollowup,prepareContactEvidence,requireLegacyVisit,preserveRequestResponsible} from '@/lib/followups-server';
import {prepareCustomerLocation} from '@/lib/customer-fields';
import {context,CRMError,replyError,checkOrigin,accessGuard,masterMutationGuard,customerDetailMutationGuard,recordEditGuard,requireRecordEdit} from '@/lib/crm-server';
import {schemas,quoteTotals,isOpen,type AuditEntry,type Kind} from '@/lib/crm';
import {normalizeMemberEmail,memberEmailError} from '@/lib/member-email';
import {memberEditToken} from '@/lib/member-edit';
import {offlineCapture,offlineEvidence} from '@/lib/offline-server';
export const dynamic='force-dynamic';
export async function GET(){try{
 const c=await context({load:'directory'}),scope=salesScopeMemberIds(c.members,c.me),ids=new Set(c.visible.map(r=>r.id));
 const names=new Set(c.members.filter(m=>scope.has(m.id)&&c.members.every(other=>other.name!==m.name||scope.has(other.id))).map(m=>m.name));
 const masterIds=new Set(c.visible.filter(r=>['customer','factory'].includes(r.kind)).map(r=>r.id)),activityIds=new Set(c.visible.filter(r=>r.kind==='activity').map(r=>r.id));
 const audits=(await c.db.prepare("SELECT id,record_id AS recordId,actor,action,detail,created_at AS createdAt FROM crm_audit WHERE action NOT IN ('حفظ متابعة','visit-receipt','service-receipt','crm-create-receipt') AND action NOT LIKE 'service:%' ORDER BY created_at DESC LIMIT 500").all<AuditEntry>()).results.filter(a=>ids.has(a.recordId)&&(c.me.role==='rep'?activityIds.has(a.recordId):c.me.role==='admin'||!masterIds.has(a.recordId)||names.has(a.actor)));
 const projectMember=(member:typeof c.me)=>({...member,userId:undefined,target:canUseSalesWorkspace(c.me.role)?member.target:undefined,...(c.me.role==='admin'&&regionScope(c.me)==='all'?{editToken:memberEditToken(member)}:{})});
 const members=c.regionalMembers.filter(m=>isServiceRole(c.me.role)?m.id===c.me.id||m.supervisorId===c.me.id:scope.has(m.id)).map(projectMember),memberIds=new Set(members.map(m=>m.id));
 const authors=new Set(c.visible.filter(r=>['activity','opportunity','quote'].includes(r.kind)).map(r=>recordAuthorId(r,c.members)));
 for(const member of c.members)if(scope.has(member.id)&&authors.has(member.id)&&!memberIds.has(member.id))members.push({...projectMember(member),userId:undefined,authVersion:undefined,target:undefined,readOnly:true});
 return Response.json({records:serviceVisitRecords(c).map(r=>{const intake=r.kind==='customer'?activeServiceCase(r.id,c):undefined;return intake?.status==='assigned'&&canReadService(intake,c)?{...r,data:{...r.data,_serviceIntake:{id:intake.id,createdAt:intake.createdAt,products:intake.data.products,strength:intake.data.strength,needs:intake.data.needs,nextAction:intake.data.nextAction,nextDate:intake.data.nextDate}}}:r;}),me:projectMember(c.me),members,audits},{headers:{'Cache-Control':'no-store'}});
}catch(e){return replyError(e);}}
export async function POST(req:Request){try{
 checkOrigin(req);const body=await readJsonBody(req);if(JSON.stringify(body).length>150000)throw new CRMError('حجم الطلب كبير');const c=await context();const serviceCustomerCreate=isServiceRole(c.me.role)&&body.action==='save'&&body.kind==='customer'&&!body.id&&!body.parentId;if(!serviceCustomerCreate)requireSalesRole(c.me);const now=new Date().toISOString();const mutation=crypto.randomUUID();const canManage=['admin','manager'].includes(c.me.role);
 const offline=offlineCapture(body,c.me.id,now);if(offline&&(body.action!=='save'||body.kind!=='customer'||body.id||body.parentId||!body.createKey))throw new CRMError('هذا الإجراء يتطلب اتصالًا مباشرًا.');
 const bodyData=isRecord(body.data)?body.data:undefined;
 if(body.action==='member'){
  if(c.me.role!=='admin'||regionScope(c.me)!=='all')throw new CRMError('إدارة المستخدمين متاحة لمدير النظام فقط',403);
  const m=z.object({id:z.string().optional(),name:z.string().trim().min(1).max(100),email:z.string({required_error:memberEmailError,invalid_type_error:memberEmailError}).transform(normalizeMemberEmail).pipe(z.string().email(memberEmailError).max(200,memberEmailError)),role:z.enum(['admin','manager','supervisor','rep','customer_service_manager','customer_service']),branch:z.string().trim().min(1).max(100),supervisorId:z.string().default(''),regionScope:z.string().refine(v=>(regionScopes as readonly string[]).includes(v),'اختر منطقة البيانات المسموح بها').default('all'),active:z.coerce.number().int().min(0).max(1),target:z.coerce.number().finite().min(0).max(1000000000)}).parse(body.data);
  if(!m.email.endsWith('@yourrest.org'))throw new CRMError('استخدم بريد الشركة @yourrest.org');
  if(m.id==='owner'&&(m.role!=='admin'||!m.active||m.regionScope!=='all'))throw new CRMError('لا يمكن تعطيل مدير النظام الأساسي أو تغيير دوره');
  if(m.supervisorId&&(m.supervisorId===m.id||!c.members.find(x=>x.id===m.supervisorId&&(m.role==='customer_service'?['customer_service_manager']:m.role==='customer_service_manager'?['manager']:['supervisor','manager','admin']).includes(x.role))))throw new CRMError('اختر مشرفًا صحيحًا');
  const supervisorChain:typeof c.members=[];
  if(m.supervisorId){const seen=new Set([m.id]);let current=m.supervisorId;while(current){if(seen.has(current))throw new CRMError('لا يمكن إنشاء حلقة في التسلسل الإداري');seen.add(current);const ancestor=c.members.find(x=>x.id===current);if(ancestor)supervisorChain.push(ancestor);current=ancestor?.supervisorId||'';}}
  if(c.members.some(x=>x.email===m.email.toLowerCase()&&x.id!==m.id))throw new CRMError('البريد مسجل بالفعل');
  const memberGuard=accessGuard(c);
  // Freeze the validated chain too: concurrent edits to separate rows must not
  // create a cycle or assign to a supervisor whose role changed before commit.
  for(const ancestor of supervisorChain){memberGuard.sql+=" AND EXISTS (SELECT 1 FROM crm_members WHERE id=? AND role=? AND COALESCE(supervisor_id,'')=? AND auth_version=?)";memberGuard.args.push(ancestor.id,ancestor.role,ancestor.supervisorId||'',ancestor.authVersion||0);}
  if(m.id){
   const old=c.members.find(x=>x.id===m.id);if(!old)throw new CRMError('المستخدم غير موجود');
   const conflict=()=>Response.json({error:'تغيّرت بيانات المستخدم أو صلاحياتك. حمّل أحدث البيانات وراجعها قبل الحفظ.',code:'MEMBER_CONFLICT'},{status:409});
   if(typeof body.memberSnapshot!=='string'||body.memberSnapshot!==memberEditToken(old))return conflict();
   if(old.userId&&old.email!==m.email.toLowerCase())throw new CRMError('لا يمكن تغيير بريد حساب مرتبط بتسجيل الدخول');
   // Guard the row again inside the write: another admin may save after context().
   const targetGuard="name=? AND email=? AND role=? AND branch=? AND COALESCE(supervisor_id,'')=? AND region_scope=? AND active=? AND target=? AND auth_version=?";
   const saved=await c.db.prepare('UPDATE crm_members SET name=?,email=?,role=?,branch=?,supervisor_id=?,region_scope=?,active=?,target=? WHERE id=? AND '+targetGuard+' AND '+memberGuard.sql).bind(m.name,m.email.toLowerCase(),m.role,m.branch,m.supervisorId||null,m.regionScope,m.active,m.target,m.id,old.name,old.email,old.role,old.branch,old.supervisorId||'',regionScope(old),old.active,old.target,old.authVersion||0,...memberGuard.args).run();
   if(saved.meta.changes!==1)return conflict();
  }
  else {const saved=await c.db.prepare('INSERT INTO crm_members (id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE '+memberGuard.sql).bind(crypto.randomUUID(),m.email.toLowerCase(),m.name,m.role,m.branch,m.supervisorId||null,m.regionScope,m.active,m.target,now,...memberGuard.args).run();if(saved.meta.changes!==1)throw new CRMError('تغيّرت صلاحياتك. حدّث الصفحة.',409);}
  return Response.json({ok:true});
 }
 const kind=body.kind as Kind;if(!schemas[kind])throw new CRMError('نوع سجل غير صحيح');
 // Customer detail edits are regional; reps cannot delete, reassign, or edit commercial records.
 const repCustomerCreate=c.me.role==='rep'&&kind==='customer'&&body.action==='save'&&!body.id&&!body.parentId;
 const repCustomerEdit=c.me.role==='rep'&&kind==='customer'&&body.action==='save'&&!!body.id&&!body.parentId;
 if(c.me.role==='rep'&&['customer','factory','opportunity','quote'].includes(kind)&&!repCustomerCreate&&!repCustomerEdit)throw new CRMError('يمكنك إضافة عميل جديد وتسجيل الزيارات والمتابعات؛ تعديل بيانات العملاء متاح للإدارة فقط',403);
 if(repCustomerCreate&&!body.createKey)throw new CRMError('تعذر تحديد عملية إضافة العميل. أعد فتح النموذج ثم حاول مرة أخرى.');
 const genericCreateKey=kind!=='activity'&&body.action==='save'&&!body.id&&body.createKey?z.string().uuid().parse(body.createKey):null;
 const genericId=genericCreateKey?'crm-'+c.me.id+'-'+genericCreateKey:'';
 const genericReceiptId='crm-create:'+c.me.id+':'+genericCreateKey;
 const genericFingerprint=genericCreateKey?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body))))).map(n=>n.toString(16).padStart(2,'0')).join(''):'';
 const replayCreate=async()=>{if(!genericCreateKey)return null;const receipt=await c.db.prepare('SELECT detail FROM crm_audit WHERE id=? AND record_id=?').bind(genericReceiptId,genericId).first<{detail:string}>();if(!receipt)return null;const fresh=await context(),record=fresh.all.find(r=>r.id===genericId);if(!record||!fresh.visible.some(r=>r.id===record.id)&&!(isServiceRole(fresh.me.role)&&record.kind==='customer'&&record.data._createdBy===fresh.me.id&&record.branch===fresh.me.branch&&memberCanAccessRegion(fresh.me,record.data.region)))throw new CRMError('السجل غير متاح',404);if(receipt.detail!==genericFingerprint)throw new CRMError('تم حفظ هذه العملية بالفعل. أعد فتح السجل لحفظ تعديلات إضافية.',409);return Response.json({ok:true,id:genericId,alreadySaved:true});};
 const createdReplay=await replayCreate();if(createdReplay)return createdReplay;
 const clockAction=body.clockAction===undefined?undefined:z.enum(['start','finish']).parse(body.clockAction);if(clockAction&&(kind!=='activity'||body.action!=='save'))throw new CRMError('عملية توقيت غير صالحة');
 let requestFingerprint='';
 if(kind==='activity'&&body.action==='save'){
  const fields=['type','summary','result','outcome','notes','location','nextAction','nextDate',...(clockAction?[]:['date','startedAt','endedAt'])];
  const input=JSON.stringify([body.parentId||'',clockAction||'',body.syncFollowup??null,...fields.map(key=>[key,bodyData?.[key]??''])]);
  requestFingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input)))).map(n=>n.toString(16).padStart(2,'0')).join('');
 }
 const replayReply=(record:{id:string;version:number;data:Record<string,unknown>},field:string)=>record.data[field]===requestFingerprint?Response.json({ok:true,id:record.id,alreadySaved:true}):Response.json({error:'الزيارة محفوظة بالفعل، لكن توجد تعديلات جديدة لم تُحفظ. راجعها واضغط حفظ مرة أخرى.',existingId:record.id,existingVersion:record.version},{status:409});
 const createKey=kind==='activity'&&!body.id&&body.createKey?z.string().uuid().parse(body.createKey):null;
 if(createKey){const existing=c.all.find(r=>r.id==='visit-'+createKey);if(existing){if(!c.visible.some(r=>r.id===existing.id))throw new CRMError('السجل غير متاح',404);return replayReply(existing,'_creationRequest');}}
 const projectedOld=body.id?c.visible.find(r=>r.id===body.id&&r.kind===kind):undefined;
 const old=projectedOld?c.all.find(r=>r.id===projectedOld.id):null;
 if(body.id&&!old)throw new CRMError('السجل غير موجود أو ليس لديك صلاحية',404);
 if(old&&!repCustomerEdit)requireRecordEdit(c.me);
 if(old&&clockAction&&((clockAction==='start'&&old.data.startedAt)||(clockAction==='finish'&&old.data.endedAt)))return replayReply(old,clockAction==='start'?'_startRequest':'_finishRequest');
 if(old&&serviceHistoryLocked(old,c)&&!(c.me.role==='admin'&&body.action==='delete'))throw new CRMError('سجل هذا الطلب محفوظ بعد فتح طلب أحدث للعميل. سجّل المتابعة في الطلب الحالي.',409);
 if(old&&body.version!==old.version)throw new CRMError('تغيّر السجل بواسطة مستخدم آخر. حدّث الصفحة ثم أعد التعديل.',409);
 if(body.action==='delete'){
  if(!old)throw new CRMError('حدد سجلًا');if(!canManage&&old.kind==='customer')throw new CRMError('حذف العملاء متاح للإدارة فقط',403);
  if(old.kind==='customer'&&await c.db.prepare('SELECT code_key FROM crm_customer_code_mappings WHERE customer_id=? LIMIT 1').bind(old.id).first())throw new CRMError('أزل ربط كود ERP قبل حذف هذا العميل.',409);
  if(old.kind==='customer'&&c.serviceCases.some(s=>s.customerId===old.id))throw new CRMError('لا يمكن حذف عميل له سجل خدمة عملاء');
  if(old.kind==='customer'&&await c.db.prepare('SELECT id FROM crm_sales WHERE customer_id=? LIMIT 1').bind(old.id).first())throw new CRMError('لا يمكن حذف عميل له مبيعات مسجلة');
  if(old.kind==='customer'&&await c.db.prepare('SELECT id FROM crm_journey_stops WHERE customer_id=? LIMIT 1').bind(old.id).first())throw new CRMError('لا يمكن حذف عميل له سجل خط سير محفوظ',409);
  if(c.all.some(r=>r.parentId===old.id||r.data.requestId===old.id||r.data.sourceId===old.id))throw new CRMError('يوجد سجلات مرتبطة. احذفها قبل حذف هذا السجل.');
  const permission=['customer','factory'].includes(old.kind)?masterMutationGuard(c,old):recordEditGuard(c,old);
  // The receipt gates every statement in the same transaction. Capture evidence before
  // deleting, and block source-followup races instead of leaving orphaned follow-ups.
  const receipt=crypto.randomUUID(),gate="EXISTS (SELECT 1 FROM crm_audit WHERE id=?)";
  const result=await c.db.batch([
   c.db.prepare(`INSERT INTO crm_audit (id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM crm_records WHERE id=? AND version=? AND NOT EXISTS (SELECT 1 FROM crm_records child WHERE child.parent_id=crm_records.id OR json_extract(child.data,'$.requestId')=crm_records.id OR json_extract(child.data,'$.sourceId')=crm_records.id) AND NOT EXISTS (SELECT 1 FROM crm_journey_stops journey WHERE journey.customer_id=crm_records.id) AND NOT EXISTS (SELECT 1 FROM crm_customer_code_mappings identity WHERE identity.customer_id=crm_records.id)) AND ${permission.sql}`).bind(receipt,old.id,c.me.name,'حذف',JSON.stringify({kind,deletedBy:c.me.id,record:old}),now,old.id,old.version,...permission.args),
   c.db.prepare(`UPDATE crm_records SET data=json_remove(data,'$._visitPlan'),version=version+1,updated_at=? WHERE json_extract(data,'$._visitPlan.visitId')=? AND ${gate}`).bind(now,old.id,receipt),
   c.db.prepare(`UPDATE crm_records SET data=json_remove(data,'$._stageVisitId'),version=version+1,updated_at=? WHERE json_extract(data,'$._stageVisitId')=? AND ${gate}`).bind(now,old.id,receipt),
   ...(old.data.serviceCaseId?[c.db.prepare(`UPDATE crm_records SET version=version+1,updated_at=? WHERE id=(SELECT customer_id FROM crm_service_cases WHERE id=?) AND ${gate}`).bind(now,old.data.serviceCaseId,receipt)]:[]),
   c.db.prepare(`DELETE FROM crm_records WHERE id=? AND version=? AND ${gate}`).bind(old.id,old.version,receipt)
  ]);if(result[0].meta.changes!==1)throw new CRMError('تغيّر السجل أو تمت إضافة سجلات مرتبطة. حدّث البيانات وراجعها قبل الحذف.',409);return Response.json({ok:true});
 }
 if(body.action!=='save')throw new CRMError('عملية غير صحيحة');
 if(kind==='activity')requireLegacyVisit(body.data,old||undefined);
 if(repCustomerEdit&&old&&(bodyData?.assignedTo!==undefined&&bodyData.assignedTo!==old.assignedTo||bodyData?.branch!==undefined&&bodyData.branch!==old.branch))throw new CRMError('لا يمكنك تغيير مسؤول العميل أو فرعه',403);
 const input=repCustomerCreate&&bodyData?{...bodyData,assignedTo:c.me.id,branch:c.me.branch}:body.data,inputData=isRecord(input)?input:undefined;
 // Existing routing is canonical on the record, including legacy blank assignees.
 // Do not force a detail correction to choose a new owner or silently repair one.
 const retainCustomerRouting=kind==='customer'&&!!old&&(inputData?.assignedTo===undefined||inputData.assignedTo===old.assignedTo)&&(inputData?.branch===undefined||inputData.branch===old.branch);
 const schema=retainCustomerRouting?schemas.customer.omit({assignedTo:true,branch:true}):schemas[kind];
 const parsed=schema.safeParse(input);if(!parsed.success)throw new CRMError(parsed.error.issues.map(x=>x.message).join(' • '));const data:any=parsed.data;
 if(retainCustomerRouting){data.assignedTo=old!.assignedTo;data.branch=old!.branch;}
 Object.assign(data,offlineEvidence(offline,old?.data));
 const requestedParent=body.parentId?c.visible.find(r=>r.id===body.parentId):undefined;
 const attachLegacyMachine=!!old&&kind==='opportunity'&&c.visible.some(r=>r.id===old.parentId&&r.kind==='customer')&&requestedParent?.kind==='factory'&&requestedParent.parentId===old.parentId;
 const parentId=attachLegacyMachine?requestedParent!.id:old?.parentId||body.parentId||null;
 if(old&&body.parentId&&body.parentId!==old.parentId&&!attachLegacyMachine&&body.parentId!==projectedOld?.parentId)throw new CRMError('لا يمكن تغيير ارتباط السجل بعد إنشائه');
 const parentVisible=!!parentId&&c.visible.some(r=>r.id===parentId);
 // Own historical entries retain their original link even when its author's scope has changed.
 const parent=parentId&&(parentVisible||old&&old.parentId===parentId)?c.all.find(r=>r.id===parentId):null;
 const expected={factory:'customer',opportunity:'factory',activity:'opportunity',quote:'opportunity'};
 if(kind!=='customer'&&(!parent||(kind==='activity'?!['customer','opportunity'].includes(parent.kind):kind==='opportunity'?!['customer','factory'].includes(parent.kind):parent.kind!==expected[kind])))throw new CRMError('حدد السجل المرتبط أولًا');
 let assignedTo=parent?.assignedTo||c.me.id,branch=parent?.branch||c.me.branch,customerRoutingChanged=false;
 if(kind==='customer'){
  if(old&&activeServiceCase(old.id,c)&&(data.assignedTo!==old.assignedTo||data.branch!==old.branch||data.region!==(old.data.region||'')))throw new CRMError('تغيير مسؤول العميل يتم من تكليف خدمة العملاء أثناء وجود طلب مفتوح',403);
  if(!memberCanAccessRegion(c.me,data.region))throw new CRMError('لا يمكنك إنشاء أو نقل عميل خارج منطقتك المسموح بها',403);
  const locationError=prepareCustomerLocation(data,old?.data);if(locationError)throw new CRMError(locationError);
  if(old&&bodyData?.shortAddress===undefined)data.shortAddress=old.data.shortAddress||'';
  if(old){for(const key of ['sourceFile','sourceRow','sourceKey','sourceHash','_visitPlan','_stageVisitId','_createdBy'])data[key]=old.data[key];}
  else {for(const key of ['sourceFile','sourceRow','sourceKey','sourceHash','_visitPlan','_stageVisitId'])delete data[key];data._createdBy=c.me.id;}
  if(!canManage){data.assignedTo=old?old.assignedTo:c.me.id;data.branch=old?old.branch:c.me.branch;}
  customerRoutingChanged=!old||data.assignedTo!==old.assignedTo||data.branch!==old.branch||data.region!==(old.data.region||'');
  if(customerRoutingChanged){
   const routing=schemas.customer.pick({assignedTo:true,branch:true}).safeParse(data);if(!routing.success)throw new CRMError(routing.error.issues.map(x=>x.message).join(' • '));
   if(!c.members.find(m=>m.id===data.assignedTo&&m.active&&(['admin','manager','supervisor','rep'].includes(m.role)||old?.assignedTo===m.id||serviceCustomerCreate&&m.id===c.me.id)))throw new CRMError('حدد المندوب المسؤول');
   const member=c.members.find(m=>m.id===data.assignedTo)!;if(!memberCanAccessRegion(member,data.region))throw new CRMError('منطقة العميل لا تطابق صلاحية المندوب المسؤول',400);if(regionScope(c.me)!=='all'&&!c.regionalMembers.some(m=>m.id===member.id))throw new CRMError('المندوب خارج نطاق منطقتك',403);if(!['admin','manager'].includes(member.role)&&member.branch!==data.branch)throw new CRMError('فرع يورست المسؤول عن المصنع يجب أن يطابق فرع المندوب');
  }
  assignedTo=data.assignedTo;branch=data.branch;
 }
 if(kind==='factory'){for(const key of ['sourceMachineTypes','sourceMachineCount','sourceFile','sourceRow','sourceKey','sourceHash']){if(old)data[key]=old.data[key];else delete data[key];}}
 if(kind==='opportunity'){preserveRequestResponsible(data,old||undefined);validateFollowup(data,old||undefined,parent!,c,now);}
 if(kind==='opportunity'||kind==='quote'){data.performedBy=old?recordAuthorId(old,c.members)||'':c.me.id;data.recordedByEmail=old?old.data.recordedByEmail||'':c.user.email.toLowerCase();}

 const syncFollowup=kind==='activity'&&parentVisible&&!!parent&&isOpen(parent)&&clockAction!=='start'&&(body.syncFollowup===true||(!old&&body.syncFollowup!==false));
 if(kind==='activity'){
  const serviceCustomer=parent?.kind==='customer'?parent:c.all.find(r=>r.id===parent?.parentId&&r.kind==='customer');const service=serviceCustomer&&activeServiceCase(serviceCustomer.id,c);if(old?.data.serviceCaseId)data.serviceCaseId=old.data.serviceCaseId;else if(!old&&service?.status==='assigned')data.serviceCaseId=service.id;
  for(const field of ['_creationRequest','_startRequest','_finishRequest'])if(old?.data[field])data[field]=old.data[field];
  if(!old)data._creationRequest=requestFingerprint;
  if(clockAction)data[clockAction==='start'?'_startRequest':'_finishRequest']=requestFingerprint;
  prepareContactEvidence(data,c,now,clockAction,old||undefined);
  if(syncFollowup&&(!data.nextAction||!data.nextDate))throw new CRMError('حدد الإجراء القادم وموعد متابعة العميل');
 }

 if(kind==='quote'){
  if(parent?.data.technicalStatus!=='approved')throw new CRMError('يجب اعتماد مواصفات القالب فنيًا قبل إنشاء عرض السعر');
  data.number=old?.data.number||`YR-${new Date().getFullYear()}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;Object.assign(data,quoteTotals(data.items,data.discount,data.taxRate));
 }
 const permission=kind==='customer'&&old&&!customerRoutingChanged?customerDetailMutationGuard(c,old):['customer','factory'].includes(kind)&&(old||parent)?masterMutationGuard(c,(old||parent)!):old?recordEditGuard(c,old):accessGuard(c,parent);if(kind==='customer'&&customerRoutingChanged){const assignee=c.members.find(m=>m.id===assignedTo)!;permission.sql+=' AND EXISTS (SELECT 1 FROM crm_members WHERE id=? AND active=1 AND region_scope=? AND role=? AND branch=?)';permission.args.push(assignee.id,regionScope(assignee),assignee.role,assignee.branch);}
 // ERP source references may belong to several factories. The immutable CRM
 // number is allocated by the database; ambiguous ERP identities require review.
 if(syncFollowup){const parentPermission=accessGuard(c,parent);permission.sql+=' AND '+parentPermission.sql;permission.args.push(...parentPermission.args);}
 const id=old?.id||genericId||(createKey?'visit-'+createKey:crypto.randomUUID());const stmts=[];
 if(old){const lockParent=syncFollowup||attachLegacyMachine||kind==='quote';const lock=lockParent?' AND EXISTS (SELECT 1 FROM crm_records parent WHERE parent.id=? AND parent.version=? AND parent.assigned_to=? AND parent.branch=?)':'';stmts.push(c.db.prepare('UPDATE crm_records SET data=?,assigned_to=?,branch=?,parent_id=?,updated_at=?,version=version+1,mutation_id=? WHERE id=? AND version=?'+lock+' AND '+permission.sql).bind(JSON.stringify(data),assignedTo,branch,parentId,now,mutation,id,old.version,...(lockParent?[parent!.id,parent!.version,parent!.assignedTo,parent!.branch]:[]),...permission.args));}
 else if(parent)stmts.push(c.db.prepare((createKey||genericCreateKey?'INSERT OR IGNORE':'INSERT')+' INTO crm_records (id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) SELECT ?,?,?,?,?,?,?,?,1,? WHERE EXISTS (SELECT 1 FROM crm_records WHERE id=? AND version=? AND assigned_to=? AND branch=?) AND '+permission.sql).bind(id,kind,parentId,assignedTo,branch,JSON.stringify(data),now,now,mutation,parent.id,parent.version,parent.assignedTo,parent.branch,...permission.args));
 else stmts.push(c.db.prepare((genericCreateKey?'INSERT OR IGNORE':'INSERT')+' INTO crm_records (id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) SELECT ?,?,?,?,?,?,?,?,1,? WHERE '+permission.sql).bind(id,kind,parentId,assignedTo,branch,JSON.stringify(data),now,now,mutation,...permission.args));
 const gate='EXISTS (SELECT 1 FROM crm_records WHERE id=? AND version=? AND mutation_id=?)';const revision=old?old.version+1:1;
 if(kind==='activity'){
  stmts.push(c.db.prepare(`INSERT INTO crm_visit_numbers (record_id) SELECT ? WHERE ${gate} AND NOT EXISTS (SELECT 1 FROM crm_visit_numbers WHERE record_id=?)`).bind(id,id,revision,mutation,id));
  stmts.push(c.db.prepare(`UPDATE crm_records SET data=json_set(data,'$.visitNumber',(SELECT number FROM crm_visit_numbers WHERE record_id=?)) WHERE id=? AND ${gate}`).bind(id,id,id,revision,mutation));
 }

 if(kind==='customer'&&old&&(old.assignedTo!==assignedTo||old.branch!==branch)){
  stmts.push(c.db.prepare(`WITH RECURSIVE descendants(id) AS (SELECT id FROM crm_records WHERE parent_id=? UNION ALL SELECT r.id FROM crm_records r JOIN descendants d ON r.parent_id=d.id) UPDATE crm_records SET assigned_to=?,branch=?,updated_at=?,version=version+1 WHERE id IN (SELECT id FROM descendants) AND ${gate}`).bind(id,assignedTo,branch,now,id,revision,mutation));
 }
 if(kind==='factory'&&old&&['machineBrand','machineModel','machineType','machineSerial','boardDimensions','quantity','name'].some(k=>old.data[k]!==data[k])){
  stmts.push(c.db.prepare(`UPDATE crm_records SET data=json_set(data,'$.technicalStatus','pending','$.technicalBy','','$.technicalAt','','$.stage',CASE WHEN json_extract(data,'$.stage') IN ('quoted','negotiation') THEN 'technical' ELSE json_extract(data,'$.stage') END),updated_at=?,version=version+1 WHERE parent_id=? AND kind='opportunity' AND json_extract(data,'$.stage') NOT IN ('won','lost') AND ${gate}`).bind(now,id,id,revision,mutation));
 }
 if(syncFollowup)stmts.push(c.db.prepare(`UPDATE crm_records SET data=json_set(data,'$.nextAction',?,'$.nextDate',?),updated_at=?,version=version+1 WHERE id=? AND version=? AND json_extract(data,'$.stage') NOT IN ('won','lost') AND ${gate}`).bind(data.nextAction,data.nextDate,now,parent!.id,parent!.version,id,revision,mutation));
 const detail=kind==='opportunity'?`${data.moldType} • ${data.stage}`:data.name||data.summary||data.number||kind;
 stmts.push(c.db.prepare(`INSERT INTO crm_audit (id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(crypto.randomUUID(),id,c.me.name,old?'تعديل':'إضافة',detail,now,id,revision,mutation));
 if(genericCreateKey)stmts.push(c.db.prepare(`INSERT INTO crm_audit (id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(genericReceiptId,id,c.me.name,'crm-create-receipt',genericFingerprint,now,id,revision,mutation));
 const result=await c.db.batch(stmts);if(result[0].meta.changes!==1&&genericCreateKey){const repeated=await replayCreate();if(repeated)return repeated;}if(result[0].meta.changes!==1&&createKey){const replay=await c.db.prepare("SELECT id,data,version FROM crm_records WHERE id=? AND kind='activity' AND parent_id=? AND json_extract(data,'$.performedBy')=?").bind(id,parentId,c.me.id).first<{id:string;data:string;version:number}>();if(replay)return replayReply({...replay,data:JSON.parse(String(replay.data))},'_creationRequest');}if(result[0].meta.changes!==1)throw new CRMError('تم تحديث السجل بالتزامن. أعد تحميل البيانات.',409);
 return Response.json({ok:true,id});
 }catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(x=>x.message).join(' • ')},{status:400});return replyError(e);}}
