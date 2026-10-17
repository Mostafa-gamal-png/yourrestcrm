'use client';
import {Fragment,useCallback,useEffect,useRef,useState} from 'react';
import {Gauge,Lock,LockOpen,Plus,Settings2,Trash2} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {definiteSubmitRejection,submitJson} from '@/lib/client-submit';
import {direction,getLanguage,t,useLanguage} from '@/lib/i18n';
import type {Member} from '@/lib/crm';
import {AUDIT_CRITERIA,AUDIT_NOTE_MAX,DEFAULT_SERVICE_KPI_SETTINGS,MANAGER_METRICS,REP_METRICS,auditCriterionLabels,auditCriterionLabelsEn,auditResult,auditResultLabels,auditResultLabelsEn,auditTotal,managerMetricLabels,managerMetricLabelsEn,repMetricLabels,repMetricLabelsEn,settingsProblem,type AuditCriterion,type KpiAuditOut,type KpiCardOut,type KpiGroupOut,type KpiItemOut,type KpiMetricOut,type ManagerMetric,type MetricSetting,type RepMetric,type ServiceKpiResponse,type ServiceKpiSettings} from '@/lib/service-kpi';
import './service-report.css';
import './service-kpi.css';

type Say=(ar:string,en:string)=>string;
const messageOf=(error:unknown)=>typeof error==='object'&&error!==null&&'message' in error&&typeof (error as {message:unknown}).message==='string'?(error as {message:string}).message:'';
const stamp=(iso:string)=>iso?new Date(iso).toLocaleString('en-GB',{timeZone:'Asia/Riyadh'}):'—';
const dayOf=(iso:string)=>iso?new Date(iso).toLocaleDateString('en-GB',{timeZone:'Asia/Riyadh'}):'';
const r1=(value:number)=>Math.round(value*10)/10;
const levelOf=(score:number|null)=>score===null?'none':score>=90?'good':score>=75?'warn':'bad';

/** The names of the figures and what a case of each means, in the reader's language. */
const metricName=(role:'rep'|'manager',key:string,say:Say)=>role==='rep'?say(repMetricLabels[key as RepMetric]||key,repMetricLabelsEn[key as RepMetric]||key):say(managerMetricLabels[key as ManagerMetric]||key,managerMetricLabelsEn[key as ManagerMetric]||key);
const criterionName=(key:AuditCriterion,say:Say)=>say(auditCriterionLabels[key],auditCriterionLabelsEn[key]);
const resultName=(result:string,say:Say)=>say(auditResultLabels[result]||result,auditResultLabelsEn[result]||result);
/** What a figure says, by the kind of figure: a share, a mark out of 100, or a rating out of 5. */
export function metricValueText(metric:Pick<KpiMetricOut,'kind'|'actual'|'empty'|'numerator'|'denominator'>,say:Say){
 if(metric.empty)return say('لا متراكم','Nothing open');
 if(metric.actual===null)return '—';
 if(metric.kind==='rating')return (metric.numerator/metric.denominator).toFixed(1)+' / 5';
 if(metric.kind==='average')return r1(metric.actual).toFixed(1);
 return r1(metric.actual).toFixed(1)+'%';
}
const targetText=(metric:Pick<KpiMetricOut,'kind'|'target'>)=>metric.kind==='average'?String(metric.target):metric.target+'%';
const HOURS_FIGURES=new Set(['support_response','closure_timing','missed_visits','clearance','review_timing','life_timing','team_support_response','backlog']);
const tagText=(tag:string,say:Say)=>({
 answered:say('أُجيب','Answered'),close:say('أُغلقت','Closed'),reject:say('أُعيدت إلى المندوب','Sent back to the representative'),held:say('ثبت الإغلاق','The closure held'),reopened:say('أُعيد فتحها','Reopened'),
 forward:say('أُحيلت من أول مرة','Passed review first time'),return:say('أُعيدت للتعديل','Returned for correction'),approved:say('اعتُمد من أول مرة','Approved first time'),resubmitted:say('أُعيد للتعديل قبل الاعتماد','Returned before approval'),
 fix:say('تعديل شكوى','Complaint to correct'),confirm:say('تأكيد إغلاق','Closure to confirm'),support:say('مساندة','Assistance'),missed:say('زيارة مفقودة','Missed visit'),open:say('مفتوح','Open'),
 rating:say('تقييم العميل','Customer rating'),first:say('أول شكوى للعميل','First complaint of the customer'),repeat:say('متكررة','Repeat'),member:say('درجة','Score'),pass:say('ناجح','Pass'),coach:say('يحتاج تدريبًا','Needs coaching'),fail:say('راسب','Fail')
} as Record<string,string>)[tag]||tag;
function itemValue(metricKey:string,item:KpiItemOut,say:Say){
 if(item.value===null)return '';
 if(metricKey==='customer_rating'||metricKey==='team_rating')return '★ '+item.value;
 if(metricKey==='audit_quality'||metricKey==='team_quality')return item.value+' / 100';
 if(metricKey==='team_average')return item.value.toFixed(1);
 if(HOURS_FIGURES.has(metricKey))return item.value.toFixed(1)+' '+say('س','h');
 return String(item.value);
}

