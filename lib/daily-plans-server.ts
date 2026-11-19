import {z} from 'zod';
import {CRMError,accessGuard} from './crm-server';
import {can,pageAllowed} from './permissions';
import {salesScopeMemberIds,recordAuthorId} from './access';
import {memberCanAccessRegion,regionScope,regionScopesOverlap} from './regions';
import {visitCustomer} from './customer-visits';
import {journeyDate} from './journeys';
import {offlineCapture} from './offline-server';
import {FIELD_ROLES_SQL,isFieldRole} from './roles';
import {isServiceRole} from './customer-service';
import type {Member,Row} from './crm';
import type {JourneyContext} from './journeys-server';
import {PLAN_EXPORT_MAX_DAYS,PLAN_MESSAGES,PLAN_NOTE_MAX,PLAN_NOTE_MIN,PLAN_REASON_MAX,PLAN_REASON_MIN,PLAN_AHEAD_DAYS,addDays,isPlanWorkingDay,memberLockProblems,memberMayEdit,memberStops,nextPlanDay,parsePlanStops,planCompletion,planDateProblem,planDay,planDeadline,planLate,planSentAt,planText,preparesPlans,reviewerMayApprove,reviewerMayEdit,reviewerMayReturn,reviewerStops,reviewsPlans,type PlanActivity,type PlanCounts,type PlanExport,type PlanInbox,type PlanInboxDay,type PlanList,type PlanListRow,type PlanNoteView,type PlanState,type PlanStatus,type PlanStopInput,type PlanView,type StoredStop,type SupervisorState} from './daily-plans';

/** Server side of «خطة الغد» and «خطط المناديب» (lib/daily-plans.ts, migration 0022). Who:
 * - the member (a representative or a marketing officer, lib/roles.ts) prepares, saves and sends their OWN plan («خطط المناديب · إضافة»);
 * - a reviewer (the administrator, a sales manager, a supervisor) reads the plans of the field members of their sales team whose regions
 *   meet theirs (lib/access.ts salesScopeMemberIds, wider for reading with «عرض بيانات الفريق بالكامل»), and approves, approves with edits,
 *   returns and notes those of their team as the role defines it («خطط المناديب · تحرير»); never their own.
 * Every write names the plan's version it was made on (`baseVersion`: null for a new plan; another is 409), is re-checked at commit (the
 * writer's role, region, supervisor and permissions unchanged, accessGuard; for a reviewer the member still in their team; the customers
 * still there) and audited in crm_audit with an action 'daily-plan:…' (kept out of GET /api/crm's recent changes): the audit row is the
 * request's receipt, so a retry answers with the plan as it is and the same key with other contents is 409. The plan never blocks the
 * recording of visits and contacts: no other route reads it. */

const ID=/^[A-Za-z0-9_:.@-]{1,200}$/;
const identifier=z.string().regex(ID);
const requestId=z.string().uuid();
const day=z.string().refine(value=>!!planDay(value));
const version=z.number().int().positive();
const memberSchema=z.object({action:z.enum(['save','send']),date:day,stops:z.unknown(),baseVersion:version.nullable(),requestId,offline:z.unknown().optional()}).strict();
const reviewSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('approve'),memberId:identifier,date:day,baseVersion:version,requestId}).strict(),
 z.object({action:z.literal('approve_edited'),memberId:identifier,date:day,baseVersion:version,stops:z.unknown(),requestId}).strict(),
 z.object({action:z.literal('return'),memberId:identifier,date:day,baseVersion:version,reason:z.unknown(),requestId}).strict(),
 z.object({action:z.literal('note'),memberId:identifier,date:day,note:z.unknown(),noteVersion:version.nullable(),requestId}).strict()
]);
export const PLAN_AUDIT_PREFIX='daily-plan:';
export const planId=(memberId:string,date:string)=>'daily-plan:'+memberId+':'+date;

type PlanRow={id:string;memberId:string;date:string;status:PlanStatus;version:number;firstSentAt:string|null;firstSentSource:'device'|'server'|null;late:number;sentAt:string|null;receivedAt:string|null;reviewedBy:string|null;reviewedAt:string|null;returnReason:string;mutationId:string;createdAt:string;updatedAt:string};
const planColumns='id,member_id AS memberId,date,status,version,first_sent_at AS firstSentAt,first_sent_source AS firstSentSource,late,sent_at AS sentAt,received_at AS receivedAt,reviewed_by AS reviewedBy,reviewed_at AS reviewedAt,return_reason AS returnReason,mutation_id AS mutationId,created_at AS createdAt,updated_at AS updatedAt';
const stopColumns='id,plan_id AS planId,position,customer_id AS customerId,kind,planned_time AS time,note,added_by AS addedBy,supervisor_state AS supervisorState,edited_by AS editedBy,created_at AS createdAt';
type NoteRow={memberId:string;date:string;reviewerId:string;note:string;version:number;updatedAt:string};

