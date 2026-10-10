// Exercise the actual mobile cards and follow-up page callbacks with scoped records.
// This validates render/interaction contracts, not physical touch or browser layout.
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
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
const dictionary=JSON.parse(fs.readFileSync(path.join(root,'lib/locales/en.json'),'utf8'));
const i18n={t:value=>language==='en'&&typeof value==='string'?(dictionary[value]||value):value,useLanguage:()=>({language}),getLanguage:()=>language};
const now='2026-09-30',noop=()=>{},pass=({children})=>children,mock=new Proxy({},{get:()=>pass});
function library(filename){
 if(cache.has(filename))return cache.get(filename);
 const exports={};cache.set(filename,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,require:name=>name.startsWith('.')?library(path.join(path.dirname(filename),name)+'.ts'):nativeRequire(name),Date,Intl,console});return exports;
}
function load(filename,hooks=React){
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,require:name=>{
  if(name==='react')return hooks;
  if(name==='react/jsx-runtime')return jsx;
  if(name==='@/lib/i18n')return i18n;
  if(name==='@/lib/crm')return {...library('lib/crm.ts'),today:()=>now};
  if(name.startsWith('@/lib/'))return library(name.replace('@/','')+'.ts');
  return mock;
 },console,Date,Intl});return exports;
}
function nodes(tree,predicate){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(item=>nodes(item,predicate));return [...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];}
function text(tree){if(tree==null||typeof tree==='boolean')return '';if(typeof tree!=='object')return String(tree);return Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);}
const hasClass=(node,name)=>(node.props?.className||'').split(' ').includes(name);
const cards=tree=>nodes(tree,node=>hasClass(node,'rep-record-card'));
const button=(tree,label)=>nodes(tree,node=>node.type==='button'&&text(node)===label)[0];
const row=(id,kind,parentId,data,assignedTo='rep')=>({id,kind,parentId,assignedTo,branch:'HQ',data,createdAt:'2026-09-30T08:00:00Z',updatedAt:'2026-09-30T08:00:00Z',version:1});
const customer=row('customer','customer',null,{name:'مصنع الاسم الطويل لاختبار وضوح البطاقة',region:'الغربية',city:'جدة'});
const visit=row('visit','activity',customer.id,{visitNumber:12,type:'visit',date:now,summary:'تعريف بمنتجات الشركة',result:'طلب العميل عرض سعر',nextDate:'2026-09-29',nextAction:'إرسال العرض',salesStage:'qualified',location:'21.5, 39.2',performedBy:'rep',_readOnly:true});
const members=[{id:'rep',name:'مندوب الغربية'},{id:'supervisor',name:'المشرف'}];
let edited=[],opened=[],customerOpened=[],workflows=[];
const VisitsTable=load('app/visits-table.tsx').default;
const visitProps={rows:[visit],customerFor:()=>customer,onOpen:id=>opened.push(id),onEdit:r=>edited.push(r.id),onCustomer:id=>customerOpened.push(id),expanded:true,members,onWorkflow:id=>workflows.push(id)};
let tree=VisitsTable(visitProps),card=cards(tree)[0];
eq(cards(tree).length,1,'Only supplied visits appear as cards');
ok(text(card).includes(customer.data.name),'Full customer identity is present');
ok(text(card).includes(visit.data.result),'Recorded outcome is visible');
ok(text(card).includes('متأخرة'),'Overdue follow-up is explicit');
ok(text(card).includes('مندوب الغربية'),'Supervisor sees record owner');
button(card,customer.data.name).props.onClick();eq(customerOpened,['customer'],'Customer tap opens exact customer');
button(card,'عرض التفاصيل').props.onClick();eq(opened,['visit'],'Read-only card uses the view callback');eq(edited,[],'Read-only card never invokes edit');
eq(button(card,'عرض / تعديل الزيارة'),undefined,'Read-only visit is never labelled editable');
const location=nodes(card,node=>node.type==='a')[0];ok(location.props.href.startsWith('https://www.google.com/maps'),'Location keeps existing safe map URL');eq(location.props.rel,'noopener noreferrer');
const editable={...visit,data:{...visit.data,_readOnly:false,_serviceWorkflow:{id:'workflow',state:'pending'}}};
card=cards(VisitsTable({...visitProps,rows:[editable]}))[0];button(card,'عرض / تعديل الزيارة').props.onClick();eq(edited.at(-1),'visit');
button(card,'الاعتماد والتكليف').props.onClick();eq(workflows,['workflow'],'Service assignment callback is retained');
const closedVisit={...visit,data:{...visit.data,salesStage:'won'}};
card=cards(VisitsTable({...visitProps,rows:[closedVisit]}))[0];eq(nodes(card,node=>hasClass(node,'rep-record-next')).length,0,'Closed sales do not show a stale overdue action');
card=cards(VisitsTable({...visitProps,onCustomer:undefined}))[0];button(card,customer.data.name).props.onClick();eq(opened,['visit','visit'],'Embedded tables without customer callback still open visit');
language='en';card=cards(VisitsTable(visitProps))[0];ok(text(card).includes('Overdue'),'Visit card English status');ok(button(card,'View details'),'Visit card English read-only label');language='ar';

