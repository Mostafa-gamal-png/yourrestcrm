import {z} from 'zod';
// The classifications of a customer (the owner, 2026-11-18, with the new role «مسؤول تسويق», lib/roles.ts): «تصنيف الفرصة» with its notes,
// «حجم المصنع» and «اهتمام العميل». Kept in the customer's data (crm_records.data, JSON: no migration), apart from «تصنيف العميل»
// (customerType: دوليون، مميزون …), which stays as it was. Who sets them is lib/access.ts canClassifyCustomer, enforced by POST /api/crm
// (app/api/crm/route.ts): the marketing officer for every customer of their branch, the supervisor for their team's (through the sales
// manager's approval, as every correction of theirs: lib/customer-edit-requests.ts), the sales manager and the administrator, within their
// regions. A representative reads them on their own customers (lib/crm.ts scopeRecords), customer service reads them; neither sets them.
// Pure: the page, the server and the tests share this file.

type Choice<V extends string>={value:V;ar:string;en:string;helpAr:string;helpEn:string};

export const OPPORTUNITY_GRADES=[
 {value:'A',ar:'مرتفعة',en:'High',helpAr:'اهتمام بالمنتج وصاحب القرار متفاعل وطلب عرض سعر',helpEn:'Interested in the product, the decision maker is engaged and asked for a quotation'},
 {value:'B',ar:'متوسطة',en:'Medium',helpAr:'يوجد اهتمام ولكن القرار مؤجل ويحتاج إلى دراسة',helpEn:'There is interest, but the decision is postponed and needs study'},
 {value:'C',ar:'ضعيفة',en:'Low',helpAr:'اهتمام محدود ولا توجد نية',helpEn:'Limited interest and no intention'},
 {value:'D',ar:'مستبعدة',en:'Excluded',helpAr:'رفض التعامل لارتباطه الكامل بالمورد',helpEn:'Refused to deal with us, being fully tied to their supplier'},
] as const satisfies readonly Choice<string>[];
/** «حجم المصنع»: A, B and C follow the number of the customer's registered machines (suggestedFactorySize); D «متوقف» is set by hand only.
 *  The owner's table said «أكثر من 5» for A; 5 machines are counted as A (asked of the owner to confirm). */
export const FACTORY_SIZES=[
 {value:'A',ar:'كبير',en:'Large',helpAr:'5 ماكينات أو أكثر',helpEn:'5 machines or more'},
 {value:'B',ar:'متوسط',en:'Medium',helpAr:'من 3 إلى 4 ماكينات',helpEn:'3 to 4 machines'},
 {value:'C',ar:'صغير',en:'Small',helpAr:'من ماكينة إلى ماكينتين',helpEn:'1 to 2 machines'},
 {value:'D',ar:'متوقف',en:'Stopped',helpAr:'غير نشط، ويُختار يدويًا فقط',helpEn:'Not active; chosen by hand only'},
] as const satisfies readonly Choice<string>[];
export const CUSTOMER_INTERESTS=[
 {value:'technical',ar:'فني',en:'Technical',helpAr:'الجودة والأداء: مقارنة فنية',helpEn:'Quality and performance: a technical comparison'},
 {value:'price',ar:'سعري',en:'Price',helpAr:'السعر هو الحاسم: عرض سعر تنافسي',helpEn:'Price decides: a competitive quotation'},
 {value:'service',ar:'خدمي',en:'Service',helpAr:'سرعة التوريد والصيانة وخدمات ما بعد البيع',helpEn:'Fast supply, maintenance and after-sales service'},
 {value:'trust',ar:'الثقة',en:'Trust',helpAr:'بناء علاقة مع العميل وعرض عملاء تعاملوا معنا',helpEn:'Building a relationship and showing customers who have dealt with us'},
] as const satisfies readonly Choice<string>[];

export type OpportunityGrade=typeof OPPORTUNITY_GRADES[number]['value'];
export type FactorySize=typeof FACTORY_SIZES[number]['value'];
export type CustomerInterest=typeof CUSTOMER_INTERESTS[number]['value'];

