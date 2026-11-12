// The ERP sales import's «الملف يشمل كل مبيعات المناديب للفترة التي يغطيها» and the evaluation it makes automatic (2026-11-12), in a real
// Chromium against the BUILT release (run the build first). Synthetic data only: temporary SQLite, mocked sendmail, an ERP sales report
// built here as XLSX; the months are the real clock's (the evaluation month M is last month, the file runs from M-4 to M).
// - The import dialog: the tick is off by default; ticked, it shows the period (the file's first and last invoice, widened here to whole
//   months) and the months it completes; the receipt says what was recorded.
// - «تقييم الأداء» of M: «نمو مبيعات الأصناف», «العملاء المستردون» and «الحفاظ على العملاء الحاليين» are calculated automatically; a month
//   with no complete import names the months to upload (in English too); «بيانات المؤشرات» says the manual confirmation is no longer
//   needed; the customers-and-visits targets show «افتراضي» beside the defaults.
// - Desktop and phone 360, Arabic and English (no Arabic left but names and data); nothing scrolls sideways. Screenshots for the report
//   (YR_GATE_SCREENSHOT_DIR, else a temporary folder).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {zipSync,strToU8} from 'fflate';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const screenshots=process.env.YR_GATE_SCREENSHOT_DIR?path.resolve(process.env.YR_GATE_SCREENSHOT_DIR):fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-sales-coverage-shots-'));
fs.mkdirSync(screenshots,{recursive:true});
const members=[
 {id:'owner',role:'admin',name:'مدير النظام',branch:'جدة'},{id:'sm',role:'manager',name:'مدير المبيعات',branch:'جدة'},{id:'sup',role:'supervisor',sup:'sm',name:'المشرف أحمد',branch:'جدة'},
 {id:'rep1',role:'rep',sup:'sup',name:'مندوب ألف',branch:'جدة'},{id:'rep2',role:'rep',sup:'sup',name:'مندوب باء',branch:'جدة'}
];
const VIEWPORTS={desktop:{width:1440,height:900},phone360:{width:360,height:800}};
const riyadh=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}),current=riyadh.format(new Date()).slice(0,7);
const shift=n=>{const d=new Date(current+'-15T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);return d.toISOString().slice(0,7);};
const end=m=>m+'-'+String(new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5,7)),0)).getUTCDate()).padStart(2,'0');
const M=shift(-1),M1=shift(-2),M2=shift(-3),M4=shift(-5),EMPTY=shift(-8);
const AR=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'],EN=['January','February','March','April','May','June','July','August','September','October','November','December'];
const label=(m,en=false)=>(en?EN:AR)[Number(m.slice(5,7))-1]+' '+m.slice(0,4);
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const HEADERS=['رقم الفاتورة','التاريخ','النوع','رقم الصنف','اسم الصنف','الفئة','الكمية','الوحدة','سعر الوحدة','الخصم','الإجمالي','القيمة المضافة','رقم العميل','اسم العميل','رقم الموظف','اسم الموظف'];
const A='قوالب البلوك المتحركة';
function report(lines){
 const cells=l=>[l.reference,l.date,'فاتورة مبيعات','M1','قالب',A,String(l.quantity??1),'حبة','1000.00','0',(1000*(l.quantity??1)).toFixed(2),(150*(l.quantity??1)).toFixed(2),l.customer,'مصنع '+l.customer,l.employee||'E1',l.name||'مندوب ألف'];
 const row=values=>`<row>${values.map(v=>`<c t="str"><v>${escape(v)}</v></c>`).join('')}</row>`;
 return Buffer.from(zipSync({
  '[Content_Types].xml':strToU8('<?xml version="1.0"?><Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'),
  'xl/workbook.xml':strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels':strToU8('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
  'xl/worksheets/sheet1.xml':strToU8(`<worksheet><sheetData>${[HEADERS,...lines.map(cells)].map(row).join('')}</sheetData></worksheet>`),
 }));
}
const workbook=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-sales-coverage-file-')),'Sales.xlsx');
fs.writeFileSync(workbook,report([
 {reference:'S-OLD',date:M4+'-10',customer:'C-REC'},{reference:'S-RET1',date:M2+'-10',customer:'C-RET'},{reference:'S-LAP',date:M1+'-10',customer:'C-LAP',quantity:2},
 {reference:'S-REC',date:M+'-05',customer:'C-REC',quantity:3},{reference:'S-RET2',date:M+'-20',customer:'C-RET'},{reference:'S-B2',date:M+'-12',customer:'C-B',employee:'E2',name:'مندوب باء'}
]));
let checks=0,browser,app;
const errors=[];
const check=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};
const names=new Set([...members.map(m=>m.name),'جدة']);
const arabicLeft=text=>text.split('\n').map(line=>line.trim()).filter(line=>/[؀-ۿ]/.test(line)).filter(line=>!line.split(/[·،,()|:←]| - /).map(part=>part.trim()).filter(Boolean).every(part=>names.has(part)||!/[؀-ۿ]/.test(part)));
try{
 app=await bootBuiltApp({members},{tls:true});
 const owner=app.as(await app.login('owner')),P=(await owner('/api/sales/import')).json().products;
 check((await owner('/api/targets',{method:'POST',body:{kind:'weights',scopeId:'company',month:M,version:0,inheritedFrom:null,requestId:crypto.randomUUID(),data:{products:P.map((product,i)=>({product,weight:i<2?50:0}))}}})).status,200,'weights of '+M);
 browser=await chromium.launch({headless:true,...(process.env.YR_BROWSER_EXECUTABLE?{executablePath:process.env.YR_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--ignore-certificate-errors','--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1','--disable-dev-shm-usage']});
 async function open(who,tab,{viewport=VIEWPORTS.desktop,english=false}={}){
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport,deviceScaleFactor:1,reducedMotion:'reduce',serviceWorkers:'block',hasTouch:viewport.width<900,isMobile:viewport.width<500});
  const [name,...value]=(await app.login(who)).split('=');
  await context.addCookies([{name,value:value.join('='),url:app.origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
  if(english)await context.addInitScript(()=>{try{localStorage.setItem('yr-language','en');}catch{/* storage unavailable */}});
  const page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(who+': '+error.message));
  await page.goto(app.origin+'/?tab='+tab+'#targets');
  if(english)await page.waitForFunction(()=>document.documentElement.lang==='en');
  await page.locator('.targets-hub').waitFor();
  return page;
 }
 const shot=async(page,name,fullPage=true)=>{await page.waitForTimeout(250);await page.screenshot({path:path.join(screenshots,name+'.png'),fullPage});};
 const noSideways=async(page,name)=>check(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,name+': no sideways scrolling');
 const setMonth=async(page,month)=>{const waiting=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/sales'&&new URL(r.url()).searchParams.get('month')===month);await page.locator('.targets-hub-month input').fill(month);await waiting;await page.locator('.kpi-workspace').waitFor();};
 const person=async(page,name)=>{await page.locator('.kpi-workspace tr',{hasText:name}).locator('td').last().locator('button').click();await page.locator('.kpi-person-heading',{hasText:name}).waitFor();};
 const indicator=(page,text)=>page.locator('.kpi-indicator',{hasText:text}).first();

 for(const [size,viewport] of Object.entries(VIEWPORTS)){
  for(const english of [false,true]){
   const lang=english?'en':'ar',tag=size+'-'+lang,say=(ar,en)=>english?en:ar;
   // ---- the import dialog (the first run, desktop Arabic, commits; the others stop at the tick)
   let page=await open('owner','sales',{viewport,english});
   await page.getByRole('button',{name:say('استيراد مبيعات ERP','Import ERP sales'),exact:true}).click();
   const dialog=page.locator('.erp-import-dialog');await dialog.locator('#erp-sales-report').waitFor();
   await dialog.locator('#erp-sales-report').setInputFiles(workbook);await dialog.locator('.erp-import-filename').waitFor();
   await dialog.getByRole('button',{name:say('قراءة التقرير ومعاينته','Read and preview report'),exact:true}).click();
   const complete=dialog.locator('.erp-import-complete');await complete.waitFor();
   const tick=complete.locator('input[type=checkbox]');
   check(await tick.isChecked(),false,tag+': the tick is off by default');
   ok((await complete.innerText()).includes(say('الملف يشمل كل مبيعات المناديب للفترة التي يغطيها','The file includes all reps’ sales for the period it covers')),tag+': the tick says what it confirms');
   await tick.check();
   const from=complete.locator('input[type=date]').first(),to=complete.locator('input[type=date]').last();
   check([await from.inputValue(),await to.inputValue()],[M4+'-10',M+'-20'],tag+': the period starts as the file\'s first and last invoice');
   ok((await complete.innerText()).includes(label(M1,english)),tag+': the months it completes are named');
   await from.fill(M4+'-01');await to.fill(end(M));
   const text=await complete.innerText();
   ok(text.includes(label(M4,english))&&text.includes(label(M,english))&&!text.includes(say('أشهر جزئية','Partial months')),tag+': widened to whole months, nothing partial');
   if(english)check(arabicLeft(text),[],tag+': no Arabic left in the completeness section');
   await complete.scrollIntoViewIfNeeded();await noSideways(page,tag+' import');await shot(page,'import-complete-'+tag,false);
   if(size==='desktop'&&!english){
    const committed=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/sales/import'&&JSON.parse(r.request().postData()||'{}').action==='commit');
    await dialog.getByRole('button',{name:'تأكيد الاستيراد',exact:true}).click();const response=await committed;
    const sent=JSON.parse(response.request().postData());check([sent.completeSnapshot,sent.coverageFrom,sent.coverageTo],[true,M4+'-01',end(M)],'the commit carries the tick and the period');
    await dialog.locator('.erp-import-coverage-receipt').waitFor();ok((await dialog.locator('.erp-import-coverage-receipt').innerText()).includes(label(M2)),'the receipt names the months recorded');
    await shot(page,'import-receipt-'+tag,false);
   }
   await page.context().close();

   // ---- the evaluation of M: automatic
   page=await open('sm','results',{viewport,english});await setMonth(page,M);await person(page,'مندوب ألف');
   for(const [name,score] of [[say('الحفاظ على العملاء الحاليين','Customer retention'),'50'],[say('العملاء المستردون','Reactivated customers'),'20'],[say('نمو مبيعات الأصناف','Product sales growth'),'100']]){
    const box=indicator(page,name),body=await box.innerText();
    ok(body.includes(say('محسوب تلقائيًا','Calculated automatically'))&&body.includes(score+'%'),tag+': '+name+' calculated automatically ('+score+'%): '+body.replace(/\s+/g,' '));
   }
   const retention=indicator(page,say('الحفاظ على العملاء الحاليين','Customer retention'));await retention.locator('summary').click();
   ok((await retention.innerText()).includes(say('سجل المبيعات مكتمل تلقائيًا','The sales history is complete from complete ERP sales imports')),tag+': the calculation says the history came from the imports');
   const note=await page.locator('.kpi-workspace p.target-note.panel').last().innerText();ok(note.includes(say('افتراضي','Default')),tag+': the activity targets are marked as defaults');
   if(english)check(arabicLeft(await page.locator('.kpi-axes-grid').innerText()),[],tag+': no Arabic left in the indicators');
   await noSideways(page,tag+' evaluation');await shot(page,'evaluation-automatic-'+tag);
   // «بيانات المؤشرات»: the manual confirmation is no longer needed
   await page.locator('.kpi-evidence-actions button').first().click();const editor=page.locator('.kpi-evidence-dialog');await editor.locator('.kpi-evidence-coverage').waitFor();
   ok((await editor.locator('.kpi-evidence-coverage').getAttribute('class')).includes('is-complete'),tag+': the evidence editor shows the history complete');
   ok((await editor.locator('.kpi-evidence-coverage').innerText()).includes(say('لا يلزم التأكيد اليدوي','manual confirmation is not needed')),tag+': and that the manual confirmation is not needed');
   await editor.locator('.kpi-evidence-coverage').scrollIntoViewIfNeeded();await shot(page,'evidence-coverage-'+tag,false);
   await page.keyboard.press('Escape');await editor.waitFor({state:'detached'});
   // ---- a month with no complete import: the months to upload, named
   await setMonth(page,EMPTY);await page.locator('.kpi-person-heading',{hasText:'مندوب ألف'}).waitFor();// the person stays chosen
   const waiting=indicator(page,say('الحفاظ على العملاء الحاليين','Customer retention'));await waiting.locator('summary').click();
   const reason=await waiting.innerText(),expected=english?'Upload complete ERP sales for '+label(shift(-11),true):'يلزم رفع مبيعات ERP كاملة لأشهر '+label(shift(-11));
   ok(reason.includes(expected),tag+': the reason names the months: '+reason.replace(/\s+/g,' '));
   if(english)check(arabicLeft(reason),[],tag+': the English reason has no Arabic');
   await waiting.scrollIntoViewIfNeeded();await noSideways(page,tag+' waiting');await shot(page,'evaluation-waiting-'+tag,false);
   await page.context().close();

   // ---- the targets editor: «افتراضي» beside the default customers-and-visits targets
   page=await open('sm','targets',{viewport,english});
   // The table on a computer, the cards on a phone (app/targets-performance.css).
   const activity=viewport.width<900?page.locator('.target-card',{hasText:'مندوب باء'}).locator('.target-card-activity'):page.locator('.target-activity-panel');await activity.waitFor();
   check(await activity.locator('.target-default-tag:visible').count()>=3,true,tag+': «افتراضي» beside the default values');
   check((await activity.locator('.target-default-tag').first().innerText()).trim(),say('افتراضي','Default'),tag+': in the page\'s language');
   await activity.scrollIntoViewIfNeeded();
   await noSideways(page,tag+' targets');await shot(page,'targets-defaults-'+tag,false);
   await page.context().close();
  }
 }
 check(errors,[],'no page errors');
 console.log(JSON.stringify({ok:true,checks,screenshots,syntheticFixtures:true,productionDataUsed:false}));
}finally{await browser?.close();await app?.stop();}