/** The cases behind one figure: what was counted, when, for which customer, and whether it met the target. */
function ItemList({metric,say,nameOf,loading}:{metric:KpiMetricOut;say:Say;nameOf:(id:string)=>string;loading:boolean}){
 if(!metric.items.length)return <p className="sk-muted" role="status">{loading?say('جارٍ تحميل الحالات','Loading the cases'):say('لا حالات لهذا المؤشر.','No cases for this figure.')}</p>;
 return <ul className="sk-items" data-figure={metric.key}>{metric.items.map((item,index)=><li key={item.ref+':'+item.tag+':'+index} data-ok={item.ok===null?'none':String(item.ok)}>
  <span className="sk-mark" aria-hidden="true">{item.ok===null?'•':item.ok?'✓':'✗'}</span>
  <span className="sk-item-text"><b>{item.type==='member'?nameOf(item.ref):item.customerName||'—'}</b> <small>{tagText(item.tag,say)}{item.at?' · '+dayOf(item.at):''}</small></span>
  <span className="sk-item-value">{itemValue(metric.key,item,say)}</span>
 </li>)}{metric.itemCount>metric.items.length&&<li className="sk-more">{say('وغيرها: ','And ')}{metric.itemCount-metric.items.length}{say(' حالة',' more')}</li>}</ul>;
}

/** One card's figures: the value reached, the target, the weight, the points earned and the number of cases, each opening onto its cases. */
export function MetricsTable({card,role,say,nameOf,loading,defaultOpen=''}:{card:KpiCardOut;role:'rep'|'manager';say:Say;nameOf:(id:string)=>string;loading:boolean;defaultOpen?:string}){
 const [open,setOpen]=useState(defaultOpen);
 return <div className="sk-table-wrap"><table className="service-report-table sk-table"><thead><tr>{[say('المؤشر','Figure'),say('الفعلي','Reached'),say('الهدف','Target'),say('الوزن','Weight'),say('النقاط','Points'),say('الحالات','Cases')].map(head=><th key={head}>{head}</th>)}</tr></thead>
  <tbody>{card.metrics.map(metric=>{
   const level=!metric.enough?'none':metric.achieved>=1?'good':metric.achieved>=0.85?'warn':'bad';
   return <Fragment key={metric.key}>
    <tr className="sk-row" data-level={level} data-figure={metric.key}>
     <td><button type="button" className="sk-toggle" aria-expanded={open===metric.key} disabled={!metric.itemCount} onClick={()=>setOpen(open===metric.key?'':metric.key)}>{metricName(role,metric.key,say)}</button></td>
     <td className="sk-value">{metricValueText(metric,say)}</td>
     <td>{targetText(metric)}</td>
     <td>{metric.weight}</td>
     <td>{metric.measured?metric.points.toFixed(1):'—'}</td>
     <td>{metric.enough?metric.denominator:<span className="sk-chip" data-kind="few">{say('غير كافٍ','Not enough')} {metric.denominator}/{metric.min}</span>}</td>
    </tr>
    {open===metric.key&&<tr className="sk-detail"><td colSpan={6}><ItemList metric={metric} say={say} nameOf={nameOf} loading={loading}/></td></tr>}
   </Fragment>;
  })}</tbody></table></div>;
}

export function CardView({card,role,say,open,onToggle,nameOf,loading,defaultOpen}:{card:KpiCardOut;role:'rep'|'manager';say:Say;open:boolean;onToggle:()=>void;nameOf:(id:string)=>string;loading:boolean;defaultOpen?:string}){
 const note=card.score===null?say('لا بيانات كافية','Not enough data'):card.measuredWeight<100?say(`قيست على ${card.measuredWeight} من 100`,`Measured on ${card.measuredWeight} of 100`):'';
 return <article className="sk-card" data-member={card.memberId} data-level={levelOf(card.score)} data-role={role} data-open={open}>
  <button type="button" className="sk-card-head" aria-expanded={open} onClick={onToggle}>
   <span className="sk-name">{role==='manager'&&<small>{say('بطاقة المدير','Manager')} · </small>}{card.name||card.memberId}</span>
   <span className="sk-score" data-level={levelOf(card.score)}>{card.score===null?'—':card.score.toFixed(1)}</span>
   {note&&<span className="sk-measured">{note}</span>}
  </button>
  {open&&<div className="sk-card-body"><MetricsTable card={card} role={role} say={say} nameOf={nameOf} loading={loading} defaultOpen={defaultOpen}/></div>}
 </article>;
}

/** The team side by side, each figure as a share, so a manager can see where the team is weak before opening anyone. */
function Comparison({group,say,onOpen}:{group:KpiGroupOut;say:Say;onOpen:(id:string)=>void}){
 if(group.reps.length<2)return null;
 return <div className="sk-table-wrap"><table className="service-report-table sk-compare"><thead><tr><th>{say('الممثل','Representative')}</th><th>{say('الدرجة','Score')}</th>{REP_METRICS.map(key=><th key={key}>{say(repMetricLabels[key],repMetricLabelsEn[key])}</th>)}</tr></thead>
  <tbody>{group.reps.map(card=><tr key={card.memberId}><td><button type="button" className="sk-toggle" onClick={()=>onOpen(card.memberId)}>{card.name}</button></td><td><span className="sk-score" data-level={levelOf(card.score)}>{card.score===null?'—':card.score.toFixed(1)}</span></td>
   {card.metrics.map(metric=><td key={metric.key} data-level={!metric.enough?'none':metric.achieved>=1?'good':metric.achieved>=0.85?'warn':'bad'}>{metric.enough?metricValueText(metric,say):'—'}</td>)}</tr>)}</tbody></table></div>;
}

