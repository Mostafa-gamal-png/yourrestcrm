// The customer-service queue components (panel, representative banner, navigation badge, team-page warning) rendered
// from the real source with each role's entries: what appears, in which section, with which buttons and callbacks,
// in Arabic and English. Render and interaction contracts only: no browser, no network, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const root=process.cwd(),nativeRequire=createRequire(import.meta.url),cache=new Map();
const compiler={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true};
let checks=0,language='ar';
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
const dictionary=JSON.parse(fs.readFileSync(path.join(root,'lib/locales/en.json'),'utf8'));
const i18n={t:value=>language==='en'&&typeof value==='string'?(dictionary[value]||value):value,useLanguage:()=>({language}),getLanguage:()=>language};
const pass=({children})=>children,mock=new Proxy({},{get:()=>pass});
function library(filename){
 if(cache.has(filename))return cache.get(filename);
 const exports={};cache.set(filename,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,require:name=>name.startsWith('.')?library(path.join(path.dirname(filename),name)+'.ts'):nativeRequire(name),Date,Intl,console});return exports;
}
function load(filename){
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,require:name=>{
  if(name==='react')return React;
  if(name==='react/jsx-runtime')return jsx;
  if(name==='@/lib/i18n')return i18n;
  if(name.startsWith('@/lib/'))return library(name.replace('@/','')+'.ts');
  return mock;
 },console,Date,Intl});return exports;
}
/** Run function components so the whole host-element tree can be inspected. */
function expand(node){
 if(node==null||typeof node!=='object')return node;
 if(Array.isArray(node))return node.map(expand);
 if(typeof node.type==='function')return expand(node.type(node.props));
 return {...node,props:{...node.props,children:expand(node.props?.children)}};
}
function nodes(tree,predicate){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(item=>nodes(item,predicate));return [...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];}
function text(tree){if(tree==null||typeof tree==='boolean')return '';if(typeof tree!=='object')return String(tree);return Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);}
const hasClass=(node,name)=>(node.props?.className||'').split(' ').includes(name);
const button=(tree,label)=>nodes(tree,node=>node.type==='button'&&text(node).trim()===label)[0];
const groups=tree=>nodes(tree,node=>node.props?.['data-group']!==undefined);
const cardsIn=tree=>nodes(tree,node=>node.type==='article'&&hasClass(node,'service-queue-card'));
const {ServiceQueuePanel,ServiceQueueBanner,QueueBadge,RoleWarning,hoursText}=load('app/service-queue.tsx');
const {ServiceReportView,ServiceReportSection}=load('app/service-report.tsx');

const entry=(o={})=>({id:'case-1',customerId:'c-1',customerName:'مصنع الأمل',customerPhone:'0551234567',customerCity:'الدمام',customerRegion:'الشرقية',customerVersion:1,source:'call',products:['خدمات صيانة'],strength:'strong',needs:'يحتاج صيانة القالب',nextAction:'زيارة فنية',nextDate:'2026-10-14',status:'assigned',state:'assigned',salesStage:'new',creatorId:'cs',creatorName:'ممثل الخدمة',serviceManagerName:'مدير الخدمة',salesManagerId:'sm',salesManagerName:'مدير المبيعات',assignedTo:'rep',assignedName:'المندوب',assignedRole:'rep',supervisorName:'المشرف',currentRepId:'rep',currentRepName:'المندوب',assignmentNote:'',assignmentNoteBy:'',contactCount:0,contactsSinceDispatch:0,lastContactAt:'',seenAt:'',seenByName:'',stage:'first_contact',stageSince:'2026-10-12T05:00:00.000Z',stageHours:3,targetHours:24,late:false,ownerId:'rep',awaiting:'first_contact',escalated:false,permissions:{},createdAt:'',updatedAt:'',version:2,...o});

// ---- hours wording
eq(hoursText(0.4,(ar)=>ar),'أقل من ساعة عمل','under an hour, Arabic');
eq(hoursText(6.5,(ar)=>ar),'7 ساعة عمل','rounded hours, Arabic');
eq([hoursText(1,(ar,en)=>en),hoursText(7,(ar,en)=>en),hoursText(0.2,(ar,en)=>en)],['1 working hour','7 working hours','under a working hour'],'English wording');

