'use client';
// Customer service in the sales process, on the page (the owner, 2026-11-16, item 5 of the GSCO list; the rules: lib/service-sales.ts, the
// server: lib/service-sales-server.ts). «مصدر الفرصة» in the new-opportunity form, the start of an opportunity from a record, «مصادر الفرص»,
// the decision «اعتماد وإحالة», the stage of an opportunity customer service keeps, «تسجيل دور خدمة العملاء» and «أداء خدمة العملاء». Every
// word is given in both languages (say), so no Arabic is left on an English page.
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {CheckCircle2,ClipboardCheck,FileSpreadsheet,Loader2,RefreshCw,Search,TriangleAlert,UserRoundSearch} from 'lucide-react';
import {submitJson} from '@/lib/client-submit';
import {t,useLanguage} from '@/lib/i18n';
import {stageLabels,type Member} from '@/lib/crm';
import {followupLossReasons} from '@/lib/customer-followups';
import {can} from '@/lib/permissions';
import {
 LEAD_OTHER,LEAD_NOTE_MAX,ROLE_NOTE_MIN,ROUTING_NOT_ELIGIBLE,OPEN_SALES_WARNING,leadGroups,leadGroupsEn,leadListLabels,leadListLabelsEn,leadReader,leadStartLabels,leadStartLabelsEn,leadStarter,performanceAllowed,performanceColumns,performanceNote,performanceNoteEn,
 roleBasisLabels,roleBasisLabelsEn,routingReasonLabels,routingReasonLabelsEn,serviceLeadSources,serviceLeadSourcesEn,serviceRoleOptions,serviceRoleOptionsEn,systemLeadSources,systemLeadSourcesEn,leadLabel,leadLabelEn,
 PERFORMANCE_NO_TEAM,PERFORMANCE_NO_TEAM_EN,PERFORMANCE_NO_TEAM_HELP,PERFORMANCE_NO_TEAM_HELP_EN,PERFORMANCE_REPORTING_NOTE,PERFORMANCE_REPORTING_NOTE_EN,
 START_OPPORTUNITY_EVENT,type LeadDraft,type LeadList,type LeadRefKind,type LeadStart,type PerformanceReach,type PerformanceRow,type RoutingFacts
} from '@/lib/service-sales';
import VoiceField from './voice-field';
import './service-report.css';
import './service-sales.css';
import {ExportExcelButton} from './export-excel-button';

type Say=(ar:string,en:string)=>string;
const useSay=():[Say,string]=>{const {language}=useLanguage();return [(ar,en)=>language==='en'?en:ar,language];};
const messageOf=(error:unknown)=>typeof error==='object'&&error!==null&&'message' in error&&typeof error.message==='string'?error.message:'';
const getJson=<T,>(url:string,language:string)=>submitJson<T>(url,{cache:'no-store'},{language});
const postJson=<T,>(url:string,body:unknown,language:string)=>submitJson<T>(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},{language});
const dayOf=(iso:string)=>iso?new Date(Date.parse(iso)+3*3600000).toISOString().slice(0,10):'—';

