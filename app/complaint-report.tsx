'use client';
import {useState} from 'react';
import {BarChart3} from 'lucide-react';
import {submitJson} from '@/lib/client-submit';
import {getLanguage,t,useLanguage} from '@/lib/i18n';
import {closureOutcomes,closureOutcomesEn,complaintCategories,complaintCategoriesEn,complaintChannels,complaintChannelsEn,complaintSeverities,complaintSeveritiesEn,complaintStatusLabels,complaintStatusLabelsEn,resolutionOutcomes,resolutionOutcomesEn} from '@/lib/complaints';
import {complaintReportAllowed,type ComplaintReport,type ComplaintReportRow} from '@/lib/complaint-report';
import type {ReportTiming} from '@/lib/report-timing';
import type {Member} from '@/lib/crm';
import './service-report.css';

type Say=(ar:string,en:string)=>string;
const hours=(value:number|null,say:Say)=>value===null?'—':value.toFixed(1)+' '+say('س','h');
const percent=(value:number|null)=>value===null?'—':value+'%';
const messageOf=(error:unknown)=>typeof error==='object'&&error!==null&&'message' in error&&typeof error.message==='string'?error.message:'';
const label=(ar:Record<string,string>,en:Record<string,string>,key:string,say:Say)=>say(ar[key]||key,en[key]||key);

/** One breakdown table: how many complaints, how many open and closed, and the satisfied share where something closed. */
function Breakdown({title,heading,rows,name,say}:{title:string;heading:string;rows:ComplaintReportRow[];name:(key:string)=>string;say:Say}){
 if(!rows.length)return null;
 return <><h3>{title}</h3>
  <table className="service-report-table"><thead><tr>{[heading,say('الشكاوى','Complaints'),say('مفتوحة','Open'),say('مغلقة','Closed'),say('العميل راضٍ','Satisfied'),say('نسبة الرضا','Satisfaction')].map(head=><th key={head}>{head}</th>)}</tr></thead>
  <tbody>{rows.map(row=><tr key={row.key}><td>{name(row.key)}</td><td>{row.total}</td><td>{row.open}</td><td>{row.closed}</td><td>{row.satisfied}</td><td>{percent(row.satisfactionRate)}</td></tr>)}</tbody></table></>;
}

