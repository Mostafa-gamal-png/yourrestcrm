import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const {validatePrivatePath}=createRequire(import.meta.url)('./config.cjs');
const permitted=['crm_members','crm_settings','crm_records','crm_visit_numbers','crm_visit_files','crm_sales','crm_performance_targets','crm_target_sets','crm_kpi_assessments','crm_service_cases','crm_audit'];
function validOwner(db){
 const owner=db.prepare("SELECT m.id,m.role,m.active,m.email,m.region_scope FROM crm_settings s JOIN crm_members m ON m.user_id=s.owner_id WHERE s.id='company'").get();
 if(!owner||owner.id!=='owner'||owner.role!=='admin'||owner.active!==1||owner.region_scope!=='all'||!/^[a-z0-9][a-z0-9._+-]{0,63}@yourrest\.org$/i.test(owner.email))throw Error('Active all-region system owner is missing.');
}
function recognizedDatabase(db,migrationFiles){
 const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
 if(!tables.has('yr_schema_migrations')||permitted.some(table=>!tables.has(table)))throw Error('Existing database is not a recognized initialized Yourrest database. Preserve it and use a new private path.');
 const ledger=db.prepare('SELECT name,sha256 FROM yr_schema_migrations').all();
 if(!ledger.length||ledger.some(row=>!migrationFiles.has(row.name)||migrationFiles.get(row.name).hash!==row.sha256))throw Error('Existing migration history is missing, changed or newer than this package.');
 validOwner(db);
}
function syncDirectory(directory){const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function migrationMap(migrations){
 // Published releases enumerate their own migrations. ZIP overlays may leave
 // unrelated SQL beside them; those files must never become pending upgrades.
 const manifestPath=path.join(migrations,'manifest.json');
 let expected;
 if(fs.existsSync(manifestPath)){
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  if(manifest.format!=='yourrest-migrations-v1'||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.some(row=>!row||typeof row.name!=='string'||!/^\d+[a-zA-Z0-9_-]*\.sql$/.test(row.name)||typeof row.sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sha256)))throw Error('Invalid release migration manifest.');
  expected=new Map(manifest.files.map(row=>[row.name,row.sha256]));
  if(expected.size!==manifest.files.length)throw Error('Duplicate release migration manifest entry.');
 }
 const files=(expected?[...expected.keys()]:fs.readdirSync(migrations).filter(file=>/^\d+.*\.sql$/.test(file))).sort();
 if(!files.length)throw Error('Database migrations are missing.');
 return new Map(files.map(file=>{const sql=fs.readFileSync(path.join(migrations,file),'utf8'),hash=createHash('sha256').update(sql).digest('hex');if(expected&&expected.get(file)!==hash)throw Error('Release migration checksum mismatch: '+file);return[file,{sql,hash}];}));
}
// Read-only preflight for startup upgrades. Never initialize an absent/unknown database.
export function inspectInitializedDatabase({filename,migrations,appRoot}){
 filename=validatePrivatePath(filename,{root:appRoot});
 validatePrivatePath(path.dirname(filename),{root:appRoot,directory:true});
 const files=migrationMap(migrations),db=new DatabaseSync(filename,{readOnly:true});
 try{
  recognizedDatabase(db,files);
  const applied=new Set(db.prepare('SELECT name FROM yr_schema_migrations').all().map(row=>row.name));
  return {pending:[...files.keys()].filter(name=>!applied.has(name)),migrations:files.size};
 }finally{db.close();}
}
export function initializeDatabase({filename,migrations,seed,checksum,appRoot}){
 filename=validatePrivatePath(filename,{root:appRoot,allowMissing:true});
 const parent=validatePrivatePath(path.dirname(filename),{root:appRoot,directory:true,allowMissing:true});
 const migrationFiles=migrationMap(migrations),files=[...migrationFiles.keys()];
 const existed=fs.existsSync(filename);
 // Read-only recognition happens before chmod, schema-ledger creation or migration writes.
 if(existed){const probe=new DatabaseSync(filename,{readOnly:true});try{recognizedDatabase(probe,migrationFiles);}finally{probe.close();}}
 fs.mkdirSync(parent,{recursive:true,mode:0o700});validatePrivatePath(parent,{root:appRoot,directory:true});
 const target=existed?filename:filename+'.initializing-'+randomUUID();
 if(!existed){const handle=fs.openSync(target,'wx',0o600);fs.closeSync(handle);}
 let db,inserted=false;
 try{
 db=new DatabaseSync(target);
 db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 db.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON;');
 if(existed)recognizedDatabase(db,migrationFiles);
 else db.exec('CREATE TABLE yr_schema_migrations(name TEXT PRIMARY KEY NOT NULL,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)');
 for(const [file,{sql,hash}] of migrationFiles){const prior=db.prepare('SELECT sha256 FROM yr_schema_migrations WHERE name=?').get(file);if(prior){if(prior.sha256!==hash)throw Error('A saved migration changed: '+file);continue;}db.exec(sql);db.prepare('INSERT INTO yr_schema_migrations VALUES(?,?,?)').run(file,hash,new Date().toISOString());}
 if(!existed){
  const text=fs.readFileSync(seed,'utf8');if(createHash('sha256').update(text).digest('hex')!==fs.readFileSync(checksum,'utf8').trim())throw Error('Initial data checksum mismatch');
  const snapshot=JSON.parse(text);if(snapshot.format!=='yourrest-namecheap-export-v1')throw Error('Unsupported data format');
  if(!snapshot.tables||Object.keys(snapshot.tables).sort().join()!==[...permitted].sort().join())throw Error('Unexpected snapshot tables');
  for(const table of permitted){const data=snapshot.tables[table],columns=data.columns,schema=new Set(db.prepare('PRAGMA table_info("'+table+'")').all().map(x=>x.name));if(!Array.isArray(columns)||!columns.length||!Array.isArray(data.rows)||new Set(columns).size!==columns.length||columns.some(c=>!schema.has(c)||!/^\w+$/.test(c)))throw Error('Invalid data schema');const statement=db.prepare('INSERT INTO "'+table+'" ('+columns.map(c=>'"'+c+'"').join(',')+') VALUES('+columns.map(()=>'?').join(',')+')');for(const row of data.rows)statement.run(...columns.map(c=>row[c]));}
  inserted=true;
 }
 // Both a new import and an existing database must retain the protected owner.
 validOwner(db);
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Foreign key verification failed');
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Database integrity check failed');
 db.exec('COMMIT');
 const summary={newDatabase:inserted,counts:Object.fromEntries(permitted.map(table=>[table,Number(db.prepare('SELECT COUNT(*) AS n FROM "'+table+'"').get().n)])),migrations:files.length};
 db.close();db=undefined;
 if(!existed){
  const handle=fs.openSync(target,'r');try{fs.fsyncSync(handle);}finally{fs.closeSync(handle);}
  // Atomic same-filesystem publication: unlike rename, link never replaces an existing database.
  fs.linkSync(target,filename);syncDirectory(parent);fs.unlinkSync(target);syncDirectory(parent);
 }
 return summary;
 }catch(error){try{db?.exec('ROLLBACK');}catch{}try{db?.close();}catch{}if(!existed){for(const suffix of ['', '-journal','-wal','-shm'])fs.rmSync(target+suffix,{force:true});}throw error;}
}