/** The fields, as stored in the customer's data. gradeNotes is free text; the other three hold a value of their list or nothing. */
export const CLASSIFICATION_FIELDS=['opportunityGrade','gradeNotes','factorySize','customerInterest'] as const;
export type ClassificationField=typeof CLASSIFICATION_FIELDS[number];
export const CLASSIFICATION_CHOICE_FIELDS=['opportunityGrade','factorySize','customerInterest'] as const;
export type ClassificationChoiceField=typeof CLASSIFICATION_CHOICE_FIELDS[number];
export const CLASSIFICATION_CHOICES:{[K in ClassificationChoiceField]:readonly Choice<string>[]}={opportunityGrade:OPPORTUNITY_GRADES,factorySize:FACTORY_SIZES,customerInterest:CUSTOMER_INTERESTS};
export const CLASSIFICATION_TEXT:Record<ClassificationField,[string,string]>={
 opportunityGrade:['تصنيف الفرصة','Opportunity grade'],gradeNotes:['ملاحظات التصنيف','Classification notes'],
 factorySize:['حجم المصنع','Factory size'],customerInterest:['اهتمام العميل','Customer interest']
};
/** The first choice of each filter on «العملاء». */
export const CLASSIFICATION_ALL_TEXT:Record<ClassificationChoiceField,[string,string]>={
 opportunityGrade:['كل تصنيفات الفرصة','All opportunity grades'],factorySize:['كل أحجام المصانع','All factory sizes'],customerInterest:['كل اهتمامات العملاء','All customer interests']
};
export const GRADE_NOTES_MAX=1000;

/** The server's refusals (POST /api/crm), shown translated on the page (lib/locales/en.json). */
export const CLASSIFICATION_REFUSED='تصنيفات العميل يحددها مسؤول التسويق والمشرف لعملاء فريقه ومدير المبيعات ومدير النظام. يمكنك الاطلاع عليها فقط.';
export const GRADE_REFUSED='اختر تصنيف الفرصة من القائمة: A أو B أو C أو D';
export const SIZE_REFUSED='اختر حجم المصنع من القائمة: A أو B أو C أو D';
export const INTEREST_REFUSED='اختر اهتمام العميل من القائمة: فني أو سعري أو خدمي أو الثقة';
export const GRADE_NOTES_TOO_LONG='ملاحظات التصنيف طويلة؛ الحد الأقصى 1000 حرف.';

const choice=(values:readonly string[],message:string)=>z.string({invalid_type_error:message}).trim().refine(value=>value===''||values.includes(value),message);
/** The fields of lib/crm.ts schemas.customer: optional, so a page opened before them (or a form that does not offer them) sends none and
 *  the stored ones stay (app/api/crm/route.ts keepAbsentClassification). An unknown value is refused, never stored. */
export const classificationSchemaFields={
 opportunityGrade:choice(OPPORTUNITY_GRADES.map(item=>item.value),GRADE_REFUSED).optional(),
 gradeNotes:z.string({invalid_type_error:GRADE_NOTES_TOO_LONG}).trim().max(GRADE_NOTES_MAX,GRADE_NOTES_TOO_LONG).optional(),
 factorySize:choice(FACTORY_SIZES.map(item=>item.value),SIZE_REFUSED).optional(),
 customerInterest:choice(CUSTOMER_INTERESTS.map(item=>item.value),INTEREST_REFUSED).optional(),
};

const text=(value:unknown)=>typeof value==='string'?value.trim():'';
/** The value as compared and shown: text, empty for nothing. */
export const classificationValue=(data:Record<string,unknown>|null|undefined,field:ClassificationField)=>text(data?.[field]);

/** What a save does with the classifications, before the server compares them: a field the save does not carry keeps the stored value
 *  (a page opened before the fields existed, a form that does not offer them, a representative's view without them); an empty one is
 *  removed (nothing stored); the rest stays as parsed. */
export function keepAbsentClassification(data:Record<string,unknown>,sent:Record<string,unknown>|undefined,stored:Record<string,unknown>|undefined){
 for(const field of CLASSIFICATION_FIELDS){
  if(stored&&(!sent||sent[field]===undefined)){const kept=classificationValue(stored,field);if(kept)data[field]=kept;else delete data[field];continue;}
  const value=classificationValue(data,field);
  if(value)data[field]=value;else delete data[field];
 }
 return data;
}
/** The classification fields a save changes (empty and missing are the same). */
export const changedClassification=(before:Record<string,unknown>|null|undefined,after:Record<string,unknown>)=>CLASSIFICATION_FIELDS.filter(field=>classificationValue(before,field)!==classificationValue(after,field));
/** The data without the classifications (a representative's view of a customer that is not theirs). */
export function withoutClassification<T extends Record<string,unknown>>(data:T):T{const copy={...data};for(const field of CLASSIFICATION_FIELDS)delete copy[field];return copy;}

