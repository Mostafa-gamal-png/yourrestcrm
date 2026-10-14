// The monthly complaints report rendered from the real source: who gets the section, that it starts collapsed, the figures,
// tables, chips, outcomes and timings a report in hand produces, the month selector, the empty month, and the English wording
// without Arabic leftovers. Render contracts only: no browser, no network, no production data.
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
  if(name.startsWith('@/lib/'))return library(name.replace('@/','')+'.ts');
  return mock;
 },console,Date,Intl,crypto,URL,Promise,setTimeout,clearTimeout,window:undefined,navigator:undefined});
 return exports;
}
function expand(node){
 if(node==null||typeof node!=='object')return node;
 if(Array.isArray(node))return node.map(expand);
 if(typeof node.type==='function')return expand(node.type(node.props));
 return {...node,props:{...node.props,children:expand(node.props?.children)}};
}
function nodes(tree,predicate){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(item=>nodes(item,predicate));return [...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];}
function text(tree){if(tree==null||typeof tree==='boolean')return '';if(typeof tree!=='object')return String(tree);return Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);}
const hasClass=(node,name)=>(node.props?.className||'').split(' ').includes(name);
const arabicLeft=tree=>(text(tree).match(/[؀-ۿ]+/g)||[]);
const {ComplaintReportView,ComplaintReportSection}=load('app/complaint-report.tsx');

// ---- the report of tests/complaint-report.mjs, as the route answers it
const timing=(n,median,average,target,overTarget)=>({n,median,average,target,overTarget});
const row=(key,total,open,closed,satisfied,satisfactionRate)=>({key,total,open,closed,satisfied,satisfactionRate});
const report={month:'2026-09',months:['2026-09','2026-08'],generatedAt:'2026-10-12T12:00:00.000Z',total:6,open:3,closed:2,cancelled:1,high:1,satisfied:1,satisfactionRate:50,openOverTarget:3,repeatCustomers:1,
 flow:{returned:1,sentBack:1,reassigned:0,reopened:1},byState:{closed:2,resolved:1,pending_assignment:1,assigned:1,cancelled:1},
 byCategory:[row('product_quality',2,0,2,1,50),row('delivery_delay',1,1,0,0,null),row('invoice_price',1,1,0,0,null),row('maintenance_support',1,1,0,0,null),row('service_conduct',1,0,0,0,null)],
 byChannel:[row('call',2,1,1,0,0),row('email',1,1,0,0,null),row('visit',1,0,1,1,100),row('website',1,0,0,0,null),row('whatsapp',1,1,0,0,null)],
 bySeverity:[row('normal',5,2,2,1,50),row('high',1,1,0,0,null)],byRegion:[row('الشرقية',5,2,2,1,50),row('الغربية',1,1,0,0,null)],
 resolutionOutcomes:[{key:'solved',count:2},{key:'partially_solved',count:1}],closureOutcomes:[{key:'not_satisfied',count:1},{key:'satisfied',count:1}],
 timing:{review:timing(5,1,1.2,4,0),assignment:timing(4,1.5,1.5,4,0),firstContact:timing(3,1,5,24,0),resolution:timing(3,7,5.33,50,0),closure:timing(2,2,2,24,0),registrationToClosure:timing(2,13.5,13.5,null,0)},
 targets:{review:4,assignment:4,delegation:4,first_contact:24,resolution:50,closure:24}};

// ---- who gets the section, and that it loads nothing until opened
for(const role of ['rep','supervisor','customer_service','unknown'])eq(ComplaintReportSection({me:{role}}),null,role+' gets no report section');
for(const role of ['admin','manager','customer_service_manager'])eq(ComplaintReportSection({me:{role}}).type.name,'ComplaintReportPanel',role+' gets the report section');
const closedHtml=renderToStaticMarkup(React.createElement(ComplaintReportSection,{me:{role:'customer_service_manager'}}));
ok(closedHtml.startsWith('<details')&&closedHtml.includes('التقرير الشهري للشكاوى')&&closedHtml.includes('complaint-report')&&!/<details[^>]* open/.test(closedHtml)&&!closedHtml.includes('service-report-kpis'),'the section starts collapsed with its title and no figures');

