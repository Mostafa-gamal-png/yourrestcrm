'use client';
import {useEffect,useState} from 'react';
import {Plus,CheckCircle2,CalendarDays,Eye} from 'lucide-react';
import {Table,TableHeader,TableHead,TableBody,TableRow,TableCell} from '@/components/ui/table';
import {t,useLanguage} from '@/lib/i18n';
import {type Row,type Member,today,stageLabels} from '@/lib/crm';
import {visitCustomer,visitOrder} from '@/lib/customer-visits';
import {customerFollowupPlans,followupTypes,isCustomerFollowup,canExecuteCustomerFollowup} from '@/lib/customer-followups';
import {SupportButton,type SupportBinding} from './support-panel';
import './rep-record-lists.css';

type Props={records:Row[];members:Member[];query:string;staff:string;stage:string;onNew:(customerId:string,sourceId:string)=>void;onOpen:(row:Row)=>void;onCustomer:(id:string)=>void;onDelete?:(row:Row)=>void;support?:SupportBinding};
type Plan=ReturnType<typeof customerFollowupPlans>[number];

export function CustomerFollowupsPage({records,members,query,staff,stage,onNew,onOpen,onCustomer,onDelete,support}:Props){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='ar'?ar:en;
 const [tab,setTab]=useState('open'),[page,setPage]=useState(1),day=today();
 const plans=customerFollowupPlans(records).filter(p=>(staff==='all'||p.responsibleId===staff)&&(stage==='all'||p.stage===stage)&&(!query||[p.customer.data.name,p.customer.data.code,p.customer.data.phone,p.nextAction,p.source.data.result].join(' ').toLowerCase().includes(query.toLowerCase())));
 const due=plans.filter(p=>!p.closed&&(!p.nextDate||!p.nextAction||p.nextDate<=day)),upcoming=plans.filter(p=>!p.closed&&p.nextDate>day&&p.nextAction),closed=plans.filter(p=>p.closed);
 const history=records.filter(r=>isCustomerFollowup(r)&&(staff==='all'||r.data.performedBy===staff)&&(stage==='all'||r.data.salesStage===stage)&&(!query||[visitCustomer(r,records)?.data.name,r.data.result,r.data.nextAction].join(' ').toLowerCase().includes(query.toLowerCase()))).sort((a,b)=>visitOrder(b).localeCompare(visitOrder(a)));
 const shown=tab==='open'?plans.filter(p=>!p.closed):tab==='due'?due:tab==='upcoming'?upcoming:closed,count=tab==='history'?history.length:shown.length,pages=Math.max(1,Math.ceil(count/25)),current=Math.min(page,pages);
 const pagePlans=shown.slice((current-1)*25,current*25),pageHistory=history.slice((current-1)*25,current*25);
 useEffect(()=>setPage(1),[tab,query,staff,stage]);
 const status=(p:Plan)=>p.closed?'closed':!p.nextDate||!p.nextAction?'incomplete':p.nextDate<day?'overdue':p.nextDate===day?'today':'upcoming';
 const statusText=(p:Plan)=>({closed:say('مغلقة','Closed'),incomplete:say('حدد الخطوة القادمة','Set the next step'),overdue:say('متأخرة','Overdue'),today:say('اليوم','Today'),upcoming:say('قادمة','Upcoming')})[status(p)];
 const repName=(id:string)=>members.find(m=>m.id===id)?.name||'';
 return <div className="customer-followups-workspace rep-followup-workspace">
  <section className="panel">
   <div className="panel-heading followup-list-heading">
    <div className="followup-list-filters" role="group" aria-label={t('عرض المتابعات')}>
     {[['open','المفتوحة'],['due','اليوم والمتأخرة'],['upcoming','القادمة'],['closed','المغلقة'],['history','سجل المتابعات']].map(([id,label])=><button type="button" key={id} className={'followup-list-filter '+(tab===id?'selected':'')} onClick={()=>setTab(id)} aria-pressed={tab===id}>{t(label)}</button>)}
    </div>
    <span className="muted">{count} {t('متابعة')}</span>
   </div>
   {!count?<div className="followup-empty"><CheckCircle2 size={30}/><h3>{t(query?'لا توجد نتائج مطابقة':tab==='due'?'لا توجد متابعات مستحقة':tab==='history'?'لا توجد متابعات مسجلة بعد':'لا توجد متابعات في هذا القسم')}</h3></div>:<>
    <div className="rep-mobile-records" aria-label={tab==='history'?t('سجل المتابعات'):t('متابعات العملاء')}>
     {tab==='history'?pageHistory.map(r=>{
      const customer=visitCustomer(r,records),owner=repName(r.data.performedBy)||r.data.recordedByName;
      return <article className="rep-record-card" key={r.id}>
       <div className="rep-record-meta"><span>{t(followupTypes[r.data.type])}</span><time dateTime={r.data.date}><bdi>{r.data.date}</bdi></time></div>
       <button type="button" className="rep-record-customer" onClick={()=>customer?onCustomer(customer.id):onOpen(r)}>{customer?.data.name||t('عرض التفاصيل')}</button>
       <p className="rep-record-result">{r.data.result||'—'}</p>
       {r.data.nextAction&&<div className="rep-record-next"><CalendarDays size={16} aria-hidden="true"/><div><span>{t('المتابعة القادمة')} <bdi>{r.data.nextDate||'—'}</bdi></span><p>{r.data.nextAction}</p></div></div>}
       <div className="rep-record-badges"><span className={'badge '+r.data.salesStage}>{t(stageLabels[r.data.salesStage])}</span>{members.length>1&&owner&&<span className="rep-record-owner">{owner}</span>}</div>
       <div className="rep-record-actions">{onDelete&&r.data.visitWorkflow!=='service-intake-v1'&&!r.data._offlineState&&!r.data._offlineAcknowledged&&<button type="button" className="btn subtle danger" onClick={()=>onDelete(r)}>{say('حذف المتابعة','Delete follow-up')}</button>}<button type="button" className="btn subtle" onClick={()=>onOpen(r)}><Eye size={17}/>{t('عرض التفاصيل')}</button></div>
      </article>;
     }):pagePlans.map(p=><article className="rep-record-card" key={p.customer.id}>
      <div className="rep-record-meta"><span className={'rep-due-chip '+status(p)}>{statusText(p)}</span>{!p.closed&&p.nextDate&&<time dateTime={p.nextDate}><bdi>{p.nextDate}</bdi></time>}</div>
      <button type="button" className="rep-record-customer" onClick={()=>onCustomer(p.customer.id)}>{p.customer.data.name}</button>
      {!p.closed&&<div className={'rep-record-next'+(status(p)==='overdue'?' is-overdue':'')}><CalendarDays size={16} aria-hidden="true"/><div><span>{t('الإجراء القادم')}</span><p>{p.nextAction||say('لم يُحدّد بعد','Not set yet')}</p></div></div>}
      <p className="rep-record-purpose" style={{marginTop:10}}>{say('آخر نتيجة','Last result')}{p.source.data.date&&<> · <bdi>{p.source.data.date}</bdi></>}</p>
      <p className="rep-record-result">{p.source.data.result||say('لم تُسجّل النتيجة بعد','Result not recorded yet')}</p>
      <div className="rep-record-badges"><span className={'badge '+p.stage}>{t(stageLabels[p.stage])}</span>{members.length>1&&repName(p.responsibleId)&&<span className="rep-record-owner">{repName(p.responsibleId)}</span>}</div>
      <div className="rep-record-actions">{canExecuteCustomerFollowup(p.source)&&<button type="button" className="btn primary" onClick={()=>onNew(p.customer.id,p.source.id)}><Plus size={17}/>{t('تنفيذ المتابعة')}</button>}<button type="button" className="btn subtle" onClick={()=>onCustomer(p.customer.id)}>{say('بيانات العميل','Customer details')}</button>{!p.closed&&<SupportButton customerId={p.customer.id} support={support}/>}</div>
     </article>)}
    </div>
    <div className="rep-desktop-records">
     {tab==='history'?<Table><TableHeader><TableRow>{['العميل','تاريخ المتابعة المنفذة','نوع المتابعة','نتيجة المتابعة','مرحلة البيع','المندوب',''].map((s,i)=><TableHead key={i}>{t(s)}</TableHead>)}</TableRow></TableHeader><TableBody>{pageHistory.map(r=>{
      const customer=visitCustomer(r,records);
      return <TableRow key={r.id}><TableCell><button className="text-button" onClick={()=>customer?onCustomer(customer.id):onOpen(r)}>{customer?.data.name||'—'}</button></TableCell><TableCell><bdi>{r.data.date}</bdi></TableCell><TableCell>{t(followupTypes[r.data.type])}</TableCell><TableCell className="followup-result-cell">{r.data.result}</TableCell><TableCell><span className={'badge '+r.data.salesStage}>{t(stageLabels[r.data.salesStage])}</span></TableCell><TableCell>{repName(r.data.performedBy)||r.data.recordedByName||'—'}</TableCell><TableCell>{onDelete&&r.data.visitWorkflow!=='service-intake-v1'&&!r.data._offlineState&&!r.data._offlineAcknowledged&&<button type="button" className="btn subtle small danger" onClick={()=>onDelete(r)}>{say("حذف المتابعة","Delete follow-up")}</button>}<button className="btn subtle small" onClick={()=>onOpen(r)}>{t('عرض التفاصيل')}</button></TableCell></TableRow>;
     })}</TableBody></Table>:<Table><TableHeader><TableRow>{['العميل','آخر نتيجة','مرحلة البيع','الإجراء القادم','موعد المتابعة القادمة','المندوب المسؤول',''].map((s,i)=><TableHead key={i}>{t(s)}</TableHead>)}</TableRow></TableHeader><TableBody>{pagePlans.map(p=><TableRow key={p.customer.id}><TableCell><button className="name-cell" onClick={()=>onCustomer(p.customer.id)}><span><strong>{p.customer.data.name}</strong><small>{[p.customer.data.region,p.customer.data.city].filter(Boolean).join(' · ')}</small></span></button></TableCell><TableCell className="followup-result-cell"><span>{p.source.data.result||'—'}</span><small>{p.source.data.date||''}</small></TableCell><TableCell><span className={'badge '+p.stage}>{t(stageLabels[p.stage])}</span></TableCell><TableCell className="followup-result-cell">{p.nextAction||'—'}</TableCell><TableCell>{p.closed?'—':!p.nextDate||!p.nextAction?<span className="badge lost">{t('تحتاج تحديد الخطوة القادمة')}</span>:<><strong className={p.nextDate<day?'overdue':''}><bdi>{p.nextDate}</bdi></strong><small>{statusText(p)}</small></>}</TableCell><TableCell>{repName(p.responsibleId)||'—'}</TableCell><TableCell>{canExecuteCustomerFollowup(p.source)&&<button className="btn subtle small" onClick={()=>onNew(p.customer.id,p.source.id)}><Plus size={15}/>{t('تنفيذ المتابعة')}</button>}{!p.closed&&<SupportButton customerId={p.customer.id} support={support}/>}</TableCell></TableRow>)}</TableBody></Table>}
    </div>
   </>}
   {count>25&&<div className="table-paging"><button className="btn subtle small" disabled={current===1} onClick={()=>setPage(current-1)}>{t('السابق')}</button><span>{current} / {pages}</span><button className="btn subtle small" disabled={current===pages} onClick={()=>setPage(current+1)}>{t('التالي')}</button></div>}
  </section>
 </div>;
}
