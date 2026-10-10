// Isolated UI test: real AppUpdate component/controller, mocked Android bridge and public release.
// No production cookies, CRM records, Android installation or physical-device collection are used.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const work=await mkdtemp(path.join(os.tmpdir(),'yourrest-update-browser-'));
const shots=process.env.YR_UPDATE_SCREENSHOT_DIR?path.resolve(process.env.YR_UPDATE_SCREENSHOT_DIR):path.join(root,'docs/app-update-screenshots');
const release={schemaVersion:1,packageName:'org.yourrest.crm',versionName:'1.0.10',versionCode:11,apkUrl:'https://crm.yourrest.org/downloads/yourrest-crm-android-v1.0.10-11.apk',sizeBytes:400000,sha256:'a'.repeat(64),certificateSha256:'b'.repeat(64),releaseNotes:{ar:['اختبار محلي فقط'],en:['Local fixture only']}};
let browser,server,checks=0;const errors=[],saved=[];
const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
try{
 await mkdir(shots,{recursive:true});
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import AppUpdate from './app/app-update';import {setLanguage,useLanguage} from './lib/i18n';import {appUpdateController,parseAppRelease} from './lib/app-update';window.__qa={controller:appUpdateController,parse:parseAppRelease};function Fixture(){const {language}=useLanguage();const en=language==='en';return <main><header><strong>Yourrest CRM</strong><button type="button" id="language" onClick={()=>setLanguage(en?'ar':'en')}>{en?'العربية':'English'}</button></header><small>{en?'Isolated test fixture — no customer data':'اختبار معزول — بدون بيانات عملاء'}</small><AppUpdate/><form onSubmit={e=>e.preventDefault()}><h2>{en?'Visit in progress':'تسجيل زيارة'}</h2><label>{en?'Customer':'العميل'}<input id="customer" defaultValue="عميل اختبار"/></label><label>{en?'Visit result':'نتيجة الزيارة'}<textarea id="draft" defaultValue=""/></label><button type="submit" className="btn primary">{en?'Save visit':'حفظ الزيارة'}</button></form></main>};createRoot(document.getElementById('root')).render(<Fixture/>);`;
 const output=await build({stdin:{contents:entry,resolveDir:root,sourcefile:'app-update-qa.tsx',loader:'tsx'},bundle:true,format:'iife',platform:'browser',jsx:'automatic',write:false,outfile:path.join(work,'bundle.js'),alias:{'@':root}});
 for(const file of output.outputFiles)await writeFile(file.path,file.contents);
 // Actual app global CSS is retained except build-only Tailwind imports/theme declaration.
 const globalCss=(await readFile(path.join(root,'app/globals.css'),'utf8')).replace(/^@import .*;\s*$/gm,'').replace(/@theme inline\{[^}]*\}/g,'');
 await writeFile(path.join(work,'global.css'),globalCss);
 const html='<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/bundle.css"><style>main{padding:14px;max-width:800px;margin:auto}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}header button{padding:7px 12px;background:var(--card);border:1px solid var(--border);border-radius:8px}main>small{display:block;font-size:11px;color:var(--muted-foreground);margin-bottom:15px}form{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;display:grid;gap:16px}form h2{font-size:18px}form label{display:grid;gap:6px}textarea{height:120px}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
 server=createServer(async(req,res)=>{try{if(req.url==='/api/app-update'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(release));return;}const asset={'/bundle.js':['bundle.js','application/javascript'],'/bundle.css':['bundle.css','text/css'],'/global.css':['global.css','text/css']}[req.url];res.writeHead(200,{'content-type':asset?asset[1]:'text/html'});res.end(asset?await readFile(path.join(work,asset[0])):html);}catch(e){res.writeHead(500);res.end('Fixture error');}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.YR_BROWSER_EXECUTABLE?{executablePath:process.env.YR_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox']});
 async function scenario(protocol=1,options={}){
  const ctx=await browser.newContext({viewport:{width:360,height:800},deviceScaleFactor:1,userAgent:protocol===-1?'Mozilla/5.0 Test Browser':'Mozilla/5.0 Android YourrestCRM-Android/1'});
  await ctx.route('https://**/*',route=>route.abort());
  await ctx.addInitScript(({protocol,options})=>{
   localStorage.setItem('qa-offline-outbox','[{"id":"unchanged-pending-visit"}]');localStorage.setItem('yr-language',options.language||'ar');
   window.__requests=[];window.__native={phase:options.phase||'available',installedVersionCode:10,installedVersionName:'1.0.9',availableVersionCode:11,availableVersionName:'1.0.10',downloadedBytes:0,totalBytes:400000,progress:0};
   window.__emit=patch=>{Object.assign(window.__native,patch);window.dispatchEvent(new CustomEvent('yourrest:app-update',{detail:{...window.__native}}));};
   window.__fail=false;
   if(protocol!==-1)window.__yourrestNative={...(protocol===1?{updateProtocol:1}:{}),request:async method=>{
    window.__requests.push(method);if(window.__fail)throw Error('Simulated native/network error');
    if(method==='status')return{appVersion:options.installedVersion||'1.0.9'};
    if(method==='downloadAppUpdate')window.__emit({phase:'downloading',progress:0});
    if(method==='installAppUpdate')window.__emit({phase:options.installPhase||'installing'});
    if(method==='checkAppUpdate')window.__emit({phase:options.checkPhase||'available',error:''});
    return{...window.__native};
   }};
   document.addEventListener('click',event=>{const anchor=event.target.closest?.('.app-update-actions a');if(anchor){event.preventDefault();window.__legacyUrl=anchor.href;}});
  },{protocol,options});
  const page=await ctx.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);await page.locator('#draft').waitFor();return{page,ctx};
 }
 async function actionDisabled(page,expected,message){/* The native bridge answers asynchronously after the click; wait for the state instead of racing it. */await page.waitForFunction(value=>document.querySelector('.app-update-actions button')?.disabled===value,expected,{timeout:5000}).catch(()=>{});check(await page.locator('.app-update-actions button').isDisabled(),expected,message);}
 async function shot(page,name){check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' fits 360px');const action=page.locator('.app-update-actions .btn');if(await action.count())check((await action.boundingBox()).height>=44,true,name+' touch target');const file=path.join(shots,name+'.png');await page.screenshot({path:file,fullPage:true});saved.push(file);}
 async function preserved(page){check(await page.locator('#draft').inputValue(),'زيارة لم تُحفظ بعد','Update leaves current form intact');check(await page.evaluate(()=>localStorage.getItem('qa-offline-outbox')),'[{"id":"unchanged-pending-visit"}]','Update leaves queued data intact');}
 const {page,ctx}=await scenario();await page.locator('.app-update-banner').waitFor();check(await page.locator('.app-update-banner').getAttribute('dir'),'rtl');
 await page.locator('#draft').fill('زيارة لم تُحفظ بعد');await shot(page,'update-available-mobile-ar');
 await page.getByRole('button',{name:'تحديث التطبيق',exact:true}).click();await page.getByRole('progressbar').waitFor();
 await page.evaluate(()=>window.__emit({phase:'downloading',progress:53,downloadedBytes:212000}));check(await page.getByRole('progressbar').getAttribute('value'),'53');await actionDisabled(page,true,'Action button state');await shot(page,'update-progress-mobile-ar');await preserved(page);
 await page.evaluate(()=>window.__emit({phase:'ready',progress:100,downloadedBytes:400000}));await page.getByRole('button',{name:'تثبيت التحديث',exact:true}).waitFor();
 await page.getByRole('button',{name:'تثبيت التحديث',exact:true}).click();await actionDisabled(page,true,'Action button state');await preserved(page);
 await page.evaluate(()=>window.__emit({phase:'cancelled'}));await page.getByRole('button',{name:'تثبيت التحديث',exact:true}).waitFor();await actionDisabled(page,false,'Cancellation can be retried');
 await page.evaluate(()=>window.__emit({phase:'permissionRequired'}));await shot(page,'update-permission-mobile-ar');
 await page.locator('#language').click();check(await page.locator('.app-update-banner').getAttribute('dir'),'ltr');await shot(page,'update-permission-mobile-en');
 await page.evaluate(()=>window.__emit({phase:'error',error:'simulated'}));await page.getByRole('button',{name:'Retry',exact:true}).waitFor();await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByRole('button',{name:'Update app',exact:true}).waitFor();check(await page.locator('.app-update-banner').count(),1,'Retry never claims completion');await preserved(page);
 await ctx.setOffline(true);await page.getByRole('status').filter({hasText:'reconnect'}).waitFor();await actionDisabled(page,true,'Action button state');await shot(page,'update-offline-mobile-en');
 await page.evaluate(()=>window.__emit({phase:'ready'}));check(await page.getByRole('button',{name:'Install update',exact:true}).isDisabled(),false,'Previously downloaded update remains installable offline');
 await ctx.setOffline(false);await page.evaluate(()=>window.__emit({phase:'upToDate',installedVersionCode:10}));check(await page.locator('.app-update-banner').count(),1,'Unchanged installed code cannot claim update success');
 await page.evaluate(()=>window.__emit({phase:'upToDate',installedVersionCode:11,installedVersionName:'1.0.10'}));await page.locator('.app-update-banner').waitFor({state:'detached'});await preserved(page);await ctx.close();
 const legacy=await scenario(0);await legacy.page.locator('.app-update-actions a').waitFor();check(await legacy.page.locator('.app-update-actions a').getAttribute('href'),release.apkUrl);await legacy.page.locator('#draft').fill('زيارة لم تُحفظ بعد');await legacy.page.getByRole('link',{name:'تحديث التطبيق',exact:true}).click();await legacy.page.getByRole('status').filter({hasText:/التنزيل|المتصفح/}).waitFor();check(await legacy.page.evaluate(()=>window.__legacyUrl),release.apkUrl);await preserved(legacy.page);await shot(legacy.page,'update-legacy-mobile-ar');
 const badUrls=['http://crm.yourrest.org/downloads/yourrest-crm-android-v1.0.10-11.apk','https://evil.test/downloads/yourrest-crm-android-v1.0.10-11.apk','https://crm.yourrest.org.evil.test/downloads/yourrest-crm-android-v1.0.10-11.apk','https://user@crm.yourrest.org/downloads/yourrest-crm-android-v1.0.10-11.apk',release.apkUrl+'?token=secret',release.apkUrl+'#hash','javascript:alert(1)','https://crm.yourrest.org/downloads/yourrest-crm-android.apk'];
 for(const apkUrl of badUrls)check(await legacy.page.evaluate(({release,apkUrl})=>{try{window.__qa.parse({...release,apkUrl});return false;}catch{return true;}},{release,apkUrl}),true,'Reject unsafe/unstable download URL');await legacy.ctx.close();
 const current=await scenario(0,{installedVersion:'1.0.10'});await current.page.waitForFunction(()=>window.__qa.controller().snapshot().phase==='upToDate');check(await current.page.locator('.app-update-banner').count(),0,'Updated legacy app is not asked to downgrade');await current.ctx.close();
 const web=await scenario(-1);check(await web.page.locator('.app-update-banner').count(),0,'Ordinary web browser has no APK update banner');check(await web.page.evaluate(()=>window.__requests),[],'Ordinary browser never calls native update bridge');await web.ctx.close();
 check(errors,[],'No browser execution errors');
 const result={ok:true,checks,viewport:{width:360,height:800},actualComponent:true,actualController:true,mockedAndroidBridge:true,physicalAndroidTested:false,productionDataUsed:false,screenshots:saved};await writeFile(path.join(shots,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(error.stack);process.exitCode=1;}
finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await rm(work,{recursive:true,force:true});}