// ---- the figures
const months=[];
let view=expand(ComplaintReportView({report,say:(ar)=>ar,onMonth:value=>months.push(value)}));
const viewText=text(view);
const kpis=nodes(view,node=>hasClass(node,'service-report-kpi')).map(node=>text(node));
eq(kpis,['6الشكاوى','3مفتوحة','2مغلقة','1ملغاة','50%نسبة رضا العميل','3مفتوحة وتجاوزت هدفها','1أهمية عالية','1عملاء بأكثر من شكوى'],'the headline figures with their labels');
const tables=nodes(view,node=>node.type==='table');
eq(tables.length,4,'category, channel and region tables and the timing table');
const rowsOf=table=>nodes(table,node=>node.type==='tr').map(line=>text(line));
eq(rowsOf(tables[0]),['التصنيفالشكاوىمفتوحةمغلقةالعميل راضٍنسبة الرضا','جودة المنتج أو القالب202150%','التأخر في التسليم1100—','الفاتورة أو السعر1100—','الصيانة والدعم الفني1100—','الخدمة أو التعامل1000—'],'categories in words with the satisfied share, and a dash where nothing closed');
eq(rowsOf(tables[1])[1],'اتصال21100%','the channel that closed one without satisfaction shows 0%');
eq(rowsOf(tables[1])[3],'زيارة1011100%','and the one closed with satisfaction 100%');
eq(rowsOf(tables[2]).slice(1),['الشرقية522150%','الغربية1100—'],'regions');
eq(rowsOf(tables[3]),['المرحلةشكاوىالوسيطالمتوسطالهدفتجاوزت الهدف','المراجعة51.0 س1.2 س4 س0','التكليف41.5 س1.5 س4 س0','أول تواصل بعد التكليف31.0 س5.0 س24 س0','الحل من التكليف37.0 س5.3 س50 س0','تأكيد الإغلاق22.0 س2.0 س24 س0','من التسجيل إلى الإغلاق213.5 س13.5 س——'],'every stage with its median, average, target and how many went over; the whole life has no target');
const chips=nodes(view,node=>hasClass(node,'service-queue-chip')).map(node=>text(node));
eq(chips,['عادية: 5','عالية: 1','مغلقة: 2','بانتظار تأكيد الإغلاق: 1','بانتظار تكليف المبيعات: 1','مكلّف بها: 1','ملغاة: 1','أُعيدت للتعديل: 1','أُعيدت إلى المندوب: 1','أُعيد تكليفها: 0','أُعيد فتحها: 1'],'severity, current states and what went a step back, in words');
eq(nodes(view,node=>node.type==='li').map(node=>text(node)),['الحل: حُلّت2','الحل: حُلّت جزئيًا1','الإغلاق: أُغلقت دون رضا العميل1','الإغلاق: العميل راضٍ1'],'resolution and closure outcomes');
ok(viewText.includes('ساعات العمل من السبت إلى الخميس')&&viewText.includes('نسبة الرضا هي الشكاوى المغلقة بنتيجة «العميل راضٍ» من كل المغلقة'),'the working-hours and satisfaction note');
const select=nodes(view,node=>node.type==='select')[0];
eq(nodes(select,node=>node.type==='option').map(option=>option.props.value),['2026-09','2026-08'],'the months the reader can choose, newest first');
select.props.onChange({target:{value:'2026-08'}});eq(months,['2026-08'],'choosing a month asks for it');

// ---- an empty month
const empty={...report,total:0,open:0,closed:0,cancelled:0,high:0,satisfied:0,satisfactionRate:null,openOverTarget:0,repeatCustomers:0,flow:{returned:0,sentBack:0,reassigned:0,reopened:0},byState:{},byCategory:[],byChannel:[],bySeverity:[],byRegion:[],resolutionOutcomes:[],closureOutcomes:[],timing:{review:timing(0,null,null,4,0),assignment:timing(0,null,null,4,0),firstContact:timing(0,null,null,24,0),resolution:timing(0,null,null,50,0),closure:timing(0,null,null,24,0),registrationToClosure:timing(0,null,null,null,0)}};
view=expand(ComplaintReportView({report:empty,say:(ar)=>ar}));
ok(text(view).includes('لا شكاوى في هذا الشهر ضمن نطاقك.')&&nodes(view,node=>node.type==='table').length===0&&nodes(view,node=>hasClass(node,'service-report-kpi')).length===8,'an empty month says so, keeps the headline zeros and shows no tables');
eq(nodes(view,node=>hasClass(node,'service-report-kpi')).map(node=>text(node))[4],'—نسبة رضا العميل','and a dash for the satisfaction share');

// ---- English
language='en';
view=expand(ComplaintReportView({report,say:(ar,en)=>en}));
eq(arabicLeft(view),[],'the English report has no untranslated wording, the regions included');
const english=text(view);
ok(['Customer satisfaction','Open past target','Customers with more than one','By category','Product or mold quality','By channel','By region','Eastern','Severity and current state','What went a step back','Reopened: 1','Resolution: Solved','Closure: Customer satisfied','Time per stage, in working hours','Registration to closure','Working hours are Saturday to Thursday'].every(part=>english.includes(part)),'the English wording');
eq(nodes(view,node=>node.type==='table').map(table=>nodes(table,node=>node.type==='tr').map(line=>text(line))[1]),['Product or mold quality202150%','Phone call21100%','Eastern522150%','Review51.0 h1.2 h4 h0'],'the English rows');
eq(text(expand(ComplaintReportView({report:empty,say:(ar,en)=>en}))).includes('No complaints this month in your scope.'),true,'the English empty month');
language='ar';
console.log(JSON.stringify({ok:true,checks,renderOnly:true,productionDataUsed:false}));
