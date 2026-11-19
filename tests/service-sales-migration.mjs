// Migration 0021 (customer service in the sales process, the owner 2026-11-16, item 5 of the GSCO list): twenty-two migrations; the
// upgrade of a database of 21 migrations holding made-up data written as the previous release writes it (customer-service requests at every
// stage, customers, contacts, sales), with its private backup; every existing row kept exactly (the new columns NULL or empty: «غير محدد»);
// the new table empty; the database's own checks (CHECK, FOREIGN KEY); the previous release's statements still valid on the new schema;
// and what a code-only rollback meets: the previous release refuses a database with a newer migration (by design, portable/initialize.mjs),
// and the way back is that release with the schema backup, which opens with nothing pending and the same rows. Synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {initializeDatabase,inspectInitializedDatabase} from '../portable/initialize.mjs';
import {upgradeExistingDatabase} from '../portable/upgrade.mjs';

const root=process.cwd(),work=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-service-sales-migration-'));
process.on('exit',()=>fs.rmSync(work,{recursive:true,force:true}));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const throws=(fn,pattern,message)=>{assert.throws(fn,pattern,message);checks++;};

const NEW='0021_service_sales_process.sql';
// A later release's 0022 (the daily plans, 2026-11-19) is left out: this is 0021's own check, on the schema it was made for.
const all=fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort().filter(name=>name<=NEW),before=all.filter(name=>name<NEW);
eq([all.length,all.at(-1),before.length,before.at(-1)],[22,NEW,21,'0020_member_permissions.sql'],'twenty-two migrations, the newest the customer-service sales process; the live release has 21');
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fixture=(name,names)=>{
 const appRoot=path.join(work,name,'app'),migrations=path.join(appRoot,'release','drizzle'),data=path.join(work,name,'private-data');
 fs.mkdirSync(migrations,{recursive:true,mode:0o700});fs.mkdirSync(data,{mode:0o700});
 for(const file of names)fs.copyFileSync(path.join(root,'drizzle',file),path.join(migrations,file));
 fs.writeFileSync(path.join(migrations,'manifest.json'),JSON.stringify({format:'yourrest-migrations-v1',files:names.map(file=>({name:file,sha256:digest(path.join(migrations,file))}))}));
 return{filename:path.join(data,'database.sqlite'),migrations,appRoot,owner:{email:'migration-test@yourrest.org',name:'مالك اصطناعي'}};
};
const read=(filename,fn)=>{const db=new DatabaseSync(filename,{readOnly:true});try{return fn(db);}finally{db.close();}};
const dump=db=>Object.fromEntries(['crm_members','crm_records','crm_service_cases','crm_erp_sales','crm_audit','crm_sales'].map(table=>[table,db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all().map(row=>({...row}))]));
const OLD_CASE_COLUMNS=['id','customer_id','status','creator_id','service_manager_id','sales_manager_id','assigned_to','supervisor_id','data','created_at','updated_at','version','mutation_id'];

