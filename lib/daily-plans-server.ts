import {z} from 'zod';
import {CRMError,accessGuard} from './crm-server';
import {can,memberAccess,pageAllowed} from './permissions';
import {salesScopeMemberIds,recordAuthorId} from './access';
import {memberCanAccessRegion,regionScope,regionScopesOverlap} from './regions';
import {visitCustomer} from './customer-visits';
import {journeyDate} from './journeys';
import {offlineCapture} from './offline-server';
import {FIELD_ROLES_SQL,isFieldRole} from './roles';
import {isServiceRole} from './customer-service';
import {isSalesRequest,type Member,type Row} from './crm';
import {handAddedDay} from './new-customers';
import {memberFollowups,parseTargets,sameTargets,hasTarget,NO_TARGETS,TARGET_MESSAGES,type PlanBulkMove,type PlanTargets} from './daily-plan-followups';
import {bulkAuditRange,bulkMoveOf} from './followup-next-dates-server';
import {queuedBeforeRelease,rulesSince} from './release-gate';
import type {JourneyContext} from './journeys-server';
import {PLAN_EXPORT_MAX_DAYS,PLAN_MESSAGES,PLAN_NOTE_MAX,PLAN_NOTE_MIN,PLAN_REASON_MAX,PLAN_REASON_MIN,PLAN_AHEAD_DAYS,addDays,isPlanSalesManager,isPlanWorkingDay,managerLockProblem,memberLockProblems,memberMayEdit,memberStops,nextPlanDay,parsePlanStops,planCompletion,planDateProblem,planDay,planDeadline,planEditTrail,planLate,planReviewClosed,planSentAt,planText,planUnapproved,preparesPlans,removedBackProblems,reviewerChanges,reviewerMayApprove,reviewerMayEdit,reviewerMayReturn,reviewerStops,reviewsPlans,stopMark,type PlanActivity,type PlanCounts,type PlanEditTrail,type PlanEdits,type PlanExport,type PlanInbox,type PlanInboxDay,type PlanInboxEdit,type PlanList,type PlanListRow,type PlanNoteView,type PlanState,type PlanStatus,type PlanStopInput,type PlanView,type StoredStop,type SupervisorState} from './daily-plans';

/** Server side of «خطة الغد» and «خطط المناديب» (lib/daily-plans.ts, migration 0022). Who:
 * - the member (a representative or a marketing officer, lib/roles.ts) prepares, saves and sends their OWN plan («خطط المناديب · إضافة»);
 * - a reviewer (the administrator, a sales manager, a supervisor) reads the plans of the field members of their sales team whose regions
 *   meet theirs (lib/access.ts salesScopeMemberIds, wider for reading with «عرض بيانات الفريق بالكامل»), and approves, approves with edits,
 *   returns and notes those of their team as the role defines it («خطط المناديب · تحرير»); never their own.
 * Every write names the plan's version it was made on (`baseVersion`: null for a new plan; another is 409), is re-checked at commit (the
 * writer's role, region, supervisor and permissions unchanged, accessGuard; for a reviewer the member still in their team; the customers
 * still there) and audited in crm_audit with an action 'daily-plan:…' (kept out of GET /api/crm's recent changes): the audit row is the
 * request's receipt, so a retry answers with the plan as it is and the same key with other contents is 409. The plan never blocks the
 * recording of visits and contacts: no other route reads it.
 * Since 2026-11-22 (the port of GSCO 2.13.86, no migration): the deadline is 12:00 midnight at the start of the plan's day for the member
 * and for the supervisor's review; after it a supervisor neither approves, edits nor returns (409) and the plan reads «غير معتمدة», while the
 * sales manager (lib/daily-plans.ts isPlanSalesManager) acts until the plan's day ends. Who decided each stop and the targets is written in
 * the review's own audit line (`after.edits`) and read back with the plan (readTrails, planEditTrail): the member never changes what either
 * reviewer decided, the supervisor never changes what the sales manager decided, and each change by the sales manager reaches the member and
 * their supervisor on the reminder card and the device (readPlanInbox). */

const ID=/^[A-Za-z0-9_:.@-]{1,200}$/;
const identifier=z.string().regex(ID);
const requestId=z.string().uuid();
const day=z.string().refine(value=>!!planDay(value));
const version=z.number().int().positive();
const memberSchema=z.object({action:z.enum(['save','send']),date:day,stops:z.unknown(),baseVersion:version.nullable(),requestId,offline:z.unknown().optional(),targets:z.unknown().optional()}).strict();
const reviewSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('approve'),memberId:identifier,date:day,baseVersion:version,requestId}).strict(),
 z.object({action:z.literal('approve_edited'),memberId:identifier,date:day,baseVersion:version,stops:z.unknown(),targets:z.unknown().optional(),requestId}).strict(),
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

/** The members of a team who are asked for a plan now: active, a field member, with the screen shown and «إعداد خطة اليوم» on in their
 *  saved permissions (lib/permissions.ts). One the administrator exempted (the screen hidden, the cell off) cannot send one, so they are
 *  never «لم يرسلوا خطتهم» on the reviewer's card, «تجاوز آخر موعد للإرسال» on the list, or a working day without a plan in the export;
 *  the plans they did send are read and reviewed as before. */
