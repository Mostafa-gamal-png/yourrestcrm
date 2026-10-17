// The customer-service evaluation page rendered from the real source: who gets which control, the cards with their figures,
// targets, weights, points and cases, a figure opened onto its cases, the chips for a closed month and for too few cases, the audit
// list and the suggested sample, the audit and settings dialogs, the representative's own folded section, and the English wording
// without Arabic leftovers. Render contracts only: no browser, no network, no production data. The month shown is built by the real
// evaluation module from a small company, so the page is checked against the numbers the module gives.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const root=process.cwd(),nativeRequire=createRequire(import.meta.url),libs=new Map(),apps=new Map();
const compiler={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true};
let checks=0,language='ar';
const eq=(a,b,message)=>{assert.deepEqual(a===undefined?undefined:JSON.parse(JSON.stringify(a)),b,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
const dictionary=JSON.parse(fs.readFileSync(path.join(root,'lib/locales/en.json'),'utf8'));
const i18n={t:value=>language==='en'&&typeof value==='string'?(dictionary[value]||value):value,useLanguage:()=>({language}),getLanguage:()=>language,direction:()=>language==='en'?'ltr':'rtl'};
const pass=({children})=>children,mock=new Proxy({},{get:()=>pass});
function library(filename){
 if(libs.has(filename))return libs.get(filename);
 const exports={};libs.set(filename,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,require:name=>name.startsWith('.')?library(path.join(path.dirname(filename),name)+'.ts'):name==='react'?React:nativeRequire(name),Date,Intl,console,crypto,URL,Promise,setTimeout,clearTimeout},{filename});
 return exports;
}
function load(filename){
 if(apps.has(filename))return apps.get(filename);
 const exports={};apps.set(filename,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,require:name=>{
  if(name==='react')return React;
  if(name==='react/jsx-runtime')return jsx;
  if(name==='@/lib/i18n')return i18n;
  if(name==='./voice-field')return load('app/voice-field.tsx');
  if(name.startsWith('@/lib/'))return library(name.replace('@/','')+'.ts');
  return mock;
 },console,Date,Intl,crypto,URL,Promise,setTimeout,clearTimeout,window:undefined,navigator:undefined});
 return exports;
}
const html=element=>renderToStaticMarkup(element);
const arabicLeft=markup=>(markup.match(/[؀-ۿ]+/g)||[]);
const count=(markup,needle)=>markup.split(needle).length-1;
const {ServiceKpiView,MyServiceScore,MyScoreBody,CardView,metricValueText,problemText,closeNote,trendText}=load('app/service-kpi.tsx');
const K=library('lib/service-kpi.ts');
const clone=value=>JSON.parse(JSON.stringify(value));

