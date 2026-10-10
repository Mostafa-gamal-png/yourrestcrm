import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {accessSync,constants,statSync} from 'node:fs';
import path from 'node:path';

const failure=()=>Error('Local email delivery failed');
function address(value){
 if(typeof value!=='string'||value.length>254||! /^[a-z0-9_][a-z0-9._+-]{0,63}@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(value))throw failure();
 return value.toLowerCase();
}
export function localMailSettings(values=process.env){
 if(values.YR_MAIL_TRANSPORT!=='sendmail')throw failure();
 const origin=new URL(values.YR_APP_ORIGIN),from=address(values.YR_MAIL_FROM),domain=from.split('@')[1];
 if(origin.protocol!=='https:'||origin.origin!==values.YR_APP_ORIGIN||!(origin.hostname===domain||origin.hostname.endsWith('.'+domain)))throw failure();
 const executable=values.YR_SENDMAIL_PATH||'/usr/sbin/sendmail';
 if(!path.isAbsolute(executable)||/[\0\r\n]/.test(executable))throw failure();
 const file=statSync(executable);
 if(!file.isFile()||(file.mode&0o022))throw failure();
 accessSync(executable,constants.X_OK);
 return {from,executable};
}
export function createLocalMailer(settings){
 const from=address(settings.from),executable=settings.executable;
 if(!path.isAbsolute(executable)||/[\0\r\n]/.test(executable))throw failure();
 return async({to,code,expiresInMinutes,signal})=>{
  to=address(to);
  if(typeof code!=='string'||!/^\d{6}$/.test(code)||!Number.isInteger(expiresInMinutes)||expiresInMinutes<1||expiresInMinutes>15||signal?.aborted)throw failure();
  const body=`رمز الدخول إلى Yourrest: ${code}\n\nصالح لمدة ${expiresInMinutes} دقائق ولمرة واحدة فقط.\nلا تشارك الرمز مع أي شخص. إذا لم تطلب الدخول، تجاهل الرسالة.\n`;
  const base64=Buffer.from(body,'utf8').toString('base64').match(/.{1,76}/g).join('\r\n');
  const message=[`From: Yourrest CRM <${from}>`,`To: <${to}>`,`Date: ${new Date().toUTCString()}`,`Message-ID: <${randomUUID()}@${from.split('@')[1]}>`,'Subject: Yourrest sign-in code','MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',base64,''].join('\r\n');
  await new Promise((resolve,reject)=>{
   let child,settled=false;
   const finish=ok=>{if(settled)return;settled=true;if(ok)resolve();else reject(failure());};
   try{
    // No shell, no address-derived options, and no secrets in args/logs/env.
    child=spawn(executable,['-i','-f',from,'--',to],{shell:false,stdio:['pipe','ignore','ignore'],env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},signal,timeout:4500,killSignal:'SIGKILL'});
    child.on('error',()=>finish(false));
    child.stdin.on('error',()=>{child.kill('SIGKILL');finish(false);});
    child.on('close',(status,killed)=>finish(status===0&&!killed&&!signal?.aborted));
    child.stdin.end(message);
   }catch{child?.kill('SIGKILL');finish(false);}
  });
  // Acceptance by the local mail server is not a delivery receipt. Never retry here.
 };
}
export function configuredLocalMailer(){
 try{return createLocalMailer(localMailSettings());}catch{return undefined;}
}
