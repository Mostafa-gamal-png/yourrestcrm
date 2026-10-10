import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

const root=process.cwd(),require=createRequire(import.meta.url),umask=process.umask(0o077);
const work=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-customer-edit-deploy-test-'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const put=(file,bytes)=>{fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,bytes,{mode:0o600});};
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const rejects=async(fn,code)=>{await assert.rejects(fn,{code});checks++;};
const read=file=>fs.readFileSync(file,'utf8');
const template=require('../portable/activate-customer-edit-update.cjs');
let helper,release,manifest,oldFetch=globalThis.fetch;
try{
 const build=path.join(work,'build');
 for(const name of ['node_modules','dist/server','dist/client','drizzle','operations'])fs.mkdirSync(path.join(build,name),{recursive:true,mode:0o700});
 for(const name of ['app.cjs','server.js'])put(path.join(build,name),'// isolated release fixture\n');
 put(path.join(build,'package.json'),'{}\n');
 for(const name of ['config.cjs','initialize.mjs'])fs.copyFileSync(path.join(root,'portable',name),path.join(build,'operations',name));
 const migrations=fs.readdirSync(path.join(root,'drizzle')).filter(name=>name.endsWith('.sql')).sort();
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

 // Run the complete previously proven copy/process/switch/recovery regressions
 // against this exact new helper, rather than duplicating their 69 assertions.
 const legacy=path.join(work,'inherited-regressions');
 put(path.join(legacy,'portable/activate-security-update.cjs'),read(path.join(extracted,'yourrest-activate-customer-edit.cjs')));
 put(path.join(legacy,'tests/activate-security-update.mjs'),read(path.join(root,'tests/activate-security-update.mjs')));
 const inherited=JSON.parse(execFileSync(process.execPath,[path.join(legacy,'tests/activate-security-update.mjs')],{encoding:'utf8'}).trim());
 eq(inherited.ok,true);assert.ok(inherited.checks>=60);checks++;

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
 {
  const p=fixture('placeholder');
  await rejects(()=>template.run(p,'check',{log:quiet,stopped}),'MANIFEST_MISMATCH');
  eq(fs.existsSync(p.state),false);
 }
 {
  const p=fixture('tampered-manifest');put(p.manifest,manifest+'invalid\n');
  await rejects(()=>helper.run(p,'apply',{log:quiet,stopped}),'MANIFEST_MISMATCH');eq(fs.existsSync(p.state),false);
 }
 {
  const p=fixture('tampered-release');put(path.join(p.newRelease,'server.js'),'changed');
  await rejects(()=>helper.run(p,'apply',{log:quiet,stopped}),'RELEASE_CHECKSUM_MISMATCH');eq(read(path.join(p.current,'old-version')),'old release retained');
 }
 for(const [name,state] of [['wrong-format',{format:'yourrest-activation-20261007'}],['escape-transaction',{transaction:'/tmp/external'}]]){
  const p=fixture(name);put(p.state,JSON.stringify({format:'yourrest-customer-edit-activation-20261007',home:p.home,transaction:path.join(p.home,'yourrest-customer-edit-activation-20261007-test'),phase:'switched',...state}));
  await rejects(()=>helper.run(p,'verify',{log:quiet,stopped}),'INVALID_ACTIVATION_STATE');eq(read(path.join(p.current,'old-version')),'old release retained');
 }
 {
  const p=fixture('process-guard');const proc=path.join(work,'proc'),base=path.join(proc,String(process.pid+200000));fs.mkdirSync(path.join(base,'fd'),{recursive:true,mode:0o700});fs.symlinkSync(p.app,path.join(base,'cwd'));put(path.join(base,'cmdline'),'node\0app.cjs\0');
  await rejects(()=>helper.run(p,'apply',{log:quiet,stopped:paths=>helper.ensureStopped(paths,proc)}),'APP_OR_DATA_STILL_IN_USE');eq(fs.existsSync(p.state),false);
 }
 {
  const p=fixture('corrupt-backup');const before=helper.inventory(p.data);
  await rejects(()=>helper.run(p,'apply',{log:quiet,stopped,afterCopy:(_p,tx)=>put(path.join(tx,'data/objects',hash('visit/sample')),'same sized wrong file!!!')}),'BACKUP_CONTENT_MISMATCH');
  helper.assertSameInventory(before,helper.inventory(p.data));checks++;eq(read(path.join(p.current,'old-version')),'old release retained');eq(fs.existsSync(p.lock),false);
 }
 {
 const p=fixture('old-schema',{schema:14});const before=helper.inventory(p.data);
  await rejects(()=>helper.run(p,'apply',{log:quiet,stopped}),'UNEXPECTED_MIGRATION_HISTORY');helper.assertSameInventory(before,helper.inventory(p.data));checks++;eq(read(path.join(p.current,'old-version')),'old release retained');
 }
 {
  const p=fixture('source-changed-after-inspection');
  await rejects(()=>helper.run(p,'apply',{log:quiet,stopped,afterInspect:()=>put(path.join(p.data,'objects',hash('visit/sample')),'late change to source')}),'BACKUP_CONTENT_MISMATCH');
  eq(read(path.join(p.current,'old-version')),'old release retained');eq(fs.existsSync(p.newRelease),true);
 }
 {
  const p=fixture('complete');const before=helper.inventory(p.data),settings=read(path.join(p.app,'settings.cjs')),launcher=read(path.join(p.app,'app.cjs')),messages=[];
  await helper.run(p,'check',{log:message=>messages.push(message),stopped});eq(fs.existsSync(p.state),false);
  const state=await helper.run(p,'apply',{log:message=>messages.push(message),stopped});
  eq(state.phase,'switched');eq(state.baseline.migrations,15);eq(state.baseline.attachments,1);eq(fs.existsSync(p.newRelease),false);eq(fs.existsSync(p.lock),false);
  helper.assertSameInventory(before,helper.inventory(p.data));checks++;
  eq(read(path.join(p.app,'settings.cjs')),settings);eq(read(path.join(p.app,'app.cjs')),launcher);
  eq(read(path.join(state.transaction,'old-release/old-version')),'old release retained');eq(read(path.join(state.transaction,'application/release/old-version')),'old release retained');
  eq(messages.at(-1),'START APP IN CPANEL');
  const afterSwitch=helper.inventory(p.home);await helper.run(p,'apply',{log:quiet,stopped});helper.assertSameInventory(afterSwitch,helper.inventory(p.home));checks++;
  const requests=[];
  globalThis.fetch=async(url,options)=>{requests.push({url,options});return new Response('',{status:url.endsWith('/login')?200:401});};
  const result=await helper.run(p,'verify',{log:message=>messages.push(message),stopped});eq(result.migrations,15);eq(messages.at(-1),'DEPLOYMENT VERIFIED');eq(requests.map(r=>r.url),['https://crm.yourrest.org/login','https://crm.yourrest.org/api/crm']);eq(requests.every(r=>r.options.redirect==='manual'),true);
  put(path.join(p.app,'settings.cjs'),settings+'// unexpected change');await rejects(()=>helper.run(p,'verify',{log:quiet,stopped}),'ROOT_CONFIGURATION_CHANGED');put(path.join(p.app,'settings.cjs'),settings);
  globalThis.fetch=async()=>new Response('',{status:503});await rejects(()=>helper.run(p,'verify',{log:quiet,stopped}),'HTTP_VERIFICATION_FAILED');
  eq(fs.existsSync(p.current),true);eq(fs.existsSync(path.join(state.transaction,'old-release')),true);
  globalThis.fetch=async url=>new Response('',{status:url.endsWith('/login')?200:401});
  const db=new DatabaseSync(path.join(p.data,'database.sqlite'));db.exec("PRAGMA foreign_keys=ON; DELETE FROM crm_records WHERE id='customer'");db.close();
  await rejects(()=>helper.run(p,'verify',{log:quiet,stopped}),'RECORD_CHANGES_REQUIRE_REVIEW_NO_ROLLBACK');
  const after=new DatabaseSync(path.join(p.data,'database.sqlite'),{readOnly:true});eq(after.prepare("SELECT COUNT(*) n FROM crm_records WHERE id='customer'").get().n,0);after.close();
  eq(fs.existsSync(p.current),true);
 }
 console.log(JSON.stringify({ok:true,checks,inheritedChecks:inherited.checks,scope:'customer edit 15-to-15 package, pinned standalone helper, real SQLite backup, process/state/hash guards, unchanged settings/data, full swap and readonly verification',productionDataUsed:false,httpStub:true}));
}finally{globalThis.fetch=oldFetch;fs.rmSync(work,{recursive:true,force:true});process.umask(umask);}
