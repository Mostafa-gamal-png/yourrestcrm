import {coverageReason,type CoverageMissing} from './sales-coverage';
import {conductKeys,kpiMetricReason,operationalIndicators,type IndicatorId,type KpiMetric,type KpiPerson} from './kpis';

/** What completes the evaluation (the owner, 2026-11-16, item 2 of the GSCO list, as GSCO 2.13.76: «جنب «بيانات ناقصة» تظهر أسماء
 *  المؤشرات الناقصة وأوزانها»، «فوق الجدول مربع «المطلوب لاكتمال التقييم»»، «في صفحة الموظف قايمة بكل مؤشر ناقص، والمطلوب عشان يتحسب»،
 *  «طريقة حساب الدرجة ما تتغيرش»).
 *
 *  Read only from what the server already sends for a person (lib/kpis.ts calculateKpis: the metrics, the attainment's rows, the growth
 *  rows, the team roll-up and its sales team): nothing here scores, so the score, the weight with data and «بيانات ناقصة» itself are
 *  unchanged. A missing indicator is one kpiSummary leaves out of the weight with data (no score and not «لا ينطبق»); «لا ينطبق» is not
 *  missing in Yourrest (since 2026-11-14 its weight leaves the applicable weight), so it is never listed. The five conduct indicators are
 *  one line, «تقييم السلوك من الإدارة» (10%), when all five are missing. Each missing indicator says what completes it, who does it and
 *  where; a case not listed below keeps the indicator's own reason («البيانات المطلوبة / طريقة الحساب»). Pure. */

export type Bilingual=readonly [ar:string,en:string];
/** One thing to do. text: its words in both languages; reasonOf: a case not listed, written as the indicator's own reason in the reader's
 *  language (kpiMetricReason); waiting: the visits the supervisor has not rated yet («نسبة الزيارات الفعالة»). key: the same action is the
 *  same key, whoever it concerns (the summary groups by it). */
export type KpiGapAction={key:string;text?:Bilingual;reasonOf?:KpiMetric;waiting?:number};
export type KpiGap={id:IndicatorId|'conduct';name:string;weight:number;actions:KpiGapAction[]};
/** The data a person's gaps are read from: what the comparison table, the summary cards and the person's page already hold. */
export type GapPerson=Pick<KpiPerson,'metrics'>&Partial<Pick<KpiPerson,'attainment'|'growthRows'|'teamRollup'|'salesSourceMemberIds'|'activityTargetsKnown'>>;

/** The five conduct indicators as one line, when all five are missing. */
export const CONDUCT_GAP_NAME='تقييم السلوك من الإدارة';
export const KPI_GAP_TEXT={
 weights:['يحدد مدير النظام أو مدير المبيعات أوزان الأصناف (مجموعها 100%) من زر «أوزان التقييم» في تبويب «المستهدفات والأوزان»','The administrator or the sales manager sets the product weights (100% in total) with «Performance weights» on the «Targets & weights» tab'],
 target:['حدّد مستهدف كل صنف له وزن من «تعديل الأصناف» في تبويب «المستهدفات والأوزان»','Set a target for every weighted product with «Edit products» on the «Targets & weights» tab'],
 teamTargets:['أكمل مستهدف كل صنف له وزن لكل مندوب في الفريق من تبويب «المستهدفات والأوزان»؛ مستهدف الفريق مجموع مستهدفاتهم','Complete every weighted product’s target for each representative of the team on the «Targets & weights» tab; the team’s target is their sum'],
 teamLink:['لم يُربط فريق؛ حدّد المدير أو المشرف لكل مندوب في الفريق والصلاحيات.','No team is linked. Assign a manager or supervisor to each sales rep in Team and permissions.'],
 salesMonth:['ارفع مبيعات ERP الكاملة لهذا الشهر من «استيراد مبيعات ERP» في تبويب «رفع المبيعات» مع تحديد «الملف يشمل كل مبيعات المناديب للفترة التي يغطيها»، أو أكّد اكتمال سجل المبيعات في «بيانات المؤشرات»','Upload this month’s complete ERP sales with «Import ERP sales» on the «Sales upload» tab, ticking «The file includes all reps’ sales for the period it covers», or confirm the sales history in «KPI evidence»'],
 salesGrowth:['ارفع مبيعات ERP الكاملة لهذا الشهر والشهر السابق من تبويب «رفع المبيعات»، أو أكّد اكتمال سجل المبيعات في «بيانات المؤشرات»','Upload complete ERP sales for this month and the previous one on the «Sales upload» tab, or confirm the sales history in «KPI evidence»'],
 salesCustomers:['ارفع مبيعات ERP الكاملة لهذا الشهر والأشهر الثلاثة السابقة من تبويب «رفع المبيعات»، أو أكّد اكتمال سجل المبيعات في «بيانات المؤشرات»','Upload complete ERP sales for this month and the three previous months on the «Sales upload» tab, or confirm the sales history in «KPI evidence»'],
 collection:['ارفع كشف التحصيل لهذا الشهر من «استيراد كشف التحصيل من ERP» في تبويب «التحصيل»، أو أدخل المستحق والمحصل في «بيانات المؤشرات»','Upload this month’s collection statement with «Import the ERP collection statement» on the «Collection» tab, or enter the due and collected amounts in «KPI evidence»'],
 teamCollection:['أكمل تحصيل كل مندوب في الفريق: ارفع كشف التحصيل لهذا الشهر من تبويب «التحصيل»، أو أدخل المستحق والمحصل لكل منهم في «بيانات المؤشرات»','Complete each team representative’s collection: upload this month’s collection statement on the «Collection» tab, or enter each one’s due and collected amounts in «KPI evidence»'],
 newCustomers:['ارفع ملف عملاء ERP بعمود «التاريخ» من «استيراد من ERP» في صفحة «العملاء»؛ بعض عملاء الشهر بلا منشئ ولا تاريخ إنشاء في ERP','Upload the ERP customers file with its «Date» column using «Import from ERP» on the «Customers» page; some of the month’s customers have no creator and no ERP creation date'],
 rateVisits:['يقيّم المشرف كل زيارة «فعالة» أو «سلبية» من «إضافة نتيجة وإجراء» في «تقرير يوم المندوب»','The supervisor rates each visit «Effective» or «Negative» with «Add result and action» on the «Daily route» page'],
 conduct:['يُدخل مدير النظام أو مدير المبيعات درجات السلوك من زر «تقييم الإدارة وتدقيق البيانات» في صفحة الشخص','The administrator or the sales manager enters the conduct scores with «Management assessment and data review» on the person’s page']
} as const satisfies Record<string,Bilingual>;
export const KPI_GAP_WORDS={
 title:['المطلوب لاكتمال التقييم','What completes the evaluation'],
 hint:['كل إجراء مع وزن المؤشرات التي يكملها ومن يخصهم. لا تتغير طريقة حساب الدرجة: تُحسب من البيانات الموجودة إلى أن تكتمل.','Each action with the weight of the indicators it completes and whom it concerns. The way the score is calculated does not change: it uses the available data until the rest is complete.'],
 missing:['بيانات ناقصة','Missing data'],
 waiting:['زيارات بانتظار التقييم','Visits awaiting rating'],
 everyone:['كل المناديب','All sales reps']
} as const satisfies Record<string,Bilingual>;

