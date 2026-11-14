// «دايمًا كامل» over HTTP against the BUILT release (run the build first): the ERP sales report uploaded again with corrections replaces
// what is saved for its period (the owner, 2026-11-14). Synthetic data only: a temporary SQLite, mocked sendmail, ERP sales reports built
// here as real XLSX bytes with «الوصف» (the real reader reads them), quotations written as the CRM writes them. The month is the real
// clock's last month.
// - 401 without a session, 403 to a representative and to customer service, as before.
// - The sales manager (every active representative) sends wholeCompany as the page does: the corrected file's preview lists the replaced,
//   moved and removed invoices and the representative who ends at zero; the commit is refused (409) without the agreement and writes
//   nothing, then applies with it; the same request again replays; the sales list of the month, the representatives' own targets and
//   «معدل تحويل عرض السعر إلى مبيعات» follow the corrected file (a quotation the description no longer names is no longer converted, one
//   it names now is; a moved invoice converts nothing of its old representative's).
// - A preview made stale by another import is refused (409) and writes nothing.
// - The supervisor sends the same flag and imports exactly as before: a changed invoice is a conflict, nothing is removed.
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members=[
 {id:'owner',role:'admin',name:'مدير النظام'},{id:'sm',role:'manager',name:'مدير المبيعات'},{id:'sup',role:'supervisor',sup:'sm',name:'المشرف'},
 {id:'rep1',role:'rep',sup:'sup',name:'مندوب ألف'},{id:'rep2',role:'rep',sup:'sup',name:'مندوب باء'},{id:'rep3',role:'rep',sup:'sm',name:'مندوب جيم'},{id:'cs',role:'customer_service',name:'خدمة العملاء'}
];
const riyadh=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}),month=riyadh.format(new Date()).slice(0,7);
const shift=n=>{const d=new Date(month+'-15T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);return d.toISOString().slice(0,7);};
const M=shift(-1),day=d=>M+'-'+String(d).padStart(2,'0');
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const HEADERS=['رقم الفاتورة','التاريخ','النوع','رقم الصنف','اسم الصنف','الفئة','الكمية','الوحدة','سعر الوحدة','الخصم','الإجمالي','القيمة المضافة','رقم العميل','اسم العميل','رقم الموظف','اسم الموظف','الوصف'];
const A='قوالب البلوك المتحركة';
function report(lines){
 const cells=l=>[l.reference,l.date,l.type||'فاتورة مبيعات','M1','قالب',A,String(l.quantity??1),'حبة',(l.total??1000).toFixed(2),'0',((l.total??1000)*(l.quantity??1)*(l.type?-1:1)).toFixed(2),'0',l.customer||'C1','مصنع '+(l.customer||'C1'),l.employee||'E1',l.name||'مندوب ألف',l.description||''];
 const row=values=>`<row>${values.map(v=>`<c t="str"><v>${escape(v)}</v></c>`).join('')}</row>`;
 return Buffer.from(zipSync({
  '[Content_Types].xml':strToU8('<?xml version="1.0"?><Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'),
  'xl/workbook.xml':strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels':strToU8('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
  'xl/worksheets/sheet1.xml':strToU8(`<worksheet><sheetData>${[HEADERS,...lines.map(cells)].map(row).join('')}</sheetData></worksheet>`),
 })).toString('base64');
}
const first=[
 {reference:'A-1',date:day(3),total:5000,description:'حسب عرض Qut-1'},{reference:'A-2',date:day(10),total:4000,description:'Qut-2'},{reference:'A-3',date:day(15),total:1000},
 {reference:'B-1',date:day(5),total:8000,customer:'C2',employee:'E2',name:'مندوب باء',description:'Qut-3'},{reference:'B-2',date:day(12),total:2000,customer:'C2',employee:'E2',name:'مندوب باء'},
 {reference:'D-1',date:day(14),total:6000,customer:'C3',employee:'E3',name:'مندوب جيم'},
];
const corrected=[
 {reference:'A-1',date:day(3),total:5000,description:'Qut-7'},{reference:'A-3',date:day(15),total:1000},
 {reference:'A-2',date:day(10),total:4000,customer:'C1',employee:'E2',name:'مندوب باء',description:'Qut-2'},
 {reference:'B-1',date:day(5),total:7000,customer:'C2',employee:'E2',name:'مندوب باء',description:'Qut-3'},{reference:'B-2',date:day(12),total:2000,customer:'C2',employee:'E2',name:'مندوب باء'},
];
let checks=0,app;
const check=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};
try{
 app=await bootBuiltApp({members});
 const sessions={};for(const m of members)sessions[m.id]=await app.login(m.id);
 const as=who=>app.as(who?sessions[who]:'');
 const now=new Date().toISOString();
 const record=(id,kind,parent,assigned,data)=>app.db.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,1,?)').bind(id,kind,parent,assigned,'الرئيسي',JSON.stringify(data),now,now,'fixture').run();
 for(const [id,code,rep] of [['c1','C1','rep1'],['c2','C2','rep2'],['c3','C3','rep3']])await record(id,'customer',null,rep,{name:'مصنع '+code,code,region:'الشرقية',_createdBy:rep});
 const quote=(id,number,rep,customer,date)=>record(id,'quote',customer,rep,{performedBy:rep,number,date,validUntil:month+'-28',status:'sent',items:[{description:'قالب',quantity:1,price:1000}],discount:0,taxRate:15,terms:'',subtotal:1000,tax:150,total:1150});
 await quote('q1','Qut-1','rep1','c1',day(1));await quote('q2','Qut-2','rep1','c1',day(1));await quote('q7','Qut-7','rep1','c1',day(2));await quote('q3','Qut-3','rep2','c2',day(1));
 const url='/api/sales/import',mappings=[{employeeId:'E1',repId:'rep1'},{employeeId:'E2',repId:'rep2'},{employeeId:'E3',repId:'rep3'}];
 const body=(base64,fields={})=>({action:'preview',fileName:'Reports_Invoices.xlsx',base64,employeeMappings:mappings,categoryMappings:[],wholeCompany:true,...fields});
 const post=(who,payload)=>as(who)(url,{method:'POST',body:payload});
 const preview=async(who,payload)=>{const reply=await post(who,payload);if(reply.status!==200)console.error(reply.text,app.log().slice(-2000));check(reply.status,200,who+' preview');return reply.json();};
 const commit=(who,payload,shown,extra={})=>post(who,{...payload,action:'commit',previewToken:shown.previewToken,requestId:crypto.randomUUID(),...extra});
 const rows=async()=>(await app.db.prepare('SELECT reference,rep_id,total_cents,content_hash,mapped_hash,data FROM crm_erp_sales ORDER BY reference').all()).results;
 const salesOf=async rep=>(await as('sm')('/api/sales?month='+M)).json().sales.filter(s=>s.id.startsWith('erp-sale-')&&s.repId===rep).reduce((sum,s)=>sum+s.totalCents,0);
 const ownActual=async rep=>(await as(rep)('/api/targets?month='+M)).json().sales.products.find(p=>p.product===A).actualQuantity;
 const converted=async()=>{const people=(await as('sm')('/api/sales?month='+M+'&kpis=1')).json().kpis.people;return Object.fromEntries(['rep1','rep2'].map(id=>[id,people.find(p=>p.member.id===id).quotations.filter(q=>q.converted).map(q=>q.number).sort()]));};

 // ---- who may import (unchanged)
 check((await post('',body(report(first)))).status,401,'no session: 401');
 for(const who of ['rep1','cs'])check((await post(who,body(report(first)))).status,403,who+': 403');

 // ---- the first export
 let shown=await preview('sm',body(report(first)));
 check([shown.summary.newCount,shown.replacement.from,shown.replacement.to,shown.replacement.zeroReps],[6,day(3),day(15),[]],'the first file: new, its period from the first to the last invoice');
 let reply=await commit('sm',body(report(first)),shown);check(reply.status,200,'imported');
 check([await salesOf('rep1'),await salesOf('rep2'),await salesOf('rep3')],[1000000,1000000,600000],'the month\'s sales as exported');
 check([await ownActual('rep1'),await ownActual('rep3')],[3,1],'the representatives\' own targets read them');
 check(await converted(),{rep1:['Qut-1','Qut-2'],rep2:['Qut-3']},'quotations converted by «الوصف»');

 // ---- the corrected export
 const before=await rows();
 shown=await preview('sm',body(report(corrected)));
 const status=Object.fromEntries(shown.documents.map(d=>[d.reference,d.status]));
 check([status['A-1'],status['A-2'],status['A-3'],status['B-1'],status['B-2'],status['D-1']],['duplicate','moved','duplicate','replaced','duplicate','removed'],'unchanged, moved, replaced, removed');
 check([shown.replacement.replacedCount,shown.replacement.movedCount,shown.replacement.removedCount,shown.replacement.zeroReps.map(z=>[z.repName,z.beforeCount,z.beforeCents])],[1,1,1,[['مندوب جيم',1,600000]]],'rep3 ends the period at zero, shown before the commit');
 check(shown.documents.filter(d=>['replaced','moved','removed'].includes(d.status)).map(d=>[d.reference,d.saved.repName,d.saved.totalCents]).sort(),[['A-2','مندوب ألف',400000],['B-1','مندوب باء',800000],['D-1','مندوب جيم',600000]],'each with what is saved now');
 reply=await commit('sm',body(report(corrected)),shown);
 check([reply.status,reply.json().error,await rows()],[409,'راجع الفواتير المحفوظة التي ستُستبدل أو تُنقل أو تُحذف، ثم وافق على ذلك صراحةً قبل الاستيراد',before],'without the agreement: refused, nothing written');
 const requestId=crypto.randomUUID(),payload={...body(report(corrected)),action:'commit',previewToken:shown.previewToken,requestId,replaceExisting:true};
 reply=await post('sm',payload);check(reply.status,200,'applied with the agreement');
 const receipt=reply.json();check([receipt.replacement.replacedCount,receipt.replacement.movedCount,receipt.replacement.removedCount,receipt.duplicateCount],[1,1,1,3],'the receipt');
 const after=await rows();
 check(after.map(r=>[r.reference,r.rep_id,r.total_cents,JSON.parse(r.data).quotationRefs]),[['A-1','rep1',500000,['Qut-7']],['A-2','rep2',400000,['Qut-2']],['A-3','rep1',100000,[]],['B-1','rep2',700000,['Qut-3']],['B-2','rep2',200000,[]]],'the corrected file wins: A-2 moved, B-1 corrected, D-1 gone, A-1 names Qut-7');
 reply=await post('sm',payload);check([reply.status,reply.json().alreadySaved,await rows()],[200,true,after],'the same request again: the receipt, nothing written twice');
 const audit=JSON.parse((await app.db.prepare('SELECT detail FROM crm_audit WHERE id=?').bind('erp-import-'+requestId).first()).detail);
 check(audit.replacementChanges.map(c=>[c.action,c.reference,c.from.repId,c.to?.repId??null]).sort((a,b)=>a[1].localeCompare(b[1])),[['moved','A-2','rep1','rep2'],['replaced','B-1','rep2','rep2'],['removed','D-1','rep3',null]],'audited: each change from whom to whom');
 ok((await app.db.prepare('SELECT count(*) AS n FROM crm_audit WHERE id=?').bind('erp-import-'+requestId+':replaced').first()).n===1,'with the rows as they were');
 check([await salesOf('rep1'),await salesOf('rep2'),await salesOf('rep3')],[600000,1300000,0],'the month\'s sales follow the corrected file, nothing counted twice');
 check([await ownActual('rep1'),await ownActual('rep2'),await ownActual('rep3')],[2,3,0],'and the representatives\' own targets');
 check(await converted(),{rep1:['Qut-7'],rep2:['Qut-3']},'«معدل تحويل عرض السعر إلى مبيعات»: Qut-1 no longer named, Qut-7 is; Qut-2 now invoiced by another representative converts nothing of rep1\'s');

 // ---- a stale preview
 const stale=[...corrected.map(l=>({...l})),{reference:'N-1',date:day(11),total:300,customer:'C3',employee:'E3',name:'مندوب جيم'}];stale[3].total=6900;
 shown=await preview('sm',body(report(stale)));check([shown.summary.newCount,shown.replacement.replacedCount],[1,1],'a preview replacing B-1 again');
 const other=report([{reference:'S-1',date:shift(-2)+'-05',total:100}]);const otherShown=await preview('sm',body(other));check((await commit('sm',body(other),otherShown)).status,200,'another import meanwhile');
 const held=await rows();
 reply=await commit('sm',body(report(stale)),shown,{replaceExisting:true});check([reply.status,(await rows()).length,(await rows()).find(r=>r.reference==='B-1').total_cents],[409,held.length,700000],'the stale preview: refused, nothing replaced');

 // ---- the supervisor: exactly as before
 shown=await preview('sup',{...body(report(stale)),employeeMappings:[{employeeId:'E1',repId:'rep1'},{employeeId:'E2',repId:'rep2'}]});
 check([shown.documents.find(d=>d.reference==='B-1').status,'replacement' in shown,shown.documents.some(d=>d.status==='removed')],['conflict',false,false],'a supervisor: the changed invoice is a conflict, nothing replaced or removed');
 reply=await commit('sup',{...body(report(stale)),employeeMappings:[{employeeId:'E1',repId:'rep1'},{employeeId:'E2',repId:'rep2'}],allowSkipped:true},shown,{replaceExisting:true});
 check([reply.status,(await rows()).length],[409,held.length],'and the conflict blocks the supervisor\'s commit');
 console.log(JSON.stringify({ok:true,checks,syntheticFixtures:true,productionDataUsed:false}));
}finally{await app?.stop();}
