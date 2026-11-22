/** «خطتي» (2026-11-22, the port of GSCO 2.13.86; the owner of GSCO, 2026-11-21: «سيب متابعاتى زى مهى وخلى فيه شاشة لخطتى ... الخطة تكون
 * مترتبة يضغط على كل عنصر مطلوب يفتح المتابعة بتاعته»): a representative's or a marketing officer's plan of TODAY, in its order, with its
 * state on top. A tap on a stop not done yet opens the follow-up form of its customer (the same checks as «المتابعات»: app/crm-app.tsx
 * openFollowup); a stop done opens the customer; a stop whose customer is gone says so instead of doing nothing. Under the stops, the day's
 * targets beside what was achieved. «المتابعات» is unchanged. Pure: the page (app/my-plan.tsx) and the tests read the same rules here. */
import {STOP_COMPLETION_TEXT,addDays,planUnapproved,riyadhDayOf,type PlanState,type PlanStopView,type PlanView,type StopCompletion} from './daily-plans';
import {visitCustomer} from './customer-visits';
import type {Row} from './crm';

type Words=readonly [string,string];
/** The banner of the plan: approved, approved with edits, «غير معتمدة» (sent or returned and its day begun without an approval), sent and
 *  waiting (before its day: not for today's plan, kept for a copy read early), returned, a draft never sent, or no plan; «متأخرة» beside a
 *  plan first sent late. */
export type MyPlanBanner={key:'approved'|'approved_edited'|'unapproved'|'waiting'|'returned'|'draft'|'missing';text:Words;tone:'green'|'amber'|'blue'|'red';late:boolean;note:Words};
export function myPlanBanner(plan:Pick<PlanView,'state'|'date'|'late'>|null|undefined,today:string):MyPlanBanner{
 const state:PlanState=plan?.state??'missing',late=!!plan&&state!=='missing'&&state!=='draft'&&plan.late;
 if(state==='approved')return {key:'approved',text:['معتمدة','Approved'],tone:'green',late,note:['اعتُمدت الخطة؛ نفّذها بترتيبها.','The plan was approved; carry it out in its order.']};
 if(state==='approved_edited')return {key:'approved_edited',text:['معتمدة مع تعديل','Approved with edits'],tone:'green',late,note:['اعتُمدت الخطة مع تعديلات معلَّمة على المحطات؛ نفّذها كما اعتُمدت.','The plan was approved with edits marked on the stops; carry it out as approved.']};
 if(plan&&planUnapproved({state,date:plan.date},today))return {key:'unapproved',text:['غير معتمدة','Not approved'],tone:'amber',late,note:['لم يعتمد المشرف الخطة قبل منتصف الليل؛ تبقى خطتك كما أرسلتها، فنفّذها وسجّل متابعاتك كالمعتاد.','Your supervisor did not approve the plan before midnight; it stays as you sent it, so carry it out and record your follow-ups as usual.']};
 if(state==='returned')return {key:'returned',text:['أُعيدت للمندوب','Returned to the representative'],tone:'red',late,note:['أعاد المشرف الخطة؛ عدّلها من «خطة الغد» وأرسلها.','Your supervisor returned the plan; change it in “Tomorrow\'s plan” and send it.']};
 if(state==='sent')return {key:'waiting',text:['بانتظار الاعتماد','Waiting for approval'],tone:'blue',late,note:['الخطة لم تُعتمد بعد. سجّل زياراتك ومتابعاتك كالمعتاد.','The plan is not approved yet. Record your visits and follow-ups as usual.']};
 if(state==='draft')return {key:'draft',text:['مسودة لم تُرسل','Draft, not sent'],tone:'amber',late:false,note:['لم تُرسل هذه الخطة إلى المشرف؛ تظهر كما حفظتها.','This plan was not sent to your supervisor; it shows as you saved it.']};
 return {key:'missing',text:['لا توجد خطة لهذا اليوم','No plan for today'],tone:'amber',late:false,note:['أعدّ خطة الغد وأرسلها إلى المشرف قبل الساعة 12:00 منتصف الليل.','Prepare tomorrow\'s plan and send it to your supervisor before 12:00 midnight.']};
}

/** The stops of «خطتي»: the plan's live stops in its order (the ones a reviewer took out are left out). */
export const myPlanStops=(plan:Pick<PlanView,'stops'>|null|undefined)=>(plan?.stops||[]).filter(stop=>stop.supervisorState!=='removed').slice().sort((a,b)=>a.position-b.position);

/** What a tap on a stop does: the follow-up form of its customer (not done yet), the customer (done), or a message (the customer is gone:
 *  deleted, or moved to another representative, so it is not among the records the member holds). */
export type StopTap={kind:'followup';customerId:string}|{kind:'customer';customerId:string}|{kind:'gone';message:Words};
export const CUSTOMER_GONE:Words=['لم يعد هذا العميل متاحًا لك: حُذف أو نُقل إلى مندوب آخر. حدّث البيانات أو راجع المشرف.','This customer is no longer available to you: it was deleted or moved to another representative. Refresh the data or ask your supervisor.'];
const closed=(completion:StopCompletion)=>completion==='done'||completion==='done_other';
export function stopTap(stop:Pick<PlanStopView,'customerId'|'completion'>,customerIds:ReadonlySet<string>):StopTap{
 if(!customerIds.has(stop.customerId))return {kind:'gone',message:CUSTOMER_GONE};
 return closed(stop.completion)?{kind:'customer',customerId:stop.customerId}:{kind:'followup',customerId:stop.customerId};
}
/** What the button says it does. */
export const TAP_HINT:Record<StopTap['kind'],Words>={followup:['سجّل المتابعة','Record the follow-up'],customer:['فتح العميل','Open the customer'],gone:['لم يعد متاحًا','No longer available']};
/** The state written on a stop: «تمت», «تمت بطريقة تواصل أخرى», «لم تتم بعد». */
export const stopDoneText=(completion:StopCompletion):Words=>completion==='open'?['لم تتم بعد','Not done yet']:STOP_COMPLETION_TEXT[completion];

/** A visit or contact the member recorded on this device today and still waiting for the connection, on this customer: it is sent with its
 *  own time and closes the stop once the server has it (the stop says «سُجّلت على الجهاز» meanwhile). */
export function queuedToday(customerId:string,records:readonly Row[],today:string){
 return records.some(row=>{
  if(row.kind!=='activity'||!row.data?._offlineState||row.data.visitWorkflow==='service-intake-v1')return false;
  const at=typeof row.data.offlineRecordedAt==='string'&&Number.isFinite(Date.parse(row.data.offlineRecordedAt))?row.data.offlineRecordedAt:row.createdAt;
  const day=typeof row.data.date==='string'&&row.data.date?row.data.date:at?riyadhDayOf(at):'';
  return day===today&&visitCustomer(row,records as Row[])?.id===customerId;
 });
}

/** The milliseconds from `now` to the next midnight in Riyadh (at least one second), when «خطتي» turns to the next day's plan: it never
 *  shows yesterday's plan after midnight. */
export function msToRiyadhMidnight(now:number){
 const next=Date.parse(addDays(riyadhDayOf(now),1)+'T00:00:00+03:00');
 return Math.max(1000,next-now);
}
