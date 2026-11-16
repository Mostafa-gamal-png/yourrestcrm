'use client';
import {useRef,useState,type ReactNode} from 'react';
import {BarChart3,FileSpreadsheet,Loader2} from 'lucide-react';
import {submitJson} from '@/lib/client-submit';
import {getLanguage,t,useLanguage} from '@/lib/i18n';
import {serviceStatusLabels} from '@/lib/customer-service';
import {serviceReportAllowed,type ServiceReport} from '@/lib/service-report';
import {contactTypeText,serviceReportFileName,serviceReportStages,serviceReportTiles,type ServiceReportKind} from '@/lib/service-report-view';
import {can} from '@/lib/permissions';
import type {Member} from '@/lib/crm';
import './service-report.css';

type Say=(ar:string,en:string)=>string;
const hours=(value:number|null,say:Say)=>value===null?'—':value.toFixed(1)+' '+say('س','h');
const percent=(value:number|null)=>value===null?'—':value+'%';
const messageOf=(error:unknown)=>typeof error==='object'&&error!==null&&'message' in error&&typeof error.message==='string'?error.message:'';

/** The figures, from a report already in hand; no state, so every wording and number can be checked on its own. The tiles and the stage
 *  rows are lib/service-report-export.ts's, which the Excel file writes too. `actions`: the export button, beside the month. */
export function ServiceReportView({report,say,onMonth,actions}:{report:ServiceReport;say:Say;onMonth?:(month:string)=>void;actions?:ReactNode}){
 const stages=serviceReportStages(report,say);
 const months=[...new Set([report.month,...report.months])].sort().reverse();
 return <div className="service-report-body">
  <div className="service-report-head"><label className="field service-report-month"><span>{say('الشهر','Month')}</span><select value={report.month} onChange={event=>onMonth?.(event.target.value)}>{months.map(month=><option key={month} value={month}>{month}</option>)}</select></label>{actions}</div>
  <div className="service-report-kpis">{serviceReportTiles(report,say).map(([label,value])=><div key={label} className="service-report-kpi"><b>{String(value)}</b><span>{label}</span></div>)}</div>
  {report.total===0?<p className="muted">{say('لا طلبات في هذا الشهر ضمن نطاقك.','No requests this month in your scope.')}</p>:<>
   <h3>{say('بحسب نوع التواصل','By contact type')}</h3>
   <table className="service-report-table" data-report-contact-types><thead><tr>{[say('نوع التواصل','Contact type'),say('الطلبات','Requests'),say('فاز','Won'),say('فُقد','Lost'),say('مفتوح','Open'),say('نسبة الفوز','Win rate')].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{report.byContactType.map(row=><tr key={row.type}><td>{contactTypeText(row.type,say)}</td><td>{row.total}</td><td>{row.won}</td><td>{row.lost}</td><td>{row.open}</td><td>{percent(row.winRate)}</td></tr>)}</tbody></table>
   <h3>{say('الحالة الحالية','Current state')}</h3>
   <div className="service-report-states">{Object.entries(report.byState).map(([state,count])=><span key={state} className="service-queue-chip">{t(serviceStatusLabels[state]||state)}: {count}</span>)}</div>
   <h3>{say('زمن كل مرحلة بساعات العمل','Time per stage, in working hours')}</h3>
   <table className="service-report-table"><thead><tr>{[say('المرحلة','Stage'),say('طلبات','Cases'),say('الوسيط','Median'),say('المتوسط','Average'),say('الهدف','Target'),say('تجاوزت الهدف','Over target')].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{stages.map(([label,timing])=><tr key={label}><td>{label}</td><td>{timing.n}</td><td>{hours(timing.median,say)}</td><td>{hours(timing.average,say)}</td><td>{timing.target===null?'—':timing.target+' '+say('س','h')}</td><td>{timing.target===null?'—':timing.overTarget}</td></tr>)}</tbody></table>
   {report.lossReasons.length>0&&<><h3>{say('أسباب الفقد','Loss reasons')}</h3><ul className="service-report-reasons">{report.lossReasons.map(item=><li key={item.reason}><span>{item.reason}</span><b>{item.count}</b></li>)}</ul></>}
  </>}
  <p className="service-report-note">{say('ساعات العمل من السبت إلى الخميس، 8 صباحًا إلى 6 مساءً بتوقيت الرياض. الأرقام للمتابعة فقط ولا تدخل في تقييم أداء المناديب ولا في المستهدفات.','Working hours are Saturday to Thursday, 08:00 to 18:00 Riyadh time. The figures are for follow-up only and feed neither representatives\' evaluation nor targets.')}</p>
 </div>;
}

/** «تصدير Excel» of the report on screen, for its month (the owner, 2026-11-16, item 3 of the GSCO list): the server builds the workbook
 *  (GET /api/service-report/export) from what the reader may read; shown only while «تقارير خدمة العملاء · تصدير» is on for the member. */
export function ServiceReportExportButton({kind,month,say,language}:{kind:ServiceReportKind;month:string;say:Say;language:string}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),lock=useRef(false);
 async function run(){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{
   const response=await fetch('/api/service-report/export?kind='+kind+'&month='+encodeURIComponent(month)+'&lang='+(language==='en'?'en':'ar'),{cache:'no-store'});
   if(!response.ok){let text='';try{text=((await response.json()) as {error?:string}).error||'';}catch{text='';}throw new Error(text);}
   const name=/filename="([^"]+)"/.exec(response.headers.get('content-disposition')||'')?.[1]||serviceReportFileName(kind,month);
   const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(failure){setError(messageOf(failure)||say('تعذر تصدير التقرير. أعد المحاولة.','Could not export the report. Retry.'));}
  finally{lock.current=false;setBusy(false);}
 }
 return <span className="service-report-export" data-report-export={kind}><button type="button" className="btn subtle small" disabled={busy} onClick={()=>void run()}>{busy?<Loader2 size={16} className="spin" aria-hidden="true"/>:<FileSpreadsheet size={16} aria-hidden="true"/>}{busy?say('جارٍ التصدير…','Exporting…'):say('تصدير Excel','Export to Excel')}</button>{error&&<span className="form-error" role="alert">{t(error)}</span>}</span>;
}

function ServiceReportPanel({canExport}:{canExport:boolean}){
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
  {data&&<div aria-busy={loading}><ServiceReportView report={data} say={say} onMonth={month=>void fetchReport(month)} actions={canExport?<ServiceReportExportButton key={data.month} kind="requests" month={data.month} say={say} language={language}/>:null}/></div>}
 </details>;
}

/** Shown at the top of the Visits page to the people who run customer service and sales; nobody else gets it. */
export function ServiceReportSection({me}:{me:Pick<Member,'role'|'access'>}){
 if(!serviceReportAllowed(me.role))return null;
 return <ServiceReportPanel canExport={can(me,'service-reports','export')}/>;
}
