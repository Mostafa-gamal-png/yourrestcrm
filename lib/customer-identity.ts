import type {Row} from './crm';

/** The same key is used by imports, customer writes and ERP/KPI matching. */
export const customerCodeKey=(value:unknown)=>String(value??'').normalize('NFKC').trim().toUpperCase();
export type CustomerCodeMapping={codeKey:string;customerId:string;version:number};
export type CustomerIdentityState={revision:number;mappings:CustomerCodeMapping[]};
export function customerErpCodes(row:Row):string[]{
 const aliases=Array.isArray(row.data._erpCodeAliases)?row.data._erpCodeAliases:[];
 return [...new Set([row.data.code,...aliases].filter(value=>typeof value==='string'&&customerCodeKey(value)))];
}
export function customerCodeCandidates(records:Row[]){
 const byCode=new Map<string,Row[]>();
 for(const row of records){if(row.kind!=='customer')continue;for(const code of new Set(customerErpCodes(row).map(customerCodeKey))){const list=byCode.get(code)||[];list.push(row);byCode.set(code,list);}}
 return byCode;
}
/** Explicit mappings never create an association absent from the source data. */
export function uniqueCustomerCodes(records:Row[],mappings:CustomerCodeMapping[]=[]){
 const byCode=customerCodeCandidates(records);
 for(const mapping of mappings){const candidates=byCode.get(mapping.codeKey)||[],selected=candidates.find(row=>row.id===mapping.customerId);if(selected)byCode.set(mapping.codeKey,[selected]);}
 return byCode;
}
