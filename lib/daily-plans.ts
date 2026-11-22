/** «خطة الغد» and «خطط المناديب» (the owner, 2026-11-19: the port of GSCO 2.13.83 «خطة الغد / خطط المناديب» with the owner's decisions;
 * migration 0022). A representative or a marketing officer (lib/roles.ts isFieldRole) prepares the plan of the next working day: stops,
 * each a visit, a call or a WhatsApp contact on a customer, in order, with an optional time and note. It is sent to the supervisor before
 * 22:00 Riyadh of the day before the plan's day, and Saturday's before midnight at the end of Friday (the owner, 2026-11-21); sent later it
 * is accepted and marked «متأخرة» (decided by its first send). The
 * supervisor (or the sales manager, who may take part but is not required, or the administrator) approves it, approves it with edits
 * (applied at once and shown as edited; the member can no longer change or delete what the reviewer added or changed) or returns it with a
 * reason. A stop is «تمت» by itself once the member records a visit or contact of the same kind on that customer that day, «تمت بطريقة
 * تواصل أخرى» by a contact of another kind; one activity closes one stop; an activity on a customer the plan does not name is «خارج الخطة».
 * The plan never stops the member from recording anything. Pure: the server (lib/daily-plans-server.ts), the pages (app/daily-plans.tsx)
 * and the tests read the same rules here. */
import {isFieldRole} from './roles';
import {WORKING_WEEKDAYS} from './working-hours';
import {NO_TARGETS,type PlanBulkMove,type PlanTargets} from './daily-plan-followups';

/** The deadline: 22:00 on the day before the plan's day, Riyadh time (UTC+03:00 all year, no daylight saving). When that day before is a
 *  Friday (the weekly day off: the plan is Saturday's, prepared on Thursday), midnight at the end of that Friday, Saturday 00:00:00 (the
 *  owner, 2026-11-21: «اخر معاد الجمعة قبل 12 باليل»): sent at Friday 23:59:59 it is on time, at 00:00:00 it is late. planDeadline. */
export const PLAN_DEADLINE_HOUR=22,PLAN_FRIDAY_DEADLINE_HOUR=24;
/** The deadline in words, for the screens, the reminder card and the device's notice («قبل …» / «before …» put before it). */
export const PLAN_DEADLINE_TEXT={normal:['الساعة 22:00','22:00'],friday:['منتصف الليل بين الجمعة والسبت','midnight between Friday and Saturday']} as const;
const RIYADH_OFFSET_MS=3*3600_000,DAY_MS=86_400_000;
/** A plan has at most 30 stops; a stop's note at most 300 characters; a return's reason 3 to 500; a reviewer's note 2 to 1000. */
export const PLAN_MAX_STOPS=30,PLAN_STOP_NOTE_MAX=300,PLAN_REASON_MIN=3,PLAN_REASON_MAX=500,PLAN_NOTE_MIN=2,PLAN_NOTE_MAX=1000;
/** A plan is prepared for today (sent late) up to 7 days ahead (a weekend, a holiday). */
export const PLAN_AHEAD_DAYS=7;
/** A send kept on the device's outbox carries the device's clock (lib/offline-submit.ts): it is trusted when it is not more than a minute
 *  after the server's receipt (lib/offline-server.ts offlineCapture refuses that) and not more than 48 hours before it; older, the
 *  server's receipt is the time it was sent. */
export const PLAN_OFFLINE_MAX_AGE_MS=48*3600_000,PLAN_CLOCK_SKEW_MS=60_000;
/** The export covers at most 31 days. */
export const PLAN_EXPORT_MAX_DAYS=31;
/** The reminder card shows the next day's plan from 16:00 Riyadh while it is not sent; the device's notification comes from 20:00. */
export const PLAN_REMINDER_FROM_HOUR=16,PLAN_NOTICE_FROM_HOUR=20;
/** The cards ask again every 5 minutes while the page is in front, and when it comes back to the front at most once a minute. */
export const PLAN_INBOX_INTERVAL_MS=5*60_000,PLAN_INBOX_FOCUS_MS=60_000;

export const STOP_KINDS=['visit','call','whatsapp'] as const;
export type StopKind=typeof STOP_KINDS[number];
export const STOP_KIND_TEXT:Record<StopKind,readonly [string,string]>={visit:['زيارة','Visit'],call:['اتصال','Call'],whatsapp:['واتساب','WhatsApp']};
export const isStopKind=(value:unknown):value is StopKind=>(STOP_KINDS as readonly unknown[]).includes(value);
/** The kind of a recorded visit or contact (crm_records activity data.type) as a plan names it; any other type is 'other'. */
export const activityStopKind=(type:unknown):StopKind|'other'=>isStopKind(type)?type:'other';