/** The members whose plans the reader reviews: the field members of their sales team (read: wider with «عرض بيانات الفريق بالكامل»)
 *  whose regions meet the reader's, never the reader. */
export function planTeam(c:Pick<JourneyContext,'me'|'members'>,{read=false}:{read?:boolean}={}):Member[]{
 if(!reviewsPlans(c.me))return [];
 const scope=salesScopeMemberIds(c.members,c.me,{read});
 return c.members.filter(member=>member.id!==c.me.id&&isFieldRole(member.role)&&scope.has(member.id)&&regionScopesOverlap(regionScope(c.me),regionScope(member)));
}
/** At commit: the member is still a field member of the reviewer's team (a supervisor's own representative; any for a sales manager or the
 *  administrator), as accessGuard's reporting line. */
function reviewerGate(me:Member,memberId:string):{sql:string;args:string[]}{
 if(me.role==='supervisor')return {sql:`EXISTS (SELECT 1 FROM crm_members WHERE id=? AND id<>? AND role IN ${FIELD_ROLES_SQL} AND supervisor_id=?)`,args:[memberId,me.id,me.id]};
 return {sql:`EXISTS (SELECT 1 FROM crm_members WHERE id=? AND id<>? AND role IN ${FIELD_ROLES_SQL})`,args:[memberId,me.id]};
}

