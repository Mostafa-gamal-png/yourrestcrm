// Actual target workspace/editor with controlled React hooks and network.
// Verifies effective-period presentation and the submitted edit boundary, not browser layout.
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
function load(file,require,globals={},extra=''){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:compiler}).outputText+extra,{exports,require,Error,TypeError,Intl,console,crypto:globalThis.crypto,AbortController,DOMException,URL,setTimeout,clearTimeout,...globals});return exports;}
function library(file){if(cache.has(file))return cache.get(file);const value=load(file,name=>name.startsWith('.')?library(path.join(path.dirname(file),name)+'.ts'):nativeRequire(name));cache.set(file,value);return value;}
const targets=library('lib/targets.ts'),dictionary=JSON.parse(fs.readFileSync('lib/locales/en.json','utf8'));
const noop=()=>{},pass=({children})=>children,icons=new Proxy({},{get:()=>()=>null});
const i18n={getLanguage:()=>language,useLanguage:()=>({language}),direction:()=>language==='ar'?'rtl':'ltr',t:value=>language==='en'?(dictionary[value]||value):value};
function imports(name,hooks=React,submit={}){if(name==='react')return hooks;if(name==='react/jsx-runtime')return jsx;if(name==='@/lib/i18n')return i18n;if(name==='lucide-react')return icons;if(name==='@/lib/client-submit')return load('lib/client-submit.ts',nativeRequire,submit);if(name.startsWith('@/lib/'))return library(name.replace('@/','')+'.ts');if(name.startsWith('@/components/'))return new Proxy({},{get:()=>pass});if(name==='sonner')return {toast:{success:noop}};throw Error('Unexpected UI dependency '+name);}
const {default:Workspace}=load('app/targets-workspace.tsx',imports);
const me={id:'manager',name:'Manager',role:'manager',active:1,branch:'Main',regionScope:'all'};
const rep={id:'rep',name:'QA representative',role:'rep',active:1,branch:'Main'},inactive={id:'inactive',name:'QA inactive',role:'rep',active:0,branch:'Main'};
const products=value=>targets.targetProducts.map((p,index)=>({product:p.id,quantity:typeof value==='function'?value(index):value}));
const set=(scopeId,month,quantity,version=1)=>({kind:'sales',scopeId,month,version,updatedAt:'',data:{products:products(quantity)}});
const state={month:'2026-10',branches:['Main'],sets:[set('rep','2026-09',index=>index===0?0:index===1?null:12,2),set('rep','2026-11',40)]};
const base={state,members:[rep],me,staff:'all',query:'',branch:'Main',onBranchChange:noop,onSaved:noop};
for(const selected of ['ar','en']){
 language=selected;let html=renderToStaticMarkup(React.createElement(Workspace,base));
 ok(html.includes(selected==='ar'?'ساري من شهر<!-- --> 2026-09':'Effective from<!-- --> 2026-09')||html.includes(selected==='ar'?'ساري من شهر 2026-09':'Effective from 2026-09'),'Table exposes effective target source '+selected);
 eq(html.includes(selected==='ar'?'تخص الشهر المحدد فقط':'apply only to the selected month'),false,'No monthly re-entry claim '+selected);
 ok(html.includes('>0<'),'Inherited zero remains zero');ok(html.includes(selected==='ar'?'غير محدد':dictionary['غير محدد']),'Inherited missing remains unset');
 html=renderToStaticMarkup(React.createElement(Workspace,{...base,state:{...state,month:'2026-12'}}));
 ok(html.includes(selected==='ar'?'ساري من شهر 2026-11':'Effective from 2026-11'),'Later override source displayed '+selected);ok(html.includes('>40<'),'Later target overrides inherited amount');
}
language='ar';
// Old inactive targets do not consume current branch allocation forever.
const branchState={month:'2026-10',branches:['Main'],sets:[set('branch:Main','2026-09',100),set('rep','2026-09',10),set('inactive','2026-09',90)]};
let html=renderToStaticMarkup(React.createElement(Workspace,{...base,state:branchState,members:[rep,inactive]}));
ok(html.includes('90 غير موزع'),'Inactive inherited-only target is excluded from current distribution');
const retained={...branchState,sets:[...branchState.sets,{...set('supervisor','2026-10',100),computed:true,teamMemberIds:['rep','inactive']}]};
html=renderToStaticMarkup(React.createElement(Workspace,{...base,state:retained,members:[rep,inactive]}));
ok(html.includes('موزع بالكامل'),'Current team evidence can retain an inactive member in allocation');
const currentInactive={...branchState,sets:branchState.sets.map(s=>s.scopeId==='inactive'?{...s,month:'2026-10'}:s)};
html=renderToStaticMarkup(React.createElement(Workspace,{...base,state:currentInactive,members:[rep,inactive]}));
ok(html.includes('موزع بالكامل'),'An explicit current-month inactive assignment remains counted');

