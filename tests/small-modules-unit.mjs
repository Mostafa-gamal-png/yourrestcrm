// The small browser-side modules, on the real files transpiled into .sites-runtime, over fakes of the browser (lib/i18n.ts,
// lib/build-freshness.ts, lib/pwa-install.ts, lib/theme.ts, lib/same-snapshot.ts, lib/dialog-escape.ts, lib/connectors.ts,
// lib/connector-context.ts, lib/connector-contract.mts). No network; fixed clocks; made-up records.
// 1. Language: the Arabic text is the key; the English dictionary (patterns with {0}, spaces, the " • " list, special characters),
//    the language switch and its storage, the lazy download.
// 2. Release freshness: which scripts count, the verdict from what the server answers, the controller (timer, resume gap, sticky "stale").
// 3. The install prompt's worker, the theme, the snapshot comparison, the Escape rule of a dialog.
// 4. The connectors: the binding stays on its own request, the context is validated, a failed call is never replayed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToString} from 'react-dom/server';
import {createLoader,makeChecks} from '../scripts/lib/load-ts.mjs';

const {eq,ok,throws,rejects,report}=makeChecks(assert);
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
const store=(preset={})=>{const m=new Map(Object.entries(preset));return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>{m.set(k,String(v));},map:m};};
const fakeDocument=()=>({documentElement:{lang:'ar',dir:'rtl'},title:'',scripts:[]});

// ===== 1. language
{
 delete globalThis.window;
 globalThis.document=fakeDocument();globalThis.localStorage=store();
 // server side: no window at all
 const L0=await createLoader('small-i18n-ssr').load('lib/i18n.ts');
 eq(L0.setLanguage('en'),undefined,'setLanguage does nothing without a window');
 eq([L0.getLanguage(),L0.direction()],['ar','rtl'],'Arabic, right to left, by default');
 const Probe=()=>React.createElement('span',null,L0.useLanguage().language);
 ok(renderToString(React.createElement(Probe)).includes('>ar<'),'the server draws Arabic');
}
globalThis.window=new EventTarget();
{
 globalThis.document=fakeDocument();const ls=store();globalThis.localStorage=ls;
 const L=await createLoader('small-i18n').load('lib/i18n.ts');
 eq(L.translateText('أهلا','en'),'أهلا','nothing translated before the dictionary is installed');
 L.installEnglish({'أهلا':'Hello','لديك {0} زيارة':'You have {0} visits','من {1} إلى {0}':'to {0} from {1}','سعر (ريال) {0}':'Price (SAR) {0}','مرحبا':'Welcome','شكرا':'Thanks','الرقم {0} من {1}':'{0} of {1}'});
 eq(L.translateText('أهلا','en'),'Hello','a key');eq(L.translateText('أهلا','ar'),'أهلا','Arabic is never translated');
 eq(L.translateText('  أهلا  ','en'),'  Hello  ','the spaces around it are kept');eq(L.translateText('\n أهلا\t','en'),'\n Hello\t','and other whitespace around it');
 eq(L.translateText('لديك    3   زيارة','en'),'You have 3 visits','runs of spaces collapse before the lookup');
 eq(L.translateText('لديك 12 زيارة','en'),'You have 12 visits','a pattern');eq(L.translateText('لديك ١٢ زيارة','en'),'You have ١٢ visits','Arabic digits are carried through, not converted');
 eq(L.translateText('من أ إلى ب','en'),'to ب from أ','placeholders may be used in another order');eq(L.translateText('سعر (ريال) 50','en'),'Price (SAR) 50','special characters of a key are literal');eq(L.translateText('سعر ريال 50','en'),'سعر ريال 50','the parentheses are not optional');
 eq(L.translateText('الرقم 3 من 10','en'),'3 of 10','two placeholders');
 eq(L.translateText('مرحبا • شكرا','en'),'Welcome • Thanks','a list joined by a bullet');eq(L.translateText('مرحبا • غير معروف','en'),'Welcome • غير معروف','a part with no English stays');
 eq(L.translateText('غير معروف','en'),'غير معروف','an unknown text stays');eq(L.translateText('hello world','en'),'hello world','text without Arabic is returned as it is');eq(L.translateText('','en'),'','empty');eq(L.translateText('12345','en'),'12345','digits only');
 eq(L.translateText('لديك  زيارة','en'),'لديك  زيارة','a pattern needs something in its place');
 eq(L.translateText('‏أهلا‏','en'),'‏أهلا‏','hidden direction marks make a different text: not translated');
 eq(L.translateText('أهلا'.repeat(5000),'en'),'أهلا'.repeat(5000),'a very long text');
 eq(L.t('أهلا'),'أهلا','t() in Arabic');eq([L.t(5),L.t(null),L.t(undefined)],[5,null,undefined],'t() leaves non-text alone');const obj={a:1};eq(L.t(obj)===obj,true,'and objects');
 L.setLanguage('en');
 eq([L.getLanguage(),document.documentElement.lang,document.documentElement.dir,L.direction(),ls.map.get('yr-language')],['en','en','ltr','ltr','en'],'English: language, page direction, saved');
 ok(document.title.startsWith('Yourrest Industries'),'the title is English');eq(L.t('أهلا'),'Hello','t() follows the language');
 L.setLanguage('ar');eq([document.documentElement.lang,document.documentElement.dir,ls.map.get('yr-language'),document.title.startsWith('يورست')],['ar','rtl','ar',true],'and back to Arabic');
 globalThis.localStorage={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};L.setLanguage('en');eq(L.getLanguage(),'en','blocked storage never blocks the switch');L.setLanguage('ar');
 globalThis.localStorage=ls;
}
{ // the real dictionary is downloaded on demand
 globalThis.document=fakeDocument();const ls=store();globalThis.localStorage=ls;
 const L=await createLoader('small-i18n-lazy').load('lib/i18n.ts');
 const en=JSON.parse(fs.readFileSync('lib/locales/en.json','utf8'));
 eq(L.translateText('كل الفروع','en'),'كل الفروع','not downloaded yet');
 L.setLanguage('en');eq(L.getLanguage(),'ar','English waits for its dictionary: the page stays Arabic for a moment');await settle();await L.loadEnglish();await settle();
 eq([L.getLanguage(),document.documentElement.lang],['en','en'],'then switches');eq(L.translateText('كل الفروع','en'),en['كل الفروع'],'a word of the real dictionary');
 L.setLanguage('ar');await L.loadEnglish();eq(L.getLanguage(),'ar','loadEnglish twice is harmless');
}
{ // choosing English and Arabic again before the download ends: the last choice wins
 globalThis.document=fakeDocument();globalThis.localStorage=store();
 const L=await createLoader('small-i18n-race').load('lib/i18n.ts');
 L.setLanguage('en');L.setLanguage('ar');await settle();await L.loadEnglish();await settle();eq(L.getLanguage(),'ar','the last choice wins');
}
{ // a saved English choice starts the download with the page
 globalThis.document=fakeDocument();globalThis.localStorage=store({'yr-language':'en'});
 const L=await createLoader('small-i18n-saved').load('lib/i18n.ts');await settle();await L.loadEnglish();eq(L.translateText('كل الفروع','en')!=='كل الفروع',true,'the dictionary was fetched at load');
}