// ------------------------------------------------------------------------------------------------ «مصدر الفرصة»
/** Asks the page to open «فرصة جديدة» on the record's customer with its source filled in (app/crm-app.tsx listens). */
export const startOpportunity=(start:LeadStart)=>{window.dispatchEvent(new CustomEvent<LeadStart>(START_OPPORTUNITY_EVENT,{detail:start}));};
const sourceText=(source:string,say:Say)=>say(source,serviceLeadSourcesEn[source]||source);
/** The field of the new-opportunity form: a source customer service brought in, or the system's source locked when started from a record. */
export function LeadSourceField({value,onChange,locked,problem,disabled}:{value:LeadDraft;onChange:(next:LeadDraft)=>void;locked?:LeadStart|null;problem?:string;disabled?:boolean}){
 const [say]=useSay();
 if(locked)return <div className="field full lead-source-field" data-lead-locked><span className="sr-only">{say('مصدر الفرصة','Opportunity source')}</span>
  <div className="lead-source-locked"><b>{say(leadGroups.system,leadGroupsEn.system)} · {say(systemLeadSources[locked.kind],systemLeadSourcesEn[locked.kind])}</b><small>{say('السجل','Record')}: {locked.label} · {say('يحدده النظام ولا يُعدَّل','Set by the system and cannot be changed')}</small></div></div>;
 return <div className="field full lead-source-field" data-lead-source>
  <label className="lead-source-select"><span>{say('المصدر','Source')} <b>*</b></span>
   <select value={value.source} disabled={disabled} aria-required="true" aria-invalid={!!problem} aria-describedby={problem?'visit-lead-source-problem':undefined} onChange={event=>onChange({group:'service',source:event.target.value,note:event.target.value===LEAD_OTHER?value.note:''})}>
    <option value="">{say('اختر مصدر الفرصة','Choose the opportunity source')}</option>
    <optgroup label={say(leadGroups.service,leadGroupsEn.service)}>{serviceLeadSources.map(source=><option key={source} value={source}>{sourceText(source,say)}</option>)}</optgroup>
   </select></label>
  {value.source===LEAD_OTHER&&<VoiceField className="lead-source-note" label={say('اكتب مصدر الفرصة','Type the opportunity source')} marked value={value.note} disabled={disabled} contextKey="lead-source-note" onChange={note=>onChange({...value,note})} inputProps={{maxLength:LEAD_NOTE_MAX}}/>}
  <small className="form-note">{say('المصادر «من بيانات النظام» تُملأ تلقائيًا عند بدء الفرصة من «مصادر الفرص» أو من طلب التواصل أو الشكوى.','Sources from the system data are filled in automatically when the opportunity is started from «Opportunity sources», a contact request or a complaint.')}</small>
  {problem&&<small className="field-problem" role="alert" id="visit-lead-source-problem" data-field-problem>{t(problem)}</small>}
 </div>;
}
type Reference={kind:LeadRefKind;id:string;source:string;label:string;customerId:string;customerName:string;blocked:string};
/** «فرصة جديدة من هذا الطلب/من هذه الشكوى/من هذه الفرصة»: asks the server for the record (it may refuse), then opens the form. */
export function StartOpportunityButton({kind,id,me,small=true}:{kind:LeadRefKind;id:string;me:Pick<Member,'role'>|null|undefined;small?:boolean}){
 const [say,language]=useSay(),[busy,setBusy]=useState(false),[error,setError]=useState(''),lock=useRef(false);
 if(!me||!leadStarter(me.role))return null;
 async function run(){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{const {reference}=await getJson<{reference:Reference}>('/api/service-leads?kind='+kind+'&id='+encodeURIComponent(id),language);if(reference.blocked)throw new Error(reference.blocked);startOpportunity({kind,id,customerId:reference.customerId,source:reference.source,label:reference.label});}
  catch(failure){setError(messageOf(failure));}finally{lock.current=false;setBusy(false);}
 }
 return <span className="lead-start" data-lead-start={kind}><button type="button" className={'btn subtle'+(small?' small':'')} disabled={busy} onClick={()=>void run()}>{busy?<Loader2 size={16} className="spin" aria-hidden="true"/>:<UserRoundSearch size={16} aria-hidden="true"/>}{say(leadStartLabels[kind],leadStartLabelsEn[kind])}</button>{error&&<span className="form-error" role="alert">{t(error)}</span>}</span>;
}

// ------------------------------------------------------------------------------------------------ «مصادر الفرص»
type LostRow={id:string;number:number|null;customerId:string;customerName:string;lossReason:string;lostAt:string;holderName:string;registrarName:string};
type DormantRow={id:string;name:string;code:string;city:string;phone:string;repName:string;lastPurchase:string;neverBought?:boolean};
type LeadAnswer={list:LeadList;total:number;rows:(LostRow|DormantRow)[];page?:number;pageSize?:number;lapsed?:number;never?:number};
/** «مصادر الفرص». Since the owner's decision of 2026-11-17 (as GSCO 2.13.79) «عملاء منقطعون عن الشراء 90 يومًا» also holds the customers who
 *  never bought, after the others and marked «لم يشترِ من قبل», with their counts, a page of 300 at a time. */
