import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {sqliteDatabase,privateObjects} from '../portable/storage.mjs';
import {createBackup,verifyBackup,restoreBackup,scheduledBackup} from '../portable/backup-core.mjs';
const work=await fs.mkdtemp(path.join(os.tmpdir(),'yourrest-backup-test-')),appRoot=path.join(work,'application');
let db,checks=0;
const check=(a,b)=>{assert.deepEqual(a,b);checks++;};
const rejects=async operation=>{await assert.rejects(operation);checks++;};
const hash=value=>createHash('sha256').update(value).digest('hex');
try{
 await fs.mkdir(appRoot,{mode:0o700});const data=path.join(work,'data'),objectsPath=path.join(data,'objects');await fs.mkdir(data,{mode:0o700});
 db=sqliteDatabase(path.join(data,'database.sqlite'),{create:true});
 const migrations=path.resolve(import.meta.dirname,'../drizzle');
 await db.exec('CREATE TABLE yr_schema_migrations(name TEXT PRIMARY KEY,sha256 TEXT,applied_at TEXT)');
 for(const name of (await fs.readdir(migrations)).filter(name=>name.endsWith('.sql')).sort()){
  const text=await fs.readFile(path.join(migrations,name),'utf8');await db.exec(text);
  await db.prepare('INSERT INTO yr_schema_migrations VALUES(?,?,?)').bind(name,hash(text),new Date().toISOString()).run();
 }
 const objects=privateObjects(objectsPath),config={YR_DATABASE_PATH:path.join(data,'database.sqlite'),YR_OBJECTS_PATH:objectsPath};
 const addObject=async(key,bytes)=>{
  await objects.put(key,bytes);
  await db.prepare('INSERT INTO crm_visit_files(id,object_key,customer_id,name,content_type,size,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(key,key,'factory','quote.pdf','application/pdf',bytes.length,'rep','2026-10-01').run();
 };
 await addObject('competitor/one',Buffer.from('%PDF-first'));
 await objects.put('uncommitted',Buffer.from('must-not-be-copied'));
 const first=path.join(work,'backup-first'),result=await createBackup({config,appRoot,destination:first});
 check(result.objects,1);check((await verifyBackup({directory:first,appRoot})).objects,1);
 check(await fs.readdir(path.join(first,'objects')),[hash('competitor/one')]);
 check((await fs.stat(first)).mode&0o777,0o700);check((await fs.stat(path.join(first,'database.sqlite'))).mode&0o777,0o600);
 check((await fs.stat(path.join(first,'objects',hash('competitor/one')))).mode&0o777,0o600);
 await rejects(()=>createBackup({config,appRoot,destination:first}));
 const restored=path.join(work,'restored');await restoreBackup({directory:first,destination:restored,appRoot});
 check((await verifyBackup({directory:restored,appRoot})).objects,1);
 const reopened=new DatabaseSync(path.join(restored,'database.sqlite'),{readOnly:true});check(reopened.prepare('SELECT COUNT(*) n FROM crm_visit_files').get().n,1);reopened.close();
 check(await fs.readFile(path.join(restored,'objects',hash('competitor/one')),'utf8'),'%PDF-first');
 await rejects(()=>restoreBackup({directory:first,destination:restored,appRoot}));
 // Real writes after the online DB snapshot are excluded, with no interruption to live storage.
 const originalOpen=fs.open,sourceFile=path.join(objectsPath,hash('competitor/one'));let pausedResolve,resumeResolve,intercept=true;
 const paused=new Promise(resolve=>pausedResolve=resolve),resume=new Promise(resolve=>resumeResolve=resolve);
 fs.open=async function(filename,...args){if(filename===sourceFile&&intercept){intercept=false;pausedResolve();await resume;}return originalOpen.call(this,filename,...args);};
 const online=path.join(work,'backup-online');let running;
 try{
  running=createBackup({config,appRoot,destination:online});await paused;
  await rejects(()=>createBackup({config,appRoot,destination:path.join(work,'overlap')}));
  await addObject('competitor/two',Buffer.from('%PDF-second'));
  check(await db.prepare('SELECT COUNT(*) n FROM crm_visit_files').first('n'),2);
  resumeResolve();await running;
 }finally{resumeResolve();fs.open=originalOpen;}
 check((await verifyBackup({directory:online,appRoot})).objects,1);
 check(await fs.readdir(path.join(online,'objects')),[hash('competitor/one')]);
 // Missing live files fail closed, publish nothing, clean staging, and release the overlap lock.
 const secondSource=path.join(objectsPath,hash('competitor/two'));await fs.unlink(secondSource);
 const missing=path.join(work,'backup-missing');await rejects(()=>createBackup({config,appRoot,destination:missing}));
 await rejects(()=>fs.stat(missing));check((await fs.readdir(work)).some(name=>name.startsWith('.yourrest-backup-staging-')),false);
 await objects.put('competitor/two',Buffer.from('%PDF-second'));
 const third=path.join(work,'backup-third');await createBackup({config,appRoot,destination:third});check((await verifyBackup({directory:third,appRoot})).objects,2);
 // Object tampering, DB tampering, unexpected contents and malicious manifest paths are rejected.
 const corrupt=path.join(work,'corrupt');await fs.cp(first,corrupt,{recursive:true});
 await fs.writeFile(path.join(corrupt,'objects',hash('competitor/one')),'%PDF-wrong');await rejects(()=>verifyBackup({directory:corrupt,appRoot}));
 await rejects(()=>restoreBackup({directory:corrupt,destination:path.join(work,'bad-restore'),appRoot}));await rejects(()=>fs.stat(path.join(work,'bad-restore')));
 await fs.rm(corrupt,{recursive:true});await fs.cp(first,corrupt,{recursive:true});
 const handle=await fs.open(path.join(corrupt,'database.sqlite'),'r+');await handle.write(Buffer.from('WRONG'),0,5,0);await handle.close();await rejects(()=>verifyBackup({directory:corrupt,appRoot}));
 await fs.rm(corrupt,{recursive:true});await fs.cp(first,corrupt,{recursive:true});
 await fs.writeFile(path.join(corrupt,'unexpected'),'x',{mode:0o600});await rejects(()=>verifyBackup({directory:corrupt,appRoot}));
 await fs.unlink(path.join(corrupt,'unexpected'));
 const manifest=JSON.parse(await fs.readFile(path.join(corrupt,'manifest.json'),'utf8'));manifest.objects[0].filename='../outside';await fs.writeFile(path.join(corrupt,'manifest.json'),JSON.stringify(manifest));await rejects(()=>verifyBackup({directory:corrupt,appRoot}));
 const alias=path.join(work,'alias');await fs.symlink(first,alias);await rejects(()=>verifyBackup({directory:alias,appRoot}));
 const publicPath=path.join(work,'public_html');await fs.mkdir(publicPath,{mode:0o700});await rejects(()=>createBackup({config,appRoot,destination:path.join(publicPath,'backup')}));
 await rejects(()=>createBackup({config,appRoot,destination:path.join(data,'backup')}));
 await rejects(()=>restoreBackup({directory:first,destination:path.join(appRoot,'backup'),appRoot}));
 await fs.rename(secondSource,secondSource+'.safe');await fs.symlink(secondSource+'.safe',secondSource);await rejects(()=>createBackup({config,appRoot,destination:path.join(work,'link-file')}));await fs.unlink(secondSource);await fs.rename(secondSource+'.safe',secondSource);
 // Scheduled retention belongs to a marked private root and removes only verified owned backups.
 const backupRoot=path.join(work,'daily');await rejects(()=>scheduledBackup({config,appRoot,backupRoot,retain:1}));
 const scheduled1=await scheduledBackup({config,appRoot,backupRoot,retain:2});check(scheduled1.state,'ok');
 const unrelated=path.join(backupRoot,'yourrest-backup-unrelated');await fs.mkdir(unrelated,{mode:0o700});await fs.writeFile(path.join(unrelated,'keep'),'untouched',{mode:0o600});
 const foreign=path.join(backupRoot,'yourrest-backup-foreign');await fs.cp(first,foreign,{recursive:true});
 const broken=path.join(backupRoot,'yourrest-backup-corrupt');await fs.cp(path.join(backupRoot,scheduled1.backupName),broken,{recursive:true});await fs.unlink(path.join(broken,'objects',hash('competitor/one')));
 await scheduledBackup({config,appRoot,backupRoot,retain:2});const scheduled3=await scheduledBackup({config,appRoot,backupRoot,retain:2});check(scheduled3.removed,1);check(scheduled3.preservedUnverified,3);
 check(await fs.readFile(path.join(unrelated,'keep'),'utf8'),'untouched');check((await verifyBackup({directory:foreign,appRoot})).objects,1);check((await fs.stat(broken)).isDirectory(),true);
 const status=JSON.parse(await fs.readFile(path.join(backupRoot,'status.json'),'utf8'));check(status.state,'ok');check(status.backupName,scheduled3.backupName);
 const good=[];for(const name of await fs.readdir(backupRoot))if(name.startsWith('yourrest-backup-'))try{const verified=await verifyBackup({directory:path.join(backupRoot,name),appRoot,expectedRootId:status.rootId});good.push(verified);}catch{}
 check(good.length,2);check((await fs.stat(path.join(backupRoot,'status.json'))).mode&0o777,0o600);
 await fs.unlink(secondSource);await rejects(()=>scheduledBackup({config,appRoot,backupRoot,retain:2}));check(JSON.parse(await fs.readFile(path.join(backupRoot,'status.json'),'utf8')).state,'failed');
 check((await fs.readdir(data)).includes('.yourrest-backup.lock'),false);await objects.put('competitor/two',Buffer.from('%PDF-second'));
 // Pre-existing unrelated status and stale locks are never silently overwritten/broken.
 const foreignRoot=path.join(work,'foreign-status');await fs.mkdir(foreignRoot,{mode:0o700});await fs.writeFile(path.join(foreignRoot,'status.json'),'{}',{mode:0o600});await rejects(()=>scheduledBackup({config,appRoot,backupRoot:foreignRoot}));check(await fs.readFile(path.join(foreignRoot,'status.json'),'utf8'),'{}');
 await fs.mkdir(path.join(data,'.yourrest-backup.lock'),{mode:0o700});await rejects(()=>createBackup({config,appRoot,destination:path.join(work,'stale-lock')}));check((await fs.stat(path.join(data,'.yourrest-backup.lock'))).isDirectory(),true);await fs.rmdir(path.join(data,'.yourrest-backup.lock'));
 // Execute the exact deployed CLIs from a release/operations layout.
 const operations=path.join(appRoot,'release','operations');await fs.mkdir(operations,{recursive:true,mode:0o700});
 for(const name of ['backup-core.mjs','backup.mjs','backup-scheduled.mjs','backup-cron.mjs','restore.mjs','config.cjs'])await fs.copyFile(path.resolve(import.meta.dirname,'../portable',name),path.join(operations,name));
 const settings={...config,YR_APP_ORIGIN:'https://crm.yourrest.org',YR_AUTH_SECRET:'a'.repeat(64),YR_MAIL_TRANSPORT:'sendmail',YR_MAIL_FROM:'ceo@yourrest.org',YR_SENDMAIL_PATH:'/usr/sbin/sendmail'};
 await fs.writeFile(path.join(appRoot,'settings.cjs'),'module.exports='+JSON.stringify(settings)+';\n',{mode:0o600});
 const execute=(name,...args)=>{const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('YR_')));return spawnSync(process.execPath,[path.join(operations,name),...args],{encoding:'utf8',env});};
 const cliBackup=path.join(work,'cli-backup'),created=execute('backup.mjs',cliBackup);check(created.status,0);check(JSON.parse(created.stdout).ok,true);
 const cliVerified=execute('restore.mjs','verify',cliBackup);check(cliVerified.status,0);check(JSON.parse(cliVerified.stdout).objects,2);
 const cliRestore=execute('restore.mjs','restore',cliBackup,path.join(work,'cli-restore'));check(cliRestore.status,0);check(JSON.parse(cliRestore.stdout).liveDataModified,false);
 const cliScheduled=execute('backup-scheduled.mjs',path.join(work,'cli-daily'),'2');check(cliScheduled.status,0);check(JSON.parse(cliScheduled.stdout).state,'ok');
 const cron=execute('backup-cron.mjs',path.join(work,'cli-daily'),'2');check(cron.status,0);const cronPlan=JSON.parse(cron.stdout);check(cronPlan.enabled,false);check(cronPlan.command.includes(process.execPath),true);
 const cronRun=spawnSync('/bin/sh',['-c',cronPlan.command],{encoding:'utf8'});check(cronRun.status,0);check((await fs.stat(path.join(work,'cli-daily','last-run.log'))).mode&0o777,0o600);check(JSON.parse((await fs.readFile(path.join(work,'cli-daily','last-run.log'),'utf8')).trim().split('\n').at(-1)).state,'ok');
 const invalid=execute('backup.mjs',cliBackup);check(invalid.status,1);check(JSON.parse(invalid.stderr.trim().split('\n').at(-1)).errorCode,'DESTINATION_EXISTS');
 check(created.stdout.includes(settings.YR_AUTH_SECRET)||invalid.stderr.includes(settings.YR_AUTH_SECRET),false);
 console.log(JSON.stringify({ok:true,checks,scope:'real temporary SQLite + objects; online writes, overlap lock, exact references, restore, corruption, paths, scheduled status and safe retention',productionDataUsed:false}));
}finally{db?.close();await fs.rm(work,{recursive:true,force:true});}
