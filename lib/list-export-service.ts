// The customer-service lists of «تصدير Excel» (lib/list-export.ts; the owner, 2026-11-19, GSCO 2.13.80): the complaints and «التواصل مع
// العملاء» (the server builds them, app/api/list-export: the page holds only the first 300 of each), «تتبع الطلبات والشكاوى», «مصادر الفرص»
// (the server builds it too: the page holds one page of 300) and «تقييم خدمة العملاء». The words of a state are the panels' own (they read
// them from here), so the file says what the card says. Like GSCO's, a row never carries what was written in the complaint or the request
// (its description, the demand, the notes): the list's facts, its people and its times. Pure.
import {exportTable,dayCell,momentCell,numberCell,sayIn,yesNo,type ExportColumn,type ExportLanguage,type ExportTable,type Say} from './list-export';
import {closureOutcomes,closureOutcomesEn,complaintCategories,complaintCategoriesEn,complaintChannels,complaintChannelsEn,complaintSeverities,complaintSeveritiesEn,complaintStatusLabels,complaintStatusLabelsEn,resolutionOutcomes,resolutionOutcomesEn,type ComplaintEntry} from './complaints';
import {supportChannels,supportChannelsEn,supportOutcomes,supportOutcomesEn,supportResolutionChannels,supportResolutionChannelsEn,type MissedEntry,type SupportEntry} from './support';
import {trackingHolderLabels,trackingOpportunityOutcomes,trackingStageLabel,trackingStageText,type TrackingItem} from './service-tracking';
import {auditResultLabels,auditResultLabelsEn,managerMetricLabels,managerMetricLabelsEn,repMetricLabels,repMetricLabelsEn,type KpiCardOut,type ServiceKpiResponse} from './service-kpi';

const label=(ar:Record<string,string>,en:Record<string,string>,key:string,say:Say)=>key?say(ar[key]||key,en[key]||ar[key]||key):'';
const hours=(value:number|null|undefined)=>typeof value==='number'&&Number.isFinite(value)?Math.round(value*10)/10:'';

// ---- the complaints (app/complaints-panel.tsx)
/** Where the complaint stands, in words: the status, refined while the representative holds it. */
export const complaintStateText=(entry:Pick<ComplaintEntry,'status'|'stage'>,say:Say)=>entry.status==='assigned'?(entry.stage==='delegation'?say('لدى مشرف المبيعات','With the sales supervisor'):entry.stage==='first_contact'?say('بانتظار أول تواصل من المندوب','Waiting for the representative\'s first contact'):say('قيد الحل مع المندوب','Being resolved by the representative')):label(complaintStatusLabels,complaintStatusLabelsEn,entry.status,say);
const COMPLAINT_ASK:Record<string,readonly [string,string]>={review:['مراجعة الشكوى','Review the complaint'],fix:['تعديل وإعادة الإرسال','Correct and resend'],assign:['تكليف مندوب','Assign a representative'],delegate:['تفويض مندوب','Delegate to a representative'],contact:['تسجيل التواصل','Record the contact'],resolve:['تسجيل الحل','Record the resolution'],close:['تأكيد الإغلاق','Confirm the closure']};
/** What the complaint waits for from the reader, in the words of the card's button; empty when nothing. */
export const complaintAskText=(entry:Pick<ComplaintEntry,'awaiting'>,say:Say)=>entry.awaiting&&COMPLAINT_ASK[entry.awaiting]?say(...COMPLAINT_ASK[entry.awaiting]):'';
/** Every complaint the reader may read, in the page's order (what waits for them first). */
export function complaintsTable(entries:readonly ComplaintEntry[],language:ExportLanguage):ExportTable{
 const say=sayIn(language);
 const columns:ExportColumn<ComplaintEntry>[]=[
  ['رقم الشكوى','Complaint number',e=>numberCell(e.complaintNumber)],['العميل','Customer',e=>e.customerName],['هاتف العميل','Customer phone',e=>e.customerPhone],['المدينة','City',e=>e.customerCity],['المنطقة','Region',e=>e.customerRegion],
  ['التصنيف','Category',e=>label(complaintCategories,complaintCategoriesEn,e.category,say)],['وصلت عن طريق','Came by',e=>label(complaintChannels,complaintChannelsEn,e.channel,say)],['الأهمية','Severity',e=>label(complaintSeverities,complaintSeveritiesEn,e.severity,say)],
  ['الحالة','State',e=>complaintStateText(e,say)],['المطلوب منك','Waiting for you',e=>complaintAskText(e,say)],['متأخرة','Late',e=>yesNo(e.late,say)],['ساعات المرحلة','Stage hours',e=>hours(e.stageHours)],['المستهدف بالساعات','Target hours',e=>numberCell(e.targetHours)],
  ['سجّلها','Registered by',e=>e.registrarName],['مدير خدمة العملاء','Customer-service manager',e=>e.serviceManagerName],['مدير المبيعات','Sales manager',e=>e.salesManagerName],['المشرف','Supervisor',e=>e.supervisorName],['المكلَّف','Assignee',e=>e.assigneeName],
  ['تاريخ التسجيل','Registered on',e=>momentCell(e.createdAt)],['آخر تحديث','Last update',e=>momentCell(e.updatedAt)],
  ['نتيجة الحل','Resolution',e=>e.resolution?label(resolutionOutcomes,resolutionOutcomesEn,e.resolution.outcome,say):''],['وقت الحل','Resolved on',e=>momentCell(e.resolution?.at)],
  ['الإغلاق','Closure',e=>e.closure?label(closureOutcomes,closureOutcomesEn,e.closure.outcome,say):''],['وقت الإغلاق','Closed on',e=>momentCell(e.closure?.at)],['تقييم العميل','Customer rating',e=>numberCell(e.closure?.rating)],
 ];
 return exportTable(['الشكاوى','Complaints'],columns,entries,language);
}

