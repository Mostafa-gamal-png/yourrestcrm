// «قوة الفرصة» of a visit or a customer-service opportunity (`strength` on activity records and on a service case's intake). The owner,
// 2026-11-18: «تصنيف الفرصة ده موجود بالفعل بس هيزيد»: the opportunity grade he described for the marketing officer is this field, with his
// four levels. The three stored values keep their meaning (strong = A, medium = B, weak = C) and `excluded` is the new D, so nothing
// stored is rewritten. Pure: the page, the server and the tests share this file.

type Strength={value:string;code:string;ar:string;en:string;helpAr:string;helpEn:string};
export const OPPORTUNITY_STRENGTHS=[
 {value:'strong',code:'A',ar:'مرتفعة',en:'High',helpAr:'اهتمام بالمنتج وصاحب القرار متفاعل وطلب عرض سعر',helpEn:'Interested in the product, the decision maker is engaged and asked for a quotation'},
 {value:'medium',code:'B',ar:'متوسطة',en:'Medium',helpAr:'يوجد اهتمام ولكن القرار مؤجل ويحتاج إلى دراسة',helpEn:'There is interest, but the decision is postponed and needs study'},
 {value:'weak',code:'C',ar:'ضعيفة',en:'Low',helpAr:'اهتمام محدود ولا توجد نية',helpEn:'Limited interest and no intention'},
 {value:'excluded',code:'D',ar:'مستبعدة',en:'Excluded',helpAr:'رفض التعامل لارتباطه الكامل بالمورد',helpEn:'Refused to deal with us, being fully tied to their supplier'},
] as const satisfies readonly Strength[];
export type OpportunityStrength=typeof OPPORTUNITY_STRENGTHS[number]['value'];
/** The stored values, for the schemas (lib/crm.ts activity, lib/customer-service.ts intake). */
export const STRENGTH_VALUES=['strong','medium','weak','excluded'] as const satisfies readonly OpportunityStrength[];
const byValue=new Map<string,Strength>(OPPORTUNITY_STRENGTHS.map(item=>[item.value,item]));
/** The Arabic words, A to D in order («A · مرتفعة» …): what every list, chip and export writes (translated with lib/locales/en.json). */
export const strengthLabels:Record<string,string>=Object.fromEntries(OPPORTUNITY_STRENGTHS.map(item=>[item.value,item.code+' · '+item.ar]));
export function strengthLabel(value:unknown,language:'ar'|'en'='ar'){
 const item=typeof value==='string'?byValue.get(value):undefined;
 return item?item.code+' · '+(language==='en'?item.en:item.ar):'';
}
export function strengthHelp(value:unknown,language:'ar'|'en'='ar'){
 const item=typeof value==='string'?byValue.get(value):undefined;
 return item?(language==='en'?item.helpEn:item.helpAr):'';
}
/** The customer-service queue's order (lib/service-queue.ts): A, B, C, then an opportunity with no grade yet (it may be anything), and D
 *  last: a customer who refused us for their supplier is the least worth the next call. */
export const STRENGTH_ORDER:Readonly<Record<string,number>>={strong:0,medium:1,weak:2,excluded:4};
export const UNGRADED_ORDER=3;
export const strengthRank=(value:unknown)=>typeof value==='string'&&value in STRENGTH_ORDER?STRENGTH_ORDER[value]:UNGRADED_ORDER;
/** The filter of the visits list: 'all', 'none' (no grade recorded) or a stored value. */
export function matchesStrength(value:unknown,filter:string){
 if(filter==='all')return true;
 const kept=typeof value==='string'&&byValue.has(value)?value:'';
 return filter==='none'?kept==='':kept===filter;
}
