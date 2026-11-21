import {z} from 'zod';
import {machineTypeLabels} from './machines';
import {customerMachineCount} from './customer-classification';
import {isFieldRole} from './roles';
// «الطاقة الإنتاجية والاحتياج» of a customer (the owner, 2026-11-21: «كنت محتاج خانه فيها - عدد المكائن (تتحسب) - نوع المكائن (تتجمع) - عدد
// القوالب المستخدمه (المندوب بيدخلها او المسوق) - الطاقه الإنتاجية … - حجم الطلب السنوي … الحجات دى تتشاف من بره فى كرت العميل … البيانات دى
// كلها اختيارى»). Five items, each shown on the customer's card only when it has a value:
// - «عدد الماكينات»: computed, never typed: the machines registered under the customer (kind factory, «إضافة ماكينة / خط إنتاج»), each its
//   «العدد» (a machine with none counts one), by lib/customer-classification.ts customerMachineCount, which never adds the sheet's count to
//   them; with none registered, the sheet's count, marked «حسب الشيت».
// - «أنواع الماكينات»: computed: the same machines grouped by their «نوع الماكينة» (lib/machines.ts machineTypeLabels: ثابتة، متحركة), a
//   machine of unknown type («غير محدد») grouped by its manufacturer («الشركة المصنعة»), each group with its count («ثابتة ×2 · Besser ×1»);
//   with none registered, the sheet's types text, marked «حسب الشيت».
// - «عدد القوالب المستخدمة» (moldsInUse, a whole number 0 to 10,000, Arabic digits read), «الطاقة الإنتاجية» (productionCapacity) and
//   «حجم الطلب السنوي» (annualDemand), short texts up to 100 characters: entered, optional, kept in the customer's data (crm_records.data,
//   JSON: no migration). A save that does not carry one (a page or a device queue of the release before) keeps the stored value
//   (keepAbsentCapacity), and an empty one removes it.
// Who enters them: whoever may edit the customer today (lib/access.ts). A representative's or a marketing officer's change of these three
// fields ONLY, on a customer assigned to them (the ownership of «إضافة ماكينة», app/crm-app.tsx canAddMachineTo), is saved directly
// (capacityEditIsDirect, enforced by POST /api/crm): they are sales estimates updated often. Any other change, or another member's customer,
// goes through «طلبات تعديل بيانات العميل» as before (lib/customer-edit-requests.ts), the three fields travelling in the request.
// Pure: the page, the server and the tests share it.

export const CAPACITY_FIELDS=['moldsInUse','productionCapacity','annualDemand'] as const;
export type CapacityField=typeof CAPACITY_FIELDS[number];
export const isCapacityField=(field:unknown):field is CapacityField=>typeof field==='string'&&(CAPACITY_FIELDS as readonly string[]).includes(field);
/** The section of the form and of the customer's sheet. */
export const CAPACITY_SECTION_TEXT:readonly [string,string]=['الطاقة الإنتاجية والاحتياج','Capacity and demand'];
export type CapacityItemKey='machineCount'|'machineTypes'|CapacityField;
export const CAPACITY_ITEMS:readonly CapacityItemKey[]=['machineCount','machineTypes','moldsInUse','productionCapacity','annualDemand'];
export const CAPACITY_TEXT:Record<CapacityItemKey,[string,string]>={
 machineCount:['عدد الماكينات','Machines'],
 machineTypes:['أنواع الماكينات','Machine types'],
 moldsInUse:['عدد القوالب المستخدمة','Molds in use'],
 productionCapacity:['الطاقة الإنتاجية','Production capacity'],
 annualDemand:['حجم الطلب السنوي','Annual demand'],
};
/** Beside a count or types taken from the imported sheet, when no machine is registered. */
export const FROM_SHEET_TEXT:readonly [string,string]=['حسب الشيت','per the sheet'];
export const MOLDS_MAX=10000;
export const CAPACITY_TEXT_MAX=100;
export const MOLDS_REFUSED='اكتب عدد القوالب المستخدمة رقمًا صحيحًا من 0 إلى 10000.';
export const PRODUCTION_CAPACITY_REFUSED='اكتب الطاقة الإنتاجية نصًا قصيرًا لا يزيد على 100 حرف.';
export const ANNUAL_DEMAND_REFUSED='اكتب حجم الطلب السنوي نصًا قصيرًا لا يزيد على 100 حرف.';

