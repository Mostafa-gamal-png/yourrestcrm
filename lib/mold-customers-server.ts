// The CRM's customers for the products application (the contract's `customers` route): requests registered there choose the customer
// from this list only, and its Yourrest code, address and city fill in from it. The whole list goes as `full` (production deactivates
// whoever is missing; it deletes nobody): the first time, whenever it changed (a customer added, edited or deleted, by any path: the
// list's fingerprint is compared), and at least once a day. A list over production's limits goes as `upsert` batches, without a final
// `full` (it would be refused), so nobody is deactivated that time. Each send is recorded in crm_audit (counts and fingerprint only,
// no names), which also carries the last fingerprint across a restart. Nothing here throws into a caller: a failed send waits for the
// next check.
import {createHash} from 'node:crypto';
import {database} from './crm-server';
import {productsLink} from './mold-requests-server';
import {callProducts,moldConfig} from '@/portable/mold-client.mjs';
import {moldCustomerCalls,moldCustomerEntry,MOLD_SHEET_CITIES} from '@/portable/mold-rules.mjs';

type Config=ReturnType<typeof moldConfig>;
type Entry=NonNullable<ReturnType<typeof moldCustomerEntry>>;
export const MOLD_CUSTOMERS_RECORD='mold-customers',MOLD_CUSTOMERS_ACTION='mold-customers:sync';
/** A customer deleted in the CRM (written with the deletion, app/api/crm/route.ts): its number, name, address and city, so the next send
 *  carries it as active:false (the contract: a deleted customer is sent upsert with "active": false when it is deleted). */
export const MOLD_CUSTOMERS_REMOVED='mold-customers:removed';
/** The removals read again at each send reach back this far before the last send, so one written in the moment of a send is never lost. */
const REMOVED_OVERLAP_MS=5*60_000,REMOVED_FIRST_MS=30*24*3600_000;
/** A check runs this long after a change in the CRM, so a burst of edits sends once; a full send at least once a day. */
export const MOLD_CUSTOMERS_SETTLE_MS=5_000,MOLD_CUSTOMERS_CHECK_MS=10*60_000,MOLD_CUSTOMERS_DAY_MS=24*3600_000;

/** Every CRM customer with a Yourrest number and a name, by number. */
export async function moldCustomerList(db:D1Database){
 const rows=(await db.prepare("SELECT n.number,r.data FROM crm_records r JOIN crm_customer_numbers n ON n.customer_id=r.id WHERE r.kind='customer' ORDER BY n.number").all<{number:number;data:string}>()).results;
 const customers:Entry[]=[];
 for(const row of rows){let data:Record<string,unknown>={};try{data=JSON.parse(row.data);}catch{/* a broken record is left out */}const entry=moldCustomerEntry({crmNumber:row.number,name:data.name,address:data.address,city:data.city});if(entry)customers.push(entry);}
 return customers;
}
const fingerprint=(customers:Entry[])=>createHash('sha256').update(JSON.stringify(customers)).digest('hex');
/** The customers deleted since the last send (with an overlap), as entries with active:false; none that is still in the list. */
async function removedSince(db:D1Database,since:string,listed:Entry[]){
 const rows=(await db.prepare('SELECT detail FROM crm_audit WHERE record_id=? AND action=? AND created_at>? ORDER BY created_at').bind(MOLD_CUSTOMERS_RECORD,MOLD_CUSTOMERS_REMOVED,since).all<{detail:string}>()).results;
 const present=new Set(listed.map(entry=>entry.crmNumber)),seen=new Set<number>(),removed:Entry[]=[];
 for(const row of rows){let data:Record<string,unknown>={};try{data=JSON.parse(row.detail);}catch{/* a broken record is left out */}const entry=moldCustomerEntry({crmNumber:data.crmNumber,name:data.name,address:data.address,city:data.city,active:false});if(entry&&!present.has(entry.crmNumber)&&!seen.has(entry.crmNumber)){seen.add(entry.crmNumber);removed.push(entry);}}
 return removed;
}

let last:{hash:string;at:string}|null=null,loaded=false,running:Promise<SyncResult>|null=null;
export type SyncResult={sent:boolean;reason:string;count?:number;result?:Record<string,number>;error?:string};
async function lastSent(db:D1Database){
 if(loaded)return last;
 const row=await db.prepare('SELECT detail,created_at AS at FROM crm_audit WHERE record_id=? AND action=? ORDER BY created_at DESC LIMIT 1').bind(MOLD_CUSTOMERS_RECORD,MOLD_CUSTOMERS_ACTION).first<{detail:string;at:string}>();
 try{const detail=row?JSON.parse(row.detail):null;last=detail?.hash?{hash:detail.hash,at:row!.at}:null;}catch{last=null;}
 loaded=true;return last;
}