export const PLAN_STATUSES=['draft','sent','approved','approved_edited','returned'] as const;
export type PlanStatus=typeof PLAN_STATUSES[number];
/** 'missing': no plan was sent for the day (none, or a draft the member kept). */
export type PlanState=PlanStatus|'missing';
export const PLAN_STATE_TEXT:Record<PlanState,readonly [string,string]>={
 missing:['لم تُرسل','Not sent'],draft:['مسودة لم تُرسل','Draft, not sent'],sent:['بانتظار الاعتماد','Waiting for approval'],
 approved:['معتمدة','Approved'],approved_edited:['معتمدة مع تعديل','Approved with edits'],returned:['أُعيدت للمندوب','Returned to the representative']
};
export const PLAN_LATE_TEXT=['متأخرة','Late'] as const;
/** The member edits and sends while the plan is not approved; the reviewer approves a sent plan, edits a sent or approved one, returns
 *  a sent or approved one. */
export const memberMayEdit=(status:PlanStatus|null)=>status===null||status==='draft'||status==='sent'||status==='returned';
export const reviewerMayApprove=(status:PlanStatus|null)=>status==='sent';
export const reviewerMayEdit=(status:PlanStatus|null)=>status==='sent'||status==='approved'||status==='approved_edited';
export const reviewerMayReturn=reviewerMayEdit;

/** A stop's state once the member worked: «تمت» (the same kind), «تمت بطريقة تواصل أخرى», still open, or taken out by the reviewer. */
export type StopCompletion='done'|'done_other'|'open'|'removed';
export const STOP_COMPLETION_TEXT:Record<StopCompletion,readonly [string,string]>={done:['تمت','Done'],done_other:['تمت بطريقة تواصل أخرى','Done by another contact'],open:['لم تتم','Not done'],removed:['حذفها المشرف','Removed by the supervisor']};
/** A visit or contact of the member's day that closed no stop: on a customer the plan does not name («خارج الخطة»), or another contact
 *  with a customer whose stops it already closed. */
export type ActivityPlace='planned'|'outside'|'extra';
export const ACTIVITY_PLACE_TEXT:Record<Exclude<ActivityPlace,'planned'>,readonly [string,string]>={outside:['خارج الخطة','Outside the plan'],extra:['تواصل إضافي مع عميل في الخطة','Additional contact with a planned customer']};
export type SupervisorState=''|'added'|'edited'|'removed';
export const SUPERVISOR_STATE_TEXT:Record<Exclude<SupervisorState,''>,readonly [string,string]>={added:['أضافها المشرف','Added by the supervisor'],edited:['عدّلها المشرف','Edited by the supervisor'],removed:['حذفها المشرف','Removed by the supervisor']};
/** What the member may not change or delete: what a reviewer added, changed or took out. */
export const lockedForMember=(state:SupervisorState)=>state!=='';

/** Who prepares plans (the cell «خطط المناديب · إضافة» decides beside it) and who reviews them («خطط المناديب · تحرير»). */
export const preparesPlans=(member:{role:string;active?:number|boolean}|null|undefined)=>!!member&&isFieldRole(member.role)&&member.active!==0&&member.active!==false;
export const PLAN_REVIEWER_ROLES=['admin','manager','supervisor'] as const;
export const reviewsPlans=(member:{role:string;active?:number|boolean}|null|undefined)=>!!member&&(PLAN_REVIEWER_ROLES as readonly string[]).includes(member.role)&&member.active!==0&&member.active!==false;

// ---- days and the deadline
/** A real calendar day 'YYYY-MM-DD', or ''. */
export function planDay(value:unknown):string{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return '';
 const at=Date.parse(value+'T00:00:00Z');return Number.isFinite(at)&&new Date(at).toISOString().slice(0,10)===value?value:'';
}
export const addDays=(day:string,days:number)=>new Date(Date.parse(day+'T12:00:00Z')+days*DAY_MS).toISOString().slice(0,10);
/** The day of an instant in Riyadh. */
export const riyadhDayOf=(at:string|number|Date)=>new Date((at instanceof Date?at.getTime():typeof at==='number'?at:Date.parse(at))+RIYADH_OFFSET_MS).toISOString().slice(0,10);
/** The hour (0..23) of an instant in Riyadh. */
export const riyadhHourOf=(at:string|number|Date)=>new Date((at instanceof Date?at.getTime():typeof at==='number'?at:Date.parse(at))+RIYADH_OFFSET_MS).getUTCHours();
export const isPlanWorkingDay=(day:string)=>!!planDay(day)&&WORKING_WEEKDAYS.includes(new Date(day+'T00:00:00Z').getUTCDay());
/** The day a member prepares now: the next working day after today (Thursday's is Saturday's: Friday is the weekly day off). */
export function nextPlanDay(today:string){let day=addDays(today,1);for(let guard=0;guard<7&&!isPlanWorkingDay(day);guard++)day=addDays(day,1);return day;}
const FRIDAY=5;
/** The hour of the deadline of the plan of `day`, on the day before: 22, or 24 (midnight at its end) when the day before is a Friday. */
export const planDeadlineHour=(day:string)=>new Date(addDays(day,-1)+'T00:00:00Z').getUTCDay()===FRIDAY?PLAN_FRIDAY_DEADLINE_HOUR:PLAN_DEADLINE_HOUR;
/** The deadline of the plan of `day`: 22:00 Riyadh on the day before (Saturday's: Saturday 00:00, the end of Friday), as an instant (ISO). */
export const planDeadline=(day:string)=>new Date(Date.parse(addDays(day,-1)+'T00:00:00Z')+planDeadlineHour(day)*3600_000-RIYADH_OFFSET_MS).toISOString();
/** The words of the deadline of the plan of `day` (PLAN_DEADLINE_TEXT). */
export const planDeadlineWords=(day:string)=>planDeadlineHour(day)===PLAN_FRIDAY_DEADLINE_HOUR?PLAN_DEADLINE_TEXT.friday:PLAN_DEADLINE_TEXT.normal;
/** Late: first sent at or after the deadline (sent at 21:59:59 is on time; at 22:00:00 it is late; Saturday's plan sent at Friday 23:59:59
 *  is on time, at Saturday 00:00:00 late). The flag is stored at the first send (crm_daily_plans.late) and never worked out again, so a
 *  plan sent before 2026-11-21 keeps the flag the 22:00 rule gave it. */
