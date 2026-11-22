// What the phone's own services give the screens, on the real modules transpiled into .sites-runtime, over fakes of the browser and the
// Android bridge that keep the contract the modules rely on (lib/native-speech.ts, lib/image-shrink.ts, lib/visit-location.ts,
// lib/journey-client.ts). Timers are replaced by a registry that the test fires by hand, so nothing waits and the clock is never real.
// 1. Dictation: the text is cleaned and bounded; the engine of the browser and the bridge of the app; every error code; cancelling,
//    a changed session, a timeout, a second session replacing the first; the messages in both languages.
// 2. Photos: the size and the quality steps, the 400 KB target, the byte limit, a file that cannot be read, a transparent picture.
// 3. A visit's place: coordinates validated, every refusal worded, a callback that never comes, an abort.
// 4. The journey buffer: the day in Riyadh, the samples a phone may send, the buffer limits.
import assert from 'node:assert/strict';
import {createLoader,makeChecks} from '../scripts/lib/load-ts.mjs';

const {load}=createLoader('device-io-unit');
const {eq,ok,rejects,report}=makeChecks(assert);
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
// ---- fake timers
const real={setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
const timers=new Map();let nextTimer=1;
globalThis.setTimeout=(callback,delay)=>{const id=nextTimer++;timers.set(id,{callback,delay,repeat:false});return id;};
globalThis.setInterval=(callback,delay)=>{const id=nextTimer++;timers.set(id,{callback,delay,repeat:true});return id;};
globalThis.clearTimeout=globalThis.clearInterval=id=>{timers.delete(id);};
const fire=delay=>{for(const [id,timer] of [...timers])if(timer.delay===delay){if(!timer.repeat)timers.delete(id);timer.callback();}};
const timerCount=()=>timers.size;
const setUA=ua=>Object.defineProperty(globalThis,'navigator',{value:{userAgent:ua},configurable:true,writable:true});
const NATIVE='Mozilla/5.0 (Linux; Android 14) YourrestCRM-Android/1';

const S=await load('lib/native-speech.ts'),I=await load('lib/image-shrink.ts'),V=await load('lib/visit-location.ts'),J=await load('lib/journey-client.ts');

// ===== 1. dictation
for(const [input,expected] of [['مرحبا','مرحبا'],['  مرحبا  ','مرحبا'],['a\u0000b\u0007c\u001fd','abcd'],['a\u007fb','ab'],['سطر\nثاني\tوتاب','سطر\nثاني\tوتاب'],['x'.repeat(5000),'x'.repeat(5000)],['‏نص‏','‏نص‏']])eq(S.cleanSpeechText(input),expected,'cleaned '+JSON.stringify(input).slice(0,30));
for(const bad of ['',' ','\n\t',null,undefined,5,{},[],true])assert.throws(()=>S.cleanSpeechText(bad),/speech_no_match/),eq(1,1,'no match for '+JSON.stringify(bad));
assert.throws(()=>S.cleanSpeechText('x'.repeat(5001)),/speech_too_long/);eq(1,1,'5001 characters is too long');
// a text whose only content is control characters is empty after cleaning: startSpeech turns that into no match (below)
const codes=['speech_permission','speech_upgrade','speech_unsupported','speech_no_match','speech_network','speech_language','speech_timeout','speech_too_long','speech_session_changed','speech_busy','speech_foreground'];
for(const code of codes){const ar=S.speechErrorMessage(code,'ar'),en=S.speechErrorMessage(code,'en');ok(/[؀-ۿ]/.test(ar)&&!/[؀-ۿ]/.test(en),'both languages: '+code);}
ok(S.speechErrorMessage('speech_weird','en').startsWith('Could not start dictation'),'an unknown code gets the generic English');ok(S.speechErrorMessage('','ar').startsWith('تعذر بدء الإملاء'),'an empty code gets the generic Arabic');eq(S.speechErrorMessage('speech_busy','fr'),S.speechErrorMessage('speech_busy','ar'),'any other language is Arabic');

function harness({native=false,engine=true,protocol=1,supported=true,ctor}={}){
 const h={engines:[],calls:[],texts:[],errors:[],ends:0,resolvers:[]};
 const win=new EventTarget();globalThis.window=win;setUA(native?NATIVE:'Mozilla/5.0 Chrome');
 class Engine{constructor(){if(ctor)ctor();this.aborted=0;this.started=0;h.engines.push(this);}start(){this.started++;if(h.startThrows)throw h.startThrows;}abort(){this.aborted++;if(h.abortThrows)throw new Error('abort failed');}}
 if(engine)win.SpeechRecognition=Engine;
 if(native){win.__yourrestNative={speechProtocol:protocol,speechSupported:supported,request:(method,payload)=>{h.calls.push({method,payload});if(method==='speechCancel')return Promise.resolve({});return new Promise((resolve,reject)=>{h.resolvers.push({resolve,reject,payload});});}};}
 h.win=win;h.start=(language='ar-SA')=>S.startSpeech({language,onText:t=>h.texts.push(t),onError:c=>h.errors.push(c),onEnd:()=>h.ends++});
 h.result=(items,resultIndex=0)=>h.engines.at(-1).onresult({resultIndex,results:items});
 return h;
}
const fin=text=>Object.assign([{transcript:text}],{isFinal:true});
const interim=text=>Object.assign([{transcript:text}],{isFinal:false});
// availability
{const h=harness({engine:false});eq(await S.speechAvailability(),'unavailable','no engine in a browser');}
{const h=harness();eq(await S.speechAvailability(),'browser','the browser engine');}
{const h=harness({engine:false});delete h.win.SpeechRecognition;h.win.webkitSpeechRecognition=class{};eq(await S.speechAvailability(),'browser','the webkit engine');}
{const h=harness({native:true});eq(await S.speechAvailability(),'native','the app\'s recogniser');}
{const h=harness({native:true,supported:false});eq(await S.speechAvailability(),'browser','the app cannot, the browser engine can');}
{const h=harness({native:true,supported:false,engine:false});eq(await S.speechAvailability(),'unavailable','a current app that cannot dictate');}
{const h=harness({native:true,protocol:0,engine:false});eq(await S.speechAvailability(),'upgrade','an old app asks for an update');}
{const h=harness({native:true,protocol:null,engine:true});eq(await S.speechAvailability(),'browser','an old app with a browser engine');}
{const h=harness({native:true,engine:false});delete h.win.__yourrestNative;const p=S.speechAvailability();await settle();fire(12000);eq(await p,'upgrade','the bridge never came: update');const h2=harness({native:true});delete h2.win.__yourrestNative;const p2=S.speechAvailability();await settle();fire(12000);eq(await p2,'browser','the bridge never came but the browser can');}
// the browser engine
{const h=harness();const task=h.start();await settle();const e=h.engines[0];eq([e.lang,e.interimResults,e.continuous,e.maxAlternatives,e.started],['ar-SA',false,false,1,1],'engine configured and started');
 h.result([fin('أهلا'),fin('بكم')]);eq([h.texts,h.errors,h.ends,e.aborted],[['أهلا بكم'],[],1,1],'results joined, session ended, engine closed');eq(timerCount(),0,'no timer left');task.cancel();eq(h.ends,1,'cancel after the end does nothing');}
{const h=harness();h.start('en-US');await settle();eq(h.engines[0].lang,'en-US','English');h.result([interim('x'),fin(7),fin('real')],0);eq(h.texts,['real'],'interim and non-text results are skipped');}
{const h=harness();h.start();await settle();h.result([fin('a'),fin('b')],1);eq(h.texts,['b'],'resultIndex is honoured');}
{const h=harness();h.start();await settle();h.result(Array.from({length:30},(_, i)=>fin('w'+i)));eq(h.texts[0].split(' ').length,20,'at most twenty results');}
{const h=harness();h.start();await settle();h.result([interim('x')]);eq([h.texts,h.ends],[[],0],'only interim results: still listening');}
{const h=harness();h.start();await settle();h.result([fin('  ')]);eq([h.texts,h.errors],[[],['speech_no_match']],'blank speech is no match');}
{const h=harness();h.start();await settle();h.result([fin('\u0007\u0000')]);eq(h.errors,['speech_no_match'],'only control characters is no match');}
{const h=harness();h.start();await settle();h.result([fin('x'.repeat(5001))]);eq(h.errors,['speech_too_long'],'too long');}
{const h=harness();h.start();await settle();h.engines[0].onresult({resultIndex:0,results:null});eq(h.errors,['speech_invalid'],'a broken result is invalid');}
for(const [code,expected] of [['not-allowed','speech_permission'],['service-not-allowed','speech_permission'],['network','speech_network'],['no-speech','speech_no_match'],['language-not-supported','speech_language'],['audio-capture','speech_failed'],[undefined,'speech_failed']]){const h=harness();h.start();await settle();h.engines[0].onerror({error:code});eq([h.errors,h.ends],[[expected],1],'engine error '+code);}
{const h=harness();h.start();await settle();h.engines[0].onerror({error:'aborted'});eq([h.errors,h.ends],[[],1],'aborted ends quietly');}
{const h=harness();h.start();await settle();h.engines[0].onend();eq([h.errors,h.ends,h.texts],[[],1,[]],'the engine ending with no result');}
{const h=harness();h.start();await settle();fire(80000);eq([h.errors,h.ends,h.engines[0].aborted],[['speech_timeout'],1,1],'80 seconds is a timeout');}
{const h=harness();const task=h.start();await settle();task.cancel();eq([h.errors,h.ends,h.engines[0].aborted],[[],1,1],'cancel ends quietly and closes the engine');task.cancel();eq(h.ends,1,'cancelling twice');h.result?.length;}
{const h=harness();h.start();await settle();h.win.__yourrestNativeGeneration=1;fire(250);eq([h.errors,h.ends],[[],1],'a changed session cancels at the next check');}
{const h=harness();h.start();await settle();h.win.__yourrestNativeScope='another';fire(250);eq(h.ends,1,'a changed scope cancels');}
{const h=harness();h.start();await settle();h.win.dispatchEvent(new Event('pagehide'));eq(h.ends,1,'leaving the page cancels');eq(timerCount(),0,'timers cleared');}
{const h=harness();h.start();await settle();h.win.dispatchEvent(new Event('popstate'));eq(h.ends,1,'going back cancels');}
{const h=harness();const first=h.start();await settle();h.start();await settle();eq([h.ends,h.engines[0].aborted],[1,1],'a second session replaces the first');eq(h.engines.length,2,'and starts its own engine');h.win.dispatchEvent(new Event('pagehide'));}
{const h=harness({ctor(){throw Object.assign(new Error('x'),{name:'NotAllowedError'});}});h.start();await settle();eq(h.errors,['speech_permission'],'a refused engine');}
{const h=harness({ctor(){throw new Error('boom');}});h.start();await settle();eq(h.errors,['speech_failed'],'an engine that cannot be made');}
{const h=harness();h.startThrows=new Error('start failed');h.start();await settle();eq(h.errors,['speech_failed'],'an engine that cannot start');}
{const h=harness({engine:false});h.start();await settle();eq([h.errors,h.ends],[['speech_unsupported'],1],'no engine at all');}
{const h=harness();h.start();await settle();h.engines[0].onresult({resultIndex:0,results:[fin('a')]});const texts=[...h.texts];h.engines[0].onresult?.({resultIndex:0,results:[fin('b')]});eq(h.texts,texts,'a result after the end is ignored (the handlers are removed)');}
// the app's recogniser
{const h=harness({native:true});h.start();await settle();eq(h.calls.map(c=>c.method),['speechStart'],'the app is asked to listen');const r=h.resolvers[0];eq([r.payload.language,typeof r.payload.sessionId],['ar-SA','string'],'with the language and a session id');r.resolve({sessionId:r.payload.sessionId,cancelled:false,text:'نص من التطبيق'});await settle();eq([h.texts,h.errors,h.ends],[['نص من التطبيق'],[],1],'the text arrives');eq(h.calls.map(c=>c.method),['speechStart','speechCancel'],'the app is told to close the session');}
{const h=harness({native:true});h.start();await settle();const r=h.resolvers[0];r.resolve({sessionId:r.payload.sessionId,cancelled:true,text:''});await settle();eq([h.texts,h.errors,h.ends],[[],[],1],'cancelled in the app ends quietly');}
for(const [label,result] of [['null',null],['an array',[]],['text',  'x'],['another session',{sessionId:'other',cancelled:false,text:'x'}],['no cancelled flag',{sessionId:'SAME',text:'x'}]]){const h=harness({native:true});h.start();await settle();const r=h.resolvers[0];r.resolve(result&&result.sessionId==='SAME'?{...result,sessionId:r.payload.sessionId}:result);await settle();eq([h.texts,h.errors],[[],['speech_invalid']],'invalid answer: '+label);}
{const h=harness({native:true});h.start();await settle();const r=h.resolvers[0];r.resolve({sessionId:r.payload.sessionId,cancelled:false,text:'   '});await settle();eq(h.errors,['speech_no_match'],'an empty text from the app');}
{const h=harness({native:true});h.start();await settle();const r=h.resolvers[0];r.resolve({sessionId:r.payload.sessionId,cancelled:false,text:'x'.repeat(6000)});await settle();eq(h.errors,['speech_too_long'],'a very long text from the app');}
{const h=harness({native:true});h.start();await settle();h.resolvers[0].reject(new Error('speech_permission'));await settle();eq([h.errors,h.ends],[['speech_permission'],1],'the app\'s own error code is passed on');}
{const h=harness({native:true});h.start();await settle();h.resolvers[0].reject('weird');await settle();eq(h.errors,['speech_failed'],'a non-error rejection');}
{const h=harness({native:true});const task=h.start();await settle();task.cancel();const r=h.resolvers[0];r.resolve({sessionId:r.payload.sessionId,cancelled:false,text:'late'});await settle();eq([h.texts,h.ends],[[],1],'an answer after cancelling is dropped');ok(h.calls.some(c=>c.method==='speechCancel'),'and the app was told to stop');}
{const h=harness({native:true});h.start();await settle();h.win.__yourrestNativeGeneration=5;const r=h.resolvers[0];r.resolve({sessionId:r.payload.sessionId,cancelled:false,text:'x'});await settle();eq([h.texts,h.ends],[[],1],'the session changed while listening: nothing delivered');}
{const h=harness({native:true,protocol:0,engine:false});h.start();await settle();eq(h.errors,['speech_upgrade'],'an old app');}
{const h=harness({native:true,supported:false,engine:false});h.start();await settle();eq(h.errors,['speech_unsupported'],'an app that cannot dictate');}
// changes of session at the awkward moments
{const h=harness();h.abortThrows=true;h.start();await settle();h.result([fin('x')]);eq([h.texts,h.ends],[['x'],1],'an engine that fails to abort cannot break the end of a session');}
{const h=harness();h.start();await settle();h.win.__yourrestNativeGeneration=7;h.engines[0].onresult({resultIndex:0,results:[fin('late')]});eq([h.texts,h.ends,h.errors],[[],1,[]],'a result after the session changed is dropped');}
{const h=harness();h.start();await settle();h.win.__yourrestNativeGeneration=7;h.engines[0].onerror({error:'network'});eq([h.errors,h.ends],[[],1],'an error after the session changed is dropped');}
{const h=harness();h.start();await settle();h.win.__yourrestNativeGeneration=7;h.engines[0].onend();eq([h.errors,h.ends],[[],1],'the end of the engine after the session changed');}
{const h=harness();h.start();h.win.__yourrestNativeGeneration=7;await settle();eq([h.engines.length,h.ends,h.errors],[0,1,[]],'the session changed while availability was being read: no engine is made');}
{const h=harness({native:true});h.start();h.win.__yourrestNativeGeneration=7;await settle();eq([h.calls.length,h.ends,h.errors],[0,1,[]],'the same in the app: the recogniser is never asked');}
{const h=harness({native:true});h.start();await settle();h.win.__yourrestNativeGeneration=7;h.resolvers[0].reject(new Error('speech_failed'));await settle();eq([h.errors,h.ends],[[],1],'an app error after the session changed is not shown');}
{const h=harness({native:true});h.start();await settle();h.win.__yourrestNativeScope='other-member';h.resolvers[0].resolve(null);await settle();eq([h.texts,h.errors,h.ends],[[],[],1],'an answer after the member changed is dropped, even an invalid one');}
eq(timerCount(),0,'no timer left after the dictation tests');

// ===== 2. photos
eq([I.SHRINK_LONG_SIDE,I.SHRINK_QUALITY,I.SHRINK_TARGET_BYTES],[1600,0.8,409600],'the constants');
eq(I.shrinkSize(4000,3000),{width:1600,height:1200},'longest side 1600, proportions kept');eq(I.shrinkSize(3000,4000),{width:1200,height:1600},'portrait');eq(I.shrinkSize(800,600),{width:800,height:600},'never enlarged');eq(I.shrinkSize(1600,1600),{width:1600,height:1600},'exactly 1600');eq(I.shrinkSize(4000,1),{width:1600,height:1},'at least one pixel');eq(I.shrinkSize(1,4000),{width:1,height:1600},'a tall strip');eq(I.shrinkSize(1,1),{width:1,height:1},'one pixel');eq(I.shrinkSize(4000,3000,1000),{width:1000,height:750},'another long side');eq(I.shrinkSize(1601,1),{width:1600,height:1},'one over');
for(const [w,h] of [[0,10],[10,0],[-1,5],[NaN,5],[5,NaN],['a',5],[undefined,5]])assert.throws(()=>I.shrinkSize(w,h),/Invalid image size/),eq(1,1,'refused size '+w+'x'+h);
{const steps=I.shrinkSteps(4000,3000);eq([...new Set(steps.map(s=>s.width+'x'+s.height))],['1600x1200','1280x960','1024x768','819x614'],'sizes step down by a fifth');eq(steps.length,12,'three qualities at each of four sizes');eq(steps.slice(0,3).map(s=>s.quality),[0.8,0.7,0.6],'quality lowered first');ok(Math.max(steps.at(-1).width,steps.at(-1).height)>=800,'never below 800 on the longest side');}
eq(I.shrinkSteps(800,600).length,3,'a small photo is tried at its own size only');eq(I.shrinkSteps(1000,500).map(s=>s.width+'x'+s.height),['1000x500','1000x500','1000x500','800x400','800x400','800x400'],'a mid-size photo gets one smaller size');
assert.throws(()=>I.shrinkSteps(0,5),/Invalid image size/);eq(1,1,'steps of an invalid size');
eq(new I.ShrinkError('too_large').reason,'too_large','the error carries its reason');eq(new I.ShrinkError('unreadable').name,'ShrinkError','and its name');
// the drawing, over fakes
function photoEnv({width=4000,height=3000,size=(w,h,q)=>w*h*q*0.5,bitmap=true,noContext=false,nullBlob=false,imageFails=false}={}){
 const env={closed:0,draws:[],toBlobs:[],fills:0,revoked:0};
 const canvas={width:0,height:0,getContext:()=>noContext?null:{fillRect(){env.fills++;},drawImage(src,x,y,w,h){env.draws.push([w,h]);},set fillStyle(v){env.fill=v;},set imageSmoothingEnabled(v){},set imageSmoothingQuality(v){}},toBlob(cb,type,quality){env.toBlobs.push([this.width,this.height,type,quality]);cb(nullBlob?null:new Blob([new Uint8Array(Math.round(size(this.width,this.height,quality)))]));}};
 globalThis.document={createElement:()=>canvas};env.canvas=canvas;
 if(bitmap)globalThis.createImageBitmap=async()=>({width,height,close(){env.closed++;}});else delete globalThis.createImageBitmap;
 globalThis.Image=class{async decode(){if(imageFails)throw Error('no');}get naturalWidth(){return width;}get naturalHeight(){return height;}set src(v){}};
 const real=URL.revokeObjectURL;URL.revokeObjectURL=()=>{env.revoked++;};env.restore=()=>{URL.revokeObjectURL=real;};
 return env;
}
{const env=photoEnv({size:(w,h,q)=>w*h*q/10});const r=await I.shrinkPhoto(new Blob(['x']));eq([r.width,r.height,env.toBlobs.length,env.toBlobs[0].slice(2),env.closed,env.fill],[1600,1200,1,['image/jpeg',0.8],1,'#ffffff'],'good at the first try: one JPEG at quality 0.8 on a white ground');eq([env.canvas.width,env.canvas.height],[0,0],'the canvas is freed');eq(r.blob.size,Math.round(1600*1200*0.8/10),'the blob is the try');env.restore();}
{const env=photoEnv();const r=await I.shrinkPhoto(new Blob(['x']));eq([r.width,r.height,env.toBlobs.length],[1280,960,6],'stepped down until a try reaches 400 KB');eq(env.draws,[[1600,1200],[1280,960]],'drawn once for each size');eq(env.toBlobs.map(b=>b[3]),[0.8,0.7,0.6,0.8,0.7,0.6],'qualities in order');ok(r.blob.size<=I.SHRINK_TARGET_BYTES,'at or under the target');env.restore();}
{const env=photoEnv({size:(w,h,q)=>w*h*q*5});const r=await I.shrinkPhoto(new Blob(['x']),{maxBytes:1e9});eq([r.width,r.height,env.toBlobs.length],[819,614,12],'no try reached the target: every try was made and the smallest kept');env.restore();}
{const env=photoEnv({size:(w,h,q)=>w*h*q*50});await rejects(I.shrinkPhoto(new Blob(['x'])),e=>e.name==='ShrinkError'&&e.reason==='too_large','the smallest try is still over the byte limit');eq(env.closed,1,'the source is released even when refused');env.restore();}
{const env=photoEnv({size:()=>1000});const r=await I.shrinkPhoto(new Blob(['x']),{targetBytes:500,maxBytes:2000});eq([env.toBlobs.length,r.blob.size],[12,1000],'a custom target and limit');env.restore();}
{const env=photoEnv({width:800,height:600,size:()=>10});const r=await I.shrinkPhoto(new Blob(['x']));eq([r.width,r.height],[800,600],'a small photo keeps its size');env.restore();}
{const env=photoEnv({width:0,height:100});await rejects(I.shrinkPhoto(new Blob(['x'])),e=>e.reason==='unreadable','a zero-width picture is unreadable');eq(env.closed,1,'and released');env.restore();}
{const env=photoEnv({noContext:true});await rejects(I.shrinkPhoto(new Blob(['x'])),e=>e.reason==='unreadable','no 2d context');env.restore();}
{const env=photoEnv({nullBlob:true});await rejects(I.shrinkPhoto(new Blob(['x'])),e=>e.reason==='unreadable','the browser could not encode');env.restore();}
{const env=photoEnv({bitmap:false,width:3000,height:2000,size:(w,h,q)=>w*h*q/10});const r=await I.shrinkPhoto(new Blob(['x']));eq([r.width,r.height,env.revoked],[1600,1067,1],'an engine without createImageBitmap uses an image element and frees its address');env.restore();}
{const env=photoEnv({bitmap:false,imageFails:true});await rejects(I.shrinkPhoto(new Blob(['x'])),e=>e.reason==='unreadable','a file that is not an image');eq(env.revoked,1,'its address is freed');env.restore();}
{const env=photoEnv();globalThis.createImageBitmap=async()=>{throw Error('unsupported options');};globalThis.Image=class{async decode(){}get naturalWidth(){return 2000;}get naturalHeight(){return 1000;}set src(v){}};const r=await I.shrinkPhoto(new Blob(['x']),{maxBytes:1e9});eq(r.width,1600,'a bitmap that fails falls back to the image element');env.restore();}
{const env=photoEnv();delete globalThis.Image;globalThis.createImageBitmap=async()=>{throw Error('x');};await rejects(I.shrinkPhoto(new Blob(['x'])),e=>e.reason==='unreadable','nothing can read it');env.restore();}

// ===== 3. a visit's place
const pos=(over={})=>({timestamp:Date.parse('2026-11-22T06:00:00Z'),coords:{latitude:24.7136,longitude:46.6753,accuracy:12.4,...over.coords},...(over.timestamp!==undefined?{timestamp:over.timestamp}:{})});
const geo=(onCall)=>({getCurrentPosition:(ok,fail,opts)=>onCall(ok,fail,opts)});
{let opts;const r=await V.captureVisitLocation(geo((s,f,o)=>{opts=o;s(pos());}));eq(r,{location:'24.7136000, 46.6753000',latitude:24.7136,longitude:46.6753,locationSource:'device',locationCapturedAt:'2026-11-22T06:00:00.000Z',locationAccuracy:12},'a fix: seven decimals, ISO moment, accuracy rounded');eq(opts,{enableHighAccuracy:true,timeout:20000,maximumAge:0},'a fresh high-accuracy fix is asked for');}
eq((await V.captureVisitLocation(geo(s=>s(pos({coords:{accuracy:0.5}}))))).locationAccuracy,1,'accuracy 0.5 rounds to 1');eq((await V.captureVisitLocation(geo(s=>s(pos({coords:{latitude:-90,longitude:-180,accuracy:0}}))))).location,'-90.0000000, -180.0000000','the edges of the range are valid');
const bad=[{latitude:91},{latitude:-91},{longitude:181},{longitude:-181},{latitude:NaN},{longitude:Infinity},{accuracy:-1},{accuracy:NaN},{accuracy:Infinity},{latitude:'24'}];
for(const coords of bad)await rejects(V.captureVisitLocation(geo(s=>s(pos({coords})))),/تعذر قراءة موقع صحيح/,'refused fix '+JSON.stringify(coords));
for(const timestamp of [0,-5,NaN,Infinity,8.64e15+1])await rejects(V.captureVisitLocation(geo(s=>s(pos({timestamp})))),/تعذر قراءة موقع صحيح/,'refused moment '+timestamp);
await rejects(V.captureVisitLocation(undefined),/غير متاح/,'no geolocation');
await rejects(V.captureVisitLocation(geo((s,f)=>f({code:1}))),/السماح بالموقع مقفول/,'permission refused');await rejects(V.captureVisitLocation(geo((s,f)=>f({code:2}))),/تعذر تحديد الموقع/,'position unavailable');await rejects(V.captureVisitLocation(geo((s,f)=>f({code:3}))),/انتهت مهلة/,'the engine timed out');
await rejects(V.captureVisitLocation(geo(()=>{throw Error('x');})),/تعذر بدء تحديد الموقع/,'a geolocation that throws');
{const p=V.captureVisitLocation(geo(()=>{}));await settle();fire(22000);await rejects(p,/انتهت مهلة/,'a WebView that never calls back: 22 seconds');eq(timerCount(),0,'timer cleared');}
{const p=V.captureVisitLocation(geo((s,f)=>{f({code:1});s(pos());}));await rejects(p,/السماح بالموقع مقفول/,'only the first answer counts');}
{const c=new AbortController();c.abort();await rejects(V.captureVisitLocation(geo(()=>{throw Error('must not ask');}),c.signal),/تم إلغاء/,'already aborted asks nothing');}
{const c=new AbortController();const p=V.captureVisitLocation(geo(()=>{}),c.signal);c.abort();await rejects(p,/تم إلغاء/,'aborting while waiting');eq(timerCount(),0,'timer cleared on abort');}
{const c=new AbortController();const r=await V.captureVisitLocation(geo(s=>s(pos())),c.signal);c.abort();ok(r.latitude===24.7136,'an abort after the answer changes nothing');}
eq(V.visitLocationTimeout,22000,'22 seconds');

// ===== 4. the journey buffer
const DAY=Date.parse('2026-11-22T00:00:00Z');
eq([J.journeyDay(Date.parse('2026-11-22T20:59:59Z')),J.journeyDay(Date.parse('2026-11-22T21:00:00Z')),J.journeyDay(Date.parse('2026-11-22T00:00:00Z')),J.journeyDay(Date.parse('2026-12-31T21:00:00Z')),J.journeyDay(Date.parse('2028-02-28T21:00:00Z'))],['2026-11-22','2026-11-23','2026-11-22','2027-01-01','2028-02-29'],'the journey day turns at 21:00 UTC (midnight in Riyadh), year and leap day included');
const NOW=Date.parse('2026-11-22T09:00:00Z');
const sample=(c={},timestamp=NOW,now=NOW)=>J.positionSample({timestamp,coords:{latitude:24.7,longitude:46.6,accuracy:25,...c}},now,'id-1');
eq(sample(),{id:'id-1',capturedAt:'2026-11-22T09:00:00.000Z',latitude:24.7,longitude:46.6,accuracy:25},'a good sample');
eq(sample({},NOW+5000)!==null,true,'five seconds ahead of the phone clock is allowed');eq(sample({},NOW+5001),null,'more than five seconds ahead is refused');
eq(sample({},NOW-J.JOURNEY_BUFFER_MS)!==null,true,'exactly fifteen minutes old is kept');eq(sample({},NOW-J.JOURNEY_BUFFER_MS-1),null,'older than fifteen minutes');
for(const c of [{latitude:91},{latitude:-91},{longitude:181},{longitude:-181},{latitude:0,longitude:0},{accuracy:-1},{accuracy:10001},{latitude:NaN},{longitude:Infinity},{accuracy:NaN}])eq(sample(c),null,'refused sample '+JSON.stringify(c));
eq(sample({accuracy:10000})!==null,true,'accuracy 10000 is the limit');eq(sample({latitude:0,longitude:46.6})!==null,true,'latitude 0 alone is a real place');eq(sample({},NaN),null,'no moment');
ok(typeof J.positionSample({timestamp:Date.now(),coords:{latitude:24.7,longitude:46.6,accuracy:5}})?.id==='string','a generated id when none is given');
const q=(i,at)=>({id:'p'+i,capturedAt:new Date(at).toISOString(),latitude:1,longitude:1,accuracy:1,stopId:'s'});
eq(J.trimJourneyBuffer([q(1,NOW-J.JOURNEY_BUFFER_MS-1),q(2,NOW-J.JOURNEY_BUFFER_MS),q(3,NOW)],NOW),{points:[q(2,NOW-J.JOURNEY_BUFFER_MS),q(3,NOW)],dropped:1},'old points are dropped, the limit moment is kept');
{const many=Array.from({length:600},(_, i)=>q(i,NOW-i));const r=J.trimJourneyBuffer(many,NOW);eq([r.points.length,r.dropped,r.points[0].id,r.points.at(-1).id],[500,100,'p100','p599'],'at most 500 points: the oldest of the list are dropped');}
eq(J.trimJourneyBuffer([],NOW),{points:[],dropped:0},'empty');
eq(J.trimJourneyBuffer([{...q(1,NOW),capturedAt:'garbage'}],NOW).dropped,1,'an unreadable moment is dropped');
const day='2026-11-22';
for(const [i,e] of [[{enabled:true,customerId:'c',type:'visit'},true],[{enabled:true,customerId:'c',type:'visit',date:day},true],[{enabled:true,customerId:'c',type:'visit',date:'2026-11-21'},false],[{enabled:false,customerId:'c',type:'visit'},false],[{enabled:true,customerId:'',type:'visit'},false],[{enabled:true,customerId:'c',type:'call'},false],[{enabled:true,customerId:'c',type:'visit',date:''},true]])eq(J.shouldStartJourney(i,day),e,'should start '+JSON.stringify(i));
eq(J.shouldStartJourney({enabled:true,customerId:'c',type:'visit',date:J.journeyDay()}),true,'today by default');
eq([J.JOURNEY_BUFFER_MS,J.JOURNEY_BUFFER_LIMIT],[900000,500],'the buffer constants');
Object.assign(globalThis,real);
report();
