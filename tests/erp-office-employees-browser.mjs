// «مبيعات مكتب (مستبعد)» in the three ERP imports, in a real Chromium against the BUILT release (run the build first). Synthetic data
// only: temporary SQLite, mocked sendmail, reports built here in the ERP's layouts.
// - «استيراد مبيعات ERP»: employee 6007 «نوفل بكر» asks for a representative; his select offers «مبيعات مكتب (مستبعد)» after the
//   representatives; chosen and the preview refreshed, his invoices are «مستبعدة» with the reason; the import saves it (the receipt says
//   so); the next dialog shows it saved, and a supervisor sees it locked with who may change it.
// - «استيراد عروض الأسعار من ERP»: the same employee listed with the mark, fixed («يُعدَّل من شاشة استيراد مبيعات ERP»), his quotation
//   excluded.
// - «استيراد كشف التحصيل من ERP»: his name shown as «مبيعات مكتب — مستبعد», fixed; another name offers the choice.
// - Desktop and phone 360, Arabic and English (no Arabic left but names and data); nothing scrolls sideways. Screenshots for the report
//   (YR_GATE_SCREENSHOT_DIR, else a temporary folder).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {zipSync,strToU8} from 'fflate';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {quotation,erpQuotesXls} from '../scripts/lib/erp-quotes-fixture.mjs';