export const planLate=(sentAt:string,day:string)=>Date.parse(sentAt)>=Date.parse(planDeadline(day));
/** Whether a day may be planned now (today included, sent late, up to PLAN_AHEAD_DAYS ahead): the problem, or null. */
export function planDateProblem(day:unknown,today:string):'invalid'|'past'|'far'|null{
 const value=planDay(day);if(!value)return 'invalid';
 if(value<today)return 'past';
 return value>addDays(today,PLAN_AHEAD_DAYS)?'far':null;
}
/** When a send reached the supervisor: the device's clock for a send kept on the device (within the bounds), else the server's receipt. */
export function planSentAt(capture:{capturedAt:string;receivedAt:string}|null,receivedAt:string):{at:string;source:'device'|'server'}{
 if(!capture)return {at:receivedAt,source:'server'};
 const captured=Date.parse(capture.capturedAt),received=Date.parse(receivedAt);
 if(!Number.isFinite(captured)||!Number.isFinite(received)||captured>received+PLAN_CLOCK_SKEW_MS||received-captured>PLAN_OFFLINE_MAX_AGE_MS)return {at:receivedAt,source:'server'};
 return {at:new Date(captured).toISOString(),source:'device'};
}

// ---- stops
export type PlanStopInput={id?:string;customerId:string;kind:StopKind;time:string;note:string};
/** Arabic-Indic and Persian digits as Latin ones (a time typed on an Arabic keyboard). */
const latinDigits=(value:string)=>value.replace(/[٠-٩]/g,digit=>String(digit.charCodeAt(0)-0x660)).replace(/[۰-۹]/g,digit=>String(digit.charCodeAt(0)-0x6f0));
/** A stop's time: '' or 'HH:MM' (00:00 to 23:59), spaces trimmed and Arabic digits read; null when it is not one. */
export function planTime(value:unknown):string|null{
 if(value===undefined||value===null)return '';
 if(typeof value!=='string')return null;
 const text=latinDigits(value.trim());
 return text===''?'':/^([01]\d|2[0-3]):[0-5]\d$/.test(text)?text:null;
}
/** The text of a note or a reason: trimmed, at most `max`, without control characters other than new lines and tabs; null when not. */
export function planText(value:unknown,min:number,max:number):string|null{
 if(value===undefined||value===null)value='';
 if(typeof value!=='string')return null;
 const text=value.trim();
 if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))return null;
 return text.length<min||text.length>max?null:text;
}
const ID=/^[A-Za-z0-9_:.@-]{1,200}$/;
/** The stops a write sends, checked: the list and each stop's shape (the customers are checked by the server against what the writer sees).
 *  A stop's id names one stop: the same id twice is refused (a stop a reviewer added or changed, sent once as it is and once changed, would
 *  otherwise be changed under its «أضافها المشرف» without the member's lock or the customer check seeing it: memberLockProblems reads one
 *  copy, memberStops writes the other). The problem's index is the stop's (0-based), -1 for the list. */
