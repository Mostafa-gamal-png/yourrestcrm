// Execute the actual map-to-journey adapter and native-state parser with controlled hooks.
// External windows, tracker acknowledgment and Android bridge are simulated; no device/browser claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';

const root=process.cwd(),compiler={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true};
let instant=Date.parse('2026-09-30T09:00:00Z');const NativeDate=Date;
class FakeDate extends NativeDate{constructor(...args){super(...(args.length?args:[instant]));}static now(){return instant;}}
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
const plain=value=>JSON.parse(JSON.stringify(value));
function load(filename,require,globals={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,require,console,Date:FakeDate,Intl,setTimeout,clearTimeout,setInterval,clearInterval,...globals});return exports;}
const locations=load('lib/customer-location.ts',()=>({})),journey=load('lib/journey-client.ts',()=>({}));
const member={id:'rep',role:'rep',active:1,regionScope:'western',branch:'HQ'};
const customer={id:'factory',kind:'customer',version:7,data:{name:'مصنع أفلاك',region:'الغربية',location:'21.512345, 39.298765'}};
const makeStop=(patch={})=>({id:'journey-rep-test',memberId:'rep',customerId:'factory',date:journey.journeyDay(),closedAt:null,selectedAt:new FakeDate().toISOString(),...patch});
const readyState={tracking:true,permission:'granted',memberId:'rep',stopId:'journey-rep-test',pendingCount:0,error:'',directionsSupported:true};
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function CustomerMap(){}
function harness(options={}){
 let props={me:{...member},customers:[structuredClone(customer)],scopeKey:'rep:western:1',...options.props},language=options.language||'ar',dirty=true,cursor=0,tree;
 const hooks=[],effects=[],events=[],selected=[],nativeCalls=[],windows=[],network=[];
 let nativeState={...readyState,...options.nativeState};
 const window=new EventTarget();window.location={assigned:[],assign(value){events.push('assign');this.assigned.push(value);}};const navigator={userAgent:options.native===false?'Mozilla/5.0 Android':'Mozilla/5.0 Android YourrestCRM-Android/1'};
 window.open=(url,target)=>{
  events.push('open');if(options.popupBlocked)return null;
  const destination={closed:false,opener:{untrusted:true},document:{title:'',body:{textContent:''}},replaced:[],closeCount:0,location:{replace(value){events.push('replace');destination.replaced.push(value);}},close(){events.push('close');this.closed=true;this.closeCount++;}};
  windows.push({url,target,destination});return destination;
 };
 window.__yourrestNative={request:async(method,payload)=>{
  nativeCalls.push({method,payload});events.push('native:'+method);
  if(options.nativeFailure===method)throw Error(options.nativeFailureMessage||'Simulated native failure');
  if(method==='status'&&options.statusDeferred)return options.statusDeferred.promise;
  if(method==='directions'&&options.directionsDeferred)return options.directionsDeferred.promise;
  return {...nativeState};
 }};
 const native=load('lib/native-tracking.ts',()=>({}),{window,navigator});
 const tracker={active:null,tracking:false,paused:false,foregroundDirectionsSupported:options.foreground!==false,errorMessage:options.trackerFailure||'',selectFailure:()=>options.selectionFailure||'',stopFor:id=>tracker.active?.customerId===id?tracker.active:null};
 const selectCustomer=id=>{events.push('select');selected.push(id);return Promise.resolve(options.select?options.select(id):makeStop()).then(stop=>{if(stop){tracker.active=stop;tracker.tracking=true;}return stop;});};
 tracker.selectCustomer=selectCustomer;
 const changed=(a,b)=>!a||!b||a.length!==b.length||a.some((value,index)=>!Object.is(value,b[index]));
 const mockReact={...React,useState(initial){const i=cursor++;if(!hooks[i])hooks[i]={value:typeof initial==='function'?initial():initial};return[hooks[i].value,next=>{const value=typeof next==='function'?next(hooks[i].value):next;if(!Object.is(value,hooks[i].value)){hooks[i].value=value;dirty=true;}}];},useRef(initial){const i=cursor++;return hooks[i]||(hooks[i]={current:initial});},useEffect(callback,deps){const i=cursor++;if(!hooks[i]||changed(hooks[i].deps,deps)){const old=hooks[i];hooks[i]={deps,cleanup:old?.cleanup};effects.push(()=>{hooks[i].cleanup?.();hooks[i].cleanup=callback();});}}};
 const Component=load('app/customer-journey-map.tsx',name=>{
  if(name==='react')return mockReact;if(name==='react/jsx-runtime')return jsx;
  if(name==='@/lib/customer-directions')return load('lib/customer-directions.ts',()=>locations);if(name==='@/lib/directions-problem')return load('lib/directions-problem.ts',()=>({}));if(name==='@/lib/directions-attempt')return load('lib/directions-attempt.ts',()=>({}));if(name==='@/lib/tracking-window')return load('lib/tracking-window.ts',()=>({}));if(name==='@/lib/customer-location')return locations;if(name==='@/lib/journey-client')return journey;if(name==='@/lib/native-tracking')return native;
  if(name==='@/lib/i18n')return{useLanguage:()=>({language})};if(name==='./journey-tracker')return{useJourneyTracker:()=>tracker};
  if(name==='./customer-map')return{__esModule:true,default:CustomerMap};throw Error('Unexpected dependency '+name);
 },{window,navigator,fetch:(...args)=>{network.push(args);throw Error('Map directions must not create visits or call a second API');}}).default;
 function flush(){for(let attempt=0;dirty&&attempt<12;attempt++){dirty=false;cursor=0;tree=Component(props);for(const effect of effects.splice(0))effect();}if(dirty)throw Error('Unexpected render loop');return tree;}
 flush();return{events,selected,nativeCalls,windows,network,native,location:window.location,flush,get tree(){return tree;},get ready(){return tree.props.directionsReady;},run:(id='factory',signal=new AbortController().signal)=>tree.props.onDirections?.(id,signal),update(patch){props={...props,...patch};dirty=true;return flush();},nativeState:patch=>{nativeState={...nativeState,...patch};},trackerState(patch){Object.assign(tracker,patch);dirty=true;return flush();},unmount(){for(const hook of hooks)hook?.cleanup?.();}};
}
const url='https://www.google.com/maps/dir/?api=1&destination=21.512345%2C39.298765&travelmode=driving&dir_action=navigate';
eq(locations.mapsLink(customer.data),url,'Every customer/visit Maps link uses the same fixed native-compatible navigation URL');
for(const data of [{name:'Factory',city:'Jeddah'},{location:'0,0'},{latitude:91,longitude:39},{location:'not a coordinate'}])eq(locations.mapsLink(data),null,'A generic customer or visit link never invents a destination');
const canonicalLink=new URL(locations.mapsLink({location:'24,46'}));eq([...canonicalLink.searchParams.keys()],['api','destination','travelmode','dir_action'],'Shared link has exactly the native parser’s four supported fields');eq(canonicalLink.searchParams.get('destination'),'24,46');eq(canonicalLink.searchParams.get('travelmode'),'driving');eq(canonicalLink.searchParams.get('dir_action'),'navigate');
const link=target=>({customerId:'factory',href:url,target,version:7});
for(const language of ['ar','en']){
 const gate=defer(),h=harness({language,select:()=>gate.promise});
 const pending=h.run();h.flush();
 eq(plain(h.ready),link('_self'),'Maps destination is available before recording acknowledgment');
 eq(h.events,['select'],'Native launcher invokes its asynchronous bridge next without waiting for station recording');
 for(let i=0;i<8&&!h.nativeCalls.length;i++)await Promise.resolve();
 eq(h.nativeCalls.map(call=>call.method),['openDirections'],'Foreground native command opens Maps before recording completes');
 eq(plain(h.nativeCalls[0].payload),{latitude:21.512345,longitude:39.298765},'Foreground Maps gets only saved numeric coordinates');
 ok(h.tree.props.recordingNotice.text.includes(language==='ar'?'جارٍ تأكيد':'Confirming'),'Recording is visibly pending, never claimed saved before ack');
 eq(await h.run(),false,'Duplicate in-flight taps cannot create another recorded stop');
 gate.resolve(makeStop());eq(await pending,true);h.flush();
 eq(h.nativeCalls.map(call=>call.method),['openDirections'],'Recording acknowledgment never launches Maps a second time');
 ok(h.tree.props.recordingNotice.text.includes(language==='ar'?'تم تسجيل محطة':'stop is recorded'),'Recorded stop is confirmed only after valid ack');
 eq(h.network.length,0,'Adapter does not create visits or bypass the tracker API');
 const old=harness({language,foreground:false});const oldPending=old.run();
 eq(old.location.assigned,[url],'Old APK uses the fixed HTTPS destination from the original tap');
 eq(await oldPending,true);old.flush();eq(old.nativeCalls.length,0,'Old APK receives no unsupported or bound directions command');eq(plain(old.ready),link('_self'));
 const wait=defer(),browser=harness({language,native:false,select:()=>wait.promise});const browserPending=browser.run();browser.flush();
 eq(browser.events,['open','select'],'Browser opens exact destination synchronously before any pending recording');
 eq(browser.windows[0].url,url,'Browser uses saved factory coordinates directly');eq(browser.windows[0].target,'_blank');eq(browser.windows[0].destination.opener,null,'External map cannot reach CRM via opener');
 wait.resolve(null);eq(await browserPending,true,'A rejected recording does not undo the opened Maps action');browser.flush();
 eq(browser.windows[0].destination.closeCount,0,'Navigation stays available when recording fails');
 ok(browser.tree.props.recordingNotice.error,'Failed recording has an error state');
 ok(!browser.tree.props.recordingNotice.text.includes(language==='ar'?'تم تسجيل محطة':'stop is recorded'),'Failed recording never claims stop saved');eq(plain(browser.ready),link('_blank'));
 const blocked=harness({language,native:false,popupBlocked:true});eq(await blocked.run(),true);blocked.flush();const blockedMessage=blocked.tree.props.navigationError.text;
 ok(blockedMessage.includes(language==='ar'?'المتصفح منع':'browser blocked'),'Popup blocking asks for a genuine retry tap');eq(plain(blocked.ready),link('_blank'),'Popup failure leaves a fixed explicit link');
 for(const problem of ['native_upgrade_required','background_permission_required','native_pending_sync','native_unavailable','offline','API connection failed']){
  const failed=harness({language,select:()=>null,selectionFailure:problem});eq(await failed.run(),true,'Recording problem never blocks Maps: '+problem);failed.flush();
  eq(failed.nativeCalls.map(call=>call.method),['openDirections']);ok(failed.tree.props.recordingNotice.error);eq(plain(failed.ready),link('_self'));
  if(problem.startsWith('native_')||problem==='background_permission_required')ok(!failed.tree.props.recordingNotice.text.includes(problem),'Known recording problem has actionable translated detail');
 }
 const failed=harness({language,nativeFailure:'openDirections',nativeFailureMessage:'maps_launch_failed: both handlers unavailable',select:()=>null});eq(await failed.run(),true);failed.flush();const message=failed.tree.props.navigationError.text;
 ok(message.includes(language==='ar'?'تعذر فتح Google Maps':'Neither Google Maps'),'Native launch failure has a clear separate error');
 ok(!message.includes(language==='ar'?'الرحلة مسجلة':'trip is recorded'),'Maps failure never fabricates a recorded trip');
 ok(failed.tree.props.recordingNotice.error);eq(plain(failed.ready),link('_self'),'Foreground launch failure retains only the scoped fixed destination retry');
}
// Launch failures are visible while the recording request is still unresolved.
const stalled=defer(),launchFailed=harness({select:()=>stalled.promise,nativeFailure:'openDirections',nativeFailureMessage:'maps_launch_failed: none'}),launchWaiting=launchFailed.run();
for(let i=0;i<16;i++)await Promise.resolve();launchFailed.flush();ok(launchFailed.tree.props.navigationError.text.includes('تعذر فتح Google Maps'),'Maps failure is not held behind an unresolved recording request');ok(launchFailed.tree.props.recordingNotice.text.includes('جارٍ تأكيد'),'Recording remains truthfully pending, independently of Maps failure');stalled.resolve(null);await launchWaiting;
for(const native of [true,false]){
 for(const stop of [null,makeStop({customerId:'other'}),makeStop({closedAt:new FakeDate().toISOString()}),makeStop({date:'2026-09-29'})]){
  const h=harness({native,select:()=>stop});eq(await h.run(),true,'Invalid station ack does not prevent independently authorized Maps');h.flush();
  ok(h.tree.props.recordingNotice.error,'Bad acknowledgment cannot claim trip recorded');eq(plain(h.ready),link(native?'_self':'_blank'));
  if(native)eq(h.nativeCalls.map(call=>call.method),['openDirections']);else eq(h.windows[0].url,url);
 }
 const failed=harness({native,select:()=>Promise.reject(Error('API unavailable'))});eq(await failed.run(),true);failed.flush();ok(failed.tree.props.recordingNotice.error);ok(failed.tree.props.recordingNotice.text.includes('API unavailable'),'Exact recording failure retained');
 const controller=new AbortController();controller.abort();const aborted=harness({native});eq(await aborted.run('factory',controller.signal),false);eq(aborted.selected.length,0);eq(aborted.windows.length,0);eq(aborted.nativeCalls.length,0);
 for(const change of ['abort','scope','account','inactive','removed','coordinates','version','unmount']){
  const gate=defer(),signal=new AbortController(),h=harness({native,select:()=>gate.promise}),pending=h.run('factory',signal.signal);
  // This launch belongs to the original customer tap. No later asynchronous
  // tracking completion may initiate another app handoff or update another user.
  for(let i=0;i<8&&native&&!h.nativeCalls.length;i++)await Promise.resolve();
  const launchCount=h.nativeCalls.length,windowCount=h.windows.length;
  if(change==='abort')signal.abort();
  if(change==='scope')h.update({scopeKey:'rep:eastern:2'});
  if(change==='account')h.update({me:{...member,id:'other'}});
  if(change==='inactive')h.update({me:{...member,active:0}});
  if(change==='removed')h.update({customers:[]});
  if(change==='coordinates')h.update({customers:[{...customer,data:{...customer.data,location:'24,46'}}]});
  if(change==='version')h.update({customers:[{...customer,version:8}]});
  if(change==='unmount')h.unmount();
  gate.resolve(makeStop());eq(await pending,false,change+' invalidates pending recording feedback');h.flush();
  eq(h.nativeCalls.length,launchCount,change+' late ack never launches another Maps command');eq(h.windows.length,windowCount,change+' late ack never opens another tab');
  if(!['abort','unmount'].includes(change))eq(h.ready,null,change+' invalidates retry destination');
  if(!['abort','unmount'].includes(change))eq(h.tree.props.recordingNotice,null,change+' invalidates recording feedback');
 }
 const held=defer(),cancel=new AbortController(),work=harness({native,select:()=>held.promise});const waiting=work.run('factory',cancel.signal);cancel.abort();eq(await waiting,false,'Unresolved recording cancels promptly');held.reject(new Error('late selection rejection'));await Promise.resolve();await Promise.resolve();work.unmount();
}
for(const role of ['customer_service','customer_service_manager','unknown']){const h=harness({props:{me:{...member,role}}});eq(h.tree.props.onDirections,undefined,'Unauthorized role has no travel action');eq(h.selected.length,0);}
const inactive=harness({props:{me:{...member,active:0}}});eq(inactive.tree.props.onDirections,undefined);
for(const props of [{customers:[]},{customers:[{...customer,data:{name:'Factory',city:'جدة'}}]},{customers:[{...customer,data:{latitude:0,longitude:0}}]},{customers:[{...customer,data:{location:'91,39'}}]}]){
 const h=harness({native:false,props});eq(await h.run(),false,'Unknown customer or missing/invalid coordinates starts nothing');eq(h.selected.length,0);eq(h.windows.length,0,'No coordinates inferred from city/name');
}
for(const role of ['rep','supervisor','manager','admin'])ok(typeof harness({props:{me:{...member,role}}}).tree.props.onDirections==='function','Sales role '+role+' retains travel action');
const parser=harness().native;
for(const cap of ['foregroundDirectionsSupported','directionsSupported','mapsLaunchSupported'])for(const [value,expected] of [[true,true],[undefined,false],[false,false],['true',false],[1,false],[{},false]])eq(parser.normalizeNativeState({...readyState,[cap]:value})[cap],expected,cap+' requires literal true');
eq(parser.normalizeNativeState({...readyState,appVersion:'1.0.6'}).appVersion,'1.0.6');eq(parser.normalizeNativeState({...readyState,appVersion:undefined}).appVersion,'');
for(const [value,expected] of [[0,0],[2,2],[2.8,2],[undefined,null],[-1,null],['0',null],[NaN,null]])eq(parser.normalizeNativeState({...readyState,pendingGapCount:value}).pendingGapCount,expected,'Omitted old APK queue is unknown, never invented empty');
// Pending uploads, stopped GPS or consent are recording conditions, not permission
// to expose extra customer data: Maps retains only the current authorized row.
for(const patch of [{tracking:false},{permission:'denied'},{memberId:'other'},{stopId:'other-stop'},{error:'gps_unavailable'}]){
 const h=harness({nativeState:patch,select:()=>null,selectionFailure:'permission_denied'});eq(await h.run(),true);h.flush();eq(h.nativeCalls.map(call=>call.method),['openDirections']);ok(h.tree.props.recordingNotice.error);
}
for(const change of ['removed','coordinates','version','inactive','role','scope','account']){
 const h=harness();await h.run();h.flush();ok(h.ready);
 if(change==='removed')h.update({customers:[]});
 if(change==='coordinates')h.update({customers:[{...customer,data:{...customer.data,location:'24,46'}}]});
 if(change==='version')h.update({customers:[{...customer,version:8}]});
 if(change==='inactive')h.update({me:{...member,active:0}});
 if(change==='role')h.update({me:{...member,role:'customer_service'}});
 if(change==='scope')h.update({scopeKey:'rep:eastern:2'});
 if(change==='account')h.update({me:{...member,id:'other'}});
 eq(h.ready,null,change+' invalidates existing retry');eq(h.tree.props.recordingNotice,null,change+' clears the old recording confirmation');
}
const retained=harness();await retained.run();retained.flush();retained.trackerState({active:null,tracking:false,paused:true});eq(plain(retained.ready),link('_self'),'GPS outage never removes scoped customer navigation');
// Maps works at both sides of the schedule boundary. A late station cannot be
// counted as saved for the wrong day; no automatic second Maps launch occurs.
instant=NativeDate.parse('2026-10-01T14:59:59.000Z');const boundary=defer(),cross=harness({select:()=>boundary.promise}),crossing=cross.run();instant+=1000;boundary.resolve(makeStop());eq(await crossing,true);cross.flush();eq(cross.nativeCalls.map(call=>call.method),['openDirections']);cross.unmount();
instant=NativeDate.parse('2026-10-01T15:00:00.000Z');
for(const native of [true,false]){
 const h=harness({native});eq(await h.run(),true,'Directions work at 18:00 Saudi');h.flush();eq(h.selected.length,0,'Off-hours navigation creates no route station');
 if(native)eq(h.nativeCalls.map(call=>call.method),['openDirections'],'Off-hours foreground command has no GPS preparation');else eq(h.windows[0].url,url);
 ok(h.tree.props.recordingNotice.text.includes(native?'6':'6'));eq(h.tree.props.recordingNotice.error,false);h.unmount();
}
console.log(JSON.stringify({ok:true,checks,coverage:'actual map adapter and native capability parser with controlled React hooks; immediate canonical scoped Maps, independent acknowledged recording, API/offline/GPS/consent failures, old APK, popup retry, account/region/customer races and Saudi hours',realBrowser:false,realDevice:false,network:false}));
