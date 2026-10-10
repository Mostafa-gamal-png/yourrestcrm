// Tests the actual ZIP in isolation. Uses a copy of its initial data, never the live Site.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createServer,request} from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const archive=path.resolve(process.argv[2]||'../Yourrest-CRM-Namecheap.zip');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-package-')),app=path.join(work,'yourrest-crm');
let child,checks=0;const check=(a,b)=>{assert.deepEqual(a,b);checks++;};
function run(args){const r=spawnSync(process.execPath,args,{cwd:app,encoding:'utf8',env:{PATH:process.env.PATH}});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout.trim().split('\n').at(-1));}
try{
 fs.mkdirSync(app,{mode:0o700});const extracted=spawnSync('unzip',['-q',archive,'-d',app],{encoding:'utf8'});check(extracted.status,0);
 for(const line of fs.readFileSync(path.join(app,'PACKAGE-CONTENTS.sha256'),'utf8').trim().split('\n')){const [hash,filename]=line.split('  ');assert.equal(createHash('sha256').update(fs.readFileSync(path.join(app,filename))).digest('hex'),hash,filename);}checks++;
 const first=run(['setup.cjs']);check(first.ok,true);check(first.newDatabase,true);check(first.counts.crm_members,3);check(first.counts.crm_records,2371);check(first.counts.crm_visit_numbers,2);check(first.migrations,13);
 const settings=path.join(app,'settings.cjs'),data=path.join(work,'yourrest-crm-data'),database=path.join(data,'database.sqlite');
 check(fs.statSync(settings).mode&0o777,0o600);check(fs.statSync(data).mode&0o777,0o700);check(fs.statSync(database).mode&0o777,0o600);
 const originalSettings=fs.readFileSync(settings,'utf8'),db=new DatabaseSync(database);db.exec('UPDATE crm_members SET target=987654 WHERE id=(SELECT id FROM crm_members ORDER BY id LIMIT 1)');db.close();
 const second=run(['setup.cjs']);check(second.newDatabase,false);check(second.counts,first.counts);check(fs.readFileSync(settings,'utf8'),originalSettings);
 const verified=new DatabaseSync(database);check(verified.prepare('SELECT COUNT(*) AS n FROM crm_members WHERE target=987654').get().n,1);check(verified.prepare('PRAGMA integrity_check').get().integrity_check,'ok');check(verified.prepare('PRAGMA foreign_key_check').all(),[]);verified.close();
 const backup=path.join(work,'backup'),backed=run(['release/operations/backup.mjs',backup]);check(backed.ok,true);const copy=new DatabaseSync(path.join(backup,'database.sqlite'));check(copy.prepare('SELECT COUNT(*) AS n FROM crm_records').get().n,2371);check(copy.prepare('SELECT COUNT(*) AS n FROM crm_members WHERE target=987654').get().n,1);copy.close();
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));let logs='';
 child=spawn(process.execPath,['app.cjs'],{cwd:app,env:{PATH:process.env.PATH,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 const get=url=>new Promise((resolve,reject)=>{const r=request({hostname:'127.0.0.1',port,path:url,headers:{Host:'crm.yourrest.org','X-Forwarded-Proto':'https'},timeout:5000},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text}));});r.on('error',reject);r.on('timeout',()=>r.destroy(Error('timeout')));r.end();});
 let ready=false;for(let n=0;n<100;n++){if(child.exitCode!==null)throw Error('App exited: '+logs);try{const r=await get('/login');check(r.status,200);ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
 assert(ready,'Packaged app failed to start');checks++;
 check((await get('/api/crm')).status,401);check((await get('/settings.cjs')).status,404);check((await get('/migration/initial.json')).status,404);check((await get('/source/package.json')).status,404);
 console.log(JSON.stringify({ok:true,checks,archive: path.basename(archive),actualPackage:true,initialDataPreserved:true,repeatedSetupPreservesEdits:true,backupVerified:true,mailSent:false,realHostingTested:false}));
}catch(error){console.error(error.message);process.exitCode=1;}
finally{if(child&&child.exitCode===null){child.kill();await once(child,'exit');}fs.rmSync(work,{recursive:true,force:true});}
