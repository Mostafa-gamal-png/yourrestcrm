// Controlled interaction checks against the real CRM component; no browser/layout claim.
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
const ok=(actual,message)=>{assert.ok(actual,message);checks++;};
const noop=()=>{},pass=({children})=>children,mocks=new Proxy({},{get:()=>pass});
const dictionary=JSON.parse(fs.readFileSync('lib/locales/en.json','utf8'));
const i18n={useLanguage:()=>({language}),getLanguage:()=>language,direction:()=>language==='ar'?'rtl':'ltr',t:value=>language==='en'&&typeof value==='string'?(dictionary[value]||value):value};
const tr=value=>i18n.t(value);
function Dialog(){}function AlertDialog(){}function AlertDialogAction(){}function CustomerMachines(){}function MobileNavigation(){}
function OfflineStatus(){}
function CustomerIdentities(){}
function VisitsPage(){}function CustomerVisitDialog(){}function CustomerVisitHistory(){}function CustomerFollowupsPage(){}function CustomerFollowupDialog(){}function CustomerMap(){}function MyTargets(){}
function load(filename,require,globals={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,Error,TypeError,require:name=>name==='@/lib/client-submit'?load('lib/client-submit.ts',nativeRequire,{AbortController,DOMException,URL,setTimeout,clearTimeout,...globals}):require(name),console,crypto:globalThis.crypto,structuredClone,Intl,setTimeout,clearTimeout,...globals});return exports;}
function library(filename){if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);const require=name=>name.startsWith('.')?library(path.join(path.dirname(filename),name)+'.ts'):nativeRequire(name);vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,require,console,Intl});return exports;}
function commonRequire(name){
 if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;
 if(name==='./voice-field')return {__esModule:true,default:VoiceFieldStub};if(name==='@/lib/i18n')return i18n;if(name.startsWith('@/lib/'))return library(name.replace('@/','')+'.ts');
 if(name==='@/components/ui/dialog')return {...mocks,Dialog,DialogContent:pass,DialogTitle:pass,DialogDescription:pass};
 if(name==='@/components/ui/alert-dialog')return new Proxy({AlertDialog,AlertDialogAction},{get:(target,key)=>target[key]||pass});
 if(name==='./customer-identities')return {__esModule:true,default:CustomerIdentities};
 if(name==='./customer-machines')return {__esModule:true,default:CustomerMachines};
 if(name==='./mobile-navigation')return {__esModule:true,default:MobileNavigation};
 if(name==='./customer-visits')return {VisitsPage,CustomerVisitDialog,CustomerVisitHistory};
 if(name==='./customer-followups')return {CustomerFollowupsPage,CustomerFollowupDialog};
 if(name==='./customer-journey-map')return {__esModule:true,default:CustomerMap};
 if(name==='./offline-status')return {__esModule:true,default:OfflineStatus};
 if(name==='./my-targets')return {__esModule:true,default:MyTargets};
 if(name==='./region-picker')return load('app/region-picker.tsx',commonRequire);
 if(name==='./support-panel')return new Proxy({useSupport:()=>({data:null,refresh:async()=>{},byCustomer:{},canRequest:()=>false,badge:0})},{get:(target,key)=>target[key]||pass});
 if(name==='./complaints-panel')return new Proxy({useComplaints:()=>({data:null,refresh:async()=>{},forCustomer:()=>[],badge:0})},{get:(target,key)=>target[key]||pass});
 if(name==='@/components/ui/sidebar')return new Proxy({useSidebar:()=>({setOpenMobile:noop})},{get:(target,key)=>target[key]||pass});
 if(name==='sonner')return {Toaster:pass,toast:{success:noop,error:noop}};
 if(name.endsWith('.css'))return {};return mocks;
}
function nodes(tree,predicate){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(node=>nodes(node,predicate));tree=expandVoiceFields(tree);return [...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate),...nodes(tree.props?.actions,predicate),...nodes(tree.props?.filters,predicate)];}
const VoiceFieldStub=makeVoiceField(value=>i18n.t(value));
function text(tree){if(tree===null||tree===undefined||typeof tree==='boolean')return '';if(typeof tree!=='object')return String(tree);return Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);}
const button=(tree,label)=>nodes(tree,node=>node.type==='button'&&text(node).trim()===label)[0];
const byClass=(tree,className)=>nodes(tree,node=>node.props?.className?.split(' ').includes(className))[0];
function stateNames(filename){const source=ts.createSourceFile(filename,fs.readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),names=[];function visit(node){if(ts.isVariableDeclaration(node)&&ts.isArrayBindingPattern(node.name)&&node.initializer&&ts.isCallExpression(node.initializer)&&node.initializer.expression.getText(source)==='useState')names.push(node.name.elements[0].name.getText(source));ts.forEachChild(node,visit);}visit(source);return names;}
class FakeDetails{constructor(parentElement=null){this.parentElement=parentElement;this.open=false;}}
function harness(seed={},options={}){
 const filename='app/crm-app.tsx',names=stateNames(filename),state={...seed},refs=[],effects=[];let cursor=0,refCursor=0;
 const hooks={...React,useState(initial){const name=names[cursor++];if(!Object.hasOwn(state,name))state[name]=typeof initial==='function'?initial():initial;return[state[name],value=>{state[name]=typeof value==='function'?value(state[name]):value;}];},useRef(value){const index=refCursor++;return refs[index]||(refs[index]={current:value});},useEffect:callback=>effects.push(callback),useCallback:callback=>callback,useMemo:callback=>callback()};
 const component=load(filename,name=>name==='react'?hooks:options.modules?.[name]||commonRequire(name),{window:{history:{replaceState:noop}},HTMLDetailsElement:FakeDetails,...options.globals}).default;
 return {state,effects,render(){cursor=refCursor=0;effects.length=0;return component({});}};
}
const me={id:'rep-west',name:'مندوب الغربية',email:'rep@yourrest.org',role:'rep',regionScope:'western',branch:'HQ',active:1,target:0};
const fixture=(id,name,code,assignedTo=me.id)=>({id,kind:'customer',parentId:null,assignedTo,branch:'HQ',data:{name,code,region:'الغربية',city:id==='one'?'جدة':'مكة',address:id==='one'?'طريق الملك عبدالعزيز':'حي النور',contact:id==='one'?'أحمد إبراهيم':'خالد منصور',contact2:id==='one'?'ياسر حسن':'محمود سالم',phone:id==='one'?'0501234567':'0559999999',phone2:id==='one'?'0542223333':'0568887777',_masterReadOnly:true},createdAt:'2026-09-30T08:00:00Z',updatedAt:'2026-09-30T08:00:00Z',version:1});
const records=[fixture('one','مصنع أَفْلاك','C123'),fixture('two','مصنع الساحل','C456','other-rep')];
for(const locale of ['ar','en']){
 language=locale;const h=harness({me,members:[me],records,loading:false,view:'customer',compactNavigation:true,staffFilter:'stale-other'});
 let tree=h.render(),filters=byClass(tree,'mobile-friendly-filters'),toggle=byClass(filters,'mobile-filter-toggle');
 eq(toggle.props['aria-expanded'],false,'Phone filter starts collapsed');eq(nodes(filters,node=>node.props?.id==='crm-page-filters')[0].props.hidden,true,'Collapsed filter fields are hidden');
 eq(nodes(filters,node=>node.props?.label===tr('المندوب')).length,0,'Rep has no staff selector even with stale staff state');
 eq(nodes(tree,node=>node.type===CustomerMachines)[0].props.customers.length,2,'Rep directory ignores stale staff filter within server supplied regional data');
 eq(text(toggle),locale==='ar'?'فلترة':'Filters','Filter action is localized');
 toggle.props.onClick();tree=h.render();filters=byClass(tree,'mobile-friendly-filters');
 eq(byClass(filters,'mobile-filter-toggle').props['aria-expanded'],true,'Filter tap expands');eq(nodes(filters,node=>node.props?.id==='crm-page-filters')[0].props.hidden,false,'Expanded fields become available');
 const search=nodes(filters,node=>node.type==='input'&&node.props.type==='search')[0];ok(search,'Rep Clients search is available');
 search.props.onChange({target:{value:'افلاك'}});tree=h.render();eq(nodes(tree,node=>node.type===CustomerMachines)[0].props.customers.map(row=>row.id).join(','),'one','Rep Clients search filters authorized directory');
 h.state.regionFilter='الغربية';h.state.stageFilter='quoted';tree=h.render();filters=byClass(tree,'mobile-friendly-filters');
 button(filters,locale==='ar'?'مسح الفلاتر':'Clear filters').props.onClick();
 eq(h.state.q,'افلاك','Clear filters preserves Clients search');eq(h.state.regionFilter,'all','Region filter resets');eq(h.state.stageFilter,'all','Sales stage filter resets');eq(h.state.staffFilter,'all','Stale staff filter resets safely');
 tree=h.render();filters=byClass(tree,'mobile-friendly-filters');nodes(filters,node=>node.type==='button'&&node.props['aria-label']===tr('مسح البحث'))[0].props.onClick();eq(h.state.q,'','Rep can clear Clients search');eq(h.state.filtersOpen,true,'Search clear keeps filter disclosure state');
 tree=h.render();nodes(tree,node=>node.type===MobileNavigation)[0].props.onNavigate('activity');eq(h.state.filtersOpen,false,'Page change collapses filters');
 tree=h.render();filters=byClass(tree,'mobile-friendly-filters');eq(nodes(filters,node=>node.props?.label===tr('المندوب')).length,0,'Rep visit filters also hide staff');ok(nodes(filters,node=>node.props?.label===tr('مرحلة البيع')).length===1,'Rep can filter own visit sales stage');
 h.state.view='customer';tree=h.render();button(tree,tr('إضافة عميل')).props.onClick();tree=h.render();
 let form=nodes(tree,node=>node.type==='form')[0],extra=byClass(form,'customer-extra-fields');
 eq(h.state.form.kind,'customer','Directory action opens customer creation');eq(extra.props.open,false,'Rep optional customer fields start collapsed');eq(text(nodes(extra,node=>node.type==='summary')[0]),locale==='ar'?'بيانات إضافية للعميل':'Additional customer details','Optional fields summary localized');
 const insideOptional=new Set(nodes(extra,()=>true)),labels=nodes(form,node=>node.type==='label');
 const name=labels.find(node=>text(node).startsWith(tr('اسم المصنع'))),nameInput=nodes(name,node=>node.type==='input')[0];
 eq(nameInput.props.required,true,'Factory name stays required');eq(insideOptional.has(name),false,'Required factory name remains immediately visible');
 const region=nodes(form,node=>typeof node.type==='function'&&node.type.name==='CustomerRegionField')[0];eq(insideOptional.has(region),false,'Region stays outside optional details');
 const regionField=region.type(region.props);eq(regionField.props.disabled,true,'Rep cannot change assigned region');const selectedRegion=nodes(regionField,node=>node.type==='input'&&node.props.type==='radio'&&node.props.checked);eq(selectedRegion.map(node=>node.props.value).join(','),'الغربية','Assigned region remains visible');
 const phone=labels.find(node=>text(node)===tr('الجوال'));eq(nodes(phone,node=>node.type==='input')[0].props.type,'tel','Phone uses the dial keyboard hint');eq(insideOptional.has(phone),false,'Phone stays in short customer form');
 const code=labels.find(node=>text(node)===(locale==='ar'?'كود العميل في ERP':'Customer ERP code'));ok(insideOptional.has(code),'Customer code remains accessible inside optional details');
 eq(labels.some(node=>text(node).includes(tr('المندوب المسؤول'))),false,'Rep form exposes no assignment override');
 nameInput.props.onChange({target:{value:'مصنع جديد'}});eq(h.state.formDirty,true,'Changing input marks unsaved customer draft');tree=h.render();form=nodes(tree,node=>node.type==='form')[0];button(form,tr('إلغاء')).props.onClick();
 eq(h.state.discardForm,true,'Cancel requests explicit discard confirmation');eq(h.state.form.data.name,'مصنع جديد','Cancel retains the entire draft');
 tree=h.render();let alert=nodes(tree,node=>node.type===AlertDialog&&node.props.open)[0];ok(alert,'Discard alert opens');alert.props.onOpenChange(false);eq(h.state.discardForm,false,'Keep editing dismisses confirmation');eq(h.state.form.data.name,'مصنع جديد','Keeping draft does not reset its content');
 tree=h.render();nodes(tree,node=>node.type===Dialog&&node.props.open)[0].props.onOpenChange(false);eq(h.state.discardForm,true,'Dialog dismissal also protects dirty draft');
 tree=h.render();alert=nodes(tree,node=>node.type===AlertDialog&&node.props.open)[0];nodes(alert,node=>node.type===AlertDialogAction)[0].props.onClick();eq(h.state.form,null,'Explicit discard finally closes');eq(h.state.formDirty,false,'Discard clears dirty flag');eq(h.state.discardForm,false,'Discard closes confirmation');
 tree=h.render();button(tree,tr('إضافة عميل')).props.onClick();tree=h.render();nodes(tree,node=>node.type===Dialog&&node.props.open)[0].props.onOpenChange(false);eq(h.state.form,null,'Untouched draft can close directly');
 tree=h.render();button(tree,tr('إضافة عميل')).props.onClick();h.state.busy=true;tree=h.render();nodes(tree,node=>node.type===Dialog&&node.props.open)[0].props.onOpenChange(false);ok(h.state.form,'Busy save cannot be dismissed');
 h.state.busy=false;tree=h.render();form=nodes(tree,node=>node.type==='form')[0];const outer=new FakeDetails(),inner=new FakeDetails(outer);form.props.onInvalidCapture({target:{parentElement:inner}});eq(inner.open,true,'Validation reveals inner optional field');eq(outer.open,true,'Validation reveals enclosing optional section');
 h.state.offline=true;tree=h.render();const offline=nodes(tree,node=>node.type===OfflineStatus)[0];eq(offline.props.offline,true,'Durable offline queue status receives connection state');eq(offline.props.me.id,me.id,'Offline state remains scoped to the signed-in rep');
}
// Exercise root-to-child contracts on both responsive render branches. Records deliberately
// have no read-only flags: reps may correct customers; visits and machines stay protected.
const ownCustomer={...records[0],data:{...records[0].data,_masterReadOnly:undefined,location:'21.5,39.2'}};
const ownMachine={...ownCustomer,id:'own-machine',kind:'factory',parentId:ownCustomer.id,data:{name:'Machine 1',machineType:'mobile'}};
const ownVisit={...ownCustomer,id:'own-visit',kind:'activity',parentId:ownCustomer.id,data:{type:'visit',visitNumber:12,summary:'تعريف بمنتجات الشركة',result:'اتفقنا على المتابعة',date:'2026-09-30',performedBy:me.id,salesStage:'new',nextAction:'اتصال',nextDate:'2026-10-01'}};
const ownFollowup={...ownVisit,id:'own-followup',data:{...ownVisit.data,visitWorkflow:'followup-v1',result:'نتيجة المتابعة'}};
const ownRecords=[ownCustomer,ownMachine,ownVisit,ownFollowup];
const child=(tree,type)=>nodes(tree,node=>node.type===type)[0];
const deniedAction=node=>node.type==='button'&&/تعديل|تصدير|حذف|\bEdit\b|\bExport\b|\bDelete\b/i.test(text(node)+' '+(node.props['aria-label']||'')+' '+(node.props.title||''));
for(const locale of ['ar','en'])for(const compactNavigation of [true,false]){
 language=locale;const context=locale+' '+(compactNavigation?'compact':'desktop');
 for(const view of ['customer','map','activity','followup','targets']){
  const h=harness({me,members:[me],records:ownRecords,loading:false,view,compactNavigation,q:view==='customer'?'':'unmatched hidden query',staffFilter:'stale-user'});let tree=h.render();
  const workspace=byClass(tree,'workspace');
  eq(nodes(workspace,node=>node.type==='input'&&node.props.type==='search').length,view==='customer'?1:0,context+' '+view+' permits rep general search only on Clients');
  eq(nodes(workspace,deniedAction).length,0,context+' '+view+' has no root export/edit/delete controls');
  eq(!!child(tree,MobileNavigation),compactNavigation,context+' chooses expected navigation branch');
  if(view==='customer'){
   const directory=child(tree,CustomerMachines);eq(directory.props.canEdit,false,context+' directory denies changes to own unflagged saved rows');eq(directory.props.customers.length,1,context+' Clients shows supplied customer with empty search');
   directory.props.onEdit(ownCustomer);eq(h.state.form.row.id,ownCustomer.id,context+' customer edit opens the authorized correction form');h.state.form=null;
   directory.props.onAddMachine(ownCustomer.id);eq(h.state.form,null,context+' root rejects a retained Add machine callback');
   directory.props.onOpen(ownCustomer.id);tree=h.render();eq(h.state.detailId,ownCustomer.id,context+' customer details remain available');
   const detail=byClass(tree,'detail-actions');eq(nodes(detail,deniedAction).map(text).join(','),tr('تعديل'),context+' customer card allows correction but not deletion or export');
   ok(text(byClass(tree,'detail-grid')).includes(ownCustomer.data.name)||text(tree).includes(ownCustomer.data.name),context+' existing customer data remains readable');
   const history=child(tree,CustomerVisitHistory);eq(history.props.canEdit,false,context+' history is explicitly view-only');
   history.props.onVisit(ownVisit);tree=h.render();eq(child(tree,CustomerVisitDialog).props.initial.id,ownVisit.id,context+' history opens the existing visit reader');
   child(tree,CustomerVisitDialog).props.onClose();tree=h.render();child(tree,CustomerMachines).props.onOpen(ownCustomer.id);tree=h.render();
   button(byClass(tree,'detail-actions'),tr('تسجيل زيارة')).props.onClick();tree=h.render();eq(child(tree,CustomerVisitDialog).props.initial,undefined,context+' customer card can still create a visit');eq(child(tree,CustomerVisitDialog).props.customerId,ownCustomer.id,context+' new visit keeps selected customer');
   child(tree,CustomerVisitDialog).props.onClose();tree=h.render();child(tree,CustomerMachines).props.onOpen(ownCustomer.id);tree=h.render();
   eq(button(byClass(tree,'detail-actions'),tr('تسجيل متابعة')),undefined,context+' customer has no independent follow-up creation');
   button(tree,tr('إضافة عميل')).props.onClick();eq(h.state.form.kind,'customer',context+' rep retains new customer creation');eq(h.state.form.row,undefined,context+' rep customer action creates a new row');
  }
  if(view==='activity'){
   const visits=child(tree,VisitsPage);eq(visits.props.query,'',context+' visit list ignores stale search');eq(visits.props.canEdit,false,context+' visit table inherits no-edit permission');
   visits.props.onOpen(ownVisit);tree=h.render();eq(child(tree,CustomerVisitDialog).props.initial.id,ownVisit.id,context+' View details opens own existing visit');
   child(tree,CustomerVisitDialog).props.onClose();tree=h.render();child(tree,VisitsPage).props.onNew();tree=h.render();eq(child(tree,CustomerVisitDialog).props.initial,undefined,context+' visit list still creates new visits');
   child(tree,CustomerVisitDialog).props.onClose();tree=h.render();child(tree,VisitsPage).props.onOpen(ownFollowup);tree=h.render();eq(child(tree,CustomerFollowupDialog).props.initial.id,ownFollowup.id,context+' followup entry in visits opens its reader');
  }
  if(view==='followup'){
   const followups=child(tree,CustomerFollowupsPage);eq(followups.props.query,'',context+' followup list ignores stale search');
   followups.props.onOpen(ownFollowup);tree=h.render();eq(child(tree,CustomerFollowupDialog).props.initial.id,ownFollowup.id,context+' followup history opens existing details');
   child(tree,CustomerFollowupDialog).props.onClose();tree=h.render();child(tree,CustomerFollowupsPage).props.onNew(ownCustomer.id,ownFollowup.id);tree=h.render();eq(child(tree,CustomerFollowupDialog).props.initial,undefined,context+' followup page retains create action');eq(child(tree,CustomerFollowupDialog).props.customerId,ownCustomer.id,context+' followup create is seeded correctly');
  }
  if(view==='map'){
   const map=child(tree,CustomerMap);eq(map.props.customers.length,1,context+' map keeps customers despite hidden stale general search');eq(map.props.onOpen,undefined,context+' map receives no saved-record editor');eq(map.props.onVisit,undefined,context+' map remains separate from visit entry');
  }
  if(view==='targets')eq(child(tree,MyTargets).props.me.id,me.id,context+' personal targets remain available');
 }
 // Search the actual customer directory through its input, using contrasting customers
 // so a no-op filter cannot pass. The server-authorized input is the only search corpus.
 {
  const h=harness({me,members:[me],records,loading:false,view:'customer',compactNavigation,staffFilter:'stale-user'});let tree=h.render();
  const search=()=>nodes(byClass(tree,'mobile-friendly-filters'),node=>node.type==='input'&&node.props.type==='search')[0];
  eq(search().props['aria-label'],tr('بحث في السجلات'),context+' Clients search has a localized accessible label');
  eq(search().props.placeholder,locale==='ar'?'ابحث باسم العميل أو رقمه أو الجوال أو المدينة':'Search customer name, code, phone or city',context+' Clients search explains customer fields');
  const collapsedFields=nodes(tree,node=>node.props?.id==='crm-page-filters')[0];eq(nodes(collapsedFields,node=>node===search()).length,0,context+' Clients search remains outside collapsible filters');
  const before=JSON.stringify(records);
  const cases=[
   ['افلاك','one','normalized Arabic factory name'],['c١٢٣','one','customer code and Arabic digits'],['C۴۵۶','two','customer code and Persian digits'],
   ['0501234567','one','primary phone'],['+966 50 123 4567','one','international Saudi phone equivalent'],['٠٥٤٢٢٢٣٣٣٣','one','secondary phone with Arabic digits'],
   ['جدة','one','city'],['طريق الملك عبدالعزيز','one','address'],['احمد ابراهيم','one','primary contact'],['محمود سالم','two','secondary contact'],
   ['افلاك جدة','one','terms across name and city'],['الساحل مكة','two','another customer across fields'],
   ['UniqueCustomerOutsideAuthorizedData','','customer absent from authorized records'],['no-match-987654321','','no match'],
   ['   ','one,two','whitespace query without hiding customers'],['no-match-after-space','','a new unmatched query after whitespace'],
  ];
  for(const [query,ids,label] of cases){search().props.onChange({target:{value:query}});tree=h.render();eq(child(tree,CustomerMachines).props.customers.map(row=>row.id).join(','),ids,context+' rep Clients finds '+label);}
  nodes(tree,node=>node.type==='button'&&node.props['aria-label']===tr('مسح البحث'))[0].props.onClick();tree=h.render();eq(child(tree,CustomerMachines).props.customers.length,2,context+' clearing no-match search restores all authorized customers');
  eq(nodes(tree,node=>node.type==='button'&&node.props['aria-label']===tr('مسح البحث')).length,0,context+' empty search has no redundant clear action');
  eq(JSON.stringify(records),before,context+' searching does not mutate saved customer details');
  eq(child(tree,CustomerMachines).props.canEdit,false,context+' search never enables saved customer editing');eq(byClass(tree,'page-export-action'),undefined,context+' search never enables export');
  const batch=Array.from({length:12},(_,index)=>fixture('batch-'+index,'مصنع الاختبار '+index,'BATCH-'+index));
  const bulk=harness({me,members:[me],records:batch,loading:false,view:'customer',compactNavigation});let bulkTree=bulk.render();
  nodes(bulkTree,node=>node.type==='input'&&node.props.type==='search')[0].props.onChange({target:{value:'الاختبار'}});bulkTree=bulk.render();eq(child(bulkTree,CustomerMachines).props.customers.length,12,context+' Clients search returns every match rather than the map suggestion limit');
 }
 // Supervisors and managers retain the controls removed specifically from reps.
 for(const role of ['supervisor','manager']){
  const actor={...me,id:role,role},h=harness({me:actor,members:[actor,me],records:[...ownRecords,records[1]],loading:false,view:'customer',compactNavigation});let tree=h.render(),filters=byClass(tree,'mobile-friendly-filters');
  let search=nodes(filters,node=>node.type==='input'&&node.props.type==='search')[0];ok(search,context+' '+role+' retains general search');
  eq(nodes(filters,node=>node.props?.label===tr('المندوب')).length,1,context+' '+role+' retains staff filter');ok(byClass(tree,'page-export-action'),context+' '+role+' retains customer export');eq(child(tree,CustomerMachines).props.customers.length,2,context+' '+role+' initially sees both customer candidates');
  search.props.onChange({target:{value:'افلاك'}});tree=h.render();eq(child(tree,CustomerMachines).props.customers.map(row=>row.id).join(','),ownCustomer.id,context+' '+role+' Arabic name search ignores hamza and diacritics');
  nodes(byClass(tree,'mobile-friendly-filters'),node=>node.type==='input'&&node.props.type==='search')[0].props.onChange({target:{value:'١٢٣'}});tree=h.render();eq(child(tree,CustomerMachines).props.customers.length,1,context+' '+role+' Arabic digits match Latin customer code');
  h.state.regionFilter='الغربية';h.state.stageFilter='quoted';h.state.filtersOpen=true;tree=h.render();button(byClass(tree,'mobile-friendly-filters'),locale==='ar'?'مسح الفلاتر':'Clear filters').props.onClick();eq(h.state.q,'١٢٣',context+' '+role+' filter reset preserves active search');eq(h.state.regionFilter,'all',context+' '+role+' filter reset clears region');
  tree=h.render();nodes(byClass(tree,'mobile-friendly-filters'),node=>node.type==='button'&&node.props['aria-label']===tr('مسح البحث'))[0].props.onClick();eq(h.state.q,'',context+' '+role+' clear search works');eq(h.state.filtersOpen,true,context+' '+role+' clear search retains filter disclosure');
  tree=h.render();const directory=child(tree,CustomerMachines);eq(directory.props.canEdit,true,context+' '+role+' retains saved record edit permission');directory.props.onEdit(ownCustomer);eq(h.state.form.row.id,ownCustomer.id,context+' '+role+' customer Edit opens existing form');
  h.state.form=null;h.state.view='activity';tree=h.render();const visits=child(tree,VisitsPage);eq(visits.props.canEdit,true,context+' '+role+' visit edit permission retained');ok(byClass(tree,'page-export-action'),context+' '+role+' retains visit export');visits.props.onOpen(ownVisit);tree=h.render();eq(child(tree,CustomerVisitDialog).props.initial.id,ownVisit.id,context+' '+role+' opens existing visit');
 }
}

