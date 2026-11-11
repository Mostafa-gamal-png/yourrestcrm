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
  <div className="panel-heading kpi-evidence-panel-heading"><div><h3 id={'kpi-evidence-panel-'+kind}>{kind==='collection'?<Wallet size={19}/>:<FileText size={19}/>}{heading}</h3><p className="muted">{kind==='collection'?say('المحصل ÷ المستحق من بيانات التحصيل المعتمدة لكل مندوب؛ النتيجة بحد أقصى 100%.','Collected ÷ due from each representative\'s approved collection data; capped at 100%.'):say('عروض الشهر المسندة لكل مندوب وربطها بفواتير البيع، من «بيانات المؤشرات».','The month\'s quotations assigned to each representative and their linked sales invoices, from the KPI evidence.')}</p></div>{actions&&<div className="kpi-evidence-panel-actions">{actions}</div>}</div>
  {!people.length?<div className="sales-state">{t('لا توجد بيانات أداء مطابقة في هذا الشهر')}</div>:<Table className="kpi-evidence-panel-table"><TableHeader><TableRow>{(kind==='collection'?[say('المندوب','Representative'),say('المستحق · ر.س','Due · SAR'),say('المحصل · ر.س','Collected · SAR'),say('نسبة التحصيل','Collection rate'),say('النقاط','Points'),'']:[say('المندوب','Representative'),say('تحويل الفرص إلى عروض','Opportunities to quotations'),say('تحويل العروض إلى مبيعات','Quotations to sales'),say('النقاط','Points'),'']).map((label,index)=><TableHead key={index}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{people.map(person=>{
   const name=<TableCell><strong>{person.member.name}</strong><small>{t(roles[person.member.role]||person.member.role)}{person.member.branch?' · '+person.member.branch:''}</small></TableCell>;
   if(kind==='collection'){const m=metric(person,'collection');return <TableRow key={person.member.id}>{name}<TableCell className="numeric">{cents(m?.denominator??null)}</TableCell><TableCell className="numeric">{cents(m?.numerator??null)}</TableCell><TableCell className="numeric">{m?.score==null?say('غير مكتمل','Incomplete'):money(m.score)+'%'}</TableCell><TableCell className="numeric">{points(m,20)}</TableCell><TableCell>{button(person)}</TableCell></TableRow>;}
   const quotes=metric(person,'quotes'),orders=metric(person,'orders');
   return <TableRow key={person.member.id}>{name}<TableCell className="numeric">{ratio(quotes)}</TableCell><TableCell className="numeric">{ratio(orders)}</TableCell><TableCell className="numeric">{points(quotes,3)} · {points(orders,3)}</TableCell><TableCell>{button(person)}</TableCell></TableRow>;
  })}</TableBody></Table>}
  {member&&<KpiEvidenceEditor key={identityKey+member.id+data.month} identityKey={identityKey} memberId={member.id} memberName={member.name} month={data.month} onClose={()=>setMember(null)} onSaved={()=>{setMember(null);onSaved();}}/>}
 </section>;
}
