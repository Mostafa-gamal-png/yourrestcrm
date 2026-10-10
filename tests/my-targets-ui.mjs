// Actual personal target UI with controlled network and React hooks; no browser/device claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const root=process.cwd(),nativeRequire=createRequire(import.meta.url),cache=new Map(),compiler={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true};
let checks=0,language='ar';const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
function load(filename,require,globals={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,Error,TypeError,require:name=>name==='@/lib/client-submit'?load('lib/client-submit.ts',nativeRequire,{AbortController,DOMException,URL,setTimeout,clearTimeout,...globals}):require(name),Intl,console,...globals});return exports;}
function library(filename){if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);const require=name=>name.startsWith('.')?library(path.join(path.dirname(filename),name)+'.ts'):nativeRequire(name);vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,require,Intl,console});return exports;}
const targets=library('lib/targets.ts'),dictionary=JSON.parse(fs.readFileSync(path.join(root,'lib/locales/en.json'),'utf8'));
const icons=new Proxy({},{get:()=>()=>null});
const i18n={t:value=>language==='en'?(dictionary[value]||value):value,useLanguage:()=>({language})};
function commonRequire(name){if(name==='./target-gauge')return load('app/target-gauge.tsx',commonRequire);if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;if(name==='lucide-react')return icons;if(name==='@/lib/targets')return targets;if(name==='@/lib/i18n')return i18n;if(name.endsWith('.css'))return {};throw Error('Unexpected UI dependency '+name);}
const {MyTargetDetails}=load('app/my-targets.tsx',commonRequire);
const data=(id='rep',month='2026-10')=>({month,member:{id,name:id},sales:{sourceMonth:month,actualsAvailable:true,products:targets.targetProducts.map((product,index)=>({product:product.id,quantity:index===0?0:index===1?12.345678:null,actualQuantity:index===1?7:index===2?-2:0,remainingQuantity:index===1?5.345678:index===0?0:null,achievement:index===1?56.7:index===0?null:null}))},activity:{newCustomers:10,recoveredCustomers:5,visits:320,sourceMonth:'2026-09',isDefault:false}});
let html=renderToStaticMarkup(React.createElement(MyTargetDetails,{data:data()}));
ok(html.includes('>0 <small>'),'An assigned zero is shown as zero');ok(html.includes('12.345678'),'All six supported decimal places retained');eq((html.match(/>غير محدد <small>/g)||[]).length,6,'Missing quantities stay undefined, not zero');ok(html.includes('ساري من شهر'),'Inherited activity target is labelled');ok(html.includes('2026-09'),'Inherited source month is shown');ok(html.includes('قالب'),'Quantity units included');
for(const prohibited of ['<input','<select','<button','تعديل','أوزان'])eq(html.includes(prohibited),false,'Read-only target details exclude '+prohibited);
const missing=data();missing.sales.products.forEach(product=>product.quantity=null);missing.sales.sourceMonth=null;missing.activity.isDefault=true;missing.activity.sourceMonth=null;
html=renderToStaticMarkup(React.createElement(MyTargetDetails,{data:missing}));ok(html.includes('لم يُحدد مستهدف كميات الأصناف'),'Missing effective assignment explained');ok(html.includes('المستهدفات الافتراضية'),'System activity defaults clearly labelled');ok(html.includes('>320</dd>'),'System activity target value shown');
ok(html.includes('الصفر يعني عدم وجود مبيعات مسجلة للصنف'),'Zero actual sales remain clearly distinguished from missing targets');ok(html.includes('بعد المرتجعات'),'Returns are identified as net quantities');
const future=data();future.sales.actualsAvailable=false;future.sales.products.forEach(product=>{product.actualQuantity=null;product.remainingQuantity=null;product.achievement=null;});
html=renderToStaticMarkup(React.createElement(MyTargetDetails,{data:future}));ok(html.includes('الشهر المحدد لم يبدأ بعد'),'Future month explicitly hides actuals');eq(html.includes('%</span>'),false,'Future percentage never displayed');
html=renderToStaticMarkup(React.createElement(MyTargetDetails,{data:data()}));ok(html.includes('56.7%'),'Own product achievement shown');ok(html.includes('>7 <small>'),'Net actual quantity shown');ok(html.includes('>-2 <small>'),'Negative net sales remain visible');ok(html.includes('5.345678'),'Remaining quantity retains precision');ok(html.includes('<dt>صافي المباع</dt>'),'Mobile product cards carry visible semantic labels');
language='en';html=renderToStaticMarkup(React.createElement(MyTargetDetails,{data:data()}));for(const label of ['My targets and achievement','Required target','Net sold','Remaining','Achievement','Customer and visit targets','Effective from','Mold',dictionary['غير محدد']])ok(html.includes(label),'English detail '+label);language='ar';
// Ongoing quantity targets expose their effective source, independently of the report month.
for(const selected of ['ar','en']){
 language=selected;const inherited=data();inherited.sales.sourceMonth='2026-08';
 let carried=renderToStaticMarkup(React.createElement(MyTargetDetails,{data:inherited}));
 ok(carried.includes(selected==='ar'?'ساري من شهر 2026-08':'Effective from 2026-08'),'Quantity target effective month in '+selected);
 ok(carried.includes('2026-10'),'Report month remains visible separately');
 const zero=data();zero.sales.sourceMonth='2026-08';zero.sales.products.forEach(row=>{row.quantity=0;row.remainingQuantity=0;row.achievement=null;});
 carried=renderToStaticMarkup(React.createElement(MyTargetDetails,{data:zero}));
 eq(carried.includes(selected==='ar'?'لم يُحدد مستهدف':'No product quantity targets'),false,'An effective all-zero target is assigned, not missing');
 eq((carried.match(/%<\/span>/g)||[]).length,0,'Zero targets never show a misleading percentage');
 const planned=data('rep','2099-11');planned.sales.sourceMonth='2026-08';planned.sales.actualsAvailable=false;planned.sales.products.forEach(row=>{row.actualQuantity=null;row.remainingQuantity=null;row.achievement=null;});
 carried=renderToStaticMarkup(React.createElement(MyTargetDetails,{data:planned}));
 ok(carried.includes(selected==='ar'?'ساري من شهر 2026-08':'Effective from 2026-08'),'Future report retains an older effective target source');
 ok(carried.includes(selected==='ar'?'الشهر المحدد لم يبدأ بعد':'The selected month has not started'),'Future actuals remain hidden with persistent targets');
}
language='ar';
function harness(){let props={me:{id:'rep',name:'Representative',role:'rep',regionScope:'western',branch:'HQ',authVersion:1},month:'2026-10',onMonthChange:value=>{props={...props,month:value};}},cursor=0,tree;const hooks=[],effects=[],requests=[];
 const hooksReact={...React,useState(initial){const index=cursor++;if(!hooks[index])hooks[index]={value:typeof initial==='function'?initial():initial};return [hooks[index].value,value=>{hooks[index].value=typeof value==='function'?value(hooks[index].value):value;}];},useEffect(effect,deps){const index=cursor++,prior=hooks[index];if(!prior||deps.some((value,i)=>!Object.is(value,prior.deps[i]))){hooks[index]={deps,cleanup:prior?.cleanup};effects.push(()=>{hooks[index].cleanup?.();hooks[index].cleanup=effect();});}}};
 const fetch=(url,config)=>new Promise((resolve,reject)=>requests.push({url,config,resolve:body=>resolve({ok:true,json:async()=>body}),reject,status:(status,body)=>resolve({ok:false,status,json:async()=>body})}));
 const {default:MyTargets}=load('app/my-targets.tsx',name=>name==='react'?hooksReact:commonRequire(name),{fetch,AbortController});
 const render=()=>{cursor=0;tree=MyTargets(props);return renderToStaticMarkup(tree);};const commit=()=>{for(const effect of effects.splice(0))effect();};
 async function settle(){for(let i=0;i<40;i++)await Promise.resolve();return render();}
 return {render,commit,settle,requests,tree:()=>tree,change:change=>{props={...props,...change};},unmount:()=>{for(const hook of hooks)hook?.cleanup?.();}};
}
function descendants(tree,predicate){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(node=>descendants(node,predicate));return [...(predicate(tree)?[tree]:[]),...descendants(tree.props?.children,predicate)];}
const h=harness();html=h.render();ok(html.includes('role="status"'),'Initial loading announced');h.commit();eq(h.requests.length,1);eq(h.requests[0].url,'/api/targets?month=2026-10','Personal endpoint accepts only month');eq(h.requests[0].config.cache,'no-store','Targets never requested from HTTP cache');eq(h.requests[0].config.method,undefined,'UI is read only');h.requests[0].resolve(data());html=await h.settle();ok(html.includes('12.345678'),'Resolved personal targets rendered');ok(html.includes('للعرض فقط'),'Read-only label visible');eq((html.match(/<input/g)||[]).length,1,'Only month input exists');eq(html.includes('<select'),false,'No employee or branch selectors');eq(html.includes('تصدير'),false,'No export');
h.change({month:'2026-11'});html=h.render();eq(html.includes('12.345678'),false,'Month change hides prior data before effects run');h.commit();eq(h.requests.length,2);
h.change({me:{id:'other',name:'Other',role:'rep',regionScope:'western',branch:'HQ',authVersion:2}});html=h.render();eq(html.includes('12.345678'),false,'Identity change clears old target values synchronously');h.commit();eq(h.requests[1].config.signal.aborted,true,'In-flight old identity request aborted');h.requests[1].resolve(data('rep','2026-11'));html=await h.settle();eq(html.includes('12.345678'),false,'Late response from previous identity ignored');h.requests[2].resolve(data('other','2026-11'));html=await h.settle();ok(html.includes('12.345678'),'New identity response rendered');
h.change({month:'2026-12'});h.render();h.commit();h.requests[3].resolve(data('wrong','2026-12'));html=await h.settle();ok(html.includes('role="alert"'),'Mismatched response identity rejected');eq(html.includes('12.345678'),false,'Mismatched payload never displayed');const retry=descendants(h.tree(),node=>node.type==='button'&&node.props.children==='إعادة المحاولة')[0];ok(!!retry,'Retry available after a failed load');retry.props.onClick();h.render();h.commit();eq(h.requests.length,5,'Retry performs a fresh request');h.requests[4].status(403,{error:'غير مسموح'});html=await h.settle();ok(html.includes('غير مسموح'),'Server denial displayed');eq(html.includes('12.345678'),false,'Server denial does not retain prior values');
h.change({me:{id:'other',name:'Other',role:'customer_service',authVersion:3}});html=h.render();eq(html,'','Non-representative identity clears personal workspace');h.commit();eq(h.requests.length,5,'Role revocation starts no additional request');h.unmount();
console.log(JSON.stringify({ok:true,checks,type:'actual personal targets UI SSR and controlled fetch/identity lifecycle',realBrowser:false}));
