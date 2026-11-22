// The route-tracking gate and its neighbours on the real modules (lib/native-tracking.ts, lib/tracking-gate.ts, lib/tracking-companion.ts,
// lib/tracking-coverage-text.ts, lib/directions-*.ts, lib/customer-directions.ts), transpiled into .sites-runtime, over small fakes of
// `window`, `navigator` and the Android bridge. No network, no GPS, made-up members only.
// 1. The native app is recognised by its user agent only; the bridge state is normalised (nothing invented, counts bounded) and the
//    schedule needs app 1.0.7 with the work-hours and Friday support.
// 2. The bridge: waiting for a late bridge with a timeout, a request whose session changed in between is dropped, logout bumps the generation.
// 3. The gate decision for every role, source and permission state; the order of the missing requirements; the companion rule.
// 4. The companion device decision on both sides of the working window, and its memory (storage that may fail).
// 5. The supervisor's sentences about a day (Riyadh time, Arabic and English), the app-version-behind rule.
// 6. Directions: the wait for a native step, the problem texts, the link built only from stored coordinates.
import assert from 'node:assert/strict';
import {createLoader,makeChecks} from '../scripts/lib/load-ts.mjs';

const {load}=createLoader('tracking-unit');
const {eq,ok,throws,rejects,report}=makeChecks(assert);
const events=new EventTarget();
globalThis.window=Object.assign(events,{});
const setUA=ua=>Object.defineProperty(globalThis,'navigator',{value:{userAgent:ua},configurable:true,writable:true});
setUA('Mozilla/5.0 (Linux; Android 14) Chrome/120 YourrestCRM-Android/1');
const N=await load('lib/native-tracking.ts'),G=await load('lib/tracking-gate.ts'),C=await load('lib/tracking-companion.ts'),T=await load('lib/tracking-coverage-text.ts'),
 A=await load('lib/directions-attempt.ts'),P=await load('lib/directions-problem.ts'),D=await load('lib/customer-directions.ts');

