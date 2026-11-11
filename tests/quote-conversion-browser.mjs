// The hub's «عروض الأسعار» tab with the automatic «معدل تحويل عرض السعر إلى مبيعات» (2026-11-11), in a real Chromium against the BUILT
// release (run the build first). Synthetic data only: temporary SQLite, mocked sendmail, quotes and ERP sales invoices written as the
// CRM and the ERP imports write them (an invoice's «الوصف» numbers in data.quotationRefs); the month is the real clock's.
// - For each representative: the month's quotations, the converted ones, the rate, and under the row each converted quotation with the
//   invoice number(s) that converted it; a representative without quotations: «لا ينطبق».
// - «بيانات المؤشرات»: the quotations section says it holds optional extra links, and has no list confirmation any more.
// - Desktop and phone 360, Arabic and English (no Arabic left but names and data); nothing scrolls sideways. Screenshots for the report
//   (YR_GATE_SCREENSHOT_DIR, else a temporary folder).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const screenshots=process.env.YR_GATE_SCREENSHOT_DIR?path.resolve(process.env.YR_GATE_SCREENSHOT_DIR):fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-quote-conversion-shots-'));
fs.mkdirSync(screenshots,{recursive:true});
const members=[
 {id:'owner',role:'admin',name:'مدير النظام',branch:'جدة'},{id:'sm',role:'manager',name:'مدير المبيعات',branch:'جدة'},{id:'sup',role:'supervisor',sup:'sm',name:'المشرف أحمد',branch:'جدة'},
 {id:'rj1',role:'rep',sup:'sup',name:'مندوب جدة الأول',branch:'جدة'},{id:'rj2',role:'rep',sup:'sup',name:'مندوب جدة الثاني',branch:'جدة'},{id:'rd1',role:'rep',sup:'sm',name:'مندوب الدمام',branch:'الدمام'}
];
const VIEWPORTS={phone360:{width:360,height:800},desktop:{width:1440,height:900}};
const riyadh=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}),day=riyadh.format(new Date());
const product='قوالب البلوك المتحركة';
let checks=0,browser,app;
const errors=[];
const check=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};
const names=new Set([...members.map(m=>m.name),'جدة','الدمام','مصنع النور','مصنع الأمل']);
const arabicLeft=text=>text.split('\n').map(line=>line.trim()).filter(line=>/[؀-ۿ]/.test(line)).filter(line=>!line.split(/[·،,()|:←]| - | branch$/).map(part=>part.replace(/ branch$/,'').trim()).filter(Boolean).every(part=>names.has(part)||!/[؀-ۿ]/.test(part)));
try{
 app=await bootBuiltApp({members},{tls:true});
 const now=new Date().toISOString();
 const record=(id,kind,parent,assigned,branch,data)=>app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,1,?)').bind(id,kind,parent,assigned,branch,JSON.stringify(data),now,now,'fixture').run();
 await record('c1','customer',null,'rj1','جدة',{name:'مصنع النور',code:'C1',region:'الغربية',_createdBy:'rj1'});
 await record('c2','customer',null,'rj2','جدة',{name:'مصنع الأمل',code:'C2',region:'الغربية',_createdBy:'rj2'});
 const quote=(id,number,customer,rep,status='sent')=>record(id,'quote',customer,rep,'جدة',{performedBy:rep,number,date:day,validUntil:day,status,items:[{description:'قالب',quantity:1,price:1000}],discount:0,taxRate:15,terms:'',subtotal:1000,tax:150,total:1150});
 await quote('q101','Qut-101','c1','rj1');await quote('q102','Qut-102','c1','rj1','accepted');await quote('q103','Qut-103','c1','rj1','rejected');await quote('q201','Qut-201','c2','rj2');
 await app.db.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('imp','owner','f','sales.xlsx','{}',?)").bind(now).run();
 let n=0;
 for(const [rep,reference,refs,type,total] of [['rj1','INV-101',['Qut-101'],'sale',100000],['rj1','INV-102',['Qut-101','Qut-999'],'sale',50000],['rj1','INV-103',['Qut-102'],'sale',70000],['rj1','RET-104',['Qut-103'],'return',-30000],['rj2','INV-205',['Qut-103'],'sale',40000]]){
  n++;await app.db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'h','h',?,?,?,'e',?,'جدة','all','C1','مصنع النور',?,?,'imp','owner',?)")
   .bind('erp-'+n,'doc-'+n,reference,type,day,rep,JSON.stringify({items:[{product,description:'',quantity:type==='return'?-1:1,unitPrice:1000}],discount:0,notes:'',employeeId:'e',employeeName:'e',sourceLineCount:1,quotationRefs:refs}),total,now).run();
 }
 browser=await chromium.launch({headless:true,...(process.env.YR_BROWSER_EXECUTABLE?{executablePath:process.env.YR_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--ignore-certificate-errors','--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1','--disable-dev-shm-usage']});
 async function open(who,{viewport=VIEWPORTS.desktop,english=false}={}){
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport,deviceScaleFactor:1,reducedMotion:'reduce',serviceWorkers:'block',hasTouch:viewport.width<900,isMobile:viewport.width<500});
  const [name,...value]=(await app.login(who)).split('=');
  await context.addCookies([{name,value:value.join('='),url:app.origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
  if(english)await context.addInitScript(()=>{try{localStorage.setItem('yr-language','en');}catch{/* storage unavailable */}});
  const page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(who+': '+error.message));
  await page.goto(app.origin+'/?tab=quotes#targets');
  if(english)await page.waitForFunction(()=>document.documentElement.lang==='en');
  await page.locator('.targets-hub').waitFor();
  return page;
 }
 const shot=async(page,label,fullPage=true)=>{await page.waitForTimeout(250);await page.screenshot({path:path.join(screenshots,label+'.png'),fullPage});};
 const noSideways=async(page,label)=>check(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,label+': no sideways scrolling');
 const quotesTab=async(page,label)=>{await page.locator('.targets-hub-tabs [role=tab]',{hasText:label}).click();await page.waitForFunction(text=>document.querySelector('.targets-hub-tabs [aria-selected=true]')?.textContent?.trim()===text,label);await page.locator('.kpi-evidence-panel').waitFor();await page.locator('.kpi-evidence-panel tbody tr',{hasText:members[3].name}).first().waitFor();};
 const row=(page,name)=>page.locator('.kpi-evidence-panel tbody tr:not(.kpi-quote-conversions-row)',{hasText:name});
 const cells=async(page,name)=>(await row(page,name).locator('td').allInnerTexts()).map(text=>text.trim());
 for(const [label,viewport] of Object.entries(VIEWPORTS)){
  // ---- Arabic
  let page=await open('sm',{viewport});await quotesTab(page,'عروض الأسعار');
  check((await page.locator('.kpi-evidence-panel thead th').allInnerTexts()).map(t=>t.trim()),['المندوب','تحويل الفرص إلى عروض','عروض الشهر','المحوَّلة إلى مبيعات','نسبة التحويل','النقاط',''],label+': the columns');
  let rj1=await cells(page,'مندوب جدة الأول');check(rj1.slice(2,5),['3','2','66.67%'],label+': rj1 — three quotations, two converted');
  check((await cells(page,'مندوب جدة الثاني')).slice(2,5),['1','0','0%'],label+': rj2 — its quotation not converted (another representative\'s invoice does not convert it)');
  check((await cells(page,'مندوب الدمام')).slice(2,5),['0','0','لا ينطبق'],label+': no quotations — not applicable');
  const conversions=page.locator('.kpi-quote-conversions-row');check(await conversions.count(),1,label+': one representative with converted quotations');
  const items=(await conversions.locator('li').allInnerTexts()).map(t=>t.replace(/\s+/g,' ').trim());
  check(items.length,2,label+': two converted quotations');
  ok(items[0].includes('Qut-101')&&items[0].includes('INV-101')&&items[0].includes('INV-102')&&items[0].includes('مصنع النور'),label+': Qut-101 with both of its invoices: '+items[0]);
  ok(items[1].includes('Qut-102')&&items[1].includes('INV-103')&&!items.join(' ').includes('Qut-103')&&!items.join(' ').includes('RET-104'),label+': Qut-102 with INV-103; the return converts nothing: '+items[1]);
  ok((await page.locator('.kpi-evidence-panel-heading p').innerText()).includes('«الوصف»'),label+': the panel says how a quotation converts');
  await noSideways(page,label+' ar');await shot(page,'quotes-tab-'+label+'-ar');
  // the evidence editor's quotations section
  await row(page,'مندوب جدة الأول').getByRole('button',{name:'استكمال بيانات المؤشرات'}).click();
  const dialog=page.locator('.kpi-evidence-dialog');await dialog.waitFor();await dialog.locator('#kpi-quotes-title').waitFor();
  check(await dialog.locator('#kpi-quotes-title').innerText(),'روابط إضافية بين العروض والفواتير (اختياري)',label+': the section is optional extra links');
  ok((await dialog.innerText()).includes('يُحسب معدل تحويل عروض الأسعار إلى مبيعات تلقائيًا'),label+': and says the rate is automatic');
  check(await dialog.locator('input[name=quotationsComplete]').count(),0,label+': no quotation-list confirmation');
  await dialog.locator('#kpi-quotes-title').scrollIntoViewIfNeeded();await shot(page,'quotes-evidence-'+label+'-ar',false);
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  await page.context().close();
  // ---- English
  page=await open('sm',{viewport,english:true});await quotesTab(page,'Quotations');
  check((await page.locator('.kpi-evidence-panel thead th').allInnerTexts()).map(t=>t.trim()),['Representative','Opportunities to quotations','Quotations this month','Converted to sales','Conversion rate','Points',''],label+': the columns in English');
  check((await cells(page,'مندوب الدمام')).slice(2,5),['0','0','Not applicable']);
  ok((await page.locator('.kpi-quote-conversions-row').innerText()).includes('Converted quotations and their invoices:'),label+': the conversions label in English');
  check(arabicLeft(await page.locator('.kpi-evidence-panel').innerText()),[],label+': no Arabic left in English but names');
  await noSideways(page,label+' en');await shot(page,'quotes-tab-'+label+'-en');
  await page.context().close();
 }
 check(errors,[],'no page errors');
 console.log(JSON.stringify({ok:true,checks,screenshots,syntheticFixtures:true,productionDataUsed:false}));
}finally{await browser?.close();await app?.stop();}
