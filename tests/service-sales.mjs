// Customer service in the sales process (the owner, 2026-11-16, item 5 of the GSCO list, after GSCO 2.13.78), pure and without a build:
// «مصدر الفرصة» (the sources, the problems, the words), the routing at approval (who may keep it and why, the 90-day boundary), the opportunity
// customer service keeps (its state, its closing, who works on it, who it may be given to), the sales attribution (full > shared > support,
// the window of a quotation, the support window (30 days by default), a return), the full customer-service sales out of a list, the role task (who, the 24
// working hours, the form), «أداء خدمة العملاء» (the rows, the team line, the customers who came back), the evaluation's new indicator (weight
// 15, 3 cases at least, target 100, saved weights made room for, a closed month kept) and the owner's four decisions. Made-up records only.
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

// ---- the owner's four decisions (2026-11-17, as in GSCO and Trade), each in one place
eq([K.CONVERSION_TARGET,S.SUPPORT_SALES_DAYS,S.SALES_MANAGER_SEES_ALL_SERVICE_TEAMS,S.DORMANT_LIST_INCLUDES_NEVER_BOUGHT],[100,30,false,true],'1 target 100%, 2 thirty days, 3 the sales manager sees only his own customer-service teams, 4 a customer who never bought is listed');
eq([K.DEFAULT_SERVICE_KPI_SETTINGS.rep.conversion,K.DEFAULT_SERVICE_KPI_SETTINGS.supportSalesDays],[{target:100,weight:15,min:3},30],'the evaluation and the setting read them');
// A follow-up of update-cs-sales-20261116 (as GSCO 2.13.79): its placeholders, saved before the revision, read the owner's figures; values set by
// hand, and anything saved from now on (the server stamps the revision), stay; a closed month keeps its certificate.
eq([K.PLACEHOLDER_CONVERSION_TARGET,K.PLACEHOLDER_SUPPORT_SALES_DAYS,K.SERVICE_KPI_SETTINGS_REVISION,K.DEFAULT_SERVICE_KPI_SETTINGS.revision],[50,60,2,2],'the placeholders and the revision');
const v78=JSON.parse(JSON.stringify(K.DEFAULT_SERVICE_KPI_SETTINGS));delete v78.revision;v78.rep.conversion.target=50;v78.supportSalesDays=60;
const moved=K.normalizeSettings(v78),kept=K.normalizeSettings({...v78,revision:2}),byHand=K.normalizeSettings({...v78,rep:{...v78.rep,conversion:{...v78.rep.conversion,target:70}},supportSalesDays:45}),closedCard=K.normalizeSettings(v78,'certificate');
eq([moved.rep.conversion.target,moved.supportSalesDays,moved.revision],[100,30,2],'saved under update-cs-sales with its placeholders: 50% reads 100%, 60 days read 30');
eq([kept.rep.conversion.target,kept.supportSalesDays],[50,60],'saved with the revision (from now on): 50% and 60 days are the administrator\'s choice and stay');
eq([byHand.rep.conversion.target,byHand.supportSalesDays],[70,45],'a target and a window set by hand stay');
eq([closedCard.rep.conversion.target,closedCard.supportSalesDays,'revision' in closedCard],[50,60,false],'a closed month\'s certificate keeps what it was closed with');
eq([S.performanceReach('admin'),S.performanceReach('manager'),S.performanceReach('customer_service_manager'),S.performanceReach('customer_service')],['all','reporting','team','self'],'whose figures each reader of «أداء خدمة العملاء» reaches (decision 3)');
eq([S.PERFORMANCE_NO_TEAM,S.PERFORMANCE_NO_TEAM_EN],['لا يتبعك فريق خدمة عملاء','No customer-service team reports to you'],'a sales manager with no team: words, not an error');

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
eq([S.dormantListed('2026-08-17',today),S.dormantListed('2026-08-18',today),S.dormantListed('',today),S.dormantListed(null,today)],[true,false,true,true],'the list: a buyer of before 90 days, and one who never bought (decision 4)');
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
const lostHeld={...held,data:{...held.data,serviceStages:[{stage:'lost',lossReason:'شروط الدفع ',note:'',by:'cs2',at:'2026-11-09T06:00:00.000Z'}]}};
const lostContact={id:'a1',kind:'activity',parentId:'c1',assignedTo:'rep',branch:'الرئيسي',data:{serviceCaseId:'k2',salesStage:'lost',lossReason:'السعر'},createdAt:'2026-11-10T06:00:00.000Z',updatedAt:'2026-11-10T06:00:00.000Z',version:1};
eq([C.serviceLossReason(lostHeld,[customer]),C.serviceLossReason({...held,id:'k2',status:'assigned'},[customer,lostContact]),C.serviceLossReason(held,[customer])],['شروط الدفع','السعر',''],'the loss reason: the stage customer service recorded on one it keeps, else the contact that closed it (the monthly report and its Excel read it)');
const pending={...held,status:'pending_approval',assignedTo:null,data:{participants:['cs','csm']}};
eq(C.serviceCandidates(pending,ctx('csm'),'keep').map(x=>x.id),['cs','csm','cs2'],'a customer-service manager gives it to the registrar (first), himself or his team, in the customer\'s branch');
eq(C.serviceCandidates(pending,ctx('owner'),'keep').map(x=>x.id),['cs','csm','cs2','csx'],'the administrator to any customer-service member of the branch');