// ---- 1. the user agent
for(const [ua,expected] of [['YourrestCRM-Android/1',true],['x YourrestCRM-Android/1',true],['x YourrestCRM-Android/1 y',true],['YourrestCRM-Android/2',false],['YourrestCRM-Android/10',false],['XYourrestCRM-Android/1',false],['yourrestcrm-android/1',false],['Mozilla/5.0 Chrome',false],['',false]]){setUA(ua);eq(N.isNativeTrackingApp(),expected,'ua '+ua);}
Object.defineProperty(globalThis,'navigator',{value:{},configurable:true,writable:true});eq(N.isNativeTrackingApp(),false,'no user agent at all');
setUA('YourrestCRM-Android/1');
// ---- normalizing the bridge state
const raw=(over={})=>({tracking:true,permission:'granted',pendingCount:3,pendingGapCount:1,lastFixAt:'2026-11-22T06:00:00.000Z',accuracy:12.5,error:'',syncError:'',memberId:'m1',regionScope:'central',enrolledRole:'rep',appVersion:'1.0.15',continuousSupported:true,workHoursSupported:true,fridayExclusionSupported:true,trackingWindowActive:true,nextTrackingWindowAt:'2026-11-23T03:00:00.000Z',enrolled:true,backgroundPermission:'granted',fineLocationPermission:'granted',notificationPermission:'granted',locationServicesEnabled:true,continuousConsent:true,...over});
const full=N.normalizeNativeState(raw());
eq([full.tracking,full.permission,full.pendingCount,full.pendingGapCount,full.accuracy,full.memberId,full.appVersion,full.enrolled,full.continuousConsent,full.locationServicesEnabled],[true,'granted',3,1,12.5,'m1','1.0.15',true,true,true],'a full state is read as it is');
for(const bad of [null,undefined,'x',5,[],{},{tracking:'yes',permission:'granted'},{tracking:true,permission:'maybe'},{tracking:true},{permission:'granted'}])throws(()=>N.normalizeNativeState(bad),/native_invalid_state/,'invalid state '+JSON.stringify(bad));
const sparse=N.normalizeNativeState({tracking:false,permission:'prompt'});
eq([sparse.pendingCount,sparse.pendingGapCount,sparse.quarantinedCount,sparse.lastFixAt,sparse.accuracy,sparse.memberId,sparse.enrolled,sparse.backgroundPermission,sparse.fineLocationPermission,sparse.notificationPermission,sparse.locationServicesEnabled,sparse.continuousConsent,sparse.continuousSupported,sparse.directionsSupported],[0,null,0,'',null,null,false,'prompt',null,null,null,null,false,false],'missing fields are never invented: unknown stays null, flags false, background defaults to prompt');
eq(N.normalizeNativeState(raw({pendingCount:-4})).pendingCount,0,'negative pending count is zero');eq(N.normalizeNativeState(raw({pendingCount:7.9})).pendingCount,7,'fraction floored');eq(N.normalizeNativeState(raw({pendingCount:'5'})).pendingCount,0,'text count is zero');eq(N.normalizeNativeState(raw({pendingCount:NaN})).pendingCount,0,'NaN count');eq(N.normalizeNativeState(raw({pendingCount:Infinity})).pendingCount,0,'infinite count');
eq(N.normalizeNativeState(raw({pendingGapCount:-1})).pendingGapCount,null,'a negative gap count is unknown, not zero');eq(N.normalizeNativeState(raw({pendingGapCount:0})).pendingGapCount,0,'zero gaps is known');eq(N.normalizeNativeState(raw({pendingGapCount:2.7})).pendingGapCount,2,'gap count floored');
eq(N.normalizeNativeState(raw({quarantinedCount:4.5})).quarantinedCount,4,'quarantined count');
eq(N.normalizeNativeState(raw({lastFixAt:'not a date'})).lastFixAt,'','an unreadable fix time is dropped');eq(N.normalizeNativeState(raw({lastFixAt:5})).lastFixAt,'','a non-text fix time is dropped');
eq(N.normalizeNativeState(raw({accuracy:-1})).accuracy,null,'negative accuracy is unknown');eq(N.normalizeNativeState(raw({accuracy:0})).accuracy,0,'zero accuracy is kept');eq(N.normalizeNativeState(raw({accuracy:NaN})).accuracy,null,'NaN accuracy');
eq(N.normalizeNativeState(raw({memberId:''})).memberId,null,'empty member id is none');eq(N.normalizeNativeState(raw({memberId:7})).memberId,null,'a number is not a member id');
eq(N.normalizeNativeState(raw({fineLocationPermission:'weird'})).fineLocationPermission,null,'an unknown permission word is unknown');
eq(N.normalizeNativeState(raw({continuousConsent:'true'})).continuousConsent,null,'consent as text is unknown');eq(N.normalizeNativeState(raw({continuousSupported:'true'})).continuousSupported,false,'support flags are exactly true');
// ---- schedule support
const sched=(v,over={})=>N.nativeScheduleSupported({appVersion:v,workHoursSupported:true,fridayExclusionSupported:true,...over});
for(const [v,e] of [['1.0.7',true],['1.0.6',false],['1.0.15',true],['1.1.0',true],['1.0.0',false],['2.0.0',true],['0.9.99',false],['10.0.0',true],['1.0',false],['',false],['1.0.7-beta',false],['١.٠.٧',false],[' 1.0.7',false]])eq(sched(v),e,'schedule support for '+v);
eq(sched('1.0.15',{workHoursSupported:false}),false,'no work-hours support');eq(sched('1.0.15',{fridayExclusionSupported:false}),false,'no Friday exclusion');

