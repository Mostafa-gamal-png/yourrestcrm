// The monthly evaluation of customer service, as pure functions over an in-memory company built from the same compiled domain
// modules as production: each representative's eight figures and each manager's eight figures from the complaints, assistance
// requests, service requests and audits of a month; how a figure with too few cases is left out and its weight shared; that a
// representative is not charged for sending a complaint back to sales; that a finished month gives the same answer however late
// it is asked; the closed-month certificate and drift; the settings and their validation; the audit marks and the stable
// sample; and who may see which card. Every expected number below was worked out by hand from the dates in the fixture
// (Riyadh is UTC+3; working time is Saturday to Thursday, 08:00 to 18:00, so 05:00 to 15:00 UTC; 2026-09-06 is a Sunday).
// No database, no network, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'service-kpi-')),seen=new Set();
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
compile('lib/service-kpi.ts');compile('lib/crm.ts');
const K=await import(path.join(out,'lib/service-kpi.mjs')),CRM=await import(path.join(out,'lib/crm.mjs'));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual===undefined?undefined:JSON.parse(JSON.stringify(actual)),expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const r1=value=>value===null?null:Math.round(value*10)/10;

// ---- the tables the page translates from
eq([K.REP_METRICS.length,K.MANAGER_METRICS.length,K.AUDIT_CRITERIA.length],[8,8,7],'eight figures for a representative, eight for a manager, seven audit criteria');
for(const [keys,ar,en] of [[K.REP_METRICS,K.repMetricLabels,K.repMetricLabelsEn],[K.MANAGER_METRICS,K.managerMetricLabels,K.managerMetricLabelsEn],[K.AUDIT_CRITERIA,K.auditCriterionLabels,K.auditCriterionLabelsEn]])eq([Object.keys(ar),Object.keys(en)],[[...keys],[...keys]],'every figure and criterion has an Arabic and an English name');
eq(K.SERVICE_KPI_KINDS,['service_audit','service_kpi_month','service_kpi_settings'],'the three record kinds');
eq([K.AUDIT_DELETE_DAYS,K.REPEAT_COMPLAINT_DAYS],[7,30],'constants');
eq(K.monthRowId('csm','2026-09'),'service-kpi-month-csm-2026-09','a closed month\'s row id');
eq(K.monthRowId('','2026-09'),'service-kpi-month-none-2026-09','and the one of representatives without a manager');

// ---- the settings: the sheet's values, valid, and exactly what is wrong when they are not
const D=K.DEFAULT_SERVICE_KPI_SETTINGS;
eq(K.settingsProblem(D),'','the defaults are valid');
eq([Object.values(D.rep).reduce((s,x)=>s+x.weight,0),Object.values(D.manager).reduce((s,x)=>s+x.weight,0),Object.values(D.audit.criteria).reduce((s,x)=>s+x,0)],[100,100,100],'each card\'s weights and the audit marks add up to 100');
eq([D.hours,D.life,D.audit.pass,D.audit.coach,D.audit.sample,D.closeGraceDays],[{support:4,missed:4,closure:24,review:4},{normal:82,high:48},90,80,3,5],'hours, whole-complaint targets, audit thresholds, sample and waiting days');
eq(Object.fromEntries(Object.entries(D.rep).map(([k,v])=>[k,[v.target,v.weight,v.min]])),{support_response:[90,15,5],closure_timing:[95,15,5],closures_held:[90,15,5],audit_quality:[90,15,3],missed_visits:[95,10,5],registration_accuracy:[98,10,5],clearance:[90,10,5],customer_rating:[90,10,5]},'the representative\'s targets, weights and least cases');
eq(Object.fromEntries(Object.entries(D.manager).map(([k,v])=>[k,[v.target,v.weight,v.min]])),{team_average:[85,25,1],review_timing:[90,15,5],life_timing:[95,15,5],team_rating:[90,10,5],team_support_response:[90,10,5],team_quality:[90,10,3],backlog:[95,10,0],repeat_complaints:[95,5,5]},'the manager\'s targets, weights and least cases');
const mutate=change=>{const copy=JSON.parse(JSON.stringify(D));change(copy);return K.settingsProblem(copy);};
ok(/الممثل.*99/.test(mutate(s=>{s.rep.clearance.weight=9;})),'a representative card that adds up to 99 is refused, saying so');
ok(/المدير.*101/.test(mutate(s=>{s.manager.backlog.weight=11;})),'a manager card that adds up to 101 is refused');
ok(/بين 1 و100/.test(mutate(s=>{s.rep.clearance.target=0;})),'a target of zero is refused');
ok(/بين 1 و100/.test(mutate(s=>{s.manager.backlog.target=101;})),'and one above 100');
ok(/عدد صحيح/.test(mutate(s=>{s.rep.clearance.weight=10.5;s.rep.customer_rating.weight=9.5;})),'a fractional weight is refused');
ok(/الحد الأدنى/.test(mutate(s=>{s.rep.clearance.min=-1;})),'a negative least number of cases is refused');
ok(/معايير التدقيق.*99/.test(mutate(s=>{s.audit.criteria.greeting=9;})),'audit marks that add up to 99 are refused');
ok(/معيار/.test(mutate(s=>{s.audit.criteria.greeting=0;s.audit.criteria.closing=20;})),'an audit criterion worth nothing is refused');
ok(/ناجح/.test(mutate(s=>{s.audit.coach=90;})),'a coaching threshold that is not below the pass threshold is refused');
ok(/ساعات المهل/.test(mutate(s=>{s.hours.support=0;})),'a zero-hour limit is refused');
ok(/ساعات المهل/.test(mutate(s=>{s.hours.closure=Number.NaN;})),'and a number that is not a number');
ok(/مهلة الشكوى كاملة/.test(mutate(s=>{s.life.high=0;})),'a whole-complaint limit of zero is refused');
ok(/العينة/.test(mutate(s=>{s.audit.sample=21;})),'a sample above 20 is refused');
ok(/الانتظار/.test(mutate(s=>{s.closeGraceDays=31;})),'more than 30 waiting days is refused');
eq(K.normalizeSettings(undefined),D,'nothing given is the defaults');
eq(K.normalizeSettings('garbage'),D,'garbage is the defaults');
eq(K.normalizeSettings({rep:{support_response:{target:50}},hours:{support:6},closeGraceDays:'x'}).rep.support_response,{target:50,weight:15,min:5},'a partly given metric keeps its other values');
eq([K.normalizeSettings({hours:{support:6}}).hours,K.normalizeSettings({closeGraceDays:'x'}).closeGraceDays],[{support:6,missed:4,closure:24,review:4},5],'missing or non-numeric values fall back to the defaults');

// ---- time
eq([K.kpiDay('2026-09-30T21:00:00.000Z'),K.kpiMonthOf('2026-09-30T20:59:59.000Z'),K.kpiMonthOf('2026-09-30T21:00:00.000Z')],['2026-10-01','2026-09','2026-10'],'the month turns at 21:00 UTC, midnight in Riyadh');
eq([K.monthStart('2026-09'),K.monthEnd('2026-09'),K.monthEnd('2026-12'),K.nextMonth('2026-12')],['2026-08-31T21:00:00.000Z','2026-09-30T21:00:00.000Z','2026-12-31T21:00:00.000Z','2027-01'],'a month starts and ends at Riyadh midnight');
eq(K.kpiDay('not a date'),'','an unreadable instant is no day');