// ---- a small company with English names, and the month the module computes for it
const pad=n=>String(n).padStart(2,'0');
const T=(day,hour)=>`2026-09-${pad(day)}T${pad(hour)}:00:00.000Z`;
const m=(id,role,supervisorId,active=1)=>({id,userId:'u-'+id,email:id+'@yourrest.org',name:'Member '+id,role,branch:'Main',supervisorId,regionScope:'all',active,target:0});
const members=[m('owner','admin'),m('sm','manager'),m('csm','customer_service_manager','sm'),m('csm2','customer_service_manager','sm'),m('cs1','customer_service','csm'),m('cs2','customer_service','csm'),m('cs_free','customer_service')];
const complaint=(id,customerId,registrar,events,extra={})=>{const list=events.map(([at,by,action,more])=>({at,by,action,...(more||{})}));return {id:'complaint-'+id,branch:'Main',assignedTo:registrar,createdAt:list[0].at,updatedAt:list.at(-1).at,version:1,data:{kind:'complaint',customerId,status:'assigned',registrarId:registrar,serviceManagerId:'csm',severity:'normal',events:list,...extra}};};
const support=(id,{origin='rep',handler,requestedAt,result,customerId='c1'})=>({id:'support-'+id,branch:'Main',assignedTo:handler,createdAt:requestedAt,updatedAt:result||requestedAt,version:1,data:{kind:'support',customerId,origin,status:result?'done':'open',requestedBy:'rep',requestedAt,repId:'rep',note:'',channel:'any',handlerId:handler,handlerAt:requestedAt,handlerBy:'x',...(result?{result:{outcome:'other',note:'xxx',nextDate:'',by:handler,at:result}}:{})}});
const audit=(id,repId,total,extra={})=>({id:'audit-'+id,branch:'Main',assignedTo:'csm',createdAt:T(20,6),updatedAt:T(20,6),version:1,data:{kind:'service_audit',repId,month:'2026-09',date:'',reference:{type:extra.refType||'',id:extra.ref||''},scores:{greeting:5,understanding:10,accuracy:15,ownership:10,communication:10,resolution:10,closing:5},total,result:total>=90?'pass':total>=80?'coach':'fail',verification:{called:!!extra.rating,rating:extra.rating||null},note:extra.note||'',auditorId:'csm',at:extra.at||T(20,6)}});
const complaints=[
 complaint('A','c1','cs1',[[T(6,5),'cs1','register'],[T(6,6),'csm','forward'],[T(7,5),'rep','resolve'],[T(7,7),'cs1','close',{outcome:'satisfied',rating:5}]]),
 complaint('B','c2','cs1',[[T(6,6),'cs1','register'],[T(6,7),'csm','return'],[T(6,8),'cs1','edit'],[T(6,9),'csm','forward'],[T(8,5),'rep','resolve'],[T(10,5),'cs1','reject'],[T(10,7),'rep','resolve'],[T(12,5),'cs1','close',{outcome:'satisfied',rating:3}]],{severity:'high'}),
 complaint('C','c3','cs1',[[T(7,5),'cs1','register'],[T(7,11),'csm','forward'],[T(9,5),'rep','resolve']])
];
const supports=[support('S1',{handler:'cs1',requestedAt:T(6,5),result:T(6,7)}),support('S2',{handler:'cs1',requestedAt:T(7,5),result:T(7,12)}),support('M1',{origin:'missed_visit',handler:'cs1',requestedAt:T(9,5),result:T(9,7)}),support('S3',{handler:'cs_free',requestedAt:T(16,5),result:T(16,6)})];
const audits=[audit('AU1','cs1',88,{note:'Did not confirm the appointment',ref:'complaint-A',refType:'complaint',rating:4}),audit('AU2','cs1',94,{at:'2026-10-10T06:00:00.000Z'}),audit('AU3','cs2',90)];
const NOW='2026-10-12T12:00:00.000Z';
const loose=K.normalizeSettings({});for(const part of [loose.rep,loose.manager])for(const key of Object.keys(part))part[key].min=1;loose.manager.backlog.min=0;
const make=(over={})=>({members,complaints,support:supports,serviceCases:[],audits,closed:[],settings:loose,...over});
const cname=id=>id?'Factory '+id:'';
const kpi=(id,over={},options={})=>clone(K.serviceKpiView(make(over),'2026-09',NOW,members.find(x=>x.id===id),{customerName:cname,settingsVersion:2,...options}));
const sayFor=lang=>(ar,en)=>lang==='en'?en:ar;
const noop=()=>{},run=async()=>true;
const props=(data,lang='ar',extra={})=>({data,error:'',loading:false,month:data?.month||'',detail:'',say:sayFor(lang),busy:false,actionError:'',role:data?.me.role||'',onMonth:noop,onDetail:noop,onRetry:noop,run,refresh:async()=>{},...extra});
const page=(data,lang='ar',extra={})=>{language=lang;return html(React.createElement(ServiceKpiView,props(data,lang,extra)));};

