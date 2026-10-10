import {canReadService,isServiceRole} from './customer-service';
import {salesScopeMemberIds,recordAuthorId} from './access';
import {CRMError,context,isRecord} from './crm-server';
import {completeMachineSpecs} from './machines';
import {isSalesRequest,type Row,type schemas} from './crm';
import type {z} from 'zod';
import {coordinatesFromText,type LocationFields} from './customer-location';
import {durationSeconds,durationNeedsReview,riyadhDate,visitResult} from './visits';
type Context=Awaited<ReturnType<typeof context>>;
export type OpportunityData=z.infer<typeof schemas.opportunity>&Record<string,unknown>;
export type ContactData=LocationFields&{startedAt?:string;endedAt?:string;result?:string;outcome?:string;performedBy?:string;recordedByEmail?:string;visitNumber?:number;durationSeconds?:number|null;durationReview?:boolean;date?:string;responsibleId?:string}&Record<string,unknown>;
export function requireLegacyVisit(data:unknown,old?:Row){
 const keys=['visitWorkflow','responsibleId','customerStage','salesStage','strength','requestedProducts','hasCompetitor','competitorName','competitorNotes','competitorFileId','competitorFileName','customerNeeds','requestId','requestSnapshot'];
 const fields:Record<string,unknown>=isRecord(data)?data:{};
 if(old?.data.visitWorkflow||keys.some(k=>{const value=fields[k];return Array.isArray(value)?value.length>0:!!value;}))throw new CRMError('استخدم قسم الزيارات لحفظ بيانات الزيارة والعميل.',400);
}
export function preserveRequestResponsible(data:{responsibleId?:string},old?:Row){
 if(data.responsibleId&&data.responsibleId!==(old?.data.responsibleId||''))throw new CRMError('حدّث مسؤول الطلب من قسم الزيارات.',400);
 data.responsibleId=old?.data.responsibleId||'';
}
export function validateFollowup(data:OpportunityData,old:Row|undefined,parent:Row,c:Context,now:string){
 const canManage=['admin','manager'].includes(c.me.role);
 if(!data.hasRequest){
  if(old&&isSalesRequest(old))throw new CRMError('لا يمكن إخفاء طلب قالب مسجل من المتابعة. احتفظ بتفاصيله وحدّث مرحلة البيع.');
  Object.assign(data,{moldType:'',product:'',dimensions:'',cavities:0,quantity:1,value:null,stage:'new',technicalStatus:'pending',technicalNotes:'',technicalBy:'',technicalAt:'',closedAt:'',lossReason:'',orderRef:'',requiredAt:''});return;
 }
 const specsChanged=old&&(['moldType','product','dimensions','cavities','quantity'].some(k=>old.data[k]!==data[k])||old.parentId!==parent.id);
 if(specsChanged&&data.technicalStatus==='approved')throw new CRMError('تغيّرت المواصفات أو الماكينة. احفظ بانتظار المراجعة ثم اعتمد المواصفات الجديدة.');
 const approving=data.technicalStatus==='approved'&&(old?.data.technicalStatus!=='approved'||data.technicalNotes!==old?.data.technicalNotes);
 if(data.technicalStatus==='approved'&&(parent.kind!=='factory'||!completeMachineSpecs(parent.data)))throw new CRMError('حدد الماكينة واستكمل الشركة والموديل والنوع قبل الاعتماد الفني');
 if(approving&&!canManage)throw new CRMError('الاعتماد الفني متاح للإدارة فقط',403);
 data.technicalBy=approving?c.me.name:old?.data.technicalBy||'';data.technicalAt=approving?now:old?.data.technicalAt||'';
 if(data.technicalStatus==='pending'){data.technicalBy='';data.technicalAt='';}
 if(['quoted','negotiation','won'].includes(data.stage)&&data.technicalStatus!=='approved')throw new CRMError('اعتمد مواصفات القالب فنيًا قبل التسعير أو إغلاق البيع');
 if(!['won','lost'].includes(data.stage)){data.closedAt='';data.lossReason='';data.orderRef='';}
}
/** Shared saved contact evidence for legacy and current visit endpoints.
 * Request responsibility and replay markers stay with their original workflows. */
