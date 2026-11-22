// The mandatory Android update (lib/app-update.ts) on the real module, transpiled into .sites-runtime as the build does, over small fakes of the
// environment it asks (the bridge, the served release, the APK probe, the clock and the listeners). Made-up versions only.
// 1. Version comparison and the APK path: numeric by part (1.0.10 after 1.0.9), a malformed or non-text version is never judged.
// 2. parseAppRelease: the only form of release the app accepts (fixed host, immutable versioned path, hashes, sizes, notes bounded), and the
//    minimum is always the newest published code whatever a manifest says.
// 3. enforcedRequirement / appUpdateRequired: platform (native only), offline, unreadable release, unreachable APK, exact code or name.
// 4. The controller: the old protocol (version name from `status`), the native protocol (events, clamps, stale events), the 15-second
//    throttle, the 15-minute timer, the listeners, the actions and their guards.
import assert from 'node:assert/strict';
import {createLoader,makeChecks} from '../scripts/lib/load-ts.mjs';

const {load}=createLoader('app-update-unit');
const U=await load('lib/app-update.ts');
const {eq,ok,throws,report}=makeChecks(assert);
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};

// ---- 1. versions
const cmp=[['1.0.9','1.0.10',-1],['1.0.10','1.0.9',1],['1.0.0','1.0.0',0],['2.0.0','1.99.99',1],['1.2.0','1.10.0',-1],['0.0.1','0.0.0',1],['10.0.0','9.9.9',1],['001.0.0','1.0.0',0]];
for(const [a,b,r] of cmp)eq(U.compareAppVersions(a,b),r,`compare ${a} ${b}`);
for(const bad of ['','1.0','1.0.0.0','v1.0.0','1.0.0-beta','١.٠.٠',' 1.0.0','1.0.0 ','1.0.0‏','1.0.0\n','a.b.c','1..0',null,undefined,5,{},['1.0.0']]){eq(U.compareAppVersions(bad,'1.0.0'),null,'malformed left '+JSON.stringify(bad));eq(U.compareAppVersions('1.0.0',bad),null,'malformed right '+JSON.stringify(bad));}
eq(U.servedApkPath('1.0.15',16),'/downloads/yourrest-crm-android-v1.0.15-16.apk','apk path');
eq(U.servedApkPath('123456.1.1',999999),'/downloads/yourrest-crm-android-v123456.1.1-999999.apk','six digits allowed');
for(const [n,c] of [['1.0.15',0],['1.0.15',-1],['1.0.15',1.5],['1.0.15',null],['1.0.15',NaN],['1.0.15',Infinity],['1234567.0.0',1],['1.0',1],['1.0.0/../x',1],['',1],['١.٠.٠',1],['1.0.0‏',1],['1.0.15','16']])eq(U.servedApkPath(n,c),'','no path for '+JSON.stringify([n,c]));
eq(U.UPDATE_CHECK_INTERVAL,900000,'every 15 minutes');

