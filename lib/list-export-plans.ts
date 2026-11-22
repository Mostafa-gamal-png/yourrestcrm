// «تصدير Excel» of «خطط المناديب» (lib/daily-plans.ts; the list-export pattern of lib/list-export.ts): the plans of a period the page asks of
// GET /api/daily-plans?from=&to= (the reviewer's team, the working days without a plan included), in three sheets: «الخطط» (one row per
// member and day), «المحطات» (one row per stop, with what became of it) and «خارج الخطة» (the visits and contacts that closed no stop).
// Pure: the page (app/daily-plans.tsx) and the tests build the same file.
import {dayCell,exportTable,momentCell,numberCell,sayIn,textCell,yesNo,type ExportColumn,type ExportLanguage,type ExportTable} from './list-export';
import {ACTIVITY_PLACE_TEXT,PLAN_LATE_TEXT,PLAN_STATE_TEXT,PLAN_UNAPPROVED_TEXT,STOP_COMPLETION_TEXT,STOP_KIND_TEXT,stopMark,stopMarkText,type PlanActivityView,type PlanStopView,type PlanView} from './daily-plans';
import {ACTIVITY_TYPE_TEXT} from './supervisor-reviews';
import type {PlanTargets} from './daily-plan-followups';

type StopRow={plan:PlanView;stop:PlanStopView};
type ActivityRow={plan:PlanView;activity:PlanActivityView};
const pair=(words:readonly [string,string],language:ExportLanguage)=>language==='en'?words[1]:words[0];