// ---- the small helpers
eq([metricValueText({kind:'share',actual:66.666,empty:false,numerator:2,denominator:3},sayFor('ar')),metricValueText({kind:'average',actual:91,empty:false,numerator:182,denominator:2},sayFor('ar')),metricValueText({kind:'rating',actual:80,empty:false,numerator:12,denominator:3},sayFor('ar')),metricValueText({kind:'share',actual:null,empty:false,numerator:0,denominator:0},sayFor('ar')),metricValueText({kind:'share',actual:100,empty:true,numerator:0,denominator:0},sayFor('ar')),metricValueText({kind:'share',actual:100,empty:true,numerator:0,denominator:0},sayFor('en'))],['66.7%','91.0','4.0 / 5','—','لا متراكم','Nothing open'],'a share, a mark, a rating, nothing to measure and an empty backlog, each as it should read');
eq([closeNote(5,sayFor('ar')),closeNote(5,sayFor('en')),closeNote(0,sayFor('ar')),closeNote(0,sayFor('en'))],['لا يُقفل الشهر قبل مرور 5 أيام على انتهائه','A month cannot be closed until 5 days after it ends','لا يُقفل الشهر قبل أن ينتهي','A month cannot be closed before it ends'],'why a month cannot be closed yet, in both languages');
const problems=[];
const mutate=change=>{const copy=clone(K.DEFAULT_SERVICE_KPI_SETTINGS);change(copy);const problem=K.settingsProblem(copy);if(problem)problems.push(problem);};
mutate(s=>{s.rep.clearance.weight=9;});mutate(s=>{s.manager.backlog.weight=11;});mutate(s=>{s.rep.clearance.target=0;});mutate(s=>{s.rep.clearance.weight=10.5;s.rep.customer_rating.weight=9.5;});mutate(s=>{s.rep.clearance.min=-1;});
mutate(s=>{s.audit.criteria.greeting=9;});mutate(s=>{s.audit.criteria.greeting=0;s.audit.criteria.closing=20;});mutate(s=>{s.audit.coach=90;});mutate(s=>{s.hours.support=0;});mutate(s=>{s.life.high=0;});mutate(s=>{s.audit.sample=21;});mutate(s=>{s.closeGraceDays=31;});
eq(problems.length,12,'twelve different mistakes in the settings, each with a message');
for(const problem of problems){ok(problemText(problem,sayFor('ar'))===problem,'in Arabic the message is the module\'s own: '+problem);ok(arabicLeft(problemText(problem,sayFor('en'))).length===0,'in English it has no Arabic left: '+problem);}
eq(problemText(problems[0],sayFor('en')),'The weights of the representative figures must add up to 100; they add up to 99','the weights message says which card and the total');

// ---- who gets the representative's section
for(const role of ['admin','customer_service_manager','manager','rep','supervisor','unknown'])eq(MyServiceScore({me:{role}}),null,role+' gets no "my evaluation" section');
language='ar';
const folded=html(React.createElement(MyServiceScore,{me:{role:'customer_service'}}));
ok(folded.startsWith('<details')&&folded.includes('تقييمي')&&folded.includes('service-kpi-mine')&&!/<details[^>]* open/.test(folded)&&!folded.includes('sk-card')&&!folded.includes('جارٍ تحميل'),'a representative\'s section starts folded, with its title, and loads nothing');

// ---- the administrator's page
const owner=kpi('owner');
const admin=page(owner);
ok(admin.includes('data-viewer="admin"')&&admin.includes('dir="rtl"'),'the page is right-to-left and knows its viewer');
eq([count(admin,'class="sk-group" '),admin.includes('فريق Member csm'),admin.includes('فريق Member csm2'),admin.includes('ممثلون بلا مدير')],[3,true,true,true],'three groups: the two managers\' teams and the representatives nobody manages');
ok(admin.includes('تدقيق جديد')&&admin.includes('إعدادات التقييم'),'the administrator may audit and change the settings');
eq(count(admin,'إقفال الشهر'),3,'and close any of the three groups');
ok(!admin.includes('إعادة فتح الشهر')&&!admin.includes('sk-confirm'),'but there is nothing to reopen yet');
ok(admin.includes('Member cs1')&&admin.includes('Member cs2')&&admin.includes('Member cs_free')&&admin.includes('بطاقة المدير'),'the cards are named, and a manager\'s card says so');
const cs1Card=owner.groups[0].reps.find(c=>c.memberId==='cs1');
ok(admin.includes('<span class="sk-score" data-level="'+(cs1Card.score>=90?'good':cs1Card.score>=75?'warn':'bad')+'">'+cs1Card.score.toFixed(1)+'</span>'),'cs1\'s score is shown with its level');
ok(admin.includes('sk-compare')&&admin.includes('الاستجابة للمساندة'),'a team of two or more has the comparison table');
eq(count(admin,'sk-compare'),1,'only the team with two representatives');
ok(!admin.includes('service-report-table sk-table"')&&!admin.includes('sk-items'),'no card is opened until one is asked for');
ok(admin.includes('عيّنة مقترحة هذا الشهر'),'the suggested sample is offered to the administrator');
ok(admin.includes('لا تدقيقات')===false&&admin.includes('Did not confirm the appointment')&&admin.includes('88/100')&&admin.includes('94/100'),'the audits of the month are listed with their notes and totals');
ok(admin.includes('حذف التدقيق'),'and may be deleted');

