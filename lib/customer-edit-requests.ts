import type {Member} from './crm';

/** «طلبات تعديل بيانات العميل» (the owner, 2026-11-15, item 4 of the GSCO comparison list, after GSCO 2.13.55 and 2.13.73 on its projects):
 *  a correction of a customer's details by a representative, a supervisor or customer service no longer changes the customer: it becomes a
 *  request that waits. A representative's goes first to their supervisor (the member their account names as supervisor, while that member
 *  is an active supervisor) and, once the supervisor approves it, to the sales manager; a supervisor's, customer service's and a
 *  representative's with no active supervisor go straight to the sales manager. Whoever decides may reject it with a reason, which ends it
 *  and reaches the sender; the sender may cancel it at either step. The sales manager (and the administrator) still edit directly, and
 *  decide only once it has passed the supervisor. A supervisor who is deactivated (or unlinked) while a request waits for them no longer
 *  holds it: the stage is read live, so it reaches the sales manager with no job. A request holds only the fields its sender changed, beside
 *  what they held then; it can never carry a locked field (the ERP code, the responsible member and branch, the imported markers), and a
 *  field someone changed since makes it stale, which approval refuses rather than overwrite. Kept in crm_audit (no migration):
 *  lib/customer-edit-requests-server.ts. This file is pure, shared by the page, the server and the tests. */

/** The fields a request may change, in the order the form shows them. Anything else is never part of a request. */
export const CUSTOMER_EDIT_FIELDS=['name','region','customerType','customerKind','customerStatus','category','phone','contact','city','location','shortAddress','address','email','contact2','phone2','email2','machineCount','machineTypes','supplier','notes'] as const;
export type CustomerEditField=typeof CUSTOMER_EDIT_FIELDS[number];
/** Held with «location»: the point and how it was captured travel with the text, never apart. */
export const LOCATION_DETAILS=['latitude','longitude','locationSource','locationCapturedAt','locationAccuracy'] as const;
/** Never changed by a request, whatever the sender's role (the ERP code: the owner, 2026-11-12, for everyone; the routing: only the
 *  administrator and the sales manager, who edit directly; the imported markers: the ERP import only). The server builds a request from
 *  CUSTOMER_EDIT_FIELDS alone, so these are listed for the tests and the reader. */
export const CUSTOMER_EDIT_LOCKED=['code','assignedTo','branch','sourceFile','sourceRow','sourceKey','sourceHash','erpCreatedAt','erpRep'] as const;

export const CUSTOMER_EDIT_FIELD_TEXT:Record<CustomerEditField,[string,string]>={
 name:['اسم المصنع','Factory name'],region:['المنطقة','Region'],customerType:['تصنيف العميل','Customer classification'],customerKind:['نوع العميل','Customer type'],
 customerStatus:['حالة العميل','Customer status'],category:['فئة المصنع','Factory category'],phone:['الجوال','Mobile'],contact:['مسؤول التواصل','Contact person'],
 city:['المدينة','City'],location:['اللوكيشن','Location'],shortAddress:['العنوان الوطني المختصر','Short national address'],address:['العنوان','Address'],
 email:['بريد المسؤول الأول','First contact email'],contact2:['اسم المسؤول الثاني','Second contact name'],phone2:['جوال المسؤول الثاني','Second contact mobile'],
 email2:['بريد المسؤول الثاني','Second contact email'],machineCount:['عدد الماكينات في الشيت','Machine count in the sheet'],machineTypes:['أنواع الماكينات في الشيت','Machine types in the sheet'],
 supplier:['مورد القوالب والقطع','Molds and parts supplier'],notes:['ملاحظات المصنع','Factory notes']
};
/** Fields whose stored value is one of the application's own words (shown translated in English); the others are what people typed. */
export const CUSTOMER_EDIT_WORD_FIELDS:ReadonlySet<string>=new Set(['region','customerType','customerKind','customerStatus','category']);

export type CustomerEditStage='supervisor'|'sales_manager';
export type CustomerEditStatus='pending'|'approved'|'rejected'|'cancelled';
export type CustomerEditChange={field:CustomerEditField;before:string;after:string};
export type CustomerEditValues=Record<string,unknown>;
/** What a request row (crm_audit, action REQUEST_ACTION) holds in its detail. */
export type CustomerEditHeld={v:1;requestedBy:string;key:string;customerId:string;customerName:string;stage:CustomerEditStage;fields:CustomerEditField[];values:CustomerEditValues;base:Record<string,string>;baseVersion:number;fingerprint:string};
/** One request as GET /api/customer-edits gives it to a reader. */
export type CustomerEditRequest={
 id:string;customerId:string;customerName:string;requestedBy:string;requestedByName:string;createdAt:string;
 status:CustomerEditStatus;stage:CustomerEditStage|null;supervisorName:string|null;supervisorAt:string|null;
 decidedByName:string|null;decidedAt:string|null;note:string;stale:boolean;changes:CustomerEditChange[];
 mine:boolean;canDecide:boolean;canCancel:boolean
};
export type CustomerEditList={me:string;waiting:number;requests:CustomerEditRequest[]};

