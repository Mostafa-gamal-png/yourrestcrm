// Actual performance/summary rendering with controlled React state and evidence dialog boundary.
// Verifies server-supplied units, applicability, scores, and permitted actions; no browser claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {makeVoiceField,expandVoiceFields} from '../scripts/lib/voice-field-stub.mjs';

const root=process.cwd(),nativeRequire=createRequire(import.meta.url),cache=new Map();
const compiler={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true};
let checks=0,language='en';
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
const noop=()=>{},pass=({children})=>children,icons=new Proxy({},{get:()=>()=>null});
const dictionary=JSON.parse(fs.readFileSync('lib/locales/en.json','utf8'));
const translate=value=>language==='en'?(dictionary[value]||value):value;
const i18n={t:translate,useLanguage:()=>({language}),getLanguage:()=>language,direction:()=>language==='ar'?'rtl':'ltr'};
function load(file,require){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:compiler}).outputText,{exports,require,console,Intl,crypto:globalThis.crypto,structuredClone,AbortController,URL,setTimeout,clearTimeout});return exports;}
function library(file){if(cache.has(file))return cache.get(file);const value=load(file,name=>name.startsWith('.')?library(path.join(path.dirname(file),name)+'.ts'):nativeRequire(name));cache.set(file,value);return value;}
const {operationalIndicators}=library('lib/kpis.ts'),{targetProducts}=library('lib/targets.ts');
function nodes(tree,predicate){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(node=>nodes(node,predicate));tree=expandVoiceFields(tree);return [...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];}
const VoiceFieldStub=makeVoiceField(value=>i18n.t(value));
function text(tree){if(tree===null||tree===undefined||typeof tree==='boolean')return '';if(typeof tree!=='object')return String(tree);return Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);}
const button=(tree,label)=>nodes(tree,node=>node.type==='button'&&text(node).trim()===label)[0];
const classNode=(tree,name)=>nodes(tree,node=>node.props?.className?.split(' ').includes(name))[0];
const indicator=(tree,id)=>nodes(tree,node=>node.props?.className==='kpi-indicator'&&text(nodes(node,n=>n.type==='strong')[0])===translate(operationalIndicators.find(metric=>metric.id===id).name))[0];
function KpiEvidenceEditor(){return null;}
const table=Object.fromEntries(Object.entries({Table:'table',TableHeader:'thead',TableHead:'th',TableRow:'tr',TableBody:'tbody',TableCell:'td'}).map(([name,tag])=>[name,({children,...props})=>React.createElement(tag,props,children)]));
function imports(name,hooks=React){
 if(name==='react')return hooks;if(name==='react/jsx-runtime')return jsx;if(name==='./voice-field')return {__esModule:true,default:VoiceFieldStub};if(name==='@/lib/i18n')return i18n;if(name==='lucide-react')return icons;
 if(name==='./target-gauge')return load('app/target-gauge.tsx',entry=>imports(entry,hooks));
 if(name==='./kpi-evidence-editor')return {__esModule:true,default:KpiEvidenceEditor};
 if(name==='@/components/ui/table')return table;
 if(name==='@/components/ui/progress')return {Progress:()=>null};
 if(name.startsWith('@/components/'))return new Proxy({},{get:()=>pass});
 if(name.startsWith('@/lib/'))return library(name.replace('@/','')+'.ts');
 if(name.endsWith('.css'))return {};
 throw Error('Unexpected performance evidence import '+name);
}
const Summary=load('app/targets-performance-summary.tsx',imports).default;
const baseMember={id:'rep-one',name:'Representative One',role:'rep',active:1,branch:'HQ',regionScope:'all'};
function person(){
 const metrics=Array.from(operationalIndicators,definition=>({id:definition.id,status:'scored',score:50,points:definition.weight/2,numerator:null,denominator:null,source:'automatic',reason:'Verified evidence for '+definition.id}));
 Object.assign(metrics.find(metric=>metric.id==='collection'),{numerator:5000,denominator:10000,source:'management'});
 Object.assign(metrics.find(metric=>metric.id==='recovered'),{numerator:5,denominator:10});
 return {member:{...baseMember},sourceMemberIds:[baseMember.id],salesSourceMemberIds:[baseMember.id],teamRollup:false,activityTeamRollup:false,activityTargetsKnown:true,activityTargets:{newCustomers:10,recoveredCustomers:5,visits:320},attainment:{score:50,status:'ready',applicableWeight:100,rows:Array.from(targetProducts,product=>({...product,actual:5,target:10,achievement:50,weight:12.5,contribution:6.25}))},growthRows:[],assessment:null,metrics,summary:{covered:100,earned:50,total:82.75,complete:true,applicableWeight:100,excludedWeight:0}};
}
const data=(people,canManage=true)=>({month:'2026-10',period:{first:'2026-10-01',cutoff:'2026-10-04',previousFirst:'2026-09-01',previousEnd:'2026-09-04'},people,canManage});
function harness(people=[person()],initial={}){
 let props={data:data(people),staff:people[0]?.member.id||'all',query:'',members:people.map(value=>value.member),identityKey:'manager:1',onSelect:id=>{selected=id;},onSaved:()=>saves++,...initial},cursor=0,tree,saves=0,selected;
 const hooks=[],hooksReact={...React,useState(initial){const index=cursor++;if(!hooks[index])hooks[index]={value:typeof initial==='function'?initial():initial};return [hooks[index].value,next=>{hooks[index].value=typeof next==='function'?next(hooks[index].value):next;}];},useRef(initial){const index=cursor++;return hooks[index]||(hooks[index]={current:initial});}};
 const Component=load('app/kpi-performance.tsx',name=>imports(name,hooksReact)).default;
 const render=()=>{cursor=0;tree=Component(props);return tree;};render();
 return {render,tree:()=>tree,html:()=>renderToStaticMarkup(tree),saves:()=>saves,selected:()=>selected,change:change=>{props={...props,...change};return render();}};
}
const summary=people=>Summary({people,month:'2026-10',future:false,productId:targetProducts[0].id,onProductChange:noop,onDetails:noop});
const overviewValues=tree=>nodes(classNode(tree,'kpi-overview'),node=>node.props?.className==='panel').map(node=>[text(nodes(node,n=>n.type==='span')[0]),text(nodes(node,n=>n.type==='strong')[0])]);
const overall=tree=>Object.fromEntries(overviewValues(tree))[translate('درجة التقييم الكلية')];
const coverage=tree=>Object.fromEntries(overviewValues(tree))[translate('الوزن الذي تم تقييمه')];

