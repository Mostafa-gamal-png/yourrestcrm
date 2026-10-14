// Exercise real new-customer GPS, address requests and accessible classifications.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const nodes=(tree,p)=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(n=>nodes(n,p)):[...(p(tree)?[tree]:[]),...nodes(tree.props?.children,p)];
const text=tree=>tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree):Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);
const button=(tree,label)=>nodes(tree,n=>n.type==='button'&&text(n)===label)[0];
const input=(tree,label)=>nodes(tree,n=>n.type==='input'&&n.props['aria-label']===label)[0];
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};
// Objects built inside the compiled modules belong to another realm: compare them by value.
const plain=value=>JSON.parse(JSON.stringify(value));
const settle=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};
function setup(values={},language='ar',online=true){
 const states=[],refs=[],deps=[],effects=[],cleanups=[],timers=new Map(),changes=[],pending=[],fixes=[],requests=[];let cursor=0,refCursor=0,effectCursor=0,next=0;
 const props={data:{location:'',shortAddress:'',address:'',city:''},editing:false,disabled:false,...values};
 props.onUpdate=update=>{props.data=update(props.data);changes.push({...props.data});};props.onPendingChange=value=>pending.push(value);
 const geo={getCurrentPosition:(success,error,options)=>fixes.push({success,error,options})};
 const clocks={setTimeout:(callback,delay)=>{const id=++next;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id)};
 const fetch=(url,config)=>new Promise((resolve,reject)=>requests.push({url,config,body:JSON.parse(config.body),resolve:value=>resolve({ok:true,status:200,json:async()=>value}),reject}));
 const shared={AbortController,DOMException,URL,Date,Error,TypeError,...clocks,fetch};
 const loc={},submit={},catalog={},custloc={};vm.runInNewContext(compile('lib/customer-location.ts'),{exports:custloc});vm.runInNewContext(compile('lib/visit-location.ts'),{exports:loc,...shared});vm.runInNewContext(compile('lib/client-submit.ts'),{exports:submit,...shared});vm.runInNewContext(compile('lib/customer-options.ts'),{exports:catalog});
 const hooks={useId(){return':u1:';},useState(initial){const index=cursor++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;return[states[index],value=>states[index]=typeof value==='function'?value(states[index]):value];},useRef(initial){const index=refCursor++;return refs[index]||(refs[index]={current:initial});},useEffect(effect,nextDeps){const index=effectCursor++;if(!deps[index]||nextDeps?.some((value,i)=>!Object.is(value,deps[index][i]))){deps[index]=nextDeps;effects.push({effect,index});}}};
 const ui=new Proxy({},{get:()=>({children})=>children||null}),exports={};
 const require=name=>name==='react'?hooks:name==='react/jsx-runtime'?jsx:name==='@/lib/visit-location'?loc:name==='@/lib/client-submit'?submit:name==='@/lib/customer-options'?catalog:name==='@/lib/customer-location'?custloc:name==='./location-picker'?{__esModule:true,default:function LocationPicker(){}}:name==='@/lib/i18n'?{t:x=>x,useLanguage:()=>({language})}:ui;
 vm.runInNewContext(compile('app/customer-entry-fields.tsx'),{exports,require,AbortController,navigator:{geolocation:geo,onLine:online},Date});
 return{props,changes,pending,fixes,requests,timers,classification:exports.CustomerClassificationFields,render(){cursor=refCursor=effectCursor=0;const tree=exports.default(props);for(const {effect,index}of effects.splice(0)){cleanups[index]?.();cleanups[index]=effect();}return tree;},expire:delay=>{for(const {callback,delay:ms}of [...timers.values()])if(ms===delay)callback();},unmount:()=>cleanups.forEach(fn=>fn?.())};
}
const position={coords:{latitude:21.5,longitude:39.2,accuracy:15},timestamp:Date.parse('2026-10-03T12:00:00Z')};
let h=setup(),tree=h.render();eq(h.fixes.length,1,'New form automatically requests one foreground location');eq(h.pending.at(-1),true);h.render();eq(h.fixes.length,1,'Typing/rerender does not request another fix');eq(input(tree,'اللوكيشن (خط العرض، خط الطول)').props.readOnly,true,'New coordinates cannot be manually replaced');
h.fixes[0].success(position);await settle();tree=h.render();eq(h.props.data.location,'21.5000000, 39.2000000');eq(h.props.data.locationSource,'device');eq(h.requests[0].url,'/api/customer-address');eq(h.requests[0].body.latitude,21.5);eq(h.pending.at(-1),true,'Save waits until bounded address lookup completes');
h.requests[0].resolve({status:'found',shortAddress:'abcd1234',address:'Street A',city:'City A'});await settle();tree=h.render();eq(h.props.data.shortAddress,'ABCD1234');eq(h.props.data.address,'Street A');eq(h.props.data.city,'City A');eq(h.pending.at(-1),false);eq(h.timers.size,0);
button(tree,'تحديث الموقع').props.onClick();h.fixes[1].success({...position,coords:{...position.coords,latitude:24.7}});await settle();tree=h.render();eq(h.props.data.shortAddress,'','Old auto short address is cleared when GPS changes');eq(h.props.data.address,'','Old auto street is cleared');eq(h.props.data.city,'','Old auto city is cleared');
h.requests[1].resolve({status:'found',shortAddress:'WXYZ5678',address:'Street B',city:'City B'});await settle();tree=h.render();eq(h.props.data.shortAddress,'WXYZ5678','New GPS gets its own address');
input(tree,'العنوان الوطني المختصر').props.onChange({target:{value:'MANU9999'}});h.props.data={...h.props.data,address:'User street',city:'User city'};tree=h.render();button(tree,'تحديث الموقع').props.onClick();h.fixes[2].success({...position,coords:{...position.coords,latitude:26}});await settle();h.render();h.requests[2].resolve({status:'found',shortAddress:'AUTO1234',address:'Other street',city:'Other city'});await settle();eq(h.props.data.shortAddress,'MANU9999','Explicitly typed short address survives recapture');eq(h.props.data.address,'User street','Typed street is never replaced');eq(h.props.data.city,'User city','Typed city is never replaced');h.unmount();
// Typing while provider request is pending is also protected by the functional state update.
h=setup();h.render();h.fixes[0].success(position);await settle();tree=h.render();input(tree,'العنوان الوطني المختصر').props.onChange({target:{value:'USER4321'}});h.props.data={...h.props.data,city:'Manual city',address:'Manual street'};h.requests[0].resolve({status:'found',shortAddress:'LATE1234',address:'Provider street',city:'Provider city'});await settle();eq(h.props.data.shortAddress,'USER4321');eq(h.props.data.address,'Manual street');eq(h.props.data.city,'Manual city');h.unmount();
for(const status of ['not_configured','not_found','unavailable','ambiguous']){h=setup();h.render();h.fixes[0].success(position);await settle();h.requests[0].resolve({status});await settle();tree=h.render();eq(h.props.data.shortAddress,'',status+' never fabricates a national address');eq(h.props.data.location,'21.5000000, 39.2000000');eq(h.pending.at(-1),false);ok(text(tree).includes('العنوان المختصر غير متاح. أدخله يدويًا.'));h.unmount();}
h=setup();h.render();h.fixes[0].success(position);await settle();h.requests[0].resolve({status:'found',shortAddress:'fake'});await settle();eq(h.props.data.shortAddress,'','Malformed provider short code is never presented as valid');h.unmount();
h=setup();h.render();h.expire(22000);await settle();tree=h.render();eq(h.pending.at(-1),false,'A silent WebView timeout releases save');ok(text(tree).includes('أو اختر «موقع آخر»'),'and points to the other way of giving the place');eq(h.props.data.location,'');ok(button(tree,'إعادة المحاولة'));button(tree,'إعادة المحاولة').props.onClick();h.fixes[0].success(position);await settle();eq(h.requests.length,0,'Late GPS callback cannot leak through an expired attempt');h.fixes[1].error({code:1});await settle();tree=h.render();ok(text(tree).includes('السماح بالموقع مقفول'));eq(h.pending.at(-1),false);eq(h.props.data.location,'');h.unmount();
h=setup();h.render();h.fixes[0].success(position);await settle();h.expire(12000);await settle();eq(h.pending.at(-1),false,'Hung provider request is bounded');eq(h.props.data.shortAddress,'');h.requests[0].resolve({status:'found',shortAddress:'LATE1234'});await settle();eq(h.props.data.shortAddress,'','Timed-out lookup cannot overwrite draft later');h.unmount();
h=setup();h.render();h.unmount();h.fixes[0].success(position);await settle();eq(h.changes.length,0,'Closed form ignores GPS callback');eq(h.timers.size,0);
h=setup();h.render();h.fixes[0].success(position);await settle();h.unmount();const changes=h.changes.length;h.requests[0].resolve({status:'found',shortAddress:'LATE1234'});await settle();eq(h.changes.length,changes,'Closed form ignores address callback');eq(h.timers.size,0);
h=setup({editing:true,data:{location:'21.5, 39.2',latitude:21.5,longitude:39.2,locationSource:'device',locationAccuracy:4,locationCapturedAt:'2026-10-03T12:00:00Z',shortAddress:'OLDD1234'}});tree=h.render();eq(h.fixes.length,0,'Editing never relocates existing customer');ok(button(tree,'تحديث من موقعي الحالي'));button(tree,'تحديث من موقعي الحالي').props.onClick();eq(h.fixes.length,1,'Existing customer capture requires an explicit click');h.fixes[0].success(position);await settle();h.requests[0].resolve({status:'not_configured'});await settle();tree=h.render();eq(h.props.data.latitude,21.5);eq(h.props.data.locationSource,'device');input(tree,'اللوكيشن (خط العرض، خط الطول)').props.onChange({target:{value:'24.7, 46.6'}});eq(h.props.data.locationSource,undefined,'Manual edit removes old device provenance');eq(h.props.data.latitude,null);eq(h.props.data.longitude,null);eq(h.props.data.shortAddress,'OLDD1234');h.unmount();
h=setup();const selected=[];tree=h.classification({data:{customerType:'جملة',customerStatus:'نشط',category:'بلوك'},onChange:(key,value)=>selected.push([key,value])});eq(nodes(tree,n=>n.type==='input'&&n.props.type==='radio').length,12,'All 6 types, 3 statuses and 3 factory categories available');eq(nodes(tree,n=>n.type==='input'&&n.props.checked).map(n=>n.props.value),['جملة','نشط','بلوك']);nodes(tree,n=>n.type==='input'&&n.props.value==='خدمات')[0].props.onChange({target:{checked:true}});eq(selected,[['customerType','خدمات']]);tree=h.classification({data:{customerType:'مصنع'},onChange:()=>{},disabled:true});eq(nodes(tree,n=>n.type==='input'&&n.props.checked)[0].props.value,'مصنع','Imported legacy type remains selectable and visible');ok(nodes(tree,n=>n.type==='fieldset').every(n=>n.props.disabled),'Saving disables classification controls');
h=setup({},'en');tree=h.render();ok(text(tree).includes('Current device location'));ok(input(tree,'Short national address'));h.unmount();
h=setup({},'ar',false);h.render();h.fixes[0].success(position);await settle();tree=h.render();eq(h.props.data.location,'21.5000000, 39.2000000','Offline GPS remains valid');eq(h.requests.length,0,'Known offline mode skips network-only national address lookup');eq(h.pending.at(-1),false,'Offline location capture releases save without a 12-second request timeout');eq(h.props.data.shortAddress,'','Offline address is never fabricated');ok(text(tree).includes('العنوان المختصر غير متاح'));h.unmount();
// ---- another location: typed or chosen on a map, and never held back by the phone's fix
const LOCATION='اللوكيشن (خط العرض، خط الطول)',picker=tree=>nodes(tree,n=>n.type?.name==='LocationPicker')[0],radios=tree=>nodes(tree,n=>n.type==='input'&&n.props.type==='radio'&&String(n.props.name).startsWith('customer-location-source-')),modeChoices=tree=>nodes(tree,n=>n.type==='label'&&n.props.className==='customer-choice'&&radios(n).length>0),choose=(tree,index)=>radios(tree)[index].props.onChange({target:{checked:true}});
h=setup();tree=h.render();
eq(modeChoices(tree).map((label,index)=>[text(label),radios(tree)[index].props.checked]),[['موقعي الحالي',true],['موقع آخر',false]],'A new customer starts on the phone location and offers another one');
eq(nodes(tree,n=>n.type==='fieldset'&&String(n.props.className).includes('customer-location-modes')).map(n=>text(nodes(n,l=>l.type==='legend')[0])),['مصدر موقع العميل'],'as one labelled group of real radio buttons');
eq([h.fixes.length,h.pending.at(-1)],[1,true],'the phone fix is still requested by default');
choose(tree,1);tree=h.render();
eq(h.pending.at(-1),false,'choosing another location stops waiting for the phone: saving is not held back');
eq(input(tree,LOCATION).props.readOnly,false,'and the coordinates become editable');
ok(button(tree,'اختيار على الخريطة'),'with a map button');eq(button(tree,'إعادة المحاولة'),undefined,'and no phone retry');eq(text(tree).includes('موقع الجهاز الحالي'),false,'under its own heading');
h.fixes[0].success(position);await settle();eq(h.changes.length,0,'a late phone fix after that changes nothing');
// typing: not claimed to come from the phone, explained when it is not coordinates, looked up when it is
input(tree,LOCATION).props.onChange({target:{value:'26.4373, 50.0344'}});eq([h.props.data.location,h.props.data.latitude,h.props.data.locationSource],['26.4373, 50.0344',null,undefined],'a typed location is not presented as a phone capture');
tree=h.render();eq(input(tree,LOCATION).props['aria-invalid'],undefined,'valid coordinates raise no complaint');ok(text(tree).includes('سيُحفظ الموقع الذي حددته'),'and say what will be saved');
input(tree,LOCATION).props.onBlur();await settle();tree=h.render();
eq([h.requests.length,h.requests[0].body.latitude,h.requests[0].body.longitude,h.pending.at(-1)],[1,26.4373,50.0344,false],'a typed place gets its own address lookup, and saving does not wait for it: the tap that ends the typing must not be lost');
h.requests[0].resolve({status:'found',shortAddress:'abcd1234',address:'Street C',city:'City C'});await settle();tree=h.render();
eq([h.props.data.shortAddress,h.props.data.address,h.props.data.city,h.pending.at(-1)],['ABCD1234','Street C','City C',false],'which fills only the empty address fields');
input(tree,LOCATION).props.onBlur();await settle();eq(h.requests.length,1,'the same place is not looked up twice');
input(tree,LOCATION).props.onChange({target:{value:'https://www.google.com/maps/@24.7136,46.6753,17z'}});tree=h.render();eq(input(tree,LOCATION).props['aria-invalid'],undefined,'a full maps link with coordinates is accepted');
input(tree,LOCATION).props.onBlur();await settle();eq([h.requests.length,h.requests[1].body.latitude],[2,24.7136],'and looked up as that place');h.requests[1].resolve({status:'not_found'});await settle();
eq(h.props.data.shortAddress,'','the previous place\'s address is cleared when the place changes');
input(tree,LOCATION).props.onChange({target:{value:'الدمام'}});tree=h.render();
eq(input(tree,LOCATION).props['aria-invalid'],true,'text that is not coordinates is marked');ok(text(tree).includes('اكتب الإحداثيات هكذا'),'and explained at once');
input(tree,LOCATION).props.onBlur();await settle();eq(h.requests.length,2,'with no lookup for it');
input(tree,LOCATION).props.onChange({target:{value:''}});tree=h.render();eq(input(tree,LOCATION).props['aria-invalid'],undefined,'an empty location is allowed');
// the map: opens on what is typed, closes on cancel, and a confirmed place replaces the field
input(tree,LOCATION).props.onChange({target:{value:'26.4373, 50.0344'}});tree=h.render();
button(tree,'اختيار على الخريطة').props.onClick();tree=h.render();
ok(picker(tree),'the map opens');eq(plain([picker(tree).props.initial,picker(tree).props.region]),[{latitude:26.4373,longitude:50.0344},''],'on the typed place');
picker(tree).props.onClose();tree=h.render();eq(picker(tree),undefined,'closing it changes nothing');eq(h.props.data.location,'26.4373, 50.0344');
button(tree,'اختيار على الخريطة').props.onClick();tree=h.render();const before=h.requests.length;
picker(tree).props.onPick({latitude:21.5432,longitude:39.1728});await settle();tree=h.render();
eq([h.props.data.location,h.props.data.latitude,h.props.data.locationSource,picker(tree)],['21.5432000, 39.1728000',null,undefined,undefined],'a confirmed place replaces the field, is not a phone capture, and the map closes');
eq([h.requests.length,h.requests.at(-1).body.latitude,h.pending.at(-1)],[before+1,21.5432,true],'it is looked up like a captured one');h.requests.at(-1).resolve({status:'not_found'});await settle();
// back to the phone: a fresh fix replaces what was chosen
choose(h.render(),0);tree=h.render();eq([h.fixes.length,h.pending.at(-1)],[2,true],'choosing the phone again requests a new fix');
h.fixes[1].success(position);await settle();h.requests.at(-1).resolve({status:'not_found'});await settle();tree=h.render();
eq([h.props.data.location,h.props.data.locationSource],['21.5000000, 39.2000000','device'],'and its result replaces the chosen place');
// a late address answer cannot overwrite what was typed meanwhile
h=setup();tree=h.render();choose(tree,1);tree=h.render();input(tree,LOCATION).props.onChange({target:{value:'24.5, 46.5'}});tree=h.render();input(tree,LOCATION).props.onBlur();await settle();
ok(h.requests[0],'the first typed place is looked up');input(tree,LOCATION).props.onChange({target:{value:'25.5, 47.5'}});h.requests[0].resolve({status:'found',shortAddress:'LATE1234',address:'Late street',city:'Late city'});await settle();eq([h.props.data.shortAddress,h.props.data.address],['',''],'an answer for an earlier place is dropped');
// offline: the place is kept and only the address lookup is skipped
h=setup({},'ar',false);tree=h.render();choose(tree,1);tree=h.render();input(tree,LOCATION).props.onChange({target:{value:'26.4, 50.1'}});tree=h.render();input(tree,LOCATION).props.onBlur();await settle();tree=h.render();
eq([h.requests.length,h.pending.at(-1)],[0,false],'offline skips the address lookup and never blocks saving');ok(text(tree).includes('العنوان المختصر غير متاح'),'and says so');
// an existing record: editable as before, plus the map; an unchanged place is not looked up on blur
h=setup({editing:true,data:{location:'21.5, 39.2',latitude:21.5,longitude:39.2,locationSource:'device',locationAccuracy:4,locationCapturedAt:'2026-10-03T12:00:00Z',shortAddress:'OLDD1234',region:'الشرقية'}});tree=h.render();
eq([radios(tree).length,input(tree,LOCATION).props.readOnly],[0,false],'editing has no source switch and an editable field');ok(button(tree,'اختيار على الخريطة'),'but offers the map');ok(button(tree,'تحديث من موقعي الحالي'),'beside the phone update');
input(tree,LOCATION).props.onBlur();await settle();eq(h.requests.length,0,'leaving an unchanged location looks nothing up');
button(tree,'اختيار على الخريطة').props.onClick();tree=h.render();eq(plain([picker(tree).props.initial,picker(tree).props.region]),[{latitude:21.5,longitude:39.2},'الشرقية'],'the map opens on the saved place in its region');
picker(tree).props.onPick({latitude:26,longitude:50});await settle();h.requests[0].resolve({status:'not_found'});await settle();eq([h.props.data.location,h.props.data.locationSource,h.props.data.locationCapturedAt,h.props.data.shortAddress],['26.0000000, 50.0000000',undefined,undefined,'OLDD1234'],'a corrected place drops the phone metadata and keeps the typed address');
h=setup({},'en');tree=h.render();eq(modeChoices(tree).map(text),['My current location','Another location'],'English labels');choose(tree,1);tree=h.render();ok(button(tree,'Choose on the map'));input(tree,'Location (latitude, longitude)').props.onChange({target:{value:'abc'}});tree=h.render();ok(text(tree).includes('Enter coordinates like 26.4373, 50.0344'),'English hint');h.unmount();
console.log(JSON.stringify({ok:true,checks,coverage:'real foreground customer GPS, bounded address API, manual/refresh races, cancel, edit metadata, permission fallback, classification radios, another location typed or chosen on a map',realBrowser:false,realDevice:false}));