export function prepareContactEvidence(data:ContactData,c:Context,now:string,clockAction?:string,old?:Row){
 if(clockAction==='start'){data.startedAt=now;data.endedAt='';}
 if(clockAction==='finish'){data.startedAt=old?.data.startedAt||data.startedAt;if(!data.startedAt)throw new CRMError('ابدأ الزيارة أولًا');data.endedAt=now;}
 if(data.endedAt&&!data.startedAt)throw new CRMError('حدد بداية الزيارة قبل نهايتها');
 if(data.startedAt&&Date.parse(data.startedAt)>Date.now()+60000||data.endedAt&&Date.parse(data.endedAt)>Date.now()+60000)throw new CRMError('وقت الزيارة الفعلي لا يمكن أن يكون في المستقبل');
 if(data.startedAt&&data.endedAt&&Date.parse(data.endedAt)<Date.parse(data.startedAt))throw new CRMError('نهاية الزيارة يجب أن تكون بعد بدايتها');
 if(data.endedAt&&!visitResult(data))throw new CRMError('سجّل نتيجة الزيارة قبل إنهائها');
 validateVisitLocation(data,old);
 data.performedBy=old?recordAuthorId(old,c.members)||'':c.me.id;data.recordedByEmail=old?old.data.recordedByEmail||'':c.user.email.toLowerCase();if(old?.data.visitNumber)data.visitNumber=old.data.visitNumber;else delete data.visitNumber;
 data.durationSeconds=durationSeconds(data.startedAt,data.endedAt);data.durationReview=durationNeedsReview(data);if(data.startedAt)data.date=riyadhDate(data.startedAt);
}

export function prepareNewContact(data:ContactData,c:Context,now:string,clockAction?:string,old?:Row){
 prepareContactEvidence(data,c,now,clockAction,old);
 data.responsibleId=old?old.data.responsibleId||recordAuthorId(old,c.members)||'':c.me.id;
 if(old)for(const key of ['_creationRequest','_startRequest','_finishRequest'])if(old.data[key])data[key]=old.data[key];
}

/** Location is captured by the client device once and locked after creation. */
export function validateVisitLocation(data:ContactData,old?:Row){
 if(old){
  if(data.location!==(old.data.location||''))throw new CRMError('لوكيشن الزيارة محفوظ ولا يمكن تعديله.');
  for(const key of ['location','latitude','longitude','locationSource','locationCapturedAt','locationAccuracy']){if(old.data[key]!==undefined)data[key]=old.data[key];else delete data[key];}
  return;
 }
 const point=coordinatesFromText(data.location);
 if(!point||data.locationSource!=='device'||!data.locationCapturedAt||!Number.isFinite(data.locationAccuracy))throw new CRMError('انتظر تحديد موقع الجهاز تلقائيًا، واسمح بالوصول للموقع قبل حفظ الزيارة.');
 if(!Number.isFinite(Date.parse(data.locationCapturedAt))||Date.parse(data.locationCapturedAt)>Date.now()+60000)throw new CRMError('وقت التقاط الموقع غير صحيح. أعد المحاولة.');
 data.latitude=point.latitude;data.longitude=point.longitude;
}

/** Customer access alone never grants access to another recorder's uploaded files. */
export function canAccessVisitFile(c:Context,file:{id:string;customer_id:string;uploaded_by:string}){
 if(!c.regionCustomerIds.has(file.customer_id))return false;
 if(c.me.role==='admin')return true;
 if(!isServiceRole(c.me.role))return salesScopeMemberIds(c.members,c.me).has(file.uploaded_by)||c.visible.some(r=>r.kind==='activity'&&r.data.competitorFileId===file.id);
 if(file.uploaded_by===c.me.id&&c.regionalRecords.some(r=>r.id===file.customer_id&&r.branch===c.me.branch))return true;
 return c.serviceCases.some(s=>s.customerId===file.customer_id&&canReadService(s,c)&&(s.data.registration?.competitorFileId===file.id||(s.data.registrations||[]).some(entry=>entry.registration.competitorFileId===file.id)||c.all.some(r=>r.kind==='activity'&&r.data.serviceCaseId===s.id&&r.data.competitorFileId===file.id)));
}
