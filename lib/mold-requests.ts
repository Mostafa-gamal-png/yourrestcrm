// Mold manufacturing requests (طلبات تصنيع القوالب): what the screen and the server share. The contract rules live in
// portable/mold-rules.mjs; this adds who may see and change a request, the shape the screen receives and the Arabic wording.
// A representative asks for a mold for one of their customers; production (yourrest-products) owns the status.
import type {Member} from './crm';
import {salesScopeMemberIds} from './access';
import {regionScope} from './regions';
import {MOLD_STAGES,MOLD_STAGE_NAMES,MOLD_CORES,MOLD_MODELS,MOLD_HALF_BLOCKS} from '@/portable/mold-rules.mjs';

export {MOLD_STAGES,MOLD_STAGE_NAMES,MOLD_CORES,MOLD_MODELS,MOLD_HALF_BLOCKS};
export type MoldStage=typeof MOLD_STAGES[number];
export type MoldStatusName='received'|'confirmed'|'in_production'|'produced'|'delivered'|'cancelled';
export type MoldSpecs={description:string;core:string;vibrators:number|null;model:string;halfBlock:string;moldWidth:number|null;gelbaSize:number|null;moldNo:string;quantity:number|null;designUrl:string;notes:string};
export type MoldRemote={crmRequestId:string;orderNo:number|null;status:MoldStatusName;editable:boolean;moldSerial:string|null;productionDate:string|null;stages:Record<string,{done:boolean;at:string|null}>;stagesDone:number;stagesTotal:number;delivered:boolean;deliveryDate:string|null;updatedAt:string|null;revision:number|null};
/** The request as the CRM owns it: the customer and salesman as they were when it was asked for, and the specifications. */
export type MoldRequestData={requestedAt:string;customer:{crmNumber:number;name:string;address:string;city:string};salesman:{crmMemberId:string;name:string;email:string};specs:MoldSpecs};
export type MoldError={code:string;fields?:string[];http?:number;at:string};
export type MoldRequestRow={id:string;memberId:string;customerId:string;legacyOrderNo:number|null;data:MoldRequestData;accepted:MoldRequestData|null;cancelledAt:string|null;cancelReason:string;outbox:'send'|'cancel'|null;attempts:number;firstFailedAt:string|null;nextAttemptAt:string|null;lastAttemptAt:string|null;lastError:MoldError|null;remote:MoldRemote|null;remoteAt:string|null;createdBy:string;createdAt:string;updatedAt:string;version:number};
export type MoldSendingState='sent'|'waiting'|'rejected'|'off';
/** One request as a reader receives it. */
export type MoldRequestView={id:string;memberId:string;memberName:string;customerId:string;customerName:string;crmNumber:number;requestedAt:string;legacyOrderNo:number|null;specs:MoldSpecs;cancelled:boolean;cancelReason:string;
 sending:{state:MoldSendingState;outbox:'send'|'cancel'|null;attempts:number;nextAttemptAt:string|null;lastAttemptAt:string|null;error:MoldError|null};
 remote:MoldRemote|null;remoteAt:string|null;editable:boolean;can:{edit:boolean;cancel:boolean;resend:boolean};version:number};
export type MoldRequestsAnswer={generatedAt:string;linkReady:boolean;linkProblem:string;requests:MoldRequestView[];statusError:MoldError|null;canCreate:boolean};

/** Sales roles have the page; customer service has no sales scope, so no mold requests (lib/crm.ts scopeRecords gives them no sales record). */
export const MOLD_ROLES=['rep','supervisor','manager','admin'];
export const canUseMoldRequests=(role:string)=>MOLD_ROLES.includes(role);
/** A representative asks, for a customer of their own scope; others follow their team. */
export const canCreateMoldRequest=(me:Member)=>me.role==='rep';

type Reader={me:Member;members:Member[];regionCustomerIds:Set<string>};
/** As a sales record: the representative their own requests, a supervisor their representatives', the manager the sales team's, the
 * administrator all; never beyond the reader's regions. */
export function canReadMoldRequest(row:Pick<MoldRequestRow,'memberId'|'customerId'>,c:Reader){
 if(c.me.role==='admin')return true;
 if(!['rep','supervisor','manager'].includes(c.me.role))return false;
 if(!salesScopeMemberIds(c.members,c.me).has(row.memberId))return false;
 return regionScope(c.me)==='all'||c.regionCustomerIds.has(row.customerId);
}
/** Production accepts a change only while the request is `received`; before production first saw it the CRM alone decides. */
export const moldEditable=(row:Pick<MoldRequestRow,'cancelledAt'|'remote'>)=>!row.cancelledAt&&(row.remote?row.remote.editable:true);
export function moldPermissions(row:MoldRequestRow,me:Member){
 const own=me.role==='rep'&&row.memberId===me.id,open=moldEditable(row);
 return {edit:own&&open,cancel:own&&open,resend:own&&!!row.outbox};
}
export function moldSendingState(row:Pick<MoldRequestRow,'outbox'|'lastError'>,linkReady:boolean):MoldSendingState{
 if(!row.outbox)return 'sent';
 if(!linkReady)return 'off';
 return row.lastError&&['invalid_payload','payload_too_large'].includes(row.lastError.code)?'rejected':'waiting';
}