// Role-level read-only presentation must not depend on freshly fetched row flags.
for(const locale of ['ar','en']){
 language=locale;const viewCalls=[],editCalls=[];
 const readonlyTree=VisitsTable({...visitProps,rows:[editable],canEdit:false,onOpen:id=>viewCalls.push(id),onEdit:row=>editCalls.push(row.id)});
 const detailLabel=locale==='ar'?'عرض التفاصيل':'View details';
 const viewButtons=nodes(readonlyTree,node=>node.type==='button'&&text(node)===detailLabel);
 eq(viewButtons.length,2,'Role-level readonly has view actions in mobile and desktop '+locale);
 for(const action of viewButtons)action.props.onClick();
 eq(viewCalls,['visit','visit'],'Both layouts open the existing visit '+locale);eq(editCalls,[],'Neither layout dispatches edit '+locale);
 ok(!nodes(readonlyTree,node=>node.type==='button').some(node=>/تعديل|Edit/i.test(text(node))),'No edit button survives missing row readonly flag '+locale);
 const allowedTree=VisitsTable({...visitProps,rows:[editable],canEdit:true,onEdit:row=>editCalls.push(row.id)});
 const mobileAction=cards(allowedTree)[0];button(mobileAction,locale==='ar'?'عرض / تعديل الزيارة':dictionary['عرض / تعديل الزيارة']).props.onClick();eq(editCalls,['visit'],'Explicit management edit permission remains available '+locale);
}
language='ar';
const customers=Array.from({length:4},(_,i)=>row('customer-'+i,'customer',null,{name:'Factory '+i},i===1?'other':'rep'));
const visits=customers.map((c,i)=>row('activity-'+i,'activity',c.id,{type:'call',date:now,visitWorkflow:'followup-v1',result:'Outcome '+i,nextAction:'Call purchasing '+i,nextDate:['2026-09-28',now,'2026-10-02','2026-10-01'][i],salesStage:i===3?'won':'new',performedBy:c.assignedTo},c.assignedTo));
const records=[...customers,...visits],actions=[],details=[],openedCustomers=[];
const props={records,members,query:'',staff:'all',stage:'all',onNew:(id,sourceId)=>actions.push([id,sourceId]),onOpen:r=>details.push(r.id),onCustomer:id=>openedCustomers.push(id)};
const values=[];let cursor=0;
const hooks={...React,useState(initial){const index=cursor++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return [values[index],value=>{values[index]=typeof value==='function'?value(values[index]):value;}];},useEffect:noop};
const {CustomerFollowupsPage}=load('app/customer-followup-list.tsx',hooks);
const render=(extra={})=>{cursor=0;return CustomerFollowupsPage({...props,...extra});};
tree=render();eq(cards(tree).length,3,'Open view contains current open customer plans only');
ok(text(cards(tree)[0]).includes('متأخرة'),'Overdue plan marked');ok(text(cards(tree)[1]).includes('اليوم'),'Today plan marked');ok(text(cards(tree)[2]).includes('قادمة'),'Future plan marked');
button(cards(tree)[0],'تنفيذ المتابعة').props.onClick();eq(actions,[['customer-0','activity-0']],'Primary action prefills exact customer');
button(cards(tree)[0],'بيانات العميل').props.onClick();eq(openedCustomers,['customer-0'],'Customer details uses existing callback');
button(tree,'اليوم والمتأخرة').props.onClick();tree=render();eq(cards(tree).length,2,'Due tab excludes future and closed plans');
button(tree,'القادمة').props.onClick();tree=render();eq(cards(tree).length,1);ok(text(cards(tree)[0]).includes('Factory 2'));
button(tree,'المغلقة').props.onClick();tree=render();eq(cards(tree).length,1);ok(text(cards(tree)[0]).includes('Factory 3'));ok(text(cards(tree)[0]).includes('مغلقة'));eq(button(cards(tree)[0],'تنفيذ المتابعة'),undefined,'Closed plan cannot be executed');
button(tree,'سجل المتابعات').props.onClick();tree=render();eq(cards(tree).length,4,'History uses real follow-up rows');button(cards(tree)[0],'عرض التفاصيل').props.onClick();eq(details.length,1);ok(details[0].startsWith('activity-'),'History opens actual existing record');
tree=render({staff:'rep'});eq(cards(tree).length,3,'History preserves performed-by filter');
button(tree,'المفتوحة').props.onClick();tree=render({staff:'rep'});eq(cards(tree).length,2,'Open plans preserve responsible filter');
tree=render({query:'Factory 2'});eq(cards(tree).length,1,'Search filters mobile and desktop data together');
tree=render({query:'no match'});eq(cards(tree).length,0);eq(button(tree,'تنفيذ المتابعة'),undefined,'Empty list has no independent follow-up creation');
language='en';tree=render();ok(text(cards(tree)[0]).includes('Overdue'));ok(text(cards(tree)[1]).includes('Today'));ok(text(cards(tree)[2]).includes('Upcoming'));ok(button(cards(tree)[0],dictionary['تنفيذ المتابعة']),'Primary action follows English dictionary');language='ar';
const incompleteRecords=[customers[0],{...visits[0],data:{...visits[0].data,nextDate:''}}];tree=render({records:incompleteRecords});eq(button(cards(tree)[0],'تنفيذ المتابعة'),undefined,'Unscheduled contact cannot execute a follow-up');eq(cards(tree).length,1,'Incomplete plan stays visible for review');
const css=fs.readFileSync(path.join(root,'app/rep-record-lists.css'),'utf8');
ok(css.includes('@media screen and (max-width:1023px)'),'Cards match mobile navigation breakpoint');ok(css.includes('.rep-desktop-records{display:none!important}'),'Desktop controls leave accessibility tree on mobile');ok(css.includes('.rep-mobile-records{display:none}'),'Mobile controls leave accessibility tree on desktop');
console.log(JSON.stringify({ok:true,checks,type:'actual mobile visit and follow-up card callbacks, read-only/service workflows, status tabs, scoped filters and English',realBrowser:false}));
