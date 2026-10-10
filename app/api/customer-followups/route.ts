import {loadAuthorizedVisitAttachment,visitAttachmentWriteGuard} from '@/lib/visit-file-access';
import {readJsonBody} from '@/lib/crm-server';
import {activeServiceCase} from '@/lib/customer-service';
import {requireSalesRole} from '@/lib/crm-server';
import {z} from 'zod';
import {accessGuard,context,checkOrigin,requireSession,CRMError,replyError} from '@/lib/crm-server';
import {type Row} from '@/lib/crm';
import {customerPlanSource,visitCustomer,visitRequest} from '@/lib/customer-visits';
import {customerFollowupSchema,customerHasQuotation,latestCustomerContact,followupClosed,canExecuteCustomerFollowup} from '@/lib/customer-followups';
import {prepareJourneyVisitLink} from '@/lib/journeys-server';
import {offlineCapture,offlineEvidence} from '@/lib/offline-server';
import {riyadhDate} from '@/lib/visits';
export const dynamic='force-dynamic';
export async function POST(req:Request){try{
 checkOrigin(req);await requireSession();const body:any=await readJsonBody(req);if(JSON.stringify(body).length>20000)throw new CRMError('حجم البيانات كبير');
 const key=z.string().uuid().parse(body.createKey),id='customer-followup-'+key,c=await context({load:'customer-graph',customerId:body.customerId,recordIds:[id]}),now=new Date().toISOString(),mutation=crypto.randomUUID();
 requireSalesRole(c.me);const customer=c.visible.find(r=>r.kind==='customer'&&r.id===body.customerId);if(!customer)throw new CRMError('اختر العميل',403);
 const offline=offlineCapture(body,c.me.id,now),occurredAt=offline?.capturedAt||now;
 const existing=c.all.find(r=>r.id===id);if(existing&&!c.visible.some(r=>r.id===id))throw new CRMError('المتابعة غير متاحة',404);
 const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body))))).map(n=>n.toString(16).padStart(2,'0')).join('');
 const receipt=await c.db.prepare('SELECT detail FROM crm_audit WHERE id=? AND record_id=?').bind('customer-followup-save-'+c.me.id+':'+key,id).first<{detail:string}>();
 if(receipt){if(receipt.detail===fingerprint)return Response.json({ok:true,id,alreadySaved:true});throw new CRMError('تم حفظ هذه المتابعة بالفعل. افتح تسجيل متابعة جديدة.',409);}
 if(body.customerVersion!==customer.version)throw new CRMError('تغيّرت بيانات العميل أو متابعته الأخيرة. حدّث البيانات ثم أعد المحاولة.',409);
 const service=activeServiceCase(customer.id,c),previousSource=latestCustomerContact(customer.id,c.visible),currentSource=service?.status==='assigned'&&previousSource&&previousSource.createdAt<service.createdAt?undefined:previousSource;
 const projectedSource=body.sourceId?c.visible.find(r=>r.id===body.sourceId&&['activity','opportunity'].includes(r.kind)):currentSource;const source=projectedSource?c.all.find(r=>r.id===projectedSource.id):undefined;
 if(body.sourceId&&(!source||visitCustomer(source,c.all)?.id!==customer.id))throw new CRMError('المتابعة لا تتبع هذا العميل',403);
 if(!source||!canExecuteCustomerFollowup(source))throw new CRMError('المتابعة تتطلب زيارة سابقة بها إجراء قادم وموعد متابعة.',400);
 if(!currentSource||currentSource.id!==source.id)throw new CRMError('تغيّرت المتابعة السابقة. حدّث البيانات ثم أعد المحاولة.',409);
 if(source&&body.sourceVersion!==source.version)throw new CRMError('تغيّرت المتابعة السابقة. حدّث البيانات ثم أعد المحاولة.',409);
 if(service?.status==='assigned'&&source&&source.createdAt<service.createdAt)throw new CRMError('تغيّرت المتابعة السابقة. حدّث البيانات ثم أعد المحاولة.',409);
 const {competitorObservation,...input}=customerFollowupSchema.parse(body.data),hasQuotation=customerHasQuotation(customer.id,c.visible,service?.status==='assigned'?service:undefined)||input.type==='quote'||input.salesStage==='quoted';
 if(offline&&input.date>riyadhDate(occurredAt))throw new CRMError('تاريخ المتابعة لا يمكن أن يكون بعد يوم تسجيلها على الجهاز.');
 if(hasQuotation&&input.salesStage==='won'&&input.invoiceOutcome!=='invoiced')throw new CRMError('أكد تحوّل عرض السعر إلى فاتورة عند إغلاق البيع');
 if(hasQuotation&&input.invoiceOutcome==='invoiced'&&input.salesStage!=='won'||hasQuotation&&input.invoiceOutcome==='lost'&&input.salesStage!=='lost'||hasQuotation&&input.salesStage==='lost'&&input.invoiceOutcome!=='lost')throw new CRMError('نتيجة عرض السعر يجب أن تطابق مرحلة البيع');
 if(!hasQuotation&&input.invoiceOutcome!=='pending')throw new CRMError('لا يوجد عرض سعر مسجل لهذا العميل');
 const closed=followupClosed(input.salesStage),request=visitRequest(source,c.visible)||(source?.kind==='opportunity'?source:undefined);
 let data:any={...input,visitWorkflow:'followup-v1',summary:'متابعة العميل',outcome:'pending',notes:'',nextAction:closed?'':input.nextAction,nextDate:closed?'':input.nextDate,lossReason:input.salesStage==='lost'?input.lossReason:'',lossDetails:input.salesStage==='lost'?input.lossDetails:'',hasQuotation,sourceId:source?.id||'',requestId:request?.id||'',responsibleId:c.me.id,performedBy:c.me.id,recordedByEmail:c.user.email.toLowerCase(),recordedByName:c.me.name};
 Object.assign(data,offlineEvidence(offline));
 // Missing observations leave prior contacts alone and do not invent fresh evidence.
 if(competitorObservation)Object.assign(data,competitorObservation.hasCompetitor?competitorObservation:{hasCompetitor:false,competitorName:'',competitorNotes:'',competitorFileId:'',competitorFileName:''});
 const attachedFile=data.competitorFileId?await loadAuthorizedVisitAttachment(c,customer.id,data.competitorFileId):undefined;
 if(attachedFile)data.competitorFileName=attachedFile.name;
 else if(competitorObservation)data.competitorFileName='';
 if(service?.status==='assigned')(data as any).serviceCaseId=service.id;
 const gate='EXISTS (SELECT 1 FROM crm_records WHERE id=? AND mutation_id=?)',ga=[id,mutation];
 const journey=await prepareJourneyVisitLink(c,customer.id,id,data,undefined,gate,ga,occurredAt,body.data?.journeyStopId);data=journey.data;
 const candidate:Row={id,kind:'activity',parentId:customer.id,assignedTo:customer.assignedTo,branch:customer.branch,data,createdAt:now,updatedAt:now,version:1};
 const latest=customerPlanSource(customer.id,[candidate,...c.all])!;
 let locks='EXISTS (SELECT 1 FROM crm_records WHERE id=? AND version=? AND assigned_to=? AND branch=?) AND EXISTS (SELECT 1 FROM crm_members WHERE id=? AND active=1 AND role=? AND branch=? AND COALESCE(supervisor_id,\'\')=?)'+(source?' AND EXISTS (SELECT 1 FROM crm_records WHERE id=? AND version=?)':'');
 const args=[customer.id,customer.version,customer.assignedTo,customer.branch,c.me.id,c.me.role,c.me.branch,c.me.supervisorId||'',...(source?[source.id,source.version]:[])];
 if(attachedFile){const filePermission=visitAttachmentWriteGuard(c,attachedFile);locks+=' AND '+filePermission.sql;args.push(...filePermission.args);}
 for(const dependency of [customer,source].filter((r):r is Row=>!!r)){const permission=accessGuard(c,dependency);locks+=' AND '+permission.sql;args.push(...permission.args);}
 if(journey.sql){locks+=' AND '+journey.sql;args.push(...journey.args);}
 const statements=[c.db.prepare(`INSERT OR IGNORE INTO crm_records (id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) SELECT ?,'activity',?,?,?,?,?,?,1,? WHERE ${locks}`).bind(id,customer.id,customer.assignedTo,customer.branch,JSON.stringify(data),now,now,mutation,...args)];
 statements.push(...journey.statements);
 if(latest.id===id)statements.push(c.db.prepare(`UPDATE crm_records SET data=json_set(data,'$._visitPlan',json(?)),updated_at=?,version=version+1 WHERE id=? AND ${gate}`).bind(JSON.stringify({visitId:id,date:data.date,nextDate:data.nextDate,nextAction:data.nextAction}),now,customer.id,...ga));
 statements.push(c.db.prepare(`INSERT INTO crm_audit (id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind('customer-followup-save-'+c.me.id+':'+key,id,c.me.name,'visit-receipt',fingerprint,now,...ga));
 statements.push(c.db.prepare(`INSERT INTO crm_audit (id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(crypto.randomUUID(),id,c.me.name,'تسجيل متابعة',input.result.slice(0,250),now,...ga));
 const saved=await c.db.batch(statements);if(saved[0].meta.changes!==1){const replay=await c.db.prepare('SELECT detail FROM crm_audit WHERE id=? AND record_id=?').bind('customer-followup-save-'+c.me.id+':'+key,id).first<{detail:string}>();if(replay?.detail===fingerprint)return Response.json({ok:true,id,alreadySaved:true});throw new CRMError('تغيّرت البيانات بالتزامن. حدّث الصفحة ثم أعد المحاولة.',409);}
 return Response.json({ok:true,id});
}catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(i=>i.message).join(' • ')},{status:400});return replyError(e);}}