export function parsePlanStops(value:unknown,{min=1}:{min?:number}={}):{ok:true;stops:PlanStopInput[]}|{ok:false;problem:'list'|'count'|'customer'|'kind'|'time'|'note';index:number}{
 if(!Array.isArray(value))return {ok:false,problem:'list',index:-1};
 if(value.length<min||value.length>PLAN_MAX_STOPS)return {ok:false,problem:'count',index:-1};
 const stops:PlanStopInput[]=[],ids=new Set<string>();
 for(const [index,raw] of value.entries()){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {ok:false,problem:'list',index};
  const item=raw as Record<string,unknown>,keys=Object.keys(item);
  if(keys.some(key=>!['id','customerId','kind','time','note'].includes(key)))return {ok:false,problem:'list',index};
  if(typeof item.customerId!=='string'||!ID.test(item.customerId))return {ok:false,problem:'customer',index};
  if(!isStopKind(item.kind))return {ok:false,problem:'kind',index};
  const time=planTime(item.time);if(time===null)return {ok:false,problem:'time',index};
  const note=planText(item.note,0,PLAN_STOP_NOTE_MAX);if(note===null)return {ok:false,problem:'note',index};
  if(item.id!==undefined&&item.id!==null&&item.id!==''&&(typeof item.id!=='string'||!ID.test(item.id)))return {ok:false,problem:'list',index};
  if(typeof item.id==='string'&&item.id){if(ids.has(item.id))return {ok:false,problem:'list',index};ids.add(item.id);}
  stops.push({...(typeof item.id==='string'&&item.id?{id:item.id}:{}),customerId:item.customerId,kind:item.kind,time,note});
 }
 return {ok:true,stops};
}
/** A stored stop as the rules read it. */
export type StoredStop={id:string;position:number;customerId:string;kind:StopKind;time:string;note:string;addedBy:string;supervisorState:SupervisorState;editedBy:string|null;createdAt:string};
const sameStop=(a:Pick<PlanStopInput,'customerId'|'kind'|'time'|'note'>,b:Pick<PlanStopInput,'customerId'|'kind'|'time'|'note'>)=>a.customerId===b.customerId&&a.kind===b.kind&&a.time===b.time&&a.note===b.note;
/** The member's write: every stop a reviewer added or changed must be sent back as it is (by its id; it may move in the order) and none
 *  taken out by a reviewer may come back by its id. The ids of the stops that break it, or none. */
export function memberLockProblems(existing:readonly StoredStop[],sent:readonly PlanStopInput[]):string[]{
 const byId=new Map(sent.filter(stop=>stop.id).map(stop=>[stop.id!,stop]));
 return existing.filter(stop=>{
  if(stop.supervisorState==='removed')return byId.has(stop.id);
  if(!lockedForMember(stop.supervisorState))return false;
  const again=byId.get(stop.id);return !again||!sameStop(again,stop);
 }).map(stop=>stop.id);
}
/** The stops after the member's write: the list sent, in its order (a known id of the member's own or a locked stop keeps the stop's
 *  history; any other id is a new stop), then the stops a reviewer took out, as they were. */
export function memberStops(existing:readonly StoredStop[],sent:readonly PlanStopInput[],memberId:string,at:string,newId:()=>string):StoredStop[]{
 const known=new Map(existing.filter(stop=>stop.supervisorState!=='removed').map(stop=>[stop.id,stop])),used=new Set<string>();
 const kept=sent.map((stop,index)=>{
  const before=stop.id&&!used.has(stop.id)?known.get(stop.id):undefined;if(before)used.add(before.id);
  return before?{...before,position:index+1,customerId:stop.customerId,kind:stop.kind,time:stop.time,note:stop.note}:{id:newId(),position:index+1,customerId:stop.customerId,kind:stop.kind,time:stop.time,note:stop.note,addedBy:memberId,supervisorState:'' as SupervisorState,editedBy:null,createdAt:at};
 });
 const removed=existing.filter(stop=>stop.supervisorState==='removed').map((stop,index)=>({...stop,position:kept.length+index+1}));
 return [...kept,...removed];
}
/** The stops after a reviewer's «اعتماد مع تعديل»: the list sent, in its order; a known stop changed becomes 'edited' (one the reviewers
 *  added stays 'added'), a new one 'added'; a stop of the member's not sent is kept as 'removed', one a reviewer added and now dropped is
 *  gone; the stops already taken out stay. `changed` says whether anything differs from before. */
export function reviewerStops(existing:readonly StoredStop[],sent:readonly PlanStopInput[],reviewerId:string,at:string,newId:()=>string):{stops:StoredStop[];changed:boolean}{
 const live=existing.filter(stop=>stop.supervisorState!=='removed'),known=new Map(live.map(stop=>[stop.id,stop])),used=new Set<string>();
 let changed=false;
 const kept=sent.map((stop,index)=>{
  const before=stop.id&&!used.has(stop.id)?known.get(stop.id):undefined;
  if(!before){changed=true;return {id:newId(),position:index+1,customerId:stop.customerId,kind:stop.kind,time:stop.time,note:stop.note,addedBy:reviewerId,supervisorState:'added' as SupervisorState,editedBy:reviewerId,createdAt:at};}
  used.add(before.id);
  if(before.position!==index+1)changed=true;
  if(sameStop(before,stop))return {...before,position:index+1};
  changed=true;
  return {...before,position:index+1,customerId:stop.customerId,kind:stop.kind,time:stop.time,note:stop.note,supervisorState:(before.supervisorState==='added'?'added':'edited') as SupervisorState,editedBy:reviewerId};
 });
 const dropped=live.filter(stop=>!used.has(stop.id));
 if(dropped.length)changed=true;
 const removed=[...existing.filter(stop=>stop.supervisorState==='removed'),...dropped.filter(stop=>stop.supervisorState!=='added').map(stop=>({...stop,supervisorState:'removed' as SupervisorState,editedBy:reviewerId}))];
 return {stops:[...kept,...removed.map((stop,index)=>({...stop,position:kept.length+index+1}))],changed};
}