/** The figures, from a report already in hand; no state, so every wording and number can be checked on its own. */
export function ComplaintReportView({report,say,onMonth}:{report:ComplaintReport;say:Say;onMonth?:(month:string)=>void}){
 const stages:[string,ReportTiming][]=[[say('المراجعة','Review'),report.timing.review],[say('التكليف','Assignment'),report.timing.assignment],[say('أول تواصل بعد التكليف','First contact after assignment'),report.timing.firstContact],[say('الحل من التكليف','Resolution from assignment'),report.timing.resolution],[say('تأكيد الإغلاق','Closure confirmation'),report.timing.closure],[say('من التسجيل إلى الإغلاق','Registration to closure'),report.timing.registrationToClosure]];
 const months=[...new Set([report.month,...report.months])].sort().reverse();
 const kpis:[string,string][]=[[say('الشكاوى','Complaints'),String(report.total)],[say('مفتوحة','Open'),String(report.open)],[say('مغلقة','Closed'),String(report.closed)],[say('ملغاة','Cancelled'),String(report.cancelled)],[say('نسبة رضا العميل','Customer satisfaction'),percent(report.satisfactionRate)],[say('مفتوحة وتجاوزت هدفها','Open past target'),String(report.openOverTarget)],[say('أهمية عالية','High severity'),String(report.high)],[say('عملاء بأكثر من شكوى','Customers with more than one'),String(report.repeatCustomers)]];
 const flow:[string,number][]=[[say('أُعيدت للتعديل','Returned for correction'),report.flow.returned],[say('أُعيدت إلى المندوب','Sent back to the representative'),report.flow.sentBack],[say('أُعيد تكليفها','Reassigned'),report.flow.reassigned],[say('أُعيد فتحها','Reopened'),report.flow.reopened]];
 return <div className="service-report-body complaint-report-body">
  <label className="field service-report-month"><span>{say('الشهر','Month')}</span><select value={report.month} onChange={event=>onMonth?.(event.target.value)}>{months.map(month=><option key={month} value={month}>{month}</option>)}</select></label>
  <div className="service-report-kpis">{kpis.map(([text,value])=><div key={text} className="service-report-kpi"><b>{value}</b><span>{text}</span></div>)}</div>
  {report.total===0?<p className="muted">{say('لا شكاوى في هذا الشهر ضمن نطاقك.','No complaints this month in your scope.')}</p>:<>
   <Breakdown title={say('بحسب التصنيف','By category')} heading={say('التصنيف','Category')} rows={report.byCategory} name={key=>label(complaintCategories,complaintCategoriesEn,key,say)} say={say}/>
   <Breakdown title={say('بحسب وسيلة الوصول','By channel')} heading={say('الوسيلة','Channel')} rows={report.byChannel} name={key=>label(complaintChannels,complaintChannelsEn,key,say)} say={say}/>
   <Breakdown title={say('بحسب المنطقة','By region')} heading={say('المنطقة','Region')} rows={report.byRegion} name={key=>t(key)} say={say}/>
   <h3>{say('الأهمية والحالة الحالية','Severity and current state')}</h3>
   <div className="service-report-states">{report.bySeverity.map(row=><span key={'severity-'+row.key} className="service-queue-chip">{label(complaintSeverities,complaintSeveritiesEn,row.key,say)}: {row.total}</span>)}{Object.entries(report.byState).map(([state,count])=><span key={state} className="service-queue-chip">{label(complaintStatusLabels,complaintStatusLabelsEn,state,say)}: {count}</span>)}</div>
   <h3>{say('ما عاد خطوة إلى الوراء','What went a step back')}</h3>
   <div className="service-report-states">{flow.map(([text,count])=><span key={text} className="service-queue-chip">{text}: {count}</span>)}</div>
   {(report.resolutionOutcomes.length>0||report.closureOutcomes.length>0)&&<><h3>{say('نتائج الحل والإغلاق','Resolution and closure outcomes')}</h3>
    <ul className="service-report-reasons">{report.resolutionOutcomes.map(item=><li key={'resolution-'+item.key}><span>{say('الحل','Resolution')}: {label(resolutionOutcomes,resolutionOutcomesEn,item.key,say)}</span><b>{item.count}</b></li>)}{report.closureOutcomes.map(item=><li key={'closure-'+item.key}><span>{say('الإغلاق','Closure')}: {label(closureOutcomes,closureOutcomesEn,item.key,say)}</span><b>{item.count}</b></li>)}</ul></>}
   <h3>{say('زمن كل مرحلة بساعات العمل','Time per stage, in working hours')}</h3>
   <table className="service-report-table"><thead><tr>{[say('المرحلة','Stage'),say('شكاوى','Complaints'),say('الوسيط','Median'),say('المتوسط','Average'),say('الهدف','Target'),say('تجاوزت الهدف','Over target')].map(head=><th key={head}>{head}</th>)}</tr></thead><tbody>{stages.map(([text,timing])=><tr key={text}><td>{text}</td><td>{timing.n}</td><td>{hours(timing.median,say)}</td><td>{hours(timing.average,say)}</td><td>{timing.target===null?'—':timing.target+' '+say('س','h')}</td><td>{timing.target===null?'—':timing.overTarget}</td></tr>)}</tbody></table>
  </>}
  <p className="service-report-note">{say('ساعات العمل من السبت إلى الخميس، 8 صباحًا إلى 6 مساءً بتوقيت الرياض. نسبة الرضا هي الشكاوى المغلقة بنتيجة «العميل راضٍ» من كل المغلقة. الأرقام للمتابعة فقط ولا تدخل في تقييم أحد ولا في المستهدفات.','Working hours are Saturday to Thursday, 08:00 to 18:00 Riyadh time. Satisfaction is the share of closed complaints closed as "customer satisfied". The figures are for follow-up only and feed nobody\'s evaluation and no target.')}</p>
 </div>;
}

function ComplaintReportPanel(){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const [data,setData]=useState<ComplaintReport|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 // Fetched on opening and on choosing a month, never in the background.
 async function fetchReport(month?:string){
  setLoading(true);setError('');
  try{setData(await submitJson<ComplaintReport>('/api/complaint-report'+(month?'?month='+encodeURIComponent(month):''),{cache:'no-store'},{language:getLanguage()}));}
  catch(failure){setError(messageOf(failure)||say('تعذر تحميل التقرير.','The report could not be loaded.'));}
  finally{setLoading(false);}
 }
 return <details className="service-report complaint-report panel" dir={language==='en'?'ltr':'rtl'} onToggle={event=>{if(event.currentTarget.open&&!data&&!loading)void fetchReport();}}>
  <summary><BarChart3 size={18} aria-hidden="true"/> {say('التقرير الشهري للشكاوى','Monthly complaints report')}</summary>
  {loading&&!data&&<p role="status">{say('جارٍ تحميل التقرير','Loading the report')}</p>}
  {error&&<div className="form-error" role="alert">{error} <button type="button" className="text-button" onClick={()=>void fetchReport(data?.month)}>{say('إعادة المحاولة','Retry')}</button></div>}
  {data&&<div aria-busy={loading}><ComplaintReportView report={data} say={say} onMonth={month=>void fetchReport(month)}/></div>}
 </details>;
}

/** At the top of the Complaints page for customer-service managers and administrators, and of the Visits page for sales managers; nobody else gets it. */
export function ComplaintReportSection({me}:{me:Pick<Member,'role'>}){
 if(!complaintReportAllowed(me.role))return null;
 return <ComplaintReportPanel/>;
}