// ---- 2. the release
const SHA='a'.repeat(64),CERT='B'.repeat(64);
const release=(over={})=>({schemaVersion:1,packageName:'org.yourrest.crm',versionName:'1.0.16',versionCode:17,minimumVersionCode:1,apkUrl:'https://crm.yourrest.org/downloads/yourrest-crm-android-v1.0.16-17.apk',sizeBytes:2400000,sha256:SHA.toUpperCase(),certificateSha256:CERT,releaseNotes:{ar:['تحسينات'],en:['Improvements']},...over});
const good=U.parseAppRelease(release());
eq([good.versionName,good.versionCode,good.minimumVersionCode,good.sizeBytes],['1.0.16',17,17,2400000],'minimum is the newest code, never the manifest minimum');
eq([good.sha256,good.certificateSha256],[SHA,CERT.toLowerCase()],'hashes lowercased');
eq(U.parseAppRelease(release({minimumVersionCode:99})).minimumVersionCode,17,'a higher manifest minimum is not read either');
eq(U.parseAppRelease(release({minimumVersionCode:undefined})).minimumVersionCode,17,'no minimum in the manifest');
eq(good.apkUrl,release().apkUrl,'the url kept');
const apk=(n,c)=>`https://crm.yourrest.org/downloads/yourrest-crm-android-v${n}-${c}.apk`;
const bad=[null,undefined,'x',5,[],[release()],{},release({schemaVersion:2}),release({schemaVersion:'1'}),release({packageName:'org.other.app'}),release({versionCode:0}),release({versionCode:-3}),release({versionCode:1.5}),release({versionCode:'17'}),release({versionCode:Number.MAX_SAFE_INTEGER+2}),release({versionCode:null}),
 release({sizeBytes:0}),release({sizeBytes:'1'}),release({sizeBytes:-1}),release({versionName:'1.0'}),release({versionName:'1.0.16-rc'}),release({versionName:'١.٠.١٦'}),release({versionName:7}),release({sha256:'abc'}),release({sha256:'g'.repeat(64)}),release({sha256:SHA+'0'}),release({sha256:5}),release({certificateSha256:'1'}),release({certificateSha256:undefined}),
 release({apkUrl:apk('1.0.16',17).replace('https:','http:')}),release({apkUrl:apk('1.0.16',17).replace('crm.yourrest.org','evil.example')}),release({apkUrl:apk('1.0.16',17).replace('.org/','.org:8443/')}),release({apkUrl:apk('1.0.16',17).replace('https://','https://user:pw@')}),release({apkUrl:apk('1.0.16',17)+'?x=1'}),release({apkUrl:apk('1.0.16',17)+'#f'}),release({apkUrl:apk('1.0.15',17)}),release({apkUrl:apk('1.0.16',16)}),release({apkUrl:apk('1.0.16',17).replace('/downloads/','/other/')}),release({apkUrl:'https://crm.yourrest.org/downloads/../downloads/x.apk'}),release({apkUrl:'not a url'}),release({apkUrl:''}),release({apkUrl:42})];
for(const [i,value] of bad.entries())throws(()=>U.parseAppRelease(value),`refused release #${i}`);
const noted=U.parseAppRelease(release({releaseNotes:{ar:['١','٢','٣','٤','٥','٦','٧'],en:['x'.repeat(500),5,null,'ok']}}));
eq(noted.releaseNotes.ar.length,5,'five notes at most');eq(noted.releaseNotes.en,['x'.repeat(200),'ok'],'notes cut at 200 characters, non-text left out');
for(const n of [undefined,null,'x',5,[],{ar:'text',en:{}}])eq(U.parseAppRelease(release({releaseNotes:n})).releaseNotes,{ar:[],en:[]},'bad notes become none: '+JSON.stringify(n));

// ---- 3. who is held at the update screen
const st=(over={})=>({native:true,protocol:1,phase:'idle',installedVersionCode:10,installedVersionName:'1.0.9',availableVersionCode:null,availableVersionName:'',downloadedBytes:0,totalBytes:0,progress:0,error:'',offline:false,legacyUrl:'',legacyStarted:false,releaseNotes:{ar:[],en:[]},requiredVersionCode:17,requiredVersionName:'1.0.16',requiredReleaseNotes:{ar:[],en:[]},apkReachable:true,...over});
eq(U.enforcedRequirement(st()),{code:17,name:'1.0.16'},'enforced when everything holds');
for(const [label,over] of [['browser',{native:false}],['offline',{offline:true}],['no release read',{requiredVersionCode:null}],['bad required name',{requiredVersionName:'1.0'}],['apk unknown',{apkReachable:null}],['apk unreachable',{apkReachable:false}]])eq(U.enforcedRequirement(st(over)),null,'fail-open: '+label);
ok(U.appUpdateRequired(st()),'older exact code is held');
ok(!U.appUpdateRequired(st({installedVersionCode:17})),'same code');ok(!U.appUpdateRequired(st({installedVersionCode:99})),'newer code');
ok(!U.appUpdateRequired(st({installedVersionCode:10,native:false})),'a browser is never held');
ok(!U.appUpdateRequired(st({installedVersionCode:10,apkReachable:false})),'an unreachable APK holds nobody');
ok(U.appUpdateRequired(st({installedVersionCode:null,installedVersionName:'1.0.9'})),'by name when there is no code');
ok(!U.appUpdateRequired(st({installedVersionCode:null,installedVersionName:'1.0.16'})),'same name');
ok(!U.appUpdateRequired(st({installedVersionCode:null,installedVersionName:'1.1.0'})),'newer name');
ok(!U.appUpdateRequired(st({installedVersionCode:null,installedVersionName:''})),'unknown version is never judged');
ok(!U.appUpdateRequired(st({installedVersionCode:null,installedVersionName:'garbage'}),'also garbage'),'malformed never judged');
ok(U.appUpdateRequired(st({installedVersionCode:null,installedVersionName:''}),'1.0.3'),'the tracking service version decides when the name is unknown');
ok(!U.appUpdateRequired(st({installedVersionCode:null,installedVersionName:''}),'1.0.16‏'),'a reported version with a hidden mark is not judged');
ok(U.appUpdateRequired(st({installedVersionCode:0})),'an exact code 0 is older than 17: held');