/** The administrator and the sales manager edit a customer directly and decide requests; whoever else could edit one sends a request. */
export const directCustomerEditRole=(role:string)=>role==='admin'||role==='manager';
export const proposesCustomerEdit=(role:string)=>['rep','supervisor','customer_service','customer_service_manager'].includes(role);

type Who=Pick<Member,'id'|'role'|'active'|'supervisorId'>;
/** The requester's supervisor while they hold a request: the member the requester's account names, while that member is an active
 *  supervisor. A representative linked straight to a sales manager or the administrator, or to nobody, has none. */
export function activeSupervisorOf(requesterId:string,members:readonly Who[]):Who|undefined{
 const requester=members.find(member=>member.id===requesterId);
 if(!requester||requester.role!=='rep'||!requester.supervisorId)return undefined;
 return members.find(member=>member.id===requester.supervisorId&&member.role==='supervisor'&&!!member.active);
}
/** Where a new request goes: a representative with an active supervisor to the supervisor, anyone else to the sales manager. */
export const firstStage=(requesterId:string,members:readonly Who[]):CustomerEditStage=>activeSupervisorOf(requesterId,members)?'supervisor':'sales_manager';
/** Where a waiting request stands now, read live: with the supervisor while it was sent to one, they have not approved it and the
 *  requester still has an active supervisor; otherwise with the sales manager. The same rule as awaitingSupervisorSql on the server. */
export function liveStage(held:Pick<CustomerEditHeld,'stage'|'requestedBy'>,supervisorPassed:boolean,members:readonly Who[]):CustomerEditStage{
 return held.stage==='supervisor'&&!supervisorPassed&&!!activeSupervisorOf(held.requestedBy,members)?'supervisor':'sales_manager';
}

/** A field's value as the request compares and shows it: text, empty for nothing. */
export function editText(value:unknown):string{
 if(value===null||value===undefined)return '';
 if(typeof value==='number')return Number.isFinite(value)?String(value):'';
 return String(value);
}
/** What a save changes, read field by field from what was stored and what the save would store (both after the server's own
 *  normalisation): only those fields, with what they held. «location» carries its point and capture details. */
export function customerEditProposal(stored:Record<string,unknown>,next:Record<string,unknown>):{fields:CustomerEditField[];values:CustomerEditValues;base:Record<string,string>}{
 const fields:CustomerEditField[]=[],values:CustomerEditValues={},base:Record<string,string>={};
 for(const field of CUSTOMER_EDIT_FIELDS){
  if(editText(next[field])===editText(stored[field]))continue;
  fields.push(field);base[field]=editText(stored[field]);values[field]=next[field]===undefined?null:next[field];
  if(field==='location')for(const detail of LOCATION_DETAILS)values[detail]=next[detail]===undefined?null:next[detail];
 }
 return {fields,values,base};
}
/** The fields of a request someone changed since it was sent: what approval would overwrite is no longer what the sender saw. */
export const staleFields=(held:Pick<CustomerEditHeld,'base'>,current:Record<string,unknown>)=>(Object.keys(held.base) as CustomerEditField[]).filter(field=>editText(current[field])!==held.base[field]);
/** The customer's data with a request applied, as a form would send it: everything stored, the request's fields over it; a captured
 *  point's details go with «location» only (a detail the request does not hold is removed, so an old capture never labels a new point). */
