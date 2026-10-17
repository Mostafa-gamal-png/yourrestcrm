// Exercise the real customer-create entry points with controlled React hooks and network responses.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';
import {makeVoiceField,expandVoiceFields} from '../scripts/lib/voice-field-stub.mjs';

const root=process.cwd(),nativeRequire=createRequire(import.meta.url),cache=new Map();
const compiler={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true};
let checks=0,language='ar';
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const noop=()=>{},pass=({children})=>typeof children==='function'?null:children;
const mock=new Proxy({},{get:()=>pass});
const dictionary=JSON.parse(fs.readFileSync(path.join(root,'lib/locales/en.json'),'utf8'));
const i18n={t:value=>language==='en'&&typeof value==='string'?(dictionary[value]||value):value,useLanguage:()=>({language}),getLanguage:()=>language,direction:()=>language==='ar'?'rtl':'ltr'};
function load(filename,require,globals={}){
 const clientSubmit=()=>load('lib/client-submit.ts',nativeRequire,{AbortController,DOMException,URL,setTimeout,clearTimeout,...globals});
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,Error,TypeError,require:name=>name==='@/lib/client-submit'?clientSubmit():name==='@/lib/offline-submit'?{offlineSubmit:(url,body,options)=>clientSubmit().submitJson(url,{method:'POST',headers:{'Content-Type':'application/json'},body},options)}:require(name),console,crypto:globalThis.crypto,structuredClone,Intl,setTimeout,clearTimeout,...globals});return exports;
}
function library(filename){
 if(cache.has(filename))return cache.get(filename);
 const exports={};cache.set(filename,exports);
 const require=name=>name.startsWith('.')?library(path.join(path.dirname(filename),name)+'.ts'):nativeRequire(name);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,require,Intl,console});return exports;
}
function commonRequire(name){
 if(name==='react')return React;
 if(name==='react/jsx-runtime')return jsx;
 if(name==='./voice-field')return {__esModule:true,default:VoiceFieldStub};if(name==='@/lib/i18n')return i18n;
 if(name.startsWith('@/lib/'))return library(name.replace('@/','')+'.ts');
 if(name==='@base-ui/react')return {Combobox:mock};
 if(name==='./support-panel')return new Proxy({useSupport:()=>({data:null,refresh:async()=>{},byCustomer:{},canRequest:()=>false,badge:0})},{get:(target,key)=>target[key]||pass});
 if(name==='./complaints-panel')return new Proxy({useComplaints:()=>({data:null,refresh:async()=>{},forCustomer:()=>[],badge:0})},{get:(target,key)=>target[key]||pass});
 if(name==='@/components/ui/sidebar')return new Proxy({useSidebar:()=>({setOpenMobile:noop})},{get:(target,key)=>target[key]||pass});
 if(name==='./region-picker')return load('app/region-picker.tsx',commonRequire);
 if(name==='./customer-entry-fields')return {__esModule:true,default:function CustomerLocationFields(){},CustomerClassificationFields:function CustomerClassificationFields(){}};
 if(name==='sonner')return {Toaster:pass,toast:{success:noop,error:noop}};
 return mock;
}
function nodes(tree,predicate){
 if(!tree||typeof tree!=='object')return [];
 if(Array.isArray(tree))return tree.flatMap(node=>nodes(node,predicate));
 tree=expandVoiceFields(tree);
 return [...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate),...nodes(tree.props?.actions,predicate),...nodes(tree.props?.filters,predicate)];
}
const VoiceFieldStub=makeVoiceField(value=>i18n.t(value));
function text(tree){if(tree===null||tree===undefined||typeof tree==='boolean')return '';if(typeof tree!=='object')return String(tree);if(Array.isArray(tree))return tree.map(text).join('');return text(tree.props?.children);}
function button(tree,label){return nodes(tree,node=>node.type==='button'&&text(node)===label)[0];}
function stateNames(filename){
 const source=ts.createSourceFile(filename,fs.readFileSync(path.join(root,filename),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),names=[];
 function visit(node){if(ts.isVariableDeclaration(node)&&ts.isArrayBindingPattern(node.name)&&node.initializer&&ts.isCallExpression(node.initializer)&&node.initializer.expression.getText(source)==='useState')names.push(node.name.elements[0].name.getText(source));ts.forEachChild(node,visit);}visit(source);return names;
}
function harness(filename,seed={},props={},globals={}){
 const names=stateNames(filename),state={...seed},refs=[];let cursor=0,refCursor=0,tree;
 const hooks={...React,useState(initial){const name=names[cursor++];if(!Object.hasOwn(state,name))state[name]=typeof initial==='function'?initial():initial;return[state[name],value=>{state[name]=typeof value==='function'?value(state[name]):value;}];},useRef(value){const index=refCursor++;return refs[index]||(refs[index]={current:value});},useEffect:noop,useCallback:callback=>callback,useMemo:compute=>compute()};
 const component=load(filename,name=>name==='react'?hooks:commonRequire(name),{window:{history:{replaceState:noop}},...globals}).default;
 return {state,render(){cursor=refCursor=0;tree=component(props);return tree;},tree:()=>tree};
}
const me={id:'rep-west',name:'Western rep',email:'rep@yourrest.org',role:'rep',regionScope:'western',branch:'HQ',active:1,target:0};
const customer={id:'existing',kind:'customer',parentId:null,assignedTo:'other',branch:'HQ',data:{name:'Existing factory',region:'الغربية',location:'21.5, 39.2',_masterReadOnly:true},createdAt:'2026-09-30T08:00:00Z',updatedAt:'2026-09-30T08:00:00Z',version:1};
for(const view of ['customer','map']){
 const h=harness('app/crm-app.tsx',{view,records:[customer],members:[me],me,loading:false});
 let tree=h.render();
 if(view==='map'){
  eq(button(tree,'إضافة عميل'),undefined,'Simplified map does not duplicate customer creation');
  eq(button(tree,'زيارة جديدة'),undefined,'Simplified map does not open a visit form');
  eq(h.state.form,null,'Map remains outside the creation flow');
  continue;
 }
 ok(button(tree,'إضافة عميل'),view+' exposes customer creation');ok(button(tree,'زيارة جديدة'),view+' retains New visit');
 button(tree,'إضافة عميل').props.onClick();
 eq(h.state.form.kind,'customer',view+' Add customer opens the customer form');
 eq(h.state.form.row,undefined,'Creation never reuses an existing row');eq(h.state.form.parentId,'','New customers are roots');
 eq(h.state.form.data.region,'الغربية','Assigned region prefilled');eq(h.state.form.data.assignedTo,me.id,'Assignment defaults to self');eq(h.state.form.data.branch,me.branch,'Branch defaults to own branch');eq(h.state.form.data.customerType,'','Customer type waits for a real selection');ok(/^[0-9a-f-]{36}$/.test(h.state.form.createKey),'Creation has an idempotency key');
 tree=h.render();const form=nodes(tree,node=>node.type==='form')[0];
 eq(nodes(form,node=>node.type==='label'&&text(node).includes('فرع يورست المسؤول')).length,0,'Rep has no editable branch field');
 eq(nodes(form,node=>node.type==='label'&&text(node).includes('المندوب المسؤول')).length,0,'Rep has no assignee selector');
 const region=nodes(form,node=>typeof node.type==='function'&&node.type.name==='CustomerRegionField')[0];
 const fieldset=region.type(region.props);eq(fieldset.props.disabled,true,'Assigned region is disabled');eq(nodes(fieldset,node=>node.type==='input'&&node.props.checked)[0].props.value,'الغربية','Disabled region shows own region');
 ok(nodes(form,node=>node.type?.name==='CustomerLocationFields').length===1,'Shared automatic location component is available in main creation');
 if(view==='customer'){
  h.state.form=null;tree=h.render();const directory=nodes(tree,node=>typeof node.props?.onAddMachine==='function'&&typeof node.props?.onEdit==='function')[0];
  directory.props.onEdit(customer);eq(h.state.form,null,'Rep cannot edit a directory customer');
  directory.props.onEdit({...customer,data:{...customer.data,_masterReadOnly:false}});eq(h.state.form.row.id,customer.id,'Permitted regional customer can be edited');eq(h.state.form.data.assignedTo,customer.assignedTo,'Editing preserves assignment');h.state.form=null;
  directory.props.onAddMachine(customer.id);eq(h.state.form,null,'Customer creation does not unlock machine creation');
  directory.props.onEdit({...customer,kind:'quote',data:{}});eq(h.state.form,null,'Customer creation does not unlock quote editing');
  directory.props.onAddOpportunity(customer.id);ok(h.state.visitEditor,'Read-only customer still supports a new visit');
 }
}

const {CustomerRegionField}=load('app/region-picker.tsx',commonRequire);
for(const scope of ['all','unassigned']){
 const actor={...me,regionScope:scope};const field=CustomerRegionField({value:'',onChange:noop,me:actor});
 eq(field.props.disabled,scope!=='all',scope+' region restriction honored');
 eq(nodes(field,node=>node.type==='input'&&node.props.checked).map(node=>node.props.value),scope==='all'?[]:[''],scope+' unassigned region remains representable');
}

async function pickerCase({retryRefresh=false,locale='ar'}={}){
 language=locale;const requests=[],created=[],selected=[],creating=[],saving=[];let refreshes=0;
 const newCustomer={...customer,id:'new-customer',assignedTo:me.id,data:{name:'New factory',region:'الغربية',location:'21.6, 39.3',_masterReadOnly:true}};
 const props={customers:[customer],value:'',me,disabled:false,locked:false,onChange:(id,row)=>selected.push({id,row}),onCreated:async id=>{created.push(id);if(retryRefresh&&refreshes++===0)throw new Error('Refresh failed');return newCustomer;},onCreating:value=>creating.push(value),onSaving:value=>saving.push(value)};
 const h=harness('app/visit-customer-picker.tsx',{},props,{fetch:async(url,config)=>{requests.push({url,body:JSON.parse(config.body)});return {ok:true,json:async()=>({id:newCustomer.id})};}});
 let tree=h.render();button(tree,locale==='en'?'Add customer':'إضافة عميل').props.onClick();tree=h.render();
 eq(h.state.adding,true,'Inline form opens');eq(h.state.draft.region,'الغربية','Inline region defaults to own region');eq(creating.at(-1),true,'Parent is told customer creation is in progress');
 const fill=(label,value)=>{const node=nodes(tree,node=>node.type==='label'&&text(node)===label)[0];ok(node,'Input exists: '+label);nodes(node,child=>child.type==='input')[0].props.onChange({target:{value}});};
 fill(locale==='en'?dictionary['اسم المصنع *']:'اسم المصنع *','New factory');
 const location=nodes(tree,node=>node.type?.name==='CustomerLocationFields')[0];
 location.props.onUpdate(current=>({...current,location:'21.6, 39.3'}));
 tree=h.render();await button(tree,locale==='en'?dictionary['حفظ واختيار العميل']:'حفظ واختيار العميل').props.onClick();tree=h.render();
 eq(requests.length,1,'One customer save request');eq(requests[0].url,'/api/crm','Uses authenticated customer endpoint');
 const body=requests[0].body;eq(body.kind,'customer');eq(body.id,undefined,'Inline create sends no existing ID');eq(body.parentId,undefined,'Inline create sends no parent');eq(body.data.region,'الغربية');eq(body.data.assignedTo,me.id);eq(body.data.branch,me.branch);eq(body.data.location,'21.6, 39.3');ok(/^[0-9a-f-]{36}$/.test(body.createKey),'Inline save has idempotency key');
 if(retryRefresh){eq(selected.length,0,'No selection until authorized refresh succeeds');eq(h.state.savedId,newCustomer.id,'Saved ID retained during refresh failure');await button(tree,locale==='en'?dictionary['إعادة المحاولة']:'إعادة المحاولة').props.onClick();tree=h.render();eq(requests.length,1,'Refresh retry does not create a duplicate');eq(created.length,2,'Refresh retried by existing ID');}
 eq(selected.length,1,'Newly saved customer selected immediately');eq(selected[0].id,newCustomer.id);eq(selected[0].row,newCustomer,'Visit/followup receives refreshed authorized customer');eq(h.state.adding,false,'Inline editor closes');eq(creating.at(-1),false,'Parent leaves creation state');eq(saving.at(-1),false,'Parent save lock released');
 eq(JSON.parse(JSON.stringify(library('lib/customer-location.ts').customerCoordinates(newCustomer.data))),{latitude:21.6,longitude:39.3},'New customer coordinates resolve for map and journey tracking');
}
await pickerCase({retryRefresh:true});await pickerCase({locale:'en'});language='ar';
const locked=harness('app/visit-customer-picker.tsx',{}, {customers:[customer],value:customer.id,me,disabled:false,locked:true,onChange:noop,onCreated:noop,onCreating:noop,onSaving:noop});
eq(button(locked.render(),'إضافة عميل'),undefined,'An existing visit still locks customer creation and replacement');
// Imported clients can retain an admin/retired assignee who is absent from this
// viewer's selector. Editing details must not require selecting another owner.
for(const [role,regionScope] of [['rep','western'],['manager','western'],['manager','all']]){
 const actor={...me,id:role+'-west',role,regionScope};
 const imported={...customer,assignedTo:'global-admin',data:{...customer.data,_masterReadOnly:false,_masterRoutingReadOnly:role==='manager'}};
 const h=harness('app/crm-app.tsx',{view:'customer',records:[imported],members:[actor],me:actor,loading:false,detailId:imported.id});
 let tree=h.render();ok(button(tree,'تعديل'),role+' can open permitted customer detail editor');
 eq(nodes(tree,node=>node.type==='button'&&node.props.title==='حذف السجل').length,0,role+' detail permission does not grant deletion');
 eq(button(tree,'إضافة ماكينة / خط إنتاج'),undefined,role+' detail permission does not grant machine creation');
 button(tree,'تعديل').props.onClick();tree=h.render();
 eq(h.state.form.data.assignedTo,'global-admin',role+' editor preserves omitted current assignee');
 eq(h.state.form.data.branch,imported.branch,role+' editor preserves canonical branch');
 const form=nodes(tree,node=>node.type==='form')[0];
 if(role==='manager')eq(nodes(form,node=>typeof node.type==='function'&&node.type.name==='CustomerRegionField')[0].props.disabled,true,'Detail-only manager cannot select a routing region change, including all-region manager');
 const routing=nodes(form,node=>node.type==='label'&&['المندوب المسؤول','فرع يورست المسؤول'].includes(text(node.props.children?.[0])));
 if(role==='rep')eq(routing.length,0,'Rep cannot change routing');
 else{
  eq(routing.length,2,'Manager sees retained routing values');
  for(const field of routing)ok(nodes(field,node=>node.type==='input'&&node.props.readOnly).length===1,'Detail-only manager routing input is read-only');
  const directory=nodes(tree,node=>typeof node.props?.onAddMachine==='function'&&typeof node.props?.onEdit==='function')[0];
  h.state.form=null;directory.props.onAddMachine(imported.id);eq(h.state.form,null,'Hidden machine action remains guarded if invoked');
 }
}
// A compact selected customer is reversible; searching only uses the authorized rows supplied.
const searchCustomers=[
 {...customer,id:'east',data:{name:'مصنع الأفلاك',code:'C-10',region:'الشرقية',city:'الدمام',contact:'أحمد',phone:'+966 (55) 123-4567'}},
 {...customer,id:'west',data:{name:'مصنع التميز',internalCode:'YR-C-000123',code:'W-20',region:'الغربية',city:'جدة',phone:'050 888 1122',phone2:'0549992233'}},
];
const picked=[];
const searchProps={customers:searchCustomers,value:'',me,disabled:false,locked:false,onChange:(id,row)=>picked.push({id,row}),onCreated:noop,onCreating:noop,onSaving:noop};
const searchHarness=harness('app/visit-customer-picker.tsx',{},searchProps);
const combobox=tree=>nodes(tree,node=>Array.isArray(node.props?.filteredItems))[0];
for(const [query,ids] of [['افلاك',['east']],['٠٥٠٨٨٨',['west']],['+966551234',['east']],['055-123',['east']],['٠٥٤ ٩٩٩',['west']],['احمد',['east']],['جدة',['west']],['W-20',['west']],['YR-C-000123',['west']],['الشرقية',['east']],['missing-factory',[]]]){
 searchHarness.state.query=query;
 eq(Array.from(combobox(searchHarness.render()).props.filteredItems,row=>row.id),ids,'Search handles '+query);
}
searchHarness.state.query='';
combobox(searchHarness.render()).props.onValueChange(searchCustomers[1]);
eq(picked.at(-1).id,'west','Selecting a search result passes its authorized ID');
eq(picked.at(-1).row,searchCustomers[1],'Selection preserves authorized row');
searchProps.value='west';let searchTree=searchHarness.render();
ok(nodes(searchTree,node=>node.props?.className==='visit-selected-customer').length===1,'Selected customer is compact');
eq(combobox(searchTree),undefined,'Selected customer has no duplicate search field');
button(searchTree,'تغيير').props.onClick();searchTree=searchHarness.render();
ok(combobox(searchTree),'Change reveals the customer search');
button(searchTree,'إلغاء').props.onClick();searchTree=searchHarness.render();
eq(combobox(searchTree),undefined,'Cancel search returns to the selected identity');
eq(picked.length,1,'Cancel does not clear or replace selection');

// Optional details stay collapsed; in-flight automatic capture blocks writes but denial permits retry/fallback.
let blockedWrites=0;
const optional=harness('app/visit-customer-picker.tsx',{}, {...searchProps,value:''},{fetch:async()=>{blockedWrites++;throw new Error('Unexpected write');}});
let optionalTree=optional.render();button(optionalTree,'إضافة عميل').props.onClick();optionalTree=optional.render();
eq(nodes(optionalTree,node=>node.type==='details')[0].props.open,false,'Optional code/address start collapsed');
eq(nodes(optionalTree,node=>node.type==='input'&&node.props.type==='tel')[0].props.inputMode,'tel','Mobile number opens a telephone keyboard');
await button(optionalTree,'حفظ واختيار العميل').props.onClick();
eq(optional.state.invalidField,'name','Blank required name has a targeted error');eq(blockedWrites,0,'Blank name never reaches API');
const locationFields=nodes(optionalTree,node=>node.type?.name==='CustomerLocationFields')[0];
locationFields.props.onPendingChange(true);optionalTree=optional.render();
eq(button(optionalTree,'حفظ واختيار العميل').props.disabled,true,'Location and address capture complete before save');
await button(optionalTree,'حفظ واختيار العميل').props.onClick();eq(blockedWrites,0,'Enter/callback cannot bypass location capture wait');
locationFields.props.onPendingChange(false);optionalTree=optional.render();eq(button(optionalTree,'حفظ واختيار العميل').props.disabled,false,'Capture denial releases save and allows explicit blank fallback');
const phoneCreate=harness('app/visit-customer-picker.tsx',{query:'٠٥٥ ١٢٣ ٤٥٦٧'}, {...searchProps,value:''});
button(phoneCreate.render(),'إضافة عميل').props.onClick();
eq(phoneCreate.state.draft.name,'','A phone search is not mistaken for a factory name');
eq(phoneCreate.state.draft.phone,'٠٥٥ ١٢٣ ٤٥٦٧','Add after a phone search carries the entered number forward');
const readOnly=harness('app/visit-customer-picker.tsx',{}, {...searchProps,me:{...me,readOnly:true}});
eq(button(readOnly.render(),'إضافة عميل'),undefined,'Read-only users do not receive a create action');
language='en';
const english=harness('app/visit-customer-picker.tsx',{}, {...searchProps,value:'west'});
ok(button(english.render(),'Change'),'Compact selected action is translated');
ok(text(english.render()).includes('Yourrest: YR-C-000123')&&text(english.render()).includes('ERP: W-20'),'Picker clearly labels both permanent and external codes');
const englishSearch=harness('app/visit-customer-picker.tsx',{}, {...searchProps,value:''});
ok(nodes(englishSearch.render(),node=>node.props?.placeholder==='Factory name, customer code or phone').length===1,'Mobile search prompt is translated');
language='ar';
console.log(JSON.stringify({ok:true,checks,type:'real CRM and inline customer creation interaction, region locks, refresh retry, Arabic/English',realBrowser:false}));
