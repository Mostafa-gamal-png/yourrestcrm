// Every save of a form goes through lib/client-submit.ts: the real module transpiled as the build does and imported (so its coverage is
// counted), with the browser's fetch, XMLHttpRequest, window and timers played by stand-ins that keep their contract; no network, a fixed
// clock. What it proves:
// 1. Which answer proves a refusal (definiteSubmitRejection): a 4xx with the server's own error, never «already saved» (409), never a 5xx.
// 2. submitJson over fetch: the answer returned as it is; the server's error with its status and body; the device's own words in Arabic and
//    English for a page that was not the server's (a 401 or 403 page: «session»; anything else: «invalid», marked invalidResponse), for a
//    refusal without its error and for a save the server did not confirm; a redirect to the sign-in page is a 401; no connection; another
//    error passes through; the deadline (its words, the request aborted, the timer gone); a cancel before, during and after.
// 3. The upload with progress (XMLHttpRequest): the phases and percentages (clamped, unknown total), the headers, the method, the cookie only
//    when asked, the redirect, a network error, the browser's own abort, a send that throws, a cancel and a timeout during the upload.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

const NativeDate=Date;const clock=NativeDate.parse('2026-11-22T06:00:00.000Z');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'client-submit-unit-'));
process.on('exit',()=>{globalThis.Date=NativeDate;fs.rmSync(out,{recursive:true,force:true});});
const code=ts.transpileModule(fs.readFileSync(path.join(root,'lib/client-submit.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
fs.mkdirSync(path.join(out,'lib'),{recursive:true});fs.writeFileSync(path.join(out,'lib/client-submit.mjs'),code);
const C=await import(pathToFileURL(path.join(out,'lib/client-submit.mjs')));

const timers=new Map();let timerId=0;
globalThis.setTimeout=(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;};
globalThis.clearTimeout=id=>{timers.delete(id);};
const fireAll=()=>{for(const [id,timer] of [...timers]){timers.delete(id);timer.callback();}};
globalThis.window={location:{origin:'https://crm.yourrest.org'}};
const settle=async(turns=3)=>{for(let i=0;i<turns;i++)await new Promise(resolve=>setImmediate(resolve));};

let checks=0;const counts={};
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const counted=async(part,fn)=>{const before=checks;await fn();counts[part]=checks-before;};
const failure=async promise=>{try{await promise;}catch(error){return error;}throw new Error('Expected a failure');};
const [SESSION,INVALID,UNSAVED]=[C.NOT_SERVER_ANSWER.session,C.NOT_SERVER_ANSWER.invalid,C.NOT_SERVER_ANSWER.unsaved];
const UNCONFIRMED=['الخادم لم يؤكد الحفظ. احتفظ بالبيانات وأعد المحاولة.','The server did not confirm the save. Keep your entries and retry.'];
const OFFLINE=['تعذر الاتصال بالخادم. تأكد من الإنترنت ثم أعد المحاولة؛ البيانات ما زالت في النموذج.','The server could not be reached. Check your connection and retry; your entries remain in the form.'];
const TIMEOUT=['انتهت مهلة الاتصال. البيانات موجودة في النموذج؛ أعد المحاولة بنفس البيانات للتأكد من الحفظ.','The request timed out. Your entries remain in the form; retry with the same entries to confirm the save.'];
const ENDED=['انتهت جلسة الدخول. سجّل الدخول مرة أخرى ثم أعد المحاولة.','Your session ended. Sign in again and retry.'];
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
let calls=[];const serve=answer=>{calls=[];globalThis.fetch=async(url,init)=>{calls.push({url,init});return answer(url,init);};};

await counted('what proves a refusal',async()=>{
 const E=C.SubmitError,definite=C.definiteSubmitRejection;
 const error=new E('رسالة',409,{error:'x'},true);
 eq([error.name,error.message,error.status,error.body,error.invalidResponse,error instanceof Error],['SubmitError','رسالة',409,{error:'x'},true,true],'the error keeps its status, its body and whether the answer was not the server\'s');
 eq([new E('m').status,new E('m').body,new E('m').invalidResponse],[0,null,false],'by default: no status, no body, a real answer');
 const cases=[[400,{error:'الحقل مطلوب'},true],[401,{error:'سجّل الدخول'},true],[403,{error:'لا تملك صلاحية'},true],[404,{error:'غير موجود'},true],[409,{error:'تغيّر السجل، حدّث الصفحة'},true],[499,{error:'x'},true],
  [399,{error:'x'},false],[500,{error:'x'},false],[503,{error:'x'},false],[0,null,false],[400,{error:''},false],[400,{error:'  \n '},false],[400,{error:42},false],[400,{message:'x'},false],[400,null,false],
  [409,{error:'تم حفظ هذه العملية بالفعل.'},false],[409,{error:'تم حفظ هذه المتابعة بالفعل لهذا اليوم'},false],[409,{error:'العملية محفوظة ببيانات مختلفة.'},false],[400,{error:'تم حفظ هذه العملية بالفعل.'},true]];
 for(const [status,body,expected] of cases)eq(definite(new E('m',status,body)),expected,'definite: '+status+' '+JSON.stringify(body));
 eq([definite(new Error('x')),definite({status:400,body:{error:'x'}}),definite(null),definite(undefined)],[false,false,false,false],'only a SubmitError');
 eq([C.isJsonObject({}),C.isJsonObject({a:1}),C.isJsonObject([]),C.isJsonObject(null),C.isJsonObject('x'),C.isJsonObject(1)],[true,true,false,false,false,false],'a JSON object is an object, not an array or null');
 eq(Object.values(C.NOT_SERVER_ANSWER).every(([ar,en])=>/[؀-ۿ]/.test(ar)&&!/[؀-ۿ]/.test(en)),true,'the device\'s words: Arabic and English');
});

await counted('fetch',async()=>{
 const saved={ok:true,id:'visit-1',extra:[1,2]};
 serve(()=>json(saved));timers.clear();
 const body=JSON.stringify({createKey:'k'});
 eq(await C.submitJson('/api/visits',{method:'POST',headers:{'Content-Type':'application/json'},body,credentials:'same-origin'}),saved,'the answer returned as it is');
 const init=calls[0].init;
 eq([calls[0].url,init.method,init.headers['Content-Type'],init.body,init.credentials,init.signal instanceof AbortSignal,init.signal.aborted],['/api/visits','POST','application/json',body,'same-origin',true,false],'the request as given, with a signal of its own');
 eq(timers.size,0,'the deadline is cleared');
 serve(()=>new Promise(()=>{}));timers.clear();
 const waiting=C.submitJson('/api/crm',{},{timeout:1234});await settle();
 eq([...timers.values()].map(timer=>timer.delay),[1234],'the deadline asked for');
 fireAll();await failure(waiting);
 serve(()=>new Promise(()=>{}));
 const defaults=C.submitJson('/api/crm',{});await settle();
 eq([...timers.values()].map(timer=>timer.delay),[30000],'30 seconds by default');
 fireAll();await failure(defaults);

 for(const language of ['ar','en']){
  const index=language==='en'?1:0;
  serve(()=>json({error:'اختر العميل',fresh:{version:4}},409));
  let error=await failure(C.submitJson('/api/visits',{},{language}));
  eq([error.name,error.message,error.status,error.body,error.invalidResponse],['SubmitError','اختر العميل',409,{error:'اختر العميل',fresh:{version:4}},false],'the server\'s refusal as it said it: '+language);
  for(const refusal of [{error:'   '},{error:5},{message:'x'}]){serve(()=>json(refusal,400));error=await failure(C.submitJson('/api/visits',{},{language}));eq([error.message,error.status,error.body],[UNSAVED[index],400,refusal],'a refusal without its error: '+JSON.stringify(refusal)+' '+language);}
  serve(()=>json(['x'],400));error=await failure(C.submitJson('/api/visits',{},{language}));
  eq([error.message,error.body],[UNSAVED[index],null],'an array is not a body');
  for(const status of [401,403]){
   serve(()=>new Response('<html>sign in</html>',{status}));error=await failure(C.submitJson('/api/visits',{},{language}));
   eq([error.message,error.status,error.body,error.invalidResponse],[SESSION[index],status,null,true],'a page for '+status+': the session words, not the server\'s refusal: '+language);
  }
  for(const status of [200,404,413,500,502]){
   serve(()=>new Response('<!doctype html><title>Bad gateway</title>',{status}));error=await failure(C.submitJson('/api/visits',{},{language}));
   eq([error.message,error.status,error.invalidResponse,error.message.includes('<')],[INVALID[index],status,true,false],'a page for '+status+': the invalid words and nothing of the page: '+language);
  }
  serve(()=>new Response(null,{status:204}));error=await failure(C.submitJson('/api/visits',{},{language}));
  eq([error.message,error.invalidResponse],[INVALID[index],true],'an empty answer: '+language);
  for(const value of [null,[],false,'ok',7,{ok:false,id:'x'}]){serve(()=>json(value));error=await failure(C.submitJson('/api/visits',{},{language}));eq([error.message,error.status,error.invalidResponse],[UNCONFIRMED[index],200,false],'not confirmed: '+JSON.stringify(value)+' '+language);}
  serve(()=>{throw new TypeError('Failed to fetch');});error=await failure(C.submitJson('/api/visits',{},{language}));
  eq([error.message,error.status,error.invalidResponse],[OFFLINE[index],0,false],'no connection: '+language);
  serve(()=>new Promise(()=>{}));timers.clear();const late=C.submitJson('/api/visits',{},{language});await settle();
  const signal=calls[0].init.signal;fireAll();error=await failure(late);
  eq([error.name,error.message,error.status,signal.aborted,timers.size],['SubmitError',TIMEOUT[index],0,true,0],'the deadline: its words, the request aborted, the timer gone: '+language);
  serve(()=>({ok:true,status:200,redirected:true,url:'https://crm.yourrest.org/login?next=%2Fvisits',json:async()=>({ok:true,id:'x'})}));error=await failure(C.submitJson('/api/visits',{},{language}));
  eq([error.message,error.status,error.invalidResponse],[ENDED[index],401,false],'sent to the sign-in page: the session ended, never a save: '+language);
 }
 for(const target of ['https://crm.yourrest.org/login','https://crm.yourrest.org/login/','/login']){serve(()=>({ok:true,status:200,redirected:true,url:target,json:async()=>({ok:true,id:'x'})}));eq((await failure(C.submitJson('/api/visits',{}))).status,401,'redirected to '+target);}
 for(const target of ['https://crm.yourrest.org/customers','https://crm.yourrest.org/api/login-status','']){serve(()=>({ok:true,status:200,redirected:true,url:target,json:async()=>({ok:true,id:'x'})}));eq((await C.submitJson('/api/visits',{})).id,'x','a redirect elsewhere is the answer: '+JSON.stringify(target));}
 const browser=globalThis.window;delete globalThis.window;
 serve(()=>({ok:true,status:200,redirected:true,url:'/login',json:async()=>({ok:true})}));
 eq((await failure(C.submitJson('/api/visits',{}))).status,401,'without a window the site\'s own address is used');
 globalThis.window=browser;
 const odd=new RangeError('odd');serve(()=>{throw odd;});
 eq(await failure(C.submitJson('/api/visits',{})),odd,'another error passes through as it is');
 serve(()=>({ok:true,status:200,json:async()=>{throw new TypeError('Body has already been used');}}));
 eq((await failure(C.submitJson('/api/visits',{}))).message,INVALID[0],'a body that cannot be read is not the server\'s answer');
});

await counted('cancel',async()=>{
 const before=new AbortController();before.abort();serve(()=>json({ok:true}));timers.clear();
 let error=await failure(C.submitJson('/api/crm',{signal:before.signal}));
 eq([error.name,error.message,calls.length,timers.size],['AbortError','Request canceled',0,0],'cancelled before: no request, no timer');
 for(const stall of ['fetch','json']){
  const controller=new AbortController();
  serve(()=>stall==='fetch'?new Promise(()=>{}):{ok:true,status:200,json:()=>new Promise(()=>{})});
  const pending=C.submitJson('/api/crm',{signal:controller.signal});await settle();controller.abort();
  error=await failure(pending);
  eq([error.name,calls[0].init.signal.aborted,timers.size],['AbortError',true,0],'cancelled while '+stall+' waits: the request is aborted and the timer gone');
 }
 const controller=new AbortController();
 serve((url,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new TypeError('aborted')))));
 const pending=C.submitJson('/api/crm',{signal:controller.signal});await settle();controller.abort();
 eq((await failure(pending)).name,'AbortError','a fetch that fails because it was cancelled is a cancel, not «no connection»');
 const done=new AbortController();serve(()=>json({ok:true,id:'1'}));
 eq((await C.submitJson('/api/crm',{signal:done.signal})).id,'1','saved');
 done.abort();await settle();
 eq(calls[0].init.signal.aborted,false,'a cancel after the answer touches nothing');
});

// XMLHttpRequest as the browser drives it, step by step.
const xhrs=[];
class FakeXHR{
 constructor(){this.upload={onprogress:null,onload:null};this.headers={};this.status=0;this.responseText='';this.responseURL='';this.aborted=false;this.withCredentials=false;xhrs.push(this);}
 open(method,url,async){this.method=method;this.url=url;this.async=async;}
 setRequestHeader(key,value){this.headers[key]=value;}
 send(body){if(this.throwOnSend)throw this.throwOnSend;this.body=body;}
 abort(){this.aborted=true;this.onabort?.();}
 progress(loaded,total,lengthComputable=true){this.upload.onprogress?.({loaded,total,lengthComputable});}
 uploaded(){this.upload.onload?.();}
 respond(status,text,url=''){this.status=status;this.responseText=text;this.responseURL=url;this.onload?.();}
}
await counted('upload with progress',async()=>{
 globalThis.XMLHttpRequest=FakeXHR;
 const seen=[];const progress=value=>seen.push(value);
 const form=new FormData();form.set('uploadKey','k1');
 const pending=C.submitJson('/api/visit-files',{method:'POST',body:form,headers:{'X-Request-Id':'r1'},credentials:'include'},{onUploadProgress:progress,timeout:45000});
 await settle();
 const xhr=xhrs.at(-1);
 eq([xhr.method,xhr.url,xhr.async,xhr.withCredentials,xhr.headers,xhr.body===form],['POST','/api/visit-files',true,true,{'x-request-id':'r1'},true],'sent asynchronously with its headers, its body and the cookie it asked for');
 eq(seen,[{phase:'uploading',loaded:0,total:null,percent:null}],'the upload starts at nothing');
 xhr.progress(50,200);xhr.progress(250,200);xhr.progress(-5,0,false);xhr.progress(10,0,true);
 eq(seen.slice(1),[{phase:'uploading',loaded:50,total:200,percent:25},{phase:'uploading',loaded:250,total:200,percent:100},{phase:'uploading',loaded:0,total:null,percent:null},{phase:'uploading',loaded:10,total:null,percent:null}],'percentages clamped; an unknown or zero total has none');
 xhr.uploaded();
 eq(seen.at(-1),{phase:'processing',loaded:10,total:null,percent:null},'once sent, the server is processing');
 xhr.respond(200,JSON.stringify({id:'file-1',name:'عرض.pdf'}),'https://crm.yourrest.org/api/visit-files');
 eq(await pending,{id:'file-1',name:'عرض.pdf'},'the server\'s answer');
 const count=seen.length;xhr.progress(1,2);eq(seen.length,count,'nothing is reported after the answer');
 eq(timers.size,0,'the deadline is cleared');

 const plain=C.submitJson('/api/visit-files',{body:'x'},{onUploadProgress:()=>{}});await settle();
 const second=xhrs.at(-1);
 eq([second.method,second.withCredentials,second.body],['POST',false,'x'],'POST by default; no cookie unless asked for');
 second.respond(302,'{}','https://crm.yourrest.org/login');
 eq((await failure(plain)).status,401,'sent to the sign-in page');
 const empty=C.submitJson('/api/visit-files',{method:'PUT'},{onUploadProgress:()=>{}});await settle();
 eq([xhrs.at(-1).method,xhrs.at(-1).body],['PUT',null],'the method given; no body is null');
 xhrs.at(-1).respond(413,'<html>Request Entity Too Large</html>');
 let error=await failure(empty);
 eq([error.message,error.status,error.invalidResponse],[INVALID[0],413,true],'a page of the host for a body too large');
 const refused=C.submitJson('/api/visit-files',{},{onUploadProgress:()=>{},language:'en'});await settle();
 xhrs.at(-1).respond(400,JSON.stringify({error:'الملف ليس PDF'}));
 eq([(error=await failure(refused)).message,error.status],['الملف ليس PDF',400],'the server\'s refusal');
 const lost=C.submitJson('/api/visit-files',{},{onUploadProgress:()=>{},language:'en'});await settle();
 xhrs.at(-1).onerror();
 eq((await failure(lost)).message,OFFLINE[1],'a network error is «no connection»');
 const stopped=C.submitJson('/api/visit-files',{},{onUploadProgress:()=>{}});await settle();
 xhrs.at(-1).onabort();
 eq((await failure(stopped)).name,'AbortError','the browser aborted the upload');
 const broken=new Error('send refused');
 globalThis.XMLHttpRequest=class extends FakeXHR{constructor(){super();this.throwOnSend=broken;}};
 eq(await failure(C.submitJson('/api/visit-files',{},{onUploadProgress:()=>{}})),broken,'a send that throws is that error');
 globalThis.XMLHttpRequest=FakeXHR;
 const controller=new AbortController();const reports=[];
 const cancelled=C.submitJson('/api/visit-files',{signal:controller.signal},{onUploadProgress:value=>reports.push(value.phase)});await settle();
 const third=xhrs.at(-1);controller.abort();
 eq([(await failure(cancelled)).name,third.aborted],['AbortError',true],'a cancel aborts the upload');
 third.uploaded();third.progress(5,10);eq(reports,['uploading'],'and nothing is reported after it');
 const slow=C.submitJson('/api/visit-files',{},{onUploadProgress:()=>{},timeout:45000});await settle();
 const fourth=xhrs.at(-1);eq([...timers.values()].map(timer=>timer.delay),[45000],'the upload\'s own deadline');
 fireAll();
 eq([(error=await failure(slow)).message,fourth.aborted],[TIMEOUT[0],true],'the deadline aborts the upload and says so');
 delete globalThis.XMLHttpRequest;
 serve(()=>json({id:'f',name:'n',ok:true}));const progressless=[];
 eq((await C.submitJson('/api/visit-files',{},{onUploadProgress:value=>progressless.push(value)})).id,'f','without XMLHttpRequest the upload uses fetch');
 eq(progressless,[],'and reports no progress');
});

console.log(JSON.stringify({ok:true,checks,counts,realBrowser:false,network:false}));