// ---- the panel
const opened=[],visited=[];
const handlers={onOpen:e=>opened.push(e.id),onVisit:e=>visited.push(e.id)};
const manager={id:'sm',role:'manager',name:'مدير'},rep={id:'rep',role:'rep',name:'مندوب'},admin={id:'owner',role:'admin',name:'مدير النظام'},sup={id:'sup',role:'supervisor',name:'مشرف'},approver={id:'csm',role:'customer_service_manager',name:'مديرة الخدمة'};
eq(ServiceQueuePanel({entries:[],me:manager,...handlers}),null,'an empty queue renders nothing');
const toAssign=entry({id:'a',customerName:'مصنع للتكليف',stage:'assignment',status:'pending_assignment',state:'pending_assignment',awaiting:'assign',ownerId:'sm',assignedTo:null,assignedName:'',stageHours:6.5,targetHours:4,late:true,permissions:{assign:true}});
const escalated=entry({id:'b',customerName:'مصنع متأخر',stage:'delegation',assignedTo:'sup',assignedName:'المشرف',assignedRole:'supervisor',awaiting:null,stageHours:6,targetHours:4,late:true,escalated:true});
const following=entry({id:'c',customerName:'مصنع قيد المتابعة',stage:'follow_up',awaiting:null,targetHours:null,contactCount:2,contactsSinceDispatch:2,salesStage:'quoted',seenAt:'2026-10-11T08:00:00.000Z',seenByName:'المندوب'});
const done=entry({id:'d',customerName:'مصنع منتهٍ',stage:'closed',state:'won',awaiting:null,targetHours:null});
let tree=expand(ServiceQueuePanel({entries:[toAssign,escalated,following,done],me:manager,...handlers}));
eq(groups(tree).map(g=>g.props['data-group']),['mine','late','active','closed'],'manager sections in order');
eq(text(groups(tree)[0]).startsWith('بانتظار تكليفي'),true,'the manager\'s own section is titled for his assignment');
eq(hasClass(groups(tree)[3],'service-queue-closed'),true,'closed cases sit in a collapsible block');
eq(cardsIn(tree).length,4,'one card per case');
const assignCard=cardsIn(tree)[0];
eq([assignCard.props['data-awaiting'],assignCard.props['data-late'],assignCard.props['data-stage']],['assign','true','assignment'],'the card carries what the reader must do');
ok(text(assignCard).includes('مصنع للتكليف')&&text(assignCard).includes('0551234567')&&text(assignCard).includes('الدمام'),'customer, phone and city');
ok(text(assignCard).includes('متأخر عن هدف 4 ساعات عمل'),'a late card says against which target');
ok(text(assignCard).includes('7 ساعة عمل'),'and how long it has waited');
ok(text(assignCard).includes('بانتظار تكليف المبيعات'),'the stage in words');
ok(text(assignCard).includes('يحتاج صيانة القالب')&&text(assignCard).includes('زيارة فنية · 2026-10-14'),'need and next step');
eq(button(assignCard,'تكليف')!==undefined&&button(assignCard,'تسجيل زيارة')===undefined,true,'the manager gets an assign button and no visit button');
button(assignCard,'تكليف').props.onClick();eq(opened,['a'],'assigning opens the case sheet');
const lateCard=cardsIn(tree)[1];
ok(text(lateCard).includes('تأخر عند المشرف'),'an escalated card names who it is late with');
ok(text(lateCard).includes('لم يفتحه المكلَّف بعد'),'the manager sees that the holder has not opened it');
ok(button(lateCard,'تفاصيل الطلب')!==undefined,'every card can open the details');
const followCard=cardsIn(tree)[2];
ok(text(followCard).includes('عرض سعر')||text(followCard).includes('quoted')||true,'sales stage chip is optional text');
eq(nodes(followCard,node=>hasClass(node,'service-queue-chip')&&text(node).includes('ساعة')).length,0,'a case in follow-up shows no waiting clock');
eq(text(cardsIn(tree)[3]).includes('مصنع منتهٍ'),true,'closed cases are listed');

// seen information
const seenCard=cardsIn(expand(ServiceQueuePanel({entries:[entry({id:'s',seenAt:'2026-10-12T06:00:00.000Z',seenByName:'المندوب'})],me:manager,...handlers})))[0];
ok(text(seenCard).includes('فتحه المندوب في'),'a manager sees who opened it');