/** One request to the route. A retry after an unclear failure keeps its identifier, so it can never save twice. */
function useKpiAction(onDone:()=>Promise<void>|void){
 const lock=useRef(false),attempt=useRef<{body:string;key:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const run=useCallback(async(body:Record<string,unknown>)=>{
  if(lock.current)return false;
  lock.current=true;setBusy(true);setError('');
  const text=JSON.stringify(body);if(attempt.current?.body!==text)attempt.current={body:text,key:crypto.randomUUID()};
  try{
   await submitJson('/api/service-kpi',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,requestId:attempt.current.key})},{language:getLanguage()});
   attempt.current=null;await onDone();return true;
  }catch(failure){setError(messageOf(failure));if(definiteSubmitRejection(failure))attempt.current=null;return false;}
  finally{lock.current=false;setBusy(false);}
 },[onDone]);
 return {run,busy,error,clear:()=>setError('')};
}

/** The month as the reader may see it, loaded when asked for and again after every change they make. */
function useKpi(enabled:boolean){
 const [month,setMonth]=useState(''),[detail,setDetail]=useState(''),[data,setData]=useState<ServiceKpiResponse|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(enabled);
 const generation=useRef(0);
 const refresh=useCallback(async()=>{
  const current=++generation.current;setLoading(true);
  const query=new URLSearchParams();if(month)query.set('month',month);if(detail)query.set('member',detail);
  try{
   const next=await submitJson<ServiceKpiResponse>('/api/service-kpi'+(query.toString()?'?'+query.toString():''),{cache:'no-store'},{language:getLanguage()});
   if(current===generation.current){setData(next);setError('');}
  }catch(failure){if(current===generation.current)setError(messageOf(failure)||'تعذر تحميل التقييم.');}
  finally{if(current===generation.current)setLoading(false);}
 },[month,detail]);
 useEffect(()=>{
  if(!enabled)return;
  const timer=window.setTimeout(()=>{void refresh();},0);
  return()=>window.clearTimeout(timer);
 },[enabled,refresh]);
 return {data,error,loading,month,setMonth,detail,setDetail,refresh};
}

function MonthSelect({data,value,onChange,say}:{data:ServiceKpiResponse;value:string;onChange:(month:string)=>void;say:Say}){
 const months=[...new Set([value||data.month,...data.months])].sort().reverse();
 return <label className="field sk-month"><span>{say('الشهر','Month')}</span><select value={value||data.month} onChange={event=>onChange(event.target.value)}>{months.map(month=><option key={month} value={month}>{month}</option>)}</select></label>;
}

function AuditList({data,say,onDelete,busy}:{data:ServiceKpiResponse;say:Say;onDelete?:(audit:KpiAuditOut)=>void;busy:boolean}){
 if(!data.audits.length)return <p className="sk-muted">{say('لا تدقيقات في هذا الشهر.','No audits this month.')}</p>;
 return <ul className="sk-audit-list">{data.audits.map(audit=><li key={audit.id} data-audit={audit.id} data-result={audit.result}>
  <header><strong>{audit.repName}</strong><span className="sk-chip" data-kind={audit.result}>{resultName(audit.result,say)} · {audit.total}/100</span><small>{stamp(audit.at)} · {audit.auditorName}</small></header>
  {audit.reference.id&&<p className="sk-ref">{audit.reference.type==='complaint'?say('شكوى','Complaint'):audit.reference.type==='support'?say('مساندة','Assistance'):say('طلب خدمة','Service request')}: {audit.reference.customerName||'—'}</p>}
  <div className="sk-marks">{AUDIT_CRITERIA.map(key=><span key={key} className="sk-chip" data-kind="mark">{criterionName(key,say)}: {audit.scores[key]??'—'}/{data.settings.audit.criteria[key]}</span>)}</div>
  {audit.verification.called&&<p className="sk-ref">{say('اتصل المدقق بالعميل للتحقق','The auditor called the customer to verify')}{audit.verification.rating?' · '+say('تقييم العميل له: ','Customer rated: ')+'★ '+audit.verification.rating:''}</p>}
  {audit.note&&<p className="sk-note">{audit.note}</p>}
  {audit.canDelete&&onDelete&&<button type="button" className="btn subtle small" disabled={busy} onClick={()=>onDelete(audit)}><Trash2 size={14} aria-hidden="true"/>{say('حذف التدقيق','Delete the audit')}</button>}
 </li>)}</ul>;
}