/**
 * Sends the list when it changed since the last send or the last send is a day old (or when forced). One at a time: a check that
 * comes while one runs waits for it.
 */
export function syncMoldCustomers(db:D1Database,link:Config,{force=false,now=()=>new Date().toISOString(),fetch}:{force?:boolean;now?:()=>string;fetch?:typeof globalThis.fetch}={}):Promise<SyncResult>{
 if(running)return running;
 running=(async():Promise<SyncResult>=>{
  if(!link.ok)return {sent:false,reason:link.reason};
  // The time of this send is taken before anything is read: whatever changes after it is read again by the next send.
  const at=now(),customers=await moldCustomerList(db),hash=fingerprint(customers),previous=await lastSent(db);
  const removed=await removedSince(db,new Date(previous?Date.parse(previous.at)-REMOVED_OVERLAP_MS:Date.parse(at)-REMOVED_FIRST_MS).toISOString(),customers);
  if(!force&&previous&&previous.hash===hash&&!removed.length&&Date.parse(at)-Date.parse(previous.at)<MOLD_CUSTOMERS_DAY_MS)return {sent:false,reason:'unchanged',count:customers.length};
  // A deleted customer goes as active:false with the list (inside the full call, or with the upsert batches of a very large list).
  const totals:Record<string,number>={received:0,inserted:0,updated:0,deactivated:0,activeCustomers:0},calls=moldCustomerCalls([...customers,...removed]);
  for(const call of calls){
   const answer=await callProducts(link,'customers',call,fetch?{fetch,timeoutMs:60_000}:{timeoutMs:60_000});
   if(answer.kind!=='ok')return {sent:false,reason:'failed',error:answer.code,count:customers.length};
   for(const key of Object.keys(totals))totals[key]=key==='activeCustomers'?Number(answer.json[key]):totals[key]+Number(answer.json[key]);
  }
  const cities=customers.filter(entry=>entry.city&&MOLD_SHEET_CITIES.includes(entry.city)).length;
  const detail={label:'إرسال قائمة العملاء لتطبيق الإنتاج',mode:calls.length===1?'full':'upsert',calls:calls.length,count:customers.length,removed:removed.length,sheetCities:cities,hash,...totals};
  await db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),MOLD_CUSTOMERS_RECORD,'system',MOLD_CUSTOMERS_ACTION,JSON.stringify(detail),at).run();
  last={hash,at};
  return {sent:true,reason:previous?(previous.hash===hash?'daily':'changed'):'first',count:customers.length,result:totals};
 })().catch(error=>({sent:false,reason:'failed',error:error instanceof Error?error.message:String(error)})).finally(()=>{running=null;});
 return running;
}

/**
 * Keeps the list in step while the server runs: a check every ten minutes (a send only if something changed, or a day passed), and
 * one shortly after each change made through the CRM. Started by the routes that change customers or that every page loads.
 */
export function keepMoldCustomersSynced(db:D1Database,link:()=>Config,{soon=false}:{soon?:boolean}={}){
 const holder=globalThis as typeof globalThis&{__yourrestMoldCustomers?:{timer:ReturnType<typeof setInterval>;settle?:ReturnType<typeof setTimeout>}};
 const check=()=>{void syncMoldCustomers(db,link()).catch(()=>{});};
 if(!holder.__yourrestMoldCustomers){
  const timer=setInterval(check,MOLD_CUSTOMERS_CHECK_MS);timer.unref?.();
  holder.__yourrestMoldCustomers={timer};
  soon=true;
 }
 if(soon){
  const state=holder.__yourrestMoldCustomers;
  if(state.settle)clearTimeout(state.settle);
  state.settle=setTimeout(()=>{state.settle=undefined;check();},MOLD_CUSTOMERS_SETTLE_MS);state.settle.unref?.();
 }
}

/** The entry the routes use (through lib/mold-customers-hook.ts): the live database and the link as the settings say now. */
export function nudgeMoldCustomers({soon=false}:{soon?:boolean}={}){keepMoldCustomersSynced(database(),productsLink,{soon});}