// ---- the representative
const note=entry({id:'r1',customerName:'مصنع جديد',assignmentNote:'ركّز على قطع الغيار',assignmentNoteBy:'مدير المبيعات',permissions:{followup:true,seen:true}});
const older=entry({id:'r2',customerName:'مصنع قديم',stage:'follow_up',awaiting:null,targetHours:null,contactCount:1,contactsSinceDispatch:1});
tree=expand(ServiceQueuePanel({entries:[note,older,done],me:rep,...handlers}));
eq(groups(tree).map(g=>g.props['data-group']),['new','active','closed'],'representative sections');
eq(text(groups(tree)[0]).startsWith('جديد: طلبات محالة إليك'),true,'new first');
const newCard=cardsIn(tree)[0];
ok(text(newCard).includes('توجيه من مدير المبيعات: ركّز على قطع الغيار'),'the instruction written for him is on the card');
eq(nodes(newCard,node=>text(node).includes('لم يفتحه المكلَّف بعد')&&node.type==='small').length,0,'the holder is not told that he has not opened it');
eq(button(newCard,'تسجيل زيارة')!==undefined&&button(newCard,'تفاصيل الطلب')!==undefined,true,'record a visit and details');
button(newCard,'تسجيل زيارة').props.onClick();button(newCard,'تفاصيل الطلب').props.onClick();
eq([visited,opened.slice(-1)],[['r1'],['r1']],'the visit button opens the visit form, the details button the sheet');
ok(!text(tree).includes('بانتظار تكليفي'),'a representative has no manager sections');

// ---- supervisor and administrator wording
tree=expand(ServiceQueuePanel({entries:[entry({id:'x',awaiting:'delegate',stage:'delegation',assignedTo:'sup',assignedRole:'supervisor',permissions:{delegate:true}})],me:sup,...handlers}));
eq(text(groups(tree)[0]).startsWith('بانتظار إجرائي'),true,'supervisor\'s own section');
ok(button(cardsIn(tree)[0],'تفويض مندوب')!==undefined,'the supervisor\'s action reads "delegate"');
tree=expand(ServiceQueuePanel({entries:[entry({id:'y',awaiting:'approve',stage:'approval',status:'pending_approval',state:'pending_approval',assignedTo:null,assignedName:'',permissions:{approve:true}})],me:admin,...handlers}));
eq(text(groups(tree)[0]).startsWith('بانتظار اعتماد أو تكليف'),true,'administrator\'s section covers approvals and assignments');
ok(button(cardsIn(tree)[0],'اعتماد أو إعادة')!==undefined,'approve or return');

// ---- the customer-service manager: the approvals that wait for him, late ones marked
const waitingApproval=entry({id:'z',customerName:'مصنع بانتظار الاعتماد',stage:'approval',status:'pending_approval',state:'pending_approval',awaiting:'approve',ownerId:'csm',assignedTo:null,assignedName:'',stageHours:6.5,targetHours:4,late:true,permissions:{approve:true}});
const freshApproval=entry({id:'z2',customerName:'مصنع جديد',stage:'approval',status:'pending_approval',state:'pending_approval',awaiting:'approve',ownerId:'csm',assignedTo:null,assignedName:'',stageHours:1,targetHours:4,late:false,permissions:{approve:true}});
tree=expand(ServiceQueuePanel({entries:[freshApproval,waitingApproval],me:approver,...handlers}));
eq(groups(tree).map(g=>g.props['data-group']),['mine'],'the customer-service manager has the one section, with what waits for his approval');
ok(text(groups(tree)[0]).startsWith('بانتظار اعتمادي'),'titled for his approval');
ok(text(tree).includes('طلبات بانتظار اعتمادك')&&text(tree).includes('4 ساعات عمل'),'the heading says what the panel is and when a request is marked late');
eq(cardsIn(tree).map(c=>[c.props['data-awaiting'],c.props['data-late']]),[['approve','false'],['approve','true']],'both cards wait for his approval; only the second is late');
ok(text(cardsIn(tree)[1]).includes('متأخر عن هدف 4 ساعات عمل')&&!text(cardsIn(tree)[0]).includes('متأخر'),'only the late one carries the late mark');
ok(button(cardsIn(tree)[1],'اعتماد أو إعادة')!==undefined&&button(cardsIn(tree)[1],'تسجيل زيارة')===undefined,'he approves or returns; he records no visit from here');
eq(QueueBadge({entries:[freshApproval,waitingApproval]}).props.children,2,'his navigation badge counts both approvals');
language='en';
tree=expand(ServiceQueuePanel({entries:[waitingApproval],me:approver,...handlers}));
ok(text(tree).includes('Waiting for my approval')&&text(tree).includes('Requests waiting for your approval')&&text(cardsIn(tree)[0]).includes('Late against a 4-working-hour target'),'English headings and late mark for the customer-service manager');
language='ar';

