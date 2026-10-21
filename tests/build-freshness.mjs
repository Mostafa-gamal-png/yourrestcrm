// The "a newer version is available, reload" notice: the pure verdict, the controller with a fake environment (timers,
// visibility, offline, failures, no automatic reload), and the real component in Arabic and English.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript'),jsx=require('react/jsx-runtime');
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const libSource=await readFile(new URL('../lib/build-freshness.ts',import.meta.url),'utf8'),componentSource=await readFile(new URL('../app/build-notice.tsx',import.meta.url),'utf8');
const lib={exports:{}};new Function('require','module','exports',compile(libSource))(name=>{throw Error(name);},lib,lib.exports);
const {runningScripts,judge,createBuildFreshness,isShellScript,FRESHNESS_INTERVAL_MS,FRESHNESS_RESUME_GAP_MS,FRESHNESS_HEAD_LIMIT,SHELL_MANIFEST_URL,ACTIVATE_UPDATE_MESSAGE}=lib.exports;
let checks=0;const equal=(a,b,msg)=>{assert.deepEqual(a,b,msg);checks++;},truth=(a,msg)=>{assert(a,msg);checks++;};
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();await new Promise(resolve=>setImmediate(resolve));};
const ORIGIN='https://crm.yourrest.org';

// ---- which scripts the page is running
const doc=list=>({scripts:list.map(src=>({src}))});
equal(runningScripts(doc([ORIGIN+'/_next/static/chunks/index-AAA.js',ORIGIN+'/_next/static/chunks/framework-BBB.js',ORIGIN+'/theme-bootstrap.js','',ORIGIN+'/_next/static/chunks/index-AAA.js','https://cdn.example.com/_next/static/x.js',ORIGIN+'/_next/static/chunks/q.js?v=1','/_next/static/chunks/rel-CCC.js','javascript:void(0)']),ORIGIN),
 ['/_next/static/chunks/index-AAA.js','/_next/static/chunks/framework-BBB.js','/_next/static/chunks/rel-CCC.js'],'Only our own hashed scripts, once each; inline, foreign, versioned and bootstrap scripts are not ours to judge');
equal(runningScripts(doc([ORIGIN+'/offline-app/assets/app-XYZ.js']),ORIGIN),['/offline-app/assets/app-XYZ.js'],'The offline shell script is recognised');
equal(runningScripts(null,ORIGIN),[],'No document, nothing to check');
truth(isShellScript('/offline-app/assets/app-X.js')&&!isShellScript('/_next/static/chunks/index-A.js'));

// ---- the verdict
const P='/_next/static/chunks/index-A.js',Q='/_next/static/chunks/framework-B.js',S='/offline-app/assets/app-X.js';
equal(judge([{path:P,status:200},{path:Q,status:200}],null),'current','Every script still served: current');
equal(judge([{path:P,status:404},{path:Q,status:200}],null),'stale','One vanished script is a newer release');
equal(judge([{path:P,status:410}],null),'stale','Gone counts too');
equal(judge([{path:P,status:503}],null),'unknown','A server that could not answer proves nothing (a release being switched answers 5xx)');
equal(judge([{path:P,status:null}],null),'unknown','A network failure proves nothing');
equal(judge([{path:P,status:502},{path:Q,status:200}],null),'unknown','A partial answer proves nothing either');
equal(judge([{path:P,status:502},{path:Q,status:404}],null),'stale','A vanished script decides even when another answer failed');
equal(judge([{path:P,status:403}],null),'unknown','A refusal is not a missing script');
equal(judge([{path:S,status:null}],{assets:[{url:S}]}),'current','Offline shell script listed in the server manifest: current');
equal(judge([{path:S,status:null}],{assets:[{url:'/offline-app/assets/app-NEW.js'}]}),'stale','Offline shell script no longer in the manifest: a newer shell exists');
equal(judge([{path:S,status:null}],'error'),'unknown','Manifest unreadable: unknown');
equal(judge([{path:S,status:null}],null),'unknown','No manifest: unknown');
equal(judge([],null),'unknown','Nothing to judge');