// ---- a manager's page
const lead=kpi('csm'),leadHtml=page(lead);
ok(leadHtml.includes('تدقيق جديد')&&!leadHtml.includes('إعدادات التقييم')&&count(leadHtml,'إقفال الشهر')===1,'a manager audits and closes his own month but cannot change the settings');
ok(!leadHtml.includes('ممثلون بلا مدير')&&!leadHtml.includes('فريق Member csm2'),'and sees only his team');

// ---- a card opened onto its figures
const opened=page(kpi('owner',{},{detail:'cs1'}),'ar',{detail:'cs1'});
ok(opened.includes('class="service-report-table sk-table"'),'the opened card shows its table');
for(const label of Object.values(K.repMetricLabels))ok(opened.includes(label),'the table names the figure «'+label+'»');
ok(opened.includes('90%')&&opened.includes('95%')&&opened.includes('98%')&&opened.includes('>15<')&&opened.includes('>10<'),'with the targets and weights of the sheet');
const cardHtml=(card,over={})=>{language='ar';return html(React.createElement(CardView,{card,role:'rep',say:sayFor('ar'),open:true,onToggle:noop,nameOf:id=>id,loading:false,...over}));};
const itemized=cardHtml(kpi('owner',{},{detail:'cs1'}).groups[0].reps.find(c=>c.memberId==='cs1'),{defaultOpen:'closure_timing'});
eq(count(itemized,'<li data-ok='),3,'a figure opened shows its cases: A\'s closure, B\'s send-back and B\'s closure');
ok(itemized.includes('أُغلقت')&&itemized.includes('أُعيدت إلى المندوب')&&itemized.includes('Factory c1')&&itemized.includes('2.0 س')&&itemized.includes('20.0 س'),'each with what happened, the customer and the hours');
ok(itemized.includes('data-ok="true"')&&itemized.includes('✓')&&!itemized.includes('data-ok="false"'),'each met its target');
const cleared=cardHtml(kpi('owner',{},{detail:'cs1'}).groups[0].reps.find(c=>c.memberId==='cs1'),{defaultOpen:'clearance'});
ok(cleared.includes('data-ok="false"')&&cleared.includes('✗')&&cleared.includes('Factory c3')&&cleared.includes('تأكيد إغلاق'),'while the confirmation nobody has made yet shows as a miss, with its customer and what it is');
const closedFigure=cardHtml(kpi('owner',{},{detail:'cs1'}).groups[0].reps.find(c=>c.memberId==='cs1'),{defaultOpen:'customer_rating'});
ok(closedFigure.includes('★ 5')&&closedFigure.includes('★ 3'),'the rating figure lists the stars given');
const unopened=cardHtml(kpi('owner').groups[0].reps.find(c=>c.memberId==='cs1'),{defaultOpen:'closure_timing',loading:true});
ok(unopened.includes('جارٍ تحميل الحالات'),'a figure whose cases have not arrived says they are loading');
const backlog=cardHtml(kpi('owner',{},{detail:'csm'}).groups[0].manager,{defaultOpen:'backlog',role:'manager'});
ok(backlog.includes('ضبط المتراكم')&&backlog.includes('Factory c3'),'the manager\'s card opens the same way');
const average=cardHtml(kpi('owner',{},{detail:'csm'}).groups[0].manager,{defaultOpen:'team_average',role:'manager',nameOf:id=>'Name of '+id});
ok(average.includes('Name of cs1')&&average.includes('Name of cs2'),'the team average lists the people it averaged');

// ---- too few cases, with the sheet's numbers
const sheet=kpi('csm',{settings:K.normalizeSettings({})});
const sheetHtml=cardHtml(sheet.groups[0].reps.find(c=>c.memberId==='cs1'));
ok(sheetHtml.includes('غير كافٍ'),'a figure with fewer cases than its least says "not enough" with the numbers');
ok(sheetHtml.includes('غير كافٍ 2/5')&&sheetHtml.includes('غير كافٍ 3/5'),'support response has 2 cases of the 5 needed, closure confirmation 3');
ok(cardHtml(sheet.groups[0].reps.find(c=>c.memberId==='cs1')).includes('قيست على'),'and the card says how much of the 100 it was measured on');
ok(cardHtml(sheet.groups[0].reps.find(c=>c.memberId==='cs_idle'||c.memberId==='cs2')).includes('لا بيانات كافية'),'a card with nothing measured says so instead of a score');

