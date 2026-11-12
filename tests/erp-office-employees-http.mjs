// «مبيعات مكتب (مستبعد)» for an ERP employee over HTTP against the BUILT release (run the build first): the ERP sales import
// (/api/sales/import), the ERP quotations import (/api/erp-quotes) and the collection statement (/api/kpi-evidence/import) together.
// Synthetic data only: a temporary SQLite, mocked sendmail, reports built here in the ERP's layouts (the real readers read them).
// - Who: 401 without a session, 403 to a representative and customer service, 403 from another site; a supervisor reads a saved mark and
//   cannot lift it (403, nothing written), cannot mark an employee of another team's representative.
// - The sales import: the employee (6007, «نوفل بكر») asks for a representative; «مبيعات مكتب (مستبعد)» excludes his documents (status
//   excluded, counted for nobody, never blocking, no category asked), the preview writes nothing, the import saves the mark (the list, one
//   audit line, the representative mapping removed) and the same request again writes nothing twice; the next file shows it saved.
// - The quotations import: his quotations are excluded with their reason and he is listed with the mark, fixed (a representative chosen
//   for him: 409); an unmapped employee is marked here, saved with the import even when nothing else is imported.
// - The collection statement: his name is office (its accounts with «مبيعات مكتب», the sales import's mark fixed: 409 to change); a name
//   is marked here (saved even when no representative's collection changes) and suggests the mark to the sales import for an unmapped
//   number of that full name.
// - Stored sales: an employee whose invoices were imported for a representative and is then marked keeps them saved (reported, never
//   deleted); lifted back by a manager, the saved invoice is a duplicate again and the mapping is saved.
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';
import {quotation,erpQuotesXls} from '../scripts/lib/erp-quotes-fixture.mjs';

