import path from 'node:path';
import {createRequire} from 'node:module';
import {scheduledBackup,safeErrorCode} from './backup-core.mjs';
process.umask(0o077);
try{
 const appRoot=path.resolve(import.meta.dirname,'../..'),{loadSettings}=createRequire(import.meta.url)('./config.cjs');
 if(process.argv.length<3||process.argv.length>4)throw Error('Supply an absolute private backup root and optional retention count');
 const result=await scheduledBackup({config:loadSettings(appRoot),appRoot,backupRoot:process.argv[2],retain:process.argv[3]===undefined?14:Number(process.argv[3])});
 console.log(JSON.stringify({ok:true,...result}));
}catch(error){console.error(JSON.stringify({ok:false,errorCode:safeErrorCode(error)}));process.exitCode=1;}