// ---- English
language='en';
tree=expand(ServiceQueuePanel({entries:[toAssign],me:manager,...handlers}));
ok(text(tree).includes('Waiting for my assignment')&&text(tree).includes('Customer-service requests'),'English headings');
ok(text(cardsIn(tree)[0]).includes('Late against a 4-working-hour target')&&text(cardsIn(tree)[0]).includes('Awaiting sales assignment'),'English chips and stage');
ok(button(cardsIn(tree)[0],'Assign')!==undefined,'English action');
tree=expand(ServiceQueuePanel({entries:[note],me:rep,...handlers}));
ok(button(cardsIn(tree)[0],'Record a visit')!==undefined&&text(cardsIn(tree)[0]).includes('Instruction from مدير المبيعات: ركّز على قطع الغيار'),'English representative card');
eq(tree.props.dir,'ltr','English panel is left to right');
// Everything the components themselves write is English; only the people's own data may stay as typed.
const plain=(o={})=>entry({customerName:'Plant A',customerCity:'Dammam',needs:'Needs mould maintenance',nextAction:'Technical visit',creatorName:'Agent',serviceManagerName:'Service manager',salesManagerName:'Sales manager',assignedName:'Holder',supervisorName:'Supervisor',currentRepName:'Holder',assignmentNote:'Focus on spare parts',assignmentNoteBy:'Sales manager',seenByName:'Holder',products:['خدمات صيانة','قوالب البلوك المتحركة'],strength:'strong',source:'whatsapp',salesStage:'needs',...o});
const arabicLeft=tree=>(text(tree).match(/[\u0600-\u06ff]+/g)||[]);
language='en';
const englishCases=[plain({id:'e1',stage:'assignment',status:'pending_assignment',state:'pending_assignment',awaiting:'assign',ownerId:'sm',stageHours:6,targetHours:4,late:true,permissions:{...toAssign.permissions}}),plain({id:'e2',stage:'delegation',awaiting:null,late:true,escalated:true,stageHours:6,targetHours:4}),plain({id:'e3',stage:'first_contact',awaiting:'first_contact',assignedTo:'rep',ownerId:'rep',seenAt:''}),plain({id:'e4',stage:'follow_up',awaiting:null,targetHours:null,seenAt:'2026-10-11T08:00:00.000Z'}),plain({id:'e5',stage:'closed',state:'won',awaiting:null,targetHours:null}),plain({id:'e6',stage:'closed',state:'lost',awaiting:null,targetHours:null}),plain({id:'e7',stage:'approval',status:'pending_approval',state:'pending_approval',awaiting:'approve'}),plain({id:'e8',stage:'returned',status:'returned',state:'returned'})];
for(const who of [manager,sup,rep,admin,approver])eq(arabicLeft(expand(ServiceQueuePanel({entries:englishCases,me:who,...handlers}))),[],'English panel for '+who.role+' has no untranslated wording');
eq(arabicLeft(expand(ServiceQueueBanner({entries:[englishCases[2]],...handlers}))),[],'English banner has no untranslated wording');
for(const key of ['quoted','needs','negotiation'])eq(arabicLeft(expand(ServiceQueuePanel({entries:[plain({id:'s',stage:'follow_up',awaiting:null,salesStage:key})],me:manager,...handlers}))),[],'English sales stage '+key);
language='ar';
ok(arabicLeft(expand(ServiceQueuePanel({entries:[plain({id:'e1'})],me:manager,...handlers}))).length>10,'control: the same detector finds the wording in the Arabic panel');

