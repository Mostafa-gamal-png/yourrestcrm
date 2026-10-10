import {z} from 'zod';
import {type Row,stages,today} from './crm';
import {customerPlanSource,visitCustomer,visitRequest,visitOrder} from './customer-visits';

export const followupTypes:Record<string,string>={visit:'زيارة',call:'اتصال',whatsapp:'واتساب',quote:'عرض سعر',meeting:'اجتماع',followup:'متابعة'};
export const invoiceOutcomes:Record<string,string>={pending:'لم يتحول بعد — المتابعة مستمرة',invoiced:'نعم، تحوّل إلى فاتورة',lost:'لا، فُقد عرض السعر'};
export const followupLossReasons=['السعر أعلى من المنافس','المواصفات الفنية','عدم توفر الصنف','مدة التوريد','شروط الدفع','المنافس','علاقة العميل بالمورد الحالي','تأخر المتابعة','عدم الوصول لصاحب القرار','توقف المصنع','أُلغي الطلب','المنتج غير مناسب','أخرى'];
export const isCustomerFollowup=(r:Row|undefined)=>r?.kind==='activity'&&r.data.visitWorkflow==='followup-v1';
export const followupClosed=(stage:string)=>['won','lost'].includes(stage);
/** Quote evidence belongs to the current request or sales cycle, never the customer's lifetime. */
export function customerHasQuotation(customerId:string,records:Row[],service?:{id:string;createdAt:string}){
 const active=service||records.find(r=>r.id===customerId)?.data._serviceIntake;
 const since=active?.id&&active?.createdAt?active.createdAt:'';
 const contacts=records.filter(r=>r.kind==='activity'&&r.data.visitWorkflow!=='service-intake-v1'&&visitCustomer(r,records)?.id===customerId&&(!since||r.createdAt>=since)).sort((a,b)=>visitOrder(b).localeCompare(visitOrder(a)));
 let source:Row|undefined=customerPlanSource(customerId,records);if(since&&source&&source.createdAt<since)source=undefined;
 const request=source?.kind==='opportunity'?source:visitRequest(source,records);
 const evidence=(r:Row)=>r.kind==='quote'||r.data.type==='quote'||r.data.salesStage==='quoted'||r.data.stage==='quoted'||r.data.hasQuotation===true;
 if(request)return records.some(r=>(!since||r.createdAt>=since)&&(r.id===request.id||r.kind==='quote'&&r.parentId===request.id||r.kind==='activity'&&visitRequest(r,records)?.id===request.id)&&evidence(r));
 const current=contacts[0],previousClose=contacts.find(r=>r.id!==current?.id&&followupClosed(r.data.salesStage));
 const boundary=previousClose?visitOrder(previousClose):'';
 return contacts.some(r=>(!boundary||visitOrder(r)>boundary)&&evidence(r))||records.some(r=>r.kind==='quote'&&visitCustomer(r,records)?.id===customerId&&(!since||r.createdAt>=since)&&(!boundary||visitOrder(r)>boundary));
}

export const latestCustomerContact=customerPlanSource;
/** Only an open, scheduled previous contact can be executed as a follow-up. */
export function canExecuteCustomerFollowup(source:Row|undefined){return !!source&&!source.data._offlineState&&!source.data._offlineAcknowledged&&['activity','opportunity'].includes(source.kind)&&source.data.visitWorkflow!=='service-intake-v1'&&!followupClosed(source.data.salesStage||source.data.stage||'new')&&source.data.followupStatus!=='closed'&&!!source.data.nextAction?.trim()&&!!source.data.nextDate;}

export function customerFollowupPlans(records:Row[]){return records.filter(r=>r.kind==='customer').flatMap(customer=>{const source=latestCustomerContact(customer.id,records);if(!source)return[];const stage=source.data.salesStage||source.data.stage||'';return[{customer,source,stage,nextDate:source.data.nextDate||'',nextAction:source.data.nextAction||'',responsibleId:customer.assignedTo,closed:followupClosed(stage)||source.data.followupStatus==='closed'}];}).sort((a,b)=>(a.nextDate||'0000').localeCompare(b.nextDate||'0000')||a.customer.data.name.localeCompare(b.customer.data.name));}
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'أدخل تاريخًا صحيحًا').refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'أدخل تاريخًا صحيحًا');
const competitorText=z.string().trim().max(250).default('');
/** An explicit observation belongs only to the contact being saved, never its source. */
export const followupCompetitorObservationSchema=z.object({hasCompetitor:z.boolean().default(false),competitorName:competitorText,competitorNotes:z.string().trim().max(6000).default(''),competitorFileId:competitorText,competitorFileName:competitorText}).superRefine((data,c)=>{
 if(data.hasCompetitor&&!data.competitorName)c.addIssue({code:'custom',path:['competitorName'],message:'اكتب اسم المنافس'});
});
export const customerFollowupSchema=z.object({type:z.enum(['visit','call','whatsapp','quote','meeting','followup']),date,result:z.string().trim().min(3,'اكتب نتيجة المتابعة في 3 أحرف على الأقل').max(4000),salesStage:z.union([z.enum(stages),z.literal('')]).default(''),invoiceOutcome:z.enum(['pending','invoiced','lost']).default('pending'),nextAction:z.string().trim().max(1000).default(''),nextDate:z.union([date,z.literal('')]).default(''),lossReason:z.string().trim().max(250).default(''),lossDetails:z.string().trim().max(2000).default(''),competitorObservation:followupCompetitorObservationSchema.nullable().optional()}).superRefine((data,c)=>{
 if(data.date>today())c.addIssue({code:'custom',message:'تاريخ المتابعة المنفذة لا يمكن أن يكون في المستقبل'});
 if(!followupClosed(data.salesStage)&&(!data.nextAction||!data.nextDate))c.addIssue({code:'custom',message:'حدد الإجراء القادم وموعد المتابعة القادمة'});
 if(!followupClosed(data.salesStage)&&data.nextDate<data.date)c.addIssue({code:'custom',message:'موعد المتابعة القادمة لا يسبق تاريخ المتابعة المنفذة'});
 if(data.salesStage==='lost'&&(!followupLossReasons.includes(data.lossReason)||data.lossReason==='أخرى'&&!data.lossDetails))c.addIssue({code:'custom',message:'حدد سبب الفقد، واكتب التفاصيل عند اختيار أخرى'});
});
