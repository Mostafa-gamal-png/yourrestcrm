'use client';
import {useMemo,useState} from 'react';
import {CalendarClock} from 'lucide-react';
import {t,useLanguage} from '@/lib/i18n';
import {money,today as riyadhToday,type Member} from '@/lib/crm';
import {targetProducts,quantityNumber,effectiveSet,type QuantityTargets,type TargetState} from '@/lib/targets';
import {addTargets,dayRows,daySold,defaultReportDay,isWorkingDay,monthDays,reportDayAllowed,workingDaysOf} from '@/lib/daily-target';
import type {Sale} from '@/lib/sales';
import './today-sales.css';

/** «مبيعات اليوم قصاد مستهدف اليوم» (the owner, 2026-11-16, GSCO list item 8; lib/daily-target.ts): one card, the day's sales of each product
 *  beside the day's share of the month's target. The day picker stays inside the month and never passes today (Riyadh). `soldOn` gives the
 *  quantities of a day; `targets` the month's target of each product (null: «غير محدد»). */
export function DaySalesPanel({month,targets,soldOn,scope,headingId}:{month:string;targets:ReadonlyMap<string,number|null>;soldOn:(date:string)=>{quantities:ReadonlyMap<string,number>;documents:number};scope?:string;headingId:string}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar;
 const now=riyadhToday(),days=monthDays(month),last=days.filter(day=>day<=now).at(-1)||'';
 const [picked,setPicked]=useState(()=>defaultReportDay(month,now));
 const date=reportDayAllowed(month,picked,now)?picked:defaultReportDay(month,now);
 const sold=soldOn(date),rows=dayRows(targetProducts,targets,sold.quantities,date);
 const total=workingDaysOf(month),working=isWorkingDay(date),position=days.filter(day=>day<=date&&isWorkingDay(day)).length;
 const dayLabel=new Intl.DateTimeFormat(language==='en'?'en-GB':'ar-EG',{calendar:'gregory',numberingSystem:'latn',timeZone:'UTC',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(date+'T12:00:00Z'));
 const tone=(value:number|null)=>value===null?'none':value>=100?'met':value>=80?'near':'behind';
 return <section className="panel day-sales" aria-labelledby={headingId} data-day-sales={date}>
  <header className="day-sales-heading"><div><h2 id={headingId}><CalendarClock size={19}/>{say('مبيعات اليوم قصاد مستهدف اليوم','Today\'s sales against today\'s target')}</h2>
   <p>{scope&&<><strong>{scope}</strong> · </>}<bdi>{dayLabel}</bdi> · {working?say(`يوم العمل ${position} من ${total}`,`Working day ${position} of ${total}`):say('الجمعة يوم الإجازة الأسبوعية؛ لا مستهدف له','Friday is the weekly day off; it has no target')}</p></div>
   {last&&<label className="field day-sales-date"><span>{say('اليوم','Day')}</span><input type="date" value={date} min={days[0]} max={last} onChange={event=>{if(reportDayAllowed(month,event.target.value,now))setPicked(event.target.value);}} aria-label={say('يوم مبيعات اليوم','Day of the day\'s sales')}/></label>}
  </header>
  <p className="day-sales-note">{say(`مستهدف اليوم = مستهدف الشهر ÷ أيام العمل في الشهر (${total} يومًا، بلا أيام الجمعة).`,`Today's target = the month's target ÷ the month's working days (${total} days, Fridays excluded).`)} {!sold.documents&&say('لا توجد مبيعات مسجلة في هذا اليوم بعد؛ مبيعات ERP تظهر بعد استيرادها.','No sales recorded on this day yet; ERP sales appear once imported.')}</p>
  <ul className="day-sales-products">{rows.map(row=><li key={row.product} className="day-sales-product" data-product={row.product} data-tone={tone(row.achievement)}>
   <h3>{t(row.product)} <small>· {t(row.unit)}</small></h3>
   <dl><div><dt>{say('مبيعات اليوم','Today\'s sales')}</dt><dd data-day-sold>{quantityNumber(row.sold)}</dd></div><div><dt>{say('مستهدف اليوم','Today\'s target')}</dt><dd data-day-target>{row.dayTarget===null?<span className="day-sales-unset">{t('غير محدد')}</span>:money(row.dayTarget)}</dd></div></dl>
   <p className="day-sales-achievement">{row.achievement===null?(row.dayTarget===0&&row.monthTarget!==null&&working?say('المستهدف صفر','Target is zero'):row.dayTarget===null?say('لم يُحدد مستهدف الشهر','No monthly target set'):'—'):<><bdi dir="ltr">{money(row.achievement)}%</bdi> {say('من مستهدف اليوم','of today\'s target')}</>}</p>
   {row.monthTarget!==null&&<p className="day-sales-month">{say('مستهدف الشهر','Monthly target')}: <bdi>{quantityNumber(row.monthTarget)}</bdi></p>}
  </li>)}</ul>
 </section>;
}

type Person=Pick<Member,'id'|'name'|'branch'|'active'|'role'>&{readOnly?:boolean};
/** The targets hub («نتائج الأداء»): the people of the hub's picker (the whole team of the branch chosen, or one person) from the payload the page
 *  already holds (GET /api/sales: the reader's own scope, regions and rights). The whole team: each person's own target (a computed roll-up of
 *  a supervisor or a manager is never added twice) and their sales; one person: their target as the cards show it, with the sales the month's
 *  achievement counts for them (a computed target: their team's). */
export default function TodaySalesCard({state,sales,members,month,staff,branch,hidden=[]}:{state:TargetState;sales:Sale[];members:Person[];month:string;staff:string;branch:string;hidden?:string[]}){
 const {language}=useLanguage(),say=(ar:string,en:string)=>language==='en'?en:ar;
 const scope=useMemo(()=>{
  const ids=targetProducts.map(product=>product.id),person=staff!=='all'?members.find(member=>member.id===staff):undefined;
  if(person){const set=effectiveSet<QuantityTargets>(state,'sales',person.id),people=new Set(set?.computed?set.teamMemberIds||[]:[person.id]);return {person:person.name,people,targets:addTargets([set?.data.products],ids)};}
  const hiddenIds=new Set(hidden),own=members.filter(member=>{const set=effectiveSet(state,'sales',member.id);return !member.readOnly&&!hiddenIds.has(member.id)&&(branch==='__all__'||member.branch===branch)&&!set?.computed&&(!!member.active||set?.month===state.month);});
  return {person:'',people:new Set(own.map(member=>member.id)),targets:addTargets(own.map(member=>effectiveSet<QuantityTargets>(state,'sales',member.id)?.data.products),ids)};
 },[state,members,staff,branch,hidden]);
 const label=scope.person||(branch==='__all__'?say('الفريق بالكامل','The whole team'):branch);
 return <DaySalesPanel key={month} month={month} scope={label} targets={scope.targets} headingId="hub-day-sales-heading" soldOn={date=>daySold(sales,scope.people,date)}/>;
}
