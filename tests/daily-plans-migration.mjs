// Migration 0022 («خطة الغد» / «خطط المناديب», the owner 2026-11-19): twenty-three migrations; the upgrade of a database of 22 migrations
// holding made-up data written as the previous release writes it (members, customers, visits, the supervisor's notes, customer-service
// requests, permissions, the audit), with its private backup; every existing table and row kept exactly; the three new tables empty with
// their own checks (CHECK, UNIQUE, FOREIGN KEY, the stops going with their plan); then the way back: a code-only rollback is refused by the
// previous release (by design, portable/initialize.mjs), the schema backup opens with the previous release, and the down migration
// (drizzle/rollback/0022_daily_plans.down.sql) leaves exactly the 22-migration schema with every row written since the update but the
// plans' own, after which the previous release opens it with nothing pending and the release can be applied again. The down file is never
// read as a migration. Synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {initializeDatabase,inspectInitializedDatabase} from '../portable/initialize.mjs';
import {upgradeExistingDatabase} from '../portable/upgrade.mjs';

const root=process.cwd(),work=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-daily-plans-migration-'));
process.on('exit',()=>fs.rmSync(work,{recursive:true,force:true}));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const throws=(fn,pattern,message)=>{assert.throws(fn,pattern,message);checks++;};

const NEW='0022_daily_plans.sql',DOWN=path.join(root,'drizzle','rollback','0022_daily_plans.down.sql');
// A later release's 0023 and 0024 (the work areas and the local streets, 2026-11-19) are left out: this is 0022's own check, on the schema
// it was made for.
const all=fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort().filter(name=>name<=NEW),before=all.filter(name=>name<NEW);
eq([all.length,all.at(-1),before.length,before.at(-1)],[23,NEW,22,'0021_service_sales_process.sql'],'twenty-three migrations, the newest the daily plans; the live release has 22');
eq(fs.existsSync(DOWN),true,'the down migration ships beside them, in drizzle/rollback/');
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fixture=(name,names,{rollbackDir=false}={})=>{
 const appRoot=path.join(work,name,'app'),migrations=path.join(appRoot,'release','drizzle'),data=path.join(work,name,'private-data');
 fs.mkdirSync(migrations,{recursive:true,mode:0o700});fs.mkdirSync(data,{mode:0o700});
 for(const file of names)fs.copyFileSync(path.join(root,'drizzle',file),path.join(migrations,file));
 if(rollbackDir){fs.mkdirSync(path.join(migrations,'rollback'));fs.copyFileSync(DOWN,path.join(migrations,'rollback',path.basename(DOWN)));}
 fs.writeFileSync(path.join(migrations,'manifest.json'),JSON.stringify({format:'yourrest-migrations-v1',files:names.map(file=>({name:file,sha256:digest(path.join(migrations,file))}))}));
 return{filename:path.join(data,'database.sqlite'),migrations,appRoot,owner:{email:'plans-migration@yourrest.org',name:'مالك اصطناعي'}};
};
const read=(filename,fn)=>{const db=new DatabaseSync(filename,{readOnly:true});try{return fn(db);}finally{db.close();}};
const PLAN_TABLES=['crm_daily_plan_notes','crm_daily_plan_stops','crm_daily_plans'];
/** Every table's rows (the ledger's applied_at aside) and every schema object, as text. */
const tables=db=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
const dump=(db,{skip=[]}={})=>Object.fromEntries(tables(db).filter(name=>!skip.includes(name)).map(name=>[name,db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all().map(row=>{const copy={...row};if(name==='yr_schema_migrations')delete copy.applied_at;return copy;})]));
const schema=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(row=>({...row}));

