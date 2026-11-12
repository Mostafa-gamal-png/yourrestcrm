// «المستهدفات والنتائج في مكان واحد» (the owner's picture, 2026-11-11) in a real Chromium against the BUILT release (run the build
// first). Synthetic data only: temporary SQLite, mocked sendmail, statements built here in the ERP's layout; the month is the real
// clock's (this month in Riyadh).
// - The hub: five tabs in the owner's order, the month picker shared by every tab, «نتائج الأداء» first; a reload stays on the tab.
// - «تحقيق المستهدف — الشركة والفروع»: the company and each branch as gauges with «تفاصيل الفئات», the note; the same whatever
//   representative is chosen; «الفريق بالكامل» and «تحديث المؤشرات».
// - Each tab by role: the sales manager and the administrator (all of it), the supervisor (no gauges, no import), a manager whose
//   «المبيعات» is hidden (no sales tab), a representative and customer service (no hub).
// - «استيراد كشف التحصيل من ERP»: preview and commit, the replacement that asks first; the collection tab then shows the numbers.
// - Phone 320 and 360, tablet upright and on its side, desktop; Arabic and English (no Arabic left but names); nothing scrolls sideways.
// Screenshots for the report (YR_GATE_SCREENSHOT_DIR, else a temporary folder).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const screenshots=process.env.YR_GATE_SCREENSHOT_DIR?path.resolve(process.env.YR_GATE_SCREENSHOT_DIR):fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-targets-hub-shots-'));
fs.mkdirSync(screenshots,{recursive:true});
const P=['قوالب البلوك المتحركة','قوالب البلوك الثابتة','لمامة البلوك','ماكينة إنتاج البلوكة المتحركة','قطع غيار المكائن المتحركة','خلاطات البلوك','خلاطات الخرسانة الجاهزة','خدمات صيانة'];
const members=[
 {id:'owner',role:'admin',name:'مدير النظام',branch:'جدة'},{id:'sm',role:'manager',name:'مدير المبيعات',branch:'جدة'},{id:'smx',role:'manager',name:'مدير بلا مبيعات',branch:'جدة'},
 {id:'sup',role:'supervisor',sup:'sm',name:'المشرف أحمد',branch:'جدة'},
 {id:'rj1',role:'rep',sup:'sup',name:'مندوب جدة الأول',branch:'جدة'},{id:'rj2',role:'rep',sup:'sup',name:'مندوب جدة الثاني',branch:'جدة'},
 {id:'rd1',role:'rep',sup:'sm',name:'مندوب الدمام',branch:'الدمام'},{id:'cs',role:'customer_service',name:'خدمة العملاء',branch:'جدة'}
];
const VIEWPORTS={phone320:{width:320,height:740},phone360:{width:360,height:800},tablet:{width:820,height:1180},tabletSideways:{width:1180,height:820},desktop:{width:1440,height:900}};
const TABS=['نتائج الأداء','رفع المبيعات','التحصيل','عروض الأسعار','المستهدفات والأوزان'],TABS_EN=['Performance results','Sales upload','Collection','Quotations','Targets & weights'];
const riyadh=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}),day=riyadh.format(new Date()),month=day.slice(0,7);
const HEADERS=['رقم الحساب','اسم الحساب','المندوب','المحصل','الرصيد السابق مدين','الرصيد السابق دائن','حركة الفترة مدين','حركة الفترة دائن','الرصيد الحالي مدين','الرصيد الحالي دائن'];
const statement=rows=>Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from("<TABLE><TR><TD colspan='9'><center><b>كشف حساب  لـ 1100 _ 1199</b></center></TD></TR><TR>"+HEADERS.map(h=>'<Th>'+h+'</Th>').join('')+'</TR>'+rows.map(r=>'<TR>'+r.map(v=>'<TD>'+v+'</TD>').join('')+'</TR>').join('')+'</TABLE>','utf16le')]);
let checks=0,browser,app;
const errors=[];
const check=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};
const names=new Set([...members.map(m=>m.name),'جدة','الدمام','موظف مجهول']);
const arabicLeft=text=>text.split('\n').map(line=>line.trim()).filter(line=>/[؀-ۿ]/.test(line)).filter(line=>!line.split(/[·،,()|:]| - | branch$/).map(part=>part.replace(/ branch$/,'').trim()).filter(Boolean).every(part=>names.has(part)||!/[؀-ۿ]/.test(part)));