// ===== 2. release freshness
delete globalThis.window;
{
 const F=await createLoader('small-fresh').load('lib/build-freshness.ts');
 const ORIGIN='https://crm.example.test';
 const doc=(...srcs)=>({scripts:srcs.map(src=>({src}))});
 eq(F.runningScripts(null,ORIGIN),[],'no document');eq(F.runningScripts(doc(),ORIGIN),[],'no scripts');
 eq(F.runningScripts(doc('/_next/static/chunks/a.js','/offline-app/assets/b.js','/other/c.js','','https://cdn.example/_next/static/x.js','/_next/static/chunks/a.js','/_next/static/chunks/d.js?v=1','http://[bad'),ORIGIN),['/_next/static/chunks/a.js','/offline-app/assets/b.js'],'same-origin hashed scripts only, once each, none with a query, bad ones skipped');
 eq(F.runningScripts(doc(ORIGIN+'/_next/static/chunks/a.js'),ORIGIN),['/_next/static/chunks/a.js'],'an absolute same-origin address');
 eq([F.isShellScript('/offline-app/assets/x.js'),F.isShellScript('/_next/static/x.js')],[true,false],'which are the shell\'s');
 const r=(path,status)=>({path,status});const S='/_next/static/a.js',H='/offline-app/assets/h.js';
 eq(F.judge([r(S,200)],null),'current','served script found');eq(F.judge([r(S,304)],null),'current','not modified');eq(F.judge([r(S,404)],null),'stale','gone: a newer release');eq(F.judge([r(S,410)],null),'stale','gone for good');
 for(const status of [500,503,null,301,199,300])eq(F.judge([r(S,status)],null),'unknown','a server that cannot answer proves nothing: '+status);
 eq(F.judge([r(S,200),r(S,500)],null),'unknown','one unknown makes the verdict unknown');eq(F.judge([r(S,500),r(S,404)],null),'stale','a stale script wins over an unknown one');eq(F.judge([],null),'unknown','nothing asked');
 eq(F.judge([r(H,null)],{assets:[{url:H}]}),'current','a shell script in the manifest');eq(F.judge([r(H,null)],{assets:[{url:'/offline-app/assets/other.js'}]}),'stale','a shell script missing from the manifest');eq(F.judge([r(H,null)],'error'),'unknown','a manifest that could not be read');eq(F.judge([r(H,null)],null),'unknown','no manifest');
 eq(F.FRESHNESS_INTERVAL_MS,600000,'ten minutes');eq(F.FRESHNESS_RESUME_GAP_MS,60000,'a minute away');eq(F.RELEASE_CHECK_QUERY,'?release-check','the release-check address');
 function fx({scripts=[S],online=true,visible=true,statuses={},manifest,manifestStatus=200,manifestThrows=false,fetchThrows=false}={}){
  const f={clock:5_000_000,online,visible,statuses,fetched:[],handlers:[],timers:[],reloads:0,activated:0,activateThrows:false,stops:0};
  const env={document:()=>doc(...scripts),origin:()=>ORIGIN,online:()=>f.online,visible:()=>f.visible,now:()=>f.clock,
   fetch:async(url,init)=>{f.fetched.push([url,init.method]);if(fetchThrows)throw Error('net');if(url===F.SHELL_MANIFEST_URL){if(manifestThrows)throw Error('m');return {status:manifestStatus,json:async()=>manifest};}return {status:f.statuses[url]??200,json:async()=>({})};},
   listen:(e,h)=>{f.handlers.push(h);return()=>{f.stops++;};},every:(cb,ms)=>{f.timers.push({cb,ms});return()=>{f.stops++;};},
   activateWaitingWorker:async()=>{f.activated++;if(f.activateThrows)throw Error('x');},reload:()=>{f.reloads++;}};
  f.c=F.createBuildFreshness(env);return f;
 }
 {const f=fx();const seen=[];const stop=f.c.subscribe(s=>seen.push(s.freshness));await settle();eq([f.c.snapshot().freshness,f.c.snapshot().checking,f.c.snapshot().checkedAt,f.fetched,f.timers[0].ms],['current',false,5_000_000,[[S,'HEAD']],600000],'subscribing checks at once: HEAD of the script, a ten-minute timer');ok(seen[0]==='unknown'&&seen.includes('current'),'the first state is told, then the verdict');
  f.clock+=59_999;f.handlers[0]();await settle();eq(f.fetched.length,1,'returning after less than a minute: no check');f.clock+=1;f.handlers[0]();await settle();eq(f.fetched.length,2,'a minute away: checks');f.timers[0].cb();await settle();eq(f.fetched.length,3,'the timer checks');stop();eq(f.stops,2,'unsubscribed: timer and listener stopped');}
 {const f=fx({statuses:{[S]:404}});f.c.subscribe(()=>{});await settle();eq(f.c.snapshot().freshness,'stale','a vanished script: a newer release');f.statuses[S]=200;await f.c.check(true);eq(f.c.snapshot().freshness,'stale','a newer release stays known');f.statuses[S]=500;await f.c.check(true);eq(f.c.snapshot().freshness,'stale','and a failed answer never hides it');}
 {const f=fx();f.c.subscribe(()=>{});await settle();f.statuses[S]=500;await f.c.check(true);eq(f.c.snapshot().freshness,'current','a failed answer never clears "current" either');}
 {const f=fx({fetchThrows:true});f.c.subscribe(()=>{});await settle();eq([f.c.snapshot().freshness,f.c.snapshot().checking],['unknown',false],'a network error is "unknown", not "stale"');}
 {const f=fx({online:false});eq(await f.c.check(true),'unknown','offline: nothing asked');eq(f.fetched.length,0,'no request');}
 {const f=fx({scripts:[]});eq(await f.c.check(true),'unknown','no hashed script: nothing to check');}
 {const f=fx({visible:false});const v=await f.c.check();eq([v,f.fetched.length],['unknown',0],'a hidden page does not check on its own');await f.c.check(true);eq(f.fetched.length,1,'but a forced check does');}
 {const f=fx();const [a,b]=[f.c.check(true),f.c.check(true)];eq(a===b,true,'a check in flight is shared');await a;eq(f.fetched.length,1,'one request');}
 {const f=fx({scripts:Array.from({length:9},(_, i)=>'/_next/static/s'+i+'.js')});await f.c.check(true);eq(f.fetched.length,6,'at most six scripts are asked');}
 {const f=fx({scripts:[H],manifest:{assets:[{url:H},{url:5},null,{}]}});await f.c.check(true);eq([f.c.snapshot().freshness,f.fetched],['current',[[F.SHELL_MANIFEST_URL,'GET']]],'the shell: manifest read, its script found');}
 {const f=fx({scripts:[H],manifest:{assets:[{url:'/offline-app/assets/new.js'}]}});await f.c.check(true);eq(f.c.snapshot().freshness,'stale','the shell: its script is not in the manifest any more');}
 for(const [label,opts] of [['a bad status',{manifestStatus:500}],['a throw',{manifestThrows:true}],['no assets list',{manifest:{}}],['not an object',{manifest:null}]]){const f=fx({scripts:[H],...opts});await f.c.check(true);eq(f.c.snapshot().freshness,'unknown','the manifest could not be read: '+label);}
 {const f=fx();await f.c.reload();eq([f.activated,f.reloads],[1,1],'reload gives a waiting worker its turn, then reloads');f.activateThrows=true;await f.c.reload();eq([f.activated,f.reloads],[2,2],'a worker that fails never blocks the reload');}
}

