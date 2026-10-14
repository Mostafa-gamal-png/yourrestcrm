// Competitors workspace: actual built UI + HTTP endpoints, isolated SQLite fixtures.
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
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const release=path.join(root,'dist/standalone');
const work=await mkdtemp(path.join(os.tmpdir(),'yourrest-competitors-browser-')),data=path.join(work,'data'),capture=path.join(work,'mail.jsonl');
const screenshots=process.env.YR_COMPETITORS_SCREENSHOT_DIR?path.resolve(process.env.YR_COMPETITORS_SCREENSHOT_DIR):path.join(work,'screenshots');
const contentShell=process.env.YR_BROWSER_CONTENT_SHELL==='1',shells=[];
let child,db,browser,proxy,lastPage,log='',checks=0;
const errors=[],saved=[],geometry=[];
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
  ['westoutside','outsider','مصنع خارج الفريق','الغربية','الطائف','W103'],
  ['east','eastrep','مصنع المنطقة الشرقية','الشرقية','الدمام','E101']
 ])await record(id,'customer',null,assigned,{name,region,city,code,customerType:'مصنع',location:'21.5, 39.2',phone:'0500000000'});
 async function contact(id,customer,author,name,day,extra={}){
  const timestamp='2026-09-'+String(day).padStart(2,'0')+'T07:00:00.000Z';
  await record(id,'activity',customer,customer==='west2'?'rep2':customer==='westoutside'?'outsider':customer==='east'?'eastrep':'rep1',{
   visitWorkflow:'customer-v1',type:'call',date:timestamp.slice(0,10),summary:'تعريف بمنتجات الشركة',result:'متابعة العميل',nextAction:'متابعة عرض المنافس',nextDate:'2026-10-10',salesStage:'new',strength:'medium',requestedProducts:[product],hasCompetitor:true,competitorName:name,competitorNotes:'ملاحظة اختبار '+id,performedBy:author,responsibleId:author,recordedByEmail:author+'@yourrest.org',location:'21.5, 39.2',latitude:21.5,longitude:39.2,locationSource:'device',locationCapturedAt:timestamp,locationAccuracy:5,startedAt:timestamp,endedAt:timestamp,...extra
  },timestamp);
 }
 await contact('obs-one','west1','rep1','ألـفا للصناعة',20,{competitorFileId:'quote-one',competitorFileName:'عرض-اختبار.pdf'});
 await contact('obs-two','west2','rep2','الفا للصناعة',21);
 await contact('obs-super','west1','supervisor','منافس المشرف',22);
 await contact('obs-manager','west1','manager','منافس المدير',23);
 await contact('obs-outside','westoutside','outsider','منافس خارج الفريق',24);
 await contact('obs-east','east','eastrep','منافس خارج المنطقة',25);
 await contact('obs-admin','west1','owner','منافس الإدارة',26);
 await contact('obs-hidden','west1','rep1','اسم غير مفعل',27,{hasCompetitor:false});
 const quoteBytes=new TextEncoder().encode('%PDF-1.4\n% Synthetic browser fixture only\n%%EOF');
 await privateObjects(objects).put('competitor/quote-one',quoteBytes);
 await db.prepare('INSERT INTO crm_visit_files VALUES(?,?,?,?,?,?,?,?)').bind('quote-one','competitor/quote-one','west1','عرض-اختبار.pdf','application/pdf',quoteBytes.length,'rep1',created).run();
 const sendmail=path.join(work,'sendmail.cjs');await writeFile(sendmail,'#!'+process.execPath+'\n'+`const fs=require('node:fs');let message='';process.stdin.on('data',b=>message+=b);process.stdin.on('end',()=>fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify({to:process.argv.at(-1),message})+'\\n',{mode:0o600}));`,{mode:0o700});
 const backend=await freePort(),tlsPort=await freePort(),origin='https://crm.yourrest.org:'+tlsPort,key=path.join(work,'key.pem'),cert=path.join(work,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
 child=spawn(process.execPath,['app.cjs'],{cwd:release,env:{PATH:process.env.PATH,NODE_ENV:'production',PORT:String(backend),HOST:'127.0.0.1',YR_APP_ORIGIN:origin,YR_AUTH_SECRET:randomBytes(32).toString('hex'),YR_DATABASE_PATH:filename,YR_OBJECTS_PATH:objects,YR_MAIL_TRANSPORT:'sendmail',YR_MAIL_FROM:'noreply@yourrest.org',YR_SENDMAIL_PATH:sendmail},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 proxy=createHttpsServer({key:await readFile(key),cert:await readFile(cert)},(incoming,outgoing)=>{
  const forwarded=httpRequest({host:'127.0.0.1',port:backend,path:incoming.url,method:incoming.method,headers:{...incoming.headers,host:'crm.yourrest.org:'+tlsPort,'x-forwarded-proto':'https'}},response=>{
   outgoing.writeHead(response.statusCode,response.headers);response.pipe(outgoing);
  });
  forwarded.on('error',()=>{if(!outgoing.headersSent)outgoing.writeHead(502);outgoing.end('Isolated backend is starting');});incoming.pipe(forwarded);
 });proxy.listen(tlsPort,'127.0.0.1');await once(proxy,'listening');
 let ready=false;for(let attempt=0;attempt<100;attempt++){if(child.exitCode!==null)throw Error('Release exited: '+log);try{const status=await new Promise((resolve,reject)=>{const request=httpRequest({host:'127.0.0.1',port:backend,path:'/login',headers:{host:'crm.yourrest.org:'+tlsPort,'x-forwarded-proto':'https'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end();});if(status===200){ready=true;break;}}catch{}await delay(100);}ok(ready,'Actual built app starts');
 browser=contentShell?{close:async()=>{for(const shell of shells){try{await shell.browser.close();}catch{}shell.child.kill();}}}:await chromium.launch({headless:true,...(process.env.YR_BROWSER_EXECUTABLE?{executablePath:process.env.YR_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--ignore-certificate-errors','--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
 async function context(){
  let ctx;
  if(contentShell){
   const port=await freePort(),shellChild=spawn(process.env.YR_BROWSER_EXECUTABLE,['--no-sandbox','--single-process','--no-zygote','--in-process-gpu','--headless','--ozone-platform=headless','--disable-gpu','--use-gl=disabled','--ignore-certificate-errors','--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port,'about:blank'],{stdio:['ignore','ignore','pipe']});
   let diagnostics='',shellReady=false;shellChild.stderr.on('data',b=>diagnostics=(diagnostics+b).slice(-5000));
   for(let n=0;n<100;n++){if(shellChild.exitCode!==null)throw Error('Chromium content shell exited: '+diagnostics);try{const status=await new Promise((resolve,reject)=>{const request=httpRequest({host:'127.0.0.1',port,path:'/json/version'},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end();});if(status===200){shellReady=true;break;}}catch{}await delay(100);}
   if(!shellReady){shellChild.kill();throw Error('Chromium debugging endpoint did not start: '+diagnostics);}
   const connected=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:10000});shells.push({browser:connected,child:shellChild});ctx=connected.contexts()[0];
  }else ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:360,height:800},deviceScaleFactor:1});
  await ctx.addInitScript(()=>{
   let watch=0;const point=()=>({coords:{latitude:21.5,longitude:39.2,accuracy:5,altitude:null,altitudeAccuracy:null,heading:null,speed:null},timestamp:Date.now()});
   Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition:success=>queueMicrotask(()=>success(point())),watchPosition:success=>{queueMicrotask(()=>success(point()));return ++watch;},clearWatch:()=>{}},configurable:true});
  });
  await ctx.route('https://tile.openstreetmap.org/**',route=>route.abort());
  for(const target of ctx.pages()){target.on('pageerror',error=>errors.push(error.message));await target.setViewportSize({width:360,height:800});}
  ctx.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  return ctx;
 }
 async function firstPage(ctx){return contentShell?ctx.pages()[0]:await ctx.newPage();}
 async function request(target,pathname,body){return target.evaluate(async({pathname,body})=>{const reply=await fetch(pathname,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:reply.status,data:await reply.json()};},{pathname,body});}
 async function signin(target,user){lastPage=target;target.setDefaultTimeout(18000);if(nativeReps[user])await installNativeBridge(target,{memberId:user,regionScope:nativeReps[user]});await target.goto(origin+'/');await target.locator('#yourrest-email').waitFor();await target.locator('#yourrest-email').fill(user);
  const pending=target.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/request'&&r.request().method()==='POST');await target.getByRole('button',{name:'إرسال رمز الدخول',exact:true}).click();eq((await pending).status(),200,'OTP request '+user);await target.locator('#yourrest-code').waitFor();
  const delivered=(await readFile(capture,'utf8')).trim().split('\n').map(JSON.parse).filter(row=>row.to===user+'@yourrest.org').at(-1);ok(delivered,'Mock email '+user);const mail=Buffer.from(delivered.message.split('\r\n\r\n')[1].replaceAll('\r\n',''),'base64').toString('utf8'),code=mail.match(/\b\d{6}\b/)?.[0];ok(code,'Mock OTP '+user);await target.locator('#yourrest-code').fill(code);await target.getByRole('button',{name:'دخول',exact:true}).click();await target.locator('.workspace').waitFor();await target.locator('.mobile-bottom-navigation').waitFor();
 }
 async function nav(target,id){lastPage=target;await target.evaluate(()=>document.activeElement instanceof HTMLElement&&document.activeElement.blur());await target.locator('.mobile-bottom-navigation').waitFor({state:'attached'});const button=target.locator('.mobile-bottom-navigation [data-page='+id+']');if(await button.count())await button.click();else{await target.getByRole('button',{name:/^(المزيد من الصفحات|More pages)$/,exact:true}).click();await target.locator('.mobile-overflow-pages [data-page='+id+']').click();}await target.locator('.page-heading').waitFor();}
 const competitorInput=dialog=>dialog.getByRole('combobox',{name:/اسم المنافس/});
async function snapshot(target,label){
  await target.evaluate(async()=>{await Promise.all([...document.querySelectorAll('[role=dialog]')].flatMap(el=>el.getAnimations()).map(animation=>animation.finished.catch(()=>{})));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  const layout=await target.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},clientWidth:document.documentElement.clientWidth,clientLeft:document.documentElement.clientLeft,overflow:document.documentElement.scrollWidth>innerWidth+1,language:document.documentElement.lang,panels:[...document.querySelectorAll('.competitors-workspace,.competitors-list,.competitors-detail,.customer-visit-dialog')].filter(el=>el.getClientRects().length).map(el=>({name:el.className,rect:el.getBoundingClientRect().toJSON()}))}));
  eq(layout.overflow,false,label+' no horizontal overflow');for(const panel of layout.panels)ok(panel.rect.left>=-1&&panel.rect.right<=layout.viewport.width+1,label+' '+panel.name+' stays horizontally in viewport');geometry.push({label,...layout});const filename=path.join(screenshots,label+'.png');await target.screenshot({path:filename,fullPage:false});saved.push(filename);
 }
 async function download(target,id){return target.evaluate(async id=>{const response=await fetch('/api/visit-files?id='+encodeURIComponent(id));return {status:response.status,mime:response.headers.get('content-type'),cache:response.headers.get('cache-control'),body:await response.text()};},id);}
 async function competitors(target){await nav(target,'competitors');await target.locator('.competitors-workspace').waitFor();}
 async function pick(target,name,option){await target.getByRole('combobox',{name,exact:true}).click();await target.page().getByRole('option',{name:option,exact:true}).click();await target.page().getByRole('option').first().waitFor({state:'hidden'});}
 const manager=await context(),page=await firstPage(manager);await signin(page,'manager');await competitors(page);
 eq(await page.locator('.competitors-item').count(),4,'Manager sees own, supervisors, all western reps, with normalized names grouped');
 let payload=await request(page,'/api/crm');eq(payload.status,200,'Scoped CRM endpoint succeeds');
 const managerIds=payload.data.records.filter(r=>r.kind==='activity').map(r=>r.id).sort();
 eq(managerIds,['obs-hidden','obs-manager','obs-one','obs-outside','obs-super','obs-two'],'Server excludes another region and unrelated admin activity');
 let text=await page.locator('.competitors-workspace').innerText();
 for(const hidden of ['منافس خارج المنطقة','منافس الإدارة','اسم غير مفعل'])eq(text.includes(hidden),false,'Manager competitor page excludes '+hidden);
 const alpha=()=>page.locator('.competitors-item').filter({hasText:'الفا للصناعة'});
 eq(await alpha().count(),1,'Arabic spelling and tatweel normalize into one competitor');
 ok((await alpha().innerText()).includes('2 عميل'),'Grouped competitor counts distinct factories');
 ok((await alpha().innerText()).includes('2 تواصل'),'Grouped competitor counts contacts');
 await snapshot(page,'competitors-mobile-ar');
 await page.locator('#competitors-query').fill('W102');eq(await page.locator('.competitors-item').count(),1,'Search customer code finds linked competitor');
 await alpha().click();await page.locator('.competitors-detail').waitFor();eq(await page.locator('.competitors-contact').count(),2,'Search retains complete authorized competitor history');
 eq(await page.locator('.competitors-list').isVisible(),false,'Mobile detail hides list');
 eq(await page.locator('.competitors-contact time').allTextContents(),['2026-09-21','2026-09-20'],'History newest first');
 const link=page.locator('.competitors-attachment');eq(await link.getAttribute('href'),'/api/visit-files?id=quote-one','Quote uses access-controlled file endpoint');
 let file=await download(page,'quote-one');eq(file.status,200,'Manager reads subordinate attachment');eq(file.mime,'application/pdf','Attachment MIME preserved');eq(file.cache,'private, no-store','Attachment is private');ok(file.body.startsWith('%PDF-'),'Attachment body returned');
 await snapshot(page,'competitors-detail-mobile-ar');
 // Existing visits remain the single source of competitor information.
 await page.locator('.competitors-contact').filter({hasText:'obs-one'}).locator('.competitors-open-visit').click();
 let dialog=page.locator('.customer-visit-dialog');await dialog.waitFor();
 eq(await competitorInput(dialog).inputValue(),'ألـفا للصناعة','Original visit opens with stored competitor spelling');
 eq(await dialog.locator('.competitor-file-current a').getAttribute('href'),'/api/visit-files?id=quote-one','Original attachment kept in edit form');
 await dialog.getByLabel(/^ملاحظات المنافس/).fill('مراجعة المنافس من مدير المبيعات');
 let pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/visits'&&r.request().method()==='POST');
 await dialog.getByRole('button',{name:'حفظ التعديلات',exact:true}).click();let response=await pending;eq(response.status(),200,'Manager edits subordinate competitor visit with attachment');await dialog.waitFor({state:'detached'});
 eq(await page.locator('.competitors-contact').filter({hasText:'مراجعة المنافس من مدير المبيعات'}).count(),1,'Competitor history refreshes from edited visit');
 const persisted=JSON.parse((await db.prepare('SELECT data FROM crm_records WHERE id=?').bind('obs-one').first()).data);
 eq(persisted.performedBy,'rep1','Edit preserves original recorder');eq(persisted.competitorFileId,'quote-one','Edit preserves authorized file');
 // Opening the factory card uses the existing customer information and returns safely.
 await page.locator('.competitors-contact-customer button').first().click();await page.locator('.crm-sheet').waitFor();
 ok((await page.locator('.crm-sheet').innerText()).includes('مصنع الاختبار الثاني'),'Linked factory card opens');
 await page.keyboard.press('Escape');await page.locator('.crm-sheet').waitFor({state:'detached'});
 // Adding an observation from an existing competitor prefills the toggle and name.
 await page.locator('.competitors-detail').getByRole('button',{name:'إضافة زيارة',exact:true}).click();dialog=page.locator('.customer-visit-dialog');await dialog.waitFor();
 eq(await dialog.locator('.competitor-fields').getByRole('switch').getAttribute('aria-checked'),'true','Existing competitor CTA enables competitor information');
 eq(await competitorInput(dialog).inputValue(),'الفا للصناعة','Existing competitor CTA prefills name');
 eq(await dialog.locator('.visit-sales-details').getAttribute('open'),'','Sales section already expanded');
 await competitorInput(dialog).press('ArrowDown');await dialog.locator('.competitor-suggestions').waitFor();
 const suggestions=await dialog.locator('.competitor-suggestions [role=option]').evaluateAll(options=>options.map(o=>o.textContent.trim()));
 eq(suggestions.length,4,'Visit suggestions reuse visible competitor set');eq(suggestions.some(text=>text.includes('منافس خارج المنطقة')),false,'Suggestions cannot reveal other regions');
 // Escape belongs to the open suggestion list: it must not dismiss the visit dialog or prompt to discard it.
 await competitorInput(dialog).press('Escape');await page.waitForTimeout(300);
 eq(await dialog.locator('.competitor-suggestions').count(),0,'Escape closes the suggestion list');
 eq(await page.locator('.customer-visit-dialog').count(),1,'Escape inside the competitor combobox keeps the visit dialog open');
 eq(await competitorInput(dialog).inputValue(),'الفا للصناعة','Escape keeps the entered competitor name');
 await dialog.getByRole('button',{name:'إلغاء',exact:true}).click();await dialog.waitFor({state:'detached'});
 await page.locator('.competitors-back').click();eq(await page.locator('.competitors-list').isVisible(),true,'Mobile back restores list');
 await page.locator('#competitors-query').fill('not-existing-customer');await page.locator('.competitors-no-results').waitFor();eq(await page.locator('.competitors-item').count(),0,'Unmatched query shows empty search state');
 await page.getByRole('button',{name:'عرض كل المنافسين',exact:true}).click();eq(await page.locator('.competitors-item').count(),4,'Reset search restores all visible competitors');
 // Register a new competitor via a real call visit; synthetic geolocation only.
 await page.getByRole('button',{name:'تسجيل منافس في زيارة',exact:true}).click();dialog=page.locator('.customer-visit-dialog');await dialog.waitFor();
 eq(await dialog.locator('.competitor-fields').getByRole('switch').getAttribute('aria-checked'),'true','New competitor CTA enables competitor fields');
 eq(await competitorInput(dialog).inputValue(),'','New competitor has no preselected name');
 await pick(dialog,'نوع التواصل','اتصال');await dialog.locator('#visit-customer-search').click();await dialog.locator('#visit-customer-search').fill('W101');await page.getByRole('option').filter({hasText:'مصنع الاختبار الأول'}).waitFor();await dialog.locator('#visit-customer-search').press('Enter');await dialog.locator('.visit-selected-customer').waitFor();
 await pick(dialog,'اختر الهدف من الزيارة','تعريف بمنتجات الشركة');await pick(dialog,'نتيجة الزيارة','متابعة العميل');
 await dialog.getByRole('textbox',{name:/^الإجراء القادم/}).fill('مراجعة سعر المنافس');
 await competitorInput(dialog).fill('منافس جديد QA');await dialog.getByLabel(/^ملاحظات المنافس/).fill('عرض منافس جديد من الاتصال');
 await dialog.locator('.location-status').filter({hasText:'تم تحديد الموقع تلقائيًا'}).waitFor();await snapshot(page,'competitors-new-visit-mobile-ar');
 pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/visits'&&r.request().method()==='POST');await dialog.getByRole('button',{name:'حفظ الزيارة',exact:true}).click();response=await pending;const result=await response.json();eq(response.status(),200,'Real competitor call saves: '+JSON.stringify(result));ok(result.id,'New visit has persisted ID');await dialog.waitFor({state:'detached'});
 eq(await page.locator('.competitors-item').count(),5,'New competitor appears automatically after save');
 const newVisit=JSON.parse((await db.prepare('SELECT data FROM crm_records WHERE id=?').bind(result.id).first()).data);
 eq(newVisit.competitorName,'منافس جديد QA','Competitor name stored in visit');eq(newVisit.performedBy,'manager','Recorder comes from authenticated identity');eq(newVisit.type,'call','Call contact stored');
 await page.reload();await page.locator('.competitors-workspace').waitFor();eq(await page.locator('.competitors-item').count(),5,'Competitor list persists after browser reload');
 await page.locator('#competitors-query').fill('QA rep two');eq(await page.locator('.competitors-item').count(),1,'Search by representative');await page.locator('#competitors-query').fill('');
 await alpha().click();await page.setViewportSize({width:1280,height:900});await snapshot(page,'competitors-desktop-ar');
 eq(await page.locator('.competitors-list').isVisible(),true,'Desktop list stays visible beside history');eq(await page.locator('.competitors-detail').isVisible(),true,'Desktop history visible beside list');
 await page.locator('.topbar-tools .language-switch').click();await page.waitForFunction(()=>document.documentElement.lang==='en');
 eq(await page.locator('.page-heading h1').innerText(),'Competitors','English page title');await snapshot(page,'competitors-desktop-en');await page.setViewportSize({width:360,height:800});await snapshot(page,'competitors-detail-mobile-en');
 await page.locator('.competitors-back').click();await snapshot(page,'competitors-mobile-en');
 // Supervisor's own team projection is narrower than manager; files recheck access.
 const supervisor=await context(),superPage=await firstPage(supervisor);await signin(superPage,'supervisor');await competitors(superPage);
 eq(await superPage.locator('.competitors-item').count(),2,'Supervisor sees self and subordinate reps only');
 payload=await request(superPage,'/api/crm');eq(payload.data.records.filter(r=>r.kind==='activity').map(r=>r.id).sort(),['obs-hidden','obs-one','obs-super','obs-two'],'Supervisor API excludes manager, outsider, admin and another region');
 file=await download(superPage,'quote-one');eq(file.status,200,'Supervisor reads own team attachment');
 await superPage.locator('.competitors-item').filter({hasText:'الفا للصناعة'}).click();await snapshot(superPage,'competitors-supervisor-mobile-ar');
 const rep=await context(),repPage=await firstPage(rep);await signin(repPage,'rep2');
 eq(await repPage.locator('[data-page=competitors]').count(),0,'Rep has no competitor navigation');
 await repPage.goto(origin+'/#competitors');await repPage.locator('.workspace').waitFor();await repPage.locator('.page-heading').waitFor();
 eq(await repPage.locator('.competitors-workspace').count(),0,'Rep direct fragment cannot open management competitor page');
 payload=await request(repPage,'/api/crm');eq(payload.data.records.filter(r=>r.kind==='activity'&&!r.data._readOnly).map(r=>r.id).sort(),['obs-two'],'Rep can only receive own activity');
 file=await download(repPage,'quote-one');eq(file.status,404,'Rep denied another recorder attachment even in same region');
 const owner=await context(),ownerPage=await firstPage(owner);await signin(ownerPage,'owner');await competitors(ownerPage);
 eq(await ownerPage.locator('.competitors-item').count(),7,'Admin sees all authorized competitors including both regions and new saved visit');
 eq(errors,[],'No uncaught browser page errors');
 const report={ok:true,checks,actualBuiltRelease:true,realAuthMockEmail:true,realSqlite:true,syntheticFixture:true,mockedDeviceLocation:true,productionDatabaseUsed:false,realEmailSent:false,physicalDeviceTested:false,deployedToNamecheap:false,features:['management navigation','regional and team visibility','normalized competitor grouping','factory and representative search','newest-first history','customer card','original visit editing','new competitor call save','persistent reload','scoped name suggestions','private attachment permissions','AR and EN','360px and desktop geometry'],geometry,screenshots:saved};
 if(process.env.YR_COMPETITORS_REPORT)await writeFile(path.resolve(process.env.YR_COMPETITORS_REPORT),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}catch(error){console.error('Competitors built browser workflow failed:',error.stack);if(lastPage){try{console.error('UI state:',await lastPage.locator('body').innerText());await lastPage.screenshot({path:path.join(screenshots,'failure.png'),fullPage:true});}catch{}}if(log)console.error('Isolated server diagnostics:',log.replace(/[a-f0-9]{64}/gi,'[redacted]'));process.exitCode=1;}
finally{await browser?.close();if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}if(child&&child.exitCode===null){child.kill();await once(child,'exit');}db?.close();await rm(work,{recursive:true,force:true});}
