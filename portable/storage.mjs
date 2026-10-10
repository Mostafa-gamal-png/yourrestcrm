import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync,lstatSync,mkdirSync,realpathSync,chmodSync,constants} from 'node:fs';
import {open,rename,unlink,mkdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';

function privatePath(filename,directory=false){
 if(!path.isAbsolute(filename)||filename.includes('\0'))throw Error('Storage path must be absolute');
 const resolved=path.resolve(filename);
 if(resolved.split(path.sep).includes('public_html'))throw Error('Storage must be outside public_html');
 // Reject symlinked ancestors as well as the final path; do not hide a public path behind an alias.
 for(let current=resolved;current!==path.dirname(current);current=path.dirname(current)){
  if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw Error('Storage symlinks are not allowed');
 }
 if(existsSync(resolved)){
  const stat=lstatSync(resolved);
  if(directory?!stat.isDirectory():!stat.isFile())throw Error('Invalid storage path');
  if(stat.mode&0o077)throw Error('Storage must be private (directory 0700, file 0600)');
 }
 return resolved;
}

/** One synchronous SQLite connection keeps every guarded write and its audit in the same transaction. */
export function sqliteDatabase(filename,{create=false}={}){
 const [major,minor]=process.versions.node.split('.').map(Number);
 if(major<22||(major===22&&minor<16))throw Error('Independent storage requires Node.js >=22.16');
 filename=privatePath(filename);
 const existed=existsSync(filename);
 if(!create&&!existed)throw Error('Database must be initialized or restored before startup');
 privatePath(path.dirname(filename),true);
 const sql=new DatabaseSync(filename);
 try{
  if(!existed)chmodSync(filename,0o600);
  sql.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
 }catch(error){sql.close();throw error;}
 class Statement{
  constructor(query,args=[]){this.query=query;this.args=args;}
  bind(...args){return new Statement(this.query,args);}
  execute(){
   const statement=sql.prepare(this.query);let results=[],changes=0;
   if(statement.columns().length){results=statement.all(...this.args);changes=Number(sql.prepare('SELECT changes() n').get().n);}
   else changes=Number(statement.run(...this.args).changes);
   return {results,success:true,meta:{changes}};
  }
  async first(column){const row=sql.prepare(this.query).get(...this.args);return row?(column===undefined?row:row[column]??null):null;}
  async all(){return this.execute();}
  async run(){return this.execute();}
  async raw(){const statement=sql.prepare(this.query);statement.setReturnArrays(true);return statement.all(...this.args);}
 }
 return {
  prepare:query=>new Statement(query),
  async batch(statements){
   if(!Array.isArray(statements)||!statements.every(statement=>statement instanceof Statement))throw Error('Batch statements must belong to this database');
   sql.exec('BEGIN IMMEDIATE');
   try{const results=statements.map(statement=>statement.execute());sql.exec('COMMIT');return results;}
   catch(error){sql.exec('ROLLBACK');throw error;}
  },
  async exec(query){sql.exec(query);return {count:0,duration:0};},
  async snapshot(destination){
   destination=privatePath(destination);
   if(existsSync(destination))throw Error('Backup destination must be a new absolute path');
   privatePath(path.dirname(destination),true);
   await backup(sql,destination);chmodSync(destination,0o600);
   const file=await open(destination,'r');try{await file.sync();}finally{await file.close();}
  },
  close:()=>sql.close(),connection:sql
 };
}

// Keys are hashed, never interpreted as filenames. The web server cannot serve this directory.
export function privateObjects(directory){
 directory=privatePath(directory,true);
 mkdirSync(directory,{recursive:true,mode:0o700});
 privatePath(directory,true);
 const root=realpathSync(directory);
 const location=key=>{
  if(typeof key!=='string'||!key||key.length>2000||key.includes('\0'))throw Error('Invalid object key');
  return path.join(root,createHash('sha256').update(key).digest('hex'));
 };
 async function syncDirectory(){const dir=await open(root,'r');try{await dir.sync();}finally{await dir.close();}}
 return {
  async put(key,value){
   const destination=location(key),temp=path.join(root,'.upload-'+randomUUID());
   const bytes=typeof value==='string'?new TextEncoder().encode(value):value instanceof ArrayBuffer?new Uint8Array(value):value;
   if(!(bytes instanceof Uint8Array))throw Error('Unsupported object body');
   const file=await open(temp,'wx',0o600);
   try{await file.writeFile(bytes);await file.sync();await file.close();await rename(temp,destination);await syncDirectory();}
   catch(error){await file.close().catch(()=>{});await unlink(temp).catch(()=>{});throw error;}
   return {key,size:bytes.length};
  },
  async get(key){
   let file;
   try{file=await open(location(key),constants.O_RDONLY|constants.O_NOFOLLOW);const stat=await file.stat();if(!stat.isFile()||(stat.mode&0o077))throw Error('Invalid private object');const bytes=await file.readFile();return {body:bytes,key,size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};}
   catch(error){if(error.code==='ENOENT')return null;throw error;}
   finally{await file?.close();}
  },
  async delete(key){
   const keys=Array.isArray(key)?key:[key];
   const filenames=keys.map(location);
   for(const filename of filenames)try{await unlink(filename);}catch(error){if(error.code!=='ENOENT')throw error;}
   await syncDirectory();
  },
  async exportObject(key,destination){
   const object=await this.get(key);if(!object)throw Error('Referenced object is missing');
   await mkdir(path.dirname(destination),{recursive:true,mode:0o700});
   privatePath(path.dirname(destination),true);privatePath(destination);
   const file=await open(destination,'wx',0o600);try{await file.writeFile(object.body);await file.sync();}finally{await file.close();}
   return {key,size:object.size,sha256:createHash('sha256').update(object.body).digest('hex')};
  }
 };
}
