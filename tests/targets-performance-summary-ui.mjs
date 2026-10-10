// Actual summary and pure quantity/availability boundaries; no backend scores are recomputed here.
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
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
function load(file,require){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:compiler}).outputText,{exports,require,console,Intl,structuredClone});return exports;}
function library(file){if(cache.has(file))return cache.get(file);const result=load(file,name=>name.startsWith('.')?library(path.join(path.dirname(file),name)+'.ts'):nativeRequire(name));cache.set(file,result);return result;}
const {remainingTarget,missingIndicators,displayedKpiScore}=library('lib/targets-performance-summary.ts');
const {operationalIndicators}=library('lib/kpis.ts'),{targetProducts}=library('lib/targets.ts');
const dictionary=JSON.parse(fs.readFileSync('lib/locales/en.json','utf8'));
const translate=value=>language==='en'?(dictionary[value]||value):value;
const metrics=()=>Array.from(operationalIndicators,definition=>({id:definition.id,score:50,points:definition.weight/2,reason:'Evidence',source:'automatic',numerator:null,denominator:null}));
const chosen=targetProducts[0],service=targetProducts.find(product=>product.unit==='خدمة');
const member={id:'rep-one',name:'مندوب باسم طويل للاختبار دون إخفاء بياناته',role:'rep',active:1,branch:'الغربية'};
function person(overrides={}){return {member:{...member},teamRollup:false,attainment:{rows:[{...chosen,target:10.25,actual:7.125,achievement:7.125/10.25*100},{...service,target:1000,actual:300,achievement:30}],score:27.75,status:'ready'},summary:{total:88.125,earned:88.125,covered:100,complete:true},metrics:metrics(),...overrides};}

for(const [target,actual,expected] of [[10.25,7.125,3.125],[.3,.1,.2],[1,.999999,.000001],[1.25,2,0],[0,0,0],[0,5,0],[5,0,5],[5,null,null],[null,0,null],[0,null,null],[undefined,2,null],[2,undefined,null],[NaN,0,null],[2,Infinity,null],[Infinity,1,null],[-1,1,null],[1,-1,2],[7,-2,9],[0,-2,2]])eq(remainingTarget(target,actual),expected,'Remaining preserves finite known quantities and six-decimal precision');
eq(missingIndicators().length,18,'Omitted KPI data means every canonical indicator is unavailable');eq(missingIndicators(metrics()).length,0,'All known scores are complete');const zeroMetrics=metrics().map(metric=>({...metric,score:0}));eq(missingIndicators(zeroMetrics).length,0,'A recorded zero is not a missing score');
const incomplete=metrics().filter(metric=>metric.id!=='collection').map(metric=>metric.id==='growth'?{...metric,score:null}:metric.id==='quality'?{...metric,score:NaN}:metric);
eq(Array.from(missingIndicators(incomplete),indicator=>indicator.id),['collection','growth','quality'],'Missing KPI list counts absent, null and non-finite scores by canonical indicator');
eq(displayedKpiScore(person()),88.125,'Final score uses the server value without recomputing it from metrics');eq(displayedKpiScore(person({summary:{total:0,complete:true},metrics:zeroMetrics})),0,'A valid final zero remains visible');eq(displayedKpiScore(person({metrics:incomplete})),null,'Incomplete indicators suppress a misleading numeric total');eq(displayedKpiScore(person({summary:{total:88.125,complete:false}})),null,'Server incomplete flag remains authoritative');eq(displayedKpiScore(person({summary:{total:null,complete:true}})),null);eq(displayedKpiScore(person({summary:{total:Infinity,complete:true}})),null);eq(displayedKpiScore(person({summary:undefined})),null);

