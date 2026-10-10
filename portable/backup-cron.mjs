import path from 'node:path';
import {createRequire} from 'node:module';
import {safeErrorCode} from './backup-core.mjs';
// Produces a command only. Installing/enabling Cron Jobs remains an explicit hosting action.
try{
 const appRoot=path.resolve(import.meta.dirname,'../..'),{loadSettings,validatePrivatePath}=createRequire(import.meta.url)('./config.cjs');
 loadSettings(appRoot);
 const backupRoot=process.argv[2],retain=process.argv[3]===undefined?14:Number(process.argv[3]);
 if(process.argv.length<3||process.argv.length>4||!Number.isInteger(retain)||retain<2||retain>365)throw Error('Invalid arguments');
 validatePrivatePath(backupRoot,{root:appRoot,directory:true});
 const log=path.join(backupRoot,'last-run.log');validatePrivatePath(log,{root:appRoot,allowMissing:true});
 const paths=[process.execPath,path.join(import.meta.dirname,'backup-scheduled.mjs'),backupRoot,log];
 if(paths.some(value=>/[\r\n%\0]/.test(value)))throw Error('Unsupported cron path');
 const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
 const command='umask 077; '+paths.slice(0,3).map(quote).join(' ')+' '+retain+' > '+quote(log)+' 2>&1';
 console.log(JSON.stringify({enabled:false,minute:'15',hour:'2',day:'*',month:'*',weekday:'*',timezone:'hosting server timezone',command}));
}catch(error){console.error(JSON.stringify({ok:false,errorCode:safeErrorCode(error)}));process.exitCode=1;}
