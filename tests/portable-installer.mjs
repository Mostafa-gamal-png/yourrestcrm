import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {initializeDatabase} from '../portable/initialize.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),work=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-installer-'));
const tables=['crm_members','crm_settings','crm_records','crm_visit_numbers','crm_visit_files','crm_sales','crm_performance_targets','crm_target_sets','crm_kpi_assessments','crm_service_cases','crm_audit'];
let checks=0;
const check=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const cleanEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('YR_')));
function fixture(name){
 const parent=path.join(work,name),app=path.join(parent,'app');fs.mkdirSync(path.join(app,'release/operations'),{recursive:true,mode:0o700});
 fs.cpSync(path.join(root,'portable'),path.join(app,'release/operations'),{recursive:true});fs.cpSync(path.join(root,'drizzle'),path.join(app,'release/drizzle'),{recursive:true});
 fs.copyFileSync(path.join(root,'portable/setup.cjs'),path.join(app,'setup.cjs'));fs.copyFileSync(path.join(root,'portable/launcher.cjs'),path.join(app,'app.cjs'));
 fs.writeFileSync(path.join(app,'release/app.cjs'),"console.log(JSON.stringify({started:true,origin:process.env.YR_APP_ORIGIN}));",{mode:0o600});
 fs.mkdirSync(path.join(app,'migration'),{mode:0o700});
 const db=new DatabaseSync(':memory:');
 for(const file of fs.readdirSync(path.join(root,'drizzle')).filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync(path.join(root,'drizzle',file),'utf8'));
 db.exec("INSERT INTO crm_members(id,user_id,email,name,role,branch,active,target,created_at,region_scope) VALUES('owner','opaque-owner','ceo@yourrest.org','Test owner','admin','Main',1,0,'2026-09-30','all'); INSERT INTO crm_settings(id,owner_id) VALUES('company','opaque-owner');");
 const snapshot={format:'yourrest-namecheap-export-v1',tables:Object.fromEntries(tables.map(table=>[table,{columns:db.prepare('PRAGMA table_info('+table+')').all().map(row=>row.name),rows:db.prepare('SELECT * FROM '+table).all()}]))};db.close();
 const seed=path.join(app,'migration/initial.json'),checksum=path.join(app,'migration/initial.sha256');writeSeed(snapshot,seed,checksum);
 return{parent,app,seed,checksum,snapshot,migrations:path.join(app,'release/drizzle'),filename:path.join(parent,'yourrest-crm-data/database.sqlite')};
}
function writeSeed(snapshot,seed,checksum){const text=JSON.stringify(snapshot);fs.writeFileSync(seed,text,{mode:0o600});fs.writeFileSync(checksum,createHash('sha256').update(text).digest('hex'),{mode:0o600});}
/** Node prints an ExperimentalWarning for node:sqlite on stderr; the machine-readable summary is the last JSON line. */
function lastJson(output){const line=output.split('\n').map(row=>row.trim()).filter(row=>row.startsWith('{')).at(-1);assert(line,'No JSON summary in output: '+output);return JSON.parse(line);}
function options(f,filename=f.filename){return{filename,migrations:f.migrations,seed:f.seed,checksum:f.checksum,appRoot:f.app};}
function start(f,args=['setup.cjs'],extra={},nodeArgs=[]){const child=spawn(process.execPath,[...nodeArgs,...args],{cwd:f.app,env:{...cleanEnv,...extra},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);return{child,result:once(child,'exit').then(([code])=>({code,output}))};}
const run=async(f,args,extra,nodeArgs)=>start(f,args,extra,nodeArgs).result;
function settings(f){const file=path.join(f.app,'settings.cjs');return JSON.parse(fs.readFileSync(file,'utf8').replace(/^module.exports=/,'').replace(/;\s*$/,''));}
function writeSettings(f,config){fs.writeFileSync(path.join(f.app,'settings.cjs'),'module.exports='+JSON.stringify(config)+';\n',{mode:0o600});}
function hash(file){return createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
try{
 const first=fixture('normal');let result=await run(first);check(result.code,0,result.output);let summary=lastJson(result.output);check(summary.newDatabase,true);check(summary.migrations,fs.readdirSync('drizzle').filter(name=>name.endsWith('.sql')).length);check(summary.counts.crm_members,1);
 const config=settings(first),secret=config.YR_AUTH_SECRET,settingsBefore=fs.readFileSync(path.join(first.app,'settings.cjs'),'utf8');assert(!result.output.includes(secret));checks++;
 const persisted=new DatabaseSync(first.filename);persisted.exec("UPDATE crm_members SET name='Preserved owner' WHERE id='owner'");persisted.close();
 result=await run(first);check(result.code,0,result.output);check(lastJson(result.output).newDatabase,false);check(fs.readFileSync(path.join(first.app,'settings.cjs'),'utf8'),settingsBefore);const read=new DatabaseSync(first.filename,{readOnly:true});check(read.prepare("SELECT name FROM crm_members WHERE id='owner'").get().name,'Preserved owner');read.close();
 result=await run(first,['app.cjs']);check(result.code,0,result.output);check(lastJson(result.output).origin,config.YR_APP_ORIGIN);
 const backup=path.join(first.parent,'backup');result=await run(first,['release/operations/backup.mjs',backup]);check(result.code,0,result.output);assert(fs.existsSync(path.join(backup,'database.sqlite')));checks++;
 const originalHash=hash(first.filename),conflict=path.join(first.parent,'other.sqlite');
 for(const args of [['setup.cjs'],['app.cjs'],['release/operations/backup.mjs',path.join(first.parent,'bad-backup')]]){result=await run(first,args,{YR_DATABASE_PATH:conflict});check(result.code,1);if(args[0].includes('backup.mjs')){check(lastJson(result.output),{ok:false,errorCode:'BACKUP_OPERATION_FAILED'});assert(!result.output.includes(conflict)&&!result.output.includes(secret));checks++;}else{assert.match(result.output,/Conflicting YR_DATABASE_PATH/);checks++;}check(hash(first.filename),originalHash);assert(!fs.existsSync(conflict));checks++;}
 assert(!fs.existsSync(path.join(first.parent,'bad-backup')));checks++;
 result=await run(first,['app.cjs'],{YR_APP_ORIGIN:config.YR_APP_ORIGIN});check(result.code,0,result.output);
 const rejected=fixture('existing-unrecognized');fs.mkdirSync(path.dirname(rejected.filename),{mode:0o700});
 fs.writeFileSync(rejected.filename,'',{mode:0o600});assert.throws(()=>initializeDatabase(options(rejected)),/not a recognized/);check(fs.statSync(rejected.filename).size,0);
 fs.unlinkSync(rejected.filename);let foreign=new DatabaseSync(rejected.filename);foreign.exec("CREATE TABLE external_data(value TEXT); INSERT INTO external_data VALUES('preserve me')");foreign.close();fs.chmodSync(rejected.filename,0o600);const foreignBefore=hash(rejected.filename);assert.throws(()=>initializeDatabase(options(rejected)),/not a recognized/);check(hash(rejected.filename),foreignBefore);
 // All existing-owner validations fail before any migration or schema-ledger write.
 const ownerDb=new DatabaseSync(first.filename);
 for(const [column,value,restore]of [['role','rep','admin'],['active',0,1],['region_scope','eastern','all'],['email','owner@outside.test','ceo@yourrest.org']]){ownerDb.prepare('UPDATE crm_members SET '+column+'=? WHERE id=?').run(value,'owner');const before=hash(first.filename);assert.throws(()=>initializeDatabase(options(first)),/system owner/);check(hash(first.filename),before);ownerDb.prepare('UPDATE crm_members SET '+column+'=? WHERE id=?').run(restore,'owner');}
 ownerDb.close();
 const invalid=fixture('bad-new-owner');invalid.snapshot.tables.crm_members.rows[0].active=0;writeSeed(invalid.snapshot,invalid.seed,invalid.checksum);assert.throws(()=>initializeDatabase(options(invalid)),/system owner/);assert(!fs.existsSync(invalid.filename));check(fs.readdirSync(path.dirname(invalid.filename)),[]);
 // A destination appearing at publication is never overwritten.
 const race=fixture('publish-race'),originalLink=fs.linkSync;
 fs.linkSync=function(source,destination){if(destination===race.filename)fs.writeFileSync(destination,'other installer result',{flag:'wx',mode:0o600});return originalLink(source,destination);};
 try{assert.throws(()=>initializeDatabase(options(race)),error=>error.code==='EEXIST');check(fs.readFileSync(race.filename,'utf8'),'other installer result');assert(!fs.readdirSync(path.dirname(race.filename)).some(name=>name.includes('.initializing-')));checks++;}finally{fs.linkSync=originalLink;}
 // All setup path preflights happen before database mutations.
 const privateTarget=path.join(first.parent,'private-target');fs.mkdirSync(privateTarget,{mode:0o700});const alias=path.join(first.parent,'alias');fs.symlinkSync(privateTarget,alias);
 for(const change of [{YR_DATABASE_PATH:path.join(alias,'database.sqlite')},{YR_DATABASE_PATH:path.join(first.app,'database.sqlite')},{YR_OBJECTS_PATH:path.join(alias,'objects')}]){writeSettings(first,{...config,...change});const before=hash(first.filename);result=await run(first);check(result.code,1);check(hash(first.filename),before);assert(!fs.existsSync(path.join(privateTarget,'database.sqlite')));checks++;}
 writeSettings(first,config);
 fs.chmodSync(path.dirname(first.filename),0o755);result=await run(first);check(result.code,1);assert.match(result.output,/private/);checks++;fs.chmodSync(path.dirname(first.filename),0o700);
 // Setup lock spans settings publication and initial database import.
 const concurrent=fixture('concurrent'),marker=path.join(concurrent.parent,'locked-marker'),preload=path.join(concurrent.parent,'pause-settings.cjs');
 fs.writeFileSync(preload,`const fs=require('node:fs'),original=fs.linkSync;fs.linkSync=function(source,destination){if(destination.endsWith('/settings.cjs')){fs.writeFileSync(${JSON.stringify(marker)},'locked');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,600);}return original(source,destination);};`,{mode:0o600});
 const running=start(concurrent,['setup.cjs'],{},['--require',preload]);let held=false;for(let i=0;i<80;i++){if(fs.existsSync(marker)){held=true;break;}await new Promise(resolve=>setTimeout(resolve,25));}assert(held);checks++;
 result=await run(concurrent);check(result.code,1);assert.match(result.output,/already running/);checks++;
 result=await running.result;check(result.code,0,result.output);check(fs.existsSync(path.join(concurrent.app,'.setup.lock')),false);
 const after=await run(concurrent);check(after.code,0,after.output);check(lastJson(after.output).newDatabase,false);
 console.log(JSON.stringify({ok:true,checks,canonical_settings:true,unrecognized_database_unchanged:true,no_clobber_publish:true,exclusive_setup_lock:true,production_data_used:false}));
}finally{fs.rmSync(work,{recursive:true,force:true});}