// ---- completion
export type PlanActivity={id:string;customerId:string;type:string;at:string};
export type StopOutcome={id:string;state:StopCompletion;activityId:string|null;activityType:string|null;at:string|null};
export type ActivityOutcome={id:string;customerId:string;type:string;at:string;place:ActivityPlace;stopId:string|null};
export type PlanCounts={stops:number;done:number;doneOther:number;open:number;removed:number;outside:number;extra:number};
/** Which stop each visit or contact of the member's day closes. First every activity, in the order it was recorded, closes the first open
 *  stop (in the plan's order) of the same customer and the same kind; then each one left closes the first open stop of the same customer
 *  of another kind («تمت بطريقة تواصل أخرى»). One activity closes one stop. What is left is «خارج الخطة» when the plan does not name its
 *  customer, else an additional contact. The stops a reviewer took out are never closed. */
export function planCompletion(stops:readonly Pick<StoredStop,'id'|'position'|'customerId'|'kind'|'supervisorState'>[],activities:readonly PlanActivity[]):{stops:StopOutcome[];activities:ActivityOutcome[];counts:PlanCounts}{
 const ordered=[...stops].sort((a,b)=>a.position-b.position),live=ordered.filter(stop=>stop.supervisorState!=='removed');
 const acts=[...activities].sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
 const closedBy=new Map<string,{activity:PlanActivity;state:'done'|'done_other'}>(),used=new Map<string,string>();
 for(const activity of acts){
  const kind=activityStopKind(activity.type);if(kind==='other')continue;
  const stop=live.find(item=>!closedBy.has(item.id)&&item.customerId===activity.customerId&&item.kind===kind);
  if(stop){closedBy.set(stop.id,{activity,state:'done'});used.set(activity.id,stop.id);}
 }
 for(const activity of acts){
  if(used.has(activity.id))continue;
  const stop=live.find(item=>!closedBy.has(item.id)&&item.customerId===activity.customerId);
  if(stop){closedBy.set(stop.id,{activity,state:'done_other'});used.set(activity.id,stop.id);}
 }
 const planned=new Set(live.map(stop=>stop.customerId));
 const stopOutcomes=ordered.map(stop=>{
  if(stop.supervisorState==='removed')return {id:stop.id,state:'removed' as StopCompletion,activityId:null,activityType:null,at:null};
  const closed=closedBy.get(stop.id);
  return closed?{id:stop.id,state:closed.state as StopCompletion,activityId:closed.activity.id,activityType:closed.activity.type,at:closed.activity.at}:{id:stop.id,state:'open' as StopCompletion,activityId:null,activityType:null,at:null};
 });
 const activityOutcomes=acts.map(activity=>({id:activity.id,customerId:activity.customerId,type:activity.type,at:activity.at,place:(used.has(activity.id)?'planned':planned.has(activity.customerId)?'extra':'outside') as ActivityPlace,stopId:used.get(activity.id)||null}));
 const count=(state:StopCompletion)=>stopOutcomes.filter(stop=>stop.state===state).length;
 return {stops:stopOutcomes,activities:activityOutcomes,counts:{stops:live.length,done:count('done'),doneOther:count('done_other'),open:count('open'),removed:count('removed'),outside:activityOutcomes.filter(item=>item.place==='outside').length,extra:activityOutcomes.filter(item=>item.place==='extra').length}};
}

