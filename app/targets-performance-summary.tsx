'use client';
import {CheckCircle2,Users} from 'lucide-react';
import {t,useLanguage} from '@/lib/i18n';
import {money,roles} from '@/lib/crm';
import {quantityNumber,targetProducts} from '@/lib/targets';
import {displayedKpiScore,outOfEvaluation,remainingTarget,shownAchievement,type SummaryPerson} from '@/lib/targets-performance-summary';
import {INACTIVE_TEXT,type KpiMetric,type KpiSummary} from '@/lib/kpis';
import {KPI_GAP_WORDS,gapActionText,kpiGapSummary,kpiGaps,kpiMissing,type GapPerson} from '@/lib/kpi-gaps';
import TargetGauge from './target-gauge';
import './targets-performance-summary.css';

type Props={people:SummaryPerson[];month:string;future:boolean;productId:string;onProductChange:(id:string)=>void;onDetails:(memberId:string)=>void};
const quantity=(value:number|null|undefined)=>typeof value==='number'&&Number.isFinite(value)?quantityNumber(value):'—';
const percent=(value:number|null|undefined)=>typeof value==='number'&&Number.isFinite(value)?money(value)+'%':'—';

/** The overall score from the data there is (lib/kpis.ts kpiSummary): while some indicators have no data, a yellow note says how much of
 *  the applicable weight the score stands on and names the indicators without data (as GSCO: «غير مكتمل»، «بيانات ناقصة»), each with its
 *  weight (2026-11-16, item 2 of the GSCO list: «جنب «بيانات ناقصة» تظهر أسماء المؤشرات الناقصة وأوزانها»). On a person's page (`person`)
 *  the names become a checklist: each missing indicator with its weight and what completes it, who does it and where (lib/kpi-gaps.ts). */
export function KpiPartialNotice({summary,metrics,person}:{summary:Partial<Pick<KpiSummary,'complete'|'dataShare'|'missing'|'inactive'|'total'>>|undefined;metrics?:readonly KpiMetric[];person?:GapPerson}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar,word=(pair:readonly [string,string])=>pair[language==='en'?1:0];
 if(summary?.inactive)return null;
 const missing=kpiMissing(person?.metrics??metrics??[]),gaps=person?kpiGaps(person):[];
 const partial=!!summary&&summary.complete===false&&typeof summary.total==='number'&&typeof summary.dataShare==='number';
 if(!partial&&!missing.length)return null;
 return <div className="kpi-partial-notice" role="note" data-kpi-missing="">{partial&&<p>{say('الدرجة محسوبة من البيانات الموجودة فقط: ','The score is calculated from the available data only: ')}<bdi dir="ltr">{money(summary!.dataShare!)}%</bdi>{say(' من الوزن',' of the weight')}</p>}
  {gaps.length>0?<><p><strong>{word(KPI_GAP_WORDS.title)}:</strong></p><ul className="kpi-gap-list">{gaps.map(gap=><li key={gap.id} data-kpi-gap={gap.id}><strong>{t(gap.name)} (<bdi dir="ltr">{gap.weight}%</bdi>)</strong>: {gap.actions.map(action=>gapActionText(action,language,t)).join(say('؛ ','; '))}</li>)}</ul></>
  :missing.length>0&&<p><strong>{word(KPI_GAP_WORDS.missing)}: </strong>{missing.map((row,index)=><span key={row.id}>{index?say('، ',', '):''}{t(row.name)} (<bdi dir="ltr">{row.weight}%</bdi>)</span>)}</p>}</div>;
}
/** In the comparison table, under a score that stands on part of the data: «بيانات ناقصة: التحصيل (20%)، …» (2026-11-16). */
export function KpiMissingList({metrics}:{metrics:readonly KpiMetric[]}){
 const {language}=useLanguage(),missing=kpiMissing(metrics);
 if(!missing.length)return null;
 return <small className="kpi-missing-list" data-kpi-missing-list="">{KPI_GAP_WORDS.missing[language==='en'?1:0]}: {missing.map((row,index)=><span key={row.id}>{index?(language==='en'?', ':'، '):''}{t(row.name)} (<bdi dir="ltr">{row.weight}%</bdi>)</span>)}</small>;
}
/** «المطلوب لاكتمال التقييم» above the comparison table (2026-11-16, item 2 of the GSCO list): one line per action, with the weight of the
 *  indicators it completes, and under it whom it concerns («كل المناديب (N)» when it is everyone listed). Nothing is drawn when nothing is
 *  missing. */
