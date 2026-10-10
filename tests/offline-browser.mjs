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
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {sqliteDatabase,privateObjects} from '../portable/storage.mjs';

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
 async function request(target,pathname,body){return target.evaluate(async({pathname,body})=>{const reply=await fetch(pathname,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:reply.status,data:await reply.json()};},{pathname,body});}
 const signinRequestedAt=new Map();
 async function signin(target,user){lastPage=target;target.setDefaultTimeout(18000);await target.goto(origin+'/');await target.locator('#yourrest-email').waitFor();await target.locator('#yourrest-email').fill(user);
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
 async function download(target,id){return target.evaluate(async id=>{const response=await fetch('/api/visit-files?id='+encodeURIComponent(id));return {status:response.status,mime:response.headers.get('content-type'),cache:response.headers.get('cache-control'),body:await response.text()};},id);}
 async function competitors(target){await nav(target,'competitors');await target.locator('.competitors-workspace').waitFor();}
 async function pick(target,name,option){await target.getByRole('combobox',{name,exact:true}).click();await (target.page?target.page():target).getByRole('option',{name:option,exact:true}).click();await (target.page?target.page():target).getByRole('option').first().waitFor({state:'hidden'});}



 async function idbStore(target,name){return target.evaluate(name=>new Promise((resolve,reject)=>{const opened=indexedDB.open('yourrest-offline-v1');opened.onerror=()=>reject(opened.error);opened.onsuccess=()=>{const database=opened.result;if(!database.objectStoreNames.contains(name)){database.close();resolve([]);return;}const transaction=database.transaction(name,'readonly'),read=transaction.objectStore(name).getAll();read.onerror=()=>reject(read.error);read.onsuccess=()=>{const values=read.result;database.close();resolve(values);};};}),name);}
 async function queue(target){return idbStore(target,'outbox');}
 async function eventually(check,message,timeout=25000){const started=Date.now();let value;while(Date.now()-started<timeout){value=await check();if(value){checks++;return value;}await delay(150);}throw Error(message+' (timed out)');}
 async function coldReload(target){await target.reload({waitUntil:'domcontentloaded'});await target.locator('.workspace').waitFor({timeout:25000});await target.locator('.mobile-bottom-navigation').waitFor();}
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
 async function saveVisit(dialog){await dialog.getByRole('button',{name:'حفظ الزيارة',exact:true}).click();await dialog.waitFor({state:'detached',timeout:25000});}
 async function rows(){const result=await db.prepare("SELECT id,parent_id,assigned_to,data,created_at FROM crm_records WHERE kind='activity'").all();return (result.results||result).map(row=>({...row,data:JSON.parse(row.data)}));}
 const ctx=await context(),page=await firstPage(ctx);await signin(page,'rep1');console.log('QA stage: authenticated representative');
 await nav(page,'activity');await nav(page,'followup');await nav(page,'activity');
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller,undefined,{timeout:25000});
 ok(await page.evaluate(()=>navigator.serviceWorker.controller.scriptURL.endsWith('/sw.js')),'Real service worker controls authenticated page');console.log('QA stage: service worker active');
 await eventually(async()=>((await idbStore(page,'snapshots')).length>0),'Authorized offline snapshot saved');
 const initialRows=(await rows()).length;
 const cachedUrls=await page.evaluate(async()=>{const urls=[];for(const name of await caches.keys()){const cache=await caches.open(name);urls.push(...(await cache.keys()).map(request=>new URL(request.url).pathname));}return urls;});ok(cachedUrls.includes('/offline-app.html'),'Public offline app shell is installed');eq(cachedUrls.some(url=>url.startsWith('/api/')||url==='/'),false,'Cache Storage contains no private API or authenticated HTML responses');
 await ctx.setOffline(true);await page.waitForFunction(()=>navigator.onLine===false);await page.locator('.offline-sync-strip').waitFor();
 let dialog=await freshVisit(page),fields=await completeVisit(page,dialog,'زيارة محفوظة أثناء انقطاع الشبكة',{quote:true});
 await snapshot(page,'offline-visit-with-quote-mobile-ar');await saveVisit(dialog);
 let jobs=await queue(page);const firstCapturedAt=jobs.find(job=>job.kind==='visit')?.capturedAt;ok(firstCapturedAt,'Device visit capture time retained');ok(jobs.length>=1,'Visit durably enters local outbox');eq((await rows()).length,initialRows,'Offline visit has not been claimed as server-saved');ok(JSON.stringify(jobs).includes('زيارة محفوظة أثناء انقطاع الشبكة'),'Offline visit body includes typed competitor notes');console.log('QA stage: offline visit and quote saved');
 await coldReload(page);ok((await page.locator('body').innerText()).includes('مصنع الاختبار الأول'),'Cached authorized customers survive offline reload');ok((await queue(page)).length>=1,'Pending visit survives offline reload');console.log('QA stage: offline cold reload succeeded');await snapshot(page,'offline-restored-shell-mobile-ar');await page.getByRole('button',{name:'حالة الحفظ',exact:true}).click();const statusDialog=page.locator('.offline-sync-dialog');await statusDialog.waitFor();ok((await statusDialog.innerText()).includes('بانتظار الرفع'),'Pending records have visible device-save status');await statusDialog.getByRole('button',{name:'إغلاق',exact:true}).click();
 await nav(page,'followup');const card=page.locator('.rep-record-card').filter({hasText:'مصنع متابعة قائمة'});await card.getByRole('button',{name:'تنفيذ المتابعة',exact:true}).click();dialog=page.locator('.followup-record-dialog');await dialog.waitFor();
 await pick(dialog,'نوع المتابعة','اتصال');await dialog.getByRole('textbox',{name:/^ما نتيجة المتابعة/}).fill('متابعة محلية لزيارة سابقة');await dialog.getByRole('textbox',{name:/^الإجراء القادم/}).fill('اتصال آخر بعد عودة الشبكة');fields=dialog.locator('.competitor-fields');await fields.getByRole('switch').click();await fields.getByRole('combobox',{name:/^اسم المنافس/}).fill('منافس المتابعة المحلية');await fields.getByRole('combobox',{name:/^اسم المنافس/}).press('Tab');await fields.locator('textarea').fill('ملاحظة المنافس من متابعة أوفلاين');
 await dialog.getByRole('button',{name:'حفظ المتابعة',exact:true}).click();await dialog.waitFor({state:'detached',timeout:25000});ok(JSON.stringify(await queue(page)).includes('متابعة محلية لزيارة سابقة'),'Follow-up of existing contact is durable');console.log('QA stage: offline follow-up saved');
 dialog=await freshVisit(page,null);await dialog.getByRole('button',{name:'إضافة عميل',exact:true}).click();const newCustomer=dialog.locator('.visit-new-customer');await newCustomer.locator('.visit-new-customer-name input').fill('مصنع محلي جديد للاختبار');await newCustomer.getByRole('textbox',{name:'المدينة',exact:true}).fill('جدة');await newCustomer.getByRole('button',{name:'حفظ واختيار العميل',exact:true}).click();await newCustomer.waitFor({state:'detached',timeout:30000});ok((await dialog.locator('.visit-selected-customer').innerText()).includes('مصنع محلي جديد للاختبار'),'New local customer is selectable without network');
 await completeVisit(page,dialog,'زيارة العميل المحلي الجديد');await saveVisit(dialog);jobs=await queue(page);ok(jobs.length>=4,'Customer, two visits and follow-up are queued');const savedJobIds=jobs.map(job=>job.id).sort();await coldReload(page);eq((await queue(page)).map(job=>job.id).sort(),savedJobIds,'All exact request identities survive a second offline reload');console.log('QA stage: new customer and visit survive reload');
 const mirror=await ctx.newPage();await mirror.goto(origin+'/',{waitUntil:'domcontentloaded'});await mirror.locator('.workspace').waitFor();eq((await queue(mirror)).map(job=>job.id).sort(),savedJobIds,'Second offline tab sees the same durable queue');
 await ctx.setOffline(false);await page.waitForFunction(()=>navigator.onLine===true);await eventually(async()=>((await queue(page)).length===0),'Reconnect automatically acknowledges every queued business entry',45000);
 await eventually(async()=>!(await idbStore(page,'meta')).some(entry=>entry.key==='sync-lease'),'Parallel drain releases its lease after final snapshot refresh');await mirror.close();let serverRows=await rows();eq(serverRows.length,initialRows+3,'Two visits and one follow-up committed exactly once');console.log('QA stage: parallel reconnect sync complete');
 const first=serverRows.find(row=>row.data.competitorNotes==='زيارة محفوظة أثناء انقطاع الشبكة'),followup=serverRows.find(row=>row.data.result==='متابعة محلية لزيارة سابقة'),newVisit=serverRows.find(row=>row.data.competitorNotes==='زيارة العميل المحلي الجديد');ok(first,'Offline visit is stored after reconnection');eq(first.data.offlineRecordedAt,firstCapturedAt,'Device recording instant survives delayed server receipt');eq(first.data.date,new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(firstCapturedAt)),'Visit day comes from device capture in Saudi timezone');ok(Date.parse(first.data.receivedAt)>=Date.parse(first.data.offlineRecordedAt),'Server receipt time is retained separately');ok(followup,'Offline follow-up is stored after reconnection');ok(newVisit,'Offline new-customer visit is stored after reconnection');
 for(const row of [first,followup,newVisit])eq(row.data.performedBy,'rep1','Queued business entry retains authenticated creator');
 ok(first.data.competitorFileId,'Deferred PDF receives a private server attachment ID');const actualQuote=await download(page,first.data.competitorFileId);eq(actualQuote.status,200,'Deferred PDF is downloadable by its owner');ok(actualQuote.body.includes('Synthetic offline competitor evidence'),'Deferred PDF bytes are preserved');
 const newCustomerRow=await db.prepare("SELECT id,data FROM crm_records WHERE kind='customer' AND json_extract(data,'$.name')=?").bind('مصنع محلي جديد للاختبار').first();ok(newCustomerRow,'New customer was synced');eq(newVisit.parent_id,newCustomerRow.id,'Dependent visit binds to confirmed new customer ID');
 ok(JSON.stringify(followup.data).includes('obs-followup'),'Offline follow-up preserves its confirmed original contact ID');
 await page.evaluate(()=>{for(let n=0;n<4;n++){window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('focus'));}});await delay(500);eq((await rows()).length,initialRows+3,'Repeated reconnect notifications do not duplicate saved records');await snapshot(page,'offline-synced-mobile-ar');
 // Lose the HTTP reply after the real server committed. A replay must use the
 // same immutable request body, and the server receipt must prevent duplication.
 dropNextVisitResponse=true;dialog=await freshVisit(page);await completeVisit(page,dialog,'اختبار ضياع الرد بعد الحفظ');await saveVisit(dialog);await eventually(async()=>droppedResponses===1,'Proxy dropped one successful visit receipt');await eventually(async()=>((await queue(page)).length===0),'Lost receipt is retried and acknowledged',45000);serverRows=await rows();eq(serverRows.filter(row=>row.data.competitorNotes==='اختبار ضياع الرد بعد الحفظ').length,1,'Lost response retries create only one visit');console.log('QA stage: lost receipt retry complete');
 // Queue rep one work, replace the HTTP session with rep two while offline, and
 // then reconnect. The other account must never inherit the pending write.
 const secondCtx=await context(),secondPage=await firstPage(secondCtx);await signin(secondPage,'rep2');const secondCookies=await secondCtx.cookies();await secondCtx.close();
 await ctx.setOffline(true);dialog=await freshVisit(page);await completeVisit(page,dialog,'عمل خاص بالمندوب الأول ينتظر الاتصال');await saveVisit(dialog);jobs=await queue(page);ok(jobs.length>=1,'Original account has retained pending work');
 dialog=await freshVisit(page);await dialog.getByRole('textbox',{name:/^الإجراء القادم/}).fill('مسودة تخص الحساب السابق');
 await ctx.clearCookies();await ctx.addCookies(secondCookies);await ctx.setOffline(false);await dialog.waitFor({state:'detached',timeout:25000});checks++;await eventually(async()=>{const data=await request(page,'/api/crm');return data.status===200&&data.data.me?.id==='rep2';},'Second account is server authenticated');await delay(500);
 eq((await rows()).filter(row=>row.data.competitorNotes==='عمل خاص بالمندوب الأول ينتظر الاتصال').length,0,'Pending rep one entry is not sent under rep two');ok((await queue(page)).some(job=>job.ownerId==='rep1'),'Rep one durable work is retained for its owner');ok(!(await page.locator('body').innerText()).includes('عمل خاص بالمندوب الأول ينتظر الاتصال'),'Rep two UI does not display rep one pending details');eq(JSON.stringify(await queue(page)).includes('مسودة تخص الحساب السابق'),false,'Account switch closes an unsaved old-owner dialog without submitting it');
 await ctx.clearCookies();await signin(page,'rep1');await eventually(async()=>((await queue(page)).length===0),'Returning owner resumes original pending work',45000);serverRows=await rows();const owned=serverRows.filter(row=>row.data.competitorNotes==='عمل خاص بالمندوب الأول ينتظر الاتصال');eq(owned.length,1,'Returning owner commits retained work exactly once');eq(owned[0].data.performedBy,'rep1','Returning work remains owned by rep one');console.log('QA stage: account isolation and resume complete');
 eq(errors,[],'No uncaught browser errors');
 const report={ok:true,checks,actualBuiltRelease:true,realSqlite:true,realIndexedDB:true,realServiceWorker:true,realAuthMockEmail:true,syntheticFixture:true,mockedDeviceLocation:true,productionDatabaseUsed:false,realEmailSent:false,physicalDeviceTested:false,deployedToNamecheap:false,offlineTests:['durable visit and competitor notes','PDF blob retention and upload','offline shell reload','existing visit follow-up source preservation','new customer and dependent visit','automatic reconnect drain','parallel-tab and repeated reconnect exact-once','committed response loss replay','account-switch isolation and owner resume'],droppedResponses,writeRequests:writes.length,geometry,screenshots:saved};
 await rm(path.join(screenshots,'failure.png'),{force:true});
 if(process.env.YR_OFFLINE_REPORT)await writeFile(path.resolve(process.env.YR_OFFLINE_REPORT),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){console.error('Offline browser workflow failed:',error.stack);if(lastPage){try{console.error('UI state:',await lastPage.locator('body').innerText());console.error('Offline shell state:',JSON.stringify(await lastPage.evaluate(async()=>({secure:isSecureContext,controller:navigator.serviceWorker?.controller?.scriptURL,registrations:await navigator.serviceWorker.getRegistrations().then(items=>items.map(item=>({scope:item.scope,active:item.active?.state,waiting:item.waiting?.state,installing:item.installing?.state}))),caches:await caches.keys()}))));console.error('Outbox:',JSON.stringify(await lastPage.evaluate(()=>new Promise(resolve=>{const request=indexedDB.open('yourrest-offline-v1');request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains('outbox')){resolve([]);return;}const read=db.transaction('outbox').objectStore('outbox').getAll();read.onsuccess=()=>resolve(read.result);};}))));await lastPage.screenshot({path:path.join(screenshots,'failure.png'),fullPage:false});}catch{}}if(log)console.error('Isolated server diagnostics:',log.replace(/[a-f0-9]{64}/gi,'[redacted]'));process.exitCode=1;}
finally{await browser?.close();if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}if(child&&child.exitCode===null){child.kill();await once(child,'exit');}db?.close();await rm(work,{recursive:true,force:true});}