async function planPreparers(db:D1Database,team:readonly Member[]):Promise<Set<string>>{
 const asked=team.filter(member=>preparesPlans(member));if(!asked.length)return new Set();
 const rows=(await db.prepare('SELECT member_id AS memberId,permissions,hidden,version FROM crm_member_permissions WHERE member_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(asked.map(member=>member.id))).all<{memberId:string;permissions:string;hidden:string;version:number}>()).results;
 const saved=new Map(rows.map(row=>[row.memberId,row]));
 return new Set(asked.filter(member=>{const who={...member,access:memberAccess(member.role,saved.get(member.id)??null)};return pageAllowed(who,'plans')&&can(who,'plans','add');}).map(member=>member.id));
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
type TargetRow={planId:string;opportunities:number|null;customers:number|null;repOpportunities:number|null;repCustomers:number|null;edited:number};
type StoredTargets={targets:PlanTargets;edited:boolean;rep:PlanTargets|null};
/** The targets of these plans (migration 0025): none stored is none set. */
async function readTargets(db:D1Database,planIds:readonly string[]):Promise<Map<string,StoredTargets>>{
 const out=new Map<string,StoredTargets>();if(!planIds.length)return out;
 const rows=(await db.prepare('SELECT plan_id AS planId,target_opportunities AS opportunities,target_customers AS customers,rep_target_opportunities AS repOpportunities,rep_target_customers AS repCustomers,targets_edited AS edited FROM crm_daily_plan_targets WHERE plan_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify([...new Set(planIds)])).all<TargetRow>()).results;
 const n=(value:number|null)=>value===null||value===undefined?null:Number(value);
 for(const row of rows){const edited=Number(row.edited)===1;out.set(row.planId,{targets:{opportunities:n(row.opportunities),customers:n(row.customers)},edited,rep:edited?{opportunities:n(row.repOpportunities),customers:n(row.repCustomers)}:null});}
 return out;
}
const noTargets:StoredTargets={targets:NO_TARGETS,edited:false,rep:null};
/** The audit actions of a reviewer's decision on a plan (each one's detail holds `after.edits` since 2026-11-22). */
export const PLAN_REVIEW_ACTIONS=['approve','approve_edited','return'].map(action=>PLAN_AUDIT_PREFIX+action);
const noTrail=():PlanEditTrail=>({marks:new Map(),targets:null,managerDecided:false,manager:null});
/** Who decided what on these plans (lib/daily-plans.ts planEditTrail), from their review lines in crm_audit (by record_id, oldest first: two
 *  lines of one millisecond in the order they were written, by rowid, not by their random ids, which picked the wrong last editor; mended
 *  2026-11-23, found by the mutation review). */
export async function readTrails(db:D1Database,planIds:readonly string[]):Promise<Map<string,PlanEditTrail>>{
 const out=new Map<string,PlanEditTrail>();if(!planIds.length)return out;
 const rows=(await db.prepare('SELECT record_id AS recordId,action,actor,detail,created_at AS createdAt FROM crm_audit WHERE record_id IN (SELECT value FROM json_each(?)) AND action IN (SELECT value FROM json_each(?)) ORDER BY created_at,rowid')
  .bind(JSON.stringify([...new Set(planIds)]),JSON.stringify(PLAN_REVIEW_ACTIONS)).all<{recordId:string;action:string;actor:string;detail:string;createdAt:string}>()).results;
 const lines=new Map<string,{action:string;at:string;actorName:string;detail:unknown}[]>();
 for(const row of rows){let detail:unknown=null;try{detail=JSON.parse(row.detail);}catch{detail=null;}const list=lines.get(row.recordId)||[];list.push({action:row.action,at:row.createdAt,actorName:row.actor||'',detail});lines.set(row.recordId,list);}
 for(const [id,list] of lines)out.set(id,planEditTrail(list));
 return out;
}
/** When a record was made, for the day it counts on: the device's time of one saved on the device, else the server's. A request of a mold
 *  written by a visit ('visit-request-<key>') takes its visit's ('customer-visit-<key>'), which carries the device's time. */
function madeAt(row:Row,byId:ReadonlyMap<string,Row>){
 const visit=row.id.startsWith('visit-request-')?byId.get('customer-visit-'+row.id.slice('visit-request-'.length)):undefined;
 const own=visit||row;
 return typeof own.data?.offlineRecordedAt==='string'&&Number.isFinite(Date.parse(own.data.offlineRecordedAt))?own.data.offlineRecordedAt:row.createdAt;
}
/** What each member achieved on this Riyadh day (2026-11-22, the port of GSCO 2.13.85), counted from the records themselves, never typed:
 * - new sales opportunities: the requests of a mold (kind 'opportunity', not a bare follow-up thread) the member recorded that day (by a visit's
 *   request or the opportunity's form; `_createdBy`, else the record's author), not from a file import (`sourceFile`), on the device's time for
 *   one saved on the device;
 * - new customers: the customers the member added by hand that day (lib/new-customers.ts handAddedDay: never a file import or the ERP
 *   customers import; credited to `_createdBy`, as «العملاء الجدد»).
 * A deleted record has left crm_records and counts no more. */
export function planActuals(c:Pick<JourneyContext,'all'|'members'>,memberIds:readonly string[],date:string):Map<string,{opportunities:number;customers:number}>{
 const out=new Map(memberIds.map(id=>[id,{opportunities:0,customers:0}]));if(!memberIds.length||!planDay(date))return out;
 const byId=new Map(c.all.map(row=>[row.id,row]));
 for(const row of c.all){
  if(row.kind==='customer'){const who=out.get(String(row.data?._createdBy||''));if(who&&handAddedDay(row)===date)who.customers++;continue;}
  if(row.kind!=='opportunity'||!isSalesRequest(row)||row.data?.sourceFile)continue;
  const who=out.get(String(row.data?._createdBy||recordAuthorId(row,c.members)||''));
  if(who&&journeyDate(madeAt(row,byId))===date)who.opportunities++;
 }
 return out;
}
/** The follow-ups each member moved with POST /api/crm/opportunity-next-dates from this day's plan (their audit lines, read through the
 *  primary key by member and day), oldest first, with the customer's name. */
export async function planBulkMoves(c:Pick<JourneyContext,'db'|'all'>,memberIds:readonly string[],date:string):Promise<Map<string,PlanBulkMove[]>>{
 const out=new Map<string,PlanBulkMove[]>();if(!memberIds.length||!planDay(date))return out;
 const names=new Map(c.all.filter(row=>row.kind==='customer').map(row=>[row.id,String(row.data?.name||'')]));
 for(const memberId of new Set(memberIds)){
  const [from,to]=bulkAuditRange(memberId,date);
  const rows=(await c.db.prepare('SELECT id,record_id AS recordId,detail,created_at AS createdAt FROM crm_audit WHERE id>=? AND id<? ORDER BY created_at,id').bind(from,to).all<{id:string;recordId:string;detail:string;createdAt:string}>()).results;
  if(rows.length)out.set(memberId,rows.map(row=>{const move=bulkMoveOf(row);return {...move,customerName:names.get(move.customerId)||''};}));
 }
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
 const stops=await readStops(c.db,[...plans.values()].map(plan=>plan.id)),notes=await readNotes(c.db,pairs),targets=await readTargets(c.db,[...plans.values()].map(plan=>plan.id));
 const trails=await readTrails(c.db,[...plans.values()].filter(plan=>plan.status!=='draft').map(plan=>plan.id)),manager=isPlanSalesManager(c.me);
 // The achieved numbers from the plan's day on, and the bulk moves, per day asked.
 const byDate=new Map<string,string[]>();for(const [memberId,date] of pairs){const list=byDate.get(date)||[];list.push(memberId);byDate.set(date,list);}
 const actuals=new Map<string,{opportunities:number;customers:number}>(),moves=new Map<string,PlanBulkMove[]>();
 for(const [date,memberIds] of byDate){
  if(date<=today)for(const [memberId,actual] of planActuals(c,memberIds,date))actuals.set(memberId+'|'+date,actual);
  for(const [memberId,list] of await planBulkMoves(c,memberIds,date))moves.set(memberId+'|'+date,list);
 }
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
  const goal=(plan?targets.get(plan.id):undefined)||noTargets,trail=(plan?trails.get(plan.id):undefined)||noTrail();
  // GSCO 2.13.86: a supervisor until midnight at the start of the plan's day, the sales manager until it ends; the sales manager's targets stay
  // theirs even when set back to the member's own numbers.
  const closed=planReviewClosed(date,now),managerTargets=trail.targets==='manager',targetsEdited=goal.edited||managerTargets;
  const plannable=future===null,editable=reader.writeTeam&&can(c.me,'plans','edit')&&date>=today&&(manager||!closed);
  return {ok:true,memberId,memberName:member?.name||'',date,applies,id:plan?.id??null,state,status,version:plan?.version??null,late:!!plan?.late,deadline:planDeadline(date),
   firstSentAt:plan?.firstSentAt??null,firstSentSource:plan?.firstSentSource??null,sentAt:plan?.sentAt??null,reviewedByName:plan?.reviewedBy?names.get(plan.reviewedBy)||'':'',reviewedAt:plan?.reviewedAt??null,returnReason:plan?.returnReason||'',updatedAt:plan?.updatedAt??null,
   stops:planStops.map(stop=>{const done=outcome.get(stop.id);return {id:stop.id,position:stop.position,customerId:stop.customerId,customerName:customers.get(stop.customerId)?.data.name||'',kind:stop.kind,time:stop.time,note:stop.note,addedBy:stop.addedBy,addedByName:names.get(stop.addedBy)||'',supervisorState:stop.supervisorState,editedByName:stop.editedBy?names.get(stop.editedBy)||'':'',completion:done?.state||'open',activityId:done?.activityId??null,activityType:done?.activityType??null,doneAt:done?.at??null,mark:stopMark(stop.supervisorState,trail.marks.get(stop.id))};}),
   activities:completion.activities.filter(item=>item.place!=='planned').map(item=>({id:item.id,customerId:item.customerId,customerName:customers.get(item.customerId)?.data.name||'',type:item.type,at:item.at,place:item.place as 'outside'|'extra'})),
   counts:plan?completion.counts:{...emptyCounts,outside:completion.counts.outside,extra:completion.counts.extra},notes:reader.own||reader.reviewer?noteRows:[],
   targets:goal.targets,targetsEdited,repTargets:goal.rep,actual:plan?actuals.get(memberId+'|'+date)??null:null,bulkMoves:moves.get(memberId+'|'+date)||[],
   targetsEditedBy:managerTargets?'manager':goal.edited?'supervisor':null,managerEdit:trail.manager?{byName:trail.manager.byName,at:trail.manager.at,version:trail.manager.version,decision:trail.manager.decision}:null,
   managerDecided:trail.managerDecided,unapproved:planUnapproved({state,date},today),reviewClosed:closed,salesManager:manager,
   canEdit:reader.own&&applies&&preparesPlans(c.me)&&can(c.me,'plans','add')&&memberMayEdit(status)&&plannable,
   canApprove:editable&&reviewerMayApprove(status),canReviewEdit:editable&&reviewerMayEdit(status),canReturn:editable&&reviewerMayReturn(status)&&(manager||!trail.managerDecided),
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
 const views=await planViews(c,members.map(member=>[member.id,date]),now),overdue=Date.parse(now)>=Date.parse(planDeadline(date))&&isPlanWorkingDay(date),asked=await planPreparers(c.db,members);
 const rows:PlanListRow[]=views.map((view,index)=>({memberId:view.memberId,name:view.memberName,role:members[index].role,state:view.state,version:view.version,late:view.late,overdue:view.state==='missing'&&overdue&&asked.has(view.memberId),firstSentAt:view.firstSentAt,reviewedByName:view.reviewedByName,counts:view.counts,notes:view.notes.length,
  targets:view.targets,targetsEdited:view.targetsEdited,actual:view.actual,bulkMoves:view.bulkMoves.length,
  unapproved:!!view.unapproved,targetsEditedBy:view.targetsEditedBy??null,managerEdited:!!view.managerEdit}));
 // A plan «غير معتمدة» (its day begun) no longer waits for approval.
 const rank=(row:PlanListRow)=>row.state==='sent'&&!row.unapproved?0:row.overdue?1:row.state==='returned'?2:row.state==='missing'?3:4;
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
 const plans=await readPlans(c.db,asked),preparers=await planPreparers(c.db,team);
 const pairs=asked.filter(([memberId,date])=>{const plan=plans.get(planId(memberId,date));return plan&&plan.status!=='draft'||preparers.has(memberId)&&isPlanWorkingDay(date)&&date<=journeyDate(now);});
 pairs.sort((a,b)=>a[1].localeCompare(b[1])||(team.find(m=>m.id===a[0])?.name||'').localeCompare(team.find(m=>m.id===b[0])?.name||'','ar'));
 return {ok:true,from,to,plans:await planViews(c,pairs,now)};
}

/** GET /api/daily-plans/inbox (the reminder cards). Reads plans and their review lines only, never the records. Since 2026-11-22 (GSCO
 *  2.13.86): a supervisor's plans waiting are those whose window is still open (a later day than today), the sales manager's every one up to
 *  today; the member hears of the sales manager's edits of their approved plans of today and the next seven days, and a supervisor of every
 *  change by a sales manager to a plan of the members who report to them (never of their own changes). */
export async function readPlanInbox(c:Pick<JourneyContext,'db'|'me'|'members'>,now=new Date().toISOString()):Promise<PlanInbox>{
 const today=journeyDate(now),next=nextPlanDay(today),names=new Map(c.members.map(member=>[member.id,member.name]));
 if(isServiceRole(c.me.role)||!pageAllowed(c.me,'plans'))return {ok:true,serverTime:now,role:'none'};
 const summary=(date:string,plan:PlanRow|undefined):PlanInboxDay=>({date,state:plan?plan.status:'missing',late:!!plan?.late,deadline:planDeadline(date),version:plan?.version??null,returnReason:plan?.returnReason||'',reviewedByName:plan?.reviewedBy?names.get(plan.reviewedBy)||'':''});
 const editsOf=async(plans:readonly PlanRow[],keep:(edit:PlanInboxEdit)=>boolean):Promise<PlanInboxEdit[]>=>{
  const trails=await readTrails(c.db,plans.map(plan=>plan.id)),out:PlanInboxEdit[]=[];
  for(const plan of plans){const edit=trails.get(plan.id)?.manager;if(edit){const item={memberId:plan.memberId,name:names.get(plan.memberId)||'',date:plan.date,at:edit.at,byName:edit.byName,version:edit.version,decision:edit.decision};if(edit.byId!==c.me.id&&keep(item))out.push(item);}}
  return out.slice(0,50);
 };
 if(preparesPlans(c.me)&&can(c.me,'plans','add')){
  const days=Array.from({length:PLAN_AHEAD_DAYS+1},(_,index)=>addDays(today,index));
  const plans=await readPlans(c.db,days.map(date=>[c.me.id,date]));
  const edits=await editsOf([...plans.values()].filter(plan=>plan.status!=='draft').sort((a,b)=>a.date.localeCompare(b.date)),edit=>edit.decision==='edit');
  return {ok:true,serverTime:now,role:'member',next:summary(next,plans.get(planId(c.me.id,next))),today:isPlanWorkingDay(today)?summary(today,plans.get(planId(c.me.id,today))):null,edits};
 }
 if(reviewsPlans(c.me)&&can(c.me,'plans','edit')){
  const team=planTeam(c).filter(member=>member.active),manager=isPlanSalesManager(c.me);
  const rows=team.length?(await c.db.prepare(`SELECT ${planColumns} FROM crm_daily_plans WHERE member_id IN (SELECT value FROM json_each(?)) AND date>=? AND status IN ('sent','approved','approved_edited','returned') ORDER BY date,first_sent_at,id`).bind(JSON.stringify(team.map(member=>member.id)),today).all<PlanRow>()).results:[];
  const pending=rows.filter(row=>row.status==='sent'&&(manager||!planReviewClosed(row.date,now))).slice(0,50).map(row=>({memberId:row.memberId,name:names.get(row.memberId)||'',date:row.date,late:!!Number(row.late),firstSentAt:row.firstSentAt,version:Number(row.version)}));
  const direct=new Set(team.filter(member=>member.supervisorId===c.me.id).map(member=>member.id));
  const edits=await editsOf(rows.filter(row=>direct.has(row.memberId)).map(row=>({...row,version:Number(row.version)})),()=>true);
  const date=Date.parse(now)>=Date.parse(planDeadline(next))?next:isPlanWorkingDay(today)?today:'';
  const sent=new Set(rows.filter(row=>row.date===date).map(row=>row.memberId));
  const asked=date?await planPreparers(c.db,team):new Set<string>();
  const missing=date?team.filter(member=>asked.has(member.id)&&!sent.has(member.id)).map(member=>member.name).sort((a,b)=>a.localeCompare(b,'ar')):[];
  return {ok:true,serverTime:now,role:'reviewer',pending,...(date?{missing:{date,names:missing}}:{}),salesManager:manager,edits};
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

/** From 2026-11-22 (the port of GSCO 2.13.85) a page always sends `targets`, its new stops are follow-ups and its targets are checked. A save
 *  without `targets` comes from a page loaded before: refused («حُدّث التطبيق؛ أعد تحميل الصفحة.», 409), unless it is a send the device's
 *  outbox kept from before this release was installed (its device time earlier than planRulesSince: the later of the release day and this
 *  server's start, so a restart by the host only widens the window), which keeps the earlier rules and the plan's targets as they are. */
export const planRulesSince=rulesSince;
export const legacyPlanSaveAllowed=queuedBeforeRelease;
/** The stops a writer adds (an id the plan does not hold, one taken out by a reviewer, or a customer changed) must be follow-ups of the plan's
 *  member: a customer of theirs with an open follow-up (lib/daily-plan-followups.ts memberFollowups, what «خطة الغد» offers). */
function checkFollowupStops(c:JourneyContext,existing:readonly StoredStop[],sent:readonly PlanStopInput[],memberId:string,today:string){
 const known=new Map(existing.filter(stop=>stop.supervisorState!=='removed').map(stop=>[stop.id,stop]));
 const fresh=sent.filter(stop=>{const before=stop.id?known.get(stop.id):undefined;return !before||before.customerId!==stop.customerId;});
 if(!fresh.length)return;
 const followups=new Set(memberFollowups(c.visible,memberId,today).map(item=>item.customerId));
 fresh.forEach(stop=>{if(!followups.has(stop.customerId))throw new CRMError(PLAN_MESSAGES.followupsOnly,400,{stop:sent.indexOf(stop)});});
}
/** The statement that keeps a plan's targets (crm_daily_plan_targets), run only when the plan row was written by this request. */
function targetsStatement(c:JourneyContext,id:string,mutation:string,value:StoredTargets,at:string){
 return c.db.prepare(`INSERT INTO crm_daily_plan_targets(plan_id,target_opportunities,target_customers,rep_target_opportunities,rep_target_customers,targets_edited,updated_at)
  SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM crm_daily_plans WHERE id=? AND mutation_id=?)
  ON CONFLICT(plan_id) DO UPDATE SET target_opportunities=excluded.target_opportunities,target_customers=excluded.target_customers,rep_target_opportunities=excluded.rep_target_opportunities,rep_target_customers=excluded.rep_target_customers,targets_edited=excluded.targets_edited,updated_at=excluded.updated_at`)
  .bind(id,value.targets.opportunities,value.targets.customers,value.rep?.opportunities??null,value.rep?.customers??null,value.edited?1:0,at,id,mutation);
}

/** POST {action:'save'|'send', date, stops, baseVersion, requestId, offline?, targets}: the member's own plan. «حفظ مسودة» keeps a draft the reviewers
 *  do not see; «إرسال» sends it (again after a return or before a decision). A send kept on the device carries the device's clock
 *  (offline.capturedAt, lib/offline-server.ts offlineCapture), which is when it was sent while within the bounds (lib/daily-plans.ts
 *  planSentAt); the first send decides «متأخرة». */
export async function writeMemberPlan(c:JourneyContext,body:unknown,receivedAt=new Date().toISOString()):Promise<Answer>{
 if(!preparesPlans(c.me))throw new CRMError(PLAN_MESSAGES.role,403);
 const parsed=memberSchema.safeParse(body);if(!parsed.success)throw new CRMError(PLAN_MESSAGES.invalid,400);
 const p=parsed.data,today=journeyDate(receivedAt),problem=planDateProblem(p.date,today);
 const capture=p.action==='send'?offlineCapture(body as Record<string,unknown>,c.me.id,receivedAt):null;
 // The rules of 2026-11-22: the targets (both required to send; a plan with no follow-up is sent when one is above zero), follow-ups only.
 const rules=p.targets!==undefined;
 const asked=rules?parseTargets(p.targets):null;
 if(rules&&!asked)throw new CRMError(TARGET_MESSAGES.range,400);
 const sent=checkedStops(p.stops,p.action==='send'&&!rules?1:0);
 const id=planId(c.me.id,p.date),mutation=PLAN_AUDIT_PREFIX+c.me.id+':'+p.requestId;
 const request={action:p.action,memberId:c.me.id,date:p.date,baseVersion:p.baseVersion,stops:canonical(sent),...(asked?{targets:asked}:{})};
 const answer=async():Promise<Answer>=>({ok:true,id,plan:(await planViews(c,[[c.me.id,p.date]],new Date().toISOString()))[0]});
 // The receipt first: a request that was written, sent again after its day ended (a lost answer retried after midnight, the device's
 // outbox), answers with the plan as it is, never «انتهى يوم هذه الخطة».
 const replay=await receiptOf(c,mutation,request,answer,PLAN_MESSAGES.conflict);if(replay)return replay;
 if(!rules&&!legacyPlanSaveAllowed(capture?.capturedAt))throw new CRMError(PLAN_MESSAGES.pageOutdated,409);
 if(asked&&p.action==='send'&&(asked.opportunities===null||asked.customers===null))throw new CRMError(TARGET_MESSAGES.required,400);
 if(asked&&p.action==='send'&&!sent.length&&!hasTarget(asked))throw new CRMError(TARGET_MESSAGES.empty,400);
 if(problem==='past')throw new CRMError(PLAN_MESSAGES.past,409);
 if(problem)throw new CRMError(PLAN_MESSAGES.date,400);
 const plan=(await readPlans(c.db,[[c.me.id,p.date]])).get(id),existing=plan?(await readStops(c.db,[id])).get(id)||[]:[];
 if((plan?.version??null)!==p.baseVersion)throw new CRMError(PLAN_MESSAGES.conflict,409);
 if(!memberMayEdit(plan?.status??null))throw new CRMError(PLAN_MESSAGES.approved,409);
 if(p.action==='save'&&plan&&plan.status!=='draft')throw new CRMError(PLAN_MESSAGES.sentNoDraft,409);
 // What a reviewer decided stays theirs: the stops (by their ids), a follow-up taken out (not brought back as a new stop on its customer,
 // GSCO 2.13.86 review A1) and the targets (the sales manager's even set back to the member's own numbers); the message names who decided.
 const trail=plan&&plan.status!=='draft'?(await readTrails(c.db,[id])).get(id)||noTrail():noTrail();
 const lockProblems=memberLockProblems(existing,sent);
 if(lockProblems.length)throw new CRMError(lockProblems.some(stopId=>trail.marks.get(stopId)?.by==='manager')?PLAN_MESSAGES.lockedManager:PLAN_MESSAGES.locked,403);
 const back=removedBackProblems(existing,sent);if(back.length)throw new CRMError(PLAN_MESSAGES.removedBack,403,{stop:back[0]});
 const stored=plan?(await readTargets(c.db,[id])).get(id)||noTargets:noTargets,managerTargets=trail.targets==='manager';
 if(asked&&(stored.edited||managerTargets)&&!sameTargets(asked,stored.targets))throw new CRMError(managerTargets?PLAN_MESSAGES.targetsFixedManager:TARGET_MESSAGES.fixed,403);
 // A stop the member adds or changes is checked against what they see; the locked ones were checked when the reviewer wrote them.
 const lockedIds=new Set(existing.filter(stop=>stop.supervisorState!=='').map(stop=>stop.id));
 const checked=checkCustomers(c,sent.filter(stop=>!stop.id||!lockedIds.has(stop.id)),c.me);
 if(rules)checkFollowupStops(c,existing,sent,c.me.id,today);
 const stops=memberStops(existing,sent,c.me.id,receivedAt,()=>crypto.randomUUID());
 // The device's time of a send kept on the device stands within its bounds, unless it was before the deadline and reached the server more
 // than two hours after it (GSCO 2.13.86 review A8: then the server's time, «متأخرة»).
 const sending=p.action==='send',sentAt=sending?planSentAt(capture,receivedAt,p.date):null,first=sending&&!plan?.firstSentAt;
 // A change of the targets of a plan already sent, sent again after the deadline, makes it late (GSCO 2.13.85: «تغيير المستهدف بعد الموعد
 // يجعل الخطة متأخرة»); a returned plan is the reviewer's request and stays as it was. The stops keep Yourrest's rule: the first send decides.
 const targetsMoved=!!asked&&!!plan?.firstSentAt&&plan.status!=='returned'&&sending&&!sameTargets(asked,stored.targets)&&planLate(sentAt!.at,p.date);
 // A returned plan sent again after the deadline is late (GSCO 2.13.86 review A7: the supervisor's window has closed by then).
 const resentLate=sending&&plan?.status==='returned'&&planLate(sentAt!.at,p.date);
 const firstSentAt=plan?.firstSentAt??(first?sentAt!.at:null),firstSource=plan?.firstSentSource??(first?sentAt!.source:null),late=targetsMoved||resentLate?1:plan?.firstSentAt?plan.late:first?Number(planLate(sentAt!.at,p.date)):0;
 const status:PlanStatus=sending?'sent':'draft';
 const guard=accessGuard(c),customers=customerGate(checked),gate=guard.sql+' AND '+customers.sql,gateArgs=[...guard.args,...customers.args];
 const write=plan
  ?c.db.prepare(`UPDATE crm_daily_plans SET status=?,version=version+1,first_sent_at=?,first_sent_source=?,late=?,sent_at=?,received_at=?,reviewed_by=NULL,reviewed_at=NULL,return_reason='',mutation_id=?,updated_at=? WHERE id=? AND version=? AND ${gate}`)
    .bind(status,firstSentAt,firstSource,late,sending?sentAt!.at:plan.sentAt,sending?receivedAt:plan.receivedAt,mutation,receivedAt,id,plan.version,...gateArgs)
  :c.db.prepare(`INSERT INTO crm_daily_plans(id,member_id,date,status,version,first_sent_at,first_sent_source,late,sent_at,received_at,reviewed_by,reviewed_at,return_reason,mutation_id,created_at,updated_at) SELECT ?,?,?,?,1,?,?,?,?,?,NULL,NULL,'',?,?,? WHERE ${gate} ON CONFLICT DO NOTHING`)
    .bind(id,c.me.id,p.date,status,firstSentAt,firstSource,late,sending?sentAt!.at:null,sending?receivedAt:null,mutation,receivedAt,receivedAt,...gateArgs);
 const written={sql:'EXISTS (SELECT 1 FROM crm_daily_plans WHERE id=? AND mutation_id=?)',args:[id,mutation]};
 const detail={request,before:plan?{status:plan.status,version:plan.version,targets:stored.targets}:null,after:{status,version:(plan?.version??0)+1,late:!!late,firstSentAt,firstSentSource:firstSource,stops:stops.length,...(asked?{targets:asked}:{}),...(targetsMoved?{lateTargets:true}:{}),...(resentLate?{lateResend:true}:{})},offline:capture?{capturedAt:capture.capturedAt,source:sentAt?.source,...(sentAt?.crossed?{crossedDeadline:true}:{})}:null,...(rules?{}:{legacyRules:true})};
 // The member's targets (a page of this release only); a reviewer's are never changed here (refused above when they differ).
 const keep=asked&&!stored.edited&&!managerTargets?[targetsStatement(c,id,mutation,{targets:asked,edited:false,rep:null},receivedAt)]:[];
 let results:D1Result[];
 try{results=await c.db.batch([write,...replaceStops(c,id,mutation,stops,receivedAt),...keep,auditStatement(c,mutation,id,p.action,detail,receivedAt,written)]);}
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
 // A reviewer's targets (2026-11-22): both set, 0 to 50; a plan may keep no follow-up when a target is above zero.
 const wanted=p.action==='approve_edited'&&p.targets!==undefined?parseTargets(p.targets):null;
 if(p.action==='approve_edited'&&p.targets!==undefined&&(!wanted||wanted.opportunities===null||wanted.customers===null))throw new CRMError(wanted?TARGET_MESSAGES.required:TARGET_MESSAGES.range,400);
 const sent=p.action==='approve_edited'?checkedStops(p.stops,wanted&&hasTarget(wanted)?0:1):[];
 const reason=p.action==='return'?planText(p.reason,PLAN_REASON_MIN,PLAN_REASON_MAX):'';
 if(reason===null)throw new CRMError(PLAN_MESSAGES.reason,400);
 const request={action:p.action,memberId:p.memberId,date:p.date,baseVersion:p.baseVersion,...(p.action==='approve_edited'?{stops:canonical(sent),...(wanted?{targets:wanted}:{})}:{}),...(p.action==='return'?{reason}:{})};
 // The receipt before the day's check, as the member's (a decision written at 23:59 and sent again after midnight answers from it).
 const replay=await receiptOf(c,mutation,request,answer,PLAN_MESSAGES.conflict);if(replay)return replay;
 // The sales manager until the plan's day ends (the day's check above), a supervisor until midnight at its start (GSCO 2.13.86): then the
 // plan stays «غير معتمدة».
 const manager=isPlanSalesManager(c.me);
 if(p.date<today)throw new CRMError(PLAN_MESSAGES.past,409);
 if(!manager&&planReviewClosed(p.date,at))throw new CRMError(PLAN_MESSAGES.reviewClosed,409);
 const plan=(await readPlans(c.db,[[p.memberId,p.date]])).get(id);
 if(!plan||plan.status==='draft')throw new CRMError(PLAN_MESSAGES.notSent,409);
 if(plan.version!==p.baseVersion)throw new CRMError(PLAN_MESSAGES.conflict,409);
 const trail=(await readTrails(c.db,[id])).get(id)||noTrail();
 let status:PlanStatus,stops:StoredStop[]|null=null,checked:string[]=[],nextTargets:StoredTargets|null=null;
 let changes={added:[] as string[],edited:[] as string[],removed:[] as string[],order:false},targetsChanged=false;
 if(p.action==='approve'){if(!reviewerMayApprove(plan.status))throw new CRMError(PLAN_MESSAGES.cannotApprove,409);status='approved';}
 else if(p.action==='approve_edited'){
  if(!reviewerMayEdit(plan.status))throw new CRMError(PLAN_MESSAGES.cannotEdit,409);
  const existing=(await readStops(c.db,[id])).get(id)||[],known=new Map(existing.map(stop=>[stop.id,stop]));
  // The supervisor keeps what the sales manager decided as it is: their stops (in their place), a follow-up they took out, their targets.
  if(!manager){
   const problem=managerLockProblem(existing,sent,trail);
   if(problem)throw new CRMError(problem==='fixed'?PLAN_MESSAGES.managerStopFixed:problem==='removed'?PLAN_MESSAGES.managerRemovedBack:PLAN_MESSAGES.managerStopOrder,400);
  }
  // The reviewer's own additions and changes are checked against what they see and the member's regions; a stop sent back as it was is not.
  checked=checkCustomers(c,sent.filter(stop=>{const before=stop.id?known.get(stop.id):undefined;return !before||before.supervisorState==='removed'||before.customerId!==stop.customerId;}),member);
  // The reviewer adds follow-ups only, as the member does (2026-11-22): no customer without a follow-up of the member.
  checkFollowupStops(c,existing,sent,member.id,today);
  const result=reviewerStops(existing,sent,c.me.id,at,()=>crypto.randomUUID());
  // The targets: a change is marked and the member's own values kept; set back to them, the mark goes.
  const current=(await readTargets(c.db,[id])).get(id)||noTargets;
  if(!manager&&trail.targets==='manager'&&wanted&&!sameTargets(wanted,current.targets))throw new CRMError(PLAN_MESSAGES.managerTargetsFixed,400);
  if(wanted&&!sameTargets(wanted,current.targets)){
   const original=current.edited&&current.rep?current.rep:current.targets,edited=!sameTargets(wanted,original);
   targetsChanged=true;nextTargets={targets:wanted,edited,rep:edited?original:null};
  }
  if(!result.changed&&!targetsChanged)throw new CRMError(PLAN_MESSAGES.unchanged,400);
  stops=result.stops;status='approved_edited';changes=reviewerChanges(existing,result.stops);
 }else{
  if(!reviewerMayReturn(plan.status))throw new CRMError(PLAN_MESSAGES.cannotEdit,409);
  // A plan the sales manager approved, edited or returned is theirs to send back (GSCO 2.13.86 review A9).
  if(!manager&&trail.managerDecided)throw new CRMError(PLAN_MESSAGES.managerDecidedReturn,409);
  status='returned';
 }
 const customers=customerGate(checked);
 const gate=guard.sql+' AND '+team.sql+' AND '+customers.sql,gateArgs=[...guard.args,...team.args,...customers.args];
 // The sales manager's edit of a plan already approved keeps the approval with its approver and time (their edit shows apart: managerEdit).
 const keepApproval=manager&&p.action==='approve_edited'&&(plan.status==='approved'||plan.status==='approved_edited')&&!!plan.reviewedBy;
 const write=c.db.prepare(`UPDATE crm_daily_plans SET status=?,version=version+1,reviewed_by=?,reviewed_at=?,return_reason=?,mutation_id=?,updated_at=? WHERE id=? AND version=? AND status=? AND ${gate}`)
  .bind(status,keepApproval?plan.reviewedBy:c.me.id,keepApproval?plan.reviewedAt||at:at,p.action==='return'?reason:'',mutation,at,id,plan.version,plan.status,...gateArgs);
 const written={sql:'EXISTS (SELECT 1 FROM crm_daily_plans WHERE id=? AND mutation_id=?)',args:[id,mutation]};
 // Who decided what in this write (read back by readTrails): `changed` is what the member and their supervisor hear of when the sales manager
 // made it (the stops, their order, the targets, or a return).
 const stopsChanged=changes.added.length+changes.edited.length+changes.removed.length>0||changes.order;
 const edits:PlanEdits={by:manager?'manager':'supervisor',byId:c.me.id,...changes,targets:targetsChanged,changed:stopsChanged||targetsChanged||p.action==='return'};
 const detail={request,before:{status:plan.status,version:plan.version},after:{status,version:plan.version+1,...(stops?{stops:stops.length}:{}),...(nextTargets?{targets:nextTargets.targets,targetsEdited:nextTargets.edited,repTargets:nextTargets.rep}:{}),edits}};
 let results:D1Result[];
 try{results=await c.db.batch([write,...stops?replaceStops(c,id,mutation,stops,at):[],...nextTargets?[targetsStatement(c,id,mutation,nextTargets,at)]:[],auditStatement(c,mutation,id,p.action,detail,at,written)]);}
 catch(error){const again=await receiptOf(c,mutation,request,answer,PLAN_MESSAGES.conflict);if(again)return again;throw error;}
 if(results[0].meta.changes!==1){const again=await receiptOf(c,mutation,request,answer,PLAN_MESSAGES.conflict);if(again)return again;throw new CRMError(PLAN_MESSAGES.conflict,409);}
 return answer();
}