export function KpiGapsSummary({people}:{people:readonly (GapPerson&{member:{id:string;name:string};summary?:{inactive?:boolean}|null})[]}){
 const {language}=useLanguage(),summary=kpiGapSummary(people),word=(pair:readonly [string,string])=>pair[language==='en'?1:0],separator=language==='en'?', ':'، ';
 if(!summary.lines.length)return null;
 const whom=(list:readonly {name:string}[])=>list.length>1&&list.length===summary.people?word(KPI_GAP_WORDS.everyone)+' ('+list.length+')':list.slice(0,4).map(person=>person.name).join(separator)+(list.length>4?' +'+(list.length-4):'');
 return <section className="panel kpi-gaps-summary" data-kpi-gaps-summary="" aria-labelledby="kpi-gaps-summary-heading"><h3 id="kpi-gaps-summary-heading">{word(KPI_GAP_WORDS.title)}</h3><p className="kpi-gaps-hint">{word(KPI_GAP_WORDS.hint)}</p>
  <ul className="kpi-gap-list">{summary.lines.map(line=><li key={line.action.key} data-kpi-gap-line=""><span>{gapActionText(line.action,language,t,line.waiting)}</span> — <bdi dir="ltr">{line.weight}%</bdi><span className="kpi-gap-people">{whom(line.people)}</span></li>)}</ul></section>;
}
/** The small «غير مكتمل» badge beside a score that stands on part of the data. */
export function KpiIncompleteBadge({summary}:{summary:Pick<KpiSummary,'complete'|'inactive'>|undefined}){
 useLanguage();
 return summary&&!summary.complete&&!summary.inactive?<span className="badge kpi-incomplete-badge">{t('غير مكتمل')}</span>:null;
}
/** People out of the evaluation («بلا نشاط في هذا الشهر») after everyone else, in their order otherwise. */
export const evaluatedFirst=<T extends SummaryPerson>(people:T[])=>[...people.filter(person=>!outOfEvaluation(person)),...people.filter(outOfEvaluation)];