// ---- the company: a manager with two active representatives and an idle one, a second manager whose team has an active, a departed
// one with September work and a departed one without, a manager of the other branch, and a representative nobody manages
const pad=n=>String(n).padStart(2,'0');
const T=(day,hour,min=0)=>`2026-09-${pad(day)}T${pad(hour)}:${pad(min)}:00.000Z`;
const AUG31=hour=>`2026-08-31T${pad(hour)}:00:00.000Z`;
const m=(id,role,supervisorId,branch='الرئيسي',active=1)=>({id,userId:'u-'+id,email:id+'@yourrest.org',name:'عضو '+id,role,branch,supervisorId,regionScope:'all',active,target:0});
const members=[m('owner','admin'),m('sm','manager'),m('sup','supervisor','sm'),m('rep','rep','sup'),
 m('csm','customer_service_manager'),m('csm2','customer_service_manager'),m('csm3','customer_service_manager',undefined,'فرع آخر'),
 m('cs1','customer_service','csm'),m('cs2','customer_service','csm'),m('cs_idle','customer_service','csm'),
 m('cs3','customer_service','csm2'),m('cs_left','customer_service','csm2','الرئيسي',0),m('cs_gone','customer_service','csm2','الرئيسي',0),
 m('cs_free','customer_service',undefined)];
const complaint=(id,customerId,registrar,events,extra={})=>{
 const list=events.map(([at,by,action,more])=>({at,by,action,...(more||{})}));
 return {id:'complaint-'+id,branch:'الرئيسي',assignedTo:registrar,createdAt:list[0].at,updatedAt:list.at(-1).at,version:1,data:{kind:'complaint',customerId,status:'assigned',registrarId:registrar,serviceManagerId:'csm',severity:'normal',events:list,...extra}};
};
const support=(id,{origin='rep',handler,requestedAt,handlerAt=requestedAt,result,cancelledAt,branch='الرئيسي',customerId='c1'})=>({id:'support-'+id,branch,assignedTo:handler||'',createdAt:requestedAt,updatedAt:result||requestedAt,version:1,
 data:{kind:'support',customerId,origin,status:result?'done':cancelledAt?'cancelled':'open',requestedBy:'rep',requestedAt,repId:'rep',note:'',channel:'any',handlerId:handler||'',handlerAt:handler?handlerAt:'',handlerBy:'x',...(result?{result:{outcome:'other',note:'xxx',nextDate:'',by:handler,at:result}}:{}),...(cancelledAt?{cancelledAt}:{})}});
const serviceCase=(id,creatorId,customerId,createdAt,data)=>({id:'case-'+id,customerId,status:'assigned',creatorId,serviceManagerId:'csm',salesManagerId:null,assignedTo:null,supervisorId:null,data,createdAt,updatedAt:createdAt,version:1});
const audit=(id,repId,month,total,extra={})=>({id:'audit-'+id,branch:'الرئيسي',assignedTo:'csm',createdAt:extra.at||T(20,6),updatedAt:extra.at||T(20,6),version:1,
 data:{kind:'service_audit',repId,month,date:'',reference:{type:extra.refType||'',id:extra.ref||''},scores:{},total,result:total>=90?'pass':total>=80?'coach':'fail',verification:{called:false,rating:null},note:'',auditorId:'csm',at:extra.at||T(20,6)}});

const complaints=[
 // A: registered Sunday 08:00 Riyadh, forwarded after 1 hour, resolved Monday 08:00, confirmed and closed 2 hours later with a 5
 complaint('A','c1','cs1',[[T(6,5),'cs1','register'],[T(6,6),'csm','forward',{targetId:'sm'}],[T(6,8),'sm','assign',{targetId:'rep'}],[T(7,5),'rep','resolve',{outcome:'solved'}],[T(7,7),'cs1','close',{outcome:'satisfied',rating:5}]]),
 // B: high; returned after an hour, corrected, forwarded; resolved Tuesday, sent back by the representative 20 working hours later, resolved again Thursday 10:00, closed Saturday with a 3, reopened on the 20th
 complaint('B','c2','cs1',[[T(6,6),'cs1','register'],[T(6,7),'csm','return',{text:'x'}],[T(6,8),'cs1','edit'],[T(6,9),'csm','forward'],[T(6,11),'sm','assign'],[T(8,5),'rep','resolve'],[T(10,5),'cs1','reject',{text:'x'}],[T(10,7),'rep','resolve'],[T(12,5),'cs1','close',{outcome:'satisfied',rating:3}],[T(20,6),'cs1','reopen',{text:'x'}]],{severity:'high'}),
 // C: forwarded after 6 hours (late); resolved Wednesday; the representative has not confirmed it since
 complaint('C','c3','cs1',[[T(7,5),'cs1','register'],[T(7,11),'csm','forward'],[T(7,12),'sm','assign'],[T(9,5),'rep','resolve']]),
 // D: registered and cancelled within the hour, before any review
 complaint('D','c4','cs1',[[T(8,5),'cs1','register'],[T(8,6),'cs1','cancel']]),
 // E: the same customer as A; closed Thursday 30 working hours after the resolution, with a 4; its two weeks end on 1 October
 complaint('E','c1','cs1',[[T(13,5),'cs1','register'],[T(13,6),'csm','forward'],[T(13,7),'sm','assign'],[T(14,5),'rep','resolve'],[T(17,5),'cs1','close',{outcome:'satisfied',rating:4}]]),
 // G: registered on the 29th by the second representative; nothing since
 complaint('G','c5','cs2',[[T(29,5),'cs2','register']]),
 // F: the other manager's team: forwarded after an hour by him, closed two hours after the resolution with a 5
 complaint('F','c6','cs3',[[T(8,5),'cs3','register'],[T(8,6),'csm2','forward'],[T(8,7),'sm','assign'],[T(9,5),'rep','resolve'],[T(9,7),'cs3','close',{outcome:'satisfied',rating:5}]],{serviceManagerId:'csm2'}),
 // R and Q: nobody\'s manager; R is reopened exactly when its two weeks end, Q an hour after they ended
 complaint('R','c7','cs_free',[[T(1,5),'cs_free','register'],[T(1,6),'owner','forward'],[T(1,7),'sm','assign'],[T(2,5),'rep','resolve'],[T(2,6),'cs_free','close',{outcome:'satisfied'}],[T(16,6),'cs_free','reopen']],{serviceManagerId:''}),
 complaint('Q','c8','cs_free',[[T(1,5),'cs_free','register'],[T(1,6),'owner','forward'],[T(1,7),'sm','assign'],[T(3,5),'rep','resolve'],[T(3,6),'cs_free','close',{outcome:'satisfied'}],[T(17,7),'cs_free','reopen']],{serviceManagerId:''}),
 // a damaged row: no events at all
 {id:'complaint-X',branch:'الرئيسي',assignedTo:'cs_gone',createdAt:T(5,5),updatedAt:T(5,5),version:1,data:{kind:'complaint',customerId:'c9',status:'submitted',registrarId:'cs_gone',serviceManagerId:'csm2',severity:'normal'}}
];
const supports=[
 support('S0',{handler:'cs1',requestedAt:AUG31(5),result:T(1,6)}),
 support('S1',{handler:'cs1',requestedAt:T(6,5),result:T(6,7)}),
 support('S2',{handler:'cs1',requestedAt:T(7,5),handlerAt:T(7,6),result:T(7,12)}),
 support('S3',{handler:'cs1',requestedAt:T(8,5),result:T(8,8)}),
 support('M1',{origin:'missed_visit',handler:'cs1',requestedAt:T(9,5),result:T(9,7)}),
 support('M2',{origin:'missed_visit',handler:'cs1',requestedAt:T(10,5),result:T(12,5)}),
 support('S4',{handler:'cs1',requestedAt:T(29,5)}),
 support('S5',{handler:'cs1',requestedAt:T(30,14)}),
 support('S6',{handler:'cs_x',requestedAt:T(20,5),branch:'فرع آخر'}),
 support('S7',{handler:'cs3',requestedAt:T(15,5),result:T(15,6)}),
 support('S8',{handler:'cs_free',requestedAt:T(16,5),result:T(16,6)}),
 support('S9',{handler:'cs_left',requestedAt:T(9,5),result:T(9,6)})
];
const serviceCases=[
 serviceCase('SC1','cs1','c1',T(6,5),{approvedBy:'csm',approvedAt:T(6,7)}),
 serviceCase('SC2','cs1','c2',T(8,5),{resubmittedAt:T(9,5),approvedBy:'csm',approvedAt:T(9,6)})
];
const audits=[audit('AU1','cs1','2026-09',88),audit('AU2','cs1','2026-09',94),audit('AU3','cs2','2026-09',90),audit('AU4','cs3','2026-09',70),audit('AU5','cs1','2026-08',50)];
const NOW='2026-10-12T12:00:00.000Z';
// every figure counts from a single case; the default least-case numbers are tried separately below
const S1=K.normalizeSettings({});for(const card of [S1.rep,S1.manager])for(const key of Object.keys(card))card[key].min=1;S1.manager.backlog.min=0;
const input=(over={})=>({members,complaints,support:supports,serviceCases,audits,closed:[],settings:S1,...over});
const run=(month='2026-09',now=NOW,over={})=>K.serviceKpiMonth(input(over),month,now);
const group=(month,id)=>month.groups.find(g=>g.managerId===id);
const card=(g,id)=>g.reps.find(c=>c.memberId===id)||(g.manager&&g.manager.memberId===id?g.manager:undefined);
const metric=(c,key)=>c.metrics.find(x=>x.key===key);
const nd=(c,key)=>[metric(c,key).numerator,metric(c,key).denominator];
const actual=(c,key)=>r1(metric(c,key).actual);
const refs=(c,key,test=()=>true)=>metric(c,key).items.filter(test).map(i=>i.ref).sort();

