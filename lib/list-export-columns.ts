// The columns of the lists «تصدير Excel» writes from what the page holds (lib/list-export.ts says which lists and who; the owner,
// 2026-11-19, GSCO 2.13.80): «المتابعات»، «المنافسون» and «تقرير يوم المندوب» («طلبات تصنيع القوالب» is lib/list-export-mold.ts, so the
// other pages never load the mold modules). Each takes exactly the rows the page
// shows after its filters (never the page of 25 alone) and words its cells as the page does: the page's own labels in Arabic, their
// English through the page's translator (`tr`, lib/i18n.ts t; the identity in Arabic), and what people wrote as they wrote it. Pure.
import {exportTable,dayCell,momentCell,yesNo,sayIn,type ExportColumn,type ExportLanguage,type ExportTable} from './list-export';
import {stageLabels,today,type Member,type Row} from './crm';
import {JOURNEY_CONTACT_TEXT,JOURNEY_STATE_TEXT,journeyDate,journeyStopState} from './journeys';
import {customerFollowupPlans,followupTypes} from './customer-followups';
import {visitCustomer} from './customer-visits';
import {contactTypes} from './visits';
import type {CompetitorEntry,CompetitorObservation} from './competitors';
import type {JourneyCommunication,JourneyReportData,JourneyReportStop,JourneyResult} from './journeys';

type Translate=(text:string)=>string;
const same:Translate=text=>text;
const joinIn=(language:ExportLanguage)=>language==='en'?', ':'، ';

// ---- «المتابعات» (app/customer-followup-list.tsx)
export type FollowupPlan=ReturnType<typeof customerFollowupPlans>[number];
/** The tab of the page: one of the plans' tabs, or «سجل المتابعات». */
export type FollowupTab='open'|'due'|'upcoming'|'closed'|'history';
/** Where a plan stands, as the page's chip says it. */
export function followupPlanStatus(plan:FollowupPlan,day:string):'closed'|'incomplete'|'overdue'|'today'|'upcoming'{
 return plan.closed?'closed':!plan.nextDate||!plan.nextAction?'incomplete':plan.nextDate<day?'overdue':plan.nextDate===day?'today':'upcoming';
}
const FOLLOWUP_STATUS:Record<ReturnType<typeof followupPlanStatus>,readonly [string,string]>={closed:['مغلقة','Closed'],incomplete:['حدد الخطوة القادمة','Set the next step'],overdue:['متأخرة','Overdue'],today:['اليوم','Today'],upcoming:['قادمة','Upcoming']};
const FOLLOWUP_TABS:Record<FollowupTab,readonly [string,string]>={open:['المتابعات المفتوحة','Open follow-ups'],due:['اليوم والمتأخرة','Today and overdue'],upcoming:['المتابعات القادمة','Upcoming follow-ups'],closed:['المتابعات المغلقة','Closed follow-ups'],history:['سجل المتابعات','Follow-up history']};
/** The tab shown, every row of it: a plan per customer (the four plan tabs) or a follow-up done («سجل المتابعات»). */
export function followupTables(input:{tab:FollowupTab;plans:readonly FollowupPlan[];history:readonly Row[];records:Row[];members:readonly Member[];day?:string},language:ExportLanguage,tr:Translate=same):ExportTable[]{
 const say=sayIn(language),name=(id:string)=>input.members.find(member=>member.id===id)?.name||'',day=input.day||today();
 const stage=(key:string)=>stageLabels[key]?tr(stageLabels[key]):key;
 if(input.tab==='history'){
  const columns:ExportColumn<Row>[]=[
   ['العميل','Customer',r=>visitCustomer(r,input.records)?.data.name||''],['تاريخ المتابعة المنفذة','Follow-up date',r=>dayCell(r.data.date)],
   ['نوع المتابعة','Follow-up type',r=>followupTypes[r.data.type]?tr(followupTypes[r.data.type]):r.data.type||''],['نتيجة المتابعة','Follow-up result',r=>r.data.result||''],
   ['مرحلة البيع','Sales stage',r=>stage(r.data.salesStage||'')],['الإجراء القادم','Next action',r=>r.data.nextAction||''],['موعد المتابعة القادمة','Next follow-up date',r=>dayCell(r.data.nextDate)],
   ['إعادة تواصل','Re-contact',r=>r.data.recontact?say('نعم','Yes'):''],['المندوب','Representative',r=>name(r.data.performedBy)||r.data.recordedByName||''],
  ];
  return [exportTable(FOLLOWUP_TABS.history,columns,input.history,language)];
 }
 const columns:ExportColumn<FollowupPlan>[]=[
  ['العميل','Customer',p=>p.customer.data.name||''],['كود ERP','ERP code',p=>p.customer.data.code||''],['المنطقة','Region',p=>p.customer.data.region?tr(p.customer.data.region):''],['المدينة','City',p=>p.customer.data.city||''],
  ['آخر نتيجة','Last result',p=>p.source.data.result||''],['تاريخ آخر نتيجة','Last result date',p=>dayCell(p.source.data.date)],['مرحلة البيع','Sales stage',p=>stage(p.stage)],
  ['إعادة تواصل','Re-contact',p=>p.recontact?say('نعم','Yes'):''],['الإجراء القادم','Next action',p=>p.nextAction],['موعد المتابعة القادمة','Next follow-up date',p=>p.closed?'':dayCell(p.nextDate)],
  ['الحالة','Status',p=>say(...FOLLOWUP_STATUS[followupPlanStatus(p,day)])],['المندوب المسؤول','Responsible representative',p=>name(p.responsibleId)],
 ];
 return [exportTable(FOLLOWUP_TABS[input.tab],columns,input.plans,language)];
}

