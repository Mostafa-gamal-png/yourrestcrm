// The evaluation's numbers (lib/kpis.ts), unit by unit on the real modules compiled into .sites-runtime (scripts/lib/load-ts.mjs), for the
// edges an independent mutation review (2026-11-22) found no test held: a negative score kept at zero, the management form's limits, a
// customer's place from one coordinate, the previous month's matching days while the month runs, a quotation invoiced on its own day, a
// voided invoice in «تعدد الأصناف», product weights that do not reach 100%, a loss without its reason, «مراجعة فنية» as qualification,
// and a purchase on the cutoff day. The clock is held (Riyadh, 2026-11-16 12:00); made-up people, products and amounts only.
import assert from 'node:assert/strict';
import {createLoader,makeChecks} from '../scripts/lib/load-ts.mjs';

const RealDate=Date;let held=RealDate.parse('2026-11-16T09:00:00.000Z');
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[held]));}static now(){return held;}};
process.on('exit',()=>{globalThis.Date=RealDate;});
const {load}=createLoader('kpi-rules-unit');
const K=await load('lib/kpis.ts'),T=await load('lib/targets.ts');
const {eq,ok,report}=makeChecks(assert);
const get=(result,id)=>result.metrics.find(m=>m.id===id);

// ---- metric: a score below zero (a fall in growth) is zero, never negative points.
eq([K.metric('growth',-20,'r').score,K.metric('growth',-20,'r').points],[0,0],'A negative score is bounded at zero');
eq(K.kpiSummary([K.metric('growth',-50,'r')]).earned,0,'and earns nothing');

// ---- the management form (kpiInputSchema): every record reviewed may be correct; a grade is at most 100.
const form=(reviewed,correct,score=null)=>{const input=K.emptyKpiInput();input.reviewed=reviewed;input.correct=correct;input.conduct.honesty.score=score;return K.kpiInputSchema.safeParse(input).success;};
eq([form(5,5),form(5,4),form(5,6),form(null,null)],[true,true,false,true],'Correct records: up to the records reviewed, both empty or both set');
eq([form(null,null,100),form(null,null,100.01),form(null,null,0)],[true,false,true],'A conduct grade from 0 to 100');

// ---- customerMissingFields: the place is a location, a short address, an address, or BOTH coordinates.
const base={name:'مصنع',region:'الشرقية',city:'الدمام',phone:'0500000000',contact:'أحمد',customerKind:'مصنع'};
eq(K.customerMissingFields({...base,latitude:26.4}),['place'],'One coordinate is no place');
eq(K.customerMissingFields({...base,longitude:50.1}),['place'],'Nor the other alone');
eq(K.customerMissingFields({...base,latitude:26.4,longitude:50.1}),[],'Both coordinates are');

// ---- kpiPeriod while its month runs: the previous month up to the same day (its last day when shorter).
eq(K.kpiPeriod('2026-11'),{first:'2026-11-01',cutoff:'2026-11-16',previousFirst:'2026-10-01',previousEnd:'2026-10-16'},'The running month compares with the same days of the month before');
held=RealDate.parse('2026-12-31T09:00:00.000Z');
eq(K.kpiPeriod('2026-12').previousEnd,'2026-11-30','On the 31st, the month before ends on its own last day');
eq(K.kpiPeriod('2026-10').previousEnd,'2026-09-30','A finished month compares with the whole month before');
held=RealDate.parse('2026-11-16T09:00:00.000Z');

// ---- quoteConversions: an invoice of the same representative dated the quotation's own day converts it.
const quote={quoteId:'q',number:'Qut-77',date:'2026-11-05',repId:'rep',customerName:'مصنع',manualInvoices:[]};
const invoice=(date,repId='rep')=>({id:'i-'+date,reference:'INV-'+date,repId,date,quotationRefs:['Qut-77']});
eq(K.quoteConversions([quote],[invoice('2026-11-05')])[0].converted,true,'Invoiced the same day: converted');
eq(K.quoteConversions([quote],[invoice('2026-11-04')])[0].converted,false,'Invoiced the day before: not this quotation');