// ---- September, asked after it ended
const sept=run();
eq([sept.month,sept.groups.map(g=>g.managerId)],['2026-09',['csm','csm2','csm3','']],'four groups: the three managers by name, then the representatives nobody manages');
const g1=group(sept,'csm');
eq(g1.reps.map(c=>[c.memberId,c.score]),[['cs2',100],['cs1',73.9],['cs_idle',null]],'the manager\'s team by score, the idle one last without a score');
const cs1=card(g1,'cs1');
eq(cs1.metrics.map(x=>x.key),[...K.REP_METRICS],'the figures in their fixed order');

// the representative's eight figures
eq([nd(cs1,'support_response'),actual(cs1,'support_response')],[[2,4],50],'support response: S1 and S3 in time; S0 (11 working hours) and S2 (6 hours from when it became his) late');
eq(refs(cs1,'support_response',i=>i.ok),['support-S1','support-S3'],'which ones were in time');
eq(metric(cs1,'support_response').items.map(i=>i.value).sort((a,b)=>a-b),[2,3,6,11],'their hours');
eq([nd(cs1,'closure_timing'),actual(cs1,'closure_timing')],[[3,4],75],'closure confirmation: A 2 hours, the send-back of B after 20 hours, its closure after 8 hours; E after 30 hours is late');
eq(metric(cs1,'closure_timing').items.map(i=>[i.tag,i.value,i.ok]).sort((a,b)=>a[1]-b[1]),[['close',2,true],['close',8,true],['reject',20,true],['close',30,false]],'sending a complaint back counts as confirming it, in time');
eq([nd(cs1,'closures_held'),actual(cs1,'closures_held')],[[1,2],50],'closures that held: A held for two weeks; B was reopened on the 20th; E\'s two weeks end in October');
eq(metric(cs1,'closures_held').items.map(i=>[i.ref,i.tag,i.at]).sort(),[['complaint-A','held',T(21,7)],['complaint-B','reopened',T(20,6)]],'each decided on the day it was known');
eq([nd(cs1,'audit_quality'),actual(cs1,'audit_quality')],[[182,2],91],'quality: the two September audits, not August\'s');
eq([nd(cs1,'missed_visits'),actual(cs1,'missed_visits')],[[1,2],50],'missed visits: M1 in 2 hours, M2 after 10 working hours (Friday is off)');
eq([nd(cs1,'registration_accuracy'),actual(cs1,'registration_accuracy')],[[4,6],66.7],'registration: A, C, E and the first service request passed review first time; B and the resubmitted request did not; D was never reviewed');
eq(metric(cs1,'registration_accuracy').items.map(i=>[i.ref,i.tag]).sort(),[['case-SC1','approved'],['case-SC2','resubmitted'],['complaint-A','forward'],['complaint-B','return'],['complaint-C','forward'],['complaint-E','forward']],'the cases of that figure');
eq([nd(cs1,'clearance'),actual(cs1,'clearance')],[[11,13],84.6],'clearance: 11 cleared of 13; C waiting for confirmation and S4 are past their time; S5 arrived 1 hour before the month ended and is left out');
eq(refs(cs1,'clearance',i=>!i.ok),['complaint-C','support-S4'],'the two not cleared');
ok(!metric(cs1,'clearance').items.some(i=>i.ref==='support-S5'),'an item that has not used up its time is not counted against them');
ok(metric(cs1,'clearance').items.some(i=>i.ref==='support-S0'&&i.ok),'work that arrived in August and was done in September is counted in September');
eq([nd(cs1,'customer_rating'),actual(cs1,'customer_rating')],[[12,3],80],'customer rating: 5, 3 and 4 average 4 of 5');
eq(cs1.score,73.9,'the score: points 8.33+11.84+8.33+15+5.26+6.80+9.40+8.89 of 100');
eq(cs1.measuredWeight,100,'every figure was measured');
eq(r1(cs1.metrics.reduce((s,x)=>s+x.points,0)),73.9,'and the points add up to it');
ok(cs1.metrics.every(x=>x.measured&&x.enough),'with one case each every figure counts');
const cs2=card(g1,'cs2');
eq([cs2.score,cs2.measuredWeight,cs2.metrics.filter(x=>x.measured).map(x=>x.key)],[100,15,['audit_quality']],'a representative with one audit and nothing else is measured on it alone, and its weight is the whole');
const idle=card(g1,'cs_idle');
eq([idle.score,idle.measuredWeight,idle.metrics.every(x=>!x.measured&&x.actual===null&&x.points===0)],[null,0,true],'a representative with nothing in the month has no score, not a zero');

