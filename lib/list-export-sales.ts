// «تصدير Excel» of the tabs «التحصيل» and «عروض الأسعار» of «المستهدفات وتقييم الأداء» (lib/list-export.ts; the owner, 2026-11-19, GSCO
// 2.13.80): the people the tab lists after its branch, representative and search (app/sales-workspace.tsx filteredKpiPeople), each with
// what the page shows of them (app/kpi-evidence-panel.tsx), and in «عروض الأسعار» the converted quotations with their invoices. Amounts in
// riyals and shares in percent are number cells; «لا ينطبق» and «غير مكتمل» are words where the page writes them. Pure, types only.
import {exportTable,numberCell,sayIn,type ExportColumn,type ExportLanguage,type ExportTable} from './list-export';
import type {KpiData,KpiMetric} from './kpis';

type Person=KpiData['people'][number];
const metricOf=(person:Person,id:KpiMetric['id'])=>person.metrics.find(metric=>metric.id===id);
const round=(value:number|null|undefined,places=2)=>typeof value==='number'&&Number.isFinite(value)?Math.round(value*10**places)/10**places:null;

/** The people of «التحصيل» (and their collection) or of «عروض الأسعار» (their quotations and the converted ones). */
export function evidenceTables(kind:'collection'|'quotes',people:readonly Person[],language:ExportLanguage,roleName:(role:string)=>string):ExportTable[]{
 const say=sayIn(language),notApplicable=say('لا ينطبق','Not applicable'),incomplete=say('غير مكتمل','Incomplete');
 const figure=(metric:KpiMetric|undefined,value:number|null|undefined)=>metric?.status==='not_applicable'?notApplicable:value===null||value===undefined?'':numberCell(round(value));
 const share=(metric:KpiMetric|undefined)=>metric?.status==='not_applicable'?notApplicable:metric?.score==null?incomplete:numberCell(round(metric.score));
 const who:ExportColumn<Person>[]=[['المندوب','Representative',p=>p.member.name],['الدور','Role',p=>roleName(p.member.role)],['الفرع','Branch',p=>p.member.branch||'']];
 if(kind==='collection'){
  const columns:ExportColumn<Person>[]=[...who,
   ['المستحق (ر.س)','Due (SAR)',p=>{const m=metricOf(p,'collection');return figure(m,m?.denominator==null?null:m.denominator/100);}],
   ['المحصل (ر.س)','Collected (SAR)',p=>{const m=metricOf(p,'collection');return figure(m,m?.numerator==null?null:m.numerator/100);}],
   ['نسبة التحصيل %','Collection rate %',p=>share(metricOf(p,'collection'))],['النقاط من 20','Points out of 20',p=>{const m=metricOf(p,'collection');return figure(m,m?.points);}],
  ];
  return [exportTable(['التحصيل','Collection'],columns,people,language)];
 }
 const columns:ExportColumn<Person>[]=[...who,
  ['الفرص المسجلة','Opportunities recorded',p=>{const m=metricOf(p,'quotes');return figure(m,m?.denominator);}],['الفرص التي لها عرض سعر','Opportunities with a quotation',p=>{const m=metricOf(p,'quotes');return figure(m,m?.numerator);}],
  ['تحويل الفرص إلى عروض %','Opportunities to quotations %',p=>share(metricOf(p,'quotes'))],['عروض الشهر','Quotations this month',p=>{const m=metricOf(p,'orders');return figure(m,m?.denominator);}],
  ['المحوَّلة إلى مبيعات','Converted to sales',p=>{const m=metricOf(p,'orders');return figure(m,m?.numerator);}],['نسبة التحويل %','Conversion rate %',p=>share(metricOf(p,'orders'))],
  ['نقاط تحويل الفرص من 3','Opportunity points out of 3',p=>{const m=metricOf(p,'quotes');return figure(m,m?.points);}],['نقاط التحويل إلى مبيعات من 3','Conversion points out of 3',p=>{const m=metricOf(p,'orders');return figure(m,m?.points);}],
 ];
 const converted=people.flatMap(person=>(person.quotations||[]).filter(quote=>quote.converted).map(quote=>({person,quote})));
 const conversions:ExportColumn<(typeof converted)[number]>[]=[
  ['المندوب','Representative',x=>x.person.member.name],['رقم العرض','Quotation number',x=>x.quote.number||x.quote.quoteId],['العميل','Customer',x=>x.quote.customerName],
  ['الفواتير','Invoices',x=>x.quote.invoices.join(language==='en'?', ':'، ')],['الربط','Link',x=>x.quote.via.includes('manual')&&!x.quote.via.includes('description')?say('ربط يدوي','Manual link'):say('من وصف الفاتورة','From the invoice description')],
 ];
 return [exportTable(['عروض الأسعار','Quotations'],columns,people,language),exportTable(['العروض المحوَّلة','Converted quotations'],conversions,converted,language)];
}