// ---- the controller
function fixture(options={}){
 let online=options.online!==false,visible=options.visible!==false,now=1e6,stale=new Set(),failing=new Set(),manifest=options.manifest??{assets:[{url:S}]},manifestStatus=200;
 const scripts=options.scripts||[ORIGIN+P,ORIGIN+Q];
 const fetches=[],timers=[],visibleHandlers=new Set(),log=[];let reloads=0,activations=0,activateFails=false,activateGate=null;
 const env={document:()=>doc(scripts),origin:()=>ORIGIN,online:()=>online,visible:()=>visible,now:()=>now,
  fetch:async(url,init)=>{fetches.push({url,method:init.method});if(failing.has(url))throw Error('network');
   if(url===SHELL_MANIFEST_URL)return {status:manifestStatus,json:async()=>manifest};
   return {status:stale.has(url)?404:(options.status??200),json:async()=>({})};},
  listen:(event,handler)=>{visibleHandlers.add(handler);return()=>visibleHandlers.delete(handler);},
  every:(callback,ms)=>{const timer={callback,ms,stopped:false};timers.push(timer);return()=>{timer.stopped=true;};},
  activateWaitingWorker:async()=>{activations++;log.push('activate');if(activateGate)await activateGate;if(activateFails)throw Error('no worker');},
  reload:()=>{reloads++;log.push('reload');}};
 const controller=createBuildFreshness(env);
 return {controller,fetches,timers,log,get reloads(){return reloads;},get activations(){return activations;},stale:path=>stale.add(path),fail:url=>failing.add(url),unfail:url=>failing.delete(url),setOnline:v=>{online=v;},setVisible:v=>{visible=v;},tick:ms=>{now+=ms;},resume:()=>{for(const handler of [...visibleHandlers])handler();},
  setManifest:(value,status=200)=>{manifest=value;manifestStatus=status;},activateFails:()=>{activateFails=true;},gate:()=>{let open;activateGate=new Promise(resolve=>{open=resolve;});return open;},pulse:()=>{for(const timer of timers.filter(t=>!t.stopped))timer.callback();}};
}
{ // a current page: checked once on start with HEAD requests, never reloaded
 const f=fixture(),states=[];const stop=f.controller.subscribe(state=>states.push(state.freshness));await settle();
 equal(f.fetches.map(x=>x.method),['HEAD','HEAD'],'Each running script is asked with HEAD (no body downloaded)');
 equal(f.fetches.map(x=>x.url),[P,Q],'In page order');
 equal(f.controller.snapshot().freshness,'current');truth(f.controller.snapshot().checkedAt>0);
 equal(f.timers.map(t=>t.ms),[FRESHNESS_INTERVAL_MS],'Ten-minute timer, like the page refresh');equal(FRESHNESS_INTERVAL_MS,600000);
 equal(f.reloads,0,'Nothing reloads by itself');stop();truth(f.timers.every(t=>t.stopped),'Unsubscribing stops the timer');
}
{ // a release is deployed while the page is open
 const f=fixture(),states=[];f.controller.subscribe(state=>states.push(state.freshness));await settle();
 equal(f.controller.snapshot().freshness,'current');
 f.stale(P);f.tick(FRESHNESS_INTERVAL_MS);f.pulse();await settle();
 equal(f.controller.snapshot().freshness,'stale','The next periodic check sees the vanished script');
 equal(f.reloads,0,'Even stale, the page is never reloaded on its own (an open form keeps its data)');equal(f.activations,0,'and no worker is told to take over');
 f.fail(P);f.fail(Q);f.pulse();await settle();equal(f.controller.snapshot().freshness,'stale','A later failed answer never hides a known newer release');
 f.unfail(P);f.unfail(Q);f.pulse();await settle();equal(f.controller.snapshot().freshness,'stale','Neither does a later answer: only reloading clears it');
}
{ // failures and a release being switched never raise the notice
 const f=fixture({status:503});f.controller.subscribe(()=>{});await settle();equal(f.controller.snapshot().freshness,'unknown','A 503 while the release is switched: no notice');
 const g=fixture();g.fail(P);g.controller.subscribe(()=>{});await settle();equal(g.controller.snapshot().freshness,'unknown','Network failure: no notice');
 g.unfail(P);g.tick(1);g.pulse();await settle();equal(g.controller.snapshot().freshness,'current','and a later good answer settles it');
}
{ // offline, hidden, resumed
 const f=fixture({online:false});f.controller.subscribe(()=>{});await settle();equal(f.fetches.length,0,'Offline: no request at all');equal(f.controller.snapshot().freshness,'unknown');
 f.setOnline(true);f.setVisible(false);f.tick(FRESHNESS_INTERVAL_MS);f.pulse();await settle();equal(f.fetches.length,0,'A hidden page does not poll');
 f.setVisible(true);f.tick(10000);f.resume();await settle();equal(f.fetches.length,2,'Never checked yet (it started offline): coming back checks at once');
}
{ // the resume gap
 const f=fixture();f.controller.subscribe(()=>{});await settle();const first=f.fetches.length;
 f.tick(FRESHNESS_RESUME_GAP_MS-1);f.resume();await settle();equal(f.fetches.length,first,'Back within a minute: no new check');
 f.tick(2);f.resume();await settle();truth(f.fetches.length>first,'Back after a minute away: checked again');equal(FRESHNESS_RESUME_GAP_MS,60000);
}
{ // concurrent checks share one round; the head limit
 const f=fixture();const a=f.controller.check(true),b=f.controller.check(true);await Promise.all([a,b]);equal(f.fetches.length,2,'Two simultaneous checks make one round of requests');
 const many=fixture({scripts:Array.from({length:12},(_,i)=>ORIGIN+`/_next/static/chunks/c${i}-X.js`)});await many.controller.check(true);equal(many.fetches.length,FRESHNESS_HEAD_LIMIT,'A page with many scripts is sampled, not hammered');
}
{ // the offline shell is judged from the server's manifest
 const f=fixture({scripts:[ORIGIN+S]});f.controller.subscribe(()=>{});await settle();
 equal(f.fetches.map(x=>[x.url,x.method]),[[SHELL_MANIFEST_URL,'GET']],'The shell script is not asked for (it would be served from the cache); the manifest is');
 equal(f.controller.snapshot().freshness,'current');
 f.setManifest({assets:[{url:'/offline-app/assets/app-NEW.js'}]});f.tick(1);f.pulse();await settle();equal(f.controller.snapshot().freshness,'stale','A newer shell is a newer release');
 const g=fixture({scripts:[ORIGIN+S]});g.setManifest(null,500);g.controller.subscribe(()=>{});await settle();equal(g.controller.snapshot().freshness,'unknown','A failing manifest: unknown');
 const h=fixture({scripts:[ORIGIN+S]});h.setManifest({assets:'nope'});h.controller.subscribe(()=>{});await settle();equal(h.controller.snapshot().freshness,'unknown','A malformed manifest: unknown');
}
{ // reload: the waiting worker is asked first, and the page reloads whatever happens
 const f=fixture();await f.controller.reload();equal(f.log,['activate','reload'],'The worker is asked to take over, then the page reloads');equal(f.reloads,1);
 const g=fixture();g.activateFails();await g.controller.reload();equal(g.log,['activate','reload'],'A worker failure never blocks the reload');
 const h=fixture();const open=h.gate();const pending=h.controller.reload();await settle();equal(h.reloads,0,'The reload waits for the worker');open();await pending;equal(h.reloads,1);
 equal(ACTIVATE_UPDATE_MESSAGE,'yourrest-activate-update','The message the worker listens for');
}