function descendants(tree,predicate){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(node=>descendants(node,predicate));return [...(predicate(tree)?[tree]:[]),...descendants(tree.props?.children,predicate)];}
function editorHarness(selectedState=state){let cursor=0,tree,saves=0;const hooks=[],requests=[];
 const hooksReact={...React,useState(initial){const index=cursor++;if(!hooks[index])hooks[index]={value:typeof initial==='function'?initial():initial};return[hooks[index].value,value=>{hooks[index].value=typeof value==='function'?value(hooks[index].value):value;}];},useRef(initial){const index=cursor++;return hooks[index]||(hooks[index]={current:initial});}};
 const fetch=async(url,init)=>{requests.push({url,init,body:JSON.parse(init.body)});return{ok:true,status:200,json:async()=>({ok:true})};};
 const {Editor}=load('app/targets-workspace.tsx',name=>imports(name,hooksReact,{fetch}),{},'\nexports.Editor = TargetSetEditor;');
 const render=()=>{cursor=0;tree=Editor({state:selectedState,kind:'sales',scopeId:'rep',name:rep.name,onClose:noop,onSaved:()=>saves++});return renderToStaticMarkup(tree);};
 return{render,requests,tree:()=>tree,saves:()=>saves};
}
for(const selected of ['ar','en']){
 language=selected;const editor=editorHarness();html=editor.render();
 ok(html.includes(selected==='ar'?'يسري التعديل من هذا الشهر حتى تغييره':'Applies from this month until changed'),'Editor states effective start '+selected);
 ok(html.includes(selected==='ar'?'الشهور السابقة محفوظة':'Previous months stay unchanged'),'Editor explains historical preservation '+selected);
 ok(html.includes(selected==='ar'?'القيم الحالية سارية من شهر':'Current values are effective from'),'Editor labels inherited values '+selected);
 ok(html.includes('2026-09')&&html.includes('2026-10'),'Editor separates inherited month from new effective month');
 const inputs=descendants(editor.tree(),node=>node.type==='input');eq(inputs[0].props.value,'0','Inherited zero prefilled');eq(inputs[1].props.value,'','Inherited missing remains blank');eq(inputs[2].props.value,'12','Previous effective target prefilled');
 inputs[2].props.onChange({target:{value:'15'}});editor.render();await descendants(editor.tree(),node=>node.type==='form')[0].props.onSubmit({preventDefault:noop});
 eq(editor.requests.length,1,'Editor sends one write');const body=editor.requests[0].body;eq(body.month,'2026-10','Selected month is the effective start');eq(body.version,0,'Inherited entry creates a new period');eq(body.inheritedFrom,{month:'2026-09',version:2},'Submitted source proves which previous target was edited');eq(body.data.products[2].quantity,15,'Changed target saved');eq(body.data.products[0].quantity,0,'Zero preserved in saved payload');eq(body.data.products[1].quantity,null,'Unset preserved in saved payload');eq(editor.saves(),1,'Save callback after acknowledgement');
}
console.log(JSON.stringify({ok:true,checks,type:'persistent target workspace/editor SSR, inherited source display, edit boundary, zero/missing values, inactive allocation',realBrowser:false}));