// ---- «التواصل مع العملاء» (app/support-panel.tsx)
const SUPPORT_STATE:Record<string,readonly [string,string]>={waiting:['بانتظار التولّي','Waiting to be taken'],in_progress:['قيد التواصل','In contact'],submitted:['بانتظار مراجعة المدير','Waiting for the manager\'s review'],returned:['مطلوب تعديل','Needs correction'],pending_assignment:['بانتظار تكليف المبيعات','Waiting for sales assignment'],resolved:['بانتظار إغلاق خدمة العملاء','Waiting for customer-service closure'],done:['تم التواصل','Contacted'],cancelled:['أُلغي','Cancelled']};
/** Where the request stands, in words: its state, refined while sales holds it. */
export const supportStateText=(entry:Pick<SupportEntry,'state'|'stage'>,say:Say)=>entry.state==='assigned'?(entry.stage==='delegation'?say('لدى مشرف المبيعات','With the sales supervisor'):say('بانتظار تواصل المندوب','Waiting for the representative\'s contact')):say(...(SUPPORT_STATE[entry.state]||SUPPORT_STATE.waiting));
/** Every request the reader may read and every visit that went unanswered they see, as the panel lists them. */
export function supportTables(requests:readonly SupportEntry[],missed:readonly MissedEntry[],language:ExportLanguage):ExportTable[]{
 const say=sayIn(language);
 const reference=(id:string)=>id.replace(/^support-(?:missed-)?/,'').slice(0,8).toUpperCase();
 const asked:ExportColumn<SupportEntry>[]=[
  ['المرجع','Reference',e=>reference(e.id)],['العميل','Customer',e=>e.customerName],['هاتف العميل','Customer phone',e=>e.customerPhone],['المدينة','City',e=>e.customerCity],['المنطقة','Region',e=>e.customerRegion],
  ['المصدر','Origin',e=>e.origin==='missed_visit'?say('زيارة مفقودة','Missed visit'):say('طلب مندوب','Representative\'s request')],['من الفرصة','From opportunity',e=>numberCell(e.opportunity?.number)],
  ['طلبه','Requested by',e=>e.requestedByName],['المندوب','Representative',e=>e.repName],['الوسيلة المفضلة','Preferred channel',e=>label(supportChannels,supportChannelsEn,e.channel,say)],
  ['الحالة','State',e=>supportStateText(e,say)],['متأخر','Late',e=>yesNo(e.late,say)],['ساعات المرحلة','Stage hours',e=>hours(e.stageHours)],['المستهدف بالساعات','Target hours',e=>numberCell(e.targetHours)],
  ['تولّاه','Taken by',e=>e.handlerName],['مدير خدمة العملاء','Customer-service manager',e=>e.serviceManagerName],['مدير المبيعات','Sales manager',e=>e.salesManagerName],['المكلَّف','Assignee',e=>e.assigneeName],
  ['تاريخ الطلب','Requested on',e=>momentCell(e.createdAt)],['نتيجة تواصل خدمة العملاء','Customer-service contact result',e=>e.result?label(supportOutcomes,supportOutcomesEn,e.result.outcome,say):''],['موعد المتابعة','Follow-up date',e=>dayCell(e.result?.nextDate)],
  ['نتيجة تواصل المبيعات','Sales contact result',e=>e.resolution?label(supportOutcomes,supportOutcomesEn,e.resolution.outcome,say):''],['وسيلة تواصل المبيعات','Sales contact channel',e=>e.resolution?label(supportResolutionChannels,supportResolutionChannelsEn,e.resolution.channel,say):''],
  ['وقت الإغلاق','Closed on',e=>momentCell(e.closure?.at)],
 ];
 const unanswered:ExportColumn<MissedEntry>[]=[
  ['العميل','Customer',e=>e.customerName],['هاتف العميل','Customer phone',e=>e.customerPhone],['المدينة','City',e=>e.customerCity],['المنطقة','Region',e=>e.customerRegion],['المندوب','Representative',e=>e.repName],
  ['موعد المتابعة الفائت','Missed follow-up date',e=>dayCell(e.plan.nextDate)],['أيام التأخير','Days overdue',e=>e.overdueDays],['الإجراء المطلوب','Action due',e=>e.plan.nextAction],['آخر نتيجة','Last result',e=>e.plan.result],
  ['مسؤول خدمة العملاء','Customer-service member',e=>e.routedToName],
 ];
 return [exportTable(['طلبات المساندة','Assistance requests'],asked,requests,language),exportTable(['الزيارات المفقودة','Missed visits'],unanswered,missed,language)];
}