// ---- 2. the bridge
delete globalThis.window.__yourrestNative;delete globalThis.window.__yourrestNativeGeneration;delete globalThis.window.__yourrestNativeScope;
eq(N.nativeTrackingGeneration(),0,'generation starts at zero');
setUA('Mozilla/5.0 Chrome');await rejects(N.waitForNativeBridge(10),/native_unavailable/,'a browser has no bridge');setUA('YourrestCRM-Android/1');
await rejects(N.waitForNativeBridge(30),/native_unavailable/,'a late bridge that never comes times out');
{const bridge={request:async()=>raw()};setTimeout(()=>{window.__yourrestNative=bridge;window.dispatchEvent(new Event('yourrest:native-ready'));},10);eq(await N.waitForNativeBridge(2000)===bridge,true,'a late bridge is picked up on its ready event');}
{const calls=[];window.__yourrestNative={request:async(method,payload)=>{calls.push([method,payload]);return raw({tracking:false});}};const state=await N.nativeTrackingRequest('status');eq([calls,state.tracking],[[['status',{}]],false],'a request returns the normalised state');await rejects((async()=>{window.__yourrestNative={request:async()=>({bad:1})};return N.nativeTrackingRequest('status');})(),/native_invalid_state/,'an invalid answer is refused');}
{window.__yourrestNative={request:async()=>{window.__yourrestNativeGeneration=(window.__yourrestNativeGeneration||0)+1;return raw();}};await rejects(N.nativeTrackingRequest('start'),/native_session_changed/,'a session that changed during the request is dropped');}
{window.__yourrestNative={request:async()=>raw()};const before=N.nativeTrackingGeneration();window.__yourrestNativeScope='m1';const calls=[];window.__yourrestNative={request:async method=>{calls.push(method);return raw();}};await N.logoutNativeTracking();eq([calls,N.nativeTrackingGeneration(),window.__yourrestNativeScope],[['logout'],before+1,undefined],'logout stops native collection, bumps the generation, forgets the scope');}
{setUA('Mozilla/5.0 Chrome');const before=N.nativeTrackingGeneration();await N.logoutNativeTracking();eq(N.nativeTrackingGeneration(),before,'logout in a browser does nothing');setUA('YourrestCRM-Android/1');}
{const got=[];const stop=N.subscribeNativeTracking(s=>got.push(s.tracking));window.dispatchEvent(new CustomEvent('yourrest:native-state',{detail:raw({tracking:false})}));window.dispatchEvent(new CustomEvent('yourrest:native-state',{detail:{junk:true}}));window.dispatchEvent(new CustomEvent('yourrest:native-state',{detail:raw()}));eq(got,[false,true],'an invalid event cannot claim anything');stop();window.dispatchEvent(new CustomEvent('yourrest:native-state',{detail:raw()}));eq(got.length,2,'unsubscribed');}

