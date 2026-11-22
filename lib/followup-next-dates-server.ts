import {z} from 'zod';
import {CRMError,accessGuard,requireCell,requirePages,requireSalesRole,type context} from './crm-server';
import {salesRecordAccess,salesScopeMemberIds} from './access';
import {memberCanAccessRegion} from './regions';
import {customerPlanSource,visitCustomer} from './customer-visits';
import {activeServiceCase} from './customer-service';
import {planTracked} from './followup-recontact';
import {isFieldRole} from './roles';
import {BULK_AUDIT_ACTION,BULK_AUDIT_PREFIX,BULK_MESSAGES,BULK_YIELD_EVERY,NEXT_DATE_STATUS_TEXT,PLAN_BULK_MAX,bulkLastDay,type NextDateResult,type NextDateStatus} from './daily-plan-followups';
import {planDay,riyadhDayOf} from './daily-plans';

/** POST /api/crm/opportunity-next-dates (the owner, 2026-11-22: the port of GSCO 2.13.85, decisions a and b): several follow-ups of «خطة الغد»
 * moved to one date: «إضافة إلى خطة الغد» (the plan's day), «ترحيل إلى تاريخ…» and «تغيير الموعد» of one stop. GSCO's «الفرصة» is the follow-up's
 * record here (the visit, contact or request that is the customer's latest plan: lib/customer-visits.ts customerPlanSource), its version the
 * record's. Who:
 * - a representative or a marketing officer («خطط المناديب · إضافة»): the follow-ups of their own customers (customer.assignedTo). A field
 *   member edits no saved record anywhere else in Yourrest (lib/crm-server.ts requireRecordEdit): this route changes the follow-up's date only;
 * - a supervisor, the sales manager, the administrator («المتابعات · تحرير»): the follow-ups of their team's customers, as their record edits
 *   reach. GSCO opens the whole team with «عرض بيانات الفريق بالكامل»; in Yourrest that switch widens reading only, so a follow-up read through
 *   it alone is out of reach here too (not_found);
 * - customer service: 403 (the plans are the sales team's).
 * Each item is held to: in reach (else not_found, whether it exists or not), still its customer's current follow-up and of the version the
 * device saw (else conflict), not superseded by a newer customer-service request assigned to sales (service), the customer's representative
 * active (unassigned), followed (closed: won, or lost without a re-contact date), a next action (no_action); the same date is unchanged. The
 * date is today or later (Riyadh) and at most 30 days ahead. At most 200 items, each once; any other key is 400 (an offline time too: the
 * route needs a connection and the device's outbox never holds it). Each item is its own write with its audit line (BULK_AUDIT_ACTION,
 * before and after, the request): the record's history, the supervisor's «ترحيل جماعي», and the receipt that answers a resent request
 * (request_id) without moving anything twice. A request number sent again with another body is 409. The loop gives the process back every
 * 25 items. */
type Ctx=Awaited<ReturnType<typeof context>>;
const itemSchema=z.object({id:z.string().min(1).max(200),version:z.number().int().positive()}).strict();
const schema=z.object({request_id:z.string().uuid(),next_date:z.string().refine(value=>!!planDay(value)),items:z.array(itemSchema),purpose:z.enum(['plan','reschedule']).default('reschedule'),plan_date:z.string().refine(value=>!!planDay(value)).optional()}).strict();
const yieldNow=()=>new Promise<void>(resolve=>{const g=globalThis as {setImmediate?:(f:()=>void)=>void};if(g.setImmediate)g.setImmediate(resolve);else setTimeout(resolve,0);});
async function sha256(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(n=>n.toString(16).padStart(2,'0')).join('');}
/** The audit line of one moved item: `followup-next-date:<member>:<day>:<request>:<item>`, the day the plan's (else the move's Riyadh day), so a
 *  plan's moves are read by the member and the day (lib/daily-plans-server.ts planBulkMoves) through the primary key's order. */
