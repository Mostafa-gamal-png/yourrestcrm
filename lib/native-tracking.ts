/** Native tracking is deliberately separate from browser GPS. The UA exists before
 * the asynchronous bridge injection, so native pages never create a second watcher. */
type NativePermission='granted'|'denied'|'prompt';
export type NativeTrackingState={tracking:boolean;permission:NativePermission;pendingCount:number;pendingGapCount:number|null;quarantinedCount?:number;quarantinedGapCount?:number;quarantineNotice?:string;lastFixAt:string;accuracy:number|null;error:string;syncError:string;memberId:string|null;regionScope:string|null;enrolledRole:string|null;dayId:string|null;date:string|null;stopId:string|null;directionsSupported?:boolean;mapsLaunchSupported:boolean;foregroundDirectionsSupported:boolean;immutableBindingSupported:boolean;accountRecoverySupported:boolean;appVersion:string;continuousSupported:boolean;workHoursSupported:boolean;fridayExclusionSupported:boolean;trackingWindowActive:boolean;nextTrackingWindowAt:string;enrolled:boolean;backgroundPermission:NativePermission;fineLocationPermission:NativePermission|null;notificationPermission:NativePermission|null;locationServicesEnabled:boolean|null;continuousConsent:boolean|null};
type NativeMethod='prepare'|'enroll'|'start'|'flush'|'status'|'stop'|'logout'|'directions'|'openDirections'|'refreshAccount';
type NativeBridge={request:(method:NativeMethod,payload:Record<string,unknown>)=>Promise<unknown>};
declare global {interface Window {__yourrestNative?:NativeBridge;__yourrestNativeScope?:string;__yourrestNativeGeneration?:number;}}
export const isNativeTrackingApp=()=>typeof navigator!=='undefined'&&/(?:^|\s)YourrestCRM-Android\/1(?:\s|$)/.test(navigator.userAgent||'');
export const nativeTrackingGeneration=()=>typeof window==='undefined'?0:window.__yourrestNativeGeneration||0;
export function normalizeNativeState(value:unknown):NativeTrackingState{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('native_invalid_state');
 const state=value as Record<string,unknown>;
 if(typeof state.tracking!=='boolean'||!['granted','denied','prompt'].includes(String(state.permission)))throw Error('native_invalid_state');
 const text=(key:string)=>typeof state[key]==='string'?state[key] as string:'';
 const permission=(key:string):NativePermission|null=>['granted','denied','prompt'].includes(String(state[key]))?state[key] as NativePermission:null;
 const boolean=(key:string)=>typeof state[key]==='boolean'?state[key] as boolean:null;
 const last=text('lastFixAt');
 const count=(key:string)=>typeof state[key]==='number'&&Number.isFinite(state[key])?Math.max(0,Math.floor(state[key] as number)):0;
 return {tracking:state.tracking,permission:state.permission as NativeTrackingState['permission'],pendingCount:typeof state.pendingCount==='number'&&Number.isFinite(state.pendingCount)?Math.max(0,Math.floor(state.pendingCount)):0,pendingGapCount:typeof state.pendingGapCount==='number'&&Number.isFinite(state.pendingGapCount)&&state.pendingGapCount>=0?Math.floor(state.pendingGapCount):null,quarantinedCount:count('quarantinedCount'),quarantinedGapCount:count('quarantinedGapCount'),quarantineNotice:text('quarantineNotice'),lastFixAt:last&&Number.isFinite(Date.parse(last))?last:'',accuracy:typeof state.accuracy==='number'&&Number.isFinite(state.accuracy)&&state.accuracy>=0?state.accuracy:null,error:text('error'),syncError:text('syncError'),memberId:text('memberId')||null,regionScope:text('regionScope')||null,enrolledRole:text('enrolledRole')||null,dayId:text('dayId')||null,date:text('date')||null,stopId:text('stopId')||null,directionsSupported:state.directionsSupported===true,mapsLaunchSupported:state.mapsLaunchSupported===true,foregroundDirectionsSupported:state.foregroundDirectionsSupported===true,immutableBindingSupported:state.immutableBindingSupported===true,accountRecoverySupported:state.accountRecoverySupported===true,appVersion:text('appVersion'),continuousSupported:state.continuousSupported===true,workHoursSupported:state.workHoursSupported===true,fridayExclusionSupported:state.fridayExclusionSupported===true,trackingWindowActive:state.trackingWindowActive===true,nextTrackingWindowAt:text('nextTrackingWindowAt'),enrolled:state.enrolled===true,backgroundPermission:permission('backgroundPermission')||'prompt',fineLocationPermission:permission('fineLocationPermission'),notificationPermission:permission('notificationPermission'),locationServicesEnabled:boolean('locationServicesEnabled'),continuousConsent:boolean('continuousConsent')};
}
/** New schedules require the installed native collector, not only refreshed web UI. */
export function nativeScheduleSupported(state:NativeTrackingState){
 const version=/^(\d+)\.(\d+)\.(\d+)$/.exec(state.appVersion);
 if(!state.workHoursSupported||!state.fridayExclusionSupported||!version)return false;
 const [major,minor,patch]=version.slice(1).map(Number);
 return major>1||major===1&&(minor>0||minor===0&&patch>=7);
}
/** Wait for the late bridge with a bounded timeout. Never fall back to web GPS. */
export function waitForNativeBridge(timeoutMs=12000):Promise<NativeBridge>{
 if(!isNativeTrackingApp())return Promise.reject(Error('native_unavailable'));
 if(window.__yourrestNative?.request)return Promise.resolve(window.__yourrestNative);
 return new Promise((resolve,reject)=>{
  const cleanup=()=>{clearTimeout(timeout);clearInterval(poll);window.removeEventListener('yourrest:native-state',check);window.removeEventListener('yourrest:native-ready',check);};
  const check=()=>{if(window.__yourrestNative?.request){cleanup();resolve(window.__yourrestNative);}};
  const timeout=setTimeout(()=>{cleanup();reject(Error('native_unavailable'));},timeoutMs),poll=setInterval(check,100);
  window.addEventListener('yourrest:native-state',check);window.addEventListener('yourrest:native-ready',check);check();
 });
}
export async function nativeTrackingRequest(method:NativeMethod,payload:Record<string,unknown>={}):Promise<NativeTrackingState>{
 const epoch=nativeTrackingGeneration(),bridge=await waitForNativeBridge();
 if(nativeTrackingGeneration()!==epoch)throw Error('native_session_changed');
 // Android permission/consent dialogs may remain open while the person reads them.
 // The bridge owns request cancellation; an early JS timeout could race a late start.
 const state=await bridge.request(method,payload);
 if(nativeTrackingGeneration()!==epoch)throw Error('native_session_changed');
 return normalizeNativeState(state);
}
export function subscribeNativeTracking(listener:(state:NativeTrackingState)=>void){
 const onState=(event:Event)=>{try{listener(normalizeNativeState((event as CustomEvent).detail));}catch{/* An invalid event cannot claim that tracking is running. */}};
 window.addEventListener('yourrest:native-state',onState);
 return()=>window.removeEventListener('yourrest:native-state',onState);
}
/** Stops native collection before the server session is invalidated. */
export async function logoutNativeTracking(){
 if(!isNativeTrackingApp())return;
 window.__yourrestNativeGeneration=nativeTrackingGeneration()+1;
 await nativeTrackingRequest('logout');
 delete window.__yourrestNativeScope;
}