// ---- 3. the gate
const dev=(over={})=>({appVersion:'1.0.15',continuousSupported:true,scheduleSupported:true,gapCountKnown:true,consent:true,enrolled:true,ownerMatches:true,foreground:'granted',fineLocation:'granted',notifications:'granted',background:'granted',locationServices:true,tracking:true,windowActive:true,lastFixAt:'',accuracy:null,pendingCount:0,pendingGapCount:0,quarantinedCount:0,error:'',syncError:'',...over});
const input=(over={})=>({role:'rep',active:1,native:true,loading:false,failed:false,upgradeRequired:false,device:dev(),...over});
const decide=over=>G.trackingGateDecision(input(over));
const blocked=(reason,missing=[])=>({status:'blocked',reason,missing});
eq(decide(),{status:'allowed'},'a fully set up phone works');
eq(decide({active:0}),{status:'allowed'},'a deactivated account is never gated here');eq(decide({active:undefined}),{status:'allowed'},'an unknown member (still loading) is never gated');
for(const role of ['admin','manager','supervisor','service','',undefined,null,5])eq(decide({role,native:false,device:null}),{status:'allowed'},'role not subject to the gate: '+String(role));
eq(decide({role:'marketing',native:false,device:null}),blocked('browser'),'a marketing officer is a field role');
eq(decide({native:false,device:null}),blocked('browser'),'a representative in a browser is blocked');
eq(decide({device:null}),{status:'checking'},'native, bridge not read yet: checking');eq(decide({device:null,loading:true}),{status:'checking'},'loading is checking');
eq(decide({device:null,failed:true}),blocked('bridge'),'a bridge that could not be read');eq(decide({device:null,checkingExpired:true}),blocked('bridge'),'a bridge that took too long');
eq(decide({upgradeRequired:true}),blocked('upgrade'),'the served release is newer');
for(const over of [{continuousSupported:false},{scheduleSupported:false},{gapCountKnown:false}])eq(decide({device:dev(over)}),blocked('upgrade'),'an old app: '+Object.keys(over)[0]);
const missing=over=>G.missingRequirements(dev(over));
eq(missing(),[],'nothing missing');
eq(missing({consent:false}),['consent'],'consent refused');eq(missing({consent:null}),[],'consent not reported is not a gap');
eq(missing({fineLocation:'denied'}),['fine_location'],'fine location denied');eq(missing({fineLocation:'prompt'}),[],'prompt is not denied');
eq(missing({fineLocation:null,foreground:'granted'}),[],'an old app: the general permission decides (granted)');eq(missing({fineLocation:null,foreground:'denied'}),['fine_location'],'an old app, general permission denied');eq(missing({fineLocation:null,foreground:'prompt'}),['fine_location'],'an old app, never asked');
eq(missing({notifications:'denied'}),['notifications'],'notifications denied');eq(missing({notifications:null}),[],'notifications unknown');eq(missing({notifications:'prompt'}),[],'notifications not asked yet');
eq(missing({background:'denied'}),['background_location'],'background denied');eq(missing({background:'prompt'}),['background_location'],'background not granted');
eq(missing({locationServices:false}),['location_services'],'GPS off');eq(missing({locationServices:null}),[],'GPS unknown');
eq(missing({enrolled:false}),['enrollment'],'not enrolled');eq(missing({ownerMatches:false}),['enrollment'],'enrolled to another member');
eq(missing({enrolled:false,ownerMatches:false}),['enrollment'],'enrolment listed once');
eq(missing({enrolled:false,locationServices:false,background:'denied',notifications:'denied',fineLocation:'denied',consent:false}),['consent','fine_location','notifications','background_location','location_services','enrollment'],'every gap, in the fixed order');
eq(G.REQUIREMENT_ORDER.length,6,'six requirements');
eq(decide({device:dev({consent:false})}),blocked('setup',['consent']),'first activation: setup');
eq(decide({device:dev({consent:false,background:'denied'})}),blocked('setup',['consent','background_location']),'consent missing wins over permissions');
eq(decide({device:dev({background:'denied'})}),blocked('permission',['background_location']),'a denied permission');
eq(decide({device:dev({notifications:'denied'})}),blocked('permission',['notifications']),'notifications are a permission');
eq(decide({device:dev({locationServices:false})}),blocked('location_services',['location_services']),'GPS off');
eq(decide({device:dev({locationServices:false,background:'denied'})}),blocked('permission',['fine_location'].filter(()=>false).concat(['background_location','location_services'])),'a permission outranks GPS off');
eq(decide({device:dev({enrolled:false})}),blocked('setup',['enrollment']),'not enrolled is setup');
eq(decide({device:dev({enrolled:false}),companion:true}),{status:'allowed'},'a companion device is not gated for what is missing');
eq(decide({device:dev({enrolled:false}),companionPending:true}),{status:'checking'},'waiting for the server to say whether another device records');
eq(decide({device:dev({enrolled:false}),companion:true,companionPending:true}),{status:'allowed'},'companion wins over pending');
eq(decide({device:dev(),companionPending:true}),{status:'allowed'},'a phone that is fine does not wait');
eq(decide({upgradeRequired:true,companion:true}),blocked('upgrade'),'a companion still needs a current app');
// gateDeviceFrom
const s1=N.normalizeNativeState(raw({memberId:'m1'}));
const d1=G.gateDeviceFrom(s1,'m1');eq([d1.ownerMatches,d1.scheduleSupported,d1.gapCountKnown,d1.foreground,d1.background,d1.consent,d1.windowActive,d1.quarantinedCount],[true,true,true,'granted','granted',true,true,0],'the gate reads the normalised state');
eq(G.gateDeviceFrom(s1,'m2').ownerMatches,false,'another member');eq(G.gateDeviceFrom(s1,undefined).ownerMatches,false,'no member');eq(G.gateDeviceFrom(s1,'').ownerMatches,false,'empty member id');
eq(G.gateDeviceFrom(N.normalizeNativeState(raw({pendingGapCount:-1})),'m1').gapCountKnown,false,'an unknown gap count');
eq(G.gateDeviceFrom({...s1,quarantinedCount:undefined},'m1').quarantinedCount,0,'quarantined count defaults to zero');
eq(G.gateDeviceFrom(N.normalizeNativeState(raw({appVersion:'1.0.6'})),'m1').scheduleSupported,false,'1.0.6 has no schedule');

