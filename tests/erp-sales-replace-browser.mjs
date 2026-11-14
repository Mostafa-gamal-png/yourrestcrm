// «دايمًا كامل» in a real Chromium against the BUILT release (run the build first): the ERP sales report uploaded again with corrections
// replaces what is saved for its period (the owner, 2026-11-14). Synthetic data only: temporary SQLite, mocked sendmail, ERP sales reports
// built here as XLSX; the month is the real clock's last month.
// - A phone of 360 px and a computer, Arabic and English: the preview's section «استبدال المحفوظ لفترة الملف» names the period and counts
//   the replaced, moved and removed invoices, lists the representative whose sales for the period become zero (his saved net → 0),
//   marks those documents with their own notice (never the red problem mark: no problem box), and keeps «تأكيد الاستيراد» off until the
//   agreement is ticked; the receipt says what was replaced. English shows no Arabic but names; nothing scrolls sideways.
// - Screenshots for the report (YR_GATE_SCREENSHOT_DIR when the gates give one, else a temporary folder printed at the end).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {zipSync,strToU8} from 'fflate';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const screenshots=process.env.YR_GATE_SCREENSHOT_DIR?path.resolve(process.env.YR_GATE_SCREENSHOT_DIR):fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-sales-replace-shots-'));
fs.mkdirSync(screenshots,{recursive:true});
const members=[
 {id:'owner',role:'admin',name:'مدير النظام',branch:'جدة'},{id:'sm',role:'manager',name:'مدير المبيعات',branch:'جدة'},{id:'sup',role:'supervisor',sup:'sm',name:'المشرف أحمد',branch:'جدة'},
 {id:'rep1',role:'rep',sup:'sup',name:'مندوب ألف',branch:'جدة'},{id:'rep2',role:'rep',sup:'sup',name:'مندوب باء',branch:'جدة'},{id:'rep3',role:'rep',sup:'sm',name:'مندوب جيم',branch:'جدة'}
];
const VIEWPORTS={phone360:{width:360,height:800},desktop:{width:1440,height:900}};
const riyadh=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}),current=riyadh.format(new Date()).slice(0,7);
const shift=n=>{const d=new Date(current+'-15T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);return d.toISOString().slice(0,7);};
const M=shift(-1),day=d=>M+'-'+String(d).padStart(2,'0');
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const HEADERS=['رقم الفاتورة','التاريخ','النوع','رقم الصنف','اسم الصنف','الفئة','الكمية','الوحدة','سعر الوحدة','الخصم','الإجمالي','القيمة المضافة','رقم العميل','اسم العميل','رقم الموظف','اسم الموظف','الوصف'];
const A='قوالب البلوك المتحركة';
function report(lines){
 const cells=l=>[l.reference,l.date,'فاتورة مبيعات','M1','قالب',A,'1','حبة',l.total.toFixed(2),'0',l.total.toFixed(2),'0',l.customer||'C1','مصنع '+(l.customer||'C1'),l.employee||'E1',l.name||'مندوب ألف',l.description||''];
 const row=values=>`<row>${values.map(v=>`<c t="str"><v>${escape(v)}</v></c>`).join('')}</row>`;
 return Buffer.from(zipSync({
  '[Content_Types].xml':strToU8('<?xml version="1.0"?><Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'),
  'xl/workbook.xml':strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels':strToU8('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
  'xl/worksheets/sheet1.xml':strToU8(`<worksheet><sheetData>${[HEADERS,...lines.map(cells)].map(row).join('')}</sheetData></worksheet>`),
 }));
}
const first=[
 {reference:'A-1',date:day(3),total:5000,description:'Qut-1'},{reference:'A-2',date:day(10),total:4000},{reference:'A-3',date:day(15),total:1000},
 {reference:'B-1',date:day(5),total:8000,customer:'C2',employee:'E2',name:'مندوب باء'},{reference:'B-2',date:day(12),total:2000,customer:'C2',employee:'E2',name:'مندوب باء'},
 {reference:'D-1',date:day(14),total:6000,customer:'C3',employee:'E3',name:'مندوب جيم'},
];
const corrected=[
 {reference:'A-1',date:day(3),total:5000,description:'Qut-7'},{reference:'A-3',date:day(15),total:1000},{reference:'A-2',date:day(10),total:4000,employee:'E2',name:'مندوب باء'},
 {reference:'B-1',date:day(5),total:7000,customer:'C2',employee:'E2',name:'مندوب باء'},{reference:'B-2',date:day(12),total:2000,customer:'C2',employee:'E2',name:'مندوب باء'},
];
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-sales-replace-file-')),workbook=path.join(folder,'Sales-corrected.xlsx');fs.writeFileSync(workbook,report(corrected));
let checks=0,browser,app;
const errors=[],saved=[];
const check=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};
const names=new Set([...members.map(m=>m.name),'جدة','مصنع C1','مصنع C2','مصنع C3']);
const arabicLeft=text=>text.split('\n').map(line=>line.trim()).filter(line=>/[؀-ۿ]/.test(line)).filter(line=>!line.split(/[·،,()|:←→]| - /).map(part=>part.trim()).filter(Boolean).every(part=>names.has(part)||!/[؀-ۿ]/.test(part)));
try{
 app=await bootBuiltApp({members},{tls:true});
 // The first export, imported as the page would (wholeCompany), over HTTP.
 const sm=app.as(await app.login('sm')),mappings=[{employeeId:'E1',repId:'rep1'},{employeeId:'E2',repId:'rep2'},{employeeId:'E3',repId:'rep3'}];
 const firstBody={action:'preview',fileName:'Sales.xlsx',base64:report(first).toString('base64'),employeeMappings:mappings,categoryMappings:[],allowSkipped:false,wholeCompany:true};
 const firstPreview=(await sm('/api/sales/import',{method:'POST',body:firstBody})).json();
 check((await sm('/api/sales/import',{method:'POST',body:{...firstBody,action:'commit',previewToken:firstPreview.previewToken,requestId:crypto.randomUUID()}})).status,200,'the first export imported');
 browser=await chromium.launch({headless:true,...(process.env.YR_BROWSER_EXECUTABLE?{executablePath:process.env.YR_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--ignore-certificate-errors','--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1','--disable-dev-shm-usage']});
 async function open(who,{viewport,english}){
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport,deviceScaleFactor:1,reducedMotion:'reduce',serviceWorkers:'block',hasTouch:viewport.width<900,isMobile:viewport.width<500});
  const [name,...value]=(await app.login(who)).split('=');
  await context.addCookies([{name,value:value.join('='),url:app.origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
  if(english)await context.addInitScript(()=>{try{localStorage.setItem('yr-language','en');}catch{/* storage unavailable */}});
  const page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(who+': '+error.message));
  await page.goto(app.origin+'/?tab=sales#targets');
  if(english)await page.waitForFunction(()=>document.documentElement.lang==='en');
  await page.locator('.targets-hub').waitFor();
  return page;
 }
 // What the person sees: the part scrolled into view, the screen as it is (an element taller than a phone is cut by the screen, as there).
 const shot=async(page,name,locator)=>{if(locator)await locator.evaluate(element=>element.scrollIntoView({block:'start'}));await page.waitForTimeout(250);const file=path.join(screenshots,name+'.png');await page.screenshot({path:file});saved.push(file);};
 const noSideways=async(page,name)=>check(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,name+': no sideways scrolling');
 for(const [size,viewport] of Object.entries(VIEWPORTS)){
  for(const english of [false,true]){
   const tag=size+'-'+(english?'en':'ar'),say=(ar,en)=>english?en:ar;
   const page=await open('sm',{viewport,english});
   await page.getByRole('button',{name:say('استيراد مبيعات ERP','Import ERP sales'),exact:true}).click();
   const dialog=page.locator('.erp-import-dialog');await dialog.locator('#erp-sales-report').waitFor();
   await dialog.locator('#erp-sales-report').setInputFiles(workbook);await dialog.locator('.erp-import-filename').waitFor();
   const answered=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/sales/import'&&r.request().method()==='POST');
   await dialog.getByRole('button',{name:say('قراءة التقرير ومعاينته','Read and preview report'),exact:true}).click();
   const sent=JSON.parse((await answered).request().postData());check([sent.action,sent.wholeCompany],['preview',true],tag+': the page asks for the whole-company replacement');
   const section=dialog.locator('.erp-import-replace');await section.waitFor();
   const text=await section.innerText();
   ok(text.includes(day(3)+' — '+day(15)),tag+': the period is named');
   check(await section.locator('.erp-import-replace-counts strong').allInnerTexts(),['1','1','1'],tag+': replaced, moved and removed counted');
   const zero=section.locator('.erp-import-zero-reps');ok((await zero.innerText()).includes('مندوب جيم')&&(await zero.innerText()).includes(say('6,000.00 ← 0.00','6,000.00 → 0.00')),tag+': the representative who ends at zero, from his saved net to zero');
   check(await dialog.locator('.erp-import-problems').count(),0,tag+': replacing is not a problem: no red box');
   check(await dialog.locator('[data-replace="true"][data-problem]').count(),0,tag+': the replaced documents carry no red mark');
   check(await dialog.locator((viewport.width<=640?'.erp-import-document-card':'.erp-import-table tbody tr')+'[data-replace="true"]').count(),3,tag+': three documents with the notice mark');
   const confirm=dialog.getByRole('button',{name:say('تأكيد الاستيراد','Confirm import'),exact:true});
   check(await confirm.isDisabled(),true,tag+': no commit before the agreement');
   if(english)check(arabicLeft(text),[],tag+': no Arabic left in the replacement section');
   await section.scrollIntoViewIfNeeded();await noSideways(page,tag+' preview');
   await shot(page,'replace-preview-'+tag,section);
   if(viewport.width<=640){const cards=dialog.locator('.erp-import-cards');await cards.scrollIntoViewIfNeeded();await shot(page,'replace-documents-'+tag,cards);}
   const agree=section.locator('.erp-import-replace-confirm input[type=checkbox]');await agree.check();
   check(await confirm.isEnabled(),true,tag+': the agreement enables the commit');
   if(size==='phone360'&&!english){
    const committed=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/sales/import'&&JSON.parse(r.request().postData()||'{}').action==='commit');
    await confirm.click();const response=await committed,body=JSON.parse(response.request().postData());
    check([response.status(),body.wholeCompany,body.replaceExisting],[200,true,true],tag+': the commit carries the flag and the agreement');
    const receipt=dialog.locator('.erp-import-replace-receipt');await receipt.waitFor();ok((await receipt.innerText()).includes(day(3)),tag+': the receipt says what was replaced');
    await noSideways(page,tag+' receipt');await shot(page,'replace-receipt-'+tag,dialog.locator('.erp-import-footer'));
    check((await app.db.prepare("SELECT count(*) AS n FROM crm_erp_sales WHERE reference='D-1'").first()).n,0,'the cancelled invoice is gone');
    // Undo the commit for the next runs: the first export again (its own preview replaces back).
    const back=(await sm('/api/sales/import',{method:'POST',body:firstBody})).json();
    check((await sm('/api/sales/import',{method:'POST',body:{...firstBody,action:'commit',previewToken:back.previewToken,requestId:crypto.randomUUID(),replaceExisting:true}})).status,200,'the first export imported back');
   }
   await page.context().close();
  }
 }
 // The supervisor's dialog: no replacement section (his import is as before).
 const page=await open('sup',{viewport:VIEWPORTS.phone360,english:false});
 await page.getByRole('button',{name:'استيراد مبيعات ERP',exact:true}).click();const dialog=page.locator('.erp-import-dialog');
 await dialog.locator('#erp-sales-report').setInputFiles(workbook);await dialog.locator('.erp-import-filename').waitFor();
 await dialog.getByRole('button',{name:'قراءة التقرير ومعاينته',exact:true}).click();await dialog.locator('#erp-preview-heading').waitFor();
 check(await dialog.locator('.erp-import-replace').count(),0,'a supervisor: no replacement section');
 ok(await dialog.locator('.erp-import-problems').count()>0,'his changed invoice is still a red problem');
 await noSideways(page,'supervisor');await shot(page,'supervisor-phone360-ar',dialog.locator('.erp-import-preview'));
 await page.context().close();
 check(errors,[],'no page errors');
 console.log(JSON.stringify({ok:true,checks,screenshots,saved:saved.map(file=>path.basename(file)),syntheticFixtures:true,productionDataUsed:false}));
}finally{await browser?.close();await app?.stop();fs.rmSync(folder,{recursive:true,force:true});}