const members=[
 {id:'owner',role:'admin',name:'مدير النظام'},{id:'sm',role:'manager',name:'مدير المبيعات'},{id:'sup',role:'supervisor',sup:'sm',name:'المشرف'},
 {id:'rep1',role:'rep',sup:'sup',name:'مندوب ألف'},{id:'rep2',role:'rep',sup:'sm',name:'مندوب باء'},{id:'cs',role:'customer_service',name:'خدمة العملاء'}
];
const OFFICE='office:excluded';
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const HEADERS=['رقم الفاتورة','التاريخ','النوع','رقم الصنف','اسم الصنف','الفئة','الكمية','الوحدة','سعر الوحدة','الخصم','الإجمالي','القيمة المضافة','رقم العميل','اسم العميل','رقم الموظف','اسم الموظف'];
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),month=day.slice(0,7);
function sales(lines){
 const cells=l=>[l.reference,l.date||month+'-01','فاتورة مبيعات','M1','قالب',l.category||'قوالب البلوك المتحركة','1','حبة','1000.00','0','1000.00','150.00',l.customer||'C1','مصنع '+(l.customer||'C1'),l.employee,l.name];
 const row=values=>`<row>${values.map(v=>`<c t="str"><v>${escape(v)}</v></c>`).join('')}</row>`;
 return Buffer.from(zipSync({
  '[Content_Types].xml':strToU8('<?xml version="1.0"?><Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'),
  'xl/workbook.xml':strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels':strToU8('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
  'xl/worksheets/sheet1.xml':strToU8(`<worksheet><sheetData>${[HEADERS,...lines.map(cells)].map(row).join('')}</sheetData></worksheet>`),
 })).toString('base64');
}
const CHEADERS=['رقم الحساب','اسم الحساب','المندوب','المحصل','الرصيد السابق مدين','الرصيد السابق دائن','حركة الفترة مدين','حركة الفترة دائن','الرصيد الحالي مدين','الرصيد الحالي دائن'];
const statement=rows=>Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from("<TABLE><TR><TD colspan='9'>كشف حساب لـ 1 _ 9</TD></TR><TR>"+CHEADERS.map(h=>'<Th>'+h+'</Th>').join('')+'</TR>'+rows.map(r=>'<TR>'+r.map(v=>'<TD>'+v+'</TD>').join('')+'</TR>').join('')+'</TABLE>','utf16le')]).toString('base64');
let checks=0,app;
const check=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};
try{
 app=await bootBuiltApp({members});
 const sessions={};for(const m of members)sessions[m.id]=await app.login(m.id);
 const as=who=>app.as(who?sessions[who]:'');
 const officeRow=async()=>{const row=await app.db.prepare("SELECT owner_id FROM crm_settings WHERE id='erp-office-employees'").first();return row?JSON.parse(row.owner_id).employees:null;};
 const officeAudits=async()=>(await app.db.prepare("SELECT actor,detail FROM crm_audit WHERE record_id='erp-office-employees' ORDER BY created_at,rowid").all()).results.map(r=>({actor:r.actor,...JSON.parse(r.detail)}));
 const S='/api/sales/import';
 const salesBody=(base64,mappings,extra={})=>({action:'preview',fileName:'Sales.xlsx',base64,employeeMappings:mappings,categoryMappings:[],...extra});
 const salesPost=(who,body,headers)=>as(who)(S,{method:'POST',body,headers});
 async function salesImport(who,base64,mappings,expect=200){
  const preview=await salesPost(who,salesBody(base64,mappings));if(preview.status!==200)console.error(preview.text);check(preview.status,200,'preview');
  const requestId=crypto.randomUUID(),body=salesBody(base64,mappings,{action:'commit',previewToken:preview.json().previewToken,requestId});
  const result=await salesPost(who,body);if(result.status!==expect)console.error(result.text);check(result.status,expect,'commit');
  return {preview:preview.json(),result:result.json(),body};
 }
 const file1=sales([{reference:'A1',employee:'7001',name:'مندوب ألف'},{reference:'N1',employee:'6007',name:'نوفل بكر',category:'أدوات مكتبية'},{reference:'N2',employee:'6007',name:'نوفل بكر',category:'أدوات مكتبية'}]);

 // ---- who may
 check((await as('')(S)).status,401,'GET without a session');
 check((await salesPost('',salesBody(file1,[]))).status,401,'POST without a session');
 for(const who of ['rep1','cs'])check((await salesPost(who,salesBody(file1,[{employeeId:'6007',repId:OFFICE}]))).status,403,who+': 403');
 check((await salesPost('sm',salesBody(file1,[{employeeId:'6007',repId:OFFICE}]),{Origin:'https://evil.example'})).status,403,'another site: 403');

 // ---- the sales import
 let preview=(await salesPost('sm',salesBody(file1,[{employeeId:'7001',repId:'rep1'}]))).json();
 check([preview.documents.filter(d=>d.employeeId==='6007').map(d=>d.status),preview.employees.find(e=>e.employeeId==='6007').repId],[['unmapped','unmapped'],''],'6007 «نوفل بكر» asks for a representative');
 preview=(await salesPost('sm',salesBody(file1,[{employeeId:'7001',repId:'rep1'},{employeeId:'6007',repId:OFFICE}]))).json();
 check(preview.documents.filter(d=>d.employeeId==='6007').map(d=>[d.status,d.reason,d.repName,d.totalCents]),[['excluded','مبيعات مكتب (تحديد الموظف): مستبعدة ولا تُحتسب لأي مندوب','',0],['excluded','مبيعات مكتب (تحديد الموظف): مستبعدة ولا تُحتسب لأي مندوب','',0]],'chosen «مبيعات مكتب (مستبعد)»: excluded, counted for nobody');
 check([preview.summary.newCount,preview.summary.officeExcludedCount,preview.summary.unmappedCount,preview.categories],[1,2,0,['قوالب البلوك المتحركة']],'never blocking; his category is not asked');
 check(await officeRow(),null,'a preview writes nothing');
 const first=await salesImport('sm',file1,[{employeeId:'7001',repId:'rep1'},{employeeId:'6007',repId:OFFICE}]);
 check([first.result.importedCount,first.result.excludedCount,first.result.officeMarkedCount],[1,2,1],'imported, the mark saved');
 check((await officeRow()).map(e=>[e.employeeId,e.employeeName,e.by]),[['6007','نوفل بكر','sm']],'stored: number, name, who');
 const again=await salesPost('sm',first.body);check([again.status,again.json().alreadySaved,(await officeAudits()).length],[200,true,1],'the same request again: its first answer, one audit line');
 check(Number((await app.db.prepare("SELECT COUNT(*) n FROM crm_erp_sales WHERE employee_id='6007'").first()).n),0,'none of his invoices stored');
 const config=(await as('sm')(S)).json();ok(config.employeeMappings.some(m=>m.employeeId==='6007'&&m.repId===OFFICE),'the configuration returns the mark');
 preview=(await salesPost('sm',salesBody(sales([{reference:'N3',employee:'6007',name:'نوفل بكر'}]),[]))).json();
 check([preview.documents[0].status,preview.employees[0].mappingSource,preview.employees[0].officeLocked],['excluded','saved',false],'the next file: excluded by the saved mark');

 // ---- a supervisor
 const supConfig=(await as('sup')(S)).json();check([supConfig.employeeMappings.some(m=>m.employeeId==='6007'&&m.repId===OFFICE),supConfig.canChangeOffice],[true,false],'a supervisor reads the mark, may not change it');
 preview=(await salesPost('sup',salesBody(sales([{reference:'N4',employee:'6007',name:'نوفل بكر'}]),[{employeeId:'6007',repId:OFFICE}]))).json();
 check(preview.employees[0].officeLocked,true,'locked for him');
 const lift=await salesPost('sup',salesBody(sales([{reference:'N4',employee:'6007',name:'نوفل بكر'}]),[{employeeId:'6007',repId:'rep1'}]));
 check([lift.status,lift.json().error],[403,'تعديل موظف محدد «مبيعات مكتب» متاح لمدير المبيعات أو مدير النظام فقط'],'lifting it: 403 with its reason');
 await salesImport('sm',sales([{reference:'B1',employee:'7002',name:'مندوب باء'}]),[{employeeId:'7002',repId:'rep2'}]);
 check((await salesPost('sup',salesBody(sales([{reference:'B2',employee:'7002',name:'مندوب باء'}]),[{employeeId:'7002',repId:OFFICE}]))).status,403,'marking the employee of another team\'s representative: 403');

 // ---- stored sales stay; lifted back by a manager
 const stored=async()=>(await app.db.prepare("SELECT id,rep_id,total_cents,data FROM crm_erp_sales WHERE employee_id='7002'").all()).results;
 const before=await stored();
 const marked=await salesImport('sm',sales([{reference:'B1',employee:'7002',name:'مندوب باء'}]),[{employeeId:'7002',repId:OFFICE}]);
 check([marked.preview.documents[0].reason,marked.preview.summary.officeSavedCount],['مبيعات مكتب (تحديد الموظف): مستبعدة من هذا الاستيراد؛ النسخة المحفوظة سابقًا للمندوب تبقى كما هي',1],'an invoice stored for a representative: excluded now, said to stay');
 check([await stored(),Number((await app.db.prepare("SELECT COUNT(*) n FROM crm_erp_employee_mappings WHERE employee_id='7002'").first()).n)],[before,0],'the stored invoice unchanged; the mapping removed');
 const back=await salesImport('sm',sales([{reference:'B1',employee:'7002',name:'مندوب باء'}]),[{employeeId:'7002',repId:'rep2'}]);
 check([back.preview.documents[0].status,back.result.officeUnmarkedCount,(await officeRow()).some(e=>e.employeeId==='7002')],['duplicate',1,false],'lifted: duplicate again, the mark gone');

 // ---- the quotations import
 const now=new Date().toISOString();
 await app.db.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('c101','customer',NULL,'rep1','الرئيسي',?,?,?,1,'fixture')").bind(JSON.stringify({name:'مصنع الاختبار',code:'101',region:'الوسطى',assignedTo:'rep1',branch:'الرئيسي'}),now,now).run();
 const Q='/api/erp-quotes',qfile=rows=>erpQuotesXls(rows).toString('base64');
 const qrows=[...quotation({code:'Qut-1',customerCode:'101',empCode:'6007',empName:'نوفل بكر',lines:[{name:'قالب',qty:1,price:1000}]}),...quotation({code:'Qut-2',customerCode:'101',empCode:'9009',empName:'موظف عروض',lines:[{name:'قالب',qty:1,price:1000}]})];
 const qpost=(who,body)=>as(who)(Q,{method:'POST',body});
 let q=(await qpost('owner',{action:'preview',fileName:'quotes.xls',base64:qfile(qrows)})).json();
 check(q.quotations.map(x=>[x.code,x.status,x.reason]),[['Qut-1','excluded','مبيعات مكتب (تحديد الموظف): مستبعدة ولا تُحتسب لأي مندوب'],['Qut-2','refused','اربط موظف ERP بمندوب']],'quotations: his excluded by the sales import\'s mark');
 check(q.employees.find(e=>e.employeeId==='6007'),{employeeId:'6007',employeeName:'نوفل بكر',quotations:1,repId:OFFICE,savedOutside:false,mappingSource:'saved',office:true},'listed with the mark, saved');
 const fixed=await qpost('owner',{action:'preview',fileName:'quotes.xls',base64:qfile(qrows),employeeMappings:[{employeeId:'6007',repId:'rep1'}]});
 check([fixed.status,fixed.json().error],[409,'ربط هذا الموظف محفوظ من استيراد مبيعات ERP؛ يُعدَّل من شاشة استيراد المبيعات'],'changed from the sales import only');
 const qbody={fileName:'quotes.xls',base64:qfile(qrows),employeeMappings:[{employeeId:'9009',repId:OFFICE}]};
 q=(await qpost('owner',{action:'preview',...qbody})).json();
 check([q.quotations.map(x=>x.status),q.summary.officeMarks,q.summary.newCount],[['excluded','excluded'],1,0],'an unmapped employee marked here: nothing to import but the mark');
 const qsaved=await qpost('owner',{action:'commit',...qbody,previewToken:q.previewToken,requestId:crypto.randomUUID()});
 check([qsaved.status,qsaved.json().officeMarked,qsaved.json().addedCount],[200,1,0],'saved with the import');
 check((await officeRow()).map(e=>e.employeeId),['6007','9009'],'the list has both');
 check((await officeAudits()).at(-1).source,'erp-quotes-import','audited as the quotations import\'s');
 check(Number((await app.db.prepare("SELECT COUNT(*) n FROM crm_records WHERE kind='quote'").first()).n),0,'no quotation written');

 // ---- the collection statement
 const K='/api/kpi-evidence/import',kpost=(who,body)=>as(who)(K,{method:'POST',body});
 const cfile=statement([['1','مصنع 1','مندوب ألف','','0','0','1000','400','600','0'],['2','مصنع 2','نوفل بكر','','0','0','500','500','0','0'],['3','مصنع 3','ماجد حسن','','0','0','200','0','200','0']]);
 const kbody=extra=>({action:'preview',month,fileName:'Account_Balance_Sheet.xls',base64:cfile,...extra});
 let k=(await kpost('sm',kbody())).json();
 check(k.names.map(n=>[n.name,n.status,n.officeSource||'']),[['ماجد حسن','unmapped',''],['مندوب ألف','mapped',''],['نوفل بكر','office','sales']].sort((a,b)=>a[0].localeCompare(b[0],'ar')),'his name is office (marked by number in the sales import)');
 check([k.summary.officeRows,k.reps.map(r=>[r.repId,r.dueCents])],[1,[['rep1',100000]]],'his account counted with the office, written for nobody');
 const kfixed=await kpost('sm',kbody({mappings:[{name:'نوفل بكر',repId:'rep1'}]}));
 check([kfixed.status,kfixed.json().error],[409,'هذا الاسم محدد «مبيعات مكتب» برقم موظفه من استيراد مبيعات ERP؛ يُعدَّل من شاشة استيراد المبيعات'],'changed from the sales import only');
 // A name marked here: saved with the approval even when no collection changes.
 const first2=(await kpost('sm',kbody())).json();
 check((await kpost('sm',kbody({action:'commit',requestId:crypto.randomUUID(),planDigest:first2.planDigest}))).status,200,'the collection of rep1 approved');
 const markBody=kbody({mappings:[{name:'ماجد حسن',repId:OFFICE}]});
 k=(await kpost('sm',markBody)).json();
 check([k.names.find(n=>n.name==='ماجد حسن').status,k.names.find(n=>n.name==='ماجد حسن').officeSource,k.summary.officeChanges,k.reps.map(r=>r.status)],['office','selected',1,['unchanged']],'a name marked here; nothing else changes');
 const markRequest=crypto.randomUUID(),kcommit={...markBody,action:'commit',requestId:markRequest,planDigest:k.planDigest};
 const kdone=await kpost('sm',kcommit);
 check([kdone.status,kdone.json().writtenCount,kdone.json().officeMarked],[200,0,1],'saved alone');
 check((await officeRow()).filter(e=>!e.employeeId).map(e=>e.employeeName),['ماجد حسن'],'as a name mark');
 const kagain=await kpost('sm',kcommit);check([kagain.status,kagain.json().alreadySaved,(await officeAudits()).filter(a=>a.source==='erp-collections-import').length],[200,true,1],'the same request again writes nothing twice');
 k=(await kpost('sm',kbody())).json();check(k.names.find(n=>n.name==='ماجد حسن').officeSource,'saved','the next statement: saved');
 check((await kpost('sm',kbody({mappings:[{name:'ماجد حسن',repId:'cs'}]}))).status,403,'mapping a name to someone outside the team: still 403');
 // The name mark suggests the mark to the sales import for an unmapped number of that full name.
 preview=(await salesPost('sm',salesBody(sales([{reference:'M1',employee:'5005',name:'ماجد حسن'}]),[]))).json();
 check([preview.documents[0].status,preview.employees[0].repId,preview.employees[0].mappingSource],['excluded',OFFICE,'name'],'the sales import suggests it by name');
 // Lifted in the statement (a name mark), back to a representative.
 const liftBody=kbody({mappings:[{name:'ماجد حسن',repId:'rep2'}]});
 k=(await kpost('sm',liftBody)).json();check([k.names.find(n=>n.name==='ماجد حسن').status,k.summary.officeChanges],['mapped',1],'a name mark mapped back to a representative');
 check((await kpost('sm',{...liftBody,action:'commit',requestId:crypto.randomUUID(),planDigest:k.planDigest})).status,200,'approved');
 check((await officeRow()).some(e=>e.employeeName==='ماجد حسن'),false,'the name mark lifted');
 // Another mark saved between the preview and the approval: the approval reads the list again and keeps it (nothing is lost).
 const stale=(await kpost('sm',kbody({mappings:[{name:'ماجد حسن',repId:OFFICE}]}))).json();
 await app.db.prepare("UPDATE crm_settings SET owner_id=json_set(owner_id,'$.employees[#]',json('{\"employeeId\":\"\",\"employeeName\":\"آخر\",\"by\":\"owner\",\"at\":\"t\"}')) WHERE id='erp-office-employees'").run();
 check((await kpost('sm',kbody({mappings:[{name:'ماجد حسن',repId:OFFICE}],action:'commit',requestId:crypto.randomUUID(),planDigest:stale.planDigest}))).status,200,'another mark saved meanwhile: approved on the list as it is now');
 check((await officeRow()).filter(e=>!e.employeeId).map(e=>e.employeeName).sort(),['آخر','ماجد حسن'].sort(),'both marks kept');
 console.log(JSON.stringify({ok:true,checks,syntheticFixtures:true,productionDataUsed:false}));
}catch(error){console.error(app?.log().slice(-3000));throw error;}
finally{await app?.stop();}