// ---- the component
function componentHarness(controller,language='ar'){
 let hooks=[],effects=[],cleanups=[],cursor=0,dirty=true,tree,mounted=true;
 const React={useState(initial){const i=cursor++;if(!(i in hooks))hooks[i]=initial;return [hooks[i],next=>{hooks[i]=typeof next==='function'?next(hooks[i]):next;dirty=true;}];},useEffect(callback){const i=cursor++;if(!(i in hooks)){hooks[i]=true;effects.push(callback);}}};
 const i18n={useLanguage:()=>({language})};
 const mod={exports:{}};new Function('require','module','exports',compile(componentSource))(name=>{if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;if(name==='lucide-react')return {Loader2:()=>null,RefreshCw:()=>null};if(name==='@/lib/i18n')return i18n;if(name==='@/lib/build-freshness')return {buildFreshness:()=>controller};if(name==='./build-notice.css')return {};throw Error(name);},mod,mod.exports);
 const Component=mod.exports.default;
 function flush(){for(let n=0;mounted&&dirty&&n<10;n++){dirty=false;cursor=0;tree=Component();for(const effect of effects.splice(0)){const cleanup=effect();if(cleanup)cleanups.push(cleanup);}}return tree;}
 function nodes(value=tree){if(Array.isArray(value))return value.flatMap(nodes);if(!value||typeof value!=='object')return [];return [value,...nodes(value.props?.children??null)];}
 function text(value=tree){if(Array.isArray(value))return value.map(text).join('');if(value===null||value===undefined||value===false)return '';if(typeof value!=='object')return String(value);return text(value.props?.children??null);}
 return {flush,text,nodes,get tree(){return tree;},language(value){language=value;dirty=true;flush();},unmount(){for(const cleanup of cleanups)cleanup();mounted=false;}};
}
function fakeController(initial){let state={freshness:initial,checkedAt:1,checking:false},listener,reloads=0;return {subscribe(l){listener=l;l(state);return()=>{listener=null;};},reload:async()=>{reloads++;},set(value){state={...state,freshness:value};listener?.(state);},get reloads(){return reloads;}};}
{
 const c=fakeController('current'),ui=componentHarness(c);ui.flush();equal(ui.tree,null,'A current page shows nothing');
 c.set('unknown');ui.flush();equal(ui.tree,null,'Unknown shows nothing');
 c.set('stale');ui.flush();
 truth(ui.text().includes('يوجد تحديث للتطبيق'),'The Arabic notice');truth(ui.text().includes('أعد التحميل'));truth(ui.text().includes('لن تُعاد الصفحة من تلقاء نفسها'),'It says nothing reloads by itself');
 equal(ui.tree.props.dir,'rtl');truth(!ui.text().includes('Reload'));
 ui.language('en');truth(ui.text().includes('An app update is available'),'The English notice');truth(!/[؀-ۿ]/.test(ui.text()),'No Arabic left in the English notice');equal(ui.tree.props.dir,'ltr');
 const button=ui.nodes().find(n=>n.type==='button');truth(button&&!button.props.disabled);equal(c.reloads,0,'Showing the notice reloads nothing');
 button.props.onClick();ui.flush();equal(c.reloads,1,'The button reloads');truth(ui.nodes().find(n=>n.type==='button').props.disabled,'and cannot be pressed twice');
 ui.unmount();
}
console.log(JSON.stringify({ok:true,checks,actual_controller:true,actual_component:true,physical_device_tested:false}));