/** Spaces, direction marks and zero-width marks a pasted or dictated number may carry. */
const INVISIBLE=/[\s​-‏‪-‮⁦-⁩﻿]/g;
const latin=(text:string)=>text.replace(/[٠-٩]/g,digit=>String(digit.charCodeAt(0)-0x660)).replace(/[۰-۹]/g,digit=>String(digit.charCodeAt(0)-0x6f0));
/** «عدد القوالب المستخدمة» as stored: a whole number 0 to 10,000; '' for nothing (empty, null); null when it is not one (refused). Arabic and
 *  Persian digits are read, spaces and direction marks ignored, and thousands written «10,000» or «١٠٬٠٠٠» accepted. */
export function readMoldsInUse(value:unknown):number|''|null{
 if(value===null||value===undefined)return '';
 if(typeof value==='number')return Number.isInteger(value)&&value>=0&&value<=MOLDS_MAX?value:null;
 if(typeof value!=='string')return null;
 let text=latin(value).replace(INVISIBLE,'').replace(/٬/g,',');
 if(!text)return '';
 if(/^\d{1,3}(,\d{3})+$/.test(text))text=text.replace(/,/g,'');
 if(!/^\d{1,6}$/.test(text))return null;
 const number=Number(text);
 return number<=MOLDS_MAX?number:null;
}
/** «الطاقة الإنتاجية» and «حجم الطلب السنوي» as stored: one line, runs of spaces made one, trimmed, at most 100 characters; '' for nothing;
 *  null when longer or not text (a number is taken as its text). */
export function readCapacityText(value:unknown):string|null{
 if(value===null||value===undefined)return '';
 if(typeof value==='number')return Number.isFinite(value)?String(value):null;
 if(typeof value!=='string')return null;
 const text=value.replace(/\s+/g,' ').trim();
 return [...text].length<=CAPACITY_TEXT_MAX?text:null;
}
const READERS:Record<CapacityField,(value:unknown)=>number|string|null>={moldsInUse:readMoldsInUse,productionCapacity:readCapacityText,annualDemand:readCapacityText};
const REFUSALS:Record<CapacityField,string>={moldsInUse:MOLDS_REFUSED,productionCapacity:PRODUCTION_CAPACITY_REFUSED,annualDemand:ANNUAL_DEMAND_REFUSED};
/** One field of lib/crm.ts schemas.customer: absent stays absent (the route keeps the stored value), null and '' are empty, else read or refused. */
const capacityField=(field:CapacityField)=>z.unknown().transform((value,context)=>{
 if(value===undefined)return undefined;
 const read=READERS[field](value);
 if(read===null){context.addIssue({code:z.ZodIssueCode.custom,message:REFUSALS[field]});return z.NEVER;}
 return read;
});
export const capacitySchemaFields={moldsInUse:capacityField('moldsInUse'),productionCapacity:capacityField('productionCapacity'),annualDemand:capacityField('annualDemand')};

/** A stored value as shown and compared: the number or the text, '' for nothing (a value that is not one reads as nothing). */
export function capacityValue(data:Record<string,unknown>|null|undefined,field:CapacityField):number|string{
 const read=READERS[field](data?.[field]);
 return read===null?'':read;
}
/** What a save does with the three fields, after the schema read them: a save that does not carry one keeps the stored value (a page or a
 *  device queue of the release before, which knows nothing of them, never erases it); an empty one is removed; else the value read. */
export function keepAbsentCapacity(data:Record<string,unknown>,sent:Record<string,unknown>|undefined,stored:Record<string,unknown>|undefined){
 for(const field of CAPACITY_FIELDS){
  if(stored&&(!sent||sent[field]===undefined)){if(stored[field]===undefined)delete data[field];else data[field]=stored[field];continue;}
  const value=capacityValue(data,field);
  if(value==='')delete data[field];else data[field]=value;
 }
 return data;
}
/** A representative's or a marketing officer's save that changes these three fields only (fields: what lib/customer-edit-requests.ts
 *  customerEditProposal finds changed), on a customer assigned to them, is saved directly instead of waiting for approval. */
export function capacityEditIsDirect(me:{id:string;role:string},customer:{assignedTo:string},fields:readonly string[]){
 return isFieldRole(me.role)&&!!me.id&&customer.assignedTo===me.id&&fields.length>0&&fields.every(isCapacityField);
}
/** The customer as stored with the three fields of the save over it, and nothing else of the save: what a direct capacity save writes. */
export function withCapacityOnly(stored:Record<string,unknown>,next:Record<string,unknown>):Record<string,unknown>{
 const data={...stored};
 for(const field of CAPACITY_FIELDS){if(next[field]===undefined)delete data[field];else data[field]=next[field];}
 return data;
}

