// Who the products application's `salesmen` route carries, and what one check sends (pure: lib/mold-salesmen-server.ts reads the members
// and keeps the state; tests/mold-salesmen.mjs runs this file transpiled). A salesman is an active member who may file a mold request
// exactly as POST /api/mold-requests decides it for `create`: a role of MOLD_ROLES (canCreateMoldRequest), «طلبات تصنيع القوالب» not
// hidden from them (pagesBlocked, the route's requirePages) and its «إضافة» cell not switched off (cellRefused, the route's requireCell).
// «المركز الرئيسي» and «مبيعات مكتب» are not members; a member named so by mistake is never sent either.
import {cellRefused,pagesBlocked,type MemberAccess} from './permissions';
import {canCreateMoldRequest} from './mold-requests';
import type {Member} from './crm';
import {moldSalesmanEntry,moldSalesmanName,moldSalesmenCalls} from '@/portable/mold-salesmen.mjs';

export type SalesmanMember=Pick<Member,'id'|'name'|'email'|'role'|'active'>&{access?:MemberAccess|null};
export type SalesmanEntry=NonNullable<ReturnType<typeof moldSalesmanEntry>>;
type Call={mode:'full'|'upsert';salesmen:SalesmanEntry[]};

/** A full list at least once a day; while production does not have the route yet, the next try an hour later. */
export const MOLD_SALESMEN_DAY_MS=24*3600_000,MOLD_SALESMEN_ROUTE_RETRY_MS=3600_000;
/** The names that are the office, not a representative (as the ERP imports leave them out). */
const OFFICE_NAMES=new Set(['المركز الرئيسي','مبيعات مكتب','مبيعات المكتب']);
const isOffice=(name:unknown)=>OFFICE_NAMES.has(moldSalesmanName(name).replace(/ـ/g,''));

/** Whether the member may file a mold request now: active, and as the create path of POST /api/mold-requests decides. */
export function moldSalesmanMayAsk(member:SalesmanMember){
 return !!Number(member.active)&&canCreateMoldRequest(member as Member)&&!pagesBlocked(member,['mold-requests'])&&!cellRefused(member,'mold-requests','add')&&!isOffice(member.name);
}

/** What the CRM remembers of the route (a row of crm_settings, lib/mold-salesmen-server.ts): when the last full list went, a short
 *  fingerprint of each salesman as last sent (active ones only), when production first answered that it has no such route yet and when
 *  that was last said in the log, the last send's counts and the last failure (codes and field names only: no name, no email). */
export type MoldSalesmenState={v:1;fullAt:string|null;sent:Record<string,string>;routeMissingAt:string|null;routeLoggedAt:string|null;warnedAt:string|null;
 lastError:{at:string;code:string;http:number;fields:string[]}|null;last:Record<string,unknown>|null};
export const emptySalesmenState=():MoldSalesmenState=>({v:1,fullAt:null,sent:{},routeMissingAt:null,routeLoggedAt:null,warnedAt:null,lastError:null,last:null});
/** The state as stored, read defensively: anything unreadable is the empty state (the next check sends a full list). */
export function readSalesmenState(text:unknown):MoldSalesmenState{
 let raw:unknown;try{raw=typeof text==='string'?JSON.parse(text):null;}catch{raw=null;}
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return emptySalesmenState();
 const value=raw as Record<string,unknown>,iso=(key:string)=>typeof value[key]==='string'&&Number.isFinite(Date.parse(value[key] as string))?value[key] as string:null;
 const sent:Record<string,string>={};
 if(value.sent&&typeof value.sent==='object'&&!Array.isArray(value.sent))for(const [id,hash] of Object.entries(value.sent as Record<string,unknown>))if(typeof hash==='string')sent[id]=hash;
 const error=value.lastError&&typeof value.lastError==='object'?value.lastError as MoldSalesmenState['lastError']:null;
 return{v:1,fullAt:iso('fullAt'),sent,routeMissingAt:iso('routeMissingAt'),routeLoggedAt:iso('routeLoggedAt'),warnedAt:iso('warnedAt'),lastError:error,last:value.last&&typeof value.last==='object'?value.last as Record<string,unknown>:null};
}

