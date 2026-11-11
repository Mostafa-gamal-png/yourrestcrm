// «استيراد كشف التحصيل من ERP» over HTTP against the BUILT release (run the build first). Synthetic data only: a temporary SQLite,
// mocked sendmail, statements built here in the ERP's layout (UTF-16LE HTML). The months are the real clock's (this month in Riyadh,
// the one before it and the one after it).
// - 401 without a session, 403 to a supervisor, a representative, customer service, a manager whose «تحرير» of the targets page is off,
//   and to a write from another site; the administrator and the sales managers import.
// - Preview writes nothing; commit writes each mapped representative's collection evidence {dueCents, collectedCents, reference} and the
//   evaluation's «التحصيل» reads it; the office, accounts of nobody and rows that do not add up are reported; a name not mapped is not written.
// - The same request again (an answer lost on the network) is answered from the first and writes nothing twice; the same file again
//   changes nothing; replacing a value entered by hand needs the confirmation and keeps the rest of the evidence; a finished month is the
//   administrator's (recorded), a future month nobody's; a regional manager writes only their region's representatives.
import assert from 'node:assert/strict';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members=[
 {id:'owner',role:'admin',name:'مدير النظام'},{id:'sm',role:'manager',name:'مدير المبيعات'},{id:'smoff',role:'manager',name:'مدير بلا تحرير'},
 {id:'mgrw',role:'manager',region:'western',name:'مدير الغربية'},{id:'sup',role:'supervisor',sup:'sm',name:'المشرف'},
 {id:'rep1',role:'rep',sup:'sup',region:'eastern',name:'مندوب ألف'},{id:'rep2',role:'rep',sup:'sm',region:'eastern',name:'مندوب باء'},
 {id:'repw',role:'rep',sup:'mgrw',region:'western',name:'مندوب الغربية'},{id:'cs',role:'customer_service',name:'خدمة العملاء'}
];
const HEADERS=['رقم الحساب','اسم الحساب','المندوب','المحصل','الرصيد السابق مدين','الرصيد السابق دائن','حركة الفترة مدين','حركة الفترة دائن','الرصيد الحالي مدين','الرصيد الحالي دائن'];
const statement=(rows,headers=HEADERS)=>Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from("<TABLE><TR><TD colspan='9'><center><b>كشف حساب  لـ 1100 _ 1199</b></center></TD></TR><TR>"+headers.map(h=>'<Th>'+h+'</Th>').join('')+'</TR>'+rows.map(r=>'<TR>'+r.map(v=>'<TD>'+v+'</TD>').join('')+'</TR>').join('')+'</TABLE>','utf16le')]).toString('base64');
const fileA=statement([
 ['1101','مصنع 1','مندوب ألف','مندوب ألف','1000','0','500','700','800','0'],// rep1: due 1500, collected 700
 ['1102','مصنع 2','مندوب ألف','مندوب ألف','0','0','300','300','0','0'],// rep1: due 300, collected 300
 ['1103','مصنع 3','مندوب باء','مندوب باء','200','0','0','50','150','0'],// rep2: due 200, collected 50
 ['1104','مصنع 4','مبيعات مكتب','مبيعات مكتب','0','0','999','999','0','0'],
 ['1105','مصنع 5','','','10','0','0','0','10','0'],
 ['1106','مصنع 6','موظف مجهول','موظف مجهول','0','0','100','0','90','0'],// unmapped, and does not add up
]);
const riyadh=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}),day=riyadh.format(new Date()),month=day.slice(0,7);
const shift=n=>{const d=new Date(month+'-15T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);return d.toISOString().slice(0,7);};
const prev=shift(-1),next=shift(1);
let checks=0,app;
const check=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};
try{
 app=await bootBuiltApp({members});
 const sessions={};for(const m of members)sessions[m.id]=await app.login(m.id);
 const as=who=>app.as(who?sessions[who]:'');
 const url='/api/kpi-evidence/import';
 const post=(who,body,headers)=>as(who)(url,{method:'POST',body,headers});
 const evidence=async(memberId,m=month)=>{const row=await app.db.prepare('SELECT version,input,scope_key,sales_revision,cutoff FROM crm_kpi_evidence WHERE member_id=? AND month=?').bind(memberId,m).first();return row?{...row,input:JSON.parse(row.input)}:null;};
 const revision=async()=>(await app.db.prepare("SELECT revision FROM crm_kpi_evidence_state WHERE id='company'").first()).revision;
 const audits=async()=>(await app.db.prepare("SELECT id,record_id,action,detail FROM crm_audit WHERE id LIKE 'kpi-collection-import:%' ORDER BY id").all()).results;
 const body=(fields={})=>({action:'preview',month,fileName:'Account_Balance_Sheet_F_T.xls',base64:fileA,...fields});

 // ---- who may
 check((await as('')(url)).status,401,'GET without a session: 401');
 check((await post('',body())).status,401,'POST without a session: 401');
 for(const who of ['sup','rep1','cs'])for(const reply of [await as(who)(url),await post(who,body())])check(reply.status,403,who+' is refused (403)');
 await app.db.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('smoff','{\"targets:edit\":false}','[]',1,'owner',?)").bind(new Date().toISOString()).run();
 const smoff=await app.login('smoff');
 check([(await app.as(smoff)(url)).status,(await app.as(smoff)(url,{method:'POST',body:body()})).status],[403,403],'a sales manager whose «تحرير» of the targets page is off: 403');
 check((await post('sm',body(),{Origin:'https://evil.example'})).status,403,'a write from another site: 403');
 const config=await as('sm')(url);check(config.status,200,'the sales manager reads the configuration');
 ok(['rep1','rep2'].every(id=>config.json().members.some(m=>m.id===id)),'with the representatives of the team');check(config.json().currentMonth,month);
 check((await as('owner')(url)).status,200,'and the administrator');

 // ---- preview writes nothing
 const revisionBefore=await revision();
 const preview=await post('sm',body());if(preview.status!==200)console.error(preview.text,app.log().slice(-3000));check(preview.status,200,'preview');const p=preview.json();
 check(p.reps.map(r=>[r.repId,r.accounts,r.dueCents,r.collectedCents,r.percent,r.status]),[['rep1',2,180000,100000,55.56,'new'],['rep2',1,20000,5000,25,'new']],'per representative: accounts, due, collected, rate, new');
 check(p.names.map(n=>[n.name,n.status,n.mappingSource]),[['مندوب ألف','mapped','name'],['مندوب باء','mapped','name'],['موظف مجهول','unmapped','none']],'names mapped by the full name; one not');
 check([p.summary.rows,p.summary.officeRows,p.summary.noRepRows,p.summary.mismatchRows,p.summary.unmappedNames],[6,1,1,1,1],'the office, the account of nobody, the row that does not add up and the name not mapped are counted');
 ok(p.meaning.includes('حركة الفترة دائن')&&p.meaning.includes('للشهر المختار'),'the preview states the meaning and that the month is chosen');
 ok(p.reference.startsWith('كشف حساب ERP · Account_Balance_Sheet_F_T.xls · '+day),'reference «كشف حساب ERP · <file> · <day>»');
 check([await evidence('rep1'),await revision(),(await audits()).length],[null,revisionBefore,0],'nothing written by a preview');

 // ---- commit
 check((await post('sm',body({action:'commit',requestId:crypto.randomUUID()}))).status,400,'a commit without the preview\'s digest');
 check((await post('sm',body({action:'commit',requestId:crypto.randomUUID(),planDigest:'0'.repeat(64)}))).status,409,'a commit that is not the preview');
 const requestId=crypto.randomUUID(),commitBody=body({action:'commit',requestId,planDigest:p.planDigest});
 const committed=await post('sm',commitBody);check(committed.status,200,'commit');check([committed.json().writtenCount,committed.json().newCount,committed.json().skippedNames],[2,2,1],'two written, one name skipped');
 const e1=await evidence('rep1');check(e1.input.collection,{dueCents:180000,collectedCents:100000,reference:p.reference},'the month\'s collection evidence of the representative');check([e1.input.history.complete,e1.input.quotationsComplete,e1.input.quotations,e1.version],[false,false,[],1],'and nothing else is claimed');
 check(await revision(),revisionBefore+1,'one evidence revision for the whole import');
 let lines=await audits();check(lines.map(a=>a.record_id).sort(),['kpi-collection-import','kpi-evidence-rep1','kpi-evidence-rep2'],'one import line and each representative\'s own line');
 const importLine=JSON.parse(lines.find(a=>a.record_id==='kpi-collection-import').detail);check([importLine.counts.newCount,importLine.reps.map(r=>[r.memberId,r.before,r.after.dueCents])],[2,[['rep1',null,180000],['rep2',null,20000]]],'the import line holds the counts and each before → after');
 // the answer lost on the network: the same request again
 const again=await post('sm',commitBody);check([again.status,again.json().alreadySaved,again.json().writtenCount],[200,true,2],'the same request again is answered from the first');
 check([(await audits()).length,(await evidence('rep1')).version,await revision()],[3,1,revisionBefore+1],'and writes nothing twice');
 check((await post('sm',{...commitBody,mappings:[{name:'موظف مجهول',repId:'rep2'}]})).status,409,'the same request id with other data is refused');

 // ---- the evaluation's «التحصيل» reads it
 const kpis=(await as('sm')('/api/sales?month='+month+'&kpis=1')).json().kpis.people;
 const metric=id=>kpis.find(p=>p.member.id===id).metrics.find(m=>m.id==='collection');
 check([metric('rep1').numerator,metric('rep1').denominator,metric('rep1').score,metric('rep1').source],[100000,180000,55.56,'management'],'the collection axis of the evaluation uses the import');
 check([metric('rep2').numerator,metric('rep2').denominator],[5000,20000]);

 // ---- the same file again
 const same=(await post('sm',body())).json();check(same.reps.map(r=>r.status),['unchanged','unchanged'],'the same file again: unchanged');
 const sameCommit=await post('sm',body({action:'commit',requestId:crypto.randomUUID(),planDigest:same.planDigest}));
 check([sameCommit.status,sameCommit.json().writtenCount,(await audits()).length,await revision()],[200,0,3,revisionBefore+1],'changes nothing, not even the audit');

 // ---- a value entered by hand is replaced only when confirmed; the rest of the evidence stays
 const options=(await as('sm')('/api/kpi-evidence?memberId=rep2&month='+month)).json();
 const manual=await as('sm')('/api/kpi-evidence',{method:'POST',body:{memberId:'rep2',month,version:options.evidence.version,requestId:crypto.randomUUID(),salesRevision:options.salesRevision,evidenceRevision:options.evidenceRevision,input:{collection:{dueCents:99900,collectedCents:11100,reference:'يدوي'},history:{complete:true,reference:'مرجع السجل'},quotationsComplete:true,quotations:[]}}});
 check(manual.status,200,'the collection of rep2 entered by hand');
 const replacing=(await post('sm',body())).json(),rep2=replacing.reps.find(r=>r.repId==='rep2');
 check([rep2.status,rep2.current],['replace',{dueCents:99900,collectedCents:11100,reference:'يدوي'}],'the preview marks «سيستبدل القيمة الحالية (… / …)»');
 const refused=await post('sm',body({action:'commit',requestId:crypto.randomUUID(),planDigest:replacing.planDigest}));
 check([refused.status,(await evidence('rep2')).input.collection.dueCents],[409,99900],'not without the confirmation');
 const replaced=await post('sm',body({action:'commit',requestId:crypto.randomUUID(),planDigest:replacing.planDigest,replaceConfirmed:true}));
 check([replaced.status,replaced.json().replaceCount],[200,1],'replaced once confirmed');
 const e2=await evidence('rep2');check([e2.input.collection.dueCents,e2.input.collection.collectedCents,e2.input.history,e2.input.quotationsComplete],[20000,5000,{complete:true,reference:'مرجع السجل'},true],'the history and quotations confirmations are kept');
 lines=await audits();check(JSON.parse(lines.filter(a=>a.record_id==='kpi-evidence-rep2').map(a=>a.detail).find(d=>JSON.parse(d).before)).before,{dueCents:99900,collectedCents:11100,reference:'يدوي'},'rep2\'s history line keeps what was replaced');

 // ---- a name chosen in the preview, and remembered by the next import
 check((await post('sm',body({mappings:[{name:'موظف مجهول',repId:'cs'}]}))).status,403,'a name mapped to someone outside the team: refused');
 const chosen=(await post('sm',body({mappings:[{name:'موظف مجهول',repId:'rep1'}]}))).json();
 check([chosen.names.find(n=>n.name==='موظف مجهول').mappingSource,chosen.reps.find(r=>r.repId==='rep1').dueCents,chosen.reps.find(r=>r.repId==='rep1').mismatches],['selected',190000,1],'a name chosen is added to that representative');
 check((await post('sm',body({action:'commit',requestId:crypto.randomUUID(),planDigest:chosen.planDigest,mappings:[{name:'موظف مجهول',repId:'rep1'}],replaceConfirmed:true}))).status,200);
 check((await post('sm',body())).json().names.find(n=>n.name==='موظف مجهول').mappingSource,'previous','the next statement remembers the choice');
 await app.db.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('erp-import-t','sm','f','x.xlsx','{}',?)").bind(new Date().toISOString()).run();
 await app.db.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES('erp-sale-t','k','c','m','INV-1','sale',?,'E-7','rep2','الرئيسي','eastern','C1','عميل','{\"items\":[],\"employeeId\":\"E-7\",\"employeeName\":\"اسم في ERP\"}',100,'erp-import-t','sm',?)").bind(month+'-01',new Date().toISOString()).run();
 const erpNamed=(await post('sm',{...body(),base64:statement([['2201','مصنع','اسم في ERP','','0','0','100','10','90','0']])})).json();
 check(erpNamed.names.map(n=>[n.name,n.repId,n.mappingSource]),[['اسم في ERP','rep2','erp']],'a name the ERP sales import already tied to a representative');

 // ---- months
 const closed=await post('sm',body({month:prev}));check([closed.status,closed.json().error],[403,'انتهى هذا الشهر؛ استيراد تحصيله لمدير النظام فقط'],'a finished month: refused to the sales manager');
 const ownerPreview=(await post('owner',body({month:prev}))).json();check(ownerPreview.closedMonth,true,'the administrator previews it, told it has ended');
 check((await post('owner',body({month:prev,action:'commit',requestId:crypto.randomUUID(),planDigest:ownerPreview.planDigest}))).status,200,'and imports it');
 check([(await evidence('rep1',prev)).input.collection.dueCents,JSON.parse((await audits()).find(a=>JSON.parse(a.detail).month===prev&&a.record_id==='kpi-collection-import').detail).closedMonth],[190000,true],'recorded as a finished month (the name chosen earlier counted for rep1 again)');
 check((await post('owner',body({month:next}))).status,400,'a month to come: nobody');

 // ---- a regional manager, a wrong file, a large body
 const west=(await post('mgrw',body())).json();check(west.names.every(n=>n.status!=='out_of_scope'||n.repId===''&&n.repName===''),true,'and is never told who the others are');check([west.reps,west.names.filter(n=>n.status==='out_of_scope').map(n=>n.name)],[[],['مندوب ألف','مندوب باء','موظف مجهول']],'a regional manager writes only their region\'s representatives (the name chosen earlier for rep1 too)');
 const wrong=await post('sm',{...body(),base64:statement([['1','x','y','z']],['رقم الفاتورة','التاريخ','النوع','رقم الصنف'])});check([wrong.status,/ليس كشف حساب ERP المتوقع/.test(wrong.json().error)],[400,true],'a file of other columns is refused with its reason');
 const missing=await post('sm',{...body(),base64:statement([],HEADERS.slice(0,8))});check([missing.status,/ينقصه عمود مطلوب: الرصيد الحالي مدين، الرصيد الحالي دائن/.test(missing.json().error)],[400,true],'missing columns are named');
 check((await post('sm',{...body(),base64:'A'.repeat(3_100_000)})).status,413,'a body over the limit is refused before it is read');
 console.log(JSON.stringify({ok:true,checks,syntheticFixtures:true,productionDataUsed:false}));
}finally{await app?.stop();}