const noop=()=>{},icon=()=>React.createElement('svg',{'aria-hidden':true});
function viewRequire(name){
 if(name==='./target-gauge')return load('app/target-gauge.tsx',viewRequire);
 if(name==='react/jsx-runtime')return jsx;
 if(name==='react')return React;
 if(name==='lucide-react')return new Proxy({},{get:()=>icon});
 if(name==='@/lib/i18n')return {t:translate,useLanguage:()=>({language}),direction:()=>language==='ar'?'rtl':'ltr'};
 if(name.startsWith('@/lib/'))return library(name.replace('@/','')+'.ts');
 if(name.endsWith('.css'))return {};
 throw Error('Unexpected summary import '+name);
}
const Summary=load('app/targets-performance-summary.tsx',viewRequire).default;
function nodes(tree,predicate){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(node=>nodes(node,predicate));return [...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];}
function text(tree){if(tree===null||tree===undefined||typeof tree==='boolean')return '';if(typeof tree!=='object')return String(tree);if(typeof tree.type==='function')return text(tree.type(tree.props));return Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);}
const props={people:[person()],month:'2026-10',future:false,productId:chosen.id,onProductChange:noop,onDetails:noop};
const card=tree=>nodes(tree,node=>node.type==='article')[0];
const quantityFields=tree=>Object.fromEntries(nodes(tree,node=>node.type==='dl').flatMap(list=>nodes(list,node=>node.type==='div').map(group=>[text(nodes(group,node=>node.type==='dt')[0]),text(nodes(group,node=>node.type==='dd')[0]).trim()])));
let selectedProduct,selectedMember,tree=Summary({...props,onProductChange:value=>{selectedProduct=value;},onDetails:value=>{selectedMember=value;}});
eq(nodes(tree,node=>node.type==='article').length,1,'One semantic card represents one authorized person');eq(nodes(tree,node=>node.type==='table').length,0,'Cards do not require a wide comparison table');const select=nodes(tree,node=>node.type==='select')[0];ok(select,'Product control uses a native keyboard-accessible select');ok(nodes(tree,node=>node.type==='label'&&node.props.htmlFor===select.props.id).length===1,'Visible product label names the native select');eq(nodes(select,node=>node.type==='option').length,targetProducts.length);select.props.onChange({target:{value:service.id}});eq(selectedProduct,service.id,'Product change reports the chosen product identity');
let fields=quantityFields(tree);eq(fields['المستهدف المطلوب'],'10.25 قالب');eq(fields['المحقق الفعلي'],'7.125 قالب');eq(fields['المتبقي للمستهدف'],'3.125 قالب');eq(fields['نسبة تحقيق الصنف'],'69.51%');ok(text(card(tree)).includes('27.75%'),'Weighted achievement remains the separate server score');ok(text(card(tree)).includes('88.13 / 100'),'Final KPI score remains distinct from product achievement');eq(text(card(tree)).includes('1010.25'),false,'Different units are never summed into a target quantity');eq(text(card(tree)).includes('307.125'),false,'Different units are never summed into an actual quantity');const detailsButton=nodes(tree,node=>node.type==='button')[0];eq(detailsButton.props.type,'button');detailsButton.props.onClick();eq(selectedMember,member.id,'Details action retains the exact authorized member identity');eq(nodes(tree,node=>node.type==='details').length,0,'Complete indicators need no incomplete-data disclosure');
tree=Summary({...props,productId:service.id});fields=quantityFields(tree);eq(fields['المستهدف المطلوب'],'1,000 خدمة');eq(fields['المحقق الفعلي'],'300 خدمة');eq(fields['المتبقي للمستهدف'],'700 خدمة');eq(fields['نسبة تحقيق الصنف'],'30%');ok(text(card(tree)).includes('27.75%'),'Switching the displayed product does not replace weighted server attainment');ok(text(card(tree)).includes('88.13 / 100'),'Switching product cannot replace the final KPI score');
const unknown=person();unknown.attainment.rows[0]={...unknown.attainment.rows[0],target:0,actual:null,achievement:null};tree=Summary({...props,people:[unknown]});fields=quantityFields(tree);eq(fields['المستهدف المطلوب'],'0 قالب','A known zero target stays visible');eq(fields['المحقق الفعلي'],'— قالب','No invoice quantity is unknown, not zero');eq(fields['المتبقي للمستهدف'],'— قالب','Unknown actual does not turn a zero target into known remaining');eq(fields['نسبة تحقيق الصنف'],'—','Zero target cannot produce an invalid percentage');
const netReturns=person();netReturns.attainment.rows[0]={...netReturns.attainment.rows[0],target:7,actual:-2,achievement:-2/7*100};tree=Summary({...props,people:[netReturns]});fields=quantityFields(tree);eq(fields['المحقق الفعلي'],'-2 قالب','Net returns remain visible as a signed actual quantity');eq(fields['المتبقي للمستهدف'],'9 قالب','Net returns increase remaining quantity consistently with personal targets');
tree=Summary({...props,people:[person({metrics:incomplete})]});const disclosure=nodes(tree,node=>node.type==='details')[0];ok(disclosure,'Missing indicator names use native expandable details');eq(disclosure.props.open,undefined,'Missing details are collapsed initially');ok(text(nodes(disclosure,node=>node.type==='summary')[0]).includes('3 مؤشرات غير مكتملة'),'Missing count is visible before expanding');eq(nodes(disclosure,node=>node.type==='li').map(text),['التحصيل','نمو مبيعات الأصناف','دقة واكتمال البيانات']);ok(text(card(tree)).includes('غير مكتمل'));eq(text(card(tree)).includes('88.13 / 100'),false,'Partial summary never disguises missing metrics as a final score');
const history=person({member:{...member,id:'historical',name:'Historical member',active:0,readOnly:true},teamRollup:true});tree=Summary({...props,people:[history]});ok(text(card(tree)).includes('Historical member'),'Authorized history stays visible');ok(text(card(tree)).includes('معطل'));ok(text(card(tree)).includes('المبيعات محسوبة من الفريق'),'Team-derived target context is retained');eq(nodes(tree,node=>node.type==='button').length,1,'Read-only summary offers details only');eq(nodes(tree,node=>node.type==='input'||node.type==='textarea').length,0,'Summary does not expose target or KPI editing');
tree=Summary({...props,people:[person({metrics:incomplete})],future:true});eq(Object.keys(quantityFields(tree)),['المستهدف المطلوب'],'Future summary only presents planned target quantities');for(const label of ['المحقق الفعلي','المتبقي للمستهدف','نسبة تحقيق الصنف','التحقيق المرجح للمستهدف','درجة التقييم الكلية','مؤشرات غير مكتملة','المؤشرات مكتملة'])eq(text(card(tree)).includes(label),false,'Future month makes no actual/performance claim: '+label);ok(text(card(tree)).includes('لم يبدأ الشهر بعد'));eq(nodes(tree,node=>node.type==='details').length,0);
tree=Summary({...props,people:[]});eq(nodes(tree,node=>node.type==='article').length,0);ok(text(tree).includes('لا توجد بيانات مطابقة لعرض الملخص'),'Filtered empty state does not resurrect unrelated people');