type MachineRow={kind:string;parentId:string|null;data:Record<string,unknown>|null|undefined};
/** One group of «أنواع الماكينات»: by type (stationary, mobile), else by manufacturer, else «غير محدد». label: the type's Arabic word (shown
 *  translated) or the manufacturer as typed. */
export type MachineTypeGroup={key:string;kind:'type'|'brand'|'unknown';label:string;count:number};
const whole=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?Math.floor(value):null;
const registered=(customerId:string,record:MachineRow)=>record.kind==='factory'&&record.parentId===customerId&&record.data?.recordType!=='group';
const KIND_ORDER={type:0,brand:1,unknown:2} as const;
/** The machines registered one by one under the customer, grouped: each its «العدد» (none counts one), the largest group first, a group of
 *  unknown type and manufacturer last. Groups of no machine (every one of «العدد» 0) are left out. */
export function machineTypeGroups(customerId:string,records:Iterable<MachineRow>):MachineTypeGroup[]{
 const groups=new Map<string,MachineTypeGroup>();
 for(const record of records){
  if(!registered(customerId,record))continue;
  const count=whole(record.data?.quantity)??1,type=String(record.data?.machineType||''),brand=String(record.data?.machineBrand||'').replace(/\s+/g,' ').trim();
  const group:Omit<MachineTypeGroup,'count'>=type==='stationary'||type==='mobile'?{key:'type:'+type,kind:'type',label:machineTypeLabels[type]}
   :brand?{key:'brand:'+brand.toLocaleLowerCase('en'),kind:'brand',label:brand}:{key:'unknown',kind:'unknown',label:machineTypeLabels.unknown};
  const found=groups.get(group.key);
  if(found)found.count+=count;else groups.set(group.key,{...group,count});
 }
 return [...groups.values()].filter(group=>group.count>0).sort((a,b)=>Number(a.kind==='unknown')-Number(b.kind==='unknown')||b.count-a.count||KIND_ORDER[a.kind]-KIND_ORDER[b.kind]||a.label.localeCompare(b.label,'ar'));
}
/** «ثابتة ×2 · Besser ×1»: the groups as one line; tr translates the type words (never a manufacturer typed). */
export function machineTypesText(groups:readonly MachineTypeGroup[],tr:(text:string)=>string=text=>text){
 return groups.map(group=>(group.kind==='brand'?group.label:tr(group.label))+' ×'+group.count).join(' · ');
}

/** The five items of a customer, from its data and its machine records (only its own are read: kind factory, parent the customer).
 *  machines and types: null when there is nothing to say; fromSheet when they come from the imported sheet (no machine registered). */
export type CustomerCapacity={
 machines:{count:number;fromSheet:boolean}|null;
 types:{fromSheet:false;groups:MachineTypeGroup[]}|{fromSheet:true;text:string}|null;
 moldsInUse:number|null;productionCapacity:string;annualDemand:string;
 /** Whether a machine is registered one by one (else what is shown of the machines is the sheet's). */
 registered:boolean;
};
export function customerCapacity(customerId:string,records:Iterable<MachineRow>,data:Record<string,unknown>|null|undefined):CustomerCapacity{
 const own=[...records].filter(record=>record.kind==='factory'&&record.parentId===customerId);
 const groups=machineTypeGroups(customerId,own),isRegistered=own.some(record=>registered(customerId,record));
 const counted=customerMachineCount(customerId,own,data?.machineCount);
 // The sheet's count is shown only when the sheet holds one: a group imported without a number counts nothing, which is not «0».
 const sheetKnown=whole(data?.machineCount)!==null||own.some(record=>record.data?.recordType==='group'&&whole(record.data?.quantity)!==null);
 const machines=counted.source==='machines'?{count:counted.count,fromSheet:false}:counted.source==='sheet'&&sheetKnown?{count:counted.count,fromSheet:true}:null;
 const sheetTypes=String(data?.machineTypes||'').trim()||[...new Set(own.filter(record=>record.data?.recordType==='group').map(record=>String(record.data?.sourceMachineTypes||'').trim()).filter(Boolean))].join('، ');
 const types:CustomerCapacity['types']=isRegistered?(groups.length?{fromSheet:false,groups}:null):sheetTypes?{fromSheet:true,text:sheetTypes}:null;
 const molds=capacityValue(data,'moldsInUse');
 return {machines,types,moldsInUse:typeof molds==='number'?molds:null,productionCapacity:String(capacityValue(data,'productionCapacity')),annualDemand:String(capacityValue(data,'annualDemand')),registered:isRegistered};
}
/** The items that have a value, in the card's order. sheetBeside: the place already shows the sheet's count and types beside (the desktop
 *  row's «الماكينات حسب الشيت», the sheet's grid), so they are not said twice; what is registered is still shown. */
