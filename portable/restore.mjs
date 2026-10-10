import path from 'node:path';
import {verifyBackup,restoreBackup,safeErrorCode} from './backup-core.mjs';
process.umask(0o077);
try{
 const appRoot=path.resolve(import.meta.dirname,'../..'),[command,directory,destination]=process.argv.slice(2);
 let result;
 if(command==='verify'&&directory&&!destination){const checked=await verifyBackup({directory,appRoot});result={backupId:checked.manifest.backupId,createdAt:checked.manifest.createdAt,objects:checked.objects,bytes:checked.bytes};}
 else if(command==='restore'&&directory&&destination&&process.argv.length===5)result=await restoreBackup({directory,destination,appRoot});
 else throw Error('Use verify BACKUP or restore BACKUP NEW_PRIVATE_FOLDER');
 console.log(JSON.stringify({ok:true,...result,liveDataModified:false}));
}catch(error){console.error(JSON.stringify({ok:false,errorCode:safeErrorCode(error)}));process.exitCode=1;}
