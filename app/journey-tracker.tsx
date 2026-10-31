'use client';
import React,{createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {MapPin,PauseCircle,AlertTriangle,Loader2} from 'lucide-react';
import type {Member} from '@/lib/crm';
import type {JourneyStop} from '@/lib/journeys';
import {journeyDay,positionSample,trimJourneyBuffer,shouldStartJourney,type QueuedJourneyPoint} from '@/lib/journey-client';
import {useLanguage} from '@/lib/i18n';
import {isNativeTrackingApp,nativeTrackingRequest,nativeTrackingGeneration,subscribeNativeTracking,nativeScheduleSupported,type NativeTrackingState} from '@/lib/native-tracking';
import {trackingWindowOpen,trackingWindowStatus} from '@/lib/tracking-window';
import {gateDeviceFrom,type GateSource} from '@/lib/tracking-gate';
import {cleanTrackerText} from '@/lib/tracker-text';
import './journey-tracker.css';
import {omit} from '@/lib/omit';
import release from '@/lib/app-update-release.json';

/** The Android version the site serves (and requires); texts that ask for an update name it. */
const SERVED_APP_VERSION=release.versionName,SERVED_APK_PATH=new URL(release.apkUrl).pathname;

type TrackerError='permission'|'unavailable'|'unsupported'|'sync'|'expired'|'invalid'|'native'|'';
type JourneyResponse={active:JourneyStop|null;stop:JourneyStop|null;serverTime:string};
const nativeFailureKind=(message:string,fallback:TrackerError='native'):TrackerError=>/permission|denied|consent|إذن|أذونات|الموافقة|اسمح|دقيق|الإشعارات/i.test(message)?'permission':/sync|offline|network|internet|اتصال|مزامنة|إنترنت/i.test(message)?'sync':/gps_unavailable|موقع حديث|خدمة الموقع غير متاحة|location_services_disabled/i.test(message)?'unavailable':fallback;
/** Collection and uploading are separate states. A running service waiting for
 * a GPS fix must not repeat consent or treat the user's enrollment as disabled. */
const blockingNativeError=(state:NativeTrackingState)=>!!state.error&&!['sync','unavailable','invalid'].includes(nativeFailureKind(state.error));
const nativeSyncProblem=(state:NativeTrackingState)=>state.syncError||(state.error&&nativeFailureKind(state.error)==='sync'?state.error:'');
const memberTrackerScope=(me:Member|null)=>[me?.id,me?.role,me?.active,me?.regionScope,me?.authVersion,me?.supervisorId,me?.branch].join(':');
const selectFailureMessage=(failure:unknown,fallback:string)=>cleanTrackerText(failure,fallback);
type ContinuousStatus='disabled'|'loading'|'upgrade'|'setup'|'ready'|'browser';
type SelectionOptions={createKey?:string};
type TrackerContext={isRep:boolean;continuousStatus:ContinuousStatus;setupContinuous:()=>Promise<void>;active:JourneyStop|null;lastStop:JourneyStop|null;loading:boolean;busy:boolean;error:TrackerError;errorMessage:string;operationError:string;pendingCount:number;quarantinedCount?:number;quarantinedGapCount?:number;hidden:boolean;paused:boolean;outsideTrackingHours:boolean;lastFixAt:string;accuracy:number|null;native:boolean;appVersion:string;mapsLaunchSupported:boolean;foregroundDirectionsSupported:boolean;tracking:boolean;gate:GateSource;selectCustomer:(id:string,signal?:AbortSignal,options?:SelectionOptions)=>Promise<JourneyStop|null>;selectFailure:()=>string;cancelSelection:(id:string,reason?:string,stopId?:string)=>Promise<void>;stopDay:()=>Promise<void>;retry:()=>void;stopFor:(customerId:string)=>JourneyStop|null};
/** Outside the Android app there is no native collector, so a representative is gated as a browser. */
const BROWSER_GATE:GateSource={native:false,loading:false,failed:false,upgradeRequired:false,device:null};
const empty:TrackerContext={isRep:false,continuousStatus:'disabled',setupContinuous:async()=>{},active:null,lastStop:null,loading:false,busy:false,error:'',errorMessage:'',operationError:'',pendingCount:0,hidden:false,paused:false,outsideTrackingHours:false,lastFixAt:'',accuracy:null,native:false,appVersion:'',mapsLaunchSupported:false,foregroundDirectionsSupported:false,tracking:false,gate:BROWSER_GATE,selectCustomer:async()=>null,selectFailure:()=>'',cancelSelection:async()=>{},stopDay:async()=>{},retry:()=>{},stopFor:()=>null};
const Tracker=createContext<TrackerContext>(empty);
export const useJourneyTracker=()=>useContext(Tracker);

/** Recalculate at the actual Saudi boundary and after a suspended page resumes.
 * Every GPS callback separately checks capture time in case timers were suspended. */
function useTrackingWindow(enabled:boolean){
 const [open,setOpen]=useState(()=>trackingWindowOpen());
 useEffect(()=>{
  if(!enabled)return;let timer:ReturnType<typeof setTimeout>|undefined,disposed=false;
  const refresh=()=>{if(disposed)return;if(timer!==undefined)clearTimeout(timer);const now=Date.now(),status=trackingWindowStatus(now);setOpen(status.open);timer=setTimeout(refresh,Math.max(1,Date.parse(status.nextBoundaryAt)-now));};
  refresh();document.addEventListener('visibilitychange',refresh);window.addEventListener('focus',refresh);
  return()=>{disposed=true;if(timer!==undefined)clearTimeout(timer);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('focus',refresh);};
 },[enabled]);
 return open;
}

/** One tracker per signed-in app. It survives form closing and page navigation. */
export function JourneyTrackerProvider({me,children}:{me:Member|null;children:React.ReactNode}){
 return isNativeTrackingApp()?<NativeJourneyTrackerProvider me={me}>{children}</NativeJourneyTrackerProvider>:<BrowserJourneyTrackerProvider me={me}>{children}</BrowserJourneyTrackerProvider>;
}

/** The Android service owns GPS, persistence and uploading, including screen-off.
 * UI unmounts only release UI subscriptions; they must never stop the working day. */
export function NativeJourneyTrackerProvider({me,children}:{me:Member|null;children:React.ReactNode}){
 const [active,setActive]=useState<JourneyStop|null>(null),[lastStop,setLastStop]=useState<JourneyStop|null>(null),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[syncError,setSyncError]=useState<TrackerError>(''),[operationError,setOperationError]=useState(''),[nativeState,setNativeState]=useState<NativeTrackingState|null>(null);
 const activeRef=useRef<JourneyStop|null>(null),lastRef=useRef<JourneyStop|null>(null),nativeRef=useRef<NativeTrackingState|null>(null),generation=useRef(0),chain=useRef<Promise<unknown>>(Promise.resolve()),controllers=useRef(new Set<AbortController>()),desired=useRef(''),selectionRequest=useRef(0),selectionKeys=useRef(new Map<string,string>()),member=useRef(me),pendingEnd=useRef<{customerId:string;reason:string;stopId?:string}|null>(null),polling=useRef(false);
 const selectionFailure=useRef(''),selectFailure=useCallback(()=>selectionFailure.current,[]),setupFlight=useRef<{epoch:number;promise:Promise<void>}|null>(null);
 member.current=me;
 const enabled=!!me&&me.active===1&&['rep','supervisor','manager','admin'].includes(me.role),enabledRef=useRef(enabled);enabledRef.current=enabled;
 const windowOpen=useTrackingWindow(enabled);
 const scope=memberTrackerScope(me);
 const serial=useCallback(<T,>(work:()=>Promise<T>):Promise<T>=>{const next=chain.current.then(work,work);chain.current=next.catch(()=>{});return next;},[]);
 const failed=useCallback((failure:unknown,epoch:number,fallback:TrackerError='native')=>{if(generation.current===epoch){const message=selectFailureMessage(failure,'native_tracking_failed');setSyncError(nativeFailureKind(message,fallback));setOperationError(message);}},[]);
 const applyNative=useCallback((state:NativeTrackingState,epoch:number)=>{if(generation.current!==epoch||!enabledRef.current)return;if(state.memberId&&state.memberId!==member.current?.id)return;nativeRef.current=state;setNativeState(state);},[]);
 const reconcileAccount=useCallback(async(state:NativeTrackingState,epoch:number)=>{
  const me=member.current;if(!me||generation.current!==epoch)return state;
  const sameOwner=state.memberId===me.id;
  const changed=sameOwner&&(!enabledRef.current||!!state.regionScope&&!!me.regionScope&&state.regionScope!==me.regionScope||!!state.enrolledRole&&state.enrolledRole!==me.role||state.enrolled&&me.role!=='rep'||!!window.__yourrestNativeScope&&window.__yourrestNativeScope!==memberTrackerScope(me));
  if(!changed)return state;
  // This command verifies the signed-in server account itself. It can retire
  // empty old metadata, or halt and preserve evidence from a changed territory.
  // A client scope change must never masquerade as an explicit user logout.
  if(!state.accountRecoverySupported)throw Error('native_upgrade_required');
  const refreshed=await nativeTrackingRequest('refreshAccount',{memberId:me.id});if(generation.current!==epoch||member.current?.id!==me.id)throw Error('native_session_changed');applyNative(refreshed,epoch);window.__yourrestNativeScope=memberTrackerScope(me);return refreshed;
 },[applyNative]);
 const apply=useCallback((result:JourneyResponse,epoch:number)=>{if(generation.current!==epoch)return;activeRef.current=result.active;setActive(result.active);if(result.stop){lastRef.current=result.stop;setLastStop(result.stop);}},[]);
 const request=useCallback(async(body?:Record<string,unknown>,stopId?:string):Promise<JourneyResponse>=>{
  const controller=new AbortController();controllers.current.add(controller);const timeout=setTimeout(()=>controller.abort(),15000);
  try{const response=await fetch('/api/journeys'+(!body&&stopId?'?stopId='+encodeURIComponent(stopId):''),{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',signal:controller.signal,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const result=await response.json() as JourneyResponse&{error?:string};if(!response.ok){const failure=new Error(result.error||'Journey synchronization failed') as Error&{status?:number};failure.status=response.status;throw failure;}return result;}
  finally{clearTimeout(timeout);controllers.current.delete(controller);}
 },[]);
 const flushNative=useCallback(async(epoch:number)=>{const state=await nativeTrackingRequest('flush');applyNative(state,epoch);if(state.pendingGapCount===null)throw Error('native_upgrade_required');if(state.pendingCount||state.pendingGapCount>0||nativeSyncProblem(state)||blockingNativeError(state))throw Error(nativeSyncProblem(state)||state.error||'native_pending_sync');return state;},[applyNative]);
 const finishCancelledStop=useCallback(async(epoch:number,continuing:()=>boolean=()=>true)=>{
  const ending=pendingEnd.current;if(!ending)return;
  const stop=activeRef.current;if(!stop||stop.customerId!==ending.customerId||ending.stopId&&stop.id!==ending.stopId){pendingEnd.current=null;return;}
  if(!continuing())return;await flushNative(epoch);if(generation.current!==epoch||!continuing())return;
  apply(await request({action:'end',stopId:stop.id,reason:ending.reason}),epoch);
  if(generation.current===epoch)pendingEnd.current=null;
 },[apply,flushNative,request]);
 const refresh=useCallback(async(epoch:number)=>{
  const state=await nativeTrackingRequest('status');if(generation.current!==epoch)return;applyNative(state,epoch);
  await finishCancelledStop(epoch);if(generation.current!==epoch)return;
  const stopId=state.stopId||activeRef.current?.id||lastRef.current?.id;
  try{apply(await request(undefined,stopId),epoch);}catch(failure){if((failure as Error&{status?:number}).status!==404)throw failure;apply(await request(),epoch);}
  if(generation.current===epoch&&!blockingNativeError(state)){setSyncError(previous=>previous==='sync'||state.tracking?'':previous);if(state.tracking)setOperationError('');}
 },[apply,applyNative,finishCancelledStop,request]);
 const continuousReady=useCallback((state:NativeTrackingState)=>state.continuousSupported&&nativeScheduleSupported(state)&&state.pendingGapCount!==null&&state.enrolled&&state.memberId===member.current?.id&&state.permission==='granted'&&state.backgroundPermission==='granted'&&(!trackingWindowOpen()||state.tracking)&&!blockingNativeError(state),[]);
 const prepareContinuous=useCallback(async(epoch:number,nativeEpoch:number,signal?:AbortSignal,freshState?:NativeTrackingState)=>{
  const current=()=>!signal?.aborted&&generation.current===epoch&&nativeTrackingGeneration()===nativeEpoch&&enabledRef.current&&member.current?.role==='rep';
  if(!current())return null;
  // Read the service itself rather than an event snapshot: revoked permissions
  // must not be hidden by the fast path. Healthy enrollment needs no new prompt.
  let state=freshState||await nativeTrackingRequest('status');state=await reconcileAccount(state,epoch);applyNative(state,epoch);if(!current())return null;
  if(!state.continuousSupported||!nativeScheduleSupported(state)||state.pendingGapCount===null)throw Error('native_upgrade_required');
  if(continuousReady(state))return state;
  state=await nativeTrackingRequest('prepare',{continuous:true});applyNative(state,epoch);if(!current())return null;
  if(state.pendingGapCount===null)throw Error('native_upgrade_required');
  if(state.permission!=='granted'||state.backgroundPermission!=='granted')throw Error('background_permission_required');
  state=await nativeTrackingRequest('enroll',{memberId:member.current?.id});applyNative(state,epoch);if(!current())return null;
  if(state.pendingGapCount===null)throw Error('native_upgrade_required');
  if(!state.enrolled||trackingWindowOpen()&&!state.tracking||state.memberId!==member.current?.id||blockingNativeError(state))throw Error(state.error||'native_not_running');
  return state;
 },[applyNative,continuousReady,reconcileAccount]);
 const setupContinuous=useCallback(()=>{
  if(!enabledRef.current||member.current?.role!=='rep')return Promise.resolve();const epoch=generation.current,nativeEpoch=nativeTrackingGeneration();
  if(setupFlight.current?.epoch===epoch)return setupFlight.current.promise;
  // Mark the action immediately, even if a previous synchronization is queued.
  // Two taps must never enqueue two permission dialogs or enrollments.
  setBusy(true);setSyncError('');setOperationError('');
  const promise=serial(async()=>{if(generation.current!==epoch||nativeTrackingGeneration()!==nativeEpoch)return;setBusy(true);try{if(await prepareContinuous(epoch,nativeEpoch)){setSyncError('');setOperationError('');}}catch(failure){failed(failure,epoch);}finally{if(generation.current===epoch)setBusy(false);}}).finally(()=>{if(setupFlight.current?.epoch===epoch)setupFlight.current=null;});
  setupFlight.current={epoch,promise};return promise;
 },[failed,prepareContinuous,serial]);
 const selectCustomer=useCallback(async(customerId:string,signal?:AbortSignal,options?:SelectionOptions)=>{
  if(signal?.aborted||!customerId||!enabledRef.current||!trackingWindowOpen())return null;const epoch=generation.current,nativeEpoch=nativeTrackingGeneration(),selection=++selectionRequest.current,current=()=>!signal?.aborted&&generation.current===epoch&&nativeTrackingGeneration()===nativeEpoch&&enabledRef.current,clearDesired=()=>{if(selectionRequest.current===selection&&desired.current===customerId)desired.current='';};desired.current=customerId;selectionFailure.current='';
  return serial(async()=>{if(!current()){if(signal?.aborted)clearDesired();return null;}if(selectionRequest.current===selection)selectionFailure.current='';setBusy(true);
   try{
    let ready=await nativeTrackingRequest('status');ready=await reconcileAccount(ready,epoch);applyNative(ready,epoch);if(!current())return null;
    if(!nativeScheduleSupported(ready)||ready.pendingGapCount===null)throw Error('native_upgrade_required');
    const rep=member.current?.role==='rep',healthy=rep?continuousReady(ready):ready.permission==='granted'&&ready.tracking&&ready.memberId===member.current?.id&&!blockingNativeError(ready);
    const activeStop=activeRef.current;
    if(healthy&&!pendingEnd.current&&(ready.immutableBindingSupported||ready.pendingCount===0&&ready.pendingGapCount===0)&&activeStop?.customerId===customerId&&activeStop.date===journeyDay()&&!activeStop.closedAt&&ready.stopId===activeStop.id){clearDesired();setSyncError('');setOperationError('');return activeStop;}
    // Preparing permissions precedes creating a stop, including the first selection.
    if(rep){const prepared=await prepareContinuous(epoch,nativeEpoch,signal,ready);if(!current()||!prepared)return null;ready=prepared;}else{ready=await nativeTrackingRequest('prepare');applyNative(ready,epoch);if(!current())return null;if(ready.pendingGapCount===null)throw Error('native_upgrade_required');if(ready.permission!=='granted')throw Error('permission_denied');}
    if(!current())return null;const hadCancellation=!!pendingEnd.current;await finishCancelledStop(epoch,current);if(!current())return null;
    // The new native outbox retains the captured stop ID for every point/gap,
    // and the server accepts narrowly scoped, pre-switch captured evidence.
    // Unknown legacy gap bindings retain the ordered flush barrier. Uploading
    // old data must not disable an otherwise authorized healthy service.
    if(hadCancellation||!ready.immutableBindingSupported&&(ready.pendingCount||ready.pendingGapCount!==0||nativeSyncProblem(ready)||blockingNativeError(ready))){if(!current())return null;ready=await flushNative(epoch);if(!current())return null;}
    const selectedStop=activeRef.current;
    if(selectedStop?.customerId===customerId&&selectedStop.date===journeyDay()&&!selectedStop.closedAt&&ready.tracking&&ready.memberId===member.current?.id&&ready.stopId===selectedStop.id){clearDesired();setSyncError('');setOperationError('');return selectedStop;}
    const createKey=options?.createKey||selectionKeys.current.get(customerId)||crypto.randomUUID();if(!options?.createKey)selectionKeys.current.set(customerId,createKey);
    if(!current())return null;if(!trackingWindowOpen()){clearDesired();return null;}
    const result=await request({action:'select',customerId,createKey});if(generation.current!==epoch||nativeTrackingGeneration()!==nativeEpoch)return null;if(selectionKeys.current.get(customerId)===createKey)selectionKeys.current.delete(customerId);apply(result,epoch);if(!current())return null;
    if(!trackingWindowOpen()){clearDesired();setSyncError('');setOperationError('');return result.stop;}
    if(!result.stop||result.stop.closedAt)throw Error('native_stop_unavailable');
    if(!current())return null;const started=await nativeTrackingRequest('start',{memberId:member.current?.id,stopId:result.stop.id});applyNative(started,epoch);if(!current())return null;
    if(trackingWindowOpen()&&!started.tracking||started.memberId!==member.current?.id||trackingWindowOpen()&&started.stopId!==result.stop.id||blockingNativeError(started))throw Error(started.error||'native_not_running');
    clearDesired();setSyncError('');setOperationError('');return result.stop;
   }catch(failure){if(current()){if(selectionRequest.current===selection)selectionFailure.current=selectFailureMessage(failure,'native_tracking_failed');failed(failure,epoch);}return null;}finally{if(signal?.aborted)clearDesired();if(generation.current===epoch)setBusy(false);}
  });
 },[apply,applyNative,continuousReady,failed,finishCancelledStop,flushNative,prepareContinuous,reconcileAccount,request,serial]);
 const cancelSelection=useCallback(async(customerId:string,reason='contact_type_changed',stopId?:string)=>{
  const epoch=generation.current;if(desired.current===customerId)desired.current='';
  await serial(async()=>{if(generation.current!==epoch)return;pendingEnd.current={customerId,reason,stopId};setBusy(true);try{await finishCancelledStop(epoch);if(generation.current===epoch)setSyncError('');}catch(failure){failed(failure,epoch,'sync');}finally{if(generation.current===epoch)setBusy(false);}});
 },[failed,finishCancelledStop,serial]);
 const stopDay=useCallback(async()=>{
  if(!enabledRef.current||member.current?.role==='rep')return;
  const epoch=generation.current;desired.current='';
  await serial(async()=>{if(generation.current!==epoch||member.current?.role==='rep')return;setBusy(true);try{
   // Day collection continues after automatic departure, when activeRef is null.
   const state=await nativeTrackingRequest('stop');if(generation.current!==epoch)return;applyNative(state,epoch);if(state.tracking)throw Error('native_stop_failed');pendingEnd.current=null;
   apply(await request(undefined,activeRef.current?.id||lastRef.current?.id||undefined),epoch);if(generation.current===epoch)setSyncError(state.error?'sync':'');
  }catch(failure){failed(failure,epoch);}finally{if(generation.current===epoch)setBusy(false);}});
 },[apply,applyNative,failed,request,serial]);
 const retry=useCallback(()=>{if(!enabledRef.current)return;if(member.current?.role==='rep'&&(!nativeRef.current?.enrolled||nativeRef.current.permission!=='granted'||nativeRef.current.backgroundPermission!=='granted'||trackingWindowOpen()&&!nativeRef.current.tracking)){void setupContinuous();return;}if(desired.current){void selectCustomer(desired.current);return;}if(activeRef.current&&!nativeRef.current?.tracking){void selectCustomer(activeRef.current.customerId);return;}const epoch=generation.current;void serial(async()=>{if(generation.current!==epoch)return;setBusy(true);try{await flushNative(epoch);await refresh(epoch);if(generation.current===epoch){setSyncError('');setOperationError('');}}catch(failure){failed(failure,epoch,'sync');}finally{if(generation.current===epoch)setBusy(false);}});},[failed,flushNative,refresh,selectCustomer,serial,setupContinuous]);
 const stopFor=useCallback((id:string)=>{const stop=activeRef.current?.customerId===id?activeRef.current:lastRef.current?.customerId===id?lastRef.current:null;return stop?.date===journeyDay()?stop:null;},[]);
 useEffect(()=>{
  const epoch=++generation.current,nativeEpoch=nativeTrackingGeneration();activeRef.current=null;lastRef.current=null;nativeRef.current=null;desired.current='';selectionFailure.current='';selectionKeys.current.clear();pendingEnd.current=null;polling.current=false;setActive(null);setLastStop(null);setNativeState(null);setSyncError('');setOperationError('');setBusy(false);setLoading(enabled);
  // CRM first renders with me=null while /api/crm is still loading. Unknown
  // authentication must never disable enrollment or erase a device's outbox.
  // Explicit logout is handled by authRequest before invalidating the session;
  // a known member becoming disabled or changing scope remains a real revoke.
  if(!me)return;
  const unsubscribe=subscribeNativeTracking(state=>{if(enabled)applyNative(state,epoch);});
  void serial(async()=>{try{
   let state=await nativeTrackingRequest('status');if(generation.current!==epoch)return;
   if(state.memberId&&state.memberId!==member.current?.id){state=await nativeTrackingRequest('logout');if(generation.current!==epoch)return;}
   state=await reconcileAccount(state,epoch);if(generation.current!==epoch)return;
   if(enabled){window.__yourrestNativeScope=scope;applyNative(state,epoch);
    if(member.current?.role==='rep'&&state.continuousSupported&&nativeScheduleSupported(state)&&state.pendingGapCount!==null&&state.enrolled&&state.memberId===member.current.id&&state.permission==='granted'&&state.backgroundPermission==='granted'){
     if(generation.current!==epoch||nativeTrackingGeneration()!==nativeEpoch)return;state=await nativeTrackingRequest('enroll',{memberId:member.current.id});if(generation.current!==epoch||nativeTrackingGeneration()!==nativeEpoch)return;applyNative(state,epoch);
    }
    try{apply(await request(undefined,state.stopId||undefined),epoch);}catch(failure){if((failure as Error&{status?:number}).status!==404)throw failure;apply(await request(),epoch);}}else delete window.__yourrestNativeScope;
  }catch(failure){failed(failure,epoch);}finally{if(generation.current===epoch)setLoading(false);}});
  const poll=()=>{if(!enabled||document.hidden||polling.current)return;polling.current=true;void serial(async()=>{try{if(generation.current!==epoch)return;await refresh(epoch);}catch(failure){failed(failure,epoch,'sync');}finally{if(generation.current===epoch)polling.current=false;}});};
  const visibility=()=>{if(!document.hidden)poll();};
  const interval=enabled?setInterval(poll,10000):undefined;document.addEventListener('visibilitychange',visibility);window.addEventListener('online',poll);window.addEventListener('focus',poll);window.addEventListener('yourrest:native-ready',poll);
  return()=>{generation.current++;selectionFailure.current='';unsubscribe();if(interval!==undefined)clearInterval(interval);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('online',poll);window.removeEventListener('focus',poll);window.removeEventListener('yourrest:native-ready',poll);for(const controller of controllers.current)controller.abort();controllers.current.clear();};
 },[scope,enabled,apply,applyNative,failed,reconcileAccount,refresh,request,serial]);
 const isRep=enabled&&me?.role==='rep';
 const continuousStatus:ContinuousStatus=!enabled?'disabled':loading?'loading':operationError==='native_upgrade_required'||nativeState&&(!nativeScheduleSupported(nativeState)||nativeState.pendingGapCount===null)?'upgrade':!isRep?'disabled':nativeState&&!nativeState.continuousSupported?'upgrade':!nativeState?.enrolled||nativeState.memberId!==me?.id||nativeState.permission!=='granted'||nativeState.backgroundPermission!=='granted'?'setup':'ready';
 const nativeError:TrackerError=nativeState?.permission==='denied'||isRep&&nativeState?.backgroundPermission==='denied'?'permission':nativeState?.locationServicesEnabled===false?'unavailable':nativeState?.error?nativeFailureKind(nativeState.error):nativeState?.syncError?'sync':windowOpen&&(active||continuousStatus==='ready')&&!loading&&!busy&&nativeState&&!nativeState.tracking?'native':'';
 const permissionError=nativeState?.fineLocationPermission==='denied'?'fine_location_permission_required':nativeState?.notificationPermission==='denied'?'notification_permission_required':isRep&&nativeState?.backgroundPermission==='denied'?'background_permission_required':'';
 const errorMessage=selectFailureMessage(permissionError||(nativeState?.locationServicesEnabled===false?'location_services_disabled':'')||operationError||nativeState?.error||nativeState?.syncError,'');
 const memberId=me?.id,gate=useMemo<GateSource>(()=>({native:true,loading,failed:!loading&&!nativeState&&!!operationError,upgradeRequired:operationError==='native_upgrade_required',device:nativeState?gateDeviceFrom(nativeState,memberId):null}),[loading,nativeState,operationError,memberId]);
 const value=useMemo<TrackerContext>(()=>({isRep,continuousStatus,setupContinuous,active,lastStop,loading,busy,error:syncError||nativeError,errorMessage,operationError,pendingCount:nativeState?.pendingCount||0,quarantinedCount:nativeState?.quarantinedCount||0,quarantinedGapCount:nativeState?.quarantinedGapCount||0,hidden:false,paused:windowOpen&&!!active&&!!nativeState&&!nativeState.tracking,outsideTrackingHours:enabled&&!windowOpen,lastFixAt:nativeState?.lastFixAt||'',accuracy:nativeState?.accuracy??null,native:true,appVersion:nativeState?.appVersion||'',mapsLaunchSupported:nativeState?.mapsLaunchSupported===true,foregroundDirectionsSupported:nativeState?.foregroundDirectionsSupported===true,tracking:windowOpen&&!!nativeState?.tracking,gate,selectCustomer,selectFailure,cancelSelection,stopDay,retry,stopFor}),[isRep,continuousStatus,setupContinuous,active,lastStop,loading,busy,syncError,nativeError,errorMessage,operationError,nativeState,enabled,windowOpen,gate,selectCustomer,selectFailure,cancelSelection,stopDay,retry,stopFor]);
 return <Tracker.Provider value={value}>{children}</Tracker.Provider>;
}

export function BrowserJourneyTrackerProvider({me,children}:{me:Member|null;children:React.ReactNode}){
 const [active,setActive]=useState<JourneyStop|null>(null),[lastStop,setLastStop]=useState<JourneyStop|null>(null),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<TrackerError>(''),[pendingCount,setPendingCount]=useState(0),[hidden,setHidden]=useState(false),[paused,setPaused]=useState(false),[lastFixAt,setLastFixAt]=useState(''),[accuracy,setAccuracy]=useState<number|null>(null),[retryTick,setRetryTick]=useState(0);
 const member=useRef(me),activeRef=useRef<JourneyStop|null>(null),lastRef=useRef<JourneyStop|null>(null),queue=useRef<QueuedJourneyPoint[]>([]),pendingGaps=useRef(new Set<string>()),pausedRef=useRef(false),endRef=useRef<{stopId:string;reason:string}|null>(null),generation=useRef(0),chain=useRef<Promise<unknown>>(Promise.resolve()),controllers=useRef(new Set<AbortController>()),selectionKeys=useRef(new Map<string,string>()),desiredSelection=useRef(''),selectionRequest=useRef(0),flushQueued=useRef(false),lastQueuedAt=useRef(0);
 const selectionFailure=useRef(''),selectFailure=useCallback(()=>selectionFailure.current,[]);
 member.current=me;
 const enabled=!!me&&me.active===1&&['rep','supervisor','manager','admin'].includes(me.role);
 const enabledRef=useRef(enabled);enabledRef.current=enabled;
 const windowOpen=useTrackingWindow(enabled);
 const serial=useCallback(<T,>(work:()=>Promise<T>):Promise<T>=>{const next=chain.current.then(work,work);chain.current=next.catch(()=>{});return next;},[]);
 const request=useCallback(async(body?:Record<string,unknown>):Promise<JourneyResponse>=>{
  const controller=new AbortController();controllers.current.add(controller);const timeout=setTimeout(()=>controller.abort(),15000);
  try{const response=await fetch('/api/journeys',{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',signal:controller.signal,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const result=await response.json() as JourneyResponse&{error?:string};if(!response.ok){const failure=new Error(result.error||'Journey synchronization failed') as Error&{status?:number};failure.status=response.status;throw failure;}return result;}
  finally{clearTimeout(timeout);controllers.current.delete(controller);}
 },[]);
 const apply=useCallback((result:JourneyResponse,epoch:number)=>{if(generation.current!==epoch)return;activeRef.current=result.active;setActive(result.active);if(result.stop){lastRef.current=result.stop;setLastStop(result.stop);}if(result.active?.data.lastPoint){setLastFixAt(result.active.data.lastPoint.capturedAt);setAccuracy(result.active.data.lastPoint.accuracy);}if(!result.active&&result.stop?.closedAt){queue.current=queue.current.filter(point=>point.stopId!==result.stop!.id);setPendingCount(queue.current.length);}},[]);
 const flush=useCallback(async(epoch:number)=>{
  if(generation.current!==epoch||!enabledRef.current)return;
  const trimmed=trimJourneyBuffer(queue.current);queue.current=trimmed.points;setPendingCount(queue.current.length);if(trimmed.dropped){pendingGaps.current.add('buffer_expired');setError('expired');}
  while(queue.current.length&&generation.current===epoch){const stopId=queue.current[0].stopId,batch=queue.current.filter(point=>point.stopId===stopId).slice(0,50),ids=new Set(batch.map(point=>point.id));
   try{const result=await request({action:'samples',stopId,points:batch.map(sample=>omit(sample,'stopId'))});if(generation.current!==epoch)return;queue.current=queue.current.filter(point=>!ids.has(point.id));apply(result,epoch);}
   catch(failure){if(generation.current!==epoch)return;const status=(failure as Error&{status?:number}).status;
    if(status===400){queue.current=queue.current.filter(point=>!ids.has(point.id));pendingGaps.current.add('tracking_paused');setError('invalid');}
    else if(status===409){const current=await request();if(generation.current!==epoch)return;apply(current,epoch);const last=Date.parse(current.active?.data.lastPoint?.capturedAt||'');queue.current=queue.current.filter(point=>point.stopId!==stopId||current.active?.id===stopId&&(!Number.isFinite(last)||Date.parse(point.capturedAt)>last));if(queue.current.some(point=>ids.has(point.id)))queue.current=queue.current.filter(point=>!ids.has(point.id));pendingGaps.current.add('tracking_paused');setError('invalid');}
    else throw failure;
   }
   setPendingCount(queue.current.length);
  }
  const stop=activeRef.current;
  if(stop){for(const reason of [...pendingGaps.current]){const result=await request({action:'gap',stopId:stop.id,reason});if(generation.current!==epoch)return;pendingGaps.current.delete(reason);apply(result,epoch);}}
  else pendingGaps.current.clear();
  if(endRef.current){const ending=endRef.current,result=await request({action:'end',...ending});if(generation.current!==epoch)return;endRef.current=null;apply(result,epoch);}
  setError(previous=>previous==='sync'?'':previous);
 },[apply,request]);
 const scheduleFlush=useCallback(()=>{if(flushQueued.current||!enabledRef.current)return;flushQueued.current=true;const epoch=generation.current;void serial(async()=>{try{await flush(epoch);}catch(failure){if(generation.current===epoch){setError('sync');const status=(failure as Error&{status?:number}).status;if(status===401||status===403){pausedRef.current=true;setPaused(true);queue.current=[];setPendingCount(0);}}}finally{if(generation.current===epoch)flushQueued.current=false;}});},[flush,serial]);
 const selectCustomer=useCallback(async(customerId:string,signal?:AbortSignal,options?:SelectionOptions)=>{
  if(signal?.aborted||!customerId||!enabledRef.current||!trackingWindowOpen())return null;const epoch=generation.current,selection=++selectionRequest.current,currentSelection=()=>!signal?.aborted&&generation.current===epoch&&enabledRef.current,clearDesired=()=>{if(selectionRequest.current===selection&&desiredSelection.current===customerId)desiredSelection.current='';};desiredSelection.current=customerId;selectionFailure.current='';
  return serial(async()=>{if(!currentSelection()){if(signal?.aborted)clearDesired();return null;}if(selectionRequest.current===selection)selectionFailure.current='';
   const current=activeRef.current;if(current?.customerId===customerId&&current.date===journeyDay()&&!pausedRef.current){clearDesired();return current;}
   setBusy(true);try{try{if(!currentSelection())return null;await flush(epoch);}catch(failure){if(!currentSelection())return null;if((failure as Error&{status?:number}).status!==403)throw failure;const fresh=await request();if(!currentSelection())return null;queue.current=[];pendingGaps.current.clear();endRef.current=null;setPendingCount(0);apply(fresh,epoch);}
    if(!currentSelection())return null;if(!trackingWindowOpen()){clearDesired();return null;}const createKey=options?.createKey||selectionKeys.current.get(customerId)||crypto.randomUUID();if(!options?.createKey)selectionKeys.current.set(customerId,createKey);
    if(!currentSelection())return null;const result=await request({action:'select',customerId,createKey});if(generation.current!==epoch)return null;if(selectionKeys.current.get(customerId)===createKey)selectionKeys.current.delete(customerId);if(!currentSelection()){pausedRef.current=true;setPaused(true);apply(result,epoch);return null;}apply(result,epoch);clearDesired();pausedRef.current=false;setPaused(false);endRef.current=null;lastQueuedAt.current=0;setError('');return result.stop;
   }catch(failure){if(currentSelection()){if(selectionRequest.current===selection)selectionFailure.current=selectFailureMessage(failure,'journey_sync_failed');setError('sync');}return null;}finally{if(signal?.aborted)clearDesired();if(generation.current===epoch)setBusy(false);}
  });
 },[apply,flush,request,serial]);
 const end=useCallback(async(customerId?:string,reason='day_end',expectedStopId?:string)=>{
  const current=activeRef.current,epoch=generation.current;
  if(!customerId||desiredSelection.current===customerId)desiredSelection.current='';
  // Stop immediately; the serialized lookup also catches an in-flight customer selection.
  if(current&&(!customerId||current.customerId===customerId)&&(!expectedStopId||current.id===expectedStopId)){pausedRef.current=true;setPaused(true);}
  await serial(async()=>{if(generation.current!==epoch)return;const stop=activeRef.current;if(!stop||customerId&&stop.customerId!==customerId||expectedStopId&&stop.id!==expectedStopId)return;pausedRef.current=true;setPaused(true);endRef.current={stopId:stop.id,reason};setBusy(true);try{await flush(epoch);}catch{if(generation.current===epoch)setError('sync');}finally{if(generation.current===epoch)setBusy(false);}});
 },[flush,serial]);
 const cancelSelection=useCallback((id:string,reason='contact_type_changed',stopId?:string)=>end(id,reason,stopId),[end]);
 const stopDay=useCallback(async()=>{if(member.current?.role==='rep'||!enabledRef.current)return;await end(undefined,'day_end');},[end]);
 const retry=useCallback(()=>{setError('');if(desiredSelection.current){void selectCustomer(desiredSelection.current);return;}if(!endRef.current){pausedRef.current=false;setPaused(false);}setRetryTick(value=>value+1);if(!activeRef.current){const epoch=generation.current;void serial(async()=>{try{apply(await request(),epoch);}catch{if(generation.current===epoch)setError('sync');}});}scheduleFlush();},[apply,request,scheduleFlush,selectCustomer,serial]);
 const stopFor=useCallback((id:string)=>{const stop=activeRef.current?.customerId===id?activeRef.current:lastRef.current?.customerId===id?lastRef.current:null;return stop?.date===journeyDay()?stop:null;},[]);

 useEffect(()=>{
  const epoch=++generation.current;queue.current=[];pendingGaps.current.clear();selectionKeys.current.clear();desiredSelection.current='';selectionFailure.current='';activeRef.current=null;lastRef.current=null;pausedRef.current=false;endRef.current=null;lastQueuedAt.current=0;flushQueued.current=false;
  setActive(null);setLastStop(null);setPendingCount(0);setError('');setPaused(false);setLastFixAt('');setAccuracy(null);setBusy(false);setLoading(enabled);
  if(enabled)void serial(async()=>{try{const result=await request();apply(result,epoch);}catch{if(generation.current===epoch)setError('sync');}finally{if(generation.current===epoch)setLoading(false);}});
  return()=>{generation.current++;selectionFailure.current='';for(const controller of controllers.current)controller.abort();controllers.current.clear();queue.current=[];pendingGaps.current.clear();activeRef.current=null;lastRef.current=null;};
 },[me?.id,me?.role,me?.active,me?.regionScope,me?.authVersion,me?.supervisorId,me?.branch,enabled,apply,request,serial]);

 useEffect(()=>{
  if(!enabled||!active||paused||!windowOpen)return;
  if(active.date!==journeyDay()){void end(undefined,'date_changed');return;}
  const stopId=active.id,epoch=generation.current;let disposed=false,watch:number|undefined,gettingFix=false,lastGap='';
  const isCurrent=()=>!disposed&&generation.current===epoch&&activeRef.current?.id===stopId&&!pausedRef.current&&trackingWindowOpen();
  function reportGap(reason:string,kind:TrackerError){if(!isCurrent())return;setError(kind);if(lastGap!==reason){pendingGaps.current.add(reason);lastGap=reason;scheduleFlush();}}
  const captured=(position:GeolocationPosition)=>{
   if(!isCurrent())return;if(activeRef.current?.date!==journeyDay()){void end(undefined,'date_changed');return;}
   if(!trackingWindowOpen(position.timestamp))return;
   const sample=positionSample(position);if(!sample||Date.now()-position.timestamp>120000){reportGap('gps_unavailable','invalid');return;}
   const at=Date.parse(sample.capturedAt),selected=Date.parse(activeRef.current.selectedAt),serverLast=Date.parse(activeRef.current.data.lastPoint?.capturedAt||'');
   if(at<selected||at<=lastQueuedAt.current||Number.isFinite(serverLast)&&at<=serverLast)return;
   setLastFixAt(sample.capturedAt);setAccuracy(sample.accuracy);
   if(at-lastQueuedAt.current<10000)return;
   lastQueuedAt.current=at;lastGap='';setError(previous=>['permission','unavailable','invalid','unsupported'].includes(previous)?'':previous);
   const trimmed=trimJourneyBuffer([...queue.current,{...sample,stopId}]);queue.current=trimmed.points;setPendingCount(queue.current.length);if(trimmed.dropped){pendingGaps.current.add('buffer_expired');setError('expired');}
   if(queue.current.length===1)scheduleFlush();
  };
  const failed=(failure:GeolocationPositionError)=>{reportGap(failure.code===1?'permission_denied':'gps_unavailable',failure.code===1?'permission':'unavailable');if(failure.code===1){pausedRef.current=true;setPaused(true);}};
  const freshFix=()=>{if(!isCurrent()||gettingFix||document.hidden)return;gettingFix=true;navigator.geolocation.getCurrentPosition(position=>{gettingFix=false;captured(position);},failure=>{gettingFix=false;failed(failure);},{enableHighAccuracy:true,maximumAge:0,timeout:12000});};
  if(!window.isSecureContext||!navigator.geolocation){reportGap('gps_unavailable','unsupported');return()=>{disposed=true;};}
  try{watch=navigator.geolocation.watchPosition(captured,failed,{enableHighAccuracy:true,maximumAge:0,timeout:20000});freshFix();}catch{reportGap('gps_unavailable','unavailable');}
  const heartbeat=setInterval(()=>{if(activeRef.current?.date!==journeyDay()){void end(undefined,'date_changed');return;}freshFix();},15000);
  const uploader=setInterval(scheduleFlush,10000);
  return()=>{disposed=true;if(watch!==undefined)navigator.geolocation.clearWatch(watch);clearInterval(heartbeat);clearInterval(uploader);};
 },[enabled,active?.id,paused,windowOpen,retryTick,end,scheduleFlush]);

 useEffect(()=>{
  if(enabled&&!windowOpen){scheduleFlush();const epoch=generation.current;void serial(async()=>{try{apply(await request(),epoch);}catch{if(generation.current===epoch)setError('sync');}});}
 },[enabled,windowOpen,apply,request,scheduleFlush,serial]);

 useEffect(()=>{
  // Visibility and network status describe transport, not missing GPS.
  // The server detects real sample gaps; explicit permission/GPS failures still report gaps.
  const visibility=()=>{setHidden(document.hidden);if(activeRef.current&&!pausedRef.current&&trackingWindowOpen()){if(!document.hidden)setRetryTick(value=>value+1);}};
  const offline=()=>{if(activeRef.current&&trackingWindowOpen()){setError('sync');}};
  const online=()=>scheduleFlush();
  document.addEventListener('visibilitychange',visibility);window.addEventListener('offline',offline);window.addEventListener('online',online);setHidden(document.hidden);
  return()=>{document.removeEventListener('visibilitychange',visibility);window.removeEventListener('offline',offline);window.removeEventListener('online',online);};
 },[scheduleFlush]);
 const value=useMemo<TrackerContext>(()=>({isRep:enabled&&me?.role==='rep',continuousStatus:enabled&&me?.role==='rep'?'browser':'disabled',setupContinuous:empty.setupContinuous,active,lastStop,loading,busy,error,errorMessage:selectionFailure.current,operationError:'',pendingCount,hidden,paused,outsideTrackingHours:enabled&&!windowOpen,lastFixAt,accuracy,native:false,appVersion:'',mapsLaunchSupported:false,foregroundDirectionsSupported:false,tracking:windowOpen&&!!active&&!paused,gate:BROWSER_GATE,selectCustomer,selectFailure,cancelSelection,stopDay,retry,stopFor}),[enabled,me?.role,active,lastStop,loading,busy,error,pendingCount,hidden,paused,windowOpen,lastFixAt,accuracy,selectCustomer,selectFailure,cancelSelection,stopDay,retry,stopFor]);
 return <Tracker.Provider value={value}>{children}</Tracker.Provider>;
}

/** A form changing to a call must not keep a journey it just initiated running. */
export function useAutomaticJourney(input:{customerId:string;type:string;enabled:boolean;date?:string}){
 const {selectCustomer,cancelSelection,stopFor,outsideTrackingHours}=useJourneyTracker(),selected=useRef<{customerId:string;createKey:string;stopId?:string;cancelReason?:string}|null>(null);
 useEffect(()=>{
  if(outsideTrackingHours)return;
  if(shouldStartJourney(input)){
   const candidate={customerId:input.customerId,createKey:crypto.randomUUID(),stopId:undefined as string|undefined,cancelReason:undefined as string|undefined};selected.current=candidate;
   // An initially empty React snapshot can hydrate a pre-existing Maps stop
   // while this request is queued. Only the server ID tied to this form's own
   // idempotency key proves that the form created the station it may cancel.
   void selectCustomer(input.customerId,undefined,{createKey:candidate.createKey}).then(stop=>{if(!stop||stop.closedAt||stop.customerId!==candidate.customerId||stop.id!=='journey-'+stop.memberId+'-'+candidate.createKey)return;candidate.stopId=stop.id;if(candidate.cancelReason)void cancelSelection(candidate.customerId,candidate.cancelReason,stop.id);});
  }else if(selected.current){const previous=selected.current;selected.current=null;previous.cancelReason=input.date&&input.date!==journeyDay()?'date_changed':'contact_type_changed';if(previous.stopId)void cancelSelection(previous.customerId,previous.cancelReason,previous.stopId);}
 },[input.customerId,input.type,input.enabled,input.date,outsideTrackingHours,selectCustomer,cancelSelection,stopFor]);
 return ()=>!input.date||input.date===journeyDay()?stopFor(input.customerId)?.id:undefined;
}

export function trackingFailureText(message:string,language:string){
 const say=(ar:string,en:string)=>language==='en'?en:ar;
 if(message==='fine_location_permission_required')return say('إذن الموقع الدقيق غير متاح. فعّل الموقع الدقيق من إعدادات يورست ثم أعد التفعيل.','Precise location is not allowed. Enable precise location in Yourrest app settings, then retry setup.');
 if(message==='notification_permission_required')return say('إذن الإشعارات غير متاح. فعّله من إعدادات يورست لعرض إشعار تسجيل خط السير.','Notifications are not allowed. Enable them in Yourrest app settings for the route recording notification.');
 if(message==='background_permission_required')return say('اختر السماح بالموقع طوال الوقت من أذونات يورست، ثم ارجع وأعد التفعيل.','Choose Allow all the time in Yourrest location permissions, then return and retry setup.');
 if(message==='location_services_disabled')return say('خدمة الموقع في الهاتف مغلقة. فعّل الموقع من إعدادات الجهاز.','The phone location service is off. Enable location in device settings.');
 if(message==='native_upgrade_required')return say('ثبّت تطبيق أندرويد '+SERVED_APP_VERSION+' فوق النسخة الحالية دون حذفها.','Install Android app '+SERVED_APP_VERSION+' over the current app without uninstalling.');
 if(message==='native_unavailable'||message==='native_invalid_state')return say('تعذر الاتصال بخدمة التطبيق. أغلق يورست وافتحه، وتأكد من تثبيت الإصدار '+SERVED_APP_VERSION+'.','The app service is unavailable. Reopen Yourrest and make sure version '+SERVED_APP_VERSION+' is installed.');
 if(message==='native_pending_sync')return say('توجد بيانات خط سير محفوظة لم تنتهِ مزامنتها. راجع الاتصال ثم أعد المحاولة.','Saved route data is still awaiting synchronization. Check connectivity and retry.');
 if(message==='native_session_changed')return say('تغيّر الحساب أثناء العملية. أعد فتح الشاشة من الحساب الحالي.','The account changed during this action. Reopen this screen from the current account.');
 return message;
}

/** Retained legacy Friday data is informational; it never becomes a sync failure. */
function retainedFridayNotice(state:TrackerContext,language:string){
 if(!state.native||!((state.quarantinedCount||0)+(state.quarantinedGapCount||0)))return null;
 return <div className="journey-form-notice no-print" role="status"><MapPin size={16}/><span>{language==='en'?'Old Friday location data remains temporarily on this device and will not upload. This retained data does not block workday route recording.':'بيانات موقع قديمة ليوم الجمعة محفوظة مؤقتًا على الجهاز ولن تُرفع. هذه البيانات لا تمنع تسجيل خط السير في أيام العمل.'}</span></div>;
}

function continuousSetup(state:TrackerContext,language:string){
 const label=(ar:string,en:string)=>language==='en'?en:ar,status=state.continuousStatus;
 const version=state.native&&state.appVersion?label('الإصدار الحالي: ','Current version: ')+state.appVersion:'';
 // Only judge the installed app once it has reported itself; before that the capabilities are unknown, and rendering a notice would flash on every launch and differ from the server-rendered page.
 const mapsUpdate=state.native&&!!state.appVersion&&!state.foregroundDirectionsSupported&&(status==='ready'||status==='disabled'),retained=retainedFridayNotice(state,language);
 if(!state.isRep&&status!=='upgrade'||status==='ready'||status==='disabled'||status==='loading')return mapsUpdate?<div className="journey-form-notice no-print" role="status"><MapPin size={16}/><span>{label('حدّث تطبيق أندرويد إلى '+SERVED_APP_VERSION+' لتحسين فتح الاتجاهات في خرائط Google. ','Update Android to '+SERVED_APP_VERSION+' for improved Google Maps directions. ')}{version}</span><a className="btn small" href={SERVED_APK_PATH}>{label('تحديث التطبيق','Update app')}</a></div>:retained;
 const setup=status==='setup';
 return <section className="journey-tracking-banner journey-continuous-setup no-print" dir={language==='en'?'ltr':'rtl'} aria-busy={state.busy} aria-label={label('إعداد تسجيل خط السير','Route tracking setup')}>
  <span className="journey-tracking-icon"><MapPin size={22}/></span><div className="journey-tracking-copy"><strong>{setup?label('تفعيل تسجيل خط السير المستمر','Enable continuous route recording'):status==='upgrade'?label('حدّث تطبيق أندرويد لتفعيل التسجيل المستمر','Update Android app for continuous recording'):label('التسجيل المستمر يحتاج تطبيق أندرويد','Continuous recording requires the Android app')}</strong>
  <p>{setup?label('بعد موافقتك، يجمع التطبيق موقعك يوميًا ماعدا الجمعة من 6 صباحًا إلى 6 مساءً بتوقيت السعودية، حتى عند إغلاق واجهة التطبيق، ويعرض خط سيرك للمشرف ومدير المبيعات. يتوقف جمع الموقع يوم الجمعة وخارج هذه الساعات.','With your consent, the app collects your location every day except Friday from 6 AM to 6 PM Saudi time, including while its screen is closed, and shows your route to your supervisor and sales manager. Location collection stops on Fridays and outside these hours.'):status==='upgrade'?label('نزّل الإصدار '+SERVED_APP_VERSION+' لتسجيل خط السير من 6 صباحًا إلى 6 مساءً بتوقيت السعودية ماعدا الجمعة، ثم امنح إذن الموقع طوال الوقت.','Download version '+SERVED_APP_VERSION+' for route recording from 6 AM to 6 PM Saudi time except Friday, then allow location access all the time.'):label('المتصفح يسجل خط السير من 6 صباحًا إلى 6 مساءً بتوقيت السعودية ماعدا الجمعة أثناء فتح التطبيق فقط. استخدم تطبيق أندرويد للتسجيل في هذه الساعات عند إغلاق الواجهة، بعد الموافقة ومنح إذن الموقع طوال الوقت.','The browser records routes from 6 AM to 6 PM Saudi time except Friday, only while the app is open. Use the Android app to record during these hours while its screen is closed, after consent and allowing location access all the time.')}</p>
  {version&&<small>{version}</small>}
  {setup&&<small>{label('اضغط للتفعيل ثم اختر السماح طوال الوقت في إعدادات الموقع. قد تؤثر قيود الجهاز أو ضعف الموقع والاتصال على اكتمال التسجيل.','Tap to enable, then allow location access all the time in settings. Device restrictions or weak location and connectivity can interrupt recording.')}</small>}{state.errorMessage&&<p role="alert">{trackingFailureText(state.errorMessage,language)}</p>}</div>
  <div className="journey-tracking-actions">{setup?<button type="button" className="btn primary small" disabled={state.busy||state.loading} onClick={()=>void state.setupContinuous()}>{state.busy&&<Loader2 className="spin" size={15}/>} {state.busy?label('جارٍ التفعيل…','Enabling…'):label('تفعيل التسجيل المستمر','Enable continuous recording')}</button>:<a className="btn primary small" href={SERVED_APK_PATH}>{label(status==='upgrade'?'تحديث تطبيق أندرويد':'تنزيل تطبيق أندرويد',status==='upgrade'?'Update Android app':'Download Android app')}</a>}</div>
 </section>;
}
export function JourneyFormNotice(){
 const {language}=useLanguage(),state=useJourneyTracker(),{error,active,paused}=state,setup=continuousSetup(state,language);
 if(state.isRep&&['setup','upgrade','loading'].includes(state.continuousStatus))return setup;
 if(!error&&state.outsideTrackingHours)return <>{setup}<div className="journey-form-notice" role="status"><MapPin size={16}/><span>{language==='en'?'Route recording is paused on Fridays and outside 6 AM–6 PM Saudi time. You can still save visits and follow-ups.':'تسجيل خط السير متوقف يوم الجمعة وخارج الفترة من 6 صباحًا إلى 6 مساءً بتوقيت السعودية. تقدر تسجّل الزيارات والمتابعات عادي.'}</span></div></>;
 if(!error&&!(active&&paused))return setup;
 return <>{setup}<div className="journey-form-notice" role="status"><AlertTriangle size={16}/><span>{language==='en'?'Tracking is interrupted. Check location permission and connectivity.':'التسجيل متوقف أو به انقطاع. راجع إذن الموقع والاتصال.'}{state.errorMessage&&<small>{trackingFailureText(state.errorMessage,language)}</small>}</span></div></>;
}

/** Routine recording is quiet; only actionable tracking problems occupy the workspace. */
export function JourneyTrackingBanner({compact=false}:{compact?:boolean}={}){
 const state=useJourneyTracker(),{language}=useLanguage(),label=(ar:string,en:string)=>language==='en'?en:ar;
 const stop=state.active||state.lastStop,missingLocation=!!state.active&&(stop?.snapshot.latitude===null||stop?.snapshot.longitude===null);
 const problem=!!state.error||!state.outsideTrackingHours&&!!state.active&&(state.paused||state.hidden||!!state.active.data.durationUncertain||missingLocation);
 const stopLabel=label('إنهاء تسجيل اليوم','End today’s tracking');
 const scheduleLabel=label('تسجيل خط السير متوقف الآن؛ يعمل من 6 صباحًا إلى 6 مساءً بتوقيت السعودية ماعدا الجمعة','Route recording is paused; it runs from 6 AM to 6 PM Saudi time except Friday');
 if(compact&&state.outsideTrackingHours&&(state.isRep||state.active))return <span className="icon-button journey-tracking-control journey-tracking-control-scheduled" role="img" aria-label={scheduleLabel} title={scheduleLabel}><MapPin size={18}/></span>;
 if(compact&&state.isRep)return state.active||state.tracking?<span className={'icon-button journey-tracking-control'+(problem?' journey-tracking-control-warning':'')} role="img" aria-label={label(problem?'تسجيل الموقع يحتاج مراجعة':'تسجيل الموقع مفعّل',problem?'Location recording needs attention':'Location recording is enabled')} title={label(problem?'تسجيل الموقع يحتاج مراجعة':'تسجيل الموقع مفعّل',problem?'Location recording needs attention':'Location recording is enabled')}><MapPin size={18}/><span className="journey-tracking-dot" aria-hidden="true"/></span>:null;
 if(compact)return state.active||state.tracking?<button type="button" className={'icon-button journey-tracking-control'+(problem?' journey-tracking-control-warning':'')} disabled={state.busy} aria-label={stopLabel} title={stopLabel} onClick={()=>void state.stopDay()}>{state.busy?<Loader2 className="spin" size={18}/>:<PauseCircle size={18}/>}<span className="journey-tracking-dot" aria-hidden="true"/></button>:null;
 // Keep explicit setup/consent and the compact status, without repeated workspace warnings.
 return continuousSetup(state,language);
}