// ---- what the routes answer (GET /api/daily-plans)
export type PlanStopView={id:string;position:number;customerId:string;customerName:string;kind:StopKind;time:string;note:string;addedBy:string;addedByName:string;supervisorState:SupervisorState;editedByName:string;completion:StopCompletion;activityId:string|null;activityType:string|null;doneAt:string|null};
export type PlanActivityView={id:string;customerId:string;customerName:string;type:string;at:string;place:Exclude<ActivityPlace,'planned'>};
export type PlanNoteView={reviewerId:string;reviewerName:string;note:string;version:number;updatedAt:string};
/** The achieved numbers of the plan's day (lib/daily-plans-server.ts planActuals): counted from the records, never typed. */
export type PlanActual={opportunities:number;customers:number};
export type PlanView={ok:true;memberId:string;memberName:string;date:string;applies:boolean;id:string|null;state:PlanState;status:PlanStatus|null;version:number|null;late:boolean;deadline:string;firstSentAt:string|null;firstSentSource:'device'|'server'|null;sentAt:string|null;reviewedByName:string;reviewedAt:string|null;returnReason:string;updatedAt:string|null;
 stops:PlanStopView[];activities:PlanActivityView[];counts:PlanCounts;notes:PlanNoteView[];
 /** The day's targets (2026-11-22, migration 0025): both null for a plan made before them; `targetsEdited` when a reviewer changed them, with
  *  the member's own values in `repTargets`; `actual` from the plan's day on (null before it, or with no plan); `bulkMoves` the follow-ups the
  *  member moved with the bulk «ترحيل» from this day's plan. A server before 2026-11-22 sends none of them (withTargets). */
 targets:PlanTargets;targetsEdited:boolean;repTargets:PlanTargets|null;actual:PlanActual|null;bulkMoves:PlanBulkMove[];
 /** What the reader may do now. */
 canEdit:boolean;canApprove:boolean;canReviewEdit:boolean;canReturn:boolean;canNote:boolean;myNote:PlanNoteView|null;serverTime:string};
export type PlanListRow={memberId:string;name:string;role:string;state:PlanState;version:number|null;late:boolean;overdue:boolean;firstSentAt:string|null;reviewedByName:string;counts:PlanCounts;notes:number;
 targets?:PlanTargets;targetsEdited?:boolean;actual?:PlanActual|null;bulkMoves?:number};
/** A plan read from a server before 2026-11-22 (after a rollback) has no targets: none set, not edited, nothing achieved or moved. */
export function withTargets<T extends PlanView|null>(plan:T):T{
 if(!plan)return plan;
 const targets=plan.targets&&typeof plan.targets==='object'?{opportunities:plan.targets.opportunities??null,customers:plan.targets.customers??null}:NO_TARGETS;
 return {...plan,targets,targetsEdited:plan.targetsEdited===true,repTargets:plan.targetsEdited===true&&plan.repTargets?plan.repTargets:null,actual:plan.actual??null,bulkMoves:Array.isArray(plan.bulkMoves)?plan.bulkMoves:[]};
}
export type PlanList={ok:true;date:string;deadline:string;workingDay:boolean;rows:PlanListRow[];serverTime:string};
export type PlanExport={ok:true;from:string;to:string;plans:PlanView[]};
/** GET /api/daily-plans/inbox: for a member who prepares plans, the next day's plan and today's, and what a reviewer decided lately; for a
 *  reviewer, the sent plans waiting for them and how many of their team have not sent the next day's plan after the deadline. */
export type PlanInboxDay={date:string;state:PlanState;late:boolean;deadline:string;version:number|null;returnReason:string;reviewedByName:string};
export type PlanInbox={ok:true;serverTime:string;role:'member'|'reviewer'|'none';
 next?:PlanInboxDay;today?:PlanInboxDay|null;
 pending?:{memberId:string;name:string;date:string;late:boolean;firstSentAt:string|null;version:number}[];missing?:{date:string;names:string[]}};

