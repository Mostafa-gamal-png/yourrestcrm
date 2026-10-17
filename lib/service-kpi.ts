import type {Member} from './crm';
import type {ServiceCase} from './customer-service';
import {COMPLAINT_REOPEN_DAYS,type ComplaintRow} from './complaints';
import type {SupportRow} from './support';
import {workingHoursBetween} from './working-hours';

/** Monthly evaluation of customer service: a score out of 100 for each representative and for each customer-service manager,
 * computed on read from what the system already records (complaints, assistance requests, service requests) plus the manager's
 * quality audits and the customer's rating at closure. Pure functions over an in-memory context. A representative is measured
 * only on what they own: a complaint sent back to sales because the customer was not satisfied is the right thing to do and
 * never counts against them. Every figure is attributed by the time of the event itself, so a month that has ended gives the
 * same answer however late it is asked. Nothing here feeds a sales target, a sales evaluation or a movement calculation. */
export const SERVICE_AUDIT_KIND='service_audit';
export const SERVICE_KPI_MONTH_KIND='service_kpi_month';
export const SERVICE_KPI_SETTINGS_KIND='service_kpi_settings';
export const SERVICE_KPI_SETTINGS_ID='service-kpi-settings';
/** Rows of these kinds are not sales records: each has its own route and never travels with the records. */
export const SERVICE_KPI_KINDS=[SERVICE_AUDIT_KIND,SERVICE_KPI_MONTH_KIND,SERVICE_KPI_SETTINGS_KIND] as const;
/** A representative's audit can be deleted by whoever entered it, and by an administrator, for this long. */
export const AUDIT_DELETE_DAYS=7;
/** A customer who complained again within this many days makes the later complaint a repeat. */
export const REPEAT_COMPLAINT_DAYS=30;
export const AUDIT_NOTE_MAX=2000;
/** A month's detail lists stop at this many items per figure; the counts always cover all of them. */
export const KPI_ITEM_LIMIT=200;
export const KPI_MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;

export const REP_METRICS=['support_response','closure_timing','closures_held','audit_quality','missed_visits','registration_accuracy','clearance','customer_rating'] as const;
export const MANAGER_METRICS=['team_average','review_timing','life_timing','team_rating','team_support_response','team_quality','backlog','repeat_complaints'] as const;
export const AUDIT_CRITERIA=['greeting','understanding','accuracy','ownership','communication','resolution','closing'] as const;
export type RepMetric=typeof REP_METRICS[number];
export type ManagerMetric=typeof MANAGER_METRICS[number];
export type AuditCriterion=typeof AUDIT_CRITERIA[number];
export const repMetricLabels:Record<RepMetric,string>={support_response:'الاستجابة للمساندة',closure_timing:'تأكيد الإغلاق في مهلته',closures_held:'إغلاقات ثبتت',audit_quality:'جودة الأداء',missed_visits:'الزيارات المفقودة في مهلتها',registration_accuracy:'دقة التسجيل',clearance:'نسبة الإنجاز',customer_rating:'تقييم العميل'};
export const repMetricLabelsEn:Record<RepMetric,string>={support_response:'Support response',closure_timing:'Closure confirmed on time',closures_held:'Closures that held',audit_quality:'Performance quality',missed_visits:'Missed visits on time',registration_accuracy:'Registration accuracy',clearance:'Clearance',customer_rating:'Customer rating'};
export const managerMetricLabels:Record<ManagerMetric,string>={team_average:'متوسط الفريق',review_timing:'مهلة المراجعة',life_timing:'مهلة الشكوى كاملة',team_rating:'رضا العميل',team_support_response:'الاستجابة للمساندة',team_quality:'جودة الفريق',backlog:'ضبط المتراكم',repeat_complaints:'الشكاوى المتكررة'};
export const managerMetricLabelsEn:Record<ManagerMetric,string>={team_average:'Team average',review_timing:'Review on time',life_timing:'Whole-complaint time',team_rating:'Customer satisfaction',team_support_response:'Support response',team_quality:'Team quality',backlog:'Backlog control',repeat_complaints:'Repeat complaints'};
export const auditCriterionLabels:Record<AuditCriterion,string>={greeting:'الترحيب والتعريف',understanding:'فهم المشكلة',accuracy:'دقة المعلومة والتسجيل',ownership:'تحمّل المسؤولية والمتابعة',communication:'أسلوب التواصل',resolution:'الحل المقدَّم',closing:'الإغلاق والتأكيد'};
export const auditCriterionLabelsEn:Record<AuditCriterion,string>={greeting:'Greeting and introduction',understanding:'Understanding the problem',accuracy:'Accuracy of information and records',ownership:'Ownership and follow-up',communication:'Communication style',resolution:'Solution offered',closing:'Closing and confirmation'};
export const auditResultLabels:Record<string,string>={pass:'ناجح',coach:'يحتاج تدريبًا',fail:'راسب'};
export const auditResultLabelsEn:Record<string,string>={pass:'Pass',coach:'Needs coaching',fail:'Fail'};
export const kpiActions:Record<string,string>={audit:'تسجيل تدقيق جودة',audit_delete:'حذف تدقيق جودة',settings:'تعديل إعدادات تقييم خدمة العملاء',close_month:'إقفال شهر التقييم',reopen_month:'إعادة فتح شهر التقييم'};