const target=(value:number|null|undefined)=>value===null||value===undefined?'':numberCell(value);
const repTargets=(value:PlanTargets)=>[value.opportunities??'–',value.customers??'–'].join(' / ');
/** The mark of a stop a reviewer decided (a plan read from a server before 2026-11-22 has none: the supervisor's, by its stored state). */
const markOf=(stop:PlanStopView)=>stop.mark===undefined?stopMark(stop.supervisorState,undefined):stop.mark;
const EDITOR_TEXT={supervisor:['المشرف','The supervisor'],manager:['مدير المبيعات','The sales manager']} as const;
export function planTables(plans:readonly PlanView[],language:ExportLanguage):ExportTable[]{
 const say=sayIn(language);
 const planColumns:ExportColumn<PlanView>[]=[
  ['المندوب','Representative',plan=>textCell(plan.memberName)],
  ['يوم الخطة','Plan day',plan=>dayCell(plan.date)],
  // «غير معتمدة» (GSCO 2.13.86): sent and not approved by midnight at the start of its day, as the page shows it.
  ['الحالة','Status',plan=>pair(plan.unapproved?PLAN_UNAPPROVED_TEXT:PLAN_STATE_TEXT[plan.state],language)],
  [PLAN_LATE_TEXT[0],PLAN_LATE_TEXT[1],plan=>plan.state==='missing'?'':yesNo(plan.late,say)],
  ['أول إرسال','First sent',plan=>momentCell(plan.firstSentAt)],
  ['وقت الإرسال من','Send time from',plan=>plan.firstSentSource==='device'?say('ساعة الجهاز','The device clock'):plan.firstSentSource==='server'?say('الخادم','The server'):''],
  ['آخر موعد للإرسال','Send deadline',plan=>momentCell(plan.deadline)],
  ['المراجع','Reviewer',plan=>textCell(plan.reviewedByName)],
  ['وقت المراجعة','Reviewed at',plan=>momentCell(plan.reviewedAt)],
  ['سبب الإعادة','Return reason',plan=>textCell(plan.returnReason)],
  ['عدد المحطات','Stops',plan=>numberCell(plan.counts.stops)],
  [STOP_COMPLETION_TEXT.done[0],STOP_COMPLETION_TEXT.done[1],plan=>numberCell(plan.counts.done)],
  [STOP_COMPLETION_TEXT.done_other[0],STOP_COMPLETION_TEXT.done_other[1],plan=>numberCell(plan.counts.doneOther)],
  [STOP_COMPLETION_TEXT.open[0],STOP_COMPLETION_TEXT.open[1],plan=>numberCell(plan.counts.open)],
  [STOP_COMPLETION_TEXT.removed[0],STOP_COMPLETION_TEXT.removed[1],plan=>numberCell(plan.counts.removed)],
  [ACTIVITY_PLACE_TEXT.outside[0],ACTIVITY_PLACE_TEXT.outside[1],plan=>numberCell(plan.counts.outside)],
  [ACTIVITY_PLACE_TEXT.extra[0],ACTIVITY_PLACE_TEXT.extra[1],plan=>numberCell(plan.counts.extra)],
  ['ملاحظات المراجعين','Reviewers\' notes',plan=>textCell(plan.notes.map(note=>note.reviewerName+': '+note.note).join('\n'))],
  // The day's targets and what was achieved (2026-11-22, the port of GSCO 2.13.85); a plan read from a server before it has none.
  ['مستهدف فرص البيع الجديدة','Target: new sales opportunities',plan=>target(plan.targets?.opportunities)],
  ['فرص البيع الجديدة المحققة','Achieved: new sales opportunities',plan=>numberCell(plan.actual?.opportunities??null)],
  ['مستهدف العملاء الجدد','Target: new customers',plan=>target(plan.targets?.customers)],
  ['العملاء الجدد المحققون','Achieved: new customers',plan=>numberCell(plan.actual?.customers??null)],
  ['عدّل المشرف المستهدف','Supervisor changed the targets',plan=>plan.state==='missing'?'':yesNo(plan.targetsEdited===true&&plan.targetsEditedBy!=='manager',say)],
  ['مستهدف المندوب قبل التعديل','Representative\'s targets before the change',plan=>plan.targetsEdited&&plan.repTargets?textCell(repTargets(plan.repTargets)):''],
  ['ترحيل جماعي','Bulk move',plan=>numberCell(plan.bulkMoves?.length||0)],
  // GSCO 2.13.86 (2026-11-22): the sales manager changed the targets or the plan (their marks are on the stops and the targets).
  ['عدّل مدير المبيعات المستهدف','Sales manager changed the targets',plan=>plan.state==='missing'?'':yesNo(plan.targetsEditedBy==='manager',say)],
  ['عدّل مدير المبيعات الخطة','Sales manager changed the plan',plan=>plan.state==='missing'?'':yesNo(!!plan.managerEdit,say)],
  ['آخر تعديل من مدير المبيعات','Sales manager\'s last change',plan=>momentCell(plan.managerEdit?.at??null)]
 ];
 const stopColumns:ExportColumn<StopRow>[]=[
  ['المندوب','Representative',row=>textCell(row.plan.memberName)],
  ['يوم الخطة','Plan day',row=>dayCell(row.plan.date)],
  ['الترتيب','Order',row=>numberCell(row.stop.position)],
  ['العميل','Customer',row=>textCell(row.stop.customerName||say('عميل غير متاح','Customer not available'))],
  ['النوع','Kind',row=>pair(STOP_KIND_TEXT[row.stop.kind],language)],
  ['الوقت','Time',row=>textCell(row.stop.time)],
  ['الملاحظة','Note',row=>textCell(row.stop.note)],
  ['تعديل المشرف','Supervisor\'s change',row=>{const mark=markOf(row.stop);return mark?pair(stopMarkText(mark.kind,mark.by),language)+(row.stop.editedByName?' · '+row.stop.editedByName:''):'';}],
  ['من عدّلها','Changed by',row=>{const mark=markOf(row.stop);return mark?pair(EDITOR_TEXT[mark.by],language):'';}],
  ['التنفيذ','Done',row=>pair(STOP_COMPLETION_TEXT[row.stop.completion],language)],
  ['نوع التواصل المسجل','Recorded contact',row=>row.stop.activityType?pair(ACTIVITY_TYPE_TEXT[row.stop.activityType]||['تواصل','Contact'],language):''],
  ['وقت التسجيل','Recorded at',row=>momentCell(row.stop.doneAt)]
 ];
 const activityColumns:ExportColumn<ActivityRow>[]=[
  ['المندوب','Representative',row=>textCell(row.plan.memberName)],
  ['اليوم','Day',row=>dayCell(row.plan.date)],
  ['العميل','Customer',row=>textCell(row.activity.customerName||say('عميل غير متاح','Customer not available'))],
  ['نوع التواصل','Contact',row=>pair(ACTIVITY_TYPE_TEXT[row.activity.type]||['تواصل','Contact'],language)],
  ['وقت التسجيل','Recorded at',row=>momentCell(row.activity.at)],
  ['التصنيف','Classification',row=>pair(ACTIVITY_PLACE_TEXT[row.activity.place],language)]
 ];
 return [
  exportTable(['الخطط','Plans'],planColumns,plans,language),
  exportTable(['المحطات','Stops'],stopColumns,plans.flatMap(plan=>plan.stops.map(stop=>({plan,stop}))),language),
  exportTable(['خارج الخطة','Outside the plan'],activityColumns,plans.flatMap(plan=>plan.activities.map(activity=>({plan,activity}))),language)
 ];
}