// ---- 1. a fresh installation takes the 23 migrations; the down file is not one
const fresh=fixture('fresh',all,{rollbackDir:true});
eq(initializeDatabase(fresh).migrations,23,'a new database takes the twenty-three migrations (the rollback folder beside them is not read)');
eq(read(fresh.filename,db=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'crm_daily_plan%' ORDER BY name").all().map(row=>row.name)),PLAN_TABLES,'with the three plan tables');
{
 const bare=fixture('bare',[]);fs.rmSync(path.join(bare.migrations,'manifest.json'));
 for(const file of all)fs.copyFileSync(path.join(root,'drizzle',file),path.join(bare.migrations,file));
 fs.mkdirSync(path.join(bare.migrations,'rollback'));fs.copyFileSync(DOWN,path.join(bare.migrations,'rollback',path.basename(DOWN)));
 eq(initializeDatabase(bare).migrations,23,'without a manifest (development) the down file is not a migration either');
}

// ---- 2. a database of the previous release, with its data
const old=fixture('upgrade',before);
eq(initializeDatabase(old).migrations,22,'the live schema: 22 migrations');
const t='2026-11-18T06:00:00.000Z';
{
 const db=new DatabaseSync(old.filename);db.exec('PRAGMA foreign_keys=ON');
 const member=(id,role,sup,region='eastern')=>db.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,active,target,created_at,region_scope) VALUES(?,?,?,?,?,'الرئيسي',?,1,0,?,?)").run(id,'u-'+id,id+'@yourrest.org','عضو '+id,role,sup,t,region);
 member('mgr','manager',null,'all');member('sup','supervisor','mgr');member('rep','rep','sup');member('mk','marketing','sup');member('csm','customer_service_manager','mgr');member('cs','customer_service','csm');
 const record=(id,kind,parent,assigned,data)=>db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,'الرئيسي',?,?,?,1,'old')").run(id,kind,parent,assigned,JSON.stringify(data),t,t);
 record('c1','customer',null,'rep',{name:'مصنع أ',region:'الشرقية',code:'C1'});record('c2','customer',null,'rep',{name:'مصنع ب',region:'الشرقية'});
 record('a1','activity','c1','rep',{type:'visit',date:'2026-11-18',result:'تمت',performedBy:'rep'});record('a2','activity','c2','mk',{type:'call',date:'2026-11-18',result:'تم',performedBy:'mk'});
 db.prepare("INSERT INTO crm_daily_entry_reviews(activity_id,member_id,date,result,action,reviewed_by,version,mutation_id,created_at,updated_at) VALUES('a1','rep','2026-11-18','جيد','تابع','sup',1,'m',?,?)").run(t,t);
 db.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('rep','{\"activity:delete\":true}','[]',2,'mgr',?)").run(t);
 db.prepare("INSERT INTO crm_service_cases(id,customer_id,status,creator_id,service_manager_id,sales_manager_id,assigned_to,supervisor_id,data,created_at,updated_at,version,mutation_id) VALUES('case-1','c1','pending_approval','cs','csm',NULL,NULL,NULL,'{}',?,?,1,'old')").run(t,t);
 db.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES('kept','c1','عضو rep','تعديل','{}',?)").run(t);
 db.close();
}
const beforeRows=read(old.filename,dump),beforeSchema=read(old.filename,schema);
fs.copyFileSync(path.join(root,'drizzle',NEW),path.join(old.migrations,NEW));
fs.writeFileSync(path.join(old.migrations,'manifest.json'),JSON.stringify({format:'yourrest-migrations-v1',files:all.map(file=>({name:file,sha256:digest(path.join(old.migrations,file))}))}));
eq(inspectInitializedDatabase(old),{pending:[NEW],migrations:23},'0022 is the one pending migration');
const upgraded=await upgradeExistingDatabase(old);
eq([upgraded.upgraded,upgraded.migrations,path.basename(upgraded.backup).startsWith('before-0022_daily_plans-')],[true,23,true],'the upgrade applies it after a private schema backup');
eq(read(upgraded.backup,db=>[db.prepare('SELECT COUNT(*) n FROM yr_schema_migrations').get().n,dump(db)]),[22,beforeRows],'the backup is the 22-migration database, every row as it was');
const afterRows=read(old.filename,db=>dump(db,{skip:PLAN_TABLES}));
eq(Object.keys(afterRows),Object.keys(beforeRows),'no table of the previous release is gone or new besides the plans');
for(const table of Object.keys(beforeRows))if(table!=='yr_schema_migrations')eq(afterRows[table],beforeRows[table],table+': every row unchanged');
eq(afterRows.yr_schema_migrations.map(row=>row.name),[...beforeRows.yr_schema_migrations.map(row=>row.name),NEW],'the ledger gains 0022 only');
const afterSchema=read(old.filename,schema);
eq(afterSchema.filter(row=>!row.tbl_name.startsWith('crm_daily_plan')),beforeSchema,'every table, index and trigger of the previous release unchanged');
eq(afterSchema.filter(row=>row.tbl_name.startsWith('crm_daily_plan')).map(row=>row.type+':'+row.name),['index:crm_daily_plan_stops_plan','index:crm_daily_plans_date_status','table:crm_daily_plan_notes','table:crm_daily_plan_stops','table:crm_daily_plans'],'the three tables and their two indexes');
eq(read(old.filename,db=>[...PLAN_TABLES.map(name=>db.prepare(`SELECT COUNT(*) n FROM "${name}"`).get().n),db.prepare('PRAGMA foreign_key_check').all().length,db.prepare('PRAGMA integrity_check').get().integrity_check]),[0,0,0,0,'ok'],'empty, the keys and the file sound');