// the manager's eight figures
const csm=g1.manager;
eq([csm.memberId,csm.role,csm.metrics.map(x=>x.key)],['csm','manager',[...K.MANAGER_METRICS]],'the manager\'s card');
eq([nd(csm,'team_average'),actual(csm,'team_average')],[[173.9,2],87],'team average: of the two representatives with a score, not the idle one');
eq([nd(csm,'review_timing'),actual(csm,'review_timing')],[[6,7],85.7],'review: A, B twice and E in an hour, C after 6 hours, both service requests in time');
eq(refs(csm,'review_timing',i=>!i.ok),['complaint-C'],'only C was late');
eq([nd(csm,'life_timing'),actual(csm,'life_timing')],[[2,3],66.7],'whole complaint: A 12 hours, E 40 hours, B 49 hours against 48 for a high one');
eq(metric(csm,'life_timing').items.map(i=>[i.ref,i.value,i.ok]).sort(),[['complaint-A',12,true],['complaint-B',49,false],['complaint-E',40,true]],'their hours; the first registration counts, not the resubmission');
eq([nd(csm,'team_rating'),actual(csm,'team_rating')],[[12,3],80],'the team\'s ratings');
eq([nd(csm,'team_support_response'),actual(csm,'team_support_response')],[[3,6],50],'assistance answered in time from when it was asked: S1, S3, M1 in time; S0, S2 (7 hours), M2 late');
eq([nd(csm,'team_quality'),actual(csm,'team_quality')],[[272,3],90.7],'the team\'s three audits');
eq([nd(csm,'backlog'),actual(csm,'backlog')],[[2,5],40],'backlog at the end of the month: B (reopened) and C past their time, G in time; S4 past its, S5 in time; the other branch\'s S6 is not his');
eq(refs(csm,'backlog',i=>i.ok),['complaint-G','support-S5'],'the two in time');
eq([nd(csm,'repeat_complaints'),actual(csm,'repeat_complaints')],[[5,6],83.3],'repeat complaints: E is the second from customer c1 within a month');
eq(csm.score,82.9,'the manager\'s score');
eq(csm.metrics.filter(x=>x.measured).length,8,'all eight measured');

// the other groups and the departed
const g2=group(sept,'csm2');
eq(g2.reps.map(c=>[c.memberId,c.score]),[['cs_left',100],['cs3',96.3]],'the other team: the departed representative with September work is there, the departed one without is not');
eq([card(g2,'cs3').metrics.filter(x=>!x.measured).map(x=>x.key),card(g2,'cs3').measuredWeight],[['missed_visits'],90],'a figure with no case is left out and its weight shared: 86.67 of 90 points is 96.3');
eq(r1(actual(g2.manager,'team_average')),98.2,'the other manager\'s team average');
eq(g2.reps.some(c=>c.memberId==='cs_gone'),false,'a departed representative with nothing in the month is not listed');
eq(card(g2,'cs3').metrics.find(x=>x.key==='closures_held').items.map(i=>i.tag),['held'],'F held (its two weeks ended on the 23rd)');
const gb=group(sept,'csm3');
eq([gb.reps.length,nd(gb.manager,'backlog'),gb.manager.score],[0,[0,1],0],'the other branch\'s manager has no team, and the one request of his branch past its time is all his backlog');
const gn=group(sept,'');
eq([gn.managerName,gn.manager,gn.reps.map(c=>[c.memberId,c.score])],['',null,[['cs_free',89.7]]],'representatives nobody manages are a group without a manager card');
const free=card(gn,'cs_free');
eq([nd(free,'closures_held'),nd(free,'closure_timing'),nd(free,'registration_accuracy')],[[1,2],[2,2],[2,2]],'a reopening exactly at the end of the two weeks counts, one an hour after does not; both closures were in time; both passed review');
eq(free.metrics.filter(x=>x.measured).map(x=>x.key),['support_response','closure_timing','closures_held','registration_accuracy','clearance'],'five figures were measured');

// ---- a finished month gives the same answer however late it is asked
const strip=month=>JSON.stringify({...month,generatedAt:''});
eq(strip(run('2026-09','2026-10-12T12:00:00.000Z'))===strip(run('2026-09','2026-12-20T09:00:00.000Z')),true,'September asked in October or in December is the same');
eq(strip(run('2026-09','2026-10-01T00:00:00.000Z'))===strip(run('2026-09','2027-03-01T00:00:00.000Z')),true,'asked the day it ended or half a year later');

// ---- October: what was decided in October counts there; what is still waiting carries over until it is dealt with
const oct=run('2026-10');
const octCs1=card(group(oct,'csm'),'cs1');
eq([nd(octCs1,'closures_held'),octCs1.metrics.find(x=>x.key==='closures_held').items.map(i=>[i.ref,i.tag,i.at])],[[1,1],[['complaint-E','held',T(17,5).replace('09-17','10-01')]]],'E\'s two weeks ended on 1 October, so it counts there');
eq([nd(octCs1,'clearance'),refs(octCs1,'clearance')],[[0,3],['complaint-C','support-S4','support-S5']],'the three items still waiting are all past their time by October and none was cleared');
eq([nd(octCs1,'support_response'),nd(octCs1,'closure_timing'),nd(octCs1,'registration_accuracy')],[[0,0],[0,0],[0,0]],'nothing else happened in October');
eq([octCs1.score,octCs1.measuredWeight],[60,25],'the October score: the held closure at 100% of 15 points, the clearance at 0% of 10, over the 25 that were measured');
eq(nd(group(oct,'csm').manager,'backlog'),[0,5],'in October everything still open is past its time: B, C and G, S4 and S5');

// ---- the month that is still running: only what has happened by then counts
const mid=run('2026-09','2026-09-20T12:00:00.000Z');
const midCs1=card(group(mid,'csm'),'cs1');
eq([nd(midCs1,'closures_held'),nd(midCs1,'support_response'),nd(midCs1,'registration_accuracy')],[[0,1],[2,4],[4,6]],'on the 20th only B was decided (reopened that morning); A\'s two weeks end tomorrow');
eq(nd(midCs1,'clearance'),[11,12],'C is past its time; S4 and S5 have not arrived yet');
eq(nd(group(mid,'csm').manager,'backlog'),[0,2],'on the 20th B and C are the only open complaints and both are past their time; G and the requests of the 29th and 30th do not exist yet');
eq(group(mid,'csm').reps.find(c=>c.memberId==='cs1').metrics.find(x=>x.key==='customer_rating').denominator,3,'the three ratings were all given by the 17th');