export const moldStatusNames:Record<MoldStatusName,[string,string]>={received:['استلمه الإنتاج','Received by production'],confirmed:['اعتمده الإنتاج','Confirmed'],in_production:['قيد التصنيع','In production'],produced:['تم التصنيع','Produced'],delivered:['تم التسليم للعميل','Delivered'],cancelled:['ملغى','Cancelled']};
export const moldSendingNames:Record<MoldSendingState,[string,string]>={sent:['وصل للإنتاج','Delivered to production'],waiting:['بانتظار الإرسال','Waiting to be sent'],rejected:['رفض الإنتاج البيانات','Production refused the data'],off:['الربط مع الإنتاج غير مفعَّل','The production link is off']};
/** Why a call did not go through, in the representative's words; the code alone is stored. */
export function moldErrorText(code:string,say:(ar:string,en:string)=>string){
 const table:Record<string,[string,string]>={
  network:['تعذّر الوصول إلى تطبيق الإنتاج','Production could not be reached'],timeout:['لم يرد تطبيق الإنتاج خلال 10 ثوانٍ','Production did not answer within 10 seconds'],
  not_configured:['الربط مع الإنتاج غير مفعَّل','The production link is off'],invalid_url:['إعداد عنوان الربط في الـCRM غير صحيح','The link address in the CRM settings is invalid'],short_secret:['مفتاح الربط في إعدادات الـCRM غير صحيح','The link key in the CRM settings is invalid'],
  invalid_signature:['مفتاح الربط غير مطابق بين البرنامجين','The link key differs between the two applications'],stale_timestamp:['ساعة الخادم غير مضبوطة','The server clock is off'],
  invalid_payload:['رفض الإنتاج بعض البيانات','Production refused some data'],payload_too_large:['الطلب أكبر من المسموح','The request is too large'],request_locked:['بدأ الإنتاج؛ لم يعد التعديل أو الإلغاء ممكنًا','Production has started; no more changes'],
  bad_response:['رد غير متوقع من تطبيق الإنتاج','Unexpected answer from production'],server_error:['خطأ في تطبيق الإنتاج','Production application error'],not_found:['الطلب غير موجود لدى الإنتاج','Production does not know this request'],
 };
 const found=table[code]||(/^http_5/.test(code)?table.server_error:undefined);
 return found?say(...found):say('تعذّر الاتصال بتطبيق الإنتاج','Production could not be reached');
}
/** The contract's field names, for a refusal that names them. */
export const moldFieldNames:Record<string,[string,string]>={'specs.description':['الوصف','Description'],'specs.core':['العلب','Core'],'specs.vibrators':['الرجاجات','Vibrators'],'specs.model':['الموديل','Model'],'specs.halfBlock':['بلوكة النص','Half block'],'specs.moldWidth':['عرض القالب','Mold width'],'specs.gelbaSize':['مقاس الجلب','Gelba size'],'specs.moldNo':['رقم القالب','Mold no.'],'specs.quantity':['الكمية','Quantity'],'specs.designUrl':['رابط التصميم','Design link'],'specs.notes':['الملاحظات','Notes'],'customer.name':['اسم العميل','Customer name'],'customer.crmNumber':['كود يورست للعميل','Customer Yourrest code'],'customer.address':['عنوان العميل','Customer address'],'customer.city':['مدينة العميل','Customer city'],'salesman.name':['اسم المندوب','Salesman name'],'salesman.email':['بريد المندوب','Salesman email'],requestedAt:['تاريخ الطلب','Request date'],legacyOrderNo:['رقم الطلب في الشيت','Sheet order number'],crmRequestId:['رقم الطلب','Request id']};
/** YR-C-000027 -> 27: the customer's Yourrest code, the number the contract sends as customer.crmNumber. */
export function yourrestNumber(internalCode:unknown){const match=/^YR-C-(\d{1,10})$/.exec(String(internalCode||''));const value=match?Number(match[1]):NaN;return Number.isInteger(value)&&value>0&&value<=2147483647?value:null;}
