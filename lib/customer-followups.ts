import {z} from 'zod';
import {type Row,stages,today,isSalesRequest} from './crm';
import {customerPlanSource,customerPlanSources,visitOrder} from './customer-visits';

export const followupTypes:Record<string,string>={visit:'زيارة',call:'اتصال',whatsapp:'واتساب',quote:'عرض سعر',meeting:'اجتماع',followup:'متابعة'};
export const invoiceOutcomes:Record<string,string>={pending:'لم يتحول بعد — المتابعة مستمرة',invoiced:'نعم، تحوّل إلى فاتورة',lost:'لا، فُقد عرض السعر'};
export const followupLossReasons=['السعر أعلى من المنافس','المواصفات الفنية','عدم توفر الصنف','مدة التوريد','شروط الدفع','المنافس','علاقة العميل بالمورد الحالي','تأخر المتابعة','عدم الوصول لصاحب القرار','توقف المصنع','أُلغي الطلب','المنتج غير مناسب','أخرى'];
export const isCustomerFollowup=(r:Row|undefined)=>r?.kind==='activity'&&r.data.visitWorkflow==='followup-v1';
export const followupClosed=(stage:string)=>['won','lost'].includes(stage);
/** Quote evidence belongs to the current request or sales cycle, never the customer's lifetime. */
export function customerHasQuotation(customerId:string,records:Row[],service?:{id:string;createdAt:string}){
 // One index for this call: the customer and the request of each record without a scan of every record per record.
 const indexed=new Map<string,Row>();for(const row of records)if(!indexed.has(row.id))indexed.set(row.id,row);
 const customerOf=(row:Row|undefined)=>{for(let i=0;row&&i<5;i++){if(row.kind==='customer')return row;row=row.parentId!==null&&row.parentId!==undefined?indexed.get(row.parentId):undefined;}return undefined;};
 const requestOf=(row:Row|undefined)=>{if(!row)return;const candidate=indexed.get(row.data.requestId||row.parentId);return candidate&&isSalesRequest(candidate)?candidate:undefined;};
 const active=service||indexed.get(customerId)?.data._serviceIntake;
 const since=active?.id&&active?.createdAt?active.createdAt:'';
 const contacts=records.filter(r=>r.kind==='activity'&&r.data.visitWorkflow!=='service-intake-v1'&&customerOf(r)?.id===customerId&&(!since||r.createdAt>=since)).map(row=>({row,order:visitOrder(row)})).sort((a,b)=>b.order.localeCompare(a.order));
 let source:Row|undefined=customerPlanSource(customerId,records);if(since&&source&&source.createdAt<since)source=undefined;
 const request=source?.kind==='opportunity'?source:requestOf(source);
 const evidence=(r:Row)=>r.kind==='quote'||r.data.type==='quote'||r.data.salesStage==='quoted'||r.data.stage==='quoted'||r.data.hasQuotation===true;
 if(request)return records.some(r=>(!since||r.createdAt>=since)&&(r.id===request.id||r.kind==='quote'&&r.parentId===request.id||r.kind==='activity'&&requestOf(r)?.id===request.id)&&evidence(r));
 const current=contacts[0]?.row,previousClose=contacts.find(({row})=>row.id!==current?.id&&followupClosed(row.data.salesStage));
 const boundary=previousClose?previousClose.order:'';
 return contacts.some(({row,order})=>(!boundary||order>boundary)&&evidence(row))||records.some(r=>r.kind==='quote'&&customerOf(r)?.id===customerId&&(!since||r.createdAt>=since)&&(!boundary||visitOrder(r)>boundary));
}

export const latestCustomerContact=customerPlanSource;
/** Only an open, scheduled previous contact can be executed as a follow-up. */
export function canExecuteCustomerFollowup(source:Row|undefined){return !!source&&!source.data._offlineState&&!source.data._offlineAcknowledged&&['activity','opportunity'].includes(source.kind)&&source.data.visitWorkflow!=='service-intake-v1'&&!followupClosed(source.data.salesStage||source.data.stage||'new')&&source.data.followupStatus!=='closed'&&!!source.data.nextAction?.trim()&&!!source.data.nextDate;}

export function customerFollowupPlans(records:Row[],plans:Map<string,Row|undefined>=customerPlanSources(records)){return records.filter(r=>r.kind==='customer').flatMap(customer=>{const source=plans.get(customer.id);if(!source)return[];const stage=source.data.salesStage||source.data.stage||'';return[{customer,source,stage,nextDate:source.data.nextDate||'',nextAction:source.data.nextAction||'',responsibleId:customer.assignedTo,closed:followupClosed(stage)||source.data.followupStatus==='closed'}];}).sort((a,b)=>(a.nextDate||'0000').localeCompare(b.nextDate||'0000')||a.customer.data.name.localeCompare(b.customer.data.name));}
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'أدخل تاريخًا صحيحًا').refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'أدخل تاريخًا صحيحًا');
const competitorText=z.string().trim().max(250).default('');
/** An explicit observation belongs only to the contact being saved, never its source. */
export const followupCompetitorObservationSchema=z.object({hasCompetitor:z.boolean().default(false),competitorName:competitorText,competitorNotes:z.string().trim().max(6000).default(''),competitorFileId:competitorText,competitorFileName:competitorText}).superRefine((data,c)=>{
 if(data.hasCompetitor&&!data.competitorName)c.addIssue({code:'custom',path:['competitorName'],message:'اكتب اسم المنافس'});
});
/** The device's point, carried by a follow-up that is a visit (see lib/visit-place.ts); the route drops it from every other kind. */
const followupLocation={location:z.string().trim().max(250).default(''),latitude:z.number().finite().min(-90).max(90).nullable().optional(),longitude:z.number().finite().min(-180).max(180).nullable().optional(),locationSource:z.literal('device').optional(),locationCapturedAt:z.union([z.string().datetime({offset:true}),z.literal('')]).optional(),locationAccuracy:z.number().finite().min(0).optional()};
export const customerFollowupSchema=z.object({type:z.enum(['visit','call','whatsapp','quote','meeting','followup']),date,...followupLocation,result:z.string().trim().min(3,'اكتب نتيجة المتابعة في 3 أحرف على الأقل').max(4000),salesStage:z.union([z.enum(stages),z.literal('')]).default(''),invoiceOutcome:z.enum(['pending','invoiced','lost']).default('pending'),nextAction:z.string().trim().max(1000).default(''),nextDate:z.union([date,z.literal('')]).default(''),lossReason:z.string().trim().max(250).default(''),lossDetails:z.string().trim().max(2000).default(''),competitorObservation:followupCompetitorObservationSchema.nullable().optional()}).superRefine((data,c)=>{
 if(data.date>today())c.addIssue({code:'custom',message:'تاريخ المتابعة المنفذة لا يمكن أن يكون في المستقبل'});
 if(!followupClosed(data.salesStage)&&(!data.nextAction||!data.nextDate))c.addIssue({code:'custom',message:'حدد الإجراء القادم وموعد المتابعة القادمة'});
 if(!followupClosed(data.salesStage)&&data.nextDate<data.date)c.addIssue({code:'custom',message:'موعد المتابعة القادمة لا يسبق تاريخ المتابعة المنفذة'});
 if(data.salesStage==='lost'&&(!followupLossReasons.includes(data.lossReason)||data.lossReason==='أخرى'&&!data.lossDetails))c.addIssue({code:'custom',message:'حدد سبب الفقد، واكتب التفاصيل عند اختيار أخرى'});
});
