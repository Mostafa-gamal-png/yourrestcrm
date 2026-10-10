// Actual lightweight gauge and its consumers; supplied API scores remain authoritative.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const nativeRequire=createRequire(import.meta.url),cache=new Map();
const compiler={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true};
let checks=0,language='ar';
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const source=file=>process.env.YR_GAUGE_SOURCE_REV&&file==='app/target-gauge.tsx'?execFileSync('git',['show',process.env.YR_GAUGE_SOURCE_REV+':'+file],{encoding:'utf8'}):fs.readFileSync(file,'utf8');
function load(file,require){const exports={};vm.runInNewContext(ts.transpileModule(source(file),{compilerOptions:compiler}).outputText,{exports,require,Intl,console,structuredClone});return exports;}
function library(file){if(cache.has(file))return cache.get(file);const result=load(file,name=>name.startsWith('.')?library(path.join(path.dirname(file),name)+'.ts'):nativeRequire(name));cache.set(file,result);return result;}
const targets=library('lib/targets.ts'),dictionary=JSON.parse(fs.readFileSync('lib/locales/en.json','utf8'));
function imports(name){
 if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;
 if(name==='./target-gauge')return {__esModule:true,default:Gauge};
 if(name==='@/lib/i18n')return {useLanguage:()=>({language}),t:value=>language==='en'?(dictionary[value]||value):value};
 if(name==='lucide-react')return new Proxy({},{get:()=>()=>null});
 if(name.startsWith('@/lib/'))return library(name.replace('@/','')+'.ts');
 if(name.endsWith('.css'))return {};
 throw Error('Unexpected gauge dependency '+name);
}
const Gauge=load('app/target-gauge.tsx',imports).default;
const render=(value,extra={})=>renderToStaticMarkup(React.createElement(Gauge,{value,label:'Achievement',emptyLabel:'No target set',...extra}));
let html=render(75);
ok(/<circle[^>]*class="target-gauge-track"/.test(html),'Approved gauge is a complete circle, not the former half arc');
ok(html.includes('viewBox="0 0 216 216"'),'Circle has a square viewport on desktop and mobile');
for(const [value,expected] of [[0,'0%'],[75.123456,'75.123456%'],[100,'100%'],[125.5,'125.5%'],[-22.5,'-22.5%'],[1000000.25,'1,000,000.25%']]){
 html=render(value);ok(html.includes('Achievement: '+expected),'Accessible result preserves the actual supplied percentage '+value);ok(html.includes('>'+expected+'</text>'),'Visible result preserves the actual supplied percentage '+value);
 if(value>0)ok(html.includes('stroke-dasharray="'+Math.min(100,value)+' 100"'),'Painted circle is bounded without changing the score '+value);
 else eq(html.includes('class="target-gauge-fill"'),false,'Zero and negative net returns paint no false positive progress');
 eq(/NaN|Infinity/.test(html),false,'Finite result never produces invalid SVG values');
}
for(const value of [null,undefined,NaN,Infinity,-Infinity]){
 html=render(value);ok(html.includes('No target set'),'Unknown percentage retains the caller’s specific empty explanation');eq(html.includes('class="target-gauge-fill"'),false,'Unknown percentage paints no completed attainment');eq(html.includes('0%'),false,'Missing percentage is never invented as zero');eq(/NaN|Infinity/.test(html),false,'Non-finite values never leak into displayed or SVG values');
}
html=render(null,{emptyLabel:'Target is zero'});ok(html.includes('Achievement: Target is zero'),'An assigned zero target stays distinct from a missing target');
html=render(null,{emptyLabel:'Not applicable'});ok(html.includes('Achievement: Not applicable'),'Weighted N/A remains excluded, not missing');
const {MyTargetDetails}=load('app/my-targets.tsx',imports);
const rep={month:'2026-10',member:{id:'rep',name:'Rep'},sales:{sourceMonth:'2026-08',actualsAvailable:true,products:targets.targetProducts.map((p,index)=>({product:p.id,quantity:index===0?8:index===1?0:null,actualQuantity:index===0?10:index===1?0:null,remainingQuantity:index===0?0:index===1?0:null,achievement:index===0?125:null}))},activity:{newCustomers:10,recoveredCustomers:5,visits:320,sourceMonth:'2026-08',isDefault:false}};
const before=JSON.stringify(rep);
for(const lang of ['ar','en']){
 language=lang;html=renderToStaticMarkup(React.createElement(MyTargetDetails,{data:rep}));
 eq((html.match(/class="my-target-product"/g)||[]).length,targets.targetProducts.length,'Every API product gets its own compact card in '+lang);
 ok(html.includes('125%'),'Rep sees true above-target result in '+lang);ok(html.includes('stroke-dasharray="100 100"'),'Above-target result paints a full circle in '+lang);
 ok(html.includes(lang==='ar'?'لم يُحدد مستهدف':'No target set'),'Missing assignment has a visible explanation in '+lang);ok(html.includes(lang==='ar'?'المستهدف صفر':'Target is zero'),'Explicit zero assignment is distinguishable in '+lang);
 ok(html.includes(lang==='ar'?'صافي المباع':'Net sold'),'Actual quantity is labelled beneath the ring in '+lang);ok(html.includes(lang==='ar'?'المستهدف المطلوب':'Required target'),'Target quantity is labelled beneath the ring in '+lang);ok(html.includes('<small>'+(lang==='ar'?'قالب':'Mold')+'</small>'),'Quantity unit appears beneath the ring in '+lang);
 eq(/<button|<input|<select/.test(html),false,'Read-only rep cards do not grant management actions');
}
eq(JSON.stringify(rep),before,'Presenting gauges never mutates the target or activity payload');
const future=structuredClone(rep);future.sales.actualsAvailable=false;future.sales.products.forEach(row=>{row.actualQuantity=null;row.achievement=null;row.remainingQuantity=null;});html=renderToStaticMarkup(React.createElement(MyTargetDetails,{data:future}));eq(html.includes('class="target-gauge-fill"'),false,'Future planning never fabricates achieved quantities');ok(html.includes('The month has not started'),'Future gauge explains the lack of actuals');
console.log(JSON.stringify({ok:true,checks,coverage:'actual SVG and rep product cards; finite/empty/zero/negative/over-100; authorized API values preserved; Arabic/English; no browser claim'}));