// ---- 4. the controller
function nativeState(phase='available',over={}){return {phase,installedVersionCode:10,installedVersionName:'1.0.9',availableVersionCode:17,availableVersionName:'1.0.16',downloadedBytes:0,totalBytes:0,progress:0,error:'',releaseNotes:{ar:[],en:[]},...over};}
function fixture({native=true,online=true,protocol=1,status,installed='1.0.9',rel=release(),relFails=false,probe=true,probeThrows=false,bridgeFails=false,every=true}={}){
 const f={calls:[],fetches:0,probes:[],clock:1_000_000,online,native,rel,relFails,probe,handlers:{},timers:[],stops:0};
 f.nativeState=status===undefined?nativeState('available'):status;
 const bridge={updateProtocol:protocol,request:async(method)=>{f.calls.push(method);if(method==='status'&&protocol!==1)return {appVersion:installed};if(['updateStatus','checkAppUpdate','downloadAppUpdate','installAppUpdate'].includes(method))return f.nativeState;return {};}};
 const env={native:()=>f.native,online:()=>f.online,bridge:async()=>{if(bridgeFails)throw Error('x');return bridge;},fetchRelease:async()=>{f.fetches++;if(f.relFails)throw Error('down');return f.rel;},probeApk:async p=>{f.probes.push(p);if(probeThrows)throw Error('p');return f.probe;},now:()=>f.clock,
  listen:(event,handler)=>{(f.handlers[event]??=[]).push(handler);return()=>{f.stops++;f.handlers[event]=f.handlers[event].filter(h=>h!==handler);};}};
 if(every)env.every=(ms,handler)=>{f.timers.push({ms,handler});return()=>{f.stops++;};};
 f.controller=U.createAppUpdateController(env);f.state=()=>f.controller.snapshot();
 f.fire=(event,detail)=>{for(const h of [...(f.handlers[event]||[])])h(detail);};
 return f;
}

