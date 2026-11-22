// Sign-in by a code sent to the company email (lib/email-auth.ts) and the settings it reads (lib/auth-environment.ts), on the real modules
// transpiled as the build does and imported (tests/email-auth.mjs runs the same flow from a temporary folder outside .sites-runtime, where
// its coverage is not counted), over SQLite with every migration. The platform's `env` is a stand-in object; delivery is a stand-in that
// keeps the messages; the clock is fixed and the timers pass at once. Every member, address, secret and code is made up.
// 1. The settings: the mode, the database, the origin, the secret, delivery, the client key, all read when used.
// 2. What a request must be: the configuration (an https origin exactly, a hex secret of 64 or more), POST, the same origin, a known
//    action, JSON of at most 2 KB in UTF-8; every answer private and not stored.
// 3. Asking for a code: the company domain only (marks and capitals of a paste taken out), the same answer for a member, an unknown address,
//    an inactive one and a throttled one, padded to the same deadline; the code kept only as an HMAC bound to its challenge; one mail a
//    minute and five an hour per address; ten requests a minute per client and a thousand for everyone; a delivery that fails or hangs.
// 4. Verifying: six digits (spaces, marks and letters refused; a code typed in Arabic-Indic digits is not asserted either way: the screen drops
//    such digits, app/email-login.tsx, an open question), five attempts, ten minutes, once, bound to the challenge in the cookie, the
//    member still active and unchanged; then the session cookie.
// 5. The session, its refresh and the sign-out; an internal failure that says nothing; a code drawn without modulo bias.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

const NativeDate=Date;let clock=NativeDate.parse('2026-11-22T06:00:00.000Z');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'email-auth-unit-')),seen=new Set();
process.on('exit',()=>{globalThis.Date=NativeDate;fs.rmSync(out,{recursive:true,force:true});});
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';
  compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
const testEnv={};globalThis.testEnv=testEnv;
const load=async relative=>{compile(relative);return import(pathToFileURL(path.join(out,relative.replace(/\.tsx?$/,'.mjs'))));};
const A=await load('lib/email-auth.ts'),E=await load('lib/auth-environment.ts');

// Timers: the body's 10 s deadline is never reached; every other timer (delivery, padding) passes at once and is recorded.
const waited=[],handles=new Map();let timerId=0;
globalThis.setTimeout=(callback,delay)=>{const id=++timerId;if(delay===10_000){handles.set(id,{manual:true});return id;}waited.push(delay);const handle={cancelled:false};handles.set(id,handle);setImmediate(()=>{if(!handle.cancelled){handles.delete(id);callback();}});return id;};
globalThis.clearTimeout=id=>{const handle=handles.get(id);if(handle){handle.cancelled=true;handles.delete(id);}};

