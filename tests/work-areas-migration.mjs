// Migrations 0023 (the representatives' work areas and the street cache) and 0024 (the local street data), «خريطة المصانع» (the owner,
// 2026-11-19: the port of GSCO 2.13.81 and 2.13.82): twenty-five migrations; the upgrade of a database of 23 migrations (the live release with
// «خطط المناديب») holding made-up data written as the previous release writes it (members, customers, visits, a plan, permissions, the audit),
// with its private backup; every existing table and row kept exactly; the three new tables empty with their own checks (CHECK, UNIQUE, FOREIGN
// KEY); then the way back: a code-only rollback is refused by the previous release (by design, portable/initialize.mjs), the schema backup
// opens with the previous release, and the two down migrations (drizzle/rollback/0024_local_streets.down.sql, then 0023_work_areas.down.sql)
// leave exactly the 23-migration schema with every row written since the update but the work areas' own, after which the previous release
// opens it with nothing pending and the release can be applied again. 0023's down refuses while 0024 is still recorded, and changes nothing.
// The down files are never read as migrations. Synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {initializeDatabase,inspectInitializedDatabase} from '../portable/initialize.mjs';
import {upgradeExistingDatabase} from '../portable/upgrade.mjs';

const root=process.cwd(),work=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-work-areas-migration-'));
process.on('exit',()=>fs.rmSync(work,{recursive:true,force:true}));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const throws=(fn,pattern,message)=>{assert.throws(fn,pattern,message);checks++;};

const NEW=['0023_work_areas.sql','0024_local_streets.sql'],DOWN=['0024_local_streets.down.sql','0023_work_areas.down.sql'].map(name=>path.join(root,'drizzle','rollback',name));
const all=fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort(),before=all.filter(name=>name<NEW[0]);
eq([all.length,all.slice(-2),before.length,before.at(-1)],[25,NEW,23,'0022_daily_plans.sql'],'twenty-five migrations, the newest the work areas and the local streets; the live release has 23');
eq(DOWN.map(file=>fs.existsSync(file)),[true,true],'the down migrations ship beside them, in drizzle/rollback/');
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fixture=(name,names,{rollbackDir=false}={})=>{
 const appRoot=path.join(work,name,'app'),migrations=path.join(appRoot,'release','drizzle'),data=path.join(work,name,'private-data');
 fs.mkdirSync(migrations,{recursive:true,mode:0o700});fs.mkdirSync(data,{mode:0o700});
 for(const file of names)fs.copyFileSync(path.join(root,'drizzle',file),path.join(migrations,file));
 if(rollbackDir){fs.mkdirSync(path.join(migrations,'rollback'));for(const file of DOWN)fs.copyFileSync(file,path.join(migrations,'rollback',path.basename(file)));}
 fs.writeFileSync(path.join(migrations,'manifest.json'),JSON.stringify({format:'yourrest-migrations-v1',files:names.map(file=>({name:file,sha256:digest(path.join(migrations,file))}))}));
 return{filename:path.join(data,'database.sqlite'),migrations,appRoot,owner:{email:'work-areas-migration@yourrest.org',name:'مالك اصطناعي'}};
};
const read=(filename,fn)=>{const db=new DatabaseSync(filename,{readOnly:true});try{return fn(db);}finally{db.close();}};
const NEW_TABLES=['crm_osm_street_cache','crm_osm_street_local','crm_work_areas'];
const tables=db=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
const dump=(db,{skip=[]}={})=>Object.fromEntries(tables(db).filter(name=>!skip.includes(name)).map(name=>[name,db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all().map(row=>{const copy={...row};if(name==='yr_schema_migrations')delete copy.applied_at;return copy;})]));
const schema=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(row=>({...row}));
const isNew=row=>NEW_TABLES.includes(row.tbl_name);

