// Tests the actual ZIP in isolation (node tests/package-install.mjs <archive>; default ../Yourrest-CRM-Namecheap.zip from
// scripts/package-namecheap.py). Never the live Site. The package carries no customer data (the owner, 2026-11-16): a first
// installation is empty with its owner, or loads a MADE-UP initial data file placed by hand (tests/fixtures/made-up-seed.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createServer,request} from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {madeUpSnapshot,writeSeed} from './fixtures/made-up-seed.js';
const archive=path.resolve(process.argv[2]||'../Yourrest-CRM-Namecheap.zip');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-package-')),app=path.join(work,'yourrest-crm');
let child,checks=0;const check=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
function attempt(args,cwd=app){const r=spawnSync(process.execPath,args,{cwd,encoding:'utf8',env:{PATH:process.env.PATH}});return{status:r.status,output:r.stdout+r.stderr,json:()=>JSON.parse(r.stdout.trim().split('\n').at(-1))};}
function run(args,cwd=app){const r=attempt(args,cwd);assert.equal(r.status,0,r.output);return r.json();}
function extract(into){fs.mkdirSync(into,{recursive:true,mode:0o700});const extracted=spawnSync('unzip',['-q',archive,'-d',into],{encoding:'utf8'});check(extracted.status,0,extracted.stderr);}
try{
 const entries=spawnSync('unzip',['-Z1',archive],{encoding:'utf8'}).stdout.trim().split('\n');
 check(entries.filter(name=>/(^|\/)migration\/|initial\.(json|sha256)$|-(Revised|Full)-Source-.*\.zip$/.test(name)),[],'no initial data and no source upload in the package');
 extract(app);
 for(const line of fs.readFileSync(path.join(app,'PACKAGE-CONTENTS.sha256'),'utf8').trim().split('\n')){const [hash,filename]=line.split('  ');assert.equal(createHash('sha256').update(fs.readFileSync(path.join(app,filename))).digest('hex'),hash,filename);}checks++;
 const migrations=fs.readdirSync(path.join(app,'release/drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).length;assert(migrations>0);checks++;
 const settings=path.join(app,'settings.cjs'),data=path.join(work,'yourrest-crm-data'),database=path.join(data,'database.sqlite');
 // Without initial data and without an owner nothing is written.
 const refused=attempt(['setup.cjs']);check(refused.status,1);assert.match(refused.output,/--owner-email=name@yourrest\.org/);checks++;
 check(fs.existsSync(settings),false);check(fs.existsSync(data),false);
 const first=run(['setup.cjs','--owner-email=owner@yourrest.org']);check(first.ok,true);check(first.newDatabase,true);check(first.initialData,'none');check(first.counts.crm_members,1);check(first.counts.crm_records,0);check(first.counts.crm_visit_numbers,0);check(first.migrations,migrations);
 check(fs.statSync(settings).mode&0o777,0o600);check(fs.statSync(data).mode&0o777,0o700);check(fs.statSync(database).mode&0o777,0o600);
 const originalSettings=fs.readFileSync(settings,'utf8'),db=new DatabaseSync(database);db.exec("UPDATE crm_members SET target=987654 WHERE id='owner'");db.close();
 const second=run(['setup.cjs']);check(second.newDatabase,false);check(second.counts,first.counts);check(fs.readFileSync(settings,'utf8'),originalSettings);
 const verified=new DatabaseSync(database);check(verified.prepare('SELECT COUNT(*) AS n FROM crm_members WHERE target=987654').get().n,1);check(verified.prepare('PRAGMA integrity_check').get().integrity_check,'ok');check(verified.prepare('PRAGMA foreign_key_check').all(),[]);verified.close();
 const backup=path.join(work,'backup'),backed=run(['release/operations/backup.mjs',backup]);check(backed.ok,true);const copy=new DatabaseSync(path.join(backup,'database.sqlite'));check(copy.prepare('SELECT COUNT(*) AS n FROM crm_records').get().n,0);check(copy.prepare('SELECT COUNT(*) AS n FROM crm_members WHERE target=987654').get().n,1);copy.close();
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));let logs='';
 child=spawn(process.execPath,['app.cjs'],{cwd:app,env:{PATH:process.env.PATH,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 const get=url=>new Promise((resolve,reject)=>{const r=request({hostname:'127.0.0.1',port,path:url,headers:{Host:'crm.yourrest.org','X-Forwarded-Proto':'https'},timeout:5000},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text}));});r.on('error',reject);r.on('timeout',()=>r.destroy(Error('timeout')));r.end();});
 let ready=false;for(let n=0;n<100;n++){if(child.exitCode!==null)throw Error('App exited: '+logs);try{const r=await get('/login');check(r.status,200);ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
 assert(ready,'Packaged app failed to start');checks++;
 check((await get('/api/crm')).status,401);check((await get('/settings.cjs')).status,404);check((await get('/migration/initial.json')).status,404);check((await get('/source/package.json')).status,404);
 child.kill();await once(child,'exit');
 // An initial data file placed by hand (made-up records), on a second copy of the package: its checksum is checked first.
 const seededApp=path.join(work,'seeded','yourrest-crm');extract(seededApp);
 const made=madeUpSnapshot(path.join(seededApp,'release/drizzle')),seed=path.join(seededApp,'migration/initial.json'),checksum=path.join(seededApp,'migration/initial.sha256');
 writeSeed(made.snapshot,seed,checksum);const goodChecksum=fs.readFileSync(checksum);fs.writeFileSync(checksum,'f'.repeat(64)+'\n');
 const mismatch=attempt(['setup.cjs'],seededApp);check(mismatch.status,1);assert.match(mismatch.output,/checksum mismatch/);checks++;check(fs.existsSync(path.join(work,'seeded','yourrest-crm-data','database.sqlite')),false);
 fs.writeFileSync(checksum,goodChecksum);
 const both=attempt(['setup.cjs','--owner-email=owner@yourrest.org'],seededApp);check(both.status,1);assert.match(both.output,/initial data file/);checks++;
 const seeded=run(['setup.cjs'],seededApp);check(seeded.newDatabase,true);check(seeded.initialData,'file');
 for(const [table,count] of Object.entries(made.counts))check(seeded.counts[table],count,table);
 console.log(JSON.stringify({ok:true,checks,archive:path.basename(archive),actualPackage:true,noInitialDataInPackage:true,emptyInstallationWithOwner:true,handPlacedMadeUpSeed:true,repeatedSetupPreservesEdits:true,backupVerified:true,mailSent:false,realHostingTested:false}));
}catch(error){console.error(error.message);process.exitCode=1;}
finally{if(child&&child.exitCode===null&&child.signalCode===null){child.kill();await once(child,'exit');}fs.rmSync(work,{recursive:true,force:true});}