export function ServiceLeadsPanel({me}:{me:Member}){
 const [say,language]=useSay(),[open,setOpen]=useState(false),[list,setList]=useState<LeadList>('lost'),[query,setQuery]=useState(''),[asked,setAsked]=useState(''),[page,setPage]=useState(1),[data,setData]=useState<LeadAnswer|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const load=useCallback(async(which:LeadList,q:string,at:number)=>{setLoading(true);setError('');try{setData(await getJson<LeadAnswer>('/api/service-leads?list='+which+'&q='+encodeURIComponent(q)+(which==='dormant'&&at>1?'&page='+at:''),language));}catch(failure){setError(messageOf(failure));setData(null);}finally{setLoading(false);}},[language]);
 useEffect(()=>{if(open)void load(list,asked,page);},[open,list,asked,page,load]);
 if(!leadReader(me.role))return null;
 const starter=leadStarter(me.role),pageSize=data?.pageSize||0,pages=data&&pageSize?Math.max(1,Math.ceil(data.total/pageSize)):1,first=pageSize?(Math.min(page,pages)-1)*pageSize:0;
 return <details className="panel service-sales-panel service-leads" data-service-leads open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary><UserRoundSearch size={18} aria-hidden="true"/>{say('مصادر الفرص','Opportunity sources')}</summary>
  {open&&<div className="service-report-body">
   <div className="service-leads-tabs" role="tablist">{(['lost','dormant'] as LeadList[]).map(key=><button key={key} type="button" role="tab" aria-selected={list===key} className={'followup-list-filter'+(list===key?' selected':'')} onClick={()=>{setList(key);setQuery('');setAsked('');setPage(1);}}>{say(leadListLabels[key],leadListLabelsEn[key])}</button>)}</div>
   <p className="service-report-note">{list==='lost'?say('الفرص المفقودة التي لم تبدأ منها فرصة جديدة بعد، الأحدث أولًا. لا يظهر عميل له فرصة مفتوحة.','Lost opportunities no new opportunity has been started from yet, newest first. A customer with an open opportunity is not shown.'):say('عملاء نطاقك الذين مضى على آخر شراء لهم أكثر من 90 يومًا، الأقرب انقطاعًا أولًا، ثم من لم يشترِ من قبل.','Customers of your scope whose last purchase is more than 90 days old, the most recent first, then those who never bought.')}</p>
   <form className="service-leads-search" role="search" onSubmit={event=>{event.preventDefault();setPage(1);setAsked(query.trim());if(asked===query.trim()&&page===1)void load(list,query.trim(),1);}}><label className="field"><span>{say('بحث بالاسم أو الرقم','Search by name or number')}</span><input type="search" value={query} onChange={event=>setQuery(event.target.value)} maxLength={60}/></label><button type="submit" className="btn subtle small"><Search size={16} aria-hidden="true"/>{say('بحث','Search')}</button></form>
   {data&&data.list===list&&data.total>0&&<ExportExcelButton page="service-leads" me={me} small row params={{list,q:asked}} disabled={loading}/>}
   {data?.list==='dormant'&&typeof data.lapsed==='number'&&<div className="service-leads-counts" data-dormant-counts><span className="badge pending">{say('انقطعوا عن الشراء','Stopped buying')}: {data.lapsed}</span><span className="badge">{say('لم يشتروا من قبل','Never bought before')}: {data.never??0}</span></div>}
   {loading?<Loader2 className="spin"/>:error?<div className="form-error" role="alert">{t(error)} <button type="button" className="text-button" onClick={()=>void load(list,asked,page)}>{say('إعادة المحاولة','Retry')}</button></div>:data&&(data.rows.length===0?<p className="muted">{say('لا توجد عناصر في هذه القائمة','Nothing in this list')}</p>:<>
    <p className="muted">{say('المعروض','Showing')} {pageSize&&data.total>data.rows.length?(first+1)+'–'+(first+data.rows.length):data.rows.length} / {data.total}</p>
    <ul className="service-leads-list">{data.list==='lost'?(data.rows as LostRow[]).map(row=><li key={row.id} data-lead-row={row.id}><div><b>{row.number!==null?'#'+row.number+' · ':''}{row.customerName}</b><small>{say('تاريخ الفقد','Lost on')} {dayOf(row.lostAt)}{row.lossReason?' · '+t(row.lossReason):''}{row.holderName?' · '+row.holderName:''}</small></div>{starter&&<StartOpportunityButton kind="opportunity" id={row.id} me={me}/>}</li>)
     :(data.rows as DormantRow[]).map(row=><li key={row.id} data-lead-row={row.id} data-never-bought={row.lastPurchase?undefined:'1'}><div><b>{row.name}</b><small>{[row.code,row.city,row.repName].filter(Boolean).join(' · ')}{' · '}{row.lastPurchase?say('آخر شراء','Last purchase')+' '+row.lastPurchase:<span className="badge">{say('لم يشترِ من قبل','Never bought')}</span>}</small></div>{starter&&<StartOpportunityButton kind="customer" id={row.id} me={me}/>}</li>)}</ul></>)}
   {data?.list==='dormant'&&pages>1&&<div className="service-leads-pages" data-dormant-pages><button type="button" className="btn subtle small" disabled={loading||page<=1} onClick={()=>setPage(current=>Math.max(1,current-1))}>{say('السابق','Previous')}</button><span>{Math.min(page,pages)} / {pages}</span><button type="button" className="btn subtle small" disabled={loading||page>=pages} onClick={()=>setPage(current=>Math.min(pages,current+1))}>{say('التالي','Next')}</button></div>}
  </div>}
 </details>;
}