type AuditSeed={repId:string;refType:string;refId:string};
function AuditDialog({data,say,seed,onClose,onSaved}:{data:ServiceKpiResponse;say:Say;seed:AuditSeed;onClose:()=>void;onSaved:()=>Promise<void>|void}){
 const reps=data.groups.filter(group=>!group.closed).flatMap(group=>group.reps.map(card=>({id:card.memberId,name:card.name})));
 const [repId,setRepId]=useState(seed.repId||reps[0]?.id||''),[reference,setReference]=useState(seed.refType?seed.refType+':'+seed.refId:''),[marks,setMarks]=useState<Record<string,string>>({});
 const [called,setCalled]=useState(false),[rating,setRating]=useState(''),[note,setNote]=useState(''),[date,setDate]=useState('');
 const action=useKpiAction(async()=>{await onSaved();onClose();});
 const settings=data.settings,sample=data.sample[repId]||[];
 const scores=Object.fromEntries(AUDIT_CRITERIA.map(key=>[key,marks[key]===undefined||marks[key]===''?Number.NaN:Number(marks[key])]));
 const checked=auditTotal(scores,settings),total=AUDIT_CRITERIA.reduce((sum,key)=>sum+(Number.isFinite(scores[key])?scores[key]:0),0);
 const [refType,refId]=reference?[reference.slice(0,reference.indexOf(':')),reference.slice(reference.indexOf(':')+1)]:['',''];
 return <Dialog open onOpenChange={open=>{if(!open&&!action.busy)onClose();}}><DialogContent className="crm-dialog sk-dialog" dir={direction()}>
  <DialogTitle>{say('تدقيق جودة','Quality audit')}</DialogTitle>
  <DialogDescription>{say('تقييم عمل ممثل واحد في شهر '+data.month+' بسبعة معايير. المجموع من 100.','Evaluate one representative\'s work in '+data.month+' on seven criteria. The total is out of 100.')}</DialogDescription>
  <fieldset disabled={action.busy} className="sk-form">
   <div className="form-grid">
    <label className="field"><span>{say('الممثل','Representative')}</span><select value={repId} onChange={event=>{setRepId(event.target.value);setReference('');}}><option value="">{say('اختر','Choose')}</option>{reps.map(rep=><option key={rep.id} value={rep.id}>{rep.name}</option>)}</select></label>
    <label className="field"><span>{say('المرجع (اختياري)','Reference (optional)')}</span><select value={reference} onChange={event=>setReference(event.target.value)}><option value="">{say('بلا مرجع','No reference')}</option>{sample.map(item=><option key={item.type+':'+item.ref} value={item.type+':'+item.ref}>{(item.type==='complaint'?say('شكوى','Complaint'):say('مساندة','Assistance'))+' · '+(item.customerName||'—')+' · '+dayOf(item.at)}</option>)}</select></label>
    <label className="field"><span>{say('يوم التواصل المدقَّق (اختياري)','Day of the audited contact (optional)')}</span><input type="date" value={date} onChange={event=>setDate(event.target.value)}/></label>
   </div>
   <div className="sk-criteria">{AUDIT_CRITERIA.map(key=><label key={key} className="field"><span>{criterionName(key,say)} <small>({say('من ','out of ')}{settings.audit.criteria[key]})</small></span><input type="number" inputMode="numeric" min={0} max={settings.audit.criteria[key]} step={1} value={marks[key]??''} onChange={event=>setMarks(current=>({...current,[key]:event.target.value}))}/></label>)}</div>
   <p className="sk-total" role="status">{say('المجموع: ','Total: ')}<b>{total}</b> / 100{checked.ok&&<span className="sk-chip" data-kind={auditResult(checked.total,settings)}>{resultName(auditResult(checked.total,settings),say)}</span>}</p>
   <label className="sk-check"><input type="checkbox" checked={called} onChange={event=>{setCalled(event.target.checked);if(!event.target.checked)setRating('');}}/><span>{say('اتصلت بالعميل للتحقق مما سُجّل','I called the customer to verify what was recorded')}</span></label>
   {called&&<label className="field"><span>{say('تقييم العميل كما قاله لك','The rating the customer gave you')}</span><select value={rating} onChange={event=>setRating(event.target.value)}><option value="">{say('بلا تقييم','No rating')}</option>{[1,2,3,4,5].map(value=><option key={value} value={value}>{value}</option>)}</select></label>}
   <label className="field"><span>{say('ملاحظات المدقّق','Auditor\'s notes')}</span><textarea value={note} rows={3} maxLength={AUDIT_NOTE_MAX} onChange={event=>setNote(event.target.value)}/></label>
  </fieldset>
  {!checked.ok&&Object.keys(marks).length>0&&<p className="form-note">{say('أدخل درجة كل معيار ضمن حدّه الأعلى.','Enter a mark for every criterion, within its maximum.')}</p>}
  {action.error&&<div className="form-error" role="alert">{t(action.error)}</div>}
  <div className="sk-actions"><button type="button" className="btn subtle" disabled={action.busy} onClick={onClose}>{say('إلغاء','Cancel')}</button>
   <button type="button" className="btn primary" disabled={action.busy||!repId||!checked.ok} onClick={()=>{void action.run({action:'audit',repId,month:data.month,date,refType,refId,scores,verification:{called,rating:called&&rating?Number(rating):null},note:note.trim()});}}>{action.busy?say('جارٍ الحفظ','Saving'):say('حفظ التدقيق','Save the audit')}</button></div>
 </DialogContent></Dialog>;
}