/** The reasons lib/kpis.ts and lib/kpis-server.ts give the customers' indicators and the quotations' conversion when no sales team can be
 *  read, and when the sales history is not confirmed: matched exactly (tests/kpi-sales-manager-gaps.mjs checks they are still written so). */
export const NO_TEAM_REASONS=['لا يوجد فريق مبيعات مؤهل لحساب المؤشرات.','لا يوجد فريق مبيعات مؤهل لحساب المؤشر.'] as const;
export const HISTORY_REASONS=['أكد اكتمال سجل مبيعات الشهر والأشهر الثلاثة السابقة لحساب العملاء.','أكّد اكتمال سجل المبيعات للفترة بعد آخر تحديث للبيانات.','أكّد اكتمال سجل المبيعات لثلاثة أشهر سابقة وفترة التقييم.'] as const;
export const NEW_CUSTOMERS_UNKNOWN_START='بعض العملاء المضافين في الشهر لا يحملون هوية منشئهم';

const conductIds:readonly string[]=conductKeys;
const isMissing=(metric:KpiMetric|undefined)=>metric?.status!=='not_applicable'&&(typeof metric?.score!=='number'||!Number.isFinite(metric.score));
/** The indicators kpiSummary leaves out of the weight with data (not «لا ينطبق», no score), in their canonical order, the five conduct
 *  indicators as one when all five are missing: what «بيانات ناقصة» names, each with its weight. */
