// Render actual navigation and customer picker components for each role.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let checks=0;
const check=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const noop=()=>{},pass=({children,...props})=>React.createElement('div',{'aria-label':props['aria-label']},typeof children==='function'?null:children);
const mock=new Proxy({},{get:()=>pass});
const compiler={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true};
function moduleFrom(filename,require,extra=''){
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8')+extra,{compilerOptions:compiler}).outputText,{exports,require,crypto:globalThis.crypto,console,structuredClone,window:{},setTimeout,clearTimeout});return exports;
}
const access=moduleFrom('lib/access.ts',()=>({}));
const mapSearch=moduleFrom('lib/customer-map-search.ts',()=>({}));
const i18n={t:value=>value,useLanguage:()=>({language:'ar'}),direction:()=> 'rtl',getLanguage:()=> 'ar'};
function mockedRequire(name){
 if(name==='react')return React;
 if(name==='react/jsx-runtime')return jsx;
 if(name==='@/lib/access')return access;
 if(name==='@/lib/customer-map-search')return mapSearch;
 if(name==='@/lib/i18n')return i18n;
 if(name==='@/lib/regions')return {regionValue:()=> 'الشرقية'};
 if(name==='./support-panel')return new Proxy({useSupport:()=>({data:null,refresh:async()=>{},byCustomer:{},canRequest:()=>false,badge:0})},{get:(target,key)=>target[key]||pass});
 if(name==='@/components/ui/sidebar')return {...Object.fromEntries(['SidebarMenu','SidebarMenuItem','SidebarMenuButton'].map(key=>[key,pass])),useSidebar:()=>({setOpenMobile:noop})};
 if(name==='@base-ui/react')return {Combobox:mock};
 return mock;
}
const {NavMenu}=moduleFrom('app/crm-app.tsx',mockedRequire,'\nexport {NavMenu};\n');
const {default:Picker}=moduleFrom('app/visit-customer-picker.tsx',mockedRequire);
const pages=[['activity','الزيارات'],['followup','المتابعات'],['journeys','تقرير يوم المندوب'],['targets','المستهدفات وتقييم الأداء'],['sales','المبيعات'],['quote','عروض الأسعار'],['reports','تقييم أداء المناديب'],['customer','العملاء'],['map','خريطة المصانع'],['team','الفريق والصلاحيات'],['dashboard','لوحة المتابعة']];
for(const role of ['rep','supervisor','manager','admin','customer_service','customer_service_manager','unknown']){
 const html=renderToStaticMarkup(React.createElement(NavMenu,{view:'activity',role,go:noop}));
 for(const [id,label] of pages){const expected=role==='rep'?['customer','map','activity','followup','targets'].includes(id):role.startsWith('customer_service')?id==='activity':role==='admin'?id!=='reports':['manager','supervisor'].includes(role)?!['team','reports'].includes(id):false;check(html.includes('>'+(role==='rep'&&id==='targets'?'مستهدفي':label)+'<'),expected,role+' navigation '+id);}
}
for(const role of ['rep','supervisor','manager','admin','customer_service']){
 const html=renderToStaticMarkup(React.createElement(Picker,{customers:[],value:'',me:{id:'test',role,branch:'الرئيسي',regionScope:'eastern'},disabled:false,locked:false,onChange:noop,onCreated:noop,onCreating:noop,onSaving:noop}));
 check(html.includes('<button'),true,role+' customer creation button');
 check(html.includes('visit-add-customer')&&html.includes('إضافة عميل'),true,role+' accessible inline customer creation action');
}


