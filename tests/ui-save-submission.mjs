// Exercise the actual master-form submit handler with deferred network responses.
// No browser timing assumptions: two invocations use the same rendered handler.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';

const root=process.cwd(),nativeRequire=createRequire(import.meta.url),cache=new Map();
const compiler={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true};
let checks=0,language='ar';
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const noop=()=>{},pass=({children})=>typeof children==='function'?null:children;
const mock=new Proxy({},{get:()=>pass});
const dictionary=JSON.parse(fs.readFileSync(path.join(root,'lib/locales/en.json'),'utf8'));
const i18n={t:value=>language==='en'&&typeof value==='string'?(dictionary[value]||value):value,useLanguage:()=>({language}),getLanguage:()=>language,direction:()=>language==='ar'?'rtl':'ltr'};
function load(filename,require,globals={}){
 const clientSubmit=()=>load('lib/client-submit.ts',nativeRequire,{AbortController,DOMException,URL,setTimeout,clearTimeout,...globals});
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename==='app/crm-app.tsx'&&process.env.CRM_SAVE_SOURCE?process.env.CRM_SAVE_SOURCE:path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,Error,TypeError,require:name=>name==='@/lib/client-submit'?clientSubmit():name==='@/lib/offline-submit'?{offlineSubmit:(url,body,options)=>clientSubmit().submitJson(url,{method:'POST',headers:{'Content-Type':'application/json'},body},options)}:require(name),console,crypto:globalThis.crypto,structuredClone,Intl,setTimeout,clearTimeout,...globals});return exports;
}
function library(filename){
 if(cache.has(filename))return cache.get(filename);
 const exports={};cache.set(filename,exports);
 const require=name=>name.startsWith('.')?library(path.join(path.dirname(filename),name)+'.ts'):nativeRequire(name);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,require,Intl,console});return exports;
}
function commonRequire(name){
 if(name==='@/lib/offline-store')return {saveOfflineSnapshot:async()=>{},loadOfflineSnapshot:async()=>null,augmentOfflineSnapshot:async value=>value,offlineSessionGeneration:()=>0,offlineOwner:value=>({id:value.id,stamp:value.id})};
 if(name==='@/lib/offline-auth')return {isOfflineLogoutPending:()=>false};
 if(name==='react')return React;
 if(name==='react/jsx-runtime')return jsx;
 if(name==='@/lib/i18n')return i18n;
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
 return [...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate),...nodes(tree.props?.actions,predicate),...nodes(tree.props?.filters,predicate)];
}
function text(tree){if(tree===null||tree===undefined||typeof tree==='boolean')return '';if(typeof tree!=='object')return String(tree);if(Array.isArray(tree))return tree.map(text).join('');return text(tree.props?.children);}
function button(tree,label){return nodes(tree,node=>node.type==='button'&&text(node)===label)[0];}
function stateNames(filename){
 const source=ts.createSourceFile(filename,fs.readFileSync(path.join(root,filename),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),names=[];
 function visit(node){if(ts.isVariableDeclaration(node)&&ts.isArrayBindingPattern(node.name)&&node.initializer&&ts.isCallExpression(node.initializer)&&node.initializer.expression.getText(source)==='useState')names.push(node.name.elements[0].name.getText(source));ts.forEachChild(node,visit);}visit(source);return names;
}
function harness(filename,seed={},props={},globals={}){
 const names=stateNames(filename),state={...seed},refs=[];let cursor=0,refCursor=0,tree;
 const hooks={...React,useState(initial){const name=names[cursor++];if(!Object.hasOwn(state,name))state[name]=typeof initial==='function'?initial():initial;return[state[name],value=>{state[name]=typeof value==='function'?value(state[name]):value;}];},useRef(value){const index=refCursor++;return refs[index]||(refs[index]={current:value});},useEffect:noop,useCallback:callback=>callback,useMemo:compute=>compute(),useDeferredValue:value=>value};
 const component=load(filename,name=>name==='react'?hooks:commonRequire(name),{window:{history:{replaceState:noop}},...globals}).default;
 return {state,render(){cursor=refCursor=0;tree=component(props);return tree;},tree:()=>tree};
}
const me={id:'rep-west',name:'Western rep',email:'rep@yourrest.org',role:'rep',regionScope:'western',branch:'HQ',active:1,target:0};
const customer={id:'existing',kind:'customer',parentId:null,assignedTo:'other',branch:'HQ',data:{name:'Existing factory',region:'الغربية',location:'21.5, 39.2',_masterReadOnly:true},createdAt:'2026-09-30T08:00:00Z',updatedAt:'2026-09-30T08:00:00Z',version:1};
const response=(status,body)=>({ok:status===200,status,json:async()=>body});
const event=()=>({preventDefault:noop,nativeEvent:{submitter:null}});
for(const locale of ['ar','en'])for(const role of ['rep','supervisor','manager','admin']){
 language=locale;
 const actor={...me,role},editable={...customer,data:{...customer.data,_masterReadOnly:false}},requests=[],pending=[];
 const opened={kind:'customer',row:editable,data:{...editable.data,phone:'0550000000'},parentId:''};
 const h=harness('app/crm-app.tsx',{view:'customer',records:[editable],members:[actor],me:actor,loading:false,form:opened},{},{navigator:{onLine:true},fetch:async(url,config)=>{
  if(config.method==='POST'){requests.push(JSON.parse(config.body));return new Promise(resolve=>pending.push(resolve));}
  return response(200,{me:actor,members:[actor],records:[editable],audits:[]});
 }});
 let tree=h.render(),form=nodes(tree,node=>node.type==='form')[0];
 const originalLabel=text(nodes(form,node=>node.type==='button'&&node.props.type==='submit')[0]);
 const submit=form.props.onSubmit,first=submit(event()),second=submit(event());
 const activeCount=requests.length;
 const originalDraft=h.state.form;
 button(form,locale==='en'?dictionary['إلغاء']:'إلغاء').props.onClick();
 const retainedWhileSaving=h.state.form===originalDraft;
 nodes(form,node=>node.type==='input'&&node.props.value==='0550000000')[0].props.onChange({target:{value:'0559999999'}});
 tree=h.render();form=nodes(tree,node=>node.type==='form')[0];
 const saveButton=nodes(form,node=>node.type==='button'&&node.props.type==='submit')[0];
 // Settle the request before asserting so a failing regression cannot leave timers alive.
 for(const resolve of pending.splice(0))resolve(response(400,{error:'Server validation message'}));
 await Promise.all([first,second]);
 eq(activeCount,1,role+' '+locale+': repeated submit starts only one request before re-render');
 eq(retainedWhileSaving,true,'Pending form cannot be dismissed through a stale callback');
 eq(h.state.form.data.phone,'0550000000','Stale edit callback cannot change the pending draft');
 eq(saveButton.props.disabled,true,'Pending save button disabled');
 eq(saveButton.props['aria-busy'],true,'Saving is exposed to assistive technology');
 eq(text(saveButton),originalLabel,'Original save label retained during loading');
 eq(nodes(form,node=>node.type==='fieldset'&&node.props.disabled).length,1,'Pending form fields are disabled');
 eq(h.state.busy,false,'Validation failure releases loading state');
 eq(h.state.formError,'Server validation message','Server validation is visible unchanged');
 eq(h.state.form.data.phone,'0550000000','Failed save preserves customer edits');
 const retry=nodes(h.render(),node=>node.type==='form')[0].props.onSubmit(event());
 eq(requests.length,2,'Lock releases for an explicit retry');
 eq(JSON.stringify(requests[1]),JSON.stringify(requests[0]),'Retry retains version, assignment and submitted values');
 pending.shift()(response(200,{ok:true,id:editable.id}));await retry;
 eq(h.state.form,null,'Successful confirmation closes form');
 eq(h.state.busy,false,'Success releases loading state');
}
// A blocked form does not acquire a permanent lock or send any request.
let calls=0;const blocked=harness('app/crm-app.tsx',{view:'customer',records:[customer],members:[me],me,loading:false,customerLocationPending:true,form:{kind:'customer',row:customer,data:customer.data,parentId:''}},{},{fetch:async()=>{calls++;return response(400,{error:'Expected test rejection'});}});
await nodes(blocked.render(),node=>node.type==='form')[0].props.onSubmit(event());eq(calls,0,'Pending location blocks writes');
blocked.state.customerLocationPending=false;await nodes(blocked.render(),node=>node.type==='form')[0].props.onSubmit(event());eq(calls,1,'Location completion leaves save available');
console.log(JSON.stringify({ok:true,checks,coverage:'same-render duplicate master saves, pending draft protection, unchanged labels and payloads, validation failure and retry in AR/EN for all four roles',realBrowser:false}));
