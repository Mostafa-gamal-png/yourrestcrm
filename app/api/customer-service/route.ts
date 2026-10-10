import {canReadSalesRecord,salesScopeMemberIds,recordAuthorId} from '@/lib/access';
import {readJsonBody} from '@/lib/crm-server';
import {prepareNewContact} from '@/lib/followups-server';
import {offlineCapture,offlineEvidence} from '@/lib/offline-server';
import {riyadhDate} from '@/lib/visits';
import {prepareCustomerLocation} from '@/lib/customer-fields';
import {z} from 'zod';
import {accessGuard,context,checkOrigin,requireSession,CRMError,replyError} from '@/lib/crm-server';
import {memberCanAccessRegion,regionScope} from '@/lib/regions';
import {schemas,type Member,type Row} from '@/lib/crm';
import {activeServiceCase,canReadService,isServiceRole,serviceCandidates,serviceContacts,serviceCustomerSchema,serviceIntakeSchema,serviceIntakeSchemaForDay,servicePermissions,serviceState,serviceActions,type ServiceCase} from '@/lib/customer-service';
export const dynamic='force-dynamic';
type Context=Awaited<ReturnType<typeof context>>;
const customerChoices=(c:Context)=>c.regionalRecords.filter(r=>r.kind==='customer'&&(c.me.role==='admin'||r.branch===c.me.branch));
function memberGate(m:Member){return{sql:"EXISTS(SELECT 1 FROM crm_members WHERE id=? AND role=? AND active=? AND branch=? AND COALESCE(supervisor_id,'')=? AND region_scope=?)",args:[m.id,m.role,m.active,m.branch,m.supervisorId||'',regionScope(m)]};}
export async function GET(){try{
 const c=await context(),rows=c.serviceCases.filter(s=>canReadService(s,c)),salesReader=!isServiceRole(c.me.role),allowedMembers=salesScopeMemberIds(c.members,c.me),contactRecords=salesReader?c.visible:c.all;
 const canReadRegistration=(registration:any,creator:string)=>!salesReader||canReadSalesRecord({kind:'activity',assignedTo:creator,data:registration||{performedBy:creator}} as Row,c.members,c.me);
 const visibleData=(item:ServiceCase)=>{const data={...item.data};if(!canReadRegistration(data.registration,item.creatorId))delete data.registration;if(data.registrations)data.registrations=data.registrations.filter((entry:any)=>canReadRegistration(entry.registration,item.creatorId));return data;};
 const ids=new Set(rows.map(s=>s.id));
 const history=(await c.db.prepare("SELECT id,record_id AS recordId,actor,action,detail,created_at AS createdAt FROM crm_audit WHERE action LIKE 'service:%' ORDER BY created_at,id").all<any>()).results.filter(a=>ids.has(a.recordId)&&(!salesReader||c.me.role==='admin'||c.members.filter(m=>m.name===a.actor).length===1&&c.members.some(m=>m.name===a.actor&&allowedMembers.has(m.id)))).map(a=>({...a,detail:JSON.parse(a.detail)}));
 const name=(id:string|null)=>c.members.find(m=>m.id===id)?.name||'';
 const cases=rows.map(s=>{const customer=c.all.find(r=>r.id===s.customerId)!,contacts=serviceContacts(s,contactRecords),permissions=servicePermissions(s,c),latest=contacts[0];return{...s,data:visibleData(s),customer:{id:customer.id,name:customer.data.name,phone:customer.data.phone,contact:customer.data.contact,city:customer.data.city,region:customer.data.region,version:customer.version},state:serviceState(s,contactRecords,c.members),stage:latest?.data.salesStage||'new',nextAction:latest?.data.nextAction??s.data.nextAction,nextDate:latest?.data.nextDate??s.data.nextDate,creatorName:name(s.creatorId),serviceManagerName:name(s.serviceManagerId),salesManagerName:name(s.salesManagerId),assignedName:name(s.assignedTo),supervisorName:name(s.supervisorId),permissions,candidates:(permissions.approve?serviceCandidates(s,c,'approve'):permissions.assign?serviceCandidates(s,c,'assign'):permissions.delegate?serviceCandidates(s,c,'delegate'):[]).map(m=>({id:m.id,name:m.name,role:m.role})),history:history.filter(a=>a.recordId===s.id),contacts:contacts.map(r=>({id:r.id,date:r.data.date,type:r.data.type,result:r.data.result,summary:r.data.summary,salesStage:r.data.salesStage,nextAction:r.data.nextAction,nextDate:r.data.nextDate,lossReason:r.data.lossReason,competitorFileId:r.data.competitorFileId,competitorFileName:r.data.competitorFileName,actor:name(recordAuthorId(r,c.members)||''),createdAt:r.createdAt}))};});
 const canCreate=c.me.role==='admin'||isServiceRole(c.me.role);
 return Response.json({cases,canCreate,customers:canCreate?customerChoices(c).map(r=>({id:r.id,name:r.data.name,code:r.data.code,phone:r.data.phone,region:r.data.region,city:r.data.city,version:r.version})):[]},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return replyError(e);}}
export async function POST(req:Request){try{
 checkOrigin(req);await requireSession();const body:any=await readJsonBody(req);if(JSON.stringify(body).length>18000)throw new CRMError('حجم البيانات كبير');
 const requestId=z.string().uuid().parse(body.requestId);let action:string=z.enum(['create','edit','approve','return','assign','delegate','note','assist','reply']).parse(body.action);const c=await context(),now=new Date().toISOString();
 const offline=offlineCapture(body,c.me.id,now);if(offline&&(action!=='create'||!body.registration))throw new CRMError('هذا الإجراء يتطلب اتصالًا مباشرًا.');const occurredAt=offline?.capturedAt||now;
 const canonical=JSON.stringify(body),receiptId='service-receipt:'+c.me.id+':'+requestId,mutation=crypto.randomUUID();
 const replay=async()=>{const r=await c.db.prepare('SELECT record_id,detail FROM crm_audit WHERE id=?').bind(receiptId).first<{record_id:string;detail:string}>();if(!r)return null;const fresh=await context(),item=fresh.serviceCases.find(s=>s.id===r.record_id);if(!item||!canReadService(item,fresh))throw new CRMError('الطلب غير متاح',403);if(r.detail!==canonical)throw new CRMError('العملية محفوظة ببيانات مختلفة. حدّث الصفحة.',409);return Response.json({ok:true,id:r.record_id,alreadySaved:true});};
 const repeated=await replay();if(repeated)return repeated;
 const permission=accessGuard(c),guards=[permission.sql],args:any[]=[...permission.args],statements=[];
 const requireMember=(m:Member)=>{const g=memberGate(m);guards.push(g.sql);args.push(...g.args);};
 let item:ServiceCase,customer:Row,newCustomer=false,target:Member|undefined,note='',status='',data:any,id='';
 if(action==='create'){
  if(c.me.role!=='admin'&&!isServiceRole(c.me.role))throw new CRMError('تسجيل الطلب متاح لخدمة العملاء ومدير النظام فقط',403);
  data=body.registration?{}:serviceIntakeSchema.parse(body.data);id='service-'+requestId;
  if(body.newCustomer){const fields=serviceCustomerSchema.parse(body.newCustomer);if(!memberCanAccessRegion(c.me,fields.region))throw new CRMError('العميل خارج منطقتك المسموح بها',403);const locationError=prepareCustomerLocation(fields);if(locationError)throw new CRMError(locationError);customer={id:'service-customer-'+requestId,kind:'customer',parentId:null,assignedTo:c.me.id,branch:c.me.branch,data:{...fields,branch:c.me.branch,assignedTo:c.me.id,_createdBy:c.me.id},createdAt:now,updatedAt:now,version:1};newCustomer=true;}
  else{const found=customerChoices(c).find(r=>r.id===body.customerId);if(!found)throw new CRMError('العميل خارج نطاق صلاحيتك',403);customer=found;if(!offline&&customer.version!==body.customerVersion)throw new CRMError('تغيّرت بيانات العميل. حدّث القائمة.',409);const active=activeServiceCase(customer.id,c);if(active){if(!body.registration)throw new CRMError('يوجد طلب خدمة عملاء مفتوح لهذا العميل بالفعل',409);if(!canReadService(active,c))throw new CRMError('يوجد طلب خدمة عملاء مفتوح لهذا العميل بالفعل',409);const openedAt=active.data.registration?.offlineRecordedAt||active.createdAt;if(offline&&occurredAt<openedAt)throw new CRMError('تم فتح طلب أحدث بعد تسجيل هذه الزيارة. راجع الإدخال المحفوظ قبل ربطه بالطلب الحالي.',409);action='contact';}}
  const manager=c.me.role==='customer_service_manager'?c.me:c.members.find(m=>m.id===c.me.supervisorId&&m.role==='customer_service_manager'&&m.active&&memberCanAccessRegion(m,customer.data.region)&&m.branch===customer.branch);
  if(manager)requireMember(manager);
  item={id,customerId:customer.id,status:'pending_approval',creatorId:c.me.id,serviceManagerId:manager?.id||null,salesManagerId:null,assignedTo:null,supervisorId:null,data:{...data,participants:[c.me.id,...(manager?[manager.id]:[])]},createdAt:now,updatedAt:now,version:1};status=item.status;data=item.data;
  if(action==='contact'){item=activeServiceCase(customer.id,c)!;id=item.id;status=item.status;data={...item.data};if(c.me.role==='customer_service_manager'){const creator=c.members.find(m=>m.id===item.creatorId);if(creator)requireMember(creator);}}
 }else{
  const found=c.serviceCases.find(s=>s.id===body.id);if(!found||!canReadService(found,c))throw new CRMError('الطلب غير متاح',403);item=found;id=item.id;customer=c.all.find(r=>r.id===item.customerId)!;
  if(['rep','supervisor','manager'].includes(c.me.role)&&item.assignedTo){const assignee=c.members.find(m=>m.id===item.assignedTo);if(assignee)requireMember(assignee);}
  // A manager gaining visibility through a current reporting line must still own it at commit.
  if(c.me.role==='customer_service_manager'){const creator=c.members.find(m=>m.id===item.creatorId);if(creator)requireMember(creator);}
  if(body.version!==item.version)throw new CRMError('تغيّر الطلب. حدّث البيانات قبل إعادة المحاولة.',409);
  data={...item.data};status=item.status;const allowed=servicePermissions(item,c);
  if(action==='edit'){if(item.data.registration&&!body.registration)throw new CRMError('استخدم قسم الزيارات لحفظ بيانات الزيارة والعميل.');if(!allowed.edit)throw new CRMError('لا يمكن تعديل الطلب بعد اعتماده',403);data={...data,...(body.registration?{}:serviceIntakeSchema.parse(body.data))};status='pending_approval';}
  if(action==='approve'||action==='return'){
   if(!allowed.approve)throw new CRMError('الاعتماد متاح لمدير خدمة العملاء المسؤول فقط',403);
   const creator=c.members.find(m=>m.id===item.creatorId);if(creator)requireMember(creator);
   if(action==='approve'){target=serviceCandidates(item,c,'approve').find(m=>m.id===body.targetId);if(!target)throw new CRMError('حدد مدير المبيعات المرتبط بمدير خدمة العملاء',403);status='pending_assignment';data.approvedBy=c.me.id;data.approvedAt=now;}
   else{note=z.string().trim().min(3,'اكتب سبب إعادة الطلب').max(2000).parse(body.note);status='returned';}
  }
  if(action==='assign'||action==='delegate'){
   if(!(action==='assign'?allowed.assign:allowed.delegate))throw new CRMError('لا تملك صلاحية التكليف في هذه المرحلة',403);
   target=serviceCandidates(item,c,action).find(m=>m.id===body.targetId);if(!target)throw new CRMError('اختر مندوبًا أو مشرفًا من فريقك وفي منطقة العميل وفرعه',403);
   if(action==='delegate'&&target.supervisorId!==c.me.id)throw new CRMError('المندوب ليس ضمن فريقك',403);
   // Freeze every reporting link used to authorize dispatch, including intermediate supervisors.
   let link:Member|undefined=target;const seen=new Set<string>();while(link&&!seen.has(link.id)){seen.add(link.id);requireMember(link);link=c.members.find(m=>m.id===link!.supervisorId);if(link?.id===c.me.id)break;}
   status='assigned';data[action==='assign'?'assignedAt':'delegatedAt']=now;data[action==='assign'?'assignedBy':'delegatedBy']=c.me.id;
  }
  if(['note','assist','reply'].includes(action)){
   if(!allowed.note)throw new CRMError('المتابعة الداخلية غير متاحة',403);
   if(action==='reply'&&(isServiceRole(c.me.role)||!['admin','manager'].includes(c.me.role)&&item.assignedTo!==c.me.id))throw new CRMError('الرد متاح لمسؤول المبيعات فقط',403);
   note=z.string().trim().min(3,'اكتب تفاصيل المتابعة الداخلية').max(2000).parse(body.note);
   if(action==='assist')data.assistanceOpen=true;if(action==='reply')data.assistanceOpen=false;
  }
 }
 if(['create','edit','contact'].includes(action)&&body.registration){
  const previous=action==='edit'?item.data.registration:undefined;
  const date=previous?.date||riyadhDate(action==='edit'?item.createdAt:occurredAt);
  const registration:any=schemas.activity.extend({type:z.enum(['visit','call','email','whatsapp','website','social']),visitWorkflow:z.string().optional()}).parse({...body.registration,date,salesStage:'new',visitWorkflow:undefined});
  const old=action==='edit'?{id:'intake-'+id,kind:'activity' as const,parentId:customer.id,assignedTo:item.creatorId,branch:customer.branch,data:previous||{location:'',performedBy:item.creatorId,responsibleId:item.creatorId,recordedByEmail:'',date},createdAt:item.createdAt,updatedAt:item.updatedAt,version:item.version}:undefined;
  if(old){registration.startedAt=old.data.startedAt||'';registration.endedAt=old.data.endedAt||'';}
  else{const elapsed=body.elapsedMilliseconds;if(typeof elapsed!=='number'||!Number.isFinite(elapsed)||elapsed<0||elapsed>86400000)throw new CRMError('انتهت صلاحية تسجيل الزيارة. أغلق النموذج وافتح زيارة جديدة.');registration.startedAt=new Date(Date.parse(occurredAt)-elapsed).toISOString();registration.endedAt=occurredAt;}
  if(!registration.result)throw new CRMError('سجّل نتيجة الزيارة قبل إنهائها');
  if(registration.hasCompetitor&&!registration.competitorName)throw new CRMError('اكتب اسم المنافس');
  if(!registration.hasCompetitor)Object.assign(registration,{competitorName:'',competitorNotes:'',competitorFileId:'',competitorFileName:''});
  if(registration.competitorFileId){const file=await c.db.prepare('SELECT customer_id,name,uploaded_by FROM crm_visit_files WHERE id=?').bind(registration.competitorFileId).first<any>();if(!file||file.customer_id!==customer.id||file.uploaded_by!==c.me.id&&previous?.competitorFileId!==registration.competitorFileId)throw new CRMError('ملف المنافس لا يتبع هذا العميل',403);registration.competitorFileName=file.name;}
  prepareNewContact(registration,c,now,undefined,old);registration.date=date;registration.responsibleId=action==='edit'?item.creatorId:c.me.id;registration.requestId='';delete registration.requestSnapshot;delete registration.customerStage;Object.assign(registration,offlineEvidence(offline,old?.data));
  const intake=serviceIntakeSchemaForDay(offline?date:undefined).parse({source:registration.type,products:registration.requestedProducts,strength:registration.strength,needs:registration.customerNeeds||registration.summary,nextAction:registration.nextAction,nextDate:registration.nextDate});
  if(action==='contact')data.registrations=[...(data.registrations||[]),{id:'service-visit-'+requestId,registration,createdAt:now}];
  else data={...data,...intake,registration};
 }
 if(target)requireMember(target);
 const revision=action==='create'?1:item.version+1;
 data.participants=Array.from(new Set([...(data.participants||[]),item.creatorId,c.me.id,...(target?[target.id]:[])]));
 const rootGuard={sql:"EXISTS(SELECT 1 FROM crm_records WHERE id=? AND kind='customer' AND version=?)",args:[customer.id,customer.version]};
 if(!newCustomer){guards.push(rootGuard.sql);args.push(...rootGuard.args);}
 const condition=guards.join(' AND '),gate='EXISTS(SELECT 1 FROM crm_service_cases WHERE id=? AND version=? AND mutation_id=?)',ga=[id,revision,mutation];
 if(newCustomer)statements.push(c.db.prepare(`INSERT OR IGNORE INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) SELECT ?,'customer',NULL,?,?,?,?,?,1,? WHERE ${condition}`).bind(customer.id,c.me.id,customer.branch,JSON.stringify(customer.data),now,now,mutation,...args));
 if(action==='create')statements.push(c.db.prepare(`INSERT OR IGNORE INTO crm_service_cases(id,customer_id,status,creator_id,service_manager_id,sales_manager_id,assigned_to,supervisor_id,data,created_at,updated_at,version,mutation_id) SELECT ?,?,?,?,?,NULL,NULL,NULL,?,?,?,1,? WHERE ${newCustomer?'EXISTS(SELECT 1 FROM crm_records WHERE id=? AND mutation_id=?)':condition}`).bind(id,customer.id,status,item.creatorId,item.serviceManagerId,JSON.stringify(data),now,now,mutation,...(newCustomer?[customer.id,mutation]:args)));
 else statements.push(c.db.prepare(`UPDATE crm_service_cases SET status=?,sales_manager_id=?,assigned_to=?,supervisor_id=?,data=?,updated_at=?,version=version+1,mutation_id=? WHERE id=? AND version=? AND ${condition}`).bind(status,action==='approve'?target!.id:item.salesManagerId,['assign','delegate'].includes(action)?target!.id:item.assignedTo,action==='assign'&&target!.role==='supervisor'?target!.id:item.supervisorId,JSON.stringify(data),now,mutation,id,item.version,...args));
 if(body.registration&&['create','edit','contact'].includes(action)){
  const visitId=action==='contact'?'service-visit-'+requestId:'intake-'+id, path=action==='contact'?'$.registrations['+(data.registrations.length-1)+'].registration.visitNumber':'$.registration.visitNumber';
  statements.push(c.db.prepare(`INSERT INTO crm_visit_numbers(record_id) SELECT ? WHERE ${gate} AND NOT EXISTS(SELECT 1 FROM crm_visit_numbers WHERE record_id=?)`).bind(visitId,...ga,visitId));
  statements.push(c.db.prepare(`UPDATE crm_service_cases SET data=json_set(data,?,(SELECT number FROM crm_visit_numbers WHERE record_id=?)) WHERE id=? AND ${gate}`).bind(path,visitId,id,...ga));
 }
 if(['create','contact'].includes(action)&&!newCustomer)statements.push(c.db.prepare(`UPDATE crm_records SET version=version+1,updated_at=? WHERE id=? AND ${gate}`).bind(now,customer.id,...ga));
 if(action==='assign'||action==='delegate'){
  statements.push(c.db.prepare(`UPDATE crm_records SET assigned_to=?,data=json_set(data,'$.assignedTo',?),updated_at=?,version=version+1 WHERE id=? AND ${gate}`).bind(target!.id,target!.id,now,customer.id,...ga));
  statements.push(c.db.prepare(`WITH RECURSIVE descendants(id) AS (SELECT id FROM crm_records WHERE parent_id=? UNION SELECT r.id FROM crm_records r JOIN descendants d ON r.parent_id=d.id) UPDATE crm_records SET assigned_to=?,updated_at=?,version=version+1 WHERE id IN(SELECT id FROM descendants) AND ${gate}`).bind(customer.id,target!.id,now,...ga));
 }
 statements.push(c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(receiptId,id,c.me.name,'service-receipt',canonical,now,...ga));
 statements.push(c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(crypto.randomUUID(),id,c.me.name,'service:'+action,JSON.stringify({label:serviceActions[action]||(action==='contact'?'تسجيل زيارة':'الرد على طلب المساعدة'),note,targetName:target?.name||'',state:status}),now,...ga));
 let result;try{result=await c.db.batch(statements);}catch(e){const repeated=await replay();if(repeated)return repeated;throw e;}
 if(result[newCustomer?1:0].meta.changes!==1){const repeated=await replay();if(repeated)return repeated;throw new CRMError('تغيّرت البيانات أو الصلاحيات أثناء الحفظ. حدّث الصفحة.',409);}
 return Response.json({ok:true,id,customerId:customer.id});
 }catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(i=>i.message).join(' • ')},{status:400});return replyError(e);}}