// ---- a closed month
const certificate=K.monthCertificate(owner.groups[0].reps?clone(K.serviceKpiMonth(make(),'2026-09',NOW).groups.find(g=>g.managerId==='csm')):null,'2026-09','owner','2026-10-07T09:00:00.000Z');
const certRow={id:K.monthRowId('csm','2026-09'),branch:'Main',assignedTo:'owner',data:clone(certificate),createdAt:certificate.closedAt,updatedAt:certificate.closedAt,version:1};
const closed=kpi('owner',{closed:[certRow]});
const closedHtml=page(closed);
ok(closedHtml.includes('مقفل')&&closedHtml.includes('Member owner')&&closedHtml.includes('إعادة فتح الشهر'),'a closed group says so, who closed it and offers an administrator to reopen it');
eq(count(closedHtml,'إقفال الشهر'),2,'the other two groups can still be closed');
ok(!closedHtml.includes('تغيّرت الأرقام بعد الإقفال'),'it has not drifted');
const drifted=kpi('owner',{closed:[certRow],audits:[...audits,audit('AU9','cs1',40)]});
ok(page(drifted).includes('تغيّرت الأرقام بعد الإقفال'),'a closed month whose figures moved says so');
const leadClosed=page(kpi('csm',{closed:[certRow]}));
ok(leadClosed.includes('مقفل')&&!leadClosed.includes('إقفال الشهر')&&!leadClosed.includes('إعادة فتح الشهر')&&!leadClosed.includes('عيّنة مقترحة'),'for the manager a closed month has nothing to close or reopen and no sample');
const running=page(clone(K.serviceKpiView(make(),'2026-10',NOW,members.find(x=>x.id==='csm'),{customerName:cname,settingsVersion:2})));
ok(running.includes('لا يُقفل الشهر قبل مرور 5 أيام على انتهائه')&&!running.includes('إقفال الشهر</button>'),'the running month cannot be closed and says why, from the settings');

// ---- the representative's body
const mine=kpi('cs1');
const mineHtml=(lang='ar',data=mine)=>{language=lang;return html(React.createElement(MyScoreBody,{data,error:'',loading:false,say:sayFor(lang),month:'',onMonth:noop,onRetry:noop}));};
const body=mineHtml();
ok(body.includes('sk-card')&&body.includes('Member cs1')&&body.includes('class="service-report-table sk-table"'),'a representative sees their own card, open');
ok(!body.includes('بطاقة المدير')&&!body.includes('Member cs2')&&!body.includes('تدقيق جديد')&&!body.includes('إقفال الشهر'),'with no manager\'s card, no colleague, no button to audit or close');
ok(body.includes('تدقيقات جودة أدائي')&&body.includes('Did not confirm the appointment')&&body.includes('88/100'),'and the audits of their own work with the notes');
ok(!body.includes('حذف التدقيق'),'which they cannot delete');
ok(mineHtml('ar',kpi('cs1',{closed:[certRow]})).includes('الشهر مقفل: درجتك محفوظة'),'a closed month says their score is kept');
ok(mineHtml('ar',{...clone(mine),groups:[]}).includes('لا بطاقة لك في هذا الشهر'),'with no card in the month, it says so');
ok(html(React.createElement(MyScoreBody,{data:null,error:'',loading:true,say:sayFor('ar'),month:'',onMonth:noop,onRetry:noop})).includes('جارٍ تحميل التقييم'),'while loading, it says so');
const failed=html(React.createElement(MyScoreBody,{data:null,error:'تقييم خدمة العملاء لمدير النظام ومدير خدمة العملاء وممثليها فقط',loading:false,say:sayFor('ar'),month:'',onMonth:noop,onRetry:noop}));
ok(failed.includes('role="alert"')&&failed.includes('إعادة المحاولة'),'a failure is shown with a retry');

