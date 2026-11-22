// Migration 0025 («المستهدف في يوم الخطة», the owner 2026-11-22: the port of GSCO 2.13.85): twenty-six migrations; the upgrade of a database
// of 25 migrations (the release before, with made-up plans, stops, notes, follow-ups and their audit written as it writes them) with its
// private backup; every existing table and row kept exactly (crm_daily_plans and its stops unchanged); the new table empty with its own checks
// (0 to 50, whole numbers, the mark 0 or 1, one row a plan, gone with its plan, no plan that is not there); then the way back: a code-only
// rollback is refused by the previous release (by design, portable/initialize.mjs), the schema backup opens with it, and the down migration
// (drizzle/rollback/0025_daily_plan_targets.down.sql) leaves exactly the 25-migration schema with every row written since the update but the
// targets (the moved follow-ups and their audit lines «ترحيل موعد المتابعة» kept), after which the previous release opens it with nothing
// pending, its plans read as they were, and the release can be applied again. The down file is never read as a migration. Synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {initializeDatabase,inspectInitializedDatabase} from '../portable/initialize.mjs';
import {upgradeExistingDatabase} from '../portable/upgrade.mjs';

const root=process.cwd(),work=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-plan-targets-migration-'));
process.on('exit',()=>fs.rmSync(work,{recursive:true,force:true}));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const throws=(fn,pattern,message)=>{assert.throws(fn,pattern,message);checks++;};

const NEW='0025_daily_plan_targets.sql',DOWN=path.join(root,'drizzle','rollback','0025_daily_plan_targets.down.sql');
const all=fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort().filter(name=>name<=NEW),before=all.filter(name=>name<NEW);
eq([all.length,all.at(-1),before.length,before.at(-1)],[26,NEW,25,'0024_local_streets.sql'],'twenty-six migrations, the newest the plans\' targets; the release before has 25');
eq(fs.existsSync(DOWN),true,'the down migration ships beside them, in drizzle/rollback/');
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fixture=(name,names,{rollbackDir=false}={})=>{
 const appRoot=path.join(work,name,'app'),migrations=path.join(appRoot,'release','drizzle'),data=path.join(work,name,'private-data');
 fs.mkdirSync(migrations,{recursive:true,mode:0o700});fs.mkdirSync(data,{mode:0o700});
 for(const file of names)fs.copyFileSync(path.join(root,'drizzle',file),path.join(migrations,file));
 if(rollbackDir){fs.mkdirSync(path.join(migrations,'rollback'));fs.copyFileSync(DOWN,path.join(migrations,'rollback',path.basename(DOWN)));}
 fs.writeFileSync(path.join(migrations,'manifest.json'),JSON.stringify({format:'yourrest-migrations-v1',files:names.map(file=>({name:file,sha256:digest(path.join(migrations,file))}))}));
 return{filename:path.join(data,'database.sqlite'),migrations,appRoot,owner:{email:'plan-targets-migration@yourrest.org',name:'مالك اصطناعي'}};
};
const read=(filename,fn)=>{const db=new DatabaseSync(filename,{readOnly:true});try{return fn(db);}finally{db.close();}};
const TABLE='crm_daily_plan_targets';
const tables=db=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
const dump=(db,{skip=[]}={})=>Object.fromEntries(tables(db).filter(name=>!skip.includes(name)).map(name=>[name,db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all().map(row=>{const copy={...row};if(name==='yr_schema_migrations')delete copy.applied_at;return copy;})]));
const schema=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(row=>({...row}));
const isNew=row=>row.tbl_name===TABLE;

// ---- 1. a fresh installation takes the 26 migrations; the down file is not one
const fresh=fixture('fresh',all,{rollbackDir:true});
eq(initializeDatabase(fresh).migrations,26,'a new database takes the twenty-six migrations (the rollback folder beside them is not read)');
eq(read(fresh.filename,db=>tables(db).includes(TABLE)),true,'with the targets\' table');
{
 const bare=fixture('bare',[]);fs.rmSync(path.join(bare.migrations,'manifest.json'));
 for(const file of all)fs.copyFileSync(path.join(root,'drizzle',file),path.join(bare.migrations,file));
 fs.mkdirSync(path.join(bare.migrations,'rollback'));fs.copyFileSync(DOWN,path.join(bare.migrations,'rollback',path.basename(DOWN)));
 eq(initializeDatabase(bare).migrations,26,'without a manifest (development) the down file is not a migration either');
}