// ---- 4. the companion device
const HOUR=3600_000,NOW=Date.parse('2026-11-22T09:00:00Z');
const cin=(over={})=>({role:'rep',native:true,ownDayId:null,serverDay:null,serverKnown:true,windowOpen:true,rememberedAt:null,now:NOW,...over});
const cd=C.companionDecision;
eq(cd(cin({role:'admin',serverDay:{id:'d',endedAt:null}})),{companion:false,remember:false},'only field roles');eq(cd(cin({native:false,serverDay:{id:'d',endedAt:null}})),{companion:false,remember:false},'a browser is never a companion');eq(cd(cin({serverKnown:false,serverDay:{id:'d',endedAt:null}})),{companion:false,remember:false},'server not answered yet');
eq(cd(cin({role:undefined})),{companion:false,remember:false},'no role');
eq(cd(cin({serverDay:{id:'other',endedAt:null}})),{companion:true,remember:true},'in hours: another device records right now');
eq(cd(cin({serverDay:{id:'other',endedAt:'2026-11-22T08:00:00Z'}})),{companion:false,remember:false},'in hours: the other device has stopped');
eq(cd(cin({serverDay:{id:'mine',endedAt:null},ownDayId:'mine'})),{companion:false,remember:false},'in hours: the day is this device\'s own');
eq(cd(cin({serverDay:null})),{companion:false,remember:false},'in hours: nobody records');
eq(cd(cin({serverDay:{id:'x',endedAt:null},ownDayId:'mine'})),{companion:true,remember:true},'in hours: a day that is not mine');
eq(cd(cin({windowOpen:false,serverDay:{id:'other',endedAt:'2026-11-22T15:00:00Z'}})),{companion:true,remember:true},'outside hours: another device recorded today');
eq(cd(cin({windowOpen:false,serverDay:{id:'mine',endedAt:'2026-11-22T15:00:00Z'},ownDayId:'mine'})),{companion:false,remember:false},'outside hours: this device recorded');
eq(cd(cin({windowOpen:false,rememberedAt:NOW-HOUR})),{companion:true,remember:false},'outside hours: a companion an hour ago still is');
eq(cd(cin({windowOpen:false,rememberedAt:NOW-C.COMPANION_MEMORY_MS+1})),{companion:true,remember:false},'outside hours: memory one ms before its end');
eq(cd(cin({windowOpen:false,rememberedAt:NOW-C.COMPANION_MEMORY_MS})),{companion:false,remember:false},'outside hours: memory ends at seven days');
eq(cd(cin({windowOpen:false,rememberedAt:NOW+HOUR})),{companion:false,remember:false},'a memory from the future is not trusted');
eq(cd(cin({windowOpen:false,rememberedAt:NaN})),{companion:false,remember:false},'a NaN memory');eq(cd(cin({windowOpen:false,rememberedAt:null})),{companion:false,remember:false},'no memory');
eq(cd(cin({windowOpen:true,rememberedAt:NOW-HOUR})),{companion:false,remember:false},'in hours, memory alone is not enough');
eq(C.COMPANION_MEMORY_MS,604800000,'seven days');
// memory in storage
{const store=new Map();window.localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>{store.set(k,String(v));}};
 eq(C.readCompanionMemory('m1'),null,'nothing remembered');C.writeCompanionMemory('m1',NOW);eq(C.readCompanionMemory('m1'),NOW,'remembered per member');eq(C.readCompanionMemory('m2'),null,'another member has none');eq([...store.keys()],['yourrest-companion:m1'],'the key');
 store.set('yourrest-companion:m3','abc');eq(C.readCompanionMemory('m3'),null,'garbage is none');store.set('yourrest-companion:m3','0');eq(C.readCompanionMemory('m3'),null,'zero is none');store.set('yourrest-companion:m3','-5');eq(C.readCompanionMemory('m3'),null,'negative is none');
 window.localStorage={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};eq(C.readCompanionMemory('m1'),null,'blocked storage reads as no memory');C.writeCompanionMemory('m1',1);ok(true,'blocked storage cannot break a write');}

