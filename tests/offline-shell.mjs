import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const original=await readFile(path.join(root,'public/sw.js'),'utf8');
const revision='c'.repeat(64),source=original.replace(/const BUILD_REVISION = '[^']+';/,"const BUILD_REVISION = '"+revision+"';");
let checks=0;
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const equal=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const publicFiles=new Map([['/offline-app.html','<div id="yourrest-offline-app"></div>'],['/offline.html','Sign in online first'],['/offline-app/assets/app-123.js','public CRM code'],['/offline-app/assets/style-123.css','body{}']]);
const manifest={format:'yourrest-offline-shell-v1',revision,assets:[...publicFiles].map(([url,value])=>({url,sha256:createHash('sha256').update(value).digest('hex')}))};
function worker({alterManifest,alterResponse,manifestData=manifest,files=publicFiles,script=source}={}){
 const listeners=new Map(),stores=new Map(),writes=[],fetches=[],removed=[];let claims=0,fetcher;
 const defaultFetch=async(input)=>{
  const key=typeof input==='string'?input:new URL(input.url).pathname;
  if(key==='/offline-shell-manifest.json')return new Response(JSON.stringify(alterManifest?alterManifest(structuredClone(manifestData)):manifestData),{headers:{'Content-Type':'application/json'}});
  if(alterResponse)return alterResponse(key);
  if(files.has(key))return new Response(files.get(key));
  return new Response('private network response');
 };
 fetcher=defaultFetch;
 const context={URL,Response,Uint8Array,crypto:webcrypto,
  self:{location:{origin:'https://crm.yourrest.org'},clients:{claim:async()=>{claims++;}},addEventListener:(name,listener)=>listeners.set(name,listener)},
  caches:{open:async(name)=>{if(!stores.has(name))stores.set(name,new Map());return{put:async(key,value)=>{writes.push({name,key});stores.get(name).set(key,value.clone());},match:async(key)=>stores.get(name).get(key)?.clone()};},keys:async()=>[...stores.keys()],delete:async(name)=>{removed.push(name);return stores.delete(name);}},
  fetch:async(...args)=>{fetches.push(args);return fetcher(...args);}};
 vm.runInNewContext(script,context);
 return{stores,writes,fetches,removed,claims:()=>claims,fetchWith:fn=>fetcher=fn,event:async(type)=>{let work;listeners.get(type)({waitUntil:p=>work=p});await work;},request:async(pathname,options={})=>{let response;listeners.get('fetch')({request:{url:new URL(pathname,'https://crm.yourrest.org').href,method:'GET',mode:'navigate',...options},respondWith:p=>response=p});return response===undefined?undefined:await response;}};
}
const w=worker();await w.event('install');
equal(w.writes.length,manifest.assets.length+1,'Exact public assets and manifest are installed');
for(const [,options]of w.fetches){equal(options.credentials,'omit','Precache never sends credentials');equal(options.cache,'reload','Install bypasses old HTTP-cache assets');}
for(const {key}of w.writes)ok(key!=='/'&&!key.startsWith('/api/')&&key!=='/login','No private navigation/API response is cached');
w.stores.set('yourrest-crm-offline-old',new Map());w.stores.set('another-application',new Map());await w.event('activate');
equal(w.removed,['yourrest-crm-offline-old'],'Worker removes only previous Yourrest shell');equal(w.claims(),1,'First installation controls current clients');
for(const pathname of ['/','/login','/customer/123'])equal(await(await w.request(pathname)).text(),'private network response','Online navigation remains network authoritative');
equal(w.writes.length,manifest.assets.length+1,'Network private HTML never enters cache');
for(const status of [401,403,500]){w.fetchWith(async()=>new Response('server response',{status}));equal((await w.request('/')).status,status,'HTTP failures never unlock offline fallback');}
w.fetchWith(async()=>{throw new TypeError('offline');});
for(const pathname of ['/','/offline-app.html','/?entry=home'])equal(await(await w.request(pathname)).text(),publicFiles.get('/offline-app.html'),'Root network failure uses data-free shell');
for(const pathname of ['/login','/arbitrary/customer'])equal(await(await w.request(pathname)).text(),publicFiles.get('/offline.html'),'Other routes cannot unlock CRM fallback');
for(const pathname of ['/offline-app/assets/app-123.js','/offline-app/assets/style-123.css'])equal(await(await w.request(pathname,{mode:'cors'})).text(),publicFiles.get(pathname),'Exact precached app assets work offline');
const fetchCount=w.fetches.length;
for(const [pathname,options]of [['/api/crm',{}],['/api/visit-files?id=x',{}],['/files/private.pdf',{}],['/api/auth/verify',{method:'POST'}],['/',{method:'POST'}],['https://other.example/',{}],['https://tile.openstreetmap.org/1/1/1.png',{mode:'cors'}],['/assets/private-app.js',{mode:'cors'}]])equal(await w.request(pathname,options),undefined,'Private/download/third-party requests are not intercepted');
equal(w.fetches.length,fetchCount,'Ignored fetches are not handled by worker');
await assert.rejects(w.request('/offline-app/assets/unknown.js',{mode:'cors'}));checks++;
const empty=worker();empty.fetchWith(async()=>{throw new TypeError('offline');});equal((await empty.request('/')).status,503,'Missing precache honestly unavailable');
for(const mutate of [m=>({...m,revision:'d'.repeat(64)}),m=>({...m,assets:[...m.assets,{url:'/api/crm',sha256:'a'.repeat(64)}]}),m=>({...m,assets:[...m.assets,m.assets[0]]}),m=>({...m,assets:m.assets.map(a=>a.url==='/offline-app.html'?{...a,sha256:'a'.repeat(64)}:a)}),m=>({...m,assets:m.assets.filter(a=>a.url!=='/offline-app.html')})]){
 const invalid=worker({alterManifest:mutate});await assert.rejects(invalid.event('install'));checks++;
 ok(![...invalid.stores.values()].some(s=>s.has('/offline-shell-manifest.json')),'Failed install does not publish an incomplete shell');
}
for(const response of [new Response('missing',{status:404}),{ok:true,redirected:true,type:'basic',url:'https://crm.yourrest.org/login'},{ok:true,redirected:false,type:'opaque',url:'https://crm.yourrest.org/offline-app.html'},{ok:true,redirected:false,type:'basic',url:'https://other.example/offline-app.html'}]){
 const invalid=worker({alterResponse:async()=>response});await assert.rejects(invalid.event('install'));checks++;equal(invalid.stores.size,0,'Invalid asset response removes incomplete cache');
}
ok(!/location\.reload/.test(original),'The worker never reloads a page');
{const uses=[...original.matchAll(/skipWaiting/g)].length,handler=original.match(/addEventListener\('message'[\s\S]*?\n\}\);/);
 ok(uses===1&&handler&&/skipWaiting/.test(handler[0])&&/yourrest-activate-update/.test(handler[0]),'A newer worker takes over only when the page asks, in its explicit reload message');
 ok(!/addEventListener\('install'[\s\S]*?skipWaiting[\s\S]*?addEventListener\('activate'/.test(original),'Install does not skip waiting: an open page keeps its code until the user reloads');}
const entry=await readFile(path.join(root,'app/offline-entry.tsx'),'utf8');ok(entry.includes('createRoot')&&entry.includes('CRM'),'Public shell mounts same CRM client');ok(!entry.includes('requireApplicationUser'),'Public shell contains no server-auth HTML');
const install=await readFile(path.join(root,'app/install-app.tsx'),'utf8');ok(install.indexOf('registerInstallWorker();')<install.indexOf('if(isNativeTrackingApp())'),'Android registers the offline shell before hiding install UI');

// Validate the real emitted build, including all icon paths and byte hashes.
// This deliberately fails for a mismatched or stale generated manifest.
const actualManifest=JSON.parse(await readFile(path.join(root,'public/offline-shell-manifest.json'),'utf8'));
const actualFiles=new Map(await Promise.all(actualManifest.assets.map(async asset=>[asset.url,await readFile(path.join(root,'public',asset.url))])));
const actual=worker({manifestData:actualManifest,files:actualFiles,script:original});
await actual.event('install');checks++;
equal(actual.writes.length,actualManifest.assets.length+1,'Production worker installs every actual generated shell resource');
const appManifest=JSON.parse(await readFile(path.join(root,'public/manifest.webmanifest'),'utf8'));
for(const icon of appManifest.icons)ok(actualManifest.assets.some(asset=>asset.url===icon.src),'Actual application icon is precached');
ok(!actualManifest.assets.some(asset=>/\/icons\/(?:icon-|maskable-|apple-touch)/.test(asset.url)),'Unreferenced legacy icon aliases are excluded from manifest');
for(const url of ['/icons/icon-192.png','/icons/yourrest-company-unlisted.png']){
 const invalid=worker({alterManifest:m=>({...m,assets:[...m.assets,{url,sha256:'a'.repeat(64)}]})});await assert.rejects(invalid.event('install'));checks++;
}

const authCode=ts.transpileModule(await readFile(path.join(root,'lib/offline-auth.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
function authHarness(){const local=new Map(),exports={};let locks=0,fetches=0,network=true,storage=true;
 const context={exports,require:name=>{if(name==='./offline-store')return{lockOfflineSession:async()=>{locks++;}};throw Error(name);},AbortController,
  window:{localStorage:{getItem:key=>{if(!storage)throw Error('storage');return local.get(key)??null;},setItem:(key,value)=>{if(!storage)throw Error('storage');local.set(key,value);},removeItem:key=>{if(!storage)throw Error('storage');local.delete(key);}},setTimeout,clearTimeout},
  fetch:async()=>{fetches++;if(!network)throw new TypeError('offline');return new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}});}};
 vm.runInNewContext(authCode,context);return{api:exports,local,network:value=>network=value,storage:value=>storage=value,locks:()=>locks,fetches:()=>fetches};}
const auth=authHarness();equal(auth.api.isOfflineLogoutPending(),false,'Fresh browser has no logout lock');equal(await auth.api.finishPendingOfflineLogout(),false,'No pending lock means no extra server request');equal(auth.fetches(),0,'No unnecessary logout request');
auth.network(false);await auth.api.prepareOfflineLogout();ok(auth.api.isOfflineLogoutPending(),'Offline logout flag is durable before network');equal(auth.locks(),1,'Offline snapshot locked');await assert.rejects(auth.api.finishPendingOfflineLogout());checks++;ok(auth.api.isOfflineLogoutPending(),'Failed cookie logout cannot auto-unlock');
auth.network(true);equal(await auth.api.finishPendingOfflineLogout(),true,'Online cookie logout completes');ok(auth.api.isOfflineLogoutPending(),'Ordinary online refresh still cannot unlock logged-out account');auth.api.confirmOfflineSignIn();equal(auth.api.isOfflineLogoutPending(),false,'Only successful explicit login clears lock');
auth.storage(false);ok(auth.api.isOfflineLogoutPending(),'Unavailable local storage fails closed');await assert.rejects(auth.api.prepareOfflineLogout());checks++;
console.log(`Offline shell and logout: ${checks} checks passed.`);
