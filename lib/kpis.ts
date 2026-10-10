import {z} from 'zod';
import {type Member,type Row,today} from './crm';
import {type Sale} from './sales';
import {type ActivityTargets,type quantityAttainment} from './targets';
import {customerVisits,customerPlanSource,visitOrder} from './customer-visits';
import {type KpiEvidenceContext} from './kpi-evidence';
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
export const roundKpi=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
export const boundedScore=(n:number)=>Math.max(0,Math.min(100,n));
export type KpiMetric={id:IndicatorId;score:number|null;points:number|null;numerator:number|null;denominator:number|null;reason:string;source:'automatic'|'management'|'required';status?:'scored'|'missing'|'not_applicable'};
export function metric(id:IndicatorId,score:number|null,reason:string,source:KpiMetric['source']='automatic',numerator:number|null=null,denominator:number|null=null,status?:KpiMetric['status']):KpiMetric{const value=status==='not_applicable'||score===null||!Number.isFinite(score)?null:roundKpi(boundedScore(score));return{id,score:value,points:value===null?null:roundKpi(value*operationalIndicators.find(i=>i.id===id)!.weight/100),numerator,denominator,reason,source,status:status==='not_applicable'?'not_applicable':value===null?'missing':'scored'};}
export function kpiSummary(metrics:KpiMetric[]){let covered=0,earned=0,excludedWeight=0;for(const indicator of operationalIndicators){const m=metrics.find(m=>m.id===indicator.id);if(m?.status==='not_applicable'){covered+=indicator.weight;excludedWeight+=indicator.weight;}else if(m&&m.score!==null&&Number.isFinite(m.score)){covered+=indicator.weight;earned+=boundedScore(m.score)*indicator.weight/100;}}const applicableWeight=100-excludedWeight,complete=covered===100;return{covered,earned:roundKpi(earned),total:complete&&applicableWeight>0?roundKpi(earned/applicableWeight*100):null,complete,applicableWeight,excludedWeight};}
export function kpiPeriod(month:string){const first=month+'-01',now=today(),end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10),cutoff=end<now?end:now;const previous=new Date(first+'T12:00:00Z');previous.setUTCMonth(previous.getUTCMonth()-1);const prior=previous.toISOString().slice(0,7),days=new Date(Date.UTC(previous.getUTCFullYear(),previous.getUTCMonth()+1,0)).getUTCDate(),last=month===now.slice(0,7)?Math.min(Number(now.slice(8,10)),days):days;return{first,cutoff,previousFirst:prior+'-01',previousEnd:prior+'-'+String(last).padStart(2,'0')};}
export type KpiAssessment={memberId:string;month:string;input:KpiInput;version:number;updatedAt:string;updatedBy:string};
export type KpiPerformance={member:Member;sourceMemberIds:string[];salesSourceMemberIds:string[];teamRollup:boolean;activityTeamRollup:boolean;activityTargetsKnown?:boolean;activityTargets:ActivityTargets;attainment:ReturnType<typeof quantityAttainment>};
export type GrowthRow={product:string;actual:number|null;previous:number|null;weight:number|null;growth:number|null;contribution:number|null};
export type KpiPerson=KpiPerformance&{metrics:KpiMetric[];summary:ReturnType<typeof kpiSummary>;assessment:KpiAssessment|null;growthRows:GrowthRow[]};
export type KpiData={month:string;period:ReturnType<typeof kpiPeriod>;people:KpiPerson[];canManage:boolean};
export function prepareKpiRecords(records:Row[],month:string){
 const indexed=new Map(records.map(r=>[r.id,r])),customers=records.filter(r=>r.kind==='customer'),buckets=new Map<string,Row[]>(),customerIds=new Map<string,string>();
 for(const r of records){let root:Row|undefined=r;for(let n=0;root&&root.kind!=='customer'&&n<5;n++)root=root.parentId?indexed.get(root.parentId):undefined;if(root?.kind!=='customer')continue;customerIds.set(r.id,root.id);const bucket=buckets.get(root.id)||[];bucket.push(r);buckets.set(root.id,bucket);}
 const contacts=new Map(customers.map(c=>[c.id,customerVisits(c.id,buckets.get(c.id)||[]).reverse()])),plans=new Map(customers.map(c=>[c.id,customerPlanSource(c.id,buckets.get(c.id)||[])]));
 const period=kpiPeriod(month),formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'});
 const registrations=customers.filter(c=>{if(c.data.sourceFile||!c.createdAt)return false;const date=formatter.format(new Date(c.createdAt));return date>=period.first&&date<=period.cutoff;});
 return{customers,buckets,customerIds,contacts,plans,registrations};
}
export function calculateKpis(p:KpiPerformance,month:string,records:Row[],sales:Sale[],assessment:KpiAssessment|null,prepared=prepareKpiRecords(records,month),evidence?:KpiEvidenceContext){
 const period=kpiPeriod(month),ids=new Set(p.sourceMemberIds),saleIds=new Set(p.salesSourceMemberIds),input=assessment?.input||emptyKpiInput(),ratio=(a:number,b:number)=>b>0?a/b*100:null;
 if(evidence&&saleIds.size===0)evidence={...evidence,historyComplete:false,collection:null,quotationsComplete:false,recoveryTarget:null,invalidHistoryReason:'لا يوجد فريق مبيعات مؤهل لحساب المؤشرات.'};
 const invoices=sales.filter(s=>saleIds.has(s.repId)&&s.status==='confirmed'&&s.date>=period.first&&s.date<=period.cutoff),previous=sales.filter(s=>saleIds.has(s.repId)&&s.status==='confirmed'&&s.date>=period.previousFirst&&s.date<=period.previousEnd);
 // A verified complete sales period establishes a real zero for absent products.
 // Unconfirmed or incomplete imports must continue to display an unknown value.
 if(evidence?.historyComplete){
  const rows=p.attainment.rows.map(r=>{const actual=r.actual??0;return{...r,actual,achievement:r.target!==null&&r.target>0?actual/r.target*100:null,contribution:r.weight===0||r.target===0?0:r.weight!==null&&r.target!==null&&r.target>0?Math.min(1,Math.max(0,actual/r.target))*r.weight:null};});
  const validWeights=rows.every(r=>r.weight!==null)&&Math.abs(rows.reduce((n,r)=>n+(r.weight||0),0)-100)<.001,applicableWeight=validWeights?rows.reduce((n,r)=>n+(r.target===0?0:r.weight||0),0):null,ready=validWeights&&rows.every(r=>r.contribution!==null);
  p={...p,attainment:{...p.attainment,rows,applicableWeight,score:ready&&applicableWeight!==null&&applicableWeight>0?roundKpi(rows.reduce((n,r)=>n+(r.contribution||0),0)/applicableWeight*100):null,status:!validWeights?'weights_missing':ready&&applicableWeight===0?'not_applicable':ready?'ready':'missing_inputs'}};
 }
 const growthRows:GrowthRow[]=p.attainment.rows.map(r=>{const items=previous.flatMap(s=>s.items.filter(i=>i.product===r.id)),baseline=items.length?items.reduce((n,i)=>n+i.quantity,0):evidence?.historyComplete?0:null,growth=r.actual!==null&&baseline!==null&&baseline>0?(r.actual-baseline)/baseline*100:null;return{product:r.id,actual:r.actual,previous:baseline,weight:r.weight,growth:growth===null?null:roundKpi(growth),contribution:r.weight===0||evidence?.historyComplete&&baseline!==null&&baseline<=0?0:r.weight!==null&&growth!==null?growth*r.weight/100:null};});
 const growthWeightsValid=growthRows.every(r=>r.weight!==null)&&Math.abs(growthRows.reduce((n,r)=>n+(r.weight||0),0)-100)<.001,growthApplicableWeight=evidence?.historyComplete?growthRows.reduce((n,r)=>n+(r.previous!==null&&r.previous>0?r.weight||0:0),0):100;
 const growth=growthWeightsValid&&growthApplicableWeight>0&&growthRows.every(r=>r.contribution!==null)?growthRows.reduce((n,r)=>n+(r.contribution||0),0)/growthApplicableWeight*100:null;
 const countMetric=(id:IndicatorId,numerator:number|null,denominator:number|null,reason:string,source:KpiMetric['source']='automatic')=>metric(id,numerator!==null&&denominator!==null?ratio(numerator,denominator):null,reason,source,numerator,denominator,numerator!==null&&denominator===0?'not_applicable':undefined);
 const historyReason=evidence?.invalidHistoryReason||'أكد اكتمال سجل مبيعات الشهر والأشهر الثلاثة السابقة لحساب العملاء.';
 const purchaseMonths=new Map<string,{customerKey:string;date:string;netCents:number;hasSale:boolean}>();
 for(const purchase of evidence?.purchases||[]){if(!purchase.customerKey||!Number.isFinite(purchase.netCents)||purchase.date>period.cutoff)continue;const key=JSON.stringify([purchase.customerKey,purchase.date.slice(0,7)]),existing=purchaseMonths.get(key);purchaseMonths.set(key,{...purchase,date:purchase.date.slice(0,7)+'-01',netCents:(existing?.netCents||0)+purchase.netCents,hasSale:!!existing?.hasSale||purchase.hasSale});}
 const historyFrom=new Date(period.first+'T12:00:00Z');historyFrom.setUTCMonth(historyFrom.getUTCMonth()-3);const priorThreeFirst=historyFrom.toISOString().slice(0,10),buyers=new Set<string>(),priorBuyers=new Set<string>(),olderBuyers=new Set<string>();
 for(const purchase of purchaseMonths.values()){if(!purchase.hasSale||purchase.netCents<=0)continue;if(purchase.date>=period.first)buyers.add(purchase.customerKey);else if(purchase.date>=priorThreeFirst)priorBuyers.add(purchase.customerKey);else olderBuyers.add(purchase.customerKey);}
 const recovered=[...buyers].filter(id=>!priorBuyers.has(id)&&olderBuyers.has(id)).length,retained=[...priorBuyers].filter(id=>buyers.has(id)).length;
 const quotationMap=new Map<string,boolean>();for(const quote of evidence?.quotations||[])quotationMap.set(quote.quoteId,!!quotationMap.get(quote.quoteId)||quote.converted);const converted=[...quotationMap.values()].filter(Boolean).length;
 const collection=evidence?.collection,validCollection=!!collection&&Number.isFinite(collection.dueCents)&&Number.isFinite(collection.collectedCents)&&collection.dueCents>=0&&collection.collectedCents>=0&&(collection.dueCents>0||collection.collectedCents===0);
 const visits=records.filter(r=>r.kind==='activity'&&ids.has(r.data.performedBy||r.data.responsibleId)&&r.data.type==='visit'&&r.data.date>=period.first&&r.data.date<=period.cutoff);
 const stage=(r:Row|undefined)=>r?.data.salesStage||r?.data.stage||'new';
 const {customers,plans,registrations}=prepared;
 const positive=visits.filter(v=>{const id=prepared.customerIds.get(v.id);return id&&!['won','lost'].includes(stage(plans.get(id)));}).length;
 let qualified=0,quoted=0,lost=0,documented=0;
 for(const c of customers){const contacts=prepared.contacts.get(c.id)||[],first=contacts.find(r=>r.data.visitWorkflow!=='followup-v1');if(!first||!ids.has(first.data.performedBy||first.data.responsibleId)||first.data.date<period.first||first.data.date>period.cutoff)continue;const current=plans.get(c.id),currentStage=stage(current);
  if(currentStage==='lost'){lost++;if(String(current?.data.lossReason||current?.data.requestSnapshot?.lossReason||'').trim())documented++;continue;}
  if(currentStage==='won')continue;
  const qualification=contacts.find(r=>r.data.date<=period.cutoff&&['specs','technical'].includes(r.data.salesStage));if(!qualification)continue;qualified++;
  if(contacts.some(r=>r.data.date<=period.cutoff&&visitOrder(r)>=visitOrder(qualification)&&(r.data.salesStage==='quoted'||r.data.type==='quote'))||(prepared.buckets.get(c.id)||[]).some(r=>r.kind==='quote'&&r.data.date<=period.cutoff&&r.data.date>=qualification.data.date))quoted++;
 }
 const unknownRegistrations=registrations.some(c=>!c.data._createdBy),newCustomers=registrations.filter(c=>ids.has(c.data._createdBy)).length;
 // Returns reduce quantities and growth, but are not new sales invoices.
 const salesInvoices=invoices.filter(s=>s.documentType!=='return');
 const diverse=salesInvoices.filter(s=>new Set(s.items.map(i=>i.product)).size>=3).length;
 const metrics:KpiMetric[]=[
  metric('attainment',p.attainment.score,'تحقيق كميات الأصناف مرجحًا بأوزانها. تستبعد الأصناف ذات المستهدف صفر من الوزن المطبق.','automatic',null,null,p.attainment.status==='not_applicable'?'not_applicable':undefined),
  validCollection?countMetric('collection',collection!.collectedCents,collection!.dueCents,'المحصل ÷ المستحق وفق بيانات التحصيل المعتمدة؛ النتيجة بحد أقصى 100%.','management'):metric('collection',null,'أدخل المستحق والمحصل ومرجع بيانات التحصيل.','required'),
  metric('growth',growth,'نمو كميات الأصناف مقابل الفترة المناظرة من الشهر السابق؛ تستبعد الأصناف بلا أساس شراء موجب بعد تأكيد اكتمال السجل.','automatic',null,null,evidence?.historyComplete&&growthWeightsValid&&growthApplicableWeight===0?'not_applicable':undefined),
  countMetric('variety',diverse,salesInvoices.length,'فواتير البيع التي تشمل 3 أصناف مختلفة أو أكثر ÷ إجمالي فواتير البيع المسجلة غير الملغاة. تستبعد مستندات المرتجعات.'),
  countMetric('new_customers',unknownRegistrations||p.activityTargetsKnown===false?null:newCustomers,p.activityTargetsKnown===false?null:p.activityTargets.newCustomers,p.activityTargetsKnown===false?'مستهدفات النشاط غير مكتملة لهذا النطاق.':unknownRegistrations?'بعض العملاء القدامى لا يحملون هوية منشئهم؛ لا تُنسب إضافتهم للمسؤول الحالي بالتخمين.':'العملاء المضافون يدويًا بواسطة المندوب خلال الشهر ÷ مستهدف العملاء الجدد. يستبعد الاستيراد والتحديث وإعادة الإسناد.'),
  countMetric('recovered',evidence?.historyComplete?recovered:null,evidence?.recoveryTarget??null,evidence?.historyComplete?'عملاء اشتروا قديمًا، وتوقفوا ثلاثة أشهر كاملة، ثم عادوا للشراء هذا الشهر ÷ مستهدف الاسترداد.':historyReason,evidence?.historyComplete?'automatic':'required'),
  countMetric('retention',evidence?.historyComplete?retained:null,evidence?.historyComplete?priorBuyers.size:null,evidence?.historyComplete?'المشترون هذا الشهر من عملاء الأشهر الثلاثة السابقة ÷ جميع عملاء تلك الأشهر.':historyReason,evidence?.historyComplete?'automatic':'required'),
  countMetric('visits',p.activityTargetsKnown===false?null:visits.length,p.activityTargetsKnown===false?null:p.activityTargets.visits,p.activityTargetsKnown===false?'مستهدفات النشاط غير مكتملة لهذا النطاق.':'الزيارات المسجلة والمتابعات من نوع زيارة فقط ÷ مستهدف الزيارات.'),
  countMetric('positive',positive,visits.length,'زيارات الشهر المرتبطة بعملاء في مرحلة بيع مفتوحة حاليًا ÷ جميع زيارات الشهر، وفق تعريف gscoinvest.'),
  countMetric('quotes',quoted,qualified,'العملاء الذين بدأ تواصلهم في الشهر، وما زالوا في مرحلة مفتوحة، وتأهلوا بجمع المواصفات أو المراجعة الفنية: مَن سُجّل لهم عرض بعد التأهيل ÷ جميع المؤهلين.'),
  countMetric('orders',evidence?.quotationsComplete?converted:null,evidence?.quotationsComplete?quotationMap.size:null,evidence?.quotationsComplete?'عروض الشهر المرتبطة بفواتير بيع مؤكدة ÷ عروض الشهر المسندة للمندوب بعد تأكيد اكتمالها.':'حدد عروض الشهر واربط المحوّل منها بفواتير البيع، ثم أكد اكتمال القائمة.',evidence?.quotationsComplete?'automatic':'required'),
  countMetric('quality',input.correct,input.reviewed,'السجلات الصحيحة والمكتملة ÷ السجلات التي راجعتها الإدارة.','management'),
  countMetric('documentation',documented,lost,'العملاء الذين بدأ تواصلهم في الشهر ووصلوا للفقد مع سبب موثق ÷ جميع حالات الفقد لنفس المجموعة.'),
  ...conductKeys.map(id=>metric(id,input.conduct[id].score,'درجة الإدارة من صفر إلى 100 مع ملاحظة اختيارية.','management'))
 ];return{...p,metrics,summary:kpiSummary(metrics),assessment,growthRows};
}