// Collection evidence is received in cents; display units are currency in both languages.
for(const selectedLanguage of ['en','ar']){
 language=selectedLanguage;const h=harness();let collection=text(indicator(h.tree(),'collection'));
 ok(collection.includes('50 / 100'+(language==='en'?' SAR':' ر.س')),'Collection cents display as 50 / 100 currency in '+language);eq(collection.includes('5,000'),false,'Collection numerator is not displayed as raw cents in '+language);eq(collection.includes('10,000'),false,'Collection denominator is not displayed as raw cents in '+language);
 eq(overall(h.tree()),'82.75 / 100','Performance keeps the exact server total instead of recalculating the metric average in '+language);
 let tree=summary([person()]);ok(text(classNode(tree,'targets-summary-scores')).includes('82.75 / 100'),'Summary keeps the same supplied final score in '+language);eq(text(classNode(tree,'targets-summary-coverage')),(language==='en'?'Evaluated weight':'الوزن المقيم')+': 100 / 100%','Summary labels evaluated versus applicable weight in '+language);
}
language='en';

// N/A indicators have an explicit label and are excluded from missing-data disclosures.
const withExclusion=person();Object.assign(withExclusion.metrics.find(metric=>metric.id==='growth'),{status:'not_applicable',score:null,points:null,reason:'No applicable previous-period baseline.'});withExclusion.summary={covered:100,earned:47.5,total:82.75,complete:true,applicableWeight:95,excludedWeight:5};
let h=harness([withExclusion]),growth=indicator(h.tree(),'growth');ok(text(growth).includes('Not applicable'),'N/A metric is named explicitly');eq(text(nodes(growth,node=>node.type==='bdi')[0]),'Not applicable','N/A metric does not present an unavailable weighted score as missing');ok(text(nodes(growth,node=>node.type==='summary')[0]).includes('Why this does not apply'),'N/A reason uses the correct disclosure label');eq(coverage(h.tree()),'95 / 95%','Performance removes excluded weight from both evaluated and applicable amounts');eq(overall(h.tree()),'82.75 / 100','Exclusions do not cause local recomputation of the final server score');ok(text(h.tree()).includes('Applicable weight: 95%'),'Applicable weight remains visible');
let tree=summary([withExclusion]);eq(nodes(tree,node=>node.props?.className==='targets-summary-missing').length,0,'An N/A metric is absent from missing indicators');ok(text(classNode(tree,'targets-summary-complete')).length>0,'Resolved N/A is a complete indicator state');eq(text(classNode(tree,'targets-summary-coverage')),'Evaluated weight: 95 / 95%','Summary subtracts excluded weight from coverage');ok(text(classNode(tree,'targets-summary-applicable')).includes('Not applicable: 5%'),'Summary explains the excluded weight');ok(text(classNode(tree,'targets-summary-scores')).includes('82.75 / 100'),'Summary preserves the server-normalized total with an N/A metric');