for(const lang of ['ar','en']){language=lang;const html=renderToStaticMarkup(React.createElement(Summary,{...props,people:[person({metrics:incomplete})]}));ok(html.includes('<article'),'Both languages preserve card semantics');ok(html.includes('<dl'),'Quantities retain term/value semantics');ok(html.includes('<details'),'Missing inputs retain keyboard-expandable native details');ok(html.includes('<label'),'Product selection keeps its visible label');ok(html.includes('<select'),'Product selection remains native at mobile widths');if(lang==='en'){for(const label of ['Team member summary','Displayed product','Actual quantity','Remaining to target','Weighted target attainment','Incomplete indicators'])ok(html.includes(label),'English summary label '+label);eq(html.includes('ملخص المناديب'),false);}}
const css=fs.readFileSync('app/targets-performance-summary.css','utf8');ok(css.includes('min(100%,340px)'),'Grid columns can shrink to the available width');ok(css.includes('overflow-wrap:anywhere'),'Long member names and quantities can wrap');ok(css.includes('padding-inline-start'),'Missing-indicator list supports both writing directions');
console.log(JSON.stringify({ok:true,checks,coverage:'actual per-member summary: finite/null/zero/decimal remaining, independent units and server scores, missing KPI names, future planning, authorized history, accessible Arabic/English cards',realBrowser:false}));