// ---- C. attribution
const kase=(id,o)=>({id,number:Number(id.replace(/\D/g,''))||null,customerId:'c1',customerName:'مصنع',registrarId:'cs',ownerId:'',held:false,route:null,approved:true,createdAt:'2026-11-01T06:00:00.000Z',state:'assigned',closedAt:'',leadGroup:'service',leadSource:'واتساب',leadNote:'',routedAt:'',...o});
const cases=[kase('k1',{held:true,ownerId:'cs2',route:'service',closedAt:'2026-11-20T06:00:00.000Z',routedAt:'2026-11-01T07:00:00.000Z'}),kase('k2',{customerId:'c2',registrarId:'cs',route:'sales',createdAt:'2026-10-01T06:00:00.000Z'})];
eq([S.caseOfQuote({customerId:'c1',date:'2026-11-01'},cases)?.id,S.caseOfQuote({customerId:'c1',date:'2026-10-31'},cases)?.id,S.caseOfQuote({customerId:'c1',date:'2026-11-20'},cases)?.id,S.caseOfQuote({customerId:'c1',date:'2026-11-21'},cases)?.id,S.caseOfQuote({customerId:'c2',date:'2030-01-01'},cases)?.id],['k1',null,'k1',null,'k2'],'a quotation belongs to the opportunity open on its day (registered on, won or lost on, both included; an open one has no end)');
const later=[...cases,kase('k3',{createdAt:'2026-11-20T09:00:00.000Z'})];
eq(S.caseOfQuote({customerId:'c1',date:'2026-11-20'},later)?.id,'k3','on a day one closed and another opened, the later one');
const quotes=[{id:'q1',ref:'Qut-1',customerId:'c1',date:'2026-11-03',total:1000},{id:'q2',ref:'Qut-2',customerId:'c2',date:'2026-11-03',total:500},{id:'q3',ref:'Qut-3',customerId:'c1',date:'2026-09-01',total:900}];
const inv=(id,o)=>({id,source:'erp',number:'INV-'+id,date:'2026-11-10',type:'sale',customerId:'c1',repId:'rep',value:100,refs:[],importedAt:'2026-12-31T00:00:00.000Z',...o});
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
eq(S.attributeSales({cases,quotes,invoices:[inv('d30',{customerId:'c3',date:'2026-11-02'}),inv('d31',{customerId:'c3',date:'2026-11-03'})],contacts:[contacts[1]],supportDays:S.SUPPORT_SALES_DAYS}).map(a=>[a.id,a.category]),[['d30','support']],'by default (30 days, decision 2): the 30th day after the contact of 3 October counts, the 31st does not');
eq([...S.fullSalesIds(attributed)].sort(),['e1','e3','e5'],'the full customer-service sales: their invoices and returns');
eq(S.withoutFullSales([{id:'e1'},{id:'e2'},{id:'x'}],S.fullSalesIds(attributed)).map(s=>s.id),['e2','x'],'what every achievement reads: the list without them');
eq(S.withoutFullSales([{id:'e1'}],null).map(s=>s.id),['e1'],'nothing kept by customer service: the list as it was');
// ---- the review of 2026-11-16: a later decision never reclassifies; an invoice matches its quotation by customer and date; returns
// The opportunity was registered on 2026-10-20 and kept on 2026-11-03: a quotation the representative issued (10-25) and invoiced (10-28)
// while it waited for approval stays his, in a closed month and after; only a quotation and an invoice from the decision on are full.
const late=kase('k20',{customerId:'c20',createdAt:'2026-10-20T08:00:00.000Z',held:true,ownerId:'cs2',route:'service',routedAt:'2026-11-03T09:00:00.000Z'});
const lateQuotes=[{id:'q20',ref:'Qut-500',customerId:'c20',date:'2026-10-25',total:1000},{id:'q21',ref:'Qut-501',customerId:'c20',date:'2026-11-04',total:1000},{id:'q22',ref:'Qut-502',customerId:'c20',date:'2026-11-03',total:1000}];
const lateInv=(id,o)=>inv(id,{customerId:'c20',...o});
const lateView=S.attributeSales({cases:[late],quotes:lateQuotes,invoices:[
 lateInv('l1',{refs:['Qut-500'],date:'2026-10-28',importedAt:'2026-10-29T06:00:00.000Z'}),lateInv('l2',{refs:['Qut-500'],date:'2026-11-05'}),lateInv('l3',{refs:['Qut-501'],date:'2026-11-05'}),
 lateInv('l4',{refs:['Qut-502'],date:'2026-11-03',importedAt:'2026-11-03T08:00:00.000Z'}),lateInv('l5',{refs:['Qut-502'],date:'2026-11-03',importedAt:'2026-11-03T10:00:00.000Z'})],contacts:[],supportDays:60}).map(a=>[a.id,a.category]);