// ---- calculateKpis on a closed month.
const month='2025-09',member={id:'rep',name:'Rep',email:'rep@test.invalid',role:'rep',branch:'HQ',regionScope:'eastern',supervisorId:'sup',active:1,target:0,authVersion:1};
const products=T.targetProducts.map(product=>product.id);
const targetState=(weights=products.map((_,i)=>i?0:100))=>({month,branches:[],sets:[{kind:'sales',scopeId:'rep',month:'2025-01',data:{products:products.map(product=>({product,quantity:10}))}},{kind:'weights',scopeId:'company',month:'2025-01',data:{products:products.map((product,i)=>({product,weight:weights[i]}))}}]});
const sale=(id,date,items,extra={})=>({id,repId:'rep',customerId:'factory',customerName:'Factory',date,status:'confirmed',documentType:'sale',items:items.map(product=>({product,quantity:1,unitPrice:100})),totalCents:items.length*10000,...extra});
const performance=(state,items)=>({member,sourceMemberIds:['rep'],salesSourceMemberIds:['rep'],teamRollup:false,activityTeamRollup:false,activityTargetsKnown:true,activityTargets:{newCustomers:10,recoveredCustomers:2,visits:10},attainment:T.quantityAttainment('rep',state,items,false)});
const worked=['02','03','04','05','06','07','08'].map(m=>({id:'work-'+m,kind:'activity',parentId:null,assignedTo:'rep',branch:'HQ',data:{type:'visit',date:'2025-'+m+'-10',performedBy:'rep',responsibleId:'rep',summary:'s'},createdAt:'2025-'+m+'-10T08:00:00Z',updatedAt:'2025-'+m+'-10T08:00:00Z',version:1}));
const evidence=(purchases=[])=>({historyComplete:true,collection:{dueCents:100,collectedCents:100},recoveryTarget:1,quotationsKnown:true,quotations:[],purchases});
const calc=({weights,items=[],records=worked,context=evidence()}={})=>K.calculateKpis(performance(targetState(weights),items),month,records,items,null,undefined,context);

// «تعدد الأصناف»: a voided invoice is neither a sale nor a varied one.
const three=products.slice(0,3),one=products.slice(0,1);
let result=calc({items:[sale('ok','2025-09-05',one),sale('void','2025-09-06',three,{status:'void'})]});
eq([get(result,'variety').numerator,get(result,'variety').denominator],[0,1],'The voided invoice of three products counts for nothing');
result=calc({items:[sale('ok','2025-09-05',one),sale('three','2025-09-06',three)]});
eq([get(result,'variety').numerator,get(result,'variety').denominator,get(result,'variety').score],[1,2,50],'A confirmed invoice of three products is varied');

// The products' weights must make 100% exactly (sales known complete): 97% is «الأوزان ناقصة», no score.
// (lib/targets.ts refuses a saved weights set that is not 100%; the rows a roll-up or an older set hands over are checked again here.)
{const items=[sale('ok','2025-09-05',one)],p=performance(targetState(),items);
 p.attainment={...p.attainment,rows:p.attainment.rows.map((row,i)=>i?row:{...row,weight:97})};
 result=K.calculateKpis(p,month,worked,items,null,undefined,evidence());}
eq([result.attainment.status,get(result,'attainment').score],['weights_missing',null],'Weights of 97%: not scored');
result=calc({weights:products.map((_,i)=>i?0:100),items:[sale('ok','2025-09-05',one)]});
eq(result.attainment.status,'ready','Weights of 100%: scored');

// «توثيق أسباب الخسارة»: a loss without its reason is not documented; «مراجعة فنية» qualifies a customer for «معدل تحويل الفرص إلى عروض».
const customer=id=>({id,kind:'customer',parentId:null,assignedTo:'rep',branch:'HQ',data:{name:id,region:'الشرقية'},createdAt:'2025-01-01T08:00:00Z',updatedAt:'2025-01-01T08:00:00Z',version:1});
const visit=(id,customerId,data,date)=>({id,kind:'activity',parentId:customerId,assignedTo:'rep',branch:'HQ',data:{type:'visit',date,performedBy:'rep',responsibleId:'rep',summary:'s',...data},createdAt:date+'T08:00:00Z',updatedAt:date+'T08:00:00Z',version:1});
result=calc({records:[...worked,customer('c-lost'),visit('v-lost','c-lost',{salesStage:'lost'},'2025-09-10')]});
eq([get(result,'documentation').numerator,get(result,'documentation').denominator,get(result,'documentation').score],[0,1,0],'A loss with no reason: not documented');
result=calc({records:[...worked,customer('c-lost'),visit('v-lost','c-lost',{salesStage:'lost',lossReason:'السعر'},'2025-09-10')]});
eq([get(result,'documentation').numerator,get(result,'documentation').denominator],[1,1],'With its reason: documented');
result=calc({records:[...worked,customer('c-tech'),visit('v-tech','c-tech',{salesStage:'technical'},'2025-09-10'),visit('v-quote','c-tech',{salesStage:'quoted'},'2025-09-12')]});
eq([get(result,'quotes').numerator,get(result,'quotes').denominator],[1,1],'«مراجعة فنية» qualifies, and the quotation after it counts');

// «الحفاظ على العملاء الحاليين»: a purchase on the evaluation's last day is this month's.
result=calc({context:evidence([{customerKey:'kept',date:'2025-07-01',netCents:1000,hasSale:true},{customerKey:'kept',date:'2025-09-30',netCents:1000,hasSale:true}])});
eq([get(result,'retention').numerator,get(result,'retention').denominator],[1,1],'Bought on 2025-09-30, the cutoff: retained');
ok(get(result,'retention').score===100,'Retention 100%');

report();
