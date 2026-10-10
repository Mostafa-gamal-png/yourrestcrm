// Execute the client renewal lifecycle with controlled time/network/visibility.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),work=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-session-'));
const saved={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch,now:Date.now};
let checks=0,now=1000000,cleanup,effect,requests=[],pending=null,ok=true,fails=false,status=200,locked=0,logoutPending=false;
const intervals=new Map(),timeouts=new Map();let nextId=1;
const check=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
const settle=async()=>{await Promise.resolve();await Promise.resolve();};
try{
 const window=new EventTarget(),document=new EventTarget();document.visibilityState='visible';
 window.setTimeout=fn=>{const id=nextId++;timeouts.set(id,fn);return id;};window.clearTimeout=id=>timeouts.delete(id);
 window.setInterval=fn=>{const id=nextId++;intervals.set(id,fn);return id;};window.clearInterval=id=>intervals.delete(id);
 globalThis.window=window;globalThis.document=document;Date.now=()=>now;
 globalThis.fetch=async(url,options)=>{requests.push({url,options});if(fails)throw Error('offline');if(pending)await pending;return {ok,status};};
 globalThis.__sessionEffect=fn=>{effect=fn;};globalThis.__sessionLock=async()=>{locked++;};globalThis.__sessionPending=()=>logoutPending;
 const source=fs.readFileSync(path.join(root,'app/email-session.tsx'),'utf8').replace("import {useEffect} from 'react';","const useEffect=globalThis.__sessionEffect;").replace("import {lockOfflineSession} from '@/lib/offline-store';","const lockOfflineSession=globalThis.__sessionLock;").replace("import {isOfflineLogoutPending} from '@/lib/offline-auth';","const isOfflineLogoutPending=globalThis.__sessionPending;");
 fs.writeFileSync(path.join(work,'session.mjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText);
 const {default:EmailSession}=await import(pathToFileURL(path.join(work,'session.mjs')));check(EmailSession(),null);
 cleanup=effect();await settle();check(requests.length,1);check(requests[0].url,'/api/auth/refresh');
 check([requests[0].options.method,requests[0].options.credentials,requests[0].options.cache,requests[0].options.body],['POST','same-origin','no-store','{}']);
 window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));await settle();check(requests.length,1);
 now+=24*60*60*1000;document.visibilityState='hidden';for(const fn of intervals.values())fn();await settle();check(requests.length,1);
 document.visibilityState='visible';document.dispatchEvent(new Event('visibilitychange'));await settle();check(requests.length,2);
 now+=401*24*60*60*1000;window.dispatchEvent(new Event('focus'));await settle();check(requests.length,3);
 now+=24*60*60*1000;fails=true;window.dispatchEvent(new Event('focus'));await settle();check(requests.length,4);
 window.dispatchEvent(new Event('online'));await settle();check(requests.length,4);
 now+=60000;fails=false;window.dispatchEvent(new Event('online'));await settle();check(requests.length,5);
 now+=24*60*60*1000;ok=false;window.dispatchEvent(new Event('focus'));await settle();check(requests.length,6);
 now+=60000;ok=true;window.dispatchEvent(new Event('focus'));await settle();check(requests.length,7);
 let release;pending=new Promise(resolve=>{release=resolve;});now+=24*60*60*1000;window.dispatchEvent(new Event('focus'));
 now+=60000;window.dispatchEvent(new Event('focus'));await settle();check(requests.length,8);check(requests.at(-1).options.signal.aborted,false);
 cleanup();check(requests.at(-1).options.signal.aborted,true);check(intervals.size,0);release();await settle();check(timeouts.size,0);
 window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'));await settle();check(requests.length,8);
 // A browser tab mounted in the background renews when it first becomes visible.
 pending=null;document.visibilityState='hidden';EmailSession();cleanup=effect();await settle();check(requests.length,8);
 document.visibilityState='visible';document.dispatchEvent(new Event('visibilitychange'));await settle();check(requests.length,9);cleanup();
 // Explicit logout cannot renew the still-present cookie; authorization failures
 // lock cached data, whereas a transport failure leaves it available offline.
 logoutPending=true;EmailSession();cleanup=effect();await settle();check(requests.length,9);cleanup();
 logoutPending=false;status=401;ok=false;EmailSession();cleanup=effect();await settle();check(locked,1);cleanup();
 status=403;EmailSession();cleanup=effect();await settle();check(locked,2);cleanup();
 fails=true;EmailSession();cleanup=effect();await settle();check(locked,2);cleanup();
 console.log(JSON.stringify({ok:true,checks,type:'controlled client lifecycle',real_browser:false}));
}finally{cleanup?.();Object.assign(globalThis,{window:saved.window,document:saved.document,fetch:saved.fetch});Date.now=saved.now;delete globalThis.__sessionEffect;delete globalThis.__sessionLock;delete globalThis.__sessionPending;fs.rmSync(work,{recursive:true,force:true});}