export function capacityItems(capacity:CustomerCapacity,{sheetBeside=false,only}:{sheetBeside?:boolean;only?:readonly CapacityItemKey[]}={}):CapacityItemKey[]{
 const has:Record<CapacityItemKey,boolean>={
  machineCount:!!capacity.machines&&!(sheetBeside&&capacity.machines.fromSheet),
  machineTypes:!!capacity.types&&!(sheetBeside&&capacity.types.fromSheet),
  moldsInUse:capacity.moldsInUse!==null,productionCapacity:!!capacity.productionCapacity,annualDemand:!!capacity.annualDemand,
 };
 return CAPACITY_ITEMS.filter(item=>has[item]&&(!only||only.includes(item)));
}

/** The six columns of the customers' export (Excel and CSV, app/crm-app.tsx): the computed count (a number), where it comes from, the
 *  types as one line, and the three entered fields (the molds a number). say: the page's language; tr: its translator. */
export type CapacityColumn<T>=readonly [header:string,value:(row:T)=>unknown,kind?:'number'];
export function capacityExportColumns<T>(capacityOf:(row:T)=>CustomerCapacity,say:(ar:string,en:string)=>string,tr:(text:string)=>string=text=>text):CapacityColumn<T>[]{
 const sheet=say(...FROM_SHEET_TEXT);
 return [
  [say(...CAPACITY_TEXT.machineCount),row=>capacityOf(row).machines?.count??'','number'],
  [say('مصدر عدد الماكينات','Machine count source'),row=>{const machines=capacityOf(row).machines;return !machines?'':machines.fromSheet?sheet:say('الماكينات المسجلة','Registered machines');}],
  [say(...CAPACITY_TEXT.machineTypes),row=>{const types=capacityOf(row).types;return !types?'':types.fromSheet?types.text+' ('+sheet+')':machineTypesText(types.groups,tr);}],
  [say(...CAPACITY_TEXT.moldsInUse),row=>capacityOf(row).moldsInUse??'','number'],
  [say(...CAPACITY_TEXT.productionCapacity),row=>capacityOf(row).productionCapacity],
  [say(...CAPACITY_TEXT.annualDemand),row=>capacityOf(row).annualDemand],
 ];
}

// «موعد احتياج القوالب المتوقع» of a visit (the same request: «موعد احتياج القوالب المتوقع دى فى تفاصيل الزيارة»): an optional day in the
// visit's data (moldNeedBy, YYYY-MM-DD; lib/crm.ts schemas.activity), set in «زيارة جديدة» and when a saved visit is edited, under
// «تفاصيل البيع والأصناف». Like «موعد المتابعة», a day set or changed is the day of recording or later (a stored day kept by an edit is never
// refused, even once past; an entry queued on the device is judged against the day it was recorded); a save that does not carry it (a page of
// the release before) keeps the stored one (keepMoldNeed, app/api/visits/route.ts).
export const MOLD_NEED_FIELD='moldNeedBy';
export const MOLD_NEED_TEXT:readonly [string,string]=['موعد احتياج القوالب المتوقع','Expected mold need date'];
export const MOLD_NEED_PAST='موعد احتياج القوالب المتوقع يجب أن يكون يوم التسجيل أو لاحقًا';
/** The stored day, or '' (a value that is not a day reads as nothing). */
export const moldNeedDay=(data:Record<string,unknown>|null|undefined)=>{const value=data?.[MOLD_NEED_FIELD];return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:'';};
/** After the schema read a visit's save: absent from the save, the stored day stays (or none); empty, nothing is stored. Returns the message
 *  that refuses a day set or changed before `earliest` (the day of recording), else ''. */
export function keepMoldNeed(data:Record<string,unknown>,sent:Record<string,unknown>|undefined,stored:Record<string,unknown>|undefined,earliest:string):string{
 if(stored&&(!sent||sent[MOLD_NEED_FIELD]===undefined)){const kept=moldNeedDay(stored);if(kept)data[MOLD_NEED_FIELD]=kept;else delete data[MOLD_NEED_FIELD];return '';}
 const day=moldNeedDay(data);
 if(!day){delete data[MOLD_NEED_FIELD];return '';}
 data[MOLD_NEED_FIELD]=day;
 return day!==moldNeedDay(stored)&&day<earliest?MOLD_NEED_PAST:'';
}
