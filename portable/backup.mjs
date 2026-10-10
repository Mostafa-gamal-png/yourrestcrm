import path from 'node:path';
import {createRequire} from 'node:module';
import {createBackup,safeErrorCode} from './backup-core.mjs';
process.umask(0o077);
try{
 const appRoot=path.resolve(import.meta.dirname,'../..'),{loadSettings}=createRequire(import.meta.url)('./config.cjs');
 if(process.argv.length!==3)throw Error('Supply a new absolute private backup folder');
 const result=await createBackup({config:loadSettings(appRoot),appRoot,destination:process.argv[2]});
 console.log(JSON.stringify({ok:true,...result,settingsIncluded:false}));
}catch(error){console.error(JSON.stringify({ok:false,errorCode:safeErrorCode(error)}));process.exitCode=1;}