export type MetricSetting={target:number;weight:number;min:number};
export type ServiceKpiSettings={
 /** Working hours a stage may take before it counts as late. */
 hours:{support:number;missed:number;closure:number;review:number};
 /** Working hours a whole complaint may take, from registration to closure, by severity. */
 life:{normal:number;high:number};
 rep:Record<RepMetric,MetricSetting>;
 manager:Record<ManagerMetric,MetricSetting>;
 audit:{criteria:Record<AuditCriterion,number>;pass:number;coach:number;sample:number};
 /** A month may be closed once it has been over for this many days. */
 closeGraceDays:number;
};
/** The values of the evaluation sheet the owner provided, adapted to what the system records. Weights of each card sum to 100. */
export const DEFAULT_SERVICE_KPI_SETTINGS:ServiceKpiSettings={
 hours:{support:4,missed:4,closure:24,review:4},
 life:{normal:82,high:48},
 rep:{support_response:{target:90,weight:15,min:5},closure_timing:{target:95,weight:15,min:5},closures_held:{target:90,weight:15,min:5},audit_quality:{target:90,weight:15,min:3},missed_visits:{target:95,weight:10,min:5},registration_accuracy:{target:98,weight:10,min:5},clearance:{target:90,weight:10,min:5},customer_rating:{target:90,weight:10,min:5}},
 manager:{team_average:{target:85,weight:25,min:1},review_timing:{target:90,weight:15,min:5},life_timing:{target:95,weight:15,min:5},team_rating:{target:90,weight:10,min:5},team_support_response:{target:90,weight:10,min:5},team_quality:{target:90,weight:10,min:3},backlog:{target:95,weight:10,min:0},repeat_complaints:{target:95,weight:5,min:5}},
 audit:{criteria:{greeting:10,understanding:15,accuracy:20,ownership:15,communication:15,resolution:15,closing:10},pass:90,coach:80,sample:3},
 closeGraceDays:5
};

