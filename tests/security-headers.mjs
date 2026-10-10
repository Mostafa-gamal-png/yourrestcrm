// Real startup wrapper and HTTP responses, with only application rendering and
// database upgrade stubbed. No production storage, DNS or mailbox is accessed.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {request} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,mkdir,copyFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const root=path.resolve(import.meta.dirname,'..');
const work=await mkdtemp(path.join(os.tmpdir(),'yourrest-response-headers-'));
let child,checks=0;
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
try{
 const release=path.join(work,'release'),data=path.join(work,'data');
 await mkdir(release,{mode:0o700});await mkdir(data,{mode:0o700});
 await mkdir(path.join(release,'operations'),{mode:0o700});
 await mkdir(path.join(data,'objects'),{mode:0o700});
 await writeFile(path.join(data,'database.sqlite'),'fixture',{mode:0o600});
 await copyFile(path.join(root,'portable/app.cjs'),path.join(release,'app.cjs'));
 await writeFile(path.join(release,'operations/upgrade.mjs'),'export async function upgradeExistingDatabase(){}',{mode:0o600});
 // Keep the fixture body useful: the framing-only CSP must not redesign how
 // React scripts, workers, local assets, styles and Google Maps links load.
 const document='<html><script>window.__fixture=true</script><script src="/client.js"></script><style>body{color:black}</style><a href="https://www.google.com/maps/dir/?api=1&amp;destination=24,46">Maps</a></html>';
 await writeFile(path.join(release,'server.js'),`const http=require('node:http');const server=http.createServer((req,res)=>{
  if(req.url==='/api/failure'){res.writeHead(500,{'Content-Type':'application/json','Cache-Control':'private, no-store'});res.end('{"error":"fixture"}');return;}
  if(req.url==='/sw.js'){res.writeHead(200,{'Content-Type':'application/javascript','Service-Worker-Allowed':'/'});res.end('self.addEventListener("fetch",()=>{});');return;}
  if(req.url==='/api/visit-files?id=fixture'){res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="fixture.pdf"','Cache-Control':'private, no-store'});res.end('%PDF-fixture');return;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(${JSON.stringify(document)});
 });server.listen(0,'127.0.0.1',()=>process.stdout.write('PORT='+server.address().port+'\\n'));`,{mode:0o600});
 child=spawn(process.execPath,['app.cjs'],{cwd:release,env:{PATH:process.env.PATH,YR_APP_ORIGIN:'https://crm.example.test',YR_DATABASE_PATH:path.join(data,'database.sqlite'),YR_OBJECTS_PATH:path.join(data,'objects'),YR_AUTH_SECRET:'a'.repeat(64)},stdio:['ignore','pipe','pipe']});
 const port=await new Promise((resolve,reject)=>{
  let output='';const timer=setTimeout(()=>reject(Error('Fixture did not start')),5000);
  child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/PORT=(\d+)/);if(match){clearTimeout(timer);resolve(Number(match[1]));}});
  child.once('exit',code=>{clearTimeout(timer);reject(Error('Fixture exited '+code));});
 });
 const get=(url,headers={})=>new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port,path:url,headers:{Host:'crm.example.test',...headers}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});req.on('error',reject);req.end();});
 function protectedResponse(result){
  check(result.headers['x-frame-options'],'DENY','Every response must reject framing, including same-site siblings');
  check(result.headers['content-security-policy'],"frame-ancestors 'none'; object-src 'none'; base-uri 'self'",'Minimal policy must not block existing scripts, maps, styles or workers');
  check(result.headers['x-content-type-options'],'nosniff');
  check(result.headers['referrer-policy'],'strict-origin-when-cross-origin','External map tiles retain the origin referrer without the customer URL');
 }
 for(const url of ['/login','/offline-app.html']){const result=await get(url);check(result.status,200);protectedResponse(result);check(result.body,document);}
 let result=await get('/api/failure');check(result.status,500);protectedResponse(result);check(result.headers['cache-control'],'private, no-store');
 result=await get('/sw.js',{'Sec-Fetch-Dest':'serviceworker'});check(result.status,200);protectedResponse(result);check(result.headers['service-worker-allowed'],'/');check(result.body,'self.addEventListener("fetch",()=>{});');
 result=await get('/api/visit-files?id=fixture');check(result.status,200);protectedResponse(result);check(result.headers['content-disposition'],'attachment; filename="fixture.pdf"');check(result.headers['cache-control'],'private, no-store');
 result=await get('/login',{Host:'untrusted.example.test'});check(result.status,421);protectedResponse(result);check(result.headers['cache-control'],'no-store');
 // No policy directive restricting the application's existing React/Leaflet
 // resources was introduced; tighter script-src needs a separate nonce design.
 check(/script-src|style-src|img-src|connect-src|worker-src|default-src/.test(result.headers['content-security-policy']),false);
 console.log(JSON.stringify({ok:true,checks,coverage:'runtime HTTP framing and response headers; normal/error/Host rejection/worker/attachment paths',physicalBrowserTested:false,productionDataUsed:false}));
}finally{if(child&&child.exitCode===null){child.kill();await once(child,'exit');}await rm(work,{recursive:true,force:true});}
