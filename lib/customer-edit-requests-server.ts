import {z} from 'zod';
import {CRMError,accessGuard,requireCell,type context} from './crm-server';
import {can} from './permissions';
import {memberCanAccessRegion} from './regions';
import type {Row} from './crm';
import {CUSTOMER_EDITS_RECENT_DAYS,CUSTOMER_EDIT_FIELDS,CUSTOMER_EDIT_HISTORY,activeSupervisorOf,applyCustomerEdit,customerEditChanges,customerEditFingerprint,customerEditProposal,directCustomerEditRole,firstStage,liveStage,rejectReason,staleFields,type CustomerEditField,type CustomerEditHeld,type CustomerEditList,type CustomerEditRequest,type CustomerEditStage,type CustomerEditStatus} from './customer-edit-requests';

/** Server side of «طلبات تعديل بيانات العميل» (lib/customer-edit-requests.ts). Everything is kept in crm_audit, append-only, as
 *  «المحذوفات» keeps its deletions and restorations (no migration):
 *  - the request: id `customer-edit:<sender>:<key>` (the key the form made when it opened, so a repeated send is the same row), action
 *    `customer-edit:request`, record_id the customer, detail the held request (who, where it goes first, the fields, their new values and
 *    what they held then);
 *  - the supervisor's approval: id `customer-edit-supervisor:<request id>`, action `customer-edit:supervisor-approved`;
 *  - the end: id `customer-edit-decision:<request id>` (one, by its primary key), action `customer-edit:approved`, `:rejected` (with the
 *    reason) or `:cancelled`.
 *  A request waits while it has no end. One waits per customer at a time (the insert's own condition), so what the sales manager reads
 *  is what they approve. Every step is gated in its own statement on the request still waiting, on where it stands now (read live: the
 *  sender's supervisor active, a representative, not yet approved by them) and on the actor's account as the request was decided with
 *  (accessGuard); approval runs the ordinary customer save of POST /api/crm as the approver, in one transaction with its end. */

type Context=Awaited<ReturnType<typeof context>>;
type Guard={sql:string;args:(string|number)[]};
const REQUEST='customer-edit:request',SUPERVISOR='customer-edit:supervisor-approved';
const DECISION={approved:'customer-edit:approved',rejected:'customer-edit:rejected',cancelled:'customer-edit:cancelled'} as const;
const FIRST='customer-edit:',AFTER='customer-edit;';
export const requestRowId=(memberId:string,key:string)=>FIRST+memberId+':'+key;
const supervisorRowId=(id:string)=>'customer-edit-supervisor:'+id,decisionRowId=(id:string)=>'customer-edit-decision:'+id;
/** Trusted aliases only. */
const pendingSql=(q:string)=>`NOT EXISTS (SELECT 1 FROM crm_audit ce_end WHERE ce_end.id='customer-edit-decision:'||${q}.id)`;
const supervisorPassedSql=(q:string)=>`EXISTS (SELECT 1 FROM crm_audit ce_sup WHERE ce_sup.id='customer-edit-supervisor:'||${q}.id)`;
/** The same rule as liveStage (lib/customer-edit-requests.ts), at commit. */
const awaitingSupervisorSql=(q:string)=>`(json_extract(${q}.detail,'$.stage')='supervisor' AND NOT ${supervisorPassedSql(q)} AND EXISTS (SELECT 1 FROM crm_members ce_rq JOIN crm_members ce_sv ON ce_sv.id=ce_rq.supervisor_id WHERE ce_rq.id=json_extract(${q}.detail,'$.requestedBy') AND ce_rq.role='rep' AND ce_sv.role='supervisor' AND ce_sv.active=1))`;
const supervisedBySql=(q:string)=>`EXISTS (SELECT 1 FROM crm_members ce_mine WHERE ce_mine.id=json_extract(${q}.detail,'$.requestedBy') AND ce_mine.supervisor_id=?)`;

