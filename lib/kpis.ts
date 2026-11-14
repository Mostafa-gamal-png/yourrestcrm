import {z} from 'zod';
import {type Member,type Row,today} from './crm';
import {type Sale} from './sales';
import {type ActivityTargets,type quantityAttainment} from './targets';
import {customerVisits,customerPlanSource,visitOrder} from './customer-visits';
import {type KpiEvidenceContext,type KpiQuotationDetail} from './kpi-evidence';
import {quotationRefKey} from './quotation-refs';
import {coverageReason,type CoverageMissing} from './sales-coverage';
import {newCustomerCredits,newCustomersOf,type ErpRepAttribution} from './new-customers';
export const operationalIndicators=[
 {id:'attainment',name:'تحقيق المستهدف البيعي',weight:25,axis:'sales'},
 {id:'collection',name:'التحصيل',weight:20,axis:'collection'},
 {id:'growth',name:'نمو مبيعات الأصناف',weight:5,axis:'products'},
 {id:'variety',name:'تعدد الأصناف داخل الفاتورة',weight:5,axis:'products'},
 {id:'new_customers',name:'العملاء الجدد',weight:5,axis:'customers'},
 {id:'recovered',name:'العملاء المستردون',weight:5,axis:'customers'},
 {id:'retention',name:'الحفاظ على العملاء الحاليين',weight:5,axis:'customers'},
 {id:'visits',name:'الزيارات الفعلية',weight:2,axis:'efficiency'},
 {id:'positive',name:'نسبة الزيارات الفعالة',weight:2,axis:'efficiency'},
 {id:'quotes',name:'معدل تحويل الفرص إلى عروض',weight:3,axis:'efficiency'},
 {id:'orders',name:'معدل تحويل عرض السعر إلى مبيعات',weight:3,axis:'efficiency'},
 {id:'quality',name:'دقة واكتمال البيانات',weight:5,axis:'data'},
 {id:'documentation',name:'توثيق أسباب الخسارة ومعلومات السوق والمنافسين',weight:5,axis:'data'},
 {id:'responsibility',name:'الالتزام والمسؤولية',weight:2,axis:'conduct'},
 {id:'teamwork',name:'التعاون والعمل الجماعي',weight:2,axis:'conduct'},
 {id:'honesty',name:'المصداقية والشفافية',weight:2,axis:'conduct'},
 {id:'professionalism',name:'السلوك المهني مع العميل',weight:2,axis:'conduct'},
 {id:'appearance',name:'المظهر العام وبناء صورة ذهنية جيدة عن الشركة',weight:2,axis:'conduct'}
] as const;
export const operationalAxes=[{id:'sales',name:'المبيعات والنمو',weight:25},{id:'collection',name:'التحصيل',weight:20},{id:'products',name:'نمو وتنوع الأصناف',weight:10},{id:'customers',name:'العملاء والسوق',weight:15},{id:'efficiency',name:'الكفاءة والإنتاجية',weight:10},{id:'conduct',name:'السلوك والالتزام المهني',weight:10},{id:'data',name:'جودة البيانات وإدارة الأعمال',weight:10}] as const;
export const conductKeys=['responsibility','teamwork','honesty','professionalism','appearance'] as const;
export type IndicatorId=typeof operationalIndicators[number]['id'];
const grade=z.object({score:z.number().finite().min(0).max(100).multipleOf(.01).nullable(),note:z.string().trim().max(2000)}).strict();
const count=z.number().int().min(0).max(1000000).nullable();
export const kpiInputSchema=z.object({reviewed:count,correct:count,review_note:z.string().trim().max(2000),conduct:z.object({responsibility:grade,teamwork:grade,honesty:grade,professionalism:grade,appearance:grade}).strict()}).strict().refine(v=>v.reviewed===null?v.correct===null:v.correct!==null&&v.correct<=v.reviewed,'راجع أعداد السجلات الصحيحة والمراجعة.');
export type KpiInput=z.infer<typeof kpiInputSchema>;
export const emptyKpiInput=():KpiInput=>({reviewed:null,correct:null,review_note:'',conduct:{responsibility:{score:null,note:''},teamwork:{score:null,note:''},honesty:{score:null,note:''},professionalism:{score:null,note:''},appearance:{score:null,note:''}}});
/** «طريقة الحساب» of «العملاء الجدد» (lib/new-customers.ts newCustomerCredits). */
export const NEW_CUSTOMERS_REASON='العملاء الجدد خلال الشهر ÷ مستهدف العملاء الجدد. يُحتسب العميل مرة واحدة: إذا أضافه المندوب يدويًا في التطبيق خلال الشهر نُسب إليه، وإلا إذا وقع تاريخ إنشائه في ERP (عمود «التاريخ» في ملف عملاء ERP) خلال الشهر نُسب إلى مندوب الملف إن ذكره الملف وأمكن ربطه بمستخدم في النظام، وإلا إلى المسؤول الحالي عن العميل في النظام، لأن ملف العملاء الحالي لا يحتوي عمود المندوب. لا يُحتسب عملاء «مبيعات مكتب»، ولا يُعدّ الاستيراد ولا تحديث البيانات إضافةً يدوية.';
export const roundKpi=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
export const boundedScore=(n:number)=>Math.max(0,Math.min(100,n));
/** missing: present only while a KPI waits for complete ERP sales imports (lib/sales-coverage.ts): the months to upload, so the page
 *  writes them in the reader's language (kpiMetricReason); reason holds the same in Arabic. */