// ------------------------------------------------------------------------------------------------ «اعتماد وإحالة»
type Routing={id:string;version:number;eligible:boolean;reasons:(keyof RoutingFacts)[];warnings:{kind:'visit'|'request';stage:string;ownerName:string;date:string}[];salesManagers:{id:string;name:string}[];serviceMembers:{id:string;name:string;role:string}[];registrarId:string};
/** The customer-service manager's decision on an opportunity waiting for approval: pass it to sales, or keep it with customer service. */
export function RoutingDecision({caseId,busy,onApprove}:{caseId:string;busy:boolean;onApprove:(route:'sales'|'service',memberId:string)=>void}){
 const [say,language]=useSay(),[data,setData]=useState<Routing|null>(null),[error,setError]=useState(''),[route,setRoute]=useState<'sales'|'service'>('sales'),[manager,setManager]=useState(''),[owner,setOwner]=useState('');
 useEffect(()=>{let live=true;getJson<Routing>('/api/service-routing?id='+encodeURIComponent(caseId),language).then(answer=>{if(!live)return;setData(answer);if(answer.salesManagers.length===1)setManager(answer.salesManagers[0].id);if(answer.serviceMembers.length)setOwner(answer.serviceMembers[0].id);}).catch(failure=>{if(live)setError(messageOf(failure));});return()=>{live=false;};},[caseId,language]);
 if(error)return <div className="form-error" role="alert">{t(error)}</div>;
 if(!data)return <Loader2 className="spin"/>;
 const chosen=route==='sales'?manager:owner;
 return <div className="service-routing routing-decision" data-routing-decision>
  <fieldset className="routing-choice"><legend>{say('قرار الاعتماد','Approval decision')}</legend>
   <label><input type="radio" name={'route-'+caseId} checked={route==='sales'} onChange={()=>setRoute('sales')}/>{say('تمرير لمدير المبيعات','Pass to the sales manager')}</label>
   <label><input type="radio" name={'route-'+caseId} checked={route==='service'} disabled={!data.eligible} onChange={()=>setRoute('service')}/>{say('تتولاها خدمة العملاء','Customer service takes it')}</label>
  </fieldset>
  {data.eligible?<div className="routing-reasons"><span>{say('يجوز أن تتولاها خدمة العملاء لأن:','Customer service may take it because:')}</span><ul>{data.reasons.map(key=><li key={key}>{say(routingReasonLabels[key],routingReasonLabelsEn[key])}</li>)}</ul></div>
   :<p className="form-note" data-routing-ineligible>{say(ROUTING_NOT_ELIGIBLE,'Customer service takes an opportunity only when the customer is not registered in the ERP, has not bought in 90 days, or customer service brought the lead in. Pass it to the sales manager.')}</p>}
  {data.warnings.length>0&&<div className="routing-warning" role="alert" data-routing-warning><TriangleAlert size={17} aria-hidden="true"/><div><b>{say(OPEN_SALES_WARNING,'Warning: the customer has an open opportunity with sales')}</b><ul>{data.warnings.map((w,index)=><li key={index}>{w.kind==='request'?say('طلب قالب مفتوح','Open mold request'):say('آخر زيارة للمبيعات','Latest sales visit')}{w.stage?' · '+t(stageLabels[w.stage]||w.stage):''}{w.ownerName?' · '+w.ownerName:''}{w.date?' · '+w.date:''}</li>)}</ul></div></div>}
  {route==='sales'?<label className="field"><span>{say('مدير المبيعات المستلم','Receiving sales manager')}</span><select value={manager} onChange={event=>setManager(event.target.value)}><option value="">{say('اختر','Choose')}</option>{data.salesManagers.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
   :<label className="field"><span>{say('ممثل خدمة العملاء الذي يتولاها','Customer-service member who takes it')}</span><select value={owner} onChange={event=>setOwner(event.target.value)}>{data.serviceMembers.map(m=><option key={m.id} value={m.id}>{m.name}{m.id===data.registrarId?' · '+say('سجّل الفرصة','Registered the opportunity'):''}</option>)}</select></label>}
  {route==='sales'&&!data.salesManagers.length&&<p className="form-note">{say('لم يتم ربط مدير مبيعات متاح. راجع إعداد المستخدم والمنطقة.','No sales manager is linked. Check the user and region settings.')}</p>}
  <button type="button" className="btn primary" disabled={busy||!chosen} onClick={()=>onApprove(route,chosen)}><CheckCircle2 size={17} aria-hidden="true"/>{route==='sales'?say('اعتماد وإحالة للمبيعات','Approve and pass to sales'):say('اعتماد لتتولاها خدمة العملاء','Approve for customer service to take')}</button>
 </div>;
}

// ------------------------------------------------------------------------------------------------ the stage of an opportunity customer service keeps
export function HeldStageForm({current,busy,onSave}:{current:string;busy:boolean;onSave:(entry:{stage:string;lossReason:string;stageNote:string})=>void}){
 const [say]=useSay(),[stage,setStage]=useState(current&&current!=='new'?current:''),[reason,setReason]=useState(''),[note,setNote]=useState('');
 const ready=!!stage&&(stage!=='lost'||!!reason);
 return <div className="service-routing held-stage" data-held-stage>
  <p className="form-note">{say('هذه الفرصة لدى خدمة العملاء: تسجّل تواصلك بزر «تسجيل تواصل»، وتحدّث مرحلة البيع هنا حتى الفوز أو الفقد.','This opportunity is with customer service: record your contacts with «Record a contact» and update the sales stage here until it is won or lost.')}</p>
  <label className="field"><span>{say('مرحلة البيع','Sales stage')}</span><select value={stage} onChange={event=>setStage(event.target.value)}><option value="">{say('اختر','Choose')}</option>{Object.entries(stageLabels).map(([key,label])=><option key={key} value={key}>{t(label)}</option>)}</select></label>
  {stage==='lost'&&<label className="field"><span>{say('سبب الفقد','Loss reason')} <b>*</b></span><select value={reason} onChange={event=>setReason(event.target.value)}><option value="">{say('اختر','Choose')}</option>{followupLossReasons.map(item=><option key={item} value={item}>{t(item)}</option>)}</select></label>}
  <VoiceField label={say('ملاحظة (اختياري)','Note (optional)')} value={note} onChange={setNote} contextKey="held-stage-note" inputProps={{maxLength:1000}}/>
  <button type="button" className="btn primary" disabled={busy||!ready} onClick={()=>onSave({stage,lossReason:stage==='lost'?reason:'',stageNote:note})}><CheckCircle2 size={17} aria-hidden="true"/>{say('حفظ مرحلة البيع','Save the sales stage')}</button>
 </div>;
}

// ------------------------------------------------------------------------------------------------ «تسجيل دور خدمة العملاء»
type RoleTask={caseId:string;number:number|null;customerName:string;outcome:'won'|'lost';memberId:string;memberName:string;basis:keyof typeof roleBasisLabels;closedAt:string;roles:string[];note:string;doneAt:string;doneByName:string;hours:number;targetHours:number;late:boolean;canRecord:boolean};
type RoleAnswer={tasks:RoleTask[];counts:{mine:number;late:number;badge:number}};
export function RoleTasksPanel({me}:{me:Member}){
 const [say,language]=useSay(),[data,setData]=useState<RoleAnswer|null>(null),[error,setError]=useState(''),[openId,setOpenId]=useState('');
 const load=useCallback(async()=>{setError('');try{setData(await getJson<RoleAnswer>('/api/service-role-tasks',language));}catch(failure){setError(messageOf(failure));}},[language]);
 useEffect(()=>{if(leadReader(me.role))void load();},[load,me.role]);
 if(!leadReader(me.role)||!data&&!error||data&&!data.tasks.length)return null;
 return <section className="panel role-tasks" data-role-tasks aria-labelledby="role-tasks-heading">
  <div className="panel-heading"><h2 id="role-tasks-heading"><ClipboardCheck size={18} aria-hidden="true"/>{say('تسجيل دور خدمة العملاء','Record the customer-service role')}{data&&data.counts.badge>0&&<span className="count-badge">{data.counts.badge}</span>}</h2><button type="button" className="icon-button" onClick={()=>void load()} aria-label={say('تحديث','Refresh')}><RefreshCw size={17}/></button></div>
  <p className="service-report-note">{say('عند كسب فرصة شاركت فيها خدمة العملاء أو خسارتها يكتب ممثل خدمة العملاء دوره فيها. المستهدف: 24 ساعة عمل من إغلاق الفرصة.','When an opportunity customer service took part in is won or lost, the customer-service member writes their role in it. Target: 24 working hours from the closing.')}</p>
  {error&&<div className="form-error" role="alert">{t(error)}</div>}
  <ul className="role-task-list">{data?.tasks.map(task=><li key={task.caseId} data-role-task={task.caseId} data-done={!!task.doneAt}>
   <div className="role-task-head"><b>{task.number!==null?'#'+task.number+' · ':''}{task.customerName}</b><span className={'badge '+task.outcome}>{t(stageLabels[task.outcome])}</span>{task.late&&<span className="badge lost">{say('متأخر','Late')}</span>}</div>
   <small>{task.memberName} · {say(roleBasisLabels[task.basis],roleBasisLabelsEn[task.basis])} · {say('أُغلقت','Closed')} {dayOf(task.closedAt)} · {task.hours} / {task.targetHours} {say('ساعة عمل','working hours')}</small>
   {task.doneAt?<p className="role-task-done">{task.roles.map(role=>say(role,serviceRoleOptionsEn[role]||role)).join('، ')} — {task.note} <small>({task.doneByName} · {dayOf(task.doneAt)})</small></p>
    :task.canRecord&&(openId===task.caseId?<RoleTaskForm task={task} say={say} language={language} onDone={async()=>{setOpenId('');await load();}} onCancel={()=>setOpenId('')}/>:<button type="button" className="btn primary small" onClick={()=>setOpenId(task.caseId)}>{say('تسجيل الدور','Record the role')}</button>)}
  </li>)}</ul>
 </section>;
}
function RoleTaskForm({task,say,language,onDone,onCancel}:{task:RoleTask;say:Say;language:string;onDone:()=>Promise<void>;onCancel:()=>void}){
 const [roles,setRoles]=useState<string[]>([]),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),key=useRef(crypto.randomUUID()),lock=useRef(false);
 async function save(){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await postJson('/api/service-role-tasks',{caseId:task.caseId,roles,note,requestId:key.current},language);await onDone();}catch(failure){setError(messageOf(failure));key.current=crypto.randomUUID();}finally{lock.current=false;setBusy(false);}}
 return <div className="role-task-form" data-role-task-form><fieldset disabled={busy}><legend>{say('دور خدمة العملاء','Customer-service role')}</legend>
  <div className="role-task-options">{serviceRoleOptions.map(option=><label key={option}><input type="checkbox" checked={roles.includes(option)} onChange={event=>setRoles(current=>event.target.checked?[...current,option]:current.filter(item=>item!==option))}/>{say(option,serviceRoleOptionsEn[option])}</label>)}</div>
  <VoiceField label={say('ملاحظة دور خدمة العملاء (10 أحرف على الأقل)','Customer-service role note (at least 10 characters)')} multiline value={note} onChange={setNote} contextKey={'role-task:'+task.caseId} inputProps={{maxLength:1000}}/>
  <div className="service-button-row"><button type="button" className="btn subtle small" onClick={onCancel}>{say('إلغاء','Cancel')}</button><button type="button" className="btn primary small" disabled={!roles.length||note.trim().length<ROLE_NOTE_MIN} onClick={()=>void save()}>{busy?<Loader2 size={16} className="spin" aria-hidden="true"/>:<CheckCircle2 size={16} aria-hidden="true"/>}{say('حفظ الدور','Save the role')}</button></div>
 </fieldset>{error&&<div className="form-error" role="alert">{t(error)}</div>}</div>;
}