export default function TargetsPerformanceSummary({people,month,future,productId,onProductChange,onDetails}:Props){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar;
 const product=targetProducts.find(item=>item.id===productId)||targetProducts[0];
 return <div className="targets-summary-workspace">
  <header className="targets-summary-heading"><div><h2 id="targets-summary-heading"><Users size={21}/>{t('ملخص المناديب')} <span className="inline-count">{people.length}</span></h2><p>{future&&<>{t('لم يبدأ الشهر بعد')} · </>}<bdi>{month}</bdi></p></div><label className="field targets-summary-product" htmlFor="targets-summary-product"><span>{t('الصنف المعروض')}</span><select id="targets-summary-product" value={product.id} onChange={event=>onProductChange(event.target.value)}>{targetProducts.map(item=><option key={item.id} value={item.id}>{t(item.name)} · {t(item.unit)}</option>)}</select></label></header>
  {!people.length?<div className="sales-state panel">{t('لا توجد بيانات مطابقة لعرض الملخص')}</div>:<div className="targets-summary-grid">{(future?people:evaluatedFirst(people)).map(person=>{
   const inactive=!future&&outOfEvaluation(person),row=person.attainment.rows.find(item=>item.id===product.id),missing=future||inactive?[]:kpiMissing(person.metrics),score=future?null:displayedKpiScore(person),excludedWeight=person.summary?.excludedWeight||0,applicableWeight=person.summary?.applicableWeight??100,notApplicable=!future&&applicableWeight===0;
   return <article key={person.member.id} className={'panel targets-summary-card'+(inactive?' is-out-of-evaluation':'')}>
    <header className="targets-summary-member"><div><h3>{person.member.name}</h3><p>{t(roles[person.member.role]||person.member.role)}{person.member.branch?' · '+person.member.branch:''}{!person.member.active?' · '+t('معطل'):''}</p></div>{person.teamRollup&&<span className="badge">{t('المبيعات محسوبة من الفريق')}</span>}</header>
    {inactive&&<p className="targets-summary-inactive" role="status">{t(INACTIVE_TEXT)}</p>}
    {!future&&!inactive&&<div className="targets-summary-scores"><TargetGauge value={person.attainment.score} label={t('التحقيق المرجح للمستهدف')} emptyLabel={person.metrics?.find(metric=>metric.id==='attainment')?.status==='not_applicable'?say('لا ينطبق','Not applicable'):t('غير مكتمل')}/><TargetGauge value={shownAchievement(row?.achievement)} label={t('نسبة تحقيق الصنف')+' · '+t(product.name)} emptyLabel={row?.target==null?say('لم يُحدد مستهدف','No target set'):row.target===0?say('المستهدف صفر','Target is zero'):t('غير مكتمل')}/><div className="targets-summary-total"><span>{t('درجة التقييم الكلية')}</span><span className="targets-summary-score-line"><strong dir={score===null?undefined:'ltr'} className={score===null?'is-incomplete':''}>{score===null?(notApplicable?say('لا ينطبق','Not applicable'):t('غير مكتمل')):money(score)+' / 100'}</strong>{score!==null&&<KpiIncompleteBadge summary={person.summary}/>}</span>{person.summary&&<small className="targets-summary-coverage">{say('الوزن المقيم','Evaluated weight')}: {person.summary.covered-excludedWeight} / {applicableWeight}%</small>}</div></div>}
    {!future&&!inactive&&<KpiPartialNotice summary={person.summary} metrics={person.metrics||[]}/>}
    {!future&&!inactive&&excludedWeight>0&&<p className="targets-summary-applicable">{say('الدرجة من المؤشرات المنطبقة فقط','Score uses applicable indicators only')} · {say('لا ينطبق','Not applicable')}: {excludedWeight}%</p>}
    <p className="targets-summary-unit">{t(product.name)} · {t(product.unit)}</p>
    <dl className={'targets-summary-quantities'+(future?' is-future':'')}>
     <div><dt>{t('المستهدف المطلوب')}</dt><dd>{quantity(row?.target)} <small>{t(product.unit)}</small></dd></div>
     {!future&&<><div><dt>{t('المحقق الفعلي')}</dt><dd>{quantity(row?.actual)} <small>{t(product.unit)}</small></dd></div><div><dt>{t('نسبة تحقيق الصنف')}</dt><dd>{percent(row?.achievement)}</dd></div><div><dt>{t('المتبقي للمستهدف')}</dt><dd>{quantity(remainingTarget(row?.target,row?.actual))} <small>{t(product.unit)}</small></dd></div></>}
    </dl>
    {future?<p className="targets-summary-future">{t('لم يبدأ الشهر بعد')}</p>:inactive||missing.length?null:<p className="targets-summary-complete"><CheckCircle2 size={16}/>{t('المؤشرات مكتملة')}</p>}
    <button type="button" className="btn subtle targets-summary-details no-print" onClick={()=>onDetails(person.member.id)}>{t('عرض التفاصيل')}</button>
   </article>;
  })}</div>}
  {people.length>0&&<p className="targets-summary-footnote">— {t('القيمة غير متاحة عند عدم اكتمال البيانات.')}</p>}
 </div>;
}