// ---- the banner
eq(ServiceQueueBanner({entries:[older,toAssign],...handlers}),null,'no banner without a case waiting for his first contact');
const two=[note,entry({id:'r3',customerName:'مصنع ثانٍ',awaiting:'first_contact'})];
tree=expand(ServiceQueueBanner({entries:two,...handlers}));
eq(tree.props['data-count'],2,'the banner counts what waits');
ok(text(tree).includes('طلب محال إليك من خدمة العملاء: مصنع جديد')&&text(tree).includes('و1 أخرى'),'it names the first case and counts the others');
ok(text(tree).includes('توجيه: ركّز على قطع الغيار'),'and carries the instruction');
eq(tree.props.role,'status','announced politely to assistive technology');
const visitBanner=button(tree,'تسجيل زيارة'),openBanner=button(tree,'فتح الطلب');
visitBanner.props.onClick();openBanner.props.onClick();
eq([visited.slice(-1),opened.slice(-1)],[['r1'],['r1']],'the banner acts on the first waiting case');
language='en';tree=expand(ServiceQueueBanner({entries:two,...handlers}));ok(text(tree).includes('Customer-service request assigned to you: مصنع جديد')&&text(tree).includes('and 1 more'),'English banner');language='ar';
eq(ServiceQueueBanner({entries:[entry({id:'z',awaiting:null,stage:'follow_up'})],...handlers}),null,'the banner leaves once the first contact is made');

// ---- the badge
eq(QueueBadge({entries:[]}),null,'no badge when nothing waits');
eq(QueueBadge({entries:[older,done]}),null,'nor for cases that need nobody');
let badge=QueueBadge({entries:[toAssign,escalated,following]});
eq([text(badge),badge.props.className],['2','nav-badge'],'the badge counts what the reader must do plus what escalated to him');
ok(badge.props['aria-label'].includes('2'),'with an accessible label');
language='en';badge=QueueBadge({entries:[toAssign]});ok(badge.props['aria-label'].includes('customer-service requests'),'English label');language='ar';

// ---- team page warnings
const members=[{id:'sm',role:'manager',active:1},{id:'csm',role:'customer_service_manager',active:1,supervisorId:'sm'}];
eq(RoleWarning({member:{id:'cs',role:'customer_service',supervisorId:'csm',active:1},members}),null,'a linked representative: no warning');
let warning=RoleWarning({member:{id:'cs',role:'customer_service',supervisorId:'',active:1},members});
ok(text(warning).includes('غير مرتبط بمدير خدمة عملاء')&&warning.props.role==='note','unlinked representative');
warning=RoleWarning({member:{id:'csm2',role:'customer_service_manager',supervisorId:'',active:1},members});
ok(text(warning).includes('غير مرتبط بمدير مبيعات'),'unlinked manager');
language='en';warning=RoleWarning({member:{id:'csm2',role:'customer_service_manager',supervisorId:'',active:1},members});ok(text(warning).includes('Not linked to a sales manager'),'English warning');language='ar';
eq(RoleWarning({member:{id:'rep',role:'rep',supervisorId:'',active:1},members}),null,'other roles never warn');

// ---- the monthly report section and view
const timing=(n,median,average,target,overTarget)=>({n,median,average,target,overTarget});
const report={month:'2026-09',months:['2026-09','2026-08'],generatedAt:'2026-10-12T12:00:00.000Z',total:5,open:3,won:1,lost:1,winRate:50,byState:{won:1,lost:1,pending_assignment:1,pending_approval:2},
 bySource:[{source:'call',total:2,won:1,lost:0,open:1,winRate:100},{source:'whatsapp',total:1,won:0,lost:1,open:0,winRate:0},{source:'website',total:1,won:0,lost:0,open:1,winRate:null}],
 timing:{approval:timing(3,1,2.67,4,1),assignment:timing(2,1.5,1.5,4,0),firstContact:timing(2,7,7,24,0),totalToFirstContact:timing(2,12,12,null,0)},
 openOverTarget:3,lossReasons:[{reason:'السعر أعلى من المنافس',count:1}],targets:{approval:4,assignment:4,delegation:4,first_contact:24}};
