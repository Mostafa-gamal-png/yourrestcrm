// Item 8 of the GSCO comparison list (the owner, 2026-11-16: «مبيعات اليوم قصاد مستهدف اليوم، وميعاد إعادة تواصل مع الفرصة الخسرانة، واستيراد
// المستهدفات والمتابعات من قوالب Excel») in a real Chromium against the BUILT release (run the build first). Synthetic data only: temporary SQLite,
// mocked sendmail. The representative works from the Android app (its emulator, scripts/lib/native-bridge.mjs).
// - «نتائج الأداء» of the sales manager: the card «مبيعات اليوم قصاد مستهدف اليوم» for the whole team and for one person picked above it;
// - the representative's «أهدافي»: the same card for themselves;
// - the representative records a lost follow-up with a re-contact date in the follow-up form (a phone of 360 px, Arabic), and the follow-ups
//   page shows the line «قادمة» with «إعادة تواصل»;
// - «استيراد المستهدفات من Excel» (the sales manager, a computer): the template downloaded, a file uploaded, the preview (a refused row with
//   its reason), the import; «استيراد المتابعات من Excel» opens for the representative;
// at phones of 320 and 360 px, a tablet upright and on its side and a computer, in Arabic and English (no Arabic left but names); nothing scrolls
// sideways; screenshots of each new screen (YR_GATE_SCREENSHOT_DIR, else a temporary folder named in the output).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {installNativeBridge} from '../scripts/lib/native-bridge.mjs';