const partial=person();Object.assign(partial.metrics.find(metric=>metric.id==='collection'),{status:'not_applicable',score:null,points:null,numerator:0,denominator:0});Object.assign(partial.metrics.find(metric=>metric.id==='attainment'),{status:'missing',score:null,points:null});partial.summary={covered:75,earned:27.5,total:null,complete:false,applicableWeight:80,excludedWeight:20};h=harness([partial]);eq(coverage(h.tree()),'55 / 80%','Partial performance evaluates covered minus excluded weight');eq(overall(h.tree()),translate('غير مكتمل'),'Partial applicable indicators do not display a final score');tree=summary([partial]);eq(text(classNode(tree,'targets-summary-coverage')),'Evaluated weight: 55 / 80%','Summary distinguishes incomplete applicable coverage from excluded weight');const missing=classNode(tree,'targets-summary-missing');eq(nodes(missing,node=>node.type==='li').map(text),[translate('تحقيق المستهدف البيعي')],'Only missing applicable indicators appear in the missing list');eq(text(missing).includes('Collections'),false,'N/A collection is never called missing');eq(text(classNode(tree,'targets-summary-scores')).includes('/ 100'),false,'Incomplete applicable coverage never shows a fabricated final total');

const allExcluded=person();allExcluded.metrics=allExcluded.metrics.map(metric=>({...metric,status:'not_applicable',score:null,points:null,numerator:null,denominator:null}));allExcluded.attainment={...allExcluded.attainment,score:null,status:'not_applicable',applicableWeight:0};allExcluded.summary={covered:100,earned:0,total:null,complete:true,applicableWeight:0,excludedWeight:100};h=harness([allExcluded]);eq(overall(h.tree()),'Not applicable','All-excluded total is N/A instead of incomplete');eq(coverage(h.tree()),'0 / 0%','All-excluded performance shows zero applicable weight');ok(h.html().includes('Weighted target attainment: Not applicable'),'N/A attainment is announced by the actual gauge');for(const axis of nodes(h.tree(),node=>node.props?.className==='kpi-axis-score'))eq(text(axis),'Not applicable','An entirely excluded axis is N/A');tree=summary([allExcluded]);eq(nodes(tree,node=>node.props?.className==='targets-summary-missing').length,0,'All-excluded evidence has no missing-data list');ok(text(classNode(tree,'targets-summary-scores')).includes('Not applicable'),'All-excluded summary uses N/A');eq(text(classNode(tree,'targets-summary-coverage')),'Evaluated weight: 0 / 0%','All-excluded summary retains the denominator');ok(renderToStaticMarkup(tree).includes('Weighted target attainment: Not applicable'),'Summary gauge also announces N/A attainment');

// Comparison rows use the same server total and applicability accounting.
h=harness([withExclusion],{staff:'all'});ok(h.html().includes('82.75 / 100'),'Comparison table preserves server final total');ok(h.html().includes('95 / 95%'),'Comparison table excludes N/A weight from evaluation coverage');button(h.tree(),translate('عرض المؤشرات')).props.onClick();eq(h.selected(),baseMember.id,'Comparison action selects the exact member');h=harness([allExcluded],{staff:'all'});ok(h.html().includes('Not applicable'),'All-excluded comparison row is N/A');eq(h.html().includes('>Incomplete<'),false,'All-excluded comparison row is not mislabeled incomplete');

