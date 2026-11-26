import {z} from 'zod';
import {mapActivity} from './customer-map-activity';
// The classifications of a customer (the owner, 2026-11-18, with the role «مسؤول تسويق», lib/roles.ts), as he corrected them the same day:
// «تصنيف الفرصة ده موجود بالفعل بس هيزيد / تصنيف حجم المصنع ده بيتحسب من عدد ماكينات المتسجلة داخل المصنع / وهو هيدخل التصنيف العميل بناء
// على اهتماماته».
// - «تصنيف الفرصة» is the opportunity's own «قوة الفرصة», A to D, on each visit and customer-service opportunity (lib/opportunity-strength.ts);
//   the customer-level grade (opportunityGrade) and its notes (gradeNotes) are retired.
// - «حجم المصنع» is computed, never chosen (computedFactorySize): from the machines registered under the customer, D «متوقف» from the
//   customer's status «خامل»; a stored factorySize is retired.
// - «اهتمام العميل» (customerInterest) is entered by hand, by whom lib/access.ts canClassifyCustomer allows (enforced by POST /api/crm):
//   the marketing officer for every customer of their branch, the supervisor for their team's (through the sales manager's approval,
//   lib/customer-edit-requests.ts), the sales manager and the administrator, within their regions.
// The retired fields stay exactly as stored: every save carries them through (carryRetiredClassification), whatever it sends, and
// nothing shows or edits them, so going back to the release that had them finds them as it left them. Kept in the customer's data
// (crm_records.data, JSON: no migration); «تصنيف العميل» (customerType) is another field. Pure: the page, the server and the tests share it.

type Choice<V extends string>={value:V;ar:string;en:string;helpAr:string;helpEn:string};

