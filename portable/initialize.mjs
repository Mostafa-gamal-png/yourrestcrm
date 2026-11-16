import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const {validatePrivatePath}=createRequire(import.meta.url)('./config.cjs');
const permitted=['crm_members','crm_settings','crm_records','crm_visit_numbers','crm_visit_files','crm_sales','crm_performance_targets','crm_target_sets','crm_kpi_assessments','crm_service_cases','crm_audit'];
// The system owner's sign-in address: the same rule for a new owner and for the one an existing database holds.
const ownerEmailPattern=/^[a-z0-9][a-z0-9._+-]{0,63}@yourrest\.org$/i;
/** The owner of an EMPTY new installation (no initial data file): {email, name?}. Throws on an address outside yourrest.org. */
export function validateNewOwner(owner){
 const email=String(owner?.email??'').trim().toLowerCase(),name=String(owner?.name??'').trim()||'مدير النظام';
 if(!ownerEmailPattern.test(email))throw Error('The owner e-mail must be an address at yourrest.org (--owner-email=name@yourrest.org).');
 if(name.length>100||/[\u0000-\u001f]/.test(name))throw Error('The owner name must be at most 100 characters on one line.');
 return {email,name};
}
// An empty installation: the protected owner (member id 'owner', admin of every region) and the company row that names it.
function insertOwner(db,owner){
 const {email,name}=validateNewOwner(owner),userId='owner-'+randomUUID();
 db.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,active,target,created_at,region_scope) VALUES('owner',?,?,?,'admin',?,1,0,?,'all')").run(userId,email,name,'الرئيسي',new Date().toISOString());
 db.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company',?)").run(userId);
}
function validOwner(db){
 const owner=db.prepare("SELECT m.id,m.role,m.active,m.email,m.region_scope FROM crm_settings s JOIN crm_members m ON m.user_id=s.owner_id WHERE s.id='company'").get();
 if(!owner||owner.id!=='owner'||owner.role!=='admin'||owner.active!==1||owner.region_scope!=='all'||!ownerEmailPattern.test(owner.email))throw Error('Active all-region system owner is missing.');
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
/**
 * Creates (or brings up to date) the database. A NEW database is filled from one of two sources, never both:
 * `seed` + `checksum` (an initial data file the administrator placed by hand, checked against its SHA-256), or
 * `owner` ({email, name?}: an empty installation with its owner only). The repository and the release package carry
 * no initial data (real customer data was removed on 2026-11-16). An existing database needs neither.
 */
export function initializeDatabase({filename,migrations,seed,checksum,owner,appRoot}){
 filename=validatePrivatePath(filename,{root:appRoot,allowMissing:true});
 const parent=validatePrivatePath(path.dirname(filename),{root:appRoot,directory:true,allowMissing:true});
 const migrationFiles=migrationMap(migrations),files=[...migrationFiles.keys()];
 const existed=fs.existsSync(filename);
 // What a new database is made of is checked before anything is created.
 if(!existed){
  if(seed&&owner)throw Error('Give either the initial data file or the owner of an empty installation, not both.');
  if(!seed&&!owner)throw Error('A new database needs its owner: run setup with --owner-email=name@yourrest.org for an empty installation, or place the initial data file and its checksum (migration/initial.json, migration/initial.sha256) by hand.');
  if(seed&&!fs.existsSync(seed))throw Error('The initial data file is missing: '+path.basename(seed)+'.');
  if(seed&&(!checksum||!fs.existsSync(checksum)))throw Error('The checksum of the initial data file is missing: '+(checksum?path.basename(checksum):'no checksum file given')+'.');
  if(owner)validateNewOwner(owner);
 }
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
  if(owner)insertOwner(db,owner);
  else{
  const text=fs.readFileSync(seed,'utf8');if(createHash('sha256').update(text).digest('hex')!==fs.readFileSync(checksum,'utf8').trim())throw Error('Initial data checksum mismatch');
  const snapshot=JSON.parse(text);if(snapshot.format!=='yourrest-namecheap-export-v1')throw Error('Unsupported data format');
  if(!snapshot.tables||Object.keys(snapshot.tables).sort().join()!==[...permitted].sort().join())throw Error('Unexpected snapshot tables');
  for(const table of permitted){const data=snapshot.tables[table],columns=data.columns,schema=new Set(db.prepare('PRAGMA table_info("'+table+'")').all().map(x=>x.name));if(!Array.isArray(columns)||!columns.length||!Array.isArray(data.rows)||new Set(columns).size!==columns.length||columns.some(c=>!schema.has(c)||!/^\w+$/.test(c)))throw Error('Invalid data schema');const statement=db.prepare('INSERT INTO "'+table+'" ('+columns.map(c=>'"'+c+'"').join(',')+') VALUES('+columns.map(()=>'?').join(',')+')');for(const row of data.rows)statement.run(...columns.map(c=>row[c]));}
  }
  inserted=true;
 }
 // Both a new import and an existing database must retain the protected owner.
 validOwner(db);
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Foreign key verification failed');
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Database integrity check failed');
 db.exec('COMMIT');
 const summary={newDatabase:inserted,...(inserted?{initialData:owner?'none':'file'}:{}),counts:Object.fromEntries(permitted.map(table=>[table,Number(db.prepare('SELECT COUNT(*) AS n FROM "'+table+'"').get().n)])),migrations:files.length};
 db.close();db=undefined;
 if(!existed){
  const handle=fs.openSync(target,'r');try{fs.fsyncSync(handle);}finally{fs.closeSync(handle);}
  // Atomic same-filesystem publication: unlike rename, link never replaces an existing database.
  fs.linkSync(target,filename);syncDirectory(parent);fs.unlinkSync(target);syncDirectory(parent);
 }
 return summary;
 }catch(error){try{db?.exec('ROLLBACK');}catch{}try{db?.close();}catch{}if(!existed){for(const suffix of ['', '-journal','-wal','-shm'])fs.rmSync(target+suffix,{force:true});}throw error;}
}