eq(lateView,[['l1','shared'],['l4','shared'],['l5','full'],['l2','shared'],['l3','full']],'kept later: a quotation from before the decision stays the representative\'s (shared), in its month and after; the quotation and invoice of the decision\'s day are full only when the invoice reached the system after it');
eq([S.keptSale({held:true,routedAt:''},{date:'2026-11-05'},{date:'2026-11-05',importedAt:'2026-12-01T00:00:00.000Z'}),S.keptSale({held:false,routedAt:'2026-11-03T09:00:00.000Z'},{date:'2026-11-05'},{date:'2026-11-05',importedAt:'2026-12-01T00:00:00.000Z'}),S.keptSale({held:true,routedAt:'2026-11-03T09:00:00.000Z'},{date:'2026-11-05'},{date:'2026-11-05',importedAt:''})],[false,false,false],'no decision, not kept, or an invoice of unknown arrival: never full');
// An invoice of another customer naming the kept quotation by mistake, and one dated before the quotation, sell nothing of it.
const keptCase=kase('k30',{customerId:'cA',createdAt:'2026-10-20T08:00:00.000Z',held:true,ownerId:'cs',route:'service',routedAt:'2026-10-20T09:00:00.000Z'});
const keptQuote={id:'q30',ref:'Qut-600',customerId:'cA',date:'2026-10-25',total:1000};
eq(S.attributeSales({cases:[keptCase],quotes:[keptQuote],invoices:[inv('o1',{customerId:'cB',refs:['Qut-600'],date:'2026-10-28',value:5000}),inv('o2',{customerId:'cA',refs:['Qut-600'],date:'2026-10-21',value:5000}),inv('o3',{customerId:'',refs:['Qut-600'],date:'2026-10-28',value:400}),inv('o4',{customerId:'cA',refs:['Qut-600'],date:'2026-10-25',value:300})],contacts:[],supportDays:60}).map(a=>[a.id,a.category]),
 [['o4','full'],['o3','full']],'another customer\'s invoice and one dated before the quotation are not its sale; one whose code names no single customer is matched by the number, and the day of the quotation counts');