// ---- «تتبع الطلبات والشكاوى» (app/service-tracking.tsx)
const TRACKING_KIND:Record<string,readonly [string,string]>={opportunity:['فرصة','Opportunity'],complaint:['شكوى','Complaint'],support:['طلب مساندة','Assistance request']};
/** How an item ended, in words (the board's own). */
export function trackingOutcomeText(item:Pick<TrackingItem,'kind'|'outcome'>,say:Say){
 const pair=(key:string)=>{const found=trackingStageText[key];return found?say(found[0],found[1]):key;};
 if(item.outcome==='cancelled')return pair('cancelled');
 if(item.kind==='support')return supportOutcomes[item.outcome]?say(supportOutcomes[item.outcome],supportOutcomesEn[item.outcome]||item.outcome):pair('closed');
 if(item.kind==='opportunity')return trackingOpportunityOutcomes[item.outcome]?say(...trackingOpportunityOutcomes[item.outcome]):pair('closed');
 return closureOutcomes[item.outcome]?say(closureOutcomes[item.outcome],closureOutcomesEn[item.outcome]||item.outcome):pair('closed');
}
/** The items of the board's chosen filter, every one of them (the board shows six until «عرض الكل»). */
export function trackingTable(items:readonly TrackingItem[],language:ExportLanguage,tr:(text:string)=>string=text=>text):ExportTable{
 const say=sayIn(language),join=language==='en'?', ':'، ';
 const columns:ExportColumn<TrackingItem>[]=[
  ['النوع','Kind',i=>say(...(TRACKING_KIND[i.kind]||TRACKING_KIND.opportunity))],['رقم الشكوى','Complaint number',i=>numberCell(i.complaintNumber)],['العميل','Customer',i=>i.customerName],
  ['الموضوع','Subject',i=>i.kind==='complaint'?label(complaintCategories,complaintCategoriesEn,i.category,say):i.products.map(tr).join(join)],['الأهمية','Severity',i=>i.kind==='complaint'?label(complaintSeverities,complaintSeveritiesEn,i.severity,say):''],
  ['سجّله','Registered by',i=>i.registrarName],['تاريخ التسجيل','Registered on',i=>momentCell(i.registeredAt)],['المرحلة','Stage',i=>i.finishedAt?trackingOutcomeText(i,say):say(...trackingStageLabel(i.kind,i.stage))],
  ['عند','With',i=>i.side==='service'?say('خدمة العملاء','Customer service'):i.side==='sales'?say('المبيعات','Sales'):say('منتهية','Finished')],
  ['يحملها الآن','Held by',i=>i.holder?i.holder.name+' ('+say(...trackingHolderLabels[i.holder.role])+')':''],['منذ','Since',i=>momentCell(i.stageSince)],['ساعات المرحلة','Stage hours',i=>hours(i.stageHours)],
  ['متأخرة','Late',i=>yesNo(i.late,say)],['انتهت في','Finished on',i=>momentCell(i.finishedAt)],
 ];
 return exportTable(['تتبع الطلبات والشكاوى','Request and complaint tracking'],columns,items,language);
}

