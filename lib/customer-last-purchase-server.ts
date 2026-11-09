import type {Row} from './crm';
import {readCustomerIdentityState} from './customer-identity-store';
import {lastPurchaseDates,type LastPurchaseRow} from './customer-last-purchase';

/** One statement for every customer: the latest ERP sale (never a return; positive total) per customer code as stored, and the latest
 * confirmed manual invoice per customer. No index: measured on 200,000 synthetic ERP documents, ~55 ms (a scan); 30,000 take ~9 ms. */
export const LAST_PURCHASE_SQL=`SELECT 'erp' AS source,customer_code AS key,MAX(date) AS date FROM crm_erp_sales WHERE document_type='sale' AND total_cents>0 GROUP BY customer_code
 UNION ALL SELECT 'crm' AS source,customer_id AS key,MAX(date) AS date FROM crm_sales WHERE status='confirmed' AND total_cents>0 GROUP BY customer_id`;

/** Customer id -> last purchase date, over `all` (every customer master, whatever the reader may see: a code is unique or not company-wide). */
export async function readLastPurchases(db:D1Database,all:Row[]){
 const [rows,identity]=await Promise.all([db.prepare(LAST_PURCHASE_SQL).all<LastPurchaseRow>(),readCustomerIdentityState(db)]);
 return lastPurchaseDates(all,identity?.mappings||[],rows.results);
}
/** The rows GET /api/crm sends, each customer with data._lastPurchase when it has bought; a computed field like internalCode: the customer
 * schema drops it from any save, so it is never stored, audited or sent to the products application. */
export function withLastPurchase<T extends Row>(records:T[],latest:Map<string,string>):T[]{
 return records.map(row=>{
  if(row.kind!=='customer')return row;
  const date=latest.get(row.id);
  if(date)return {...row,data:{...row.data,_lastPurchase:date}};
  if(row.data?._lastPurchase===undefined)return row;
  const {_lastPurchase:stale,...data}=row.data;void stale;return {...row,data};
 });
}