eq([S.invoiceOfQuote({date:'2026-10-25',customerId:''},{date:'2026-10-25',customerId:'cA'}),S.invoiceOfQuote({date:'2026-10-24',customerId:'cA'},{date:'2026-10-25',customerId:'cA'}),S.invoiceOfQuote({date:'2026-10-26',customerId:'cB'},{date:'2026-10-25',customerId:'cA'}),S.invoiceOfQuote({date:'2026-10-26',customerId:'cA'},{date:'',customerId:'cA'})],[true,false,false,false],'invoiceOfQuote');
// The ERP return of a full sale repeats no quotation number: it follows the full sales of its customer, up to what they left out.
const rsale=inv('r0',{customerId:'cA',refs:['Qut-600'],date:'2026-10-28',value:5000});
const returnsOf=(...extra)=>S.attributeSales({cases:[keptCase],quotes:[keptQuote],invoices:[rsale,...extra],contacts:[],supportDays:60}).filter(a=>a.type==='return').map(a=>[a.id,a.category,a.memberId,a.caseId,a.value]);
eq(returnsOf(inv('r1',{customerId:'cA',type:'return',date:'2026-10-29',value:-5000})),[['r1','full','cs','k30',-5000]],'the return of the full sale, naming no quotation, is full too: the representative is not charged with it');
eq(returnsOf(inv('r1',{customerId:'cA',type:'return',date:'2026-10-29',value:-3000}),inv('r2',{customerId:'cA',type:'return',date:'2026-10-30',value:-2500}),inv('r3',{customerId:'cA',type:'return',date:'2026-10-31',value:-1500}),inv('r4',{customerId:'cA',type:'return',date:'2026-11-01',value:-600})).map(r=>[r[0],r[4]]),
 [['r1',-3000],['r3',-1500]],'up to the 5000 left out: 3000, then 2500 does not fit the 2000 left (it stays with the representative), 1500 does, 600 no more');
eq(returnsOf(inv('r5',{customerId:'cA',type:'return',date:'2026-10-27',value:-100}),inv('r6',{customerId:'cB',type:'return',date:'2026-10-29',value:-100}),inv('r7',{customerId:'',type:'return',date:'2026-10-29',value:-100}),inv('r8',{customerId:'cA',type:'return',date:'2026-10-29',value:-100,refs:['Qut-999']}),inv('r9',{customerId:'cA',type:'return',date:'2026-10-29',value:-100,source:'crm'})),[],
 'never one before the first full sale, of another customer, of no single customer, naming a quotation, or a manual return');
eq(S.attributeSales({cases:[keptCase],quotes:[keptQuote],invoices:[rsale,inv('r10',{customerId:'cA',refs:['Qut-600'],type:'return',date:'2026-10-29',value:-4000}),inv('r11',{customerId:'cA',type:'return',date:'2026-10-30',value:-1000}),inv('r12',{customerId:'cA',type:'return',date:'2026-10-31',value:-1})],contacts:[],supportDays:60}).map(a=>[a.id,a.category,a.value]),
 [['r0','full',5000],['r10','full',-4000],['r11','full',-1000]],'a return naming the quotation counts first; each document once');
eq([S.FULL_SALES_LINE,S.salesCategoryLabels.full,S.salesCategoryLabels.shared,S.salesCategoryLabels.support],['منها مبيعات خدمة العملاء بالكامل','مبيعات بالكامل','مبيعات بالمشاركة','مبيعات بالمساندة'],'the words of the line and the categories');