// ---- the last three months beside a card, and the team's median
const flat=markup=>markup.replace(/<!-- -->/g,'');
eq(trendText(['2026-07','2026-08','2026-09'],[null,55.6,73.94]),'07: — · 08: 55.6 · 09: 73.9','the trend: the month\'s number and the score to one decimal, a dash where there is none');
eq(owner.trend.months,['2026-07','2026-08','2026-09'],'the page is given the month and the two before it');
ok(!flat(admin).includes('آخر 3 أشهر')&&!flat(body).includes('آخر 3 أشهر'),'with nothing before the month a card shows no trend: it would only repeat its score');
ok(flat(admin).includes('وسيط الفريق: '+owner.trend.medians.csm[2].toFixed(1)+'<'),'but the team\'s median of the month is shown on its own');
const augustAudit={...audit('AU5','cs1',50),data:{...audit('AU5','cs1',50).data,month:'2026-08',at:'2026-08-20T06:00:00.000Z'}};
const history=kpi('owner',{audits:[...audits,augustAudit]});
eq([history.trend.scores.cs1,history.trend.medians.csm.slice(0,2)],[[null,55.6,cs1Card.score],[null,55.6]],'one audit of 50 in August is 50 of 90 on the one figure measured: 55.6, and the team\'s median that month');
const cs1Trend='07: — · 08: 55.6 · 09: '+cs1Card.score.toFixed(1),historyHtml=flat(page(history));
ok(historyHtml.includes('آخر 3 أشهر: '+cs1Trend)&&historyHtml.includes('title="درجات آخر ثلاثة أشهر"'),'cs1\'s card shows the last three months');
eq(count(historyHtml,'آخر 3 أشهر: '),2,'on the two cards that have an earlier month: cs1\'s and the manager\'s, and not on cs2\'s');
ok(historyHtml.includes('وسيط الفريق: 07: — · 08: 55.6 · 09: '+history.trend.medians.csm[2].toFixed(1)),'and the team\'s median over the same months');
const mineHistory=flat(mineHtml('ar',kpi('cs1',{audits:[...audits,augustAudit]})));
ok(mineHistory.includes('آخر 3 أشهر: '+cs1Trend)&&!mineHistory.includes('وسيط الفريق'),'a representative sees their own trend and no median');
const historyEn=flat(page(history,'en'));
ok(historyEn.includes('Last 3 months: '+cs1Trend)&&historyEn.includes('Team median: 07: — · 08: 55.6 · 09: '),'in English');

// ---- loading, failing and empty
ok(page(null,'ar',{loading:true}).includes('جارٍ تحميل التقييم'),'the page says it is loading');
ok(page(null,'ar',{error:'تعذر تحميل التقييم.'}).includes('إعادة المحاولة'),'and offers a retry when it failed');
ok(page({...clone(owner),groups:[],audits:[],sample:{}}).includes('لا بطاقات لهذا الشهر ضمن نطاقك'),'a month with no cards says so');
ok(page(owner,'ar',{actionError:'هذا الشهر مقفل لفريق الممثل'}).includes('هذا الشهر مقفل لفريق الممثل'),'an error from a write is shown');
ok(page(owner,'en',{actionError:'هذا الشهر مقفل لفريق الممثل'}).includes('This month is closed for the representative&#x27;s team'),'translated in English');