export type KpiMetric={id:IndicatorId;score:number|null;points:number|null;numerator:number|null;denominator:number|null;reason:string;source:'automatic'|'management'|'required';status?:'scored'|'missing'|'not_applicable';missing?:CoverageMissing};
/** The text of a KPI's «طريقة الحساب / البيانات المطلوبة» in the reader's language. */
export function kpiMetricReason(m:Pick<KpiMetric,'reason'|'missing'>,translate:(value:string)=>string,language:'ar'|'en'='ar'){return m.missing&&language==='en'?coverageReason(m.missing,'en'):translate(m.reason);}
export function metric(id:IndicatorId,score:number|null,reason:string,source:KpiMetric['source']='automatic',numerator:number|null=null,denominator:number|null=null,status?:KpiMetric['status']):KpiMetric{const value=status==='not_applicable'||score===null||!Number.isFinite(score)?null:roundKpi(boundedScore(score));return{id,score:value,points:value===null?null:roundKpi(value*operationalIndicators.find(i=>i.id===id)!.weight/100),numerator,denominator,reason,source,status:status==='not_applicable'?'not_applicable':value===null?'missing':'scored'};}
/** The overall score (the owner, 2026-11-14, as the company's other CRM, GSCO: «الدرجة من الموجود»): missing data is not a zero. total =
 *  the points earned ÷ the weight that has data (the weight of «لا ينطبق» left out) × 100, whenever some weight has data; complete only
 *  when every indicator has data or does not apply. dataShare: the weight with data as a percent of the applicable weight; missing: the
 *  indicators without data, in their canonical order. inactive (a representative with no activity in a closed, covered month: calculateKpis):
 *  out of the evaluation, so no total, and nothing compares or averages it. */
export function kpiSummary(metrics:KpiMetric[],inactive=false){let covered=0,earned=0,excludedWeight=0;const missing:IndicatorId[]=[];for(const indicator of operationalIndicators){const m=metrics.find(m=>m.id===indicator.id);if(m?.status==='not_applicable'){covered+=indicator.weight;excludedWeight+=indicator.weight;}else if(m&&m.score!==null&&Number.isFinite(m.score)){covered+=indicator.weight;earned+=boundedScore(m.score)*indicator.weight/100;}else missing.push(indicator.id);}const applicableWeight=100-excludedWeight,scoredWeight=covered-excludedWeight,complete=covered===100;return{covered,earned:roundKpi(earned),total:!inactive&&scoredWeight>0?roundKpi(earned/scoredWeight*100):null,complete,applicableWeight,excludedWeight,scoredWeight,dataShare:applicableWeight>0?roundKpi(scoredWeight/applicableWeight*100):0,missing,inactive};}
export type KpiSummary=ReturnType<typeof kpiSummary>;
/** «دقة واكتمال البيانات», automatically (the owner, 2026-11-14: «دقة البيانات تلقائي»): the seven fields every customer record of the
 *  person needs (the customers whose responsible is one of sourceMemberIds). The place is the location, the short address or the address. */
