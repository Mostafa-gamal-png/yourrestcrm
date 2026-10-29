// Whether the client code now running is still the code the server serves. Every deployment renames the hashed scripts, so
// the page learns of a newer release when its own script no longer exists on the server (404), or, for the device's offline
// shell, when its script is no longer in the server's shell manifest. Nothing reloads on its own: the page only shows a notice.
export type Freshness='unknown'|'current'|'stale';
export type FreshnessState={freshness:Freshness;checkedAt:number;checking:boolean};
export type FreshnessResult={path:string;status:number|null};
export type ShellManifest={assets:{url:string}[]}|null|'error';
export const FRESHNESS_INTERVAL_MS=600000; // ten minutes, like the page's own periodic refresh
export const FRESHNESS_RESUME_GAP_MS=60000; // returning to the app after at least a minute away checks again
export const FRESHNESS_HEAD_LIMIT=6; // the page loads three scripts; the limit guards against a page that loads many
export const SHELL_MANIFEST_URL='/offline-shell-manifest.json';
export const ACTIVATE_UPDATE_MESSAGE='yourrest-activate-update';
// The scripts are asked about at an address of their own: Chromium (and the Android WebView) drops its cached copy of a script after a
// HEAD request for that very address, so asking the plain address made every opening download the page's scripts again (2026-10-29).
export const RELEASE_CHECK_QUERY='?release-check';
const SERVER_SCRIPTS='/_next/static/',SHELL_SCRIPTS='/offline-app/assets/';

type Doc={scripts:ArrayLike<{src:string}>};
type FetchLike=(url:string,init:{method:'HEAD'|'GET'})=>Promise<{status:number;json:()=>Promise<unknown>}>;
export type FreshnessEnvironment={document:()=>Doc|null;origin:()=>string;fetch:FetchLike;online:()=>boolean;visible:()=>boolean;now:()=>number;
 listen:(event:'visible',handler:()=>void)=>()=>void;every:(callback:()=>void,ms:number)=>()=>void;activateWaitingWorker:()=>Promise<void>;reload:()=>void};
export type FreshnessController={snapshot:()=>FreshnessState;subscribe:(listener:(state:FreshnessState)=>void)=>()=>void;check:(force?:boolean)=>Promise<Freshness>;reload:()=>Promise<void>};

/** The same-origin hashed scripts the page loaded: the server's page scripts, or the offline shell's. Inline and foreign scripts are not ours to check. */
export function runningScripts(doc:Doc|null,origin:string):string[]{
 const paths:string[]=[];
 if(!doc)return paths;
 for(const script of Array.from(doc.scripts)){
  if(!script.src)continue;
  let url:URL;try{url=new URL(script.src,origin);}catch{continue;}
  if(url.origin!==origin||url.search)continue;
  if((url.pathname.startsWith(SERVER_SCRIPTS)||url.pathname.startsWith(SHELL_SCRIPTS))&&!paths.includes(url.pathname))paths.push(url.pathname);
 }
 return paths;
}
export const isShellScript=(path:string)=>path.startsWith(SHELL_SCRIPTS);

/** The verdict from what the server answered: a vanished script is a newer release; a server that could not answer proves nothing. */
export function judge(results:FreshnessResult[],manifest:ShellManifest):Freshness{
 let unknown=false,current=false;
 for(const {path,status} of results){
  if(isShellScript(path)){
   if(manifest==='error'||!manifest){unknown=true;continue;}
   if(!manifest.assets.some(asset=>asset.url===path))return 'stale';
   current=true;continue;
  }
  if(status===404||status===410)return 'stale';
  if(status!==null&&(status>=200&&status<300||status===304))current=true;else unknown=true;
 }
 return unknown||!current?'unknown':'current';
}