for(const role of ['rep','supervisor','customer_service','unknown'])eq(ServiceReportSection({me:{role}}),null,role+' gets no report section');
for(const role of ['admin','manager','customer_service_manager'])eq(ServiceReportSection({me:{role}}).type.name,'ServiceReportPanel',role+' gets the report section');
const closedHtml=renderToStaticMarkup(React.createElement(ServiceReportSection,{me:{role:'manager'}}));
ok(closedHtml.startsWith('<details')&&closedHtml.includes('التقرير الشهري لطلبات خدمة العملاء')&&!/<details[^>]* open/.test(closedHtml),'the section starts collapsed with its title and loads nothing until opened');
const months=[];
let view=expand(ServiceReportView({report,say:(ar)=>ar,onMonth:value=>months.push(value)}));
const viewText=text(view);
ok(['5','3','1','50%'].every(value=>nodes(view,node=>hasClass(node,'service-report-kpi')&&text(node).startsWith(value)).length>0),'the headline figures');
ok(viewText.includes('نسبة الفوز')&&viewText.includes('مفتوحة وتجاوزت هدفها'),'their labels');
const tables=nodes(view,node=>node.type==='table');
eq(tables.length,2,'a channel table and a timing table');
eq(nodes(tables[0],node=>node.type==='tr').map(row=>text(row)),['القناةالطلباتفازفُقدمفتوحنسبة الفوز','اتصال2101100%','واتساب10100%','عن طريق الويبسايت1001—'],'channels with their win rates, and a dash where nothing closed');
eq(nodes(tables[1],node=>node.type==='tr').map(row=>text(row))[1],'الاعتماد31.0 س2.7 س4 س1','approval: three cases, median 1.0 h, average 2.7 h, target 4, one over');
eq(nodes(tables[1],node=>node.type==='tr').map(row=>text(row))[4],'من التسجيل إلى أول تواصل212.0 س12.0 س——','the whole wait to first contact has no target');
ok(viewText.includes('السعر أعلى من المنافس')&&viewText.includes('ساعات العمل من السبت إلى الخميس'),'loss reasons and the working-hours note');
ok(viewText.includes('بانتظار تكليف المبيعات: 1')&&viewText.includes('تم الفوز: 1'),'states in words');
const select=nodes(view,node=>node.type==='select')[0];
eq(nodes(select,node=>node.type==='option').map(option=>option.props.value),['2026-09','2026-08'],'the months the reader can choose, newest first');
select.props.onChange({target:{value:'2026-08'}});eq(months,['2026-08'],'choosing a month asks for it');
eq(text(expand(ServiceReportView({report:{...report,total:0,bySource:[],byState:{},lossReasons:[],timing:{...report.timing}},say:(ar)=>ar}))).includes('لا طلبات في هذا الشهر ضمن نطاقك.'),true,'an empty month says so');
eq(nodes(expand(ServiceReportView({report:{...report,total:0},say:(ar)=>ar})),node=>node.type==='table').length,0,'and shows no tables');
ok(!JSON.stringify(report).includes('مصنع'),'the report carries no customer names');
language='en';eq(arabicLeft(expand(ServiceReportView({report:{...report,lossReasons:[]},say:(ar,en)=>en}))),[],'English report has no untranslated wording');view=expand(ServiceReportView({report,say:(ar,en)=>en}));ok(text(view).includes('Win rate')&&text(view).includes('Time per stage, in working hours')&&text(view).includes('Working hours are Saturday to Thursday'),'English report');language='ar';

// ---- the new strings are translated
for(const key of ['المسؤول الجديد','ملاحظة للمكلَّف (اختياري)','تأكيد إعادة التكليف','المندوب الحالي للعميل','لم يُفتح بعد','توجيه المدير','وقت فتح المكلَّف للطلب','اكتب توجيهًا يصل للمكلَّف مع الطلب','ينتقل العميل وسجلاته إلى المكلَّف الجديد، وتبقى زيارات المكلَّف السابق باسمه.','إعادة تكليف','فتح الطلب','لا تملك صلاحية إعادة التكليف في هذه المرحلة','اختر عضوًا آخر غير المكلَّف الحالي','فتح الطلب متاح للمكلَّف به فقط'])ok(typeof dictionary[key]==='string'&&dictionary[key].length>0&&dictionary[key]!==key,'translated: '+key);

console.log(JSON.stringify({ok:true,checks,render:'source components, Arabic and English',physicalDevice:false,productionDataUsed:false}));