export const qualityFields=[['name','الاسم'],['region','المنطقة'],['city','المدينة'],['phone','الهاتف'],['contact','اسم المسؤول'],['customerKind','نوع العميل'],['place','الموقع']] as const;
const filled=(value:unknown)=>typeof value==='string'?value.trim()!=='':typeof value==='number'&&Number.isFinite(value);
export function customerFilledFields(data:Record<string,unknown>|null|undefined){const d=data||{};return qualityFields.filter(([key])=>key==='place'?filled(d.location)||filled(d.shortAddress)||filled(d.address)||(filled(d.latitude)&&filled(d.longitude)):filled(d[key])).length;}
export const QUALITY_REASON='عملاء المندوب المسندون إليه في النظام: الحقول المكتملة ÷ (عدد العملاء × 7). الحقول السبعة: الاسم، والمنطقة، والمدينة، والهاتف، واسم المسؤول، ونوع العميل، والموقع (اللوكيشن أو العنوان المختصر أو العنوان). يُحسب تلقائيًا من بيانات العملاء الحالية، ولا ينطبق على من ليس له عملاء.';
export const POSITIVE_REASON='زيارات الشهر لعملاء مرحلتهم الحالية ليست «تم الفقد» ÷ جميع زيارات الشهر. تُعدّ زيارة العميل الذي تم الفوز به فعالة.';
export const INACTIVE_TEXT='بلا نشاط في هذا الشهر – خارج التقييم';
export function kpiPeriod(month:string){const first=month+'-01',now=today(),end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10),cutoff=end<now?end:now;const previous=new Date(first+'T12:00:00Z');previous.setUTCMonth(previous.getUTCMonth()-1);const prior=previous.toISOString().slice(0,7),days=new Date(Date.UTC(previous.getUTCFullYear(),previous.getUTCMonth()+1,0)).getUTCDate(),last=month===now.slice(0,7)?Math.min(Number(now.slice(8,10)),days):days;return{first,cutoff,previousFirst:prior+'-01',previousEnd:prior+'-'+String(last).padStart(2,'0')};}
export type KpiAssessment={memberId:string;month:string;input:KpiInput;version:number;updatedAt:string;updatedBy:string};
/** activityTargetsDefault: no customers-and-visits target saved for the person this month or carried from an earlier one, so the
 *  defaults of lib/targets.ts apply (the page writes «افتراضي» beside them). */
export type KpiPerformance={member:Member;sourceMemberIds:string[];salesSourceMemberIds:string[];teamRollup:boolean;activityTeamRollup:boolean;activityTargetsKnown?:boolean;activityTargetsDefault?:boolean;activityTargets:ActivityTargets;attainment:ReturnType<typeof quantityAttainment>};
export type GrowthRow={product:string;actual:number|null;previous:number|null;weight:number|null;growth:number|null;contribution:number|null};
/** quotations: the month's quotations of «معدل تحويل عرض السعر إلى مبيعات», each once, converted or not (empty when unknown). */
/** inactive: «بلا نشاط في هذا الشهر – خارج التقييم» (summary.inactive too): shown with that sentence instead of a score. */
export type KpiPerson=KpiPerformance&{metrics:KpiMetric[];summary:ReturnType<typeof kpiSummary>;inactive:boolean;assessment:KpiAssessment|null;growthRows:GrowthRow[];quotations:KpiQuotation[]};
export type KpiQuotation={quoteId:string;converted:boolean}&KpiQuotationDetail;
/** A quotation of the month, attributed to one representative (the author of the quote record, or whom «بيانات المؤشرات» assigned it to),
 *  with the invoices a manager linked to it by hand (already checked: a confirmed sale of that representative, of its customer, on or after
 *  it, within the evaluation period). */
