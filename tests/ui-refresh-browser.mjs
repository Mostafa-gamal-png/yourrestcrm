// Real built app + isolated SQLite. People, sales and workbook are synthetic fixtures only.
// No production reads/writes, real email, or real device GPS.
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
import {zipSync,strToU8} from 'fflate';
import {sqliteDatabase,privateObjects} from '../portable/storage.mjs';

import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const release=process.env.YR_UI_REFRESH_RELEASE?path.resolve(process.env.YR_UI_REFRESH_RELEASE):path.join(root,'dist/standalone');
const work=await mkdtemp(path.join(os.tmpdir(),'yourrest-ui-refresh-browser-')),data=path.join(work,'data'),capture=path.join(work,'mail.jsonl');
const screenshots=path.join(root,'output/ui-refresh/screenshots');
const contentShell=process.env.YR_BROWSER_CONTENT_SHELL==='1',shells=[];
let child,db,browser,proxy,lastPage,log='',checks=0;
const errors=[],saved=[],geometry=[],writes=[];let dropNextVisitResponse=false,droppedResponses=0,dropCommitOnce=false,holdResponseMs=0;const commitBodies=[];
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
  {id:'manager',name:'QA manager',role:'manager',supervisor:null,region:'all'},
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
  ['west2','owner','مصنع الاختبار الثاني','الغربية','مكة','W102'],
  ['west3','rep1','مصنع متابعة قائمة','الغربية','جدة','W104'],
  ['westoutside','outsider','مصنع خارج الفريق','الغربية','الطائف','W103'],
  ['east','eastrep','مصنع المنطقة الشرقية','الشرقية','الدمام','E101']
 ])await record(id,'customer',null,assigned,{name,region,city,code,customerType:'مصنع',location:'21.5, 39.2',phone:'0500000000',machineCount:1});
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
 const products=['قوالب البلوك المتحركة','قوالب البلوك الثابتة','لمامة البلوك','ماكينة إنتاج البلوكة المتحركة','قطع غيار المكائن المتحركة','خلاطات البلوك','خلاطات الخرسانة الجاهزة','خدمات صيانة'];
 const month=created.slice(0,7),saleDate=created.slice(0,10);
 for(const [id,quantity] of [['rep1',10],['rep2',20],['eastrep',0]])await db.prepare('INSERT INTO crm_target_sets VALUES(?,?,?,?,1,?,?,?)').bind('sales',id,month,JSON.stringify({products:products.map((product,index)=>({product,quantity:index===0?quantity:index===1?0:null}))}),randomUUID(),'owner',created).run();
 await db.prepare('INSERT INTO crm_target_sets VALUES(?,?,?,?,1,?,?,?)').bind('weights','company',month,JSON.stringify({products:products.map((product,index)=>({product,weight:index===0?100:0}))}),randomUUID(),'owner',created).run();
 const items=[{product:products[0],description:'بيانات تحقق محلية',quantity:15,unitPrice:100}];
 await db.prepare('INSERT INTO crm_sales VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)').bind('fixture-sale','west1','rep1','Main',saleDate,'UI-FIXTURE-1','ui-fixture-1',JSON.stringify({items,discount:0,notes:''}),150000,'confirmed','',randomUUID(),'fixture','owner',created,created).run();
 const sendmail=path.join(work,'sendmail.cjs');await writeFile(sendmail,'#!'+process.execPath+'\n'+`const fs=require('node:fs');let message='';process.stdin.on('data',b=>message+=b);process.stdin.on('end',()=>fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify({to:process.argv.at(-1),message})+'\\n',{mode:0o600}));`,{mode:0o700});
 const backend=await freePort(),tlsPort=await freePort(),origin='https://127.0.0.1:'+tlsPort,key=path.join(work,'key.pem'),cert=path.join(work,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
 child=spawn(process.execPath,['app.cjs'],{cwd:release,env:{PATH:process.env.PATH,NODE_ENV:'production',PORT:String(backend),HOST:'127.0.0.1',YR_APP_ORIGIN:origin,YR_AUTH_SECRET:randomBytes(32).toString('hex'),YR_DATABASE_PATH:filename,YR_OBJECTS_PATH:objects,YR_MAIL_TRANSPORT:'sendmail',YR_MAIL_FROM:'qa@127.0.0.1',YR_SENDMAIL_PATH:sendmail},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 proxy=createHttpsServer({key:await readFile(key),cert:await readFile(cert)},(incoming,outgoing)=>{
  let input='';incoming.on('data',part=>input+=part);
  if(incoming.method==='POST')writes.push({path:incoming.url,at:Date.now()});
  const drop=incoming.url==='/api/visits'&&incoming.method==='POST'&&dropNextVisitResponse;if(drop)dropNextVisitResponse=false;
  const forwarded=httpRequest({host:'127.0.0.1',port:backend,path:incoming.url,method:incoming.method,headers:{...incoming.headers,host:'127.0.0.1:'+tlsPort,'x-forwarded-proto':'https'}},response=>{
   if(drop&&response.statusCode===200){response.resume();response.on('end',()=>{droppedResponses++;outgoing.destroy();});return;}
   const isCommit=incoming.url==='/api/sales/import'&&incoming.method==='POST'&&(()=>{try{return JSON.parse(input).action==='commit';}catch{return false;}})();if(isCommit)commitBodies.push(input);
   if(isCommit&&dropCommitOnce&&response.statusCode===200){dropCommitOnce=false;response.resume();response.on('end',()=>{outgoing.writeHead(503,{'content-type':'application/json'});outgoing.end(JSON.stringify({error:'Synthetic lost acknowledgement'}));});return;}
   if(holdResponseMs&&incoming.method==='POST'&&!incoming.url.startsWith('/api/auth/')){const parts=[];response.on('data',part=>parts.push(part));response.on('end',()=>setTimeout(()=>{outgoing.writeHead(response.statusCode,response.headers);outgoing.end(Buffer.concat(parts));},holdResponseMs));return;}
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
   const isolated=await chromium.launch({headless:true,executablePath:process.env.YR_BROWSER_EXECUTABLE||chromium.executablePath(),args:['--no-sandbox','--no-zygote','--single-process','--in-process-gpu','--disable-gpu','--use-gl=disabled','--disable-dev-shm-usage','--no-proxy-server','--ignore-certificate-errors']});
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
 async function signin(target,user){lastPage=target;target.setDefaultTimeout(18000);if(nativeReps[user])await installNativeBridge(target,{memberId:user,regionScope:nativeReps[user]});await target.goto(origin+'/');await target.locator('#yourrest-email').waitFor();await target.locator('#yourrest-email').fill(user);
  const cooldown=(signinRequestedAt.get(user)||0)-Date.now();if(cooldown>0)await delay(cooldown);signinRequestedAt.set(user,Date.now()+61000);
  const pending=target.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/request'&&r.request().method()==='POST');await target.getByRole('button',{name:/^(إرسال رمز الدخول|Send sign-in code)$/}).click();eq((await pending).status(),200,'OTP request '+user);await target.locator('#yourrest-code').waitFor();
  const delivered=(await readFile(capture,'utf8')).trim().split('\n').map(JSON.parse).filter(row=>row.to===user+'@yourrest.org').at(-1);ok(delivered,'Mock email '+user);const mail=Buffer.from(delivered.message.split('\r\n\r\n')[1].replaceAll('\r\n',''),'base64').toString('utf8'),code=mail.match(/\b\d{6}\b/)?.[0];ok(code,'Mock OTP '+user);await target.locator('#yourrest-code').fill(code);await target.getByRole('button',{name:/^(دخول|Sign in)$/}).click();await target.locator('.workspace').waitFor();await target.locator('.mobile-bottom-navigation').waitFor();
 }
 async function nav(target,id){lastPage=target;await target.evaluate(()=>document.activeElement instanceof HTMLElement&&document.activeElement.blur());const direct=target.locator('[data-page="'+id+'"]:visible');if(await direct.count())await direct.first().click();else{await target.getByRole('button',{name:/^(المزيد من الصفحات|More pages)$/,exact:true}).click();await target.locator('.mobile-overflow-pages [data-page="'+id+'"]').click();}await target.locator('.mobile-navigation-sheet').waitFor({state:'detached'});await target.locator('.page-heading').waitFor();}
 async function snapshot(target,label){await target.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await Promise.all(document.getAnimations().filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));await new Promise(resolve=>requestAnimationFrame(resolve));});const layout=await target.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},overflow:document.documentElement.scrollWidth>innerWidth+1,language:document.documentElement.lang,direction:document.documentElement.dir,dark:document.documentElement.classList.contains('dark'),gauges:[...document.querySelectorAll('.target-gauge svg')].map(el=>({label:el.getAttribute('aria-label'),viewBox:el.getAttribute('viewBox')}))}));eq(layout.overflow,false,label+' no page horizontal overflow');eq(layout.direction,layout.language==='ar'?'rtl':'ltr',label+' language direction');geometry.push({label,...layout});const filename=path.join(screenshots,label+'.png');await target.screenshot({path:filename,fullPage:false});saved.push(filename);}
 async function pick(target,name,option){await target.getByRole('combobox',{name,exact:true}).click();const page=target.page?target.page():target;await page.getByRole('option',{name:option,exact:true}).click();}
 async function eventually(check,message,timeout=20000){for(const start=Date.now();Date.now()-start<timeout;){if(await check()){checks++;return;}await delay(100);}throw Error(message);}
 async function theme(page,dark){const control=page.locator('.theme-toggle-control');await control.waitFor();if((await control.getAttribute('aria-checked'))!==String(dark))await control.click();eq(await page.evaluate(()=>document.documentElement.classList.contains('dark')),dark,'Real document theme');eq(await page.evaluate(()=>localStorage.getItem('yr-theme')),dark?'dark':'light','Persisted theme');}
 async function language(page,lang){if(await page.evaluate(()=>document.documentElement.lang)!==lang)await page.locator('.topbar-tools .language-switch').click();await page.waitForFunction(lang=>document.documentElement.lang===lang,lang);}
 async function stableData(page){const response=await request(page,'/api/sales?month='+month+'&kpis=1');eq(response.status,200,'Authorized KPI snapshot');return {performance:response.data.performance,kpis:response.data.kpis,targets:response.data.targets};}
 async function pill(button,label){const style=await button.evaluate(el=>{const css=getComputedStyle(el);return{radius:css.borderTopLeftRadius,height:el.getBoundingClientRect().height,background:css.backgroundImage};});ok(parseFloat(style.radius)>=style.height/2,label+' uses rounded pill');ok(style.background.includes('gradient'),label+' gradient border');}
 const managerCtx=await context(),page=await firstPage(managerCtx);await signin(page,'manager');
 await nav(page,'targets');await page.locator('.targets-summary-card').first().waitFor();const before=await stableData(page);
 const repCard=page.locator('.targets-summary-card').filter({has:page.getByRole('heading',{name:'QA rep one',exact:true})});
 ok(await repCard.locator('.target-gauge svg[aria-label*="150%"] ').count(),'Actual quantity attainment remains 150%');eq(await repCard.locator('.target-gauge svg[aria-label*="150%"] .target-gauge-fill').getAttribute('stroke-dasharray'),'100 100','Painted ring caps at 100, label remains 150');
 for(const id of ['manager','supervisor']){const row=before.performance.find(p=>p.member.id===id)?.attainment.rows[0];eq([row?.target,row?.actual,row?.achievement],[30,15,50],id+' team rollup unchanged');}
 await page.setViewportSize({width:1440,height:1000});await snapshot(page,'manager-targets-desktop-ar-light');await repCard.scrollIntoViewIfNeeded();await snapshot(page,'manager-gauges-desktop-ar-light');await page.evaluate(()=>window.scrollTo(0,0));await theme(page,true);await snapshot(page,'manager-targets-desktop-ar-dark');
 await page.reload();await page.locator('.targets-summary-card').first().waitFor();eq(await page.locator('.theme-toggle-control').getAttribute('aria-checked'),'true','Theme survives cold reload');eq(await stableData(page),before,'Theme and reload do not change KPI response');
 await language(page,'en');eq((await page.getByRole('combobox',{name:'Branch',exact:true}).innerText()).trim(),'All branches','Branch filter is translated in English');await snapshot(page,'manager-targets-desktop-en-dark');await page.setViewportSize({width:390,height:844});await snapshot(page,'manager-targets-mobile-en-dark');await language(page,'ar');await theme(page,false);await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await page.reload();await page.locator('.targets-summary-card').first().waitFor();eq(await page.evaluate(()=>document.documentElement.classList.contains('dark')),false,'Saved light preference overrides system dark');await snapshot(page,'manager-targets-mobile-ar-light');
 const productSelect=page.locator('#targets-summary-product');await productSelect.selectOption(products[1]);await eventually(async()=>await page.locator('.target-gauge-empty').filter({hasText:'المستهدف صفر'}).count()>0,'Zero target state');await snapshot(page,'manager-target-zero-mobile');await productSelect.selectOption(products[2]);await eventually(async()=>await page.locator('.target-gauge-empty').filter({hasText:'لم يُحدد مستهدف'}).count()>0,'Missing target state');await productSelect.selectOption(products[0]);
 // Real import request through the actual parser and transaction, never a synthetic success API.
 const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const headers=['رقم الفاتورة','التاريخ','النوع','رقم الصنف','اسم الصنف','الفئة','الكمية ','الوحدة','سعر الوحدة','الخصم','الإجمالي','القيمة المضافة','رقم العميل','اسم العميل','رقم الموظف','اسم الموظف','العملة','التعادل'];
 const line=['UI-ERP-1',saleDate.replaceAll('-','/'),'فاتورة مبيعات','TEST-1','قالب اختبار','قوالب','0.05','حبة','100','0','5','0.75','W101','مصنع الاختبار الأول','7018','QA rep one','ريال سعودي','1'];
 const rows=[headers,...Array.from({length:40},(_,i)=>line.map((v,n)=>n===3?'TEST-'+i:v))],rowXml=cells=>'<row>'+cells.map(v=>'<c t="str"><v>'+esc(v)+'</v></c>').join('')+'</row>';
 const workbook=zipSync({'[Content_Types].xml':strToU8('<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'),'xl/workbook.xml':strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>'),'xl/_rels/workbook.xml.rels':strToU8('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),'xl/worksheets/sheet1.xml':strToU8('<worksheet><sheetData>'+rows.map(rowXml).join('')+'</sheetData></worksheet>')},{level:0});
 await nav(page,'sales');await page.getByRole('button',{name:/^(استيراد مبيعات ERP|رفع مبيعات ERP|Import ERP sales)$/}).click();let modal=page.locator('.erp-import-dialog');await modal.locator('#erp-sales-report').setInputFiles({name:'synthetic-ui-report.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(workbook)});await modal.locator('.erp-import-filename').waitFor();
 const preview=async()=>{const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/sales/import'&&r.request().method()==='POST'&&JSON.parse(r.request().postData()).action==='preview');await modal.getByRole('button',{name:/^(قراءة التقرير ومعاينته|تحديث المعاينة)$/}).first().click();const reply=await pending;eq(reply.status(),200,'Real workbook preview succeeds');return reply.json();};
 holdResponseMs=900;const previewWait=preview();await modal.locator('.upload-status.is-processing').waitFor();eq(await modal.locator('.upload-status.is-complete').count(),0,'No completion during server processing');eq(await modal.locator('.upload-status.is-processing [role=progressbar]').getAttribute('aria-valuenow'),null,'Processing has no invented percentage');await snapshot(page,'erp-processing-mobile-ar');let prepared=await previewWait;holdResponseMs=0;
 for(const e of prepared.employees)await modal.getByRole('combobox',{name:'مندوب الموظف '+e.employeeName,exact:true}).selectOption('rep1');for(const c of prepared.categories)await modal.getByRole('combobox',{name:'صنف الفئة '+c,exact:true}).selectOption(products[0]);prepared=await preview();eq(prepared.summary.newCount,1,'One actual invoice prepared');
 dropCommitOnce=true;await modal.getByRole('button',{name:'تأكيد الاستيراد',exact:true}).click();await modal.locator('.upload-status.is-error').waitFor();eq((await db.prepare('SELECT COUNT(*) n FROM crm_erp_sales').first()).n,1,'Real commit succeeded before acknowledgement was lost');eq(await modal.locator('.upload-status.is-complete').count(),0,'Lost acknowledgement does not display success');await snapshot(page,'erp-failed-ack-mobile-ar');
 await modal.getByRole('button',{name:'تأكيد الحفظ',exact:true}).click();await modal.locator('.upload-status.is-complete').waitFor();eq(commitBodies.length,2,'One explicit retry after network failure');eq(commitBodies[0],commitBodies[1],'Retry uses identical serialized request and UUID');eq((await db.prepare('SELECT COUNT(*) n FROM crm_erp_sales').first()).n,1,'Retry creates no duplicate invoice');await snapshot(page,'erp-complete-mobile-ar');await modal.getByRole('button',{name:'تم',exact:true}).click();await modal.waitFor({state:'detached'});
 await managerCtx.close();
 // Representative keeps bottom navigation, own targets and existing customer edit scope.
 const repCtx=await context(),rep=await firstPage(repCtx);await signin(rep,'rep1');eq((await request(rep,'/api/sales')).status,403,'Rep cannot read management sales');eq((await request(rep,'/api/sales/import')).status,403,'Rep cannot use ERP imports');await nav(rep,'targets');await rep.locator('.my-targets-products').waitFor();eq(await rep.locator('.targets-summary-card').count(),0,'No team performance page for rep');eq(await rep.locator('.crm-desktop-navigation').count(),0,'Rep keeps simplified bottom navigation');eq(await rep.locator('.my-target-product').count(),products.length,'All existing product targets visible');await snapshot(rep,'rep-targets-mobile-ar-light');await rep.locator('.my-target-product').first().scrollIntoViewIfNeeded();await snapshot(rep,'rep-gauges-mobile-ar-light');await language(rep,'en');await theme(rep,true);await snapshot(rep,'rep-targets-mobile-en-dark');await rep.locator('.my-target-product').first().scrollIntoViewIfNeeded();await snapshot(rep,'rep-gauges-mobile-en-dark');await language(rep,'ar');
 await nav(rep,'customer');await rep.getByRole('button',{name:'بيانات العميل: مصنع الاختبار الثاني',exact:true}).click();const sheet=rep.locator('.crm-sheet');await sheet.getByRole('button',{name:'تعديل',exact:true}).click();let dialog=rep.locator('[role=dialog]').filter({has:rep.locator('form')});await dialog.getByRole('textbox',{name:'الجوال',exact:true}).fill('0501111111');await dialog.getByRole('textbox',{name:'اللوكيشن (خط العرض، خط الطول)',exact:true}).fill('24.7123, 46.6123');await pill(dialog.getByRole('button',{name:/^حفظ /}),'Customer save');await snapshot(rep,'rep-customer-edit-mobile-dark');
 const beforeWrites=writes.filter(w=>w.path==='/api/crm').length;holdResponseMs=1000;const save=dialog.getByRole('button',{name:/^حفظ /});await save.evaluate(button=>{button.click();button.click();});await eventually(async()=>await save.isDisabled(),'Customer saving prevents double click');await dialog.waitFor({state:'detached'});holdResponseMs=0;eq(writes.filter(w=>w.path==='/api/crm').length-beforeWrites,1,'Double-click customer save writes once');const changed=(await request(rep,'/api/crm')).data.records.find(r=>r.id==='west2');eq([changed.data.phone,changed.data.latitude,changed.data.longitude,changed.assignedTo],['0501111111',24.7123,46.6123,'owner'],'Saved edit preserves retained assignee and updates location');
 await sheet.getByRole('button',{name:'الخريطة',exact:true}).click();await rep.locator('.cm-selected-card').waitFor();await snapshot(rep,'rep-map-mobile-dark');await theme(rep,false);await snapshot(rep,'rep-map-mobile-light');
 await nav(rep,'activity');await rep.getByRole('button',{name:'زيارة جديدة',exact:true}).first().click();dialog=rep.locator('.customer-visit-dialog');await dialog.locator('#visit-customer-search').fill('مصنع الاختبار الأول');await rep.getByRole('option').filter({hasText:'مصنع الاختبار الأول'}).waitFor();await dialog.locator('#visit-customer-search').press('Enter');await pick(dialog,'اختر الهدف من الزيارة','تعريف بمنتجات الشركة');await pick(dialog,'نتيجة الزيارة','متابعة العميل');await dialog.getByRole('textbox',{name:/^الإجراء القادم/}).fill('متابعة اختبار الواجهة');await dialog.locator('.location-status').filter({hasText:'تم تحديد الموقع تلقائيًا'}).waitFor();await pill(dialog.getByRole('button',{name:'حفظ الزيارة',exact:true}),'Visit save');await snapshot(rep,'rep-visit-save-mobile-light');const initialVisits=(await db.prepare("SELECT COUNT(*) n FROM crm_records WHERE kind='activity'").first()).n;holdResponseMs=1200;const visitButton=dialog.getByRole('button',{name:'حفظ الزيارة',exact:true});await visitButton.evaluate(button=>{button.click();button.click();});await eventually(async()=>await visitButton.isDisabled(),'Visit saving disables repeated submit');await dialog.waitFor({state:'detached'});holdResponseMs=0;eq((await db.prepare("SELECT COUNT(*) n FROM crm_records WHERE kind='activity'").first()).n,initialVisits+1,'Double-click visit save produces one record');await repCtx.close();
 for(const role of ['supervisor','owner']){const ctx=await context(),target=await firstPage(ctx);await signin(target,role);await nav(target,'targets');await target.locator('.targets-summary-card').first().waitFor();const data=await stableData(target);ok(data.kpis.people.length>0,role+' authorized KPI people');if(role==='supervisor')eq(data.kpis.people.some(p=>p.member.id==='outsider'),false,'Supervisor excludes unrelated rep');eq((await request(target,'/api/sales/import')).status,200,role+' retains importer permission');await target.setViewportSize({width:1280,height:900});await snapshot(target,role+'-targets-desktop-ar');await ctx.close();}
 eq(errors,[],'No uncaught app browser errors');const report={ok:true,checks,actualBuiltRelease:true,realSqlite:true,syntheticFixturesOnly:true,mockedEmail:true,mockedLocation:true,productionDatabaseUsed:false,physicalDeviceTested:false,deployed:false,coverage:['four role scopes','circular actual 150 percent with capped ring','zero and missing target labels','unchanged target/KPI responses across themes','persisted light/dark mode overriding system preference','Arabic and English','desktop/mobile geometry','real ERP parser/commit','processing without premature success','lost acknowledgement identical retry without duplicate invoice','scoped customer editing and location map','double click customer and visit save'],geometry,screenshots:saved};await writeFile(path.join(root,'docs/UI-REFRESH-BROWSER-VERIFICATION-20261008.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){console.error('UI refresh browser workflow failed:',error.stack);if(lastPage){try{console.error('UI state:',await lastPage.locator('body').innerText());await lastPage.screenshot({path:path.join(screenshots,'failure.png'),fullPage:false});}catch{}}if(log)console.error('Isolated server diagnostics:',log.replace(/[a-f0-9]{64}/gi,'[redacted]'));process.exitCode=1;}
finally{await browser?.close();if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}if(child&&child.exitCode===null){child.kill();await once(child,'exit');}db?.close();await rm(work,{recursive:true,force:true});}
