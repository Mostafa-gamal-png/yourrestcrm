import type {Row} from './crm';
import {customerCodeKey,uniqueCustomerCodes,type CustomerCodeMapping} from './customer-identity';
import {mapActivity} from './customer-map-activity';

/** «لم يشترِ منذ 60 يومًا» (the owner, 2026-11-09, after GSCO's lib/crm/customer-last-sale.ts): a customer's last purchase is the latest
 * date of its ERP sale documents (never a return, positive total) and of its confirmed manual invoices. The server attaches it to each
 * customer row of GET /api/crm as data._lastPurchase (YYYY-MM-DD, the Riyadh date as stored); computed, never saved. A purchase exactly
 * INACTIVE_CUSTOMER_DAYS days ago still counts as recent; one day more does not (GSCO's boundary: 59 and 60 recent, 61 not). */
export const INACTIVE_CUSTOMER_DAYS=60;
const DAY=86400000,DATE=/^\d{4}-\d{2}-\d{2}$/;
const dateOf=(value:unknown)=>{const text=typeof value==='string'?value.slice(0,10):'';return DATE.test(text)&&Number.isFinite(Date.parse(text+'T00:00:00Z'))?text:'';};

/** The first day that still counts as recent: a purchase on or after it is not "inactive". */
export function recentSince(today:string,days=INACTIVE_CUSTOMER_DAYS){
 const time=Date.parse(today+'T00:00:00Z');
 return Number.isFinite(time)?new Date(time-days*DAY).toISOString().slice(0,10):today;
}
/** No purchase at all, or the last one before the window. */
export function noPurchaseSince(lastPurchase:unknown,today:string,days=INACTIVE_CUSTOMER_DAYS){
 const last=dateOf(lastPurchase);
 return !last||last<recentSince(today,days);
}
/** The customer's status is «نشط» (lib/customer-options.ts), read as the map reads it (spacing, English «Active»). A customer with no
 * status is «غير محدد» on the map and in the list, not active, so it is left out like «نصف نشط» and «خامل». */
export const activeCustomer=(customer:Pick<Row,'data'>)=>mapActivity(customer).key==='active';
/** What the customers page lists while «لم يشترِ منذ 60 يومًا» is on. */
export function inactiveCustomer(customer:Pick<Row,'data'>,today:string,days=INACTIVE_CUSTOMER_DAYS){
 return activeCustomer(customer)&&noPurchaseSince(customer.data?._lastPurchase,today,days);
}

/** One grouped row per ERP customer code (source 'erp', key = the code as stored) and per customer of a manual invoice (source 'crm',
 * key = the customer id), each with the latest date: LAST_PURCHASE_SQL's answer. */
export type LastPurchaseRow={source:'erp'|'crm';key:string;date:string};
/** Customer id -> last purchase date. An ERP code counts only when it maps to exactly one customer (uniqueCustomerCodes: the current code
 * of every customer, explicit mappings deciding among its current holders; the same join as the KPI invoices; a code a customer only had
 * before, or one an ERP customers import cleared, counts for nobody but its current holder): a code two customers
 * share counts for neither. `customers` must be every customer, not only the reader's, or a shared code would look unique. */
export function lastPurchaseDates(customers:Row[],mappings:CustomerCodeMapping[],rows:LastPurchaseRow[]){
 const codes=uniqueCustomerCodes(customers,mappings),ids=new Set(customers.filter(row=>row.kind==='customer').map(row=>row.id)),latest=new Map<string,string>();
 const keep=(id:string,date:string)=>{if(date&&(latest.get(id)||'')<date)latest.set(id,date);};
 for(const row of rows){
  const date=dateOf(row.date);
  if(row.source==='crm'){if(ids.has(row.key))keep(row.key,date);continue;}
  const code=customerCodeKey(row.key),matches=code?codes.get(code)||[]:[];
  if(matches.length===1)keep(matches[0].id,date);
 }
 return latest;
}
