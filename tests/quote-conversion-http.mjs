// «معدل تحويل عرض السعر إلى مبيعات» automatically, over HTTP against the BUILT release (run the build first). Synthetic data only: a
// temporary SQLite, mocked sendmail, ERP sales reports built here as XLSX (the real parser reads them), quotes written as the CRM and the
// ERP quotations import write them. The months are the real clock's: the quotations of last month (finished), invoiced last month or
// this month.
// - The sales import: a report without «الوصف» is imported as before (nothing about quotations in the answer); the same report with the
//   column keeps every invoice a duplicate (no conflict, no new row, the same hashes) and writes their quotation numbers once, counted in
//   the import's audit line; the same again writes nothing; a report without the column never erases them. 401 / 403 as before.
// - The KPI (GET /api/sales?kpis=1): the representative's issued quotations of the month (a draft and the next month's left out), the ones
//   an ERP sales invoice of the same representative names on or after their day (a return and another representative's invoice do not
//   count), each with its invoice numbers; the supervisor's team adds up; a representative without quotations: not applicable; another
//   team never appears; a representative and nobody signed in read nothing.
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members=[
 {id:'owner',role:'admin',name:'مدير النظام'},{id:'sm',role:'manager',region:'eastern',name:'مدير المبيعات'},{id:'sup',role:'supervisor',sup:'sm',region:'eastern',name:'المشرف'},
 {id:'rep1',role:'rep',sup:'sup',region:'eastern',name:'مندوب ألف'},{id:'rep2',role:'rep',sup:'sup',region:'eastern',name:'مندوب باء'},
 {id:'rep9',role:'rep',sup:'sm',region:'eastern',name:'مندوب خارج الفريق'},{id:'cs',role:'customer_service',name:'خدمة العملاء'}
];
const riyadh=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}),today=riyadh.format(new Date()),month=today.slice(0,7);
const shift=n=>{const d=new Date(month+'-15T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);return d.toISOString().slice(0,7);};
const prev=shift(-1);
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const HEADERS=['رقم الفاتورة','التاريخ','النوع','رقم الصنف','اسم الصنف','الفئة','الكمية','الوحدة','سعر الوحدة','الخصم','الإجمالي','القيمة المضافة','رقم العميل','اسم العميل','رقم الموظف','اسم الموظف'];
const product='قوالب البلوك المتحركة';
function report(lines,withDescription=true){
 const headers=withDescription?[...HEADERS,'الوصف']:HEADERS;
 const cells=l=>[l.reference,l.date,l.type||'فاتورة مبيعات','M1','قالب',product,String(l.quantity??1),'حبة','1000.00','0',(l.total??1000).toFixed(2),((l.total??1000)*0.15).toFixed(2),l.customer||'C1','مصنع',l.employee||'E1',l.name||'مندوب ألف',...(withDescription?[l.description||'']:[])];
 const row=values=>`<row>${values.map(v=>`<c t="str"><v>${escape(v)}</v></c>`).join('')}</row>`;
 return Buffer.from(zipSync({
  '[Content_Types].xml':strToU8('<?xml version="1.0"?><Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'),
  'xl/workbook.xml':strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels':strToU8('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
  'xl/worksheets/sheet1.xml':strToU8(`<worksheet><sheetData>${[headers,...lines.map(cells)].map(row).join('')}</sheetData></worksheet>`),
 })).toString('base64');
}
const lines=[
 {reference:'INV-1',date:prev+'-10',description:'توريد حسب عرض السعر Qut-101'},
 {reference:'INV-2',date:month+'-01',description:'QUT ١٠٢'},                                 // this month, for last month's quotation
 {reference:'RET-1',date:prev+'-11',type:'مردودات المبيعات',quantity:-1,total:-1000,description:'Qut-103'},
 {reference:'INV-3',date:prev+'-12',customer:'C2',employee:'E2',name:'مندوب باء',description:'Qut-106'},// rep2's invoice of rep1's quotation
 {reference:'INV-9',date:prev+'-12',customer:'C9',employee:'E9',name:'مندوب خارج الفريق',description:'Qut-900'},
];
let checks=0,app;
const check=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};
try{
 app=await bootBuiltApp({members});
 const sessions={};for(const m of members)sessions[m.id]=await app.login(m.id);
 const as=who=>app.as(who?sessions[who]:'');
 const now=new Date().toISOString();
 const record=(id,kind,parent,assigned,data)=>app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,1,?)').bind(id,kind,parent,assigned,'الرئيسي',JSON.stringify(data),now,now,'fixture').run();
 for(const [id,code,rep] of [['c1','C1','rep1'],['c2','C2','rep2'],['c9','C9','rep9']])await record(id,'customer',null,rep,{name:'مصنع '+code,code,region:'الشرقية',_createdBy:rep});
 const quote=(id,number,{customer='c1',rep='rep1',date=prev+'-05',status='sent',erp=false}={})=>record(id,'quote',customer,rep,{performedBy:rep,number,date,validUntil:month+'-28',status,items:[{description:'قالب',quantity:1,price:1000}],discount:0,taxRate:15,terms:'',subtotal:1000,tax:150,total:1150,...(erp?{_erp:{source:'erp',key:number.toLowerCase(),code:number}}:{})});
 await quote('q101','Qut-101',{erp:true});await quote('q102','Qut-102',{date:prev+'-06',status:'accepted'});await quote('q103','Qut-103',{date:prev+'-07',status:'rejected'});
 await quote('q104','Qut-104',{status:'draft'});await quote('q105','Qut-105',{date:month+'-01'});await quote('q106','Qut-106',{date:prev+'-08'});await quote('q900','Qut-900',{customer:'c9',rep:'rep9'});
 const url='/api/sales/import',mappings=[{employeeId:'E1',repId:'rep1'},{employeeId:'E2',repId:'rep2'},{employeeId:'E9',repId:'rep9'}];
 const body=(base64,fields={})=>({action:'preview',fileName:'Reports_Invoices.xlsx',base64,employeeMappings:mappings,categoryMappings:[],...fields});
 const post=(who,payload)=>as(who)(url,{method:'POST',body:payload});
 async function importFile(base64){const preview=await post('owner',body(base64));if(preview.status!==200)console.error(preview.text,app.log().slice(-2000));check(preview.status,200,'preview');const result=await post('owner',body(base64,{action:'commit',previewToken:preview.json().previewToken,requestId:crypto.randomUUID()}));check(result.status,200,'commit');return {preview:preview.json(),result:result.json()};}
 const stored=async()=>Object.fromEntries((await app.db.prepare('SELECT reference,content_hash,mapped_hash,data FROM crm_erp_sales ORDER BY reference').all()).results.map(r=>[r.reference,{hash:r.content_hash+':'+r.mapped_hash,refs:JSON.parse(r.data).quotationRefs}]));

 // ---- who may import (unchanged)
 check((await post('',body(report(lines)))).status,401,'no session: 401');
 for(const who of ['rep1','cs'])check((await post(who,body(report(lines)))).status,403,who+': 403');

 // ---- without the column: as before
 let run=await importFile(report(lines,false));
 check([run.result.importedCount,'quotationLinkedCount' in run.result,'quotationRefsBackfillCount' in run.result,'quotationLinkedCount' in run.preview.summary],[5,false,false,false],'a report without «الوصف»: imported as before, nothing about quotations');
 const before=await stored();check(Object.values(before).map(r=>r.refs),[undefined,undefined,undefined,undefined,undefined],'and nothing stored about quotations');
 // ---- the column added: duplicates, backfilled once
 run=await importFile(report(lines));
 check([run.preview.summary.newCount,run.preview.summary.duplicateCount,run.preview.summary.conflictCount,run.preview.summary.quotationLinkedCount,run.preview.summary.quotationRefsBackfillCount],[0,5,0,4,5],'the same invoices with «الوصف»: duplicates, no conflict; four sales invoices name a quotation, five documents take their numbers');
 check([run.result.importedCount,run.result.duplicateCount,run.result.quotationRefsBackfillCount],[0,5,5]);
 const after=await stored();
 check(Object.fromEntries(Object.entries(after).map(([k,v])=>[k,v.hash])),Object.fromEntries(Object.entries(before).map(([k,v])=>[k,v.hash])),'content and mapped hashes unchanged');
 check(Object.fromEntries(Object.entries(after).map(([k,v])=>[k,v.refs])),{'INV-1':['Qut-101'],'INV-2':['Qut-102'],'INV-3':['Qut-106'],'INV-9':['Qut-900'],'RET-1':['Qut-103']},'each invoice keeps its quotation numbers');
 const line=JSON.parse((await app.db.prepare("SELECT detail FROM crm_audit WHERE action='استيراد مبيعات ERP' ORDER BY created_at DESC,rowid DESC LIMIT 1").first()).detail);
 check([line.quotationRefsBackfillCount,line.importedCount],[5,0],'counted once in the import\'s audit line');
 check([(await app.db.prepare("SELECT count(*) AS n FROM crm_audit WHERE action='استيراد مبيعات ERP'").first()).n,(await app.db.prepare("SELECT count(*) AS n FROM crm_audit WHERE record_id IN (SELECT id FROM crm_erp_sales)").first()).n],[2,0],'one audit line per import, none per invoice');
 run=await importFile(report(lines));check([run.result.duplicateCount,run.result.quotationRefsBackfillCount],[5,0],'the same report again: nothing');
 run=await importFile(report(lines,false));check(await stored(),after,'a later report without the column erases nothing');

 // ---- the KPI of last month (finished)
 const read=who=>as(who)('/api/sales?month='+prev+'&kpis=1');
 const reply=await read('sup');if(reply.status!==200)console.error(reply.text,app.log().slice(-2000));check(reply.status,200);
 const people=reply.json().kpis.people,person=id=>people.find(p=>p.member.id===id),orders=id=>person(id).metrics.find(m=>m.id==='orders');
 check([orders('rep1').numerator,orders('rep1').denominator,orders('rep1').score,orders('rep1').status,orders('rep1').source],[2,4,50,'scored','automatic'],'rep1: Qut-101 and Qut-102 converted, of four issued quotations (a draft and the next month\'s left out)');
 check(person('rep1').quotations.filter(q=>q.converted).map(q=>[q.number,q.invoices]).sort(),[['Qut-101',['INV-1']],['Qut-102',['INV-2']]],'each converted quotation with its invoice number; a return and another representative\'s invoice convert nothing');
 check([orders('rep2').denominator,orders('rep2').status],[0,'not_applicable'],'rep2 issued no quotation: not applicable');
 ok(orders('rep1').reason.includes('«الوصف»'),'the calculation is explained');
 check(people.some(p=>p.member.id==='rep9'),false,'another team never appears');
 check(people.flatMap(p=>p.quotations||[]).some(q=>q.number==='Qut-900'),false,'nor its quotation');
 const managed=(await read('sm')).json().kpis.people;check([managed.find(p=>p.member.id==='rep1').metrics.find(m=>m.id==='orders').score,managed.find(p=>p.member.id==='rep9').metrics.find(m=>m.id==='orders').score],[50,100],'the sales manager reads the same rep1, and rep9 converted its one quotation');
 check([(await read('rep1')).status,(await read('')).status],[403,401],'a representative and nobody signed in read nothing');
 // ---- this month: its own quotation only
 const current=(await as('sup')('/api/sales?month='+month+'&kpis=1')).json().kpis.people.find(p=>p.member.id==='rep1');
 check(current.quotations.map(q=>[q.number,q.converted]),[['Qut-105',false]],'a quotation belongs to the month of its own day');
 console.log(JSON.stringify({ok:true,checks,syntheticFixtures:true,productionDataUsed:false}));
}finally{await app?.stop();}