const text=(value:unknown)=>typeof value==='string';
const nullableText=(value:unknown)=>value===null||text(value);
const count=(value:unknown)=>Number.isInteger(value)&&(value as number)>=0;
const isState=(value:unknown):value is PlanState=>value==='missing'||(PLAN_STATUSES as readonly unknown[]).includes(value);
const validCounts=(value:unknown)=>!!value&&typeof value==='object'&&['stops','done','doneOther','open','removed','outside','extra'].every(key=>count((value as Record<string,unknown>)[key]));
const validNote=(value:unknown)=>!!value&&typeof value==='object'&&['reviewerId','reviewerName','note','updatedAt'].every(key=>text((value as Record<string,unknown>)[key]))&&Number.isInteger((value as PlanNoteView).version);
export const validPlanView=(value:unknown):value is PlanView=>{
 if(!value||typeof value!=='object')return false;
 const plan=value as PlanView;
 return plan.ok===true&&['memberId','memberName','date','deadline','reviewedByName','returnReason','serverTime'].every(key=>text((plan as unknown as Record<string,unknown>)[key]))&&isState(plan.state)&&typeof plan.applies==='boolean'&&typeof plan.late==='boolean'
  &&Array.isArray(plan.stops)&&plan.stops.every(stop=>!!stop&&['id','customerId','customerName','time','note','addedBy','addedByName','editedByName'].every(key=>text((stop as unknown as Record<string,unknown>)[key]))&&isStopKind(stop.kind)&&Number.isInteger(stop.position)&&(['','added','edited','removed'] as unknown[]).includes(stop.supervisorState)&&Object.prototype.hasOwnProperty.call(STOP_COMPLETION_TEXT,stop.completion))
  &&Array.isArray(plan.activities)&&plan.activities.every(item=>!!item&&['id','customerId','customerName','type','at'].every(key=>text((item as unknown as Record<string,unknown>)[key]))&&(item.place==='outside'||item.place==='extra'))
  &&validCounts(plan.counts)&&Array.isArray(plan.notes)&&plan.notes.every(validNote)&&(plan.myNote===null||validNote(plan.myNote))
  &&['canEdit','canApprove','canReviewEdit','canReturn','canNote'].every(key=>typeof (plan as unknown as Record<string,unknown>)[key]==='boolean')
  &&nullableText(plan.firstSentAt)&&nullableText(plan.sentAt)&&nullableText(plan.reviewedAt);
};
export const validPlanList=(value:unknown):value is PlanList=>!!value&&typeof value==='object'&&(value as PlanList).ok===true&&text((value as PlanList).date)&&Array.isArray((value as PlanList).rows)&&(value as PlanList).rows.every(row=>!!row&&text(row.memberId)&&text(row.name)&&isState(row.state)&&typeof row.late==='boolean'&&typeof row.overdue==='boolean'&&validCounts(row.counts)&&count(row.notes));
export const validPlanExport=(value:unknown):value is PlanExport=>!!value&&typeof value==='object'&&(value as PlanExport).ok===true&&Array.isArray((value as PlanExport).plans)&&(value as PlanExport).plans.every(validPlanView);
const validInboxDay=(value:unknown)=>!!value&&typeof value==='object'&&text((value as PlanInboxDay).date)&&isState((value as PlanInboxDay).state)&&typeof (value as PlanInboxDay).late==='boolean';
export const validPlanInbox=(value:unknown):value is PlanInbox=>{
 if(!value||typeof value!=='object')return false;
 const inbox=value as PlanInbox;
 if(inbox.ok!==true||!['member','reviewer','none'].includes(inbox.role))return false;
 if(inbox.next!==undefined&&!validInboxDay(inbox.next))return false;
 if(inbox.today!==undefined&&inbox.today!==null&&!validInboxDay(inbox.today))return false;
 if(inbox.pending!==undefined&&!(Array.isArray(inbox.pending)&&inbox.pending.every(item=>!!item&&text(item.memberId)&&text(item.name)&&text(item.date)&&typeof item.late==='boolean')))return false;
 return inbox.missing===undefined||!!inbox.missing&&text(inbox.missing.date)&&Array.isArray(inbox.missing.names)&&inbox.missing.names.every(text);
};

// ---- the reminder cards (app/daily-plans.tsx PlanInboxCard)
export type PlanReminderLine={key:string;tone:'due'|'late'|'returned'|'approved'|'pending'|'missing';date:string;memberId?:string};
/** What the cards say now. A member: the next day's plan returned (always), not sent from 16:00 (late from its deadline: 22:00, or for
 *  Saturday's plan midnight at the end of Friday), today's not sent (a working day); a reviewer: each plan waiting for them, and after the
 *  deadline who of their team has not sent the next day's plan (the server decides: lib/daily-plans-server.ts readPlanInbox). The
 *  notification keys name the plan and its version, so each is announced once. */
export function planReminderLines(inbox:PlanInbox|null,now:string|number=Date.now()):PlanReminderLine[]{
 if(!inbox)return [];
 const at=typeof now==='number'?now:Date.parse(now),hour=riyadhHourOf(at),day=riyadhDayOf(at),lines:PlanReminderLine[]=[];
 if(inbox.role==='member'){
  const next=inbox.next,current=inbox.today;
  if(current&&(current.state==='missing'||current.state==='draft'))lines.push({key:'missing-today:'+current.date,tone:'late',date:current.date});
  if(current&&current.state==='returned')lines.push({key:'returned:'+current.date+':'+current.version,tone:'returned',date:current.date});
  if(next){
   const overdue=at>=Date.parse(next.deadline);
   if(next.state==='returned')lines.push({key:'returned:'+next.date+':'+next.version,tone:'returned',date:next.date});
   else if(next.state==='missing'||next.state==='draft'){
    if(overdue)lines.push({key:'late:'+next.date,tone:'late',date:next.date});
    else if(day===addDays(next.date,-1)&&hour>=PLAN_REMINDER_FROM_HOUR)lines.push({key:'due:'+next.date,tone:'due',date:next.date});
   }else if(next.state==='approved'||next.state==='approved_edited')lines.push({key:'approved:'+next.date+':'+next.version,tone:'approved',date:next.date});
  }
 }else if(inbox.role==='reviewer'){
  for(const item of inbox.pending||[])lines.push({key:'pending:'+item.memberId+':'+item.date+':'+item.version,tone:'pending',date:item.date,memberId:item.memberId});
  if(inbox.missing?.names.length)lines.push({key:'missing:'+inbox.missing.date+':'+inbox.missing.names.length,tone:'missing',date:inbox.missing.date});
 }
 return lines;
}
/** Which lines a device notification announces: the ones not announced before in this browser (kept per member, at most 100 keys), and
 *  only those worth a notification (a due plan from 20:00, a late or returned plan, a plan waiting for the reviewer); the first check in a
 *  browser that remembers nothing announces nothing (the card shows them). */