async function readPlans(db:D1Database,pairs:readonly [string,string][]):Promise<Map<string,PlanRow>>{
 if(!pairs.length)return new Map();
 const ids=[...new Set(pairs.map(([member,date])=>planId(member,date)))];
 const rows=(await db.prepare(`SELECT ${planColumns} FROM crm_daily_plans WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)).all<PlanRow>()).results;
 return new Map(rows.map(row=>[row.id,{...row,version:Number(row.version),late:Number(row.late)}]));
}
async function readStops(db:D1Database,planIds:readonly string[]):Promise<Map<string,StoredStop[]>>{
 const out=new Map<string,StoredStop[]>();if(!planIds.length)return out;
 const rows=(await db.prepare(`SELECT ${stopColumns} FROM crm_daily_plan_stops WHERE plan_id IN (SELECT value FROM json_each(?)) ORDER BY plan_id,position,created_at,id`).bind(JSON.stringify([...new Set(planIds)])).all<StoredStop&{planId:string}>()).results;
 for(const {planId:owner,...row} of rows){const list=out.get(owner)||[];list.push({...row,position:Number(row.position),editedBy:row.editedBy??null,supervisorState:(row.supervisorState||'') as SupervisorState});out.set(owner,list);}
 return out;
}
async function readNotes(db:D1Database,pairs:readonly [string,string][]):Promise<Map<string,NoteRow[]>>{
 const out=new Map<string,NoteRow[]>();if(!pairs.length)return out;
 const members=[...new Set(pairs.map(([member])=>member))],dates=[...new Set(pairs.map(([,date])=>date))];
 const rows=(await db.prepare('SELECT member_id AS memberId,date,reviewer_id AS reviewerId,note,version,updated_at AS updatedAt FROM crm_daily_plan_notes WHERE member_id IN (SELECT value FROM json_each(?)) AND date IN (SELECT value FROM json_each(?)) ORDER BY updated_at,reviewer_id').bind(JSON.stringify(members),JSON.stringify(dates)).all<NoteRow>()).results;
 for(const row of rows){const key=row.memberId+'|'+row.date,list=out.get(key)||[];list.push({...row,version:Number(row.version)});out.set(key,list);}
 return out;
}
/** When a visit or contact was recorded: the device's time for one saved on the device, else the server's (as the day report orders them). */
const recordedAt=(row:Row)=>typeof row.data.offlineRecordedAt==='string'&&Number.isFinite(Date.parse(row.data.offlineRecordedAt))?row.data.offlineRecordedAt:row.createdAt;
/** The visits and contacts each member recorded on each day, among what the reader sees (the day report's own: an activity of the member,
 *  on its day, with its customer; never a customer-service registration). */
function dayActivities(c:Pick<JourneyContext,'visible'|'members'>,pairs:readonly [string,string][]):Map<string,PlanActivity[]>{
 const wanted=new Set(pairs.map(([member,date])=>member+'|'+date)),out=new Map<string,PlanActivity[]>();
 if(!wanted.size)return out;
 for(const row of c.visible){
  if(row.kind!=='activity'||row.data.visitWorkflow==='service-intake-v1'||row.data._offlineState)continue;
  const date=row.data.date||journeyDate(row.createdAt),author=recordAuthorId(row,c.members);
  if(!author||!wanted.has(author+'|'+date))continue;
  const customer=visitCustomer(row,c.visible);if(!customer)continue;
  const key=author+'|'+date,list=out.get(key)||[];list.push({id:row.id,customerId:customer.id,type:String(row.data.type||''),at:recordedAt(row)});out.set(key,list);
 }
 return out;
}

type Reader={own:boolean;reviewer:boolean;writeTeam:boolean};
function readerOf(c:Pick<JourneyContext,'me'|'members'>,memberId:string,writeTeam?:ReadonlySet<string>):Reader{
 const own=c.me.id===memberId,team=writeTeam||new Set(planTeam(c).map(member=>member.id));
 return {own,reviewer:!own&&reviewsPlans(c.me),writeTeam:!own&&team.has(memberId)};
}
const emptyCounts:PlanCounts={stops:0,done:0,doneOther:0,open:0,removed:0,outside:0,extra:0};

/** The plans of these members and days as the reader sees them: one PlanView each, in the order asked. */
async function planViews(c:JourneyContext,pairs:readonly [string,string][],now:string):Promise<PlanView[]>{
 const today=journeyDate(now),plans=await readPlans(c.db,pairs);
 const stops=await readStops(c.db,[...plans.values()].map(plan=>plan.id)),notes=await readNotes(c.db,pairs);
 const activities=dayActivities(c,pairs.filter(([,date])=>date<=today));
 const customers=new Map(c.visible.filter(row=>row.kind==='customer').map(row=>[row.id,row]));
 const names=new Map(c.members.map(member=>[member.id,member.name]));
 const writeTeam=new Set(planTeam(c).map(member=>member.id));
 return pairs.map(([memberId,date])=>{
  const member=c.members.find(item=>item.id===memberId),reader=readerOf(c,memberId,writeTeam),applies=!!member&&isFieldRole(member.role);
  const stored=plans.get(planId(memberId,date));
  // A draft is the member's own until it is sent: a reviewer reads «لم تُرسل».
  const plan=stored&&(stored.status!=='draft'||reader.own)?stored:undefined;
  const planStops=plan?stops.get(plan.id)||[]:[];
  const completion=planCompletion(planStops,activities.get(memberId+'|'+date)||[]);
  const outcome=new Map(completion.stops.map(stop=>[stop.id,stop]));
  const noteRows=(notes.get(memberId+'|'+date)||[]).map(row=>({reviewerId:row.reviewerId,reviewerName:names.get(row.reviewerId)||'',note:row.note,version:row.version,updatedAt:row.updatedAt}) satisfies PlanNoteView);
  const status=plan?.status??null,state:PlanState=plan?plan.status:'missing',future=planDateProblem(date,today);
  const plannable=future===null,editable=reader.writeTeam&&can(c.me,'plans','edit')&&date>=today;
  return {ok:true,memberId,memberName:member?.name||'',date,applies,id:plan?.id??null,state,status,version:plan?.version??null,late:!!plan?.late,deadline:planDeadline(date),
   firstSentAt:plan?.firstSentAt??null,firstSentSource:plan?.firstSentSource??null,sentAt:plan?.sentAt??null,reviewedByName:plan?.reviewedBy?names.get(plan.reviewedBy)||'':'',reviewedAt:plan?.reviewedAt??null,returnReason:plan?.returnReason||'',updatedAt:plan?.updatedAt??null,
   stops:planStops.map(stop=>{const done=outcome.get(stop.id);return {id:stop.id,position:stop.position,customerId:stop.customerId,customerName:customers.get(stop.customerId)?.data.name||'',kind:stop.kind,time:stop.time,note:stop.note,addedBy:stop.addedBy,addedByName:names.get(stop.addedBy)||'',supervisorState:stop.supervisorState,editedByName:stop.editedBy?names.get(stop.editedBy)||'':'',completion:done?.state||'open',activityId:done?.activityId??null,activityType:done?.activityType??null,doneAt:done?.at??null};}),
   activities:completion.activities.filter(item=>item.place!=='planned').map(item=>({id:item.id,customerId:item.customerId,customerName:customers.get(item.customerId)?.data.name||'',type:item.type,at:item.at,place:item.place as 'outside'|'extra'})),
   counts:plan?completion.counts:{...emptyCounts,outside:completion.counts.outside,extra:completion.counts.extra},notes:reader.own||reader.reviewer?noteRows:[],
   canEdit:reader.own&&applies&&preparesPlans(c.me)&&can(c.me,'plans','add')&&memberMayEdit(status)&&plannable,
   canApprove:editable&&reviewerMayApprove(status),canReviewEdit:editable&&reviewerMayEdit(status),canReturn:editable&&reviewerMayReturn(status),
   canNote:reader.writeTeam&&can(c.me,'plans','edit')&&date<=addDays(today,PLAN_AHEAD_DAYS),myNote:noteRows.find(note=>note.reviewerId===c.me.id)||null,serverTime:now} satisfies PlanView;
 });
}

/** GET /api/daily-plans?date=&memberId=: one member's plan of one day, for the member or a reviewer who reads it. */
export async function readPlanView(c:JourneyContext,memberId:string,date:string,now=new Date().toISOString()):Promise<PlanView>{
 if(memberId!==c.me.id&&!planTeam(c,{read:true}).some(member=>member.id===memberId))throw new CRMError(PLAN_MESSAGES.scope,403);
 if(memberId===c.me.id&&!isFieldRole(c.me.role)&&!reviewsPlans(c.me))throw new CRMError(PLAN_MESSAGES.notField,403);
 return (await planViews(c,[[memberId,date]],now))[0];
}

/** GET /api/daily-plans?date= (a reviewer): every field member of the reader's team on that day (the active ones, and an inactive one who
 *  has a plan), the plans waiting first, then the ones missing after the deadline, then by name. */
export async function readPlanList(c:JourneyContext,date:string,now=new Date().toISOString()):Promise<PlanList>{
 if(!reviewsPlans(c.me))throw new CRMError(PLAN_MESSAGES.reviewRole,403);
 const team=planTeam(c,{read:true}),plans=await readPlans(c.db,team.map(member=>[member.id,date]));
 const members=team.filter(member=>member.active||plans.has(planId(member.id,date)));
 const views=await planViews(c,members.map(member=>[member.id,date]),now),overdue=Date.parse(now)>=Date.parse(planDeadline(date))&&isPlanWorkingDay(date);
 const rows:PlanListRow[]=views.map((view,index)=>({memberId:view.memberId,name:view.memberName,role:members[index].role,state:view.state,version:view.version,late:view.late,overdue:view.state==='missing'&&overdue,firstSentAt:view.firstSentAt,reviewedByName:view.reviewedByName,counts:view.counts,notes:view.notes.length}));
 const rank=(row:PlanListRow)=>row.state==='sent'?0:row.overdue?1:row.state==='returned'?2:row.state==='missing'?3:4;
 rows.sort((a,b)=>rank(a)-rank(b)||a.name.localeCompare(b.name,'ar')||a.memberId.localeCompare(b.memberId));
 return {ok:true,date,deadline:planDeadline(date),workingDay:isPlanWorkingDay(date),rows,serverTime:now};
}

/** GET /api/daily-plans?from=&to= (a reviewer with «خطط المناديب · تصدير»): every plan of the reader's team in the days (at most 31), with
 *  the working days without one, for the Excel file (app/daily-plans.tsx). */
export async function readPlanExport(c:JourneyContext,from:string,to:string,now=new Date().toISOString()):Promise<PlanExport>{
 if(!reviewsPlans(c.me))throw new CRMError(PLAN_MESSAGES.reviewRole,403);
 if(!planDay(from)||!planDay(to)||from>to||(Date.parse(to)-Date.parse(from))/86_400_000>=PLAN_EXPORT_MAX_DAYS)throw new CRMError(PLAN_MESSAGES.range,400);
 const team=planTeam(c,{read:true}),days:string[]=[];for(let date=from;date<=to;date=addDays(date,1))days.push(date);
 const asked=team.flatMap(member=>days.map(date=>[member.id,date] as [string,string]));
 const plans=await readPlans(c.db,asked);
 const pairs=asked.filter(([memberId,date])=>{const plan=plans.get(planId(memberId,date));return plan&&plan.status!=='draft'||team.find(member=>member.id===memberId)?.active&&isPlanWorkingDay(date)&&date<=journeyDate(now);});
 pairs.sort((a,b)=>a[1].localeCompare(b[1])||(team.find(m=>m.id===a[0])?.name||'').localeCompare(team.find(m=>m.id===b[0])?.name||'','ar'));
 return {ok:true,from,to,plans:await planViews(c,pairs,now)};
}

/** GET /api/daily-plans/inbox (the reminder cards). Reads plans only, never the records. */
export async function readPlanInbox(c:Pick<JourneyContext,'db'|'me'|'members'>,now=new Date().toISOString()):Promise<PlanInbox>{
 const today=journeyDate(now),next=nextPlanDay(today),names=new Map(c.members.map(member=>[member.id,member.name]));
 if(isServiceRole(c.me.role)||!pageAllowed(c.me,'plans'))return {ok:true,serverTime:now,role:'none'};
 const summary=(date:string,plan:PlanRow|undefined):PlanInboxDay=>({date,state:plan?plan.status:'missing',late:!!plan?.late,deadline:planDeadline(date),version:plan?.version??null,returnReason:plan?.returnReason||'',reviewedByName:plan?.reviewedBy?names.get(plan.reviewedBy)||'':''});
 if(preparesPlans(c.me)&&can(c.me,'plans','add')){
  const plans=await readPlans(c.db,[[c.me.id,today],[c.me.id,next]]);
  return {ok:true,serverTime:now,role:'member',next:summary(next,plans.get(planId(c.me.id,next))),today:isPlanWorkingDay(today)?summary(today,plans.get(planId(c.me.id,today))):null};
 }
 if(reviewsPlans(c.me)&&can(c.me,'plans','edit')){
  const team=planTeam(c).filter(member=>member.active);
  const rows=team.length?(await c.db.prepare(`SELECT ${planColumns} FROM crm_daily_plans WHERE member_id IN (SELECT value FROM json_each(?)) AND date>=? AND status IN ('sent','approved','approved_edited','returned') ORDER BY date,first_sent_at,id`).bind(JSON.stringify(team.map(member=>member.id)),today).all<PlanRow>()).results:[];
  const pending=rows.filter(row=>row.status==='sent').slice(0,50).map(row=>({memberId:row.memberId,name:names.get(row.memberId)||'',date:row.date,late:!!Number(row.late),firstSentAt:row.firstSentAt,version:Number(row.version)}));
  const date=Date.parse(now)>=Date.parse(planDeadline(next))?next:isPlanWorkingDay(today)?today:'';
  const sent=new Set(rows.filter(row=>row.date===date).map(row=>row.memberId));
  const missing=date?team.filter(member=>!sent.has(member.id)).map(member=>member.name).sort((a,b)=>a.localeCompare(b,'ar')):[];
  return {ok:true,serverTime:now,role:'reviewer',pending,...(date?{missing:{date,names:missing}}:{})};
 }
 return {ok:true,serverTime:now,role:'none'};
}

// ---- writes
const stopProblemText={list:PLAN_MESSAGES.invalid,count:PLAN_MESSAGES.count,customer:PLAN_MESSAGES.customer,kind:PLAN_MESSAGES.kind,time:PLAN_MESSAGES.time,note:PLAN_MESSAGES.note} as const;
function checkedStops(value:unknown,min:number):PlanStopInput[]{
 const parsed=parsePlanStops(value,{min});
 if(!parsed.ok)throw new CRMError(stopProblemText[parsed.problem],400,parsed.index>=0?{stop:parsed.index}:undefined);
 return parsed.stops;
}
/** The customers of the stops this writer adds or changes: each one the writer sees, in the plan member's regions. Returns their ids, which
 *  the commit checks again (customerGate: still there). */
function checkCustomers(c:JourneyContext,stops:readonly PlanStopInput[],member:Member):string[]{
 const customers=new Map(c.visible.filter(row=>row.kind==='customer').map(row=>[row.id,row]));
 stops.forEach((stop,index)=>{const customer=customers.get(stop.customerId);if(!customer||!memberCanAccessRegion(c.me,customer.data.region)||!memberCanAccessRegion(member,customer.data.region))throw new CRMError(PLAN_MESSAGES.customer,403,{stop:index});});
 return [...new Set(stops.map(stop=>stop.customerId))];
}
const customerGate=(ids:readonly string[])=>({sql:"(SELECT COUNT(*) FROM crm_records WHERE kind='customer' AND id IN (SELECT value FROM json_each(?)))=?",args:[JSON.stringify(ids),ids.length] as (string|number)[]});
const canonical=(stops:readonly PlanStopInput[])=>stops.map(stop=>({id:stop.id||'',customerId:stop.customerId,kind:stop.kind,time:stop.time,note:stop.note}));
type Answer={ok:true;id:string;plan:PlanView};

/** The receipt of a request (its audit row, id `daily-plan:<writer>:<requestId>`): the same request answers with the plan as it is now; the
 *  same key with other contents is a conflict. */
async function receiptOf(c:JourneyContext,mutation:string,request:unknown,answer:()=>Promise<Answer>,conflict:string):Promise<Answer|null>{
 const row=await c.db.prepare('SELECT detail FROM crm_audit WHERE id=?').bind(mutation).first<{detail:string}>();if(!row)return null;
 let stored:unknown;try{stored=JSON.parse(row.detail)?.request;}catch{stored=null;}
 if(JSON.stringify(stored)!==JSON.stringify(request))throw new CRMError(conflict,409);
 return answer();
}
function stopRows(stops:readonly StoredStop[]){return JSON.stringify(stops.map(stop=>({id:stop.id,position:stop.position,customerId:stop.customerId,kind:stop.kind,time:stop.time,note:stop.note,addedBy:stop.addedBy,supervisorState:stop.supervisorState,editedBy:stop.editedBy,createdAt:stop.createdAt})));}
/** The statements that replace a plan's stops, run only when the plan row was written by this request (its mutation id). */
function replaceStops(c:JourneyContext,id:string,mutation:string,stops:readonly StoredStop[],at:string){
 const written='EXISTS (SELECT 1 FROM crm_daily_plans WHERE id=? AND mutation_id=?)';
 return [
  c.db.prepare(`DELETE FROM crm_daily_plan_stops WHERE plan_id=? AND ${written}`).bind(id,id,mutation),
  c.db.prepare(`INSERT INTO crm_daily_plan_stops(id,plan_id,position,customer_id,kind,planned_time,note,added_by,supervisor_state,edited_by,created_at,updated_at)
   SELECT json_extract(value,'$.id'),?,json_extract(value,'$.position'),json_extract(value,'$.customerId'),json_extract(value,'$.kind'),json_extract(value,'$.time'),json_extract(value,'$.note'),json_extract(value,'$.addedBy'),json_extract(value,'$.supervisorState'),json_extract(value,'$.editedBy'),json_extract(value,'$.createdAt'),? FROM json_each(?) WHERE ${written}`).bind(id,at,stopRows(stops),id,mutation)
 ];
}
function auditStatement(c:JourneyContext,mutation:string,recordId:string,action:string,detail:unknown,at:string,written:{sql:string;args:string[]}){
 return c.db.prepare(`INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE ${written.sql}`).bind(mutation,recordId,c.me.name,PLAN_AUDIT_PREFIX+action,JSON.stringify(detail),at,...written.args);
}

/** POST {action:'save'|'send', date, stops, baseVersion, requestId, offline?}: the member's own plan. «حفظ مسودة» keeps a draft the reviewers
 *  do not see; «إرسال» sends it (again after a return or before a decision). A send kept on the device carries the device's clock
 *  (offline.capturedAt, lib/offline-server.ts offlineCapture), which is when it was sent while within the bounds (lib/daily-plans.ts
 *  planSentAt); the first send decides «متأخرة». */
export async function writeMemberPlan(c:JourneyContext,body:unknown,receivedAt=new Date().toISOString()):Promise<Answer>{
 if(!preparesPlans(c.me))throw new CRMError(PLAN_MESSAGES.role,403);
 const parsed=memberSchema.safeParse(body);if(!parsed.success)throw new CRMError(PLAN_MESSAGES.invalid,400);
 const p=parsed.data,today=journeyDate(receivedAt),problem=planDateProblem(p.date,today);
 if(problem==='past')throw new CRMError(PLAN_MESSAGES.past,409);
 if(problem)throw new CRMError(PLAN_MESSAGES.date,400);
 const capture=p.action==='send'?offlineCapture(body as Record<string,unknown>,c.me.id,receivedAt):null;
 const sent=checkedStops(p.stops,p.action==='send'?1:0);
 const id=planId(c.me.id,p.date),mutation=PLAN_AUDIT_PREFIX+c.me.id+':'+p.requestId;
 const request={action:p.action,memberId:c.me.id,date:p.date,baseVersion:p.baseVersion,stops:canonical(sent)};
 const answer=async():Promise<Answer>=>({ok:true,id,plan:(await planViews(c,[[c.me.id,p.date]],new Date().toISOString()))[0]});
 const replay=await receiptOf(c,mutation,request,answer,PLAN_MESSAGES.conflict);if(replay)return replay;
 const plan=(await readPlans(c.db,[[c.me.id,p.date]])).get(id),existing=plan?(await readStops(c.db,[id])).get(id)||[]:[];
 if((plan?.version??null)!==p.baseVersion)throw new CRMError(PLAN_MESSAGES.conflict,409);
 if(!memberMayEdit(plan?.status??null))throw new CRMError(PLAN_MESSAGES.approved,409);
 if(p.action==='save'&&plan&&plan.status!=='draft')throw new CRMError(PLAN_MESSAGES.sentNoDraft,409);
 if(memberLockProblems(existing,sent).length)throw new CRMError(PLAN_MESSAGES.locked,403);
 // A stop the member adds or changes is checked against what they see; the locked ones were checked when the reviewer wrote them.
 const lockedIds=new Set(existing.filter(stop=>stop.supervisorState!=='').map(stop=>stop.id));
 const checked=checkCustomers(c,sent.filter(stop=>!stop.id||!lockedIds.has(stop.id)),c.me);
 const stops=memberStops(existing,sent,c.me.id,receivedAt,()=>crypto.randomUUID());
 const sending=p.action==='send',sentAt=sending?planSentAt(capture,receivedAt):null,first=sending&&!plan?.firstSentAt;
 const firstSentAt=plan?.firstSentAt??(first?sentAt!.at:null),firstSource=plan?.firstSentSource??(first?sentAt!.source:null),late=plan?.firstSentAt?plan.late:first?Number(planLate(sentAt!.at,p.date)):0;
 const status:PlanStatus=sending?'sent':'draft';
 const guard=accessGuard(c),customers=customerGate(checked),gate=guard.sql+' AND '+customers.sql,gateArgs=[...guard.args,...customers.args];
 const write=plan
  ?c.db.prepare(`UPDATE crm_daily_plans SET status=?,version=version+1,first_sent_at=?,first_sent_source=?,late=?,sent_at=?,received_at=?,reviewed_by=NULL,reviewed_at=NULL,return_reason='',mutation_id=?,updated_at=? WHERE id=? AND version=? AND ${gate}`)
    .bind(status,firstSentAt,firstSource,late,sending?sentAt!.at:plan.sentAt,sending?receivedAt:plan.receivedAt,mutation,receivedAt,id,plan.version,...gateArgs)
  :c.db.prepare(`INSERT INTO crm_daily_plans(id,member_id,date,status,version,first_sent_at,first_sent_source,late,sent_at,received_at,reviewed_by,reviewed_at,return_reason,mutation_id,created_at,updated_at) SELECT ?,?,?,?,1,?,?,?,?,?,NULL,NULL,'',?,?,? WHERE ${gate} ON CONFLICT DO NOTHING`)
    .bind(id,c.me.id,p.date,status,firstSentAt,firstSource,late,sending?sentAt!.at:null,sending?receivedAt:null,mutation,receivedAt,receivedAt,...gateArgs);
 const written={sql:'EXISTS (SELECT 1 FROM crm_daily_plans WHERE id=? AND mutation_id=?)',args:[id,mutation]};
 const detail={request,before:plan?{status:plan.status,version:plan.version}:null,after:{status,version:(plan?.version??0)+1,late:!!late,firstSentAt,firstSentSource:firstSource,stops:stops.length},offline:capture?{capturedAt:capture.capturedAt,source:sentAt?.source}:null};
 let results:D1Result[];
 try{results=await c.db.batch([write,...replaceStops(c,id,mutation,stops,receivedAt),auditStatement(c,mutation,id,p.action,detail,receivedAt,written)]);}
 catch(error){const again=await receiptOf(c,mutation,request,answer,PLAN_MESSAGES.conflict);if(again)return again;throw error;}
 if(results[0].meta.changes!==1){const again=await receiptOf(c,mutation,request,answer,PLAN_MESSAGES.conflict);if(again)return again;throw new CRMError(PLAN_MESSAGES.conflict,409);}
 return answer();
}

/** POST {action:'approve'|'approve_edited'|'return'|'note', memberId, date, …}: a reviewer's decision on a member's sent plan, or their one
 *  note on the member's day (with a plan or without). */
export async function writeReviewerPlan(c:JourneyContext,body:unknown,at=new Date().toISOString()):Promise<Answer>{
 if(!reviewsPlans(c.me))throw new CRMError(PLAN_MESSAGES.reviewRole,403);
 const parsed=reviewSchema.safeParse(body);if(!parsed.success)throw new CRMError(PLAN_MESSAGES.invalid,400);
 const p=parsed.data;
 if(p.memberId===c.me.id)throw new CRMError(PLAN_MESSAGES.own,400);
 const member=planTeam(c).find(item=>item.id===p.memberId);if(!member)throw new CRMError(PLAN_MESSAGES.scope,403);
 const today=journeyDate(at),id=planId(p.memberId,p.date),mutation=PLAN_AUDIT_PREFIX+c.me.id+':'+p.requestId;
 const answer=async():Promise<Answer>=>({ok:true,id,plan:(await planViews(c,[[p.memberId,p.date]],new Date().toISOString()))[0]});
 const guard=accessGuard(c),team=reviewerGate(c.me,p.memberId);
 if(p.action==='note'){
  if(p.date>addDays(today,PLAN_AHEAD_DAYS))throw new CRMError(PLAN_MESSAGES.noteFuture,400);
  const note=planText(p.note,PLAN_NOTE_MIN,PLAN_NOTE_MAX);if(note===null)throw new CRMError(PLAN_MESSAGES.noteText,400);
  const request={action:'note',memberId:p.memberId,date:p.date,noteVersion:p.noteVersion,note};
  const replay=await receiptOf(c,mutation,request,answer,PLAN_MESSAGES.noteConflict);if(replay)return replay;
  const before=await c.db.prepare('SELECT note,version FROM crm_daily_plan_notes WHERE member_id=? AND date=? AND reviewer_id=?').bind(p.memberId,p.date,c.me.id).first<{note:string;version:number}>();
  if((before?Number(before.version):null)!==p.noteVersion)throw new CRMError(PLAN_MESSAGES.noteConflict,409);
  const gate=guard.sql+' AND '+team.sql,gateArgs=[...guard.args,...team.args];
  const write=before
   ?c.db.prepare(`UPDATE crm_daily_plan_notes SET note=?,version=version+1,mutation_id=?,updated_at=? WHERE member_id=? AND date=? AND reviewer_id=? AND version=? AND ${gate}`).bind(note,mutation,at,p.memberId,p.date,c.me.id,p.noteVersion,...gateArgs)
   :c.db.prepare(`INSERT INTO crm_daily_plan_notes(member_id,date,reviewer_id,note,version,mutation_id,created_at,updated_at) SELECT ?,?,?,?,1,?,?,? WHERE ${gate} ON CONFLICT(member_id,date,reviewer_id) DO NOTHING`).bind(p.memberId,p.date,c.me.id,note,mutation,at,at,...gateArgs);
  const written={sql:'EXISTS (SELECT 1 FROM crm_daily_plan_notes WHERE member_id=? AND date=? AND reviewer_id=? AND mutation_id=?)',args:[p.memberId,p.date,c.me.id,mutation]};
  let results:D1Result[];
  try{results=await c.db.batch([write,auditStatement(c,mutation,'daily-plan-note:'+p.memberId+':'+p.date,'note',{request,before:before?{version:Number(before.version)}:null},at,written)]);}
  catch(error){const again=await receiptOf(c,mutation,request,answer,PLAN_MESSAGES.noteConflict);if(again)return again;throw error;}
  if(results[0].meta.changes!==1){const again=await receiptOf(c,mutation,request,answer,PLAN_MESSAGES.noteConflict);if(again)return again;throw new CRMError(PLAN_MESSAGES.noteConflict,409);}
  return answer();
 }
 if(p.date<today)throw new CRMError(PLAN_MESSAGES.past,409);
 const sent=p.action==='approve_edited'?checkedStops(p.stops,1):[];
 const reason=p.action==='return'?planText(p.reason,PLAN_REASON_MIN,PLAN_REASON_MAX):'';
 if(reason===null)throw new CRMError(PLAN_MESSAGES.reason,400);
 const request={action:p.action,memberId:p.memberId,date:p.date,baseVersion:p.baseVersion,...(p.action==='approve_edited'?{stops:canonical(sent)}:{}),...(p.action==='return'?{reason}:{})};
 const replay=await receiptOf(c,mutation,request,answer,PLAN_MESSAGES.conflict);if(replay)return replay;
 const plan=(await readPlans(c.db,[[p.memberId,p.date]])).get(id);
 if(!plan||plan.status==='draft')throw new CRMError(PLAN_MESSAGES.notSent,409);
 if(plan.version!==p.baseVersion)throw new CRMError(PLAN_MESSAGES.conflict,409);
 let status:PlanStatus,stops:StoredStop[]|null=null,checked:string[]=[];
 if(p.action==='approve'){if(!reviewerMayApprove(plan.status))throw new CRMError(PLAN_MESSAGES.cannotApprove,409);status='approved';}
 else if(p.action==='approve_edited'){
  if(!reviewerMayEdit(plan.status))throw new CRMError(PLAN_MESSAGES.cannotEdit,409);
  const existing=(await readStops(c.db,[id])).get(id)||[],known=new Map(existing.map(stop=>[stop.id,stop]));
  // The reviewer's own additions and changes are checked against what they see and the member's regions; a stop sent back as it was is not.
  checked=checkCustomers(c,sent.filter(stop=>{const before=stop.id?known.get(stop.id):undefined;return !before||before.supervisorState==='removed'||before.customerId!==stop.customerId;}),member);
  const result=reviewerStops(existing,sent,c.me.id,at,()=>crypto.randomUUID());
  if(!result.changed)throw new CRMError(PLAN_MESSAGES.unchanged,400);
  stops=result.stops;status='approved_edited';
 }else{if(!reviewerMayReturn(plan.status))throw new CRMError(PLAN_MESSAGES.cannotEdit,409);status='returned';}
 const customers=customerGate(checked);
 const gate=guard.sql+' AND '+team.sql+' AND '+customers.sql,gateArgs=[...guard.args,...team.args,...customers.args];
 const write=c.db.prepare(`UPDATE crm_daily_plans SET status=?,version=version+1,reviewed_by=?,reviewed_at=?,return_reason=?,mutation_id=?,updated_at=? WHERE id=? AND version=? AND status=? AND ${gate}`)
  .bind(status,c.me.id,at,p.action==='return'?reason:'',mutation,at,id,plan.version,plan.status,...gateArgs);
 const written={sql:'EXISTS (SELECT 1 FROM crm_daily_plans WHERE id=? AND mutation_id=?)',args:[id,mutation]};
 const detail={request,before:{status:plan.status,version:plan.version},after:{status,version:plan.version+1,...(stops?{stops:stops.length}:{})}};
 let results:D1Result[];
 try{results=await c.db.batch([write,...stops?replaceStops(c,id,mutation,stops,at):[],auditStatement(c,mutation,id,p.action,detail,at,written)]);}
 catch(error){const again=await receiptOf(c,mutation,request,answer,PLAN_MESSAGES.conflict);if(again)return again;throw error;}
 if(results[0].meta.changes!==1){const again=await receiptOf(c,mutation,request,answer,PLAN_MESSAGES.conflict);if(again)return again;throw new CRMError(PLAN_MESSAGES.conflict,409);}
 return answer();
}