// ---- 5. the supervisor's sentences
eq(T.riyadhStamp('2026-11-22T06:30:00Z'),'2026-11-22 09:30','Riyadh is UTC+3');eq(T.riyadhStamp('2026-11-22T21:00:00Z'),'2026-11-23 00:00','the day turns at 21:00 UTC (midnight, not 24:00)');eq(T.riyadhStamp('2026-11-22T20:59:59Z'),'2026-11-22 23:59','one second before');
for(const v of [null,undefined,'','nope','٢٠٢٦'])eq(T.riyadhStamp(v),'','no stamp for '+JSON.stringify(v));
const entry=(over={})=>({memberId:'m1',memberName:'n',status:'tracked',pointsOnDate:12,tripsOnDate:1,dayStartedAt:'2026-11-22T03:00:00Z',lastPointAt:'2026-11-21T14:00:00Z',phone:null,browser:null,...over});
for(const status of ['tracked','never_tracked','no_points_today','day_without_points','rest_day','not_started','future']){const ar=T.coverageLabel(status,'ar'),en=T.coverageLabel(status,'en');ok(/[؀-ۿ]/.test(ar)&&!/[؀-ۿ]/.test(en)&&ar!==en,'label in both languages: '+status);const sa=T.coverageSentence(entry({status}),'ar'),se=T.coverageSentence(entry({status}),'en');ok(/[؀-ۿ]/.test(sa)&&!/[؀-ۿ]/.test(se),'sentence in both languages: '+status);}
eq(T.coverageLabel('tracked','fr'),T.coverageLabel('tracked','ar'),'an unknown language is Arabic');
ok(T.coverageSentence(entry({status:'no_points_today'}),'en').includes('2026-11-21 17:00'),'the last point in Riyadh time');ok(T.coverageSentence(entry({status:'day_without_points'}),'en').includes('06:00'),'the day opened at 06:00 Riyadh');ok(T.coverageSentence(entry({status:'tracked',pointsOnDate:7}),'en').includes('7 location'),'the count');
ok(T.coverageSentence(entry({status:'rest_day'}),'en').includes('Friday'),'the rest day is Friday');ok(T.coverageSentence(entry({status:'not_started'}),'en').includes('6 AM'),'tracking starts at 6 AM');
const phone=(over={})=>({platform:'android',gate:'ok',missing:[],reportedAt:'2026-11-22T06:00:00Z',appVersion:'1.0.15',pendingCount:0,error:'',deviceClass:'android',...over});
ok(T.phoneSentence(entry({phone:phone()}),'en').includes('tracking is working'),'a phone that works');ok(T.phoneSentence(entry({phone:phone({pendingCount:4})}),'en').includes('4 points are saved'),'queued points are mentioned');ok(!T.phoneSentence(entry({phone:phone({appVersion:''})}),'en').includes('version'),'no version, none written');
{const s=T.phoneSentence(entry({phone:phone({gate:'permission',missing:['fine_location','background_location'],error:'denied'})}),'en');ok(s.includes('permissions are missing')&&s.includes('precise location, location all the time')&&s.includes('(denied)'),'missing items and error named');const a=T.phoneSentence(entry({phone:phone({gate:'permission',missing:['notifications']})}),'ar');ok(a.includes('الإشعارات')&&a.includes('، ')===false,'Arabic names');}
for(const gate of ['ok','browser','upgrade','setup','permission','location_services','bridge'])ok(T.phoneBrief(entry({phone:phone({gate})}),'en').includes(' · '),'brief for gate '+gate);
for(const item of ['consent','fine_location','notifications','background_location','location_services','enrollment']){ok(/[؀-ۿ]/.test(T.requirementName(item,(a)=>a))&&!/[؀-ۿ]/.test(T.requirementName(item,(a,e)=>e)),'requirement name '+item);}
ok(T.phoneSentence(entry({browser:{deviceClass:'iphone',reportedAt:'2026-11-22T06:00:00Z'}}),'en').includes('iPhone'),'a browser on iPhone');ok(T.phoneSentence(entry({browser:{deviceClass:'desktop',reportedAt:'2026-11-22T06:00:00Z'}}),'en').includes('a computer'),'a browser on a computer');ok(T.phoneSentence(entry({browser:{deviceClass:'toaster',reportedAt:'2026-11-22T06:00:00Z'}}),'en').includes('unknown device'),'an unknown device');
ok(T.phoneSentence(entry(),'en').includes('No report has arrived'),'no report at all');ok(T.phoneSentence(entry(),'ar').includes('لم يصل أي تقرير'),'no report, Arabic');
eq(T.appVersionBehind('1.0.9','1.0.10'),true,'behind, numerically');eq(T.appVersionBehind('1.0.10','1.0.9'),false,'ahead');eq(T.appVersionBehind('1.0.9','1.0.9'),false,'equal');
for(const [a,b] of [['','1.0.0'],['1.0.0',''],['x','1.0.0'],['1.0','1.0.1'],['1.0.0‏','1.0.1']])eq(T.appVersionBehind(a,b),false,'never judged: '+JSON.stringify([a,b]));
eq(T.phoneBrief(entry({phone:phone()}),'en','1.0.16'),'App 1.0.15 · outdated; 1.0.16 required · 2026-11-22 09:00','a working phone older than the served app is marked outdated');
eq(T.phoneBrief(entry({phone:phone({gate:'permission'})}),'en','1.0.16').includes('permissions are missing'),true,'a phone with a problem keeps its own problem');
eq(T.phoneBrief(entry({phone:phone()}),'en'),'App 1.0.15 · tracking is working · 2026-11-22 09:00','no required version: no outdated mark');
eq(T.phoneBrief(entry({phone:phone({appVersion:''})}),'ar'),'التطبيق '.slice(0,0)+'التتبع يعمل · 2026-11-22 09:00','no version, no prefix');
eq(T.phoneBrief(entry({browser:{deviceClass:'android',reportedAt:'2026-11-22T06:00:00Z'}}),'en'),'Browser (Android) · 2026-11-22 09:00','a browser');eq(T.phoneBrief(entry(),'en'),'No phone report yet','no phone');
eq(T.coverageProblem('never_tracked'),true,'never tracked is a problem');eq(T.coverageProblem('rest_day'),false,'a rest day is not');

