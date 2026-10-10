import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {mkdtemp,rm,mkdir,copyFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),work=await mkdtemp(path.join(os.tmpdir(),'yourrest-hosting-'));
let child,checks=0;
try{
 const net=createServer();net.listen(0,'127.0.0.1');await once(net,'listening');const port=net.address().port;await new Promise(r=>net.close(r));
 child=spawn(process.execPath,['portable/hosting-check.cjs'],{cwd:root,env:{PATH:process.env.PATH,PORT:String(port),YR_APP_ORIGIN:'https://crm.example.test'},stdio:'ignore'});
 let ready=false;for(let i=0;i<50;i++){try{await fetch('http://127.0.0.1:'+port);ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}}assert(ready);
 const request=(headers={},method='GET',suffix='')=>new Promise((resolve,reject)=>{
  const req=httpRequest('http://127.0.0.1:'+port+suffix,{headers:{Host:'crm.example.test',...headers},method},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body,headers:res.headers,json:()=>JSON.parse(body)}));});req.on('error',reject);req.end();
 });
 let r=await request();assert.equal(r.status,200);assert.equal(r.json().ok,true);assert.equal(r.json().https_verified,false);assert.equal(r.json().login_enabled,false);assert.equal(r.headers['cache-control'],'no-store');checks++;
 r=await request({'!~Passenger-Client-Address':'203.0.113.7','!~Passenger-Proto':'https'});assert.equal(r.json().https_verified,false);checks++;
 r=await request({'x-forwarded-for':'203.0.113.7','x-forwarded-proto':'https'});assert.equal(r.json().https_verified,false);checks++;
 r=await request({},'POST');assert.equal(r.status,405);checks++;
 r=await request({},'GET','/api/crm');assert.equal(r.status,404);checks++;
 r=await request({Host:'untrusted.test'});assert.equal(r.status,404);checks++;
 r=await request({},'HEAD');assert.equal(r.status,200);assert.equal(r.body,'');checks++;
 child.kill();await once(child,'exit');child=undefined;
 // Startup checks are isolated from the actual server, database and mailbox.
 const release=path.join(work,'release'),privateDir=path.join(work,'data');await mkdir(release,{mode:0o700});await mkdir(privateDir,{mode:0o700});
 await copyFile(path.join(root,'portable/app.cjs'),path.join(release,'app.cjs'));
 // Schema upgrades are tested with real SQLite in startup-upgrade.mjs; isolate host/path guards here.
 await mkdir(path.join(release,'operations'),{mode:0o700});
 await writeFile(path.join(release,'operations/upgrade.mjs'),"export async function upgradeExistingDatabase(){return {upgraded:false};}",{mode:0o600});
 await writeFile(path.join(release,'server.js'),"console.log('started:'+process.env.VINEXT_TRUSTED_HOSTS);",{mode:0o600});
 const database=path.join(privateDir,'database.sqlite'),objects=path.join(privateDir,'objects');await writeFile(database,'stub',{mode:0o600});await mkdir(objects,{mode:0o700});
 const base={PATH:process.env.PATH,YR_APP_ORIGIN:'https://crm.example.test',YR_DATABASE_PATH:database,YR_OBJECTS_PATH:objects,YR_AUTH_SECRET:'a'.repeat(64)};
 async function startup(extra){const proc=spawn(process.execPath,['app.cjs'],{cwd:release,env:{...base,...extra},stdio:['ignore','pipe','pipe']});let output='';proc.stdout.on('data',b=>output+=b);proc.stderr.on('data',b=>output+=b);const [code]=await once(proc,'exit');assert(!output.includes(base.YR_AUTH_SECRET));return{code,output};}
 let started=await startup({});assert.equal(started.code,0);assert(started.output.includes('started:crm.example.test'));checks++;
 for(const extra of [{YR_APP_ORIGIN:'http://crm.example.test'},{YR_AUTH_SECRET:'short'},{YR_APP_ORIGIN:'https://crm.example.test/'},{YR_DATABASE_PATH:'relative'},{YR_OBJECTS_PATH:release},{YR_DATABASE_PATH:''}]){const result=await startup(extra);assert.equal(result.code,1);assert(!result.output.includes('started:'));checks++;}
 await writeFile(path.join(release,'server.js'),"require('node:http').createServer((req,res)=>{res.writeHead(200);res.end('application');}).listen(Number(process.env.PORT),'127.0.0.1');",{mode:0o600});
 child=spawn(process.execPath,['app.cjs'],{cwd:release,env:{...base,PORT:String(port)},stdio:'ignore'});
 ready=false;for(let i=0;i<50;i++){try{await fetch('http://127.0.0.1:'+port);ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}}assert(ready);
 r=await request();assert.equal(r.status,200);assert.equal(r.body,'application');checks++;
 r=await request({Host:'CRM.EXAMPLE.TEST'});assert.equal(r.status,200);checks++;
 r=await request({'x-forwarded-host':'crm.example.test'});assert.equal(r.status,200);checks++;
 for(const headers of [{Host:'evil.example.test'},{Host:'evil.example.test','x-forwarded-host':'crm.example.test'},{'x-forwarded-host':'evil.example.test'},{'x-forwarded-host':'crm.example.test, evil.example.test'},{Host:'crm.example.test:444'}]){r=await request(headers);assert.equal(r.status,421);assert.notEqual(r.body,'application');assert.equal(r.headers['cache-control'],'no-store');checks++;}
 console.log(JSON.stringify({ok:true,checks,exposes_business_data:false,real_hosting_tested:false}));
}finally{if(child&&child.exitCode===null){child.kill();await once(child,'exit');}await rm(work,{recursive:true,force:true});}
