'use client';
import React,{useState} from 'react';
import {FileCheck2,Wallet,FileText} from 'lucide-react';
import {Table,TableHeader,TableHead,TableRow,TableBody,TableCell} from '@/components/ui/table';
import {t,useLanguage} from '@/lib/i18n';
import {money,roles,type Member} from '@/lib/crm';
import {type KpiData,type KpiMetric} from '@/lib/kpis';
import KpiEvidenceEditor from './kpi-evidence-editor';

type Props={kind:'collection'|'quotes';data:KpiData;people:KpiData['people'];identityKey:string;onSaved:()=>void;
 /** Buttons above the list: the collections import in «التحصيل»; in «عروض الأسعار», where the ERP quotations import mounts (importSlot). */
 actions?:React.ReactNode};
const cents=(value:number|null)=>value===null?'—':money(value/100);

/** «التحصيل» and «عروض الأسعار» of the hub: what each person's evidence gives the evaluation this month (lib/kpis.ts), and
 *  «بيانات المؤشرات» of a representative (app/kpi-evidence-editor.tsx, the same dialog as in the evaluation). Nothing new is computed here. */
export default function KpiEvidencePanel({kind,data,people,identityKey,onSaved,actions}:Props){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar;
 const [member,setMember]=useState<Member|null>(null);
 const metric=(person:KpiData['people'][number],id:KpiMetric['id'])=>person.metrics.find(m=>m.id===id);
 const points=(m:KpiMetric|undefined,weight:number)=>m?.status==='not_applicable'?say('لا ينطبق','Not applicable'):m?.points==null?'—':money(m.points)+' / '+weight;
 const ratio=(m:KpiMetric|undefined)=>m?.status==='not_applicable'?say('لا ينطبق','Not applicable'):m?.numerator==null||m.denominator==null?say('غير مكتمل','Incomplete'):m.numerator+' / '+m.denominator+(m.score===null?'':' · '+money(m.score)+'%');
 const button=(person:KpiData['people'][number])=>person.member.role==='rep'?<button type="button" className="btn subtle small" onClick={()=>setMember(person.member)}><FileCheck2 size={15}/>{data.canManage&&!person.member.readOnly?say('استكمال بيانات المؤشرات','Complete KPI evidence'):say('عرض بيانات المؤشرات','View KPI evidence')}</button>:<small className="muted">{say('محسوب من الفريق','Calculated from the team')}</small>;
 const heading=kind==='collection'?say('التحصيل الشهري لكل مندوب','Monthly collection by representative'):say('عروض الأسعار في التقييم','Quotations in the evaluation');
 return <section className="panel kpi-evidence-panel" aria-labelledby={'kpi-evidence-panel-'+kind}>
  <div className="panel-heading kpi-evidence-panel-heading"><div><h3 id={'kpi-evidence-panel-'+kind}>{kind==='collection'?<Wallet size={19}/>:<FileText size={19}/>}{heading}</h3><p className="muted">{kind==='collection'?say('المحصل ÷ المستحق من بيانات التحصيل المعتمدة لكل مندوب؛ النتيجة بحد أقصى 100%.','Collected ÷ due from each representative\'s approved collection data; capped at 100%.'):say('عروض الشهر المسندة لكل مندوب، والمحوَّل منها إلى مبيعات: عرض يذكر رقمَه عمودُ «الوصف» في فاتورة بيع من ERP، أو ربطته الإدارة بفاتورة في «بيانات المؤشرات».','The month\'s quotations assigned to each representative and those converted to sales: a quotation whose number the «Description» column of an ERP sales invoice names, or that management linked to an invoice in the KPI evidence.')}</p></div>{actions&&<div className="kpi-evidence-panel-actions">{actions}</div>}</div>
  {!people.length?<div className="sales-state">{t('لا توجد بيانات أداء مطابقة في هذا الشهر')}</div>:<Table className={'kpi-evidence-panel-table'+(kind==='quotes'?' kpi-quotes-table':'')}><TableHeader><TableRow>{(kind==='collection'?[say('المندوب','Representative'),say('المستحق · ر.س','Due · SAR'),say('المحصل · ر.س','Collected · SAR'),say('نسبة التحصيل','Collection rate'),say('النقاط','Points'),'']:[say('المندوب','Representative'),say('تحويل الفرص إلى عروض','Opportunities to quotations'),say('عروض الشهر','Quotations this month'),say('المحوَّلة إلى مبيعات','Converted to sales'),say('نسبة التحويل','Conversion rate'),say('النقاط','Points'),'']).map((label,index)=><TableHead key={index}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{people.map(person=>{
   const name=<TableCell><strong>{person.member.name}</strong><small>{t(roles[person.member.role]||person.member.role)}{person.member.branch?' · '+person.member.branch:''}</small></TableCell>;
   if(kind==='collection'){const m=metric(person,'collection');return <TableRow key={person.member.id}>{name}<TableCell className="numeric">{cents(m?.denominator??null)}</TableCell><TableCell className="numeric">{cents(m?.numerator??null)}</TableCell><TableCell className="numeric">{m?.score==null?say('غير مكتمل','Incomplete'):money(m.score)+'%'}</TableCell><TableCell className="numeric">{points(m,20)}</TableCell><TableCell>{button(person)}</TableCell></TableRow>;}
   const quotes=metric(person,'quotes'),orders=metric(person,'orders'),known=orders?.denominator!=null;
   // A representative's converted quotations, each with the invoice number(s) that converted it; a team row shows its counts only.
   const converted=person.member.role==='rep'?(person.quotations||[]).filter(q=>q.converted):[];
   const label=(ar:string,en:string)=>({'data-label':say(ar,en)});
   const rate=orders?.status==='not_applicable'?say('لا ينطبق','Not applicable'):orders?.score==null?say('غير مكتمل','Incomplete'):money(orders.score)+'%';
   return <React.Fragment key={person.member.id}><TableRow>{name}<TableCell className="numeric" {...label('تحويل الفرص إلى عروض','Opportunities to quotations')}>{ratio(quotes)}</TableCell><TableCell className="numeric" {...label('عروض الشهر','Quotations this month')}>{known?orders!.denominator:'—'}</TableCell><TableCell className="numeric" {...label('المحوَّلة إلى مبيعات','Converted to sales')}>{known?orders!.numerator:'—'}</TableCell><TableCell className="numeric" {...label('نسبة التحويل','Conversion rate')}>{rate}</TableCell><TableCell className="numeric" {...label('النقاط','Points')}>{points(quotes,3)} · {points(orders,3)}</TableCell><TableCell className="kpi-quotes-action">{button(person)}</TableCell></TableRow>
    {converted.length>0&&<TableRow className="kpi-quote-conversions-row"><TableCell colSpan={7}><div className="kpi-quote-conversions"><span className="kpi-quote-conversions-label">{say('العروض المحوَّلة وفواتيرها:','Converted quotations and their invoices:')}</span><ul>{converted.map(q=><li key={q.quoteId}><bdi dir="ltr" className="kpi-quote-number">{q.number||q.quoteId}</bdi>{q.customerName&&<small>{q.customerName}</small>}<span aria-hidden="true">{language==='en'?'→':'←'}</span><span className="sr-only">{say('الفاتورة:','Invoice:')}</span>{q.invoices.map(reference=><bdi key={reference} dir="ltr" className="kpi-quote-invoice">{reference}</bdi>)}{q.via.includes('manual')&&!q.via.includes('description')&&<small>{say('ربط يدوي','Manual link')}</small>}</li>)}</ul></div></TableCell></TableRow>}
   </React.Fragment>;
  })}</TableBody></Table>}
  {member&&<KpiEvidenceEditor key={identityKey+member.id+data.month} identityKey={identityKey} memberId={member.id} memberName={member.name} month={data.month} onClose={()=>setMember(null)} onSaved={()=>{setMember(null);onSaved();}}/>}
 </section>;
}