// Internal CRM identity is visible and immutable; reconciliation stays admin/all only.
for(const locale of ['ar','en'])for(const role of ['rep','supervisor','manager','admin'])for(const scope of ['western','all']){
 language=locale;const actor={...me,id:role,role,regionScope:scope},customer={...ownCustomer,data:{...ownCustomer.data,internalCode:'YR-C-000123',code:'ERP-456'}};
 const h=harness({me:actor,members:[actor],records:[customer],loading:false,view:'customer',compactNavigation:true});let tree=h.render();
 const link=button(tree,locale==='ar'?'ربط عملاء ERP':'Link ERP customers');eq(!!link,role==='admin'&&scope==='all','Only unrestricted administrator sees ERP reconciliation action');
 if(link){link.props.onClick();tree=h.render();ok(child(tree,CustomerIdentities),'Authorized reconciliation dialog opens');h.state.me={...actor,regionScope:'western'};tree=h.render();eq(child(tree,CustomerIdentities),undefined,'Scope loss unmounts administrative dialog');eq(child(tree,MobileNavigation).props.blocked,false,'Losing admin scope immediately unlocks mobile navigation even before effects run');h.state.me=actor;h.state.customerIdentitiesOpen=false;tree=h.render();}
 child(tree,CustomerMachines).props.onEdit(customer);tree=h.render();const internal=nodes(tree,node=>node.type==='input'&&node.props.value==='YR-C-000123')[0];ok(internal,'Customer editor displays permanent Yourrest code');eq(internal.props.readOnly,true,'Permanent code is not editable');eq(internal.props.onChange,undefined,'Permanent code has no mutation callback');
 const erp=nodes(tree,node=>node.type==='input'&&node.props.value==='ERP-456')[0];ok(erp.props.onChange,'External ERP code remains editable');erp.props.onChange({target:{value:'ERP-789'}});eq(h.state.form.data.code,'ERP-789');eq(h.state.form.data.internalCode,'YR-C-000123','ERP edit preserves permanent internal code');
 h.state.form=null;h.state.q='YR-C-000123';tree=h.render();eq(child(tree,CustomerMachines).props.customers.length,1,'Directory search matches permanent code');
}