type MachineRow={kind:string;parentId:string|null;data:Record<string,unknown>|null|undefined};
/** What one machine record adds: its «العدد»; a single machine with no number counts one, a group of machines (from a sheet) with no
 *  number counts nothing, since its size is not known. */
function machineQuantity(record:MachineRow){
 const quantity=record.data?.quantity;
 if(typeof quantity==='number'&&Number.isFinite(quantity)&&quantity>=0)return Math.floor(quantity);
 return record.data?.recordType==='group'?0:1;
}
/** The number of a customer's registered machines: the sum of «العدد» of its machine records (records of kind factory whose parent is the
 *  customer, as «العملاء والماكينات» lists them under it). */
export function registeredMachineCount(customerId:string,records:Iterable<MachineRow>){
 let count=0;
 for(const record of records)if(record.kind==='factory'&&record.parentId===customerId)count+=machineQuantity(record);
 return count;
}
/** Every customer's count in one pass (the customers page filters thousands of customers). */
export function registeredMachineCounts(records:Iterable<MachineRow>){
 const counts=new Map<string,number>();
 for(const record of records)if(record.kind==='factory'&&record.parentId)counts.set(record.parentId,(counts.get(record.parentId)||0)+machineQuantity(record));
 return counts;
}
/** «حجم المصنع» the machines suggest: 5 or more A «كبير», 3 to 4 B «متوسط», 1 to 2 C «صغير», none nothing. D «متوقف» is never suggested. */
export function suggestedFactorySize(machines:number):FactorySize|''{
 if(!Number.isFinite(machines)||machines<1)return '';
 return machines>=5?'A':machines>=3?'B':'C';
}
/** The size a customer has: the stored one always wins (confirmed or chosen by hand, D included); else the suggestion, marked suggested. */
export function effectiveFactorySize(stored:unknown,machines:number):{value:FactorySize|'';suggested:boolean}{
 const kept=text(stored);
 if(FACTORY_SIZES.some(item=>item.value===kept))return {value:kept as FactorySize,suggested:false};
 const suggestion=suggestedFactorySize(machines);
 return {value:suggestion,suggested:!!suggestion};
}

/** The words of a value: «A · مرتفعة», «فني» … ; the value itself when it is not one of the list (never stored, but read defensively). */
export function classificationLabel(field:ClassificationChoiceField,value:unknown,language:'ar'|'en'='ar'){
 const kept=text(value),item=CLASSIFICATION_CHOICES[field].find(entry=>entry.value===kept);
 if(!item)return kept;
 const word=language==='en'?item.en:item.ar;
 return field==='customerInterest'?word:kept+' · '+word;
}
export function classificationHelp(field:ClassificationChoiceField,value:unknown,language:'ar'|'en'='ar'){
 const item=CLASSIFICATION_CHOICES[field].find(entry=>entry.value===text(value));
 return item?(language==='en'?item.helpEn:item.helpAr):'';
}

/** The filters of «العملاء» (one per classification): 'all', 'none' (not classified), or a value of the list. Factory size filters by the
 *  size the customer has (stored, else suggested), as its card shows it. */
export type ClassificationFilter={opportunityGrade:string;factorySize:string;customerInterest:string};
export const NO_CLASSIFICATION_FILTER:ClassificationFilter={opportunityGrade:'all',factorySize:'all',customerInterest:'all'};
export const classificationFiltersSet=(filter:ClassificationFilter)=>CLASSIFICATION_CHOICE_FIELDS.filter(field=>filter[field]!=='all').length;
export function matchesClassification(data:Record<string,unknown>,machines:number,filter:ClassificationFilter){
 for(const field of CLASSIFICATION_CHOICE_FIELDS){
  const wanted=filter[field];if(wanted==='all')continue;
  const value=field==='factorySize'?effectiveFactorySize(data.factorySize,machines).value:classificationValue(data,field);
  if(wanted==='none'?value!=='':value!==wanted)return false;
 }
 return true;
}