// Actual expanded customer rows keep read-only directory actions available to a rep.
const location=moduleFrom('lib/customer-location.ts',()=>({}));
const {CustomerRows}=moduleFrom('app/customer-machines.tsx',name=>{
 if(name==='@/lib/customer-location')return location;
 if(name==='@/lib/machines')return {machineTypeLabels:{mobile:'متحركة'},completeMachineSpecs:()=>true};
 return mockedRequire(name);
},'\nexport {CustomerRows};\n');
const customer={id:'factory',kind:'customer',assignedTo:'owner',branch:'الرئيسي',data:{name:'Regional factory',region:'الغربية',location:'21.5, 39.2',_masterReadOnly:true}};
const machine={id:'machine',kind:'factory',parentId:customer.id,assignedTo:'owner',data:{name:'Regional machine',machineType:'mobile',machineBrand:'QA',machineModel:'M1',_masterReadOnly:true}};
const rowProps={customer,linked:[machine],canEdit:true,open:true,onToggle:noop,sourceCount:1,visitCount:2,memberName:'Owner',onOpen:noop,onHistory:noop,onEdit:noop,onAddMachine:noop,onAddOpportunity:noop,onMap:noop};
let html=renderToStaticMarkup(React.createElement(CustomerRows,rowProps));
for(const text of ['زيارة جديدة','سجل الزيارات','بيانات العميل','موقع المصنع','التفاصيل والمتابعات'])check(html.includes(text),true,'readonly directory action '+text);
for(const text of ['إضافة ماكينة','>تعديل<'])check(html.includes(text),false,'readonly directory forbids '+text);
html=renderToStaticMarkup(React.createElement(CustomerRows,{...rowProps,customer:{...customer,data:{...customer.data,_masterReadOnly:false}},linked:[{...machine,data:{...machine.data,_masterReadOnly:false}}]}));
check(html.includes('إضافة ماكينة'),true,'authorized master controls retained');check(html.includes('>تعديل<'),true,'authorized machine edit retained');
html=renderToStaticMarkup(React.createElement(CustomerRows,{...rowProps,canEdit:false,customer:{...customer,data:{...customer.data,_masterReadOnly:false}},linked:[{...machine,data:{...machine.data,_masterReadOnly:false}}]}));
for(const text of ['إضافة ماكينة','>تعديل<'])check(html.includes(text),false,'rep role forbids own unflagged saved-row action '+text);
for(const text of ['زيارة جديدة','سجل الزيارات','بيانات العميل','موقع المصنع','التفاصيل والمتابعات'])check(html.includes(text),true,'rep role keeps own saved-row reader/creation action '+text);
// Render the real CRM with a retained Visits staff filter; directory and map must ignore it.
// Seed hook state by its declared name, so this exercises the component's filtering and controls.
const source=fs.readFileSync(path.join(root,'app/crm-app.tsx'),'utf8');
const tree=ts.createSourceFile('crm-app.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),stateNames=[];
function collect(node){if(ts.isVariableDeclaration(node)&&ts.isArrayBindingPattern(node.name)&&node.initializer&&ts.isCallExpression(node.initializer)&&node.initializer.expression.getText(tree)==='useState')stateNames.push(node.name.elements[0].name.getText(tree));ts.forEachChild(node,collect);}collect(tree);
const me={id:'rep',name:'Rep',role:'rep',regionScope:'western',branch:'الرئيسي'},records=[customer,machine,{id:'visit',kind:'activity',parentId:customer.id,assignedTo:'owner',data:{performedBy:'rep',summary:'My visit',date:'2026-09-30'}}];
let cursor=0,seed={},captured={};
const hookReact={...React,useState:initial=>{const name=stateNames[cursor++];return[Object.hasOwn(seed,name)?seed[name]:typeof initial==='function'?initial():initial,noop];},useEffect:noop,useCallback:callback=>callback,useMemo:compute=>compute};
function crmRequire(name){
 if(name==='react')return hookReact;
 if(name==='./support-panel')return new Proxy({useSupport:()=>({data:null,refresh:async()=>{},byCustomer:{},canRequest:()=>false,badge:0})},{get:(target,key)=>target[key]||pass});
 if(name==='@/components/ui/sidebar')return new Proxy({useSidebar:()=>({setOpenMobile:noop})},{get:(target,key)=>target[key]||pass});
 if(name==='@/lib/crm')return {stages:[],stageLabels:{},roles:{rep:'مندوب المبيعات'},today:()=> '2026-09-30',money:String,isOpen:()=>false,isSalesRequest:r=>r.kind==='opportunity',followupTitle:r=>r.data.name||''};
 if(name==='@/lib/customer-service')return {isServiceRole:role=>role.startsWith('customer_service')};
 if(name==='@/lib/customer-visits')return {customerVisitDue:()=>[],visitCustomer:r=>r?.kind==='customer'?r:records.find(c=>c.id===r?.parentId),visitRequest:()=>undefined,strengthLabels:{}};
 if(name==='@/lib/regions')return {regionScope:m=>m.regionScope,regionLabel:()=> 'الغربية',regionValue:()=> 'الغربية'};
 if(name==='./customer-machines')return {__esModule:true,default:props=>{captured.directory=props;return React.createElement('section',{'data-directory-count':props.customers.length},props.customers.map(r=>r.data.name).join(' · '));}};
 if(name==='./customer-journey-map')return {__esModule:true,default:props=>{captured.map=props;return React.createElement('section',{'data-map-count':props.customers.length},props.filters,props.actions,props.customers.map(r=>r.data.name).join(' · '));}};
 if(name==='./journey-report')return {__esModule:true,default:props=>{captured.journey=props;return React.createElement('section',{'data-journey-report':'true'});}};
 if(name==='./my-targets')return {__esModule:true,default:props=>{captured.myTargets=props;return React.createElement('section',{'data-my-targets':'true'});}};
 if(name==='./sales-workspace')return {__esModule:true,default:props=>{captured.sales=props;return React.createElement('section',{'data-sales-workspace':'true'});}};
 if(name==='./journey-tracker')return {JourneyTrackerProvider:({children})=>children,JourneyTrackingBanner:()=>null};
 if(name==='./customer-visits')return {VisitsPage:props=>{captured.visits=props;return null;},CustomerVisitDialog:pass,CustomerVisitHistory:pass};
 if(name==='./customer-followups')return {CustomerFollowupsPage:props=>{captured.followups=props;return null;},CustomerFollowupDialog:pass};
 return mockedRequire(name);
}
const {default:CRM}=moduleFrom('app/crm-app.tsx',crmRequire);
for(const view of ['activity','followup','customer','map']){
 cursor=0;captured={};seed={view,records,members:[me],me,loading:false,staffFilter:'rep'};
 html=renderToStaticMarkup(React.createElement(CRM));
 check(html.includes('aria-label="المندوب"'),false,view+' hides staff dropdown for rep');
 if(view==='activity'||view==='followup'){check((view==='activity'?captured.visits:captured.followups).staff,'all',view+' ignores stale rep staff filter over server-authorized records');continue;}
 const visible=view==='customer'?captured.directory:captured.map;
 check(visible.customers.map(r=>r.id),['factory'],view+' retains regional owner-assigned customer after Visits self-filter');
 if(view==='map'){
  check(visible.actions,undefined,'Simplified map has no create or export action slot');
  check(visible.onOpen,undefined,'Map does not receive a record editor callback');
  check(visible.onVisit,undefined,'Map does not receive a visit form callback');
  check(html.includes('إضافة عميل'),false,'Map customer creation button removed intentionally');
  check(html.includes('زيارة جديدة'),false,'Map visit creation button removed intentionally');
 }else{
  const heading=html.slice(html.indexOf('heading-actions'),html.indexOf('</section>',html.indexOf('heading-actions')));
  check(heading.includes('زيارة جديدة'),true,'Customer directory header starts a visit');
  check(heading.includes('إضافة عميل'),true,'Customer directory still offers customer creation');
 }
}
for(const role of ['supervisor','manager'])for(const view of ['activity','followup']){
 const manager={...me,id:role,name:role,role};cursor=0;captured={};seed={view,records,members:[manager,me],me:manager,loading:false,staffFilter:'rep'};
 html=renderToStaticMarkup(React.createElement(CRM));
 check(html.includes('aria-label="المندوب"'),true,role+' retains staff dropdown on '+view);
 check((view==='activity'?captured.visits:captured.followups).staff,'rep',role+' retains selected team member on '+view);
}
for(const role of ['supervisor','manager','admin']){
 const manager={...me,id:role,name:role,role};cursor=0;captured={};seed={view:'journeys',records,members:[manager,me],me:manager,loading:false,staffFilter:'rep'};
 html=renderToStaticMarkup(React.createElement(CRM));
 check(captured.journey?.me.id,role,role+' opens the daily route page');
 check(html.includes('aria-label="المندوب"'),false,role+' journey page uses its own authorized team selector');
 check(html.includes('data-journey-report="true"'),true,role+' route report renders');
}
for(const role of ['rep','supervisor','manager','admin']){
 const actor={...me,id:role,name:role,role};cursor=0;captured={};seed={view:'targets',records,members:[actor,me],me:actor,loading:false,staffFilter:'rep',month:'2026-10'};
 html=renderToStaticMarkup(React.createElement(CRM));
 check(!!captured.myTargets,role==='rep',role+' personal target workspace visibility');
 check(!!captured.sales,role!=='rep',role+' commercial workspace visibility');
 check(html.includes('aria-label="المندوب"'),false,role+' target page has no generic CRM staff selector');
 if(role==='rep'){
  check(captured.myTargets.me.id,'rep','personal target workspace receives only the signed-in member');
  check(captured.myTargets.month,'2026-10','personal target workspace receives the selected month');
  check(html.includes('<h1>مستهدفي</h1>'),true,'rep targets heading uses personal label');
  const heading=html.slice(html.indexOf('heading-actions'),html.indexOf('</section>',html.indexOf('heading-actions')));
  check(heading.includes('<button'),false,'rep targets heading offers no create or export controls');
 }else{check(captured.sales.mode,'targets-performance',role+' target page renders the unified management workspace');check(html.includes('<h1>المستهدفات وتقييم الأداء</h1>'),true,role+' unified page heading');check(captured.sales.onTargets,undefined,'Merged workspace has no separate-page navigation callback');}
}
console.log(JSON.stringify({ok:true,checks,type:'actual navigation, picker, readonly customer rows and CRM directory/map state SSR',realBrowser:false}));
