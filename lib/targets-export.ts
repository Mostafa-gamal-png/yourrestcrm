import {activityFields,defaultActivityTargets,effectiveSet,targetProducts,type ActivityTargets,type TargetState} from './targets';
import {operationalIndicators,type KpiPerson} from './kpis';
import {type Member} from './crm';

type Translate=(value:string)=>string;
type Cell=string|number;
type ProductRow={product:string;quantity?:number|null;weight?:number|null};

export const targetsCsvHeaders=['الشهر','المندوب / الفرع','نوع المستهدف','الصنف / المؤشر','الكمية / الوزن','ساري من'];
export const performanceCsvHeaders=['الشهر','المندوب','المؤشر','الوزن %','الدرجة من 100','النقاط المحتسبة','البيانات المطلوبة / طريقة الحساب'];

/** The scope of a saved set as the page names it: a person, «الفرع بالكامل · <branch>», or «كل المناديب» for the company weights. */
export function targetScopeName(scopeId:string,members:Member[],t:Translate){
 if(scopeId==='company')return t('كل المناديب');
 if(scopeId.startsWith('branch:'))return t('الفرع بالكامل')+' · '+scopeId.slice(7);
 return members.find(m=>m.id===scopeId)?.name||scopeId;
}

/** Every row of «تصدير كل المستهدفات» (hidden: the administrators the page leaves out): the saved and team-computed sets, then what the page shows for a person with nothing saved
 *  (the default customer and visit targets, and «غير محدد» product targets), so the file holds what the screen holds. */
export function targetsCsvRows(state:TargetState,members:Member[],month:string,t:Translate,hidden:string[]=[]):Cell[][]{
 const activityLabel=t('مستهدفات العملاء والزيارات'),productLabel=t('مستهدفات الأصناف');
 const rows:Cell[][]=state.sets.flatMap(s=>{
  const scope=targetScopeName(s.scopeId,members,t),from=s.computed?t('محسوب من الفريق'):s.month;
  if(s.kind==='activity')return activityFields.map(([key,label])=>[month,scope,activityLabel,t(label),s.incomplete?'':(s.data as ActivityTargets)[key],from]);
  return (s.data.products as ProductRow[]).map(p=>[month,scope,t(s.kind==='weights'?'أوزان التقييم':'مستهدفات الأصناف'),t(p.product),p.quantity??p.weight??'',from]);
 });
 // The people the targets tables list («people» in app/targets-workspace.tsx) who have no set of their own; an administrator the
 // page leaves out (no target or sale of theirs this month: lib/targets.ts hiddenAdminIds) is left out of the file too.
 const people=members.filter(m=>!m.readOnly&&!hidden.includes(m.id)&&(m.active||state.sets.some(s=>s.scopeId===m.id)));
 for(const m of people){
  if(!effectiveSet(state,'sales',m.id))for(const p of targetProducts)rows.push([month,m.name,productLabel,t(p.name),'',t('غير محدد')]);
  if(!effectiveSet(state,'activity',m.id))for(const [key,label] of activityFields)rows.push([month,m.name,activityLabel,t(label),defaultActivityTargets[key],t('المستهدفات الافتراضية')]);
 }
 return rows;
}

/** Every row of «تصدير التقييم»: each indicator of each person, then the person's overall line as the page shows it
 *  (the score out of 100 or empty while incomplete, the points earned, the evaluated weight over the applicable weight). */
export function performanceCsvRows(people:KpiPerson[],month:string,t:Translate):Cell[][]{
 return people.flatMap(person=>{
  const indicators:Cell[][]=person.metrics.map(metric=>{const indicator=operationalIndicators.find(i=>i.id===metric.id)!;return [month,person.member.name,t(indicator.name),indicator.weight,metric.score??'',metric.points??'',t(metric.reason)];});
  const s=person.summary,assessed=s.covered-s.excludedWeight;
  const state=s.total===null?(s.applicableWeight===0?t('لا ينطبق'):t('غير مكتمل')):'';
  return [...indicators,[month,person.member.name,t('درجة التقييم الكلية'),s.applicableWeight,s.total??'',s.earned,[state,t('الوزن الذي تم تقييمه')+': '+assessed+' / '+s.applicableWeight+'%'].filter(Boolean).join(' · ')]];
 });
}