const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const screenshots=process.env.YR_GATE_SCREENSHOT_DIR?path.resolve(process.env.YR_GATE_SCREENSHOT_DIR):fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-office-shots-'));
fs.mkdirSync(screenshots,{recursive:true});
const members=[
 {id:'owner',role:'admin',name:'مدير النظام',branch:'جدة'},{id:'sm',role:'manager',name:'مدير المبيعات',branch:'جدة'},{id:'sup',role:'supervisor',sup:'sm',name:'المشرف أحمد',branch:'جدة'},
 {id:'rep1',role:'rep',sup:'sup',name:'مندوب ألف',branch:'جدة'}
];
const VIEWPORTS={desktop:{width:1440,height:900},phone360:{width:360,height:800}};
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const HEADERS=['رقم الفاتورة','التاريخ','النوع','رقم الصنف','اسم الصنف','الفئة','الكمية','الوحدة','سعر الوحدة','الخصم','الإجمالي','القيمة المضافة','رقم العميل','اسم العميل','رقم الموظف','اسم الموظف'];
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),month=day.slice(0,7);
function salesReport(lines){
 const cells=l=>[l.reference,month+'-01','فاتورة مبيعات','M1','قالب','قوالب البلوك المتحركة','1','حبة','1000.00','0','1000.00','150.00','C1','مصنع الاختبار',l.employee,l.name];
 const row=values=>`<row>${values.map(v=>`<c t="str"><v>${escape(v)}</v></c>`).join('')}</row>`;
 return Buffer.from(zipSync({
  '[Content_Types].xml':strToU8('<?xml version="1.0"?><Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'),
  'xl/workbook.xml':strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels':strToU8('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
  'xl/worksheets/sheet1.xml':strToU8(`<worksheet><sheetData>${[HEADERS,...lines.map(cells)].map(row).join('')}</sheetData></worksheet>`),
 }));
}
const salesFile={name:'Sales.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:salesReport([{reference:'A1',employee:'7001',name:'مندوب ألف'},{reference:'N1',employee:'6007',name:'نوفل بكر'},{reference:'N2',employee:'6007',name:'نوفل بكر'}])};
const quotesFile={name:'Reports_Quotations.xls',mimeType:'application/vnd.ms-excel',buffer:erpQuotesXls([...quotation({code:'Qut-1',customerCode:'101',empCode:'6007',empName:'نوفل بكر',lines:[{name:'قالب',qty:1,price:1000}]}),...quotation({code:'Qut-2',customerCode:'101',empCode:'7001',empName:'مندوب ألف',lines:[{name:'قالب',qty:1,price:1000}]})])};
const CHEADERS=['رقم الحساب','اسم الحساب','المندوب','المحصل','الرصيد السابق مدين','الرصيد السابق دائن','حركة الفترة مدين','حركة الفترة دائن','الرصيد الحالي مدين','الرصيد الحالي دائن'];
const statementFile={name:'Account_Balance_Sheet.xls',mimeType:'application/vnd.ms-excel',buffer:Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from("<TABLE><TR><TD colspan='9'>كشف حساب لـ 1 _ 9</TD></TR><TR>"+CHEADERS.map(h=>'<Th>'+h+'</Th>').join('')+'</TR>'+[['1','مصنع 1','مندوب ألف','','0','0','1000','400','600','0'],['2','مصنع 2','نوفل بكر','','0','0','500','500','0','0'],['3','مصنع 3','ماجد حسن','','0','0','200','0','200','0']].map(r=>'<TR>'+r.map(v=>'<TD>'+v+'</TD>').join('')+'</TR>').join('')+'</TABLE>','utf16le')])};
let checks=0,browser,app;
const errors=[];
const check=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};
const names=new Set([...members.map(m=>m.name),'جدة','نوفل بكر','ماجد حسن','مصنع الاختبار','قالب']);
const arabicLeft=text=>text.split('\n').map(line=>line.trim()).filter(line=>/[؀-ۿ]/.test(line)).filter(line=>!line.split(/[·،,()|:←]| - /).map(part=>part.trim()).filter(Boolean).every(part=>names.has(part)||!/[؀-ۿ]/.test(part)));
try{
 app=await bootBuiltApp({members},{tls:true});
 const now=new Date().toISOString();
 await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('c101','customer',NULL,'rep1','جدة',?,?,?,1,'fixture')").bind(JSON.stringify({name:'مصنع الاختبار',code:'101',region:'الوسطى',assignedTo:'rep1',branch:'جدة'}),now,now).run();
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
 const shot=async(page,name,fullPage=false)=>{await page.waitForTimeout(250);await page.screenshot({path:path.join(screenshots,name+'.png'),fullPage});};
 const noSideways=async(page,name)=>check(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,name+': no sideways scrolling');
 const optionLabels=select=>select.locator('option').evaluateAll(options=>options.map(o=>o.textContent.trim()));

 for(const [size,viewport] of Object.entries(VIEWPORTS)){
  for(const english of [false,true]){
   const tag=size+'-'+(english?'en':'ar'),say=(ar,en)=>english?en:ar,firstRun=size==='desktop'&&!english;
   const OFFICE_LABEL=say('مبيعات مكتب (مستبعد)','Office sales (excluded)');
   // ---- the ERP sales import
   let page=await open('sm','sales',{viewport,english});
   await page.getByRole('button',{name:say('استيراد مبيعات ERP','Import ERP sales'),exact:true}).click();
   let dialog=page.locator('.erp-import-dialog');await dialog.locator('#erp-sales-report').waitFor();
   ok((await dialog.locator('.erp-import-office-note').innerText()).includes(OFFICE_LABEL),tag+': the note says how to exclude a person');
   await dialog.locator('#erp-sales-report').setInputFiles(salesFile);await dialog.locator('.erp-import-filename').waitFor();
   await dialog.getByRole('button',{name:say('قراءة التقرير ومعاينته','Read and preview report'),exact:true}).click();
   await dialog.locator('#erp-employee-mapping').waitFor();
   const row=dialog.locator('.erp-import-map-row',{hasText:'6007'}),select=row.locator('select');
   const labels=await optionLabels(select);
   check(labels.at(-1),OFFICE_LABEL,tag+': «مبيعات مكتب (مستبعد)» is the last option, after the representatives');
   if(firstRun){
    check(await select.inputValue(),'',tag+': 6007 starts unmapped');
    check(await row.getAttribute('data-problem'),'true',tag+': the unmapped employee is marked in red');
    ok((await dialog.locator('.erp-import-problems').innerText()).includes(say('موظفون بلا مندوب','Employees without a rep')),tag+': the red banner names it');
    check(await dialog.locator('.erp-import-ok').count(),0,tag+': no clean notice while it is unmapped');
    await dialog.locator('.erp-import-problems').scrollIntoViewIfNeeded();await shot(page,'sales-problems-'+tag);await row.scrollIntoViewIfNeeded();await shot(page,'sales-problem-row-'+tag);
    await select.selectOption({label:OFFICE_LABEL});
    ok((await row.innerText()).includes(say('مستبعد: لا تُحتسب مبيعاته لأي مندوب','Excluded: their sales count for no rep')),tag+': the row says what it does');
    await dialog.locator('.erp-import-footer').getByRole('button',{name:say('تحديث المعاينة','Refresh preview'),exact:true}).click();
    await dialog.locator('.erp-import-notice',{hasText:say('الربط تغير','Mappings changed')}).waitFor({state:'detached'});
    check(await row.getAttribute('data-problem'),null,tag+': marked as office sales, the row is no longer red');
    check([await dialog.locator('.erp-import-problems').count(),await dialog.locator('.erp-import-ok').count()],[0,1],tag+': no problem left, and the preview says so');
   }else{
    check(await select.inputValue(),'office:excluded',tag+': saved by the first import: shown selected');
    ok((await row.innerText()).includes(say('محدد «مبيعات مكتب» سابقًا','Saved as office sales')),tag+': and said to be saved');
   }
   const documents=size==='desktop'?dialog.locator('.erp-import-table tbody tr',{hasText:'نوفل بكر'}):dialog.locator('.erp-import-document-card',{hasText:'نوفل بكر'});
   check(await documents.count(),2,tag+': his two invoices');
   for(const text of await documents.allInnerTexts())ok(text.includes(say('مستبعدة','Excluded'))&&text.includes(say('مبيعات مكتب (تحديد الموظف)','Office sales (employee marked)')),tag+': excluded with the reason: '+text.replace(/\s+/g,' '));
   if(english)check(arabicLeft(await dialog.locator('#erp-employee-mapping').locator('..').innerText()),[],tag+': no Arabic left in the employee mapping');
   await row.scrollIntoViewIfNeeded();await noSideways(page,tag+' sales import');await shot(page,'sales-mapping-'+tag);
   await documents.first().scrollIntoViewIfNeeded();await shot(page,'sales-documents-'+tag);
   if(firstRun){
    await dialog.locator('.erp-import-footer').getByRole('button',{name:'تأكيد الاستيراد',exact:true}).click();
    await dialog.locator('.erp-import-success').waitFor();
    ok((await dialog.locator('.erp-import-success').innerText()).includes('حُفظ تحديد «مبيعات مكتب (مستبعد)»: 1'),tag+': the receipt says the mark was saved');
    await shot(page,'sales-receipt-'+tag);
   }
   await page.context().close();

   // ---- a supervisor (desktop): the saved mark locked
   if(size==='desktop'){
    page=await open('sup','sales',{viewport,english});
    await page.getByRole('button',{name:say('استيراد مبيعات ERP','Import ERP sales'),exact:true}).click();
    dialog=page.locator('.erp-import-dialog');await dialog.locator('#erp-sales-report').setInputFiles(salesFile);await dialog.locator('.erp-import-filename').waitFor();
    await dialog.getByRole('button',{name:say('قراءة التقرير ومعاينته','Read and preview report'),exact:true}).click();
    const locked=dialog.locator('.erp-import-map-row',{hasText:'6007'});await locked.waitFor();
    check([await locked.locator('select').inputValue(),await locked.locator('select').isDisabled()],['office:excluded',true],tag+': a supervisor sees the mark, locked');
    ok((await locked.innerText()).includes(say('تعديله لمدير المبيعات أو مدير النظام','The sales manager or system administrator can change it')),tag+': and who may change it');
    await locked.scrollIntoViewIfNeeded();await shot(page,'sales-supervisor-locked-'+tag);
    await page.context().close();
   }

   // ---- the ERP quotations import (the targets hub's «عروض الأسعار» tab)
   page=await open('sm','quotes',{viewport,english});
   await page.getByRole('button',{name:say('استيراد عروض الأسعار من ERP','Import quotations from ERP'),exact:true}).click();
   dialog=page.locator('.erp-quotes-import');await dialog.locator('#erp-quotes-report').setInputFiles(quotesFile);await dialog.locator('.erp-import-filename').waitFor();
   await dialog.getByRole('button',{name:say('قراءة الملف ومعاينته','Read and preview file'),exact:true}).click();
   const qrow=dialog.locator('.erp-import-map-row',{hasText:'6007'});await qrow.waitFor();
   check([await qrow.locator('select').inputValue(),await qrow.locator('select').isDisabled(),(await optionLabels(qrow.locator('select'))).at(-1)],['office:excluded',true,OFFICE_LABEL],tag+': quotations: listed with the mark, fixed');
   ok((await qrow.innerText()).includes(say('يُعدَّل هذا التحديد من شاشة استيراد مبيعات ERP','This is changed from the ERP sales import')),tag+': changed from the sales import');
   const qdoc=size==='desktop'?dialog.locator('.erp-import-table tbody tr',{hasText:'Qut-1'}).first():dialog.locator('.erp-import-document-card',{hasText:'Qut-1'}).first();
   ok((await qdoc.innerText()).includes(say('مستبعدة','Excluded')),tag+': his quotation excluded');
   if(english)check(arabicLeft(await qrow.innerText()),[],tag+': no Arabic left in his row');
   await qrow.scrollIntoViewIfNeeded();await noSideways(page,tag+' quotes import');await shot(page,'quotes-mapping-'+tag);
   await page.context().close();

   // ---- the collection statement
   page=await open('sm','collection',{viewport,english});
   await page.locator('.kpi-evidence-panel').waitFor();
   await page.getByRole('button',{name:say('استيراد كشف التحصيل من ERP','Import the ERP collection statement'),exact:true}).click();
   dialog=page.locator('.collections-import-dialog');await dialog.locator('#erp-collections-file').setInputFiles(statementFile);await dialog.locator('.erp-import-filename').waitFor();
   await dialog.getByRole('button',{name:say('قراءة الكشف ومعاينته','Read and preview the statement'),exact:true}).click();
   const crow=dialog.locator('.erp-import-map-row',{hasText:'نوفل بكر'});await crow.waitFor();
   check([await crow.locator('select').inputValue(),await crow.locator('select').isDisabled()],['office:excluded',true],tag+': collections: his name is office, fixed');
   ok((await crow.innerText()).includes(say('مبيعات مكتب — مستبعد','Office sales — excluded')),tag+': said so');
   const other=dialog.locator('.erp-import-map-row',{hasText:'ماجد حسن'});
   check([(await optionLabels(other.locator('select'))).at(-1),await other.locator('select').isDisabled()],[OFFICE_LABEL,false],tag+': another name offers the choice');
   await other.locator('select').selectOption({label:OFFICE_LABEL});
   ok((await other.innerText()).includes(say('حساباته تُعد من «مبيعات مكتب»','its accounts count as office sales')),tag+': the choice says what it does');
   if(english)check(arabicLeft(await dialog.locator('.erp-import-mappings').innerText()),[],tag+': no Arabic left in the names');
   await crow.scrollIntoViewIfNeeded();await noSideways(page,tag+' collections import');await shot(page,'collections-mapping-'+tag);
   await page.context().close();
  }
 }
 check(errors,[],'no page errors');
 console.log(JSON.stringify({ok:true,checks,screenshots,syntheticFixtures:true,productionDataUsed:false}));
}finally{await browser?.close();await app?.stop();}