export const PLAN_NOTICE_REMEMBER=100;
export const planNoticeStorageKey=(memberId:string)=>'yourrest.daily-plans.seen:'+memberId;
export function rememberedPlanNotices(raw:string|null|undefined):string[]|null{
 if(typeof raw!=='string')return null;
 try{const value:unknown=JSON.parse(raw);return Array.isArray(value)?value.filter((key):key is string=>typeof key==='string'&&key.length<=300).slice(0,PLAN_NOTICE_REMEMBER):null;}catch{return null;}
}
export function planNoticeStep(lines:readonly PlanReminderLine[],remembered:readonly string[]|null,now:string|number=Date.now()):{announce:PlanReminderLine[];remember:string[]}{
 const hour=riyadhHourOf(now),worth=lines.filter(line=>line.tone!=='due'||hour>=PLAN_NOTICE_FROM_HOUR),keys=worth.map(line=>line.key);
 if(remembered===null)return {announce:[],remember:[...new Set(keys)].slice(0,PLAN_NOTICE_REMEMBER)};
 const known=new Set(remembered);
 return {announce:worth.filter(line=>!known.has(line.key)),remember:[...new Set([...keys,...remembered])].slice(0,PLAN_NOTICE_REMEMBER)};
}

/** The server's refusals (Arabic; lib/locales/en.json has their English). */
export const PLAN_MESSAGES={
 invalid:'بيانات الخطة غير صحيحة.',
 role:'إعداد خطة اليوم متاح للمندوب ومسؤول التسويق فقط.',
 reviewRole:'مراجعة خطط المناديب متاحة للمشرف ومدير المبيعات ومدير النظام فقط.',
 scope:'المندوب خارج نطاق فريقك.',
 notField:'خطة اليوم للمندوب ومسؤول التسويق فقط.',
 date:'اختر يوم الخطة: اليوم أو يومًا خلال الأيام السبعة القادمة.',
 past:'انتهى يوم هذه الخطة؛ لا يمكن تعديلها.',
 count:`الخطة تحتاج محطة واحدة على الأقل، وحتى ${PLAN_MAX_STOPS} محطة.`,
 customer:'اختر العميل من عملاء مناطقك في كل محطة.',
 kind:'اختر نوع كل محطة: زيارة أو اتصال أو واتساب.',
 time:'وقت المحطة غير صحيح. اكتبه بصيغة الساعات والدقائق (مثل 09:30).',
 note:`ملاحظة المحطة حتى ${PLAN_STOP_NOTE_MAX} حرف.`,
 conflict:'تغيّرت الخطة منذ فتحها. حدّث الصفحة قبل الحفظ.',
 sentNoDraft:'أُرسلت الخطة؛ عدّلها ثم أرسلها مرة أخرى.',
 approved:'الخطة معتمدة؛ لا يمكنك تعديلها. اطلب من المشرف إعادتها إليك إذا احتجت إلى تعديلها.',
 locked:'لا يمكنك حذف محطة أضافها المشرف أو عدّلها، ولا تغييرها.',
 notSent:'لم تُرسل خطة لهذا اليوم بعد.',
 cannotApprove:'يُعتمد ما أُرسل ولم يُعتمد بعد. حدّث الصفحة.',
 cannotEdit:'لا يمكن تعديل الخطة الآن. حدّث الصفحة.',
 unchanged:'لم تغيّر شيئًا في الخطة؛ اضغط «اعتماد» إذا كانت مناسبة كما هي.',
 reason:`اكتب سبب الإعادة (${PLAN_REASON_MIN} أحرف على الأقل، وحتى ${PLAN_REASON_MAX} حرف).`,
 noteText:`اكتب الملاحظة (حرفان على الأقل، وحتى ${PLAN_NOTE_MAX} حرف).`,
 noteConflict:'تغيّرت ملاحظتك على هذا اليوم. حدّث الصفحة قبل الحفظ.',
 noteFuture:'لا يمكن كتابة ملاحظة على يوم بعد الأيام السبعة القادمة.',
 own:'لا تراجع خطتك أنت.',
 followupsOnly:'تُضاف إلى الخطة المتابعات فقط؛ لم تعد إضافة عميل دون متابعة إلى الخطة متاحة.',
 pageOutdated:'حُدّث التطبيق؛ أعد تحميل الصفحة.',
 range:`اختر فترة التصدير: من يوم إلى يوم، حتى ${PLAN_EXPORT_MAX_DAYS} يومًا.`
} as const;