// ------------------------------------------------------------------------------------------------ «أداء خدمة العملاء»
type PerformanceAnswer={month:string;supportDays:number;canExport:boolean;reach?:PerformanceReach;teams:{managerId:string;managerName:string;rows:PerformanceRow[];total:PerformanceRow}[]};
const currentMonth=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,7);
export function ServicePerformancePanel({me}:{me:Member}){
 const [say,language]=useSay(),[open,setOpen]=useState(false),[month,setMonth]=useState(currentMonth),[data,setData]=useState<PerformanceAnswer|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const load=useCallback(async(which:string)=>{setLoading(true);setError('');try{setData(await getJson<PerformanceAnswer>('/api/service-performance?month='+encodeURIComponent(which),language));}catch(failure){setError(messageOf(failure));setData(null);}finally{setLoading(false);}},[language]);
 useEffect(()=>{if(open)void load(month);},[open,month,load]);
 if(!performanceAllowed(me.role))return null;
 return <details className="panel service-sales-panel service-performance" data-service-performance open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary><ClipboardCheck size={18} aria-hidden="true"/>{say('أداء خدمة العملاء','Customer-service performance')}</summary>
  {open&&<div className="service-report-body">
   <div className="service-report-head"><label className="field service-report-month"><span>{say('الشهر','Month')}</span><input type="month" value={month} max={currentMonth()} required onChange={event=>{if(event.target.value)setMonth(event.target.value);}}/></label>{data?.canExport&&data.teams.length>0&&can(me,'service-reports','export')&&<PerformanceExport month={month} say={say} language={language}/>}</div>
   <p className="service-report-note">{say(performanceNote,performanceNoteEn)}</p>
   {/* The owner's decision 3 (2026-11-17, as GSCO 2.13.79): a sales manager sees only the customer-service teams whose managers report to him. */}
   {data?.reach==='reporting'&&data.teams.length>0&&<p className="service-report-note" data-performance-reach>{say(PERFORMANCE_REPORTING_NOTE,PERFORMANCE_REPORTING_NOTE_EN)}</p>}
   {loading?<Loader2 className="spin"/>:error?<div className="form-error" role="alert">{t(error)}</div>:data&&(data.teams.length===0?(data.reach==='reporting'?<div className="performance-empty" data-performance-no-team><b>{say(PERFORMANCE_NO_TEAM,PERFORMANCE_NO_TEAM_EN)}</b><p className="muted">{say(PERFORMANCE_NO_TEAM_HELP,PERFORMANCE_NO_TEAM_HELP_EN)}</p></div>:<p className="muted">{say('لا يوجد أعضاء في خدمة العملاء','No customer-service members')}</p>):data.teams.map(team=><section key={team.managerId||'none'} className="performance-team" data-performance-team={team.managerId||'none'}>
    <h3>{team.managerName||say('بدون مدير خدمة عملاء','No customer-service manager')}</h3>
    <div className="table-scroll"><table className="service-report-table performance-table"><thead><tr><th>{say('العضو','Member')}</th>{performanceColumns.map(col=><th key={col.key}>{say(col.ar,col.en)}</th>)}</tr></thead>
     <tbody>{[...team.rows,team.total].map((row,index)=><tr key={(row.memberId||'total')+index} className={row===team.total?'total':''}><td>{row===team.total?say('الإجمالي','Total'):row.memberName}</td>{performanceColumns.map(col=><td key={col.key} className="numeric">{String(col.value(row))}</td>)}</tr>)}</tbody></table></div>
    {team.total.bySource.length>0&&<p className="performance-sources"><b>{say('الفرص حسب المصدر','Opportunities by source')}:</b> {team.total.bySource.map(s=>(language==='en'?leadLabelEn(s.group==='غير محدد'?null:s.group,s.group==='غير محدد'?null:s.source):leadLabel(s.group==='غير محدد'?null:s.group,s.group==='غير محدد'?null:s.source))+' ('+s.count+')').join('، ')}</p>}
   </section>))}
   {data&&<p className="service-report-note">{say('مبيعات بالمساندة: فاتورة للعميل خلال','Support-assisted sales: a customer invoice within')} {data.supportDays} {say('يومًا من تواصل خدمة العملاء معه (مهتم أو يطلب زيارة).','days of a customer-service contact (interested or asking for a visit).')}</p>}
  </div>}
 </details>;
}
function PerformanceExport({month,say,language}:{month:string;say:Say;language:string}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),lock=useRef(false);
 async function run(){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{
   const response=await fetch('/api/service-performance/export?month='+encodeURIComponent(month)+'&lang='+(language==='en'?'en':'ar'),{cache:'no-store'});
   if(!response.ok){let text='';try{text=((await response.json()) as {error?:string}).error||'';}catch{text='';}throw new Error(text);}
   const name=/filename="([^"]+)"/.exec(response.headers.get('content-disposition')||'')?.[1]||'Yourrest-service-performance-'+month+'.xlsx';
   const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(failure){setError(messageOf(failure)||say('تعذر تصدير التقرير. أعد المحاولة.','Could not export the report. Retry.'));}
  finally{lock.current=false;setBusy(false);}
 }
 return <span className="service-report-export" data-performance-export><button type="button" className="btn subtle small" disabled={busy} onClick={()=>void run()}>{busy?<Loader2 size={16} className="spin" aria-hidden="true"/>:<FileSpreadsheet size={16} aria-hidden="true"/>}{busy?say('جارٍ التصدير…','Exporting…'):say('تصدير Excel','Export to Excel')}</button>{error&&<span className="form-error" role="alert">{t(error)}</span>}</span>;
}
/** The words of an opportunity's lead for the sheet: «غير محدد» for one registered before the feature. */
export function LeadText({group,source,note}:{group?:string|null;source?:string|null;note?:string|null}){const [,language]=useSay();return <>{language==='en'?leadLabelEn(group,source,note):leadLabel(group,source,note)}</>;}