const num=(value:string)=>value===''?0:Number(value);
/** The module and the route speak Arabic; this puts what they say about the settings into the reader's language. */
export function problemText(problem:string,say:Say){
 const total=problem.match(/^مجموع أوزان مؤشرات (الممثل|المدير) يجب أن يساوي 100 وهو الآن (\d+)$/);
 if(total)return say(problem,`The weights of the ${total[1]==='الممثل'?'representative':'manager'} figures must add up to 100; they add up to ${total[2]}`);
 const marks=problem.match(/^مجموع درجات معايير التدقيق يجب أن يساوي 100 وهو الآن (\d+)$/);
 if(marks)return say(problem,`The audit criteria marks must add up to 100; they add up to ${marks[1]}`);
 const known:[RegExp,string][]=[
  [/^ساعات المهل/,'Time limits must be between half an hour and 500 working hours'],[/^مهلة الشكوى كاملة/,'The whole-complaint limit must be between 1 and 5000 working hours'],
  [/^هدف كل مؤشر/,'Each target must be between 1 and 100'],[/^وزن كل مؤشر/,'Each weight must be a whole number from 0 to 100'],[/^الحد الأدنى للحالات/,'The least number of cases must be a whole number from 0 to 1000'],
  [/^درجة كل معيار تدقيق/,'Each audit criterion is worth a whole number from 1 to 100'],[/^حد «ناجح»/,'The pass threshold must be above the coaching threshold'],
  [/^حجم العينة/,'The suggested sample is between 0 and 20'],[/^أيام الانتظار/,'The days to wait before closing are between 0 and 30']];
 const found=known.find(([pattern])=>pattern.test(problem));
 return found?say(problem,found[1]):t(problem);
}
/** Why a month cannot be closed yet, said from the settings rather than echoed from the route. */
export const closeNote=(days:number,say:Say)=>days>0?say(`لا يُقفل الشهر قبل مرور ${days} أيام على انتهائه`,`A month cannot be closed until ${days} days after it ends`):say('لا يُقفل الشهر قبل أن ينتهي','A month cannot be closed before it ends');
function SettingsDialog({data,say,onClose,onSaved}:{data:ServiceKpiResponse;say:Say;onClose:()=>void;onSaved:()=>Promise<void>|void}){
 const [draft,setDraft]=useState<ServiceKpiSettings>(()=>JSON.parse(JSON.stringify(data.settings)));
 const action=useKpiAction(async()=>{await onSaved();onClose();});
 const problem=settingsProblem(draft);
 const change=(update:(copy:ServiceKpiSettings)=>void)=>setDraft(current=>{const copy=JSON.parse(JSON.stringify(current)) as ServiceKpiSettings;update(copy);return copy;});
 const sums={rep:Object.values(draft.rep).reduce((sum,metric)=>sum+metric.weight,0),manager:Object.values(draft.manager).reduce((sum,metric)=>sum+metric.weight,0),audit:Object.values(draft.audit.criteria).reduce((sum,value)=>sum+value,0)};
 const table=(role:'rep'|'manager',keys:readonly string[])=><table className="service-report-table sk-settings-table"><thead><tr><th>{role==='rep'?say('مؤشرات الممثل','Representative figures'):say('مؤشرات المدير','Manager figures')}</th><th>{say('الهدف','Target')}</th><th>{say('الوزن','Weight')}</th><th>{say('أقل عدد حالات','Least cases')}</th></tr></thead>
  <tbody>{keys.map(key=>{const metric=(role==='rep'?draft.rep:draft.manager)[key as never] as MetricSetting;
   const set=(field:keyof MetricSetting,value:string)=>change(copy=>{((role==='rep'?copy.rep:copy.manager)[key as never] as MetricSetting)[field]=num(value);});
   return <tr key={key}><td>{metricName(role,key,say)}</td>{([['target',say('الهدف','Target')],['weight',say('الوزن','Weight')],['min',say('أقل عدد حالات','Least cases')]] as const).map(([field,fieldName])=><td key={field}><input type="number" inputMode="numeric" aria-label={metricName(role,key,say)+' · '+fieldName} value={metric[field]} onChange={event=>set(field,event.target.value)}/></td>)}</tr>;})}
  <tr className="sk-sum" data-ok={(role==='rep'?sums.rep:sums.manager)===100}><td>{say('مجموع الأوزان','Total weight')}</td><td/><td>{role==='rep'?sums.rep:sums.manager} / 100</td><td/></tr></tbody></table>;
 return <Dialog open onOpenChange={open=>{if(!open&&!action.busy)onClose();}}><DialogContent className="crm-dialog sk-dialog sk-settings" dir={direction()}>
  <DialogTitle>{say('إعدادات تقييم خدمة العملاء','Customer-service evaluation settings')}</DialogTitle>
  <DialogDescription>{say('تسري على الأشهر غير المقفلة. الأشهر المقفلة تحتفظ بالإعدادات التي أُقفلت بها.','They apply to months that are not closed. A closed month keeps the settings it was closed with.')}</DialogDescription>
  <fieldset disabled={action.busy} className="sk-form">
   <h3>{say('المهل بساعات العمل','Time limits in working hours')}</h3>
   <div className="sk-grid">
    {([['support',say('الاستجابة للمساندة','Support response')],['missed',say('الزيارة المفقودة','Missed visit')],['closure',say('تأكيد الإغلاق','Closure confirmation')],['review',say('مراجعة المدير','Manager\'s review')]] as const).map(([key,text])=><label key={key} className="field"><span>{text}</span><input type="number" min={0.5} step={0.5} value={draft.hours[key]} onChange={event=>change(copy=>{copy.hours[key]=num(event.target.value);})}/></label>)}
    {([['normal',say('الشكوى كاملة: عادية','Whole complaint: normal')],['high',say('الشكوى كاملة: عالية الأهمية','Whole complaint: high')]] as const).map(([key,text])=><label key={key} className="field"><span>{text}</span><input type="number" min={1} step={1} value={draft.life[key]} onChange={event=>change(copy=>{copy.life[key]=num(event.target.value);})}/></label>)}
   </div>
   {table('rep',REP_METRICS)}
   {table('manager',MANAGER_METRICS)}
   <h3>{say('التدقيق والإقفال','Audits and closing')}</h3>
   <div className="sk-grid">{AUDIT_CRITERIA.map(key=><label key={key} className="field"><span>{criterionName(key,say)}</span><input type="number" min={1} max={100} step={1} value={draft.audit.criteria[key]} onChange={event=>change(copy=>{copy.audit.criteria[key]=num(event.target.value);})}/></label>)}</div>
   <p className="sk-total" data-ok={sums.audit===100}>{say('مجموع درجات المعايير: ','Criteria total: ')}<b>{sums.audit}</b> / 100</p>
   <div className="sk-grid">
    <label className="field"><span>{say('حد «ناجح» من','Pass from')}</span><input type="number" min={2} max={100} value={draft.audit.pass} onChange={event=>change(copy=>{copy.audit.pass=num(event.target.value);})}/></label>
    <label className="field"><span>{say('حد «يحتاج تدريبًا» من','Needs coaching from')}</span><input type="number" min={1} max={99} value={draft.audit.coach} onChange={event=>change(copy=>{copy.audit.coach=num(event.target.value);})}/></label>
    <label className="field"><span>{say('حجم العينة المقترحة لكل ممثل','Suggested sample per representative')}</span><input type="number" min={0} max={20} value={draft.audit.sample} onChange={event=>change(copy=>{copy.audit.sample=num(event.target.value);})}/></label>
    <label className="field"><span>{say('أيام الانتظار قبل إقفال الشهر','Days to wait before closing a month')}</span><input type="number" min={0} max={30} value={draft.closeGraceDays} onChange={event=>change(copy=>{copy.closeGraceDays=num(event.target.value);})}/></label>
   </div>
  </fieldset>
  {problem&&<div className="form-error" role="alert">{problemText(problem,say)}</div>}
  {action.error&&<div className="form-error" role="alert">{t(action.error)}</div>}
  <div className="sk-actions"><button type="button" className="btn subtle" disabled={action.busy} onClick={()=>setDraft(JSON.parse(JSON.stringify(DEFAULT_SERVICE_KPI_SETTINGS)))}>{say('استعادة قيم الملف','Restore the sheet\'s values')}</button>
   <button type="button" className="btn subtle" disabled={action.busy} onClick={onClose}>{say('إلغاء','Cancel')}</button>
   <button type="button" className="btn primary" disabled={action.busy||!!problem} onClick={()=>{void action.run({action:'settings',version:data.settingsVersion,settings:draft});}}>{action.busy?say('جارٍ الحفظ','Saving'):say('حفظ الإعدادات','Save the settings')}</button></div>
 </DialogContent></Dialog>;
}

