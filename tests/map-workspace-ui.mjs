// Exercise the real CRM map composition and controls without granting any extra data scope.
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
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const noop=()=>{},pass=({children})=>typeof children==='function'?null:children;
const mock=new Proxy({},{get:()=>pass});
const dictionary=JSON.parse(fs.readFileSync(path.join(root,'lib/locales/en.json'),'utf8'));
const i18n={t:value=>language==='en'&&typeof value==='string'?(dictionary[value]||value):value,useLanguage:()=>({language}),getLanguage:()=>language,direction:()=>language==='ar'?'rtl':'ltr'};
function load(filename,require,globals={}){
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,require,console,crypto:globalThis.crypto,structuredClone,Intl,setTimeout,clearTimeout,...globals});return exports;
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
 if(name==='@/lib/i18n')return i18n;
 if(name.startsWith('@/lib/'))return library(name.replace('@/','')+'.ts');
 if(name==='@base-ui/react')return {Combobox:mock};
 if(name==='./support-panel')return new Proxy({useSupport:()=>({data:null,refresh:async()=>{},byCustomer:{},canRequest:()=>false,badge:0})},{get:(target,key)=>target[key]||pass});
 if(name==='./complaints-panel')return new Proxy({useComplaints:()=>({data:null,refresh:async()=>{},forCustomer:()=>[],badge:0})},{get:(target,key)=>target[key]||pass});
 if(name==='@/components/ui/sidebar')return new Proxy({useSidebar:()=>({setOpenMobile:noop})},{get:(target,key)=>target[key]||pass});
 if(name==='./region-picker')return load('app/region-picker.tsx',commonRequire);
 if(name==='sonner')return {Toaster:pass,toast:{success:noop,error:noop}};
 return mock;
}
function nodes(tree,predicate,slots=true){
 if(!tree||typeof tree!=='object')return [];
 if(Array.isArray(tree))return tree.flatMap(node=>nodes(node,predicate,slots));
 return [...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate,slots),...(slots?[...nodes(tree.props?.actions,predicate),...nodes(tree.props?.filters,predicate)]:[])];
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
const me={id:'rep-west',name:'Western rep',email:'rep@yourrest.org',role:'rep',regionScope:'western',branch:'HQ',active:1,authVersion:4,target:0};
const factory=(id,name,region,assignee)=>({id,kind:'customer',parentId:null,assignedTo:assignee,branch:'HQ',data:{name,region,customerStatus:'نشط',location:'21.5, 39.2',_masterReadOnly:true},createdAt:'2026-09-30T08:00:00Z',updatedAt:'2026-09-30T08:00:00Z',version:1});
const customers=[factory('one','Western Alpha','الغربية','other'),factory('two','Western Beta','الغربية',me.id)];
const mapOf=tree=>nodes(tree,node=>!!node.props?.scopeKey&&Array.isArray(node.props?.customers),false)[0];
const outer=tree=>nodes(tree,node=>node.props?.className?.split(' ').includes('filterbar'),false);
const pick=(tree,label)=>nodes(tree,node=>node.props?.label===label)[0];
for(const compactNavigation of [true,false]){
 const h=harness('app/crm-app.tsx',{view:'map',me,members:[me],records:customers,loading:false,staffFilter:'stale-staff',q:'unrelated old visit search',mapFocusId:'two',compactNavigation});
 let tree=h.render(),map=mapOf(tree);
 eq(map.props.customers.map(row=>row.id),['one','two'],'Rep map retains all authorized regional customers despite stale staff filter');
 eq(outer(tree).length,0,'Search and filters are embedded only in map panel');
 eq(nodes(tree,node=>node.props?.className==='page-heading',false).length,0,'Map has no duplicate heading');
 eq(nodes(tree,node=>node.props?.className==='page-footer',false).length,0,'Map has no scrolling page footer');
 ok(nodes(tree,node=>node.props?.className==='app-shell app-shell--map',false).length===1,'Map root has viewport layout class');
 ok(nodes(tree,node=>node.type==='main'&&node.props.className?.split(' ').includes('map-workspace'),false).length===1,'Map main owns viewport remainder');
 ok(nodes(tree,node=>node.props?.className==='page map-page',false).length===1,'Map page flex container exists');
 ok(map.props.filters,'Panel receives only authorized scope filters');
 eq(map.props.filters.props.className,'cm-scope-filters','Dedicated map filter slot avoids generic CRM search');
 eq(map.props.actions,undefined,'Map has no creation or export action slot');
 eq(map.props.onOpen,undefined,'Map cannot open a record editor through a root callback');
 eq(map.props.onVisit,undefined,'Map does not expose the old visit form action');
 eq(map.props.me,me,'Journey wrapper receives the current signed-in actor');
 eq(map.props.focusId,'two','Requested customer focus passes to journey map');
 eq(pick(map.props.filters,'المندوب'),undefined,'Rep map has no staff selector');
 ok(pick(map.props.filters,'المنطقة'),'Region selector retained');
 eq(nodes(map.props.filters,node=>node.type==='input').length,0,'Scope filter slot has no duplicate map search input');
 ok(nodes(map.props.filters,node=>node.type==='button'&&node.props.title==='تحديث البيانات').length===1,'Refresh available inside map panel');
 eq(map.props.scopeKey,'rep-west:rep:HQ:western::4','Scope key binds selected customer state to current permissions');
 eq(map.key,map.props.scopeKey,'Permission change remounts the map to remove stale selections');
 for(const label of ['تصدير','إضافة عميل','زيارة جديدة'])eq(button(tree,label),undefined,'Simplified map removes '+label);
 eq(h.state.form,null,'Map does not open a customer creation form');
 eq(h.state.visitEditor,null,'Map does not open a visit form');
 h.state.q='Alpha';map=mapOf(h.render());
 eq(map.props.customers.map(row=>row.id),['one','two'],'Previous root search does not remove customers from map-local search');
 h.state.q='no matching customer';map=mapOf(h.render());
 eq(map.props.customers.map(row=>row.id),['one','two'],'Even an unmatched root query cannot blank the map');
 h.state.me={...me,authVersion:5};eq(mapOf(h.render()).props.scopeKey,'rep-west:rep:HQ:western::5','Auth revision changes map context identity');
 h.state.view='customer';h.state.q='';tree=h.render();eq(mapOf(tree),undefined,'Leaving map unmounts the workspace');
 eq(nodes(tree,node=>node.props?.className==='app-shell',false).length,1,'Normal page root restored without viewport lock');
 eq(nodes(tree,node=>node.type==='main'&&node.props.className?.split(' ').includes('workspace')&&!node.props.className?.split(' ').includes('map-workspace'),false).length,1,'Normal page scroll container restored');
 eq(outer(tree).length,1,'Customer directory keeps its normal filters');
 eq(nodes(tree,node=>node.props?.className==='page-heading',false).length,1,'Normal heading remains');
 eq(nodes(tree,node=>node.props?.className==='page-footer',false).length,1,'Normal footer remains');
 const directory=nodes(tree,node=>typeof node.props?.onMap==='function',false)[0];directory.props.onMap('one');
 map=mapOf(h.render());eq(map.props.focusId,'one','Directory map action focuses the selected customer');
 eq(map.props.customers.map(row=>row.id),['one','two'],'Directory map navigation preserves the authorized regional set');
}
for(const role of ['manager','supervisor','admin']){
 const actor={...me,id:role,role,regionScope:'all'};
 const h=harness('app/crm-app.tsx',{view:'map',me:actor,members:[actor,me],records:[...customers,factory('east','Eastern client','الشرقية','other')],loading:false});
 let map=mapOf(h.render());ok(pick(map.props.filters,'المندوب'),role+' team filter retained inside panel');
 pick(map.props.filters,'المنطقة').props.onChange('الشرقية');map=mapOf(h.render());eq(map.props.customers.map(row=>row.id),['east'],role+' region filter changes markers without navigating away');
 pick(map.props.filters,'المنطقة').props.onChange('all');map=mapOf(h.render());pick(map.props.filters,'المندوب').props.onChange(me.id);
 eq(mapOf(h.render()).props.customers.map(row=>row.id),['two'],role+' staff filter restricts rendered map customers');
}
for(const seed of [{loading:true},{error:'تعذر تحميل البيانات',loading:false},{auth:true,error:'يرجى تسجيل الدخول',loading:false}]){
 const h=harness('app/crm-app.tsx',{view:'map',me,members:[me],records:customers,...seed});const tree=h.render();
 eq(mapOf(tree),undefined,'Loading/auth/error does not render stale map data');
 if(seed.error)ok(text(tree).includes(seed.error),'Map error is visible in viewport');
 if(seed.auth)ok(nodes(tree,node=>node.type==='a'&&node.props.href==='/login').length===1,'Map auth expiry retains sign-in action');
}
const denied=harness('app/crm-app.tsx',{view:'map',me:{...me,role:'customer_service'},members:[me],records:customers,loading:false});
eq(mapOf(denied.render()),undefined,'Unauthorized role cannot render map even if view state is stale');
const css=fs.readFileSync(path.join(root,'app/map-workspace.css'),'utf8');
ok(css.includes('height:100dvh')&&css.includes('min-height:0!important'),'Map shell uses dynamic viewport height');
ok(css.includes('padding-bottom:calc(80px + env(safe-area-inset-bottom))'),'Mobile map reserves bottom navigation and safe area');
ok(css.includes('env(safe-area-inset-top)')&&css.includes('env(safe-area-inset-left)')&&css.includes('env(safe-area-inset-right)'),'Map top and sides reserve notched installed-phone safe areas');
ok(css.includes('.map-page>.workspace-notices')&&css.includes('overflow-y:auto'),'Tracking and install notices can scroll without shifting the map');
ok(!css.includes('body{')&&!css.includes('body.')&&!css.includes('body:'),'Map stylesheet does not lock global body scrolling');
ok(css.includes('.map-page .filterbar')&&css.includes('min-height:44px'),'Panel filters retain touch target sizing');
console.log(JSON.stringify({ok:true,checks,type:'controlled CRM map slots, authorized scope filters, simplified actions, stale-query isolation and scope identity and viewport CSS contract',realBrowser:false}));
