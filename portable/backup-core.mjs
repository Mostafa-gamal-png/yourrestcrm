import fs from 'node:fs/promises';
import {constants,lstatSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync,backup as sqliteBackup} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const {validatePrivatePath}=createRequire(import.meta.url)('./config.cjs');
const FORMAT='yourrest-crm-backup',VERSION=1;
const hashKey=key=>createHash('sha256').update(key).digest('hex');
const inside=(candidate,root)=>candidate===root||candidate.startsWith(root+path.sep);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const checked=(filename,appRoot,options={})=>validatePrivatePath(filename,{root:appRoot,...options});
async function syncDirectory(directory){const file=await fs.open(directory,'r');try{await file.sync();}finally{await file.close();}}
async function absent(filename){try{await fs.lstat(filename);fail('DESTINATION_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}}
async function writePrivate(filename,value){const file=await fs.open(filename,'wx',0o600);try{await file.writeFile(value);await file.sync();}finally{await file.close();}}
async function atomicJson(filename,value){const temp=filename+'.tmp-'+randomUUID();try{await writePrivate(temp,JSON.stringify(value,null,2)+'\n');await fs.rename(temp,filename);await syncDirectory(path.dirname(filename));}finally{await fs.rm(temp,{force:true});}}
function sourcePaths(config,appRoot){
 const database=checked(config.YR_DATABASE_PATH,appRoot),objects=checked(config.YR_OBJECTS_PATH,appRoot,{directory:true});
 checked(path.dirname(database),appRoot,{directory:true});
 return {database,objects};
}
function destinationPath(destination,appRoot,sources){
 const target=checked(destination,appRoot,{directory:true,allowMissing:true});
 const parent=validatePrivatePath(path.dirname(target),{directory:true,privateMode:false}),parentStat=lstatSync(parent);
 if((parentStat.mode&0o022)||(process.getuid&&parentStat.uid!==process.getuid()))fail('UNSAFE_DESTINATION_PARENT');
 if(sources&&(inside(target,path.dirname(sources.database))||inside(target,sources.objects)||inside(sources.objects,target)||inside(sources.database,target)))fail('BACKUP_MUST_BE_SEPARATE_FROM_LIVE_STORAGE');
 return target;
}
export async function withBackupLock(database,appRoot,operation){
 const lock=checked(path.join(path.dirname(database),'.yourrest-backup.lock'),appRoot,{directory:true,allowMissing:true});
 try{await fs.mkdir(lock,{mode:0o700});}catch(error){if(error.code==='EEXIST')fail('BACKUP_ALREADY_RUNNING_OR_STALE_LOCK');throw error;}
 try{await writePrivate(path.join(lock,'owner.json'),JSON.stringify({format:'yourrest-backup-lock',pid:process.pid,startedAt:new Date().toISOString()})+'\n');return await operation();}
 finally{await fs.rm(lock,{recursive:true,force:true});await syncDirectory(path.dirname(lock));}
}
async function digestFile(filename,appRoot,{destination,expectedBytes}={}){
 checked(filename,appRoot);
 const input=await fs.open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);let output;
 try{
  const stat=await input.stat();
  if(!stat.isFile()||(stat.mode&0o077)||(process.getuid&&stat.uid!==process.getuid()))fail('UNSAFE_FILE');
  if(expectedBytes!==undefined&&stat.size!==expectedBytes)fail('FILE_SIZE_MISMATCH');
  if(destination)output=await fs.open(destination,'wx',0o600);
  const digest=createHash('sha256');let bytes=0;
  for await(const chunk of input.createReadStream({autoClose:false})){
   bytes+=chunk.length;if(expectedBytes!==undefined&&bytes>expectedBytes)fail('FILE_SIZE_MISMATCH');
   digest.update(chunk);if(output)await output.writeFile(chunk);
  }
  if(expectedBytes!==undefined&&bytes!==expectedBytes)fail('FILE_SIZE_MISMATCH');
  if(output)await output.sync();
  return {bytes,sha256:digest.digest('hex')};
 }finally{await output?.close();await input.close();}
}
function inspectDatabase(filename,{normalize=false}={}){
 const db=new DatabaseSync(filename,{readOnly:!normalize});
 try{
  db.exec('PRAGMA busy_timeout=5000;');
  if(normalize)db.exec('PRAGMA journal_mode=DELETE;');
  const integrity=db.prepare('PRAGMA integrity_check').all();
  if(integrity.length!==1||integrity[0].integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)fail('DATABASE_INTEGRITY_FAILED');
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
  for(const name of ['crm_members','crm_settings','crm_records','crm_visit_files','yr_schema_migrations'])if(!tables.has(name))fail('UNRECOGNIZED_DATABASE');
  if(!db.prepare('SELECT COUNT(*) n FROM yr_schema_migrations').get().n)fail('UNRECOGNIZED_DATABASE');
  const entries=db.prepare('SELECT object_key,size FROM crm_visit_files ORDER BY object_key').all(),unique=new Map();
  for(const row of entries){
   if(typeof row.object_key!=='string'||!row.object_key||row.object_key.length>2000||row.object_key.includes('\0')||!Number.isSafeInteger(row.size)||row.size<0)fail('INVALID_OBJECT_REFERENCE');
   if(unique.has(row.object_key)&&unique.get(row.object_key).bytes!==row.size)fail('CONFLICTING_OBJECT_REFERENCE');
   unique.set(row.object_key,{key:row.object_key,filename:hashKey(row.object_key),bytes:row.size});
  }
  return [...unique.values()];
 }finally{db.close();}
}
async function readManifest(folder,appRoot){
 const filename=checked(path.join(folder,'manifest.json'),appRoot);
 const info=await fs.stat(filename);if(info.size>64*1024*1024)fail('MANIFEST_TOO_LARGE');
 const manifest=JSON.parse(await fs.readFile(filename,'utf8'));
 if(manifest.format!==FORMAT||manifest.version!==VERSION||!/^[a-f0-9-]{36}$/.test(manifest.backupId||'')||!Number.isFinite(Date.parse(manifest.createdAt))||!(manifest.rootId===null||/^[a-f0-9-]{36}$/.test(manifest.rootId||''))||!Array.isArray(manifest.objects)||manifest.database?.filename!=='database.sqlite')fail('INVALID_MANIFEST');
 for(const file of [manifest.database,...manifest.objects])if(!Number.isSafeInteger(file.bytes)||file.bytes<0||!/^[a-f0-9]{64}$/.test(file.sha256||''))fail('INVALID_MANIFEST');
 return manifest;
}
export async function verifyBackup({directory,appRoot,expectedRootId}){
 directory=checked(directory,appRoot,{directory:true});
 const entries=(await fs.readdir(directory)).sort();
 if(entries.join('|')!==['database.sqlite','manifest.json','objects'].sort().join('|'))fail('UNEXPECTED_BACKUP_CONTENTS');
 const manifest=await readManifest(directory,appRoot);
 if(expectedRootId!==undefined&&manifest.rootId!==expectedRootId)fail('BACKUP_ROOT_MISMATCH');
 const databasePath=checked(path.join(directory,'database.sqlite'),appRoot),objectsPath=checked(path.join(directory,'objects'),appRoot,{directory:true});
 const database=await digestFile(databasePath,appRoot,{expectedBytes:manifest.database.bytes});
 if(database.sha256!==manifest.database.sha256)fail('DATABASE_HASH_MISMATCH');
 const expected=inspectDatabase(databasePath);
 if(expected.length!==manifest.objects.length)fail('OBJECT_REFERENCES_MISMATCH');
 const listed=new Map();
 for(const object of manifest.objects){
  if(typeof object.key!=='string'||!object.key||object.filename!==hashKey(object.key)||listed.has(object.key))fail('INVALID_MANIFEST');
  listed.set(object.key,object);
 }
 const files=(await fs.readdir(objectsPath)).sort();
 if(files.join('|')!==expected.map(row=>row.filename).sort().join('|'))fail('OBJECT_FILES_MISMATCH');
 for(const reference of expected){
  const entry=listed.get(reference.key);if(!entry||entry.bytes!==reference.bytes)fail('OBJECT_REFERENCES_MISMATCH');
  const result=await digestFile(path.join(objectsPath,reference.filename),appRoot,{expectedBytes:entry.bytes});
  if(result.sha256!==entry.sha256)fail('OBJECT_HASH_MISMATCH');
 }
 return {manifest,objects:expected.length,bytes:manifest.database.bytes+manifest.objects.reduce((sum,file)=>sum+file.bytes,0)};
}
async function createUnlocked({config,appRoot,destination,rootId=null}){
 const sources=sourcePaths(config,appRoot);destination=destinationPath(destination,appRoot,sources);await absent(destination);
 const stage=path.join(path.dirname(destination),'.yourrest-backup-staging-'+randomUUID());await fs.mkdir(stage,{mode:0o700});
 try{
  const databasePath=path.join(stage,'database.sqlite'),source=new DatabaseSync(sources.database,{readOnly:true});
  try{source.exec('PRAGMA busy_timeout=5000;');await sqliteBackup(source,databasePath);}finally{source.close();}
  await fs.chmod(databasePath,0o600);
  const references=inspectDatabase(databasePath,{normalize:true});
  const dbFile=await fs.open(databasePath,'r');try{await dbFile.sync();}finally{await dbFile.close();}
  const objectsPath=path.join(stage,'objects');await fs.mkdir(objectsPath,{mode:0o700});
  const objects=[];
  // Application uploads have unique keys and are committed only after durable object writes.
  // No committed object is replaced/deleted. A missing or changed source fails this backup.
  for(const reference of references){const result=await digestFile(path.join(sources.objects,reference.filename),appRoot,{destination:path.join(objectsPath,reference.filename),expectedBytes:reference.bytes});objects.push({...reference,sha256:result.sha256});}
  await syncDirectory(objectsPath);
  const database=await digestFile(databasePath,appRoot);
  const manifest={format:FORMAT,version:VERSION,backupId:randomUUID(),rootId,createdAt:new Date().toISOString(),database:{filename:'database.sqlite',...database},objects};
  await writePrivate(path.join(stage,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');await syncDirectory(stage);
  const verified=await verifyBackup({directory:stage,appRoot});
  await absent(destination);await fs.rename(stage,destination);await syncDirectory(path.dirname(destination));
  return {directory:destination,backupId:manifest.backupId,createdAt:manifest.createdAt,objects:verified.objects,bytes:verified.bytes};
 }catch(error){await fs.rm(stage,{recursive:true,force:true});throw error;}
}
export async function createBackup(options){const {database}=sourcePaths(options.config,options.appRoot);return withBackupLock(database,options.appRoot,()=>createUnlocked(options));}

export async function restoreBackup({directory,destination,appRoot}){
 directory=checked(directory,appRoot,{directory:true});destination=destinationPath(destination,appRoot);await absent(destination);
 if(inside(destination,directory)||inside(directory,destination))fail('RESTORE_MUST_BE_SEPARATE_FROM_BACKUP');
 const verified=await verifyBackup({directory,appRoot});
 const stage=path.join(path.dirname(destination),'.yourrest-restore-staging-'+randomUUID());await fs.mkdir(stage,{mode:0o700});
 try{
  await fs.mkdir(path.join(stage,'objects'),{mode:0o700});
  for(const item of [verified.manifest.database,...verified.manifest.objects]){
   const relative=item===verified.manifest.database?item.filename:path.join('objects',item.filename);
   const result=await digestFile(path.join(directory,relative),appRoot,{destination:path.join(stage,relative),expectedBytes:item.bytes});
   if(result.sha256!==item.sha256)fail('BACKUP_CHANGED_DURING_RESTORE');
  }
  await writePrivate(path.join(stage,'manifest.json'),JSON.stringify(verified.manifest,null,2)+'\n');
  await syncDirectory(path.join(stage,'objects'));await syncDirectory(stage);
  await verifyBackup({directory:stage,appRoot});
  // Restore only to a new destination. Never modify settings or a live database.
  await absent(destination);await fs.rename(stage,destination);await syncDirectory(path.dirname(destination));
  return {directory:destination,backupId:verified.manifest.backupId,objects:verified.objects,bytes:verified.bytes};
 }catch(error){await fs.rm(stage,{recursive:true,force:true});throw error;}
}
export async function scheduledBackup({config,appRoot,backupRoot,retain=14}){
 if(!Number.isInteger(retain)||retain<2||retain>365)fail('RETENTION_MUST_BE_2_TO_365');
 const sources=sourcePaths(config,appRoot);backupRoot=destinationPath(backupRoot,appRoot,sources);
 await fs.mkdir(backupRoot,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});checked(backupRoot,appRoot,{directory:true});
 return withBackupLock(sources.database,appRoot,async()=>{
  const markerPath=path.join(backupRoot,'.yourrest-backup-root.json'),statusPath=path.join(backupRoot,'status.json');
  let marker;
  try{checked(markerPath,appRoot);marker=JSON.parse(await fs.readFile(markerPath,'utf8'));if(marker.format!=='yourrest-backup-root'||!/^[a-f0-9-]{36}$/.test(marker.rootId||''))fail('INVALID_BACKUP_ROOT');}
  catch(error){if(error.code!=='ENOENT')throw error;marker={format:'yourrest-backup-root',rootId:randomUUID()};await writePrivate(markerPath,JSON.stringify(marker)+'\n');await syncDirectory(backupRoot);}
  // Only overwrite status files owned by this backup directory, never unrelated files/symlinks.
  try{checked(statusPath,appRoot);const old=JSON.parse(await fs.readFile(statusPath,'utf8'));if(old.format!=='yourrest-backup-status'||old.rootId!==marker.rootId)fail('INVALID_BACKUP_STATUS');}catch(error){if(error.code!=='ENOENT')throw error;}
  const startedAt=new Date().toISOString();
  await atomicJson(statusPath,{format:'yourrest-backup-status',rootId:marker.rootId,state:'running',startedAt});
  try{
   const name='yourrest-backup-'+startedAt.replace(/[-:.]/g,'')+'-'+randomUUID();
   const result=await createUnlocked({config,appRoot,destination:path.join(backupRoot,name),rootId:marker.rootId});
   const candidates=[];let preservedUnverified=0;
   for(const entry of await fs.readdir(backupRoot,{withFileTypes:true})){
    if(!entry.name.startsWith('yourrest-backup-'))continue;
    if(!entry.isDirectory()||entry.isSymbolicLink()){preservedUnverified++;continue;}
    const directory=path.join(backupRoot,entry.name);
    try{const prior=await verifyBackup({directory,appRoot,expectedRootId:marker.rootId});candidates.push({directory,createdAt:prior.manifest.createdAt});}catch{preservedUnverified++;}
   }
   candidates.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||b.directory.localeCompare(a.directory));
   let removed=0;
   for(const candidate of candidates.slice(retain)){if(candidate.directory===result.directory)continue;await verifyBackup({directory:candidate.directory,appRoot,expectedRootId:marker.rootId});await fs.rm(candidate.directory,{recursive:true});removed++;}
   await syncDirectory(backupRoot);
   const status={format:'yourrest-backup-status',rootId:marker.rootId,state:'ok',startedAt,completedAt:new Date().toISOString(),backupName:name,objects:result.objects,bytes:result.bytes,retain,removed,preservedUnverified};
   await atomicJson(statusPath,status);return status;
  }catch(error){await atomicJson(statusPath,{format:'yourrest-backup-status',rootId:marker.rootId,state:'failed',startedAt,completedAt:new Date().toISOString(),errorCode:safeErrorCode(error)});throw error;}
 });
}
export const safeErrorCode=error=>/^[A-Z0-9_]{1,100}$/.test(error?.code||'')?error.code:'BACKUP_OPERATION_FAILED';
