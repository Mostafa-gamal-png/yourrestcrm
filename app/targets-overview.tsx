'use client';
import type React from 'react';
import {ChevronDown} from 'lucide-react';
import {t,useLanguage} from '@/lib/i18n';
import {money} from '@/lib/crm';
import {quantityNumber} from '@/lib/targets';
import {shownAchievement} from '@/lib/targets-performance-summary';
import {missingLine,type OverviewScope} from '@/lib/targets-overview';
import TargetGauge from './target-gauge';

/** «تحقيق المستهدف»: the company's gauge, and each branch's when there are two branches or more, with «تفاصيل الفئات» (each product). */
export default function TargetsOverviewCard({company,branches}:{company:OverviewScope;branches:OverviewScope[]}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar,single=!branches.length;
 const title=(scope:OverviewScope)=>scope.kind==='company'?say('الشركة','Company'):language==='en'?'Branch: '+scope.name:/^(?:ال)?فرع/.test(scope.name)?scope.name:'فرع '+scope.name;
 const source=(scope:OverviewScope):React.ReactNode=>scope.kind==='company'&&scope.source==='branches'?say('مجموع الفروع','Sum of the branches')
  :scope.source==='saved'?(single?<>{say('مستهدف «الفرع بالكامل»','The «Entire branch» target')}{scope.savedMonth&&<> · {say('ساري من شهر','effective from')} <bdi dir="ltr">{scope.savedMonth}</bdi></>}</>:say('مستهدف خاص بالفرع','Branch\'s own target'))
  :single?say('مجموع مستهدفات المناديب','Sum of the representatives\' targets'):say('مجموع مستهدفات أفراده','Sum of its people\'s targets');
 return <section className="panel targets-overview" aria-labelledby="targets-overview-heading" data-single={single?'':undefined}>
  <header className="targets-overview-heading"><h3 id="targets-overview-heading">{single?say('تحقيق المستهدف — الشركة','Target achievement — company'):say('تحقيق المستهدف — الشركة والفروع','Target achievement — company and branches')}</h3></header>
  <div className="targets-overview-grid">{[company,...branches].map(scope=><article key={scope.id} className="targets-overview-scope" data-scope={scope.id}>
   <h4>{title(scope)}</h4>
   <TargetGauge value={scope.attainment.score} label={say('نسبة الإنجاز','Achievement')} emptyLabel={missingLine(scope.missing,scope.attainment.status,language,id=>t(id))}/>
   <small className="targets-overview-source">{source(scope)}</small>
   {scope.ignoredSaved&&<small className="targets-overview-ignored">{say('لم يُعتمد مستهدف «الفرع بالكامل» لأنه ناقص','The «Entire branch» target was not used: it misses products')} ({say('ساري من شهر','effective from')} <bdi dir="ltr">{scope.ignoredSaved}</bdi>)</small>}
   <details className="targets-overview-details"><summary><span>{say('تفاصيل الفئات','Category details')}</span><ChevronDown size={16} aria-hidden="true"/></summary>
    <table className="targets-overview-table"><thead><tr><th>{say('الصنف','Product')}</th><th>{say('المستهدف','Target')}</th><th>{say('المحقق','Achieved')}</th><th>%</th></tr></thead>
     <tbody>{scope.attainment.rows.map(row=>{const cover=scope.coverage?.[row.id],partial=!!cover&&cover.set<cover.of;return <tr key={row.id} data-partial={partial?'':undefined}><td>{t(row.name)} <small>· {t(row.unit)}</small></td><td dir="ltr">{row.target===null?say('غير محدد','Not set'):quantityNumber(row.target)}{partial&&<small className="targets-overview-coverage" dir={language==='en'?'ltr':'rtl'}>{say('محدَّد لـ '+cover.set+' من '+cover.of,'set for '+cover.set+' of '+cover.of)}</small>}</td><td dir="ltr">{row.actual===null?'—':quantityNumber(row.actual)}</td><td dir="ltr">{row.achievement===null?'—':money(shownAchievement(row.achievement)!)+'%'}</td></tr>;})}</tbody></table>
   </details>
  </article>)}</div>
  <p className="targets-overview-note">{single?say('مستهدف الشركة هو مجموع مستهدفات المناديب في هذا الشهر. مبيعات المكاتب الإدارية لا تدخل في الحساب. يتغير بالشهر فقط، ولا يتأثر باختيار المندوب.','The company\'s target is the sum of the representatives\' targets this month. Office sales are not counted. It changes with the month only, not with the representative chosen.')
   :say('مستهدف الفرع هو مجموع مستهدفات أفراده في هذا الشهر، ما لم يُحفظ له مستهدف خاص، ومستهدف الشركة مجموع الفروع. مبيعات المكاتب الإدارية لا تدخل في الحساب. يتغير بالشهر فقط، ولا يتأثر باختيار المندوب.','A branch\'s target is the sum of its people\'s targets this month, unless the branch has a target of its own; the company\'s is the sum of the branches. Office sales are not counted. It changes with the month only, not with the representative chosen.')}</p>
 </section>;
}