export function kpiMissing(metrics:readonly KpiMetric[]=[]):{id:IndicatorId|'conduct';name:string;weight:number}[]{
 const missing=operationalIndicators.filter(indicator=>isMissing(metrics.find(metric=>metric.id===indicator.id)));
 const conduct=missing.filter(indicator=>conductIds.includes(indicator.id));
 const rows=missing.map(indicator=>({id:indicator.id as IndicatorId|'conduct',name:indicator.name as string,weight:indicator.weight as number}));
 return conduct.length<conductKeys.length?rows:[...rows.filter(row=>!conductIds.includes(row.id)),{id:'conduct',name:CONDUCT_GAP_NAME,weight:conduct.reduce((sum,indicator)=>sum+indicator.weight,0)}];
}
const text=(key:keyof typeof KPI_GAP_TEXT):KpiGapAction=>({key,text:KPI_GAP_TEXT[key]});
const coverage=(missing:CoverageMissing):KpiGapAction=>({key:'coverage:'+JSON.stringify([missing.months,missing.olderThan,!!missing.uploadOnly]),text:[coverageReason(missing,'ar'),coverageReason(missing,'en')]});
const ownReason=(metric:KpiMetric):KpiGapAction=>({key:'reason:'+metric.id+':'+metric.reason,reasonOf:metric});
/** What each missing indicator of a person needs: the action, who does it and where. */
export function kpiGaps(person:GapPerson):KpiGap[]{
 const attainment=person.attainment,team=!!person.teamRollup,noTeam=team&&Array.isArray(person.salesSourceMemberIds)&&person.salesSourceMemberIds.length===0;
 const weightsMissing=attainment?.status==='weights_missing'||(person.growthRows||[]).some(row=>row.weight===null);
 const needs=(metric:KpiMetric):KpiGapAction[]=>{
  if(conductIds.includes(metric.id))return [text('conduct')];
  const reason=metric.reason||'';
  switch(metric.id){
   case 'attainment':{
    if(noTeam)return [text('teamLink')];
    if(!attainment)return [];
    if(attainment.status==='weights_missing')return [text('weights')];
    const rows=attainment.rows.filter(row=>row.weight!==0);
    return [...(rows.some(row=>row.target===null)?[text(team?'teamTargets':'target')]:[]),...(rows.some(row=>typeof row.target==='number'&&row.target>0&&row.actual===null)?[text('salesMonth')]:[])];
   }
   case 'collection':return [text(noTeam?'teamLink':team?'teamCollection':'collection')];
   case 'growth':return metric.missing?[coverage(metric.missing)]:weightsMissing?[text('weights')]:noTeam?[text('teamLink')]:[text('salesGrowth')];
   case 'recovered':case 'retention':return metric.missing?[coverage(metric.missing)]:(NO_TEAM_REASONS as readonly string[]).includes(reason)?[text('teamLink')]:(HISTORY_REASONS as readonly string[]).includes(reason)?[text('salesCustomers')]:[];
   case 'new_customers':return person.activityTargetsKnown!==false&&reason.startsWith(NEW_CUSTOMERS_UNKNOWN_START)?[text('newCustomers')]:[];
   case 'positive':return [{...text('rateVisits'),waiting:metric.waiting??0}];
   case 'orders':return (NO_TEAM_REASONS as readonly string[]).includes(reason)?[text('teamLink')]:[];
  }
  return [];
 };
 return kpiMissing(person.metrics).map(row=>{
  if(row.id==='conduct')return {...row,actions:[text('conduct')]};
  const metric=person.metrics.find(value=>value.id===row.id);
  const found=metric?needs(metric):[];
  // A case not listed above keeps the indicator's own reason (its «البيانات المطلوبة / طريقة الحساب»).
  return {...row,actions:found.length?found:metric?.reason?[ownReason(metric)]:[]};
 });
}
export type KpiGapLine={action:KpiGapAction;weight:number;people:{id:string;name:string}[];waiting:number};
/** «المطلوب لاكتمال التقييم» above the comparison: across the people listed (those out of the month's evaluation, «بلا نشاط في هذا الشهر»,
 *  left out), one line per action with the weight of the indicators it completes (each indicator once, the conduct line its five) and the
 *  people it concerns; the most weight first. */
export function kpiGapSummary(people:readonly (GapPerson&{member:{id:string;name:string};summary?:{inactive?:boolean}|null})[]){
 const counted=people.filter(person=>!person.summary?.inactive),lines=new Map<string,KpiGapLine&{ids:Set<string>}>();
 for(const person of counted)for(const gap of kpiGaps(person))for(const action of gap.actions){
  let line=lines.get(action.key);
  if(!line)lines.set(action.key,line={action:{...action,waiting:undefined},weight:0,people:[],waiting:0,ids:new Set<string>()});
  for(const id of gap.id==='conduct'?conductKeys:[gap.id])line.ids.add(id);
  if(!line.people.some(entry=>entry.id===person.member.id))line.people.push({id:person.member.id,name:person.member.name});
  line.waiting+=action.waiting??0;
 }
 const weightOf=(id:string)=>operationalIndicators.find(indicator=>indicator.id===id)?.weight??0;
 return {people:counted.length,lines:[...lines.values()].map(({ids,...line}):KpiGapLine=>({...line,weight:[...ids].reduce((sum,id)=>sum+weightOf(id),0)})).sort((a,b)=>b.weight-a.weight||b.people.length-a.people.length||a.action.key.localeCompare(b.action.key,'en'))};
}
/** An action as a sentence in the reader's language, without a closing full stop so actions can be joined; the visits waiting after it. */
export function gapActionText(action:KpiGapAction,language:'ar'|'en',translate:(value:string)=>string,waiting=action.waiting??0){
 const base=action.text?action.text[language==='en'?1:0]:action.reasonOf?kpiMetricReason(action.reasonOf,translate,language):'';
 return base.trim().replace(/\.$/,'')+(waiting>0?' ('+KPI_GAP_WORDS.waiting[language==='en'?1:0]+': '+waiting+')':'');
}
/** «بيانات ناقصة: التحصيل (20%)، العملاء المستردون (5%)» in the reader's language (the export; the screens draw the same with <bdi>). */
export function missingLine(metrics:readonly KpiMetric[]|undefined,language:'ar'|'en',translate:(value:string)=>string){
 const rows=kpiMissing(metrics||[]);
 return rows.length?KPI_GAP_WORDS.missing[language==='en'?1:0]+': '+rows.map(row=>translate(row.name)+' ('+row.weight+'%)').join(language==='en'?', ':'، '):'';
}
