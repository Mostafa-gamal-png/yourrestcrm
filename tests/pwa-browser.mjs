// Real built app, isolated SQLite + mock sendmail, Chromium and local HTTPS.
// Install-prompt events and iOS/standalone platform flags are simulated; no device/store installation is claimed.
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
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),release=path.join(root,'dist/standalone');
const work=await mkdtemp(path.join(os.tmpdir(),'yourrest-pwa-browser-')),data=path.join(work,'data'),capture=path.join(work,'mail.jsonl');
const screenshots=process.env.YR_PWA_SCREENSHOT_DIR?path.resolve(process.env.YR_PWA_SCREENSHOT_DIR):path.join(work,'screenshots');
const contentShell=process.env.YR_BROWSER_CONTENT_SHELL==='1',shells=[];
let child,db,browser,proxy,log='',checks=0,networkDown=false;
// Playwright's setOffline reaches the page but not the service worker's own fetch() in this Chromium (proved 2026-10-31: offline,
// the worker still got "/" from the server). offline() also cuts the test's front server, as a phone without signal would.
async function offline(ctx,down){networkDown=down;await ctx.setOffline(down);}
const errors=[],saved=[];
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
 await db.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,active,target,created_at,region_scope) VALUES(?,?,?,?,?,?,1,0,?,?)').bind('owner','opaque-owner','ceo@yourrest.org','PWA test owner','admin','Main',new Date().toISOString(),'all').run();
 await db.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,active,target,created_at,region_scope) VALUES(?,?,?,?,?,?,1,0,?,?)').bind('rep','opaque-rep','rep@yourrest.org','PWA test rep','rep','Main',new Date().toISOString(),'western').run();
 await db.prepare('INSERT INTO crm_settings(id,owner_id) VALUES(?,?)').bind('company','opaque-owner').run();
 const sendmail=path.join(work,'sendmail.cjs');await writeFile(sendmail,'#!'+process.execPath+'\n'+`const fs=require('node:fs');let message='';process.stdin.on('data',b=>message+=b);process.stdin.on('end',()=>fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify({to:process.argv.at(-1),message})+'\\n',{mode:0o600}));`,{mode:0o700});
 const backend=await freePort(),tlsPort=await freePort(),origin='https://crm.yourrest.org:'+tlsPort,key=path.join(work,'key.pem'),cert=path.join(work,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
 child=spawn(process.execPath,['app.cjs'],{cwd:release,env:{PATH:process.env.PATH,NODE_ENV:'production',PORT:String(backend),HOST:'127.0.0.1',YR_APP_ORIGIN:origin,YR_AUTH_SECRET:randomBytes(32).toString('hex'),YR_DATABASE_PATH:filename,YR_OBJECTS_PATH:objects,YR_MAIL_TRANSPORT:'sendmail',YR_MAIL_FROM:'noreply@yourrest.org',YR_SENDMAIL_PATH:sendmail},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 proxy=createHttpsServer({key:await readFile(key),cert:await readFile(cert)},(incoming,outgoing)=>{
  if(networkDown){incoming.socket.destroy();return;}
  const forwarded=httpRequest({host:'127.0.0.1',port:backend,path:incoming.url,method:incoming.method,headers:{...incoming.headers,host:'crm.yourrest.org:'+tlsPort,'x-forwarded-proto':'https'}},response=>{outgoing.writeHead(response.statusCode,response.headers);response.pipe(outgoing);});
  forwarded.on('error',()=>{outgoing.writeHead(502);outgoing.end('Isolated backend is starting');});incoming.pipe(forwarded);
 });proxy.listen(tlsPort,'127.0.0.1');await once(proxy,'listening');
 browser=contentShell?{close:async()=>{for(const shell of shells){await shell.browser.close();shell.child.kill();}}}:await chromium.launch({headless:true,...(process.env.YR_BROWSER_EXECUTABLE?{executablePath:process.env.YR_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--ignore-certificate-errors','--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1']});
 async function firstPage(ctx){return contentShell?ctx.pages()[0]:await ctx.newPage();}
 async function context(options={}){
  let ctx;
  if(contentShell){
   const port=await freePort(),shellChild=spawn(process.env.YR_BROWSER_EXECUTABLE,['--no-sandbox','--single-process','--no-zygote','--in-process-gpu','--headless','--ozone-platform=headless','--disable-gpu','--use-gl=disabled','--ignore-certificate-errors','--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port,'about:blank'],{stdio:['ignore','ignore','pipe']});
   let diagnostics='';shellChild.stderr.on('data',b=>diagnostics=(diagnostics+b).slice(-8000));let ready=false;
   for(let n=0;n<100;n++){if(shellChild.exitCode!==null)throw Error('Chromium content shell exited: '+diagnostics);try{const status=await new Promise((resolve,reject)=>{const req=httpRequest({host:'127.0.0.1',port,path:'/json/version'},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});if(status===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
   if(!ready){shellChild.kill();throw Error('Chromium content shell debugging endpoint did not start: '+diagnostics);}
   const shellBrowser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:10000});shells.push({browser:shellBrowser,child:shellChild});ctx=shellBrowser.contexts()[0];
   if(options.geolocation)await ctx.setGeolocation(options.geolocation);if(options.permissions)await ctx.grantPermissions(options.permissions);
   if(options.userAgent){const session=await ctx.newCDPSession(ctx.pages()[0]);await session.send('Network.setUserAgentOverride',{userAgent:options.userAgent});}
   if(options.hasTouch){const session=await ctx.newCDPSession(ctx.pages()[0]);await session.send('Emulation.setTouchEmulationEnabled',{enabled:true});}
   ctx.on('page',target=>{void target.setViewportSize({width:360,height:800});});for(const target of ctx.pages())await target.setViewportSize({width:360,height:800});
  }else ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:360,height:800},deviceScaleFactor:1,...options});
  await ctx.route('https://tile.openstreetmap.org/**',route=>route.abort());
  await ctx.addInitScript(()=>window.addEventListener('beforeinstallprompt',event=>{if(!event.__testEvent){event.preventDefault();event.stopImmediatePropagation();}}));
  ctx.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));for(const target of ctx.pages())target.on('pageerror',error=>errors.push(error.message));
  return ctx;
 }
 const ctx=await context(),page=await firstPage(ctx);page.setDefaultTimeout(12000);
 let ready=false;for(let attempt=0;attempt<100;attempt++){if(child.exitCode!==null)throw Error('Release exited: '+log);try{const status=await new Promise((resolve,reject)=>{const req=httpRequest({host:'127.0.0.1',port:backend,path:'/login',headers:{host:'crm.yourrest.org:'+tlsPort,'x-forwarded-proto':'https'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});if(status===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert(ready,'Built app failed to start');checks++;
 await page.goto(origin+'/');await page.locator('#yourrest-email').waitFor();check(new URL(page.url()).pathname,'/login');check(await page.locator('.pwa-install').count(),0,'Install UI must not be shown before authentication');
 check(await page.evaluate(()=>navigator.serviceWorker.getRegistrations().then(rows=>rows.length)),0,'First anonymous page must not register the app worker');
 check(await page.evaluate(()=>typeof window.__yourrestInstall?.request),'function','Install bridge is available before authentication');
 await page.locator('#yourrest-email').fill('ceo');await page.getByRole('button',{name:'إرسال رمز الدخول',exact:true}).click();await page.locator('#yourrest-code').waitFor();
 const delivered=JSON.parse((await readFile(capture,'utf8')).trim().split('\n').at(-1));check(delivered.to,'ceo@yourrest.org');
 const mail=Buffer.from(delivered.message.split('\r\n\r\n')[1].replaceAll('\r\n',''),'base64').toString('utf8'),code=mail.match(/\b\d{6}\b/)?.[0];assert(code,'Mock OTP missing');checks++;
 await page.locator('#yourrest-code').fill(code);await page.getByRole('button',{name:'دخول',exact:true}).click();await page.locator('.pwa-install-card').waitFor();check(new URL(page.url()).pathname,'/');
 check(await page.locator('.pwa-install').getAttribute('dir'),'rtl');check(await page.getByRole('button',{name:'تنزيل التطبيق',exact:true}).count(),1);
 await page.evaluate(()=>new Promise(resolve=>{const started=Date.now();(async function poll(){const registration=await navigator.serviceWorker.getRegistration('/');if(registration?.active&&navigator.serviceWorker.controller||Date.now()-started>20000)resolve();else setTimeout(poll,100);})();}));checks++;
 check(await page.evaluate(()=>navigator.serviceWorker.getRegistration('/').then(r=>new URL(r.active.scriptURL).pathname)),'/sw.js');
 check(await page.evaluate(()=>navigator.serviceWorker.getRegistration('/').then(r=>r.scope)),origin+'/');
 async function noOverflow(target,label){check(await target.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,label+' has horizontal overflow');}
 async function shot(target,name){await noOverflow(target,name);const filename=path.join(screenshots,name+'.png');await target.screenshot({path:filename,fullPage:true});saved.push(filename);}
 await shot(page,'pwa-mobile-ar');
 await page.locator('.mobile-bottom-navigation').waitFor();check(await page.locator('.crm-desktop-navigation').count(),0,'Mobile does not mount a lateral sidebar');
 await page.getByRole('button',{name:'المزيد من الصفحات',exact:true}).click();await page.locator('.mobile-navigation-sheet').waitFor();check(await page.locator('.mobile-overflow-pages [data-page=team]').count(),1,'Admin can reach team permissions from the bottom sheet');await page.getByRole('button',{name:'إغلاق',exact:true}).click();

 await page.getByRole('button',{name:'تنزيل التطبيق',exact:true}).click();await page.getByRole('dialog').waitFor();check(await page.getByRole('dialog').getAttribute('dir'),'rtl');assert.match(await page.getByRole('dialog').innerText(),/افتح قائمة المتصفح/);checks++;await noOverflow(page,'Arabic install help');await page.getByRole('button',{name:'تمام',exact:true}).click();
 check(await page.locator('.pwa-install-dismiss,.pwa-install-link').count(),0,'The install card presents a single permanent install action');
 await page.reload();await page.locator('.pwa-install-action').waitFor();checks++;
 await page.getByRole('button',{name:'Switch to English',exact:true}).click();await page.locator('.pwa-install[dir="ltr"]').waitFor();check(await page.locator('.pwa-install').getAttribute('dir'),'ltr');check(await page.getByRole('button',{name:'Install app',exact:true}).count(),1);
 await shot(page,'pwa-mobile-en');
 await page.getByRole('button',{name:'Install app',exact:true}).click();await page.getByRole('dialog').waitFor();assert.match(await page.getByRole('dialog').innerText(),/Open your browser menu/);checks++;await noOverflow(page,'English install help');await page.getByRole('button',{name:'Got it',exact:true}).click();
 async function offer(outcome){return page.evaluate(outcome=>{window.__promptCalls=0;window.__choice=undefined;const event=new Event('beforeinstallprompt',{cancelable:true});Object.assign(event,{__testEvent:true,prompt:async()=>{window.__promptCalls++;window.__promptHadUserActivation=navigator.userActivation.isActive;if(outcome==='error')throw Error('Simulated browser rejection');},userChoice:outcome==='pending'?new Promise(resolve=>window.__choice=resolve):Promise.resolve({outcome})});window.dispatchEvent(event);return event.defaultPrevented;},outcome);}
 check(await offer('pending'),true,'App must prevent the default prompt before saving it');
 await page.getByRole('button',{name:'Install app',exact:true}).click();check(await page.getByRole('button',{name:'Install app',exact:true}).isDisabled(),true);await page.evaluate(()=>{const button=document.querySelector('.pwa-install-action');button.click();button.click();});check(await page.evaluate(()=>window.__promptCalls),1,'Double taps must not request a second native prompt');check(await page.evaluate(()=>window.__promptHadUserActivation),true,'Native prompt must run directly from the first user click');
 await page.evaluate(()=>window.__choice({outcome:'dismissed'}));await page.getByRole('button',{name:'Install app',exact:true}).waitFor();check(await page.locator('.pwa-install-card').count(),1,'Dismissed browser prompt should keep the banner usable');
 await page.getByRole('button',{name:'Install app',exact:true}).click();await page.getByRole('dialog').waitFor();check(await page.evaluate(()=>window.__promptCalls),1,'A consumed prompt must not be reused');await page.getByRole('button',{name:'Got it',exact:true}).click();
 await offer('error');await page.getByRole('button',{name:'Install app',exact:true}).click();await page.getByRole('dialog').waitFor();check(await page.locator('.pwa-install-action').isDisabled(),false,'Rejected native prompt must unlock the install button');await page.getByRole('button',{name:'Got it',exact:true}).click();
 await offer('accepted');await page.getByRole('button',{name:'Install app',exact:true}).click();await page.getByRole('status').filter({hasText:'Installation accepted'}).waitFor();check(await page.locator('.pwa-install-action').count(),1,'Acceptance does not falsely mark installation complete');
 await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));await page.locator('.pwa-install').waitFor({state:'detached'});checks++;
 const cookies=await ctx.cookies();assert(cookies.some(cookie=>cookie.name==='__Host-yourrest_session'&&cookie.secure&&cookie.httpOnly));checks++;
 const ios=await context({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',isMobile:true,hasTouch:true});await ios.addCookies(cookies);const iphone=await firstPage(ios);await iphone.goto(origin+'/');await iphone.locator('.pwa-install-card').waitFor();await iphone.getByRole('button',{name:'تنزيل التطبيق',exact:true}).click();await iphone.getByRole('dialog').waitFor();const iosText=await iphone.getByRole('dialog').innerText();assert.match(iosText,/Safari/);assert.match(iosText,/إضافة إلى الشاشة الرئيسية/);checks+=2;await shot(iphone,'pwa-mobile-ios-help');await ios.close();
 const standalone=await context();await standalone.addCookies(cookies);await standalone.addInitScript(()=>{const original=window.matchMedia.bind(window);window.matchMedia=query=>{const result=original(query);if(query==='(display-mode: standalone)')Object.defineProperty(result,'matches',{value:true});return result;};});const appWindow=await firstPage(standalone);await appWindow.goto(origin+'/');await appWindow.locator('.workspace').waitFor();await appWindow.waitForFunction(()=>!!navigator.serviceWorker.controller);check(await appWindow.locator('.pwa-install').count(),0,'Installed standalone window must not show an install banner');await standalone.close();
 // A separate signed-in rep verifies the compact navigation's real permission boundary.
 const rep=await context(),repPage=await firstPage(rep);
 // Representatives use the system only from the Android app (mandatory route tracking); the app is emulated for this page.
 await installNativeBridge(repPage,{memberId:'rep',regionScope:'western'});
 await repPage.goto(origin+'/');await repPage.locator('#yourrest-email').fill('rep');await repPage.getByRole('button',{name:'إرسال رمز الدخول',exact:true}).click();await repPage.locator('#yourrest-code').waitFor();
 const repMail=(await readFile(capture,'utf8')).trim().split('\n').map(JSON.parse).filter(row=>row.to==='rep@yourrest.org').at(-1);
 const repCode=Buffer.from(repMail.message.split('\r\n\r\n')[1].replaceAll('\r\n',''),'base64').toString('utf8').match(/\b\d{6}\b/)?.[0];assert(repCode,'Rep fixture OTP missing');checks++;
 await repPage.locator('#yourrest-code').fill(repCode);await repPage.getByRole('button',{name:'دخول',exact:true}).click();await repPage.locator('.workspace').waitFor();
 await repPage.goto(origin+'/');const repTabs=repPage.locator('.mobile-bottom-navigation');await repTabs.waitFor();
 check(await repTabs.locator('[data-page]').evaluateAll(items=>items.map(item=>item.dataset.page)),['customer','map','activity','followup','targets'],'Rep sees only the five authorized pages');
 check(await repPage.locator('.crm-desktop-navigation').count(),0,'Rep mobile has no mounted lateral navigation');
 for(const [id,title] of [['customer','العملاء'],['map','خريطة المصانع'],['activity','الزيارات'],['followup','المتابعات'],['targets','مستهدفي']]){
  await repTabs.locator('[data-page='+id+']').click();if(id==='map')await repPage.locator('.cm-shell').waitFor();else await repPage.locator('.page-heading h1').filter({hasText:title}).waitFor();check(await repTabs.locator('[aria-current=page]').getAttribute('data-page'),id,'Active mobile page '+id);await noOverflow(repPage,'Rep page '+id);
 }
 await repPage.getByRole('button',{name:'Switch to English',exact:true}).click();await repPage.waitForFunction(()=>document.documentElement.dir==='ltr');check(await repTabs.getAttribute('dir'),'ltr');check(await repTabs.locator('[data-page=targets]').innerText(),'My targets');await shot(repPage,'rep-mobile-en');
 await repPage.getByRole('button',{name:'التبديل إلى العربية',exact:true}).click();await shot(repPage,'rep-mobile-ar');
 await repTabs.locator('[data-page=customer]').click();await repPage.locator('.heading-actions').getByRole('button',{name:'إضافة عميل',exact:true}).click();
 const customerDialog=repPage.getByRole('dialog');await customerDialog.waitFor();check(await repTabs.isVisible(),false,'Customer form hides navigation behind it');
 const saveCustomer=customerDialog.locator('button[type=submit]');await saveCustomer.scrollIntoViewIfNeeded();check(await saveCustomer.isVisible(),true,'Customer form save remains reachable on mobile');await noOverflow(repPage,'Customer form');await customerDialog.getByRole('button',{name:'إلغاء',exact:true}).click();await repTabs.waitFor();
 await repPage.locator('.mobile-profile-trigger').click();await repPage.locator('.mobile-navigation-sheet').waitFor();check(await repPage.locator('.mobile-overflow-pages').count(),0,'Rep account sheet does not reveal management pages');check(await repPage.locator('.mobile-account-signout button').count(),1,'Rep can sign out from the bottom account sheet');await repPage.getByRole('button',{name:'إغلاق',exact:true}).click();
 await rep.close();
 await page.setViewportSize({width:1365,height:900});await page.reload();await page.locator('.pwa-install-card').waitFor();await noOverflow(page,'Desktop install banner');check(await page.locator('.mobile-bottom-navigation').count(),0,'Desktop has no bottom navigation');check(await page.locator('.crm-desktop-navigation').isVisible(),true,'Desktop keeps its sidebar');
 const publicAssets=await page.evaluate(async()=>{const result=[];for(const name of await caches.keys())for(const request of await(await caches.open(name)).keys())result.push(new URL(request.url).pathname);return result;});
 assert(publicAssets.includes('/offline-app.html')&&publicAssets.includes('/offline-shell-manifest.json'));checks++;
 check(publicAssets.some(url=>url==='/'||url==='/login'||url.startsWith('/api/')||url.startsWith('/files/')),false,'Worker stores public shell assets, never private HTML or API responses');
 await offline(ctx,true);await page.goto(origin+'/');await page.locator('.workspace').waitFor();check(await page.evaluate(()=>!!document.getElementById('yourrest-offline-app')),true,'Cold offline navigation uses the data-free client shell');check(await page.evaluate(()=>fetch('/api/crm').then(()=>false,()=>true)),true,'Offline API requests must not be turned into successful cached responses');
 await offline(ctx,false);await page.reload();await page.locator('.pwa-install-card').waitFor();check(new URL(page.url()).pathname,'/');
 check(errors,[],'Unexpected browser page errors');
 console.log(JSON.stringify({ok:true,checks,browser:contentShell?'Chromium content shell 150':'Chromium',actual_built_release:true,real_https_service_worker:true,real_auth_with_mock_mail:true,simulated_install_events:true,simulated_ios_user_agent:true,actual_device_installation_tested:false,production_data_used:false,...(process.env.YR_PWA_SCREENSHOT_DIR?{screenshots:saved}:{})}));
}catch(error){console.error('PWA browser test failed:',error.stack);if(log)console.error('Server diagnostics:',log.replace(/[a-f0-9]{64}/gi,'[redacted]'));process.exitCode=1;}
finally{await browser?.close();if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}if(child&&child.exitCode===null){child.kill();await once(child,'exit');}db?.close();await rm(work,{recursive:true,force:true});}
