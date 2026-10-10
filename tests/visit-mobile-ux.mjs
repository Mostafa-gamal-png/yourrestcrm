// Exercise the actual visit/follow-up dialogs with controlled React hooks and requests.
// This verifies flows and payloads, not browser layout, soft keyboards or device GPS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';
const nativeRequire=createRequire(import.meta.url),root=process.cwd(),cache=new Map();
const compiler={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true};
const noop=()=>{};let checks=0,language='ar';
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const dictionary=JSON.parse(fs.readFileSync(path.join(root,'lib/locales/en.json'),'utf8'));
const i18n={t:value=>language==='en'&&typeof value==='string'?(dictionary[value]||value):value,useLanguage:()=>({language}),getLanguage:()=>language,direction:()=>language==='ar'?'rtl':'ltr'};
function compile(file){return ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:compiler}).outputText;}
function load(file,require,globals={}){const exports={};vm.runInNewContext(compile(file),{exports,require,console,crypto:globalThis.crypto,Intl,Date,performance,...globals});return exports;}
function library(file){if(cache.has(file))return cache.get(file);const result=load(file,name=>name==='./i18n'?i18n:name.startsWith('.')?library(path.join(path.dirname(file),name)+'.ts'):nativeRequire(name));cache.set(file,result);return result;}
const components=new Map();function component(name){if(!components.has(name))components.set(name,Object.defineProperty(({children})=>children||null,'name',{value:name}));return components.get(name);}
const ui=new Proxy({},{get:(_,key)=>component(key)});
function shared(name){if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;if(name==='@/lib/i18n')return i18n;if(name.startsWith('@/lib/'))return library(name.slice(2)+'.ts');if(name.endsWith('.css'))return {};if(name==='./competitor-fields')return {__esModule:true,default:component('CompetitorFields'),emptyCompetitorInput:()=>({hasCompetitor:false,competitorName:'',competitorNotes:'',competitorFileId:'',competitorFileName:''})};if(name==='./voice-field')return {__esModule:true,default:component('VoiceField')};if(name==='./visit-fields')return {__esModule:true,default:component('VisitFields'),FollowupDateField:component('FollowupDateField')};if(name==='./visit-customer-picker')return {__esModule:true,default:component('VisitCustomerPicker')};return ui;}
function nodes(tree,predicate){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(node=>nodes(node,predicate));return [...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];}
function text(tree){if(tree==null||typeof tree==='boolean')return '';if(typeof tree!=='object')return String(tree);return Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);}
const byClass=(tree,name)=>nodes(tree,node=>node.props?.className?.split(' ').includes(name));
const named=(tree,name)=>nodes(tree,node=>node.type?.name===name);
const button=(tree,label)=>nodes(tree,node=>node.type==='button'&&text(node).trim()===label)[0];
function stateNames(file,componentName){const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),names=[];function visit(node){if(ts.isVariableDeclaration(node)&&ts.isArrayBindingPattern(node.name)&&node.initializer&&ts.isCallExpression(node.initializer)&&node.initializer.expression.getText(ast)==='useState')names.push(node.name.elements[0].name.getText(ast));ts.forEachChild(node,visit);}visit(ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===componentName));return names;}
function harness(file,componentName,props={},seed={}){
 const state={...seed},names=stateNames(file,componentName),refs=[],effectDeps=[],pending=[],events=new EventTarget(),calls=[],journeys=[];let cursor=0,refCursor=0,effectCursor=0,tree,changed=false,closeCount=0,saved=0,status=200,responseMode='normal',stopId='tracked-stop',receipt='',commits=0;
 const hooks={...React,useMemo:factory=>factory(),useState(initial){const name=names[cursor++];if(!(name in state))state[name]=typeof initial==='function'?initial():initial;return[state[name],next=>{const value=typeof next==='function'?next(state[name]):next;if(!Object.is(value,state[name])){state[name]=value;changed=true;}}];},useRef(initial){const index=refCursor++;return refs[index]||(refs[index]={current:initial});},useEffect(effect,deps){const index=effectCursor++,previous=effectDeps[index];if(!previous||deps?.some((value,i)=>!Object.is(value,previous[i]))){effectDeps[index]=deps;pending.push(effect);}}};
 const trackedProps={records:[customer],members:[me],me,audits:[],onClose:()=>closeCount++,onSaved:async()=>saved++,onCustomerCreated:async()=>customer,onOpenVisit:noop,onNewVisit:noop,onOpenCustomer:noop,onOpenQuote:noop,onDelete:noop,onWorkflow:noop,...props};
 const fetch=async(url,config)=>{
  calls.push({url,body:JSON.parse(config.body),rawBody:config.body});
  if(responseMode==='lost-after-commit'){if(!receipt){receipt=config.body;commits++;}return{ok:false,status:503,json:async()=>({error:'Response lost after commit'})};}
  if(responseMode==='receipt-replay')return config.body===receipt?{ok:true,status:200,json:async()=>({ok:true,id:'saved-record',alreadySaved:true})}:{ok:false,status:409,json:async()=>({error:'Saved with a different fingerprint'})};
  if(responseMode==='html')return{ok:true,status:200,json:async()=>{throw new SyntaxError('Unexpected token <');}};
  if(responseMode==='unconfirmed')return{ok:true,status:200,json:async()=>({ok:true})};
  if(responseMode==='network')throw new TypeError('Connection lost');
  return {ok:status===200,status,json:async()=>status===200?{ok:true,id:'saved-record'}:{error:'Test save failed'}};
 };
 const submit=load('lib/client-submit.ts',shared,{fetch,window:events,AbortController,setTimeout,clearTimeout});
 // This form-only harness deliberately rejects before durable acceptance, to
 // retain the frozen-payload/error regression checks. Offline acceptance and
 // auto-close are exercised separately in offline-forms-ui.mjs.
 const offline={offlineSubmit:(url,body,options)=>submit.submitJson(url,{method:'POST',headers:{'Content-Type':'application/json'},body},options),uploadOfflineVisitFile:async()=>{throw Error('Upload not exercised here');}};
 const exports=load(file,name=>name==='react'?hooks:name==='@/lib/client-submit'?submit:name==='@/lib/offline-submit'?offline:name==='./journey-tracker'?{useAutomaticJourney:input=>{journeys.push(input);return()=>input.enabled?stopId:undefined;},JourneyFormNotice:component('JourneyFormNotice')}:shared(name),{window:events,navigator:{onLine:true},fetch,AbortController,requestAnimationFrame:callback=>{callback();return 1;},cancelAnimationFrame:noop});
 function render(){for(let guard=0;guard<10;guard++){changed=false;cursor=refCursor=effectCursor=0;tree=exports[componentName](trackedProps);for(const effect of pending.splice(0))effect();if(!changed)return tree;}throw Error('Render loop');}
 return {render,state,calls,journeys,props:trackedProps,closeCount:()=>closeCount,saved:()=>saved,status:value=>status=value,mode:value=>responseMode=value,journeyStop:value=>stopId=value,commits:()=>commits,submit:async()=>{await nodes(render(),node=>node.type==='form')[0].props.onSubmit({preventDefault:noop});return render();}};
}
const me={id:'rep',name:'Rep',role:'rep',email:'rep@yourrest.org',regionScope:'western',branch:'HQ',active:1};
const customer={id:'factory',kind:'customer',parentId:null,assignedTo:'rep',branch:'HQ',version:3,data:{name:'Factory',code:'F-1',region:'الغربية',location:'21.5,39.2',_masterReadOnly:true},createdAt:'2026-09-30T08:00:00Z',updatedAt:'2026-09-30T08:00:00Z'};
const visitFile='app/customer-visits.tsx',followupFile='app/customer-followups.tsx';
let h=harness(visitFile,'CustomerVisitDialog',{customerId:customer.id}),tree=h.render();
eq(byClass(tree,'visit-sales-details')[0].props.open,false,'New visit sales extras start collapsed');
eq(byClass(tree,'visit-context-details').every(node=>!node.props.open),true,'History and factory details no longer precede input as expanded content');
eq(byClass(tree,'visit-selected-summary').length,0,'Selected customer is not repeated after the picker');
const sections=byClass(tree,'visit-form-section');ok(text(sections[0]).includes('التواصل والنتيجة'));ok(text(sections[1]).includes('الخطوة الجاية'));
const footer=byClass(tree,'visit-save-bar')[0],scroll=byClass(tree,'visit-form-scroll')[0];eq(nodes(scroll,node=>node===footer).length,0,'Save is outside the single scrolling area');
eq(button(tree,'حفظ الزيارة').props.disabled,true,'Automatic location remains required');
named(tree,'VisitFields')[0].props.onLocationState({status:'error',error:'GPS failed'});tree=h.render();ok(text(byClass(tree,'visit-save-hint')).includes('GPS failed'),'GPS failure is visible beside Save, not hidden above the form');
const fields=named(tree,'VisitFields')[0];fields.props.onChange('location','21.5, 39.2');fields.props.onChange('locationCapturedAt','2026-09-30T08:00:00Z');tree=h.render();eq(h.state.dirty,false,'Automatic GPS capture does not create a fake unsaved draft');
for(const [key,value] of Object.entries({type:'call',summary:'متابعة عرض السعر',result:'متابعة العميل'}))named(tree,'VisitFields')[0].props.onChange(key,value);
named(tree,'VoiceField').find(node=>node.props.label==='الإجراء القادم').props.onChange('إرسال عرض السعر');tree=h.render();
h.state.data.nextDate='2026-10-01';tree=h.render();tree.props.onOpenChange(false);tree=h.render();eq(h.closeCount(),0,'Dismiss protects meaningful visit changes');ok(button(tree,'أكمل التسجيل'));button(tree,'أكمل التسجيل').props.onClick();tree=h.render();eq(h.state.confirmLeave,false);
h.status(503);await h.submit();eq(h.calls.length,1);eq(h.closeCount(),0,'Failed save keeps the form and draft');eq(h.state.error,'Test save failed');ok(byClass(h.render(),'visit-save-bar')[0].props.children,'Save failure stays beside the save action');
h.status(200);await h.submit();eq(h.calls.length,2);eq(h.calls[0].body.createKey,h.calls[1].body.createKey,'Retry keeps visit idempotency key');eq(h.calls[1].url,'/api/visits');eq(h.calls[1].body.customerVersion,3);eq(h.calls[1].body.timingMode,'automatic');eq(h.calls[1].body.data.journeyStopId,'tracked-stop');eq(h.calls[1].body.data.requestedProducts.length,0,'No sales need was declared, so no default product is submitted');eq(h.calls[1].body.data.nextAction,'إرسال عرض السعر');eq(h.calls[1].body.data.nextDate,'2026-10-01');eq(h.saved(),1);eq(h.closeCount(),1);
// Opening nested Add customer creates a protected draft even before selecting a customer.
for(const [file,name] of [[visitFile,'CustomerVisitDialog']]){const draft=harness(file,name);let view=draft.render();named(view,'VisitCustomerPicker')[0].props.onCreating(true);view=draft.render();view.props.onOpenChange(false);view=draft.render();eq(draft.closeCount(),0,name+' protects nested customer entry');ok(button(view,'خروج بدون حفظ'));button(view,'خروج بدون حفظ').props.onClick();eq(draft.closeCount(),1);}
const readOnly={id:'visit-old',kind:'activity',parentId:customer.id,assignedTo:me.id,version:2,createdAt:'2026-09-30T08:00:00Z',updatedAt:'2026-09-30T08:00:00Z',data:{_readOnly:true,type:'visit',visitNumber:12,requestedProducts:['قوالب البلوك المتحركة'],salesStage:'quoted',strength:'strong',nextAction:'Call',nextDate:'2026-10-01'}};
h=harness(visitFile,'CustomerVisitDialog',{initial:readOnly});tree=h.render();eq(button(tree,'حفظ التعديلات'),undefined,'Read-only visit cannot save');eq(byClass(tree,'visit-sales-details')[0].props.open,true,'Existing visit details are available on edit/view');eq(h.journeys.at(-1).enabled,false,'Viewing an existing visit never starts tracking');
// A rep's own existing visit is view-only even if the response has no _readOnly flag.
const ownVisit={...readOnly,data:{...readOnly.data,_readOnly:undefined,nextAction:'Original next step'}};
for(const locale of ['ar','en']){
 language=locale;let newVisits=0;
 const repView=harness(visitFile,'CustomerVisitDialog',{initial:ownVisit,onNewVisit:()=>newVisits++});let view=repView.render();
 eq(named(view,'VisitFields')[0].props.readOnly,true,'Existing rep visit is locked by role '+locale);
 eq(nodes(view,node=>node.type==='button'&&node.props.type==='submit').length,0,'Rep existing visit has no Save button '+locale);
 eq(nodes(view,node=>node.type==='button'&&/تعديل|حذف|Edit|Delete/i.test(text(node)+' '+(node.props['aria-label']||''))).length,0,'Rep existing visit has no Edit/Delete action '+locale);
 eq(byClass(view,'visit-form-fields')[0].props.disabled,true,'Existing rep fields are disabled '+locale);
 named(view,'VisitFields')[0].props.onChange('nextAction','Unexpected edit');view=repView.render();eq(repView.state.data.nextAction,'Original next step','Role guard also rejects a stale form callback '+locale);
 await repView.submit();eq(repView.calls.length,0,'Programmatic submit cannot bypass rep view-only mode '+locale);
 const history=named(view,'CustomerVisitHistory')[0];eq(history.props.canEdit,false,'Embedded history inherits rep no-edit permission '+locale);history.props.onNew();eq(newVisits,1,'New visit remains available from customer history '+locale);
 const repCreate=harness(visitFile,'CustomerVisitDialog',{customerId:customer.id});view=repCreate.render();eq(named(view,'VisitFields')[0].props.readOnly,false,'Rep new visit remains editable '+locale);ok(nodes(view,node=>node.type==='button'&&node.props.type==='submit').length===1,'Rep new visit retains Save '+locale);
}
for(const locale of ['ar','en']){
 language=locale;const viewed=[];const history=harness(visitFile,'CustomerVisitHistory',{customer,records:[customer,ownVisit],canEdit:false,onVisit:row=>viewed.push(row.id)});const view=history.render();const action=button(view,locale==='ar'?'عرض التفاصيل':'View details');ok(action,'Customer history displays view-only action '+locale);action.props.onClick();eq(viewed,[ownVisit.id],'History keeps opening the selected visit '+locale);eq(nodes(view,node=>node.type==='button'&&/تعديل|Edit/i.test(text(node))).length,0,'History does not advertise editing '+locale);
}
language='ar';const visitPage=harness(visitFile,'VisitsPage',{records:[customer,ownVisit],query:'',staff:'all',stage:'all',workflow:'all',onWorkflowFilter:noop,onOpen:noop,onNew:noop,onCustomer:noop,canEdit:false});eq(nodes(visitPage.render(),node=>Array.isArray(node.props?.rows))[0].props.canEdit,false,'Visits page forwards role permission to both table layouts');
language='ar';
for(const role of ['admin','supervisor','manager']){
 const managerView=harness(visitFile,'CustomerVisitDialog',{initial:ownVisit,me:{...me,role}});const view=managerView.render();eq(named(view,'VisitFields')[0].props.readOnly,false,role+' can still edit existing authorized visit');ok(button(view,'حفظ التعديلات'),role+' retains save');ok(nodes(view,node=>node.type==='button'&&node.props['aria-label']==='حذف الزيارة').length===1,role+' retains existing delete action');
}
h=harness(followupFile,'CustomerFollowupDialog',{customerId:customer.id,records:[customer,{...ownVisit,data:{...ownVisit.data,salesStage:'new'}}]});tree=h.render();eq(byClass(tree,'visit-sales-details')[0].props.open,false);named(tree,'VoiceField').find(node=>node.props.label==='ما نتيجة المتابعة؟').props.onChange('وافق العميل على المتابعة');named(tree,'VoiceField').find(node=>node.props.label==='الإجراء القادم').props.onChange('إرسال المواصفات');h.state.data.nextDate='2026-10-02';h.status(503);await h.submit();h.status(200);await h.submit();eq(h.calls.length,2);eq(h.calls[0].body.createKey,h.calls[1].body.createKey,'Follow-up retry keeps create key');eq(h.calls[1].url,'/api/customer-followups');eq(h.calls[1].body.data.journeyStopId,'tracked-stop');eq(h.calls[1].body.data.result,'وافق العميل على المتابعة');eq(h.calls[1].body.data.nextAction,'إرسال المواصفات');eq(h.saved(),1);eq(h.closeCount(),1);
eq(h.calls[1].body.sourceId,ownVisit.id,'Follow-up preserves previous contact link');eq(h.calls[1].body.sourceVersion,ownVisit.version,'Follow-up locks previous contact version');eq(named(tree,'VisitCustomerPicker').length,0,'Execution cannot select another customer');
const unplanned=harness(followupFile,'CustomerFollowupDialog',{customerId:customer.id});await unplanned.submit();eq(unplanned.calls.length,0,'No previous plan cannot save');eq(unplanned.journeys.at(-1).enabled,false,'No previous plan cannot start tracking');
ok(text(unplanned.render()).includes('المتابعة تحتاج زيارة سابقة مفتوحة'),'Disabled follow-up explains the missing previous plan');
const missingCustomer=harness(visitFile,'CustomerVisitDialog');ok(text(missingCustomer.render()).includes('اختر العميل أولًا'),'Disabled new visit explains customer selection');await missingCustomer.submit();eq(missingCustomer.calls.length,0,'No customer is never submitted');
for(const [file,name] of [[visitFile,'CustomerVisitDialog'],[followupFile,'CustomerFollowupDialog']]){
 let refreshFails=true;const saved=harness(file,name,{customerId:customer.id,records:[customer,{...ownVisit,data:{...ownVisit.data,salesStage:'new'}}],onSaved:async()=>{if(refreshFails)throw Error('Refresh failed');}});
 saved.render();
 if(file===visitFile)Object.assign(saved.state.data,{location:'21.5, 39.2',locationCapturedAt:'2026-10-01T09:00:00Z'});
 await saved.submit();eq(saved.calls.length,1,name+' submits once before refresh failure');ok(button(saved.render(),'تحديث السجل'),name+' offers refresh instead of a new save');eq(byClass(saved.render(),'visit-form-scroll')[0].props.disabled,true,name+' locks already saved entries');
 refreshFails=false;await saved.submit();eq(saved.calls.length,1,name+' refresh retry does not write a second visit');eq(saved.closeCount(),1,name+' closes after refresh recovery');
}
// Lost confirmations freeze the exact wire body: late routes/GPS/version changes cannot drift retries.
for(const [file,name,actor] of [[visitFile,'CustomerVisitDialog',me],[visitFile,'CustomerVisitDialog',{...me,role:'customer_service'}],[followupFile,'CustomerFollowupDialog',me]]){
 for(const mode of ['lost-after-commit','html','unconfirmed','network']){
  const pending=harness(file,name,{customerId:customer.id,me:actor,records:[customer,{...ownVisit,data:{...ownVisit.data,salesStage:'new'}}]});pending.render();
  if(file===visitFile)Object.assign(pending.state.data,{location:'21.5, 39.2',locationCapturedAt:'2026-10-01T09:00:00Z'});
  pending.journeyStop(undefined);pending.mode(mode);await pending.submit();const original=pending.calls[0].rawBody;
  eq(pending.state.retryPending,true,name+' locks ambiguous '+mode);eq(byClass(pending.render(),'visit-form-scroll')[0].props.disabled,true);ok(button(pending.render(),'تأكيد الحفظ'));
  const before=pending.state.data.result,view=pending.render();const callback=file===visitFile?named(view,'VisitFields')[0].props.onChange:(_key,value)=>named(view,'VoiceField').find(node=>node.props.label==='ما نتيجة المتابعة؟').props.onChange(value);callback('result','Unexpected changed result');eq(pending.state.data.result,before,'Ambiguous entries reject stale editing callbacks');
  pending.journeyStop('late-route');pending.props.records=[{...customer,version:99},...pending.props.records.slice(1)];pending.state.data={...pending.state.data,location:'24.7,46.6',locationCapturedAt:'2026-10-01T12:00:00Z'};
  pending.mode(mode==='lost-after-commit'?'receipt-replay':'normal');await pending.submit();eq(pending.calls[1].rawBody,original,'Retry preserves exact body, key, time, coordinates and absent journey link');eq(pending.closeCount(),1);eq(pending.state.retryPending,false);
  if(mode==='lost-after-commit')eq(pending.commits(),1,'Response loss and retry create exactly one record');
 }
 const rejected=harness(file,name,{customerId:customer.id,me:actor,records:[customer,{...ownVisit,data:{...ownVisit.data,salesStage:'new'}}]});rejected.render();if(file===visitFile)Object.assign(rejected.state.data,{location:'21.5,39.2',locationCapturedAt:'2026-10-01T09:00:00Z'});rejected.status(400);await rejected.submit();eq(rejected.state.retryPending,false,'Canonical validation rejection permits correction');eq(byClass(rejected.render(),'visit-form-scroll')[0].props.disabled,false);rejected.state.data.result='Corrected result';rejected.status(200);await rejected.submit();eq(rejected.calls[1].body.data?.result||rejected.calls[1].body.registration?.result,'Corrected result');
}
// Date shortcuts call the same data update as manual input, with local-day-safe date arithmetic.
const dateModule=load('app/visit-fields.tsx',shared);let chosen='';tree=dateModule.FollowupDateField({value:'',onChange:value=>chosen=value});button(tree,'بكرة').props.onClick();const today=library('lib/crm.ts').today(),tomorrow=new Date(today+'T12:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);eq(chosen,tomorrow.toISOString().slice(0,10));
language='en';tree=harness(visitFile,'CustomerVisitDialog',{customerId:customer.id}).render();ok(text(tree).includes('Contact & outcome'));ok(text(tree).includes('Next step'));ok(text(tree).includes('Sales & products'));ok(!text(tree).includes('الخطوة الجاية'));tree=dateModule.FollowupDateField({value:'',onChange:noop});ok(button(tree,'Tomorrow'));language='ar';
// Competitors page opens the standard form with explicit, editable prefill only.
const competitorVisit={...ownVisit,id:'competitor-visit',data:{...ownVisit.data,hasCompetitor:true,competitorName:'شركة المثال'}};
const seeded=harness(visitFile,'CustomerVisitDialog',{customerId:customer.id,showCompetitor:true,competitorName:'شركة المثال',records:[customer,competitorVisit]});
let competitorTree=seeded.render();eq(seeded.state.data.hasCompetitor,true,'Competitor entry opens enabled');eq(seeded.state.data.competitorName,'شركة المثال','Selected competitor is prefilled');eq(seeded.state.salesOpen,true,'Competitor fields are visible immediately');
const competitorFields=named(competitorTree,'CompetitorFields')[0];ok(competitorFields,'Standard visit uses the shared accessible competitor fields');eq(competitorFields.props.records,seeded.props.records,'Suggestions receive the authorized records only');eq(competitorFields.props.customerId,customer.id,'Suggestions prioritize the selected customer');eq(competitorFields.props.value.competitorName,'شركة المثال','Previous visible competitor is provided to the shared fields');competitorFields.props.onChange({competitorName:'منافس جديد'});eq(seeded.state.data.competitorName,'منافس جديد','Prefill remains editable');
const savedCompetitor=harness(visitFile,'CustomerVisitDialog',{initial:competitorVisit,competitorName:'Ignored seed',showCompetitor:true,records:[customer,competitorVisit]});savedCompetitor.render();eq(savedCompetitor.state.data.competitorName,'شركة المثال','Persisted visit wins over seeds');
const noCompetitor=harness(visitFile,'CustomerVisitDialog',{customerId:customer.id});noCompetitor.render();eq(noCompetitor.state.data.hasCompetitor,false,'Normal visit default unchanged');
// A follow-up records fresh evidence only; its source's notes and attachment are never inherited.
const sourceWithCompetitor={...competitorVisit,data:{...competitorVisit.data,salesStage:'new',competitorNotes:'Previous observation',competitorFileId:'previous-private-file',competitorFileName:'previous.pdf'}};
const freshFollowup=harness(followupFile,'CustomerFollowupDialog',{customerId:customer.id,records:[customer,sourceWithCompetitor]});let followupView=freshFollowup.render();let followupFields=named(followupView,'CompetitorFields')[0];eq(freshFollowup.state.data.competitorObservation,null,'New follow-up makes no competitor assertion by default');eq(followupFields.props.value.hasCompetitor,false);eq(followupFields.props.value.competitorNotes,'');eq(followupFields.props.value.competitorFileId,'');eq(followupFields.props.records,freshFollowup.props.records,'Follow-up uses the same authorized suggestion scope');
followupFields.props.onChange({hasCompetitor:true,competitorName:'شركة المثال',competitorNotes:'Observed today'});followupView=freshFollowup.render();followupFields=named(followupView,'CompetitorFields')[0];eq(followupFields.props.value.competitorNotes,'Observed today');eq(followupFields.props.value.competitorFileId,'','Choosing a prior name does not copy a prior attachment');freshFollowup.mode('network');await freshFollowup.submit();const evidenceBody=freshFollowup.calls[0].rawBody;eq(freshFollowup.calls[0].body.data.competitorObservation.competitorNotes,'Observed today');eq(freshFollowup.calls[0].body.sourceId,sourceWithCompetitor.id,'Competitor evidence keeps its follow-up source link');followupFields=named(freshFollowup.render(),'CompetitorFields')[0];eq(followupFields.props.disabled,true,'Uncertain follow-up save locks competitor controls');followupFields.props.onChange({competitorNotes:'Late dictation'});eq(freshFollowup.state.data.competitorObservation.competitorNotes,'Observed today','Late competitor callback cannot alter uncertain save');freshFollowup.mode('normal');await freshFollowup.submit();eq(freshFollowup.calls[1].rawBody,evidenceBody,'Retry retains the exact competitor observation');
const savedFollowup=harness(followupFile,'CustomerFollowupDialog',{initial:{...sourceWithCompetitor,data:{...sourceWithCompetitor.data,visitWorkflow:'followup-v1'}},records:[customer,sourceWithCompetitor]});const savedFields=named(savedFollowup.render(),'CompetitorFields')[0];eq(savedFields.props.readOnly,true,'Saved follow-up evidence remains read-only');eq(savedFields.props.value.competitorFileId,'previous-private-file','Saved follow-up retains its own private attachment');
console.log(JSON.stringify({ok:true,checks,coverage:'actual visit/follow-up forms: compact sections, unchanged payloads, retry keys, native journey linkage, save errors, read-only access, nested unsaved drafts, AR/EN and quick dates',realBrowser:false,realDevice:false}));
