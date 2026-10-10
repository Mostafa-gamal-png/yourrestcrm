// Execute the public authentication handler with hostile Web Request streams.
// Only time is accelerated; parsing, byte limits and cancellation are real.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const work=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-auth-body-'));
const realSetTimeout=globalThis.setTimeout,realClearTimeout=globalThis.clearTimeout;
const origin='https://crm.yourrest.org';
let checks=0,databaseCalls=0,scheduled=[];
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const database={prepare(){databaseCalls++;throw Error('Malformed bodies must not reach the database');}};
const config={origin,secret:'a'.repeat(64),deliveryReady:true,clientKey:()=> 'synthetic-client',send:async()=>{throw Error('No mail expected');}};
try{
 const file=path.join(work,'auth.mjs');
 await build({entryPoints:['lib/email-auth.ts'],outfile:file,bundle:true,platform:'node',format:'esm',target:'node22',logLevel:'silent'});
 const {handleEmailAuth}=await import(pathToFileURL(file));
 globalThis.setTimeout=(callback,milliseconds,...args)=>{
  scheduled.push(milliseconds);
  return realSetTimeout(callback,Math.min(milliseconds,5),...args);
 };
 async function request(body,headers={}){
  const req=new Request(origin+'/api/auth/request',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body,duplex:'half'});
  const operation=handleEmailAuth(req,'request',database,config);
  let watchdog;
  try{return await Promise.race([operation,new Promise(resolve=>{watchdog=realSetTimeout(()=>resolve(null),200);})]);}
  finally{realClearTimeout(watchdog);}
 }
 function rejected(response,message){
  assert(response instanceof Response,message);checks++;
  eq(response.status,400,message);
  assert.match(response.headers.get('Cache-Control'),/no-store/);checks++;
 }
 let stalledController,cancelled=false;
 const stalled=new ReadableStream({start(controller){stalledController=controller;},cancel(){cancelled=true;}});
 let result=await request(stalled);
 if(!result)stalledController.close();
 rejected(result,'An unfinished anonymous auth body must terminate within its application deadline');
 eq(cancelled,true,'The timed-out body is cancelled');
 assert(scheduled.some(ms=>ms>0&&ms<=10_000),'The body deadline is at most ten seconds');checks++;
 eq(stalled.locked,false,'The reader lock is released after timeout');

 cancelled=false;
 const oversized=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(2049));},cancel(){cancelled=true;return new Promise(()=>{});}});
 rejected(await request(oversized),'Cancellation cannot prevent rejection of an oversized body');
 eq(cancelled,true);eq(oversized.locked,false);

 const declared=new ReadableStream({pull(){throw Error('Oversized declared body must not be read');},cancel(){cancelled=true;}},{highWaterMark:0});
 cancelled=false;
 rejected(await request(declared,{'Content-Length':'2049'}),'Oversized declared bodies are rejected without buffering');
 eq(cancelled,true);
 rejected(await request('{'),'Broken JSON is rejected');
 rejected(await request('[]'),'Array input is rejected');
 // A malformed UTF-8 byte must never be silently replaced inside an auth value.
 rejected(await request(new Uint8Array([123,34,101,109,97,105,108,34,58,34,255,34,125])),'Malformed UTF-8 is rejected');
 rejected(await request('{}',{'Content-Encoding':'gzip'}),'Encoded input is rejected before authentication');
 eq(databaseCalls,0,'Rejected bodies do not create rate-limit, challenge or session records');
 console.log(JSON.stringify({ok:true,checks,coverage:'anonymous stalled/chunked/declared/malformed bodies, cancellation, auth side effects',networkUsed:false}));
}finally{
 globalThis.setTimeout=realSetTimeout;globalThis.clearTimeout=realClearTimeout;
 fs.rmSync(work,{recursive:true,force:true});
}
