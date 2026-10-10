// Executes real native/browser adapter and VoiceField callbacks without claiming a physical microphone test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
let checks=0;const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
function load(file,require,globals={}){const exports={};vm.runInNewContext(compile(file),{exports,require,console,Error,crypto:globalThis.crypto,...globals});return exports;}
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function harness({native=false,browser=true,supported=true,protocol=1}={}){
 const window=new EventTarget(),engines=[],calls=[],timers=new Map();let next=0,generation=0,bridgeReady=true,bridgeWaiters=[];
 class Engine {constructor(){this.started=0;this.aborted=0;engines.push(this);}start(){this.started++;}abort(){this.aborted++;this.onend?.();}}
 if(browser)window.SpeechRecognition=Engine;
 const bridge={speechProtocol:protocol,speechSupported:supported,request(method,payload){calls.push({method,payload});if(method==='speechCancel')return Promise.resolve({sessionId:payload.sessionId,cancelled:true,text:''});return new Promise((resolve,reject)=>Object.assign(calls.at(-1),{resolve,reject}));}};
 const nativeModule={isNativeTrackingApp:()=>native,nativeTrackingGeneration:()=>generation,waitForNativeBridge:()=>bridgeReady?Promise.resolve(bridge):new Promise(resolve=>bridgeWaiters.push(resolve))};
 const timeout=(callback,delay)=>{const id=++next;timers.set(id,{callback,delay});return id;};
 const api=load('lib/native-speech.ts',()=>nativeModule,{window,setTimeout:timeout,clearTimeout:id=>timers.delete(id),setInterval:timeout,clearInterval:id=>timers.delete(id)});
 const outcomes={texts:[],errors:[],ends:0};
 const start=()=>api.startSpeech({language:'ar-SA',onText:value=>outcomes.texts.push(value),onError:code=>outcomes.errors.push(code),onEnd:()=>outcomes.ends++});
 const result=(engine,text)=>engine.onresult?.({resultIndex:0,results:[Object.assign([{transcript:text}],{isFinal:true})]});
 return {api,window,engines,calls,timers,outcomes,start,result,generation:()=>generation++,defer:()=>bridgeReady=false,ready:()=>{bridgeReady=true;bridgeWaiters.splice(0).forEach(resolve=>resolve(bridge));},tick:delay=>[...timers.values()].filter(x=>x.delay===delay).forEach(x=>x.callback())};
}
const browser=harness();eq(await browser.api.speechAvailability(),'browser');eq(browser.engines.length,0,'Capability lookup opens no microphone');browser.start();await settle();eq(browser.engines[0].lang,'ar-SA');eq(browser.engines[0].continuous,false);browser.result(browser.engines[0],'  جودة ممتازة  ');eq(browser.outcomes.texts,['جودة ممتازة']);eq(browser.outcomes.ends,1);eq(browser.engines[0].aborted,1,'Result-before-end releases browser microphone');eq(browser.timers.size,0);
const competing=harness();competing.start();await settle();const staleResult=competing.engines[0].onresult;competing.start();await settle();eq(competing.engines[0].aborted,1);staleResult({results:[[{transcript:'old customer'}]]});eq(competing.outcomes.texts,[]);competing.result(competing.engines[1],'new customer');eq(competing.outcomes.texts,['new customer']);eq(competing.outcomes.ends,2);
const cancelled=harness();const task=cancelled.start();await settle();const callback=cancelled.engines[0].onresult;task.cancel();callback({results:[[{transcript:'late'}]]});eq(cancelled.outcomes.texts,[]);eq(cancelled.outcomes.errors,[]);eq(cancelled.timers.size,0);
const denied=harness();denied.start();await settle();denied.engines[0].onerror({error:'not-allowed'});eq(denied.outcomes.errors,['speech_permission']);eq(denied.engines[0].aborted,1);
const huge=harness();huge.start();await settle();huge.result(huge.engines[0],'x'.repeat(5001));eq(huge.outcomes.errors,['speech_too_long']);eq(huge.outcomes.texts,[]);eq(huge.engines[0].aborted,1,'Rejected transcript releases microphone');
const auth=harness();auth.start();await settle();auth.generation();auth.tick(250);eq(auth.engines[0].aborted,1,'Logout generation immediately cancels browser session');eq(auth.outcomes.texts,[]);
const navigate=harness();navigate.start();await settle();navigate.window.dispatchEvent(new Event('popstate'));eq(navigate.engines[0].aborted,1);eq(navigate.outcomes.ends,1);
const timeout=harness();timeout.start();await settle();timeout.tick(80000);eq(timeout.outcomes.errors,['speech_timeout']);eq(timeout.engines[0].aborted,1);
const unsupported=harness({browser:false});eq(await unsupported.api.speechAvailability(),'unavailable');unsupported.start();await settle();eq(unsupported.outcomes.errors,['speech_unsupported']);
const native=harness({native:true,browser:false});eq(await native.api.speechAvailability(),'native');eq(native.calls.length,0,'Native capability requires no GPS/status/permission request');native.start();await settle();eq(native.calls[0].method,'speechStart');eq(native.calls[0].payload.language,'ar-SA');native.calls[0].resolve({sessionId:native.calls[0].payload.sessionId,text:'مصنع منافس',cancelled:false});await settle();eq(native.outcomes.texts,['مصنع منافس']);eq(native.calls.map(call=>call.method),['speechStart','speechCancel']);eq(native.outcomes.ends,1);
const nativeCancel=harness({native:true,browser:false});const stop=nativeCancel.start();await settle();stop.cancel();eq(nativeCancel.calls[1].method,'speechCancel');eq(nativeCancel.calls[1].payload.sessionId,nativeCancel.calls[0].payload.sessionId);nativeCancel.calls[0].resolve({sessionId:nativeCancel.calls[0].payload.sessionId,text:'late native',cancelled:false});await settle();eq(nativeCancel.outcomes.texts,[]);eq(nativeCancel.outcomes.ends,1);
const nativeStale=harness({native:true});nativeStale.start();await settle();nativeStale.generation();nativeStale.calls[0].resolve({sessionId:nativeStale.calls[0].payload.sessionId,text:'old account',cancelled:false});await settle();eq(nativeStale.outcomes.texts,[]);eq(nativeStale.outcomes.errors,[]);
const invalid=harness({native:true});invalid.start();await settle();invalid.calls[0].resolve({sessionId:'wrong',text:'wrong field',cancelled:false});await settle();eq(invalid.outcomes.errors,['speech_invalid']);eq(invalid.outcomes.texts,[]);
const nativeDenied=harness({native:true});nativeDenied.start();await settle();nativeDenied.calls[0].reject(Error('speech_permission'));await settle();eq(nativeDenied.outcomes.errors,['speech_permission']);eq(nativeDenied.engines.length,0,'Permission refusal never silently switches providers');
const nativeCancelled=harness({native:true});nativeCancelled.start();await settle();nativeCancelled.calls[0].resolve({sessionId:nativeCancelled.calls[0].payload.sessionId,text:'ignored',cancelled:true});await settle();eq(nativeCancelled.outcomes.texts,[]);eq(nativeCancelled.outcomes.errors,[]);
const lateBridge=harness({native:true,browser:false});lateBridge.defer();const waiting=lateBridge.start();waiting.cancel();lateBridge.ready();await settle();eq(lateBridge.calls.length,0,'Unmount before bridge availability never starts microphone');
const older=harness({native:true,browser:false,protocol:0});eq(await older.api.speechAvailability(),'upgrade');older.start();await settle();eq(older.calls.length,0);eq(older.outcomes.errors,['speech_upgrade']);
const fallback=harness({native:true,browser:true,supported:false});eq(await fallback.api.speechAvailability(),'browser');fallback.start();await settle();eq(fallback.engines.length,1);eq(fallback.calls.length,0);
ok(browser.api.speechErrorMessage('speech_permission','en').includes('microphone'));ok(browser.api.speechErrorMessage('speech_unsupported','ar').includes('لوحة المفاتيح'));