// ---- «تقييم خدمة العملاء» (app/service-kpi.tsx)
/** The month's cards of every team the reader may see, a row per indicator of each card, and the quality audits. */
export function serviceKpiTables(data:Pick<ServiceKpiResponse,'month'|'groups'|'audits'>,language:ExportLanguage):ExportTable[]{
 const say=sayIn(language);
 const cards=data.groups.flatMap(group=>[...(group.manager?[group.manager]:[]),...group.reps].map(card=>({group,card})));
 const metricName=(card:KpiCardOut,key:string)=>card.role==='manager'?label(managerMetricLabels,managerMetricLabelsEn,key,say):label(repMetricLabels,repMetricLabelsEn,key,say);
 const team=(group:typeof data.groups[number])=>group.managerName||say('فريق بلا مدير خدمة عملاء','A team without a customer-service manager');
 const cardColumns:ExportColumn<(typeof cards)[number]>[]=[
  ['الفريق','Team',x=>team(x.group)],['الموظف','Employee',x=>x.card.name],['الدور','Role',x=>x.card.role==='manager'?say('مدير خدمة العملاء','Customer-service manager'):say('ممثل خدمة العملاء','Customer-service representative')],
  ['الشهر','Month',()=>data.month],['الدرجة','Score',x=>numberCell(x.card.score)],['الوزن المقيس %','Measured weight %',x=>numberCell(x.card.measuredWeight)],['الشهر مقفل','Month closed',x=>yesNo(x.group.closed,say)],
 ];
 const metrics=cards.flatMap(x=>x.card.metrics.map(metric=>({...x,metric})));
 const metricColumns:ExportColumn<(typeof metrics)[number]>[]=[
  ['الفريق','Team',x=>team(x.group)],['الموظف','Employee',x=>x.card.name],['المؤشر','Indicator',x=>metricName(x.card,x.metric.key)],['الفعلي %','Actual %',x=>numberCell(x.metric.actual===null?null:Math.round(x.metric.actual*10)/10)],
  ['المستهدف %','Target %',x=>numberCell(x.metric.target)],['الوزن %','Weight %',x=>numberCell(x.metric.weight)],['البسط','Numerator',x=>numberCell(x.metric.numerator)],['المقام','Denominator',x=>numberCell(x.metric.denominator)],
  ['النقاط','Points',x=>numberCell(Math.round(x.metric.points*100)/100)],['حالات كافية','Enough cases',x=>yesNo(x.metric.enough,say)],
 ];
 const auditColumns:ExportColumn<(typeof data.audits)[number]>[]=[
  ['التاريخ','Date',a=>dayCell(a.date)],['الموظف','Employee',a=>a.repName],['المدقق','Auditor',a=>a.auditorName],['المرجع','Reference',a=>a.reference.type==='complaint'?say('شكوى','Complaint'):say('مساندة','Assistance')],
  ['العميل','Customer',a=>a.reference.customerName],['المجموع من 100','Total out of 100',a=>numberCell(a.total)],['النتيجة','Result',a=>label(auditResultLabels,auditResultLabelsEn,a.result,say)],
  ['اتصال تحقق','Verification call',a=>yesNo(a.verification.called,say)],['تقييم العميل','Customer rating',a=>numberCell(a.verification.rating)],['ملاحظة','Note',a=>a.note],
 ];
 return [exportTable(['البطاقات','Scorecards'],cardColumns,cards,language),exportTable(['المؤشرات','Indicators'],metricColumns,metrics,language),exportTable(['تدقيق الجودة','Quality audits'],auditColumns,data.audits,language)];
}

// ---- «مصادر الفرص» (app/service-sales.tsx; the server builds it from lib/service-sales-server.ts leadList, every page of it)
export type LeadLostRow={id:string;number:number|null;customerName:string;lossReason:string;lostAt:string;holderName:string;registrarName:string};
export type LeadDormantRow={id:string;name:string;code:string;city:string;phone:string;repName:string;lastPurchase:string;neverBought:boolean};
/** The list chosen on the panel («الفرص المفقودة» or «عملاء منقطعون عن الشراء»), with its search, every row. */
export function leadsTable(list:'lost'|'dormant',rows:readonly (LeadLostRow|LeadDormantRow)[],language:ExportLanguage,tr:(text:string)=>string=text=>text):ExportTable{
 const say=sayIn(language);
 if(list==='lost'){
  const columns:ExportColumn<LeadLostRow>[]=[['رقم الفرصة','Opportunity number',r=>numberCell(r.number)],['العميل','Customer',r=>r.customerName],['تاريخ الفقد','Lost on',r=>momentCell(r.lostAt)],['سبب الفقد','Loss reason',r=>r.lossReason?tr(r.lossReason):''],['المسؤول','Holder',r=>r.holderName],['سجّلها','Registered by',r=>r.registrarName]];
  return exportTable(['الفرص المفقودة','Lost opportunities'],columns,rows as readonly LeadLostRow[],language);
 }
 const columns:ExportColumn<LeadDormantRow>[]=[['العميل','Customer',r=>r.name],['كود ERP','ERP code',r=>r.code],['المدينة','City',r=>r.city],['الهاتف','Phone',r=>r.phone],['المندوب','Representative',r=>r.repName],['آخر شراء','Last purchase',r=>dayCell(r.lastPurchase)],['لم يشترِ من قبل','Never bought',r=>yesNo(r.neverBought,say)]];
 return exportTable(['عملاء منقطعون عن الشراء','Customers who stopped buying'],columns,rows as readonly LeadDormantRow[],language);
}