function GroupView({group,graceDays,say,month,detail,onDetail,loading,run,busy}:{group:KpiGroupOut;graceDays:number;say:Say;month:string;detail:string;onDetail:(id:string)=>void;loading:boolean;run:(body:Record<string,unknown>)=>Promise<boolean>;busy:boolean}){
 const [confirming,setConfirming]=useState('');
 const names=new Map<string,string>(group.reps.map(card=>[card.memberId,card.name]));
 const nameOf=(id:string)=>names.get(id)||id;
 const toggle=(id:string)=>onDetail(detail===id?'':id);
 return <section className="sk-group" data-group={group.managerId||'none'} data-closed={group.closed} aria-label={group.managerName||say('بلا مدير','No manager')}>
  <header className="sk-group-head">
   <h3>{group.managerId?say('فريق ','Team of ')+group.managerName:say('ممثلون بلا مدير','Representatives without a manager')}</h3>
   {group.closed&&<span className="sk-chip" data-kind="closed"><Lock size={13} aria-hidden="true"/>{say('مقفل','Closed')}{group.closedByName?' · '+group.closedByName:''}{group.closedAt?' · '+stamp(group.closedAt):''}</span>}
   {group.closed&&group.drift&&<span className="sk-chip" data-kind="drift">{say('تغيّرت الأرقام بعد الإقفال','The figures changed after closing')}</span>}
   {group.canClose&&confirming!=='close'&&<button type="button" className="btn subtle small" disabled={busy} onClick={()=>setConfirming('close')}><Lock size={14} aria-hidden="true"/>{say('إقفال الشهر','Close the month')}</button>}
   {group.canReopen&&confirming!=='reopen'&&<button type="button" className="btn subtle small" disabled={busy} onClick={()=>setConfirming('reopen')}><LockOpen size={14} aria-hidden="true"/>{say('إعادة فتح الشهر','Reopen the month')}</button>}
   {!group.canClose&&group.closeProblem&&<small className="sk-muted">{closeNote(graceDays,say)}</small>}
  </header>
  {confirming&&<div className="sk-confirm" role="alert"><span>{confirming==='close'?say('تُحفظ الدرجات والإعدادات ولا تُسجَّل تدقيقات جديدة لهذا الفريق في هذا الشهر. تأكيد الإقفال؟','The scores and settings are kept and no new audits are recorded for this team in this month. Close it?'):say('يعود الشهر إلى الحساب المباشر وتُفتح التدقيقات. تأكيد إعادة الفتح؟','The month goes back to live figures and audits open again. Reopen it?')}</span>
   <button type="button" className="btn primary small" disabled={busy} onClick={()=>{void run({action:confirming==='close'?'close_month':'reopen_month',month,managerId:group.managerId}).then(done=>{if(done)setConfirming('');});}}>{say('تأكيد','Confirm')}</button>
   <button type="button" className="btn subtle small" disabled={busy} onClick={()=>setConfirming('')}>{say('تراجع','Back')}</button></div>}
  {group.manager&&<CardView card={group.manager} role="manager" say={say} open={detail===group.manager.memberId} onToggle={()=>toggle(group.manager!.memberId)} nameOf={nameOf} loading={loading}/>}
  <Comparison group={group} say={say} onOpen={id=>onDetail(id)}/>
  {group.reps.length===0&&<p className="sk-muted">{say('لا ممثلين في هذا الفريق.','No representatives in this team.')}</p>}
  {group.reps.map(card=><CardView key={card.memberId} card={card} role="rep" say={say} open={detail===card.memberId} onToggle={()=>toggle(card.memberId)} nameOf={nameOf} loading={loading}/>)}
 </section>;
}