// ---- 2. a database of the release before, with its data
const old=fixture('upgrade',before);
eq(initializeDatabase(old).migrations,25,'the schema of the release before: 25 migrations');
const t='2026-11-22T06:00:00.000Z';
{
 const db=new DatabaseSync(old.filename);db.exec('PRAGMA foreign_keys=ON');
 const member=(id,role,sup,region='eastern')=>db.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,active,target,created_at,region_scope) VALUES(?,?,?,?,?,'الرئيسي',?,1,0,?,?)").run(id,'u-'+id,id+'@yourrest.org','عضو '+id,role,sup,t,region);
 member('mgr','manager',null,'all');member('sup','supervisor','mgr');member('rep','rep','sup');
 const record=(id,kind,parent,assigned,data)=>db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,'الرئيسي',?,?,?,1,'old')").run(id,kind,parent,assigned,JSON.stringify(data),t,t);
 record('c1','customer',null,'rep',{name:'مصنع أ',region:'الشرقية'});
 record('a1','activity','c1','rep',{type:'call',date:'2026-11-20',result:'تمت',performedBy:'rep',nextAction:'متابعة',nextDate:'2026-11-21'});
 db.prepare("INSERT INTO crm_daily_plans(id,member_id,date,status,version,first_sent_at,first_sent_source,late,sent_at,received_at,mutation_id,created_at,updated_at) VALUES('daily-plan:rep:2026-11-23','rep','2026-11-23','sent',1,?,'server',0,?,?,'m',?,?)").run(t,t,t,t,t);
 db.prepare("INSERT INTO crm_daily_plan_stops(id,plan_id,position,customer_id,kind,planned_time,note,added_by,supervisor_state,edited_by,created_at,updated_at) VALUES('s1','daily-plan:rep:2026-11-23',1,'c1','visit','','','rep','',NULL,?,?)").run(t,t);
 db.prepare("INSERT INTO crm_daily_plan_notes(member_id,date,reviewer_id,note,version,mutation_id,created_at,updated_at) VALUES('rep','2026-11-23','sup','جيد',1,'n',?,?)").run(t,t);
 db.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES('daily-plan:rep:x','daily-plan:rep:2026-11-23','عضو rep','daily-plan:send','{}',?)").run(t);
 db.close();
}
const beforeRows=read(old.filename,dump),beforeSchema=read(old.filename,schema);
fs.copyFileSync(path.join(root,'drizzle',NEW),path.join(old.migrations,NEW));
fs.writeFileSync(path.join(old.migrations,'manifest.json'),JSON.stringify({format:'yourrest-migrations-v1',files:all.map(file=>({name:file,sha256:digest(path.join(old.migrations,file))}))}));
eq(inspectInitializedDatabase(old),{pending:[NEW],migrations:26},'0025 is the one pending migration');
const upgraded=await upgradeExistingDatabase(old);
eq([upgraded.upgraded,upgraded.migrations,path.basename(upgraded.backup).startsWith('before-0025_daily_plan_targets-')],[true,26,true],'the upgrade applies it after a private schema backup');
eq(read(upgraded.backup,db=>[db.prepare('SELECT COUNT(*) n FROM yr_schema_migrations').get().n,dump(db)]),[25,beforeRows],'the backup is the 25-migration database, every row as it was');
const afterRows=read(old.filename,db=>dump(db,{skip:[TABLE]}));
eq(Object.keys(afterRows),Object.keys(beforeRows),'no table of the release before is gone or new besides the targets\'');
for(const table of Object.keys(beforeRows))if(table!=='yr_schema_migrations')eq(afterRows[table],beforeRows[table],table+': every row unchanged');
eq(afterRows.yr_schema_migrations.map(row=>row.name),[...beforeRows.yr_schema_migrations.map(row=>row.name),NEW],'the ledger gains 0025 only');
const afterSchema=read(old.filename,schema);
eq(afterSchema.filter(row=>!isNew(row)),beforeSchema,'every table, index and trigger of the release before unchanged (crm_daily_plans and its stops among them)');
eq(afterSchema.filter(isNew).map(row=>row.type+':'+row.name),['index:sqlite_autoindex_crm_daily_plan_targets_1','table:crm_daily_plan_targets'].filter(name=>!name.startsWith('index:sqlite_')),'one table');
eq(read(old.filename,db=>[db.prepare(`SELECT COUNT(*) n FROM ${TABLE}`).get().n,db.prepare('PRAGMA foreign_key_check').all().length,db.prepare('PRAGMA integrity_check').get().integrity_check]),[0,0,'ok'],'empty (a plan of the release before has no targets: «لم يُحدَّد»), the keys and the file sound');
eq(read(old.filename,db=>db.prepare(`PRAGMA table_info(${TABLE})`).all().map(row=>[row.name,row.type,row.notnull,row.dflt_value,row.pk])),[['plan_id','TEXT',1,null,1],['target_opportunities','INTEGER',0,null,0],['target_customers','INTEGER',0,null,0],['rep_target_opportunities','INTEGER',0,null,0],['rep_target_customers','INTEGER',0,null,0],['targets_edited','INTEGER',1,'0',0],['updated_at','TEXT',1,null,0]],'its columns');
eq(read(old.filename,db=>db.prepare(`PRAGMA foreign_key_list(${TABLE})`).all().map(row=>[row.table,row.from,row.to,row.on_delete])),[['crm_daily_plans','plan_id','id','CASCADE']],'its plan, deleted with it');