// ---- 6. directions
{const c=new AbortController(),gate=Promise.withResolvers();const w=A.waitForDirectionsStep(gate.promise,c.signal);gate.resolve(5);eq(await w,5,'the step\'s value');}
{const c=new AbortController(),gate=Promise.withResolvers();const w=A.waitForDirectionsStep(gate.promise,c.signal);gate.reject(new Error('boom'));await rejects(w,/boom/,'the step\'s error');}
{const c=new AbortController(),gate=Promise.withResolvers();const w=A.waitForDirectionsStep(gate.promise,c.signal);c.abort();await w.then(()=>{throw Error('should reject');},e=>{eq([e.name,e.message],['AbortError','directions_cancelled'],'abort rejects with AbortError');});gate.resolve('late');gate.promise.then(()=>{});ok(true,'a late result is consumed, no unhandled rejection');}
{const c=new AbortController();c.abort();await A.waitForDirectionsStep(new Promise(()=>{}),c.signal).then(()=>{throw Error('x');},e=>eq(e.name,'AbortError','already aborted rejects at once'));}
{const c=new AbortController(),late=Promise.withResolvers();const w=A.waitForDirectionsStep(late.promise,c.signal);c.abort();await w.catch(()=>{});late.reject(new Error('late failure'));await new Promise(r=>setImmediate(r));ok(true,'a late failure after abort leaks no rejection');}
eq(A.DIRECTIONS_START_TIMEOUT_MS,30000,'thirty seconds');
const prob=(p,l='en')=>P.directionsProblem(p,l);
ok(/1\.0\.7/.test(prob('native_upgrade_required')),'upgrade needs 1.0.7');ok(/precise location/.test(prob('background_permission_required')),'background permission');ok(/precise location/.test(prob('permission_denied')),'denied');ok(/precise location/.test(prob('اسمح بالموقع')),'Arabic permission words are recognised');ok(/precise location/.test(prob('الموقع طوال الوقت')),'the all-the-time wording');
ok(/syncing/.test(prob('native_pending_sync')),'pending sync');ok(/app service/.test(prob('native_unavailable')),'bridge unavailable');ok(/app service/.test(prob('native_invalid_state')),'invalid state');ok(/account changed/.test(prob('native_session_changed')),'session changed');ok(/Neither Google Maps/.test(prob('maps_launch_failed:x')),'maps launch failed');
eq(prob('something odd'),'something odd','an unknown problem is shown as it is');ok(/Could not start trip recording/.test(prob('')),'an empty problem gets the generic text');
ok(/[؀-ۿ]/.test(prob('native_upgrade_required','ar'))&&/[؀-ۿ]/.test(prob('','ar')),'Arabic texts');ok(!/[؀-ۿ]/.test(prob('native_pending_sync','fr')),'any other language is English');
eq(D.customerDirectionsLink({latitude:24.7136,longitude:46.6753}),'https://www.google.com/maps/dir/?api=1&destination=24.7136%2C46.6753&travelmode=driving&dir_action=navigate','a stored pair');
eq(D.customerDirectionsLink({location:'24.7136, 46.6753'}),D.customerDirectionsLink({latitude:24.7136,longitude:46.6753}),'a pair typed as text');
eq(D.customerDirectionsLink({location:'24.7136،46.6753'}),D.customerDirectionsLink({latitude:24.7136,longitude:46.6753}),'an Arabic comma');
eq(D.customerDirectionsLink({location:'https://maps.example/@24.7136,46.6753,15z'}),D.customerDirectionsLink({latitude:24.7136,longitude:46.6753}),'a pasted map link keeps only the place');
for(const v of [null,undefined,'x',5,true,{},{location:'الرياض، حي النخيل'},{latitude:0,longitude:0},{latitude:91,longitude:10},{latitude:10,longitude:181},{latitude:NaN,longitude:1},{latitude:'24',longitude:'46'},{location:'0,0'},{location:'91,10'},{location:'https://evil.example/go'}])eq(D.customerDirectionsLink(v),null,'no link for '+JSON.stringify(v));
ok(!D.customerDirectionsLink({latitude:24.7,longitude:46.6,name:'x&y',url:'https://evil.example'}).includes('evil'),'no third-party url becomes part of the link');
report();