// ---- 1. a fresh installation takes the 22 migrations
const fresh=fixture('fresh',all);
eq(initializeDatabase(fresh).migrations,22,'a new database takes the twenty-two migrations');
eq(read(fresh.filename,db=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='crm_service_role_tasks'").all().map(row=>row.name)),['crm_service_role_tasks'],'with the role tasks table');

// ---- 2. a database of the previous release, with its data
const old=fixture('upgrade',before);
eq(initializeDatabase(old).migrations,21,'the live schema: 21 migrations');
{
 const db=new DatabaseSync(old.filename);db.exec('PRAGMA foreign_keys=ON');
 const t='2026-11-10T06:00:00.000Z';
 const member=(id,role,sup)=>db.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,active,target,created_at,region_scope) VALUES(?,?,?,?,?,'الرئيسي',?,1,0,?,'all')").run(id,'u-'+id,id+'@yourrest.org','عضو '+id,role,sup,t);
 member('mgr','manager',null);member('rep','rep','mgr');member('csm','customer_service_manager','mgr');member('cs','customer_service','csm');
 const record=(id,kind,parent,data)=>db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,'rep','الرئيسي',?,?,?,1,'old')").run(id,kind,parent,JSON.stringify(data),t,t);
 record('c1','customer',null,{name:'مصنع أ',region:'الشرقية',code:'C1'});record('c2','customer',null,{name:'مصنع ب',region:'الشرقية',code:'C2'});record('c3','customer',null,{name:'مصنع ج',region:'الشرقية'});
 record('a1','activity','c1',{type:'call',date:'2026-11-10',result:'تم',salesStage:'won',serviceCaseId:'case-2',performedBy:'rep'});
 record('q1','quote','c1',{number:'Qut-1',date:'2026-11-10',status:'sent',total:100});
 const kase=(id,customer,status,assigned,data)=>db.prepare(`INSERT INTO crm_service_cases(${OLD_CASE_COLUMNS.join(',')}) VALUES(?,?,?,'cs','csm',?,?,NULL,?,?,?,2,'old')`).run(id,customer,status,status==='pending_approval'?null:'mgr',assigned,JSON.stringify({source:'call',products:['خدمات صيانة'],strength:'strong',needs:'x',nextAction:'y',nextDate:'2026-11-20',participants:['cs','csm'],...data}),t,t);
 kase('case-1','c1','pending_approval',null,{});kase('case-2','c2','assigned','rep',{approvedAt:t,assignedAt:t});kase('case-3','c3','returned',null,{});
 db.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('imp','mgr','fp','f.xlsx','{}',?)").run(t);
 db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES('e1','d1','h','m','INV-1','sale','2026-11-10','E1','rep','الرئيسي','all','C1','مصنع أ','{\"items\":[],\"quotationRefs\":[\"Qut-1\"]}',10000,'imp','mgr',?)").run(t);
 db.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES('kept','case-1','عضو cs','service:create','{}',?)").run(t);
 db.close();
}
const beforeRows=read(old.filename,dump);
fs.copyFileSync(path.join(root,'drizzle',NEW),path.join(old.migrations,NEW));
fs.writeFileSync(path.join(old.migrations,'manifest.json'),JSON.stringify({format:'yourrest-migrations-v1',files:all.map(file=>({name:file,sha256:digest(path.join(old.migrations,file))}))}));
eq(inspectInitializedDatabase(old),{pending:[NEW],migrations:22},'0021 is the one pending migration');
const upgraded=await upgradeExistingDatabase(old);
eq([upgraded.upgraded,upgraded.migrations,path.basename(upgraded.backup).startsWith('before-0021_service_sales_process-')],[true,22,true],'the upgrade applies it after a private schema backup');
eq(read(upgraded.backup,db=>[db.prepare('SELECT COUNT(*) n FROM yr_schema_migrations').get().n,dump(db)]),[21,beforeRows],'the backup is the 21-migration database, every row as it was');
const afterRows=read(old.filename,dump);
eq(afterRows.crm_service_cases.map(row=>Object.fromEntries(OLD_CASE_COLUMNS.map(column=>[column,row[column]]))),beforeRows.crm_service_cases,'every existing request keeps every value');
eq(afterRows.crm_service_cases.map(row=>[row.lead_group,row.lead_source,row.lead_ref_kind,row.lead_ref_id,row.lead_note,row.route,row.routed_by,row.routed_at]),Array(3).fill([null,null,null,null,'',null,null,null]),'and reads «غير محدد», not routed (an approved one reads as passed to sales)');
for(const table of ['crm_members','crm_records','crm_erp_sales','crm_audit','crm_sales'])eq(afterRows[table],beforeRows[table],table+': unchanged');
eq(read(old.filename,db=>db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('crm_service_cases_lead_ref','crm_service_cases_held','crm_service_role_tasks_member') ORDER BY name").all().map(row=>row.name)),['crm_service_cases_held','crm_service_cases_lead_ref','crm_service_role_tasks_member'],'the indexes: a record\'s opportunity, the kept opportunities, a member\'s tasks');
eq(read(old.filename,db=>[db.prepare('SELECT COUNT(*) n FROM crm_service_role_tasks').get().n,db.prepare('PRAGMA foreign_key_check').all().length,db.prepare('PRAGMA integrity_check').get().integrity_check]),[0,0,'ok'],'no task recorded, the keys and the file sound');

// ---- 3. the database's own checks
{
 const db=new DatabaseSync(old.filename);db.exec('PRAGMA foreign_keys=ON');
 throws(()=>db.prepare("UPDATE crm_service_cases SET lead_group='other' WHERE id='case-1'").run(),/CHECK/,'a group that is not one');
 throws(()=>db.prepare("UPDATE crm_service_cases SET route='elsewhere' WHERE id='case-1'").run(),/CHECK/,'a route that is not one');
 throws(()=>db.prepare("UPDATE crm_service_cases SET lead_ref_kind='visit' WHERE id='case-1'").run(),/CHECK/,'a kind of record that is not one');
 throws(()=>db.prepare("UPDATE crm_service_cases SET routed_by='ghost' WHERE id='case-1'").run(),/FOREIGN KEY/,'a router who is not a member');
 db.prepare("UPDATE crm_service_cases SET status='service',route='service',routed_by='csm',routed_at='2026-11-11T06:00:00.000Z',assigned_to='cs',lead_group='service',lead_source='واتساب' WHERE id='case-1'").run();
 const task=(caseId,outcome,roles='["جلب العميل"]',member='cs')=>db.prepare("INSERT INTO crm_service_role_tasks(case_id,outcome,member_id,basis,closed_at,roles,note,done_by,done_at,mutation_id) VALUES(?,?,?,'owner','t',?,'تواصلت مع العميل','cs','t','m')").run(caseId,outcome,member,roles);
 task('case-2','won');
 throws(()=>task('case-2','won'),/UNIQUE|PRIMARY/,'one role a case');
 throws(()=>task('case-3','draw'),/CHECK/,'an outcome that is not one');
 throws(()=>task('case-3','lost','{}'),/CHECK/,'roles must be a list');
 throws(()=>task('case-ghost','lost'),/FOREIGN KEY/,'a case that is not there');
 throws(()=>task('case-3','lost','[]','ghost'),/FOREIGN KEY/,'a member who is not there');
 throws(()=>db.prepare("DELETE FROM crm_service_cases WHERE id='case-2'").run(),/FOREIGN KEY/,'a case with a recorded role is never deleted under it');
 // The previous release's own statements (the columns it names) still run on the new schema: its INSERT of a request and its UPDATE.
 db.prepare(`INSERT INTO crm_service_cases(${OLD_CASE_COLUMNS.join(',')}) VALUES('case-4','c3','pending_approval','cs','csm',NULL,NULL,NULL,'{}','t','t',1,'old')`).run();
 db.prepare("UPDATE crm_service_cases SET status='pending_assignment',sales_manager_id='mgr',data='{}',updated_at='t2',version=version+1,mutation_id='m2' WHERE id='case-4' AND version=1").run();
 eq({...db.prepare("SELECT status,lead_note,route FROM crm_service_cases WHERE id='case-4'").get()},{status:'pending_assignment',lead_note:'',route:null},'the previous release\'s statements still write valid rows');
 db.close();
}

// ---- 4. going back: a code-only rollback, and the way back
const previous=fixture('previous',before);fs.rmSync(path.dirname(previous.filename),{recursive:true,force:true});fs.mkdirSync(path.dirname(previous.filename),{mode:0o700});
fs.copyFileSync(old.filename,previous.filename);
throws(()=>inspectInitializedDatabase(previous),/newer than this package/,'the previous release (21 migrations) refuses the migrated database at start: a code-only rollback does not start');
throws(()=>initializeDatabase(previous),/newer than this package/,'and changes nothing (its start-up refuses before writing)');
fs.copyFileSync(upgraded.backup,previous.filename);
eq(inspectInitializedDatabase(previous),{pending:[],migrations:21},'the previous release with the schema backup: nothing pending');
eq(read(previous.filename,dump),beforeRows,'every row as before the update (what was written after it is lost, as the update guide says)');
const again=fixture('again',all);fs.rmSync(path.dirname(again.filename),{recursive:true,force:true});fs.mkdirSync(path.dirname(again.filename),{mode:0o700});
fs.copyFileSync(upgraded.backup,again.filename);
eq((await upgradeExistingDatabase(again)).migrations,22,'and the release can be applied again on it');

console.log(JSON.stringify({checks}));
