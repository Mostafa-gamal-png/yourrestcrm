import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpileModule(fs.readFileSync('lib/client-submit.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
let checks=0;
function setup(fetch){const exports={},timers=new Map();let next=0;vm.runInNewContext(source,{exports,fetch,AbortController,Error,TypeError,URL,Promise,window:{location:{origin:'https://crm.yourrest.org'}},setTimeout:(callback,delay)=>{const id=++next;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id)});return{...exports,timers,expire:()=>{for(const {callback} of [...timers.values()])callback();}};}
const ok=(value,label)=>{assert.ok(value,label);checks++;};
const eq=(value,expected,label)=>{assert.deepEqual(value,expected,label);checks++;};
const success={ok:true,id:'visit-1'};
let lastSignal,h=setup(async(url,init)=>{lastSignal=init.signal;return {ok:true,status:200,json:async()=>success};});
eq(await h.submitJson('/api/visits',{method:'POST'}),success,'Valid save returned exactly');eq(h.timers.size,0,'Success cancels request deadline');ok(lastSignal instanceof AbortSignal,'Fetch receives cancelable signal');
const fresh={error:'Version changed',fresh:{version:4,data:{role:'rep'}}};h=setup(async()=>({ok:false,status:409,json:async()=>fresh}));let error;try{await h.submitJson('/api/crm',{});}catch(e){error=e;}eq(error.message,'Version changed');eq(error.status,409);eq(error.body,fresh,'Concurrency payload remains available');eq(error.name,'SubmitError');eq(h.timers.size,0);
eq(h.definiteSubmitRejection(error),true,'Canonical version rejection permits corrected input');
for(const [status,body,expected]of [[0,null,false],[503,{error:'Unknown server state'},false],[200,null,false],[400,{error:'Required field missing'},true],[401,{error:'Login required'},true],[403,{error:'Permission denied'},true],[409,{error:'تم حفظ هذه العملية بالفعل. أعد فتح الزيارة لحفظ تعديلات إضافية.'},false],[409,{error:'العملية محفوظة ببيانات مختلفة. حدّث الصفحة.'},false]])eq(h.definiteSubmitRejection(new h.SubmitError('Test',status,body)),expected,'Ambiguous receipt remains frozen '+status);
for(const [status,language,expected] of [[502,'ar','الخادم'],[401,'en','session'],[403,'ar','الصلاحية']]){h=setup(async()=>({ok:false,status,json:async()=>{throw new SyntaxError('Unexpected token <html>');}}));try{await h.submitJson('/api/visits',{},{language});}catch(e){error=e;}ok(error.message.includes(expected),'HTML errors are actionable '+status);ok(!error.message.includes('<html>'),'Hosting response content is not exposed');eq(error.status,status);}
h=setup(async()=>({ok:true,status:200,redirected:true,url:'https://crm.yourrest.org/login',json:async()=>success}));try{await h.submitJson('/api/visits',{});}catch(e){error=e;}eq(error.status,401,'Redirected login cannot be accepted as a save');
for(const value of [null,[],false,'ok',{ok:false}]){h=setup(async()=>({ok:true,status:200,json:async()=>value}));await assert.rejects(h.submitJson('/api/visits',{}),/الخادم/);checks++;}
h=setup(async()=>{throw new TypeError('Failed to fetch');});await assert.rejects(h.submitJson('/api/visits',{}, {language:'en'}),/connection/);checks++;
// A stalled fetch/JSON parser can ignore AbortSignal; the independent boundary still releases UI.
for(const stalledJson of [false,true]){h=setup(async()=>stalledJson?{ok:true,status:200,json:()=>new Promise(()=>{})}:new Promise(()=>{}));const pending=h.submitJson('/api/visits',{}, {language:'en'});await Promise.resolve();h.expire();await assert.rejects(pending,/timed out/);checks++;eq(h.timers.size,0,'Timeout removes timer');}
for(const stalledJson of [false,true]){const controller=new AbortController();h=setup(async(url,init)=>{lastSignal=init.signal;return stalledJson?{ok:true,status:200,json:()=>new Promise(()=>{})}:new Promise(()=>{});});const pending=h.submitJson('/api/crm',{signal:controller.signal});await Promise.resolve();controller.abort();await assert.rejects(pending,e=>e.name==='AbortError');checks++;eq(lastSignal.aborted,true,'External cancellation reaches fetch');eq(h.timers.size,0);}
const already=new AbortController();already.abort();let calls=0;h=setup(async()=>{calls++;return{ok:true,status:200,json:async()=>success};});await assert.rejects(h.submitJson('/api/crm',{signal:already.signal}),e=>e.name==='AbortError');checks++;eq(calls,0,'Canceled request never reaches fetch');eq(h.timers.size,0);
console.log(JSON.stringify({ok:true,checks,coverage:'bounded save/JSON response, canceled requests, failed network/hosting/session, concurrency payload',realBrowser:false}));