// ---- settings change the answer
const slower=run('2026-09',NOW,{settings:K.normalizeSettings({...JSON.parse(JSON.stringify(S1)),hours:{...S1.hours,closure:48}})});
eq(nd(card(group(slower,'csm'),'cs1'),'closure_timing'),[4,4],'with 48 hours to confirm a closure E is in time too');
const reweighted=JSON.parse(JSON.stringify(S1));reweighted.rep.audit_quality.weight=25;reweighted.rep.customer_rating.weight=0;
eq(K.settingsProblem(reweighted),'','the new weights are valid');
const heavy=card(group(run('2026-09',NOW,{settings:reweighted}),'csm'),'cs1');
eq([heavy.score,heavy.measuredWeight,heavy.metrics.find(x=>x.key==='customer_rating').measured],[75,100,false],'the audit counts for more and the rating not at all: its figure is shown but not measured');
eq(metric(heavy,'customer_rating').actual,80,'a figure with no weight is still shown');

// ---- the least number of cases: with the sheet's numbers a figure with too few cases is left out, neither raising nor lowering the score
const real=run('2026-09',NOW,{settings:D});
const realCs1=card(group(real,'csm'),'cs1');
eq([realCs1.metrics.filter(x=>x.measured).map(x=>x.key),realCs1.score,realCs1.measuredWeight],[['registration_accuracy','clearance'],81,20],'only registration (6 cases) and clearance (13) reach five cases: (6.80+9.40) of 20 is 81');
eq(realCs1.metrics.filter(x=>!x.enough).map(x=>x.key),['support_response','closure_timing','closures_held','audit_quality','missed_visits','customer_rating'],'the others are marked as not enough');
eq(metric(realCs1,'support_response').actual,50,'the figure is still shown with its cases');
eq(group(real,'csm').manager.metrics.filter(x=>x.measured).map(x=>x.key),['team_average','review_timing','team_support_response','team_quality','backlog','repeat_complaints'],'the manager: whole-complaint time (3 cases) and rating (3 cases) are left out, quality needs three and has three');

// ---- a closed month: the certificate keeps the settings and the team, and notices when the figures move
const certificate=K.monthCertificate(g1,'2026-09','owner','2026-10-07T09:00:00.000Z');
eq([certificate.kind,certificate.month,certificate.managerId,certificate.team,certificate.closedBy,certificate.closedAt],['service_kpi_month','2026-09','csm',['cs2','cs1','cs_idle'],'owner','2026-10-07T09:00:00.000Z'],'the certificate names the team and who closed it');
eq(certificate.scores,{cs2:100,cs1:73.9,cs_idle:null,csm:82.9},'and the scores reached');
eq(certificate.settings,g1.settings,'and the settings used');
const row={id:K.monthRowId('csm','2026-09'),branch:'الرئيسي',assignedTo:'owner',data:certificate,createdAt:certificate.closedAt,updatedAt:certificate.closedAt,version:1};
const changed=JSON.parse(JSON.stringify(S1));changed.rep.audit_quality.weight=25;changed.rep.customer_rating.weight=0;
const closed=run('2026-09',NOW,{closed:[row],settings:changed});
const cg=group(closed,'csm'),lg=group(closed,'csm2');
eq([cg.closed,cg.closedAt,cg.closedBy,cg.drift,cg.reps.map(c=>[c.memberId,c.score]),cg.manager.score],[true,certificate.closedAt,'owner',false,[['cs2',100],['cs1',73.9],['cs_idle',null]],82.9],'a closed team keeps its settings and its scores however the live settings change');
eq([lg.closed,card(lg,'cs3').score],[false,card(group(run('2026-09',NOW,{settings:changed}),'csm2'),'cs3').score],'the other team is still live');
const late=audit('AU6','cs1','2026-09',40);
const drifted=run('2026-09',NOW,{closed:[row],audits:[...audits,late]});
eq([group(drifted,'csm').closed,group(drifted,'csm').drift],[true,true],'a late audit changes cs1\'s figure: the closed month is flagged as drifted');
eq(run('2026-09',NOW,{closed:[row],complaints:complaints.slice(1)}).groups.find(g=>g.managerId==='csm').drift,true,'so does a missing complaint');
eq(run('2026-08',NOW,{closed:[row]}).groups.every(g=>!g.closed),true,'a certificate closes its own month only');
eq(K.monthCertificate(group(run('2026-09',NOW,{closed:[row]}),'csm'),'2026-09','owner','x').settings,certificate.settings,'a certificate of a closed team repeats the stored settings');

// ---- a deleted audit and a reopened month leave their rows but stop counting
const deletedOne={...audits[0],data:{...audits[0].data,deleted:{at:T(21,5),by:'csm'}}};
const afterDelete=run('2026-09',NOW,{audits:[deletedOne,...audits.slice(1)]});
eq(nd(card(group(afterDelete,'csm'),'cs1'),'audit_quality'),[94,1],'a deleted audit is not counted: one audit of 94 remains');
eq(K.kpiMonths({complaints:[],support:[],audits:[audit('d','cs1','2026-05',80)].map(r=>({...r,data:{...r.data,deleted:{at:T(1,5),by:'csm'}}})),closed:[]},NOW),['2026-10'],'and its month is not offered');
eq(K.auditSample(input({audits:[...audits,{...audit('AU8','cs1','2026-09',90,{ref:'complaint-A',refType:'complaint'}),data:{...audit('AU8','cs1','2026-09',90,{ref:'complaint-A',refType:'complaint'}).data,deleted:{at:T(21,5),by:'csm'}}}]}),'2026-09','cs1',NOW).length,3,'a deleted audit no longer keeps its case out of the sample');
const reopenedRow={...row,data:{...row.data,reopened:{at:'2026-10-09T09:00:00.000Z',by:'owner'}}};
eq(group(run('2026-09',NOW,{closed:[reopenedRow]}),'csm').closed,false,'a reopened month is evaluated live again');
eq(K.kpiMonths({complaints:[],support:[],audits:[],closed:[{...reopenedRow,data:{...reopenedRow.data,month:'2026-02'}}]},NOW),['2026-10'],'and its month is not offered on the strength of the reopened row');

// ---- who may close a month and when
eq(K.monthCloseProblem('2026-09','2026-10-05T20:59:00.000Z',D),'لا يُقفل الشهر قبل مرور 5 أيام على انتهائه','not before five days have passed');
eq(K.monthCloseProblem('2026-09','2026-10-05T21:00:00.000Z',D),'','from the sixth, at Riyadh midnight');
eq(K.monthCloseProblem('2026-10','2026-10-12T12:00:00.000Z',D),'لا يُقفل الشهر قبل مرور 5 أيام على انتهائه','a running month cannot be closed');
eq(K.monthCloseProblem('2026-09','2026-09-30T21:00:00.000Z',{...D,closeGraceDays:0}),'','with no waiting days, the moment it ends');
eq(K.monthCloseProblem('2026-09','2026-09-30T20:00:00.000Z',{...D,closeGraceDays:0}),'لا يُقفل الشهر قبل أن ينتهي','but not before');
eq(K.monthCloseProblem('2026-13','2026-12-12T12:00:00.000Z',D),'اختر شهرًا صحيحًا','an impossible month');

