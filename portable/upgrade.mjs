import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {initializeDatabase,inspectInitializedDatabase} from './initialize.mjs';
const {validatePrivatePath}=createRequire(import.meta.url)('./config.cjs');

/** Apply only append-only upgrades to an already recognized installation, after a private backup. */
export async function upgradeExistingDatabase({filename,migrations,appRoot}){
 const options={filename,migrations,appRoot};
 const inspection=inspectInitializedDatabase(options);
 if(!inspection.pending.length)return {upgraded:false,migrations:inspection.migrations};
 const directory=validatePrivatePath(path.join(path.dirname(filename),'schema-backups'),{root:appRoot,directory:true,allowMissing:true});
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 validatePrivatePath(directory,{root:appRoot,directory:true});
 const destination=path.join(directory,'before-'+inspection.pending[0].replace(/\.sql$/,'')+'-'+randomUUID()+'.sqlite');
 const db=new DatabaseSync(filename,{readOnly:true});
 try{
  await backup(db,destination);
  fs.chmodSync(destination,0o600);
  const file=fs.openSync(destination,'r');try{fs.fsyncSync(file);}finally{fs.closeSync(file);}
  const dir=fs.openSync(directory,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
 }catch(error){fs.rmSync(destination,{force:true});throw error;}finally{db.close();}
 // initializeDatabase revalidates history and ownership inside its write transaction.
 // On failure it rolls back every schema/ledger change; the pre-upgrade backup remains.
 const result=initializeDatabase(options);
 return {upgraded:true,migrations:result.migrations,backup:destination};
}
