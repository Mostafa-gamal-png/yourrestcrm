import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

const root=process.cwd(),require=createRequire(import.meta.url),umask=process.umask(0o077);
const work=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-daily-deploy-backup-test-'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const put=(file,bytes)=>{fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,bytes,{mode:0o600});};
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const rejects=async(fn,code)=>{await assert.rejects(fn,{code});checks++;};
const read=file=>fs.readFileSync(file,'utf8');
let helper,release,manifest,oldFetch=globalThis.fetch;
try{
 const build=path.join(work,'build');
 for(const name of ['node_modules','dist/server','dist/client','drizzle','operations'])fs.mkdirSync(path.join(build,name),{recursive:true,mode:0o700});
 for(const name of ['app.cjs','server.js'])put(path.join(build,name),'// isolated release fixture\n');
 put(path.join(build,'package.json'),'{}\n');
 for(const name of ['config.cjs','initialize.mjs'])fs.copyFileSync(path.join(root,'portable',name),path.join(build,'operations',name));
 // This historical activator belongs to the release whose schema ended at 0014; later migrations are not part of its fixture.
 const migrations=fs.readdirSync(path.join(root,'drizzle')).filter(name=>name.endsWith('.sql')&&name<='0014_customer_identities.sql').sort();
 eq(migrations.length,15);
 for(const name of migrations)fs.copyFileSync(path.join(root,'drizzle',name),path.join(build,'drizzle',name));
 put(path.join(build,'drizzle/manifest.json'),JSON.stringify({format:'yourrest-migrations-v1',files:migrations.map(name=>({name,sha256:hash(fs.readFileSync(path.join(build,'drizzle',name)))}))}));
 const archive=path.join(work,'customer-edit.zip');
 const packaged=JSON.parse(execFileSync('python3',[path.join(root,'scripts/package-customer-edit-update.py'),'--release',build,'--output',archive],{encoding:'utf8'}));
 eq(packaged.schemaBefore,15);eq(packaged.schemaAfter,15);eq(packaged.settingsOrProductionDataIncluded,false);
 const extracted=path.join(work,'extracted');
 execFileSync('python3',['-c','import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',archive,extracted]);
 release=path.join(extracted,'release');manifest=read(path.join(extracted,'RELEASE-SHA256SUMS.txt'));
 helper=require(path.join(extracted,'yourrest-activate-customer-edit.cjs'));
 eq(helper.PIN,hash(manifest));eq(helper.RELEASE_FILES,packaged.files);
 eq(read(path.join(extracted,'yourrest-activate-customer-edit.cjs')).includes('__CUSTOMER_EDIT_'),false);

 function fixture(name,{schema=15}={}){
  const home=path.join(work,name);fs.mkdirSync(home,{mode:0o700});const p=helper.pathsFor(home);
  for(const dir of [p.app,p.stage,p.data,path.join(p.data,'objects'),p.current])fs.mkdirSync(dir,{recursive:true,mode:0o700});
  fs.cpSync(release,p.newRelease,{recursive:true});put(p.manifest,manifest);
  put(path.join(p.current,'old-version'),'old release retained');put(path.join(p.app,'app.cjs'),'// preserved root launcher\n');
  const database=path.join(p.data,'database.sqlite'),db=new DatabaseSync(database);fs.chmodSync(database,0o600);
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE yr_schema_migrations(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)');
  for(const name of migrations.slice(0,schema)){const sql=read(path.join(build,'drizzle',name));db.exec(sql);db.prepare('INSERT INTO yr_schema_migrations VALUES(?,?,?)').run(name,hash(sql),'2026-10-07T00:00:00Z');}
  db.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,region_scope,active,target,created_at) VALUES('owner','fixture-owner','fixture-owner@yourrest.org','Fixture','admin','Test','all',1,0,'2026-10-07')").run();
  db.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','fixture-owner')").run();
  db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at) VALUES('customer','customer',NULL,'owner','Test',?, '2026-10-07','2026-10-07')").run(JSON.stringify({name:'Isolated customer',code:'ERP-1',region:'الشرقية'}));
  const attachment=Buffer.from('isolated attachment bytes');put(path.join(p.data,'objects',hash('visit/sample')),attachment);
  db.prepare("INSERT INTO crm_visit_files(id,object_key,customer_id,name,content_type,size,uploaded_by,created_at) VALUES('file','visit/sample','customer','sample.txt','text/plain',?,'owner','2026-10-07')").run(attachment.length);
  db.close();
  put(path.join(p.app,'settings.cjs'),'module.exports='+JSON.stringify({YR_APP_ORIGIN:'https://crm.yourrest.org',YR_DATABASE_PATH:database,YR_OBJECTS_PATH:path.join(p.data,'objects'),YR_AUTH_SECRET:randomBytes(32).toString('hex'),YR_MAIL_TRANSPORT:'sendmail',YR_MAIL_FROM:'fixture@yourrest.org',YR_SENDMAIL_PATH:'/usr/sbin/sendmail'})+';\n');
  return p;
 }

 const quiet=()=>{};
 const emptyProc=path.join(work,'empty-proc');fs.mkdirSync(emptyProc,{mode:0o700});
 const stopped=paths=>helper.ensureStopped(paths,emptyProc);
 const clock=iso=>()=>new Date(iso);
 const options=(iso,extra={})=>({log:quiet,stopped,now:clock(iso),...extra});
 let copies=0;
 const countCopy=(source,target)=>{copies++;execFileSync('cp',['-a','--',source,target]);};
 const copyFixture=(source,target)=>execFileSync('cp',['-a','--',source,target]);
 const nextStage=(p,label)=>{
  const stage=path.join(p.home,'customer-edit-stage-'+label);
  fs.mkdirSync(stage,{mode:0o700});
  const next={...p,stage,newRelease:path.join(stage,'release'),manifest:path.join(stage,'RELEASE-SHA256SUMS.txt'),state:path.join(stage,'customer-edit-activation-state.json'),lock:path.join(stage,'customer-edit-activation.lock')};
  fs.cpSync(release,next.newRelease,{recursive:true});put(next.manifest,manifest);return next;
 };
 const addCustomer=(p,id)=>{
  const db=new DatabaseSync(path.join(p.data,'database.sqlite'));
  db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at) VALUES(?,'customer',NULL,'owner','Test',?,'2026-10-07','2026-10-07')").run(id,JSON.stringify({name:'Isolated later customer',code:id,region:'الشرقية'}));db.close();
 };
 const countRows=p=>{const db=new DatabaseSync(path.join(p.data,'database.sqlite'),{readOnly:true});try{return db.prepare('SELECT COUNT(*) n FROM crm_records').get().n;}finally{db.close();}};
 const assertUnchanged=(before,p)=>{helper.assertSameInventory(before,helper.inventory(p.data));checks++;};
 const assertRejected=async(fn)=>{await assert.rejects(fn);checks++;};
 globalThis.fetch=async(url,settings)=>{eq(settings.redirect,'manual');return new Response('',{status:url.endsWith('/login')?200:401});};

 // A first activation creates today's full backup; independent later activations
 // reuse it without erasing journals or copying the newer live data into it.
 {
  const p=fixture('same-day');copies=0;
  const first=await helper.run(p,'apply',options('2026-10-07T05:00:00Z',{copy:countCopy}));
  eq(copies,2,'First activation copies the application and data once');
  eq(first.phase,'switched');
  const firstJournal=read(p.state),backupBefore=helper.inventory(first.dailyBackup?.transaction||first.transaction);
  addCustomer(p,'record-after-daily-backup');
  const next=nextStage(p,'second'),dataBefore=helper.inventory(next.data);copies=0;
  const second=await helper.run(next,'apply',options('2026-10-07T13:00:00Z',{copy:countCopy}));
  eq(copies,0,'A second update on the same Saudi day does not take another full backup');
  eq(first.dailyBackup.day,'2026-10-07');
  eq(second.dailyBackup,first.dailyBackup,'Later activation references the existing daily backup');
  eq(read(p.state),firstJournal,'Earlier activation journal is retained');
  eq(second.transaction===first.transaction,false,'Each release swap has its own transaction');
  eq(fs.existsSync(path.join(second.transaction,'old-release')),true,'Every update retains its immediately preceding release');
  eq(fs.existsSync(path.join(second.transaction,'data')),false,'A reused backup does not hide another full data copy in the update transaction');
  assertUnchanged(dataBefore,next);eq(countRows(next),2);
  helper.assertSameInventory(backupBefore,helper.inventory(first.dailyBackup.transaction));checks++;
  eq(fs.existsSync(second.baselineIds.file),true);eq(hash(fs.readFileSync(second.baselineIds.file)),second.baselineIds.sha256);
  eq(read(second.baselineIds.file).includes('record-after-daily-backup'),true,'Pre-switch identity evidence includes records added after the daily backup');
  const verified=await helper.run(next,'verify',options('2026-10-07T13:05:00Z'));eq(verified.migrations,15);
  copies=0;await helper.run(next,'apply',options('2026-10-07T13:06:00Z',{copy:countCopy}));eq(copies,0,'Retry after a completed swap neither copies nor switches');
  const db=new DatabaseSync(path.join(next.data,'database.sqlite'));db.exec("PRAGMA foreign_keys=ON; DELETE FROM crm_records WHERE id='record-after-daily-backup'");db.close();
  await rejects(()=>helper.run(next,'verify',options('2026-10-07T13:07:00Z')),'RECORD_CHANGES_REQUIRE_REVIEW_NO_ROLLBACK');
  eq(countRows(next),1,'Verification never restores an old database to conceal missing newer records');
 }

 // Saudi midnight is UTC 21:00, independent of the process/server timezone.
 {
  const p=fixture('saudi-midnight');copies=0;
  const before=await helper.run(p,'apply',options('2026-10-07T20:59:59Z',{copy:countCopy}));eq(copies,2);eq(before.dailyBackup.day,'2026-10-07');
  const next=nextStage(p,'next-day');copies=0;
  const after=await helper.run(next,'apply',options('2026-10-07T21:00:00Z',{copy:countCopy}));eq(copies,2);eq(after.dailyBackup.day,'2026-10-08');
  eq(before.dailyBackup.index===after.dailyBackup.index,false);eq(before.dailyBackup.transaction===after.dailyBackup.transaction,false);
 }

 function legacyBackup(p,{createdAt='2026-10-07T05:00:00Z',phase='switched',schema=14}={}){
  const old=fixture('old-database-fixture-'+path.basename(p.home),{schema});
  const tx=path.join(p.home,'yourrest-activation-20261007-daily-fixture');fs.mkdirSync(tx,{mode:0o700});
  copyFixture(p.app,path.join(tx,'application'));copyFixture(old.data,path.join(tx,'data'));copyFixture(p.current,path.join(tx,'old-release'));
  const state={format:'yourrest-activation-20261007',home:p.home,transaction:tx,phase,createdAt,rootHashes:{'settings.cjs':hash(fs.readFileSync(path.join(p.app,'settings.cjs'))),'app.cjs':hash(fs.readFileSync(path.join(p.app,'app.cjs')))},baseline:{attachments:1,counts:{crm_records:1,crm_sales:0,crm_erp_sales:0,crm_members:1},migrations:schema}};
  const checkpoint=path.join(p.home,'yourrest-security-update-20261007','activation-state.json');
  put(checkpoint,JSON.stringify(state));put(path.join(tx,'activation-state.json'),JSON.stringify(state));
  return {tx,state,checkpoint};
 }

 // The valid security deployment backup made earlier today is already a full
 // application/data snapshot. Its old schema stays untouched when adopted.
 {
  const p=fixture('adopt-security');const old=legacyBackup(p);const historical=helper.inventory(old.tx);
  addCustomer(p,'late-record-before-customer-fix');const before=helper.inventory(p.data);copies=0;
  const state=await helper.run(p,'apply',options('2026-10-07T12:00:00Z',{copy:countCopy}));
  eq(copies,0,'Today\'s verified security backup avoids another full application/data copy');
  eq(state.dailyBackup.transaction,old.tx);eq(JSON.parse(read(state.dailyBackup.index)).backupSchema,14);
  assertUnchanged(before,p);eq(countRows(p),2);eq(state.baseline.migrations,15,'Current database still requires all 15 migrations');
  const db=new DatabaseSync(path.join(old.tx,'data/database.sqlite'),{readOnly:true});
  eq(db.prepare('SELECT COUNT(*) n FROM yr_schema_migrations').get().n,14);db.close();
  helper.assertSameInventory(historical,helper.inventory(old.tx));checks++;
  eq(read(state.baselineIds.file).includes('late-record-before-customer-fix'),true);
  const verified=await helper.run(p,'verify',options('2026-10-07T12:05:00Z'));eq(verified.migrations,15);
 }

 // A stored daily index is trusted only while its sealed snapshot still matches.
 for(const damage of ['application','attachment','registry-seal','registry-path','registry-day','registry-future','registry-permissions','registry-symlink']){
  const p=fixture('tamper-'+damage);const first=await helper.run(p,'apply',options('2026-10-07T06:00:00Z'));
  const next=nextStage(p,'tampered'),priorData=helper.inventory(p.data),priorRelease=helper.inventory(p.current);
  const index=first.dailyBackup.index;
  if(damage==='application')put(path.join(first.dailyBackup.transaction,'application/app.cjs'),'// damaged backup launcher');
  if(damage==='attachment')put(path.join(first.dailyBackup.transaction,'data/objects',hash('visit/sample')),'damaged attachment');
  if(damage==='registry-seal'){const value=JSON.parse(read(index));value.dataSeal='0'.repeat(64);put(index,JSON.stringify(value));}
  if(damage==='registry-path'){const value=JSON.parse(read(index));value.transaction=work;put(index,JSON.stringify(value));}
  if(damage==='registry-day'){const value=JSON.parse(read(index));value.day='2026-10-08';put(index,JSON.stringify(value));}
  if(damage==='registry-future'){const value=JSON.parse(read(index));value.verifiedAt='2026-10-07T14:00:00Z';put(index,JSON.stringify(value));}
  if(damage==='registry-permissions')fs.chmodSync(index,0o644);
  if(damage==='registry-symlink'){const target=path.join(work,'external-index-'+damage);fs.renameSync(index,target);fs.symlinkSync(target,index);}
  copies=0;await assertRejected(()=>helper.run(next,'apply',options('2026-10-07T10:00:00Z',{copy:countCopy})));
  eq(copies,0,'Unsafe existing daily backup is not silently replaced by a new copy');
  assertUnchanged(priorData,p);helper.assertSameInventory(priorRelease,helper.inventory(p.current));checks++;
 }

 // Claiming a verified old deployment never excuses incomplete/corrupt evidence.
 for(const damage of ['partial','state-mismatch','future','symlink','database','missing-attachment']){
  const p=fixture('legacy-invalid-'+damage);
  const old=legacyBackup(p,{phase:damage==='partial'?'copying':'switched',createdAt:damage==='future'?'2026-10-07T13:00:00Z':'2026-10-07T05:00:00Z'});
  if(damage==='state-mismatch')put(path.join(old.tx,'activation-state.json'),JSON.stringify({...old.state,phase:'moving_old'}));
  if(damage==='symlink'){fs.renameSync(old.tx,old.tx+'-external');fs.symlinkSync(old.tx+'-external',old.tx);}
  if(damage==='database')put(path.join(old.tx,'data/database.sqlite'),'broken database');
  if(damage==='missing-attachment')fs.unlinkSync(path.join(old.tx,'data/objects',hash('visit/sample')));
  const before=helper.inventory(p.data),current=helper.inventory(p.current);copies=0;
  await assertRejected(()=>helper.run(p,'apply',options('2026-10-07T12:00:00Z',{copy:countCopy})));
  eq(copies,0);assertUnchanged(before,p);helper.assertSameInventory(current,helper.inventory(p.current));checks++;
 }
 // A completed backup from yesterday is sound but not today's backup.
 {
  const p=fixture('legacy-yesterday'),old=legacyBackup(p,{createdAt:'2026-10-06T13:00:00Z'});copies=0;
  const state=await helper.run(p,'apply',options('2026-10-07T12:00:00Z',{copy:countCopy}));
  eq(copies,2);eq(state.dailyBackup.day,'2026-10-07');eq(state.dailyBackup.transaction===old.tx,false);
  eq(fs.existsSync(old.checkpoint),true,'A prior-day backup is retained');
 }

 // A shared daily lock covers independent deployment staging folders.
 {
  const p=fixture('daily-lock');fs.mkdirSync(p.dailyLock,{mode:0o700});const before=helper.inventory(p.data);copies=0;
  await assertRejected(()=>helper.run(p,'apply',options('2026-10-07T12:00:00Z',{copy:countCopy})));
  eq(copies,0);assertUnchanged(before,p);eq(read(path.join(p.current,'old-version')),'old release retained');eq(fs.existsSync(p.dailyLock),true,'Another operation\'s lock is not removed');
 }
 // A first operation paused inside the copy still excludes a different stage.
 {
  const p=fixture('daily-overlap'),next=nextStage(p,'overlap');copies=0;
  let nestedRejected=false;
  const result=await helper.run(p,'apply',options('2026-10-07T12:00:00Z',{copy:countCopy,afterCopy:async()=>{
   await assertRejected(()=>helper.run(next,'apply',options('2026-10-07T12:00:01Z',{copy:countCopy})));nestedRejected=true;
  }}));
  eq(nestedRejected,true);eq(copies,2,'Only the first operation copies');eq(result.phase,'switched');eq(fs.existsSync(p.dailyLock),false);
 }
 // Reuse must still detect any last-moment live write before swapping the release.
 {
  const p=fixture('late-write');await helper.run(p,'apply',options('2026-10-07T06:00:00Z'));
  const next=nextStage(p,'late'),current=helper.inventory(p.current);copies=0;
  await rejects(()=>helper.run(next,'apply',options('2026-10-07T12:00:00Z',{copy:countCopy,afterInspect:()=>addCustomer(p,'racing-record')})),'BACKUP_CONTENT_MISMATCH');
  eq(copies,0);helper.assertSameInventory(current,helper.inventory(p.current));checks++;eq(countRows(p),2);
 }
 console.log(JSON.stringify({ok:true,checks,realSqlite:true,productionDataUsed:false,httpStub:true,scope:'one full deploy backup per Saudi day, security schema14 adoption, sealed reuse, peractivation late-record evidence, failclosed corruption and global concurrency'}));
}finally{globalThis.fetch=oldFetch;fs.rmSync(work,{recursive:true,force:true});process.umask(umask);}
