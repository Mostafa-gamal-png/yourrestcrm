// Terminal-only diagnostics. Never creates production storage or sends mail by default.
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {randomInt} from 'node:crypto';
import {localMailSettings,createLocalMailer} from './local-mail.mjs';

export async function checkHosting(values=process.env){
 const [major,minor]=process.versions.node.split('.').map(Number);
 const result={node_version:process.versions.node,node_supported:major>22||(major===22&&minor>=16),sqlite_available:false,https_origin_configured:false,local_mail_ready:false,client_rate_limit:'shared unless verified Passenger headers are available',real_https_test:'required on hosting',production_ready:false};
 try{const origin=new URL(values.YR_APP_ORIGIN);result.https_origin_configured=origin.protocol==='https:'&&origin.origin===values.YR_APP_ORIGIN&&!origin.username&&!origin.password;}catch{}
 try{const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(':memory:');try{result.sqlite_available=db.prepare('SELECT 1 AS ok').get().ok===1;}finally{db.close();}}catch{}
 try{localMailSettings(values);result.local_mail_ready=true;}catch{}
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  const args=process.argv.slice(2);
  if(args.length&&!(args.length===2&&args[0]==='--send-test-to'))throw Error();
  if(args.length){
   await createLocalMailer(localMailSettings())({to:args[1],code:String(randomInt(1_000_000)).padStart(6,'0'),expiresInMinutes:10,signal:AbortSignal.timeout(5000)});
   console.log(JSON.stringify({accepted_by_mail_server:true,inbox_delivery:'check recipient inbox',login_enabled:false}));
  }else console.log(JSON.stringify(await checkHosting(),null,2));
 }catch{console.error('Hosting check or mail test failed. Check the private hosting configuration.');process.exitCode=1;}
}