export function createBuildFreshness(env:FreshnessEnvironment):FreshnessController{
 let state:FreshnessState={freshness:'unknown',checkedAt:0,checking:false};
 const listeners=new Set<(state:FreshnessState)=>void>();
 const stops:(()=>void)[]=[];let inFlight:Promise<Freshness>|null=null;
 const publish=(next:Partial<FreshnessState>)=>{state={...state,...next};for(const listener of listeners)listener(state);};
 async function run():Promise<Freshness>{
  const paths=runningScripts(env.document(),env.origin());
  if(!paths.length||!env.online())return state.freshness;
  publish({checking:true});
  try{
   const server=paths.filter(path=>!isShellScript(path)).slice(0,FRESHNESS_HEAD_LIMIT),shell=paths.filter(isShellScript);
   const results:FreshnessResult[]=await Promise.all(server.map(async path=>{try{return {path,status:(await env.fetch(path,{method:'HEAD'})).status};}catch{return {path,status:null};}}));
   let manifest:ShellManifest=null;
   if(shell.length){
    try{const response=await env.fetch(SHELL_MANIFEST_URL,{method:'GET'});const body=response.status>=200&&response.status<300?await response.json() as {assets?:unknown}:null;manifest=body&&Array.isArray(body.assets)?{assets:body.assets.filter((item):item is {url:string}=>!!item&&typeof (item as {url?:unknown}).url==='string')}:'error';}
    catch{manifest='error';}
    for(const path of shell)results.push({path,status:null});
   }
   const verdict=judge(results,manifest);
   // A newer release stays known until the page reloads; a later failed answer never hides it, and a failed answer never clears "current" either.
   publish({freshness:state.freshness==='stale'||verdict==='stale'?'stale':verdict==='current'?'current':state.freshness,checkedAt:env.now(),checking:false});
  }catch{publish({checking:false});}
  return state.freshness;
 }
 const check=(force=false)=>{if(inFlight)return inFlight;if(!force&&!env.visible())return Promise.resolve(state.freshness);inFlight=run().finally(()=>{inFlight=null;});return inFlight;};
 function start(){
  if(stops.length)return;
  stops.push(env.every(()=>{void check();},FRESHNESS_INTERVAL_MS));
  stops.push(env.listen('visible',()=>{if(env.now()-state.checkedAt>=FRESHNESS_RESUME_GAP_MS)void check();}));
  void check(true);
 }
 return {
  snapshot:()=>state,
  subscribe(listener){listeners.add(listener);listener(state);start();return()=>{listeners.delete(listener);if(!listeners.size){for(const stop of stops.splice(0))stop();}};},
  check,
  // The only moment a newer offline shell may take over is this explicit reload: the page is leaving anyway.
  async reload(){try{await env.activateWaitingWorker();}catch{}env.reload();}
 };
}

let singleton:FreshnessController|undefined;
export function buildFreshness():FreshnessController{
 if(singleton)return singleton;
 singleton=createBuildFreshness({
  document:()=>typeof document==='undefined'?null:document,
  origin:()=>window.location.origin,
  fetch:async(url,init)=>{const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),10000);try{return await fetch(init.method==='HEAD'?url+RELEASE_CHECK_QUERY:url,{method:init.method,cache:'no-store',credentials:'same-origin',signal:abort.signal});}finally{clearTimeout(timeout);}},
  online:()=>navigator.onLine!==false,
  visible:()=>document.visibilityState==='visible',
  now:Date.now,
  listen:(event,handler)=>{if(event!=='visible')return()=>{};const onVisible=()=>{if(document.visibilityState==='visible')handler();};document.addEventListener('visibilitychange',onVisible);return()=>document.removeEventListener('visibilitychange',onVisible);},
  every:(callback,ms)=>{const timer=window.setInterval(callback,ms);return()=>window.clearInterval(timer);},
  // Looks for a newer worker for at most three seconds, then asks a waiting one to take over and gives it a moment to do so.
  activateWaitingWorker:async()=>{
   if(!('serviceWorker' in navigator))return;
   const registration=await navigator.serviceWorker.getRegistration('/');if(!registration)return;
   await Promise.race([registration.update().catch(()=>{}),new Promise<void>(resolve=>setTimeout(resolve,3000))]);
   if(!registration.waiting)return;
   const taken=new Promise<void>(resolve=>{navigator.serviceWorker.addEventListener('controllerchange',()=>resolve(),{once:true});setTimeout(resolve,1500);});
   registration.waiting.postMessage({type:ACTIVATE_UPDATE_MESSAGE});await taken;
  },
  reload:()=>window.location.reload()
 });
 return singleton;
}