// ---- the audit dialog
const auditDialog=(data,seed,lang='ar')=>{language=lang;return page(data,lang,{initialSeed:seed});};
const suggestion=owner.sample.cs1[0];
ok(!!suggestion&&suggestion.ref!=='complaint-A','the sample leaves out complaint A, which has been audited');
const dialog=auditDialog(owner,{repId:'cs1',refType:suggestion.type,refId:suggestion.ref});
ok(dialog.includes('تدقيق جودة')&&dialog.includes('sk-criteria'),'the dialog opens with the criteria');
eq([...dialog.matchAll(/<input type="number"[^>]*max="(\d+)"[^>]*>/g)].map(x=>Number(x[1])),[10,15,20,15,15,15,10],'seven marks, each limited to its criterion\'s maximum');
for(const label of Object.values(K.auditCriterionLabels))ok(dialog.includes(label),'the criterion «'+label+'» is asked');
ok(dialog.includes('المجموع: <b>0</b> / 100')&&/<button[^>]*disabled=""[^>]*>حفظ التدقيق<\/button>/.test(dialog),'the total starts at 0 and saving waits for every mark');
ok(dialog.includes('<option value="'+suggestion.type+':'+suggestion.ref+'" selected="">'),'the suggested case is offered as the reference, chosen');
ok(!dialog.includes('value="complaint:complaint-A"'),'and the audited one is not offered');
ok(dialog.includes('اتصلت بالعميل للتحقق')&&dialog.includes('maxLength="2000"'),'a call to verify and a note of up to 2000 characters');
const repsOffered=[...dialog.matchAll(/<option value="(cs[^"]*)"/g)].map(x=>x[1]);
ok(repsOffered.includes('cs2')&&repsOffered.includes('cs_free'),'the representatives of open groups are offered');
const dialogClosed=auditDialog(closed,{repId:'',refType:'',refId:''});
ok(!dialogClosed.includes('<option value="cs1"')&&!dialogClosed.includes('<option value="cs2"')&&dialogClosed.includes('<option value="cs_free"'),'but not those of a team whose month is closed');
const dialogEn=auditDialog(owner,{repId:'cs1',refType:'',refId:''},'en');
ok(dialogEn.includes('Quality audit')&&dialogEn.includes('Greeting and introduction')&&dialogEn.includes('Total: <b>0</b> / 100'),'in English');
eq(arabicLeft(dialogEn),[],'the English dialog has no Arabic left');

// ---- the settings dialog
const settingsDialog=(lang='ar')=>{language=lang;return page(owner,lang,{initialSettings:true});};
const settingsHtml=settingsDialog();
ok(settingsHtml.includes('إعدادات تقييم خدمة العملاء')&&count(settingsHtml,'sk-settings-table')===2,'the settings dialog has both cards\' tables');
eq(count(settingsHtml,'type="number"'),4+2+16*3+7+4,'every number can be edited: 4 hours, 2 whole-complaint limits, 16 figures with 3 values, 7 criteria, 4 thresholds');
eq([count(settingsHtml,'>100 / 100<'),count(settingsHtml,'<b>100</b> / 100')],[2,1],'each of the three totals shows 100 of 100');
ok(!/class="form-error"/.test(settingsHtml.split('sk-settings')[1]||''),'valid settings show no error');
ok(!/<button[^>]*disabled=""[^>]*>حفظ الإعدادات<\/button>/.test(settingsHtml)&&settingsHtml.includes('استعادة قيم الملف'),'saving is open, and the sheet\'s values can be restored');
const settingsEn=settingsDialog('en');
ok(settingsEn.includes('Customer-service evaluation settings')&&settingsEn.includes('Save the settings'),'in English');
eq(arabicLeft(settingsEn),[],'the English settings dialog has no Arabic left');

// ---- English wording everywhere, without Arabic left over
ok(arabicLeft(page(owner,'ar')).length>0&&arabicLeft(page(owner,'ar',{detail:'cs1'})).length>10,'(the detector does see Arabic when there is some)');
for(const [name,data] of [['administrator',owner],['manager',lead],['closed',closed],['drifted',drifted],['history',history],['running',clone(K.serviceKpiView(make(),'2026-10',NOW,members.find(x=>x.id==='csm'),{customerName:cname,settingsVersion:2}))]]){
 const english=page(data,'en',{detail:'cs1'});
 eq(arabicLeft(english),[],`the ${name} page in English has no Arabic left`);
}
eq(arabicLeft(mineHtml('en')),[],'neither has the representative\'s section');
eq(arabicLeft(cardHtml(kpi('owner',{},{detail:'cs1'}).groups[0].reps.find(c=>c.memberId==='cs1'),{defaultOpen:'clearance',say:sayFor('en')})),[],'nor a figure opened onto its cases');
const english=page(owner,'en');
ok(english.includes('dir="rtl"')===false&&english.includes('Team of Member csm')&&english.includes('Representatives without a manager')&&english.includes('Close the month')&&english.includes('New audit')&&english.includes('Evaluation settings'),'the English page is left-to-right with its own words');
ok(english.includes('Support response')&&english.includes('Registration accuracy'),'and the figures\' English names');
console.log(JSON.stringify({ok:true,checks,sourceRenderedWithoutBrowser:true,productionDataUsed:false}));
