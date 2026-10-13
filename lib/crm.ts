import { z } from 'zod';
import {lineCents,moneyCents,percentCents} from './decimal-money';
import {regionRecords} from './regions';
import {salesRecordAccess} from './access';
import {customerAddressFields} from './customer-fields';
export const stages = ['new','specs','technical','quoted','negotiation','won','lost'] as const;
export const stageLabels:Record<string,string> = {new:'تحديد الاحتياج',specs:'جمع المواصفات',technical:'مراجعة فنية',quoted:'عرض سعر',negotiation:'تفاوض',won:'تم الفوز',lost:'تم الفقد'};
export const roles:Record<string,string> = {admin:'مدير النظام',manager:'مدير المبيعات',supervisor:'مشرف المبيعات',rep:'مندوب المبيعات',customer_service_manager:'مدير خدمة العملاء',customer_service:'ممثل خدمة العملاء'};
export type Kind = 'customer'|'factory'|'opportunity'|'activity'|'quote';
export type Row = {id:string;kind:Kind;parentId:string|null;assignedTo:string;branch:string;data:any;createdAt:string;updatedAt:string;version:number};
export type AuditEntry = {id:string;recordId:string;actor:string;action:string;detail:string;createdAt:string};
export type Member = {authVersion?:number;editToken?:string;id:string;userId?:string;email:string;name:string;role:string;branch:string;supervisorId?:string;regionScope?:string;readOnly?:boolean;active:number;target:number};
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const money=(v:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:2,minimumFractionDigits:0}).format(v||0);
export const isSalesRequest=(r:Row)=>r.kind==='opportunity'&&r.data.hasRequest!==false;
export const isOpen=(r:Row)=>r.kind==='opportunity'&&(isSalesRequest(r)?!['won','lost'].includes(r.data.stage):r.data.followupStatus!=='closed');
export const followupTitle=(r:Row)=>r.kind==='activity'?r.data.summary:(r.data.followupTitle||r.data.moldType||'متابعة العميل');
const short=z.string().trim().max(250).default('');
const required=z.string().trim().min(1,'هذا الحقل مطلوب').max(250);
const notes=z.string().trim().max(6000).default('');
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'أدخل تاريخًا صحيحًا').refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'التاريخ غير صالح');
const optionalDate=z.union([date,z.literal('')]).default('');
const timestamp=z.union([z.string().datetime({offset:true}),z.literal('')]).default('');
const positive=z.coerce.number().finite().positive().max(1000000);
const amount=z.coerce.number().finite().min(0).max(1000000000);
export const schemas={
 customer:z.object({name:required,code:short,city:short,region:short,address:short,...customerAddressFields,contact:short,phone:short,email:z.union([z.string().email(),z.literal('')]).default(''),contact2:short,phone2:short,email2:z.union([z.string().email(),z.literal('')]).default(''),customerType:short,customerStatus:short,machineCount:z.coerce.number().int().min(0).max(100000).nullable().optional(),machineTypes:short,supplier:short,category:short,sourceFile:short,sourceRow:z.number().int().positive().optional(),sourceKey:short,sourceHash:short,notes,branch:required,assignedTo:required}),
 factory:z.object({name:required,recordType:z.enum(['machine','group']).default('machine'),quantity:z.coerce.number().int().min(0).max(100000).nullable().default(1),machineBrand:short,machineModel:short,machineType:z.enum(['stationary','mobile','unknown']).default('unknown'),machineSerial:short,boardDimensions:short,location:short,notes,sourceMachineTypes:short,sourceMachineCount:z.number().int().min(0).nullable().optional(),sourceFile:short,sourceRow:z.number().int().positive().optional(),sourceKey:short,sourceHash:short}).superRefine((v,c)=>{if(v.recordType==='machine'&&(!v.machineBrand||!v.machineModel))c.addIssue({code:'custom',message:'أدخل الشركة المصنعة والموديل للماكينة'});}),
 opportunity:z.object({responsibleId:short,hasRequest:z.boolean().default(true),followupTitle:short,followupStatus:z.enum(['open','closed']).default('open'),moldType:short,product:short,dimensions:short,cavities:z.coerce.number().int().min(0).max(10000).default(0),quantity:positive.int(),requiredAt:optionalDate,value:amount.nullable().default(null),stage:z.enum(stages),nextAction:short,nextDate:optionalDate,technicalStatus:z.enum(['pending','approved']).default('pending'),technicalNotes:notes,technicalBy:short,technicalAt:short,lossReason:short,orderRef:short,closedAt:optionalDate,notes}).superRefine((v,c)=>{
 if(v.hasRequest&&(!v.moldType||!v.product||!v.dimensions))c.addIssue({code:'custom',message:'أدخل نوع القالب والمنتج والأبعاد المطلوبة'});
 if(!v.hasRequest&&!v.followupTitle)c.addIssue({code:'custom',message:'أدخل موضوع المتابعة'});
 if((v.hasRequest?!['won','lost'].includes(v.stage):v.followupStatus==='open')&&(!v.nextAction||!v.nextDate))c.addIssue({code:'custom',message:'المتابعة المفتوحة تحتاج الإجراء القادم وموعد المتابعة'});
 if(v.hasRequest&&v.stage==='won'&&(!v.orderRef||v.value===null||!v.closedAt))c.addIssue({code:'custom',message:'الفوز يحتاج مرجع الطلب والقيمة النهائية وتاريخ الإغلاق'});
 if(v.hasRequest&&v.stage==='lost'&&(!v.lossReason||!v.closedAt))c.addIssue({code:'custom',message:'حدد سبب الفقد وتاريخ الإغلاق'});
 if(v.technicalStatus==='approved'&&!v.technicalNotes)c.addIssue({code:'custom',message:'أضف ملاحظات الاعتماد الفني'});
 }),
 activity:z.object({visitWorkflow:z.literal('customer-v1').optional(),responsibleId:short,customerStage:short,salesStage:z.union([z.enum(stages),z.literal('')]).optional(),strength:z.union([z.enum(['weak','medium','strong']),z.literal('')]).optional(),requestedProducts:z.array(z.string().trim().min(1).max(250)).max(30).default([]),hasCompetitor:z.boolean().default(false),competitorName:short,competitorNotes:notes,competitorFileId:short,competitorFileName:short,customerNeeds:notes,requestId:short,requestSnapshot:z.record(z.unknown()).optional(),type:z.enum(['visit','call','email','whatsapp']),date,summary:required,result:short,outcome:z.enum(['pending','effective','followup','noresponse']).default('pending'),nextAction:short,nextDate:optionalDate,notes,location:short,latitude:z.number().nullable().optional(),longitude:z.number().nullable().optional(),locationSource:z.enum(['device']).optional(),locationCapturedAt:timestamp,locationAccuracy:z.number().finite().min(0).optional(),startedAt:timestamp,endedAt:timestamp,visitNumber:z.number().int().positive().optional(),durationSeconds:z.number().int().min(0).nullable().optional(),durationReview:z.boolean().optional(),performedBy:short,recordedByEmail:short}),
 quote:z.object({number:short,date,validUntil:date,status:z.enum(['draft','sent','accepted','rejected']),items:z.array(z.object({description:required,quantity:positive,price:amount})).min(1).max(50),discount:amount.default(0),taxRate:z.coerce.number().finite().min(0).max(100),terms:notes,subtotal:amount.optional(),tax:amount.optional(),total:amount.optional()}).superRefine((v,c)=>{if(v.validUntil<v.date)c.addIssue({code:'custom',message:'صلاحية العرض يجب ألا تسبق تاريخ الإصدار'});if(moneyCents(v.discount)>v.items.reduce((s,i)=>s+lineCents(i.quantity,i.price),0))c.addIssue({code:'custom',message:'الخصم أكبر من قيمة البنود'});const totals=quoteTotals(v.items,v.discount,v.taxRate);if(Object.values(totals).some(value=>!Number.isFinite(value)||value<0||value>1000000000))c.addIssue({code:'custom',message:'قيمة عرض السعر المحسوبة تتجاوز الحد المسموح؛ راجع الكميات والأسعار والضريبة'});})
};
export function quoteTotals(items:{quantity:number;price:number}[],discount:number,taxRate:number){const subCents=items.reduce((s,i)=>s+lineCents(i.quantity,i.price),0);const net=subCents-moneyCents(discount);const tax=percentCents(net,taxRate);return{subtotal:subCents/100,tax:tax/100,total:(net+tax)/100};}
export function scopeRecords(all:Row[],members:Member[],me:Member){
 all=regionRecords(all,me);
 if(['customer_service','customer_service_manager'].includes(me.role))return [];
 // Customer-service assistance requests are not sales records: they have their own route and never travel with the records.
 if(me.role==='admin')return all.filter(row=>(row.kind as string)!=='support');
 const indexed=new Map(all.map(row=>[row.id,row])),access=salesRecordAccess(members,me);
 const allowed=all.filter(row=>access.canRead(row)),ids=new Set(allowed.map(row=>row.id));
 const rootCustomer=(row:Row)=>{let current:Row|undefined=row;const seen=new Set<string>();while(current&&current.kind!=='customer'&&!seen.has(current.id)){seen.add(current.id);current=current.parentId?indexed.get(current.parentId):undefined;}return current?.kind==='customer'?current:undefined;};
 return allowed.map(row=>{
  const data={...row.data};let parentId=row.parentId;
  if(row.kind==='customer'){
   if(data._visitPlan&&!ids.has(data._visitPlan.visitId))delete data._visitPlan;
   if(data._stageVisitId&&!ids.has(data._stageVisitId))delete data._stageVisitId;
   if(!access.canEditCustomerDetails(row))data._masterReadOnly=true;
   if(!access.canManageMaster(row))data._masterRoutingReadOnly=true;
  }
  if(row.kind==='factory'&&!access.canManageMaster(row))data._masterReadOnly=true;
  if(['activity','quote'].includes(row.kind)&&parentId&&!ids.has(parentId))parentId=rootCustomer(row)?.id||parentId;
  if(data.requestSnapshot&&(!data.requestId||!ids.has(data.requestId)))delete data.requestSnapshot;
  if(data.requestId&&!ids.has(data.requestId))delete data.requestId;
  if(data.sourceId&&!ids.has(data.sourceId))delete data.sourceId;
  if(data._serviceWorkflow)delete data._serviceWorkflow;
  return {...row,parentId,data};
 });
}