const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const num=(value:unknown,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
/** Settings as stored or sent, filled in from the defaults wherever a value is missing; it may still be invalid (see `settingsProblem`). */
export function normalizeSettings(raw:unknown):ServiceKpiSettings{
 const d=DEFAULT_SERVICE_KPI_SETTINGS,source=isObject(raw)?raw:{},pick=(value:unknown):Record<string,unknown>=>isObject(value)?value:{};
 const metrics=<K extends string>(keys:readonly K[],defaults:Record<K,MetricSetting>,given:unknown)=>{
  const found=pick(given),result={} as Record<K,MetricSetting>;
  for(const key of keys){const one=pick(found[key]);result[key]={target:num(one.target,defaults[key].target),weight:num(one.weight,defaults[key].weight),min:num(one.min,defaults[key].min)};}
  return result;
 };
 const hours=pick(source.hours),life=pick(source.life),audit=pick(source.audit),criteria=pick(audit.criteria),weights={} as Record<AuditCriterion,number>;
 for(const key of AUDIT_CRITERIA)weights[key]=num(criteria[key],d.audit.criteria[key]);
 return {
  hours:{support:num(hours.support,d.hours.support),missed:num(hours.missed,d.hours.missed),closure:num(hours.closure,d.hours.closure),review:num(hours.review,d.hours.review)},
  life:{normal:num(life.normal,d.life.normal),high:num(life.high,d.life.high)},
  rep:metrics(REP_METRICS,d.rep,source.rep),manager:metrics(MANAGER_METRICS,d.manager,source.manager),
  audit:{criteria:weights,pass:num(audit.pass,d.audit.pass),coach:num(audit.coach,d.audit.coach),sample:num(audit.sample,d.audit.sample)},
  closeGraceDays:num(source.closeGraceDays,d.closeGraceDays)
 };
}
/** What is wrong with the settings, in words for the person who typed them; empty when they are fine. */
export function settingsProblem(settings:ServiceKpiSettings):string{
 const between=(value:number,low:number,high:number)=>Number.isFinite(value)&&value>=low&&value<=high,whole=(value:number,low:number,high:number)=>Number.isInteger(value)&&value>=low&&value<=high;
 for(const key of ['support','missed','closure','review'] as const)if(!between(settings.hours[key],0.5,500))return 'ساعات المهل يجب أن تكون بين نصف ساعة و500 ساعة عمل';
 for(const key of ['normal','high'] as const)if(!between(settings.life[key],1,5000))return 'مهلة الشكوى كاملة يجب أن تكون بين ساعة و5000 ساعة عمل';
 const cards:[string,Record<string,MetricSetting>][]=[['الممثل',settings.rep],['المدير',settings.manager]];
 for(const [name,card] of cards){
  let total=0;
  for(const metric of Object.values(card)){
   if(!between(metric.target,1,100))return 'هدف كل مؤشر يجب أن يكون بين 1 و100';
   if(!whole(metric.weight,0,100))return 'وزن كل مؤشر عدد صحيح بين 0 و100';
   if(!whole(metric.min,0,1000))return 'الحد الأدنى للحالات عدد صحيح بين 0 و1000';
   total+=metric.weight;
  }
  if(total!==100)return `مجموع أوزان مؤشرات ${name} يجب أن يساوي 100 وهو الآن ${total}`;
 }
 let criteriaTotal=0;
 for(const key of AUDIT_CRITERIA){const value=settings.audit.criteria[key];if(!whole(value,1,100))return 'درجة كل معيار تدقيق عدد صحيح بين 1 و100';criteriaTotal+=value;}
 if(criteriaTotal!==100)return `مجموع درجات معايير التدقيق يجب أن يساوي 100 وهو الآن ${criteriaTotal}`;
 if(!between(settings.audit.coach,1,99)||!between(settings.audit.pass,2,100)||settings.audit.coach>=settings.audit.pass)return 'حد «ناجح» يجب أن يكون أعلى من حد «يحتاج تدريبًا»';
 if(!whole(settings.audit.sample,0,20))return 'حجم العينة المقترحة بين 0 و20';
 if(!whole(settings.closeGraceDays,0,30))return 'أيام الانتظار قبل الإقفال بين 0 و30';
 return '';
}

// ---- time: the Riyadh day is a fixed shift of the instant, so no calendar library or Intl call is needed per event
const HOUR=3600000,DAY=86400000,OFFSET=3*HOUR;
export const kpiDay=(iso:string)=>{const time=Date.parse(iso);return Number.isFinite(time)?new Date(time+OFFSET).toISOString().slice(0,10):'';};
export const kpiMonthOf=(iso:string)=>kpiDay(iso).slice(0,7);
export const monthStart=(month:string)=>new Date(Date.parse(month+'-01T00:00:00Z')-OFFSET).toISOString();
export const nextMonth=(month:string)=>{const [year,index]=month.split('-').map(Number);return index===12?`${year+1}-01`:`${year}-${String(index+1).padStart(2,'0')}`;};
/** The first instant after the month (exclusive end). */
export const monthEnd=(month:string)=>monthStart(nextMonth(month));
export const prevMonth=(month:string)=>{const [year,index]=month.split('-').map(Number);return index===1?`${year-1}-12`:`${year}-${String(index-1).padStart(2,'0')}`;};
/** The month and the ones before it, oldest first. */
export const trailingMonths=(month:string,count:number)=>{const found=[month];while(found.length<count)found.unshift(prevMonth(found[0]));return found;};
const round1=(value:number)=>Math.round(value*10)/10,round2=(value:number)=>Math.round(value*100)/100;
const lifeTarget=(settings:ServiceKpiSettings,severity:string)=>severity==='high'?settings.life.high:settings.life.normal;

// ---- rows
export type ServiceAuditData={
 kind:'service_audit';repId:string;/** The month the audit counts in: the period of the work audited. */month:string;/** The day of the audited contact, when given. */date:string;
 reference:{type:'complaint'|'support'|'service'|'';id:string};scores:Record<AuditCriterion,number>;total:number;result:'pass'|'coach'|'fail';
 /** The manager's own call to the customer to confirm what was entered at closure. */verification:{called:boolean;rating:number|null};
 note:string;auditorId:string;at:string;
 /** Set when the audit is deleted: the row stays as a record of who removed it and when, and no figure counts it. */
 deleted?:{at:string;by:string};
};
export type ServiceAuditRow={id:string;branch:string;assignedTo:string;data:ServiceAuditData;createdAt:string;updatedAt:string;version:number};
/** The certificate left when a month is closed for a team: who was in it, the settings used and the scores reached. */
export type ServiceKpiMonthData={kind:'service_kpi_month';month:string;managerId:string;team:string[];settings:ServiceKpiSettings;closedBy:string;closedAt:string;scores:Record<string,number|null>;
 /** Set when an administrator reopens the month: the row stays, and the month is evaluated live again. */reopened?:{at:string;by:string}};
export type ServiceKpiMonthRow={id:string;branch:string;assignedTo:string;data:ServiceKpiMonthData;createdAt:string;updatedAt:string;version:number};
export const monthRowId=(managerId:string,month:string)=>`service-kpi-month-${managerId||'none'}-${month}`;

export type KpiItem={ref:string;type:'complaint'|'support'|'service'|'audit'|'member';customerId:string;at:string;value:number|null;ok:boolean|null;tag:string};
export type KpiMetric={
 key:string;kind:'share'|'average'|'rating';target:number;weight:number;min:number;numerator:number;denominator:number;
 /** In percent points (a rating is its average out of 5 as a share of 5); null when there is nothing to measure. */actual:number|null;
 /** Enough cases to count; a figure that is not enough neither raises nor lowers the score. */enough:boolean;measured:boolean;empty:boolean;achieved:number;points:number;items:KpiItem[];
};
export type Scorecard={memberId:string;role:'rep'|'manager';score:number|null;measuredWeight:number;metrics:KpiMetric[]};
export type KpiGroup={managerId:string;managerName:string;closed:boolean;closedAt:string;closedBy:string;/** A closed month whose figures no longer match the certificate. */drift:boolean;settings:ServiceKpiSettings;manager:Scorecard|null;reps:Scorecard[]};
export type KpiMonth={month:string;generatedAt:string;groups:KpiGroup[]};
export type KpiInput={members:Member[];complaints:ComplaintRow[];support:SupportRow[];serviceCases:ServiceCase[];audits:ServiceAuditRow[];closed:ServiceKpiMonthRow[];settings:ServiceKpiSettings};

// ---- a complaint's history, read from its events
type Act={at:string;by:string;action:'close'|'reject';/** The resolution this confirms or sends back. */since:string;rating:number|null};
type Timeline={
 row:ComplaintRow;submitted:string;registrar:string;
 reviews:{at:string;by:string;action:'forward'|'return';since:string}[];
 firstDecision:{at:string;action:'forward'|'return'}|null;
 acts:Act[];reopens:string[];cancels:string[];resolves:string[];edits:string[];returns:string[];
 /** The moments the complaint became open or stopped being open. */openSteps:{at:string;open:boolean}[];
};
const timelines=new WeakMap<ComplaintRow,Timeline>();
const asRating=(value:unknown)=>typeof value==='number'&&Number.isInteger(value)&&value>=1&&value<=5?value:null;
export function complaintTimeline(row:ComplaintRow):Timeline{
 const cached=timelines.get(row);if(cached)return cached;
 const events=(Array.isArray(row.data.events)?row.data.events:[]).filter(event=>!!event&&typeof event.at==='string'&&typeof event.action==='string').sort((a,b)=>a.at.localeCompare(b.at));
 const register=events.find(event=>event.action==='register'),submitted=register?.at||row.createdAt;
 const line:Timeline={row,submitted,registrar:register?.by||row.data.registrarId,reviews:[],firstDecision:null,acts:[],reopens:[],cancels:[],resolves:[],edits:[],returns:[],openSteps:[{at:submitted,open:true}]};
 let lastSend=submitted,lastResolve='';
 for(const event of events){
  const rating=asRating(event.rating);
  if(event.action==='register'||event.action==='edit'){lastSend=event.at;if(event.action==='edit')line.edits.push(event.at);}
  else if(event.action==='forward'||event.action==='return'){
   line.reviews.push({at:event.at,by:event.by,action:event.action,since:lastSend});
   if(event.action==='return')line.returns.push(event.at);
   if(!line.firstDecision)line.firstDecision={at:event.at,action:event.action};
  }
  else if(event.action==='resolve'){lastResolve=event.at;line.resolves.push(event.at);}
  else if(event.action==='close'||event.action==='reject'){
   line.acts.push({at:event.at,by:event.by,action:event.action,since:lastResolve||row.data.resolvedAt||'',rating:event.action==='close'?rating:null});
   if(event.action==='close')line.openSteps.push({at:event.at,open:false});
  }
  else if(event.action==='reopen'){line.reopens.push(event.at);line.openSteps.push({at:event.at,open:true});}
  else if(event.action==='cancel'){line.cancels.push(event.at);line.openSteps.push({at:event.at,open:false});}
 }
 timelines.set(row,line);return line;
}
/** Whether the complaint was open at that instant (registered and neither closed nor cancelled by then). */
const openAt=(line:Timeline,at:string)=>{let open=false;for(const step of line.openSteps)if(step.at<=at)open=step.open;return open&&line.submitted<=at;};
const firstAfter=(times:string[],at:string)=>times.filter(time=>time>at).sort()[0]||'';

type Facts={members:Member[];byId:Map<string,Member>;complaints:Timeline[];support:SupportRow[];cases:ServiceCase[];audits:ServiceAuditRow[];byCustomer:Map<string,Timeline[]>};
function buildFacts(input:KpiInput):Facts{
 const complaints=input.complaints.filter(row=>row&&row.data&&row.data.kind==='complaint').map(complaintTimeline),byCustomer=new Map<string,Timeline[]>();
 for(const line of complaints){const list=byCustomer.get(line.row.data.customerId);if(list)list.push(line);else byCustomer.set(line.row.data.customerId,[line]);}
 return {members:input.members,byId:new Map(input.members.map(member=>[member.id,member])),complaints,support:input.support.filter(row=>row&&row.data&&row.data.kind==='support'),cases:input.serviceCases,audits:input.audits.filter(row=>row&&row.data&&row.data.kind==='service_audit'&&!row.data.deleted),byCustomer};
}
type Ctx={facts:Facts;settings:ServiceKpiSettings;month:string;from:string;to:string;now:string;/** The end of what has happened in this month: the month's end, or now while it runs. */clip:string};
const within=(ctx:Ctx,at:string|undefined)=>!!at&&at>=ctx.from&&at<ctx.to&&at<=ctx.now;
const requestedAt=(row:SupportRow)=>row.data.requestedAt||row.createdAt,heldFrom=(row:SupportRow)=>row.data.handlerAt||requestedAt(row);
const supportDue=(ctx:Ctx,row:SupportRow)=>row.data.origin==='missed_visit'?ctx.settings.hours.missed:ctx.settings.hours.support;

function metric(key:string,kind:KpiMetric['kind'],setting:MetricSetting,numerator:number,denominator:number,items:KpiItem[],emptyIsFull=false):KpiMetric{
 const empty=denominator===0&&emptyIsFull,enough=(denominator>0||emptyIsFull)&&denominator>=setting.min;
 const actual=denominator>0?(kind==='share'?numerator/denominator*100:kind==='rating'?numerator/denominator/5*100:numerator/denominator):empty?100:null;
 const achieved=enough&&actual!==null?Math.min(1,actual/setting.target):0,measured=enough&&setting.weight>0;
 return {key,kind,target:setting.target,weight:setting.weight,min:setting.min,numerator,denominator,actual,enough,measured,empty,achieved,points:measured?achieved*setting.weight:0,items};
}
function scorecard(memberId:string,role:'rep'|'manager',metrics:KpiMetric[]):Scorecard{
 // "Nothing is open" counts as full marks only beside something that was measured: on its own it says nothing about the month.
 const counted=metrics.filter(one=>one.measured),measured=counted.some(one=>!one.empty)?counted:[],weight=measured.reduce((sum,one)=>sum+one.weight,0),points=measured.reduce((sum,one)=>sum+one.points,0);
 return {memberId,role,score:weight>0?round1(points/weight*100):null,measuredWeight:weight,metrics};
}
const share=(items:KpiItem[])=>({numerator:items.filter(item=>item.ok).length,denominator:items.length});

// ---- the representative
type Work={ref:string;type:'complaint'|'support';customerId:string;arrival:string;finish:string;due:number;tag:string};
/** What came to the representative to do, each with the moment it arrived and the moment it was dealt with. */
function repWorks(ctx:Ctx,rep:Member):Work[]{
 const works:Work[]=[];
 for(const line of ctx.facts.complaints){
  if(line.registrar!==rep.id)continue;
  const customerId=line.row.data.customerId;
  for(const at of line.returns)works.push({ref:line.row.id,type:'complaint',customerId,arrival:at,finish:firstAfter([...line.edits,...line.cancels],at),due:ctx.settings.hours.closure,tag:'fix'});
  for(const at of line.resolves)works.push({ref:line.row.id,type:'complaint',customerId,arrival:at,finish:firstAfter([...line.acts.map(act=>act.at),...line.cancels],at),due:ctx.settings.hours.closure,tag:'confirm'});
 }
 for(const row of ctx.facts.support){
  if(row.data.handlerId!==rep.id)continue;
  works.push({ref:row.id,type:'support',customerId:row.data.customerId,arrival:heldFrom(row),finish:row.data.result?.at||row.data.cancelledAt||'',due:supportDue(ctx,row),tag:row.data.origin==='missed_visit'?'missed':'support'});
 }
 return works;
}
export function repMetrics(ctx:Ctx,rep:Member):KpiMetric[]{
 const s=ctx.settings.rep,facts=ctx.facts;
 const supportItems:KpiItem[]=[],missedItems:KpiItem[]=[];
 for(const row of facts.support){
  const data=row.data;if(data.handlerId!==rep.id||!data.result||!within(ctx,data.result.at))continue;
  const hours=workingHoursBetween(heldFrom(row),data.result.at),due=supportDue(ctx,row);
  (data.origin==='missed_visit'?missedItems:supportItems).push({ref:row.id,type:'support',customerId:data.customerId,at:data.result.at,value:round2(hours),ok:hours<=due,tag:'answered'});
 }
 const timing:KpiItem[]=[],held:KpiItem[]=[],ratings:KpiItem[]=[];let ratingSum=0;
 for(const line of facts.complaints)for(const act of line.acts){
  if(act.by!==rep.id)continue;
  const customerId=line.row.data.customerId;
  if(within(ctx,act.at)&&act.since){const hours=workingHoursBetween(act.since,act.at);timing.push({ref:line.row.id,type:'complaint',customerId,at:act.at,value:round2(hours),ok:hours<=ctx.settings.hours.closure,tag:act.action});}
  if(act.action!=='close')continue;
  if(within(ctx,act.at)&&act.rating){ratingSum+=act.rating;ratings.push({ref:line.row.id,type:'complaint',customerId,at:act.at,value:act.rating,ok:null,tag:'rating'});}
  const windowEnd=new Date(Date.parse(act.at)+COMPLAINT_REOPEN_DAYS*DAY).toISOString(),reopened=line.reopens.find(at=>at>act.at&&at<=windowEnd),decided=reopened||windowEnd;
  if(within(ctx,decided))held.push({ref:line.row.id,type:'complaint',customerId,at:decided,value:null,ok:!reopened,tag:reopened?'reopened':'held'});
 }
 const audits:KpiItem[]=[];let auditSum=0;
 for(const row of facts.audits){
  const data=row.data;if(data.repId!==rep.id||data.month!==ctx.month)continue;
  auditSum+=data.total;audits.push({ref:row.id,type:'audit',customerId:'',at:data.at,value:data.total,ok:data.total>=ctx.settings.audit.pass,tag:data.result});
 }
 const accuracy:KpiItem[]=[];
 for(const line of facts.complaints){
  if(line.registrar!==rep.id||!line.firstDecision||!within(ctx,line.firstDecision.at))continue;
  accuracy.push({ref:line.row.id,type:'complaint',customerId:line.row.data.customerId,at:line.firstDecision.at,value:null,ok:line.firstDecision.action==='forward',tag:line.firstDecision.action});
 }
 for(const item of facts.cases){
  const data=item.data;if(item.creatorId!==rep.id||!data.approvedAt||!within(ctx,data.approvedAt))continue;
  accuracy.push({ref:item.id,type:'service',customerId:item.customerId,at:data.approvedAt,value:null,ok:!data.resubmittedAt,tag:data.resubmittedAt?'resubmitted':'approved'});
 }
 // Clearance: what was cleared out of what was in the representative's hands or reached them in the month. An item still open at
 // the end that has not yet used up its time is not counted against them.
 const cleared:KpiItem[]=[];
 for(const work of repWorks(ctx,rep)){
  if(work.arrival>ctx.clip)continue;
  const finished=work.finish&&work.finish<=ctx.clip;
  if(finished){if(work.finish<ctx.from)continue;cleared.push({ref:work.ref,type:work.type,customerId:work.customerId,at:work.finish,value:round2(workingHoursBetween(work.arrival,work.finish)),ok:true,tag:work.tag});}
  else{const waited=workingHoursBetween(work.arrival,ctx.clip);if(waited>work.due)cleared.push({ref:work.ref,type:work.type,customerId:work.customerId,at:work.arrival,value:round2(waited),ok:false,tag:work.tag});}
 }
 const part=(items:KpiItem[])=>share(items);
 return [
  metric('support_response','share',s.support_response,part(supportItems).numerator,supportItems.length,supportItems),
  metric('closure_timing','share',s.closure_timing,part(timing).numerator,timing.length,timing),
  metric('closures_held','share',s.closures_held,part(held).numerator,held.length,held),
  metric('audit_quality','average',s.audit_quality,auditSum,audits.length,audits),
  metric('missed_visits','share',s.missed_visits,part(missedItems).numerator,missedItems.length,missedItems),
  metric('registration_accuracy','share',s.registration_accuracy,part(accuracy).numerator,accuracy.length,accuracy),
  metric('clearance','share',s.clearance,part(cleared).numerator,cleared.length,cleared),
  metric('customer_rating','rating',s.customer_rating,ratingSum,ratings.length,ratings)
 ];
}

// ---- the manager
const ofTeam=(line:Timeline,team:Set<string>,managerId:string)=>team.has(line.registrar)||line.row.data.serviceManagerId===managerId;
export function managerMetrics(ctx:Ctx,manager:Member,team:Member[],cards:Scorecard[]):KpiMetric[]{
 const s=ctx.settings.manager,facts=ctx.facts,ids=new Set(team.map(member=>member.id));
 const scored=cards.filter(card=>card.score!==null),scoreSum=scored.reduce((sum,card)=>sum+(card.score as number),0);
 const average:KpiItem[]=scored.map(card=>({ref:card.memberId,type:'member',customerId:'',at:'',value:card.score,ok:null,tag:'member'}));
 const reviews:KpiItem[]=[];
 for(const line of facts.complaints)for(const review of line.reviews){
  if(review.by!==manager.id||!within(ctx,review.at))continue;
  const hours=workingHoursBetween(review.since,review.at);
  reviews.push({ref:line.row.id,type:'complaint',customerId:line.row.data.customerId,at:review.at,value:round2(hours),ok:hours<=ctx.settings.hours.review,tag:review.action});
 }
 for(const item of facts.cases){
  const data=item.data;if(data.approvedBy!==manager.id||!within(ctx,data.approvedAt))continue;
  const hours=workingHoursBetween(data.resubmittedAt||item.createdAt,data.approvedAt as string);
  reviews.push({ref:item.id,type:'service',customerId:item.customerId,at:data.approvedAt as string,value:round2(hours),ok:hours<=ctx.settings.hours.review,tag:'approved'});
 }
 const life:KpiItem[]=[],ratings:KpiItem[]=[];let ratingSum=0;
 for(const line of facts.complaints)for(const act of line.acts){
  if(act.action!=='close'||!within(ctx,act.at))continue;
  const customerId=line.row.data.customerId;
  if(ofTeam(line,ids,manager.id)){const hours=workingHoursBetween(line.submitted,act.at);life.push({ref:line.row.id,type:'complaint',customerId,at:act.at,value:round2(hours),ok:hours<=lifeTarget(ctx.settings,line.row.data.severity),tag:'close'});}
  if(ids.has(act.by)&&act.rating){ratingSum+=act.rating;ratings.push({ref:line.row.id,type:'complaint',customerId,at:act.at,value:act.rating,ok:null,tag:'rating'});}
 }
 const answered:KpiItem[]=[];
 for(const row of facts.support){
  const data=row.data;if(!ids.has(data.handlerId)||!data.result||!within(ctx,data.result.at))continue;
  const hours=workingHoursBetween(requestedAt(row),data.result.at);
  answered.push({ref:row.id,type:'support',customerId:data.customerId,at:data.result.at,value:round2(hours),ok:hours<=supportDue(ctx,row),tag:'answered'});
 }
 const audits:KpiItem[]=[];let auditSum=0;
 for(const row of facts.audits){
  const data=row.data;if(!ids.has(data.repId)||data.month!==ctx.month)continue;
  auditSum+=data.total;audits.push({ref:row.id,type:'audit',customerId:'',at:data.at,value:data.total,ok:data.total>=ctx.settings.audit.pass,tag:data.result});
 }
 // Backlog: of what stood open when the month ended (or now), how much had already passed its time.
 const backlog:KpiItem[]=[];
 for(const line of facts.complaints){
  if(!ofTeam(line,ids,manager.id)||!openAt(line,ctx.clip))continue;
  const waited=workingHoursBetween(line.submitted,ctx.clip);
  backlog.push({ref:line.row.id,type:'complaint',customerId:line.row.data.customerId,at:line.submitted,value:round2(waited),ok:waited<=lifeTarget(ctx.settings,line.row.data.severity),tag:'open'});
 }
 for(const row of facts.support){
  const data=row.data;if(row.branch!==manager.branch||requestedAt(row)>ctx.clip)continue;
  if(data.result&&data.result.at<=ctx.clip||data.cancelledAt&&data.cancelledAt<=ctx.clip)continue;
  const waited=workingHoursBetween(requestedAt(row),ctx.clip);
  backlog.push({ref:row.id,type:'support',customerId:data.customerId,at:requestedAt(row),value:round2(waited),ok:waited<=supportDue(ctx,row),tag:'open'});
 }
 // Repeat complaints: of the team's complaints registered in the month, how many were the customer's first within the window.
 const repeats:KpiItem[]=[];
 for(const line of facts.complaints){
  if(!ofTeam(line,ids,manager.id)||!within(ctx,line.submitted))continue;
  const floor=new Date(Date.parse(line.submitted)-REPEAT_COMPLAINT_DAYS*DAY).toISOString();
  const earlier=(facts.byCustomer.get(line.row.data.customerId)||[]).some(other=>other!==line&&other.submitted<line.submitted&&other.submitted>=floor&&!other.cancels.some(at=>at<=line.submitted));
  repeats.push({ref:line.row.id,type:'complaint',customerId:line.row.data.customerId,at:line.submitted,value:null,ok:!earlier,tag:earlier?'repeat':'first'});
 }
 const part=(items:KpiItem[])=>share(items);
 const open=backlog.length,onTime=backlog.filter(item=>item.ok).length;
 return [
  metric('team_average','average',s.team_average,scoreSum,scored.length,average),
  metric('review_timing','share',s.review_timing,part(reviews).numerator,reviews.length,reviews),
  metric('life_timing','share',s.life_timing,part(life).numerator,life.length,life),
  metric('team_rating','rating',s.team_rating,ratingSum,ratings.length,ratings),
  metric('team_support_response','share',s.team_support_response,part(answered).numerator,answered.length,answered),
  metric('team_quality','average',s.team_quality,auditSum,audits.length,audits),
  metric('backlog','share',s.backlog,onTime,open,backlog,true),
  metric('repeat_complaints','share',s.repeat_complaints,part(repeats).numerator,repeats.length,repeats)
 ];
}

// ---- who is evaluated together, and the month as a whole
export const serviceKpiAllowed=(role:string)=>role==='admin'||role==='customer_service'||role==='customer_service_manager';
const hasData=(card:Scorecard)=>card.metrics.some(one=>one.denominator>0);
const byScore=(a:Scorecard,b:Scorecard,names:Map<string,Member>)=>(b.score??-1)-(a.score??-1)||(names.get(a.memberId)?.name||'').localeCompare(names.get(b.memberId)?.name||'')||a.memberId.localeCompare(b.memberId);

/** The customer-service manager a representative reports to; empty when nobody does, and then they are evaluated apart. */
export const kpiManagerOf=(rep:Pick<Member,'supervisorId'>,members:Member[])=>members.find(member=>member.id===rep.supervisorId&&member.role==='customer_service_manager')?.id||'';
/** The certificate that closes this representative's month, if one does: their manager's team's, or any that names them. */
export const closedMonthFor=(repId:string,managerId:string,month:string,rows:ServiceKpiMonthRow[])=>rows.find(row=>row.data&&row.data.month===month&&!row.data.reopened&&(row.data.managerId===managerId||row.data.team.includes(repId)));

export function serviceKpiMonth(input:KpiInput,month:string,now:string=new Date().toISOString()):KpiMonth{
 const facts=buildFacts(input),from=monthStart(month),to=monthEnd(month),clip=now<to?now:to;
 const reps=input.members.filter(member=>member.role==='customer_service'),managers=input.members.filter(member=>member.role==='customer_service_manager');
 const closedBy=new Map(input.closed.filter(row=>row.data&&row.data.month===month&&!row.data.reopened).map(row=>[row.data.managerId,row]));
 const live=normalizeSettings(input.settings);
 const groups:KpiGroup[]=[];
 const ids=new Set(['',...managers.map(manager=>manager.id),...closedBy.keys()]);
 for(const managerId of ids){
  const certificate=closedBy.get(managerId),settings=certificate?normalizeSettings(certificate.data.settings):live;
  const ctx:Ctx={facts,settings,month,from,to,now,clip};
  const manager=managerId?facts.byId.get(managerId):undefined;
  let team:Member[];
  if(certificate)team=certificate.data.team.map(id=>facts.byId.get(id)).filter((member):member is Member=>!!member);
  else team=reps.filter(rep=>kpiManagerOf(rep,input.members)===managerId);
  const cards:Scorecard[]=[];
  for(const rep of team){const card=scorecard(rep.id,'rep',repMetrics(ctx,rep));if(certificate||rep.active||hasData(card))cards.push(card);}
  cards.sort((a,b)=>byScore(a,b,facts.byId));
  const managerCard=manager?scorecard(manager.id,'manager',managerMetrics(ctx,manager,team,cards)):null;
  if(!certificate&&!cards.length&&!(manager&&manager.active))continue;
  let drift=false;
  if(certificate)for(const card of [...cards,...(managerCard?[managerCard]:[])]){const stored=certificate.data.scores[card.memberId];if((stored??null)!==card.score&&(stored==null||card.score===null||Math.abs(stored-card.score)>0.05))drift=true;}
  groups.push({managerId,managerName:manager?.name||'',closed:!!certificate,closedAt:certificate?.data.closedAt||'',closedBy:certificate?.data.closedBy||'',drift,settings,manager:managerCard,reps:cards});
 }
 groups.sort((a,b)=>Number(!a.managerId)-Number(!b.managerId)||a.managerName.localeCompare(b.managerName)||a.managerId.localeCompare(b.managerId));
 return {month,generatedAt:now,groups};
}
/** What the reader may see of the month: a representative their own card, a manager their team and themself, an administrator everyone. */
export function visibleKpi(month:KpiMonth,me:Member):KpiMonth{
 if(me.role==='admin')return month;
 if(me.role==='customer_service_manager')return {...month,groups:month.groups.filter(group=>group.managerId===me.id)};
 if(me.role==='customer_service')return {...month,groups:month.groups.filter(group=>group.reps.some(card=>card.memberId===me.id)).map(group=>({...group,manager:null,reps:group.reps.filter(card=>card.memberId===me.id)}))};
 return {...month,groups:[]};
}
/** The months that have anything to evaluate, newest first, the current one always included. */
export function kpiMonths(input:Pick<KpiInput,'complaints'|'support'|'audits'|'closed'>,now:string=new Date().toISOString()){
 const found=new Set<string>([kpiMonthOf(now)]);
 for(const row of input.complaints)found.add(kpiMonthOf(row.createdAt));
 for(const row of input.support)found.add(kpiMonthOf(row.createdAt));
 for(const row of input.audits)if(!row.data.deleted&&KPI_MONTH.test(row.data.month))found.add(row.data.month);
 for(const row of input.closed)if(!row.data.reopened&&KPI_MONTH.test(row.data.month))found.add(row.data.month);
 return [...found].filter(month=>KPI_MONTH.test(month)&&month<=kpiMonthOf(now)).sort().reverse().slice(0,24);
}
/** Whether a team's month may be closed now: the month is over and the waiting days have passed. */
export function monthCloseProblem(month:string,now:string,settings:ServiceKpiSettings):string{
 if(!KPI_MONTH.test(month))return 'اختر شهرًا صحيحًا';
 const opensAt=Date.parse(monthEnd(month))+settings.closeGraceDays*DAY;
 return Date.parse(now)>=opensAt?'':settings.closeGraceDays>0?`لا يُقفل الشهر قبل مرور ${settings.closeGraceDays} أيام على انتهائه`:'لا يُقفل الشهر قبل أن ينتهي';
}
/** The certificate that closes a group's month. */
export function monthCertificate(group:KpiGroup,month:string,by:string,at:string):ServiceKpiMonthData{
 const scores:Record<string,number|null>={};
 for(const card of [...group.reps,...(group.manager?[group.manager]:[])])scores[card.memberId]=card.score;
 return {kind:'service_kpi_month',month,managerId:group.managerId,team:group.reps.map(card=>card.memberId),settings:group.settings,closedBy:by,closedAt:at,scores};
}

// ---- quality audits
export type AuditScores=Partial<Record<AuditCriterion,number>>;
/** The total of an audit out of 100, or why its marks are not acceptable. */
export function auditTotal(scores:AuditScores,settings:ServiceKpiSettings):{ok:true;total:number}|{ok:false;error:string}{
 let total=0;
 for(const key of AUDIT_CRITERIA){
  const value=scores[key],max=settings.audit.criteria[key];
  if(typeof value!=='number'||!Number.isInteger(value)||value<0||value>max)return {ok:false,error:`درجة «${auditCriterionLabels[key]}» بين 0 و${max}`};
  total+=value;
 }
 return {ok:true,total};
}
export const auditResult=(total:number,settings:ServiceKpiSettings):'pass'|'coach'|'fail'=>total>=settings.audit.pass?'pass':total>=settings.audit.coach?'coach':'fail';
/** A stable pseudo-random order so the suggested sample is the same on every visit but cannot be picked by hand. */
export function sampleOrder(seed:string){let hash=2166136261;for(let index=0;index<seed.length;index++){hash^=seed.charCodeAt(index);hash=Math.imul(hash,16777619)>>>0;}return hash;}
export type AuditCandidate={ref:string;type:'complaint'|'support';customerId:string;at:string;tag:string};
/** The representative's finished work in the month that a manager can audit: the complaints they closed or sent back and the assistance they answered. */
export function auditCandidates(input:KpiInput,month:string,repId:string,now:string=new Date().toISOString()):AuditCandidate[]{
 const facts=buildFacts(input),from=monthStart(month),to=monthEnd(month),found:AuditCandidate[]=[];
 const inside=(at:string)=>at>=from&&at<to&&at<=now;
 for(const line of facts.complaints)for(const act of line.acts)if(act.by===repId&&inside(act.at))found.push({ref:line.row.id,type:'complaint',customerId:line.row.data.customerId,at:act.at,tag:act.action});
 for(const row of facts.support)if(row.data.handlerId===repId&&row.data.result&&inside(row.data.result.at))found.push({ref:row.id,type:'support',customerId:row.data.customerId,at:row.data.result.at,tag:row.data.origin==='missed_visit'?'missed':'support'});
 return found;
}
/** The audits the system suggests: random but stable picks from the candidates, leaving out what has been audited already. */
export function auditSample(input:KpiInput,month:string,repId:string,now:string=new Date().toISOString()):AuditCandidate[]{
 const audited=new Set(input.audits.filter(row=>!row.data.deleted&&row.data.repId===repId&&row.data.month===month).map(row=>row.data.reference.id));
 const size=normalizeSettings(input.settings).audit.sample;
 return auditCandidates(input,month,repId,now).filter(item=>!audited.has(item.ref)).map(item=>({item,order:sampleOrder(`${repId}|${month}|${item.ref}|${item.tag}|${item.at}`)})).sort((a,b)=>a.order-b.order||a.item.ref.localeCompare(b.item.ref)).slice(0,size).map(entry=>entry.item).sort((a,b)=>a.at.localeCompare(b.at));
}

// ---- what the route sends to the page
export type KpiItemOut=KpiItem&{customerName:string};
export type KpiMetricOut=Omit<KpiMetric,'items'>&{items:KpiItemOut[];itemCount:number};
export type KpiCardOut=Omit<Scorecard,'metrics'>&{name:string;metrics:KpiMetricOut[]};
export type KpiGroupOut=Omit<KpiGroup,'manager'|'reps'|'closedBy'>&{closedByName:string;canClose:boolean;closeProblem:string;canReopen:boolean;manager:KpiCardOut|null;reps:KpiCardOut[]};
export type KpiAuditOut={id:string;repId:string;repName:string;month:string;date:string;reference:{type:string;id:string;customerName:string};scores:Partial<Record<AuditCriterion,number>>;total:number;result:string;verification:{called:boolean;rating:number|null};note:string;auditorId:string;auditorName:string;at:string;canDelete:boolean};
export type KpiSampleOut={ref:string;type:'complaint'|'support';customerName:string;at:string;tag:string};
export type ServiceKpiResponse={
 month:string;months:string[];generatedAt:string;settings:ServiceKpiSettings;settingsVersion:number;
 me:{id:string;role:string;canAudit:boolean;canSettings:boolean};
 groups:KpiGroupOut[];audits:KpiAuditOut[];sample:Record<string,KpiSampleOut[]>;
 /** The selected month and the two before it, oldest first, with each visible card's score in them; and, for the people who manage, each team's median ('none' for those without a manager). */
 trend:{months:string[];scores:Record<string,(number|null)[]>;medians:Record<string,(number|null)[]>};
};
const median=(values:number[])=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);return round1(sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2);};
/** The month as the reader may see it: their cards, the figures' cases only for the one card they opened (a representative's own is always open),
 * the audits of the cards they see, the suggested sample for those a manager can still audit, and what they may do. */