// ===== 3. install worker, theme, snapshot, dialog
{
 const make=async()=>createLoader('small-pwa').load('lib/pwa-install.ts');
 delete globalThis.window;let P=await make();eq(P.installController(),undefined,'no controller on the server');P.registerInstallWorker();ok(true,'registering on the server does nothing');
 const reg=[];const nav={serviceWorker:{register:(url,opts)=>{reg.push([url,opts]);return Promise.resolve({});}}};
 Object.defineProperty(globalThis,'navigator',{value:nav,configurable:true,writable:true});
 globalThis.window={isSecureContext:true,__yourrestInstall:{snapshot:()=>1}};
 eq(P.installController().snapshot(),1,'the layout\'s controller');
 P.registerInstallWorker();P.registerInstallWorker();eq(reg,[['/sw.js',{scope:'/',updateViaCache:'none'}]],'registered once, at the root, never from cache');
 P=await make();globalThis.window={isSecureContext:false};P.registerInstallWorker();eq(reg.length,1,'not on an insecure page');
 P=await make();globalThis.window={isSecureContext:true};Object.defineProperty(globalThis,'navigator',{value:{},configurable:true,writable:true});P.registerInstallWorker();eq(reg.length,1,'not without service workers');
 P=await make();let attempts=0;Object.defineProperty(globalThis,'navigator',{value:{serviceWorker:{register:()=>{attempts++;return Promise.reject(new Error('fail'));}}},configurable:true,writable:true});P.registerInstallWorker();await settle();P.registerInstallWorker();eq(attempts,2,'a failed registration may be tried again');
 P=await make();attempts=0;Object.defineProperty(globalThis,'navigator',{value:{serviceWorker:{register:()=>{attempts++;throw new Error('sync');}}},configurable:true,writable:true});P.registerInstallWorker();P.registerInstallWorker();eq(attempts,2,'a registration that throws at once may be tried again');
 delete globalThis.window;
}
{
 const T=await createLoader('small-theme').load('lib/theme.ts');
 const ls=store();globalThis.localStorage=ls;
 const classes=new Set(),meta={c:null,setAttribute(k,v){this.c=[k,v];}};
 globalThis.document={documentElement:{classList:{toggle:(n,on)=>{on?classes.add(n):classes.delete(n);},contains:n=>classes.has(n)},style:{}},querySelector:s=>s==='meta[name="theme-color"]'?meta:null};
 eq(T.readTheme(),'light','light by default');ls.map.set('yr-theme','dark');eq(T.readTheme(),'dark','a saved dark');ls.map.set('yr-theme','blue');eq(T.readTheme(),'light','anything else is light');
 T.applyTheme('dark');eq([classes.has('dark'),document.documentElement.style.colorScheme,meta.c],[true,'dark',['content','#101b18']],'dark: class, colour scheme, browser bar colour');T.applyTheme('light');eq([classes.has('dark'),document.documentElement.style.colorScheme,meta.c[1]],[false,'light','#166344'],'light');
 T.saveTheme('dark');eq([ls.map.get('yr-theme'),classes.has('dark')],['dark',true],'saved and applied');
 globalThis.localStorage={getItem(){throw new Error('b');},setItem(){throw new Error('b');}};classes.add('dark');eq(T.readTheme(),'dark','blocked storage: the page\'s own class decides (dark)');classes.delete('dark');eq(T.readTheme(),'light','blocked storage: light');T.saveTheme('dark');eq(classes.has('dark'),true,'blocked storage still applies the choice');
 const saved=document.querySelector;globalThis.document.querySelector=()=>null;T.applyTheme('dark');ok(true,'a page without the theme-colour meta');
}
{
 const SS=await createLoader('small-snap').load('lib/same-snapshot.ts');
 const rec=(id,over={})=>({id,kind:'customer',parentId:null,assignedTo:'m1',version:1,updatedAt:'2026-11-22T06:00:00Z',data:{name:'ن'},...over});
 const snap=(records,extra={})=>({records,members:[{id:'m1'}],...extra});
 const a=snap([rec('1'),rec('2')]);ok(SS.sameSnapshot(a,a),'the same object');ok(SS.sameSnapshot(a,snap([rec('1'),rec('2')])),'equal copies');
 for(const [label,b] of [['another version',snap([rec('1',{version:2}),rec('2')])],['another update time',snap([rec('1',{updatedAt:'x'}),rec('2')])],['another kind',snap([rec('1',{kind:'visit'}),rec('2')])],['another parent',snap([rec('1',{parentId:'p'}),rec('2')])],['another assignee',snap([rec('1',{assignedTo:'m2'}),rec('2')])],['another id',snap([rec('9'),rec('2')])],['a field the server added, same version',snap([rec('1',{data:{name:'ن',intake:true}}),rec('2')])],['one record fewer',snap([rec('1')])],['another record order',snap([rec('2'),rec('1')])],['other members',snap([rec('1'),rec('2')],{members:[{id:'m2'}]})],['an extra key',snap([rec('1'),rec('2')],{extra:1})],['records not a list',{records:null,members:[{id:'m1'}]}]])ok(!SS.sameSnapshot(a,b),'different: '+label);
 ok(!SS.sameSnapshot({records:[],x:1},{records:[],y:1}),'different keys, same count');ok(SS.sameSnapshot({records:[],a:{n:1}},{records:[],a:{n:1}}),'other parts compared as JSON');ok(!SS.sameSnapshot({records:null},{records:null}.records?{records:null}:{records:[]}),'a missing list is not the same as an empty one');
 const shared=rec('1');ok(SS.sameSnapshot(snap([shared]),snap([shared])),'the same record object is skipped');
}
{
 const E=await createLoader('small-escape').load('lib/dialog-escape.ts');
 const target=expanded=>({target:{closest:sel=>sel==='[role="combobox"][aria-expanded="true"]'&&expanded?{}:null}});
 eq([E.escapeBelongsToOpenPopup(target(true)),E.escapeBelongsToOpenPopup(target(false))],[true,false],'Escape belongs to an open list, not to a closed one');
 for(const t of [null,undefined,{},{closest:5},'x'])eq(E.escapeBelongsToOpenPopup({target:t}),false,'a target that cannot say: '+JSON.stringify(t));
}