const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const file of fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',file),'utf8'));
class Statement{
 constructor(query,args=[]){this.query=query;this.args=args;}
 bind(...args){return new Statement(this.query,args);}
 execute(){const statement=sql.prepare(this.query);if(statement.columns().length){const results=statement.all(...this.args).map(row=>({...row}));return {success:true,results,meta:{changes:0}};}const result=statement.run(...this.args);return {success:true,results:[],meta:{changes:Number(result.changes)}};}
 async first(column){const row=sql.prepare(this.query).get(...this.args);return row?(column===undefined?{...row}:row[column]??null):null;}
 async all(){return this.execute();}
 async run(){return this.execute();}
}
const db={prepare:query=>new Statement(query),async batch(statements){sql.exec('BEGIN IMMEDIATE');try{const results=statements.map(statement=>statement.execute());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
sql.exec(`INSERT INTO crm_members (id,user_id,email,name,role,branch,supervisor_id,active,target,created_at,region_scope) VALUES
 ('rep','u-rep','rep@yourrest.org','مندوب الرياض','rep','الرئيسي',NULL,1,0,'2026-11-01','central'),
 ('new',NULL,'new@yourrest.org','مندوب جديد','rep','الرئيسي',NULL,1,0,'2026-11-01','central'),
 ('off',NULL,'off@yourrest.org','موقوف','rep','الرئيسي',NULL,0,0,'2026-11-01','central'),
 ('tag','u-tag','first.last+crm@yourrest.org','بوسم','rep','الرئيسي',NULL,1,0,'2026-11-01','eastern');`);

let checks=0;const counts={};
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
const counted=async(part,fn)=>{const before=checks;await fn();counts[part]=checks-before;};
const origin='https://crm.yourrest.org',secret='0123456789abcdef'.repeat(4);
const hmac=value=>createHmac('sha256',secret).update(value).digest('hex');
let mail=[],deliver=async()=>{},clientCount=0;
const config={origin,secret,now:()=>clock,clientKey:()=>'client-'+(++clientCount),deliveryDeadlineMs:0,send:async message=>{mail.push(message);await deliver(message);}};
async function call(action,body,{cookie='',headers={},override={},method='POST',raw}={}){
 const init={method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers}};
 if(method!=='GET'&&method!=='HEAD')init.body=raw??JSON.stringify(body);
 const response=await A.handleEmailAuth(new Request(origin+'/api/auth/'+action,init),action,db,{...config,...override});
 const text=await response.text();let value;try{value=JSON.parse(text);}catch{value=text;}
 return {status:response.status,value,headers:response.headers,setCookie:response.headers.get('set-cookie')||'',cookie:(response.headers.get('set-cookie')||'').split(';')[0]};
}
const INVALID_CODE='رمز الدخول غير صحيح أو انتهت صلاحيته. اطلب رمزًا جديدًا.',NOT_READY='خدمة الدخول غير مهيأة. تواصل مع الإدارة.',BAD_EMAIL='اكتب بريد الشركة الصحيح المنتهي بـ @yourrest.org.';
const minute=()=>{clock+=61_000;};
const begin=async(email='rep@yourrest.org',options={})=>{minute();return call('request',{email},options);};
const verify=(request,code=mail.at(-1)?.code,options={})=>call('verify',{code},{cookie:request.cookie,...options});
const challengeOf=request=>sql.prepare('SELECT * FROM auth_challenges WHERE id=?').get(request.cookie.split('=')[1]);
const sessionOf=signed=>sql.prepare('SELECT * FROM auth_sessions WHERE token_hash=?').get(hmac('session:'+signed.cookie.split('=')[1]));
const events=name=>sql.prepare('SELECT COUNT(*) n FROM auth_events WHERE event=?').get(name).n;
const session=signed=>A.emailSession(new Headers({Cookie:signed.cookie}),db,config);

await counted('settings',async()=>{
 eq(E.authMode(),'email-otp','sign-in is by email code only');
 assert.throws(()=>E.authDatabase(),/Authentication database unavailable/);checks++;
 testEnv.DB=db;eq(E.authDatabase(),db,'the database of the platform');
 const empty=E.emailAuthConfig();
 eq([empty.origin,empty.secret,empty.deliveryReady],['','',false],'nothing set: no origin, no secret, no delivery');
 eq(empty.clientKey(new Request(origin)),null,'no client key without its reader');
 await assert.rejects(empty.send({to:'rep@yourrest.org',code:'000000',expiresInMinutes:10,signal:new AbortController().signal}),/Email delivery is not configured/);checks++;
 const delivered=[];let seenHeaders;
 Object.assign(testEnv,{YR_APP_ORIGIN:origin,YR_AUTH_SECRET:secret,YR_SEND_OTP:async message=>{delivered.push(message);},YR_AUTH_CLIENT_KEY:headers=>{seenHeaders=headers;return headers.get('x-test-client')??undefined;}});
 const set=E.emailAuthConfig(),request=new Request(origin,{headers:{'X-Test-Client':'device-7'}});
 eq([set.origin===origin,set.secret===secret,set.deliveryReady],[true,true,true],'read from the platform');
 eq([set.clientKey(request),seenHeaders===request.headers],['device-7',true],'the client key is read from the request\'s headers');
 eq(set.clientKey(new Request(origin)),null,'a reader that finds nothing gives none');
 const message={to:'rep@yourrest.org',code:'123456',expiresInMinutes:10,signal:new AbortController().signal};
 await set.send(message);eq(delivered,[message],'the message reaches the sender as it is');
 delete testEnv.YR_SEND_OTP;
 await assert.rejects(set.send(message),/Email delivery is not configured/);checks++;
 testEnv.YR_SEND_OTP=async item=>{delivered.push(item);};
 const answer=await A.handleEmailAuth(new Request(origin+'/api/auth/request',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Test-Client':'device-7'},body:JSON.stringify({email:'rep@yourrest.org'})}),'request',db,{...E.emailAuthConfig(),now:()=>clock,deliveryDeadlineMs:0});
 eq([answer.status,delivered.length,delivered.at(-1).to,/^\d{6}$/.test(delivered.at(-1).code)],[200,2,'rep@yourrest.org',true],'the settings as read sign a member in');
 for(const key of Object.keys(testEnv))if(key!=='DB')delete testEnv[key];
});

await counted('what a request must be',async()=>{
 const before=clientCount;
 for(const [name,override] of [['http',{origin:'http://crm.yourrest.org'}],['a slash',{origin:origin+'/'}],['capitals',{origin:'https://CRM.yourrest.org'}],['a default port',{origin:origin+':443'}],['no scheme',{origin:'crm.yourrest.org'}],['empty origin',{origin:''}],['63 hex',{secret:'a'.repeat(63)}],['not hex',{secret:'g'.repeat(64)}],['empty secret',{secret:''}]]){
  const answer=await call('request',{email:'rep@yourrest.org'},{override});
  eq([answer.status,answer.value.error],[503,NOT_READY],'not configured: '+name);
 }
 eq([(await call('logout',{},{override:{secret:'A'.repeat(64)}})).status,(await call('logout',{},{override:{secret:'ab'.repeat(64)}})).status],[200,200],'a hex secret in capitals, or longer, is a secret');
 eq(clientCount,before,'nothing counted for a service that is not configured');
 const get=await call('request',null,{method:'GET'});
 eq([get.status,get.headers.get('allow'),get.value.error],[405,'POST','الطلب غير مسموح.'],'only POST');
 eq((await call('request',{email:'rep@yourrest.org'},{method:'PUT'})).status,405,'not PUT');
 for(const [name,headers] of [['another site',{Origin:'https://evil.example'}],['no origin',{Origin:''}],['cross-site',{'Sec-Fetch-Site':'cross-site'}],['typed in the bar',{'Sec-Fetch-Site':'none'}],['http',{Origin:'http://crm.yourrest.org'}]])eq((await call('request',{email:'rep@yourrest.org'},{headers})).status,403,'refused: '+name);
 const same=(origin,site)=>A.sameOriginMutation(new Request(origin,{headers:{Origin:origin,...(site?{'Sec-Fetch-Site':site}:{})}}),'https://crm.yourrest.org');
 eq([same(origin),same(origin,'same-origin'),same(origin,'same-site'),same(origin,'cross-site'),same(origin,'none'),same('https://evil.example')],[true,true,true,false,false,false],'the same origin, and never a cross-site or typed request');
 eq((await call('delete',{})).status,404,'an unknown action');
 for(const [name,options] of [['text',{headers:{'Content-Type':'text/plain'}}],['no type',{headers:{'Content-Type':''}}],['an array',{raw:'[]'}],['null',{raw:'null'}],['a string',{raw:'"rep@yourrest.org"'}],['broken JSON',{raw:'{"email":'}],['not UTF-8',{raw:new Uint8Array([123,34,101,34,58,34,255,34,125])}],['over 2 KB',{raw:JSON.stringify({email:'rep@yourrest.org',pad:'x'.repeat(2048)})}]])
  eq((await call('request',null,options)).value,{error:'بيانات الطلب غير صحيحة.'},'not a request: '+name);
 const exact=JSON.stringify({email:'unknown@yourrest.org',pad:''});
 eq((await call('request',null,{raw:JSON.stringify({email:'unknown@yourrest.org',pad:'x'.repeat(2048-exact.length)})})).status,200,'2048 bytes exactly are read');
 eq((await call('request',{email:'unknown@yourrest.org'},{headers:{'Content-Type':'application/json; charset=utf-8'}})).status,200,'a charset is allowed');
 for(const answer of [await call('request',{email:'x'}),await call('delete',{}),await call('request',null,{method:'GET'}),await call('logout',{})])
  eq([answer.headers.get('cache-control'),answer.headers.get('x-content-type-options'),answer.headers.get('referrer-policy')],['private, no-store','nosniff','no-referrer'],'every answer is private and never stored: '+answer.status);
 eq([(await call('request',{email:'rep@yourrest.org'},{override:{deliveryReady:false}})).status,(await call('request',{email:'rep@yourrest.org'},{override:{clientKey:()=>null}})).status,(await call('request',{email:'rep@yourrest.org'},{override:{clientKey:()=>''}})).status,(await call('request',{email:'rep@yourrest.org'},{override:{clientKey:undefined}})).status],[503,503,503,503],'no delivery or no client key: not configured');
 eq(['/','//evil.example','https://evil.example',undefined].map(value=>A.safeAuthReturn(value)),['/','/','/','/'],'everyone lands on «/»');
});

await counted('asking for a code',async()=>{
 clock=NativeDate.parse('2026-11-22T07:00:00.000Z');mail=[];waited.length=0;
 const sentBefore=events('otp_sent'),rejectedBefore=events('otp_request_rejected'),failedBefore=events('otp_delivery_failed');
 const request=await begin('rep@yourrest.org');
 eq([request.status,request.value],[200,{ok:true,message:'إذا كان البريد مسجلًا ومفعّلًا، سيصلك رمز الدخول. يمكنك إعادة الطلب بعد دقيقة.'}],'the same words whatever happens');
 ok(/^__Host-yourrest_challenge=[a-f0-9]{64}$/.test(request.cookie)&&/; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=600$/.test(request.setCookie),'a challenge cookie for ten minutes, secure and not readable by scripts');
 const sent=mail.at(-1);
 eq([mail.length,sent.to,/^\d{6}$/.test(sent.code),sent.expiresInMinutes,sent.signal instanceof AbortSignal,sent.signal.aborted],[1,'rep@yourrest.org',true,10,true,false],'a six-digit code by mail, valid ten minutes');
 const stored=challengeOf(request),cid=request.cookie.split('=')[1];
 eq([stored.code_hash,stored.subject_hash,stored.user_id,stored.user_version,stored.email,stored.created_at,stored.expires_at,stored.ready,stored.attempts,stored.consumed],[hmac('code:'+cid+':'+sent.code),hmac('subject:rep@yourrest.org'),'rep',1,'rep@yourrest.org',clock,clock+600_000,1,0,0],'the code kept only as an HMAC bound to the challenge');
 ok(!JSON.stringify(sql.prepare('SELECT * FROM auth_challenges').all()).includes(sent.code),'the code itself is stored nowhere');
 eq(events('otp_sent')-sentBefore,1,'and recorded as sent');
 const unknown=await begin('nobody@yourrest.org'),inactive=await begin('off@yourrest.org');
 eq([mail.length,unknown.value,inactive.value,unknown.status,inactive.status],[1,request.value,request.value,200,200],'an unknown or inactive address: the same answer and no mail');
 ok([unknown,inactive].every(item=>/^__Host-yourrest_challenge=[a-f0-9]{64}$/.test(item.cookie)),'and the same cookie');
 eq([challengeOf(unknown).user_id,challengeOf(unknown).ready,events('otp_request_rejected')-rejectedBefore],[null,0,2],'a challenge that can never be verified');
 await begin('‏REP@YourRest.ORG‎ ');
 eq(mail.at(-1).to,'rep@yourrest.org','an address pasted from an Arabic message, in capitals: the same member');
 await begin('first.last+crm@yourrest.org');eq(mail.at(-1).to,'first.last+crm@yourrest.org','dots and a tag are an address');
 for(const email of ['rep@yourrest.org.evil.example','rep@mail.yourrest.org','rep@yourrest-org','rep@yourrest.org\r\nBcc: x@evil.example','مندوب@yourrest.org','rep one@yourrest.org','@yourrest.org','a'.repeat(242)+'@yourrest.org','',5,null,['rep@yourrest.org']])
  eq([(await call('request',{email})).value.error],[BAD_EMAIL],'refused: '+JSON.stringify(email)?.slice(0,50));
 eq((await call('request',{})).value.error,BAD_EMAIL,'no address');
 // Padding: every valid address waits for the same deadline.
 waited.length=0;
 await begin('rep@yourrest.org',{override:{deliveryDeadlineMs:250}});
 const throttled=await call('request',{email:'rep@yourrest.org'},{override:{deliveryDeadlineMs:250}});
 for(const email of ['nobody@yourrest.org','off@yourrest.org'])await begin(email,{override:{deliveryDeadlineMs:250}});
 eq(throttled.value,request.value,'(the second within the minute is throttled, with the same answer)');
 eq(waited.filter(delay=>delay===250).length,5,'a member (delivery bound and padding), an unknown, an inactive and a throttled address all wait the same 250 ms');
 waited.length=0;await begin('nobody@yourrest.org',{override:{deliveryDeadlineMs:undefined}});eq(waited,[5000],'five seconds by default');
 waited.length=0;await begin('nobody@yourrest.org',{override:{deliveryDeadlineMs:-5}});eq(waited,[],'a negative deadline is none');
 // A delivery that fails or hangs: the same answer, the challenge spent.
 clock=NativeDate.parse('2026-11-22T08:00:00.000Z');mail=[];deliver=async()=>{throw new Error('SMTP 550 secret-provider-detail');};
 const failed=await begin('rep@yourrest.org');
 eq([failed.status,failed.value,JSON.stringify(failed).includes('secret-provider-detail'),challengeOf(failed).consumed,events('otp_delivery_failed')-failedBefore],[200,request.value,false,1,1],'a delivery that fails: the same answer, nothing of the provider, the challenge spent');
 eq((await verify(failed,mail.at(-1).code)).status,400,'its code opens nothing');
 let signal;deliver=message=>{signal=message.signal;return new Promise(()=>{});};
 const hung=await begin('rep@yourrest.org',{override:{deliveryDeadlineMs:300}});
 eq([hung.status,signal.aborted,challengeOf(hung).consumed,events('otp_delivery_failed')-failedBefore],[200,true,1,2],'a delivery that hangs is cut at the deadline and aborted');
 deliver=async()=>{};
});

await counted('limits',async()=>{
 mail=[];
 const first=await begin('new@yourrest.org');
 const again=await call('request',{email:'new@yourrest.org'},{cookie:first.cookie});
 eq([mail.length,again.status,again.value,again.setCookie,events('otp_request_throttled')>=1],[1,200,first.value,'',true],'one mail a minute: the same answer, and the challenge already delivered is kept');
 const foreign=await call('request',{email:'new@yourrest.org'},{cookie:'__Host-yourrest_challenge='+'f'.repeat(64)});
 eq(foreign.setCookie,'__Host-yourrest_challenge=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0','a throttled request with a cookie of no challenge of this address clears it');
 eq((await call('request',{email:'new@yourrest.org'})).cookie,'__Host-yourrest_challenge=','and so does one without a cookie');
 eq((await verify(first)).status,200,'the code delivered first still works');
 clock=NativeDate.parse('2026-11-22T09:00:00.000Z');mail=[];
 for(let index=0;index<6;index++)await begin('first.last+crm@yourrest.org');
 eq(mail.length,5,'five mails an hour per address');
 clock=NativeDate.parse('2026-11-22T10:00:00.000Z');await call('request',{email:'first.last+crm@yourrest.org'});
 eq(mail.length,6,'the next hour, again');
 const fixed={clientKey:()=>'one-phone'};
 clock=NativeDate.parse('2026-11-22T11:00:00.000Z');
 const statuses=[];for(let index=0;index<11;index++)statuses.push((await call('request',{email:'x'},{override:fixed})).status);
 eq(statuses,[...Array(10).fill(400),429],'ten requests a minute per client, even invalid ones');
 const limited=await call('request',{email:'rep@yourrest.org'},{override:fixed});
 eq([limited.status,limited.value.error,limited.headers.get('retry-after')],[429,'محاولات كثيرة. حاول بعد دقيقة.',60+''],'then «try in a minute»');
 eq((await call('request',{email:'x'},{override:{clientKey:()=>'another-phone'}})).status,400,'another client is not limited');
 clock+=60_000;eq((await call('request',{email:'x'},{override:fixed})).status,400,'the next minute, again');
 const verifies=[];for(let index=0;index<31;index++)verifies.push((await call('verify',{code:'000000'},{override:fixed})).status);
 eq([verifies.filter(status=>status===400).length,verifies.at(-1)],[30,429],'thirty verifications a minute per client');
 clock=NativeDate.parse('2026-11-22T12:00:00.000Z');
 sql.prepare('INSERT INTO auth_limits (key,window_start,count) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,count=excluded.count').run('request:global',clock,1000);
 eq((await call('request',{email:'rep@yourrest.org'})).status,429,'a thousand requests a minute for everyone');
 eq((await call('verify',{code:'000000'})).status,400,'the verifications are counted apart');
 clock+=60_000;eq((await call('request',{email:'nobody@yourrest.org'})).status,200,'the next minute, again');
});

await counted('verifying',async()=>{
 clock=NativeDate.parse('2026-11-23T06:00:00.000Z');mail=[];const successBefore=events('login_success');
 let request=await begin('rep@yourrest.org');const code=mail.at(-1).code;
 for(const value of ['12345','1234567','12345a',' '+code,code+' ','‏'+code,Number(code),null,''])
  eq((await verify(request,value)).value.error,INVALID_CODE,'not six ASCII digits: '+JSON.stringify(value));
 eq(challengeOf(request).attempts,0,'and not counted as attempts');
 eq((await verify(request,code,{cookie:''})).status,400,'no challenge cookie');
 eq((await verify(request,code,{cookie:request.cookie.toUpperCase().replace('__HOST-YOURREST_CHALLENGE','__Host-yourrest_challenge')})).status,400,'a challenge id in capitals is not read');
 eq((await verify(request,code,{cookie:request.cookie+'; '+request.cookie})).status,400,'two challenge cookies are not read');
 const wrong=code==='111111'?'222222':'111111';
 for(let index=0;index<4;index++)eq((await verify(request,wrong)).status,400,'a wrong code '+(index+1));
 eq([challengeOf(request).attempts,events('login_failed')>=4],[4,true],'each counted');
 const signed=await verify(request,code);
 eq([signed.status,signed.value],[200,{ok:true,return_to:'/'}],'the fifth attempt with the right code signs in');
 ok(/^__Host-yourrest_session=[a-f0-9]{64}$/.test(signed.cookie)&&/; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=34560000$/.test(signed.setCookie),'a session cookie kept 400 days');
 const kept=sessionOf(signed);
 eq([kept.user_id,kept.user_version,kept.email,kept.challenge_id,kept.created_at,kept.expires_at,kept.revoked_at],['rep',1,'rep@yourrest.org',request.cookie.split('=')[1],clock,0,null],'the session, kept by an HMAC of its token, with no server deadline');
 ok(!JSON.stringify(sql.prepare('SELECT * FROM auth_sessions').all()).includes(signed.cookie.split('=')[1]),'the token itself is stored nowhere');
 eq([challengeOf(request).consumed,events('login_success')-successBefore],[1,1],'the challenge is spent');
 eq((await verify(request,code)).status,400,'the same code again opens nothing');
 eq(sql.prepare('SELECT COUNT(*) n FROM auth_sessions WHERE challenge_id=?').get(request.cookie.split('=')[1]).n,1,'one session for one code');
 request=await begin('rep@yourrest.org');const fifth=mail.at(-1).code,bad=fifth==='111111'?'222222':'111111';
 for(let index=0;index<5;index++)await verify(request,bad);
 eq([(await verify(request,fifth)).status,challengeOf(request).attempts],[400,5],'after five wrong codes the right one is refused');
 // Ten minutes: the last millisecond and not the next.
 clock=NativeDate.parse('2026-11-23T07:00:00.000Z');
 const inTime=await begin('rep@yourrest.org'),inTimeCode=mail.at(-1).code;
 const late=await begin('new@yourrest.org'),lateCode=mail.at(-1).code;
 clock+=600_000-61_001;eq((await verify(inTime,inTimeCode)).status,200,'one millisecond before the ten minutes');
 clock+=61_000+1;eq((await verify(late,lateCode)).status,400,'at ten minutes exactly it has expired');
 // A newer request replaces the challenge; a code is bound to its own challenge.
 clock=NativeDate.parse('2026-11-23T08:00:00.000Z');
 const older=await begin('rep@yourrest.org'),olderCode=mail.at(-1).code;
 const newer=await begin('rep@yourrest.org'),newerCode=mail.at(-1).code;
 eq([(await verify(older,olderCode)).status,(await verify(newer,olderCode)).status],[400,400],'the older code opens neither the older nor the newer challenge');
 const someone=await begin('new@yourrest.org'),someoneCode=mail.at(-1).code;
 eq((await verify(someone,newerCode)).status,400,'nor another person\'s challenge');
 eq([(await verify(newer,newerCode)).status,(await verify(someone,someoneCode)).status],[200,200],'each code opens its own');
 ok(challengeOf(newer).code_hash!==hmac('code:'+older.cookie.split('=')[1]+':'+newerCode),'a code\'s hash depends on its challenge');
 // The member changed between the request and the code.
 const deactivated=await begin('new@yourrest.org'),deactivatedCode=mail.at(-1).code;
 sql.exec("UPDATE crm_members SET active=0 WHERE id='new'");
 eq((await verify(deactivated,deactivatedCode)).status,400,'a member suspended meanwhile');
 sql.exec("UPDATE crm_members SET active=1 WHERE id='new'");
 const moved=await begin('new@yourrest.org'),movedCode=mail.at(-1).code;
 sql.exec("UPDATE crm_members SET region_scope='western' WHERE id='new'");
 eq((await verify(moved,movedCode)).status,400,'a member whose access changed meanwhile');
 const fresh=await begin('new@yourrest.org');
 eq((await verify(fresh)).status,200,'(a new code after the change works)');
});

await counted('session, refresh and sign-out',async()=>{
 clock=NativeDate.parse('2026-11-24T06:00:00.000Z');mail=[];
 const request=await begin('new@yourrest.org'),signed=await verify(request);
 const token=signed.cookie.split('=')[1],identity=await session(signed);
 eq(identity,{provider:'email-otp',memberId:'new',memberVersion:sql.prepare("SELECT auth_version FROM crm_members WHERE id='new'").get().auth_version,userId:'email-otp:new',email:'new@yourrest.org',displayName:'مندوب جديد',fullName:'مندوب جديد'},'the member, and an identity of its own when it has no platform id');
 eq((await A.emailSession(new Headers({Cookie:'theme=dark; __Host-yourrest_session='+token+'; lang=ar'}),db,config)).memberId,'new','other cookies are ignored');
 for(const [name,cookie] of [['none',''],['two',signed.cookie+'; '+signed.cookie],['capitals','__Host-yourrest_session='+token.toUpperCase()],['short','__Host-yourrest_session='+token.slice(1)],['another name','__Host-yourrest_session2='+token],['unknown','__Host-yourrest_session='+'e'.repeat(64)]])
  eq(await A.emailSession(new Headers({Cookie:cookie}),db,config),null,'no session: '+name);
 eq(await A.emailSession(new Headers({Cookie:signed.cookie}),db,{...config,secret:'short'}),null,'a configuration that is not valid opens no session');
 eq(await A.emailSession(new Headers({Cookie:signed.cookie,'oai-authenticated-user-id':'u-rep','oai-authenticated-user-email':'rep@yourrest.org'}),db,config).then(value=>value.memberId),'new','identity headers of a platform are never trusted');
 const set=expires=>sql.prepare('UPDATE auth_sessions SET expires_at=? WHERE token_hash=?').run(expires,hmac('session:'+token));
 set(clock+1);eq((await session(signed))?.memberId,'new','a legacy session before its end');
 const refreshed=await call('refresh',{},{cookie:signed.cookie,override:{clientKey:()=>null,deliveryReady:false,send:async()=>{throw new Error('no mail on refresh');}}});
 eq([refreshed.status,refreshed.cookie,/Max-Age=34560000$/.test(refreshed.setCookie),sessionOf(signed).expires_at],[200,signed.cookie,true,0],'a refresh renews the cookie and lifts the end, without a client key, delivery or mail');
 set(clock);eq(await session(signed),null,'a legacy session at its end is over');
 eq([(await call('refresh',{},{cookie:signed.cookie})).status,sessionOf(signed).expires_at],[401,clock],'and is not revived by a refresh');
 set(0);
 for(const [name,cookie] of [['none',''],['broken','__Host-yourrest_session=x'],['two',signed.cookie+'; '+signed.cookie]]){const answer=await call('refresh',{},{cookie});eq([answer.status,answer.value.error,/Max-Age=0$/.test(answer.setCookie)],[401,'انتهت جلسة الدخول. سجّل الدخول مجددًا.',true],'a refresh without a session clears the cookie: '+name);}
 sql.exec("UPDATE crm_members SET name='مندوب جديد (معدل)', target=900 WHERE id='new'");
 eq((await session(signed)).fullName,'مندوب جديد (معدل)','a change of name or target keeps the session');
 sql.exec("UPDATE crm_members SET email='new2@yourrest.org' WHERE id='new'");
 eq([await session(signed),(await call('refresh',{},{cookie:signed.cookie})).status],[null,401],'a change of email ends it');
 sql.exec("UPDATE crm_members SET email='new@yourrest.org' WHERE id='new'");
 eq(await session(signed),null,'and changing it back does not revive it');
 const second=await verify(await begin('new@yourrest.org')),logoutsBefore=events('logout');
 const logout=await call('logout',{},{cookie:second.cookie,override:{clientKey:()=>null}});
 eq([logout.status,logout.value,logout.setCookie,sessionOf(second).revoked_at,events('logout')-logoutsBefore],[200,{ok:true},'__Host-yourrest_session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0',clock,1],'the sign-out revokes the session, records it once and clears the cookie');
 eq([await session(second),(await call('refresh',{},{cookie:second.cookie})).status],[null,401],'nothing reopens it');
 eq([(await call('logout',{},{cookie:second.cookie})).status,events('logout')-logoutsBefore],[200,1],'a second sign-out is harmless and not recorded again');
 eq([(await call('logout',{})).status,(await call('logout',{},{cookie:'__Host-yourrest_session=zz'})).status],[200,200],'a sign-out without a session still clears the cookie');
 eq((await call('logout',{},{headers:{Origin:'https://evil.example'},cookie:signed.cookie})).status,403,'a sign-out from another site is refused');
});

await counted('failure and the code drawn',async()=>{
 const logged=[];const error=console.error;console.error=(...items)=>logged.push(items.join(' '));
 const broken={prepare:()=>{throw new Error('database is locked rep@yourrest.org '+secret);},batch:async()=>{throw new Error('x');}};
 try{
  for(const action of ['request','logout','refresh','verify']){
   const response=await A.handleEmailAuth(new Request(origin+'/api/auth/'+action,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:'__Host-yourrest_session='+'a'.repeat(64)+'; __Host-yourrest_challenge='+'b'.repeat(64)},body:JSON.stringify({email:'rep@yourrest.org',code:'123456'})}),action,broken,config);
   const value=await response.json();
   eq([response.status,value.error,/^[0-9a-f-]{36}$/.test(value.request_id)],[503,'تعذر إتمام الدخول. حاول مجددًا.',true],'an internal failure: «try again» with a reference: '+action);
   eq(JSON.parse(logged.at(-1)),{event:'auth_failure',request_id:value.request_id,action},'the log line names the reference and the action only');
  }
  ok(!logged.join('\n').includes(secret)&&!logged.join('\n').includes('rep@yourrest.org'),'no secret and no address in the log');
 }finally{console.error=error;}
 const draws=[4_294_000_000,4_294_967_295,7,4_293_999_999];const original=crypto.getRandomValues;
 Object.defineProperty(crypto,'getRandomValues',{configurable:true,writable:true,value:array=>{if(array instanceof Uint32Array&&array.length===1&&draws.length){array[0]=draws.shift();return array;}return original.call(crypto,array);}});
 try{
  mail=[];clock=NativeDate.parse('2026-11-25T06:00:00.000Z');
  await begin('rep@yourrest.org');
  eq([mail.at(-1).code,draws.length],['000007',1],'values of the last partial million are drawn again; the code keeps its leading zeros');
  await begin('rep@yourrest.org');
  eq(mail.at(-1).code,'999999','the largest value kept gives 999999');
 }finally{delete crypto.getRandomValues;}
 eq(crypto.getRandomValues===original,true,'(the random source restored)');
 eq(sql.prepare('PRAGMA foreign_key_check').all(),[],'no row points nowhere');
});

console.log(JSON.stringify({ok:true,checks,counts,realEmailSent:false,database:'SQLite in memory, every migration',platformIdentityTrusted:false,clock:'fixed'}));