// ---- 1. a fresh installation takes the 25 migrations; the down files are not
const fresh=fixture('fresh',all,{rollbackDir:true});
eq(initializeDatabase(fresh).migrations,25,'a new database takes the twenty-five migrations (the rollback folder beside them is not read)');
eq(read(fresh.filename,db=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('crm_work_areas','crm_osm_street_cache','crm_osm_street_local') ORDER BY name").all().map(row=>row.name)),NEW_TABLES,'with the three new tables');
{
 const bare=fixture('bare',[]);fs.rmSync(path.join(bare.migrations,'manifest.json'));
 for(const file of all)fs.copyFileSync(path.join(root,'drizzle',file),path.join(bare.migrations,file));
 fs.mkdirSync(path.join(bare.migrations,'rollback'));for(const file of DOWN)fs.copyFileSync(file,path.join(bare.migrations,'rollback',path.basename(file)));
 eq(initializeDatabase(bare).migrations,25,'without a manifest (development) the down files are not migrations either');
}

// ---- 2. a database of the previous release, with its data
const old=fixture('upgrade',before);
eq(initializeDatabase(old).migrations,23,'the live schema: 23 migrations');
const t='2026-11-19T06:00:00.000Z';
{
 const db=new DatabaseSync(old.filename);db.exec('PRAGMA foreign_keys=ON');
 const member=(id,role,sup,region='eastern')=>db.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,active,target,created_at,region_scope) VALUES(?,?,?,?,?,'الرئيسي',?,1,0,?,?)").run(id,'u-'+id,id+'@yourrest.org','عضو '+id,role,sup,t,region);
 member('mgr','manager',null,'all');member('sup','supervisor','mgr');member('rep','rep','sup');member('mk','marketing','sup');member('cs','customer_service','mgr');
 const record=(id,kind,parent,assigned,data)=>db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,'الرئيسي',?,?,?,1,'old')").run(id,kind,parent,assigned,JSON.stringify(data),t,t);
 record('c1','customer',null,'rep',{name:'مصنع أ',region:'الشرقية',location:'26.43, 50.1'});record('c2','customer',null,'rep',{name:'مصنع ب',region:'الشرقية'});
 record('a1','activity','c1','rep',{type:'visit',date:'2026-11-19',result:'تمت',performedBy:'rep'});
 db.prepare("INSERT INTO crm_daily_plans(id,member_id,date,status,version,first_sent_at,first_sent_source,late,sent_at,received_at,mutation_id,created_at,updated_at) VALUES('daily-plan:rep:2026-11-20','rep','2026-11-20','sent',1,?,'server',0,?,?,'m',?,?)").run(t,t,t,t,t);
 db.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('mgr','{\"map:edit\":true}','[]',2,'mgr',?)").run(t);
 db.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES('kept','c1','عضو rep','تعديل','{}',?)").run(t);
 db.close();
}
const beforeRows=read(old.filename,dump),beforeSchema=read(old.filename,schema);
for(const name of NEW)fs.copyFileSync(path.join(root,'drizzle',name),path.join(old.migrations,name));
fs.writeFileSync(path.join(old.migrations,'manifest.json'),JSON.stringify({format:'yourrest-migrations-v1',files:all.map(file=>({name:file,sha256:digest(path.join(old.migrations,file))}))}));
eq(inspectInitializedDatabase(old),{pending:NEW,migrations:25},'0023 and 0024 are the two pending migrations');
const upgraded=await upgradeExistingDatabase(old);
eq([upgraded.upgraded,upgraded.migrations,path.basename(upgraded.backup).startsWith('before-0023_work_areas-')],[true,25,true],'the upgrade applies both after one private schema backup');
eq(read(upgraded.backup,db=>[db.prepare('SELECT COUNT(*) n FROM yr_schema_migrations').get().n,dump(db)]),[23,beforeRows],'the backup is the 23-migration database, every row as it was');
const afterRows=read(old.filename,db=>dump(db,{skip:NEW_TABLES}));
eq(Object.keys(afterRows),Object.keys(beforeRows),'no table of the previous release is gone or new besides the three');
for(const table of Object.keys(beforeRows))if(table!=='yr_schema_migrations')eq(afterRows[table],beforeRows[table],table+': every row unchanged');
eq(afterRows.yr_schema_migrations.map(row=>row.name),[...beforeRows.yr_schema_migrations.map(row=>row.name),...NEW],'the ledger gains 0023 and 0024 only');
const afterSchema=read(old.filename,schema);
eq(afterSchema.filter(row=>!isNew(row)),beforeSchema,'every table, index and trigger of the previous release unchanged');
eq(afterSchema.filter(isNew).map(row=>row.type+':'+row.name),['index:crm_osm_street_cache_fetched','index:crm_osm_street_local_cell','table:crm_osm_street_cache','table:crm_osm_street_local','table:crm_work_areas'],'the three tables and their two indexes');
eq(read(old.filename,db=>[...NEW_TABLES.map(name=>db.prepare(`SELECT COUNT(*) n FROM "${name}"`).get().n),db.prepare('PRAGMA foreign_key_check').all().length,db.prepare('PRAGMA integrity_check').get().integrity_check]),[0,0,0,0,'ok'],'empty, the keys and the file sound');

