// Offline recording: actual built UI, Service Worker, durable IndexedDB and HTTP endpoints.
// Isolated SQLite fixtures with local mock mail and device location only.
// Authentication mail and device location are mocked locally. No production data,
// real email, real GPS, Namecheap deployment or physical mobile device is used.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer as createHttpsServer} from 'node:https';
import {request as httpRequest} from 'node:http';
import {createServer as createNetServer} from 'node:net';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,readdir,writeFile,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash,randomBytes} from 'node:crypto';
import {sqliteDatabase,privateObjects} from '../portable/storage.mjs';

import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const release=path.join(root,'dist/standalone');
const work=await mkdtemp(path.join(os.tmpdir(),'yourrest-offline-browser-')),data=path.join(work,'data'),capture=path.join(work,'mail.jsonl');
const screenshots=process.env.YR_OFFLINE_SCREENSHOT_DIR?path.resolve(process.env.YR_OFFLINE_SCREENSHOT_DIR):path.join(work,'screenshots');
const contentShell=process.env.YR_BROWSER_CONTENT_SHELL==='1',shells=[];
let child,db,browser,proxy,lastPage,log='',checks=0;
const errors=[],saved=[],geometry=[],writes=[];let dropNextVisitResponse=false,droppedResponses=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(actual,message)=>{assert.ok(actual,message);checks++;};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){const server=createNetServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
try{
 await stat(path.join(release,'server.js'));await mkdir(data,{mode:0o700});await mkdir(screenshots,{recursive:true});
 const filename=path.join(data,'database.sqlite'),objects=path.join(data,'objects');await mkdir(objects,{mode:0o700});db=sqliteDatabase(filename,{create:true});
 await db.exec('CREATE TABLE yr_schema_migrations(name TEXT PRIMARY KEY NOT NULL,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)');
 for(const migration of (await readdir(path.join(root,'drizzle'))).filter(name=>/^\d+.*\.sql$/.test(name)).sort()){
  const source=await readFile(path.join(root,'drizzle',migration),'utf8');await db.exec(source);
  await db.prepare('INSERT INTO yr_schema_migrations VALUES(?,?,?)').bind(migration,createHash('sha256').update(source).digest('hex'),new Date().toISOString()).run();
 }
 const created=new Date().toISOString(),product='قوالب البلوك المتحركة';
 const members=[
  {id:'owner',name:'QA admin',role:'admin',supervisor:null,region:'all'},
  {id:'manager',name:'QA manager',role:'manager',supervisor:null,region:'western'},
  {id:'supervisor',name:'QA supervisor',role:'supervisor',supervisor:'manager',region:'western'},
  {id:'rep1',name:'QA rep one',role:'rep',supervisor:'supervisor',region:'western'},
  {id:'rep2',name:'QA rep two',role:'rep',supervisor:'supervisor',region:'western'},
  {id:'outsider',name:'QA outside team',role:'rep',supervisor:null,region:'western'},
  {id:'eastrep',name:'QA other region',role:'rep',supervisor:'supervisor',region:'eastern'}
 ];
 // A representative uses the system only from the Android app (mandatory route tracking); the app is emulated for their pages.
 const nativeReps=Object.fromEntries(members.filter(member=>member.role==='rep').map(member=>[member.id,member.region||'all']));
 for(const m of members)await db.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,active,target,created_at,region_scope) VALUES(?,?,?,?,?,?,?,1,0,?,?)').bind(m.id,'opaque-'+m.id,m.id+'@yourrest.org',m.name,m.role,'Main',m.supervisor,created,m.region).run();
 await db.prepare('INSERT INTO crm_settings(id,owner_id) VALUES(?,?)').bind('company','opaque-owner').run();
 async function record(id,kind,parent,assigned,payload,at){await db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id,kind,parent,assigned,'Main',JSON.stringify(payload),at||created,at||created).run();}
 for(const [id,assigned,name,region,city,code] of [
  ['west1','rep1','مصنع الاختبار الأول','الغربية','جدة','W101'],
  ['west2','rep2','مصنع الاختبار الثاني','الغربية','مكة','W102'],
  ['west3','rep1','مصنع متابعة قائمة','الغربية','جدة','W104'],
  ['westoutside','outsider','مصنع خارج الفريق','الغربية','الطائف','W103'],
  ['east','eastrep','مصنع المنطقة الشرقية','الشرقية','الدمام','E101']
 ])await record(id,'customer',null,assigned,{name,region,city,code,customerType:'مصنع',location:'21.5, 39.2',phone:'0500000000'});
 async function contact(id,customer,author,name,day,extra={}){
  const timestamp='2026-09-'+String(day).padStart(2,'0')+'T07:00:00.000Z';
  await record(id,'activity',customer,customer==='west2'?'rep2':customer==='westoutside'?'outsider':customer==='east'?'eastrep':'rep1',{
   visitWorkflow:'customer-v1',type:'call',date:timestamp.slice(0,10),summary:'تعريف بمنتجات الشركة',result:'متابعة العميل',nextAction:'متابعة عرض المنافس',nextDate:'2026-10-10',salesStage:'new',strength:'medium',requestedProducts:[product],hasCompetitor:true,competitorName:name,competitorNotes:'ملاحظة اختبار '+id,performedBy:author,responsibleId:author,recordedByEmail:author+'@yourrest.org',location:'21.5, 39.2',latitude:21.5,longitude:39.2,locationSource:'device',locationCapturedAt:timestamp,locationAccuracy:5,startedAt:timestamp,endedAt:timestamp,...extra
  },timestamp);
 }
 await contact('obs-followup','west3','rep1','منافس المتابعة',19);
 await contact('obs-one','west1','rep1','ألـفا للصناعة',20,{competitorFileId:'quote-one',competitorFileName:'عرض-اختبار.pdf'});
 await contact('obs-two','west2','rep2','الفا للصناعة',21);
 await contact('obs-super','west1','supervisor','منافس المشرف',22);
 await contact('obs-manager','west1','manager','منافس المدير',23);
 await contact('obs-outside','westoutside','outsider','منافس خارج الفريق',24);
 await contact('obs-east','east','eastrep','منافس خارج المنطقة',25);
 await contact('obs-admin','west1','owner','منافس الإدارة',26);
 await contact('obs-hidden','west1','rep1','اسم غير مفعل',27,{hasCompetitor:false});
 await contact('obs-peer-private','west2','rep2','منافس الزميل الخاص',28,{competitorFileId:'quote-peer',competitorFileName:'عرض-الزميل.pdf'});
 await contact('obs-east-private','east','eastrep','منافس شرقي خاص',28,{competitorFileId:'quote-east',competitorFileName:'عرض-شرقي.pdf'});
 const quoteBytes=new TextEncoder().encode('%PDF-1.4\n% Synthetic browser fixture only\n%%EOF');
 await privateObjects(objects).put('competitor/quote-one',quoteBytes);
 await db.prepare('INSERT INTO crm_visit_files VALUES(?,?,?,?,?,?,?,?)').bind('quote-one','competitor/quote-one','west1','عرض-اختبار.pdf','application/pdf',quoteBytes.length,'rep1',created).run();
 for(const [id,customer,author,name] of [['quote-peer','west2','rep2','عرض-الزميل.pdf'],['quote-east','east','eastrep','عرض-شرقي.pdf']]){await privateObjects(objects).put('competitor/'+id,quoteBytes);await db.prepare('INSERT INTO crm_visit_files VALUES(?,?,?,?,?,?,?,?)').bind(id,'competitor/'+id,customer,name,'application/pdf',quoteBytes.length,author,created).run();}
 const sendmail=path.join(work,'sendmail.cjs');await writeFile(sendmail,'#!'+process.execPath+'\n'+`const fs=require('node:fs');let message='';process.stdin.on('data',b=>message+=b);process.stdin.on('end',()=>fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify({to:process.argv.at(-1),message})+'\\n',{mode:0o600}));`,{mode:0o700});
 const backend=await freePort(),tlsPort=await freePort(),origin='https://127.0.0.1:'+tlsPort,key=path.join(work,'key.pem'),cert=path.join(work,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
 child=spawn(process.execPath,['app.cjs'],{cwd:release,env:{PATH:process.env.PATH,NODE_ENV:'production',PORT:String(backend),HOST:'127.0.0.1',YR_APP_ORIGIN:origin,YR_AUTH_SECRET:randomBytes(32).toString('hex'),YR_DATABASE_PATH:filename,YR_OBJECTS_PATH:objects,YR_MAIL_TRANSPORT:'sendmail',YR_MAIL_FROM:'qa@127.0.0.1',YR_SENDMAIL_PATH:sendmail},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 proxy=createHttpsServer({key:await readFile(key),cert:await readFile(cert)},(incoming,outgoing)=>{
  if(incoming.method==='POST')writes.push({path:incoming.url,at:Date.now()});
  const drop=incoming.url==='/api/visits'&&incoming.method==='POST'&&dropNextVisitResponse;if(drop)dropNextVisitResponse=false;
  const forwarded=httpRequest({host:'127.0.0.1',port:backend,path:incoming.url,method:incoming.method,headers:{...incoming.headers,host:'127.0.0.1:'+tlsPort,'x-forwarded-proto':'https'}},response=>{
   if(drop&&response.statusCode===200){response.resume();response.on('end',()=>{droppedResponses++;outgoing.destroy();});return;}
   outgoing.writeHead(response.statusCode,response.headers);response.pipe(outgoing);
  });
  forwarded.on('error',()=>{if(!outgoing.headersSent)outgoing.writeHead(502);outgoing.end('Isolated backend is starting');});incoming.pipe(forwarded);
 });proxy.listen(tlsPort,'127.0.0.1');await once(proxy,'listening');
 let ready=false;for(let attempt=0;attempt<100;attempt++){if(child.exitCode!==null)throw Error('Release exited: '+log);try{const status=await new Promise((resolve,reject)=>{const request=httpRequest({host:'127.0.0.1',port:backend,path:'/login',headers:{host:'127.0.0.1:'+tlsPort,'x-forwarded-proto':'https'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end();});if(status===200){ready=true;break;}}catch{}await delay(100);}ok(ready,'Actual built app starts');
 browser={close:async()=>{for(const shell of shells){try{await shell.browser.close();}catch{}shell.child?.kill();}}};
 async function context(){
  let ctx;
  if(contentShell){
   const port=await freePort(),shellChild=spawn(process.env.YR_BROWSER_EXECUTABLE,['--no-sandbox','--single-process','--no-zygote','--in-process-gpu','--headless','--ozone-platform=headless','--disable-gpu','--use-gl=disabled','--ignore-certificate-errors','--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port,'about:blank'],{stdio:['ignore','ignore','pipe']});
   let diagnostics='',shellReady=false;shellChild.stderr.on('data',b=>diagnostics=(diagnostics+b).slice(-5000));
   for(let n=0;n<100;n++){if(shellChild.exitCode!==null)throw Error('Chromium content shell exited: '+diagnostics);try{const status=await new Promise((resolve,reject)=>{const request=httpRequest({host:'127.0.0.1',port,path:'/json/version'},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end();});if(status===200){shellReady=true;break;}}catch{}await delay(100);}
   if(!shellReady){shellChild.kill();throw Error('Chromium debugging endpoint did not start: '+diagnostics);}
   const connected=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:10000});shells.push({browser:connected,child:shellChild});ctx=connected.contexts()[0];
  }else {
   // This constrained Chromium runs single-process; use separate processes for
   // distinct device contexts so cookie/worker isolation is realistic.
   const isolated=await chromium.launch({headless:true,executablePath:process.env.YR_BROWSER_EXECUTABLE||'/tmp/yourrest-offline-chromium',args:['--no-sandbox','--no-zygote','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--no-proxy-server','--ignore-certificate-errors']});
   shells.push({browser:isolated});ctx=await isolated.newContext({ignoreHTTPSErrors:true,viewport:{width:360,height:800},deviceScaleFactor:1,reducedMotion:'reduce',serviceWorkers:'allow'});
  }
  await ctx.addInitScript(()=>{
   let watch=0;const point=()=>({coords:{latitude:21.5,longitude:39.2,accuracy:5,altitude:null,altitudeAccuracy:null,heading:null,speed:null},timestamp:Date.now()});
   Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition:success=>queueMicrotask(()=>success(point())),watchPosition:success=>{queueMicrotask(()=>success(point()));return ++watch;},clearWatch:()=>{}},configurable:true});
  });
  await ctx.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  for(const target of ctx.pages()){target.on('pageerror',error=>errors.push(error.message));await target.setViewportSize({width:360,height:800});}
  ctx.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  return ctx;
 }
 async function firstPage(ctx){return contentShell?ctx.pages()[0]:await ctx.newPage();}
 const signinRequestedAt=new Map();
 async function signin(target,user){lastPage=target;target.setDefaultTimeout(18000);if(nativeReps[user])await installNativeBridge(target,{memberId:user,regionScope:nativeReps[user]});await target.goto(origin+'/');await target.locator('#yourrest-email').waitFor();await target.locator('#yourrest-email').fill(user);
  const cooldown=(signinRequestedAt.get(user)||0)-Date.now();if(cooldown>0)await delay(cooldown);signinRequestedAt.set(user,Date.now()+61000);
  const pending=target.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/request'&&r.request().method()==='POST');await target.getByRole('button',{name:/^(إرسال رمز الدخول|Send sign-in code)$/}).click();eq((await pending).status(),200,'OTP request '+user);await target.locator('#yourrest-code').waitFor();
  const delivered=(await readFile(capture,'utf8')).trim().split('\n').map(JSON.parse).filter(row=>row.to===user+'@yourrest.org').at(-1);ok(delivered,'Mock email '+user);const mail=Buffer.from(delivered.message.split('\r\n\r\n')[1].replaceAll('\r\n',''),'base64').toString('utf8'),code=mail.match(/\b\d{6}\b/)?.[0];ok(code,'Mock OTP '+user);await target.locator('#yourrest-code').fill(code);await target.getByRole('button',{name:/^(دخول|Sign in)$/}).click();await target.locator('.workspace').waitFor();await target.locator('.mobile-bottom-navigation').waitFor();
 }
 async function nav(target,id){lastPage=target;await target.evaluate(()=>document.activeElement instanceof HTMLElement&&document.activeElement.blur());const button=target.locator('.mobile-bottom-navigation [data-page='+id+']');if(await button.count())await button.click();else{await target.getByRole('button',{name:/^(المزيد من الصفحات|More pages)$/,exact:true}).click();await target.locator('.mobile-overflow-pages [data-page='+id+']').click();}await target.locator('.mobile-navigation-sheet').waitFor({state:'detached'});await target.locator('.page-heading').waitFor();}
 async function snapshot(target,label){
  await target.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await Promise.all([...document.querySelectorAll('[role=dialog],.competitors-workspace')].flatMap(el=>el.getAnimations({subtree:true})).map(animation=>animation.finished.catch(()=>{})));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  const layout=await target.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},clientWidth:document.documentElement.clientWidth,clientLeft:document.documentElement.clientLeft,overflow:document.documentElement.scrollWidth>innerWidth+1,language:document.documentElement.lang,tabs:[...document.querySelectorAll('.competitors-profile-tabs [role=tab]')].filter(el=>el.getClientRects().length).map(el=>({text:el.textContent,rect:el.getBoundingClientRect().toJSON(),container:el.parentElement.getBoundingClientRect().toJSON()})),panels:[...document.querySelectorAll('.competitors-workspace,.competitors-list,.competitors-detail,.customer-visit-dialog,.followup-record-dialog,.competitor-fields,.offline-status')].filter(el=>el.getClientRects().length).map(el=>({name:el.className,rect:el.getBoundingClientRect().toJSON()}))}));
  eq(layout.overflow,false,label+' no horizontal overflow');for(const panel of layout.panels)ok(panel.rect.left>=-1&&panel.rect.right<=layout.viewport.width+1,label+' '+panel.name+' stays horizontally in viewport');for(const tab of layout.tabs)ok(tab.rect.left>=tab.container.left-1&&tab.rect.right<=tab.container.right+1,label+' tab '+tab.text+' fits profile tab row');geometry.push({label,...layout});const filename=path.join(screenshots,label+'.png');await target.screenshot({path:filename,fullPage:false});saved.push(filename);
 }
 async function pick(target,name,option){await target.getByRole('combobox',{name,exact:true}).click();await (target.page?target.page():target).getByRole('option',{name:option,exact:true}).click();await (target.page?target.page():target).getByRole('option').first().waitFor({state:'hidden'});}



 async function idbStore(target,name){return target.evaluate(name=>new Promise((resolve,reject)=>{const opened=indexedDB.open('yourrest-offline-v1');opened.onerror=()=>reject(opened.error);opened.onsuccess=()=>{const database=opened.result;if(!database.objectStoreNames.contains(name)){database.close();resolve([]);return;}const transaction=database.transaction(name,'readonly'),read=transaction.objectStore(name).getAll();read.onerror=()=>reject(read.error);read.onsuccess=()=>{const values=read.result;database.close();resolve(values);};};}),name);}
 async function eventually(check,message,timeout=25000){const started=Date.now();let value;while(Date.now()-started<timeout){value=await check();if(value){checks++;return value;}await delay(150);}throw Error(message+' (timed out)');}
 async function freshVisit(target,customerName='مصنع الاختبار الأول'){
  await nav(target,'activity');await target.getByRole('button',{name:'زيارة جديدة',exact:true}).first().click();const dialog=target.locator('.customer-visit-dialog');await dialog.waitFor();await pick(dialog,'نوع التواصل','اتصال');
  if(customerName){await dialog.locator('#visit-customer-search').fill(customerName);await target.getByRole('option').filter({hasText:customerName}).waitFor();await dialog.locator('#visit-customer-search').press('Enter');}
  return dialog;
 }
 async function completeVisit(target,dialog,note,{quote=false,competitor='منافس اختبار عدم الاتصال'}={}){
  await pick(dialog,'اختر الهدف من الزيارة','تعريف بمنتجات الشركة');await pick(dialog,'نتيجة الزيارة','متابعة العميل');await dialog.getByRole('textbox',{name:/^الإجراء القادم/}).fill('متابعة '+note);
  await dialog.locator('.visit-sales-details>summary').click();const fields=dialog.locator('.competitor-fields');await fields.getByRole('switch',{name:'يوجد منافس',exact:true}).click();await fields.getByRole('combobox',{name:/^اسم المنافس/}).fill(competitor);await fields.getByRole('combobox',{name:/^اسم المنافس/}).press('Tab');await fields.locator('textarea').fill(note);
  if(quote){await fields.locator('.competitor-file-input input').setInputFiles({name:'offline-competitor.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n% Synthetic offline competitor evidence\n%%EOF')});await fields.locator('.competitor-file-current').waitFor();}
  await dialog.locator('.location-status').filter({hasText:'تم تحديد الموقع تلقائيًا'}).waitFor();return fields;
 }
 async function rows(){const result=await db.prepare("SELECT id,parent_id,assigned_to,data,created_at FROM crm_records WHERE kind='activity'").all();return (result.results||result).map(row=>({...row,data:JSON.parse(row.data)}));}
 const ctx=await context(),page=await firstPage(ctx);await signin(page,'owner');await nav(page,'activity');
 const before=await rows();const deleteButtons=page.locator('.rep-mobile-records').getByRole('button',{name:'حذف الزيارة',exact:true});ok(await deleteButtons.count()>0,'Admin sees visit delete buttons on mobile');
 await deleteButtons.first().click();let confirmation=page.getByRole('alertdialog');await confirmation.waitFor();await confirmation.getByRole('button',{name:'إلغاء',exact:true}).click();await confirmation.waitFor({state:'detached'});eq((await rows()).length,before.length,'Cancel preserves records');
 await deleteButtons.first().click();confirmation=page.getByRole('alertdialog');await confirmation.getByRole('button',{name:'حذف السجل',exact:true}).click();await confirmation.waitFor({state:'detached'});await eventually(async()=>(await rows()).length===before.length-1,'Confirmed admin deletion persisted');
 const after=await rows(),deleted=before.find(r=>!after.some(x=>x.id===r.id));ok(deleted,'Exactly one selected record removed');const audit=await db.prepare("SELECT detail FROM crm_audit WHERE record_id=? AND action='حذف'").bind(deleted.id).first();eq(JSON.parse(audit.detail).record.id,deleted.id,'Deletion snapshot retained');
 await snapshot(page,'admin-visits-after-delete');
 const repCtx=await context(),repPage=await firstPage(repCtx);await signin(repPage,'rep1');await nav(repPage,'activity');eq(await repPage.getByRole('button',{name:'حذف الزيارة',exact:true}).count(),0,'Rep never sees admin delete buttons');eq(errors,[],'No uncaught UI errors');
 const report={ok:true,checks,actualBuiltRelease:true,realSqlite:true,syntheticFixture:true,productionDataUsed:false,physicalDeviceTested:false,deployed:false,coverage:['admin delete button','cancel preserves visit','confirmation removes one visit','audit snapshot','rep delete hidden'],screenshots:saved};await writeFile('docs/ADMIN-DELETE-BROWSER-VERIFICATION.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){console.error('Offline browser workflow failed:',error.stack);if(lastPage){try{console.error('UI state:',await lastPage.locator('body').innerText());console.error('Offline shell state:',JSON.stringify(await lastPage.evaluate(async()=>({secure:isSecureContext,controller:navigator.serviceWorker?.controller?.scriptURL,registrations:await navigator.serviceWorker.getRegistrations().then(items=>items.map(item=>({scope:item.scope,active:item.active?.state,waiting:item.waiting?.state,installing:item.installing?.state}))),caches:await caches.keys()}))));console.error('Outbox:',JSON.stringify(await lastPage.evaluate(()=>new Promise(resolve=>{const request=indexedDB.open('yourrest-offline-v1');request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains('outbox')){resolve([]);return;}const read=db.transaction('outbox').objectStore('outbox').getAll();read.onsuccess=()=>resolve(read.result);};}))));await lastPage.screenshot({path:path.join(screenshots,'failure.png'),fullPage:false});}catch{}}if(log)console.error('Isolated server diagnostics:',log.replace(/[a-f0-9]{64}/gi,'[redacted]'));process.exitCode=1;}
finally{await browser?.close();if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}if(child&&child.exitCode===null){child.kill();await once(child,'exit');}db?.close();await rm(work,{recursive:true,force:true});}