// Session rejection executes the actual CRM reload and clearSession path.
for(const locale of ['ar','en']){
 language=locale;const admin={...me,id:'owner',role:'admin',regionScope:'all'};
 const h=harness({me:admin,members:[admin],records,loading:false,view:'customer',compactNavigation:true},{
  modules:{'@/lib/offline-store':{offlineSessionGeneration:()=>0,lockOfflineSession:async()=>{}},'@/lib/offline-auth':{isOfflineLogoutPending:()=>false}},
  globals:{navigator:{onLine:true},fetch:async()=>({ok:false,status:401,json:async()=>({error:'Session expired'})})},
 });
 let tree=h.render();button(tree,locale==='ar'?'ربط عملاء ERP':'Link ERP customers').props.onClick();tree=h.render();eq(child(tree,MobileNavigation).props.blocked,true,'Open administrative dialog blocks underlying mobile navigation');
 await child(tree,CustomerIdentities).props.onSaved();eq(h.state.customerIdentitiesOpen,false,'Session rejection clears administrative dialog state');eq(h.state.me,null,'Session rejection clears the previous administrator');
 h.state.me={...me};h.state.auth=false;h.state.records=records;tree=h.render();eq(child(tree,CustomerIdentities),undefined,'A later rep session never inherits an administrative dialog');eq(child(tree,MobileNavigation).props.blocked,false,'A later rep session can navigate normally');
 child(tree,MobileNavigation).props.onNavigate('activity');eq(h.state.view,'activity','Rep mobile tabs work after administrative session expiry');
}

console.log(JSON.stringify({ok:true,checks,type:'real CRM controlled interactions: rep Clients detail search with full results, no general search elsewhere, no export or visit edits, authorized customer correction, permitted readers and creation, manager controls, short customer creation, guarded discard, validation and offline notice; Arabic/English compact and desktop branches',realBrowser:false,network:false}));