// ===== 4. the connectors
{
 delete globalThis.window;
 const cl=createLoader('small-connectors');const X=await cl.load('lib/connector-context.ts'),K=await cl.load('lib/connectors.ts');
 eq(X.getConnectorBinding(),undefined,'no binding outside a request');
 const binding={id:1};
 eq(X.runWithConnectorBinding(binding,()=>X.getConnectorBinding())===binding,true,'the binding of this request');
 eq(await X.runWithConnectorBinding(binding,async()=>{await settle();return X.getConnectorBinding();})===binding,true,'it follows the async chain');
 const [one,two]=await Promise.all([X.runWithConnectorBinding({n:1},async()=>{await settle();return X.getConnectorBinding().n;}),X.runWithConnectorBinding({n:2},async()=>{await settle();return X.getConnectorBinding().n;})]);eq([one,two],[1,2],'two requests never share a binding');
 eq(X.getConnectorBinding(),undefined,'nothing leaks after the request');eq(X.runWithConnectorBinding(undefined,()=>X.getConnectorBinding()),undefined,'a request with no binding');
 eq(X.runWithConnectorBinding(binding,()=>7),7,'the result is returned');
 const C=K.connectorsForRequest;
 {const c=C();eq(await c.getContext(),{status:'binding_unavailable'},'no binding: unavailable');const r=await c.invoke('x','y',{});eq([r.status,/does not provide/.test(r.message)],['binding_unavailable',true],'invoke without a binding');}
 const mk=(ctx,invoke)=>({getContext:async()=>{if(ctx instanceof Error)throw ctx;return ctx;},invoke:invoke||(async()=>({status:'success',result:{content:[]}}))});
 const run=(b,fn)=>X.runWithConnectorBinding(b,()=>fn(C()));
 eq(await run({invoke:async()=>({})},c=>c.getContext()),{status:'binding_unavailable'},'a binding with no context reader');
 {const ctx={status:'success',connectors:[{connectorId:'g',policy:'enabled',tools:[{actionName:'a',description:'d',inputSchema:{type:'object'},extra:'dropped'},{actionName:'b',inputSchema:{}}],secret:'dropped'},{connectorId:'h',policy:'disabled',tools:null}]};
  const out=await run(mk(ctx),c=>c.getContext());eq(out,{status:'success',connectors:[{connectorId:'g',policy:'enabled',tools:[{actionName:'a',description:'d',inputSchema:{type:'object'}},{actionName:'b',inputSchema:{}}]},{connectorId:'h',policy:'disabled',tools:null}]},'a valid context is rebuilt with only the known fields');}
 for(const [label,ctx] of [['a non-text connector id',{status:'success',connectors:[{connectorId:5,policy:'enabled',tools:null}]}],['an unknown policy',{status:'success',connectors:[{connectorId:'g',policy:'maybe',tools:null}]}],['tools not a list',{status:'success',connectors:[{connectorId:'g',policy:'enabled',tools:'x'}]}],['tools missing',{status:'success',connectors:[{connectorId:'g',policy:'enabled'}]}],['a null connector',{status:'success',connectors:[null]}],['a tool without a name',{status:'success',connectors:[{connectorId:'g',policy:'enabled',tools:[{inputSchema:{}}]}]}],['a tool with a bad description',{status:'success',connectors:[{connectorId:'g',policy:'enabled',tools:[{actionName:'a',description:5,inputSchema:{}}]}]}],['a tool with no schema',{status:'success',connectors:[{connectorId:'g',policy:'enabled',tools:[{actionName:'a'}]}]}],['a tool with an array schema',{status:'success',connectors:[{connectorId:'g',policy:'enabled',tools:[{actionName:'a',inputSchema:[]}]}]}],['a null tool',{status:'success',connectors:[{connectorId:'g',policy:'enabled',tools:[null]}]}]])eq(await run(mk(ctx),c=>c.getContext()),{status:'upstream_error'},'refused context: '+label);
 for(const status of ['request_context_expired','internal_error','binding_unavailable','upstream_error'])eq(await run(mk({status}),c=>c.getContext()),{status},'the host\'s status is passed on: '+status);
 for(const odd of [{status:'weird'},null,undefined,{status:'success'},{status:'success',connectors:'x'}])eq(await run(mk(odd),c=>c.getContext()),{status:'upstream_error'},'an unknown answer is an upstream error: '+JSON.stringify(odd));
 eq(await run(mk(new Error('boom')),c=>c.getContext()),{status:'upstream_error'},'a context that throws');
 {const calls=[];const b=mk({status:'success',connectors:[]},async(...args)=>{calls.push(args);return {status:'rate_limited',message:'slow',retryAfterMs:5};});const r=await run(b,c=>c.invoke('g','a',{x:1}));eq([r,calls],[{status:'rate_limited',message:'slow',retryAfterMs:5},[['g','a',{x:1}]]],'the host\'s answer is returned unchanged');}
 {let n=0;const b=mk({status:'success',connectors:[]},async()=>{n++;throw new Error('transport');});const r=await run(b,c=>c.invoke('g','a',{}));eq([r.status,/may have completed/.test(r.message),n],['upstream_error',true,1],'a transport failure is never replayed');}
 globalThis.window={};
 await rejects(run(mk({status:'success',connectors:[]}),c=>c.getContext()),/only available in Site server routes/,'the browser cannot read the context');
 await rejects(run(mk({status:'success',connectors:[]}),c=>c.invoke('g','a',{})),/only available in Site server routes/,'the browser cannot invoke');
 delete globalThis.window;
}
report();