export const CUSTOMER_EDIT_TEXT={
 nothing:'لم يتغير شيء في بيانات العميل.',
 ownPending:'لديك طلب تعديل بانتظار الموافقة على هذا العميل. ألغِه من بيانات العميل ثم أرسل التعديل الجديد.',
 otherPending:'يوجد طلب تعديل آخر على هذا العميل بانتظار الموافقة.',
 keyReused:'تم إرسال هذا الطلب من قبل. أعد فتح بيانات العميل ثم أرسل التعديل الجديد.',
 concurrent:'تم تحديث السجل بالتزامن. أعد تحميل البيانات.',
 invalid:'صيغة طلب التعديل غير صحيحة.',
 missing:'طلب التعديل غير موجود.',
 decided:'تم البت في هذا الطلب بالفعل.',
 cancelOwn:'إلغاء الطلب متاح لمن أرسله.',
 atSupervisor:'الطلب عند مشرف المندوب. يصل إلى مدير المبيعات بعد موافقة المشرف.',
 supervisorOnly:'الموافقة على هذا الطلب متاحة لمشرف المندوب.',
 managerOnly:'الموافقة على تعديل بيانات العميل متاحة لمدير المبيعات.',
 outside:'السجل خارج نطاق صلاحيتك',
 stale:'تغيرت البيانات نفسها بعد إرسال الطلب. ارفض الطلب ليعيد صاحبه إرساله على البيانات الحالية.'
} as const;

const textOf=(value:unknown)=>typeof value==='string'?value:'';
function parseObject(value:unknown):Record<string,unknown>|null{if(typeof value!=='string')return null;try{const parsed:unknown=JSON.parse(value);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed as Record<string,unknown>:null;}catch{return null;}}
/** A request row's detail, or null when it is not one this code wrote. */
export function parseHeld(detail:unknown):CustomerEditHeld|null{
 const held=parseObject(detail);
 if(!held||held.v!==1||typeof held.requestedBy!=='string'||typeof held.customerId!=='string'||!['supervisor','sales_manager'].includes(String(held.stage))||!Array.isArray(held.fields)||!held.values||typeof held.values!=='object'||!held.base||typeof held.base!=='object')return null;
 const fields=(held.fields as unknown[]).filter((field):field is CustomerEditField=>typeof field==='string'&&(CUSTOMER_EDIT_FIELDS as readonly string[]).includes(field));
 return {...(held as unknown as CustomerEditHeld),fields};
}

/** A save by a member who sends a request (lib/customer-edit-requests.ts proposesCustomerEdit), reached by POST /api/crm after every
 *  check a direct edit of the same customer passes as that member (the record and its version, the «تعديل» cell, the routing and region
 *  rules, the ERP code, the place, the schema): only the write waits. `data` is what the save would store; `permission` the direct
 *  edit's own commit guard (the member as they are, the customer at the version they read, their team), which gates the request too. */
