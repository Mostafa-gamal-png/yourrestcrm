// Full built release over real HTTP (Unix socket when supported), real SQLite and mocked sendmail.
// Only isolated temporary fixtures are written. No DNS, production state or actual mailbox is used.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {request as httpRequest} from 'node:http';
import {createServer as createNetServer} from 'node:net';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,readdir,writeFile,rename,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHmac,createHash,randomBytes,randomUUID} from 'node:crypto';
import {sqliteDatabase} from '../portable/storage.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),release=path.join(root,'dist/standalone'),origin='https://crm.yourrest.org';
const work=await mkdtemp(path.join(os.tmpdir(),'yourrest-http-')),data=path.join(work,'data'),socket=path.join(work,'app.sock'),capture=path.join(work,'mail.jsonl');
// Keep the real built process and its fixture clock inside Saudi work hours.
// The test-only preload also permits precise HTTP boundary checks without a
// production clock override or reliance on the time the suite is executed.
const RealDate=Date,clockStart=RealDate.now(),clockState=path.join(work,'clock.json'),clockPreload=path.join(work,'clock.mjs');
let clockBase=RealDate.UTC(2026,9,1,9); // Thursday12:00 Saudi; the next working day is Saturday.
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[clockBase+RealDate.now()-clockStart]));}static now(){return clockBase+RealDate.now()-clockStart;}};
await writeFile(clockState,JSON.stringify({base:clockBase,start:clockStart}));
await writeFile(clockPreload,`import {readFileSync} from 'node:fs';const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[Date.now()]));}static now(){const c=JSON.parse(readFileSync(${JSON.stringify(clockState)},'utf8'));return c.base+RealDate.now()-c.start;}};`);
async function setClock(at){clockBase=RealDate.parse(at)-(RealDate.now()-clockStart);await writeFile(clockState+'.next',JSON.stringify({base:clockBase,start:clockStart}));await rename(clockState+'.next',clockState);}
let processChild,db,log='',checks=0;
let unixSocket=true,socketUnavailable='',listenValue=socket,connection={socketPath:socket};
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
try{
 await stat(path.join(release,'server.js'));await mkdir(data,{mode:0o700});const objects=path.join(data,'objects');await mkdir(objects,{mode:0o700});
 // Some execution sandboxes forbid Unix listeners even though loopback TCP is allowed.
 // Detect that capability explicitly; do not misreport TCP coverage as a Unix-socket test.
 const probe=createNetServer();
 try{await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(path.join(work,'probe.sock'),resolve);});await new Promise(resolve=>probe.close(resolve));}
 catch(error){if(!['EPERM','EACCES'].includes(error.code))throw error;unixSocket=false;socketUnavailable=error.code;const tcp=createNetServer();tcp.listen(0,'127.0.0.1');await once(tcp,'listening');const port=tcp.address().port;await new Promise(resolve=>tcp.close(resolve));listenValue=String(port);connection={host:'127.0.0.1',port};}
 const filename=path.join(data,'database.sqlite');db=sqliteDatabase(filename,{create:true});
 await db.exec('CREATE TABLE yr_schema_migrations(name TEXT PRIMARY KEY NOT NULL,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)');
 for(const migration of (await readdir(path.join(root,'drizzle'))).filter(name=>/^\d+.*\.sql$/.test(name)).sort()){const source=await readFile(path.join(root,'drizzle',migration),'utf8');await db.exec(source);await db.prepare('INSERT INTO yr_schema_migrations VALUES(?,?,?)').bind(migration,createHash('sha256').update(source).digest('hex'),new Date().toISOString()).run();}
 const now=new Date().toISOString(),enrolledAt='2026-09-29T09:00:00.000Z'; // Members predate the queued September30 GPS evidence.
 for(const member of [{id:'owner',email:'ceo@yourrest.org',role:'admin'},{id:'rep-role',email:'rep.role@yourrest.org',role:'rep'},{id:'rep-disabled',email:'rep.disabled@yourrest.org',role:'rep'},{id:'supervisor-read',email:'supervisor.read@yourrest.org',role:'supervisor'}])await db.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,active,target,created_at,region_scope) VALUES(?,?,?,?,?,?,1,0,?,?)').bind(member.id,'opaque-'+member.id,member.email,'HTTP '+member.id,member.role,'Main',enrolledAt,member.id==='rep-disabled'?'western':'all').run();
 await db.prepare('INSERT INTO crm_settings(id,owner_id) VALUES(?,?)').bind('company','opaque-owner').run();
 const sendmail=path.join(work,'sendmail.cjs');
 await writeFile(sendmail,'#!'+process.execPath+'\n'+`const fs=require('node:fs');let message='';process.stdin.on('data',b=>message+=b);process.stdin.on('end',()=>fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify({to:process.argv.at(-1),message})+'\\n',{mode:0o600}));`,{mode:0o700});
 const secret=randomBytes(32).toString('hex');
 processChild=spawn(process.execPath,['--import',clockPreload,'app.cjs'],{cwd:release,env:{PATH:process.env.PATH,NODE_ENV:'production',PORT:listenValue,HOST:'127.0.0.1',YR_APP_ORIGIN:origin,YR_AUTH_SECRET:secret,YR_NATIONAL_ADDRESS_API_KEY:'',YR_DATABASE_PATH:filename,YR_OBJECTS_PATH:objects,YR_MAIL_TRANSPORT:'sendmail',YR_MAIL_FROM:'noreply@yourrest.org',YR_SENDMAIL_PATH:sendmail},stdio:['ignore','pipe','pipe']});
 processChild.stdout.on('data',b=>log+=b);processChild.stderr.on('data',b=>log+=b);
 async function request(url,options={}){
  let body=options.body,headers={Host:'crm.yourrest.org','X-Forwarded-Proto':'https',...options.headers};
  if(body!==undefined&&!Buffer.isBuffer(body)&&typeof body!=='string'){body=Buffer.from(JSON.stringify(body));headers['Content-Type']='application/json';}
  if(body!==undefined&&!options.chunked&&!('Content-Length' in headers))headers['Content-Length']=String(Buffer.byteLength(body));
  return new Promise((resolve,reject)=>{
   const req=httpRequest({...connection,path:url,method:options.method||'GET',headers,timeout:15000},res=>{const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>{const bytes=Buffer.concat(parts),text=bytes.toString('utf8');resolve({status:res.statusCode,headers:res.headers,bytes,text,json:()=>JSON.parse(text)});});});
   req.on('error',error=>reject(new Error(url+' '+(options.chunked?'chunked ':'')+'('+String(headers['Content-Encoding']||'identity')+', '+String(body?.length??0)+' bytes) '+error.message)));req.on('timeout',()=>req.destroy(Error('HTTP smoke request timed out')));if(body!==undefined){if(options.chunked){const bytes=Buffer.from(body);for(let offset=0;offset<bytes.length;offset+=16384)req.write(bytes.subarray(offset,offset+16384));}else req.write(body);}req.end();
  });
 }
 let ready=false;
 for(let attempt=0;attempt<100;attempt++){
  if(processChild.exitCode!==null)throw Error('Release exited before listening: '+log);
  try{await request('/login');ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}
 }
 assert(ready,'Standalone release did not listen: '+log);checks++;
 let result=await request('/');assert([302,303,307,308].includes(result.status),'Root must redirect anonymous users: '+result.status);assert.match(result.headers.location,/\/login/);checks++;
 result=await request('/login');check(result.status,200);assert.match(result.text,/yourrest|يورست/i);checks++;
 check(result.headers['x-frame-options'],'DENY','Built login forbids framing');
 check(result.headers['x-content-type-options'],'nosniff','Built login disables MIME sniffing');
 assert.match(result.headers['content-security-policy']||'',/(?:^|;)\s*frame-ancestors\s+'none'\s*(?:;|$)/,'Built login CSP forbids embedding');checks++;
 check(result.headers['referrer-policy'],'strict-origin-when-cross-origin','Built login bounds cross-origin referrer detail');
 assert.match(result.text,/href="\/manifest\.webmanifest"/,'Login document must advertise the install manifest');checks++;
 assert.match(result.text,/href="\/icons\/yourrest-company-apple\.png"/,'iPhone home screen icon must be advertised');checks++;
 assert(!/تثبيت التطبيق|تنزيل التطبيق/.test(result.text),'Install controls should appear after signing in');checks++;
 assert.match(result.text,/<script\b[^>]*src="\/install-bootstrap\.js"[^>]*>/,'Install prompt capture must be included before authenticated components mount');checks++;
 assert.match(result.text,/viewport-fit=cover/,'Mobile safe-area viewport must be exposed');checks++;
 assert.match(result.text,/interactive-widget=resizes-content/,'Supported mobile browsers must resize content around the keyboard');checks++;
 const scripts=[...result.text.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^\"]*)?)"/g)].map(match=>match[1]).filter(url=>url.startsWith('/'));
 assert(scripts.length>0,'Login has no local built assets');checks++;
 for(const url of [...new Set(scripts)].slice(0,3)){result=await request(url);check(result.status,200);assert(result.bytes.length>20);checks++;}
 // Browser installation metadata must be accessible before authentication,
 // while all application records still require the existing session checks.
 result=await request('/manifest.webmanifest');check(result.status,200,result.text);
 assert.match(result.headers['content-type']||'',/^application\/manifest\+json(?:;|$)/);checks++;
 const manifest=result.json(),publicInstallAssets=new Map([['/manifest.webmanifest',result.bytes]]);
 check(manifest.start_url,'/','Installed app must enter through the authenticated root');
 check(manifest.scope,'/','Manifest scope must cover only this application origin');
 check(manifest.display,'standalone');
 assert(typeof manifest.name==='string'&&manifest.name.trim()&&typeof manifest.short_name==='string'&&manifest.short_name.trim(),'Manifest needs full and short app names');checks++;
 for(const size of [192,512]){
  assert(manifest.icons?.some(icon=>icon.sizes===`${size}x${size}`&&icon.type==='image/png'&&(!icon.purpose||icon.purpose.split(/\s+/).includes('any'))),'Missing PNG install icon at '+size);checks++;
 }
 for(const icon of [...manifest.icons,{src:'/icons/yourrest-company-apple.png',sizes:'180x180'}]){
  assert(/^\/(?!\/)/.test(icon.src)&&/^\d+x\d+$/.test(icon.sizes),'Icon must use a same-origin URL and explicit pixel dimensions');checks++;
  const response=await request(icon.src);check(response.status,200);
  assert.match(response.headers['content-type']||'',/^image\/png(?:;|$)/);checks++;
  check(response.bytes.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]),'Install icon is not a real PNG');
  check(response.bytes.toString('ascii',12,16),'IHDR');
  check([response.bytes.readUInt32BE(16),response.bytes.readUInt32BE(20)],icon.sizes.split('x').map(Number),'Install icon pixel dimensions differ from manifest');
 }
 result=await request('/downloads/yourrest-crm-android.apk?v=8');check(result.status,200);
 check(result.bytes.subarray(0,4),Buffer.from([80,75,3,4]),'Android download must be a real APK ZIP');
 check(result.bytes,await readFile(path.join(root,'public/downloads/yourrest-crm-android.apk')),'Served APK must match signed public artifact');
 result=await request('/sw.js');check(result.status,200,result.text);
 assert.match(result.headers['content-type']||'',/^(?:text|application)\/javascript(?:;|$)/);checks++;
 // A worker served at the origin root has '/' scope by default. If the server
 // advertises an override, it must also allow the application's root scope.
 if(result.headers['service-worker-allowed']!==undefined)check(result.headers['service-worker-allowed'],'/');
 assert(!/^\s*(?:<!doctype|<html)/i.test(result.text),'Service worker route returned an HTML fallback');checks++;
 assert(result.bytes.length>100,'Service worker script is empty');checks++;
 publicInstallAssets.set('/sw.js',result.bytes);
 result=await request('/install-bootstrap.js');check(result.status,200,result.text);
 assert.match(result.headers['content-type']||'',/^(?:text|application)\/javascript(?:;|$)/);checks++;
 check(result.bytes,await readFile(path.join(root,'public/install-bootstrap.js')),'Built install bootstrap must match the tested source');
 publicInstallAssets.set('/install-bootstrap.js',result.bytes);
 result=await request('/offline.html');check(result.status,200,result.text);
 assert.match(result.headers['content-type']||'',/^text\/html(?:;|$)/);checks++;
 publicInstallAssets.set('/offline.html',result.bytes);
 result=await request('/api/crm',{headers:{'oai-authenticated-user-id':'opaque-owner','oai-authenticated-user-email':'ceo@yourrest.org','oai-authenticated-user-full-name':'Owner'}});check(result.status,401);
 result=await request('/api/customer-identities');check(result.status,401,'Customer reconciliation requires a real authenticated session');
 const addressPoint={latitude:26.437341,longitude:50.034499};
 result=await request('/api/customer-address',{method:'POST',headers:{Origin:origin},body:addressPoint});check(result.status,401,'Address lookup requires the real authenticated session');
 result=await request('/api/auth/request',{method:'POST',headers:{Origin:'https://evil.test'},body:{email:'ceo@yourrest.org'}});check(result.status,403);
 result=await request('/api/auth/request',{method:'POST',body:{email:'ceo@yourrest.org'}});check(result.status,403);
 result=await request('/api/crm',{headers:{Host:'evil.test','X-Forwarded-Host':'crm.yourrest.org'}});check(result.status,421);
 const cookies=(response,name)=>(response.headers['set-cookie']||[]).find(cookie=>cookie.startsWith(name+'='))?.split(';')[0]||'';
 async function login(email){
  const challenge=await request('/api/auth/request',{method:'POST',headers:{Origin:origin},body:{email}});check(challenge.status,200,challenge.text);
  const challengeCookie=cookies(challenge,'__Host-yourrest_challenge');assert(challengeCookie);assert((challenge.headers['set-cookie']||[]).some(cookie=>/Secure; HttpOnly; SameSite=Strict/.test(cookie)));checks++;
  const delivered=(await readFile(capture,'utf8')).trim().split('\n').map(line=>JSON.parse(line)).filter(message=>message.to===email).at(-1);assert(delivered,'Mock local sendmail did not accept OTP');checks++;
  const message=Buffer.from(delivered.message.split('\r\n\r\n')[1].replaceAll('\r\n',''),'base64').toString('utf8'),code=message.match(/\b\d{6}\b/)?.[0];assert(code);checks++;
  const verified=await request('/api/auth/verify',{method:'POST',headers:{Origin:origin,Cookie:challengeCookie},body:{code,return_to:'/'}});check(verified.status,200,verified.text);
  const session=cookies(verified,'__Host-yourrest_session');assert(session);assert((verified.headers['set-cookie']||[]).some(cookie=>cookie.startsWith('__Host-yourrest_session=')&&/Secure; HttpOnly; SameSite=Strict; Max-Age=34560000(?:;|$)/.test(cookie)));checks++;
  const stored=await db.prepare('SELECT expires_at FROM auth_sessions WHERE token_hash=?').bind(sessionHash(session)).first();check(stored?.expires_at,0,'New verified sessions must have no server expiry');
  assert(!log.includes(code),'OTP must not be logged');checks++;return session;
 }
 const sessionHash=session=>createHmac('sha256',Buffer.from(secret)).update('session:'+session.split('=')[1]).digest('hex');
 const refresh=session=>request('/api/auth/refresh',{method:'POST',headers:{Origin:origin,...(session?{Cookie:session}:{})},body:{}});
 function renewed(response,session){
  check(response.status,200,response.text);check(response.json(),{ok:true});check(cookies(response,'__Host-yourrest_session'),session);
  assert((response.headers['set-cookie']||[]).some(cookie=>cookie.startsWith('__Host-yourrest_session=')&&/Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=34560000(?:;|$)/.test(cookie)));checks++;
  check(response.headers['cache-control'],'private, no-store');
 }
 function rejectedRefresh(response){
  check(response.status,401,response.text);
  assert((response.headers['set-cookie']||[]).some(cookie=>cookie.startsWith('__Host-yourrest_session=;')&&/Max-Age=0(?:;|$)/.test(cookie)));checks++;
 }
 const owner=await login('ceo@yourrest.org');
 result=await request('/api/customer-identities',{headers:{Cookie:owner}});check(result.status,200,result.text);check(result.headers['cache-control'],'no-store','Administrative customer identities must not be cached');
 const initialIdentities=result.json();check(Object.keys(initialIdentities).sort(),['customers','identities','revision'],'Built administrative endpoint exposes only its reconciliation contract');
 check(Number.isSafeInteger(initialIdentities.revision)&&initialIdentities.revision>=0,true,'Customer identity revision is valid');check(initialIdentities.customers,[]);check(initialIdentities.identities,[]);
 // The fixture explicitly leaves the optional SPL key empty; this exercises the built route with no provider traffic.
 result=await request('/api/customer-address',{method:'POST',headers:{Cookie:owner,Origin:origin},body:addressPoint});check(result.status,200,result.text);check(result.json(),{status:'not_configured'});check(result.headers['cache-control'],'no-store');
 // Real HTTP chunked requests must be bounded before parsing, with no writes.
 const bodyHeaders={Cookie:owner,Origin:origin,'Content-Type':'application/json'};
 const beforeOversize=await db.prepare('SELECT COUNT(*) n FROM crm_records').first();
 for(const [endpoint,limit] of [['/api/crm',450000],['/api/mobile-route',120000],['/api/customers/import',1200000],['/api/machines/import',3000]]){
  result=await request(endpoint,{method:'POST',headers:bodyHeaders,body:Buffer.alloc(limit+1,32),chunked:true});check(result.status,413,result.text);
 }
 result=await request('/api/crm',{method:'POST',headers:{...bodyHeaders,'Content-Length':'450001'},body:'{}'});check(result.status,413,result.text);
 result=await request('/api/crm',{method:'POST',headers:{...bodyHeaders,'Content-Encoding':'gzip'},body:'{}',chunked:true});check(result.status,415,result.text);
 result=await request('/api/crm',{method:'POST',headers:bodyHeaders,body:'{broken',chunked:true});check(result.status,400,result.text);
 result=await request('/api/visit-files',{method:'POST',headers:{Cookie:owner,Origin:origin,'Content-Type':'multipart/form-data; boundary=fixture'},body:Buffer.alloc(11*1024*1024+1,32),chunked:true});check(result.status,413,result.text);
 check(await db.prepare('SELECT COUNT(*) n FROM crm_records').first(),beforeOversize,'Rejected oversized requests must not create CRM records');
 check((await db.prepare('SELECT COUNT(*) n FROM crm_visit_files').first()).n,0,'Rejected multipart must not store attachments');
 const mailBeforeRefresh=await readFile(capture,'utf8');
 renewed(await refresh(owner),owner);
 // Emulate pre-update sessions in the isolated DB. Still-valid 12-hour and
 // 30-day sessions can upgrade; old expired sessions must never be revived.
 async function legacySession(expiresAt,revokedAt=null){
  const session='__Host-yourrest_session='+randomBytes(32).toString('hex');
  await db.prepare('INSERT INTO auth_sessions(token_hash,user_id,user_version,email,challenge_id,created_at,expires_at,revoked_at) SELECT ?,user_id,user_version,email,?,created_at,?,? FROM auth_sessions WHERE token_hash=?').bind(sessionHash(session),randomUUID(),expiresAt,revokedAt,sessionHash(owner)).run();
  return session;
 }
 for(const duration of [12*60*60*1000,30*24*60*60*1000]){
  const legacy=await legacySession(Date.now()+duration);
  renewed(await refresh(legacy),legacy);
  check((await db.prepare('SELECT expires_at FROM auth_sessions WHERE token_hash=?').bind(sessionHash(legacy)).first())?.expires_at,0,'Valid legacy session should upgrade to a persistent session');
  result=await request('/api/crm',{headers:{Cookie:legacy}});check(result.status,200);
 }
 const expired=await legacySession(Date.now()-1000),revoked=await legacySession(0,Date.now());
 rejectedRefresh(await refresh(expired));rejectedRefresh(await refresh(revoked));rejectedRefresh(await refresh(''));
 check((await db.prepare('SELECT expires_at FROM auth_sessions WHERE token_hash=?').bind(sessionHash(expired)).first())?.expires_at>0,true,'Expired legacy session must retain its expiry');
 result=await request('/api/auth/refresh',{method:'POST',headers:{Cookie:owner,Origin:'https://evil.test'},body:{}});check(result.status,403);check(result.headers['set-cookie'],undefined);
 result=await request('/api/auth/refresh',{method:'POST',headers:{Cookie:owner},body:{}});check(result.status,403);
 result=await request('/api/auth/refresh',{headers:{Cookie:owner,Origin:origin}});check(result.status,405);
 check(await readFile(capture,'utf8'),mailBeforeRefresh,'Refresh must not request or deliver another OTP');
 result=await request('/api/crm',{headers:{Cookie:owner}});check(result.status,200,result.text);check(result.json().me.id,'owner');check(result.json().records,[]);
 result=await request('/',{headers:{Cookie:owner}});check(result.status,200);assert(!result.text.includes('opaque-owner'));checks++;
 const customerBody={action:'save',kind:'customer',createKey:randomUUID(),data:{name:'HTTP factory fixture',branch:'Main',assignedTo:'owner',region:'المنطقة الشرقية',city:'الدمام',location:'26.437341, 50.034499',...addressPoint,locationSource:'device',locationCapturedAt:new Date().toISOString(),locationAccuracy:12,shortAddress:' abcd 1234 ',customerType:'جملة',customerStatus:'نصف نشط',category:'بلوك'}};
 result=await request('/api/crm',{method:'POST',headers:{Cookie:owner},body:customerBody});check(result.status,403);
 result=await request('/api/crm',{method:'POST',headers:{Cookie:owner,Origin:'https://evil.test'},body:customerBody});check(result.status,403);
 result=await request('/api/crm',{method:'POST',headers:{Cookie:owner,Origin:origin},body:customerBody});check(result.status,200,result.text);const customerId=result.json().id;assert(customerId);checks++;
 result=await request('/api/crm',{method:'POST',headers:{Cookie:owner,Origin:origin},body:customerBody});check(result.status,200);check(result.json().alreadySaved,true);check(result.json().id,customerId);
 result=await request('/api/crm',{headers:{Cookie:owner}});check(result.json().records.length,1);check(result.json().records[0].data.name,'HTTP factory fixture');
 const ownerCustomer=result.json().records[0].data;check([ownerCustomer.shortAddress,ownerCustomer.latitude,ownerCustomer.longitude,ownerCustomer.locationSource,ownerCustomer.locationCapturedAt,ownerCustomer.locationAccuracy],['ABCD1234',addressPoint.latitude,addressPoint.longitude,'device',customerBody.data.locationCapturedAt,12],'Built customer write/read preserves normalized short address and its device capture');check([ownerCustomer.customerType,ownerCustomer.customerStatus,ownerCustomer.category],['جملة','نصف نشط','بلوك']);
 assert.match(ownerCustomer.internalCode||'',/^YR-C-\d{6,}$/,'Newly created factory receives a permanent internal code');checks++;
 result=await request('/api/customer-identities',{headers:{Cookie:owner}});check(result.status,200,result.text);check(result.headers['cache-control'],'no-store');
 const ownerIdentities=result.json();check(ownerIdentities.customers.length,1);check(ownerIdentities.identities,[],'A factory without an ERP code does not invent an external identity');
 const ownerIdentity=ownerIdentities.customers[0];check(Object.keys(ownerIdentity).sort(),['erpCode','id','internalCode','name','region','version']);
 check([ownerIdentity.id,ownerIdentity.name,ownerIdentity.internalCode,ownerIdentity.erpCode,ownerIdentity.region],[customerId,ownerCustomer.name,ownerCustomer.internalCode,'',ownerCustomer.region],'Administrative projection matches the saved factory');
 check(Number.isSafeInteger(ownerIdentity.version)&&ownerIdentity.version>0,true,'Reconciliation includes the current customer revision');
 // Actual built route, authenticated writes, and private daily report response.
 const journeyDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 result=await request('/api/journeys');check(result.status,401);
 result=await request('/api/journeys',{method:'POST',headers:{Cookie:owner,Origin:'https://evil.test'},body:{action:'select',customerId,createKey:randomUUID()}});check(result.status,403);
 result=await request('/api/journeys',{method:'POST',headers:{Cookie:owner,Origin:origin},body:{action:'select',customerId,createKey:randomUUID()}});check(result.status,200,result.text);const journeyId=result.json().stop.id;check(result.json().stop.memberId,'owner');
 result=await request('/api/journeys',{method:'POST',headers:{Cookie:owner,Origin:origin},body:{action:'samples',stopId:journeyId,points:[{id:randomUUID(),capturedAt:new Date().toISOString(),latitude:24.7136,longitude:46.6753,accuracy:10}]}});check(result.status,200,result.text);
 result=await request('/api/journeys?date='+journeyDay,{headers:{Cookie:owner}});check(result.status,200,result.text);check(result.headers['cache-control'],'no-store');check(result.json().stops.length,1);check(result.json().stops[0].points.length,1);
 result=await request('/api/journeys',{method:'POST',headers:{Cookie:owner,Origin:origin},body:{action:'end',stopId:journeyId}});check(result.status,200,result.text);check(result.json().stop.state,'interrupted');check(result.json().stop.data.departureAt,null);
 result=await request('/api/crm',{method:'POST',headers:{Cookie:owner,Origin:origin},body:{action:'delete',kind:'customer',id:customerId,version:1}});check(result.status,409,result.text);assert(result.json().error.includes('خط سير'));checks++;
 for(const [url,bytes] of publicInstallAssets){result=await request(url);check(result.status,200);check(result.bytes,bytes,'Public installation metadata must not include authenticated customer data');}
 result=await request('/api/crm');check(result.status,401,'Public install assets must not grant anonymous CRM access');
 const pdf=Buffer.from('%PDF-1.4\nYourrest HTTP isolated file fixture\n%%EOF\n'),form=new FormData();form.set('customerId',customerId);form.set('file',new Blob([pdf],{type:'application/pdf'}),'fixture.pdf');
 const encoded=new Request(origin+'/api/visit-files',{method:'POST',body:form});
 result=await request('/api/visit-files',{method:'POST',headers:{Cookie:owner,Origin:origin,'Content-Type':encoded.headers.get('content-type')},body:Buffer.from(await encoded.arrayBuffer())});check(result.status,200,result.text);const fileId=result.json().id;assert(fileId);checks++;
 // Real native day API uses the same authenticated session and exact-origin gate.
 result=await request('/api/mobile-route');check(result.status,401);
 const mobileDevice=randomUUID(),mobileBegin={action:'begin',createKey:randomUUID(),deviceId:mobileDevice};
 result=await request('/api/mobile-route',{method:'POST',headers:{Cookie:owner,Origin:'https://evil.test'},body:mobileBegin});check(result.status,403);
 result=await request('/api/mobile-route',{method:'POST',headers:{Cookie:owner,Origin:origin},body:mobileBegin});check(result.status,200,result.text);const mobileDay=result.json().day.id;check(result.json().memberId,'owner');
 result=await request('/api/mobile-route',{method:'POST',headers:{Cookie:owner,Origin:origin},body:{action:'samples',dayId:mobileDay,deviceId:mobileDevice,points:[{id:randomUUID(),capturedAt:new Date().toISOString(),latitude:24.7136,longitude:46.6753,accuracy:10,stopId:null}]}});check(result.status,200,result.text);check(result.json().acknowledgedIds.length,1);
 result=await request('/api/journeys?date='+journeyDay,{headers:{Cookie:owner}});check(result.status,200,result.text);check(result.json().mobileDays.length,1);check(result.json().mobileDays[0].points.length,1);check('deviceId' in result.json().mobileDays[0],false);
 result=await request('/api/mobile-route',{method:'POST',headers:{Cookie:owner,Origin:origin},body:{action:'end',dayId:mobileDay,deviceId:mobileDevice}});check(result.status,200,result.text);check(!!result.json().day.endedAt,true);
 result=await request('/api/visit-files?id='+encodeURIComponent(fileId),{headers:{Cookie:owner}});check(result.status,200);check(result.bytes,pdf);check(result.headers['content-type'],'application/pdf');check(result.headers['cache-control'],'private, no-store');
 result=await request('/api/visit-files?id='+encodeURIComponent(fileId));check(result.status,401);
 for(const url of ['/settings.cjs','/app.cjs','/database.sqlite','/data/database.sqlite','/.env','/operations/storage.mjs']){result=await request(url,{headers:{Cookie:owner}});assert([400,403,404].includes(result.status),url+' exposed with status '+result.status);assert(!result.text.includes(secret)&&!result.bytes.includes(Buffer.from('SQLite format 3')));checks++;}
 const roleSession=await login('rep.role@yourrest.org'),disabledSession=await login('rep.disabled@yourrest.org');
 result=await request('/api/customer-identities',{headers:{Cookie:roleSession}});check(result.status,403,'A real representative session cannot read administrative customer reconciliation');
 check('customers' in result.json()||'identities' in result.json(),false,'Denied identity response contains no customer directory');
 result=await request('/api/customer-address',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:addressPoint});check(result.status,200,result.text);check(result.json(),{status:'not_configured'});check(result.headers['cache-control'],'no-store');
 for(const session of [roleSession,disabledSession]){result=await request('/api/crm',{headers:{Cookie:session}});check(result.status,200);}
 result=await request('/api/crm',{headers:{Cookie:roleSession}});
 const regionalCustomer=result.json().records.find(row=>row.id===customerId);assert(regionalCustomer,'Authorized regional factory is visible');checks++;check(!!regionalCustomer.data._masterReadOnly,false,'Current policy permits regional customer corrections');
 result=await request('/api/targets?month='+journeyDay.slice(0,7),{headers:{Cookie:roleSession}});check(result.status,200,result.text);check(result.headers['cache-control'],'private, no-store');check(result.json().member.id,'rep-role');check(result.json().sales.products.every(row=>row.quantity===null),true);check(result.json().activity.isDefault,true);check(Object.keys(result.json()).sort(),['activity','member','month','sales']);
 result=await request('/api/targets?month='+journeyDay.slice(0,7)+'&scopeId=owner',{headers:{Cookie:roleSession}});check(result.status,400,'A representative cannot select another target owner');
 result=await request('/api/targets');check(result.status,401);
 for(const path of ['/api/sales','/api/sales?kpis=1']){result=await request(path,{headers:{Cookie:roleSession}});check(result.status,403,'Rep must not access '+path);}
 result=await request('/api/mobile-route',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:{action:'end',dayId:mobileDay,deviceId:mobileDevice}});check(result.status,404,'Native collector cannot end another member day');
 // Continuous rep collection starts without a customer and cannot be manually ended.
 const repDevice=randomUUID(),repBegin={action:'begin',deviceId:repDevice,createKey:randomUUID(),continuous:true};
 result=await request('/api/mobile-route',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:repBegin});check(result.status,200,result.text);const repDay=result.json().day;check(result.json().activeStop,null);check(repDay.memberId,'rep-role');
 result=await request('/api/mobile-route',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:{action:'end',dayId:repDay.id,deviceId:repDevice}});check(result.status,403,'Representative cannot manually stop continuous recording');
 result=await request('/api/mobile-route',{headers:{Cookie:roleSession}});check(result.status,200);check(result.json().day.id,repDay.id);check(result.json().day.endedAt,null);
 const offlineDate=new Date(Date.now()-21*60*60*1000).toISOString().slice(0,10),offlineStart=offlineDate+'T09:00:00.000Z',offlineBegin={action:'begin',deviceId:repDevice,createKey:randomUUID(),date:offlineDate,startedAt:offlineStart,regionScope:repDay.regionScope,continuous:true};
 result=await request('/api/mobile-route',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:offlineBegin});check(result.status,200,result.text);const offlineDay=result.json().day;check(offlineDay.date,offlineDate);check(!!offlineDay.endedAt,true);
 const offlinePoints=Array.from({length:11},(_,i)=>({id:randomUUID(),capturedAt:new Date(Date.parse(offlineStart)+i*30000).toISOString(),latitude:21.5,longitude:39.2,accuracy:10,stopId:null}));
 result=await request('/api/mobile-route',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:{action:'samples',dayId:offlineDay.id,deviceId:repDevice,points:offlinePoints}});check(result.status,200,result.text);check(result.json().acknowledgedIds.length,11);
 result=await request('/api/mobile-route',{headers:{Cookie:roleSession}});check(result.status,200);check(result.json().day.id,repDay.id,'Offline historical day cannot close current day');check(result.json().day.endedAt,null);
 result=await request('/api/journeys?date='+offlineDate+'&memberId=rep-role',{headers:{Cookie:owner}});check(result.status,200,result.text);check(result.json().mobileDays.length,1);check(result.json().mobileDays[0].automaticStops.length,1,'Scoped report derives GPS stop without inventing a client visit');check(result.json().mobileDays[0].points.length,11);
 result=await request('/api/journeys?date='+journeyDay,{headers:{Cookie:roleSession}});check(result.status,403,'Rep must not access team route reports');
 result=await request('/api/journeys',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:{action:'end',stopId:journeyId}});check(result.status,404,'A rep cannot mutate another recorder route');
 for(const path of ['/api/targets','/api/kpis']){result=await request(path,{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:{}});check(result.status,403,'Rep must not write '+path);}
 const repCustomerBody={action:'save',kind:'customer',createKey:randomUUID(),data:{name:'Rep-created factory',code:'HTTP-REP',region:'الغربية',location:'21.5, 39.2',latitude:21.5,longitude:39.2,locationSource:'device',locationCapturedAt:new Date().toISOString(),locationAccuracy:15,shortAddress:' efgh5678 ',customerType:'تجاري',customerStatus:'نشط',category:'خرسانة وبلوك',assignedTo:'owner',branch:'Forged branch',_createdBy:'owner',sourceFile:'forged import'}};
 result=await request('/api/crm',{method:'POST',headers:{Cookie:disabledSession,Origin:origin},body:{...repCustomerBody,createKey:randomUUID(),data:{...repCustomerBody.data,region:'الشرقية'}}});check(result.status,403,'New GPS/address fields cannot widen a western rep customer-creation region');
 result=await request('/api/crm',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:repCustomerBody});check(result.status,200,result.text);const repCustomerId=result.json().id;
 result=await request('/api/crm',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:repCustomerBody});check(result.status,200);check(result.json().id,repCustomerId);check(result.json().alreadySaved,true);
 result=await request('/api/crm',{headers:{Cookie:roleSession}});let repCustomer=result.json().records.find(row=>row.id===repCustomerId);assert(repCustomer);checks++;check(repCustomer.assignedTo,'rep-role');check(repCustomer.branch,'Main');check(repCustomer.data._createdBy,'rep-role');check(repCustomer.data.sourceFile,undefined);check(!!repCustomer.data._masterReadOnly,false);check([repCustomer.data.latitude,repCustomer.data.longitude],[21.5,39.2]);
 check([repCustomer.data.shortAddress,repCustomer.data.locationSource,repCustomer.data.locationCapturedAt,repCustomer.data.locationAccuracy],['EFGH5678','device',repCustomerBody.data.locationCapturedAt,15]);check([repCustomer.data.customerType,repCustomer.data.customerStatus,repCustomer.data.category],['تجاري','نشط','خرسانة وبلوك']);
 assert.match(repCustomer.data.internalCode||'',/^YR-C-\d{6,}$/,'Rep-created factory receives its server-assigned internal code');checks++;
 check(repCustomer.data.internalCode!==ownerCustomer.internalCode,true,'Distinct factories receive distinct permanent internal codes');
 // Customer corrections are allowed; deleting saved customers remains forbidden.
 const priorCustomerVersion=repCustomer.version;
 result=await request('/api/crm',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:{action:'save',kind:'customer',id:repCustomerId,version:repCustomer.version,data:{...repCustomer.data,name:'Rep-corrected factory'}}});check(result.status,200,result.text);
 result=await request('/api/crm',{headers:{Cookie:roleSession}});check(result.status,200,result.text);repCustomer=result.json().records.find(row=>row.id===repCustomerId);assert(repCustomer);checks++;check(repCustomer.data.name,'Rep-corrected factory');check(repCustomer.version,priorCustomerVersion+1,'Later visits use the fresh customer revision');
 result=await request('/api/crm',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:{action:'delete',kind:'customer',id:repCustomerId,version:repCustomer.version}});check(result.status,403,'Rep correction rights must not permit deletion');
 result=await request('/api/crm',{method:'POST',headers:{Cookie:disabledSession,Origin:origin},body:{action:'save',kind:'customer',id:repCustomerId,version:repCustomer.version,data:{...repCustomer.data,region:'الشرقية'}}});check(result.status,403,'Customer correction cannot move a record outside the western rep region');
 result=await request('/api/crm',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:{action:'save',kind:'quote',createKey:randomUUID(),parentId:customerId,data:{name:'Forbidden rep quote'}}});check(result.status,403,'Rep must not create quotes');
 // The built transport must save a real device-GPS contact independently of
 // an old destination, then execute its scheduled follow-up exactly once.
 result=await request('/api/journeys',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:{action:'select',customerId:repCustomerId,createKey:randomUUID()}});check(result.status,200,result.text);const repStopId=result.json().active.id;
 const contact={createKey:randomUUID(),customerId:repCustomerId,customerVersion:repCustomer.version,timingMode:'automatic',elapsedMilliseconds:5000,data:{type:'visit',date:journeyDay,summary:'تعريف بمنتجات الشركة',result:'تم تحديد احتياج العميل',salesStage:'new',strength:'strong',requestedProducts:['قوالب البلوك المتحركة'],nextAction:'متابعة المواصفات',nextDate:journeyDay,location:'21.5, 39.2',locationSource:'device',locationCapturedAt:new Date().toISOString(),locationAccuracy:10}};
 result=await request('/api/visits',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:{...contact,createKey:randomUUID(),data:{...contact.data,journeyStopId:journeyId}}});check(result.status,403,'A form must not borrow another recorder destination');
 result=await request('/api/visits',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:contact});check(result.status,200,result.text);const contactId=result.json().id;
 result=await request('/api/visits',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:contact});check(result.status,200,result.text);check(result.json().alreadySaved,true);check(result.json().id,contactId);
 result=await request('/api/crm',{headers:{Cookie:roleSession}});check(result.status,200,result.text);const contactRecords=result.json().records,savedContact=contactRecords.find(row=>row.id===contactId),contactCustomer=contactRecords.find(row=>row.id===repCustomerId);assert(savedContact&&contactCustomer);checks++;
 check(savedContact.data.performedBy,'rep-role');check(savedContact.data.recordedByEmail,'rep.role@yourrest.org');check(savedContact.data.timingSource,'form');check(savedContact.data.journeyStopId,undefined,'A saved old stop cannot silently replace this form timer');check(savedContact.data.durationSeconds,5);check(savedContact.data.locationSource,'device');check([savedContact.data.latitude,savedContact.data.longitude],[21.5,39.2]);
 check((await db.prepare('SELECT COUNT(*) n FROM crm_journey_links WHERE activity_id=?').bind(contactId).first()).n,0);
 const executeFollowup={createKey:randomUUID(),customerId:repCustomerId,customerVersion:contactCustomer.version,sourceId:contactId,sourceVersion:savedContact.version,data:{type:'call',date:journeyDay,result:'تم تنفيذ المتابعة وتحديد المواصفات',salesStage:'specs',invoiceOutcome:'pending',nextAction:'مراجعة العرض مع العميل',nextDate:journeyDay}};
 result=await request('/api/customer-followups',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:executeFollowup});check(result.status,200,result.text);const followupId=result.json().id;
 result=await request('/api/customer-followups',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:executeFollowup});check(result.status,200,result.text);check(result.json().alreadySaved,true);check(result.json().id,followupId);
 result=await request('/api/crm',{headers:{Cookie:roleSession}});check(result.status,200,result.text);const savedFollowup=result.json().records.find(row=>row.id===followupId);assert(savedFollowup);checks++;check(savedFollowup.data.sourceId,contactId);check(savedFollowup.data.performedBy,'rep-role');check(savedFollowup.data.nextAction,'مراجعة العرض مع العميل');
 check((await db.prepare('SELECT COUNT(*) n FROM crm_records WHERE id IN (?,?)').bind(contactId,followupId).first()).n,2,'Lost-response retries must not duplicate contacts');
 result=await request('/api/journeys',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:{action:'end',stopId:repStopId,reason:'contact_type_changed'}});check(result.status,200,result.text);
 // Actual built HTTP: capture-time policy, late eligible upload, safe ignored
 // acknowledgements, privacy before filtering, and next morning resumption.
 await setClock(journeyDay+'T15:00:00.000Z');
 const inWindowId=randomUUID(),offHoursId=randomUUID(),windowPoints=[
  {id:inWindowId,capturedAt:journeyDay+'T14:59:59.999Z',latitude:26.43,longitude:50.03,accuracy:10,stopId:null},
  {id:offHoursId,capturedAt:journeyDay+'T15:00:00.000Z',latitude:26.43,longitude:50.03,accuracy:10,stopId:null}
 ];
 const windowBatch={action:'samples',dayId:repDay.id,deviceId:repDevice,points:windowPoints};
 result=await request('/api/mobile-route',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:windowBatch});check(result.status,200,result.text);
 check(result.json().trackingWindow.open,false);check(result.json().acknowledgedIds,[inWindowId,offHoursId]);check(result.json().ignoredIds,[offHoursId]);check(result.json().day.endedAt,journeyDay+'T15:00:00.000Z');
 check((await db.prepare('SELECT COUNT(*) n FROM crm_mobile_route_points WHERE point_id=?').bind(inWindowId).first()).n,1,'Eligible queued sample persists after18');
 check((await db.prepare('SELECT COUNT(*) n FROM crm_mobile_route_points WHERE point_id=?').bind(offHoursId).first()).n,0,'Exact18 sample is acknowledged without persistence');
 result=await request('/api/mobile-route',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:windowBatch});check(result.status,200);check(result.json().ignoredIds,[offHoursId]);
 check((await db.prepare('SELECT COUNT(*) n FROM crm_mobile_route_points WHERE point_id=?').bind(inWindowId).first()).n,1,'Boundary replay does not duplicate eligible sample');
 result=await request('/api/mobile-route',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:{...windowBatch,dayId:mobileDay,deviceId:mobileDevice,points:[windowPoints[1]]}});check(result.status,404,'Offhours filtering must not bypass foreign-day privacy');
 result=await request('/api/journeys',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:{action:'select',customerId:repCustomerId,createKey:randomUUID()}});check(result.status,200,result.text);check(result.json().stop,null,'Customer selection after18 creates no route');
 // Friday is a full scheduled pause over the actual built HTTP transport.
 const beforeFridayDays=(await db.prepare('SELECT COUNT(*) n FROM crm_mobile_route_days').first()).n,beforeFridayStops=(await db.prepare('SELECT COUNT(*) n FROM crm_journey_stops').first()).n;
 await setClock('2026-10-02T03:00:00.000Z');
 for(const captured of [undefined,{date:'2026-10-02',startedAt:'2026-10-02T03:00:00.000Z',regionScope:'all'}]){
  result=await request('/api/mobile-route',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:{action:'begin',deviceId:repDevice,createKey:randomUUID(),continuous:true,...captured}});check(result.status,200,result.text);check(result.json().day,null);check(result.json().trackingWindow.open,false);check(result.json().trackingWindow.nextStartsAt,'2026-10-03T03:00:00.000Z');check(result.json().trackingWindow.workingDays,[0,1,2,3,4,6]);
 }
 result=await request('/api/journeys',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:{action:'select',customerId:repCustomerId,createKey:randomUUID()}});check(result.status,200,result.text);check(result.json().stop,null);
 check((await db.prepare('SELECT COUNT(*) n FROM crm_mobile_route_days').first()).n,beforeFridayDays);check((await db.prepare('SELECT COUNT(*) n FROM crm_journey_stops').first()).n,beforeFridayStops);
 let followingDay=new RealDate(RealDate.parse(journeyDay+'T00:00:00.000Z')+86400000).toISOString().slice(0,10);if(new RealDate(followingDay+'T00:00:00.000Z').getUTCDay()===5)followingDay=new RealDate(RealDate.parse(followingDay+'T00:00:00.000Z')+86400000).toISOString().slice(0,10);
 await setClock(followingDay+'T02:59:00.000Z');
 const morningKey=randomUUID();
 result=await request('/api/mobile-route',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:{action:'begin',deviceId:repDevice,createKey:morningKey,continuous:true}});check(result.status,200,result.text);check(result.json().day,null);check(result.json().trackingWindow.open,false);
 await setClock(followingDay+'T03:00:00.000Z');
 result=await request('/api/mobile-route',{method:'POST',headers:{Cookie:roleSession,Origin:origin},body:{action:'begin',deviceId:repDevice,createKey:morningKey,continuous:true}});check(result.status,200,result.text);check(result.json().trackingWindow.open,true);check(result.json().day.date,followingDay);check(result.json().day.expiresAt,followingDay+'T15:00:00.000Z');
 for(const edit of [{id:'rep-role',email:'rep.role@yourrest.org',role:'supervisor',active:1},{id:'rep-disabled',email:'rep.disabled@yourrest.org',role:'rep',active:0}]){const current=await request('/api/crm',{headers:{Cookie:owner}});check(current.status,200);const memberSnapshot=current.json().members.find(member=>member.id===edit.id)?.editToken;check(typeof memberSnapshot,'string','Admin receives the current member edit snapshot');result=await request('/api/crm',{method:'POST',headers:{Cookie:owner,Origin:origin},body:{action:'member',memberSnapshot,data:{...edit,name:'HTTP '+edit.id,branch:'Main',supervisorId:'',regionScope:'all',target:0}}});check(result.status,200,result.text);}
 for(const session of [roleSession,disabledSession]){result=await request('/api/crm',{headers:{Cookie:session}});check(result.status,401);rejectedRefresh(await refresh(session));}
 const supervisorSession=await login('supervisor.read@yourrest.org');
 result=await request('/api/sales?kpis=1',{headers:{Cookie:supervisorSession}});check(result.status,200,'Supervisor can read sales, targets and evaluation');
 assert(result.json().targets&&result.json().kpis,'Supervisor response must include target and evaluation data');checks++;
 result=await request('/api/auth/logout',{method:'POST',headers:{Cookie:owner,Origin:'https://evil.test'},body:{}});check(result.status,403);
 result=await request('/api/crm',{headers:{Cookie:owner}});check(result.status,200);
 result=await request('/api/auth/logout',{method:'POST',headers:{Cookie:owner,Origin:origin},body:{}});check(result.status,200);
 result=await request('/api/crm',{headers:{Cookie:owner}});check(result.status,401);
 const mailAfterLogin=await readFile(capture,'utf8');rejectedRefresh(await refresh(owner));check(await readFile(capture,'utf8'),mailAfterLogin,'Logged-out session refresh must not send an OTP');
 assert(!log.includes(secret),'Auth secret must not be logged');checks++;
 console.log(JSON.stringify({ok:true,checks,literal_unix_socket:unixSocket,...(socketUnavailable?{unix_socket_environment_block:socketUnavailable,transport:'loopback TCP'}:{}),actual_built_release:true,production_data_used:false,actual_email_sent:false,real_hosting_tested:false}));
}catch(error){console.error('Standalone HTTP smoke failed:',error.message);if(log)console.error('Server diagnostics:',log.replace(/[a-f0-9]{64}/gi,'[redacted]'));process.exitCode=1;}
finally{if(processChild&&processChild.exitCode===null){processChild.kill();await once(processChild,'exit');}db?.close();await rm(work,{recursive:true,force:true});}