// Evidence opens for the selected representative with the exact viewing identity/month.
const rep=person(),supervisor=harness([rep],{data:data([rep],false),identityKey:'supervisor:scope-2'});ok(button(supervisor.tree(),'View KPI evidence'),'Read-only supervisor can view selected rep evidence');eq(button(supervisor.tree(),'Complete KPI evidence'),undefined,'Read-only supervisor receives no edit invitation');eq(button(supervisor.tree(),translate('تقييم الإدارة وتدقيق البيانات')),undefined,'Read-only supervisor receives no management assessment action');button(supervisor.tree(),'View KPI evidence').props.onClick();supervisor.render();let dialog=nodes(supervisor.tree(),node=>node.type===KpiEvidenceEditor)[0];ok(dialog,'View action opens the evidence dialog');eq(dialog.props.memberId,baseMember.id,'Dialog uses the selected rep ID');eq(dialog.props.memberName,baseMember.name,'Dialog uses the selected rep name');eq(dialog.props.month,'2026-10','Dialog uses the shared month');eq(dialog.props.identityKey,'supervisor:scope-2','Dialog receives the current authorization identity');dialog.props.onClose();supervisor.render();eq(nodes(supervisor.tree(),node=>node.type===KpiEvidenceEditor).length,0,'Evidence close removes the dialog');eq(supervisor.saves(),0,'Viewing/closing evidence never reports a save');

const manager=harness([rep]);ok(button(manager.tree(),'Complete KPI evidence'),'Manager can complete active rep evidence');ok(button(manager.tree(),translate('تقييم الإدارة وتدقيق البيانات')),'Manager retains the separate management assessment action');button(manager.tree(),'Complete KPI evidence').props.onClick();manager.render();dialog=nodes(manager.tree(),node=>node.type===KpiEvidenceEditor)[0];dialog.props.onSaved();manager.render();eq(manager.saves(),1,'Acknowledged evidence save refreshes the parent once');eq(nodes(manager.tree(),node=>node.type===KpiEvidenceEditor).length,0,'Acknowledged evidence save closes its dialog');
const inactive={...person(),member:{...baseMember,active:0}};h=harness([inactive]);ok(button(h.tree(),'Complete KPI evidence'),'Manager can audit an inactive rep without reactivation');eq(button(h.tree(),translate('تقييم الإدارة وتدقيق البيانات')).props.disabled??false,false,'Inactive rep management assessment remains enabled');
const historical={...person(),member:{...baseMember,active:0,readOnly:true}};h=harness([historical]);ok(button(h.tree(),'View KPI evidence'),'Historical read-only rep remains viewable');eq(button(h.tree(),'Complete KPI evidence'),undefined,'Historical read-only rep receives no evidence-edit invitation');eq(button(h.tree(),translate('تقييم الإدارة وتدقيق البيانات')),undefined,'Historical read-only rep receives no management assessment action');

// Team leaders consume rep evidence; their recovery target follows the scored denominator.
for(const role of ['supervisor','manager']){
 const leader=person();leader.member={...baseMember,id:'leader-'+role,name:'Team '+role,role};leader.teamRollup=true;leader.salesSourceMemberIds=['rep-one','rep-two'];h=harness([leader],{members:[leader.member,baseMember,{...baseMember,id:'rep-two',name:'Representative Two'}]});eq(button(h.tree(),'Complete KPI evidence'),undefined,'Team leader has no direct evidence-edit action: '+role);eq(button(h.tree(),'View KPI evidence'),undefined,'Team leader does not open a fabricated personal evidence entry: '+role);ok(text(classNode(h.tree(),'info-line')).includes('KPI evidence comes from team reps'),'Team leader explains its evidence source: '+role);const activity=nodes(h.tree(),node=>node.type==='p'&&node.props.className==='target-note panel')[0];ok(text(activity).includes('Reactivated customers 10'),'Team leader recovery target uses metric denominator: '+role);eq(text(activity).includes('Reactivated customers 5'),false,'Team leader never substitutes its personal recovery target: '+role);
}

console.log(JSON.stringify({ok:true,checks,coverage:'actual KPI performance and summary: cents-to-SAR display, N/A indicators and missing lists, applicable evaluated weights, server totals, supervisor/manager evidence actions and team recovery denominator',realBrowser:false}));
