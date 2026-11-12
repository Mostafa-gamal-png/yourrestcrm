// The CRM's salesmen for the products application (its `salesmen` route, agreed on 2026-11-12, yourrest-products#54): a request
// registered there names its representative from this list. Kept like the customers list (lib/mold-customers-server.ts): the whole list
// as `full` once the release is live (the first check after the server starts) and at least once a day; an `upsert` of what changed a few
// seconds after a member is added or edited or their permissions change (POST /api/crm, through lib/mold-customers-hook.ts); a check
// every ten minutes. Who is sent and what one check sends: lib/mold-salesmen.ts. What the CRM remembers is one row of crm_settings
// (MOLD_SALESMEN_STATE: no migration); each send that went through is one crm_audit line (counts and deactivatedIds: ids only, no name or
// email). Before the products release that has the route, it answers 400 invalid_payload with fields ["route"]: that is no error, the CRM
// tries again an hour later and says so in the log once a day at most. Nothing here throws into a caller and nothing logs the secret.
import {createHash} from 'node:crypto';
import {database} from './crm-server';
import {memberAccess} from './permissions';
import {productsLink} from './mold-requests-server';
import {callProducts,moldConfig} from '@/portable/mold-client.mjs';
import {moldSalesmenAnswer,moldSalesmenRouteMissing} from '@/portable/mold-salesmen.mjs';
import {emptySalesmenState,moldSalesmenPlan,readSalesmenState,type MoldSalesmenState,type SalesmanEntry,type SalesmanMember} from './mold-salesmen';

type Config=ReturnType<typeof moldConfig>;
export const MOLD_SALESMEN_RECORD='mold-salesmen',MOLD_SALESMEN_ACTION='mold-salesmen:sync',MOLD_SALESMEN_STATE='mold-salesmen';
/** A check this long after a change (a burst of edits sends once), one every ten minutes; the log says «not available yet» once a day
 *  at most, and a failure once an hour at most. */
export const MOLD_SALESMEN_SETTLE_MS=5_000,MOLD_SALESMEN_CHECK_MS=10*60_000,MOLD_SALESMEN_LOG_MS=24*3600_000,MOLD_SALESMEN_WARN_MS=3600_000;

/** Every member, with what applies to them («الصلاحيات»: one read of crm_member_permissions, as context() reads it per member). */
export async function moldSalesmanMembers(db:D1Database):Promise<SalesmanMember[]>{
 const rows=(await db.prepare(`SELECT m.id,m.name,m.email,m.role,m.active,p.permissions,p.hidden,p.version FROM crm_members m LEFT JOIN crm_member_permissions p ON p.member_id=m.id ORDER BY m.id`).all<{id:string;name:string;email:string;role:string;active:number;permissions:string|null;hidden:string|null;version:number|null}>()).results;
 return rows.map(row=>({id:row.id,name:row.name,email:row.email,role:row.role,active:Number(row.active)||0,access:memberAccess(row.role,row.version===null?null:row)}));
}
const fingerprint=(entry:SalesmanEntry)=>createHash('sha256').update(JSON.stringify(entry)).digest('hex').slice(0,16);
export async function readMoldSalesmenState(db:D1Database){
 const row=await db.prepare('SELECT owner_id AS state FROM crm_settings WHERE id=?').bind(MOLD_SALESMEN_STATE).first<{state:string}>();
 return row?readSalesmenState(row.state):emptySalesmenState();
}
const saveState=(db:D1Database,state:MoldSalesmenState)=>db.prepare('INSERT INTO crm_settings(id,owner_id) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id').bind(MOLD_SALESMEN_STATE,JSON.stringify(state)).run();

export type SalesmenSyncResult={sent:boolean;reason:string;mode?:'full'|'upsert';count?:number;result?:Record<string,number>;deactivatedIds?:string[];error?:string;fields?:string[]};
type Log={info:(line:string)=>void;warn:(line:string)=>void};
let running:Promise<SalesmenSyncResult>|null=null;

/**
 * One check: sends what moldSalesmenPlan says, one call after another, and records it. One at a time in a process: a check that comes
 * while one runs waits for it.
 */