export const bulkAuditId=(memberId:string,day:string,requestId:string,itemId:string)=>BULK_AUDIT_PREFIX+memberId+':'+day+':'+requestId+':'+itemId;
export const bulkAuditRange=(memberId:string,day:string)=>[BULK_AUDIT_PREFIX+memberId+':'+day+':',BULK_AUDIT_PREFIX+memberId+':'+day+';'] as const;
/** The request's own receipt (its body's fingerprint): never a record, so no changes list shows it. */
const requestReceiptId=(memberId:string,requestId:string)=>'followup-next-dates:'+memberId+':'+requestId;
export const REQUEST_RECEIPT_ACTION='followup-next-dates:request';

export async function followupNextDatesPost(c:Ctx,body:unknown,now=new Date().toISOString()){
 requireSalesRole(c.me);
 const field=isFieldRole(c.me.role);
 if(field){requirePages(c.me,'plans');requireCell(c.me,'plans','add');}
 else{requirePages(c.me,'followup');requireCell(c.me,'followup','edit');}
 const parsed=schema.safeParse(body);if(!parsed.success)throw new CRMError(BULK_MESSAGES.invalid,400);
 const p=parsed.data;
 if(p.items.length<1||p.items.length>PLAN_BULK_MAX)throw new CRMError(BULK_MESSAGES.count,400);
 if(new Set(p.items.map(item=>item.id)).size!==p.items.length)throw new CRMError(BULK_MESSAGES.duplicate,400);
 const today=riyadhDayOf(now);
 if(p.next_date<today)throw new CRMError(BULK_MESSAGES.past,400);
 if(p.next_date>bulkLastDay(today))throw new CRMError(BULK_MESSAGES.far,400);
 const fingerprint=await sha256({next_date:p.next_date,purpose:p.purpose,plan_date:p.plan_date??null,items:[...p.items].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)});
 // The request number names one body: a second body with it is refused, whatever was moved before (review B1 of GSCO 2.13.85).
 const receiptId=requestReceiptId(c.me.id,p.request_id);
 const receipt=async()=>(await c.db.prepare('SELECT detail FROM crm_audit WHERE id=?').bind(receiptId).first<{detail:string}>())?.detail;
 const known=await receipt();
 if(known!==undefined&&known!==fingerprint)throw new CRMError(BULK_MESSAGES.reused,409);
 if(known===undefined){
  await c.db.prepare('INSERT OR IGNORE INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(receiptId,'followup-next-dates:'+c.me.id,c.me.name,REQUEST_RECEIPT_ACTION,fingerprint,now).run();
  if(await receipt()!==fingerprint)throw new CRMError(BULK_MESSAGES.reused,409);
 }
 const day=p.plan_date??today,auditId=(itemId:string)=>bulkAuditId(c.me.id,day,p.request_id,itemId);
 const stored=(await c.db.prepare('SELECT id,record_id AS recordId FROM crm_audit WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(p.items.map(item=>auditId(item.id)))).all<{id:string;recordId:string}>()).results;
 const done=new Set(stored.map(row=>row.recordId));
 const visible=new Map(c.visible.map(row=>[row.id,row])),members=new Map(c.members.map(member=>[member.id,member]));
 const access=salesRecordAccess(c.members,c.me),team=salesScopeMemberIds(c.members,c.me);
 const results:NextDateResult[]=[];
 const refuse=(id:string,status:Exclude<NextDateStatus,'moved'|'unchanged'>)=>results.push({id,status,message:NEXT_DATE_STATUS_TEXT[status]});
 for(const [index,item] of p.items.entries()){
  if(index>0&&index%BULK_YIELD_EVERY===0)await yieldNow();
  const row=visible.get(item.id);
  if(done.has(item.id)){results.push({id:item.id,status:'moved',replayed:true,...(row?{version:row.version}:{})});continue;}
  // Out of reach is «not_found», exactly as a follow-up that does not exist: the reach first, then the other rules.
  if(!row||!['activity','opportunity'].includes(row.kind)||row.data?._offlineState){refuse(item.id,'not_found');continue;}
  const customer=visitCustomer(row,c.visible);
  if(!customer||!memberCanAccessRegion(c.me,customer.data?.region)){refuse(item.id,'not_found');continue;}
  const reach=field?customer.assignedTo===c.me.id:!access.readOnly(row)&&(c.me.role==='admin'||team.has(customer.assignedTo));
  if(!reach){refuse(item.id,'not_found');continue;}
  let guard:{sql:string;args:(string|number)[]};
  try{guard=accessGuard(c,row);}catch{refuse(item.id,'not_found');continue;}
  // Still the customer's follow-up: its latest plan, unless a newer customer-service request assigned to sales stands before it (the
  // follow-ups page then executes that request instead: app/api/customer-followups).
  const service=activeServiceCase(customer.id,c),latest=customerPlanSource(customer.id,c.visible);
  if(latest?.id===row.id&&service?.status==='assigned'&&row.createdAt<service.createdAt){refuse(item.id,'service');continue;}
  if(latest?.id!==row.id){refuse(item.id,'conflict');continue;}
  const owner=members.get(customer.assignedTo);
  if(!owner||!owner.active){refuse(item.id,'unassigned');continue;}
  if(!planTracked(row.data||{})){refuse(item.id,'closed');continue;}
  if(!String(row.data?.nextAction||'').trim()){refuse(item.id,'no_action');continue;}
  const before=String(row.data?.nextDate||'').slice(0,10);
  if(before===p.next_date){results.push({id:item.id,status:'unchanged',version:row.version});continue;}
  if(row.version!==item.version){refuse(item.id,'conflict');continue;}
  const mutation=crypto.randomUUID();
  const gate=`${guard.sql} AND EXISTS (SELECT 1 FROM crm_records WHERE id=? AND kind='customer' AND assigned_to=?) AND EXISTS (SELECT 1 FROM crm_members WHERE id=? AND active=1)`;
  const written='EXISTS (SELECT 1 FROM crm_records WHERE id=? AND mutation_id=?)';
  const detail=`${before||'—'} → ${p.next_date} • `+JSON.stringify({request_id:p.request_id,purpose:p.purpose,plan_date:p.plan_date??null,items:p.items.length,body:fingerprint,customerId:customer.id,before:{nextDate:before||null,version:row.version},after:{nextDate:p.next_date,version:row.version+1}});
  const write=await c.db.batch([
   c.db.prepare(`UPDATE crm_records SET data=json_set(data,'$.nextDate',?),updated_at=?,version=version+1,mutation_id=? WHERE id=? AND version=? AND ${gate}`)
    .bind(p.next_date,now,mutation,item.id,item.version,...guard.args,customer.id,customer.assignedTo,customer.assignedTo),
   c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${written}`).bind(auditId(item.id),item.id,c.me.name,BULK_AUDIT_ACTION,detail,now,item.id,mutation),
  ]);
  if(write[0].meta.changes!==1){refuse(item.id,'conflict');continue;}
  results.push({id:item.id,status:'moved',version:row.version+1});
 }
 const moved=results.filter(result=>result.status==='moved').length,unchanged=results.filter(result=>result.status==='unchanged').length;
 return {ok:true as const,next_date:p.next_date,results,moved,unchanged,failed:results.length-moved-unchanged};
}
/** The plan's day a move of an audit line belongs to (its id: `followup-next-date:<member>:<day>:…`). */
export function bulkMoveOf(row:{id:string;recordId:string;detail:string;createdAt:string}){
 const at=row.detail.indexOf(' • ');let detail:{purpose?:unknown;customerId?:unknown;before?:{nextDate?:unknown};after?:{nextDate?:unknown}}={};
 try{detail=JSON.parse(at>=0?row.detail.slice(at+3):row.detail);}catch{detail={};}
 return {recordId:row.recordId,customerId:typeof detail.customerId==='string'?detail.customerId:'',from:typeof detail.before?.nextDate==='string'?detail.before.nextDate:null,to:typeof detail.after?.nextDate==='string'?detail.after.nextDate:'',at:row.createdAt,purpose:(detail.purpose==='plan'?'plan':'reschedule') as 'plan'|'reschedule'};
}