// 4a. the old protocol: only the version name from `status`
{const f=fixture({protocol:0});const stop=f.controller.subscribe(()=>{});await settle();
 const s=f.state();eq([s.phase,s.protocol,s.installedVersionName,s.installedVersionCode,s.availableVersionName,s.legacyUrl],['available',0,'1.0.9',null,'1.0.16',release().apkUrl],'old app, older version: update available through the legacy url');
 eq([s.requiredVersionCode,s.apkReachable],[17,true],'requirement read');ok(U.appUpdateRequired(s),'and enforced by name');eq(f.probes,['/downloads/yourrest-crm-android-v1.0.16-17.apk'],'the apk probed at the served path');
 eq([f.calls,f.fetches,f.timers.map(t=>t.ms)],[['status'],1,[900000]],'status asked, release read once, a 15-minute timer');stop();eq(f.stops>=6,true,'every listener and the timer stopped on unsubscribe');}
{const f=fixture({protocol:0,installed:'1.0.16'});f.controller.subscribe(()=>{});await settle();eq(f.state().phase,'upToDate','same version');ok(!U.appUpdateRequired(f.state()),'not held');}
{const f=fixture({protocol:0,installed:'1.2.0'});f.controller.subscribe(()=>{});await settle();eq(f.state().phase,'upToDate','newer than served');}
{const f=fixture({protocol:0,installed:'garbage'});f.controller.subscribe(()=>{});await settle();eq([f.state().phase,f.state().installedVersionName],['available',''],'an unreadable version name is never invented: update offered');ok(!U.appUpdateRequired(f.state()),'unknown name not held');}
{const f=fixture({protocol:0,relFails:true});f.controller.subscribe(()=>{});await settle();eq([f.state().phase,f.state().error,f.state().requiredVersionCode,f.state().apkReachable],['error','update_check_failed',null,null],'release unreadable: error and the requirement cleared');ok(!U.appUpdateRequired(f.state()),'fail-open');}
{const f=fixture({protocol:0,rel:release({sha256:'zz'})});f.controller.subscribe(()=>{});await settle();eq(f.state().phase,'error','a refused release is an error, never offered');eq(f.probes.length,0,'and its apk is not probed');}
{const f=fixture({protocol:0,probe:false});f.controller.subscribe(()=>{});await settle();eq([f.state().apkReachable,U.appUpdateRequired(f.state())],[false,false],'apk not answering: nobody held');}
{const f=fixture({protocol:0,probeThrows:true});f.controller.subscribe(()=>{});await settle();eq(f.state().apkReachable,false,'a probe that throws is "not reachable"');}
{const f=fixture({protocol:0,bridgeFails:true});f.controller.subscribe(()=>{});await settle();eq([f.state().phase,f.state().installedVersionName],['available',''],'no bridge: the verified download is still offered');}
// 4b. native, offline, browser
{const f=fixture({native:false});f.controller.subscribe(()=>{});await settle();eq([f.fetches,f.state().phase,f.state().native,Object.keys(f.handlers).length],[0,'idle',false,0],'outside the app nothing is read or listened to');await f.controller.check(true);eq(f.fetches,0,'check does nothing in a browser');}
{const f=fixture({online:false});f.controller.subscribe(()=>{});await settle();eq([f.fetches,f.state().offline,f.state().phase],[0,true,'idle'],'offline: no read, flagged');}
// 4c. throttle, timer, listeners
{const f=fixture();const stop=f.controller.subscribe(()=>{});await settle();eq(f.fetches,1,'first check');
 await f.controller.check();eq(f.fetches,1,'a second check within 15 s is skipped');f.clock+=14_999;await f.controller.check();eq(f.fetches,1,'14.999 s later still skipped');f.clock+=1;await f.controller.check();eq(f.fetches,2,'15 s later it asks again');
 await f.controller.check(true);eq(f.fetches,3,'force skips the throttle');
 f.timers[0].handler();await settle();eq(f.fetches,4,'the timer forces a check');
 f.fire('visible');await settle();eq(f.fetches,5,'returning to the app checks');f.fire('yourrest:native-ready');await settle();eq(f.fetches,6,'bridge ready checks');
 f.online=false;f.fire('offline');await settle();eq([f.state().offline,f.fetches],[true,6],'offline event flags it, reads nothing');f.online=true;f.fire('online');await settle();eq([f.state().offline,f.fetches],[false,7],'back online checks');
 stop();}
{const f=fixture();const seenStates=[];const stop=f.controller.subscribe(s=>seenStates.push(s.phase));eq(seenStates[0],'idle','subscribers are told the current state at once');await settle();ok(seenStates.includes('available'),'and each change');const n=seenStates.length;stop();f.fire('visible');await settle();eq(seenStates.length,n,'no more after unsubscribe');}
{const f=fixture({every:false});f.controller.subscribe(()=>{});await settle();eq(f.timers.length,0,'no timer when the environment has none');}
// 4d. native protocol
{const f=fixture();f.controller.subscribe(()=>{});await settle();eq(f.calls,['updateStatus','checkAppUpdate'],'status then check');const s=f.state();eq([s.protocol,s.phase,s.installedVersionCode,s.availableVersionCode,s.legacyUrl],[1,'available',10,17,''],'native state taken, no legacy url');eq([s.requiredVersionCode,s.apkReachable],[17,true],'requirement from the site\'s own read');}
for(const phase of ['downloading','ready','permissionRequired','installing','cancelled']){const f=fixture({status:nativeState(phase)});f.controller.subscribe(()=>{});await settle();eq(f.calls,['updateStatus'],'a running '+phase+' is not checked again');eq(f.state().phase,phase,'phase kept '+phase);}
{const f=fixture({status:nativeState('available',{installedVersionCode:17,installedVersionName:'1.0.16'})});f.controller.subscribe(()=>{});await settle();eq(f.state().phase,'upToDate','installed code reaching the available code is up to date');}
{const f=fixture({status:nativeState('ready',{installedVersionCode:17,installedVersionName:'1.0.16'})});f.controller.subscribe(()=>{});await settle();eq(f.state().phase,'upToDate','a downloader response never proves installation, the installed code does');}
{const f=fixture({status:nativeState('upToDate')});f.controller.subscribe(()=>{});await settle();eq(f.state().phase,'available','upToDate claimed while installed < available is corrected');}
{const f=fixture({status:nativeState('available',{progress:250,downloadedBytes:-5,totalBytes:'x'})});f.controller.subscribe(()=>{});await settle();eq([f.state().progress,f.state().downloadedBytes,f.state().totalBytes],[100,0,0],'progress clamped, bad counts zero');}
{const f=fixture({status:nativeState('available',{progress:-9})});f.controller.subscribe(()=>{});await settle();eq(f.state().progress,0,'negative progress is zero');}
for(const badState of [null,'x',[],{phase:'nope',installedVersionCode:10,installedVersionName:'1.0.9'},{phase:'available',installedVersionCode:0,installedVersionName:'1.0.9'},{phase:'available',installedVersionCode:10,installedVersionName:'x'}]){const f=fixture({status:badState});f.controller.subscribe(()=>{});await settle();eq([f.state().phase,f.state().error],['error','update_check_failed'],'invalid native answer is an error: '+JSON.stringify(badState));eq(f.state().requiredVersionCode,17,'but the site\'s requirement was still read');}
// events
{const f=fixture();f.controller.subscribe(()=>{});await settle();
 f.fire('yourrest:app-update',nativeState('downloading',{progress:40}));eq([f.state().phase,f.state().progress],['downloading',40],'event applied');
 f.fire('yourrest:app-update',nativeState('available',{installedVersionCode:9,installedVersionName:'1.0.8'}));eq(f.state().installedVersionCode,10,'an event from an older installed code is ignored');
 f.fire('yourrest:app-update',{phase:'upToDate'});eq(f.state().phase,'downloading','a malformed event is ignored');
 f.fire('yourrest:app-update',nativeState('upToDate',{installedVersionCode:17,installedVersionName:'1.0.16'}));eq([f.state().phase,f.state().installedVersionCode],['upToDate',17],'installed code confirms the update');}