export function serviceKpiView(input:KpiInput,month:string,now:string,me:Member,options:{customerName:(id:string)=>string;detail?:string;settingsVersion:number}):ServiceKpiResponse{
 const all=serviceKpiMonth(input,month,now),visible=visibleKpi(all,me),names=new Map(input.members.map(member=>[member.id,member.name]));
 const admin=me.role==='admin',lead=me.role==='customer_service_manager',name=(id:string)=>names.get(id)||'';
 const cardOut=(card:Scorecard):KpiCardOut=>{
  const open=me.role==='customer_service'||card.memberId===options.detail;
  return {...card,name:name(card.memberId),metrics:card.metrics.map(one=>({...one,itemCount:one.items.length,items:open?one.items.slice(0,KPI_ITEM_LIMIT).map(item=>({...item,customerName:item.customerId?options.customerName(item.customerId):''})):[]}))};
 };
 const groups=visible.groups.map(group=>{
  const {closedBy,manager,reps,...rest}=group;
  const mayClose=admin||lead&&group.managerId===me.id,problem=mayClose&&!group.closed?monthCloseProblem(month,now,group.settings):'';
  return {...rest,closedByName:name(closedBy),canClose:mayClose&&!group.closed&&problem==='',closeProblem:problem,canReopen:admin&&group.closed,manager:manager?cardOut(manager):null,reps:reps.map(cardOut)};
 });
 const groupOf=new Map<string,KpiGroup>();
 for(const group of all.groups)for(const card of group.reps)groupOf.set(card.memberId,group);
 const seen=new Set(visible.groups.flatMap(group=>group.reps.map(card=>card.memberId)));
 const customerOf=new Map<string,string>();
 for(const row of input.complaints)customerOf.set(row.id,row.data.customerId);
 for(const row of input.support)customerOf.set(row.id,row.data.customerId);
 for(const row of input.serviceCases)customerOf.set(row.id,row.customerId);
 const audits=input.audits.filter(row=>!row.data.deleted&&row.data.month===month&&seen.has(row.data.repId)).sort((a,b)=>b.data.at.localeCompare(a.data.at)||b.id.localeCompare(a.id)).map(row=>{
  const data=row.data,reference=data.reference&&data.reference.id?data.reference:{type:'' as const,id:''};
  return {id:row.id,repId:data.repId,repName:name(data.repId),month:data.month,date:data.date||'',reference:{type:reference.type,id:reference.id,customerName:reference.id?options.customerName(customerOf.get(reference.id)||''):''},scores:data.scores,total:data.total,result:data.result,verification:data.verification,note:data.note,auditorId:data.auditorId,auditorName:name(data.auditorId),at:data.at,
   canDelete:!groupOf.get(data.repId)?.closed&&(admin||data.auditorId===me.id&&Date.parse(now)-Date.parse(data.at)<=AUDIT_DELETE_DAYS*DAY)};
 });
 const sample:Record<string,KpiSampleOut[]>={};
 if(admin||lead)for(const group of visible.groups)if(!group.closed)for(const card of group.reps)sample[card.memberId]=auditSample(input,month,card.memberId,now).map(item=>({ref:item.ref,type:item.type,customerName:options.customerName(item.customerId),at:item.at,tag:item.tag}));
 // One month alone is noisy for a small team, so each card shows its last three months; a finished month answers the same however late it is asked.
 const months=trailingMonths(month,3),computed=months.map(one=>one===month?all:serviceKpiMonth(input,one,now));
 const scoreIn=(result:KpiMonth,id:string)=>{for(const group of result.groups){const found=group.reps.find(card=>card.memberId===id)||(group.manager&&group.manager.memberId===id?group.manager:undefined);if(found)return found.score;}return null;};
 const scores:Record<string,(number|null)[]>={},medians:Record<string,(number|null)[]>={};
 for(const group of visible.groups){
  for(const card of [...group.reps,...(group.manager?[group.manager]:[])])scores[card.memberId]=computed.map(result=>scoreIn(result,card.memberId));
  if(admin||lead)medians[group.managerId||'none']=computed.map(result=>median((result.groups.find(other=>other.managerId===group.managerId)?.reps||[]).map(card=>card.score).filter((value):value is number=>value!==null)));
 }
 return {month,months:kpiMonths(input,now),generatedAt:now,settings:normalizeSettings(input.settings),settingsVersion:options.settingsVersion,me:{id:me.id,role:me.role,canAudit:admin||lead,canSettings:admin},groups,audits,sample,trend:{months,scores,medians}};
}