// ---- D. the role task
const service=new Set(['cs','cs2','csm']);
eq([S.roleTaskTarget({held:true,ownerId:'cs2',registrarId:'cs'},service),S.roleTaskTarget({held:false,ownerId:'rep',registrarId:'cs'},service),S.roleTaskTarget({held:false,ownerId:'rep',registrarId:'owner'},service,'csm'),S.roleTaskTarget({held:false,ownerId:'rep',registrarId:'owner'},service,null),S.roleTaskTarget({held:true,ownerId:'gone',registrarId:'cs'},service)],
 [{memberId:'cs2',basis:'owner'},{memberId:'cs',basis:'registrar'},{memberId:'csm',basis:'support'},null,{memberId:'cs',basis:'registrar'}],'the owner, else the registrar, else whoever handled a support request from it; nobody active: none');
eq([S.roleTaskLate('2026-11-15T05:00:00.000Z','2026-11-17T09:00:00.000Z'),S.roleTaskLate('2026-11-15T05:00:00.000Z','2026-11-17T10:00:00.000Z'),S.roleTaskHours('2026-11-12T15:00:00.000Z','2026-11-15T06:00:00.000Z'),S.ROLE_TASK_HOURS],[false,true,11,24],'late after 24 working hours (Sunday 08:00 to Tuesday 12:00 is 24: not yet; one hour more: late); Thursday evening to Sunday 09:00 is 11 (Friday is off, Saturday works)');
eq([S.roleTaskSchema.safeParse({roles:[],note:'x'.repeat(10)}).success,S.roleTaskSchema.safeParse({roles:['جلب العميل'],note:'قصيرة'}).success,S.roleTaskSchema.safeParse({roles:['جلب العميل'],note:'تواصلت مع العميل'}).success,S.roleTaskSchema.safeParse({roles:['دور آخر'],note:'تواصلت مع العميل'}).success],[false,false,true,false],'a role from the list at least, and a note of 10 letters');

// ---- E. the dashboard
const perfMembers=[{id:'cs',name:'أ',role:'customer_service',supervisorId:'csm'},{id:'cs2',name:'ب',role:'customer_service',supervisorId:'csm'}];
const perfCases=[kase('k1',{held:true,ownerId:'cs2',route:'service',createdAt:'2026-11-01T06:00:00.000Z',routedAt:'2026-11-01T07:00:00.000Z'}),kase('k2',{customerId:'c2',route:'sales',createdAt:'2026-11-02T06:00:00.000Z',leadGroup:'system',leadSource:'شكوى'}),kase('k4',{customerId:'c4',approved:false,route:null,createdAt:'2026-11-03T06:00:00.000Z',leadGroup:null,leadSource:null})];
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
eq([K.REP_METRICS.map(k=>live.rep[k].weight),live.supportSalesDays,K.settingsProblem(live)],[[13,13,13,13,9,8,8,8,15],30,''],'settings saved with the old defaults: the new defaults, valid (the window 30 days)');
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
eq([three.numerator,three.denominator,Math.round(three.actual*10)/10,three.target,three.weight,three.measured,Math.round(three.achieved*1000)/1000],[2,3,66.7,100,15,true,0.667],'three of the member\'s closings in the month: won or lost with an invoice count as converted; 66.7% of a 100% target (decision 1)');
eq(Math.round(three.points*100)/100,10,'so it earns 10 of its 15 points');
const all=card([fact('a','2026-11-03T06:00:00.000Z',true),fact('b','2026-11-04T06:00:00.000Z',false,true),fact('c','2026-11-05T06:00:00.000Z',true)]);
eq([all.actual,all.achieved,all.points],[100,1,15],'every closing converted: 100% of the target, the whole 15');
const none=card([fact('a','2026-11-03T06:00:00.000Z',false),fact('b','2026-11-04T06:00:00.000Z',false),fact('c','2026-11-05T06:00:00.000Z',false)]);
eq([none.actual,none.achieved,none.points,none.measured],[0,0,0,true],'none converted: none of the 15, still measured');
eq(three.items.map(i=>i.tag),['won','lost_invoiced','lost'],'each case says why');
eq(card(undefined).denominator,0,'an input without the facts: no cases');

console.log(JSON.stringify({checks}));
