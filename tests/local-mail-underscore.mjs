// A company mailbox accepted by the member form must reach the existing
// sendmail transport. Use a private capture executable; never deliver email.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {createLocalMailer,localMailSettings} from '../portable/local-mail.mjs';

const work=await fs.mkdtemp(path.join(os.tmpdir(),'yourrest-mail-underscore-'));
const capture=path.join(work,'accepted.json'),executable=path.join(work,'capture.cjs');
let checks=0;
try{
 await fs.writeFile(executable,'#!'+process.execPath+'\n'+
  `const fs=require('node:fs');let message='';process.stdin.setEncoding('utf8');process.stdin.on('data',part=>message+=part);process.stdin.on('end',()=>fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify({args:process.argv.slice(2),message}),{mode:0o600}));`,{mode:0o700});
 const settings=localMailSettings({YR_APP_ORIGIN:'https://crm.yourrest.org',YR_MAIL_FROM:'noreply@yourrest.org',YR_MAIL_TRANSPORT:'sendmail',YR_SENDMAIL_PATH:executable});
 const send=createLocalMailer(settings),to='_sales@yourrest.org';
 // This is already a valid account address under the member and login rules.
 assert(z.string().email().max(200).safeParse(to).success);checks++;
 const message={to,code:'123456',expiresInMinutes:10,signal:new AbortController().signal};
 await assert.doesNotReject(send(message),'An existing valid underscore mailbox must receive its login code');checks++;
 const accepted=JSON.parse(await fs.readFile(capture,'utf8'));
 assert.deepEqual(accepted.args,['-i','-f','noreply@yourrest.org','--',to]);checks++;
 const [headers,body]=accepted.message.split('\r\n\r\n');
 assert(headers.includes('To: <_sales@yourrest.org>'));checks++;
 assert(!headers.includes(message.code));checks++;
 assert(Buffer.from(body.replaceAll('\r\n',''),'base64').toString('utf8').includes(message.code));checks++;
 for(const unsafe of ['-sales@yourrest.org','_sales@yourrest.org\r\nBcc: x@yourrest.org','_sales@yourrest.org,x@yourrest.org','_$(cmd)@yourrest.org','_`cmd`@yourrest.org','_sales\0@yourrest.org']){
  await assert.rejects(send({...message,to:unsafe}),/Local email delivery failed/);checks++;
 }
 console.log(JSON.stringify({ok:true,checks,actualEmailSent:false,coverage:'leading underscore mailbox accepted by accounts, sendmail argv and header injection rejection'}));
}finally{await fs.rm(work,{recursive:true,force:true});}
