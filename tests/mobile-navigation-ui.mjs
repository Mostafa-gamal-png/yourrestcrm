// Real component navigation/permission interactions with controlled hooks and DOM events.
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
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(actual,message)=>{assert.ok(actual,message);checks++;};
const noop=()=>{},pass=({children})=>children,icons=new Proxy({},{get:()=>pass});
const dictionary=JSON.parse(fs.readFileSync('lib/locales/en.json','utf8'));
const i18n={useLanguage:()=>({language}),getLanguage:()=>language,direction:()=>language==='ar'?'rtl':'ltr',t:value=>language==='en'&&typeof value==='string'?(dictionary[value]||value):value};
function load(filename,require,globals={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,require,console,crypto:globalThis.crypto,structuredClone,Intl,setTimeout,clearTimeout,...globals});return exports;}
function library(filename){if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);const require=name=>name.startsWith('.')?library(path.join(path.dirname(filename),name)+'.ts'):nativeRequire(name);vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,require,console,Intl});return exports;}
function Sheet({children}){return children;}function SheetContent({children}){return children;}function EmailLogout(){return null;}function Sidebar(){return null;}
function baseRequire(name){
 if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;
 if(name==='@/lib/i18n')return i18n;if(name.startsWith('@/lib/'))return library(name.replace('@/','')+'.ts');
 if(name==='@/components/ui/sheet')return {Sheet,SheetContent,SheetTitle:pass,SheetDescription:pass};
 if(name==='./email-login')return {EmailLogout};if(name.endsWith('.css'))return {};
 if(name==='./support-panel')return new Proxy({useSupport:()=>({data:null,refresh:async()=>{},byCustomer:{},canRequest:()=>false,badge:0})},{get:(target,key)=>target[key]||pass});
 if(name==='./complaints-panel')return new Proxy({useComplaints:()=>({data:null,refresh:async()=>{},forCustomer:()=>[],badge:0})},{get:(target,key)=>target[key]||pass});
 if(name==='@/components/ui/sidebar')return new Proxy({Sidebar,useSidebar:()=>({setOpenMobile:noop})},{get:(target,key)=>target[key]||pass});
 if(name==='sonner')return {Toaster:pass,toast:{success:noop,error:noop}};
 return icons;
}
function nodes(tree,predicate){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(node=>nodes(node,predicate));return [...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];}
function text(tree){if(tree===null||tree===undefined||typeof tree==='boolean')return '';if(typeof tree!=='object')return String(tree);return Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);}
const nav=tree=>nodes(tree,node=>node.type==='nav'&&node.props.className?.includes('mobile-bottom-navigation'))[0];
const tabs=tree=>nodes(nav(tree),node=>node.type==='button');
const pageIds=tree=>tabs(tree).map(node=>node.props['data-page']).filter(Boolean);
const byPage=(tree,id)=>nodes(tree,node=>node.type==='button'&&node.props['data-page']===id)[0];
function stateNames(filename){const source=ts.createSourceFile(filename,fs.readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),names=[];function visit(node){if(ts.isVariableDeclaration(node)&&ts.isArrayBindingPattern(node.name)&&node.initializer&&ts.isCallExpression(node.initializer)&&node.initializer.expression.getText(source)==='useState')names.push(node.name.elements[0].name.getText(source));ts.forEachChild(node,visit);}visit(source);return names;}
function harness(filename,props,seed={},globals={},require=baseRequire){
 const names=stateNames(filename),state={...seed},refs=[];let cursor=0,refCursor=0,tree;const effects=[];
 const hooks={...React,useState(initial){const name=names[cursor++];if(!Object.hasOwn(state,name))state[name]=typeof initial==='function'?initial():initial;return [state[name],value=>{state[name]=typeof value==='function'?value(state[name]):value;}];},useRef(value){const index=refCursor++;return refs[index]||(refs[index]={current:value});},useEffect:callback=>effects.push(callback),useCallback:callback=>callback,useMemo:callback=>callback(),useDeferredValue:value=>value};
 const component=load(filename,name=>name==='react'?hooks:require(name),globals).default;
 return {state,effects,render(){cursor=refCursor=0;effects.length=0;tree=component(props);return tree;}};
}
const access=library('lib/access.ts');for(const role of ['admin','manager','supervisor']){eq(access.resolveCRMPage(role,'reports'),'targets',role+' legacy performance URL resolves to the merged page');eq(access.canViewPage(role,'reports'),false,'Legacy report is not an independent page');}for(const role of ['rep','customer_service','customer_service_manager'])eq(access.resolveCRMPage(role,'reports'),'activity',role+' cannot acquire management access through a legacy URL');
const me={id:'rep',role:'rep',name:'مندوب الغربية',email:'rep@yourrest.org',regionScope:'western',branch:'HQ',active:1,target:0};
for(const locale of ['ar','en']){
 language=locale;const navigated=[],accountChanges=[],props={me,view:'activity',onNavigate:value=>navigated.push(value),accountOpen:false,onAccountOpenChange:value=>accountChanges.push(value)};
 const scrolls=[],h=harness('app/mobile-navigation.tsx',props,{}, {window:{scrollTo:options=>scrolls.push(options)}});let tree=h.render();
 eq(pageIds(tree),['customer','map','activity','followup','targets'],'Rep has exactly the five allowed bottom pages');eq(tabs(tree).length,5,'Rep needs no overflow tab');
 eq(tabs(tree).map(text),locale==='ar'?['العملاء','الخريطة','الزيارات','المتابعات','مستهدفي']:['Customers','Map','Visits','Follow-ups','My targets'],'Short labels are translated');
 eq(nav(tree).props.dir,locale==='ar'?'rtl':'ltr','Language direction honored');
 eq(tabs(tree).filter(node=>node.props['aria-current']==='page').map(node=>node.props['data-page']),['activity'],'Only current page is active');
 for(const id of ['customer','map','activity','followup','targets']){byPage(tree,id).props.onClick();eq(navigated.at(-1),id,'Tap opens '+id);}
 eq(accountChanges.at(-1),false,'Navigation closes the account sheet');eq(scrolls.length,5,'Each mobile page starts at the top');eq(JSON.parse(JSON.stringify(scrolls.at(-1))),{top:0,behavior:'auto'},'Scroll reset is immediate');
 for(const id of ['sales','quote','reports','team','dashboard','journeys'])eq(byPage(tree,id),undefined,'Rep has no hidden unauthorized action for '+id);
 props.view='targets';tree=h.render();eq(byPage(tree,'targets').props['aria-current'],'page','Targets becomes active after navigation');
 props.accountOpen=true;tree=h.render();const sheet=nodes(tree,node=>node.type===Sheet)[0];eq(sheet.props.open,true,'Top account control can open the account sheet');
 ok(text(tree).includes(me.email),'Account displays signed-in identity');eq(nodes(tree,node=>node.type===EmailLogout).length,1,'Sign out remains reachable');
 eq(nodes(tree,node=>node.type===SheetContent)[0].props.side,'bottom','Account opens upward from the bottom');
 sheet.props.onOpenChange(false);eq(accountChanges.at(-1),false,'Dismiss closes account state');
 props.blocked=true;tree=h.render();eq(nav(tree).props.hidden,true,'Editing dialog hides navigation');eq(nodes(tree,node=>node.type===Sheet)[0].props.open,false,'An open form blocks navigation sheets');
}
language='ar';
const allowed={admin:['customer','map','activity','followup','targets','complaints','service-kpi','dashboard','journeys','quote','sales','competitors','team'],manager:['customer','map','activity','followup','targets','dashboard','journeys','quote','sales','competitors'],supervisor:['customer','map','activity','followup','targets','dashboard','journeys','quote','sales','competitors'],customer_service:['activity','complaints'],customer_service_manager:['activity','complaints','service-kpi'],unknown:[]};
for(const role of Object.keys(allowed)){
 const navigated=[],props={me:{...me,role},view:'targets',onNavigate:value=>navigated.push(value),accountOpen:false,onAccountOpenChange:noop};const h=harness('app/mobile-navigation.tsx',props);let tree=h.render();
 if(role==='unknown'){eq(tree,null,'Unknown role has no navigation');continue;}
 eq(nodes(tree,node=>node.type==='button'&&!!node.props['data-page']).map(node=>node.props['data-page']),allowed[role],role+' exposes exactly authorized pages across bottom bar and overflow');
 if(role.startsWith('customer_service')){eq(tabs(tree).length,allowed[role].length,role+' keeps its few pages (Visits and Complaints, and the evaluation for the manager) with account access, without management pages');continue;}
 eq(pageIds(tree),['customer','map','activity','followup'],role+' keeps frequent pages in bottom bar');
 eq(byPage(tree,'reports'),undefined,role+' has no duplicate performance navigation item');eq(text(byPage(tree,'targets')),'المستهدفات وتقييم الأداء',role+' unified navigation label');
 const more=tabs(tree).find(node=>!node.props['data-page']);eq(more.props['aria-haspopup'],'dialog','More declares its sheet');ok(more.props.className.includes('is-active'),'Overflow current page highlights More');more.props.onClick();tree=h.render();eq(h.state.moreOpen,true,'More opens');eq(nodes(tree,node=>node.type===Sheet)[0].props.open,true,'Overflow is visible');
 const sheet=nodes(tree,node=>node.type===SheetContent)[0];eq(sheet.props.side,'bottom','More opens from bottom instead of sidebar');
 for(const id of allowed[role].slice(4)){h.state.moreOpen=true;tree=h.render();byPage(tree,id).props.onClick();eq(navigated.at(-1),id,'Overflow action opens '+id);eq(h.state.moreOpen,false,'Selecting a page closes More');}
 if(role!=='admin')eq(byPage(tree,'team'),undefined,role+' cannot reach permission management');
}
// Exercise real focus listeners: bar hides for editable fields even without visualViewport.
class FakeElement{constructor(editing=false){this.editing=editing;this.isContentEditable=false;this.isConnected=true;this.focused=0;}matches(){return this.editing;}focus(){this.focused++;}}
const events=new Map(),document={activeElement:new FakeElement(),addEventListener:(name,callback)=>events.set(name,callback),removeEventListener:name=>events.delete(name)};
const keyboard=harness('app/mobile-navigation.tsx',{me,view:'activity',onNavigate:noop,accountOpen:false,onAccountOpenChange:noop},{},{document,HTMLElement:FakeElement,window:{},requestAnimationFrame:callback=>{callback();return 1;},cancelAnimationFrame:noop});
let keyboardTree=keyboard.render();const opener=document.activeElement,focusSheet=nodes(keyboardTree,node=>node.type===SheetContent)[0];focusSheet.props.onOpenAutoFocus();let prevented=0;focusSheet.props.onCloseAutoFocus({preventDefault:()=>prevented++});eq(prevented,1,'Sheet overrides missing-trigger default focus');eq(opener.focused,1,'Sheet restores the actual account or More opener');opener.isConnected=false;focusSheet.props.onCloseAutoFocus({preventDefault:noop});eq(opener.focused,1,'Detached opener is not focused');const dispose=keyboard.effects[0]();eq(keyboard.state.editing,false,'No keyboard obstruction on initial render');
document.activeElement=new FakeElement(true);events.get('focusin')();eq(nav(keyboard.render()).props.hidden,true,'Input focus hides bottom actions');
document.activeElement=new FakeElement();events.get('focusout')();eq(nav(keyboard.render()).props.hidden,false,'Navigation returns when field loses focus');dispose();eq(events.size,0,'Focus listeners removed on unmount');

