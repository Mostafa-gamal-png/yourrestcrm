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
// Made-up initial data only (fictional names, 05000000.. phones, example.com): the real one is not in the repository.
import {madeUpSnapshot, writeSeed as writeMadeUpSeed} from './fixtures/made-up-seed.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),work=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-installer-'));
const tables=['crm_members','crm_settings','crm_records','crm_visit_numbers','crm_visit_files','crm_sales','crm_performance_targets','crm_target_sets','crm_kpi_assessments','crm_service_cases','crm_audit'];
let checks=0;
const check=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const cleanEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('YR_')));
function fixture(name,{seeded=true}={}){
 const parent=path.join(work,name),app=path.join(parent,'app');fs.mkdirSync(path.join(app,'release/operations'),{recursive:true,mode:0o700});
 fs.cpSync(path.join(root,'portable'),path.join(app,'release/operations'),{recursive:true});fs.cpSync(path.join(root,'drizzle'),path.join(app,'release/drizzle'),{recursive:true});
 fs.copyFileSync(path.join(root,'portable/setup.cjs'),path.join(app,'setup.cjs'));fs.copyFileSync(path.join(root,'portable/launcher.cjs'),path.join(app,'app.cjs'));
 fs.writeFileSync(path.join(app,'release/app.cjs'),"console.log(JSON.stringify({started:true,origin:process.env.YR_APP_ORIGIN}));",{mode:0o600});
 fs.mkdirSync(path.join(app,'migration'),{mode:0o700});
 const db=new DatabaseSync(':memory:');
 for(const file of fs.readdirSync(path.join(root,'drizzle')).filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync(path.join(root,'drizzle',file),'utf8'));
 db.exec("INSERT INTO crm_members(id,user_id,email,name,role,branch,active,target,created_at,region_scope) VALUES('owner','opaque-owner','ceo@yourrest.org','Test owner','admin','Main',1,0,'2026-09-30','all'); INSERT INTO crm_settings(id,owner_id) VALUES('company','opaque-owner');");
 const snapshot={format:'yourrest-namecheap-export-v1',tables:Object.fromEntries(tables.map(table=>[table,{columns:db.prepare('PRAGMA table_info('+table+')').all().map(row=>row.name),rows:db.prepare('SELECT * FROM '+table).all()}]))};db.close();
 const seed=path.join(app,'migration/initial.json'),checksum=path.join(app,'migration/initial.sha256');if(seeded)writeSeed(snapshot,seed,checksum);
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
 // The package carries no initial data (the owner, 2026-11-16): an empty first installation needs its owner, and nothing is
 // written until it is given; a seed placed by hand still loads, with its checksum checked.
 const empty=fixture('empty',{seeded:false}),emptyDb=empty.filename;
 result=await run(empty);check(result.code,1);assert.match(result.output,/--owner-email=name@yourrest\.org/);checks++;
 check(fs.existsSync(emptyDb),false);check(fs.existsSync(path.dirname(emptyDb)),false,'no data folder before the owner is known');check(fs.existsSync(path.join(empty.app,'settings.cjs')),false,'no settings before the owner is known');check(fs.existsSync(path.join(empty.app,'.setup.lock')),false);
 for(const args of [['setup.cjs','--owner-email=owner@outside.test'],['setup.cjs','--owner-email='],['setup.cjs','--owner-email'],['setup.cjs','--owner-name=Someone'],['setup.cjs','--owner'],['setup.cjs','--owner-email=owner@yourrest.org','--owner-name=line\nbreak']]){result=await run(empty,args);check(result.code,1,args.join(' ')+': '+result.output);check(fs.existsSync(emptyDb),false,args.join(' '));}
 result=await run(empty,['setup.cjs','--owner-email', 'New.Owner@YourRest.org','--owner-name=مالك تجريبي']);check(result.code,0,result.output);summary=lastJson(result.output);
 check(summary.newDatabase,true);check(summary.initialData,'none');check(summary.counts.crm_members,1);check(summary.counts.crm_settings,1);check(summary.counts.crm_records,0);check(summary.counts.crm_audit,0);check(summary.migrations,fs.readdirSync('drizzle').filter(name=>name.endsWith('.sql')).length);
 let owner=new DatabaseSync(emptyDb,{readOnly:true});
 check({...owner.prepare("SELECT m.id,m.email,m.name,m.role,m.active,m.region_scope,m.supervisor_id FROM crm_settings s JOIN crm_members m ON m.user_id=s.owner_id WHERE s.id='company'").get()},{id:'owner',email:'new.owner@yourrest.org',name:'مالك تجريبي',role:'admin',active:1,region_scope:'all',supervisor_id:null});
 check(owner.prepare('PRAGMA integrity_check').get().integrity_check,'ok');check(owner.prepare('PRAGMA foreign_key_check').all(),[]);owner.close();
 check(fs.statSync(emptyDb).mode&0o777,0o600);check(fs.statSync(path.dirname(emptyDb)).mode&0o777,0o700);check(fs.statSync(path.join(empty.app,'settings.cjs')).mode&0o777,0o600);
 const emptyHash=hash(emptyDb);
 result=await run(empty);check(result.code,0,result.output);check(lastJson(result.output).newDatabase,false);check(lastJson(result.output).initialData,undefined);check(hash(emptyDb),emptyHash,'a second setup changes nothing');
 result=await run(empty,['setup.cjs','--owner-email=other@yourrest.org']);check(result.code,1);assert.match(result.output,/first installation only/);checks++;check(hash(emptyDb),emptyHash,'the owner is never replaced by setup');
 result=await run(empty,['app.cjs']);check(result.code,0,result.output);
 // Default owner name, and the owner of an empty database is the one the protected-owner rule accepts.
 const named=fixture('empty-default-name',{seeded:false});result=await run(named,['setup.cjs','--owner-email=owner@yourrest.org']);check(result.code,0,result.output);
 owner=new DatabaseSync(named.filename,{readOnly:true});check(owner.prepare("SELECT name FROM crm_members WHERE id='owner'").get().name,'مدير النظام');owner.close();
 assert.throws(()=>initializeDatabase({...options(named,path.join(named.parent,'yourrest-crm-data/second.sqlite')),seed:undefined,checksum:undefined}),/needs its owner/);checks++;
 assert.throws(()=>initializeDatabase({...options(named,path.join(named.parent,'yourrest-crm-data/second.sqlite')),seed:undefined,checksum:undefined,owner:{email:'owner@yourrest.org.evil.test'}}),/yourrest\.org/);checks++;
 assert.throws(()=>initializeDatabase({...options(first,path.join(first.parent,'yourrest-crm-data/second.sqlite')),owner:{email:'owner@yourrest.org'}}),/not both/);checks++;
 check(fs.readdirSync(path.join(named.parent,'yourrest-crm-data')).sort(),['database.sqlite','objects']);
 // A seed placed by hand: refused with a seed AND an owner, without its checksum, or with a checksum that does not match.
 const handPlaced=fixture('hand-placed',{seeded:false}),made=madeUpSnapshot(handPlaced.migrations);writeMadeUpSeed(made.snapshot,handPlaced.seed,handPlaced.checksum);
 result=await run(handPlaced,['setup.cjs','--owner-email=owner@yourrest.org']);check(result.code,1);assert.match(result.output,/initial data file/);checks++;check(fs.existsSync(handPlaced.filename),false);
 const savedChecksum=fs.readFileSync(handPlaced.checksum);fs.unlinkSync(handPlaced.checksum);
 result=await run(handPlaced);check(result.code,1);assert.match(result.output,/checksum of the initial data file is missing/);checks++;check(fs.existsSync(handPlaced.filename),false);
 fs.writeFileSync(handPlaced.checksum,'0'.repeat(64)+'\n',{mode:0o600});
 result=await run(handPlaced);check(result.code,1);assert.match(result.output,/checksum mismatch/);checks++;check(fs.existsSync(handPlaced.filename),false);check(fs.readdirSync(path.dirname(handPlaced.filename)).filter(name=>name!=='objects'),[]);
 fs.unlinkSync(handPlaced.seed);fs.writeFileSync(handPlaced.checksum,savedChecksum,{mode:0o600});
 result=await run(handPlaced);check(result.code,1);assert.match(result.output,/initial data file is missing/);checks++;check(fs.existsSync(handPlaced.filename),false);
 writeMadeUpSeed(made.snapshot,handPlaced.seed,handPlaced.checksum);
 result=await run(handPlaced);check(result.code,0,result.output);summary=lastJson(result.output);check(summary.newDatabase,true);check(summary.initialData,'file');
 for(const [table,count] of Object.entries(made.counts))check(summary.counts[table],count,table);
 check(made.counts.crm_members,3);assert(made.counts.crm_records>=3);checks++;
 const loaded=new DatabaseSync(handPlaced.filename,{readOnly:true});
 check(loaded.prepare("SELECT COUNT(*) n FROM crm_records WHERE kind='customer' AND json_extract(data,'$.phone') LIKE '05000000%' AND json_extract(data,'$.email') LIKE '%@example.com'").get().n,made.counts.crm_records-2,'every made-up customer');
 check(loaded.prepare("SELECT email FROM crm_members WHERE id='owner'").get().email,'owner@yourrest.org');loaded.close();
 console.log(JSON.stringify({ok:true,checks,canonical_settings:true,unrecognized_database_unchanged:true,no_clobber_publish:true,exclusive_setup_lock:true,empty_installation_with_owner:true,hand_placed_seed_checksum_checked:true,production_data_used:false}));
}finally{fs.rmSync(work,{recursive:true,force:true});}