// actions
{const f=fixture({status:nativeState('available')});f.controller.subscribe(()=>{});await settle();f.nativeState=nativeState('downloading',{progress:5});await f.controller.download();eq([f.calls.at(-1),f.state().phase],['downloadAppUpdate','downloading'],'download');await f.controller.download();eq(f.calls.filter(c=>c==='downloadAppUpdate').length,1,'a second tap does not start another download');
 f.nativeState=nativeState('ready');f.fire('yourrest:app-update',nativeState('ready'));await f.controller.install();eq(f.calls.at(-1),'installAppUpdate','install');f.nativeState=nativeState('installing');await f.controller.install();eq(f.state().phase,'installing','installing');await f.controller.install();eq(f.calls.filter(c=>c==='installAppUpdate').length,2,'no install while installing');}
{const f=fixture();f.controller.subscribe(()=>{});await settle();f.online=false;await f.controller.download();eq([f.calls.includes('downloadAppUpdate'),f.state().offline],[false,true],'offline download is not requested');f.fire('yourrest:app-update',nativeState('ready'));f.nativeState=nativeState('installing');await f.controller.install();eq(f.calls.at(-1),'installAppUpdate','a downloaded apk installs offline');}
{const f=fixture({protocol:0});f.controller.subscribe(()=>{});await settle();await f.controller.download();await f.controller.install();eq(f.calls.some(c=>/AppUpdate/.test(c)),false,'the old protocol has no native download or install');}
{const f=fixture();f.controller.subscribe(()=>{});await settle();f.nativeState=null;await f.controller.download();eq([f.state().phase,f.state().error],['error','update_action_failed'],'a failing action is an error');}
{const f=fixture({native:false});await f.controller.download();await f.controller.install();eq(f.calls,[],'no actions in a browser');}
{const f=fixture({protocol:0});f.controller.subscribe(()=>{});await settle();eq(f.state().legacyStarted,false,'legacy download not started');f.controller.legacyDownloadStarted();eq(f.state().legacyStarted,true,'legacy download remembered');}
{const f=fixture();f.controller.subscribe(()=>{});const a=f.controller.check(true),b=f.controller.check(true);await Promise.all([a,b]);await settle();ok(f.fetches<=2,'overlapping checks share one run');}

