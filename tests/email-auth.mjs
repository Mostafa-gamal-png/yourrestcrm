// Real SQLite, actual migration/auth logic; isolated temporary state, mocked delivery only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),work=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-auth-'));
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON;');
class Statement{
 constructor(query,args=[]){this.query=query;this.args=args;}
 bind(...args){return new Statement(this.query,args);}
 execute(){const s=sql.prepare(this.query);if(s.columns().length){const results=s.all(...this.args);return {success:true,results,meta:{changes:Number(sql.prepare('SELECT changes() n').get().n)}};}const result=s.run(...this.args);return {success:true,results:[],meta:{changes:Number(result.changes)}};}
 async first(column){const row=sql.prepare(this.query).get(...this.args);return row?(column===undefined?row:row[column]??null):null;}
 async all(){return this.execute();}async run(){return this.execute();}
}
const db={prepare:query=>new Statement(query),async batch(statements){sql.exec('BEGIN IMMEDIATE');try{const r=statements.map(s=>s.execute());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
let checks=0;
const check=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
try{
 for(const name of ['request-body','member-email','email-auth']){
  const compiled=ts.transpileModule(fs.readFileSync(path.join(root,'lib',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace("from './request-body'","from './request-body.mjs'").replace("from './member-email'","from './member-email.mjs'");
  fs.writeFileSync(path.join(work,name+'.mjs'),compiled);
 }
 const {handleEmailAuth,emailSession,safeAuthReturn}=await import(pathToFileURL(path.join(work,'email-auth.mjs')));
 const migrations=fs.readdirSync(path.join(root,'drizzle')).filter(f=>/^\d+.*\.sql$/.test(f)).sort();
 for(const migration of migrations.filter(f=>f<'0009'))sql.exec(fs.readFileSync(path.join(root,'drizzle',migration),'utf8'));
 sql.exec(`INSERT INTO crm_members (id,user_id,email,name,role,branch,supervisor_id,active,target,created_at,region_scope) VALUES
 ('owner','existing-platform-owner','ceo@yourrest.org','Owner','admin','Main',NULL,1,0,'2026-09-01','all'),
 ('rep','existing-platform-rep','rep@yourrest.org','Representative','rep','Main',NULL,1,0,'2026-09-01','eastern'),
 ('new',NULL,'new@yourrest.org','New Representative','rep','Main',NULL,1,0,'2026-09-01','eastern'),
 ('inactive',NULL,'inactive@yourrest.org','Inactive','rep','Main',NULL,0,0,'2026-09-01','eastern');
 INSERT INTO crm_settings (id,owner_id) VALUES ('company','existing-platform-owner');`);
 const before=sql.prepare('SELECT * FROM crm_members').all().map(row=>({...row}));
 sql.exec(fs.readFileSync(path.join(root,'drizzle/0009_email_auth.sql'),'utf8'));
 check(sql.prepare('SELECT * FROM crm_members').all().map(({auth_version,...row})=>row),before);
 let now=Date.parse('2026-09-30T08:00:00Z'),client='client-1',mode='success',mail=[];
 const config={origin:'https://crm.yourrest.org',secret:'a'.repeat(64),now:()=>now,clientKey:()=>client,deliveryDeadlineMs:0,send:async m=>{mail.push(m);if(mode==='failure')throw Error('SENSITIVE provider failure');if(mode==='timeout')await new Promise(()=>{});}};
 const advance=()=>{now+=61_000;};
 async function call(action,body,cookie='',status=200,extra={},override={}){
  const response=await handleEmailAuth(new Request(config.origin+'/api/auth/'+action,{method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json',Cookie:cookie,...extra},body:JSON.stringify(body)}),action,db,{...config,...override});
  const value=await response.json();if(Array.isArray(status))assert(status.includes(response.status),JSON.stringify(value));else assert.equal(response.status,status,JSON.stringify(value));assert.match(response.headers.get('cache-control'),/no-store/);checks++;
  return {value,status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0]||'',headers:response.headers};
 }
 const begin=async(email='rep@yourrest.org')=>{advance();return call('request',{email});};
 const verify=(request,status=200,opts={})=>call('verify',{code:mail.at(-1).code,return_to:'/',...opts},request.cookie,status);
 const session=signed=>emailSession(new Headers({Cookie:signed.cookie}),db,config);
 const tokenHash=signed=>createHmac('sha256',config.secret).update('session:'+signed.cookie.split('=')[1]).digest('hex');
 const storedSession=signed=>sql.prepare('SELECT * FROM auth_sessions WHERE token_hash=?').get(tokenHash(signed));
 const setExpiry=(signed,expiry)=>sql.prepare('UPDATE auth_sessions SET expires_at=? WHERE token_hash=?').run(expiry,tokenHash(signed));
 await call('request',{email:'rep@yourrest.org'},'',403,{Origin:'https://other.test'});
 await call('request',{email:'rep@yourrest.org'},'',403,{Origin:''});
 await call('request',{email:'rep@yourrest.org'},'',403,{'Sec-Fetch-Site':'cross-site'});
 await call('request',{email:'rep@yourrest.org'},'',503,{}, {secret:'short'});
 await call('request',{email:'rep@yourrest.org'},'',503,{}, {origin:'http://crm.yourrest.org'});
 await call('request',{email:'rep@yourrest.org'},'',503,{}, {origin:'https://crm.yourrest.org/'});
 await call('request',{email:'rep@yourrest.org'},'',503,{}, {deliveryReady:false});
 await call('request',{email:'rep@yourrest.org'},'',503,{}, {clientKey:()=>null});
 await call('request',{email:'invalid'},'',400);
 await call('request',{email:'rep@outside.org'},'',400);
 await call('request',{email:'rep@yourrest.org.evil.test'},'',400);
 await call('request',{email:'rep@yourrest.org\r\nX: bad'},'',400);
 const anonymous=await begin('unknown@yourrest.org');check(mail.length,0);
 const inactive=await begin('inactive@yourrest.org');check(mail.length,0);check(anonymous.value,inactive.value);
 let request=await begin('REP@YOURREST.ORG');check(mail.length,1);check(request.value,anonymous.value);
 assert.match(request.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Strict/);checks++;
 const retry=await call('request',{email:'rep@yourrest.org'},request.cookie);check(retry.cookie,'');check(mail.length,1);
 await call('request',{email:'ceo@yourrest.org'});
 const switched=await call('request',{email:'ceo@yourrest.org'},request.cookie);check(switched.cookie,'__Host-yourrest_challenge=');
 const repCode=mail.find(m=>m.to==='rep@yourrest.org').code;
 let signed=await verify(request,200,{code:repCode,return_to:'https://evil.test'});check(signed.value.return_to,'/');assert.match(signed.headers.get('set-cookie'),/Max-Age=34560000/);checks++;
 check(storedSession(signed).expires_at,0);
 check(await session(signed),{provider:'email-otp',memberId:'rep',memberVersion:1,userId:'existing-platform-rep',email:'rep@yourrest.org',displayName:'Representative',fullName:'Representative'});
 check(await emailSession(new Headers({'oai-authenticated-user-id':'existing-platform-owner','oai-authenticated-user-email':'ceo@yourrest.org'}),db,config),null);
 check((await emailSession(new Headers({Cookie:signed.cookie,'oai-authenticated-user-id':'existing-platform-owner','oai-authenticated-user-email':'ceo@yourrest.org'}),db,config)).memberId,'rep');
 check(await emailSession(new Headers({Cookie:signed.cookie+'; '+signed.cookie}),db,config),null);
 const refreshMailCount=mail.length,refreshEvents=sql.prepare('SELECT COUNT(*) n FROM auth_events').get().n;
 const renewed=await call('refresh',{},signed.cookie,200,{}, {clientKey:()=>null,deliveryReady:false,send:async()=>{throw Error('Refresh must not request email');}});
 check(renewed.value,{ok:true});check(renewed.cookie,signed.cookie);
 assert.match(renewed.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Strict; Max-Age=34560000/);checks++;
 check(mail.length,refreshMailCount);check(sql.prepare('SELECT COUNT(*) n FROM auth_events').get().n,refreshEvents);
 await call('refresh',{},signed.cookie,403,{Origin:'https://other.test'});
 await call('refresh',{},signed.cookie,403,{Origin:''});
 await call('refresh',{},signed.cookie,403,{'Sec-Fetch-Site':'cross-site'});
 await call('refresh',{},'',401);
 await call('refresh',{},'__Host-yourrest_session=invalid',401);
 await call('refresh',{},signed.cookie+'; '+signed.cookie,401);
 await verify(request,400,{code:repCode});
 await call('logout',{},signed.cookie,403,{Origin:'https://other.test'});assert(await session(signed));checks++;
 await call('logout',{},signed.cookie);check(await session(signed),null);
 await call('refresh',{},signed.cookie,401);check(await session(signed),null);check(storedSession(signed).revoked_at,now);
 request=await begin();
 const duplicate=await Promise.all([verify(request,[200,400]),verify(request,[200,400])]);check(duplicate.map(r=>r.status).sort(),[200,400]);
 check(sql.prepare('SELECT COUNT(*) n FROM auth_sessions WHERE challenge_id=?').get(request.cookie.split('=')[1]).n,1);
 request=await begin();const oldCode=mail.at(-1).code;const newer=await begin();
 await verify(request,400,{code:oldCode});const remembered=await verify(newer,200,{remember:true});assert.match(remembered.headers.get('set-cookie'),/Max-Age=34560000/);checks++;
 sql.exec("UPDATE crm_members SET active=0 WHERE id='rep'");check(await session(remembered),null);
 await call('refresh',{},remembered.cookie,401);
 sql.exec("UPDATE crm_members SET active=1 WHERE id='rep'");check(await session(remembered),null);
 await call('refresh',{},remembered.cookie,401);
 // Triggers revoke both delivered codes and existing sessions on every access-affecting change.
 const edits=[['role',"'supervisor'","'rep'"],['branch',"'Other'","'Main'"],['supervisor_id',"'owner'",'NULL'],['region_scope',"'central'","'eastern'"],['email',"'changed@yourrest.org'","'rep@yourrest.org'"],['user_id',"'changed-identity'","'existing-platform-rep'"]];
 for(const [column,changed,restored]of edits){
  now+=3_600_000;request=await begin();signed=await verify(request);const version=(await session(signed)).memberVersion;
  const pending=await begin();sql.exec(`UPDATE crm_members SET ${column}=${changed} WHERE id='rep'`);
  check(sql.prepare("SELECT auth_version FROM crm_members WHERE id='rep'").get().auth_version,version+1);check(await session(signed),null);await verify(pending,400);await call('refresh',{},signed.cookie,401);
  sql.exec(`UPDATE crm_members SET ${column}=${restored} WHERE id='rep'`);check(await session(signed),null);
  await call('refresh',{},signed.cookie,401);
 }
 now+=3_600_000;request=await begin();signed=await verify(request);
 sql.exec("UPDATE crm_members SET target=2000,name='Updated Name' WHERE id='rep'");check((await session(signed)).fullName,'Updated Name');
 sql.exec("UPDATE crm_members SET role=role,region_scope=region_scope WHERE id='rep'");assert(await session(signed));checks++;
 now+=3_600_000;request=await begin();
 const wrong=mail.at(-1).code==='000000'?'999999':'000000';
 await Promise.all(Array.from({length:5},()=>verify(request,400,{code:wrong})));
 await verify(request,400);check(sql.prepare('SELECT attempts FROM auth_challenges WHERE id=?').get(request.cookie.split('=')[1]).attempts,5);
 request=await begin();now+=601_000;await verify(request,400);
 // New verified sessions have no server deadline, including the old 12-hour and
 // 30-day boundaries and beyond a browser's renewable cookie retention window.
 request=await begin();signed=await verify(request,200,{remember:false});now+=12*3_600_000+1;check((await session(signed)).memberId,'rep');
 now+=31*24*3_600_000;check((await session(signed)).memberId,'rep');
 now+=401*24*3_600_000;check((await session(signed)).memberId,'rep');
 const futureMailCount=mail.length;await call('refresh',{},signed.cookie);check(mail.length,futureMailCount);check(storedSession(signed).expires_at,0);
 // Existing signed-in devices upgrade without OTP, preserving their token and
 // creation time. Already expired legacy sessions cannot be restored.
 for(const duration of [12*3_600_000,30*24*3_600_000]){
  request=await begin();const legacy=await verify(request);const createdAt=storedSession(legacy).created_at;
  setExpiry(legacy,now+duration);check((await session(legacy)).memberId,'rep');
  const upgradeMailCount=mail.length,upgraded=await call('refresh',{},legacy.cookie);
  check(upgraded.cookie,legacy.cookie);check(storedSession(legacy).expires_at,0);check(storedSession(legacy).created_at,createdAt);check(mail.length,upgradeMailCount);
  now+=duration+1;check((await session(legacy)).memberId,'rep');
  request=await begin();const expired=await verify(request);setExpiry(expired,now);
  check(await session(expired),null);await call('refresh',{},expired.cookie,401);check(storedSession(expired).expires_at,now);check(await session(expired),null);
 }
 // A refresh racing a logout never makes the revoked token usable, regardless
 // of response order (the browser might receive the refreshed cookie last).
 request=await begin();signed=await verify(request);setExpiry(signed,now+3_600_000);
 const concurrent=await Promise.all([call('refresh',{},signed.cookie,[200,401]),call('logout',{},signed.cookie)]);
 check(concurrent[1].value,{ok:true});check(await session(signed),null);await call('refresh',{},signed.cookie,401);
 // An email pasted from an Arabic chat brings direction marks and zero-width characters: it reaches the same member.
request=await begin('\u200fNew@yourrest.org\u200c\u200e');check(mail.at(-1).to,'new@yourrest.org');
request=await begin('new@yourrest.org');signed=await verify(request);check((await session(signed)).userId,'email-otp:new');check(sql.prepare("SELECT user_id FROM crm_members WHERE id='new'").get().user_id,null);
 request=await begin('ceo@yourrest.org');signed=await verify(request);check((await session(signed)).userId,'existing-platform-owner');check(sql.prepare("SELECT owner_id FROM crm_settings WHERE id='company'").get().owner_id,'existing-platform-owner');
 mode='failure';request=await begin();await verify(request,400);mode='success';assert(sql.prepare("SELECT COUNT(*) n FROM auth_events WHERE event='otp_delivery_failed'").get().n>0);checks++;
 mode='timeout';advance();const timed=await call('request',{email:'rep@yourrest.org'},'',200,{}, {deliveryDeadlineMs:5});mode='success';await verify(timed,400);
 request=await begin();sql.exec("CREATE TRIGGER auth_audit_failure BEFORE INSERT ON auth_events WHEN NEW.event='login_success' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 await verify(request,503);check(sql.prepare('SELECT consumed FROM auth_challenges WHERE id=?').get(request.cookie.split('=')[1]).consumed,0);
 sql.exec('DROP TRIGGER auth_audit_failure');await verify(request);
 advance();client='abusive-client';for(let i=0;i<10;i++)await call('request',{email:'invalid'},'',400);await call('request',{email:'invalid'},'',429);
 client='other-client';await call('request',{email:'ceo@yourrest.org'});
 const sentCount=mail.length;for(let i=0;i<6;i++)await begin('ceo@yourrest.org');assert(mail.length-sentCount<=4);checks++;
 for(const value of ['//evil.test','/\\evil.test','https://evil.test','/api/auth/logout','/login','/signin-with-chatgpt','/mobile',null,'/'])check(safeAuthReturn(value),'/');
 for(const raw of ['{','[]','null','"bad"','x'.repeat(2050)]){const r=await handleEmailAuth(new Request(config.origin+'/api/auth/request',{method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json'},body:raw}),'request',db,config);check(r.status,400);}
 const get=await handleEmailAuth(new Request(config.origin+'/api/auth/request'),'request',db,config);check(get.status,405);
 const stored=JSON.stringify(sql.prepare('SELECT * FROM auth_challenges').all())+JSON.stringify(sql.prepare('SELECT * FROM auth_sessions').all());assert(!stored.includes(signed.cookie.split('=')[1]));checks++;
 check(sql.prepare('PRAGMA foreign_key_check').all(),[]);check(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 console.log(JSON.stringify({ok:true,checks,migrations:migrations.length,real_email_sent:false,storage:'isolated SQLite',identity_headers_ignored:true}));
}finally{sql.close();fs.rmSync(work,{recursive:true,force:true});}
