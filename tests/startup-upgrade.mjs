import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {initializeDatabase} from '../portable/initialize.mjs';
import {upgradeExistingDatabase} from '../portable/upgrade.mjs';
const root=path.resolve(import.meta.dirname,'..'),work=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-upgrade-'));
let checks=0;
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(name){
 const parent=path.join(work,name),appRoot=path.join(parent,'app'),migrations=path.join(appRoot,'release/drizzle'),data=path.join(parent,'private-data'),filename=path.join(data,'database.sqlite');
 fs.mkdirSync(migrations,{recursive:true,mode:0o700});fs.mkdirSync(data,{mode:0o700});
 for(const file of fs.readdirSync(path.join(root,'drizzle')).filter(name=>name.endsWith('.sql')&&name<'0011'))fs.copyFileSync(path.join(root,'drizzle',file),path.join(migrations,file));
 const options={filename,migrations,appRoot,seed:path.join(root,'migration/initial.json'),checksum:path.join(root,'migration/initial.sha256')};
 initializeDatabase(options);
 const db=new DatabaseSync(filename);db.exec("INSERT INTO crm_journey_stops(id,member_id,date,customer_id,region_scope,snapshot,selected_at,state,data) SELECT 'preserve-journey','owner','2026-09-30',id,'all','{}','2026-09-30T09:00:00.000Z','en_route','{\"gaps\":[],\"events\":[]}' FROM crm_records WHERE kind='customer' LIMIT 1; UPDATE crm_members SET target=987654 WHERE id='owner'; CREATE TABLE test_existing_session(token_hash TEXT PRIMARY KEY,value TEXT); INSERT INTO test_existing_session VALUES('existing','preserve');");db.close();
 return options;
}
function appendCurrent(f){fs.copyFileSync(path.join(root,'drizzle/0011_mobile_route_days.sql'),path.join(f.migrations,'0011_mobile_route_days.sql'));}
function counts(filename){const db=new DatabaseSync(filename,{readOnly:true});try{return {records:db.prepare('SELECT COUNT(*) n FROM crm_records').get().n,session:db.prepare('SELECT * FROM test_existing_session').all(),target:db.prepare("SELECT target FROM crm_members WHERE id='owner'").get().target,journey:db.prepare('SELECT id,data FROM crm_journey_stops').all(),ledger:db.prepare('SELECT COUNT(*) n FROM yr_schema_migrations').get().n};}finally{db.close();}}
try{
 const f=fixture('success'),before=counts(f.filename);appendCurrent(f);
 const result=await upgradeExistingDatabase(f);check(result.upgraded,true);check(result.migrations,12);check(fs.statSync(result.backup).mode&0o777,0o600);check(fs.statSync(path.dirname(result.backup)).mode&0o777,0o700);
 check(counts(result.backup),before,'backup retains the pre-upgrade state');
 check(counts(f.filename),{...before,ledger:12},'existing business data and sessions preserved');
 const db=new DatabaseSync(f.filename,{readOnly:true});check(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'crm_mobile_route_%'").all().length===2,true);check(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');check(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
 const hash=digest(f.filename);check((await upgradeExistingDatabase(f)).upgraded,false);check(digest(f.filename),hash);check(fs.readdirSync(path.dirname(result.backup)).length,1,'no duplicate backups on ordinary restart');
 const invalid=fixture('rollback');fs.writeFileSync(path.join(invalid.migrations,'0011_invalid.sql'),'CREATE TABLE transient_schema_change(id TEXT); INSERT INTO nonexistent_table VALUES(1);');const original=counts(invalid.filename);
 await assert.rejects(upgradeExistingDatabase(invalid),/no such table/);checks++;
 check(counts(invalid.filename),original);const rollback=new DatabaseSync(invalid.filename,{readOnly:true});check(rollback.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='transient_schema_change'").get().n,0);rollback.close();check(fs.readdirSync(path.join(path.dirname(invalid.filename),'schema-backups')).length,1);
 const tampered=fixture('changed-history');fs.appendFileSync(path.join(tampered.migrations,'0009_email_auth.sql'),'\n-- changed applied migration');const untouched=digest(tampered.filename);
 await assert.rejects(upgradeExistingDatabase(tampered),/history/);checks++;check(digest(tampered.filename),untouched);check(fs.existsSync(path.join(path.dirname(tampered.filename),'schema-backups')),false);
 const unknown=fixture('unknown');fs.unlinkSync(unknown.filename);let foreign=new DatabaseSync(unknown.filename);foreign.exec("CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES('keep');");foreign.close();fs.chmodSync(unknown.filename,0o600);const foreignHash=digest(unknown.filename);
 await assert.rejects(upgradeExistingDatabase(unknown),/recognized/);checks++;check(digest(unknown.filename),foreignHash);
 fs.unlinkSync(unknown.filename);await assert.rejects(upgradeExistingDatabase(unknown));checks++;check(fs.existsSync(unknown.filename),false,'startup never creates a database');
 const symlink=fixture('symlink-backup');appendCurrent(symlink);const external=path.join(work,'external');fs.mkdirSync(external,{mode:0o700});fs.symlinkSync(external,path.join(path.dirname(symlink.filename),'schema-backups'));const prior=digest(symlink.filename);await assert.rejects(upgradeExistingDatabase(symlink),/symlink/);checks++;check(digest(symlink.filename),prior);check(fs.readdirSync(external),[]);
 // Exercise the actual Passenger entry point: migrations must finish before server import.
 const startup=fixture('real-startup');appendCurrent(startup);const release=path.dirname(startup.migrations),objects=path.join(path.dirname(startup.filename),'objects');fs.mkdirSync(objects,{mode:0o700});
 fs.cpSync(path.join(root,'portable'),path.join(release,'operations'),{recursive:true});fs.copyFileSync(path.join(root,'portable/app.cjs'),path.join(release,'app.cjs'));
 fs.writeFileSync(path.join(release,'server.js'),"const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.YR_DATABASE_PATH);console.log(JSON.stringify({started:true,journeys:db.prepare('SELECT COUNT(*) n FROM crm_mobile_route_days').get().n,ledger:db.prepare('SELECT COUNT(*) n FROM yr_schema_migrations').get().n}));db.close();");
 const started=spawnSync(process.execPath,['app.cjs'],{cwd:release,encoding:'utf8',env:{PATH:process.env.PATH,YR_APP_ORIGIN:'https://crm.yourrest.org',YR_AUTH_SECRET:'a'.repeat(64),YR_DATABASE_PATH:startup.filename,YR_OBJECTS_PATH:objects}});
 check(started.status,0,started.stderr);check(JSON.parse(started.stdout.trim()),{started:true,journeys:0,ledger:12});check(fs.readdirSync(path.join(path.dirname(startup.filename),'schema-backups')).length,1);
 console.log(JSON.stringify({ok:true,checks,upgradeFromElevenToTwelve:true,privateBackupVerified:true,existingDataAndSessionsPreserved:true,rollbackVerified:true,noProductionDataUsed:true}));
}finally{fs.rmSync(work,{recursive:true,force:true});}