// ---- 3. the database's own checks
{
 const db=new DatabaseSync(old.filename);db.exec('PRAGMA foreign_keys=ON');
 const plan=(id,member,date,extra={})=>{const row={status:'sent',version:1,late:0,first_sent_source:'server',...extra};return db.prepare('INSERT INTO crm_daily_plans(id,member_id,date,status,version,first_sent_at,first_sent_source,late,sent_at,received_at,mutation_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,member,date,row.status,row.version,t,row.first_sent_source,row.late,t,t,'m-'+id,t,t);};
 plan('p1','rep','2026-11-19');
 throws(()=>plan('p2','rep','2026-11-19'),/UNIQUE/,'one plan a member and day');
 throws(()=>plan('p3','ghost','2026-11-19'),/FOREIGN KEY/,'a member who is not there');
 throws(()=>plan('p4','mk','2026-11-19',{status:'pending'}),/CHECK/,'a status that is not one');
 throws(()=>plan('p5','mk','19-11-2026'),/CHECK/,'a day that is not YYYY-MM-DD');
 throws(()=>plan('p6','mk','2026-11-19',{version:0}),/CHECK/,'a version of 0');
 throws(()=>plan('p7','mk','2026-11-19',{late:2}),/CHECK/,'late is 0 or 1');
 throws(()=>plan('p8','mk','2026-11-19',{first_sent_source:'phone'}),/CHECK/,'the send time\'s source is the device or the server');
 const stop=(id,planId,extra={})=>{const row={position:1,kind:'visit',time:'',state:'',added:'rep',...extra};return db.prepare('INSERT INTO crm_daily_plan_stops(id,plan_id,position,customer_id,kind,planned_time,note,added_by,supervisor_state,edited_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,planId,row.position,'c1',row.kind,row.time,'',row.added,row.state,null,t,t);};
 stop('s1','p1');stop('s2','p1',{position:2,kind:'whatsapp',time:'09:30',state:'added',added:'sup'});
 throws(()=>stop('s3','p1',{kind:'email'}),/CHECK/,'a stop is a visit, a call or WhatsApp');
 throws(()=>stop('s4','p1',{time:'9:30'}),/CHECK/,'a time is HH:MM');
 throws(()=>stop('s5','p1',{position:0}),/CHECK/,'a position from 1');
 throws(()=>stop('s6','p1',{state:'deleted'}),/CHECK/,'a reviewer\'s state that is not one');
 throws(()=>stop('s7','ghost'),/FOREIGN KEY/,'a plan that is not there');
 const note=(member,date,reviewer,text='جيد')=>db.prepare('INSERT INTO crm_daily_plan_notes(member_id,date,reviewer_id,note,version,mutation_id,created_at,updated_at) VALUES(?,?,?,?,1,?,?,?)').run(member,date,reviewer,text,'n',t,t);
 note('rep','2026-11-19','sup');note('rep','2026-11-19','mgr');
 throws(()=>note('rep','2026-11-19','sup','ثانية'),/UNIQUE|PRIMARY/,'one note per reviewer and day');
 db.prepare("DELETE FROM crm_daily_plans WHERE id='p1'").run();
 eq(db.prepare("SELECT COUNT(*) n FROM crm_daily_plan_stops").get().n,0,'a plan\'s stops go with it');
 throws(()=>db.prepare("DELETE FROM crm_members WHERE id='sup'").run(),/FOREIGN KEY/,'a reviewer with a note is never deleted under it');
 db.prepare("DELETE FROM crm_daily_plan_notes").run();
 db.close();
}

// ---- 4. going back
// 4a. code only: the previous release refuses the migrated database at start and writes nothing.
const previous=fixture('previous',before);fs.rmSync(path.dirname(previous.filename),{recursive:true,force:true});fs.mkdirSync(path.dirname(previous.filename),{mode:0o700});
fs.copyFileSync(old.filename,previous.filename);
throws(()=>inspectInitializedDatabase(previous),/newer than this package/,'the previous release (22 migrations) refuses the migrated database: a code-only rollback does not start');
throws(()=>initializeDatabase(previous),/newer than this package/,'and changes nothing');
// 4b. the schema backup: the previous release opens it (what was written after the update is lost).
fs.copyFileSync(upgraded.backup,previous.filename);
eq(inspectInitializedDatabase(previous),{pending:[],migrations:22},'the previous release with the schema backup: nothing pending');
eq(read(previous.filename,dump),beforeRows,'every row as before the update');
// 4c. the down migration on a database used after the update: plans and their audit rows, and other rows written since.
{
 const db=new DatabaseSync(old.filename);db.exec('PRAGMA foreign_keys=ON');
 db.prepare("INSERT INTO crm_daily_plans(id,member_id,date,status,version,first_sent_at,first_sent_source,late,sent_at,received_at,reviewed_by,reviewed_at,return_reason,mutation_id,created_at,updated_at) VALUES('daily-plan:rep:2026-11-19','rep','2026-11-19','approved_edited',3,?,'device',1,?,?,'sup',?,'','m',?,?)").run(t,t,t,t,t,t);
 db.prepare("INSERT INTO crm_daily_plan_stops(id,plan_id,position,customer_id,kind,planned_time,note,added_by,supervisor_state,edited_by,created_at,updated_at) VALUES('s1','daily-plan:rep:2026-11-19',1,'c1','visit','','','sup','added','sup',?,?)").run(t,t);
 db.prepare("INSERT INTO crm_daily_plan_notes(member_id,date,reviewer_id,note,version,mutation_id,created_at,updated_at) VALUES('rep','2026-11-19','sup','جيد',1,'n',?,?)").run(t,t);
 for(const action of ['send','approve','approve_edited','note'])db.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,'daily-plan:rep:2026-11-19','عضو sup',?,'{}',?)").run('daily-plan:sup:'+action,'daily-plan:'+action,t);
 db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('a3','activity','c1','rep','الرئيسي','{\"type\":\"call\",\"date\":\"2026-11-19\"}',?,?,1,'new')").run(t,t);
 db.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES('after-update','a3','عضو rep','إضافة','{}',?)").run(t);
 db.close();
}
const usedRows=read(old.filename,db=>dump(db,{skip:PLAN_TABLES}));
const down=fixture('down',before);fs.rmSync(path.dirname(down.filename),{recursive:true,force:true});fs.mkdirSync(path.dirname(down.filename),{mode:0o700});
fs.copyFileSync(old.filename,down.filename);
{const db=new DatabaseSync(down.filename);db.exec('PRAGMA foreign_keys=ON');db.exec(fs.readFileSync(DOWN,'utf8'));db.close();}
eq(read(down.filename,schema),beforeSchema,'after the down migration the schema is exactly the previous release\'s');
const downRows=read(down.filename,dump);
eq(downRows.yr_schema_migrations,beforeRows.yr_schema_migrations,'the ledger is the previous release\'s 22');
eq(downRows.crm_audit,usedRows.crm_audit.filter(row=>!row.action.startsWith('daily-plan:')),'the plans\' own audit rows are gone, every other audit row kept (one written after the update too)');
for(const table of Object.keys(usedRows))if(!['yr_schema_migrations','crm_audit'].includes(table))eq(downRows[table],usedRows[table],table+': every row kept, those written after the update too');
eq(read(down.filename,db=>[db.prepare('PRAGMA foreign_key_check').all().length,db.prepare('PRAGMA integrity_check').get().integrity_check]),[0,'ok'],'the keys and the file sound');
eq(inspectInitializedDatabase(down),{pending:[],migrations:22},'the previous release opens it with nothing pending');
eq(initializeDatabase(down).migrations,22,'and starts on it');
{const db=new DatabaseSync(down.filename);db.exec('PRAGMA foreign_keys=ON');throws(()=>db.exec(fs.readFileSync(DOWN,'utf8').replace('BEGIN IMMEDIATE;','BEGIN IMMEDIATE; SELECT * FROM missing_table;')),/no such table/,'a failing down migration changes nothing (one transaction)');try{db.exec('ROLLBACK');}catch{/* closed */}eq(db.prepare('SELECT COUNT(*) n FROM yr_schema_migrations').get().n,22,'the ledger untouched');db.close();}
// 4d. the release applied again after the down migration: the tables come back empty.
const again=fixture('again',all);fs.rmSync(path.dirname(again.filename),{recursive:true,force:true});fs.mkdirSync(path.dirname(again.filename),{mode:0o700});
fs.copyFileSync(down.filename,again.filename);
eq((await upgradeExistingDatabase(again)).migrations,23,'the release can be applied again');
eq(read(again.filename,db=>PLAN_TABLES.map(name=>db.prepare(`SELECT COUNT(*) n FROM "${name}"`).get().n)),[0,0,0],'with empty plan tables');
eq(read(again.filename,schema),afterSchema,'and the same schema as the first upgrade');

// ---- 5. the entries kept on the devices (review 2026-11-19). The database goes back, the devices' outboxes do not: a «خطة يوم …» entry
// (kind 'plan') read by the previous release's own code (its sources from git, `git archive 1b6b818`, the release before 0022) is a visit
// without a customer on the member's device, its send to a route the previous server does not have (an HTML 404) is not the server's
// refusal (the entry waits and the outbox stops at it, lib/offline-submit.ts), and a waiting entry cannot be deleted there; the guide says
// to send or delete those entries before going back.
{
 const PREVIOUS='1b6b818',tree=path.join(work,'previous-release-sources'),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});const out=fs.mkdtempSync(path.join(runtime,'plans-previous-'));
 process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
 fs.mkdirSync(tree);execFileSync('tar',['-x','-C',tree],{input:execFileSync('git',['archive','--format=tar',PREVIOUS,'lib','app'],{cwd:root,maxBuffer:256*1024*1024})});
 eq(fs.existsSync(path.join(tree,'lib/daily-plans.ts')),false,'the previous release has no daily plans');
 const compiled=new Set();
 const compile=relative=>{if(compiled.has(relative))return;compiled.add(relative);const src=path.join(tree,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
  const code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let source=imp.startsWith('@/')?imp.slice(2):path.relative(tree,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(tree,source+'.ts'))?'.ts':'.tsx';compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));});
  fs.writeFileSync(dest,code);};
 for(const file of ['lib/offline-store.ts','lib/offline-review.ts','lib/client-submit.ts','lib/offline-submit.ts'])compile(file);
 const load=name=>import(pathToFileURL(path.join(out,name)));
 const [store,review,client,submit]=await Promise.all(['lib/offline-store.mjs','lib/offline-review.mjs','lib/client-submit.mjs','lib/offline-submit.mjs'].map(load));
 // The entry as this release's offlineSubmit writes it for «إرسال للمشرف» (lib/offline-submit.ts).
 const key='11111111-1111-4111-8111-111111111111',at='2026-11-19T18:50:00.000Z';
 const entry={id:'rep:plan:'+key,ownerId:'rep',owner:{id:'rep',stamp:'s'},kind:'plan',label:'خطة يوم 2026-11-20',status:'pending',message:'',createdAt:at,capturedAt:at,localId:'daily-plan-'+key,url:'/api/daily-plans',body:JSON.stringify({action:'send',date:'2026-11-20',stops:[{customerId:'c1',kind:'visit',time:'',note:''}],baseVersion:null,requestId:key,offline:{memberId:'rep',capturedAt:at}}),fingerprint:'f',language:'ar',attempts:0};
 const row=store.offlineProjection(entry,{id:'rep',email:'rep@yourrest.org',branch:'الرئيسي'});
 eq([row?.kind,row?.parentId??null,row?.data.performedBy,row?.data.date],['activity',null,'rep','2026-11-19'],'the previous release shows a plan entry as a visit of the member without a customer');
 const realFetch=globalThis.fetch;globalThis.fetch=async()=>new Response('<!DOCTYPE html><html><body>404</body></html>',{status:404,headers:{'content-type':'text/html'}});
 let answer;try{await client.submitJson('/api/daily-plans',{method:'POST',body:entry.body},{language:'ar'});}catch(error){answer=error;}finally{globalThis.fetch=realFetch;}
 eq([answer?.status,answer?.invalidResponse,submit.isServerRefusal(answer)],[404,true,false],'its send gets the previous server\'s HTML 404, which is not a refusal: the entry waits and the outbox stops at it');
 eq([review.deletableOfflineEntry(entry),review.deletableOfflineEntry({...entry,status:'blocked'})],[false,true],'and a waiting entry cannot be deleted there');
 const guide=fs.readFileSync(path.join(root,'docs/OPERATIONS-DEVELOPMENT-GUIDE-AR.md'),'utf8'),section=guide.slice(guide.indexOf('## 9-أي.'),guide.indexOf('\n## ',guide.indexOf('## 9-أي.')));
 const warning=section.slice(section.indexOf('**قبل الرجوع (3 أو 4): خطط محفوظة على الأجهزة.**'));
 eq(section.includes('**قبل الرجوع (3 أو 4): خطط محفوظة على الأجهزة.**')&&warning.includes('«خطة يوم …»')&&warning.includes('في انتظار الاتصال')&&warning.includes('قبل إيقاف التطبيق للرجوع'),true,'the guide says to send or delete the plans kept on the devices before going back');
}

console.log(JSON.stringify({ok:true,checks}));