export type SalesmenPlan={
 /** none: nothing to send; wait: production has no route yet, the next try later; full: the whole list (full, or upsert batches when
  *  overLimit); upsert: only the salesmen that changed since they were last sent. */
 kind:'none'|'wait'|'full'|'upsert';
 reason:'first'|'daily'|'removed'|'forced'|'changed'|'unchanged'|'route_waiting';
 calls:Call[];overLimit:boolean;
 /** Members who may ask (eligible), and those of them that cannot be sent (an id or a name the route refuses). */
 eligible:number;skipped:number;
 /** The fingerprints to keep once every call succeeded. */
 sentAfter:Record<string,string>;
};

/**
 * What one check sends. A full list when none was sent yet (the first after the release), when the last is a day old, when a salesman
 * sent before is no longer a member at all (deleted: only a full list can deactivate it, the route needs a name), or when forced; else
 * an upsert of the salesmen whose entry changed (added, renamed, a new email) and of the members sent before who may no longer ask
 * (deactivated, another role, the screen hidden, «إضافة» switched off) as active:false; else nothing. While production answers that it has
 * no such route, nothing for an hour after its answer (forced included: the route is not there).
 */
export function moldSalesmenPlan(members:SalesmanMember[],state:MoldSalesmenState,now:string,hash:(entry:SalesmanEntry)=>string,{force=false}:{force?:boolean}={}):SalesmenPlan{
 const eligibleMembers=members.filter(moldSalesmanMayAsk),entries:SalesmanEntry[]=[];
 for(const member of eligibleMembers){const entry=moldSalesmanEntry({id:member.id,name:member.name,email:member.email,active:true});if(entry)entries.push(entry);}
 entries.sort((a,b)=>a.crmMemberId<b.crmMemberId?-1:a.crmMemberId>b.crmMemberId?1:0);
 const base={eligible:eligibleMembers.length,skipped:eligibleMembers.length-entries.length};
 if(state.routeMissingAt&&Date.parse(now)-Date.parse(state.routeMissingAt)<MOLD_SALESMEN_ROUTE_RETRY_MS)return{...base,kind:'wait',reason:'route_waiting',calls:[],overLimit:false,sentAfter:state.sent};
 const fingerprints=Object.fromEntries(entries.map(entry=>[entry.crmMemberId,hash(entry)]));
 const byId=new Map(members.map(member=>[member.id,member]));
 const leaving:SalesmanEntry[]=[];let removed=false;
 for(const id of Object.keys(state.sent)){
  if(fingerprints[id])continue;
  const member=byId.get(id),entry=member?moldSalesmanEntry({id:member.id,name:member.name,email:member.email,active:false}):null;
  if(entry)leaving.push(entry);else removed=true;
 }
 const reason=force?'forced':!state.fullAt?'first':Date.parse(now)-Date.parse(state.fullAt)>=MOLD_SALESMEN_DAY_MS?'daily':removed?'removed':null;
 if(reason){
  const {calls,overLimit}=moldSalesmenCalls('full',entries);
  // Over the limits the list goes as upserts: whoever was sent before and may no longer ask is sent active:false with it.
  if(overLimit)calls.push(...moldSalesmenCalls('upsert',leaving).calls);
  return{...base,kind:'full',reason,calls,overLimit,sentAfter:fingerprints};
 }
 const changed=entries.filter(entry=>state.sent[entry.crmMemberId]!==fingerprints[entry.crmMemberId]);
 if(!changed.length&&!leaving.length)return{...base,kind:'none',reason:'unchanged',calls:[],overLimit:false,sentAfter:state.sent};
 const sentAfter={...state.sent};
 for(const entry of changed)sentAfter[entry.crmMemberId]=fingerprints[entry.crmMemberId];
 for(const entry of leaving)delete sentAfter[entry.crmMemberId];
 return{...base,kind:'upsert',reason:'changed',calls:moldSalesmenCalls('upsert',[...changed,...leaving]).calls,overLimit:false,sentAfter};
}
