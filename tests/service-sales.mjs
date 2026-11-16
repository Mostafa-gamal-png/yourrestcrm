// Customer service in the sales process (the owner, 2026-11-16, item 5 of the GSCO list, after GSCO 2.13.78), pure and without a build:
// «مصدر الفرصة» (the sources, the problems, the words), the routing at approval (who may keep it and why, the 90-day boundary), the opportunity
// customer service keeps (its state, its closing, who works on it, who it may be given to), the sales attribution (full > shared > support,
// the window of a quotation, the 60-day support window, a return), the full customer-service sales out of a list, the role task (who, the 24
// working hours, the form), «أداء خدمة العملاء» (the rows, the team line, the customers who came back), the evaluation's new indicator (weight
// 15, 3 cases at least, target 50, saved weights made room for, a closed month kept) and the four provisional answers. Made-up records only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'service-sales-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let child=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(child))child+=fs.existsSync(path.join(root,child+'.ts'))?'.ts':'.tsx';
  compile(child);return 'from '+JSON.stringify(path.join(out,child.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
for(const file of ['lib/service-sales.ts','lib/service-kpi.ts','lib/customer-service.ts'])compile(file);
const S=await import(path.join(out,'lib/service-sales.mjs'));
const K=await import(path.join(out,'lib/service-kpi.mjs'));
const C=await import(path.join(out,'lib/customer-service.mjs'));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual===undefined?undefined:JSON.parse(JSON.stringify(actual)),expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};

// ---- the four questions the owner has not answered: GSCO 2.13.78's provisional choices, each in one place
eq([K.CONVERSION_TARGET,S.SUPPORT_SALES_DAYS,S.SALES_MANAGER_SEES_ALL_SERVICE_TEAMS,S.DORMANT_LIST_INCLUDES_NEVER_BOUGHT],[50,60,true,false],'Q1 target 50%, Q2 60 days, Q3 the sales manager sees every team, Q4 a customer who never bought is not listed');
eq([K.DEFAULT_SERVICE_KPI_SETTINGS.rep.conversion,K.DEFAULT_SERVICE_KPI_SETTINGS.supportSalesDays],[{target:50,weight:15,min:3},60],'the evaluation and the setting read them');

// ---- A. «مصدر الفرصة»
eq(S.serviceLeadSources,['اتصال وارد','واتساب','الموقع الإلكتروني','مواقع التواصل الاجتماعي','توصية من عميل','اتصال تسويقي','معرض أو فعالية','أخرى'],'the sources customer service brings in, GSCO\'s list');
eq(S.leadRefKinds.map(kind=>S.systemLeadSources[kind]),['فرصة مفقودة سابقة','عميل منقطع عن الشراء 90 يومًا','طلب تواصل مع العملاء','زيارة مفقودة','شكوى'],'what the system fills in, by the kind of record');
eq([S.leadStartLabels.opportunity,S.leadStartLabels.support,S.leadStartLabels.missed_visit,S.leadStartLabels.complaint],['بدء فرصة جديدة من هذه الفرصة','فرصة جديدة من هذا الطلب','فرصة جديدة من هذا الطلب','فرصة جديدة من هذه الشكوى'],'the start buttons, in the owner\'s words');
eq([S.serviceLeadProblem(null),S.serviceLeadProblem({}),S.serviceLeadProblem({group:'service',source:''}),S.serviceLeadProblem({group:'service',source:'تلفزيون'})],[S.LEAD_MESSAGES.missing,S.LEAD_MESSAGES.missing,S.LEAD_MESSAGES.notListed,S.LEAD_MESSAGES.notListed],'no source, an empty one, one not on the list: refused');
eq([S.serviceLeadProblem({group:'service',source:'واتساب'}),S.serviceLeadProblem({group:'service',source:'أخرى',note:'لا'}),S.serviceLeadProblem({group:'service',source:'أخرى',note:'  ab  '}),S.serviceLeadProblem({group:'service',source:'أخرى',note:'لافتة الطريق'})],['',S.LEAD_MESSAGES.otherShort,S.LEAD_MESSAGES.otherShort,''],'«أخرى» needs 3 letters once trimmed');
eq([S.serviceLeadProblem({group:'service',source:'واتساب',refKind:'complaint',refId:'x'}),S.serviceLeadProblem({group:'system',source:'شكوى'}),S.serviceLeadProblem({group:'system',refKind:'complaint',refId:'c1'})],[S.LEAD_MESSAGES.serviceWithRef,S.LEAD_MESSAGES.systemOnly,''],'a system source only with its record, a picked source never with one');
ok(!S.leadInputSchema.safeParse({group:'service',source:'واتساب',extra:1}).success&&S.leadInputSchema.safeParse({group:'system',refKind:'support',refId:'s1'}).success&&!S.leadInputSchema.safeParse({group:'system',refKind:'visit',refId:'s1'}).success,'the form\'s field is strict and its kinds are listed');
eq([S.leadLabel(null,null),S.leadLabel('service','واتساب'),S.leadLabel('service','أخرى','لافتة'),S.leadLabel('system','شكوى')],['غير محدد','من جهد خدمة العملاء · واتساب','من جهد خدمة العملاء · أخرى (لافتة)','من بيانات النظام · شكوى'],'how a stored source reads; a case from before reads «غير محدد»');
eq([S.leadLabelEn(null,null),S.leadLabelEn('service','واتساب'),S.leadLabelEn('system','عميل منقطع عن الشراء 90 يومًا')],['Unspecified','Brought in by customer service · WhatsApp','From the system data · Customer who has not bought for 90 days'],'and in English, no Arabic left');

// ---- B. routing
const today='2026-11-16';
eq([S.dormantSince(today),S.dormantCustomer('2026-08-18',today),S.dormantCustomer('2026-08-17',today),S.dormantCustomer('',today),S.dormantCustomer(null,today),S.dormantCustomer('2026-11-15',today)],['2026-08-18',false,true,true,true,false],'90 days ago still buys; 91 days ago, or never, has not bought');
eq([S.dormantListed('2026-08-17',today),S.dormantListed('2026-08-18',today),S.dormantListed('',today)],[true,false,false],'the list: a buyer of before only (question 4)');
eq([S.routingEligible({unlinked:false,dormant:false,serviceEffort:false}),S.routingEligible({unlinked:true,dormant:false,serviceEffort:false}),S.routingEligible({unlinked:false,dormant:true,serviceEffort:false}),S.routingEligible({unlinked:false,dormant:false,serviceEffort:true})],[false,true,true,true],'customer service keeps it only for a customer without an ERP code, one who has not bought, or its own lead');
eq(S.routingReasons({unlinked:true,dormant:true,serviceEffort:false}),['unlinked','dormant'],'the reasons, in order');
eq([S.routeLabels.sales,S.routeLabels.service,S.OPEN_SALES_WARNING],['تمرير لمدير المبيعات','تتولاها خدمة العملاء','تنبيه: للعميل فرصة مفتوحة لدى المبيعات'],'the two choices and the warning, in the owner\'s words');

// ---- the opportunity customer service keeps (lib/customer-service.ts)
const m=(id,role,supervisorId,branch='الرئيسي')=>({id,userId:'u-'+id,email:id+'@yourrest.org',name:'عضو '+id,role,branch,supervisorId,regionScope:'all',active:1,target:0});
const members=[m('owner','admin'),m('sm','manager'),m('rep','rep','sm'),m('csm','customer_service_manager','sm'),m('cs','customer_service','csm'),m('cs2','customer_service','csm'),m('csx','customer_service','other'),m('csb','customer_service','csm','جدة')];
const customer={id:'c1',kind:'customer',parentId:null,assignedTo:'rep',branch:'الرئيسي',data:{name:'مصنع',region:'الشرقية'},createdAt:'2026-10-01T05:00:00.000Z',updatedAt:'2026-10-01T05:00:00.000Z',version:3};
const held={id:'k1',customerId:'c1',status:'service',creatorId:'cs',serviceManagerId:'csm',salesManagerId:null,assignedTo:'cs2',supervisorId:null,data:{participants:['cs','csm','cs2'],approvedAt:'2026-11-02T06:00:00.000Z'},createdAt:'2026-11-01T06:00:00.000Z',updatedAt:'2026-11-02T06:00:00.000Z',version:2,route:'service'};
const ctx=me=>({me:members.find(x=>x.id===me),members,all:[customer],serviceCases:[held]});
eq([C.serviceState(held,[customer],members),C.serviceClosedAt(held,[customer]),C.serviceStatusLabels.service],['service','','لدى خدمة العملاء'],'kept by customer service: «لدى خدمة العملاء», open');
const won={...held,data:{...held.data,serviceStages:[{stage:'quoted',lossReason:'',note:'',by:'cs2',at:'2026-11-05T06:00:00.000Z'},{stage:'won',lossReason:'',note:'',by:'cs2',at:'2026-11-09T06:00:00.000Z'}]}};
eq([C.serviceState(won,[customer],members),C.serviceClosedAt(won,[customer]),C.heldStage(won).stage],['won','2026-11-09T06:00:00.000Z','won'],'its last stage closes it, at the moment it was recorded');
eq([C.servicePermissions(held,ctx('cs2')).work,C.servicePermissions(held,ctx('owner')).work,C.servicePermissions(held,ctx('cs')).work,C.servicePermissions(held,ctx('csm')).work,C.servicePermissions(won,ctx('cs2')).work],[true,true,false,false,false],'only its owner (or the administrator) works on it, and not once it closed');
eq([C.canReadService(held,ctx('rep')),C.canReadService(held,ctx('sm')),C.servicePermissions(held,ctx('sm')).followup],[false,false,false],'no member of sales reads it or writes on it');
const pending={...held,status:'pending_approval',assignedTo:null,data:{participants:['cs','csm']}};
eq(C.serviceCandidates(pending,ctx('csm'),'keep').map(x=>x.id),['cs','csm','cs2'],'a customer-service manager gives it to the registrar (first), himself or his team, in the customer\'s branch');
eq(C.serviceCandidates(pending,ctx('owner'),'keep').map(x=>x.id),['cs','csm','cs2','csx'],'the administrator to any customer-service member of the branch');

// ---- C. attribution
const kase=(id,o)=>({id,number:Number(id.replace(/\D/g,''))||null,customerId:'c1',customerName:'مصنع',registrarId:'cs',ownerId:'',held:false,route:null,approved:true,createdAt:'2026-11-01T06:00:00.000Z',state:'assigned',closedAt:'',leadGroup:'service',leadSource:'واتساب',leadNote:'',...o});
const cases=[kase('k1',{held:true,ownerId:'cs2',route:'service',closedAt:'2026-11-20T06:00:00.000Z'}),kase('k2',{customerId:'c2',registrarId:'cs',route:'sales',createdAt:'2026-10-01T06:00:00.000Z'})];
eq([S.caseOfQuote({customerId:'c1',date:'2026-11-01'},cases)?.id,S.caseOfQuote({customerId:'c1',date:'2026-10-31'},cases)?.id,S.caseOfQuote({customerId:'c1',date:'2026-11-20'},cases)?.id,S.caseOfQuote({customerId:'c1',date:'2026-11-21'},cases)?.id,S.caseOfQuote({customerId:'c2',date:'2030-01-01'},cases)?.id],['k1',null,'k1',null,'k2'],'a quotation belongs to the opportunity open on its day (registered on, won or lost on, both included; an open one has no end)');
const later=[...cases,kase('k3',{createdAt:'2026-11-20T09:00:00.000Z'})];
eq(S.caseOfQuote({customerId:'c1',date:'2026-11-20'},later)?.id,'k3','on a day one closed and another opened, the later one');
const quotes=[{id:'q1',ref:'Qut-1',customerId:'c1',date:'2026-11-03',total:1000},{id:'q2',ref:'Qut-2',customerId:'c2',date:'2026-11-03',total:500},{id:'q3',ref:'Qut-3',customerId:'c1',date:'2026-09-01',total:900}];
const inv=(id,o)=>({id,source:'erp',number:'INV-'+id,date:'2026-11-10',type:'sale',customerId:'c1',repId:'rep',value:100,refs:[],...o});
const invoices=[inv('e1',{refs:['Qut-1'],value:1000}),inv('e2',{refs:['Qut-2'],customerId:'c2',value:500}),inv('e3',{refs:['Qut-1'],type:'return',value:-200}),inv('e4',{refs:['Qut-3'],value:900}),inv('e5',{refs:['Qut-1','Qut-2'],value:50}),
 inv('s1',{customerId:'c3',date:'2026-12-01',value:70}),inv('s2',{customerId:'c3',date:'2026-12-02',value:80}),inv('s3',{customerId:'c3',date:'2026-12-01',type:'return',value:-10}),inv('s4',{customerId:'c3',date:'2026-10-01',value:60})];
const contacts=[{requestId:'r1',customerId:'c3',handlerId:'cs',at:'2026-10-02T08:00:00.000Z'},{requestId:'r2',customerId:'c3',handlerId:'cs2',at:'2026-10-03T08:00:00.000Z'}];
const attributed=S.attributeSales({cases,quotes,invoices,contacts,supportDays:60});
const view=attributed.map(a=>[a.id,a.category,a.memberId,a.caseId,a.value]);
eq(view,[['e1','full','cs2','k1',1000],['e2','shared','cs','k2',500],['e3','full','cs2','k1',-200],['e5','full','cs2','k1',50],['s1','support','cs2',null,70],['s2','support','cs2',null,80]],'full (a quotation of the opportunity customer service keeps), shared (one passed to sales), a return negative in its quotation\'s category, an invoice naming both counted once as the highest, support to the latest contact within its window');
ok(!attributed.some(a=>a.id==='e4'),'a quotation from before the opportunity was registered makes nothing');
ok(!attributed.some(a=>a.id==='s3'||a.id==='s4'),'support: never a return, never a sale before the contact');
const window=S.attributeSales({cases,quotes,invoices:[inv('w1',{customerId:'c3',date:'2026-12-02'}),inv('w2',{customerId:'c3',date:'2026-12-03'})],contacts:[contacts[1]],supportDays:60}).map(a=>a.id);
eq(window,['w1'],'the 60th day after the contact counts, the 61st does not');
eq(S.attributeSales({cases,quotes,invoices:[inv('w1',{customerId:'c3',date:'2026-12-02'})],contacts:[contacts[1]],supportDays:30}).length,0,'the window follows the setting');
eq([...S.fullSalesIds(attributed)].sort(),['e1','e3','e5'],'the full customer-service sales: their invoices and returns');
eq(S.withoutFullSales([{id:'e1'},{id:'e2'},{id:'x'}],S.fullSalesIds(attributed)).map(s=>s.id),['e2','x'],'what every achievement reads: the list without them');
eq(S.withoutFullSales([{id:'e1'}],null).map(s=>s.id),['e1'],'nothing kept by customer service: the list as it was');
eq([S.FULL_SALES_LINE,S.salesCategoryLabels.full,S.salesCategoryLabels.shared,S.salesCategoryLabels.support],['منها مبيعات خدمة العملاء بالكامل','مبيعات بالكامل','مبيعات بالمشاركة','مبيعات بالمساندة'],'the words of the line and the categories');

// ---- D. the role task
const service=new Set(['cs','cs2','csm']);
eq([S.roleTaskTarget({held:true,ownerId:'cs2',registrarId:'cs'},service),S.roleTaskTarget({held:false,ownerId:'rep',registrarId:'cs'},service),S.roleTaskTarget({held:false,ownerId:'rep',registrarId:'owner'},service,'csm'),S.roleTaskTarget({held:false,ownerId:'rep',registrarId:'owner'},service,null),S.roleTaskTarget({held:true,ownerId:'gone',registrarId:'cs'},service)],
 [{memberId:'cs2',basis:'owner'},{memberId:'cs',basis:'registrar'},{memberId:'csm',basis:'support'},null,{memberId:'cs',basis:'registrar'}],'the owner, else the registrar, else whoever handled a support request from it; nobody active: none');
eq([S.roleTaskLate('2026-11-15T05:00:00.000Z','2026-11-17T09:00:00.000Z'),S.roleTaskLate('2026-11-15T05:00:00.000Z','2026-11-17T10:00:00.000Z'),S.roleTaskHours('2026-11-12T15:00:00.000Z','2026-11-15T06:00:00.000Z'),S.ROLE_TASK_HOURS],[false,true,11,24],'late after 24 working hours (Sunday 08:00 to Tuesday 12:00 is 24: not yet; one hour more: late); Thursday evening to Sunday 09:00 is 11 (Friday is off, Saturday works)');
eq([S.roleTaskSchema.safeParse({roles:[],note:'x'.repeat(10)}).success,S.roleTaskSchema.safeParse({roles:['جلب العميل'],note:'قصيرة'}).success,S.roleTaskSchema.safeParse({roles:['جلب العميل'],note:'تواصلت مع العميل'}).success,S.roleTaskSchema.safeParse({roles:['دور آخر'],note:'تواصلت مع العميل'}).success],[false,false,true,false],'a role from the list at least, and a note of 10 letters');

// ---- E. the dashboard
const perfMembers=[{id:'cs',name:'أ',role:'customer_service',supervisorId:'csm'},{id:'cs2',name:'ب',role:'customer_service',supervisorId:'csm'}];
const perfCases=[kase('k1',{held:true,ownerId:'cs2',route:'service',createdAt:'2026-11-01T06:00:00.000Z'}),kase('k2',{customerId:'c2',route:'sales',createdAt:'2026-11-02T06:00:00.000Z',leadGroup:'system',leadSource:'شكوى'}),kase('k4',{customerId:'c4',approved:false,route:null,createdAt:'2026-11-03T06:00:00.000Z',leadGroup:null,leadSource:null})];
const tasks=[{caseId:'k9',memberId:'cs',closedAt:'2026-11-03T06:00:00.000Z',doneAt:''},{caseId:'k8',memberId:'cs',closedAt:'2026-11-10T06:00:00.000Z',doneAt:'2026-11-10T09:00:00.000Z'}];
const rows=S.servicePerformance({members:perfMembers,cases:perfCases,quotes,attributed:S.attributeSales({cases:perfCases,quotes,invoices,contacts,supportDays:60}),invoices,contacts,tasks},'2026-11','2026-11-16T06:00:00.000Z');
const a=rows.find(r=>r.memberId==='cs'),b=rows.find(r=>r.memberId==='cs2');
eq([a.opportunities,a.kept,a.passed,a.pending,a.quoted,a.quotedValue,a.invoiced,a.invoicedValue],[3,1,1,1,2,1500,2,1350],'opportunities count for their registrar in their month: kept, passed, awaiting; a quotation and an invoice follow them');
eq([b.sales.full,a.sales.shared,a.sales.full],[{value:850,invoices:2},{value:500,invoices:1},{value:0,invoices:0}],'full sales to the one who keeps it (the return deducted, not counted as an invoice), shared to the registrar');
eq(a.byGroup,{service:1,system:1,'غير محدد':1},'by group, the ones from before «غير محدد»');
eq([a.rolesWaiting,a.rolesLate,a.rolesDone],[1,1,1],'roles waiting, late and recorded');
const total=S.performanceTotal(rows,'الفريق');
eq([total.opportunities,total.sales.full.value,total.sales.shared.value,total.rolesDone],[3,850,500,1],'the team line adds the members up');
const back=S.recoveredCustomers({cases:[kase('k7',{customerId:'c7',createdAt:'2026-11-01T06:00:00.000Z',registrarId:'cs'})],contacts:[],invoices:[inv('o1',{customerId:'c7',date:'2026-06-01'}),inv('o2',{customerId:'c7',date:'2026-11-05'}),inv('o3',{customerId:'c8',date:'2026-11-05'})]});
eq(back.map(r=>[r.customerId,r.memberId,r.day]),[['c7','cs','2026-11-05']],'a customer who bought before, nothing for 90 days, then bought again after customer service touched them: came back; a first purchase is not');
eq(S.recoveredCustomers({cases:[kase('k7',{customerId:'c7',createdAt:'2026-11-01T06:00:00.000Z'})],contacts:[],invoices:[inv('o1',{customerId:'c7',date:'2026-09-01'}),inv('o2',{customerId:'c7',date:'2026-11-05'})]}).length,0,'one who bought within 90 days did not come back');
eq(S.performanceColumns.map(c=>c.ar).slice(0,4),['الفرص المسجلة','مُررت للمبيعات','تولتها خدمة العملاء','بانتظار القرار'],'the dashboard columns');
eq([S.performanceAllowed('admin'),S.performanceAllowed('manager'),S.performanceAllowed('customer_service_manager'),S.performanceAllowed('customer_service'),S.performanceAllowed('supervisor'),S.performanceAllowed('rep')],[true,true,true,true,false,false],'who reads «أداء خدمة العملاء»');
eq([S.leadReader('admin'),S.leadReader('customer_service'),S.leadReader('manager'),S.leadStarter('admin'),S.leadStarter('customer_service_manager')],[true,true,false,false,true],'who reads «مصادر الفرص» and who starts from it');

// ---- the evaluation: «نسبة الفرص المتحولة إلى مبيعات»
const d=K.DEFAULT_SERVICE_KPI_SETTINGS;
eq(K.REP_METRICS.map(key=>d.rep[key].weight),[13,13,13,13,9,8,8,8,15],'weights 13,13,13,13,9,8,8,8 and the new 15');
eq(K.REP_METRICS.reduce((n,key)=>n+d.rep[key].weight,0),100,'the card adds up to 100');
eq([K.repMetricLabels.conversion,K.repMetricLabelsEn.conversion],['نسبة الفرص المتحولة إلى مبيعات','Opportunities turned into sales'],'its name');
const legacy={...JSON.parse(JSON.stringify(d)),rep:Object.fromEntries(K.REP_METRICS.filter(k=>k!=='conversion').map(k=>[k,{...d.rep[k],weight:K.LEGACY_REP_WEIGHTS[k]}]))};delete legacy.supportSalesDays;
const live=K.normalizeSettings(legacy);
eq([K.REP_METRICS.map(k=>live.rep[k].weight),live.supportSalesDays,K.settingsProblem(live)],[[13,13,13,13,9,8,8,8,15],60,''],'settings saved with the old defaults: the new defaults, valid');
const custom={...legacy,rep:{...legacy.rep,support_response:{...legacy.rep.support_response,weight:30},closure_timing:{...legacy.rep.closure_timing,weight:0}}};
const scaled=K.normalizeSettings(custom);
eq([K.REP_METRICS.map(k=>scaled.rep[k].weight),K.REP_METRICS.reduce((n,k)=>n+scaled.rep[k].weight,0),K.settingsProblem(scaled)],[[26,0,13,13,9,8,8,8,15],100,''],'weights the administrator changed: kept in proportion over 85, the new one 15');
const certificate=K.normalizeSettings(custom,'certificate');
eq([K.REP_METRICS.map(k=>certificate.rep[k].weight)],[[30,0,15,15,10,10,10,10,0]],'a closed month\'s card keeps its weights: the new indicator joins with 0');
eq([K.settingsProblem({...live,supportSalesDays:0}),K.settingsProblem({...live,supportSalesDays:366}),K.settingsProblem({...live,supportSalesDays:1.5}),K.settingsProblem({...live,supportSalesDays:365})],['مدة احتساب مبيعات المساندة بالأيام عدد صحيح من 1 إلى 365','مدة احتساب مبيعات المساندة بالأيام عدد صحيح من 1 إلى 365','مدة احتساب مبيعات المساندة بالأيام عدد صحيح من 1 إلى 365',''],'the support-sales window: a whole number from 1 to 365');
const kmembers=[m('csm','customer_service_manager','sm'),m('cs','customer_service','csm')];
const fact=(id,closedAt,won,invoiced=false,memberId='cs')=>({caseId:id,customerId:'c1',memberId,closedAt,won,invoiced});
const input=conversions=>({members:kmembers,complaints:[],support:[],serviceCases:[],audits:[],closed:[],settings:d,conversions});
const card=conversions=>K.serviceKpiMonth(input(conversions),'2026-11','2026-11-30T12:00:00.000Z').groups.find(g=>g.managerId==='csm').reps[0].metrics.find(x=>x.key==='conversion');
const two=card([fact('a','2026-11-03T06:00:00.000Z',true),fact('b','2026-11-04T06:00:00.000Z',false)]);
eq([two.denominator,two.enough,two.measured],[2,false,false],'two cases: not enough (3 at least), neither raises nor lowers the score');
const three=card([fact('a','2026-11-03T06:00:00.000Z',true),fact('b','2026-11-04T06:00:00.000Z',false,true),fact('c','2026-11-05T06:00:00.000Z',false),fact('x','2026-10-30T06:00:00.000Z',true),fact('y','2026-11-05T06:00:00.000Z',true,false,'other')]);
eq([three.numerator,three.denominator,Math.round(three.actual*10)/10,three.target,three.weight,three.measured,Math.round(three.achieved*1000)/1000],[2,3,66.7,50,15,true,1],'three of the member\'s closings in the month: won or lost with an invoice count as converted; 66.7% of a 50% target');
eq(three.items.map(i=>i.tag),['won','lost_invoiced','lost'],'each case says why');
eq(card(undefined).denominator,0,'an input without the facts: no cases');

console.log(JSON.stringify({checks}));
