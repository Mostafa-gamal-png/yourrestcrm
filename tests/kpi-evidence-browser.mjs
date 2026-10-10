// Actual built UI + authenticated HTTP + isolated migrated SQLite.
// All customers, invoices and email are synthetic. Nothing reaches production.
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

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),release=path.join(root,'dist/standalone');
const work=await mkdtemp(path.join(os.tmpdir(),'yourrest-kpi-evidence-browser-')),data=path.join(work,'data'),capture=path.join(work,'mail.jsonl');
const screenshots=process.env.YR_KPI_SCREENSHOT_DIR?path.resolve(process.env.YR_KPI_SCREENSHOT_DIR):path.join(work,'screenshots');
const month='2025-05',errors=[],saved=[],geometry=[],geometryFailures=[];
let child,db,browser,proxy,page,log='',checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
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
 const created='2024-01-01T00:00:00.000Z',products=['قوالب البلوك المتحركة','قوالب البلوك الثابتة','لمامة البلوك','ماكينة إنتاج البلوكة المتحركة','قطع غيار المكائن المتحركة','خلاطات البلوك','خلاطات الخرسانة الجاهزة','خدمات صيانة'];
 for(const [id,name,role,supervisor,region] of [['owner','QA admin','admin',null,'all'],['manager','QA manager','manager',null,'western'],['supervisor','QA supervisor','supervisor','manager','western'],['rep','مندوب الاختبار QA','rep','supervisor','western']]){
  await db.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,active,target,created_at,region_scope) VALUES(?,?,?,?,?,?,?,1,0,?,?)').bind(id,'opaque-'+id,id+'@yourrest.org',name,role,'Main',supervisor,created,region).run();
 }
 await db.prepare('INSERT INTO crm_settings(id,owner_id) VALUES(?,?)').bind('company','opaque-owner').run();
 async function record(id,kind,parent,payload){await db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id,kind,parent,'rep','Main',JSON.stringify(payload),created,created).run();}
 await record('customer','customer',null,{name:'مصنع اختبار المؤشرات — بيانات توضيحية',code:'QA-C001',region:'الغربية',city:'جدة',customerType:'مصنع',_createdBy:'rep'});
 await record('quote','quote','customer',{number:'QA-Q001',performedBy:'rep',recordedByEmail:'rep@yourrest.org',date:month+'-05',status:'sent',items:[{description:'قالب توضيحي',quantity:1,price:100}],discount:0,taxRate:15,total:115});
 const item={product:products[0],description:'قالب توضيحي',quantity:1,unitPrice:100};
 for(const [id,date] of [['sale-prior','2025-04-10'],['sale-current',month+'-10']])await db.prepare("INSERT INTO crm_sales(id,customer_id,rep_id,branch,date,reference,reference_key,data,total_cents,status,void_reason,version,mutation_id,create_fingerprint,created_by,created_at,updated_at) VALUES(?,'customer','rep','Main',?,?,?,?,10000,'confirmed','',1,'fixture','fixture','owner',?,?)").bind(id,date,id,id,JSON.stringify({items:[item],discount:0,notes:''}),created,created).run();
 for(const [kind,id,payload] of [
  ['sales','rep',{products:products.map((product,index)=>({product,quantity:index===0?1:0}))}],
  ['weights','company',{products:products.map((product,index)=>({product,weight:index===0?100:0}))}],
  ['activity','rep',{newCustomers:1,recoveredCustomers:1,visits:1}]
 ])await db.prepare('INSERT INTO crm_target_sets(kind,scope_id,month,data,version,mutation_id,updated_by,updated_at) VALUES(?,?,?,?,1,?,?,?)').bind(kind,id,'2025-01',JSON.stringify(payload),'fixture','owner',created).run();
 const sendmail=path.join(work,'sendmail.cjs');
 await writeFile(sendmail,'#!'+process.execPath+'\n'+`const fs=require('node:fs');let message='';process.stdin.on('data',b=>message+=b);process.stdin.on('end',()=>fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify({to:process.argv.at(-1),message})+'\\n',{mode:0o600}));`,{mode:0o700});
 const backend=await freePort(),tlsPort=await freePort(),origin='https://127.0.0.1:'+tlsPort,key=path.join(work,'key.pem'),cert=path.join(work,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
 // The mock sender matches the loopback origin under the real mailer checks;
 // company-email recipients and OTP validation still use the application's rules.
 child=spawn(process.execPath,['app.cjs'],{cwd:release,env:{PATH:process.env.PATH,NODE_ENV:'production',PORT:String(backend),HOST:'127.0.0.1',YR_APP_ORIGIN:origin,YR_AUTH_SECRET:randomBytes(32).toString('hex'),YR_DATABASE_PATH:filename,YR_OBJECTS_PATH:objects,YR_MAIL_TRANSPORT:'sendmail',YR_MAIL_FROM:'qa@127.0.0.1',YR_SENDMAIL_PATH:sendmail},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 proxy=createHttpsServer({key:await readFile(key),cert:await readFile(cert)},(incoming,outgoing)=>{
  const forwarded=httpRequest({host:'127.0.0.1',port:backend,path:incoming.url,method:incoming.method,headers:{...incoming.headers,host:'127.0.0.1:'+tlsPort,'x-forwarded-proto':'https'}},response=>{outgoing.writeHead(response.statusCode,response.headers);response.pipe(outgoing);});
  forwarded.on('error',()=>{if(!outgoing.headersSent)outgoing.writeHead(502);outgoing.end('Isolated backend is starting');});incoming.pipe(forwarded);
 });proxy.listen(tlsPort,'127.0.0.1');await once(proxy,'listening');
 let ready=false;for(let attempt=0;attempt<100;attempt++){
  if(child.exitCode!==null)throw Error('Release exited: '+log);
  try{const status=await new Promise((resolve,reject)=>{const request=httpRequest({host:'127.0.0.1',port:backend,path:'/login',headers:{host:'127.0.0.1:'+tlsPort,'x-forwarded-proto':'https'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end();});if(status===200){ready=true;break;}}catch{}await delay(100);
 }ok(ready,'Actual built release starts');
 browser=await chromium.launch({headless:true,executablePath:process.env.YR_BROWSER_EXECUTABLE||'/tmp/yourrest-gauge-chromium',args:['--no-sandbox','--no-zygote','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--ignore-certificate-errors','--no-proxy-server']});
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:360,height:800},deviceScaleFactor:1,reducedMotion:'reduce',serviceWorkers:'block'});
 // Only this isolated HTTPS origin may be requested by the test browser.
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 page=await context.newPage();page.setDefaultTimeout(18000);page.on('pageerror',error=>errors.push(error.message));
 async function signin(user){
  await page.goto(origin+'/');await page.locator('#yourrest-email').waitFor();await page.locator('#yourrest-email').fill(user);
  const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/request'&&r.request().method()==='POST');
  await page.getByRole('button',{name:/^(إرسال رمز الدخول|Send sign-in code)$/}).click();eq((await pending).status(),200,'Mock OTP requested for '+user);await page.locator('#yourrest-code').waitFor();
  const delivered=(await readFile(capture,'utf8')).trim().split('\n').map(JSON.parse).filter(row=>row.to===user+'@yourrest.org').at(-1);ok(delivered,'Local mock email captured for '+user);
  const mail=Buffer.from(delivered.message.split('\r\n\r\n')[1].replaceAll('\r\n',''),'base64').toString('utf8'),code=mail.match(/\b\d{6}\b/)?.[0];ok(code,'Mock OTP extracted for '+user);
  await page.locator('#yourrest-code').fill(code);await page.getByRole('button',{name:/^(دخول|Sign in)$/}).click();await page.locator('.workspace').waitFor();await page.locator('.mobile-bottom-navigation').waitFor();
 }
 async function navigateTargets(){
  await page.evaluate(()=>document.activeElement instanceof HTMLElement&&document.activeElement.blur());
  await page.getByRole('button',{name:/^(المزيد من الصفحات|More pages)$/}).click();await page.locator('.mobile-overflow-pages [data-page=targets]').click();await selectRep();
 }
 async function selectRep(){
  await page.locator('.targets-performance-workspace').waitFor();const input=page.locator('.sales-toolbar input[type=month]');
  if(await input.inputValue()!==month){const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/sales'&&new URL(response.url()).searchParams.get('month')===month);await input.fill(month);eq((await pending).status(),200,'Selected historical month loads');}
  await page.locator('.kpi-workspace').waitFor();await page.locator('.sales-toolbar').getByRole('combobox',{name:/^(المندوب|Sales rep)$/}).click();await page.getByRole('option',{name:'مندوب الاختبار QA',exact:true}).click();await page.locator('.kpi-person-heading').waitFor();
 }
 const dialog=()=>page.locator('.kpi-evidence-dialog');
 async function openEvidence(readOnly=false){
  await page.getByRole('button',{name:readOnly?/^(عرض بيانات المؤشرات|View KPI evidence)$/:/^(استكمال بيانات المؤشرات|Complete KPI evidence)$/}).click();
  await dialog().waitFor();await dialog().locator('input[name=due]').waitFor();
 }
 async function request(pathname){return page.evaluate(async pathname=>{const response=await fetch(pathname,{cache:'no-store'});return{status:response.status,data:await response.json()};},pathname);}
 async function closeEvidence(){await dialog().locator('.kpi-evidence-footer').getByRole('button',{name:/^(إغلاق|Close)$/}).click();await dialog().waitFor({state:'detached'});}
 async function language(value){
  if(await page.locator('html').getAttribute('lang')!==value){await page.locator('.topbar-tools .language-switch').click();await page.waitForFunction(language=>document.documentElement.lang===language,value);}
 }
 async function snapshot(label,bottom=false){
  await dialog().locator('.kpi-evidence-scroll').evaluate((element,bottom)=>{element.scrollTop=bottom?element.scrollHeight:0;},bottom);
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await Promise.all([...document.querySelectorAll('.kpi-evidence-dialog')].flatMap(element=>element.getAnimations({subtree:true})).map(animation=>animation.finished.catch(()=>{})));await new Promise(resolve=>requestAnimationFrame(resolve));});
  const layout=await page.evaluate(()=>({width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,overflowCandidates:[...document.querySelectorAll('body *')].filter(element=>{const r=element.getBoundingClientRect();if(!element.getClientRects().length||r.right<=innerWidth+1)return false;for(let parent=element.parentElement;parent&&parent!==document.body;parent=parent.parentElement){if(['auto','scroll','hidden','clip'].includes(getComputedStyle(parent).overflowX)&&parent.getBoundingClientRect().right<=innerWidth+1)return false;}return true;}).slice(0,24).map(element=>({tag:element.tagName,class:element.className,text:element.textContent.slice(0,120),rect:element.getBoundingClientRect().toJSON()})),language:document.documentElement.lang,panels:[...document.querySelectorAll('.kpi-evidence-dialog,.kpi-evidence-heading,.kpi-evidence-footer,.kpi-evidence-quote-row')].filter(element=>element.getClientRects().length).map(element=>({name:element.className,rect:element.getBoundingClientRect().toJSON(),computed:{left:getComputedStyle(element).left,right:getComputedStyle(element).right,top:getComputedStyle(element).top,bottom:getComputedStyle(element).bottom,transform:getComputedStyle(element).transform,translate:getComputedStyle(element).translate,width:getComputedStyle(element).width,minWidth:getComputedStyle(element).minWidth,maxWidth:getComputedStyle(element).maxWidth}})),scroll:[...document.querySelectorAll('.kpi-evidence-scroll')].map(element=>({clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,clientHeight:element.clientHeight,scrollHeight:element.scrollHeight}))}));
  await writeFile(path.join(screenshots,label+'-geometry.json'),JSON.stringify(layout,null,2)+'\n');
  await page.screenshot({path:path.join(screenshots,label+'-viewport.png'),fullPage:false});
  if(layout.overflow)geometryFailures.push(label+' has page horizontal overflow');else checks++;
  for(const panel of layout.panels)ok(panel.rect.left>=-1&&panel.rect.right<=layout.width+1,label+' '+panel.name+' stays horizontally inside viewport');
  const footer=layout.panels.find(panel=>panel.name==='kpi-evidence-footer');ok(footer.rect.top>=0&&footer.rect.bottom<=layout.height+1,label+' save footer stays visible');
  for(const scroll of layout.scroll)eq(scroll.scrollWidth<=scroll.clientWidth+1,true,label+' form has no horizontal scroll');
  geometry.push({label,...layout});const file=path.join(screenshots,label+'.png');await page.screenshot({path:file,fullPage:false});saved.push(file);
 }

 await signin('owner');await navigateTargets();await openEvidence();
 eq(await dialog().locator('input[name=due]').inputValue(),'','Blank collection does not present a false zero');
 await dialog().locator('input[name=due]').fill('1000.00');await dialog().locator('input[name=collected]').fill('٧٥٠٫٥٠');
 await dialog().locator('textarea[name=collectionReference]').fill('دفتر تحصيل توضيحي QA-2025-05');
 await dialog().locator('input[name=historyComplete]').check();await dialog().locator('textarea[name=historyReference]').fill('تقرير مبيعات توضيحي كامل مع المرتجعات');
 await dialog().getByRole('button',{name:'إضافة عرض',exact:true}).click();await dialog().getByRole('combobox',{name:'عرض السعر 1',exact:true}).selectOption('quote');await dialog().getByRole('combobox',{name:'الفاتورة المرتبطة 1',exact:true}).selectOption('sale-current');
 await dialog().locator('input[name=quotationsComplete]').check();
 await snapshot('kpi-evidence-mobile-ar');await snapshot('kpi-evidence-quotes-mobile-ar',true);
 const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/kpi-evidence'&&response.request().method()==='POST');
 await dialog().getByRole('button',{name:'حفظ بيانات المؤشرات',exact:true}).click();const response=await pending;eq(response.status(),200,'Real evidence save HTTP succeeds');eq((await response.json()).ok,true,'Server confirms the save');await dialog().waitFor({state:'detached'});
 const stored=await db.prepare('SELECT input,version FROM crm_kpi_evidence WHERE member_id=? AND month=?').bind('rep',month).first();ok(stored,'Evidence exists in isolated database');
 const persisted=JSON.parse(stored.input);eq(persisted.collection,{dueCents:100000,collectedCents:75050,reference:'دفتر تحصيل توضيحي QA-2025-05'},'Arabic decimal currency persists as exact integer cents');eq(persisted.history.complete,true);eq(persisted.quotationsComplete,true);eq(persisted.quotations,[{quoteId:'quote',saleId:'sale-current'}]);eq(stored.version,1);
 let payload=await request('/api/sales?month='+month+'&kpis=1');eq(payload.status,200);let rep=payload.data.kpis.people.find(person=>person.member.id==='rep');eq(rep.metrics.find(metric=>metric.id==='collection').score,75.05);eq(rep.metrics.find(metric=>metric.id==='orders').score,100);eq(rep.metrics.find(metric=>metric.id==='retention').score,100);
 // Reload through the actual UI and reopen: evidence must survive both browser
 // navigation and re-reading the persisted backend state.
 await page.reload();await selectRep();await openEvidence();eq(await dialog().locator('input[name=due]').inputValue(),'1000.00');eq(await dialog().locator('input[name=collected]').inputValue(),'750.50');eq(await dialog().locator('input[name=historyComplete]').isChecked(),true);eq(await dialog().locator('input[name=quotationsComplete]').isChecked(),true);eq(await dialog().getByRole('combobox',{name:'الفاتورة المرتبطة 1',exact:true}).inputValue(),'sale-current');
 await page.setViewportSize({width:1280,height:900});await snapshot('kpi-evidence-desktop-ar');await closeEvidence();await language('en');await openEvidence();
 eq(await dialog().getByRole('heading',{name:'KPI evidence',exact:true}).count(),1,'Evidence heading is translated');eq(await dialog().getByRole('button',{name:'Save KPI evidence',exact:true}).count(),1,'Save action is translated');await snapshot('kpi-evidence-desktop-en');
 await page.setViewportSize({width:360,height:800});await snapshot('kpi-evidence-mobile-en');await snapshot('kpi-evidence-quotes-mobile-en',true);await closeEvidence();
 // A supervisor can inspect the same saved evidence but cannot alter inputs or
 // submit an assessment. Login still uses the real email OTP implementation.
 await context.clearCookies();await signin('supervisor');await language('ar');await navigateTargets();await openEvidence(true);
 eq(await dialog().locator('input[name=due]').isDisabled(),true,'Supervisor collection input is disabled');eq(await dialog().locator('input[name=historyComplete]').isDisabled(),true,'Supervisor completeness confirmation is disabled');eq(await dialog().locator('button[type=submit]').count(),0,'Supervisor has no save action');eq(await dialog().locator('input[name=collected]').inputValue(),'750.50','Supervisor reads persisted team collection');
 ok((await dialog().innerText()).includes('للعرض فقط.'),'Read-only state is explained');await snapshot('kpi-evidence-supervisor-mobile-ar');
 payload=await request('/api/kpi-evidence?memberId=rep&month='+month);eq(payload.status,200);eq(payload.data.canEdit,false,'Server agrees that supervisor cannot edit');
 eq(errors,[],'No uncaught browser page errors');
 const report={ok:geometryFailures.length===0,workflowPassed:true,geometryFailures,checks,actualBuiltRelease:true,realAuthMockEmail:true,realSqlite:true,syntheticFixture:true,productionDatabaseUsed:false,realEmailSent:false,physicalDeviceTested:false,deployedToNamecheap:false,features:['actual admin OTP login','mobile navigation and rep selection','collection exact cents','complete sales-history attestation','explicit quote and invoice assignment','HTTP save confirmation','database persistence and browser reload','KPI recalculation','supervisor read-only evidence','AR/EN mobile and desktop geometry'],geometry,screenshots:saved};
 if(process.env.YR_KPI_BROWSER_REPORT)await writeFile(path.resolve(process.env.YR_KPI_BROWSER_REPORT),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));eq(geometryFailures,[],'No page horizontal overflow in any tested viewport');
}catch(error){
 console.error('KPI evidence built browser workflow failed:',error.stack);
 if(page){try{console.error('UI state:',await page.locator('body').innerText());await page.screenshot({path:path.join(screenshots,'failure.png'),fullPage:true});}catch{}}
 if(log)console.error('Isolated server diagnostics:',log.replace(/[a-f0-9]{64}/gi,'[redacted]'));process.exitCode=1;
}finally{
 await browser?.close();if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}
 if(child&&child.exitCode===null){child.kill();await once(child,'exit');}db?.close();await rm(work,{recursive:true,force:true});
}
