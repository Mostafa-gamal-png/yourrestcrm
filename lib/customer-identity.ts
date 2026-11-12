import type {Row} from './crm';

/** The same key is used by imports, customer writes and ERP/KPI matching; Arabic-Indic digits are plain ones (C-١٠٢ is C-102). */
export const customerCodeKey=(value:unknown)=>String(value??'').normalize('NFKC').replace(/[٠-٩۰-۹]/g,digit=>String(digit.charCodeAt(0)-(digit>='۰'?0x6f0:0x660))).trim().toUpperCase();
/** The refusal of a customer save whose ERP code another customer carries now (app/api/crm/route.ts): a CRM customer has its own ERP code. */
export const erpCodeTaken=(code:string)=>'كود ERP «'+code+'» مسجّل لعميل آخر في الـCRM؛ لكل عميل كود ERP خاص به لا يتكرر. صحّح الكود، أو اتركه فارغًا إذا لم يكن العميل في ERP.';
/** The refusal of a customer save (app/api/crm/route.ts) that types, changes or clears the ERP code (the owner, 2026-11-12: «الغى امكانية
 *  تعديل كود erp لاى حد حتى مدير النظام»): the code comes from the ERP customers import only (lib/erp-customers-server.ts). A save that
 *  keeps the code, or does not send it, is accepted; a customer added by hand has no ERP code. */
export const ERP_CODE_LOCKED='كود ERP لا يُكتب ولا يُعدَّل يدويًا لأي مستخدم، ولا لمدير النظام؛ يُحدَّث من ملف عملاء ERP فقط («استيراد من ERP»).';
export const ERP_CODE_LOCKED_NOTE='يُحدَّث من ملف عملاء ERP فقط';
export type CustomerCodeMapping={codeKey:string;customerId:string;version:number};
export type CustomerIdentityState={revision:number;mappings:CustomerCodeMapping[]};
/** The ERP code a customer carries NOW (data.code), as a list of none or one; the only code an ERP document is matched by (the owner,
 *  2026-11-12: «العميل ده مش موجود فى erp اصلا»: a customer whose code was cleared, or never set, is not an ERP customer and matches
 *  nothing). The codes it had before (crm_customer_code_aliases, read into data._erpCodeAliases) are history only: they no longer make it
 *  a candidate for an ERP invoice, quotation, last purchase or mold request (the trash's restore puts them back, as history). */
export function customerErpCodes(row:Row):string[]{
 const code=row.data.code;
 return typeof code==='string'&&customerCodeKey(code)?[code]:[];
}
/** Code key -> the customers that carry it as their CURRENT ERP code. Two customers with the same current code are both candidates. */
export function customerCodeCandidates(records:Row[]){
 const byCode=new Map<string,Row[]>();
 for(const row of records){if(row.kind!=='customer')continue;for(const code of new Set(customerErpCodes(row).map(customerCodeKey))){const list=byCode.get(code)||[];list.push(row);byCode.set(code,list);}}
 return byCode;
}
/** The stored mapping of a code when it still decides something: its customer is one of the code's current holders. A mapping to a
 *  customer that no longer carries the code (cleared, renamed, deleted) is ignored, never deleted. */
export function effectiveCodeMapping(mapping:CustomerCodeMapping|undefined,holders:Row[]|undefined){
 return mapping&&(holders||[]).some(row=>row.id===mapping.customerId)?mapping:undefined;
}
/** Explicit mappings never create an association absent from the source data: a mapping picks one customer among the code's current
 *  holders; one that points elsewhere is ignored, so a code one customer holds is that customer's whatever a stale mapping says. */
export function uniqueCustomerCodes(records:Row[],mappings:CustomerCodeMapping[]=[]){
 const byCode=customerCodeCandidates(records);
 for(const mapping of mappings){const candidates=byCode.get(mapping.codeKey)||[],selected=candidates.find(row=>row.id===mapping.customerId);if(selected)byCode.set(mapping.codeKey,[selected]);}
 return byCode;
}
