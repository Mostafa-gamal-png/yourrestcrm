// Exercise the actual GPS section lifecycle with controlled device callbacks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';
const compiler={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX};
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:compiler}).outputText;
const component=({children})=>children||null,ui=new Proxy({},{get:()=>component});
const nodes=(tree,predicate)=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(n=>nodes(n,predicate)):[...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];
const text=tree=>tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree):Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);
const button=(tree,label)=>nodes(tree,node=>node.type==='button'&&text(node)===label)[0];
let checks=0;const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};const ok=(value,label)=>{assert.ok(value,label);checks++;};
function setup(values={},language='ar'){
 const states=[],refs=[],deps=[],effects=[],cleanups=[],timers=new Map(),changes=[],statuses=[],fixes=[];let cursor=0,refCursor=0,effectCursor=0,next=0;
 const props={unified:true,readOnly:false,data:{type:'visit',summary:'',result:''},editing:false,busy:false,parentId:'',records:[],email:'rep@yourrest.org',onParent:()=>{},...values};
 props.onChange=(key,value)=>{changes.push([key,value]);props.data={...props.data,[key]:value};};props.onLocationState=value=>statuses.push(value);
 const geo={getCurrentPosition:(success,error,options)=>fixes.push({success,error,options})};
 const clocks={setTimeout:(callback,delay)=>{const id=++next;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id)};
 const loc={};vm.runInNewContext(compile('lib/visit-location.ts'),{exports:loc,Date,Error,...clocks});
 const hooks={useState(initial){const index=cursor++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;return[states[index],value=>states[index]=typeof value==='function'?value(states[index]):value];},useRef(initial){const index=refCursor++;return refs[index]||(refs[index]={current:initial});},useEffect(effect,nextDeps){const index=effectCursor++;if(!deps[index]||nextDeps?.some((value,i)=>!Object.is(value,deps[index][i]))){deps[index]=nextDeps;effects.push({effect,index});}}};
 const wording={};vm.runInNewContext(compile('lib/service-wording.ts'),{exports:wording,require:name=>name==='./customer-service'?{isServiceRole:role=>role==='customer_service'||role==='customer_service_manager'}:{}});
 const exports={},require=name=>name==='@/lib/service-wording'?wording:name==='react'?hooks:name==='react/jsx-runtime'?jsx:name==='@/lib/visit-location'?loc:name==='@/lib/i18n'?{t:x=>x,useLanguage:()=>({language}),direction:()=>language==='ar'?'rtl':'ltr'}:name==='@/lib/crm'?{isOpen:()=>true,today:()=> '2026-10-01'}:name==='@/lib/visits'?{contactTypes:{visit:'زيارة'},visitPurposes:['تعريف بمنتجات الشركة'],visitResults:['متابعة العميل']}:ui;
 vm.runInNewContext(compile('app/visit-fields.tsx'),{exports,require,AbortController,navigator:{geolocation:geo},Date});
 return{props,changes,statuses,fixes,timers,render(){cursor=refCursor=effectCursor=0;const tree=exports.default(props);for(const {effect,index}of effects.splice(0)){cleanups[index]?.();cleanups[index]=effect();}return tree;},expire:()=>{for(const {callback}of [...timers.values()])callback();},unmount:()=>cleanups.forEach(fn=>fn?.())};
}
const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
const position={coords:{latitude:21.5,longitude:39.2,accuracy:15},timestamp:Date.parse('2026-10-01T12:00:00Z')};
let h=setup(),tree=h.render();eq(h.fixes.length,1,'New form captures device location once');tree=h.render();ok(text(tree).includes('تفعيل خط السير المستمر إجراء مستقل'),'Form separates foreground location from route activation');eq(h.statuses[0].status,'locating');
h.expire();await settle();tree=h.render();ok(button(tree,'إعادة المحاولة'),'Missing WebView callback releases retry');eq(h.statuses.at(-1).status,'error');eq(h.changes.length,0,'Timeout never fills coordinates or a fake timestamp');
button(tree,'إعادة المحاولة').props.onClick();tree=h.render();eq(h.fixes.length,2,'Retry requests a new device fix');eq(h.statuses.at(-1).status,'locating');h.fixes[1].success(position);await settle();tree=h.render();eq(h.props.data.location,'21.5000000, 39.2000000');eq(h.props.data.locationCapturedAt,'2026-10-01T12:00:00.000Z');eq(h.statuses.at(-1).status,'captured');ok(button(tree,'تحديث موقع الجهاز'),'Captured location remains refreshable');
const received=h.changes.length;h.fixes[0].success({...position,coords:{...position.coords,latitude:5}});await settle();eq(h.changes.length,received,'Old timed-out callback cannot overwrite current fix');
h=setup();h.render();h.unmount();h.fixes[0].success(position);await settle();eq(h.changes.length,0,'Closed form ignores late device callback');eq(h.timers.size,0,'Unmount cancels watchdog');
for(const props of [{editing:true},{readOnly:true},{editing:true,data:{location:'old-coordinates',locationCapturedAt:'2020-01-01T00:00:00Z'}}]){h=setup(props);tree=h.render();eq(h.fixes.length,0,'Existing/read-only visit never captures location');eq(button(tree,'إعادة المحاولة'),undefined);eq(button(tree,'تحديث موقع الجهاز'),undefined);}
h=setup();h.render();h.fixes[0].error({code:1});await settle();tree=h.render();ok(text(tree).includes('إعدادات تطبيق يورست أو المتصفح'),'Permission failure explains app and browser settings');h.props.busy=true;tree=h.render();eq(button(tree,'إعادة المحاولة').props.disabled,true,'GPS retry does not compete with saving');button(tree,'إعادة المحاولة').props.onClick();eq(h.fixes.length,1,'Stale retry callback respects busy guard');
h=setup({},'en');h.render();tree=h.render();ok(text(tree).includes('Continuous route activation is a separate step'),'English location explanation present');
console.log(JSON.stringify({ok:true,checks,coverage:'actual visit GPS section watchdog/retry, stale fixes, unmount, edit/read-only, foreground explanation',realBrowser:false,realDevice:false}));