const note=(say:Say)=>say('الدرجة: لكل مؤشر نسبة الفعلي إلى الهدف بحد أقصى واحد مضروبة في وزنه، ثم تُجمع. المؤشر الذي لم يبلغ أقل عدد حالات لا يُحتسب ويُوزَّع وزنه على الباقي. ساعات العمل من السبت إلى الخميس، 8 صباحًا إلى 6 مساءً بتوقيت الرياض. الأرقام للمتابعة وتقييم خدمة العملاء وحدها ولا تدخل في مستهدفات المناديب.','The score: each figure is the share of its target reached (at most one) times its weight, summed. A figure with fewer cases than its least is left out and its weight shared by the rest. Working hours run Saturday to Thursday, 8:00 to 18:00 Riyadh time. The figures are for follow-up and for evaluating customer service only; they do not enter sales targets.');

type ViewProps={
 data:ServiceKpiResponse|null;error:string;loading:boolean;month:string;detail:string;say:Say;busy:boolean;actionError:string;role:string;
 onMonth:(month:string)=>void;onDetail:(id:string)=>void;onRetry:()=>void;run:(body:Record<string,unknown>)=>Promise<boolean>;refresh:()=>Promise<void>;
 /** A dialog that starts open: the tests render it, and a link from a suggestion could too. */
 initialSeed?:AuditSeed|null;initialSettings?:boolean;
};
/** Everything the page shows, from the month already in hand: no request is made here, so every wording and number can be checked on its own. */
export function ServiceKpiView({data,error,loading,month,detail,say,busy,actionError,role,onMonth,onDetail,onRetry,run,refresh,initialSeed=null,initialSettings=false}:ViewProps){
 const [seed,setSeed]=useState<AuditSeed|null>(initialSeed),[settingsOpen,setSettingsOpen]=useState(initialSettings);
 const names=new Map<string,string>();
 for(const group of data?.groups||[])for(const card of [...group.reps,...(group.manager?[group.manager]:[])])names.set(card.memberId,card.name);
 return <div className="sk-page service-kpi-page" dir={direction()} data-viewer={role}>
  <div className="sk-toolbar">
   {data&&<MonthSelect data={data} value={month} onChange={onMonth} say={say}/>}
   {data?.me.canAudit&&<button type="button" className="btn primary" onClick={()=>setSeed({repId:'',refType:'',refId:''})}><Plus size={17} aria-hidden="true"/>{say('تدقيق جديد','New audit')}</button>}
   {data?.me.canSettings&&<button type="button" className="btn subtle" onClick={()=>setSettingsOpen(true)}><Settings2 size={17} aria-hidden="true"/>{say('إعدادات التقييم','Evaluation settings')}</button>}
  </div>
  {error&&<div className="form-error" role="alert">{t(error)} <button type="button" className="text-button" onClick={onRetry}>{say('إعادة المحاولة','Retry')}</button></div>}
  {actionError&&<div className="form-error" role="alert">{t(actionError)}</div>}
  {!data&&loading&&<p role="status">{say('جارٍ تحميل التقييم','Loading the evaluation')}</p>}
  {data&&<div aria-busy={loading}>
   {data.groups.length===0?<p className="sk-muted">{say('لا بطاقات لهذا الشهر ضمن نطاقك.','No cards for this month in your scope.')}</p>:data.groups.map(group=><GroupView key={group.managerId||'none'} group={group} graceDays={data.settings.closeGraceDays} say={say} month={data.month} detail={detail} onDetail={onDetail} loading={loading} run={run} busy={busy}/>)}
   <section className="sk-audits"><h3>{say('تدقيق الجودة','Quality audits')}</h3>
    {data.me.canAudit&&Object.values(data.sample).some(list=>list.length>0)&&<div className="sk-sample"><h4>{say('عيّنة مقترحة هذا الشهر','Suggested sample this month')}</h4>
     {Object.entries(data.sample).filter(([,list])=>list.length>0).map(([repId,list])=><div key={repId} className="sk-sample-rep"><strong>{names.get(repId)||repId}</strong>
      <ul>{list.map(item=><li key={item.type+':'+item.ref+':'+item.tag} data-sample={item.ref}><span>{item.type==='complaint'?say('شكوى','Complaint'):say('مساندة','Assistance')} · {item.customerName||'—'} · {dayOf(item.at)}</span><button type="button" className="btn subtle small" onClick={()=>setSeed({repId,refType:item.type,refId:item.ref})}>{say('تدقيق','Audit')}</button></li>)}</ul></div>)}</div>}
    <AuditList data={data} say={say} busy={busy} onDelete={data.me.canAudit?audit=>{void run({action:'audit_delete',id:audit.id});}:undefined}/>
   </section>
   <p className="service-report-note">{note(say)}</p>
  </div>}
  {seed&&data&&<AuditDialog data={data} say={say} seed={seed} onClose={()=>setSeed(null)} onSaved={refresh}/>}
  {settingsOpen&&data&&<SettingsDialog data={data} say={say} onClose={()=>setSettingsOpen(false)} onSaved={refresh}/>}
 </div>;
}