export function applyCustomerEdit(current:Record<string,unknown>,held:Pick<CustomerEditHeld,'values'|'fields'>):Record<string,unknown>{
 const data:Record<string,unknown>={...current};
 for(const field of held.fields){if(!(CUSTOMER_EDIT_FIELDS as readonly string[]).includes(field))continue;const value=held.values[field];if(value===null||value===undefined)delete data[field];else data[field]=value;}
 if(held.fields.includes('location'))for(const detail of LOCATION_DETAILS){const value=held.values[detail];if(value===null||value===undefined)delete data[detail];else data[detail]=value;}
 return data;
}
/** The changes a reader sees: what the field holds (now, while the request waits; when it was sent, once decided) and what it asks for. */
export function customerEditChanges(held:Pick<CustomerEditHeld,'fields'|'values'|'base'>,before:Record<string,unknown>|null):CustomerEditChange[]{
 return held.fields.filter(field=>(CUSTOMER_EDIT_FIELDS as readonly string[]).includes(field)).map(field=>({field,before:before?editText(before[field]):held.base[field]??'',after:editText(held.values[field])}));
}
/** A stable fingerprint of what a request asks, for a repeated send (the same customer, the same fields and values). */
export function customerEditFingerprint(customerId:string,fields:readonly string[],values:CustomerEditValues){
 const ordered:Record<string,unknown>={};for(const key of Object.keys(values).sort())ordered[key]=values[key];
 return JSON.stringify([customerId,[...fields].sort(),ordered]);
}

/** A reason a person can read: marks the eye cannot see (spaces, direction and zero-width marks) do not make one. */
const invisible=/[\s​-‏‪-‮⁠-⁩﻿]/g;
export const REJECT_REASON_MAX=1000;
export const REJECT_REASON_MIN=2;
export const REJECT_REASON_TOO_SHORT='اكتب سبب الرفض (حرفان على الأقل).';
export const REJECT_REASON_TOO_LONG='سبب الرفض طويل؛ الحد الأقصى 1000 حرف.';
/** The reason of a rejection, trimmed, or the message that refuses it (empty, only invisible marks, one letter, over 1000). */
export function rejectReason(value:unknown):{ok:true;note:string}|{ok:false;error:string}{
 const note=typeof value==='string'?value.trim():'';
 if(note.replace(invisible,'').length<REJECT_REASON_MIN)return {ok:false,error:REJECT_REASON_TOO_SHORT};
 if(note.length>REJECT_REASON_MAX)return {ok:false,error:REJECT_REASON_TOO_LONG};
 return {ok:true,note};
}

/** The words of the request's state, for the page. */
export function customerEditStatusText(request:Pick<CustomerEditRequest,'status'|'stage'>):[string,string]{
 if(request.status==='pending')return request.stage==='supervisor'?['بانتظار موافقة المشرف','Awaiting the supervisor’s approval']:['بانتظار موافقة مدير المبيعات','Awaiting the sales manager’s approval'];
 return request.status==='approved'?['تمت الموافقة وطُبّق التعديل','Approved and applied']:request.status==='rejected'?['مرفوض','Rejected']:['أُلغي','Cancelled'];
}
/** The toast after a request is sent. */
export const sentText=(stage:CustomerEditStage):[string,string]=>stage==='supervisor'?['تم إرسال التعديل إلى مشرفك للموافقة','The edit was sent to your supervisor for approval']:['تم إرسال التعديل إلى مدير المبيعات للموافقة','The edit was sent to the sales manager for approval'];

/** The history of a customer («سجل التغييرات», GET /api/crm): each step of a request as words, never its fields or its reason. */
export const CUSTOMER_EDIT_HISTORY:Record<string,string>={
 'customer-edit:request':'طلب تعديل بيانات العميل',
 'customer-edit:supervisor-approved':'موافقة المشرف على تعديل بيانات العميل',
 'customer-edit:approved':'الموافقة على تعديل بيانات العميل',
 'customer-edit:rejected':'رفض طلب تعديل بيانات العميل',
 'customer-edit:cancelled':'إلغاء طلب تعديل بيانات العميل'
};

const string=(value:unknown):value is string=>typeof value==='string';
/** A list from GET /api/customer-edits the page may show. */
export function validCustomerEditList(value:unknown):value is CustomerEditList{
 const list=value as Partial<CustomerEditList>|null;
 return !!list&&string(list.me)&&typeof list.waiting==='number'&&Array.isArray(list.requests)&&list.requests.every(request=>!!request&&string(request.id)&&string(request.customerId)&&string(request.customerName)&&string(request.requestedByName)&&['pending','approved','rejected','cancelled'].includes(request.status)&&Array.isArray(request.changes)&&request.changes.every(change=>!!change&&string(change.field)&&string(change.before)&&string(change.after))&&typeof request.canDecide==='boolean'&&typeof request.canCancel==='boolean');
}
/** The page's own event: a request was sent or decided, every list asks again. */
export const CUSTOMER_EDITS_CHANGED='yr:customer-edits-changed';
export const CUSTOMER_EDITS_INTERVAL_MS=5*60_000;
export const CUSTOMER_EDITS_FOCUS_MS=60_000;
/** How long a decided request stays in its sender's list on the first screen. */
export const CUSTOMER_EDITS_RECENT_DAYS=14;