const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const screenshots=process.env.YR_GATE_SCREENSHOT_DIR?path.resolve(process.env.YR_GATE_SCREENSHOT_DIR):fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-item8-shots-'));
fs.mkdirSync(screenshots,{recursive:true});
const root=process.cwd();fs.mkdirSync(path.join(root,'.sites-runtime'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'.sites-runtime','item8-browser-'));process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'xlsx-write.mjs'),ts.transpileModule(fs.readFileSync(path.join(root,'lib/xlsx-write.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const X=await import(pathToFileURL(path.join(out,'xlsx-write.mjs')));
const members=[{id:'owner',role:'admin',name:'مدير النظام'},{id:'sm',role:'manager',name:'مدير المبيعات'},{id:'sup',role:'supervisor',sup:'sm',name:'المشرف سالم'},{id:'rep1',role:'rep',sup:'sup',name:'المندوب أحمد'},{id:'rep2',role:'rep',sup:'sup',name:'المندوب خالد'}];
const SIZES={phone320:{width:320,height:640},phone360:{width:360,height:800},tabletUp:{width:768,height:1024},tabletSide:{width:1024,height:768},desktop:{width:1366,height:900}};
let checks=0,browser,app;const errors=[];
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
// Names and what a person typed stay as they were written (the customer, the follow-up's result and its re-contact action).
const names=new Set([...members.map(m=>m.name),'الرئيسي','مصنع الأمل','مصنع النور','الدمام','الشرقية','اتصال بعد العرض الجديد','العميل اختار منافسًا هذه المرة']);
const arabicLeft=text=>text.split('\n').map(line=>line.trim()).filter(line=>/[؀-ۿ]/.test(line)).filter(line=>!line.split(/[·،,()|:←\t]| - /).map(part=>part.trim()).filter(Boolean).every(part=>names.has(part)||!/[؀-ۿ]/.test(part)));
const flat=text=>text.replace(/\s+/g,' ').trim();
const TODAY=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date()),MONTH=TODAY.slice(0,7);
const addDays=(day,n)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const friday=new Date(TODAY+'T12:00:00Z').getUTCDay()===5;

try{
 app=await bootBuiltApp({members},{tls:true});
 const stamp='2025-01-01T00:00:00.000Z',insert=(id,kind,parent,assigned,data,created=stamp)=>app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').bind(id,kind,parent,assigned,'الرئيسي',JSON.stringify(data),created,created).run();
 await insert('c1','customer',null,'rep1',{name:'مصنع الأمل',region:'الشرقية',city:'الدمام'});await insert('c2','customer',null,'rep2',{name:'مصنع النور',region:'الشرقية',city:'الخبر'});
 await insert('v1','activity','c1','rep1',{visitWorkflow:'customer-v1',type:'visit',date:addDays(TODAY,-3),summary:'زيارة',result:'العميل مهتم',performedBy:'rep1',responsibleId:'rep1',recordedByEmail:'rep1@yourrest.org',salesStage:'quoted',nextAction:'اتصال للتأكيد',nextDate:addDays(TODAY,-1)},addDays(TODAY,-3)+'T08:00:00.000Z');
 // Targets of the month: 26 a working day for each product of rep1 at most, and the sales of today.
 const products=['قوالب البلوك المتحركة','قوالب البلوك الثابتة','لمامة البلوك','ماكينة إنتاج البلوكة المتحركة','قطع غيار المكائن المتحركة','خلاطات البلوك','خلاطات الخرسانة الجاهزة','خدمات صيانة'];
 const days=[...Array(new Date(Date.UTC(Number(MONTH.slice(0,4)),Number(MONTH.slice(5)),0)).getUTCDate())].map((_,i)=>MONTH+'-'+String(i+1).padStart(2,'0')).filter(d=>new Date(d+'T00:00:00Z').getUTCDay()!==5).length;
 const target=(rep,first)=>app.db.prepare("INSERT INTO crm_target_sets(kind,scope_id,month,data,version,mutation_id,updated_by,updated_at) VALUES('sales',?,?,?,1,'seed','owner',?)").bind(rep,MONTH,JSON.stringify({products:products.map((product,i)=>({product,quantity:i===0?first:i===1?0:null}))}),stamp).run();
 await target('rep1',days*10);await target('rep2',days*4);
 let n=0;const sale=async(rep,customer,qty)=>{n++;await app.db.prepare("INSERT INTO crm_sales(id,customer_id,rep_id,branch,date,reference,reference_key,data,total_cents,status,void_reason,version,mutation_id,create_fingerprint,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'confirmed','',1,?,?,?,?,?)").bind('s'+n,customer,rep,'الرئيسي',TODAY,'REF-'+n,'ref-'+n,JSON.stringify({customerId:customer,repId:rep,date:TODAY,reference:'REF-'+n,items:[{product:products[0],quantity:qty,unitPrice:10,description:''}],discount:0,notes:''}),qty*1000,'m'+n,'f'+n,'owner',stamp,stamp).run();};
 await sale('rep1','c1',8);await sale('rep2','c2',2);
 browser=await chromium.launch({headless:true,...(process.env.YR_BROWSER_EXECUTABLE?{executablePath:process.env.YR_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--ignore-certificate-errors','--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1','--disable-dev-shm-usage']});
 async function open(who,url,{viewport,english}){
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport,deviceScaleFactor:1,reducedMotion:'reduce',serviceWorkers:'block',hasTouch:viewport.width<1100,isMobile:viewport.width<500,acceptDownloads:true});
  const [name,...value]=(await app.login(who)).split('=');
  await context.addCookies([{name,value:value.join('='),url:app.origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
  await context.addInitScript(lang=>{try{localStorage.setItem('yr-language',lang);}catch{/* storage unavailable */}},english?'en':'ar');
  const page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(who+': '+error.message));
  if(members.find(m=>m.id===who).role==='rep')await installNativeBridge(page,{memberId:who,regionScope:'all'});
  await page.goto(app.origin+url);await page.waitForFunction(lang=>document.documentElement.lang===lang,english?'en':'ar');
  return page;
 }
 const noSideways=async(page,label)=>check(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,label+': no sideways scrolling');
 const shot=async(page,box,name)=>{await box.evaluate(element=>element.scrollIntoView({block:'center'}));await page.waitForTimeout(300);await page.screenshot({path:path.join(screenshots,name+'.png')});};
 const T={ar:{title:'مبيعات اليوم قصاد مستهدف اليوم',team:'الفريق بالكامل',sold:'مبيعات اليوم',target:'مستهدف اليوم',badge:'إعادة تواصل',import:'استيراد المتابعات من Excel'},en:{title:'Today\'s sales against today\'s target',team:'The whole team',sold:'Today\'s sales',target:'Today\'s target',badge:'Re-contact',import:'Import follow-ups from Excel'}};

 // ---- 1. The representative records a lost follow-up with a re-contact date (a phone, Arabic).
 {
  const page=await open('rep1','/#followup',{viewport:SIZES.phone360,english:false});
  const card=page.locator('.rep-record-card',{hasText:'مصنع الأمل'});await card.waitFor();
  await card.getByRole('button',{name:'تنفيذ المتابعة'}).click();
  const dialog=page.locator('.followup-record-dialog');await dialog.waitFor();
  const pick=async(label,option)=>{const trigger=dialog.locator('[aria-label="'+label+'"]');await trigger.evaluate(element=>element.scrollIntoView({block:'center'}));await trigger.click();const box=page.getByRole('listbox');await box.waitFor();await box.getByRole('option',{name:option,exact:true}).press('Enter');await box.waitFor({state:'detached'});check(flat(await trigger.innerText()),option,'chose «'+option+'»');};
  await pick('نوع المتابعة','اتصال');
  await dialog.locator('label.voice-field',{hasText:'ما نتيجة المتابعة؟'}).locator('textarea').fill('العميل اختار منافسًا هذه المرة');
  const details=dialog.locator('details.visit-sales-details');if(!await details.evaluate(el=>el.open))await details.locator('summary').click();
  // A quotation exists (stage «عرض سعر»): the invoice outcome «لا، فُقد عرض السعر» makes the stage lost.
  const outcome=dialog.locator('[aria-label="هل تحوّل عرض السعر إلى فاتورة؟"]');
  if(await outcome.count())await pick('هل تحوّل عرض السعر إلى فاتورة؟','لا، فُقد عرض السعر');else await pick('مرحلة البيع بعد المتابعة','تم الفقد');
  await pick('اختر سبب الفقد','السعر أعلى من المنافس');
  const recontact=dialog.locator('[data-recontact]');await recontact.waitFor();
  ok(flat(await recontact.innerText()).includes('إعادة التواصل (اختياري)'),'the re-contact fields under the loss reason');
  await recontact.locator('label.voice-field').locator('input').fill('اتصال بعد العرض الجديد');
  await recontact.locator('[data-recontact-date]').fill(addDays(TODAY,7));
  await noSideways(page,'phone360 ar follow-up form');await shot(page,recontact,'recontact-form-phone360-ar');
  await dialog.getByRole('button',{name:'حفظ المتابعة'}).click();await dialog.waitFor({state:'detached'});
  const saved=await app.db.prepare("SELECT data FROM crm_records WHERE parent_id='c1' AND json_extract(data,'$.visitWorkflow')='followup-v1'").first();
  const data=JSON.parse(saved.data);check([data.salesStage,data.recontact,data.nextDate,data.nextAction],['lost',true,addDays(TODAY,7),'اتصال بعد العرض الجديد'],'saved with its re-contact');
  await page.context().close();
 }

 // ---- 2. Every size and language: the hub card, «أهدافي», the follow-ups line, the import dialogs.
 for(const [size,viewport,langs] of [['phone320',SIZES.phone320,['ar','en']],['phone360',SIZES.phone360,['ar','en']],['tabletUp',SIZES.tabletUp,['ar','en']],['tabletSide',SIZES.tabletSide,['ar','en']],['desktop',SIZES.desktop,['ar','en']]]){
  for(const lang of langs){
   const english=lang==='en',t=T[lang],label=size+' '+lang;
   // The sales manager's «نتائج الأداء».
   let page=await open('sm','/?tab=results#targets',{viewport,english});
   const card=page.locator('[data-day-sales]').first();await card.waitFor();
   let text=flat(await card.innerText());
   ok(text.includes(t.title)&&text.includes(t.team),label+': the team card: '+text.slice(0,120));
   const first=card.locator('.day-sales-product').first();
   check(flat(await first.locator('[data-day-sold]').innerText()),'10',label+': the team sold 10 today (8 + 2)');
   check(flat(await first.locator('[data-day-target]').innerText()),friday?'0':'14',label+': the team\'s target of today: (10 + 4) a working day');
   if(english)check(arabicLeft(await card.innerText()),[],label+': no Arabic left in the card');
   await noSideways(page,label+' hub');await shot(page,card,'today-sales-hub-'+size+'-'+lang);
   if(size==='desktop'){
    await page.locator('.targets-hub-toolbar [aria-label="'+(english?'Sales rep':'المندوب')+'"]').click();await page.getByRole('option',{name:'المندوب أحمد'}).click();
    await page.waitForFunction(()=>document.querySelector('[data-day-sales] .day-sales-heading strong')?.textContent==='المندوب أحمد');
    check([flat(await first.locator('[data-day-sold]').innerText()),flat(await first.locator('[data-day-target]').innerText())],['8',friday?'0':'10'],label+': rep1 alone: 8 of 10');
    await shot(page,card,'today-sales-hub-person-'+size+'-'+lang);
   }
   await page.context().close();
   // The representative's «أهدافي».
   page=await open('rep1','/#targets',{viewport,english});
   const own=page.locator('.my-targets [data-day-sales]');await own.waitFor();
   text=flat(await own.innerText());ok(text.includes(t.sold)&&text.includes(t.target),label+': «أهدافي» has the card');
   check([flat(await own.locator('.day-sales-product').first().locator('[data-day-sold]').innerText()),flat(await own.locator('.day-sales-product').first().locator('[data-day-target]').innerText())],['8',friday?'0':'10'],label+': their own 8 of 10');
   if(english)check(arabicLeft(await own.innerText()),[],label+': no Arabic left in «أهدافي»\'s card');
   await noSideways(page,label+' own');await shot(page,own,'today-sales-own-'+size+'-'+lang);
   // The follow-ups page: the line kept for the re-contact, under «القادمة».
   await page.goto(app.origin+'/?page=followup#followup');await page.waitForFunction(lang=>document.documentElement.lang===lang,english?'en':'ar');
   await page.getByRole('button',{name:english?'Upcoming':'القادمة'}).click();
   const line=page.locator(viewport.width<1024?'.rep-record-card':'.rep-desktop-records tr',{hasText:'مصنع الأمل'}).first();await line.waitFor();
   ok(flat(await line.innerText()).includes(t.badge),label+': «'+t.badge+'» on the line');
   if(english)check(arabicLeft(await line.innerText()),[],label+': no Arabic left on the line');
   await noSideways(page,label+' follow-ups');await shot(page,line,'recontact-line-'+size+'-'+lang);
   // «استيراد المتابعات من Excel».
   await page.locator('[data-record-import=followups]').click();
   const dialog=page.locator('[data-record-import-dialog=followups]');await dialog.waitFor();
   ok(flat(await dialog.innerText()).includes(t.import),label+': the follow-ups import dialog');
   if(english)check(arabicLeft(await dialog.innerText()),[],label+': no Arabic left in the dialog');
   await noSideways(page,label+' follow-ups import');await shot(page,dialog,'import-followups-'+size+'-'+lang);
   await page.context().close();
  }
 }

 // ---- 3. «استيراد المستهدفات من Excel» end to end (the sales manager, a computer and a phone, Arabic and English).
 for(const [size,viewport,lang] of [['desktop',SIZES.desktop,'ar'],['phone360',SIZES.phone360,'en'],['phone320',SIZES.phone320,'ar']]){
  const english=lang==='en',label=size+' '+lang;
  const page=await open('sm','/?tab=targets#targets',{viewport,english});
  await page.locator('[data-record-import=targets]').click();
  const dialog=page.locator('[data-record-import-dialog=targets]');await dialog.waitFor();
  const [download]=await Promise.all([page.waitForEvent('download'),dialog.locator('[data-record-import-template]').click()]);
  ok(/^Yourrest-targets-template-\d{4}-\d{2}\.xlsx$/.test(download.suggestedFilename()),label+': the template downloaded: '+download.suggestedFilename());
  const header=english?['Month','Member email','Member name','Molds for mobile block machines (Mold)','Actual visits']:['الشهر','البريد الإلكتروني للعضو','اسم العضو','قوالب البلوك المتحركة (قالب)','الزيارات الفعلية'];
  const value=size==='desktop'?'30':size==='phone360'?'31':'32';
  const file=Buffer.from(X.xlsxWorkbook({name:english?'Targets':'المستهدفات',rows:[header,[MONTH,'rep2@yourrest.org','',value,''],[MONTH,'rep9@yourrest.org','','1','']],headerRow:0}));
  await dialog.locator('[data-record-import-file]').setInputFiles({name:'targets.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:file});
  const summary=dialog.locator('[data-record-import-summary]');await summary.waitFor();
  check(await dialog.locator('tr[data-row-status=refused]').count(),1,label+': one refused row');
  ok(flat(await dialog.locator('tr[data-row-status=refused]').innerText()).includes(english?'No team member has this email':'لا يوجد عضو بهذا البريد في الفريق'),label+': with its reason');
  if(english)check(arabicLeft(await dialog.innerText()),[],label+': no Arabic left in the preview');
  await noSideways(page,label+' import preview');await shot(page,dialog,'import-targets-preview-'+size+'-'+lang);
  await dialog.locator('[data-record-import-save]').click();
  await dialog.locator('.record-import-done').waitFor();
  const saved=JSON.parse((await app.db.prepare("SELECT data FROM crm_target_sets WHERE kind='sales' AND scope_id='rep2' AND month=?").bind(MONTH).first()).data);
  check(saved.products[0].quantity,Number(value),label+': rep2\'s target imported');
  await shot(page,dialog,'import-targets-done-'+size+'-'+lang);
  // Closing the result reads the page again: the distribution table shows the imported number.
  await dialog.getByRole('button',{name:english?'Close':'إغلاق'}).first().click();await dialog.waitFor({state:'detached'});
  ok((await page.locator('.targets-workspace').innerText()).includes(value),label+': the targets table shows the imported '+value);
  await page.context().close();
 }
 check(errors,[],'no page errors');
 console.log(JSON.stringify({ok:true,checks,screenshots,syntheticFixtures:true,productionDataUsed:false}));
}finally{await browser?.close();await app?.stop();}
