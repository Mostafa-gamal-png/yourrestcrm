'use client';
import {useState} from 'react';
import {BarChart3} from 'lucide-react';
import {submitJson} from '@/lib/client-submit';
import {getLanguage,t,useLanguage} from '@/lib/i18n';
import {serviceSources,serviceStatusLabels} from '@/lib/customer-service';
import {serviceReportAllowed,type ReportTiming,type ServiceReport} from '@/lib/service-report';
import type {Member} from '@/lib/crm';
import './service-report.css';

type Say=(ar:string,en:string)=>string;
const hours=(value:number|null,say:Say)=>value===null?'—':value.toFixed(1)+' '+say('س','h');
const percent=(value:number|null)=>value===null?'—':value+'%';
const messageOf=(error:unknown)=>typeof error==='object'&&error!==null&&'message' in error&&typeof error.message==='string'?error.message:'';

/** The figures, from a report already in hand; no state, so every wording and number can be checked on its own. */
export function ServiceReportView({report,say,onMonth}:{report:ServiceReport;say:Say;onMonth?:(month:string)=>void}){
 const stages:[string,ReportTiming][]=[[say('الاعتماد','Approval'),report.timing.approval],[say('التكليف','Assignment'),report.timing.assignment],[say('أول تواصل بعد التكليف','First contact after assignment'),report.timing.firstContact],[say('من التسجيل إلى أول تواصل','Registration to first contact'),report.timing.totalToFirstContact]];
 const months=[...new Set([report.month,...report.months])].sort().reverse();
 return <div className="service-report-body">
  <label className="field service-report-month"><span>{say('الشهر','Month')}</span><select value={report.month} onChange={event=>onMonth?.(event.target.value)}>{months.map(month=><option key={month} value={month}>{month}</option>)}</select></label>
  <div className="service-report-kpis">{[[say('الطلبات','Requests'),String(report.total)],[say('مفتوحة','Open'),String(report.open)],[say('فاز','Won'),String(report.won)],[say('فُقد','Lost'),String(report.lost)],[say('نسبة الفوز','Win rate'),percent(report.winRate)],[say('مفتوحة وتجاوزت هدفها','Open past target'),String(report.openOverTarget)]].map(([label,value])=><div key={label} className="service-report-kpi"><b>{value}</b><span>{label}</span></div>)}</div>
  {report.total===0?<p className="muted">{say('لا طلبات في هذا الشهر ضمن نطاقك.','No requests this month in your scope.')}</p>:<>
   <h3>{say('بحسب قناة التواصل','By channel')}</h3>
   <table className="service-report-table"><thead><tr>{[say('القناة','Channel'),say('الطلبات','Requests'),say('فاز','Won'),say('فُقد','Lost'),say('مفتوح','Open'),say('نسبة الفوز','Win rate')].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{report.bySource.map(row=><tr key={row.source}><td>{t(serviceSources[row.source]||row.source)}</td><td>{row.total}</td><td>{row.won}</td><td>{row.lost}</td><td>{row.open}</td><td>{percent(row.winRate)}</td></tr>)}</tbody></table>
   <h3>{say('الحالة الحالية','Current state')}</h3>
   <div className="service-report-states">{Object.entries(report.byState).map(([state,count])=><span key={state} className="service-queue-chip">{t(serviceStatusLabels[state]||state)}: {count}</span>)}</div>
   <h3>{say('زمن كل مرحلة بساعات العمل','Time per stage, in working hours')}</h3>
   <table className="service-report-table"><thead><tr>{[say('المرحلة','Stage'),say('طلبات','Cases'),say('الوسيط','Median'),say('المتوسط','Average'),say('الهدف','Target'),say('تجاوزت الهدف','Over target')].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{stages.map(([label,timing])=><tr key={label}><td>{label}</td><td>{timing.n}</td><td>{hours(timing.median,say)}</td><td>{hours(timing.average,say)}</td><td>{timing.target===null?'—':timing.target+' '+say('س','h')}</td><td>{timing.target===null?'—':timing.overTarget}</td></tr>)}</tbody></table>
   {report.lossReasons.length>0&&<><h3>{say('أسباب الفقد','Loss reasons')}</h3><ul className="service-report-reasons">{report.lossReasons.map(item=><li key={item.reason}><span>{item.reason}</span><b>{item.count}</b></li>)}</ul></>}
  </>}
  <p className="service-report-note">{say('ساعات العمل من السبت إلى الخميس، 8 صباحًا إلى 6 مساءً بتوقيت الرياض. الأرقام للمتابعة فقط ولا تدخل في تقييم أداء المناديب ولا في المستهدفات.','Working hours are Saturday to Thursday, 08:00 to 18:00 Riyadh time. The figures are for follow-up only and feed neither representatives\' evaluation nor targets.')}</p>
 </div>;
}

function ServiceReportPanel(){
 const {language}=useLanguage(),say:Say=(ar,en)=>language==='en'?en:ar;
 const [data,setData]=useState<ServiceReport|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 // Fetched on opening and on choosing a month, never in the background.
 async function fetchReport(month?:string){
  setLoading(true);setError('');
  try{setData(await submitJson<ServiceReport>('/api/service-report'+(month?'?month='+encodeURIComponent(month):''),{cache:'no-store'},{language:getLanguage()}));}
  catch(failure){setError(messageOf(failure)||say('تعذر تحميل التقرير.','The report could not be loaded.'));}
  finally{setLoading(false);}
 }
 return <details className="service-report panel" dir={language==='en'?'ltr':'rtl'} onToggle={event=>{if(event.currentTarget.open&&!data&&!loading)void fetchReport();}}>
  <summary><BarChart3 size={18} aria-hidden="true"/> {say('التقرير الشهري لطلبات خدمة العملاء','Monthly customer-service report')}</summary>
  {loading&&!data&&<p role="status">{say('جارٍ تحميل التقرير','Loading the report')}</p>}
  {error&&<div className="form-error" role="alert">{error} <button type="button" className="text-button" onClick={()=>void fetchReport(data?.month)}>{say('إعادة المحاولة','Retry')}</button></div>}
  {data&&<div aria-busy={loading}><ServiceReportView report={data} say={say} onMonth={month=>void fetchReport(month)}/></div>}
 </details>;
}

/** Shown at the top of the Visits page to the people who run customer service and sales; nobody else gets it. */
export function ServiceReportSection({me}:{me:Pick<Member,'role'>}){
 if(!serviceReportAllowed(me.role))return null;
 return <ServiceReportPanel/>;
}
