// Controlled React interaction checks; no claim of real browser or layout coverage.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
let checks=0;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const ok=(a,label)=>{assert.ok(a,label);checks++;};
const compiler={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true};
function module(file,require,globals={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:compiler}).outputText,{exports,require,console,crypto:globalThis.crypto,Error,TypeError,AbortController,setTimeout,clearTimeout,...globals});return exports;}
const search=module('lib/customer-map-search.ts').searchMapCustomers;
const customer={id:'one',kind:'customer',data:{name:'مصنع الاختبار',code:'ERP-42',internalCode:'YR-C-000001'}};
eq(Array.from(search([customer],'YR-C-000001'),r=>r.id),['one'],'Map and customer directory find the new internal code');
eq(Array.from(search([customer],'ERP-42'),r=>r.id),['one'],'Existing ERP code remains searchable');
const pass=({children})=>children,noop=()=>{};
function nodes(tree,predicate){if(!tree||typeof tree!=='object')return[];if(Array.isArray(tree))return tree.flatMap(child=>nodes(child,predicate));return[...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];}
function text(tree){if(tree===null||tree===undefined||typeof tree==='boolean')return'';if(typeof tree!=='object')return String(tree);return Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);}
function Dialog(){}
class SubmitError extends Error{constructor(message,status=0,body=null){super(message);this.status=status;this.body=body;}}
const componentSource=ts.createSourceFile('identity.tsx',fs.readFileSync('app/customer-identities.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),stateNames=[];
function findState(node){if(ts.isVariableDeclaration(node)&&ts.isArrayBindingPattern(node.name)&&node.initializer&&ts.isCallExpression(node.initializer)&&node.initializer.expression.getText(componentSource)==='useState')stateNames.push(node.name.elements[0].name.getText(componentSource));ts.forEachChild(node,findState);}findState(componentSource);
const initial={revision:8,customers:[{id:'one',name:'مصنع الأول',internalCode:'YR-C-000001',erpCode:'ABC',region:'الغربية',version:3},{id:'two',name:'مصنع الثاني',internalCode:'YR-C-000002',erpCode:'abc',region:'الشرقية',version:4}],identities:[{codeKey:'ABC',sourceCodes:['ABC','abc'],customerIds:['one','two'],mappedCustomerId:null,mappingVersion:0,status:'ambiguous'},{codeKey:'MISSING',sourceCodes:['MISSING'],customerIds:[],mappedCustomerId:null,mappingVersion:0,status:'unmatched'}]};
function harness(language){const state={},refs=[],requests=[],responses=[];let cursor=0,refCursor=0,closed=0,saved=0,tree;const hooks={...React,useState(initial){const name=stateNames[cursor++];if(!Object.hasOwn(state,name))state[name]=typeof initial==='function'?initial():initial;return[state[name],value=>{state[name]=typeof value==='function'?value(state[name]):value;}];},useRef(value){const i=refCursor++;return refs[i]||(refs[i]={current:value});},useEffect:noop,useCallback:fn=>fn,useMemo:fn=>fn()};const submitJson=async(url,options)=>{requests.push({url,options,body:options?.body?JSON.parse(options.body):undefined});const response=responses.shift();assert(response,'Unexpected request');if(response.error)throw response.error;return structuredClone(response.body);};const Component=module('app/customer-identities.tsx',name=>name==='react'?hooks:name==='react/jsx-runtime'?jsx:name==='@/lib/i18n'?{useLanguage:()=>({language})}:name==='@/lib/client-submit'?{SubmitError,submitJson}:name==='@/lib/customer-map-search'?{normalizeMapSearch:module('lib/customer-map-search.ts').normalizeMapSearch}:name==='@/components/ui/dialog'?{Dialog,DialogContent:pass,DialogDescription:pass,DialogTitle:pass}:{}).default;return{state,requests,refs,respond:body=>responses.push({body}),reject:error=>responses.push({error}),closed:()=>closed,saved:()=>saved,tree:()=>tree,render(){cursor=refCursor=0;tree=Component({onClose:()=>closed++,onSaved:()=>saved++});return tree;}};}
const button=(h,label)=>nodes(h.tree(),node=>node.type==='button'&&text(node)===label)[0];
const radio=(h,value)=>nodes(h.tree(),node=>node.type==='input'&&node.props.type==='radio'&&node.props.value===value)[0];
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function click(h,label){const control=button(h,label);ok(control,'Action exists: '+label);control.props.onClick();await tick();h.render();}
for(const lang of ['ar','en']){
 const say=(ar,en)=>lang==='ar'?ar:en,h=harness(lang);h.render();h.respond(initial);await click(h,say('تحديث','Refresh'));
 eq(h.requests[0].url,'/api/customer-identities','Identity data uses administrative endpoint');eq(h.requests[0].options.cache,'no-store','Administrative data is never cached');
 await click(h,'ABC / abc'+say('يحتاج اختيار العميل','Choose a customer'));
 eq(h.state.customerId,'','Ambiguous code never chooses a factory automatically');ok(button(h,say('حفظ ربط العميل','Save customer link')).props.disabled,'Saving needs an explicit customer choice');
 ok(text(h.tree()).includes('YR-C-000001')&&text(h.tree()).includes('YR-C-000002'),'Both homonymous candidates show their distinct permanent codes');
 radio(h,'two').props.onChange();h.render();h.reject(new SubmitError('Changed',409));await click(h,say('حفظ ربط العميل','Save customer link'));
 const posted=h.requests.at(-1).body;eq(posted.customerId,'two');eq(posted.codeKey,'ABC');eq(posted.version,0);eq(posted.revision,8);eq(posted.customerVersion,4);ok(/^[0-9a-f-]{36}$/i.test(posted.requestId),'Save sends a durable UUID request identity');
 eq(h.state.customerId,'two','Conflict retains the visible choice');eq(h.requests.length,2,'Conflict does not silently reload or save');ok(button(h,say('حفظ ربط العميل','Save customer link')).props.disabled,'Conflict blocks stale save');
 button(h,say('حفظ ربط العميل','Save customer link')).props.onClick();await tick();eq(h.requests.length,2,'Handler also blocks stale programmatic resubmission');
 const latest=structuredClone(initial);latest.revision=9;latest.identities[0]={...latest.identities[0],mappedCustomerId:'one',mappingVersion:2,status:'mapped'};
 h.respond(latest);await click(h,say('تحميل أحدث البيانات ومراجعتها','Load latest data for review'));
 eq(h.state.customerId,'','Explicit reload clears draft so the latest mapping cannot be overwritten without review');eq(h.state.conflict,false);ok(text(h.tree()).includes(say('الربط الحالي: ','Current link: ')),'Current winning mapping is displayed');
 radio(h,'two').props.onChange();h.render();h.reject(new TypeError('Disconnected'));await click(h,say('حفظ ربط العميل','Save customer link'));
 const uncertainRequest=h.requests.at(-1).body;eq(uncertainRequest.revision,9);eq(uncertainRequest.version,2);eq(h.state.uncertain,true);ok(radio(h,'one').props.disabled,'Ambiguous network result locks edits until confirmed');
 nodes(h.tree(),node=>node.type===Dialog)[0].props.onOpenChange(false);eq(h.closed(),0,'Dismissal cannot abandon an unconfirmed administrative write');
 h.respond({ok:true,alreadySaved:true});const saved=structuredClone(latest);saved.revision=10;saved.identities[0]={...saved.identities[0],mappedCustomerId:'two',mappingVersion:3};h.respond(saved);await click(h,say('التأكد من الحفظ','Confirm save result'));
 eq(h.requests.at(-2).body,uncertainRequest,'Retry preserves the entire request, including UUID and expected revisions');eq(h.saved(),1);eq(h.state.uncertain,false);eq(h.state.customerId,'');ok(text(h.tree()).includes(say('تم حفظ ربط العميل.','Customer link saved.')));
 h.respond({ok:true});h.respond(initial);await click(h,say('إلغاء الربط اليدوي لهذا الكود','Clear this code’s manual link'));eq(h.requests.at(-2).body.customerId,'');eq(h.requests.at(-2).body.customerVersion,0);eq(h.requests.at(-2).body.version,3,'Clear uses the current mapping version');
 await click(h,'MISSING'+say('لا يوجد عميل مطابق','No matching customer'));eq(nodes(h.tree(),node=>node.type==='input'&&node.props.type==='radio').length,0,'Unmatched ERP code cannot be assigned to an arbitrary factory');ok(text(h.tree()).includes(say('صحّح كود ERP','Correct the ERP code')),'Unmatched code explains how to correct the customer record');
 h.reject(new SubmitError('Permission revoked',403));await click(h,say('تحديث','Refresh'));eq(h.state.snapshot,null,'Access loss clears administrative data');eq(h.state.denied,true);eq(nodes(h.tree(),node=>node.type==='input'&&node.props.type==='radio').length,0);await click(h,say('إغلاق','Close'));eq(h.closed(),1);
}
console.log(JSON.stringify({ok:true,checks,coverage:'actual internal-code search and administrative ERP reconciliation UI: explicit choice, CAS payload, stale state retention and review, durable network retry, clearing, unmatched code and revoked access; Arabic/English',realBrowser:false}));
