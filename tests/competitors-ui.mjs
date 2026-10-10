// Execute the actual workspace with controlled hooks; browser checks are separate.
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
let language='ar',checks=0;
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
function library(filename){
 if(cache.has(filename))return cache.get(filename);
 const exports={};cache.set(filename,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,Intl,console,require:name=>name.startsWith('.')?library(path.join(path.dirname(filename),name)+'.ts'):nativeRequire(name)});
 return exports;
}
const dictionary=JSON.parse(fs.readFileSync(path.join(root,'lib/locales/en.json'),'utf8'));
const i18n={useLanguage:()=>({language}),t:value=>language==='en'?(dictionary[value]||value):value};
const icons=new Proxy({},{get:()=>()=>null});
const member={id:'rep',email:'rep@yourrest.org',name:'Representative One',role:'rep',branch:'HQ',active:1,target:0};
const row=(id,kind,parentId,data)=>({id,kind,parentId,assignedTo:'rep',branch:'HQ',data,createdAt:'2026-10-03T07:00:00Z',updatedAt:'2026-10-03T07:00:00Z',version:1});
const customer=row('factory','customer',null,{name:'Factory One',code:'CUS-23',city:'Dammam',region:'الشرقية'});
const contacts=Array.from({length:25},(_,index)=>row('main-'+index,'activity','factory',{hasCompetitor:true,competitorName:'Main Co',date:'2026-10-'+String(index+1).padStart(2,'0'),performedBy:'rep',type:'call',salesStage:'quoted',result:'متابعة العميل',requestedProducts:['قوالب البلوك الثابتة'],competitorNotes:index===24?'Price <script>alert(1)</script>\nDelivery in 10 days':'Note '+index,competitorFileId:index===24?'file&/test':'',competitorFileName:index===24?'Quote <October>.pdf':''}));
const others=Array.from({length:34},(_,index)=>row('other-'+index,'activity','factory',{hasCompetitor:true,competitorName:'Competitor '+index,date:'2026-09-01',performedBy:'rep',type:'visit',requestedProducts:[]}));
const records=[customer,...contacts,...others];
function descendants(tree,predicate){
 if(!tree||typeof tree!=='object')return [];
 if(Array.isArray(tree))return tree.flatMap(item=>descendants(item,predicate));
 if(typeof tree.type==='function')return descendants(tree.type(tree.props),predicate);
 return [...(predicate(tree)?[tree]:[]),...descendants(tree.props?.children,predicate)];
}
function text(tree){if(tree===null||tree===undefined||tree===false)return '';if(typeof tree!=='object')return String(tree);if(Array.isArray(tree))return tree.map(text).join('');return text(tree.props?.children);}
function harness(initialRecords=records){
 let props={records:initialRecords,members:[member],onCustomer:id=>customers.push(id),onVisit:row=>visits.push(row),onNew:(...args)=>created.push(args),onRefresh:()=>new Promise((resolve,reject)=>refreshes.push({resolve,reject}))},cursor=0,tree;
 const hooks=[],customers=[],visits=[],created=[],refreshes=[];
 const hooksReact={...React,useMemo:fn=>fn(),useState(initial){const index=cursor++;if(!hooks[index])hooks[index]={value:typeof initial==='function'?initial():initial};return [hooks[index].value,value=>{hooks[index].value=typeof value==='function'?value(hooks[index].value):value;}];},useRef(value){const index=cursor++;if(!hooks[index])hooks[index]={current:value};return hooks[index];}};
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'app/competitors-workspace.tsx'),'utf8'),{compilerOptions:compiler}).outputText,{exports,console,Intl,requestAnimationFrame:fn=>fn(),require:name=>{
  if(name==='react')return hooksReact;if(name==='react/jsx-runtime')return jsx;if(name==='lucide-react')return icons;if(name==='@/lib/i18n')return i18n;if(name.endsWith('.css'))return {};if(name.startsWith('@/lib/'))return library(name.slice(2)+'.ts');throw Error('Unexpected UI dependency '+name);
 }});
 const render=()=>{cursor=0;tree=exports.default(props);return renderToStaticMarkup(tree);};
 const find=predicate=>descendants(tree,predicate);
 const button=label=>find(node=>node.type==='button'&&text(node.props.children)===label)[0];
 return {render,find,button,customers,visits,created,refreshes,change:next=>{props={...props,...next};},tree:()=>tree};
}
const h=harness();let html=h.render();
ok(html.includes('المنافسون'),'Arabic workspace heading');ok(html.includes('dir="rtl"'),'Arabic direction');
eq(h.find(node=>node.type==='button'&&node.props.className?.startsWith('competitors-item')).length,30,'Initial list bounded at 30 competitors');
eq(html.includes('Price &lt;script&gt;'),false,'No detail data rendered before selection');
ok(html.includes('اختر منافسًا لعرض ملفه'),'Selection prompt');
ok(html.includes('aria-label="تحديث المنافسين"'),'Refresh has accessible label');
ok(html.includes('for="competitors-query"'),'Search has explicit label');
h.button('تسجيل منافس في زيارة').props.onClick();eq(h.created,[[]],'Main CTA opens a new competitor visit');
h.button('عرض المزيد من المنافسين (5)').props.onClick();h.render();
eq(h.find(node=>node.type==='button'&&node.props.className?.startsWith('competitors-item')).length,35,'More competitors exposed on request');
const mainButton=()=>h.find(node=>node.type==='button'&&node.props.className?.startsWith('competitors-item')&&text(node).includes('Main Co'))[0];
mainButton().props.onClick();html=h.render();
ok(html.includes('has-selection'),'Selected workspace switches mobile mode');eq(mainButton().props['aria-pressed'],true,'Selection announced');
eq(h.find(node=>node.type==='li'&&node.props.className==='competitors-contact').length,3,'Overview keeps only three recent contacts');
h.find(node=>node.props.id==='competitor-tab-observations')[0].props.onClick();html=h.render();
eq(h.find(node=>node.type==='li'&&node.props.className==='competitors-contact').length,20,'Contact history bounded at 20 rows');
ok(html.indexOf('2026-10-25')<html.indexOf('2026-10-24'),'Newest contact appears before prior contact');
ok(html.includes('Price &lt;script&gt;alert(1)&lt;/script&gt;'),'Competitor notes are escaped');
eq(html.includes('<script>alert'),false,'User data never executes as HTML');
ok(html.includes('href="/api/visit-files?id=file%26%2Ftest"'),'Attachment URL uses authorized endpoint and encoded opaque ID');
ok(html.includes('rel="noopener noreferrer"'),'Attachment safe new tab attributes');
ok(html.includes('Quote &lt;October&gt;.pdf'),'Attachment filename escaped');
ok(html.includes('Representative One'),'Recorded representative shown');ok(html.includes('عرض سعر'),'Sales stage translated');
ok(html.includes('قوالب البلوك الثابتة'),'Product shown');ok(html.includes('ملاحظات المنافس'),'Notes heading shown');
h.button('إضافة زيارة').props.onClick();eq(h.created[1],['Main Co'],'Selected competitor name passed to visit form');
h.find(node=>node.type==='button'&&text(node)==='Factory One')[0].props.onClick();eq(h.customers,['factory'],'Customer action opens exact customer');
h.find(node=>node.type==='button'&&node.props.className==='text-button competitors-open-visit')[0].props.onClick();eq(h.visits[0],contacts[24],'Details action receives original newest activity');
h.button('عرض سجلات أقدم (5)').props.onClick();h.render();eq(h.find(node=>node.type==='li'&&node.props.className==='competitors-contact').length,25,'Older observations exposed on request');
h.button('كل المنافسين').props.onClick();html=h.render();eq(html.includes('has-selection'),false,'Back restores mobile list');
const search=()=>h.find(node=>node.type==='input'&&node.props.id==='competitors-query')[0];
search().props.onChange({target:{value:'Main Co'}});html=h.render();eq(h.find(node=>node.type==='button'&&node.props.className?.startsWith('competitors-item')).length,1,'Search filters competitor names');
mainButton().props.onClick();h.render();h.find(node=>node.props.id==='competitor-tab-observations')[0].props.onClick();h.render();eq(h.find(node=>node.type==='li'&&node.props.className==='competitors-contact').length,20,'Reselection resets contact paging');
search().props.onChange({target:{value:'missing'}});html=h.render();ok(html.includes('لا توجد نتائج مطابقة'),'No-result state shown');eq(html.includes('competitors-detail panel'),false,'Search removal immediately clears selected details');
h.button('عرض كل المنافسين').props.onClick();h.render();eq(search().props.value,'','No-result action resets query');
search().props.onChange({target:{value:'CUS-23'}});h.render();eq(h.find(node=>node.type==='button'&&node.props.className?.startsWith('competitors-item')).length,30,'Customer code search uses real projection, list window resets');
h.find(node=>node.type==='button'&&node.props['aria-label']==='مسح البحث')[0].props.onClick();h.render();eq(search().props.value,'','Clear search action resets input');
mainButton().props.onClick();h.render();h.change({records:[customer,...others]});html=h.render();eq(html.includes('Price &lt;script&gt;'),false,'Removed scope observations cannot stay rendered');eq(html.includes('competitors-detail panel'),false,'Selection cannot keep deleted competitor data');
const refresh=()=>h.find(node=>node.type==='button'&&node.props['aria-label']==='تحديث المنافسين')[0];
const firstRefresh=refresh().props.onClick();refresh().props.onClick();h.render();eq(h.refreshes.length,1,'Refresh lock rejects simultaneous clicks');eq(refresh().props.disabled,true,'Refresh disabled while awaiting data');
h.refreshes[0].reject(Error('private server text'));await firstRefresh;html=h.render();ok(html.includes('role="alert"'),'Refresh failure announced');eq(html.includes('private server text'),false,'Raw server error not leaked');eq(refresh().props.disabled,false,'Refresh reenabled after failure');
const retry=h.button('إعادة المحاولة').props.onClick();h.render();eq(h.refreshes.length,2,'Retry starts new refresh');h.refreshes[1].resolve();await retry;html=h.render();eq(html.includes('role="alert"'),false,'Successful refresh clears previous failure');
const empty=harness([]);html=empty.render();ok(html.includes('لم يُسجّل منافسون بعد'),'Empty state explained');empty.button('تسجيل أول منافس').props.onClick();eq(empty.created,[[]],'Empty state opens existing visit registration');
const long=harness([customer,row('long','activity','factory',{hasCompetitor:true,competitorName:'Long',date:'2026-10-03',type:'visit',competitorNotes:'ا'.repeat(301),competitorFileId:'opaque'})]);long.render();long.find(node=>node.type==='button'&&node.props.className==='competitors-item')[0].props.onClick();html=long.render();ok(html.includes('<details'),'Long competitor notes initially compact');ok(html.includes('فتح عرض المنافس'),'Attachment with missing filename has accessible fallback');ok(html.includes('غير محدد'),'Missing representative has neutral fallback');
language='en';const english=harness(records);html=english.render();for(const label of ['Competitors','Record a competitor in a visit','Search competitor, customer or representative','Select a competitor'])ok(html.includes(label),'English label '+label);ok(html.includes('dir="ltr"'),'English direction');english.find(node=>node.type==='button'&&node.props.className?.startsWith('competitors-item')&&text(node).includes('Main Co'))[0].props.onClick();english.render();english.find(node=>node.props.id==='competitor-tab-observations')[0].props.onClick();html=english.render();for(const label of ['Add visit','All competitors','Competitor history by customer','Newest first','Contact type','Representative','Sales stage','Competitor notes','View contact details'])ok(html.includes(label),'English detail '+label);
const css=fs.readFileSync(path.join(root,'app/competitors-workspace.css'),'utf8');ok(css.includes('@media(max-width:760px)'),'Mobile layout breakpoint provided');ok(css.includes('.competitors-workspace.has-selection .competitors-list{display:none}'),'Mobile selected state replaces list instead of horizontal columns');ok(css.includes('overflow-wrap:anywhere'),'Long user content allowed to wrap');ok(css.includes('minmax(0,1fr)'),'Flexible columns can shrink on mobile');ok(css.includes('var(--card)')&&css.includes('var(--border)'),'Theme variables support dark mode');
console.log(JSON.stringify({ok:true,checks,type:'actual competitor workspace SSR and controlled interactions',realBrowser:false}));