// ---- who sees which card
const seen_=id=>K.visibleKpi(sept,members.find(x=>x.id===id));
eq(seen_('owner').groups.map(g=>g.managerId),['csm','csm2','csm3',''],'an administrator sees every group');
eq(seen_('csm').groups.map(g=>[g.managerId,g.reps.map(c=>c.memberId),g.manager&&g.manager.memberId]),[['csm',['cs2','cs1','cs_idle'],'csm']],'a manager sees his team and himself, nobody else\'s');
eq(seen_('csm2').groups.map(g=>g.managerId),['csm2'],'the other manager sees his own');
const own=seen_('cs1');
eq(own.groups.map(g=>[g.managerId,g.managerName,g.manager,g.reps.map(c=>c.memberId)]),[['csm','عضو csm',null,['cs1']]],'a representative sees only their own card, without the manager\'s and without a colleague\'s');
eq(seen_('cs_free').groups.map(g=>[g.managerId,g.reps.map(c=>c.memberId)]),[['',['cs_free']]],'a representative nobody manages sees theirs');
eq(seen_('cs_gone').groups,[],'a representative with no card sees nothing');
for(const id of ['sm','sup','rep'])eq(seen_(id).groups,[],`${id} (sales) sees nothing`);
eq(['admin','customer_service','customer_service_manager','manager','supervisor','rep','x'].map(K.serviceKpiAllowed),[true,true,true,false,false,false,false],'only administrators and customer service may use the evaluation');

// ---- the months on offer
eq(K.kpiMonths({complaints,support:supports,audits,closed:[]},NOW),['2026-10','2026-09','2026-08'],'newest first; October because it is now, August because of an audit and a service-day record');
eq(K.kpiMonths({complaints:[],support:[],audits:[audit('f','cs1','2026-12',80)],closed:[]},NOW),['2026-10'],'a future month is not offered, the current one always is');
eq(K.kpiMonths({complaints:[],support:[],audits:[],closed:[]},'2026-01-05T09:00:00.000Z'),['2026-01'],'with no data at all, just the current month');

// ---- audits: marks, total, result, and the sample
const marks={greeting:10,understanding:15,accuracy:20,ownership:15,communication:15,resolution:15,closing:10};
eq(K.auditTotal(marks,D),{ok:true,total:100},'full marks make 100');
eq(K.auditTotal({...marks,accuracy:12,closing:5},D),{ok:true,total:87},'less in two criteria');
eq(K.auditTotal({...marks,accuracy:21},D),{ok:false,error:'درجة «دقة المعلومة والتسجيل» بين 0 و20'},'above a criterion\'s mark is refused, naming it');
eq(K.auditTotal({...marks,greeting:-1},D).ok,false,'below zero is refused');
eq(K.auditTotal({...marks,greeting:7.5},D).ok,false,'a fraction is refused');
eq(K.auditTotal({...marks,greeting:'9'},D).ok,false,'text is refused');
eq(K.auditTotal({greeting:10},D).ok,false,'a missing criterion is refused');
eq([100,90,89,80,79,0].map(total=>K.auditResult(total,D)),['pass','pass','coach','coach','fail','fail'],'pass from 90, coaching from 80');
eq(K.auditResult(75,{...D,audit:{...D.audit,pass:85,coach:70}}),'coach','the thresholds come from the settings');
const cands=K.auditCandidates(input(),'2026-09','cs1',NOW);
eq(cands.map(c=>c.ref+':'+c.tag).sort(),['complaint-A:close','complaint-B:close','complaint-B:reject','complaint-E:close','support-M1:missed','support-M2:missed','support-S0:support','support-S1:support','support-S2:support','support-S3:support'],'what the manager could audit: what cs1 closed, sent back or answered in September');
const sample=K.auditSample(input(),'2026-09','cs1',NOW);
eq(sample.length,3,'three are suggested');
eq(JSON.stringify(sample)===JSON.stringify(K.auditSample(input(),'2026-09','cs1',NOW)),true,'the same three every time it is asked');
ok(sample.every(s=>cands.some(c=>c.ref===s.ref&&c.tag===s.tag)),'all from the candidates');
eq(sample.map(s=>s.at),[...sample.map(s=>s.at)].sort(),'shown in the order they happened');
const withAudit=K.auditSample(input({audits:[...audits,audit('AU7','cs1','2026-09',90,{ref:sample[0].ref,refType:sample[0].type})]}),'2026-09','cs1',NOW);
ok(!withAudit.some(s=>s.ref===sample[0].ref),'what was audited already is not suggested again');
eq(withAudit.length,3,'and another takes its place');
ok(K.auditSample(input(),'2026-09','cs2',NOW).length===0,'a representative with nothing finished has no sample');
eq(K.auditSample(input({settings:{...S1,audit:{...S1.audit,sample:0}}}),'2026-09','cs1',NOW),[],'a sample size of zero suggests nothing');
eq(K.auditSample(input({settings:{...S1,audit:{...S1.audit,sample:20}}}),'2026-09','cs1',NOW).length,10,'a larger sample than there is work gives all of it');
eq(K.sampleOrder('a')===K.sampleOrder('a')&&K.sampleOrder('a')!==K.sampleOrder('b'),true,'the order is a stable hash');

// ---- a rating is a whole number from 1 to 5, or it is not a rating
const odd=complaint('H','c1','cs1',[[T(2,5),'cs1','register'],[T(2,6),'csm','forward'],[T(3,5),'rep','resolve'],[T(3,6),'cs1','close',{rating:7}],[T(4,5),'rep','resolve'],[T(4,6),'cs1','close',{rating:3.5}],[T(5,5),'rep','resolve'],[T(5,6),'cs1','close',{rating:'5'}]]);
eq(nd(card(group(run('2026-09',NOW,{complaints:[odd]}),'csm'),'cs1'),'customer_rating'),[0,0],'7, 3.5 and "5" are not ratings');
// events out of order, or with no register, still read correctly
const shuffled=complaint('Z','c1','cs1',[[T(3,6),'cs1','close',{rating:4}],[T(2,5),'cs1','register'],[T(3,5),'rep','resolve'],[T(2,6),'csm','forward']]);
eq(nd(card(group(run('2026-09',NOW,{complaints:[shuffled]}),'csm'),'cs1'),'customer_rating'),[4,1],'events are read in the order they happened, not the order they were stored');
eq(K.complaintTimeline(shuffled).acts.map(a=>[a.at,a.since]),[[T(3,6),T(3,5)]],'a closure is measured from the resolution before it');

