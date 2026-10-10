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

const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const release=path.join(root,'dist/standalone');
const work=await mkdtemp(path.join(os.tmpdir(),'yourrest-competitor-intelligence-browser-')),data=path.join(work,'data'),capture=path.join(work,'mail.jsonl');
const screenshots=process.env.YR_COMPETITOR_INTELLIGENCE_SCREENSHOT_DIR?path.resolve(process.env.YR_COMPETITOR_INTELLIGENCE_SCREENSHOT_DIR):path.join(work,'screenshots');
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
  const forwarded=httpRequest({host:'127.0.0.1',port:backend,path:incoming.url,method:incoming.method,headers:{...incoming.headers,host:'127.0.0.1:'+tlsPort,'x-forwarded-proto':'https'}},response=>{
   outgoing.writeHead(response.statusCode,response.headers);response.pipe(outgoing);
  });
  forwarded.on('error',()=>{if(!outgoing.headersSent)outgoing.writeHead(502);outgoing.end('Isolated backend is starting');});incoming.pipe(forwarded);
 });proxy.listen(tlsPort,'127.0.0.1');await once(proxy,'listening');
 let ready=false;for(let attempt=0;attempt<100;attempt++){if(child.exitCode!==null)throw Error('Release exited: '+log);try{const status=await new Promise((resolve,reject)=>{const request=httpRequest({host:'127.0.0.1',port:backend,path:'/login',headers:{host:'127.0.0.1:'+tlsPort,'x-forwarded-proto':'https'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end();});if(status===200){ready=true;break;}}catch{}await delay(100);}ok(ready,'Actual built app starts');
 browser=contentShell?{close:async()=>{for(const shell of shells){try{await shell.browser.close();}catch{}shell.child.kill();}}}:await chromium.launch({headless:true,executablePath:process.env.YR_BROWSER_EXECUTABLE||'/tmp/yourrest-gauge-chromium',args:['--no-sandbox','--no-zygote','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--no-proxy-server','--ignore-certificate-errors']});
 async function context(){
  let ctx;
  if(contentShell){
   const port=await freePort(),shellChild=spawn(process.env.YR_BROWSER_EXECUTABLE,['--no-sandbox','--single-process','--no-zygote','--in-process-gpu','--headless','--ozone-platform=headless','--disable-gpu','--use-gl=disabled','--ignore-certificate-errors','--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port,'about:blank'],{stdio:['ignore','ignore','pipe']});
   let diagnostics='',shellReady=false;shellChild.stderr.on('data',b=>diagnostics=(diagnostics+b).slice(-5000));
   for(let n=0;n<100;n++){if(shellChild.exitCode!==null)throw Error('Chromium content shell exited: '+diagnostics);try{const status=await new Promise((resolve,reject)=>{const request=httpRequest({host:'127.0.0.1',port,path:'/json/version'},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end();});if(status===200){shellReady=true;break;}}catch{}await delay(100);}
   if(!shellReady){shellChild.kill();throw Error('Chromium debugging endpoint did not start: '+diagnostics);}
   const connected=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:10000});shells.push({browser:connected,child:shellChild});ctx=connected.contexts()[0];
  }else ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:360,height:800},deviceScaleFactor:1,reducedMotion:'reduce',serviceWorkers:'block'});
  await ctx.addInitScript(()=>{
   window.__qaSpeech={text:'ملاحظة صوتية توضيحية عن منافس',starts:0,language:null};
   class MockSpeechRecognition{start(){window.__qaSpeech.starts++;window.__qaSpeech.language=this.lang;this.timer=setTimeout(()=>{this.onstart?.({});const result=Object.assign([{transcript:window.__qaSpeech.text}],{isFinal:true});this.onresult?.({resultIndex:0,results:[result]});this.onend?.({});},100);}abort(){clearTimeout(this.timer);this.onend?.({});}stop(){this.abort();}}
   window.SpeechRecognition=MockSpeechRecognition;
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
 async function signin(target,user){lastPage=target;target.setDefaultTimeout(18000);await target.goto(origin+'/');await target.locator('#yourrest-email').waitFor();await target.locator('#yourrest-email').fill(user);
  const pending=target.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/request'&&r.request().method()==='POST');await target.getByRole('button',{name:/^(إرسال رمز الدخول|Send sign-in code)$/}).click();eq((await pending).status(),200,'OTP request '+user);await target.locator('#yourrest-code').waitFor();
  const delivered=(await readFile(capture,'utf8')).trim().split('\n').map(JSON.parse).filter(row=>row.to===user+'@yourrest.org').at(-1);ok(delivered,'Mock email '+user);const mail=Buffer.from(delivered.message.split('\r\n\r\n')[1].replaceAll('\r\n',''),'base64').toString('utf8'),code=mail.match(/\b\d{6}\b/)?.[0];ok(code,'Mock OTP '+user);await target.locator('#yourrest-code').fill(code);await target.getByRole('button',{name:/^(دخول|Sign in)$/}).click();await target.locator('.workspace').waitFor();await target.locator('.mobile-bottom-navigation').waitFor();
 }
 async function nav(target,id){lastPage=target;await target.evaluate(()=>document.activeElement instanceof HTMLElement&&document.activeElement.blur());const button=target.locator('.mobile-bottom-navigation [data-page='+id+']');if(await button.count())await button.click();else{await target.getByRole('button',{name:/^(المزيد من الصفحات|More pages)$/,exact:true}).click();await target.locator('.mobile-overflow-pages [data-page='+id+']').click();}await target.locator('.mobile-navigation-sheet').waitFor({state:'detached'});await target.locator('.page-heading').waitFor();}
 async function snapshot(target,label){
  await target.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await Promise.all([...document.querySelectorAll('[role=dialog],.competitors-workspace')].flatMap(el=>el.getAnimations({subtree:true})).map(animation=>animation.finished.catch(()=>{})));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  const layout=await target.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},clientWidth:document.documentElement.clientWidth,clientLeft:document.documentElement.clientLeft,overflow:document.documentElement.scrollWidth>innerWidth+1,language:document.documentElement.lang,tabs:[...document.querySelectorAll('.competitors-profile-tabs [role=tab]')].filter(el=>el.getClientRects().length).map(el=>({text:el.textContent,rect:el.getBoundingClientRect().toJSON(),container:el.parentElement.getBoundingClientRect().toJSON()})),panels:[...document.querySelectorAll('.competitors-workspace,.competitors-list,.competitors-detail,.customer-visit-dialog,.followup-record-dialog,.competitor-fields')].filter(el=>el.getClientRects().length).map(el=>({name:el.className,rect:el.getBoundingClientRect().toJSON()}))}));
  eq(layout.overflow,false,label+' no horizontal overflow');for(const panel of layout.panels)ok(panel.rect.left>=-1&&panel.rect.right<=layout.viewport.width+1,label+' '+panel.name+' stays horizontally in viewport');for(const tab of layout.tabs)ok(tab.rect.left>=tab.container.left-1&&tab.rect.right<=tab.container.right+1,label+' tab '+tab.text+' fits profile tab row');geometry.push({label,...layout});const filename=path.join(screenshots,label+'.png');await target.screenshot({path:filename,fullPage:false});saved.push(filename);
 }
 async function download(target,id){return target.evaluate(async id=>{const response=await fetch('/api/visit-files?id='+encodeURIComponent(id));return {status:response.status,mime:response.headers.get('content-type'),cache:response.headers.get('cache-control'),body:await response.text()};},id);}
 async function competitors(target){await nav(target,'competitors');await target.locator('.competitors-workspace').waitFor();}
 async function pick(target,name,option){await target.getByRole('combobox',{name,exact:true}).click();await (target.page?target.page():target).getByRole('option',{name:option,exact:true}).click();await (target.page?target.page():target).getByRole('option').first().waitFor({state:'hidden'});}



 const ctx=await context(),page=await firstPage(ctx);await signin(page,'rep1');
 eq(await page.locator('[data-page=competitors]').count(),0,'Representative has no management competitor page');
 let payload=await request(page,'/api/crm');eq(payload.status,200);
 eq(payload.data.records.filter(row=>row.kind==='activity'&&!row.data._readOnly).map(row=>row.id).sort(),['obs-hidden','obs-one'],'Representative receives only own observations');
 for(const id of ['quote-peer','quote-east'])eq((await download(page,id)).status,404,'Representative cannot download '+id);
 await nav(page,'activity');await page.getByRole('button',{name:'زيارة جديدة',exact:true}).click();
 let dialog=page.locator('.customer-visit-dialog');await dialog.waitFor();
 await pick(dialog,'نوع التواصل','اتصال');await dialog.locator('#visit-customer-search').fill('W101');await page.getByRole('option').filter({hasText:'مصنع الاختبار الأول'}).waitFor();await dialog.locator('#visit-customer-search').press('Enter');
 await pick(dialog,'اختر الهدف من الزيارة','تعريف بمنتجات الشركة');await pick(dialog,'نتيجة الزيارة','متابعة العميل');await dialog.getByRole('textbox',{name:/^الإجراء القادم/}).fill('مراجعة عرض المنافس التوضيحي');
 await dialog.locator('.visit-sales-details>summary').click();
 let fields=dialog.locator('.competitor-fields');await fields.getByRole('switch',{name:'يوجد منافس',exact:true}).click();
 let combo=fields.getByRole('combobox',{name:/^اسم المنافس/});await combo.click();
 const list=fields.getByRole('listbox',{name:'أسماء المنافسين السابقة',exact:true});await list.waitFor();
 eq(await list.getByRole('option').count(),1,'Suggestions contain only own previous competitor');
 ok((await list.innerText()).includes('مسجل لدى هذا العميل'),'Own customer competitor is prioritized');
 for(const hidden of ['منافس الزميل الخاص','منافس خارج الفريق','منافس خارج المنطقة','منافس شرقي خاص','منافس الإدارة'])eq((await list.innerText()).includes(hidden),false,'Private suggestion not leaked: '+hidden);
 await combo.press('ArrowDown');await combo.press('Enter');eq(await combo.inputValue(),'ألـفا للصناعة','Keyboard picks previous competitor');
 const speechText='عرض توضيحي: سعر المنافس أقل مع مدة تسليم أطول';await page.evaluate(text=>{window.__qaSpeech.text=text;},speechText);
 await fields.getByRole('button',{name:/^إدخال صوتي:/}).click();await page.waitForFunction(text=>document.querySelector('.competitor-fields textarea')?.value===text,speechText);
 eq(await fields.locator('textarea').inputValue(),speechText,'Mock speech becomes editable competitor notes');eq(await page.evaluate(()=>window.__qaSpeech.starts),1,'Dictation starts only after explicit user click');eq(await page.evaluate(()=>window.__qaSpeech.language),'ar-SA','Arabic dictation language');
 const uploadResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/visit-files'&&response.request().method()==='POST');
 await fields.locator('.competitor-file-input input').setInputFiles({name:'qa-competitor.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n% Synthetic local competitor evidence\n%%EOF')});
 const uploaded=await uploadResponse,upload=await uploaded.json();eq(uploaded.status(),200,'Actual optional PDF upload succeeds');ok(upload.id,'Private upload identifier returned');
 eq(await fields.locator('.competitor-file-current a').getAttribute('href'),'/api/visit-files?id='+upload.id,'Uploaded evidence uses private download endpoint');
 await dialog.locator('.location-status').filter({hasText:'تم تحديد الموقع تلقائيًا'}).waitFor();await fields.scrollIntoViewIfNeeded();await snapshot(page,'competitor-visit-rep-mobile-ar');
 let pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/visits'&&response.request().method()==='POST');await dialog.getByRole('button',{name:'حفظ الزيارة',exact:true}).click();let response=await pending,result=await response.json();eq(response.status(),200,'Competitor visit saves: '+JSON.stringify(result));ok(result.id);const visitId=result.id;await dialog.waitFor({state:'detached'});
 let persisted=JSON.parse((await db.prepare('SELECT data FROM crm_records WHERE id=?').bind(visitId).first()).data);eq(persisted.competitorName,'ألـفا للصناعة');eq(persisted.competitorNotes,speechText);eq(persisted.competitorFileId,upload.id);eq(persisted.performedBy,'rep1','Authenticated representative owns observation');
 await page.reload();await page.locator('.workspace').waitFor();payload=await request(page,'/api/crm');ok(payload.data.records.some(row=>row.id===visitId&&row.data.competitorNotes===speechText),'Saved observation survives browser reload');eq((await download(page,upload.id)).status,200,'Representative reads own new evidence');
 // A follow-up records a fresh observation, without copying the previous file.
 await nav(page,'followup');await page.locator('.rep-record-card').filter({hasText:'مصنع الاختبار الأول'}).getByRole('button',{name:'تنفيذ المتابعة',exact:true}).click();dialog=page.locator('.followup-record-dialog');await dialog.waitFor();
 await pick(dialog,'نوع المتابعة','اتصال');await dialog.getByRole('textbox',{name:/^ما نتيجة المتابعة/}).fill('تحديث منافس من متابعة توضيحية');await dialog.getByRole('textbox',{name:/^الإجراء القادم/}).fill('مراجعة عرض جديد');
 fields=dialog.locator('.competitor-fields');eq(await fields.getByRole('switch').getAttribute('aria-checked'),'false','Follow-up requires an explicit new competitor observation');await fields.getByRole('switch').click();combo=fields.getByRole('combobox',{name:/^اسم المنافس/});await combo.fill('منافس جديد من المتابعة');await combo.press('Tab');await fields.locator('textarea').fill('ملاحظة مستقلة بدون مرفق');eq(await fields.locator('.competitor-file-current').count(),0,'New follow-up does not silently copy old quotation file');await fields.scrollIntoViewIfNeeded();await snapshot(page,'competitor-followup-rep-mobile-ar');
 pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/customer-followups'&&response.request().method()==='POST');await dialog.getByRole('button',{name:'حفظ المتابعة',exact:true}).click();response=await pending;result=await response.json();eq(response.status(),200,'New competitor follow-up saves: '+JSON.stringify(result));await dialog.waitFor({state:'detached'});
 const followupId=result.id;ok(followupId);persisted=JSON.parse((await db.prepare('SELECT data FROM crm_records WHERE id=?').bind(followupId).first()).data);eq(persisted.competitorName,'منافس جديد من المتابعة');eq(persisted.competitorFileId||'','','Follow-up without upload persists no inherited file');

 await ctx.clearCookies();await signin(page,'manager');await competitors(page);
 const alpha=()=>page.locator('.competitors-item').filter({hasText:/ألـفا للصناعة|الفا للصناعة/});
 eq(await alpha().count(),1,'Spelling variants merge into a single management profile');await alpha().click();await page.locator('.competitors-detail').waitFor();
 const detail=()=>page.locator('.competitors-detail');const tab=async id=>{await page.locator('#competitor-tab-'+id).click();await page.locator('#competitor-panel-'+id).waitFor();};
 await page.locator('#competitor-tab-overview').waitFor();eq(await detail().getByRole('tab').count(),4,'Consolidated profile has four working tabs');ok((await detail().locator('.competitors-coverage').innerText()).includes('66.7%'),'Coverage counts two of three observed western customers');ok((await detail().locator('.competitors-coverage').innerText()).includes('ليس حصة سوقية'),'Coverage is not presented as market share');await snapshot(page,'competitor-profile-mobile-ar');
 await tab('customers');eq(await detail().locator('.competitors-customer-card').count(),2,'Customers tab deduplicates factories across observations');await snapshot(page,'competitor-customers-mobile-ar');
 await detail().locator('.competitors-customer-card').filter({hasText:'مصنع الاختبار الأول'}).getByRole('button',{name:'عرض سجل العميل',exact:true}).click();eq(await detail().locator('#competitor-history-customer').inputValue(),'west1','Customer history opens a filtered observations tab');eq(await detail().locator('.competitors-contact').count(),2,'Customer history contains original and new visit');
 await detail().locator('#competitor-history-customer').selectOption('');eq(await detail().locator('.competitors-contact').count(),3,'Full profile history includes authorized team observations');ok((await detail().locator('.competitors-contact').first().innerText()).includes(speechText),'Latest dictated observation is first');
 await tab('quotes');eq(await detail().locator('.competitors-quote-card').count(),2,'Quotes tab lists unique original and newly uploaded evidence');const visibleQuoteIds=await detail().locator('.competitors-attachment').evaluateAll(links=>links.map(link=>new URL(link.href).searchParams.get('id')));eq(visibleQuoteIds.slice().sort(),['quote-one',upload.id].sort());eq((await download(page,upload.id)).status,200,'Manager downloads team evidence');eq((await download(page,'quote-east')).status,404,'Manager denied out-of-region evidence');await snapshot(page,'competitor-quotes-mobile-ar');
 await tab('observations');eq(await detail().locator('.competitors-contact').count(),3);await snapshot(page,'competitor-observations-mobile-ar');
 // Searching a competitor does not shrink the observed-customer denominator.
 await page.locator('.competitors-back').click();await page.locator('#competitors-query').fill('الفا');await alpha().click();ok((await detail().locator('.competitors-coverage').innerText()).includes('66.7%'),'Text search preserves scoped coverage denominator');
 await page.locator('.competitors-back').click();await page.locator('#competitors-query').fill('');await page.locator('.competitors-scope>summary').click();
 eq(await page.locator('#competitors-region option').evaluateAll(options=>options.map(option=>option.value)),['','western'],'Region choices contain authorized observed regions only');
 await page.evaluate(()=>{window.__qaDateEvents=[];for(const type of ['pointerdown','pointerup','click','change','input','focusin','focusout'])document.addEventListener(type,event=>window.__qaDateEvents.push({type,id:event.target?.id,tag:event.target?.tagName,text:event.target?.textContent?.slice(0,80),className:event.target?.getAttribute?.('class'),card:!!event.target?.closest?.('.competitors-item'),x:event.clientX,y:event.clientY,rect:event.target?.getBoundingClientRect?.().toJSON(),navHidden:document.querySelector('.mobile-bottom-navigation')?.hidden,scrollY,cardRect:document.querySelector('.competitors-item')?.getBoundingClientRect().toJSON(),value:event.target?.value,selected:document.querySelector('.competitors-item[aria-pressed="true"]')?.textContent?.slice(0,80),profile:!!document.querySelector('.competitors-detail'),active:document.activeElement?.id,time:performance.now()}),true);});
 await page.locator('#competitors-from').fill('2026-09-20');await page.locator('#competitors-through').fill('2026-09-21');await page.waitForFunction(()=>document.querySelectorAll('.competitors-item').length===1&&document.querySelector('.competitors-item')?.textContent.includes('2026-09-21'));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await alpha().click();ok((await detail().locator('.competitors-coverage').innerText()).includes('100%'),'Date scope recomputes observed coverage');await tab('observations');eq(await detail().locator('.competitors-contact').count(),2,'Date filter applies to observations, not just summary');eq(await page.evaluate(()=>window.__qaDateEvents.filter(event=>event.type==='pointerdown'&&event.card).length),1,'Date-filtered profile opens on the first pointer click without blur/retry');eq(await page.evaluate(()=>window.__qaDateEvents.filter(event=>event.type==='click'&&event.card).length),1,'The first click is delivered to the date-filtered card');console.log('Date interaction success:',JSON.stringify(await page.evaluate(()=>window.__qaDateEvents)));
 await page.getByRole('button',{name:'مسح التصفية',exact:true}).click();await alpha().click();await page.setViewportSize({width:1280,height:900});await snapshot(page,'competitor-profile-desktop-ar');
 await page.locator('.topbar-tools .language-switch').click();await page.waitForFunction(()=>document.documentElement.lang==='en');ok((await page.locator('#competitor-tab-customers').innerText()).startsWith('Customers'),'Customer tab is translated');await snapshot(page,'competitor-profile-desktop-en');
 await page.setViewportSize({width:360,height:800});await page.locator('.competitors-detail-header').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));await snapshot(page,'competitor-profile-mobile-en');await tab('quotes');await snapshot(page,'competitor-quotes-mobile-en');
 // Supervisor receives own observations and subordinate reps, excluding manager,
 // unrelated representatives, administrators and another region.
 await ctx.clearCookies();await signin(page,'supervisor');await page.locator('.topbar-tools .language-switch').click();await page.waitForFunction(()=>document.documentElement.lang==='ar');await competitors(page);
 payload=await request(page,'/api/crm');const visible=payload.data.records.filter(row=>row.kind==='activity'&&!row.data._readOnly).map(row=>row.id).sort();
 eq(visible,['obs-hidden','obs-one','obs-peer-private','obs-super','obs-two',visitId,followupId].sort(),'Supervisor team projection remains exact after new entries');
 for(const hidden of ['منافس المدير','منافس خارج الفريق','منافس خارج المنطقة','منافس شرقي خاص','منافس الإدارة'])eq((await page.locator('.competitors-workspace').innerText()).includes(hidden),false,'Supervisor profile excludes '+hidden);
 await alpha().click();ok((await detail().locator('.competitors-coverage').innerText()).includes('100%'),'Supervisor coverage uses only two observed team customers');await tab('quotes');eq(await detail().locator('.competitors-quote-card').count(),2);eq((await download(page,upload.id)).status,200);eq((await download(page,'quote-east')).status,404);await snapshot(page,'competitor-supervisor-quotes-mobile-ar');
 eq(errors,[],'No uncaught browser errors');
 const report={ok:true,checks,firstClickDateFilterRegression:true,tabGeometryVerified:true,actualBuiltRelease:true,realAuthMockEmail:true,realSqlite:true,syntheticFixture:true,mockedDeviceLocation:true,mockedSpeechRecognition:true,realMicrophoneTested:false,productionDatabaseUsed:false,realEmailSent:false,physicalDeviceTested:false,deployedToNamecheap:false,features:['rep own-name suggestions','keyboard competitor selection','mocked editable dictation','actual private PDF upload','visit save/reload','fresh follow-up competitor','management consolidated profile','customer and unique quote tabs','observations timeline','scoped observed coverage','search-independent denominator','date and region filters','supervisor team boundaries','private file authorization','AR/EN 360px and 1280px'],geometry,screenshots:saved};
 if(process.env.YR_COMPETITOR_INTELLIGENCE_REPORT)await writeFile(path.resolve(process.env.YR_COMPETITOR_INTELLIGENCE_REPORT),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){console.error('Competitor intelligence browser workflow failed:',error.stack);if(lastPage){try{console.error('UI state:',await lastPage.locator('body').innerText());console.error('Date interaction:',JSON.stringify(await lastPage.evaluate(()=>({events:window.__qaDateEvents,active:document.activeElement?.outerHTML.slice(0,300)}))));await lastPage.screenshot({path:path.join(screenshots,'failure.png'),fullPage:false});}catch{}}if(log)console.error('Isolated server diagnostics:',log.replace(/[a-f0-9]{64}/gi,'[redacted]'));process.exitCode=1;}
finally{await browser?.close();if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}if(child&&child.exitCode===null){child.kill();await once(child,'exit');}db?.close();await rm(work,{recursive:true,force:true});}
