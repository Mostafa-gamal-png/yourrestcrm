// Controlled transport events exercise the real client, without timers simulating progress.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
const compiler={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX};
const clientSource=process.env.YR_UPLOAD_SOURCE_REV?execFileSync('git',['show',process.env.YR_UPLOAD_SOURCE_REV+':lib/client-submit.ts'],{encoding:'utf8'}):fs.readFileSync('lib/client-submit.ts','utf8');
const source=ts.transpileModule(clientSource,{compilerOptions:compiler}).outputText;
let checks=0;
const plain=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const eq=(a,b,label)=>{assert.deepEqual(plain(a),plain(b),label);checks++;};
const ok=(a,label)=>{assert.ok(a,label);checks++;};
function setup(){
 const requests=[],updates=[],timers=new Map();let tick=0,fetchCalls=0;
 class XHR{upload={};headers={};responseURL='https://crm.yourrest.org/api/sales/import';status=200;responseText='{"ok":true,"id":"receipt"}';constructor(){requests.push(this);}open(method,url){this.method=method;this.url=url;}setRequestHeader(key,value){this.headers[key]=value;}send(body){this.body=body;}abort(){this.aborted=true;this.onabort?.();}}
 const exports={};vm.runInNewContext(source,{exports,Headers,URL,Promise,Error,TypeError,AbortController,XMLHttpRequest:XHR,window:{location:{origin:'https://crm.yourrest.org'}},fetch:async()=>{fetchCalls++;return{ok:true,status:200,json:async()=>({ok:true,id:'fallback'})};},setTimeout:fn=>{const id=++tick;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
 return{...exports,requests,updates,timers,fetchCalls:()=>fetchCalls,expire:()=>[...timers.values()].forEach(fn=>fn()),options:{language:'en',onUploadProgress:progress=>updates.push(progress)}};
}
let h=setup(),settled=false;
const body='{"action":"commit","requestId":"frozen"}',pending=h.submitJson('/api/sales/import',{method:'POST',headers:{'Content-Type':'application/json'},body},h.options).then(value=>{settled=true;return value;});
eq(h.requests.length,1,'Progress-enabled uploads use observable transport');eq(h.fetchCalls(),0);const request=h.requests[0];eq(request.body,body,'Serialized idempotent request is not altered');eq(request.headers['content-type'],'application/json');eq(request.withCredentials,false,'Same-origin cookies use the browser default');eq(h.updates[0],{phase:'uploading',loaded:0,total:null,percent:null},'Unknown total is never a guessed percentage');
request.upload.onprogress({loaded:50,total:200,lengthComputable:true});eq(h.updates.at(-1).percent,25,'Percentage comes from actual bytes');request.upload.onprogress({loaded:99,total:0,lengthComputable:false});eq(h.updates.at(-1).percent,null,'Non-computable progress stays indeterminate');request.upload.onprogress({loaded:250,total:200,lengthComputable:true});eq(h.updates.at(-1).percent,100,'Visual value is bounded');
request.upload.onload();await Promise.resolve();eq(h.updates.at(-1).phase,'processing');eq(h.updates.at(-1).percent,null);eq(settled,false,'Finishing the upload cannot confirm the server write');request.onload();eq(await pending,{ok:true,id:'receipt'});eq(h.timers.size,0);const count=h.updates.length;request.upload.onprogress({loaded:1,total:1,lengthComputable:true});eq(h.updates.length,count,'Late progress cannot overwrite a receipt');
for(const scenario of ['network','html','rejected','login','false']){
 h=setup();const value=h.submitJson('/api/sales/import',{method:'POST',body},h.options);const xhr=h.requests[0];
 if(scenario==='network')xhr.onerror();else{if(scenario==='html'){xhr.status=502;xhr.responseText='<html>hosting error</html>';}if(scenario==='rejected'){xhr.status=403;xhr.responseText='{"error":"Permission denied"}';}if(scenario==='login')xhr.responseURL='https://crm.yourrest.org/login';if(scenario==='false')xhr.responseText='{"ok":false}';xhr.onload();}
 let error;try{await value;}catch(e){error=e;}ok(error instanceof h.SubmitError,'Failures remain actionable SubmitError '+scenario);eq(h.updates.some(progress=>progress.phase==='complete'),false,'Transport never reports success '+scenario);eq(h.timers.size,0);if(scenario==='rejected'){eq(error.status,403);eq(h.definiteSubmitRejection(error),true);}if(scenario==='login')eq(error.status,401);if(scenario==='html')ok(!error.message.includes('<html>'));
}
h=setup();const timed=h.submitJson('/api/sales/import',{method:'POST',body},h.options);h.expire();await assert.rejects(timed,/timed out/);checks++;eq(h.requests[0].aborted,true);eq(h.timers.size,0);
h=setup();const controller=new AbortController(),canceled=h.submitJson('/api/sales/import',{method:'POST',body,signal:controller.signal},h.options);controller.abort();await assert.rejects(canceled,error=>error.name==='AbortError');checks++;eq(h.requests[0].aborted,true);eq(h.timers.size,0);
h=setup();eq(await h.submitJson('/api/crm',{method:'GET'}),{ok:true,id:'fallback'},'Unrelated saves/read calls retain fetch');eq(h.requests.length,0);

const uiSource=ts.transpileModule(fs.readFileSync('app/upload-status.tsx','utf8'),{compilerOptions:compiler}).outputText;
const nodes=(tree,p)=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(item=>nodes(item,p)):[...(p(tree)?[tree]:[]),...nodes(tree.props?.children,p)];
const text=tree=>tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree):Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);
for(const language of ['ar','en']){
 const exports={};vm.runInNewContext(uiSource,{exports,require:name=>name==='react/jsx-runtime'?jsx:name==='@/lib/i18n'?{useLanguage:()=>({language})}:new Proxy({},{get:()=>()=>null})});
 let tree=exports.default({state:{phase:'uploading',loaded:54,total:100,percent:54.7},fileName:'report.xlsx'});eq(nodes(tree,n=>n.props?.role==='progressbar')[0].props['aria-valuenow'],54);ok(text(tree).includes('54%'));ok(text(tree).includes('report.xlsx'));
 tree=exports.default({state:{phase:'processing',loaded:100,total:100,percent:null}});eq(nodes(tree,n=>n.props?.role==='progressbar')[0].props['aria-valuenow'],undefined,'Processing is semantically indeterminate');eq(text(tree).includes('%'),false);eq(tree.props['aria-busy'],true);
 tree=exports.default({state:{phase:'queued'}});eq(tree.props['aria-busy'],false);eq(nodes(tree,n=>n.props?.role==='progressbar').length,0);ok(text(tree).includes(language==='ar'?'بانتظار الرفع':'awaiting upload'));
 let retries=0;tree=exports.default({state:{phase:'error',message:'Connection failed'},onRetry:()=>retries++});nodes(tree,n=>n.type==='button')[0].props.onClick();eq(retries,1);eq(nodes(tree,n=>n.props?.role==='alert').length,1);
 tree=exports.default({state:{phase:'complete'},completeLabel:language==='ar'?'اكتمل الاستيراد':'Import complete'});eq(nodes(tree,n=>n.props?.role==='progressbar').length,0);ok(text(tree).includes(language==='ar'?'اكتمل الاستيراد':'Import complete'));
}
console.log(JSON.stringify({ok:true,checks,coverage:'Real XHR event boundary, bytes/processing/ACK, error/session/timeout/abort, accessible upload phases in AR/EN',realBrowser:false}));