// ---- who reports to whom, and which certificate closes a representative's month
eq([K.kpiManagerOf(members.find(x=>x.id==='cs1'),members),K.kpiManagerOf(members.find(x=>x.id==='cs3'),members),K.kpiManagerOf(members.find(x=>x.id==='cs_free'),members),K.kpiManagerOf({supervisorId:'sm'},members),K.kpiManagerOf({supervisorId:'ghost'},members)],['csm','csm2','','','']," a representative's manager is a customer-service manager they report to, or nobody");
eq([K.closedMonthFor('cs1','csm','2026-09',[row])?.id,K.closedMonthFor('cs3','csm2','2026-09',[row])?.id,K.closedMonthFor('cs1','csm','2026-08',[row])?.id,K.closedMonthFor('cs1','csm','2026-09',[reopenedRow])?.id],[row.id,null,null,null],'a certificate closes the team\'s representatives in its own month, unless it was reopened');
eq(K.closedMonthFor('cs1','csm2','2026-09',[row])?.id,row.id,'and a representative who moved to another manager after the month was closed is still closed in it');

// ---- the page's view of the month
const cname=id=>id?'اسم-'+id:'';
const view=(id,over={},options={})=>K.serviceKpiView(input(over),'2026-09',NOW,members.find(x=>x.id===id),{customerName:cname,settingsVersion:3,...options});
const va=view('owner');
eq([va.month,va.groups.map(g=>g.managerId),va.settingsVersion,va.me],['2026-09',['csm','csm2','csm3',''],3,{id:'owner',role:'admin',canAudit:true,canSettings:true}],'the administrator\'s view: all four groups, and what they may do');
eq(va.groups.flatMap(g=>[g.manager,...g.reps]).filter(Boolean).every(c=>c.metrics.every(x=>x.items.length===0)),true,'no card carries its cases until one is opened');
eq(va.groups[0].reps.find(c=>c.memberId==='cs1').metrics.map(x=>x.itemCount),[4,4,2,2,2,6,13,3],'but each says how many cases it has');
eq(va.groups[0].reps.find(c=>c.memberId==='cs1').name,'عضو cs1','a card carries the name');
const opened=view('owner',{},{detail:'cs1'}).groups[0].reps.find(c=>c.memberId==='cs1');
eq([opened.metrics.find(x=>x.key==='closure_timing').items.length,opened.metrics.find(x=>x.key==='closure_timing').items[0].customerName],[4,'اسم-c1'],'the opened card carries its cases with the customers\' names');
eq(view('owner',{},{detail:'cs1'}).groups[0].reps.find(c=>c.memberId==='cs2').metrics.every(x=>x.items.length===0),true,'and only that card');
eq(view('owner',{},{detail:'csm'}).groups[0].manager.metrics.find(x=>x.key==='backlog').items.length,5,'a manager\'s card opens the same way');
eq(view('owner',{},{customerName:()=>''}).groups.length,4,'a name the reader may not see comes back empty');
eq(view('owner',{},{detail:'cs1',customerName:()=>''}).groups[0].reps.find(c=>c.memberId==='cs1').metrics.find(x=>x.key==='closure_timing').items.every(i=>i.customerName===''),true,'on every case');
eq(va.groups.map(g=>[g.managerId,g.canClose,g.closeProblem,g.canReopen,g.closed]),[['csm',true,'',false,false],['csm2',true,'',false,false],['csm3',true,'',false,false],['',true,'',false,false]],'September can be closed by an administrator, for every group, now');
const vl=view('csm');
eq([vl.groups.map(g=>g.managerId),vl.groups[0].canClose,vl.me],[['csm'],true,{id:'csm',role:'customer_service_manager',canAudit:true,canSettings:false}],'a manager sees only his group and may close it');
eq(Object.keys(vl.sample).sort(),['cs1','cs2','cs_idle'],'and the suggested sample for each of his representatives');
eq(vl.sample.cs1.length,3,'three for the one with work');
eq([vl.sample.cs1[0].customerName.startsWith('اسم-'),vl.sample.cs1.every(s=>['complaint','support'].includes(s.type))],[true,true],'each with the customer and what it is');
eq([vl.sample.cs2,vl.sample.cs_idle],[[],[]],'none for those who finished nothing');
const vr=view('cs1');
eq([vr.groups.length,vr.groups[0].manager,vr.groups[0].reps.map(c=>c.memberId),vr.me,vr.sample],[1,null,['cs1'],{id:'cs1',role:'customer_service',canAudit:false,canSettings:false},{}],'a representative sees their own card, no manager\'s, no sample, and may do nothing');
eq(vr.groups[0].reps[0].metrics.find(x=>x.key==='customer_rating').items.map(i=>i.value).sort(),[3,4,5],'and always with their own cases open');
eq([vr.groups[0].canClose,vr.groups[0].closeProblem,vr.groups[0].canReopen],[false,'',false],'but not the buttons');
eq(view('cs1',{},{}).audits.map(a=>a.id),['audit-AU2','audit-AU1'],'they see their own audits, newest first');
eq(view('cs2').audits.map(a=>a.id),['audit-AU3'],'and not a colleague\'s');
eq(va.audits.map(a=>a.id),['audit-AU4','audit-AU3','audit-AU2','audit-AU1'],'the administrator sees all of September\'s, and not August\'s');
eq(vl.audits.map(a=>a.id),['audit-AU3','audit-AU2','audit-AU1'],'a manager those of his team');
eq(va.audits.find(a=>a.id==='audit-AU1').repName,'عضو cs1','an audit names the representative');
eq(va.audits.find(a=>a.id==='audit-AU1').auditorName,'عضو csm','and the auditor');
eq([va.audits.every(a=>a.canDelete),vl.audits.every(a=>!a.canDelete)],[true,true],'an administrator may delete any; the auditor may not after a week');
const fresh=audit('AU9','cs1','2026-09',70,{at:'2026-10-10T06:00:00.000Z',ref:'complaint-A',refType:'complaint'});
const vf=view('csm',{audits:[...audits,fresh]});
eq([vf.audits.find(a=>a.id==='audit-AU9').canDelete,vf.audits.find(a=>a.id==='audit-AU9').reference],[true,{type:'complaint',id:'complaint-A',customerName:'اسم-c1'}],'the auditor may delete within a week; the reference names the customer');
eq(view('csm',{audits:[...audits,fresh],closed:[row]}).audits.every(a=>!a.canDelete),true,'but not once the month is closed');
const current=K.serviceKpiView(input(),'2026-10',NOW,members.find(x=>x.id==='owner'),{customerName:cname,settingsVersion:0});
eq(current.groups.map(g=>[g.managerId,g.canClose,g.closeProblem]).slice(0,2),[['csm',false,'لا يُقفل الشهر قبل مرور 5 أيام على انتهائه'],['csm2',false,'لا يُقفل الشهر قبل مرور 5 أيام على انتهائه']],'a running month cannot be closed, and says why');
const closedView=view('csm',{closed:[row]});
eq([closedView.groups[0].closed,closedView.groups[0].canClose,closedView.groups[0].closedByName,closedView.sample,view('owner',{closed:[row]}).groups[0].canReopen],[true,false,'عضو owner',{},true],'a closed group has nothing to close, shows who closed it, offers no sample, and an administrator may reopen it');
eq(view('sm').groups,[],'a sales member has no view');