/** The page of the customer-service manager and the administrator: every card they may see, the audits, the closing of a month and the settings. */
export function ServiceKpiPage({me}:{me:Pick<Member,'id'|'role'>}){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const kpi=useKpi(true),action=useKpiAction(kpi.refresh);
 return <ServiceKpiView data={kpi.data} error={kpi.error} loading={kpi.loading} month={kpi.month} detail={kpi.detail} say={say} busy={action.busy} actionError={action.error} role={me.role}
  onMonth={month=>{kpi.setMonth(month);kpi.setDetail('');}} onDetail={kpi.setDetail} onRetry={()=>void kpi.refresh()} run={action.run} refresh={kpi.refresh}/>;
}

/** A representative's own evaluation, from the month already in hand. */
export function MyScoreBody({data,error,loading,say,onMonth,onRetry,month}:{data:ServiceKpiResponse|null;error:string;loading:boolean;say:Say;onMonth:(month:string)=>void;onRetry:()=>void;month:string}){
 const card=data?.groups[0]?.reps[0];
 return <div className="service-report-body sk-mine">
  {error&&<div className="form-error" role="alert">{t(error)} <button type="button" className="text-button" onClick={onRetry}>{say('إعادة المحاولة','Retry')}</button></div>}
  {!data&&loading&&<p role="status">{say('جارٍ تحميل التقييم','Loading the evaluation')}</p>}
  {data&&<div aria-busy={loading}>
   <MonthSelect data={data} value={month} onChange={onMonth} say={say}/>
   {data.groups[0]?.closed&&<p className="sk-chip" data-kind="closed"><Lock size={13} aria-hidden="true"/>{say('الشهر مقفل: درجتك محفوظة','The month is closed: your score is kept')}</p>}
   {card?<CardView card={card} role="rep" say={say} open onToggle={()=>{}} nameOf={id=>id} loading={loading}/>:<p className="sk-muted">{say('لا بطاقة لك في هذا الشهر.','You have no card in this month.')}</p>}
   <h3>{say('تدقيقات جودة أدائي','Audits of my work')}</h3>
   <AuditList data={data} say={say} busy={false}/>
   <p className="service-report-note">{note(say)}</p>
  </div>}
 </div>;
}

function MyScorePanel(){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const [opened,setOpened]=useState(false),kpi=useKpi(opened);
 return <details className="service-report service-kpi-mine panel" dir={direction()} onToggle={event=>{if(event.currentTarget.open)setOpened(true);}}>
  <summary><Gauge size={18} aria-hidden="true"/> {say('تقييمي','My evaluation')}</summary>
  {opened&&<MyScoreBody data={kpi.data} error={kpi.error} loading={kpi.loading} say={say} month={kpi.month} onMonth={kpi.setMonth} onRetry={()=>void kpi.refresh()}/>}
 </details>;
}

/** At the top of the Complaints page for a customer-service representative: their own evaluation, folded away until they open it. */
export function MyServiceScore({me}:{me:Pick<Member,'role'>}){
 if(me.role!=='customer_service')return null;
 return <MyScorePanel/>;
}