function fieldHarness(){
 let props={label:'ملاحظات المنافس',value:'existing',onChange:value=>changes.push(value),contextKey:'rep:customer:a'},language='ar',cursor=0,dirty=true,tree;
 const hooks=[],effects=[],changes=[],sessions=[];const window=new EventTarget();
 const different=(a,b)=>!a||!b||a.length!==b.length||a.some((v,i)=>!Object.is(v,b[i]));
 const react={...React,useRef(initial){const i=cursor++;if(!hooks[i])hooks[i]={current:initial};return hooks[i];},useState(initial){const i=cursor++;if(!hooks[i])hooks[i]={value:initial};return [hooks[i].value,value=>{hooks[i].value=typeof value==='function'?value(hooks[i].value):value;dirty=true;}];},useEffect(effect,deps){const i=cursor++;if(!hooks[i]||different(hooks[i].deps,deps)){const before=hooks[i];hooks[i]={deps,cleanup:before?.cleanup};effects.push(()=>{hooks[i].cleanup?.();hooks[i].cleanup=effect();});}}};
 const speech={speechAvailability:()=>Promise.resolve('browser'),speechErrorMessage:(code)=>code,startSpeech(options){const task={options,cancels:0,cancel(){this.cancels++;options.onEnd();}};sessions.push(task);return task;}};
 const mod=load('app/voice-field.tsx',name=>name==='react'?react:name==='react/jsx-runtime'?jsx:name==='lucide-react'?{Mic:()=>null,Square:()=>null}:name==='@/lib/i18n'?{t:value=>value,useLanguage:()=>language,getLanguage:()=>language}:speech,{window});
 const flush=()=>{for(let n=0;dirty&&n<20;n++){dirty=false;cursor=0;tree=mod.default(props);effects.splice(0).forEach(effect=>effect());}return tree;};
 const visit=node=>{if(!node||typeof node!=='object')return [];return [node,...(Array.isArray(node.props?.children)?node.props.children:[node.props?.children]).flatMap(child=>Array.isArray(child)?child.flatMap(visit):visit(child))];};
 const button=()=>visit(tree).find(node=>node.type==='button');
 return {flush,settle:async()=>{await settle();flush();},sessions,changes,click:()=>{button().props.onClick();flush();},button,update:patch=>{props={...props,...patch};dirty=true;flush();},language:value=>{language=value;dirty=true;flush();},unmount:()=>hooks.forEach(hook=>hook.cleanup?.()),nodes:()=>visit(tree)};
}
const field=fieldHarness();field.flush();await field.settle();eq(field.sessions.length,0);field.click();eq(field.sessions.length,1);field.update({value:'typed while listening'});field.sessions[0].options.onText('spoken');eq(field.changes,['typed while listening spoken'],'Dictation appends to latest editable text');field.update({contextKey:'rep:customer:b'});field.sessions[0].options.onText('stale');eq(field.changes.length,1);ok(field.sessions[0].cancels>0);field.click();field.update({disabled:true});field.sessions[1].options.onText('during save');eq(field.changes.length,1);eq(field.button().props.disabled,true);ok(field.nodes().find(node=>node.type==='input').props.disabled);field.update({disabled:false});field.click();field.unmount();field.sessions[2].options.onText('after close');eq(field.changes.length,1);
const english=fieldHarness();english.flush();await english.settle();english.language('en');english.click();eq(english.sessions[0].options.language,'en-US');eq(english.button().props['aria-label'],'Cancel dictation');english.language('ar');english.sessions[0].options.onText('old language');eq(english.changes,[]);english.unmount();
console.log(`Native/browser speech and VoiceField checks passed: ${checks}`);
