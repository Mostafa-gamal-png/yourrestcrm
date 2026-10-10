import {type context} from './crm-server';
import type {Row} from './crm';
import {regionScope} from './regions';
import {salesReadMemberIds,type Sale} from './sales';
import {visitCustomer} from './customer-visits';
import {kpiPeriod} from './kpis';

type Context=Awaited<ReturnType<typeof context>>;
export {customerCodeKey,uniqueCustomerCodes} from './customer-identity';
import {customerCodeKey,uniqueCustomerCodes} from './customer-identity';
export type PurchaseFact={repId:string;customerKey:string;date:string;netCents:number;hasSale:boolean};
/** Compact monthly facts, never the full historical invoice/item payload. */
export async function readKpiPurchaseHistory(c:Context,month:string){
 const allowed=[...salesReadMemberIds(c.members,c.me)],period=kpiPeriod(month);
 if(!allowed.length)return{facts:[] as PurchaseFact[],unresolved:new Set<string>()};
 const placeholders=allowed.map(()=>'?').join(','),codes=uniqueCustomerCodes(c.all,c.customerIdentityState?.mappings);
 const [manual,erp]=await Promise.all([
  c.db.prepare(`SELECT s.rep_id,s.customer_id,substr(s.date,1,7)||'-01' AS period,
   SUM(s.total_cents) AS net,MAX(CASE WHEN s.total_cents>0 THEN 1 ELSE 0 END) AS purchased
   FROM crm_sales s WHERE s.status='confirmed' AND s.date<=? AND s.rep_id IN (${placeholders})
   GROUP BY s.rep_id,s.customer_id,substr(s.date,1,7)`)
   .bind(period.cutoff,...allowed).all<any>(),
  c.db.prepare(`SELECT rep_id,customer_code,substr(date,1,7)||'-01' AS period,
   SUM(total_cents) AS net,MAX(CASE WHEN document_type='sale' AND total_cents>0 THEN 1 ELSE 0 END) AS purchased
   FROM crm_erp_sales WHERE date<=? AND rep_id IN (${placeholders}) AND (?='all' OR region_scope=?)
   GROUP BY rep_id,customer_code,substr(date,1,7)`)
   .bind(period.cutoff,...allowed,regionScope(c.me),regionScope(c.me)).all<any>()
 ]);
 const facts:PurchaseFact[]=[],unresolved=new Set<string>();
 const erpCodes=new Set(erp.results.map(r=>customerCodeKey(r.customer_code)).filter(Boolean));
 const ambiguousCustomers=new Set<string>();
 for(const code of erpCodes){const matches=codes.get(code)||[];if(matches.length>1)for(const row of matches)ambiguousCustomers.add(row.id);}
 for(const r of manual.results){
  if(!c.regionCustomerIds.has(r.customer_id))continue;
  if(ambiguousCustomers.has(r.customer_id)){unresolved.add(r.rep_id);continue;}
  facts.push({repId:r.rep_id,customerKey:'crm:'+r.customer_id,date:r.period,netCents:r.net,hasSale:!!r.purchased});
 }
 for(const r of erp.results){
  const code=customerCodeKey(r.customer_code);
  if(!code){unresolved.add(r.rep_id);continue;}
  const matched=codes.get(code);
  if(matched&&matched.length>1){unresolved.add(r.rep_id);continue;}
  facts.push({repId:r.rep_id,customerKey:matched?.length===1?'crm:'+matched[0].id:'erp:'+code,date:r.period,netCents:r.net,hasSale:!!r.purchased});
 }
 return{facts,unresolved};
}

/** Revalidate saved conversions on every read; a voided invoice never counts. */
export function isValidKpiConversion(c:Context,quoteId:string,saleId:string,memberId:string,month:string,sales:Sale[]){
 const period=kpiPeriod(month),quote=c.regionalRecords.find(r=>r.id===quoteId),sale=sales.find(s=>s.id===saleId);
 if(!quote||!sale||sale.repId!==memberId||sale.status!=='confirmed'||sale.documentType==='return'||sale.totalCents<=0)return false;
 if(!isKpiIssuedQuote(quote,month)||sale.date<quote.data.date||sale.date>period.cutoff)return false;
 const customer=visitCustomer(quote,c.all);if(!customer||!c.regionCustomerIds.has(customer.id))return false;
 if(sale.source!=='erp')return sale.customerId===customer.id;
 const code=customerCodeKey(sale.customerId.replace(/^erp-customer:/,''));
 const matched=uniqueCustomerCodes(c.all,c.customerIdentityState?.mappings).get(code);
 return !!code&&matched?.length===1&&matched[0].id===customer.id;
}
export function isKpiIssuedQuote(row:Row,month:string){
 const cutoff=kpiPeriod(month).cutoff;
 return typeof row.data.date==='string'&&row.data.date>=month+'-01'&&row.data.date<=cutoff&&
  (row.kind==='quote'&&['sent','accepted','rejected'].includes(row.data.status)||row.kind==='activity'&&(row.data.type==='quote'||row.data.salesStage==='quoted'));
}
