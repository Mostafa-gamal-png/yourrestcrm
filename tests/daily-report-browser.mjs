// Daily report: actual built UI, Leaflet markers and HTTP API using isolated synthetic data.
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

const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const release=path.join(root,'dist/standalone');
const work=await mkdtemp(path.join(os.tmpdir(),'yourrest-daily-report-browser-')),data=path.join(work,'data'),capture=path.join(work,'mail.jsonl');
const screenshots=path.join(root,'docs/daily-report-screenshots');
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
 const created='2026-10-03T06:00:00.000Z',date='2026-10-04',product='قوالب البلوك المتحركة';
 const members=[
  {id:'owner',name:'QA admin',role:'admin',supervisor:null,region:'all'},
  {id:'manager',name:'QA manager',role:'manager',supervisor:null,region:'western'},
  {id:'supervisor',name:'QA supervisor',role:'supervisor',supervisor:'manager',region:'western'},
  {id:'rep1',name:'مندوب الاختبار',role:'rep',supervisor:'supervisor',region:'western'},
  {id:'outsider',name:'Outside team',role:'rep',supervisor:null,region:'western'},
  {id:'eastrep',name:'Other region',role:'rep',supervisor:'supervisor',region:'eastern'}
 ];
 for(const m of members)await db.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,active,target,created_at,region_scope) VALUES(?,?,?,?,?,?,?,1,0,?,?)').bind(m.id,'opaque-'+m.id,m.id+'@yourrest.org',m.name,m.role,'Main',m.supervisor,created,m.region).run();
 await db.prepare('INSERT INTO crm_settings(id,owner_id) VALUES(?,?)').bind('company','opaque-owner').run();
 async function record(id,kind,parent,assigned,payload,at=created){await db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id,kind,parent,assigned,'Main',JSON.stringify(payload),at,at).run();}
 for(const [id,name,lat,lon] of [
  ['selected','مصنع الزيارة المؤكدة',21.50,39.20],['automatic','مصنع التوقف التلقائي',21.51,39.21],
  ['near-a','مصنعان متجاوران الأول',21.53,39.23],['near-b','مصنعان متجاوران الثاني',21.5302,39.2302],
  ['missing','مصنع بدون نتيجة',21.54,39.24],['pending','مصنع المتابعة المستحقة',21.57,39.27]
 ])await record(id,'customer',null,'rep1',{name,region:'الغربية',city:'جدة',customerType:'مصنع',location:`${lat}, ${lon}`,latitude:lat,longitude:lon,phone:'0500000000'});
 await record('east','customer',null,'eastrep',{name:'مصنع منطقة مخفية',region:'الشرقية',location:'26,50'});
 async function contact(id,customer,at,extra={}){await record(id,'activity',customer,'rep1',{
  visitWorkflow:'customer-v1',type:'visit',date:at.slice(0,10),summary:'تعريف بمنتجات الشركة',result:'متابعة العميل',nextAction:'اتصال بعد تقديم العرض',nextDate:'2026-10-10',salesStage:'',strength:'',requestedProducts:[],hasCompetitor:false,performedBy:'rep1',responsibleId:'rep1',recordedByEmail:'rep1@yourrest.org',location:'21.5,39.2',startedAt:at,endedAt:at,...extra
 },at);}
 await contact('selected-result','selected',date+'T07:07:00.000Z',{journeyStopId:'selected-stop',requestedProducts:[product],customerNeeds:'قالب بمقاس مخصص',hasCompetitor:true,competitorName:'منافس التقرير',competitorNotes:'سعر منافس مسجل صراحة',competitorFileId:'report-quote',competitorFileName:'عرض-المنافس.pdf'});
 await contact('auto-result','automatic',date+'T06:03:00.000Z',{result:'تم استلام المقاسات'});
 await contact('call-result','selected',date+'T08:00:00.000Z',{type:'call',result:'اتصال لاحق',hasCompetitor:false,competitorName:'اسم مخفي غير مفعل'});
 await contact('pending-source','pending','2026-10-03T10:00:00.000Z',{nextAction:'اتصال متابعة مستحق من أمس',nextDate:'2026-10-03'});
 const stopData={arrivalAt:date+'T07:02:00.000Z',departureAt:date+'T07:12:00.000Z',durationSeconds:600,durationUncertain:false,observedSeconds:600,gaps:[],trackingWindow:'06-18',events:[{type:'selected',at:date+'T07:00:00.000Z'},{type:'arrival',at:date+'T07:02:00.000Z'},{type:'departure',at:date+'T07:12:00.000Z'}]};
 await db.prepare('INSERT INTO crm_journey_stops(id,member_id,date,customer_id,region_scope,snapshot,selected_at,closed_at,state,data,version) VALUES(?,?,?,?,?,?,?,?,?,?,1)').bind('selected-stop','rep1',date,'selected','western',JSON.stringify({customerName:'مصنع الزيارة المؤكدة',region:'الغربية',latitude:21.5,longitude:39.2}),date+'T07:00:00.000Z',date+'T07:12:30.000Z','completed',JSON.stringify(stopData)).run();
 await db.prepare('INSERT INTO crm_journey_links VALUES(?,?)').bind('selected-stop','selected-result').run();
 for(let minute=0;minute<=13;minute++){
  const capturedAt=date+'T07:'+String(minute).padStart(2,'0')+':00.000Z',lon=minute<2?39.194+minute*.003:minute<=11?39.20:39.205;
  await db.prepare('INSERT INTO crm_journey_points VALUES(?,?,?,?,?,?,?)').bind('selected-stop','selected-point-'+minute,capturedAt,capturedAt,21.5,lon,5).run();
 }
 const dayId='mobile-test-day',points=[];
 for(const [slot,lat,lon] of [[0,21.51,39.21],[15,21.52,39.22],[30,21.53,39.23],[45,21.54,39.24]]){
  for(let n=0;n<=6;n++){const capturedAt=date+'T06:'+String(slot+n).padStart(2,'0')+':00.000Z';points.push({id:'day-'+slot+'-'+n,capturedAt,receivedAt:capturedAt,latitude:lat,longitude:lon,accuracy:5,stopId:null});}
 }
 const lastPoint=points.at(-1);
 await db.prepare('INSERT INTO crm_mobile_route_days(id,member_id,device_id,date,region_scope,started_at,ended_at,last_point_at,data,version) VALUES(?,?,?,?,?,?,?,?,?,1)').bind(dayId,'rep1','synthetic-device',date,'western',points[0].capturedAt,date+'T06:52:00.000Z',lastPoint.capturedAt,JSON.stringify({gaps:[],lastPoint,trackingWindow:'06-18'})).run();
 for(const p of points)await db.prepare('INSERT INTO crm_mobile_route_points VALUES(?,?,?,?,?,?,?,?)').bind(dayId,p.id,p.capturedAt,p.receivedAt,p.latitude,p.longitude,p.accuracy,p.stopId).run();
 const quoteBytes=new TextEncoder().encode('%PDF-1.4\n% Synthetic report quote only\n%%EOF');
 await privateObjects(objects).put('competitor/report-quote',quoteBytes);
 await db.prepare('INSERT INTO crm_visit_files VALUES(?,?,?,?,?,?,?,?)').bind('report-quote','competitor/report-quote','selected','عرض-المنافس.pdf','application/pdf',quoteBytes.length,'rep1',created).run();
 const sendmail=path.join(work,'sendmail.cjs');await writeFile(sendmail,'#!'+process.execPath+'\n'+`const fs=require('node:fs');let message='';process.stdin.on('data',b=>message+=b);process.stdin.on('end',()=>fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify({to:process.argv.at(-1),message})+'\\n',{mode:0o600}));`,{mode:0o700});
 const backend=await freePort(),tlsPort=await freePort(),origin='https://127.0.0.1:'+tlsPort,key=path.join(work,'key.pem'),cert=path.join(work,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
 child=spawn(process.execPath,['app.cjs'],{cwd:release,env:{PATH:process.env.PATH,NODE_ENV:'production',PORT:String(backend),HOST:'127.0.0.1',YR_APP_ORIGIN:origin,YR_AUTH_SECRET:randomBytes(32).toString('hex'),YR_DATABASE_PATH:filename,YR_OBJECTS_PATH:objects,YR_MAIL_TRANSPORT:'sendmail',YR_MAIL_FROM:'qa@127.0.0.1',YR_SENDMAIL_PATH:sendmail},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 proxy=createHttpsServer({key:await readFile(key),cert:await readFile(cert)},(incoming,outgoing)=>{
  const forwarded=httpRequest({host:'127.0.0.1',port:backend,path:incoming.url,method:incoming.method,headers:{...incoming.headers,host:'127.0.0.1:'+tlsPort,'x-forwarded-proto':'https'}},response=>{
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
  await target.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  const layout=await target.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},overflow:document.documentElement.scrollWidth>innerWidth+1,language:document.documentElement.lang,panels:[...document.querySelectorAll('.journey-report,.journey-overview,.journey-toolbar,.journey-map-panel,.journey-stop,.journey-observed-stops,.journey-pending')].filter(el=>el.getClientRects().length).map(el=>({name:el.className,rect:el.getBoundingClientRect().toJSON()}))}));
  eq(layout.overflow,false,label+' no horizontal overflow');for(const panel of layout.panels)ok(panel.rect.left>=-1&&panel.rect.right<=layout.viewport.width+1,label+' '+panel.name+' within viewport');geometry.push({label,...layout});const filename=path.join(screenshots,label+'.png');await target.screenshot({path:filename,fullPage:false});saved.push(path.relative(root,filename));
 }
 async function reportState(target){return request(target,'/api/journeys?date='+date+'&memberId=rep1');}
 const ctx=await context(),page=await firstPage(ctx);await signin(page,'manager');
 await nav(page,'journeys');await page.locator('.journey-toolbar select').waitFor();
 await page.getByRole('textbox',{name:'تاريخ تقرير يوم المندوب',exact:true}).count().then(async count=>{if(count)await page.getByRole('textbox',{name:'تاريخ تقرير يوم المندوب',exact:true}).fill(date);else await page.locator('.journey-toolbar input[type=date]').fill(date);});
 await page.locator('.journey-toolbar select').selectOption('rep1');
 await page.locator('.journey-overview').waitFor();
 const response=await reportState(page);eq(response.status,200,'Manager report API');const report=response.data;ok(report.daily,'Daily enrichment returned by actual HTTP API');
 eq(report.daily.automaticStations.length,4,'Four independent observed stops');
 eq(report.daily.automaticStations.filter(station=>station.matchStatus==='matched').length,2,'Two unique customer matches');
 eq(report.daily.automaticStations.filter(station=>station.matchStatus==='ambiguous').length,1,'Nearby factories remain ambiguous');
 eq(report.daily.automaticStations.filter(station=>station.matchStatus==='unmatched').length,1,'Unknown stop remains unmatched');
 eq(report.daily.summary.recordedVisits,2,'Actual saved physical visits count');eq(report.daily.summary.recordedCommunications,1,'Calls remain separate from physical visits');eq(report.daily.summary.confirmedVisitSeconds,600,'Confirmed selected visit duration');ok(report.daily.summary.firstMovementAt&&report.daily.summary.observedMovementSeconds>0,'Actual continuous moving samples supply observed movement');ok(report.daily.summary.missingResults>0,'Missing result count is explicit');eq(report.members.some(member=>member.id==='eastrep'),false,'Other region members excluded from regional manager report');
 eq(report.daily.pendingFollowups.length,1,'Prior unclosed due plan returned');eq(report.daily.pendingFollowups[0].customerId,'pending','Correct pending customer');
 ok(!(await page.locator('.journey-report').innerText()).includes('اسم مخفي غير مفعل'),'Disabled competitor excluded');
 await page.locator('.journey-map-station-marker').first().waitFor();eq(await page.locator('.journey-map-station-marker').count(),5,'Selected and automatic map stations displayed');eq(await page.locator('.journey-timeline [data-station-key]').count(),5,'All selected and automatic stations share one chronological timeline');ok((await page.locator('.journey-timeline [data-station-key]').first().getAttribute('data-station-key')).startsWith('automatic:'),'Earlier GPS station precedes later selected visit');eq(await page.locator('.journey-timeline [data-station-key]').last().getAttribute('data-station-key'),'selected:selected-stop','Selected visit follows earlier GPS stations');ok((await page.locator('.journey-timeline').innerText()).includes('أكثر من عميل قريب — غير محدد'),'Ambiguous station is labeled unassigned');
 const marker=page.locator('.journey-map-station-marker[title*="مصنع الزيارة المؤكدة"]');await marker.click();
 const selected=page.locator('[data-station-key="selected:selected-stop"]');await selected.locator('details[open]').waitFor();ok(await selected.evaluate(el=>el===document.activeElement),'Selected map marker focuses matching card');ok((await selected.getAttribute('class')).includes('journey-station-active'),'Selected card highlighted');
 ok((await selected.innerText()).includes(product),'Explicit requested product shown');ok((await selected.innerText()).includes('منافس التقرير'),'Explicit competitor shown');
 const quote=selected.getByRole('link',{name:'عرض-المنافس.pdf',exact:true});eq(await quote.getAttribute('href'),'/api/visit-files?id=report-quote','Quote link points to permission checked endpoint');
 const file=await page.evaluate(async()=>{const response=await fetch('/api/visit-files?id=report-quote');return {status:response.status,mime:response.headers.get('content-type'),body:await response.text()};});eq(file.status,200,'Authorized quote fetch');ok(file.mime.includes('application/pdf'),'Competitor quote PDF mime');ok(file.body.includes('Synthetic report quote only'),'Correct synthetic quote');
 await snapshot(page,'daily-report-ar-360-selected');
 const auto=report.daily.automaticStations.find(station=>station.customerId==='automatic');await page.locator('.journey-map-panel').scrollIntoViewIfNeeded();await page.locator('.journey-map-station-marker[title*="مصنع التوقف التلقائي"]').click();
 const autoCard=page.locator('[data-station-key="automatic:'+auto.id+'"]');await autoCard.locator('details[open]').waitFor();ok(await autoCard.evaluate(el=>el===document.activeElement),'Automatic marker focuses matching card');ok((await autoCard.innerText()).includes('تم استلام المقاسات'),'Actual auto matched visit outcome shown');
 await snapshot(page,'daily-report-ar-360-automatic');
 await page.locator('.journey-pending').scrollIntoViewIfNeeded();ok((await page.locator('.journey-pending').innerText()).includes('اتصال متابعة مستحق من أمس'),'Due follow-up action displayed');ok((await page.locator('.journey-pending').innerText()).includes('متأخرة'),'Overdue label displayed');await snapshot(page,'daily-report-ar-360-pending');
 await page.setViewportSize({width:320,height:760});await page.locator('.journey-overview').scrollIntoViewIfNeeded();await snapshot(page,'daily-report-ar-320-summary');
 await page.getByRole('button',{name:'Switch to English',exact:true}).click();await page.getByRole('region',{name:'Representative daily summary'}).count().then(async count=>{if(!count)await page.locator('.journey-overview').getByText('First observed movement',{exact:true}).waitFor();});
 await page.locator('.journey-overview').scrollIntoViewIfNeeded();await snapshot(page,'daily-report-en-320-summary');
 await page.locator('.journey-map-panel').scrollIntoViewIfNeeded();await page.locator('.journey-map-station-marker[title*="مصنع الزيارة المؤكدة"]').click();await selected.locator('details[open]').waitFor();ok((await selected.innerText()).includes('Mobile block moulds'),'English product label');await snapshot(page,'daily-report-en-320-selected');
 await page.setViewportSize({width:1365,height:900});await page.locator('.journey-overview').scrollIntoViewIfNeeded();await snapshot(page,'daily-report-en-desktop-summary');
 await page.getByRole('button',{name:'التبديل إلى العربية',exact:true}).click();await page.locator('.journey-overview').getByText('أول حركة مرصودة',{exact:true}).waitFor();await snapshot(page,'daily-report-ar-desktop-summary');
 eq(errors,[],'No uncaught browser errors');
 const output={ok:true,checks,actualBuiltRelease:true,realSqlite:true,mockedDeviceLocation:true,blockedExternalNetwork:true,physicalDeviceTested:false,deployedToNamecheap:false,coverage:['actual HTTP daily enrichment','unique/ambiguous/unmatched GPS stops','saved visits versus observed presence','selected and automatic map marker details','explicit products and competitor quotation','due and overdue follow-up list','320px/360px and desktop layout','Arabic and English'],summary:report.daily.summary,geometry,screenshots:saved};
 await writeFile(path.join(root,'docs/DAILY-REPORT-BROWSER-VERIFICATION.json'),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output));
}catch(error){console.error('Daily report browser workflow failed:',error.stack);if(lastPage){try{console.error('UI state:',await lastPage.locator('body').innerText());await lastPage.screenshot({path:path.join(screenshots,'failure.png'),fullPage:false});}catch{}}if(log)console.error('Isolated server diagnostics:',log.replace(/[a-f0-9]{64}/gi,'[redacted]'));process.exitCode=1;}
finally{await browser?.close();if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}if(child&&child.exitCode===null){child.kill();await once(child,'exit');}db?.close();await rm(work,{recursive:true,force:true});}