export async function proposeCustomerEdit(c:Context,{old,data,key,permission,now}:{old:Row;data:Record<string,unknown>;key:unknown;permission:Guard;now:string}){
 const {fields,values,base}=customerEditProposal(old.data,data);
 if(!fields.length)throw new CRMError(CUSTOMER_EDIT_TEXT.nothing,400);
 const requestKey=typeof key==='string'&&z.string().uuid().safeParse(key).success?key.toLowerCase():crypto.randomUUID();
 const id=requestRowId(c.me.id,requestKey),stage=firstStage(c.me.id,c.members),fingerprint=customerEditFingerprint(old.id,fields,values);
 const held:CustomerEditHeld={v:1,requestedBy:c.me.id,key:requestKey,customerId:old.id,customerName:textOf(old.data.name),stage,fields,values,base,baseVersion:old.version,fingerprint};
 // A batch of one, as every write of /api/crm commits (a transaction).
 const [saved]=await c.db.batch([c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM crm_audit WHERE id=?) AND NOT EXISTS (SELECT 1 FROM crm_audit q WHERE q.record_id=? AND q.action=? AND ${pendingSql('q')}) AND ${permission.sql}`)
  .bind(id,old.id,c.me.name,REQUEST,JSON.stringify(held),now,id,old.id,REQUEST,...permission.args)]);
 // requestStatus: a repeated send answers with where the request stands now (it may have been decided meanwhile).
 const reply=(requestId:string,where:CustomerEditStage,alreadySaved:boolean,requestStatus:CustomerEditStatus='pending')=>Response.json({ok:true,id:old.id,requestId,pendingApproval:requestStatus==='pending',approvalStage:where,requestStatus,...(alreadySaved?{alreadySaved:true}:{})});
 if(saved.meta.changes===1)return reply(id,stage,false);
 // A repeated send after a lost answer (the same key, or the same edit while it waits) answers with what was sent; anything else is told why.
 const again=await loadRow(c.db,id),prior=again?parseHeld(again.detail):null;
 if(again&&prior&&prior.requestedBy===c.me.id&&prior.customerId===old.id&&prior.fingerprint===fingerprint)return reply(id,liveStage(prior,!!again.supervisorAt,c.members),true,statusOf(again));
 const waiting=await c.db.prepare(`SELECT q.id FROM crm_audit q WHERE q.record_id=? AND q.action=? AND ${pendingSql('q')} ORDER BY q.created_at LIMIT 1`).bind(old.id,REQUEST).first<{id:string}>();
 if(waiting){
  const other=await loadRow(c.db,waiting.id),held2=other?parseHeld(other.detail):null;
  if(other&&held2&&held2.requestedBy===c.me.id&&held2.fingerprint===fingerprint)return reply(other.id,liveStage(held2,!!other.supervisorAt,c.members),true);
  throw new CRMError(held2?.requestedBy===c.me.id?CUSTOMER_EDIT_TEXT.ownPending:CUSTOMER_EDIT_TEXT.otherPending,409);
 }
 throw new CRMError(again?CUSTOMER_EDIT_TEXT.keyReused:CUSTOMER_EDIT_TEXT.concurrent,409);
}

type RawRequest={id:string;customerId:string;actor:string;detail:string;createdAt:string;supervisorActor:string|null;supervisorDetail:string|null;supervisorAt:string|null;decision:string|null;decidedActor:string|null;decisionDetail:string|null;decidedAt:string|null};
const rawColumns=`q.id,q.record_id AS customerId,q.actor,q.detail,q.created_at AS createdAt,s.actor AS supervisorActor,s.detail AS supervisorDetail,s.created_at AS supervisorAt,d.action AS decision,d.actor AS decidedActor,d.detail AS decisionDetail,d.created_at AS decidedAt
 FROM crm_audit q LEFT JOIN crm_audit s ON s.id='customer-edit-supervisor:'||q.id LEFT JOIN crm_audit d ON d.id='customer-edit-decision:'||q.id`;
async function loadRow(db:D1Database,id:string){return db.prepare(`SELECT ${rawColumns} WHERE q.id=? AND q.action=?`).bind(id,REQUEST).first<RawRequest>();}
const statusOf=(raw:RawRequest):CustomerEditStatus=>raw.decision===DECISION.approved?'approved':raw.decision===DECISION.rejected?'rejected':raw.decision===DECISION.cancelled?'cancelled':'pending';
const nameOf=(c:Context,detail:string|null,actor:string|null)=>{const by=textOf(parseObject(detail)?.by);return c.members.find(member=>member.id===by)?.name||actor||null;};

type View={raw:RawRequest;held:CustomerEditHeld;customer:Row;status:CustomerEditStatus;atSupervisor:boolean;stale:boolean;canDecide:boolean;canCancel:boolean};
/** One request as it stands now for this reader. atSupervisor is read whatever the status (a decided request is refused by its status). */
function viewOf(c:Context,raw:RawRequest,held:CustomerEditHeld,customer:Row):View{
 const status=statusOf(raw),atSupervisor=liveStage(held,!!raw.supervisorAt,c.members)==='supervisor';
 const stale=status==='pending'&&staleFields(held,customer.data).length>0;
 const decides=status==='pending'&&(atSupervisor?c.me.role==='supervisor'&&activeSupervisorOf(held.requestedBy,c.members)?.id===c.me.id:directCustomerEditRole(c.me.role)&&can(c.me,'customer','edit')&&memberCanAccessRegion(c.me,customer.data.region));
 return {raw,held,customer,status,atSupervisor,stale,canDecide:decides,canCancel:status==='pending'&&held.requestedBy===c.me.id};
}
function projectView(c:Context,view:View):CustomerEditRequest{
 const {raw,held,customer,status}=view;
 return {
  id:raw.id,customerId:customer.id,customerName:textOf(customer.data.name)||held.customerName,requestedBy:held.requestedBy,
  requestedByName:c.members.find(member=>member.id===held.requestedBy)?.name||raw.actor,createdAt:raw.createdAt,status,
  stage:status==='pending'?(view.atSupervisor?'supervisor':'sales_manager'):null,
  supervisorName:raw.supervisorAt?nameOf(c,raw.supervisorDetail,raw.supervisorActor):null,supervisorAt:raw.supervisorAt||null,
  decidedByName:status==='pending'?null:nameOf(c,raw.decisionDetail,raw.decidedActor),decidedAt:raw.decidedAt||null,
  note:status==='rejected'?textOf(parseObject(raw.decisionDetail)?.note):'',stale:view.stale,
  changes:customerEditChanges(held,status==='pending'?customer.data:null),
  mine:held.requestedBy===c.me.id,canDecide:view.canDecide,canCancel:view.canCancel
 };
}

/** GET /api/customer-edits. Without a customer, the first screen's list: what this reader may decide now (a supervisor their
 *  representatives' requests waiting for them; the sales manager and the administrator, within their regions and while «تعديل» on
 *  «العملاء» is theirs, what has passed the supervisor or never needed one) and their own requests, waiting or decided in the last 14 days.
 *  With a customer, that customer's: every request for the sales manager and the administrator (within their regions), and for anyone
 *  else their own and, for a supervisor, their representatives' waiting for them. Nobody reads another's request otherwise. */
export async function listCustomerEdits(c:Context,customerId:string|null):Promise<CustomerEditList>{
 const since=new Date(Date.now()-CUSTOMER_EDITS_RECENT_DAYS*86_400_000).toISOString();
 const rows=(await c.db.prepare(`SELECT ${rawColumns} WHERE q.id>=? AND q.id<? AND q.action=?${customerId?' AND q.record_id=?':' AND (d.id IS NULL OR d.created_at>=?)'} ORDER BY (d.id IS NULL) DESC,COALESCE(d.created_at,q.created_at) DESC,q.id DESC LIMIT 500`)
  .bind(FIRST,AFTER,REQUEST,customerId||since).all<RawRequest>()).results;
 // Only the customers these requests name are read (the route loads no records: the list is asked every few minutes by every member).
 const ids=[...new Set(rows.map(raw=>raw.customerId))];
 const customers=new Map<string,Row>(ids.length?(await c.db.prepare("SELECT id,kind,parent_id AS parentId,assigned_to AS assignedTo,branch,data,created_at AS createdAt,updated_at AS updatedAt,version FROM crm_records WHERE kind='customer' AND id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ids)).all<Omit<Row,'data'>&{data:string}>()).results.map(row=>[row.id,{...row,data:parseObject(row.data)||{}} as Row]):[]);
 const requests:CustomerEditRequest[]=[];
 for(const raw of rows){
  const held=parseHeld(raw.detail),customer=held?customers.get(held.customerId):undefined;
  if(!held||!customer)continue;
  const view=viewOf(c,raw,held,customer),inRegion=memberCanAccessRegion(c.me,customer.data.region),mine=held.requestedBy===c.me.id;
  const management=directCustomerEditRole(c.me.role)&&inRegion;
  const team=view.status==='pending'&&view.atSupervisor&&view.canDecide;
  const shown=customerId?management||mine&&inRegion||team:team||mine&&inRegion||view.status==='pending'&&!view.atSupervisor&&view.canDecide;
  if(shown)requests.push(projectView(c,view));
 }
 requests.sort((a,b)=>Number(b.status==='pending')-Number(a.status==='pending')||Number(b.canDecide)-Number(a.canDecide)||(b.decidedAt||b.createdAt).localeCompare(a.decidedAt||a.createdAt));
 return {me:c.me.id,waiting:requests.filter(request=>request.canDecide).length,requests};
}

const decisionInput=z.object({action:z.literal('customer-edit'),decision:z.enum(['approve','reject','cancel']),id:z.string().min(FIRST.length+1).max(300).startsWith(FIRST),note:z.unknown().optional()}).strict();
/** What an approval adds to the ordinary customer save (app/api/crm/route.ts saveRecord), in its transaction. */
export type CustomerEditApproval={requestId:string;guard:Guard;statements:(gate:string,gateArgs:(string|number)[],at:string)=>D1PreparedStatement[];refused:()=>Promise<never>};
type Save=(body:Record<string,unknown>,approval:CustomerEditApproval)=>Promise<Response>;
/** POST /api/crm {action:'customer-edit',decision:'approve'|'reject'|'cancel',id,note?}. Cancel: the sender, at either step. While the
 *  request is with the supervisor: approve (passes it on) or reject, by that supervisor only; the sales manager and the administrator are
 *  refused. After: approve (applies it through the ordinary save, as the approver) or reject, by the sales manager or the administrator,
 *  within their regions and with «تعديل» on «العملاء». A rejection needs its reason. A stale request is not approved at either step. */
export async function decideCustomerEdit(c:Context,body:Record<string,unknown>,save:Save){
 const parsed=decisionInput.safeParse(body);if(!parsed.success)throw new CRMError(CUSTOMER_EDIT_TEXT.invalid,400);
 const p=parsed.data;let note='';
 if(p.decision==='reject'){const reason=rejectReason(p.note);if(!reason.ok)throw new CRMError(reason.error,400);note=reason.note;}
 const raw=await loadRow(c.db,p.id),held=raw?parseHeld(raw.detail):null,customer=held?c.all.find(row=>row.id===held.customerId&&row.kind==='customer'):undefined;
 if(!raw||!held||!customer)throw new CRMError(CUSTOMER_EDIT_TEXT.missing,404);
 const view=viewOf(c,raw,held,customer);
 if(p.decision==='cancel'){if(held.requestedBy!==c.me.id)throw new CRMError(CUSTOMER_EDIT_TEXT.cancelOwn,403);}
 else if(view.atSupervisor){if(c.me.role!=='supervisor'||activeSupervisorOf(held.requestedBy,c.members)?.id!==c.me.id)throw new CRMError(directCustomerEditRole(c.me.role)?CUSTOMER_EDIT_TEXT.atSupervisor:CUSTOMER_EDIT_TEXT.supervisorOnly,403);}
 else{
  if(!directCustomerEditRole(c.me.role))throw new CRMError(CUSTOMER_EDIT_TEXT.managerOnly,403);
  requireCell(c.me,'customer','edit');
  if(!memberCanAccessRegion(c.me,customer.data.region))throw new CRMError(CUSTOMER_EDIT_TEXT.outside,403);
 }
 if(view.status!=='pending')throw new CRMError(CUSTOMER_EDIT_TEXT.decided,409);
 const now=new Date().toISOString(),actor=accessGuard(c),customerName=textOf(customer.data.name)||held.customerName;
 const waitingHere=(extra:string)=>`EXISTS (SELECT 1 FROM crm_audit q WHERE q.id=? AND q.action=? AND ${pendingSql('q')}${extra})`;
 const insert=async(id:string,action:string,detail:Record<string,unknown>,where:string,whereArgs:(string|number)[])=>(await c.db.batch([c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${where} AND ${actor.sql}`)
  .bind(id,customer.id,c.me.name,action,JSON.stringify({by:c.me.id,requestId:p.id,requestedBy:held.requestedBy,customerName,...detail}),now,...whereArgs,...actor.args)]))[0];
 if(p.decision==='approve'&&view.atSupervisor){
  // The supervisor's approval passes it on: the customer waits for the sales manager.
  if(view.stale)throw new CRMError(CUSTOMER_EDIT_TEXT.stale,409);
  const passed=await insert(supervisorRowId(p.id),SUPERVISOR,{},waitingHere(` AND ${awaitingSupervisorSql('q')} AND ${supervisedBySql('q')}`),[p.id,REQUEST,c.me.id]);
  if(passed.meta.changes!==1)throw new CRMError(CUSTOMER_EDIT_TEXT.decided,409);
  return Response.json({ok:true,id:p.id,status:'pending',stage:'sales_manager'});
 }
 if(p.decision!=='approve'){
  // A rejection is decided where the request stands now: by the supervisor while it is with them, by the sales manager after.
  const status=p.decision==='reject'?'rejected':'cancelled';
  const [extra,args]:[string,(string|number)[]]=p.decision==='cancel'?[` AND json_extract(q.detail,'$.requestedBy')=?`,[c.me.id]]:view.atSupervisor?[` AND ${awaitingSupervisorSql('q')} AND ${supervisedBySql('q')}`,[c.me.id]]:[` AND NOT ${awaitingSupervisorSql('q')}`,[]];
  const done=await insert(decisionRowId(p.id),DECISION[status],status==='rejected'?{note,stage:view.atSupervisor?'supervisor':'sales_manager'}:{stage:view.atSupervisor?'supervisor':'sales_manager'},waitingHere(extra),[p.id,REQUEST,...args]);
  if(done.meta.changes!==1)throw new CRMError(CUSTOMER_EDIT_TEXT.decided,409);
  return Response.json({ok:true,id:p.id,status});
 }
 if(view.stale)throw new CRMError(CUSTOMER_EDIT_TEXT.stale,409);
 // Approval: the request's fields over the customer as it is now, through the ordinary save as the approver (every rule of a direct
 // edit applies again), the routing left as stored; its end is written in the same transaction, only while it still waits.
 const data=applyCustomerEdit(customer.data,held);delete data.assignedTo;delete data.branch;
 return save({action:'save',kind:'customer',id:customer.id,version:customer.version,data},{
  requestId:p.id,
  guard:{sql:waitingHere(` AND NOT ${awaitingSupervisorSql('q')}`),args:[p.id,REQUEST]},
  statements:(gate,gateArgs,at)=>[c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`)
   .bind(decisionRowId(p.id),customer.id,c.me.name,DECISION.approved,JSON.stringify({by:c.me.id,requestId:p.id,requestedBy:held.requestedBy,customerName,fields:held.fields,values:held.values}),at,...gateArgs)],
  refused:async()=>{const again=await loadRow(c.db,p.id);throw new CRMError(again&&statusOf(again)!=='pending'?CUSTOMER_EDIT_TEXT.decided:CUSTOMER_EDIT_TEXT.concurrent,409);}
 });
}

/** «سجل التغييرات» of a customer (GET /api/crm): a step of a request reads as words and the customer's name, never its fields or reason. */
export function customerEditHistoryEntry<T extends {action:string;detail:string}>(entry:T):T{
 const label=CUSTOMER_EDIT_HISTORY[entry.action];
 return label?{...entry,action:label,detail:textOf(parseObject(entry.detail)?.customerName)}:entry;
}