export function syncMoldSalesmen(db:D1Database,link:Config,{force=false,now=()=>new Date().toISOString(),fetch,log=console}:{force?:boolean;now?:()=>string;fetch?:typeof globalThis.fetch;log?:Log}={}):Promise<SalesmenSyncResult>{
 if(running)return running;
 running=(async():Promise<SalesmenSyncResult>=>{
  if(!link.ok)return {sent:false,reason:link.reason};
  const at=now(),state=await readMoldSalesmenState(db),plan=moldSalesmenPlan(await moldSalesmanMembers(db),state,at,fingerprint,{force});
  if(plan.kind==='none'||plan.kind==='wait')return {sent:false,reason:plan.reason,count:plan.eligible};
  const totals={received:0,inserted:0,updated:0,deactivated:0,activeSalesmen:0},deactivatedIds:string[]=[];
  for(const call of plan.calls){
   const answer=await callProducts(link,'salesmen',call,fetch?{fetch,timeoutMs:30_000}:{timeoutMs:30_000});
   if(answer.kind!=='ok'){
    if(moldSalesmenRouteMissing(answer)){
     // The products application before its release of the route: not an error. Tried again an hour later; said once a day at most.
     const quiet=state.routeLoggedAt&&Date.parse(at)-Date.parse(state.routeLoggedAt)<MOLD_SALESMEN_LOG_MS;
     if(!quiet)log.info(JSON.stringify({event:'mold-salesmen',status:'route_not_available_yet',retryInMinutes:60}));
     await saveState(db,{...state,routeMissingAt:at,routeLoggedAt:quiet?state.routeLoggedAt:at});
     return {sent:false,reason:'route_not_available',count:plan.eligible};
    }
    const fields=answer.fields.slice(0,10),error={at,code:answer.code,http:answer.http,fields};
    const quiet=state.warnedAt&&Date.parse(at)-Date.parse(state.warnedAt)<MOLD_SALESMEN_WARN_MS;
    if(!quiet)log.warn(JSON.stringify({event:'mold-salesmen',status:'failed',kind:answer.kind,code:answer.code,http:answer.http,fields}));
    await saveState(db,{...state,routeMissingAt:null,lastError:error,warnedAt:quiet?state.warnedAt:at});
    return {sent:false,reason:'failed',error:answer.code,fields,count:plan.eligible};
   }
   const read=moldSalesmenAnswer(answer.json)!;
   for(const key of ['received','inserted','updated','deactivated'] as const)totals[key]+=read[key];
   totals.activeSalesmen=read.activeSalesmen;deactivatedIds.push(...read.deactivatedIds);
  }
  const mode=plan.kind==='full'&&!plan.overLimit?'full':'upsert',ids=[...new Set(deactivatedIds)].slice(0,1000);
  if(plan.overLimit)log.warn(JSON.stringify({event:'mold-salesmen',status:'over_limit',salesmen:plan.calls.reduce((sum,call)=>sum+call.salesmen.length,0),note:'sent as upsert batches; nobody deactivated this time'}));
  if(state.routeMissingAt)log.info(JSON.stringify({event:'mold-salesmen',status:'route_available'}));
  const detail={label:'إرسال قائمة المندوبين لتطبيق الإنتاج',mode,reason:plan.reason,calls:plan.calls.length,eligible:plan.eligible,skipped:plan.skipped,sent:plan.calls.reduce((sum,call)=>sum+call.salesmen.length,0),...(plan.overLimit?{overLimit:true}:{}),...totals,deactivatedIds:ids};
  await db.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),MOLD_SALESMEN_RECORD,'system',MOLD_SALESMEN_ACTION,JSON.stringify(detail),at).run();
  await saveState(db,{...state,fullAt:plan.kind==='full'?at:state.fullAt,sent:plan.sentAfter,routeMissingAt:null,lastError:null,last:{at,mode,reason:plan.reason,...totals}});
  return {sent:true,reason:plan.reason,mode,count:plan.eligible,result:totals,deactivatedIds:ids};
 })().catch(error=>({sent:false,reason:'failed',error:error instanceof Error?error.name:'Error'})).finally(()=>{running=null;});
 return running;
}

/** Keeps the list in step while the server runs: a check every ten minutes and one shortly after each nudge with soon. Started by the
 *  routes every page loads and the ones that change members (lib/mold-customers-hook.ts). */
export function keepMoldSalesmenSynced(db:D1Database,link:()=>Config,{soon=false}:{soon?:boolean}={}){
 const holder=globalThis as typeof globalThis&{__yourrestMoldSalesmen?:{timer:ReturnType<typeof setInterval>;settle?:ReturnType<typeof setTimeout>}};
 const check=()=>{void syncMoldSalesmen(db,link()).catch(()=>{});};
 if(!holder.__yourrestMoldSalesmen){
  const timer=setInterval(check,MOLD_SALESMEN_CHECK_MS);timer.unref?.();
  holder.__yourrestMoldSalesmen={timer};
  soon=true;
 }
 if(soon){
  const state=holder.__yourrestMoldSalesmen;
  if(state.settle)clearTimeout(state.settle);
  state.settle=setTimeout(()=>{state.settle=undefined;check();},MOLD_SALESMEN_SETTLE_MS);state.settle.unref?.();
 }
}

/** The entry the hook uses: the live database and the link as the settings say now. */
export function nudgeMoldSalesmen({soon=false}:{soon?:boolean}={}){keepMoldSalesmenSynced(database(),productsLink,{soon});}