// A date-field blur must not put the fixed navigation over a tap before its click fires.
const gestureEvents=new Map(),windowEvents=new Map(),viewportEvents=new Map(),frames=new Map(),registrations=[],removals=[];let frameId=0;
const gestureDocument={activeElement:new FakeElement(true),addEventListener:(name,callback,capture)=>{gestureEvents.set(name,callback);registrations.push([name,capture]);},removeEventListener:(name,callback,capture)=>{eq(gestureEvents.get(name),callback,'The exact '+name+' callback is removed');gestureEvents.delete(name);removals.push([name,capture]);}};
const gestureWindow={addEventListener:(name,callback)=>windowEvents.set(name,callback),removeEventListener:(name,callback)=>{eq(windowEvents.get(name),callback,'Window callback is removed');windowEvents.delete(name);},visualViewport:{addEventListener:(name,callback)=>viewportEvents.set(name,callback),removeEventListener:(name,callback)=>{eq(viewportEvents.get(name),callback,'Viewport callback is removed');viewportEvents.delete(name);}}};
const gesture=harness('app/mobile-navigation.tsx',{me,view:'activity',onNavigate:noop,accountOpen:false,onAccountOpenChange:noop},{},{document:gestureDocument,HTMLElement:FakeElement,window:gestureWindow,requestAnimationFrame:callback=>{const id=++frameId;frames.set(id,callback);return id;},cancelAnimationFrame:id=>frames.delete(id)});
const flushFrames=()=>{const pending=[...frames.values()];frames.clear();for(const callback of pending)callback();};
const hidden=()=>nav(gesture.render()).props.hidden;
const fire=(name,pointerId)=>gestureEvents.get(name)({pointerId});
gesture.render();const disposeGesture=gesture.effects[0]();eq(hidden(),true,'An already focused date input hides navigation');
for(const name of ['pointerdown','pointerup','pointercancel'])ok(registrations.some(([event,capture])=>event===name&&capture===true),'Pointer tracking captures '+name+' before target handlers');
fire('pointerdown',1);gestureDocument.activeElement=new FakeElement();fire('focusout');fire('focusin');eq(hidden(),true,'Date blur and button focus cannot restore navigation under a pressed pointer');flushFrames();eq(hidden(),true,'A frame while the pointer is held cannot restore the bar');
fire('pointerup',1);eq(hidden(),true,'Pointerup keeps restoration deferred until after click');viewportEvents.get('resize')();fire('focusin');eq(hidden(),true,'Focus and viewport events between pointerup and click preserve the guard');
let clicked=0;const targetClick=()=>{eq(hidden(),true,'The original target processes its click while navigation is still hidden');clicked++;};targetClick();eq(clicked,1,'One uninterrupted pointer gesture produces one target click');flushFrames();eq(hidden(),false,'Navigation returns on the first frame after the click');
// Keyboard movement is unaffected, and entering another field always hides immediately.
gestureDocument.activeElement=new FakeElement(true);fire('focusin');eq(hidden(),true,'Keyboard focus into an input hides navigation immediately');gestureDocument.activeElement=new FakeElement();fire('focusout');flushFrames();eq(hidden(),false,'Keyboard-only blur restores navigation normally');
fire('pointerdown',2);gestureDocument.activeElement=new FakeElement(true);fire('focusin');eq(hidden(),true,'Editable focus hides immediately even during a pointer gesture');fire('pointerup',2);flushFrames();eq(hidden(),true,'A focused editable field stays hidden after the gesture');
// Multi-touch and scroll cancellation release only when every active pointer has ended.
fire('pointerdown',11);fire('pointerdown',12);gestureDocument.activeElement=new FakeElement();fire('focusout');fire('focusin');fire('pointerup',11);flushFrames();eq(hidden(),true,'Ending one of two pointers does not expose the navigation');fire('pointerup',99);flushFrames();eq(hidden(),true,'An unrelated pointer release cannot clear the active gesture');fire('pointercancel',12);eq(hidden(),true,'Scroll cancellation waits for the restoration frame');flushFrames();eq(hidden(),false,'A cancelled final pointer cannot leave navigation permanently hidden');
// Losing the window ends tracking; cleanup cancels pending restoration without a late state write.
gestureDocument.activeElement=new FakeElement(true);fire('focusin');fire('pointerdown',20);gestureDocument.activeElement=new FakeElement();fire('focusout');windowEvents.get('blur')();eq(hidden(),true,'Window blur defers its release through the same frame boundary');flushFrames();eq(hidden(),false,'A pointer lost outside the window does not leave the bar hidden');
gestureDocument.activeElement=new FakeElement(true);fire('focusin');fire('pointerdown',21);gestureDocument.activeElement=new FakeElement();fire('focusout');fire('pointercancel',21);ok(frames.size>0,'Final cancellation schedules a restoration frame');disposeGesture();eq(frames.size,0,'Unmount cancels pending restoration');eq(gestureEvents.size,0,'Unmount removes focus and pointer listeners');eq(windowEvents.size,0,'Unmount removes window blur listener');eq(viewportEvents.size,0,'Unmount removes viewport listener');for(const name of ['pointerdown','pointerup','pointercancel'])ok(removals.some(([event,capture])=>event===name&&capture===true),'Pointer capture listener cleanup matches '+name);flushFrames();eq(gesture.state.editing,true,'Unmount cannot write a late restoration state');