try{
 app=await bootBuiltApp({members},{tls:true});
 const sessions={};for(const m of members)sessions[m.id]=await app.login(m.id);
 const as=who=>app.as(sessions[who]);
 const save=(who,kind,scopeId,data)=>as(who)('/api/targets',{method:'POST',body:{kind,scopeId,month,version:0,inheritedFrom:null,requestId:crypto.randomUUID(),data}});
 const quantities=values=>({products:P.map((product,i)=>({product,quantity:values[i]??0}))});
 check((await save('owner','weights','company',{products:P.map((product,i)=>({product,weight:[40,20,10,10,10,5,5,0][i]}))})).status,200,'the weights');
 for(const [id,values] of [['rj1',[20,10,4,2,6,3,2,0]],['rj2',[10,10,2,2,4,2,2,0]],['rd1',[30,20,6,2,8,4,2,0]]])check((await save('sm','sales',id,quantities(values))).status,200,'the targets of '+id);
 const now=new Date().toISOString();
 await app.db.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('imp','owner','f','sales.xlsx','{}',?)").bind(now).run();
 let n=0;for(const [rep,product,quantity] of [['rj1',0,8],['rj1',1,5],['rj2',0,3],['rd1',0,12],['rd1',2,3],['rd1',4,2]]){n++;await app.db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'h','h',?,'sale',?,'e','"+rep+"',?,'all','C-1','عميل',?,100000,'imp','owner',?)").bind('erp-'+n,'doc-'+n,'ERP-'+n,day,members.find(m=>m.id===rep).branch,JSON.stringify({items:[{product:P[product],description:'',quantity,unitPrice:100}],discount:0,notes:''}),now).run();}
 await app.db.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('smx','{}','[\"sales\"]',1,'owner',?)").bind(now).run();

 browser=await chromium.launch({headless:true,...(process.env.YR_BROWSER_EXECUTABLE?{executablePath:process.env.YR_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--ignore-certificate-errors','--host-resolver-rules=MAP crm.yourrest.org 127.0.0.1','--disable-dev-shm-usage']});
 async function open(who,{viewport=VIEWPORTS.desktop,english=false,hash='#targets',hub=true}={}){
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport,deviceScaleFactor:1,reducedMotion:'reduce',serviceWorkers:'block',hasTouch:viewport.width<900,isMobile:viewport.width<500});
  const [name,...value]=(await app.login(who)).split('=');
  await context.addCookies([{name,value:value.join('='),url:app.origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
  if(english)await context.addInitScript(()=>{try{localStorage.setItem('yr-language','en');}catch{/* storage unavailable */}});
  const page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(who+': '+error.message));
  await page.goto(app.origin+'/'+hash);
  if(english)await page.waitForFunction(()=>document.documentElement.lang==='en');
  if(hub)await page.locator('.targets-hub').waitFor();
  return page;
 }
 const shot=async(page,label,fullPage=true)=>{await page.waitForTimeout(250);await page.screenshot({path:path.join(screenshots,label+'.png'),fullPage});};
 const noSideways=async(page,label)=>check(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,label+': no sideways scrolling');
 const tabs=page=>page.locator('.targets-hub-tabs [role=tab]');
 const tab=async(page,label)=>{await page.locator('.targets-hub-tabs [role=tab]',{hasText:label}).click();await page.waitForFunction(text=>document.querySelector('.targets-hub-tabs [aria-selected=true]')?.textContent?.trim()===text,label);};
 const ready=page=>page.locator('.targets-hub-panel').waitFor();

 // ---- desktop, the sales manager, Arabic: the owner's picture
 let page=await open('sm');await ready(page);
 check((await tabs(page).allInnerTexts()).map(s=>s.trim()),TABS,'five tabs in the owner\'s order');
 check(await page.locator('.targets-hub-tabs [aria-selected=true]').innerText(),'نتائج الأداء','«نتائج الأداء» first');
 check([await page.locator('.targets-hub h2').innerText(),await page.locator('.targets-hub-month span').innerText()],['المستهدفات والنتائج في مكان واحد','شهر المستهدفات والأداء'],'the hub card and its month picker');
 check(await page.locator('.targets-hub-month input').inputValue(),month,'this month');
 await page.locator('.targets-overview').waitFor();
 check(await page.locator('.targets-overview-heading h3').innerText(),'تحقيق المستهدف — الشركة والفروع','the gauges card');
 check(await page.locator('.targets-overview-scope h4').allInnerTexts(),['الشركة','فرع الدمام','فرع جدة'],'the company and each branch');
 const gauges=async()=>(await page.locator('.targets-overview-scope .target-gauge svg').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label'))));
 const before=await gauges();ok(before.every(label=>/^نسبة الإنجاز: [\d.]+%$/.test(label)),'each a percentage: '+before.join(' | '));
 // Jeddah: products 1..7 summed (rj1+rj2): 30,20,6,4,10,5,4; sold 11,5,0,...: weighted 40*11/30+20*5/20 = 14.67+5 = 19.67
 check(before[2],'نسبة الإنجاز: 19.67%','Jeddah = its people\'s targets against their sales, weighted');
 check(before[1],'نسبة الإنجاز: '+(Math.round((40*12/30+10*3/6+10*2/8)*100)/100)+'%','Dammam');
 ok(await page.locator('.targets-overview-note').innerText().then(text=>text.startsWith('مستهدف الفرع هو مجموع مستهدفات أفراده في هذا الشهر')),'the note under the gauges');
 await page.evaluate(()=>scrollTo(0,0));await shot(page,'hub-desktop-top-ar',false);
 await page.locator('.targets-overview-scope').first().locator('summary').click();
 check(await page.locator('.targets-overview-scope').first().locator('.targets-overview-table tbody tr').count(),8,'«تفاصيل الفئات»: every product of the company');
 ok(await page.getByRole('button',{name:'تحديث المؤشرات'}).isVisible(),'«تحديث المؤشرات»');
 ok(await page.evaluate(()=>{const card=document.querySelector('.targets-overview'),bar=document.querySelector('.targets-hub-toolbar');return !!card&&!!bar&&!!(card.compareDocumentPosition(bar)&Node.DOCUMENT_POSITION_FOLLOWING);}),'the representative picker is under the gauges, as in the owner\'s picture');
 await shot(page,'hub-desktop-results-ar');
 await page.locator('.targets-hub-toolbar [aria-label=المندوب]').click();
 await page.getByRole('option',{name:'مندوب الدمام'}).click();
 await page.waitForTimeout(300);
 check(await gauges(),before,'choosing a representative leaves the gauges as they are');
 await page.locator('.targets-hub-toolbar [aria-label=المندوب]').click();
 ok(await page.getByRole('option',{name:'الفريق بالكامل'}).isVisible(),'«الفريق بالكامل»');await page.getByRole('option',{name:'الفريق بالكامل'}).click();
 for(const label of TABS.slice(1)){
  await tab(page,label);await ready(page);
  if(label==='رفع المبيعات'){ok(await page.getByRole('heading',{name:/سجل المبيعات/}).isVisible(),'the sales list');ok(await page.getByRole('button',{name:'استيراد مبيعات ERP'}).isVisible(),'the ERP sales import');ok(await page.getByRole('button',{name:'تسجيل بيع'}).isVisible(),'the sale registration');}
  if(label==='التحصيل'){await page.locator('.kpi-evidence-panel').waitFor();ok(await page.getByRole('button',{name:'استيراد كشف التحصيل من ERP'}).isVisible(),'the collections import');ok((await page.locator('.kpi-evidence-panel tbody').innerText()).includes('مندوب الدمام')&&(await page.locator('.kpi-evidence-panel tbody').innerText()).includes('مندوب جدة الثاني'),'every person of the evaluation');}
  if(label==='عروض الأسعار'){await page.locator('.kpi-evidence-panel').waitFor();ok((await page.locator('.kpi-evidence-panel h3').innerText()).includes('عروض الأسعار'),'the quotations evidence');}
  if(label==='المستهدفات والأوزان'){await page.locator('.targets-workspace').waitFor();ok(await page.getByRole('button',{name:'أوزان التقييم'}).isVisible(),'the targets and the weights editor');}
  check(await page.locator('.targets-hub-month input').count(),1,label+': the same month picker');
  await noSideways(page,'desktop '+label);await shot(page,'hub-desktop-'+TABS.indexOf(label)+'-ar');
 }
 // a reload stays on the tab
 await tab(page,'التحصيل');ok(page.url().includes('tab=collection'),'the address holds the tab');
 await page.reload();await page.locator('.targets-hub').waitFor();
 check(await page.locator('.targets-hub-tabs [aria-selected=true]').innerText(),'التحصيل','a reload stays on «التحصيل»');
 await page.goto(app.origin+'/#customer');await page.locator('.targets-hub').waitFor({state:'detached'});ok(!page.url().includes('tab='),'leaving the page takes the tab out of the address');
 await page.goto(app.origin+'/#targets');await page.reload();await page.locator('.targets-hub').waitFor();ok(!page.url().includes('tab='),'(a visit without the tab in the address)');
 check(await page.locator('.targets-hub-tabs [aria-selected=true]').innerText(),'التحصيل','and the browser remembers it for the next visit');

 // ---- «استيراد كشف التحصيل من ERP»
 await page.locator('.kpi-evidence-panel').waitFor();
 await page.getByRole('button',{name:'استيراد كشف التحصيل من ERP'}).click();
 let dialog=page.locator('.collections-import-dialog');await dialog.waitFor();
 check(await dialog.locator('#erp-collections-month').inputValue(),month,'the hub\'s month by default');
 ok((await dialog.locator('.erp-import-office-note').innerText()).includes('حركة الفترة دائن'),'the meaning, stated');
 await dialog.locator('#erp-collections-file').setInputFiles({name:'Account_Balance_Sheet_F_T.xls',mimeType:'application/vnd.ms-excel',buffer:statement([
  ['1101','مصنع 1','مندوب جدة الأول','مندوب جدة الأول','1000','0','500','700','800','0'],['1102','مصنع 2','مندوب الدمام','مندوب الدمام','0','0','400','100','300','0'],
  ['1103','مصنع 3','مبيعات مكتب','مبيعات مكتب','0','0','999','999','0','0'],['1104','مصنع 4','موظف مجهول','','0','0','100','0','90','0']])});
 await dialog.getByRole('button',{name:'قراءة الكشف ومعاينته'}).click();
 await dialog.locator('#collections-preview-heading').waitFor();
 check(await dialog.locator('.erp-import-table tbody tr').count(),2,'two representatives');
 ok((await dialog.locator('.erp-import-warnings').innerText()).includes('حسابات «مبيعات مكتب» المستبعدة: 1'),'the office, reported');
 await shot(page,'hub-collections-preview-ar',false);
 await dialog.getByRole('button',{name:'اعتماد'}).click();
 await dialog.locator('.erp-import-success').waitFor();
 ok((await dialog.locator('.erp-import-success').innerText()).includes('كُتب لـ 2'),'written for two');
 await shot(page,'hub-collections-done-ar',false);
 await dialog.getByRole('button',{name:'تم'}).click();await dialog.waitFor({state:'detached'});
 await page.locator('.kpi-evidence-panel tbody tr',{hasText:'مندوب جدة الأول'}).filter({hasText:'1,500'}).waitFor();
 ok((await page.locator('.kpi-evidence-panel tbody tr',{hasText:'مندوب جدة الأول'}).innerText()).includes('46.67%'),'the collection tab shows the imported rate (700 / 1,500)');
 // a value changed: the replacement asks first
 await page.getByRole('button',{name:'استيراد كشف التحصيل من ERP'}).click();dialog=page.locator('.collections-import-dialog');await dialog.waitFor();
 await dialog.locator('#erp-collections-file').setInputFiles({name:'Account_Balance_Sheet_F_T (2).xls',mimeType:'application/vnd.ms-excel',buffer:statement([['1101','مصنع 1','مندوب جدة الأول','','1000','0','500','900','600','0']])});
 await dialog.getByRole('button',{name:'قراءة الكشف ومعاينته'}).click();await dialog.locator('#collections-preview-heading').waitFor();
 ok((await dialog.locator('.erp-import-table').innerText()).includes('سيستبدل القيمة الحالية (1,500.00 / 700.00)'),'«سيستبدل القيمة الحالية (… / …)»');
 check(await dialog.getByRole('button',{name:'اعتماد'}).isDisabled(),true,'not before the confirmation');
 await dialog.locator('.erp-import-skip input').check();
 await dialog.getByRole('button',{name:'اعتماد'}).click();await dialog.locator('.erp-import-success').waitFor();
 await dialog.getByRole('button',{name:'تم'}).click();await dialog.waitFor({state:'detached'});
 await page.locator('.kpi-evidence-panel tbody tr',{hasText:'مندوب جدة الأول'}).filter({hasText:'60%'}).waitFor();ok(true,'replaced: 900 / 1,500');
 await page.close();

 // ---- every size, Arabic and English
 for(const [size,viewport] of Object.entries(VIEWPORTS))for(const english of [false,true]){
  page=await open('sm',{viewport,english});await ready(page);
  const labels=english?TABS_EN:TABS;
  check((await tabs(page).allInnerTexts()).map(s=>s.trim()),labels,size+(english?' en':' ar')+': the five tabs');
  for(const label of labels){
   await tab(page,label);await ready(page);
   if(label===labels[0])await page.locator('.targets-overview').waitFor();
   await noSideways(page,size+(english?' en ':' ar ')+label);
   const tabsBox=await page.locator('.targets-hub-tabs').boundingBox();ok(tabsBox.x>=0&&tabsBox.x+tabsBox.width<=viewport.width+1,size+': the tabs fit the screen');
   if(english){const left=arabicLeft(await page.locator('.targets-hub').innerText()+'\n'+(await page.locator('.targets-overview').count()?await page.locator('.targets-overview').innerText():'')+'\n'+(await page.locator('.kpi-evidence-panel').count()?await page.locator('.kpi-evidence-panel').innerText():'')+'\n'+await page.locator('.targets-hub-toolbar').innerText());check(left,[],size+' '+label+': no Arabic left in English but names');}
  }
  if(['phone360','phone320','tablet','tabletSideways'].includes(size)){await tab(page,labels[0]);await page.locator('.targets-overview').waitFor();await shot(page,'hub-'+size+(english?'-en':'-ar'));}
  if(size==='phone360'&&!english){for(const label of labels.slice(1)){await tab(page,label);await ready(page);await shot(page,'hub-phone360-'+labels.indexOf(label)+'-ar');}}
  if(size==='phone360'&&english){await tab(page,'Collection');await page.getByRole('button',{name:'Import the ERP collection statement'}).click();dialog=page.locator('.collections-import-dialog');await dialog.waitFor();await dialog.locator('#erp-collections-file').setInputFiles({name:'statement.xls',mimeType:'application/vnd.ms-excel',buffer:statement([['1101','مصنع 1','مندوب جدة الأول','','1000','0','500','900','600','0'],['1104','مصنع 4','موظف مجهول','','0','0','100','0','90','0']])});await dialog.getByRole('button',{name:'Read and preview the statement'}).click();await dialog.locator('#collections-preview-heading').waitFor();check(arabicLeft((await dialog.innerText()).replace(/statement\.xls|كشف حساب  ?لـ 1100 _ 1199/g,'')),[],'the import dialog in English: no Arabic but names');await noSideways(page,'phone360 en import');await shot(page,'hub-phone360-collections-preview-en',false);}
  if(size==='phone320'&&!english){await tab(page,'التحصيل');await page.getByRole('button',{name:'استيراد كشف التحصيل من ERP'}).click();dialog=page.locator('.collections-import-dialog');await dialog.waitFor();await dialog.locator('#erp-collections-file').setInputFiles({name:'statement.xls',mimeType:'application/vnd.ms-excel',buffer:statement([['1101','مصنع 1','مندوب جدة الأول','','1000','0','500','900','600','0']])});await dialog.getByRole('button',{name:'قراءة الكشف ومعاينته'}).click();await dialog.locator('#collections-preview-heading').waitFor();const width=await dialog.evaluate(node=>node.scrollWidth-node.clientWidth);check(width<=1,true,'phone 320: the import dialog does not scroll sideways');await shot(page,'hub-phone320-collections-preview-ar',false);}
  await page.close();
 }

 // ---- by role
 page=await open('owner');await ready(page);check((await tabs(page).allInnerTexts()).length,5,'the administrator: every tab');await page.locator('.targets-overview').waitFor();await tab(page,'التحصيل');ok(await page.getByRole('button',{name:'استيراد كشف التحصيل من ERP'}).isVisible(),'and the import');await page.close();
 page=await open('sup');await ready(page);check((await tabs(page).allInnerTexts()).map(s=>s.trim()),TABS,'the supervisor: the five tabs');await page.locator('.kpi-workspace').waitFor();check(await page.locator('.targets-overview').count(),0,'no company gauge (it reads its team only)');await tab(page,'التحصيل');await page.locator('.kpi-evidence-panel').waitFor();check(await page.getByRole('button',{name:'استيراد كشف التحصيل من ERP'}).count(),0,'no import');ok((await page.locator('.kpi-evidence-panel').innerText()).includes('عرض بيانات المؤشرات'),'reads the evidence only');await tab(page,'المستهدفات والأوزان');await page.locator('.targets-workspace').waitFor();check(await page.getByRole('button',{name:'أوزان التقييم'}).count(),0,'no weights editor');await shot(page,'hub-supervisor-targets-ar');await page.close();
 page=await open('smx');await ready(page);check((await tabs(page).allInnerTexts()).map(s=>s.trim()),TABS.filter(t=>t!=='رفع المبيعات'),'«المبيعات» hidden: no «رفع المبيعات»');await page.close();
 for(const who of ['rj1','cs']){page=await open(who,{hub:false});await page.waitForTimeout(1500);check(await page.locator('.targets-hub').count(),0,who+': no hub');await page.close();}
 // ---- a company of one branch (the owner, 2026-11-12: «مفيش فروع للشركة»; every member is in «الرئيسي»): ONE gauge, the company's.
 // An incomplete «الفرع بالكامل» target saved for «الرئيسي» (the cause of the owner's blank gauges) is ignored and named; a representative
 // without a target this month is said in one line; once the target is set, the gauge is the people's targets against their sales.
 await app.stop();
 const MAIN='الرئيسي',one=[{id:'owner',role:'admin',name:'مدير النظام',branch:MAIN},{id:'sm',role:'manager',name:'مدير المبيعات',branch:MAIN},{id:'sup',role:'supervisor',sup:'sm',name:'المشرف أحمد',branch:MAIN},
  {id:'r1',role:'rep',sup:'sup',name:'المندوب الأول',branch:MAIN},{id:'r2',role:'rep',sup:'sup',name:'المندوب الثاني',branch:MAIN},{id:'r3',role:'rep',sup:'sm',name:'المندوب الثالث',branch:MAIN}];
 for(const m of one)names.add(m.name);names.add(MAIN);
 app=await bootBuiltApp({members:one},{tls:true});
 const owner=app.as(await app.login('owner')),put=(kind,scopeId,data)=>owner('/api/targets',{method:'POST',body:{kind,scopeId,month,version:0,inheritedFrom:null,requestId:crypto.randomUUID(),data}});
 check((await put('weights','company',{products:P.map((product,i)=>({product,weight:[40,20,10,10,10,5,5,0][i]}))})).status,200,'one branch: the weights');
 for(const [id,values] of [['r1',[20,10,4,2,6,3,2,0]],['r2',[10,10,2,2,4,2,2,0]]])check((await put('sales',id,quantities(values))).status,200,'one branch: the targets of '+id);
 check((await put('sales','branch:'+MAIN,{products:P.map((product,i)=>({product,quantity:i<2?[50,30][i]:null}))})).status,200,'an incomplete «الفرع بالكامل» target, as on the live site');
 const now2=new Date().toISOString();
 await app.db.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('imp','owner','f','sales.xlsx','{}',?)").bind(now2).run();
 n=0;for(const [rep,product,quantity] of [['r1',0,8],['r1',1,5],['r2',0,3],['r3',0,6],['sm',0,40]]){n++;await app.db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'h','h',?,'sale',?,'e','"+rep+"',?,'all','C-1','عميل',?,100000,'imp','owner',?)").bind('erp-'+n,'doc-'+n,'ERP-'+n,day,MAIN,JSON.stringify({items:[{product:P[product],description:'',quantity,unitPrice:100}],discount:0,notes:''}),now2).run();}
 const single=async page=>{await page.locator('.targets-overview').waitFor();return {heading:await page.locator('.targets-overview-heading h3').innerText(),scopes:await page.locator('.targets-overview-scope h4').allInnerTexts(),gauge:await page.locator('.targets-overview-scope .target-gauge svg').getAttribute('aria-label')};};
 page=await open('owner');await ready(page);
 check(await single(page),{heading:'تحقيق المستهدف — الشركة',scopes:['الشركة'],gauge:'نسبة الإنجاز: مندوب واحد بلا مستهدف لهذا الشهر'},'one branch: one gauge, «الشركة»; the representative without a target named in one line');
 check(await page.locator('.targets-overview .target-gauge-empty').innerText(),'مندوب واحد بلا مستهدف لهذا الشهر','the line under the gauge');
 ok((await page.locator('.targets-overview-ignored').innerText()).startsWith('لم يُعتمد مستهدف «الفرع بالكامل» لأنه ناقص'),'the incomplete branch target, named');
 check(await page.locator('.targets-overview-source').innerText(),'مجموع مستهدفات المناديب','its source');
 check(await page.locator('.targets-overview-note').innerText(),'مستهدف الشركة هو مجموع مستهدفات المناديب في هذا الشهر. مبيعات المكاتب الإدارية لا تدخل في الحساب. يتغير بالشهر فقط، ولا يتأثر باختيار المندوب.','the note, without the branches');
 await page.locator('.targets-overview-scope summary').click();
 check(await page.locator('.targets-overview-table tbody tr').count(),8,'«تفاصيل الفئات»: every product');
 check((await page.locator('.targets-overview-table tbody tr').first().locator('td').allInnerTexts()).map(cell=>cell.replace(/\s+/g,' ')),[P[0]+' · قالب','30 محدَّد لـ 2 من 3','17','—'],'what is set (for 2 of the 3), what is achieved, no percentage of a part');
 await noSideways(page,'one branch desktop');await shot(page,'company-gauge-missing-desktop-ar',false);
 await page.close();
 for(const english of [false,true]){page=await open('owner',{viewport:VIEWPORTS.phone360,english});await ready(page);await page.locator('.targets-overview').waitFor();await page.locator('.targets-overview-scope summary').click();await noSideways(page,'one branch phone360 '+(english?'en':'ar'));
  if(english){check((await single(page)).gauge,'Achievement: 1 representative without a target this month','in English');check(arabicLeft(await page.locator('.targets-overview').innerText()),[],'one branch: no Arabic left in English but names');}
  await page.locator('.targets-overview').screenshot({path:path.join(screenshots,'company-gauge-missing-phone360-'+(english?'en':'ar')+'.png')});checks++;await page.close();}
 // the third representative's target is set: the gauge is the people's targets against their sales (the manager's own sale is not theirs)
 check((await put('sales','r3',quantities([30,20,6,2,8,4,2,0]))).status,200,'the missing target, filled in «المستهدفات والأوزان»');
 // products 1..7 summed: 60,40,12,6,18,9,6; sold 17,5,0,...: 40*17/60 + 20*5/40 + the rest 0
 const expected=Math.round((40*17/60+20*5/40)*100)/100;
 for(const [viewport,english] of [[VIEWPORTS.desktop,false],[VIEWPORTS.desktop,true],[VIEWPORTS.phone360,false],[VIEWPORTS.phone360,true]]){
  page=await open('owner',{viewport,english});await ready(page);const seen=await single(page);
  check(seen,english?{heading:'Target achievement — company',scopes:['Company'],gauge:'Achievement: '+expected+'%'}:{heading:'تحقيق المستهدف — الشركة',scopes:['الشركة'],gauge:'نسبة الإنجاز: '+expected+'%'},'one branch, filled: the weighted percentage ('+(english?'en':'ar')+' '+viewport.width+')');
  await page.locator('.targets-overview-scope summary').click();await noSideways(page,'one branch filled '+viewport.width);
  if(english)check(arabicLeft(await page.locator('.targets-overview').innerText()),[],'no Arabic left in English but names');
  const label='company-gauge-'+(viewport.width===360?'phone360':'desktop')+'-'+(english?'en':'ar');
  if(viewport.width===360)await page.locator('.targets-overview').screenshot({path:path.join(screenshots,label+'.png')});else await shot(page,label,false);
  await page.close();
 }
 page=await open('sup');await ready(page);await page.locator('.kpi-workspace').waitFor();check(await page.locator('.targets-overview').count(),0,'one branch: the supervisor still gets no company gauge');await page.close();
 check(errors,[],'no page error');
 console.log(JSON.stringify({ok:true,checks,screenshots,syntheticFixtures:true,productionDataUsed:false}));
}finally{await browser?.close();await app?.stop();}