// ---- 5. the controller of the page (lib/app-update.ts appUpdateController): real window, document and fetch stand-ins
{
 const U2=await createLoader('app-update-unit-page').load('lib/app-update.ts');
 const win=new EventTarget(),doc=new EventTarget();doc.visibilityState='visible';
 const intervals=[];win.setInterval=(cb,ms)=>{intervals.push({cb,ms});return intervals.length;};win.clearInterval=id=>{intervals[id-1]=null;};
 globalThis.window=win;globalThis.document=doc;Object.defineProperty(globalThis,'navigator',{value:{userAgent:'Mozilla/5.0 YourrestCRM-Android/1',onLine:true},configurable:true,writable:true});
 const bridgeCalls=[];win.__yourrestNative={updateProtocol:1,request:async method=>{bridgeCalls.push(method);return nativeState('available');}};
 const fetches=[];let releaseResponse={ok:true,json:async()=>release()},headStatus=200,headThrows=false;
 globalThis.fetch=async(url,init)=>{fetches.push([url,init]);if(init.method==='HEAD'){if(headThrows)throw Error('net');return {ok:headStatus>=200&&headStatus<300,status:headStatus};}return releaseResponse;};
 const c=U2.appUpdateController();ok(c===U2.appUpdateController(),'one controller survives page remounts');
 eq(c.snapshot().native,true,'native by the user agent');
 const stop=c.subscribe(()=>{});await settle();
 const rel=fetches.find(f=>f[0]==='/api/app-update');eq([rel[1].cache,rel[1].credentials,rel[1].headers],['no-store','same-origin',{Accept:'application/json'}],'the served release is read fresh, with the session, as JSON');ok(rel[1].signal instanceof AbortSignal,'with a time limit');
 const head=fetches.find(f=>f[1].method==='HEAD');eq([head[0],head[1].cache,head[1].credentials,head[1].redirect],['/downloads/yourrest-crm-android-v1.0.16-17.apk','no-store','omit','manual'],'the apk is asked with HEAD, no cookie, no redirect followed');
 eq([c.snapshot().requiredVersionCode,c.snapshot().apkReachable,c.snapshot().phase],[17,true,'available'],'the requirement and the native state');
 eq(intervals.at(-1).ms,900000,'a 15-minute timer on the window');const before=fetches.length;doc.visibilityState='hidden';intervals.at(-1).cb();await settle();eq(fetches.length,before,'the timer does nothing while the page is hidden');
 doc.visibilityState='visible';intervals.at(-1).cb();await settle();ok(fetches.length>before,'and checks when it is shown');
 // events of the page
 win.dispatchEvent(new CustomEvent('yourrest:app-update',{detail:nativeState('downloading',{progress:30})}));eq([c.snapshot().phase,c.snapshot().progress],['downloading',30],'the app\'s event reaches the controller');
 const n=fetches.length;doc.dispatchEvent(new Event('visibilitychange'));await settle();ok(fetches.length>n,'returning to the page checks');
 // a release that cannot be read, and an apk that does not answer
 for(const [label,status,reachable] of [['405 is not a missing file',405,true],['501 is not a missing file',501,true],['404 is missing',404,false],['500 is missing',500,false]]){headStatus=status;await c.check(true);await settle();eq(c.snapshot().apkReachable,reachable,'HEAD '+label);}
 headStatus=200;headThrows=true;await c.check(true);await settle();eq(c.snapshot().apkReachable,false,'no answer is "not reachable"');headThrows=false;
 releaseResponse={ok:false,json:async()=>({})};await c.check(true);await settle();eq([c.snapshot().requiredVersionCode,c.snapshot().phase],[null,'available'],'a release the server refused to give: the requirement is cleared, the app\'s own state stays');
 releaseResponse={ok:true,json:async()=>{throw Error('bad json');}};await c.check(true);await settle();eq(c.snapshot().requiredVersionCode,null,'unreadable JSON clears it too');
 stop();
}
report();
