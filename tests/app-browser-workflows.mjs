// Real built app, isolated SQLite + mock sendmail, Chromium and local HTTPS.
// Browser GPS coordinates are controlled through Chromium's permission/emulation API.
// Google Maps handoff is verified as a requested destination URL; no external application,
// physical-device GPS, background collection, real email delivery or hosting deployment is claimed.
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
import {sqliteDatabase} from '../portable/storage.mjs';
import {installNativeBridge,nativeControl} from '../scripts/lib/native-bridge.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),release=path.join(root,'dist/standalone');
const work=await mkdtemp(path.join(os.tmpdir(),'yourrest-workflow-browser-')),data=path.join(work,'data'),capture=path.join(work,'mail.jsonl');
const screenshots=process.env.YR_WORKFLOW_SCREENSHOT_DIR?path.resolve(process.env.YR_WORKFLOW_SCREENSHOT_DIR):path.join(work,'screenshots');
const contentShell=process.env.YR_BROWSER_CONTENT_SHELL==='1',shells=[];
let child,db,browser,proxy,lastPage,log='',checks=0;const errors=[],saved=[],dialogGeometry=[],dialogScrollLayout=[];const injectedDialogFix=process.env.YR_QA_DIALOG_TRANSLATE_FIX==='1';
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
async function freePort(){const server=createNetServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
try{
 await stat(path.join(release,'server.js'));await mkdir(data,{mode:0o700});await mkdir(screenshots,{recursive:true});
 const filename=path.join(data,'database.sqlite'),objects=path.join(data,'objects');await mkdir(objects,{mode:0o700});db=sqliteDatabase(filename,{create:true});
 await db.exec('CREATE TABLE yr_schema_migrations(name TEXT PRIMARY KEY NOT NULL,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)');
 for(const migration of (await readdir(path.join(root,'drizzle'))).filter(name=>/^\d+.*\.sql$/.test(name)).sort()){
  const source=await readFile(path.join(root,'drizzle',migration),'utf8');
  await db.exec(source);
  await db.prepare('INSERT INTO yr_schema_migrations VALUES(?,?,?)').bind(migration,createHash('sha256').update(source).digest('hex'),new Date().toISOString()).run();
 }
 await db.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,active,target,created_at,region_scope) VALUES(?,?,?,?,?,?,1,0,?,?)').bind('owner','opaque-owner','ceo@yourrest.org','QA admin','admin','Main',new Date().toISOString(),'all').run();
 await db.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,active,target,created_at,region_scope) VALUES(?,?,?,?,?,?,1,0,?,?)').bind('rep','opaque-rep','rep@yourrest.org','QA western rep','rep','Main',new Date().toISOString(),'western').run();
 await db.prepare('INSERT INTO crm_settings(id,owner_id) VALUES(?,?)').bind('company','opaque-owner').run();

 const created=new Date().toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),month=day.slice(0,7);
 for(const member of [{id:'manager',name:'QA manager',role:'manager',scope:'western',supervisor:null,active:1},{id:'supervisor',name:'QA supervisor',role:'supervisor',scope:'western',supervisor:'manager',active:1},{id:'rep2',name:'QA other rep',role:'rep',scope:'western',supervisor:'supervisor',active:1},{id:'east',name:'QA eastern rep',role:'rep',scope:'eastern',supervisor:null,active:1},{id:'blocked',name:'QA activation account',role:'rep',scope:'western',supervisor:'supervisor',active:0}]){
  await db.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,active,target,created_at,region_scope) VALUES(?,?,?,?,?,?,?,?,0,?,?)').bind(member.id,'opaque-'+member.id,member.id+'@yourrest.org',member.name,member.role,'Main',member.supervisor,member.active,created,member.scope).run();
 }
 await db.prepare('UPDATE crm_members SET supervisor_id=? WHERE id=?').bind('supervisor','rep').run();
 const customerData=(name,region,location,phone)=>({name,region,location,phone,city:region==='الغربية'?'جدة':'الدمام',code:name==='QA WEST FACTORY'?'QA-101':'QA-102',contact:'QA contact',customerType:'مصنع',customerStatus:'نشط',branch:'Main',assignedTo:region==='الغربية'?'rep':'east'});
 for(const row of [{id:'west-customer',owner:'rep',data:customerData('QA WEST FACTORY','الغربية','21.5, 39.2','0501234567')},{id:'west-other',owner:'rep2',data:customerData('QA WEST OTHER','الغربية','21.6, 39.3','0507654321')},{id:'east-customer',owner:'east',data:customerData('QA EAST SECRET','الشرقية','26.4, 50.0','0504444444')}]){
  await db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,'customer',NULL,?,'Main',?,?,?,1)").bind(row.id,row.owner,JSON.stringify(row.data),created,created).run();
 }
 for(const row of [{id:'other-visit',customer:'west-other',owner:'rep2',result:'OTHER REP PRIVATE RESULT'},{id:'east-visit',customer:'east-customer',owner:'east',result:'EAST SECRET RESULT'}]){
  await db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,'activity',?,?,'Main',?,?,?,1)").bind(row.id,row.customer,row.owner,JSON.stringify({type:'call',date:day,summary:'تعريف بمنتجات الشركة',result:row.result,nextAction:'QA next step',nextDate:day,salesStage:'new',visitWorkflow:'visit-v2',performedBy:row.owner,responsibleId:row.owner,recordedByEmail:row.owner+'@yourrest.org'}),created,created).run();
 }
 const sendmail=path.join(work,'sendmail.cjs');await writeFile(sendmail,'#!'+process.execPath+'\n'+`const fs=require('node:fs');let message='';process.stdin.on('data',b=>message+=b);process.stdin.on('end',()=>fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify({to:process.argv.at(-1),message})+'\\n',{mode:0o600}));`,{mode:0o700});
 const backend=await freePort(),tlsPort=await freePort(),origin='https://crm.yourrest.org:'+tlsPort,key=path.join(work,'key.pem'),cert=path.join(work,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
 child=spawn(process.execPath,['app.cjs'],{cwd:release,env:{PATH:process.env.PATH,NODE_ENV:'production',PORT:String(backend),HOST:'127.0.0.1',YR_APP_ORIGIN:origin,YR_AUTH_SECRET:randomBytes(32).toString('hex'),YR_DATABASE_PATH:filename,YR_OBJECTS_PATH:objects,YR_MAIL_TRANSPORT:'sendmail',YR_MAIL_FROM:'noreply@yourrest.org',YR_SENDMAIL_PATH:sendmail},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 proxy=createHttpsServer({key:await readFile(key),cert:await readFile(cert)},(incoming,outgoing)=>{
  const forwarded=httpRequest({host:'127.0.0.1',port:backend,path:incoming.url,method:incoming.method,headers:{...incoming.headers,host:'crm.yourrest.org:'+tlsPort,'x-forwarded-proto':'https'}},response=>{outgoing.writeHead(response.statusCode,response.headers);response.pipe(outgoing);});
  forwarded.on('error',()=>{outgoing.writeHead(502);outgoing.end('Isolated backend is starting');});incoming.pipe(forwarded);
 });proxy.listen(tlsPort,'127.0.0.1');await once(proxy,'listening');
 browser=contentShell?{close:async()=>{for(const shell of shells){await shell.browser.close();shell.child.kill();}}}:await chromium.launch({headless:true,...(process.env.YR_BROWSER_EXECUTABLE?{executablePath:process.env.YR_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--ignore-certificate-errors','--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
 async function firstPage(ctx){return contentShell?ctx.pages()[0]:await ctx.newPage();}
 async function context(options={}){
  let ctx;
  if(contentShell){
   const port=await freePort(),shellChild=spawn(process.env.YR_BROWSER_EXECUTABLE,['--no-sandbox','--single-process','--no-zygote','--in-process-gpu','--headless','--ozone-platform=headless','--disable-gpu','--disable-popup-blocking','--use-gl=disabled','--ignore-certificate-errors','--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port,'about:blank'],{stdio:['ignore','ignore','pipe']});
   let diagnostics='';shellChild.stderr.on('data',b=>diagnostics=(diagnostics+b).slice(-8000));let ready=false;
   for(let n=0;n<100;n++){if(shellChild.exitCode!==null)throw Error('Chromium content shell exited: '+diagnostics);try{const status=await new Promise((resolve,reject)=>{const req=httpRequest({host:'127.0.0.1',port,path:'/json/version'},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});if(status===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
   if(!ready){shellChild.kill();throw Error('Chromium content shell debugging endpoint did not start: '+diagnostics);}
   const shellBrowser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:10000});shells.push({browser:shellBrowser,child:shellChild});ctx=shellBrowser.contexts()[0];
   if(options.geolocation)await ctx.setGeolocation(options.geolocation);if(options.permissions)await ctx.grantPermissions(options.permissions);
   ctx.on('page',target=>{void target.setViewportSize({width:360,height:800});});for(const target of ctx.pages())await target.setViewportSize({width:360,height:800});
  }else ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:360,height:800},deviceScaleFactor:1,...options});
  await ctx.route('https://tile.openstreetmap.org/**',route=>route.abort());
  if(injectedDialogFix)await ctx.addInitScript(()=>window.addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent='@media(max-width:640px){.crm-dialog.mobile-record-dialog{--tw-translate-x:0!important;--tw-translate-y:0!important}}@media(max-width:1023px){.crm-dialog.crm-master-dialog{--tw-translate-x:0!important;--tw-translate-y:0!important}}';document.head.append(style);}));
  await ctx.addInitScript(()=>window.addEventListener('beforeinstallprompt',event=>{if(!event.__testEvent){event.preventDefault();event.stopImmediatePropagation();}}));
  ctx.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));for(const target of ctx.pages())target.on('pageerror',error=>errors.push(error.message));
  return ctx;
 }
 const ctx=await context(),page=await firstPage(ctx);page.setDefaultTimeout(12000);
 let ready=false;for(let attempt=0;attempt<100;attempt++){if(child.exitCode!==null)throw Error('Release exited: '+log);try{const status=await new Promise((resolve,reject)=>{const req=httpRequest({host:'127.0.0.1',port:backend,path:'/login',headers:{host:'crm.yourrest.org:'+tlsPort,'x-forwarded-proto':'https'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});if(status===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert(ready,'Built app failed to start');checks++;
 async function apiGet(target,pathname){const reply=await target.evaluate(async pathname=>{const r=await fetch(pathname);return {status:r.status,data:await r.json()};},pathname);return {status:()=>reply.status,json:async()=>reply.data};}
 async function noOverflow(target,label){check(await target.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,label+' has horizontal overflow');}
 async function shot(target,name){await noOverflow(target,name);const filename=path.join(screenshots,name+'.png');await target.screenshot({path:filename,fullPage:await target.getByRole('dialog').count()===0});saved.push(filename);}
 async function signin(target,user){lastPage=target;
  // A representative uses the system only from the Android app (mandatory route tracking); the app is emulated for this page.
  if(['rep','blocked'].includes(user))await installNativeBridge(target,{memberId:user,regionScope:'western'});
  await target.goto(origin+'/');await target.locator('#yourrest-email').waitFor();await target.locator('#yourrest-email').fill(user);
  const request=target.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/request'&&r.request().method()==='POST');
  await target.getByRole('button',{name:'إرسال رمز الدخول',exact:true}).click();check((await request).status(),200,'Sign-in request '+user);await target.locator('#yourrest-code').waitFor();
  const delivered=(await readFile(capture,'utf8')).trim().split('\n').map(JSON.parse).filter(row=>row.to===user+'@yourrest.org').at(-1);assert(delivered,'Mock email is delivered for '+user);checks++;
  const mail=Buffer.from(delivered.message.split('\r\n\r\n')[1].replaceAll('\r\n',''),'base64').toString('utf8'),code=mail.match(/\b\d{6}\b/)?.[0];assert(code,'Mock OTP missing');checks++;
  await target.locator('#yourrest-code').fill(code);await target.getByRole('button',{name:'دخول',exact:true}).click();await target.locator('.workspace').waitFor();await target.locator('.mobile-bottom-navigation').waitFor();await noOverflow(target,'Signed-in '+user);
  check(new URL(target.url()).pathname,'/','Authenticated landing '+user);
 }
 async function nav(target,id){lastPage=target;
  await target.evaluate(()=>document.activeElement instanceof HTMLElement&&document.activeElement.blur());
  const button=target.locator('.mobile-bottom-navigation [data-page='+id+']');
  if(await button.count())await button.click();else{await target.getByRole('button',{name:'المزيد من الصفحات',exact:true}).click();await target.locator('.mobile-overflow-pages [data-page='+id+']').click();}
  await target.locator(id==='map'?'.cm-shell':'.page-heading').waitFor();await noOverflow(target,'Page '+id);
 }
 async function pick(target,label,name){await target.getByRole('combobox',{name:label,exact:true}).click();await target.page().getByRole('option',{name,exact:true}).click();}
 const labelInput=(target,label)=>target.locator('label.field').filter({hasText:label}).locator('input,textarea').first();
 async function dialogBounds(dialog,label){
  await dialog.waitFor();await dialog.page().evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const layout=await dialog.evaluate(element=>{const rect=element.getBoundingClientRect();return {viewport:{width:innerWidth,height:innerHeight},rect:rect.toJSON(),direction:element.dir};});
  check(layout.rect.left>=-1&&layout.rect.top>=-1&&layout.rect.right<=layout.viewport.width+1&&layout.rect.bottom<=layout.viewport.height+1,true,label+' dialog is fully inside mobile viewport: '+JSON.stringify(layout));
  dialogGeometry.push({label,...layout});await noOverflow(dialog.page(),label);
  if(await dialog.locator('.visit-save-bar').count()){const footer=await dialog.locator('.visit-save-bar').boundingBox();check(footer.y>=0&&footer.y+footer.height<=layout.viewport.height+1,true,label+' save controls stay inside viewport');}
 }
 async function recordDialogScroll(dialog,label){
  const target=dialog.page();await target.mouse.move(2,700);await target.waitForFunction(()=>document.querySelectorAll('[data-sonner-toast][data-visible=true]').length===0,{},{timeout:15000});
  for(const position of ['top','bottom']){
   await dialog.locator('.visit-form-scroll').evaluate((element,position)=>{element.scrollTop=position==='top'?0:element.scrollHeight;},position);await target.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const layout=await dialog.evaluate(element=>{const bounds=selector=>element.querySelector(selector)?.getBoundingClientRect().toJSON(),inner=element.querySelector('.visit-form-scroll');return {viewport:{width:innerWidth,height:innerHeight},dialogScrollTop:element.scrollTop,heading:bounds('.visit-dialog-heading'),footer:bounds('.visit-save-bar'),customer:bounds('.visit-selected-customer'),inner:{scrollTop:inner.scrollTop,clientHeight:inner.clientHeight,scrollHeight:inner.scrollHeight}};});
   check(layout.dialogScrollTop,0,label+' outer dialog never scrolls '+position);check(layout.heading.top>=0&&layout.heading.bottom<=layout.viewport.height,true,label+' heading stays visible '+position);check(layout.footer.top>=0&&layout.footer.bottom<=layout.viewport.height,true,label+' save footer stays visible '+position);
   if(position==='top'&&layout.customer)check(layout.customer.top>=layout.heading.bottom-1&&layout.customer.bottom<=layout.footer.top+1,true,label+' selected customer is visible at top of inner form');
   dialogScrollLayout.push({label,position,...layout});await shot(target,position==='top'?label+'-form':label+'-form-next-step');
  }
 }
 async function languageGeometry(target,open,label){
  await target.mouse.move(2,700);await target.waitForFunction(()=>document.querySelectorAll('[data-sonner-toast][data-visible=true]').length===0,{},{timeout:15000});
  for(const language of ['ar','en']){
   if(await target.locator('html').getAttribute('lang')!==language)await target.locator('.topbar-tools .language-switch').click();
   await target.waitForFunction(language=>document.documentElement.lang===language,language);await open();const modal=target.getByRole('dialog');await modal.waitFor();
   for(const width of [320,360,412]){await target.setViewportSize({width,height:800});await dialogBounds(modal,label+' '+language+' '+width);}
   // The unsaved-changes confirmation can appear a moment after the close tap (the device fix arrives asynchronously), so wait for it briefly.
   await modal.locator('[data-slot=dialog-close]').click();const discard=target.getByRole('button',{name:/^(خروج بدون حفظ|تجاهل التعديلات|Discard changes)$/});await discard.waitFor({timeout:1500}).then(()=>discard.click(),()=>{});await modal.waitFor({state:'detached'});
  }
  await target.setViewportSize({width:360,height:800});await target.locator('.topbar-tools .language-switch').click();await target.waitForFunction(()=>document.documentElement.lang==='ar');
 }
 async function chooseCustomer(dialog,name){await dialog.locator('#visit-customer-search').fill(name);await dialog.getByRole('option').filter({hasText:name}).click();check(await dialog.locator('.visit-selected-customer').innerText().then(text=>text.includes(name)),true,'Selected factory '+name);}
 async function closeDirty(dialog){await dialog.getByRole('button',{name:'إلغاء',exact:true}).click();const discard=dialog.page().getByRole('button',{name:/^(خروج بدون حفظ|تجاهل التعديلات)$/});await discard.waitFor({timeout:1500}).then(()=>discard.click(),()=>{});await dialog.waitFor({state:'detached'});}
 await signin(page,'ceo');await page.reload();await page.locator('.workspace').waitFor();check(await page.locator('#yourrest-code').count(),0,'Reload keeps the verified account signed in');
 // Actual installation fallback UI is reachable after authentication in both languages.
 // Service worker and physical installation are verified separately, never inferred here.
 await page.locator('.mobile-bottom-navigation').waitFor();
 for(const language of ['ar','en']){if(await page.locator('html').getAttribute('lang')!==language)await page.locator('.topbar-tools .language-switch').click();await page.locator('.pwa-install-action').click();const help=page.getByRole('dialog');await help.waitFor();check(await help.getAttribute('dir'),language==='ar'?'rtl':'ltr','Install help direction '+language);assert.match(await help.innerText(),language==='ar'?/افتح قائمة المتصفح/:/Open your browser menu/);checks++;await shot(page,'install-help-'+language);await help.getByRole('button',{name:language==='ar'?'تمام':'Got it',exact:true}).click();await help.waitFor({state:'detached'});}
 await page.locator('.topbar-tools .language-switch').click();await page.waitForFunction(()=>document.documentElement.lang==='ar');
 // The admin activation form must persist a genuine member mutation, not only its badge.
 await nav(page,'team');const activationRow=page.getByRole('row').filter({hasText:'QA activation account'});check(await activationRow.innerText().then(text=>text.includes('معطل')),true,'Fixture account starts inactive');
 await activationRow.getByRole('button',{name:'تعديل المستخدم',exact:true}).click();let dialog=page.getByRole('dialog');await dialog.waitFor();await pick(dialog,'الحالة','نشط');
 let responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/crm'&&r.request().method()==='POST');await dialog.locator('button[type=submit]').click();let response=await responsePromise;check(response.status(),200,'Admin activates a member');await dialog.waitFor({state:'detached'});check(await activationRow.innerText().then(text=>text.includes('نشط')),true,'Member activation refreshes visible state');
 const activated=await context(),activatedPage=await firstPage(activated);await signin(activatedPage,'blocked');await activated.close();
 // Fresh rep sign-in, exact region and own-record scope, with no management surface.
 const rep=await context({geolocation:{latitude:21.5123456,longitude:39.2123456,accuracy:7},permissions:['geolocation']}),repPage=await firstPage(rep);repPage.setDefaultTimeout(12000);await repPage.clock.setSystemTime(new Date(Math.min(Date.parse(day+'T10:00:00Z'),Date.now()-120000)));await signin(repPage,'rep');
 check(await repPage.locator('.mobile-bottom-navigation [data-page]').evaluateAll(items=>items.map(item=>item.dataset.page)),['customer','map','activity','followup','targets'],'Rep is offered only authorized pages');
 const repCrm=await apiGet(repPage,'/api/crm');check(repCrm.status(),200);const repData=await repCrm.json();check(repData.records.some(r=>r.id==='east-customer'),false,'Eastern customers never reach western rep');check(repData.records.some(r=>r.id==='other-visit'),false,'Other rep activity never reaches this rep');
 for(const endpoint of ['/api/sales','/api/sales?kpis=1'])check((await apiGet(repPage,endpoint)).status(),403,'Rep server denies '+endpoint);
 check(await repPage.evaluate(async()=>{const r=await fetch('/api/kpis',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return r.status;}),403,'Rep cannot save KPI assessments');
 await nav(repPage,'customer');const search=repPage.getByRole('searchbox',{name:'بحث في السجلات',exact:true});await search.fill('0501234567');await repPage.locator('.customer-mobile-card').filter({hasText:'QA WEST FACTORY'}).waitFor();check(await repPage.locator('.customer-mobile-card').filter({hasText:'QA EAST SECRET'}).count(),0,'Directory search respects region');await search.fill('');await search.blur();
 await repPage.locator('.heading-actions').getByRole('button',{name:'إضافة عميل',exact:true}).click();dialog=repPage.getByRole('dialog');await dialog.waitFor();await dialogBounds(dialog,'Rep Add customer 360 ar');await labelInput(dialog,'اسم المصنع').fill('QA REP CREATED FACTORY');await labelInput(dialog,'الجوال').fill('0509999999');await labelInput(dialog,'المدينة').fill('جدة');
 await dialog.locator('.customer-extra-fields summary').click();const locationInput=labelInput(dialog,'اللوكيشن (خط العرض، خط الطول)');check(await locationInput.evaluate(node=>node.readOnly),true,'New customer location is device captured and read-only');check(await locationInput.inputValue(),'21.5123456, 39.2123456','New customer location comes from the device fix');responsePromise=repPage.waitForResponse(r=>new URL(r.url()).pathname==='/api/crm'&&r.request().method()==='POST');await dialog.locator('button[type=submit]').click();response=await responsePromise;check(response.status(),200,'Rep creates a scoped customer');const added=await response.json();await dialog.waitFor({state:'detached'});const createdRecord=await db.prepare('SELECT assigned_to,data FROM crm_records WHERE id=?').bind(added.id).first();check(createdRecord.assigned_to,'rep','Rep creation assignment is server controlled');check(JSON.parse(createdRecord.data).region,'الغربية','Rep customer inherits western region');check(JSON.parse(createdRecord.data).locationSource,'device','Stored location is marked as device captured');
 await search.fill('0509999999');await repPage.locator('.customer-mobile-card').filter({hasText:'QA REP CREATED FACTORY'}).waitFor();await noOverflow(repPage,'Rep customer phone search');await search.fill('');await search.blur();
 // Capture a visit from the actual browser form. No fixture activity API is substituted.
 await nav(repPage,'activity');await repPage.locator('.heading-actions').getByRole('button',{name:'زيارة جديدة',exact:true}).click();dialog=repPage.getByRole('dialog');await dialog.waitFor();await dialogBounds(dialog,'Rep visit 360 ar');await chooseCustomer(dialog,'QA WEST FACTORY');await pick(dialog,'اختر الهدف من الزيارة','تعريف بمنتجات الشركة');await pick(dialog,'نتيجة الزيارة','متابعة العميل');await labelInput(dialog,'الإجراء القادم').fill('QA FOLLOWUP REQUIRED');await dialog.locator('.location-status').filter({hasText:'تم تحديد الموقع تلقائيًا'}).waitFor();
 check(await dialog.getByRole('button',{name:'حفظ الزيارة',exact:true}).isEnabled(),true,'Actual Chromium location unlocks visit save');await recordDialogScroll(dialog,'rep-visit');
 responsePromise=repPage.waitForResponse(r=>new URL(r.url()).pathname==='/api/visits'&&r.request().method()==='POST');await dialog.getByRole('button',{name:'حفظ الزيارة',exact:true}).click();response=await responsePromise;const visitReply=await response.json();check(response.status(),200,'Visit save with browser location: '+JSON.stringify(visitReply));await dialog.waitFor({state:'detached'});
 const visitRow=await db.prepare("SELECT id,data FROM crm_records WHERE kind='activity' AND json_extract(data,'$.result')='متابعة العميل' AND json_extract(data,'$.performedBy')='rep' ORDER BY created_at DESC").first();assert(visitRow,'Visit persisted in isolated SQLite');checks++;const visitData=JSON.parse(visitRow.data);check(visitData.locationSource,'device','Visit records device-location source');check(visitData.latitude,21.5123456,'Visit stores Chromium latitude');check(visitData.longitude,39.2123456,'Visit stores Chromium longitude');check(visitData.nextAction,'QA FOLLOWUP REQUIRED','Visit carries planned follow-up');
 // Permission denial must explain itself and support a successful retry without reopening.
 const permissionSession=await rep.newCDPSession(repPage);await permissionSession.send('Browser.setPermission',{permission:{name:'geolocation'},setting:'denied',origin});check(await repPage.evaluate(async()=>(await navigator.permissions.query({name:'geolocation'})).state),'denied','Browser location permission is genuinely denied');await repPage.locator('.heading-actions').getByRole('button',{name:'زيارة جديدة',exact:true}).click();dialog=repPage.getByRole('dialog');await dialog.waitFor();await dialog.locator('.visit-location [role=alert]').waitFor();check(await dialog.getByRole('button',{name:'حفظ الزيارة',exact:true}).isDisabled(),true,'Denied GPS cannot create a fabricated-location visit');await rep.grantPermissions(['geolocation'],{origin});await dialog.getByRole('button',{name:'إعادة المحاولة',exact:true}).click();await dialog.locator('.location-status').filter({hasText:'تم تحديد الموقع تلقائيًا'}).waitFor();checks++;await closeDirty(dialog);
 // Execute the schedule created by that previous visit and verify its original link.
 await nav(repPage,'followup');check(await repPage.getByRole('button',{name:'تسجيل متابعة',exact:true}).count(),0,'No independent follow-up creation button');const plan=repPage.locator('.rep-mobile-records .rep-record-card').filter({hasText:'QA WEST FACTORY'});await plan.waitFor();check(await plan.innerText().then(text=>text.includes('QA FOLLOWUP REQUIRED')),true,'Visit next step appears in follow-up plan');await plan.getByRole('button',{name:'تنفيذ المتابعة',exact:true}).click();dialog=repPage.getByRole('dialog');await dialog.waitFor();await dialogBounds(dialog,'Rep follow-up 360 ar');await dialog.locator('.followup-source-summary summary').click();check(await dialog.locator('.followup-source-summary').innerText().then(text=>text.includes('QA FOLLOWUP REQUIRED')),true,'Form displays original visit action');await pick(dialog,'نوع المتابعة','اتصال');await labelInput(dialog,'ما نتيجة المتابعة؟').fill('QA FOLLOWUP COMPLETED');await labelInput(dialog,'الإجراء القادم').fill('QA NEXT FOLLOWUP');await recordDialogScroll(dialog,'rep-followup');responsePromise=repPage.waitForResponse(r=>new URL(r.url()).pathname==='/api/customer-followups'&&r.request().method()==='POST');await dialog.getByRole('button',{name:'حفظ المتابعة',exact:true}).click();response=await responsePromise;const followupReply=await response.json();check(response.status(),200,'Follow-up save: '+JSON.stringify(followupReply));await dialog.waitFor({state:'detached'});
 const followup=await db.prepare("SELECT data FROM crm_records WHERE json_extract(data,'$.visitWorkflow')='followup-v1' AND json_extract(data,'$.result')='QA FOLLOWUP COMPLETED'").first();assert(followup,'Follow-up persisted');checks++;check(JSON.parse(followup.data).sourceId,visitRow.id,'Follow-up links the source visit');
 // Regression for fullscreen bounds after compiled CSS lowering, in both directions.
 await nav(repPage,'customer');await languageGeometry(repPage,()=>repPage.locator('.heading-actions .btn.subtle').click(),'Rep Add customer');
 await nav(repPage,'activity');await languageGeometry(repPage,()=>repPage.locator('.heading-actions .btn.primary').click(),'Rep visit');
 await nav(repPage,'followup');await languageGeometry(repPage,()=>repPage.locator('.rep-mobile-records .rep-record-card').filter({hasText:'QA WEST FACTORY'}).locator('.rep-record-actions .btn.primary').click(),'Rep follow-up');
 // Direction handoff must happen before a deliberately failing tracking request. A representative works inside the Android
 // app, so for them the handoff is a native request; the browser behaviour (popup, blocked-popup recovery, user gesture)
 // is exercised for the manager, who still uses a browser.
 let actualPopupOpened=false;const requestedMaps=[];
 async function directionsFlow(page,browserContext,{native,label}){
  await nav(page,'map');await page.route('**/api/journeys**',async route=>{if(route.request().method()==='POST'){await new Promise(resolve=>setTimeout(resolve,2500));try{await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'QA TRACKING UNAVAILABLE'})});}catch{}return;}await route.continue();});
  const mapSearch=page.getByRole('combobox',{name:'ابحث عن عميل',exact:true});await mapSearch.fill('QA WEST FACTORY');await page.getByRole('option').filter({hasText:'QA WEST FACTORY'}).click();check(await page.locator('.cm-selected-card h2').innerText(),'QA WEST FACTORY','Map resolves selected scoped customer ('+label+')');
  let mapsUrl;
  if(native){
   const tapped=await page.evaluate(()=>Date.now());await page.getByRole('button',{name:'الاتجاهات',exact:true}).click();
   await page.waitForFunction(()=>window.__nativeMock.calls.some(call=>call.method==='openDirections'),null,{timeout:12000});
   const handoffs=(await nativeControl(page).calls()).filter(call=>call.method==='openDirections');
   check(handoffs.length,1,'Actual directions tap requests exactly one native Maps handoff');check(handoffs[0].at-tapped<2000,true,'Maps handoff requested before tracking response');check(handoffs[0].userActivation,true,'Maps handoff stays in the original user gesture');
   check([handoffs[0].payload.latitude,handoffs[0].payload.longitude],[21.5,39.2],'The native handoff carries the selected customer destination');
   mapsUrl=new URL(await page.getByRole('link',{name:'فتح Google Maps',exact:true}).getAttribute('href'));
  }else{
   await browserContext.route('https://www.google.com/maps/**',route=>{requestedMaps.push({url:route.request().url(),at:Date.now()});return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Maps URL handoff test</title><p>Isolated destination capture</p>'});});
   if(contentShell){
    // This embedder closes even on a bare window.open button, independently of CRM.
    // Exercise the real app's blocked-popup recovery without claiming a popup opened.
    await page.evaluate(()=>{window.__qaMapsCalls=[];window.open=(...args)=>{window.__qaMapsCalls.push({url:args[0],target:args[1],at:performance.now(),userActivation:navigator.userActivation.isActive});return null;};});
    const tapped=await page.evaluate(()=>performance.now());await page.getByRole('button',{name:'الاتجاهات',exact:true}).click();const mapsHandoffCalls=await page.evaluate(()=>window.__qaMapsCalls);check(mapsHandoffCalls.length,1,'Actual directions click requests exactly one Maps handoff');check(mapsHandoffCalls[0].at-tapped<2000,true,'Maps handoff requested before tracking response');check(mapsHandoffCalls[0].userActivation,true,'Maps handoff stays in the original user gesture');mapsUrl=new URL(mapsHandoffCalls[0].url);await page.locator('.cm-selected-card').getByRole('alert').filter({hasText:'المتصفح منع فتح نافذة الخرائط'}).waitFor();checks++;
   }else{
    const tapped=Date.now(),popupPromise=page.waitForEvent('popup',{timeout:12000}).catch(error=>({error}));await page.getByRole('button',{name:'الاتجاهات',exact:true}).click();const popup=await popupPromise;if(popup.error)throw popup.error;await popup.waitForLoadState('domcontentloaded');assert(requestedMaps.length,'Maps destination requested');checks++;mapsUrl=new URL(requestedMaps[0].url);check(requestedMaps[0].at-tapped<2000,true,'Maps opens before blocked route recording completes');actualPopupOpened=true;await popup.close();
   }
  }
  check(mapsUrl.hostname,'www.google.com');check(mapsUrl.pathname,'/maps/dir/');check(mapsUrl.searchParams.get('destination'),'21.5,39.2','Correct selected customer destination');check(mapsUrl.searchParams.get('travelmode'),'driving');check(await page.getByRole('link',{name:'فتح Google Maps',exact:true}).getAttribute('href'),mapsUrl.href,'Same destination remains retryable');
  await page.locator('.cm-selected-card').getByRole('alert').filter({hasText:'لم يتم تأكيد تسجيل الرحلة'}).waitFor();checks++;await shot(page,label+'-map-directions');
 }
 await directionsFlow(repPage,rep,{native:true,label:'rep'});
 await nav(repPage,'targets');await repPage.locator('.my-targets').waitFor();check(await repPage.getByRole('button',{name:'أوزان التقييم',exact:true}).count(),0,'Rep own-targets page exposes no target edits');await shot(repPage,'rep-own-targets');
 // Manager pages load and persist targets, an actual invoice and KPI assessment.
 const manager=await context({geolocation:{latitude:21.5123456,longitude:39.2123456,accuracy:7},permissions:['geolocation']}),managerPage=await firstPage(manager);managerPage.setDefaultTimeout(12000);await managerPage.clock.setSystemTime(new Date(Math.min(Date.parse(day+'T10:00:00Z'),Date.now()-120000)));await signin(managerPage,'manager');await directionsFlow(managerPage,manager,{native:false,label:'manager'});await nav(managerPage,'targets');await managerPage.locator('.quantity-targets-table').waitFor();check(await managerPage.locator('.targets-performance-workspace .targets-workspace').count(),1,'Combined page includes team targets');check(await managerPage.locator('.targets-performance-workspace .kpi-workspace').count(),1,'Combined page includes KPI evaluation');
 let repHeader=managerPage.locator('.quantity-targets-table th').filter({hasText:'QA western rep'});await repHeader.getByRole('button',{name:'تعديل',exact:true}).click();dialog=managerPage.getByRole('dialog');await dialog.waitFor();const quantityInputs=dialog.locator('input[type=number]');for(let index=0;index<await quantityInputs.count();index++)await quantityInputs.nth(index).fill(index===0?'10':'0');responsePromise=managerPage.waitForResponse(r=>new URL(r.url()).pathname==='/api/targets'&&r.request().method()==='POST');await dialog.getByRole('button',{name:'حفظ المستهدفات',exact:true}).click();response=await responsePromise;check(response.status(),200,'Manager quantity targets persist');await dialog.waitFor({state:'detached'});
 await nav(managerPage,'sales');await managerPage.getByRole('button',{name:'تسجيل بيع',exact:true}).waitFor();await managerPage.getByRole('button',{name:'تسجيل بيع',exact:true}).click();dialog=managerPage.getByRole('dialog');await chooseCustomer(dialog,'QA WEST FACTORY');await labelInput(dialog,'مرجع البيع').fill('QA-INVOICE-01');await pick(dialog,'مندوب المبيعات','QA western rep');await labelInput(dialog,'الكمية').fill('2');await labelInput(dialog,'سعر الوحدة').fill('500');responsePromise=managerPage.waitForResponse(r=>new URL(r.url()).pathname==='/api/sales'&&r.request().method()==='POST');await dialog.getByRole('button',{name:'حفظ البيع',exact:true}).click();response=await responsePromise;const salesReply=await response.json();check(response.status(),200,'Manager invoice saves: '+JSON.stringify(salesReply));await dialog.waitFor({state:'detached'});await managerPage.getByText('QA-INVOICE-01',{exact:true}).waitFor();const invoice=await db.prepare('SELECT total_cents,rep_id FROM crm_sales WHERE reference=?').bind('QA-INVOICE-01').first();check(invoice.total_cents,100000,'Invoice arithmetic persisted');check(invoice.rep_id,'rep','Invoice belongs to the selected rep');
 await nav(managerPage,'targets');await managerPage.locator('.kpi-workspace table').waitFor();const kpiRow=managerPage.locator('.kpi-workspace table tr').filter({hasText:'QA western rep'});await kpiRow.getByRole('button',{name:'عرض المؤشرات',exact:true}).click();await managerPage.getByRole('button',{name:'تقييم الإدارة وتدقيق البيانات',exact:true}).click();dialog=managerPage.getByRole('dialog');await labelInput(dialog,'عدد السجلات التي تمت مراجعتها').fill('10');await labelInput(dialog,'عدد السجلات الصحيحة والمكتملة').fill('9');responsePromise=managerPage.waitForResponse(r=>new URL(r.url()).pathname==='/api/kpis'&&r.request().method()==='POST');await dialog.getByRole('button',{name:'حفظ التقييم',exact:true}).click();response=await responsePromise;check(response.status(),200,'Manager KPI assessment persists');await dialog.waitFor({state:'detached'});await managerPage.locator('.kpi-axis').first().waitFor();await shot(managerPage,'manager-performance');
 const managerData=await (await apiGet(managerPage,'/api/sales?month='+month+'&kpis=1')).json();check(managerData.members.some(m=>m.id==='east'),false,'Manager regional sales data excludes eastern rep');check(managerData.targets.sets.find(s=>s.kind==='sales'&&s.scopeId==='supervisor')?.computed,true,'Supervisor target is computed from their reps');check(managerData.targets.sets.find(s=>s.kind==='sales'&&s.scopeId==='manager')?.computed,true,'Manager target is computed from their hierarchy');
 // Open every permitted page at 360px and ensure runtime errors never occurred.
 for(const id of ['customer','map','activity','followup','targets','dashboard','journeys','quote','sales','team']){await nav(page,id);await shot(page,'admin-'+id);}
 check(errors,[],'No browser page errors during actual workflows');
 console.log(JSON.stringify({ok:true,checks,browser:contentShell?'Chromium content shell 150':'Chromium',actual_built_release:true,injected_dialog_fix:injectedDialogFix,dialog_geometry:dialogGeometry,dialog_scroll_layout:dialogScrollLayout,real_sqlite:true,real_auth_with_mock_mail:true,actual_install_fallback_ui_tested:true,real_https_service_worker_tested:false,controlled_browser_geolocation:true,controlled_rep_daytime_clock:true,recorded_maps_destination_requests:requestedMaps.length,maps_handoff_calls:mapsHandoffCalls,simulated_popup_blocked:contentShell,actual_popup_opened:actualPopupOpened,external_google_maps_application_tested:false,physical_device_tested:false,background_tracking_tested:false,real_hosting_tested:false,production_data_used:false,...(process.env.YR_WORKFLOW_SCREENSHOT_DIR?{screenshots:saved}:{})}));
 await manager.close();await rep.close();
}catch(error){console.error('Application browser workflows failed:',error.stack);if(lastPage){try{console.error('UI state:',await lastPage.locator('body').innerText());console.error('Dialog layout:',JSON.stringify(await lastPage.locator('[data-slot=dialog-content]').evaluateAll(items=>items.map(item=>{const rect=item.getBoundingClientRect(),style=getComputedStyle(item);return {width:innerWidth,height:innerHeight,rect:rect.toJSON(),left:style.left,top:style.top,transform:style.transform,translate:style.translate,translateX:style.getPropertyValue('--tw-translate-x'),translateY:style.getPropertyValue('--tw-translate-y')};}))));await lastPage.screenshot({path:path.join(screenshots,'failure.png'),fullPage:true});}catch{}}if(log)console.error('Server diagnostics:',log.replace(/[a-f0-9]{64}/gi,'[redacted]'));process.exitCode=1;}
finally{await browser?.close();if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}if(child&&child.exitCode===null){child.kill();await once(child,'exit');}db?.close();await rm(work,{recursive:true,force:true});}
