// Real handler, multipart streams, authorization helpers and migrated SQLite.
// Identity and object storage are isolated fixtures; no network or real files.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import assert from 'node:assert/strict';
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'upload-admission-')),seen=new Set();
const pending=new Set(),streamCleanup=new Set(),writeCleanup=new Set();let checks=0;
const identity=new AsyncLocalStorage();globalThis.uploadTestIdentity=identity;
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const within=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Fixture phase timed out')),3000))]);}finally{clearTimeout(timer);}};
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.uploadTestEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),'export async function getApplicationUser(){return globalThis.uploadTestIdentity.getStore()||null;}');
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';
  compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));
 });fs.writeFileSync(dest,code);
}
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
try{
 compile('app/api/visit-files/route.ts');
 for(const name of fs.readdirSync('drizzle').filter(name=>name.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+name,'utf8'));
 class Statement{
  constructor(query,args=[]){this.query=query;this.args=args;}
  bind(...args){return new Statement(this.query,args);}
  async first(){return sql.prepare(this.query).get(...this.args)||null;}
  async all(){return{results:sql.prepare(this.query).all(...this.args)};}
  async run(){return{meta:{changes:Number(sql.prepare(this.query).run(...this.args).changes)}};}
 }
 const objects=new Map();let holdWrites=null,failWrite=false;
 const FILES={put:async(key,bytes)=>{if(holdWrites){const wait=deferred();writeCleanup.add(wait.resolve);holdWrites.push(wait);await wait.promise;writeCleanup.delete(wait.resolve);}if(failWrite){failWrite=false;throw Error('Fixture object write failed');}objects.set(key,new Uint8Array(bytes));},delete:async key=>objects.delete(key)};
 globalThis.uploadTestEnv={DB:{prepare:query=>new Statement(query)},FILES,YR_APP_ORIGIN:'https://test.invalid'};
 const now=new Date().toISOString();
 sql.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,region_scope,active,target,created_at) VALUES('rep','u-rep','rep@yourrest.org','Fixture rep','rep','Main','eastern',1,0,?)").run(now);
 sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('customer','customer',NULL,'rep','Main',?,?,?,1,'fixture')").run(JSON.stringify({name:'Fixture customer',region:'الشرقية'}),now,now);
 const actor={userId:'u-rep',email:'rep@yourrest.org',memberId:'rep',memberVersion:1,provider:'email-otp'};
 const route=await import(path.join(out,'app/api/visit-files/route.mjs'));
 const send=(request,user=actor)=>{const task=identity.run(user,()=>route.POST(request));pending.add(task);task.finally(()=>pending.delete(task));return task;};
 async function multipart(key=crypto.randomUUID(),options={}){
  const form=new FormData();form.set('file',new File(['%PDF-1.7 fixture'],'quote.pdf',{type:'application/pdf'}));form.set('customerId',options.customerId||'customer');form.set('uploadKey',key);form.set('memberId','rep');
  const wire=new Request('https://test.invalid/api/visit-files',{method:'POST',body:form}),bytes=new Uint8Array(await wire.arrayBuffer()),started=deferred(),held=deferred();
  let controller,reads=0,cancelled=false,closed=false;
  const finish=()=>{if(closed)return;closed=true;try{controller.enqueue(bytes.subarray(bytes.length-2));controller.close();}catch{}held.resolve();};
  const stream=new ReadableStream({start(c){controller=c;},pull(c){reads++;if(reads===1){c.enqueue(options.pause?bytes.subarray(0,bytes.length-2):bytes);started.resolve();if(!options.pause){closed=true;c.close();}}else return held.promise;},cancel(){cancelled=true;closed=true;held.resolve();}},{highWaterMark:0});
  streamCleanup.add(finish);
  return{key,request:new Request('https://test.invalid/api/visit-files',{method:'POST',headers:{origin:options.origin||'https://test.invalid','content-type':wire.headers.get('content-type')},body:stream,duplex:'half'}),started:started.promise,finish,reads:()=>reads,cancelled:()=>cancelled};
 }
 const fileCount=()=>sql.prepare('SELECT COUNT(*) n FROM crm_visit_files').get().n;
 async function succeeds(sample){const response=await within(send(sample.request));check(response.status,200);return response.json();}
 // Two slow uploads may be in progress. A third must not buffer its body.
 const first=await multipart(undefined,{pause:true}),second=await multipart(undefined,{pause:true});
 const firstResult=send(first.request),secondResult=send(second.request);await within(Promise.all([first.started,second.started]));
 const rejected=await multipart(),response=await within(send(rejected.request));
 check(response.status,429,'Third upload must be rejected before body consumption');
 check(rejected.reads(),0,'Overload cannot allocate multipart buffers');check(rejected.cancelled(),true,'Rejected upload stream must be cancelled');
 check(response.headers.get('Retry-After'),'2');check(response.headers.get('Cache-Control'),'private, no-store');check(fileCount(),0);
 const anonymous=await multipart();check((await within(send(anonymous.request,null))).status,401,'Authentication precedes admission even while full');check(anonymous.reads(),0);
 const crossOrigin=await multipart(undefined,{origin:'https://untrusted.test'});check((await within(send(crossOrigin.request))).status,403);check(crossOrigin.reads(),0);
 first.finish();check((await within(firstResult)).status,200);second.finish();check((await within(secondResult)).status,200);
 const retried=await succeeds(await multipart(rejected.key));check(fileCount(),3);const replayed=await succeeds(await multipart(rejected.key));check(replayed.id,retried.id);check(replayed.alreadySaved,true);check(fileCount(),3,'Retry creates exactly one file');
 // Slots cover durable object writing too, not just request parsing.
 holdWrites=[];const writingA=send((await multipart()).request),writingB=send((await multipart()).request);
 await within((async()=>{while(holdWrites.length<2)await new Promise(resolve=>setImmediate(resolve));})());
 const waiting=holdWrites;holdWrites=null;
 const thirdWrite=await multipart();check((await within(send(thirdWrite.request))).status,429);check(thirdWrite.reads(),0);
 waiting[0].resolve();check((await within(writingA)).status,200);waiting[1].resolve();check((await within(writingB)).status,200);await succeeds(await multipart(thirdWrite.key));
 // Validation and storage failure must release their slots; no restart needed.
 let result=await within(send(new Request('https://test.invalid/api/visit-files',{method:'POST',headers:{origin:'https://test.invalid','content-type':'multipart/form-data; boundary=missing'},body:'broken'})));check(result.status,400);
 result=await within(send((await multipart('not-a-uuid')).request));check(result.status,400);
 result=await within(send((await multipart(undefined,{customerId:'unavailable'})).request));check(result.status,403);
 failWrite=true;const originalError=console.error;console.error=()=>{};
 try{result=await within(send((await multipart()).request));check(result.status,500);}finally{console.error=originalError;}
 const finalA=await multipart(undefined,{pause:true}),finalB=await multipart(undefined,{pause:true});
 const finalResultA=send(finalA.request),finalResultB=send(finalB.request);await within(Promise.all([finalA.started,finalB.started]));
 const overflow=await multipart();check((await within(send(overflow.request))).status,429);check(overflow.reads(),0);
 finalA.finish();finalB.finish();check((await within(finalResultA)).status,200);check((await within(finalResultB)).status,200);check(objects.size,fileCount(),'All committed object references survive failure and retry');
 console.log(JSON.stringify({ok:true,checks,coverage:'paused multipart and object writes; overload no-read/cancel; authentication; idempotent retry; success and error slot release',productionDataUsed:false}));
}finally{
 for(const release of streamCleanup)release();for(const release of writeCleanup)release();
 await Promise.allSettled([...pending]);sql.close();fs.rmSync(out,{recursive:true,force:true});delete globalThis.uploadTestEnv;delete globalThis.uploadTestIdentity;
}
