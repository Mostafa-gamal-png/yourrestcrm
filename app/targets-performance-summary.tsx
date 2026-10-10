'use client';
import {ChevronDown,CheckCircle2,Users} from 'lucide-react';
import {t,useLanguage} from '@/lib/i18n';
import {money,roles} from '@/lib/crm';
import {quantityNumber,targetProducts} from '@/lib/targets';
import {displayedKpiScore,missingIndicators,remainingTarget,type SummaryPerson} from '@/lib/targets-performance-summary';
import TargetGauge from './target-gauge';
import './targets-performance-summary.css';

type Props={people:SummaryPerson[];month:string;future:boolean;productId:string;onProductChange:(id:string)=>void;onDetails:(memberId:string)=>void};
const quantity=(value:number|null|undefined)=>typeof value==='number'&&Number.isFinite(value)?quantityNumber(value):'—';
const percent=(value:number|null|undefined)=>typeof value==='number'&&Number.isFinite(value)?money(value)+'%':'—';

export default function TargetsPerformanceSummary({people,month,future,productId,onProductChange,onDetails}:Props){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar;
 const product=targetProducts.find(item=>item.id===productId)||targetProducts[0];
 return <div className="targets-summary-workspace">
  <header className="targets-summary-heading"><div><h2 id="targets-summary-heading"><Users size={21}/>{t('ملخص المناديب')} <span className="inline-count">{people.length}</span></h2><p>{future&&<>{t('لم يبدأ الشهر بعد')} · </>}<bdi>{month}</bdi></p></div><label className="field targets-summary-product" htmlFor="targets-summary-product"><span>{t('الصنف المعروض')}</span><select id="targets-summary-product" value={product.id} onChange={event=>onProductChange(event.target.value)}>{targetProducts.map(item=><option key={item.id} value={item.id}>{t(item.name)} · {t(item.unit)}</option>)}</select></label></header>
  {!people.length?<div className="sales-state panel">{t('لا توجد بيانات مطابقة لعرض الملخص')}</div>:<div className="targets-summary-grid">{people.map(person=>{
   const row=person.attainment.rows.find(item=>item.id===product.id),missing=future?[]:missingIndicators(person.metrics),score=future?null:displayedKpiScore(person),excludedWeight=person.summary?.excludedWeight||0,applicableWeight=person.summary?.applicableWeight??100,notApplicable=!future&&applicableWeight===0;
   return <article key={person.member.id} className="panel targets-summary-card">
    <header className="targets-summary-member"><div><h3>{person.member.name}</h3><p>{t(roles[person.member.role]||person.member.role)}{person.member.branch?' · '+person.member.branch:''}{!person.member.active?' · '+t('معطل'):''}</p></div>{person.teamRollup&&<span className="badge">{t('المبيعات محسوبة من الفريق')}</span>}</header>
    {!future&&<div className="targets-summary-scores"><TargetGauge value={person.attainment.score} label={t('التحقيق المرجح للمستهدف')} emptyLabel={person.metrics?.find(metric=>metric.id==='attainment')?.status==='not_applicable'?say('لا ينطبق','Not applicable'):t('غير مكتمل')}/><TargetGauge value={row?.achievement} label={t('نسبة تحقيق الصنف')+' · '+t(product.name)} emptyLabel={row?.target==null?say('لم يُحدد مستهدف','No target set'):row.target===0?say('المستهدف صفر','Target is zero'):t('غير مكتمل')}/><div className="targets-summary-total"><span>{t('درجة التقييم الكلية')}</span><strong dir={score===null?undefined:'ltr'} className={score===null?'is-incomplete':''}>{score===null?(notApplicable?say('لا ينطبق','Not applicable'):t('غير مكتمل')):money(score)+' / 100'}</strong>{person.summary&&<small className="targets-summary-coverage">{say('الوزن المقيم','Evaluated weight')}: {person.summary.covered-excludedWeight} / {applicableWeight}%</small>}</div></div>}
    {!future&&excludedWeight>0&&<p className="targets-summary-applicable">{say('الدرجة من المؤشرات المنطبقة فقط','Score uses applicable indicators only')} · {say('لا ينطبق','Not applicable')}: {excludedWeight}%</p>}
    <p className="targets-summary-unit">{t(product.name)} · {t(product.unit)}</p>
    <dl className={'targets-summary-quantities'+(future?' is-future':'')}>
     <div><dt>{t('المستهدف المطلوب')}</dt><dd>{quantity(row?.target)} <small>{t(product.unit)}</small></dd></div>
     {!future&&<><div><dt>{t('المحقق الفعلي')}</dt><dd>{quantity(row?.actual)} <small>{t(product.unit)}</small></dd></div><div><dt>{t('نسبة تحقيق الصنف')}</dt><dd>{percent(row?.achievement)}</dd></div><div><dt>{t('المتبقي للمستهدف')}</dt><dd>{quantity(remainingTarget(row?.target,row?.actual))} <small>{t(product.unit)}</small></dd></div></>}
    </dl>
    {future?<p className="targets-summary-future">{t('لم يبدأ الشهر بعد')}</p>:missing.length?<details className="targets-summary-missing"><summary><span>{missing.length} {t('مؤشرات غير مكتملة')}</span><ChevronDown size={16}/></summary><ul>{missing.map(indicator=><li key={indicator.id}>{t(indicator.name)}</li>)}</ul></details>:<p className="targets-summary-complete"><CheckCircle2 size={16}/>{t('المؤشرات مكتملة')}</p>}
    <button type="button" className="btn subtle targets-summary-details no-print" onClick={()=>onDetails(person.member.id)}>{t('عرض التفاصيل')}</button>
   </article>;
  })}</div>}
  {people.length>0&&<p className="targets-summary-footnote">— {t('القيمة غير متاحة عند عدم اكتمال البيانات.')}</p>}
 </div>;
}
