import {loadAuthorizedVisitAttachment,visitAttachmentWriteGuard} from '@/lib/visit-file-access';
import {recordAuthorId} from '@/lib/access';
import {readJsonBody} from '@/lib/crm-server';
import {activeServiceCase,serviceHistoryLocked} from '@/lib/customer-service';
import {requireSalesRole} from '@/lib/crm-server';
import {z} from 'zod';
import {accessGuard,recordEditGuard,requireRecordEdit,context,checkOrigin,CRMError,replyError} from '@/lib/crm-server';
import {schemas,today,isSalesRequest,type Row} from '@/lib/crm';
import {visitCustomer,visitRequest,customerVisits,visitOrder,visitProducts} from '@/lib/customer-visits';
import {riyadhDate} from '@/lib/visits';
import {prepareNewContact,validateFollowup} from '@/lib/followups-server';
import {prepareJourneyVisitLink} from '@/lib/journeys-server';
import {offlineCapture,offlineEvidence} from '@/lib/offline-server';
export const dynamic='force-dynamic';
export async function POST(req:Request){try{
 checkOrigin(req);const body:any=await readJsonBody(req);if(JSON.stringify(body).length>90000)throw new CRMError('حجم البيانات كبير');
 const key=z.string().uuid().parse(body.createKey),id=body.id||'customer-visit-'+key,c=await context({load:'customer-graph',customerId:body.customerId,recordIds:[id]}),now=new Date().toISOString(),mutation=crypto.randomUUID();
 requireSalesRole(c.me);
 const offline=offlineCapture(body,c.me.id,now);if(offline&&body.id)throw new CRMError('تعديل الزيارات المحفوظة يتطلب اتصالًا مباشرًا.');const occurredAt=offline?.capturedAt||now;
 const existing=c.all.find(r=>r.id===id);if(existing&&!c.visible.some(r=>r.id===id))throw new CRMError('الزيارة غير متاحة',404);
 const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body))))).map(n=>n.toString(16).padStart(2,'0')).join('');
 const receipt=await c.db.prepare('SELECT detail FROM crm_audit WHERE id=? AND record_id=?').bind('visit-save-'+c.me.id+':'+key,id).first<{detail:string}>();
 if(receipt){if(receipt.detail===fingerprint)return Response.json({ok:true,id,alreadySaved:true});throw new CRMError('تم حفظ هذه العملية بالفعل. أعد فتح الزيارة لحفظ تعديلات إضافية.',409);}
 const old=body.id&&c.visible.some(r=>r.id===id)?c.all.find(r=>r.id===id&&r.kind==='activity'):undefined;if(body.id&&!old)throw new CRMError('الزيارة غير متاحة',404);
 if(old)requireRecordEdit(c.me);
 if(old?.data.visitWorkflow==='followup-v1')throw new CRMError('افتح المتابعة من صفحة المتابعات.');
 if(old&&serviceHistoryLocked(old,c))throw new CRMError('سجل هذا الطلب محفوظ بعد فتح طلب أحدث للعميل. سجّل المتابعة في الطلب الحالي.',409);
 if(old&&body.version!==old.version)throw new CRMError('تغيّرت الزيارة. حدّث البيانات ثم أعد فتحها.',409);
 const customer=c.visible.find(r=>r.id===body.customerId&&r.kind==='customer');if(!customer)throw new CRMError('اختر العميل',403);
 if(old&&visitCustomer(old,c.all)?.id!==customer.id)throw new CRMError('لا يمكن تغيير عميل الزيارة');
 const automaticTiming=body.timingMode==='automatic';
 const clock=!automaticTiming&&body.clockAction?z.enum(['start','finish']).parse(body.clockAction):undefined;
 if(old&&clock==='start'&&old.data.startedAt||old&&clock==='finish'&&old.data.endedAt)throw new CRMError('تم حفظ توقيت الزيارة بالفعل. أعد فتحها لمراجعة البيانات.',409);
 const visitDate=old?.data.date||riyadhDate(occurredAt);
 let data:any=schemas.activity.parse({...body.data,date:visitDate,responsibleId:old?(old.data.responsibleId||old.data.performedBy||''):c.me.id,performedBy:old?(old.data.performedBy||''):c.me.id,recordedByEmail:old?(old.data.recordedByEmail||''):c.user.email.toLowerCase(),customerStage:old?.data.customerStage||''});data.visitWorkflow='customer-v1';
 const service=activeServiceCase(customer.id,c);if(old?.data.serviceCaseId)data.serviceCaseId=old.data.serviceCaseId;else if(!old&&service?.status==='assigned'&&(!offline||service.createdAt<=occurredAt))data.serviceCaseId=service.id;
 if(old?.data.customerStage!==undefined)data.customerStage=old.data.customerStage;else delete data.customerStage;
 const allowedProducts=new Set([...visitProducts,'خدمات صيانة',...(old?.data.requestedProducts||[])]);
 if(data.requestedProducts.some((p:string)=>!allowedProducts.has(p)))throw new CRMError('اختر الأصناف من القائمة المتاحة');
 if(!data.nextAction||!data.nextDate)throw new CRMError('الإجراء القادم وموعد المتابعة مطلوبان');
 if((!old||data.nextDate!==old.data.nextDate)&&data.nextDate<(offline?visitDate:today()))throw new CRMError('موعد المتابعة يجب أن يكون يوم التسجيل أو لاحقًا');
 // A contact does not imply a buying need; sales fields are explicitly optional.
 if(data.hasCompetitor&&!data.competitorName)throw new CRMError('اكتب اسم المنافس');
 if(!data.hasCompetitor){data.competitorName='';data.competitorNotes='';data.competitorFileId='';data.competitorFileName='';}
 const attachedFile=data.competitorFileId?await loadAuthorizedVisitAttachment(c,customer.id,data.competitorFileId):undefined;
 if(attachedFile)data.competitorFileName=attachedFile.name;
 // A monotonic browser timer measures open-to-save without relying on device clock settings.
 // The server owns saved timestamps and successful retries retain the original receipt.
 // Historical visit times remain unchanged when editing, including absent times.
 if(automaticTiming){
  if(old){data.startedAt=old.data.startedAt||'';data.endedAt=old.data.endedAt||'';}
  else{const elapsed=body.elapsedMilliseconds;if(typeof elapsed!=='number'||!Number.isFinite(elapsed)||elapsed<0||elapsed>86400000)throw new CRMError('انتهت صلاحية تسجيل الزيارة. أغلق النموذج وافتح زيارة جديدة.');data.startedAt=new Date(Date.parse(occurredAt)-elapsed).toISOString();data.endedAt=occurredAt;}
 }
 if(offline&&!automaticTiming)throw new CRMError('تسجيل الزيارة بدون شبكة يتطلب التوقيت التلقائي.');
 prepareNewContact(data,c,now,clock,old);data.date=visitDate;Object.assign(data,offlineEvidence(offline,old?.data));
 if(!automaticTiming&&data.startedAt&&(!old||data.startedAt!==old.data.startedAt)&&riyadhDate(data.startedAt)!==visitDate)throw new CRMError('بداية الزيارة يجب أن تكون في يوم تسجيلها');
 const previousRequest=visitRequest(old,c.visible),requestId=body.requestId||'';
 // Hidden historical links remain private and immutable while the recorder edits their own visit.
 const privateRequestId=old?.data.requestId&&!c.visible.some(r=>r.id===old.data.requestId)?old.data.requestId:'';
 if(privateRequestId&&(requestId||body.requestData))throw new CRMError('لا يمكن تغيير طلب الزيارة المحفوظ. سجّل زيارة جديدة للطلب الآخر.',403);
 if(previousRequest&&requestId!==previousRequest.id)throw new CRMError('احتفظ بطلب القالب المرتبط بالزيارة؛ يمكن تسجيل زيارة جديدة لطلب آخر');
 const request=requestId&&c.visible.some(r=>r.id===requestId)?c.all.find(r=>r.id===requestId&&isSalesRequest(r)):undefined;
 if(requestId&&(!request||visitCustomer(request,c.all)?.id!==customer.id))throw new CRMError('طلب القالب لا يتبع العميل',403);
 const writingRequest=!!body.requestData&&(!old||body.updateRequest===true||!previousRequest);
 if(writingRequest&&request)requireRecordEdit(c.me);
 let requestData:any=null,requestParent:Row|undefined;
 let targetRequestId=request?.id||'';
 if(writingRequest){
  requestParent=body.machineId?c.visible.find(r=>r.id===body.machineId&&r.kind==='factory'&&r.parentId===customer.id):customer;
  if(!requestParent)throw new CRMError('اختر ماكينة تابعة للعميل');
  if(request&&request.version!==body.requestVersion)throw new CRMError('تغيّر طلب القالب. أعد تحميل بياناته.',409);
  if(request&&request.parentId!==requestParent.id&&(c.all.some(r=>r.kind==='quote'&&r.parentId===request.id)||['won','lost'].includes(request.data.stage)))throw new CRMError('لا يمكن تغيير ماكينة طلب مغلق أو مرتبط بعرض سعر');
  requestData=schemas.opportunity.parse({...body.requestData,hasRequest:true,stage:data.salesStage,nextAction:data.nextAction,nextDate:data.nextDate});
  validateFollowup(requestData,request,requestParent,c,now);targetRequestId=request?.id||'visit-request-'+key;requestData.responsibleId=request?recordAuthorId(request,c.members)||'':c.me.id;requestData.performedBy=requestData.responsibleId;requestData._createdBy=request?.data._createdBy||requestData.responsibleId;
 }
 if(!writingRequest&&body.requestData&&!request)throw new CRMError('اختر طلب القالب المرتبط');
 data.requestId=privateRequestId||targetRequestId;
 if(writingRequest)data.requestSnapshot={...requestData,machineId:requestParent?.kind==='factory'?requestParent.id:''};
 else if(old?.data.requestSnapshot)data.requestSnapshot=old.data.requestSnapshot;
 else if(request)data.requestSnapshot={...request.data,machineId:request.parentId===customer.id?'':request.parentId};
 else delete data.requestSnapshot;
 const revision=old?old.version+1:1,gate='EXISTS (SELECT 1 FROM crm_records WHERE id=? AND version=? AND mutation_id=?)',ga=[id,revision,mutation];
 // Physical visit times come from the server's observed arrival/departure evidence.
 // The link is guarded together with this record so switching a destination cannot
 // attach a visit to a different stop while the activity is being saved.
 const journey=await prepareJourneyVisitLink(c,customer.id,id,data,old,gate,ga,occurredAt,body.data?.journeyStopId);data=journey.data;
 const priorVisits=customerVisits(customer.id,c.all),latest=priorVisits[0];
 const candidate={...customer,id,kind:'activity' as const,data,createdAt:old?.createdAt||occurredAt};
 const priorPlan=priorVisits.find(v=>v.id!==id),planVisit=!priorPlan||visitOrder(candidate).localeCompare(visitOrder(priorPlan))>=0?candidate:priorPlan;
 const changePlan=planVisit.id===id||!!old&&(customer.data._visitPlan?.visitId===old.id||latest?.id===old.id);
 // A queued new contact appends to the fresh authorized customer. Only the
 // chronologically latest contact changes its plan; all current SQL locks remain.
 if(changePlan&&!offline&&body.customerVersion!==customer.version)throw new CRMError('تغيّرت بيانات العميل أو زيارته الأخيرة. حدّث البيانات ثم أعد المحاولة.',409);
 let locks='EXISTS (SELECT 1 FROM crm_records WHERE id=? AND version=? AND assigned_to=? AND branch=?)';
 const lockArgs:any[]=[customer.id,customer.version,customer.assignedTo,customer.branch];
 if(request){locks+=' AND EXISTS (SELECT 1 FROM crm_records WHERE id=? AND version=?)';lockArgs.push(request.id,request.version);}
 if(requestParent?.kind==='factory'){locks+=' AND EXISTS (SELECT 1 FROM crm_records WHERE id=? AND version=? AND parent_id=?)';lockArgs.push(requestParent.id,requestParent.version,customer.id);}
 if(writingRequest&&request&&request.parentId!==requestParent!.id){locks+=" AND NOT EXISTS (SELECT 1 FROM crm_records WHERE kind='quote' AND parent_id=?)";lockArgs.push(request.id);}
 if(attachedFile){const filePermission=visitAttachmentWriteGuard(c,attachedFile);locks+=' AND '+filePermission.sql;lockArgs.push(...filePermission.args);}
 for(const dependency of [customer,old,request].filter((r):r is Row=>!!r)){const permission=dependency===old||writingRequest&&dependency===request?recordEditGuard(c,dependency):accessGuard(c,dependency);locks+=' AND '+permission.sql;lockArgs.push(...permission.args);}
 if(journey.sql){locks+=' AND '+journey.sql;lockArgs.push(...journey.args);}
 const statements=[];
 if(old)statements.push(c.db.prepare(`UPDATE crm_records SET data=?,updated_at=?,version=version+1,mutation_id=? WHERE id=? AND version=? AND ${locks}`).bind(JSON.stringify(data),now,mutation,id,old.version,...lockArgs));
 else statements.push(c.db.prepare(`INSERT OR IGNORE INTO crm_records (id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) SELECT ?,'activity',?,?,?,?,?,?,1,? WHERE ${locks}`).bind(id,customer.id,customer.assignedTo,customer.branch,JSON.stringify(data),now,now,mutation,...lockArgs));
 statements.push(...journey.statements);
 statements.push(c.db.prepare(`INSERT INTO crm_visit_numbers (record_id) SELECT ? WHERE ${gate} AND NOT EXISTS (SELECT 1 FROM crm_visit_numbers WHERE record_id=?)`).bind(id,...ga,id));
 statements.push(c.db.prepare(`UPDATE crm_records SET data=json_set(data,'$.visitNumber',(SELECT number FROM crm_visit_numbers WHERE record_id=?)) WHERE id=? AND ${gate}`).bind(id,id,...ga));
 if(writingRequest){
  if(request)statements.push(c.db.prepare(`UPDATE crm_records SET data=?,parent_id=?,updated_at=?,version=version+1,mutation_id=? WHERE id=? AND ${gate}`).bind(JSON.stringify(requestData),requestParent!.id,now,mutation,request.id,...ga));
  else statements.push(c.db.prepare(`INSERT INTO crm_records (id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) SELECT ?,'opportunity',?,?,?,?,?,?,1,? WHERE ${gate}`).bind(targetRequestId,requestParent!.id,customer.assignedTo,customer.branch,JSON.stringify(requestData),now,now,mutation,...ga));
 }
 if(changePlan)statements.push(c.db.prepare(`UPDATE crm_records SET data=json_set(data,'$._visitPlan',json(?)),updated_at=?,version=version+1 WHERE id=? AND ${gate}`).bind(JSON.stringify({visitId:planVisit.id,date:planVisit.data.date,nextAction:planVisit.data.nextAction,nextDate:planVisit.data.nextDate}),now,customer.id,...ga));
 statements.push(c.db.prepare(`INSERT INTO crm_audit (id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind('visit-save-'+c.me.id+':'+key,id,c.me.name,'visit-receipt',fingerprint,now,...ga));
 const events=[[id,old?'تعديل زيارة':'زيارة جديدة',data.summary],...(writingRequest?[[targetRequestId,request?'تحديث طلب قالب':'طلب قالب من زيارة',requestData.moldType]]:[])];
 for(const [recordId,action,detail] of events)statements.push(c.db.prepare(`INSERT INTO crm_audit (id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(crypto.randomUUID(),recordId,c.me.name,action,detail,now,...ga));
 const result=await c.db.batch(statements);if(result[0].meta.changes!==1){const saved=await c.db.prepare('SELECT detail FROM crm_audit WHERE id=? AND record_id=?').bind('visit-save-'+c.me.id+':'+key,id).first<{detail:string}>();if(saved?.detail===fingerprint)return Response.json({ok:true,id,alreadySaved:true});throw new CRMError('تغيّرت البيانات بالتزامن. أعد تحميلها.',409);}
 return Response.json({ok:true,id,requestId:targetRequestId});
 }catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(x=>x.message).join(' • ')},{status:400});return replyError(e);}}
