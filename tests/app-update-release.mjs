import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,readdir,chmod,rm,writeFile} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {createServer,request} from 'node:http';
import {once} from 'node:events';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {sqliteDatabase} from '../portable/storage.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const release=path.join(root,'dist/standalone');
const work=await mkdtemp(path.join(os.tmpdir(),'yourrest-update-release-'));
const file=path.join(work,'database.sqlite'),objects=path.join(work,'objects');
let child,db,log='',checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
try{
 await mkdir(objects,{mode:0o700});db=sqliteDatabase(file,{create:true});await chmod(file,0o600);
 await db.exec('CREATE TABLE yr_schema_migrations(name TEXT PRIMARY KEY NOT NULL,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)');
 for(const name of (await readdir(path.join(root,'drizzle'))).filter(n=>/^\d+.*\.sql$/.test(n)).sort()){
  const sql=await readFile(path.join(root,'drizzle',name),'utf8');await db.exec(sql);
  await db.prepare('INSERT INTO yr_schema_migrations VALUES(?,?,?)').bind(name,createHash('sha256').update(sql).digest('hex'),new Date().toISOString()).run();
 }
 await db.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,active,target,created_at,region_scope) VALUES(?,?,?,?,?,?,1,0,?,?)').bind('owner','update-qa-owner','qa@yourrest.org','Synthetic test owner','admin','Main',new Date().toISOString(),'all').run();
 await db.prepare('INSERT INTO crm_settings(id,owner_id) VALUES(?,?)').bind('company','update-qa-owner').run();
 const portServer=createServer();portServer.listen(0,'127.0.0.1');await once(portServer,'listening');const port=portServer.address().port;await new Promise(r=>portServer.close(r));
 child=spawn(process.execPath,['app.cjs'],{cwd:release,env:{...process.env,NODE_ENV:'production',PORT:String(port),HOST:'127.0.0.1',YR_APP_ORIGIN:'https://crm.yourrest.org',YR_DATABASE_PATH:file,YR_OBJECTS_PATH:objects,YR_AUTH_SECRET:randomBytes(32).toString('hex')},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 const get=(url,method='GET')=>new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port,path:url,method,headers:{Host:'crm.yourrest.org','X-Forwarded-Proto':'https'}},res=>{const parts=[];res.on('data',b=>parts.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(parts)}));});req.on('error',reject);req.end();});
 let response;for(let n=0;n<100;n++){if(child.exitCode!==null)throw Error(log);try{response=await get('/api/app-update');if(response.status===200)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 eq(response?.status,200);assert.match(response.headers['cache-control'],/no-store/);checks++;
 const manifest=JSON.parse(response.bytes),expected=JSON.parse(await readFile(path.join(root,'lib/app-update-release.json'),'utf8'));eq(manifest,expected);eq(manifest.packageName,'org.yourrest.crm');assert.match(manifest.versionName,/^\d+\.\d+\.\d+$/);assert.ok(Number.isInteger(manifest.versionCode)&&manifest.versionCode>=11);eq(new URL(manifest.apkUrl).pathname,`/downloads/yourrest-crm-android-v${manifest.versionName}-${manifest.versionCode}.apk`);checks+=3;
 for(const url of [new URL(manifest.apkUrl).pathname,'/downloads/yourrest-crm-android.apk']){const apk=await get(url);eq(apk.status,200);eq(apk.bytes.length,manifest.sizeBytes);eq(createHash('sha256').update(apk.bytes).digest('hex'),manifest.sha256);}
 eq((await get('/login')).status,200);eq((await get('/api/app-update','POST')).status,405);
 const result={ok:true,checks,actualBuiltHttpServer:true,anonymousUpdateMetadata:true,cacheControl:response.headers['cache-control'],versionCode:manifest.versionCode,versionName:manifest.versionName,apkSha256:manifest.sha256,physicalAndroidTested:false,productionModified:false};
 await writeFile(path.join(root,'docs/APP-UPDATE-HTTP-VERIFICATION.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited.catch(()=>{});}db?.close?.();await rm(work,{recursive:true,force:true});}