export type KpiQuoteCandidate={quoteId:string;number:string;date:string;repId:string;customerName:string;manualInvoices:string[]};
/** A confirmed ERP sales invoice (not a return, a positive total) whose «الوصف» names quotations. */
export type KpiQuoteInvoice={id:string;reference:string;repId:string;date:string;quotationRefs:string[]};
/** «معدل تحويل عرض السعر إلى مبيعات», automatically: a quotation converted when an ERP sales invoice of the same representative, dated on
 *  or after it, names its number in «الوصف» (any later day: a quotation of a finished month still converts when it is invoiced after
 *  the month), or when a manager linked it to a sale. A manual link adds a conversion and never removes one; a quotation without a
 *  link stays unconverted. Pure: lib/kpis-server.ts gives it the quotations and the invoices the reader's scope holds. */
export function quoteConversions(quotes:KpiQuoteCandidate[],invoices:KpiQuoteInvoice[]):KpiQuotation[]{
 const byRef=new Map<string,KpiQuoteInvoice[]>();
 for(const invoice of invoices)for(const ref of new Set(invoice.quotationRefs)){const list=byRef.get(ref)||[];list.push(invoice);byRef.set(ref,list);}
 return quotes.map(q=>{
  const key=quotationRefKey(q.number);
  const matched=key?(byRef.get(key)||[]).filter(invoice=>invoice.repId===q.repId&&invoice.date>=q.date):[];
  const references=[...new Set([...matched.map(invoice=>invoice.reference),...q.manualInvoices])].sort((a,b)=>a.localeCompare(b,'en'));
  const via:KpiQuotation['via']=[...(matched.length?['description' as const]:[]),...(q.manualInvoices.length?['manual' as const]:[])];
  return {quoteId:q.quoteId,number:q.number,date:q.date,repId:q.repId,customerName:q.customerName,converted:references.length>0,invoices:references,via};
 });
}
export type KpiData={month:string;period:ReturnType<typeof kpiPeriod>;people:KpiPerson[];canManage:boolean};
/** `attribute` names the CRM member of a customer's ERP representative (lib/new-customers.ts); without it a customer with an ERP date
 *  is credited to its current responsible. */