// ---- 3. the database's own checks
const polygon=JSON.stringify({type:'Polygon',coordinates:[[[50.09,26.42],[50.11,26.42],[50.11,26.44],[50.09,26.42]]]});
{
 const db=new DatabaseSync(old.filename);db.exec('PRAGMA foreign_keys=ON');
 const area=(member,extra={})=>{const row={vertices:3,area:4e6,version:1,by:'mgr',...extra};return db.prepare('INSERT INTO crm_work_areas(member_id,polygon,vertices,area_m2,updated_by,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?)').run(member,polygon,row.vertices,row.area,row.by,t,row.version,'m-'+member);};
 area('rep');
 throws(()=>area('rep'),/UNIQUE|PRIMARY/,'one area a member');
 throws(()=>area('ghost'),/FOREIGN KEY/,'a member who is not there');
 throws(()=>area('mk',{by:'ghost'}),/FOREIGN KEY/,'drawn by someone who is not there');
 throws(()=>area('mk',{vertices:2}),/CHECK/,'at least three corners');
 throws(()=>area('mk',{vertices:201}),/CHECK/,'at most two hundred');
 throws(()=>area('mk',{area:0}),/CHECK/,'an area above zero');
 throws(()=>area('mk',{area:40000001}),/CHECK/,'at most 40 km²');
 throws(()=>area('mk',{version:0}),/CHECK/,'a version from 1');
 throws(()=>db.prepare("DELETE FROM crm_members WHERE id='rep'").run(),/FOREIGN KEY/,'a member with an area is never deleted under it');
 db.prepare("INSERT INTO crm_osm_street_cache VALUES('26.42,50.09,26.44,50.11',26.42,50.09,26.44,50.11,'{\"v\":1,\"ways\":[]}',0,?)").run(t);
 throws(()=>db.prepare("INSERT INTO crm_osm_street_cache VALUES('k',1,2,3,4,'{}',-1,?)").run(t),/CHECK/,'a count of streets from 0');
 const cell=(key,lat,lng)=>db.prepare("INSERT INTO crm_osm_street_local VALUES(?,?,?,?,?,?,?,'{\"v\":1,\"ways\":[]}',0,'eastern-1','osm:test',?)").run(key,lat,lng,lat/100,lng/100,(lat+1)/100,(lng+1)/100,t);
 cell('26.42,50.09,26.43,50.10',2642,5009);
 throws(()=>cell('another key',2642,5009),/UNIQUE/,'one row per cell');
 throws(()=>cell('26.42,50.09,26.43,50.10',2642,5010),/UNIQUE|PRIMARY/,'one row per key');
 db.exec('DELETE FROM crm_work_areas;DELETE FROM crm_osm_street_cache;DELETE FROM crm_osm_street_local');
 db.close();
}