// ---- the last three months beside each card, and the team's median
eq([K.prevMonth('2026-01'),K.prevMonth('2026-03'),K.trailingMonths('2026-02',3),K.trailingMonths('2026-12',3),K.trailingMonths('2026-09',1)],['2025-12','2026-02',['2025-12','2026-01','2026-02'],['2026-10','2026-11','2026-12'],['2026-09']],'the months before a month cross the year, oldest first');
const trendOf=(id,over={},month='2026-09')=>K.serviceKpiView(input(over),month,NOW,members.find(x=>x.id===id),{customerName:cname,settingsVersion:3}).trend;
const ta=trendOf('owner');
eq(ta.months,['2026-07','2026-08','2026-09'],'September and the two months before it, oldest first');
eq(ta.scores.cs1,[null,33.3,73.9],'a representative: nothing in July; August is one audit of 50 (8.33 of 15) and one request left open past its time (0 of 10), 8.33 of 25 points; September\'s 73.9');
eq(ta.scores.csm,[null,34.1,82.9],'a manager: July\'s empty backlog alone is no result; August is a team average of 33.3 (9.79 of 25), a quality of 50 (5.56 of 10) and the open request (0 of 10), 15.35 of 45');
eq([ta.scores.cs2,ta.scores.cs_idle,ta.scores.csm3],[[null,null,100],[null,null,null],[null,null,0]],'a card with no work in a month has no score in it; the other branch\'s manager has only September\'s open request, and that is his 0');
eq(ta.medians,{csm:[null,33.3,87],csm2:[null,null,98.2],csm3:[null,null,null],none:[null,null,89.7]},'each team\'s median of its representatives\' scores: one in August; 73.9 and 100 average 86.95, 87.0; 100 and 96.3 average 98.15, 98.2; nobody, and the lone representative');
const tl=trendOf('csm');
eq([Object.keys(tl.scores).sort(),Object.keys(tl.medians),tl.scores.cs1],[['cs1','cs2','cs_idle','csm'],['csm'],[null,33.3,73.9]],'a manager gets the trend of his own group only, with his team\'s median');
const tr=trendOf('cs1');
eq([tr.months,tr.scores,tr.medians],[['2026-07','2026-08','2026-09'],{cs1:[null,33.3,73.9]},{}],'a representative gets their own trend and no median');
eq(trendOf('sm'),{months:['2026-07','2026-08','2026-09'],scores:{},medians:{}},'a sales member gets nothing to show');
// a finished month keeps the settings it was closed with, so the months beside the current one do not move when the targets do
const looser=structuredClone(S1);looser.rep.support_response.target=50;
eq(trendOf('owner',{settings:looser,closed:[row]},'2026-10').scores.cs1.slice(0,2),[33.3,73.9],'a closed September keeps 73.9 under looser live settings, and August is untouched by them');
eq(trendOf('owner',{settings:looser},'2026-10').scores.cs1.slice(0,2),[33.3,80.5],'while an open September follows them: the request target met, 15 of 15 instead of 8.33');
// an empty backlog is full marks only beside something that was measured
const lone={members:[m('mg','customer_service_manager'),m('r1','customer_service','mg')],complaints:[],support:[],serviceCases:[],audits:[],closed:[],settings:S1};
const quiet=group(K.serviceKpiMonth(lone,'2026-06',NOW),'mg');
eq([quiet.manager.score,quiet.manager.measuredWeight,metric(quiet.manager,'backlog').empty,metric(quiet.manager,'backlog').measured,quiet.reps[0].score],[null,0,true,true,null],'a month with nothing in it gives its manager no score: the empty backlog alone says nothing');
const worked=group(K.serviceKpiMonth({...lone,audits:[audit('MA','r1','2026-06',90,{at:'2026-06-10T06:00:00.000Z'})]},'2026-06',NOW),'mg');
eq([worked.reps[0].score,worked.manager.score,worked.manager.measuredWeight],[100,100,45],'beside a measured figure it counts: a team average (25), a quality (10) and the empty backlog (10)');

// ---- a request that goes on to the sales side after customer service's contact: the first submission is what is measured
{
 const staged=(id,status,requestedAt,result,extra={})=>{const row=support(id,{handler:'cs1',requestedAt,result});row.data.status=status;if(result)row.data.submittedAt=result;return {...row,data:{...row.data,...extra}};};
 // three requests contacted within the hour, now at different stages beyond customer service, and one that has not been contacted for days
 const chainSupports=[staged('K1','submitted',T(14,5),T(14,6)),staged('K2','assigned',T(15,5),T(15,6),{assigneeId:'rep',salesManagerId:'sm'}),staged('K3','resolved',T(16,5),T(16,6),{assigneeId:'rep'}),staged('K4','returned',T(17,5),T(17,6),{returnNote:'x'}),support('K5',{handler:'cs1',requestedAt:T(21,5)})];
 const month=run('2026-09',NOW,{support:chainSupports,complaints:[],serviceCases:[],audits:[]});
 const lead=group(month,'csm'),rep=card(lead,'cs1'),manager=lead.manager;
 eq(nd(rep,'support_response'),[4,4],'a request that has gone on to the manager, to sales or back for correction counts as answered at its first submission');
 eq(metric(rep,'support_response').items.map(item=>item.ref).sort(),['support-K1','support-K2','support-K3','support-K4'],'each one, by its first submission');
 eq(nd(manager,'team_support_response'),[4,4],'the manager\'s figure counts them the same way');
 eq(metric(manager,'backlog').items.filter(item=>item.type==='support').map(item=>item.ref),['support-K5'],'only what customer service has not yet contacted is left in the backlog');
 eq(['support-K1','support-K2','support-K3','support-K4','support-K5'].map(ref=>metric(rep,'clearance').items.find(item=>item.ref===ref)?.ok),[true,true,true,true,false],'the representative\'s clearance finds the four in time and the untouched one not cleared');
 const sample=K.auditCandidates(input({support:chainSupports,complaints:[],serviceCases:[],audits:[]}),'2026-09','cs1',NOW).filter(item=>item.type==='support').map(item=>item.ref).sort();
 eq(sample,['support-K1','support-K2','support-K3','support-K4'],'every contact customer service made is a candidate for a quality audit, whatever became of the request after');
}

// ---- the new record kinds never travel with the sales records
const kindsRows=['service_audit','service_kpi_month','service_kpi_settings','support','complaint'].map(kind=>({id:kind+'-1',kind,parentId:null,assignedTo:'csm',branch:'الرئيسي',data:{kind},createdAt:T(1,5),updatedAt:T(1,5),version:1}));
eq(CRM.scopeRecords(kindsRows,members,members.find(x=>x.id==='owner')).length,0,'the administrator\'s record list leaves all five out');
for(const id of ['rep','sup','sm','csm','cs1'])eq(CRM.scopeRecords(kindsRows,members,members.find(x=>x.id===id)).length,0,`and so does ${id}\'s`);

// ---- nothing in the output names a customer, a text or a person other than by id
const text=JSON.stringify(sept);
eq(/مصنع|xxx|@yourrest/.test(text),false,'the cards carry ids, hours and counts only, no customer name, no text, no email');
console.log(JSON.stringify({ok:true,checks,pureFunctions:true,productionDataUsed:false}));
