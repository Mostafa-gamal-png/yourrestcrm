import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {upgradeExistingDatabase} from '../portable/upgrade.mjs';
import {inspectInitializedDatabase} from '../portable/initialize.mjs';

// Upgrade a synthetic version39 database through the actual backup/launcher path.
const root=process.cwd(),work=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-kpi-upgrade-'));
const appRoot=path.join(work,'app'),migrations=path.join(appRoot,'release','drizzle'),data=path.join(work,'private-data'),filename=path.join(data,'database.sqlite');
let checks=0;const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const hash=b=>createHash('sha256').update(b).digest('hex');
fs.mkdirSync(migrations,{recursive:true,mode:0o700});fs.mkdirSync(data,{mode:0o700});
const names=fs.readdirSync(path.join(root,'drizzle')).filter(n=>/^\d+.*\.sql$/.test(n)&&n<='0013_kpi_evidence.sql').sort(),pending='0013_kpi_evidence.sql';
const options={filename,migrations,appRoot};
try{
 for(const name of names)fs.copyFileSync(path.join(root,'drizzle',name),path.join(migrations,name));
 fs.writeFileSync(path.join(migrations,'manifest.json'),JSON.stringify({format:'yourrest-migrations-v1',files:names.map(name=>({name,sha256:hash(fs.readFileSync(path.join(migrations,name)))}))}));
 fs.writeFileSync(path.join(migrations,'0000_unrelated.sql'),'SELECT unknown_foreign_schema;');
 const settings=path.join(appRoot,'settings.cjs');fs.writeFileSync(settings,"module.exports={synthetic:'preserve'};\n");
 let db=new DatabaseSync(filename);db.exec('PRAGMA foreign_keys=ON;CREATE TABLE yr_schema_migrations(name TEXT PRIMARY KEY NOT NULL,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)');
 for(const name of names.filter(n=>n<pending)){const sql=fs.readFileSync(path.join(migrations,name),'utf8');db.exec(sql);db.prepare('INSERT INTO yr_schema_migrations VALUES(?,?,?)').run(name,hash(sql),'2026-10-04T00:00:00Z');}
 db.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,active,target,created_at,region_scope) VALUES('owner','test-owner','owner@yourrest.org','Synthetic owner','admin','Test',1,55,'2026-01-01','all')").run();
 db.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','test-owner')").run();
 db.prepare("INSERT INTO crm_records(id,kind,assigned_to,branch,data,created_at,updated_at) VALUES('customer','customer','owner','Test',?,'2026-01-01','2026-01-01')").run(JSON.stringify({name:'Synthetic factory',code:'T1',region:'الغربية'}));
 db.prepare("INSERT INTO crm_kpi_assessments(member_id,month,input,version,mutation_id,updated_by,updated_at) VALUES('owner','2026-09','{}',3,'prior','owner','2026-09-30')").run();
 const oldTables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'yr_schema_migrations' ORDER BY name").all().map(r=>r.name);
 const before=Object.fromEntries(oldTables.map(t=>[t,db.prepare('SELECT * FROM "'+t+'" ORDER BY rowid').all()]));db.close();fs.chmodSync(filename,0o600);
 eq(inspectInitializedDatabase(options).pending,[pending],'Exactly new KPI migration is pending; unrelated overlay ignored');
 const result=await upgradeExistingDatabase(options);eq(result.upgraded,true);eq(result.migrations,names.length);assert.ok(result.backup);checks++;
 db=new DatabaseSync(filename,{readOnly:true});
 for(const table of oldTables)eq(db.prepare('SELECT * FROM "'+table+'" ORDER BY rowid').all(),before[table],'Preserved '+table);
 eq(db.prepare('SELECT count(*) n FROM crm_kpi_evidence').get().n,0,'No fabricated evidence seeded');
 eq(db.prepare("SELECT revision FROM crm_kpi_evidence_state WHERE id='company'").get().revision,0);
 eq(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');eq(db.prepare('PRAGMA foreign_key_check').all(),[]);
 eq(db.prepare('SELECT sha256 FROM yr_schema_migrations WHERE name=?').get(pending).sha256,hash(fs.readFileSync(path.join(migrations,pending))));db.close();
 db=new DatabaseSync(result.backup,{readOnly:true});eq(db.prepare('SELECT COUNT(*) n FROM yr_schema_migrations').get().n,names.length-1);eq(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='crm_kpi_evidence'").get().n,0);db.close();
 eq(await upgradeExistingDatabase(options),{upgraded:false,migrations:names.length},'Restart is idempotent');
 eq(fs.readdirSync(path.dirname(result.backup)).length,1,'Single verified schema backup');
 eq(fs.readFileSync(settings,'utf8'),"module.exports={synthetic:'preserve'};\n",'Application settings untouched');
 console.log(JSON.stringify({ok:true,checks,coverage:'actual private SQLite13-to14 upgrade, verified backup, preservation of every preexisting table, manifest isolation, integrity and restart idempotency',productionDataUsed:false}));
}finally{fs.rmSync(work,{recursive:true,force:true});}