// ---- «المنافسون» (app/competitors-workspace.tsx)
/** The competitors the list shows (its region, period and search) and every contact recorded with them in that scope. */
export function competitorTables(entries:readonly CompetitorEntry[],language:ExportLanguage,tr:Translate=same):ExportTable[]{
 const join=joinIn(language),stage=(key:string)=>stageLabels[key]?tr(stageLabels[key]):key;
 const list:ExportColumn<CompetitorEntry>[]=[
  ['المنافس','Competitor',e=>e.name],['عدد العملاء','Customers',e=>e.customerCount],['عدد مرات التواصل','Contacts',e=>e.contactCount],['عروض أسعار المنافس','Competitor quotations',e=>e.quoteCount],['آخر تسجيل','Last recorded',e=>dayCell(e.lastDate)],
 ];
 const contacts=entries.flatMap(entry=>entry.contacts.map(contact=>({entry,contact})));
 const log:ExportColumn<{entry:CompetitorEntry;contact:CompetitorObservation}>[]=[
  ['المنافس','Competitor',x=>x.entry.name],['العميل','Customer',x=>x.contact.customer.data.name||''],['المنطقة','Region',x=>x.contact.customer.data.region?tr(x.contact.customer.data.region):''],['المدينة','City',x=>x.contact.customer.data.city||''],
  ['التاريخ','Date',x=>dayCell(x.contact.date)],['المندوب','Representative',x=>x.contact.authorName],['نوع التواصل','Contact type',x=>contactTypes[x.contact.activity.data.type]?tr(contactTypes[x.contact.activity.data.type]):x.contact.activity.data.type||''],
  ['مرحلة البيع','Sales stage',x=>stage(x.contact.stage)],['الأصناف','Products',x=>x.contact.products.map(tr).join(join)],['ملاحظات المنافس','Competitor notes',x=>x.contact.activity.data.competitorNotes||''],
  ['عرض سعر المنافس','Competitor quotation',x=>x.contact.activity.data.competitorFileName||(x.contact.activity.data.competitorFileId?language==='en'?'Attached':'مرفق':'')],
 ];
 return [exportTable(['المنافسون','Competitors'],list,entries,language),exportTable(['سجل التواصل','Contact log'],log,contacts,language)];
}

// ---- «تقرير يوم المندوب» (app/journey-report.tsx)
const resultAt=(result:JourneyResult)=>result.recordedAt&&Number.isFinite(Date.parse(result.recordedAt))?result.recordedAt:result.createdAt;
const latest=(results:readonly JourneyResult[])=>results.reduce<JourneyResult|undefined>((last,result)=>!last||Date.parse(resultAt(result))>Date.parse(resultAt(last))?result:last,undefined);
/** The day's report as the page shows it: a row per stop of the route («محطات اليوم») and a row per contact without a route («التواصل»). */
export function journeyTables(report:Pick<JourneyReportData,'date'|'stops'|'communications'>,language:ExportLanguage,day:string=journeyDate()):ExportTable[]{
 const say=sayIn(language),minutes=(seconds:number|null)=>seconds===null||!Number.isFinite(seconds)?'':Math.round(seconds/60);
 const stops:ExportColumn<JourneyReportStop>[]=[
  ['اليوم','Day',s=>dayCell(s.date)],['المندوب','Representative',s=>s.memberName],['العميل','Customer',s=>s.snapshot.customerName],['المنطقة','Region',s=>s.snapshot.region],
  ['الحالة','State',s=>say(...JOURNEY_STATE_TEXT[journeyStopState(s,day)])],['اختيار العميل','Customer selected',s=>momentCell(s.selectedAt)],['الوصول','Arrival',s=>momentCell(s.data.arrivalAt)],
  ['المغادرة','Departure',s=>momentCell(s.data.departureAt)],['مدة الزيارة (دقيقة)','Visit duration (minutes)',s=>minutes(s.data.durationSeconds)],['المدة غير مؤكدة','Duration uncertain',s=>yesNo(s.data.durationUncertain,say)],
  ['فترات الانقطاع','Tracking gaps',s=>s.data.gaps.length],['آخر نتيجة','Latest outcome',s=>latest(s.results)?.result||''],['الإجراء القادم','Next action',s=>latest(s.results)?.nextAction||''],['موعد المتابعة القادمة','Next follow-up date',s=>dayCell(latest(s.results)?.nextDate)],
 ];
 const contacts:ExportColumn<JourneyCommunication>[]=[
  ['الوقت','Time',c=>momentCell(resultAt(c))],['المندوب','Representative',c=>c.memberName],['العميل','Customer',c=>c.customerName],['النوع','Type',c=>JOURNEY_CONTACT_TEXT[c.type]?say(...JOURNEY_CONTACT_TEXT[c.type]):say('تواصل','Contact')],
  ['الهدف','Purpose',c=>c.summary],['النتيجة','Result',c=>c.result],['الإجراء القادم','Next action',c=>c.nextAction],['موعد المتابعة القادمة','Next follow-up date',c=>dayCell(c.nextDate)],
 ];
 const ordered=[...report.communications].sort((a,b)=>Date.parse(resultAt(a))-Date.parse(resultAt(b)));
 return [exportTable(['محطات اليوم','Stops of the day'],stops,report.stops,language),exportTable(['التواصل','Contacts'],contacts,ordered,language)];
}
