// Verify real directory callbacks and safe mobile contact links without a browser or production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';
const root=process.cwd(),nativeRequire=createRequire(import.meta.url),cache=new Map();
let language='ar',checks=0,screen;
const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
const ok=(actual,label)=>{assert.ok(actual,label);checks++;};
const noop=()=>{},pass=({children})=>children;
const dictionary=JSON.parse(fs.readFileSync(path.join(root,'lib/locales/en.json'),'utf8'));
const i18n={t:v=>language==='en'&&typeof v==='string'?(dictionary[v]||v):v,useLanguage:()=>({language})};
const compiler={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true};
function load(filename){
 if(cache.has(filename))return cache.get(filename);
 const exports={};cache.set(filename,exports);
 const require=name=>{
  if(name==='react')return {...React,useState:v=>[v,noop],useMemo:fn=>fn(),useSyncExternalStore:(subscribe,client)=>screen===undefined?client():screen};
  if(name==='react/jsx-runtime')return jsx;
  if(name==='@/lib/i18n')return i18n;
  if(name==='lucide-react')return new Proxy({},{get:()=>()=>null});
  if(name.startsWith('@/components/'))return new Proxy({},{get:()=>pass});
  if(name.endsWith('.css'))return {};
  if(name.startsWith('@/'))return load(name.slice(2)+'.ts');
  if(name.startsWith('.'))return load(path.join(path.dirname(filename),name)+'.ts');
  return nativeRequire(name);
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,require,Intl,console});return exports;
}
const nodes=(tree,predicate)=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(n=>nodes(n,predicate)):[...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];
const text=tree=>tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree):Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);
const cls=(tree,name)=>nodes(tree,n=>n.props?.className?.split(' ').includes(name));
const btn=(tree,label)=>nodes(tree,n=>n.type==='button'&&text(n)===label)[0];
const customer={id:'west-factory',kind:'customer',assignedTo:'other',parentId:null,data:{name:'Western factory',internalCode:'YR-C-000123',code:'123',region:'الغربية',city:'جدة',customerStatus:'نشط',location:'21.5,39.2',contact:'Ali',phone:'+٩٦٦ (٥٥٥) ١٢٣-٤٥٦',_masterReadOnly:true,machineCount:2,machineTypes:'Type A'},version:1};
const machine={id:'line-one',kind:'factory',parentId:customer.id,data:{name:'Existing machine',_masterReadOnly:true},version:1};
const visit={id:'visit-one',kind:'activity',parentId:machine.id,data:{},version:1};
const calls=[],pages=[];
const props={customers:[customer],records:[customer,machine,visit],members:[],page:1,onPage:p=>pages.push(p),onOpen:id=>calls.push(['open',id]),onHistory:id=>calls.push(['history',id]),onEdit:noop,onAddMachine:id=>calls.push(['machine',id]),onAddOpportunity:id=>calls.push(['visit',id]),onMap:id=>calls.push(['map',id])};
const Directory=load('app/customer-machines.tsx').default;
function render(values={}){const tree=Directory({...props,...values});return {tree,cards:nodes(tree,n=>typeof n.type==='function'&&n.type.name==='CustomerMobileCard').map(n=>n.type(n.props))};}
let {tree,cards}=render(),card=cards[0];
// Only the layout on screen is drawn; where the screen size is unknown (no matchMedia) both are, and the stylesheet decides.
const layouts=()=>{const t=render().tree;return [cls(t,'customer-mobile-list').length,cls(t,'customer-directory-desktop').filter(n=>n.props.className==='customer-directory-desktop').length];};
eq(layouts(),[1,1],'Without a known screen size both layouts are drawn and the stylesheet hides one');
screen=true;eq(layouts(),[1,0],'A phone or tablet (up to 1023 px) draws only the cards');
screen=false;eq(layouts(),[0,1],'A wider screen draws only the table');
screen=undefined;
ok(text(card).includes('كود يورست YR-C-000123')&&text(card).includes('كود ERP 123'),'Mobile card distinguishes internal and ERP customer codes');
eq(tree.props.dir,'rtl','Arabic directory is RTL');eq(cards.length,1,'Only supplied authorized customers render');
ok(text(card).includes('Western factory')&&text(card).includes('123')&&text(card).includes('جدة'),'Factory identity is visible without opening details');
eq(cls(card,'customer-mobile-activity')[0].props['data-activity'],'active','Activity comes from recorded customer status');
eq(nodes(card,n=>n.type==='a')[0].props.href,'tel:+966555123456','Arabic phone digits normalize safely');
eq(text(cls(card,'customer-mobile-visit-count')[0]),'1','Linked visits are counted through machine ancestry');
btn(card,'زيارة جديدة').props.onClick();btn(card,'الخريطة').props.onClick();btn(card,'الزيارات 1').props.onClick();btn(card,'البيانات').props.onClick();
eq(calls.slice(0,4).map(call=>Array.from(call)),[['visit',customer.id],['map',customer.id],['history',customer.id],['open',customer.id]],'Mobile actions target exact customer ID, including read-only directory visit');
eq(nodes(card,n=>n.type==='details')[0].props.open,undefined,'Machine data is collapsed initially');ok(text(card).includes('Existing machine'),'Existing linked machine remains available');
eq(btn(card,'إضافة ماكينة'),undefined,'Representative cannot add machine from mobile directory');
const machineLink=cls(card,'customer-mobile-machine-link')[0];machineLink.props.onClick();eq(calls.at(-1),['open',machine.id],'Collapsed machine uses its own detail record');
for(const malicious of ['javascript:alert(1)','+966555123456;call=other','55512345/55567890','++966555123456','123','+1234567890123456']){
 const bad=render({customers:[{...customer,data:{...customer.data,phone:malicious,phone2:''}}]}).cards[0];eq(nodes(bad,n=>n.type==='a').length,0,'Unsafe or ambiguous phone is not dialable: '+malicious);
}
card=render({customers:[{...customer,data:{...customer.data,phone:'not supplied',phone2:'+966 550 111 222',contact2:'Second contact'}}]}).cards[0];
eq(nodes(card,n=>n.type==='a')[0].props.href,'tel:+966550111222','Second valid contact is available when primary phone is unusable');ok(text(cls(card,'customer-mobile-contact')[0]).includes('Second contact'),'Dial action names matching contact');
card=render({customers:[{...customer,data:{...customer.data,location:'',customerStatus:'حالة خاصة',machineCount:undefined,machineTypes:'',_masterReadOnly:false,_readOnly:true}}],records:[]}).cards[0];
eq(btn(card,'الخريطة'),undefined,'Missing coordinates never open fabricated map location');ok(text(card).includes('لا يوجد موقع'),'Missing location has clear noninteractive label');eq(cls(card,'customer-mobile-activity')[0].props['data-activity'],'unknown','Unknown status remains unclassified');ok(text(card).includes('حالة خاصة'),'Unknown recorded status is preserved');
card=render({customers:[{...customer,data:{...customer.data,_masterReadOnly:false,_readOnly:true}}]}).cards[0];eq(btn(card,'إضافة ماكينة'),undefined,'Ordinary read-only flag also prevents machine mutation');
card=render({customers:[{...customer,data:{...customer.data,_masterReadOnly:false}}]}).cards[0];btn(card,'إضافة ماكينة').props.onClick();eq(calls.at(-1),['machine',customer.id],'Authorized manager retains machine entry point');
// An explicit role gate must remain effective even when cached/imported rows lack read-only flags.
const unflaggedCustomer={...customer,data:{...customer.data,_masterReadOnly:undefined,_readOnly:undefined}};
const unflaggedMachine={...machine,data:{...machine.data,_masterReadOnly:undefined,_readOnly:undefined}};
function roleDirectory(canEdit){
 const rendered=render({canEdit,customers:[unflaggedCustomer],records:[unflaggedCustomer,unflaggedMachine]});
 const row=nodes(rendered.tree,n=>typeof n.type==='function'&&n.type.name==='CustomerRows')[0];
 return {mobile:rendered.cards[0],desktop:row.type({...row.props,open:true}),tree:rendered.tree};
}
const repDirectory=roleDirectory(false);
ok(text(repDirectory.desktop).includes('كود يورست: YR-C-000123')&&text(repDirectory.desktop).includes('كود ERP: 123'),'Desktop customer row displays both distinct codes');
eq(btn(repDirectory.mobile,'إضافة ماكينة'),undefined,'Role gate hides mobile Add machine despite missing record flags');
eq(btn(repDirectory.desktop,'إضافة ماكينة'),undefined,'Role gate hides expanded desktop Add machine despite missing record flags');
eq(nodes(repDirectory.desktop,n=>n.type==='button'&&n.props.title==='إضافة ماكينة للمصنع').length,0,'Role gate hides desktop row Add machine shortcut');
eq(btn(repDirectory.desktop,'تعديل'),undefined,'Role gate hides edit button for unflagged linked machines');
ok(text(repDirectory.desktop).includes('بيانات الماكينات ('),'Read-only role sees viewing language instead of machine management');
ok(btn(repDirectory.mobile,'زيارة جديدة')&&btn(repDirectory.mobile,'الخريطة')&&btn(repDirectory.mobile,'البيانات'),'Role gate keeps visit, map and detail actions on mobile');
ok(nodes(repDirectory.mobile,n=>n.type==='a'&&n.props.href==='tel:+966555123456').length===1,'Role gate retains tap-to-call');
ok(btn(repDirectory.desktop,'بيانات العميل')&&btn(repDirectory.desktop,'التفاصيل والمتابعات'),'Role gate retains customer and machine viewing on desktop');
const managerDirectory=roleDirectory(true);
ok(btn(managerDirectory.mobile,'إضافة ماكينة'),'Manager keeps mobile machine creation for writable row');
ok(btn(managerDirectory.desktop,'إضافة ماكينة')&&btn(managerDirectory.desktop,'تعديل'),'Manager keeps desktop machine creation and editing');
ok(text(managerDirectory.desktop).includes('إدارة الماكينات ('),'Manager still sees machine management label');
const many=Array.from({length:51},(_,i)=>({...customer,id:'factory-'+i}));
({tree,cards}=render({customers:many,page:2}));eq(cards.length,1,'Existing pagination limits mobile rendering');eq(cards[0].props['aria-label'],customer.data.name,'Second page renders expected card');btn(tree,'السابق').props.onClick();eq(pages.at(-1),1,'Mobile directory keeps previous-page navigation');
eq(render({customers:[]}).cards.length,0,'Empty filtered scope removes cards');
language='en';({tree,cards}=render());card=cards[0];eq(tree.props.dir,'ltr','English directory is LTR');ok(btn(card,'New visit')&&btn(card,'Map')&&btn(card,'Details'),'Primary mobile controls translate');ok(text(card).includes('Active')&&text(card).includes('Machine details'),'Activity and collapsed heading translate');
console.log(JSON.stringify({ok:true,checks,type:'Mobile customer callbacks, authorization presentation, phone safety, activity, pagination, Arabic/English',realBrowser:false}));
