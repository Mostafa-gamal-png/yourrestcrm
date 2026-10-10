import {isNativeTrackingApp,waitForNativeBridge} from './native-tracking';

export type UpdatePhase='idle'|'checking'|'available'|'upToDate'|'downloading'|'ready'|'permissionRequired'|'installing'|'cancelled'|'error';
export type AppRelease={schemaVersion:1;packageName:'org.yourrest.crm';versionName:string;versionCode:number;apkUrl:string;sizeBytes:number;sha256:string;certificateSha256:string;releaseNotes:{ar:string[];en:string[]}};
export type AppUpdateState={native:boolean;protocol:0|1;phase:UpdatePhase;installedVersionCode:number|null;installedVersionName:string;availableVersionCode:number|null;availableVersionName:string;downloadedBytes:number;totalBytes:number;progress:number;error:string;offline:boolean;legacyUrl:string;legacyStarted:boolean;releaseNotes:{ar:string[];en:string[]}};
type UpdateBridge={updateProtocol?:number;request:(method:string,payload:Record<string,unknown>)=>Promise<unknown>};
type UpdateEnvironment={native:()=>boolean;online:()=>boolean;bridge:()=>Promise<UpdateBridge>;fetchRelease:()=>Promise<unknown>;now:()=>number;listen:(event:string,handler:(detail?:unknown)=>void)=>()=>void};
export type AppUpdateController={snapshot:()=>AppUpdateState;subscribe:(listener:(state:AppUpdateState)=>void)=>()=>void;check:(force?:boolean)=>Promise<void>;download:()=>Promise<void>;install:()=>Promise<void>;legacyDownloadStarted:()=>void};
const phases:UpdatePhase[]=['idle','checking','available','upToDate','downloading','ready','permissionRequired','installing','cancelled','error'];
const empty=():AppUpdateState=>({native:false,protocol:0,phase:'idle',installedVersionCode:null,installedVersionName:'',availableVersionCode:null,availableVersionName:'',downloadedBytes:0,totalBytes:0,progress:0,error:'',offline:false,legacyUrl:'',legacyStarted:false,releaseNotes:{ar:[],en:[]}});
const integer=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
const notes=(value:unknown)=>{const record=value&&typeof value==='object'?value as Record<string,unknown>:{};const list=(key:string)=>Array.isArray(record[key])?(record[key] as unknown[]).filter((item):item is string=>typeof item==='string').slice(0,5).map(item=>item.slice(0,200)):[];return {ar:list('ar'),en:list('en')};};
const version=(value:unknown)=>typeof value==='string'&&/^\d+\.\d+\.\d+$/.test(value)?value:'';
export function compareAppVersions(left:string,right:string):number|null{if(!version(left)||!version(right))return null;const a=left.split('.').map(Number),b=right.split('.').map(Number);for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i]?1:-1;return 0;}
/** Only the fixed company host and immutable, versioned APK path may reach the legacy downloader. */
export function parseAppRelease(value:unknown):AppRelease{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_release');
 const item=value as Record<string,unknown>,code=integer(item.versionCode),size=integer(item.sizeBytes),name=version(item.versionName);
 if(item.schemaVersion!==1||item.packageName!=='org.yourrest.crm'||!code||!size||!name||typeof item.apkUrl!=='string'||typeof item.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(item.sha256)||typeof item.certificateSha256!=='string'||!/^[a-f0-9]{64}$/i.test(item.certificateSha256))throw Error('invalid_release');
 const url=new URL(item.apkUrl);
 if(url.origin!=='https://crm.yourrest.org'||url.username||url.password||url.search||url.hash||url.pathname!==`/downloads/yourrest-crm-android-v${name}-${code}.apk`)throw Error('invalid_release');
 return {schemaVersion:1,packageName:'org.yourrest.crm',versionName:name,versionCode:code,apkUrl:url.href,sizeBytes:size,sha256:item.sha256.toLowerCase(),certificateSha256:item.certificateSha256.toLowerCase(),releaseNotes:notes(item.releaseNotes)};
}
function parseNativeUpdate(value:unknown):Partial<AppUpdateState>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_native_update');
 const item=value as Record<string,unknown>,installed=integer(item.installedVersionCode),available=integer(item.availableVersionCode);
 if(!phases.includes(item.phase as UpdatePhase)||!installed||!version(item.installedVersionName))throw Error('invalid_native_update');
 let phase=item.phase as UpdatePhase;
 // A downloader or installer response never proves installation. PackageManager's installed code does.
 if(available&&installed>=available)phase='upToDate';
 else if(phase==='upToDate'&&available&&installed<available)phase='available';
 return {protocol:1,phase,installedVersionCode:installed,installedVersionName:version(item.installedVersionName),availableVersionCode:available,availableVersionName:version(item.availableVersionName),downloadedBytes:integer(item.downloadedBytes)||0,totalBytes:integer(item.totalBytes)||0,progress:typeof item.progress==='number'&&Number.isFinite(item.progress)?Math.max(0,Math.min(100,item.progress)):0,error:typeof item.error==='string'?item.error:'',releaseNotes:notes(item.releaseNotes),legacyUrl:''};
}
/** One controller survives page remounts; it never reloads the document or touches visit drafts/outboxes. */
export function createAppUpdateController(env:UpdateEnvironment):AppUpdateController{
 let state={...empty(),native:env.native(),offline:!env.online()},pending:Promise<void>|null=null,lastCheck=-Infinity,nativeEvents=0,stops:(()=>void)[]=[];
 const subscribers=new Set<(state:AppUpdateState)=>void>();
 const emit=(next:Partial<AppUpdateState>)=>{state={...state,...next};for(const listener of subscribers)listener(state);};
 const applyNative=(value:unknown)=>{const parsed=parseNativeUpdate(value);if(state.installedVersionCode&&parsed.installedVersionCode!<state.installedVersionCode)return;emit({...parsed,offline:!env.online()});};
 const nativeRequest=async(bridge:UpdateBridge,method:string)=>{const before=nativeEvents;const result=await bridge.request(method,{});if(before===nativeEvents)applyNative(result);};
 async function check(force=false){
  if(!state.native||pending)return pending||Promise.resolve();
  emit({offline:!env.online()});
  if(!env.online())return;
  if(!force&&env.now()-lastCheck<15000)return;
  lastCheck=env.now();
  const before=nativeEvents;pending=(async()=>{try{
   let bridge:UpdateBridge|undefined;try{bridge=await env.bridge();}catch{/* Legacy pages can still offer the verified download without a working bridge. */}
   if(bridge?.updateProtocol===1){
    await nativeRequest(bridge,'updateStatus');
    if(!['downloading','ready','permissionRequired','installing','cancelled'].includes(state.phase))await nativeRequest(bridge,'checkAppUpdate');
   }else{
    // Old APKs supply a version name via status, but not a verified version code.
    let installed='';try{const old=await bridge?.request('status',{});if(old&&typeof old==='object')installed=version((old as Record<string,unknown>).appVersion);}catch{/* Unknown version is never invented. */}
    emit({phase:'checking',installedVersionName:installed,installedVersionCode:null,protocol:0});
    const release=parseAppRelease(await env.fetchRelease()),comparison=compareAppVersions(installed,release.versionName);
    if(before===nativeEvents)emit({phase:comparison!==null&&comparison>=0?'upToDate':'available',availableVersionCode:release.versionCode,availableVersionName:release.versionName,totalBytes:release.sizeBytes,releaseNotes:release.releaseNotes,legacyUrl:release.apkUrl,error:'',offline:false});
   }
  }catch{if(before===nativeEvents)emit({phase:'error',error:'update_check_failed',offline:!env.online()});}finally{pending=null;}})();
  return pending;
 }
 async function action(method:'downloadAppUpdate'|'installAppUpdate'){
  if(pending||!state.native||state.protocol!==1)return;
  if(method==='downloadAppUpdate'&&!env.online()){emit({offline:true});return;}
  // A second tap cannot start another download/installer while the native operation is active.
  if(['downloading','installing'].includes(state.phase))return;
  const before=nativeEvents;pending=(async()=>{try{const bridge=await env.bridge();if(bridge.updateProtocol!==1)throw Error('unsupported');await nativeRequest(bridge,method);}catch{if(before===nativeEvents)emit({phase:'error',error:'update_action_failed',offline:!env.online()});}finally{pending=null;}})();return pending;
 }
 function listen(){
  const refresh=()=>{void check(true);},network=()=>{emit({offline:!env.online()});if(env.online())void check(true);};
  stops=[env.listen('yourrest:app-update',detail=>{try{applyNative(detail);nativeEvents++;}catch{/* Invalid events cannot dismiss an available update. */}}),env.listen('yourrest:native-ready',()=>{void check(true);}),env.listen('visible',refresh),env.listen('online',network),env.listen('offline',network)];
  void check();
 }
 return {snapshot:()=>state,subscribe(listener){subscribers.add(listener);listener(state);if(subscribers.size===1&&state.native)listen();return()=>{subscribers.delete(listener);if(!subscribers.size){for(const stop of stops)stop();stops=[];}};},check,download:()=>action('downloadAppUpdate'),install:()=>action('installAppUpdate'),legacyDownloadStarted:()=>emit({legacyStarted:true})};
}
let singleton:AppUpdateController|undefined;
export function appUpdateController():AppUpdateController{
 if(singleton)return singleton;
 singleton=createAppUpdateController({native:isNativeTrackingApp,online:()=>navigator.onLine!==false,bridge:async()=>await waitForNativeBridge() as unknown as UpdateBridge,now:Date.now,
  fetchRelease:async()=>{const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),10000);try{const response=await fetch('/api/app-update',{cache:'no-store',credentials:'same-origin',signal:abort.signal,headers:{Accept:'application/json'}});if(!response.ok)throw Error('update_check_failed');return await response.json();}finally{clearTimeout(timeout);}},
  listen:(event,handler)=>{if(event==='visible'){const onVisible=()=>{if(document.visibilityState==='visible')handler();};document.addEventListener('visibilitychange',onVisible);return()=>document.removeEventListener('visibilitychange',onVisible);}const callback=(value:Event)=>handler((value as CustomEvent).detail);window.addEventListener(event,callback);return()=>window.removeEventListener(event,callback);}
 });return singleton;
}