// ---- 3. the database's own checks
{
 const db=new DatabaseSync(old.filename);db.exec('PRAGMA foreign_keys=ON');
 const put=(values={})=>{const row={plan:'daily-plan:rep:2026-11-23',o:0,c:50,ro:null,rc:null,edited:0,...values};return db.prepare(`INSERT INTO ${TABLE}(plan_id,target_opportunities,target_customers,rep_target_opportunities,rep_target_customers,targets_edited,updated_at) VALUES(?,?,?,?,?,?,?)`).run(row.plan,row.o,row.c,row.ro,row.rc,row.edited,t);};
 put();
 throws(()=>put(),/UNIQUE|PRIMARY/,'one row a plan');
 db.exec(`DELETE FROM ${TABLE}`);
 throws(()=>put({plan:'daily-plan:rep:2026-11-30'}),/FOREIGN KEY/,'no row for a plan that is not there');
 for(const [field,value,label] of [['o',51,'51'],['c',-1,'-1'],['o',1.5,'1.5'],['c','ثلاثة','a text'],['ro',51,'the member\'s own 51'],['rc',-1,'the member\'s own -1'],['edited',2,'a mark of 2']])throws(()=>put({[field]:value}),/CHECK/,label+' is refused');
 throws(()=>db.prepare(`INSERT INTO ${TABLE}(plan_id,targets_edited,updated_at) VALUES('daily-plan:rep:2026-11-23',NULL,?)`).run(t),/NOT NULL/,'the mark is never empty');
 put({o:null,c:null});db.exec(`DELETE FROM ${TABLE}`);put({o:0,c:0,ro:50,rc:0,edited:1});
 db.exec(`DELETE FROM ${TABLE}`);put({o:3,c:4});
 db.exec("DELETE FROM crm_daily_plans WHERE id='daily-plan:rep:2026-11-23'");
 eq(db.prepare(`SELECT COUNT(*) n FROM ${TABLE}`).get().n,0,'the targets go with their plan');
 db.close();
}
// The rows deleted by the checks above are put back as they were, so what follows works on the data of the release before.
{
 const db=new DatabaseSync(old.filename);db.exec('PRAGMA foreign_keys=ON');
 db.prepare("INSERT INTO crm_daily_plans(id,member_id,date,status,version,first_sent_at,first_sent_source,late,sent_at,received_at,mutation_id,created_at,updated_at) VALUES('daily-plan:rep:2026-11-23','rep','2026-11-23','sent',1,?,'server',0,?,?,'m',?,?)").run(t,t,t,t,t);
 db.prepare("INSERT INTO crm_daily_plan_stops(id,plan_id,position,customer_id,kind,planned_time,note,added_by,supervisor_state,edited_by,created_at,updated_at) VALUES('s1','daily-plan:rep:2026-11-23',1,'c1','visit','','','rep','',NULL,?,?)").run(t,t);
 db.close();
}