export function prepareKpiRecords(records:Row[],month:string,attribute?:ErpRepAttribution){
 const indexed=new Map(records.map(r=>[r.id,r])),customers=records.filter(r=>r.kind==='customer'),buckets=new Map<string,Row[]>(),customerIds=new Map<string,string>();
 for(const r of records){let root:Row|undefined=r;for(let n=0;root&&root.kind!=='customer'&&n<5;n++)root=root.parentId?indexed.get(root.parentId):undefined;if(root?.kind!=='customer')continue;customerIds.set(r.id,root.id);const bucket=buckets.get(root.id)||[];bucket.push(r);buckets.set(root.id,bucket);}
 const contacts=new Map(customers.map(c=>[c.id,customerVisits(c.id,buckets.get(c.id)||[]).reverse()])),plans=new Map(customers.map(c=>[c.id,customerPlanSource(c.id,buckets.get(c.id)||[])]));
 // «العملاء الجدد»: added by hand in the month, or created in the ERP in the month (lib/new-customers.ts), each customer once.
 const newCustomers=newCustomerCredits(customers,kpiPeriod(month),attribute);
 return{customers,buckets,customerIds,contacts,plans,newCustomers};
}
export function calculateKpis(p:KpiPerformance,month:string,records:Row[],sales:Sale[],assessment:KpiAssessment|null,prepared=prepareKpiRecords(records,month),evidence?:KpiEvidenceContext){
 const period=kpiPeriod(month),ids=new Set(p.sourceMemberIds),saleIds=new Set(p.salesSourceMemberIds),input=assessment?.input||emptyKpiInput(),ratio=(a:number,b:number)=>b>0?a/b*100:null;
 if(evidence&&saleIds.size===0)evidence={...evidence,historyComplete:false,coverage:undefined,collection:null,quotationsKnown:false,quotations:[],recoveryTarget:null,invalidHistoryReason:'لا يوجد فريق مبيعات مؤهل لحساب المؤشرات.'};
 const invoices=sales.filter(s=>saleIds.has(s.repId)&&s.status==='confirmed'&&s.date>=period.first&&s.date<=period.cutoff),previous=sales.filter(s=>saleIds.has(s.repId)&&s.status==='confirmed'&&s.date>=period.previousFirst&&s.date<=period.previousEnd);
 // The sales history is complete by the manual confirmation of «بيانات المؤشرات» (all three KPIs at once, as before), or KPI by KPI
 // by the complete ERP sales imports (lib/sales-coverage.ts): retention and recovered also need the customers' codes to be known.
 const manualHistory=!!evidence?.historyComplete,coverage=evidence?.coverage,identitiesKnown=evidence?.identitiesKnown!==false;
 const zeroFill=manualHistory||!!coverage?.current,growthReady=manualHistory||!!coverage?.growth,retentionReady=manualHistory||!!coverage?.retention&&identitiesKnown,recoveredReady=manualHistory||!!coverage?.recovered&&identitiesKnown;
 // A verified complete sales period establishes a real zero for absent products.
 // Unconfirmed or incomplete imports must continue to display an unknown value.
 if(zeroFill){
  const rows=p.attainment.rows.map(r=>{const actual=r.actual??0;return{...r,actual,achievement:r.target!==null&&r.target>0?actual/r.target*100:null,contribution:r.weight===0||r.target===0?0:r.weight!==null&&r.target!==null&&r.target>0?Math.min(1,Math.max(0,actual/r.target))*r.weight:null};});
  const validWeights=rows.every(r=>r.weight!==null)&&Math.abs(rows.reduce((n,r)=>n+(r.weight||0),0)-100)<.001,applicableWeight=validWeights?rows.reduce((n,r)=>n+(r.target===0?0:r.weight||0),0):null,ready=validWeights&&rows.every(r=>r.contribution!==null);
  p={...p,attainment:{...p.attainment,rows,applicableWeight,score:ready&&applicableWeight!==null&&applicableWeight>0?roundKpi(rows.reduce((n,r)=>n+(r.contribution||0),0)/applicableWeight*100):null,status:!validWeights?'weights_missing':ready&&applicableWeight===0?'not_applicable':ready?'ready':'missing_inputs'}};
 }
 const growthRows:GrowthRow[]=p.attainment.rows.map(r=>{const items=previous.flatMap(s=>s.items.filter(i=>i.product===r.id)),baseline=items.length?items.reduce((n,i)=>n+i.quantity,0):growthReady?0:null,growth=r.actual!==null&&baseline!==null&&baseline>0?(r.actual-baseline)/baseline*100:null;return{product:r.id,actual:r.actual,previous:baseline,weight:r.weight,growth:growth===null?null:roundKpi(growth),contribution:r.weight===0||growthReady&&baseline!==null&&baseline<=0?0:r.weight!==null&&growth!==null?growth*r.weight/100:null};});
 const growthWeightsValid=growthRows.every(r=>r.weight!==null)&&Math.abs(growthRows.reduce((n,r)=>n+(r.weight||0),0)-100)<.001,growthApplicableWeight=growthReady?growthRows.reduce((n,r)=>n+(r.previous!==null&&r.previous>0?r.weight||0:0),0):100;
 const growth=growthWeightsValid&&growthApplicableWeight>0&&growthRows.every(r=>r.contribution!==null)?growthRows.reduce((n,r)=>n+(r.contribution||0),0)/growthApplicableWeight*100:null;
 const countMetric=(id:IndicatorId,numerator:number|null,denominator:number|null,reason:string,source:KpiMetric['source']='automatic')=>metric(id,numerator!==null&&denominator!==null?ratio(numerator,denominator):null,reason,source,numerator,denominator,numerator!==null&&denominator===0?'not_applicable':undefined);
 const historyReason=evidence?.invalidHistoryReason||'أكد اكتمال سجل مبيعات الشهر والأشهر الثلاثة السابقة لحساب العملاء.';
 // While the imports leave months uncovered, the KPI names them (and keeps them in `missing` for the English page); covered months whose
 // customer codes are unknown keep the identity reason. When the imports complete it, the reason says up to which day.
 const waiting=(kind:'growth'|'retention'|'recovered',ready:boolean,fallback:string):{reason:string;missing?:CoverageMissing}=>{
  if(ready||manualHistory||!coverage||coverage[kind])return {reason:fallback};
  return {reason:coverageReason(coverage.missing[kind]),missing:coverage.missing[kind]};
 };
 const automaticNote=(kind:'growth'|'retention'|'recovered')=>!manualHistory&&coverage?.[kind]?(coverage.through&&coverage.through<period.cutoff?' • سجل المبيعات مكتمل تلقائيًا من رفع ERP حتى '+coverage.through+'.':' • سجل المبيعات مكتمل تلقائيًا من رفع مبيعات ERP الكاملة.'):'';
 const withMissing=(m:KpiMetric,state:{missing?:CoverageMissing})=>state.missing?{...m,missing:state.missing}:m;
 const purchaseMonths=new Map<string,{customerKey:string;date:string;netCents:number;hasSale:boolean}>();
 for(const purchase of evidence?.purchases||[]){if(!purchase.customerKey||!Number.isFinite(purchase.netCents)||purchase.date>period.cutoff)continue;const key=JSON.stringify([purchase.customerKey,purchase.date.slice(0,7)]),existing=purchaseMonths.get(key);purchaseMonths.set(key,{...purchase,date:purchase.date.slice(0,7)+'-01',netCents:(existing?.netCents||0)+purchase.netCents,hasSale:!!existing?.hasSale||purchase.hasSale});}
 const historyFrom=new Date(period.first+'T12:00:00Z');historyFrom.setUTCMonth(historyFrom.getUTCMonth()-3);const priorThreeFirst=historyFrom.toISOString().slice(0,10),buyers=new Set<string>(),priorBuyers=new Set<string>(),olderBuyers=new Set<string>();
 for(const purchase of purchaseMonths.values()){if(!purchase.hasSale||purchase.netCents<=0)continue;if(purchase.date>=period.first)buyers.add(purchase.customerKey);else if(purchase.date>=priorThreeFirst)priorBuyers.add(purchase.customerKey);else olderBuyers.add(purchase.customerKey);}
 const recovered=[...buyers].filter(id=>!priorBuyers.has(id)&&olderBuyers.has(id)).length,retained=[...priorBuyers].filter(id=>buyers.has(id)).length;
 // Each quotation once; converted when any of its entries converted.
 const quotationMap=new Map<string,KpiQuotation>();
 for(const quote of evidence?.quotationsKnown?evidence.quotations:[]){const prior=quotationMap.get(quote.quoteId),invoices=[...new Set([...(prior?.invoices||[]),...(quote.invoices||[])])],via=[...new Set([...(prior?.via||[]),...(quote.via||[])])];quotationMap.set(quote.quoteId,{number:'',date:'',repId:'',customerName:'',...prior,...quote,converted:!!prior?.converted||quote.converted,invoices,via});}
 const converted=[...quotationMap.values()].filter(q=>q.converted).length;
 const collection=evidence?.collection,validCollection=!!collection&&Number.isFinite(collection.dueCents)&&Number.isFinite(collection.collectedCents)&&collection.dueCents>=0&&collection.collectedCents>=0&&(collection.dueCents>0||collection.collectedCents===0);
 const visits=records.filter(r=>r.kind==='activity'&&ids.has(r.data.performedBy||r.data.responsibleId)&&r.data.type==='visit'&&r.data.date>=period.first&&r.data.date<=period.cutoff);
 const stage=(r:Row|undefined)=>r?.data.salesStage||r?.data.stage||'new';
 const {customers,plans}=prepared;
 // «نسبة الزيارات الفعالة» (the owner, 2026-11-14: «البيع يتحسب فعالة»): a visit is effective unless its customer is lost now; won counts.
 const positive=visits.filter(v=>{const id=prepared.customerIds.get(v.id);return id&&stage(plans.get(id))!=='lost';}).length;
 // «دقة واكتمال البيانات»: the filled fields of the person's customers out of seven each.
 const ownCustomers=customers.filter(c=>ids.has(c.assignedTo)),filledFields=ownCustomers.reduce((n,c)=>n+customerFilledFields(c.data),0);
 let qualified=0,quoted=0,lost=0,documented=0;
 for(const c of customers){const contacts=prepared.contacts.get(c.id)||[],first=contacts.find(r=>r.data.visitWorkflow!=='followup-v1');if(!first||!ids.has(first.data.performedBy||first.data.responsibleId)||first.data.date<period.first||first.data.date>period.cutoff)continue;const current=plans.get(c.id),currentStage=stage(current);
  if(currentStage==='lost'){lost++;if(String(current?.data.lossReason||current?.data.requestSnapshot?.lossReason||'').trim())documented++;continue;}
  if(currentStage==='won')continue;
  const qualification=contacts.find(r=>r.data.date<=period.cutoff&&['specs','technical'].includes(r.data.salesStage));if(!qualification)continue;qualified++;
  if(contacts.some(r=>r.data.date<=period.cutoff&&visitOrder(r)>=visitOrder(qualification)&&(r.data.salesStage==='quoted'||r.data.type==='quote'))||(prepared.buckets.get(c.id)||[]).some(r=>r.kind==='quote'&&r.data.date<=period.cutoff&&r.data.date>=qualification.data.date))quoted++;
 }
 const unknownRegistrations=prepared.newCustomers.unknown,newCustomers=newCustomersOf(prepared.newCustomers.credits,ids);
 // Returns reduce quantities and growth, but are not new sales invoices.
 const salesInvoices=invoices.filter(s=>s.documentType!=='return');
 const diverse=salesInvoices.filter(s=>new Set(s.items.map(i=>i.product)).size>=3).length;
 const metrics:KpiMetric[]=[
  metric('attainment',p.attainment.score,'تحقيق كميات الأصناف مرجحًا بأوزانها. تستبعد الأصناف ذات المستهدف صفر من الوزن المطبق.','automatic',null,null,p.attainment.status==='not_applicable'?'not_applicable':undefined),
  validCollection?countMetric('collection',collection!.collectedCents,collection!.dueCents,'المحصل ÷ المستحق وفق بيانات التحصيل المعتمدة؛ النتيجة بحد أقصى 100%.','management'):metric('collection',null,'أدخل المستحق والمحصل ومرجع بيانات التحصيل.','required'),
  (()=>{const state=growth===null&&growthWeightsValid?waiting('growth',growthReady,''):{reason:''};return withMissing(metric('growth',growth,state.missing?state.reason:'نمو كميات الأصناف مقابل الفترة المناظرة من الشهر السابق؛ تستبعد الأصناف بلا أساس شراء موجب بعد تأكيد اكتمال السجل.'+automaticNote('growth'),state.missing?'required':'automatic',null,null,growthReady&&growthWeightsValid&&growthApplicableWeight===0?'not_applicable':undefined),state);})(),
  countMetric('variety',diverse,salesInvoices.length,'فواتير البيع التي تشمل 3 أصناف مختلفة أو أكثر ÷ إجمالي فواتير البيع المسجلة غير الملغاة. تستبعد مستندات المرتجعات.'),
  countMetric('new_customers',unknownRegistrations||p.activityTargetsKnown===false?null:newCustomers,p.activityTargetsKnown===false?null:p.activityTargets.newCustomers,p.activityTargetsKnown===false?'مستهدفات النشاط غير مكتملة لهذا النطاق.':unknownRegistrations?'بعض العملاء المضافين في الشهر لا يحملون هوية منشئهم ولا تاريخ إنشائهم في ERP؛ لا تُنسب إضافتهم للمسؤول الحالي بالتخمين.':NEW_CUSTOMERS_REASON),
  (()=>{const state=waiting('recovered',recoveredReady,historyReason);return withMissing(countMetric('recovered',recoveredReady?recovered:null,evidence?.recoveryTarget??null,recoveredReady?'عملاء اشتروا قديمًا، وتوقفوا ثلاثة أشهر كاملة، ثم عادوا للشراء هذا الشهر ÷ مستهدف الاسترداد.'+automaticNote('recovered'):state.reason,recoveredReady?'automatic':'required'),state);})(),
  (()=>{const state=waiting('retention',retentionReady,historyReason);return withMissing(countMetric('retention',retentionReady?retained:null,retentionReady?priorBuyers.size:null,retentionReady?'المشترون هذا الشهر من عملاء الأشهر الثلاثة السابقة ÷ جميع عملاء تلك الأشهر.'+automaticNote('retention'):state.reason,retentionReady?'automatic':'required'),state);})(),
  countMetric('visits',p.activityTargetsKnown===false?null:visits.length,p.activityTargetsKnown===false?null:p.activityTargets.visits,p.activityTargetsKnown===false?'مستهدفات النشاط غير مكتملة لهذا النطاق.':'الزيارات المسجلة والمتابعات من نوع زيارة فقط ÷ مستهدف الزيارات.'),
  countMetric('positive',positive,visits.length,POSITIVE_REASON),
  countMetric('quotes',quoted,qualified,'العملاء الذين بدأ تواصلهم في الشهر، وما زالوا في مرحلة مفتوحة، وتأهلوا بجمع المواصفات أو المراجعة الفنية: مَن سُجّل لهم عرض بعد التأهيل ÷ جميع المؤهلين.'),
  countMetric('orders',evidence?.quotationsKnown?converted:null,evidence?.quotationsKnown?quotationMap.size:null,evidence?.quotationsKnown?'عروض الأسعار الصادرة في الشهر والمسندة للمندوب (المرسلة والمقبولة والمرفوضة، ومنها المستوردة من ERP): المحوَّل منها ÷ جميعها. يُعدّ العرض محوَّلًا إذا ذكر عمود «الوصف» رقمه في فاتورة بيع مؤكدة من ERP للمندوب نفسه بتاريخ العرض أو بعده، أو إذا ربطته الإدارة بفاتورة بيع في «بيانات المؤشرات». لا تُحتسب المرتجعات.':'لا يوجد فريق مبيعات مؤهل لحساب المؤشر.',evidence?.quotationsKnown?'automatic':'required'),
  countMetric('quality',filledFields,ownCustomers.length*qualityFields.length,QUALITY_REASON),
  countMetric('documentation',documented,lost,'العملاء الذين بدأ تواصلهم في الشهر ووصلوا للفقد مع سبب موثق ÷ جميع حالات الفقد لنفس المجموعة.'),
  ...conductKeys.map(id=>metric(id,input.conduct[id].score,'درجة الإدارة من صفر إلى 100 مع ملاحظة اختيارية.','management'))
 ];
 // «بلا نشاط في هذا الشهر – خارج التقييم» (the owner, 2026-11-14: «مندوب بلا نشاط يطلع برّه»): a representative with no visit, follow-up or
 // other contact of their own and no confirmed sales document in a closed month whose sales are known complete (the ERP imports cover the
 // month, or «بيانات المؤشرات» confirmed the history) is out of the evaluation. Managers' and supervisors' rollups never are.
 const activity=records.some(r=>r.kind==='activity'&&ids.has(r.data.performedBy||r.data.responsibleId)&&r.data.date>=period.first&&r.data.date<=period.cutoff);
 const inactive=p.member.role==='rep'&&period.cutoff<today()&&zeroFill&&!activity&&invoices.length===0;
 return{...p,metrics,summary:kpiSummary(metrics,inactive),inactive,assessment,growthRows,quotations:[...quotationMap.values()]};
}