// Full CRM integration: compact rendering actually removes the old Sidebar and guards navigation.
function MobileNavigation(){}
const requireCRM=name=>name==='./mobile-navigation'?{__esModule:true,default:MobileNavigation}:baseRequire(name);
let mediaChange;const media={matches:true,addEventListener:(_,callback)=>{mediaChange=callback;},removeEventListener:()=>{mediaChange=undefined;}};
const crm=harness('app/crm-app.tsx',{}, {me,members:[me],records:[],loading:false,view:'activity'}, {window:{history:{replaceState:noop},matchMedia:query=>{eq(query,'(max-width: 1023px)','Phone/tablet breakpoint is consistent');return media;}}},requireCRM);
let tree=crm.render();eq(nodes(tree,node=>node.type===Sidebar).length,1,'Desktop keeps its sidebar');
const mediaEffect=crm.effects.find(effect=>effect.toString().includes('matchMedia'));ok(mediaEffect,'Responsive subscription effect is registered');const disposeMedia=mediaEffect();eq(crm.state.compactNavigation,true,'Media query enables compact navigation');tree=crm.render();eq(nodes(tree,node=>node.type===Sidebar).length,0,'Mobile unmounts sidebar, including its keyboard-driven Sheet');
let mobile=nodes(tree,node=>node.type===MobileNavigation)[0];eq(mobile.props.me.id,me.id,'Mobile navigation uses current identity');eq(mobile.props.view,'activity','Mobile receives current page');
nodes(tree,node=>node.type==='button'&&node.props.className?.includes('mobile-profile-trigger'))[0].props.onClick();eq(crm.state.mobileAccountOpen,true,'Top account button opens sheet');
mobile.props.onNavigate('targets');eq(crm.state.view,'targets','Authorized bottom page uses the CRM navigation handler');mobile.props.onNavigate('reports');eq(crm.state.view,'activity','Rep legacy performance link cannot open management data');mobile.props.onNavigate('sales');eq(crm.state.view,'activity','CRM handler still rejects a forged rep management page');
for(const state of ['form','visitEditor','followupEditor','detailId','deleting','printQuote','serviceDetailId']){crm.state[state]=state.endsWith('Id')?'open':{id:'test',kind:'customer',parentId:'',data:{name:'Factory',items:[],branch:'HQ',assignedTo:me.id}};tree=crm.render();mobile=nodes(tree,node=>node.type===MobileNavigation)[0];eq(mobile.props.blocked,true,state+' prevents navigation over its editor');crm.state[state]=state.endsWith('Id')?'':null;}
media.matches=false;mediaChange();eq(crm.state.compactNavigation,false,'Wider viewport returns to desktop');eq(crm.state.mobileAccountOpen,false,'Wider viewport dismisses mobile account sheet');tree=crm.render();eq(nodes(tree,node=>node.type===Sidebar).length,1,'Desktop sidebar is restored after resize');disposeMedia();eq(mediaChange,undefined,'Viewport listener is removed on unmount');
console.log(JSON.stringify({ok:true,checks,type:'real mobile navigation and CRM integration: role scope, tabs, overflow, account, keyboard and dialog handling, Arabic/English',realBrowser:false}));