// ---- 4. going back
// 4a. code only: the release before refuses the migrated database at start and writes nothing.
const previous=fixture('previous',before);fs.rmSync(path.dirname(previous.filename),{recursive:true,force:true});fs.mkdirSync(path.dirname(previous.filename),{mode:0o700});
fs.copyFileSync(old.filename,previous.filename);
throws(()=>inspectInitializedDatabase(previous),/newer than this package/,'the release before (25 migrations) refuses the migrated database: a code-only rollback does not start');
throws(()=>initializeDatabase(previous),/newer than this package/,'and changes nothing');
// 4b. the schema backup: the release before opens it (what was written after the update is lost).
fs.copyFileSync(upgraded.backup,previous.filename);
eq(inspectInitializedDatabase(previous),{pending:[],migrations:25},'the release before with the schema backup: nothing pending');
eq(read(previous.filename,dump),beforeRows,'every row as before the update');
// 4c. the down migration on a database used after the update: targets, a follow-up moved with its audit line, a plan sent since.
{
 const db=new DatabaseSync(old.filename);db.exec('PRAGMA foreign_keys=ON');
 db.prepare(`INSERT INTO ${TABLE}(plan_id,target_opportunities,target_customers,rep_target_opportunities,rep_target_customers,targets_edited,updated_at) VALUES('daily-plan:rep:2026-11-23',3,2,5,2,1,?)`).run(t);
 db.prepare("UPDATE crm_records SET data=json_set(data,'$.nextDate','2026-11-23'),version=2 WHERE id='a1'").run();
 db.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES('followup-next-date:rep:2026-11-23:r:a1','a1','عضو rep','ترحيل موعد المتابعة','2026-11-21 → 2026-11-23 • {}',?)").run(t);
 db.prepare("INSERT INTO crm_daily_plans(id,member_id,date,status,version,first_sent_at,first_sent_source,late,sent_at,received_at,mutation_id,created_at,updated_at) VALUES('daily-plan:rep:2026-11-24','rep','2026-11-24','sent',1,?,'server',0,?,?,'m2',?,?)").run(t,t,t,t,t);
 db.prepare(`INSERT INTO ${TABLE}(plan_id,target_opportunities,target_customers,targets_edited,updated_at) VALUES('daily-plan:rep:2026-11-24',0,1,0,?)`).run(t);
 db.close();
}
const usedRows=read(old.filename,db=>dump(db,{skip:[TABLE]}));
const down=fixture('down',before);fs.rmSync(path.dirname(down.filename),{recursive:true,force:true});fs.mkdirSync(path.dirname(down.filename),{mode:0o700});
fs.copyFileSync(old.filename,down.filename);
const runDown=(filename,patch=text=>text)=>{const db=new DatabaseSync(filename);db.exec('PRAGMA foreign_keys=ON');try{db.exec(patch(fs.readFileSync(DOWN,'utf8')));}finally{try{db.exec('ROLLBACK');}catch{/* committed or never begun */}db.close();}};
// A down that fails half-way changes nothing (one transaction).
{
 const failing=path.join(work,'failing.sqlite');fs.copyFileSync(old.filename,failing);
 throws(()=>runDown(failing,text=>text.replace('BEGIN IMMEDIATE;','BEGIN IMMEDIATE; SELECT * FROM missing_table;')),/no such table/,'a failing down migration stops');
 eq(read(failing,db=>[tables(db).includes(TABLE),db.prepare('SELECT COUNT(*) n FROM yr_schema_migrations').get().n]),[true,26],'and changes nothing');
}
runDown(down.filename);
eq(read(down.filename,schema),beforeSchema,'after the down migration the schema is exactly the release before\'s');
const downRows=read(down.filename,dump);
eq(downRows.yr_schema_migrations,beforeRows.yr_schema_migrations,'the ledger is the release before\'s 25');
for(const table of Object.keys(usedRows))if(table!=='yr_schema_migrations')eq(downRows[table],usedRows[table],table+': every row kept, those written after the update too (the moved follow-up and its line among them)');
eq(read(down.filename,db=>[db.prepare('PRAGMA foreign_key_check').all().length,db.prepare('PRAGMA integrity_check').get().integrity_check]),[0,'ok'],'the keys and the file sound');
eq(inspectInitializedDatabase(down),{pending:[],migrations:25},'the release before opens it with nothing pending');
eq(initializeDatabase(down).migrations,25,'and starts on it');
eq(read(down.filename,db=>db.prepare("SELECT id,status FROM crm_daily_plans ORDER BY id").all().map(row=>[row.id,row.status])),[['daily-plan:rep:2026-11-23','sent'],['daily-plan:rep:2026-11-24','sent']],'its plans as they were, the one sent since included');
// 4d. the release applied again after the down migration: the table comes back empty.
const again=fixture('again',all);fs.rmSync(path.dirname(again.filename),{recursive:true,force:true});fs.mkdirSync(path.dirname(again.filename),{mode:0o700});
fs.copyFileSync(down.filename,again.filename);
eq((await upgradeExistingDatabase(again)).migrations,26,'the release can be applied again');
eq(read(again.filename,db=>db.prepare(`SELECT COUNT(*) n FROM ${TABLE}`).get().n),0,'with an empty table');
eq(read(again.filename,schema),afterSchema,'and the same schema as the first upgrade');

console.log(JSON.stringify({ok:true,checks}));