// ---- 4. going back
// 4a. code only: the previous release refuses the migrated database at start and writes nothing.
const previous=fixture('previous',before);fs.rmSync(path.dirname(previous.filename),{recursive:true,force:true});fs.mkdirSync(path.dirname(previous.filename),{mode:0o700});
fs.copyFileSync(old.filename,previous.filename);
throws(()=>inspectInitializedDatabase(previous),/newer than this package/,'the previous release (23 migrations) refuses the migrated database: a code-only rollback does not start');
throws(()=>initializeDatabase(previous),/newer than this package/,'and changes nothing');
// 4b. the schema backup: the previous release opens it (what was written after the update is lost).
fs.copyFileSync(upgraded.backup,previous.filename);
eq(inspectInitializedDatabase(previous),{pending:[],migrations:23},'the previous release with the schema backup: nothing pending');
eq(read(previous.filename,dump),beforeRows,'every row as before the update');
// 4c. the down migrations on a database used after the update: an area, the cache, local streets and their audit rows, and other rows written since.
{
 const db=new DatabaseSync(old.filename);db.exec('PRAGMA foreign_keys=ON');
 db.prepare("INSERT INTO crm_work_areas(member_id,polygon,vertices,area_m2,updated_by,updated_at,version,mutation_id) VALUES('rep',?,3,4000000,'mgr',?,2,'m')").run(polygon,t);
 db.prepare("INSERT INTO crm_osm_street_cache VALUES('26.42,50.09,26.44,50.11',26.42,50.09,26.44,50.11,'{\"v\":1,\"ways\":[]}',0,?)").run(t);
 db.prepare("INSERT INTO crm_osm_street_local VALUES('26.42,50.09,26.43,50.10',2642,5009,26.42,50.09,26.43,50.1,'{\"v\":1,\"ways\":[]}',0,'eastern-1','osm:test',?)").run(t);
 for(const action of ['save','save','delete'])db.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,'work-area:rep','عضو mgr',?,'{}',?)").run('work-area:'+crypto.randomUUID(),'work-area:'+action,t);
 db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('a2','activity','c1','rep','الرئيسي','{\"type\":\"call\",\"date\":\"2026-11-20\"}',?,?,1,'new')").run(t,t);
 db.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES('after-update','a2','عضو rep','إضافة','{}',?)").run(t);
 db.close();
}
const usedRows=read(old.filename,db=>dump(db,{skip:NEW_TABLES}));
const down=fixture('down',before);fs.rmSync(path.dirname(down.filename),{recursive:true,force:true});fs.mkdirSync(path.dirname(down.filename),{mode:0o700});
fs.copyFileSync(old.filename,down.filename);
const runDown=(filename,file,patch=text=>text)=>{const db=new DatabaseSync(filename);db.exec('PRAGMA foreign_keys=ON');try{db.exec(patch(fs.readFileSync(file,'utf8')));}finally{try{db.exec('ROLLBACK');}catch{/* committed or never begun */}db.close();}};
// 0023's down first is refused: 0024 is still recorded.
throws(()=>runDown(down.filename,DOWN[1]),/CHECK constraint failed/,'0023\'s down refuses while 0024 is recorded');
eq(read(down.filename,db=>[tables(db).filter(name=>NEW_TABLES.includes(name)),db.prepare('SELECT COUNT(*) n FROM yr_schema_migrations').get().n,db.prepare("SELECT COUNT(*) n FROM crm_audit WHERE action LIKE 'work-area:%'").get().n]),[NEW_TABLES,25,3],'and changes nothing');
runDown(down.filename,DOWN[0]);
eq(read(down.filename,db=>[tables(db).filter(name=>NEW_TABLES.includes(name)),db.prepare('SELECT name FROM yr_schema_migrations ORDER BY name DESC LIMIT 1').get().name]),[['crm_osm_street_cache','crm_work_areas'],'0023_work_areas.sql'],'0024\'s down: the local streets go, 0023 is the last migration');
eq(read(down.filename,db=>db.prepare('SELECT COUNT(*) n FROM crm_work_areas').get().n),1,'the drawn area is still there after 0024\'s down');
runDown(down.filename,DOWN[1]);
eq(read(down.filename,schema),beforeSchema,'after both down migrations the schema is exactly the previous release\'s');
const downRows=read(down.filename,dump);
eq(downRows.yr_schema_migrations,beforeRows.yr_schema_migrations,'the ledger is the previous release\'s 23');
eq(downRows.crm_audit,usedRows.crm_audit.filter(row=>!row.action.startsWith('work-area:')),'the work areas\' own audit rows are gone, every other audit row kept (one written after the update too)');
for(const table of Object.keys(usedRows))if(!['yr_schema_migrations','crm_audit'].includes(table))eq(downRows[table],usedRows[table],table+': every row kept, those written after the update too');
eq(read(down.filename,db=>[db.prepare('PRAGMA foreign_key_check').all().length,db.prepare('PRAGMA integrity_check').get().integrity_check]),[0,'ok'],'the keys and the file sound');
eq(inspectInitializedDatabase(down),{pending:[],migrations:23},'the previous release opens it with nothing pending');
eq(initializeDatabase(down).migrations,23,'and starts on it');
// A down that fails half-way changes nothing (one transaction).
{
 const again=path.join(work,'failing.sqlite');fs.copyFileSync(old.filename,again);
 throws(()=>runDown(again,DOWN[0],text=>text.replace('BEGIN IMMEDIATE;','BEGIN IMMEDIATE; SELECT * FROM missing_table;')),/no such table/,'a failing down migration stops');
 eq(read(again,db=>[tables(db).filter(name=>NEW_TABLES.includes(name)).length,db.prepare('SELECT COUNT(*) n FROM yr_schema_migrations').get().n]),[3,25],'and changes nothing');
}
// 4d. the release applied again after the down migrations: the tables come back empty.
const again=fixture('again',all);fs.rmSync(path.dirname(again.filename),{recursive:true,force:true});fs.mkdirSync(path.dirname(again.filename),{mode:0o700});
fs.copyFileSync(down.filename,again.filename);
eq((await upgradeExistingDatabase(again)).migrations,25,'the release can be applied again');
eq(read(again.filename,db=>NEW_TABLES.map(name=>db.prepare(`SELECT COUNT(*) n FROM "${name}"`).get().n)),[0,0,0],'with empty tables');
eq(read(again.filename,schema),afterSchema,'and the same schema as the first upgrade');

console.log(JSON.stringify({ok:true,checks}));
