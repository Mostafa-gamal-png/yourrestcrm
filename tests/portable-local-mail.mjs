import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createLocalMailer,localMailSettings} from '../portable/local-mail.mjs';
import {passengerClient} from '../portable/passenger-client.mjs';
import {checkHosting} from '../portable/check-hosting.mjs';
const work=await mkdtemp(path.join(os.tmpdir(),'yourrest-mail-')),capture=path.join(work,'capture.json');
const savedPassenger=globalThis.PhusionPassenger,savedFlag=process.env.YR_PASSENGER_HEADERS_VERIFIED,savedOrigin=process.env.YR_APP_ORIGIN;process.env.YR_APP_ORIGIN='https://crm.example.test';
let checks=0;
try{
 async function stub(name,code){const file=path.join(work,name);await writeFile(file,'#!'+process.execPath+'\n'+code,{mode:0o700});return file;}
 const executable=await stub('accept.cjs',`const fs=require('node:fs');let message='';process.stdin.on('data',b=>message+=b);process.stdin.on('end',()=>fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify({args:process.argv.slice(2),message,secret:process.env.YR_AUTH_SECRET}),{mode:0o600}));`);
 const values={YR_MAIL_TRANSPORT:'sendmail',YR_APP_ORIGIN:'https://crm.example.test',YR_MAIL_FROM:'noreply@example.test',YR_SENDMAIL_PATH:executable};
 const settings=localMailSettings(values),send=createLocalMailer(settings),message={to:'person+tag@example.test',code:'123456',expiresInMinutes:10,signal:new AbortController().signal};
 await send(message);const result=JSON.parse(await readFile(capture,'utf8'));
 assert.deepEqual(result.args,['-i','-f','noreply@example.test','--','person+tag@example.test']);assert.equal(result.secret,undefined);
 const [headers,body]=result.message.split('\r\n\r\n');assert(!headers.includes(message.code));assert(Buffer.from(body.replaceAll('\r\n',''),'base64').toString('utf8').includes(message.code));assert(body.split('\r\n').every(line=>line.length<=76));checks++;
 for(const to of ['p@example.test\r\nBcc: x@example.test','a@example.test,b@example.test','-x@example.test','x\0@example.test','Name <a@example.test>','$(cmd)@example.test','`cmd`@example.test']){await assert.rejects(send({...message,to}),/Local email delivery failed/);checks++;}
 for(const extra of [{code:'123456\n'},{code:'1'},{expiresInMinutes:100}]){await assert.rejects(send({...message,...extra}));checks++;}
 for(const extra of [{YR_MAIL_FROM:'x@other.test'},{YR_MAIL_TRANSPORT:'smtp'},{YR_SENDMAIL_PATH:'relative'},{YR_APP_ORIGIN:'http://crm.example.test'},{YR_MAIL_FROM:'a@example.test\r\nBcc: x@example.test'}]){assert.throws(()=>localMailSettings({...values,...extra}));checks++;}
 const abort=new AbortController();abort.abort();await assert.rejects(send({...message,signal:abort.signal}));checks++;
 await assert.rejects(createLocalMailer({...settings,executable:path.join(work,'missing')})(message),/Local email delivery failed/);checks++;
 const fail=await stub('fail.cjs',"process.stderr.write('sensitive provider details');process.exit(42);");await assert.rejects(createLocalMailer({...settings,executable:fail})(message),error=>error.message==='Local email delivery failed');checks++;
 const hanging=await stub('hang.cjs',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000);");
 const during=new AbortController();const pending=createLocalMailer({...settings,executable:hanging})({...message,signal:during.signal});setTimeout(()=>during.abort(),100);await assert.rejects(pending);checks++;
 const started=Date.now();await assert.rejects(createLocalMailer({...settings,executable:hanging})(message));assert(Date.now()-started<6000);checks++;
 const early=await stub('early.cjs',"process.stdin.destroy();process.exit(2);");await assert.rejects(createLocalMailer({...settings,executable:early})(message));checks++;
 const secure=new Headers({'!~Passenger-Client-Address':'203.0.113.9','!~Passenger-Proto':'https'});
 delete globalThis.PhusionPassenger;process.env.YR_PASSENGER_HEADERS_VERIFIED='yes';assert.equal(passengerClient(secure),'independent:shared');checks++;
 globalThis.PhusionPassenger={configure(){}};delete process.env.YR_PASSENGER_HEADERS_VERIFIED;assert.equal(passengerClient(secure),'independent:shared');checks++;
 process.env.YR_PASSENGER_HEADERS_VERIFIED='yes';assert.equal(passengerClient(secure),'passenger:203.0.113.9');checks++;
 for(const h of [new Headers({'x-forwarded-for':'203.0.113.9','x-forwarded-proto':'https'}),new Headers({'!~Passenger-Client-Address':'203.0.113.9, 203.0.113.8','!~Passenger-Proto':'https'}),new Headers({'!~Passenger-Client-Address':'203.0.113.9','!~Passenger-Proto':'http'}),new Headers({'!~Passenger-Client-Address':'bad','!~Passenger-Proto':'https'})]){assert.equal(passengerClient(h),'independent:shared');checks++;}
 secure.set('!~Passenger-Client-Address','2001:0db8:0:0:0:0:0:1');assert.equal(passengerClient(secure),'passenger:2001:db8::1');checks++;
 const report=await checkHosting(values);assert(report.node_supported&&report.sqlite_available&&report.local_mail_ready);assert.equal(report.production_ready,false);checks++;
 delete globalThis.PhusionPassenger;delete process.env.YR_PASSENGER_HEADERS_VERIFIED;
 for (const client of ['198.51.100.1','198.51.100.2','garbage']) {assert.equal(passengerClient(new Headers({'x-forwarded-for':client,'x-forwarded-proto':'https'})),'independent:shared');checks++;}
 delete process.env.YR_APP_ORIGIN;assert.equal(passengerClient(new Headers()),null);checks++;
 process.env.YR_APP_ORIGIN='http://crm.example.test';assert.equal(passengerClient(new Headers()),null);checks++;
 console.log(JSON.stringify({ok:true,checks,actual_email_sent:false,real_passenger_tested:false,shared_limiter_tested:true}));
}finally{
 if(savedPassenger===undefined)delete globalThis.PhusionPassenger;else globalThis.PhusionPassenger=savedPassenger;
 if(savedFlag===undefined)delete process.env.YR_PASSENGER_HEADERS_VERIFIED;else process.env.YR_PASSENGER_HEADERS_VERIFIED=savedFlag;
 if(savedOrigin===undefined)delete process.env.YR_APP_ORIGIN;else process.env.YR_APP_ORIGIN=savedOrigin;
 await rm(work,{recursive:true,force:true});
}