/** The customer-level grade of the release before the owner's correction: retired; its words stay for the edit requests sent then. */
export const OPPORTUNITY_GRADES=[
 {value:'A',ar:'مرتفعة',en:'High',helpAr:'اهتمام بالمنتج وصاحب القرار متفاعل وطلب عرض سعر',helpEn:'Interested in the product, the decision maker is engaged and asked for a quotation'},
 {value:'B',ar:'متوسطة',en:'Medium',helpAr:'يوجد اهتمام ولكن القرار مؤجل ويحتاج إلى دراسة',helpEn:'There is interest, but the decision is postponed and needs study'},
 {value:'C',ar:'ضعيفة',en:'Low',helpAr:'اهتمام محدود ولا توجد نية',helpEn:'Limited interest and no intention'},
 {value:'D',ar:'مستبعدة',en:'Excluded',helpAr:'رفض التعامل لارتباطه الكامل بالمورد',helpEn:'Refused to deal with us, being fully tied to their supplier'},
] as const satisfies readonly Choice<string>[];
/** «حجم المصنع», computed (computedFactorySize). The owner's table said «أكثر من 5» for A; 5 machines are counted as A (asked to confirm). */
export const FACTORY_SIZES=[
 {value:'A',ar:'كبير',en:'Large',helpAr:'5 ماكينات أو أكثر',helpEn:'5 machines or more'},
 {value:'B',ar:'متوسط',en:'Medium',helpAr:'من 3 إلى 4 ماكينات',helpEn:'3 to 4 machines'},
 {value:'C',ar:'صغير',en:'Small',helpAr:'من ماكينة إلى ماكينتين',helpEn:'1 to 2 machines'},
 {value:'D',ar:'متوقف',en:'Stopped',helpAr:'حالة العميل «خامل»',helpEn:'Customer status «Inactive»'},
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

/** The fields a customer's data may hold: the one entered by hand (customerInterest) and the three retired ones, kept as stored. */
export const CLASSIFICATION_FIELDS=['opportunityGrade','gradeNotes','factorySize','customerInterest'] as const;
export type ClassificationField=typeof CLASSIFICATION_FIELDS[number];
export const RETIRED_CLASSIFICATION_FIELDS=['opportunityGrade','gradeNotes','factorySize'] as const;
/** What a save may change, by whom canClassifyCustomer allows. */
export const MANUAL_CLASSIFICATION_FIELDS=['customerInterest'] as const;
export const CLASSIFICATION_CHOICE_FIELDS=['opportunityGrade','factorySize','customerInterest'] as const;
export type ClassificationChoiceField=typeof CLASSIFICATION_CHOICE_FIELDS[number];
export const CLASSIFICATION_CHOICES:{[K in ClassificationChoiceField]:readonly Choice<string>[]}={opportunityGrade:OPPORTUNITY_GRADES,factorySize:FACTORY_SIZES,customerInterest:CUSTOMER_INTERESTS};
export const CLASSIFICATION_TEXT:Record<ClassificationField,[string,string]>={
 opportunityGrade:['تصنيف الفرصة','Opportunity grade'],gradeNotes:['ملاحظات التصنيف','Classification notes'],
 factorySize:['حجم المصنع','Factory size'],customerInterest:['اهتمام العميل','Customer interest']
};
/** The two filters of «العملاء»: the computed size and the interest. */
export const CLASSIFICATION_FILTER_FIELDS=['factorySize','customerInterest'] as const;
export type ClassificationFilterField=typeof CLASSIFICATION_FILTER_FIELDS[number];
/** The first choice of each filter on «العملاء». */
export const CLASSIFICATION_ALL_TEXT:Record<ClassificationFilterField,[string,string]>={
 factorySize:['كل أحجام المصانع','All factory sizes'],customerInterest:['كل اهتمامات العملاء','All customer interests']
};
/** «حجم المصنع (محسوب من الماكينات)»: how the page, the filter and the export name the computed size. */
export const COMPUTED_SIZE_TEXT:[string,string]=['حجم المصنع (محسوب من الماكينات)','Factory size (computed from the machines)'];

/** The server's refusals (POST /api/crm), shown translated on the page (lib/locales/en.json). Who sets the interest, without saying the
 *  reader may read it: a representative reads none of another's customers (review of 2026-11-18). */
export const CLASSIFICATION_REFUSED='اهتمام العميل يحدده مسؤول التسويق لعملاء فرعه، والمشرف لعملاء فريقه، ومدير المبيعات، ومدير النظام.';
export const INTEREST_REFUSED='اختر اهتمام العميل من القائمة: فني أو سعري أو خدمي أو الثقة';

/** null is an emptied field (a form or a client that clears with null), never a value of its own. */
const emptied=<T extends z.ZodTypeAny>(schema:T)=>z.preprocess(value=>value===null?'':value,schema.optional());
const choice=(values:readonly string[],message:string)=>emptied(z.string({invalid_type_error:message}).trim().refine(value=>value===''||values.includes(value),message));
/** The fields of lib/crm.ts schemas.customer. customerInterest: optional (a page that does not offer it sends none and the stored one
 *  stays: keepAbsentClassification), null empty, an unknown value refused. The retired three pass whatever comes (the route then puts back
 *  what is stored: carryRetiredClassification), so a page or a device queue of the release that still had them is never refused for them. */
export const classificationSchemaFields={
 opportunityGrade:z.unknown().optional(),
 gradeNotes:z.unknown().optional(),
 factorySize:z.unknown().optional(),
 customerInterest:choice(CUSTOMER_INTERESTS.map(item=>item.value),INTEREST_REFUSED),
};

const text=(value:unknown)=>typeof value==='string'?value.trim():'';
/** The value as compared and shown: text, empty for nothing. */
export const classificationValue=(data:Record<string,unknown>|null|undefined,field:ClassificationField)=>text(data?.[field]);

/** The retired fields after a save: exactly what was stored (the same JSON value), or nothing for a new customer, whatever the save sent. */
export function carryRetiredClassification<T extends Record<string,unknown>>(data:T,stored:Record<string,unknown>|undefined):T{
 const target=data as Record<string,unknown>;
 for(const field of RETIRED_CLASSIFICATION_FIELDS){if(stored&&stored[field]!==undefined)target[field]=stored[field];else delete target[field];}
 return data;
}
/** What a save does with the interest, before the server compares it: absent from the save, the stored value stays (a page opened before
 *  the field existed, a form that does not offer it, a representative's view without it); empty, nothing is stored. */
export function keepAbsentClassification(data:Record<string,unknown>,sent:Record<string,unknown>|undefined,stored:Record<string,unknown>|undefined){
 for(const field of MANUAL_CLASSIFICATION_FIELDS){
  if(stored&&(!sent||sent[field]===undefined)){const kept=classificationValue(stored,field);if(kept)data[field]=kept;else delete data[field];continue;}
  const value=classificationValue(data,field);
  if(value)data[field]=value;else delete data[field];
 }
 return data;
}
/** The fields a save changes, of those a member sets (empty and missing are the same): only the interest; the retired ones never change. */
export const changedClassification=(before:Record<string,unknown>|null|undefined,after:Record<string,unknown>)=>MANUAL_CLASSIFICATION_FIELDS.filter(field=>classificationValue(before,field)!==classificationValue(after,field));
/** The data without the classifications (a representative's view of a customer that is not theirs). */
export function withoutClassification<T extends Record<string,unknown>>(data:T):T{const copy={...data};for(const field of CLASSIFICATION_FIELDS)delete copy[field];return copy;}
/** The marker GET /api/crm puts on a customer whose classifications the reader may not read (lib/crm.ts scopeRecords: a representative's
 *  view of another member's customer, a marketing officer's view of another branch's): the server sends none of the four, and the page
 *  shows no interest and leaves the customer out of the interest filter when it is set. The size is computed from what every reader of the
 *  customer reads (its machines and its status), so it is shown for every customer. */
export const CLASSIFICATION_HIDDEN='_classificationHidden';
export const classificationHidden=(data:Record<string,unknown>|null|undefined)=>data?.[CLASSIFICATION_HIDDEN]===true;
/** The classifications a reader does not read (review of 2026-11-18): a representative's of a customer not assigned to them, a marketing
 *  officer's of another branch's customer. lib/crm.ts scopeRecords removes them and marks the customer (CLASSIFICATION_HIDDEN). */
export function classificationHiddenFrom(me:{id:string;role:string;branch:string},customer:{assignedTo:string;branch:string}){
 return me.role==='rep'&&customer.assignedTo!==me.id||me.role==='marketing'&&customer.branch!==me.branch;
}
export function hideClassification(data:Record<string,unknown>){for(const field of CLASSIFICATION_FIELDS)delete data[field];data[CLASSIFICATION_HIDDEN]=true;}

type MachineRow={kind:string;parentId:string|null;data:Record<string,unknown>|null|undefined};
/** A customer's machines and where the number comes from. The sheet's machines reach the CRM twice: as the customer's own
 *  «عدد الماكينات في الشيت» (data.machineCount) and, once imported (app/api/machines/import), as one group record
 *  `<customer>:source-machines-v1` carrying the same count; the machines a representative registers one by one afterwards are usually
 *  among them. So the count never adds the two (review of 2026-11-18): the machines registered one by one when there is any (each its
 *  «العدد», a machine with no number counting one), else the sheet's groups (their «العدد», a group of unknown size counting nothing),
 *  else the customer's own sheet count, else none. */
export type MachineCount={count:number;source:'machines'|'sheet'|'none'|'entered'};
type Tally={machines:number;hasMachine:boolean;groups:number;hasGroup:boolean};
const whole=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?Math.floor(value):null;
function add(tally:Tally,record:MachineRow){
 const quantity=whole(record.data?.quantity);
 if(record.data?.recordType==='group'){tally.hasGroup=true;tally.groups+=quantity??0;}
 else{tally.hasMachine=true;tally.machines+=quantity??1;}
}
/** Since 2026-11-26 (the owner: «عايز كله زى بعضه فى فورم واحد»): a count typed in the customer's form (data.machinesEntered, set by the
 *  server when a save changes it: lib/customer-capacity.ts markEnteredMachines) is the count, before the machines registered one by one,
 *  the sheet's groups and the sheet's own number. */
function counted(tally:Tally|undefined,sheetCount:unknown,entered?:unknown):MachineCount{
 if(entered&&whole(sheetCount)!==null)return {count:whole(sheetCount)!,source:'entered'};
 if(tally?.hasMachine)return {count:tally.machines,source:'machines'};
 if(tally?.hasGroup)return {count:tally.groups,source:'sheet'};
 const sheet=whole(sheetCount);
 return sheet===null?{count:0,source:'none'}:{count:sheet,source:'sheet'};
}
const emptyTally=():Tally=>({machines:0,hasMachine:false,groups:0,hasGroup:false});
/** One customer's: its machine records (kind factory, parent the customer) and its own sheet count. */
export function customerMachineCount(customerId:string,records:Iterable<MachineRow>,sheetCount?:unknown,entered?:unknown):MachineCount{
 const tally=emptyTally();let any=false;
 for(const record of records)if(record.kind==='factory'&&record.parentId===customerId){add(tally,record);any=true;}
 return counted(any?tally:undefined,sheetCount,entered);
}
/** Every customer's in one pass (the customers page filters thousands of customers); the sheet count read from the customer records. */
export function customerMachineCounts(records:Iterable<MachineRow&{id?:string}>):Map<string,MachineCount>{
 const tallies=new Map<string,Tally>(),sheets=new Map<string,unknown>(),entered=new Map<string,unknown>();
 for(const record of records){
  if(record.kind==='customer'&&record.id){sheets.set(record.id,record.data?.machineCount);entered.set(record.id,record.data?.machinesEntered);}
  else if(record.kind==='factory'&&record.parentId){let tally=tallies.get(record.parentId);if(!tally)tallies.set(record.parentId,tally=emptyTally());add(tally,record);}
 }
 const counts=new Map<string,MachineCount>();
 for(const id of new Set([...sheets.keys(),...tallies.keys()]))counts.set(id,counted(tallies.get(id),sheets.get(id),entered.get(id)));
 return counts;
}
export const NO_MACHINES:MachineCount={count:0,source:'none'};
/** The number only (as the size suggestion reads it). */
export const registeredMachineCount=(customerId:string,records:Iterable<MachineRow>,sheetCount?:unknown,entered?:unknown)=>customerMachineCount(customerId,records,sheetCount,entered).count;
/** The size the machines give: 5 or more A «كبير», 3 to 4 B «متوسط», 1 to 2 C «صغير», none nothing («غير محدد»). */
export function sizeFromMachines(machines:number):Exclude<FactorySize,'D'>|''{
 if(!Number.isFinite(machines)||machines<1)return '';
 return machines>=5?'A':machines>=3?'B':'C';
}
/** «خامل» as the map reads a customer's status (lib/customer-map-activity.ts: spacing and Unicode forms, the English «Inactive» of an
 *  import). Nothing else in this CRM says a factory has stopped: «لم يشترِ منذ 60 يومًا» (lib/customer-last-purchase.ts) is about our
 *  sales to an active customer, and a lost or excluded opportunity is about one deal. */
export const stoppedStatus=(status:unknown)=>mapActivity({data:{customerStatus:status}}).key==='inactive';
/** «حجم المصنع» of a customer, computed (the owner, 2026-11-18: «بيتحسب من عدد ماكينات المتسجلة داخل المصنع»): D «متوقف» when its status is
 *  «خامل», whatever its machines; else from its machines (customerMachineCount); else nothing. A stored factorySize is never read. */
export type ComputedFactorySize={value:FactorySize|'';from:'status'|'machines'|'none'};
export function computedFactorySize(data:Record<string,unknown>|null|undefined,machines:MachineCount|number):ComputedFactorySize{
 if(stoppedStatus(data?.customerStatus))return {value:'D',from:'status'};
 const value=sizeFromMachines(typeof machines==='number'?machines:machines.count);
 return value?{value,from:'machines'}:{value:'',from:'none'};
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

/** The filters of «العملاء»: 'all', 'none' (no size; no interest), or a value of the list. The size is the computed one, for every customer;
 *  a customer whose interest the reader may not read is in no interest filter that is set (not even «غير محدد»). */
export type ClassificationFilter={factorySize:string;customerInterest:string};
export const NO_CLASSIFICATION_FILTER:ClassificationFilter={factorySize:'all',customerInterest:'all'};
export const classificationFiltersSet=(filter:ClassificationFilter)=>CLASSIFICATION_FILTER_FIELDS.filter(field=>filter[field]!=='all').length;
export function matchesClassification(data:Record<string,unknown>,machines:MachineCount|number,filter:ClassificationFilter){
 if(filter.factorySize!=='all'){const size=computedFactorySize(data,machines).value;if(filter.factorySize==='none'?size!=='':size!==filter.factorySize)return false;}
 if(filter.customerInterest!=='all'){
  if(classificationHidden(data))return false;
  const interest=classificationValue(data,'customerInterest');
  if(filter.customerInterest==='none'?interest!=='':interest!==filter.customerInterest)return false;
 }
 return true;
}
